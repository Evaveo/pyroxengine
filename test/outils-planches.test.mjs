// moteur/test/outils-planches.test.mjs
// Outils MCP des planches/palettes : marge et espacement de la découpe, palette multi-planches,
// options id/replace/ppu déclarées par les outils.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { creerContexte } from './engine-env.mjs';

const env = creerContexte(['js/sprite-2d.js', 'js/tile-palette.js']);

test('sliceGrid respecte margin et spacing (planche 104, tuile 24, marge 1, espacement 2)', () => {
  const r = env.sliceGrid(104, 104, 24, 24, {margin: 1, spacing: 2});
  assert.equal(r.length, 16);
  assert.equal(r.slice(0, 4).map(function(x){ return x.x; }).join(','), '1,27,53,79');
  assert.equal(r[4].x + ',' + r[4].y, '1,27');
});

test('sliceGrid lit encore l\'ancienne clé marge', () => {
  const r = env.sliceGrid(70, 20, 16, 16, {marge: 2, spacing: 2});
  assert.equal(r[0].x, 2);
});

test('une palette existante accepte les tuiles d\'une autre planche', () => {
  const pal = env.emptyPalette(0.5);
  const a = {id: 'sA', name: 'A', regions: [{name: 'a0'}, {name: 'a1'}]};
  const b = {id: 'sB', name: 'B', regions: [{name: 'b0'}, {name: 'b1'}, {name: 'b2'}]};
  assert.equal(env.addSpriteToPalette(pal, a, {}), 2);
  assert.equal(env.addSpriteToPalette(pal, b, {}), 3);
  assert.equal(pal.tiles.length, 5);
  assert.equal(pal.tiles[2].spriteId, 'sB');
  assert.equal(env.addSpriteToPalette(pal, b, {}), 0, 'pas de doublon');
});

test('les outils déclarent id, replace, ppu et add_palette_tiles', () => {
  const ws = readFileSync(new URL('../js/copilot-workshop.js', import.meta.url), 'utf8');
  const cp = readFileSync(new URL('../js/copilot.js', import.meta.url), 'utf8');
  assert.match(ws, /name: 'add_palette_tiles'/);
  assert.match(ws, /replace: \{type: 'boolean'/);
  assert.match(ws, /function matchAssets\(a, folder\)/);
  assert.match(cp, /ppu: \{type: 'number', description: 'pixels par unité de la planche/);
  // create_prefab : nom explicite gardé tel quel (pas de retrait du chiffre final)
  assert.match(cp, /asset\.name = a\.prefabName \|\| o\.name;/);
});
