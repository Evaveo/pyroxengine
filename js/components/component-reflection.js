// moteur/js/components/component-reflection.js
// this.donnees référence DIRECTEMENT userData.sonde. Le rendu/sync/lecture de
// champs sont décrits par js/ui/panels-components.js (descripteur du composant Reflection) ;
// la donnée et la cuisson restent dans js/probes.js.
import { ensureProbe } from '../component-data.js';
import { Registry } from '../component-registry.js';
import { Component, detachData, mergeIntoBag } from '../component.js';

export class Reflection extends Component {
  constructor(node, opts) {
    super(node);
    this.data = opts || {};
  }

  onAdd() {
    // Les données REÇUES sont la source, et le sac `userData.probe` la copie de travail que
    // lit probes.js. Avant, cette ligne jetait purement les données du composant
    // (`this.data = ensureProbe(...)`) : `addComponent('Reflection', data)` rendait une sonde
    // aux valeurs par défaut, et c'est `rebuildTree` qui rattrapait le coup — il écrivait le
    // sac lui-même, puis repointait le composant dessus après coup. Le composant ne savait
    // donc pas se reconstruire seul.
    // `mergeIntoBag` remplace la recopie qui était écrite à la main ici — et dans deux autres
    // composants, chacun à sa façon. Il garde le même garde-fou : `makeProbe` passe le sac
    // LUI-MÊME en données, et recopier un objet sur lui-même serait une boucle qui écrit ce
    // qu'elle lit.
    this.data = mergeIntoBag(ensureProbe(this.node), this.data);
    // probes.js reconnaît une sonde par userData.type === 'probe' (cuisson,
    // masquage au rendu…) : sur un Noeud « Vide », on pose le tag.
    this.markType('probe');
  }

  // Les données relues deviennent celles du composant. `onAdd` les recopiera dans le sac
  // `userData` que lisent les systèmes ; rejouer `hydrate` puis `onAdd` sur une instance déjà
  // posée est ainsi ce qui relit la sonde depuis le fichier.
  hydrate(d) {
    if (d) this.data = d;
  }

  onRemove() {
    delete this.node.userData.probe;
    if (this.node.userData.type === 'probe') this.node.userData.type = 'group';
    removeBoxProbeViz(this.node);
    disposeProbe(this.node);
    applyProbes();
  }

  // mémorisé sur donnees (userData.sonde), lu directement par sondes.js qui ne
  // passe pas par les instances de composant
  onActiveChange(active) {
    this.data.active = active;
    disposeProbe(this.node);
    applyProbes();
    updateBoxProbeViz();
  }

  // DÉTACHÉES (contrat de component.js, règle 4) : `this.data` EST `userData.probe`.
  serialize() { return detachData(this.data); }

  static get typeName() { return 'Reflection'; }
  static get description(){ return 'Sonde de réflexion'; }
  static get icon(){ return Icons.html('sphere') + ' '; }
  static get category() { return 'Rendu'; }
  // 3D seulement. La separation est stricte : sans cette declaration, un composant
  // 3D se poserait sur un objet 2D — la porte de la phase 1 l'a attrape.
}

Registry.registerClass(Reflection);
