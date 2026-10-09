// moteur/test/height.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte, fabriquerFichierTexture } from './engine-env.mjs';

const env = creerContexte(['js/assets.js', 'js/materials.js', 'js/model-import.js', 'js/import-settings.js', 'js/material-extraction.js']);

test('les deux modes de hauteur branchent des maps three differentes', async () => {
  const file = await fabriquerFichierTexture(env, 'Sol_Height.png', 128, 128, 128, 255);
  const tex = env.createAssetTexture(file);
  await new Promise((r) => setTimeout(r, 10));

  const a = env.createAssetMaterial();
  const p = env.ensurePropsMaterial(a);
  p.heightAsset = tex.id;
  p.heightIntensity = 0.4;

  p.heightMode = 'relief';
  const relief = env.makeMaterialThree(a);
  p.heightMode = 'move';
  const depl = env.makeMaterialThree(a);

  p.heightAsset = null;
  const sans = env.makeMaterialThree(a);

  assert.equal(!!relief.bumpMap, true, 'le mode Relief branche bumpMap');
  assert.equal(!!relief.displacementMap, false, 'le mode Relief ne déplace RIEN');
  assert.equal(relief.bumpScale, 0.4);

  assert.equal(!!depl.displacementMap, true, 'le mode Déplacement branche displacementMap');
  assert.equal(!!depl.bumpMap, false, 'le mode Déplacement n’ajoute pas de bump par-dessus');
  assert.equal(depl.displacementScale, 0.4);
  assert.equal(depl.displacementBias, -0.2,
    'biais = −échelle/2 : le gris medium doit valoir « surface d’origine », sinon l’object gonfle');

  assert.equal(!!sans.bumpMap, false);
  assert.equal(!!sans.displacementMap, false);
});

test('le suffixe _Height est reconnu comme role height', () => {
  const conv = env.namingCurrent();
  const read = (n) => { const r = env.analyzeNameTexture(n, conv); return r && r.role; };
  assert.equal(read('Sol_Height.png'), 'height');
  assert.equal(read('Sol_Displacement.png'), 'height');
  assert.equal(read('Sol_H.png'), null, 'un suffixe d’une lettre reste filtré sans préfixe');
  assert.equal(read('TX_Sol_H.png'), 'height');
});
