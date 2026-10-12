// ---------- Panneau Projet : la largeur de l'arbre des dossiers, au glisser ----------
//
// L'arbre était figé à 160 px : un projet importé d'Unity, aux noms de dossier longs
// (`IndustrialCeilingLamp_01`), ne s'y lisait plus. Une poignée entre l'arbre et les tuiles le
// redimensionne, comme les cellules du dock (js/ui/dock.js) et pour la même raison technique :
// Pointer Events + `setPointerCapture`, sans quoi le geste se perd dès que le curseur sort de la
// fenêtre. La largeur est une PRÉFÉRENCE de machine (`project.treeWidth`), pas un réglage de
// projet.
import { Prefs } from './prefs.js';

// Assez pour une flèche, une icône et trois lettres ; assez de tuiles pour en voir une.
export const TREE_WIDTH_MIN = 90;
export const TILES_WIDTH_MIN = 140;

/** La largeur retenue, bornée par ce que la zone peut offrir. Pure, pour être testée. */
export function clampTreeWidth(width, zoneWidth){
  const max = Math.max(TREE_WIDTH_MIN, (zoneWidth || Infinity) - TILES_WIDTH_MIN);
  const w = (typeof width === 'number') ? width : parseFloat(width);   // null → NaN → défaut
  return Math.round(Math.max(TREE_WIDTH_MIN, Math.min(max, isFinite(w) ? w : 160)));
}

function setup(){
  const tree = document.getElementById('folders-tree');
  const handle = document.getElementById('folders-tree-handle');
  if(!tree || !handle) return;
  const zone = tree.parentNode;
  const apply = function(w){ tree.style.flexBasis = w + 'px'; };
  apply(clampTreeWidth(Prefs.get('project.treeWidth'), 0));

  let dragging = false;
  handle.addEventListener('pointerdown', function(e){
    dragging = true;
    handle.classList.add('active');
    if(handle.setPointerCapture && e.pointerId !== undefined) handle.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  handle.addEventListener('pointermove', function(e){
    if(!dragging) return;
    const r = zone.getBoundingClientRect();
    apply(clampTreeWidth(e.clientX - r.left, r.width));
  });
  function end(){
    if(!dragging) return;
    dragging = false;
    handle.classList.remove('active');
    // Écrit à la FIN du geste : une écriture par pixel ferait ramer le glissement lui-même.
    Prefs.set('project.treeWidth', parseFloat(tree.style.flexBasis) || 160);
  }
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
  // Double-clic : retour à la largeur par défaut.
  handle.addEventListener('dblclick', function(){
    apply(160);
    Prefs.set('project.treeWidth', 160);
  });
}

// Module de l'éditeur seulement (balise de editor.html) : le document existe toujours ici.
setup();
