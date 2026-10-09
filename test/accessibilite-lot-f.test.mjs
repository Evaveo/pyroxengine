// Lot F de la revue du 2026-09-29 (docs/REVUE_2026-09-29.md, § 4) : accessibilité et langue de
// l'interface. Une garde par correctif, pour qu'aucun ne se défasse en silence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');

test('§ 4.2 — plus de mots anglais échappés des renommages dans les textes affichés', () => {
  const html = read('editor.html');
  for (const faute of ['Filtrer par name', 'dont le name contient', 'au temps current', '>Physics</button>']) {
    assert.ok(!html.includes(faute), faute);
  }
  assert.ok(!/Exporter en folder/.test(read('js/ui.js')));
});

test('§ 4.2 — la façade du rack parle français', () => {
  const rack = read('js/sound-rack.js');
  for (const mot of ["'MUSIQUE'", "'EFFETS'", "'GÉNÉRAL'", "'MUET'", "'＋ NOUVEAU'", "'⌫ EFFACER'", "'▶ LECTURE'"]) {
    assert.ok(rack.includes(mot), mot);
  }
  assert.ok(!/'＋ NEW'|'⌫ CLEAR SONG'|'▶ START'/.test(rack));
});

test('§ 4.3 — les fenêtres modales sont des dialogues, et la barre d état est annoncée', () => {
  const html = read('editor.html');
  assert.ok(/role="dialog"/.test(html) && /aria-modal="true"/.test(html));
  assert.ok(/aria-live="polite"/.test(html));
});

test('§ 4.1 — une case de séquenceur ne se distingue plus par la seule opacité', () => {
  const css = read('css/panels.css');
  assert.ok(!/\.bx-cell\.is-on\{opacity/.test(css));
  assert.ok(/@container/.test(css), 'la grille se replie en panneau étroit');
});

test('§ 4.13 — l onglet Audio restauré n est pas vide après rechargement', () => {
  assert.ok(/\nbuildSoundRack\(\);/.test(read('js/sound-rack.js')));
  assert.ok(/refreshSoundRack\(\)/.test(read('js/project.js')));
});
