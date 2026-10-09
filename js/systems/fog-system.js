// moteur/js/systems/fog-system.js
//
// Le brouillard de guerre, pour les DEUX moteurs (js/components/component-fog-of-war.js). Séparé
// du composant comme les autres systèmes : un fichier de composant ne dépend pas de l'ordonnanceur.
//
// ORDRE 400 : après la physique et les sprites — le brouillard doit voir les positions finales de
// l'image. En ÉDITION rien n'est caché et la surface est masquée : on ne construit pas un niveau
// dans le noir.
import { Registry } from '../component-registry.js';
import { System } from '../systems.js';
import { setFogHidden } from '../components/component-fog-of-war.js';

System.register({
  name: 'FogOfWarSystem',
  requires: ['FogOfWar'],
  order: 400,
  onFrame(fogs, dt, ctx){
    if(!fogs.length) return;
    const visions = Registry.active('Vision');
    if(!ctx || ctx.mode !== 'play'){
      // En édition : rien de caché, pas de surface.
      fogs.forEach(function(f){ if(f.overlay) f.overlay.visible = false; });
      visions.forEach(function(v){ setFogHidden(v.node, false); });
      return;
    }
    fogs.forEach(function(f){
      f._timer = (f._timer || 0) - dt;
      if(f._timer > 0) return;
      f._timer = Math.max(0.02, Number(f.data.updateInterval) || 0.2);
      f.update(visions);
    });
  }
});
