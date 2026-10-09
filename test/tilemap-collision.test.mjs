// moteur/test/tilemap-collision.test.mjs
//
// La collision d'une map de tuiles, telle que l'AUTEUR la règle : par tuile dans la palette
// (Aucune / Solide / Plateforme), et pour toute la map sur le composant.
//
// Le défaut qui porte ce fichier : `obstaclesTilemap` lisait `map.materials`, un reste du format
// d'avant la palette-asset, toujours vide en production. Le réglage de la palette n'était donc lu
// par personne : toute tuile posée était solide — une tuile « Aucune » bloquait, une
// « Plateforme » n'était jamais traversable — et aucun test ne le voyait, parce que tous
// remplissaient `map.materials` à la main.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { creerContexte, deEsm } from './engine-env.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Le moteur juste assez complet pour poser une map sur un nœud ET la donner au monde 2D. */
function contexte(){
  const ctx = creerContexte(['js/component-registry.js', 'js/component.js', 'js/node.js', 'js/component-data.js',
    'js/tile-palette.js', 'js/sprite-2d.js', 'js/tilemap.js',
    'js/components/component-tilemap.js', 'js/physics-2d.js', 'js/world-2d.js']);
  vm.runInContext('var LAYER_HELPERS = 31; var scene = new THREE.Scene();'
    + ' function updateHierarchy(){} function select(){} function removeHelper(){}'
    + ' var activeCam = null; function quitViewCamera(){} var assets = [];', ctx);
  vm.runInContext(deEsm(readFileSync(path.join(root, 'js/objects.js'), 'utf8')), ctx,
    { filename: 'js/objects.js' });
  return ctx;
}

/**
 * Une rangée de trois cases, une par tuile : Solide, Plateforme, Aucune. Rend les obstacles
 * que le monde 2D en tire, dans l'ordre des x.
 */
function obstaclesOf(ctx, mapCollision){
  vm.runInContext(`
    assets.push({ id: 'pal', kind: 'tilePalette', name: 'Pal', palette: { cellSize: 1, tiles: [
      { name: 'Mur', spriteId: null, autotile: false, collision: 'solid' },
      { name: 'Passerelle', spriteId: null, autotile: false, collision: 'platform' },
      { name: 'Herbe', spriteId: null, autotile: false, collision: 'none' } ] } });
    var n = createSceneNode({ name: 'Décor', silent: true, components: [
      { type: 'Tilemap', data: { width: 3, height: 1, cellSize: 1, paletteId: 'pal'
        ${mapCollision ? ", collision: '" + mapCollision + "'" : ''} } } ]});
    var t = n.getComponent('Tilemap');
    t.setCell(0, 0, 1); t.setCell(1, 0, 2); t.setCell(2, 0, 3);
    this.obs = gatherWorld2d([n]).obstacles
      .map(function(o){ return { x: o.x, traversable: o.traversable }; })
      .sort(function(a, b){ return a.x - b.x; });
  `, ctx);
  return JSON.parse(JSON.stringify(ctx.obs));
}

test('LA COLLISION DE LA PALETTE est lue — Solide bloque, Plateforme se traverse, Aucune n existe pas', () => {
  const obs = obstaclesOf(contexte());
  assert.deepEqual(obs, [
    { x: 0.5, traversable: false },   // Mur
    { x: 1.5, traversable: true }     // Passerelle — sans ça, un mur au lieu d'un sens unique
  ], 'la tuile « Aucune » (x = 2,5) ne doit donner aucun obstacle');
});

test('LA COLLISION DU COMPOSANT à « Aucune » retire toute la map du monde 2D', () => {
  // Un décor de fond peint avec les mêmes tuiles que le sol ne doit pas bloquer le personnage :
  // c'est le rôle du réglage de la map, qui passe avant celui de chaque tuile.
  assert.deepEqual(obstaclesOf(contexte(), 'none'), []);
});

test('les obstacles d une map sans palette restent solides — un décor peint ne devient pas creux', () => {
  // Sans palette résolue, rien ne dit qu'une case est « Aucune » : on garde le comportement
  // historique (plein = solide) plutôt que de faire tomber le personnage à travers le sol.
  const ctx = contexte();
  vm.runInContext(`
    var n = createSceneNode({ name: 'D', silent: true, components: [
      { type: 'Tilemap', data: { width: 2, height: 1, cellSize: 1 } } ]});
    n.getComponent('Tilemap').setCell(0, 0, 1);
    this.nb = gatherWorld2d([n]).obstacles.length;
  `, ctx);
  assert.equal(ctx.nb, 1);
});
