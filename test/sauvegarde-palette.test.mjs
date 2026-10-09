// moteur/test/sauvegarde-palette.test.mjs
//
// RÉGRESSION (docs/REVUE_2026-09-14.md § 2, cause n°1). La branche `tilePalette` avait été
// posée dans `assetsSerialized()` alors qu'elle utilise les variables locales de
// `diskAssetManifest()` (`nameFileUnique`, `filesAWrite`) : dès qu'un projet contenait UNE
// palette, les quatre canaux de sauvegarde (dossier-projet, .p3d, autosave, build web)
// mouraient sur un `ReferenceError`, en silence. Un projet 2D est perdu en totalité au
// premier geste du template 2D.
//
// Le test couvre les trois maillons, parce que corriger le premier sans les deux autres rend
// une sauvegarde qui n'écrit rien de relisible : sérialisation inline, manifeste disque, et
// reconstruction à la relecture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte } from './engine-env.mjs';

const env = creerContexte(['js/tile-palette.js', 'js/assets.js', 'js/materials.js',
  'js/model-import.js', 'js/import-settings.js', 'js/project-settings.js', 'js/serialization.js']);

function paletteDeTest(){
  const a = env.createAssetTilePalette('Sol', 0.25);
  a.palette.tiles.push({name:'Herbe', spriteId:null, autotile:true, collision:'full'});
  return a;
}

test('assetsSerialized ne plante pas et embarque la palette (canal .p3d / autosave)', async () => {
  env.assets.length = 0;
  paletteDeTest();
  const das = await env.assetsSerialized();
  const d = das.find((x) => x.kind === 'tilePalette');
  assert.ok(d, 'la palette doit être présente dans le project sérialisé');
  assert.equal(d.name, 'Sol');
  assert.ok(d.palette, 'le contenu de la palette doit être inline : aucun fichier annexe dans ce canal');
  assert.equal(d.palette.cellSize, 0.25);
  assert.equal(d.palette.tiles.length, 1);
  assert.equal(d.palette.tiles[0].collision, 'full');
});

test('diskAssetManifest écrit un vrai fichier .tilepalette.json (mode dossier-projet)', () => {
  env.assets.length = 0;
  paletteDeTest();
  const m = env.diskAssetManifest();
  const d = m.assets.find((x) => x.kind === 'tilePalette');
  assert.ok(d, 'la palette doit être déclarée dans le manifeste disque');
  assert.match(d.file, /\.tilepalette\.json$/, 'la palette doit désigner son fichier');
  const f = m.filesAWrite.find((x) => x.filePath.endsWith(d.file));
  assert.ok(f, 'le fichier de la palette doit être dans la liste à écrire');
  assert.equal(JSON.parse(f.content).tiles[0].name, 'Herbe');
});

test('rebuildAssetsFromDescriptors reconstruit la palette à la relecture', async () => {
  env.assets.length = 0;
  paletteDeTest();
  const das = await env.assetsSerialized();
  env.assets.length = 0;
  await env.rebuildAssetsFromDescriptors(das, async () => '');
  const a = env.assets.find((x) => x.kind === 'tilePalette');
  assert.ok(a, 'la palette doit revenir dans le catalogue d\'assets');
  assert.equal(a.name, 'Sol');
  assert.equal(a.palette.cellSize, 0.25);
  assert.equal(a.palette.tiles[0].autotile, true);
});
