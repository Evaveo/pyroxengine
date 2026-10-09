// moteur/js/hub/template-platformer-2d.js
// Attache le template "Plateforme 2D" au préréglage existant : newProject2d()
// (js/serialization.js) construit déjà exactement ce contenu — tilemap de départ, caméra 2D
// orthographique cadrée sur la largeur du niveau — pour le menu Fichier → Nouveau → « 🎮 Projet 2D… ».
// Ce fichier ne duplique rien, il ne fait que le rendre accessible depuis le Hub.
import { HubTemplates } from './hub-templates.js';
import { newProject2d } from '../serialization.js';

if(typeof HubTemplates !== 'undefined'){
  HubTemplates.attachApply('platformer-2d', function applyPlatformer2dTemplate(){
    newProject2d();
  });
}
