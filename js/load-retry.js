// ============================================================================
// RÉESSAI DES CHARGEMENTS D'ASSETS — module PUR, partagé éditeur / jeu publié.
//
// Un serveur qui répond 429 (trop de requêtes) ou 5xx n'a pas dit « ce fichier n'existe pas » :
// il a dit « pas maintenant ». Traiter cette réponse comme une perte définitive retirait la
// texture du projet à l'ouverture, et la sauvegarde suivante l'effaçait pour de bon
// (BUGS_MOTEUR n° 18) ; dans le jeu, la tuile ou le sprite restait invisible sans un mot (n° 19).
//
// Aucun DOM, aucune dépendance : testable sous node:vm (test/load-retry.test.mjs).
// ============================================================================

/** Nombre d'essais par défaut (le premier compris). */
export const RETRY_ATTEMPTS = 5;
/** Premier délai d'attente, doublé à chaque essai. */
export const RETRY_BASE_MS = 500;
/** Plafond d'un délai — y compris quand le serveur demande plus via Retry-After. */
export const RETRY_MAX_MS = 15000;

/** Statut HTTP d'une erreur, quel que soit le nom du champ qui le porte. */
export function statusOfError(e){
  if(!e) return 0;
  const s = e.status !== undefined ? e.status : e.statut;
  return Number(s) || 0;
}

/**
 * Vaut-il la peine de réessayer ? 429, 408 et 5xx : oui. Une erreur sans statut (réseau coupé,
 * fetch rejeté) : oui. Un 404 / 403 : non — redemander ne fera pas apparaître le fichier.
 */
export function isRetryableError(e){
  const s = statusOfError(e);
  if(!s) return !(e && e.retryable === false);
  return s === 408 || s === 429 || s >= 500;
}

/**
 * Lit un en-tête Retry-After (secondes, ou date HTTP) en millisecondes. null s'il est absent ou
 * illisible.
 */
export function parseRetryAfter(value, now){
  if(value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if(Number.isFinite(n)) return Math.max(0, n * 1000);
  const t = Date.parse(String(value));
  if(!Number.isFinite(t)) return null;
  return Math.max(0, t - (now === undefined ? Date.now() : now));
}

/**
 * Délai avant l'essai n° `attempt + 1` (attempt commence à 0). Retry-After l'emporte quand le
 * serveur en donne un, sinon délai doublé à chaque essai. Toujours plafonné.
 */
export function retryDelayMs(attempt, retryAfter, opts){
  const o = opts || {};
  const base = o.baseMs === undefined ? RETRY_BASE_MS : o.baseMs;
  const max = o.maxMs === undefined ? RETRY_MAX_MS : o.maxMs;
  const asked = parseRetryAfter(retryAfter, o.now);
  const d = asked !== null ? asked : base * Math.pow(2, attempt);
  return Math.min(max, d);
}

/** Erreur HTTP enrichie de quoi décider d'un réessai. */
export function httpError(message, status, retryAfter){
  const e = new Error(message);
  e.status = status;
  if(retryAfter !== undefined && retryAfter !== null) e.retryAfter = retryAfter;
  return e;
}

/**
 * Exécute `work(attempt)` jusqu'à réussite, en réessayant les échecs passagers.
 * opts : { attempts, baseMs, maxMs, wait(ms) → Promise, onRetry(e, attempt, delay) }.
 * Rejette avec la DERNIÈRE erreur, marquée `attempts` (nombre d'essais faits).
 */
export async function withRetry(work, opts){
  const o = opts || {};
  const attempts = Math.max(1, o.attempts === undefined ? RETRY_ATTEMPTS : o.attempts);
  const wait = o.wait || function(ms){ return new Promise(function(res){ setTimeout(res, ms); }); };
  let last = null, done = 0;
  for(let i = 0; i < attempts; i++){
    try { return await work(i); }
    catch(e){
      last = e;
      done = i + 1;
      if(i === attempts - 1 || !isRetryableError(e)) break;
      const delay = retryDelayMs(i, e && e.retryAfter, o);
      if(o.onRetry){ try { o.onRetry(e, i, delay); } catch(x){ /* journal seulement */ } }
      await wait(delay);
    }
  }
  if(last && typeof last === 'object'){
    try { last.attempts = done; } catch(x){ /* erreur gelée */ }
  }
  throw last;
}

/**
 * Les pixels RGBA d'un damier magenta / noir — la texture de REMPLACEMENT d'une image qui n'a pas
 * pu être chargée. Une tuile invisible ne se remarque pas ; un damier, si (convention Unity).
 */
export function checkerPixels(size, cell){
  const n = Math.max(2, size | 0 || 16), c = Math.max(1, cell | 0 || 4);
  const px = new Uint8Array(n * n * 4);
  for(let y = 0; y < n; y++){
    for(let x = 0; x < n; x++){
      const on = ((Math.floor(x / c) + Math.floor(y / c)) & 1) === 0;
      const i = (y * n + x) * 4;
      px[i] = on ? 255 : 0; px[i + 1] = 0; px[i + 2] = on ? 255 : 0; px[i + 3] = 255;
    }
  }
  return px;
}

/**
 * Le refus d'enregistrer tant qu'un asset n'a pas pu être chargé : son fichier n'est PAS en
 * mémoire, et écrire le projet le retirerait — c'est la sauvegarde qui rendait la perte
 * définitive (BUGS_MOTEUR n° 18). null si rien ne bloque.
 */
export function unloadedAssetsMessage(list){
  const lost = (list || []).filter(function(a){ return a && a.unloaded; });
  if(!lost.length) return null;
  const names = lost.slice(0, 5).map(function(a){ return '« ' + a.name + ' »'; }).join(', ')
    + (lost.length > 5 ? ' et ' + (lost.length - 5) + ' autre(s)' : '');
  return 'Enregistrement refusé : ' + lost.length + ' asset(s) non chargé(s) (' + names
    + '). Les enregistrer maintenant les effacerait du projet — rechargez le projet pour réessayer.';
}
