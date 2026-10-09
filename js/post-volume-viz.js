// moteur/js/post-volume-viz.js
//
// Visuel filaire de la zone d'un PostVolume sélectionné, même pattern que
// js/collider.js (matColliderViz / updateColliderViz / removeColliderViz) — bleu plutôt que
// vert, pour ne pas se confondre avec un collider physique sur le même objet.
import { ed } from './component-data.js';
import { liftOverlay } from './editor-overlay.js';
import { Registry } from './component-registry.js';
import { isSceneObject } from './objects.js';
import { LAYER_HELPERS } from './scene.js';
import { selection } from './selection.js';

export const matPostVolumeViz = new THREE.MeshBasicMaterial({
  color:0x4287f5, wireframe:true, transparent:true, opacity:0.55, depthTest:false});

export function removePostVolumeViz(o){
  if(ed(o).postVolumeViz){
    o.remove(ed(o).postVolumeViz);
    ed(o).postVolumeViz.geometry.dispose();
    ed(o).postVolumeViz.material.dispose();
    ed(o).postVolumeViz = null;
  }
}

// affiche la zone du PostVolume de l'objet sélectionné (filaire bleu) — rien si le volume est
// global (pas de zone) ou désactivé.
export function updatePostVolumeViz(){
  Registry.liveNodes('PostVolume').forEach(function(o){
    if(ed(o).postVolumeViz && o !== selection) removePostVolumeViz(o);
  });
  if(!selection || !isSceneObject(selection)) return;
  removePostVolumeViz(selection);
  const c = selection.getComponent && selection.getComponent('PostVolume');
  if(!c || c.data.global || c.active === false) return;
  const d = c.data;
  // d.size est une DEMI-étendue (AABB, voir post-volume-blend.js) ; BoxGeometry attend des
  // dimensions pleines, d'où le *2 — à la différence de Collider.dims qui est déjà plein.
  const geo = (d.shape === 'sphere')
    ? new THREE.SphereGeometry(d.radius, 16, 12)
    : new THREE.BoxGeometry(d.size.x * 2, d.size.y * 2, d.size.z * 2);
  const viz = new THREE.Mesh(geo, matPostVolumeViz.clone());
  viz.raycast = function(){};
  viz.userData.isPostVolumeViz = true;
  liftOverlay(viz);
  // aide d'édition uniquement : jamais visible par une caméra de jeu
  viz.layers.set(LAYER_HELPERS);
  selection.add(viz);
  ed(selection).postVolumeViz = viz;
}


// EXPOSÉ EN GLOBALE, à dessein. Ces symboles sont appelés depuis des fichiers
// que les mêmes pages ne chargent pas toutes : un `import` y pointerait un
// fichier absent, et la page ne démarrerait pas. Ils gardent donc leur garde
// `typeof` côté appelant, et se déclarent ici.
globalThis.removePostVolumeViz = removePostVolumeViz;
globalThis.updatePostVolumeViz = updatePostVolumeViz;