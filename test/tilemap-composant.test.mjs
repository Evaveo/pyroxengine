// moteur/test/tilemap-composant.test.mjs
//
// Le composant Tilemap : des DONNEES dans le composant, pas un sac dans userData. Enfermees
// dans `userData.tilemap2d`, elles echappaient au Registry, aux Systemes, et a toute vue qui
// interroge les composants.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { creerContexte, deEsm } from './engine-env.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Le moteur juste assez complet pour poser un noeud a composants. */
function contexte(){
  const ctx = creerContexte(['js/component-registry.js', 'js/component.js', 'js/node.js', 'js/component-data.js',
    'js/tile-palette.js', 'js/sprite-2d.js', 'js/tilemap.js',
    'js/components/component-tilemap.js']);
  vm.runInContext('var LAYER_HELPERS = 31; var scene = new THREE.Scene();'
    + ' function updateHierarchy(){} function select(){} function removeHelper(){}'
    + ' var activeCam = null; function quitViewCamera(){} var assets = [];', ctx);
  vm.runInContext(deEsm(readFileSync(path.join(root, 'js/objects.js'), 'utf8')), ctx,
    { filename: 'js/objects.js' });
  return ctx;
}

test('les cellules survivent a un aller-retour', () => {
  const ctx = contexte();
  vm.runInContext(`
    const n = createSceneNode({ name: 'Décor', silent: true, components: [
      { type: 'Tilemap', data: { width: 4, height: 3, cellSize: 0.5 } } ]});
    const t = n.getComponent('Tilemap');
    t.setCell(1, 2, 3);
    const d = t.serialize();
    const n2 = createSceneNode({ name: 'Copie', silent: true,
      components: [{ type: 'Tilemap', data: d }] });
    this.relu = { pose: n2.getComponent('Tilemap').cellAt(1, 2),
                  vide: n2.getComponent('Tilemap').cellAt(0, 0) };
  `, ctx);
  const r = JSON.parse(JSON.stringify(ctx.relu));
  assert.equal(r.pose, 3);
  assert.equal(r.vide, 0);
});

test('le plan xz projette les tuiles au sol', () => {
  const ctx = contexte();
  // (x, y) de la grille -> position monde. C'est ce qui rend la tilemap utilisable en 3D.
  const p = (plane, x, y) => JSON.parse(JSON.stringify(
    vm.runInContext(`projectCell('${plane}', ${x}, ${y}, 0.5)`, ctx)));
  assert.deepEqual(p('xy', 2, 3), { x: 1, y: 1.5, z: 0 });
  assert.deepEqual(p('xz', 2, 3), { x: 1, y: 0, z: -1.5 });
  assert.deepEqual(p('yz', 2, 3), { x: 0, y: 1.5, z: -1 });
});

test('une cellule hors grille ne plante pas et rend le vide', () => {
  const ctx = contexte();
  vm.runInContext(`
    const n = createSceneNode({ name: 'Décor', silent: true,
      components: [{ type: 'Tilemap', data: { width: 4, height: 3 } }] });
    const t = n.getComponent('Tilemap');
    // Un decor peint jusqu'au bord est le cas NORMAL : lever une erreur ici arreterait le
    // pinceau en plein geste.
    this.hors = { avant: t.cellAt(-1, 0), apres: t.cellAt(99, 0) };
  `, ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.hors)), { avant: 0, apres: 0 });
});

test('deux tilemaps partagent la meme palette', () => {
  const ctx = contexte();
  vm.runInContext(`
    const a = createSceneNode({ name: 'A', silent: true,
      components: [{ type: 'Tilemap', data: { paletteId: 'p1' } }] });
    const b = createSceneNode({ name: 'B', silent: true,
      components: [{ type: 'Tilemap', data: { paletteId: 'p1' } }] });
    this.partage = a.getComponent('Tilemap').paletteId === b.getComponent('Tilemap').paletteId;
  `, ctx);
  assert.equal(ctx.partage, true);
});

test('le RLE ne se confond pas avec des cellules brutes', () => {
  const ctx = contexte();
  vm.runInContext(`
    const n = createSceneNode({ name: 'D', silent: true, components: [
      { type: 'Tilemap', data: { width: 2, height: 2, cells: [1, 1, 0, 2] } } ]});
    const t = n.getComponent('Tilemap');
    // Un tableau BRUT reste brut : marque, le RLE ne peut pas etre lu comme des cellules, et
    // l'inverse non plus — sinon copier-coller une map la corrompt en silence.
    this.brut = [t.cellAt(0, 0), t.cellAt(1, 1)];
    const relu = createSceneNode({ name: 'E', silent: true,
      components: [{ type: 'Tilemap', data: t.serialize() }] });
    this.rle = [relu.getComponent('Tilemap').cellAt(0, 0),
                relu.getComponent('Tilemap').cellAt(1, 1)];
  `, ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.brut)), [1, 2]);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.rle)), [1, 2]);
});
