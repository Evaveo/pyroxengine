// moteur/js/components/component-collider.js
// this.donnees référence DIRECTEMENT userData.collider (même objet, pas une copie) :
// source unique, lue par construireCorpsPour (physics.js) et par ce composant.
import { ensureCollider } from '../component-data.js';
import { Registry } from '../component-registry.js';
import { Component, detachData, mergeIntoBag } from '../component.js';

export class Collider extends Component {
  constructor(node, opts) {
    super(node);
    this.data = opts || {};
  }

  onAdd() {
    // ensureCollider crée les valeurs par défaut si absentes, ou renvoie la
    // référence existante — donnees pointe alors vers le MÊME objet que
    // userData.collider, pas une copie.
    // `mergeIntoBag` : sans lui, les données passées à `addComponent('Collider', d)` étaient
    // jetées dès que le sac n'existait pas encore (voir docs/REVUE_2026-09-10.md § 3.3).
    this.data = mergeIntoBag(ensureCollider(this.node), this.data);
  }

  onRemove() {
    delete this.node.userData.collider;
    removeColliderViz(this.node);
  }

  // mémorisé sur userData.collider (donnees) et pas seulement sur l'instance : lu
  // tel quel par construireCorpsPour (physics.js), qui ne connaît pas les
  // composants et travaille directement sur les données brutes de l'objet
  onActiveChange(active) {
    this.data.active = active;
    updateColliderViz();
  }

  // DÉTACHÉES (contrat de component.js, règle 4) : `this.data` EST `userData.collider`.
  serialize() { return detachData(this.data); }

  // `hydrate` est le SEUL point de relecture (contrat de component.js, règle 2). Le constructeur
  // le faisait seul, si bien qu'un composant DÉJÀ posé — par une fabrique, puis relu depuis le
  // fichier par `applyComponents` — ne voyait jamais ses données : `hydrate` était un no-op
  // hérité de la classe de base. Voir docs/REVUE_2026-09-10.md § 3.3.
  hydrate(d){ if(d) this.data = d; }


  static get typeName() { return 'Collider'; }
  static get icon(){ return Icons.html('bounding-box') + ' '; }
  static get description(){ return 'Volume de collision'; }
  static get category() { return 'Physics'; }
  // 3D seulement. La separation est stricte : sans cette declaration, un composant
  // 3D se poserait sur un objet 2D — la porte de la phase 1 l'a attrape.
}

Registry.registerClass(Collider);
