// ---------- Version de l'éditeur ----------
// Suit SemVer (voir ChangeLogs/VERSIONING.md à la racine du dépôt) ; incrémentée à chaque
// lot livré. Un seul endroit à modifier lors d'une nouvelle version.
// UN SEUL numero de version, celui de js/version.js. Celui-ci vivait ici depuis longtemps et
// affichait 0.74.1 dans la bar pendant que le moteur en etait a 0.78.0 : quatre versions
// d ecart, et personne ne pouvait dire quel code tournait devant lui.
import { openAnalysisScene } from './analysis.js';
import { warnOnceMissing } from './dev-guards.js';
import { createPrefabFromSelection, inputImport } from './assets.js';
import { recoverAutoSave } from './autosave.js';
import { exportBuildDesktop, exportBuildWeb, publishBuildToCloud } from './build.js';
import { openLastWindowDocumentUI } from './components/component-uidocument.js';
import { Registry } from './component-registry.js';
import { openCopilot } from './copilot.js';
import { openHelp } from './help.js';
import { setStatus } from './hierarchy.js';
import { histo, pushHistory, restore, undo } from './history.js';
import { clipBoard, copySelection, deleteSelection, duplicateSelection, pasteClipBoard } from './inspector.js';
import { modalLayers } from './layers.js';
import { lightmapBakeState, modalBakeLightmap } from './lightmap-bake.js';
import { TYPES_CREATABLE, createObject, escapeHtml, objects } from './objects.js';
import { modalAlignDistribute, modalDuplicateSeries, setAtGround } from './placement.js';
import { modalPlugins, openPluginCatalog } from './plugins.js';
import { PrefabLibrary } from './prefab-library.js';
import { bakeAllProbes } from './probes.js';
import { phys, toggleSimulation } from './physics.js';
import { profiler, toggleProfiler } from './profiler.js';
import { loadProjectFromFolder } from './project-folder.js';
import { addScene, createFolderProject, finalizeOpeningProjectFolder, idSessionEditor, newProject, project } from './project.js';
import { listProjectsRecents, openProjectRecent } from './recents.js';
import { filters, setModeGizmo, tc, viewEl } from './scene.js';
import { openLastWindowCode } from './scripts.js';
import { openLastWindowTable } from './assets.js';
import { allSelection, selection } from './selection.js';
import { isLoggedIn, storageMenuVisibility } from './cloud-session.js';
import { currentStorageMode, downloadLocal, saveProject, saveToFolder, uploadToCloud } from './project-storage.js';
import { exportDataGame, exportProjectGit, inputScene, newProject2d, newScene, registerInProjectOpen, registerScene } from './serialization.js';
import { refreshIndicatorSave } from './project-dirty.js';
import { openLastWindowShader } from './shader-graph-editor.js';
import { createSubScene } from './subscenes.js';
import { Dock } from './ui/dock.js';
import { VERSION_ENGINE } from './version.js';
import { frameSelection } from './view-tools.js';
import { requestResize, resize } from './viewport.js';
import { isReadOnly } from './readonly-ui.js';

export const VERSION_EDITOR = (typeof VERSION_ENGINE === 'string') ? VERSION_ENGINE : '?';
export const btnVersion = document.getElementById('btn-version');
if(btnVersion){
  btnVersion.textContent = 'v' + VERSION_EDITOR;
  btnVersion.addEventListener('click', function(){
    if(typeof modalAAbout === 'function') modalAAbout();
  });
}

// ---------- Le nom du projet, dans la barre du haut ----------
// Il n'était affiché NULLE PART : `project.name` existait, se sérialisait, se réglait — et
// l'éditeur ne le montrait pas une seule fois. Avec plusieurs projets ouverts dans plusieurs
// onglets, rien ne distinguait les fenêtres.
//
// Il est POUSSÉ et non lu à la demande, parce qu'il n'existe aucun rafraîchissement global
// dans l'éditeur. Les deux seuls endroits qui écrivent le nom l'appellent (project.js :
// l'accesseur `set name` et `applyProjectSettings`) — c'est vérifié par
// test/barre-haut.test.mjs, sans quoi un troisième point d'écriture apparaîtrait un jour et
// laisserait l'étiquette mentir en silence.
export function refreshProjectLabel(){
  const el = document.getElementById('project-label');
  if(!el) return;
  const name = (project && project.name) || '';
  el.textContent = name;
  el.title = name ? ('Le projet ouvert : ' + name) : 'Aucun projet nommé';
}
if (typeof globalThis !== 'undefined') globalThis.refreshProjectLabel = refreshProjectLabel;

// ---------- L'indicateur d'enregistrement, à côté du nom ----------
// Le clic fait la MÊME chose que Fichier → « Enregistrer dans le dossier », volontairement :
// deux chemins d'écriture pour un seul geste, c'est deux comportements à garder d'accord.
// L'état, lui, vit dans js/project-dirty.js — posé par l'historique, effacé par l'écriture.
const btnSaveState = document.getElementById('btn-save-state');
if(btnSaveState){
  // saveProject et non registerInProjectOpen : un projet encore nulle part propose une
  // destination (js/project-storage.js) au lieu de répondre par une erreur.
  btnSaveState.addEventListener('click', function(){ saveProject(); });
  refreshIndicatorSave();
}

// ---------- Fenêtre modale ----------
export const modal = document.getElementById('modal');
// LE FOCUS ENTRE DANS LA MODALE, Y RESTE, ET REVIENT D'OÙ IL VENAIT. Sans cela, au clavier, on
// continuait de tabuler derrière la modale ouverte (revue du 2026-09-29, § 4.6).
let _focusAvantModale = null;
function focusablesModale(){
  return Array.prototype.slice.call(modal.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
    .filter(function(el){ return !el.disabled && el.offsetParent !== null; });
}
export function openModal(title, html){
  document.getElementById('modal-title-txt').textContent = title;
  document.getElementById('modal-body').innerHTML = html;
  if(!modal.classList.contains('open')) _focusAvantModale = document.activeElement;
  modal.classList.add('open');
  const f = focusablesModale();
  const premier = f.find(function(el){ return el.id !== 'modal-close'; }) || f[0];
  if(premier) premier.focus();
}
export function closeModal(){
  modal.classList.remove('open');
  if(_focusAvantModale && typeof _focusAvantModale.focus === 'function' && document.contains(_focusAvantModale)){
    _focusAvantModale.focus();
  }
  _focusAvantModale = null;
}
modal.addEventListener('keydown', function(e){
  if(e.key !== 'Tab' || !modal.classList.contains('open')) return;
  const f = focusablesModale();
  if(!f.length) return;
  const i = f.indexOf(document.activeElement);
  if(e.shiftKey && i <= 0){ e.preventDefault(); f[f.length - 1].focus(); }
  else if(!e.shiftKey && i === f.length - 1){ e.preventDefault(); f[0].focus(); }
});
// EXPOSÉS EN GLOBALE : js/import-settings.js a besoin d'une modale (les réglages d'import non
// appliqués), et un `import` d'ici y ferait un cycle ui → assets → import-settings → ui.
globalThis.openModal = openModal;
globalThis.closeModal = closeModal;
document.getElementById('modal-close').addEventListener('click', closeModal);
modal.addEventListener('click', function(e){ if(e.target === modal) closeModal(); });

export function modalAAbout(){
  openModal('À propos — v' + VERSION_EDITOR,
    '<p>Mini moteur / éditeur 3D pour le web, construit sur three.js r185 '
    + '(rendu, chargeurs FBX/glTF, TransformControls) et cannon.js (physique), 100 % hors ligne. '
    + 'Les matériaux suivent la convention <b>glTF de Khronos</b> — voir Aide → Le contrat glTF.</p>'
    + '<p style="margin-top:8px">Un projet regroupe plusieurs scènes et des assets partagés '
    + '(Fichier → Enregistrer sous → Fichier de projet, .p3d compressé). ▶ Jouer lance animations, physique et '
    + 'scripts, puis restaure la scène à l\'arrêt. L\'export « données de jeu » produit un JSON '
    + 'propre consommable par un runtime externe.</p>'
    + '<p style="margin-top:8px">Ctrl+Z / Ctrl+Y : annuler / rétablir · Ctrl+clic : multi-sélection · '
    + 'Aide → API de scripts pour le gameplay.</p>'
    + '<p style="margin-top:8px"><b>Vue</b> — clic objet : sélection (déplacement via le gizmo) · '
    + 'clic dans le vide : orbite, glisser un rectangle pour une sélection multiple · '
    + '1/2/3 : déplacer / tourner / échelle · clic droit + glisser : vol libre (W/A/S/D + Q/E) · '
    + 'clic molette : pan · molette : zoom (vitesse de vol en vol libre) · F : cadrer · '
    + 'Ctrl+D : dupliquer · Espace : lecture · Suppr : supprimer.</p>'
    + '<p style="margin-top:4px"><b>Hiérarchie</b> — glissez un objet sur un autre pour le parenter, '
    + 'sur le vide pour le détacher · double-clic : renommer · ▾ : plier · 👁 : visibilité.</p>'
    + '<p style="margin-top:8px;color:var(--txt-dim)">Version ' + VERSION_EDITOR
    + ' — voir <code>ChangeLogs/v' + VERSION_EDITOR + '.md</code> et '
    + '<code>ChangeLogs/VERSIONING.md</code> à la racine du dépôt pour le détail des changements '
    + 'et les règles de numérotation.</p>');
}


// ---------- Entrées (Input Map) ----------
/**
 * Les entrées du projet.
 *
 * C'était une modale de trente lignes de HTML et deux écouteurs. Les entrées sont maintenant
 * une liste du panneau « Paramètres du projet » (js/ui/panels-settings.js) : la table de
 * touches y est la même, à la règle près qui compte — l'espace est une touche légitime, et
 * `trim()` l'effacerait.
 */
export function modalInputs(){
  if(typeof openPanelDock === 'function') openPanelDock('project-settings');
}

// ---------- Bibliothèque de prefabs par défaut ----------
// Accessible depuis N'IMPORTE QUEL projet, pas seulement à la création via le Hub — voir
// js/prefab-library.js. Utilise le modal générique de l'éditeur (openModal/closeModal,
// juste au-dessus) — le même mécanisme que « Plugins… » (modalPlugins, js/plugins.js) — plutôt
// qu'un prompt() texte.
export function modalPrefabLibrary(){
  if(typeof PrefabLibrary === 'undefined'){ warnOnceMissing('PrefabLibrary'); return; }
  const entries = PrefabLibrary.list();
  const lignes = entries.map(function(e){
    return '<div class="prefab-lib-card" data-id="' + escapeHtml(e.id) + '">'
      + '<div class="prefab-lib-label">' + escapeHtml(e.label) + '</div>'
      + '<div class="prefab-lib-desc">' + escapeHtml(e.description) + '</div>'
      + '</div>';
  }).join('');
  openModal('Bibliothèque de prefabs',
    '<p style="margin-bottom:8px;line-height:1.5">Des objets tout faits, rangés hors de tout '
    + 'projet (<code>moteur/prefabs-default/</code>) — cliquez pour en ajouter une instance à '
    + 'la scène courante. L\'objet importé devient un prefab normal du projet, réutilisable et '
    + 'modifiable comme n\'importe quel autre.</p>'
    + (lignes ? '<div class="prefab-lib-grid">' + lignes + '</div>'
              : '<div class="none">Bibliothèque vide.</div>'));

  document.querySelectorAll('.prefab-lib-card').forEach(function(card){
    card.addEventListener('click', async function(){
      const entry = entries.find(function(e){ return e.id === card.dataset.id; });
      if(!entry) return;
      closeModal();
      try {
        await PrefabLibrary.instantiate(entry.id);
        setStatus('« ' + entry.label + ' » ajouté à la scène', 2500);
      } catch(e){ setStatus('Erreur : ' + e.message, 5000); }
    });
  });
}

// ---------- Projets récents ----------
export async function showProjectsRecents(){
  let recents;
  try {
    recents = await listProjectsRecents();
  } catch(e){ setStatus('Erreur : ' + e.message, 5000); return; }
  if(!recents.length){ setStatus('Aucun projet récent.', 2000); return; }
  const choix = recents.map((r,i) => `${i+1}. ${r.name}`).join('\n');
  const input = prompt('Projets récents :\n' + choix + '\n\nNuméro à ouvrir :');
  const index = parseInt(input, 10) - 1;
  if(Number.isNaN(index) || !recents[index]) return;
  try {
    const handle = await openProjectRecent(recents[index]);
    const result = await loadProjectFromFolder(handle, idSessionEditor);
    await finalizeOpeningProjectFolder(handle, result);
    if(result.warningLock) setStatus('⚠ Ce dossier semble déjà ouvert dans un autre onglet.', 5000);
    else setStatus('Projet ouvert : ' + handle.name, 2000);
  } catch(e){ setStatus(e.message, 5000); }
}

/**
 * Ouvre un panneau du dock et le met au premier plan.
 *
 * Le geste était écrit deux fois — l'état vide de l'inspecteur et le menu `Fenêtres` — et une
 * troisième fois allait l'être pour les deux fenêtres de réglages. `reopen` puis `activate` :
 * un panneau fermé doit d'abord revenir, et un panneau ouvert derrière un autre onglet doit
 * passer devant, sinon « Préférences… » semble ne rien faire.
 */
export function openPanelDock(id){
  if(typeof Dock === 'undefined'){ warnOnceMissing('Dock'); return; }
  if(!Dock.open(id)) Dock.reopen(id);
  const zone = Dock.zoneOf(id);
  if(zone) Dock.activate(zone, id);
}

// ---------- Barre de menus ----------
// Le menu `Fenêtres` a deux moitiés : les PANNEAUX du dock (construits depuis le registre à
// chaque ouverture) et ces outils-là, qui n'en sont pas — quatre éditeurs qui s'ouvrent dans un
// onglet du navigateur, et l'aide. Animation, Animator et Palette de tuiles sont désormais des
// panneaux du registre (voir `panels-shell.js`) : ils sont listés avec les autres, plus haut.
export const MENU_WINDOWS_TOOLS = [
    {label:'Éditeur de code', action:function(){ openLastWindowCode(); }},
    {label:'Table de contenu', action:function(){ openLastWindowTable(); }},
    {label:'Graphe de shader', action:function(){ openLastWindowShader(); }},
    {label:'Éditeur HTML/CSS', action:function(){ openLastWindowDocumentUI(); }},
    {sep:true},
    {label:'📖 Aide', shortcut:'F1', action:function(){ openHelp(); }}
];

/** Une scène du projet — pas seulement la scène ouverte — a quelque chose à publier. */
function projectHasContent(){
  return objects.length > 0
    || (project.scenes || []).some(function(sc){
      return sc.data && sc.data.objects && sc.data.objects.length > 0;
    });
}

export const defMenus = [
  // LE MENU FICHIER EN SOUS-MENUS : il comptait vingt-cinq entrées à plat, où projet, scène,
  // enregistrement, cinq exports, une case à cocher et les réglages se suivaient sans ordre. Chaque
  // groupe répond maintenant à une question — créer, ouvrir, enregistrer, exporter — et l'action
  // principale d'un projet hébergé (« Publier en ligne ») reste au premier niveau.
  {title:'Fichier', items:[
    {label:'Nouveau', submenu:[
      {label:'Projet 3D', action:newProject},
      // La scène de départ est une scène 3D — sol, cube, soleil, caméra en perspective. Commencer un
      // game 2D demandait donc de supprimer quatre objets avant de créer le premier. Le préréglage
      // n'est pas un autre format de projet, juste un autre point de départ.
      {label:'🎮 Projet 2D…', action:function(){
        if(confirm('Vider la scène courante et démarrer un projet 2D ? Les assets sont conservés.')){
          pushHistory();
          newProject2d();
        }
      }}
    ]},
    {label:'Ouvrir', submenu:[
      {label:'Dossier de projet…', action:function(){ createFolderProject(); }},
      {label:'Fichier de projet… (.p3d / .s3d)', action:function(){ inputScene.click(); }},
      {sep:true},
      {label:'Projets récents…', action:function(){ showProjectsRecents(); }},
      {label:'Hub des projets…', action:function(){ location.href = 'hub.html'; }}
    ]},
    {label:'Enregistrer', shortcut:'Ctrl+S', action:function(){ saveProject(); }},
    {label:'Enregistrer sous', submenu:[
      {label:'Fichier de projet (.p3d)', action:registerScene},
      // Entrées conditionnelles (js/cloud-session.js:storageMenuVisibility) : `hidden` est
      // relu à chaque ouverture du menu, les indices restent ceux de la liste complète.
      {label:'📁 Dans un dossier…', hidden:function(){ return !storageMenuVisibility(currentStorageMode(), isLoggedIn()).saveToFolder; },
        action:function(){ saveToFolder(); }},
      {label:'☁ Sur le cloud…', hidden:function(){ return !storageMenuVisibility(currentStorageMode(), isLoggedIn()).uploadToCloud; },
        action:function(){ uploadToCloud(); }},
      {label:'⬇ Copie locale…', hidden:function(){ return !storageMenuVisibility(currentStorageMode(), isLoggedIn()).downloadLocal; },
        action:function(){ downloadLocal(); }}
    ]},
    {label:'Récupérer la sauvegarde automatique…', action:recoverAutoSave},
    {sep:true},
    {label:'Scène', submenu:[
      {label:'Nouvelle scène dans le projet', action:addScene},
      {label:'Vider la scène courante', action:function(){
        if(confirm('Vider la scène courante ? Les autres scènes et les assets sont conservés.')){
          pushHistory();
          newScene(false);
        }
      }}
    ]},
    {sep:true},
    {label:'Exporter', submenu:[
      // ACTIF DÈS QU'UNE SCÈNE DU PROJET a quelque chose à publier, et pas seulement la scène
      // COURANTE. La condition lisait `objects.length`, c'est-à-dire la scène ouverte : un projet
      // dont la scène de départ est vide (un menu, un écran-titre) affichait une entrée grisée,
      // sans dire pourquoi — on cherche le bouton, il est là, il a juste l'air désactivé pour
      // toujours. Même effet pendant qu'un projet finit de charger.
      {label:'🎮 Build Web jouable (.zip)', active:projectHasContent, action:exportBuildWeb},
      // LA MÊME CONDITION que le build web, et pour la même raison : les deux publient le même
      // jeu, et une entrée active d'un côté et grisée de l'autre ferait chercher une différence
      // qui n'existe pas.
      {label:'🖥 Projet bureau (Electron, .zip)', active:projectHasContent, action:exportBuildDesktop},
      {label:'Dossier lisible (Git, .zip)', action:exportProjectGit},
      {label:'Données de jeu (.json)', active:function(){ return objects.length > 0; },
        action:exportDataGame},
      {sep:true},
      // Dans Exporter, parce que c'est du BUILD qu'il s'agit — pas de l'éditeur.
      {label:'Numéro de version affiché dans le jeu',
        checked:function(){ return project.versionVisible !== false; },
        action:function(){
          project.versionVisible = (project.versionVisible === false);
          setStatus(project.versionVisible
            ? 'Le prochain build affichera son numéro de version en bas à droite'
            : 'Le prochain build n\'affichera pas de numéro de version', 3500);
        }}
    ]},
    // Projet hébergé : construit ET publie, sans .zip à manipuler (le lien reste le même d'une
    // publication à l'autre).
    {label:'🌐 Publier en ligne',
      active:function(){ return !!(project.cloud && project.cloud.id); },
      action:publishBuildToCloud},
    {sep:true},
    {label:'Importer des assets…', action:function(){ inputImport.click(); }},
    {label:'Bibliothèque de prefabs…', action:function(){ modalPrefabLibrary(); }},
    {sep:true},
    {label:'⚙ Paramètres du projet…', action:function(){ openPanelDock('project-settings'); }},
    {label:'Entrées (Input Map)…', action:modalInputs},
    // Un SOUS-MENU, pas deux entrées de plus : le premier niveau de Fichier est plafonné à 17
    // (test/menu-sous-menus.test.mjs), et découvrir un plugin puis gérer les siens sont deux
    // moments du même sujet. Le catalogue vient en premier : c'est celui qu'on cherche quand
    // on ne sait pas encore ce qui existe.
    {label:'🧩 Plugins', submenu:[
      {label:'🏪 Parcourir le catalogue…', action:function(){ openPluginCatalog(); }},
      {label:'Plugins installés…', action:function(){ modalPlugins(); }}
    ]}
  ]},
  {title:'Édition', items:[
    {label:'Annuler', shortcut:'Ctrl+Z', active:function(){ return histo.undo.length > 0; }, action:undo},
    {label:'Rétablir', shortcut:'Ctrl+Y', active:function(){ return histo.redo.length > 0; }, action:restore},
    {sep:true},
    {label:'Copier', shortcut:'Ctrl+C', active:function(){ return !!selection; }, action:copySelection},
    {label:'Coller', shortcut:'Ctrl+V', mutates:true, active:function(){ return clipBoard.length > 0; }, action:pasteClipBoard},
    {label:'Dupliquer', shortcut:'Ctrl+D', mutates:true, active:function(){ return !!selection; }, action:duplicateSelection},
    {sep:true},
    {label:'Créer un prefab', mutates:true, active:function(){ return !!selection; }, action:createPrefabFromSelection},
    {label:'Cadrer la sélection', shortcut:'F', active:function(){ return !!selection; }, action:frameSelection},
    {sep:true},
    {label:'🔍 Analyser la scène', action:openAnalysisScene},
    {sep:true},
    {label:'🎛 Préférences…', action:function(){ openPanelDock('preferences'); }},
    {sep:true},
    {label:'Supprimer', shortcut:'Suppr', mutates:true, active:function(){ return !!selection; }, action:deleteSelection}
  ]},
  {title:'Objet', items:[]},   // rempli par refreshMenuObject(), appelée depuis objects.js
  {title:'Affichage', items:[
    {label:'Ombres', checked:function(){ return filters.shadows; },
      action:function(){ document.getElementById('filter-shadows').click(); }},
    {label:'Textures', checked:function(){ return filters.textures; },
      action:function(){ document.getElementById('filter-textures').click(); }},
    {label:'Shaders', checked:function(){ return filters.shaders; },
      action:function(){ document.getElementById('filter-shaders').click(); }},
    {label:'Fil de fer', checked:function(){ return filters.wireframe; },
      action:function(){ document.getElementById('filter-wireframe').click(); }},
    {label:'Aimanter le gizmo', checked:function(){ return document.getElementById('filter-magnet').classList.contains('active'); },
      action:function(){ document.getElementById('filter-magnet').click(); }},
    {sep:true},
    {label:'🗂 Layers…', action:modalLayers},
    {sep:true},
    {label:'📊 Profiler & budgets', checked:function(){ return profiler.active; },
      action:toggleProfiler},
    {label:'⚛ Simulation physique seule', checked:function(){ return phys.active; },
      action:function(){ toggleSimulation(); }},
    {sep:true},
    {label:'Gizmo : déplacer', shortcut:'1', checked:function(){ return tc.mode === 'translate'; },
      action:function(){ setModeGizmo('translate'); }},
    {label:'Gizmo : tourner', shortcut:'2', checked:function(){ return tc.mode === 'rotate'; },
      action:function(){ setModeGizmo('rotate'); }},
    {label:'Gizmo : échelle', shortcut:'3', checked:function(){ return tc.mode === 'scale'; },
      action:function(){ setModeGizmo('scale'); }}
  ]},
  {title:'Fenêtres', items:function(){
    // LES PANNEAUX, DEPUIS LE REGISTRE. Un panneau fermé doit pouvoir être rouvert, sinon
    // « fermer » veut dire « perdre ». La liste est construite à l'OUVERTURE du menu : un
    // panneau déclaré par un plugin, donc après le démarrage, y apparaît quand même.
    // La forme du descripteur (adopt/defaultZone/onOpenRequest) est l'affaire de Dock, pas du
    // menu — voir `Dock.listable`/`Dock.toggle` (docs/REVUE_2026-09-14.md point 11).
    const panneaux = (typeof Dock !== 'undefined') ? Dock.listable() : [];
    const items = panneaux.map(function(d){
      return {label: (d.icon ? d.icon + ' ' : '') + (d.title || d.id),
              checked: function(){ return Dock.open(d.id); },
              // Un panneau `closable: false` (la vue 3D) est listé mais ne se décoche pas.
              active: function(){ return Dock.closable(d.id) || !Dock.open(d.id); },
              action: function(){ Dock.toggle(d.id); }};
    });
    if(items.length){
      items.push({label:'↺ Réinitialiser la disposition',
        action: function(){ if(typeof Dock !== 'undefined') Dock.reset(); }});
      items.push({sep:true});
    }
    return items.concat(MENU_WINDOWS_TOOLS);
  }},
  // ---- suite du menu Fenêtres : les outils qui ne sont PAS des panneaux du dock ----
  // (référencé ci-dessus ; défini plus bas pour garder la liste des menus lisible)
  // Ces entrées ouvrent toutes la même PAGE (help.html), à des endroits différents. Les
  // deux modales « Raccourcis » et « API de scripts » qui vivaient ici ont été retirées :
  // elles disaient la même chose que ces pages, en moins complet et sans rien qui empêche
  // de vieillir — celles-ci sont vérifiées par test/aide.test.mjs.
  {title:'Aide', items:[
    {label:'📖 Aide de l\'éditeur…', shortcut:'F1', action:function(){ openHelp(); }},
    {label:'Glossaire', action:function(){ openHelp('glossary'); }},
    {sep:true},
    {label:'✨ Copilote IA (Claude)…', action:function(){ openCopilot(); }},
    {sep:true},
    {label:'Raccourcis clavier', action:function(){ openHelp('shortcuts'); }},
    {label:'API de scripts (JS)', action:function(){ openHelp('scripts-api'); }},
    {label:'À propos', action:modalAAbout}
  ]}
];

export const MENU_OBJECT_EXTRA_AFTER = [
  {sep:true},
  {label:'◈ Instancier une sous-scène', active:function(){ return project.scenes.length > 1; },
    action:function(){ createSubScene(); }},
  {label:'🔮 Cuire toutes les sondes', active:function(){
      return Registry.activeNodes('Reflection').length > 0; },
    action:function(){ bakeAllProbes(); }},
  // Cuit TOUTE la scène, pas la sélection : les objets non cuits ne projetteraient plus
  // d'ombre sur les autres, et une lightmap sans les ombres des voisins est pire qu'aucune.
  {label:'💡 Cuire les lightmaps…', active:function(){ return !lightmapBakeState.active; },
    action:modalBakeLightmap},
  {sep:true},
  {label:'⇩ Poser au sol', active:function(){ return !!selection; },
    action:function(){ setAtGround(false); }},
  {label:'⟂ Poser et aligner à la normale', active:function(){ return !!selection; },
    action:function(){ setAtGround(true); }},
  {label:'≡ Aligner / distribuer…', active:function(){ return allSelection().length >= 2; },
    action:modalAlignDistribute},
  {label:'⧉ Dupliquer en série…', active:function(){ return !!selection; },
    action:modalDuplicateSeries}
];

// PAS D'APPEL AU PREMIER NIVEAU ICI : `TYPES_CREATABLE` est un `const` de `objects.js`, et ce
// fichier est dans un cycle d'imports avec lui (`objects.js` importe `refreshMenuObject` d'ici ;
// ce fichier importe `TYPES_CREATABLE` de là-bas). Le lire pendant l'évaluation du module lève
// une ReferenceError de zone morte temporelle selon l'ordre de résolution. `objects.js` appelle
// déjà `refreshTypesCreatable()` (qui appelle celle-ci) à SON premier niveau, après avoir déclaré
// `TYPES_CREATABLE` — donc sans risque.
export function refreshMenuObject(){
  const menu = defMenus.find(function(m){ return m.title === 'Objet'; });
  if(!menu) return;
  menu.items = TYPES_CREATABLE.map(function(t){
    // Tout le menu Objet cree un objet : `mutates` sur chaque entree, pas de cas particulier.
    return {label: (t.icon || '') + t.label, mutates: true, action: function(){ createObject(t.type); }};
  }).concat(MENU_OBJECT_EXTRA_AFTER);
}

export const menusEl = document.getElementById('menus');
export let menuOpen = null;

// Les entrées d'un menu peuvent être une FONCTION, évaluée à chaque ouverture. Le menu
// `Fenêtres` en a besoin : les plugins s'exécutent en dernier (startup.js) et déclarent leurs
// panneaux après — une liste figée au chargement ne les verrait jamais.
export function itemsOf(def){
  return (typeof def.items === 'function') ? def.items() : def.items;
}

/** Les entrées d'un sous-menu : une liste, ou une fonction relue à chaque ouverture. */
export function subItemsOf(it){
  return (typeof it.submenu === 'function') ? it.submenu() : (it.submenu || []);
}

/**
 * Le HTML d'une liste d'entrées. `prefix` est le chemin de la liste : une entrée d'un sous-menu
 * porte `data-i="3.2"` (3e entrée du menu, 2e du sous-menu), que le clic redescend avec
 * `menuItemAt`. Les indices restent ceux de la liste COMPLÈTE, entrées masquées comprises.
 *
 * UN SEUL NIVEAU de sous-menu est prévu par la mise en page (le sous-menu s'ouvre à droite) ; le
 * rendu, lui, est récursif et n'en présume rien.
 */
export function menuItemsHtml(list, prefix){
  let html = '';
  list.forEach(function(it, i){
    if(it.sep){ html += '<div class="menu-sep"></div>'; return; }
    if(it.hidden && it.hidden()) return;
    const path = (prefix || '') + i;
    if(it.submenu){
      const inner = menuItemsHtml(subItemsOf(it), path + '.');
      // Un sous-menu dont toutes les entrées sont masquées disparaît : une flèche vers une liste
      // vide ferait chercher ce qui n'existe pas.
      if(!inner.replace(/<div class="menu-sep"><\/div>/g, '')) return;
      html += '<div class="menu-sub">'
        + '<button class="item has-sub" data-sub="' + path + '" role="menuitem" aria-haspopup="menu"'
        + ' aria-expanded="false">'
        + '<span><span class="checked"></span>' + it.label + '</span>'
        + '<span class="shortcut" aria-hidden="true">▸</span></button>'
        + '<div class="dropdown submenu" role="menu" aria-label="' + it.label.replace(/"/g, '&quot;') + '">'
        + inner + '</div></div>';
      return;
    }
    // `mutates` coupe l'entree en lecture seule. Annuler/Retablir n'en portent PAS, a dessein :
    // la fenetre decrite dans js/scene-lock.js laisse passer le tout premier geste, et c'est
    // precisement l'annulation qui le reprend. Les couper enfermerait avec la modification.
    const desac = (it.active && !it.active()) || (it.mutates && isReadOnly());
    const checked = it.checked ? (it.checked() ? '✓' : '') : '';
    html += '<button class="item' + (desac ? ' disabled' : '') + '" data-i="' + path + '" role="menuitem"'
      + (desac ? ' aria-disabled="true"' : '') + (it.checked ? ' aria-checked="' + !!checked + '"' : '') + '>'
      + '<span><span class="checked">' + checked + '</span>' + it.label + '</span>'
      + (it.shortcut ? '<span class="shortcut">' + it.shortcut + '</span>' : '')
      + '</button>';
  });
  return html;
}

/** L'entrée désignée par un chemin `data-i` (« 3 » ou « 3.2 »). */
export function menuItemAt(list, path){
  const parts = String(path).split('.');
  let it = null;
  for(let k = 0; k < parts.length; k++){
    if(k > 0){ if(!it || !it.submenu) return null; list = subItemsOf(it); }
    it = list[parseInt(parts[k], 10)];
  }
  return it || null;
}

export function renderDropdown(menuEl, def){
  menuEl.querySelector('.dropdown').innerHTML = menuItemsHtml(itemsOf(def), '');
}

/** Les entrées atteignables au clavier d'UNE liste (pas celles de ses sous-menus). */
function menuListItems(container){
  const out = [];
  Array.prototype.forEach.call(container.children, function(c){
    if(c.classList.contains('item') && !c.classList.contains('disabled')) out.push(c);
    else if(c.classList.contains('menu-sub')) out.push(c.firstElementChild);
  });
  return out;
}
function setSubOpen(sub, on){
  sub.classList.toggle('open', on);
  sub.firstElementChild.setAttribute('aria-expanded', on ? 'true' : 'false');
}

// crée le DOM d'un menu — appelable après coup (les plugins peuvent add un menu)
export function addMenuDom(def){
  const m = document.createElement('div');
  m.className = 'menu';
  m.textContent = def.title;
  // AU CLAVIER : un titre de menu est un bouton qui ouvre une liste (§ 4.4). Tab l'atteint, Entrée,
  // Espace ou Flèche bas l'ouvrent, les flèches parcourent les entrées, Échap referme et rend le
  // focus au titre.
  m.tabIndex = 0;
  m.setAttribute('role', 'button');
  m.setAttribute('aria-haspopup', 'menu');
  m.setAttribute('aria-expanded', 'false');
  const der = document.createElement('div');
  der.className = 'dropdown';
  der.setAttribute('role', 'menu');
  m.appendChild(der);
  menusEl.appendChild(m);
  m.addEventListener('keydown', function(e){
    if(e.target === m && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown')){
      e.preventDefault();
      openMenu(m, def);
      const l = menuListItems(der);
      if(l[0]) l[0].focus();
      return;
    }
    if(!der.contains(e.target)) return;
    // La liste de l'entrée focalisée : celle du menu, ou celle du sous-menu où l'on est entré.
    const list = e.target.parentNode.classList.contains('menu-sub')
      ? e.target.parentNode.parentNode : e.target.parentNode;
    const l = menuListItems(list);
    const i = l.indexOf(e.target);
    const sub = e.target.classList.contains('has-sub') ? e.target.parentNode : null;
    if(e.key === 'ArrowDown'){ e.preventDefault(); (l[i + 1] || l[0]).focus(); }
    else if(e.key === 'ArrowUp'){ e.preventDefault(); (l[i - 1] || l[l.length - 1]).focus(); }
    // → (ou Entrée, Espace) sur une entrée à sous-menu : on y entre. ← dans un sous-menu : on en
    // ressort, sur l'entrée qui l'a ouvert.
    else if(sub && (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ')){
      e.preventDefault();
      setSubOpen(sub, true);
      const first = menuListItems(sub.lastElementChild)[0];
      if(first) first.focus();
    }
    else if(e.key === 'ArrowLeft' && list.classList.contains('submenu')){
      e.preventDefault();
      setSubOpen(list.parentNode, false);
      list.parentNode.firstElementChild.focus();
    }
    else if(e.key === 'Escape'){ e.preventDefault(); closeMenus(); m.focus(); }
  });
  // Un seul sous-menu ouvert à la fois : survoler une autre entrée referme celui qu'on avait
  // ouvert au clavier ou au toucher.
  der.addEventListener('mouseover', function(e){
    const item = e.target.closest('.item');
    if(!item) return;
    const list = item.parentNode.classList.contains('menu-sub') ? item.parentNode.parentNode : item.parentNode;
    Array.prototype.forEach.call(list.children, function(c){
      if(c.classList.contains('menu-sub') && c !== item.parentNode && c.classList.contains('open')) setSubOpen(c, false);
    });
  });

  m.addEventListener('click', function(e){
    if(e.target.closest('.dropdown')){
      const btn = e.target.closest('.item');
      if(!btn || btn.classList.contains('disabled')) return;
      // Une entrée à sous-menu ne ferme rien : un clic (ou un toucher, sans survol) l'ouvre.
      if(btn.classList.contains('has-sub')){
        setSubOpen(btn.parentNode, !btn.parentNode.classList.contains('open'));
        return;
      }
      const it = menuItemAt(itemsOf(def), btn.dataset.i);
      closeMenus();
      if(it && it.action) it.action();
      return;
    }
    if(menuOpen === m) closeMenus();
    else openMenu(m, def);
  });
  m.addEventListener('mouseenter', function(){
    if(menuOpen && menuOpen !== m) openMenu(m, def);
  });
  return m;
}

defMenus.forEach(addMenuDom);

export function openMenu(m, def){
  closeMenus();
  renderDropdown(m, def);
  m.classList.add('open');
  m.setAttribute('aria-expanded', 'true');
  menuOpen = m;
}
export function closeMenus(){
  if(menuOpen){ menuOpen.classList.remove('open'); menuOpen.setAttribute('aria-expanded', 'false'); }
  menuOpen = null;
}
document.addEventListener('pointerdown', function(e){
  if(menuOpen && !e.target.closest('.menu')) closeMenus();
});


// ---------- Les poignées de redimensionnement ont déménagé ----------
// Elles appartenaient à la grille CSS (`--lg`/`--ld`/`--lb`), qui n'existe plus : le dock
// (js/ui/dock.js) en pose une par séparation de son arbre, en Pointer Events avec
// `setPointerCapture` — les anciennes écoutaient un `pointermove` global et perdaient le geste
// dès que le curseur sortait de la fenêtre.
export function clamp(v, min, max){ return Math.max(min, Math.min(max, v)); }

/**
 * Le canvas suit toute variation de taille du viewport. Appelée par `startup.js`.
 *
 * Différée pour la même raison que `bindEditorInput` : `viewEl` est un `const` de `js/scene.js`,
 * et ce fichier est dans un cycle d'imports avec lui. Le câblage au premier niveau ne tenait que
 * par l'ordre de résolution des imports, pas par le graphe de modules.
 *
 * ATTENTION : `ResizeObserver`, avec son `r` final. Ce nom a déjà perdu son `r` dans une
 * passe de renommage ; comme il est gardé par `typeof`, la panne était SILENCIEUSE —
 * l'observateur ne tournait plus et rien ne le disait. Gardé par test/apis-navigateur.test.mjs.
 */
export function bindViewportResize(){
  if(typeof ResizeObserver !== 'undefined'){
    new ResizeObserver(function(){ requestResize(); }).observe(viewEl);
  }
}

// PAS D'APPEL ICI NON PLUS, même raison que `refreshMenuObject` ci-dessus : `objects.js` appelle
// déjà `refreshTypesCreatable()` à son premier niveau, après sa propre déclaration de
// `TYPES_CREATABLE` — l'appeler une seconde fois ici referait la même course avec la zone morte
// temporelle, cette fois côté `objects.js`.


// EXPOSÉ EN GLOBALE, à dessein. Ces symboles sont appelés depuis des fichiers
// que les mêmes pages ne chargent pas toutes : un `import` y pointerait un
// fichier absent, et la page ne démarrerait pas. Ils gardent donc leur garde
// `typeof` côté appelant, et se déclarent ici.
globalThis.clamp = clamp;