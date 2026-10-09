// moteur/js/components/component-anim-sprite.js
// L'animateur de sprite : il joue une SUITE d'images sur le SpriteRenderer du même nœud.
//
// Le calcul vit dans js/anim-sprite.js, partagé et pur. Ce fichier est exécuté TEL QUEL par les
// deux moteurs, via le SpriteAnimatorSystem (js/systems/sprite-system.js) : le miroir
// `rtUpdateAnimatorsSprite` a disparu en v0.159.2. Seul le bus d'événements diffère — le jeu le
// passe dans le contexte d'image, l'éditeur n'en passe pas.
//
// Les SUITES vivent sur l'asset sprite, pas ici : ce sont des régions de CETTE planche, et deux
// personnages qui partagent la planche doivent partager la découpe. Ici ne vit que l'état de
// lecture.

import { Registry } from '../component-registry.js';
import { Component, detachData, mergeIntoBag } from '../component.js';
import { spriteAssetOf, updateImageSprite } from './component-sprite.js';

export function ensureAnimSprite(node){
  if(!node.userData.animSprite){
    node.userData.animSprite = {defaultValue: '', speed: 1, auto: true};
  }
  return node.userData.animSprite;
}

/** L'asset sprite désigné par le SpriteRenderer du nœud, ou null. */
export function assetSpriteOfNode(node){
  return spriteAssetOf(node.userData && node.userData.sprite2d);
}

/**
 * Un pas d'animation, pour les DEUX moteurs. L'ORCHESTRATION vit dans js/anim-sprite.js.
 *
 * `emit` : le bus d'événements du jeu. L'éditeur n'en passe pas — un marker qui déclencherait un
 * tir pendant qu'on place les objets serait une nuisance.
 *
 * La garde `typeof` est ce qui rend js/anim-sprite.js facultatif dans un build allégé (un jeu
 * sans animateur de sprite) : ce pas tourne à chaque image, sans condition.
 */
export function updateAnimatorsSprite(list, dt, emit){
  if(typeof stepAnimSprites !== 'function') return 0;
  return stepAnimSprites(list, dt, assetSpriteOfNode, updateImageSprite, emit || null);
}

export class SpriteAnimator extends Component {
  constructor(node, opts){
    super(node);
    this.data = opts || {};
  }
  onAdd(){
    this.data = mergeIntoBag(ensureAnimSprite(this.node), this.data);
  }
  onRemove(){
    delete this.node.userData.animSprite;
    delete this.node.userData._animSprite;
  }
  // DÉTACHÉES (contrat de component.js, règle 4).
  serialize(){ return detachData(this.data); }

  // `hydrate` est le SEUL point de relecture (contrat de component.js, règle 2) : sans lui, un
  // composant déjà posé puis relu depuis le fichier par `applyComponents` ne voyait rien.
  hydrate(d){ if(d) this.data = d; }


  static get typeName(){ return 'SpriteAnimator'; }
  static get icon(){ return Icons.html('film-strip') + ' '; }
  static get description(){ return 'Animation d’images 2D'; }
  static get category(){ return '2D'; }
}

Registry.registerClass(SpriteAnimator);
