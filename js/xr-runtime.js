// moteur/js/xr-runtime.js
//
// LE COMPORTEMENT WEBXR DU JEU — session, manettes, locomotion, saisie, et `api.xr`.
//
// Les réglages vivent sur trois composants (js/components/component-xr.js) ; ce module les lit
// par le Registry, comme un System, mais il n'en est pas un : il doit tenir la SESSION (bouton,
// début, fin), qui n'existe qu'une fois pour tout le jeu, et s'accrocher à la boucle de rendu
// (voir `install`). Il n'est ACTIF que dans le runtime du jeu (game-runtime.js), qui l'installe
// quand le projet porte un XROrigin. Dans l'éditeur il est chargé mais jamais installé : `api.xr`
// y répond « pas de casque », ce qui laisse un script XR tourner sans erreur en simulation.
//
// TROIS FAITS DE three.js r185 QUI DICTENT LA FORME DE CE FICHIER (vérifiés dans
// vendor-esm/three.webgpu.min.js) :
//
//   1. `WebGPURenderer.xr` (XRManager) existe, mais une session XR sur le BACKEND WebGPU exige la
//      fonctionnalité de session "webgpu" (liaison XRGPUBinding), encore expérimentale dans les
//      navigateurs. Le runtime crée donc son renderer avec `forceWebGL: true` quand le projet est
//      XR — le backend WebGL2 du même WebGPURenderer, qui parle WebXR partout (Quest, Pico,
//      Chrome/Edge + émulateur). Les matériaux TSL restent identiques : ils se compilent en GLSL.
//   2. Une session immersive impose SA cadence : `requestAnimationFrame` de la fenêtre s'arrête
//      dans le casque. La boucle du jeu passe par `renderer.setAnimationLoop`, qui bascule seule
//      sur `session.requestAnimationFrame`.
//   3. `renderer.render(scene, cam)` en session remplace la pose de `cam` par celle du casque,
//      RELATIVEMENT AU PARENT de la caméra. C'est ce qui fait de l'XROrigin un « sol » : on
//      déplace le parent, le casque suit. Le post-traitement maison (postfx.js) ne connaît
//      qu'une vue ; il est coupé en session (rendu stéréo par three).
//
// Pas de modèles de manettes officiels (XRControllerModelFactory télécharge des glTF depuis un
// CDN — ni vendorisé ni hors-ligne) : un rayon et un boîtier procéduraux, suffisants pour viser.
import { Registry } from './component-registry.js';
import './components/component-xr.js';

// ---------- détection ----------

/** Le projet (données de `buildDataProject`) contient-il un XROrigin, dans n'importe quelle scène ? */
export function projectUsesXr(data){
  const scenes = (data && data.scenes) || [];
  return scenes.some(function(s){
    const objects = (s && s.data && s.data.objects) || (s && s.objects) || [];
    return objects.some(function(o){
      return o && (o.components || []).some(function(c){ return c && c.type === 'XROrigin'; });
    });
  });
}

// ---------- boutons de manette (mappage "xr-standard" de la spec WebXR Gamepads) ----------
export const XR_BUTTONS = {trigger: 0, squeeze: 1, touchpad: 2, stick: 3, a: 4, b: 5};

/** Le stick d'une manette : axes 2/3 en xr-standard, 0/1 sur les manettes sans pavé tactile. */
export function stickOf(gamepad){
  const a = (gamepad && gamepad.axes) || [];
  if(a.length >= 4) return {x: a[2] || 0, y: a[3] || 0};
  return {x: a[0] || 0, y: a[1] || 0};
}

/**
 * Déclencheur à hystérésis d'un axe : vrai UNE fois quand la valeur franchit `on`, réarmé
 * seulement sous `off`. Sans ça, une rotation par cran tournerait à chaque image tant que le
 * stick reste poussé.
 */
export function edgeTrigger(state, key, value, on, off){
  const armed = state[key] !== true;
  if(armed && value >= on){ state[key] = true; return true; }
  if(!armed && value < off) state[key] = false;
  return false;
}

/**
 * Le déplacement de l'origine qui amène la TÊTE (et non l'origine) sur le point visé.
 * La tête est rarement au-dessus de l'origine : on se déplace dans son espace de jeu réel.
 * Rend le nouveau `{x, y, z}` de l'origine, en coordonnées monde.
 */
export function teleportOrigin(originPos, headPos, target){
  return {
    x: originPos.x + (target.x - headPos.x),
    y: target.y,
    z: originPos.z + (target.z - headPos.z)
  };
}

/**
 * La rotation par cran AUTOUR DE LA TÊTE : tourner l'origine sur elle-même ferait décrire un arc
 * au joueur dès qu'il n'est pas au centre de son espace. Rend `{x, z}` de l'origine après une
 * rotation de `angle` radians autour de l'axe Y (même sens que `rotation.y`).
 */
export function rotateOriginAroundHead(originPos, headPos, angle){
  const dx = originPos.x - headPos.x, dz = originPos.z - headPos.z;
  const c = Math.cos(angle), s = Math.sin(angle);
  return {x: headPos.x + dx * c + dz * s, z: headPos.z - dx * s + dz * c};
}

// ---------- état ----------
const state = {
  installed: false,
  renderer: null,
  hooks: null,
  supported: {'immersive-vr': false, 'immersive-ar': false},
  session: null,
  sessionMode: null,
  origin: null,            // nœud XROrigin de la scène courante
  cameraRestore: null,     // ce qu'il faut remettre en fin de session
  arRestore: null,
  controllers: [],         // index WebXR 0/1 → entrée
  byHand: {left: null, right: null},
  edges: {},
  teleport: {aiming: false, valid: false, point: null, arc: null, marker: null, samples: 0},
  button: null,
  headPos: null, headQuat: null
};

function T(){ return globalThis.THREE; }
let _headScale = null;   // créé à l'installation : THREE n'existe pas encore au chargement
// `navigator.xr`, ou null — `navigator` lui-même manque hors navigateur (harnais de test).
function xrSystem(){ return (typeof navigator !== 'undefined' && navigator.xr) || null; }

function makeHand(i){
  const THREE = T();
  const xr = state.renderer.xr;
  const target = xr.getController(i);
  const grip = xr.getControllerGrip(i);
  const entry = {
    index: i, target: target, grip: grip, inputSource: null, handedness: null,
    // Boutons par ÉVÉNEMENTS en plus de la manette : une MAIN suivie n'a pas de `gamepad`, mais
    // ses pincements arrivent en `select*` / `squeeze*`.
    evSelect: false, evSqueeze: false,
    pressed: {}, prevPressed: {},
    held: null, heldOffset: null,
    prevGripPos: new THREE.Vector3(), velocity: new THREE.Vector3(),
    ray: null, body: null,
    // L'objet rendu par api.xr.controller() — réutilisé, pas un par appel.
    view: {connected: false, hand: null, position: new THREE.Vector3(),
           quaternion: new THREE.Quaternion(), direction: new THREE.Vector3(0, 0, -1),
           trigger: 0, squeeze: 0, stick: {x: 0, y: 0}}
  };

  target.addEventListener('connected', function(e){
    entry.inputSource = e.data;
    entry.handedness = (e.data && e.data.handedness) || (i === 0 ? 'left' : 'right');
    if(entry.handedness === 'left' || entry.handedness === 'right') state.byHand[entry.handedness] = entry;
    refreshVisuals(entry);
  });
  target.addEventListener('disconnected', function(){
    releaseGrab(entry, false);
    if(entry.handedness && state.byHand[entry.handedness] === entry) state.byHand[entry.handedness] = null;
    entry.inputSource = null;
    refreshVisuals(entry);
  });
  target.addEventListener('selectstart', function(){ entry.evSelect = true; });
  target.addEventListener('selectend', function(){ entry.evSelect = false; });
  target.addEventListener('squeezestart', function(){ entry.evSqueeze = true; });
  target.addEventListener('squeezeend', function(){ entry.evSqueeze = false; });

  // Le rayon de visée : une ligne de 1 m vers -Z dans l'espace « target ray ».
  const rayGeo = new THREE.BufferGeometry().setFromPoints(
    [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
  entry.ray = new THREE.Line(rayGeo, new THREE.LineBasicMaterial({color: 0x9fd4ff}));
  entry.ray.name = 'xr-ray';
  target.add(entry.ray);
  // Le boîtier : un pavé à la place de la manette, dans l'espace « grip ».
  entry.body = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.03, 0.12),
    new THREE.MeshStandardMaterial({color: 0x333a44, roughness: 0.6}));
  entry.body.name = 'xr-controller';
  grip.add(entry.body);
  refreshVisuals(entry);
  return entry;
}

function originSettings(){
  return (state.origin && state.origin.userData.xrOrigin) || {};
}

function refreshVisuals(entry){
  const show = originSettings().showControllers !== false;
  const connected = !!entry.inputSource;
  // Une main suivie n'a pas de boîtier à dessiner — seulement son rayon.
  const isHand = connected && !!entry.inputSource.hand;
  if(entry.ray) entry.ray.visible = show && connected;
  if(entry.body) entry.body.visible = show && connected && !isHand;
}

function buildTeleportVisuals(){
  const THREE = T();
  const N = 40;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  const arc = new THREE.Line(geo, new THREE.LineBasicMaterial({color: 0x7cf29a}));
  arc.name = 'xr-teleport-arc';
  arc.frustumCulled = false;
  arc.visible = false;
  const marker = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.25, 32),
    new THREE.MeshBasicMaterial({color: 0x7cf29a, side: THREE.DoubleSide}));
  marker.rotation.x = -Math.PI / 2;
  marker.name = 'xr-teleport-marker';
  marker.visible = false;
  state.teleport.arc = arc;
  state.teleport.marker = marker;
  state.teleport.point = new THREE.Vector3();
  state.teleport.samples = N;
}

// ---------- bouton d'entrée ----------
function buildButton(){
  const b = document.createElement('button');
  b.id = 'rj-xr-button';
  b.type = 'button';
  b.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:50;'
    + 'padding:12px 22px;border:1px solid #fff8;border-radius:8px;background:#000a;color:#fff;'
    + 'font:600 14px system-ui,sans-serif;cursor:pointer;display:none';
  b.addEventListener('click', function(){
    if(state.session) exitSession();
    else enterSession();
  });
  document.body.appendChild(b);
  state.button = b;
}

function refreshButton(){
  const b = state.button;
  if(!b) return;
  if(!state.origin){ b.style.display = 'none'; return; }
  const mode = originSettings().sessionMode || 'immersive-vr';
  const label = (mode === 'immersive-ar') ? 'RA' : 'VR';
  b.style.display = '';
  if(state.session){
    b.disabled = false; b.style.opacity = '1'; b.style.cursor = 'pointer';
    b.textContent = 'Quitter la ' + label;
    b.title = '';
    return;
  }
  const ok = !!state.supported[mode];
  b.disabled = !ok;
  b.style.opacity = ok ? '1' : '0.55';
  b.style.cursor = ok ? 'pointer' : 'default';
  b.textContent = ok ? 'Entrer en ' + label : label + ' indisponible';
  b.title = ok ? '' : (!globalThis.isSecureContext
    ? 'WebXR exige HTTPS (ou localhost). Sur casque, ouvrez le jeu en https:// ou via « adb reverse ».'
    : 'Aucun casque WebXR détecté. Sans casque : extension « Immersive Web Emulator » (Chrome/Edge).');
}

function probeSupport(){
  const xr = xrSystem();
  if(!xr || typeof xr.isSessionSupported !== 'function'){ refreshButton(); return; }
  ['immersive-vr', 'immersive-ar'].forEach(function(mode){
    xr.isSessionSupported(mode).then(function(ok){
      state.supported[mode] = !!ok; refreshButton();
    }).catch(function(){ state.supported[mode] = false; refreshButton(); });
  });
}

// ---------- session ----------
export function enterSession(){
  if(state.session || !state.origin || !xrSystem()) return Promise.resolve(false);
  const s = originSettings();
  const mode = s.sessionMode || 'immersive-vr';
  const optional = [s.referenceSpace || 'local-floor', 'bounded-floor'];
  if(s.handTracking !== false) optional.push('hand-tracking');
  const init = {optionalFeatures: optional};
  if(mode === 'immersive-ar'){
    optional.push('hit-test');
    const root = state.hooks.uiRoot && state.hooks.uiRoot();
    if(root){ optional.push('dom-overlay'); init.domOverlay = {root: root}; }
  }
  return xrSystem().requestSession(mode, init).then(async function(session){
    const xr = state.renderer.xr;
    xr.setReferenceSpaceType(s.referenceSpace || 'local-floor');
    // LA COUCHE DE BASE, jamais la couche de projection. XRManager (r185) choisit le chemin
    // « WebXR Layers » dès que le NAVIGATEUR déclare `XRWebGLBinding.createProjectionLayer`
    // (`_supportsLayers`, figé à la construction), sans demander à la SESSION si elle l'accepte.
    // Symptôme mesuré sous Immersive Web Emulator : la session démarre, aucune erreur, et le casque
    // ne montre qu'un fond uni — le rendu part dans une cible que rien ne compose. XRWebGLLayer
    // est le chemin de base de la spec, accepté partout (Quest compris). Champ privé de three :
    // à revérifier à chaque montée de version (docs/KNOWN_ISSUES.md).
    if('_supportsLayers' in xr) xr._supportsLayers = false;
    patchThreeXrNullGuards(state.renderer);
    await xr.setSession(session);
    console.info('[xr] session ' + mode + ' démarrée — couche '
      + (xr._glBaseLayer ? 'XRWebGLLayer ' + xr._glBaseLayer.framebufferWidth + '×'
         + xr._glBaseLayer.framebufferHeight : (xr._glProjLayer ? 'de projection' : 'inconnue')));
    state.session = session;
    state.sessionMode = mode;
    session.addEventListener('end', onSessionEnd);
    prepareCamera();
    if(mode === 'immersive-ar') prepareAr();
    refreshButton();
    return true;
  }).catch(function(e){
    console.error('[xr] la session n\'a pas pu démarrer', e);
    if(state.hooks.message) state.hooks.message('Session XR refusée : ' + (e && e.message ? e.message : e));
    return false;
  });
}

/**
 * TROIS DÉFAUTS DE three r185 qui figent toute session sur couche de base (XRWebGLLayer),
 * reproduits sous iwer (le moteur de l'extension Immersive Web Emulator) sur un simple cube,
 * hors de notre moteur : 0 image rendue avant, 72 images/s et 0 erreur après.
 *
 *   1. `XRManager._onAnimationFrame` appelle `foveateBoundTexture(renderer._getFrameBufferTarget())`,
 *      et `_getFrameBufferTarget()` rend `null` quand aucune conversion de sortie n'est nécessaire.
 *      `foveateBoundTexture(null)` lit `null.isPostProcessingRenderTarget` : l'exception part
 *      AVANT l'appel de notre boucle. L'émulateur l'attrape, donc rien ne s'arrête bruyamment —
 *      mais plus rien n'est dessiné ni simulé (ni téléportation, ni déplacement).
 *   2. La spec autorise `XRWebGLLayer.framebuffer === null` (le framebuffer par défaut du canvas —
 *      c'est ce que rendent les émulateurs et polyfills ; un vrai casque rend un framebuffer). Le
 *      backend WebGL s'en sert comme clé de WeakMap dans `state.drawBuffers` : « Invalid value
 *      used as weak map key » à chaque image.
 *
 * Les deux gardes ne changent rien quand la valeur n'est pas nulle. À retirer quand three les
 * corrige (docs/KNOWN_ISSUES.md) — c'est pourquoi elles sont posées par propriété, pas en
 * modifiant le fichier vendorisé.
 */
function patchThreeXrNullGuards(renderer){
  const xr = renderer && renderer.xr;
  if(xr && typeof xr.foveateBoundTexture === 'function' && !xr.__xrNullGuard){
    const foveate = xr.foveateBoundTexture;
    xr.foveateBoundTexture = function(target){ return target ? foveate.call(this, target) : undefined; };
    xr.__xrNullGuard = true;
  }
  const st = renderer && renderer.backend && renderer.backend.state;
  if(st && typeof st.drawBuffers === 'function' && !st.__xrNullGuard){
    const drawBuffers = st.drawBuffers;
    st.drawBuffers = function(renderTarget, framebuffer){
      // Le framebuffer par défaut n'a qu'une sortie : BACK.
      if(framebuffer == null){ this.gl.drawBuffers([this.gl.BACK]); return; }
      return drawBuffers.call(this, renderTarget, framebuffer);
    };
    st.__xrNullGuard = true;
  }
  // 3. Le rendu des OMBRES est un `renderer.render(scene, shadowCamera)` IMBRIQUÉ dans le rendu
  //    principal. En session, `render()` remplace toute caméra par la caméra XR — ombres
  //    comprises : le rendu d'ombre reprend alors la liste d'objets du rendu principal (même
  //    scène, même caméra XR) et la vide en plein parcours. « Cannot destructure property
  //    'object' of 'e[n]' » à chaque image, et une image à moitié dessinée. On coupe XR le temps
  //    d'un rendu imbriqué vers une cible qui n'est PAS la cible XR (carte d'ombre, sonde) ; la
  //    passe de sortie finale, elle, vise la cible XR et garde XR.
  if(renderer && typeof renderer.render === 'function' && !renderer.__xrNestedGuard){
    const render = renderer.render;
    let depth = 0;
    renderer.render = function(scene, camera){
      const rt = this.getRenderTarget();
      const nested = depth > 0 && this.xr && this.xr.isPresenting && rt && !rt.isXRRenderTarget;
      if(nested) this.xr.enabled = false;
      depth++;
      try { return render.call(this, scene, camera); }
      finally { depth--; if(nested) this.xr.enabled = true; }
    };
    renderer.__xrNestedGuard = true;
  }
}

export function exitSession(){
  if(state.session) state.session.end();
}

function onSessionEnd(){
  state.controllers.forEach(function(c){ releaseGrab(c, false); });
  restoreCamera();
  restoreAr();
  state.session = null;
  state.sessionMode = null;
  state.teleport.aiming = false;
  hideTeleport();
  refreshButton();
  if(state.hooks.onSessionEnd) state.hooks.onSessionEnd();
}

/**
 * La caméra doit DESCENDRE de l'origine (fait n° 3 de l'en-tête). Deux cas :
 *   · elle en descend : les nœuds entre elle et l'origine sont remis à l'identité le temps de la
 *     session — leur hauteur de 1,6 m sert à l'aperçu sur écran, le casque donne la vraie ;
 *     la garder ferait voir le monde depuis 3,2 m. C'est le « Camera Offset » d'Unity en mode
 *     Floor.
 *   · elle n'en descend pas : une caméra XR est créée sous l'origine et prend sa place.
 */
function prepareCamera(){
  const THREE = T();
  const origin = state.origin;
  const cam = state.hooks.camera();
  if(!origin || !cam) return;
  const restore = {nodes: [], swapped: null};
  if(isDescendant(cam, origin)){
    for(let n = cam.parent; n && n !== origin; n = n.parent){
      restore.nodes.push({node: n, p: n.position.clone(), q: n.quaternion.clone()});
      n.position.set(0, 0, 0);
      n.quaternion.identity();
    }
  } else {
    const xrCam = new THREE.PerspectiveCamera(70, 1, cam.near || 0.05, cam.far || 500);
    xrCam.name = 'xr-camera';
    origin.add(xrCam);
    restore.swapped = {previous: cam, xrCam: xrCam};
    state.hooks.setCamera(xrCam);
  }
  state.cameraRestore = restore;
}

function restoreCamera(){
  const r = state.cameraRestore;
  state.cameraRestore = null;
  if(!r) return;
  r.nodes.forEach(function(e){ e.node.position.copy(e.p); e.node.quaternion.copy(e.q); });
  if(r.swapped){
    if(r.swapped.xrCam.parent) r.swapped.xrCam.parent.remove(r.swapped.xrCam);
    state.hooks.setCamera(r.swapped.previous);
  }
}

// En réalité augmentée le monde réel EST le fond : un ciel ou une couleur de fond le masquerait.
function prepareAr(){
  const scene = state.hooks.scene();
  const THREE = T();
  const r = state.renderer;
  state.arRestore = {
    background: scene ? scene.background : null,
    clearAlpha: (typeof r.getClearAlpha === 'function') ? r.getClearAlpha() : 1,
    clearColor: (typeof r.getClearColor === 'function') ? r.getClearColor(new THREE.Color()) : null
  };
  if(scene) scene.background = null;
  if(typeof r.setClearColor === 'function') r.setClearColor(0x000000, 0);
}

function restoreAr(){
  const a = state.arRestore;
  state.arRestore = null;
  if(!a) return;
  const scene = state.hooks.scene();
  if(scene) scene.background = a.background;
  if(a.clearColor && typeof state.renderer.setClearColor === 'function'){
    state.renderer.setClearColor(a.clearColor, a.clearAlpha);
  }
}

function isDescendant(o, ancestor){
  for(let n = o; n; n = n.parent) if(n === ancestor) return true;
  return false;
}

// ---------- installation ----------

/**
 * Branche le WebXR sur un renderer. `hooks` :
 *   scene()           → la scène courante
 *   camera()          → la caméra de rendu courante
 *   setCamera(cam)    → remplace la caméra de rendu (écouteur audio compris)
 *   uiRoot()          → l'élément de l'interface HTML (dom-overlay en RA)
 *   grabBody(o, on, velocity) → bascule le corps physique de `o` en cinématique / le relâche
 *   syncBody(o)       → recale le corps physique de `o` sur sa pose monde
 *   message(txt)      → un message à l'écran (facultatif)
 */
export function install(renderer, hooks){
  if(state.installed || !renderer || !renderer.xr) return false;
  state.installed = true;
  state.renderer = renderer;
  state.hooks = hooks || {};
  renderer.xr.enabled = true;
  const THREE = T();
  state.headPos = new THREE.Vector3();
  state.headQuat = new THREE.Quaternion();
  _headScale = new THREE.Vector3();
  state.controllers = [makeHand(0), makeHand(1)];
  buildTeleportVisuals();
  buildButton();
  probeSupport();
  // Un casque branché après le chargement (Link, émulateur activé) doit rendre le bouton actif.
  const xr = xrSystem();
  if(xr && typeof xr.addEventListener === 'function') xr.addEventListener('devicechange', probeSupport);
  return true;
}

/** À appeler après chaque chargement de scène : retrouve l'origine et y accroche les manettes. */
export function sceneChanged(){
  if(!state.installed) return;
  state.controllers.forEach(function(c){ releaseGrab(c, false); });
  const origins = Registry.activeNodes('XROrigin');
  const next = origins[0] || null;
  if(origins.length > 1) console.warn('[xr] plusieurs XROrigin dans la scène : seul « ' + next.name + ' » est utilisé');
  // L'ancienne scène est déjà jetée : ce qu'on avait remis à l'identité n'existe plus.
  if(state.cameraRestore && state.cameraRestore.swapped){
    const x = state.cameraRestore.swapped.xrCam;
    if(x.parent) x.parent.remove(x);
  }
  state.cameraRestore = null;
  state.origin = next;
  const scene = state.hooks.scene();
  state.controllers.forEach(function(c){
    [c.target, c.grip].forEach(function(o){
      if(o.parent) o.parent.remove(o);
      if(next) next.add(o);
    });
    refreshVisuals(c);
  });
  // Arc et repère vivent en coordonnées MONDE : ils vont dans la scène, pas sous l'origine.
  [state.teleport.arc, state.teleport.marker].forEach(function(o){
    if(o.parent) o.parent.remove(o);
    if(next && scene) scene.add(o);
  });
  if(state.session){
    prepareCamera();
    if(state.sessionMode === 'immersive-ar'){ restoreAr(); prepareAr(); }
  }
  refreshButton();
}

export function isPresenting(){
  return !!(state.renderer && state.renderer.xr && state.renderer.xr.isPresenting);
}

// ---------- image ----------

function readButtons(entry){
  const gp = entry.inputSource && entry.inputSource.gamepad;
  const prev = entry.prevPressed; entry.prevPressed = entry.pressed; entry.pressed = prev;
  Object.keys(XR_BUTTONS).forEach(function(k){
    const b = gp && gp.buttons[XR_BUTTONS[k]];
    entry.pressed[k] = !!(b && b.pressed);
  });
  if(entry.evSelect) entry.pressed.trigger = true;
  if(entry.evSqueeze) entry.pressed.squeeze = true;
  const v = entry.view;
  v.connected = !!entry.inputSource;
  v.hand = entry.handedness;
  v.trigger = gp && gp.buttons[0] ? gp.buttons[0].value : (entry.evSelect ? 1 : 0);
  v.squeeze = gp && gp.buttons[1] ? gp.buttons[1].value : (entry.evSqueeze ? 1 : 0);
  const st = stickOf(gp);
  v.stick.x = st.x; v.stick.y = st.y;
  entry.grip.getWorldPosition(v.position);
  entry.target.getWorldQuaternion(v.quaternion);
  v.direction.set(0, 0, -1).applyQuaternion(v.quaternion);
}

/** Une image de XR. À appeler AVANT les scripts : `api.xr` doit lire l'état de CETTE image. */
export function update(dt){
  if(!state.installed || !state.origin) return;
  state.origin.updateMatrixWorld(true);
  const cam = state.hooks.camera();
  if(isPresenting()){
    // La pose de la tête de CETTE image — three a mis la caméra XR à jour avant notre rappel.
    // La matrice MONDE telle que three l'a calculée au rendu précédent (pose × origine), lue
    // telle quelle. PAS getWorldPosition() : il appelle updateWorldMatrix(), qui recalcule
    // matrixWorld depuis `matrix` seul — la caméra XR n'a pas de parent, l'origine disparaît. La
    // tête lue était alors celle de l'espace de jeu (0, 1,6, 0) quel que soit l'endroit où le
    // joueur s'était téléporté ; rotation par cran et téléportation pivotaient autour d'un point
    // faux, et la matrice de la caméra XR était écrasée jusqu'au rendu suivant.
    const xrCam = state.renderer.xr.getCamera();
    xrCam.matrixWorld.decompose(state.headPos, state.headQuat, _headScale);
  } else if(cam){
    cam.getWorldPosition(state.headPos);
    cam.getWorldQuaternion(state.headQuat);
  }
  state.controllers.forEach(function(c){
    readButtons(c);
    const p = c.view.position;
    if(dt > 0){
      // Vitesse lissée de la main : c'est elle qu'un objet lancé emporte.
      c.velocity.lerp(p.clone().sub(c.prevGripPos).divideScalar(dt), 0.5);
    }
    c.prevGripPos.copy(p);
  });
  if(!isPresenting()) return;
  locomotion(originSettings(), dt);
  state.controllers.forEach(function(c){ updateGrab(c); });
}

function locomotion(s, dt){
  const right = state.byHand.right, left = state.byHand.left;
  const origin = state.origin;
  const THREE = T();
  const originWorld = origin.getWorldPosition(new THREE.Vector3());

  // Rotation par cran au stick droit.
  if(right && s.snapTurn > 0){
    const x = right.view.stick.x;
    const turnR = edgeTrigger(state.edges, 'turnR', x, 0.7, 0.3);
    const turnL = edgeTrigger(state.edges, 'turnL', -x, 0.7, 0.3);
    if(turnR || turnL){
      const a = (turnR ? -1 : 1) * s.snapTurn * Math.PI / 180;
      const np = rotateOriginAroundHead(originWorld, state.headPos, a);
      originWorld.set(np.x, originWorld.y, np.z);
      origin.rotation.y += a;
      setOriginWorld(originWorld);
    }
  }

  // Déplacement continu au stick gauche, dans la direction du REGARD (projetée au sol).
  if(left && s.moveSpeed > 0){
    const st = left.view.stick;
    if(Math.abs(st.x) > 0.15 || Math.abs(st.y) > 0.15){
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(state.headQuat);
      fwd.y = 0;
      if(fwd.lengthSq() > 1e-6){
        fwd.normalize();
        const side = new THREE.Vector3(-fwd.z, 0, fwd.x);
        originWorld.addScaledVector(fwd, -st.y * s.moveSpeed * dt);
        originWorld.addScaledVector(side, st.x * s.moveSpeed * dt);
        setOriginWorld(originWorld);
      }
    }
  }

  // Téléportation : stick droit vers l'avant pour viser, relâcher pour y aller.
  if(right && s.teleport !== false){
    const y = right.view.stick.y;
    if(y < -0.6){
      state.teleport.aiming = true;
      aimTeleport(right);
    } else if(state.teleport.aiming && y > -0.3){
      state.teleport.aiming = false;
      if(state.teleport.valid){
        const np = teleportOrigin(originWorld, state.headPos, state.teleport.point);
        setOriginWorld(new THREE.Vector3(np.x, np.y, np.z));
        haptic('right', 0.3, 40);
      }
      hideTeleport();
    }
  } else if(state.teleport.aiming){
    state.teleport.aiming = false;
    hideTeleport();
  }
}

function setOriginWorld(worldPos){
  const o = state.origin;
  if(o.parent) o.position.copy(o.parent.worldToLocal(worldPos.clone()));
  else o.position.copy(worldPos);
  o.updateMatrixWorld(true);
}

/**
 * L'objet est-il présent dans le monde ? PAS `visible` : une source regroupée dans un lot
 * instancié (js/render-perf.js) a `visible = false` alors qu'elle est bien à l'écran — le sol et
 * la table du template le sont. On lit l'INTENTION (`activeVoulu`, posée par api.setActive).
 */
function presentInWorld(n){
  if(!n.parent || n.userData.activeVoulu === false) return false;
  // `visibleIntent` plutôt que la lecture à la main : depuis que le panneau Hiérarchie et les
  // actions d'évènement savent masquer un objet REGROUPÉ (par `visibleWanted`, v0.162.0),
  // « regroupé » ne veut plus dire « visible ». Sans ça, on se téléporterait sur un sol que la
  // personne vient de masquer. Une seule définition de la présence, dans js/render-perf.js —
  // le `typeof` reste parce que ce module est retirable d'un build allégé.
  if(typeof visibleIntent === 'function') return visibleIntent(n);
  return n.visible !== false || n.userData.inInstanceBatch === true;
}

function teleportTargets(){
  const meshes = [];
  Registry.activeNodes('XRTeleportArea').forEach(function(n){
    if(!presentInWorld(n)) return;
    n.traverse(function(x){ if(x.isMesh) meshes.push(x); });
  });
  return meshes;
}

// Un arc balistique échantillonné, lancé depuis la manette : il permet de viser plus loin et
// par-dessus un rebord, ce qu'un rayon droit ne fait pas.
function aimTeleport(entry){
  const THREE = T();
  const tp = state.teleport;
  const targets = teleportTargets();
  const start = entry.target.getWorldPosition(new THREE.Vector3());
  const dir = entry.view.direction;
  const speed = 7, g = -9.8, dtS = 0.05;
  const pos = tp.arc.geometry.attributes.position;
  const ray = new THREE.Raycaster();
  const seg = new THREE.Vector3();
  let prev = start.clone(), hit = null, count = 0;
  for(let i = 0; i < tp.samples; i++){
    const t = i * dtS;
    const p = new THREE.Vector3(start.x + dir.x * speed * t,
                                start.y + dir.y * speed * t + 0.5 * g * t * t,
                                start.z + dir.z * speed * t);
    if(i > 0 && targets.length){
      seg.subVectors(p, prev);
      const len = seg.length();
      ray.set(prev, seg.normalize());
      ray.far = len;
      const h = ray.intersectObjects(targets, false)[0];
      if(h){ hit = h; pos.setXYZ(count++, h.point.x, h.point.y, h.point.z); break; }
    }
    pos.setXYZ(count++, p.x, p.y, p.z);
    prev = p;
  }
  pos.needsUpdate = true;
  tp.arc.geometry.setDrawRange(0, count);
  tp.arc.visible = true;

  tp.valid = false;
  if(hit && hit.face){
    const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    const area = areaOf(hit.object);
    const bag = area && area.userData.xrTeleportArea;
    const maxSlope = (bag && bag.maxSlope !== undefined) ? bag.maxSlope : 30;
    tp.valid = n.y >= Math.cos(maxSlope * Math.PI / 180);
  }
  tp.arc.material.color.setHex(tp.valid ? 0x7cf29a : 0xff6b6b);
  tp.marker.visible = tp.valid;
  if(tp.valid){
    tp.point.copy(hit.point);
    tp.marker.position.copy(hit.point);
    tp.marker.position.y += 0.01;
  }
}

function areaOf(o){
  for(let n = o; n; n = n.parent) if(n.userData && n.userData.xrTeleportArea) return n;
  return null;
}

function hideTeleport(){
  const tp = state.teleport;
  tp.valid = false;
  if(tp.arc) tp.arc.visible = false;
  if(tp.marker) tp.marker.visible = false;
}

// ---------- saisie ----------
function grabCandidate(entry){
  const THREE = T();
  const hand = entry.view.position;
  let best = null, bestD = Infinity;
  const box = new THREE.Box3(), sphere = new THREE.Sphere();
  Registry.activeNodes('XRGrabbable').forEach(function(n){
    if(!presentInWorld(n)) return;
    if(state.controllers.some(function(c){ return c.held === n; })) return;
    const g = n.userData.xrGrabbable || {};
    box.setFromObject(n);
    if(box.isEmpty()){ n.getWorldPosition(sphere.center); sphere.radius = 0; }
    else box.getBoundingSphere(sphere);
    const d = hand.distanceTo(sphere.center) - sphere.radius;
    const reach = (g.radius !== undefined) ? g.radius : 0.15;
    if(d <= reach && d < bestD){ best = n; bestD = d; }
  });
  return best;
}

function updateGrab(entry){
  const pressedNow = entry.pressed.squeeze, pressedBefore = entry.prevPressed.squeeze;
  if(pressedNow && !pressedBefore && !entry.held){
    const n = grabCandidate(entry);
    if(n) startGrab(entry, n);
  } else if(!pressedNow && entry.held){
    releaseGrab(entry, true);
  }
  if(entry.held) followHand(entry);
}

function startGrab(entry, n){
  const THREE = T();
  entry.grip.updateMatrixWorld(true);
  n.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(entry.grip.matrixWorld).invert();
  const offset = new THREE.Matrix4().multiplyMatrices(inv, n.matrixWorld);
  if((n.userData.xrGrabbable || {}).keepOffset === false) offset.setPosition(0, 0, 0);
  entry.held = n;
  entry.heldOffset = offset;
  if(state.hooks.grabBody) state.hooks.grabBody(n, true, null);
  haptic(entry.handedness, 0.4, 30);
}

function followHand(entry){
  const THREE = T();
  const n = entry.held;
  entry.grip.updateMatrixWorld(true);
  const m = new THREE.Matrix4().multiplyMatrices(entry.grip.matrixWorld, entry.heldOffset);
  if(n.parent){
    n.parent.updateMatrixWorld(true);
    m.premultiply(new THREE.Matrix4().copy(n.parent.matrixWorld).invert());
  }
  const scale = n.scale.clone();
  m.decompose(n.position, n.quaternion, new THREE.Vector3());
  n.scale.copy(scale);   // la main ne doit jamais changer la taille de ce qu'elle tient
  n.updateMatrixWorld(true);
  if(state.hooks.syncBody) state.hooks.syncBody(n);
}

function releaseGrab(entry, withVelocity){
  const n = entry.held;
  if(!n) return;
  entry.held = null;
  entry.heldOffset = null;
  const g = n.userData.xrGrabbable || {};
  const v = (withVelocity && g.throwable !== false) ? entry.velocity.clone() : null;
  if(state.hooks.grabBody) state.hooks.grabBody(n, false, v);
}

// ---------- vibration ----------
export function haptic(hand, intensity, ms){
  const e = hand ? state.byHand[hand] : null;
  const gp = e && e.inputSource && e.inputSource.gamepad;
  const act = gp && gp.hapticActuators && gp.hapticActuators[0];
  if(!act || typeof act.pulse !== 'function') return false;
  try { act.pulse(Math.max(0, Math.min(1, intensity === undefined ? 0.5 : intensity)), ms || 100); }
  catch(err){ return false; }
  return true;
}

// ---------- api de script (`api.xr`) ----------
// Même objet dans l'éditeur et le jeu : non installé, il répond « pas de casque » partout.
const INERT_VIEW = Object.freeze({connected: false, hand: null, position: null, quaternion: null,
                                  direction: null, trigger: 0, squeeze: 0,
                                  stick: Object.freeze({x: 0, y: 0})});

function entryOf(hand){ return state.byHand[hand === 'left' ? 'left' : 'right']; }

export const xrApi = {
  /** Le casque affiche-t-il le jeu en ce moment ? */
  presenting: function(){ return isPresenting(); },
  /** Le navigateur propose-t-il ce mode ('immersive-vr' par défaut) ? */
  available: function(mode){ return !!state.supported[mode || 'immersive-vr']; },
  enter: function(){ return enterSession(); },
  exit: function(){ exitSession(); },
  /** L'état d'une manette ('left' | 'right') : position/rotation monde, gâchettes, stick. */
  controller: function(hand){
    const e = entryOf(hand);
    return (e && e.inputSource) ? e.view : INERT_VIEW;
  },
  /** Bouton maintenu : 'trigger', 'squeeze', 'stick', 'a' (A/X), 'b' (B/Y), 'touchpad'. */
  button: function(hand, name){
    const e = entryOf(hand);
    return !!(e && e.pressed[name]);
  },
  /** Bouton enfoncé à CETTE image seulement. */
  buttonPressed: function(hand, name){
    const e = entryOf(hand);
    return !!(e && e.pressed[name] && !e.prevPressed[name]);
  },
  /** La tête : position et rotation monde (la caméra hors session). */
  head: function(){ return {position: state.headPos, quaternion: state.headQuat}; },
  /** L'objet tenu par une main, ou null. */
  held: function(hand){ const e = entryOf(hand); return (e && e.held) || null; },
  haptic: haptic,
  origin: function(){ return state.origin; }
};

export const XRRuntime = {
  projectUsesXr: projectUsesXr,
  install: install,
  sceneChanged: sceneChanged,
  update: update,
  isPresenting: isPresenting,
  enterSession: enterSession,
  exitSession: exitSession,
  api: xrApi
};

if(typeof globalThis !== 'undefined') globalThis.XRRuntime = XRRuntime;
