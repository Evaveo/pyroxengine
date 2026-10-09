// moteur/js/components/component-touch-controls.js
//
// TouchControls — joystick virtuel, glisser et boutons tactiles (voir js/touch-input.js).
//
// Le composant ne fait que PORTER la configuration : la surcouche est posée par le moteur en
// mode jeu (viewport de l'éditeur, runtime publié). Les données partent telles quelles dans
// `components[]` de la scène et s'éditent à la main.

import { Registry } from '../component-registry.js';
import { Component, detachData } from '../component.js';
import { normalizeTouchControls, TOUCH_CONTROLS_DEFAULT } from '../touch-input.js';

export class TouchControls extends Component {
  constructor(node, opts){
    super(node);
    this.data = normalizeTouchControls(opts || TOUCH_CONTROLS_DEFAULT);
  }

  serialize(){ return detachData(this.data); }
  hydrate(d){ if(d) this.data = normalizeTouchControls(d); }

  static get typeName(){ return 'TouchControls'; }
  static get icon(){ return Icons.html('joystick') + ' '; }
  static get description(){ return 'Joystick virtuel et boutons pour écran tactile'; }
  static get category(){ return 'Gameplay'; }
}

Registry.registerClass(TouchControls);
