// moteur/test/lightmap-maillage.test.mjs
//
// v1.10.5 — une lightmap cuite sur un modèle dont les emplacements gardent le matériau DU FICHIER
// (glTF « embedded ») n'allait nulle part : la cuisson n'écrivait `lightmapAsset` que sur les
// matériaux du projet. Le maillage la porte maintenant (`userData.lightmapOverride`), elle est
// persistée dans l'entrée d'atlas du nœud et reposée par les deux moteurs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyLightmapOverrides, clearLightmapOverride, collectAtlasLightmap, reapplyAtlasLightmap } from '../js/lightmap-atlas.js';

function mat(userData){
  return {userData: userData || {}, lightMap: null, clone(){ return mat(Object.assign({}, this.userData)); }};
}
function mesh(m, atlas){
  return {isMesh: true, material: m, userData: {}, geometry: {userData: {lightmapAtlas: atlas}},
          traverse(f){ f(this); }};
}
const applyFake = (m, p) => { m.lightMap = 'tex:' + p.lightmapAsset; m.channel = p.lightmapUv; };

test('un emplacement au matériau du fichier reçoit la lightmap, sur une COPIE', () => {
  const shared = mat();
  const a = mesh(shared), b = mesh(shared);
  a.userData.lightmapOverride = 'lm1';
  assert.equal(applyLightmapOverrides(a, applyFake), 1);
  assert.equal(a.material.lightMap, 'tex:lm1');
  assert.equal(shared.lightMap, null, 'le matériau partagé par les autres instances est intact');
  assert.equal(b.material, shared);
  applyLightmapOverrides(a, applyFake);                 // rejouer ne reclone pas
  assert.ok(a.material.userData.lightmapOwn);
  assert.ok(clearLightmapOverride(a));
  assert.equal(a.material, shared, 'effacer rend le matériau d\'origine');
});

test('un emplacement au matériau du PROJET est laissé à son matériau', () => {
  const p = mat({materialAsset: 'm1'});
  const x = mesh([p, mat()]);
  x.userData.lightmapOverride = 'lm1';
  assert.equal(applyLightmapOverrides(x, applyFake), 1);
  assert.equal(x.material[0], p);
  assert.equal(x.material[1].lightMap, 'tex:lm1');
});

test('la lightmap du maillage est PERSISTÉE dans l\'atlas et relue', () => {
  const x = mesh(mat(), {game: 'uv1', scale: [1, 1], offset: [0, 0]});
  x.userData.lightmapOverride = 'lm1';
  const saved = collectAtlasLightmap(x);
  assert.equal(saved[0].lightmap, 'lm1');
  const y = mesh(mat(), {game: 'uv1', scale: [1, 1], offset: [0, 0]});
  y.userData.lightmapAtlas = saved;
  reapplyAtlasLightmap(y);
  assert.equal(y.userData.lightmapOverride, 'lm1');
});

test('les deux moteurs reposent la lightmap du maillage au chargement, la cuisson l\'écrit', () => {
  const read = (f) => readFileSync(new URL('../js/' + f, import.meta.url), 'utf8');
  assert.match(read('game-runtime.js'), /applyLightmapOverrides\(o, rtApplyLightmap\)/);
  assert.match(read('serialization.js'), /applyLightmapOverrides\(o, applyLightmap\)/);
  assert.match(read('lightmap-bake.js'), /mesh\.userData\.lightmapOverride = asset\.id/);
});

// v1.13.2 — applyLightmapOverrides ne passe que la lightmap ({lightmapAsset, lightmapUv,
// lightmapIntensity}) : textureMaterial lisait `p.tiling[0]` sans repli et levait « Cannot read
// properties of undefined (reading '0') » à l'affectation de la cuisson.
test('textureMaterial tolère des props sans tiling ni offset', () => {
  const src = readFileSync(new URL('../js/materials.js', import.meta.url), 'utf8');
  const corps = src.slice(src.indexOf('export function textureMaterial'));
  const fin = corps.indexOf('\n}');
  assert.match(corps.slice(0, fin), /p\.tiling \|\| \[1, 1\]/);
  assert.match(corps.slice(0, fin), /p\.offset \|\| \[0, 0\]/);
});
