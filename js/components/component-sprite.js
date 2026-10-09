// moteur/js/components/component-sprite.js
// Le rendu d'un sprite 2D. `this.donnees` référence DIRECTEMENT userData.sprite2d — même
// patron que UIDocument, Collider et AnimatorController.
//
// La maille elle-même est construite par js/sprite-2d.js, qui est PARTAGÉ : l'éditeur et le
// game publié appellent les mêmes trois fonctions, avec le même three. Ce fichier n'est que la
// face d'édition — le branchement runtime vit dans js/game-runtime.js et appelle les mêmes.

import { Registry } from '../component-registry.js';
import { Component, detachData, mergeIntoBag } from '../component.js';
import { assetById } from '../component-data.js';

export function ensureSprite2d(node){
  if(!node.userData.sprite2d){
    // `triProfondeur` : FAUX par défaut. Vrai est le bon réglage pour un jeu vu de dessus, mais
    // l'imposer réordonnerait tous les sprites des projets existants — à commencer par les décors
    // de fond, qui passeraient devant le personnage dès qu'ils sont plus bas à l'écran.
    node.userData.sprite2d = {spriteId:null, region:'', layer:'Jeu', order:0,
                               teinte:'#ffffff', retourneX:false, retourneY:false,
                               sortDepth:false};
  }
  return node.userData.sprite2d;
}

/** Les calques de tri du projet, avec un repli si le palier de migration n'est pas passé. */
export function layers2dOfProject(){
  // `project` dans l'éditeur, `rtLayers2d()` dans le jeu publié : la même liste, lue là où
  // chaque moteur la range. Sans ce repli, un composant partagé renverrait les calques par
  // défaut dans le jeu, et tout l'ordre de rendu changerait à l'export.
  const l = (typeof project !== 'undefined' && project && project.layers2d)
         || ((typeof rtLayers2d === 'function') ? rtLayers2d() : null);
  return (Array.isArray(l) && l.length) ? l : ['Fond', 'Décor', 'Jeu', 'Premier plan', 'Interface'];
}

/**
 * (Re)construit la maille d'un sprite sur son nœud.
 *
 * Tout est refait d'un bloc plutôt que modifié en place : la taille dépend de la région ET du
 * `ppu`, les UV de la région ET des retournements, le matériau de la texture ET de la teinte.
 * Mettre à jour « juste ce qu'il faut » demanderait de savoir lequel des six a changé, et c'est
 * exactement le calcul qu'on referait.
 */
export function rebuildMeshSprite(node){
  const d = node.userData.sprite2d;
  if(!d) return null;
  // Après un `Object3D.clone()`, `_meshSprite` est un DÉBRIS JSON (three recopie `userData` par
  // JSON) et la vraie maille clonée reste enfant du nœud : la retrouver, sinon elle survivait à
  // côté de la nouvelle — deux sprites superposés, l'ancien à l'ancienne image.
  const ancienne = bindSpriteMesh(node);
  if(ancienne){
    node.remove(ancienne);
    if(ancienne.geometry) ancienne.geometry.dispose();
    if(ancienne.material) ancienne.material.dispose();
    node.userData._meshSprite = null;
  }
  // `assetById` et pas `assets.find` : il lit `assets` dans l'éditeur et `assetsById` dans le jeu
  // publié. C'est ce qui permet au runtime d'exécuter CE fichier au lieu d'en tenir un miroir
  // (`rtBuildMeshSprite`, supprimé en v0.159.2 — il avait déjà divergé deux fois).
  const asset = spriteAssetOf(d);
  if(!asset) return null;
  const region = regionOfSprite(asset, d.region);
  if(!region) return null;

  const tex = assetById(asset.textureId);
  const texture = tex ? (tex.template || tex.texture || null) : null;
  const dims = dimensionsTexture(tex);
  const L = dims.l, H = dims.h;

  const geo = geometrySprite(THREE, region, asset.ppu, asset.pivot);
  if(!geo) return null;
  const uv = uvOfRegion(region, L, H);
  if(uv) applyUvSprite(geo, uv, d.retourneX, d.retourneY);
  // « Proche » se lit sur la TEXTURE, là où l'utilisateur l'a réglé : dupliquer le réglage sur
  // le sprite donnerait deux endroits qui peuvent se contredire.
  const near = !!(tex && tex.paramsImport && tex.paramsImport.filtrage === 'near');
  const mat = materialSprite(THREE, texture, new THREE.Color(d.teinte || '#ffffff').getHex(), near);

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = '__sprite';
  // Hors de la sélection et hors des aides : c'est le NŒUD qu'on sélectionne, pas sa maille.
  mesh.userData.interne = true;
  mesh.renderOrder = orderOfSort(layers2dOfProject(), d.layer, d.order, node.id);
  // Ce que le chemin léger d'animation aura besoin de savoir sans redo deux recherches
  // linéaires dans les assets à chaque image : quelle région est posée, et la taille de la
  // texture dont dépendent les coordonnées.
  mesh.userData._region = region;
  mesh.userData._texSize = {L: L, H: H};
  // Le bottom du sprite dans son repère local, pivot compris. Calculé une fois ici plutôt qu'à
  // chaque image : le tri par profondeur en a besoin soixante fois par seconde, et il n'a
  // aucune raison de redo le calcul du pivot à chaque fois.
  mesh.userData._bottomLocal = bottomLocalSprite(region, asset.ppu, asset.pivot);
  node.add(mesh);
  node.userData._meshSprite = mesh;
  return mesh;
}

/**
 * La maille de sprite d'un nœud, recâblée si besoin.
 *
 * `Object3D.clone()` recopie `userData` par `JSON.parse(JSON.stringify(...))` : `_meshSprite`
 * en ressort en objet nu (le `toJSON` de la maille), sans `userData._region` — d'où le plantage
 * de `updateImageSprite` sur une instance de prefab. La maille clonée, elle, est bien là, parmi
 * les enfants : on la retrouve par son nom et son drapeau `interne`.
 *
 * Sa géométrie et son matériau sont alors DUPLIQUÉS : `clone()` les partage avec le modèle, et
 * `updateImageSprite` réécrit les UV en place — changer l'image d'une instance changeait sinon
 * celle du prefab et de ses sœurs, et la reconstruire libérait leurs ressources.
 */
export function bindSpriteMesh(node){
  const ud = node && node.userData;
  if(!ud) return null;
  const m = ud._meshSprite;
  if(m && m.isObject3D && m.parent === node) return m;
  const child = (node.children || []).find(function(c){
    return c && c.isMesh && c.name === '__sprite' && c.userData && c.userData.interne;
  }) || null;
  if(child){
    if(child.geometry && child.geometry.clone) child.geometry = child.geometry.clone();
    if(child.material && child.material.clone) child.material = child.material.clone();
  }
  ud._meshSprite = child;
  return child;
}

/** L'asset sprite désigné par un sac `sprite2d`, dans l'un ou l'autre moteur. */
export function spriteAssetOf(d){
  const a = d ? assetById(d.spriteId) : null;
  return (a && a.kind === 'sprite') ? a : null;
}

/**
 * Change l'IMAGE d'un sprite, sans reconstruire sa maille quand c'est possible.
 *
 * Toutes les images d'une planche d'animation ont la même cellule : seules les coordonnées de
 * texture changent. Passer par `rebuildMeshSprite` allouerait une géométrie et un
 * matériau douze fois par seconde et par personnage, et rendrait au tampon graphique des
 * ressources aussitôt resumes. On ne reconstruit que si la taille de région change vraiment —
 * la question se décide dans le module partagé pour que le jeu publié y réponde pareil.
 */
export function updateImageSprite(node, nameRegion){
  const d = node.userData.sprite2d;
  if(!d) return false;
  const mesh = bindSpriteMesh(node);
  const asset = spriteAssetOf(d);
  if(!asset) return false;
  const region = regionOfSprite(asset, nameRegion);
  if(!region) return false;
  d.region = region.name;
  if(!mesh || !sameGeometrySprite(mesh.userData._region, region)){
    return !!rebuildMeshSprite(node);
  }
  const t = mesh.userData._texSize || {L: 0, H: 0};
  const uv = uvOfRegion(region, t.L, t.H);
  if(uv) applyUvSprite(mesh.geometry, uv, d.retourneX, d.retourneY);
  mesh.userData._region = region;
  return true;
}

export class SpriteRenderer extends Component {
  constructor(node, opts) {
    super(node);
    this.data = opts || {};
  }

  onAdd() {
    this.data = mergeIntoBag(ensureSprite2d(this.node), this.data);
    rebuildMeshSprite(this.node);
  }

  onRemove() {
    const m = this.node.userData._meshSprite;
    if (m) {
      this.node.remove(m);
      if (m.geometry) m.geometry.dispose();
      if (m.material) m.material.dispose();
      this.node.userData._meshSprite = null;
    }
    delete this.node.userData.sprite2d;
  }

  /**
   * Pose l'ordre de rendu de la maille depuis le calque et le rang.
   *
   * Le calcul était recopié à chaque endroit qui touchait un calque — création, changement
   * d'ordre, chargement — et un seul oubli fait passer le personnage DERRIÈRE le décor sans que
   * rien ne le signale. Il vit ici, et le SpriteSystem l'appelle quand `_dirtyOrder` est posé.
   */
  applyRenderOrder(){
    const m = this.node.userData._meshSprite;
    if(!m) return false;
    m.renderOrder = orderOfSort(layers2dOfProject(), this.data.layer,
                                this.data.order || 0, this.node.id);
    return true;
  }

  // DÉTACHÉES (contrat de component.js, règle 4).
  serialize() { return detachData(this.data); }

  // `hydrate` est le SEUL point de relecture (contrat de component.js, règle 2) : sans lui, un
  // composant déjà posé puis relu depuis le fichier par `applyComponents` ne voyait rien.
  hydrate(d){ if(d) this.data = d; }


  static get typeName() { return 'SpriteRenderer'; }
  static get description(){ return 'Image 2D affichée'; }
  static get icon(){ return Icons.html('image') + ' '; }
  static get category() { return '2D'; }
}

Registry.registerClass(SpriteRenderer);
