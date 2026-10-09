import { deEsm } from './engine-env.mjs';
// Le monde 2D : de la scène au solveur.
//
// Le test qui porte ce fichier est celui du CONTRÔLEUR. Il a été livré mort : `world-2d.js`
// cherchait `actionActive` dans le global, or `js/game-runtime.js` est enveloppé dans une IIFE —
// il se termine par `})();` — et rien de ce qu'il déclare n'est global. Le
// `typeof actionActive === 'function'` rendait donc toujours faux DANS UN JEU EXPORTÉ : le
// personnage ne bougeait pas, sans une erreur, sans une trace, et le composant passait tous les
// tests existants parce qu'aucun ne lui donnait de cles à lire.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');

function contexte(){
  const bac = {console, Math, JSON, Set, Map, Array, Object, Number, isFinite};
  bac.window = bac; bac.self = bac; bac.globalThis = bac;
  const ctx = vm.createContext(bac);
  vm.runInContext(deEsm(read('js/physics-2d.js')), ctx, {filename: 'js/physics-2d.js'});
  vm.runInContext(deEsm(read('js/world-2d.js')), ctx, {filename: 'js/world-2d.js'});
  return ctx;
}

/** Un personnage posé sur un sol, avec ses trois composants — comme l'éditeur les écrit. */
function scene(){
  const ground = {position: {x: 0, y: -0.5}, userData: {
    body2d: {statique: true},
    collider2d: {shape: 'box', l: 40, h: 1, dx: 0, dy: 0}}};
  const perso = {position: {x: 0, y: 0.45}, userData: {
    body2d: {statique: false, withoutGravity: false, speedMax: 40},
    collider2d: {shape: 'box', l: 0.6, h: 0.9, dx: 0, dy: 0},
    controller2d: {speed: 6, heightJump: 2, coyote: 0.1, memoireJump: 0.15,
                   actionLeft: 'left', actionRight: 'right', actionJump: 'jump'}}};
  return {ground, perso, list: [ground, perso]};
}

test('LE CONTROLEUR BOUGE quand on lui donne de quoi lire les cles', () => {
  const ctx = contexte();
  const s = scene();
  const DT = 1 / 60;
  // Une lecture de cles EXPLICITE, passée en argument. C'est tout le correctif : la
  // dépendance ne se cherche plus dans le global, elle se donne — et se voit donc quand elle
  // manque.
  const keys = {left: false, right: false, jump: false};
  const readAction = (name) => !!keys[name];

  for(let i = 0; i < 20; i++) ctx.stepWorld2d(s.list, DT, -25, readAction);
  assert.ok(Math.abs(s.perso.userData.body2d._vx) < 1e-9, 'au repos il ne doit pas deriver');

  keys.right = true;
  const xAvant = s.perso.position.x;
  for(let i = 0; i < 30; i++) ctx.stepWorld2d(s.list, DT, -25, readAction);
  assert.ok(s.perso.userData.body2d._vx > 5, 'vx = ' + s.perso.userData.body2d._vx + ', 6 attendu');
  assert.ok(s.perso.position.x - xAvant > 2, 'il a parcouru ' + (s.perso.position.x - xAvant));

  keys.right = false;
  keys.jump = true;
  for(let i = 0; i < 3; i++) ctx.stepWorld2d(s.list, DT, -25, readAction);
  assert.ok(s.perso.userData.body2d._vy > 5, 'le saut doit partir : vy = ' + s.perso.userData.body2d._vy);
});

test('SANS LECTEUR le controleur ne fait rien — et c est un argument absent, pas un global missing', () => {
  const ctx = contexte();
  const s = scene();
  const DT = 1 / 60;
  // Voulu : dans l'éditeur hors mode game, un personnage qui marcherait tout seul serait
  // impossible à placer. Ce qui change, c'est qu'on peut le VOIR — un argument qu'on ne passe
  // pas se lit à l'appel, un global qui n'existe pas ne se lit nulle part.
  for(let i = 0; i < 30; i++) ctx.stepWorld2d(s.list, DT, -25);
  assert.equal(s.perso.userData.body2d._vx, 0);
  assert.ok(Math.abs(s.perso.position.x) < 1e-9, 'il ne doit pas avoir bouge en x');
  // Mais la GRAVITÉ, elle, s'applique : sans lecteur le personnage reste un corps physique.
  assert.ok(s.perso.userData.body2d._AtGround === true, 'il doit quand meme se poser sur le sol');
});

test('LE MONDE RASSEMBLE body et obstacles depuis les composants de la scene', () => {
  const ctx = contexte();
  const s = scene();
  const m = ctx.gatherWorld2d(s.list);
  assert.equal(m.body.length, 1, 'un seul body mobile');
  assert.equal(m.obstacles.length, 1, 'un seul obstacle');
  // Les DEMI-tailles, parce que c'est ce que le solveur utilise. Un facteur deux ici passerait
  // inaperçu jusqu'à ce qu'un personnage traverse un mur sur sa moitié.
  assert.ok(Math.abs(m.body[0].dl - 0.3) < 1e-9, 'demi-width = ' + m.body[0].dl);
  assert.ok(Math.abs(m.body[0].dh - 0.45) < 1e-9, 'demi-height = ' + m.body[0].dh);
  assert.equal(m.obstacles[0].statique, true);
});

test('AUCUN MODULE PARTAGE ne cherche `actionActive` dans le global', () => {
  // La garde qui empêche la rechute. `js/game-runtime.js` est enveloppé dans une IIFE : tout
  // module partagé qui compte sur un de ses symboles est mort dans un jeu exporté, en silence.
  // Le seul endroit légitime pour lire les cles est un ARGUMENT, ou `api.action(...)` dans un
  // script — qui, lui, est fourni par le runtime au moment de l'appel.
  const shared = ['js/world-2d.js', 'js/anim-sprite.js', 'js/physics-2d.js',
                    'js/sprite-2d.js', 'js/tilemap.js'];
  const fautifs = [];
  for(const f of shared){
    const code = read(f).replace(/\r\n/g, '\n')
      // les commentaires ont le droit d'en parler — c'est même là qu'on explique pourquoi
      .split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
    if(code.indexOf('actionActive') !== -1) fautifs.push(f);
  }
  assert.deepEqual(fautifs, [],
    'Ces modules partagés lisent `actionActive`, qui n\'existe PAS dans un jeu exporté :\n'
    + 'js/game-runtime.js est enveloppé dans une IIFE. Passez la lecture des cles en argument.\n'
    + fautifs.join('\n'));
});
