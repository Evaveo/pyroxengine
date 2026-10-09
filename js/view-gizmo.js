// moteur/js/view-gizmo.js
//
// Le widget d'axes du viewport, façon Unity. En SVG superposé au canvas, et PAS en seconde scène
// three : le projet n'a pas d'étape de build, et un second renderer coûte plus cher que tout ce
// que ce widget affiche.

import { setEditorProjection } from './editor-camera.js';
import { project } from './project.js';
import { camEditor, orbit, renderer, setEditorCamera, updateCamera, viewEl } from './scene.js';
import { camCurrent } from './viewport.js';

/** Position de la caméra pour une vue alignée, en unités de distance d'orbite. */
export function viewDirection(axis){
  switch(axis){
    case '+x': return { x: 1, y: 0, z: 0 };
    case '-x': return { x: -1, y: 0, z: 0 };
    case '+y': return { x: 0, y: 1, z: 0 };
    case '-y': return { x: 0, y: -1, z: 0 };
    case '+z': return { x: 0, y: 0, z: 1 };
    default:   return { x: 0, y: 0, z: -1 };
  }
}

/** Libellé français d'une vue — c'est de l'interface, donc en français. */
export const VIEW_LABELS = {
  '+x': 'Droite', '-x': 'Gauche', '+y': 'Dessus', '-y': 'Dessous',
  '+z': 'Face', '-z': 'Arrière', 'free': 'Persp', 'iso': 'Iso'
};

/**
 * Une vue ALIGNÉE passe en orthographique, comme Unity.
 *
 * Ce n'est pas une commodité : en perspective, une vue de dessus donne des lignes de fuite qui
 * rendent impossible d'aligner deux objets à l'œil — et c'est précisément pour aligner qu'on se
 * met en vue de dessus.
 */
export function projectionForView(view){
  return (view === 'free') ? 'perspective' : 'orthographic';
}

/** Les angles d'orbite (theta, phi) d'une vue alignée. */
export function orbitOfView(axis){
  const d = viewDirection(axis);
  // phi est l'angle depuis +Y, theta l'azimut dans le plan XZ — la convention d'`updateCamera`.
  return { theta: Math.atan2(d.x, d.z), phi: Math.acos(Math.max(-1, Math.min(1, d.y))) };
}

/**
 * Les paliers de zoom entiers de l'ancien onglet 2D — le zoom pixel-perfect se choisit par
 * RAPPORT ENTIER (1, 2, 3… pixels écran par pixel de sprite), jamais par hauteur libre.
 */
export const VIEW2D_ZOOMS = [1, 2, 3, 4, 6, 8, 12, 16];

/** Les pixels par unité de référence du projet — l'échelle à laquelle le calage s'applique. */
export function ppu2dOfProject(){
  const p = (project && Number(project.ppu2d)) || 0;
  return p > 0 ? p : 100;
}

/** Cale une coordonnée sur la grille de pixels, comme le faisait le cadrage de la vue 2D. */
export function snapCameraOnPixel(v, ppu){
  const p = Math.max(1, Number(ppu) || 100);
  return Math.round(Number(v) * p) / p;
}

// ---------- Le widget, ses gestes, et l'état de vue ----------

export const viewGizmo = { view: 'free', pixelSnap: false };

// Les six boutons : axe, direction dans le monde, couleur, lettre (les négatifs n'en ont pas).
const GIZMO_AXES = [
  ['+x', [1, 0, 0], '#e06c75', 'X'], ['-x', [-1, 0, 0], '#e06c75', ''],
  ['+y', [0, 1, 0], '#98c379', 'Y'], ['-y', [0, -1, 0], '#98c379', ''],
  ['+z', [0, 0, 1], '#61afef', 'Z'], ['-z', [0, 0, -1], '#61afef', '']
];

// Rayon des axes dans la vue 72×72 : la bille (r 8) reste entière dans le cadre.
const GIZMO_ARM = 25;

/**
 * Les positions à l'écran des six axes pour une caméra d'orientation `q` (quaternion {x,y,z,w}).
 *
 * PURE : l'axe du monde passe dans le repère de la caméra (rotation par l'INVERSE de `q`), puis
 * sa composante x/y donne la position, et z la profondeur — un z plus grand est plus PRÈS de
 * l'œil (la caméra regarde vers -z), donc dessiné par-dessus. Rend [{axis, x, y, z}], trié du
 * plus lointain au plus proche : l'ordre de dessin.
 */
export function gizmoAxesLayout(q, arm){
  const r = Number(arm) || GIZMO_ARM;
  // Rotation par le CONJUGUÉ de q (monde → caméra) : t = 2 (u × v), v' = v + w t + u × t.
  const ux = -q.x, uy = -q.y, uz = -q.z, w = q.w;
  const out = GIZMO_AXES.map(function(a){
    const vx = a[1][0], vy = a[1][1], vz = a[1][2];
    const tx = 2 * (uy * vz - uz * vy), ty = 2 * (uz * vx - ux * vz), tz = 2 * (ux * vy - uy * vx);
    const cx = vx + w * tx + (uy * tz - uz * ty);
    const cy = vy + w * ty + (uz * tx - ux * tz);
    const cz = vz + w * tz + (ux * ty - uy * tx);
    return {axis: a[0], x: 36 + cx * r, y: 36 - cy * r, z: cz};
  });
  return out.sort(function(a, b){ return a.z - b.z; });
}

let lastGizmoKey = '';

/** Oriente le widget sur la caméra. Appelée à chaque image : ne touche au DOM que si elle a tourné. */
export function orientViewGizmo(camera){
  if(!camera || !camera.quaternion) return;
  const q = camera.quaternion;
  const key = q.x.toFixed(4) + ',' + q.y.toFixed(4) + ',' + q.z.toFixed(4) + ',' + q.w.toFixed(4);
  if(key === lastGizmoKey) return;
  const svg = document.querySelector('#view-gizmo svg');
  if(!svg) return;
  lastGizmoKey = key;
  gizmoAxesLayout(q).forEach(function(p){
    const g = svg.querySelector('[data-axis="' + p.axis + '"]');
    if(!g) return;
    const c = g.querySelector('circle'), t = g.querySelector('text'), l = g.querySelector('line');
    c.setAttribute('cx', p.x.toFixed(1)); c.setAttribute('cy', p.y.toFixed(1));
    if(t){ t.setAttribute('x', p.x.toFixed(1)); t.setAttribute('y', (p.y + 3.5).toFixed(1)); }
    if(l){ l.setAttribute('x2', p.x.toFixed(1)); l.setAttribute('y2', p.y.toFixed(1)); }
    svg.appendChild(g);   // réordonne : le dernier ajouté est dessiné devant
  });
}

/** Construit le widget une fois, dans #view-gizmo. */
export function buildViewGizmo(){
  const el = document.getElementById('view-gizmo');
  if(!el) return;
  // Les positions ne sont PAS écrites ici : `orientViewGizmo` les pose à chaque image, d'après
  // l'orientation de la caméra. Figées, elles montraient toujours la vue de face — un gizmo qui
  // ne tourne pas avec la vue ne dit rien de la vue.
  el.innerHTML = '<svg viewBox="0 0 72 72" width="72" height="72">'
    + GIZMO_AXES.map(function(a){
        const pos = a[0].charAt(0) === '+';
        return '<g data-view="' + a[0] + '" data-axis="' + a[0] + '" style="cursor:pointer">'
          + '<title>' + VIEW_LABELS[a[0]] + '</title>'
          + (pos ? '<line x1="36" y1="36" x2="36" y2="36" stroke="' + a[2] + '" stroke-width="2"/>' : '')
          + '<circle cx="36" cy="36" r="' + (pos ? 8 : 6) + '" fill="' + a[2] + '"'
          + (pos ? '' : ' fill-opacity="0.55" stroke="' + a[2] + '"') + '/>'
          + (a[3] ? '<text x="36" y="39" text-anchor="middle" font-size="10" fill="#fff">' + a[3] + '</text>' : '')
          + '</g>';
      }).join('')
    + '</svg>'
    + '<button class="gizmo-label" id="gizmo-label" title="Basculer perspective / orthographique">'
    + VIEW_LABELS.free + '</button>'
    + '<label class="gizmo-snap" id="gizmo-snap" style="display:none">'
    + '<input type="checkbox" id="f-pixel-snap"> Pixel snap</label>';

  // Un seul écouteur délégué : le widget est refait à chaque changement de thème.
  el.addEventListener('click', function(e){
    const g = e.target.closest ? e.target.closest('[data-view]') : null;
    if(g){ setViewAligned(g.dataset.view); return; }
    if(e.target.id === 'gizmo-label') toggleProjectionEditor();
  });
  el.addEventListener('change', function(e){
    if(e.target.id === 'f-pixel-snap'){
      viewGizmo.pixelSnap = e.target.checked;
      updateCamera();
    }
  });
  lastGizmoKey = '';
  refreshViewGizmo();
}

/** Le libellé et la case de calage suivent l'état courant. */
export function refreshViewGizmo(){
  const lab = document.getElementById('gizmo-label');
  if(lab) lab.textContent = VIEW_LABELS[viewGizmo.view] || VIEW_LABELS.free;
  const snap = document.getElementById('gizmo-snap');
  // Le calage n'a de sens qu'en orthographique : en perspective, la taille d'un pixel du monde
  // dépend de la profondeur, et « caler sur le pixel » n'y veut rien dire.
  if(snap) snap.style.display = (projectionForView(viewGizmo.view) === 'orthographic') ? 'block' : 'none';
}

/**
 * Pose la vue sur un axe : orbite alignée ET projection orthographique.
 *
 * On réutilise la cible et la distance d'`orbit` plutôt que d'en tenir une seconde : deux états
 * de navigation, ce sont deux états qui divergent, et le cadrage (F) lit celui d'`orbit`.
 */
export function setViewAligned(axis){
  const a = orbitOfView(axis);
  orbit.theta = a.theta;
  orbit.phi = a.phi;
  // La vue alignée lève le clamp d'élévation : `+y` exige phi = 0, `-y` exige phi = π, et les
  // deux sont hors des bornes de l'orbite libre.
  orbit.aligned = true;
  viewGizmo.view = axis;
  applyEditorProjection('orthographic');
  updateCamera();
  refreshViewGizmo();
}

/** Bascule perspective ↔ orthographique sans changer l'orientation. */
export function toggleProjectionEditor(){
  const versOrtho = !camEditor.isOrthographicCamera;
  viewGizmo.view = versOrtho ? 'iso' : 'free';
  if(!versOrtho) orbit.aligned = false;
  applyEditorProjection(versOrtho ? 'orthographic' : 'perspective');
  updateCamera();
  refreshViewGizmo();
}

/** Échange la caméra d'édition pour la projection demandée, si elle ne l'est pas déjà. */
export function applyEditorProjection(projection){
  const dejaOrtho = !!camEditor.isOrthographicCamera;
  if((projection === 'orthographic') === dejaOrtho) return camEditor;
  const el = viewEl ? viewEl : null;
  const aspect = el && el.clientHeight ? (el.clientWidth / el.clientHeight) : 1;
  const c = setEditorProjection(camEditor, projection,
    { distance: orbit.dist, fov: 55, aspect: aspect });
  return setEditorCamera(c);
}


/**
 * Le point du monde sous la souris, dans le plan z = 0, en unités.
 *
 * Reprise de `pointView2dFrom` (ancien onglet 2D), mais sur la caméra d'ÉDITION : il n'y a plus
 * qu'un monde, donc plus qu'une caméra à interroger. Pas de lancer de rayon — la projection est
 * orthographique et le plan connu, donc la conversion est une règle de trois ; un `Raycaster`
 * dépendrait de ce qu'il y a sous le curseur, et peindre dans le vide ne donnerait rien.
 */
export function pointOnPlaneFrom(e){
  const el = renderer.domElement;
  if(!el) return {x: 0, y: 0};
  const r = el.getBoundingClientRect();
  const c = camCurrent();
  const fx = (e.clientX - r.left) / (r.width || 1);
  const fy = (e.clientY - r.top) / (r.height || 1);
  if(c.isOrthographicCamera){
    return {
      x: c.position.x + c.left + fx * (c.right - c.left),
      y: c.position.y + c.top - fy * (c.top - c.bottom)   // l'écran descend, le monde monte
    };
  }
  // En perspective, l'intersection du rayon avec le plan z = 0. Sans elle, le pinceau ne
  // marcherait qu'en vue Face — et rien ne dirait pourquoi.
  const ndc = new THREE.Vector3(fx * 2 - 1, -(fy * 2 - 1), 0.5).unproject(c);
  const dir = ndc.sub(c.position);
  if(Math.abs(dir.z) < 1e-9) return {x: c.position.x, y: c.position.y};
  const t = -c.position.z / dir.z;
  return {x: c.position.x + dir.x * t, y: c.position.y + dir.y * t};
}

globalThis.orientViewGizmo = orientViewGizmo;
globalThis.gizmoAxesLayout = gizmoAxesLayout;
