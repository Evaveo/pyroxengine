// moteur/test/editor-idle-perf.test.mjs
//
// Optimisations de l'éditeur, deuxième passe :
//   1. ralenti du rendu au repos (js/render-throttle.js, branché dans js/viewport.js) ;
//   2. chemin « sélection seule » de la hiérarchie (js/hierarchy.js, appelé par js/selection.js) ;
//   3. signature mémoïsée de la configuration tactile déduite (js/touch-input.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deEsm } from './engine-env.mjs';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(dirname, '..', f), 'utf8');

// ---------- 1. Ralenti au repos ----------
function loadThrottle(){
  const ctx = { performance: { now: () => ctx.__now }, __now: 0, globalThis: null };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  // `const` ne devient pas une propriété du contexte : on les y recopie.
  vm.runInContext(deEsm(read('js/render-throttle.js'))
    + ';Object.assign(globalThis, {renderThrottle, markActive, ACTIVITY_EVENTS});', ctx);
  return ctx;
}

test('ralenti : cadence pleine pendant 2 s après une activité, puis ~10 i/s', () => {
  const ctx = loadThrottle();
  ctx.__now = 0; ctx.requestRender();
  let rendered = 0;
  // 60 Hz pendant 1,9 s : toutes les images rendues.
  for(let t = 0; t < 1900; t += 1000 / 60){ if(ctx.shouldRenderFrame(t, false)) rendered++; }
  assert.equal(rendered, Math.ceil(1900 / (1000 / 60)));
  // Au repos, entre 3 et 4 s : ~10 rendus par seconde, jamais plus de 100 ms sans image.
  rendered = 0; let last = 3000, maxGap = 0;
  for(let t = 3000; t < 4000; t += 1000 / 60){
    if(ctx.shouldRenderFrame(t, false)){ rendered++; maxGap = Math.max(maxGap, t - last); last = t; }
  }
  assert.ok(rendered >= 9 && rendered <= 11, 'rendus au repos : ' + rendered);
  assert.ok(maxGap <= 100.5, 'écart max ' + maxGap);
  assert.ok(ctx.renderThrottle.skipped > 0);
});

test('ralenti : une activité rend la cadence pleine dès l\'image suivante', () => {
  const ctx = loadThrottle();
  for(let t = 5000; t < 5200; t += 1000 / 60) ctx.shouldRenderFrame(t, false);
  ctx.__now = 5200; ctx.markActive();
  assert.equal(ctx.shouldRenderFrame(5201, false), true);
  assert.equal(ctx.shouldRenderFrame(5218, false), true);
});

test('ralenti : un travail continu (busy) garde la cadence pleine, et le prolonge de 2 s', () => {
  const ctx = loadThrottle();
  for(let t = 10000; t < 11000; t += 1000 / 60) assert.equal(ctx.shouldRenderFrame(t, true), true);
  assert.equal(ctx.shouldRenderFrame(11500, false), true);
  assert.equal(ctx.shouldRenderFrame(11510, false), true);
});

test('ralenti : désactivé, toutes les images sont rendues', () => {
  const ctx = loadThrottle();
  ctx.renderThrottle.enabled = false;
  for(let t = 20000; t < 20500; t += 1000 / 60) assert.equal(ctx.shouldRenderFrame(t, false), true);
});

test('ralenti : écouteurs d\'activité en capture, idempotents, et requestRender global', () => {
  const ctx = loadThrottle();
  const added = [];
  const target = { addEventListener: (type, fn, opts) => added.push({type, fn, opts}) };
  ctx.installActivityListeners(target);
  ctx.installActivityListeners(target);
  for(const t of ['pointerdown', 'pointermove', 'wheel', 'keydown', 'input', 'change', 'drop'])
    assert.ok(added.some((a) => a.type === t && a.opts.capture), t);
  assert.equal(added.length, ctx.ACTIVITY_EVENTS.length);
  assert.equal(typeof ctx.globalThis.requestRender, 'function');
});

test('ralenti : branchements (boucle, préférence, sources asynchrones)', () => {
  const vp = read('js/viewport.js');
  // Ombres + rendu sautés ensemble : updateShadows vit dans renderSceneView.
  assert.match(vp, /if\(sceneShown && shouldRenderFrame\(performance\.now\(\), loopBusy\(\)\)\) renderSceneView\(w, h\);/);
  assert.match(vp, /renderThrottle\.enabled = Prefs\.get\('viewport\.idleThrottle'\) !== false;/);
  assert.match(vp, /installActivityListeners\(\);/);
  assert.match(vp, /export function requestResize\(\)\{ resizePending = true; requestRender\(\); \}/);
  assert.match(vp, /DefaultLoadingManager/);
  // loopBusy couvre les travaux continus.
  const busy = vp.slice(vp.indexOf('export function loopBusy'), vp.indexOf('export function loopBusy') + 700);
  for(const k of ['anim.playback', 'phys.active', 'tc.dragging', 'keysFlyFree.size', 'extraViewsActive()',
    'animModels.size', 'previewAnimator.active', "'Particles'"]) assert.ok(busy.includes(k), k);
  // La lecture du temps et les mises à jour bon marché restent AVANT le rendu (pas de return anticipé).
  const loopSrc = vp.slice(vp.indexOf('export function loop()'), vp.indexOf('export function loopBusy'));
  assert.ok(loopSrc.indexOf('clock.update()') < loopSrc.indexOf('shouldRenderFrame'));
  assert.ok(read('js/ui/prefs.js').includes("key: 'viewport.idleThrottle'"));
  const RR = "globalThis.requestRender()";
  for(const f of ['js/history.js', 'js/scene.js', 'js/copilot.js', 'js/environment.js', 'js/lightmap-bake.js',
    'js/assets.js', 'js/serialization.js']) assert.ok(read(f).includes(RR), f);
});

// ---------- 2. Hiérarchie : chemin « sélection seule » ----------
function el(){
  const classes = new Set();
  const e = {
    dataset: {}, innerHTML: '', value: '',
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c), toggle: (c) => (classes.has(c) ? classes.delete(c) : classes.add(c)) },
    addEventListener: () => {}, querySelector: () => null, querySelectorAll: () => [],
    _classes: classes
  };
  return e;
}

function loadHierarchy(objs){
  const hierBody = el(), hierFilter = el();
  const counters = { layers: 0, shadows: 0 };
  // Les lignes : reconstruites à partir du innerHTML posé (data-id / classes).
  let rows = [];
  Object.defineProperty(hierBody, 'innerHTML', {
    get(){ return this._html || ''; },
    set(v){
      this._html = v;
      rows = [...v.matchAll(/<div class="([^"]*)" draggable="true" data-id="(\d+)"/g)].map((m) => {
        const r = el(); r.dataset.id = m[2]; m[1].split(' ').forEach((c) => r.classList.add(c)); return r;
      });
    }
  });
  hierBody.querySelectorAll = () => rows;
  const ctx = {
    document: { getElementById: (id) => (id === 'hier-body' ? hierBody : id === 'hier-filter' ? hierFilter : el()) },
    objects: objs, scene: { children: objs },
    isSceneObject: (o) => objs.indexOf(o) !== -1,
    objectOfSceneById: (id) => objs.find((o) => o.id === id) || null,
    selection: null, selectionMulti: [],
    allSelection: () => (ctx.selection ? [ctx.selection] : []).concat(ctx.selectionMulti),
    ed: (o) => (o._ed = o._ed || {}), escapeHtml: (s) => String(s),
    markAllLayersDirty: () => counters.layers++, refitShadows: () => counters.shadows++,
    visibleIntent: (o) => o.visible !== false,
    Icons: { html: () => '' }, iconOf: () => ''
  };
  vm.createContext(ctx);
  vm.runInContext(deEsm(read('js/hierarchy.js')), ctx);
  return { ctx, rows: () => rows, counters, hierBody };
}

const leaf = (id, name) => ({ id, name, visible: true, children: [], userData: {}, parent: null });

test('hiérarchie : un changement de sélection pur bascule les classes sans reconstruire', () => {
  const a = leaf(1, 'A'), b = leaf(2, 'B');
  const h = loadHierarchy([a, b]);
  h.ctx.updateHierarchy();
  const before = h.rows();
  assert.equal(h.counters.layers, 1);
  h.ctx.selection = b;
  h.ctx.updateHierarchySelection();
  assert.equal(h.rows(), before, 'mêmes lignes : pas de innerHTML');
  assert.equal(h.counters.layers, 1, 'pas de passe des calques');
  assert.equal(h.counters.shadows, 1, 'pas de recadrage des ombres');
  assert.ok(before[1].classList.contains('sel'));
  assert.ok(!before[0].classList.contains('sel'));
  h.ctx.selection = a; h.ctx.selectionMulti.push(b);
  h.ctx.updateHierarchySelection();
  assert.ok(before[0].classList.contains('sel') && !before[1].classList.contains('sel'));
  assert.ok(before[1].classList.contains('multi'));
});

test('hiérarchie : structure changée ou ligne absente -> reconstruction complète', () => {
  const a = leaf(1, 'A'), b = leaf(2, 'B');
  const objs = [a, b];
  const h = loadHierarchy(objs);
  h.ctx.updateHierarchy();
  // Un objet créé puis sélectionné : sa ligne doit apparaître.
  const c = leaf(3, 'C'); objs.push(c);
  h.ctx.selection = c;
  h.ctx.updateHierarchySelection();
  assert.equal(h.counters.layers, 2);
  assert.ok(h.rows().some((r) => r.dataset.id === '3' && r.classList.contains('sel')));
  // Renommage sans reconstruction, puis sélection : reconstruit.
  a.name = 'A2';
  h.ctx.updateHierarchySelection();
  assert.equal(h.counters.layers, 3);
  // Visibilité changée ailleurs : reconstruit (classe hidden / œil).
  b.visible = false;
  h.ctx.updateHierarchySelection();
  assert.equal(h.counters.layers, 4);
  // Sélectionné mais sans ligne (replié) : reconstruit.
  const before = h.counters.layers;
  h.ctx.selection = { id: 99, name: 'x', children: [], userData: {} };
  h.ctx.updateHierarchySelection();
  assert.equal(h.counters.layers, before + 1);
});

test('sélection : les trois changements purs passent par le chemin léger', () => {
  const src = read('js/selection.js');
  assert.equal((src.match(/updateHierarchySelection\(\);/g) || []).length, 3);
  assert.ok(!/\bupdateHierarchy\(\);/.test(src));
});

// ---------- 3. Tactile : signature de la configuration déduite ----------
test('tactile : la signature de la config DÉDUITE est mémoïsée, celle d\'un composant non', () => {
  const src = read('js/touch-input.js');
  assert.match(src, /const signature = \(cfg === AUTO_CACHE\.cfg\) \? autoSignature\(cfg\) : JSON\.stringify\(cfg\);/);
  assert.match(src, /AUTO_CACHE\.signature = null;/);
  // Le balayage des porteurs reste celui de game.objects : l'ordre et le composant désactivé comptent.
  assert.match(read('js/game-runtime.js'), /syncTouchControls\(container, game\.objects,/);
});
