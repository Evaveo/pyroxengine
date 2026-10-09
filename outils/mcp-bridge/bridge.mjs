#!/usr/bin/env node
// moteur/outils/mcp-bridge/bridge.mjs
//
// PONT MCP — laisse une IA locale (Claude Desktop, Claude Code, LM Studio, tout client MCP)
// piloter l'éditeur ouvert dans un onglet du navigateur.
//
//   client MCP  ──stdio (JSON-RPC 2.0, une ligne par message)──▶  bridge.mjs
//   bridge.mjs  ◀──WebSocket 127.0.0.1:8765 (jeton obligatoire)──  onglet de l'éditeur (js/mcp-link.js)
//
// Zéro dépendance : Node >= 18, `node:http` + `node:crypto` suffisent. Le WebSocket est écrit à la
// main (RFC 6455 : poignée de main, trames texte, masque, ping/pong, fermeture, fragmentation) —
// on n'en utilise qu'une toute petite partie, et une dépendance npm pour ça serait un poids de trop
// dans un moteur destiné à l'open source.
//
// Sécurité : écoute sur 127.0.0.1 seulement ; un jeton aléatoire est tiré au démarrage et affiché
// sur stderr — l'éditeur doit l'envoyer dans son premier message. Une seule connexion éditeur.
//
// Options : --port N (ou MCP_BRIDGE_PORT), --token T (ou MCP_BRIDGE_TOKEN, sinon aléatoire),
//           --core-only (n'expose que le noyau + load_tools, pour les petits modèles).

import http from 'node:http';
import crypto from 'node:crypto';
// Le savoir-faire du moteur (règles, guides, recettes) : le MÊME texte que le copilote intégré.
// Importé ici, et non reçu de l'éditeur, parce que le client MCP lit les instructions au
// `initialize` — avant que l'éditeur ne soit connecté (voir l'en-tête de js/ai-guidelines.js).
import { knowledgePayload, renderRecipe } from '../../js/ai-guidelines.js';

// ---------- Options ----------

export function parseArgs(argv, env){
  const opts = {
    port: Number(env.MCP_BRIDGE_PORT) || 8765,
    token: env.MCP_BRIDGE_TOKEN || '',
    coreOnly: env.MCP_BRIDGE_CORE_ONLY === '1',
    callTimeoutMs: Number(env.MCP_BRIDGE_TIMEOUT_MS) || 120000
  };
  for(let i = 0; i < argv.length; i++){
    const a = argv[i];
    if(a === '--port') opts.port = Number(argv[++i]);
    else if(a.startsWith('--port=')) opts.port = Number(a.slice(7));
    else if(a === '--token') opts.token = argv[++i];
    else if(a.startsWith('--token=')) opts.token = a.slice(8);
    else if(a === '--core-only') opts.coreOnly = true;
  }
  if(!opts.token) opts.token = crypto.randomBytes(18).toString('base64url');
  return opts;
}

// ---------- WebSocket (RFC 6455, côté serveur) ----------

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAGMENT = 64 * 1024;
const MAX_MESSAGE = 64 * 1024 * 1024;

export function acceptKey(key){
  return crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
}

/** Une trame serveur (jamais masquée). */
export function encodeFrame(opcode, payload, fin = true, mask = false){
  const len = payload.length;
  let head;
  if(len < 126){ head = Buffer.alloc(2); head[1] = len; }
  else if(len < 65536){ head = Buffer.alloc(4); head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  head[0] = (fin ? 0x80 : 0) | opcode;
  if(!mask) return Buffer.concat([head, payload]);
  head[1] |= 0x80;
  const key = crypto.randomBytes(4);
  const body = Buffer.from(payload);
  for(let i = 0; i < body.length; i++) body[i] ^= key[i & 3];
  return Buffer.concat([head, key, body]);
}

/** Découpe un message texte en fragments (opcode 1 puis 0 de continuation). */
export function encodeText(str, mask = false){
  const buf = Buffer.from(str, 'utf8');
  if(buf.length <= MAX_FRAGMENT) return encodeFrame(1, buf, true, mask);
  const parts = [];
  for(let off = 0; off < buf.length; off += MAX_FRAGMENT){
    const last = off + MAX_FRAGMENT >= buf.length;
    parts.push(encodeFrame(off === 0 ? 1 : 0, buf.subarray(off, off + MAX_FRAGMENT), last, mask));
  }
  return Buffer.concat(parts);
}

/**
 * Lecteur de trames incrémental. `onMessage(text)`, `onClose(code)`, `onPing(payload)`.
 * `requireMask` : un client DOIT masquer (RFC 6455 § 5.1) — sinon on ferme en 1002.
 */
export function createFrameReader({onMessage, onClose, onPing, onError, requireMask = true}){
  let buf = Buffer.alloc(0);
  let fragments = null;
  let fragSize = 0;
  return function feed(chunk){
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    for(;;){
      if(buf.length < 2) return;
      const fin = (buf[0] & 0x80) !== 0;
      const opcode = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f;
      let off = 2;
      if(len === 126){ if(buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if(len === 127){
        if(buf.length < 10) return;
        const big = buf.readBigUInt64BE(2);
        if(big > BigInt(MAX_MESSAGE)){ onError && onError(1009, 'trame trop grande'); return; }
        len = Number(big); off = 10;
      }
      if(requireMask && !masked){ onError && onError(1002, 'trame client non masquée'); return; }
      const keyOff = off;
      if(masked) off += 4;
      if(buf.length < off + len) return;
      const payload = Buffer.from(buf.subarray(off, off + len));
      if(masked){ for(let i = 0; i < len; i++) payload[i] ^= buf[keyOff + (i & 3)]; }
      buf = buf.subarray(off + len);
      if(opcode === 0x8){ onClose && onClose(payload.length >= 2 ? payload.readUInt16BE(0) : 1005); return; }
      if(opcode === 0x9){ onPing && onPing(payload); continue; }
      if(opcode === 0xA) continue;
      if(opcode === 0x1 || opcode === 0x2){
        if(fin){ if(opcode === 0x1) onMessage(payload.toString('utf8')); }
        else { fragments = [payload]; fragSize = len; }
        continue;
      }
      if(opcode === 0x0 && fragments){
        fragments.push(payload); fragSize += len;
        if(fragSize > MAX_MESSAGE){ onError && onError(1009, 'message trop grand'); return; }
        if(fin){ const all = Buffer.concat(fragments); fragments = null; onMessage(all.toString('utf8')); }
        continue;
      }
      onError && onError(1002, 'opcode inattendu ' + opcode);
      return;
    }
  };
}

function closeFrame(code, reason){
  const r = Buffer.from(reason || '', 'utf8').subarray(0, 120);
  const p = Buffer.alloc(2 + r.length);
  p.writeUInt16BE(code, 0); r.copy(p, 2);
  return encodeFrame(0x8, p);
}

// ---------- Le pont ----------

const KNOWN_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
export const USAGE_URI = 'editeur3d://pont/usage';

// ---------- Savoir-faire : ressources et prompts ----------
//
// PUR, et écrit sur la forme JSON de knowledgePayload() : c'est aussi la forme que l'éditeur
// envoie au relais cloud, qui en garde sa propre copie de ces quelques lignes.

/** resources/list : guides toujours ; ressources vivantes seulement si un éditeur répond. */
export function listResources(k, editorConnected){
  const out = k.guides.map(function(g){
    return {uri: 'editeur3d://guide/' + g.id, name: g.id, title: g.title, description: g.description,
      mimeType: 'text/markdown'};
  });
  if(editorConnected){
    k.live.forEach(function(r){
      out.push({uri: 'editeur3d://projet/' + r.id, name: r.id, title: r.title, description: r.description,
        mimeType: 'text/plain'});
    });
  }
  out.push({uri: USAGE_URI, name: 'usage', title: 'Usage des outils',
    description: 'Nombre d\'appels et d\'échecs par outil depuis le démarrage du pont.', mimeType: 'application/json'});
  return out;
}

/** Une ressource statique `{text, mimeType}`, ou `{live: tool}` à lire dans l'éditeur, ou null. */
export function findResource(k, uri){
  const u = String(uri || '');
  let m = /^editeur3d:\/\/guide\/([\w-]+)$/.exec(u);
  if(m){
    const g = k.guides.find(function(x){ return x.id === m[1]; });
    return g ? {text: g.text, mimeType: 'text/markdown'} : null;
  }
  m = /^editeur3d:\/\/projet\/([\w-]+)$/.exec(u);
  if(m){
    const r = k.live.find(function(x){ return x.id === m[1]; });
    return r ? {live: r.tool} : null;
  }
  return null;
}

export function listPrompts(k){
  return k.prompts.map(function(p){
    return {name: p.name, title: p.title, description: p.description, arguments: p.arguments};
  });
}

export function getPrompt(k, name, args){
  const p = k.prompts.find(function(x){ return x.name === name; });
  if(!p) return null;
  return {description: p.description,
    messages: [{role: 'user', content: {type: 'text', text: renderRecipe(p, args)}}]};
}

// Distance d'édition : assez pour « create_objet » → create_object.
function editDistance(a, b){
  const d = [];
  for(let i = 0; i <= a.length; i++) d[i] = [i];
  for(let j = 1; j <= b.length; j++) d[0][j] = j;
  for(let i = 1; i <= a.length; i++){
    for(let j = 1; j <= b.length; j++){
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

/** Les noms d'outils les plus proches d'un nom inconnu (3 au plus). */
export function suggestTools(name, names){
  const n = String(name || '').toLowerCase();
  return names.map(function(t){
    const lt = t.toLowerCase();
    const score = (lt.indexOf(n) !== -1 || n.indexOf(lt) !== -1) ? 0 : editDistance(n, lt);
    return {t, score};
  }).filter(function(x){ return x.score <= Math.max(3, Math.floor(n.length / 3)); })
    .sort(function(a, b){ return a.score - b.score; }).slice(0, 3).map(function(x){ return x.t; });
}

// Un échec qui dit QUOI FAIRE ensuite évite un tour d'essai-erreur.
const ERROR_HINTS = [
  {re: /script refusé|lignes \(maximum/i, hint: 'Voir les ressources editeur3d://guide/scripts et editeur3d://guide/methode.'},
  {re: /introuvable/i, hint: 'list_scene, find_objects ou list_assets donnent les noms exacts.'}
];

/** Le rapport d'usage trié : outils les plus appelés, enchaînements les plus fréquents. */
export function usageReport(usage){
  const tools = Object.keys(usage.tools).map(function(n){ return Object.assign({tool: n}, usage.tools[n]); })
    .sort(function(a, b){ return b.calls - a.calls; });
  const sequences = Object.keys(usage.sequences).map(function(k){ return {sequence: k, count: usage.sequences[k]}; })
    .sort(function(a, b){ return b.count - a.count; }).slice(0, 30);
  return {tools, sequences};
}

export function errorHint(text){
  const h = ERROR_HINTS.find(function(x){ return x.re.test(String(text || '')); });
  return h ? h.hint : '';
}

export function createBridge(opts, io){
  const log = io.log || function(){};
  const state = {
    editor: null,          // {socket, send(obj)}
    catalog: [],           // [{name, description, input_schema, domain}]
    instructions: '',
    loadedDomains: [],
    pending: new Map(),    // id -> {resolve, timer}
    nextId: 1,
    initialized: false,
    knowledge: knowledgePayload(),
    // Compteurs d'usage : quels outils, quels échecs, et quels ENCHAÎNEMENTS (a → b) reviennent.
    // C'est ce qui dit quel outil composé ajouter au moteur (comme build_room), plutôt que de le
    // deviner. Cumulés d'une session à l'autre par main() (fichier d'usage).
    usage: (opts.usage && opts.usage.tools) ? opts.usage : {tools: {}, sequences: {}},
    lastTool: null
  };

  function countCall(name, isError){
    const tools = state.usage.tools, seqs = state.usage.sequences;
    const u = tools[name] || (tools[name] = {calls: 0, errors: 0});
    u.calls++;
    if(isError) u.errors++;
    if(state.lastTool && state.lastTool !== name){
      const k = state.lastTool + ' → ' + name;
      seqs[k] = (seqs[k] || 0) + 1;
    }
    state.lastTool = name;
    if(io.onUsage) io.onUsage(state.usage);
  }

  function statusText(){
    return 'Aucun éditeur connecté au pont MCP.\n'
      + 'Pour le connecter : ouvrez l\'éditeur dans le navigateur, ouvrez le Copilote IA, cliquez '
      + 'sur ⚙, section « Pilotage par une IA locale (MCP) », saisissez le port ' + opts.port
      + ' et le jeton affiché par le pont au démarrage (sortie d\'erreur du processus), puis '
      + 'cliquez « Connecter ». La liste des outils se mettra à jour automatiquement.';
  }

  function visibleTools(){
    if(!state.editor){
      return [{name: 'editor_status',
        description: 'Indique si un éditeur est connecté au pont et comment le connecter.',
        inputSchema: {type: 'object', properties: {}}}];
    }
    let list = state.catalog;
    if(opts.coreOnly){
      list = list.filter(function(t){
        return !t.domain || state.loadedDomains.indexOf(t.domain) !== -1;
      });
    }
    return list.map(function(t){
      return {name: t.name, description: t.description || '',
        inputSchema: t.input_schema || {type: 'object', properties: {}}};
    });
  }

  function notifyToolsChanged(){
    if(!state.initialized) return;
    io.send({jsonrpc: '2.0', method: 'notifications/tools/list_changed'});
    // Les ressources vivantes (editeur3d://projet/…) n'existent qu'éditeur connecté.
    io.send({jsonrpc: '2.0', method: 'notifications/resources/list_changed'});
  }

  function toContent(r){
    const content = [];
    if(r.text !== undefined && r.text !== null && r.text !== '') content.push({type: 'text', text: String(r.text)});
    if(r.image){
      const s = String(r.image);
      const m = /^data:([^;,]+)?(?:;base64)?,/.exec(s);
      content.push({type: 'image', data: m ? s.slice(m[0].length) : s,
        mimeType: (m && m[1]) || 'image/png'});
    }
    if(!content.length) content.push({type: 'text', text: '(aucun résultat)'});
    return {content, isError: !!r.isError};
  }

  function callEditor(name, input){
    return new Promise(function(resolve){
      if(!state.editor){ resolve({content: [{type: 'text', text: statusText()}], isError: true}); return; }
      const id = state.nextId++;
      const timer = setTimeout(function(){
        state.pending.delete(id);
        resolve({content: [{type: 'text', text: 'Délai dépassé (' + Math.round(opts.callTimeoutMs / 1000)
          + ' s) : l\'éditeur n\'a pas répondu à ' + name + '.'}], isError: true});
      }, opts.callTimeoutMs);
      state.pending.set(id, {resolve: function(r){ clearTimeout(timer); resolve(toContent(r)); }});
      state.editor.send({type: 'call', id, name, input: input || {}});
    });
  }

  async function callTool(name, input){
    if(name === 'editor_status'){
      if(!state.editor) return {content: [{type: 'text', text: statusText()}]};
      return {content: [{type: 'text', text: 'Éditeur connecté, ' + state.catalog.length + ' outils disponibles.'}]};
    }
    // En --core-only, load_tools est traité ICI : c'est la liste exposée par le pont qui doit
    // s'élargir, pas celle de la conversation du copilote intégré.
    if(opts.coreOnly && name === 'load_tools' && state.editor){
      const doms = Array.isArray(input && input.domains) ? input.domains : [];
      const known = new Set(state.catalog.map(function(t){ return t.domain; }).filter(Boolean));
      const added = [], unknown = [];
      for(const d of doms){
        if(!known.has(d)) unknown.push(d);
        else if(state.loadedDomains.indexOf(d) === -1){ state.loadedDomains.push(d); added.push(d); }
      }
      if(added.length) notifyToolsChanged();
      return {content: [{type: 'text', text: (added.length ? 'Domaines chargés : ' + added.join(', ') + '. ' : 'Aucun domaine ajouté. ')
        + (unknown.length ? 'Inconnus : ' + unknown.join(', ') + '. ' : '')
        + 'Relisez la liste des outils.'}]};
    }
    if(!state.editor) return {content: [{type: 'text', text: statusText()}], isError: true};
    if(!state.catalog.some(function(t){ return t.name === name; })){
      const near = suggestTools(name, state.catalog.map(function(t){ return t.name; }));
      const hidden = near.filter(function(n){ return visibleTools().every(function(t){ return t.name !== n; }); });
      return {content: [{type: 'text', text: 'Outil inconnu : ' + name + '.'
        + (near.length ? ' Vouliez-vous dire : ' + near.join(', ') + ' ?' : '')
        + (hidden.length ? ' (' + hidden.join(', ') + ' : domaine à charger avec load_tools)' : '')}], isError: true};
    }
    const res = await callEditor(name, input);
    if(res.isError){
      const hint = errorHint(res.content.map(function(c){ return c.text || ''; }).join(' '));
      if(hint) res.content.push({type: 'text', text: hint});
    }
    return res;
  }

  async function readResource(uri){
    if(uri === USAGE_URI){
      return {contents: [{uri, mimeType: 'application/json', text: JSON.stringify(usageReport(state.usage), null, 1)}]};
    }
    const r = findResource(state.knowledge, uri);
    if(!r) return null;
    if(r.live){
      if(!state.editor) return {contents: [{uri, mimeType: 'text/plain', text: statusText()}]};
      const res = await callEditor(r.live, {});
      return {contents: [{uri, mimeType: 'text/plain',
        text: res.content.map(function(c){ return c.text || ''; }).join('\n')}]};
    }
    return {contents: [{uri, mimeType: r.mimeType, text: r.text}]};
  }

  function reply(id, result){ io.send({jsonrpc: '2.0', id, result}); }
  function fail(id, code, message){ io.send({jsonrpc: '2.0', id, error: {code, message}}); }

  async function handleRpc(msg){
    if(!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string'){
      if(msg && msg.id !== undefined && msg.method === undefined) return; // réponse à nous : ignorée
      fail(msg && msg.id !== undefined ? msg.id : null, -32600, 'Invalid Request');
      return;
    }
    const isNotif = msg.id === undefined;
    const p = msg.params || {};
    switch(msg.method){
      case 'initialize': {
        const asked = p.protocolVersion;
        reply(msg.id, {
          protocolVersion: KNOWN_VERSIONS.indexOf(asked) !== -1 ? asked : KNOWN_VERSIONS[0],
          capabilities: {tools: {listChanged: true}, resources: {listChanged: true}, prompts: {listChanged: false}},
          serverInfo: {name: 'editeur3d-mcp-bridge', version: '1.1.0'},
          // Toujours les règles du MOTEUR, éditeur connecté ou non : c'est le seul moment où le
          // client les lit. Les instructions du copilote intégré (state.instructions) parlent à
          // un autre lecteur (« réponds en deux phrases ») et ne les remplacent pas.
          instructions: state.knowledge.instructions
        });
        return;
      }
      case 'notifications/initialized': state.initialized = true; return;
      case 'ping': if(!isNotif) reply(msg.id, {}); return;
      case 'tools/list': reply(msg.id, {tools: visibleTools()}); return;
      case 'tools/call': {
        if(typeof p.name !== 'string'){ fail(msg.id, -32602, 'params.name manquant'); return; }
        const res = await callTool(p.name, p.arguments || {});
        countCall(p.name, !!res.isError);
        reply(msg.id, res);
        return;
      }
      case 'resources/list': reply(msg.id, {resources: listResources(state.knowledge, !!state.editor)}); return;
      case 'resources/templates/list': reply(msg.id, {resourceTemplates: []}); return;
      case 'resources/read': {
        const r = await readResource(p.uri);
        if(!r){ fail(msg.id, -32002, 'Resource not found: ' + p.uri); return; }
        reply(msg.id, r);
        return;
      }
      case 'prompts/list': reply(msg.id, {prompts: listPrompts(state.knowledge)}); return;
      case 'prompts/get': {
        const r = getPrompt(state.knowledge, p.name, p.arguments);
        if(!r){ fail(msg.id, -32602, 'Prompt inconnu : ' + p.name); return; }
        reply(msg.id, r);
        return;
      }
      default:
        if(msg.method.startsWith('notifications/')) return;
        if(!isNotif) fail(msg.id, -32601, 'Method not found: ' + msg.method);
    }
  }

  function handleLine(line){
    line = line.trim();
    if(!line) return;
    let msg;
    try { msg = JSON.parse(line); } catch(e){ fail(null, -32700, 'Parse error'); return; }
    if(Array.isArray(msg)){ msg.forEach(function(m){ handleRpc(m); }); return; }
    handleRpc(msg);
  }

  // --- côté éditeur ---
  function onEditorMessage(conn, text){
    let m;
    try { m = JSON.parse(text); } catch(e){ return; }
    if(!conn.authed){
      if(!m || m.type !== 'hello' || typeof m.token !== 'string' || !safeEqual(m.token, opts.token)){
        conn.send({type: 'error', message: 'jeton invalide'});
        conn.close(4001, 'jeton invalide');
        return;
      }
      if(state.editor){
        conn.send({type: 'error', message: 'un éditeur est déjà connecté'});
        conn.close(4002, 'déjà connecté');
        return;
      }
      conn.authed = true;
      state.editor = conn;
      setCatalog(m.catalog, m.instructions);
      conn.send({type: 'welcome', coreOnly: !!opts.coreOnly});
      log('éditeur connecté (' + state.catalog.length + ' outils)');
      notifyToolsChanged();
      return;
    }
    if(m.type === 'result' && state.pending.has(m.id)){
      const p = state.pending.get(m.id);
      state.pending.delete(m.id);
      p.resolve(m);
    } else if(m.type === 'catalog'){
      setCatalog(m.catalog, m.instructions);
      notifyToolsChanged();
    }
  }

  function setCatalog(catalog, instructions){
    state.catalog = Array.isArray(catalog) ? catalog.filter(function(t){ return t && typeof t.name === 'string'; }) : [];
    if(typeof instructions === 'string') state.instructions = instructions;
  }

  function onEditorClose(conn){
    if(state.editor !== conn) return;
    state.editor = null;
    state.catalog = [];
    state.loadedDomains = [];
    for(const [, p] of state.pending) p.resolve({text: 'L\'éditeur s\'est déconnecté pendant l\'appel.', isError: true});
    state.pending.clear();
    log('éditeur déconnecté');
    notifyToolsChanged();
  }

  return {handleLine, onEditorMessage, onEditorClose, state};
}

function safeEqual(a, b){
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Serveur WebSocket sur 127.0.0.1. Rend une promesse du serveur http une fois à l'écoute. */
export function startWsServer(bridge, opts, log){
  const server = http.createServer(function(req, res){
    res.writeHead(426, {'Content-Type': 'text/plain; charset=utf-8'});
    res.end('Pont MCP de l\'éditeur : connexion WebSocket attendue.\n');
  });
  server.on('upgrade', function(req, socket){
    const key = req.headers['sec-websocket-key'];
    if(req.method !== 'GET' || String(req.headers.upgrade || '').toLowerCase() !== 'websocket'
      || !key || req.headers['sec-websocket-version'] !== '13'){
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      return;
    }
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
      + 'Sec-WebSocket-Accept: ' + acceptKey(key) + '\r\n\r\n');
    socket.setNoDelay(true);
    let closed = false;
    const conn = {
      authed: false,
      send(obj){ if(!closed) socket.write(encodeText(JSON.stringify(obj))); },
      close(code, reason){
        if(closed) return;
        closed = true;
        try { socket.write(closeFrame(code || 1000, reason)); } catch(e){}
        socket.end();
        bridge.onEditorClose(conn);
      }
    };
    const feed = createFrameReader({
      onMessage: function(t){ bridge.onEditorMessage(conn, t); },
      onPing: function(p){ if(!closed) socket.write(encodeFrame(0xA, p)); },
      onClose: function(){ conn.close(1000, ''); },
      onError: function(code, why){ conn.close(code, why); }
    });
    socket.on('data', feed);
    socket.on('end', function(){ conn.close(1000, ''); });
    socket.on('close', function(){ closed = true; bridge.onEditorClose(conn); });
    socket.on('error', function(){});
    // L'éditeur a 10 s pour s'annoncer.
    setTimeout(function(){ if(!conn.authed) conn.close(4001, 'hello attendu'); }, 10000).unref();
  });
  return new Promise(function(resolve, reject){
    server.once('error', reject);
    server.listen(opts.port, '127.0.0.1', function(){ resolve(server); });
  });
}

// ---------- Point d'entrée ----------

async function main(){
  const opts = parseArgs(process.argv.slice(2), process.env);
  const log = function(s){ process.stderr.write('[pont MCP] ' + s + '\n'); };
  // Usage cumulé hors du dépôt (dossier temporaire), sauf MCP_BRIDGE_USAGE_FILE ; « off » le coupe.
  const fs = await import('node:fs');
  const usageFile = process.env.MCP_BRIDGE_USAGE_FILE
    || (await import('node:path')).join((await import('node:os')).tmpdir(), 'editeur3d-mcp-usage.json');
  if(usageFile !== 'off'){
    try { opts.usage = JSON.parse(fs.readFileSync(usageFile, 'utf8')); } catch(e){ /* premier lancement */ }
  }
  let saveTimer = null;
  const bridge = createBridge(opts, {
    send: function(obj){ process.stdout.write(JSON.stringify(obj) + '\n'); },
    log,
    onUsage: usageFile === 'off' ? null : function(u){
      clearTimeout(saveTimer);
      saveTimer = setTimeout(function(){
        fs.writeFile(usageFile, JSON.stringify(u), function(err){ if(err) log('usage non enregistré : ' + err.message); });
      }, 1000);
    }
  });
  log('usage des outils : ' + (usageFile === 'off' ? 'non enregistré' : usageFile));
  try {
    const server = await startWsServer(bridge, opts, log);
    log('en écoute sur ws://127.0.0.1:' + server.address().port + (opts.coreOnly ? ' (noyau seulement)' : ''));
    log('jeton : ' + opts.token);
  } catch(e){
    log('impossible d\'écouter sur le port ' + opts.port + ' : ' + e.message);
  }
  let pending = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', function(chunk){
    pending += chunk;
    let i;
    while((i = pending.indexOf('\n')) !== -1){
      const line = pending.slice(0, i);
      pending = pending.slice(i + 1);
      bridge.handleLine(line);
    }
  });
  process.stdin.on('end', function(){ process.exit(0); });
}

import { fileURLToPath } from 'node:url';
if(process.argv[1] && fileURLToPath(import.meta.url) === (await import('node:path')).resolve(process.argv[1])) main();
