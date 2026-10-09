// L ORIENTATION DE LA CIBLE DE SCENE EST AUTOMATIQUE, ET ELLE DOIT ARRIVER PARTOUT.
//
// Etait une case a cocher manuelle (`env.post.retournerV`) : personne ne pouvait deviner le bon
// sens depuis le code, donc chacun devait cocher au pif sur sa machine. Le vrai signal existe —
// `renderer.backend.isWebGPUBackend` distingue le backend WebGPU reel du repli WebGL2 automatique
// de THREE.WebGPURenderer (les deux ont isWebGPURenderer === true) — donc le flip se deduit,
// il ne se regle plus.
//
// Ce que ce test protege : que le flip arrive a TOUTES les lectures de cible, et que les deux
// moteurs restent d accord.
//
// Il n en exigeait que DEUX (scene du bright, scene de la composition). C etait la moitie de la
// regle, et l autre moitie manquait aussi dans le code : le flou et le bloom lisent eux aussi
// des cibles. La chaine du bloom accumulait donc un nombre IMPAIR de lectures non inversees et
// sortait a l envers, collee en haut de l image, pendant que la scene, elle, etait a l endroit.
// Un flou gaussien etant symetrique, les passes intermediaires ne montraient rien.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LF = String.fromCharCode(10);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8').split(String.fromCharCode(13)).join('');
const sansCom = (s) => s.split(LF)
  .map((l) => { const i = l.indexOf('//'); return i === -1 ? l : l.slice(0, i); }).join(LF);
const count = (s, m) => s.split(m).length - 1;

[['éditeur', 'js/postfx.js'], ['game publié', 'js/game-runtime.js']].forEach(([name, f]) => {
  test(name + ' : TOUTE lecture de cible reçoit le même sens', () => {
    const src = sansCom(read(f));
    const helper = (name === 'éditeur' ? 'uvTargetRead(uFlipV)' : 'rtUvTargetRead(uFlipV)');
    // 4 lectures de cible : bright(scène), flou, composition(scène), composition(bloom). Le FXAA,
    // cinquième lecteur, a été retiré en v0.135.0.
    assert.equal(count(src, 'texture(null, ' + helper + ')'), 4,
      name + ' : ' + count(src, 'texture(null, ' + helper + ')') + ' lecture(s) de cible passent '
      + 'par le sens réglable — il en faut QUATRE. Une seule oubliée renverse le bloom, et le '
      + 'défaut se voit sur le halo, jamais sur la passe fautive');
    // aucune lecture de cible ne doit rester en uv() brut
    assert.equal(count(src, 'texture(null)'), 0,
      name + ' : une texture de cible est encore lue sans inversion du V');
    assert.equal(count(src, 'uFlipV.value = ' + (name === 'éditeur' ? 'postFlipV()' : 'rtPostFlipV()') + ' ? 1 : 0;'), 3,
      name + ' : le flip n arrive pas aux trois matériaux à chaque image');
  });
});

test('la case « Image retournée » a disparu du panneau', () => {
  // Elle mentirait : le flip ne se règle plus, il se déduit du backend actif.
  const panneau = sansCom(read('js/ui/panels-scene.js'));
  assert.equal(panneau.indexOf("'f-env-pflip'"), -1,
    'la case existe encore alors que le flip est automatique — elle n a plus d effet et trompe');
  assert.equal(panneau.indexOf("'retournerV'"), -1,
    'un champ vise encore retournerV, qui n est plus lu par le pipeline');
});

test('le flip se déduit du backend, pas d un réglage par scène', () => {
  const postfx = sansCom(read('js/postfx.js'));
  const runtime = sansCom(read('js/game-runtime.js'));
  assert.ok(postfx.indexOf('isWebGPUBackend') !== -1,
    'js/postfx.js ne consulte plus le backend réel — le flip redevient une hypothèse');
  assert.ok(runtime.indexOf('isWebGPUBackend') !== -1,
    'js/game-runtime.js ne consulte plus le backend réel — le flip redevient une hypothèse');
  assert.equal(postfx.indexOf('retournerV: false'), -1,
    'le vieux défaut par scène est revenu dans js/postfx.js');
});

test('un seul numéro de version dans tout le moteur', () => {
  // Il y en avait DEUX : VERSION_ENGINE (js/version.js) et un VERSION_EDITOR fige a 0.74.1 dans
  // js/ui.js, affiche dans la bar. Quatre versions d ecart, et personne ne pouvait dire quel
  // code tournait devant lui.
  const ui = sansCom(read('js/ui.js'));
  const m = ui.match(/VERSION_EDITOR\s*=\s*'[0-9]/);
  assert.equal(m, null,
    'js/ui.js reporte de nouveau un numéro écrit en dur : la bar affichera autre chose que le '
    + 'moteur qui tourne');
  assert.ok(ui.indexOf('VERSION_ENGINE') !== -1,
    'la bar ne lit plus VERSION_ENGINE');
});
