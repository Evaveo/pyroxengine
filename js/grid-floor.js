// ---------- La grille de sol de l'éditeur ----------
//
// C'est un GIZMO, pas du contenu : jamais dans `objects`, jamais sérialisée, sur
// LAYER_HELPERS, et on peut l'éteindre (préférence `grid.visible`).
//
// VRAIMENT INFINIE, comme dans Unity — et non un `GridHelper` qu'on agrandit. Les lignes sont
// calculées PAR PIXEL dans le shader à partir de la position monde : elles existent partout,
// il n'y a aucun bord, aucun saut, et rien à reconstruire quand on zoome. Le maillage n'est
// qu'un support : un quad posé sous la caméra, dont le bord est toujours dans le fondu.
//
// Le pas des lignes n'est pas « choisi » : le shader lit la taille d'un pixel en unités monde
// (`fwidth`) et dessine trois décades (…0,1 · 1 · 10 · 100…) en fondu continu. Une décade
// disparaît quand elle devient sous-pixellaire, la suivante prend le relais — sans popping, et
// les lignes tombent toujours sur des coordonnées rondes. C'est ce que fait Unity.
//
// Un repli existe pour un backend sans TSL (`buildFloorGrid`, l'ancien GridHelper) : mieux vaut
// une grille finie que pas de grille du tout si le pont WebGPU n'a pas chargé.
import { scene } from './scene.js';
import { liftOverlay } from './editor-overlay.js';

export const GRID_DIVISIONS = 60;          // repli seulement
export const GRID_COLOR_AXIS = 0x3a4048;   // lignes des décades hautes (et repli)
export const GRID_COLOR_CELL = 0x262b32;   // lignes de la décade fine
export const GRID_STEP_MIN = 0.01;
export const GRID_STEP_MAX = 1000;
// Combien de pixels au minimum entre deux lignes avant que la décade ne s'efface. En dessous,
// les lignes se touchent et la grille devient un aplat.
export const GRID_PIXELS_MIN = 6;

/**
 * Le rayon couvert par le quad de support pour une caméra à `distance` du sol.
 *
 * Généreux exprès : le fondu éteint la grille bien avant ce bord, donc on ne le voit jamais.
 * Le lier à la distance de vue plutôt que de le figer évite les erreurs de précision flottante
 * qu'un quad de 10^7 unités provoque quand la caméra est à 2 unités du sol.
 */
export function gridFadeRadius(distance){
  return Math.max(1, distance || 0) * 60;
}

// --- repli sans TSL : l'ancien GridHelper, fini, avec un pas par décade ---------------------

export function gridStepFor(distance){
  const d = Math.max(0.001, distance || 0);
  const step = Math.pow(10, Math.round(Math.log10(d * 4 / GRID_DIVISIONS)));
  return Math.min(GRID_STEP_MAX, Math.max(GRID_STEP_MIN, step));
}

export function gridSnap(v, step){
  if(!step) return v;
  return Math.round(v / step) * step;
}

export function buildFloorGrid(step){
  const g = new THREE.GridHelper(step * GRID_DIVISIONS, GRID_DIVISIONS,
                                 GRID_COLOR_AXIS, GRID_COLOR_CELL);
  g.position.y = 0.001;
  g.userData.step = step;
  g.userData.infinite = false;
  liftOverlay(g, -10);        // par-dessus les tuiles et sprites 2D, sous les autres aides
  return g;
}

// --- la vraie grille infinie ---------------------------------------------------------------

/**
 * Le quad de support et son matériau TSL. Rend `null` si TSL n'est pas là (repli).
 *
 * `depthWrite:false` : la grille ne doit jamais masquer un objet au test de profondeur, et
 * `transparent:true` la fait passer après l'opaque. `frustumCulled:false` parce qu'on déplace
 * le quad à la main chaque image — le culling se ferait sur une bounding box périmée.
 */
export function buildInfiniteGrid(){
  if(typeof TSL === 'undefined' || !TSL || !TSL.fwidth || !THREE.MeshBasicNodeMaterial) return null;
  const {positionWorld, cameraPosition, fwidth, uniform, float, vec2, vec3, vec4,
         abs: tabs, fract, floor: tfloor, log, pow, min: tmin, max: tmax, mix,
         smoothstep, length: tlength} = TSL;

  const uRadius = uniform(1000);
  const cellColor = new THREE.Color(GRID_COLOR_CELL);
  const axisColor = new THREE.Color(GRID_COLOR_AXIS);

  // Position dans le plan, en unités monde. `fwidth` en donne la dérivée écran : c'est la
  // taille d'un pixel au sol, et donc la SEULE mesure dont on a besoin pour choisir la décade.
  const p = vec2(positionWorld.x, positionWorld.z);
  const dp = fwidth(p);
  const px = tmax(dp.x, dp.y);

  // Décade continue. `log(x)/log(10)` : TSL n'expose pas log10. Borné en bas à -2 : en dessous
  // du centimètre, une grille d'édition ne dit plus rien et coûte des lignes pour rien.
  const lod = tmax(log(tmax(px.mul(GRID_PIXELS_MIN), float(1e-6))).div(Math.log(10)), float(-2));
  const lodFrac = fract(lod);
  const cell0 = pow(float(10), tfloor(lod));       // la plus fine encore lisible
  const cell1 = cell0.mul(10);
  const cell2 = cell0.mul(100);

  // Une ligne = la distance au trait le plus proche, mesurée EN PIXELS (division par la
  // dérivée). C'est ce qui donne une épaisseur constante à l'écran, quel que soit le zoom.
  const ligne = function(cell){
    const c = p.div(cell);
    const g = tabs(fract(c.sub(0.5)).sub(0.5)).div(fwidth(c));
    return float(1).sub(tmin(tmin(g.x, g.y), float(1)));
  };

  const a0 = ligne(cell0).mul(float(1).sub(lodFrac));   // s'efface en devenant sous-pixellaire
  const a1 = ligne(cell1);
  const a2 = ligne(cell2);

  // Fondu radial : il éteint la grille avant le bord du quad. Sans lui, on verrait une arête
  // franche — exactement le défaut qu'on corrige.
  const distance = tlength(p.sub(vec2(cameraPosition.x, cameraPosition.z)));
  const fade = float(1).sub(smoothstep(uRadius.mul(0.25), uRadius.mul(0.9), distance));

  const alpha = tmax(a2, tmax(a1, a0)).mul(fade);
  // La décade haute est plus claire : c'est elle qui donne l'échelle quand on est loin.
  const couleur = mix(vec3(cellColor.r, cellColor.g, cellColor.b),
                      vec3(axisColor.r, axisColor.g, axisColor.b),
                      tmax(a2, a1.mul(lodFrac)));

  const mat = new THREE.MeshBasicNodeMaterial({transparent: true, depthWrite: false,
    side: THREE.DoubleSide, fog: false, toneMapped: false});
  mat.colorNode = vec4(couleur, alpha);

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.001;      // au-dessus du plan, pour ne pas z-fighter avec un sol posé à 0
  mesh.frustumCulled = false;
  liftOverlay(mesh, -10);       // par-dessus les tuiles et sprites 2D (qui n'écrivent pas la profondeur)
  mesh.raycast = function(){};  // un gizmo ne se sélectionne pas au clic
  mesh.userData.infinite = true;
  mesh.userData.uRadius = uRadius;
  return mesh;
}

/** La grille à poser dans la scène : infinie si le backend le permet, finie sinon. */
export function createFloorGrid(){
  return buildInfiniteGrid() || buildFloorGrid(1);
}

/**
 * Recale la grille sous la caméra. Rend le helper à utiliser — le MÊME objet, sauf dans le
 * repli fini où un changement de décade oblige à le reconstruire.
 *
 * `distance` : l'éloignement qui donne l'échelle (distance d'orbite, ou hauteur en vol libre).
 */
export function updateFloorGrid(scene, helper, camera, distance, visible){
  if(!helper) return helper;
  helper.visible = visible !== false;
  if(!helper.visible || !camera) return helper;

  const d = Math.max(Math.abs(camera.position.y), distance || 0);

  if(helper.userData.infinite){
    // Rien d'adaptatif ici : le quad n'est qu'un support, les lignes vivent dans le shader.
    // On le pose sous la caméra et on l'étale assez pour que son bord reste dans le fondu.
    const radius = gridFadeRadius(d);
    helper.position.set(camera.position.x, 0.001, camera.position.z);
    helper.scale.set(radius * 2, radius * 2, 1);
    if(helper.userData.uRadius) helper.userData.uRadius.value = radius;
    return helper;
  }

  const step = gridStepFor(d);
  let g = helper;
  if(g.userData.step !== step){
    const neuf = buildFloorGrid(step);
    neuf.layers.mask = g.layers.mask;
    neuf.visible = g.visible;
    scene.add(neuf);
    scene.remove(g);
    g.geometry.dispose();
    g.material.dispose();
    g = neuf;
  }
  g.position.set(gridSnap(camera.position.x, step), 0.001, gridSnap(camera.position.z, step));
  return g;
}
