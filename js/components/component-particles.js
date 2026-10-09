// moteur/js/components/component-particles.js
// this.donnees référence DIRECTEMENT userData.part : source unique, lue et
// avancée par particles.js et par ce composant.
import { ensurePart } from '../component-data.js';
import { Registry } from '../component-registry.js';
import { Component, detachData, mergeIntoBag } from '../component.js';

export class Particles extends Component {
  constructor(node, opts) {
    super(node);
    this.data = opts || {};
  }

  onAdd() {
    // Les données REÇUES sont la source ; `userData.part` est la copie de travail que lit et
    // avance particles.js. Cette ligne les jetait (`this.data = ensurePart(...)`) :
    // `addComponent('Particles', data)` rendait un émetteur aux valeurs par défaut, et
    // `rebuildTree` devait écrire le sac lui-même puis repointer le composant dessus.
    // `ensurePart` AVANT la fusion : il ne garnit les défauts que si le sac est absent, donc
    // créer un sac vide d'abord le laisserait vide pour toujours. `mergeIntoBag` remplace la
    // recopie qui était écrite à la main ici, et dans deux autres composants — même patron.
    this.data = mergeIntoBag(ensurePart(this.node), this.data);
    // le composant Particles réutilise directement donnees.active (déjà lu par
    // particles.js) comme source de vérité : la case du header générique
    // remplace l'ancienne case « Émission » propre à ce composant
    this.active = this.data.active !== false;
    // systemOf()/updateParticles()/emitBurst() (particles.js) reconnaissent
    // un émetteur par userData.type === 'particles' : sur un Noeud « Vide »,
    // on pose le tag pour que le système d'émission le prenne en compte.
    this.markType('particles');
  }

  // Les données relues deviennent celles du composant. `onAdd` les recopiera dans le sac
  // `userData` que lisent les systèmes ; rejouer `hydrate` puis `onAdd` sur une instance déjà
  // posée est ainsi ce qui relit l'émetteur depuis le fichier.
  hydrate(d) {
    if (d) this.data = d;
  }

  onRemove() {
    delete this.node.userData.part;
    if (this.node.userData.type === 'particles') this.node.userData.type = 'group';
    if (typeof resetSystemParticles === 'function') resetSystemParticles(this.node);
  }

  onActiveChange(active) {
    this.data.active = active;
  }

  // DÉTACHÉES (contrat de component.js, règle 4) : `this.data` EST `userData.part`.
  serialize() { return detachData(this.data); }

  static get typeName() { return 'Particles'; }
  static get description(){ return 'Émetteur visuel'; }
  static get icon(){ return Icons.html('sparkle') + ' '; }
  static get category() { return 'Monde'; }
  // 3D seulement. La separation est stricte : sans cette declaration, un composant
  // 3D se poserait sur un objet 2D — la porte de la phase 1 l'a attrape.
}

Registry.registerClass(Particles);

// Le pas de simulation lui-même (émission, avancement, disparition) reste dans
// updateParticles() (particles.js) : c'est un système GPU/THREE.Points partagé
// entre tous les émetteurs, pas une boucle par instance. SystemParticles est
// le point d'entrée que le reste du moteur (viewport.js) appelle chaque image ;
// il délègue à updateParticles plutôt que de dupliquer sa logique.
export const SystemParticles = {
  update(dt) {
    if (typeof updateParticles === 'function') updateParticles(dt);
  }
};
