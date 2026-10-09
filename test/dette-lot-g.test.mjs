import { HELP_SCRIPTS, readHelpSource } from './help-env.mjs';
import { deEsm } from './engine-env.mjs';
// Lot G de la revue du 2026-09-29 (docs/REVUE_2026-09-29.md, § 6) : la dette. Une garde par
// correctif ; les mesures qui ne peuvent plus que baisser sont dans cliquets-dette.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');

test('§ 6.2 — plus de case « Recuire en lecture » qui ne fait rien', () => {
  assert.ok(!/bakeProbesAuto/.test(read('js/probes.js')));
  assert.ok(!/Recuire en lecture/.test(read('js/ui/panels-components.js')));
  assert.ok(!/Recuire en lecture/.test(readHelpSource()));
  // Le jeu, lui, recuit bien TOUTES ses sondes au lancement : c'est ce qui rend la case inutile.
  assert.ok(/Registry\.activeNodes\('Reflection'\)/.test(read('js/game-runtime.js')));
});

test('§ 6.18 — un palier de migration qui ne fait pas monter la version lève', () => {
  const src = read('js/project-folder.js');
  const debut = src.indexOf('export function applyStages');
  const fin = src.indexOf('\n}', debut) + 2;
  const bac = {Error};
  bac.globalThis = bac;
  const ctx = vm.createContext(bac);
  vm.runInContext(deEsm(src.slice(debut, fin)), ctx);
  const applyStages = vm.runInContext('applyStages', ctx);
  const ok = applyStages({version: 1}, {1: (d) => { d.version = 2; }, 2: (d) => { d.version = 3; }}, 3);
  assert.equal(ok.version, 3);
  assert.throws(() => applyStages({version: 1}, {1: () => {}}, 3), /version 1/);
  const ser = read('js/serialization.js');
  assert.ok(!/garde < 20/.test(ser) && /n\\'a pas fait monter la version/.test(ser));
});

test('§ 6.13 — le rack ne recopie plus readPath, et un booléen n est pas un volume de bus', () => {
  assert.ok(!/function readPath/.test(read('js/sound-rack.js')));
  assert.ok(/export function readPath/.test(read('js/chip-synth.js')));
  assert.ok(/typeof v === 'boolean'/.test(read('js/audio-bus.js')));
});

test('§ 6.14 — la description de LOOP_RECIPE_SCHEMA cite toutes les valeurs de music-loop', () => {
  const bac = {Math, Float32Array, Number, String, Object, Array, isFinite, JSON};
  bac.globalThis = bac;
  const ctx = vm.createContext(bac);
  vm.runInContext(deEsm(read('js/music-loop.js')), ctx);
  const ws = read('js/copilot-workshop.js');
  const debut = ws.indexOf('const LOOP_RECIPE_SCHEMA');
  const schema = ws.slice(debut, ws.indexOf('};', debut));
  const listes = vm.runInContext('({SCALE_NAMES, DRUM_VOICES, CHORD_STYLES, INSTRUMENT_NAMES})', ctx);
  for (const [nom, valeurs] of Object.entries(listes)) {
    for (const v of valeurs) assert.ok(new RegExp('\\b' + v + '\\b').test(schema), nom + ' : « ' + v + ' » absent du schéma');
  }
  const presets = vm.runInContext('LOOP_PRESET_NAMES', ctx);
  const enumPresets = ws.match(/preset: \{type: 'string', enum: \['pop'[^\]]*\]/g);
  assert.ok(enumPresets && enumPresets.length >= 1);
  for (const e of enumPresets) assert.deepEqual(JSON.parse(e.slice(e.indexOf('[')).replace(/'/g, '"') ), [...presets]);
});
