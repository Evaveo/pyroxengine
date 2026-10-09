// moteur/test/prefab-modele-perdu.test.mjs
// Zeldo (2026-10-02) : à chaque réouverture, adoptAssetId (js/assets.js) écrasait l'id du MODÈLE
// dans la racine d'un prefab par l'id du PREFAB. Le composant Model pointait sur le prefab, le
// jeu affichait « asset absent » et le héros disparaissait — en place depuis la v0.140.0, et
// invisible tant qu'on ne rouvrait pas le projet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte } from './engine-env.mjs';

const env = creerContexte(['js/assets.js', 'js/materials.js', 'js/model-import.js', 'js/import-settings.js',
  'js/project-settings.js', 'js/serialization.js']);

test('rouvrir un projet ne fait plus pointer un prefab vers lui-même', () => {
  // un prefab dont la racine instancie le modèle a51
  const prefab = {id: 'a900', kind: 'prefab', name: 'PF_Hero', template: {userData: {assetId: 'a51'}}};
  env.adoptAssetId(prefab, 'a52', new Set());
  assert.equal(prefab.id, 'a52');
  assert.equal(prefab.template.userData.assetId, 'a51', 'la racine du prefab doit garder l\'id de SON MODÈLE');
  // un modèle, lui, suit son propre id
  const model = {id: 'a901', kind: 'model', name: 'Hero', template: {userData: {assetId: 'a901'}}};
  env.adoptAssetId(model, 'a53', new Set());
  assert.equal(model.template.userData.assetId, 'a53');
});

test('un prefab déjà abîmé est NOMMÉ au chargement, avec la marche à suivre', () => {
  const byId = {a51: {kind: 'model'}, a52: {kind: 'prefab'}};
  const lost = env.warnPrefabModelLost({id: 'a52', name: 'PF_Hero',
    tree: [{name: 'Hero_Src', components: [{type: 'Model', data: {assetId: 'a52'}}]}]}, byId);
  assert.equal(lost.length, 1);
  assert.match(lost[0], /PF_Hero.*Hero_Src.*pointe vers lui-même.*recréez-le/);
  const sain = env.warnPrefabModelLost({id: 'a52', name: 'PF_Hero',
    tree: [{name: 'Hero_Src', components: [{type: 'Model', data: {assetId: 'a51'}}]}]}, byId);
  assert.equal(sain.length, 0);
});
