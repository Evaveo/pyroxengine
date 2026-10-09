// moteur/js/hub/template-fps.js
// Attache le comportement RÉEL du template "FPS — déplacement" (js/hub/hub-templates.js) au
// prefab par défaut du même contrôleur (moteur/prefabs-default/fps-controller.prefab.json,
// chargé via js/prefab-library.js) — une seule source de vérité pour le contenu, réutilisable
// aussi bien depuis le Hub que depuis n'importe quel projet déjà ouvert.
//
// Chargé APRÈS prefab-library.js, uniquement par editor.html : PrefabLibrary n'existe jamais
// dans hub.html, qui ne fait qu'afficher les cartes de templates sans en construire le contenu.
import { HubTemplates } from './hub-templates.js';
import { PrefabLibrary } from '../prefab-library.js';
import { select } from '../selection.js';

if(typeof HubTemplates !== 'undefined' && typeof PrefabLibrary !== 'undefined'){
  HubTemplates.attachApply('fps-basic', async function applyFpsTemplate(){
    const player = await PrefabLibrary.instantiate('fps-controller', {x: 0, y: 1, z: 0});
    if(typeof select === 'function') select(player);
  });
}
