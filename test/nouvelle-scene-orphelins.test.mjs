import { deEsm } from './engine-env.mjs';
// moteur/test/nouvelle-scene-orphelins.test.mjs
//
// newScene() (serialization.js) nettoyait la scène en repartant de `objects` (la
// racines.filter(o => o.parent === scene) suivi de scene.remove(r)) — si un objet a un
// jour fini dans le graphe réel SANS être suivi dans `objects` (fuite ailleurs : un chemin
// qui fait scene.add() sans objets.push()), ce nettoyage ne le voyait jamais, puisqu'il
// part de `objects` et pas du graphe réel three.js. L'orphelin survivait alors à CHAQUE
// changement de project, indéfiniment, jusqu'à entrer en collision d'id three.js avec un
// futur object légitime — constaté en session : un objet de test resté en mémoire
// empêchait la sélection de tout objet dont l'id three.js suivait le sien dans un project
// chargé ensuite (scene.getObjectById() retombait sur l'orphelin au lieu du bon object).
//
// Le correctif balaie directement scene.children après le nettoyage existant, plutôt que
// de rechasser chaque fuite une par une : ce test vérifie ce fichiert, pas le nettoyage normal
// (déjà couvert implicitement par le fait que les fixtures permanentes survivent).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));

function contexteNouvelleScene() {
  const ctx = {};
  Object.assign(ctx, {
    console,
    // serialization.js pose des écouteurs top-niveau sur quelques éléments d'entrée
    // (file-scene...) : un élément factice suffit, rien dans newScene() ne les utilise.
    document: { getElementById: () => ({ addEventListener: () => {}, click: () => {} }) },
    // dépendances de newScene() qu'on n'exerce pas ici : bouchons inertes
    phys: { active: false },
    anim: { playback: false, tracks: [], t: 0 },
    btnPlayback: { textContent: '' },
    gizmoAttach: () => {},
    removeHelper: () => {},
    listMats: () => [],
    assets: [],
    updateProject: () => {},
    applyEnvironment: () => {},
    ENV_DEFAULT: {},
    select: () => {},
    updateHierarchy: () => {},
    updateTimeline: () => {},
    keySel: null,
    setKeySel: (v) => { ctx.keySel = v; },
    setFolderCurrent: () => {},
    // objects.js n'est pas chargé ici (il veut la scène, le renderer, la bar d'outils) :
    // newScene() passe par clearSceneObjects(), on en donne l'équivalent minimal.
    // C'est bien le comportement testé — clear `objects` NE SUFFIT PAS, et c'est tout
    // l'objet de ce fichier : le balayage de scene.children doit rattraper l'orphelin.
    clearSceneObjects: () => { ctx.objects.length = 0; }
  });
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(dirname, '..', 'vendor', 'three.min.js'), 'utf8'), ctx);
  vm.runInContext(deEsm(fs.readFileSync(path.join(dirname, '..', 'js', 'serialization.js'), 'utf8')), ctx);

  ctx.scene = new ctx.THREE.Scene();
  ctx.hemi = new ctx.THREE.Object3D(); ctx.hemi.name = 'hemi';
  ctx.sun = new ctx.THREE.Object3D(); ctx.sun.name = 'sun';
  ctx.grid = new ctx.THREE.Object3D(); ctx.grid.name = 'grid';
  ctx.tcVisual = new ctx.THREE.Object3D(); ctx.tcVisual.name = 'tcVisual';
  ctx.proxyView = new ctx.THREE.Object3D(); ctx.proxyView.name = 'proxyView';
  ctx.skyDome = null;
  [ctx.hemi, ctx.sun, ctx.grid, ctx.tcVisual, ctx.proxyView].forEach((f) => ctx.scene.add(f));
  ctx.objects = [];
  return ctx;
}

test('nouvelleScene() retire un orphelin présent dans scene MAIS absent de objets[]', () => {
  const ctx = contexteNouvelleScene();
  const orphelin = new ctx.THREE.Mesh(new ctx.THREE.BoxGeometry(), new ctx.THREE.MeshBasicMaterial());
  orphelin.name = 'X';
  ctx.scene.add(orphelin);
  // PAS de ctx.objets.push(orphelin) : c'est exactement la fuite reproduite.

  assert.equal(ctx.scene.children.indexOf(orphelin) !== -1, true, 'précondition : l\'orphelin est bien dans le graphe');

  ctx.newScene(false);

  assert.equal(ctx.scene.children.indexOf(orphelin), -1,
    'un objet du graphe réel non suivi dans objets[] doit être retiré par nouvelleScene()');
});

test('nouvelleScene() garde les fixtures permanentes (hemi/sun/grid/tcVisual/proxyView)', () => {
  const ctx = contexteNouvelleScene();
  ctx.newScene(false);
  [ctx.hemi, ctx.sun, ctx.grid, ctx.tcVisual, ctx.proxyView].forEach((f) => {
    assert.equal(ctx.scene.children.indexOf(f) !== -1, true, f.name + ' ne doit pas être retiré');
  });
});

test('nouvelleScene() retire toujours un objet normal, suivi dans objets[]', () => {
  const ctx = contexteNouvelleScene();
  const normal = new ctx.THREE.Mesh(new ctx.THREE.BoxGeometry(), new ctx.THREE.MeshBasicMaterial());
  normal.name = 'Cube';
  normal.userData.type = 'mesh';
  ctx.scene.add(normal);
  ctx.objects.push(normal);

  ctx.newScene(false);

  assert.equal(ctx.scene.children.indexOf(normal), -1);
  assert.equal(ctx.objects.length, 0);
});

// Note : le symptôme réel observé en session (scene.getObjectById() retombant sur
// l'orphelin plutôt que le bon object) est une COLLISION D'ID three.js. Le counter
// Object3D est un module-level counter jamais remis à zéro dans la durée de vie de la
// PAGE — reproduire une vraie collision demanderait de replay un reset de counter
// (un rechargement de page) qu'un seul contexte vm ne modélise pas fidèlement. Le test
// ci-dessus (l'orphelin est bien retiré du graphe) couvre la cause réelle ; la
// collision d'id n'en est qu'une conséquence côté navigateur, pas re-testée séparément.
