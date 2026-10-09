// « AVANCER » DOIT ALLER LÀ OÙ LE JOUEUR REGARDE.
//
// `characterUpdate` ne savait déplacer un personnage que le long de X et de Z du MONDE. Parfait
// pour une plateforme vue de côté, inutilisable dès que la caméra tourne : en vue à la première
// personne, « avancer » emmenait vers -Z quel que soit l'endroit où le joueur regardait. Le
// contrôleur partagé du moteur était donc réservé à un seul genre de jeu, sans que rien ne le
// dise — et un FPS écrit par-dessus se pilote à l'envers une fois sur deux.
//
// Le repère est celui des nœuds du moteur, dont l'AVANT est +Z (`makeCamera`, js/objects.js) :
// avant = (sin cap, 0, cos cap), droite = (cos cap, 0, -sin cap).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { creerContexte } from './engine-env.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const env = creerContexte(['js/game-character.js']);

// Un api de script minimal : ce que characterUpdate lit, et rien d'autre. C'est exactement ce
// que promet l'en-tête de js/game-character.js — « il ne touche à rien de global ».
function faireApi(entrees){
  const me = {position: {x: 0, y: 5, z: 0,
    set(x, y, z){ this.x = x; this.y = y; this.z = z; }}};
  return {
    me: me,
    dt: 0.05,   // dtMax du contrôleur : au-delà, il borne, et le test mesurerait autre chose
    axis: (n) => (entrees[n] || 0),
    actionPressed: () => !!entrees.jump,
    bounds: () => ({size: {x: 1, y: 2, z: 1}}),
    // Aucun sol : on ne mesure ici que le déplacement horizontal.
    raycast: () => null
  };
}

function pas(entrees, options){
  const api = faireApi(entrees);
  env.characterUpdate(api, {}, options);
  return api.me.position;
}

const PROCHE = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9,
  msg + ' — attendu ' + b + ', obtenu ' + a);

test('SANS CAP, le comportement des jeux deja ecrits ne change pas', () => {
  // La compatibilité est le premier test : ce contrôleur porte déjà des jeux.
  const p = pas({vertical: 1}, {speed: 20, gravity: 0});
  PROCHE(p.x, 0, 'x a bougé alors qu\'on avance en axes du monde');
  PROCHE(p.z, -1, 'avancer en axes du monde va vers -Z');
});

test('CAP A ZERO : avancer va vers +Z, le sens de l avant d un noeud', () => {
  const p = pas({vertical: 1}, {speed: 20, gravity: 0, yaw: 0});
  PROCHE(p.x, 0, 'x a bougé alors que le cap est nul');
  PROCHE(p.z, 1, 'avancer cap nul doit aller vers +Z');
});

test('UN QUART DE TOUR : avancer va vers +X', () => {
  const p = pas({vertical: 1}, {speed: 20, gravity: 0, yaw: Math.PI / 2});
  PROCHE(p.x, 1, 'un quart de tour à gauche doit envoyer « avancer » vers +X');
  PROCHE(p.z, 0, 'z a bougé alors qu\'on regarde vers +X');
});

test('LE PAS DE COTE VA VERS LA DROITE DE L ECRAN, mesuree contre three', () => {
  // CE TEST A DÉJÀ MENTI. Sa première version affirmait que la droite d'un cap d'un quart de tour
  // est −Z : c'était la même déduction fausse que celle du code, donc il passait en vert sur un
  // pas de côté inversé. Un test écrit d'après le raisonnement qu'il doit contrôler ne contrôle
  // rien.
  //
  // Ce qu'il faut mesurer et non déduire : le composant Camera tourne la caméra three d'un
  // demi-tour autour de Y pour qu'elle regarde le +Z de son boîtier, et ce demi-tour retourne
  // aussi son axe X. La droite de l'écran est donc le −X du nœud. Trois valeurs, prises sur la
  // colonne X de la matrice monde de la caméra :
  //   cap 0   → regard (0,0,1)  droite (−1, 0, 0)
  //   cap π/2 → regard (1,0,0)  droite ( 0, 0, 1)
  //   cap π   → regard (0,0,−1) droite ( 1, 0, 0)
  const DROITE = [
    [0,           {x: -1, z: 0}],
    [Math.PI / 2, {x: 0,  z: 1}],
    [Math.PI,     {x: 1,  z: 0}]
  ];
  DROITE.forEach(([yaw, attendu]) => {
    const p = pas({horizontal: 1}, {speed: 20, gravity: 0, yaw: yaw});
    PROCHE(p.x, attendu.x, 'cap ' + yaw.toFixed(3) + ' : x du pas de côté');
    PROCHE(p.z, attendu.z, 'cap ' + yaw.toFixed(3) + ' : z du pas de côté');
  });
});

test('LA DROITE DE L ECRAN EST BIEN CELLE QUE THREE CALCULE — la mesure elle-meme', async () => {
  // Le test ci-dessus porte trois valeurs écrites à la main. Celui-ci les redérive du montage
  // réel — nœud du joueur, nœud de caméra, caméra three tournée d'un demi-tour — pour que la
  // table cesse d'être une affirmation. Si three changeait de convention, ou si le composant
  // Camera cessait de tourner sa caméra, c'est ici qu'on l'apprendrait.
  const vm = await import('node:vm');
  const { readFileSync } = await import('node:fs');
  const bac = {console};
  bac.window = bac; bac.self = bac; bac.globalThis = bac;
  bac.document = {createElementNS: () => ({}), addEventListener(){},
                  createElement: () => ({style: {}, getContext: () => null})};
  vm.runInNewContext(readFileSync(path.join(root, 'vendor', 'three.min.js'), 'utf8'), bac);
  const T = bac.THREE;

  [0, Math.PI / 2, Math.PI, -1.1].forEach((yaw) => {
    const joueur = new T.Object3D();
    joueur.rotation.set(0, yaw, 0);
    const noeudCam = new T.Object3D();
    joueur.add(noeudCam);
    // Le demi-tour posé par Camera.applyProjection (js/components/component-camera.js).
    const cam = new T.PerspectiveCamera();
    cam.rotation.y = Math.PI;
    noeudCam.add(cam);
    joueur.updateMatrixWorld(true);
    const e = cam.matrixWorld.elements;
    const droite = {x: e[0], z: e[2]};

    const p = pas({horizontal: 1}, {speed: 20, gravity: 0, yaw: yaw});
    PROCHE(p.x, droite.x, 'cap ' + yaw.toFixed(3) + ' : x ne suit pas la droite de la caméra');
    PROCHE(p.z, droite.z, 'cap ' + yaw.toFixed(3) + ' : z ne suit pas la droite de la caméra');
  });
});

test('LA DIAGONALE NE VA PAS PLUS VITE que la ligne droite', () => {
  // Le défaut de jeunesse de tous les FPS des années 90 : 41 % de vitesse en plus en biais. Il
  // se remarque au premier essai et personne ne le tolère.
  const droit = pas({vertical: 1}, {speed: 20, gravity: 0, yaw: 0});
  const biais = pas({vertical: 1, horizontal: 1}, {speed: 20, gravity: 0, yaw: 0});
  const dDroit = Math.hypot(droit.x, droit.z);
  const dBiais = Math.hypot(biais.x, biais.z);
  PROCHE(dBiais, dDroit, 'la diagonale parcourt une autre distance que la ligne droite');
});

test('LA NORMALISATION NE RALENTIT PAS une entree unique deja plus courte', () => {
  // Diviser sans garde par la longueur ferait d'une entrée analogique à moitié enfoncée une
  // course à pleine vitesse — l'inverse du dosage voulu. On ne borne QUE ce qui dépasse 1.
  const api = faireApi({});
  api.axis = (n) => (n === 'vertical' ? 0.5 : 0);
  env.characterUpdate(api, {}, {speed: 20, gravity: 0, yaw: 0});
  PROCHE(api.me.position.z, 0.5, 'une entrée à moitié enfoncée doit avancer de moitié');
});
