import { deEsm } from './engine-env.mjs';
// moteur/test/object-scene-par-id.test.mjs
//
// La hiérarchie et la console retrouvaient un objet cliqué via scene.getObjectById(id) —
// qui fouille TOUT le graphe three.js réel, y compris les internes du moteur qui ne sont
// jamais des objets de project (gizmo de transformation et ses dizaines de poignées d'axes
// nommées 'X'/'Y'/'Z'/'XY'.../picker, targets de lumière...). L'éditeur charge deux instances
// de three.js (le bundle classique et le paquet webgpu, render-webgpu-bridge.mjs), chacune
// avec son propre counter d'id — constaté en session : une poignée du gizmo (permanente,
// créée une fois au démarrage) a fini avec le même id qu'un objet de project chargé ensuite.
// scene.getObjectById() renvoyait alors la poignée du gizmo au lieu du bon object : la
// sélection semblait ne rien faire (l'object trouvé n'étant pas dans `objects`, aucune ligne
// de la hiérarchie ne correspondait), pour CET objet et tout ce qui suivait dans l'ordre de
// création (même classe de bug, id différents à chaque fois).
//
// Le correctif ne cherche plus dans scene.children mais dans `objects` (le tableau qui NE
// contient que de vrais objets de project) : la classe de bug disparaît quelle que soit la
// cause exacte de la collision.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));

function contexte() {
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(dirname, '..', 'vendor', 'three.min.js'), 'utf8'), ctx);
  // objects.js est un très gros file plein de dépendances DOM (bar d'outils, menus...) :
  // on n'a besoin que de la déclaration de `objects` et de objectOfSceneById(), en tête de
  // file, avant tout le reste qui a besoin d'un vrai DOM.
  const source = deEsm(fs.readFileSync(path.join(dirname, '..', 'js', 'objects.js'), 'utf8'));
  const end = source.indexOf('const TYPES_CREATABLE');
  vm.runInContext(source.slice(0, end), ctx);
  // `const objets = []` reste une liaison LEXICALE du contexte vm, jamais une propriété de
  // l'object global : ctx.objets serait undefined sans ce pont explicite.
  ctx.objects = vm.runInContext('objects', ctx);
  ctx.objectOfSceneById = vm.runInContext('objectOfSceneById', ctx);
  return ctx;
}

test('objectOfSceneById ignore un id partagé par un objet HORS du tableau objects (ex. une poignée de gizmo)', () => {
  const ctx = contexte();
  // objectOfSceneById ne fait qu'un parcours linéaire de `objects` en comparant `.id` : pas
  // besoin d'un vrai THREE.Mesh (dont `.id` est un accesseur en playback seule, impossible à
  // forcer en collision) pour vérifier ce comportement. La collision réelle (deux instances
  // THREE avec des compteurs indépendants) est documentée dans docs/KNOWN_ISSUES.md — ce
  // test vérifie la RÉPONSE au symptôme (chercher dans objets[], pas dans tout le graphe),
  // pas le mécanisme qui produit la collision côté navigateur.
  const legit = { id: 42, name: 'Socle Torche 1' };
  ctx.objects.push(legit);
  // object interne du moteur au même id, JAMAIS poussé dans objets[] (comme une poignée de
  // gizmo trouvée par scene.getObjectById() en parcourant tout le graphe three.js réel).
  const interne = { id: 42, name: 'X' };

  assert.equal(ctx.objectOfSceneById(42), legit,
    'doit retrouver le VRAI objet de scène, jamais l\'object interne partageant le même id');
  assert.notEqual(ctx.objectOfSceneById(42), interne);
});

test('objectOfSceneById renvoie null pour un id qui n\'est pas dans objets (object supprimé, ou purement interne)', () => {
  const ctx = contexte();
  assert.equal(ctx.objectOfSceneById(999999), null);
});

test('objectOfSceneById retrouve un objet de scène normal', () => {
  const ctx = contexte();
  const o = new ctx.THREE.Mesh(new ctx.THREE.BoxGeometry(), new ctx.THREE.MeshBasicMaterial());
  o.name = 'Porte 1';
  ctx.objects.push(o);
  assert.equal(ctx.objectOfSceneById(o.id), o);
});
