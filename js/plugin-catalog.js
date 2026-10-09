// ---------- Le catalogue de plugins — le filtrage, et la porte d'installation ----------
//
// Ce fichier ne touche NI au DOM NI au réseau. Il est chargé des deux côtés d'une frontière :
//
//   plugins-page.js  (la page `/editeur/plugins.html`, une fenêtre à part) — affiche et filtre
//   plugins.js       (l'éditeur)                                          — installe
//
// LA PAGE N'ENVOIE PAS DE CODE. Une page qui enverrait le JavaScript à installer ferait du canal
// un canal d'EXÉCUTION : ce qui franchirait les contrôles s'exécuterait tel quel dans l'éditeur.
// Elle envoie donc un NOM DE FICHIER, et l'éditeur va lire lui-même `exemples/<nom>` — après
// avoir vérifié que ce nom figure dans le catalogue qu'il a chargé de son côté. Le pire qu'un
// message forgé puisse obtenir est donc l'installation d'un plugin déjà livré avec le moteur, et
// encore : derrière le `confirm()` d'installPlugin, inchangé.
//
// POURQUOI UN JETON ET PAS `window.opener`. La première version liait la demande à la fenêtre
// ouverte par l'éditeur (`event.source === gate.win`). Mesuré dans un vrai navigateur : le
// `window.open()` d'un volet intégré rend une fenêtre SANS `opener` — l'installation en un clic
// ne marchait simplement pas, sans une erreur. Le lien passe donc par un JETON tiré au hasard à
// chaque ouverture et transmis dans le FRAGMENT de l'URL (`plugins.html#k=…`) : le fragment ne
// part pas au serveur, et une autre page de la même origine ne peut pas le lire. Le canal est un
// `BroadcastChannel`, que le navigateur borne déjà à l'origine — il n'a pas besoin d'opener.
//
// Les verrous sont dans `installRequestFile()`, et `test/catalogue-plugins.test.mjs` casse
// chacun séparément pour vérifier qu'il mord.

/** Le manifeste, relatif à la racine du moteur (`/editeur/`). */
export const CATALOG_URL = 'exemples/catalogue.json';

/** Le canal, borné à l'origine par le navigateur lui-même. */
export const CHANNEL_CATALOG = 'evaveo3d-plugins';

/** La page du catalogue demande une installation. */
export const MESSAGE_INSTALL = 'evaveo3d-install-plugin';
/** L'éditeur répond ce qu'il a fait. */
export const MESSAGE_DONE = 'evaveo3d-plugin-installed';

/**
 * Le jeton qui lie une page de catalogue à l'éditeur qui l'a ouverte. Tiré par le générateur
 * cryptographique : il n'est pas deviné, et il ne sert qu'une ouverture.
 */
export function newCatalogKey(random){
  const bytes = new Uint8Array(16);
  (random || crypto).getRandomValues(bytes);
  return Array.from(bytes).map(function(b){ return b.toString(16).padStart(2, '0'); }).join('');
}

/** Le jeton porté par une URL de catalogue, ou '' — `plugins.html#k=<jeton>`. */
export function catalogKeyFromHash(hash){
  const m = /(?:^#?|&)k=([0-9a-f]{32})(?:&|$)/.exec(String(hash || ''));
  return m ? m[1] : '';
}

/**
 * Un nom de fichier de plugin, et rien qui puisse sortir de `exemples/`.
 * Le point d'entrée est déjà borné par le catalogue ; cette règle borne aussi le catalogue
 * lui-même, pour qu'une entrée fautive ne puisse pas fabriquer un chemin (`../../js/…`).
 */
export function isPluginFileName(name){
  return typeof name === 'string' && /^[a-z0-9][a-z0-9._-]*\.js$/.test(name) && name.indexOf('..') < 0;
}

/** L'entrée du catalogue portant ce fichier, ou null. */
export function entryForFile(catalog, file){
  const list = (catalog && catalog.plugins) || [];
  for(let i = 0; i < list.length; i++){
    if(list[i] && list[i].file === file) return list[i];
  }
  return null;
}

/** Les catégories présentes, dans l'ordre alphabétique, sans doublon. */
export function catalogCategories(catalog){
  const list = (catalog && catalog.plugins) || [];
  const seen = [];
  list.forEach(function(p){
    const c = p && p.category;
    if(c && seen.indexOf(c) < 0) seen.push(c);
  });
  return seen.sort(function(a, b){ return a.localeCompare(b, 'fr'); });
}

/**
 * La recherche porte sur tout ce qui est affiché — titre, résumé, description, catégorie,
 * points d'extension et prérequis. Chercher « blender » doit trouver le Studio, dont le titre
 * ne contient pas ce mot.
 */
export function matchesSearch(entry, query){
  const q = String(query || '').trim().toLowerCase();
  if(!q) return true;
  const parts = [entry.title, entry.summary, entry.description, entry.category, entry.file]
    .concat(entry.extends || []).concat(entry.requires || []);
  const hay = parts.filter(Boolean).join(' ').toLowerCase();
  // Tous les mots saisis, dans n'importe quel ordre : « mcp agent » trouve le pont.
  return q.split(/\s+/).every(function(word){ return hay.indexOf(word) >= 0; });
}

/** Le catalogue réduit à ce qui répond à la recherche ET à la catégorie choisie. */
export function filterCatalog(catalog, query, category){
  const list = (catalog && catalog.plugins) || [];
  return list.filter(function(p){
    if(!p) return false;
    if(category && p.category !== category) return false;
    return matchesSearch(p, query);
  });
}

/**
 * LA PORTE. Rend le nom de fichier à installer, ou null — et rien d'autre ne doit décider.
 *
 * `gate` est ce que l'éditeur a retenu en ouvrant le catalogue : `{key, origin}`. Les trois
 * verrous, dans cet ordre :
 *
 *   1. la demande porte LE JETON que cet éditeur a tiré en ouvrant cette page. Un éditeur qui
 *      n'a pas ouvert de catalogue n'a pas de jeton et refuse tout ; une autre page de la même
 *      origine ne peut pas deviner celui-ci, et ne peut pas le lire — il vit dans le fragment
 *      de l'URL d'une autre fenêtre. La comparaison est à longueur constante, par habitude :
 *      il n'y a pas de fuite de temps à offrir sur un jeton d'une seule utilisation ;
 *   2. l'origine est la nôtre. Le `BroadcastChannel` la borne déjà — c'est la ceinture en plus
 *      des bretelles, et surtout la ligne qui dit que la règle existe ;
 *   3. le fichier demandé figure dans le catalogue que NOUS avons chargé, et porte un nom de
 *      fichier acceptable.
 */
export function installRequestFile(event, gate, catalog){
  if(!event || !event.data || event.data.type !== MESSAGE_INSTALL) return null;
  if(!gate || !gate.key || !sameKey(event.data.key, gate.key)) return null;
  if(!gate.origin || event.origin !== gate.origin) return null;
  const file = event.data.file;
  if(!isPluginFileName(file)) return null;
  return entryForFile(catalog, file) ? file : null;
}

/** Comparaison de jetons à longueur constante. */
function sameKey(a, b){
  if(typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for(let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Le nom sous lequel un plugin du catalogue s'installe. */
// Le NOM DE FICHIER, pas le titre : c'est celui que donne l'installation manuelle d'un `.js`
// (`f.name.replace(/\.js$/i, '')`). Prendre le titre ferait cohabiter « Pont MCP » et
// « plugin-pont-mcp » comme deux plugins distincts, avec leurs deux jeux d'extensions.
export function pluginNameForFile(file){
  return String(file || '').replace(/\.js$/i, '');
}
