// Un jeu publié intégré dans une page (iframe du catalogue, itch.io…) ne reçoit aucune touche tant
// que son cadre n'a pas le focus, et un script qui fait preventDefault() sur mousedown empêche le
// clic de le lui donner. Mesuré (2026-09-28) : contrôles muets dans la page catalogue, alors que le
// même jeu marchait ouvert dans son propre onglet. Le runtime prend donc le focus lui-même.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../js/game-runtime.js', import.meta.url), 'utf8');

test('le runtime prend le focus au chargement', () => {
  assert.match(src, /try\{ window\.focus\(\); \}catch/);
});
test('le runtime reprend le focus à chaque pression, en phase de capture', () => {
  assert.match(src, /addEventListener\('pointerdown', function\(\)\{ try\{ window\.focus\(\); \}catch\(e\)\{[^}]*\} \}, true\);/);
});
