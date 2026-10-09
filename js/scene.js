import { engineAudio } from './audio.js';
import { DrawMode } from './draw-mode.js';
import { createEditorCamera } from './editor-camera.js';
import { createFloorGrid } from './grid-floor.js';
import { pushHistory } from './history.js';
import { syncInspector } from './inspector.js';
import { listMats, objects } from './objects.js';
import { project } from './project.js';
import { selection, selectionMulti } from './selection.js';
import { ShadowFit } from './shadow-fit.js';
import { Icons } from './ui/icon.js';
import { ppu2dOfProject, snapCameraOnPixel, viewGizmo } from './view-gizmo.js';
import { camCurrent } from './viewport.js';

"use strict";


// ---------- Scène ----------
export const viewEl = document.getElementById('view');
export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14161a);
scene.fog = new THREE.Fog(0x14161a, 40, 250);

// `let` et pas `const` : la bascule perspective/orthographique REMPLACE la caméra (deux
// classes three distinctes), elle ne la reconfigure pas.
export let camEditor = createEditorCamera();
export const LAYER_HELPERS = 31;   // bit réservé (three.js Layers va de 0 à 31) : gizmo, helpers, sol, grille

/**
 * Remplace la caméra d'édition ET tout ce qui en tenait une référence.
 *
 * Trois sites la capturent par valeur — `new THREE.TransformControls(camEditor, …)` (plus bas),
 * `tc.camera = camEditor` (inspector.js, view-2d.js) et `camEditor.add(engineAudio.listener)`
 * (audio.js). Sans ce recâblage, l'échange de projection laisse le gizmo et l'écouteur audio sur
 * une caméra qui n'est plus rendue, et rien ne le signale.
 */
export function setEditorCamera(c){
  if(typeof tc !== 'undefined' && tc) tc.camera = c;
  if(engineAudio && engineAudio.listener){
    camEditor.remove(engineAudio.listener);
    c.add(engineAudio.listener);
  }
  camEditor = c;
  return c;
}
export let activeCam = null;
export let previewCam = null;

// Un `export let` ne se réassigne QUE depuis ce fichier — un autre module qui écrit
// `activeCam = ...` directement lève une `TypeError: Assignment to constant variable`, le
// binding d'import étant en lecture seule. Ces accesseurs sont le seul point d'écriture externe.
export function setActiveCam(c){ activeCam = c; }
export function setPreviewCam(c){ previewCam = c; }

// WebGPURenderer (repli WebGL2 automatique intégré à three.js si WebGPU indisponible) —
// nécessaire pour les matériaux/post-traitement TSL. Voir js/render-webgpu-bridge.mjs et
// docs/superpowers/specs/2026-08-06-fondation-webgpu-tsl-design.md. renderer.init() est
// asynchrone et render() n'attend PAS en interne (constaté : "render() called before the
// backend is initialized" tant que renderer.__pret n'est pas vrai) — loop() (viewport.js)
// doit vérifier ce drapeau avant d'appeler renderer.render().
export const renderer = new THREE.WebGPURenderer({antialias:true});
renderer.__ready = (typeof renderer.init !== 'function');
if(typeof renderer.init === 'function'){
  renderer.init().then(function(){ renderer.__ready = true; });
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
// PCFSoftShadowMap est deprecie en r185 et three retombe de toute facon sur PCFShadowMap :
// on l ecrit explicitement plutot que de laisser un repli silencieux. Les ombres sont donc
// un cran plus dures qu en r128. VSMShadowMap redonnerait du flou mais apporte ses propres
// artefacts (fuite de lumiere) et demande un reglage de flou : a evaluer, pas a subir.
renderer.shadowMap.type = THREE.PCFShadowMap;
viewEl.appendChild(renderer.domElement);

export const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x30281e, 0.4);
scene.add(hemi);
export const sun = new THREE.DirectionalLight(0xffffff, 0.55);
sun.position.set(8, 14, 6);
// Ce soleil est l'ÉCLAIRAGE GLOBAL de l'environnement (réglage `env.sun`, panneau
// Environnement) : il n'a pas de composant, n'apparaît pas dans la hiérarchie, et existe sur
// TOUTE scène. Lui laisser `castShadow = true` faisait projeter une ombre par un objet
// invisible dans le projet, en plus de celle d'un composant Light directionnel qu'on ajoute
// soi-même — deux ombres décalées pour un seul soleil apparent, sans qu'aucune des deux ne
// se désactive. Les ombres doivent venir UNIQUEMENT d'une lumière posée comme composant
// (component-light.js) : c'est elle que l'utilisateur voit, choisit et règle.
sun.castShadow = false;

scene.add(sun);

// `let` : dans le repli sans TSL, la grille se RECONSTRUIT quand le pas change de décade
// (js/grid-floor.js). Tout ce qui la référence doit passer par cette variable, jamais par une
// copie gardée de côté.
export let grid = createFloorGrid();
scene.add(grid);
grid.layers.set(LAYER_HELPERS);

// Même raison que `setActiveCam`/`setPreviewCam` plus haut : `viewport.js` remplace la grille
// (reconstruite au changement de décade) et ne peut pas écrire `grid = ...` directement dessus.
export function setGrid(g){ grid = g; }


// ---------- Caméra orbitale éditeur ----------
export const orbit = {target:new THREE.Vector3(0,1,0), theta:Math.PI/4, phi:Math.PI/3.2, dist:14,
               aligned:false};   // `aligned` : vue posée par le gizmo, clamp d'élévation levé
// Bornes de l'élévation orbitale — partagées avec stopFlyFree() (viewport.js). Alignées
// EXACTEMENT sur la plage de tangage du vol libre (pitch = phi - PI/2, clamp (-PI/2+0.05,
// PI/2-0.05) dans viewport.js) : avec l'ancienne clamped max (PI/2-0.02), l'orbite ne pouvait
// jamais regarder au-dessus de l'horizon (pitch max ≈ -0.02) alors que le vol libre le permet
// largement (jusqu'à ~+87°) — regarder simplement vers le haut en vol libre puis relâcher le
// clic droit forçait un saut de rotation instantané pour retomber dans l'ancienne plage.
// Élargie ici à (PI-0.05) : l'orbite couvre désormais toute la plage que le vol libre peut
// atteindre, donc plus aucun clamp n'est jamais nécessaire à la sortie du vol libre.
export const ORBIT_PHI_MIN = 0.05, ORBIT_PHI_MAX = Math.PI - 0.05;
export function updateCamera(){
  // Une vue ALIGNÉE (gizmo) atteint phi = 0 (Dessus) ou phi = π (Dessous) : le clamp de l'orbite
  // libre les interdit, et c'est précisément lui qui rendait ces deux vues impossibles. On ne le
  // lève QUE dans ce cas — un cerf-volant en orbite libre resterait sinon coincé au pôle.
  if(orbit.aligned) orbit.phi = Math.max(0, Math.min(Math.PI, orbit.phi));
  else orbit.phi = Math.max(ORBIT_PHI_MIN, Math.min(ORBIT_PHI_MAX, orbit.phi));
  // En orthographique la distance ne décide plus du cadrage (le frustum seul compte) : le clamp
  // [3, 70] y interdirait le zoom fin que demande le calage sur le pixel, sans rien protéger.
  if(camEditor.isOrthographicCamera) orbit.dist = Math.max(0.01, orbit.dist);
  else orbit.dist = Math.max(3, Math.min(70, orbit.dist));
  const sp = Math.sin(orbit.phi), cp = Math.cos(orbit.phi);
  camEditor.position.set(
    orbit.target.x + orbit.dist*sp*Math.sin(orbit.theta),
    orbit.target.y + orbit.dist*cp,
    orbit.target.z + orbit.dist*sp*Math.cos(orbit.theta)
  );
  // Le calage sur la grille de pixels, en vue orthographique : sans lui les bords des sprites
  // scintillent d'une image à l'autre. Le même remède que le cadrage 2D appliquait.
  if(viewGizmo.pixelSnap && camEditor.isOrthographicCamera){
    const ppu = ppu2dOfProject();
    camEditor.position.x = snapCameraOnPixel(camEditor.position.x, ppu);
    camEditor.position.y = snapCameraOnPixel(camEditor.position.y, ppu);
  }
  // `up` bascule sur +Z quand le regard devient colinéaire à +Y : `lookAt` produit sinon un
  // quaternion dégénéré, et la vue de dessus tourne au hasard d'une fois sur l'autre.
  if(Math.abs(sp) < 1e-3) camEditor.up.set(0, 0, 1);
  else camEditor.up.set(0, 1, 0);
  camEditor.lookAt(orbit.target);
}
updateCamera();


// ---------- Gizmo de transformation ----------
export const tc = new THREE.TransformControls(camEditor, renderer.domElement);
tc.setSize(0.9);
// Depuis three r16x, TransformControls n'est PLUS un Object3D : c'est un contrôleur
// (classe Controls), et sa représentation visuelle s'obtient par getHelper(). C'est le
// helper qu'on ajoute à la scène, qu'on range dans le calque des aides et contre lequel
// on lance un raycast ; le contrôleur, lui, garde attach/detach/setMode/setSpace.
// `scene.add(tc)` ne lève pas une erreur anodine : elle interrompt l'évaluation de ce
// fichier, et tout ce qui est déclaré plus bas — à commencer par targetRealView — reste
// dans sa zone morte. Créer un objet échouait alors sur un message sans rapport.
export const tcVisual = tc.getHelper();
scene.add(tcVisual);
tcVisual.layers.set(LAYER_HELPERS);
tcVisual.traverse(function(x){ x.layers.set(LAYER_HELPERS); });
// Le raycaster interne de TransformControls (prive au module, jamais expose) reste sur le
// masque de calque par defaut (bit 0 uniquement) : rien ne l'avise de LAYER_HELPERS. En ne
// laissant les pickers (poignees de detection) et le plan de drag que sur le calque 31, on
// les rend invisibles a CE raycast-la — plus aucune poignee ne repond au clic, le gizmo
// reste affiche mais mort (voir tc.pointerHover/pointerDown dans le bundle vendorise). Leur
// materiau est deja invisible (visible:false) : leur rajouter le calque 0 ne les fait pas
// apparaitre pour une camera de jeu, seulement les rendre de nouveau raycastables par TC.
[tc._plane, tc._gizmo.picker.translate, tc._gizmo.picker.rotate, tc._gizmo.picker.scale].forEach(function(o){
  o.layers.enable(0);
  o.traverse(function(x){ x.layers.enable(0); });
});

// Proxy pour l'espace "Vue" : TransformControls n'a pas d'espace view natif (setSpace ne
// gère que 'local'/'world', et force 'local' en mode Échelle). Le proxy est orienté comme
// la caméra ; le gizmo agit sur LUI en espace local, puis le delta résultant est réappliqué
// à la vraie sélection (et au reste du groupe multi-sélectionné) en espace monde.
export const proxyView = new THREE.Object3D();
proxyView.visible = false;
proxyView.raycast = function(){};
scene.add(proxyView);
proxyView.layers.set(LAYER_HELPERS);
export let targetRealView = null;   // objet réellement sélectionné, pendant que le proxy est active

export function gizmoAttach(obj){
  targetRealView = null;
  if(!obj){ tc.detach(); return; }
  if(gizmo.space !== 'view'){ tc.attach(obj); return; }
  targetRealView = obj;
  proxyView.position.copy(obj.getWorldPosition(new THREE.Vector3()));
  proxyView.quaternion.copy(camCurrent().quaternion);
  tc.attach(proxyView);
}

/** Ré-arme le gizmo sur la sélection courante. Existe pour que js/readonly-ui.js n'ait pas à
 *  importer selection.js : il importe déjà scene.js, et selection.js importe objects.js, qui
 *  importe readonly-ui.js — le cycle passerait par trois modules avant de se voir. */
export function gizmoSyncSelection(){ gizmoAttach(selection); }

// gizmo + multi-sélection : les secondaires suivent le delta du principal
export let gizmoGroup = null;
export let projectionViewBefore = null;   // instantané du proxy + de la vraie cible au début d'un drag "Vue"
tc.addEventListener('dragging-changed', function(e){
  const target = targetRealView || selection;
  if(e.value){
    pushHistory();
    if(targetRealView){
      projectionViewBefore = {
        proxyQuat0: proxyView.quaternion.clone(),
        objQuat0: targetRealView.getWorldQuaternion(new THREE.Quaternion())
      };
    } else {
      projectionViewBefore = null;
    }
    if(target && selectionMulti.length){
      gizmoGroup = {
        posW: target.getWorldPosition(new THREE.Vector3()),
        quat: target.quaternion.clone(),
        ech:  target.scale.clone(),
        objs: selectionMulti.map(function(o){
          return {obj:o,
            posW0:o.getWorldPosition(new THREE.Vector3()),
            quat0:o.quaternion.clone(),
            ech0:o.scale.clone()};
        })
      };
    } else gizmoGroup = null;
  } else {
    gizmoGroup = null;
    projectionViewBefore = null;
    syncInspector();
  }
});
tc.addEventListener('objectChange', function(){
  // Un nœud de modèle déplacé au gizmo devient un override (js/model-nodes.js).
  if(typeof markModelNodeEdited === 'function'){
    markModelNodeEdited(targetRealView || selection);
    if(gizmoGroup) gizmoGroup.objs.forEach(function(s){ markModelNodeEdited(s.obj); });
  }
  if(targetRealView){
    // translation : le proxy (sans parent, donc position monde = position locale) donne
    // directement la nouvelle position monde voulue pour le vrai objet.
    const posWNeuve = proxyView.position.clone();
    targetRealView.position.copy(targetRealView.parent.worldToLocal(posWNeuve.clone()));
    // rotation : delta monde du proxy depuis le début du drag, réappliqué à l'orientation
    // monde d'origine du vrai objet (le proxy, lui, a été initialisé sur l'orientation caméra).
    let dQuat = new THREE.Quaternion();
    if(projectionViewBefore){
      dQuat = proxyView.quaternion.clone().multiply(projectionViewBefore.proxyQuat0.clone().invert());
      targetRealView.quaternion.copy(dQuat.clone().multiply(projectionViewBefore.objQuat0));
    }
    if(gizmoGroup){
      const dPos = posWNeuve.clone().sub(gizmoGroup.posW);
      gizmoGroup.objs.forEach(function(s){
        s.obj.position.copy(s.obj.parent.worldToLocal(s.posW0.clone().add(dPos)));
        s.obj.quaternion.copy(dQuat.clone().multiply(s.quat0));
      });
    }
    syncInspector();
    return;
  }
  if(gizmoGroup && selection){
    const posW = selection.getWorldPosition(new THREE.Vector3());
    const dPos = posW.clone().sub(gizmoGroup.posW);
    const dQuat = selection.quaternion.clone().multiply(gizmoGroup.quat.clone().invert());
    const rx = gizmoGroup.ech.x ? selection.scale.x / gizmoGroup.ech.x : 1;
    const ry = gizmoGroup.ech.y ? selection.scale.y / gizmoGroup.ech.y : 1;
    const rz = gizmoGroup.ech.z ? selection.scale.z / gizmoGroup.ech.z : 1;
    gizmoGroup.objs.forEach(function(s){
      s.obj.position.copy(s.obj.parent.worldToLocal(s.posW0.clone().add(dPos)));
      s.obj.quaternion.copy(dQuat.clone().multiply(s.quat0));
      s.obj.scale.set(s.ech0.x * rx, s.ech0.y * ry, s.ech0.z * rz);
    });
  }
  syncInspector();
});

export const gizmo = {space: 'local'};   // 'local' | 'world' | 'view' — 'view' est simulé, voir plus bas

export function setModeGizmo(m){
  tc.setMode(m);
  ['translate','rotate','scale'].forEach(function(x){
    const b = document.getElementById('g-' + x);
    if(b) b.classList.toggle('active', x === m);
  });
  applySpaceGizmo();
}

export function applySpaceGizmo(){
  const sel = document.getElementById('g-space');
  const inScale = (tc.mode === 'scale');
  sel.disabled = inScale;
  // Contrainte de TransformControls, pas un choix : l'échelle n'a de sens qu'en local.
  sel.title = inScale ? 'Le mode Échelle impose l\'espace local' : 'Référentiel du gizmo';
  const voulu = inScale ? 'local' : sel.value;
  gizmo.space = voulu;
  tc.setSpace(voulu === 'world' ? 'world' : 'local');   // 'view' tourne en 'local' + proxy
  gizmoAttach(targetRealView || selection || null);   // re-sélectionne selon le nouvel espace
}
document.getElementById('g-space').addEventListener('change', applySpaceGizmo);
document.getElementById('g-translate').addEventListener('click', () => setModeGizmo('translate'));
document.getElementById('g-rotate').addEventListener('click', () => setModeGizmo('rotate'));
document.getElementById('g-scale').addEventListener('click', () => setModeGizmo('scale'));


// ---------- Filtres d'affichage (fil de fer, ombres, textures, shaders) ----------
// `wireframe` n'est plus une bascule : c'est un MODE d'affichage (js/draw-mode.js). Le garder
// ici en aurait fait deux commandes pour un seul effet, dont l'une pouvait contredire l'autre.
export const filters = {shadows:true, textures:true, shaders:true};
// Le mode d'affichage courant (js/draw-mode.js). État de SESSION, jamais sérialisé : c'est un
// outil de diagnostic, pas une propriété de la scène — publier un projet en « Éclairage seul »
// n'aurait aucun sens.
export let drawMode = (typeof DrawMode !== 'undefined') ? DrawMode.DEFAULT : 'shaded';

// LA pile de substitution, unique. Par MESH : c'est le mesh qui porte la substitution, et deux
// meshes peuvent partager le même matériau. `key` retient l'empreinte d'affichage sous laquelle
// le substitut a été fabriqué — sans elle, on le reconstruirait par image.
export const cacheDisplay = new WeakMap();
// Matériau à nœuds mis de côté pendant que le filtre « Shaders » est coupé — par MESH et non
// par matériau : c'est le mesh qui porte la substitution, et deux meshes peuvent partager le
// même matériau de graphe.
// Les cartes qu'un matériau peut porter. Toutes sont retirées ensemble : couper `map` seule
// laissait le relief et l'émissif peindre le détail qu'on cherchait justement à faire taire.
export const MAPS_OF_MATERIAL = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap',
                          'aoMap', 'bumpMap', 'displacementMap', 'alphaMap', 'lightMap'];

/** Ce que `DrawMode.planFor` a besoin de savoir d'un matériau, sans le lui donner. */
export function infoOfMaterial(m){
  return {
    isNodeMaterial: !!(m && m.isNodeMaterial),
    hasMaps: !!(m && MAPS_OF_MATERIAL.some(function(k){ return m[k]; }))
  };
}

/**
 * Fabrique le matériau qu'un plan décrit, ou rend l'original quand il n'y a rien à faire.
 *
 * Un CLONE neuf à chaque fois, jamais une mutation de l'original : sous le renderer WebGPU,
 * retoucher un matériau déjà compilé laisse derrière lui des bindings qui référencent ce
 * qu'on vient d'enlever — c'est ce qui plantait la boucle de rendu quand on coupait les
 * textures ou les reflets du ciel.
 */
export function materialForPlan(m, plan){
  if(!m || plan.keep) return m;
  if(plan.white){
    // Blanc MAT : ni métal ni brillance, sinon les reflets spéculaires se lisent comme de la
    // lumière alors qu'ils viennent du matériau — exactement ce que ce mode sert à séparer.
    return new THREE.MeshStandardMaterial({color: 0xffffff, roughness: 1, metalness: 0});
  }
  if(plan.unlit){
    // `MeshBasicMaterial` : aucune lumière, aucune ombre. On garde la couleur et la carte de
    // base quand elles existent, parce que c'est justement ce qu'on veut regarder.
    const basic = new THREE.MeshBasicMaterial({
      color: (m.color && m.color.getHex) ? m.color.getHex() : 0xffffff,
      wireframe: !!plan.wireframe
    });
    if(!plan.wireframe && !plan.stripMaps && m.map) basic.map = m.map;
    return basic;
  }
  if(plan.neutralShader && plan.stripMaps) return materialWithoutShader();
  if(plan.neutralShader) return materialWithoutShader();
  if(plan.stripMaps){
    const clone = m.clone();
    MAPS_OF_MATERIAL.forEach(function(k){ if(k in clone) clone[k] = null; });
    return clone;
  }
  return m;
}

/**
 * Applique le mode d'affichage et les bascules à UN mesh.
 *
 * Remplace les deux mécanismes qui vivaient ici — un pour les shaders, un pour les textures —
 * et qui se substituaient l'un par-dessus l'autre : le second mémorisait le substitut du
 * premier comme « l'original », de sorte que rétablir les textures rendait à l'objet le
 * matériau neutre du filtre Shaders au lieu du sien. Une seule pile ne peut plus faire ça.
 */
export function applyDisplay(o){
  const key = DrawMode.keyOf(drawMode, filters);
  const held = cacheDisplay.get(o);
  // Un matériau affecté PENDANT que la substitution est en place remplace le substitut : le
  // mis de côté ne décrit plus l'objet, et le rétablir écraserait ce qu'on vient de poser.
  const valid = held && held.substitute === o.material;

  if(held && (!valid || held.key !== key)){
    if(valid) o.material = held.original;
    disposeSubstitute(held.substitute);
    cacheDisplay.delete(o);
  } else if(valid){
    return;                       // déjà dans le bon état : rien à refaire, surtout pas un clone
  }

  const build = function(m){ return materialForPlan(m, DrawMode.planFor(drawMode, filters, infoOfMaterial(m))); };
  const substitute = Array.isArray(o.material) ? o.material.map(build) : build(o.material);
  const changed = Array.isArray(substitute)
    ? substitute.some(function(m, i){ return m !== o.material[i]; })
    : substitute !== o.material;
  if(!changed) return;            // le cas courant : aucun clone fabriqué, aucun cache posé
  cacheDisplay.set(o, {original: o.material, substitute: substitute, key: key});
  o.material = substitute;
}

export function disposeSubstitute(s){
  const list = Array.isArray(s) ? s : [s];
  list.forEach(function(m){ if(m && m.dispose) m.dispose(); });
}

// Substitut neutre d'un matériau à graphe : le même repli que celui d'un `shaderId` pointant
// dans le vide (materiaux.js), pour que « shaders coupés » ait exactement l'aspect connu.
export function materialWithoutShader(){
  return new THREE.MeshStandardMaterial({color:0x8899aa, roughness:0.65, metalness:0.05});
}

// Coupe (ou rétablit) les matériaux à nœuds sur un mesh. Le matériau du graphe est GARDÉ tel
// quel — on ne le reconstruit pas au rétablissement, ce qui préserverait aussi bien ses
// textures que ses propriétés de matériau instance.
// ---------- LES OMBRES SUIVENT LA CAMÉRA ----------
//
// LE MODÈLE, celui d'Unity. Une carte d'ombre a une résolution fixe. La cadrer sur la SCÈNE
// entière — ce que faisait la première version de ce code — donne l'inverse de ce qu'on veut :
// plus le niveau est grand, plus chaque texte couvre de terrain, et plus les ombres sont molles
// PARTOUT, y compris sous les pieds du joueur. La cadrer sur ce que la CAMÉRA voit, plafonné
// par la portée du projet, concentre toute la résolution là où on regarde : net de près, et
// plus d'ombre du tout au-delà de la portée, ce qui est franc et lisible.
//
// CE QU'ON DÉPLACE, ET CE QU'ON NE DÉPLACE PAS. `DirectionalLightShadow` place sa caméra
// d'ombre À la lumière et la fait regarder sa cible : pour recentrer la carte, il faut donc
// déplacer la lumière. Mais la lumière VISIBLE est un repère que l'utilisateur a posé et
// oriente à la main. On ne touche donc jamais ce repère — on déplace l'objet `THREE.Light`
// qu'il contient, et sa cible, du MÊME vecteur : la direction est préservée au bit près, et
// une lumière directionnelle ne dépend que de sa direction. Rien ne bouge à l'écran, sauf
// l'ombre qui se recadre.
export const _shadowSphereCorners = [];
for(let i = 0; i < 8; i++) _shadowSphereCorners.push(new THREE.Vector3());
export const _shadowDir = new THREE.Vector3();
export const _shadowCenter = new THREE.Vector3();
export const _shadowLightPos = new THREE.Vector3();
export const _shadowTargetPos = new THREE.Vector3();
export const _shadowInv = new THREE.Matrix4();
export const _shadowView = new THREE.Matrix4();
export const _shadowInvView = new THREE.Matrix4();
export const UP_SHADOW = new THREE.Vector3(0, 1, 0);
// La marge de profondeur : ce qui est DERRIÈRE la sphère visible mais projette dedans (un mur
// hors champ dont l'ombre tombe sur la scène). Sans elle, ces projeteurs sont coupés par le
// plan proche et leur ombre disparaît d'un coup quand on tourne la caméra.
export const MARGIN_SHADOW = 60;

/**
 * Les huit coins du frustum visible, en monde, tronqué à la portée des ombres.
 *
 * On ne prend PAS le `far` de la caméra : une caméra de jeu porte souvent à 1000 unités, et
 * cadrer l'ombre là-dessus la rendrait inutile. C'est la portée du projet qui décide jusqu'où
 * les ombres existent — au-delà, il n'y en a simplement plus.
 */
export function frustumCornersOf(camera, distance){
  _shadowInv.copy(camera.projectionMatrix).invert();
  let i = 0;
  for(const z of [ShadowFit.nearNdcZ(camera), 1]){
    for(const y of [-1, 1]){
      for(const x of [-1, 1]){
        // Les coins sont obtenus en espace de CLIP puis ramenés en monde : c'est la seule
        // méthode qui reste juste en perspective comme en orthographique, et qui suit une
        // caméra dont on a changé le champ ou le zoom sans le dire à personne.
        _shadowSphereCorners[i].set(x, y, z)
          .applyMatrix4(_shadowInv)
          .applyMatrix4(camera.matrixWorld);
        i++;
      }
    }
  }
  // Le plan lointain est ramené sur la portée : on interpole chaque coin lointain vers son
  // coin proche. Sans ça, la sphère engloberait tout le champ de la caméra.
  ShadowFit.clampDepth(_shadowSphereCorners, camera, distance);
  return _shadowSphereCorners;
}

/**
 * Recadre l'ombre de chaque directionnelle sur ce que voit `camera`.
 *
 * Appelée PAR IMAGE, et c'est assumé : le calcul est de huit points et une racine carrée, et
 * la carte doit suivre la caméra sous peine de laisser une bande sans ombre derrière elle.
 */
export function updateShadows(camera){
  if(typeof ShadowFit === 'undefined' || !camera) return;
  const distance = (project.settings
    && project.settings.shadowDistance) || 60;
  const corners = frustumCornersOf(camera, distance);
  const sphere = ShadowFit.frustumSphere(corners);
  _shadowCenter.set(sphere.center.x, sphere.center.y, sphere.center.z);

  scene.traverse(function(l){
    if(!l.isDirectionalLight || !l.castShadow || !l.shadow || !l.shadow.camera) return;
    // Réglages imposés par le composant Light (configure_light), sinon automatiques.
    const st = ShadowFit.lightSettings(l.userData.shadowSettings,
      (project.settings && project.settings.shadowMapSize) || 2048, sphere.radius);
    const wanted = st.mapSize;
    // CHANGER LA RÉSOLUTION EXIGE DE JETER LA CARTE. `mapSize` n'est lu qu'à l'allocation :
    // l'écrire sur une lumière déjà rendue ne fait rien du tout, et le réglage semble sans
    // effet — trois.js garde la texture qu'il a déjà, à l'ancienne taille.
    if(l.shadow.mapSize.x !== wanted){
      l.shadow.mapSize.set(wanted, wanted);
      if(l.shadow.map){ l.shadow.map.dispose(); l.shadow.map = null; }
    }
    const radius = st.radius;
    const texel = st.texel;

    // La DIRECTION, telle qu'elle est maintenant : elle vient de l'orientation que
    // l'utilisateur a donnée au repère, et on la relit à chaque image plutôt que de la
    // mémoriser — sinon tourner le soleil ne tournerait plus l'ombre.
    l.getWorldPosition(_shadowLightPos);
    if(l.target){ l.target.updateWorldMatrix(true, false); l.target.getWorldPosition(_shadowTargetPos); }
    else _shadowTargetPos.set(0, 0, 0);
    _shadowDir.subVectors(_shadowTargetPos, _shadowLightPos);
    if(_shadowDir.lengthSq() < 1e-8) _shadowDir.set(0, -1, 0);
    _shadowDir.normalize();

    // LA LUMIÈRE NE BOUGE PAS. La première version la déplaçait pour recentrer la carte
    // d'ombre — invisible pour le soleil par défaut, mais une directionnelle POSÉE dans la
    // scène a un repère et une ligne d'aide, qui se sont mis à suivre la caméra. C'était une
    // régression, pas une fonctionnalité : on ne touche pas à un objet que l'utilisateur a
    // placé pour améliorer un rendu.
    //
    // Une caméra orthographique accepte des bornes ASYMÉTRIQUES. On garde donc la lumière où
    // elle est, on exprime le centre de la sphère DANS SON REPÈRE, et on décale la boîte de
    // ce vecteur. Le résultat est identique et rien ne se déplace à l'écran.
    _shadowView.lookAt(_shadowLightPos, _shadowTargetPos, UP_SHADOW);
    _shadowInvView.copy(_shadowView).invert();
    const local = _shadowCenter.clone().applyMatrix4(_shadowInvView);

    // Le calage sur la grille des texels se fait ICI, dans ce repère : c'est le décalage de la
    // boîte qu'il faut quantifier. Sans lui, la carte glisse d'une fraction de texel à chaque
    // image et tous les bords d'ombre fourmillent — le défaut le plus visible en mouvement
    // lent, celui qu'on attribue à tort à « la qualité ».
    const cx = ShadowFit.snapToTexel(local.x, texel);
    const cy = ShadowFit.snapToTexel(local.y, texel);
    // Une caméra regarde vers -Z : ce qui est devant elle a un z NÉGATIF. La distance le long
    // de l'axe de vue est donc `-local.z`, et un signe inversé ici place le plan proche
    // derrière la scène — plus aucune ombre, sans erreur.
    const depth = -local.z;

    const cam = l.shadow.camera;
    cam.left = cx - radius; cam.right = cx + radius;
    cam.bottom = cy - radius; cam.top = cy + radius;
    cam.near = Math.max(0.1, depth - radius - MARGIN_SHADOW);
    cam.far = depth + radius + MARGIN_SHADOW;
    // Sans cette ligne, la caméra garde SA matrice de projection : les valeurs sont écrites,
    // three.js continue de projeter sur l'ancienne boîte, et rien ne change à l'écran.
    cam.updateProjectionMatrix();
    l.shadow.normalBias = st.normalBias;
    l.shadow.bias = st.bias;
  });
}
if (typeof globalThis !== 'undefined') globalThis.updateShadows = updateShadows;

// L'ancien recadrage sur les bornes de la scène a disparu : il est remplacé, pas complété.
// Deux cadrages concurrents se seraient écrasés l'un l'autre à chaque image.
export function refitShadows(){ /* conservé pour les appelants ; le vrai travail se fait par image */ }
if (typeof globalThis !== 'undefined') globalThis.refitShadows = refitShadows;

export function applyFilters(){
  renderer.shadowMap.enabled = filters.shadows;
  // UN SEUL passage, et une seule décision par matériau. C'était deux mécanismes de
  // substitution enchaînés, plus une mutation de `wireframe` au milieu : le second substituait
  // par-dessus le premier et retenait son substitut comme « l'original ».
  objects.forEach(function(root){
    // Un nœud de modèle est déjà parcouru avec la racine de son instance : le repasser
    // substituerait son matériau une seconde fois, par-dessus le substitut.
    if(root.userData.modelNode !== undefined) return;
    root.traverse(function(o){ if(o.isMesh) applyDisplay(o); });
  });
  ['shadows', 'textures', 'shaders'].forEach(function(k){
    const b = document.getElementById('filter-' + k);
    if(b) b.classList.toggle('active', filters[k]);
  });
  // Le mode d'affichage a son propre contrôle segmenté : les boutons s'allument depuis lui,
  // pas depuis `filters` — c'est un choix EXCLUSIF, pas une bascule.
  document.querySelectorAll('#view-mode [data-mode]').forEach(function(b){
    b.classList.toggle('active', b.dataset.mode === drawMode);
  });
}

/** Change le mode d'affichage. Un mode inconnu retombe sur `shaded` plutôt que de tout éteindre. */
export function setDrawMode(id){
  drawMode = (typeof DrawMode !== 'undefined' && DrawMode.isMode(id)) ? id : 'shaded';
  applyFilters();
}
if (typeof globalThis !== 'undefined') globalThis.setDrawMode = setDrawMode;

// Les boutons de mode sont CONSTRUITS depuis la liste des modes, jamais écrits dans la page :
// ajouter un mode ne doit demander de toucher qu'un seul fichier, sinon le second est oublié
// et le mode existe sans être atteignable.
(function(){
  const host = document.getElementById('view-mode');
  if(!host || typeof DrawMode === 'undefined' || typeof Icons === 'undefined') return;
  host.innerHTML = DrawMode.MODES.map(function(m){
    return '<button class="ui-icon-btn" data-mode="' + m.id + '" title="'
      + m.label + ' — ' + m.help.replace(/"/g, '&quot;') + '">'
      + Icons.html(m.icon) + '</button>';
  }).join('');
  host.querySelectorAll('[data-mode]').forEach(function(b){
    b.addEventListener('click', function(){ setDrawMode(b.dataset.mode); });
  });
})();

['shadows','textures','shaders'].forEach(function(k){
  const btn = document.getElementById('filter-' + k);
  if(!btn) return;   // une page qui charge scene.js sans la palette ne doit pas lever
  btn.addEventListener('click', function(){
    filters[k] = !filters[k];
    if(k === 'shadows'){
      // le changement global d'ombrage exige une recompilation des matériaux
      scene.traverse(function(o){ listMats(o).forEach(function(m){ m.needsUpdate = true; }); });
    }
    applyFilters();
  });
});


// EXPOSÉ EN GLOBALE, à dessein. Ces symboles sont appelés depuis des fichiers
// que les mêmes pages ne chargent pas toutes : un `import` y pointerait un
// fichier absent, et la page ne démarrerait pas. Ils gardent donc leur garde
// `typeof` côté appelant, et se déclarent ici.
globalThis.activeCam = activeCam;
globalThis.grid = grid;
globalThis.hemi = hemi;
globalThis.renderer = renderer;
globalThis.scene = scene;
globalThis.sun = sun;