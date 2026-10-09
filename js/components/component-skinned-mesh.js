// moteur/js/components/component-skinned-mesh.js
//
// Un THREE.SkinnedMesh, à l'intérieur du sous-arbre d'un modèle importé — le trou symétrique de
// celui que component-model.js a refermé pour la racine. `Model` (la racine) ne détient ni
// géométrie ni matériau : le VRAI maillage animé vit plus bas, sur un ou plusieurs
// THREE.SkinnedMesh anonymes, invisibles au Registry et à l'inspecteur avant ce composant.
//
// POURQUOI PAS Mesh (component-mesh.js) : Mesh construit sa géométrie depuis un type primitif
// (`buildGeometry('cube')`…) et la DISPOSE à son retrait — un SkinnedMesh importé n'a ni type
// primitif ni raison d'être détruit par ce composant (le nœud entier disparaît avec le modèle).
// Recoller un Mesh dessus referait planter `hydrate()` sur un `d.geo` qui n'existe pas pour ce
// genre, et `onRemove()` disposerait une géométrie que le modèle réutilise à chaque clone.
//
// CE COMPOSANT NE DÉTIENT RIEN, comme Model : la peau, le squelette et le matériau restent sur
// le THREE.SkinnedMesh lui-même. Il rend le nœud DÉCOUVRABLE — `Registry.activeNodes(
// 'SkinnedMeshRenderer')` — nom calqué sur le composant Unity équivalent (`SkinnedMeshRenderer`),
// sans un mot d'écart : c'est exactement ce que l'utilisateur a demandé.
//
// ATTACHÉ À CHAQUE CLONE, PAS SEULEMENT À L'IMPORT : voir `cloneModel` (js/anim-models.js) et
// son miroir `rtCloneModel` (js/game-runtime.js). Un composant posé une fois sur le TEMPLATE ne
// survivrait pas à `Object3D.clone()` (qui recopie `userData` par JSON, cf. js/node.js —
// `applyNodeMixin` jette les « débris » d'un clone qui ne sont pas de VRAIS composants), donc
// chaque instance le reçoit fraîchement reconstruit, comme la re-liaison du squelette juste
// à côté dans le même fichier.
import { Registry } from '../component-registry.js';
import { Component, detachData } from '../component.js';

export class SkinnedMeshRenderer extends Component {
  constructor(node) {
    super(node);
    // externalClips : provenance des clips empruntés à un AUTRE asset (Mixamo : un fichier par
    // clip). Remplace userData.animExt — même donnée, même politique de « provenance seulement,
    // jamais les clés » (voir attachAnimationExternal, js/anim-models.js), mais portée par ce
    // composant, sérialisée comme n'importe quel autre champ de composant.
    this.data = { externalClips: [] };
  }

  hydrate(d) {
    if (d && Array.isArray(d.externalClips)) this.data.externalClips = d.externalClips;
  }

  /** Les clips empruntés à un autre asset : [{assetId, sourceClip, localName}]. */
  get externalClips() { return this.data.externalClips; }
  set externalClips(v) { this.data.externalClips = Array.isArray(v) ? v : []; }

  onAdd() {
    this.markType('skinnedMesh');
  }

  onActiveChange(active) {
    this.node.visible = active;
  }

  /** Le squelette réel (os + matrices de repos), ou `null` avant tout bind. */
  get skeleton() { return this.node.skeleton || null; }

  /** L'os racine du squelette — celui qui porte le personnage. */
  get rootBone() {
    const s = this.skeleton;
    return (s && s.bones && s.bones[0]) || null;
  }

  get boneCount() {
    const s = this.skeleton;
    return s ? s.bones.length : 0;
  }

  // Référence DIRECTE, jamais une copie — même principe que `Mesh.material` (component-mesh.js) :
  // après un changement de matériau ailleurs dans le moteur, ce champ doit refléter le nouveau,
  // pas rester bloqué sur l'ancien.
  get material() { return this.node.material; }

  // externalClips est la SEULE donnée propre à ce composant : la géométrie/le squelette/le
  // matériau viennent du fichier importé (même politique que Model.serialize() pour le reste).
  // DETACHE : le tableau vit sur le composant, et `rebuildTree` le reprend tel quel.
  serialize() { return { externalClips: detachData(this.data.externalClips || []) }; }

  static get typeName() { return 'SkinnedMeshRenderer'; }
  static get description(){ return 'Maillage skinné (squelette animé) — voir Model'; }
  static get icon(){ return Icons.html('person-simple-walk') + ' '; }
  static get category() { return 'Rendu'; }
  // Toujours posé automatiquement (cloneModel/rtCloneModel), jamais par le popup « + Composant »
  // (internal:true — inspector.js:buildPopupComponents filtre dessus). Mais SA CARTE reste
  // visible (hiddenInInspector:false) : c'est elle qui porte le panneau Squelette/Avatar/Clips
  // externes (voir declareComponentPanel('SkinnedMeshRenderer', …), tâche 1.6). Sans croix de
  // retrait (removable:false) : il reviendrait tout seul au clone suivant, une croix qui ne
  // retire rien durablement serait trompeuse.
  static get internal() { return true; }
  static get hiddenInInspector() { return false; }
  static get removable() { return false; }
}

Registry.registerClass(SkinnedMeshRenderer);
