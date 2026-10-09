// ---------- Les BIBLIOTHÈQUES de scripts : du code partagé entre scripts ----------
// ---------- PARTAGÉ éditeur ↔ jeu publié ----------
//
// Né d'un jeu de stratégie construit par un agent MCP (2026-09-29) : faute de pouvoir partager une
// fonction entre deux scripts, toute la simulation — unités, chemins, économie, IA, réseau — tenait
// dans UN script de 180 000 caractères. Un script ne voyait que lui-même ; le découper, c'était
// dupliquer le noyau dans chaque morceau.
//
// Une bibliothèque est un asset script ORDINAIRE, qui remplit `exports` au lieu de définir
// start/update :
//
//     // asset « lib_grille »
//     exports.voisins = function(x, y){ … };
//
//     // n'importe quel script
//     const grille = api.lib('lib_grille');
//
// Aucun champ de format nouveau : c'est l'appel `api.lib(nom)` qui fait d'un asset une
// bibliothèque. Elle s'exécute UNE fois par partie (le cache est vidé à chaque lancement) et tous
// ses appelants reçoivent le MÊME objet `exports` — c'est ce qui permet à deux scripts de
// partager un état. Elle reçoit un `api` réduit : `lib` (ses propres dépendances), `data`, `log`,
// `warn`, `error`. Pas `me` : une bibliothèque n'appartient à aucun objet — ce dont elle a besoin
// d'un objet, l'appelant le lui passe en argument.
//
// Pur : aucun import de three ni du DOM. La compilation passe par js/script-scope.js, le point de
// compilation unique des deux moteurs.

import { compileScript } from './script-scope.js';

/**
 * Un hôte de bibliothèques pour une partie.
 *
 * `findCode(nom)` rend le code de l'asset script de ce nom, ou `null` s'il n'existe pas.
 * `baseApi` fournit `data`, `log`, `warn`, `error` à la bibliothèque (facultatif).
 * Rend `{lib(nom), reset()}`.
 */
export function createLibraryHost(findCode, baseApi){
  const cache = Object.create(null);   // nom -> {source, exports}
  const loading = [];           // pile des bibliothèques en cours d'exécution (détection de cycle)
  const base = baseApi || {};
  const noop = function(){};

  function lib(name){
    const key = String(name || '');
    const code = findCode(key);
    if(code === null || code === undefined){
      throw Error('api.lib : bibliothèque « ' + key + ' » introuvable (asset script de ce nom)');
    }
    const hit = cache[key];
    // Même source : même objet. Une source CHANGÉE (retouche dans l'éditeur pendant le jeu)
    // recompile — un appelant qui relit api.lib() voit la nouvelle version.
    if(hit && hit.source === code) return hit.exports;
    if(loading.indexOf(key) !== -1){
      throw Error('api.lib : dépendance circulaire — ' + loading.concat(key).join(' → '));
    }
    loading.push(key);
    try {
      const libApi = {
        lib: lib,
        data: base.data || function(){ return null; },
        log: base.log || noop, warn: base.warn || noop, error: base.error || noop
      };
      const exp = compileScript('const exports = {};\n' + code, '\nreturn exports;')(libApi);
      cache[key] = {source: code, exports: exp};
      return exp;
    } catch(e){
      throw Error(/^api\.lib/.test(e.message) ? e.message : 'api.lib(« ' + key + ' ») : ' + e.message);
    } finally {
      loading.pop();
    }
  }

  return {lib: lib, reset: function(){ Object.keys(cache).forEach(function(k){ delete cache[k]; }); loading.length = 0; }};
}

/**
 * L'hôte d'une partie, résolu par NOM dans une liste d'assets — la forme qu'utilisent les deux
 * moteurs (`assets` dans l'éditeur, `GAME_DATA.assets` dans le jeu publié). `onDuplicate(nom, n)`
 * est appelé quand plusieurs scripts portent ce nom : c'est le premier qui est lu.
 */
export function libraryHostForAssets(getAssets, baseApi, onDuplicate){
  return createLibraryHost(function(name){
    const found = (getAssets() || []).filter(function(x){ return x.kind === 'script' && x.name === name; });
    if(found.length > 1 && onDuplicate) onDuplicate(name, found.length);
    return found.length ? (found[0].code || '') : null;
  }, baseApi);
}
