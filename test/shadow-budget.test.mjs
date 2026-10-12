import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Budget d'ombres locales (js/shadow-fit.js) : au-delà de MAX_LOCAL_SHADOWS, les lumières
// ponctuelles/spots n'ombrent plus — sinon un matériau dépasse les 16 textures d'un shader GPU.
const src = readFileSync(new URL('../js/shadow-fit.js', import.meta.url), 'utf8')
  .replace(/^export /gm, '').replace(/if \(typeof globalThis[^\n]*\n/, '');
const ShadowFit = new Function(src + '; return ShadowFit;')();

function light(id, kind){ return {id, isPointLight: kind === 'p', isSpotLight: kind === 's', isDirectionalLight: kind === 'd', castShadow: true, userData: {}}; }

test('au plus MAX_LOCAL_SHADOWS lumières locales ombrent, choisies dans l ordre de création', () => {
  const ls = [light(5, 'p'), light(1, 's'), light(9, 'p'), light(3, 'p'), light(7, 'p'), light(2, 'd')];
  ShadowFit.budgetLocalShadows(ls.filter((l) => !l.isDirectionalLight), 4);
  const on = ls.filter((l) => l.castShadow).map((l) => l.id).sort((a, b) => a - b);
  assert.deepEqual(on, [1, 2, 3, 5, 7]);          // 4 locales (1,3,5,7) + la directionnelle
  ShadowFit.budgetLocalShadows(ls.filter((l) => !l.isDirectionalLight), 4);      // stable d'une image à l'autre
  assert.deepEqual(ls.filter((l) => l.castShadow).map((l) => l.id).sort((a, b) => a - b), on);
});

test('une lumière qui ne voulait pas d ombre n en reçoit jamais', () => {
  const l = light(1, 'p'); l.castShadow = false;
  ShadowFit.budgetLocalShadows([l], 4);
  assert.equal(l.castShadow, false);
});
