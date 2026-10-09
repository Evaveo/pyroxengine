// moteur/test/lissage-tsl.test.mjs
// Sous WebGPURenderer, `onBeforeCompile` n'est JAMAIS appelé : le pipeline passe par le
// système de nœuds et ne compile aucun GLSL à patcher. La multiplication du lissage vivait
// entièrement dans ce patch — elle ne s'appliquait donc plus, et son propre repli
// d'avertissement était enfermé dans la fonction jamais appelée. Elle existe désormais aussi
// en nœud TSL (`roughnessNode`).
//
// Ces tests ne se contentent pas de vérifier qu'un nœud est posé : ils ÉVALUENT le graphe
// produit avec un faux TSL, et comparent à la formule de référence. Un graphe correctement
// construit mais faux serait sinon indétectable sans GPU.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { creerContexte, fabriquerFichierTexture } from './engine-env.mjs';

const racineMoteur = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// La formule voulue : on multiplie deux LISSAGES, pas deux rugosités.
function rugositeAttendue(texelG, roughness){
  return 1 - (1 - texelG) * (1 - roughness);
}

// Faux TSL : chaque nœud porte de quoi s'évaluer numériquement. `sub`/`mul` composent, `.g`
// d'une référence de texture rend le canal vert du texel. La référence de texture brute lève
// si elle est lue sans canal — on veut savoir si le code oublie le `.g`.
const FAUX_TSL = `
  function __n(f){
    var o = {__n: true, ev: f};
    o.sub = function(x){ return __n(function(c){ return f(c) - __ev(x, c); }); };
    o.mul = function(x){ return __n(function(c){ return f(c) * __ev(x, c); }); };
    Object.defineProperty(o, 'g', {get: function(){
      return __n(function(c){ return c.texelG; });
    }});
    return o;
  }
  function __ev(x, c){ return (x && x.__n) ? x.ev(c) : x; }
  var TSL = {
    float: function(v){ return __n(function(){ return v; }); },
    materialReference: function(name, type){
      globalThis.__refs.push(name + ':' + type);
      if(type === 'texture'){
        return __n(function(){ throw new Error('texture lue sans canal — le .g manque'); });
      }
      return __n(function(c){ return c.roughness; });
    }
  };
`;

async function materiauAvecMapDeRugosite(env){
  const file = await fabriquerFichierTexture(env, 'TX_Rug.png', 128, 128, 128, 255);
  const tex = env.createAssetTexture(file);
  await new Promise((r) => setTimeout(r, 10));
  const a = env.createAssetMaterial();
  const p = env.ensurePropsMaterial(a);
  p.smoothness = 0.8;                 // → roughness 0.2
  p.roughnessAsset = tex.id;
  return env.makeMaterialThree(a);
}

test('le graphe TSL calcule bien 1 - (1 - texel.g) * (1 - roughness)', async () => {
  const env = creerContexte(['js/assets.js', 'js/materials.js', 'js/model-import.js', 'js/import-settings.js', 'js/project-settings.js', 'js/serialization.js']);
  vm.runInContext('globalThis.__refs = [];' + FAUX_TSL, env);

  const m = await materiauAvecMapDeRugosite(env);
  assert.ok(m.roughnessMap, 'la map de rugosité doit être posée pour que le test ait un sens');
  assert.ok(m.roughnessNode, 'un roughnessNode doit être posé dès que TSL est disponible');

  // le nœud doit lire le matériau, pas figer une valeur : ce sont bien des références
  const refs = vm.runInContext('globalThis.__refs.join(",")', env);
  assert.match(refs, /roughnessMap:texture/, 'la texture doit venir d\'une référence au matériau');
  assert.match(refs, /roughness:float/, 'le paramètre doit venir d\'une référence au matériau (curseur vivant)');

  const cas = [
    [0, 0], [1, 1], [0.5, 0.5], [0.2, 0.8], [1, 0], [0, 1], [0.13, 0.77]
  ];
  cas.forEach(function(c){
    const texelG = c[0], roughness = c[1];
    const obtenu = m.roughnessNode.ev({texelG: texelG, roughness: roughness});
    const attendu = rugositeAttendue(texelG, roughness);
    assert.ok(Math.abs(obtenu - attendu) < 1e-12,
      'texel.g=' + texelG + ' roughness=' + roughness + ' → attendu ' + attendu + ', obtenu ' + obtenu);
  });
});

test('la formule en nodes n\'est PAS celle de three (qui multiplie deux rugosites)', async () => {
  const env = creerContexte(['js/assets.js', 'js/materials.js', 'js/model-import.js', 'js/import-settings.js', 'js/project-settings.js', 'js/serialization.js']);
  vm.runInContext('globalThis.__refs = [];' + FAUX_TSL, env);
  const m = await materiauAvecMapDeRugosite(env);

  // le cas qui distingue les deux : une map à moitié rugueuse et un paramètre lisse
  const obtenu = m.roughnessNode.ev({texelG: 0.5, roughness: 0.2});
  assert.ok(Math.abs(obtenu - 0.6) < 1e-12, 'notre formule donne 0,6 — obtenu ' + obtenu);
  assert.ok(Math.abs(obtenu - 0.1) > 1e-6,
    'three donnerait 0,1 (0,5 × 0,2) : si on retombe là-dessus, le lissage agit à l\'envers');
});

test('les deux pipelines cohabitent : noeud pour WebGPU, GLSL pour le WebGL classique', async () => {
  const env = creerContexte(['js/assets.js', 'js/materials.js', 'js/model-import.js', 'js/import-settings.js', 'js/project-settings.js', 'js/serialization.js']);
  vm.runInContext('globalThis.__refs = [];' + FAUX_TSL, env);
  const m = await materiauAvecMapDeRugosite(env);

  assert.ok(m.roughnessNode, 'le nœud sert au WebGPURenderer');
  // le patch GLSL reste pour le renderer WebGL classique (vignettes d'assets)
  const faux = {fragmentShader: env.THREE.ShaderChunk.roughnessmap_fragment};
  m.onBeforeCompile(faux);
  assert.ok(faux.fragmentShader.indexOf(env.GLSL_RUG_SMOOTHING) !== -1,
    'le patch GLSL doit rester en place pour le renderer classique');
  assert.equal(m.customProgramCacheKey(), 'lissage-multiply');
});

test('sans TSL sur un rendu par noeuds, on avertit au lieu de se taire', async () => {
  const env = creerContexte(['js/assets.js', 'js/materials.js', 'js/model-import.js', 'js/import-settings.js', 'js/project-settings.js', 'js/serialization.js']);
  // pas de TSL, et un renderer qui se déclare WebGPU : c'est exactement la configuration où
  // le lissage s'appliquerait à l'envers sans que personne ne le sache.
  vm.runInContext(`
    renderer.isWebGPURenderer = true;
    globalThis.__avertis = [];
    logConsole = function(niveau, message){ globalThis.__avertis.push(niveau + '|' + message); };
  `, env);

  const m = await materiauAvecMapDeRugosite(env);
  const avertis = vm.runInContext('globalThis.__avertis.slice()', env);

  assert.equal(m.roughnessNode, undefined, 'aucun nœud ne peut être construit sans TSL');
  assert.equal(avertis.length, 1, 'un avertissement, et un seul, doit être émis');
  assert.match(avertis[0], /TSL/, 'l\'avertissement doit nommer la cause');
});

test('le miroir du runtime porte EXACTEMENT la meme formule', () => {
  const read = (f) => readFileSync(path.join(racineMoteur, f), 'utf8');
  // on compare les body de fonction, aux noms près : un build doit rendre pixel pour pixel
  // comme l'éditeur, et deux formules qui divergent ne se verraient qu'à l'œil.
  const extraire = (src, name) => {
    const i = src.indexOf('function ' + name + '(');
    assert.notEqual(i, -1, name + ' doit exister');
    return src.slice(i, src.indexOf('\n}', i))
      .replace(/Rt\b/g, '').replace(/\s+/g, ' ').trim();
  };
  assert.equal(
    extraire(read('js/game-runtime.js'), 'nodeRoughnessFromSmoothingsRt'),
    extraire(read('js/materials.js'), 'nodeRoughnessFromSmoothings'),
    'la version runtime de la formule a divergé de celle de l\'éditeur');
  // LE PATCH GLSL N'EXISTE QUE CÔTÉ ÉDITEUR, et cette assertion dit l'INVERSE de ce qu'elle
  // disait jusqu'en v0.149.1.
  //
  // Elle exigeait la même chaîne GLSL dans les deux fichiers. C'est elle qui a maintenu en vie,
  // dans js/game-runtime.js, une branche que rien ne pouvait atteindre : le runtime n'a qu'un
  // WebGPURenderer, un jeu publié n'a pas de vignettes d'assets, et WebGPURenderer convertit
  // tout matériau en NodeMaterial quel que soit son backend — `onBeforeCompile` n'y est jamais
  // appelé. La copie y était donc morte, et son hook portait même un nom fautif
  // (`onBeforeCompiled`) que personne ne pouvait voir échouer : du code injoignable ne casse
  // jamais. Voir docs/REVUE_2026-09-22.md § 1.1.
  //
  // Ce qu'on garde de l'intention d'origine : la FORMULE ne doit pas diverger. C'est
  // l'assertion du dessus, sur le nœud TSL, qui porte ça — et c'est le seul chemin que le
  // runtime emprunte réellement.
  const glsl = (src) => /roughnessFactor = 1\.0 - \( 1\.0 - texelRoughness\.g \) \* \( 1\.0 - roughness \);/.test(src);
  assert.ok(glsl(read('js/materials.js')),
    'le patch GLSL a disparu de js/materials.js — il sert encore au renderer classique des '
    + 'vignettes du panneau Projet (js/assets.js)');
  assert.equal(glsl(read('js/game-runtime.js')), false,
    'le patch GLSL est revenu dans js/game-runtime.js. Il y est INJOIGNABLE : le runtime n\'a '
    + 'qu\'un WebGPURenderer, qui n\'appelle jamais onBeforeCompile. Une recopie de miroir sans '
    + 'son consommateur — exactement ce qui a laissé passer `onBeforeCompiled` pendant une '
    + 'semaine.');
});
