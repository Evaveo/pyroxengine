// moteur/test/folders-tree-resize.test.mjs
//
// La largeur de l'arbre des dossiers du panneau Projet (js/ui/folders-tree-resize.js) : la
// borne qui empêche de perdre l'arbre ou les tuiles au glisser, et la relecture d'une
// préférence absente ou corrompue.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { creerContexte } from './engine-env.mjs';

const ctx = creerContexte(['js/ui/prefs.js', 'js/ui/folders-tree-resize.js']);
const clamp = (w, zone) => vm.runInContext(`clampTreeWidth(${JSON.stringify(w)}, ${zone})`, ctx);

test('la largeur reste entre l\'arbre minimal et la place laissée aux tuiles', () => {
  assert.equal(clamp(220, 800), 220);
  assert.equal(clamp(20, 800), 90);          // l'arbre ne disparaît jamais
  assert.equal(clamp(790, 800), 660);        // les tuiles gardent 140 px
  assert.equal(clamp(250.6, 800), 251);
});

test('une zone trop étroite garde quand même l\'arbre minimal', () => {
  assert.equal(clamp(300, 150), 90);
});

test('une préférence absente ou illisible retombe sur 160', () => {
  assert.equal(clamp(null, 0), 160);
  assert.equal(clamp('n\'importe quoi', 0), 160);
  assert.equal(clamp(undefined, 0), 160);
});
