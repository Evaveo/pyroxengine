// Projet hébergé : un asset déplacé ne doit pas rester en fantôme à son ancien chemin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cloudPathsToRemove, manifestOf, saveCloudProject } from '../js/cloud-project.js';

test("un asset déplacé quitte son ancien chemin, les scènes non touchées restent", async () => {
  const base = await manifestOf({
    'project.json': '{}',
    'scenes/Ville.scene.json': '{"objets":[]}',
    'scenes/Foret.scene.json': '{"objets":[1]}',
    'assets/Old/x.material.json': '{"color":1}',
    'assets/Old/x.material.json.meta': '{"id":"m1"}',
    'README.txt': 'hors editeur'
  });
  const changed = {
    'project.json': '{"v":2}',
    'scenes/Ville.scene.json': '{"objets":[2]}',
    'assets/New/x.material.json': '{"color":1}',
    'assets/New/x.material.json.meta': '{"id":"m1"}'
  };
  // Foret n'est pas chargée : elle fait toujours partie du projet.
  const live = ['project.json', 'scenes/Ville.scene.json', 'scenes/Foret.scene.json',
    'assets/New/x.material.json', 'assets/New/x.material.json.meta'];
  const removed = cloudPathsToRemove(base, live, changed);
  assert.deepStrictEqual(removed.sort(),
    ['assets/Old/x.material.json', 'assets/Old/x.material.json.meta']);

  let sent;
  const api = {
    hasObject: async () => true, putObject: async () => {},
    writeTree: async (_id, body) => { sent = body.files; return { version_id: 'v2', files: body.files }; }
  };
  await saveCloudProject('p1', { baseManifest: base, changed, removed }, 'v1', api, null);
  {
    assert.ok(!sent['assets/Old/x.material.json']);
    assert.ok(!sent['assets/Old/x.material.json.meta']);
    assert.ok(sent['assets/New/x.material.json']);
    assert.deepStrictEqual(sent['scenes/Foret.scene.json'], base['scenes/Foret.scene.json']);
    assert.ok(sent['README.txt']);
  }
});

test("une scène supprimée du projet part, un binaire sans octets envoyés reste", () => {
  const base = { 'scenes/Gone.scene.json': {sha:'a'}, 'assets/Old/t.png': {sha:'b'},
    'assets/Old/t.png.meta': {sha:'c'} };
  const removed = cloudPathsToRemove(base, ['assets/New/t.png', 'assets/New/t.png.meta'],
    { 'assets/New/t.png.meta': '{}' });
  assert.deepStrictEqual(removed.sort(), ['assets/Old/t.png.meta', 'scenes/Gone.scene.json']);
});
