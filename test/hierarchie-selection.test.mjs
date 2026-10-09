import { deEsm } from './engine-env.mjs';
// moteur/test/hierarchie-selection.test.mjs
//
// Cliquer sur une ligne de la hiérarchie ne sélectionnait pas l'objet quand le clic tombait
// sur l'icône de fold (▶/▼), MÊME pour un objet sans enfant ('empty', rien à plier) — la
// fonction retournait avant d'atteindre select(obj). Comme la quasi-totalité des objets
// de scène sont des feuilles (aucun enfant), cette icône couvre une bonne partie de chaque
// ligne et le clic y échouait en silence, de façon apparemment aléatoire selon la position
// exacte du curseur. Voir moteur/js/hierarchy.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));

function elementFactice(tag) {
  const ecouteurs = {};
  const classes = new Set();
  const el = {
    tagName: tag || 'DIV',
    dataset: {},
    children: [],
    parent: null,
    _classes: classes,
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
      toggle: (c) => (classes.has(c) ? classes.delete(c) : classes.add(c))
    },
    addEventListener: (type, fn) => { (ecouteurs[type] = ecouteurs[type] || []).push(fn); },
    removeEventListener: (type, fn) => {
      if (ecouteurs[type]) ecouteurs[type] = ecouteurs[type].filter((f) => f !== fn);
    },
    // .closest('.node') : remonte les parents jusqu'à trouver la classe demandée
    closest(selector) {
      const cls = selector.replace('.', '');
      let n = el;
      while (n) { if (n.classList.contains(cls)) return n; n = n.parent; }
      return null;
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    appendChild: (c) => { el.children.push(c); c.parent = el; },
    _declencher(type, evt) { (ecouteurs[type] || []).forEach((fn) => fn(evt)); }
  };
  return el;
}

// Construit le DOM d'une ligne « .node » comme updateHierarchy() la génère : un conteneur
// portant data-id et la classe 'node', avec une icône .fold (vide ou non) à l'intérieur.
function ligneNoeud(id, { aEnfants }) {
  const line = elementFactice('DIV');
  line.classList.add('node');
  line.dataset.id = String(id);
  const fold = elementFactice('SPAN');
  fold.classList.add('fold');
  if (!aEnfants) fold.classList.add('empty');
  line.appendChild(fold);
  const eye = elementFactice('SPAN');
  eye.classList.add('eye');
  line.appendChild(eye);
  const name = elementFactice('SPAN');
  name.classList.add('node-name');
  line.appendChild(name);
  return { line, fold, eye, name };
}

function chargerHierarchie(objectsScene) {
  const hierBody = elementFactice('DIV');
  const hierFilter = elementFactice('INPUT');
  hierFilter.value = '';

  const appels = { select: [], toggleMulti: [], pliBascule: [] };

  const ctx = {
    document: {
      getElementById: (id) => (id === 'hier-body' ? hierBody : id === 'hier-filter' ? hierFilter : elementFactice('DIV'))
    },
    objects: objectsScene,
    // .children : updateHierarchy() (appelée par les handlers fold/œil) parcourt l'arbre depuis
    // la scène — tous nos objets de test sont à la racine.
    scene: { children: objectsScene },
    // objFromNode (hierarchy.js) cherche via objectOfSceneById (js/objects.js), jamais
    // scene.getObjectById — voir object-scene-par-id.test.mjs pour le pourquoi (collision
    // d'id avec des internes du moteur hors du tableau objets, ex. le gizmo).
    objectOfSceneById: (id) => objectsScene.find((o) => o.id === id) || null,
    // Même raison : hierarchy.js demande « cet Object3D est-il un objet de project ? » à
    // l'index de objets.js (isSceneObject, O(1)) au lieu du objets.indexOf() qu'il posait
    // à l'intérieur d'une boucle sur objets — quadratique sur une grande scène.
    isSceneObject: (o) => objectsScene.indexOf(o) !== -1,
    selection: null,
    selectionMulti: [],
    ed: (o) => (o._ed = o._ed || {}),
    escapeHtml: (s) => String(s),
    select: (o) => appels.select.push(o),
    toggleMulti: (o) => appels.toggleMulti.push(o),
    pushHistory: () => {},
    updateTimeline: () => {},
    syncInspector: () => {},
    itemsCreationContext: () => [],
    openMenuContext: () => {},
    typePlugin: () => null
  };
  vm.createContext(ctx);
  // `iconOf` a quitté hierarchy.js pour js/hierarchy-icon.js (elle dérive l'icône des
  // composants du nœud) : sans ce chargement, updateHierarchy plante sur chaque ligne.
  // `Icons` AVANT les deux autres : depuis que le chevron et l'œil sont des icônes Phosphor,
  // hierarchy.js appelle `Icons.html` à chaque ligne rendue. Sans ce chargement, le rendu de
  // l'arbre lève un ReferenceError — ce qui est la bonne nouvelle : la dépendance est réelle
  // et le harnais doit la refléter, pas la contourner.
  // `visibleIntent` vient du VRAI js/render-perf.js, pas d'un substitut. Le panneau lit
  // desormais l'INTENTION d'affichage et non `visible` : un objet regroupe dans un lot
  // d'instances porte `visible = false` pour que le lot le dessine, et l'oeil ne doit pas
  // s'en trouver barre. Un faux `visibleIntent` pose ici rendrait ce test aveugle a
  // exactement la distinction qu'il doit verifier.
  //
  // Le module ne veut de `THREE` qu'une `Matrix4` a son chargement (MAT_ZERO) : c'est le
  // vendor qu'on reduit, pas l'unite testee.
  ctx.THREE = { Matrix4: function(){ this.makeScale = () => this; } };
  vm.runInContext(deEsm(fs.readFileSync(path.join(dirname, '..', 'js', 'render-perf.js'), 'utf8')), ctx);
  vm.runInContext(deEsm(fs.readFileSync(path.join(dirname, '..', 'js', 'ui', 'icon.js'), 'utf8')), ctx);
  vm.runInContext(deEsm(fs.readFileSync(path.join(dirname, '..', 'js', 'hierarchy-icon.js'), 'utf8')), ctx);
  vm.runInContext(deEsm(fs.readFileSync(path.join(dirname, '..', 'js', 'hierarchy.js'), 'utf8')), ctx);
  return { ctx, hierBody, appels };
}

function objetFeuille(id, name) {
  return { id, name: name, visible: true, children: [], userData: { type: 'mesh' } };
}

test('cliquer sur le NOM d\'un objet le sélectionne', () => {
  const obj = objetFeuille(1, 'Levier 1');
  const { hierBody, appels } = chargerHierarchie([obj]);
  const { name } = ligneNoeud(1, { aEnfants: false });
  hierBody._declencher('click', { target: name, ctrlKey: false, metaKey: false });
  assert.deepEqual(appels.select, [obj]);
});

test('cliquer sur l\'icône de fold VIDE (objet sans enfant) sélectionne quand même l\'object', () => {
  const obj = objetFeuille(2, 'Dalle 1');
  const { hierBody, appels } = chargerHierarchie([obj]);
  const { fold } = ligneNoeud(2, { aEnfants: false });
  hierBody._declencher('click', { target: fold, ctrlKey: false, metaKey: false });
  assert.deepEqual(appels.select, [obj],
    'un clic sur l\'icône .fold.vide ne doit pas être perdu — il n\'y a rien à plier, donc rien ne doit empêcher la sélection');
});

test('cliquer sur l\'icône de fold d\'un objet AVEC enfants la plie/déplie et ne sélectionne pas', () => {
  const obj = objetFeuille(3, 'Groupe');
  const { ctx, hierBody, appels } = chargerHierarchie([obj]);
  const { fold } = ligneNoeud(3, { aEnfants: true });
  const avant = ctx.ed(obj).plie;
  hierBody._declencher('click', { target: fold, ctrlKey: false, metaKey: false });
  assert.equal(appels.select.length, 0, 'un vrai fold/défold ne doit pas aussi sélectionner');
  assert.equal(ctx.ed(obj).plie, !avant, 'l\'état foldé doit avoir basculé');
});

test('cliquer sur l\'icône œil bascule la visibilité sans sélectionner', () => {
  const obj = objetFeuille(4, 'Torche 1');
  const { hierBody, appels } = chargerHierarchie([obj]);
  const { eye } = ligneNoeud(4, { aEnfants: false });
  hierBody._declencher('click', { target: eye, ctrlKey: false, metaKey: false });
  assert.equal(obj.visible, false);
  assert.equal(appels.select.length, 0);
});

test('Ctrl+clic sur le nom bascule la multi-sélection au lieu de remplacer la sélection', () => {
  const obj = objetFeuille(5, 'Brasero 1');
  const { hierBody, appels } = chargerHierarchie([obj]);
  const { name } = ligneNoeud(5, { aEnfants: false });
  hierBody._declencher('click', { target: name, ctrlKey: true, metaKey: false });
  assert.deepEqual(appels.toggleMulti, [obj]);
  assert.equal(appels.select.length, 0);
});
