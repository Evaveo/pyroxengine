// LE JEU SUR TÉLÉPHONE (v1.5.0) : résolution adaptative, interface mise à l'échelle,
// joystick qui presse des directions. Trois fonctions pures, partagées éditeur/jeu publié.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pixelRatioCap, createRenderScaler, renderSetupFor } from '../js/render-scale.js';
import { joystickDirections, normalizeTouchControls, autoTouchConfig } from '../js/touch-input.js';
import { creerContexte } from './engine-env.mjs';

test('LE PLAFOND de pixels dépend de l écran, et le projet peut l imposer', () => {
  assert.equal(pixelRatioCap(3, true), 1.5, 'un téléphone à dpr 3 rendait à 2 : 78 % de pixels en trop');
  assert.equal(pixelRatioCap(3, false), 2);
  assert.equal(pixelRatioCap(1, true), 1, 'jamais au-dessus du dpr réel');
  assert.equal(pixelRatioCap(3, true, 1), 1, 'settings.maxPixelRatio l emporte');
});

test('LA RÉSOLUTION DESCEND quand les images sont lentes, et remonte sans osciller', () => {
  const s = createRenderScaler(1.5);
  let r = null;
  for(let i = 0; i < 30 && r === null; i++) r = s.sample(1 / 20);   // 20 i/s
  assert.ok(r !== null && r < 1.5, 'à 20 images/s la résolution doit baisser');
  const low = s.ratio;
  // Une seule fenêtre rapide ne suffit pas à remonter.
  for(let i = 0; i < 62; i++) s.sample(1 / 60);
  assert.equal(s.ratio, low, 'remonter dès la première seconde rapide ferait osciller');
  for(let i = 0; i < 62 * 3; i++) s.sample(1 / 60);
  assert.ok(s.ratio > low);
  assert.ok(s.ratio <= 1.5, 'jamais au-dessus du plafond');
});

test('UNE IMAGE ÉNORME (onglet revenu au premier plan) ne fait pas chuter la résolution', () => {
  const s = createRenderScaler(2);
  assert.equal(s.sample(3), null);
  assert.equal(s.ratio, 2);
});

test('adaptiveResolution:false fige ; l anticrénelage tombe sur écran tactile dense', () => {
  const fixe = renderSetupFor({adaptiveResolution: false}, 3, true);
  for(let i = 0; i < 100; i++) fixe.scaler.sample(1 / 10);
  assert.equal(fixe.scaler.ratio, 1.5);
  assert.equal(renderSetupFor({}, 3, true).antialias, false);
  assert.equal(renderSetupFor({}, 1, false).antialias, true);
  assert.equal(renderSetupFor({antialias: true}, 3, true).antialias, true, 'le projet tranche');
});

test('LE JOYSTICK presse UNE direction en 4 voies, deux en 8 voies, rien au centre', () => {
  assert.deepEqual(joystickDirections({x: 0.9, y: 0.6}, true), ['right']);
  assert.deepEqual(joystickDirections({x: 0.2, y: -0.8}, true), ['down']);
  assert.deepEqual(joystickDirections({x: 0.7, y: 0.7}, false), ['right', 'up']);
  assert.deepEqual(joystickDirections({x: 0.3, y: 0.2}, true), []);
  const c = normalizeTouchControls({joystick: {actions: {up: 'haut'}}});
  assert.equal(c.joystick.actions.up, 'haut');
  assert.equal(c.joystick.actions.left, '');
  assert.equal(c.joystick.fourWay, true);
  assert.equal(c.buttonSize, 84);
});

test('L INTERFACE se met à l échelle d une résolution de référence (Canvas Scaler)', () => {
  const env = creerContexte(['js/game-ui.js']);
  const f = env.uiScaleFactor;
  assert.ok(Math.abs(f({}, 844, 390) - 390 / 720) < 1e-9, 'sans réglage : actif pour TOUS les projets (fit 1280x720)');
  assert.equal(f({}, 1920, 1080), 1, 'sur un écran de PC, le défaut ne change rien');
  assert.equal(f({scaleMode: 'none'}, 844, 390), 1, 'none : pixels fixes, à choisir explicitement');
  const fit = f({scaleMode: 'fit', referenceWidth: 1280, referenceHeight: 720}, 844, 390);
  assert.ok(Math.abs(fit - 390 / 720) < 1e-9, 'tout doit tenir sur un téléphone en paysage');
  assert.equal(f({scaleMode: 'fit'}, 2560, 1440), 1, 'maxScale 1 : un écran 4K n agrandit pas le pixel-art');
  const m = f({scaleMode: 'match', match: 0.5, maxScale: 4}, 2560, 720);
  assert.ok(Math.abs(m - Math.sqrt(2)) < 1e-9);
});

test('SEULES LES CLÉS CHANGÉES sont reposées', () => {
  const env = creerContexte(['js/game-ui.js']);
  const state = {};
  assert.equal(env._changedKeys(state, {a: 1, b: 'x'}), null, 'premier passage : tout reposer');
  assert.deepEqual([...env._changedKeys(state, {a: 1, b: 'y'})], ['b']);
  assert.deepEqual([...env._changedKeys(state, {a: 1, b: 'y'})], []);
  assert.deepEqual([...env._changedKeys(state, {a: 1, b: 'y', l: [1]})], ['l']);
  assert.deepEqual([...env._changedKeys(state, {a: 1, b: 'y', l: [1]})], [], 'un tableau identique ne change pas');
});

test('SANS COMPOSANT, les contrôles tactiles sont DÉDUITS de la table d entrées', () => {
  const cfg = autoTouchConfig({
    actions: {saut: [' ', 'pad:0'], retour: ['Escape', 'pad:1'], haut: ['ArrowUp', 'z'], bas: ['ArrowDown'],
              gauche: ['ArrowLeft'], droite: ['ArrowRight'], menu: ['Tab', 'pad:9']},
    axes: {}
  });
  assert.equal(cfg.joystick.enabled, true);
  assert.deepEqual({...cfg.joystick.actions}, {up: 'haut', down: 'bas', left: 'gauche', right: 'droite'});
  assert.equal(cfg.joystick.fourWay, true, 'sans axe, le stick presse une direction à la fois');
  assert.deepEqual(cfg.buttons.map((b) => b.label + ':' + b.action), ['A:saut', 'B:retour', 'Menu:menu']);
  assert.equal(autoTouchConfig({actions: {}, axes: {}}), null, 'rien à jouer : pas de surcouche');
  const axes = autoTouchConfig({actions: {}, axes: {horizontal: ['a', 'd']}});
  assert.equal(axes.joystick.axisX, 'horizontal');
  assert.equal(axes.joystick.fourWay, false);
});
