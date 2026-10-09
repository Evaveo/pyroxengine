// LE FIL DU RELAIS MULTIJOUEUR, tel que le serveur l'émet vraiment.
//
// Le relais (cloud/back/routes/reseau.js) envoie `bienvenue` / `arrivee` / `depart` et le champ
// `autorite`. La migration des noms en anglais (v0.89.1) avait traduit ces VALEURS côté client
// (`welcome` / `start` / `authority`) : plus aucun message n'était reconnu, rejoindre un salon ne
// résolvait jamais et chaque joueur se croyait autorité — sans une erreur. Ce test rejoue les
// messages exacts du serveur, et couvre les canaux libres (api.network.send / on) et host().
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Faux WebSocket : enregistre ce qui part, laisse le test livrer ce qui arrive.
class FakeSocket {
  constructor(url){ this.url = url; this.readyState = 1; this.sent = []; this.handlers = {}; FakeSocket.last = this; }
  addEventListener(t, fn){ (this.handlers[t] = this.handlers[t] || []).push(fn); }
  send(s){ this.sent.push(JSON.parse(s)); }
  close(){ this.readyState = 3; (this.handlers.close || []).forEach((f) => f()); }
  deliver(m){ (this.handlers.message || []).forEach((f) => f({data: JSON.stringify(m)})); }
}
globalThis.WebSocket = FakeSocket;
globalThis.location = {origin: 'http://localhost:8080'};

const net = await import('../js/network-game.js');

test('bienvenue / autorite (forme du serveur) résolvent join et posent me + autorité', async () => {
  const p = net.networkJoin('http://localhost:8080', 'abcde');
  assert.equal(FakeSocket.last.url, 'ws://localhost:8080/api/reseau/ws/ABCDE');
  FakeSocket.last.deliver({type: 'bienvenue', id: 'j2', autorite: 'j1', joueurs: ['j1', 'j2']});
  const w = await p;
  assert.deepEqual(w, {id: 'j2', authority: 'j1'});
  assert.equal(net.NETWORK.me, 'j2');
  assert.equal(net.networkIsAuthority(), false, 'le second arrivé n\'est pas l\'autorité');
  net.networkQuit();
});

test('canaux libres : send part en « custom », on reçoit données + émetteur, arrivee/depart notifiés', async () => {
  const p = net.networkJoin('http://localhost:8080', 'CODE1');
  FakeSocket.last.deliver({type: 'bienvenue', id: 'j1', autorite: 'j1', joueurs: ['j1']});
  await p;
  const h = net.networkHandle();
  h.send('pose', {x: 1});
  assert.deepEqual(FakeSocket.last.sent.at(-1), {type: 'custom', ch: 'pose', d: {x: 1}});

  const recus = [], arrivees = [], departs = [];
  const off = h.on('pose', (d, de) => recus.push([d, de]));
  h.on('$arrival', (id) => arrivees.push(id));
  h.on('$leave', (id) => departs.push(id));
  FakeSocket.last.deliver({type: 'custom', ch: 'pose', d: {x: 2}, de: 'j3'});
  FakeSocket.last.deliver({type: 'arrivee', id: 'j3', autorite: 'j1', joueurs: ['j1', 'j3']});
  FakeSocket.last.deliver({type: 'depart', id: 'j3', autorite: 'j1', joueurs: ['j1']});
  assert.deepEqual(recus, [[{x: 2}, 'j3']]);
  assert.deepEqual(arrivees, ['j3']);
  assert.deepEqual(departs, ['j3']);
  assert.deepEqual(net.NETWORK.joueurs, ['j1']);

  off();
  FakeSocket.last.deliver({type: 'custom', ch: 'pose', d: {x: 3}, de: 'j4'});
  assert.equal(recus.length, 1, 'un écouteur retiré ne reçoit plus rien');

  // quitter vide les écouteurs : une partie relancée ne les empile pas
  net.networkQuit();
  const p2 = net.networkJoin('http://localhost:8080', 'CODE2');
  FakeSocket.last.deliver({type: 'bienvenue', id: 'j1', autorite: 'j1', joueurs: ['j1']});
  await p2;
  FakeSocket.last.deliver({type: 'arrivee', id: 'j9', autorite: 'j1', joueurs: ['j1', 'j9']});
  assert.deepEqual(arrivees, ['j3'], 'les écouteurs de la partie précédente sont partis');
  net.networkQuit();
});

test('host crée le salon en HTTP puis le rejoint — on en devient l\'autorité', async () => {
  const appels = [];
  globalThis.fetch = async (url, opts) => { appels.push([url, opts.method]); return {status: 200, json: async () => ({code: 'XYZAB'})}; };
  const p = net.networkHost('http://localhost:8080/');
  await new Promise((r) => setTimeout(r, 0));
  FakeSocket.last.deliver({type: 'bienvenue', id: 'j1', autorite: 'j1', joueurs: ['j1']});
  const r = await p;
  assert.deepEqual(appels, [['http://localhost:8080/api/reseau/salon', 'POST']]);
  assert.deepEqual(r, {code: 'XYZAB', id: 'j1', authority: 'j1'});
  assert.equal(net.networkIsAuthority(), true);
  net.networkQuit();
});

test('le relais inscrit par le build prime sur l origine de la page (jeu publié sur itch.io)', async () => {
  // Un jeu hébergé ailleurs cherchait le relais à SA propre origine : « itch.zone/api/reseau : 404 ».
  const avant = globalThis.window;
  try{
    globalThis.window = {GAME_DATA: {build: {network: 'https://cloud.exemple'}}};
    assert.equal(net.networkDefaultBase(), 'https://cloud.exemple');
    const p = net.networkJoin(undefined, 'abcde');
    assert.equal(FakeSocket.last.url, 'wss://cloud.exemple/api/reseau/ws/ABCDE');
    FakeSocket.last.deliver({type: 'bienvenue', id: 'j1', autorite: 'j1', joueurs: ['j1']});
    await p;
    net.networkQuit();

    // relais tiers : la création de salon part SANS cookies (CORS joker côté serveur)
    let vu = null;
    globalThis.fetch = async (url, opts) => { vu = [url, opts.credentials]; return {status: 200, json: async () => ({code: 'QWERT'})}; };
    const h = net.networkHost();
    await new Promise((r) => setTimeout(r, 0));
    FakeSocket.last.deliver({type: 'bienvenue', id: 'j1', autorite: 'j1', joueurs: ['j1']});
    await h;
    assert.deepEqual(vu, ['https://cloud.exemple/api/reseau/salon', 'omit']);
    net.networkQuit();

    // pas d'adresse inscrite (aperçu depuis l'éditeur) : l'origine de la page
    globalThis.window = {GAME_DATA: {build: {}}};
    assert.equal(net.networkDefaultBase(), 'http://localhost:8080');
  } finally {
    globalThis.window = avant;
  }
});
