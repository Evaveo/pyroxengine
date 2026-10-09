// ---------- Fenêtre « Multijoueur » de l'éditeur (panneau du dock) ----------
// Remplace l'ancienne fenêtre modale ouverte par le bouton de la barre et son bandeau : un
// panneau comme les autres (dockable, flottant), en trois blocs.
//
//   1. RÉGLAGES DU PROJET — `project.settings.network` (js/project-settings.js,
//      projectNetworkSettings) : transport relais / pair-à-pair, serveur, clé de jeu, joueurs,
//      fréquence d'envoi, réplication, repli. Voyagent dans le build (data.build.network,
//      js/build.js).
//   2. SERVICE CLOUD — le service multijoueur du projet hébergé (cloud/back, routes
//      /api/projets/:id/reseau) : l'activer, sa clé, l'usage du mois. N'existe que pour un
//      projet ouvert depuis le cloud.
//   3. TESTER — créer / rejoindre une partie depuis l'éditeur, voir les joueurs, le transport
//      réellement utilisé et la latence.
//
// Ce fichier ne contient QUE de l'interface : toute la logique réseau reste dans le module
// partagé js/network-game.js.

import { escapeHtml } from './objects.js';
import { openPanelDock } from './ui.js';
import { createForm } from './ui/form.js';

export const btnNetwork = document.getElementById('btn-network');
export const networkPanel = { form: null, cloud: null, cloudError: '', timer: null, message: '', messageError: false };

const TRANSPORTS = [['relay', 'Relais cloud'], ['p2p', 'Pair-à-pair (WebRTC)']];
const REPLICATIONS = [['owner', 'Chacun simule son joueur'], ['authority', 'L’hôte simule tout']];

// Les réglages passent TOUJOURS par projectNetworkSettings : il nettoie (bornes, énumérations)
// et c'est la seule porte d'écriture, comme pour les autres réglages de projet.
function settings(){
  try { return (typeof projectNetworkSettings === 'function') ? projectNetworkSettings() : null; }
  catch(e){ return null; }
}
function patch(p){
  if(typeof projectNetworkSettings === 'function') projectNetworkSettings(p);
  refreshNetworkPanel();
}
function field(key, label, type, extra){
  return Object.assign({
    ids: ['f-net-' + key], label: label, type: type,
    get: function(){ const s = settings(); return s ? s[key] : undefined; },
    set: function(t, v){ const o = {}; o[key] = v; patch(o); }
  }, extra || {});
}

export const PANEL_NETWORK = {
  id: 'panel-network',
  sections: [
    { id: 'net-project', title: 'Réglages du projet', fields: [
      field('enabled', 'Multijoueur activé', 'checkbox', {
        help: 'Indicatif : un script peut toujours appeler api.network. Sert aux outils et au build.' }),
      field('transport', 'Transport', 'choice', { options: TRANSPORTS,
        help: 'Relais cloud : tout passe par le serveur (fiable, facturé au projet). Pair-à-pair : '
            + 'les joueurs se connectent à l’hôte en WebRTC ; le serveur ne sert qu’à la mise en '
            + 'relation. Certains réseaux bloquent le pair-à-pair : voir « Repli sur le relais ».' }),
      field('server', 'Serveur', 'text', {
        help: 'Adresse du cloud qui porte le relais (https://…). Vide : l’adresse d’où l’éditeur '
            + 'est servi. Un jeu publié sur itch.io exige une adresse PUBLIQUE en https.' }),
      field('gameKey', 'Clé de jeu', 'text', {
        help: 'La clé « mj_… » du service multijoueur du projet (bloc Service cloud ci-dessous). '
            + 'Sans elle, seuls les essais depuis l’éditeur sont acceptés.' }),
      field('maxPlayers', 'Joueurs max', 'number', { min: 1, max: 32, step: 1 }),
      field('sendRate', 'Envois / seconde', 'number', { min: 5, max: 60, step: 1,
        help: 'Fréquence des poses et instantanés (api.network.sendRate()). Plus haut = plus fluide '
            + 'et plus de bande passante.' }),
      field('replication', 'Réplication', 'choice', { options: REPLICATIONS,
        help: 'Chacun simule son joueur : le modèle des FPS rapides (api.network.send/on). L’hôte '
            + 'simule tout : les autres envoient leurs entrées (api.isAuthority()).' }),
      field('p2pFallbackRelay', 'Repli sur le relais', 'checkbox', {
        visible: function(){ const s = settings(); return !!s && s.transport === 'p2p'; },
        help: 'Si la connexion pair-à-pair n’aboutit pas en 5 s, les messages passent par le relais.' })
    ]}
  ]
};

// ---------- service cloud du projet ----------
function cloudProjectId(){
  const p = globalThis.project;
  return p && p.cloud && p.cloud.id ? p.cloud.id : null;
}
async function cloudCall(method, path, body){
  const r = await fetch(path, { method: method, credentials: 'include',
    headers: body ? {'content-type': 'application/json'} : undefined, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(function(){ return {}; });
  if(!r.ok) throw new Error(d.erreur || ('HTTP ' + r.status));
  return d;
}
async function loadCloud(){
  const id = cloudProjectId();
  if(!id){ networkPanel.cloud = null; networkPanel.cloudError = ''; return; }
  try { networkPanel.cloud = await cloudCall('GET', '/api/projets/' + id + '/reseau'); networkPanel.cloudError = ''; }
  catch(e){ networkPanel.cloud = null; networkPanel.cloudError = e.message; }
}
async function cloudAction(fn){
  try {
    networkPanel.cloud = await fn(); networkPanel.cloudError = '';
    // la clé du service devient celle du projet : un build exporté ensuite la porte
    if(networkPanel.cloud && networkPanel.cloud.cle) patch({gameKey: networkPanel.cloud.cle});
  } catch(e){ networkPanel.cloudError = e.message; }
  renderCloud();
}

function renderCloud(){
  const el = document.getElementById('net-cloud');
  if(!el) return;
  const id = cloudProjectId();
  if(!id){
    el.innerHTML = '<p class="net-dim">Projet local : le service multijoueur s’active sur un projet hébergé '
      + 'dans le cloud. Le pair-à-pair et le relais d’un serveur que vous indiquez restent utilisables.</p>';
    return;
  }
  const c = networkPanel.cloud;
  if(!c){
    el.innerHTML = networkPanel.cloudError
      ? '<p class="net-err">' + escapeHtml(networkPanel.cloudError) + '</p><button class="net-btn" data-net="cloud-reload">Réessayer</button>'
      : '<p class="net-dim">Chargement…</p>';
    return;
  }
  const u = c.usage || {}, q = c.quotas || {};
  const minutes = Math.round((u.secondes || 0) / 60);
  el.innerHTML = ''
    + '<div class="net-row"><span>Service</span><b class="' + (c.active ? 'net-ok' : 'net-dim') + '">'
    + (c.active ? 'actif' : 'inactif') + '</b>'
    + '<button class="net-btn" data-net="cloud-toggle">' + (c.active ? 'Désactiver' : 'Activer') + '</button></div>'
    + (c.cle ? '<div class="net-row"><span>Clé</span><code class="net-key">' + escapeHtml(c.cle) + '</code>'
      + '<button class="net-btn" data-net="cloud-copy">Copier</button>'
      + '<button class="net-btn" data-net="cloud-rotate">Régénérer</button></div>' : '')
    + '<div class="net-row"><span>Sites autorisés</span><span class="net-dim">'
    + escapeHtml((c.origines || []).join(', ') || 'tous') + '</span></div>'
    + '<div class="net-row"><span>Ce mois</span><span>' + minutes + ' / ' + (q.minutes_joueur_mois || '?')
    + ' min-joueur · ' + (u.salons || 0) + ' partie(s)</span></div>'
    + '<div class="net-row"><span>Parties simultanées</span><span>' + (q.salons_simultanes || '?') + ' max</span></div>'
    + '<p class="net-dim">Les sites autorisés se règlent sur le tableau de bord du cloud (projet → Multijoueur).</p>'
    + (networkPanel.cloudError ? '<p class="net-err">' + escapeHtml(networkPanel.cloudError) + '</p>' : '');
}

// ---------- tester une partie ----------
function setMessage(t, err){ networkPanel.message = t || ''; networkPanel.messageError = !!err; renderTest(); }

async function testHost(){
  setMessage('Création de la partie…');
  try { const r = await networkHost(); setMessage('Partie ' + r.code + ' créée. Donnez le code aux autres.'); }
  catch(e){ setMessage('Échec : ' + e.message, true); }
}
async function testJoin(){
  const input = document.getElementById('net-code');
  const code = (input && input.value || '').trim().toUpperCase();
  if(code.length < 4){ setMessage('Code trop court.', true); return; }
  setMessage('Connexion à ' + code + '…');
  try { await networkJoin(undefined, code); setMessage('Connecté à ' + code + '.'); }
  catch(e){ setMessage('Échec : ' + (e && e.message ? e.message : 'partie introuvable ou serveur injoignable'), true); }
}

function transportLabel(t){
  return t === 'p2p' ? 'pair-à-pair' : t === 'p2p-fallback' ? 'pair-à-pair → repli relais' : 'relais cloud';
}

// Un relais http:// ou localhost marche dans l'éditeur, jamais pour un jeu publié ailleurs.
function serverWarning(){
  const cfg = (typeof networkConfig === 'function') ? networkConfig() : null;
  const s = (cfg && cfg.server) || location.origin;
  if(/localhost|127\.0\.0\.1/.test(s)) return 'Serveur local (' + s + ') : les autres joueurs ne pourront pas le joindre depuis un jeu publié.';
  if(/^http:\/\//.test(s)) return 'Serveur en http:// : un jeu publié en https (itch.io…) ne pourra pas s’y connecter.';
  return '';
}

function renderTest(){
  const el = document.getElementById('net-test');
  if(!el) return;
  const st = (typeof networkStatus === 'function') ? networkStatus() : {active: false, players: []};
  // ne pas écraser le champ pendant qu'on y tape
  if(!st.active && document.activeElement && document.activeElement.id === 'net-code') return;
  const warn = serverWarning();
  let html = warn ? '<p class="net-warn">' + escapeHtml(warn) + '</p>' : '';
  if(st.active){
    html += '<div class="net-row"><span>Partie</span><b class="net-code">' + escapeHtml(st.code || '?') + '</b>'
      + '<button class="net-btn" data-net="copy-code">Copier</button></div>'
      + '<div class="net-row"><span>Rôle</span><span>' + (st.isAuthority ? 'hôte (autorité)' : 'invité') + '</span></div>'
      + '<div class="net-row"><span>Transport</span><span>' + transportLabel(st.transport) + '</span></div>'
      + '<div class="net-row"><span>Latence</span><span>'
      + (st.ping === null || st.ping === undefined ? '…' : Math.round(st.ping) + ' ms') + '</span></div>'
      + '<div class="net-row"><span>Joueurs</span><span>' + st.players.length + ' / ' + (st.maxPlayers || '?') + '</span></div>'
      + '<ul class="net-players">' + st.players.map(function(id){
        return '<li>' + escapeHtml(id) + (id === st.me ? ' <i>(vous)</i>' : '') + (id === st.authority ? ' <i>· hôte</i>' : '') + '</li>';
      }).join('') + '</ul>'
      + '<button class="net-btn danger" data-net="quit">Quitter la partie</button>';
  } else {
    html += '<div class="net-row"><button class="net-btn accent" data-net="host">Créer une partie</button></div>'
      + '<div class="net-row"><input id="net-code" class="net-input" maxlength="8" placeholder="CODE" spellcheck="false">'
      + '<button class="net-btn" data-net="join">Rejoindre</button></div>'
      + '<p class="net-dim">Pour jouer à plusieurs, lancez le jeu (▶) dans chaque onglet : le menu du jeu crée '
      + 'ou rejoint lui-même la partie. Ce bloc sert à essayer la connexion depuis l’éditeur.</p>';
  }
  if(networkPanel.message){
    html += '<p class="' + (networkPanel.messageError ? 'net-err' : 'net-dim') + '">' + escapeHtml(networkPanel.message) + '</p>';
  }
  el.innerHTML = html;
}

// ---------- montage ----------
export function buildNetworkPanel(){
  const host = document.getElementById('network-panel');
  if(!host) return;
  host.innerHTML = ''
    + '<div id="net-form"></div>'
    + '<div class="net-block"><div class="net-title">Service cloud</div><div id="net-cloud"></div></div>'
    + '<div class="net-block"><div class="net-title">Tester une partie</div><div id="net-test"></div></div>';
  if(settings()){
    networkPanel.form = createForm(document.getElementById('net-form'), PANEL_NETWORK);
    networkPanel.form.setTargets([{}]);
  } else {
    networkPanel.form = null;
    document.getElementById('net-form').innerHTML = '<p class="net-dim">Ouvrez un projet pour régler le multijoueur.</p>';
  }
  host.onclick = function(e){
    const b = e.target.closest ? e.target.closest('[data-net]') : null;
    if(!b) return;
    const a = b.dataset.net, id = cloudProjectId();
    if(a === 'host') testHost();
    else if(a === 'join') testJoin();
    else if(a === 'quit'){ networkQuit(); setMessage(''); }
    else if(a === 'copy-code'){ const st = networkStatus(); if(navigator.clipboard) navigator.clipboard.writeText(st.code || ''); }
    else if(a === 'cloud-reload') loadCloud().then(renderCloud);
    else if(a === 'cloud-toggle' && id){
      cloudAction(function(){ return cloudCall('PUT', '/api/projets/' + id + '/reseau', {active: !networkPanel.cloud.active}); });
    } else if(a === 'cloud-rotate' && id){
      if(confirm('Régénérer la clé ? Les jeux déjà exportés avec l’ancienne clé ne pourront plus créer de partie.')){
        cloudAction(function(){ return cloudCall('POST', '/api/projets/' + id + '/reseau/cle'); });
      }
    } else if(a === 'cloud-copy' && networkPanel.cloud && navigator.clipboard){
      navigator.clipboard.writeText(networkPanel.cloud.cle || '');
    }
  };
  renderCloud(); renderTest();
  loadCloud().then(renderCloud);
}

/** Resynchronise les champs et l'état (appelé après un changement de réglage ou de projet). */
export function refreshNetworkPanel(){
  if(networkPanel.form) networkPanel.form.sync();
  renderTest();
  updateNetworkButton();
}

// Le bouton de la barre ne fait plus qu'ouvrir la fenêtre, et montre qu'une partie est en cours.
export function updateNetworkButton(){
  if(!btnNetwork) return;
  const on = typeof networkActive === 'function' && networkActive();
  btnNetwork.classList.toggle('active', on);
  btnNetwork.title = on ? 'Multijoueur — partie en cours' : 'Multijoueur : réglages, service cloud, essai de connexion';
}

export function openNetworkPanel(){
  buildNetworkPanel();
  openPanelDock('network');
  if(!networkPanel.timer){
    // l'état d'une partie (joueurs, latence) bouge seul : on le relit tant que le panneau est visible
    networkPanel.timer = setInterval(function(){
      updateNetworkButton();
      const host = document.getElementById('network-panel');
      if(!host || host.offsetParent === null) return;
      if(typeof networkActive === 'function' && networkActive() && typeof networkPing === 'function') networkPing();
      renderTest();
    }, 1000);
  }
}

if(btnNetwork) btnNetwork.addEventListener('click', openNetworkPanel);
setInterval(updateNetworkButton, 2000);

globalThis.openNetworkPanel = openNetworkPanel;
globalThis.buildNetworkPanel = buildNetworkPanel;
globalThis.refreshNetworkPanel = refreshNetworkPanel;
