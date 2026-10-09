// moteur/js/hub/template-webxr-vr.js
// Attache le comportement RÉEL du template "WebXR / VR" (js/hub/hub-templates.js) : une salle
// de test prête à jouer au casque —
//
//   · « XR Origin »  : le sol du joueur (composant XROrigin), avec sa caméra principale en
//                       enfant à 1,6 m (hauteur d'aperçu sur écran ; le casque donne la vraie) ;
//   · « Sol »         : une dalle statique portant XRTeleportArea ;
//   · « Table »       : un plateau statique, à hauteur de main ;
//   · trois cubes     : Physics + XRGrabbable, posés sur la table — à saisir et lancer.
//
// Construit avec les MÊMES fabriques que le menu Créer (createObject, createFromCreatable) : ce
// sont des objets de scène ordinaires, modifiables comme les autres. Chargé uniquement par
// editor.html. Mode d'emploi du test sans casque : docs/WEBXR.md.
import { HubTemplates } from './hub-templates.js';
import { createFromCreatable, createObject, createSceneNode, objects } from '../objects.js';
import { select } from '../selection.js';

// Le cube de la fabrique mesure 1,6 m de côté (makePrimitive, js/objects.js) : on raisonne en
// MÈTRES et on en déduit l'échelle. En VR une erreur d'échelle se voit tout de suite — une table
// de 1,6 m de haut n'est plus une table.
const CUBE_SIZE = 1.6;

function sizeCube(o, dims){
  o.scale.set(dims.x / CUBE_SIZE, dims.y / CUBE_SIZE, dims.z / CUBE_SIZE);
}

// Active le corps rigide COMME la case de l'inspecteur (js/inspector.js) : `active` du composant
// PUIS `onActiveChange`. Écrire seulement `data.active = true` ne tient pas — c'est l'état actif du
// composant qui est sérialisé et qui réécrit `data.active` au chargement. Mesuré : les cubes du
// template partaient sans corps, restaient en l'air au lâcher et la table ne les portait pas.
function enablePhysics(o, mass){
  const p = o.getComponent('Physics');
  if(!p) return;
  p.data.masse = mass;
  p.active = true;
  p.onActiveChange(true);
}

function staticBox(name, pos, dims){
  const o = createObject('cube');
  o.name = name;
  o.position.set(pos.x, pos.y, pos.z);
  sizeCube(o, dims);
  // Masse 0 = corps STATIQUE en 3D (rtBindBody, js/rigid-body.js) : il arrête les cubes sans tomber.
  enablePhysics(o, 0);
  return o;
}

export function buildXrStarterScene(){
  const floor = staticBox('Sol', {x: 0, y: -0.05, z: 0}, {x: 12, y: 0.1, z: 12});
  floor.addComponent('XRTeleportArea', {});

  staticBox('Table', {x: 0, y: 0.75, z: -1.2}, {x: 1.4, y: 0.06, z: 0.8});

  [-0.4, 0, 0.4].forEach(function(x, i){
    const c = createObject('cube');
    c.name = 'Cube ' + (i + 1);
    sizeCube(c, {x: 0.12, y: 0.12, z: 0.12});
    c.position.set(x, 0.85, -1.1);
    enablePhysics(c, 0.4);
    c.addComponent('XRGrabbable', {});
  });

  const origin = createSceneNode({name: 'XR Origin', position: {x: 0, y: 0, z: 0},
                                  components: [{type: 'XROrigin', data: {moveSpeed: 1.5}}], silent: true});
  const cam = createFromCreatable('Camera');
  cam.name = 'Caméra XR';
  origin.add(cam);
  cam.position.set(0, 1.6, 0);
  cam.rotation.set(0, 0, 0);
  const r = cam.getComponent('Camera');
  if(r){ r.near = 0.05; r.fov = 70; if(typeof r.applyProjection === 'function') r.applyProjection(); }
  // Global gardée et non import : camera-framing.js est un module que le build sait retirer.
  if(typeof setCameraMain === 'function') setCameraMain(cam, objects);
  if(typeof updateHierarchy === 'function') updateHierarchy();
  return origin;
}

if(typeof HubTemplates !== 'undefined'){
  HubTemplates.attachApply('webxr-vr', function applyWebXrTemplate(){
    const origin = buildXrStarterScene();
    if(typeof select === 'function') select(origin);
  });
}
