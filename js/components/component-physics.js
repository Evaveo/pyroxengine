// moteur/js/components/component-physics.js
// this.donnees référence DIRECTEMENT userData.phys : source unique, lue par
// startSimulation()/construireCorpsPour() (physics.js) et par ce composant.
import { ensurePhys } from '../component-data.js';
import { Registry } from '../component-registry.js';
import { Component, detachData, mergeIntoBag } from '../component.js';

export class Physics extends Component {
  constructor(node, opts) {
    super(node);
    this.data = opts || {};
  }

  onAdd() {
    // `mergeIntoBag` et plus `this.data = ensurePhys(...)` : cette ligne JETAIT les données
    // reçues quand le sac n'existait pas encore. `addComponent('Physics', {masse: 5})` rendait
    // un corps aux valeurs par défaut, en silence. Ça ne se voyait pas parce que le format de
    // projet écrit AUSSI `phys` à plat et que la reconstruction le pose AVANT les composants :
    // la seule source qui marchait était cette redondance. Voir docs/REVUE_2026-09-10.md § 3.3.
    this.data = mergeIntoBag(ensurePhys(this.node), this.data);
    // la case du header générique remplace l'ancienne case « Corps rigide »
    // propre à ce composant : this.donnees.active (userData.phys.active, déjà lu
    // par startSimulation()/physics.js) reste la source de vérité
    this.active = this.data.active !== false;
  }

  onRemove() {
    delete this.node.userData.phys;
  }

  onActiveChange(active) {
    this.data.active = active;
  }

  // `hydrate` est le SEUL point de relecture (contrat de component.js, règle 2). Le constructeur
  // le faisait seul, si bien qu'un composant DÉJÀ posé — par une fabrique, puis relu depuis le
  // fichier par `applyComponents` — ne voyait jamais ses données : `hydrate` était un no-op
  // hérité de la classe de base. Voir docs/REVUE_2026-09-10.md § 3.3.
  hydrate(d){ if(d) this.data = d; }


  // DÉTACHÉES : `this.data` EST `userData.phys`, et le contrat (règle 4) interdit de rendre un
  // sac vivant — un appelant qui mute le résultat muterait l'état du jeu.
  serialize() { return detachData(this.data); }

  static get typeName() { return 'Physics'; }
  static get icon(){ return Icons.html('circles-three') + ' '; }
  static get description(){ return 'Corps rigide simulé'; }
  static get category() { return 'Physics'; }
  // 3D seulement. La separation est stricte : sans cette declaration, un composant
  // 3D se poserait sur un objet 2D — la porte de la phase 1 l'a attrape.
}

Registry.registerClass(Physics);

// Un seul monde cannon.js (phys.monde, physics.js) est partagé par tous les
// corps rigides — ce n'est pas une simulation par instance qu'on pourrait
// advance composant par composant. SystemPhysics est le point d'entrée que
// viewport.js appelle chaque image ; il délègue le pas de simulation et la
// resynchronisation des poses aux fonctions existantes de physics.js.
export const SystemPhysics = {
  update(dt, inPause) {
    if (typeof phys === 'undefined' || !phys.active || !phys.world || inPause) return;
    syncKinematic();
    phys.world.step(1 / 60, Math.min(dt, 0.05), 3);
    syncPhysics();
  }
};
