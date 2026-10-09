// moteur/js/mcp-link.js
//
// CÔTÉ ÉDITEUR DU PONT MCP. Relie cet onglet à `outils/mcp-bridge/bridge.mjs` par WebSocket, pour
// qu'une IA locale (Claude Desktop, Claude Code, LM Studio…) appelle les commandes du copilote.
//
// Le protocole est minuscule :
//   éditeur → pont : {type:'hello', token, catalog:[{name, description, input_schema, domain}], instructions, knowledge}
//   pont → éditeur : {type:'welcome'} | {type:'error', message}
//   pont → éditeur : {type:'call', id, name, input}
//   éditeur → pont : {type:'result', id, text, image?, isError}
//
// Les commandes passent par `runCopilotCommand`, donc par le même chemin que le copilote intégré :
// chaque mutation pose son point d'annulation (pushHistory) — Ctrl+Z défait ce que l'IA locale a fait.
// Le premier appel de la session demande le consentement explicite de l'utilisateur.
import { knowledgePayload } from './ai-guidelines.js';
import { domainOfTool } from './copilot-budget.js';
import { logConsole } from './console.js';
import { cloudSession, onSessionChange } from './cloud-session.js';

export const MCP_CONSENT_QUESTION = 'Autoriser l\'IA locale à modifier le projet ?';

/**
 * Le lien, sans DOM : tout ce qui touche au navigateur est injecté, ce qui le rend testable.
 * deps : {WebSocketCtor, getCatalog, run, confirm, instructions, log, onStatus}
 */
export function createMcpLink(deps){
  const link = {ws: null, status: 'déconnecté', consented: false, calls: 0};

  function setStatus(s){
    link.status = s;
    if(deps.onStatus) deps.onStatus(s);
  }
  function log(s){ if(deps.log) deps.log(s); }

  function catalogForBridge(){
    return (deps.getCatalog() || []).map(function(c){
      return {name: c.name, description: c.description, input_schema: c.input_schema,
        domain: domainOfTool(c.name)};
    });
  }

  function send(obj){
    if(link.ws && link.ws.readyState === 1) link.ws.send(JSON.stringify(obj));
  }

  async function handleCall(m){
    const reply = {type: 'result', id: m.id, text: '', isError: false};
    try {
      if(!link.consented){
        // UNE SEULE QUESTION À LA FOIS : les appels arrivés pendant qu'elle est posée attendent la
        // même réponse. Avant, chacun ouvrait son bandeau, et répondre à l'un laissait les autres
        // tomber en refus au milieu d'une suite de commandes (une sonde restait dans la scène).
        if(!link.consentPending){
          link.consentPending = Promise.resolve(deps.confirm(MCP_CONSENT_QUESTION))
            .then(function(v){ link.consentPending = null; return !!v; },
                  function(){ link.consentPending = null; return false; });
        }
        const ok = link.consented || await link.consentPending;
        if(!ok){
          reply.text = 'Refusé par l\'utilisateur : l\'IA locale n\'est pas autorisée à modifier le projet.';
          reply.isError = true;
          send(reply);
          return;
        }
        link.consented = true;
      }
      link.calls++;
      log('IA locale → ' + m.name);
      const res = await deps.run(m.name, m.input || {});
      if(res && typeof res === 'object'){
        reply.text = res.text !== undefined ? String(res.text) : '';
        if(res.image) reply.image = String(res.image);
      } else {
        reply.text = res === undefined ? '' : String(res);
      }
    } catch(e){
      reply.text = 'Erreur : ' + (e && e.message ? e.message : String(e));
      reply.isError = true;
      log('IA locale → ' + m.name + ' : ' + reply.text);
    }
    send(reply);
  }

  /** Pont local : ws://127.0.0.1:<port>, jeton dans le hello. */
  link.connect = function(port, token){
    open('ws://127.0.0.1:' + (Number(port) || 8765), {token: String(token || '')},
      'erreur de connexion (le pont est-il lancé ?)');
  };

  /** Relais cloud (ou toute URL) : l'authentification est portée par la session du navigateur,
   *  pas de jeton dans le hello. */
  link.connectUrl = function(url){
    open(String(url), {}, 'erreur de connexion au relais cloud');
  };

  function open(url, helloExtra, errorText){
    link.disconnect();
    let ws;
    try { ws = new deps.WebSocketCtor(url); }
    catch(e){ setStatus('erreur : ' + e.message); return; }
    link.ws = ws;
    setStatus('connexion…');
    ws.onopen = function(){
      ws.send(JSON.stringify(Object.assign({type: 'hello'}, helloExtra, {
        catalog: catalogForBridge(),
        instructions: typeof deps.instructions === 'function' ? deps.instructions() : (deps.instructions || ''),
        // Règles, guides et recettes du moteur, pour le relais cloud qui n'importe rien du moteur
        // (le pont local les importe lui-même, js/ai-guidelines.js) : ressources et prompts MCP.
        knowledge: knowledgePayload()})));
    };
    ws.onmessage = function(ev){
      let m;
      try { m = JSON.parse(ev.data); } catch(e){ return; }
      if(m.type === 'welcome'){ setStatus('connecté'); log('pont MCP connecté'); }
      else if(m.type === 'error') setStatus('refusé : ' + m.message);
      else if(m.type === 'call') handleCall(m);
    };
    ws.onerror = function(){ if(link.ws === ws) setStatus(errorText); };
    ws.onclose = function(ev){
      if(link.ws !== ws) return;
      link.ws = null;
      // 4003 : le relais cloud a donné la main à un autre onglet du même compte.
      if(ev && ev.code === 4003) setStatus('refusé : remplacé par un autre onglet de l’éditeur');
      else if(link.status === 'connecté' || link.status === 'connexion…') setStatus('déconnecté');
    };
  }

  link.disconnect = function(){
    const ws = link.ws;
    link.ws = null;
    if(ws){ try { ws.close(1000); } catch(e){} setStatus('déconnecté'); }
  };

  /** Renvoie le catalogue au pont (après l'enregistrement d'un plugin, par exemple). */
  link.refreshCatalog = function(){ send({type: 'catalog', catalog: catalogForBridge()}); };

  link.handleCall = handleCall;
  return link;
}

// ---------- Interface (dans les réglages du copilote) ----------

let sharedLink = null;
let statusView = null;

function storeGet(k){ try { return localStorage.getItem(k) || ''; } catch(e){ return ''; } }
function storeSet(k, v){ try { localStorage.setItem(k, v); } catch(e){} }

// Le navigateur ne peut pas lancer de processus : c'est le client IA (Claude Desktop, Claude
// Code, LM Studio…) qui démarre le pont, à partir de la configuration qu'on lui donne. L'éditeur
// fournit donc cette configuration toute prête (jeton compris), puis attend le pont en
// réessayant toutes les 3 s — dès que le client IA démarre, la connexion se fait seule.
function randomToken(){
  const a = new Uint8Array(16);
  try { crypto.getRandomValues(a); } catch(e){ for(let i = 0; i < a.length; i++) a[i] = Math.random() * 256; }
  return Array.from(a, function(b){ return b.toString(16).padStart(2, '0'); }).join('');
}

function bridgeConfigs(path, port, token){
  const desktop = JSON.stringify({mcpServers: {editeur3d: {command: 'node', args: [path],
    env: {MCP_BRIDGE_TOKEN: token, MCP_BRIDGE_PORT: String(port)}}}}, null, 2);
  const code = 'claude mcp add editeur3d -e MCP_BRIDGE_TOKEN=' + token + ' -e MCP_BRIDGE_PORT=' + port
    + ' -- node "' + path + '"';
  return {desktop: desktop, code: code};
}

let retryTimer = null;

/**
 * La question d'autorisation, posée DANS la page. `window.confirm()` ne convenait pas : Chrome rejette
 * aussitôt (réponse « non ») une boîte de dialogue venue d'un onglet qui n'est pas au premier plan —
 * or le premier appel d'une IA arrive justement pendant qu'on est dans une autre fenêtre. Le bandeau
 * attend qu'on réponde, quel que soit l'onglet actif au moment de l'appel.
 */
export function askInPage(question){
  return new Promise(function(resolve){
    if(typeof document === 'undefined' || !document.body){ resolve(false); return; }
    const box = document.createElement('div');
    box.className = 'mcp-consent';
    box.setAttribute('role', 'alertdialog');
    box.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:100000;'
      + 'background:var(--panel2,#2b2b30);color:var(--txt,#eee);border:1px solid var(--accent,#6aa0ff);'
      + 'border-radius:6px;padding:10px 14px;box-shadow:0 6px 24px rgba(0,0,0,.4);font-size:13px;display:flex;gap:10px;align-items:center';
    const text = document.createElement('span');
    text.textContent = question;
    const yes = document.createElement('button'), no = document.createElement('button');
    yes.className = no.className = 'btn-modal';
    yes.textContent = 'Autoriser'; no.textContent = 'Refuser';
    const done = function(v){ box.remove(); resolve(v); };
    yes.onclick = function(){ done(true); }; no.onclick = function(){ done(false); };
    box.append(text, yes, no);
    document.body.appendChild(box);
  });
}

/** Ajoute la section « Pilotage par une IA locale (MCP) » dans `container`. */
export function mountMcpSettings(container, opts){
  if(!container || container.querySelector('#mcp-link')) return;
  const box = document.createElement('div');
  box.id = 'mcp-link';
  box.innerHTML =
    '<div class="cop-note"><b>Pilotage par une IA (MCP)</b></div>'
    + '<div id="mcp-cloud"></div>'
    + '<details id="mcp-local"><summary>Pont local (hors ligne)</summary>'
    + '<div class="cop-note"><b>Pilotage par une IA locale (MCP)</b><br>'
    + '1. Copiez la configuration ci-dessous dans votre client IA (Claude Desktop, Claude Code…) : '
    + 'c’est <b>lui</b> qui lance le pont, le navigateur ne le peut pas.<br>'
    + '2. Cliquez sur « Attendre le pont », puis démarrez (ou redémarrez) le client IA.</div>'
    + '<div class="field"><label>Chemin de bridge.mjs</label><input type="text" id="mcp-path" spellcheck="false" '
    + 'placeholder="D:/…/moteur/outils/mcp-bridge/bridge.mjs"></div>'
    + '<div class="field"><label>Port</label><input type="number" id="mcp-port" min="1" max="65535"></div>'
    + '<div class="field"><label>Jeton</label><input type="text" id="mcp-token" spellcheck="false">'
    + '<button class="btn-modal" id="mcp-new-token" title="Nouveau jeton">↻</button></div>'
    + '<div class="field"><button class="btn-modal" id="mcp-copy-desktop">Copier la config Claude Desktop</button>'
    + '<button class="btn-modal" id="mcp-copy-code">Copier la commande Claude Code</button></div>'
    + '<div class="field"><button class="btn-modal" id="mcp-connect">Attendre le pont</button>'
    + '<button class="btn-modal" id="mcp-disconnect">Arrêter</button></div>'
    + '<div class="cop-note" id="mcp-status">État : déconnecté</div></details>';
  container.appendChild(box);
  mountCloudSection(box.querySelector('#mcp-cloud'), box.querySelector('#mcp-local'), opts);
  const pathEl = box.querySelector('#mcp-path');
  const portEl = box.querySelector('#mcp-port');
  const tokenEl = box.querySelector('#mcp-token');
  const statusEl = box.querySelector('#mcp-status');
  pathEl.value = storeGet('mcp-path');
  portEl.value = storeGet('mcp-port') || '8765';
  tokenEl.value = storeGet('mcp-token') || randomToken();
  const save = function(){
    storeSet('mcp-path', pathEl.value.trim()); storeSet('mcp-port', portEl.value); storeSet('mcp-token', tokenEl.value.trim());
  };
  save();
  [pathEl, portEl, tokenEl].forEach(function(el){ el.addEventListener('change', save); });

  const show = function(s){ statusEl.textContent = 'État : ' + s; };
  statusView = show;
  if(!sharedLink){
    sharedLink = createMcpLink({
      WebSocketCtor: globalThis.WebSocket,
      getCatalog: function(){ return globalThis.getCopilotCatalog ? globalThis.getCopilotCatalog() : []; },
      run: function(name, input){ return globalThis.runCopilotCommand(name, input); },
      confirm: askInPage,
      instructions: opts && opts.instructions,
      log: function(s){ logConsole('log', s, null); },
      onStatus: function(s){
        if(retryTimer && s !== 'connecté' && s !== 'connexion…' && !/^refusé/.test(s)) s = 'en attente du pont (le client IA est-il démarré ?)';
        // « déjà connecté » n'est PAS un refus définitif : c'est l'ancienne connexion que le pont n'a
        // pas encore libérée (réactivation, rechargement). On continue d'attendre, et la reconnexion
        // se fait seule ; seul un jeton refusé arrête les essais.
        if(/^refusé/.test(s) && !/déjà connecté/.test(s) && retryTimer){ clearInterval(retryTimer); retryTimer = null; }
        if(/^refusé/.test(s) && /déjà connecté/.test(s) && retryTimer) s = 'en attente : le pont libère l’ancienne connexion…';
        if(statusView) statusView(s);
      }
    });
  }
  show(sharedLink.status);

  const copy = function(text, what){
    const done = function(){ show(what + ' copiée dans le presse-papiers'); };
    try { navigator.clipboard.writeText(text).then(done, function(){ globalThis.prompt('Copiez :', text); }); }
    catch(e){ globalThis.prompt('Copiez :', text); }
  };
  const configs = function(){
    save();
    if(!pathEl.value.trim()){ show('indiquez d’abord le chemin de bridge.mjs'); return null; }
    return bridgeConfigs(pathEl.value.trim().replace(/\\/g, '/'), Number(portEl.value) || 8765, tokenEl.value.trim());
  };
  box.querySelector('#mcp-copy-desktop').addEventListener('click', function(){
    const c = configs(); if(c) copy(c.desktop, 'Configuration (claude_desktop_config.json)');
  });
  box.querySelector('#mcp-copy-code').addEventListener('click', function(){
    const c = configs(); if(c) copy(c.code, 'Commande');
  });
  box.querySelector('#mcp-new-token').addEventListener('click', function(){
    tokenEl.value = randomToken(); save(); show('nouveau jeton : recopiez la configuration dans le client IA');
  });
  box.querySelector('#mcp-connect').addEventListener('click', function(){
    save();
    if(retryTimer) clearInterval(retryTimer);
    const attempt = function(){
      if(sharedLink.status === 'connecté' || sharedLink.status === 'connexion…') return;
      sharedLink.connect(portEl.value, tokenEl.value.trim());
    };
    retryTimer = setInterval(attempt, 3000);
    attempt();
  });
  box.querySelector('#mcp-disconnect').addEventListener('click', function(){
    if(retryTimer){ clearInterval(retryTimer); retryTimer = null; }
    sharedLink.disconnect();
  });
}

// ---------- Mode « Via le cloud » ----------
// Éditeur hébergé : l'utilisateur n'a pas bridge.mjs sur son disque. Le serveur cloud tient le
// relais : l'onglet s'y connecte avec la session du compte (/api/mcp/ws), et l'IA appelle
// /api/mcp/t/<jeton> avec un jeton créé ici. Seules les URL clientes du service vivent dans le
// moteur (même principe que js/cloud-project.js) ; un éditeur sans cloud n'affiche pas ce mode.

/** URL du WebSocket de relais, même origine que la page. */
export function cloudSocketUrl(loc){
  return (loc.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + loc.host + '/api/mcp/ws';
}

/** L'URL MCP d'un jeton et les trois façons de la donner à une IA. */
export function cloudMcpSetup(origin, secret){
  const url = String(origin).replace(/\/$/, '') + '/api/mcp/t/' + secret;
  return {
    url: url,
    claude: url,
    claudeCode: 'claude mcp add --transport http editeur3d ' + url,
    stdio: 'npx -y mcp-remote ' + url
  };
}

let cloudLink = null;
let cloudRetry = null;
let cloudStatusView = null;
const CLOUD_ENABLED_KEY = 'mcp-cloud-enabled';

/** Message montré quand le serveur n'a pas les routes /api/mcp/* (serveur ancien encore lancé). */
export const MCP_RELAY_MISSING = 'Le serveur ne propose pas le relais MCP (serveur à mettre à jour / redémarrer)';
export const CLOUD_RETRY_MIN = 3000;
export const CLOUD_RETRY_MAX = 30000;

/** Délai suivant du repli exponentiel : 3 s, 6 s, 12 s… plafonné à 30 s. */
export function nextCloudDelay(previous){
  return previous ? Math.min(CLOUD_RETRY_MAX, previous * 2) : CLOUD_RETRY_MIN;
}

/**
 * La boucle de reconnexion au relais cloud, sans DOM ni minuterie globale (testable).
 * deps : {probe() → Promise<code HTTP>, connect(), isBusy() → bool, setTimer, clearTimer, onMissing()}
 *
 * Un WebSocket refusé ne dit pas POURQUOI : un 404 au handshake (serveur trop ancien) ressemble à
 * une coupure réseau. D'où la sonde `GET /api/mcp/editeur` avant chaque tentative : 404 → le relais
 * n'existe pas sur ce serveur, on s'arrête pour de bon au lieu de réessayer toutes les 3 s.
 * Tout autre échec : repli exponentiel, remis à zéro dès qu'une connexion a réussi.
 */
export function createCloudRetry(deps){
  const r = {timer: null, delay: 0, stopped: true, missing: false, wasConnected: false};
  function schedule(delay){
    if(r.stopped) return;
    if(r.timer) deps.clearTimer(r.timer);
    r.timer = deps.setTimer(attempt, delay);
  }
  async function attempt(){
    r.timer = null;
    if(r.stopped) return;
    if(!deps.isBusy()){
      let code = 0;
      try { code = await deps.probe(); } catch(e){ code = 0; }
      if(r.stopped) return;
      if(code === 404){
        r.missing = true;
        r.stopped = true;
        deps.onMissing();
        return;
      }
      deps.connect();
    }
    r.delay = nextCloudDelay(r.delay);
    schedule(r.delay);
  }
  r.start = function(){
    r.stop();
    r.stopped = false; r.missing = false; r.delay = 0; r.wasConnected = false;
    return attempt();
  };
  r.stop = function(){
    r.stopped = true;
    if(r.timer){ deps.clearTimer(r.timer); r.timer = null; }
  };
  /** Connexion établie : le repli repart de 3 s pour la prochaine coupure. */
  r.connected = function(){ r.wasConnected = true; r.delay = 0; };
  /** Coupure APRÈS une connexion réussie : réessayer vite, pas dans 30 s. */
  r.disconnected = function(){
    if(r.stopped || !r.wasConnected) return;
    r.wasConnected = false;
    r.delay = 0;
    schedule(CLOUD_RETRY_MIN);
  };
  return r;
}

function cloudApiCall(method, path, body){
  return fetch(path, {method: method, credentials: 'include',
    headers: body ? {'content-type': 'application/json'} : undefined,
    body: body ? JSON.stringify(body) : undefined}).then(function(r){
    return r.json().catch(function(){ return {}; }).then(function(j){
      if(!r.ok){
        const err = new Error(r.status === 404 ? MCP_RELAY_MISSING : (j.erreur || ('HTTP ' + r.status)));
        err.status = r.status;
        throw err;
      }
      return j;
    });
  });
}

/** Code HTTP de `GET /api/mcp/editeur` (0 si le réseau a échoué). */
function probeRelay(){
  return fetch('/api/mcp/editeur', {method: 'GET', credentials: 'include'})
    .then(function(r){ return r.status; }, function(){ return 0; });
}

function stopCloud(){
  if(cloudRetry) cloudRetry.stop();
  if(cloudLink) cloudLink.disconnect();
}

function relayMissing(){
  if(cloudRetry) cloudRetry.stop();
  if(cloudLink) cloudLink.disconnect();
  if(cloudStatusView) cloudStatusView(MCP_RELAY_MISSING);
}

function startCloud(opts){
  if(!cloudLink){
    cloudLink = createMcpLink({
      WebSocketCtor: globalThis.WebSocket,
      getCatalog: function(){ return globalThis.getCopilotCatalog ? globalThis.getCopilotCatalog() : []; },
      run: function(name, input){ return globalThis.runCopilotCommand(name, input); },
      confirm: askInPage,
      instructions: opts && opts.instructions,
      log: function(s){ logConsole('log', s, null); },
      onStatus: function(s){
        // Un autre onglet a pris la main : ne pas la lui reprendre à chaque tentative.
        if(/^refusé/.test(s)){ if(cloudRetry) cloudRetry.stop(); storeSet(CLOUD_ENABLED_KEY, ''); }
        else if(s === 'connecté'){ if(cloudRetry) cloudRetry.connected(); }
        else if(cloudRetry && !cloudRetry.stopped && s !== 'connexion…'){
          cloudRetry.disconnected();
          s = 'reconnexion au relais cloud…';
        }
        if(cloudStatusView) cloudStatusView(s);
      }
    });
  }
  if(!cloudRetry){
    cloudRetry = createCloudRetry({
      probe: probeRelay,
      connect: function(){ cloudLink.connectUrl(cloudSocketUrl(globalThis.location)); },
      isBusy: function(){ return cloudLink.status === 'connecté' || cloudLink.status === 'connexion…'; },
      setTimer: function(f, ms){ return setTimeout(f, ms); },
      clearTimer: function(t){ clearTimeout(t); },
      onMissing: relayMissing
    });
  }
  cloudRetry.start();
}

function el(tag, attrs, text){
  const e = document.createElement(tag);
  for(const k in (attrs || {})) e.setAttribute(k, attrs[k]);
  if(text !== undefined) e.textContent = text;
  return e;
}

function mountCloudSection(host, localDetails, opts){
  if(!host) return;
  host.innerHTML =
    '<div class="cop-note"><b>Via le cloud (recommandé)</b><br>'
    + '1. Cliquez « Connecter l’éditeur » (cet onglet reçoit les appels de l’IA).<br>'
    + '2. Créez une URL pour votre IA et collez-la dans son client. Rien à installer.</div>'
    + '<div class="field"><button class="btn-modal" id="mcp-cloud-connect">Connecter l’éditeur</button>'
    + '<button class="btn-modal" id="mcp-cloud-disconnect">Déconnecter</button></div>'
    + '<div class="cop-note" id="mcp-cloud-status">État : déconnecté</div>'
    + '<div class="field"><label>Nom</label><input type="text" id="mcp-cloud-name" spellcheck="false" placeholder="Claude, Claude Code…">'
    + '<button class="btn-modal" id="mcp-cloud-create">Créer une URL pour mon IA</button></div>'
    + '<div id="mcp-cloud-secret" hidden></div>'
    + '<div id="mcp-cloud-tokens"></div>';
  const statusEl = host.querySelector('#mcp-cloud-status');
  const secretEl = host.querySelector('#mcp-cloud-secret');
  const tokensEl = host.querySelector('#mcp-cloud-tokens');
  cloudStatusView = function(s){ statusEl.textContent = 'État : ' + s; };
  if(cloudLink) cloudStatusView(cloudLink.status);

  const copy = function(text, what){
    const done = function(){ cloudStatusView(what + ' copiée dans le presse-papiers'); };
    try { navigator.clipboard.writeText(text).then(done, function(){ globalThis.prompt('Copiez :', text); }); }
    catch(e){ globalThis.prompt('Copiez :', text); }
  };

  const renderTokens = function(){
    cloudApiCall('GET', '/api/mcp/jetons').then(function(j){
      tokensEl.textContent = '';
      const list = j.jetons || [];
      if(!list.length) return;
      tokensEl.appendChild(el('div', {class: 'cop-note'}, 'URL actives (le secret n’est montré qu’à la création) :'));
      list.forEach(function(t){
        const row = el('div', {class: 'field'});
        row.appendChild(el('span', null, t.name + ' — créée le ' + new Date(t.createdAt).toLocaleDateString()
          + (t.lastUsedAt ? ', utilisée le ' + new Date(t.lastUsedAt).toLocaleString() : ', jamais utilisée')));
        const revoke = el('button', {class: 'btn-modal'}, 'Révoquer');
        revoke.addEventListener('click', function(){
          if(!globalThis.confirm('Révoquer « ' + t.name + ' » ? L’IA qui l’utilise perdra l’accès.')) return;
          cloudApiCall('DELETE', '/api/mcp/jetons/' + t.id).then(renderTokens, function(e){ cloudStatusView('révocation impossible : ' + e.message); });
        });
        row.appendChild(revoke);
        tokensEl.appendChild(row);
      });
    }, function(e){
      // 404 : le serveur n'a pas le relais — inutile de proposer de s'y connecter.
      if(e.status === 404){ tokensEl.textContent = ''; relayMissing(); return; }
      tokensEl.textContent = 'Liste des URL indisponible : ' + e.message;
    });
  };

  const showSecret = function(secret){
    const s = cloudMcpSetup(globalThis.location.origin, secret);
    secretEl.hidden = false;
    secretEl.textContent = '';
    secretEl.appendChild(el('div', {class: 'cop-note'}, 'Votre URL (copiez-la maintenant, elle ne sera plus affichée) :'));
    const input = el('input', {type: 'text', readonly: '', spellcheck: 'false'});
    input.value = s.url;
    secretEl.appendChild(input);
    const row = el('div', {class: 'field'});
    [[s.claude, 'Claude (connecteur personnalisé)', 'URL'],
     [s.claudeCode, 'Claude Code', 'Commande'],
     [s.stdio, 'IA locale (stdio)', 'Commande']].forEach(function(c){
      const b = el('button', {class: 'btn-modal'}, 'Copier pour ' + c[1]);
      b.addEventListener('click', function(){ copy(c[0], c[2]); });
      row.appendChild(b);
    });
    secretEl.appendChild(row);
  };

  host.querySelector('#mcp-cloud-connect').addEventListener('click', function(){
    storeSet(CLOUD_ENABLED_KEY, '1'); startCloud(opts);
  });
  host.querySelector('#mcp-cloud-disconnect').addEventListener('click', function(){
    storeSet(CLOUD_ENABLED_KEY, ''); stopCloud(); if(cloudStatusView) cloudStatusView('déconnecté');
  });
  host.querySelector('#mcp-cloud-create').addEventListener('click', function(){
    const nameEl = host.querySelector('#mcp-cloud-name');
    // Le champ de l'API cloud est en français (comme ses chemins, voir js/cloud-project.js).
    const payload = {};
    payload['nom'] = nameEl.value.trim() || 'IA';
    cloudApiCall('POST', '/api/mcp/jetons', payload).then(function(j){
      showSecret(j.jeton.secret); nameEl.value = ''; renderTokens();
    }, function(e){ cloudStatusView('création impossible : ' + e.message); });
  });

  // Le mode cloud n'existe que si un compte est connecté ; sinon seul le pont local reste, déplié.
  const apply = function(){
    const on = cloudSession.state === 'logged-in';
    host.hidden = !on;
    if(localDetails) localDetails.open = !on;
    if(on){
      renderTokens();
      if(storeGet(CLOUD_ENABLED_KEY) === '1' && (!cloudRetry || cloudRetry.stopped)) startCloud(opts);
    } else if(cloudSession.state !== 'unknown'){
      stopCloud();
    }
  };
  onSessionChange(apply);
  apply();
}
