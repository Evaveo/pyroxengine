// moteur/test/allegement-scripts-reference.test.mjs
//
// RÉGRESSION (docs/REVUE_2026-09-14.md § 2, cause 8).
//
// `scriptsCite()` lisait `scripts[j].code` — un champ RETIRÉ du format au passage à la référence
// d'asset (`{scriptId, active, values}`). Elle rendait donc toujours `false`, et `network-game.js`
// comme `game-character.js` étaient SYSTÉMATIQUEMENT retirés de tout build web publié : un jeu en
// réseau ou à personnage se publiait cassé, sans le moindre avertissement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deEsm } from './engine-env.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const bac = {console, Math, JSON, Number, String, Object, Array, isFinite};
bac.window = bac; bac.self = bac; bac.globalThis = bac;
const ctx = vm.createContext(bac);
vm.runInContext(deEsm(readFileSync(path.join(root, 'js/build-trimming.js'), 'utf8')), ctx,
  {filename: 'js/build-trimming.js'});
const scriptsCite = bac.scriptsCite;

const projet = (objects, assetsScripts) => ({
  assets: assetsScripts, scenes: [{name: 'N', data: {objects: objects}}]
});

test('le code est retrouvé par la RÉFÉRENCE d\'asset du sac scripts', () => {
  const d = projet(
    [{name: 'Héros', scripts: [{scriptId: 's1', active: true, values: {}}]}],
    [{id: 's1', kind: 'script', name: 'Réseau', code: 'api.network.send("hop")'}]);
  assert.equal(scriptsCite(d, ['network']), true);
  assert.equal(scriptsCite(d, ['moveCharacter']), false);
});

test('le code est retrouvé par la référence portée par le COMPOSANT ScriptJS', () => {
  const d = projet(
    [{name: 'Héros', components: [{type: 'ScriptJS', active: true, data: {scriptId: 's2'}}]}],
    [{id: 's2', kind: 'script', name: 'Perso', code: 'moveCharacter(self, 3)'}]);
  assert.equal(scriptsCite(d, ['moveCharacter']), true);
});

test('un script inline hérité (ancien format) reste reconnu', () => {
  // Les projets enregistrés avant la référence d'asset portent encore `code` à plat.
  const d = projet([{name: 'H', scripts: [{code: 'api.network.join()'}]}], []);
  assert.equal(scriptsCite(d, ['network']), true);
});

test('une référence morte ne fait pas planter l\'allègement', () => {
  const d = projet([{name: 'H', scripts: [{scriptId: 'disparu'}]}], []);
  assert.equal(scriptsCite(d, ['network']), false);
});
