// UN SCRIPT DOIT POUVOIR ÉCRIRE DU TEXTE DANS L'INTERFACE DU JEU.
//
// `data-bind` faisait `el.value = valeur` quel que soit l'élément. Sur un `<div>`, cela pose une
// propriété JS et rien d'autre : aucune erreur, et rien à l'écran. Conséquence — un script ne
// pouvait afficher AUCUN texte. Pas de score, pas de niveau, pas de count à rebours ; le seul
// rendu possible était un champ de saisie, ce que personne n'écrit pour afficher un number.
//
// Encore la shape habituelle : le système d'interface existait, et aucun chemin n'y menait depuis
// un script. Ce test EXÉCUTE la liaison sur de vrais objets plutôt que de chercher un nom dans la
// source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte } from './engine-env.mjs';

const env = creerContexte(['js/game-ui.js']);

function element(balise, key, type){
  return {tagName: balise, type: type, dataset: {bind: key},
          textContent: '', value: '', checked: false};
}
function lier(elements, values){
  env._applyValuesBind({querySelectorAll: function(){ return elements; }}, values);
  return elements;
}

test('un élément qui n est pas un champ reçoit le TEXTE', () => {
  const [div, span] = lier([element('DIV', 'level'), element('SPAN', 'restants')],
                           {level: 2, restants: 5});
  assert.equal(div.textContent, '2', 'le <div> n shown rien — un script ne peut pas parler au joueur');
  assert.equal(span.textContent, '5');
  // et surtout pas dans `value`, qui n a aucun effet visible sur un <div>
  assert.equal(div.value, '', 'la valeur est partie dans `value`, où elle reste invisible');
});

test('un champ de saisie reçoit toujours sa VALEUR, pas du texte', () => {
  const [input, list, zone] = lier(
    [element('INPUT', 'name', 'text'), element('SELECT', 'choice'), element('TEXTAREA', 'note')],
    {name: 'Zoé', choice: 'b', note: 'deux lignes'});
  assert.equal(input.value, 'Zoé');
  assert.equal(input.textContent, '', 'écrire le texte d un champ le rendrait non modifiable');
  assert.equal(list.value, 'b');
  assert.equal(zone.value, 'deux lignes');
  assert.equal(zone.textContent, '');
});

test('une case à cocher reste une case à cocher', () => {
  const [c] = lier([element('INPUT', 'active', 'checkbox')], {active: true});
  assert.equal(c.checked, true);
  assert.equal(c.textContent, '', 'une case cochée ne doit pas se remplir de « true »');
});

test('une clé absente ne touche à rien', () => {
  const [div] = lier([element('DIV', 'inconnue')], {autre: 3});
  assert.equal(div.textContent, '',
    'un élément lié à une clé jamais écrite se remplirait de « undefined »');
});

test('le zéro et la chaîne vide s affichent quand même', () => {
  // `if(!values[key]) return` serait le raccourci naturel, et il effacerait un score de 0.
  const [a, b] = lier([element('DIV', 'score'), element('DIV', 'msg')], {score: 0, msg: ''});
  assert.equal(a.textContent, '0', 'un score de 0 doit s afficher, pas disparaître');
  assert.equal(b.textContent, '');
});


// ---------------------------------------------------------------------------
// LA CLASSE EST LIABLE, PAS SEULEMENT LE TEXTE.
//
// `data-bind` ne sait écrire que du texte ou une valeur de champ, et une feuille de style ne
// peut pas réagir à du texte. Tout ce qui fait le nerf d'un HUD de jeu — un voile rouge quand on
// prend un coup, une vie qui pulse sous 30 %, un palier de combo qui change de couleur, un
// réticule qui claque sur un impact — était donc hors de portée d'un script, alors que le CSS de
// l'asset le décrit en trois lignes. Encore la forme habituelle : le système existe, et aucun
// chemin n'y menait.
function elementClasse(key, classeBase){
  return {tagName: 'DIV', dataset: {bindClass: key}, className: classeBase || '',
          textContent: '', value: ''};
}

test('une classe liée arrive sur l element', () => {
  const [el] = lier([elementClasse('etatVie')], {etatVie: 'critique'});
  assert.equal(el.className, 'critique');
});

test('la classe écrite dans le HTML est CONSERVEE', () => {
  // Sans ça, lier une classe effacerait la mise en page de l'élément : on gagne le voile rouge
  // et on perd la barre de vie.
  const [el] = lier([elementClasse('etatVie', 'bar life')], {etatVie: 'critique'});
  assert.equal(el.className, 'bar life critique');
  // et une valeur vide RETIRE la classe liée sans emporter la base
  lier([el], {etatVie: ''});
  assert.equal(el.className, 'bar life');
});

test('un même élément peut porter les deux liaisons', () => {
  // Le tri se fait sur les ATTRIBUTS présents, pas sur le sélecteur qui a ramené l'élément :
  // un compteur de combo affiche « x7 » ET prend la couleur de son palier.
  const el = {tagName: 'DIV', dataset: {bind: 'combo', bindClass: 'paliercombo'},
              className: 'combo', textContent: '', value: ''};
  lier([el], {combo: 'x7', paliercombo: 'tier3'});
  assert.equal(el.textContent, 'x7');
  assert.equal(el.className, 'combo tier3');
});

test('une clé de classe jamais écrite ne touche à rien', () => {
  const [el] = lier([elementClasse('inconnue', 'bar')], {autre: 1});
  assert.equal(el.className, 'bar');
});
