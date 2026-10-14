// UN MAILLAGE CUIT NE SE REGROUPE PAS EN INSTANCES.
//
// Panne : la lightmap se voit dans l'éditeur et « disparaît » dans le jeu publié. Le jeu publié
// appelle `instantiateStatic` (js/render-perf.js) après la construction de la scène. Les objets
// cuits d'un même matériau — dix murs, vingt dalles — ont la même clé de lot : même asset de
// matériau, et une géométrie qui garde son `type` et ses `parameters` après le détachement de la
// cuisson (prepareAutoUnwrap / geometryForWrite les recopient exprès). Or un InstancedMesh n'a
// qu'UNE géométrie, celle du premier : tous les objets du lot échantillonnaient la région d'atlas
// du premier (`uv1`), donc son éclairage — l'éclairage cuit de chacun disparaissait.
//
// L'`uv1` d'atlas est propre à CHAQUE maillage : un objet cuit n'est donc pas regroupable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { creerContexte } from './engine-env.mjs';

function contexte(){
  return creerContexte(['js/primitive-geometry.js', 'js/lightmap-unwrap.js',
    'js/lightmap-atlas.js', 'js/render-perf.js']);
}

test('deux cubes cuits à deux places de l atlas ne partagent PAS un lot', () => {
  const ctx = contexte();
  const r = vm.runInContext(`
    const mat = new THREE.MeshStandardMaterial();
    const scn = new THREE.Scene();
    const cubes = [];
    for(let i = 0; i < 10; i++){
      const o = new THREE.Mesh(primitiveGeometry(THREE, 'cube'), mat);
      o.userData.materialId = 'm1';
      o.position.set(i * 2, 0, 0);
      // le chemin de la relecture (éditeur ET jeu publié) : une entrée d'atlas par objet
      o.userData.lightmapAtlas = [{game:'auto', scale:[0.1, -0.1], offset:[i * 0.1, 1], pad:0.01}];
      reapplyAtlasLightmap(o);
      scn.add(o);
      cubes.push(o);
    }
    ({
      uvDiff: cubes[0].geometry.attributes.uv1.array[0] !== cubes[1].geometry.attributes.uv1.array[0],
      instantiable: instantiable(cubes[1]),
      batched: instantiateStatic(scn, cubes)
    });
  `, ctx);
  assert.ok(r.uvDiff, 'précondition : chaque cube a son propre uv1 d atlas');
  assert.equal(r.instantiable, false, 'un maillage cuit ne peut pas être dessiné par un lot');
  assert.equal(r.batched, 0, 'aucun cube cuit ne doit partir dans un InstancedMesh');
});

test('les mêmes cubes NON cuits se regroupent toujours', () => {
  const ctx = contexte();
  const n = vm.runInContext(`
    const mat = new THREE.MeshStandardMaterial();
    const scn = new THREE.Scene();
    const cubes = [];
    for(let i = 0; i < 10; i++){
      const o = new THREE.Mesh(primitiveGeometry(THREE, 'cube'), mat);
      o.userData.materialId = 'm1';
      scn.add(o);
      cubes.push(o);
    }
    instantiateStatic(scn, cubes);
  `, ctx);
  assert.equal(n, 10);
});
