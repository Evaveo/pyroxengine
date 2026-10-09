// moteur/test/ciel-camera-ortho.test.mjs
//
// RÉGRESSION (signalée cinq fois). Le ciel « Dégradé » / « Panorama » est une texture
// équirectangulaire : une caméra orthographique (toute caméra 2D) ne la dessine pas
// correctement, et régler le ciel d'une scène 2D ne changeait rien à l'écran. Pour une caméra
// orthographique, le ciel devient une image plein écran (UVMapping).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte } from './engine-env.mjs';

const env = creerContexte(['js/sky-camera.js']);
const T = env.THREE;

function ciel(){
  const t = new T.Texture();
  t.mapping = T.EquirectangularReflectionMapping;
  return t;
}

test('caméra orthographique : image plein écran, pas une sphère', () => {
  const fond = ciel();
  const r = env.backgroundForCamera(fond, new T.OrthographicCamera());
  assert.notEqual(r, fond);
  assert.equal(r.mapping, T.UVMapping);
  assert.equal(env.backgroundForCamera(fond, new T.OrthographicCamera()), r, 'copie faite une seule fois');
  assert.ok(env.isSkyBackground(r, fond));
});

test('caméra perspective : le ciel équirectangulaire tel quel', () => {
  const fond = ciel();
  assert.equal(env.backgroundForCamera(fond, new T.PerspectiveCamera()), fond);
});

test('couleur unie : inchangée quelle que soit la caméra', () => {
  const c = new T.Color('#ff0000');
  assert.equal(env.backgroundForCamera(c, new T.OrthographicCamera()), c);
});
