// Les bibliothèques de scripts (api.lib, js/script-library.js) : du code partagé entre scripts
// courts, au lieu d'un script monolithique. Les DEUX moteurs doivent l'exposer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLibraryHost } from '../js/script-library.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const hostOf = (codes, base) => createLibraryHost((n) => (n in codes ? codes[n] : null), base);

test('UNE BIBLIOTHÈQUE rend ses exports, et le MÊME objet à chaque appel', () => {
  const h = hostOf({maths: 'exports.double = function(x){ return 2 * x; }; exports.etat = {n: 0};'});
  const a = h.lib('maths'), b = h.lib('maths');
  assert.equal(a.double(21), 42);
  assert.equal(a, b, 'deux appelants doivent partager le même objet');
  a.etat.n++;
  assert.equal(h.lib('maths').etat.n, 1);
});

test('UNE BIBLIOTHÈQUE peut en utiliser une autre, et lire une table', () => {
  const h = hostOf({
    base: 'exports.k = api.data("regles").k;',
    haut: 'const b = api.lib("base"); exports.f = function(){ return b.k + 1; };'
  }, {data: (n) => (n === 'regles' ? {k: 41} : null)});
  assert.equal(h.lib('haut').f(), 42);
});

test('INTROUVABLE, CIRCULAIRE, ERREUR : un message qui nomme la bibliothèque', () => {
  const h = hostOf({a: 'api.lib("b");', b: 'api.lib("a");', casse: 'throw Error("boum");'});
  assert.throws(() => h.lib('rien'), /introuvable/);
  assert.throws(() => h.lib('a'), /circulaire — a → b → a/);
  assert.throws(() => h.lib('casse'), /casse.*boum/);
});

test('UNE SOURCE CHANGÉE est recompilée ; reset() repart de zéro', () => {
  const codes = {v: 'exports.n = 1;'};
  const h = hostOf(codes);
  assert.equal(h.lib('v').n, 1);
  codes.v = 'exports.n = 2;';
  assert.equal(h.lib('v').n, 2);
  const avant = h.lib('v'); h.reset();
  assert.notEqual(h.lib('v'), avant);
});

test('LES DEUX MOTEURS exposent api.lib, et le cache repart à chaque lancement', () => {
  const ed = read('js/scripts.js'), rt = read('js/game-runtime.js');
  assert.match(ed, /lib: function\(name\)\{ return librariesHost\(o\)\.lib\(name\); \}/);
  assert.match(ed, /engineScripts\.libraries = null;/);
  assert.match(rt, /lib:function\(name\)\{ return \(game\.libraries = game\.libraries \|\| libraryHostForAssets\(/);
  assert.match(rt, /game\.libraries = null;/);
  assert.match(ed, /engineScripts\.libraries = libraryHostForAssets\(/);
});
