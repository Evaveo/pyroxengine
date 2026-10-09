// LA VUE À LA PREMIÈRE PERSONNE — ce que la souris ne savait pas encore faire.
//
// `api.mouse()` rend une position, et une position ne suffit pas à tourner une tête. Deux
// raisons, toutes deux mesurées en écrivant un FPS (jeux/NeonBreach) :
//   · sans capture du pointeur, la souris bute sur le bord de la fenêtre au bout d'un quart de
//     tour, et la vue se bloque net ;
//   · sous capture, la position ne bouge PLUS DU TOUT — le curseur est retiré de l'écran. Un
//     script qui lit `api.mouse()` sous capture lit une constante.
//
// C'est la même forme de manque que la souris elle-même avant la v0.68.0 : le navigateur a
// `movementX`/`movementY` et l'API de capture depuis toujours, et rien n'y menait depuis un
// script. Ce fichier mesure les trois entrées, DANS LES DEUX MOTEURS — l'api de script existe
// deux fois (voir test/miroir-api-script.test.mjs), et une entrée présente d'un seul côté est la
// divergence qui ne se voit qu'après publication.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');
const ENGINES = [['éditeur', 'js/scripts.js'], ['jeu publié', 'js/game-runtime.js']];

test('LES TROIS ENTREES existent dans les DEUX moteurs — le test qui porte le fichier', () => {
  ENGINES.forEach(function(m){
    const s = read(m[1]);
    ['mouseDelta', 'lockMouse', 'mouseLocked'].forEach(function(n){
      assert.ok(s.indexOf(n + ': function') >= 0 || s.indexOf(n + ':function') >= 0,
        m[0] + ' : api.' + n + ' absente');
    });
  });
});

test('LE DEPLACEMENT EST CUMULE sur l image, jamais remplace', () => {
  // Plusieurs `pointermove` arrivent entre deux rendus. Ne garder que le dernier jetterait la
  // moitié du mouvement dès que l'image tombe à 30/s : la visée deviendrait plus lente quand le
  // jeu rame, exactement l'inverse de ce qu'on veut. `=` au lieu de `+=` est l'écriture
  // naturelle, et le défaut ne se voit qu'à la manette d'un jeu qui ralentit.
  ENGINES.forEach(function(m){
    const s = read(m[1]);
    assert.ok(s.indexOf('mouseLook.dx += e.movementX || 0;') >= 0,
      m[0] + ' : le déplacement horizontal n\'est pas cumulé');
    assert.ok(s.indexOf('mouseLook.dy += e.movementY || 0;') >= 0,
      m[0] + ' : le déplacement vertical n\'est pas cumulé');
  });
});

test('LE DEPLACEMENT EST REMIS A ZERO a la end de chaque image', () => {
  // Sans cette remise à zéro, un script qui ne lit pas mouseDelta à une image (pause, menu,
  // changement de scène) verrait le mouvement de deux images arriver d'un coup à la suivante :
  // un sursaut de visée après chaque interruption.
  ENGINES.forEach(function(m){
    const s = read(m[1]);
    assert.ok(s.indexOf('mouseLook.dx = 0; mouseLook.dy = 0;') >= 0,
      m[0] + ' : les deltas ne sont jamais consommés');
    // et au MÊME endroit que les boutons, la seule remise à zéro par image qui existait déjà :
    // deux endroits différents finiraient par ne plus être appelés tous les deux.
    const iBoutons = s.indexOf('buttonsPrev = new Set(mouseGame.buttons);');
    const iDeltas = s.indexOf('mouseLook.dx = 0; mouseLook.dy = 0;');
    assert.ok(iBoutons >= 0 && iDeltas > iBoutons && (iDeltas - iBoutons) < 500,
      m[0] + ' : la remise à zéro des deltas n\'est pas dans la end d\'image des entrées');
  });
});

test('LA CAPTURE EST DEMANDEE DANS UN GESTE UTILISATEUR, pas depuis la boucle', () => {
  // `requestPointerLock()` appelé depuis la boucle de rendu est refusé par le navigateur, et
  // refusé SANS BRUIT : une promesse rejetée que personne ne lit. Le script pose une intention,
  // c'est le clic qui la réalise. Sans ça, `api.lockMouse(true)` ne ferait jamais rien et rien
  // ne le dirait — le pire des symptômes.
  ENGINES.forEach(function(m){
    const s = read(m[1]);
    const iDown = s.indexOf("addEventListener('pointerdown', function(){");
    assert.ok(iDown >= 0, m[0] + ' : aucun geste n\'obtient la capture');
    const geste = s.slice(iDown, iDown + 400);
    assert.ok(geste.indexOf('requestPointerLock') >= 0,
      m[0] + ' : le clic ne demande pas la capture');
    assert.ok(geste.indexOf('mouseLook.wanted') >= 0,
      m[0] + ' : le clic capture la souris SANS que le jeu l\'ait demandé');
    // Et l'intention seule ne suffit pas à la reprendre en boucle : on ne redemande pas une
    // capture déjà tenue.
    assert.ok(geste.indexOf('pointerLockedGame()') >= 0,
      m[0] + ' : la capture est redemandée à chaque clic, déjà tenue ou non');
  });
});

test('LA CAPTURE EST COMPAREE A LA TOILE DU JEU, pas testee en booleen', () => {
  // `document.pointerLockElement` est vrai dès que N'IMPORTE QUEL élément de la page tient la
  // souris. Un `!!` seul ferait lire « le jeu tient la souris » alors qu'un autre canvas la tient
  // — et le jeu tournerait la vue sans la moindre entrée.
  ENGINES.forEach(function(m){
    const s = read(m[1]);
    assert.ok(s.indexOf('document.pointerLockElement === canvasGame()') >= 0,
      m[0] + ' : la capture n\'est pas comparée à la toile du jeu');
  });
});

test('lockMouse(false) RELACHE vraiment la souris', () => {
  // Un menu, une fin de partie, une pause : sans relâchement, le joueur reste prisonnier de la
  // vue et ne peut plus cliquer un bouton de l'interface.
  ENGINES.forEach(function(m){
    const s = read(m[1]);
    assert.ok(s.indexOf('document.exitPointerLock') >= 0,
      m[0] + ' : rien ne relâche jamais la souris');
  });
});
