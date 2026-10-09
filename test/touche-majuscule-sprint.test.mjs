// moteur/test/touche-majuscule-sprint.test.mjs
//
// Garde-fou pour le bug mesuré sur jeux/NeonBreach le 2026-09-07 : en sprint (Maj tenu), changer
// de direction ne faisait plus RIEN — le personnage restait bloqué dans le dernier cap pressé
// avant le sprint. `KeyboardEvent.key` change de CASSE pour une lettre pressée pendant qu'un
// modificateur est actif ('d' devient 'D'), et une table d'actions configurée en minuscules
// seules ('right': ['d', 'a', 'ArrowRight']) ne reconnaît alors plus jamais la touche.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte } from './engine-env.mjs';

const env = creerContexte(['js/scripts.js']);

test('normalizeKey efface la casse SEULEMENT sur une lettre seule', () => {
  assert.equal(env.normalizeKey('D'), 'd', 'une lettre majuscule doit retomber en minuscule');
  assert.equal(env.normalizeKey('d'), 'd', 'une lettre déjà minuscule ne doit pas changer');
  assert.equal(env.normalizeKey('ArrowRight'), 'ArrowRight', 'une touche nommée reste intacte');
  assert.equal(env.normalizeKey('Shift'), 'Shift', 'un modificateur nommé reste intact');
  // AZERTY : le rang des chiffres change de CARACTÈRE (pas de casse) sous Maj — '&' et '1' sont
  // deux touches DISTINCTES pour le copilote de tir (pick1: ['1', '&']), pas une seule normalisée.
  assert.equal(env.normalizeKey('&'), '&', 'un symbole du rang des chiffres reste intact');
  assert.equal(env.normalizeKey('1'), '1', 'un chiffre reste intact');
});

test('presser D (Maj tenu) active la meme action que presser d', () => {
  env.keysGame.clear();
  env.keysGame.add(env.normalizeKey('D'));
  assert.ok(env.actionActive('right'),
    "'right' (['d', 'a', 'ArrowRight']) doit s'activer meme quand la touche arrive en majuscule");
});

test('changer de direction PENDANT le sprint (Maj tenu) fonctionne : gauche puis droite', () => {
  env.keysGame.clear();
  // 'q' (gauche) pressé, puis Maj (sprint) tenu : la touche déjà en bas ne change pas de casse.
  env.keysGame.add(env.normalizeKey('q'));
  env.keysGame.add(env.normalizeKey('Shift'));
  assert.ok(env.actionActive('left'), 'gauche doit être active avant le changement de direction');
  // On relâche 'q' et on presse 'd' : Maj est TOUJOURS tenu à cet instant, donc le navigateur
  // rend 'D' — c'est exactement le cas qui restait bloqué avant le correctif.
  env.keysGame.delete(env.normalizeKey('q'));
  env.keysGame.add(env.normalizeKey('D'));
  assert.ok(!env.actionActive('left'), 'gauche doit retomber');
  assert.ok(env.actionActive('right'),
    "droite doit s'activer meme si la touche arrive en 'D' pendant que Maj (sprint) est tenu");
});
