// moteur/js/components/component-xr.js
//
// LES TROIS COMPOSANTS WEBXR — calqués sur l'XR Interaction Toolkit d'Unity :
//
//   · XROrigin        — l'« XR Origin » : le nœud qui représente le SOL du joueur. La caméra
//                        principale doit en être un descendant ; le casque la pilote relativement
//                        à lui. Déplacer ce nœud (téléportation, stick), c'est déplacer le joueur.
//   · XRGrabbable     — l'« XR Grab Interactable » : l'objet se saisit à la gâchette latérale.
//   · XRTeleportArea  — la « Teleportation Area » : une surface sur laquelle on peut se téléporter.
//
// Ces classes ne font RIEN par elles-mêmes (contrat de component.js : aucun effet de bord hors
// `onAdd`) : elles portent les réglages. Tout le comportement vit dans js/xr-runtime.js, qui les
// découvre par le Registry — le même partage donnée/système que Camera/CameraSystem.
import { ensureXrGrabbable, ensureXrOrigin, ensureXrTeleportArea } from '../component-data.js';
import { Registry } from '../component-registry.js';
import { Component, detachData, mergeIntoBag } from '../component.js';

// Les trois partagent le même patron « sac userData » ; seul le nom du sac change.
function hydrateInto(target, d, keys){
  if(!d) return;
  keys.forEach(function(k){ if(d[k] !== undefined) target.data[k] = d[k]; });
}

export class XROrigin extends Component {
  constructor(node, opts){
    super(node);
    this.data = opts || {};
  }
  onAdd(){ this.data = mergeIntoBag(ensureXrOrigin(this.node), this.data); }
  onRemove(){ delete this.node.userData.xrOrigin; }
  hydrate(d){
    hydrateInto(this, d, ['sessionMode', 'referenceSpace', 'showControllers', 'teleport',
                          'snapTurn', 'moveSpeed', 'handTracking']);
  }
  serialize(){ return detachData(this.data); }

  static get typeName(){ return 'XROrigin'; }
  static get icon(){ return (typeof Icons !== 'undefined' ? Icons.html('virtual-reality') : '') + ' '; }
  static get description(){ return 'Origine WebXR : le sol du joueur en réalité virtuelle'; }
  static get category(){ return 'XR'; }
}

export class XRGrabbable extends Component {
  constructor(node, opts){
    super(node);
    this.data = opts || {};
  }
  onAdd(){ this.data = mergeIntoBag(ensureXrGrabbable(this.node), this.data); }
  onRemove(){ delete this.node.userData.xrGrabbable; }
  hydrate(d){ hydrateInto(this, d, ['radius', 'throwable', 'keepOffset']); }
  serialize(){ return detachData(this.data); }

  static get typeName(){ return 'XRGrabbable'; }
  static get icon(){ return (typeof Icons !== 'undefined' ? Icons.html('hand-grabbing') : '') + ' '; }
  static get description(){ return 'Objet saisissable à la main en réalité virtuelle'; }
  static get category(){ return 'XR'; }
}

export class XRTeleportArea extends Component {
  constructor(node, opts){
    super(node);
    this.data = opts || {};
  }
  onAdd(){ this.data = mergeIntoBag(ensureXrTeleportArea(this.node), this.data); }
  onRemove(){ delete this.node.userData.xrTeleportArea; }
  hydrate(d){ hydrateInto(this, d, ['maxSlope']); }
  serialize(){ return detachData(this.data); }

  static get typeName(){ return 'XRTeleportArea'; }
  static get icon(){ return (typeof Icons !== 'undefined' ? Icons.html('footprints') : '') + ' '; }
  static get description(){ return 'Surface de téléportation en réalité virtuelle'; }
  static get category(){ return 'XR'; }
}

Registry.registerClass(XROrigin);
Registry.registerClass(XRGrabbable);
Registry.registerClass(XRTeleportArea);
