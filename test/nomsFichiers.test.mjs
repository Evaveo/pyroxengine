import { deEsm } from './engine-env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

const code = deEsm(fs.readFileSync(new URL('../js/file-names.js', import.meta.url), 'utf8'));
const ctx = vm.createContext({});
vm.runInContext(code, ctx);
const { validateNameFile, namesEnterInCollision } = ctx;

test('accepte un nom simple', () => {
  assert.equal(validateNameFile('mur.png'), null);
});

test('rejette les caractères interdits Windows', () => {
  for (const c of ['\\', '/', ':', '*', '?', '"', '<', '>', '|']) {
    assert.notEqual(validateNameFile('mur' + c + '.png'), null, `devrait rejeter "${c}"`);
  }
});

test('rejette un nom empty', () => {
  assert.notEqual(validateNameFile(''), null);
});

test('detecte une collision de casse', () => {
  assert.equal(namesEnterInCollision('Mur.png', 'mur.png'), true);
  assert.equal(namesEnterInCollision('Mur.png', 'Sol.png'), false);
});
