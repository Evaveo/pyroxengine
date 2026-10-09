import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte } from './engine-env.mjs';

const env = creerContexte(['js/ui/registry.js', 'js/ui/form-plan.js']);
const { stateField, planForm, FIELD_MIXED } = env;

test('sans dependance, un champ est visible et actif', () => {
  // `{...}` rapatrie l objet dans le royaume de l HOTE : un objet ne dans le contexte vm
  // porte le prototype de CE contexte, et deepEqual echoue alors sur deux objets identiques
  // (meme piege que test/aide.test.mjs).
  const s = { ...stateField({ key: 'a' }, { a: 1 }) };
  assert.deepEqual(s, { visible: true, enabled: true, reason: null });
});

test('requires + greyed : visible mais inerte, avec sa raison', () => {
  const f = { key: 'normalIntensity', requires: ['normalAsset'], ifMissing: 'greyed' };
  const s = stateField(f, { normalAsset: null });
  assert.equal(s.visible, true);
  assert.equal(s.enabled, false);
  assert.equal(s.reason, 'demande normalAsset');
});

test('requires + hidden : le champ disparait', () => {
  const f = { key: 'normalDirectX', requires: ['normalAsset'], ifMissing: 'hidden' };
  assert.equal(stateField(f, { normalAsset: null }).visible, false);
  assert.equal(stateField(f, { normalAsset: 'tex1' }).visible, true);
});

test('requires est un OU : une seule cle suffit', () => {
  const f = { key: 'x', requires: ['a', 'b'], ifMissing: 'greyed' };
  assert.equal(stateField(f, { a: null, b: 'oui' }).enabled, true);
  assert.equal(stateField(f, { a: null, b: null }).enabled, false);
});

test('visible(t) masque, enabled(t) grise avec sa raison', () => {
  const cache = { key: 'x', visible: (t) => t.type === 'color' };
  assert.equal(stateField(cache, { type: 'hdri' }).visible, false);
  assert.equal(stateField(cache, { type: 'color' }).visible, true);

  const grise = { key: 'x', enabled: (t) => t.type === 'hdri', disabledReason: 'choisir le type HDRI' };
  const s = stateField(grise, { type: 'color' });
  assert.equal(s.visible, true);
  assert.equal(s.enabled, false);
  assert.equal(s.reason, 'choisir le type HDRI');
});

test('le plan rend sections, champs, notes et boutons', () => {
  const descriptor = {
    id: 'p', title: 'P',
    sections: [{ id: 's', title: 'Ciel', fields: [
      { key: 'sky.type', label: 'Type', type: 'choice', options: [['color', 'Couleur unie']] },
      { key: 'sky.color', label: 'Couleur', type: 'color', visible: (t) => t.sky.type === 'color' },
      { type: 'note', text: 'Aucune sonde.', when: (t) => !t.probes.length },
      { type: 'action', label: 'Reinitialiser', run(){}, enabled: () => false }
    ]}]
  };
  const target = { sky: { type: 'color', color: '#ffffff' }, probes: [] };
  const plan = planForm(descriptor, [target]);

  assert.equal(plan.sections.length, 1);
  assert.equal(plan.sections[0].title, 'Ciel');
  const kinds = Array.from(plan.sections[0].entries.map((e) => e.kind));
  assert.deepEqual(kinds, ['field', 'field', 'note', 'action']);
  assert.equal(plan.sections[0].entries[1].value, '#ffffff');
  assert.equal(plan.sections[0].entries[3].enabled, false);
});

test('un champ masque n apparait pas dans le plan', () => {
  const descriptor = { id: 'p', sections: [{ id: 's', fields: [
    { key: 'c', label: 'Couleur', type: 'color', visible: (t) => t.type === 'color' }
  ]}]};
  const plan = planForm(descriptor, [{ type: 'hdri', c: '#fff' }]);
  assert.equal(plan.sections[0].entries.length, 0);
});

test('une note dont le `when` est faux n apparait pas', () => {
  const descriptor = { id: 'p', sections: [{ id: 's', fields: [
    { type: 'note', text: 'x', when: () => false }
  ]}]};
  assert.equal(planForm(descriptor, [{}]).sections[0].entries.length, 0);
});

test('sans cible, le plan est vide mais ne leve pas', () => {
  const descriptor = { id: 'p', sections: [{ id: 's', fields: [{ key: 'a', type: 'number' }] }] };
  const plan = planForm(descriptor, []);
  assert.equal(plan.sections[0].entries.length, 0);
  assert.equal(plan.empty, true);
});

test('la signature de FORME change avec les entrees, pas avec les valeurs', () => {
  const descriptor = { id: 'p', sections: [{ id: 's', fields: [
    { key: 'n', label: 'N', type: 'number' },
    { key: 'c', label: 'C', type: 'color', visible: (t) => t.withColor }
  ]}]};
  const a = planForm(descriptor, [{ n: 1, c: '#fff', withColor: false }]);
  const b = planForm(descriptor, [{ n: 9, c: '#000', withColor: false }]);
  const c = planForm(descriptor, [{ n: 1, c: '#fff', withColor: true }]);
  assert.equal(a.shape, b.shape, 'une valeur qui change ne doit PAS reconstruire');
  assert.notEqual(a.shape, c.shape, 'un champ qui apparait DOIT reconstruire');
});


test('les sections peuvent etre CALCULEES sur la cible', () => {
  // Les champs d un script sont ses variables `@expose` : on ne les connait qu en regardant
  // l instance. Une liste figee ne saurait pas les exprimer.
  const d = { id: 'p', sections: (t) => [{ id: 's', fields: t.exposees.map((e) => ({
    ids: ['f-x-' + e], label: e, type: 'text', get: (x) => x.valeurs[e],
    set: (x, v) => { x.valeurs[e] = v; } })) }] };
  const a = planForm(d, [{ exposees: ['vitesse'], valeurs: { vitesse: '3' } }]);
  assert.equal(a.sections[0].entries.length, 1);
  assert.equal(a.sections[0].entries[0].value, '3');
  const b = planForm(d, [{ exposees: ['vitesse', 'degats'], valeurs: {} }]);
  assert.equal(b.sections[0].entries.length, 2);
  assert.notEqual(a.shape, b.shape, 'une variable exposee en plus DOIT etre construite');
});
