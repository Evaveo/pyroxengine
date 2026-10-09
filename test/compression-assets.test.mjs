import { deEsm } from './engine-env.mjs';
// moteur/test/compression-assets.test.mjs
//
// Ces tests DÉCODENT des fichiers réellement compressés — ils ne vérifient pas qu'une
// méthode a été appelée. Les fixtures de test/fixtures-compression/ sont produites par
// gltf-pipeline (Draco), gltfpack (meshopt) et ktx2-encoder (Basis ETC1S) ; les deux glTF
// déclarent leur extension en `extensionsRequired`, donc GLTFLoader DOIT les refuser
// tant que le décodeur n'est pas branché. Ce refus est testé lui aussi : sans lui, un
// test « ça décode » passerait tout aussi bien si les fichiers n'étaient pas compressés.
//
// DEUX CONTRÔLES portent l'essentiel de la valeur :
//   1. `fetch` LÈVE pendant tout le test. Les décodeurs (wasm + glue JS) sont embarqués
//      dans les bundles et déposés dans le hidden de three ; si ce mécanisme cassait, three
//      repartirait sur le réseau et tout échouerait ici. C'est ce qui garantit qu'un jeu
//      publié open en file:// — où fetch() est refusé — voit la même chose.
//   2. Le MÊME fichier KTX2 est transcodé deux fois avec deux GPU simulés différents, et
//      doit sortir dans deux formats différents. Un test à un seul GPU ne distinguerait
//      pas « detectSupport() pilote le transcodage » de « le transcodeur ignore le
//      renderer et sort toujours la même chose ».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const racineMoteur = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = (n) => readFileSync(path.join(racineMoteur, 'test/fixtures-compression', n));
const source = (n) => readFileSync(path.join(racineMoteur, n), 'utf8');

const GLOBAUX = {
  console, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
  WebAssembly, TextDecoder, TextEncoder, atob, btoa, performance, structuredClone,
  AbortController, AbortSignal, Request, Headers, Response,
  Uint8Array, Uint16Array, Uint32Array, Int8Array, Int16Array, Int32Array, Uint8ClampedArray,
  Float32Array, Float64Array, BigInt64Array, BigUint64Array, ArrayBuffer, DataView,
  Math, JSON, Date, Promise, Error, TypeError, RangeError, Object, Array, String, Number,
  Boolean, Function, Symbol, Map, Set, WeakMap, WeakSet, Reflect, Proxy, RegExp,
  isNaN, isFinite, parseInt, parseFloat,
};

// Les décodeurs tournent dans un Worker : three n'a pas de voie synchrone. On en fabrique
// un vrai-faux, qui exécute la source du worker dans un second contexte vm.
// PIÈGE MESURÉ : le worker Draco s'abonne par `onmessage = fn`, le worker Basis par
// `self.addEventListener('message', …)`. Un faux Worker qui n'implémente que l'un des
// deux fait échouer l'autre pour une raison qui n'a rien à voir avec le produit.
function creerContexte(){
  const contenus = new Map();
  let n = 0;

  const bacWorker = (versHote) => {
    const ecouteurs = [];
    const b = { ...GLOBAUX, onmessage: null, postMessage(m){ versHote(m); },
                addEventListener(t, f){ if(t === 'message') ecouteurs.push(f); },
                removeEventListener(t, f){ const i = ecouteurs.indexOf(f); if(i >= 0) ecouteurs.splice(i, 1); },
                navigator: {userAgent: 'node', hardwareConcurrency: 4},
                location: {href: 'blob:test/worker'} };
    b.self = b; b.globalThis = b;
    b._livrer = (m) => { if(b.onmessage) b.onmessage({data: m}); ecouteurs.slice().forEach((f) => f({data: m})); };
    return vm.createContext(b);
  };

  const faux = () => ({getContext: () => null, style: {}, addEventListener(){}, removeEventListener(){},
                       width: 1, height: 1, setAttribute(){}, getBoundingClientRect: () => ({width: 1, height: 1})});
  const bac = { ...GLOBAUX,
    URL: class {
      static createObjectURL(b){ const u = 'blob:test/' + (++n); contenus.set(u, b._p.join('')); return u; }
      static revokeObjectURL(u){ contenus.delete(u); }
      constructor(r, base){ this.href = new URL(r, base).href; }
      toString(){ return this.href; }
    },
    Blob: class { constructor(p){ this._p = p.map(String); } },
    navigator: {userAgent: 'node', platform: 'node', hardwareConcurrency: 4},
    document: {createElement: faux, createElementNS: faux, body: {appendChild(){}}},
  };
  bac.window = bac; bac.self = bac; bac.globalThis = bac;
  bac.Worker = class {
    constructor(url){
      const src = contenus.get(url);
      if(src === undefined) throw new Error('Worker : source introuvable pour ' + url);
      this.onmessage = null; this.onerror = null;
      this._ecouteurs = [];
      const hote = this;
      this._b = bacWorker((m) => {
        if(hote.onmessage) hote.onmessage({data: m});
        hote._ecouteurs.slice().forEach((f) => f({data: m}));
      });
      vm.runInContext(src, this._b);
    }
    addEventListener(t, f){ if(t === 'message') this._ecouteurs.push(f); }
    removeEventListener(t, f){ const i = this._ecouteurs.indexOf(f); if(i >= 0) this._ecouteurs.splice(i, 1); }
    postMessage(m){ this._b._livrer(m); }
    terminate(){}
  };

  const ctx = vm.createContext(bac);
  ['vendor/three.min.js', 'vendor/three-draco.min.js', 'vendor/three-meshopt.min.js',
   'vendor/three-ktx2.min.js', 'js/asset-compression.js'].forEach((f) => {
    vm.runInContext(deEsm(source(f)), ctx, {filename: f});
  });
  // CONTRÔLE : plus aucun accès réseau à partir d'ici.
  vm.runInContext('globalThis.fetch = function(u){ throw new Error("NETWORK INTERDIT : fetch(" + u + ")"); };', ctx);
  return ctx;
}

// Faux renderer WebGL : detectSupport() lit renderer.extensions.has(...).
const RENDERER = `function(formats){ return { isWebGPURenderer:false, extensions:{
  has:function(n){ return formats.indexOf(n) !== -1; },
  get:function(){ return {getSupportedProfiles:function(){ return []; }}; } } }; }`;

function lancer(ctx, body, data){
  Object.assign(ctx, data || {});
  return vm.runInContext(`(async function(){ const faireRenderer = (${RENDERER});\n${body}\n})()`, ctx);
}

function lancerSync(ctx, expression){
  return vm.runInContext(`(function(){ const faireRenderer = (${RENDERER});\nreturn (${expression});\n})()`, ctx);
}

const bytes = (n) => { const b = fixture(n); return new Uint8Array(b).buffer; };

// Un tableau fabriqué DANS le contexte vm a le prototype de CE contexte : deepStrictEqual
// compare les prototypes et refuse deux tableaux pourtant identiques. Piège coûteux —
// l'échec ressemble mot pour mot à une égalité ([-1,1] attendu, [-1,1] obtenu).
const ici = (t) => Array.from(t);

test('le branchement declare exactement les trois extensions couvertes', () => {
  const ctx = creerContexte();
  const branches = lancerSync(ctx,
    'bindDecoders(new THREE.GLTFLoader(), faireRenderer([]))');
  assert.deepStrictEqual(ici(branches).sort(),
    ['EXT_meshopt_compression', 'KHR_draco_mesh_compression', 'KHR_texture_basisu'],
    'les trois bundles sont chargés : les trois extensions doivent être branchées');
});

test('un renderer pas encore initialise ne fait pas tomber les AUTRES decodeurs', () => {
  // MESURÉ, pas supposé : WebGPURenderer.hasFeature() LÈVE tant que renderer.init()
  // (asynchrone) n'a pas résolu — « .hasFeature() called before the backend is
  // initialized ». Or loadAssets() du runtime démarre sans l'attendre. Si cette
  // exception remontait, le jeu publié perdrait TOUS ses modèles, y compris ceux qui
  // n'utilisent aucune texture KTX2.
  const ctx = creerContexte();
  const branches = vm.runInContext(`
    const pasPret = { isWebGPURenderer: true,
      hasFeature: function(){ throw new Error('.hasFeature() called before the backend is initialized'); } };
    bindDecoders(new THREE.GLTFLoader(), pasPret);`, ctx);
  assert.deepStrictEqual(ici(branches).sort(),
    ['EXT_meshopt_compression', 'KHR_draco_mesh_compression'],
    'Draco et meshopt doivent rester branchés ; seul KTX2 est reporté');

  // et l'échec n'est pas mémorisé : une fois le renderer prêt, KTX2 arrive
  const ensuite = lancerSync(ctx, 'bindDecoders(new THREE.GLTFLoader(), faireRenderer([]))');
  assert.ok(ici(ensuite).includes('KHR_texture_basisu'),
    'le branchement KTX2 doit être retenté quand le renderer est prêt');
});

test('sans renderer du tout, KTX2 est ecarte plutot que de lever plus tard', () => {
  const ctx = creerContexte();
  const branches = vm.runInContext('bindDecoders(new THREE.GLTFLoader(), null)', ctx);
  assert.deepStrictEqual(ici(branches).sort(),
    ['EXT_meshopt_compression', 'KHR_draco_mesh_compression']);
});

test('CONTROLE : sans decodeur, les deux glTF compresses sont REFUSES', async () => {
  const ctx = creerContexte();
  const r = await lancer(ctx, `
    const res = {};
    for(const [key, buf] of [['draco', DRACO], ['meshopt', MESHOPT]]){
      try {
        await new Promise(function(ok, ko){ new THREE.GLTFLoader().parse(buf, '', ok, ko); });
        res[key] = 'ACCEPTE';
      } catch(e){ res[key] = String(e.message || e); }
    }
    return res;`, {DRACO: bytes('quad-draco.glb'), MESHOPT: bytes('quad-meshopt.glb')});
  assert.match(r.draco, /DRACOLoader/, 'le fixture Draco doit être refusé sans décodeur');
  assert.match(r.meshopt, /MeshoptDecoder/, 'le fixture meshopt doit être refusé sans décodeur');
});

test('un glTF Draco se decode pour de vrai, sans network', async () => {
  const ctx = creerContexte();
  const g = await lancer(ctx, `
    const l = new THREE.GLTFLoader();
    bindDecoders(l, null);
    const gltf = await new Promise(function(ok, ko){ l.parse(DRACO, '', ok, ko); });
    let m = null;
    gltf.scene.traverse(function(o){ if(o.isMesh && !m) m = o; });
    const p = m.geometry.getAttribute('position');
    // La compression Draco RÉORDONNE les sommets : comparer sommet par sommet
    // testerait l'ordre de sortie du codec, pas la géométrie. La boîte englobante,
    // elle, est invariante — c'est ce que l'utilisateur verra.
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for(let i = 0; i < p.count; i++){
      minX = Math.min(minX, p.getX(i)); maxX = Math.max(maxX, p.getX(i));
      minZ = Math.min(minZ, p.getZ(i)); maxZ = Math.max(maxZ, p.getZ(i));
    }
    return { sommets: p.count, indices: m.geometry.getIndex().count,
             normales: !!m.geometry.getAttribute('normal'),
             uv: !!m.geometry.getAttribute('uv'),
             box: [minX, maxX, minZ, maxZ] };`,
    {DRACO: bytes('quad-draco.glb')});
  assert.equal(g.sommets, 4);
  assert.equal(g.indices, 6);
  assert.ok(g.normales, 'les normales doivent survivre au décodage');
  assert.ok(g.uv, 'les UV doivent survivre au décodage');
  assert.deepStrictEqual(ici(g.box).map(Math.round), [-1, 1, -1, 1],
    'le quad source va de -1 à 1 en X et en Z');
});

test('un glTF meshopt se decode pour de vrai, sans network', async () => {
  const ctx = creerContexte();
  const g = await lancer(ctx, `
    const l = new THREE.GLTFLoader();
    bindDecoders(l, null);
    await THREE.MeshoptDecoder.ready;
    const gltf = await new Promise(function(ok, ko){ l.parse(MESHOPT, '', ok, ko); });
    let m = null;
    gltf.scene.traverse(function(o){ if(o.isMesh && !m) m = o; });
    const p = m.geometry.getAttribute('position');
    let minX = Infinity, maxX = -Infinity;
    for(let i = 0; i < p.count; i++){ minX = Math.min(minX, p.getX(i)); maxX = Math.max(maxX, p.getX(i)); }
    return { sommets: p.count, indices: m.geometry.getIndex().count,
             normales: !!m.geometry.getAttribute('normal'), etendueX: [minX, maxX] };`,
    {MESHOPT: bytes('quad-meshopt.glb')});
  assert.equal(g.sommets, 4);
  assert.equal(g.indices, 6);
  assert.ok(g.normales);
  // Pas d'assertion sur les UV : gltfpack SUPPRIME TEXCOORD_0 quand aucun matériau ne
  // lit de texture. Vérifié dans le fixture lui-même — ce n'est pas le décodeur qui perd
  // l'attribut, c'est l'encodeur qui ne l'écrit pas.
  assert.deepStrictEqual(ici(g.etendueX).map(Math.round), [-1, 1]);
});

test('KTX2/Basis : le GPU decide de la cible de transcodage', async () => {
  const ctx = creerContexte();
  const r = await lancer(ctx, `
    function decrire(t){
      return { compressee: !!t.isCompressedTexture, format: t.format,
               bytes: (t.mipmaps && t.mipmaps[0]) ? t.mipmaps[0].data.length : null };
    }
    function lire(loader, buf){ return new Promise(function(ok, ko){ loader.parse(buf, ok, ko); }); }

    const avecDxt = THREE.createKTX2Loader(faireRenderer(['WEBGL_compressed_texture_s3tc']));
    await avecDxt.transcoderPending;
    const res = { wasm: avecDxt.transcoderBinary.byteLength };
    res.dxt = decrire(await lire(avecDxt, ETC1S));
    const sansRien = THREE.createKTX2Loader(faireRenderer([]));
    await sansRien.transcoderPending;
    res.rgba = decrire(await lire(sansRien, ETC1S2));
    res.constantes = { RGBA_S3TC_DXT1: THREE.RGBA_S3TC_DXT1_Format, RGBA: THREE.RGBAFormat };
    return res;`,
    {ETC1S: bytes('damier-etc1s.ktx2'), ETC1S2: bytes('damier-etc1s.ktx2')});

  assert.equal(r.wasm, 527333, 'le transcodeur Basis embarqué doit être arrivé entier');
  assert.equal(r.dxt.format, r.constantes.RGBA_S3TC_DXT1,
    'un GPU qui lit le S3TC doit recevoir du DXT1, pas du RGBA décompressé');
  assert.equal(r.dxt.bytes, 2048, 'DXT1 sur 64x64 = 64*64/2 octets');
  assert.equal(r.rgba.format, r.constantes.RGBA,
    'un GPU sans format compressé doit recevoir du RGBA');
  assert.equal(r.rgba.bytes, 64 * 64 * 4);
});

test('KTX2 non supercompresse : filePath sans transcodeur', async () => {
  const ctx = creerContexte();
  const r = await lancer(ctx, `
    const l = THREE.createKTX2Loader(faireRenderer([]));
    const t = await new Promise(function(ok, ko){ l.parse(BRUT, ok, ko); });
    return { compressee: !!t.isCompressedTexture, format: t.format,
             l: t.image.width, h: t.image.height, bytes: t.image.data.length };`,
    {BRUT: bytes('damier-brut.ktx2')});
  // vkFormat renseigné => createRawTexture, le transcodeur n'est pas sollicité. Le
  // contraste avec le test précédent dit lequel des deux chemins casse, le jour où.
  assert.equal(r.compressee, false);
  assert.equal(r.l, 64);
  assert.equal(r.h, 64);
  assert.equal(r.bytes, 64 * 64 * 4);
});

test('les compressions sont lues dans les OCTETS, pas dans le nom du fichier', () => {
  const ctx = creerContexte();
  Object.assign(ctx, {
    GLB: bytes('quad-draco.glb'), MESHOPT: bytes('quad-meshopt.glb'),
    GLTF: fixture('quad.gltf').toString('utf8'),
  });
  assert.deepStrictEqual(
    ici(vm.runInContext('compressionsOfModel("x.glb", new Uint8Array(GLB))', ctx)),
    ['KHR_draco_mesh_compression']);
  assert.deepStrictEqual(
    ici(vm.runInContext('compressionsOfModel("x.glb", new Uint8Array(MESHOPT))', ctx)),
    ['EXT_meshopt_compression']);
  assert.deepStrictEqual(
    ici(vm.runInContext('compressionsOfModel("x.gltf", GLTF)', ctx)), [],
    'un glTF non compressé ne doit réclamer aucun décodeur');
  assert.deepStrictEqual(
    ici(vm.runInContext('compressionsOfModel("x.fbx", new Uint8Array(GLB))', ctx)), [],
    'un FBX n\'a pas de champ extensionsUsed : ne rien inventer');
});

test('un decodeur absent est NOMME, avec le fichier a charger', () => {
  // Contexte volontairement privé du bundle Draco : c'est l'état d'un jeu publié dont le
  // project n'utilisait pas Draco, puis qu'on nourrit d'un modèle Draco.
  const bac = { ...GLOBAUX, window: {}, self: {},
                document: {createElement: () => ({getContext: () => null, style: {}}), createElementNS: () => ({})},
                navigator: {userAgent: 'node'} };
  bac.window = bac; bac.self = bac; bac.globalThis = bac;
  const ctx = vm.createContext(bac);
  vm.runInContext(deEsm(source('vendor/three.min.js')), ctx);
  vm.runInContext(deEsm(source('js/asset-compression.js')), ctx);

  assert.deepStrictEqual(ici(vm.runInContext('bindDecoders(new THREE.GLTFLoader(), null)', ctx)), [],
    'sans bundle chargé, rien ne doit être branché — et surtout rien ne doit lever');
  const msg = vm.runInContext(
    'messageDecodersMissing(decodersMissing(["KHR_draco_mesh_compression"]))', ctx);
  assert.match(msg, /Draco/);
  assert.match(msg, /vendor\/three-draco\.min\.js/,
    'le message doit dire QUOI charger, pas seulement que ce n\'est pas pris en charge');
});

test('le build n embarque un decodeur QUE si un asset en a besoin', () => {
  const ctx = creerContexte();
  // build.js ne déclare que des fonctions au premier level : on peut le charger tel quel.
  vm.runInContext('function escapeHtml(s){ return String(s); }', ctx);
  vm.runInContext(deEsm(source('js/build.js')), ctx, {filename: 'js/build.js'});

  const data = (name, buf) => ({assets: [{kind: 'model', files: [
    {name: name, b64: 'data:application/octet-stream;base64,' + buf.toString('base64')}]}]});

  Object.assign(ctx, {
    D_DRACO: data('m.glb', fixture('quad-draco.glb')),
    D_MESHOPT: data('m.glb', fixture('quad-meshopt.glb')),
    D_NU: data('m.gltf', fixture('quad.gltf')),
  });
  assert.deepStrictEqual(ici(vm.runInContext('decodersNeeded(D_NU)', ctx)), [],
    'un project sans asset compressé ne doit rien peser de plus qu\'avant');
  assert.deepStrictEqual(ici(vm.runInContext('decodersNeeded(D_DRACO)', ctx)),
    ['vendor/three-draco.min.js']);
  assert.deepStrictEqual(ici(vm.runInContext('decodersNeeded(D_MESHOPT)', ctx)),
    ['vendor/three-meshopt.min.js'],
    'meshopt seul ne doit pas traîner les 800 Ko du transcodeur Basis');
});

test('la page du jeu publie charge les decodeurs APRES le pont ESM', () => {
  const ctx = creerContexte();
  vm.runInContext('function escapeHtml(s){ return String(s); }', ctx);
  vm.runInContext(deEsm(source('js/build.js')), ctx, {filename: 'js/build.js'});
  const html = vm.runInContext(
    'pageIndexBuild("Jeu", ["vendor/three-draco.min.js", "vendor/three-ktx2.min.js"])', ctx);

  const pont = html.indexOf('render-webgpu-bridge.mjs');
  const draco = html.indexOf('vendor/three-draco.min.js');
  const ktx2 = html.indexOf('vendor/three-ktx2.min.js');
  const branchement = html.indexOf('asset-compression.js');
  assert.ok(pont > 0 && draco > 0 && ktx2 > 0 && branchement > 0, 'les quatre balises doivent exister');
  // Les décodeurs lisent globalThis.THREE au chargement. Avant le pont, ils hériteraient
  // des classes du bundle CLASSIQUE au lieu de celles de three/webgpu — le mécanisme qui
  // a déjà produit trois régressions silencieuses (voir surface-three-webgpu.test.mjs).
  assert.ok(draco > pont, 'le décodeur Draco doit être chargé après le pont ESM');
  assert.ok(ktx2 > pont, 'le décodeur KTX2 doit être chargé après le pont ESM');
  assert.ok(branchement > draco, 'asset-compression.js lit les décodeurs : il vient après');

  const sansRien = vm.runInContext('pageIndexBuild("Jeu", [])', ctx);
  assert.equal(sansRien.indexOf('three-draco'), -1,
    'aucune balise de décodeur quand le project n\'en a pas besoin');
});

test('editor.html : si les balises de decodeurs sont la, elles sont apres le pont', () => {
  // Conditionnel A DESSEIN : les balises d'editor.html appartiennent à l'intégrateur.
  // Ce test ne réclame pas leur présence, il interdit qu'elles soient au bad endroit.
  const html = source('editor.html');
  const pont = html.indexOf('render-webgpu-bridge.mjs');
  assert.ok(pont > 0, 'le pont ESM doit être dans editor.html');
  ['three-draco.min.js', 'three-meshopt.min.js', 'three-ktx2.min.js'].forEach((f) => {
    const i = html.indexOf(f);
    if(i === -1) return;
    assert.ok(i > pont, f + ' doit être chargé APRÈS js/render-webgpu-bridge.mjs');
  });
  const c = html.indexOf('js/asset-compression.js');
  if(c !== -1){
    assert.ok(c > html.indexOf('vendor/three.min.js'),
      'js/asset-compression.js lit THREE : il vient après vendor/three.min.js');
    assert.ok(c < html.indexOf('js/assets.js'),
      'js/assets.js appelle bindDecoders() : asset-compression.js doit être chargé avant');
  }
});

test('l editeur et le jeu publie passent par le MEME branchement', () => {
  // Le défaut historique du dépôt : la même règle réécrite deux fois, et une seule des
  // deux corrigée. Ici il n'y a qu'une implémentation ; ce test interdit qu'on la
  // contourne d'un côté ou qu'on oublie de la livrer dans le ZIP.
  const editeur = source('js/assets.js');
  const runtime = source('js/game-runtime.js');
  const build = source('js/build.js');

  assert.match(editeur, /bindDecoders\(/, 'js/assets.js doit brancher les décodeurs');
  assert.match(runtime, /bindDecoders\(/, 'js/game-runtime.js doit brancher les décodeurs');
  assert.match(build, /'js\/asset-compression\.js'/,
    'js/build.js doit recopier js/asset-compression.js dans le ZIP');

  // Chaque chemin ne doit construire un GLTFLoader qu'à UN endroit — celui qui branche
  // les décodeurs juste après. Une deuxième construction ailleurs, c'est un format qui
  // marche à l'édition et disparaît au jeu (ou l'inverse), sans message.
  for(const [name, src] of [['js/assets.js', editeur], ['js/game-runtime.js', runtime]]){
    const constructions = [...src.matchAll(/new THREE\.GLTFLoader\(/g)];
    assert.equal(constructions.length, 1,
      name + ' : le GLTFLoader doit être construit en un seul endroit (trouvé '
      + constructions.length + ') — sinon un des deux oublie les décodeurs');
    // Et cette unique construction doit être suivie du branchement. La proximité se
    // mesure en CODE, commentaires retirés : sinon une explication un peu longue écrite
    // entre les deux lignes fait rougir le test alors qu'aucun comportement n'a changé.
    // C'est arrivé en ajoutant la garde de disponibilité — et un test qui rougit sur un
    // commentaire finit par se faire désactiver.
    const sequence = src.slice(constructions[0].index, constructions[0].index + 900)
      .replace(/\/\/[^\n]*/g, '');
    assert.match(sequence.slice(0, 220), /bindDecoders\(/,
      name + ' : le GLTFLoader construit doit recevoir les décodeurs immédiatement');
  }
});
