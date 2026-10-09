// moteur/test/ai-trace.test.mjs
//
// CHAQUE APPEL D'OUTIL LAISSE UNE LIGNE `[IA]` dans la console (js/ai-trace.js, branché dans
// `copRun`) : un appel réussi, un appel refusé, un avertissement ; les contenus longs (base64, code)
// sont tronqués ; le réglage `ia-trace` = '0' coupe la trace.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRACE_BATCH_MAX, formatTraceLine, resultHasWarning, summarizeParams, traceEnabled }
  from '../js/ai-trace.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('un appel réussi : coche, paramètres, durée, origine', () => {
  const l = formatTraceLine({name: 'import_model', args: {name: 'Renard', folder: 'Models/Persos'}, ms: 120.4, origin: 'MCP', status: 'ok'});
  assert.equal(l, '[IA] ✓ import_model {name:"Renard", folder:"Models/Persos"} — 120 ms (MCP)');
});

test('un refus porte son message ; un avertissement a sa propre marque', () => {
  const e = formatTraceLine({name: 'delete_asset', args: {name: 'X'}, ms: 3, origin: 'copilote', status: 'error', message: 'refusé : asset validé'});
  assert.match(e, /^\[IA\] ✗ delete_asset .* \(copilote\) — refusé : asset validé$/);
  assert.match(formatTraceLine({name: 'attach_script', args: {}, ms: 1, status: 'warn'}), /^\[IA\] ⚠ /);
  assert.ok(resultHasWarning('ok ⚠ règle assets.folder : …'));
  assert.ok(!resultHasWarning('ok'));
});

test('un base64, un code ou un HTML long sont tronqués avec leur taille', () => {
  const big = 'A'.repeat(12000);
  const s = summarizeParams({name: 'Tex', data: big, list: [1, 2, 3, 4, 5, 6, 7, 8]});
  assert.ok(s.length < 200, 'trop long : ' + s.length);
  assert.match(s, /…\(12 Ko\)/);
  assert.match(s, /list:\[8 élément\(s\)\]/);
  assert.ok(formatTraceLine({name: 'x', args: {a: 'B'.repeat(500), b: 'C'.repeat(500), c: 'D'.repeat(500), d: 'E'.repeat(500)}, ms: 1, status: 'ok'}).length < 400);
});

test('le réglage coupe la trace ; elle est active par défaut', () => {
  assert.equal(traceEnabled(null), true);
  assert.equal(traceEnabled({getItem: () => null}), true);
  assert.equal(traceEnabled({getItem: () => '0'}), false);
  assert.equal(traceEnabled({getItem: () => { throw new Error('bloqué'); }}), true);
});

test('copRun trace chaque appel, le batch se replie, le MCP est marqué', () => {
  const src = read('js/copilot.js');
  assert.match(src, /formatTraceLine\(\{name: name/, 'copRun doit tracer');
  assert.match(src, /origin: 'MCP'/);
  assert.match(src, /origin: 'batch', quiet: i >= TRACE_BATCH_MAX/);
  assert.equal(TRACE_BATCH_MAX, 20);
  assert.match(src, /id="cop-trace"/, 'le réglage doit être dans la configuration du copilote');
});
