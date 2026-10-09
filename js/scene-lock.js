// ---------- Verrouillage de scène d'un projet hébergé ----------
// Verrouillage PESSIMISTE au grain de la scène : une personne édite une scène à la fois, les
// autres la voient prise et par qui. Le serveur est en place depuis longtemps
// (cloud/back/services/verrous.js) — bail de 90 s, prise idempotente qui sert de battement de
// cœur, libération automatique à l'expiration pour qu'un onglet fermé brutalement ne bloque
// personne. Voir docs/superpowers/specs/2026-09-23-projet-cloud-editable-design.md.
//
// CE VERROU EST UN AVERTISSEMENT PRÉCOCE, PAS LE MÉCANISME DE CORRECTION.
// Ce qui empêche réellement d'écraser le travail d'autrui, c'est la concurrence optimiste au
// fichier près du serveur (cloud/back/services/arbreProjet.js) : un enregistrement qui touche
// un fichier modifié entre-temps est refusé en le nommant. Le verrou sert à l'apprendre AVANT
// d'avoir travaillé une heure, pas à garantir quoi que ce soit. Cette distinction n'est pas
// cosmétique : elle explique pourquoi la fenêtre décrite ci-dessous est acceptable.
//
// LA FENÊTRE, ET POURQUOI ELLE EST ASSUMÉE. `pushHistory()` est SYNCHRONE — c'est le point
// d'étranglement de toute mutation de scène, appelé avant chacune d'elles. Demander un verrou
// est un aller-retour réseau. On ne peut donc pas décider au premier geste sans soit bloquer
// l'interface, soit verrouiller à l'ouverture (ce qui gèle une scène qu'on ne fait que
// consulter). Le premier geste passe donc sur un état `unknown`, déclenche la demande, et la
// réponse bascule l'éditeur en lecture seule si le verrou est refusé. Au pire, une modification
// a eu lieu : elle est annulable, elle n'est pas enregistrée, et l'enregistrement la refuserait
// de toute façon en nommant le fichier.

import { escapeHtml } from './escape-html.js';
const BAIL_MS = 90 * 1000;          // doit rester égal au BAIL du serveur
const BATTEMENT_MS = 30 * 1000;     // trois battements par bail : deux échecs tolérés
const ECHECS_AVANT_PERTE = 2;

export const sceneLock = {
  cloud: null,        // { id, api } — null hors projet hébergé : le module dort
  scene: null,
  state: 'none',      // 'none' | 'unknown' | 'mine' | 'other' | 'lost'
  holder: null,       // e-mail du détenteur quand state === 'other'
  expireLe: 0,
  echecs: 0,
  _minuteur: null,
  _demande: null      // la promesse en cours, pour ne pas demander deux fois
};

/** Ce que l'éditeur a le droit de faire, SANS attendre le réseau. */
export function lockState(){
  if(!sceneLock.cloud) return 'editable';        // pas de projet hébergé : rien ne change
  if(sceneLock.state === 'mine') return 'editable';
  if(sceneLock.state === 'other' || sceneLock.state === 'lost') return 'readonly';
  return 'unknown';
}

/** Vrai quand une mutation doit être refusée tout de suite. */
export function lockBlocks(){ return lockState() === 'readonly'; }

export function lockMessage(){
  if(sceneLock.state === 'other'){
    return 'Scène « ' + sceneLock.scene + ' » verrouillée par '
      + (sceneLock.holder || 'un autre membre') + ' — lecture seule.';
  }
  if(sceneLock.state === 'lost'){
    return 'Verrou perdu sur « ' + sceneLock.scene + ' » (connexion ?) — lecture seule. '
      + "Votre travail n'est pas perdu : il reste en mémoire et l'autosave local continue.";
  }
  return '';
}

/** Arme le module pour un projet hébergé. `cloud` null le remet en sommeil. */
export function initSceneLock(cloud, scene){
  stopHeartbeat();
  sceneLock.cloud = cloud || null;
  sceneLock.scene = scene || null;
  sceneLock.state = cloud ? 'unknown' : 'none';
  sceneLock.holder = null;
  sceneLock.echecs = 0;
  sceneLock._demande = null;
  updateBannerCloud();
}

/** Changer de scène libère la précédente : on ne tient qu'un verrou à la fois. */
export async function switchScene(scene){
  if(sceneLock.cloud && sceneLock.state === 'mine') await releaseLock();
  sceneLock.scene = scene;
  sceneLock.state = sceneLock.cloud ? 'unknown' : 'none';
  sceneLock.holder = null;
  sceneLock.echecs = 0;
  sceneLock._demande = null;
  updateBannerCloud();
}

/**
 * Demande le verrou si on ne l'a pas encore. Idempotent, et non bloquant pour l'appelant
 * synchrone : `pushHistory()` la déclenche sans l'attendre.
 */
export function claimIfNeeded(){
  if(!sceneLock.cloud || sceneLock.state === 'mine' || sceneLock.state === 'other') return sceneLock._demande;
  if(sceneLock._demande) return sceneLock._demande;
  sceneLock._demande = (async () => {
    try {
      const r = await sceneLock.cloud.api.takeLock(sceneLock.cloud.id, sceneLock.scene);
      if(r && r.ok){
        sceneLock.state = 'mine';
        sceneLock.expireLe = r.expire_le || 0;
        sceneLock.echecs = 0;
        startHeartbeat();
      } else {
        sceneLock.state = 'other';
        // `detenteur` : c'est le champ que renvoie le serveur (controleurs/verrous.js). `email`
        // n'existait pas, et le détenteur n'était jamais nommé.
        sceneLock.holder = (r && (r.detenteur || r.email)) || null;
      }
    } catch(e){
      // Une demande qui échoue n'est PAS un refus : sans réponse, on ne sait pas qui tient la
      // scène. On reste en `unknown` — bloquer sur une coupure réseau serait pire que le risque.
      sceneLock.state = 'unknown';
    } finally {
      sceneLock._demande = null;
      updateBannerCloud();
    }
    return sceneLock.state;
  })();
  return sceneLock._demande;
}

/** Le battement de cœur : la prise est idempotente pour le détenteur, elle renouvelle le bail. */
export async function heartbeat(){
  if(!sceneLock.cloud || sceneLock.state !== 'mine') return sceneLock.state;
  try {
    const r = await sceneLock.cloud.api.takeLock(sceneLock.cloud.id, sceneLock.scene);
    if(r && r.ok){ sceneLock.expireLe = r.expire_le || 0; sceneLock.echecs = 0; }
    else { sceneLock.state = 'other'; sceneLock.holder = (r && (r.detenteur || r.email)) || null; stopHeartbeat(); }
  } catch(e){
    // Deux échecs tolérés : le bail vaut trois battements, donc une coupure brève ne coûte rien.
    // Au-delà, le serveur a pu donner la scène à quelqu'un d'autre — on passe en lecture seule
    // SANS RIEN JETER, plutôt que de laisser croire qu'on tient encore le verrou.
    if(++sceneLock.echecs > ECHECS_AVANT_PERTE){ sceneLock.state = 'lost'; stopHeartbeat(); }
  }
  updateBannerCloud();
  return sceneLock.state;
}

export function startHeartbeat(planifier){
  stopHeartbeat();
  const poser = planifier || ((f, ms) => setInterval(f, ms));
  sceneLock._minuteur = poser(() => { heartbeat(); }, BATTEMENT_MS);
}

export function stopHeartbeat(){
  if(sceneLock._minuteur !== null && sceneLock._minuteur !== undefined){
    clearInterval(sceneLock._minuteur);
    sceneLock._minuteur = null;
  }
}

export async function releaseLock(){
  stopHeartbeat();
  if(!sceneLock.cloud || sceneLock.state !== 'mine') return;
  sceneLock.state = 'unknown';
  updateBannerCloud();
  try { await sceneLock.cloud.api.releaseLock(sceneLock.cloud.id, sceneLock.scene); } catch(e){ /* le bail expirera */ }
}



// ---------- Etat visible ----------
// Un message de statut disparait ; l'state du verrou, lui, dure. Sans bandeau permanent,
// l'utilisateur decouvre qu'il est en lecture seule EN ESSAYANT, par un refus — le pire moment.

// CE MODULE RESTE UNE FEUILLE. Il n'importe RIEN — c'est ce qui permet a son test de le
// charger seul, sans tirer scene.js et les 150 modules de l'editeur derriere lui (le premier
// cablage le faisait, et le test tombait sur `addEventListener is not defined`). Les
// affordances s'abonnent donc ICI, au lieu d'etre appelees par nom.
let listener = null;

/** Abonne une fonction aux changements d'etat du verrou. js/readonly-ui.js s'en sert. */
export function onLockChange(fn){ listener = (typeof fn === 'function') ? fn : null; }

function notifyLockChange(){
  if(listener) listener(lockState() === 'readonly');
}

export function updateBannerCloud(){
  // Les affordances AVANT le bandeau : si le rendu du bandeau echoue (element absent hors
  // editeur, par exemple), les commandes doivent quand meme avoir change d'etat. L'inverse
  // laisserait un gizmo arme derriere un bandeau « lecture seule ».
  notifyLockChange();
  const el = (typeof document !== 'undefined') ? document.getElementById('banner-cloud') : null;
  if(!el) return;
  if(!sceneLock.cloud){ el.style.display = 'none'; return; }
  const state = lockState();
  // ÉCHAPPÉS : le nom de scène vient d'un projet PARTAGÉ, le détenteur d'une adresse saisie par un
  // autre compte. Posés tels quels dans `innerHTML`, un nom de scène `<img src=x onerror=…>`
  // s'exécutait chez chaque collègue qui ouvrait le projet, avant toute confirmation (revue du
  // 2026-09-29, § 2.3).
  const scene = escapeHtml(sceneLock.scene || '?');
  const holder = sceneLock.holder ? escapeHtml(sceneLock.holder) : null;
  let label, background;
  if(state === 'readonly'){
    label = '<b>Lecture seule</b> — ' + (sceneLock.state === 'other'
      ? ('scène « ' + scene + ' » verrouillée par ' + (holder || 'un autre membre'))
      : 'verrou perdu (connexion ?). Votre travail reste en mémoire.');
    background = 'var(--danger, #b4483c)';
  } else if(sceneLock.state === 'mine'){
    label = '<b>Projet hébergé</b> — vous éditez « ' + scene + ' »';
    background = 'var(--accent, #3c7db4)';
  } else {
    label = '<b>Projet hébergé</b> — « ' + scene + ' » non verrouillée';
    background = 'var(--edge, #555)';
  }
  el.style.display = 'flex';
  el.style.background = background;
  el.innerHTML = label;
}
