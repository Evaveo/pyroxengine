// LA GRILLE DE SOL EST UN GIZMO INFINI, ET LE SOL IMPLICITE N'EXISTE PLUS.
//
// Deux garanties tenues ici :
//   1. la grille n'a pas de bord atteignable — elle suit la caméra et change de pas par décade ;
//   2. aucun plan de collision n'est pose a y=0 par le demarrage de la physique. C'etait un
//      collider invisible, absent de la hierarchie, impossible a selectionner ou a supprimer :
//      une scene vide arretait quand meme les objets qui tombaient.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { creerContexte } from './engine-env.mjs';

const racineMoteur = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function neuf(){ return creerContexte(['js/editor-overlay.js', 'js/grid-floor.js']); }

test('sans TSL, on RETOMBE sur une grille finie plutot que sur rien', () => {
  const e = neuf();
  // le harnais charge three.min.js classique : pas de TSL, donc pas de MeshBasicNodeMaterial
  assert.equal(e.buildInfiniteGrid(), null, 'aucune grille shader sans le pont WebGPU');
  const g = e.createFloorGrid();
  assert.ok(g, 'mieux vaut une grille finie que pas de grille du tout');
  assert.equal(g.userData.infinite, false);
});

test('la grille infinie ne s ADAPTE pas : le quad suit la camera, les lignes vivent dans le shader', () => {
  const e = neuf();
  const scene = new e.THREE.Scene();
  // on simule ce que rend buildInfiniteGrid() : le harnais n'a pas TSL, mais le chemin de
  // recalage, lui, est du JavaScript ordinaire — et c'est LUI qu'on doit garder juste.
  const quad = new e.THREE.Mesh(new e.THREE.PlaneGeometry(1, 1));
  quad.userData.infinite = true;
  quad.userData.uRadius = { value: 0 };
  scene.add(quad);

  const cam = { position: new e.THREE.Vector3(1234.5, 30, -876.5) };
  const g = e.updateFloorGrid(scene, quad, cam, 14, true);

  assert.equal(g, quad, 'RIEN n est reconstruit : il n y a pas de decade a franchir');
  assert.equal(g.position.x, 1234.5, 'le quad est pose SOUS la camera, sans aimantation');
  assert.equal(g.position.z, -876.5);
  assert.equal(g.scale.x, e.gridFadeRadius(30) * 2, 'et etale assez pour que son bord reste dans le fondu');
  assert.equal(g.userData.uRadius.value, e.gridFadeRadius(30), 'le shader recoit le meme rayon');
});

test('le rayon du quad suit l eloignement, jamais zero', () => {
  const e = neuf();
  assert.ok(e.gridFadeRadius(100) > e.gridFadeRadius(10));
  assert.ok(e.gridFadeRadius(0) > 0, 'camera collee au sol : un quad de taille nulle ne montrerait rien');
});

test('le pas suit l eloignement, par decade et sur des coordonnees rondes', () => {
  const e = neuf();
  assert.equal(e.gridStepFor(14), 1, 'la distance d orbite par defaut garde le pas metrique');
  assert.equal(e.gridStepFor(100), 10);
  assert.equal(e.gridStepFor(1), 0.1);
  assert.ok(e.gridStepFor(1e9) <= 1000, 'le pas est borne : pas de grille de taille infinie');
  assert.ok(e.gridStepFor(0) >= 0.01, 'et borne en bas : une camera collee au sol ne le fait pas exploser');
});

test('la grille est AIMANTEE sur son pas : sans ca elle glisse et scintille', () => {
  const e = neuf();
  assert.equal(e.gridSnap(103.7, 10), 100);
  assert.equal(e.gridSnap(-4.4, 1), -4);
  assert.equal(e.gridSnap(7, 0), 7, 'un pas nul ne divise pas par zero');
});

test('la grille SUIT la camera — c est ce qui la rend sans bord', () => {
  const e = neuf();
  const scene = new e.THREE.Scene();
  let g = e.buildFloorGrid(1);
  scene.add(g);
  const cam = { position: new e.THREE.Vector3(500, 12, -320) };

  g = e.updateFloorGrid(scene, g, cam, 14, true);

  assert.equal(g.position.x, 500, 'recentree sous la camera');
  assert.equal(g.position.z, -320);
  assert.ok(g.position.y > 0, 'juste au-dessus du plan, pour ne pas z-fighter avec un sol pose a 0');
});

test('changer de decade RECONSTRUIT le helper et libere l ancien', () => {
  const e = neuf();
  const scene = new e.THREE.Scene();
  let g = e.buildFloorGrid(1);
  scene.add(g);
  const ancienne = g;
  let libere = false;
  g.geometry.dispose = function(){ libere = true; };
  const cam = { position: new e.THREE.Vector3(0, 400, 0) };

  g = e.updateFloorGrid(scene, g, cam, 400, true);

  assert.notEqual(g, ancienne, 'un GridHelper ne change pas de taille : il est remplace');
  assert.equal(g.userData.step, 10);
  assert.ok(libere, 'l ancienne geometrie est liberee');
  assert.equal(scene.children.indexOf(ancienne), -1, 'et l ancienne quitte la scene');
  assert.notEqual(scene.children.indexOf(g), -1);
});

test('la meme decade NE reconstruit PAS : sinon on recreerait un helper par image', () => {
  const e = neuf();
  const scene = new e.THREE.Scene();
  let g = e.buildFloorGrid(1);
  scene.add(g);
  const cam = { position: new e.THREE.Vector3(3, 10, 3) };

  const a = e.updateFloorGrid(scene, g, cam, 14, true);
  cam.position.set(4, 11, 5);
  const b = e.updateFloorGrid(scene, a, cam, 15, true);

  assert.equal(a, b);
  assert.equal(scene.children.length, 1);
});

test('grille eteinte : invisible, et on ne touche plus a rien', () => {
  const e = neuf();
  const scene = new e.THREE.Scene();
  let g = e.buildFloorGrid(1);
  scene.add(g);
  g.position.set(42, 0.001, 42);

  g = e.updateFloorGrid(scene, g, { position: new e.THREE.Vector3(0, 900, 0) }, 900, false);

  assert.equal(g.visible, false);
  assert.equal(g.position.x, 42, 'aucune reconstruction ni recentrage quand elle est eteinte');
});

test('AUCUN sol implicite : ni l editeur ni le jeu publie ne posent de plan a y=0', () => {
  // Une garde de SOURCE, et non de comportement : demarrer cannon dans le harnais demanderait
  // tout le moteur. Ce qu on veut empecher est exactement ce motif — un CANNON.Plane statique
  // ajoute au monde sans qu aucun objet de la scene ne le porte.
  ['js/physics.js', 'js/game-runtime.js'].forEach((f) => {
    const src = readFileSync(path.join(racineMoteur, f), 'utf8');
    assert.equal(src.indexOf('new CANNON.Plane()'), -1,
      f + ' : un plan de collision implicite est revenu — une scene vide doit rester vide');
  });
});
