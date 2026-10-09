import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte } from './engine-env.mjs';

const env = creerContexte(['js/ui/registry.js', 'js/ui/form-plan.js']);
const { resolvePath, writePath } = env;

test('lit un chemin simple et un chemin profond', () => {
  const t = { a: 1, sky: { color: '#fff', deep: { n: 3 } } };
  assert.equal(resolvePath(t, 'a'), 1);
  assert.equal(resolvePath(t, 'sky.color'), '#fff');
  assert.equal(resolvePath(t, 'sky.deep.n'), 3);
});

test('un chemin absent rend undefined sans lever', () => {
  const t = { sky: {} };
  assert.equal(resolvePath(t, 'absent'), undefined);
  assert.equal(resolvePath(t, 'sky.absent'), undefined);
  assert.equal(resolvePath(t, 'absent.profond.encore'), undefined);
  assert.equal(resolvePath(null, 'a'), undefined);
});

test('ecrit un chemin simple et un chemin profond', () => {
  const t = { a: 1, sky: { color: '#fff' } };
  assert.equal(writePath(t, 'a', 2), true);
  assert.equal(t.a, 2);
  assert.equal(writePath(t, 'sky.color', '#000'), true);
  assert.equal(t.sky.color, '#000');
});

test('ecrire dans un chemin intermediaire absent ECHOUE au lieu de le creer', () => {
  const t = { sky: {} };
  assert.equal(writePath(t, 'fog.near', 40), false);
  assert.equal(t.fog, undefined, 'une faute de frappe ne doit pas faire pousser la donnee');
});

test('une valeur falsy est une valeur, pas une absence', () => {
  const t = { n: 0, b: false, s: '' };
  assert.equal(resolvePath(t, 'n'), 0);
  assert.equal(resolvePath(t, 'b'), false);
  assert.equal(resolvePath(t, 's'), '');
  assert.equal(writePath(t, 'n', 0), true);
});
