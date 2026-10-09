// CHANGER L'ÉCHELLE D'UN MODÈLE RIGGÉ — les deux caches qui mentaient après coup.
//
// Symptôme rapporté : on change « Échelle » sur un personnage skinné, on applique, et deux
// choses arrivent — l'aperçu disparaît, et le maillage des instances déjà posées part dans tous
// les sens. Deux causes distinctes, toutes deux des états mis en cache que la mise à l'échelle
// ne touchait pas :
//
//   1. `THREE.SkinnedMesh` porte SES PROPRES `boundingBox`/`boundingSphere`, calculées sur la
//      pose skinnée et gardées. `Box3.setFromObject` les PRÉFÈRE à celles de la géométrie (voir
//      `expandByObject` : `object.boundingBox !== undefined` passe avant `geometry.boundingBox`),
//      donc l'aperçu se cadrait sur l'ancienne taille. Vider celles de la géométrie ne suffit
//      pas : ce sont deux caches différents.
//   2. les géométries sont PARTAGÉES entre le template et ses instances, mais chaque instance
//      est un clone qui a figé son `bindMatrix` et ses `boneInverses` à la copie. Rééchelonner
//      la géométrie les périme, et rien ne les refaisait : seule la signature de STRUCTURE
//      déclenche un reclonage, et le facteur cuit n'en faisait pas partie.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { creerContexte } from './engine-env.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');

const env = creerContexte(['js/model-import.js']);
const THREE = env.THREE;

/** Un personnage minimal : un os, un maillage skinné de 2 sommets, sous une racine. */
function personnage(){
  const racine = new THREE.Group();
  const os = new THREE.Bone();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 0, 2, 0]), 3));
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint16Array([0, 0, 0, 0, 0, 0, 0, 0]), 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0]), 4));
  const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial());
  mesh.add(os);
  mesh.bind(new THREE.Skeleton([os]));
  racine.add(mesh);
  racine.updateMatrixWorld(true);
  return {racine, mesh, geo};
}

test('THREE.SkinnedMesh a bien SES PROPRES bornes, distinctes de celles de la geometrie', () => {
  // La prémisse de tout le reste. Si three cessait de les porter, les deux lignes de
  // `bakeScaleModel` deviendraient du bruit — ce test le dirait.
  const {mesh} = personnage();
  assert.equal(mesh.boundingBox, null,
    'un SkinnedMesh doit exposer `boundingBox`, sinon Box3 utiliserait celle de la géométrie');
  mesh.computeBoundingBox();
  assert.ok(mesh.boundingBox, 'computeBoundingBox() doit remplir le cache du maillage');
});

test('mettre la geometrie a l echelle VIDE les bornes du SkinnedMesh', () => {
  const {racine, mesh, geo} = personnage();
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  const avant = mesh.boundingBox.max.y;

  env.bakeScaleModel(racine, 0.01);

  assert.equal(mesh.boundingBox, null,
    'la boîte du maillage skinné vaut encore l\'ancienne taille : l\'aperçu se cadrerait dessus');
  assert.equal(mesh.boundingSphere, null,
    'la sphère périmée fait disparaître le personnage selon l\'angle de caméra');
  mesh.computeBoundingBox();
  assert.ok(Math.abs(mesh.boundingBox.max.y - avant * 0.01) < 1e-6,
    'recalculée, la boîte doit suivre la nouvelle échelle');
  assert.ok(Math.abs(geo.attributes.position.array[4] - 0.02) < 1e-9,
    'la géométrie elle-même doit avoir été mise à l\'échelle');
});

test('une mise a l echelle NEUTRE ne touche a rien', () => {
  const {racine, mesh} = personnage();
  env.bakeScaleModel(racine, 1);
  mesh.computeBoundingBox();
  const box = mesh.boundingBox;
  env.bakeScaleModel(racine, 1);
  assert.equal(mesh.boundingBox, box,
    'sans changement d\'échelle, invalider les caches ferait recalculer pour rien');
});

test('le FACTEUR CUIT fait partie de la signature qui fait recloner les instances', () => {
  // Les instances partagent la géométrie mais ont figé leurs matrices de liaison : un
  // changement d'échelle DOIT passer par `rebuildInstancesStructure`. La signature est du code
  // sans état observable depuis un test ; on vérifie donc qu'elle porte bien le facteur.
  const src = read('js/import-settings.js');
  const i = src.indexOf('const structure = [');
  assert.ok(i !== -1, 'la signature de structure a disparu');
  const ligne = src.slice(i, src.indexOf(';', i));
  assert.match(ligne, /factor/,
    'sans le facteur cuit, changer « Échelle » laisse les instances riggées avec des matrices '
    + 'de liaison périmées — la peau part dans tous les sens');
  // Et l'autre écriture de la même signature, dans la branche sans instances : les deux doivent
  // dire la même chose, sinon le premier « Appliquer » suivant croirait à un changement.
  const j = src.indexOf('t.userData.importStructure = [');
  assert.ok(j !== -1);
  assert.match(src.slice(j, src.indexOf(';', j)), /factor/,
    'les deux écritures de la signature doivent porter les mêmes champs');
});
