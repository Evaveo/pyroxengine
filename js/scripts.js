// ---------- Scripts (JavaScript) ----------
// Chaque objet peut porter plusieurs scripts (userData.scripts = [{code, active}, ...]).
// Le code s'exécute pendant la lecture (Espace) ou la simulation physique :
// le niveau supérieur tourne une fois (setup), puis start(api) au premier
// pas et update(api) à chaque image. Les poses des objets scriptés sont
// restaurées à l'arrêt (mode « play » non destructif).
import { cloneModel, holderAnimator, layerAnimation, namesAnimations, playAnimationModel, playerAnimatorOf, removeLayer, stopAnimationModel } from './anim-models.js';
import { assets, mutateAsset, rootHandled, updateProject } from './assets.js';
import { raycastCandidates } from './raycast-candidates.js';
import { makeAudioBusApi } from './audio-bus.js';
import { audioMix, ensureListenerAudio, playSoundGlobal, resetAudioMix, sourceAudioOf, startAudioGame, stopAudioGame } from './audio.js';
import { assetById, ensureGame, isActiveInHierarchy } from './component-data.js';
import { bindSpriteMesh, updateImageSprite } from './components/component-sprite.js';
import { indexByTag, nodesByTag } from './components/component-tag.js';
import { rebuildTilemap } from './components/component-tilemap.js';
import { logConsole } from './console.js';
import { initEventsVisuals, runEventsVisuals, stopEventsVisuals } from './events.js';
import { lastAssetEditedBy, openEditorExternal } from './external-editor.js';
import { setStatus, status, updateHierarchy } from './hierarchy.js';
import { allowRunScripts, codeTrusted, trustCode } from './script-trust.js';
import { compileScript } from './script-scope.js';
import { pushHistory } from './history.js';
import { buildInspector, deleteRoot, syncInspector } from './inspector.js';
import { navAdvance, navFilePath, navPatrol, navPos, navReset } from './navigation.js';
import { applyNodeMixin } from './node.js';
import { addSceneObject, isSceneObject, objects, reenableSubTree } from './objects.js';
import { emitBurst } from './particles.js';
import { makeSynthApi } from './synth.js';
import { makeSteamApi, readSave, removeSave, writeSave } from './steam-bridge.js';
import { combineAxis, touchAxis } from './touch-input.js';
import { bindBodyPhysics, phys } from './physics.js';
import { LAYERS_DEFAULT } from './project-settings.js';
import { changeScene, project } from './project.js';
import { applyFilters, scene } from './scene.js';
import { select, selection } from './selection.js';
import { component } from './shader-graph-editor.js';
import { heightTerrainIn } from './terrain.js';
import { libraryHostForAssets } from './script-library.js';
import { tileAt } from './tile-palette.js';
import { camCurrent, mouse } from './viewport.js';
import { XRRuntime } from './xr-runtime.js';

export const keysGame = new Set();

/** Le rayon monde qui passe par le pointeur, depuis `cam` : {origin, direction}, ou null sans caméra. */
export function pointerRayOf(cam){
  if(!cam || !cam.isCamera) return null;
  cam.updateMatrixWorld();
  const origin = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
  const target = new THREE.Vector3(mouseGame.x, mouseGame.y, 0.5).unproject(cam);
  const direction = target.sub(origin).normalize();
  if(cam.isOrthographicCamera){
    origin.set(mouseGame.x, mouseGame.y, -1).unproject(cam);
    direction.set(0, 0, -1).transformDirection(cam.matrixWorld);
  }
  return {origin: {x: origin.x, y: origin.y, z: origin.z}, direction: {x: direction.x, y: direction.y, z: direction.z}};
}

// Une poignée de synthé par nœud de script, créée à la demande (voir js/synth.js).
const _synthApis = new WeakMap();
function synthApiOf(o){
  let s = _synthApis.get(o);
  if(!s){
    s = makeSynthApi(function(){ return ensureListenerAudio().context; },
      function(){ return objects; }, o, function(m){ logConsole('warn', m, o); },
      function(){ return audioMix().node('sfx'); });
    _synthApis.set(o, s);
  }
  return s;
}
export function inputInProgress(e){
  const tag = e.target && e.target.tagName;
  return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA'
    || (e.target && e.target.isContentEditable);
}
// UNE LETTRE TENUE PENDANT QU'UN MODIFICATEUR (Maj = sprint, typiquement) EST ACTIF change de
// CASSE dans `KeyboardEvent.key` : appuyer sur 'd' (droite) pendant que Maj est déjà tenu (pour
// courir) rend 'D', absent de la table `right: ['d', 'a', 'ArrowRight']` — l'action ne s'active
// JAMAIS, et le personnage reste bloqué dans la dernière direction pressée avant le sprint.
// `pick1..3` et `reload` s'en protégeaient déjà à la main (`['1', '&']`, `['r', 'R']`) ; le
// déplacement, configuré en minuscules seules, ne s'en protégeait pas. On normalise ici, une
// fois, plutôt que d'exiger de chaque table d'actions qu'elle liste sa propre variante majuscule —
// une lettre seule (`'d'.length === 1`) perd sa casse, tout le reste (`'ArrowRight'`, `'Shift'`,
// les symboles `'&'`/`'é'`/`'"'` du rang des chiffres) passe inchangé.
export function normalizeKey(k){ return (typeof k === 'string' && k.length === 1) ? k.toLowerCase() : k; }
addEventListener('keydown', function(e){ if(!inputInProgress(e)) keysGame.add(normalizeKey(e.key)); });
addEventListener('keyup', function(e){ keysGame.delete(normalizeKey(e.key)); });
addEventListener('blur', function(){ keysGame.clear(); });

export const engineScripts = {
  compiled: new WeakMap(),   // obj -> Map(index -> {source, error, start, update})
  demarres: new WeakMap(),   // obj -> Set(index déjà démarrés)
  snapshot: [],
  inProgress: false,
  time: 0,
  minuteries: [],        // {t, fn} — api.after()
  ecouteurs: {},         // name → [fn] — api.on()
  aDestroy: [],         // objets à retirer après la boucle de scripts
  sceneDemandee: null,   // api.changeScene()
  keysPrev: new Set(),// état clavier de l'image précédente (actionAppuyee)
  contacts: [],          // {obj, tag, fn, dedans:Set} — api.onContact()
  persos: new WeakMap(), // obj -> état du contrôleur de personnage (hors props sérialisées)
  libraries: null,       // hôte des bibliothèques (api.lib, js/script-library.js), neuf à chaque lancement

  // ---------- État de jeu global (api.state) ----------
  // Survit aux changements de scène. C'est ce qui manquait pour qu'un projet
  // soit un JEU et non un seul niveau : changeScene() arrête puis relance le
  // mode lecture, ce qui restaure l'instantané et remet toutes les propriétés
  // d'objets à zéro. Score, vies, inventaire et progress disparaissaient
  // donc au passage d'un niveau au suivant.
  state: {}
};

// ---------- Contacts (api.onContact) ----------
// Le moteur savait déjà détecter l'entrée dans un trigger, mais uniquement pour
// le système d'événements visuels. Depuis un script il fallait comparer les
// distances de chaque cible à chaque image — le code que tout le monde écrit,
// et écrit mal. Même méthode que events.js : recouvrement de boîtes.
export const _ctcA = new THREE.Box3();
export const _ctcB = new THREE.Box3();

// ---------- Les temporaires de la surface `api.*` ----------
//
// Tout le reste du moteur mutualise ses vecteurs et ses boîtes (`_ctcA` juste au-dessus,
// `_rtCorners`, `_vA`…) ; c'est la surface `api.*` qui n'avait pas été traitée. Or ce sont
// justement les fonctions que les scripts appellent dans `update()` : `api.raycast` allouait un
// Raycaster, deux Vector3 et un tableau de candidats À CHAQUE APPEL, `api.overlapSphere` une
// Sphere plus une Box3 par objet de la scène. Voir docs/REVUE_2026-09-10.md § 2.4.
//
// Pas de réentrance à craindre : aucune de ces fonctions n'en rappelle une autre, et le moteur
// est mono-thread. Ce qui SORT (le `point` d'un impact, les bornes de `api.bounds`) reste alloué
// à part — un appelant garde son résultat, il ne doit pas voir le temporaire suivant l'écraser.
export const _apiVecA = new THREE.Vector3();
export const _apiVecB = new THREE.Vector3();
export const _apiBox = new THREE.Box3();
export const _apiSphere = new THREE.Sphere();
export const _apiRay = new THREE.Raycaster();
export const _apiCandidats = [];

export function evaluateContacts(){
  if(!engineScripts.contacts.length) return;

  // UN SEUL passage sur la scène, partagé par tous les gestionnaires. La version
  // précédente parcourait tous les objets POUR CHAQUE gestionnaire, plus un
  // objets.indexOf en O(n) : le coût était en O(gestionnaires × objets).
  // Invisible avec un gestionnaire, ruineux avec cinquante — et cinquante
  // ennemis qui guettent un contact, c'est un jeu ordinaire.
  // Mesuré sur 2000 objets : 28,9 % du budget d'image à 50 gestionnaires avant,
  // 1,4 % après. Le coût suit désormais le nombre d'objets TAGUÉS, pas la
  // taille de la scène.
  // L'index ne parcourt plus QUE les objets étiquetés (composant Tag) : le commentaire
  // ci-dessus promettait « le coût suit le nombre d'objets TAGUÉS », mais la construction de
  // l'index, elle, balayait bien toute la scène à chaque image. C'est maintenant vrai.
  // `vivants` a disparu avec : la question « cet objet est-il encore dans la scène ? » est
  // isSceneObject(), en O(1) (js/objects.js).
  const byTag = indexByTag();

  engineScripts.contacts.forEach(function(c){
    if(!isSceneObject(c.obj)) return;
    const candidats = byTag.get(c.tag);
    if(!candidats || !candidats.length){ c.dedans.clear(); return; }
    _ctcA.setFromObject(c.obj);
    if(_ctcA.isEmpty()) return;
    const vus = new Set();
    for(let i = 0; i < candidats.length; i++){
      const autre = candidats[i];
      if(autre === c.obj) continue;
      _ctcB.setFromObject(autre);
      if(_ctcB.isEmpty() || !_ctcA.intersectsBox(_ctcB)) continue;
      vus.add(autre);
      // On ne notifie qu'à l'ENTRÉE : notifier à chaque image obligerait chaque
      // script à tenir lui-même la liste de ce qu'il a déjà traité.
      if(!c.dedans.has(autre)){
        c.dedans.add(autre);
        try{ c.fn(autre); }
        catch(e){ logConsole('error', 'api.onContact : ' + e.message, c.obj); }
      }
    }
    // sorties : un objet détruit ou éloigné doit pouvoir redéclencher plus tard
    c.dedans.forEach(function(o){ if(!vus.has(o)) c.dedans.delete(o); });
  });
}


// ---------- La SOURIS (api.mouse, api.click, api.clickHeld) ----------
// Un moteur de jeu dont les scripts ne peuvent pas lire la souris ne sait pas faire la moitié des
// jeux : viser, poser, glisser, choisir une colonne. Le navigateur a les événements depuis
// toujours, rien ne les exposait — le même défaut que le reste de ce dépôt, en plus large.
//
// La position est rendue en coordonnées NORMALISÉES (-1 à +1, origine au centre, y vers le haut),
// pas en pixels : c'est ce dont on a besoin pour viser, et c'est la seule forme qui ne change pas
// quand la fenêtre change de taille. Les pixels restent disponibles pour qui en veut.
export const mouseGame = {x: 0, y: 0, px: 0, py: 0, dans: false, buttons: new Set()};
export let buttonsPrev = new Set();

export function updateMouseFrom(e, target){
  const r = target.getBoundingClientRect();
  if(!r.width || !r.height) return;
  mouseGame.px = e.clientX - r.left;
  mouseGame.py = e.clientY - r.top;
  mouseGame.x = (mouseGame.px / r.width) * 2 - 1;
  mouseGame.y = -((mouseGame.py / r.height) * 2 - 1);
  mouseGame.dans = mouseGame.px >= 0 && mouseGame.py >= 0
                && mouseGame.px <= r.width && mouseGame.py <= r.height;
}
// La cible : la vue de l editeur. Les coordonnees doivent etre relatives a CE cadre, pas a la
// page — sinon un panneau lateral decale tout le pointage sans que rien ne le dise.
addEventListener('pointermove', function(e){
  const c = document.querySelector('#view canvas') || document.querySelector('canvas');
  if(c) updateMouseFrom(e, c);
});
// LE TOUCHER NE PASSE PAS PAR pointermove : un doigt qui tape sans glisser n'émet qu'un
// pointerdown. Sans cette mise à jour, `api.mouse()` et `api.pick()` visaient l'endroit du tap
// PRÉCÉDENT — sur tablette, chaque touche tombait à côté.
addEventListener('pointerdown', function(e){
  const c = document.querySelector('#view canvas') || document.querySelector('canvas');
  if(c) updateMouseFrom(e, c);
  mouseGame.buttons.add(e.button);
});
addEventListener('pointerup',   function(e){ mouseGame.buttons.delete(e.button); });
addEventListener('blur', function(){ mouseGame.buttons.clear(); });

// ---------- La SOURIS RELATIVE et la CAPTURE DU POINTEUR (api.mouseDelta, api.lockMouse) ----------
// Une vue à la première personne ne se pilote PAS avec la position du pointeur. Deux raisons
// mesurées en écrivant un FPS (jeux/NeonBreach) :
//   · sans capture, le pointeur bute sur le bord de la fenêtre au bout d'un quart de tour, et la
//     vue se bloque net ;
//   · sous capture, la position ne bouge PLUS DU TOUT — le curseur est retiré de l'écran. La
//     seule mesure qui continue d'arriver est le DÉPLACEMENT relatif de l'image.
// Le navigateur a `movementX`/`movementY` et l'API de capture depuis toujours ; rien ne les
// exposait, exactement comme la souris elle-même avant la v0.68.0. Sans ces trois entrées, ce
// moteur ne peut pas faire un seul jeu à la première personne.
//
// Miroir de l'autre moteur, comme le bloc de souris ci-dessus, et gardé par le même test
// (test/souris-script.test.mjs).
export const mouseLook = {dx: 0, dy: 0, wanted: false};

export function canvasGame(){
  return document.querySelector('#view canvas') || document.querySelector('canvas');
}

// Les deltas s'ACCUMULENT sur l'image. Plusieurs pointermove arrivent entre deux rendus : ne
// garder que le dernier jetterait la moitié du mouvement dès que l'image tombe à 30/s, et la
// visée deviendrait plus lente quand le jeu rame — l'inverse de ce qu'on veut.
//
// DEUX FILTRES, sans lesquels la caméra « se retourne » toute seule :
//   - hors capture, rien ne s'accumule : sinon le trajet du curseur jusqu'au clic de capture
//     arrivait d'un bloc à la première image capturée ;
//   - un pic isolé est jeté. Chrome sous Windows émet par moments, en capture, un movementX de
//     plusieurs centaines de pixels qui ne correspond à aucun geste (bug connu du navigateur).
//     Aucune main ne fait 400 px entre deux événements pointermove.
const MOUSE_SPIKE_PX = 400;
addEventListener('pointermove', function(e){
  if(!pointerLockedGame()) return;
  if(Math.abs(e.movementX || 0) > MOUSE_SPIKE_PX || Math.abs(e.movementY || 0) > MOUSE_SPIKE_PX) return;
  mouseLook.dx += e.movementX || 0;
  mouseLook.dy += e.movementY || 0;
});

// LA CAPTURE NE S'OBTIENT QUE DANS UN GESTE UTILISATEUR. `requestPointerLock()` appelé depuis la
// boucle de rendu est refusé par le navigateur, et refusé SANS BRUIT : une promesse rejetée que
// personne ne lit. Le script déclare donc son INTENTION (api.lockMouse(true)) et c'est le
// prochain clic qui la réalise. Échap rend la main au joueur ; l'intention restant posée, le clic
// suivant reprend la capture — le cycle de tous les jeux du genre.
addEventListener('pointerdown', function(){
  if(!mouseLook.wanted || pointerLockedGame()) return;
  const c = canvasGame();
  if(!c || !c.requestPointerLock) return;
  // Mouvement brut (sans l'accélération du système) quand le navigateur le permet : c'est aussi
  // ce qui supprime l'essentiel des pics parasites. Repli sur la capture simple sinon.
  let p = null;
  try{ p = c.requestPointerLock({unadjustedMovement: true}); } catch(e){ p = null; }
  if(p && typeof p.catch === 'function') p.catch(function(){ try{ c.requestPointerLock(); } catch(e){ /* refusée */ } });
});

// La capture est COMPARÉE à notre toile, pas testée en booléen : une capture posée ailleurs dans
// la page ne doit pas se lire comme « le jeu tient la souris ».
export function pointerLockedGame(){
  return !!(document.pointerLockElement && document.pointerLockElement === canvasGame());
}

// ---------- Input Map (actions nommées ; éditable via Fichier → Entrées) ----------
// LA MANETTE EST DANS LA MÊME TABLE QUE LE CLAVIER, et c'est tout le choix de conception :
// `'pad:0'` est une touche comme `' '`. Elle est posée dans le jeu de touches par
// js/gamepad-input.js, donc `actionActive`, `api.key()`, l'instantané réseau et le panneau
// Entrées la traitent sans une ligne de plus.
//
// Les indices suivent la disposition standard du W3C : 0 = A/croix, 2 = X/carré, 12 à 15 = croix
// directionnelle. Les axes portent une TROISIÈME case facultative, la source analogique :
// `'pad:axis1-'` branche le stick gauche vertical INVERSÉ, parce que l'axe Y d'une manette est
// positif vers le bas et celui du moteur vers le haut.
//
// Ce sont des DÉFAUTS, pas une contrainte : ils vivent dans le projet et se rééditent. Une
// manette exotique, que la norme ne décrit pas, se recâble ici.
export const INPUTS_DEFAULT = {
  actions: {
    advance:  ['z', 'w', 'ArrowUp', 'pad:12'],
    back:     ['s', 'ArrowDown', 'pad:13'],
    left:     ['q', 'a', 'ArrowLeft', 'pad:14'],
    right:    ['d', 'ArrowRight', 'pad:15'],
    jump:     [' ', 'pad:0'],
    interact: ['e', 'pad:2']
  },
  axes: {
    horizontal: ['left', 'right', 'pad:axis0'],   // [négatif, positif, source analogique]
    vertical:   ['back', 'advance', 'pad:axis1-']
  }
};

export function inputsCurrent(){
  return project.inputs ? project.inputs : INPUTS_DEFAULT;
}

export function actionActive(name){
  const keys = inputsCurrent().actions[name];
  // `steam:<action>` : la touche posée par Steam Input, liée d'office à l'action du même nom.
  return !!(keys && (keysGame.has('steam:' + name) || keys.some(function(k){ return keysGame.has(k); })));
}

// Photo des entrées locales, envoyée à l'autorité par un client distant. On
// transmet les AXES et les actions active, pas les cles : la table d'entrées
// peut différer d'un poste à l'autre (clavier AZERTY ou QWERTY), alors que le
// sens du jeu — « advance », « sauter » — est le même partout.
export function snapshotInputs(){
  const e = inputsCurrent();
  const actions = [];
  Object.keys(e.actions || {}).forEach(function(name){
    if(actionActive(name)) actions.push(name);
  });
  const axes = {};
  Object.keys(e.axes || {}).forEach(function(name){
    const paire = e.axes[name];
    axes[name] = (actionActive(paire[1]) ? 1 : 0) - (actionActive(paire[0]) ? 1 : 0);
  });
  return {axes: axes, actions: actions};
}

// Le drapeau de `api.pause()` côté éditeur. Il vivait dans l'objet du mode lecture en page
// (js/play-mode.js), retiré avec lui (docs/REVUE_2026-09-29.md § 6.1). Dans l'éditeur, rien ne
// le lit pour figer le monde — seul le jeu publié (js/game-runtime.js) met vraiment en pause :
// l'entrée d'api se contente de rendre ce qu'on lui a donné, pour qu'un script s'y comporte
// pareil.
let pausedByScript = false;

export function ensureScripts(o){
  if(!o.userData.scripts) o.userData.scripts = [];
  return o.userData.scripts;
}

export function aOfScripts(o){
  // Le code étant sur l'asset référencé, un objet « porte un script » quand sa référence
  // RÉSOUT : une entrée dont l'asset a disparu ne compte pas, puisque rien ne s'exécutera.
  return ensureScripts(o).some(function(s){
    return s.active && codeOfScriptEntry(s).trim();
  });
}

// alias retro-compatible : "a-t-il AU MOINS un script active" (old contrat mono-script)
export function aScript(o){ return aOfScripts(o); }

// Lit un bloc /* @vars {...} */ optionnel en tete d'un script — une déclaration JSON des
// clés que le script attend dans api.props(). Ne lit AUCUNE variable locale du code (new
// Function() ne les expose pas) ; ce bloc ne fait QUE préremplir et typer
// userData.game.props, qui existe déjà et est le seul canal de données lu ici.
export function analyzeVarsDeclared(code){
  const m = /\/\*\s*@vars\s*(\{[\s\S]*?\})\s*\*\//.exec(code || '');
  if(!m) return null;
  try{
    const decl = JSON.parse(m[1]);
    if(!decl || typeof decl !== 'object' || Array.isArray(decl)) return null;
    // types tolérés : ceux que convertirValeurProp sait déjà gérer, pour ne jamais produire
    // une valeur que l'inspecteur ou la sérialisation ne saurait pas relire ensuite
    const propre = {};
    Object.keys(decl).forEach(function(k){
      const v = decl[k];
      if(typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') propre[k] = v;
    });
    return propre;
  } catch(e){ return null; }
}

// fusionne les clés déclarées dans props SANS écraser une valeur déjà personnalisée par
// l'utilisateur pour cette clé (une nouvelle clé ajoutée au script obtient sa valeur par
// défaut ; une clé déjà réglée dans l'inspecteur garde sa valeur actuelle)
export function mergeVarsDeclared(o, code){
  const decl = analyzeVarsDeclared(code);
  if(!decl) return;
  const game = ensureGame(o);
  Object.keys(decl).forEach(function(k){
    if(!(k in game.props)) game.props[k] = decl[k];
  });
}

/**
 * Une réécriture d'asset script retombe sur TOUS ses porteurs, tout de suite.
 *
 * La fusion à la compilation (`compiledOf`) ne servait qu'en jeu : en édition, `get_object` et
 * l'inspecteur continuaient de montrer `{a:1}` après l'ajout d'une clé `b`, et
 * `write_script_asset` ne fusionnait rien du tout. Ici, à l'écriture du code :
 *  - `userData.game.props` reçoit le défaut de chaque clé @vars NOUVELLE (l'existant est gardé) ;
 *  - les `values` des composants ScriptJS reçoivent le défaut de chaque @expose nouvelle ;
 *  - les scènes du projet NON chargées sont mises à jour dans leurs données sérialisées.
 * Rend le nombre d'objets de la scène courante concernés.
 */
export function syncScriptVarsOfAsset(asset){
  if(!asset || asset.kind !== 'script') return 0;
  const code = asset.code || '';
  const holders = holdersOfScriptAsset(asset.id);
  holders.forEach(function(o){
    mergeVarsDeclared(o, code);
    (o.getComponents ? o.getComponents('ScriptJS') : []).forEach(function(c){
      if(!c || !c.entry || c.entry.scriptId !== asset.id) return;
      if(!c.entry.values) c.entry.values = {};
      (c.exposures || []).forEach(function(e){
        if(!(e.name in c.entry.values)) c.entry.values[e.name] = e.defaultValue;
      });
    });
  });
  const decl = analyzeVarsDeclared(code);
  if(decl && project && Array.isArray(project.scenes)){
    project.scenes.forEach(function(sc, i){
      if(i === project.current || !sc || !sc.data || !Array.isArray(sc.data.objects)) return;
      sc.data.objects.forEach(function(d){
        const uses = (d.components || []).some(function(c){
          return c && c.type === 'ScriptJS' && c.data && c.data.scriptId === asset.id;
        });
        if(!uses) return;
        if(!d.game) d.game = {tag: '', layer: 'Défaut', props: {}};
        if(!d.game.props) d.game.props = {};
        Object.keys(decl).forEach(function(k){ if(!(k in d.game.props)) d.game.props[k] = decl[k]; });
      });
    });
  }
  return holders.length;
}

// Résout un identifiant de calque (id numérique, id en chaîne, ou nom legacy) vers l'id
// canonique de projet.layers ; renvoie l'entrée telle quelle si rien ne correspond, pour que
// la comparaison directe à userData.game.calque (chaîne libre pré-Lot 2) continue de fonctionner.
export function resolveLayer(cOrName){
  if(cOrName === undefined || cOrName === null) return cOrName;
  const table = project.layers ? project.layers : LAYERS_DEFAULT;
  const byId = table.find(function(l){ return l.id === cOrName || String(l.id) === String(cOrName); });
  if(byId) return byId.id;
  const byName = table.find(function(l){ return l.name === cOrName; });
  if(byName) return byName.id;
  return cOrName;   // ni id ni name connu : comparaison directe (legacy)
}
export function sameLayer(objectLayer, request){
  const resolvedRequest = resolveLayer(request);
  const resolvedObject = resolveLayer(objectLayer);
  return resolvedObject === resolvedRequest || objectLayer === request;
}

// Résout les valeurs @expose (component-script.js) d'UN script précis vers des valeurs
// utilisables directement : 'node' → objet de la scène par nom, 'component:X' → composant
// de type X sur ce noeud (ou sur le noeud nommé par la valeur), les autres types passent tels quels.
// Un index par nom, reconstruit une fois par image au premier besoin : `objects.find` par champ
// et par script, à chaque image, coûtait O(scripts × objets) (revue du 2026-09-29, § 5.4). Même
// règle que le jeu publié (rtObjectByName, js/game-runtime.js).
let _nameIndex = null, _nameIndexTime = -1;
function objectByName(name){
  if(_nameIndexTime !== engineScripts.time || !_nameIndex){
    _nameIndex = new Map();
    objects.forEach(function(x){ if(!_nameIndex.has(x.name)) _nameIndex.set(x.name, x); });
    _nameIndexTime = engineScripts.time;
  }
  return _nameIndex.get(name) || null;
}

export function resolveValuesExposed(o, component){
  const result = {};
  if(!component) return result;
  component.exposures.forEach(function(e){
    const raw = component.values[e.name];
    if(e.type === 'node'){
      result[e.name] = raw ? objectByName(raw) : null;
    } else if(e.type.indexOf('component:') === 0){
      const typeComponent = e.type.slice('component:'.length);
      const nodeTarget = raw ? objectByName(raw) : o;
      result[e.name] = (nodeTarget && nodeTarget.getComponent) ? nodeTarget.getComponent(typeComponent) : null;
    } else {
      result[e.name] = raw;
    }
  });
  return result;
}

// Retrouve le composant ScriptJS qui porte l'entrée userData.scripts[i] (plusieurs
// composants ScriptJS peuvent coexister sur le même noeud, chacun avec ses propres valeurs).
export function scriptComponentOf(o, i){
  if(i === undefined || !o.userData.components) return null;
  const entry = (o.userData.scripts || [])[i];
  return o.userData.components.find(function(c){
    return c.constructor.typeName === 'ScriptJS' && c.entry === entry;
  }) || null;
}

// L'API passée aux scripts — documentée dans Aide → API de scripts
// L'api est en ANGLAIS. Il n'y a plus d'alias francais : le mecanisme existait pour ne
// casser aucun project deja ecrit, et sa table portait le francais dans ses cles.
// L'OBJET API EST CONSTRUIT UNE FOIS PAR (OBJET, SCRIPT), et plus une fois par image.
//
// Le littéral ci-dessous porte cinquante-sept clés, presque toutes des fonctions anonymes. Il
// était reconstruit à CHAQUE APPEL, c'est-à-dire une fois par script actif et par image : cent
// objets scriptés à 60 images/s faisaient environ six cents mille fermetures par seconde,
// jetées aussitôt. C'était le premier poste de pression du ramasse-miettes du moteur.
// Voir docs/REVUE_2026-09-10.md § 2.2.
//
// Rien dans ces fermetures ne dépend de l'image, SAUF `dt` — et seulement dans deux d'entre
// elles (`moveTo`, `patrol`). Elles lisent donc `frame.dt`, un petit porteur mutable, au lieu de
// capturer la valeur. Les six champs de DONNÉES qui changent (`dt`, `dtReal`, `time`, `scene`,
// `expose`, `network`) sont réécrits sur l'objet à chaque appel, ci-dessous.
//
// Effet de bord voulu : le `api` que voit le NIVEAU SUPÉRIEUR d'un script (celui passé à la
// compilation) est désormais le même objet que celui de `update()`, donc à jour. Avant, il
// gardait pour toujours le `dt: 0` de l'instant de la compilation.
export const _apiCache = new WeakMap();   // objet → Map(index de script → {api, frame})

export function apiFor(o, dt, i){
  let parIndex = _apiCache.get(o);
  if(!parIndex){ parIndex = new Map(); _apiCache.set(o, parIndex); }
  let e = parIndex.get(i);
  if(!e){
    // `frame` est passé au constructeur : les deux fermetures qui ont besoin de `dt` le LISENT
    // dessus, et `apiFor` l'écrit. C'est tout ce qui reste de dépendant de l'image.
    const frame = { dt: 0 };
    e = { api: buildApi(o, i, frame), frame: frame };
    parIndex.set(i, e);
  }
  const api = e.api;
  e.frame.dt = dt;
  api.dt = dt;
  api.dtReal = dt;
  api.time = engineScripts.time;
  api.scene = scene;
  api.expose = resolveValuesExposed(o, scriptComponentOf(o, i));
  // `api.network` n'est PAS reecrit : `networkHandle()` rend un singleton memoise
  // (js/network-game.js), donc la valeur posee a la construction reste la bonne.
  return api;
}

/** L'hôte des bibliothèques de la partie en cours, créé au premier api.lib(). */
function librariesHost(o){
  if(!engineScripts.libraries){
    engineScripts.libraries = libraryHostForAssets(function(){ return assets; }, {
      data: function(name){ return apiFor(o, 0, 0).data(name); },
      log: function(m){ logConsole('log', String(m), o); },
      warn: function(m){ logConsole('warn', String(m), o); },
      error: function(m){ logConsole('error', String(m), o); }
    }, function(name, n){
      logConsole('warn', 'api.lib : ' + n + ' scripts s\'appellent « ' + name + ' » — le premier est lu', o);
    });
  }
  return engineScripts.libraries;
}

export function buildApi(o, i, frame){
  return ({
    me: o,                                     // l'objet three.js porteur du script
    node: o,                                    // alias Unity-like : api.node.getComponent('Mesh')
    dt: 0,
    // Le dt REEL, celui qui continue de courir quand le jeu est en pause. Ici il vaut toujours
    // dt : l editeur n a pas de boucle de jeu a geler. Il existe pour que le meme script tourne
    // des deux cotes — un menu de pause ecrit pour le jeu publie ne doit pas planter en edit.
    dtReal: 0,                                      // durée de l'image (s) — réécrit par apiFor
    time: 0,                                   // temps écoulé depuis le lancement (s)
    scene: null,
    expose: null,                              // variables @expose de CE script — réécrit par apiFor
    find: function(name){ return objects.find(function(x){ return x.name === name; }) || null; },
    findNode: function(name){ return objects.find(function(x){ return x.name === name; }) || null; },
    // LE TAG EST DANS `userData.game.tag`, jamais dans `userData.tag`. Cette ligne lisait le
    // second — que RIEN dans le moteur n'écrit — et rendait donc toujours un tableau empty.
    // Aucune erreur, aucun avertissement : un ennemi introuvable ressemble à un ennemi
    // absent de la scène, et on va chercher le défaut dans la scène. Découvert en auditant
    // l'aide, parce que documenter cette entrée demandait de dire ce qu'elle rend.
    //
    // LE CORPS PASSE PAR LE REGISTRY, plus par un balayage de la scène. `nodesByTag`
    // (js/components/component-tag.js) était écrit pour ça et n'avait AUCUN appelant : les
    // quatre `api.byTag`/`api.findByTag` des deux moteurs tenaient chacun leur
    // `objects.filter(...)`, c'est-à-dire un parcours de toute la scène à chaque appel, dans une
    // fonction que les scripts appellent en `update()`. Le composant Tag n'est posé que sur les
    // objets réellement étiquetés, donc la lecture suit le nombre d'étiquettes, pas la taille de
    // la scène — la promesse que le commentaire de `Tag` faisait déjà. Voir
    // docs/REVUE_2026-09-10.md § 1.6.
    //
    // `findByTag` et `byTag` sont deux noms d'une seule fonction : elle est écrite une fois.
    findByTag: nodesByTag,
    byTag: nodesByTag,
    byLayer: function(c){
      return objects.filter(function(x){ return x.userData.game && sameLayer(x.userData.game.layer, c); });
    },
    props: function(target){ return ensureGame(target || o).props; },
    // (voir aussi expose ci-dessus : variables @expose du composant ScriptJS de CE script)
    tag: function(target){ return ensureGame(target || o).tag; },
    key: function(k){ return keysGame.has(k); },
    mouse: function(){ return {x: mouseGame.x, y: mouseGame.y,
                                px: mouseGame.px, py: mouseGame.py, dans: mouseGame.dans}; },
    click: function(button){ return mouseGame.buttons.has(button === undefined ? 0 : button); },
    clickHeld: function(button){
      const b = (button === undefined) ? 0 : button;
      return mouseGame.buttons.has(b) && !buttonsPrev.has(b);
    },   // ex. 'ArrowLeft', 'a', ' '
    mouseDelta: function(){ return {x: mouseLook.dx, y: mouseLook.dy}; },
    lockMouse: function(wanted){
      mouseLook.wanted = (wanted !== false);
      if(!mouseLook.wanted && document.exitPointerLock) document.exitPointerLock();
      return pointerLockedGame();
    },
    mouseLocked: function(){ return pointerLockedGame(); },

    // Input Map — préférer ces trois fonctions à api.key()
    action: function(name){ return actionActive(name); },
    actionPressed: function(name){
      const keys = inputsCurrent().actions[name] || [];
      return keys.some(function(k){
        return keysGame.has(k) && !engineScripts.keysPrev.has(k);
      });
    },
    axis: function(name){
      const paire = inputsCurrent().axes[name];
      if(!paire) return 0;
      return combineAxis((actionActive(paire[1]) ? 1 : 0) - (actionActive(paire[0]) ? 1 : 0), name);
    },

    distance: function(a, b){
      // Deux vecteurs mutualises : cette fonction est la brique de toute detection de
      // proximite, donc appelee en boucle par les scripts.
      return (a || o).getWorldPosition(_apiVecA).distanceTo((b || o).getWorldPosition(_apiVecB));
    },
    lookAt: function(target){
      if(target) o.lookAt(target.getWorldPosition(new THREE.Vector3()));
    },

    // création / destruction / activation
    // UNE PLANCHE EST UN ASSET COMME UN AUTRE. Avant, seuls `prefab` et `model` passaient, et un
    // game 2D n'avait donc AUCUN medium de faire apparaître quoi que ce soit : ni projectile, ni
    // ramassage qui tombe, ni vague d'ennemis, ni éclat — la moitié de ce qui fait un jeu. La
    // seule voie était de fabriquer un prefab à la main dans l'interface, et aucune commande du
    // copilote ne sait le faire non plus.
    create: function(nameAsset, position){
      const a = assets.find(function(x){
        return x.name === nameAsset
          && (x.kind === 'prefab' || x.kind === 'model' || x.kind === 'sprite');
      });
      if(!a){ logConsole('warn', 'api.create : asset « ' + nameAsset + ' » introuvable', o); return null; }
      let copie;
      if(a.kind === 'sprite'){
        copie = new THREE.Group();
        copie.name = a.name;
        copie.userData.type = 'group';       // retagué par le composant, comme partout ailleurs
        applyNodeMixin(copie);
        copie.addComponent('SpriteRenderer', {spriteId: a.id, region: '', layer: 'Jeu',
          order: 0, teinte: '#ffffff', retourneX: false, retourneY: false, sortDepth: false});
      } else {
        copie = cloneModel(a.template);
        reenableSubTree(copie);
        if(a.kind === 'prefab') copie.userData.prefabId = a.id;
      }
      if(position) copie.position.set(position.x || 0, position.y || 0, position.z || 0);
      // À LA RACINE DE LA SCÈNE, comme tout le reste : il n'y a plus de « monde 2D » sous
      // lequel ranger les objets à sprite.
      scene.add(copie);
      addSceneObject(copie);
      // LA PHYSIQUE AUSSI, miroir de js/game-runtime.js : sans body, l'objet engendré ne tombe
      // pas, ne heurte rien, et api.setVelocity n'a rien à pousser.
      // `_meshSprite` ne survit pas au clone : le recâbler (voir `bindSpriteMesh`).
      copie.traverse(function(x){ if(x.userData.sprite2d) bindSpriteMesh(x); bindBodyPhysics(x); });
      updateHierarchy();
      applyFilters();
      return copie;
    },
    // animations des modèles importés (glTF / FBX)
    animations: function(target){ return namesAnimations(target || o); },
    playAnimation: function(target, name, opts){
      // tolère api.playAnimation('Marche') : la cible par défaut est l'objet du script
      if(typeof target === 'string'){ opts = name; name = target; target = o; }
      const ok = playAnimationModel(target || o, name, opts);
      if(!ok) logConsole('warn', 'api.playAnimation : aucune animation « '
        + name + ' » sur cet objet', target || o);
      return ok;
    },
    stopAnimation: function(target){ stopAnimationModel(target || o); },
    // WebXR : jamais installé dans l'éditeur — `api.xr.presenting()` y rend false et chaque
    // manette répond « non connectée ». Un script XR tourne donc sans erreur en simulation.
    xr: XRRuntime.api,
    /**
     * La machine à états de l'objet : `api.animator().setTrigger('saute')`.
     *
     * Rend null — avec un avertissement, jamais une exception — si l'objet ne porte pas
     * d'AnimatorController. Même politique que `api.playAnimation` : un script qui plante
     * arrête tout le reste du script, alors qu'un avertissement se lit et se corrige.
     *
     * `holderAnimator` remonte les parents : l'Animator est souvent sur le groupe et le
     * script sur le modèle qui est dedans.
     */
    animator: function(target){
      const node = holderAnimator(target || o);
      const l = node ? playerAnimatorOf(node) : null;
      if(!l){
        logConsole('warn', 'api.animator : cet objet ne porte pas d\'AnimatorController',
          target || o);
        return null;
      }
      return createObjectAnimator(l, l.machine, function(name){
        logConsole('warn', 'api.animator : « ' + name + ' » n\'est pas un paramètre de '
          + 'cette machine', target || o);
      });
    },
    // Mélange par os : « marcher en bas, viser en haut ». La couche prend l'os nommé et toute
    // sa descendance ; la base garde le reste, sans recouvrement (js/anim-blend.js).
    layerAnimation: function(target, name, opts){
      if(typeof target === 'string'){ opts = name; name = target; target = o; }
      const ok = layerAnimation(target || o, name, opts);
      if(!ok) logConsole('warn', 'api.layerAnimation : « ' + name + ' » depuis « '
        + ((opts && opts.depuis) || '?') + ' » n\'a pas pu être posée — clip absent, os '
        + 'introuvable, ou aucune animation de base en cours', target || o);
      return ok;
    },
    removeLayer: function(target, depuis){
      if(typeof target === 'string'){ depuis = target; target = o; }
      return removeLayer(target || o, depuis);
    },

    destroy: function(target){
      if(target && engineScripts.aDestroy.indexOf(target) === -1) engineScripts.aDestroy.push(target);
    },
    // `actifVoulu` double `visible` parce qu'un objet regroupé dans un InstancedMesh a
    // DÉJÀ visible = false : écrire `visible` dessus ne changerait rien et le masquage
    // demandé par le script n'aurait aucun effet, sans erreur. C'est l'intention qui est
    // lue par updateInstances (js/render-perf.js), pas l'état.
    // L'activité arrête AUSSI les scripts de l'objet et de ses descendants (isActiveInHierarchy) ;
    // `visible` seul ne fait que masquer le rendu.
    setActive: function(target, active){
      if(!target) return;
      target.userData.activeVoulu = (active !== false);
      target.visible = (active !== false);
    },
    isActive: function(target){ return isActiveInHierarchy(target || o); },

    // Dimensions RÉELLES d'un objet, échelle comprise. Les primitives du moteur
    // ne font pas une unité (cube = 1,6, sphère de rayon 1) : sans ça, on place
    // des objets qui se chevauchent en croyant les espacer.
    bounds: function(target){
      const b = _apiBox.setFromObject(target || o);
      if(b.isEmpty()) return null;
      return {
        min: {x:b.min.x, y:b.min.y, z:b.min.z},
        max: {x:b.max.x, y:b.max.y, z:b.max.z},
        size: {x:b.max.x - b.min.x, y:b.max.y - b.min.y, z:b.max.z - b.min.z},
        center: {x:(b.min.x + b.max.x)/2, y:(b.min.y + b.max.y)/2, z:(b.min.z + b.max.z)/2}
      };
    },

    // Appelé une fois à l'ENTRÉE en contact avec un objet portant ce tag.
    // Remplace la comparaison de distances à chaque image sur chaque cible.
    onContact: function(tag, fn){
      engineScripts.contacts.push({obj:o, tag:tag, fn:fn, dedans:new Set()});
    },

    // Contrôleur de personnage (js/game-character.js). Un appel par image remplace
    // la trentaine de lignes de gravité + détection de sol que tout jeu de
    // plateforme réécrit. L'état vit dans une WeakMap et NON dans les
    // propriétés de l'objet : celles-ci sont sérialisées avec le projet, et y
    // ranger un rayon calculé ou une vitesse en cours polluerait la sauvegarde.
    moveCharacter: function(options){
      let state = engineScripts.persos.get(o);
      if(!state){ state = {}; engineScripts.persos.set(o, state); }
      return characterUpdate(this, state, options);
    },
    respawn: function(position){
      const state = engineScripts.persos.get(o);
      if(state) characterRespawn(this, state, position);
    },
    bounce: function(force){
      const state = engineScripts.persos.get(o);
      if(state) characterBounce(state, force);
    },

    // physique
    applyForce: function(target, f){
      const link = phys.links.find(function(l){ return l.obj === (target || o); });
      if(link) link.body.applyImpulse(new CANNON.Vec3(f.x || 0, f.y || 0, f.z || 0), link.body.position);
    },
    velocity: function(target){
      const link = phys.links.find(function(l){ return l.obj === (target || o); });
      return link ? {x:link.body.velocity.x, y:link.body.velocity.y, z:link.body.velocity.z} : null;
    },
    // Téléportation. La physique écrit CORPS → objet et jamais l'inverse :
    // écrire dans .position depuis un script était donc effacé à l'image
    // suivante, ce qui rendait impossible de faire réapparaître un personnage
    // en corps rigide. On déplace le corps, et on remet sa vitesse à zéro pour
    // ne pas repartir avec l'élan de la chute.
    setPosition: function(target, p){
      const c = target || o;
      const link = phys.links.find(function(l){ return l.obj === c; });
      if(link){
        link.body.position.set(p.x, p.y, p.z);
        link.body.velocity.set(0, 0, 0);
        link.body.angularVelocity.set(0, 0, 0);
      }
      if(c.parent && c.parent !== scene) c.position.copy(c.parent.worldToLocal(new THREE.Vector3(p.x, p.y, p.z)));
      else c.position.set(p.x, p.y, p.z);
      return c;
    },
    setVelocity: function(target, v){
      const link = phys.links.find(function(l){ return l.obj === (target || o); });
      if(!link) return null;
      link.body.velocity.set(
        v.x !== undefined ? v.x : link.body.velocity.x,
        v.y !== undefined ? v.y : link.body.velocity.y,
        v.z !== undefined ? v.z : link.body.velocity.z);
      return link.body.velocity;
    },
    // `filtre` optionnel : {tag:'ground'} ou {calque:'Décor'}. Sans lui, seul le
    // PREMIER impact est rendu — une pièce flottant devant une plateforme
    // cassait donc la détection de sol. Avec, on ignore ce qui ne compte pas.
    // LE RAYON SOUS LE POINTEUR (souris ou doigt), depuis la caméra du jeu — l'équivalent de
    // ScreenPointToRay. Sans lui, un jeu « toucher la cible » devait refaire la projection à la
    // main, donc connaître la caméra, son champ et le rapport de l'écran.
    pointerRay: function(){ return pointerRayOf(camCurrent()); },
    pick: function(filter, distance){
      const r = pointerRayOf(camCurrent());
      return r ? this.raycast(r.origin, r.direction, distance || 1000, filter) : null;
    },
    raycast: function(origine, direction, distance, filter){
      scene.updateMatrixWorld();   // les objets créés dans la même image sont pris en compte
      // Le rayon et la liste de candidats sont mutualises. La liste garde la MEME semantique
      // qu'avant — tout sauf le porteur lui-meme — mais sans reallouer un tableau par appel.
      _apiRay.set(_apiVecA.set(origine.x, origine.y, origine.z),
                  _apiVecB.set(direction.x, direction.y, direction.z).normalize());
      _apiRay.near = 0;
      _apiRay.far = distance || 100;
      // Le filtre est appliqué AVANT l'intersection (voir js/raycast-candidates.js).
      raycastCandidates(objects, o, filter, rootHandled, sameLayer, _apiCandidats);
      const hits = _apiRay.intersectObjects(_apiCandidats, false);
      if(!hits.length) return null;
      return {object: rootHandled(hits[0].object), point: hits[0].point, distance: hits[0].distance};
    },
    // Le chevauchement 2D : la brique des portes, des ramassages et des zones de dégât. Sans
    // elle, un jeu vu de dessus se rabat sur `api.distance`, qui donne un déclencheur ROND là où
    // tout le reste du monde est carré — un coffre qu'on ouvre en frôlant son coin.
    overlaps2d: function(target, autre){
      const b = (n) => {
        if(!n) return null;
        const e = new THREE.Box3().setFromObject(n);
        return box2dOf(n, e.isEmpty() ? null : e);
      };
      const A = b(target), B = b(autre || o);
      return !!(A && B && overlap2d(A, B));
    },
    // CHOISIR L'IMAGE D'UN SPRITE, et LIRE LA DIRECTION REGARDÉE. Les deux vont ensemble : sur une
    // planche vue de dessus, chaque case est un couple (direction, état), et il n'existe aucune
    // animation qui les enchaîne — c'est le jeu qui décide, à chaque image, quelle case montrer.
    // Mesuré en montant un essai jouable : le contrôleur mémorisait bien `regardX`/`regardY`, et
    // rien dans l'API ne permettait ni de les lire, ni de changer la case. Le personnage marchait
    // en huit directions en regardant toujours dans le même sens.
    spriteImage: function(target, nameRegion){
      const n = (typeof target === 'string') ? target : null;
      const c = n ? o : (target || o);
      const name = n || nameRegion;
      // LE NOM EST VÉRIFIÉ ICI, et pas laissé au rendu. `regionOfSprite` retombe volontairement sur
      // la première image quand le nom est inconnu — c'est ce qui empêche un sprite de disparaître
      // après qu'on a renommé sa région, et ça doit rester. Mais pour un script, ce repli est un
      // piège muet : une faute de frappe montre la pose n° 1 pour toujours, à chaque image, et
      // rien ne le dit. Mesuré : `api.spriteImage('img_inexistante')` changeait bel et bien
      // l'affichage et rendait `true`.
      const d = c && c.userData && c.userData.sprite2d;
      const a = d && (typeof assets !== 'undefined')
        ? assets.find(function(x){ return x.id === d.spriteId && x.kind === 'sprite'; }) : null;
      if(name && a && !(a.regions || []).some(function(r){ return r && r.name === name; })) return false;
      return updateImageSprite(c, name);
    },
    aim2d: function(target){
      const e = ((target || o).userData || {})._ctrl2d;
      return {x: (e && e.regardX) || 0, y: (e && e.regardY) || 0};
    },
    // LA CARTE DE TUILES, EN LECTURE ET EN ÉCRITURE. Sans ces deux entrées, le décor d'un jeu 2D
    // est un décor peint : aucune porte ne s'ouvre, aucun mur ne se casse, aucun interrupteur ne
    // change quoi que ce soit, et un script ne peut même pas demander « qu'est-ce que j'ai sous les
    // pieds ». Les deux prennent un point du MONDE, pas des indices de grille : c'est ce dont on
    // dispose en game, et la conversion est la première chose qu'on écrirait de travers.
    tileAt: function(target, position){
      const t = aimCell2d(THREE, target, position, o, objects);
      return t ? cellTilemap(t.map, t.x, t.y) : 0;
    },
    setTile: function(target, position, material){
      const t = aimCell2d(THREE, target, position, o, objects);
      if(!t) return false;
      // `setCell` du composant, et pas `setCellTilemap` : c'est lui qui pose `_dirty`, le
      // drapeau que le TilemapSystem consomme. Sans lui, on ouvre une porte qui reste dessinée
      // et qui bloque encore.
      const ok = t.map.setCell(t.x, t.y,
        (material === undefined || material === null) ? 0 : material);
      // L'ÉCRITURE SEULE NE SUFFIT PAS : la géométrie affichée et les bands de collision sont
      // calculées à la construction. Sans reconstruction, on ouvre une porte qui reste dessinée et
      // qui bloque encore — le pire des cas, parce que le jeu a l'air d'avoir répondu.
      if(ok) rebuildTilemap(t.node);
      return ok;
    },
    // LA CAMÉRA 2D, LUE ET RÉGLÉE. Onze réglages existaient, aucun n'était joignable depuis un
    // script : pas de zoom sur un boss, pas de recadrage à l'entrée d'une salle, pas de secousse.
    camera2d: function(settings){
      return setCamera2d(cameraMain2d(objects), settings);
    },
    // JOUER UNE SUITE D'ANIMATION DE SPRITE. `SpriteAnimator` savait enchaîner des images depuis
    // le premier jour, et un script ne pouvait pas lui dire « joue *attaque* maintenant » : une
    // animation ne pouvait donc être que la boucle par défaut. Rejouer la suite DÉJÀ en cours ne
    // la redémarre pas — appeler `jouerSuite('course')` à chaque image est ce qu'on écrit sans y
    // penser, et sans cette garde le personnage resterait figé sur sa première image.
    playSequence: function(target, name, forcer){
      if(typeof target === 'string'){ forcer = name; name = target; target = o; }
      return playAnimSprite(target || o, name, forcer);
    },
    currentSequence: function(target){
      const e = ((target || o).userData || {})._animSprite;
      return (e && e.sequence) || '';
    },
    // LA PAUSE. Miroir de l entree du jeu publie, posee sur le drapeau de l editeur. Le monde
    // s arrete et les SCRIPTS continuent : c est la seule forme qui marche, puisque c est un
    // script qui devra la lever.
    pause: function(active){
      if(active !== undefined) pausedByScript = !!active;
      return pausedByScript;
    },
    overlapSphere: function(position, radius){
      // La sphere et la boite de test sont mutualisees : sans ca c'est UNE Box3 par objet de la
      // scene et par appel, et `setFromObject` parcourt la geometrie.
      _apiSphere.center.set(position.x, position.y, position.z);
      _apiSphere.radius = radius;
      return objects.filter(function(x){
        if(x === o) return false;
        const b = _apiBox.setFromObject(x);
        return !b.isEmpty() && b.intersectsSphere(_apiSphere);
      });
    },

    // temps & événements
    after: function(secondes, fn){
      engineScripts.minuteries.push({t: engineScripts.time + secondes, fn: fn, obj: o});
    },
    emit: function(name, data){
      (engineScripts.ecouteurs[name] || []).forEach(function(fn){
        try{ fn(data); }
        catch(err){ logConsole('error', 'événement « ' + name + ' » : ' + err.message, o); }
      });
    },
    on: function(name, fn){
      (engineScripts.ecouteurs[name] = engineScripts.ecouteurs[name] || []).push(fn);
    },
    uiDocument: function(node){
      const n = node || o;
      return (n && typeof n.getComponent === 'function') ? n.getComponent('UIDocument') : null;
    },
    changeScene: function(name){
      const i = project.scenes.findIndex(function(s){ return s.name === name; });
      if(i === -1) logConsole('warn', 'api.changeScene : scène « ' + name + ' » introuvable', o);
      else engineScripts.sceneDemandee = i;
    },

    // terrain : altitude du sol sculpté sous un point (ou null hors du terrain)
    groundHeight: function(x, z){
      const p = (x === undefined)
        ? o.getWorldPosition(new THREE.Vector3()) : {x: x, z: z};
      for(let i = 0; i < objects.length; i++){
        if(objects[i].userData.type !== 'terrain') continue;
        const h = heightTerrainIn(objects[i], p.x, p.z);
        if(h !== null) return h;
      }
      return null;
    },

    // navigation IA (grille au sol + A*)
    pathTo: function(target){
      const but = navPos(target, objects);
      if(!but){ logConsole('warn', 'api.pathTo : cible introuvable', o); return null; }
      return navFilePath(o.getWorldPosition(new THREE.Vector3()), but, objects);
    },
    moveTo: function(target, speed){
      return navAdvance(o, target, speed, frame.dt, objects);
    },
    patrol: function(points, speed){
      navPatrol(o, points, speed, frame.dt, objects);
    },

    // particules
    particles: function(target){
      const c = target || o;
      if(c.userData.type !== 'particles')
        logConsole('warn', 'api.particles : « ' + c.name + ' » n\'est pas un émetteur', o);
      return {
        emit: function(n){ emitBurst(c, n); },
        setActive: function(active){ if(c.userData.part) c.userData.part.active = (active !== false); }
      };
    },

    // audio
    playSound: function(name, volume, bus){ return playSoundGlobal(name, volume, o, bus); },
    // Les bus de mixage (js/audio-bus.js) : même implémentation que le jeu publié.
    audioBus: function(name){
      return makeAudioBusApi(audioMix, name, function(m){ logConsole('warn', m, o); });
    },
    // Synthé et voix parlée : UNE implémentation partagée avec le jeu publié (js/synth.js).
    playNote: function(id, opts){ return synthApiOf(o).playNote(id, opts); },
    playNotes: function(ids, opts){ return synthApiOf(o).playNotes(ids, opts); },
    notes: function(target){ return synthApiOf(o).notes(target); },
    speak: function(text, opts){ return synthApiOf(o).speak(text, opts); },
    stopSpeaking: function(){ return synthApiOf(o).stopSpeaking(); },
    // ---------- Manette ----------
    // Les BOUTONS ne passent pas par ici : ils sont des touches comme les autres
    // (`api.action('jump')`, `api.key('pad:0')`) — voir js/gamepad-input.js.
    // Ce qui suit est ce qu'une touche ne sait pas dire.
    /** La valeur analogique d'un axe pilote au stick, dans [-1, 1]. 0 sans manette. */
    padAxis: function(name){
      return (typeof gamepadAxis === 'function') ? gamepadAxis(name) : 0;
    },
    /** Le nombre de manettes branchees. Pour afficher « branchez une manette » a propos. */
    gamepads: function(){
      return (typeof gamepadState !== 'undefined') ? gamepadState.connected : 0;
    },
    /**
     * Fait vibrer la manette. `force` dans [0, 1], `ms` en millisecondes.
     * Rend `false` quand le materiel ne sait pas vibrer — beaucoup de manettes et de
     * navigateurs ne le savent pas, et un jeu ne doit jamais en dependre.
     */
    rumble: function(force, ms){
      return (typeof rumbleGamepad === 'function') ? rumbleGamepad(force, ms) : false;
    },
    // ---------- Texte traduit ----------
    // La table vit dans les reglages du projet et voyage avec lui. Une cle absente rend LA CLE
    // elle-meme : un bouton qui affiche « menu.start » se corrige le jour ou on le voit, un
    // bouton vide se decouvre chez le joueur. Voir js/locale.js.
    /** Le texte d'une cle, avec substitution : api.t('score', {n: 42}). */
    t: function(key, params){
      return (typeof translateText === 'function') ? translateText(key, params) : String(key);
    },
    /** La langue active (code court : 'fr', 'en'). */
    locale: function(){
      return (typeof localeCurrent === 'function') ? localeCurrent() : '';
    },
    /** Les langues que le projet fournit — pour construire un menu de choix. */
    locales: function(){
      return (typeof localesAvailable === 'function') ? localesAvailable() : [];
    },
    /**
     * Change la langue en cours de partie et la memorise. Rend `false` si le projet ne la
     * fournit pas — changer pour une langue absente viderait tout le texte du jeu.
     */
    setLocale: function(code){
      return (typeof setLocale === 'function') ? setLocale(code) : false;
    },
    // ---------- Application de bureau ----------
    // Vrai seulement dans le build Electron, ou `preload.js` pose `window.bureau`. Voir
    // js/build-desktop.js.
    /** Le jeu tourne-t-il dans l'application de bureau plutot que dans un navigateur ? */
    desktop: function(){
      return (typeof window !== 'undefined') && !!window.bureau;
    },
    /**
     * Ferme l'application. Rend `false` dans un navigateur, ou c'est IMPOSSIBLE : une page ne
     * peut pas se fermer elle-meme si elle n'a pas ete ouverte par un script. Un bouton
     * « Quitter » doit donc se cacher quand `api.desktop()` est faux, plutot que de ne rien
     * faire quand on le presse.
     */
    quitGame: function(){
      if(typeof window === 'undefined' || !window.bureau) return false;
      window.bureau.quitter();
      return true;
    },
    // ---------- Steam ----------
    // Succès, statistiques, type de manette. INERTE hors de l'application de bureau lancée par
    // Steam : un script écrit pour Steam tourne donc partout. Voir js/steam-bridge.js.
    get steam(){ return makeSteamApi(function(msg){ logConsole('warn', msg, o); }); },
    // La valeur analogique d'un axe piloté au doigt (joystick, glisser) — 0 sans doigt.
    touchAxis: function(name){ return touchAxis(name); },
    audio: function(target){
      const son = sourceAudioOf(target || o);
      if(!son) logConsole('warn', 'api.audio : « ' + (target || o).name + ' » n\'a pas de source audio', o);
      return {
        play: function(){ if(son && !son.isPlaying) son.play(); },
        stop: function(){ if(son && son.isPlaying) son.stop(); },
        volume: function(v){
          if(son && v !== undefined) son.setVolume(Math.max(0, v));
          return son ? son.getVolume() : 0;
        }
      };
    },

    // console
    log: function(msg){ logConsole('log', msg, o); },
    warn: function(msg){ logConsole('warn', msg, o); },
    error: function(msg){ logConsole('error', msg, o); },

    status: function(msg){ setStatus(String(msg), 2000); },

    // ---------- multijoueur ----------
    // Hors ligne, estAutorite() renvoie true : un jeu solo tourne sans savoir
    // que le réseau existe. Passer en ligne ne demande qu'une ligne au script —
    // « if(!api.isAuthority()) return; » — et c'est le test de bonne conception.
    network: networkHandle(),
    isAuthority: networkIsAuthority,

    // ---------- tables de contenu ----------
    // api.data('Ennemis') renvoie le contenu d'un asset de données, analysé
    // une fois puis mis en hidden. C'est ce qui permet de décrire quarante
    // ennemis sans écrire quarante fois du code — et de les faire éditer par
    // quelqu'un qui ne programme pas.
    // L'IMAGE D'UN ASSET TEXTURE, pour un script qui dessine lui-même (un canvas d'interface).
    // Sans elle, un tel jeu refaisait tout son pixel art dans le code à chaque lancement : lourd,
    // et impossible à retoucher dans le panneau Projet. Rend l'élément image — il peut être encore
    // en chargement au premier appel : tester `img.complete && img.naturalWidth` avant de dessiner.
    image: function(name){
      const a = assets.find(function(x){ return x.kind === 'texture' && x.name === name; });
      if(!a){ logConsole('warn', 'api.image : texture « ' + name + ' » introuvable', o); return null; }
      if(a.imageSource) return a.imageSource;
      if(a.texture && a.texture.image && a.texture.image.width) return a.texture.image;
      if(!a._img && a.preview){ a._img = new Image(); a._img.src = a.preview; }
      return a._img || null;
    },
    // Une BIBLIOTHÈQUE : le `exports` d'un asset script, exécuté une fois par partie et partagé
    // par tous ses appelants (js/script-library.js).
    lib: function(name){ return librariesHost(o).lib(name); },
    data: function(name){
      // RÉFÉRENCE PAR NOM, et c'est assumé : `api.data('Ennemis')` est écrit à la main dans le
      // code d'un script, il ne peut pas porter un id. Mais un nom n'est pas unique — deux
      // tables homonymes, et le script en lit une au hasard (la première du tableau), ce qui
      // se voit comme des statistiques d'ennemis « qui ne changent pas » quand on édite l'autre.
      // On ne peut pas trancher à la place de l'utilisateur, on peut le lui DIRE.
      const trouvees = assets.filter(function(x){ return x.kind === 'data' && x.name === name; });
      const a = trouvees[0];
      if(trouvees.length > 1){
        logConsole('warn', 'api.data : ' + trouvees.length + ' tables s\'appellent « ' + name
          + ' » — c\'est la première du projet qui est lue ; renommez les autres', o);
      }
      if(!a){
        logConsole('warn', 'api.data : table « ' + name + ' » introuvable', o);
        return null;
      }
      if(a._cache === undefined || a._cacheText !== a.text){
        try{ a._cache = JSON.parse(a.text); a._cacheText = a.text; }
        catch(e){
          logConsole('error', 'api.data : « ' + name + ' » n\'est pas du JSON valide — '
            + e.message, o);
          a._cache = null; a._cacheText = a.text;
        }
      }
      return a._cache;
    },

    // ---------- état de jeu global ----------
    // api.state.score = 12 — survit aux changements de scène, contrairement aux
    // propriétés d'objets qui sont restaurées à chaque transition.
    get state(){ return engineScripts.state; },
    // Persiste l'état sur la machine du joueur. `name` permet plusieurs
    // emplacements de sauvegarde. Renvoie false si le navigateur refuse
    // (navigation privée, quota) plutôt que de laisser filer une exception.
    save: function(name){
      try{
        // Cloud Steam en plus de localStorage dans l'application de bureau — js/steam-bridge.js.
        return writeSave(name, JSON.stringify(engineScripts.state));
      } catch(e){
        logConsole('warn', 'api.save : ' + e.message, o);
        return false;
      }
    },
    load: function(name){
      try{
        const raw = readSave(name);
        if(!raw) return false;
        // On FUSIONNE dans l'objet existant au lieu de le remplacer : des
        // scripts ont pu en garder une référence avant l'appel.
        Object.assign(engineScripts.state, JSON.parse(raw));
        return true;
      } catch(e){
        logConsole('warn', 'api.load : ' + e.message, o);
        return false;
      }
    },
    clearSave: function(name){
      try{ return removeSave(name); }
      catch(e){ return false; }
    },

    V3: function(x, y, z){ return new THREE.Vector3(x || 0, y || 0, z || 0); }
  });
}

// Le code d'une entrée de userData.scripts VIT SUR L'ASSET qu'elle référence : l'entrée ne
// porte plus que `scriptId`. Une entrée qui ne résout rien — asset supprimé, ou projet d'avant
// la référence, qui portait le code en dur — rend '' et n'est donc pas compilée. Le composant
// correspondant s'affiche « script manquant » dans l'inspecteur : c'est là qu'on le voit.
export function codeOfScriptEntry(entry){
  if(!entry || !entry.scriptId) return '';
  // `assetById` et pas `assets.find` : cette fonction est appelée par `compiledOf`, donc UNE
  // FOIS PAR SCRIPT ET PAR IMAGE — un parcours linéaire du panneau d'assets soixante fois par
  // seconde et par script, seulement pour résoudre un id. L'index vit dans
  // js/component-data.js et se valide tout seul. Voir docs/REVUE_2026-09-10.md § 2.6.
  //
  // Le repli n'est PAS `null` : une garde `typeof` qui rend « rien » transforme un module absent
  // en fonctionnalité éteinte, sans message — c'est exactement le défaut de `ShadowFit` dans le
  // build (§ 1.1). Ici l'absence de l'index coûte un parcours, pas un script muet.
  const a = (typeof assetById === 'function')
    ? assetById(entry.scriptId)
    : ((typeof assets !== 'undefined' && Array.isArray(assets))
        ? assets.find(function(x){ return x.id === entry.scriptId; })
        : null);
  return (a && a.kind === 'script') ? (a.code || '') : '';
}

// Les objets de la scène qui référencent cet asset script. Sert à l'édition (une modification
// retombe sur tous ses porteurs) et à la suppression d'un asset, qui doit dire combien d'objets
// elle va rendre muets au lieu de les casser en silence.
export function holdersOfScriptAsset(scriptId){
  if(!scriptId) return [];
  return objects.filter(function(o){
    return (o.userData.scripts || []).some(function(s){ return s && s.scriptId === scriptId; });
  });
}

export function compiledOf(o, i){
  const s = (o.userData.scripts || [])[i];
  // La comparaison `c.source === code` ci-dessous suffit à recharger à chaud TOUTES les
  // instances quand l'asset change : le code étant résolu à chaque image, éditer l'asset
  // invalide le cache de tous ses porteurs sans que personne ait à le purger.
  const code = codeOfScriptEntry(s);
  if(!s || !s.active || !code.trim()) return null;
  let byObject = engineScripts.compiled.get(o);
  if(!byObject){ byObject = new Map(); engineScripts.compiled.set(o, byObject); }
  let c = byObject.get(i);
  if(c && c.source === code) return c.error ? null : c;
  // CONFIANCE AVANT EXÉCUTION (js/script-trust.js). Un script du projet de quelqu'un d'autre ne
  // tourne pas tant que la personne n'a pas dit oui. La question est posée UNE fois par session
  // et la promesse n'est pas attendue ici : on est dans un chemin appelé à chaque image, il ne
  // doit ni bloquer ni empiler des modales. Tant que la réponse n'est pas arrivée, le script ne
  // compile simplement pas — au pire il démarre une fraction de seconde plus tard.
  if(!codeTrusted(code)){
    allowRunScripts(assets);
    return null;
  }
  c = {source:code, error:false, start:null, update:null};
  byObject.set(i, c);
  // Chaque (re)compilation complète game.props des clés @vars ajoutées depuis l'attachement,
  // quel que soit le chemin qui a changé le code (MCP, éditeur externe, fichier) — BUGS_MOTEUR § 12.
  mergeVarsDeclared(o, code);
  try{
    // CE COMMENTAIRE ANNONÇAIT UNE PROTECTION QUI N'EXISTE PLUS — « portée réduite : fetch,
    // localStorage, document sont masqués ». `GLOBALS_HIDDEN` est VIDE depuis la v0.150.1, et
    // js/script-scope.js explique pourquoi : masquer ne protège de rien tant que `window` reste
    // atteignable. Un commentaire qui décrit une garde absente est pire qu'un commentaire
    // manquant — le prochain lecteur croit le vecteur fermé.
    //
    // CE QUI PROTÈGE VRAIMENT est le `codeTrusted()` juste au-dessus : on n'exécute pas le code
    // de quelqu'un d'autre sans le lui avoir demandé. Le jeu publié appelle la même fabrique,
    // pour que les deux portées ne puissent pas diverger.
    const factory = compileScript(code,
      '\nreturn {start:(typeof start==="function")?start:null,'
      + 'update:(typeof update==="function")?update:null};');
    const res = factory(apiFor(o, 0, i));
    c.start = res.start;
    c.update = res.update;
  } catch(err){
    c.error = true;
    logConsole('error', 'compilation (script ' + (i + 1) + ') : ' + err.message, o, i);
    setStatus('Erreur de script sur « ' + o.name + ' » (script ' + (i + 1) + ') — voir la Console', 4000);
  }
  return c.error ? null : c;
}

export function runScripts(dt){
  if(!engineScripts.inProgress){
    engineScripts.inProgress = true;
    engineScripts.time = 0;
    engineScripts.demarres = new WeakMap();
    engineScripts.minuteries = [];
    engineScripts.ecouteurs = {};
    engineScripts.aDestroy = [];
    engineScripts.sceneDemandee = null;
    engineScripts.keysPrev = new Set();
    // L'état global repart de zéro à chaque lancement. Le drapeau `inTransition`, qui le
    // conservait d'une scène à l'autre, n'était posé que par le mode lecture en page, retiré
    // (docs/REVUE_2026-09-29.md § 6.1) : l'enchaînement de niveaux vit dans le jeu publié
    // (js/game-runtime.js).
    engineScripts.state = {};
    engineScripts.libraries = null;
    resetAudioMix();
    engineScripts.snapshot = objects.filter(aScript).map(function(o){
      return {obj:o, pos:o.position.clone(), quat:o.quaternion.clone(), ech:o.scale.clone()};
    });
    initEventsVisuals();
    startAudioGame();
    navReset();   // la grille de navigation reflète la scène au lancement
  }
  engineScripts.time += dt;
  // Réseau AVANT les scripts : un client non-autorité applique l'instantané
  // reçu, puis ses scripts voient déjà l'état à jour dans la même image.
  if(networkActive()){
    if(networkIsAuthority()) networkBroadcast(engineScripts.state, engineScripts.time);
    else {
      networkApply(engineScripts.state, function(name){
        return objects.find(function(o){ return o.name === name; }) || null;
      }, dt);
      networkSendInputs(snapshotInputs());
    }
  }
  runEventsVisuals();
  evaluateContacts();

  // objets scriptés (copie de la liste : les scripts peuvent créer des objets)
  //
  // `isSceneObject` ET PAS `objects.indexOf` : l'ancien test était LINÉAIRE, exécuté pour
  // CHAQUE objet de la scène — y compris les non-scriptés, puisque le `!scripts.length`
  // arrivait après. Soit O(n²) par image : mille objets faisaient un million de comparaisons
  // pour trouver éventuellement trois scripts. `isSceneObject` répond en O(1) sur un Set, et
  // c'est exactement le point d'entrée qu'`objects.js` expose pour ça — le runtime, lui,
  // l'utilisait déjà (game-runtime.js), donc c'était aussi une divergence éditeur/jeu.
  // Voir docs/REVUE_2026-09-10.md § 2.1.
  //
  // On part toujours de `objects` et non de `Registry.activeNodes('ScriptJS')`, qui serait
  // O(scriptés) : l'ORDRE d'exécution entre objets est observable par les scripts, et celui du
  // tableau de scène est celui qu'ils ont toujours eu. Le gain de complexité est déjà acquis
  // par le test O(1) ci-dessous.
  objects.slice().forEach(function(o){
    const scripts = o.userData.scripts || [];
    if(!scripts.length) return;                           // le cas de la grande majorité
    // L'ACTIVITÉ, PAS LA VISIBILITÉ (Unity : SetActive contre Renderer.enabled). `visible = false`
    // ne fait que masquer : les scripts continuent. Seul `api.setActive(o, false)` les arrête.
    if(!isSceneObject(o) || !isActiveInHierarchy(o)) return;     // détruit ou inactif
    let demarresObj = engineScripts.demarres.get(o);
    if(!demarresObj){ demarresObj = new Set(); engineScripts.demarres.set(o, demarresObj); }
    scripts.forEach(function(s, i){
      const c = compiledOf(o, i);
      if(!c) return;
      const api = apiFor(o, dt, i);
      try{
        if(!demarresObj.has(i)){
          demarresObj.add(i);
          if(c.start) c.start(api);
        }
        if(c.update) c.update(api);
      } catch(err){
        // COMPORTEMENT UNITY, même règle que js/game-runtime.js : le script n'est PAS suspendu, il est
        // rappelé à l'image suivante ; l'erreur répétée n'est reloguée qu'une fois par seconde.
        const msg = (err && err.message) || String(err);
        const r = c.lastError || (c.lastError = {msg: null, count: 0, at: -Infinity});
        if(r.msg !== msg){ r.msg = msg; r.count = 0; r.at = -Infinity; }
        r.count++;
        const now = Date.now();
        if(now - r.at >= 1000){
          r.at = now;
          logConsole('error', '(script ' + (i + 1) + ') ' + msg + (r.count > 1 ? ' (×' + r.count + ')' : ''), o, i);
          setStatus('Erreur de script sur « ' + o.name + ' » (script ' + (i + 1) + ') — voir la Console', 4000);
        }
      }
    });
  });

  // minuteries api.after() arrivées à échéance
  const dues = engineScripts.minuteries.filter(function(m){ return m.t <= engineScripts.time; });
  engineScripts.minuteries = engineScripts.minuteries.filter(function(m){ return m.t > engineScripts.time; });
  dues.forEach(function(m){
    try{ m.fn(); }
    catch(err){ logConsole('error', 'api.after : ' + err.message, m.obj); }
  });

  // destructions différées (jamais pendant l'itération)
  engineScripts.aDestroy.forEach(function(target){
    if(!isSceneObject(target)) return;   // O(1), comme le runtime (voir runScripts plus haut)
    if(target === selection) select(null, true);
    deleteRoot(target);
  });
  if(engineScripts.aDestroy.length){
    engineScripts.aDestroy = [];
    updateHierarchy();
  }

  // changement de scène demandé par un script
  if(engineScripts.sceneDemandee !== null){
    const target = engineScripts.sceneDemandee;
    engineScripts.sceneDemandee = null;
    changeScene(target);
    return;
  }

  engineScripts.keysPrev = new Set(keysGame);
  buttonsPrev = new Set(mouseGame.buttons);
  // Les deltas sont CONSOMMÉS par l'image : sans cette remise à zéro, un script qui ne lit pas
  // mouseDelta à une image verrait le mouvement de deux images arriver à la suivante — un
  // sursaut de visée après chaque pause, chaque menu, chaque changement de scène.
  mouseLook.dx = 0; mouseLook.dy = 0;
}

export function stopScripts(){
  if(!engineScripts.inProgress) return;
  engineScripts.inProgress = false;
  stopEventsVisuals();
  stopAudioGame();
  resetAudioMix();
  navReset();
  // Sans cette remise à zéro, les gestionnaires de api.onContact s'empileraient
  // d'une partie à l'autre et une pièce serait ramassée plusieurs fois. Idem
  // pour l'état des personnages : le rayon et le point de départ doivent être
  // remesurés à chaque partie, la scène ayant pu changer entre-temps.
  engineScripts.contacts = [];
  engineScripts.persos = new WeakMap();
  engineScripts.snapshot.forEach(function(s){
    if(!isSceneObject(s.obj)) return;    // O(1) : l'objet a pu être détruit pendant la partie
    s.obj.position.copy(s.pos);
    s.obj.quaternion.copy(s.quat);
    s.obj.scale.copy(s.ech);
  });
  engineScripts.snapshot = [];
  if(selection) syncInspector();
}

// Éditer le script d'un objet, c'est éditer SON ASSET — o : objet, i : index dans
// o.userData.scripts.
//
// IL N'Y A PLUS DEUX ÉDITEURS. Cette fonction ouvrait une fenêtre sur le code de l'INSTANCE
// (`s.code`), pendant qu'openEditorScriptAsset en ouvrait une autre sur celui de l'asset : deux
// fenêtres, deux textes, aucun lien. Elle ne fait plus que router vers l'asset référencé, ce qui
// garde ses appelants intacts (js/console.js au double-clic sur une erreur,
// js/ui/panels-components.js au bouton « Éditer »). Conséquence assumée : la modification se voit
// sur toutes les instances de ce script, et le pas d'historique est celui de l'asset.
export function openEditorScript(o, i){
  if(!o || !o.userData.scripts || !o.userData.scripts[i]) return;
  const code = codeOfScriptEntry(o.userData.scripts[i]);
  const a = (typeof assets !== 'undefined')
    ? assets.find(function(x){ return x.id === o.userData.scripts[i].scriptId && x.kind === 'script'; })
    : null;
  if(!a){
    // Le message dit le GESTE, pas l'erreur : ce composant est celui d'un projet d'avant la
    // référence, ou son asset a été supprimé. Dans les deux cas la réparation est la même.
    setStatus('Ce composant Script ne référence aucun asset — glissez un script du panneau '
      + 'Projet sur l\'objet' + (code ? ' (l\'ancien code est resté dans le fichier)' : ''), 5000);
    return;
  }
  openEditorScriptAsset(a);
}

// Éditeur d'un asset script du panneau Projet (name + code).
//
// Dans une VRAIE fenêtre séparée, et plus dans une modale : la modale offrait une <textarea>
// nue de 280 px de haut, sans numéros de lignes, sans coloration, et bloquait l'éditeur
// derrière elle pendant qu'on écrivait. La fenêtre externe donne l'écran entier, la
// coloration et l'indentation d'code-editor.js, et laisse la vue 3D manipulable à côté.
// Enregistrement continu (debouncé par external-editor.js) : il n'y a plus de bouton
// « Appliquer » à oublier.
export function openEditorScriptAsset(a){
  const listFiles = assets.filter(function(x){ return x.kind === 'script'; })
    .map(function(x){ return {id: x.id, name: x.name}; });
  // Un pas par session, comme pour le script d'un objet — même raison, même grain. Le nom count
  // autant que le code : la fenêtre externe permet de renommer, et ce renommage-là n'a pas de
  // prise de focus dans le panneau d'assets pour le couvrir.
  let premiereUpdate = true;
  openEditorExternal('code', {
    id: a.id, name: a.name, code: a.code || '', langage: 'js', title: 'Script',
    listFiles: listFiles
  }, function(data){
    const name = (data.name || '').trim() || a.name;
    if(premiereUpdate && (data.code !== a.code || name !== a.name)){
      pushHistory();
      premiereUpdate = false;
    }
    // LE NOM CHANGE LE CHEMIN DISQUE : un script s'écrit sous `slugFile(a.name) + '.js'`. Toute
    // la mutation passe donc par `mutateAsset`, qui photographie les chemins AVANT, laisse faire,
    // puis fait suivre le disque. Sans lui, l'ancien fichier resterait et reviendrait en DOUBLE
    // au rafraîchissement suivant (voir reconcileDiskPaths, js/assets.js).
    //
    // `mutateAsset` appelle `updateProject()` lui-même : ne pas le refaire ici.
    mutateAsset(function(){
      a.name = name;
      a.code = data.code;
      // LA CONFIANCE SUIT LA PATERNITÉ : ce code vient d'être tapé ici, dans cet éditeur. Sans
      // cette ligne, la question de js/script-trust.js se poserait sur le travail de la personne
      // elle-même dès la première modification — et une garde qui interroge sur son propre code
      // est une garde qu'on désactive dans la semaine.
      trustCode(a.code);
      // LE CODE EST LA SOURCE UNIQUE, DONC L'ÉDITION RETOMBE SUR TOUS SES PORTEURS. Chaque objet
      // qui référence cet asset voit ses `@expose` reparsées : une variable ajoutée doit
      // apparaître dans l'inspecteur, et `game.props` doit connaître les variables déclarées,
      // sinon un script qui les lit tourne sur des valeurs que personne n'a choisies. Le cache
      // de compilation, lui, n'a rien à purger : compiledOf compare le code à chaque image.
      syncScriptVarsOfAsset(a);
    });
    if(selection && holdersOfScriptAsset(a.id).indexOf(selection) !== -1) buildInspector();
  }, function(id){
    const n = assets.find(function(x){ return x.id === id && x.kind === 'script'; });
    if(n) openEditorScriptAsset(n);
  });
}

// Ouvre l'éditeur de code à empty (aucun script sélectionné), ou sur le dernier script édité
// cette session — appelée par le menu Fenêtres, qui n'a pas d'asset précis en main.
export function openLastWindowCode(){
  const lastId = lastAssetEditedBy('code');
  const scripts = assets.filter(function(x){ return x.kind === 'script'; });
  const a = (lastId && scripts.find(function(x){ return x.id === lastId; }))
    || scripts[0] || null;
  if(a){ openEditorScriptAsset(a); return; }
  openEditorExternal('code', {id: null, name: '', code: '', langage: 'js', title: 'Script', listFiles: []});
}

// L'API de script est documentée dans l'aide (Aide → L'objet api), pas dans une modale :
// la table tenue à la main ici avait pris du retard sur apiFor() ci-dessus — il y
// manquait la physique, l'état de jeu, les événements et le multijoueur. La page, elle,
// est confrontée à apiFor() par test/aide.test.mjs.


// EXPOSÉ EN GLOBALE, à dessein. Ces symboles sont appelés depuis des fichiers
// que les mêmes pages ne chargent pas toutes : un `import` y pointerait un
// fichier absent, et la page ne démarrerait pas. Ils gardent donc leur garde
// `typeof` côté appelant, et se déclarent ici.
globalThis._apiBox = _apiBox;
globalThis._apiCache = _apiCache;
globalThis._apiCandidats = _apiCandidats;
globalThis._apiRay = _apiRay;
globalThis._apiSphere = _apiSphere;
globalThis._apiVecA = _apiVecA;
globalThis._apiVecB = _apiVecB;
globalThis.actionActive = actionActive;
globalThis.apiFor = apiFor;
globalThis.buildApi = buildApi;
globalThis.buttonsPrev = buttonsPrev;
globalThis.canvasGame = canvasGame;
globalThis.compiledOf = compiledOf;
globalThis.mouseGame = mouseGame;
globalThis.mouseLook = mouseLook;
globalThis.pointerLockedGame = pointerLockedGame;
globalThis.runScripts = runScripts;
globalThis.sameLayer = sameLayer;
globalThis.updateMouseFrom = updateMouseFrom;