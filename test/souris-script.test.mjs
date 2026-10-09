// LA SOURIS — ce que les scripts ne pouvaient pas lire.
//
// Un moteur de jeu dont les scripts n'ont accès ni à la position du pointeur ni au clic ne sait
// pas faire la moitié des jeux : viser, poser, glisser, choisir une colonne. Le navigateur a ces
// événements depuis toujours ; rien ne les exposait. Le même défaut que le reste de ce dépôt, en
// plus large — et trouvé en essayant de jouer, pas en relisant le code.
import { HELP_SCRIPTS, readHelpSource } from './help-env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');
const MOTEURS = [['éditeur', 'js/scripts.js'], ['game publié', 'js/game-runtime.js']];

test('LES TROIS INPUTS existent dans les DEUX moteurs — le test qui porte le fichier', () => {
  MOTEURS.forEach(function(m){
    const s = read(m[1]);
    ['mouse', 'click', 'clickHeld'].forEach(function(n){
      assert.ok(s.indexOf(n + ': function') >= 0 || s.indexOf(n + ':function') >= 0,
        m[0] + ' : api.' + n + ' absente');
    });
  });
});

test('LA POSITION EST NORMALISEE, pas en pixels bruts', () => {
  // Les pixels changent avec la taille de la fenêtre : un jeu réglé sur un écran viserait à côté
  // sur un autre. Le repère normalisé (-1 à +1, origine au centre) est le seul qui tienne, et
  // c'est aussi celui qu'attend un lancer de radius.
  MOTEURS.forEach(function(m){
    const s = read(m[1]);
    assert.ok(s.indexOf('mouseGame.x = (mouseGame.px / r.width) * 2 - 1;') >= 0,
      m[0] + ' : x n\'est pas normalisé');
    // Y VERS LE HAUT : l'écran count vers le bas, le monde vers le haut. Sans cette inversion,
    // viser en haut de l'écran viserait en bas du monde — et ça se cherche longtemps.
    assert.ok(s.indexOf('mouseGame.y = -((mouseGame.py / r.height) * 2 - 1);') >= 0,
      m[0] + ' : y n\'est pas inversé — l\'écran compte vers le bas, le monde vers le haut');
    // Les pixels restent disponibles : les unregister priverait qui veut poser une interface.
    assert.ok(s.indexOf('px: mouseGame.px') >= 0, m[0] + ' : les pixels ne sont plus rendus');
  });
});

test('LES COORDONNEES SONT RELATIVES A LA VUE, pas a la page', () => {
  // `clientX` est relatif à la fenêtre. Sans le rectangle de la toile, un panneau latéral ou une
  // marge décale tout le pointage — le jeu aims à côté et rien ne le dit.
  MOTEURS.forEach(function(m){
    const s = read(m[1]);
    assert.ok(s.indexOf('const r = target.getBoundingClientRect();') >= 0,
      m[0] + ' : la position n\'est pas ramenée au cadre de la vue');
    assert.ok(s.indexOf('e.clientX - r.left') >= 0 && s.indexOf('e.clientY - r.top') >= 0,
      m[0] + ' : le décalage du cadre n\'est pas retiré');
    // Une vue de taille nulle donnerait une division par zéro, donc des coordonnées infinies.
    assert.ok(s.indexOf('if(!r.width || !r.height) return;') >= 0,
      m[0] + ' : une vue de taille nulle produirait des coordonnées infinies');
  });
});

test('LE CLIC « VIENT D ETRE PRESSE » se distingue du clic MAINTENU', () => {
  // Sans cette distinction, « tirer au clic » tire soixante fois par seconde. C'est exactement le
  // piège que `api.actionPressed` évite déjà pour le clavier ; la souris doit l'éviter pareil.
  MOTEURS.forEach(function(m){
    const s = read(m[1]);
    assert.ok(s.indexOf('mouseGame.buttons.has(b) && !buttonsPrev.has(b)') >= 0,
      m[0] + ' : clicAppuye ne compare pas à l\'image précédente');
    // Et la mémoire doit être RAFRAÎCHIE, sinon la comparaison est toujours vraie.
    assert.ok(s.indexOf('buttonsPrev = new Set(mouseGame.buttons);') >= 0,
      m[0] + ' : l\'état de l\'image précédente n\'est jamais mis à jour — clicAppuye resterait vrai');
  });
});

test('LES BOUTONS SONT RELACHES quand la window perd le focus', () => {
  // Sinon un clic maintenu pendant un alt-tab reste « enfoncé » pour toujours : le jeu tire sans
  // end au retour. Même raison que `blur` sur le clavier, qui existe déjà juste au-dessus.
  MOTEURS.forEach(function(m){
    assert.ok(read(m[1]).indexOf("addEventListener('blur', function(){ mouseGame.buttons.clear(); });") >= 0,
      m[0] + ' : les boutons restent enfoncés après une perte de focus');
  });
});

test('LES TROIS INPUTS sont DOCUMENTEES — sinon personne ne sait qu elles existent', () => {
  const a = readHelpSource();
  ['mouse', 'click', 'clickHeld'].forEach(function(n){
    assert.ok(a.indexOf("{name:'" + n + "'") >= 0, 'api.' + n + ' absente du catalogue de l\'aide');
  });
});
