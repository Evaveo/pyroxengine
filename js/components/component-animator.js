// moteur/js/components/component-animator.js
// this.donnees référence DIRECTEMENT userData.animator — même patron que UIDocument et
// Collider. La machine à états n'est PAS stockée ici : ce composant référence un asset
// `animator`, partagé entre Noeuds. Dix personnages peuvent jouer la même machine.
//
// POURQUOI le composant ne fait presque rien. La machine tourne dans js/animator.js, partagé
// par l'éditeur et le runtime, et le pilotage image par image vit dans js/anim-models.js et
// son miroir runtime. Ce fichier est la face d'ÉDITION de cet ensemble.

import { ensureAnimator } from '../component-data.js';
import { Registry } from '../component-registry.js';
import { Component, detachData, mergeIntoBag } from '../component.js';

/**
 * Ouvre la machine en JSON raw dans la fenêtre externe.
 *
 * `listeFichiers` et le quatrième rappel donnent au bandeau son SÉLECTEUR : on pass d'une
 * machine à l'autre sans revenir chercher un objet dans la scène, comme pour les scripts et
 * les graphes de shader. Sans eux, la fenêtre se cachait le bandeau toute seule — l'éditeur de
 * machine à états était le seul des trois à ne pas l'avoir, sans que ce soit un choix.
 *
 * `node` sert au seul effet de bord qui dépende de l'objet ÉDITÉ : arrêter le lecteur en
 * cours, dont l'état current peut ne plus exister dans la machine qu'on vient de réécrire. Il
 * est relu à chaque changement de fichier, pas capturé une fois.
 */
export function openEditorMachineJson(a, node){
  const list = assets.filter(function(x){ return x.kind === 'animator'; })
    .map(function(x){ return {id: x.id, name: x.name}; });
  openEditorExternal('animator', {
    id: a.id, name: a.name, json: JSON.stringify(a.machine || {}, null, 2),
    listFiles: list
  }, function(maj){
    try {
      a.machine = JSON.parse(maj.json);
      if(typeof stopAnimator === 'function' && node) stopAnimator(node);
      updateProject();
      if(typeof drawGraph === 'function') drawGraph();
      if(node === selection) buildInspector();
    } catch(e){
      // Rien n'est enregistré tant que le JSON n'est pas valide : sans ce filtre, une machine
      // à moitié tapée écraserait la vraie à chaque frappe.
      setStatus('Machine illisible : ' + e.message + ' — rien n\'a été enregistré', 6000);
    }
  }, function(id){
    const n = assets.find(function(x){ return x.id === id && x.kind === 'animator'; });
    // On repart du nœud SÉLECTIONNÉ, pas de celui d'origine : la machine qu'on vient d'ouvrir
    // n'a aucune raison d'être celle que joue l'ancien objet.
    if(n) openEditorMachineJson(n, selection);
  });
}

export class AnimatorController extends Component {
  constructor(node, opts) {
    super(node);
    this.data = opts || {};
  }

  get asset() {
    return assets.find((a) => a.id === this.data.assetId && a.kind === 'animator') || null;
  }
  get machine() { const a = this.asset; return a ? a.machine : null; }

  /**
   * Le nœud dont les os seront pilotés.
   *
   * MESURÉ : un mixeur créé sur un PARENT pilote bien les os de ses enfants — three résout les
   * noms de pistes n'importe où dans le sous-arbre. Mais la RECHERCHE DES CLIPS, elle, est par
   * objet : `clipsOf(parent)` rend 0 alors que `clipsOf(perso)` rend 3. D'où ce réglage : par
   * défaut on descend jusqu'au premier descendant qui porte des clips, ce qui couvre le cas
   * current « l'Animator est sur le groupe, le modèle est dedans » sans rien demander.
   */
  get target() {
    const nameVoulu = (this.data.target || '').trim();
    if(nameVoulu){
      let trouve = null;
      this.node.traverse((o) => { if(!trouve && o.name === nameVoulu) trouve = o; });
      return trouve;              // nommé et introuvable ⇒ null, jamais un repli silencieux
    }
    if(typeof clipsOf === 'function' && clipsOf(this.node).length) return this.node;
    let holder = null;
    this.node.traverse((o) => {
      if(!holder && o !== this.node && typeof clipsOf === 'function' && clipsOf(o).length) holder = o;
    });
    return holder || this.node;
  }

  onAdd() {
    // `mergeIntoBag` : les données reçues entrent dans le sac même quand il existe déjà. La
    // forme d'avant (`_dataInitialesFournies` + affectation conditionnelle) les perdait alors.
    this.data = mergeIntoBag(ensureAnimator(this.node), this.data);
  }

  onRemove() {
    if (typeof stopAnimator === 'function') stopAnimator(this.node);
    delete this.node.userData.animator;
  }

  // DÉTACHÉES (contrat de component.js, règle 4).
  serialize() { return detachData(this.data); }

  // `hydrate` est le SEUL point de relecture (contrat de component.js, règle 2) : sans lui, un
  // composant déjà posé puis relu depuis le fichier par `applyComponents` ne voyait rien.
  hydrate(d){ if(d) this.data = d; }


  /**
   * Les réglages d'une transition, dans l'ordre d'Unity.
   *
   * Ils n'étaient pas là — il n'y avait que la durée et une case « fin du clip » — et c'est ce
   * qui rendait la machine inutilisable pour un enchaînement d'attaques : « repartir aux trois
   * quarts du coup » n'était pas exprimable, « un fondu qui vaut un quart du clip » non plus.
   */

  /**
   * Les conditions, en LIGNES à listes déroulantes plutôt qu'en zone de texte.
   *
   * La zone de texte demandait de connaître une syntaxe (« vitesse > 0.1 ») et ne disait rien
   * des paramètres existants : une faute de frappe passait, et la transition ne partait jamais.
   * Ici on ne peut nommer qu'un paramètre déclaré, et les opérateurs proposés sont ceux que
   * son TYPE autorise — un booléen ne se compare pas avec « > ».
   */

  static get typeName() { return 'AnimatorController'; }
  static get description(){ return 'Machine à états d’animation'; }
  static get icon(){ return Icons.html('flow-arrow') + ' '; }
  static get category() { return 'Animation'; }
}

Registry.registerClass(AnimatorController);
