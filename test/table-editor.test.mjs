// moteur/test/table-editor.test.mjs
// Fenêtre « Table » (js/table-editor.js) : le MODÈLE qui décide comment un JSON devient un
// tableau, et comment une case tapée redevient du JSON. Les formes testées sont celles des
// vraies tables de Zeldo (Ennemis_Types, Dialogues, Decor) — un tableau qui se trompe de forme
// rend la table illisible, une case qui change de type en douce casse le jeu qui la lit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapeOf, columnsOf, encodeCell, decodeCell, freeKey, renameKey, blankLike, sectionsOf }
  from '../js/table-editor.js';
import { ecColorize } from '../js/code-editor.js';

test('la forme du JSON choisit la vue', () => {
  assert.equal(shapeOf([{nom: 'Gluant', pv: 3}, {nom: 'Gardien', pv: 40}]), 'rows');
  assert.equal(shapeOf({ancien: {nom: 'Rok', lignes: ['a']}, garde: {nom: 'Garde', lignes: []}}), 'keyed');
  assert.equal(shapeOf([[7, 30], [12, 30]]), 'list');
  assert.equal(shapeOf([]), 'list');
  assert.equal(shapeOf({vitesse: 4, nom: 'x'}), 'record');
  // « Decor » : des listes, des objets et une valeur simple mêlés
  const decor = {maisons: [[7, 30]], feux: [{x: 16, z: 37}], depart: {x: 14, z: 40}, version: 2};
  assert.equal(shapeOf(decor), 'sections');
  assert.deepEqual(sectionsOf(decor).map((t) => t.label), ['Général', 'maisons', 'feux', 'depart']);
});

test('colonnes : union des champs, dans l\'ordre de première apparition', () => {
  assert.deepEqual(columnsOf([{x: 1, z: 2}, {x: 3, objet: 'epee', z: 4}]), ['x', 'z', 'objet']);
});

test('une case garde son type', () => {
  assert.deepEqual(encodeCell(12), {type: 'number', text: '12'});
  assert.deepEqual(encodeCell(true), {type: 'bool', checked: true});
  assert.deepEqual(encodeCell('epee'), {type: 'text', text: 'epee'});
  assert.deepEqual(encodeCell([7, 30]), {type: 'json', text: '[7,30]'});
  assert.deepEqual(encodeCell(undefined), {type: 'empty', text: ''});
  // une case texte reste du texte même si on y tape un nombre
  assert.deepEqual(decodeCell('text', '12'), {ok: true, value: '12'});
  assert.deepEqual(decodeCell('number', '2.5'), {ok: true, value: 2.5});
  assert.equal(decodeCell('number', 'abc').ok, false);
  assert.equal(decodeCell('number', '').ok, false);
  assert.deepEqual(decodeCell('json', '["Bonjour", "Au revoir"]'), {ok: true, value: ['Bonjour', 'Au revoir']});
  assert.equal(decodeCell('json', '[1, 2').ok, false);
  // une case neuve prend le type que son contenu suggère, et accepte du texte nu
  assert.deepEqual(decodeCell('empty', '5'), {ok: true, value: 5});
  assert.deepEqual(decodeCell('empty', 'lance'), {ok: true, value: 'lance'});
  assert.deepEqual(decodeCell('empty', ''), {ok: true, value: undefined});
});

test('renommer une clé garde l\'ordre ; un nom pris est refusé', () => {
  const o = {a: 1, b: 2, c: 3};
  assert.equal(renameKey(o, 'b', 'beta'), true);
  assert.deepEqual(Object.keys(o), ['a', 'beta', 'c']);
  assert.equal(renameKey(o, 'a', 'c'), false);
  assert.equal(renameKey(o, 'a', ''), false);
  assert.deepEqual(o, {a: 1, beta: 2, c: 3});
});

test('ligne ajoutée : mêmes champs, valeurs neutres du même type ; clé libre', () => {
  assert.deepEqual(blankLike({nom: 'Gluant', pv: 3, boss: false, drop: [1]}, ['nom', 'pv', 'boss', 'drop']),
    {nom: '', pv: 0, boss: false, drop: []});
  assert.equal(freeKey(['nouveau', 'nouveau_2']), 'nouveau_3');
  assert.equal(freeKey(['x'], 'colonne'), 'colonne');
});

test('éditeur de code : coloration JSON (clés, chaînes, nombres, littéraux)', () => {
  const html = ecColorize('{"nom": "Rok", "pv": -3.5, "boss": true, "drop": null}', 'json');
  assert.match(html, /<span class="ec-t-key">"nom"<\/span>:/);
  assert.match(html, /<span class="ec-t-txt">"Rok"<\/span>/);
  assert.match(html, /<span class="ec-t-num">-3\.5<\/span>/);
  assert.match(html, /<span class="ec-t-reads">true<\/span>/);
  assert.match(html, /<span class="ec-t-reads">null<\/span>/);
  // le JavaScript n'a pas changé de coloration
  assert.match(ecColorize('const a = 1;', 'js'), /<span class="ec-t-key">const<\/span>/);
});
