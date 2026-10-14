// ---------- Ralenti du rendu de l'éditeur au repos ----------
// La boucle de js/viewport.js rendait l'image complète à 60 i/s même quand rien ne bouge :
// un éditeur ouvert dans un coin d'écran faisait tourner le GPU (et le ventilateur) pour
// redessiner soixante fois la même image.
//
// UN RALENTI, PAS UN ARRÊT. Après IDLE_DELAY_MS sans aucune activité, la vue Scène n'est plus
// rendue qu'environ dix fois par seconde (IDLE_INTERVAL_MS). On ne s'arrête JAMAIS tout à fait :
// une source de changement oubliée (un chargement asynchrone qui ne prévient pas, un réglage
// écrit par un chemin qu'on n'a pas vu) se corrige donc toute seule en au plus ~100 ms, au
// lieu de laisser une vue périmée jusqu'au prochain mouvement de souris. C'est ce filet qui
// rend l'optimisation sûre : le pire cas est une image en retard, jamais une image fausse.
//
// Ce qui continue de tourner à chaque image, ralenti ou non : l'horloge, les Systèmes, les
// icônes, le regroupement, les calques — tout l'état bon marché. Seuls `updateShadows` et le
// rendu de la vue Scène sont sautés. Rien ne s'accumule donc pendant le ralenti.
//
// Ce qui rend la cadence pleine, instantanément :
//   · toute entrée (pointeur, molette, clavier, saisie dans un panneau, glisser-déposer) —
//     écoutée en CAPTURE sur la fenêtre, donc aussi dans les panneaux et l'inspecteur ;
//   · `requestRender()` — appelé par le gizmo, pushHistory, le redimensionnement, les fins de
//     chargement asynchrones (textures, modèles, compilation, cuisson, copilote, environnement) ;
//   · un travail continu signalé par la boucle (`busy`) : lecture, physique, vol libre, gizmo
//     tiré, vue Jeu, animations de modèles, aperçu d'animator, émetteurs de particules.
//
// Désactivable par la préférence `viewport.idleThrottle` (js/ui/prefs.js) — une préférence de
// machine, pas un réglage de projet : elle ne change rien à ce que contient la scène.

export const IDLE_DELAY_MS = 2000;
export const IDLE_INTERVAL_MS = 100;
// Tolérance sur l'écart entre deux images d'affichage : à 60 Hz, six images font 100,2 ms ;
// sans marge, une gigue d'une demi-milliseconde ferait attendre une septième image.
const INTERVAL_SLACK_MS = 8;

export const renderThrottle = {
  enabled: true,
  lastActive: -Infinity,
  lastRender: -Infinity,
  skipped: 0
};

function nowMs(){
  const perf = globalThis.performance;
  return (perf && perf.now) ? perf.now() : Date.now();
}

/** Signale une activité : la cadence pleine reprend dès l'image suivante, pour IDLE_DELAY_MS. */
export function requestRender(){ renderThrottle.lastActive = nowMs(); }
export const markActive = requestRender;

/** Vrai si la vue est au ralenti à l'instant `t` (sans rien modifier). */
export function isIdle(t, busy){
  return renderThrottle.enabled && !busy && (t - renderThrottle.lastActive) >= IDLE_DELAY_MS;
}

/**
 * Décide si cette image doit rendre la vue Scène. `t` en millisecondes, `busy` vrai quand la
 * boucle sait qu'un travail continu est en cours. Au repos, rend une image tous les ~100 ms.
 */
export function shouldRenderFrame(t, busy){
  if(busy) renderThrottle.lastActive = t;
  if(!isIdle(t, busy) || (t - renderThrottle.lastRender) >= IDLE_INTERVAL_MS - INTERVAL_SLACK_MS){
    renderThrottle.lastRender = t;
    return true;
  }
  renderThrottle.skipped++;
  return false;
}

export const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'keydown', 'keyup',
  'input', 'change', 'dragover', 'drop', 'focus', 'visibilitychange'];

let installed = false;
/** Branche les écouteurs d'activité (en capture, passifs) sur la fenêtre. Idempotent. */
export function installActivityListeners(target){
  const tgt = target || globalThis.window || null;
  if(installed || !tgt || !tgt.addEventListener) return;
  installed = true;
  ACTIVITY_EVENTS.forEach(function(type){
    tgt.addEventListener(type, requestRender, {capture: true, passive: true});
  });
}

// EXPOSÉ EN GLOBALE : les sources asynchrones (chargeurs, copilote, environnement) vivent dans
// des modules qui n'importent pas celui-ci, et un import de plus dans le cycle viewport ↔ scene
// déplacerait l'ordre d'évaluation (KNOWN_ISSUES v0.178.1). Elles appellent donc
// `globalThis.requestRender?.()`.
globalThis.requestRender = requestRender;
