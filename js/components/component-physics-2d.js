// moteur/js/components/component-physics-2d.js
// Les trois composants de la physique 2D. Le SOLVEUR vit dans js/physics-2d.js, partagé et
// pur ; ici on ne fait que déclarer les réglages et rassembler les corps de la scène.
//
// Le monde PHYSIQUE 2D reste séparé de Cannon (la 3D) : un nœud à Rigidbody2D n'est simulé que
// par js/physics-2d.js. Le refus de poser ces composants sur un nœud 3D, lui, a disparu en
// v0.91.0 (un seul monde de scène) — ne pas le réintroduire.

// Les trois composants reprennent le patron d'AnimatorController : les données passées à
// ddComponent DOIVENT devenir le sac de userData quand il n'existe pas encore. Sans ça,
// ssurerX crée un défaut par-dessus et les réglages sont perdus EN SILENCE — la
// désérialisation s'en sortait (elle pose userData avant), mais tout chemin programmatique
// — script, copilot IA, glisser-déposer — repartait de zéro. Mesuré : un collider demandé en
// 0,6 × 0,9 arrivait en 1 × 1.

// Les fonctions du monde — `ensureBody2d`/`ensureCollider2d`/`ensureController2d`,
// `gatherWorld2d`, `stepWorld2d`, `applyController2d` — vivent dans js/world-2d.js,
// PARTAGÉ avec le jeu. Elles étaient ici, et comme aucune page de jeu ne charge les composants,
// la physique 2D ne tournait pas du tout dans un jeu exporté : le runtime appelait `stepWorld2d`
// derrière un `typeof`, qui rendait faux. Une garde de ce genre transforme une absence en
// désactivation, et le défaut ne se voit qu'à l'export.

import { Registry } from '../component-registry.js';
import { Component, detachData, mergeIntoBag } from '../component.js';

export class Rigidbody2D extends Component {
  constructor(node, opts){
    super(node);
    this.data = opts || {};
  }
  onAdd(){
    this.data = mergeIntoBag(ensureBody2d(this.node), this.data);
  }
  onRemove(){ delete this.node.userData.body2d; }
  // DÉTACHÉES (contrat de component.js, règle 4).
  serialize(){ return detachData(this.data); }

  // `hydrate` : le SEUL point de relecture (contrat de component.js, règle 2).
  hydrate(d){ if(d) this.data = d; }

  static get typeName(){ return 'Rigidbody2D'; }
  static get icon(){ return Icons.html('circles-three') + ' '; }
  static get description(){ return 'Corps rigide 2D'; }
  static get category(){ return '2D'; }
}

export class Collider2D extends Component {
  constructor(node, opts){
    super(node);
    this.data = opts || {};
  }
  onAdd(){
    this.data = mergeIntoBag(ensureCollider2d(this.node), this.data);
    if(typeof updateColliderViz === 'function') updateColliderViz();
  }
  onRemove(){
    delete this.node.userData.collider2d;
    if(typeof updateColliderViz === 'function') updateColliderViz();
  }
  // DÉTACHÉES (contrat de component.js, règle 4).
  serialize(){ return detachData(this.data); }

  // `hydrate` : le SEUL point de relecture (contrat de component.js, règle 2).
  hydrate(d){ if(d) this.data = d; }

  static get typeName(){ return 'Collider2D'; }
  static get icon(){ return Icons.html('bounding-box') + ' '; }
  static get description(){ return 'Volume de collision 2D'; }
  static get category(){ return '2D'; }
}

export class CharacterController2D extends Component {
  constructor(node, opts){
    super(node);
    this.data = opts || {};
  }
  onAdd(){
    this.data = mergeIntoBag(ensureController2d(this.node), this.data);
  }
  onRemove(){ delete this.node.userData.controller2d; }
  // DÉTACHÉES (contrat de component.js, règle 4).
  serialize(){ return detachData(this.data); }

  // `hydrate` : le SEUL point de relecture (contrat de component.js, règle 2).
  hydrate(d){ if(d) this.data = d; }

  static get typeName(){ return 'CharacterController2D'; }
  static get icon(){ return Icons.html('person-simple-walk') + ' '; }
  static get description(){ return 'Déplacement d’un personnage 2D'; }
  static get category(){ return '2D'; }
}

Registry.registerClass(Rigidbody2D);
Registry.registerClass(Collider2D);
Registry.registerClass(CharacterController2D);
