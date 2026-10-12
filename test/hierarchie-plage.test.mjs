// Maj+clic dans la hiérarchie : la sélection par PLAGE, comme dans Unity.
//
// Le défaut signalé : « dans la hiérarchie, on ne peut pas sélectionner plusieurs GameObjects
// avec Shift ». Le calcul (js/hierarchy-range.js) est pur et testé d'abord seul ; le branchement
// (js/hierarchy.js) l'est ensuite dans le même harnais que hierarchie-selection.test.mjs, avec de
// FAUSSES fonctions de sélection qui enregistrent ce qu'on leur demande.
import { deEsm } from './engine-env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hierarchyClickGesture, pruneNestedIds, rangeIds, rangeSelection, resolveRangeAnchor
} from '../js/hierarchy-range.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------- Le calcul ----------

// L'arbre affiché : A, B (déplié : B1, B2), C, D. `parentOf` le décrit.
const ORDER = [1, 2, 21, 22, 3, 4];
const PARENT = {21: 2, 22: 2};
const parentOf = (id) => (PARENT[id] !== undefined ? PARENT[id] : null);

test('la plage suit l\'ordre AFFICHÉ, bornes comprises, dans les deux sens', () => {
  assert.deepEqual(rangeIds(ORDER, 1, 3), [1, 2, 21, 22, 3]);
  assert.deepEqual(rangeIds(ORDER, 4, 21), [21, 22, 3, 4]);
  assert.deepEqual(rangeIds(ORDER, 3, 3), [3]);
});

test('sans ancre affichée, la plage se réduit à la cible ; une cible absente ne donne rien', () => {
  assert.deepEqual(rangeIds(ORDER, 99, 3), [3]);
  assert.deepEqual(rangeIds(ORDER, null, 3), [3]);
  assert.deepEqual(rangeIds(ORDER, 1, 99), []);
});

test('un enfant replié n\'est pas affiché, donc hors de la plage', () => {
  const plie = [1, 2, 3, 4];   // B replié : B1 et B2 ne sont pas des lignes
  assert.deepEqual(rangeIds(plie, 1, 3), [1, 2, 3]);
});

test('un parent ET son enfant dans la plage : on garde le PARENT (il emporte ses enfants)', () => {
  assert.deepEqual(pruneNestedIds([1, 2, 21, 22, 3], parentOf), [1, 2, 3]);
  assert.deepEqual(pruneNestedIds([21, 22, 3], parentOf), [21, 22, 3],
    'sans leur parent, des frères restent sélectionnables ensemble');
});

test('l\'objet principal est la ligne CLIQUÉE, ou son parent s\'il l\'a absorbée', () => {
  assert.deepEqual(rangeSelection(ORDER, 1, 3, parentOf), {primary: 3, ids: [1, 2, 3]});
  // Maj+clic sur B2 depuis A : B est dans la plage, B2 est absorbé — le principal remonte à B
  assert.deepEqual(rangeSelection(ORDER, 1, 22, parentOf), {primary: 2, ids: [1, 2]});
  // depuis B1 vers D : B n'est pas dans la plage, B1 et B2 restent
  assert.deepEqual(rangeSelection(ORDER, 21, 4, parentOf), {primary: 4, ids: [21, 22, 3, 4]});
});

test('l\'ancre : la dernière ligne cliquée si elle est encore sélectionnée et affichée', () => {
  assert.equal(resolveRangeAnchor(2, [2, 3], 3, ORDER), 2);
  // elle n'est plus sélectionnée (clic dans la vue entre-temps) : on repart du principal
  assert.equal(resolveRangeAnchor(2, [4], 4, ORDER), 4);
  // elle n'est plus affichée (parent replié) : idem
  assert.equal(resolveRangeAnchor(21, [21, 4], 4, [1, 2, 3, 4]), 4);
  // rien de sélectionné, rien d'où partir
  assert.equal(resolveRangeAnchor(null, [], null, ORDER), null);
});

test('le geste se lit sur les touches tenues (Cmd vaut Ctrl, comme sur Mac)', () => {
  assert.equal(hierarchyClickGesture({}), 'single');
  assert.equal(hierarchyClickGesture({ctrlKey: true}), 'toggle');
  assert.equal(hierarchyClickGesture({metaKey: true}), 'toggle');
  assert.equal(hierarchyClickGesture({shiftKey: true}), 'range');
  assert.equal(hierarchyClickGesture({shiftKey: true, ctrlKey: true}), 'addRange');
});

// ---------- Le branchement dans js/hierarchy.js ----------

function fakeEl(tag){
  const listeners = {};
  const classes = new Set();
  const el = {
    tagName: tag || 'DIV', dataset: {}, children: [], parent: null,
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c) },
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
    closest(selector){
      const cls = selector.replace('.', '');
      let n = el;
      while(n){ if(n.classList.contains(cls)) return n; n = n.parent; }
      return null;
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    appendChild: (c) => { el.children.push(c); c.parent = el; },
    fire(type, evt){ (listeners[type] || []).forEach((fn) => fn(evt)); }
  };
  return el;
}

function row(id){
  const line = fakeEl('DIV');
  line.classList.add('node');
  line.dataset.id = String(id);
  const name = fakeEl('SPAN');
  name.classList.add('node-name');
  line.appendChild(name);
  return {line, name};
}

/** Charge le vrai js/hierarchy.js avec une sélection factice qui se comporte comme la vraie. */
function loadHierarchy(nodes, shownIds){
  const hierBody = fakeEl('DIV');
  const hierFilter = fakeEl('INPUT');
  hierFilter.value = '';
  const rows = new Map(shownIds.map((id) => [id, row(id)]));
  hierBody.querySelectorAll = (sel) => (sel === '.node[data-id]' ? shownIds.map((id) => rows.get(id).line) : []);
  const state = {selection: null, multi: [], inspectorBuilds: 0};
  const ctx = {
    document: { getElementById: (id) => (id === 'hier-body' ? hierBody : id === 'hier-filter' ? hierFilter : fakeEl('DIV')) },
    objects: nodes, scene: { children: nodes.filter((n) => !n.parent || !nodes.includes(n.parent)) },
    objectOfSceneById: (id) => nodes.find((o) => o.id === id) || null,
    isSceneObject: (o) => nodes.indexOf(o) !== -1,
    ed: (o) => (o._ed = o._ed || {}),
    escapeHtml: (s) => String(s),
    select: (o) => { state.selection = o; state.multi = []; },
    toggleMulti: (o) => {
      if(!state.selection){ state.selection = o; return; }
      const i = state.multi.indexOf(o);
      if(i === -1) state.multi.push(o); else state.multi.splice(i, 1);
    },
    addMultiInBatch: (list) => list.forEach((o) => {
      if(o === state.selection || state.multi.includes(o)) return;
      if(!state.selection) state.selection = o; else state.multi.push(o);
    }),
    allSelection: () => (state.selection ? [state.selection] : []).concat(state.multi),
    get selection(){ return state.selection; },
    selectionMulti: state.multi,
    buildInspector: () => { state.inspectorBuilds++; },
    pushHistory: () => {}, updateTimeline: () => {}, syncInspector: () => {},
    itemsCreationContext: () => [], openMenuContext: () => {}
  };
  vm.createContext(ctx);
  ctx.THREE = { Matrix4: function(){ this.makeScale = () => this; } };
  for(const f of ['render-perf.js', 'ui/icon.js', 'hierarchy-icon.js', 'hierarchy-range.js', 'hierarchy.js']){
    vm.runInContext(deEsm(fs.readFileSync(path.join(dirname, '..', 'js', f), 'utf8')), ctx);
  }
  const click = (id, mods) => hierBody.fire('click', Object.assign({target: rows.get(id).name}, mods || {}));
  const selectedIds = () => ctx.allSelection().map((o) => o.id);
  return {click, state, selectedIds};
}

function sceneNodes(){
  const mk = (id, name, parent) => ({id, name, parent: parent || null, visible: true, children: [], userData: {type: 'mesh'}});
  const a = mk(1, 'A'), b = mk(2, 'B'), c = mk(3, 'C'), d = mk(4, 'D');
  const b1 = mk(21, 'B1', b), b2 = mk(22, 'B2', b);
  b.children.push(b1, b2);
  return [a, b, b1, b2, c, d];
}

test('Maj+clic sélectionne la plage depuis la dernière ligne cliquée', () => {
  const h = loadHierarchy(sceneNodes(), [1, 2, 21, 22, 3, 4]);
  h.click(21);
  h.click(4, {shiftKey: true});
  assert.equal(h.state.selection.id, 4, 'la ligne cliquée devient l\'objet principal');
  assert.deepEqual(h.selectedIds().sort((x, y) => x - y), [3, 4, 21, 22]);
  assert.ok(h.state.inspectorBuilds > 0, 'l\'inspecteur suit la multi-sélection');
});

test('l\'ancre ne bouge pas : un second Maj+clic RÉDUIT la plage au lieu de repartir', () => {
  const h = loadHierarchy(sceneNodes(), [1, 2, 21, 22, 3, 4]);
  h.click(21);
  h.click(4, {shiftKey: true});
  h.click(22, {shiftKey: true});
  assert.deepEqual(h.selectedIds().sort((x, y) => x - y), [21, 22]);
});

test('Maj+clic remplace la sélection ; Maj+Ctrl+clic AJOUTE la plage', () => {
  const h = loadHierarchy(sceneNodes(), [1, 2, 21, 22, 3, 4]);
  h.click(1);
  h.click(3, {ctrlKey: true});   // A + C, ancre sur C
  h.click(4, {shiftKey: true});
  assert.deepEqual(h.selectedIds().sort((x, y) => x - y), [3, 4], 'Maj seul : la plage remplace');
  h.click(1);
  h.click(21, {ctrlKey: true});  // A + B1, ancre sur B1
  h.click(3, {shiftKey: true, ctrlKey: true});
  assert.deepEqual(h.selectedIds().sort((x, y) => x - y), [1, 3, 21, 22], 'Maj+Ctrl : la plage s\'ajoute');
});

test('une plage qui traverse un groupe déplié garde le parent, pas parent ET enfants', () => {
  const h = loadHierarchy(sceneNodes(), [1, 2, 21, 22, 3, 4]);
  h.click(1);
  h.click(3, {shiftKey: true});
  assert.deepEqual(h.selectedIds().sort((x, y) => x - y), [1, 2, 3]);
});

test('sans rien de sélectionné, Maj+clic vaut un clic simple', () => {
  const h = loadHierarchy(sceneNodes(), [1, 2, 21, 22, 3, 4]);
  h.click(3, {shiftKey: true});
  assert.deepEqual(h.selectedIds(), [3]);
  h.click(1, {shiftKey: true});
  assert.deepEqual(h.selectedIds().sort((x, y) => x - y), [1, 2, 3], 'et il a posé l\'ancre');
});
