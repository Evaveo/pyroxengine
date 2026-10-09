// ---------- Réimporter un modèle EN PLACE ----------
//
// Réimporter un fichier sous le même nom créait un SECOND asset modèle : les prefabs et les
// instances gardaient l'ancien id, donc l'ancienne géométrie, et l'agent (ou l'humain) devait
// tout rebrancher à la main. Comme Unity, un réimport doit mettre à jour l'asset existant : MÊME
// id, contenu neuf. Ce module porte la partie PURE de l'opération (testable sans navigateur) ;
// l'orchestration (instances, prefabs, disque) vit dans `replaceModelAsset` (import-settings.js).

/** Ce qui vient du FICHIER, et passe donc du modèle fraîchement chargé à l'asset remplacé. */
export const REPLACED_MODEL_FIELDS = ['template', 'paquet', 'raw', 'animationsBrutes', 'unitFile',
  'matBruts', 'format', 'file', 'preview', 'dimensions', 'warningsImport', 'skinInfo'];

/**
 * Recopie le contenu de `fresh` dans `target` en gardant l'identité de `target` (id, nom,
 * dossier, réglages d'import). Rend `target`.
 */
export function transferModelContent(target, fresh){
  if(!target || !fresh) throw new Error('modèle à remplacer ou modèle neuf manquant');
  REPLACED_MODEL_FIELDS.forEach(function(k){
    if(fresh[k] !== undefined) target[k] = fresh[k];
  });
  if(target.template && target.template.userData) target.template.userData.assetId = target.id;
  return target;
}

/**
 * Les réglages d'import après remplacement : ceux de l'asset existant (le créateur a pu les
 * régler), sauf ce que l'appel donne EXPLICITEMENT (ex. `{centrer:false}`).
 */
export function mergeReplacedParams(oldParams, explicit){
  const out = Object.assign({}, oldParams || {});
  Object.keys(explicit || {}).forEach(function(k){
    if(explicit[k] !== undefined) out[k] = explicit[k];
  });
  return out;
}

/**
 * Les clips du modèle après remplacement : on garde ceux (et leurs id, que référencent les
 * Animators) dont la prise existe encore dans le nouveau fichier, et on en ajoute un par prise
 * nouvelle. Une liste absente reste absente : elle sera créée par défaut.
 */
export function reconcileClips(clips, takes, makeClip){
  if(!Array.isArray(clips)) return clips;
  const names = new Set((takes || []).filter(function(t){ return t && t.name; }).map(function(t){ return t.name; }));
  const kept = clips.filter(function(c){ return c && names.has(c.take); });
  names.forEach(function(n){
    if(!kept.some(function(c){ return c.take === n; })) kept.push(makeClip(n));
  });
  return kept;
}

/** Les racines d'instance de ce modèle dans un arbre (gabarit de prefab) : ce qu'il faut rebâtir. */
export function modelRootsIn(root, modelId){
  const out = [];
  (function walk(x){
    if(!x) return;
    if(x.userData && x.userData.assetId === modelId && x.userData.modelNode === undefined) out.push(x);
    (x.children || []).forEach(walk);
  })(root);
  return out;
}

/**
 * Les réglages de pivot donnés EXPLICITEMENT par un appel d'import (`center`, `setGround`) :
 * seulement ceux qui sont des booléens, pour qu'un champ omis garde le défaut (ou le réglage de
 * l'asset remplacé). Les défauts déplacent le pivot — mauvais pour une charnière de coffre.
 */
export function explicitPivotParams(a){
  const out = {};
  if(a && typeof a.center === 'boolean') out.centrer = a.center;   // clé d'outil anglaise → réglage sérialisé
  if(a && typeof a.setGround === 'boolean') out.setGround = a.setGround;
  return out;
}

/** Ce que l'import a fait du pivot, en clair, pour le résultat de l'outil. */
export function describePivot(params){
  const p = params || {};
  const c = p.centrer !== false, g = p.setGround !== false;
  return 'pivot : ' + (c ? 'recentré en X/Z (center:true)' : 'X/Z du fichier gardés (center:false)')
    + ', ' + (g ? 'base posée à Y=0 (setGround:true)' : 'Y du fichier gardé (setGround:false)');
}
