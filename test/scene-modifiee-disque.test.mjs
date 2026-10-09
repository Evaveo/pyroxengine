// moteur/test/scene-modifiee-disque.test.mjs
//
// RÉGRESSION (projet Donjon, 2026-10-06). La surveillance du dossier ignorait `scenes/` : une
// scène réécrite hors de l'éditeur gardait son ancienne version en mémoire — le jeu lancé
// depuis l'éditeur jouait l'ancienne, et le Ctrl+S suivant écrasait la nouvelle, sans un mot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changedScenes, sceneSignatures } from '../js/folder-watch.js';

const tree = (sigHub) => ({files: [
  {filePath: 'scenes/Hub.scene.json', size: 10, lastModif: sigHub},
  {filePath: 'scenes/Donjon.scene.json', size: 5, lastModif: 1},
  {filePath: 'assets/x.png', size: 1, lastModif: 1}]});

test('seuls les fichiers de scène sont suivis', () => {
  assert.deepEqual([...sceneSignatures(tree(1)).keys()].sort(),
    ['scenes/Donjon.scene.json', 'scenes/Hub.scene.json']);
});

test('une scène réécrite hors de l éditeur est signalée par son nom', () => {
  assert.deepEqual(changedScenes(sceneSignatures(tree(1)), sceneSignatures(tree(2)), new Set()), ['Hub']);
});

test('nos propres enregistrements ne déclenchent rien', () => {
  assert.deepEqual(changedScenes(sceneSignatures(tree(1)), sceneSignatures(tree(2)),
    new Set(['scenes/Hub.scene.json'])), []);
});
