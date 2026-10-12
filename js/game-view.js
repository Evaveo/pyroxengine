// ---------- La vue Jeu : la scène à travers la caméra principale, hors lecture ----------
//
// L'équivalent du Game view d'Unity quand on ne joue pas : un onglet à côté de la vue Scène qui
// montre ce que verrait le joueur au lancement — la caméra PRINCIPALE (celle que choisirait
// `rtCameraMain`), son champ de vision, son rapport d'image, le post-traitement et les caméras
// en incrustation — sans AUCUN élément d'édition : ni grille, ni gizmo, ni icônes de lumière ou
// de caméra, ni colliders (tout cela vit sur LAYER_HELPERS, que les caméras de jeu n'activent
// jamais : `applyMaskCamera`, js/objects.js), ni surlignage de la sélection. Rendue en direct :
// déplacer un objet, changer un matériau ou la caméra se voit à l'image suivante.
//
// LE CHOIX DE RENDU, et pourquoi. Il n'y a qu'UN renderer WebGPU, partagé par l'éditeur et tout
// ce qu'il rend (vignettes à part). Trois façons de lui faire produire une seconde image :
//
//   1. Un SECOND WebGPURenderer sur un second canevas. Écarté : deux renderers, c'est deux
//      jeux de ressources GPU — chaque géométrie, texture et pipeline compilé deux fois, la
//      mémoire vidéo doublée — et deux `init()` asynchrones à synchroniser. Le moteur s'est déjà
//      brûlé à « deux renderers » (ChangeLogs/v0.129.0.md : modules évalués deux fois).
//   2. Un viewport/scissor dans le canevas de la vue Scène. Écarté : la vue Jeu est un onglet
//      du dock — le plus souvent DANS la même zone que la vue Scène, qu'elle cache alors (son
//      canevas fait 0×0), ou ailleurs (autre zone, fenêtre flottante, fenêtre OS). Un rectangle
//      du canevas de la vue Scène n'est à l'écran dans aucun de ces cas.
//   3. LE MÊME renderer, un SECOND CANEVAS : `THREE.CanvasTarget` + `renderer.setCanvasTarget`
//      (three r18x). Retenu. Sous WebGPU un canevas n'est qu'un contexte configuré sur le MÊME
//      device : scène, matériaux, pipelines et textures sont partagés, rien n'est recompilé.
//      On bascule la cible le temps du rendu Jeu et on la RESTAURE dans un `finally` — la vue
//      Scène, rendue juste après dans la même image, retrouve son canevas, sa taille et son
//      viewport intacts. Le post-traitement a ses PROPRES cibles (`createPostTargets`) : deux
//      tailles d'image sur les mêmes cibles les réalloueraient deux fois par image.
//
// LE COÛT : nul tant que l'onglet est caché (`active()` mesure le panneau — un onglet inactif
// fait 0×0) ; quand il est regardé, un rendu de scène de plus par image, ombres comprises. C'est
// le prix d'Unity aussi quand Scene et Game sont côte à côte.
//
// LES LIMITES, assumées et dites dans le panneau :
//   - le REPLI WebGL2 de three ne sait pas viser un second canevas (un contexte WebGL est lié à
//     SON canevas) : la vue Jeu le dit et renvoie vers « Voir à travers » et ▶ Jouer ;
//   - les modes d'affichage de la vue Scène (fil de fer, sans textures, sans ombres…) remplacent
//     les matériaux de la SCÈNE elle-même (js/draw-mode.js) : la vue Jeu les montre aussi, et le
//     dit dans sa barre ;
//   - l'interface HTML du jeu (UIDocument) n'est dessinée qu'en lecture : ▶ Jouer la montre.
//
// Branchement : la boucle de js/viewport.js rend les vues inscrites dans js/extra-views.js ;
// startup.js appelle `bootGameView()`. Aucun module du grand cycle n'importe ce fichier.
import { renderCameraOverlays } from './camera-overlays.js';
import { ed } from './component-data.js';
import { Registry } from './component-registry.js';
import { registerExtraView } from './extra-views.js';
import { GAME_VIEW_ASPECTS, GAME_VIEW_MESSAGES, aspectRatioOf, fitGameViewRect, gameViewRenderState, pickMainCameraNode } from './game-view-core.js';
import { lightmapBakeState } from './lightmap-bake.js';
import { createPostTargets, postActive, postRender } from './postfx.js';
import { drawMode, filters, renderer, scene, updateShadows } from './scene.js';
import { withHighlightSuspended } from './selection.js';
import { backgroundForCamera, isSkyBackground } from './sky-camera.js';
import { Prefs } from './ui/prefs.js';

export const gameViewEl = document.getElementById('game-view');
export const gameViewStage = document.getElementById('game-view-stage');
export const gameViewCanvas = document.getElementById('game-view-canvas');
export const gameViewMessage = document.getElementById('game-view-message');
export const gameViewCameraLabel = document.getElementById('game-view-camera');
export const gameViewAspect = document.getElementById('game-view-aspect');
export const gameViewNote = document.getElementById('game-view-note');

// L'état propre à la vue : sa cible de canevas, la taille déjà appliquée, ses cibles de post.
export const gameView = {target: null, width: 0, height: 0, pixelRatio: 0, post: null,
  reason: undefined, cameraLabel: undefined, note: undefined};

/** Le renderer sait-il dessiner dans un second canevas ? (WebGPU oui, le repli WebGL2 non.) */
export function gameViewCanvasTargetSupported(){
  return !!(renderer && renderer.backend && renderer.backend.isWebGPUBackend
    && typeof THREE.CanvasTarget === 'function' && typeof renderer.setCanvasTarget === 'function');
}

/** La place offerte par le panneau, en pixels CSS — 0×0 quand l'onglet n'est pas au premier plan. */
export function gameViewStageSize(){
  if(!gameViewStage || !gameViewStage.isConnected) return {width: 0, height: 0};
  return {width: gameViewStage.clientWidth, height: gameViewStage.clientHeight};
}

/** La caméra principale de la scène ouverte : la règle du jeu publié, et son seul juge. */
export function gameViewCameraNode(){
  return pickMainCameraNode(Registry.activeNodes('Camera'),
    (typeof isCameraMain === 'function') ? isCameraMain : null);
}

/** Écrit un texte dans le DOM seulement quand il change : ceci tourne à chaque image. */
function setTextIfChanged(el, key, text){
  if(!el || gameView[key] === text) return;
  gameView[key] = text;
  el.textContent = text || '';
  el.hidden = !text;
}

function refreshGameViewChrome(node, reason){
  setTextIfChanged(gameViewMessage, 'reason', (reason && reason !== 'hidden') ? (GAME_VIEW_MESSAGES[reason] || '') : '');
  if(gameViewCanvas) gameViewCanvas.style.visibility = reason ? 'hidden' : '';
  let label = '';
  if(node){
    label = '🎥 ' + node.name + ((typeof isCameraMain === 'function' && isCameraMain(node))
      ? '' : ' (aucune caméra n\'est cochée « principale » : la première est prise)');
  }
  setTextIfChanged(gameViewCameraLabel, 'cameraLabel', label);
  // Ce que la vue Scène impose à la scène elle-même : dit ici, sinon on croit le jeu en fil de fer.
  const DRAW_LABELS = {wireframe: 'Fil de fer', unlit: 'Non éclairé', lighting: 'Éclairage seul'};
  const parts = [];
  if(DRAW_LABELS[drawMode]) parts.push(DRAW_LABELS[drawMode]);
  if(filters.textures === false) parts.push('sans textures');
  if(filters.shadows === false) parts.push('sans ombres');
  if(filters.shaders === false) parts.push('sans shaders');
  setTextIfChanged(gameViewNote, 'note', parts.length
    ? '⚠ Affichage de la vue Scène appliqué : ' + parts.join(', ') : '');
}

/**
 * Cadre la caméra pour la taille de la vue Jeu, et rend de quoi remettre son état d'avant : la
 * même caméra sert la vue Scène quand on regarde « à travers » elle, et l'aperçu de sélection.
 */
function frameGameViewCamera(node, cam, width, height){
  const saved = {aspect: cam.aspect, left: cam.left, right: cam.right, top: cam.top,
    bottom: cam.bottom, near: cam.near, far: cam.far};
  const comp = (typeof cameraSettingOf === 'function') ? cameraSettingOf(node) : null;
  const framing = comp ? comp._framing : undefined;
  if(cam.isOrthographicCamera){
    if(typeof frameOrthoCamera === 'function') frameOrthoCamera(cam, comp, width, height);
  } else {
    cam.aspect = width / height;
    cam.updateProjectionMatrix();
  }
  return function restore(){
    if(cam.isOrthographicCamera){
      cam.left = saved.left; cam.right = saved.right; cam.top = saved.top; cam.bottom = saved.bottom;
      cam.near = saved.near; cam.far = saved.far;
    } else cam.aspect = saved.aspect;
    cam.updateProjectionMatrix();
    if(comp) comp._framing = framing;
  };
}

/** Une image de la vue Jeu. Appelée par la boucle (js/viewport.js) tant que l'onglet est regardé. */
export function renderGameView(frame){
  const size = gameViewStageSize();
  const node = gameViewCameraNode();
  const cam = node ? ed(node).cam : null;
  const state = gameViewRenderState({
    connected: !!(gameViewStage && gameViewStage.isConnected),
    width: size.width, height: size.height,
    ready: !!renderer.__ready,
    canvasTarget: gameViewCanvasTargetSupported(),
    baking: !!(lightmapBakeState && lightmapBakeState.active),
    hasCamera: !!cam
  });
  refreshGameViewChrome(node, state.reason);
  if(!state.render) return false;

  const rect = fitGameViewRect(size.width, size.height, aspectRatioOf(Prefs.get('gameView.aspect')));
  if(!rect) return false;
  if(!gameView.target) gameView.target = new THREE.CanvasTarget(gameViewCanvas);
  if(!gameView.post) gameView.post = createPostTargets();
  // Le rapport de pixels de la vue Scène, lu AVANT la bascule : c'est celui de l'écran.
  const pixelRatio = renderer.getPixelRatio();
  const previous = renderer.getCanvasTarget();
  const restoreCamera = frameGameViewCamera(node, cam, rect.width, rect.height);
  const background = scene.background;
  try {
    renderer.setCanvasTarget(gameView.target);
    // Redimensionner PENDANT que la cible est la courante : le renderer n'écoute que la sienne,
    // et c'est cet écouteur qui jette le descripteur de passe mis en cache à l'ancienne taille.
    if(gameView.pixelRatio !== pixelRatio){
      gameView.target.setPixelRatio(pixelRatio);
      gameView.pixelRatio = pixelRatio;
      gameView.width = 0;
    }
    if(gameView.width !== rect.width || gameView.height !== rect.height){
      gameView.target.setSize(rect.width, rect.height);   // pose aussi la taille CSS du canevas
      gameView.width = rect.width;
      gameView.height = rect.height;
    }
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, rect.width, rect.height);
    // Les ombres et le ciel suivent la caméra RENDUE, comme pour la vue Scène (js/viewport.js).
    updateShadows(cam);
    if(isSkyBackground(scene.background, globalThis.skyBackground))
      scene.background = backgroundForCamera(globalThis.skyBackground, cam);
    withHighlightSuspended(function(){
      // Le temps (grain du post-traitement) : l'horloge de la boucle, publiée en globale par
      // js/viewport.js — l'importer ferait entrer ce fichier dans le grand cycle de modules.
      const time = (globalThis.clock && typeof globalThis.clock.getElapsed === 'function')
        ? globalThis.clock.getElapsed() : 0;
      if(postActive()) postRender(scene, cam, rect.width, rect.height, time, gameView.post);
      else { renderer.setRenderTarget(null); renderer.render(scene, cam); }
      // Les caméras en incrustation (mini-carte, rétroviseur) : ce que le jeu publié dessine
      // par-dessus son image principale (js/game-runtime.js), dans le même ordre.
      renderCameraOverlays(renderer, scene, cam, Registry.activeNodes('Camera'),
        {camOf: function(n){ return ed(n).cam; }, width: rect.width, height: rect.height});
    });
  } finally {
    renderer.setRenderTarget(null);
    renderer.setCanvasTarget(previous);
    scene.background = background;
    restoreCamera();
  }
  return true;
}

/** Branche le panneau : le menu des rapports d'image, et l'inscription auprès de la boucle. */
export function bootGameView(){
  if(gameViewAspect){
    gameViewAspect.innerHTML = GAME_VIEW_ASPECTS.map(function(a){
      return '<option value="' + a.id + '">' + a.label + '</option>';
    }).join('');
    gameViewAspect.value = Prefs.get('gameView.aspect') || 'free';
    if(!gameViewAspect.value) gameViewAspect.value = 'free';
    gameViewAspect.addEventListener('change', function(){
      Prefs.set('gameView.aspect', gameViewAspect.value);
    });
  }
  registerExtraView({
    name: 'Vue Jeu',
    // REGARDÉE = dans la page et de taille non nulle. Un onglet inactif, une zone repliée ou un
    // panneau fermé mesurent 0×0 : la vue ne coûte alors rien, pas même la recherche de caméra.
    active: function(){
      const s = gameViewStageSize();
      return s.width > 0 && s.height > 0;
    },
    render: renderGameView
  });
}
