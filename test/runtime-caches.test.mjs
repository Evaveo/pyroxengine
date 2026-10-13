// moteur/test/runtime-caches.test.mjs — caches de la boucle d'image du jeu publié (js/runtime-caches.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLightCache, createNameIndex, createUIDocResolver, worldHasMovingBody } from '../js/runtime-caches.js';

test('api.find : même résultat que le balayage, PREMIER trouvé, renommage et retrait suivis', () => {
  const list = [{name: 'A'}, {name: 'B'}, {name: 'A'}];
  const idx = createNameIndex(() => list);
  assert.equal(idx.find('A'), list[0]);
  assert.equal(idx.find('Z'), null);
  list[1].name = 'Z';                       // renommage non signalé
  assert.equal(idx.find('Z'), list[1]);
  assert.equal(idx.find('B'), null);
  list.shift(); idx.invalidate();           // retrait
  assert.equal(idx.find('A'), list[1]);
});

test('lumières : une seule traversée tant que rien ne change, refaite après invalidate', () => {
  let n = 0;
  const lights = [{isPointLight: true}, {isDirectionalLight: true}, {isSpotLight: true}, {}];
  const scene = {traverse(f){ n++; lights.forEach(f); }};
  const c = createLightCache();
  let r = c.get(scene); c.get(scene); c.get(scene);
  assert.equal(n, 1);
  assert.equal(r.locals.length, 2); assert.equal(r.directional.length, 1);
  c.invalidate(); c.get(scene);
  assert.equal(n, 2);
  const periodic = createLightCache(3); n = 0;
  for(let k = 0; k < 6; k++) periodic.get(scene);
  assert.equal(n, 3);   // première lecture, puis les 3e et 6e
});

test('document UI : résolu une fois, re-résolu si une feuille change', () => {
  let calls = 0;
  const assets = {d: {html: '<p>'}, s1: {css: 'a{}'}};
  const resolve = createUIDocResolver(() => assets, (css) => { calls++; return css; });
  const uiDoc = {documentUIId: 'd', sheetStyleIds: ['s1']};
  const r1 = resolve(null, uiDoc);
  assert.equal(resolve(null, uiDoc), r1);
  assert.equal(calls, 1);
  assets.s1 = {css: 'b{}'};
  assert.equal(resolve(null, uiDoc).css, 'b{}');
  assert.equal(resolve(null, {documentUIId: 'x'}), null);
});

test('physique : pas de pas de simulation pour un monde tout statique', () => {
  assert.equal(worldHasMovingBody({bodies: [{type: 2}, {type: 2}]}, 2), false);
  assert.equal(worldHasMovingBody({bodies: [{type: 2}, {type: 4}]}, 2), true);
});
