// UN HUD QUI SE FIGE À LA PREMIÈRE IMAGE.
//
// `uiDocumentsRedraw` n'appelait `_applyValuesBind` que dans la branche « le HTML a changé ». Le
// HTML vit sur un asset `documentUI` et ne change JAMAIS pendant une partie : les liaisons
// étaient donc posées à la première image, et plus jamais. Un script qui écrit
// `api.uiDocument().valeurs.score` à chaque image affichait le score de la première image, pour
// toujours, sans une seule erreur.
//
// Le symptôme se lit comme « mon script ne tourne pas » — donc on cherche le défaut dans le
// script, jamais dans le rendu de l'interface. Mesuré en écrivant un HUD (jeux/NeonBreach) :
// score, vague et vie restaient à leur valeur de départ pendant que la console affichait les
// bonnes valeurs.
//
// `test/bind-texte.test.mjs` exerce la liaison elle-même, qui était juste. Ce fichier exerce
// l'APPEL, qui ne venait pas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte } from './engine-env.mjs';

function harnais(){
  const env = creerContexte(['js/game-ui.js']);
  const container = env.document.createElement('div');
  const uiDoc = {documentUIId: 'a1', sheetStyleIds: [], values: {score: 0}};
  const node = {id: 7, visible: true, userData: {uiDoc: uiDoc}};
  const doc = {html: '<div data-bind="score"></div>', css: ''};
  // On compte les APPELS. Mesurer le DOM demanderait un querySelectorAll réel, que le harnais
  // n'a pas : ce qui manquait n'était pas la liaison mais son appel, et c'est donc lui qu'on
  // mesure. La liaison elle-même est exercée par test/bind-texte.test.mjs.
  const applied = [];
  env._applyValuesBind = function(div, values){ applied.push(JSON.parse(JSON.stringify(values))); };
  const redraw = () => env.uiDocumentsRedraw(container, [node], function(){}, function(){ return doc; });
  return {env, uiDoc, redraw, applied};
}

test('LES VALEURS SONT REPOSEES QUAND ELLES CHANGENT — le test qui porte le fichier', () => {
  const h = harnais();
  h.redraw();
  assert.equal(h.applied.length, 1, 'la première image ne pose même pas les liaisons');
  h.uiDoc.values.score = 120;
  h.redraw();
  assert.equal(h.applied.length, 2,
    'un score modifié n\'atteint jamais l\'écran : le HUD est figé sur sa première image');
  assert.equal(h.applied[1].score, 120);
});

test('rien ne change : on ne réécrit pas le DOM pour rien', () => {
  // Un HUD ne change que quelques fois par seconde. Reposer trente `textContent` à 120 images/s
  // se paie, et c'est le genre de coût qu'on ne voit jamais dans un profil parce qu'il est
  // réparti sur toutes les images.
  const h = harnais();
  h.redraw();
  h.redraw();
  h.redraw();
  assert.equal(h.applied.length, 1, 'les liaisons sont reposées alors qu\'aucune valeur n\'a bougé');
});

test('une valeur qui revient à sa valeur précédente est bien reposée ensuite', () => {
  // L'empreinte doit suivre l'état, pas compter les changements : un compteur de combo qui
  // remonte à 0 puis reprend à 1 doit s'afficher les deux fois.
  const h = harnais();
  h.redraw();
  h.uiDoc.values.score = 1;
  h.redraw();
  h.uiDoc.values.score = 0;
  h.redraw();
  assert.deepEqual(h.applied.map((v) => v.score), [0, 1, 0]);
});
