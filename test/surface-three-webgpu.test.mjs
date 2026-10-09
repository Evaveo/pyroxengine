import { deEsm } from './engine-env.mjs';
// moteur/test/surface-three-webgpu.test.mjs
// GARDE contre une classe entière de bugs SILENCIEUX.
//
// Le pont ESM (js/render-webgpu-bridge.mjs) fait `THREE = {...classique, ...webgpu}` : le
// paquet three/webgpu gagne pour tout ce qu'il définit, et le THREE classique COMBLE LES
// TROUS sans rien dire. Utiliser une classe que le paquet webgpu ne définit pas revient donc
// à passer au WebGPURenderer un objet venu de l'autre bundle — ce qu'il ne reconnaît pas, et
// qu'il ne signale pas : l'object n'est simplement pas dessiné, ou la lumière reste inert.
//
// Même piège sur le renderer : `capabilities` n'existe pas sur WebGPURenderer (c'est son
// backend qui en a un), et les appels concernés étaient enveloppés de try/catch.
//
// Trois régressions réelles sont nées de ce mécanisme (voir docs/KNOWN_ISSUES.md) :
// WebGLCubeRenderTarget sur les sondes, readRenderTargetPixels sur la mesure d'ambiance,
// renderer.capabilities sur l'anisotropy. Ce test interroge les DEUX bundles pour de vrai
// — il les charge, il ne les grep pas — et échoue au prochain cas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const racineMoteur = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Classes que le code prend SCIEMMENT dans le THREE classique. Toute autre absence du
// paquet webgpu est un bug : add une entrée ici demande une raison écrite.
const REPLIS_ASSUMES = {
  FBXLoader:             'addon vendorisé à la main dans vendor/three.min.js, absent du paquet npm three/webgpu',
  GLTFLoader:            'idem FBXLoader',
  TransformControls:     'idem FBXLoader',
  WebGLRenderer:         'vignettes d\'assets uniquement (js/assets.js), sur son propre canvas — renderer classique voulu',
  WebGLCubeRenderTarget: 'branche de repli de createTargetCube() quand CubeRenderTarget manque',
  // Décodeurs de compression : trois bundles vendorisés à part (vendor/three-draco,
  // three-meshopt, three-ktx2), absents du paquet npm three/webgpu comme GLTFLoader.
  // Ils ne servent QUE via GLTFLoader, qui vient déjà du bundle classique : le mélange
  // des deux bundles n'est pas aggravé ici. Les balises sont placées APRÈS le pont ESM
  // (garde ci-dessous) pour qu'ils héritent quand même des classes three/webgpu.
  MeshoptDecoder:        'décodeur vendorisé (vendor/three-meshopt.min.js), absent de three/webgpu',
  createDRACOLoader:      'fabrique posée par vendor/three-draco.min.js (amorçage sans réseau)',
  createKTX2Loader:       'fabrique posée par vendor/three-ktx2.min.js (amorçage sans réseau)'
};

// Membres de `renderer` que le code lit alors qu'ils n'appartiennent PAS à WebGPURenderer :
// uniquement des branches de repli pour un renderer WebGL classique.
const MEMBRES_DE_REPLI = {
  capabilities:           'repli pour un renderer WebGL classique (WebGPURenderer expose getMaxAnisotropy() directement)',
  readRenderTargetPixels: 'repli pour un renderer WebGL classique (WebGPURenderer n\'a que la version async)'
};

function fichiersJs(){
  const trouves = [];
  const marcher = (d) => readdirSync(d, {withFileTypes: true}).forEach((e) => {
    if(e.isDirectory()) marcher(path.join(d, e.name));
    else if(/\.(js|mjs)$/.test(e.name)) trouves.push(path.join(d, e.name));
  });
  marcher(path.join(racineMoteur, 'js'));
  return trouves;
}

// name utilisé -> fichiers qui l'utilisent
function usages(motif){
  const par = new Map();
  fichiersJs().forEach((f) => {
    const court = path.relative(racineMoteur, f).replace(/\\/g, '/');
    for(const m of readFileSync(f, 'utf8').matchAll(motif)){
      if(!par.has(m[1])) par.set(m[1], new Set());
      par.get(m[1]).add(court);
    }
  });
  return par;
}

const modWebgpu = await import(
  'file:///' + path.join(racineMoteur, 'vendor-esm/three.webgpu.min.js').replace(/\\/g, '/'));
const exportsWebgpu = new Set(Object.keys(modWebgpu));

// Tous les bundles CLASSIQUES qui accrochent quelque chose sur le THREE global. Les
// décodeurs de compression en font partie : les oublier ici ferait passer un
// THREE.createDRACOLoader inexistant pour un nom connu, ou l'inverse.
const BUNDLES_CLASSIQUES = ['vendor/three.min.js', 'vendor/three-draco.min.js',
                            'vendor/three-meshopt.min.js', 'vendor/three-ktx2.min.js'];

function exportsClassiques(){
  const faux = () => ({getContext: () => null, style: {}, addEventListener(){}, width: 1, height: 1});
  const bac = {window: {}, self: {}, console, atob, Blob: class {}, URL,
               document: {createElement: faux, createElementNS: faux},
               navigator: {userAgent: 'node'}};
  bac.window = bac; bac.self = bac; bac.globalThis = bac;
  const ctx = vm.createContext(bac);
  BUNDLES_CLASSIQUES.forEach((f) => {
    vm.runInContext(deEsm(readFileSync(path.join(racineMoteur, f), 'utf8')), ctx);
  });
  return new Set(vm.runInContext('Object.keys(THREE)', ctx));
}

test('aucun THREE.X utilise n\'est introuvable dans les deux bundles', () => {
  const classiques = exportsClassiques();
  const missing = [];
  usages(/\bTHREE\.([A-Za-z_$][\w$]*)/g).forEach((files, name) => {
    if(!exportsWebgpu.has(name) && !classiques.has(name)){
      missing.push(name + ' (' + [...files].join(', ') + ')');
    }
  });
  assert.deepStrictEqual(missing, [],
    'ces noms valent undefined à l\'exécution — ni le paquet webgpu ni le bundle classique ne les définissent');
});

test('tout THREE.X absent du paquet webgpu est un repli ASSUME et documente', () => {
  const inattendus = [];
  usages(/\bTHREE\.([A-Za-z_$][\w$]*)/g).forEach((files, name) => {
    if(exportsWebgpu.has(name)) return;                 // le paquet webgpu le fournit : rien à dire
    if(REPLIS_ASSUMES[name]) return;                    // repli connu, avec sa raison
    inattendus.push(name + ' (' + [...files].join(', ') + ')');
  });
  assert.deepStrictEqual(inattendus, [],
    'le paquet three/webgpu ne définit pas ces classes : le pont retombe donc SILENCIEUSEMENT sur '
    + 'le THREE classique, et le WebGPURenderer reçoit un objet venu de l\'autre bundle. '
    + 'Chercher l\'équivalent du paquet webgpu (WebGLCubeRenderTarget → CubeRenderTarget, etc.), '
    + 'ou add une entrée dans REPLIS_ASSUMES avec sa raison.');
});

test('tout renderer.X lu appartient bien a WebGPURenderer', () => {
  // On INSTANCIE le renderer : les propriétés posées par le constructeur (info, shadowMap,
  // outputColorSpace, toneMapping…) n'apparaissent pas sur le prototype, et un test qui ne
  // regarderait que le prototype les signalerait toutes à tort.
  const faux = () => ({getContext: () => null, style: {}, addEventListener(){}, removeEventListener(){},
                       width: 1, height: 1, setAttribute(){},
                       getBoundingClientRect: () => ({width: 1, height: 1})});
  const sauve = {window: globalThis.window, self: globalThis.self, document: globalThis.document};
  globalThis.window = globalThis; globalThis.self = globalThis;
  globalThis.document = {createElement: faux, createElementNS: faux, body: {appendChild(){}}};
  let r = null;
  try { r = new modWebgpu.WebGPURenderer({antialias: true}); }
  finally { Object.assign(globalThis, sauve); }
  assert.ok(r, 'WebGPURenderer doit pouvoir être instancié hors navigateur pour ce test');

  const inattendus = [];
  usages(/\brenderer\.([A-Za-z_$][\w$]*)/g).forEach((files, name) => {
    if(name in r) return;
    if(MEMBRES_DE_REPLI[name]) return;
    if(name.startsWith('__')) return;                   // markers internes du moteur (renderer.__ready)
    inattendus.push(name + ' (' + [...files].join(', ') + ')');
  });
  assert.deepStrictEqual(inattendus, [],
    'ces membres n\'existent pas sur WebGPURenderer : l\'appel lève, et s\'il est dans un try/catch '
    + 'la fonctionnalité disparaît sans un mot. Chercher l\'équivalent (renderer.capabilities'
    + '.getMaxAnisotropy() → renderer.getMaxAnisotropy()), ou documenter dans MEMBRES_DE_REPLI.');
});

test('les replis declares sont tous encore utilises', () => {
  // un repli qui ne sert plus doit disparaître de la liste, sinon elle finit par autoriser
  // des absences que plus personne n'a examinées
  const utilisesThree = usages(/\bTHREE\.([A-Za-z_$][\w$]*)/g);
  const utilisesRenderer = usages(/\brenderer\.([A-Za-z_$][\w$]*)/g);
  const morts = [
    ...Object.keys(REPLIS_ASSUMES).filter((n) => !utilisesThree.has(n)),
    ...Object.keys(MEMBRES_DE_REPLI).filter((n) => !utilisesRenderer.has(n))
  ];
  assert.deepStrictEqual(morts, [],
    'ces exceptions ne correspondent plus à aucun usage : les retirer de la liste');
});

// ---------------------------------------------------------------------------
// Les MÉTHODES des nœuds TSL, pas seulement les classes du bundle.
//
// Les gardes ci-dessus vérifient que `THREE.X` existe. Elles ne disent rien de ce qu'on
// APPELLE sur les objets obtenus — et c'est par là que tout le post-traitement est mort
// sans qu'aucun des 140 tests ne bronche : `postfx.js` et `game-runtime.js` appelaient
// `tSrc.uv(...)` sur un nœud de texture, méthode qui n'existe pas en r185. Le nom exact
// est `sample()`. Résultat : « THREE.TSL: TypeError: tSrc.uv is not a function », en
// console, une fois par image, et le bloom, l'étalonnage, la vignette, le grain et le
// FXAA silencieusement absents dès qu'on active le post-traitement.
//
// Ce test interroge un VRAI nœud de texture construit depuis le bundle vendorisé. Il
// n'énumère pas les méthodes valides — il part de ce que le CODE appelle.
// On interroge le PROTOTYPE de TextureNode, exporté par le bundle webgpu déjà chargé
// ci-dessus. Pas d'import de `three/tsl` : ce fichier importe `'three'` en spécificateur
// nu, que le navigateur résout par l'import map d'editor.html et que noeud ne sait pas
// résoudre sans un pont ou une dépendance npm. Ajouter l'un ou l'autre pour un test
// irait contre le choix de l'équipe d'avoir une sequence sans dépendances.
test('toute methode appelee sur un noeud de texture TSL existe vraiment', () => {
  assert.equal(typeof modWebgpu.TextureNode, 'function',
    'TextureNode n’est plus exporté par le bundle webgpu : cette garde ne teste plus rien');
  const node = modWebgpu.TextureNode.prototype;

  // Les variables qui portent un nœud de texture dans notre code. On les nomme plutôt que
  // de deviner : un `.uv(` sur autre chose (un vecteur, un uniforme) n'a rien à voir.
  const PORTEURS = ['tSrc', 'tBloom'];
  const appels = new Map();
  fichiersJs().forEach((p) => {
    const src = readFileSync(p, 'utf8');
    const court = path.relative(racineMoteur, p).split(path.sep).join('/');
    PORTEURS.forEach((v) => {
      const re = new RegExp(String.raw`\b${v}\.([A-Za-z_$][\w$]*)\s*\(`, 'g');
      let m;
      while((m = re.exec(src)) !== null){
        if(!appels.has(m[1])) appels.set(m[1], new Set());
        appels.get(m[1]).add(court);
      }
    });
  });

  const inconnues = [];
  appels.forEach((files, methode) => {
    if(typeof node[methode] !== 'function'){
      inconnues.push(methode + ' — appelée dans ' + [...files].join(', '));
    }
  });

  assert.deepEqual(inconnues, [],
    'méthode(s) inexistante(s) sur un nœud de texture TSL. L\'appel ne lève pas au '
    + 'chargement : il échoue à la CONSTRUCTION DU GRAPHE, une fois par image, et l\'effet '
    + 'disparaît sans que rien d\'autre ne le dise :\n  ' + inconnues.join('\n  '));
});

// ---------------------------------------------------------------------------------------
// LE NOM D'UN HOOK THREE, ÉCRIT À UNE LETTRE PRÈS.
//
// Un hook de three n'est pas appelé parce qu'on le déclare : c'est three qui va le chercher
// PAR SON NOM, sur le matériau ou l'objet. Poser `m.onBeforeCompiled` (avec un d) est donc du
// JavaScript parfaitement valide qui ne fait rien du tout — aucune exception, aucun
// avertissement, juste un effet visuel qui manque.
//
// C'est arrivé deux fois sur le MÊME hook : dans js/materials.js (trouvé le 2026-09-14, le
// lissage ne s'appliquait pas sur les vignettes d'assets), puis dans son miroir
// js/game-runtime.js, où la faute a survécu une semaine de plus — là, dans du code que le
// runtime ne pouvait même pas atteindre, donc invisible pour de bon (branche retirée en
// v0.149.1).
//
// La liste des hooks n'est PAS écrite ici : elle est lue sur les prototypes du bundle webgpu
// réellement embarqué. Un hook renommé par une montée de version de three fait donc échouer
// ce test au lieu de le rendre faux en silence.
//
// POURQUOI UNE DISTANCE D'ÉDITION plutôt que « tout `on...` doit être un hook three » : le
// moteur a ses propres rappels (`onShow`, `onHide`, `onPopOut`, `onDragMove`…) et ils sont
// légitimes. Aucun n'est à une lettre d'un hook three ; une faute de frappe, si.
function hooksDeThree(){
  const trouves = new Set();
  for(const nomClasse of ['Material', 'Object3D', 'Texture']){
    const C = modWebgpu[nomClasse];
    if(typeof C !== 'function') continue;
    for(const k of Object.getOwnPropertyNames(C.prototype)){
      if(/^on[A-Z]/.test(k) || /ProgramCacheKey$/.test(k)) trouves.add(k);
    }
  }
  return trouves;
}

/** Levenshtein, borné : on ne s'intéresse qu'à « 0 ou 1 », pas à la valeur exacte. */
function distance1(a, b){
  if(a === b) return 0;
  if(Math.abs(a.length - b.length) > 1) return 2;
  let i = 0, j = 0, ecarts = 0;
  while(i < a.length && j < b.length){
    if(a[i] === b[j]){ i++; j++; continue; }
    if(++ecarts > 1) return 2;
    if(a.length === b.length){ i++; j++; }        // substitution
    else if(a.length > b.length) i++;              // suppression dans a
    else j++;                                      // insertion dans a
  }
  return (ecarts + (a.length - i) + (b.length - j)) > 1 ? 2 : 1;
}

test('aucun hook three n\'est ecrit a une lettre pres', () => {
  const hooks = hooksDeThree();
  assert.ok(hooks.size >= 4,
    'les prototypes du bundle webgpu ne rendent plus de hook reconnaissable ('
    + [...hooks].join(', ') + ') — cette garde ne mesure plus rien, la lecture est à refaire');
  assert.ok(hooks.has('onBeforeCompile'),
    'onBeforeCompile a disparu du bundle : le motif de ce test a changé, le relire');

  // `<porteur>.<nom> =` — on ne retient que les noms qui ONT LA FORME d'un hook. Le reste
  // du fichier (une affectation quelconque) ne nous regarde pas.
  const poses = new Map();
  fichiersJs().forEach((f) => {
    const court = path.relative(racineMoteur, f).replace(/\\/g, '/');
    const src = readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
    src.split('\n').forEach((ligne, i) => {
      if(/^\s*(\/\/|\*)/.test(ligne)) return;   // un commentaire peut CITER la faute — ici, il le fait
      for(const m of ligne.matchAll(/\.(on[A-Z][A-Za-z0-9_$]*|[A-Za-z0-9_$]*ProgramCacheKey)\s*=[^=]/g)){
        if(!poses.has(m[1])) poses.set(m[1], new Set());
        poses.get(m[1]).add(court + ':' + (i + 1));
      }
    });
  });
  assert.ok(poses.size > 0, 'aucune affectation de hook trouvée — le motif de lecture est cassé');

  const fautes = [];
  poses.forEach((sites, nom) => {
    if(hooks.has(nom)) return;                    // un vrai hook, rien à dire
    for(const vrai of hooks){
      if(distance1(nom, vrai) <= 1){
        fautes.push(nom + ' (voulait ' + vrai + ') — ' + [...sites].join(', '));
        break;
      }
    }
  });

  assert.deepEqual(fautes, [],
    'nom de hook three écrit à une lettre près. three va chercher le hook PAR SON NOM : '
    + 'l\'affectation est du JavaScript valide, elle ne lève rien, et la fonction n\'est '
    + 'jamais appelée. L\'effet manque, et rien ne le dit :\n  ' + fautes.join('\n  '));
});
