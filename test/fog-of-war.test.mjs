// Le brouillard de guerre (js/fog-grid.js, js/components/component-fog-of-war.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FOG_EXPLORED, FOG_UNKNOWN, FOG_VISIBLE, createFogGrid, fogBeginUpdate, fogReveal, fogStateAt, fogToRGBA } from '../js/fog-grid.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');

test('UNE CASE VUE redevient EXPLORÉE quand la vision s\'éloigne, jamais inconnue', () => {
  const g = createFogGrid(20, 20);
  fogReveal(g, 5, 5, 2);
  assert.equal(fogStateAt(g, 5.5, 5.5, [0, 0], 1), FOG_VISIBLE);
  assert.equal(fogStateAt(g, 15.5, 15.5, [0, 0], 1), FOG_UNKNOWN);
  fogBeginUpdate(g); fogReveal(g, 15, 15, 1);
  assert.equal(fogStateAt(g, 5.5, 5.5, [0, 0], 1), FOG_EXPLORED);
  assert.equal(fogStateAt(g, 15.5, 15.5, [0, 0], 1), FOG_VISIBLE);
});

test('L\'ORIGINE et la TAILLE DE CASE placent la grille dans le monde', () => {
  const g = createFogGrid(10, 10);
  fogReveal(g, 0, 0, 0);
  assert.equal(fogStateAt(g, -9, -9, [-10, -10], 2), FOG_VISIBLE);
  assert.equal(fogStateAt(g, -11, 0, [-10, -10], 2), FOG_UNKNOWN, 'hors grille = inconnu');
});

test('LA TEXTURE : vu transparent, exploré voilé, inconnu opaque', () => {
  const g = createFogGrid(3, 1);
  fogReveal(g, 0, 0, 0); fogBeginUpdate(g); fogReveal(g, 1, 0, 0);
  const px = fogToRGBA(g, new Uint8Array(12), [0, 0, 0], 0.5);
  assert.deepEqual([px[3], px[7], px[11]], [128, 0, 255]);
});

test('LE SYSTÈME cache hors vue, mémorise, et ne cache RIEN en édition', async () => {
  const { creerContexte } = await import('./engine-env.mjs');
  const env = creerContexte(['js/component-registry.js', 'js/component.js', 'js/node.js', 'js/component-data.js',
    'js/systems.js', 'js/fog-grid.js', 'js/components/component-fog-of-war.js', 'js/systems/fog-system.js']);
  const T = env.THREE;
  const mk = (name, x, z) => { const o = new T.Object3D(); o.name = name; o.position.set(x, 0, z); env.applyNodeMixin(o); env.addSceneObject(o); o.updateMatrixWorld(true); return o; };
  const carte = mk('Carte', 0, 0);
  carte.addComponent('FogOfWar', {origin: [0, 0], cellSize: 1, cols: 40, rows: 40, team: 1});
  const moi = mk('Eclaireur', 5, 5); moi.addComponent('Vision', {radius: 4, team: 1});
  const loin = mk('Ennemi', 30, 30); loin.addComponent('Vision', {radius: 4, team: 2});
  const pres = mk('Maison', 7, 5); pres.addComponent('Vision', {radius: 0, team: 2, remember: true});
  env.System.runFrame(1, {mode: 'play'});
  assert.equal(loin.visible, false, 'un ennemi hors de vue est caché');
  assert.equal(pres.visible, true, 'un bâtiment en vue est montré');
  moi.position.set(25, 0, 5); moi.updateMatrixWorld(true);
  env.System.runFrame(1, {mode: 'play'});
  assert.equal(pres.visible, true, 'aperçu une fois, il reste affiché (mémorisé)');
  env.System.runFrame(1, {mode: 'edit'});
  assert.equal(loin.visible, true, 'en édition, rien n\'est caché');
});

test('LE BROUILLARD est chargé par l\'éditeur, le jeu publié et le build', () => {
  for(const f of ['editor.html', 'game-preview.html', 'build-test/index.html', 'js/build.js'])
    assert.match(read(f), /component-fog-of-war\.js/, f);
});
