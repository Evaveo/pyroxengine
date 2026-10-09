import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte } from './engine-env.mjs';

const env = creerContexte(['js/ui/registry.js', 'js/ui/form-plan.js']);
const { planForm, writeField, FIELD_MIXED } = env;

const descriptor = { id: 'p', sections: [{ id: 's', fields: [
  { key: 'position.x', label: 'X', type: 'number' },
  { key: 'name', label: 'Nom', type: 'text', multi: false }
]}]};

function cube(x, name){ return { position: { x: x, y: 0, z: 0 }, name: name }; }

test('accord de toutes les cibles : la valeur', () => {
  const plan = planForm(descriptor, [cube(3, 'a'), cube(3, 'b')]);
  assert.equal(plan.sections[0].entries[0].value, 3);
  assert.equal(plan.sections[0].entries[0].mixed, false);
});

test('desaccord : etat divergent, et surtout AUCUNE valeur ecrasee', () => {
  const a = cube(3, 'a'), b = cube(7, 'b');
  const plan = planForm(descriptor, [a, b]);
  const champ = plan.sections[0].entries[0];
  assert.equal(champ.value, FIELD_MIXED);
  assert.equal(champ.mixed, true);
  assert.equal(a.position.x, 3, 'lire ne doit rien ecrire');
  assert.equal(b.position.x, 7);
});

test('un champ multi:false est visible mais inerte, avec sa raison', () => {
  const plan = planForm(descriptor, [cube(3, 'a'), cube(3, 'b')]);
  const nom = plan.sections[0].entries[1];
  assert.equal(nom.enabled, false);
  assert.equal(nom.reason, 'un seul objet à la fois');
});

test('en selection simple, multi:false reste actif', () => {
  const plan = planForm(descriptor, [cube(3, 'a')]);
  assert.equal(plan.sections[0].entries[1].enabled, true);
});

test('l ecriture s applique a TOUTES les cibles', () => {
  const a = cube(3, 'a'), b = cube(7, 'b');
  const res = writeField({ key: 'position.x', type: 'number' }, [a, b], 12);
  assert.equal(res.written, 2);
  assert.equal(a.position.x, 12);
  assert.equal(b.position.x, 12);
});

test('l ecriture d un champ multi:false sur N cibles est REFUSEE', () => {
  const a = cube(3, 'a'), b = cube(7, 'b');
  const res = writeField({ key: 'name', type: 'text', multi: false }, [a, b], 'zz');
  assert.equal(res.written, 0);
  assert.equal(res.reason, 'un seul objet à la fois');
  assert.equal(a.name, 'a');
  assert.equal(b.name, 'b');
});

test('un accesseur set remplace le chemin, sur chaque cible', () => {
  const a = { col: { hex: '#fff' } }, b = { col: { hex: '#fff' } };
  const field = { get: (t) => t.col.hex, set: (t, v) => { t.col.hex = String(v).toUpperCase(); } };
  const res = writeField(field, [a, b], '#abc');
  assert.equal(res.written, 2);
  assert.equal(a.col.hex, '#ABC');
  assert.equal(b.col.hex, '#ABC');
});

test('un chemin intermediaire absent ne compte pas comme ecrit', () => {
  const a = cube(3, 'a');
  const res = writeField({ key: 'fog.near', type: 'number' }, [a], 40);
  assert.equal(res.written, 0);
  assert.equal(res.failed, 1);
  assert.equal(a.fog, undefined);
});
