// moteur/test/collider2d-contour.test.mjs
//
// Le contour vert d'un Collider2D dans la vue Scène. Il est enfant du nœud, donc il hérite de
// son échelle, alors que le collider 2D s'exprime en unités du monde (box2dOf, world-2d.js) :
// sans la division par l'échelle, un bâtiment à l'échelle 4 montrait une boîte quatre fois
// trop grande — pas celle où le héros bute.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte } from './engine-env.mjs';

const env = creerContexte(['js/editor-overlay.js', 'js/collider.js']);

test('boîte : décalage et échelle du nœud pris en compte', () => {
  const p = env.outline2dPoints({shape: 'box', l: 4, h: 2, dx: 0, dy: -1}, {x: 4, y: 4});
  assert.deepEqual(JSON.parse(JSON.stringify(p)), [[-0.5, -0.5], [0.5, -0.5], [0.5, 0], [-0.5, 0]]);
});

test('pente : un triangle qui monte du bon côté', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(env.outline2dPoints({shape: 'slope', l: 2, h: 2, stepUp: 'left'}, {x: 1, y: 1}))),
    [[-1, -1], [1, -1], [-1, 1]]);
  assert.equal(env.outline2dPoints({shape: 'slope', l: 2, h: 2}, {x: 1, y: 1})[2][0], 1);
});

// Les poignées : tirer un côté laisse l'opposé en place (geste « Edit Collider » d'Unity).
test('poignée droite : le côté gauche ne bouge pas', () => {
  const r = env.dragHandle2d({l: 2, h: 2, dx: 0, dy: 0}, 'r', {x: 3, y: 9});
  assert.deepEqual(JSON.parse(JSON.stringify(r)), {l: 4, h: 2, dx: 1, dy: 0});
});

test('coin haut-gauche : deux côtés à la fois', () => {
  const r = env.dragHandle2d({l: 2, h: 2, dx: 0, dy: 0}, 'tl', {x: -2, y: 3});
  assert.deepEqual(JSON.parse(JSON.stringify(r)), {l: 3, h: 4, dx: -0.5, dy: 1});
});

test('un côté tiré au-delà de l opposé est arrêté, pas retourné', () => {
  const r = env.dragHandle2d({l: 2, h: 2, dx: 0, dy: 0}, 'b', {x: 0, y: 5}, 0.1);
  assert.equal(r.h, 0.1);
  assert.equal(r.dy, 0.95);
});

test('les huit poignées tombent sur le contour', () => {
  const p = env.handles2dPoints({l: 4, h: 2, dx: 1, dy: -1});
  assert.equal(p.length, 8);
  assert.deepEqual(JSON.parse(JSON.stringify(p.find((x) => x.id === 'tr'))), {id: 'tr', x: 3, y: 0});
});
