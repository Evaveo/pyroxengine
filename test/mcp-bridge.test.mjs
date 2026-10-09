// Le pont MCP (outils/mcp-bridge/bridge.mjs) : JSON-RPC sur stdio, WebSocket écrit à la main,
// jeton, aller-retour d'un appel avec un faux éditeur, et l'outil editor_status sans éditeur.
// On lance le vrai processus et on lui parle comme le ferait un client MCP ; le « navigateur »
// est un client node:net qui fait la poignée de main et masque ses trames lui-même.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acceptKey, encodeText, encodeFrame, createFrameReader } from '../outils/mcp-bridge/bridge.mjs';

const BRIDGE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'outils', 'mcp-bridge', 'bridge.mjs');
const TOKEN = 'jeton-de-test';

function freePort(){
  return new Promise(function(resolve){
    const s = net.createServer().listen(0, '127.0.0.1', function(){
      const p = s.address().port; s.close(function(){ resolve(p); });
    });
  });
}

async function startBridge(extra = []){
  const port = await freePort();
  const child = spawn(process.execPath, [BRIDGE, '--port', String(port), ...extra],
    {env: {...process.env, MCP_BRIDGE_TOKEN: TOKEN, MCP_BRIDGE_USAGE_FILE: 'off'}, stdio: ['pipe', 'pipe', 'pipe']});
  const messages = [];
  const waiters = [];
  let buf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', function(c){
    buf += c;
    let i;
    while((i = buf.indexOf('\n')) !== -1){
      const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
      messages.push(m);
      waiters.slice().forEach(function(w){ if(w.pred(m)){ waiters.splice(waiters.indexOf(w), 1); w.resolve(m); } });
    }
  });
  let err = '';
  await new Promise(function(resolve){
    child.stderr.on('data', function(c){ err += c; if(err.includes('jeton')) resolve(); });
  });
  const wait = function(pred){
    const hit = messages.find(pred);
    if(hit){ messages.splice(messages.indexOf(hit), 1); return Promise.resolve(hit); }
    return new Promise(function(resolve){ waiters.push({pred: function(m){
      if(pred(m)){ messages.splice(messages.indexOf(m), 1); return true; } return false; }, resolve}); });
  };
  let nextId = 1;
  const rpc = function(method, params){
    const id = nextId++;
    child.stdin.write(JSON.stringify({jsonrpc: '2.0', id, method, params}) + '\n');
    return wait(function(m){ return m.id === id; });
  };
  const notify = function(method){ child.stdin.write(JSON.stringify({jsonrpc: '2.0', method}) + '\n'); };
  return {child, port, rpc, notify, wait, stderr: function(){ return err; },
    stop: function(){ child.kill(); }};
}

/** Faux éditeur : poignée de main RFC 6455 et trames masquées, à la main. */
function wsConnect(port){
  return new Promise(function(resolve, reject){
    const sock = net.connect(port, '127.0.0.1');
    const key = crypto.randomBytes(16).toString('base64');
    let head = Buffer.alloc(0);
    let upgraded = false;
    const inbox = [];
    const waiters = [];
    let closedCode = null;
    const push = function(m){
      const w = waiters.shift();
      if(w) w(m); else inbox.push(m);
    };
    const feed = createFrameReader({
      requireMask: false,
      onMessage: function(t){ push(JSON.parse(t)); },
      onClose: function(code){ closedCode = code; push({type: '__close', code}); },
      onPing: function(){}
    });
    sock.on('data', function(chunk){
      if(upgraded){ feed(chunk); return; }
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf('\r\n\r\n');
      if(end === -1) return;
      const text = head.subarray(0, end).toString();
      upgraded = true;
      if(!/^HTTP\/1\.1 101/.test(text)){ reject(new Error(text)); return; }
      const acc = /Sec-WebSocket-Accept: (.+)/i.exec(text)[1].trim();
      assert.equal(acc, acceptKey(key));
      const rest = head.subarray(end + 4);
      if(rest.length) feed(rest);
      resolve({
        send: function(obj){ sock.write(encodeText(JSON.stringify(obj), true)); },
        raw: function(b){ sock.write(b); },
        next: function(){ return inbox.length ? Promise.resolve(inbox.shift()) : new Promise(function(r){ waiters.push(r); }); },
        closedCode: function(){ return closedCode; },
        end: function(){ sock.end(); }
      });
    });
    sock.on('error', reject);
    sock.write('GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
      + 'Sec-WebSocket-Key: ' + key + '\r\nSec-WebSocket-Version: 13\r\n\r\n');
  });
}

const CATALOG = [
  {name: 'list_scene', description: 'liste', input_schema: {type: 'object', properties: {}}, domain: null},
  {name: 'load_tools', description: 'charge', input_schema: {type: 'object', properties: {domains: {type: 'array'}}}, domain: null},
  {name: 'capture_view', description: 'capture', input_schema: {type: 'object', properties: {}}, domain: 'render'}
];

test('trames : encodage/décodage, fragmentation d\'un grand message', function(){
  const big = 'x'.repeat(200000) + 'é';
  const got = [];
  const feed = createFrameReader({onMessage: function(t){ got.push(t); }});
  const bytes = encodeText(big, true);
  // livré en morceaux arbitraires
  for(let i = 0; i < bytes.length; i += 7777) feed(bytes.subarray(i, i + 7777));
  assert.deepEqual(got, [big]);
  // trame non masquée refusée côté serveur
  let err = null;
  createFrameReader({onMessage: function(){}, onError: function(c){ err = c; }})(encodeFrame(1, Buffer.from('a')));
  assert.equal(err, 1002);
});

test('initialize, ping, tools/list sans éditeur → editor_status', async function(){
  const b = await startBridge();
  try {
    const init = await b.rpc('initialize', {protocolVersion: '2025-03-26', capabilities: {}, clientInfo: {name: 't', version: '0'}});
    assert.equal(init.result.protocolVersion, '2025-03-26');
    assert.ok(init.result.capabilities.tools);
    // SANS éditeur connecté, les règles du moteur sont déjà là : c'est le cas réel au démarrage
    // d'un client MCP, et c'était celui où l'IA ne recevait rien d'utile.
    assert.match(init.result.instructions, /MÉTHODE — construis PAR ÉTAPES/);
    assert.match(init.result.instructions, /RÈGLE DES ASSETS/);
    assert.ok(init.result.capabilities.resources && init.result.capabilities.prompts);
    const init2 = await b.rpc('initialize', {protocolVersion: '1999-01-01'});
    assert.equal(init2.result.protocolVersion, '2025-06-18');
    b.notify('notifications/initialized');
    assert.deepEqual((await b.rpc('ping')).result, {});
    const list = await b.rpc('tools/list', {});
    assert.deepEqual(list.result.tools.map(function(t){ return t.name; }), ['editor_status']);
    const st = await b.rpc('tools/call', {name: 'editor_status', arguments: {}});
    assert.match(st.result.content[0].text, /Aucun éditeur/);
    const other = await b.rpc('tools/call', {name: 'list_scene', arguments: {}});
    assert.equal(other.result.isError, true);
    const unk = await b.rpc('nope', {});
    assert.equal(unk.error.code, -32601);
  } finally { b.stop(); }
});

test('jeton invalide : fermeture 4001', async function(){
  const b = await startBridge();
  try {
    const ws = await wsConnect(b.port);
    ws.send({type: 'hello', token: 'mauvais', catalog: CATALOG});
    const m = await ws.next();
    assert.equal(m.type, 'error');
    const c = await ws.next();
    assert.equal(c.code, 4001);
  } finally { b.stop(); }
});

test('aller-retour d\'un appel avec un faux éditeur, list_changed, image, un seul éditeur', async function(){
  const b = await startBridge();
  try {
    await b.rpc('initialize', {protocolVersion: '2025-06-18'});
    b.notify('notifications/initialized');
    const ws = await wsConnect(b.port);
    ws.send({type: 'hello', token: TOKEN, catalog: CATALOG, instructions: 'CONSIGNES DU COPILOTE'});
    assert.equal((await ws.next()).type, 'welcome');
    await b.wait(function(m){ return m.method === 'notifications/tools/list_changed'; });
    const list = await b.rpc('tools/list', {});
    assert.deepEqual(list.result.tools.map(function(t){ return t.name; }), ['list_scene', 'load_tools', 'capture_view']);
    assert.ok(list.result.tools[0].inputSchema);
    // Les instructions sont celles du MOTEUR, pas celles que l'éditeur envoie pour son copilote :
    // le client les a lues avant la connexion de l'éditeur, elles ne doivent pas en dépendre.
    const init = await b.rpc('initialize', {protocolVersion: '2025-06-18'});
    assert.match(init.result.instructions, /RÈGLE DES ASSETS/);
    assert.doesNotMatch(init.result.instructions, /CONSIGNES DU COPILOTE/);

    // second éditeur refusé
    const ws2 = await wsConnect(b.port);
    ws2.send({type: 'hello', token: TOKEN, catalog: []});
    assert.equal((await ws2.next()).type, 'error');
    assert.equal((await ws2.next()).code, 4002);

    const pending = b.rpc('tools/call', {name: 'capture_view', arguments: {w: 1}});
    const call = await ws.next();
    assert.equal(call.type, 'call');
    assert.equal(call.name, 'capture_view');
    assert.deepEqual(call.input, {w: 1});
    ws.send({type: 'result', id: call.id, text: 'vu', image: 'data:image/png;base64,QUJD', isError: false});
    const res = (await pending).result;
    assert.deepEqual(res.content, [{type: 'text', text: 'vu'}, {type: 'image', data: 'QUJD', mimeType: 'image/png'}]);
    assert.equal(res.isError, false);

    // ping WebSocket → pong (la connexion reste vivante)
    ws.raw(encodeFrame(0x9, Buffer.from('p'), true, true));
    const p2 = b.rpc('tools/call', {name: 'list_scene', arguments: {}});
    const c2 = await ws.next();
    ws.send({type: 'result', id: c2.id, text: 'boum', isError: true});
    assert.equal((await p2).result.isError, true);

    ws.end();
    await b.wait(function(m){ return m.method === 'notifications/tools/list_changed'; });
    const after = await b.rpc('tools/list', {});
    assert.deepEqual(after.result.tools.map(function(t){ return t.name; }), ['editor_status']);
  } finally { b.stop(); }
});

test('--core-only : seul le noyau, load_tools élargit la liste', async function(){
  const b = await startBridge(['--core-only']);
  try {
    await b.rpc('initialize', {protocolVersion: '2025-06-18'});
    b.notify('notifications/initialized');
    const ws = await wsConnect(b.port);
    ws.send({type: 'hello', token: TOKEN, catalog: CATALOG});
    await ws.next();
    const list = await b.rpc('tools/list', {});
    assert.deepEqual(list.result.tools.map(function(t){ return t.name; }), ['list_scene', 'load_tools']);
    const lt = await b.rpc('tools/call', {name: 'load_tools', arguments: {domains: ['render']}});
    assert.match(lt.result.content[0].text, /render/);
    await b.wait(function(m){ return m.method === 'notifications/tools/list_changed'; });
    const list2 = await b.rpc('tools/list', {});
    assert.ok(list2.result.tools.some(function(t){ return t.name === 'capture_view'; }));
    ws.end();
  } finally { b.stop(); }
});

test('ressources : guides sans éditeur, ressources vivantes relayées une fois connecté, usage compté', async function(){
  const b = await startBridge();
  try {
    await b.rpc('initialize', {protocolVersion: '2025-06-18'});
    b.notify('notifications/initialized');
    const r0 = await b.rpc('resources/list', {});
    const uris0 = r0.result.resources.map(function(r){ return r.uri; });
    assert.ok(uris0.includes('editeur3d://guide/methode'));
    assert.ok(uris0.includes('editeur3d://guide/scripts'));
    assert.ok(!uris0.some(function(u){ return u.startsWith('editeur3d://projet/'); }), 'pas de ressource vivante sans éditeur');
    const g = await b.rpc('resources/read', {uri: 'editeur3d://guide/methode'});
    assert.match(g.result.contents[0].text, /un script COURT par comportement/);
    const miss = await b.rpc('resources/read', {uri: 'editeur3d://guide/nope'});
    assert.equal(miss.error.code, -32002);

    const ws = await wsConnect(b.port);
    ws.send({type: 'hello', token: TOKEN, catalog: CATALOG.concat([{name: 'audit_project', input_schema: {type: 'object'}}])});
    await ws.next();
    await b.wait(function(m){ return m.method === 'notifications/resources/list_changed'; });
    const r1 = await b.rpc('resources/list', {});
    assert.ok(r1.result.resources.some(function(r){ return r.uri === 'editeur3d://projet/audit'; }));
    const pending = b.rpc('resources/read', {uri: 'editeur3d://projet/audit'});
    const call = await ws.next();
    assert.equal(call.name, 'audit_project');
    ws.send({type: 'result', id: call.id, text: 'Structure saine', isError: false});
    assert.match((await pending).result.contents[0].text, /Structure saine/);

    // outil inconnu : suggestion, sans appel à l'éditeur
    const typo = await b.rpc('tools/call', {name: 'list_scen', arguments: {}});
    assert.equal(typo.result.isError, true);
    assert.match(typo.result.content[0].text, /list_scene/);

    // échec d'un script refusé : la réponse dit quoi lire
    const p = b.rpc('tools/call', {name: 'list_scene', arguments: {}});
    const c = await ws.next();
    ws.send({type: 'result', id: c.id, text: 'script refusé — trop long', isError: true});
    const res = (await p).result;
    assert.ok(res.content.some(function(x){ return /guide\/scripts/.test(x.text); }));

    const u = JSON.parse((await b.rpc('resources/read', {uri: 'editeur3d://pont/usage'})).result.contents[0].text);
    const ls = u.tools.find(function(t){ return t.tool === 'list_scene'; });
    assert.equal(ls.calls, 1);
    assert.equal(ls.errors, 1);
    assert.ok(u.sequences.some(function(s){ return s.sequence === 'list_scen → list_scene'; }));
    ws.end();
  } finally { b.stop(); }
});

test('prompts : liste et rendu d\'une recette', async function(){
  const b = await startBridge();
  try {
    await b.rpc('initialize', {protocolVersion: '2025-06-18'});
    const l = await b.rpc('prompts/list', {});
    const names = l.result.prompts.map(function(p){ return p.name; });
    assert.ok(names.includes('nouveau_jeu') && names.includes('audit_projet'));
    const g = await b.rpc('prompts/get', {name: 'nouveau_jeu', arguments: {idee: 'un casse-briques', dimension: '2D'}});
    const text = g.result.messages[0].content.text;
    assert.match(text, /un casse-briques/);
    assert.match(text, /un script court par comportement/);
    assert.equal((await b.rpc('prompts/get', {name: 'nope'})).error.code, -32602);
  } finally { b.stop(); }
});
