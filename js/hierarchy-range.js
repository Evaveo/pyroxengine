// ---------- Maj+clic dans la hiérarchie : la sélection par PLAGE, comme dans Unity ----------
//
// PUR, sans aucun import : il reçoit des identifiants et rend des identifiants. La hiérarchie
// (js/hierarchy.js) lui passe l'ordre AFFICHÉ — les lignes présentes à l'écran, donc les seules
// dépliées et celles qui passent le filtre par nom — et applique le résultat par les fonctions
// de sélection habituelles (js/selection.js). Testé par test/hierarchie-plage.test.mjs.
//
// Les gestes, ceux d'Unity :
//   clic          → sélection simple, et l'objet devient l'ANCRE ;
//   Ctrl/Cmd+clic → ajoute ou retire, et l'objet devient l'ancre ;
//   Maj+clic      → la plage entre l'ancre et la ligne cliquée REMPLACE la sélection ;
//   Maj+Ctrl+clic → la même plage S'AJOUTE à la sélection.
// L'ancre ne bouge pas pendant une suite de Maj+clics : on étend ou on réduit la même plage.

/**
 * L'ancre effective : la dernière ligne cliquée si elle est toujours sélectionnée ET affichée,
 * sinon l'objet principal de la sélection s'il est affiché, sinon `null`.
 *
 * Une ancre qui n'est plus sélectionnée (on a cliqué un objet dans la vue entre-temps) mènerait
 * une plage depuis un objet que rien ne désigne plus à l'écran : Unity repart alors de la
 * sélection active, et c'est ce qu'on fait.
 */
export function resolveRangeAnchor(lastClickedId, selectedIds, primaryId, order){
  const shown = function(id){ return id != null && (order || []).indexOf(id) !== -1; };
  if(shown(lastClickedId) && (selectedIds || []).indexOf(lastClickedId) !== -1) return lastClickedId;
  if(shown(primaryId)) return primaryId;
  return null;
}

/** Les ids de `order` entre `anchorId` et `targetId`, bornes comprises, dans l'ordre affiché.
 *  Sans ancre affichée, la plage se réduit à la cible. */
export function rangeIds(order, anchorId, targetId){
  const list = order || [];
  const j = list.indexOf(targetId);
  if(j === -1) return [];
  const i = list.indexOf(anchorId);
  if(i === -1) return [targetId];
  return list.slice(Math.min(i, j), Math.max(i, j) + 1);
}

/**
 * Retire d'une liste les objets dont un ANCÊTRE y figure déjà.
 *
 * La sélection multiple du moteur refuse un parent et son propre enfant ensemble (le gizmo les
 * déplacerait deux fois, la suppression supprimerait deux fois — voir `toggleMulti`). Une plage
 * qui traverse un groupe déplié contient les deux : on garde le PARENT, qui emporte déjà ses
 * enfants pour toutes ces opérations. `parentOf(id)` rend l'id du parent, ou `null` à la racine.
 */
export function pruneNestedIds(ids, parentOf){
  const set = new Set(ids || []);
  return (ids || []).filter(function(id){
    let p = parentOf(id);
    const guard = new Set();
    while(p != null && !guard.has(p)){
      if(set.has(p)) return false;
      guard.add(p);
      p = parentOf(p);
    }
    return true;
  });
}

/**
 * La sélection que produit un Maj+clic : `{primary, ids}`.
 *
 * `ids` : la plage, sans les descendants d'un objet qu'elle contient déjà. `primary` : l'objet
 * qui porte le gizmo et l'inspecteur — la ligne CLIQUÉE, comme l'objet actif d'Unity, sauf si
 * elle a été retirée parce que son parent est dans la plage : c'est alors ce parent.
 */
export function rangeSelection(order, anchorId, targetId, parentOf){
  const range = rangeIds(order, anchorId, targetId);
  if(!range.length) return {primary: null, ids: []};
  const kept = pruneNestedIds(range, parentOf || function(){ return null; });
  let primary = targetId;
  if(kept.indexOf(primary) === -1){
    let p = parentOf ? parentOf(targetId) : null;
    while(p != null && kept.indexOf(p) === -1) p = parentOf(p);
    primary = (p != null) ? p : kept[0];
  }
  return {primary: primary, ids: kept};
}

/** Le geste, d'après les touches tenues : 'single' | 'toggle' | 'range' | 'addRange'. */
export function hierarchyClickGesture(e){
  const ctrl = !!(e && (e.ctrlKey || e.metaKey));
  const shift = !!(e && e.shiftKey);
  if(shift) return ctrl ? 'addRange' : 'range';
  return ctrl ? 'toggle' : 'single';
}
