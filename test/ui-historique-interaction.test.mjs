// UN INSTANTANÉ PAR INTERACTION, ET AUCUN INSTANTANÉ ÉTRANGER AU MILIEU.
//
// L'historique est par instantané COMPLET de la scène : il n'y a rien à « refermer ». Le
// mécanisme est donc un drapeau — un instantané pris avant la première mutation, réarmé au
// focus suivant. Deux sources poussent des instantanés sans rien savoir du formulaire : le
// gizmo (scene.js, `dragging-changed`) et le copilote (asynchrone, sur réponse réseau). Sans
// garde, un Ctrl+Z ramène un état à moitié tapé.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte } from './engine-env.mjs';

function neuf(){ return creerContexte(['js/history.js']); }

test('N mutations d une meme interaction ne font qu UN instantane', () => {
  const env = neuf();
  const avant = env.historyLength();
  env.beginInteraction('f-px');
  env.pushHistory();
  env.pushHistory();
  env.pushHistory();
  env.endInteraction();
  assert.equal(env.historyLength() - avant, 1);
});

test('une interaction refermee rearme : la suivante repousse', () => {
  const env = neuf();
  const avant = env.historyLength();
  env.beginInteraction('f-px'); env.pushHistory(); env.endInteraction();
  env.beginInteraction('f-px'); env.pushHistory(); env.endInteraction();
  assert.equal(env.historyLength() - avant, 2);
});

test('un instantane EXTERNE pendant une interaction est refuse', () => {
  const env = neuf();
  env.beginInteraction('f-px');
  env.pushHistory();
  const pendant = env.historyLength();
  env.pushHistory({ source: 'copilot' });
  assert.equal(env.historyLength(), pendant,
    'le copilote ne doit pas photographier un champ a moitie tape');
  env.endInteraction();
});

test('hors interaction, un instantane externe passe normalement', () => {
  const env = neuf();
  const avant = env.historyLength();
  env.pushHistory({ source: 'copilot' });
  assert.equal(env.historyLength() - avant, 1);
});

test('interactionOpen dit la verite', () => {
  const env = neuf();
  assert.equal(env.interactionOpen(), false);
  env.beginInteraction('f-px');
  assert.equal(env.interactionOpen(), true);
  env.endInteraction();
  assert.equal(env.interactionOpen(), false);
});
