// LES DEUX TRANSPORTS DU MULTIJOUEUR (js/network-game.js), sans navigateur.
//
// Un faux relais route les messages entre fausses WebSocket exactement comme le serveur
// (cloud/back/routes/reseau.js) : `bienvenue` / `arrivee` / `depart`, `de` posé sur ce qu'il
// relaie, `to` pour n'adresser qu'un client, `ping` -> `pong`. Un faux RTCPeerConnection relie
// deux pairs dès que l'offre et la réponse ont fait l'aller-retour par la signalisation.
// Chaque joueur est une INSTANCE du module (import avec une requête différente) : l'état
// NETWORK est par module, comme il est par onglet dans la réalité.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const tick = (n = 20) => new Promise((r) => { let i = 0; const f = () => (++i >= n ? r() : setImmediate(f)); f(); });

// ---------- faux relais ----------
const relay = {rooms: new Map(), log: [], seq: 0};
function roomOf(code){ if(!relay.rooms.has(code)) relay.rooms.set(code, {clients: []}); return relay.rooms.get(code); }
function deliver(sock, m){ Promise.resolve().then(() => sock.fire('message', {data: JSON.stringify(m)})); }

class FakeSocket {
  constructor(url){
    this.url = url; this.readyState = 1; this.handlers = {};
    this.code = url.split('/').pop();
    this.id = 'j' + (++relay.seq);
    const room = roomOf(this.code);
    const ids = room.clients.map((c) => c.id).concat(this.id);
    const authority = ids[0];
    room.clients.forEach((c) => deliver(c, {type: 'arrivee', id: this.id, autorite: authority, joueurs: ids}));
    room.clients.push(this);
    deliver(this, {type: 'bienvenue', id: this.id, autorite: authority, joueurs: ids, max_joueurs: 8});
  }
  addEventListener(t, fn){ (this.handlers[t] = this.handlers[t] || []).push(fn); }
  fire(t, ev){ (this.handlers[t] || []).forEach((f) => f(ev)); }
  send(s){
    const m = JSON.parse(s);
    relay.log.push({from: this.id, m});
    const room = roomOf(this.code);
    if(m.type === 'ping'){ deliver(this, {type: 'pong', t: m.t}); return; }
    const out = Object.assign({}, m, {de: this.id});
    if(typeof m.to === 'string'){
      const c = room.clients.find((x) => x.id === m.to);
      if(c) deliver(c, out);
      return;
    }
    room.clients.forEach((c) => { if(c !== this) deliver(c, out); });
  }
  close(){
    if(this.readyState === 3) return;
    this.readyState = 3;
    const room = roomOf(this.code);
    room.clients = room.clients.filter((c) => c !== this);
    const ids = room.clients.map((c) => c.id);
    room.clients.forEach((c) => deliver(c, {type: 'depart', id: this.id, autorite: ids[0], joueurs: ids}));
    this.fire('close', {code: 1000});
  }
}

// ---------- faux WebRTC ----------
const rtc = {pcs: new Map(), seq: 0, mode: 'connect', created: []};
class FakeDC {
  constructor(label, opts){ this.label = label; this.opts = opts; this.readyState = 'connecting'; this.peer = null; this.sent = []; }
  send(s){
    if(this.readyState !== 'open') throw new Error('canal fermé');
    this.sent.push(JSON.parse(s));
    const p = this.peer;
    Promise.resolve().then(() => { if(p && p.onmessage) p.onmessage({data: s}); });
  }
  close(){ this.readyState = 'closed'; }
}
class FakePC {
  constructor(cfg){
    this.cfg = cfg; this.id = 'pc' + (++rtc.seq); this.localDescription = null; this.remoteDescription = null;
    this.channel = null; rtc.pcs.set(this.id, this); rtc.created.push(this);
    this.candidates = [];
  }
  createDataChannel(label, opts){ this.channel = new FakeDC(label, opts); return this.channel; }
  async createOffer(){ return {type: 'offer', sdp: this.id}; }
  async createAnswer(){ return {type: 'answer', sdp: this.id}; }
  async setLocalDescription(d){
    this.localDescription = d;
    if(this.onicecandidate) Promise.resolve().then(() => this.onicecandidate({candidate: {candidate: 'c-' + this.id}}));
  }
  async setRemoteDescription(d){
    this.remoteDescription = d;
    if(d.type === 'answer' && rtc.mode === 'connect'){
      // l'offrant (this) reçoit la réponse : on relie son canal à un canal neuf chez le répondant
      const other = rtc.pcs.get(d.sdp);
      const mine = this.channel, theirs = new FakeDC(mine.label, mine.opts);
      mine.peer = theirs; theirs.peer = mine;
      Promise.resolve().then(() => {
        if(other.ondatachannel) other.ondatachannel({channel: theirs});
        mine.readyState = 'open'; theirs.readyState = 'open';
        if(mine.onopen) mine.onopen();
      });
    }
  }
  async addIceCandidate(c){ this.candidates.push(c); }
  close(){ if(this.channel) this.channel.close(); }
}

globalThis.WebSocket = FakeSocket;
globalThis.RTCPeerConnection = FakePC;
globalThis.location = {origin: 'http://localhost:8080'};
globalThis.window = {GAME_DATA: {settings: {network: {transport: 'p2p', iceServers: [{urls: 'stun:exemple:3478'}]}}}};

let inst = 0;
const load = () => import('../js/network-game.js?i=' + (++inst));

test('p2p : signalisation par `to`, messages par le canal, le moyeu réexpédie', async () => {
  const A = await load(), B = await load(), C = await load();
  await A.networkJoin('http://localhost:8080', 'room1');
  await B.networkJoin('http://localhost:8080', 'room1');
  await tick();
  assert.equal(A.networkIsAuthority(), true);
  assert.equal(B.networkTransport(), 'p2p', 'le canal vers le moyeu est ouvert');
  const sig = relay.log.filter((e) => e.m.type === 'signal');
  assert.ok(sig.length >= 2, 'offre et réponse passent par le relais');
  assert.ok(sig.every((e) => typeof e.m.to === 'string'), 'chaque signal est adressé');
  assert.deepEqual(rtc.created[0].cfg.iceServers, [{urls: 'stun:exemple:3478'}], 'serveurs ICE de la config');
  assert.equal(B.NETWORK.p2p.channel.opts.ordered, true);

  await C.networkJoin('http://localhost:8080', 'room1');
  await tick();
  assert.equal(C.networkTransport(), 'p2p');

  const recusA = [], recusC = [], recusB = [];
  A.networkOn('pose', (d, de) => recusA.push([d, de]));
  C.networkOn('pose', (d, de) => recusC.push([d, de]));
  B.networkOn('pose', (d, de) => recusB.push([d, de]));
  relay.log.length = 0;
  B.networkHandle().send('pose', {x: 1});
  await tick();
  assert.deepEqual(recusA, [[{x: 1}, 'j2']]);
  assert.deepEqual(recusC, [[{x: 1}, 'j2']], 'le moyeu réexpédie de joueur à joueur, avec l\'émetteur');
  A.networkHandle().send('pose', {x: 2});
  await tick();
  assert.deepEqual(recusB, [[{x: 2}, 'j1']]);
  assert.equal(relay.log.filter((e) => e.m.type === 'custom' || e.m.type === 'fwd').length, 0,
    'aucun message de jeu par le relais une fois le canal ouvert');

  // entrées : vers l'autorité seulement, jamais réexpédiées
  B.networkSendInputs({axes: {x: 1}});
  await tick();
  assert.deepEqual(A.NETWORK.inputs.j2, {axes: {x: 1}});
  assert.equal(C.NETWORK.inputs.j2, undefined);

  // ping par le canal
  B.networkPingNow();
  await tick();
  assert.equal(typeof B.networkPing(), 'number');

  A.networkQuit(); B.networkQuit(); C.networkQuit();
});

test('p2p : canal jamais ouvert -> repli sur le relais après l\'échéance', async () => {
  rtc.mode = 'never';
  const warns = [];
  const w0 = console.warn; console.warn = (m) => warns.push(String(m));
  try{
    const A = await load(), B = await load();
    B.NETWORK.p2pTimeoutMs = 30;
    await A.networkJoin('http://localhost:8080', 'room2');
    await B.networkJoin('http://localhost:8080', 'room2');
    await tick();
    assert.equal(B.networkTransport(), 'relay', 'en attente : le relais porte les messages');
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(B.networkTransport(), 'p2p-fallback');
    assert.equal(warns.filter((m) => /relais/.test(m)).length, 1, 'un seul avertissement');
    const recus = [];
    A.networkOn('tir', (d, de) => recus.push([d, de]));
    relay.log.length = 0;
    B.networkHandle().send('tir', 7);
    await tick();
    assert.deepEqual(recus, [[7, 'j' + relay.seq]]);
    assert.equal(relay.log.filter((e) => e.m.type === 'custom').length, 1);
    A.networkQuit(); B.networkQuit();
  } finally { console.warn = w0; rtc.mode = 'connect'; }
});

test('relais : transport « relay », ping/pong du serveur, sendRate de la config', async () => {
  const avant = globalThis.window;
  globalThis.window = {GAME_DATA: {settings: {network: {sendRate: 30}}}};
  try{
    const A = await load();
    await A.networkJoin('http://localhost:8080', 'room3');
    assert.equal(A.networkTransport(), 'relay');
    assert.equal(A.networkHandle().sendRate(), 30);
    assert.equal(A.NETWORK.periodeState, 1 / 30);
    A.networkPingNow();
    await tick();
    assert.equal(typeof A.networkHandle().ping(), 'number');
    assert.equal(A.networkStatus().players.length, 1);
    A.networkQuit();
  } finally { globalThis.window = avant; }
});

test('création de salon : clé et joueurs max envoyés, refus traduits en français', async () => {
  const avant = globalThis.window;
  globalThis.window = {GAME_DATA: {build: {network: {server: 'https://cloud.exemple', gameKey: 'mj_abc', maxPlayers: 4}}}};
  try{
    const A = await load();
    let body = null;
    const cas = {
      cle_invalide: /clé de jeu/, service_inactif: /pas activé/, origine_refusee: /pas autorisé/,
      quota_salons: /trop de salons/, quota_minutes: /minutes/
    };
    for(const [code, re] of Object.entries(cas)){
      globalThis.fetch = async (url, opts) => { body = JSON.parse(opts.body); return {status: 403, json: async () => ({erreur: 'x', code})}; };
      await assert.rejects(A.networkHost(), (e) => re.test(e.message) && e.code === code, code);
    }
    assert.deepEqual(body, {max_joueurs: 4, cle: 'mj_abc'});
    globalThis.fetch = async () => ({status: 500, json: async () => { throw new Error('pas du JSON'); }});
    await assert.rejects(A.networkHost(), /HTTP 500/);
  } finally { globalThis.window = avant; }
});

test('lecture de la config : build objet, ancienne chaîne, aperçu, éditeur, défauts', async () => {
  const A = await load();
  const avant = globalThis.window;
  try{
    globalThis.window = {GAME_DATA: {build: {network: {server: 'https://r.exemple', transport: 'p2p', sendRate: 999}}}};
    let c = A.networkConfig();
    assert.equal(c.server, 'https://r.exemple');
    assert.equal(c.transport, 'p2p');
    assert.equal(c.sendRate, 60, 'borné');
    assert.equal(A.networkDefaultBase(), 'https://r.exemple');

    globalThis.window = {GAME_DATA: {build: {network: 'https://ancien.exemple'}}};
    assert.equal(A.networkDefaultBase(), 'https://ancien.exemple');
    assert.equal(A.networkConfig().transport, 'relay');

    globalThis.window = {GAME_DATA: {settings: {network: {maxPlayers: 3, replication: 'authority'}}}};
    c = A.networkConfig();
    assert.equal(c.maxPlayers, 3);
    assert.equal(c.replication, 'authority');
    assert.equal(A.networkDefaultBase(), 'http://localhost:8080', 'serveur vide : origine de la page');

    globalThis.window = {};
    globalThis.project = {settings: {network: {transport: 'p2p', gameKey: ' mj_z '}}};
    c = A.networkConfig();
    assert.equal(c.transport, 'p2p');
    assert.equal(c.gameKey, 'mj_z');
    delete globalThis.project;
    assert.deepEqual(A.networkConfig(), A.sanitizeNetworkSettings({}));
    assert.deepEqual(A.sanitizeNetworkSettings({}), A.NETWORK_SETTINGS_DEFAULT);
  } finally { globalThis.window = avant; }
});

test('sanitizeNetworkSettings : bornes, énumérations, serveurs ICE', async () => {
  const A = await load();
  const s = A.sanitizeNetworkSettings({enabled: 'oui', transport: 'tcp', server: 'ftp://x', maxPlayers: 0,
    sendRate: 'vite', replication: 'moi', p2pFallbackRelay: false,
    iceServers: [{urls: 'turn:t', username: 'u', credential: 'c', extra: 1}, {urls: ''}, 'x', {urls: ['stun:a', 3]}]});
  assert.equal(s.enabled, false);
  assert.equal(s.transport, 'relay');
  assert.equal(s.server, '');
  assert.equal(s.maxPlayers, 1);
  assert.equal(s.sendRate, 20);
  assert.equal(s.replication, 'owner');
  assert.equal(s.p2pFallbackRelay, false);
  assert.deepEqual(s.iceServers, [{urls: 'turn:t', username: 'u', credential: 'c'}, {urls: ['stun:a']}]);
  assert.equal(A.sanitizeNetworkSettings({server: 'https://x.fr/'}).server, 'https://x.fr');
  assert.deepEqual(A.sanitizeNetworkSettings({iceServers: []}).iceServers, [], 'une liste vide est un choix');
});
