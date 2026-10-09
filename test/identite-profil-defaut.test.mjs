// moteur/test/identite-profil-defaut.test.mjs
//
// RÉGRESSION (projet hébergé, 2026-09-25) : après enregistrement + rechargement, le profil de
// post-traitement « Profil 1 » et le matériau « Défaut » avaient échangé leurs ids, et un second
// « Défaut » apparaissait dans le dossier du profil. `PostVolume.profileId` pointait un matériau.
//
// Cause : post-profile.js et shader-graph.js — chargés aussi par des pages sans assets.js, donc
// incapables de l'importer — faisaient `++assetId` sur `globalThis.assetId`, une COPIE figée à 0
// au chargement d'assets.js. Le premier profil créé dans une session recevait `a1`, l'id déjà
// porté par « Défaut ». Deux assets de même id dans project.json : le rechargement les confondait.
//
// Le harnais vm partage les `let` de tous les fichiers chargés, ce qui MASQUE la panne (la
// copie morte n'y est jamais lue). On recharge donc post-profile.js dans une portée `with
// (globalThis)`, qui résout `assetId` / `folderCurrent` comme le fait un vrai module ES : par la
// globale, pas par le `let` d'assets.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { creerContexte, deEsm } from './engine-env.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function makeEnv(){
  const env = creerContexte(['js/tile-palette.js', 'js/assets.js', 'js/materials.js',
    'js/model-import.js', 'js/import-settings.js', 'js/post-profile.js', 'js/project-settings.js',
    'js/serialization.js', 'js/project-folder.js']);
  const src = deEsm(readFileSync(path.join(root, 'js/post-profile.js'), 'utf8'));
  vm.runInContext('(function(){ with(globalThis){\n' + src
    + '\nglobalThis.__createProfileAsModule = createAssetPostProfile; } })();', env);
  return env;
}

/** Un arbre virtuel (forme de scanFolder/cloudTree) à partir de {chemin -> contenu}. */
function treeOf(files){
  return {files: Object.keys(files).sort().map(function(p){
    return {filePath: p, handle: {getFile: async function(){
      return {text: async function(){ return files[p]; }}; }}};
  }), folders: []};
}

test('profil créé comme par un module ES : id neuf, jamais celui de « Défaut »', () => {
  const env = makeEnv();
  const def = env.ensureMaterialDefaultProject();
  const prof = env.__createProfileAsModule();
  const ids = env.assets.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length, 'ids en double : ' + ids.join(', '));
  assert.notEqual(prof.id, def.id);
});

test('Défaut déplacé + profil dans un autre dossier : ids, genres, dossiers survivent au rechargement', async () => {
  const env = makeEnv();
  const def = env.ensureMaterialDefaultProject();
  def.folder = 'Materials';
  vm.runInContext('setFolderCurrent("Rendu/PostProcess")', env);
  const prof = env.__createProfileAsModule();
  assert.equal(prof.folder, 'Rendu/PostProcess', 'le profil doit naître dans le dossier courant');
  vm.runInContext('setFolderCurrent("")', env);

  const { assets: manifest, filesAWrite } = env.diskAssetManifest();
  const files = {};
  filesAWrite.forEach((f) => { files[f.filePath] = f.content; });
  const before = env.assets.map((a) => ({id: a.id, kind: a.kind, name: a.name, folder: a.folder || ''}));

  // Rechargement, par le même chemin qu'à l'ouverture (project.js:finalizeOpeningProjectFolder).
  env.assets.length = 0;
  const tree = treeOf(files);
  const declared = JSON.parse(JSON.stringify(manifest));
  const metas = await env.readMetas(tree);
  env.relocateAssetsByMeta(declared, metas, tree);
  const discovered = env.discoverFolderAssets(tree, declared, metas);
  assert.equal(discovered.length, 0, 'aucun fichier ne doit être redécouvert');
  const das = await env.resolveAssetDescriptors(declared.concat(discovered), tree);
  await env.rebuildAssetsFromDescriptors(das, async function(){ throw new Error('aucun binaire'); });

  const after = env.assets.map((a) => ({id: a.id, kind: a.kind, name: a.name, folder: a.folder || ''}));
  const key = (x) => x.id;
  assert.deepEqual(after.sort((a, b) => key(a) < key(b) ? -1 : 1),
                   before.sort((a, b) => key(a) < key(b) ? -1 : 1));
  const defauts = env.assets.filter((a) => a.kind === 'material' && a.byDefault);
  assert.equal(defauts.length, 1, 'un seul matériau par défaut');
  assert.equal(defauts[0].folder, 'Materials');
  // Après chargement, ensureMaterialDefaultProject ne doit pas en créer un second.
  env.ensureMaterialDefaultProject();
  assert.equal(env.assets.filter((a) => a.kind === 'material' && a.name === 'Défaut').length, 1);
});

test('garde : aucun module hors assets.js n incrémente assetId directement', () => {
  const dir = path.join(root, 'js');
  const offenders = [];
  (function walk(d){
    for(const n of listDir(d)){
      const p = path.join(d, n.name);
      if(n.isDirectory()) walk(p);
      else if(n.name.endsWith('.js') && path.relative(dir, p) !== 'assets.js'){
        const s = readFileSync(p, 'utf8');
        if(/\+\+assetId\b|\bassetId\+\+|(^|[^.\w])assetId\s*=[^=]/m.test(s)) offenders.push(path.relative(dir, p));
      }
    }
  })(dir);
  assert.deepEqual(offenders, [], 'utiliser nextAssetId() : ' + offenders.join(', '));
});

function listDir(d){ return readdirSync(d, {withFileTypes: true}); }
