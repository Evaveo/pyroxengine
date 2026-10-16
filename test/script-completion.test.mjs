// moteur/test/script-completion.test.mjs
//
// L'autocomplétion des scripts (js/script-completion.js) : pure, testée telle quelle. La table de
// l'API est la VRAIE (API_HELP de l'aide) — une entrée ajoutée à l'aide apparaît dans la liste.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiCompletionsFromHelp, applyCompletion, completionsAt } from '../js/script-completion.js';

// help-content.js touche au document en se chargeant : un document minimal suffit, la table
// elle-même est de la donnée pure.
const el = function(){ return {style: {}, classList: {add(){}, remove(){}, toggle(){}, contains(){ return false; }}, appendChild(){}, addEventListener(){},
  setAttribute(){}, querySelector(){ return null; }, querySelectorAll(){ return []; }, innerHTML: ''}; };
globalThis.document = globalThis.document || {createElement: el, getElementById: el, addEventListener(){},
  querySelector(){ return null; }, querySelectorAll(){ return []; }, body: el(), head: el()};
globalThis.window = globalThis.window || globalThis;
globalThis.addEventListener = globalThis.addEventListener || function(){};
globalThis.location = globalThis.location || {hash: '', search: '', origin: 'http://localhost'};
globalThis.scrollTo = globalThis.scrollTo || function(){};
const { API_HELP } = await import('../js/help-content.js');
const api = apiCompletionsFromHelp(API_HELP);
const at = function(text, force){ return completionsAt(text, text.length, {api: api}, force); };
const labels = function(r){ return r.items.map(function(i){ return i.label; }); };

test('APRÈS « api. » : toute l API de l aide, signatures comprises', () => {
  const r = at('function update(api){\n  api.');
  assert.ok(labels(r).length > 50, 'toute la table');
  ['find', 'particles', 'playSound', 'onContact', 'me', 'dt'].forEach(function(n){
    assert.ok(labels(r).indexOf(n) !== -1, n + ' est proposé');
  });
  const find = r.items.find(function(i){ return i.label === 'find'; });
  assert.equal(find.call, true);
  assert.match(find.detail, /^find\(/);
  assert.ok(!r.items.find(function(i){ return i.label === 'dt'; }).call, 'dt est une propriété');
});

test('LE PRÉFIXE FILTRE, ce qui commence par lui d abord', () => {
  const r = at('api.pla');
  assert.equal(r.prefix, 'pla');
  assert.ok(labels(r)[0].indexOf('pla') === 0);
  assert.ok(labels(r).indexOf('playSound') !== -1);
  assert.equal(r.start, 4);
});

test('CE QUE REND UN APPEL : api.particles(), api.me, api.find(...), et leurs vecteurs', () => {
  assert.ok(labels(at('api.particles().')).indexOf('play') !== -1);
  assert.ok(labels(at('api.particles(api.find(\'Feu\')).')).indexOf('alive') !== -1, 'parenthèses imbriquées');
  assert.ok(labels(at('api.me.')).indexOf('position') !== -1);
  assert.ok(labels(at('api.find("Porte").')).indexOf('getComponent') !== -1);
  assert.deepEqual(labels(at('api.me.position.')).slice(0, 3), ['x', 'y', 'z']);
  assert.equal(at('api.inconnu().').items.length, 0, 'un appel inconnu ne propose rien de faux');
});

test('UNE VARIABLE affectée d un appel est suivie', () => {
  const code = 'function start(api){\n  const p = api.particles();\n  const porte = api.find(\'Porte\');\n  p.';
  assert.ok(labels(at(code)).indexOf('restart') !== -1);
  assert.ok(labels(at(code.replace(/p\.$/, 'porte.'))).indexOf('rotation') !== -1);
});

test('SANS POINT : mots-clés, api, start/update et les noms du fichier', () => {
  const r = at('function update(api){\n  const vitesseMax = 3;\n  vit');
  assert.ok(labels(r).indexOf('vitesseMax') !== -1);
  assert.ok(labels(at('ret')).indexOf('return') !== -1);
  assert.equal(at('').items.length, 0, 'rien sans préfixe…');
  assert.ok(at('', true).items.length > 0, '…sauf sur Ctrl+Espace');
});

test('RIEN dans un commentaire, une chaîne ouverte ou un nombre', () => {
  assert.equal(at('// api.').items.length, 0);
  assert.equal(at('api.find(\'api.').items.length, 0);
  assert.equal(at('const x = 3.').items.length, 0);
  assert.ok(at('const s = \'ok\'; api.').items.length > 0, 'une chaîne FERMÉE ne bloque pas');
});

test('ACCEPTER remplace le mot tapé ; une fonction reçoit () et le curseur dedans', () => {
  const r = applyCompletion('api.pla + 1', 7, 4, {label: 'playSound', call: true});
  assert.equal(r.text, 'api.playSound() + 1');
  assert.equal(r.caret, 'api.playSound('.length);
  const p = applyCompletion('api.d', 5, 4, {label: 'dt', call: false});
  assert.equal(p.text, 'api.dt');
  assert.equal(p.caret, 6);
});
