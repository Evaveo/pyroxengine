// ---------- Les nœuds d'un modèle importé, objets de scène comme dans Unity ----------
//
// Dans Unity, glisser un FBX dans la scène pose une INSTANCE DE SON MODEL PREFAB : toute sa
// hiérarchie, os compris, devient des GameObjects qu'on sélectionne, qu'on déplace, sur lesquels
// on ajoute des composants (un collider sur la main, une arme accrochée à un os) — et ces
// modifications sont des OVERRIDES, qui survivent au réimport du fichier.
//
// Jusqu'à la v0.159 les nœuds d'un modèle n'étaient pas des objets de projet (voir l'ancienne
// décision dans js/skeleton.js). Ils le sont désormais, avec la mécanique des sous-scènes
// (js/subscenes.js) comme précédent : les nœuds sont REGÉNÉRÉS depuis le modèle à chaque
// chargement, jamais sérialisés pour eux-mêmes ; seuls leurs ÉCARTS au fichier le sont, sur la
// racine de l'instance (`modelNodes`).
//
// PARTAGÉ éditeur ↔ runtime : aucun import, THREE en globale, comme js/model-import.js.
//
// L'IDENTITÉ D'UN NŒUD, C'EST SA CLÉ : son nom, suivi d'un rang quand plusieurs nœuds du modèle
// portent le même (`Cube`, `Cube#2`). Un nom et pas un chemin, parce que les réglages d'import
// (tri, repli des nœuds vides) déplacent les nœuds dans l'arbre sans les renommer — un override
// posé sur la main doit retrouver la main après qu'on a coché « Trier par nom ». C'est aussi par
// son nom qu'un clip d'animation retrouve un os.

/** Ce qui n'est pas un nœud du FICHIER : les visuels d'édition posés sur l'instance. */
function isEditorVisual(o){
  const u = o.userData || {};
  return !!(u.isColliderViz || u.isHelpProbe || u.isEditorHelper);
}

/**
 * Les nœuds du modèle sous `root` (racine exclue), dans l'ordre de parcours, avec leur clé.
 * `skip(o)` écarte un sous-arbre entier — un objet de scène de l'utilisateur, parenté sous un
 * os, n'appartient pas au modèle.
 */
export function modelNodesOf(root, skip){
  const out = [];
  const seen = new Map();
  (function walk(o){
    o.children.forEach(function(c){
      if(isEditorVisual(c) || (skip && skip(c))) return;
      const n = String(c.name || '');
      const k = (seen.get(n) || 0) + 1;
      seen.set(n, k);
      out.push({node: c, key: k === 1 ? n : n + '#' + k});
      walk(c);
    });
  })(root);
  return out;
}

/** Le nœud d'un modèle qui porte cette clé, ou null. */
export function modelNodeByKey(root, key){
  if(!root || !key) return null;
  let found = null;
  (function walk(o){
    for(let i = 0; i < o.children.length && !found; i++){
      const c = o.children[i];
      if(c.userData && c.userData.modelNode === key){ found = c; return; }
      walk(c);
    }
  })(root);
  return found;
}

/**
 * Marque un nœud de modèle comme ÉDITÉ à la main (gizmo, inspecteur). Seuls ceux-là voient leur
 * transformée écrite en override : un os que l'aperçu d'animation vient de poser n'est pas un
 * écart de l'utilisateur, et l'enregistrer figerait la pose du moment dans la scène.
 */
export function markModelNodeEdited(o){
  if(o && o.userData && o.userData.modelNode !== undefined) o.userData.modelEdited = true;
}

export function isModelNode(o){
  return !!(o && o.userData && o.userData.modelNode !== undefined);
}

/** La racine de l'instance de modèle qui porte ce nœud (le nœud lui-même s'il n'en est pas un). */
export function modelRootOf(o){
  let n = o;
  while(n && isModelNode(n) && n.parent) n = n.parent;
  return n;
}

/**
 * Fait des nœuds du modèle des nœuds de projet : chacun reçoit sa clé et un tableau de
 * composants (c'est ce qui fait d'un Object3D un nœud, voir `serializeTree`). `hooks.node(o)`
 * est appelé pour chaque nœud exposé — l'éditeur y pose `ed` et le mixin, le runtime son index.
 * `hooks.skip(o)` écarte les sous-arbres qui ne viennent pas du fichier.
 *
 * « Optimize Game Objects » (onglet Rig) : seuls les maillages et les « Extra Transforms to
 * Expose » — plus leurs ancêtres, pour qu'ils restent atteignables dans la hiérarchie — sont
 * exposés ; le squelette reste interne, comme dans Unity.
 */
export function exposeModelNodes(root, params, hooks){
  const p = params || {};
  const list = modelNodesOf(root, hooks && hooks.skip);
  let keep = null;
  if(p.optimizeGameObjects){
    const extra = new Set(p.extraTransforms || []);
    keep = new Set();
    list.forEach(function(e){
      if(!e.node.isMesh && !extra.has(e.node.name)) return;
      let n = e.node;
      while(n && n !== root){ keep.add(n); n = n.parent; }
    });
  }
  const exposed = [];
  list.forEach(function(e){
    const o = e.node;
    if(keep && !keep.has(o)) return;
    // « Generate Colliders » : un collider par maillage. Le moteur physique n'a pas de collider
    // maillage exact ; `auto` s'ajuste à la boîte du maillage, ce qui est le plus proche.
    if(p.generateColliders && o.isMesh) o.userData.collider = o.userData.collider
      || {shape: 'auto', dims: [1, 1, 1], radius: 1, height: 2, offset: [0, 0, 0], trigger: false};
    o.userData.modelNode = e.key;
    // L'état du FICHIER au moment de l'exposition : la référence des écarts quand le template,
    // lui, vient de changer (réimport — voir captureModelOverrides).
    o.userData.modelBase = {pos: o.position.toArray(), quat: o.quaternion.toArray(),
                            ech: o.scale.toArray(), visible: o.visible};
    if(!Array.isArray(o.userData.components)) o.userData.components = [];
    exposed.push(e);
    if(hooks && hooks.node) hooks.node(o, e.key);
  });
  return exposed;
}

/** Les nœuds exposés d'une instance (ceux qui portent une clé). */
export function exposedNodesOf(root){
  const out = [];
  root.traverse(function(o){ if(o !== root && isModelNode(o)) out.push(o); });
  return out;
}

const EPS = 1e-6;
function differs(a, b){
  for(let i = 0; i < a.length; i++) if(Math.abs(a[i] - b[i]) > EPS) return true;
  return false;
}

/**
 * Les ÉCARTS de chaque nœud exposé à son homologue du template (même clé) : transformée,
 * visibilité, composants. Sans template (réimport : il vient d'être modifié), la référence est
 * l'état que le nœud avait à son exposition (`modelBase`). `serializeComponents(o)` rend la liste de composants à écrire — les
 * deux côtés ont leur sérialiseur. Rend `{ids, overrides}` : `ids` garde l'identifiant de CHAQUE
 * nœud exposé, pour que ce qui le cite (une piste d'animation, un script, une caméra qui suit)
 * le retrouve au rechargement.
 */
export function captureModelOverrides(root, template, serializeComponents){
  const ids = {}, overrides = {};
  const byKey = new Map();
  if(template) modelNodesOf(template).forEach(function(e){ byKey.set(e.key, e.node); });
  exposedNodesOf(root).forEach(function(o){
    const key = o.userData.modelNode;
    ids[key] = o.id;
    const node = byKey.get(key);
    const base = o.userData.modelBase;
    const ref = node ? {pos: node.position.toArray(), quat: node.quaternion.toArray(),
                        ech: node.scale.toArray(), visible: node.visible}
      : (template ? null : base);
    const ov = {};
    if(o.userData.modelEdited){
      if(!ref || differs(o.position.toArray(), ref.pos)) ov.pos = o.position.toArray();
      if(!ref || differs(o.quaternion.toArray(), ref.quat)) ov.quat = o.quaternion.toArray();
      if(!ref || differs(o.scale.toArray(), ref.ech)) ov.ech = o.scale.toArray();
    }
    // `visibleIntent` : un noeud de modele regroupe porterait sinon une surcharge
    // « masque » que personne n'a demandee, ecrite dans le fichier de projet.
    // `typeof` : ce fichier part dans les builds, et js/render-perf.js en est retirable.
    // Le repli n'est pas une degradation — sans regroupement, `visible` EST l'intention.
    const vu = (typeof visibleIntent === 'function') ? visibleIntent(o) : (o.visible !== false);
    if(vu !== (ref ? ref.visible : true)) ov.visible = vu;
    if(Array.isArray(o.userData.materialSlots) && o.userData.materialSlots.some(Boolean)){
      ov.materialSlots = o.userData.materialSlots.slice();
    }
    const comps = serializeComponents ? serializeComponents(o) : [];
    if(comps && comps.length) ov.components = comps;
    if(Object.keys(ov).length) overrides[key] = ov;
  });
  return {ids: ids, overrides: overrides};
}

/**
 * Repose les écarts sur une instance fraîchement exposée. `applyComponents(o, list)` pose les
 * composants, `applyMaterials(o)` les emplacements de matériaux — chaque côté a les siens. Un override dont le nœud a disparu du fichier (réimport
 * d'un fichier différent) est ignoré, jamais posé ailleurs.
 */
export function applyModelOverrides(root, data, applyComponents, applyMaterials){
  if(!data || !data.overrides) return 0;
  let n = 0;
  Object.keys(data.overrides).forEach(function(key){
    const o = modelNodeByKey(root, key);
    const ov = data.overrides[key];
    if(!o || !ov) return;
    if(ov.pos) o.position.fromArray(ov.pos);
    if(ov.quat) o.quaternion.fromArray(ov.quat);
    if(ov.ech) o.scale.fromArray(ov.ech);
    if(ov.pos || ov.quat || ov.ech) o.userData.modelEdited = true;
    if(ov.visible !== undefined) o.visible = !!ov.visible;
    if(ov.components && ov.components.length && applyComponents) applyComponents(o, ov.components);
    // Les emplacements de matériaux remplacés sur cette instance (le Renderer d'Unity).
    if(Array.isArray(ov.materialSlots)){
      o.userData.materialSlots = ov.materialSlots.slice();
      if(applyMaterials) applyMaterials(o);
    }
    n++;
  });
  return n;
}

/**
 * L'entrée d'un maillage skinné de modèle écrite par une version d'avant la v0.159 : ce nœud
 * interne était indexé comme un objet de scène, donc écrit à part avec son seul
 * SkinnedMeshRenderer. Les deux moteurs l'ignorent désormais à la reconstruction (il donnait un
 * Group vide accroché sous la racine) ; ses `externalClips` restent repris par leur passe de
 * second temps.
 */
export function isLegacySkinnedEntry(d){
  const c = d && d.components;
  return Array.isArray(c) && c.length === 1 && !!c[0] && c[0].type === 'SkinnedMeshRenderer'
    && d.parent !== null && d.parent !== undefined && d.modelNodes === undefined;
}

/**
 * L'instance posée doit-elle recevoir un Animator ? Unity en met un sur la racine de tout Model
 * Prefab dont le type d'animation n'est pas « None ». On le restreint à ce qui peut s'animer —
 * un squelette ou des clips — pour ne pas en semer un sur chaque caillou du décor.
 */
export function wantsAnimator(root, params){
  if((params || {}).animationType === 'none') return false;
  if(root && root.animations && root.animations.length) return true;
  let skinned = false;
  if(root) root.traverse(function(o){ if(o.isSkinnedMesh) skinned = true; });
  return skinned;
}

globalThis.wantsAnimator = wantsAnimator;
globalThis.applyModelOverrides = applyModelOverrides;
globalThis.isLegacySkinnedEntry = isLegacySkinnedEntry;
globalThis.captureModelOverrides = captureModelOverrides;
globalThis.exposeModelNodes = exposeModelNodes;
globalThis.exposedNodesOf = exposedNodesOf;
globalThis.isModelNode = isModelNode;
globalThis.markModelNodeEdited = markModelNodeEdited;
globalThis.modelNodeByKey = modelNodeByKey;
globalThis.modelNodesOf = modelNodesOf;
globalThis.modelRootOf = modelRootOf;
