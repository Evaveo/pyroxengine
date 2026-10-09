// moteur/test/masque-orm.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte } from './engine-env.mjs';

const env = creerContexte(['js/assets.js', 'js/materials.js', 'js/model-import.js', 'js/import-settings.js', 'js/project-settings.js', 'js/serialization.js']);

// Fabrique un asset texture 2×2 dont on connaît chaque canal, directement (sans passer par
// createAssetTexture/decodage async) : c'est exactement ce que faisait POSER_TEXTURE dans la
// version Playwright — construire l'asset "à la main" plutôt que via un vrai import de fichier.
function poserTexture(r, g, b, a){
  const cv = env.document.createElement('canvas');
  cv.width = 2; cv.height = 2;
  const cx = cv.getContext('2d');
  const data = cx.createImageData(2, 2);
  for(let i = 0; i < data.data.length; i += 4){
    data.data[i] = r; data.data[i+1] = g; data.data[i+2] = b; data.data[i+3] = a;
  }
  cx.putImageData(data, 0, 0);
  const tex = new env.THREE.CanvasTexture(cv);
  const asset = { id: 'tex' + Math.floor(Math.random() * 1e9), kind: 'texture', name: 'hidden', texture: tex };
  env.assets.push(asset);
  return asset;
}

test('un masque ORM part au GPU tel quel, sans conversion', () => {
  const src = poserTexture(11, 22, 33, 255);
  const a = env.createAssetMaterial();
  const p = env.ensurePropsMaterial(a);
  p.combineAsset = src.id;
  p.combinePacking = 'orm';
  const m = env.makeMaterialThree(a);

  assert.ok(m.roughnessMap && m.metalnessMap && m.aoMap, 'les trois maps doivent être branchées');
  assert.equal(m.roughnessMap, m.metalnessMap, 'une seule texture doit servir les trois');
  assert.equal(m.roughnessMap, m.aoMap);
  assert.equal(m.roughnessMap.image, src.texture.image,
    "un masque ORM ne doit subir AUCUNE conversion : c'est l'image source qui part au GPU");
});

test('un masque HDRP est converti vers ORM', () => {
  // HDRP : R = métal, G = occlusion, A = lissage.
  const src = poserTexture(200, 100, 0, 255);
  const a = env.createAssetMaterial();
  const p = env.ensurePropsMaterial(a);
  p.combineAsset = src.id;
  p.combinePacking = 'unity';
  const m = env.makeMaterialThree(a);

  assert.notEqual(m.roughnessMap.image, src.texture.image,
    'un masque HDRP doit être converti, pas branché tel quel');
  const cv = m.roughnessMap.image;
  const px = cv.getContext('2d').getImageData(0, 0, 1, 1).data;
  assert.equal(px[0], 100, 'R doit recevoir l’occlusion (100)');
  assert.equal(px[1], 255 - 255, 'G doit recevoir la rugosité = 255 − lissage');
  assert.equal(px[2], 200, 'B doit recevoir le métal (200)');
});

test('un project v8 garde EXACTEMENT son aspect (migration 8 -> 9)', () => {
  const v8 = {
    version: 8,
    projectName: 'old',
    current: 0,
    scenes: [{ name: 'S', data: { objects: [{ mat: { combineAsset: 7, smoothness: 0.5 } }] } }],
    assets: [
      { kind: 'material', name: 'm', props: { combineAsset: 7, smoothness: 0.5 } },
      { kind: 'material', name: 'sans masque', props: { smoothness: 0.5 } }
    ]
  };
  const apres = env.migrateProjectData(JSON.parse(JSON.stringify(v8)));

  assert.equal(apres.version, 15);
  assert.equal(apres.assets[0].props.combinePacking, 'unity',
    'un masque existant a été peint en convention HDRP : le nouveau défaut ORM le rendrait faux');
  assert.equal(apres.scenes[0].data.objects[0].mat.combinePacking, 'unity',
    'le matériau local d’un objet de scène doit être migré comme les assets');
  assert.equal(apres.assets[1].props.combinePacking, undefined,
    'un matériau sans masque ne doit pas se voir attribuer un empaquetage');
});
