// moteur/test/ai-rules-gardes.test.mjs
//
// LES GARDE-FOUS DES HANDLERS (plan « règles de l'IA appliquées », phase B). Les handlers touchent
// l'éditeur entier (assets, scène, Blender) : on garde ici ce qui est pur (validation d'asset, tables
// de lecture/écriture Blender) et, pour le câblage, la présence du garde dans le texte du handler —
// un refus qui disparaît d'un refactor se voit à la première exécution.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assetFingerprint, changedSinceValidation, isValidated, ruleText, validatedAfter } from '../js/ai-rules.js';
import { lintScriptAssets } from '../js/script-asset-lint.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('asset validé : empreinte, modification détectée, validation postérieure à un checkpoint', () => {
  const asset = {id: 'a1', kind: 'model', name: 'Renard', file: {size: 1000}};
  const table = {a1: {name: 'Renard', fp: assetFingerprint(asset), at: '2026-10-02T10:00:00Z'}};
  assert.ok(isValidated(table, asset));
  assert.ok(!isValidated(table, {id: 'a2'}));
  assert.ok(!changedSinceValidation(table, asset));
  assert.ok(changedSinceValidation(table, Object.assign({}, asset, {file: {size: 1200}})), 'taille changée');
  assert.ok(changedSinceValidation(table, Object.assign({}, asset, {name: 'Renard2'})), 'nom changé');
  assert.deepEqual(validatedAfter(table, '2026-10-02T09:00:00Z'), ['Renard']);
  assert.deepEqual(validatedAfter(table, '2026-10-02T11:00:00Z'), []);
  assert.deepEqual(validatedAfter(table, 'pas une date'), []);
  assert.deepEqual(validatedAfter(null, '2026-10-02T09:00:00Z'), []);
});

test('delete_asset refuse un asset validé sans confirm:true ET sans accord dans la page', () => {
  const w = read('js/copilot-workshop.js');
  assert.match(w, /assets\.validated_delete/);
  assert.match(w, /if\(!a\.confirm\) throw new Error/);
  assert.match(w, /await askInPage\(/);
  assert.match(w, /name: 'validate_asset'/);
  assert.match(w, /assets\.validated_overwrite/, 'import_image refuse d écraser un asset validé');
});

test('le format de projet porte validatedAssets (additif, défaut {})', () => {
  const s = read('js/project-settings.js');
  assert.match(s, /'validatedAssets'\]\)/);
  assert.match(s, /validatedAssets: \(brut\.validatedAssets/);
});

test('blender : pas d import sans rendu, pas de restauration d un état validé, rangé dans Models', () => {
  const b = read('js/copilot-blender.js');
  assert.match(b, /if\(!previewState\.seen\) throw new Error\(ruleMessage\('blender\.no_import_unvalidated'\)\)/);
  assert.match(b, /previewState\.seen = false/, 'toute écriture Blender remet le compteur à zéro');
  assert.match(b, /previewState\.seen = true/);
  assert.match(b, /blender\.validated_restore/);
  assert.match(b, /cleanProjectFolder\(o\.folder, 'Models'\)/);
  assert.match(b, /setFolderCurrent\(folder\)/);
  assert.match(b, /folder: \{type: 'string', description: 'dossier du projet/);
});

test('create_prefab et create_data rangent par défaut dans Prefabs et Data', () => {
  const c = read('js/copilot.js');
  assert.match(c, /a\.folder === undefined \? 'Prefabs' : a\.folder/);
  assert.match(c, /a\.folder === undefined \? 'Data' : a\.folder/);
});

test('l addon Blender ne lisse plus par défaut (mesh, sweep, lathe, extrude, cleanup)', () => {
  const py = read('outils/blender-addon/evaveo_blender_bridge/production.py');
  assert.match(py, /s\.get\('smooth',False\)/);
  assert.doesNotMatch(py, /action in \('sweep','lathe'\)\)/);
  assert.doesNotMatch(py, /s\.get\('smooth',True\)/);
  assert.match(read('js/copilot-blender.js'), /smooth vaut FALSE partout/);
});

test('lint durci : lumières et niveau généré dans start refusés, avec le texte du registre', () => {
  const l = lintScriptAssets('var s = new THREE.SpotLight(0xffffff);');
  assert.deepEqual(l.blocking, [ruleText('scripts.no_lights')]);
});
