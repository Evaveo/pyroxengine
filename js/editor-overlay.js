// moteur/js/editor-overlay.js
//
// Les aides d'édition (grille, contours de collider, repères de lumière et de caméra, icônes,
// squelette, cadre du pinceau de tuiles) doivent se dessiner PAR-DESSUS tout le contenu du projet.
//
// Le piège : les sprites et les tuiles ont `depthTest:false` et `transparent:true` (voir
// `materialSprite`, sprite-2d.js) et se classent par `renderOrder` seul — de `calque × 1000`
// ± 499, donc jusqu'à plusieurs milliers. Un moteur de rendu dessine d'abord TOUT l'opaque, puis
// tout le transparent trié par `renderOrder`. Une aide opaque (lignes de repère, icônes) était
// donc recouverte par n'importe quelle tuile, et une aide transparente à `renderOrder` 999 passait
// sous les calques supérieurs : le gizmo « derrière » les images 2D.
//
// `liftOverlay` règle les deux d'un coup : l'objet passe dans la file transparente et prend un
// rang au-dessus du plus haut rang possible d'un sprite.

/** Au-dessus de tout rang de sprite (calque × 1000 + 499) ; reste sous le gizmo de transformation (Infinity). */
export const EDITOR_OVERLAY_ORDER = 1000000;

/**
 * Fait dessiner `root` (et ses descendants) après les sprites et tuiles.
 *
 * `depthTest` n'est PAS touché : une icône doit rester cachée derrière un objet 3D qui la
 * recouvre. Les sprites n'écrivant pas la profondeur, ils ne la cachent plus pour autant.
 * `extra` départage deux aides entre elles (la poignée au-dessus du contour).
 */
export function liftOverlay(root, extra){
  if(!root) return root;
  const order = EDITOR_OVERLAY_ORDER + (extra || 0);
  if(root.material){
    root.renderOrder = order;
    (Array.isArray(root.material) ? root.material : [root.material]).forEach(function(m){
      m.transparent = true;
    });
  }
  (root.children || []).forEach(function(child){ liftOverlay(child, extra); });
  return root;
}
