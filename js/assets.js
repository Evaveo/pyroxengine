// ---------- Assets (panneau Projet) ----------
import { cloneModel, forgetClipCompiled } from './anim-models.js';
import { anim, closeClipAsset } from './animation.js';
import { openAnimatorOnAsset } from './animator-graph.js';
import { bindDecoders, compressionsOfModel, decodersMissing, messageDecodersMissing, shareBlobs } from './asset-compression.js';
import { attachAudioAsset, createAssetAudio, createAssetLoop, createAssetSfx, engineAudio, togglePreviewAudio } from './audio.js';
import { presetSfx } from './chip-synth.js';
import { presetLoop } from './music-loop.js';
import { isPlayableAudio } from './component-data.js';
import { logConsole } from './console.js';
import { setStatus, updateHierarchy } from './hierarchy.js';
import { pushHistory } from './history.js';
import { lastAssetEditedBy, openEditorExternal, refreshExternal } from './external-editor.js';
import { IMPORT_DEFAULT, MAP_BY_TYPE, applyImportModel, applyImportTexture, buildInspectorAsset, captureMatFile, configureTexture, disposeMaterialOfModels, ensureParamsImport, meshesModel, refreshInspectorAsset, refreshSpritesOfLAsset, subAssetsOfModel } from './import-settings.js';
import { buildInspector } from './inspector.js';
import { assignShaderOnMaterial, attachMaterialAsset, createAssetMaterial } from './materials.js';
import { applyNodeMixin } from './node.js';
import { cloneCleanly, createSceneNode, escapeHtml, exposeModelInstance, isSceneObject, listMats, objects, openMenuContext, palette, reenableSubTree } from './objects.js';
import { openWindowPalette } from './palette-ui.js';
import { modePaint, stopPaint, togglePaint } from './placement.js';
import { Editor, importForFile } from './plugins.js';
import { createAssetPostProfile } from './post-profile.js';
import { createFolderEmptyOnDisk, moveFileOnDisk, moveFilesAssetOnDisk, removeEmptyFolderOnDisk, removeFilesAssetOnDisk, writeAssetInFolder } from './project-folder.js';
import { project } from './project.js';
import { applyFilters, renderer, scene, viewEl } from './scene.js';
import { holdersOfScriptAsset, mergeVarsDeclared, openEditorScriptAsset } from './scripts.js';
import { assetSelected, select, selectAsset, selection } from './selection.js';
import { diskAssetManifest } from './serialization.js';
import { component, openEditorGraphShader } from './shader-graph-editor.js';
import { emptyPalette } from './tile-palette.js';
import { closeModal, openModal } from './ui.js';
import { openEditorPostProfile } from './ui/panels-postprofile.js';
import { camCurrent, coordsMouse, loop, mouse, raycaster } from './viewport.js';

export const assets = [];
export let assetId = 0;
// Un `export let` ne se réassigne QUE depuis ce fichier — un autre module qui écrit
// `assetId = ...` ou `++assetId` directement lève une `TypeError: Assignment to constant
// variable`, le binding d'import étant en lecture seule. Cet accesseur est le seul point
// d'écriture externe (voir aussi `setFolderCurrent` plus bas, même raison).
export function nextAssetId(){ return ++assetId; }

// ---------- L'IDENTITÉ D'UN ASSET EST PERSISTANTE ----------
//
// LA CAUSE RACINE D'UNE FAMILLE ENTIÈRE DE PANNES MUETTES. `assetId` est un compteur de
// SESSION : avant ce lot, rouvrir un projet recréait tous les assets avec de NOUVEAUX
// numéros, dans l'ordre où le chargeur les rencontrait. Les fichiers du projet, eux,
// contenaient les numéros de la session précédente. Tout ne tenait plus que par
// `remapReferencesAssetsInScenes` — une table de traduction ancien→nouveau tenue À LA MAIN,
// champ par champ, sur les ~500 références d'un projet réel. Chaque champ oublié donnait soit
// une référence morte (« document d interface a1 introuvable »), soit — bien pire — une
// référence GLISSÉE vers l'asset qui avait hérité du numéro, sans un seul message.
// sprite2d.spriteId, scriptId, Model.assetId, PostVolume.profileId, UIDocument.documentUIId :
// cinq fois le même défaut, cinq corrections après coup.
//
// Le remède n'est pas une sixième entrée dans la table : c'est que le numéro ne bouge plus.
// Un asset relu du disque REPREND l'id qu'il portait — donc le remappage devient l'identité,
// et un champ oublié ne peut plus rien casser. `remapReferencesAssetsInScenes` reste en place
// comme filet (projets d'avant ce lot, références réellement mortes), mais ne porte plus rien.
//
// Deux invariants, et c'est tout ce qui fait tenir l'édifice :
//   1. `reserveAssetId` est appelé sur TOUS les ids relus AVANT la moindre création, pour que
//      le compteur reparte au-dessus du plus grand — sinon un asset découvert sur le disque
//      recevrait le numéro d'un asset déclaré, et volerait ses références.
//   2. `adoptAssetId` refuse un id déjà pris dans la session : deux assets qui portent le même
//      numéro seraient indiscernables, et c'est précisément la corruption qu'on répare.
export function reserveAssetId(id){
  const m = /^a(\d+)$/.exec(String(id || ''));
  if(m) assetId = Math.max(assetId, Number(m[1]));
}

/**
 * Rend à `a` l'identifiant `wanted` qu'il portait dans le fichier de projet. Sans effet si
 * l'id n'a pas la forme attendue (un descripteur DÉCOUVERT sur le disque porte
 * `decouvert:<chemin>`, qui n'est pas une identité persistante) ou s'il est déjà pris.
 *
 * `taken` est le Set des ids déjà attribués pendant CE chargement — l'appelant le tient.
 */
export function adoptAssetId(a, wanted, taken){
  if(!a || !/^a\d+$/.test(String(wanted || ''))) return a;
  if(taken && taken.has(wanted)) return a;
  if(taken){ taken.delete(a.id); taken.add(wanted); }
  const before = a.id;
  a.id = wanted;
  // Les clips d'un modèle (sous-assets, onglet Animation) désignent leur modèle par son id :
  // ils le suivent, sinon ils pointeraient le numéro de session que le modèle vient de quitter.
  if(a.kind === 'model'){
    assets.forEach(function(x){
      if(x.kind !== 'animation' || x.embedded !== before) return;
      x.embedded = wanted;
      if(x.source) x.source.asset = wanted;
    });
  }
  // Un modèle porte son propre id DANS son template three.js (createAssetModel) : les nœuds
  // de scène s'y réfèrent pour retrouver leur provenance. Oublié ici, le modèle garderait le
  // numéro de session dans sa racine et celui du fichier dans l'asset — deux vérités.
  //
  // UN MODÈLE, ET RIEN D'AUTRE. Un PREFAB a aussi un template, mais le `userData.assetId` de sa
  // racine est l'id du MODÈLE qu'elle instancie (composant Model), pas le sien. L'écraser ici
  // faisait pointer chaque prefab bâti sur un modèle vers LUI-MÊME à chaque réouverture, puis
  // l'enregistrait ainsi : « asset absent » au lancement, héros invisible (Zeldo, 2026-10-02 —
  // en place depuis la v0.140.0).
  if(a.kind === 'model' && a.template && a.template.userData) a.template.userData.assetId = wanted;
  return a;
}
export const projectBody = document.getElementById('project-body');

export let rPreview = null, sPreview = null, cPreview = null;
let previewReady = false;
// LE RENDERER DE VIGNETTE EST UN WebGPURenderer SUR SON BACKEND WebGL2 (forceWebGL). C'était un
// THREE.WebGLRenderer, qui n'existe que dans vendor/three.min.js — le second three.js, retiré en
// v0.173.2 (docs/KNOWN_ISSUES.md). forceWebGL et non WebGPU : la vignette se relit en PNG par
// toDataURL() dans la foulée du rendu, ce qu'un canvas WebGL permet synchroniquement.
// init() est asynchrone et previewObject3D() ne l'est pas (neuf appelants) : on l'amorce dès le
// chargement du module, bien avant la première vignette, qui suit toujours un geste utilisateur.
function setupPreviewRenderer(){
  rPreview = new THREE.WebGPURenderer({antialias:true, alpha:true, forceWebGL:true});
  rPreview.setSize(96, 96);
  sPreview = new THREE.Scene();
  sPreview.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.0));
  const d = new THREE.DirectionalLight(0xffffff, 0.9);
  d.position.set(3, 5, 4);
  sPreview.add(d);
  cPreview = new THREE.PerspectiveCamera(40, 1, 0.01, 1000);
  cPreview.layers.enableAll();
  Promise.resolve(rPreview.init()).then(function(){ previewReady = true; })
    .catch(function(e){ console.warn('[moteur] renderer de vignette indisponible :', e); });
}
// Une vignette ne doit JAMAIS empêcher le module de se charger : hors page réelle (harnais de
// test, THREE factice), on renonce et previewObject3D() retentera au premier appel.
if(typeof THREE !== 'undefined' && typeof THREE.WebGPURenderer === 'function' && typeof document !== 'undefined'){
  try { setupPreviewRenderer(); } catch(e){ rPreview = null; }
}
/**
 * Vignette d'un objet, rendue hors écran.
 *
 * `opts.size` (96 par défaut) et `opts.angle` (en degrés, azimut de la caméra) servent à
 * l'aperçu de l'inspecteur d'import, qui montre le modèle en grand et qu'on peut tourner —
 * le même renderer sert les deux, il change juste de taille le temps du rendu.
 */
export function previewObject3D(object, opts){
  const size = (opts && opts.size > 0) ? opts.size : 96;
  const angle = (opts && opts.angle) ? opts.angle * Math.PI / 180 : 0;
  if(!rPreview){
    try { setupPreviewRenderer(); } catch(e){ rPreview = null; return ''; }
  }
  // Backend pas encore prêt (tout premier instant de la page) : pas de vignette plutôt qu'une
  // image vide. Les appelants gardent `preview` vide ; l'explorateur affiche alors l'icône.
  if(!previewReady) return '';
  rPreview.setSize(size, size);
  const clone = object.clone(true);
  sPreview.add(clone);
  const box = new THREE.Box3().setFromObject(clone);
  const center = box.getCenter(new THREE.Vector3());
  const dims = box.getSize(new THREE.Vector3());
  const ray = Math.max(dims.x, dims.y, dims.z) || 1;
  // l'azimut par défaut (0°) est celui d'avant : trois quarts, légèrement plongeant
  const dx = Math.cos(angle) * 1.1 - Math.sin(angle) * 1.1;
  const dz = Math.sin(angle) * 1.1 + Math.cos(angle) * 1.1;
  cPreview.position.set(center.x + ray * dx, center.y + ray * 0.8, center.z + ray * dz);
  cPreview.lookAt(center);
  // LES REFLETS NE TRAVERSENT PAS D'UN RENDERER À L'AUTRE. Le clone partage les matériaux de la
  // scène, qui portent souvent en envMap la cible cube du reflet du ciel (probes.js) — une
  // texture qui n'existe que dans le contexte GL du renderer PRINCIPAL. Ce renderer de vignette
  // ne la connaît pas : il tente de la téléverser comme six images, qui n'existent pas, et lève
  // « texSubImage2D : Overload resolution failed » (constaté à chaque create_prefab). On retire
  // le temps du rendu toute envMap issue d'une cible de rendu, puis on la remet.
  const envStripped = [];
  clone.traverse(function(x){
    if(!x.material) return;
    (Array.isArray(x.material) ? x.material : [x.material]).forEach(function(m){
      if(m && m.envMap && m.envMap.isRenderTargetTexture){ envStripped.push([m, m.envMap]); m.envMap = null; }
    });
  });
  try { rPreview.render(sPreview, cPreview); }
  finally { envStripped.forEach(function(p){ p[0].envMap = p[1]; }); }
  const url = rPreview.domElement.toDataURL('image/png');
  sPreview.remove(clone);
  return url;
}

// ---------- Explorateur : dossiers du projet ----------
// Chaque asset porte a.folder ('' = racine, 'Persos/Textures' = imbriqué).
// project.dossiers garde les dossiers explicites (y compris vides).
export let folderCurrent = '';
export function setFolderCurrent(v){ folderCurrent = v; }
export const foldersTree = document.getElementById('folders-tree');

export function listFolders(){
  const set = new Set();
  function addWithParents(filePath){
    if(!filePath) return;
    const parts = filePath.split('/');
    for(let i = 1; i <= parts.length; i++) set.add(parts.slice(0, i).join('/'));
  }
  (project.folders || []).forEach(addWithParents);
  assets.forEach(function(a){ addWithParents(a.folder || ''); });
  return Array.from(set).sort();
}

export function createFolderIn(parent){
  const name = prompt('Nom du nouveau dossier' + (parent ? ' (dans « ' + parent + ' »)' : '') + ' :');
  if(!name || !name.trim()) return;
  const propre = name.trim().replace(/[\/\\]/g, '-');
  const filePath = parent ? parent + '/' + propre : propre;
  if(!project.folders) project.folders = [];
  if(project.folders.indexOf(filePath) === -1){
    project.folders.push(filePath);
    if(project.handleFolder){
      // Les dossiers vivent sous assets/<chemin> — même convention que les fichiers
      // d'assets eux-mêmes (writeAssetInFolder/writeFileInFolder), pour
      // que le panneau Projet et le disque restent le même arbre, sans doublon.
      createFolderEmptyOnDisk(project.handleFolder, 'assets/' + filePath)
        .catch(function(e){ setStatus('Dossier créé en mémoire mais pas sur le disque : ' + e.message, 5000); });
    }
  }
  folderCurrent = filePath;
  revealFolderInTree(filePath);
  updateProject();
}

export function createFolder(){ createFolderIn(folderCurrent); }

/**
 * Renomme un dossier du panneau Projet. LE DISQUE SUIT, depuis la v0.150.3.
 *
 * C'était le pire cas de la famille, et son propre message de confirmation le décrivait : le
 * dossier gardait son nom sur le disque, les fichiers étaient réécrits au nouveau chemin au
 * prochain enregistrement, et **les anciens revenaient en DOUBLE** au rafraîchissement suivant.
 * Pire que la suppression de dossier, donc : celle-ci laissait des orphelins, celui-là les
 * dupliquait. Le message allait jusqu'à conseiller de renommer le dossier à la main sur le
 * disque puis de rafraîchir — un contournement, pas un comportement.
 */
export async function renameFolder(filePath){
  if(project.handleFolder && !confirm('Renommer ce dossier renommera aussi le dossier '
      + 'correspondant sur le disque, avec les fichiers qu\'il contient. Cette action ne pourra '
      + 'pas être annulée (Ctrl+Z). Continuer ?')) return;
  const old = filePath.split('/').pop();
  const name = prompt('Nom du dossier :', old);
  if(!name || !name.trim() || name.trim() === old) return;
  const parent = filePath.split('/').slice(0, -1).join('/');
  const fresh = (parent ? parent + '/' : '') + name.trim().replace(/[\/\\]/g, '-');
  function remap(c){
    if(c === filePath) return fresh;
    if(c.indexOf(filePath + '/') === 0) return fresh + c.slice(filePath.length);
    return c;
  }
  const avant = snapshotDiskPaths();
  project.folders = (project.folders || []).map(remap);
  assets.forEach(function(a){ a.folder = remap(a.folder || ''); });
  folderCurrent = remap(folderCurrent);
  updateProject();

  // L'ancien dossier est vidé par la réconciliation (chaque fichier part vers le nouveau) : il
  // ne reste qu'à retirer la coquille, et seulement si elle est bien vide.
  try { await reconcileDiskPaths(avant, [filePath]); }
  catch(e){
    setStatus('Dossier renommé dans le projet, mais le disque n\'a pas suivi : ' + e.message
      + ' — « Rafraîchir » peut faire apparaître des assets en double', 8000);
  }
}

// ---------- LE DISQUE SUIT LA MÉMOIRE — la réconciliation, pour TOUTES les opérations ----------
//
// LA FAMILLE DE DÉFAUTS QUE CECI FERME. Le chemin disque d'un asset se calcule
// (`diskAssetManifest`, js/serialization.js) à partir de deux choses qui bougent : son DOSSIER,
// et son NOM — la moitié des genres (script, matériau, données, préréglage, HTML, CSS, animator,
// animation, sprite, palette, graphe de shader, profil de post-traitement) nomment leur fichier
// `slugFile(a.name)`. Toute opération qui change l'un des deux change donc le chemin disque.
//
// Quand le disque ne suivait pas, TROIS dégâts arrivaient ensemble, et c'est le troisième qui
// rendait le tout incompréhensible :
//   1. l'ancien fichier restait et était RÉADOPTÉ au rafraîchissement suivant — l'asset
//      « supprimé » ou « renommé » revenait, parfois en double ;
//   2. le cache d'écriture incrémentale (js/write-cache.js) ne reconnaissait plus aucun chemin :
//      TOUT le projet était réécrit à chaque enregistrement, d'où une sauvegarde soudainement
//      très longue après une simple manipulation ;
//   3. et les suppressions d'assets faites ENSUITE cherchaient leur fichier au nouveau chemin,
//      ne l'y trouvaient pas, et échouaient en silence — donc ces assets-là revenaient aussi,
//      alors qu'on n'avait pas touché à leur dossier.
//
// Trois opérations le faisaient déjà correctement, chacune avec sa propre copie du raisonnement
// (`moveAssetTo`, le rangement automatique, `removeAsset`) ; deux ne le faisaient pas du tout
// (`renameFolder`, et TOUT renommage d'asset). Plutôt qu'une sixième copie, ces deux fonctions
// encadrent désormais leur mutation par `snapshotDiskPaths()` / `reconcileDiskPaths()`.
//
// LE PRINCIPE : on photographie les chemins AVANT, on laisse la mutation faire ce qu'elle veut
// en mémoire, on recalcule APRÈS, et on déplace sur le disque tout ce qui a changé de place. La
// réconciliation ne sait pas ce qui a été fait, et c'est sa qualité : une opération future qui
// déplace ou renomme est couverte sans qu'on ait à y penser.

/** Les chemins disque de chaque asset, par id. À appeler AVANT une mutation. */
export function snapshotDiskPaths(){
  const out = new Map();
  if(!project.handleFolder) return out;
  for(const d of diskAssetManifest().assets){
    const prefixe = 'assets/' + (d.folder ? d.folder + '/' : '');
    const names = d.files || (d.file ? [d.file] : []);
    if(names.length) out.set(d.id, names.map(function(n){ return prefixe + n; }));
  }
  return out;
}

/**
 * Déplace sur le disque tout asset dont le chemin a changé depuis la photographie.
 *
 * L'APPARIEMENT SE FAIT PAR INDICE, et c'est sûr : les deux listes viennent du même code
 * (`diskAssetManifest`) pour le même asset, donc dans le même ordre — c'est déjà le contrat que
 * `collectAtlasLightmap`/`reapplyAtlasLightmap` tiennent ailleurs. Un asset ABSENT de l'après a
 * été supprimé : `removeAsset` a déjà effacé ses fichiers, on n'y touche pas.
 *
 * `dossiersAVider` est facultatif : les dossiers à retirer s'ils sont devenus vides.
 */
export async function reconcileDiskPaths(avant, dossiersAVider){
  if(!project.handleFolder || !avant || !avant.size) return 0;
  const apres = snapshotDiskPaths();
  let bouges = 0;
  for(const [id, cheminsAvant] of avant){
    const cheminsApres = apres.get(id);
    if(!cheminsApres) continue;           // supprimé entre-temps : removeAsset s'en est chargé
    for(let i = 0; i < cheminsAvant.length; i++){
      const de = cheminsAvant[i], vers = cheminsApres[i];
      if(!vers || de === vers) continue;
      if(await moveFileOnDisk(project.handleFolder, de, vers)) bouges++;
    }
  }
  for(const f of (dossiersAVider || [])){
    await removeEmptyFolderOnDisk(project.handleFolder, f);
  }
  return bouges;
}

/**
 * Applique une mutation qui peut changer le CHEMIN DISQUE d'un asset, et fait suivre le disque.
 *
 * À utiliser pour tout ce qui touche le `name` ou le `folder` d'un asset. Le nom de fichier de
 * la moitié des genres est `slugFile(a.name)` : un simple renommage déplace le fichier, et sans
 * cet enrobage l'ancien restait sur le disque — réadopté en DOUBLE au rafraîchissement suivant,
 * et réécriture complète du projet à chaque enregistrement (voir le bloc au-dessus).
 *
 * L'enrobage existe pour qu'on n'ait plus à y penser : `snapshot → mutation → updateProject →
 * reconcile`, toujours dans cet ordre, une seule fois écrit.
 */
export async function mutateAsset(fn){
  const avant = snapshotDiskPaths();
  fn();
  updateProject();
  try { await reconcileDiskPaths(avant); }
  catch(e){
    setStatus('Modifié dans le projet, mais le disque n\'a pas suivi : ' + e.message
      + ' — « Rafraîchir » peut faire apparaître des assets en double', 8000);
  }
}

/**
 * Supprime un dossier du panneau Projet ; son contenu remonte dans le dossier parent.
 *
 * LE DISQUE SUIT LA MÉMOIRE, depuis la v0.150.2. Avant, cette fonction ne remappait que l'état
 * en mémoire et l'annonçait dans son propre message de confirmation — « le dossier et ses
 * fichiers restent sur le disque ». Ce n'était pas une limite anodine : elle produisait TROIS
 * dégâts en cascade, et c'est le troisième qui rendait le défaut incompréhensible.
 *
 *   1. Les fichiers restés à l'ancien emplacement étaient RÉADOPTÉS au rafraîchissement suivant
 *      (adoptNewAssets/discoverFolderAssets, js/project.js) — les assets supprimés revenaient.
 *   2. Chaque asset changeant de chemin disque, le cache d'écriture incrémentale ne reconnaissait
 *      plus rien : TOUT le projet était réécrit à chaque enregistrement, d'où une sauvegarde
 *      soudainement très longue après une simple suppression.
 *   3. Et ensuite, supprimer un asset UN PAR UN cherchait son fichier dans le NOUVEAU dossier,
 *      ne l'y trouvait pas, et échouait en silence (`removeFilesAssetOnDisk` est best-effort) —
 *      donc ces assets-là revenaient aussi, alors qu'on n'avait pas touché à leur dossier.
 *
 * `moveAssetTo` déplaçait déjà les fichiers sur le disque : l'asymétrie entre les deux était la
 * vraie anomalie.
 */
export async function deleteFolder(filePath){
  if(project.handleFolder && !confirm('Supprimer ce dossier déplacera aussi ses fichiers sur le '
      + 'disque, dans le dossier parent. Cette action ne pourra pas être annulée (Ctrl+Z). '
      + 'Continuer ?')) return;
  if(!confirm('Supprimer le dossier « ' + filePath + ' » ?\nSon contenu remonte dans le dossier parent.')) return;
  const parent = filePath.split('/').slice(0, -1).join('/');
  function remap(c){
    if(c === filePath) return parent;
    if(c.indexOf(filePath + '/') === 0) return (parent ? parent + '/' : '') + c.slice(filePath.length + 1);
    return c;
  }
  // LA PHOTOGRAPHIE SE PREND AVANT LA MUTATION. Le nom disque d'un asset est calculé à partir
  // de son dossier COURANT, et pour les genres dont le nom n'existe qu'à l'écriture (script,
  // matériau, graphe de shader) il n'existe nulle part ailleurs : le lire après coup donnerait
  // le nouveau chemin, où il n'y a rien.
  const avant = snapshotDiskPaths();

  project.folders = (project.folders || []).map(remap)
    .filter(function(c, i, t){ return c && t.indexOf(c) === i; });
  assets.forEach(function(a){ a.folder = remap(a.folder || ''); });
  folderCurrent = remap(folderCurrent);
  updateProject();

  // Le dossier ne part qu'une fois VIDÉ, et sans `recursive` : si une remontée a échoué, on
  // préfère un dossier qui traîne à un fichier perdu.
  try { await reconcileDiskPaths(avant, [filePath]); }
  catch(e){
    setStatus('Dossier supprimé du projet, mais le disque n\'a pas suivi : ' + e.message
      + ' — « Rafraîchir » peut faire réapparaître ses assets', 8000);
  }
}

// `opts.silent` : pas de confirm() — un outil du copilote/MCP a déjà été validé par l'auteur, et
// une fenêtre modale bloquerait l'appel distant sans que personne ne la voie.
export function moveAssetTo(a, filePath, opts){
  const old = a.folder || '';
  if(old === filePath) return;
  if(project.handleFolder && !(opts && opts.silent) && !confirm('Déplacer cet asset déplacera aussi son fichier sur le '
      + 'disque. Cette action ne pourra pas être annulée (Ctrl+Z). Continuer ?')) return;
  // Le nom de fichier disque est calculé par diskAssetManifest() — c'est lui qui fait
  // foi pour TOUS les genres, y compris ceux dont le nom n'existe qu'à l'écriture (script,
  // matériau, graphe de shader). Il doit être lu AVANT de changer a.folder.
  const names = [];
  if(project.handleFolder){
    const d = diskAssetManifest().assets.find(function(x){ return x.id === a.id; });
    if(d) names.push.apply(names, d.files || (d.file ? [d.file] : []));
  }
  a.folder = filePath;
  updateProject();
  if(names.length){
    moveFilesAssetOnDisk(project.handleFolder, old, filePath, names)
      .catch(function(e){ setStatus('Asset déplacé dans le projet mais pas sur le disque : ' + e.message, 6000); });
  }
  setStatus('« ' + a.name + ' » déplacé dans ' + (filePath || 'la racine'), 2000);
}

// Range dans son PROPRE sous-dossier (nommé d'après lui) tout modèle du projet qui embarque
// des clips d'animation, à côté des assets Animation qu'on en a extraits — le même geste que
// celui posé à l'import (voir ok() du drop de fichiers, plus haut), mais appliqué aux assets
// DÉJÀ présents (déclarés dans project.json ou découverts sur le disque). Sans ce passage, seul
// un FBX importé APRÈS le geste d'extraction automatique se voyait rangé : tout ce qui existait
// avant dans le projet restait à plat, à la racine ou dans le dossier où il avait été importé
// à l'origine. Appelée à CHAQUE OUVERTURE d'un dossier project (project.js), comme la
// découverte d'assets ou l'adoption des dossiers du disque — pas une action ponctuelle.
export function organizeModelsInOwnFolders(){
  let deplaces = 0;
  assets.filter(function(a){
    return a.kind === 'model' && a.template && (a.template.animations || []).length;
  }).forEach(function(a){
    const own = (a.name || '').replace(/[\/\\]/g, '-');
    if(!own) return;
    const segments = (a.folder || '').split('/').filter(Boolean);
    // déjà rangé : le dernier segment du dossier porte déjà son propre nom
    if(segments[segments.length - 1] === own) return;
    const folderCible = segments.concat([own]).join('/');
    const old = a.folder || '';
    // Le nom de fichier disque du modèle — voir moveAssetTo, même source, même ordre : lu
    // AVANT de changer a.folder. Les assets Animation liés n'ont pas de fichier propre (ils
    // référencent le modèle par id, jamais par nom de fichier) : seul le modèle bouge sur disque.
    const names = [];
    if(project.handleFolder){
      const d = diskAssetManifest().assets.find(function(x){ return x.id === a.id; });
      if(d) names.push.apply(names, d.files || (d.file ? [d.file] : []));
    }
    a.folder = folderCible;
    assets.filter(function(x){
      return x.kind === 'animation' && x.source && x.source.asset === a.id;
    }).forEach(function(x){ x.folder = folderCible; });
    if(!project.folders) project.folders = [];
    if(project.folders.indexOf(folderCible) === -1) project.folders.push(folderCible);
    deplaces++;
    if(names.length){
      moveFilesAssetOnDisk(project.handleFolder, old, folderCible, names)
        .catch(function(e){ setStatus('« ' + a.name + ' » rangé dans le projet mais pas sur le disque : ' + e.message, 6000); });
    }
  });
  if(deplaces) updateProject();
  return deplaces;
}

// Les dossiers REPLIÉS de l'arbre, par chemin ('' = la racine « Projet », qui replie tout).
// État de session, pas de projet : il ne part ni dans le `.p3d` ni sur le disque.
export const foldersCollapsed = new Set();

/** Un dossier est masqué dans l'arbre dès qu'un de ses ancêtres (racine comprise) est replié. */
export function folderHiddenInTree(filePath){
  if(foldersCollapsed.has('')) return true;
  const parts = filePath.split('/');
  for(let i = 1; i < parts.length; i++){
    if(foldersCollapsed.has(parts.slice(0, i).join('/'))) return true;
  }
  return false;
}

/**
 * Déplie les ancêtres d'un dossier, pour que la ligne active reste visible quand on y entre
 * autrement que par l'arbre (double-clic sur une tuile dossier, création d'un sous-dossier).
 */
export function revealFolderInTree(filePath){
  foldersCollapsed.delete('');
  const parts = (filePath || '').split('/');
  for(let i = 1; i < parts.length; i++) foldersCollapsed.delete(parts.slice(0, i).join('/'));
}

/**
 * Replie ou déplie un dossier de l'arbre. `deep` (Alt+clic, comme dans Unity) applique le même
 * état à tout le sous-arbre : sans ça, déplier un dossier rouvrait ses enfants tels qu'on les
 * avait laissés, et replier une arborescence profonde demandait un clic par niveau.
 */
export function toggleFolderInTree(filePath, deep){
  const collapse = !foldersCollapsed.has(filePath);
  const targets = [filePath];
  if(deep){
    listFolders().forEach(function(c){
      if(filePath === '' || c.indexOf(filePath + '/') === 0) targets.push(c);
    });
  }
  targets.forEach(function(c){
    if(collapse) foldersCollapsed.add(c); else foldersCollapsed.delete(c);
  });
}

function arrowFolderHtml(filePath, hasChildren){
  if(!hasChildren) return '<span class="d-arrow"></span>';
  const collapsed = foldersCollapsed.has(filePath);
  return '<span class="d-arrow" title="' + (collapsed ? 'Déplier' : 'Replier')
    + ' (Alt+clic : tout le sous-arbre)">' + (collapsed ? '▸' : '▾') + '</span>';
}

export function updateTreeFolders(){
  const folders = listFolders();
  const parents = new Set();
  folders.forEach(function(c){ parents.add(c.split('/').slice(0, -1).join('/')); });
  // racine : button + (nouveau dossier à la racine)
  let html = '<div class="folder-line' + (folderCurrent === '' ? ' active' : '')
    + '" data-path="">' + arrowFolderHtml('', folders.length > 0)
    + '<span class="d-name">📦 Projet</span>'
    + '<span class="d-tools"><button class="d-plus" title="Nouveau dossier à la racine">＋</button></span></div>';
  folders.forEach(function(filePath){
    if(folderHiddenInTree(filePath)) return;
    const prof = filePath.split('/').length;
    const name = filePath.split('/').pop();
    html += '<div class="folder-line' + (folderCurrent === filePath ? ' active' : '')
      + '" data-path="' + escapeHtml(filePath) + '" style="padding-left:calc(var(--sp-3) + ' + (prof * 14) + 'px)">'
      + arrowFolderHtml(filePath, parents.has(filePath))
      + '<span class="d-name">📁 ' + escapeHtml(name) + '</span>'
      + '<span class="d-tools">'
      + '<button class="d-plus" title="Nouveau sous-folder">＋</button>'
      + '<button class="d-ren" title="Renommer">✎</button>'
      + '<button class="d-del" title="Supprimer (le contenu remonte)">🗑</button>'
      + '</span></div>';
  });
  foldersTree.innerHTML = html;
}

export function updateProject(){
  updateTreeFolders();
  const names = {texture:'texture', model:'modèle', prefab:'prefab', script:'script',
                material:'matériau', audio:'audio', data:'données',
                documentUI:'document UI', sheetStyle:'feuille de style',
                animator:'animator', animation:'animation', graphShader:'graphe de shader',
                sprite:'sprite', postProfile:'profil de post-traitement',
                preset:"preset d'import", sfx:'bruitage', musicLoop:'boucle musicale',
                tilePalette:'palette de tuiles'};
  let html = '';

  // sous-dossiers directs du dossier current
  listFolders().forEach(function(filePath){
    const parent = filePath.split('/').slice(0, -1).join('/');
    if(parent !== folderCurrent) return;
    const name = filePath.split('/').pop();
    html += '<div class="tile folder" data-path="' + escapeHtml(filePath)
      + '" title="Double-clic : ouvrir · déposez un asset dessus pour le ranger">'
      + '<div class="vignette">📁</div>'
      + '<button class="ren" title="Renommer">✎</button>'
      + '<button class="del" title="Supprimer (le contenu remonte)">×</button>'
      + '<span class="name">' + escapeHtml(name) + '</span></div>';
  });

  // assets du dossier current
  assets.forEach(function(a){
    if((a.folder || '') !== folderCurrent) return;
    // Un clip de modèle se montre DÉPLIÉ sous son modèle, comme dans Unity — pas à plat.
    if(a.embedded) return;
    const nameSafe = escapeHtml(a.name);
    // Le genre est testé AVANT `engineAudio` : ce rafraîchissement tourne pour chaque asset, et
    // aussi dans des contextes (tests, pages sans audio) où le module audio n'est pas chargé.
    const inPlayback = ((a.kind === 'audio' || a.kind === 'sfx' || a.kind === 'musicLoop')
      && engineAudio.preview && engineAudio.preview.assetId === a.id);
    const vignette = (a.kind === 'script')
      ? '<div class="vignette script" title="Double-clic : éditer · glisser sur un objet : attacher">📜</div>'
      : (a.kind === 'data')
      ? '<div class="vignette script" title="Table de contenu — double-clic : éditer · lue par api.data(name)">🗂</div>'
      : (a.kind === 'audio')
      ? '<div class="vignette script" title="Double-clic : écouter / arrêter · glisser sur un objet : attacher">'
        + (inPlayback ? '⏹' : '🔊') + '</div>'
      : (a.kind === 'sfx')
      ? '<div class="vignette script" title="Bruitage calculé — double-clic : régler dans le Rack sonore · glisser sur un objet : attacher">'
        + (inPlayback ? '⏹' : '🎛') + '</div>'
      : (a.kind === 'musicLoop')
      ? '<div class="vignette script" title="Boucle musicale — double-clic : composer dans le Rack sonore (BX-16) · glisser sur un objet : musique de fond">'
        + (inPlayback ? '⏹' : '🎹') + '</div>'
      : (a.kind === 'documentUI')
      ? '<div class="vignette script" title="Glisser sur un objet : affecter comme Document UI">📄</div>'
      : (a.kind === 'sheetStyle')
      ? '<div class="vignette script" title="Glisser sur un objet : affecter comme feuille de style">🎨</div>'
      : (a.kind === 'animator')
      ? '<div class="vignette script" title="Machine à états d’animation — glisser sur un personnage pour la lui affecter">🔀</div>'
      : (a.kind === 'animation')
      ? '<div class="vignette script" title="Animation — clic : réglages dans l’inspecteur · glisser sur un état du graphe Animator pour la lui affecter">🎞</div>'
      : (a.kind === 'graphShader')
      ? '<div class="vignette script" title="Double-clic : éditer le graphe · glisser sur un matériau (🎨) : lui assigner ce shader">🧩</div>'
      : (a.kind === 'tilePalette')
      ? '<div class="vignette script" title="Palette de tuiles — double-clic : ouvrir la fenêtre Palette · glisser sur une Tilemap pour la lui affecter">▦</div>'
      : (a.kind === 'sprite')
      ? '<div class="vignette script" title="Sprite 2D — clic : réglages dans l’inspecteur · glisser dans la vue 2D pour le poser">🖼</div>'
      : (a.kind === 'preset')
      ? '<div class="vignette script" title="Preset d’import — un jeu de réglages nommé. Il s’applique depuis l’en-tête de l’inspecteur d’un asset du même genre.">🔖</div>'
      : '<div class="vignette"' + (a.kind === 'material' ? ' title="Double-clic : éditer · glisser sur un objet : affecter"' : '')
        // Sans aperçu, PAS de style : `url('undefined')` partait en requête réseau, et le
        // 404 qui suit (GET .../undefined) polluait la console à chaque rendu du panneau.
        + (a.preview ? ' style="background-image:url(\''+a.preview+'\')"' : '') + '></div>';
    const inPaint = (typeof modePaint !== 'undefined' && modePaint.asset === a);
    const helpClick = IMPORT_DEFAULT[a.kind]
      ? ' — clic : paramètres d\'import dans l\'inspector'
      : ' — clic : détails dans l\'inspector';
    // Un modèle se DÉPLIE, comme un FBX dans la fenêtre Project d'Unity : maillages, matériaux
    // du fichier, clips, squelette. On ne les règle pas — on les regarde (voir
    // sectionSubAssetHtml, js/import-settings.js) — d'où la flèche plutôt qu'un dossier.
    const parts = subAssetsOfModel(a);
    html += '<div class="tile' + (inPaint ? ' paint' : '')
      + ((assetSelected === a && !a._sub) ? ' selection' : '')
      + '" draggable="true" data-aid="'+a.id
      + '" data-kind="'+a.kind+'" title="'+nameSafe+escapeHtml(helpClick)+'">'
      + vignette
      // Un genre sans libellé affiche son nom de type, jamais « undefined » (la palette de tuiles
      // l'a fait jusqu'à la v0.197.0 : son entrée manquait à la table).
      + '<span class="kind">'+escapeHtml(names[a.kind] || a.kind || '?')+'</span>'
      + '<button class="del" title="Supprimer l’asset (et son fichier, en mode dossier)" aria-label="Supprimer">×</button>'
      + (parts.length
        ? '<button class="expand" title="' + (a._expanded ? 'Replier' : 'Voir ce que ce fichier '
            + 'contient : ' + parts.length + ' élément(s)') + '">'
          + (a._expanded ? '▾' : '▸') + '</button>' : '')
      + (a.kind === 'prefab'
        ? '<button class="paint' + (inPaint ? ' active' : '')
          + '" title="Peindre ce prefab au clic dans la vue (Échap pour quitter)">🖌</button>' : '')
      + (a.kind === 'graphShader'
        ? '<button class="edit-shader" data-edit-shader="' + a.id + '" title="Ouvrir l\'éditeur de graphe (fenêtre séparée)">✎ Éditer</button>' : '')
      + '<span class="name">'+nameSafe+'</span></div>';
    if(a._expanded){
      const LABELS_SUB = {mesh:'maillage', material:'matériau', animation:'clip',
                          skeleton:'squelette', avatar:'avatar'};
      parts.forEach(function(part){
        const namePart = escapeHtml(part.name);
        const on = (assetSelected === a && a._sub && a._sub.kind === part.kind
                    && a._sub.index === part.index);
        // Un clip se GLISSE, comme dans Unity : sur un état de l'Animator, il lui est affecté.
        html += '<div class="tile submesh' + (on ? ' selection' : '')
          + (part.clipId ? '" draggable="true" data-clip="' + part.clipId : '')
          + '" data-aid="' + a.id + '" data-sub="' + part.kind + ':' + part.index
          + '" title="' + namePart + ' — clic : le voir en lecture seule (aucun réglage)">'
          + '<div class="vignette">' + part.icon + '</div>'
          + '<span class="kind">' + LABELS_SUB[part.kind] + '</span>'
          + '<span class="name">' + namePart + '</span></div>';
      });
    }
  });

  projectBody.innerHTML = html
    || '<div class="none">' + (folderCurrent
        ? 'Dossier vide — importez des assets ici ou déposez-en depuis un autre dossier.'
        : 'Importez des modèles 3D et des textures, ou déposez des fichiers ici. '
          + 'Glissez ensuite un modèle ou un prefab dans la vue pour l\'instancier, '
          + 'une texture sur un objet pour l\'habiller.') + '</div>';
}

// navigation, création, renommage et suppression depuis l'arbre
foldersTree.addEventListener('click', function(e){
  const l = e.target.closest ? e.target.closest('.folder-line') : null;
  if(!l) return;
  const filePath = l.dataset.path;
  // La flèche replie sans naviguer : replier un dossier ne doit pas changer celui qu'on regarde.
  if(e.target.classList.contains('d-arrow')){
    if(e.target.textContent){ toggleFolderInTree(filePath, e.altKey); updateTreeFolders(); }
    return;
  }
  if(e.target.classList.contains('d-plus')){ createFolderIn(filePath); return; }
  if(e.target.classList.contains('d-ren')){ if(filePath) renameFolder(filePath); return; }
  if(e.target.classList.contains('d-del')){ if(filePath) deleteFolder(filePath); return; }
  folderCurrent = filePath;
  updateProject();
});
foldersTree.addEventListener('dragover', function(e){
  const l = e.target.closest ? e.target.closest('.folder-line') : null;
  if(!l || !assetInDrag) return;
  e.preventDefault();
  foldersTree.querySelectorAll('.hover').forEach(function(x){ x.classList.remove('hover'); });
  l.classList.add('hover');
});
foldersTree.addEventListener('dragleave', function(e){
  if(e.target === foldersTree)
    foldersTree.querySelectorAll('.hover').forEach(function(x){ x.classList.remove('hover'); });
});
foldersTree.addEventListener('drop', function(e){
  e.preventDefault();
  foldersTree.querySelectorAll('.hover').forEach(function(x){ x.classList.remove('hover'); });
  const l = e.target.closest ? e.target.closest('.folder-line') : null;
  if(l && assetInDrag) moveAssetTo(assetInDrag, l.dataset.path);
});
document.getElementById('btn-new-folder').addEventListener('click', createFolder);

export function assetFrom(el){
  const tile = el && el.closest ? el.closest('.tile') : null;
  if(!tile) return null;
  return assets.find(a => a.id === tile.dataset.aid) || null;
}

export let assetInDrag = null;   // consulté par la hiérarchie (dépôt de scripts sur un nœud)

projectBody.addEventListener('dragstart', function(e){
  // Le clip d'un modèle se glisse pour LUI-MÊME, pas pour le modèle qui le porte.
  const tileClip = e.target.closest ? e.target.closest('.tile[data-clip]') : null;
  const a = tileClip ? (assets.find(function(x){ return x.id === tileClip.dataset.clip; }) || null)
                     : assetFrom(e.target);
  if(!a){ e.preventDefault(); return; }
  assetInDrag = a;
  e.dataTransfer.setData('text/asset', a.id);
  e.dataTransfer.effectAllowed = 'copy';
});
projectBody.addEventListener('dragend', function(){ assetInDrag = null; });

// double-clic sur une tile : ouvrir un dossier, éditer un script/matériau, renommer un prefab
// LE DOUBLE-CLIC SUR UN ASSET SE DÉTECTE DANS LE CLIC SIMPLE, pas sur l'événement dblclick.
// Le premier clic sélectionne l'asset, et selectAsset → updateProject réécrit tout le panneau :
// la tuile sous la souris est remplacée entre les deux clics, et le navigateur ne déclenche
// alors plus de dblclick. Aucun asset ne s'ouvrait plus au double-clic — ni script ni table —
// sans un mot en console (2026-10-02). Deux clics sur le MÊME asset en moins de DOUBLE_CLICK_MS
// l'ouvrent ; le dblclick natif ne sert plus qu'aux dossiers, que le clic ne reconstruit pas.
const DOUBLE_CLICK_MS = 400;
let lastAssetClick = {id: null, t: 0};
export function isDoubleClickOn(a, now){
  const t = now === undefined ? Date.now() : now;
  const yes = !!a && lastAssetClick.id === a.id && (t - lastAssetClick.t) < DOUBLE_CLICK_MS;
  lastAssetClick = yes ? {id: null, t: 0} : {id: a ? a.id : null, t: t};
  return yes;
}

projectBody.addEventListener('dblclick', function(e){
  const tileFolder = e.target.closest ? e.target.closest('.tile.folder') : null;
  if(tileFolder){
    folderCurrent = tileFolder.dataset.path;
    revealFolderInTree(folderCurrent);
    updateProject();
  }
});

// Ce que fait un double-clic sur un asset : l'ouvrir dans son éditeur.
export function openAssetOnDouble(a){
  if(!a) return;
  if(a.kind === 'script') openEditorScriptAsset(a);
  else if(a.kind === 'data') openEditorData(a);
  else if(a.kind === 'material') selectAsset(a);   // édité dans l'inspecteur
  else if(a.kind === 'graphShader') openEditorGraphShader(a);
  else if(a.kind === 'documentUI') openEditorDocumentUIAsset(a);
  else if(a.kind === 'sheetStyle') openEditorSheetStyleAsset(a);
  else if(a.kind === 'postProfile') openEditorPostProfile(a);
  // Double-clic sur une machine : la window Animator s ouvre dessus, comme dans Unity. Elle
  // edite l ASSET, elle n a pas besoin qu un objet de la scene soit selectionne.
  else if(a.kind === 'animator'){
    selectAsset(a);
    openAnimatorOnAsset(a);
  }
  else if(a.kind === 'animation') selectAsset(a);  // reglages dans l inspecteur
  else if(a.kind === 'tilePalette'){
    selectAsset(a);
    openWindowPalette(a);
  }
  else if(a.kind === 'audio') togglePreviewAudio(a);
  // Un bruitage s'ouvre dans son éditeur, comme une palette ou une machine d'états : c'est là qu'on
  // l'écoute ET qu'on le règle. Le rack le joue à chaque réglage.
  else if(a.kind === 'sfx' || a.kind === 'musicLoop'){
    selectAsset(a);
    if(typeof openSoundRack === 'function') openSoundRack(a);
  }
  else if(a.kind === 'prefab'){
    const name = prompt('Nom du prefab :', a.name);
    if(name && name.trim()) mutateAsset(function(){ a.name = name.trim(); });
  }
}
// #btn-new-materiau est lie dans materiaux.js : createAssetMaterial y est
// declaree, et ce fichier est charge apres celui-ci.

// ---------- Assets de données (tables de contenu) ----------
// Statistiques d'ennemis, objets, dialogues, vagues : ce qui fait la différence
// entre un niveau et un jeu. Séparé des scripts pour trois raisons — c'est
// éditable par quelqu'un qui ne programme pas, ça se relit dans un diff, et le
// copilot peut en générer sans écrire de code.
export function createAssetData(name, text){
  const n = assets.filter(function(x){ return x.kind === 'data'; }).length + 1;
  const a = {id:'a'+(++assetId), kind:'data', name:name || ('Données ' + n),
    folder:folderCurrent,
    text: text !== undefined ? text
      : '[\n  {"name": "Exemple", "valeur": 1}\n]\n'};
  assets.push(a);
  updateProject();
  return a;
}

/**
 * Un PRESET D'IMPORT : un jeu de réglages nommé, rangé dans un dossier du projet.
 *
 * C'est un ASSET et pas une entrée des réglages de projet : il doit se ranger, se renommer, se
 * déplacer et se versionner comme le reste — un preset qui vivrait dans `project.settings`
 * n'apparaîtrait nulle part et n'aurait pas de fichier à mettre dans git.
 *
 * `kindCible` est le genre d'asset auquel le preset s'applique ('model', 'texture', 'audio').
 */
export function createAssetPreset(kindCible, name, params, folder){
  const n = assets.filter(function(x){ return x.kind === 'preset'; }).length + 1;
  const a = {id:'a'+(++assetId), kind:'preset', name:name || ('Preset ' + n),
    folder: folder === undefined ? folderCurrent : folder,
    preset: {kind: kindCible, params: JSON.parse(JSON.stringify(params || {}))}};
  assets.push(a);
  // Le FICHIER est écrit par l'enregistrement du projet (`diskAssetManifest`,
  // serialization.js), comme pour tous les genres texte : `writeAssetInFolder` ne sait écrire
  // que les assets qui portent un vrai `File` (texture, son, modèle).
  updateProject();
  return a;
}

/**
 * Une palette de tuiles neuve.
 *
 * C'est un ASSET et pas un sac dans un nœud : deux décors partagent la même palette, et changer
 * une planche se fait une fois pour tout le niveau au lieu de reprendre chaque map.
 */
export function createAssetTilePalette(name, cellSize, folder){
  const n = assets.filter(function(x){ return x.kind === 'tilePalette'; }).length + 1;
  const a = {id:'a'+(++assetId), kind:'tilePalette', name:name || ('Palette ' + n),
    folder:(folder !== undefined ? folder : folderCurrent), palette: emptyPalette(cellSize || 0.5)};
  assets.push(a);
  updateProject();
  return a;
}

// TABLE DE CONTENU : une fenêtre dédiée, en TABLEAU (js/table-editor.js), et la même table en
// JSON dans l'éditeur de code (« Voir le code »). Avant, c'était une modale avec une <textarea>
// nue. Seul un JSON valide est appliqué — une table cassée ne se manifesterait qu'en pleine
// partie — et chaque fenêtre rafraîchit l'autre quand elle montre la même table.
function dataPayload(a, extra){
  return Object.assign({id: a.id, name: a.name, text: a.text || '',
    listFiles: assets.filter(function(x){ return x.kind === 'data'; }).map(function(x){ return {id: x.id, name: x.name}; })}, extra || {});
}
function dataCodePayload(a){
  return {id: a.id, name: a.name, code: a.text || '', langage: 'json', title: 'Table (JSON)', listFiles: []};
}
// Applique un texte (déjà validé) et un nom : un pas d'annulation par ouverture, comme un script.
function applyData(a, state, text, name){
  const n = (name || '').trim() || a.name;
  if(text === a.text && n === a.name) return false;
  if(!state.history){ pushHistory(); state.history = true; }
  mutateAsset(function(){ a.text = text; a.name = n; });
  return true;
}

export function openEditorData(a){
  const state = {history: false};
  openEditorExternal('table', dataPayload(a), function(data){
    if(data.action === 'code'){ openEditorDataCode(a); return; }
    if(data.text === undefined) return;
    try{ JSON.parse(data.text); } catch(e){ return; }   // la fenêtre ne renvoie que du valide
    if(applyData(a, state, data.text, data.name)) refreshExternal('code', dataCodePayload(a));
  }, function(id){
    const n = assets.find(function(x){ return x.id === id && x.kind === 'data'; });
    if(n) openEditorData(n);
  });
}

export function openEditorDataCode(a){
  const state = {history: false};
  openEditorExternal('code', dataCodePayload(a), function(data){
    try{ JSON.parse(data.code); } catch(e){ return; }
    if(applyData(a, state, data.code, data.name)) refreshExternal('table', dataPayload(a));
  });
}

// Menu Fenêtres → Table : la dernière table ouverte cette session, sinon la première du projet.
export function openLastWindowTable(){
  const lastId = lastAssetEditedBy('table');
  const tables = assets.filter(function(x){ return x.kind === 'data'; });
  const a = (lastId && tables.find(function(x){ return x.id === lastId; })) || tables[0] || null;
  if(a){ openEditorData(a); return; }
  openEditorExternal('table', {id: null, name: '', text: '[]', listFiles: []});
}

// ---------- Assets script (réutilisables, à glisser sur les objets) ----------
// La CRÉATION seule, sans ouvrir de fenêtre : le copilote crée des scripts lui aussi, et il ne
// doit pas faire surgir un éditeur de code au milieu d'une suite de commandes.
export function newAssetScript(name, code){
  const n = assets.filter(function(x){ return x.kind === 'script'; }).length + 1;
  const a = {id:'a'+(++assetId), kind:'script', name:(name || 'Script ' + n), folder:folderCurrent,
    code:(code !== undefined && code !== null) ? code
      : '// Glissez ce script sur un objet pour l\'attacher.\n'
       + '// function start(api){ } — appelé au lancement\n'
       + 'function update(api){\n'
       + '  api.me.rotation.y += 1.5 * api.dt;\n'
       + '}\n'};
  assets.push(a);
  updateProject();
  return a;
}

export function createAssetScript(){
  const a = newAssetScript();
  openEditorScriptAsset(a);
  return a;
}

// RÉFÉRENCE un asset script depuis un objet de la scène — le code n'est PAS recopié.
// C'était l'inverse : `{code: asset.code}` faisait de l'asset un simple presse-papier, si bien
// que modifier le script ensuite ne changeait aucun objet déjà servi.
export function attachScriptAsset(asset, root){
  if(!root || !isSceneObject(root)){
    setStatus('Déposez le script sur un objet de la scène', 3000);
    return;
  }
  pushHistory();
  const component = root.addComponent('ScriptJS', {scriptId: asset.id, active: true});
  mergeVarsDeclared(root, component.code);
  if(root === selection) buildInspector();
  setStatus('Script « ' + asset.name + ' » attaché à ' + root.name, 2500);
}

// ---------- Assets documentUI / feuilleStyle (référencés par UIDocument, pas copiés) ----------
export function createAssetDocumentUI(nameBase){
  const n = assets.filter(function(x){ return x.kind === 'documentUI'; }).length + 1;
  const a = {id:'a'+(++assetId), kind:'documentUI', folder:folderCurrent,
    name:(nameBase || 'Document UI') + ' — document ' + n, html:''};
  assets.push(a);
  updateProject();
  return a;
}
export function createAssetAnimator(nameBase){
  const n = assets.filter(function(x){ return x.kind === 'animator'; }).length + 1;
  const a = {id:'a'+(++assetId), kind:'animator', folder:folderCurrent,
    name:(nameBase || 'Perso') + ' — machine ' + n,
    // Une machine NEUVE est deja valide et deja jouable : un etat, pas de transition. Partir
    // d un fichier empty obligerait a lire la doc avant de voir quoi que ce soit move.
    machine:{format:'animator', version:1, params:[],
             states:[{name:'Idle', clip:'', loop:true}], start:'Idle', transitions:[]}};
  assets.push(a);
  updateProject();
  return a;
}
// ---------- Assets d'animation (un clip d'un modèle, plus ses réglages) ----------
//
// L'asset RÉFÉRENCE le clip du modèle, il ne le recopie pas — voir l'en-tête de
// js/anim-asset.js pour le motif. Ici, rien que la fabrication et la recherche ; la
// résolution et la validation vivent dans ce fichier partagé avec le runtime.

/**
 * Un asset d'animation. Sans modèle, c'est un CLIP VIDE à remplir de clés — le « Create New
 * Clip » d'Unity. Avec un modèle, c'est une référence à l'un de ses clips.
 */
/**
 * Un sprite depuis une texture du projet.
 *
 * Le sprite RÉFÉRENCE la texture, il ne la copie pas : dix sprites découpés dans la même
 * planche partagent une seule image en mémoire et un seul fichier sur disque.
 *
 * La texture est réglée en « proche, sans mipmap » quand elle est petite, parce que c'est alors
 * du pixel-art et que le lissage le détruit. C'est une PROPOSITION posée sur les paramètres
 * d'import de la texture : elle reste modifiable là où on l'attend.
 */
export function createAssetSprite(texture, name, folder){
  const tex = texture || (assetSelected && assetSelected.kind === 'texture' ? assetSelected : null);
  if(!tex || tex.kind !== 'texture') return null;
  const dims = dimensionsTexture(tex);
  const L = dims.l, H = dims.h;
  const ppu = (typeof ppuByDefault === 'function') ? ppuByDefault(L, H) : 100;
  if(ppu === 16){
    const p = ensureParamsImport(tex);
    if(p){ p.filtrage = 'near'; p.mipmaps = false; }
  }
  const n = assets.filter(function(x){ return x.kind === 'sprite'; }).length + 1;
  const a = {id:'a'+(++assetId), kind:'sprite', folder:(folder !== undefined && folder !== null) ? folder : folderCurrent,
    name: name || tex.name || ('Sprite ' + n),
    format:'sprite', version:1,
    textureId: tex.id, ppu: ppu, pivot:{x:0.5, y:0.5},
    // Une région couvrant toute l'image : un sprite NEUF est déjà affichable. La découpe en
    // planche se fait ensuite, dans l'inspecteur.
    regions: (L > 0 && H > 0) ? [{name:'image', x:0, y:0, l:L, h:H}] : []};
  assets.push(a);
  updateProject();
  return a;
}

export function createAssetAnimation(modelId, clip, name){
  const model = modelId ? assets.find(function(x){ return x.id === modelId; }) : null;
  const clips = (model && model.template && model.template.animations) || [];
  const nameClip = clip || (clips[0] ? clips[0].name : '');
  const n = assets.filter(function(x){ return x.kind === 'animation'; }).length + 1;
  const a = {id:'a'+(++assetId), kind:'animation', folder:folderCurrent,
    name: name || nameClip || ('Animation ' + n),
    format:'animation', version:2, rev:0,
    source:{type: model ? 'model' : 'keys', asset: model ? model.id : null, clip: nameClip},
    speed:1, loop:true, start:0, end:null,
    // Une seconde de clip vide, à 60 images/s : les deux valeurs par défaut d'Unity. Un clip de
    // durée nulle ne montrerait aucune règle graduée dans la timeline.
    duration:1, imagesBySeconde:60, tracks:[]};
  assets.push(a);
  updateProject();
  return a;
}

/**
 * L'asset d'animation du couple (modèle, clip), créé au besoin.
 *
 * C'est le point d'entrée de la migration des vieilles machines (`clip: "marche"` →
 * `animation: "aNN"`). La recherche par couple est ce qui fait que deux états sur le même clip
 * partagent UN asset au lieu d'en semer un par état.
 */
export function findOrCreateAssetAnimation(modelId, clip){
  if(!modelId || !clip) return null;
  const deja = assets.find(function(x){
    return x.kind === 'animation' && x.source && x.source.asset === modelId && x.source.clip === clip;
  });
  if(deja) return deja.id;
  // Un clip d'un modèle est un sous-asset de ce modèle (onglet Animation) : on l'y AJOUTE,
  // plutôt que de créer un asset autonome qui doublerait la liste de son importeur.
  const model = assets.find(function(x){ return x.id === modelId && x.kind === 'model'; });
  if(model){
    const c = addClipToModel(model, clip);
    if(c) return c.id;
  }
  return createAssetAnimation(modelId, clip, clip).id;
}


// ---------- Les clips d'un modèle : sous-assets, comme dans Unity ----------
//
// La donnée vit dans `paramsImport.clips` du modèle (js/anim-asset.js, `CLIP_SETTINGS_DEFAULT`) ;
// l'asset `animation` qui expose chaque clip n'en est qu'une VUE, reconstruite ici. Il garde son
// identité d'un appel à l'autre — c'est son id que les états de l'Animator citent.

/** Un identifiant d'asset neuf, pour un clip. */
export function newClipId(){ return 'a' + (++assetId); }

/** Les prises (takes) du fichier, telles que le chargeur les a rendues. */
export function takesOfModel(a){
  return (a && (a.animationsBrutes || (a.template && a.template.animations))) || [];
}

/**
 * Pose `paramsImport.clips` s'il n'existe pas encore : un clip par prise, comme Unity avant
 * qu'on ait touché à la liste. Rend la liste.
 */
export function ensureClipsOfModel(a){
  if(!a || a.kind !== 'model') return [];
  if(!a.paramsImport) a.paramsImport = {};
  const p = a.paramsImport;
  if(!Array.isArray(p.clips) && typeof defaultClipsOfTakes === 'function'){
    p.clips = defaultClipsOfTakes(takesOfModel(a), newClipId);
  }
  return p.clips || [];
}

/** Ajoute un clip sur la prise `take` — le « + » de la liste des clips d'Unity. */
export function addClipToModel(a, take, name){
  const clips = ensureClipsOfModel(a);
  const src = takesOfModel(a).find(function(t){ return t.name === take; }) || takesOfModel(a)[0];
  if(!src) return null;
  const c = Object.assign({id: newClipId(), name: name || src.name, take: src.name},
    (typeof CLIP_SETTINGS_DEFAULT !== 'undefined') ? CLIP_SETTINGS_DEFAULT : {});
  clips.push(c);
  syncClipAssetsOfModel(a);
  return c;
}

/**
 * Reconstruit les assets `animation` qui exposent les clips APPLIQUÉS du modèle : crée ceux qui
 * manquent, met les autres à jour EN PLACE (même objet, même id), retire ceux dont le clip a
 * disparu de la liste.
 */
export function syncClipAssetsOfModel(a){
  if(!a || a.kind !== 'model' || typeof clipAssetOfModel !== 'function') return;
  const p = a.paramsImport || {};
  const clips = (p.importAnimation === false || !Array.isArray(p.clips)) ? [] : p.clips;
  const keep = new Set();
  clips.forEach(function(c){
    let x = c.id ? assets.find(function(y){ return y.id === c.id; }) : null;
    // Un id déjà pris par un AUTRE genre d'asset : le clip en reçoit un neuf plutôt que de
    // voler l'identité d'un matériau ou d'un script.
    if(!c.id || (x && (x.kind !== 'animation' || (x.embedded && x.embedded !== a.id)))){
      c.id = newClipId();
      x = null;
    }
    reserveAssetId(c.id);
    keep.add(c.id);
    const fresh = clipAssetOfModel(a.id, c, a.folder || '');
    if(x){
      Object.keys(x).forEach(function(k){
        if(k.charAt(0) !== '_' && !(k in fresh)) delete x[k];
      });
      Object.assign(x, fresh);
    }
    else assets.push(fresh);
  });
  for(let k = assets.length - 1; k >= 0; k--){
    const x = assets[k];
    if(x.kind === 'animation' && x.embedded === a.id && !keep.has(x.id)){
      if(anim.assetClip === x.id) closeClipAsset();
      if(assetSelected === x) selectAsset(a);
      assets.splice(k, 1);
    }
  }
}

/** Retire les sous-assets clips d'un modèle qui disparaît. */
export function removeClipAssetsOfModel(a){
  for(let k = assets.length - 1; k >= 0; k--){
    const x = assets[k];
    if(x.kind === 'animation' && x.embedded === a.id) assets.splice(k, 1);
  }
}

export function createAssetSheetStyle(nameBase){
  const n = assets.filter(function(x){ return x.kind === 'sheetStyle'; }).length + 1;
  const a = {id:'a'+(++assetId), kind:'sheetStyle', folder:folderCurrent,
    name:(nameBase || 'Feuille') + ' — style ' + n, css:''};
  assets.push(a);
  updateProject();
  return a;
}
// ---------- Le registre des assets créables ----------
//
// UN SEUL bouton « ＋ Créer », et une liste. Il y avait sept boutons « Nouveau … » alignés dans
// la barre du panneau Projet : la barre débordait, chaque genre neuf en rajoutait un, et la
// palette de tuiles — arrivée en dernier — n'en avait tout simplement pas, donc elle était
// INATTEIGNABLE à la main. Le registre supprime cette classe d'oubli : un genre déclaré ici
// apparaît dans le menu, sans toucher au HTML.
//
// `make()` rend l'asset créé, ou `null` s'il a refusé — en ayant dit pourquoi.
export const ASSET_CREATORS = [
  {kind: 'script', label: '📜 Script',
   make: function(){ return createAssetScript(); }},
  {kind: 'material', label: '🎨 Matériau',
   make: function(){ return createAssetMaterial(); }},
  {kind: 'postProfile', label: '🌈 Profil de post-traitement',
   make: function(){ return createAssetPostProfile(); }},
  {kind: 'graphShader', label: '🧩 Graphe de shader',
   make: function(){ return createAssetGraphShader(); }},
  {kind: 'documentUI', label: '📄 Document UI',
   make: function(){ const a = createAssetDocumentUI(); openEditorDocumentUIAsset(a); return a; }},
  {kind: 'sheetStyle', label: '🎨 Feuille de style',
   make: function(){ const a = createAssetSheetStyle(); openEditorSheetStyleAsset(a); return a; }},
  {kind: 'animator', label: '🔀 Animator (machine à états)',
   make: function(){
     // Le genre MANQUAIT à ce registre : une machine ne pouvait naître que depuis un composant
     // AnimatorController posé sur un objet. Il fallait donc un objet de scène pour créer un
     // ASSET — exactement l'inverse du sens d'Unity, où l'Animator Controller est un asset qu'on
     // crée dans le projet puis qu'on affecte.
     const a = createAssetAnimator();
     // La fenêtre s'ouvre TOUT DE SUITE, comme pour la palette de tuiles : une machine neuve
     // n'a qu'un état, et rien dans le panneau Projet ne dit qu'il faut la double-cliquer.
     openAnimatorOnAsset(a);
     return a;
   }},
  {kind: 'animation', label: '🎞 Animation',
   make: function(){
     // Un clip VIDE, comme « Create New Clip » d'Unity : on n'a pas besoin d'un modèle importé
     // pour animer quoi que ce soit. La bascule vers « clip d'un modèle » est dans l'inspecteur.
     const a = createAssetAnimation();
     setStatus('Clip vide créé — ouvrez-le dans la timeline pour y poser des clés', 5000);
     return a;
   }},
  {kind: 'sprite', label: '🖼 Sprite (depuis la texture sélectionnée)',
   make: function(){
     const a = createAssetSprite();
     if(!a){
       // Le message dit QUOI FAIRE. « Aucune texture sélectionnée » laisserait chercher où
       // sélectionner, et le panneau ne le montre pas de lui-même.
       setStatus('Sélectionnez d\'abord une texture dans le panneau Projet : un sprite découpe '
         + 'une texture, il n\'en crée pas.', 6000);
       return null;
     }
     setStatus('Sprite « ' + a.name + ' » créé — ' + a.ppu + ' pixels par unité', 4000);
     return a;
   }},
  {kind: 'tilePalette', label: '▦ Palette de tuiles',
   make: function(){
     const a = createAssetTilePalette();
     // La fenêtre s'ouvre TOUT DE SUITE : une palette sans tuile ne peint rien, et rien dans le
     // panneau Projet ne dit qu'il faut la double-cliquer pour lui en donner.
     openWindowPalette(a);
     return a;
   }},
  {kind: 'sfx', label: '🎛 Bruitage (synthé SX-1)',
   make: function(){
     // Un SAUT tiré au hasard plutôt qu'un bip neutre : un bruitage neuf doit déjà ressembler à
     // quelque chose, et le rack s'ouvre dessus pour le changer d'un clic de preset.
     const a = createAssetSfx(presetSfx('jump', Math.floor(Math.random() * 100000) + 1),
                              {name: (typeof uniqueAssetName === 'function') ? uniqueAssetName('Saut') : 'Saut'});
     if(typeof openSoundRack === 'function') openSoundRack(a);
     return a;
   }},
  {kind: 'musicLoop', label: '🎹 Boucle musicale (BX-16)',
   make: function(){
     // Une boucle qui SONNE déjà : une grille vide ne donne aucune idée de ce que l'outil sait faire.
     const a = createAssetLoop(presetLoop('pop'), {name: (typeof uniqueAssetName === 'function') ? uniqueAssetName('Boucle') : 'Boucle'});
     if(typeof openSoundRack === 'function') openSoundRack(a);
     return a;
   }},
  {kind: 'data', label: '🗂 Table de contenu',
   make: function(){ const a = createAssetData(); openEditorData(a); return a; }}
];

/** Ajoute un genre créable (plugins). Le menu le prend sans que le HTML change. */
export function addAssetCreator(def){
  if(def && def.kind && typeof def.make === 'function') ASSET_CREATORS.push(def);
}

document.getElementById('btn-new-asset').addEventListener('click', function(e){
  const r = e.currentTarget.getBoundingClientRect();
  // Le rectangle du bouton est passé en ancre : le panneau Projet est EN BAS de l'écran, donc
  // ce menu-là remonte presque toujours, et sans ancre il recouvrirait le bouton.
  openMenuContext(r.left, r.bottom + 4, ASSET_CREATORS.map(function(c){
    return {label: c.label, action: function(){
      const a = c.make();
      if(a) selectAsset(a);
    }};
  }), r);
});

export function openEditorDocumentUIAsset(a){
  openModal('Document UI du projet',
    '<div class="field" style="margin-bottom:8px"><label>Nom</label>'
    + '<input type="text" id="uidoc-asset-name" spellcheck="false"></div>'
    + '<div style="font-size:11.5px;color:var(--txt-dim);margin-bottom:8px;line-height:1.5">'
    + 'Glissez la vignette 📄 sur un objet pour l\'assigner comme Document UI de son composant '
    + 'UIDocument.</div>'
    + '<textarea id="uidoc-asset-html" spellcheck="false"></textarea>'
    + '<div style="display:flex;gap:8px;margin-top:10px;justify-content:flex-end">'
    + '<button class="btn-modal" id="uidoc-asset-cancel">Annuler</button>'
    + '<button class="btn-modal accent" id="uidoc-asset-ok">Appliquer</button></div>');
  document.getElementById('uidoc-asset-name').value = a.name;
  document.getElementById('uidoc-asset-html').value = a.html;
  document.getElementById('uidoc-asset-ok').addEventListener('click', function(){
    // Lus AVANT closeModal() : la modale vidée, getElementById ne rend plus rien.
    const nameUiDoc = document.getElementById('uidoc-asset-name').value.trim();
    const htmlUiDoc = document.getElementById('uidoc-asset-html').value;
    closeModal();
    mutateAsset(function(){
      a.name = nameUiDoc || a.name;
      a.html = htmlUiDoc;
      // LA CONFIANCE SUIT LA PATERNITÉ, comme pour un script (js/scripts.js) : ce HTML vient
      // d'être tapé ici. Sans cette ligne, la garde de js/script-trust.js interrogerait la
      // personne sur son propre travail dès la première modification — et une garde qui
      // demande l'autorisation d'exécuter ce qu'on vient d'écrire est une garde qu'on
      // désactive dans la semaine.
      if(typeof trustCode === 'function') trustCode(a.html);
    });
    setStatus('Document UI « ' + a.name + ' » enregistré', 2000);
  });
  document.getElementById('uidoc-asset-cancel').addEventListener('click', closeModal);
}

export function openEditorSheetStyleAsset(a){
  openModal('Feuille de style du projet',
    '<div class="field" style="margin-bottom:8px"><label>Nom</label>'
    + '<input type="text" id="sheet-asset-name" spellcheck="false"></div>'
    + '<div style="font-size:11.5px;color:var(--txt-dim);margin-bottom:8px;line-height:1.5">'
    + 'Glissez la vignette 🎨 sur un objet pour l\'ajouter au composant UIDocument. Peut être '
    + 'partagée par plusieurs Documents UI (thème commun).</div>'
    + '<textarea id="sheet-asset-css" spellcheck="false"></textarea>'
    + '<div style="display:flex;gap:8px;margin-top:10px;justify-content:flex-end">'
    + '<button class="btn-modal" id="sheet-asset-cancel">Annuler</button>'
    + '<button class="btn-modal accent" id="sheet-asset-ok">Appliquer</button></div>');
  document.getElementById('sheet-asset-name').value = a.name;
  document.getElementById('sheet-asset-css').value = a.css;
  document.getElementById('sheet-asset-ok').addEventListener('click', function(){
    // Lus AVANT closeModal() : la modale vidée, getElementById ne rend plus rien.
    const nameSheet = document.getElementById('sheet-asset-name').value.trim();
    const cssSheet = document.getElementById('sheet-asset-css').value;
    closeModal();
    mutateAsset(function(){
      a.name = nameSheet || a.name;
      a.css = cssSheet;
    });
    setStatus('Feuille de style « ' + a.name + ' » enregistrée', 2000);
  });
  document.getElementById('sheet-asset-cancel').addEventListener('click', closeModal);
}

// glisser une tile documentUI/feuilleStyle sur un objet : assigne/complète son UIDocument
// (ajoute le composant s'il est absent) — référence en direct, comme un matériau, pas une copie.
export function attachDocumentUIAsset(asset, root){
  if(!root || !isSceneObject(root)){
    setStatus('Déposez le document sur un objet de la scène', 3000);
    return;
  }
  pushHistory();
  let c = root.getComponent('UIDocument');
  if(!c) c = root.addComponent('UIDocument', {});
  c.data.documentUIId = asset.id;
  if(root === selection) buildInspector();
  setStatus('Document UI « ' + asset.name + ' » affecté à ' + root.name, 2500);
}
export function attachSheetStyleAsset(asset, root){
  if(!root || !isSceneObject(root)){
    setStatus('Déposez la feuille de style sur un objet de la scène', 3000);
    return;
  }
  pushHistory();
  let c = root.getComponent('UIDocument');
  if(!c) c = root.addComponent('UIDocument', {});
  if(c.data.sheetStyleIds.indexOf(asset.id) === -1) c.data.sheetStyleIds.push(asset.id);
  if(root === selection) buildInspector();
  setStatus('Feuille de style « ' + asset.name + ' » ajoutée à ' + root.name, 2500);
}

/**
 * Retire un asset DU PROJET EN MÉMOIRE, et rien d'autre : le fichier disque, lui, est l'affaire
 * de l'appelant (la croix du panneau l'efface ; la surveillance du dossier, elle, constate une
 * disparition déjà faite).
 *
 * Extrait de la croix du panneau Projet pour que les deux chemins ne divergent pas : chaque
 * nettoyage oublié ici est une fuite (URL d'aperçu), un mode d'édition resté actif sur un asset
 * absent, ou un clip qui continue de s'écrire dans un asset que le projet ne porte plus.
 * Rend les objets rendus muets par la disparition d'un script, pour que l'appelant le dise.
 */
export function removeAssetInMemory(a){
  if(!a) return [];
  // L'URL d'aperçu est révoquée ici et REFABRIQUÉE par `restoreAssets` si l'asset revient :
  // la garder vivante « au cas où » ferait fuir une image entière à chaque suppression, et une
  // seule annulation la reconstruit depuis le `File`, qui survit.
  if(a.kind === 'texture' && a.preview && a.preview.indexOf('blob:') === 0) URL.revokeObjectURL(a.preview);
  if(typeof modePaint !== 'undefined' && modePaint.asset === a) stopPaint();
  // les modèles qui l'affectaient à un emplacement reprennent le matériau du fichier
  if(a.kind === 'material') disposeMaterialOfModels(a);
  // Ses clips sont des sous-assets : ils partent avec lui, comme dans Unity.
  if(a.kind === 'model') removeClipAssetsOfModel(a);
  if(a.kind === 'animation'){
    forgetClipCompiled(a.id);
    // Supprimer le clip qu'on est en train d'éditer laisserait la timeline écrire dans un
    // asset qui n'est plus dans le projet : le travail disparaîtrait à l'enregistrement.
    if(anim.assetClip === a.id
       && typeof closeClipAsset === 'function') closeClipAsset();
  }
  // UN ASSET SCRIPT SUPPRIMÉ REND MUETS TOUS SES PORTEURS, et il faut le dire. Depuis que le
  // composant référence l'asset au lieu d'en copier le code, la disparition de l'asset arrête
  // du gameplay ailleurs dans la scène — un objet dont plus rien ne bouge, sans message, est
  // le pire bug possible à retrouver. Ctrl+Z reste la sortie (l'instantané couvre les assets).
  const holders = (a.kind === 'script')
    ? holdersOfScriptAsset(a.id) : [];
  // Une boucle supprimée pendant qu'elle tourne dans le rack s'arrête : elle jouerait sans fin un
  // son qui n'appartient plus au projet (revue du 2026-09-29, § 3.8).
  if(a.kind === 'musicLoop' && typeof stopSoundRackPlayback === 'function') stopSoundRackPlayback(a);
  if(assetSelected === a) selectAsset(null);
  const i = assets.indexOf(a);
  if(i !== -1) assets.splice(i, 1);
  updateProject();
  return holders;
}

/**
 * Retire un asset du projet : l'instantané d'historique, le retrait en mémoire, le fichier sur
 * le disque, et le mot dit à qui il manquera.
 *
 * Extraite de l'écouteur de la croix d'une tile, parce que ce n'est plus le seul geste qui
 * supprime un asset (la fenêtre des presets d'import en supprime aussi). Deux chemins de
 * suppression, c'est l'un des deux qui oublie le fichier disque.
 *
 * UN PAS D'HISTORIQUE AVANT DE RETIRER. La suppression d'un asset était le geste le plus
 * définitif de l'éditeur : une croix, aucune confirmation, et rien pour revenir — alors qu'un
 * objet supprimé, lui, se récupérait par Ctrl+Z depuis toujours. La liste des assets fait
 * partie de l'instantané (js/history.js), donc ce pas suffit.
 *
 * Ctrl+Z ne peut annuler que l'état EN MÉMOIRE : le fichier disque, lui, part pour de bon —
 * best-effort, et le nom de fichier se relève AVANT le retrait, qui le perdrait.
 */
export function removeAsset(a){
  if(!a) return [];
  const namesDisk = [];
  if(project.handleFolder){
    const d = diskAssetManifest().assets.find(function(x){ return x.id === a.id; });
    if(d) namesDisk.push.apply(namesDisk, d.files || (d.file ? [d.file] : []));
  }
  pushHistory();
  const holders = removeAssetInMemory(a);
  if(namesDisk.length){
    // CE QUI A ÉTÉ TENTÉ EST DIT, dans la Console de l'éditeur. Un utilisateur a signalé « les
    // assets supprimés reviennent » avec une console de navigateur parfaitement vide : toutes
    // les opérations disque d'ici sont best-effort, donc muettes. Avaler l'erreur pour ne pas
    // interrompre la suppression reste juste ; se taire ne l'est pas. Le chemin visé est
    // journalisé même en cas de succès — c'est ce qui permet de voir qu'on a visé à côté.
    const cheminVise = 'assets/' + (a.folder ? a.folder + '/' : '');
    logConsole('log', 'Suppression disque : ' + cheminVise + namesDisk.join(', '), null);
    removeFilesAssetOnDisk(project.handleFolder, a.folder || '', namesDisk)
      .catch(function(e){ setStatus('Asset supprimé du projet mais pas du disque : ' + e.message, 6000); });
  } else if(project.handleFolder){
    // AUCUN FICHIER À SUPPRIMER alors qu'on est en mode dossier : soit l'asset n'a pas de forme
    // fichier, soit le manifeste ne l'a pas retrouvé — et dans ce second cas son fichier reste
    // sur le disque, donc il reviendra. C'est précisément le trou qu'on ne voyait pas.
    logConsole('warn', 'Suppression de « ' + a.name + ' » : aucun fichier disque associé trouvé '
      + '— s\'il en a un, il restera sur le disque et reviendra au prochain rafraîchissement', null);
  }
  if(holders.length){
    setStatus('Script « ' + a.name + ' » supprimé — ' + holders.length + ' objet(s) ne '
      + 'l\'exécutent plus (Ctrl+Z pour revenir)', 6000);
    // L'inspecteur de l'objet sélectionné doit passer à « script manquant » tout de suite :
    // laisser le nom de l'asset supprimé à l'écran ferait croire que rien n'a changé.
    if(selection && holders.indexOf(selection) !== -1) buildInspector();
  }
  return holders;
}

projectBody.addEventListener('click', function(e){
  const tileFolder = e.target.closest ? e.target.closest('.tile.folder') : null;
  if(tileFolder){
    if(e.target.classList.contains('del')) deleteFolder(tileFolder.dataset.path);
    else if(e.target.classList.contains('ren')) renameFolder(tileFolder.dataset.path);
    return;
  }
  if(e.target.classList.contains('paint')){
    const ap = assetFrom(e.target);
    if(ap) togglePaint(ap);
    return;
  }
  if(e.target.dataset.editShader){
    const asShader = assets.find(function(a){ return a.id === e.target.dataset.editShader; });
    if(asShader) openEditorGraphShader(asShader);
    return;
  }
  if(e.target.classList.contains('del')){
    const a = assetFrom(e.target);
    if(!a) return;
    // UNE SUPPRESSION QUI EFFACE UN FICHIER SE CONFIRME, comme celle d'un dossier ou d'une scène.
    // La croix partait au premier clic, et « Retirer du projet » laissait croire que le fichier
    // restait sur le disque (revue du 2026-09-29, § 1.9). Ctrl+Z rend l'asset au projet, mais
    // un fichier binaire effacé (image, son, modèle) ne revient pas sur le disque avec lui.
    if(project.handleFolder && !confirm('Supprimer « ' + a.name + ' » ?\n\nSon fichier sera aussi '
        + 'effacé du dossier du projet. Ctrl+Z le remet dans le projet, mais pas forcément sur le disque.')){
      return;
    }
    const holders = removeAsset(a);
    if(!holders.length) setStatus('« ' + a.name + ' » supprimé — Ctrl+Z pour revenir', 4000);
    return;
  }
  if(e.target.classList.contains('expand')){
    const ae = assetFrom(e.target);
    if(ae){ ae._expanded = !ae._expanded; updateProject(); }
    return;
  }
  // clic simple : sélectionne l'asset — l'inspecteur montre ses paramètres d'import
  // (clic dans le vide du panneau = désélection)
  const a = assetFrom(e.target);
  // Une tile de sous-asset désigne le MÊME asset, vu autrement : l'inspecteur montre le
  // maillage, le matériau, le clip ou le squelette en lecture seule, au lieu des paramètres.
  const tile = e.target.closest ? e.target.closest('.tile') : null;
  if(a && isDoubleClickOn(a)){ openAssetOnDouble(a); return; }
  if(!a) isDoubleClickOn(null);
  if(a){
    const sub = tile && tile.dataset.sub;
    if(sub){
      const part = sub.split(':');
      a._sub = {kind: part[0], index: parseInt(part[1], 10)};
    }
    else delete a._sub;
  }
  // `selectAsset` reconstruit TOUJOURS inspecteur et panneau, même sur l'asset déjà sélectionné
  // (passage du maillage au fichier compris). Un second appel ici refaisait tout une deuxième
  // fois à chaque clic — aperçu 3D, planche d'UV et panneau Projet.
  selectAsset(a);
  // Une machine à états suit la sélection, comme la fenêtre Animator d'Unity : un simple clic
  // suffit à la faire apparaître dans le graphe, sans double-clic ni objet de scène porteur
  // d'un AnimatorController.
  if(a && a.kind === 'animator') openAnimatorOnAsset(a);
});

// dépôt de fichiers (import) ou d'un asset sur une tile folder (rangement)
// dépôt d'un asset sur la TUILE D'UN AUTRE ASSET (pas un dossier) : pour l'instant, le seul
// cas géré est un grapheShader (logique) déposé sur un materiau (instance) — assigne son
// shader, comme glisser un Shader sur un materiau dans Unity. `tileAssetTarget` distingue
// cette tile-là de `.tile.folder`, gérée séparément juste en dessous.
export function tileAssetTarget(e){
  const tile = e.target && e.target.closest ? e.target.closest('.tile:not(.folder)') : null;
  if(!tile) return null;
  return assets.find(function(a){ return a.id === tile.dataset.aid; }) || null;
}
projectBody.addEventListener('dragover', function(e){
  const tileFolder = e.target.closest ? e.target.closest('.tile.folder') : null;
  if(assetInDrag && tileFolder){
    e.preventDefault();
    projectBody.querySelectorAll('.tile.folder.hover').forEach(function(x){ x.classList.remove('hover'); });
    tileFolder.classList.add('hover');
    return;
  }
  const target = assetInDrag && assetInDrag.kind === 'graphShader' ? tileAssetTarget(e) : null;
  if(target && target.kind === 'material'){
    e.preventDefault();
    projectBody.querySelectorAll('.tile.hover').forEach(function(x){ x.classList.remove('hover'); });
    e.target.closest('.tile').classList.add('hover');
    return;
  }
  if(e.dataTransfer && Array.from(e.dataTransfer.types).indexOf('Files') !== -1){
    e.preventDefault();
    projectBody.classList.add('hover');
  }
});
projectBody.addEventListener('dragleave', function(){
  projectBody.classList.remove('hover');
});
projectBody.addEventListener('drop', function(e){
  e.preventDefault();
  projectBody.classList.remove('hover');
  const tileFolder = e.target.closest ? e.target.closest('.tile.folder') : null;
  if(assetInDrag && tileFolder){
    moveAssetTo(assetInDrag, tileFolder.dataset.path);
    return;
  }
  if(assetInDrag && assetInDrag.kind === 'graphShader'){
    const target = tileAssetTarget(e);
    if(target && target.kind === 'material'){
      assignShaderOnMaterial(target, assetInDrag);
      return;
    }
  }
  if(e.dataTransfer && e.dataTransfer.files.length) importFiles(e.dataTransfer.files, {});
});


// ---------- Création d'assets ----------
/**
 * Refait les sprites posés sur cette texture, une fois son image décodée.
 *
 * Les coordonnées de texture d'un sprite se calculent à partir de la TAILLE de l'image, inconnue
 * tant que `TextureLoader` n'a pas rendu la main. Un sprite créé entre-temps garde donc des UV
 * pleine planche — il montre les seize cases à la place d'une — et rien ne les recalculait jamais.
 *
 * Mesuré : créer la texture puis le sprite dans la foulée, c'est-à-dire l'ordre normal quand le
 * copilot monte une scène, donnait un personnage fait de toute sa planche jusqu'à ce qu'un geste
 * sans rapport reconstruise la maille. Le défaut se cherchait dans la découpe, jamais dans le
 * moment du chargement.
 */
export function refreshSpritesOfTexture(tex){
  if(!tex) return 0;
  const planches = assets.filter(function(x){ return x.kind === 'sprite' && x.textureId === tex.id; });
  planches.forEach(refreshSpritesOfLAsset);
  return planches.length;
}

export function createAssetTexture(file, opts){
  const url = URL.createObjectURL(file);
  // opts.name : nom de l'asset relu d'un projet — il peut avoir été renommé depuis
  // l'import, il ne suit donc pas forcément le nom du fichier
  const a = {id:'a'+(++assetId), kind:'texture', name:(opts && opts.name) || file.name,
             // `opts.folder` : le dossier dès la création. Créer au dossier courant puis déplacer
             // (moveAssetTo) faisait la course avec l'écriture disque ci-dessous, asynchrone : le
             // fichier atterrissait QUAND MÊME au dossier courant, et la copie était redécouverte
             // comme un second asset au rechargement (projet Donjon, 2026-10-06).
             preview:url, file:file,
             folder:(opts && opts.folder !== undefined && opts.folder !== null) ? opts.folder : folderCurrent,
             paramsImport:(opts && opts.paramsImport) || null,
             imageSource:null, dimensionsSource:null,
             // Marque « produite par le moteur » (aujourd'hui : cuisson de lightmap). Elle
             // sert à une seule chose, mais essentielle : autoriser une nouvelle cuisson à
             // ÉCRASER cette texture. Sans elle il faudrait deviner, et une lightmap importée
             // depuis Blender serait détruite par la première cuisson.
             cuite:!!(opts && opts.cuite),
             // Marque « encodee en RGBM » : elle change le CHEMIN de decodage, pas seulement
             // l'apparence. Persistee avec l'asset (js/serialization.js).
             rgbm:!!(opts && opts.rgbm)};
  // L'image arrive de façon asynchrone : c'est seulement à ce moment que la réduction
  // « taille max » peut être calculée, et que la résolution est connue.
  a.texture = new THREE.TextureLoader().load(url, function(t){
    a.imageSource = t.image;
    a.dimensionsSource = [t.image.width, t.image.height];
    applyImportTexture(a);
    refreshInspectorAsset();
    refreshSpritesOfTexture(a);
  });
  configureTexture(a.texture, ensureParamsImport(a), {});
  assets.push(a);
  // `noRefresh` : la relecture d'un projet crée des centaines d'assets à la suite et rafraîchit le
  // panneau UNE fois à la fin. Un rafraîchissement par asset rendait l'ouverture quadratique
  // (revue du 2026-09-29, § 5.9).
  if(!(opts && opts.noRefresh)) updateProject();
  if(project.handleFolder){
    writeAssetInFolder(project.handleFolder, a)
      .catch(function(e){ setStatus('Asset créé en mémoire mais pas écrit sur le disque : ' + e.message, 5000); });
  }
  return a;
}

// Remplace le CONTENU d'un asset texture en gardant son identité. Tout l'intérêt est là :
// les matériaux qui pointent dessus (`lightmapAsset`) n'ont rien à changer, et une nouvelle
// cuisson ne laisse pas la précédente derrière elle — dix essais ne laissaient pas dix
// lightmaps mortes dans le projet.
// Textures dont le contenu vient d'être remplacé, en pending de libération.
//
// On ne peut PAS les libérer sur place. `textureMaterial()` donne aux matériaux des CLONES,
// et un clone three partage la `source` de l'original : libérer l'original invalide donc
// tous les clones encore branchés. Le renderer lit alors `isTexture` sur null et le rendu
// tombe. Mesuré, et confirmé par l'expérience inverse — en neutralisant `Texture.dispose`,
// l'enchaînement de deux cuissons repassait.
//
// L'appelant les libère quand il a fini de rebrancher les matériaux sur la nouvelle texture.
export const texturesReplacedADispose = [];

export function disposeTexturesReplaced(){
  while(texturesReplacedADispose.length){
    const t = texturesReplacedADispose.pop();
    if(t && t.dispose) t.dispose();
  }
}

export function replaceContentAssetTexture(a, file){
  // Révoquer l'ancienne URL, sinon chaque remplacement fait fuir une image entière : à
  // 1024×1024 en PNG, une dizaine de cuissons pèsent lourd et rien ne les libère.
  if(a.preview) URL.revokeObjectURL(a.preview);
  const url = URL.createObjectURL(file);
  a.preview = url;
  a.file = file;
  a.imageSource = null;
  a.dimensionsSource = null;
  const ancienne = a.texture;
  a.texture = new THREE.TextureLoader().load(url, function(t){
    a.imageSource = t.image;
    a.dimensionsSource = [t.image.width, t.image.height];
    applyImportTexture(a);
    refreshInspectorAsset();
    refreshSpritesOfTexture(a);
  });
  configureTexture(a.texture, ensureParamsImport(a), {});
  if(ancienne) texturesReplacedADispose.push(ancienne);
  // Le contenu change : un decodage RGBM en hidden rendrait l'ANCIENNE image, et la cuisson
  // passerait pour n'avoir rien fait.
  if(typeof forgetCacheRgbm === 'function') forgetCacheRgbm(a);
  updateProject();
  if(project.handleFolder){
    writeAssetInFolder(project.handleFolder, a)
      .catch(function(e){ setStatus('Texture remplacée en mémoire mais pas écrite sur le disque : ' + e.message, 5000); });
  }
  return a;
}

// `createAssetTexture` charge son image de façon ASYNCHRONE : au retour, `texture.image` est
// encore nulle. Rendre la scène avant que l'image n'arrive fait planter le renderer, qui lit
// `image.complete` sur null. Mesuré : deux cuissons enchaînées tombaient sur
// « Cannot read properties of null (reading 'complete') » dès la capture de la seconde.
// C'est aussi ce qui garantit que la lightmap est VISIBLE au retour de la cuisson, et pas
// seulement au prochain évènement qui reconstruit les matériaux.
export function awaitAssetTextureReady(a, essaisMax){
  return new Promise(function(resolve){
    let essais = 0;
    (function check(){
      if(a.imageSource || essais++ > (essaisMax || 300)) return resolve(!!a.imageSource);
      setTimeout(check, 10);
    })();
  });
}

export function createAssetModel(root, name, format, opts){
  root.name = name;
  root.userData.type = 'model';
  root.userData.format = format;
  applyNodeMixin(root);   // permet + Component (dont ScriptJS) sur les modèles importés
  root.addComponent('Model');   // ce que l'objet EST — voir component-model.js
  root.addComponent('Collider');
  root.addComponent('Physics');
  const a = {id:'a'+(++assetId), kind:'model', name:name, folder:folderCurrent, template:root,
             paquet:(opts && opts.paquet) || [],
             // transform et clips du fichier : l'import est ainsi rejouable à volonté
             raw:{scale:root.scale.clone(), position:root.position.clone()},
             animationsBrutes:root.animations || [],
             // mètres par unité du fichier : sert à ramener le modèle à sa taille réelle
             unitFile:(opts && opts.unite > 0) ? opts.unite : 1,
             paramsImport:(opts && opts.paramsImport) || null};
  root.userData.assetId = a.id;
  // matériaux du fichier, indexés dans l'ordre de parcours des maillages : base des
  // « emplacements » remplaçables par un matériau du projet (import-settings.js)
  // retenus AUSSI par maillage (captureMatFile) : les réglages de hiérarchie changent l'ordre
  // de parcours, et donc l'index sous lequel chaque emplacement est rangé.
  a.matBruts = captureMatFile(root);
  applyImportModel(a, false);   // normalise selon les paramètres et fait la vignette
  assets.push(a);
  if(!(opts && opts.noRefresh)) updateProject();   // voir createAssetTexture
  if(project.handleFolder){
    writeAssetInFolder(project.handleFolder, a)
      .catch(function(e){ setStatus('Asset créé en mémoire mais pas écrit sur le disque : ' + e.message, 5000); });
  }
  if(opts && opts.instantiate) instantiateAsset(a, opts.point || null);
  else if(!opts || !opts.silencieux) setStatus('« ' + name + ' » ajouté au projet — glissez-le dans la vue', 3500);
  return a;
}

export function createPrefabFromSelection(objectSource){
  const source = objectSource || selection;
  if(!source){ setStatus('Sélectionnez d\'abord un objet dans la scène', 2500); return; }
  const template = cloneCleanly(source);
  template.position.x = 0;
  template.position.z = 0;
  // LE PIVOT D'UN PREFAB reste celui de l'objet source. Un cas particulier existait ici : un
  // objet 2D voyait son `y` remis à zéro, parce qu'en 2D `y` est dans le plan au même titre
  // que `x`, et qu'un gabarit fabriqué depuis un objet posé à y = −7 faisait apparaître
  // chaque exemplaire sept unités trop bas. Il reposait sur la séparation des deux mondes,
  // qui n'existe plus : un objet à sprite est un objet comme un autre, et son gabarit garde
  // sa position — celle que son auteur voit.
  delete template.userData.prefabId;
  const name = source.name.replace(/\s*\d+$/, '') || 'Prefab';
  const a = {id:'a'+(++assetId), kind:'prefab', name:name, folder:folderCurrent, preview:previewObject3D(template), template:template};
  assets.push(a);
  // l'objet source devient la première instance liée
  source.userData.prefabId = a.id;
  if(source === selection) buildInspector();
  updateProject();
  setStatus('Prefab « ' + name + ' » créé — glissez-le dans la vue pour l\'instantiate', 3500);
  // L'ASSET EST RENDU. Il ne l'était pas, et tout appelant qui voulait enchaîner devait aller le
  // repêcher dans `assets`. Mesuré : un essai a conclu « échec de création » alors que le prefab
  // existait — la fonction avait travaillé et n'en disait rien.
  return a;
}

// glisser un objet de la Hiérarchie vers le panneau Projet crée un prefab
// (comme Unity : glisser un GameObject vers l'onglet Project), à la place de
// l'ancien button dédié
projectBody.addEventListener('dragover', function(e){
  const types = e.dataTransfer ? Array.from(e.dataTransfer.types) : [];
  if(types.indexOf('text/scene-object') !== -1){
    e.preventDefault();
    projectBody.classList.add('hover');
  }
});
projectBody.addEventListener('drop', function(e){
  const types = e.dataTransfer ? Array.from(e.dataTransfer.types) : [];
  if(types.indexOf('text/scene-object') === -1) return;
  e.preventDefault();
  projectBody.classList.remove('hover');
  const id = parseInt(e.dataTransfer.getData('text/scene-object'), 10);
  const obj = objects.find(function(o){ return o.id === id; });
  if(obj) createPrefabFromSelection(obj);
});

export function instantiateAsset(asset, point){
  pushHistory();
  const copie = cloneModel(asset.template);   // re-lie les squelettes des modèles rigués
  // Les nœuds du fichier deviennent des objets de scène, comme l'instance d'un Model Prefab
  // d'Unity (js/model-nodes.js) — AVANT la réactivation, qui les indexe.
  if(asset.kind === 'model') exposeModelInstance(copie, asset);
  reenableSubTree(copie);
  // Replié par défaut (la réactivation vient de lui refaire son sac d'édition).
  if(asset.kind === 'model' && copie.ed) copie.ed.plie = true;
  // Comme Unity : un modèle rigué ou animé arrive avec son Animator, SANS contrôleur — on lui
  // en glisse un ensuite. Vide, il ne joue rien et ne coûte rien (updateAnimators l'ignore).
  if(asset.kind === 'model' && typeof wantsAnimator === 'function'
     && wantsAnimator(copie, asset.paramsImport) && copie.getComponent
     && !copie.getComponent('AnimatorController')){
    copie.addComponent('AnimatorController', {assetId: null, target: ''});
  }
  if(asset.kind === 'prefab') copie.userData.prefabId = asset.id;   // instance LIÉE
  if(point){
    copie.position.x = point.x;
    copie.position.z = point.z;
  }
  scene.add(copie);
  select(copie);
  updateHierarchy();
  applyFilters();
  return copie;
}


// ---------- Application d'une texture sur un objet ----------
export function rootHandled(o){
  // PAR-DESSUS les nœuds d'un modèle : déposer une texture, un script ou un son sur un
  // personnage vise le personnage, pas l'os ou le maillage touché.
  while(o && (!isSceneObject(o) || o.userData.modelNode !== undefined)) o = o.parent;
  return o;
}

/** Le nœud de scène le plus proche, nœuds de modèle compris. */
export function nodeHandled(o){
  while(o && !isSceneObject(o)) o = o.parent;
  return o;
}

export function applyTexture(asset, meshKey){
  const root = rootHandled(meshKey);
  if(!root || (root.userData.type !== 'mesh' && root.userData.type !== 'model')){
    setStatus('Déposez la texture sur un cube, une sphère ou un modèle importé', 3000);
    return;
  }
  const target = (root.userData.type === 'mesh') ? root : meshKey;
  if(!target.isMesh){ setStatus('Aucun maillage sous le curseur', 2500); return; }

  // une texture de données n'a pas de map évidente sur un objet
  const key = MAP_BY_TYPE[ensureParamsImport(asset).type];
  if(!key){
    setStatus('« ' + asset.name + ' » est une texture de données : branchez-la dans un '
      + 'matériau (rugosité, métal, occlusion ou masque combiné)', 4500);
    return;
  }
  pushHistory();
  // les maillages glTF utilisent des UV avec flipY inversé
  applyTextureRaw(asset, target, root.userData.format !== 'gltf');
  if(root.userData.type === 'mesh') root.userData.texAsset = asset.id;
  setStatus('Texture « ' + asset.name + ' » appliquée sur ' + (target.name || root.name)
    + (key === 'normalMap' ? ' (map de normales)' : ''), 2500);
  applyFilters();
}

// Pose la texture sur la map correspondant à son type (albédo ou normales).
// Renvoie false pour une texture de données, qui n'a pas de cible directe.
export function applyTextureRaw(asset, mesh, flipY){
  const p = ensureParamsImport(asset);
  const key = MAP_BY_TYPE[p.type];
  if(!key) return false;
  const tex = asset.texture.clone();
  // marqué pour que les paramètres d'import de l'asset puissent être rejoués dessus
  tex.userData = {assetTexture:asset.id, flipYAuto:!!flipY};
  if(asset.texture.image) tex.image = asset.texture.image;
  configureTexture(tex, p, {flipYAuto:!!flipY});
  listMats(mesh).forEach(function(m){
    if(!(key in m)) return;
    m[key] = tex;
    // l'albédo remplace la couleur de base, pas la map de normales
    if(key === 'map' && m.color) m.color.set(0xffffff);
    m.needsUpdate = true;
  });
  return true;
}


// ---------- Import de fichiers ----------
export function importFiles(files, opts){
  opts = opts || {};
  const list = Array.from(files);
  const models = list.filter(f => /\.(glb|gltf|fbx)$/i.test(f.name));
  // Uniquement les formats que le navigateur sait DÉCODER lui-même : la texture passe par
  // une balise <img> (THREE.TextureLoader). Un format qu'il refuse (TIFF, TGA, EXR, HDR)
  // ne donnerait pas une erreur mais une texture noire — pire qu'un refus franc.
  const images = list.filter(f => /\.(png|jpe?g|webp|gif|bmp|avif|svg)$/i.test(f.name));
  const audios = list.filter(f => /\.(mp3|wav|ogg|m4a)$/i.test(f.name));

  // importeurs apportés par les plugins (formats maison : .lvl, .csv, .tmx…)
  if(Editor.importers.length){
    const restants = [];
    list.forEach(function(f){
      const imp = importForFile(f.name);
      if(!imp){ restants.push(f); return; }
      try{ imp.importer(f, opts); }
      catch(e){ logConsole('error', 'importeur « ' + imp.name + ' » : ' + e.message, null); }
    });
    if(restants.length !== list.length){
      const traites = list.length - restants.length;
      setStatus(traites + ' fichier(s) traité(s) par un plugin', 3000);
      if(!restants.length) return;
    }
  }

  // sons : assets audio (peuvent accompagner images et modèles)
  audios.forEach(function(f){ createAssetAudio(f); });
  if(audios.length && !models.length && !images.length){
    setStatus(audios.length + ' son(s) ajouté(s) au projet — glissez-les sur un objet', 3500);
    return;
  }

  // que des images : ce sont des assets texture
  if(!models.length){
    if(!images.length){
      if(!audios.length) setStatus('Aucun fichier 3D, image ou son reconnu', 3000);
      return;
    }
    let premier = null;
    images.forEach(function(f){ const a = createAssetTexture(f); if(!premier) premier = a; });
    if(opts.meshTarget && premier) applyTexture(premier, opts.meshTarget);
    else setStatus(images.length + ' texture(s) ajoutée(s) au projet', 3000);
    return;
  }

  // ressources annexes (.bin, textures du paquet) résolues par nom de fichier
  const blobs = {};
  list.forEach(function(f){ blobs[f.name] = URL.createObjectURL(f); });
  const manager = new THREE.LoadingManager();
  manager.setURLModifier(function(url){
    const nameF = decodeURIComponent(url.replace(/^.*[\\/]/, '').split('?')[0]);
    return blobs[nameF] || url;
  });
  // Le KTX2Loader est partagé (une seule instance pour tout l'éditeur) et ne porte donc
  // pas ce manager-ci : il faut lui donner accès aux blobs autrement.
  if(compressionBindable()) shareBlobs(blobs);

  models.forEach(function(principal){
    const nameBase = principal.name.replace(/\.[^.]+$/, '');
    setStatus('Chargement de ' + principal.name + ' …');

    function ok(root, format, unite){
      try {
        const paquet = [principal].concat(list.filter(function(f){
          return f !== principal && !/\.(glb|gltf|fbx)$/i.test(f.name);
        }));
        // UN DOSSIER PAR FICHIER IMPORTÉ QUAND IL Y A DE QUOI Y RANGER PLUSIEURS ASSETS,
        // comme Unity qui groupe un FBX et tout ce qu'il embarque (modèle, clips, matériaux)
        // sous une même entrée du panneau Projet. Ce moteur n'a pas de « sous-asset » virtuel :
        // le plus proche est un vrai sous-dossier. On ne le crée QUE si le fichier a
        // effectivement plusieurs pièces à y mettre (au moins un clip d'animation) — un simple
        // prop statique reste un unique asset au dossier current, sans dossier à un seul élément.
        const clipsBrutes = root.animations || [];
        const folderAvant = folderCurrent;
        const folderImport = clipsBrutes.length
          ? (folderAvant ? folderAvant + '/' : '') + nameBase.replace(/[\/\\]/g, '-')
          : folderAvant;
        if(clipsBrutes.length && folderImport !== folderAvant){
          if(!project.folders) project.folders = [];
          if(project.folders.indexOf(folderImport) === -1){
            project.folders.push(folderImport);
            if(project.handleFolder){
              createFolderEmptyOnDisk(project.handleFolder, 'assets/' + folderImport)
                .catch(function(e){ setStatus('Dossier créé en mémoire mais pas sur le disque : ' + e.message, 5000); });
            }
          }
          setFolderCurrent(folderImport);
        }
        let modele;
        try {
          modele = createAssetModel(root, nameBase, format,
            Object.assign({paquet:paquet, unite:unite}, opts));
          // EXTRACTION AUTOMATIQUE DES CLIPS EMBARQUÉS (FBX/glTF), comme Unity qui fait
          // apparaître chaque animation d'un fichier importé comme un sous-asset séparé. Sans
          // ça, un clip d'un FBX ne restait utilisable QUE depuis ce modèle précis (une donnée
          // « encrée en dur » dans son template) — il fallait créer l'asset Animation à la main,
          // clip par clip, via « + Créer ▸ 🎞 Nouvelle animation » pour pouvoir le réutiliser
          // (Animator, retargeting sur un autre rig, etc).
          // Depuis la v0.159, ce sont des SOUS-ASSETS du modèle (onglet Animation), plus des
          // assets autonomes : ils se règlent dans son importeur et le suivent partout.
          const clips = ensureClipsOfModel(modele);
          syncClipAssetsOfModel(modele);
          if(clips.length){
            updateProject();
            setStatus('« ' + nameBase + ' » ajouté avec ' + clips.length
              + ' clip(s) — réglables dans son onglet Animation', 4000);
          }
        } finally {
          if(folderImport !== folderAvant) setFolderCurrent(folderAvant);
        }
        // L'appelant qui attend CE modèle (import_model, blender_import_to_project) le reçoit ici.
        if(typeof opts.onModel === 'function') opts.onModel(modele);
      }
      catch(err){ ko(err); }
    }
    function ko(err){
      console.error(err);
      let msg = (err && err.message) ? err.message : String(err);
      // Les décodeurs sont branchés quand leur bundle est chargé. S'il ne l'est pas,
      // three lève un message qui décrit un symptôme et ne dit pas quoi faire : on le
      // remplace par celui qui nomme le fichier à charger.
      if(!compressionBindable()){
        // Le module absent est une cause à part entière, et la plus probable quand un
        // modèle compressé échoue. Sans ce repli on retombait sur le message raw de
        // three — exactement ce que ce bloc existe pour éviter.
        msg = 'js/asset-compression.js n\'est pas chargé : un modèle compressé (Draco, '
            + 'meshopt ou KTX2) ne peut pas être lu. Détail technique : ' + msg;
      } else {
        // `err.compressions` est posé par analyzeModel(), qui a lu les octets du
        // fichier : le message reste exact même si three change le sien.
        const missing = decodersMissing(err && err.compressions);
        if(missing.length) msg = messageDecodersMissing(missing);
      }
      setStatus('Échec de l\'import : ' + msg, 6000);
      if(typeof opts.onError === 'function') opts.onError(new Error(msg));
    }

    analyzeModel(principal, manager)
      .then(function(res){ ok(res.root, res.format, res.unite); }, ko);
  });
}

// ---------- Unité du fichier ----------
// L'éditeur travaille en MÈTRES. glTF impose déjà le mètre (spec), mais un FBX
// déclare son unité dans GlobalSettings.UnitScaleFactor (= centimètres par unité du
// fichier : 1 pour Maya/3ds Max, 100 pour un export en mètres). FBXLoader l'ignore
// complètement : un FBX Maya arriverait donc 100× trop grand. On lit le facteur
// nous-mêmes — la propriété est stockée en clair dans les deux formats FBX.

export function indexBytes(bytes, motif, start){
  const m = [];
  for(let i = 0; i < motif.length; i++) m.push(motif.charCodeAt(i));
  const end = bytes.length - m.length;
  for(let i = Math.max(0, start || 0); i <= end; i++){
    let ok = true;
    for(let j = 0; j < m.length; j++){
      if(bytes[i + j] !== m[j]){ ok = false; break; }
    }
    if(ok) return i;
  }
  return -1;
}

// FBX binaire : après le nom de propriété viennent les types ("double", "Number", "")
// puis la valeur. Chaque champ = 1 octet de type + charge utile.
export function valueAfterNameFbx(bytes, start){
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = start;
  for(let k = 0; k < 6 && p + 9 <= bytes.length; k++){
    const type = bytes[p];
    if(type === 0x53 || type === 0x52){            // S string / R raw : longueur sur 4 octets
      p += 5 + view.getUint32(p + 1, true);
      continue;
    }
    if(type === 0x44) return view.getFloat64(p + 1, true);   // D double
    if(type === 0x46) return view.getFloat32(p + 1, true);   // F float
    if(type === 0x49) return view.getInt32(p + 1, true);     // I int32
    return null;
  }
  return null;
}

// mètres par unité du fichier FBX (null si l'information est absente)
export function unitFbx(bytes){
  // fenêtre GlobalSettings → Definitions : le PropertyTemplate de FbxGlobalSettings,
  // dans Definitions, redéclare UnitScaleFactor avec sa valeur par défaut (1).
  const gs = indexBytes(bytes, 'GlobalSettings', 0);
  const defs = gs === -1 ? -1 : indexBytes(bytes, 'Definitions', gs);
  const i = indexBytes(bytes, 'UnitScaleFactor', gs === -1 ? 0 : gs);
  if(i === -1 || (defs !== -1 && i > defs)) return null;
  const apres = i + 'UnitScaleFactor'.length;
  let f = valueAfterNameFbx(bytes, apres);
  if(f === null){
    // FBX ASCII : P: "UnitScaleFactor", "double", "Number", "",100
    const txt = new TextDecoder('latin1').decode(bytes.subarray(apres, apres + 120));
    const m = txt.match(/^"?\s*,\s*"[^"]*"\s*,\s*"[^"]*"\s*,\s*"[^"]*"\s*,\s*(-?[\d.eE+]+)/);
    if(m) f = parseFloat(m[1]);
  }
  if(!(f > 0) || !isFinite(f)) return null;
  return f / 100;   // UnitScaleFactor = cm par unité → mètres par unité
}

// js/asset-compression.js est chargé par une balise <script> d'editor.html. Tant
// qu'elle n'y est pas, un import ORDINAIRE doit continuer de marcher : on le dit une
// fois dans la bar d'état plutôt que de laisser une ReferenceError tuer tout l'import.
export let wiringReports = false;
export function compressionBindable(){
  if(typeof bindDecoders === 'function') return true;
  if(!wiringReports){
    wiringReports = true;
    setStatus('js/asset-compression.js n\'est pas chargé : les glTF compressés '
      + '(Draco, meshopt, KTX2) seront refusés', 6000);
  }
  return false;
}

// Un GLTFLoader avec ses décodeurs de compression branchés (Draco, meshopt, KTX2).
// Passe par js/asset-compression.js, le MÊME fichier que le jeu publié utilise.
export function loaderGltf(manager){
  const l = new THREE.GLTFLoader(manager);
  if(compressionBindable()) bindDecoders(l, renderer);
  return l;
}

export function analyzeModel(principal, manager){
  return new Promise(function(res, rej){
    // Les octets disent quelles compressions le fichier exige, indépendamment de ce que
    // three racontera en échouant : c'est ce qui permet de nommer le décodeur missing.
    function echouer(err, content, name){
      const e = (err instanceof Error) ? err : new Error(String(err && err.message || err));
      if(content !== undefined){
        try { e.compressions = compressionsOfModel(name, content); } catch(x){ /* diagnostic seulement */ }
      }
      rej(e);
    }
    try{
      if(/\.fbx$/i.test(principal.name)){
        principal.arrayBuffer().then(function(buf){
          try {
            const unite = unitFbx(new Uint8Array(buf));
            res({root:new THREE.FBXLoader(manager).parse(buf, ''), format:'fbx',
                 // sans information : centimètres, le défaut Maya / 3ds Max
                 unite: (unite === null) ? 0.01 : unite});
          }
          catch(err){ rej(err); }
        }, rej);
      }
      else if(/\.glb$/i.test(principal.name)){
        principal.arrayBuffer().then(function(buf){
          // les clips vivent sur gltf.animations, pas sur gltf.scene : sans
          // cette ligne, toutes les animations d'un modèle Blender sont perdues
          loaderGltf(manager).parse(buf, '', function(g){
            g.scene.animations = g.animations || [];
            res({root:g.scene, format:'gltf', unite:1});   // spec glTF : mètres
          }, function(err){ echouer(err, buf, principal.name); });
        }, rej);
      }
      else {
        principal.text().then(function(txt){
          loaderGltf(manager).parse(txt, '', function(g){
            g.scene.animations = g.animations || [];
            res({root:g.scene, format:'gltf', unite:1});
          }, function(err){ echouer(err, txt, principal.name); });
        }, rej);
      }
    } catch(err){ rej(err); }
  });
}

export const inputImport = document.getElementById('file-import');
document.getElementById('btn-import').addEventListener('click', () => inputImport.click());
inputImport.addEventListener('change', function(){
  if(inputImport.files.length) importFiles(inputImport.files, {});
  inputImport.value = '';
});


// ---------- Dépôts sur le viewport (fichiers ou assets) ----------
export function pointGroundFrom(e){
  coordsMouse(e);
  raycaster.setFromCamera(mouse, camCurrent());
  const plan = new THREE.Plane(new THREE.Vector3(0,1,0), 0);
  const pt = new THREE.Vector3();
  return raycaster.ray.intersectPlane(plan, pt) ? pt : new THREE.Vector3();
}

export function meshSubCursor(e){
  coordsMouse(e);
  raycaster.setFromCamera(mouse, camCurrent());
  const hits = raycaster.intersectObjects(objects, true);
  return hits.length ? hits[0].object : null;
}

/**
 * Le dépôt d'un asset sur la vue 3D. Appelée par `startup.js`.
 *
 * Différée pour la même raison que `bindEditorInput` : `viewEl` est un `const` de
 * `js/scene.js`, et ce fichier est dans un cycle d'imports avec lui. Le câblage au premier
 * niveau ne tenait que par l'ordre des <script>, pas par le graphe de modules.
 */
export function bindAssetDropOnView(){
  viewEl.addEventListener('dragover', function(e){
    const types = e.dataTransfer ? Array.from(e.dataTransfer.types) : [];
    if(types.indexOf('Files') !== -1 || types.indexOf('text/asset') !== -1){
      e.preventDefault();
      viewEl.classList.add('repo');
    }
  });
  viewEl.addEventListener('dragleave', function(e){
    if(e.target === viewEl || !viewEl.contains(e.relatedTarget)) viewEl.classList.remove('repo');
  });
  viewEl.addEventListener('drop', function(e){
    e.preventDefault();
    viewEl.classList.remove('repo');

    if(e.dataTransfer && e.dataTransfer.files.length){
      const pt = pointGroundFrom(e);
      importFiles(e.dataTransfer.files, {
        instantiate:true,
        point:{x:pt.x, z:pt.z},
        meshTarget: meshSubCursor(e)
      });
      return;
    }
    const aid = e.dataTransfer ? e.dataTransfer.getData('text/asset') : '';
    if(!aid) return;
    const asset = assets.find(a => a.id === aid);
    if(!asset) return;

    if(asset.kind === 'sprite'){
      pushHistory();
      // Le point de dépôt vient du raycast du viewport 3D : il n'y a plus d'espace 2D à part, et
      // refuser le dépôt hors de l'onglet « 2D » (ce que faisait ce chemin) reviendrait, l'onglet
      // supprimé, à ne plus pouvoir poser un sprite du tout.
      const pt = pointGroundFrom(e);
      const n = createSceneNode({
        name: asset.name,
        position: { x: pt.x, y: pt.y, z: 0 },
        components: [{ type: 'SpriteRenderer', data: { spriteId: asset.id, region: '',
                                                       layer: 'Jeu', order: 0 } }]
      });
      setStatus('« ' + n.name + ' » posé dans la scène', 2500);
      return;
    }

    if(asset.kind === 'texture'){
      const mesh = meshSubCursor(e);
      if(mesh) applyTexture(asset, mesh);
      else setStatus('Déposez la texture directement sur un objet de la scène', 3000);
    } else if(asset.kind === 'script'){
      const mesh = meshSubCursor(e);
      attachScriptAsset(asset, mesh ? rootHandled(mesh) : null);
    } else if(asset.kind === 'material'){
      const mesh = meshSubCursor(e);
      // Comme Unity : lâché sur un personnage, le matériau va au maillage TOUCHÉ (son Renderer),
      // pas au modèle entier. Un objet ordinaire garde le comportement d'avant.
      const node = mesh ? nodeHandled(mesh) : null;
      const target = (node && node.isMesh && node.userData.modelNode !== undefined) ? node
        : (mesh ? rootHandled(mesh) : null);
      attachMaterialAsset(asset, target);
    } else if(isPlayableAudio(asset)){
      const mesh = meshSubCursor(e);
      attachAudioAsset(asset, mesh ? rootHandled(mesh) : null);
    } else {
      const pt = pointGroundFrom(e);
      instantiateAsset(asset, {x:pt.x, z:pt.z});
    }
  });
}


// EXPOSÉ EN GLOBALE, à dessein. Ces symboles sont appelés depuis des fichiers
// que les mêmes pages ne chargent pas toutes : un `import` y pointerait un
// fichier absent, et la page ne démarrerait pas. Ils gardent donc leur garde
// `typeof` côté appelant, et se déclarent ici.
globalThis.applyTextureRaw = applyTextureRaw;
// `assetId` et `folderCurrent` sont des `let` RÉASSIGNÉS : les recopier (`globalThis.x = x`)
// figeait leur valeur au chargement du module (0 et ''). post-profile.js et shader-graph.js,
// qui ne peuvent pas importer ce fichier, faisaient `++assetId` sur cette copie morte : le
// premier profil de post-traitement recevait `a1` — l'id du matériau « Défaut » — et le
// rechargement suivant échangeait les deux assets (voir docs/KNOWN_ISSUES.md). Des accesseurs
// gardent la globale branchée sur la vraie variable.
Object.defineProperty(globalThis, 'assetId', {configurable: true,
  get: function(){ return assetId; }, set: function(v){ reserveAssetId('a' + v); }});
Object.defineProperty(globalThis, 'folderCurrent', {configurable: true,
  get: function(){ return folderCurrent; }, set: function(v){ setFolderCurrent(v); }});
globalThis.nextAssetId = nextAssetId;
globalThis.assets = assets;
globalThis.indexBytes = indexBytes;
globalThis.loaderGltf = loaderGltf;
globalThis.unitFbx = unitFbx;
globalThis.updateProject = updateProject;
globalThis.valueAfterNameFbx = valueAfterNameFbx;