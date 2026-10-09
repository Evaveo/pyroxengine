// Le côté éditeur du pont MCP (js/mcp-link.js), avec un faux WebSocket : hello (jeton, catalogue
// annoté de ses domaines, consignes), consentement demandé au premier appel seulement, refus,
// erreur d'une commande, image transmise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deEsm } from './engine-env.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function load(){
  const ctx = vm.createContext({console, logConsole: function(){}});
  for(const f of ['js/ai-rules.js', 'js/ai-guidelines.js', 'js/copilot-budget.js', 'js/mcp-link.js']){
    vm.runInContext(deEsm(readFileSync(path.join(root, f), 'utf8')), ctx, {filename: f});
  }
  return vm.runInContext('({createMcpLink, MCP_CONSENT_QUESTION, cloudSocketUrl, cloudMcpSetup, createCloudRetry, nextCloudDelay, MCP_RELAY_MISSING})', ctx);
}

class FakeWS {
  constructor(url){ this.url = url; this.readyState = 1; this.sent = []; FakeWS.last = this; }
  send(s){ this.sent.push(JSON.parse(s)); }
  close(){ this.readyState = 3; if(this.onclose) this.onclose({}); }
  deliver(obj){ this.onmessage({data: JSON.stringify(obj)}); }
}

const tick = function(){ return new Promise(function(r){ setTimeout(r, 0); }); };

test('hello, consentement, résultats', async function(){
  const {createMcpLink, MCP_CONSENT_QUESTION} = load();
  const asked = [];
  let answer = false;
  const runs = [];
  const link = createMcpLink({
    WebSocketCtor: FakeWS,
    getCatalog: function(){ return [
      {name: 'list_scene', description: 'd', input_schema: {type: 'object'}},
      {name: 'capture_view', description: 'c', input_schema: {type: 'object'}}]; },
    run: async function(name, input){
      runs.push(name);
      if(name === 'boom') throw new Error('cassé');
      if(name === 'capture_view') return {text: 'vu', image: 'data:image/png;base64,AA'};
      return 'ok ' + JSON.stringify(input);
    },
    confirm: async function(q){ asked.push(q); return answer; },
    instructions: function(){ return 'CONSIGNES'; }
  });
  link.connect(9999, 'T');
  const ws = FakeWS.last;
  assert.equal(ws.url, 'ws://127.0.0.1:9999');
  ws.onopen();
  const hello = ws.sent[0];
  assert.equal(hello.type, 'hello');
  assert.equal(hello.token, 'T');
  assert.equal(hello.instructions, 'CONSIGNES');
  assert.equal(hello.catalog[0].domain, null);
  assert.equal(hello.catalog[1].domain, 'render');
  ws.deliver({type: 'welcome'});
  assert.equal(link.status, 'connecté');

  // refus : rien n'est exécuté, on redemandera
  ws.deliver({type: 'call', id: 1, name: 'list_scene', input: {}});
  await tick();
  assert.deepEqual(asked, [MCP_CONSENT_QUESTION]);
  assert.equal(runs.length, 0);
  assert.equal(ws.sent[1].isError, true);

  answer = true;
  ws.deliver({type: 'call', id: 2, name: 'list_scene', input: {a: 1}});
  await tick();
  assert.deepEqual(ws.sent[2], {type: 'result', id: 2, text: 'ok {"a":1}', isError: false});
  ws.deliver({type: 'call', id: 3, name: 'capture_view', input: {}});
  await tick();
  assert.equal(ws.sent[3].image, 'data:image/png;base64,AA');
  ws.deliver({type: 'call', id: 4, name: 'boom', input: {}});
  await tick();
  assert.equal(ws.sent[4].isError, true);
  assert.match(ws.sent[4].text, /cassé/);
  assert.equal(asked.length, 2, 'le consentement n\'est demandé qu\'une fois accordé');

  link.disconnect();
  assert.equal(link.status, 'déconnecté');
});

test('mode cloud : URL du relais, hello sans jeton, onglet remplacé', async function(){
  const {createMcpLink, cloudSocketUrl, cloudMcpSetup} = load();
  assert.equal(cloudSocketUrl({protocol: 'https:', host: 'app.exemple.fr'}), 'wss://app.exemple.fr/api/mcp/ws');
  assert.equal(cloudSocketUrl({protocol: 'http:', host: 'localhost:8080'}), 'ws://localhost:8080/api/mcp/ws');
  const s = cloudMcpSetup('https://app.exemple.fr/', 'e3d_X');
  assert.equal(s.url, 'https://app.exemple.fr/api/mcp/t/e3d_X');
  assert.equal(s.claude, s.url);
  assert.equal(s.claudeCode, 'claude mcp add --transport http editeur3d https://app.exemple.fr/api/mcp/t/e3d_X');
  assert.equal(s.stdio, 'npx -y mcp-remote https://app.exemple.fr/api/mcp/t/e3d_X');

  const statuses = [];
  const link = createMcpLink({
    WebSocketCtor: FakeWS,
    getCatalog: function(){ return [{name: 'list_scene', description: 'd', input_schema: {type: 'object'}}]; },
    run: async function(){ return 'ok'; },
    confirm: async function(){ return true; },
    instructions: 'C',
    onStatus: function(x){ statuses.push(x); }
  });
  link.connectUrl('wss://app.exemple.fr/api/mcp/ws');
  const ws = FakeWS.last;
  assert.equal(ws.url, 'wss://app.exemple.fr/api/mcp/ws');
  ws.onopen();
  assert.equal(ws.sent[0].type, 'hello');
  assert.equal('token' in ws.sent[0], false, 'la session du navigateur authentifie, pas de jeton');
  assert.equal(ws.sent[0].catalog[0].name, 'list_scene');
  ws.deliver({type: 'welcome', cloud: true});
  assert.equal(link.status, 'connecté');
  ws.deliver({type: 'call', id: 1, name: 'list_scene', input: {}});
  await tick();
  assert.deepEqual(ws.sent[1], {type: 'result', id: 1, text: 'ok', isError: false});
  ws.readyState = 3;
  ws.onclose({code: 4003});
  assert.match(link.status, /^refusé : remplacé/);
});
function fakeTimers(){
  const t = {pending: []};
  t.set = function(f, ms){ const h = {f: f, ms: ms}; t.pending.push(h); return h; };
  t.clear = function(h){ t.pending = t.pending.filter(function(x){ return x !== h; }); };
  t.fire = async function(){ const h = t.pending.shift(); await h.f(); };
  return t;
}

test('relais cloud : un 404 sur la sonde ARRÊTE les tentatives, sans boucle', async function(){
  const {createCloudRetry, MCP_RELAY_MISSING} = load();
  assert.match(MCP_RELAY_MISSING, /ne propose pas le relais MCP/);
  const t = fakeTimers();
  let connects = 0, missing = 0;
  const r = createCloudRetry({probe: async function(){ return 404; }, connect: function(){ connects++; },
    isBusy: function(){ return false; }, setTimer: t.set, clearTimer: t.clear,
    onMissing: function(){ missing++; }});
  await r.start();
  assert.equal(connects, 0, 'pas de WebSocket vers un relais absent');
  assert.equal(missing, 1);
  assert.equal(t.pending.length, 0, 'aucune nouvelle tentative programmée');
  assert.equal(r.stopped, true);
});

test('relais cloud : autres échecs → repli exponentiel 3 s → 30 s, remis à zéro après connexion', async function(){
  const {createCloudRetry, nextCloudDelay} = load();
  assert.equal(nextCloudDelay(0), 3000);
  assert.equal(nextCloudDelay(3000), 6000);
  assert.equal(nextCloudDelay(24000), 30000);
  assert.equal(nextCloudDelay(30000), 30000);
  const t = fakeTimers();
  let connects = 0;
  const r = createCloudRetry({probe: async function(){ return 0; }, connect: function(){ connects++; },
    isBusy: function(){ return false; }, setTimer: t.set, clearTimer: t.clear, onMissing: function(){}});
  await r.start();
  const delays = [t.pending[0].ms];
  for(let i = 0; i < 5; i++){ await t.fire(); delays.push(t.pending[0].ms); }
  assert.deepEqual(delays, [3000, 6000, 12000, 24000, 30000, 30000]);
  assert.equal(connects, 6);
  r.connected();
  r.disconnected();
  assert.equal(t.pending.length, 1);
  assert.equal(t.pending[0].ms, 3000, 'une coupure après connexion réessaie vite');
  r.stop();
  assert.equal(t.pending.length, 0);
});
