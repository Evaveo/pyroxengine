// moteur/js/components/component-events.js
//
// Les règles visuelles « Quand… Alors… » (events.js). Deuxième trou du
// modèle de composants, du même genre que modele : le comportement existait, se
// sérialisait, se jouait en mode Lecture — mais n'était PAS un composant. Il ne
// se montrait ni dans le bloc Composants de l'inspecteur, ni dans « + Component »,
// et les deux fonctions qui en ont besoin (initEventsVisuals au lancement,
// majEvenementsVisuels à chaque image) devaient balayer TOUTE la scène pour
// retrouver les trois objets qui en portent.
//
// Il MIROITE `userData.evenements`, comme Collider miroite `userData.collider` :
// c'est cet ongletleau que serializeObject écrit, que le runtime du jeu publié relit,
// et que l'éditeur de règles modifie. Ce composant ne le double pas — il le
// référence (`this.regles === node.userData.evenements`, même tableau).
//
// `ensureEvents()` vit dans js/events.js — le module qui POSSÈDE ces
// données — et pas ici : le redéclarer donnerait deux fonctions du même nom au
// premier niveau, dont la seconde ferait cesser l'évaluation de son fichier
// entier (voir test/symboles-globaux.test.mjs). js/events.js est chargé
// APRÈS ce fichier, mais `function` est hissée sur le global : l'appel, qui n'a
// lieu qu'à l'exécution, la trouve.
import { ensureEvents } from '../component-data.js';
import { Registry } from '../component-registry.js';
import { Component } from '../component.js';

export class Events extends Component {
  constructor(node, opts) {
    super(node);
    // opts est le tableau de règles relu (serialize() en rend une copie), ou
    // rien du tout quand le composant est ajouté à la main via + Component.
    this._reglesInitiales = Array.isArray(opts) ? opts
      : (opts && Array.isArray(opts.regles) ? opts.regles : null);
  }

  get regles() { return ensureEvents(this.node); }

  // `hydrate` : le SEUL point de relecture (contrat de component.js, règle 2). Il rejoue
  // exactement la lecture du constructeur — le fichier écrit `{regles: [...]}`, mais un
  // `addComponent('Events', [...])` passe le tableau nu, et les deux formes doivent marcher.
  hydrate(d){
    if(!d) return;
    this._reglesInitiales = Array.isArray(d) ? d
      : (Array.isArray(d.regles) ? d.regles : this._reglesInitiales);
  }

  onAdd() {
    const list = ensureEvents(this.node);
    if (this._reglesInitiales && !list.length) list.push(...this._reglesInitiales);
    this._reglesInitiales = null;
  }

  onRemove() {
    delete this.node.userData.events;
  }

  // Copie DÉTACHÉE (règle 4 du contrat, component.js) : rendre le tableau vivant
  // laisserait un appelant muter les règles du jeu en croyant lire un instantané.
  // Les règles elles-mêmes sont des objets plats — un JSON aller-retour suffit et
  // reste la façon la plus sûre de ne rien partager par mégarde.
  serialize() {
    return { regles: JSON.parse(JSON.stringify(this.regles)) };
  }

  static get typeName() { return 'Events'; }
  static get icon(){ return Icons.html('lightning') + ' '; }
  static get description(){ return 'Réactions aux événements'; }
  static get category() { return 'Gameplay'; }
}

Registry.registerClass(Events);
