// ---------- Gestion des calques de projet ----------
import { updateHierarchy } from './hierarchy.js';
import { objects } from './objects.js';
import { project } from './project.js';
import { resolveLayer } from './scripts.js';
import { openPanelDock } from './ui.js';

/**
 * Les calques du projet.
 *
 * C'était une modale à son propre HTML et à sa propre délégation d'événements. Les calques sont
 * maintenant une liste du panneau « Paramètres du projet » (js/ui/panels-settings.js) : une
 * seule interface, dockable, à côté de la vue. L'entrée de menu `🗂 Layers…` mène ici, et ici
 * ouvre le panneau — la garder en double aurait laissé deux écrans capables d'écrire les mêmes
 * calques, dont un seul se rafraîchit.
 */
export function modalLayers(){
  if(typeof openPanelDock === 'function') openPanelDock('project-settings');
}

// applique visible/verrouillage des calques aux objets de la scène courante
export function applyVisibilityLayers(){
  objects.forEach(function(o){
    if(!o.userData.game) return;
    const l = project.layers.find(function(x){ return x.id === resolveLayer(o.userData.game.layer); });
    if(l) o.visible = l.visible;
  });
  updateHierarchy();
}
