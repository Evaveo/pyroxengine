// ---------- Multijoueur : moteur PARTAGÉ ----------
// Chargé par l'éditeur ET embarqué dans le build publié (js/build.js), comme
// js/game-ui.js et js/game-character.js. Il n'importe RIEN : le jeu publié le charge seul.
//
// AUTORITÉ, jamais « hôte ». C'est un rôle : tenu aujourd'hui par un navigateur,
// il pourra l'être demain par un processus serveur. Aucune fonction d'ici ne
// suppose que l'autorité est un client — c'est ce qui fera du serveur autoritaire
// un remplacement et non une réécriture. Voir docs/multijoueur.md.
//
// DEUX TRANSPORTS, UNE SEULE API (api.network) :
//
//   - « relay » : tout passe par la WebSocket du relais cloud, qui ne lit pas les paquets et
//     ne simule rien — c'est ce qui le rend peu coûteux à faire tourner.
//   - « p2p » : topologie en ÉTOILE. L'autorité (premier arrivé) est le moyeu ; chaque joueur
//     ouvre une RTCPeerConnection vers elle, négociée par la WebSocket du relais (messages
//     `signal` adressés par `to`). Une fois le canal ouvert, les messages de jeu passent par
//     lui, et l'autorité RÉEXPÉDIE aux autres joueurs ce qu'un joueur envoie. La présence
//     (arrivées, départs, qui est l'autorité) reste portée par le relais dans les deux cas.
//     UN SEUL canal de données, fiable et ordonné (« game ») : plus simple à raisonner, et
//     au débit d'un jeu de ce moteur la retransmission ne coûte rien de visible. Un canal non
//     fiable pour les instantanés est une optimisation possible, pas un besoin mesuré.
//     Si le canal ne s'ouvre pas en ~5 s et que `p2pFallbackRelay` est vrai, le jeu continue
//     par le relais (« p2p-fallback »).

// ---------- Réglages multijoueur ----------
// Ce module POSSÈDE le défaut et le nettoyage : project-settings.js les importe pour le
// réglage de projet, et le jeu publié — qui ne charge pas project-settings.js — relit sa
// config ici.
export const NETWORK_SETTINGS_DEFAULT = {
  enabled: false,
  transport: 'relay',          // 'relay' | 'p2p'
  server: '',                  // origine du relais / de la signalisation ; '' = automatique
  gameKey: '',                 // clé de jeu du cloud ('mj_...')
  maxPlayers: 8,               // 1..32 — indicatif côté client, le serveur fait foi
  sendRate: 20,                // Hz, 5..60
  replication: 'owner',        // 'owner' | 'authority'
  p2pFallbackRelay: true,
  iceServers: [{urls: 'stun:stun.l.google.com:19302'}]
};
export const NETWORK_TRANSPORTS = ['relay', 'p2p'];
export const NETWORK_REPLICATIONS = ['owner', 'authority'];
export const P2P_TIMEOUT_MS = 5000;

function clampInt(v, min, max, def){
  const n = Math.round(Number(v));
  if(!Number.isFinite(n)) return def;
  return Math.min(Math.max(n, min), max);
}
function sanitizeIceServers(list){
  if(!Array.isArray(list)) return JSON.parse(JSON.stringify(NETWORK_SETTINGS_DEFAULT.iceServers));
  const out = [];
  list.forEach(function(s){
    if(!s || typeof s !== 'object' || out.length >= 8) return;
    let urls = s.urls;
    if(Array.isArray(urls)) urls = urls.filter(function(u){ return typeof u === 'string' && u.trim(); }).map(function(u){ return u.trim(); });
    else if(typeof urls === 'string' && urls.trim()) urls = urls.trim();
    else return;
    if(Array.isArray(urls) && !urls.length) return;
    const e = {urls: urls};
    if(typeof s.username === 'string' && s.username) e.username = s.username;
    if(typeof s.credential === 'string' && s.credential) e.credential = s.credential;
    out.push(e);
  });
  return out;
}
/** Une origine http(s) sans barre finale, ou '' (automatique). */
export function sanitizeServerOrigin(v){
  if(typeof v !== 'string') return '';
  const s = v.trim().replace(/\/+$/, '');
  return /^https?:\/\/[^\s]+$/.test(s) ? s : '';
}

/**
 * Les réglages multijoueur lus d'une source quelconque (fichier, build, commande du copilote),
 * ramenés à une forme sûre : un champ absent ou illisible prend son défaut, un nombre est
 * borné, une énumération inconnue retombe sur sa valeur par défaut. Rend un objet NEUF.
 */
export function sanitizeNetworkSettings(raw){
  const r = (raw && typeof raw === 'object') ? raw : {};
  const D = NETWORK_SETTINGS_DEFAULT;
  return {
    enabled: (typeof r.enabled === 'boolean') ? r.enabled : D.enabled,
    transport: NETWORK_TRANSPORTS.indexOf(r.transport) !== -1 ? r.transport : D.transport,
    server: sanitizeServerOrigin(r.server),
    gameKey: (typeof r.gameKey === 'string') ? r.gameKey.trim().slice(0, 200) : D.gameKey,
    maxPlayers: clampInt(r.maxPlayers, 1, 32, D.maxPlayers),
    sendRate: clampInt(r.sendRate, 5, 60, D.sendRate),
    replication: NETWORK_REPLICATIONS.indexOf(r.replication) !== -1 ? r.replication : D.replication,
    p2pFallbackRelay: (typeof r.p2pFallbackRelay === 'boolean') ? r.p2pFallbackRelay : D.p2pFallbackRelay,
    iceServers: sanitizeIceServers(r.iceServers)
  };
}

/**
 * La config EFFECTIVE, par ordre de priorité croissante :
 *   1. les défauts ;
 *   2. dans l'éditeur (pas de GAME_DATA), `project.settings.network` ;
 *   3. `GAME_DATA.settings.network` — l'aperçu (game-preview.html) reçoit buildDataProject(),
 *      qui porte tous les réglages de projet ;
 *   4. `GAME_DATA.build.network` — un jeu publié : objet (v0.173+) ou, dans un build plus
 *      ancien, la seule adresse du relais sous forme de chaîne.
 * `server` reste '' quand rien ne le fixe : networkDefaultBase() se rabat alors sur l'origine.
 */
export function networkConfig(){
  const d = (typeof window !== 'undefined' && window.GAME_DATA) || null;
  let merged = {};
  if(!d){
    const p = globalThis.project;
    const s = p && p.settings && p.settings.network;
    if(s) merged = Object.assign(merged, s);
  } else {
    if(d.settings && d.settings.network) merged = Object.assign(merged, d.settings.network);
    const b = d.build && d.build.network;
    if(typeof b === 'string') merged.server = b;
    else if(b && typeof b === 'object'){
      Object.keys(b).forEach(function(k){ if(b[k] !== null && b[k] !== undefined) merged[k] = b[k]; });
    }
  }
  return sanitizeNetworkSettings(merged);
}

export const NETWORK = {
  socket: null,
  code: null,
  me: null,
  authority: null,
  joueurs: [],          // ids présents
  inputs: {},          // id -> dernières entrées reçues (côté autorité)
  repliques: [],        // objets dont l'autorité diffuse la pose
  lastEnvoi: 0,
  periodeState: 1 / 20,  // réglé à la connexion sur 1 / config.sendRate
  aRecu: false,
  onEvent: null,    // callback optionnel de l'appelant
  config: null,     // la config figée à la connexion (networkConfig())
  ping: null,       // dernier aller-retour mesuré, en ms
  pingSent: 0,
  p2pTimeoutMs: P2P_TIMEOUT_MS,
  maxPlayers: null, // rendu par le serveur à la création du salon (information)
  // pair-à-pair
  p2p: null         // {role:'host'|'joiner', peers: Map, channel, pc, open, fallback, timer, warned}
};

function now(){ return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }

export function networkActive(){ return !!(NETWORK.socket && NETWORK.socket.readyState === 1); }
export function networkIsAuthority(){
  // Hors ligne, on est SEUL et donc autorité : un jeu solo doit tourner sans
  // savoir que le réseau existe. C'est le test de bonne conception de l'API.
  if(!networkActive()) return true;
  return NETWORK.me !== null && NETWORK.me === NETWORK.authority;
}

/** 'relay' | 'p2p' | 'p2p-fallback' — le chemin que prennent réellement les messages de jeu. */
export function networkTransport(){
  const s = NETWORK.p2p;
  if(!s) return 'relay';
  if(s.fallback) return 'p2p-fallback';
  if(s.role === 'host') return 'p2p';
  return (s.channel && s.channel.readyState === 'open') ? 'p2p' : 'relay';
}

// L'ADRESSE DU RELAIS : celle de la config (build publié : data.build.network, js/build.js ;
// éditeur : project.settings.network.server), sinon l'origine de la page. Un jeu publié sur un
// autre site (itch.io) ne porte pas le relais : se rabattre sur sa propre origine, c'était
// frapper à une porte qui n'existe pas.
export function networkDefaultBase(){
  const s = networkConfig().server;
  return s || location.origin;
}

function rawSocketSend(m){
  if(!networkActive()) return false;
  NETWORK.socket.send(JSON.stringify(m));
  return true;
}

export function networkJoin(base, code, onEvent){
  return new Promise(function(res, rej){
    const ws = (base || networkDefaultBase()).replace(/\/+$/, '').replace(/^http/, 'ws')
      + '/api/reseau/ws/' + String(code).toUpperCase();
    let socket;
    try{ socket = new WebSocket(ws); }
    catch(e){ rej(e); return; }
    NETWORK.socket = socket;
    NETWORK.code = String(code).toUpperCase();
    NETWORK.onEvent = onEvent || null;
    NETWORK.config = networkConfig();
    NETWORK.periodeState = 1 / NETWORK.config.sendRate;
    NETWORK.ping = null;
    let settled = false;

    socket.addEventListener('message', function(ev){
      let m;
      try{ m = JSON.parse(ev.data); } catch(e){ return; }
      networkReceive(m);
      if(m.type === 'welcome' && !settled){ settled = true; res({id: m.id, authority: m.authority}); }
    });
    socket.addEventListener('error', function(e){ if(!settled){ settled = true; rej(e); } });
    socket.addEventListener('close', function(ev){
      if(NETWORK.socket !== socket) return;
      p2pTeardown();
      NETWORK.socket = null; NETWORK.me = null; NETWORK.authority = null; NETWORK.joueurs = [];
      if(!settled){
        settled = true;
        rej(new Error(ev && ev.code === 4008 ? 'le salon est plein' : 'connexion au salon refusée'));
      }
    });
  });
}

export function networkQuit(){
  p2pTeardown();
  const s = NETWORK.socket;
  NETWORK.socket = null;
  if(s) try{ s.close(); } catch(e){ /* déjà fermé */ }
  NETWORK.me = null; NETWORK.authority = null; NETWORK.code = null;
  NETWORK.joueurs = []; NETWORK.inputs = {}; NETWORK.repliques = [];
  NETWORK.ping = null; NETWORK.maxPlayers = null;
  _channels.clear();
}

// ---------- envoi : choisit le transport ----------
export function networkSend(message){
  if(!networkActive()) return false;
  const s = NETWORK.p2p;
  if(!s || s.fallback) return rawSocketSend(message);
  if(s.role === 'joiner'){
    if(s.channel && s.channel.readyState === 'open'){
      s.channel.send(JSON.stringify(message));
      return true;
    }
    // Canal pas encore ouvert : le relais porte le message en attendant (rien ne se perd
    // pendant la négociation). Après l'échéance sans repli autorisé, on ne l'envoie plus.
    if(s.expired) return false;
    return rawSocketSend(message);
  }
  // Moyeu : à chaque joueur par son canal ; ceux qui n'en ont pas reçoivent par le relais.
  return hostDistribute(message, null);
}

/** Moyeu : envoie `message` à chaque joueur sauf `except`. `wrapFrom` : id de l'émetteur d'origine. */
function hostDistribute(message, except, wrapFrom){
  const s = NETWORK.p2p;
  const txt = JSON.stringify(message);
  const viaRelay = [];
  NETWORK.joueurs.forEach(function(id){
    if(id === NETWORK.me || id === except) return;
    const peer = s.peers.get(id);
    if(peer && peer.channel && peer.channel.readyState === 'open') peer.channel.send(txt);
    else viaRelay.push(id);
  });
  if(!viaRelay.length) return true;
  if(wrapFrom === undefined){
    const others = NETWORK.joueurs.filter(function(id){ return id !== NETWORK.me; });
    if(viaRelay.length === others.length) return rawSocketSend(message);
    viaRelay.forEach(function(id){ rawSocketSend(Object.assign({}, message, {to: id})); });
    return true;
  }
  // Un message RÉEXPÉDIÉ : le relais réécrirait `de` avec l'id du moyeu, on l'emballe donc.
  viaRelay.forEach(function(id){ rawSocketSend({type: 'fwd', to: id, m: message}); });
  return true;
}

// `etatJeu` est l'objet api.state : du JSON pur, sans fonctions. Il a été conçu
// pour survivre aux changements de scène, et c'est exactement la forme d'un
// état répliqué — on ne crée donc pas un second canal.
// LE FIL PARLE LA LANGUE DU RELAIS. Le serveur (cloud/back/routes/reseau.js) émet
// `bienvenue` / `arrivee` / `depart` et le champ `autorite` ; la migration des noms en anglais
// (v0.89.1) avait traduit ces VALEURS côté client en `welcome` / `start` / `authority`. Plus
// aucun message n'était reconnu : rejoindre un salon ne résolvait jamais, `NETWORK.me` restait
// nul et chaque client se croyait autorité. On normalise ici, en acceptant les deux formes,
// pour ne dépendre ni d'une version du serveur ni d'une autre passe de renommage.
const WIRE_TYPES = {bienvenue: 'welcome', depart: 'leave', arrivee: 'arrival', start: 'leave'};
export function normalizeWireMessage(m){
  if(!m || typeof m !== 'object') return m;
  if(WIRE_TYPES[m.type]) m.type = WIRE_TYPES[m.type];
  if(m.authority === undefined && m.autorite !== undefined) m.authority = m.autorite;
  return m;
}

export function networkReceive(m){
  normalizeWireMessage(m);
  if(m.type === 'signal'){ p2pOnSignal(m); return; }
  if(m.type === 'fwd'){
    // réexpédition du moyeu par le relais : n'est crue que venant de l'autorité
    if(m.de === NETWORK.authority && m.m && typeof m.m === 'object') networkReceive(m.m);
    return;
  }
  if(m.type === 'pong'){
    if(typeof m.t === 'number') NETWORK.ping = Math.max(0, Math.round(now() - m.t));
    return;
  }
  if(m.type === 'ping') return;   // le relais y répond lui-même
  if(m.type === 'welcome'){
    NETWORK.me = m.id; NETWORK.authority = m.authority; NETWORK.joueurs = m.joueurs || [];
    if(m.max_joueurs !== undefined) NETWORK.maxPlayers = m.max_joueurs;
    p2pStart();
  } else if(m.type === 'arrival' || m.type === 'leave'){
    const oldAuthority = NETWORK.authority;
    NETWORK.authority = m.authority; NETWORK.joueurs = m.joueurs || [];
    if(m.type === 'leave'){ delete NETWORK.inputs[m.id]; p2pOnLeave(m.id); }
    if(oldAuthority !== NETWORK.authority) p2pOnAuthorityChange();
  } else if(m.type === 'inputs'){
    // reçu par l'autorité : ce que fait un autre joueur
    NETWORK.inputs[m.de] = m.e || {};
  } else if(m.type === 'snapshot'){
    NETWORK.lastSnapshot = m;
    NETWORK.aRecu = true;
  }
  if(m.type === 'custom') dispatchChannel(m.ch, m.d, m.de);
  else if(m.type === 'arrival') dispatchChannel('$arrival', m.id, m.id);
  else if(m.type === 'leave') dispatchChannel('$leave', m.id, m.id);
  if(NETWORK.onEvent) NETWORK.onEvent(m);
}

// ---------- mesure de latence ----------
/** Lance une mesure d'aller-retour (relais : ping/pong du serveur ; p2p : par le canal). */
export function networkPingNow(){
  if(!networkActive()) return false;
  const t = now();
  NETWORK.pingSent = t;
  const s = NETWORK.p2p;
  if(s && !s.fallback && s.role === 'joiner' && s.channel && s.channel.readyState === 'open'){
    s.channel.send(JSON.stringify({type: 'ping', t: t}));
    return true;
  }
  return rawSocketSend({type: 'ping', t: t});
}
/** Le dernier aller-retour mesuré en ms (ou null), et relance une mesure au plus chaque seconde. */
export function networkPing(){
  if(networkActive() && now() - NETWORK.pingSent > 1000) networkPingNow();
  return NETWORK.ping;
}

// ---------- pair-à-pair (étoile, moyeu = autorité) ----------
function p2pWanted(){ return !!(NETWORK.config && NETWORK.config.transport === 'p2p'); }

function p2pTeardown(){
  const s = NETWORK.p2p;
  if(!s) return;
  if(s.timer) clearTimeout(s.timer);
  const closeOne = function(pc, ch){
    try{ if(ch) ch.close(); } catch(e){ /* déjà fermé */ }
    try{ if(pc) pc.close(); } catch(e){ /* déjà fermé */ }
  };
  closeOne(s.pc, s.channel);
  if(s.peers) s.peers.forEach(function(p){ closeOne(p.pc, p.channel); });
  NETWORK.p2p = null;
}

function p2pFallback(reason){
  const s = NETWORK.p2p;
  if(!s || s.fallback) return;
  if(NETWORK.config && NETWORK.config.p2pFallbackRelay){
    s.fallback = true;
    if(!s.warned){
      s.warned = true;
      console.warn('[réseau] liaison pair-à-pair impossible (' + reason + ') : la partie continue par le relais.');
    }
  } else {
    s.expired = true;
    if(!s.warned){
      s.warned = true;
      console.warn('[réseau] liaison pair-à-pair impossible (' + reason + ') et repli sur le relais désactivé : les messages de jeu ne partent plus.');
    }
  }
}

function newPeerConnection(){
  const Ctor = globalThis.RTCPeerConnection;
  if(typeof Ctor !== 'function') return null;
  return new Ctor({iceServers: NETWORK.config.iceServers});
}

function p2pStart(){
  p2pTeardown();
  if(!p2pWanted()) return;
  if(NETWORK.me === NETWORK.authority){
    NETWORK.p2p = {role: 'host', peers: new Map()};
    return;
  }
  const s = {role: 'joiner', peers: new Map(), pc: null, channel: null, pending: Promise.resolve()};
  NETWORK.p2p = s;
  const pc = newPeerConnection();
  if(!pc){ p2pFallback('WebRTC indisponible dans ce navigateur'); return; }
  s.pc = pc;
  const host = NETWORK.authority;
  pc.onicecandidate = function(ev){
    if(ev && ev.candidate) rawSocketSend({type: 'signal', to: host, d: {candidate: ev.candidate}});
  };
  const ch = pc.createDataChannel('game', {ordered: true});
  s.channel = ch;
  wireChannel(ch, host, false);
  ch.onopen = function(){ if(s.timer){ clearTimeout(s.timer); s.timer = null; } };
  s.timer = setTimeout(function(){
    s.timer = null;
    if(NETWORK.p2p === s && !(s.channel && s.channel.readyState === 'open')) p2pFallback('délai dépassé');
  }, NETWORK.p2pTimeoutMs);
  if(s.timer && typeof s.timer.unref === 'function') s.timer.unref();
  s.pending = (async function(){
    try{
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      rawSocketSend({type: 'signal', to: host, d: {sdp: pc.localDescription || offer}});
    } catch(e){ p2pFallback('offre refusée : ' + (e && e.message ? e.message : e)); }
  })();
}

/** Branche la réception d'un canal. `isHostSide` : on est le moyeu, `peerId` est le joueur. */
function wireChannel(ch, peerId, isHostSide){
  ch.onmessage = function(ev){
    let m;
    try{ m = JSON.parse(ev.data); } catch(e){ return; }
    if(!m || typeof m !== 'object') return;
    if(isHostSide){
      if(m.type === 'ping'){ ch.send(JSON.stringify({type: 'pong', t: m.t})); return; }
      m.de = peerId;                       // l'émetteur est celui du canal, pas ce qu'il dit
      delete m.to;
      if(m.type !== 'inputs') hostDistribute(m, peerId, peerId);
      networkReceive(m);
    } else {
      if(m.de === undefined) m.de = peerId;
      networkReceive(m);
    }
  };
}

function p2pOnSignal(m){
  const s = NETWORK.p2p;
  if(!s || !m.d) return;
  const from = m.de;
  if(s.role === 'host'){
    let peer = s.peers.get(from);
    if(m.d.sdp && m.d.sdp.type === 'offer'){
      if(peer){ try{ peer.pc.close(); } catch(e){ /* */ } }
      const pc = newPeerConnection();
      if(!pc) return;
      peer = {pc: pc, channel: null, pending: null};
      s.peers.set(from, peer);
      pc.onicecandidate = function(ev){
        if(ev && ev.candidate) rawSocketSend({type: 'signal', to: from, d: {candidate: ev.candidate}});
      };
      pc.ondatachannel = function(ev){
        peer.channel = ev.channel;
        wireChannel(ev.channel, from, true);
      };
      peer.pending = (async function(){
        await pc.setRemoteDescription(m.d.sdp);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        rawSocketSend({type: 'signal', to: from, d: {sdp: pc.localDescription || answer}});
      })().catch(function(e){ console.warn('[réseau] négociation avec ' + from + ' : ' + (e && e.message ? e.message : e)); });
    } else if(m.d.candidate && peer){
      peer.pending = peer.pending.then(function(){ return peer.pc.addIceCandidate(m.d.candidate); })
        .catch(function(){ /* candidat inutilisable : ICE en essaie d'autres */ });
    }
    return;
  }
  // joueur : seules les réponses de l'autorité comptent
  if(from !== NETWORK.authority || !s.pc) return;
  if(m.d.sdp && m.d.sdp.type === 'answer'){
    s.pending = s.pending.then(function(){ return s.pc.setRemoteDescription(m.d.sdp); })
      .catch(function(e){ p2pFallback('réponse refusée : ' + (e && e.message ? e.message : e)); });
  } else if(m.d.candidate){
    s.pending = s.pending.then(function(){ return s.pc.addIceCandidate(m.d.candidate); })
      .catch(function(){ /* candidat inutilisable */ });
  }
}

function p2pOnLeave(id){
  const s = NETWORK.p2p;
  if(!s || s.role !== 'host') return;
  const p = s.peers.get(id);
  if(!p) return;
  try{ if(p.channel) p.channel.close(); } catch(e){ /* */ }
  try{ p.pc.close(); } catch(e){ /* */ }
  s.peers.delete(id);
}

// Le moyeu est parti : l'étoile n'a plus de centre. On se replie sur le relais plutôt que de
// renégocier en pleine partie.
function p2pOnAuthorityChange(){
  const s = NETWORK.p2p;
  if(!s || s.fallback) return;
  p2pFallback('l\'autorité a quitté le salon');
}

// ---------- canaux de messages libres (api.network.send / on) ----------
// Les écouteurs vivent le temps d'une connexion : networkQuit les vide, sinon un jeu relancé
// dans l'éditeur empilerait ceux de chaque partie précédente et traiterait chaque message
// autant de fois.
export const _channels = new Map();   // canal -> Set(fn)
export function networkOn(channel, fn){
  const key = String(channel);
  if(typeof fn !== 'function') return function(){};
  if(!_channels.has(key)) _channels.set(key, new Set());
  _channels.get(key).add(fn);
  return function(){ const s = _channels.get(key); if(s) s.delete(fn); };
}
function dispatchChannel(channel, data, from){
  const s = _channels.get(String(channel));
  if(!s) return;
  s.forEach(function(fn){
    try{ fn(data, from); } catch(e){ console.error('[réseau] écouteur « ' + channel + ' » :', e && e.message ? e.message : e); }
  });
}

// Les refus du relais à la création d'un salon, en clair.
export const SALON_ERRORS = {
  cle_invalide: 'clé de jeu multijoueur invalide — vérifiez-la dans les réglages réseau du projet',
  service_inactif: 'le service multijoueur n\'est pas activé pour ce jeu',
  origine_refusee: 'ce site n\'est pas autorisé à utiliser le serveur multijoueur de ce jeu',
  quota_salons: 'trop de salons ouverts en même temps pour ce jeu — réessayez plus tard',
  quota_minutes: 'le quota de minutes multijoueur de ce jeu est épuisé'
};

// Crée un salon sur le relais (HTTP, voir cloud/back/routes/reseau.js) puis le rejoint.
export async function networkHost(base){
  const origin = (base || networkDefaultBase()).replace(/\/+$/, '');
  const cfg = networkConfig();
  const body = {max_joueurs: cfg.maxPlayers};
  if(cfg.gameKey) body.cle = cfg.gameKey;
  // Cookies seulement vers sa propre origine : un relais tiers est ouvert en CORS sans
  // credentials (cloud/back/index.js), et `include` y ferait refuser la requête.
  const r = await fetch(origin + '/api/reseau/salon', {
    method: 'POST', headers: {'content-type': 'application/json'},
    credentials: origin === location.origin ? 'include' : 'omit', body: JSON.stringify(body)
  });
  const d = await r.json().catch(function(){ return {}; });
  if(!d.code || SALON_ERRORS[d.code]){
    const msg = SALON_ERRORS[d.code] || d.erreur || d.error || 'création du salon refusée (HTTP ' + r.status + ')';
    const err = new Error(msg);
    err.code = d.code || null;
    err.status = r.status;
    throw err;
  }
  const w = await networkJoin(origin, d.code);
  if(d.max_joueurs !== undefined) NETWORK.maxPlayers = d.max_joueurs;
  return {code: d.code, id: w.id, authority: w.authority};
}

// ---------- diffusion (autorité) ----------
// Appelé une fois par image. Ne fait rien si on n'est pas l'autorité, ou si la
// période n'est pas écoulée : c'est ce qui clamped la bande passante.
export function networkBroadcast(stateGame, time){
  if(!networkActive() || !networkIsAuthority()) return false;
  if(time - NETWORK.lastEnvoi < NETWORK.periodeState) return false;
  NETWORK.lastEnvoi = time;
  const poses = [];
  for(let i = 0; i < NETWORK.repliques.length; i++){
    const o = NETWORK.repliques[i];
    if(!o || !o.parent) continue;
    const p = o.position, q = o.quaternion;
    // Arrondi à 3 décimales : le millimètre ne se voit pas et divise le poids
    // du paquet par deux.
    poses.push({n: o.name,
      p: [+p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3)],
      q: [+q.x.toFixed(3), +q.y.toFixed(3), +q.z.toFixed(3), +q.w.toFixed(3)]});
  }
  return networkSend({type: 'snapshot', state: stateGame, objects: poses, t: time});
}

// ---------- application (non-autorité) ----------
// `trouver(name)` est fourni par l'appelant : le module ne connaît ni la scène de
// l'éditeur ni celle du runtime.
//
// INTERPOLATION : les instantanés arrivent à `sendRate` Hz, l'écran affiche à 60. Poser
// les positions telles quelles donne un mouvement saccadé — des images figées
// puis un saut. On garde donc la pose reçue comme CIBLE et on s'en approche
// chaque image. Le prix est un léger retard sur la vérité de l'autorité, ce qui
// est exactement le compromis que fait tout jeu en réseau.
export const _targets = new Map();   // objet -> {p:[x,y,z], q:[x,y,z,w]}
export const _qTmp = (typeof THREE !== 'undefined') ? new THREE.Quaternion() : null;

export function networkApply(stateGame, find, dt){
  if(!networkActive() || networkIsAuthority()) return false;
  const m = NETWORK.lastSnapshot;
  if(m && m !== NETWORK.snapshotApplique){
    NETWORK.snapshotApplique = m;
    if(m.state && stateGame){
      // On écrit DANS l'objet existant plutôt que de le remplacer : des scripts
      // en gardent une référence depuis leur start().
      Object.keys(stateGame).forEach(function(k){ if(!(k in m.state)) delete stateGame[k]; });
      Object.assign(stateGame, m.state);
    }
    (m.objects || []).forEach(function(o){
      const target = find(o.n);
      if(target) _targets.set(target, o);
    });
  }
  // rattrapage progressif, à chaque image
  const k = Math.min(1, (dt || 0.016) * 12);
  _targets.forEach(function(o, target){
    if(!target.parent){ _targets.delete(target); return; }
    target.position.x += (o.p[0] - target.position.x) * k;
    target.position.y += (o.p[1] - target.position.y) * k;
    target.position.z += (o.p[2] - target.position.z) * k;
    if(_qTmp){
      _qTmp.set(o.q[0], o.q[1], o.q[2], o.q[3]);
      target.quaternion.slerp(_qTmp, k);
    }
  });
  return true;
}

// ---------- entrées (non-autorité vers autorité) ----------
// On n'envoie QUE si l'entrée a changé. Émettre à chaque image serait aussi
// réactive et multiplierait le trafic par vingt : entre deux pressions de touche,
// il n'y a rien à dire. L'autorité garde la dernière valeur reçue.
export function networkSendInputs(e){
  if(!networkActive() || networkIsAuthority()) return false;
  const signature = JSON.stringify(e);
  if(signature === NETWORK.dernieresInputs) return false;
  NETWORK.dernieresInputs = signature;
  return networkSend({type: 'inputs', e: e});
}

/**
 * L'état du salon, pour un panneau d'éditeur : une photographie, jamais une référence vive.
 */
export function networkStatus(){
  return {
    active: networkActive(),
    code: NETWORK.code,
    me: NETWORK.me,
    authority: NETWORK.authority,
    isAuthority: networkActive() && networkIsAuthority(),
    players: NETWORK.joueurs.slice(),
    maxPlayers: NETWORK.maxPlayers !== null ? NETWORK.maxPlayers
      : (NETWORK.config ? NETWORK.config.maxPlayers : networkConfig().maxPlayers),
    transport: networkTransport(),
    ping: NETWORK.ping
  };
}

// Poignée exposée aux scripts. Volontairement petite : un jeu solo doit
// fonctionner sans qu'on y touche, et passer en ligne ne doit demander qu'une
// ligne — `if(!api.isAuthority()) return;`.
//
// Construite UNE SEULE FOIS : l'API est reconstruite à chaque script et à chaque
// image, et y fabriquer douze fermetures à chaque fois faisait travailler le
// ramasse-miettes pour rien. Elle n'a aucun état par objet, rien ne justifiait
// de la recréer.
export let _handle = null;
export function networkHandle(){
  if(_handle) return _handle;
  _handle = {
    active: networkActive,
    me: function(){ return NETWORK.me; },
    authority: function(){ return NETWORK.authority; },
    joueurs: function(){ return NETWORK.joueurs.slice(); },
    code: function(){ return NETWORK.code; },
    inputs: function(id){ return NETWORK.inputs[id] || null; },
    // Même forme que api.axis / api.action pour l'entrée LOCALE : un script de
    // gameplay ne doit pas avoir à savoir si le joueur est ici ou à l'autre bout
    // du fil. C'est ce qui permet d'add un second joueur sans rien réécrire.
    axe: function(id, name){
      const e = NETWORK.inputs[id];
      return (e && e.axes && e.axes[name]) || 0;
    },
    action: function(id, name){
      const e = NETWORK.inputs[id];
      return !!(e && e.actions && e.actions.indexOf(name) !== -1);
    },
    // Les joueurs distants, dans l'ordre d'arrivée, autorité exclue : de quoi
    // attribuer un camp ou une couleur sans rien inventer.
    distants: function(){
      return NETWORK.joueurs.filter(function(id){ return id !== NETWORK.authority; });
    },
    // Déclare qu'un objet doit être répliqué par l'autorité.
    replicate: function(o){
      if(o && NETWORK.repliques.indexOf(o) === -1) NETWORK.repliques.push(o);
      return o;
    },
    join: function(code, base){ return networkJoin(base, code); },
    // HÉBERGER : crée un salon sur le relais puis le rejoint — on en devient l'autorité, étant
    // le premier arrivé. Rend {code, id, authority}. Le code est ce qu'on donne aux autres.
    host: function(base){ return networkHost(base); },
    // MESSAGES DE JEU LIBRES, relayés à tous les autres joueurs du salon. Le modèle « l'autorité
    // simule tout » ne convient pas à tout : un FPS rapide simule chaque joueur chez lui et ne
    // diffuse que sa pose et ses événements (tir, touche). `send(canal, données)` / `on(canal,
    // fn(données, idEmetteur))`. Canaux réservés : « $arrival » et « $leave » (fn(id)).
    send: function(channel, data){ return networkSend({type: 'custom', ch: String(channel), d: data}); },
    on: function(channel, fn){ return networkOn(channel, fn); },
    quit: networkQuit,
    // 'relay' | 'p2p' | 'p2p-fallback' : le chemin réel des messages de jeu.
    transport: networkTransport,
    // Dernier aller-retour mesuré, en ms (null avant la première mesure).
    ping: networkPing,
    // La cadence d'envoi du projet, en Hz : de quoi rythmer l'envoi de sa pose.
    sendRate: function(){ return (NETWORK.config || networkConfig()).sendRate; },
    // Joueurs max du salon (information : c'est le serveur qui refuse le joueur de trop).
    maxPlayers: function(){ return networkStatus().maxPlayers; }
  };
  return _handle;
}


// EXPOSÉ EN GLOBALE, à dessein. Ces symboles sont appelés depuis des fichiers
// que les mêmes pages ne chargent pas toutes : un `import` y pointerait un
// fichier absent, et la page ne démarrerait pas. Ils gardent donc leur garde
// `typeof` côté appelant, et se déclarent ici.
globalThis.networkActive = networkActive;
globalThis.networkApply = networkApply;
globalThis.networkBroadcast = networkBroadcast;
globalThis.networkHandle = networkHandle;
globalThis.networkIsAuthority = networkIsAuthority;
globalThis.networkJoin = networkJoin;
globalThis.networkHost = networkHost;
globalThis.networkOn = networkOn;
globalThis.networkQuit = networkQuit;
globalThis.networkSendInputs = networkSendInputs;
globalThis.networkConfig = networkConfig;
globalThis.networkStatus = networkStatus;
globalThis.networkTransport = networkTransport;
globalThis.networkPing = networkPing;
globalThis.sanitizeNetworkSettings = sanitizeNetworkSettings;
