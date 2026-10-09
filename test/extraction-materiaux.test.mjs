// moteur/test/extraction-materials.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte } from './engine-env.mjs';

const env = creerContexte(['js/assets.js', 'js/materials.js', 'js/model-import.js', 'js/import-settings.js', 'js/material-extraction.js']);

// Fabrique un fichier 2×2 dont le contenu n'est jamais lu par ces tests (seul le NOM count
// pour la reconnaissance de rôle) : un simple fichier empty suffit, plus léger que de passer
// par un vrai canvas.
function fichierVide(name){
  return new File([new Blob([new Int32Array([2, 2]).buffer, new Uint8ClampedArray(16)])], name, { type: 'image/png' });
}

// Équivalent, sans createAssetModel ni système Noeud+Component, de ce que
// extractMaterialsModel lit réellement sur un asset modèle : deux emplacements de matériau
// (M_NomA, M_NomB) et les fichiers arrivés avec le modèle.
function modeleDeTest(fileNames){
  const matA = { name: 'M_NomA', isMeshPhongMaterial: true };
  const matB = { name: 'M_NomB', isMeshPhongMaterial: true };
  return {
    id: 'model' + Math.floor(Math.random() * 1e9), kind: 'model', name: 'Voiture', folder: '',
    matBruts: [[matA], [matB]],
    paquet: fileNames.map(fichierVide),
    paramsImport: null
  };
}

test('la convention de nommage lit les noms de fichiers comme prevu', () => {
  const conv = env.namingCurrent();
  const names = ['TX_NomA_C.png', 'TX_NomA_MADS.png', 'TX_NomB_N.png',
                'TX_NomA_Metal.png', 'reference.png', 'TX_NomA.png'];
  const lu = {};
  names.forEach((n) => {
    const info = env.analyzeNameTexture(n, conv);
    lu[n] = info ? info.role + ':' + info.base : null;
  });

  assert.equal(lu['TX_NomA_C.png'], 'color:NomA');
  assert.equal(lu['TX_NomA_MADS.png'], 'combined:NomA', '« _MADS » ne doit pas être lu comme « _M »');
  assert.equal(lu['TX_NomA_Metal.png'], 'metal:NomA');
  assert.equal(lu['TX_NomB_N.png'], 'normal:NomB');
  assert.equal(lu['reference.png'], null, 'sans le préfixe de textures, un fichier posé à côté n\'est pas candidat');
  assert.equal(lu['TX_NomA.png'], 'color:NomA', 'sans suffixe reconnu : couleur de base');
  assert.equal(env.baseMaterialNaming('M_NomA', conv), 'NomA');
  assert.equal(env.baseMaterialNaming('Carrosserie', conv), 'Carrosserie');
});

test('Extraire les materiaux cree un materiau par emplacement et branche les bonnes maps', async () => {
  const a = modeleDeTest(['TX_NomA_C.png', 'TX_NomA_MADS.png', 'TX_NomB_N.png', 'reference.png']);
  const summary = env.extractMaterialsModel(a);
  await new Promise((r) => setTimeout(r, 10));   // laisse les createAssetTexture internes se résoudre

  const mat = (name) => env.assets.find((x) => x.kind === 'material' && x.name === name);
  const nameTex = (idTex) => { const t = env.assets.find((x) => x.id === idTex); return t ? t.name : null; };
  const mA = mat('M_NomA'), mB = mat('M_NomB');

  assert.equal(summary.materials, 2, 'un matériau par emplacement du fichier');
  assert.equal(a.paramsImport.materials.M_NomA, mA.id, 'l\'emplacement pointe sur le matériau extrait');
  assert.equal(a.paramsImport.materials.M_NomB, mB.id);
  assert.equal(mA.props.color, '#ffffff', 'un matériau extrait part en blanc');
  assert.equal(mA.props.metal, 1, 'un matériau extrait part en métal 1');
  assert.equal(nameTex(mA.props.texAsset), 'TX_NomA_C.png');
  assert.equal(nameTex(mA.props.combineAsset), 'TX_NomA_MADS.png');
  assert.equal(nameTex(mA.props.normalAsset), null, 'la normale de NomB ne doit PAS atterrir sur le matériau NomA');
  assert.equal(nameTex(mB.props.normalAsset), 'TX_NomB_N.png');
  assert.equal(nameTex(mB.props.texAsset), null, 'aucune couleur de base pour NomB : il n\'y en a pas');

  const textures = env.assets.filter((x) => x.kind === 'texture')
    .map((x) => x.name + '|' + (x.folder || '') + '|' + env.ensureParamsImport(x).type).sort();
  // realm croisé (voir dossierProjet.test.mjs) : env.assets.filter/.map/.sort produisent un
  // Array du realm vm, dont le prototype diffère de celui du realm de test — assert.deepEqual
  // compare aussi le prototype, d'où le passage par JSON.parse(JSON.stringify(...)).
  assert.deepEqual(JSON.parse(JSON.stringify(textures)),
    ['TX_NomA_C.png||color', 'TX_NomA_MADS.png||data', 'TX_NomB_N.png||normal']);
  assert.equal(summary.texturesCreees, 3);
  assert.equal(summary.maps, 3);
});

test('re-extraire complete sans ecraser une map posee a la main', async () => {
  const a = modeleDeTest(['TX_NomA_C.png']);
  env.extractMaterialsModel(a);
  await new Promise((r) => setTimeout(r, 10));
  const mA = env.assets.find((x) => x.kind === 'material' && x.name === 'M_NomA');
  const premiere = env.assets.find((x) => x.kind === 'texture');

  mA.props.texAsset = 'choisi-a-la-main';
  a.paquet.push(fichierVide('TX_NomA_N.png'));
  const summary = env.extractMaterialsModel(a);
  await new Promise((r) => setTimeout(r, 10));
  const nameTex = (idTex) => { const t = env.assets.find((x) => x.id === idTex); return t ? t.name : idTex; };

  assert.equal(mA.props.texAsset, 'choisi-a-la-main', 'un choix manuel survit à une ré-extraction');
  assert.equal(nameTex(mA.props.normalAsset), 'TX_NomA_N.png', 'la texture ajoutée depuis est branchée');
  assert.equal(summary.materials, 0, 'aucun matériau créé en double');
  assert.equal(summary.repris, 2, 'les deux matériaux existants sont repris');
  assert.equal(env.assets.filter((x) => x.kind === 'material').length, 2);
  assert.equal(premiere && premiere.name, 'TX_NomA_C.png');
});

test('une convention personnalisee est lue depuis les preferences', () => {
  env.registerNaming({
    prefixeTexture: '', prefixeMaterial: 'mat_',
    suffixes: { color: '_basecolor', normal: '_normal', combined: '_mask',
                emissive: '_emissive', roughness: '_rough', metal: '_metal', ao: '_ao' },
    correspondance: 'souple', ignorerCasse: true, withoutSuffixColor: false
  });
  const conv = env.namingCurrent();

  assert.deepEqual(JSON.parse(JSON.stringify(env.analyzeNameTexture('Bois_BaseColor.png', conv))),
    { base: 'Bois', role: 'color', suffix: '_basecolor' });
  assert.equal(env.analyzeNameTexture('Bois.png', conv), null);
  assert.ok(env.gapBases('Bois_Planches', 'Bois', conv) > 0, 'la correspondance souple accepte une base prolongée');
  assert.equal(env.baseMaterialNaming('mat_Bois', conv), 'Bois');
});
