// ---------- Interaction viewport ----------
import { backgroundForCamera, isSkyBackground } from './sky-camera.js';
import { updateAnimationsModels, updateAnimators } from './anim-models.js';
import { anim, applyAnimation, btnPlayback, togglePlayback, triggerMarkersOfClipShown, updatePlayhead } from './animation.js';
import { deleteSelectionGraph, refreshStateCurrent, viewAnimatorActive } from './animator-graph.js';
import { nodeHandled, rootHandled } from './assets.js';
import { ed } from './component-data.js';
import { SystemParticles } from './components/component-particles.js';
import { SystemPhysics } from './components/component-physics.js';
import { SystemScripts } from './components/component-script.js';
import { updateEditorBatching } from './editor-batching.js';
import { registerInputs } from './editor-input.js';
import { updateFloorGrid } from './grid-floor.js';
import { openContextHelp } from './help.js';
import { setStatus, updateHierarchy } from './hierarchy.js';
import { restore, undo } from './history.js';
import { buildInspector, copySelection, deleteSelection, duplicateSelection, pasteClipBoard, quitViewCamera } from './inspector.js';
import { lightmapBakeState } from './lightmap-bake.js';
import { helpers, itemsCreationContext, objects, openMenuContext, takeLayersDirty } from './objects.js';
import { phys } from './physics.js';
import { postActive, postRender } from './postfx.js';
import { depthEnd, depthFrame, depthStart } from './profiler.js';
import { ORBIT_PHI_MAX, ORBIT_PHI_MIN, activeCam, camEditor, grid, orbit, previewCam, renderer, scene, setGrid, setModeGizmo, tc, tcVisual, updateCamera, updateShadows, viewEl } from './scene.js';
import { inputsCurrent, keysGame, stopScripts } from './scripts.js';
import { clearTouchControls } from './touch-input.js';
import { addMultiInBatch, allSelection, clearMulti, select, selection, selectionMulti, toggleMulti } from './selection.js';
import { System } from './systems.js';
import { closeMenus, closeModal, menuOpen, modal } from './ui.js';
import { Prefs } from './ui/prefs.js';
import { buildViewGizmo, orientViewGizmo, refreshViewGizmo, viewGizmo } from './view-gizmo.js';
import { frameSelection } from './view-tools.js';

export const raycaster = new THREE.Raycaster();
raycaster.layers.enableAll();   // sinon un test contre tc (LAYER_HELPERS) ou tout objet d'un
                                 // autre calque que 0 échoue systématiquement (voir hoverGizmo)
export const mouse = new THREE.Vector2();

// icônes d'édition (jamais rendues par une caméra de jeu, quel que soit leur parent) :
// caméra, lumière, nœud vide, sonde de réflexion, émetteur de particules, wireframe de collider
export function isIconEdit(o){
  return o.userData.type === 'camera' || o.userData.type === 'point' || o.userData.type === 'spot'
    || o.userData.type === 'directional' || o.userData.type === 'group'
    || o.userData.type === 'probe' || o.userData.type === 'particles'
    || o.userData.isColliderViz === true;
}

/**
 * Fait descendre le calque de PROJET d'un nœud (`userData.game.layer`) dans le bit
 * `Object3D.layers` du nœud et de toute sa descendance.
 *
 * Une icône d'édition n'est jamais touchée : elle reste sur LAYER_HELPERS (jamais sur le calque
 * de projet), comme le boîtier/objectif de makeCamera — sinon elle devient visible pour toute
 * caméra de jeu qui active le calque 0 (objects.js/probes.js/particles.js/inspector.js).
 * Vérifié aussi pour les descendants : un gizmo peut être parenté sous un objet non-gizmo.
 */
export function applyProjectLayer(o){
  if(!o || isIconEdit(o)) return;
  const idLayer = (o.userData.game && typeof o.userData.game.layer === 'number')
    ? o.userData.game.layer : 0;
  o.layers.disableAll();
  o.layers.enable(idLayer);
  o.traverse(function(x){
    if(x !== o && !isIconEdit(x)){ x.layers.disableAll(); x.layers.enable(idLayer); }
  });
}

export let mode = null;
export let lastPos = {x:0, y:0};

// ----- vol libre : active tant que le clic droit est maintenu -----
export const flyFree = {active:false, yaw:0, pitch:0, speed:6};
export const keysFlyFree = new Set();   // codes physiques (KeyW, KeyA, ...), independants du layout

export function startFlyFree(){
  if(activeCam) return;   // pas de vol libre en aperçu caméra de jeu
  flyFree.active = true;
  const euler = new THREE.Euler().setFromQuaternion(camEditor.quaternion, 'YXZ');
  flyFree.yaw = euler.y;
  flyFree.pitch = euler.x;
}

export function stopFlyFree(){
  if(!flyFree.active) return;
  flyFree.active = false;
  keysFlyFree.clear();
  // ré-dérive orbit pour que le pan et le cadrage (F) restent valides après le vol libre.
  // updateCamera() définit (theta, phi) comme la direction CIBLE → CAMÉRA ; avant (regard de
  // la caméra) pointe caméra → cible, donc l'inverse — l'utiliser directement (sans le
  // négativer) donnait le point antipodal sur la sphère d'orbite : une caméra en (8,9,8)
  // visant l'origine se retrouvait téléportée en (-8,-7,-8) au relâchement, sans même move
  // la souris. Vérifié empiriquement (position avant/après capturées via un clic droit simulé).
  const avant = new THREE.Vector3();
  camEditor.getWorldDirection(avant);
  orbit.target.copy(camEditor.position).addScaledVector(avant, orbit.dist);
  const toCamera = avant.clone().negate();
  orbit.theta = Math.atan2(toCamera.x, toCamera.z);
  const yMin = Math.cos(ORBIT_PHI_MAX), yMax = Math.cos(ORBIT_PHI_MIN);
  orbit.phi = Math.acos(THREE.MathUtils.clamp(toCamera.y, yMin, yMax));
  updateCamera();   // réconcilie tout de suite la position caméra avec cet orbit borné
}

// ----- rubber band (sélection par rectangle) -----
export const rubberBand = {active:false, start:{x:0,y:0}, additif:false};
export const RUBBER_THRESHOLD = 4;   // px : sous ce déplacement, un pointerup vaut un simple clic (désélection)

export function coordsMouse(e){
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
}
/**
 * La caméra qui rend la vue.
 *
 * `activeCam` reste PRIORITAIRE : regarder à travers une caméra de la scène doit fonctionner
 * dans les deux espaces, et c'est un geste explicite de l'utilisateur. L'espace 2D ne s'impose
 * donc qu'en l'absence de ce choix-là.
 */
export function camCurrent(){
  if(activeCam) return activeCam;
  return camEditor;
}

// vrai si (x,y) tombe sur une partie interactive du gizmo. N'est PAS utilisé pour décider si
// un clic doit être laissé au gizmo (voir plus bas : tc.axis/tc.dragging suffisent et sont
// fiables — un raycast maison contre tc touchait des pickers surdimensionnés/invisibles et
// bloquait la navigation caméra bien au-delà des poignées réelles). Gardé au cas où un usage
// plus ciblé (un seul mode à la fois) soit utile plus tard.
export function hoverGizmo(e){
  // `visible` et le raycast portent sur le HELPER : depuis r16x le contrôleur n'est plus
  // un Object3D et n'a ni l'un ni l'autre (voir scene.js).
  if(!tcVisual.visible || !tc.object) return false;
  coordsMouse(e);
  raycaster.setFromCamera(mouse, camCurrent());
  return raycaster.intersectObject(tcVisual, true).length > 0;
}

// projette chaque racine gérée dans l'écran et retient celles dont le centre tombe dans le
// rectangle — une heuristique simple (pas une intersection de boîte englobante précise),
// suffisante pour un rubber band et bien moins coûteuse qu'un raycast par objet.
export function objectsInRect(pt0, pt1){
  const x0 = Math.min(pt0.x, pt1.x), x1 = Math.max(pt0.x, pt1.x);
  const y0 = Math.min(pt0.y, pt1.y), y1 = Math.max(pt0.y, pt1.y);
  const rect = renderer.domElement.getBoundingClientRect();
  const racines = objects.filter(function(o){ return o.parent === scene || !objects.includes(o.parent); });
  const trouves = [];
  const proj = new THREE.Vector3();
  racines.forEach(function(o){
    o.getWorldPosition(proj);
    proj.project(camCurrent());
    const sx = rect.left + (proj.x * 0.5 + 0.5) * rect.width;
    const sy = rect.top + (1 - (proj.y * 0.5 + 0.5)) * rect.height;
    if(proj.z < -1 || proj.z > 1) return;   // derrière la caméra ou hors frustum
    if(sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) trouves.push(o);
  });
  return trouves;
}

/**
 * Les annulations de gestes natifs sur le canevas. Appelée par `startup.js`.
 *
 * Différée pour la même raison que `bindEditorInput` : `renderer` est un `const` de
 * `js/scene.js`, et ce fichier est dans un cycle d'imports avec lui. Le lire au premier niveau
 * ne tient que par l'ordre des <script>, pas par le graphe de modules.
 */
export function bindViewportCanvas(){
  resize();
  renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());
  // filet de sécurité en plus du preventDefault() sur pointerdown (clic molette, priorité 0
  // du dispatcher) : certains contextes n'annulent pas complètement l'autoscroll natif via
  // le seul événement pointerdown.
  renderer.domElement.addEventListener('mousedown', function(e){ if(e.button === 1) e.preventDefault(); });
  renderer.domElement.addEventListener('auxclick', function(e){ if(e.button === 1) e.preventDefault(); });
}

// ----- sélection + caméra : priorité la plus basse du dispatcher (Lot 0). Sculpture (30)
// et paint (20) interceptent l'événement avant que ce gestionnaire ne le voie. -----
//
// DIFFÉRÉE POUR LA MÊME RAISON QUE `bindEditorInput`/`bindTerrainInputs`/`bindPlacementInputs` :
// `registerInputs` écrit dans `inputs`, un `const` de `editor-input.js`. Ce fichier importe
// `registerInputs` depuis `editor-input.js`, qui importe `scene.js`, qui importe ce fichier
// (`camCurrent`) — cycle direct. L'appeler au premier niveau ne tenait que par l'ordre de
// résolution des imports, pas par le graphe de modules. Appelée par `startup.js`.
export function bindViewportInputs(){
  registerInputs({
  name: 'selection-camera',
  priorite: 0,
  pointerdown: function(e){
    lastPos = {x:e.clientX, y:e.clientY};
    // le gizmo a la main (ou est visé) : ne rien faire, quel que soit le bouton — ni vol
    // libre/panoramique au clic droit/molette, ni sélection/rubber band au clic gauche.
    if(tc.dragging || tc.axis){ mode = null; return false; }
    if(e.button === 1){
      e.preventDefault();   // sans ça, le navigateur declenche son propre autoscroll au clic molette
      // capture le pointeur : sans ça, un glisser rapide qui sort du canvas arrête les
      // pointermove jusqu'au retour du curseur, et le delta calculé au retour (loin de
      // lastPos, resté figé) fait « sauter » brutalement la caméra.
      renderer.domElement.setPointerCapture(e.pointerId);
      mode = 'pan';
      return true;
    }
    if(e.button === 2){                                       // clic droit = vol libre (regard + WASD)
      renderer.domElement.setPointerCapture(e.pointerId);
      startFlyFree();
      mode = 'vol-libre';
      flyFree.aBouge = false;
      flyFree.start = {x: e.clientX, y: e.clientY};
      return true;
    }
    if(e.button !== 0) return false;

    coordsMouse(e);
    raycaster.setFromCamera(mouse, camCurrent());
    const hits = raycaster.intersectObjects(objects, true);

    let keyObj = null;
    if(hits.length){
      // Comme Unity : le premier clic sur un modèle prend sa RACINE ; recliquer, une fois
      // l'instance sélectionnée, descend sur la pièce touchée (maillage, os porteur…).
      keyObj = rootHandled(hits[0].object);
      const exact = nodeHandled(hits[0].object);
      if(exact && exact !== keyObj && selection
         && (selection === keyObj || (selection.userData.modelNode !== undefined
             && rootHandled(selection) === keyObj))){
        keyObj = exact;
      }
    }

    if(keyObj && (e.ctrlKey || e.metaKey)){
      toggleMulti(keyObj);
      mode = null;
      return true;
    }

    if(keyObj){
      if(allSelection().indexOf(keyObj) !== -1) select(keyObj, true);
      else select(keyObj);
      mode = null;   // plus de déplacement au clic : seul le gizmo déplace désormais
    } else {
      renderer.domElement.setPointerCapture(e.pointerId);
      rubberBand.active = true;
      rubberBand.start = {x: e.clientX, y: e.clientY};
      rubberBand.additif = e.shiftKey;
      mode = 'rubber-en-pending';   // devient 'rubber' au premier pointermove qui dépass le seuil
    }
    return true;
  },
  pointermove: function(e){
    const dx = e.clientX - lastPos.x;
    const dy = e.clientY - lastPos.y;
    lastPos = {x:e.clientX, y:e.clientY};

    if(mode === 'vol-libre'){
      if(!flyFree.aBouge && Math.hypot(e.clientX - flyFree.start.x, e.clientY - flyFree.start.y) > 4){
        flyFree.aBouge = true;
      }
      flyFree.yaw -= dx * 0.003;
      flyFree.pitch -= dy * 0.003;
      flyFree.pitch = THREE.MathUtils.clamp(flyFree.pitch, -Math.PI/2 + 0.05, Math.PI/2 - 0.05);
      camEditor.quaternion.setFromEuler(new THREE.Euler(flyFree.pitch, flyFree.yaw, 0, 'YXZ'));
      return true;
    }
    if(rubberBand.active){
      const dxr = e.clientX - rubberBand.start.x, dyr = e.clientY - rubberBand.start.y;
      if(mode === 'rubber-en-pending' && Math.hypot(dxr, dyr) < RUBBER_THRESHOLD) return true;
      mode = 'rubber';
      const rect = document.getElementById('rubber-band');
      const canvasRect = renderer.domElement.getBoundingClientRect();
      const x0 = Math.min(rubberBand.start.x, e.clientX), x1 = Math.max(rubberBand.start.x, e.clientX);
      const y0 = Math.min(rubberBand.start.y, e.clientY), y1 = Math.max(rubberBand.start.y, e.clientY);
      rect.style.display = 'block';
      rect.style.left = (x0 - canvasRect.left) + 'px';
      rect.style.top = (y0 - canvasRect.top) + 'px';
      rect.style.width = (x1 - x0) + 'px';
      rect.style.height = (y1 - y0) + 'px';
      return true;
    }
    if(mode === 'orbit'){
      // Tourner à la main SORT de la vue alignée : sans ça le clamp resterait levé et l'orbite
      // pourrait se coincer au pôle, où `lookAt` dégénère.
      if(orbit.aligned){
        orbit.aligned = false;
        if(typeof viewGizmo !== 'undefined'){ viewGizmo.view = camEditor.isOrthographicCamera ? 'iso' : 'free'; }
        refreshViewGizmo();
      }
      orbit.theta -= dx * 0.006;
      orbit.phi   -= dy * 0.006;
      updateCamera();
      return true;
    }
    if(mode === 'pan'){
      if(activeCam) return true;
      const v = new THREE.Vector3();
      camEditor.getWorldDirection(v);
      const right = new THREE.Vector3().crossVectors(v, camEditor.up).normalize();
      const top = new THREE.Vector3().crossVectors(right, v).normalize();
      const k = orbit.dist * 0.0016;
      orbit.target.addScaledVector(right, -dx * k);
      orbit.target.addScaledVector(top, dy * k);
      updateCamera();
      return true;
    }
    return false;
  },
  wheel: function(e){
    if(flyFree.active){
      e.preventDefault();
      flyFree.speed = Math.max(0.5, Math.min(60, flyFree.speed * (e.deltaY > 0 ? 0.9 : 1.1)));
      setStatus('Vitesse de vol : ' + flyFree.speed.toFixed(1) + ' m/s', 1000);
      return true;
    }
    if(activeCam) return false;
    e.preventDefault();
    orbit.dist *= (e.deltaY > 0 ? 1.1 : 0.9);
    updateCamera();
    return true;
  },
  pointerup: function(e){
    if(e.button === 2 && mode === 'vol-libre'){
      const bouge = flyFree.aBouge;
      stopFlyFree();
      mode = null;
      if(!bouge){
        coordsMouse(e);
        raycaster.setFromCamera(mouse, camCurrent());
        scene.updateMatrixWorld(true);
        const hits = raycaster.intersectObjects(objects, true);
        const pt = hits.length ? hits[0].point : (function(){
          const plan = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
          const p = new THREE.Vector3();
          raycaster.ray.intersectPlane(plan, p);
          return p;
        })();
        const items = itemsCreationContext(function(nouvelObj){
          nouvelObj.position.set(pt.x, Math.max(0, pt.y), pt.z);
        });
        openMenuContext(e.clientX, e.clientY, items);
      }
      return true;
    }
    if(rubberBand.active){
      const etaitDrag = (mode === 'rubber');
      document.getElementById('rubber-band').style.display = 'none';
      if(etaitDrag){
        const trouves = objectsInRect(rubberBand.start, {x:e.clientX, y:e.clientY});
        if(rubberBand.additif) addMultiInBatch(trouves);
        else { select(null); addMultiInBatch(trouves); }
      } else if(!rubberBand.additif){
        select(null);   // plain click sur du vide, sans Shift : comportement inchangé
      }
      rubberBand.active = false;
      mode = null;
      return true;
    }
    return false;
  }
  });
}

addEventListener('pointerup', function(e){
  mode = null;
  if(renderer.domElement.hasPointerCapture && renderer.domElement.hasPointerCapture(e.pointerId)){
    renderer.domElement.releasePointerCapture(e.pointerId);
  }
});

export const CODES_FLY_FREE = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE']);
addEventListener('keydown', function(e){
  if(!flyFree.active) return;
  if(CODES_FLY_FREE.has(e.code)) keysFlyFree.add(e.code);
});
addEventListener('keyup', function(e){
  keysFlyFree.delete(e.code);
});


// ---------- Clavier ----------
addEventListener('keydown', function(e){
  // F1 AVANT le filtre des champs de saisie : une question se pose souvent pendant
  // qu'on remplit un champ, et c'est justement là qu'on ne sait pas quoi y mettre.
  if(e.key === 'F1'){
    e.preventDefault();
    openContextHelp();
    return;
  }
  if(e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA'
     || e.target.isContentEditable) return;
  // UN BOUTON QUI A LE FOCUS GARDE SES TOUCHES. Espace et Entrée l'activent ; Suppr et Retour arrière
  // n'ont rien à faire à la scène. Sans cette garde, Retour arrière sur un bouton du rack ou de
  // l'inspecteur SUPPRIMAIT l'objet sélectionné, et Espace lançait la timeline au lieu d'activer le
  // bouton (revue du 2026-09-29, § 1.5). Les autres raccourcis (Ctrl+Z, 1/2/3, F…) restent actifs :
  // cliquer un bouton de la barre laisse le focus dessus, et ils ne doivent pas mourir pour autant.
  const surBouton = e.target.tagName === 'BUTTON'
    || (e.target.getAttribute && /^(button|slider|tab|menuitem|checkbox)$/.test(e.target.getAttribute('role') || ''));
  if(surBouton && (e.key === ' ' || e.key === 'Enter' || e.key === 'Delete' || e.key === 'Backspace')) return;
  const ctrl = e.ctrlKey || e.metaKey;
  if(ctrl && (e.key === 'z' || e.key === 'Z')){
    e.preventDefault();
    if(e.shiftKey) restore(); else undo();
    return;
  }
  if(ctrl && (e.key === 'y' || e.key === 'Y')){ e.preventDefault(); restore(); return; }
  if(ctrl && (e.key === 'c' || e.key === 'C')){ e.preventDefault(); copySelection(); return; }
  if(ctrl && (e.key === 'v' || e.key === 'V')){ e.preventDefault(); pasteClipBoard(); return; }
  if((e.key === 'd' || e.key === 'D') && ctrl){ e.preventDefault(); duplicateSelection(); return; }
  if(e.key === 'f' || e.key === 'F') frameSelection();
  if(e.key === ' '){
    e.preventDefault();
    togglePlayback();
  }
  if(e.key === '1') setModeGizmo('translate');
  if(e.key === '2') setModeGizmo('rotate');
  if(e.key === '3') setModeGizmo('scale');
  if(e.key === 'Escape'){
    if(modal.classList.contains('open')){ closeModal(); return; }
    if(menuOpen){ closeMenus(); return; }
    if(selectionMulti.length){ clearMulti(); updateHierarchy(); return; }
    quitViewCamera();
  }
  // Le graphe d'états pass AVANT : quand il est à l'écran, Suppr aims ce qu'on y a
  // sélectionné. Sans cette priorité, on supprimerait le personnage en croyant unregister une
  // transition — et l'objet supprimé n'est même pas visible à ce moment-là.
  if((e.key === 'Delete' || e.key === 'Backspace')
     && viewAnimatorActive()){
    if(deleteSelectionGraph()){ buildInspector(); return; }
  }
  if((e.key === 'Delete' || e.key === 'Backspace') && selection) deleteSelection();
});


// ---------- Taille + rendu ----------
export function resize(){
  const w = viewEl.clientWidth, h = viewEl.clientHeight;
  // Un viewport de taille NULLE arrive pour de bon : zone du dock repliée, fenêtre d'édition
  // maximisée par-dessus, onglet caché. `setSize(0, 0)` demande alors à WebGPU une texture de
  // profondeur 0x0 et une swapchain de taille 0 — la console part en boucle d'erreurs de
  // validation (« texture size ... is empty », « Could not create a swapchain texture of size
  // 0 ») et `aspect = 0/0` empoisonne la caméra avec un NaN. On ne touche à rien : le
  // ResizeObserver rappellera resize() dès que la zone reprend une taille.
  if(w <= 0 || h <= 0) return;
  renderer.setSize(w, h);
  // `hPx` et pas `h` pour la hauteur du canvas dans la branche orthographique : la demi-hauteur
  // de vue s'appelle aussi `h`, et la collision de noms est exactement le genre d'erreur
  // qu'aucun test unitaire ne montre.
  if(camEditor.isOrthographicCamera){
    const hPx = h;
    const demi = (camEditor.top - camEditor.bottom) / 2;
    camEditor.left = -demi * (w / hPx); camEditor.right = demi * (w / hPx);
    camEditor.updateProjectionMatrix();
  } else {
    camEditor.aspect = w / h;
    camEditor.updateProjectionMatrix();
  }
  // Une caméra 2D est ORTHOGRAPHIQUE, et `aspect` n'y veut rien dire : l'affectation passait sans
  // error et le frustum restait celui de la construction. En regardant à travers une caméra 2D on
  // avait donc un cadrage juste jusqu'au premier redimensionnement, puis un cadrage faux que rien
  // ne signalait. Le rapport pixel se recalcule ici, par la MÊME fonction que le jeu.
  if(activeCam && activeCam.isOrthographicCamera){
    const n = objects.find(function(o){ return ed(o).cam === activeCam; });
    const comp = cameraSettingOf(n);
    frameOrthoCamera(activeCam, comp, w, h);
  }
  else if(activeCam){ activeCam.aspect = w / h; activeCam.updateProjectionMatrix(); }
}

/**
 * Demande un redimensionnement, appliqué par `loop` JUSTE AVANT son rendu.
 *
 * `renderer.setSize` vide le canvas. Appelé depuis le ResizeObserver, il le vidait entre deux
 * images : le navigateur affichait ce canvas vide, et la vue clignotait pendant tout un
 * redimensionnement. Appliqué dans la boucle, le vidage et le dessin tombent dans la MÊME image —
 * et on redimensionne au plus une fois par image, au lieu d'une fois par notification.
 * (Un rendu forcé dans le callback supprimait aussi le clignotement, mais doublait le coût de
 * rendu pendant le geste : ça saccadait.)
 */
let resizePending = false;
export function requestResize(){ resizePending = true; }

addEventListener('resize', requestResize);
// PAS D'APPEL IMMÉDIAT ICI : `resize()` lit `viewEl`, un `const` de `scene.js`, et ce fichier
// est dans un cycle d'imports avec lui — même raison que `bindViewportCanvas` ci-dessus. Le
// premier appel est différé dans `bindViewportCanvas`, appelée par `startup.js`.

// Le gizmo de vue est construit ici, et pas dans view-gizmo.js : ce fichier est chargé avant le
// DOM du viewport, et un widget construit trop tôt ne trouverait pas son conteneur.
buildViewGizmo();

export const previewFrame = document.getElementById('preview-frame');
// THREE.Clock est déprécié en r185 au profit de Timer, et l'échange n'est PAS un renommage.
// Clock démarrait paresseusement, au premier getDelta() : l'pending asynchrone de
// renderer.init() ne comptait donc pas et la première image valait dt = 0. Timer, lui, démarre
// à sa CONSTRUCTION. Sans amorçage, la première image encaisserait d'un coup toute la durée
// d'initialisation WebGPU (mesuré sur le bundle vendorisé : 3 s d'pending => dt de 3 s) — et
// ici, contrairement au runtime, aucun plafond ne la retient : la caméra en vol libre saute,
// le pas physique intègre trois secondes, et pas une erreur n'est levée.
export const clock = new THREE.Timer();
export let clockPrimed = false;

export function loop(){
  requestAnimationFrame(loop);
  if(!renderer.__ready) return;   // WebGPURenderer.init() pas encore résolu — voir scene.js
  // Amorçage à la première image RÉELLEMENT rendue : c'est ce qui rend à Timer le démarrage
  // paresseux de horloge. reset() doit précéder update() — appelé après, il laisse intact le
  // delta déjà calculé (mesuré).
  if(!clockPrimed){ clock.reset(); clockPrimed = true; }
  let w = viewEl.clientWidth, h = viewEl.clientHeight;
  // update() à chaque image, y compris en pause (⏸ se traite plus bas, par enPause) : c'est
  // lui qui consomme le temps écoulé. Le placer sous une condition ferait rentrer toute la
  // durée de la pause dans le premier dt de la reprise.
  clock.update();
  const dt = clock.getDelta();
  // Redimensionnement demandé (`requestResize`) : appliqué ICI, dans la même image que le rendu.
  if(resizePending){ resizePending = false; resize(); w = viewEl.clientWidth; h = viewEl.clientHeight; }
  // Le gizmo de vue suit l'orientation de la caméra d'édition (ne touche au DOM que si elle a tourné).
  orientViewGizmo(camEditor);

  // Viewport replié/caché (zone du dock fermée, fenêtre maximisée par-dessus) : on ne rend
  // pas. Rendre sur une cible de taille 0 ne produit aucune image, seulement des erreurs de
  // validation WebGPU à chaque frame (« texture size ... is empty », swapchain de taille 0).
  // APRÈS la lecture du temps, comme la cuisson de lightmap juste dessous : sortir plus haut
  // laisserait le temps replié s'accumuler pour ressortir d'un bloc au retour de la vue.
  if(w <= 0 || h <= 0) return;

  // Pendant une cuisson de lightmap, la vue ne rend pas : la cuisson remplace les matériaux
  // par un matériau blanc et rastérise en espace UV, donc une image intercalée ici
  // afficherait CE rendu-là dans la fenêtre d'édition — et lui volerait sa cible de rendu
  // au passage. La vue reste sur sa dernière image, l'avancement passe par la bar d'état.
  //
  // APRÈS la lecture du temps, et c'est tout l'intérêt de l'endroit : sortir plus haut
  // laisserait le temps de la cuisson s'accumuler pour ressortir d'un bloc à la reprise —
  // une cuisson de trente secondes rendrait un dt de trente secondes, la caméra sauterait
  // et la physique intégrerait une demi-minute. C'est le même piège que l'init WebGPU, que
  // l'amorçage de l'horloge traite quelques lignes plus haut (voir test/cadence-timer).
  if(lightmapBakeState.active) return;

  if(flyFree.active && keysFlyFree.size){
    const avant = new THREE.Vector3();
    camEditor.getWorldDirection(avant);
    const right = new THREE.Vector3().crossVectors(avant, camEditor.up).normalize();
    const step = flyFree.speed * dt;
    if(keysFlyFree.has('KeyW')) camEditor.position.addScaledVector(avant, step);
    if(keysFlyFree.has('KeyS')) camEditor.position.addScaledVector(avant, -step);
    if(keysFlyFree.has('KeyD')) camEditor.position.addScaledVector(right, step);
    if(keysFlyFree.has('KeyA')) camEditor.position.addScaledVector(right, -step);
    if(keysFlyFree.has('KeyE')) camEditor.position.y += step;
    if(keysFlyFree.has('KeyQ')) camEditor.position.y -= step;
  }

  if(anim.playback){
    // L'instant d'AVANT est relevé ici, et nulle part ailleurs : c'est le seul endroit du
    // programme qui sache qu'on LIT, par opposition à déplacer la tête de lecture à la main.
    // Les marqueurs d'animation en dépendent — un scrub ne doit rien déclencher.
    const tBefore = anim.t;
    anim.t += dt;
    if(anim.t >= anim.duration){
      if(anim.loop) anim.t = anim.t % anim.duration;
      else { anim.t = anim.duration; anim.playback = false; btnPlayback.textContent = '▶'; }
    }
    applyAnimation(anim.t);
    triggerMarkersOfClipShown(tBefore, anim.t);
    updatePlayhead();
  }
  // les scripts tournent pendant la lecture ou la simulation ; poses restaurées à l'arrêt.
  // Ordre inchangé par rapport à l'ancien moteur : les scripts appliquent leurs
  // entrées (api.applyForce/placer…) AVANT le pas physique, qui les intègre
  // puis resynchronise les poses ; inverser casserait le temps de réponse des
  // scripts d'une image (voir physics.js: syncPhysics).
  //
  // CHAQUE POSTE EST ISOLÉ. `System.runFrame` isolait ses trois Systèmes ; les travaux d'image
  // appelés impérativement ici, non — une exception dans un script, dans la physique ou dans un
  // animator interrompait TOUTE la fin de l'image : plus de rendu, plus de gizmo, plus de
  // grille. Le symptôme est « l'éditeur est gelé », et il ne désigne pas le coupable.
  // `System.isolate` journalise une fois par poste (pas soixante fois par seconde) et laisse la
  // suite de l'image tourner. Voir docs/REVUE_2026-09-10.md § 3.4.
  depthStart('scripts');
  if(anim.playback || phys.active) System.isolate('Scripts', function(){ SystemScripts.update(dt); });
  else if(!anim.playback && !phys.active) stopScripts();
  // animations des modèles importés : même horloge que le reste
  // La machine à états DÉCIDE avant que les mixeurs n'avancent. Dans l'autre ordre, un
  // changement d'état ne prendrait effet qu'à l'image suivante, et une transition « attendre
  // la fin du clip » raterait sa fenêtre d'une image à chaque passage.
  System.isolate('Animator', function(){ updateAnimators(dt); });
  refreshStateCurrent();
  System.isolate('Animations de modèles', function(){ updateAnimationsModels(dt); });
  // Les ANIMATIONS DE SPRITES et le TRI 2D ne sont plus appelés ici : ce sont des Systèmes
  // (js/systems/sprite-system.js), lancés par `System.runFrame` plus bas — les mêmes que le jeu.
  depthEnd('scripts');
  depthStart('physics');
  System.isolate('Physique', function(){ SystemPhysics.update(dt, false); });
  // NI PHYSIQUE 2D NI SUIVI DE CAMÉRA 2D ICI : ils ne tournent qu'en jeu, c'est-à-dire dans le
  // runtime (game-preview.html, js/game-runtime.js). La physique 2D en édition ferait tomber les
  // objets pendant qu'on les place — le monde 3D fait déjà le même choix. Les branches qui les
  // appelaient ici étaient gardées par l'ancien drapeau de mode lecture en page, qui ne devenait
  // jamais vrai : du code injoignable, retiré (docs/REVUE_2026-09-29.md § 6.1). La commande
  // play_and_measure les fait tourner pour de vrai quand on veut les mesurer.
  // LES SYSTEMES, une fois par image et pour les deux moteurs : c'est ici que le travail
  // par composant se fait, au lieu d'une boucle ad hoc par sujet doublée d'un miroir dans le
  // jeu publié. Après la physique, avant le rendu : le cadrage doit voir les positions finales.
  System.runFrame(dt, { mode: 'edit', width: w, height: h });
  depthEnd('physics');
  depthStart('particles');
  System.isolate('Particules', function(){ SystemParticles.update(Math.min(dt, 0.05)); });
  depthEnd('particles');

  helpers.forEach(function(hp){ if(hp.update) hp.update(); });

  // Niveau de détail puis resynchronisation des lots — dans CET ordre : le LOD décide
  // qui doit disparaître, la resynchronisation l'applique aux objets regroupés. L'inverse
  // afficherait le décor lointain pendant une image de plus.
  // Poste séparé dans le profiler, et pas fondu dans « rendu » : tout l'intérêt du
  // regroupement est qu'il coûte moins que ce qu'il économise, et on ne peut le vérifier
  // que si les deux se lisent séparément.
  depthStart('instances');
  // LE REGROUPEMENT TOURNE AUSSI EN ÉDITION. Ses appels étaient autrefois gardés par le drapeau
  // du mode lecture en page, qui ne devenait plus jamais vrai : le regroupement était du code mort
  // dans l'outil où l'on passe ses journées. Mesuré sur 5 000 objets avant de le brancher : 341
  // appels de dessin pour la portion visible, 11,69 ms de CPU par image rien qu'à les
  // encoder.
  //
  // Le LOD, lui, reste au jeu publié : voir l'en-tête de js/editor-batching.js. Faire
  // disparaître le décor lointain pendant qu'on le pose serait une régression.
  System.isolate('Regroupement', function(){
    // `anim.playback || phys.active` : les deux seules choses qui déplacent un objet sans
    // qu'on y touche. Ce dernier argument décide si les lots ont besoin d'être
    // resynchronisés cette image — voir `updateEditorBatching` pour pourquoi la condition
    // est exacte, et pas prudentielle.
    updateEditorBatching(scene, objects, allSelection(), undefined,
      anim.playback || phys.active);
  });
  depthEnd('instances');

  // LA MANETTE, À CHAQUE IMAGE ET SANS CONDITION. Elle pose ses boutons dans le MÊME jeu de
  // touches que le clavier (js/gamepad-input.js) : tout ce qui lit une action la voit donc
  // sans le savoir. La lire même à l'arrêt n'a aucun effet de bord — une touche `pad:0` n'est
  // le raccourci d'aucune commande d'éditeur — et c'est ce qui permet au panneau Entrées
  // d'afficher « manette branchée » en direct pendant qu'on configure ses liaisons.
  if(typeof pollGamepads === 'function') pollGamepads(keysGame, inputsCurrent());

  clearTouchControls();

  // synchronise le bit THREE.Layers de chaque objet sur son calque de projet, pour que
  // le masque camMask (userData.game.camMask) d'une caméra puisse filtrer le rendu.
  //
  // SEULS LES NŒUDS MARQUÉS, et plus la scène entière à chaque image. La liste de travail vit
  // dans objects.js (`markLayersDirty` / `takeLayersDirty`) et se remplit aux trois moments où
  // un calque peut changer : l'entrée d'un nœud dans la scène, l'écriture du champ Calque, et
  // une restructuration de masse. La liste est presque toujours vide — c'est le but.
  // Voir docs/REVUE_2026-09-10.md § 2.3.
  System.isolate('Calques', function(){ takeLayersDirty().forEach(applyProjectLayer); });

  // La grille de sol SUIT la caméra (et s'éteint sur préférence) : js/grid-floor.js. Ici et
  // pas dans une commande, parce qu'elle dépend de la caméra courante, qui change à chaque image.
  setGrid(updateFloorGrid(scene, grid, camCurrent(), orbit.dist,
    Prefs.get('grid.visible') !== false));

  // Les ombres suivent la CAMÉRA COURANTE, et se recadrent donc juste avant le rendu — pas
  // sur la caméra d'édition quand on regarde à travers une caméra de jeu. C'est ce qui fait
  // que la vue de scène et le mode Lecture montrent la même chose.
  updateShadows(camCurrent());

  depthStart('render');
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, w, h);
  // Le ciel suit le TYPE de la caméra courante (voir backgroundForCamera, environment.js) :
  // chaque image, parce qu'on bascule entre vue 3D, vue 2D et caméra de jeu à tout moment.
  // `globalThis.skyBackground` (posé par environment.js) et non un import : importer
  // environment.js ici déplace l'ordre d'évaluation du cycle viewport ↔ scene (KNOWN_ISSUES v0.178.1).
  if(isSkyBackground(scene.background, globalThis.skyBackground))
    scene.background = backgroundForCamera(globalThis.skyBackground, camCurrent());
  if(postActive()) postRender(scene, camCurrent(), w, h, clock.getElapsed());
  else renderer.render(scene, camCurrent());
  depthEnd('render');

  if(previewCam){
    const pw = Math.round(Math.min(320, w * 0.3));
    const ph = Math.round(pw * 9 / 16);
    previewCam.aspect = pw / ph;
    previewCam.updateProjectionMatrix();
    renderer.setScissorTest(true);
    // y DEPUIS LE HAUT : c'est la convention de WebGPURenderer (celle de WebGL était depuis le
    // bas). Avec `12`, l'aperçu était dessiné en HAUT à droite, loin de son cadre `#preview-frame`
    // posé en bas (css/panels.css) — la vue jeu, juste en dessous, compte déjà ainsi.
    const py = h - ph - 12;
    renderer.setScissor(w - pw - 12, py, pw, ph);
    renderer.setViewport(w - pw - 12, py, pw, ph);
    renderer.render(scene, previewCam);
    renderer.setScissorTest(false);
    previewFrame.style.width = pw + 'px';
    previewFrame.style.height = ph + 'px';
  }

  depthFrame(dt);
}


// ---------- Le panneau bas n'a plus ses propres onglets ----------
// Projet et Console sont deux PANNEAUX du dock (js/ui/panels-shell.js) : c'est lui qui rend
// leur barre d'onglets, montre l'un et cache l'autre, et déplace leur barre d'outils. Deux
// barres d'onglets superposées pour le même choix, c'était le doublon à retirer.
export const animBody = document.getElementById('anim-body');


// EXPOSÉ EN GLOBALE, à dessein. Ces symboles sont appelés depuis des fichiers
// que les mêmes pages ne chargent pas toutes : un `import` y pointerait un
// fichier absent, et la page ne démarrerait pas. Ils gardent donc leur garde
// `typeof` côté appelant, et se déclarent ici.
globalThis.clock = clock;
globalThis.clockPrimed = clockPrimed;
globalThis.isIconEdit = isIconEdit;
globalThis.loop = loop;
globalThis.mode = mode;
globalThis.mouse = mouse;
globalThis.resize = resize;