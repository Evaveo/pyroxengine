// La vue Jeu (js/game-view.js) : la scène à travers la caméra principale, hors lecture.
//
// Le rendu lui-même demande un GPU et n'est vérifiable qu'à la main. Ce qui se décide sans GPU
// est testé ici : quelle caméra (la règle EXACTE du jeu publié), quel rectangle (les bandes
// noires), quand rendre (jamais cachée), et le registre par lequel la boucle la rend. Plus deux
// gardes de source sur ce qui casserait la vue Scène en silence : la cible de canevas toujours
// restaurée, et aucun import de game-view.js par un module du grand cycle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GAME_VIEW_ASPECTS, GAME_VIEW_MESSAGES, aspectRatioOf, fitGameViewRect, gameViewRenderState,
  pickMainCameraNode } from '../js/game-view-core.js';
import { EXTRA_VIEWS, extraViewsActive, registerExtraView, renderExtraViews } from '../js/extra-views.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

test('la caméra filmée est la PRINCIPALE, sinon la première — la règle de rtCameraMain', () => {
  const a = {name: 'A'}, b = {name: 'B', main: true}, c = {name: 'C'};
  const isMain = (n) => !!n.main;
  assert.equal(pickMainCameraNode([a, b, c], isMain), b);
  assert.equal(pickMainCameraNode([a, c], isMain), a, 'aucune cochée : la première');
  assert.equal(pickMainCameraNode([], isMain), null);
  assert.equal(pickMainCameraNode([a, b], null), a, 'sans juge (module 2D retiré) : la première');
  // la même règle que le jeu publié, écrite au même endroit
  const runtime = read('js/game-runtime.js');
  assert.ok(runtime.indexOf('const choisie = marquee || cams[0] || null;') !== -1,
    'rtCameraMain a changé de règle : la vue Jeu ne montrerait plus la caméra du jeu');
});

test('Libre : toute la place ; un rapport imposé : le plus grand rectangle centré', () => {
  assert.deepEqual(fitGameViewRect(800, 600, null), {x: 0, y: 0, width: 800, height: 600});
  assert.deepEqual(fitGameViewRect(800, 600, 16 / 9), {x: 0, y: 75, width: 800, height: 450});
  assert.deepEqual(fitGameViewRect(1000, 400, 16 / 9), {x: 144, y: 0, width: 711, height: 400});
  const portrait = fitGameViewRect(800, 600, 9 / 16);
  assert.equal(portrait.height, 600);
  assert.equal(portrait.width, 338);
  assert.equal(portrait.x, 231);
});

test('jamais de rectangle nul : un panneau caché rend null, un panneau minuscule 1 px au moins', () => {
  assert.equal(fitGameViewRect(0, 600, null), null);
  assert.equal(fitGameViewRect(800, 0, 16 / 9), null);
  const r = fitGameViewRect(1, 300, 16 / 9);
  assert.ok(r.width >= 1 && r.height >= 1);
});

test('les rapports d\'image : ids uniques, Libre en premier, un id inconnu retombe sur Libre', () => {
  const ids = GAME_VIEW_ASPECTS.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids[0], 'free');
  assert.equal(aspectRatioOf('free'), null);
  assert.equal(aspectRatioOf('16:9'), 16 / 9);
  assert.equal(aspectRatioOf('n importe quoi'), null);
  assert.ok(read('js/ui/prefs.js').indexOf("key: 'gameView.aspect'") !== -1,
    'la préférence du rapport d\'image doit être déclarée dans js/ui/prefs.js');
});

test('on ne rend que regardée, et chaque refus a son message', () => {
  const ok = {connected: true, width: 640, height: 360, ready: true, canvasTarget: true, baking: false, hasCamera: true};
  assert.deepEqual(gameViewRenderState(ok), {render: true, reason: null});
  assert.equal(gameViewRenderState(Object.assign({}, ok, {width: 0})).reason, 'hidden');
  assert.equal(gameViewRenderState(Object.assign({}, ok, {connected: false})).reason, 'hidden');
  assert.equal(gameViewRenderState(Object.assign({}, ok, {ready: false})).reason, 'starting');
  assert.equal(gameViewRenderState(Object.assign({}, ok, {canvasTarget: false})).reason, 'no-webgpu');
  assert.equal(gameViewRenderState(Object.assign({}, ok, {baking: true})).reason, 'baking');
  assert.equal(gameViewRenderState(Object.assign({}, ok, {hasCamera: false})).reason, 'no-camera');
  ['starting', 'no-webgpu', 'baking', 'no-camera'].forEach((r) => {
    assert.ok(GAME_VIEW_MESSAGES[r], 'refus sans message : ' + r);
  });
});

test('le registre des vues : inactive, une vue ne coûte rien ; une erreur ne casse pas la boucle', () => {
  EXTRA_VIEWS.length = 0;
  let shown = false, renders = 0;
  registerExtraView({name: 'T', active: () => shown, render: () => { renders++; }});
  assert.equal(extraViewsActive(), false);
  assert.equal(renderExtraViews({}), 0);
  assert.equal(renders, 0);
  shown = true;
  assert.equal(extraViewsActive(), true);
  assert.equal(renderExtraViews({}), 1);
  assert.equal(renders, 1);
  // ré-inscription sous le même nom : remplace, ne double pas
  registerExtraView({name: 'T', active: () => true, render: () => { throw new Error('boum'); }});
  assert.equal(EXTRA_VIEWS.length, 1);
  const caught = [];
  renderExtraViews({}, (name, fn) => { try { fn(); } catch(e){ caught.push(name); } });
  assert.deepEqual(caught, ['T'], 'l\'isolation de la boucle (System.isolate) reçoit l\'erreur');
  assert.throws(() => registerExtraView({name: 'X'}));
  EXTRA_VIEWS.length = 0;
});

test('garde : la vue Jeu RESTAURE la cible de canevas dans un finally', () => {
  const src = read('js/game-view.js');
  const i = src.indexOf('renderer.setCanvasTarget(gameView.target);');
  const j = src.indexOf('} finally {', i);
  const k = src.indexOf('renderer.setCanvasTarget(previous);', j);
  assert.ok(i !== -1 && j > i && k > j,
    'sans restauration garantie, une exception laisserait la vue Scène dessiner dans le canevas Jeu');
  assert.ok(src.indexOf('withHighlightSuspended(') !== -1, 'la sélection ne doit pas luire dans la vue Jeu');
});

test('garde : la boucle rend la vue Jeu par le registre, AVANT la vue Scène, même cachée', () => {
  const src = read('js/viewport.js');
  assert.ok(src.indexOf("if(!sceneShown && !extraViewsActive()) return;") !== -1,
    'onglet Jeu devant la vue Scène : la boucle doit continuer de tourner');
  const a = src.indexOf('renderExtraViews({dt: dt}, System.isolate);');
  const b = src.indexOf('if(sceneShown) renderSceneView(w, h);');
  assert.ok(a !== -1 && b > a);
});

test('garde : aucun module de js/ n\'importe game-view.js, à part startup.js', () => {
  const offenders = [];
  (function walk(d){
    fs.readdirSync(path.join(root, d), {withFileTypes: true}).forEach((e) => {
      const rel = d + '/' + e.name;
      if(e.isDirectory()){ if(e.name !== 'help') walk(rel); return; }
      if(!e.name.endsWith('.js') || rel === 'js/startup.js') return;
      if(/from '\.{1,2}\/(?:[\w-]+\/)*game-view\.js'/.test(read(rel))) offenders.push(rel);
    });
  })('js');
  assert.deepEqual(offenders, [],
    'importer game-view.js depuis le grand cycle de modules l\'y ferait entrer (cliquets-dette)');
});
