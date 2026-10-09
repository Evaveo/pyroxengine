import { deEsm } from './engine-env.mjs';
// Lot E de la revue du 2026-09-29 (docs/REVUE_2026-09-29.md, § 1.10, 1.11, 5.2 à 5.15) : le travail
// inutile retiré de chaque image, de chaque clic et de chaque ouverture. Une garde par correctif.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');

test('§ 1.10 — une boucle ne calcule qu une fois chaque note identique, et le résultat ne change pas', () => {
  const src = read('js/music-loop.js');
  assert.ok(/noteSamplesCached/.test(src));
  assert.ok(!/mixInto\(out, noteSamples\(/.test(src), 'plus aucun appel direct non mis en cache');
  // Le raccord modulo en blocs donne exactement la même somme qu'un modulo par échantillon.
  const bac = {Math, Float32Array, Number, String, Object, Array, isFinite};
  bac.globalThis = bac;
  const ctx = vm.createContext(bac);
  vm.runInContext(deEsm(src), ctx);
  const out = new Float32Array(10);
  vm.runInContext('mixInto', ctx)(out, Float32Array.from([1, 2, 3, 4]), 8, 1);
  assert.deepEqual(Array.from(out), [3, 4, 0, 0, 0, 0, 0, 0, 1, 2]);
});

test('§ 5.3 — une retouche de recette ne relance pas le regroupement de la scène', () => {
  assert.ok(/!\(opts && opts\.assetOnly\) && typeof markBatchingDirty/.test(read('js/history.js')));
  assert.ok(!/pushHistory\(\);/.test(read('js/sound-rack.js')), 'le rack doit passer assetOnly partout');
});

test('§ 1.11 — le rack rend le focus clavier après reconstruction', () => {
  const rack = read('js/sound-rack.js');
  assert.ok(/rangFocus/.test(rack) && /target\.focus\(\{preventScroll: true\}\)/.test(rack));
});

test('§ 5.4 — api.expose ne cherche plus les objets par parcours linéaire à chaque image', () => {
  const rt = read('js/game-runtime.js');
  const corps = rt.slice(rt.indexOf('function rtValuesExposed'), rt.indexOf('function rtValuesExposed') + 1200);
  assert.ok(!/game\.objects\.find/.test(corps) && /rtObjectByName\(raw\)/.test(corps));
  assert.ok(/rtExposuresOf\(/.test(corps), 'l en-tête du script doit être mis en cache');
  const ed = read('js/scripts.js');
  const corpsEd = ed.slice(ed.indexOf('export function resolveValuesExposed'), ed.indexOf('export function resolveValuesExposed') + 900);
  assert.ok(!/objects\.find/.test(corpsEd) && /objectByName\(raw\)/.test(corpsEd));
  assert.ok(/this\._exposuresCode !== code/.test(read('js/components/component-script.js')));
});

test('§ 5.5 — la simulation et la lecture ne resynchronisent l inspecteur qu à 10 Hz', () => {
  assert.ok(/syncInspectorThrottled\(\);/.test(read('js/physics.js')));
  // `\r?\n` : ce dépôt se checkout en CRLF sous Windows (`core.autocrlf`), et un `\n` nu ne peut
  // alors JAMAIS correspondre. Ce test était rouge sur toute machine Windows et vert en CI — la
  // pire forme de rouge, celle qu'on apprend à ignorer, et qui masque les vraies régressions.
  assert.ok(/syncInspectorThrottled\(\);\r?\n\}/.test(read('js/animation.js')));
});

test('§ 5.9 — ouvrir un projet ne reconstruit pas le panneau Projet une fois par asset', () => {
  const ser = read('js/serialization.js');
  assert.ok((ser.match(/noRefresh:\s*true/g) || []).length >= 3, 'textures, sons et modèles');
});

test('§ 5.11 — seule la partie vivante des particules part au GPU, rien quand c est vide', () => {
  const src = read('js/particles.js');
  const bac = {};
  bac.globalThis = bac;
  const ctx = vm.createContext(bac);
  const debut = src.indexOf('export function markParticlesUploaded');
  const fin = src.indexOf('\n}', debut) + 2;
  vm.runInContext(deEsm(src.slice(debut, fin)), ctx);
  const mark = vm.runInContext('markParticlesUploaded', ctx);
  const attr = () => ({itemSize: 3, needsUpdate: false, plages: [],
    clearUpdateRanges(){ this.plages = []; }, addUpdateRange(s, c){ this.plages.push([s, c]); }});
  const sys = {nb: 0, geo: {attributes: {aPos: attr(), aSize: attr(), aOpacity: attr(), aColor: attr()}}};
  mark(sys);
  assert.equal(sys.geo.attributes.aPos.needsUpdate, false, 'système vide depuis toujours : rien à envoyer');
  sys.nb = 10;
  mark(sys);
  assert.equal(sys.geo.attributes.aPos.needsUpdate, true);
  assert.deepEqual(sys.geo.attributes.aPos.plages, [[0, 30]]);
});

test('§ 5.15 — fflate ne part plus dans le jeu publié', () => {
  assert.ok(!/vendor\/fflate\.js/.test(read('js/build.js').split('export const BUILD_MODULES')[1].split('];')[0]));
  assert.ok(!/fflate/.test(read('build-test/index.html')));
});
