// moteur/js/component-data.js
//
// LES DÉFAUTS DE DONNÉES DE CHAQUE COMPOSANT — fichier PARTAGÉ éditeur ↔ runtime du jeu publié.
//
// Ces fonctions répondent à une seule question : « à quoi ressemblent les données de ce
// composant quand personne ne les a encore réglées ? ». Elles étaient éparpillées dans les
// modules qui avaient eu besoin d'un défaut le premier — `ensurePhys` dans physics.js,
// `ensureGame` dans inspector.js (un panneau d'interface !), `ensureCollider` dans
// inspector.js aussi, `ensureAnimator` dans le fichier du composant — et le runtime en
// gardait sa PROPRE copie (`PART_DEFAUT_RT`, et les littéraux `{rayon: 18, resolution: 128,
// intensite: 1}` écrits à la main dans buildList).
//
// Deux copies d'un défaut, c'est la famille de défaut la plus coûteuse de ce dépôt : elle ne
// se voit qu'APRÈS export, quand le jeu publié se comporte autrement que ce que l'éditeur
// montrait. Il n'y a plus qu'une source.
//
// Ce fichier ne dépend de RIEN : ni THREE, ni le DOM, ni une globale d'éditeur. C'est ce qui
// lui permet d'être chargé tel quel par editor.html, game-preview.html et un build (build.js).

export function ensurePhys(o){
  if(!o.userData.phys) o.userData.phys = {active:false, masse:1, bounce:0.3, friction:0.4};
  return o.userData.phys;
}

export function ensureCollider(o){
  if(!o.userData.collider){
    o.userData.collider = {shape:'auto', dims:[1,1,1], radius:1, height:2, offset:[0,0,0], trigger:false};
  }
  return o.userData.collider;
}

export const PART_DEFAULT = {
  active: true,
  shape: 'cone',            // point | box | sphere | cone (zone / direction d'émission)
  dims: [1, 0.2, 1],        // boîte
  radius: 0.4,               // sphère / cône
  angle: 20,                // cône : demi-angle (°) autour de +Y local
  mode: 'continu',          // continu | burst
  rate: 25,                 // particules / seconde (continu)
  amount: 40,             // particules par burst
  vie: 1.3,                 // durée de vie (s, ±25 %)
  speed: 2.5,
  gravity: 0,               // m/s² appliqué sur Y monde (négatif = retombe)
  sizeStart: 0.3, sizeEnd: 0.06,
  opacityStart: 1, opacityEnd: 0,
  colorStart: '#ffb347', colorEnd: '#ff4422',
  additif: true,
  max: 300
};

export function ensurePart(o){
  if(!o.userData.part) o.userData.part = JSON.parse(JSON.stringify(PART_DEFAULT));
  return o.userData.part;
}

export const TERRAIN_DEFAULT = {
  size: 60,          // côté en mètres
  segments: 64,        // subdivisions par côté (65×65 sommets)
  heights: null,      // rempli à la création
  colorBottom: '#3f6b3a',    // herbe
  colorTop: '#8b8378',   // roche
  colorNeige: '#e8eef2',
  thresholdRoche: 0.35,    // fraction de l'altitude max où la roche apparaît
  thresholdNeige: 0.8,
  rolloff: true          // les pentes fortes deviennent rocheuses
};

export function ensureTerrain(o){
  if(!o.userData.terr){
    o.userData.terr = JSON.parse(JSON.stringify(TERRAIN_DEFAULT));
    const n = (o.userData.terr.segments + 1) * (o.userData.terr.segments + 1);
    o.userData.terr.heights = new Array(n).fill(0);
  }
  return o.userData.terr;
}

export const PROBE_DEFAULT = {
  radius: 18,          // rayon d'influence (m)
  resolution: 128,    // côté d'une face du cubemap
  intensity: 1,       // envMapIntensity appliquée aux matériaux
  // `auto` (« recuire en lecture ») : champ HISTORIQUE, lu nulle part. Le jeu recuit toujours
  // toutes ses sondes au lancement (rtBakeProbes, js/game-runtime.js) ; la case qui le réglait
  // ne faisait rien depuis le 6 août et a été retirée (revue du 2026-09-29, § 6.2). Gardé pour
  // que les projets qui le portent se relisent à l'identique.
  auto: true,
  // Projection boîte. Un cubemap est cuit depuis UN point et échantillonné comme s'il
  // venait de l'infini : dans une pièce, le reflet glisse sur les murs quand l'objet
  // bouge au lieu d'y rester accroché. La boîte dit où sont vraiment les murs.
  box: false,
  boxSize: [12, 6, 12],     // dimensions de la pièce (m)
  boxOffset: [0, 0, 0]      // centre de la boîte, relatif à la sonde
};

// composant Reflection désactivé (case du header dans l'inspecteur) : la sonde est
// ignorée par la cuisson et la distribution, comme si elle n'existait pas
export function ensureProbe(o){
  const s = o.userData.probe || (o.userData.probe = {});
  // Complète en place les réglages absents. userData.sonde est sérialisé tel quel
  // (serialization.js) : un projet enregistré avant l'ajout d'un champ ne le porte pas,
  // et une migration de fichier serait inutile puisque l'absence VAUT déjà le défaut.
  Object.keys(PROBE_DEFAULT).forEach(function(k){
    if(s[k] !== undefined) return;
    s[k] = Array.isArray(PROBE_DEFAULT[k]) ? PROBE_DEFAULT[k].slice() : PROBE_DEFAULT[k];
  });
  return s;
}

export function ensureUIDoc(node){
  if(!node.userData.uiDoc){
    node.userData.uiDoc = {documentUIId: null, sheetStyleIds: [], values: {}};
  }
  if(!node.userData.uiDoc.sheetStyleIds) node.userData.uiDoc.sheetStyleIds = [];
  if(!node.userData.uiDoc.values) node.userData.uiDoc.values = {};
  return node.userData.uiDoc;
}

export function ensureAnimator(node){
  if(!node.userData.animator) node.userData.animator = {assetId: null, target: ''};
  if(node.userData.animator.target === undefined) node.userData.animator.target = '';
  return node.userData.animator;
}

export function ensureEvents(o){
  if(!o.userData.events) o.userData.events = [];
  return o.userData.events;
}

/**
 * L'objet est-il ACTIF dans la hiérarchie — l'`activeInHierarchy` d'Unity ?
 *
 * RENDU ET ACTIVITÉ SONT DEUX CHOSES (Unity : `Renderer.enabled` contre `SetActive`). `visible`
 * ne décide que du dessin ; l'activité, posée par `api.setActive`, vit dans
 * `userData.activeVoulu` et s'hérite : un parent inactif rend inactifs tous ses descendants.
 * Les scripts lisaient `visible` : un objet qui se masquait lui-même (clignotement, objet caché
 * en attente) débranchait son propre `update`, sans erreur.
 */
export function isActiveInHierarchy(o){
  for(let n = o; n; n = n.parent){
    if(n.userData && n.userData.activeVoulu === false) return false;
  }
  return !!o;
}
globalThis.isActiveInHierarchy = isActiveInHierarchy;

export function ensureGame(o){
  if(!o.userData.game) o.userData.game = {tag:'', layer:'Défaut', props:{}};
  if(!o.userData.game.props) o.userData.game.props = {};
  return o.userData.game;
}

// Les défauts de Light/Camera/CameraFollow/Tilemap — migrés vers le patron « sac userData
// référencé » (docs/REVUE_2026-09-14.md point 10). PAS `userData.light`/`userData.cam` : ces
// deux noms sont déjà pris par le MIROIR de l'objet THREE (`o.userData.light = ed(o).light`,
// game-runtime.js) que lit le runtime — un même nom pour deux choses différentes aurait écrasé
// l'un des deux en silence.

export const LIGHT_DEFAULT = {
  subType: 'point', color: 0xffffff, intensity: 1, range: 0, angle: Math.PI / 4, penumbra: 0
};

export function ensureLight(o){
  if(!o.userData.lum) o.userData.lum = {};
  const s = o.userData.lum;
  Object.keys(LIGHT_DEFAULT).forEach(function(k){
    if(s[k] !== undefined) return;
    s[k] = LIGHT_DEFAULT[k];
  });
  return s;
}

export const CAMERA_DEFAULT = {
  projection: 'perspective', fov: 50, near: 0.1, far: 1000, orthoSize: 5,
  pixelPerfect: false, ppu: 100, mode: 'height', widthLevel: 0, ratio: 1, main: false
};

export function ensureCamera(o){
  if(!o.userData.camera) o.userData.camera = {};
  const s = o.userData.camera;
  Object.keys(CAMERA_DEFAULT).forEach(function(k){
    if(s[k] !== undefined) return;
    s[k] = CAMERA_DEFAULT[k];
  });
  return s;
}

export const CAMERA_FOLLOW_DEFAULT = {
  targetName: '', xMin: undefined, xMax: undefined, yMin: undefined, yMax: undefined,
  topOfView: 0.12, snapPixel: true
};

export function ensureCameraFollow(o){
  if(!o.userData.cameraFollow) o.userData.cameraFollow = {};
  const s = o.userData.cameraFollow;
  Object.keys(CAMERA_FOLLOW_DEFAULT).forEach(function(k){
    if(s[k] !== undefined) return;
    s[k] = CAMERA_FOLLOW_DEFAULT[k];
  });
  return s;
}

// ---------- WebXR (js/components/component-xr.js, js/xr-runtime.js) ----------
// L'équivalent de l'« XR Origin » d'Unity et des fournisseurs de locomotion de l'XR Interaction
// Toolkit, réunis en un seul composant : l'origine du suivi (le sol du joueur), ce qui s'affiche
// dans les mains, et comment on se déplace. `moveSpeed: 0` / `snapTurn: 0` désactivent le mode.
export const XR_ORIGIN_DEFAULT = {
  sessionMode: 'immersive-vr',   // 'immersive-vr' | 'immersive-ar'
  referenceSpace: 'local-floor', // 'local-floor' (debout, sol réel) | 'local' (assis)
  showControllers: true,
  teleport: true,
  snapTurn: 45,                  // degrés par cran, 0 = pas de rotation par cran
  moveSpeed: 0,                  // m/s au stick gauche, 0 = pas de déplacement continu
  handTracking: true             // demande le suivi des mains (optionnel côté navigateur)
};

export function ensureXrOrigin(o){
  if(!o.userData.xrOrigin) o.userData.xrOrigin = {};
  const s = o.userData.xrOrigin;
  Object.keys(XR_ORIGIN_DEFAULT).forEach(function(k){
    if(s[k] === undefined) s[k] = XR_ORIGIN_DEFAULT[k];
  });
  return s;
}

export const XR_GRABBABLE_DEFAULT = {
  radius: 0.15,       // portée de la saisie autour de la main, en plus du volume de l'objet
  throwable: true,    // relâché, un corps physique garde la vitesse de la main
  keepOffset: true    // garde la prise où la main l'a saisi (sinon l'objet se centre dans la main)
};

export function ensureXrGrabbable(o){
  if(!o.userData.xrGrabbable) o.userData.xrGrabbable = {};
  const s = o.userData.xrGrabbable;
  Object.keys(XR_GRABBABLE_DEFAULT).forEach(function(k){
    if(s[k] === undefined) s[k] = XR_GRABBABLE_DEFAULT[k];
  });
  return s;
}

export const XR_TELEPORT_AREA_DEFAULT = {
  maxSlope: 30        // degrés : au-delà, la surface visée est refusée (un mur n'est pas un sol)
};

export function ensureXrTeleportArea(o){
  if(!o.userData.xrTeleportArea) o.userData.xrTeleportArea = {};
  const s = o.userData.xrTeleportArea;
  Object.keys(XR_TELEPORT_AREA_DEFAULT).forEach(function(k){
    if(s[k] === undefined) s[k] = XR_TELEPORT_AREA_DEFAULT[k];
  });
  return s;
}

export const TILEMAP_DEFAULT = {
  plane: 'xy', cellSize: 0.5, width: 32, height: 18, originX: 0, originY: 0,
  paletteId: null, layer: 'Décor', order: 0, collision: 'solid'
};

// `cells` n'est PAS dans TILEMAP_DEFAULT : sa taille dépend de width/height, déjà réglés quand
// on la construit, et le patron générique (une valeur fixe par clé) ne convient pas ici.
export function ensureTilemap(o){
  if(!o.userData.tilemap) o.userData.tilemap = {};
  const s = o.userData.tilemap;
  Object.keys(TILEMAP_DEFAULT).forEach(function(k){
    if(s[k] !== undefined) return;
    s[k] = TILEMAP_DEFAULT[k];
  });
  if(!Array.isArray(s.cells) || s.cells.length !== s.width * s.height){
    s.cells = new Array(s.width * s.height).fill(0);
  }
  return s;
}


// Index d'un sommet du champ de hauteurs d'un terrain. Partagé parce que la physique le lit
// des deux côtés (le runtime en gardait sa copie sous le nom `rtTerrIdx`).
export function terrIdx(t, ix, iz){ return iz * (t.segments + 1) + ix; }

// Le sac de références NON SÉRIALISABLES d'un objet (sa THREE.Light, sa THREE.Camera, ses aides
// visuelles). Il vit sur `o.ed` et JAMAIS dans `userData` : three clone `userData` en JSON, ce
// qui explose sur une référence circulaire ou perd silencieusement un objet three.
//
// Partagé parce que les composants Light et Camera y cherchent l'objet three déjà construit
// pour ne pas en refabriquer un à côté. Le runtime écrivait `o.userData.lumiere` /
// `o.userData.cam` — troisième divergence de la même famille, corrigée en même temps.
export function ed(o){ if(!o.ed) o.ed = {}; return o.ed; }


/**
 * Un asset par son id, quel que soit le moteur qui pose la question.
 *
 * L'éditeur tient un TABLEAU `assets`, le jeu publié une TABLE `assetsById` : un composant
 * partagé par les deux ne peut lire ni l'un ni l'autre directement, et c'est exactement ce qui
 * obligeait à tenir un miroir de chaque construction dans game-runtime.js.
 */
// L'INDEX, et pourquoi il est VALIDÉ plutôt que invalidé.
//
// `assets` est un tableau, muté depuis une vingtaine d'endroits (import, suppression, undo,
// découverte de dossier, plugins) sans point d'étranglement unique. Un index qu'on invaliderait
// « à la main » manquerait donc un site tôt ou tard, et le symptôme serait un asset introuvable
// — c'est-à-dire un script muet ou une texture perdue, sans message.
//
// Ici l'index est reconstruit dès qu'il ne peut PLUS répondre juste : le tableau a changé
// d'identité ou de longueur, l'entrée trouvée n'est plus à la place indexée, ou la clé demandée
// manque. Un échec coûte un parcours ; un succès coûte deux comparaisons. Aucun appelant n'a à
// se souvenir de prévenir qui que ce soit.
//
// Ce que ça retire : `codeOfScriptEntry` (scripts.js) résolvait son asset par `assets.find`
// UNE FOIS PAR SCRIPT ET PAR IMAGE, dans les deux moteurs — un parcours linéaire du panneau
// d'assets soixante fois par seconde et par script. Voir docs/REVUE_2026-09-10.md § 2.6.
export let _assetIndex = null;         // id → asset
export let _assetPos = null;           // id → position dans le tableau, pour valider un succès
export let _assetIndexSource = null;   // le TABLEAU indexé (identité)
export let _assetIndexLength = -1;

export function _rebuildAssetIndex(list){
  _assetIndex = new Map();
  _assetPos = new Map();
  for(let i = 0; i < list.length; i++){
    const a = list[i];
    if(a && a.id !== undefined){ _assetIndex.set(a.id, a); _assetPos.set(a.id, i); }
  }
  _assetIndexSource = list;
  _assetIndexLength = list.length;
}

export function assetById(id){
  if(!id) return null;
  if(typeof assets !== 'undefined' && Array.isArray(assets)){
    if(_assetIndexSource !== assets || _assetIndexLength !== assets.length) _rebuildAssetIndex(assets);
    let a = _assetIndex.get(id);
    // Validation : l'entrée doit toujours être à la place où on l'a indexée. Un remplacement
    // en place (même longueur, autre objet) est ainsi rattrapé au lieu d'être servi.
    if(a !== undefined && assets[_assetPos.get(id)] === a) return a;
    _rebuildAssetIndex(assets);
    a = _assetIndex.get(id);
    return (a !== undefined) ? a : null;
  }
  if(typeof assetsById !== 'undefined' && assetsById) return assetsById[id] || null;
  return null;
}

// LES GENRES D'ASSET QUI SE JOUENT. Un fichier importé (`audio`), un bruitage calculé depuis sa
// recette (`sfx`, js/chip-synth.js) et une boucle musicale (`musicLoop`, js/music-loop.js) exposent
// tous un `buffer` : une source audio, api.playSound,
// l'action « Jouer le son… » et le copilote les acceptent indifféremment. Tester `kind === 'audio'`
// à la main, c'était refuser en silence tout bruitage fabriqué — il y avait 29 tests de ce genre.
export const PLAYABLE_AUDIO_KINDS = ['audio', 'sfx', 'musicLoop'];

/** Vrai pour un asset qu'on peut poser sur une source audio ou jouer par son nom. */
export function isPlayableAudio(a){
  return !!a && PLAYABLE_AUDIO_KINDS.indexOf(a.kind) !== -1;
}

/** Les objets de la scène courante — `objects` dans l'éditeur, `game.objects` dans le jeu. */
export function sceneObjects(){
  if(typeof objects !== 'undefined' && Array.isArray(objects)) return objects;
  if(typeof game !== 'undefined' && game && Array.isArray(game.objects)) return game.objects;
  return [];
}
