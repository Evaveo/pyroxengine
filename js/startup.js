// ---------- Scène de départ ----------
// Disposition fixe (pas la position aléatoire habituelle de register()) : un sol, un
// cube dessus, une directionnelle façon soleil, une caméra qui cadre le tout — pour ne
// pas avoir à replacer les objets à chaque nouveau projet.
import { bindGraph } from './animator-graph.js';
import { bindAssetDropOnView, updateProject } from './assets.js';
import { bindBarTilemap, bindBrush2d } from './brush-tilemap.js';
import { ed } from './component-data.js';
import { bindEditorInput } from './editor-input.js';
import { applyEnvironment } from './environment.js';
import { setStatus, updateHierarchy } from './hierarchy.js';
import { histo } from './history.js';
import { bindAssetInspectorInput, bindAssetSlotDrop } from './import-settings.js';
import { createObject } from './objects.js';
import { bindPalettePanel } from './palette-ui.js';
import { bindPlacementInputs } from './placement.js';
import { bootPluginsUi, loadPluginsAtStartup } from './plugins.js';
import { autoCreatePendingCloudProject } from './project-storage.js';
import { autoOpenPendingHubProject, openCloudProjectFromUrl, updateScenes } from './project.js';
import { applyFilters, setModeGizmo } from './scene.js';
import { select } from './selection.js';
import { bindTerrainInputs } from './terrain.js';
import { bindCollider2dHandles } from './collider2d-handles.js';
import { bindViewportResize } from './ui.js';
import { FloatingPalette } from './ui/floating-palette.js';
import { bootDock } from './ui/panels-shell.js';
import { Prefs } from './ui/prefs.js';
import { Segmented } from './ui/segmented.js';
import { bindViewportCanvas, bindViewportInputs, loop } from './viewport.js';

export const groundStart = createObject('plane');
groundStart.scale.set(5, 1, 5);   // 4×4 de base -> 20×20 (le plan est déjà à plat : X/Z, pas Y)
groundStart.position.set(0, 0, 0);

export const cubeStart = createObject('cube');
cubeStart.position.set(0, 0.5, 0);

export const sunStart = createObject('directional');
sunStart.position.set(5, 8, 5);
ed(sunStart).light.target.position.set(-5, -8, -5);   // aims l'origine (voir target enfant local)

export const camStart = createObject('camera');
camStart.position.set(6, 4, 8);
camStart.lookAt(0, 0.5, 0);

select(null);
updateHierarchy();
updateProject();
updateScenes();
setModeGizmo('translate');
applyFilters();
applyEnvironment();
histo.undo.length = 0;
// PLUS D'ONGLETS AU-DESSUS DE LA VUE. « Animation » et « Animator » ouvrent des fenêtres
// flottantes (js/windows.js) : les annoncer comme des onglets faisait croire qu'ils
// REMPLACENT la vue, ce qu'ils ne font plus. Les deux vivent dans le menu Fenêtres.
// LE CÂBLAGE DOM QUI VIVAIT À LA MARGE DE SON FICHIER. Ces cinq appels ne changent rien au
// comportement : ils déplacent seulement le MOMENT du branchement, du chargement du fichier à
// ici. Motif : chacun lit un `const` d'un autre fichier (`renderer` et `viewEl` de scene.js,
// `inspBody` de inspector.js) pendant l'évaluation, ce qui ne tient que par l'ordre des
// <script> — pas par un graphe de modules, où ces fichiers sont dans un cycle. Mesurable par
// `node outils/esm.mjs --risques`.
bindEditorInput();
bindTerrainInputs();
bindCollider2dHandles();
bindPlacementInputs();
bindViewportInputs();
bindViewportCanvas();
bindViewportResize();
bindAssetDropOnView();
bindAssetInspectorInput();
bindAssetSlotDrop();

bindGraph();
// Le pinceau APRÈS la vue 2D : ses écouteurs sont posés en capture et doivent passer devant ceux de
// la sélection. Ceux du zoom et du panoramique ne partagent aucun bouton avec lui, donc l'ordre
// entre eux est indifférent.
bindBarTilemap();
bindPalettePanel();
bindBrush2d();

// Les PRÉFÉRENCES d'abord : le thème et la densité sont des attributs sur <html>, et les poser
// après le premier rendu ferait clignoter l'interface d'une densité à l'autre.
Prefs.applyAll();

// plugins : après l'initialisation complète, avant la première image
loadPluginsAtStartup();
// Le dock APRES les plugins : un plugin qui declare un panneau doit le voir apparaitre
// (spec §9.4). Avant eux, sa zone n'existerait pas encore et il partirait en flottant.
// Les écritures que les plugins ont demandées dans la coquille (entrées de menu, types
// créables) : elles sont différées pour qu'un plugin chargé avant la barre de menus ne se
// coupe pas en deux sur un ReferenceError.
bootPluginsUi();
bootDock();
// La palette APRES le dock : elle se pose sur `#view`, et `#view` n'est à sa place définitive
// qu'une fois le dock monté — sinon la position relue serait bornée contre un viewport qui
// n'a pas encore sa taille, et la palette se recalerait toute seule dans le coin.
if(typeof FloatingPalette !== 'undefined') FloatingPalette.boot();
// Les contrôles segmentés APRÈS la palette : leurs groupes sont dans `#bar`, que la palette
// vient de déplacer sous `#view`. `bindAll` interroge le document entier, donc l'ordre ne
// change rien aujourd'hui — il le changerait le jour où un groupe serait construit par la
// palette elle-même, et cet ordre-là est le seul qui reste juste dans les deux cas.
if(typeof Segmented !== 'undefined') Segmented.bindAll();
loop();

// Un projet créé depuis le Hub (moteur/hub.html) remplace la scène de départ ci-dessus dès que
// le moteur est prêt — voir project.js:autoOpenPendingHubProject. Rien à faire si l'éditeur a
// été ouvert directement (aucune clé sessionStorage posée).
// Un projet HEBERGE arrive par /editeur/?projet=<id> et prime sur le passage par le Hub : les
// deux ne peuvent pas ouvrir en meme temps, et l'URL est le signal le plus explicite des deux.
// Sans ce parametre, openCloudProjectFromUrl rend false sans rien faire — l'editeur ouvert
// directement depuis un fichier n'a aucune dependance au cloud.
// Une création CLOUD demandée depuis le Hub passe avant l'ouverture d'un dossier du Hub :
// elle n'a pas de dossier (js/project-storage.js:autoCreatePendingCloudProject).
openCloudProjectFromUrl().then(async function(ouvert){
  if(ouvert) return;
  if(await autoCreatePendingCloudProject()) return;
  return autoOpenPendingHubProject();
}).catch(function(e){
  setStatus('Erreur : ' + e.message, 6000);
});
