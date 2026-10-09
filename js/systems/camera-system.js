// moteur/js/systems/camera-system.js
//
// Le cadrage et le suivi, une fois par image, pour l'éditeur ET le jeu. En dernier (order 400) :
// il doit voir les positions FINALES, sinon la caméra suit la position de l'image précédente et
// le décor tremble d'une image de retard.
import { sceneObjects } from '../component-data.js';
import { System } from '../systems.js';

System.register({
  name: 'CameraSystem',
  requires: ['Camera'],
  order: 400,
  onFrame(cameras, dt, ctx){
    const w = ctx.width || 1920, h = ctx.height || 1080;
    cameras.forEach(function(cam){
      if(!cam.objectThree) return;
      // TOUTE caméra orthographique est recadrée, pas seulement les pixel-perfect : `aspect`
      // n'a aucun sens sur une OrthographicCamera, l'affectation passe sans erreur et le frustum
      // reste celui de la construction. Le cadrage était donc juste jusqu'au premier
      // redimensionnement, puis faux sans que rien ne le signale.
      if(cam.projection === 'orthographic'){
        // Même décision que les resize (frameOrthoCamera) : sinon l'un défait l'autre à chaque image.
        frameOrthoCamera(cam.objectThree, cam, w, h);
      } else if(cam.objectThree.isPerspectiveCamera){
        cam.objectThree.aspect = w / Math.max(1, h);
        cam.objectThree.updateProjectionMatrix();
      }
      const follow = cam.node.getComponent && cam.node.getComponent('CameraFollow');
      if(!follow || !follow.targetName || !cam._framing) return;
      // La cible par son NOM et non par une référence : un nom mal tapé donne une caméra qui ne
      // suit rien, et l'inspecteur propose donc une LISTE plutôt qu'un champ libre.
      const target = sceneObjects().find(function(x){ return x.name === follow.targetName; });
      if(target) follow.step(cam.node, target.position, cam._framing);
    });
  }
});
