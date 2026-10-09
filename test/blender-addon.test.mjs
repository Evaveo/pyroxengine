// L'addon Blender livré par le moteur, et son câblage dans l'éditeur.
//
// Le zip est COMMITÉ (exemples/blender/) parce que le moteur n'a pas de build : ce test le refait
// en mémoire depuis les sources et exige les MÊMES octets. Toucher un .py de l'addon sans relancer
// `node outils/blender-addon/build-zip.mjs` le fait rougir — sinon l'Atelier proposerait au
// téléchargement un addon qui n'est plus celui du dépôt.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildZip, ZIP_PATH, addonFiles } from '../outils/blender-addon/build-zip.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');

test('le zip commité correspond octet pour octet aux sources de l\'addon', () => {
  assert.ok(existsSync(ZIP_PATH), 'exemples/blender/evaveo_blender_bridge.zip manque : lancer build-zip.mjs');
  assert.ok(buildZip().equals(readFileSync(ZIP_PATH)),
    'le zip de l\'addon est périmé : node outils/blender-addon/build-zip.mjs');
  assert.deepEqual(addonFiles(), ['__init__.py', 'common.py', 'guards.py', 'pipeline.py', 'production.py', 'server.py']);
});

test('l\'addon vise Blender 4.5 LTS et n\'écoute que sur 127.0.0.1', () => {
  const init = read('outils/blender-addon/evaveo_blender_bridge/__init__.py');
  assert.match(init, /"blender": \(4, 5, 0\)/);
  const server = read('outils/blender-addon/evaveo_blender_bridge/server.py');
  assert.match(server, /HOST = "127\.0\.0\.1"/);
  assert.ok(!/0\.0\.0\.0/.test(server), 'le serveur ne doit jamais écouter sur toutes les interfaces');
  // Aucune route n'exécute de code reçu : le pont remplace justement `execute_blender_code`.
  for(const f of addonFiles()){
    const src = read('outils/blender-addon/evaveo_blender_bridge/' + f);
    assert.ok(!/\bexec\(|\beval\(/.test(src), f + ' exécute du code');
  }
});

test('le moteur et l\'addon parlent le même protocole et le même port', async () => {
  const link = await import('../js/blender-link.js');
  const guards = read('outils/blender-addon/evaveo_blender_bridge/guards.py');
  assert.match(guards, new RegExp('PROTOCOL = ' + link.BLENDER_PROTOCOL + '\\b'));
  const init = read('outils/blender-addon/evaveo_blender_bridge/__init__.py');
  assert.match(init, new RegExp('default=' + link.BLENDER_DEFAULT_PORT + '\\b'));
});

test('l\'Atelier Blender est un panneau du menu Fenêtres, et propose le zip qui existe', () => {
  assert.match(read('editor.html'), /id="blender-workshop-panel"/);
  assert.match(read('js/ui/panels-shell.js'), /id: 'blender-workshop', title: 'Atelier Blender'/);
  const ws = read('js/blender-workshop.js');
  const url = /ADDON_ZIP_URL = '([^']+)'/.exec(ws)[1];
  assert.ok(existsSync(path.join(root, url)), url + ' introuvable');
});

test('les opérations que le moteur demande sont toutes permises par l\'addon', () => {
  const guards = read('outils/blender-addon/evaveo_blender_bridge/guards.py');
  const ops = new Set();
  for(const f of ['js/copilot-blender.js', 'js/blender-workshop.js']){
    for(const m of read(f).matchAll(/op: '([a-z_]+)'|call\('([a-z_]+)'/g)) ops.add(m[1] || m[2]);
  }
  assert.ok(ops.size >= 10, 'seulement ' + ops.size + ' opérations lues');
  for(const op of ops) assert.match(guards, new RegExp('"' + op + '"'), op + ' absent de guards.OPERATIONS');
});
