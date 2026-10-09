// LE REGROUPEMENT EN INSTANCES NE DOIT JAMAIS FONDRE DEUX APPARENCES DIFFÉRENTES.
//
// Panne mesurée dans le jeu publié (et LÀ SEULEMENT, puisque l'éditeur n'appelle plus
// updateInstances) : les neuf sphères d'une scène, chacune avec son graphe de shader
// « Lit physical » (verre, velours, eau, lave…), s'affichaient toutes identiques.
//
// La cause n'était pas dans les graphes — ils se construisent correctement des deux côtés —
// mais dans `signatureMaterial` (js/render-perf.js) : elle compare des SCALAIRES (color,
// roughness, metalness, maps), tous restés à leur valeur par défaut sur un matériau à nœuds
// dont l'apparence vit dans colorNode/roughnessNode/… Neuf matériaux radicalement différents
// rendaient donc la même signature, et un InstancedMesh n'a qu'UN matériau : celui du premier.
//
// Deux verrous, testés ici : la marque `userData.materialId` que le runtime pose comme
// l'éditeur, et le refus de comparer par contenu un matériau à nœuds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { creerContexte } from './engine-env.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = creerContexte(['js/render-perf.js']);

/** Un maillage minimal : ce que `signatureMaterial` lit réellement, et rien de plus. */
function maillage(material, materialId){
  return {isMesh: true, material: material,
          userData: materialId ? {materialId: materialId} : {}};
}

/** Un matériau à nœuds : scalaires par défaut, apparence portée par ses nœuds. */
function materialWithNodes(nodeColor){
  return {type: 'MeshPhysicalNodeMaterial', uuid: 'uuid-' + nodeColor,
          color: {getHex(){ return 0xffffff; }}, roughness: 1, metalness: 0,
          opacity: 1, transparent: false, side: 0,
          colorNode: {marque: nodeColor}, roughnessNode: {}, metalnessNode: {}};
}

test('deux graphes de shader différents ne partagent PAS de signature de matériau', () => {
  const a = env.signatureMaterial(maillage(materialWithNodes('lave')));
  const b = env.signatureMaterial(maillage(materialWithNodes('verre')));
  assert.notEqual(a, b,
    'signature identique = même lot = même matériau à l écran pour deux shaders différents');
});

test('deux objets du MÊME asset de matériau se regroupent toujours', () => {
  const a = env.signatureMaterial(maillage(materialWithNodes('lave'), 'a20'));
  const b = env.signatureMaterial(maillage(materialWithNodes('lave'), 'a20'));
  assert.equal(a, b, 'même asset = même apparence : le regroupement doit rester possible');
  assert.equal(a, 'asset:a20');
});

test('un matériau SANS nœud garde la comparaison par contenu (le cas d origine)', () => {
  const pbr = function(){
    return {type: 'MeshStandardMaterial', uuid: 'u' + Math.random(),
            color: {getHex(){ return 0x884422; }}, roughness: 0.5, metalness: 0,
            opacity: 1, transparent: false, side: 0};
  };
  assert.equal(env.signatureMaterial(maillage(pbr())), env.signatureMaterial(maillage(pbr())),
    'deux caisses copiées-collées doivent encore se regrouper — c est tout l intérêt');
});

test('le jeu publié marque userData.materialId, comme l éditeur', () => {
  // Vérification sur la SOURCE : game-runtime.js n'est pas chargeable dans le harnais. Sans
  // cette marque, `signatureMaterial` n a pas la branche « même asset » et retombe sur la
  // comparaison par contenu — exactement la panne ci-dessus.
  const src = readFileSync(path.join(root, 'js/game-runtime.js'), 'utf8');
  const i = src.indexOf('function applyMaterialRuntime(');
  assert.notEqual(i, -1);
  const body = src.slice(i, src.indexOf('\nfunction ', i + 10));
  assert.match(body, /userData\.materialId\s*=/,
    'le runtime doit marquer l objet avec l id de son matériau, comme applyMaterialOn');
  assert.match(src, /assetsById\[da\.id\] = \{id:da\.id, kind:'material'/,
    'l entrée matériau de assetsById doit porter son id, sinon la marque vaut undefined');
});
