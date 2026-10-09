// moteur/js/components/component-model.js
//
// La racine d'un modèle importé (glTF/FBX). C'était le trou du modèle de
// composants : un modèle importé est un objet de scène de plein droit — il peut
// porter un corps rigide, un collider, des scripts, une machine à états — mais
// il n'avait AUCUN composant décrivant ce qu'il est. Les systèmes le
// retrouvaient par `userData.type === 'model'`, une chaîne de caractères, seule
// et sans classe. D'où deux tests différents partout dans le moteur
// (`type === 'mesh' || type === 'model'`) au lieu d'une question de composant.
//
// POURQUOI PAS le composant Mesh. Mesh (component-mesh.js) référence
// DIRECTEMENT `node.geometry` et `node.material` : c'est tout son intérêt
// (pas de champs dupliqués). Une racine de modèle n'a ni l'un ni l'autre — son
// rendu vit dans un SOUS-ARBRE de plusieurs THREE.Mesh, avec un matériau par
// maillage. Lui coller un Mesh ferait planter `serialize()` sur
// `this.material.color` et lui ferait disposer une géométrie inexistante à son
// retrait. Deux composants distincts, parce que ce sont deux formes de rendu
// distinctes.
//
// Ce composant ne DÉTIENT rien : l'asset source, le format et les paramètres
// d'import vivent déjà dans `userData.assetId`/`format` (écrits par
// createAssetModel, relus par serialization.js). Il rend le modèle
// DÉCOUVRABLE — `Registry.activeNodes('Model')` — et donne à l'inspecteur un
// bloc où afficher sa provenance.
import { Registry } from '../component-registry.js';
import { Component } from '../component.js';

export class Model extends Component {
  constructor(node, opts) {
    super(node);
    // Retenues jusqu'à onAdd (contrat de Component, règle 1 : le constructeur ne touche
    // à rien d'autre que ses champs).
    this.dataInit = opts || {};
  }

  // Les données relues alimentent le même champ que le constructeur : rejouer `hydrate` puis
  // `onAdd` sur une instance déjà posée relit la provenance de l'asset depuis le fichier.
  hydrate(d) {
    if (d) this.dataInit = d;
  }

  onAdd() {
    // Une racine de modèle est toujours taguée 'model' par createAssetModel ;
    // le tag n'est reposé que si ce composant est ajouté à un Noeud « Vide »
    // (cas + Component, qui n'a pas grand sens ici mais ne doit pas casser).
    this.markType('model');
    // LA PROVENANCE VOYAGE AVEC LE COMPOSANT. Elle ne vivait que dans `userData.assetId` /
    // `userData.format`, écrits par createAssetModel et relus par serialization.js : reposer
    // ce composant seul rendait un modèle qui ne savait plus de quel asset il vient — donc
    // sans template à cloner à la reconstruction suivante, et sans provenance dans
    // l'inspecteur. On n'écrase jamais ce que le nœud sait déjà : un clone frais de
    // `cloneModel` porte la bonne valeur, et les données reçues peuvent être plus anciennes.
    const d = this.dataInit || {};
    if (d.assetId && !this.node.userData.assetId) this.node.userData.assetId = d.assetId;
    if (d.format && !this.node.userData.format) this.node.userData.format = d.format;
    delete this.dataInit;
  }

  // L'asset dont ce Noeud est une instance, ou null (modèle détaché de son
  // asset, asset supprimé du projet).
  get asset() {
    const id = this.node.userData.assetId;
    if (!id || typeof assets === 'undefined') return null;
    return assets.find((a) => a.id === id && a.kind === 'model') || null;
  }

  get format() { return this.node.userData.format || ''; }

  // Les THREE.Mesh réellement dessinés, dans le sous-arbre.
  meshes() {
    const list = [];
    this.node.traverse((x) => { if (x.isMesh) list.push(x); });
    return list;
  }

  onActiveChange(active) {
    this.node.visible = active;
  }

  // La PROVENANCE : de quel asset ce nœud est une instance, et dans quel format il a été
  // importé. Ce composant rendait `{}` — « c'est déjà dans le format de projet » — mais
  // c'est justement ce qui l'empêchait de se reconstruire depuis le format à composants.
  // La transform, elle, reste au nœud : elle n'appartient à aucun composant.
  serialize() {
    return { assetId: this.node.userData.assetId || null, format: this.format };
  }

  static get typeName() { return 'Model'; }
  static get description(){ return 'Modèle importé'; }
  static get icon(){ return Icons.html('puzzle-piece') + ' '; }
  static get category() { return 'Rendu'; }
  // Index pur : la provenance du modèle, le tag et la sous-scène ont déjà leur
  // section dédiée dans l'inspecteur. Voir Component.internal.
  static get internal() { return true; }
}

Registry.registerClass(Model);
