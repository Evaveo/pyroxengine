import { deEsm } from './engine-env.mjs';
// Un jeu publie ALLEGE retire volontairement des modules (build-trimming.js). Les gardes du
// runtime qui protegent ces modules ne doivent pas s'en plaindre dans la console du joueur :
// l'absence est la decision de l'exportateur. Elles doivent en revanche continuer a signaler
// un module absent qui n'a PAS ete retire — c'est la panne qu'elles existent pour montrer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');

function guards(trimmed){
  const warnings = [];
  const bac = { console: { warn: (m) => warnings.push(m) }, Set, JSON };
  bac.globalThis = bac;
  if(trimmed) bac.ENGINE_TRIMMED_MODULES = trimmed;
  const ctx = vm.createContext(bac);
  vm.runInContext(deEsm(read('js/dev-guards.js')), ctx, { filename: 'js/dev-guards.js' });
  return { warn: (...a) => vm.runInContext('warnOnceMissing', ctx)(...a), warnings };
}

test('module retire par l allegement : la garde se tait', () => {
  const g = guards(['vendor/cannon.js', 'animator.js']);
  g.warn('CANNON', 'vendor/cannon.js');
  g.warn('updatePlayerAnimator', 'animator.js');
  assert.deepEqual(g.warnings, []);
});

test('module absent SANS avoir ete retire : la garde avertit, une seule fois', () => {
  const g = guards(['animator.js']);
  g.warn('CANNON', 'vendor/cannon.js');
  g.warn('CANNON', 'vendor/cannon.js');
  g.warn('createForm');
  assert.equal(g.warnings.length, 2);
  assert.match(g.warnings[0], /CANNON/);
});

test('build sans allegement (editeur, build-test) : rien n est tu', () => {
  const g = guards(null);
  g.warn('CANNON', 'vendor/cannon.js');
  assert.equal(g.warnings.length, 1);
});

test('la page publiee pose la liste, et les gardes du runtime nomment leur fichier', () => {
  assert.match(read('js/build.js'), /globalThis\.ENGINE_TRIMMED_MODULES=/);
  const runtime = read('js/game-runtime.js');
  assert.match(runtime, /warnOnceMissing\('CANNON', 'vendor\/cannon\.js'\)/);
  assert.match(runtime, /warnOnceMissing\('updatePlayerAnimator', 'animator\.js'\)/);
  // Les noms passes doivent etre ceux de build-trimming.js (`dans`), sinon le filtre ne mord jamais.
  const trimming = read('js/build-trimming.js');
  for(const f of ['vendor/cannon.js', 'animator.js']) assert.ok(trimming.includes("dans: '" + f + "'"), f);
});
