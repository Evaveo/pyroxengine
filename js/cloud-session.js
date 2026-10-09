// ---------- Session cloud et mode de stockage du projet ----------
// Deux questions que l'éditeur ne se posait pas :
//
//   1. « Suis-je connecté à un compte ? » — l'éditeur servi par cloud/ partage l'origine de
//      l'API, donc le cookie de session. Une sonde sur /api/moi suffit à le savoir. L'éditeur
//      lancé seul (fichier local, serveur statique, open source) n'a pas d'API : la sonde
//      échoue, et c'est un mode NORMAL, pas une panne — rien n'est affiché.
//   2. « Où ce projet s'enregistre-t-il ? » — 'cloud', 'folder' ou 'unsaved', DÉDUIT de
//      project.cloud et project.handleFolder. Déduit et jamais stocké : un troisième drapeau
//      finirait par contredire les deux qui décident vraiment de l'aiguillage.
//
// Ce module ne touche NI au DOM NI à `project` directement : tout arrive en paramètre, pour
// être testé dans node sans navigateur (test/cloud-session.test.mjs). Le câblage est dans
// js/project-storage.js.

import { saveCloudProject } from './cloud-project.js';

export const cloudSession = {
  /** 'unknown' (sonde pas encore rendue) | 'logged-in' | 'anonymous' | 'offline' */
  state: 'unknown',
  /** { name, email } quand connecté, sinon null. */
  user: null
};

const listeners = new Set();
export function onSessionChange(fn){
  if(typeof fn === 'function') listeners.add(fn);
  return function(){ listeners.delete(fn); };
}
function setSession(state, user){
  cloudSession.state = state;
  cloudSession.user = user || null;
  for(const fn of listeners){ try { fn(cloudSession); } catch(e){ /* un écouteur ne casse pas la sonde */ } }
}

export function isLoggedIn(){ return cloudSession.state === 'logged-in'; }

/** Le nom affichable d'un compte rendu par /api/moi. */
export function displayNameOf(me){
  if(!me) return '';
  const full = [me.prenom, me['nom']].filter(Boolean).join(' ').trim();
  return full || me.email || 'compte';
}

/**
 * Sonde /api/moi. NE LÈVE JAMAIS : hors ligne, 404 (pas de serveur cloud), délai dépassé ou
 * réponse illisible, tout finit en 'offline' — le mode local, silencieux.
 * 401 = un serveur cloud répond mais personne n'est connecté : 'anonymous'.
 */
export async function probeSession(options){
  const opts = options || {};
  const fetchImpl = opts.fetchImpl || (typeof fetch === 'function' ? fetch : null);
  const timeoutMs = opts.timeoutMs || 2500;
  const base = (opts.base || '').replace(/\/$/, '');
  if(!fetchImpl){ setSession('offline', null); return cloudSession; }

  const ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
  let timer = null;
  const timeout = new Promise(function(resolve){
    timer = setTimeout(function(){ if(ctrl) ctrl.abort(); resolve('timeout'); }, timeoutMs);
  });
  try {
    const r = await Promise.race([
      fetchImpl(base + '/api/moi', { credentials: 'include', signal: ctrl ? ctrl.signal : undefined }),
      timeout
    ]);
    if(r === 'timeout' || !r){ setSession('offline', null); return cloudSession; }
    if(r.status === 401 || r.status === 403){ setSession('anonymous', null); return cloudSession; }
    if(!r.ok){ setSession('offline', null); return cloudSession; }
    const me = await r.json().catch(function(){ return null; });
    // Un serveur statique qui renverrait une page HTML en 200 n'est pas un compte.
    if(!me || typeof me !== 'object' || !(me.email || me['nom'] || me.prenom)){
      setSession('offline', null); return cloudSession;
    }
    setSession('logged-in', { name: displayNameOf(me), email: me.email || '' });
  } catch(e){
    setSession('offline', null);
  } finally {
    clearTimeout(timer);
  }
  return cloudSession;
}

// ---------- Mode de stockage ----------

/** 'cloud' | 'folder' | 'unsaved'. Le cloud prime : c'est lui que suit l'enregistrement. */
export function storageModeOf(project){
  if(project && project.cloud) return 'cloud';
  if(project && project.handleFolder) return 'folder';
  return 'unsaved';
}

/** Le texte et l'infobulle du badge de la barre du haut. */
export function storageBadgeOf(mode, project){
  const p = project || {};
  if(mode === 'cloud'){
    const name = p.name || ('projet ' + (p.cloud && p.cloud.id));
    return { text: '☁ Cloud — ' + name,
      title: 'Projet hébergé : Ctrl+S enregistre sur le serveur' };
  }
  if(mode === 'folder'){
    const name = (p.handleFolder && p.handleFolder.name) || p.name || '';
    return { text: '📁 Dossier — ' + name,
      title: 'Projet enregistré dans un dossier de votre disque' };
  }
  return { text: '⚠ Non enregistré',
    title: "Ce projet n'est enregistré nulle part : Ctrl+S propose le cloud, un dossier ou un fichier .p3d" };
}

/**
 * Ce que fait un enregistrement DEMANDÉ par l'utilisateur (Ctrl+S, bouton, menu).
 * 'unsaved' ne renvoie plus une erreur : il ouvre le choix de destination.
 */
export function saveActionFor(mode){
  if(mode === 'cloud') return 'cloud';
  if(mode === 'folder') return 'folder';
  return 'choose';
}

/** Les destinations proposées à un projet non enregistré, dans l'ordre d'affichage. */
export function saveChoicesFor(loggedIn){
  const out = [];
  if(loggedIn) out.push({ key: 'cloud', label: '☁ Cloud' });
  out.push({ key: 'folder', label: '📁 Dossier' });
  out.push({ key: 'p3d', label: '💾 Fichier .p3d' });
  return out;
}

/** Les entrées conditionnelles du menu Fichier, pour un mode et un état de session. */
export function storageMenuVisibility(mode, loggedIn){
  return {
    uploadToCloud: !!loggedIn && mode !== 'cloud',
    downloadLocal: mode === 'cloud',
    saveToFolder: mode !== 'cloud'
  };
}

// ---------- URL ----------

/** `search` avec ?projet=<id> posé (ou retiré si id est null), les autres paramètres gardés. */
export function searchWithProject(search, id){
  const params = new URLSearchParams(search || '');
  if(id === null || id === undefined) params.delete('projet');
  else params.set('projet', String(id));
  const s = params.toString();
  return s ? '?' + s : '';
}

// ---------- Envoi initial ----------

/**
 * Crée un projet hébergé et y envoie TOUT le projet local.
 *
 * Réutilise saveCloudProject() avec un manifeste de base VIDE : c'est lui qui hache, demande
 * au serveur ce qu'il a déjà (HEAD /api/assets/:sha) et ne dépose que le reste. Aucune
 * seconde logique de téléversement à tenir d'accord avec la première.
 *
 * @param files      { chemin -> string | Uint8Array } (serialization.js:collectProjectFiles)
 * @param api        cloudApi() — ou un double dans les tests
 * @param onProgress ({ step:'create'|'upload'|'tree', uploaded }) — optionnel
 * @returns { id, versionId, manifest }
 */
export async function uploadProjectToCloud({ name, files, api, onProgress }){
  const report = typeof onProgress === 'function' ? onProgress : function(){};
  report({ step: 'create', uploaded: 0 });
  const created = await api.createProject(name || 'Mon projet');
  const id = created && Number(created.id);
  if(!id) throw new Error('le serveur n\'a pas rendu d\'identifiant de projet');

  let uploaded = 0;
  const counting = Object.assign({}, api, {
    async putObject(sha, bytes){
      await api.putObject(sha, bytes);
      report({ step: 'upload', uploaded: ++uploaded });
    }
  });
  report({ step: 'upload', uploaded: 0 });
  const r = await saveCloudProject(id, { baseManifest: {}, changed: files }, null, counting,
    'Envoi initial depuis l\'éditeur');
  report({ step: 'tree', uploaded });
  return { id, versionId: r.version_id, manifest: r.files || null, uploaded };
}
