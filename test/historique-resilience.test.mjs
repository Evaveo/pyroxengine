// moteur/test/historique-resilience.test.mjs
//
// RÉGRESSION (docs/REVUE_2026-09-14.md § 2, causes 4 et 5). Deux pannes muettes de l'historique :
//
//   • `pushHistory()` sortait AVANT de poser `autosave.modifie` quand la simulation physique ou
//     le mode lecture tournait. Toute édition faite là n'était donc jamais marquée : ni autosave,
//     ni indicateur « projet non enregistré ». Or `stopSimulation()` ne remet que les positions
//     des corps photographiés, et le mode lecture ne restaure rien — ces éditions sont réelles.
//
//   • `restoreState()` posait `histo.gel = true`, enchaînait vingt sous-systèmes sans filet, et
//     ne remettait `gel = false` qu'à la toute dernière ligne. Une exception n'importe où GELAIT
//     L'HISTORIQUE POUR LE RESTE DE LA SESSION, sans le moindre message.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deEsm } from './engine-env.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');

/** js/history.js dans un bac, avec de quoi faire tourner `restoreState` en entier. */
function contexte(surcharges){
  const noop = function(){};
  const element = () => ({value: '', classList: {toggle: noop, add: noop, remove: noop}});
  const bac = {
    console: {error: noop, warn: noop, log: noop},
    Math, JSON, Object, Array, Set, Map, String, Number, RegExp, Error,
    assets: [], objects: [],
    Registry: {activeNodes(){ return []; }},
    anim: {tracks: [], duration: 5, loop: true, t: 0, playback: false},
    env: {sky: 'uni'}, ENV_DEFAULT: {sky: 'uni'},
    selection: null, selectionMulti: [], assetSelected: null,
    phys: {active: false}, autosave: {modifie: false},
    scene: {remove: noop, add: noop},
    btnPlayback: {textContent: ''},
    document: {getElementById: element},
    serializeObject: (o) => ({id: o.id}),
    // Le strict nécessaire pour traverser `restoreState` sans DOM ni three.js.
    stopSimulation: noop, gizmoAttach: noop, removeHelper: noop, listMats: () => [],
    clearSceneObjects: noop, setSelectionRaw: noop, setKeySel: noop, addSceneObject: noop,
    disposeAllProbes: noop, cleanVisualsSkeleton: noop, populateSubScene: noop,
    closeClipAsset: noop, applyEnvironment: noop, select: noop, setHighlight: noop,
    updateHierarchy: noop, updateTimeline: noop, updateProject: noop,
    refreshInspectorAsset: noop, applyFilters: noop, boneByName: () => null,
    rebuildTree: () => ({racines: [], byId: {}}),
    ensureParamsImport: (a) => (a.paramsImport = a.paramsImport || {}),
    applyImportTexture: noop, applyImportModel: noop, applyImportAudio: noop,
    applyMaterialEverywhere: noop, refreshSpritesOfLAsset: noop, selectAsset: noop,
    URL: {createObjectURL: () => 'blob:x', revokeObjectURL: noop},
    setStatus: noop, logConsole: noop
  };
  Object.assign(bac, surcharges || {});
  bac.window = bac; bac.globalThis = bac;
  const ctx = vm.createContext(bac);
  vm.runInContext(deEsm(read('js/history.js')), ctx, {filename: 'js/history.js'});
  vm.runInContext('this.histo = histo; this.pushHistory = pushHistory;', ctx);
  return bac;
}

const etatVide = () => ({assets: [], fieldsAssets: [], objects: [], tracks: [],
  duration: 5, loop: true, env: {sky: 'uni'}, selId: null, multiIds: []});

test('une édition PENDANT la simulation marque le projet comme modifié', () => {
  const c = contexte();
  c.phys.active = true;
  c.pushHistory();
  assert.equal(c.autosave.modifie, true,
    'une édition faite en simulation n\'est jamais restaurée par stopSimulation : elle doit '
    + 'marquer le projet modifié');
  assert.equal(c.histo.undo.length, 0, 'mais elle ne doit toujours PAS s\'empiler dans l\'historique');
});

test('le gel de restauration, lui, ne marque rien', () => {
  // `histo.gel` est le drapeau de restoreState : undo/redo ET chargement de projet. Marquer là
  // rendrait tout projet fraîchement ouvert « non enregistré » avant le moindre geste.
  const c = contexte();
  c.histo.gel = true;
  c.pushHistory();
  assert.equal(c.autosave.modifie, false);
});

test('restoreState dégèle l\'historique même quand un sous-système explose', () => {
  const c = contexte({applyEnvironment(){ throw new Error('sous-système en panne'); }});
  c.restoreState(etatVide());
  assert.equal(c.histo.gel, false,
    'histo.gel resté à true : plus aucune édition ne serait marquée pour le reste de la session');
});

test('restoreState poursuit les sous-systèmes suivants après une exception', () => {
  const vus = [];
  const c = contexte({
    applyEnvironment(){ throw new Error('environnement en panne'); },
    updateHierarchy(){ vus.push('hiérarchie'); },
    applyFilters(){ vus.push('calques'); },
    updateProject(){ vus.push('projet'); }
  });
  c.restoreState(etatVide());
  assert.deepEqual(vus, ['hiérarchie', 'projet', 'calques'],
    'une exception dans un sous-système ne doit pas emporter tous ceux d\'après');
});

test('restoreState signale la panne au lieu de la taire', () => {
  const messages = [];
  const c = contexte({
    applyFilters(){ throw new Error('calques en panne'); },
    logConsole(niveau, msg){ messages.push(msg); }
  });
  c.restoreState(etatVide());
  assert.equal(messages.length, 1, 'la panne doit atterrir dans la Console de l\'éditeur');
  assert.match(messages[0], /calques en panne/);
});

test('même une exception de rebuildTree ne laisse pas l\'historique gelé', () => {
  // Celui-là n'est PAS isolé : il n'y a rien à restaurer sans lui. Mais le try/finally doit
  // quand même rendre la main à un éditeur utilisable.
  const c = contexte({rebuildTree(){ throw new Error('arbre illisible'); }});
  assert.throws(() => c.restoreState(etatVide()), /arbre illisible/);
  assert.equal(c.histo.gel, false);
});

// ---------------------------------------------------------------------------
// UNE SCÈNE ÉCRITE À LA MAIN NE DOIT PAS DÉMONTER L'ÉDITEUR
//
// Le format dossier INVITE à écrire un `.scene.json` à la main ou à le faire engendrer par un
// script — c'est tout son intérêt. `restoreState` lisait pourtant `state.tracks.map(…)` et
// `rebuildTree(state.objects, …)` sans garde : une scène sans animation levait un TypeError EN
// PLEIN CHARGEMENT du projet, scène déjà démontée et pas encore remontée. L'éditeur restait sur
// un projet à moitié chargé, et le message (« Cannot read properties of undefined ») ne désignait
// ni le fichier fautif ni le champ manquant. Mesuré sur jeux/Chromelo.
//
// `env`, `multiIds`, `assets` et `fieldsAssets` étaient DÉJÀ défendus de cette façon : ce sont
// seulement les deux derniers champs qui manquaient à l'appel.

test('une scène sans `tracks` se charge : l\'animation est optionnelle', () => {
  const c = contexte();
  const etat = etatVide();
  delete etat.tracks;
  assert.doesNotThrow(() => c.restoreState(etat));
  // `.length` et pas `deepEqual([])` : le tableau vient de l'autre réalm du `vm`, donc son
  // prototype n'est pas celui d'ici et la comparaison stricte échoue sur la seule identité.
  assert.equal(c.anim.tracks.length, 0);
});

test('une scène sans `objects` se charge elle aussi', () => {
  const c = contexte();
  const etat = etatVide();
  delete etat.objects;
  assert.doesNotThrow(() => c.restoreState(etat));
});

test('une scène réduite à `{objects}` — ce qu\'écrit un générateur — se charge', () => {
  // Le cas réel : un script qui pose des objets et rien d'autre.
  const c = contexte();
  assert.doesNotThrow(() => c.restoreState({objects: []}));
  assert.equal(c.anim.duration, 5, 'une durée par défaut, pas `undefined`');
  assert.equal(c.anim.loop, true);
});

test('et l\'historique ne reste pas gelé après une scène incomplète', () => {
  // La moitié non négociable : quoi qu'il arrive, `histo.gel` redevient faux. Un historique gelé
  // pour le reste de la session serait la pire suite possible à un fichier mal formé.
  const c = contexte();
  c.restoreState({});
  assert.equal(c.histo.gel, false);
});


// ---------- Verrou de scene : le refus vit dans pushHistory ----------
// C'est le POINT D'ETRANGLEMENT : la convention veut que pushHistory() soit appele avant toute
// mutation de scene, donc refuser la garantit qu'aucune n'a commence. Sans ces tests, desactiver
// la garde ne faisait tomber personne — verifie par mutation avant de les ecrire.

test('une scene verrouillee par quelqu un d autre REFUSE la mutation', () => {
  const bac = contexte({ lockBlocks: () => true, lockMessage: () => 'prise par remi@evaveo.com' });
  let vu = null;
  bac.setStatus = function(m){ vu = m; };
  assert.throws(() => bac.pushHistory(),
    (e) => e.name === 'ReadOnlySceneError' || /prise par/.test(e.message),
    'pushHistory doit LEVER : 122 sites d appel ne lisent aucune valeur de retour, et un refus '
    + 'silencieux laisserait la mutation se faire quand meme');
  assert.match(String(vu), /remi@evaveo\.com/, 'le detenteur doit etre nomme a l ecran');
  assert.equal(bac.histo.undo.length, 0, 'rien ne doit etre empile');
});

test('une scene libre laisse passer, et DEMANDE le verrou au premier geste', () => {
  let demandes = 0;
  const bac = contexte({ lockBlocks: () => false, lockMessage: () => '',
                         claimIfNeeded: () => { demandes++; } });
  bac.pushHistory();
  assert.equal(demandes, 1, 'le premier geste declenche la demande, sans l attendre');
  assert.equal(bac.histo.undo.length, 1, 'et la mutation est bien empilee');
});

test('sans module de verrou, tout passe comme avant', () => {
  // Le repli DOIT etre l ancien comportement : un editeur ouvert hors ligne, ou un harnais de
  // test qui ne charge pas scene-lock.js, ne doit surtout pas se retrouver en lecture seule.
  const bac = contexte({});
  bac.pushHistory();
  assert.equal(bac.histo.undo.length, 1);
});
