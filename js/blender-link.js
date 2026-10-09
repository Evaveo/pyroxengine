// ---------- La liaison avec Blender ----------
//
// Le moteur parle DIRECTEMENT à l'addon « EVAVEO Blender Bridge » (outils/blender-addon/), qui
// tient un petit serveur HTTP sur 127.0.0.1. Plus de Studio Python, plus de blender-mcp : deux
// maillons au lieu de cinq.
//
// Ce module est le SEUL endroit qui fait une requête vers Blender. Les commandes MCP
// (copilot-blender.js) et le panneau Atelier Blender (blender-workshop.js) passent par lui — c'est
// ce qui garantit qu'ils voient les mêmes bornes. Elles sont reprises de l'ancien plugin Studio :
//
//   · L'ADRESSE EST FIXE : http://127.0.0.1:<port>. Seul le port se règle, et c'est un entier.
//     Aucune saisie ne peut faire partir une requête (et le jeton avec) vers un autre hôte.
//   · UN GLB EST VÉRIFIÉ avant d'entrer dans le projet : signature `glTF`, 256 Mo au plus.
//   · LES CHEMINS VIENNENT DE L'ADDON (résultats de ses opérations), jamais d'une saisie. Et
//     l'addon les reconfine de son côté (guards.scoped_file).
//
// Via le MCP cloud, le jeton Blender NE QUITTE JAMAIS le navigateur : le cloud relaie une
// commande à l'onglet, et c'est l'onglet qui l'ajoute en appelant 127.0.0.1.

export const BLENDER_PROTOCOL = 1;
export const BLENDER_DEFAULT_PORT = 9877;
export const BLENDER_MAX_BYTES = 256 * 1024 * 1024;
const KEY_PORT = 'blender-link-port';
const KEY_TOKEN = 'blender-link-token';

function readPref(key){
  // Sans localStorage (tests node, stockage bloqué), la lecture lève : on part de zéro.
  try { return localStorage.getItem(key) || ''; }
  catch(e){ return ''; }
}
function writePref(key, value){
  try { localStorage.setItem(key, value); }
  catch(e){ /* stockage bloqué : la liaison marche pour la session */ }
}

const state = {
  port: Number(readPref(KEY_PORT)) || BLENDER_DEFAULT_PORT,
  token: readPref(KEY_TOKEN),
  hello: null,
  lastError: '',
  log: [],
  listeners: []
};

// Injectables pour les tests (node:test n'a ni fenêtre ni Blender).
let fetchImpl = function(url, opts){ return fetch(url, opts); };
let sleepImpl = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
export function setBlenderTransport(opts){
  if(opts && opts.fetch) fetchImpl = opts.fetch;
  if(opts && opts.sleep) sleepImpl = opts.sleep;
}

/** L'URL de base. Un port qui n'est pas un entier de 1024 à 65535 est refusé. */
export function blenderBaseUrl(port){
  const p = Number(port);
  if(!Number.isInteger(p) || p < 1024 || p > 65535){
    throw new Error('port Blender invalide : un entier de 1024 à 65535 est attendu');
  }
  return 'http://127.0.0.1:' + p;
}

/** Les octets sont-ils un GLB ? Signature `glTF` en tête du conteneur binaire. */
export function isGlb(bytes){
  if(!bytes || bytes.byteLength < 12) return false;
  const t = new Uint8Array(bytes, 0, 4);
  return t[0] === 0x67 && t[1] === 0x6c && t[2] === 0x54 && t[3] === 0x46;
}

function notify(){
  state.listeners.slice().forEach(function(fn){
    try { fn(blenderStatus()); } catch(e){ /* un écouteur fautif n'arrête pas les autres */ }
  });
}

function logCall(op, action, ok, detail){
  state.log.unshift({at: Date.now(), op: op, action: action || '', ok: ok, detail: detail || ''});
  if(state.log.length > 20) state.log.length = 20;
  notify();
}

export function configureBlender(opts){
  if(opts.port !== undefined){
    blenderBaseUrl(opts.port);
    state.port = Number(opts.port);
    writePref(KEY_PORT, String(state.port));
  }
  if(opts.token !== undefined){
    state.token = String(opts.token).trim();
    writePref(KEY_TOKEN, state.token);
  }
  state.hello = null;
  notify();
}

export function blenderStatus(){
  return {port: state.port, hasToken: !!state.token, connected: !!state.hello,
    hello: state.hello, lastError: state.lastError, log: state.log.slice()};
}

export function onBlenderChange(fn){
  state.listeners.push(fn);
  return function(){ state.listeners = state.listeners.filter(function(x){ return x !== fn; }); };
}

async function request(path, opts){
  const o = opts || {};
  const headers = Object.assign({}, o.headers || {});
  if(o.auth !== false){
    if(!state.token){
      throw new Error('jeton Blender absent : copier le jeton dans Blender (barre latérale → EVAVEO) '
        + 'et le coller dans Fenêtres → Atelier Blender');
    }
    headers.Authorization = 'Bearer ' + state.token;
  }
  let r;
  try {
    r = await fetchImpl(blenderBaseUrl(state.port) + path, {method: o.method || 'GET', headers: headers, body: o.body});
  } catch(e){
    state.hello = null;
    state.lastError = 'Blender injoignable sur 127.0.0.1:' + state.port
      + ' — Blender est-il ouvert, avec la liaison EVAVEO démarrée ?';
    notify();
    throw new Error(state.lastError);
  }
  if(o.binary && r.ok) return r.arrayBuffer();
  let data = null;
  try { data = await r.json(); } catch(e){ data = null; }
  if(!r.ok || (data && data.ok === false)){
    const msg = (data && data.error) || ('Blender a répondu ' + r.status);
    if(r.status === 401){ state.hello = null; state.lastError = msg; notify(); }
    throw new Error(msg);
  }
  if(!data) throw new Error('réponse de Blender illisible (JSON attendu)');
  return data;
}

/** Vérifie la liaison : version du protocole, puis le jeton (par un appel qui l'exige). */
export async function blenderHello(){
  const h = await request('/hello', {auth: false});
  if(h.protocol !== BLENDER_PROTOCOL){
    state.hello = null;
    state.lastError = 'addon Blender incompatible (protocole ' + h.protocol + ', le moteur parle '
      + BLENDER_PROTOCOL + ') : réinstaller l\'addon depuis Fenêtres → Atelier Blender';
    notify();
    throw new Error(state.lastError);
  }
  await request('/log');
  state.hello = h;
  state.lastError = '';
  notify();
  return h;
}

export function blenderJob(id){
  if(!/^[0-9a-f]{32}$/.test(String(id || ''))) return Promise.reject(new Error('identifiant de job invalide'));
  return request('/job/' + id);
}

/**
 * Suit un job jusqu'au bout, ou jusqu'à `timeoutMs` (null : sans limite). Rend `{result}`,
 * `{error}` ou `{pending: true}`.
 */
export async function followJob(id, opts){
  const o = opts || {};
  const start = Date.now();
  let transient = 0;
  for(;;){
    let j = null;
    // Sous Windows, l'addon remplace le fichier d'état pendant qu'on le lit : une erreur
    // d'accès isolée n'est pas l'échec de la tâche. Cinq de suite, si.
    try { j = await blenderJob(id); transient = 0; }
    catch(e){
      if(!/inconnu/i.test(e.message) && ++transient >= 5) throw e;
    }
    if(j){
      if(o.onProgress) o.onProgress({fraction: j.progress || 0, message: j.message || ''});
      if(j.state === 'succeeded') return {result: j.result};
      if(j.state === 'failed') return {error: j.error || j.message || 'échec dans Blender'};
    }
    if(o.timeoutMs !== null && o.timeoutMs !== undefined && Date.now() - start > o.timeoutMs) return {pending: true};
    await sleepImpl(500);
  }
}

/**
 * Appelle une opération du pipeline. Les opérations lourdes rendent un job : on le suit jusqu'au
 * bout, ou jusqu'à `timeoutMs` — au-delà, on rend `{pending: job_id}` pour que l'appelant (une IA
 * par MCP, dont la requête a sa propre limite de temps) revienne le chercher avec blender_status.
 */
export async function blenderCall(op, args, opts){
  const o = opts || {};
  const timeoutMs = o.timeoutMs === undefined ? 60000 : o.timeoutMs;
  const action = args && args.action;
  let res;
  try {
    res = await request('/call', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({op: op, args: args || {}})});
  } catch(e){
    logCall(op, action, false, e.message);
    throw e;
  }
  if(!res.job_id){
    logCall(op, action, true, '');
    return res.result !== undefined ? res.result : res;
  }
  const out = await followJob(res.job_id, {timeoutMs: timeoutMs, onProgress: o.onProgress});
  logCall(op, action, !out.error, out.error || (out.pending ? 'en cours' : ''));
  if(out.error) throw new Error(out.error);
  return out.pending ? {pending: res.job_id} : out.result;
}

/** Rapatrie un fichier produit par l'addon. */
export async function blenderFetchFile(path){
  const bytes = await request('/file?path=' + encodeURIComponent(String(path)), {binary: true});
  if(bytes.byteLength > BLENDER_MAX_BYTES) throw new Error('fichier de plus de 256 Mo refusé');
  return bytes;
}

/** Envoie un fichier dans le dossier de travail de Blender (uploads/). Rend son chemin relatif. */
export async function blenderUpload(name, bytes){
  if(bytes.byteLength > BLENDER_MAX_BYTES) throw new Error('fichier de plus de 256 Mo refusé');
  const r = await request('/upload?name=' + encodeURIComponent(String(name)), {method: 'POST',
    headers: {'Content-Type': 'application/octet-stream'}, body: bytes});
  logCall('upload', name, true, '');
  return r.path;
}

/** Rapatrie un GLB et le vérifie : `{name, bytes}`, prêt pour `new File(...)` puis importFiles. */
export async function blenderFetchGlb(path){
  const bytes = await blenderFetchFile(path);
  const name = String(path).split(/[\\/]/).pop();
  if(!isGlb(bytes)){
    throw new Error(name + ' n\'est pas un GLB (signature glTF absente) : rien n\'a été importé');
  }
  return {name: name, bytes: bytes};
}

export const BlenderLink = {
  configure: configureBlender, status: blenderStatus, hello: blenderHello, call: blenderCall,
  job: blenderJob, followJob: followJob, fetchFile: blenderFetchFile, fetchGlb: blenderFetchGlb,
  upload: blenderUpload, onChange: onBlenderChange
};
