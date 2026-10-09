// LE HARNAIS EST TESTÉ, LUI AUSSI.
//
// Sans arbre DOM, sans identité stable de getElementById, sans activeElement et sans
// distribution d'événements, tout test d'interface écrit par-dessus est un test qui passe
// sans rien mesurer. Cette garde fixe le contrat minimal du harnais.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte } from './engine-env.mjs';

const env = creerContexte([]);
const doc = env.document;

test('appendChild construit un vrai arbre', () => {
  const parent = doc.createElement('div');
  const child = doc.createElement('span');
  parent.appendChild(child);
  assert.equal(parent.children.length, 1);
  assert.equal(parent.children[0], child);
  assert.equal(child.parentNode, parent);
});

test('getElementById rend le MEME element a chaque appel', () => {
  const el = doc.createElement('input');
  el.id = 'f-test';
  doc.body.appendChild(el);
  assert.equal(doc.getElementById('f-test'), el);
  assert.equal(doc.getElementById('f-test'), doc.getElementById('f-test'));
  assert.equal(doc.getElementById('absent'), null);
});

test('classList retient un etat', () => {
  const el = doc.createElement('div');
  assert.equal(el.classList.contains('mixed'), false);
  el.classList.add('mixed');
  assert.equal(el.classList.contains('mixed'), true);
  el.classList.remove('mixed');
  assert.equal(el.classList.contains('mixed'), false);
});

test('addEventListener et dispatchEvent se parlent', () => {
  const el = doc.createElement('input');
  let seen = 0;
  el.addEventListener('input', function(){ seen += 1; });
  el.dispatchEvent({ type: 'input' });
  el.dispatchEvent({ type: 'input' });
  el.dispatchEvent({ type: 'change' });
  assert.equal(seen, 2);
});

test('activeElement suit focus et blur', () => {
  const a = doc.createElement('input');
  const b = doc.createElement('input');
  assert.equal(doc.activeElement, null);
  a.focus();
  assert.equal(doc.activeElement, a);
  b.focus();
  assert.equal(doc.activeElement, b);
  b.blur();
  assert.equal(doc.activeElement, null);
});

test('localStorage sait s enumerer et se vider', () => {
  const s = env.localStorage;
  s.setItem('window:animator', '{}');
  s.setItem('copilot-key', 'abc');
  assert.equal(s.length, 2);
  const keys = [];
  for(let i = 0; i < s.length; i++) keys.push(s.key(i));
  assert.deepEqual(keys.slice().sort(), ['copilot-key', 'window:animator']);
  s.clear();
  assert.equal(s.length, 0);
  assert.equal(s.getItem('copilot-key'), null);
});


test('children se comporte comme une HTMLCollection, pas comme un tableau', () => {
  // POURQUOI. `(box.children || []).forEach(...)` passait tous les tests du dock et levait une
  // TypeError dans l'editeur a chaque glissement de poignee : le harnais rendait un TABLEAU la
  // ou un navigateur rend une HTMLCollection, qui n'a ni `forEach` ni `map`. Un harnais plus
  // permissif que le navigateur ne mesure pas le navigateur.
  const parent = doc.createElement('div');
  parent.appendChild(doc.createElement('span'));
  assert.equal(parent.children.length, 1);
  assert.equal(typeof parent.children.forEach, 'undefined', 'une HTMLCollection n a pas de forEach');
  assert.equal(typeof parent.children.map, 'undefined');
  assert.equal(Array.prototype.slice.call(parent.children).length, 1,
    'elle reste convertible en tableau, comme dans un navigateur');
});

// UN HARNAIS PLUS PERMISSIF QUE LE NAVIGATEUR NE MESURE PLUS RIEN.
//
// Le stub posait `value`, `checked` et le curseur de sélection sur TOUT élément. Coût mesuré :
// `js/ui/form.js` refusait d'écraser un champ dont `read()` rend `undefined` tant que
// `String(el.value).trim() !== ''`. Sur un vrai `<span>`, `el.value` vaut `undefined` et
// `String(undefined)` donne « undefined » — jamais vide : la garde gelait DÉFINITIVEMENT tous
// les champs `info` du produit. Ici, `el.value` valait `''`, la garde ne partait pas, le test
// était vert, et le défaut n'a été vu que dans un navigateur, sur le panneau d'un plugin.
//
// Ce test est le cliquet : rendre au stub sa générosité doit faire rouge ICI, tout de suite.
test('seul un controle de formulaire porte value, checked et le curseur', () => {
  for (const tag of ['div', 'span', 'p', 'label', 'table']) {
    const el = doc.createElement(tag);
    assert.equal(el.value, undefined, `<${tag}> ne doit pas avoir de .value`);
    assert.equal(el.checked, undefined, `<${tag}> ne doit pas avoir de .checked`);
    assert.equal(el.selectionStart, undefined, `<${tag}> n a pas de curseur de selection`);
  }
  for (const tag of ['input', 'textarea', 'select', 'button', 'option']) {
    const el = doc.createElement(tag);
    assert.equal(el.value, '', `<${tag}> doit avoir une .value vide au depart`);
    assert.equal(el.selectionStart, 0, `<${tag}> doit avoir un curseur`);
  }
  // `checked` et `indeterminate` sont l'affaire de <input>, et de lui seul.
  assert.equal(doc.createElement('input').checked, false);
  assert.equal(doc.createElement('input').indeterminate, false);
  assert.equal(doc.createElement('select').checked, undefined);
});
