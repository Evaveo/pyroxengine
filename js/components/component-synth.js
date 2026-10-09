// moteur/js/components/component-synth.js
//
// Synthesizer — une banque de notes synthétisées en direct (voir js/synth.js).
//
// Les données vivent sur le composant et partent TELLES QUELLES dans `components[]` de la scène :
// une voix se corrige à la main dans le `.scene.json` (fréquence, onde, enveloppe) sans passer par
// l'éditeur. `hydrate` renormalise, donc une valeur tapée de travers retombe sur un défaut jouable.

import { Registry } from '../component-registry.js';
import { Component, detachData } from '../component.js';
import { normalizeSynth, SYNTH_DEFAULT } from '../synth.js';

export class Synthesizer extends Component {
  constructor(node, opts){
    super(node);
    this.data = normalizeSynth(opts || SYNTH_DEFAULT);
  }

  serialize(){ return detachData(this.data); }
  hydrate(d){ if(d) this.data = normalizeSynth(d); }

  static get typeName(){ return 'Synthesizer'; }
  static get icon(){ return Icons.html('piano-keys') + ' '; }
  static get description(){ return 'Notes synthétisées en direct, réglées par données'; }
  static get category(){ return 'Gameplay'; }
}

Registry.registerClass(Synthesizer);
