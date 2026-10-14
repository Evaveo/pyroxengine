// moteur/test/runtime-loop-perf.test.mjs — travail par image du jeu publié (js/game-runtime.js) :
// caches de la boucle et correctifs qui les accompagnent. Une garde par point.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAnimatorTargetCache, createNameIndex } from '../js/runtime-caches.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const rt = readFileSync(path.join(root, 'js/game-runtime.js'), 'utf8');
const body = (sig, n) => rt.slice(rt.indexOf(sig), rt.indexOf(sig) + (n || 1500));

// Petit arbre façon three : parent, children, traverse en profondeur.
function node(name, clips){
  const n = {name, parent: null, children: [], animations: clips || [], visits: 0};
  n.add = (c) => { c.parent = n; n.children.push(c); return c; };
  n.remove = (c) => { n.children.splice(n.children.indexOf(c), 1); c.parent = null; };
  n.traverse = function(f){ n.visits++; f(n); n.children.forEach((c) => c.traverse(f)); };
  return n;
}
const clipsOf = (o) => o.animations;

test('Animator : même cible que le parcours, sans reparcourir tant qu elle reste valide', () => {
  const resolve = createAnimatorTargetCache(clipsOf);
  const root = node('root'), arm = root.add(node('arm')), mesh = arm.add(node('mesh', ['clip']));
  assert.equal(resolve(root, ''), mesh);
  root.visits = 0;
  for(let k = 0; k < 10; k++) assert.equal(resolve(root, ''), mesh);
  assert.equal(root.visits, 0, 'aucun parcours en régime établi');
  // nom voulu
  assert.equal(resolve(root, 'arm'), arm);
  root.visits = 0; resolve(root, 'arm'); assert.equal(root.visits, 0);
  // renommage : nouvelle recherche
  arm.name = 'bras'; assert.equal(resolve(root, 'arm'), null);
  assert.equal(resolve(root, 'bras'), arm);
  // la cible quitte l'arbre : nouvelle recherche
  arm.remove(mesh);
  assert.equal(resolve(root, ''), root, 'repli sur l objet lui-même, comme avant');
  // l'objet reçoit des clips : il prime, comme dans le parcours d'origine
  const m2 = arm.add(node('m2', ['c'])); assert.equal(resolve(root, ''), m2);
  root.animations = ['own']; assert.equal(resolve(root, ''), root);
});

test('api.expose : l index de noms voit un objet ajouté pendant la pause', () => {
  assert.match(rt, /function rtObjectByName\(name\)\{ return _rtFind\.find\(name\); \}/);
  assert.ok(!/_rtNameIndexTime/.test(rt), 'plus d index indexé sur game.time');
  const list = [{name: 'A'}];
  const idx = createNameIndex(() => list);
  assert.equal(idx.find('B'), null);
  list.push({name: 'B'}); idx.invalidate();        // addSceneObject, game.time figé
  assert.equal(idx.find('B'), list[1]);
});

test('particules : système retrouvé par WeakMap, retiré au nettoyage et au changement de scène', () => {
  const f = body('function rtSystemOf', 500);
  assert.ok(/_rtSystemByObj\.get\(o\)/.test(f) && !/game\.particles\.find/.test(f));
  assert.ok(/_rtSystemByObj\.delete\(s\.obj\);\r?\n\s*game\.particles\.splice\(i, 1\)/.test(rt));
  assert.ok(/game\.particles = \[\]; _rtSystemByObj = new WeakMap\(\);/.test(rt));
});

test('événements : boîtes une fois par appel, états sans clé texte, invalidés après une action', () => {
  const f = body('function evtRun', 3000);
  assert.ok(!/setFromObject/.test(f) && /evtBoxOf\(autre\)/.test(f));
  assert.ok(!/o\.id \+ ':'/.test(f), 'plus de clé texte par paire');
  assert.ok(/evtActions\(o, ev\.actions, 0\); _ebBoxes\.clear\(\); boxA = evtBoxOf\(o\);/.test(f));
});

test('volumes de post : plus de Vector3 alloué par image', () => {
  assert.ok(!/new THREE\.Vector3/.test(body('function rtCurrentPostState', 600)));
});

test('boucle : physique 3D à dtGame (gelée en pause), caméra à jour avant les ombres, vues secondaires sans passe de matrices', () => {
  const loop = body('function loop(){', 12000);
  assert.ok(/game\.world\.step\(1\/60, dtGame, 3\)/.test(loop) && !/step\(1\/60, dt,/.test(loop));
  assert.ok(loop.indexOf('game.cam.updateWorldMatrix(true, false)') < loop.indexOf('rtUpdateShadows(game.cam)'));
  assert.ok(/matrixWorldAutoUpdate = false;\r?\n\s*try\{ renderCameraOverlays/.test(loop));
  assert.ok(/finally\{ game\.scene\.matrixWorldAutoUpdate = autoMatrices; \}/.test(loop));
});
