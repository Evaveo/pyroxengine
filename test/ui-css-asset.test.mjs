// moteur/test/ui-css-asset.test.mjs
// `url("asset:Nom")` dans le CSS d'une interface de jeu désigne une texture du projet (js/game-ui.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCssAssetUrls } from '../js/game-ui.js';

const lookup = (name) => (name === 'Jardin' ? 'blob:jardin' : null);

test('les trois écritures d\'une référence d\'asset sont résolues', () => {
  assert.equal(resolveCssAssetUrls('a{background:url("asset:Jardin")}', lookup), 'a{background:url("blob:jardin")}');
  assert.equal(resolveCssAssetUrls("a{background:url('asset:Jardin')}", lookup), 'a{background:url("blob:jardin")}');
  assert.equal(resolveCssAssetUrls('a{background:#123 url( asset:Jardin ) center/cover}', lookup),
    'a{background:#123 url("blob:jardin") center/cover}');
});

test('une texture inconnue et une URL ordinaire sont laissées telles quelles', () => {
  const css = '.b{background:url(asset:Absente)} .c{background:url(x.png)}';
  assert.equal(resolveCssAssetUrls(css, lookup), css);
});

test('sans résolveur ni CSS, rien ne lève', () => {
  assert.equal(resolveCssAssetUrls('', lookup), '');
  assert.equal(resolveCssAssetUrls('a{}', null), 'a{}');
});
