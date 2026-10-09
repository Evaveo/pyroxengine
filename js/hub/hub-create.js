// moteur/js/hub/hub-create.js
// Le flux de création d'un projet depuis le Hub : choisir un dossier réel sur le disque (via le
// sélecteur natif — c'est lui qui permet à l'utilisateur de CRÉER un nouveau dossier, l'API File
// System Access ne le fait jamais sans ce geste), y écrire un manifeste minimal, l'enregistrer
// comme projet récent. Le CONTENU du template (scène, script...) n'est PAS posé ici : il l'est
// dans l'éditeur, une fois le projet ouvert (voir project.js:autoOpenPendingHubProject), parce
// que createSceneNode/addComponent n'existent que là. Ce fichier ne dépend que de
// project-folder.js et recents.js, déjà chargés par hub.html avant lui.

import { openFolderProject, writeFileInFolder } from '../project-folder.js';
import { registerProjectRecent } from '../recents.js';

/**
 * Ouvre le sélecteur de dossier, y pose un project.json minimal s'il n'en a pas déjà un,
 * et l'enregistre comme projet récent.
 *
 * @returns {Promise<{handle:FileSystemDirectoryHandle, alreadyExisted:boolean}|null>}
 *   `null` si l'utilisateur a annulé le sélecteur — pas une erreur.
 */
export async function createProjectFromTemplate(){
  let handle;
  try {
    handle = await openFolderProject();
  } catch(e){
    if(e.name === 'AbortError') return null;
    throw e;
  }

  let alreadyExisted = true;
  try {
    await handle.getFileHandle('project.json');
  } catch(e){
    // Seule l'absence du fichier justifie d'en écrire un — une autre error
    // (permission...) ne doit pas se déguiser en « dossier vide ».
    if(e.name !== 'NotFoundError') throw e;
    alreadyExisted = false;
  }

  if(!alreadyExisted){
    await writeFileInFolder(handle, 'project.json',
      JSON.stringify({name: handle.name, version: 1, folders: [], scenes: []}, null, 2));
  }

  await registerProjectRecent(handle);
  return {handle, alreadyExisted};
}

/**
 * Ouvre le sélecteur de dossier pour un projet EXISTANT — contrairement à
 * createProjectFromTemplate(), n'écrit rien si le dossier choisi n'a pas de project.json :
 * un dossier qui n'est pas un projet valide doit être refusé, pas adopté en silence.
 *
 * @returns {Promise<FileSystemDirectoryHandle|null>} `null` si le sélecteur est annulé.
 */
export async function openExistingProject(){
  let handle;
  try {
    handle = await openFolderProject();
  } catch(e){
    if(e.name === 'AbortError') return null;
    throw e;
  }

  try {
    await handle.getFileHandle('project.json');
  } catch(e){
    if(e.name === 'NotFoundError'){
      throw new Error('Ce dossier ne contient pas de projet (project.json introuvable).');
    }
    throw e;
  }

  await registerProjectRecent(handle);
  return handle;
}

/**
 * Création DIRECTE sur le cloud (compte connecté). Le Hub ne sait pas construire le contenu
 * d'un projet — ni la scène, ni le template : il dépose la demande, et l'éditeur crée le
 * projet puis l'envoie (js/project-storage.js:autoCreatePendingCloudProject). Aucun dossier
 * n'est demandé : le projet vit sur le serveur.
 *
 * @param storage sessionStorage (injectable pour les tests)
 */
export function createCloudProjectPending(name, templateId, storage){
  const s = storage || sessionStorage;
  const clean = String(name || '').trim();
  if(!clean) throw new Error('le nom du projet est vide');
  s.setItem('hubPendingCloud', '1');
  s.setItem('hubPendingProjectName', clean.slice(0, 120));
  if(templateId && templateId !== 'empty') s.setItem('hubPendingTemplate', templateId);
  else s.removeItem('hubPendingTemplate');
}
