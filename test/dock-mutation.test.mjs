// DÉPLACER UN ONGLET NE DOIT JAMAIS PRODUIRE UN ARBRE INVALIDE.
//
// Chaque dépôt peut vider une zone, laisser un split à un seul enfant, ou faire pointer un
// onglet actif sur un panneau parti ailleurs. Un arbre invalide ne plante pas : il affiche une
// zone vide, ou fait disparaître un panneau sans rien dire.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte } from './engine-env.mjs';

const env = creerContexte(['js/ui/dock-tree.js']);
const { LAYOUT_DEFAULT, normalizeLayout, applyDrop, popOutPanel, zonesOf, panelsOf, serializeLayout } = env;

const connus = ['hierarchy', 'viewport', 'inspector', 'project', 'console'];
// 'console' est déclaré `onDemand` dans la vraie appli (js/ui/panels-shell.js) : sans zone par
// défaut NI onDemand ici, `normalizeLayout` le ferait flotter — un panneau en plus que la vraie
// disposition initiale n'a pas, qui fausserait les décomptes de `floating` de ce fichier.
// `applyDrop`/`popOutPanel` re-normalisent leur résultat avec LEURS PROPRES descripteurs : le
// redire à chaque appel évite qu'il ne réapparaisse flottant à chaque mutation testée ici.
const DESCR_CONSOLE_ON_DEMAND = {console: {onDemand: true}};
function neuf(){ return normalizeLayout(LAYOUT_DEFAULT, connus, {}, DESCR_CONSOLE_ON_DEMAND); }
function zone(l, name){ return zonesOf(l.root).find((z) => z.zone === name); }

test('empiler au centre d une zone ajoute l onglet et l active', () => {
  const l = applyDrop(neuf(), 'inspector', { zone: 'left', where: 'center' }, {}, connus);
  assert.ok(Array.from(zone(l, 'left').tabs).indexOf('inspector') !== -1);
  assert.equal(zone(l, 'left').active, 'inspector', 'un onglet qu on vient de poser est celui qu on regarde');
});

test('la zone d origine perd l onglet, et une zone videe disparait', () => {
  const l = applyDrop(neuf(), 'inspector', { zone: 'left', where: 'center' }, {}, connus);
  assert.equal(zone(l, 'right'), undefined, 'la zone videe disparait');
});

test('AUCUN panneau n est perdu par un deplacement', () => {
  const avant = panelsOf(neuf()).slice().sort();
  const apres = panelsOf(applyDrop(neuf(), 'inspector', { zone: 'bottom', where: 'center' }, DESCR_CONSOLE_ON_DEMAND, connus)).slice().sort();
  assert.deepEqual(Array.from(apres), Array.from(avant));
});

test('deposer sur un bord scinde, dans la bonne direction et le bon ordre', () => {
  const l = applyDrop(neuf(), 'inspector', { zone: 'left', where: 'top' }, {}, connus);
  const parent = (function chercher(n){
    if(!n.split) return null;
    if(n.children.some((c) => c.zone && Array.from(c.tabs).indexOf('inspector') !== -1)) return n;
    return n.children.map(chercher).find(Boolean) || null;
  })(l.root);
  assert.equal(parent.split, 'col', 'un depot en HAUT scinde en colonne');
  assert.ok(Array.from(parent.children[0].tabs).indexOf('inspector') !== -1,
    'un depot en HAUT met la nouvelle zone en PREMIER');
});

test('un split issu d une scission partage la place en deux', () => {
  const l = applyDrop(neuf(), 'inspector', { zone: 'left', where: 'top' }, {}, connus);
  (function verifie(n){
    if(!n.split) return;
    assert.ok(Math.abs(n.sizes.reduce((a, b) => a + b, 0) - 1) < 1e-6);
    n.children.forEach(verifie);
  })(l.root);
});

test('reordonner dans la MEME pile ne cree pas de zone', () => {
  const base = neuf();
  const avant = zonesOf(base.root).length;
  const l = applyDrop(base, 'console', { zone: 'bottom', where: 'tab', index: 0 }, {}, connus);
  assert.equal(zonesOf(l.root).length, avant);
  assert.deepEqual(Array.from(zone(l, 'bottom').tabs), ['console', 'project']);
});

test('deposer un onglet sur SA propre zone au centre ne change rien', () => {
  const base = neuf();
  const l = applyDrop(base, 'hierarchy', { zone: 'left', where: 'center' }, {}, connus);
  assert.equal(serializeLayout(l), serializeLayout(base));
});

test('applyDrop ne MUTE JAMAIS l arbre qu on lui donne', () => {
  const base = neuf();
  const avant = serializeLayout(base);
  applyDrop(base, 'inspector', { zone: 'left', where: 'center' }, {}, connus);
  assert.equal(serializeLayout(base), avant,
    'sans immuabilite, Echap ne pourrait pas annuler un depot en jetant le resultat');
});

test('detacher sort l onglet de l arbre et le met en flottant', () => {
  const l = applyDrop(neuf(), 'inspector', { where: 'outside', x: 100, y: 80 }, {}, connus);
  assert.ok(l.floating.some((f) => f.panel === 'inspector'));
  assert.equal(zone(l, 'right'), undefined);
  assert.ok(panelsOf(l).indexOf('inspector') !== -1, 'un panneau flottant reste un panneau du layout');
});

test('rattacher un flottant le remet dans une zone', () => {
  let l = applyDrop(neuf(), 'inspector', { where: 'outside', x: 100, y: 80 }, DESCR_CONSOLE_ON_DEMAND, connus);
  l = applyDrop(l, 'inspector', { zone: 'bottom', where: 'center' }, DESCR_CONSOLE_ON_DEMAND, connus);
  assert.equal(l.floating.length, 0);
  assert.ok(Array.from(zone(l, 'bottom').tabs).indexOf('inspector') !== -1);
});

test('la vue 3D ne peut etre ni detachee ni perdue', () => {
  const descr = { viewport: { closable: false, floatable: false }, console: { onDemand: true } };
  const base = neuf();
  const l = applyDrop(base, 'viewport', { where: 'outside', x: 10, y: 10 }, descr, connus);
  assert.equal(l.floating.length, 0, 'un refus ne doit PAS produire un layout a moitie mute');
  assert.equal(serializeLayout(l), serializeLayout(base), 'un depot refuse rend l arbre INCHANGE');
  assert.ok(panelsOf(l).indexOf('viewport') !== -1);
});

test('popper sort l onglet de l arbre et le met dans popped, pas floating', () => {
  const l = popOutPanel(neuf(), 'inspector', null, DESCR_CONSOLE_ON_DEMAND, connus);
  assert.ok(l.popped.some((f) => f.panel === 'inspector'));
  assert.equal(l.floating.length, 0);
  assert.equal(zone(l, 'right'), undefined);
  assert.ok(panelsOf(l).indexOf('inspector') !== -1, 'un panneau poppe reste un panneau du layout');
});

test('rattacher (applyDrop) un panneau poppe le sort de popped', () => {
  let l = popOutPanel(neuf(), 'inspector', null, {}, connus);
  l = applyDrop(l, 'inspector', { zone: 'bottom', where: 'center' }, {}, connus);
  assert.equal(l.popped.length, 0);
  assert.ok(Array.from(zone(l, 'bottom').tabs).indexOf('inspector') !== -1);
});

test('la vue 3D ne peut pas etre poppee', () => {
  const descr = { viewport: { closable: false, poppable: false } };
  const base = neuf();
  const l = popOutPanel(base, 'viewport', null, descr, connus);
  assert.equal(l.popped.length, 0, 'un refus ne doit PAS produire un layout a moitie mute');
  assert.equal(serializeLayout(l), serializeLayout(base));
});
