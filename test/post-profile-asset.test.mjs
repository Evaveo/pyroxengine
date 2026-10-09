import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
import { creerContexte } from './engine-env.mjs';

// import-settings.js est nécessaire ici pour la même raison que dans les tests de
// createAssetMaterial (ex. hauteur.test.mjs) : updateProject(), appelé par
// createAssetPostProfile(), référence le IMPORT_DEFAULT global qu'il déclare.
const env = creerContexte(['js/assets.js', 'js/post-profile.js', 'js/model-import.js', 'js/import-settings.js']);

test('createAssetPostProfile crée un asset avec tous les effets neutres, aucun overridden', () => {
  const before = env.assets.length;
  const a = env.createAssetPostProfile();
  assert.equal(env.assets.length, before + 1);
  assert.equal(a.kind, 'postProfile');
  ['bloom', 'vignette', 'grain', 'toneMapping', 'colorGrading'].forEach(function(cle){
    assert.ok(a.effects[cle], 'effet manquant : ' + cle);
    assert.equal(a.effects[cle].overridden, false);
  });
});

test('deux profils créés à la suite ont des ids distincts et des noms numérotés', () => {
  const a = env.createAssetPostProfile();
  const b = env.createAssetPostProfile();
  assert.notEqual(a.id, b.id);
  assert.notEqual(a.name, b.name);
});

test('ensurePostProfileDefaults complète un profil partiel (fichier disque ancien/édité à la main)', () => {
  const partiel = { bloom: { overridden: true, intensity: 2 } };
  const complet = env.ensurePostProfileDefaults(partiel);
  assert.equal(complet.bloom.overridden, true);
  assert.equal(complet.bloom.intensity, 2);
  assert.equal(complet.bloom.threshold, 0.8, 'champ manquant du fichier : rempli par le défaut');
  assert.ok(complet.vignette, 'effet absent du fichier entièrement : rempli par le défaut');
  assert.equal(complet.vignette.overridden, false);
});

test('resolveAssetDescriptors comble un .postprofile.json partiel (fichier disque édité à la main)', async () => {
  const e = creerContexte(['js/assets.js', 'js/materials.js', 'js/model-import.js', 'js/import-settings.js',
                            'js/project-settings.js', 'js/serialization.js', 'js/project-folder.js', 'js/post-profile.js']);
  const descripteur = {id:'p1', kind:'postProfile', name:'Lave', folder:'', file:'lave.postprofile.json'};
  // Fichier disque partiel : vignette absente, bloom sans threshold ni radius.
  const contenuDisque = JSON.stringify({bloom: {overridden: true, intensity: 2}});
  vm.runInContext(`
    globalThis.__arbre = { files: [{ filePath: 'assets/lave.postprofile.json',
      handle: { getFile: async () => ({ text: async () => ${JSON.stringify(contenuDisque)} }) } }] };
  `, e);
  const resolus = await vm.runInContext(
    'resolveAssetDescriptors(' + JSON.stringify([descripteur]) + ', globalThis.__arbre)', e);
  const effects = resolus[0].effects;
  assert.equal(effects.bloom.overridden, true);
  assert.equal(effects.bloom.intensity, 2);
  assert.equal(effects.bloom.threshold, 0.8, 'champ manquant du fichier : rempli par le défaut');
  assert.ok(effects.vignette, 'effet absent du fichier entièrement : rempli par le défaut');
  assert.equal(effects.vignette.overridden, false);
});

test('un postProfile survit a un aller-retour assetsSerialized -> rebuildAssetsFromDescriptors (projet monofichier)', async () => {
  const e = creerContexte(['js/assets.js', 'js/materials.js', 'js/model-import.js', 'js/import-settings.js',
                            'js/project-settings.js', 'js/serialization.js', 'js/post-profile.js']);
  vm.runInContext(`
    globalThis.__a = createAssetPostProfile();
    globalThis.__a.effects.bloom.overridden = true;
    globalThis.__a.effects.bloom.intensity = 2;
  `, e);
  const descripteurs = await vm.runInContext('assetsSerialized()', e);
  const d = descripteurs.find(function(x){ return x.kind === 'postProfile'; });
  assert.ok(d, 'assetsSerialized doit produire un descripteur postProfile');
  assert.equal(d.effects.bloom.overridden, true);
  assert.equal(d.effects.bloom.intensity, 2);

  vm.runInContext('assets.length = 0;', e);   // repart d'un projet vide, comme au rechargement
  await vm.runInContext(
    'rebuildAssetsFromDescriptors(' + JSON.stringify(descripteurs) + ', async () => null)', e);
  const recharge = vm.runInContext('assets.find(a => a.kind === "postProfile")', e);
  assert.ok(recharge);
  assert.equal(recharge.effects.bloom.overridden, true);
  assert.equal(recharge.effects.bloom.intensity, 2);
  assert.equal(recharge.effects.vignette.overridden, false, 'effets non modifiés préservés');
});

test('rebuildAssetsFromDescriptors comble un postProfile partiel (descripteur inline édité à la main)', async () => {
  const e = creerContexte(['js/assets.js', 'js/materials.js', 'js/model-import.js', 'js/import-settings.js',
                            'js/project-settings.js', 'js/serialization.js', 'js/post-profile.js']);
  const descripteur = {id:'p1', kind:'postProfile', name:'Lave', folder:'',
    effects: {bloom: {overridden: true, intensity: 3}}};   // vignette absente, bloom incomplet
  await vm.runInContext(
    'rebuildAssetsFromDescriptors(' + JSON.stringify([descripteur]) + ', async () => null)', e);
  const recharge = vm.runInContext('assets.find(a => a.kind === "postProfile")', e);
  assert.ok(recharge);
  assert.equal(recharge.effects.bloom.overridden, true);
  assert.equal(recharge.effects.bloom.intensity, 3);
  assert.equal(recharge.effects.bloom.threshold, 0.8, 'champ manquant du descripteur : rempli par le défaut');
  assert.ok(recharge.effects.vignette, 'effet absent du descripteur entièrement : rempli par le défaut');
  assert.equal(recharge.effects.vignette.overridden, false);
});

// ---- Le jeu publié doit voir les profils, et une seule source doit alimenter le pipeline ----
// Ces deux vérifications sont faites sur la SOURCE : game-runtime.js n'est pas chargeable dans
// le harnais (il attend un document de jeu complet), et les deux régressions qu'elles gardent
// sont muettes à l'exécution — aucune erreur, juste une image qui ne bouge jamais.
test('game-runtime charge les assets postProfile dans assetsById', () => {
  const src = fs.readFileSync(path.join(root, 'js/game-runtime.js'), 'utf8');
  assert.match(src, /da\.kind === 'postProfile'/,
    'sans cette branche, PostVolume.profile est toujours null dans le jeu publié');
});

test('aucun pipeline ne retombe sur env.post : PostVolume + profils sont la seule source', () => {
  const editeur = fs.readFileSync(path.join(root, 'js/postfx.js'), 'utf8');
  const jeu = fs.readFileSync(path.join(root, 'js/game-runtime.js'), 'utf8');
  const corpsPostRender = editeur.slice(editeur.indexOf('function postRender('));
  assert.equal(/ensurePost\(\)/.test(corpsPostRender), false,
    'un repli sur env.post rend les profils sans effet visible, en silence');
  const corpsEtat = jeu.slice(jeu.indexOf('function rtCurrentPostState('),
                              jeu.indexOf('function rtCreateMaterialBright('));
  assert.equal(/rtEnvCurrent\.post/.test(corpsEtat), false,
    'même règle côté jeu publié, sinon éditeur et jeu divergent');
});

test('le profileId d un PostVolume est remappé à la réouverture, comme toute référence d asset', async () => {
  // Les ids d assets sont RÉATTRIBUÉS au chargement d un projet. Une référence oubliée dans
  // remapReferencesAssetsInScenes() survit intacte dans le fichier et ne désigne plus rien —
  // ici : plus aucun post-traitement, ni dans l éditeur ni dans le jeu, sans le moindre message.
  const e = creerContexte(['js/assets.js', 'js/materials.js', 'js/model-import.js', 'js/import-settings.js',
                            'js/project-settings.js', 'js/serialization.js', 'js/post-profile.js']);
  const scenes = [{name:'S', data:{objects:[
    {id:'o1', components:[{type:'PostVolume', data:{profileId:'ancien-id', global:true}}]}
  ]}}];
  const table = {'ancien-id': {id:'a99', kind:'postProfile', name:'Profil 1'}};
  vm.runInContext('globalThis.__scenes = ' + JSON.stringify(scenes)
    + '; globalThis.__table = ' + JSON.stringify(table)
    + '; remapReferencesAssetsInScenes(__scenes, __table);', e);
  const remappe = vm.runInContext('__scenes[0].data.objects[0].components[0].data.profileId', e);
  assert.equal(remappe, 'a99', 'le profil du PostVolume doit suivre le nouvel id de son asset');

  // Un profil supprimé du projet rend null, jamais un id mort.
  vm.runInContext('__scenes[0].data.objects[0].components[0].data.profileId = "disparu";'
    + 'remapReferencesAssetsInScenes(__scenes, __table);', e);
  assert.equal(vm.runInContext('__scenes[0].data.objects[0].components[0].data.profileId', e), null);
});
