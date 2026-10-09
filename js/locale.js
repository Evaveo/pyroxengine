// moteur/js/locale.js
//
// LE TEXTE DU JEU, TRADUIT — module PARTAGÉ éditeur / jeu publié.
//
// Ne concerne PAS l'interface de l'éditeur, qui reste en français : il s'agit du texte que le
// JOUEUR lit — menus, dialogues, objectifs, fins de partie.
//
// ---------- LA RÈGLE QUI TIENT TOUT LE FICHIER ----------
//
// UNE CLÉ MANQUANTE SE VOIT. Elle rend la clé elle-même : `menu.start` s'affiche en toutes
// lettres à l'écran, et l'on sait immédiatement quoi traduire. C'est le contraire de ce que
// font beaucoup de moteurs — rendre une chaîne vide — et ce n'est pas un détail de confort : un
// bouton vide passe les tests, passe la relecture, et se découvre en production.
//
// Les clés manquantes sont aussi RETENUES (`missingKeys()`) et signalées une fois en console.
// Une seule fois : à soixante images par seconde, un avertissement par image est un
// avertissement qu'on désactive.
//
// ---------- LE CHOIX DE LA LANGUE ----------
//
// Trois sources, dans cet ordre : ce que le joueur a choisi pendant une partie précédente, ce
// que son navigateur annonce, et la langue par défaut du projet. `en-GB` tombe sur `en` quand
// `en-GB` n'existe pas : c'est la règle des étiquettes de langue, et sans elle la moitié du
// monde anglophone se verrait servir du français.
//
// ---------- OÙ VIT LA TABLE ----------
//
// Dans les réglages du PROJET (`settings.locales`), comme la table d'entrées : elle voyage avec
// le projet, part dans le build, et se relit dans l'éditeur. `exportLocaleJson` /
// `importLocaleJson` donnent à un traducteur le fichier `.json` d'une langue, qu'il rend une
// fois rempli — c'est ce qu'un studio attend, sans qu'il ait fallu inventer un genre d'asset.

/** Le réglage de projet par défaut : une seule langue, vide. */
export const LOCALES_DEFAULT = {default: 'fr', tables: {fr: {}}};

/** La clé de mémorisation du choix du joueur. Nommée, pour ne pas heurter un autre stockage. */
export const LOCALE_STORAGE_KEY = 'moteur3d-locale';

export const localeState = {
  code: '',          // la langue active
  fallback: 'fr',    // celle qu'on consulte quand la clé manque dans l'active
  tables: {},        // code -> {clé: texte}
  missing: [],       // les clés demandées et introuvables, dans l'ordre de découverte
  warned: false
};

/** Les langues que le projet fournit. */
export function localesAvailable(){
  return Object.keys(localeState.tables || {});
}

/** La langue active. */
export function localeCurrent(){ return localeState.code; }

/**
 * Choisit une langue parmi celles disponibles.
 *
 * `preferred` est une liste d'étiquettes, de la plus souhaitée à la moins : c'est exactement ce
 * que rend `navigator.languages`. Une étiquette régionale accepte la langue seule —
 * `en-GB` → `en` — sans quoi la moitié du monde anglophone serait servie dans la langue par
 * défaut du projet alors que l'anglais est là.
 */
export function pickLocale(available, preferred, fallback){
  const dispo = available || [];
  const veut = Array.isArray(preferred) ? preferred : (preferred ? [preferred] : []);
  for(let i = 0; i < veut.length; i++){
    const tag = String(veut[i] || '');
    if(!tag) continue;
    if(dispo.indexOf(tag) !== -1) return tag;
    const court = tag.split('-')[0];
    if(dispo.indexOf(court) !== -1) return court;
    // L'inverse aussi : le projet ne fournit que `en-US`, le joueur demande `en`.
    const proche = dispo.find(function(d){ return String(d).split('-')[0] === court; });
    if(proche) return proche;
  }
  if(fallback && dispo.indexOf(fallback) !== -1) return fallback;
  return dispo[0] || '';
}

/** Le choix mémorisé du joueur, ou `''`. Le stockage peut être refusé : ce n'est pas une panne. */
export function localeStored(){
  try{ return localStorage.getItem(LOCALE_STORAGE_KEY) || ''; }
  catch(e){ return ''; }
}

/**
 * Installe la table du projet et choisit la langue. À appeler au chargement d'un projet
 * (éditeur) et au démarrage d'un jeu (runtime).
 *
 * `preferred` permet de forcer, pour un test ou un aperçu ; sans lui on prend le choix mémorisé
 * puis ce qu'annonce le navigateur.
 */
export function setupLocales(locales, preferred){
  const src = locales || LOCALES_DEFAULT;
  localeState.tables = (src.tables && typeof src.tables === 'object') ? src.tables : {};
  localeState.fallback = src.default || Object.keys(localeState.tables)[0] || '';
  localeState.missing = [];
  localeState.warned = false;

  let veut = preferred;
  if(!veut){
    const memo = localeStored();
    const navigateur = (typeof navigator !== 'undefined')
      ? (navigator.languages || (navigator.language ? [navigator.language] : [])) : [];
    veut = memo ? [memo].concat(Array.from(navigateur)) : Array.from(navigateur);
  }
  localeState.code = pickLocale(localesAvailable(), veut, localeState.fallback);
  return localeState.code;
}

/**
 * Change la langue en cours de partie, et la mémorise pour la prochaine.
 *
 * Refuse une langue que le projet ne fournit pas, et le DIT : changer pour une langue absente
 * viderait tout le texte du jeu, et l'on chercherait la panne dans les traductions.
 */
export function setLocale(code){
  if(localesAvailable().indexOf(code) === -1){
    if(typeof console !== 'undefined'){
      console.warn('[locale] langue « ' + code + ' » absente du projet — inchangée. '
        + 'Disponibles : ' + localesAvailable().join(', '));
    }
    return false;
  }
  localeState.code = code;
  try{ localStorage.setItem(LOCALE_STORAGE_KEY, code); }
  catch(e){ /* stockage refusé : le choix ne dure que la partie */ }
  return true;
}

/**
 * Remplace les paramètres d'un gabarit : `'Score : {n}'` avec `{n: 42}`.
 *
 * Un paramètre absent est LAISSÉ TEL QUEL, accolades comprises. Le remplacer par du vide
 * donnerait « Score :  », qu'on lit comme une faute de traduction ; `{n}` visible désigne le
 * script qui a oublié de passer la valeur.
 */
export function formatTemplate(text, params){
  if(!params) return String(text);
  return String(text).replace(/\{(\w+)\}/g, function(whole, name){
    return (params[name] === undefined || params[name] === null) ? whole : String(params[name]);
  });
}

/**
 * LE TEXTE D'UNE CLÉ. Langue active, puis langue de repli, puis LA CLÉ ELLE-MÊME.
 *
 * Rendre la clé est délibéré : voir l'en-tête. Un bouton qui affiche `menu.start` se corrige le
 * jour où on le voit ; un bouton vide se découvre chez le joueur.
 */
export function translate(key, params){
  const k = String(key === undefined || key === null ? '' : key);
  if(!k) return '';
  const active = localeState.tables[localeState.code];
  if(active && typeof active[k] === 'string') return formatTemplate(active[k], params);

  const repli = localeState.tables[localeState.fallback];
  if(repli && typeof repli[k] === 'string'){
    noteMissing(k);
    return formatTemplate(repli[k], params);
  }
  noteMissing(k);
  return formatTemplate(k, params);
}

function noteMissing(key){
  if(localeState.missing.indexOf(key) !== -1) return;
  localeState.missing.push(key);
  // UNE SEULE FOIS POUR TOUTE LA PARTIE. Un avertissement par image, à soixante images par
  // seconde, est un avertissement qu'on finit par désactiver — et on désactive alors aussi
  // celui qui comptait.
  if(!localeState.warned && typeof console !== 'undefined'){
    localeState.warned = true;
    console.warn('[locale] clé « ' + key + ' » absente en « ' + localeState.code
      + ' ». Les suivantes sont dans missingKeys().');
  }
}

/** Les clés demandées et introuvables — pour un rapport de traduction, ou un test. */
export function missingKeys(){ return localeState.missing.slice(); }

/**
 * Applique les traductions au HTML d'une interface de jeu : tout élément `[data-t]` reçoit le
 * texte de sa clé.
 *
 * `data-t` vit à côté de `data-bind` (js/game-ui.js) et ne s'y substitue pas : `data-bind`
 * affiche une VALEUR que le script calcule, `data-t` affiche un TEXTE fixe qui doit être
 * traduit. Un score est le premier, un libellé de bouton le second.
 */
export function applyLocaleBind(containerDiv){
  if(!containerDiv || !containerDiv.querySelectorAll) return 0;
  let n = 0;
  containerDiv.querySelectorAll('[data-t]').forEach(function(el){
    const key = el.dataset ? el.dataset.t : null;
    if(key === undefined || key === null || key === '') return;
    el.textContent = translate(key);
    n++;
  });
  return n;
}

/** Le contenu d'une langue en JSON indenté — le fichier qu'on envoie à un traducteur. */
export function exportLocaleJson(locales, code){
  const tables = (locales && locales.tables) || {};
  return JSON.stringify(tables[code] || {}, null, 2);
}

/**
 * Relit le fichier d'un traducteur dans la table du projet. Rend le nombre de clés reprises,
 * ou `null` si le fichier n'est pas un objet de chaînes — plutôt que d'écraser la table avec
 * n'importe quoi.
 */
export function importLocaleJson(locales, code, json){
  let lu;
  try{ lu = JSON.parse(json); } catch(e){ return null; }
  if(!lu || typeof lu !== 'object' || Array.isArray(lu)) return null;
  const propre = {};
  Object.keys(lu).forEach(function(k){
    if(typeof lu[k] === 'string') propre[k] = lu[k];
  });
  if(!locales.tables) locales.tables = {};
  locales.tables[code] = propre;
  return Object.keys(propre).length;
}

// EXPOSÉ EN GLOBALE, à dessein — même régime que js/gamepad-input.js et js/touch-input.js.
globalThis.setupLocales = setupLocales;
globalThis.translateText = translate;
globalThis.localeCurrent = localeCurrent;
globalThis.setLocale = setLocale;
globalThis.localesAvailable = localesAvailable;
globalThis.applyLocaleBind = applyLocaleBind;
globalThis.missingLocaleKeys = missingKeys;
