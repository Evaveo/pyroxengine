// moteur/test/api-cache.test.mjs
//
// L'OBJET `api` EST MAINTENANT RÉUTILISÉ D'UNE IMAGE À L'AUTRE. Ce fichier tient l'invariant que
// ça crée.
//
// Avant, `apiFor(o, dt, i)` reconstruisait un littéral de cinquante-sept (éditeur) et
// soixante-douze (jeu publié) clés à CHAQUE APPEL — une fois par script actif et par image, soit
// des centaines de milliers de fermetures par seconde jetées aussitôt
// (docs/REVUE_2026-09-10.md § 2.2). Il est désormais construit une fois par (objet, script) et
// mis à jour en place.
//
// Le risque que ça déplace est précis et MUET : un champ qui change d'une image à l'autre mais
// qu'on oublie de réécrire reste figé à sa valeur de construction. Un `api.dt` gelé, c'est un
// personnage qui avance à vitesse constante quoi qu'il arrive ; un `api.time` gelé, c'est un
// compte à rebours qui ne descend jamais. Rien ne lève, rien ne se voit dans la console.
//
// D'où les deux mesures ci-dessous : la liste des champs de DONNÉES du littéral est CLOSE (en
// ajouter un fait échouer le test, ce qui force à décider s'il doit être rafraîchi), et chacun
// de ceux qui doivent l'être est bien réécrit par `apiFor`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');

/** Le littéral d'api d'un fichier, et le corps de son `apiFor`. */
function morceaux(file){
  const src = read(file);
  const iBuild = src.indexOf('function buildApi(o, i, frame){');
  assert.notEqual(iBuild, -1,
    file + ' : `buildApi(o, i, frame)` a disparu. Si le littéral est reparti dans `apiFor`, il se '
    + 'reconstruit à chaque image et tout ce fichier ne mesure plus rien.');
  const iLit = src.indexOf('return ({', iBuild);
  const finLit = src.indexOf('\n  });', iLit);
  assert.notEqual(finLit, -1, file + ' : fin du littéral d\'api introuvable');

  const iApiFor = src.indexOf('function apiFor(o, dt, i){');
  assert.notEqual(iApiFor, -1, file + ' : `apiFor(o, dt, i)` a disparu');
  // `apiFor` s'arrête où `buildApi` commence : les deux sont voisines, dans cet ordre.
  assert.ok(iApiFor < iBuild, file + ' : `apiFor` doit précéder `buildApi`');

  return { litteral: src.slice(iLit, finLit), apiFor: src.slice(iApiFor, iBuild), source: src };
}

/**
 * Les clés de DONNÉES du littéral : celles dont la valeur n'est pas une fonction.
 *
 * Ce sont les seules qui peuvent se figer. Une fermeture, elle, relit son environnement à
 * chaque appel — sauf si elle a capturé `dt` par valeur, ce que le dernier test interdit.
 */
function clesDonnees(litteral){
  const keys = [];
  litteral.split('\n').forEach((line) => {
    if(/^\s*(\/\/|\*)/.test(line)) return;
    // ANCRÉ À QUATRE ESPACES, et c'est indispensable : sans cette ancre, les lignes de
    // continuation d'une fermeture (`px: mouseGame.px, py: …`, à l'intérieur d'un objet rendu
    // par `api.mouse`) passaient pour des entrées de l'api. Le test réclamait alors une décision
    // de rafraîchissement sur des clés qui n'appartiennent pas au littéral.
    const m = line.match(/^ {4}([A-Za-z_$][\w$]*)\s*:\s*(.*)$/);
    if(!m) return;
    const valeur = m[2].trim();
    if(/^(function|\(|async)/.test(valeur)) return;   // une fermeture
    keys.push(m[1]);
    // Les lignes MULTI-CLÉS du runtime (`me:o, node:o, dt:0, …`) : on ne déplie que celles qui
    // n'ouvrent ni fonction ni objet.
    if(/[{(]/.test(line)) return;
    line.trim().split(',').slice(1).forEach((part) => {
      const p = part.match(/^\s*([A-Za-z_$][\w$]*)\s*:/);
      if(p) keys.push(p[1]);
    });
  });
  return keys;
}

// Les champs de données attendus, et pour chacun : doit-il être réécrit à chaque image ?
//
// `false` = constant pour un couple (objet, script) donné, donc sa valeur de construction est
// la bonne pour toujours. Chaque `false` est une affirmation à justifier, pas un défaut.
const DONNEES = {
  'js/scripts.js': {
    me: false,          // l'objet porteur ne change pas
    node: false,        // alias de `me`
    dt: true,
    dtReal: true,
    time: true,
    scene: true,        // un changement de scène remplace l'objet three
    expose: true,       // les variables @expose sont réglables pendant la partie
    findByTag: false,   // un alias de fonction
    byTag: false,
    network: false,     // `networkHandle()` rend un singleton mémoïsé (js/network-game.js)
    isAuthority: false, // une référence de fonction
    xr: false           // XRRuntime.api : un singleton dont les méthodes lisent l'état courant
  },
  'js/game-runtime.js': {
    expose: true,
    me: false,
    node: false,
    dt: true,
    dtReal: true,
    time: true,
    scene: true,
    byTag: false,
    findByTag: false,
    action: false,      // référence de fonction (actionActive)
    status: false,      // référence de fonction (hud)
    xr: false           // XRRuntime.api : un singleton dont les méthodes lisent l'état courant
  }
};

for(const file of Object.keys(DONNEES)){
  test('LA LISTE DES CHAMPS DE DONNEES de l api est close — ' + file, () => {
    const lues = clesDonnees(morceaux(file).litteral);
    const attendues = Object.keys(DONNEES[file]);
    const nouvelles = lues.filter((k) => !(k in DONNEES[file]));
    assert.deepEqual(nouvelles, [],
      'Un champ de DONNEES a ete ajoute au littéral d\'api sans decision sur son rafraichissement.\n'
      + 'L\'objet api est reutilise d\'une image a l\'autre : un champ qui change et qu\'`apiFor` ne\n'
      + 'reecrit pas reste FIGE a sa valeur de construction, sans aucun message. Ajoutez-le a la\n'
      + 'table DONNEES de ce fichier avec `true` (a rafraichir) ou `false` (constant, et dites\n'
      + 'pourquoi) : ' + nouvelles.join(', '));

    const disparues = attendues.filter((k) => lues.indexOf(k) === -1);
    assert.deepEqual(disparues, [],
      'ces champs ont disparu du littéral : la table DONNEES de ce test est perimee — '
      + disparues.join(', '));
  });

  test('CHAQUE champ qui change est bien reecrit par apiFor — ' + file, () => {
    const { apiFor } = morceaux(file);
    const oublies = Object.keys(DONNEES[file])
      .filter((k) => DONNEES[file][k])
      .filter((k) => !new RegExp('api\\.' + k + '\\s*=').test(apiFor));
    assert.deepEqual(oublies, [],
      'Ces champs changent d\'une image a l\'autre et `apiFor` ne les reecrit PAS. Ils resteront\n'
      + 'figes a leur valeur de construction : un `api.dt` gele donne un personnage a vitesse\n'
      + 'constante, un `api.time` gele un compte a rebours qui ne descend jamais. Aucun message.\n'
      + oublies.join(', '));
  });
}

test('AUCUNE fermeture de l api ne capture `dt` par valeur', () => {
  // C'est l'autre moitie du piege, et la plus discrete : une fermeture construite UNE FOIS qui
  // aurait capture le `dt` de sa construction verrait pour toujours la premiere image. Les deux
  // qui en ont besoin (`moveTo`, `patrol`) lisent donc `frame.dt`, ecrit par `apiFor`.
  const fautes = [];
  for(const file of ['js/scripts.js', 'js/game-runtime.js']){
    const { litteral } = morceaux(file);
    litteral.split('\n').forEach((line, i) => {
      if(/^\s*(\/\/|\*)/.test(line)) return;
      // Un `dt` NU dans le littéral. On retire d'abord ce qui est légitime : la lecture
      // `frame.dt`, la clé `dt:` avec sa valeur initiale (y compris sur une ligne multi-clés),
      // et le nom `dtReal` qui contient `dt`.
      const propre = line
        .replace(/frame\.dt/g, '')
        .replace(/\bdtReal\b/g, '')
        .replace(/\bdt\s*:\s*0/g, '');
      if(/\bdt\b/.test(propre)){
        fautes.push(file + ' (litteral, ligne relative ' + (i + 1) + ') ' + line.trim().slice(0, 90));
      }
    });
  }
  assert.deepEqual(fautes, [],
    'Le littéral d\'api est construit UNE FOIS par (objet, script) : `dt` n\'y existe plus comme\n'
    + 'variable. Une fermeture qui le lit capture la valeur de la PREMIERE image et la garde pour\n'
    + 'toujours. Passez par `frame.dt`, que `apiFor` met a jour.\n' + fautes.join('\n'));
});

test('LE CACHE est bien par (objet, script), et ne retient pas un objet detruit', () => {
  for(const file of ['js/scripts.js', 'js/game-runtime.js']){
    const src = read(file);
    assert.match(src, /const _apiCache = new WeakMap\(\);/,
      file + ' : le cache d\'api doit etre une WeakMap — une Map retiendrait pour toujours chaque '
      + 'objet detruit pendant la partie, et le moteur en cree en continu');
    assert.match(morceaux(file).apiFor, /parIndex\.get\(i\)/,
      file + ' : le cache doit etre indexe par le NUMERO de script. Un objet porte plusieurs '
      + 'scripts, et ils ont chacun leur `expose` : un cache par objet seul les melangerait');
  }
});
