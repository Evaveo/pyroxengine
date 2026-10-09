// moteur/js/components/component-subscene.js
//
// Une instance d'une autre scène du projet (le Prefab de scène / le « nested prefab »
// d'Unity). Troisième et dernière entité du moteur qui n'avait aucun composant : elle se
// sérialisait, se reconstruisait, portait des overrides — mais restait introuvable autrement
// qu'en comparant `userData.type` à la chaîne `'subScene'`, ce que faisaient l'historique
// (capture des overrides avant chaque undo), la reconstruction et la traversée.
//
// Il ne DÉTIENT rien de plus que son sac : la scène visée et les overrides vivent dans
// `userData.subScene`, que ce composant reconstruit lui-même depuis ses données (le format ne
// les écrit plus à plat en double — voir docs/REVUE_2026-09-10.md § 3.1). Il rend
// l'instance découvrable — `Registry.activeNodes('SubScene')` — et donne un nom à ce qu'elle
// est.
//
// ⚠️ Son contenu n'est PAS sa descendance sérialisée : il est régénéré depuis la scène source
// à chaque reconstruction (populateSubScene), puis les overrides sont réappliqués. C'est
// pourquoi ce composant n'expose pas d'accès aux enfants : ils sont volatils par construction.
import { Registry } from '../component-registry.js';
import { Component } from '../component.js';

export class SubScene extends Component {
  constructor(node, opts) {
    super(node);
    // Retenues jusqu'à onAdd : le constructeur ne touche à rien d'autre que ses champs
    // (contrat de Component, règle 1).
    this.dataInit = opts || {};
  }

  // Les données relues alimentent le même champ que le constructeur : rejouer `hydrate` puis
  // `onAdd` sur une instance déjà posée relit la scène visée et ses overrides depuis le fichier.
  hydrate(d) {
    if (d) this.dataInit = d;
  }

  onAdd() {
    this.markType('subScene');
    const d = this.dataInit;
    const sac = this.node.userData.subScene
      || (this.node.userData.subScene = { scene: '', overrides: {} });
    // RECONSTRUCTIF : les données du composant se suffisent. Avant, ce composant ne
    // retenait rien — la scène visée et les overrides n'existaient que dans le sac
    // `userData.subScene`, que `rebuildTree` devait écrire lui-même avant de poser le
    // composant. Reposer le composant seul rendait une instance qui ne désignait aucune
    // scène, donc un nœud vide à la place du décor.
    if (d.scene) sac.scene = d.scene;
    if (d.overrides) sac.overrides = d.overrides;
    if (!sac.overrides) sac.overrides = {};
    delete this.dataInit;
  }

  get data() {
    return this.node.userData.subScene || (this.node.userData.subScene = { scene: '', overrides: {} });
  }

  // Le nom de la scène instanciée, ou '' si l'instance n'en désigne aucune (créée puis pas
  // encore réglée).
  get nameScene() { return this.data.scene || ''; }

  // La scène visée ET ses overrides. Ce composant rendait `{}` — « userData.subScene est déjà
  // écrit par serializeObject » — mais c'est justement ce qui l'empêchait de se reconstruire
  // depuis le format à composants : les données doivent voyager AVEC le composant.
  serialize() {
    const d = this.data;
    return { scene: d.scene || '', overrides: JSON.parse(JSON.stringify(d.overrides || {})) };
  }

  static get typeName() { return 'SubScene'; }
  static get description(){ return 'Scène imbriquée'; }
  static get icon(){ return Icons.html('stack') + ' '; }
  static get category() { return 'Monde'; }
  // Index pur : la provenance du modèle, le tag et la sous-scène ont déjà leur
  // section dédiée dans l'inspecteur. Voir Component.internal.
  static get internal() { return true; }
}

Registry.registerClass(SubScene);
