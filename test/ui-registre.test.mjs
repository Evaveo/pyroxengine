import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte } from './engine-env.mjs';

function neuf(){ return creerContexte(['js/ui/registry.js']); }

test('un panneau declare est retrouve par son id', () => {
  const env = neuf();
  env.UIRegistry.declarePanel({ id: 'inspector', title: 'Inspecteur' });
  assert.equal(env.UIRegistry.panel('inspector').title, 'Inspecteur');
  assert.equal(env.UIRegistry.panel('absent'), null);
});

test('les panneaux sont rendus dans leur ordre de declaration', () => {
  const env = neuf();
  env.UIRegistry.declarePanel({ id: 'a', title: 'A' });
  env.UIRegistry.declarePanel({ id: 'b', title: 'B' });
  assert.deepEqual(env.UIRegistry.panels().map((p) => p.id), ['a', 'b']);
});

test('redeclarer un id remplace sans dupliquer', () => {
  const env = neuf();
  env.UIRegistry.declarePanel({ id: 'a', title: 'A' });
  env.UIRegistry.declarePanel({ id: 'a', title: 'A prime' });
  assert.equal(env.UIRegistry.panels().length, 1);
  assert.equal(env.UIRegistry.panel('a').title, 'A prime');
});

test('un panneau sans id est refuse avec un message francais', () => {
  const env = neuf();
  assert.throws(() => env.UIRegistry.declarePanel({ title: 'Sans id' }),
    /identifiant/);
});

test('la resolution retient l objet vivant, distinct du descripteur', () => {
  const env = neuf();
  const descriptor = { id: 'a', title: 'A', minWidth: 240 };
  env.UIRegistry.declarePanel(descriptor);
  env.UIRegistry.resolve('a', { host: 'boite', minWidth: 300 });
  assert.equal(env.UIRegistry.resolved('a').minWidth, 300,
    'le dock lit l objet RESOLU, pas le descripteur brut');
  assert.equal(descriptor.minWidth, 240, 'le descripteur n est jamais mute');
});

test('un type de champ declare est retrouve', () => {
  const env = neuf();
  env.UIRegistry.declareFieldType({ type: 'number', create(){}, write(){}, read(){} });
  assert.ok(env.UIRegistry.fieldType('number'));
  assert.equal(env.UIRegistry.fieldType('inconnu'), null);
});
