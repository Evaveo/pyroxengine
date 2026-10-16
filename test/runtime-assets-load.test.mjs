// moteur/test/runtime-assets-load.test.mjs — chargement et libération des ressources du jeu
// publié (js/game-runtime.js) : chargement parallèle borné qui garde l'ordre du fichier, parse des
// modèles sérialisé (shareBlobs est global), libération des clones de textures et géométries
// propres à une scène, et lecture du seul préfixe d'un .glb au build (js/build.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deEsm } from './engine-env.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = (n) => readFileSync(path.join(root, n), 'utf8').replace(/\r\n/g, '\n');
const rt = source('js/game-runtime.js');

// Une fonction (ou constante) de premier niveau du runtime, par son en-tête jusqu'au `}` de colonne 0.
function topLevel(head){
  const i = rt.indexOf(head);
  assert.ok(i >= 0, 'introuvable : ' + head);
  const j = rt.indexOf('\n}\n', i);
  return rt.slice(i, j + 2);
}
const line = (head) => { const i = rt.indexOf(head); return rt.slice(i, rt.indexOf('\n', i)); };

function loadContext(extra){
  const ctx = vm.createContext(Object.assign({console, setTimeout, Promise, Object, Array, Set, Map}, extra));
  vm.runInContext([
    line('const RT_LOAD_POOL'), 'let rtModelQueue = Promise.resolve();',
    topLevel('function rtSerialModel('), topLevel('async function rtRunPool('),
    topLevel('async function loadAssets(){')
  ].join('\n'), ctx);
  return ctx;
}

test('loadAssets : parallèle borné, mais assetsById reçoit les assets dans l ordre du fichier', async () => {
  const log = [];
  let inFlight = 0, maxInFlight = 0;
  const das = [];
  for(let k = 0; k < 12; k++) das.push({id: 'a' + k, name: 'n' + k, kind: 'x', delay: (12 - k) * 2});
  const ctx = loadContext({
    D: {assets: das}, assetsById: {}, progress: (t) => log.push(t),
    compressionAvailable: () => true, console: {warn(){}, log(){}}, decodersMissing: () => [], showError(){},
    applyMaterialsModelRt(){}, buildList: () => ({racines: []}), THREE: {Object3D: class {}},
    async loadOneAsset(da, put, later){
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, da.delay));   // les premiers finissent en DERNIER
      inFlight--;
      if(da.id === 'a3') throw new Error('panne');
      put(da.id, {name: da.name});
      // un « clip » qui ne doit pas écraser un asset déjà présent (règle des modèles)
      later(() => { if(!ctx.assetsById.a5) ctx.assetsById.a5 = {clip: da.id}; });
    }
  });
  await vm.runInContext('loadAssets()', ctx);
  const ids = Object.keys(ctx.assetsById);
  // exactement l'ordre d'un chargement séquentiel : a0, puis le « clip » a5 posé par a0, puis la suite
  assert.deepEqual(ids, ['a0', 'a5', 'a1', 'a2', 'a4', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11'],
    'ordre d insertion = ordre du fichier');
  assert.ok(!('a3' in ctx.assetsById), 'un asset en échec est ignoré');
  assert.ok(maxInFlight > 1 && maxInFlight <= 4, 'parallèle, et borné à RT_LOAD_POOL : ' + maxInFlight);
  // a0 a posé le « clip » a5 avant que a5 ne soit commis : comme en séquentiel, a5 l'emporte
  assert.deepEqual(ctx.assetsById.a5, {name: 'n5'});
  assert.match(log[log.length - 1], /12\/12/, 'progression n/total');
});

test('rtSerialModel : un parse de modèle à la fois, même si l un échoue', async () => {
  const ctx = loadContext({});
  let active = 0, max = 0;
  const job = (fail) => () => vm.runInContext('rtSerialModel', ctx)(async () => {
    active++; max = Math.max(max, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    if(fail) throw new Error('x');
    return 1;
  });
  const res = await Promise.allSettled([job(false)(), job(true)(), job(false)()]);
  assert.equal(max, 1);
  assert.deepEqual(res.map((r) => r.status), ['fulfilled', 'rejected', 'fulfilled']);
  // le modèle passe bien shareBlobs → parse sous le verrou
  const one = topLevel('async function loadOneAsset(');
  assert.ok(one.indexOf('await rtSerialModel(') < one.indexOf('shareBlobs(blobs)'));
  assert.ok(one.indexOf('b64InBlob(fe)') < one.indexOf('await rtSerialModel('), 'téléchargement hors verrou');
});

test('rtDisposeScene : libère clones et géométries de la scène, jamais ce qui ressert', () => {
  const released = [];
  const res = (n, extra) => Object.assign({name: n, dispose(){}}, extra);
  const assetTex = res('assetTex', {isTexture: true});
  const tplGeo = res('tplGeo'), tplMat = res('tplMat', {map: res('tplClone', {isTexture: true})});
  const prim = res('prim', {userData: {sharedPrimitive: 'cube'}});
  const sceneClone = res('sceneClone', {isTexture: true});
  const sceneMat = res('sceneMat', {map: sceneClone, normalMap: assetTex});
  const terrainGeo = res('terrainGeo');
  const mesh = (geometry, material) => ({isMesh: true, geometry, material});
  const objs = [mesh(prim, sceneMat), mesh(tplGeo, tplMat), mesh(terrainGeo, [sceneMat]),
    {isLight: true, shadow: {map: res('shadow')}}];
  const tree = (list) => ({traverse(f){ list.forEach(f); }});
  const ctx = vm.createContext({
    releaseLater: (r) => released.push(r.name),
    sharedKindOf: (g) => (g && g.userData && g.userData.sharedPrimitive) || '',
    assetsById: {t: {texture: assetTex}, m: {template: tree([mesh(tplGeo, tplMat)])}},
    Array, Set, Object
  });
  vm.runInContext([line('const RT_TEXTURE_KEYS'), rt.slice(rt.indexOf('const RT_TEXTURE_KEYS') + line('const RT_TEXTURE_KEYS').length + 1,
    rt.indexOf('function rtProtectedResources')),
  topLevel('function rtProtectedResources('), topLevel('function rtDisposeScene(')].join('\n'), ctx);
  ctx.scene = tree(objs);
  vm.runInContext('rtDisposeScene(scene)', ctx);
  assert.deepEqual(released.sort(), ['sceneClone', 'sceneMat', 'shadow', 'terrainGeo']);
});

test('changement de scène : particules libérées en différé, jamais en immédiat', () => {
  // Depuis la v1.21.0, la libération passe par le système partagé (js/particle-system.js), qui
  // rend géométrie et matériau à l'HÔTE : côté jeu, l'hôte diffère (releaseLater).
  assert.ok(!/s\.geo\.dispose\(\)/.test(rt) && !/s\.objet3d\.material\.dispose\(\)/.test(rt));
  assert.match(rt, /release: function\(x\)\{ releaseLater\(x\); \}/);
  assert.match(rt, /game\.particles\.forEach\(function\(s\)\{ disposeParticleSystem\(s\); \}\);/);
  const ps = readFileSync(path.join(root, 'js/particle-system.js'), 'utf8');
  assert.match(ps, /rel\(sys\.geo\); rel\(sys\.mat\);/);
});

test('démarrage : précompilation des shaders avant le retrait du voile, jamais bloquante', () => {
  const warm = topLevel('async function rtWarmShaders(');
  assert.match(warm, /typeof renderer\.compileAsync !== 'function'\) return/);
  assert.match(warm, /Promise\.race/);
  assert.match(warm, /catch\(e\)/);
  assert.ok(rt.indexOf('await rtWarmShaders();') < rt.indexOf("$('rj-loading').style.display = 'none';",
    rt.indexOf('await rtWarmShaders();') - 400));
});

test('build : decodersNeeded ne décode que l en-tête + JSON d un .glb', () => {
  const bac = {console, TextDecoder, Uint8Array, DataView, ArrayBuffer, Math, JSON, Object, Array,
    String, Set, Infinity, window: {}, self: {}, navigator: {userAgent: 'node'},
    document: {createElement: () => ({getContext: () => null, style: {}}), createElementNS: () => ({})}};
  let decodedChars = 0;
  bac.atob = (s) => { decodedChars += s.length; return atob(s); };
  bac.window = bac; bac.self = bac; bac.globalThis = bac;
  const ctx = vm.createContext(bac);
  vm.runInContext(deEsm(source('vendor/three.min.js')), ctx);
  vm.runInContext(deEsm(source('js/asset-compression.js')), ctx);
  vm.runInContext('function escapeHtml(s){ return String(s); }', ctx);
  vm.runInContext(deEsm(source('js/build.js')), ctx, {filename: 'js/build.js'});
  const glb = readFileSync(path.join(root, 'test/fixtures-compression/quad-draco.glb'));
  const b64 = glb.toString('base64');
  ctx.D_DRACO = {assets: [{kind: 'model', files: [{name: 'm.glb', b64: 'data:application/octet-stream;base64,' + b64}]}]};
  decodedChars = 0;
  assert.deepEqual(Array.from(vm.runInContext('decodersNeeded(D_DRACO)', ctx)), ['vendor/three-draco.min.js']);
  const jsonLen = glb.readUInt32LE(12);
  assert.ok(decodedChars < b64.length, 'pas de décodage complet : ' + decodedChars + ' / ' + b64.length);
  ctx.B64 = b64;
  assert.equal(vm.runInContext('glbHeadBytes(B64).length', ctx), 20 + jsonLen);
  assert.deepEqual(Array.from(vm.runInContext('base64Prefix(B64, 7)', ctx)), Array.from(glb.subarray(0, 7)));
});
