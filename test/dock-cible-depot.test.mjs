// OÙ TOMBE LE CURSEUR EST UNE RÈGLE GÉOMÉTRIQUE, DONC UNE FONCTION.
//
// Écrite dans un `pointermove`, elle ne se vérifie qu'à la souris — et ses bords (zone très
// plate, curseur sur la diagonale, rectangle de largeur nulle) ne se vérifient pas du tout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte } from './engine-env.mjs';

const env = creerContexte(['js/ui/dock-tree.js']);
const { dropTarget } = env;

const R = { x: 0, y: 0, width: 400, height: 200 };   // une zone de 400x200

test('le centre empile', () => {
  assert.equal(dropTarget(R, 200, 100).where, 'center');
});

test('chaque quart de bord scinde dans SA direction', () => {
  assert.equal(dropTarget(R, 10, 100).where, 'left');
  assert.equal(dropTarget(R, 390, 100).where, 'right');
  assert.equal(dropTarget(R, 200, 5).where, 'top');
  assert.equal(dropTarget(R, 200, 195).where, 'bottom');
});

test('un coin choisit le bord le PLUS PROCHE en proportion, pas en pixels', () => {
  // 20 px du bord gauche sur 400 = 5 % ; 20 px du haut sur 200 = 10 %. Le gauche gagne.
  assert.equal(dropTarget(R, 20, 20).where, 'left');
  assert.equal(dropTarget({ x: 0, y: 0, width: 200, height: 400 }, 20, 20).where, 'top');
});

test('hors du rectangle : detachement', () => {
  assert.equal(dropTarget(R, -30, 100).where, 'outside');
  assert.equal(dropTarget(R, 500, 100).where, 'outside');
  assert.equal(dropTarget(R, 200, 260).where, 'outside');
});

test('une zone degeneree ne fait pas exploser la regle', () => {
  assert.equal(dropTarget({ x: 0, y: 0, width: 0, height: 0 }, 0, 0).where, 'center');
});

test('le rectangle vise tient compte de l origine de la zone', () => {
  const decale = { x: 100, y: 50, width: 400, height: 200 };
  assert.equal(dropTarget(decale, 110, 150).where, 'left', 'x est absolu, pas relatif');
  assert.equal(dropTarget(decale, 90, 150).where, 'outside');
});

test('la cible porte le rectangle de PREVISUALISATION, pas seulement une direction', () => {
  const t = dropTarget(R, 10, 100);
  assert.deepEqual({ ...t.preview }, { x: 0, y: 0, width: 200, height: 200 },
    'un depot a gauche previsualise la MOITIE gauche : le rectangle doit dire ou ca tombe');
  const c = dropTarget(R, 200, 100);
  assert.deepEqual({ ...c.preview }, { x: 0, y: 0, width: 400, height: 200 });
  const b = dropTarget(R, 200, 195);
  assert.deepEqual({ ...b.preview }, { x: 0, y: 100, width: 400, height: 100 });
  assert.equal(dropTarget(R, -30, 100).preview, null, 'un detachement n a rien a previsualiser');
});
