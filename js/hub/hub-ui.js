// moteur/js/hub/hub-ui.js
// Le rendu du Project Hub : liste des projets récents, grille de templates, câblage des
// boutons. Ne connaît AUCUN template par son nom — seulement HubTemplates.list(), ce qui est
// la preuve que l'extensibilité fonctionne : ajouter un template ne touche jamais ce fichier.

import { createCloudProjectPending, createProjectFromTemplate, openExistingProject } from './hub-create.js';
import { isLoggedIn, probeSession } from '../cloud-session.js';
import { HubTemplates } from './hub-templates.js';
import { listProjectsRecents, openProjectRecent } from '../recents.js';

export const elRecents = document.getElementById('hub-recents');
export const elTemplates = document.getElementById('hub-templates');
export const elError = document.getElementById('hub-error');
export const elSkip = document.getElementById('hub-skip');
export const elCreate = document.getElementById('hub-create');
export const elOpen = document.getElementById('hub-open');
export const elBusy = document.getElementById('hub-busy');

export let templateSelected = 'empty';

export function showHubError(message){
  elError.textContent = message;
  elError.hidden = !message;
}

// Le sélecteur de dossier natif, le scan et l'écriture des fichiers peuvent prendre un
// moment — surtout sur un gros projet, ou si le geste de permission attend l'utilisateur.
// Désactiver les boutons pendant ce temps évite un double-clic qui déclencherait deux
// navigations concurrentes vers editor.html.
export function setHubBusy(busy, text){
  elBusy.textContent = text || '';
  elBusy.hidden = !busy;
  elCreate.disabled = busy;
  if(elOpen) elOpen.disabled = busy;
  if(elSkip) elSkip.disabled = busy;
  elRecents.querySelectorAll('button').forEach(function(b){ b.disabled = busy; });
}

// IMPORTÉ *ET* réexporté : ce fichier s'en sert lui-même, et une réexportation seule ne ramène
// pas le nom dans sa propre portée. Voir la note de js/objects.js.
import { escapeHtml } from '../escape-html.js';
export { escapeHtml };

// ---------- Projets récents ----------
export async function renderRecents(){
  let recents;
  try {
    recents = await listProjectsRecents();
  } catch(e){
    elRecents.innerHTML = '<p class="hub-empty">Impossible de lire les projets récents : ' + escapeHtml(e.message) + '</p>';
    return;
  }
  if(!recents.length){
    elRecents.innerHTML = '<p class="hub-empty">Aucun projet ouvert précédemment.</p>';
    return;
  }
  elRecents.innerHTML = '';
  recents.forEach(function(entry){
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'hub-recent-card';
    const date = new Date(entry.lastOpening).toLocaleString('fr-FR');
    card.innerHTML = '<i class="ph-fill ph-folder" aria-hidden="true"></i>'
      + '<span class="hub-recent-name">' + escapeHtml(entry.name) + '</span>'
      + '<span class="hub-recent-date">Ouvert le ' + escapeHtml(date) + '</span>';
    card.addEventListener('click', function(){ openRecentProject(entry); });
    elRecents.appendChild(card);
  });
}

export async function openRecentProject(entry){
  showHubError('');
  setHubBusy(true, 'Ouverture de « ' + entry.name + ' »…');
  try {
    // Vérifie/renouvelle la permission ICI, pendant qu'on est encore dans le geste de clic de
    // l'utilisateur — la redemander depuis editor.html après navigation perdrait ce contexte.
    await openProjectRecent(entry);
  } catch(e){
    setHubBusy(false);
    showHubError(e.message);
    return;
  }
  sessionStorage.setItem('hubPendingProjectName', entry.name);
  location.href = 'editor.html';
  // Pas de setHubBusy(false) ici : la page part en navigation, et editor.html prend le relai
  // avec son propre indicateur (voir editor.html:hub-loading-overlay).
}

// ---------- Templates ----------
export function renderTemplates(){
  elTemplates.innerHTML = '';
  HubTemplates.list().forEach(function(tpl){
    // Un template attaché en dur au registre (id 'empty') ou par un fichier template-*.js
    // chargé APRÈS hub-templates.js compte comme disponible même sans applyInEditor : 'empty'
    // n'a justement rien à appliquer. Seuls les placeholders déclarés SANS suite (il n'
    // y en a plus depuis template-webxr-vr.js) doivent s'afficher grisés — on les distingue par id, pas en devinant
    // depuis applyInEditor : un template réel chargé plus tard (editor.html) resterait sans
    // applyInEditor ICI, dans hub.html, qui ne charge jamais les fichiers template-*.js.
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'hub-template-card' + (tpl.id === templateSelected ? ' selected' : '');
    card.innerHTML = '<span class="hub-template-label">' + escapeHtml(tpl.label) + '</span>'
      + '<span class="hub-template-desc">' + escapeHtml(tpl.description) + '</span>';
    card.addEventListener('click', function(){
      templateSelected = tpl.id;
      renderTemplates();
    });
    elTemplates.appendChild(card);
  });
}

// ---------- Ouverture d'un projet existant ----------
if(elOpen){
  elOpen.addEventListener('click', async function(){
    showHubError('');
    setHubBusy(true, 'Choisissez un dossier…');
    let handle;
    try {
      handle = await openExistingProject();
    } catch(e){
      setHubBusy(false);
      showHubError(e.message);
      return;
    }
    if(!handle){ setHubBusy(false); return; } // sélecteur de dossier annulé — pas une erreur

    sessionStorage.setItem('hubPendingProjectName', handle.name);
    sessionStorage.removeItem('hubPendingTemplate'); // ouvrir n'applique jamais de template
    location.href = 'editor.html';
    // Pas de setHubBusy(false) ici, même raison que les deux autres flux ci-dessus/ci-dessous.
  });
}

// ---------- Création ----------
elCreate.addEventListener('click', async function(){
  showHubError('');
  setHubBusy(true, 'Choisissez un dossier…');
  let result;
  try {
    result = await createProjectFromTemplate();
  } catch(e){
    setHubBusy(false);
    showHubError(e.message);
    return;
  }
  if(!result){ setHubBusy(false); return; } // sélecteur de dossier annulé — pas une erreur

  sessionStorage.setItem('hubPendingProjectName', result.handle.name);
  // Un template n'est appliqué QUE sur un dossier neuf : un project.json déjà présent est un
  // projet existant qu'on rouvre, pas un projet qu'on écrase avec un contenu de départ.
  if(!result.alreadyExisted && templateSelected && templateSelected !== 'empty'){
    sessionStorage.setItem('hubPendingTemplate', templateSelected);
  } else {
    sessionStorage.removeItem('hubPendingTemplate');
  }
  location.href = 'editor.html';
  // Pas de setHubBusy(false) ici, même raison que openRecentProject ci-dessus.
});

// Création directe sur le cloud : le bouton n'apparaît qu'avec un compte connecté. Sans
// serveur cloud (éditeur lancé seul), la sonde échoue en silence et il reste caché.
export const elCreateCloud = document.getElementById('hub-create-cloud');
if(elCreateCloud){
  probeSession().then(function(){ elCreateCloud.hidden = !isLoggedIn(); });
  elCreateCloud.addEventListener('click', function(){
    showHubError('');
    const name = prompt('Nom du projet hébergé :', 'Mon projet');
    if(name === null) return;
    try {
      createCloudProjectPending(name, templateSelected);
    } catch(e){ showHubError(e.message); return; }
    setHubBusy(true, 'Création du projet sur le cloud…');
    location.href = 'editor.html';
  });
}

if(elSkip){
  elSkip.addEventListener('click', function(){ location.href = 'editor.html'; });
}

renderRecents();
renderTemplates();


// EXPOSÉ EN GLOBALE, à dessein. Ces symboles sont appelés depuis des fichiers
// que les mêmes pages ne chargent pas toutes : un `import` y pointerait un
// fichier absent, et la page ne démarrerait pas. Ils gardent donc leur garde
// `typeof` côté appelant, et se déclarent ici.
globalThis.escapeHtml = escapeHtml;