// Outils MCP — retours du projet « Donjon » (BUGS_MOTEUR n° 16, 17, 21, 23) : auto-tuilage
// 8 voisins (47 tuiles), touches simulées de play_and_measure, consentement MCP partagé.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deEsm } from './engine-env.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');

function load(files, extra){
  const bac = Object.assign({console, Math, JSON, Set, Map, Array, Object, Number, String, isFinite, Promise}, extra || {});
  bac.window = bac; bac.globalThis = bac;
  const ctx = vm.createContext(bac);
  files.forEach(function(f){ vm.runInContext(deEsm(read(f)), ctx, {filename: f}); });
  return ctx;
}

function map(rows){
  const H = rows.length, L = rows[0].length;
  const cells = [];
  rows.forEach(function(r){ for(const c of r) cells.push(c === '#' ? 1 : 0); });
  return {width: L, height: H, cells: cells, cellSize: 1};
}

test('blob : 47 masques, case isolée = 0, case entourée = 46', function(){
  const ctx = load(['js/sprite-2d.js', 'js/tilemap.js']);
  const masks = vm.runInContext('BLOB_MASKS', ctx);
  assert.equal(masks.length, 47);
  assert.equal(masks[0], 0);
  assert.equal(masks[46], 255);
  const idx = vm.runInContext('indexBlobTile', ctx);
  assert.equal(idx(map(['...', '.#.', '...']), 1, 1), 0);
  assert.equal(idx(map(['###', '###', '###']), 1, 1), 46);
  assert.equal(idx(map(['...', '.#.', '...']), 0, 0), -1);
});

test('blob : un coin intérieur se distingue d\'une case pleine (impossible en 4 voisins)', function(){
  const ctx = load(['js/sprite-2d.js', 'js/tilemap.js']);
  const idx = vm.runInContext('indexBlobTile', ctx);
  const idx4 = vm.runInContext('indexAutoTile', ctx);
  const plein = map(['###', '###', '###']);
  const coin = map(['##.', '###', '###']);   // NE vide
  assert.equal(idx4(plein, 1, 1), idx4(coin, 1, 1), '4 voisins : même image');
  assert.notEqual(idx(plein, 1, 1), idx(coin, 1, 1), '8 voisins : images différentes');
  const masks = vm.runInContext('BLOB_MASKS', ctx);
  assert.equal(masks[idx(coin, 1, 1)], 255 - 2);
});

test('blob : un coin sans ses deux côtés ne compte pas', function(){
  const ctx = load(['js/sprite-2d.js', 'js/tilemap.js']);
  const idx = vm.runInContext('indexBlobTile', ctx);
  // NE plein mais E vide : même image que N seul.
  assert.equal(idx(map(['.##', '.#.', '...']), 1, 1), idx(map(['.#.', '.#.', '...']), 1, 1));
});

test('play_and_measure : plan de touches trié, relâché, et envoyé au bon instant', function(){
  const ctx = load(['js/copilot-observer.js'], {CopilotTools: {register: function(){}}});
  const plan = vm.runInContext('measureKeyPlan', ctx)([{key: 'ArrowRight', at: 0.5, duration: 1}, {key: ' ', at: 0.2}]);
  assert.deepEqual(JSON.parse(JSON.stringify(plan.map(function(e){ return [e.type, e.key, +e.t.toFixed(3)]; }))),
    [['keydown', ' ', 0.2], ['keyup', ' ', 0.3], ['keydown', 'ArrowRight', 0.5], ['keyup', 'ArrowRight', 1.5]]);
  const sent = [];
  class KE { constructor(type, o){ this.type = type; this.key = o.key; } }
  const win = {KeyboardEvent: KE, dispatchEvent: function(e){ sent.push(e.type + ':' + e.key); }};
  const send = vm.runInContext('sendKeyEvents', ctx);
  assert.equal(send(win, plan, 0.1), 0);
  assert.equal(send(win, plan, 0.6), 3);
  assert.equal(send(win, plan, 0.6), 0, 'un événement ne part qu\'une fois');
  send(win, plan, Infinity);
  assert.deepEqual(sent, ['keydown: ', 'keyup: ', 'keydown:ArrowRight', 'keyup:ArrowRight']);
  assert.throws(function(){ vm.runInContext('measureKeyPlan', ctx)([{at: 1}]); }, /key est requis/);
});

test('MCP : les appels arrivés pendant la question d\'autorisation attendent la même réponse', async function(){
  const ctx = load(['js/ai-rules.js', 'js/ai-guidelines.js', 'js/copilot-budget.js', 'js/mcp-link.js'], {logConsole: function(){}});
  const createMcpLink = vm.runInContext('createMcpLink', ctx);
  let asks = 0, answer;
  const runs = [];
  const sent = [];
  const link = createMcpLink({
    WebSocketCtor: function(){}, getCatalog: function(){ return []; },
    run: async function(n){ runs.push(n); return 'ok'; },
    confirm: function(){ asks++; return new Promise(function(r){ answer = r; }); }
  });
  link.ws = {readyState: 1, send: function(s){ sent.push(JSON.parse(s)); }};
  const a = link.handleCall({id: 1, name: 'create_object', input: {}});
  const b = link.handleCall({id: 2, name: 'set_parent', input: {}});
  await new Promise(function(r){ setTimeout(r, 0); });
  assert.equal(asks, 1, 'une seule question');
  answer(true);
  await Promise.all([a, b]);
  assert.deepEqual(runs, ['create_object', 'set_parent']);
  assert.ok(sent.every(function(m){ return !m.isError; }));
});
