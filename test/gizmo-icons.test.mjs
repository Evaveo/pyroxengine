// moteur/test/gizmo-icons.test.mjs
//
// LES ICÔNES D'ÉDITION ET LES GIZMOS DE SÉLECTION (js/gizmo-icons.js), comme la vue Scène d'Unity.
//
// Ce qui se teste sans moteur de rendu, et qui peut se tromper sans qu'aucune image ne paraisse
// fausse au premier coup d'œil :
//   1. les RÈGLES DE VISIBILITÉ — une icône pour tout objet d'édition, ses gizmos (cône, frustum,
//      sphère d'influence) à la sélection SEULEMENT ;
//   2. le FONDU — pleine de près, effacée au loin, plus cliquable une fois effacée ;
//   3. AUCUNE OMBRE — ni le repère 3D d'une lampe (la tache au centre du cône d'un spot), ni la
//      sphère d'une sonde, ni une icône ; la carte d'ombre d'une lampe ne voit plus le calque des
//      aides, quelle que soit la caméra qui rend ;
//   4. RIEN DE SÉRIALISÉ — les icônes vivent sous leur propre racine, jamais sous un nœud ;
//   5. la sélection AU CLIC passe par l'icône.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { creerContexte } from './engine-env.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

function context(){
  const ctx = creerContexte(['js/component-registry.js', 'js/component.js', 'js/node.js',
    'js/component-data.js', 'js/components/component-light.js',
    'js/components/component-reflection.js', 'js/editor-overlay.js', 'js/gizmo-icons.js']);
  vm.runInContext(`
    function removeHelper(){}
    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(60, 16/9, 0.1, 1000);
    camera.layers.enableAll();               // la caméra d'édition voit tout, calque 31 compris
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    // Un nœud de lampe COMME APRÈS LA RELECTURE D'UN FICHIER : le maillage repère, avec
    // castShadow = true (serialization.js relit « ombreProjetee », vrai par défaut) et sur le
    // calque 0 — tout ce qui faisait la tache d'ombre au centre du cône.
    function lightNode(subType){
      const n = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.6, 8), new THREE.MeshStandardMaterial({}));
      n.userData.type = 'group';
      n.castShadow = true; n.receiveShadow = true;
      applyNodeMixin(n);
      n.addComponent('Light', {subType: subType, color: 0xff0000, intensity: 1, range: 20,
                               angle: 0.5, penumbra: 0.2});
      scene.add(n); objects.push(n);
      ed(n).helper = new THREE.Object3D();   // ce que pose createHelperFor (objects.js)
      ed(n).helper.visible = true;
      return n;
    }
    function probeNode(){
      const n = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), new THREE.MeshStandardMaterial({}));
      n.userData.type = 'group';
      n.castShadow = true;
      applyNodeMixin(n);
      n.addComponent('Reflection', {radius: 18});
      scene.add(n); objects.push(n);
      return n;
    }
    function run(selected, settings){
      EditorIcons.sync({scene: scene, camera: camera, viewHeight: 800, layer: 31,
        selected: selected || [], settings: settings || {enabled: true, size: 32, fade: 80}});
    }
    this.api = {scene, camera, lightNode, probeNode, run, EditorIcons,
                ICON_KINDS, ICON_SIZE_DEFAULT, ICON_FADE_DEFAULT, ICON_FADE_START, ICON_SELECTED_SCALE};
  `, ctx);
  return ctx;
}

// ---------- Les fonctions pures ----------

test('chaque genre d icone pointe un glyphe qui EXISTE dans la fonte vendoree, au bon point de code', () => {
  const ctx = context();
  const css = read('vendor/phosphor/phosphor.css');
  const kinds = ctx.api.ICON_KINDS;
  const names = Object.keys(kinds);
  assert.ok(names.length >= 8, 'les huit genres attendus : ' + names.join(', '));
  names.forEach((k) => {
    const i = css.indexOf('.ph-fill.ph-' + kinds[k].glyph + ':before');
    assert.notEqual(i, -1, k + ' : « ' + kinds[k].glyph + ' » absent de Phosphor-Fill');
    const m = css.slice(i, i + 80).match(/content:\s*"\\([0-9a-f]+)"/);
    assert.equal(parseInt(m[1], 16), kinds[k].code, k + ' : point de code faux pour ' + kinds[k].glyph);
  });
});

test('le genre d une icone vient du composant que porte le noeud', () => {
  const ctx = context();
  const spot = ctx.api.lightNode('spot'), point = ctx.api.lightNode('point');
  const sun = ctx.api.lightNode('directional'), probe = ctx.api.probeNode();
  assert.equal(ctx.iconKindOf(spot), 'light-spot');
  assert.equal(ctx.iconKindOf(point), 'light-point');
  assert.equal(ctx.iconKindOf(sun), 'light-directional');
  assert.equal(ctx.iconKindOf(probe), 'probe');
  const fake = (types) => ({getComponent: (t) => (types.includes(t) ? {} : null), userData: {}});
  assert.equal(ctx.iconKindOf(fake(['Camera'])), 'camera');
  assert.equal(ctx.iconKindOf(fake(['PostVolume'])), 'post-volume');
  assert.equal(ctx.iconKindOf(fake(['AudioSource', 'Mesh'])), 'audio');
  assert.equal(ctx.iconKindOf(fake(['Particles'])), 'particles');
  assert.equal(ctx.iconKindOf(fake(['Mesh'])), null, 'un simple cube n a pas d icone');
});

test('le FONDU : pleine jusqu a 70 %, nulle a la distance de fondu, lineaire entre les deux', () => {
  const ctx = context();
  const f = (d, fade) => ctx.iconOpacity(d, fade);
  assert.equal(ctx.api.ICON_FADE_START, 0.7);
  assert.equal(f(0, 80), 1);
  assert.equal(f(56, 80), 1, 'a 70 % elle est encore pleine');
  assert.ok(Math.abs(f(68, 80) - 0.5) < 1e-9, 'a mi-chemin du fondu, demi-opacite');
  assert.equal(f(80, 80), 0);
  assert.equal(f(500, 80), 0);
  assert.equal(f(5000, 0), 1, 'zero : jamais de fondu');
});

test('la TAILLE A L ECRAN est constante : la taille monde suit la profondeur, pas en orthographique', () => {
  const ctx = context();
  const persp = ctx.api.camera;
  const near = ctx.iconWorldSize(persp, 5, 32, 800), far = ctx.iconWorldSize(persp, 50, 32, 800);
  assert.ok(Math.abs(far / near - 10) < 1e-9, 'dix fois plus loin, dix fois plus grande en monde');
  // 32 px sur 800 de haut, champ vertical 60° : 32/800 de la hauteur du frustum a cette profondeur.
  assert.ok(Math.abs(near - 32 / 800 * 2 * 5 * Math.tan(Math.PI / 6)) < 1e-9);
  const ortho = vm.runInContext('new THREE.OrthographicCamera(-8, 8, 4.5, -4.5, 0.1, 100)', ctx);
  assert.equal(ctx.iconWorldSize(ortho, 5, 32, 800), ctx.iconWorldSize(ortho, 90, 32, 800));
});

test('les preferences portent les memes defauts que le module', () => {
  const ctx = creerContexte(['js/ui/prefs.js', 'js/editor-overlay.js', 'js/component-data.js',
    'js/component-registry.js', 'js/gizmo-icons.js']);
  const v = JSON.parse(vm.runInContext(`JSON.stringify({
    on: Prefs.get('gizmos.icons'), size: Prefs.get('gizmos.iconSize'), fade: Prefs.get('gizmos.iconFade'),
    defSize: ICON_SIZE_DEFAULT, defFade: ICON_FADE_DEFAULT, st: iconSettings(Prefs),
    cat: Prefs.byCategory('Apparence').map(function(d){ return d.key; })})`, ctx));
  assert.equal(v.on, true);
  assert.equal(v.size, v.defSize);
  assert.equal(v.fade, v.defFade);
  assert.deepEqual(v.st, {enabled: true, size: v.defSize, fade: v.defFade});
  ['gizmos.icons', 'gizmos.iconSize', 'gizmos.iconFade'].forEach((k) => assert.ok(v.cat.includes(k), k));
});

// ---------- Le système, sur de vrais nœuds à composants ----------

test('un objet NON selectionne : une icone, pas de gizmo ; SELECTIONNE : ses gizmos en plus', () => {
  const ctx = context();
  const { run, EditorIcons } = ctx.api;
  const spot = ctx.api.lightNode('spot');
  run([]);
  const e = EditorIcons.icons.get(spot);
  assert.ok(e, 'aucune icone pour le spot');
  assert.equal(e.kind, 'light-spot');
  assert.equal(e.sprite.visible, true);
  assert.equal(e.sprite.layers.mask >>> 0, (1 << 31) >>> 0, 'l icone vit sur le calque des aides, et lui seul');
  assert.equal(vm.runInContext('ed', ctx)(spot).helper.visible, false,
    'le cone du spot ne doit pas s afficher tant qu il n est pas selectionne');
  const size0 = e.sprite.scale.x;

  run([spot]);
  assert.equal(vm.runInContext('ed', ctx)(spot).helper.visible, true, 'selectionne : son cone s affiche');
  assert.ok(Math.abs(e.sprite.scale.x / size0 - ctx.api.ICON_SELECTED_SCALE) < 1e-9,
    'l icone de la selection grossit');
  run([]);
  assert.equal(vm.runInContext('ed', ctx)(spot).helper.visible, false, 'deselectionne : il disparait');

  // La teinte suit la couleur de la lampe (rouge), eclaircie.
  assert.ok(e.sprite.material.color.r > e.sprite.material.color.g);
  // Interrupteur general (bouton « Gizmos ») : ni icone, ni gizmo, meme selectionne.
  run([spot], {enabled: false, size: 32, fade: 80});
  assert.equal(e.sprite.visible, false);
  assert.equal(vm.runInContext('ed', ctx)(spot).helper.visible, false);
});

test('la sphere d influence d une sonde n existe qu a la selection, a son rayon', () => {
  const ctx = context();
  const { run, EditorIcons } = ctx.api;
  const probe = ctx.api.probeNode();
  run([]);
  assert.equal(EditorIcons.extras.has(probe), false);
  run([probe]);
  const g = EditorIcons.extras.get(probe);
  assert.ok(g, 'sonde selectionnee sans sphere d influence');
  assert.equal(g.children.length, 1);
  assert.equal(g.children[0].scale.x, 18);
  assert.equal(g.parent, EditorIcons.root, 'le gizmo vit sous la racine des icones, pas sous la sonde');
  run([]);
  assert.equal(EditorIcons.extras.has(probe), false, 'deselectionnee : la sphere disparait');
  // Une source audio spatiale montre ses deux portees.
  const audio = {getComponent: (t) => (t === 'AudioSource' ? {} : null),
                 userData: {audio: {spatial: true, range: 10, distanceMax: 100}}};
  assert.deepEqual(Array.from(ctx.extraRadii(audio), (r) => r.radius), [10, 100]);
  audio.userData.audio.spatial = false;
  assert.equal(ctx.extraRadii(audio).length, 0, 'un son non spatial n a pas de portee');
});

test('le fondu : au loin l icone disparait, et n est plus cliquable', () => {
  const ctx = context();
  const { run, EditorIcons, camera } = ctx.api;
  const point = ctx.api.lightNode('point');
  const ray = () => vm.runInContext(`(function(){
    const r = new THREE.Raycaster();          // calque 0 seulement : l icone est sur le 31
    r.setFromCamera(new THREE.Vector2(0, 0), camera);
    return r; })()`, ctx);
  run([]);
  assert.equal(EditorIcons.pick(ray()), point, 'un clic au centre de l icone selectionne la lampe');
  camera.position.set(0, 0, 200); camera.updateMatrixWorld(true);
  run([]);
  assert.equal(EditorIcons.icons.get(point).sprite.visible, false, 'a 200 m pour un fondu de 80, plus d icone');
  assert.equal(EditorIcons.pick(ray()), null, 'une icone effacee ne se clique plus');
  run([point]);
  assert.equal(EditorIcons.icons.get(point).sprite.visible, true,
    'l icone de l objet SELECTIONNE reste visible au loin : c est elle qu on cherche');
});

test('AUCUNE OMBRE : ni le repere de la lampe, ni la sonde, ni les icones ; la carte d ombre ignore le calque des aides', () => {
  const ctx = context();
  const { run, EditorIcons } = ctx.api;
  const spot = ctx.api.lightNode('spot');
  const probe = ctx.api.probeNode();
  run([spot, probe]);
  [spot, probe].forEach((n) => {
    assert.equal(n.castShadow, false, n.name + ' : le repere projette encore une ombre');
    assert.equal(n.receiveShadow, false);
    assert.equal(n.layers.mask, 0, 'le repere 3D n est plus dessine par AUCUNE camera');
  });
  EditorIcons.root.traverse((o) => assert.equal(o.castShadow, false, 'une aide projette une ombre'));
  const light = vm.runInContext('ed', ctx)(spot).light;
  assert.ok(light.isSpotLight && light.castShadow, 'la lampe elle-meme projette toujours');
  // Le masque d une carte d ombre : celui de la camera qui rend, MOINS le calque 31. C est lui
  // qui faisait entrer le cone repere dans l ombre de son propre spot.
  assert.equal(light.shadow.camera.layers.mask, 0x7fffffff);
  assert.equal(light.shadow.camera.layers.isEnabled(31), false);
  assert.equal(light.shadow.camera.layers.isEnabled(0), true);
});

test('RIEN DE SERIALISE : les icones ne sont jamais sous un noeud, et le noeud n en garde aucune trace', () => {
  const ctx = context();
  const { run, EditorIcons, scene } = ctx.api;
  const spot = ctx.api.lightNode('spot');
  const avant = JSON.stringify(spot.userData.components.map((c) => c.serialize()));
  const enfants = spot.children.length;
  run([spot]);
  assert.equal(spot.children.length, enfants, 'une icone a ete posee SOUS le noeud');
  assert.equal(JSON.stringify(spot.userData.components.map((c) => c.serialize())), avant);
  assert.equal(EditorIcons.root.parent, scene);
  assert.equal(EditorIcons.root.userData.editorFixture, true,
    'sans ce drapeau, newScene() balaie la racine des icones (serialization.js)');
  let sousUnNoeud = false;
  EditorIcons.root.traverse((o) => {
    for(let p = o.parent; p; p = p.parent) if(p.userData && Array.isArray(p.userData.components)) sousUnNoeud = true;
  });
  assert.equal(sousUnNoeud, false);
  // Le noeud quitte la scene : son icone part avec lui.
  scene.remove(spot);
  vm.runInContext('objects.length = 0', ctx);
  run([]);
  assert.equal(EditorIcons.icons.has(spot), false);
  assert.equal(EditorIcons.root.children.length, 0);
});

test('une capture masque icones et gizmos, puis rend tout a l identique', () => {
  const ctx = context();
  const { run, EditorIcons } = ctx.api;
  const spot = ctx.api.lightNode('spot');
  run([spot]);
  const helper = vm.runInContext('ed', ctx)(spot).helper;
  const autre = vm.runInContext('new THREE.Object3D()', ctx);
  let pendant = null;
  const r = EditorIcons.withHidden(() => {
    pendant = [EditorIcons.root.visible, helper.visible, autre.visible];
    return 42;
  }, [autre]);
  assert.equal(r, 42);
  assert.deepEqual(pendant, [false, false, false]);
  assert.deepEqual([EditorIcons.root.visible, helper.visible, autre.visible], [true, true, true]);
});

// ---------- Les branchements, lus au texte ----------

test('les fabriques eteignent leur repere, et les helpers naissent caches', () => {
  const objects = read('js/objects.js');
  const body = (src, name) => src.slice(src.indexOf('export function ' + name), src.indexOf('\n}\n', src.indexOf('export function ' + name)));
  ['makeLight', 'makeCamera'].forEach((f) => assert.match(body(objects, f), /hideEditorMarker\(mesh\)/, f));
  assert.match(body(read('js/probes.js'), 'makeProbe'), /hideEditorMarker\(mesh\)/);
  assert.match(body(read('js/particles.js'), 'makeParticles'), /hideEditorMarker\(mesh\)/);
  assert.match(body(objects, 'createHelperFor'), /h\.visible = false;/,
    'un cone ou un frustum cree visible s afficherait pour toutes les lampes');
  assert.match(body(objects, 'makeCamera'), /objectif\.userData\.editorMarkerPart = true/);
});

test('le viewport vise l icone d abord, et la capture du copilote masque les aides', () => {
  const vp = read('js/viewport.js');
  assert.match(vp, /let keyObj = EditorIcons\.pick\(raycaster\);/);
  assert.match(vp, /EditorIcons\.sync\(/);
  assert.match(vp, /if\(hp\.visible && hp\.update\) hp\.update\(\);/);
  const obs = read('js/copilot-observer.js');
  assert.match(obs, /EditorIcons\.withHidden\(function\(\)\{ renderer\.render\(scene, camCurrent\(\)\); \}, \[tcVisual\]\);/);
  // Le jeu publie ne charge pas ce module : rien de tout ca n y existe.
  assert.equal(read('game-preview.html').indexOf('gizmo-icons'), -1);
  assert.equal(read('js/build.js').indexOf('gizmo-icons'), -1);
});
