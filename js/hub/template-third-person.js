// moteur/js/hub/template-third-person.js
// Attache le comportement RÉEL du template "Troisième personne" (js/hub/hub-templates.js) au
// prefab par défaut du même contrôleur (moteur/prefabs-default/tps-controller.prefab.json,
// chargé via js/prefab-library.js) — même patron que js/hub/template-fps.js.
//
// Chargé APRÈS prefab-library.js, uniquement par editor.html.
import { HubTemplates } from './hub-templates.js';
import { PrefabLibrary } from '../prefab-library.js';
import { select } from '../selection.js';

if(typeof HubTemplates !== 'undefined' && typeof PrefabLibrary !== 'undefined'){
  HubTemplates.attachApply('third-person', async function applyThirdPersonTemplate(){
    const player = await PrefabLibrary.instantiate('tps-controller', {x: 0, y: 1, z: 0});
    if(typeof select === 'function') select(player);
  });
}
