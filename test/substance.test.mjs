// moteur/test/substance.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte, fabriquerFichierTexture } from './engine-env.mjs';

const env = creerContexte(['js/assets.js', 'js/materials.js', 'js/model-import.js', 'js/import-settings.js', 'js/material-extraction.js']);

test('les suffixes des prereglages Substance sont reconnus', () => {
  const conv = env.namingCurrent();
  const names = {
    'Sol_BaseColor.png': 'color', 'Sol_Base_Color.png': 'color',
    'Sol_Normal_OpenGL.png': 'normal', 'Sol_Normal_DirectX.png': 'normal',
    'Sol_OcclusionRoughnessMetallic.png': 'combined', 'Sol_ORM.png': 'combined',
    'Sol_ARM.png': 'combined', 'Sol_MaskMap.png': 'combined',
    'Sol_AmbientOcclusion.png': 'ao', 'Sol_Roughness.png': 'roughness',
    'Sol_Metallic.png': 'metal', 'Sol_Emissive.png': 'emissive'
  };
  Object.keys(names).forEach((n) => {
    const r = env.analyzeNameTexture(n, conv);
    assert.equal(r && r.role, names[n], n + ' doit être reconnu comme ' + names[n]);
    assert.equal(r && r.base, 'Sol', n + ' : la base doit rester « Sol », suffixe retiré');
  });
});

test('le prefixe reste un filtre pour les noms ambigus', () => {
  const conv = env.namingCurrent();
  const read = (n) => { const r = env.analyzeNameTexture(n, conv); return r && r.role; };
  assert.equal(read('Sol_BaseColor.png'), 'color', 'un export Substance doit passer sans préfixe');
  assert.equal(read('photo_D.png'), null, 'un suffixe d’une lettre sans préfixe reste filtré');
  assert.equal(read('TX_Sol_D.png'), 'color');
  assert.equal(read('reference-tournage.png'), null, 'une image quelconque ne devient pas une texture');
  assert.equal(read('TX_Sol.png'), 'color');
});

test('le suffixe du masque decide de son empaquetage', () => {
  assert.equal(env.packingFromName('Sol_ORM.png'), 'orm');
  assert.equal(env.packingFromName('Sol_OcclusionRoughnessMetallic.png'), 'orm',
    'le suffixe du préréglage glTF de Substance');
  assert.equal(env.packingFromName('Sol_ARM.png'), 'orm', 'ARM = mêmes canaux que ORM');
  assert.equal(env.packingFromName('Sol_MaskMap.png'), 'unity', 'le préréglage HDRP produit un mask map');
  assert.equal(env.packingFromName('Sol_MADS.png'), 'unity');
  assert.equal(env.packingFromName('Sol_Bidule.png'), 'orm', 'sans indication, on retient la convention native');
});

test('une normale DirectX est detectee et corrigee sur le materiau three', async () => {
  const file = await fabriquerFichierTexture(env, 'Sol_Normal_DirectX.png', 128, 128, 255, 255);
  const tex = env.createAssetTexture(file);
  await new Promise((r) => setTimeout(r, 10));

  const a = env.createAssetMaterial();
  const p = env.ensurePropsMaterial(a);
  p.normalAsset = tex.id;
  p.normalIntensity = 2;

  p.normalDirectX = false;
  const openGL = env.makeMaterialThree(a);
  p.normalDirectX = true;
  const directX = env.makeMaterialThree(a);

  assert.equal(env.isNormalDirectX('Sol_Normal_DirectX.png'), true, 'le suffixe DirectX doit être reconnu');
  assert.equal(env.isNormalDirectX('Sol_Normal_OpenGL.png'), false, 'une normale OpenGL ne doit PAS être corrigée');
  assert.deepEqual([openGL.normalScale.x, openGL.normalScale.y], [2, 2], 'OpenGL : les deux composantes sont positives');
  assert.deepEqual([directX.normalScale.x, directX.normalScale.y], [2, -2],
    'DirectX : seul Y est inversé — c’est toute la différence entre les deux conventions');
});
