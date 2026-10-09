// moteur/js/recents.js
// Historique des dossiers de projet récemment ouverts (IndexedDB).
export const RECENTS_DB = 'moteur3d-recents';
export const RECENTS_STORE = 'folders';
export const RECENTS_MAX = 10;

// Version 2, et création CONDITIONNELLE du magasin : une base ouverte par une version
// antérieure de l'éditeur existe déjà en version 1, avec un magasin nommé autrement (avant la
// migration des noms en anglais). `onupgradeneeded` ne repassait donc jamais, et chaque
// enregistrement échouait sur « NotFoundError: object store was not found ».
export function idbRecents(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(RECENTS_DB, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if(!db.objectStoreNames.contains(RECENTS_STORE)){
        db.createObjectStore(RECENTS_STORE, { keyPath: 'name' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function registerProjectRecent(handle){
  const db = await idbRecents();
  const tx = db.transaction(RECENTS_STORE, 'readwrite');
  tx.objectStore(RECENTS_STORE).put({ name: handle.name, handle, lastOpening: Date.now() });
  return new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
}

export async function listProjectsRecents(){
  const db = await idbRecents();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(RECENTS_STORE, 'readonly');
    const req = tx.objectStore(RECENTS_STORE).getAll();
    req.onsuccess = () => resolve(req.result.sort((a,b) => b.lastOpening - a.lastOpening).slice(0, RECENTS_MAX));
    req.onerror = () => reject(req.error);
  });
}

export async function openProjectRecent(entry){
  const permission = await entry.handle.requestPermission({ mode: 'readwrite' });
  if(permission !== 'granted') throw new Error('Autorisez l\'accès à ' + entry.name + ' pour continuer.');
  return entry.handle;
}
