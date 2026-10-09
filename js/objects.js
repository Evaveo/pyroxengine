// ---------- Objets ----------
// Les références d'éditeur (lumière, caméra, helper…) vivent dans obj.ed et
// JAMAIS dans userData : three.js clone userData en JSON, ce qui explose
// sur des références circulaires. userData ne garde que des drapeaux sérialisables.
import { cloneModel } from './anim-models.js';
import { ed } from './component-data.js';
import { liftOverlay } from './editor-overlay.js';
import { syncComponents } from './component-migration.js';
import { NodeShells, Registry } from './component-registry.js';
import { setStatus, updateHierarchy } from './hierarchy.js';
import { pushHistory } from './history.js';
import { removeHelper } from './inspector.js';
import { applyMaterialOn, ensureMaterialDefaultProject } from './materials.js';
import { applyNodeMixin } from './node.js';
import { makeParticles } from './particles.js';
import { typePlugin } from './plugins.js';
import { applyProbes, makeProbe } from './probes.js';
import { LAYER_HELPERS, applyFilters, orbit, scene } from './scene.js';
import { select, selection, selectionMulti, setHighlight } from './selection.js';
import { PRIMITIVE_LABELS, primitiveGeometry } from './primitive-geometry.js';
import { EXTRA_PRIMITIVES, buildExtraPrimitive, isExtraPrimitive } from './primitives-extra.js';
import { assetOfReference } from './serialization.js';
import { buildTerrain } from './terrain.js';
import { refreshMenuObject } from './ui.js';
import { isReadOnly } from './readonly-ui.js';

export const objects = [];

// Index d'appartenance à la scène, tenu en parallèle de `objects`.
//
// Deux raisons, pas une :
//
//  1. `objets.indexOf(o) !== -1` était LA question posée partout pour savoir si
//     un Object3D est un objet de projet (hierarchy.js le posait à l'intérieur
//     d'une boucle sur `objects` — quadratique sur une grande scène). C'est
//     désormais `isSceneObject(o)`, en O(1).
//  2. Le Registry de composants (component.js) a besoin de la même question pour
//     ne pas livrer aux Systèmes des composants portés par un Noeud détaché
//     (template de prefab, racine supprimée, modèle en cours d'import).
//
// Tout ajout/retrait passe par les trois fonctions ci-dessous. Muter `objects`
// directement désynchroniserait l'index — c'est le seul invariant à tenir ici.
export const _indexObjects = new Set();

export function isSceneObject(o) {
  return !!o && _indexObjects.has(o);
}

export function addSceneObject(o) {
  if (!o || _indexObjects.has(o)) return o;
  _indexObjects.add(o);
  objects.push(o);
  markLayersDirty(o);
  return o;
}

// ---------------------------------------------------------------------------
// LES CALQUES À RESYNCHRONISER — la liste de travail, pas un balayage par image.
//
// `userData.game.layer` (le calque de PROJET) doit descendre dans le bit `Object3D.layers` de
// chaque nœud ET de toute sa descendance, pour que le masque d'une caméra de jeu puisse filtrer
// le rendu. La boucle de `viewport.js` le refaisait pour la scène ENTIÈRE à CHAQUE IMAGE :
// deux écritures de masque par Object3D — os de squelette et sous-arbres de modèles importés
// compris — pour une donnée qui ne change que sur une action explicite de l'utilisateur.
// Voir docs/REVUE_2026-09-10.md § 2.3.
//
// Marquer plutôt que balayer demande de nommer les trois moments où ça change, et ils sont
// peu nombreux : l'entrée d'un nœud dans la scène (création, chargement, undo, sous-scène,
// clone de modèle — tout passe par `addSceneObject`), l'écriture du champ Calque, et une
// restructuration de masse (changement de scène). Le dernier passe par `markAllLayersDirty`.
//
// Le prix d'un oubli est un nœud rendu par une caméra qui devrait l'ignorer. C'est pour ça que
// `markAllLayersDirty()` existe et qu'il est appelé large : rater un cas doit coûter une passe
// complète, pas un bug de rendu.
export const _layersDirty = new Set();
export let _layersAllDirty = false;

/** Ce nœud (et sa descendance) doit voir son calque de projet redescendre dans `layers`. */
export function markLayersDirty(o) {
  if (o) _layersDirty.add(o);
}

/** Toute la scène est à resynchroniser (changement de scène, undo, import de masse). */
export function markAllLayersDirty() {
  _layersAllDirty = true;
  _layersDirty.clear();
}

/**
 * Les nœuds à traiter, et la liste est VIDÉE au passage : un appelant, une fois.
 *
 * Rend `objects` en entier quand une restructuration de masse a été signalée.
 */
export function takeLayersDirty() {
  if (_layersAllDirty) {
    _layersAllDirty = false;
    _layersDirty.clear();
    return objects.slice();
  }
  if (!_layersDirty.size) return EMPTY_LIST;
  const out = Array.from(_layersDirty);
  _layersDirty.clear();
  return out;
}

export const EMPTY_LIST = [];

// Valeur de `userData.type` d'un nœud neuf. Hors de la factory : celle-ci ne doit nommer
// AUCUN type d'objet — c'est `Component.markType` qui affine ensuite selon les composants.
export const TYPE_NODE_DEFAULT = 'group';

/**
 * LE point de création d'un nœud de scène. Rien d'autre ne doit appeler `addSceneObject`
 * depuis l'extérieur d'objects.js.
 *
 * Elle ne connaît AUCUN type d'objet : elle reçoit une liste de composants, et c'est le seul
 * point d'extension. La cascade `if(type === 'camera') … else if(type === 'tilemap')` qu'elle
 * remplace obligeait à rouvrir la fonction pour chaque nouveau type, et surtout elle existait en
 * trois exemplaires (barre 2D, dépôt d'asset, copilote) qui divergeaient — c'est de là que
 * venaient les nœuds jamais indexés, donc invisibles dans la hiérarchie et absents de l'ECS.
 *
 * `object3d` : un Object3D DÉJÀ construit à adopter au lieu d'un `Group` neuf. Indispensable —
 * un maillage, un terrain ou un modèle importé ne sont pas des `Group`, et poser le composant
 * `Mesh` sur un `Group` donne un `node.material` indéfini (component-mesh.js:16), donc un
 * `serialize()` qui plante à la première sauvegarde.
 *
 * `silent` : ne touche ni la hiérarchie ni la sélection (chargement de projet, undo).
 *
 * `attach` (défaut `true`) : `false` laisse le nœud détaché, l'appelant le parente lui-même —
 * c'est ce que fait `rebuildTree`, qui rend `{byId, racines}` et attache les racines après coup.
 *
 * @param {{name?:string, parent?:Object3D, position?:{x,y,z}, object3d?:Object3D,
 *          silent?:boolean, attach?:boolean,
 *          components?:Array<{type:string, data?:object}>}} opts
 */
export function createSceneNode(opts){
  opts = opts || {};
  const n = opts.object3d || new THREE.Group();
  n.name = opts.name || n.name || 'Nœud';
  if(opts.position) n.position.set(opts.position.x || 0, opts.position.y || 0, opts.position.z || 0);
  if(opts.attach !== false) (opts.parent || scene).add(n);
  // L'indexation AVANT la pose des composants. Le filtre du Registry est à la LECTURE
  // (`eachActive` -> `isObjectOfSceneOrUnknown`, component.js:227), pas à `register` : un nœud
  // indexé plus tard redeviendrait visible tout seul. L'ordre n'est donc pas ce qui sauve
  // l'ECS — c'est `addSceneObject` lui-même. Sans lui, `isSceneObject` reste faux pour
  // toujours : la hiérarchie filtre le nœud (hierarchy.js:38) et aucun Système ne voit ses
  // composants. On garde malgré tout cet ordre, pour qu'un `onAdd()` qui interroge la scène
  // trouve son propre nœud dedans.
  // Le type par défaut, sans lequel `serializeObject` saute le nœud (serialization.js:115) :
  // il disparaîtrait du projet à la réouverture. `Component.markType` le retague ensuite
  // depuis cette valeur-là et pas une autre. TEMPORAIRE : la tâche 5bis retire `userData.type`
  // du format, et cette ligne avec.
  n.userData.type = n.userData.type || TYPE_NODE_DEFAULT;
  addSceneObject(n);
  applyNodeMixin(n);
  (opts.components || []).forEach(function(c){ n.addComponent(c.type, c.data || {}); });
  // `silent` : le chargement d'un projet crée des centaines de nœuds. Reconstruire le DOM de la
  // hiérarchie et changer la sélection à chacun, ce sont des centaines de reconstructions et une
  // sélection qui saute pendant tout le chargement.
  if(!opts.silent){
    if(typeof updateHierarchy === 'function') updateHierarchy();
    if(typeof select === 'function') select(n);
  }
  return n;
}

/**
 * Crée un nœud depuis un composant qui se déclare « fabricable » (`Component.creatable`).
 *
 * C'est le remplaçant de `createObject2d` : plus de table de types codée en dur dans une barre
 * d'outils, un composant neuf entre dans le menu en déclarant `creatable` — et il y entre pour
 * les deux mondes, puisqu'il n'y en a plus qu'un.
 *
 * Au CENTRE DE LA VUE et pas à l'origine : créer hors champ donne un objet qu'on croit non créé,
 * et le réflexe est de recliquer — d'où trois caméras empilées à l'origine.
 */
export function createFromCreatable(typeName){
  const classe = Registry.classByType(typeName);
  const c = classe && classe.creatable;
  if(!c) return null;
  pushHistory();
  const center = orbit ? orbit.target : {x: 0, y: 0, z: 0};
  const n = createSceneNode({
    name: c.label || typeName,
    position: { x: Math.round(center.x * 100) / 100,
                y: Math.round(center.y * 100) / 100,
                z: Math.round((center.z || 0) * 100) / 100 },
    components: c.components || [{ type: typeName }]
  });
  setStatus('« ' + n.name + ' » créé', 4000);
  return n;
}

export function removeSceneObject(o) {
  if (!_indexObjects.delete(o)) return false;
  const i = objects.indexOf(o);
  if (i !== -1) objects.splice(i, 1);
  // Point d'étranglement unique du retrait : c'est ICI qu'on désindexe les
  // composants, et pas dans chaque appelant. La suppression d'un objet ne
  // passait par aucun removeComponent — le Registry gardait donc pour toujours
  // les composants d'objets détruits (fuite mémoire, et bientôt pire : des
  // Systèmes qui itèrent l'index travailleraient sur des Object3D morts).
  //
  // On DÉSINDEXE sans jouer onRemove() : l'objet disparaît en entier, il n'y a
  // rien à débrancher proprement (une lumière à unregister du parent, un sac
  // userData à effacer) sur un Noeud qui ne sera plus jamais rendu — et play
  // onRemove ici relancerait des recalculs globaux (applyProbes) une fois
  // par objet supprimé.
  if (Registry.unindexNode) Registry.unindexNode(o);
  return true;
}

// Téléversement complet de la scène (newScene, restoreState). Purge aussi
// l'index de composants : ces chemins ne passent pas par removeComponent, et
// sans ça le Registry garderait les instances de la scène précédente — que les
// Systèmes itéreraient ensuite sur des Object3D détruits.
export function clearSceneObjects() {
  objects.length = 0;
  _indexObjects.clear();
  if (Registry.clear) Registry.clear();
  // La liste de travail des calques aussi : elle désignerait des nœuds de la scène précédente,
  // et la scène suivante se signalera d'elle-même par ses `addSceneObject`.
  markAllLayersDirty();
  takeLayersDirty();
}

// Retrouve un objet de SCÈNE par son id three.js — jamais scene.getObjectById(id) : celle-ci
// fouille tout le graphe réel, y compris les internes du moteur qui n'ont rien à voir avec
// un objet de projet (gizmo de transformation, ses dizaines de poignées d'axes nommées 'X'/
// 'Y'/'Z'/'XY'.../picker, cible de lumière...). Deux instances de three.js cohabitent dans
// l'éditeur (le bundle classique et le paquet webgpu, voir js/render-webgpu-bridge.mjs) avec
// chacune leur propre counter d'id : un id peut donc, dans certaines conditions de chargement,
// être partagé entre une poignée du gizmo et un objet de scène. scene.getObjectById() renvoie
// alors le premier trouvé dans l'ordre de traversée — pas forcément le bon — et un clic dans
// la hiérarchie sélectionne silencieusement le bad objet (ou aucun visuellement, l'objet
// trouvé n'étant pas dans `objects`). Chercher dans CE tableau élimine toute la classe de bug :
// il ne contient jamais que de vrais objets de projet.
export function objectOfSceneById(id){
  for(let i = 0; i < objects.length; i++){ if(objects[i].id === id) return objects[i]; }
  return null;
}
export const helpers = [];
export let counter = 0;
export function nextCounter(){ return ++counter; }
export const palette = [0xe06c75, 0x61afef, 0x98c379, 0xe5c07b, 0xc678dd, 0x56b6c2, 0xd19a66];

// Source unique des types d'objets créables par un humain (bar d'outils, menu Objet,
// menu contextuel du lot 8). Un plugin s'ajoute via Editor.enregistrerTypeObjet, qui
// pousse une entrée ici (voir plugins.js).
export const TYPES_CREATABLE = [
  {type:'cube', label:'Cube', icon:''},
  {type:'sphere', label:'Sphère', icon:''},
  {type:'cylinder', label:'Cylindre', icon:''},
  {type:'cone', label:'Cône', icon:''},
  {type:'torus', label:'Tore', icon:''},
  {type:'plane', label:'Plan', icon:''},
  {type:'star', label:'Étoile', icon:''},
  {type:'diamond', label:'Losange', icon:''},
  {type:'pyramid', label:'Pyramide', icon:''},
  {type:'wave', label:'Vague', icon:''},
  {type:'rock', label:'Rocher', icon:''},
  {type:'capsule', label:'Capsule', icon:''},
  {type:'group', label:'Groupe (nœud vide)', icon:'⬡ '},
  {type:'particles', label:'Émetteur de particules', icon:'✨ '},
  {type:'terrain', label:'Terrain sculptable', icon:'⛰ '},
  {type:'probe', label:'Sonde de réflexion', icon:'🔮 '},
  {type:'point', label:'Lumière ponctuelle', icon:'💡 '},
  {type:'spot', label:'Spot', icon:'🔦 '},
  {type:'directional', label:'Directionnelle', icon:'☀️ '},
  {type:'camera', label:'Caméra', icon:'🎥 '}
];

// Sous-ensemble affiché dans la bar d'outils (accès direct au clic). Le reste reste
// accessible via le menu Objet et les menus contextuels (Lot 8), qui lisent TYPES_CREATABLE
// en entier.
export const TYPES_BAR = ['cube', 'sphere', 'plane', 'group', 'point', 'camera'];

// ajoute une entrée de plugin (appelé depuis plugins.js:enregistrerTypeObjet)
export function addTypeCreatable(def){
  TYPES_CREATABLE.push({type: def.type, label: def.name, icon: def.icon || '🧱 ', plugin: true});
  if(typeof refreshTypesCreatable === 'function') refreshTypesCreatable();
}

// Menu contextuel générique (clic droit) : liste de {label, action}. `x`/`y` en coordonnées
// écran (clientX/clientY). `anchor` (facultatif) est le rectangle du bouton qui l'ouvre, pour
// que le menu remonte AU-DESSUS de lui quand il n'y a pas la place en dessous.
// Un seul élément DOM partagé par la vue, la hiérarchie et le panneau Projet.
export function openMenuContext(x, y, items, anchor){
  const el = document.getElementById('menu-context');
  el.innerHTML = items.map(function(it, i){
    // `mutates` coupe l'entree en lecture seule, exactement comme dans la barre de menus
    // (js/ui.js, renderDropdown) : deux rendus pour une meme notion, mais une seule regle.
    const off = it.mutates && isReadOnly();
    // `header` : un intitulé, pas une action. La hiérarchie posait un faux bouton cliquable qui ne
    // faisait rien (revue du 2026-09-29, § 4.15).
    if(it.header) return '<div class="menu-header" role="presentation">' + escapeHtml(it.label) + '</div>';
    return it.sep
      ? '<div class="menu-sep"></div>'
      : '<button class="item' + (off ? ' disabled' : '') + '" data-i="' + i + '"><span>'
        + it.label + '</span></button>';
  }).join('');
  // POSÉ D'ABORD, MESURÉ ENSUITE, PUIS RABATTU DANS L'ÉCRAN. Un menu ouvert près du bord bas
  // ou droit sortait de la fenêtre, et ses dernières entrées étaient simplement coupées — sans
  // barre de défilement, donc sans rien qui dise qu'il en manque. C'est le cas NORMAL du bouton
  // « ＋ Créer » : il est dans la barre du panneau du bas, et son menu descend.
  //
  // Le rabattement se fait vers le HAUT (le menu remonte au-dessus du point d'ancrage) plutôt
  // que par un simple décalage : sous le curseur, il masquerait ce qu'on vient de cliquer.
  el.style.left = '0px';
  el.style.top = '0px';
  el.style.display = 'block';
  el.classList.add('open');
  const m = el.getBoundingClientRect();
  const marge = 8;
  let gauche = x, haut = y;
  if(gauche + m.width > innerWidth - marge) gauche = Math.max(marge, innerWidth - marge - m.width);
  if(haut + m.height > innerHeight - marge){
    // Au-dessus du point d'ancrage s'il y a la place, sinon collé en haut : un menu plus haut
    // que la fenêtre doit montrer son DÉBUT, la liste se lisant de haut en bas.
    // `anchor` (le rectangle d'un bouton) permet de remonter AU-DESSUS de lui plutôt qu'au-dessus
    // du point cliqué : sans ça le menu recouvre le bouton qui vient de l'ouvrir.
    const base = (anchor && typeof anchor.top === 'number') ? anchor.top - 4 : y - 2;
    haut = (base - m.height >= marge) ? (base - m.height)
                                      : Math.max(marge, innerHeight - marge - m.height);
  }
  el.style.left = Math.max(marge, gauche) + 'px';
  el.style.top = Math.max(marge, haut) + 'px';
  // Un menu plus haut que l'écran défile plutôt que de déborder : c'est le seul cas où il ne
  // peut pas tenir, et le couper reviendrait à cacher des entrées.
  el.style.maxHeight = (innerHeight - 2 * marge) + 'px';
  el.style.overflowY = 'auto';

  function onClick(e){
    const btn = e.target.closest('.item');
    if(btn && btn.classList.contains('disabled')) return;   // ferme rien : l'entree est inerte
    if(btn){
      const it = items[parseInt(btn.dataset.i, 10)];
      if(it && it.action) it.action();
    }
    close();
  }
  function close(){
    el.style.display = 'none';
    el.classList.remove('open');
    el.removeEventListener('click', onClick);
    document.removeEventListener('pointerdown', onClickExterieur);
  }
  function onClickExterieur(e){
    if(!el.contains(e.target)) close();
  }
  el.addEventListener('click', onClick);
  // laisse le pointerdown qui a open ce menu (le clic droit lui-même) se terminer avant
  // d'écouter les clics extérieurs, sinon ce même événement le refermerait aussitôt
  setTimeout(function(){ document.addEventListener('pointerdown', onClickExterieur); }, 0);
}

// items pour créer un objet, communs à la vue et à la hiérarchie ; `surCree` reçoit
// l'objet créé pour un post-traitement (positionner dans la vue, reparenter dans la
// hiérarchie…) — voir viewport.js et hierarchy.js pour leurs usages respectifs.
export function itemsCreationContext(onCree){
  return TYPES_CREATABLE.map(function(t){
    return {
      label: (t.icon || '') + t.label,
      // Les DEUX menus contextuels de creation (hierarchie, vue) passent par ici : le marquage
      // tient en un seul endroit.
      mutates: true,
      action: function(){
        const o = createObject(t.type);
        if(o && onCree) onCree(o);
      }
    };
  });
}

export function refreshTypesCreatable(){
  const container = document.getElementById('bar-types-creatable');
  if(container){
    // Des boutons ICÔNE dans la palette flottante : le libellé passe en `title`. Un « Lumière
    // ponctuelle » écrit en toutes lettres faisait à lui seul un cinquième de la largeur de la
    // palette, posée sur la scène — c'est-à-dire sur ce qu'on est en train de regarder.
    // Le libellé reste lisible au survol, et le menu Objet le donne en clair.
    container.innerHTML = TYPES_CREATABLE.filter(function(t){ return TYPES_BAR.indexOf(t.type) !== -1; })
      .map(function(t){
        return '<button class="ui-icon-btn" data-add="' + t.type + '" title="'
          + escapeHtml(t.label) + '">' + (t.icon || '') + '</button>';
      }).join('');
    container.querySelectorAll('[data-add]').forEach(function(btn){
      btn.addEventListener('click', () => createObject(btn.dataset.add));
    });
  }
  if(typeof refreshMenuObject === 'function') refreshMenuObject();
}

export function listMats(m){ return Array.isArray(m.material) ? m.material : (m.material ? [m.material] : []); }

// échappement HTML : tout nom (objet, fichier, asset) injecté dans innerHTML passe par ici
// IMPORTÉ *ET* réexporté, et les deux sont nécessaires. `export { x } from './y.js'` seul rend
// `x` disponible aux IMPORTATEURS et à personne d'autre — le fichier qui l'écrit ne peut
// toujours pas l'appeler. Ce module s'en sert lui-même (ligne 381, ligne 836), et la seule
// réexportation a cassé l'éditeur au chargement : `escapeHtml is not defined`.
// Le harnais de test fournit un `escapeHtml` de substitution (test/engine-env.mjs), donc les
// 1831 tests sont restés verts. C'est test/globales-non-declarees.test.mjs qui le voit.
import { escapeHtml } from './escape-html.js';
export { escapeHtml };

// helpers visuels des lumières et caméras (référencés dans obj.ed, mis à jour dans la boucle)
/**
 * Le composant « typeName » d'un nœud, qu'il soit VIVANT ou encore à l'état de DÉBRIS.
 *
 * Un clone three.js recopie `userData` en JSON : chaque composant y survit comme un objet nu
 * portant `typeName` (voir Component.toJSON), sans classe ni méthodes. `reenableSubTree`
 * travaille sur une copie AVANT d'avoir réattaché de vrais composants, et a pourtant besoin de
 * savoir ce que le nœud est — c'était le rôle de `userData.type`.
 */
export function componentOrDebris(o, typeName){
  if(typeof o.getComponent === 'function'){
    const vivant = o.getComponent(typeName);
    if(vivant) return vivant;
  }
  const list = (o.userData && o.userData.components) || [];
  for(let i = 0; i < list.length; i++){
    const c = list[i];
    if(!c) continue;
    const t = c.typeName || (c.constructor && c.constructor.typeName);
    if(t === typeName) return c;
  }
  return null;
}

export function createHelperFor(o){
  removeHelper(o);
  let h = null;
  // Le repère d'édition vient de ce que le nœud PORTE, et plus d'un type stocké : c'est la
  // même question, posée à la seule source qui la connaisse encore.
  const light = componentOrDebris(o, 'Light');
  // Le composant Camera marque le nœud comme caméra et pose sa THREE.Camera dans ed(o).cam :
  // a droit au même repère. (Elle disparaît en tâche 9, fondue dans Camera.)
  const cam = componentOrDebris(o, 'Camera');
  if(light && ed(o).light){
    const st = light.subType;
    h = (st === 'spot') ? new THREE.SpotLightHelper(ed(o).light, 0xffd9a0)
      : (st === 'directional') ? new THREE.DirectionalLightHelper(ed(o).light, 1, 0xffd9a0)
      : new THREE.PointLightHelper(ed(o).light, 0.5, 0xffd9a0);
  }
  else if(cam && ed(o).cam) h = new THREE.CameraHelper(ed(o).cam);
  if(h){
    h.traverse(function(x){ x.raycast = function(){}; });
    h.raycast = function(){};
    liftOverlay(h);   // repère de lumière/caméra : devant les tuiles et sprites 2D
    scene.add(h);
    h.layers.set(LAYER_HELPERS);
    h.traverse(function(x){ x.layers.set(LAYER_HELPERS); });
    helpers.push(h);
    ed(o).helper = h;
  }
}

export function register(mesh, h){
  const a = Math.random()*Math.PI*2, r = 1 + Math.random()*4;
  mesh.position.set(Math.cos(a)*r, h, Math.sin(a)*r);
  scene.add(mesh);
  addSceneObject(mesh);
  // INVARIANT ECS : tout objet de scène porte un composant pour chacun de ses
  // sacs de données. Les fabriques natives (makePrimitive…) le respectent
  // déjà, mais un type d'objet venu d'un PLUGIN pose ce qu'il veut dans
  // userData sans passer par addComponent — et les Systèmes, qui interrogent
  // maintenant le Registry par type de composant, ne le verraient jamais. Ce
  // rattrapage était appelé au chargement d'un projet (serialization.js) et pas
  // à la création : on le met ici, au point de passage unique de toute création.
  syncComponents(mesh);
  select(mesh);
  updateHierarchy();
  applyFilters();
  // Un objet neuf n'a aucun environnement : depuis que le ciel sert de sonde par défaut,
  // il faut le lui poser tout de suite, sinon il reste mat au milieu d'objets qui
  // réfléchissent — jusqu'au prochain évènement qui recalcule les sondes, souvent une
  // réouverture de projet. Cause et effet séparés par une sauvegarde.
  if(typeof applyProbes === 'function') applyProbes();
  return mesh;
}

// Construit une géométrie de primitive à partir de son nom — partagé par
// makePrimitive() (création) et Mesh.inputDom() (changement de forme
// après coup, voir component-mesh.js). Renvoie aussi le nom d'affichage FR.
//
// LA GÉOMÉTRIE RENDUE EST PARTAGÉE, et c'est le point : mille cubes se posaient sur mille
// géométries (mesuré : 4 900 distinctes pour 5 000 objets), chacune envoyée au GPU pour elle
// seule. js/primitive-geometry.js n'en tient qu'une par forme et la protège contre `dispose`,
// de sorte qu'aucun des vingt-deux appelants de `geometry.dispose()` n'a eu à changer.
//
// Écrire un attribut sur la géométrie d'un objet exige donc de la détacher d'abord, par
// `geometryForWrite()` — sans quoi on écrirait sur tous les objets qui partagent la forme.
export function buildGeometry(geoName){
  const kind = (geoName && PRIMITIVE_LABELS[geoName]) ? geoName
    : (geoName && isExtraPrimitive(geoName) ? geoName : 'cube');
  // Étoile, losange, vague… : construites UNE fois pour l'éditeur et le jeu publié, et
  // retenues par la même table que les six formes de base.
  const geo = primitiveGeometry(THREE, kind, buildExtraPrimitive);
  const extra = EXTRA_PRIMITIVES.find(function(p){ return p.type === kind; });
  const name = PRIMITIVE_LABELS[kind] || (extra ? extra.label : 'Cube');
  return {geo: geo, name: name, geoName: kind};
}

// Géométrie « Custom » (Mesh.inputDom, component-mesh.js) : prend la géométrie
// du premier THREE.Mesh trouvé dans le template d'un asset modèle importé
// (kind 'model'), la clone (pour ne pas partager le buffer avec le template
// ni les autres instances) et la pose sur o. o.userData.geo pass à 'custom',
// o.userData.geoAsset garde l'id de l'asset source (relu par serialization.js).
export function applyGeometryAsset(o, asset){
  let geoSource = null;
  asset.template.traverse(function(n){ if(!geoSource && n.isMesh && n.geometry) geoSource = n.geometry; });
  if(!geoSource){
    setStatus('L\'asset « ' + asset.name + ' » ne contient aucun maillage utilisable', 3500);
    return false;
  }
  if(o.geometry) o.geometry.dispose();
  o.geometry = geoSource.clone();
  o.userData.geo = 'custom';
  o.userData.geoAsset = asset.id;
  return true;
}

export function makePrimitive(geoName){
  const construite = buildGeometry(geoName);
  const geo = construite.geo, name = construite.name;
  geoName = construite.geoName;
  const mat = new THREE.MeshStandardMaterial({
    color:palette[Math.floor(Math.random()*palette.length)], roughness:0.55, metalness:0.1});
  if(geoName === 'plane') mat.side = THREE.DoubleSide;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = name;
  mesh.userData.type = 'mesh';
  mesh.userData.geo = geoName;
  mesh.userData.emissiveBase = 0x000000;
  mesh.userData.emissiveSel = 0x3a2a08;
  mesh.castShadow = mesh.receiveShadow = true;
  applyNodeMixin(mesh);
  mesh.addComponent('Mesh');   // MeshFilter+MeshRenderer combinés : référence mesh.geometry/mesh.material directement
  mesh.addComponent('Collider');   // comportement historique : chaque primitive a un collider/corps rigide dispo sans passer par +Component
  mesh.addComponent('Physics');
  return mesh;
}

export function makeLight(type){
  let mesh, lum, name;
  const color = 0xffd9a0;

  if(type === 'point'){
    name = 'Lumière ponctuelle';
    mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 16, 12),
      new THREE.MeshStandardMaterial({color:0x111111, emissive:color, emissiveIntensity:1.4}));
    lum = new THREE.PointLight(color, 1.25, 28, 2);
  }
  else if(type === 'spot'){
    name = 'Spot';
    mesh = new THREE.Mesh(
      new THREE.ConeGeometry(0.32, 0.6, 20),
      new THREE.MeshStandardMaterial({color:0x111111, emissive:color, emissiveIntensity:1.2}));
    lum = new THREE.SpotLight(color, 1.6, 30, THREE.MathUtils.degToRad(30), 0.3, 1.5);
  }
  else {
    name = 'Directionnelle';
    mesh = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.32),
      new THREE.MeshStandardMaterial({color:0x111111, emissive:color, emissiveIntensity:1.4}));
    lum = new THREE.DirectionalLight(color, 0.8);
  }

  mesh.name = name;
  mesh.userData.type = type;
  mesh.userData.emissiveBase = color;
  mesh.userData.emissiveSel = 0xff8830;
  // icône d'édition uniquement (cf. makeCamera ci-dessous) : jamais visible par une caméra de jeu
  mesh.layers.set(LAYER_HELPERS);
  liftOverlay(mesh);   // icône d'édition : devant les tuiles et sprites 2D
  lum.castShadow = true;
  if(lum.shadow && lum.shadow.mapSize) lum.shadow.mapSize.set(1024,1024);
  mesh.add(lum);
  ed(mesh).light = lum;

  if(type === 'spot' || type === 'directional'){
    const target = new THREE.Object3D();
    target.position.set(0, -4, 0);
    target.userData.isTarget = true;
    mesh.add(target);
    lum.target = target;
  }
  applyNodeMixin(mesh);
  mesh.addComponent('Light', {
    subType: type, color: lum.color.getHex(), intensity: lum.intensity,
    range: lum.distance, angle: lum.angle, penumbra: lum.penumbra
  });
  return mesh;
}

export function makeCamera(){
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.42, 0.8),
    new THREE.MeshStandardMaterial({color:0x3a3f48, roughness:0.6}));
  mesh.name = 'Caméra';
  mesh.userData.type = 'camera';
  mesh.userData.emissiveBase = 0x000000;
  mesh.userData.emissiveSel = 0x1e3a52;

  const objectif = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.2, 0.3, 20),
    new THREE.MeshStandardMaterial({color:0x22262c, roughness:0.4}));
  objectif.rotation.x = Math.PI/2;
  objectif.position.z = 0.55;
  mesh.add(objectif);
  // le body/objectif de la caméra est une aide d'édition (icône), pas un objet de la
  // scène de jeu : sur LAYER_HELPERS, il reste invisible à la caméra elle-même (elle est
  // centrée dessus, il remplirait tout son champ) et à toute autre caméra de jeu — seule
  // camEditor (enableAll) le voit. Explicite (pas de .traverse) pour ne jamais toucher le
  // THREE.Camera ajouté ci-dessous, dont les calques ont un sens différent (camMask).
  mesh.layers.set(LAYER_HELPERS);
  objectif.layers.set(LAYER_HELPERS);
  liftOverlay(mesh);   // corps + objectif : devant les tuiles et sprites 2D

  const cam = new THREE.PerspectiveCamera(50, 16/9, 0.1, 100);
  cam.rotation.y = Math.PI;
  mesh.add(cam);
  ed(mesh).cam = cam;
  applyMaskCamera(mesh, cam);
  applyNodeMixin(mesh);
  mesh.addComponent('Camera', { fov: cam.fov, near: cam.near, far: cam.far });
  return mesh;
}

// applique le masque de calques de projet (userData.game.camMask) au THREE.Camera d'un
// objet caméra : sans camMask, la caméra voit tous les calques de PROJET (0-30), comportement
// historique inchangé — mais jamais LAYER_HELPERS (31, gizmo/helpers/sol/grille), qui reste
// réservé à camEditor (voir scene.js).
export function applyMaskCamera(camObj, camThree){
  camThree.layers.disableAll();
  const mask = camObj.userData.game && camObj.userData.game.camMask;
  if(!mask || !mask.length){
    for(let i = 0; i < LAYER_HELPERS; i++) camThree.layers.enable(i);
  }
  else mask.forEach(function(id){ camThree.layers.enable(id); });
}

// nœud d'organisation (équivalent du Node3D de Godot) : un proxy filaire discret,
// sans ombre ni physique, qui sert uniquement de parent
export function makeGroup(){
  const mesh = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.3),
    new THREE.MeshStandardMaterial({color:0x6b7280, wireframe:true}));
  mesh.name = 'Groupe';
  mesh.userData.type = 'group';
  mesh.userData.emissiveBase = 0x000000;
  mesh.userData.emissiveSel = 0x3a2a08;
  // proxy filaire d'édition uniquement : jamais visible par une caméra de jeu
  mesh.layers.set(LAYER_HELPERS);
  liftOverlay(mesh);
  applyNodeMixin(mesh);
  return mesh;
}

export const HEIGHTS = {cube:0.8, sphere:1, cylinder:0.9, cone:1, torus:1.4, plane:0.01, group:1};

// Table des fabriques natives : type -> {fabriquer, hauteur, apres}.
//
// C'était une cascade de `if(type === 'point' || ...) else if(type === 'camera')`
// dans createObject, close à la modification : add un type natif obligeait à
// rouvrir la fonction, et les deux cas particuliers de la fin (`if(type ===
// 'camera') o.lookAt(...)`, `if(type === 'terrain') o.position.set(...)`)
// vivaient à trente lignes de la fabrique correspondante.
//
// `height` est l'altitude de dépôt (voir register()), `apres` le
// post-traitement propre au type. Un type de PLUGIN n'entre pas dans cette table
// (il vit dans Editor.typesObjets, avec sa propre fabrique) : createObject lui
// garde une branche, mais une seule.
export const MADE_OBJECT = {
  point:       {make: function(){ return makeLight('point'); },       height: 3.5},
  spot:        {make: function(){ return makeLight('spot'); },        height: 3.5},
  directional: {make: function(){ return makeLight('directional'); }, height: 3.5},
  camera:      {make: makeCamera, height: 2.5,
                apres: function(o){ o.lookAt(0, 1, 0); }},
  group:      {make: makeGroup, height: 1},
  particles:  {make: function(){ return makeParticles(); }, height: 1.2},
  terrain:     {make: function(){ return buildTerrain(); },    height: 0,
                // un terrain se centre sur l'origine
                apres: function(o){ o.position.set(0, 0, 0); }},
  probe:       {make: function(){ return makeProbe(); },      height: 3}
};

export function createObject(type){
  let o, h;
  pushHistory();
  const fab = MADE_OBJECT[type];
  if(fab){ o = fab.make(); h = fab.height; }
  else if(typeof typePlugin === 'function' && typePlugin(type)){
    const tp = typePlugin(type);
    o = tp.make();
    if(!o || !o.isObject3D){
      setStatus('Plugin « ' + tp.plugin + ' » : fabriquer() doit renvoyer un Object3D', 4000);
      return null;
    }
    o.name = o.name || tp.name;
    o.userData.type = type;
    if(o.userData.emissiveBase === undefined) o.userData.emissiveBase = 0x000000;
    if(o.userData.emissiveSel === undefined) o.userData.emissiveSel = 0x3a2a08;
    h = 1;
  }
  else { o = makePrimitive(type); h = HEIGHTS[type] || 1; }
  counter++;
  o.name = o.name + ' ' + counter;
  createHelperFor(o);
  register(o, h);
  // matériau "Défaut" (asset) plutôt que des couleurs en dur sur l'objet — voir
  // ensureMaterialDefaultProject (materials.js).
  if(o.userData.type === 'mesh'){
    applyMaterialOn(ensureMaterialDefaultProject(), o);
  }
  if(fab && fab.apres) fab.apres(o);
  return o;
}


// ---------- Les nœuds d'un modèle, objets de scène (v0.159) ----------
//
// Voir js/model-nodes.js. Ici, le branchement propre à l'éditeur : chaque nœud exposé reçoit son
// sac d'édition et le mixin des composants — ce qui en fait un nœud qu'on sélectionne, qu'on
// déplace au gizmo et sur lequel on ajoute des composants.

/** Expose les nœuds d'une instance de modèle. `a` : l'asset modèle (ses réglages de Rig). */
export function exposeModelInstance(root, a){
  if(!root || typeof exposeModelNodes !== 'function') return [];
  // Replié dans la hiérarchie par défaut : un personnage, c'est soixante os — comme Unity, on ne
  // les déroule qu'à la demande.
  if(root.ed && root.ed.plie === undefined) root.ed.plie = true;
  return exposeModelNodes(root, (a && a.paramsImport) || {}, {
    // Un objet de scène de l'utilisateur, parenté sous un os, n'appartient pas au modèle.
    skip: function(c){ return isSceneObject(c) && c.userData.modelNode === undefined; },
    node: function(o){
      if(!o.ed) o.ed = {};
      if(typeof o.addComponent !== 'function' && typeof applyNodeMixin === 'function') applyNodeMixin(o);
      // « Generate Colliders » a posé le sac : le composant qui le porte.
      if(o.userData.collider && o.getComponent && !o.getComponent('Collider')) o.addComponent('Collider', o.userData.collider);
    }
  });
}

// ---------- Réactivation d'un sous-arbre cloné (duplication, instanciation) ----------
export function reenableSubTree(copie){
  copie.traverse(function(o){
    // Ce qui n'est pas un nœud de projet — la THREE.Light d'une lumière, la cible d'un spot,
    // l'objectif d'une caméra, les maillages internes d'un modèle — n'a pas de tableau de
    // composants. C'était `userData.type === undefined` qui posait la question.
    if(!Array.isArray(o.userData.components)) return;
    o.ed = {};
    // Un nœud de modèle GARDE le nom du fichier : c'est son adresse — celle de ses overrides,
    // et celle par laquelle un clip d'animation retrouve un os. Le numéroter les casserait.
    const modelNode = o.userData.modelNode !== undefined;
    if(!modelNode){
      counter++;
      o.name = o.name.replace(/\s*\d+$/, '') + ' ' + counter;
    }
    addSceneObject(o);

    // Un maillage de modèle importé partage son matériau avec le template : le cloner
    // dupliquerait des dizaines de matériaux par instance.
    if(o.isMesh && o.material && !modelNode && !componentOrDebris(o, 'Model')){
      o.material = o.material.clone();
      if(o.material.emissive) o.material.emissive.setHex(o.userData.emissiveBase || 0);
    }
    const light = componentOrDebris(o, 'Light');
    const cam = componentOrDebris(o, 'Camera');
    if(light){
      let lum = null, target = null;
      o.children.forEach(function(enf){
        if(enf.isLight) lum = enf;
        if(enf.userData && enf.userData.isTarget) target = enf;
      });
      ed(o).light = lum;
      if(lum && target) lum.target = target;
      createHelperFor(o);
    }
    if(cam){
      o.children.forEach(function(enf){ if(enf.isCamera) ed(o).cam = enf; });
      createHelperFor(o);
    }

    // THREE.Object3D.clone() ne recopie pas nos fonctions posées par
    // applyNodeMixin (getComponent/addComponent…), et le passage par
    // userData.composants a réduit chaque composant à son JSON (voir
    // Component.toJSON, component.js) : on réattache ici de vrais composants
    // sur la copie à partir de ces données, une fois ed(o)/lumiere/cam déjà en
    // place ci-dessus (onAdd() des composants Camera/Light les réutilise
    // au lieu d'en recréer).
    if(o.userData.components && o.userData.components.length && typeof o.addComponent !== 'function'){
      const raw = o.userData.components;
      // userData.scripts a survécu au clone tel quel (données brutes, pas des
      // Component) ; ScriptJS.onAdd va repousser une entrée par composant
      // ScriptJS reconstruit ci-dessous — on retire donc les doublons déjà
      // présents avant de rejouer addComponent (même logique que
      // syncComponents, component-migration.js).
      const countScripts = raw.filter(function(c){ return c && c.typeName === 'ScriptJS'; }).length;
      if(countScripts && o.userData.scripts) o.userData.scripts.length = Math.max(0, o.userData.scripts.length - countScripts);
      o.userData.components = [];
      applyNodeMixin(o);
      raw.forEach(function(c){ if(c && c.typeName) o.addComponent(c.typeName, c); });
    }
  });
}

export function cloneCleanly(obj){
  setHighlight(obj, false);
  const copie = obj.clone(true);
  setHighlight(obj, (obj === selection || selectionMulti.indexOf(obj) !== -1));
  // purge des visualisations d'édition embarquées dans la copie (collider, boîte de sonde)
  const vizAMort = [];
  copie.traverse(function(o){
    if(o.userData && (o.userData.isColliderViz || o.userData.isHelpProbe)) vizAMort.push(o);
  });
  vizAMort.forEach(function(v){
    v.parent.remove(v);
    if(v.geometry) v.geometry.dispose();
  });
  return copie;
}

refreshTypesCreatable();

// ---------------------------------------------------------------------------
// Les PORTEURS de l'éditeur (voir NodeShells, js/component.js). Un nœud relu prend l'objet que
// réclame le premier de ses composants à en vouloir un ; les autres se contentent d'un Group.
//
// Ici, ce sont les fabriques de l'éditeur : elles donnent à une lumière son repère visible, à
// une caméra son boîtier, à un nœud d'organisation son octaèdre filaire. Le jeu publié
// enregistre les siennes, allégées (js/game-runtime.js) — c'est le seul point où les deux
// divergent, et il est déclaré des deux côtés au lieu d'être deviné.
NodeShells.register('Mesh', function(d){ return makePrimitive(d.geo || 'cube'); });
// Le sous-type décide de la forme du repère ET du type de THREE.Light : c'est la seule donnée
// qu'il faut connaître AVANT de construire.
NodeShells.register('Light', function(d){ return makeLight(d.subType || 'point'); });
NodeShells.register('Camera', function(){ return makeCamera(); });
// Un modèle importé est un CLONE de son asset : il n'existe pas de fabrique qui le construise
// de rien. Sans l'asset, on rend null — l'appelant posera un nœud de substitution plutôt que de
// faire disparaître la branche entière de la scène.
NodeShells.register('Model', function(d, ctx){
  const a = assetOfReference((ctx && ctx.assetsById) || {}, d.assetId);
  if(!a || !a.template) return null;
  const o = cloneModel(a.template);
  // externalClips (SkinnedMeshRenderer) ne se repose PAS ici : ce composant vit sur le
  // DESCENDANT skinné du clone, un entry séparé de celui de cette racine Model (constat 3 du
  // plan) — au moment où ce shell tourne, `cloneModel` vient de lui poser un composant VIERGE,
  // et ce descendant n'a pas encore été reconstruit par `rebuildTree`. Voir la passe de second
  // temps à la fin de `rebuildTree` (js/serialization.js), qui repose `externalClips` une fois
  // l'arbre ENTIER construit.
  o.ed = {};
  // cloneModel()/Object3D.clone() ne recopient pas les fonctions posées par applyNodeMixin sur
  // le template : sans ça, aucun composant ne peut être posé sur le clone.
  if(typeof applyNodeMixin === 'function') applyNodeMixin(o);
  // Ses nœuds deviennent des objets de scène (v0.159) ; `rebuildTree` les range dans sa table
  // et y repose leurs overrides.
  exposeModelInstance(o, a);
  return o;
});


// EXPOSÉ EN GLOBALE, à dessein. Ces symboles sont appelés depuis des fichiers
// que les mêmes pages ne chargent pas toutes : un `import` y pointerait un
// fichier absent, et la page ne démarrerait pas. Ils gardent donc leur garde
// `typeof` côté appelant, et se déclarent ici.
globalThis.addSceneObject = addSceneObject;
globalThis.exposeModelInstance = exposeModelInstance;
globalThis.applyGeometryAsset = applyGeometryAsset;
globalThis.applyMaskCamera = applyMaskCamera;
globalThis.buildGeometry = buildGeometry;
globalThis.clearSceneObjects = clearSceneObjects;
globalThis.counter = counter;
globalThis.createHelperFor = createHelperFor;
globalThis.escapeHtml = escapeHtml;
globalThis.isSceneObject = isSceneObject;
globalThis.makePrimitive = makePrimitive;
globalThis.objects = objects;
globalThis.palette = palette;
globalThis.register = register;
globalThis.removeSceneObject = removeSceneObject;