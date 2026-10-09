// moteur/test/lissage.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte, fabriquerFichierTexture } from './engine-env.mjs';

const env = creerContexte(['js/assets.js', 'js/materials.js', 'js/model-import.js', 'js/import-settings.js', 'js/project-settings.js', 'js/serialization.js']);

test('le lissage arrive en rugosite inversee sur le materiau three', () => {
  const a = env.createAssetMaterial();
  const p = env.ensurePropsMaterial(a);
  p.smoothness = 1;
  const miroir = env.makeMaterialThree(a);
  p.smoothness = 0;
  const mat = env.makeMaterialThree(a);
  p.smoothness = 0.25;
  const entre = env.makeMaterialThree(a);

  assert.equal(miroir.roughness, 0, 'lissage 1 = rugosité 0');
  assert.equal(mat.roughness, 1, 'lissage 0 = rugosité 1');
  assert.equal(entre.roughness, 0.75);
  assert.equal(env.MATERIAL_DEFAULT.smoothness, 0.45, 'le défaut reste l\'aspect historique (rugosité 0,55)');
  assert.ok(Math.abs(env.smoothingFromRoughness(env.roughnessFromSmoothing(0.8)) - 0.8) < 1e-9);
});

test('le lissage multiplie sa map, dans le shader', async () => {
  const file = await fabriquerFichierTexture(env, 'TX_Test_R.png', 128, 128, 128, 255);
  const tex = env.createAssetTexture(file);
  await new Promise((r) => setTimeout(r, 10));

  const a = env.createAssetMaterial();
  const p = env.ensurePropsMaterial(a);
  p.smoothness = 0.8;
  p.metal = 0.3;
  const sansMap = env.makeMaterialThree(a);
  env.ensurePropsMaterial(a).roughnessAsset = tex.id;
  env.ensurePropsMaterial(a).metalAsset = tex.id;
  const avecMap = env.makeMaterialThree(a);

  const chunk = env.THREE.ShaderChunk.roughnessmap_fragment;
  // LE NOM EST `onBeforeCompile`, celui que three appelle. Le test lisait `onBeforeCompiled`
  // — la faute de frappe du code — et son `if` le rendait vert sans jamais rien mesurer
  // (docs/REVUE_2026-09-14.md § 1). Plus de `if` : l'absence du point d'entrée EST la panne.
  assert.equal(typeof avecMap.onBeforeCompile, 'function',
    'sans onBeforeCompile, three n\'appelle jamais le patch : la correction PBR ne s\'applique pas');
  const faux = { fragmentShader: chunk };
  avecMap.onBeforeCompile(faux);
  const patche = faux.fragmentShader;

  assert.equal(chunk.indexOf(env.GLSL_RUG_THREE) !== -1, true,
    'le chunk roughnessmap_fragment de three doit contenir le motif remplacé — s\'il change, '
    + 'la multiplication en lissage retombe silencieusement sur celle de three');
  assert.ok(!!avecMap.roughnessMap && !!avecMap.metalnessMap, 'les maps doivent être posées pour que le test ait un sens');

  assert.ok(Math.abs(avecMap.roughness - 0.2) < 1e-9,
    'roughness reste 1 − lissage (le shader fait la multiplication) — obtenu ' + avecMap.roughness);
  assert.equal(avecMap.metalness, 0.3, 'metalness reste le factor : three multiplie déjà');
  assert.ok(Math.abs(sansMap.roughness - 0.2) < 1e-9);
  assert.equal(sansMap.metalness, 0.3);

  assert.equal(patche !== null && patche.indexOf(env.GLSL_RUG_SMOOTHING) !== -1, true,
    'la formule en lissage doit remplacer celle de three');
  assert.equal(avecMap.customProgramCacheKey && avecMap.customProgramCacheKey(), 'lissage-multiply',
    'sans clé de hidden propre, three réutiliserait le programme non patché');
  assert.equal(sansMap.customProgramCacheKey && sansMap.customProgramCacheKey() === 'lissage-multiply', false,
    'aucun patch quand il n\'y a pas de map de rugosité');
});

test('l\'emissif suit sa map : noir par defaut, blanc quand une map arrive', async () => {
  const file = await fabriquerFichierTexture(env, 'TX_Test_E.png', 128, 128, 128, 255);
  const tex = env.createAssetTexture(file);
  await new Promise((r) => setTimeout(r, 10));

  const a = env.createAssetMaterial();
  const defaultValue = env.ensurePropsMaterial(a).emissive;

  env.ensurePropsMaterial(a).emissiveAsset = tex.id;
  env.adjustEmissiveByMap(env.ensurePropsMaterial(a), false);
  const avecMap = env.ensurePropsMaterial(a).emissive;
  const troisAvecMap = env.makeMaterialThree(a);

  env.ensurePropsMaterial(a).emissiveAsset = null;
  env.adjustEmissiveByMap(env.ensurePropsMaterial(a), true);
  const sansMap = env.ensurePropsMaterial(a).emissive;

  env.ensurePropsMaterial(a).emissive = '#ff8800';
  env.ensurePropsMaterial(a).emissiveAsset = tex.id;
  env.adjustEmissiveByMap(env.ensurePropsMaterial(a), false);
  const teinteGardee = env.ensurePropsMaterial(a).emissive;

  assert.equal(defaultValue, '#000000', 'un matériau neuf n\'émet rien');
  assert.equal(avecMap, '#ffffff');
  assert.equal('#' + troisAvecMap.emissive.getHexString(), '#ffffff', 'et c\'est bien ce que reçoit three (× la map)');
  assert.equal(!!troisAvecMap.emissiveMap, true);
  assert.equal(sansMap, '#000000');
  assert.equal(teinteGardee, '#ff8800', 'une couleur émissive choisie est conservée');
});

// Réécrit sans passer par la scène/le rendu réels (voir la spec « Cas particulier ») :
// migrateProjectData() directement sur un objet façon v7, comme le fait déjà
// masque-orm.test.mjs pour la migration 8 → 9. Même intention (la migration ne change pas
// l'aspect), sans WebGLRenderer.
test('un project v7 migre vers v8 garde EXACTEMENT le meme aspect (rugosite -> lissage)', () => {
  const v7 = {
    version: 7,
    projectName: 'old',
    current: 0,
    scenes: [{ name: 'S', data: { objects: [{ name: 'CubeBrillant', mat: { roughness: 0.2 } }] } }],
    assets: [{ kind: 'material', name: 'm', props: { roughness: 0.1 } }]
  };
  const apres = env.migrateProjectData(JSON.parse(JSON.stringify(v7)));

  const objetMat = apres.scenes[0].data.objects[0].mat;
  const assetMat = apres.assets[0];
  assert.ok(apres.version >= 8, 'le project doit être migré au moins jusqu\'à la version 8');
  assert.ok(Math.abs(objetMat.smoothness - 0.8) < 1e-9,
    'rugosité 0,2 doit devenir lissage 0,8 (lissage = 1 − rugosite) — obtenu ' + objetMat.smoothness);
  assert.equal(objetMat.roughness, undefined, '`rugosite` ne doit pas subsister sur l’objet de scène');
  assert.ok(Math.abs(assetMat.props.smoothness - 0.9) < 1e-9,
    'rugosité 0,1 doit devenir lissage 0,9 — obtenu ' + assetMat.props.smoothness);
  assert.equal(assetMat.props.roughness, undefined, '`rugosite` ne doit pas subsister dans les props de l’asset');

  // même matériau three qu'avant la migration : le lissage retrouvé doit refabriquer la
  // rugosité de départ.
  const a = env.createAssetMaterial();
  Object.assign(env.ensurePropsMaterial(a), assetMat.props);
  assert.ok(Math.abs(env.makeMaterialThree(a).roughness - 0.1) < 1e-9,
    'le matériau reconstruit doit retrouver exactement sa rugosité three d\'avant migration');
});
