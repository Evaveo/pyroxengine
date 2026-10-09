// LE CATALOGUE DE TEMPLATES DU HUB DOIT S'ÉTENDRE SANS TOUCHER SON PROPRE FICHIER.
//
// C'est la contrainte explicite du Project Hub : ajouter un template = un nouveau
// `register(...)` quelque part, jamais une modif de hub-templates.js. Ce test le mesure
// directement — un appel `register` supplémentaire depuis LE TEST LUI-MÊME, en dehors du
// fichier source, doit apparaître dans `list()` sans rien changer d'autre.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte } from './engine-env.mjs';

const env = creerContexte(['js/hub/hub-templates.js']);

test('le catalogue de depart contient les cinq templates attendus', () => {
  const ids = env.HubTemplates.list().map((t) => t.id).sort();
  assert.deepEqual(ids, ['empty', 'fps-basic', 'platformer-2d', 'third-person', 'webxr-vr']);
});

test('un template SANS applyInEditor attaché reste listé (placeholder "Bientôt disponible")', () => {
  const tiers = env.HubTemplates.get('third-person');
  assert.ok(tiers, 'le template "third-person" doit exister');
  assert.equal(tiers.applyInEditor, null);
});

test('AJOUTER un template ne demande aucune modification de hub-templates.js : un register() externe suffit', () => {
  env.HubTemplates.register({id: 'test-extension', label: 'Extension de test', description: 'x'});
  const ajoute = env.HubTemplates.get('test-extension');
  assert.ok(ajoute, 'le nouveau template doit être immédiatement lisible via get()');
  assert.equal(ajoute.applyInEditor, null, 'un template neuf n\'a pas encore de comportement attaché');
});

test('attachApply pose le comportement sur un template déjà enregistré, sans le remplacer', () => {
  const fn = () => 'appliqué';
  env.HubTemplates.attachApply('test-extension', fn);
  assert.equal(env.HubTemplates.get('test-extension').applyInEditor, fn);
});

test('attachApply sur un id inconnu lève une erreur explicite, plutôt que de créer un template fantôme', () => {
  assert.throws(() => env.HubTemplates.attachApply('id-inexistant', () => {}), /Template inconnu/);
});

test('register refuse un doublon d\'id — deux templates du même id divergeraient en silence sinon', () => {
  assert.throws(() => env.HubTemplates.register({id: 'empty', label: 'Doublon', description: 'x'}), /déjà enregistré/);
});
