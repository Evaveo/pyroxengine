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

/**
 * Éteint le REPÈRE 3D d'un nœud d'édition (sphère d'une lumière, boîtier d'une caméra, sphère
 * chromée d'une sonde, octaèdre d'un émetteur) : son icône (js/gizmo-icons.js) le remplace.
 *
 * Le nœud RESTE ce maillage — c'est lui que la hiérarchie, le gizmo, la sérialisation et la
 * surbrillance connaissent, et le changer de classe casserait la relecture des projets. On lui
 * retire seulement tout calque : aucune caméra ne le dessine (ni l'éditeur, ni le jeu, ni une
 * sonde, ni une cuisson), aucune carte d'ombre ne le voit, et le raycast du viewport (masque de
 * calques) passe à travers. `Object3D.layers` n'est pas hérité : la THREE.Light ou la
 * THREE.Camera qu'il porte en enfant n'est pas touchée.
 *
 * L'ombre est coupée EN PLUS du calque, et ce n'est pas une redondance : la carte d'ombre d'une
 * lampe adopte le masque de calques de la caméra qui rend (three r185, ShadowNode), et la
 * caméra d'édition voit tout. C'est par là qu'un repère projetait l'ombre que l'on voyait au
 * centre du cône d'un spot (docs/KNOWN_ISSUES.md).
 */
export function hideEditorMarker(o){
  if(!o) return o;
  [o].concat(o.children || []).forEach(function(m){
    // Le nœud, et les pièces du repère qu'il porte en enfant (l'objectif d'une caméra) — jamais
    // un visuel de sélection (collider, boîte de sonde), qui a ses propres règles.
    if(m !== o && !(m.userData && m.userData.editorMarkerPart)) return;
    m.layers.disableAll();
    m.castShadow = false;
    m.receiveShadow = false;
  });
  return o;
}

/** Le repère d'un nœud d'édition est-il bien éteint (aucun calque, aucune ombre) ? */
export function isEditorMarkerHidden(o){
  return !!o && o.layers.mask === 0 && !o.castShadow && !o.receiveShadow;
}
