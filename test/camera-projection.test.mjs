// moteur/test/camera-projection.test.mjs
//
// Une seule classe Camera, deux projections. La bascule doit refaire le frustum ET le repère
// filaire : quand ils divergent, l'auteur cadre avec une pyramide qui ne correspond pas à ce qui
// est rendu, et rien ne le signale.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { creerContexte, deEsm } from './engine-env.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Le moteur juste assez complet pour construire une caméra et basculer sa projection. */
function contexteCamera(extra){
  const ctx = creerContexte(['js/component-registry.js', 'js/component.js', 'js/node.js', 'js/component-data.js',
    'js/camera-framing.js', 'js/components/component-camera.js'].concat(extra || []));
  vm.runInContext('var LAYER_HELPERS = 31; var scene = new THREE.Scene();'
    + ' function liftOverlay(o){ return o; } function updateHierarchy(){} function select(){} function removeHelper(){}'
    + ' var activeCam = null; function quitViewCamera(){}', ctx);
  vm.runInContext(deEsm(readFileSync(path.join(root, 'js/objects.js'), 'utf8')), ctx,
    { filename: 'js/objects.js' });
  return ctx;
}

test('la bascule de projection remplace la camera three', () => {
  const ctx = contexteCamera();
  vm.runInContext(`
    const n = createSceneNode({ name: 'Cam', silent: true, components: [{ type: 'Camera' }] });
    const c = n.getComponent('Camera');
    const avant = c.objectThree.isPerspectiveCamera === true;
    c.projection = 'orthographic';
    c.applyProjection();
    this.bascule = {
      avant: avant,
      apres: c.objectThree.isOrthographicCamera === true,
      // ed(node).cam doit suivre l'échange : c'est lui que lisent le repère filaire, le mode
      // Lecture et le jeu publié. S'il pointe sur l'ancienne caméra, on rend par une caméra
      // qui n'est plus dans la scène.
      suivi: ed(n).cam === c.objectThree,
      // La rotation de 180° est la MÊME dans les deux projections : le boîtier a son objectif
      // en +Z, une THREE.Camera regarde vers son -Z, et une caméra qui filme à l'envers de son
      // propre boîtier fait cadrer d'un côté ce qui est rendu de l'autre. Le cas 2D se règle en
      // tournant le NŒUD (faceCameraToPlane), pas la caméra.
      memeRotation: Math.abs(c.objectThree.rotation.y - Math.PI) < 1e-6,
      // Une seule caméra sous le nœud : l'ancienne doit être retirée, pas laissée là.
      nbCameras: n.children.filter(function(x){ return x.isCamera; }).length
    };
  `, ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.bascule)), {
    avant: true, apres: true, suivi: true, memeRotation: true, nbCameras: 1
  });
});

test('la camera orthographique voit DES DEUX COTES du plan', () => {
  // Un `near` positif — le réflexe venu de la 3D — mangerait tous les sprites que l'auteur
  // décale en arrière-plan pour ordonner ses calques. Le frustum 2D accepte les deux côtés de z.
  const ctx = contexteCamera();
  vm.runInContext(`
    const n = createSceneNode({ name: 'Cam', silent: true,
      components: [{ type: 'Camera', data: { projection: 'orthographic' } }] });
    const c = ed(n).cam;
    this.profondeur = { near: c.near, far: c.far };
  `, ctx);
  const p = JSON.parse(JSON.stringify(ctx.profondeur));
  assert.ok(p.near < 0, 'le near doit etre negatif : sinon tout arriere-plan disparait');
  assert.ok(p.far > 0);
});

test('pixelPerfect donne un rapport entier', () => {
  const ctx = creerContexte(['js/camera-framing.js']);
  // 1920 x 1080 px, 100 pixels par unité, cadrage « le plus net possible ».
  const c = vm.runInContext("framing2d(1920, 1080, 100, 'height', 0, 0)", ctx);
  assert.equal(Number.isInteger(c.ratio), true, 'le rapport pixel doit etre entier');
  assert.equal(c.ratio >= 1, true);
});

test('la projection survit a un aller-retour de serialisation', () => {
  const ctx = contexteCamera();
  vm.runInContext(`
    const n = createSceneNode({ name: 'Cam', silent: true, components: [{ type: 'Camera',
      data: { projection: 'orthographic', ppu: 32, pixelPerfect: true, mode: 'width',
              widthLevel: 20, orthoSize: 7 } }] });
    this.serialise = n.getComponent('Camera').serialize();
  `, ctx);
  const d = JSON.parse(JSON.stringify(ctx.serialise));
  assert.equal(d.projection, 'orthographic');
  assert.equal(d.ppu, 32);
  assert.equal(d.pixelPerfect, true);
  // `mode` et PAS `framingMode` : c'est le nom que lit settingCam2d (camera-framing.js). Un
  // champ mal nommé y retombe SILENCIEUSEMENT sur 'height' pour toutes les caméras.
  assert.equal(d.mode, 'width');
  assert.equal(d.widthLevel, 20);
  assert.equal(d.orthoSize, 7);
});

test('CameraFollow borne la camera sur les deux axes', () => {
  const ctx = contexteCamera(['js/components/component-camera-follow.js']);
  vm.runInContext(`
    const cam = createSceneNode({ name: 'Cam', silent: true, components: [
      { type: 'Camera', data: { projection: 'orthographic', orthoSize: 5 } },
      { type: 'CameraFollow', data: { targetName: 'Héros',
                                      xMin: 0, xMax: 10, yMin: 0, yMax: 10 } }
    ]});
    const heros = createSceneNode({ name: 'Héros', silent: true,
      position: { x: 100, y: 100, z: 0 } });
    cam.getComponent('CameraFollow').step(cam, heros.position,
      { heightView: 10, widthView: 16, ratio: 1 });
    this.borne = { x: cam.position.x, y: cam.position.y };
  `, ctx);
  const b = JSON.parse(JSON.stringify(ctx.borne));
  // Bornee : la camera ne montre jamais le vide au-dela du decor.
  assert.equal(b.x <= 10, true, 'X non borne');
  assert.equal(b.y <= 10, true, 'Y non borne');
});

test('une paire de bornes absente laisse l axe libre', () => {
  const ctx = contexteCamera(['js/components/component-camera-follow.js']);
  vm.runInContext(`
    const cam = createSceneNode({ name: 'Cam', silent: true, components: [
      { type: 'Camera', data: { projection: 'orthographic' } },
      { type: 'CameraFollow', data: { targetName: 'Héros', xMin: 0, xMax: 10 } }
    ]});
    const heros = createSceneNode({ name: 'Héros', silent: true,
      position: { x: 5, y: 999, z: 0 } });
    cam.getComponent('CameraFollow').step(cam, heros.position,
      { heightView: 4, widthView: 4, ratio: 1 });
    this.libre = { y: cam.position.y };
  `, ctx);
  // C'est ce qu'on veut sur la verticale d'une tour dont on ne connait pas la fin.
  assert.equal(JSON.parse(JSON.stringify(ctx.libre)).y > 100, true,
    'l axe sans bornes doit rester libre');
});

test('les deux projections filment DEVANT le boitier, pas derriere', () => {
  // Le boîtier d'une caméra a son objectif en +Z (makeCamera, js/objects.js) : le nœud POINTE
  // donc vers +Z, et c'est ce que dessinent le repère filaire et le gizmo. La perspective
  // portait `rotation.y = Math.PI` pour filmer là ; l'orthographique ne l'avait pas, et filmait
  // donc À L'ENVERS de son propre boîtier — l'auteur cadre d'un côté, le rendu montre l'autre.
  const ctx = contexteCamera();
  vm.runInContext(`
    const avantDe = function(projection){
      const n = createSceneNode({ name: 'Cam', silent: true,
        components: [{ type: 'Camera', data: { projection: projection } }] });
      n.updateMatrixWorld(true);
      const v = new THREE.Vector3();
      ed(n).cam.getWorldDirection(v);
      return [Math.round(v.x), Math.round(v.y), Math.round(v.z)];
    };
    this.avant = { perspective: avantDe('perspective'), orthographic: avantDe('orthographic') };
  `, ctx);
  const a = JSON.parse(JSON.stringify(ctx.avant));
  assert.deepEqual(a.perspective, [0, 0, 1], 'la perspective doit filmer vers le +Z du noeud');
  assert.deepEqual(a.orthographic, a.perspective,
    'l orthographique filme a l envers de la perspective : le boitier et le rendu se contredisent');
});
