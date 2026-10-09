// Les PRESETS D'IMPORT — un jeu de réglages nommé, rangé dans le projet comme un ASSET.
//
// Trois choses se cassent en silence et qu'aucun usage normal ne révèle tout de suite :
//
//   1. un genre d'asset qui n'écrit pas de fichier n'existe pas pour un projet ouvert en
//      dossier — c'est la régression déjà vécue avec documentUI/sheetStyle (v0.20.0) ;
//   2. un preset qui emporte `materials` affecte à un modèle les matériaux d'un AUTRE fichier,
//      par nom d'emplacement — c'est-à-dire au hasard ;
//   3. un preset appliqué qui toucherait `paramsImport` au lieu du brouillon changerait la
//      scène sans « Appliquer », ce que rien d'autre dans ce panneau ne fait.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { creerContexte } from './engine-env.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const codeSeul = (src) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

const env = creerContexte(['js/assets.js', 'js/materials.js', 'js/model-import.js',
  'js/import-settings.js', 'js/project-settings.js', 'js/ui/prefs.js']);

function projetNeuf(){
  env.assets.length = 0;
}


// ---------- Le genre d'asset ----------

test('les points de branchement du genre `preset` existent, dans les bons fichiers', () => {
  const points = [
    ['js/assets.js', /preset:"preset d'import"/, 'le libellé du genre dans le panneau Projet'],
    ['js/assets.js', /function createAssetPreset/, 'la création'],
    ['js/serialization.js', /kind === 'preset'[\s\S]{0,200}preset:JSON\.parse/, 'la forme inline du .p3d'],
    ['js/serialization.js', /\.preset\.json/, 'l\'écriture sur disque'],
    ['js/project-folder.js', /da\.kind === 'preset'/, 'la relecture depuis le disque'],
    ['js/project-folder.js', /\\.preset\\.json\$\/i,\s*'preset'/, 'la découverte d\'un fichier posé à la main'],
    ['js/import-settings.js', /preset:1/, 'le genre est déclaré SANS paramètres d\'import']
  ];
  const missing = [];
  points.forEach(function(p){
    if(!p[1].test(codeSeul(read(p[0])))) missing.push(p[2] + '  (' + p[0] + ')');
  });
  assert.deepEqual(missing, [], 'points de branchement absents :\n  ' + missing.join('\n  '));
});

test('le preset est ECRIT SUR DISQUE, comme l exige ARCHITECTURE.md', () => {
  const src = codeSeul(read('js/serialization.js'));
  // Dans `diskAssetManifest`, pas seulement dans la forme inline : c'est la moitié qu'on
  // oublie, et celle qui manquait pour documentUI/sheetStyle.
  const block = src.slice(src.indexOf('filesAWrite'));
  assert.match(block, /kind === 'preset'/, 'le genre n\'écrit aucun fichier');
  assert.match(block, /\.preset\.json/);
});


// ---------- Le contenu d'un preset ----------

test('un preset ne porte JAMAIS les emplacements de materiaux', () => {
  const params = env.paramsForPreset({unites:'m', scale:2, materials:{'Corps':'mat-123'}});
  assert.equal(params.materials, undefined,
    'un emplacement est nommé par le fichier : le recopier affecterait le mauvais matériau');
  assert.equal(params.scale, 2, 'le reste des réglages doit bien être retenu');
});

test('les presets sont filtres PAR GENRE VISE', () => {
  projetNeuf();
  env.createAssetPreset('model', 'Personnage', {scale:1}, '');
  env.createAssetPreset('texture', 'Interface', {mipmaps:false}, '');
  assert.equal(env.importPresetsOf('model').map((p) => p.name).join(), 'Personnage');
  assert.equal(env.importPresetsOf('texture').map((p) => p.name).join(), 'Interface');
});

test('un preset cree atterrit dans le dossier demande', () => {
  projetNeuf();
  const p = env.createAssetPreset('model', 'Personnage', {scale:1}, 'Presets/Persos');
  assert.equal(p.folder, 'Presets/Persos');
  assert.equal(p.kind, 'preset');
  assert.equal(p.preset.kind, 'model', 'le genre visé vit dans `preset.kind`');
});

test('appliquer un preset remplit le BROUILLON, et ne touche pas la scene', () => {
  projetNeuf();
  const preset = env.createAssetPreset('model', 'Personnage',
    {unites:'cm', scale:4, lightmapUv:true}, '');
  const a = {id:'m1', kind:'model', name:'SK_Enfant', folder:'Personnages'};
  env.ensureParamsImport(a);
  const applique = JSON.parse(JSON.stringify(a.paramsImport));

  assert.equal(env.applyImportPreset(a, preset.id), true);
  assert.equal(a.paramsDraft.scale, 4);
  assert.equal(a.paramsDraft.unites, 'cm');
  assert.equal(a.paramsDraft.lightmapUv, true);
  assert.equal(JSON.stringify(a.paramsImport), JSON.stringify(applique),
    'RIEN ne doit être appliqué avant « 💾 Appliquer » — c\'est tout le contrat du panneau');
  assert.equal(env.importDirty(a), true, 'le panneau doit signaler des réglages non appliqués');
});

test('un preset applique PART DES DEFAUTS pour ce qu il ne dit pas', () => {
  projetNeuf();
  // Un preset écrit avant qu'un réglage existe ne doit pas laisser traîner l'ancienne valeur
  // de l'asset : sinon deux modèles « au même preset » n'importent pas pareil.
  const preset = env.createAssetPreset('model', 'Minimal', {scale:4}, '');
  const a = {id:'m2', kind:'model', name:'Caisse'};
  env.ensureParamsImport(a);
  a.paramsImport.centrer = false;
  env.applyImportPreset(a, preset.id);
  assert.equal(a.paramsDraft.centrer, env.IMPORT_DEFAULT.model.centrer,
    'ce que le preset ne dit pas revient au défaut, pas à la valeur précédente de l\'asset');
});

test('appliquer un preset garde les emplacements de materiaux DE CET asset', () => {
  projetNeuf();
  const preset = env.createAssetPreset('model', 'Personnage', {scale:4}, '');
  const a = {id:'m3', kind:'model', name:'SK_Enfant'};
  env.ensureParamsImport(a);
  a.paramsImport.materials = {'Corps':'mat-abc'};
  env.applyImportPreset(a, preset.id);
  assert.equal(JSON.stringify(a.paramsDraft.materials), '{"Corps":"mat-abc"}');
});

test('un preset d un AUTRE genre est refuse', () => {
  projetNeuf();
  const preset = env.createAssetPreset('texture', 'Interface', {mipmaps:false}, '');
  const a = {id:'m4', kind:'model', name:'Caisse'};
  env.ensureParamsImport(a);
  assert.equal(env.applyImportPreset(a, preset.id), false);
  assert.equal(a.paramsDraft, undefined, 'rien ne doit avoir été posé dans le brouillon');
});


// ---------- Le chemin affiché dans l'en-tête ----------

test('le chemin montre le dossier du PROJET, sans le prefixe assets/', () => {
  // `assets/` est vrai sur le disque mais ne distingue aucun asset : il ne fait que manger la
  // largeur de l'en-tête sur une arborescence déjà profonde.
  assert.equal(env.pathFolderAsset({kind:'model'}), '');
  assert.equal(env.pathFolderAsset({kind:'model', folder:'_Art/Characters'}), '_Art/Characters');
});

test('le chemin DISQUE, lui, garde assets/ — il doit exister', () => {
  assert.equal(env.pathDiskAsset({kind:'model'}), 'assets');
  assert.equal(env.pathDiskAsset({kind:'model', folder:'_Art/Characters'}),
    'assets/_Art/Characters');
});

test('le chemin complet colle la racine du disque et passe en separateurs Windows', () => {
  env.Prefs.set('project.rootsDisk', {Test: 'E:\\Jeux\\MonJeu'});
  assert.equal(env.rootDiskProject(), 'E:\\Jeux\\MonJeu',
    'la racine est retenue par projet — le navigateur ne la connaît jamais');
  assert.equal(env.fullPathAsset({kind:'model', folder:'_Art'}),
    'E:\\Jeux\\MonJeu\\assets\\_Art');
  env.Prefs.set('project.rootsDisk', {});
});
