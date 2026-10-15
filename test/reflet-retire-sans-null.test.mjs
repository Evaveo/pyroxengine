// DÉCOCHER « REFLETS DU CIEL » NE PLANTE PLUS LA BOUCLE DE RENDU (v1.13.2).
//
// three r185 garde, par matériau et pour toute sa vie, l'instantané de chaque texture vue non
// nulle (NodeMaterialObserver) : écrire `envMap = null` ensuite fait lire `null.isTexture` à
// chaque image. Garde : un matériau qui a eu un reflet ne repasse JAMAIS à `envMap === null`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { creerContexte } from './engine-env.mjs';

function neuf(){ return creerContexte(['js/environment-map.js']); }
function fauxRenderer(){
  const appels = [];
  return { appels, getRenderTarget: () => null,
    setRenderTarget: (rt, face) => appels.push(['cible', face]), clear: () => appels.push(['clear']) };
}
const cube = () => ({ texture: { userData: {} } });

test('retirer un reflet pose la texture neutre, intensite 0, jamais null', () => {
  const ctx = neuf();
  const r = fauxRenderer();
  const ciel = { userData: {} };
  const m = { envMap: ciel, envMapIntensity: 1, envNode: { box: 1 } };
  ctx.removeEnvironmentFrom(m, ctx.neutralEnvironment(r, cube));
  assert.notEqual(m.envMap, null);
  assert.equal(m.envMap.userData.neutralEnvironment, true);
  assert.equal(m.envMapIntensity, 0);
  assert.equal(m.envNode, null);
  assert.equal(ctx.hasEnvironment(m), false, 'la texture neutre compte pour « pas de reflet »');
});

test('un materiau jamais reflechi reste a null (rien a proteger)', () => {
  const ctx = neuf();
  const m = { envMap: null };
  ctx.removeEnvironmentFrom(m, ctx.neutralEnvironment(fauxRenderer(), cube));
  assert.equal(m.envMap, null);
});

test('la texture neutre : une par renderer, ses six faces effacees une fois', () => {
  const ctx = neuf();
  const r = fauxRenderer();
  const a = ctx.neutralEnvironment(r, cube);
  assert.equal(ctx.neutralEnvironment(r, cube), a);
  assert.equal(r.appels.filter((x) => x[0] === 'clear').length, 6);
  assert.notEqual(ctx.neutralEnvironment(fauxRenderer(), cube), a);
});

test('plus aucun envMap = null sur un materiau vivant (editeur et jeu)', () => {
  for(const f of ['js/probes.js', 'js/game-runtime.js']){
    const src = readFileSync(new URL('../' + f, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /\bm\.envMap\s*=\s*null/, f);
    assert.match(src, /removeEnvironmentFrom\(m, neutralEnvironment\(/, f);
  }
});
