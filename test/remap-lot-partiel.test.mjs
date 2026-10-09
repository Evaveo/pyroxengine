// moteur/test/remap-lot-partiel.test.mjs
//
// RÉGRESSION (projet Donjon, 2026-10-06). `adoptNewAssets` (project.js) appelle
// `rebuildAssetsFromDescriptors` avec un lot PARTIEL : les seuls fichiers découverts sur le
// disque. Le remap des références d'asset à asset parcourait pourtant TOUT le catalogue : chaque
// planche de sprite dont la texture n'était pas dans le lot perdait son `textureId`, en silence,
// et la sauvegarde suivante écrivait `null` sur disque (72 planches sur 101).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte } from './engine-env.mjs';

const env = creerContexte(['js/tile-palette.js', 'js/assets.js', 'js/materials.js',
  'js/model-import.js', 'js/import-settings.js', 'js/project-settings.js', 'js/serialization.js']);

test('un lot partiel ne vide pas les références des assets déjà chargés', async () => {
  env.assets.length = 0;
  const tex = {id: 'a10', kind: 'texture', name: 'arbre', folder: ''};
  const sheet = {id: 'a11', kind: 'sprite', name: 'arbre', folder: '', textureId: 'a10', regions: []};
  const pal = env.createAssetTilePalette('Sol', 1);
  pal.palette.tiles.push({name: 'Arbre', spriteId: 'a11'});
  env.assets.push(tex, sheet);

  // Le lot découvert : une donnée sans rapport, comme un PNG ou un fichier posé à la main.
  await env.rebuildAssetsFromDescriptors([{id: 'a50', kind: 'data', name: 'Neuf', text: '[]'}], async () => '');

  assert.equal(sheet.textureId, 'a10', 'la planche déjà chargée doit garder sa texture');
  assert.equal(pal.palette.tiles[0].spriteId, 'a11', 'la palette déjà chargée doit garder sa tuile');
});

test('une planche découverte peut viser une texture déjà chargée', async () => {
  env.assets.length = 0;
  env.assets.push({id: 'a10', kind: 'texture', name: 'arbre', folder: ''});
  await env.rebuildAssetsFromDescriptors([{id: 'a60', kind: 'sprite', name: 'arbre-2',
    sprite: {textureId: 'a10', ppu: 16, regions: []}}], async () => '');
  const s = env.assets.find((x) => x.kind === 'sprite');
  assert.equal(s.textureId, 'a10');
});

test('une référence vers un asset inexistant reste vidée', async () => {
  env.assets.length = 0;
  await env.rebuildAssetsFromDescriptors([{id: 'a70', kind: 'sprite', name: 'x',
    sprite: {textureId: 'a999', regions: []}}], async () => '');
  assert.equal(env.assets.find((x) => x.kind === 'sprite').textureId, null);
});
