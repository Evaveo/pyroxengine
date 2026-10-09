// moteur/test/surface-webgpu.test.mjs
// Deux régressions trouvées par un audit croisé des DEUX bundles three (classique et
// three/webgpu), toutes deux silencieuses :
//   1. `renderer.capabilities` n'existe pas sur WebGPURenderer — c'est son BACKEND qui en a
//      un. Le renderer expose getMaxAnisotropy() directement. Lire `capabilities` levait, un
//      catch renvoyait 1, et le réglage d'anisotropy était plafonné à 1 jusque dans l'UI.
//   2. `info.render.calls` count les PASSES de rendu sous WebGPU, pas les draw calls
//      (`render.drawCalls`). Le budget « Draw calls » du profiler était toujours vert.
//
// Ces tests figent la shape de l'API attendue du renderer, là où le code n'a aucun medium de
// s'apercevoir qu'elle a changé.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { creerContexte } from './engine-env.mjs';

const racineMoteur = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Forme réelle de WebGPURenderer, vérifiée en l'instanciant : pas de `capabilities`, mais
// getMaxAnisotropy() qui délègue au backend (extension EXT côté WebGL2, 16 côté WebGPU).
const RENDERER_WEBGPU = `
  renderer = {
    isWebGPURenderer: true,
    outputColorSpace: null,
    getMaxAnisotropy: function(){ return 16; }
  };
`;
// Un renderer WebGL classique, tel que celui des vignettes d'assets : l'inverse exact.
const RENDERER_CLASSIQUE = `
  renderer = {
    outputColorSpace: null,
    capabilities: { getMaxAnisotropy: function(){ return 8; } }
  };
`;

function contexteAvec(rendererSource){
  const env = creerContexte(['js/assets.js', 'js/materials.js', 'js/model-import.js', 'js/import-settings.js']);
  vm.runInContext(rendererSource, env);
  vm.runInContext('this.anisotropyMax = anisotropyMax;', env);
  return env;
}

test('l\'anisotropy maximale est lue sur le renderer, pas sur un capabilities absent', () => {
  const webgpu = contexteAvec(RENDERER_WEBGPU);
  assert.equal(webgpu.anisotropyMax(), 16,
    'sous WebGPURenderer il faut passer par getMaxAnisotropy() — 1 signifierait le réglage mort');

  const classique = contexteAvec(RENDERER_CLASSIQUE);
  assert.equal(classique.anisotropyMax(), 8,
    'un renderer WebGL classique n\'a pas getMaxAnisotropy() : le repli sur capabilities doit rester');
});

test('un renderer sans aucune des deux voies retombe sur 1, mais le DIT', () => {
  const env = creerContexte(['js/assets.js', 'js/materials.js', 'js/model-import.js', 'js/import-settings.js']);
  vm.runInContext(`
    renderer = { outputColorSpace: null };
    globalThis.__avertis = [];
    console = { warn: function(){ globalThis.__avertis.push(Array.from(arguments).join(' ')); } };
    this.anisotropyMax = anisotropyMax;
  `, env);

  assert.equal(env.anisotropyMax(), 1);
  assert.equal(env.anisotropyMax(), 1, 'appel répété : toujours 1');
  const avertis = vm.runInContext('globalThis.__avertis.length', env);
  assert.equal(avertis, 1, 'un seul avertissement, mais au moins un — pas de silence');
});

// profiler.js touche au DOM au chargement : on n'évalue que la fonction concernée, extraite
// du fichier. Le test casse donc si elle est renommée ou déplacée, ce qui est voulu.
function chargerProfDrawCalls(){
  const src = readFileSync(path.join(racineMoteur, 'js/profiler.js'), 'utf8');
  const start = src.indexOf('function depthDrawCalls(');
  assert.notEqual(start, -1, 'depthDrawCalls doit exister dans js/profiler.js');
  const body = src.slice(start, src.indexOf('\n}', start) + 2);
  const ctx = vm.createContext({});
  vm.runInContext(body + '\nthis.depthDrawCalls = depthDrawCalls;', ctx);
  return ctx.depthDrawCalls;
}

test('les draw calls viennent de drawCalls sous WebGPU, de calls sur le renderer classique', () => {
  const depthDrawCalls = chargerProfDrawCalls();

  // shape WebGPU : `calls` = passes de rendu (post-traitement compris), drawCalls = draws
  assert.equal(depthDrawCalls({render: {calls: 6, frameCalls: 6, drawCalls: 412, triangles: 90000}}), 412,
    'afficher 6 au lieu de 412 rendait le budget draw calls toujours vert');

  // shape classique : pas de drawCalls, `calls` EST le number de draws
  assert.equal(depthDrawCalls({render: {calls: 412, triangles: 90000}}), 412);

  // drawCalls à 0 est une valeur légitime, pas une absence
  assert.equal(depthDrawCalls({render: {calls: 3, drawCalls: 0}}), 0,
    '0 draw call est une mesure valable — ne pas retomber sur calls');

  assert.equal(depthDrawCalls(null), 0, 'aucun info : 0, pas une exception');
  assert.equal(depthDrawCalls({}), 0);
});

test('le miroir runtime de l\'anisotropy lit la meme chose que l\'editeur', () => {
  const rt = readFileSync(path.join(racineMoteur, 'js/game-runtime.js'), 'utf8');
  const ed = readFileSync(path.join(racineMoteur, 'js/import-settings.js'), 'utf8');
  [rt, ed].forEach(function(src, i){
    assert.match(src, /typeof renderer\.getMaxAnisotropy === 'function'/,
      (i ? 'js/import-settings.js' : 'js/game-runtime.js') + ' doit interroger le renderer avant capabilities');
  });
});
