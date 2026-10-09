// moteur/test/tile-palette.test.mjs
//
// La palette est un ASSET, pas un sac dans un noeud. Enfermee dans `userData.tilemap2d` elle
// n'etait ni partageable entre deux decors, ni versionnable seule, ni modifiable une fois pour
// tout le niveau.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte } from './engine-env.mjs';

/** Le meme objet, mais du realm de ce fichier : le bac vm a ses propres prototypes. */
const nu = (v) => JSON.parse(JSON.stringify(v));

test('une palette neuve a une tuile vide en indice 0', () => {
  const ctx = creerContexte(['js/tile-palette.js']);
  const p = ctx.emptyPalette(0.5);
  assert.equal(p.cellSize, 0.5);
  assert.deepEqual(nu(p.tiles), []);
  // L'indice 0 est TOUJOURS le vide, jamais une tuile : sans cette convention, effacer une
  // cellule demanderait une valeur sentinelle differente par palette.
  assert.equal(ctx.tileAt(p, 0), null);
});

test('un aller-retour JSON conserve la palette', () => {
  const ctx = creerContexte(['js/tile-palette.js']);
  const p = ctx.emptyPalette(0.5);
  p.tiles.push({ name: 'Herbe', spriteId: 'a12', autotile: true, collision: 'solid' });
  const relu = ctx.parsePalette(JSON.stringify(ctx.serializePalette(p)));
  assert.deepEqual(nu(relu), nu(p));
});

test('le nom de fichier d une palette est sur et stable', () => {
  const ctx = creerContexte(['js/tile-palette.js']);
  assert.equal(ctx.fileNamePalette('Décor / forêt'), 'assets/palettes/decor-foret.tilepalette.json');
});

test('glisser une planche decoupee donne une tuile par image, sans doublon', () => {
  const ctx = creerContexte(['js/tile-palette.js']);
  const p = ctx.emptyPalette(0.5);
  const sheet = { id: 'a7', name: 'Sol', regions: [
    { name: 'sol_0' }, { name: 'sol_1' }, { name: 'sol_2' }] };
  assert.equal(ctx.addSpriteToPalette(p, sheet), 3);
  assert.deepEqual(nu(p.tiles.map((t) => [t.name, t.region || 0, t.autotile])),
    [['sol_0', 0, false], ['sol_1', 1, false], ['sol_2', 2, false]]);
  // Reglisser apres un redecoupage n'ajoute QUE les nouvelles images.
  sheet.regions.push({ name: 'sol_3' });
  assert.equal(ctx.addSpriteToPalette(p, sheet), 1);
  assert.equal(p.tiles.length, 4);
});

test('une planche en auto-tuilage donne UNE tuile', () => {
  const ctx = creerContexte(['js/tile-palette.js']);
  const p = ctx.emptyPalette(0.5);
  const sheet = { id: 'a8', name: 'Herbe', regions: new Array(16).fill(0).map((_, i) => ({ name: 'h' + i })) };
  assert.equal(ctx.addSpriteToPalette(p, sheet, { autotile: true }), 1);
  assert.equal(ctx.addSpriteToPalette(p, sheet, { autotile: true }), 0);
  assert.equal(p.tiles[0].autotile, true);
});

test('la region d une tuile survit a l aller-retour et vaut 0 par defaut', () => {
  const ctx = creerContexte(['js/tile-palette.js']);
  const p = ctx.emptyPalette(0.5);
  p.tiles.push({ name: 'A', spriteId: 'a1', autotile: false, collision: 'solid', region: 5 });
  p.tiles.push({ name: 'B', spriteId: 'a1', autotile: false, collision: 'solid' });
  const relu = ctx.parsePalette(JSON.stringify(ctx.serializePalette(p)));
  assert.equal(relu.tiles[0].region, 5);
  assert.equal('region' in relu.tiles[1], false);
});

test('la region affichee : choisie, ou voisinage si auto-tuilee, modulo la planche', () => {
  const ctx = creerContexte(['js/tile-palette.js']);
  assert.equal(ctx.regionIndexOfTile({ region: 5 }, 9, 16), 5);
  assert.equal(ctx.regionIndexOfTile({ autotile: true, region: 5 }, 9, 16), 9);
  assert.equal(ctx.regionIndexOfTile({ region: 5 }, 0, 4), 1);
  assert.equal(ctx.regionIndexOfTile({ region: 0 }, 0, 0), -1);
});
