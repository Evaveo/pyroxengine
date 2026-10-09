// UN ÉTAT NEUTRE NE DOIT PAS COÛTER UNE PASSE PLEIN ÉCRAN.
//
// Un profil peut overrider un effet en le laissant à sa valeur d'absence (bloom coché,
// intensité 0 ; gradation cochée, tout à 1). `blendPostVolumes` rend alors un état NON nul —
// il y a bien un override — et toute la chaîne (cible hors écran + composition) tournait à
// chaque image pour redonner exactement l'image d'entrée.
//
// Les deux moteurs doivent donc court-circuiter sur le MÊME critère : un correctif appliqué
// d'un seul côté ferait diverger le coût et, si le critère devenait faux, l'image elle-même.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

// extrait le corps d'une fonction nommée, accolades comptées
function bodyOf(src, signature, label){
  const start = src.indexOf(signature);
  assert.notEqual(start, -1, label + ' : ' + signature + ' introuvable');
  let depth = 0, i = src.indexOf('{', start);
  const from = i;
  for(; i < src.length; i++){
    if(src[i] === '{') depth++;
    else if(src[i] === '}' && --depth === 0) return src.slice(from, i + 1);
  }
  throw new Error(label + ' : accolades non refermées');
}

const noopEditor = bodyOf(read('js/postfx.js'), 'function postStateIsNoop(', 'éditeur');
const noopRuntime = bodyOf(read('js/game-runtime.js'), 'function rtPostStateIsNoop(', 'runtime');

const normalize = (s) => s.split('\n').map((l) => l.trim()).filter(Boolean).join('\n');

test('les deux moteurs jugent le neutre par le MÊME critère', () => {
  assert.equal(normalize(noopRuntime), normalize(noopEditor),
    'le critère « cet état ne change rien » a divergé entre l éditeur et le jeu publié');
});

// Le critère est EXÉCUTÉ, pas relu : c'est le corps réel du fichier de l'éditeur qui répond
// aux cas ci-dessous, et le test de parité ci-dessus étend le verdict au jeu publié.
const isNoop = new Function('return function(p)' + noopEditor + ';')();

const state = (over) => Object.assign({
  active: true, toneMapping: 'none', exposition: 1,
  bloom: false, bloomThreshold: 0.8, bloomIntensity: 0, bloomRadius: 1,
  contraste: 1, saturation: 1, temperature: 0, vignette: 0, grain: 0
}, over || {});

test('UN PROFIL QUI N ENLÈVE NI N AJOUTE RIEN est reconnu neutre', () => {
  assert.equal(isNoop(state()), true);
});

test('CHAQUE effet, seul, suffit à faire tourner la chaîne', () => {
  const cases = [
    ['bloom', {bloom: true, bloomIntensity: 0.7}],
    ['tone mapping', {toneMapping: 'aces'}],
    ['exposition', {exposition: 1.2}],
    ['contraste', {contraste: 1.1}],
    ['saturation', {saturation: 0.5}],
    ['température', {temperature: 0.3}],
    ['vignette', {vignette: 0.25}],
    ['grain', {grain: 0.1}]
  ];
  for(const [name, over] of cases){
    assert.equal(isNoop(state(over)), false, name + ' : sauté à tort, l effet ne s afficherait pas');
  }
});

test('UN BLOOM COCHÉ MAIS À ZÉRO ne justifie pas la chaîne', () => {
  assert.equal(isNoop(state({bloom: true, bloomIntensity: 0})), true);
});
