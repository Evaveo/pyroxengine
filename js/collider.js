// moteur/js/collider.js
//
// Le collider : ses données par défaut, et son visuel d'édition (filaire vert, comme dans
// Unity).
//
// Ces trente lignes vivaient dans js/inspector.js. C'était une inversion de dépendance :
// `ensureCollider()` définit la FORME DES DONNÉES d'un collider — ce que lisent
// construireCorpsPour (physics.js), le composant Collider, la sérialisation et le runtime du
// game publié. Aucun de ces quatre lecteurs n'a de rapport avec l'inspecteur ; il se trouvait
// juste que c'était l'inspecteur qui, historiquement, avait eu besoin d'un défaut le premier.
// Un modèle de données ne doit pas être possédé par un panneau d'interface.
//
// Le visuel (matColliderViz / updateColliderViz / removeColliderViz) reste avec, parce que lui,
// il appartient bien au collider : c'est sa représentation, pas celle de l'inspecteur.

// ---------- Collider (découplé du rendu, utilisé par la physique et l'export) ----------
import { ed } from './component-data.js';
import { liftOverlay } from './editor-overlay.js';
import { Registry } from './component-registry.js';
import { isSceneObject } from './objects.js';
import { LAYER_HELPERS } from './scene.js';
import { selection } from './selection.js';

export const matColliderViz = new THREE.MeshBasicMaterial({
  color:0x4caf50, wireframe:true, transparent:true, opacity:0.55, depthTest:false});

export function removeColliderViz(o){
  if(ed(o).colliderViz){
    o.remove(ed(o).colliderViz);
    ed(o).colliderViz.geometry.dispose();
    ed(o).colliderViz.material.dispose();
    ed(o).colliderViz = null;
  }
}

export function removeCollider2dViz(o){
  const v = ed(o).collider2dViz;
  if(!v) return;
  o.remove(v);
  // Le contour, puis ses poignées (un groupe qui partage une géométrie et un matériau).
  v.geometry.dispose();
  v.material.dispose();
  v.children.forEach(function(g){
    if(g.userData.sharedGeo) g.userData.sharedGeo.dispose();
    if(g.userData.sharedMat) g.userData.sharedMat.dispose();
  });
  ed(o).collider2dViz = null;
}

/**
 * Les sommets du contour d'un Collider2D, dans le repère LOCAL du nœud.
 *
 * Le collider 2D est exprimé en unités du MONDE, sans l'échelle du nœud (`box2dOf`,
 * world-2d.js, ne la lit pas) ; le contour, lui, est enfant du nœud et en hérite. On divise
 * donc par l'échelle, sinon un bâtiment à l'échelle 4 montrerait une boîte quatre fois trop
 * grande, qui ne serait pas celle où le héros bute.
 */
export function outline2dPoints(c, scale){
  const sx = (scale && scale.x) || 1, sy = (scale && scale.y) || 1;
  const l = Math.max(0.001, c.l || 1) / 2, h = Math.max(0.001, c.h || 1) / 2;
  const dx = c.dx || 0, dy = c.dy || 0;
  let pts;
  if(c.shape === 'slope'){
    pts = (c.stepUp === 'left')
      ? [[-l, -h], [l, -h], [-l, h]]
      : [[-l, -h], [l, -h], [l, h]];
  } else {
    pts = [[-l, -h], [l, -h], [l, h], [-l, h]];
  }
  return pts.map(function(p){ return [(p[0] + dx) / sx, (p[1] + dy) / sy]; });
}

// Les huit poignées d'un Collider2D : coins et milieux des côtés, en unités du monde relatives
// au nœud (comme `dx`/`dy`). `x`/`y` du nom : -1, 0 ou 1 — le côté que la poignée tire.
export const HANDLES_2D = [
  {id:'bl', x:-1, y:-1}, {id:'b', x:0, y:-1}, {id:'br', x:1, y:-1}, {id:'r', x:1, y:0},
  {id:'tr', x:1, y:1}, {id:'t', x:0, y:1}, {id:'tl', x:-1, y:1}, {id:'l', x:-1, y:0}];

export function handles2dPoints(c){
  const l = Math.max(0.001, c.l || 1) / 2, h = Math.max(0.001, c.h || 1) / 2;
  return HANDLES_2D.map(function(k){
    return {id:k.id, x:(c.dx || 0) + k.x * l, y:(c.dy || 0) + k.y * h};
  });
}

/**
 * Le collider après avoir tiré la poignée `id` jusqu'au point `p` (unités du monde, relatives
 * au nœud). Le côté OPPOSÉ reste en place — c'est le geste « Edit Collider » d'Unity. Un côté
 * tiré au-delà de l'autre est arrêté à `min` plutôt que retourné.
 */
export function dragHandle2d(c, id, p, min){
  const k = HANDLES_2D.find(function(x){ return x.id === id; });
  if(!k) return c;
  const m = min || 0.05;
  let x0 = (c.dx || 0) - (c.l || 1) / 2, x1 = (c.dx || 0) + (c.l || 1) / 2;
  let y0 = (c.dy || 0) - (c.h || 1) / 2, y1 = (c.dy || 0) + (c.h || 1) / 2;
  if(k.x < 0) x0 = Math.min(p.x, x1 - m);
  if(k.x > 0) x1 = Math.max(p.x, x0 + m);
  if(k.y < 0) y0 = Math.min(p.y, y1 - m);
  if(k.y > 0) y1 = Math.max(p.y, y0 + m);
  const r = function(v){ return Math.round(v * 1000) / 1000; };
  return {l:r(x1 - x0), h:r(y1 - y0), dx:r((x0 + x1) / 2), dy:r((y0 + y1) / 2)};
}

// Le Collider2D de l'objet sélectionné, en contour vert : sans lui, la zone où le héros bute
// n'existait que dans des nombres de l'inspecteur — rien à voir, rien à ajuster à l'œil.
function updateCollider2dViz(){
  Registry.liveNodes('Collider2D').forEach(function(o){
    if(ed(o).collider2dViz && o !== selection) removeCollider2dViz(o);
  });
  if(!selection || !isSceneObject(selection)) return;
  removeCollider2dViz(selection);
  const c = selection.userData.collider2d;
  const comp = selection.getComponent && selection.getComponent('Collider2D');
  if(!c || !comp || comp.active === false) return;
  const pts = outline2dPoints(c, selection.scale);
  // Des SEGMENTS (a→b, b→c…, dernier→premier) et non une LineLoop : le moteur de rendu WebGPU
  // ne dessine pas les LineLoop (« Objects of type THREE.LineLoop are not supported »), le
  // contour restait invisible avec un avertissement à chaque image.
  const flat = [];
  pts.forEach(function(p, i){
    const q = pts[(i + 1) % pts.length];
    flat.push(p[0], p[1], 0.01, q[0], q[1], 0.01);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(flat, 3));
  const viz = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
    color:0x4caf50, transparent:true, opacity:0.9, depthTest:false}));
  viz.raycast = function(){};
  viz.userData.isColliderViz = true;
  liftOverlay(viz);
  viz.layers.set(LAYER_HELPERS);
  // Les poignées : de petits carrés PLEINS (des maillages), pas des `THREE.Points` — le rendu
  // WebGPU dessine tout point sur un seul pixel, quelle que soit sa taille demandée. Leur côté
  // suit la taille du collider (bornée), en unités du monde ; la saisie, elle, se fait en pixels
  // écran (js/collider2d-handles.js), donc reste facile même quand le carré est petit.
  const sx = selection.scale.x || 1, sy = selection.scale.y || 1;
  const side = Math.max(0.08, Math.min(0.3, Math.min(c.l || 1, c.h || 1) * 0.1));
  const handles = new THREE.Group();
  const hGeo = new THREE.PlaneGeometry(side / sx, side / sy);
  const hMat = new THREE.MeshBasicMaterial({color:0x4caf50, depthTest:false, transparent:true, opacity:0.95});
  handles2dPoints(c).forEach(function(p){
    const m = new THREE.Mesh(hGeo, hMat);
    m.position.set(p.x / sx, p.y / sy, 0.02);
    m.raycast = function(){};
    liftOverlay(m, 1);
    m.layers.set(LAYER_HELPERS);
    m.userData.isColliderViz = true;
    handles.add(m);
  });
  handles.userData.isColliderViz = true;
  handles.userData.sharedGeo = hGeo;
  handles.userData.sharedMat = hMat;
  handles.layers.set(LAYER_HELPERS);
  viz.add(handles);
  selection.add(viz);
  ed(selection).collider2dViz = viz;
}

// affiche le collider de l'objet sélectionné (filaire vert), comme dans Unity
export function updateColliderViz(){
  updateCollider2dViz();
  // Seuls les porteurs d'un Collider ont un visuel à unregister : le Registry les rend
  // directement, au lieu de poser la question à toute la scène. liveNodes et pas
  // activeNodes — un collider qu'on vient de décocher doit voir son visuel disparaître,
  // donc il doit encore être atteignable ici.
  Registry.liveNodes('Collider').forEach(function(o){
    if(ed(o).colliderViz && o !== selection) removeColliderViz(o);
  });
  if(!selection || !isSceneObject(selection)) return;
  removeColliderViz(selection);
  const c = selection.userData.collider;
  if(!c || c.shape === 'auto' || c.active === false) return;
  let geo;
  if(c.shape === 'box')       geo = new THREE.BoxGeometry(c.dims[0], c.dims[1], c.dims[2]);
  else if(c.shape === 'sphere') geo = new THREE.SphereGeometry(c.radius, 16, 12);
  else                          geo = new THREE.CylinderGeometry(c.radius, c.radius, c.height, 16);
  // matériau cloné : les boucles de nettoyage génériques peuvent le libérer sans risque
  const viz = new THREE.Mesh(geo, matColliderViz.clone());
  viz.position.fromArray(c.offset);
  viz.raycast = function(){};
  viz.userData.isColliderViz = true;
  liftOverlay(viz);
  // aide d'édition uniquement : jamais visible par une caméra de jeu
  viz.layers.set(LAYER_HELPERS);
  selection.add(viz);
  ed(selection).colliderViz = viz;
}


// EXPOSÉ EN GLOBALE, à dessein. Ces symboles sont appelés depuis des fichiers
// que les mêmes pages ne chargent pas toutes : un `import` y pointerait un
// fichier absent, et la page ne démarrerait pas. Ils gardent donc leur garde
// `typeof` côté appelant, et se déclarent ici.
globalThis.removeColliderViz = removeColliderViz;
globalThis.updateColliderViz = updateColliderViz;