// MONTER LE MINI-INSPECTEUR D'ÉTAT/TRANSITION SANS COMPOSANT ANIMATORCONTROLLER.
//
// Bug rapporté : ouvrir la fenêtre Animator depuis le panneau Projet (double-clic sur un asset
// animator, `openAnimatorOnAsset`) sélectionne bien un état/une transition dans le graphe et
// redessine — mais `buildInspector()` (inspector.js) s'arrête à `buildInspectorAsset` dès qu'un
// asset est sélectionné dans le panneau Projet, AVANT même d'atteindre `buildBlocksComponents`
// (qui de toute façon ne trouverait rien : aucun composant réel n'existe sur un objet de scène).
// Résultat mesuré avant correctif : le graphe s'affiche, mais aucun détail d'état/transition ne
// se montre jamais nulle part tant qu'aucun objet portant un AnimatorController n'est
// sélectionné en parallèle — ce que `mountInspectorAnimatorAsset` (js/ui/panels-components.js)
// corrige, appelé depuis `buildInspector` (inspector.js) juste après `buildInspectorAsset`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte } from './engine-env.mjs';

function neuf(){
  return creerContexte(['js/animator.js', 'js/ui/form-plan.js', 'js/ui/panels-components.js']);
}

function assetAnimator(){
  return { id: 'anim1', kind: 'animator', machine: { params: [], states: [], transitions: [] } };
}

// `createForm` (js/ui/form.js) et `inspBody` (inspector.js) ne sont pas chargés dans ce
// contexte minimal — ils touchent un vrai DOM d'inspecteur, hors sujet ici. On les bouchonne
// juste assez pour observer CE QUI LEUR EST PASSÉ : l'hôte monté, et les sections calculées.
function bouchonnerMontage(env){
  const hostsAppended = [];
  env.inspBody = { appendChild(h){ hostsAppended.push(h); } };
  const formsCrees = [];
  env.createForm = function(host, descriptor){
    const form = { host, descriptor, targets: null, setTargets(t){ this.targets = t; } };
    formsCrees.push(form);
    return form;
  };
  env.document.createElement = function(tag){ return { tag, id: null }; };
  return { hostsAppended, formsCrees };
}

test('rien ne se monte sans asset animator, ou sans fenetre Animator ouverte dessus', () => {
  const env = neuf();
  const { hostsAppended } = bouchonnerMontage(env);
  const a = assetAnimator();

  env.mountInspectorAnimatorAsset(null);
  env.mountInspectorAnimatorAsset({ id: 'x', kind: 'texture' });
  assert.equal(hostsAppended.length, 0, 'un asset non-animator ne monte rien');

  env.mountInspectorAnimatorAsset(a);
  assert.equal(hostsAppended.length, 0, 'sans graphAnim.asset pointant sur CET asset, rien ne se monte');

  env.graphAnim = { asset: a, node: null, stateSel: null, transSel: null };
  env.mountInspectorAnimatorAsset(a);
  assert.equal(hostsAppended.length, 0, 'fenetre ouverte sur l\'asset mais rien de selectionne dans le graphe : rien a monter');
});

test('un ETAT selectionne dans le graphe monte sectionsAnimatorState, sans composant ni objet de scene', () => {
  const env = neuf();
  const { hostsAppended, formsCrees } = bouchonnerMontage(env);
  const a = assetAnimator();
  const etat = { name: 'Idle', speed: 1 };
  a.machine.states.push(etat);
  env.graphAnim = { asset: a, node: null, stateSel: etat, transSel: null };

  env.mountInspectorAnimatorAsset(a);

  assert.equal(hostsAppended.length, 1, 'un hote doit etre monte dans inspBody');
  assert.equal(formsCrees.length, 1);
  const form = formsCrees[0];
  assert.deepEqual(form.targets.length, 1, 'setTargets doit recevoir exactement un porteur');
  const c = form.targets[0];
  assert.equal(c.asset, a, 'le porteur expose bien l\'asset édité (pas de composant réel)');
  assert.equal(c.node, null, 'aucun objet de scene requis');
  const sections = form.descriptor.sections();
  assert.ok(sections.some((s) => (s.fields || []).some((f) => (f.ids || []).includes('f-gr-state-name'))),
    'les sections rendues doivent etre celles de sectionsAnimatorState');
});

test('une TRANSITION selectionnee dans le graphe monte sectionsAnimatorTransition', () => {
  const env = neuf();
  const { formsCrees } = bouchonnerMontage(env);
  const a = assetAnimator();
  const t = { de: 'Idle', vers: 'Marche', duration: 0.2, conditions: [] };
  a.machine.transitions.push(t);
  env.graphAnim = { asset: a, node: null, stateSel: null, transSel: t };

  env.mountInspectorAnimatorAsset(a);

  const sections = formsCrees[0].descriptor.sections();
  assert.ok(sections.some((s) => (s.fields || []).some((f) => (f.ids || []).includes('f-gr-tr-duration'))),
    'les sections rendues doivent etre celles de sectionsAnimatorTransition');
});
