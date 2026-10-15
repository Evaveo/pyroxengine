// Captures et vidéo de gameplay depuis « Jouer » (js/capture-tools.js, v1.16.0).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { captureFileName, coverCrop, videoFormats } from '../js/capture-tools.js';

test('recadrage 16:9 centré', () => {
  assert.deepEqual(coverCrop(2000, 1000, 16, 9), {x: 111, y: 0, w: 1778, h: 1000});
  assert.deepEqual(coverCrop(1000, 1000, 16, 9), {x: 0, y: 219, w: 1000, h: 563});
  assert.deepEqual(coverCrop(1920, 1080, 16, 9), {x: 0, y: 0, w: 1920, h: 1080});
});

test('nom de fichier sans accent ni caractère interdit', () => {
  const d = new Date(2026, 9, 15, 9, 5, 7);
  assert.equal(captureFileName('Diobla : Les Cryptes', 'capture', 'webp', d), 'diobla-les-cryptes-capture-20261015-090507.webp');
  assert.equal(captureFileName('', 'gameplay', 'webm', d), 'jeu-gameplay-20261015-090507.webm');
});

test('formats vidéo : WebM, plus MP4 si le navigateur sait', () => {
  assert.deepEqual(videoFormats((t) => t.startsWith('video/webm')).map((f) => f.ext), ['webm']);
  assert.deepEqual(videoFormats(() => true).map((f) => f.ext), ['webm', 'mp4']);
  assert.deepEqual(videoFormats(() => false), []);
});

test('chargé par « Jouer » seulement, avant le runtime, jamais par un build', () => {
  const page = readFileSync(new URL('../game-preview.html', import.meta.url), 'utf8');
  assert.ok(page.indexOf('js/capture-tools.js') !== -1 && page.indexOf('js/capture-tools.js') < page.indexOf('js/game-runtime.js'));
  const build = readFileSync(new URL('../js/build.js', import.meta.url), 'utf8');
  assert.equal(build.indexOf('capture-tools'), -1);
});
