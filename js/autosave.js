// ---------- Sauvegarde automatique (IndexedDB) et récupération ----------
// Toutes les 3 minutes, si le projet a été modifié (drapeau posé par pushHistory)
// et hors mode lecture/simulation, le projet complet est gzippé dans IndexedDB.
// Récupération via Fichier → Récupérer la sauvegarde automatique.
import { assets } from './assets.js';
import { setStatus } from './hierarchy.js';
import { phys } from './physics.js';
import { buildDataProject, loadDataProject } from './serialization.js';

export const autosave = {intervalleMs: 3 * 60 * 1000, modifie:false};

export function idbEditor(){
  return new Promise(function(res, rej){
    const r = indexedDB.open('moteur3d-editeur', 1);
    r.onupgradeneeded = function(){ r.result.createObjectStore('auto'); };
    r.onsuccess = function(){ res(r.result); };
    r.onerror = function(){ rej(r.error); };
  });
}

export async function runAutosave(){
  if(!autosave.modifie || phys.active) return;
  try{
    // Une texture non chargée n'est pas en mémoire : la sauvegarde l'effacerait (n° 18).
    if(assets.some(function(a){ return a && a.unloaded; })) return;
    const data = await buildDataProject();
    const gz = fflate.gzipSync(fflate.strToU8(JSON.stringify(data)), {level:1});
    const db = await idbEditor();
    await new Promise(function(res, rej){
      const tx = db.transaction('auto', 'readwrite');
      tx.objectStore('auto').put({date:new Date().toISOString(), gz:gz}, 'last');
      tx.oncomplete = res;
      tx.onerror = function(){ rej(tx.error); };
    });
    autosave.modifie = false;
    setStatus('💾 Sauvegarde automatique (' + Math.round(gz.length/1024) + ' Ko)', 1800);
  } catch(e){
    console.warn('autosave :', e);
  }
}
setInterval(runAutosave, autosave.intervalleMs);

export async function readAutoSave(){
  const db = await idbEditor();
  return new Promise(function(res, rej){
    const rq = db.transaction('auto').objectStore('auto').get('last');
    rq.onsuccess = function(){ res(rq.result || null); };
    rq.onerror = function(){ rej(rq.error); };
  });
}

// Note (project-folder) : la restauration recharge l'état en mémoire uniquement.
// Si un dossier de projet est ouvert, l'utilisateur doit ré-enregistrer manuellement
// ("Enregistrer dans le dossier") pour que les fichiers disque reflètent l'état restauré.
export async function recoverAutoSave(){
  try{
    const rec = await readAutoSave();
    if(!rec){ setStatus('Aucune sauvegarde automatique disponible', 2500); return; }
    const date = new Date(rec.date).toLocaleString();
    if(!confirm('Restaurer la sauvegarde automatique du ' + date + ' ?\n'
      + 'Le projet actuellement open sera remplacé.')) return;
    const data = JSON.parse(fflate.strFromU8(fflate.gunzipSync(rec.gz)));
    await loadDataProject(data);
  } catch(e){
    setStatus('Récupération impossible : ' + e.message, 4000);
  }
}

// au démarrage : signale discrètement qu'une sauvegarde existe (utile après un crash)
setTimeout(async function(){
  try{
    const rec = await readAutoSave();
    if(rec) setStatus('💾 Sauvegarde auto du ' + new Date(rec.date).toLocaleString()
      + ' disponible — Fichier → Récupérer', 6000);
  } catch(e){ /* IndexedDB indisponible : tant pis */ }
}, 1500);
