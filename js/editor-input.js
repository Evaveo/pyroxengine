// ---------- Dispatcher d'entrées unique (Lot 0) ----------
// Remplace les listeners `capture` dispersés dans placement.js / terrain.js et les
// listeners `keydown` concurrents pour Escape. Un mode peut s'register avec une
// priorité ; à chaque pointerdown/wheel/Escape, le mode de plus haute priorité qui
// « accepte » l'événement le traite en premier et peut empêcher les suivants de tourner
// (return true = consommé). Ordre de priorité (le plus haut d'abord) :
//   sculpt > paint > gizmo (géré par TransformControls, hors dispatcher) >
//   rubber band (lot 5) > sélection/caméra (viewport.js, priorité la plus basse)
import { renderer } from './scene.js';

export const inputs = {
  gestionnaires: []   // {name, priorite, pointerdown, pointermove, pointerup, wheel, escape}
};

// priorite : nombre, plus haut = essayé en premier
export function registerInputs(def){
  inputs.gestionnaires.push(def);
  inputs.gestionnaires.sort(function(a, b){ return b.priorite - a.priorite; });
}

export function distributePoint(nameEvt, e){
  for(let i = 0; i < inputs.gestionnaires.length; i++){
    const g = inputs.gestionnaires[i];
    if(typeof g[nameEvt] !== 'function') continue;
    if(g[nameEvt](e) === true) return true;   // consommé : les suivants ne voient pas l'événement
  }
  return false;
}

/**
 * Branche le distributeur sur le canevas. Appelée par `startup.js`.
 *
 * POURQUOI UNE FONCTION, et pas quatre lignes à la marge comme avant : `renderer` est un `const`
 * de `js/scene.js`. Tant que tout vit dans une portée globale, l'ordre des <script> suffit à
 * garantir qu'il existe. En modules ES, `scene.js` et ce fichier sont dans un cycle d'imports —
 * ce fichier peut donc s'évaluer AVANT lui, et lire `renderer` à ce moment-là lèverait une
 * ReferenceError de zone morte temporelle, au démarrage, avant le premier pixel. Différer le
 * câblage jusqu'à `startup.js` lève la contrainte d'ordre au lieu de parier dessus.
 */
export function bindEditorInput(){
  renderer.domElement.addEventListener('pointerdown', function(e){ distributePoint('pointerdown', e); });
  renderer.domElement.addEventListener('pointermove', function(e){ distributePoint('pointermove', e); });
  renderer.domElement.addEventListener('pointerup', function(e){ distributePoint('pointerup', e); });
  renderer.domElement.addEventListener('wheel', function(e){ distributePoint('wheel', e); }, {passive:false});
}

addEventListener('keydown', function(e){
  if(e.key !== 'Escape') return;
  for(let i = 0; i < inputs.gestionnaires.length; i++){
    const g = inputs.gestionnaires[i];
    if(typeof g.escape === 'function' && g.escape(e) === true) return;
  }
});


// EXPOSÉ EN GLOBALE, à dessein. Ces symboles sont appelés depuis des fichiers
// que les mêmes pages ne chargent pas toutes : un `import` y pointerait un
// fichier absent, et la page ne démarrerait pas. Ils gardent donc leur garde
// `typeof` côté appelant, et se déclarent ici.
globalThis.inputs = inputs;