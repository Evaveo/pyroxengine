// ---------- Affordances en lecture seule ----------
// Jusqu'ici, le SEUL mécanisme était le refus dans `pushHistory()` (js/history.js) : on
// découvrait la lecture seule EN ESSAYANT, après avoir tiré une flèche du gizmo sur trente
// pixels. Le bandeau prévient depuis la v0.154.0 ; ce module rend les commandes réellement
// inertes, pour que le refus cesse d'être la première nouvelle.
//
// CE MODULE NE PROTÈGE RIEN. Il ne remplace ni `pushHistory()`, ni la concurrence optimiste du
// serveur : une commande grisée se rallume depuis la console en une ligne. Il enlève l'invitation
// à faire un geste qui sera refusé — c'est tout ce qu'une affordance peut faire, et le prétendre
// davantage serait le mensonge que docs/BONNES_PRATIQUES.md appelle un verrou cosmétique.
//
// C'est CE module qui s'abonne à scene-lock.js, et jamais l'inverse : scene-lock est une
// feuille sans le moindre import, ce qui permet à son test de le charger seul. Lui faire
// appeler d'ici tirerait scene.js — et les 150 modules de l'éditeur — dans ce test.
import { tc, gizmoAttach, gizmoSyncSelection } from './scene.js';
import { onLockChange } from './scene-lock.js';

// ---------- Qui a le droit d'armer le gizmo ----------
// `tc.enabled` avait DEUX propriétaires : la simulation physique (js/physics.js) le coupait au
// démarrage et le rallumait à l'arrêt. Un second propriétaire — la lecture seule — l'aurait
// rallumé en pleine simulation en relâchant son propre verrou, et rien ne l'aurait signalé.
// D'où ce registre de raisons : le gizmo est armé quand il n'en reste aucune.
const blocked = new Set();

/** Pose ou retire une raison de couper le gizmo. `reason` identifie le propriétaire. */
export function setGizmoBlocked(reason, isBlocked){
  if(isBlocked) blocked.add(reason); else blocked.delete(reason);
  refreshGizmo();
}

export function gizmoAllowed(){ return blocked.size === 0; }

/** Applique l'état courant au contrôleur. */
export function refreshGizmo(){
  if(!tc) return;
  const allowed = gizmoAllowed();
  tc.enabled = allowed;
  // Un gizmo VISIBLE mais inerte serait pire que pas de gizmo : ses flèches disent « tire-moi ».
  if(allowed) gizmoSyncSelection();
  else gizmoAttach(null);
}

// ---------- Commandes de l'interface ----------
// Deux régimes, et le choix entre les deux n'est pas un détail :
//
//   - Dans l'INSPECTEUR, tout est coupé SAUF ce qui porte `data-readonly-ok`. L'inspecteur est
//     reconstruit par une vingtaine d'appelants et gagne des champs à chaque version : une liste
//     de ce qu'il faut couper serait fausse à la version suivante, en silence. Une liste de ce
//     qui reste vivant, elle, se trompe du bon côté.
//   - Dans la BARRE et la HIÉRARCHIE, la liste est explicite : l'essentiel de la barre (modes de
//     vue, ombres, textures, grille) ne touche pas la scène et doit rester utilisable — on
//     consulte une scène verrouillée, c'est même tout l'intérêt.
// Conteneurs dont TOUTES les commandes sont coupées, et commandes isolées à couper.
const EXPLICIT_CONTAINERS = [
  'g-tools',              // les trois modes de gizmo : sans gizmo, ils ne mènent nulle part
  'bar-types-creatable'   // la palette flottante des types créables
];
const EXPLICIT_IDS = [
  'g-space',              // le référentiel du gizmo, même raison que ses modes
  'btn-scene-add'         // ajouter une scène au projet
];

const CLASS_READONLY = 'scene-readonly';
const ATTRIBUTE_KEPT = 'data-readonly-kept';

let observer = null;
let readonlyNow = false;

/** Vrai quand l'éditeur est en lecture seule. Lu par les menus (js/ui.js). */
export function isReadOnly(){ return readonlyNow; }

function doc(){ return (typeof document !== 'undefined') ? document : null; }

// `disabled` posé par NOUS est marqué : sans cette marque, en sortant de lecture seule on
// rallumerait des commandes que l'éditeur avait éteintes pour ses propres raisons — un bouton
// « Supprimer la clé » sans clé sélectionnée, par exemple, redeviendrait cliquable.
function disable(el){
  if(el.disabled) return;
  el.disabled = true;
  el.setAttribute(ATTRIBUTE_KEPT, '1');
}

function restore(el){
  if(!el.hasAttribute(ATTRIBUTE_KEPT)) return;
  el.removeAttribute(ATTRIBUTE_KEPT);
  el.disabled = false;
}

const TAGS_CONTROL = ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'];

// Parcours explicite plutôt qu'un sélecteur CSS : une liste séparée par des virgules, un
// combinateur de descendance et un sélecteur d'attribut sont trois choses que le harnais de
// test ne sait pas lire (test/engine-env.mjs), et un sélecteur qui ne matche rien ne se
// plaint pas — le module aurait été « testé » sans jamais couper quoi que ce soit.
function controlsOf(root, keepAllowed){
  const out = [];
  (function walk(node){
    const kids = node.children || [];
    for(let i = 0; i < kids.length; i++){
      const el = kids[i];
      if(TAGS_CONTROL.indexOf(el.tagName) !== -1
         && !(keepAllowed && el.hasAttribute && el.hasAttribute('data-readonly-ok'))){
        out.push(el);
      }
      walk(el);
    }
  })(root);
  return out;
}

function applyInspector(d, readonly){
  const body = d.getElementById('insp-body');
  if(!body) return;
  controlsOf(body, true).forEach(readonly ? disable : restore);
}

function applyExplicit(d, readonly){
  const act = readonly ? disable : restore;
  EXPLICIT_CONTAINERS.forEach(function(id){
    const root = d.getElementById(id);
    if(root) controlsOf(root, false).forEach(act);
  });
  EXPLICIT_IDS.forEach(function(id){
    const el = d.getElementById(id);
    if(el) act(el);
  });
}

// L'inspecteur se reconstruit depuis une vingtaine de sites d'appel, dont plusieurs sortent de
// `buildInspector()` par un `return` anticipé : il n'y a pas d'« après la construction » unique
// où se brancher. L'observateur ne regarde QUE `childList` — surtout pas les attributs, sinon nos
// propres écritures de `disabled` le réveilleraient en boucle.
function watchInspector(d){
  if(observer || typeof MutationObserver === 'undefined') return;
  const body = d.getElementById('insp-body');
  if(!body) return;
  observer = new MutationObserver(function(){
    if(readonlyNow) applyInspector(d, true);
  });
  observer.observe(body, {childList: true, subtree: true});
}

// Le glisser-déposer de la hiérarchie REPARENTE : il passe donc par `pushHistory()`, qui le
// refuse — mais après avoir laissé traîner une ligne à travers tout le panneau. Refuser le
// `dragstart` coupe le geste à son premier pixel. En capture, pour passer avant le gestionnaire
// de hierarchy.js sans avoir à le modifier.
let dragGuarded = false;

function guardDragHierarchy(d){
  if(dragGuarded) return;
  const body = d.getElementById('hier-body');
  if(!body) return;
  dragGuarded = true;
  body.addEventListener('dragstart', function(e){
    if(!readonlyNow) return;
    e.preventDefault();
    e.stopPropagation();
  }, true);
}

/** Point d'entrée unique : applique un état de lecture seule à toute l'interface. */
export function applyReadOnlyUI(readonly){
  const d = doc();
  if(!d || !d.body) return;
  readonlyNow = !!readonly;
  d.body.classList.toggle(CLASS_READONLY, readonlyNow);
  applyInspector(d, readonlyNow);
  applyExplicit(d, readonlyNow);
  watchInspector(d);
  guardDragHierarchy(d);
  setGizmoBlocked('lock', readonlyNow);
}

// L'abonnement est pose a l'evaluation du module : editor.html le charge, et physics.js /
// objects.js / ui.js l'importent — il est donc toujours evalue dans l'editeur.
onLockChange(applyReadOnlyUI);
