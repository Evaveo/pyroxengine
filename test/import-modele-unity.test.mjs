// moteur/test/import-modele-unity.test.mjs
//
// Les réglages de l'onglet Modèle ajoutés pour rejoindre Unity (v0.159) : lissage par angle,
// Swap UVs, blend shapes, caméras / lumières, visibilité (js/model-import.js).
//
// Même exigence que import-modele-geometrie.test.mjs : chaque réglage est RÉVERSIBLE, sans
// relire le fichier.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte } from './engine-env.mjs';

const env = creerContexte(['js/model-import.js', 'js/lightmap-bake.js']);
const THREE = env.THREE;

/** Un cube dont les huit coins sont PARTAGÉS par ses douze triangles. */
function cubeSoude(){
  const pos = new Float32Array([
    -1,-1,-1,  1,-1,-1,  1, 1,-1, -1, 1,-1,
    -1,-1, 1,  1,-1, 1,  1, 1, 1, -1, 1, 1]);
  const idx = [0,2,1, 0,3,2,  4,5,6, 4,6,7,  0,1,5, 0,5,4,
               3,6,2, 3,7,6,  1,2,6, 1,6,5,  0,4,7, 0,7,3];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  return geo;
}

function normalesDistinctes(geo){
  const n = geo.attributes.normal, set = new Set();
  for(let i = 0; i < n.count; i++){
    set.add(Math.round(n.getX(i) * 100) + ',' + Math.round(n.getY(i) * 100) + ','
      + Math.round(n.getZ(i) * 100));
  }
  return set.size;
}

function params(extra){
  return Object.assign({}, env.MODEL_IMPORT_DEFAULT, extra);
}

test('un angle de lissage sous 90° rend un cube aux arêtes DURES : six normales, pas huit', () => {
  const geo = cubeSoude();
  env.applyGeoImport(geo, params({normals:'calculate', smoothnessSource:'angle',
    smoothingAngle:60}), [], 'cube');
  assert.equal(normalesDistinctes(geo), 6, 'une normale par face du cube');
  assert.equal(geo.attributes.position.count, 24, 'chaque coin dédoublé une fois par face');
});

test('un angle de 180° lisse tout ce qui se touche', () => {
  const geo = cubeSoude();
  env.applyGeoImport(geo, params({normals:'calculate', smoothnessSource:'angle',
    smoothingAngle:180}), [], 'cube');
  assert.equal(normalesDistinctes(geo), 8, 'chaque coin moyenne ses trois faces');
  assert.equal(geo.attributes.position.count, 8, 'rien à dédoubler');
});

test('revenir aux groupes du fichier rend le nombre de sommets du fichier', () => {
  const geo = cubeSoude();
  env.applyGeoImport(geo, params({normals:'calculate', smoothnessSource:'none'}), [], 'cube');
  assert.equal(geo.attributes.position.count, 24);
  env.applyGeoImport(geo, params({normals:'calculate', smoothnessSource:'groups'}), [], 'cube');
  assert.equal(geo.attributes.position.count, 8, 'les sommets dédoublés sont rendus');
  assert.equal(normalesDistinctes(geo), 8);
});

test('Swap UVs échange les deux jeux, et le décocher les rend', () => {
  const geo = new THREE.PlaneGeometry(1, 1);
  const uv = Array.from(geo.attributes.uv.array);
  const uv1 = uv.map(function(v){ return v * 0.5; });
  geo.setAttribute('uv1', new THREE.BufferAttribute(new Float32Array(uv1), 2));
  env.applyGeoImport(geo, params({swapUvs:true}), [], 'plan');
  assert.equal(geo.attributes.uv.getX(1), uv1[2]);
  assert.equal(geo.attributes.uv1.getX(1), uv[2]);
  env.applyGeoImport(geo, params({swapUvs:false}), [], 'plan');
  assert.equal(geo.attributes.uv.getX(1), uv[2]);
  assert.equal(geo.attributes.uv1.getX(1), uv1[2]);
});

test('décocher les blend shapes les retire du maillage, recocher les rend', () => {
  const geo = new THREE.PlaneGeometry(1, 1);
  const delta = new Float32Array(geo.attributes.position.count * 3).fill(0.1);
  geo.morphAttributes.position = [new THREE.BufferAttribute(delta, 3)];
  geo.morphTargetsRelative = true;
  const mesh = new THREE.Mesh(geo);
  const root = new THREE.Group();
  root.add(mesh);
  env.applyModelGeometry(root, {importBlendShapes:false});
  assert.equal(Object.keys(geo.morphAttributes).length, 0);
  assert.ok(!mesh.morphTargetInfluences || mesh.morphTargetInfluences.length === 0);
  env.applyModelGeometry(root, {importBlendShapes:true});
  assert.equal(geo.morphAttributes.position.length, 1);
  assert.equal(mesh.morphTargetInfluences.length, 1, 'le maillage relit ses cibles');
});

test('les normales des blend shapes se calculent, ou se retirent', () => {
  const geo = new THREE.PlaneGeometry(1, 1);
  const delta = new Float32Array(geo.attributes.position.count * 3);
  for(let i = 0; i < geo.attributes.position.count; i++) delta[i * 3 + 2] = (i % 2) * 0.3;
  geo.morphAttributes.position = [new THREE.BufferAttribute(delta, 3)];
  geo.morphTargetsRelative = true;
  env.applyGeoImport(geo, params({blendShapeNormals:'calculate'}), [], 'p');
  assert.equal(geo.morphAttributes.normal.length, 1);
  assert.ok(Array.from(geo.morphAttributes.normal[0].array).every(Number.isFinite), 'aucun NaN');
  env.applyGeoImport(geo, params({blendShapeNormals:'none'}), [], 'p');
  assert.equal(geo.morphAttributes.normal, undefined);
});

test('décocher lumières et caméras les retire, leurs enfants restent en place dans le monde', () => {
  const root = new THREE.Group();
  const lum = new THREE.PointLight();
  lum.position.set(1, 2, 3);
  const cam = new THREE.PerspectiveCamera();
  cam.position.set(0, 5, 0);
  const enfant = new THREE.Mesh(new THREE.BoxGeometry());
  enfant.position.set(1, 0, 0);
  cam.add(enfant);
  root.add(lum, cam);
  root.updateMatrixWorld(true);
  const avant = Array.from(enfant.matrixWorld.elements);

  const r = env.applyModelHierarchy(root, {importLights:false, importCameras:false}, []);
  assert.equal(r.stripped, 2);
  assert.equal(root.children.length, 1, 'il ne reste que l’enfant de la caméra');
  root.updateMatrixWorld(true);
  enfant.matrixWorld.elements.forEach(function(v, i){
    assert.ok(Math.abs(v - avant[i]) < 1e-6, 'élément ' + i);
  });

  env.applyModelHierarchy(root, {importLights:true, importCameras:true}, []);
  assert.equal(root.children.length, 2, 'lumière et caméra reviennent');
  assert.equal(enfant.parent, cam);
});

test('décocher la visibilité montre ce que le fichier cachait, recocher le recache', () => {
  const root = new THREE.Group();
  const cache = new THREE.Mesh(new THREE.BoxGeometry());
  cache.visible = false;
  root.add(cache);
  env.applyModelHierarchy(root, {importVisibility:false}, []);
  assert.equal(cache.visible, true);
  env.applyModelHierarchy(root, {importVisibility:true}, []);
  assert.equal(cache.visible, false);
});
