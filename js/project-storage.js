// ---------- Où le projet s'enregistre : badge, choix de destination, envoi / copie ----------
// Le câblage DOM de js/cloud-session.js. Trois gestes nouveaux :
//
//   - « Envoyer sur le cloud… »   : un projet local (dossier ou jamais enregistré) devient un
//                                   projet hébergé — même état final qu'une ouverture par
//                                   ?projet=N (project.js:openCloudProjectFromUrl).
//   - « Télécharger en local… »   : une COPIE DÉTACHÉE d'un projet hébergé, dans un dossier ou
//                                   un .p3d. Après coup, le projet ouvert n'est plus relié au
//                                   cloud : enregistrer n'écrit plus sur le serveur.
//   - « Enregistrer dans un dossier… » : un projet jamais ouvert depuis un dossier en gagne un.
//
// Et Ctrl+S / le bouton d'état sur un projet 'unsaved' proposent une destination au lieu de
// répondre « Aucun dossier de projet ouvert ». L'autosave, lui, passe toujours par
// registerInProjectOpen() et n'ouvre jamais de fenêtre.
//
// Sans serveur cloud, la sonde échoue en silence et seules les entrées locales apparaissent.

import { cloudApi } from './cloud-project.js';
import {
  cloudSession, isLoggedIn, onSessionChange, probeSession, saveActionFor, saveChoicesFor,
  searchWithProject, storageBadgeOf, storageModeOf, uploadProjectToCloud
} from './cloud-session.js';
import { setStatus } from './hierarchy.js';
import { pushHistory } from './history.js';
import { endSave, markProjectSaved, startSave } from './project-dirty.js';
import { openFolderProject, writeFileInFolder } from './project-folder.js';
import { project, scheduleFolderWatch } from './project.js';
import { registerProjectRecent } from './recents.js';
import { initSceneLock, releaseLock } from './scene-lock.js';
import { collectProjectFiles, registerInProjectOpen, registerScene } from './serialization.js';
import { resetWriteCache } from './write-cache.js';

export function currentStorageMode(){ return storageModeOf(project); }

// ---------- Badge de la barre du haut ----------
let lastBadge = '';
export function refreshStorageBadge(){
  if(typeof document === 'undefined') return;
  const el = document.getElementById('storage-badge');
  if(!el) return;
  const mode = currentStorageMode();
  const b = storageBadgeOf(mode, project);
  const key = mode + '|' + b.text;
  if(key === lastBadge) return;
  lastBadge = key;
  el.textContent = b.text;
  el.title = b.title;
  el.dataset.mode = mode;
}
globalThis.refreshStorageBadge = refreshStorageBadge;

// ---------- Enregistrer (geste utilisateur) ----------
export async function saveProject(){
  const action = saveActionFor(currentStorageMode());
  if(action === 'choose') return openSaveChoice();
  return registerInProjectOpen();
}

function modalBody(){ return document.getElementById('modal-body'); }

/** Petite fenêtre de choix : rend la clé cliquée, ou null si fermée. */
function chooseInModal(title, intro, choices){
  return new Promise(function(resolve){
    if(typeof globalThis.openModal !== 'function'){ resolve(null); return; }
    const buttons = choices.map(function(c){
      return '<button type="button" class="storage-choice" data-key="' + c.key + '" '
        + 'style="margin:4px 6px 0 0">' + c.label + '</button>';
    }).join('');
    globalThis.openModal(title, '<p>' + intro + '</p><div style="margin-top:10px">' + buttons + '</div>');
    let done = false;
    const body = modalBody();
    const modal = document.getElementById('modal');
    // Fermer la fenêtre (croix, clic dehors) sans choisir = annuler.
    const observer = (typeof MutationObserver === 'function' && modal) ? new MutationObserver(function(){
      if(!modal.classList.contains('open') && !done){ done = true; observer.disconnect(); resolve(null); }
    }) : null;
    if(observer) observer.observe(modal, {attributes: true, attributeFilter: ['class']});
    body.querySelectorAll('.storage-choice').forEach(function(btn){
      btn.addEventListener('click', function(){
        if(done) return;
        done = true;
        if(observer) observer.disconnect();
        globalThis.closeModal();
        resolve(btn.dataset.key);
      });
    });
  });
}

export async function openSaveChoice(){
  const loggedIn = isLoggedIn();
  const key = await chooseInModal('Enregistrer le projet',
    "Ce projet n'est encore enregistré nulle part. Où voulez-vous l'enregistrer ?"
      + (loggedIn ? '' : ' (Connectez-vous à votre compte pour l\'enregistrer sur le cloud.)'),
    saveChoicesFor(loggedIn));
  if(key === 'cloud') return uploadToCloud();
  if(key === 'folder') return saveToFolder();
  if(key === 'p3d') return registerScene();
}

// ---------- Écriture complète dans un dossier ----------

/** Choisit un dossier et y écrit TOUT le projet. Rend le handle, ou null si annulé. */
async function writeWholeProjectToPickedFolder(){
  let handle;
  try {
    handle = await openFolderProject();
  } catch(e){
    if(e.name !== 'AbortError') setStatus('Erreur : ' + e.message, 6000);
    return null;
  }
  let hasProject = true;
  try { await handle.getFileHandle('project.json'); }
  catch(e){ hasProject = false; }
  if(hasProject && !confirm('Le dossier « ' + handle.name + ' » contient déjà un projet. '
    + 'Ses fichiers seront remplacés par ceux du projet ouvert. Continuer ?')) return null;

  const report = startSave();
  try {
    const files = await collectProjectFiles();
    const paths = Object.keys(files);
    report('manifest', 1);
    let n = 0;
    for(const p of paths){
      await writeFileInFolder(handle, p, files[p]);
      report('files', ++n / paths.length);
    }
  } catch(e){
    setStatus("L'écriture dans le dossier a échoué : " + e.message, 8000);
    return null;
  } finally {
    endSave();
  }
  return handle;
}

/** Fait du dossier écrit le dossier du projet ouvert : l'enregistrement suivant y va. */
async function adoptFolder(handle){
  project.handleFolder = handle;
  resetWriteCache();
  markProjectSaved();
  try { await registerProjectRecent(handle); } catch(e){ /* un récent manquant n'empêche rien */ }
  try { scheduleFolderWatch(); } catch(e){ /* surveillance facultative */ }
  refreshStorageBadge();
}

export async function saveToFolder(){
  if(currentStorageMode() === 'cloud') return downloadLocal();
  const handle = await writeWholeProjectToPickedFolder();
  if(!handle) return;
  await adoptFolder(handle);
  setStatus('Projet enregistré dans le dossier « ' + handle.name + ' ».', 3000);
}

// ---------- Détacher un projet hébergé ----------
async function detachFromCloud(){
  try { await releaseLock(); } catch(e){ /* le bail expirera */ }
  project.cloud = null;
  initSceneLock(null, null);
  if(typeof history !== 'undefined' && typeof location !== 'undefined'){
    history.replaceState(null, '', location.pathname + searchWithProject(location.search, null) + location.hash);
  }
  refreshStorageBadge();
}

export async function downloadLocal(){
  if(currentStorageMode() !== 'cloud'){ return saveToFolder(); }
  if(!confirm('Télécharger une copie locale du projet ?\n\n'
    + 'La copie sera DÉTACHÉE du cloud : une fois téléchargée, le projet ouvert ne sera plus '
    + 'relié au serveur, et vos prochains enregistrements iront dans la copie locale. '
    + 'Le projet hébergé reste intact en ligne.')) return;
  const key = await chooseInModal('Télécharger en local', 'Sous quelle forme ?', [
    {key: 'folder', label: '📁 Dans un dossier'},
    {key: 'p3d', label: '💾 Fichier .p3d'}
  ]);
  if(key === 'folder'){
    const handle = await writeWholeProjectToPickedFolder();
    if(!handle) return;
    await detachFromCloud();
    await adoptFolder(handle);
    setStatus('Copie locale écrite dans « ' + handle.name + ' » — le projet ouvert n\'est plus relié au cloud.', 6000);
  } else if(key === 'p3d'){
    await registerScene();
    await detachFromCloud();
    setStatus('Copie .p3d téléchargée — le projet ouvert n\'est plus relié au cloud.', 6000);
  }
}

// ---------- Envoyer sur le cloud ----------
let uploading = false;
export async function uploadToCloud(options){
  const opts = options || {};
  if(uploading) return false;
  if(!isLoggedIn()){
    setStatus('Connectez-vous à votre compte pour envoyer ce projet sur le cloud.', 5000);
    return false;
  }
  if(currentStorageMode() === 'cloud'){ setStatus('Ce projet est déjà sur le cloud.', 3000); return false; }
  if(!opts.noConfirm && !confirm('Envoyer « ' + (project.name || 'Mon projet') + ' » sur le cloud ?\n\n'
    + 'Un projet hébergé est créé sur votre compte, et les prochains enregistrements iront sur '
    + 'le serveur.' + (project.handleFolder ? ' Le dossier local n\'est pas supprimé, mais il ne sera plus mis à jour.' : ''))) return false;

  uploading = true;
  const report = startSave();
  try {
    setStatus('Envoi sur le cloud — préparation du projet…', 60000);
    const files = await collectProjectFiles();
    report('manifest', 1);
    const api = cloudApi('');
    const r = await uploadProjectToCloud({
      name: project.name || 'Mon projet', files, api,
      onProgress: function(p){
        if(p.step === 'create') setStatus('Envoi sur le cloud — création du projet…', 60000);
        else if(p.step === 'upload') setStatus('Envoi sur le cloud — ' + p.uploaded + ' fichier(s) déposé(s)…', 60000);
        else if(p.step === 'tree') setStatus('Envoi sur le cloud — enregistrement de la version…', 60000);
      }
    });
    report('files', 1);
    // MÊME ÉTAT FINAL qu'une ouverture par ?projet=N : c'est ce marqueur qui fait aiguiller
    // l'enregistrement vers le cloud (serialization.js:registerInProjectOpen).
    project.cloud = { id: r.id, versionId: r.versionId, manifest: r.manifest || {}, api };
    project.handleFolder = null;
    initSceneLock(project.cloud, project.scenes[project.current].name);
    if(typeof history !== 'undefined' && typeof location !== 'undefined'){
      history.replaceState(null, '', location.pathname + searchWithProject(location.search, r.id) + location.hash);
    }
    markProjectSaved();
    refreshStorageBadge();
    setStatus('Projet envoyé sur le cloud (' + r.uploaded + ' fichier(s) déposé(s), les autres y étaient déjà).', 5000);
    return true;
  } catch(e){
    const detail = (e && e.statut === 402) ? e.message + ' — voir votre plan sur le site.' : (e && e.message);
    setStatus("L'envoi sur le cloud a échoué : " + detail, 10000);
    return false;
  } finally {
    endSave();
    uploading = false;
  }
}

// ---------- Création cloud demandée depuis le Hub ----------
/**
 * Le Hub pose `hubPendingCloud` (js/hub/hub-create.js:createCloudProjectPending) : le projet
 * est construit ici — template compris, qui n'existe que dans l'éditeur — puis envoyé.
 * Rend true si une création était en attente (réussie ou non).
 */
export async function autoCreatePendingCloudProject(){
  if(typeof sessionStorage === 'undefined' || !sessionStorage.getItem('hubPendingCloud')) return false;
  sessionStorage.removeItem('hubPendingCloud');
  const name = sessionStorage.getItem('hubPendingProjectName') || 'Mon projet';
  sessionStorage.removeItem('hubPendingProjectName');
  const templateId = sessionStorage.getItem('hubPendingTemplate');
  sessionStorage.removeItem('hubPendingTemplate');
  try {
    if(cloudSession.state === 'unknown') await probeSession();
    project.name = name;
    if(templateId && typeof HubTemplates !== 'undefined'){
      const tpl = HubTemplates.get(templateId);
      if(tpl && tpl.applyInEditor){ pushHistory(); await tpl.applyInEditor(); }
    }
    await uploadToCloud({ noConfirm: true });
  } finally {
    if(typeof window !== 'undefined' && typeof window.hideHubLoadingOverlay === 'function') window.hideHubLoadingOverlay();
  }
  return true;
}

// ---------- Démarrage ----------
if(typeof document !== 'undefined' && typeof addEventListener === 'function'){
  addEventListener('keydown', function(e){
    if(!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
    if(String(e.key).toLowerCase() !== 's' || e.defaultPrevented) return;
    e.preventDefault();
    saveProject();
  });
  onSessionChange(function(){ lastBadge = ''; refreshStorageBadge(); });
  // PAS D'APPEL DIRECT au premier niveau : `refreshStorageBadge` lit `project` (js/project.js),
  // que le graphe d'imports peut évaluer APRÈS ce fichier — la zone morte temporelle levait alors,
  // et l'erreur arrêtait l'évaluation de TOUS les modules (éditeur sans menus, v0.178.0). Le
  // premier affichage attend la fin du chargement.
  setTimeout(refreshStorageBadge, 0);
  // Le mode change aussi hors d'ici (ouverture d'un dossier, d'un projet hébergé) : une
  // relecture par seconde, qui ne touche le DOM que si le texte change, suffit.
  setInterval(refreshStorageBadge, 1000);
  probeSession();
}
