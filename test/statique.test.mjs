// moteur/test/statique.test.mjs — les objets « Statique » (js/static-batching.js, v1.13.0).
//
// Ce que le drapeau promet dans le jeu publié, mesuré sans navigateur (harnais node:vm) :
//   · le fichier de projet le garde (écrit seulement quand il est vrai, relu par les DEUX moteurs) ;
//   · les maillages statiques au matériau final identique partagent UNE instance, pas les autres ;
//   · la fusion produit le bon nombre de maillages, masque les sources, garde leur uv1 d'atlas,
//     respecte les ombres et le plafond de sommets ;
//   · le regroupement en instances (js/render-perf.js) ignore les sources fondues ;
//   · la cuisson ne cuit que les statiques dès qu'il y en a un ;
//   · la garde des scripts prévient UNE fois par objet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { creerContexte } from './engine-env.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');

const run = (code, ctx) => JSON.parse(JSON.stringify(vm.runInContext(code, ctx)));

function contexte(){
  return creerContexte(['js/primitive-geometry.js', 'js/lightmap-unwrap.js',
    'js/lightmap-atlas.js', 'js/render-perf.js', 'js/static-batching.js']);
}

test('le fichier de projet écrit `static` seulement quand il est vrai, et les deux moteurs le relisent', () => {
  const ser = read('js/serialization.js');
  const corps = ser.slice(ser.indexOf('export function serializeObject'), ser.indexOf('function serializeTree'));
  assert.match(corps, /static: \(o\.userData\.static === true\) \? true : undefined,/);
  const rebuild = ser.slice(ser.indexOf('function rebuildTree'));
  assert.match(rebuild, /if\(d\.static === true\) o\.userData\.static = true;/);
  assert.match(read('js/game-runtime.js'), /if\(d\.static === true\) o\.userData\.static = true;/);
});

test('aller-retour JSON : vrai survit, faux et absent ne laissent rien', () => {
  const ctx = contexte();
  const r = run(`
    // La même expression que serializeObject, puis la même lecture que rebuildTree/buildList.
    function write(o){ return JSON.parse(JSON.stringify({name:o.name, static:(o.userData.static === true) ? true : undefined})); }
    function readBack(d){ const o = new THREE.Object3D(); if(d.static === true) o.userData.static = true; return o; }
    const a = new THREE.Object3D(); a.userData.static = true;
    const b = new THREE.Object3D();
    const da = write(a), db = write(b);
    ({aKey: 'static' in da, bKey: 'static' in db, aBack: isStatic(readBack(da)), bBack: isStatic(readBack(db))});
  `, ctx);
  assert.deepEqual(r, {aKey: true, bKey: false, aBack: true, bBack: false});
});

const SCENE = `
  function cube(x, z, mat, opts){
    opts = opts || {};
    const o = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat || new THREE.MeshStandardMaterial({color: 0x336699}));
    o.position.set(x, 0, z);
    o.userData.components = [];
    if(opts.static !== false) o.userData.static = true;
    o.castShadow = opts.cast !== false; o.receiveShadow = true;
    o.name = opts.name || ('c' + x + '_' + z);
    return o;
  }
`;

test('les statiques au matériau identique partagent UNE instance ; les non-statiques gardent la leur', () => {
  const ctx = contexte();
  const r = run(SCENE + `
    const scn = new THREE.Scene(), objs = [];
    for(let i = 0; i < 6; i++){ const o = cube(i * 2, 0); scn.add(o); objs.push(o); }
    for(let i = 0; i < 3; i++){ const o = cube(i * 2, 5, null, {static:false}); scn.add(o); objs.push(o); }
    const st = buildStaticScene(scn, objs, {});
    const statMats = new Set(objs.slice(0, 6).map((o) => o.material));
    const dynMats = new Set(objs.slice(6).map((o) => o.material));
    ({stat: statMats.size, dyn: dynMats.size, shared: st.shared});
  `, ctx);
  assert.equal(r.stat, 1, 'six statiques identiques : une seule instance de matériau');
  assert.equal(r.dyn, 3, 'les non-statiques gardent chacun leur matériau');
  assert.equal(r.shared, 5);
});

test('deux couleurs différentes ne partagent pas ; un matériau de plugin ne se partage jamais', () => {
  const ctx = contexte();
  const r = run(SCENE + `
    const scn = new THREE.Scene();
    const a = cube(0, 0, new THREE.MeshStandardMaterial({color: 0xff0000}));
    const b = cube(2, 0, new THREE.MeshStandardMaterial({color: 0x00ff00}));
    const p1 = cube(4, 0); p1.userData.materialId = 'mp';
    const p2 = cube(6, 0); p2.userData.materialId = 'mp';
    [a, b, p1, p2].forEach((o) => scn.add(o));
    const asset = {id: 'mp', props: {materialPlugin: 'toon'}};
    buildStaticScene(scn, [a, b, p1, p2], {assetOf: (x) => x.userData.materialId ? asset : null});
    ({ab: a.material === b.material, plug: p1.material === p2.material});
  `, ctx);
  assert.equal(r.ab, false);
  assert.equal(r.plug, false);
});

test('fusion : un maillage par groupe, sources masquées mais gardées, ombres respectées', () => {
  const ctx = contexte();
  const r = run(SCENE + `
    const scn = new THREE.Scene(), objs = [];
    const mat = new THREE.MeshStandardMaterial();
    for(let i = 0; i < 4; i++){ const o = cube(i * 2, 0, mat); scn.add(o); objs.push(o); }
    // même matériau, mais sans ombre projetée : un autre groupe
    for(let i = 0; i < 3; i++){ const o = cube(i * 2, 3, mat, {cast:false}); scn.add(o); objs.push(o); }
    const st = buildStaticScene(scn, objs, {});
    ({
      merged: st.meshes.length,
      casts: st.meshes.map((m) => m.castShadow).sort(),
      hidden: objs.every((o) => o.visible === false && o.userData.inStaticMerge),
      intent: objs.every((o) => visibleIntent(o) === true),
      stillInScene: objs.every((o) => o.parent === scn),
      vertices: st.meshes.map((m) => m.geometry.attributes.position.count).sort((a, b) => a - b),
      frozen: objs.every((o) => o.matrixAutoUpdate === false),
      instanced: instantiable(objs[0])
    });
  `, ctx);
  assert.equal(r.merged, 2);
  assert.deepEqual(r.casts, [false, true]);
  assert.ok(r.hidden, 'les sources fondues ne se dessinent plus elles-mêmes');
  assert.ok(r.intent, 'l intention de visibilité reste « visible »');
  assert.ok(r.stillInScene, 'les sources restent dans le graphe (scripts, colliders)');
  assert.deepEqual(r.vertices, [72, 96]);
  assert.ok(r.frozen, 'matrices figées');
  assert.equal(r.instanced, false, 'une source fondue ne part pas en plus dans un InstancedMesh');
});

test('fusion : la géométrie est en coordonnées monde, et l uv1 d atlas de chaque source survit', () => {
  const ctx = contexte();
  const r = run(SCENE + `
    const scn = new THREE.Scene(), objs = [];
    const mat = new THREE.MeshStandardMaterial();
    for(let i = 0; i < 2; i++){
      const o = cube(i * 10, 0, mat);
      o.userData.lightmapAtlas = [{game:'auto', scale:[0.1, -0.1], offset:[i * 0.5, 1], pad:0.01}];
      reapplyAtlasLightmap(o);
      scn.add(o); objs.push(o);
    }
    const uvA = Array.from(objs[0].geometry.attributes.uv1.array.slice(0, 2));
    const uvB = Array.from(objs[1].geometry.attributes.uv1.array.slice(0, 2));
    const nA = objs[0].geometry.attributes.position.count;
    const st = buildStaticScene(scn, objs, {});
    const g = st.meshes[0].geometry;
    g.computeBoundingBox();
    ({
      n: st.meshes.length,
      hasUv1: !!g.attributes.uv1,
      uvA: Array.from(g.attributes.uv1.array.slice(0, 2)), refA: uvA,
      uvB: Array.from(g.attributes.uv1.array.slice(nA * 2, nA * 2 + 2)), refB: uvB,
      maxX: g.boundingBox.max.x
    });
  `, ctx);
  assert.equal(r.n, 1);
  assert.ok(r.hasUv1);
  assert.deepEqual(r.uvA, r.refA);
  assert.deepEqual(r.uvB, r.refB);
  assert.ok(Math.abs(r.maxX - 10.5) < 1e-5, 'le second cube est à x = 10 en monde');
});

test('fusion : le plafond de sommets découpe en morceaux, et les cellules séparent le lointain', () => {
  const ctx = contexte();
  const r = run(SCENE + `
    const scn = new THREE.Scene(), objs = [];
    const mat = new THREE.MeshStandardMaterial();
    for(let i = 0; i < 10; i++){ const o = cube(i, 0, mat); scn.add(o); objs.push(o); }
    // deux cubes à 500 unités : une autre cellule
    for(let i = 0; i < 2; i++){ const o = cube(500 + i, 0, mat); scn.add(o); objs.push(o); }
    const st = buildStaticScene(scn, objs, {maxVertices: 24 * 4});
    ({n: st.meshes.length, max: Math.max(...st.meshes.map((m) => m.geometry.attributes.position.count))});
  `, ctx);
  // 10 cubes de 24 sommets, 4 par morceau → 3 morceaux (4+4+2), plus 1 pour la cellule lointaine
  assert.equal(r.n, 4);
  assert.ok(r.max <= 96);
});

test('exclusions : transparent, dynamique, parent d un enfant non statique, invisible', () => {
  const ctx = contexte();
  const r = run(SCENE + `
    const scn = new THREE.Scene(), objs = [];
    const mat = new THREE.MeshStandardMaterial();
    const t1 = cube(0, 0, new THREE.MeshStandardMaterial({transparent:true, opacity:0.5}));
    const t2 = cube(1, 0, t1.material);
    const d1 = cube(2, 0, mat); d1.userData.phys = {active:true, masse:1};
    const p = cube(3, 0, mat); const child = cube(0, 2, mat, {static:false}); p.add(child);
    const inv = cube(4, 0, mat); inv.visible = false;
    const ok1 = cube(5, 0, mat), ok2 = cube(6, 0, mat);
    [t1, t2, d1, p, inv, ok1, ok2].forEach((o) => { scn.add(o); objs.push(o); });
    objs.push(child);
    const st = buildStaticScene(scn, objs, {});
    ({n: st.meshes.length, merged: objs.filter((o) => o.userData.inStaticMerge).map((o) => o.name),
      skipped: st.skipped.map((s) => s.reason), dynFrozen: !!d1.userData.staticFrozen,
      childVisible: child.visible && p.visible});
  `, ctx);
  assert.equal(r.n, 1);
  assert.deepEqual(r.merged, ['c5_0', 'c6_0']);
  assert.deepEqual(r.skipped, ['corps physique dynamique']);
  assert.equal(r.dynFrozen, false, 'un corps dynamique n est pas figé');
  assert.ok(r.childVisible, 'un parent n est pas masqué au risque de cacher un enfant non fondu');
});

test('setVisibleIntent et la destruction écrasent la plage de la source dans le maillage fusionné', () => {
  const ctx = contexte();
  const r = run(SCENE + `
    const scn = new THREE.Scene(), objs = [];
    const mat = new THREE.MeshStandardMaterial();
    for(let i = 0; i < 2; i++){ const o = cube(i * 4, 0, mat); scn.add(o); objs.push(o); }
    const st = buildStaticScene(scn, objs, {});
    const pos = st.meshes[0].geometry.attributes.position;
    const n = objs[0].geometry.attributes.position.count;
    const before = pos.array.slice(0, n * 3);
    setVisibleIntent(objs[0], false);
    let collapsed = true;
    for(let i = 3; i < n * 3; i += 3) if(pos.array[i] !== pos.array[0]) collapsed = false;
    const stillHidden = objs[0].visible === false;
    setVisibleIntent(objs[0], true);
    const restored = before.every((v, i) => v === pos.array[i]);
    const touched = refreshStaticVisibility(objs[1], true);
    ({collapsed, stillHidden, restored, touched, intent: visibleIntent(objs[0])});
  `, ctx);
  assert.ok(r.collapsed, 'masquer écrase les sommets de la source');
  assert.ok(r.stillHidden, 'la source fondue reste visible = false (le fusionné la dessine)');
  assert.ok(r.restored, 'réafficher repose les sommets d origine');
  assert.equal(r.touched, 1);
  assert.equal(r.intent, true);
});

test('la cuisson ne cuit que les statiques dès qu il y en a un, tout sinon', () => {
  const ctx = contexte();
  const r = run(`
    const a = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    const b = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    const none = bakeSelectionStatic([a, b], [a, b]);
    a.userData.static = true;
    const some = bakeSelectionStatic([a, b], [a, b]);
    ({none: [none.mode, none.meshes.length], some: [some.mode, some.meshes.length, some.meshes[0] === a]});
  `, ctx);
  assert.deepEqual(r.none, ['all', 2]);
  assert.deepEqual(r.some, ['static', 1, true]);
  assert.match(read('js/lightmap-bake.js'), /: bakeSelectionStatic\(meshesBakeable\(null\), objects\);/);
});

test('la garde des scripts prévient une fois par objet', () => {
  const ctx = contexte();
  const warns = [];
  ctx.console = {warn: (m) => warns.push(m), log(){}, error(){}, info(){}};
  const r = run(`
    const o = new THREE.Object3D(); o.name = 'Mur';
    o.userData.staticFrozen = true;
    const free = new THREE.Object3D();
    [staticBlocked(o), staticBlocked(o), staticBlocked(o), staticBlocked(free)];
  `, ctx);
  assert.deepEqual(Array.from(r), [true, true, true, false]);
  assert.equal(warns.length, 1);
  assert.match(warns[0], /« Mur » est Statique : modification ignorée dans le jeu publié \(décochez Statique pour le déplacer\)/);
});

test('le jeu publié branche les gardes et la préparation de scène', () => {
  const rt = read('js/game-runtime.js');
  assert.match(rt, /game\.staticScene = buildStaticScene\(game\.scene, game\.objects/);
  assert.match(rt, /undoStaticScene\(game\.staticScene\)/);
  assert.match(rt, /if\(staticBlocked\(c\)\) return c;/);
  assert.match(rt, /refreshStaticVisibility\(target, true\)/);
  // La préparation vient AVANT le regroupement en instances.
  assert.ok(rt.indexOf('game.staticScene = buildStaticScene') < rt.indexOf("instantiateStatic(game.scene, game.objects)"));
  assert.match(read('js/build.js'), /\{src: 'js\/static-batching\.js'\}/);
});

test('appliquer aux enfants : marque les nœuds de la branche, pas les nœuds de modèle', () => {
  const ctx = contexte();
  const r = run(`
    const root = new THREE.Object3D(); root.userData.components = [];
    const a = new THREE.Object3D(); a.userData.components = []; root.add(a);
    const b = new THREE.Object3D(); b.userData.components = []; a.add(b);
    const m = new THREE.Object3D(); m.userData.components = []; m.userData.modelNode = 'n0'; root.add(m);
    const n = setStaticFlag(root, true, true);
    ({n, a: isStatic(a), b: isStatic(b), m: isStatic(m), mEff: staticOf(m)});
  `, ctx);
  assert.deepEqual(r, {n: 3, a: true, b: true, m: false, mEff: true});
});
