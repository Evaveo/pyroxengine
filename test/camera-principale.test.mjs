// moteur/test/camera-principale.test.mjs
//
// UN SEUL STOCKAGE POUR « CAMÉRA PRINCIPALE ».
//
// Le drapeau vivait à DEUX endroits qui ne se parlaient pas : le composant `Camera` exposait
// `main` (accesseur sur `data.main`, le seul champ que le fichier de scène transporte dans
// `components[]`), pendant que l'inspecteur écrivait `userData.game.main` et que le runtime ne
// lisait que ce dernier. Cocher la case ne changeait donc rien au fichier, et régler `main` par
// le composant ou par un script n'avait aucun effet sur la caméra choisie au lancement.
//
// Le défaut était INVISIBLE tant qu'une scène n'avait qu'une caméra — le repli « première
// caméra venue » rendait le bon résultat pour la mauvaise raison. Il apparaissait d'un coup,
// sans message, dès la deuxième : le jeu filmait depuis la mauvaise. Mesuré sur jeux/Chromelo,
// dont les cinq scènes portaient `main: false` sur leur unique caméra.
//
// Ces tests tiennent la règle : `isCameraMain` est le seul juge, le composant est la source, et
// l'ancien emplacement n'est plus que lu (pour les projets d'avant), jamais écrit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte } from './engine-env.mjs';

const env = creerContexte(['js/camera-framing.js']);
const { cameraSettingOf, isCameraMain, setCameraMain } = env;

// Un nœud minimal : juste ce que lisent `cameraSettingOf` et `isCameraMain`.
function camera(opts){
  const data = Object.assign({projection: 'perspective'}, opts || {});
  return {
    userData: {type: 'camera', game: {tag: '', layer: 'Défaut'}},
    getComponent: function(type){ return type === 'Camera' ? data : null; }
  };
}

test('le composant est la source : Camera.main suffit', () => {
  const c = camera({main: true});
  assert.equal(isCameraMain(c), true);
  assert.equal(isCameraMain(camera({main: false})), false);
  assert.equal(isCameraMain(camera({})), false);
});

test('l\'ancien userData.game.main reste LU, pour les projets enregistrés avant', () => {
  // Sans ce repli, tout projet d'avant la correction perdrait sa caméra principale entre le
  // moment où il est ouvert et celui où la migration l'a remontée sur le composant.
  const c = camera({});
  c.userData.game.main = true;
  assert.equal(isCameraMain(c), true);
});

test('désigner une principale écrit sur le COMPOSANT et décoche les autres', () => {
  const a = camera({main: true}), b = camera({}), c = camera({});
  setCameraMain(b, [a, b, c]);
  assert.equal(cameraSettingOf(b).main, true, 'la nouvelle principale porte le drapeau');
  assert.equal(cameraSettingOf(a).main, false, 'l\'ancienne principale est décochée');
  assert.equal(cameraSettingOf(c).main, false);
  // exactement une, jamais deux : deux principales laisseraient le moteur choisir par l'ordre
  // des objets dans le fichier.
  assert.equal([a, b, c].filter(isCameraMain).length, 1);
});

test('désigner une principale NETTOIE l\'ancien emplacement', () => {
  // Deux réponses qui survivent côte à côte finissent par diverger : c'est très exactement le
  // défaut qu'on est en train de fermer. `setCameraMain` ne laisse qu'une trace.
  const a = camera({}), b = camera({});
  a.userData.game.main = true;
  setCameraMain(b, [a, b]);
  assert.equal(a.userData.game.main, undefined);
  assert.equal(b.userData.game.main, undefined);
  assert.equal(isCameraMain(a), false);
  assert.equal(isCameraMain(b), true);
});

test('cameraMain2d choisit la principale, pas la première venue', () => {
  // La régression grandeur nature : deux caméras, la principale n'est pas la première du
  // tableau. Avant la correction, `cams[0]` gagnait et le jeu filmait depuis la mauvaise.
  const first = camera({projection: 'orthographic'});
  const wanted = camera({projection: 'orthographic', main: true});
  assert.equal(env.cameraMain2d([first, wanted]), wanted);
});

test('sans aucune principale, cameraMain2d retombe sur la première — et le dit', () => {
  const first = camera({projection: 'orthographic'});
  const second = camera({projection: 'orthographic'});
  assert.equal(env.cameraMain2d([first, second]), first);
  assert.equal(env.cameraMain2d([]), null);
});
