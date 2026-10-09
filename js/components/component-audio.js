// moteur/js/components/component-audio.js
//
// La source audio, enfin un COMPOSANT.
//
// Le système audio lui-même était complet et juste : assets avec leurs octets dans le `.p3d` et dans
// le build, décodage au chargement du jeu, listener attaché à la caméra de jeu, volume, loop,
// spatialisation, pitch, et une API de script. Tout marchait.
//
// Mais il n'était atteignable QUE par un geste : « posée par glisser-déposer d'un asset 🔊 », disait
// l'inspecteur. Conséquences, toutes les trois du même défaut :
//   · pas de `+Component → Source audio`, donc rien à cliquer si on ne pense pas au glisser-déposer ;
//   · rien de programmable — ni script, ni commande, ni copilot, qui ne peut pas glisser-déposer ;
//   · une section d'inspecteur en dur qui ne s'affichait QUE si la donnée existait déjà, ce qui rend
//     la fonctionnalité invisible tant qu'on ne l'a pas trouvée.
//
// C'était le dernier sous-système à ne pas avoir migré vers les composants. Le passage est fait ici
// SANS toucher au moteur audio : `ensureAudio`, `attachAudioAsset`, `testAudioSelection` et
// `AUDIO_DEFAULT` restent dans js/audio.js et gardent leur comportement. Ce fichier n'est qu'une face.
//
// La migration des projets existants passe par `syncComponents` (js/component-migration.js) :
// tout objet qui porte déjà `userData.audio` reçoit le composant au chargement. Sans ça, un projet
// old aurait gardé son son — la physique le lit dans `userData` — mais l'inspecteur ne l'aurait plus
// montré. C'est exactement le défaut qu'on a mesuré sur les quatre composants 2D en v0.59.0.

import { Registry } from '../component-registry.js';
import { Component, detachData, mergeIntoBag } from '../component.js';

export class SourceAudio extends Component {
  constructor(node, opts){
    super(node);
    this.data = opts || {};
  }

  onAdd(){
    // Même patron que les composants 2D : les données passées à `addComponent` DOIVENT devenir le sac
    // de userData quand il n'existe pas encore, sinon `ensureAudio` pose un défaut par-dessus et les
    // réglages sont perdus en silence.
    // `mergeIntoBag` remplace le couple `_fournies` + affectation conditionnelle : les données
    // reçues sont FUSIONNÉES dans le sac, qu'il existe déjà ou non. L'ancienne forme perdait un
    // réglage passé à `addComponent` dès que le sac préexistait.
    this.data = mergeIntoBag(ensureAudio(this.node), this.data);
  }

  onRemove(){
    // Le son en cours doit s'arrêter : sans ça il continue de jouer sur un objet qui n'a plus de
    // source, et rien dans l'interface ne dit d'où il vient.
    const s = (typeof sourceAudioOf === 'function') ? sourceAudioOf(this.node) : null;
    if(s && s.stop){ try{ s.stop(); } catch(e){} }
    delete this.node.userData.audio;
  }

  // DÉTACHÉES : `this.data` EST `userData.audio` (contrat de component.js, règle 4).
  serialize(){ return detachData(this.data); }

  // `hydrate` est le SEUL point de relecture (contrat de component.js, règle 2) : sans lui, un
  // composant déjà posé puis relu depuis le fichier par `applyComponents` ne voyait rien.
  hydrate(d){ if(d) this.data = d; }


  static get typeName(){ return 'AudioSource'; }
  static get icon(){ return Icons.html('speaker-high') + ' '; }
  static get description(){ return 'Source sonore 3D'; }
  static get category(){ return 'Gameplay'; }
  // `'all'` : un son n'a pas de dimension. Le refuser en 2D priverait un platformer de bruitages,
  // et le refuser en 3D n'aurait aucun sens — c'est le seul composant pour lequel la question ne se
  // pose pas.
}

Registry.registerClass(SourceAudio);
