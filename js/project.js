// ---------- Projet : plusieurs scènes, assets partagés ----------
// Le project regroupe des scènes (une seule est « vivante » dans l'éditeur à la fois)
// et le panneau Projet (assets), commun à toutes. Au changement de scène, la scène
// courante est sérialisée dans projet.scenes[i].donnees, la cible est reconstruite.
// Le projet, et ses RÉGLAGES.
//
// `settings` est la seule donnée ; `project.layers`, `project.inputs` &co. sont des ACCESSEURS
// dessus — une façade, pas un second exemplaire. Elle existe pour deux raisons : les cinquante
// points de lecture du dépôt continuent de s'écrire `project.layers` (le diff de ce lot serait
// sinon illisible, et une faute de frappe y créerait une propriété morte au lieu d'une erreur),
// et les plugins v1 qui lisaient `project.layers` restent debout.
//
// Ce qui vit ici et NON dans `settings` : la scène courante, la liste des scènes, les dossiers
// d'assets, le handle du dossier ouvert. Ce ne sont pas des réglages — ce sont l'état de la
// session et le contenu du projet.
import { refreshSpritesOfLAsset } from './import-settings.js';
import { forgetClipCompiled, migrateMachinesOfScene } from './anim-models.js';
import { updateTimeline } from './animation.js';
import { assets, folderCurrent, organizeModelsInOwnFolders, removeAssetInMemory, replaceContentAssetTexture, setFolderCurrent, updateProject } from './assets.js';
import { decodeAssetAudio, renderAssetLoop, renderAssetSfx, resetAudioMix } from './audio.js';
import { inputs } from './editor-input.js';
import { setStatus, updateHierarchy } from './hierarchy.js';
import { histo, pushHistory, restoreState, stateCurrent } from './history.js';
import { HubTemplates } from './hub/hub-templates.js';
import { LIGHTMAP_DEFAULT } from './lightmap-bake.js';
import { invalidateTilemapsOfPalette } from './palette-ui.js';
import { applyMaterialEverywhere, ensureMaterialDefaultProject } from './materials.js';
import { escapeHtml } from './objects.js';
import { phys, stopSimulation } from './physics.js';
import { cloudApi, cloudProjectIdFromUrl, openCloudProject } from './cloud-project.js';
import { initSceneLock, switchScene as switchSceneLock } from './scene-lock.js';
import { ERRORS_PERMISSION, assetDiscoveryInProgress, chronoMs, discoverFolderAssets, loadContentScene, loadManifestFromTree, loadProjectFromFolder, migrateManifestFolder, migrateSceneFile, openFolderProject, readMetas, relocateAssetsByMeta, resolveAssetDescriptors, scanFolder, setAssetDiscoveryInProgress, takeDiskWritesOurs } from './project-folder.js';
import { LAYERS_DEFAULT, projectSettingsOf } from './project-settings.js';
import { listProjectsRecents, openProjectRecent, registerProjectRecent } from './recents.js';
import { INPUTS_DEFAULT, holdersOfScriptAsset, mergeVarsDeclared } from './scripts.js';
import { select } from './selection.js';
import { animationFieldsOf, diskAssetManifest, loadScene, newScene, rebuildAssetsFromDescriptors, spriteFieldsOf, registerInProjectOpen, remapReferencesAssetsInScenes, reportDeadReferences } from './serialization.js';
import { refreshProjectLabel } from './ui.js';
import { WATCH_INTERVAL_MS, changedScenes, classifyChanges, intervalNext, sceneSignatures, signatureTree } from './folder-watch.js';
import { markProjectSaved, projectSave } from './project-dirty.js';
import { invalidateWrite, resetWriteCache } from './write-cache.js';
import { Prefs } from './ui/prefs.js';

export const project = {
  current: 0,
  scenes: [{name: 'Scène 1', data: null}],
  folders: [],
  settings: projectSettingsOf({}),

  get name(){ return this.settings.name; },
  // La barre du haut affiche ce nom. Elle est prévenue ICI plutôt que de le relire en boucle :
  // l'éditeur n'a pas de rafraîchissement global, et cet accesseur est — avec
  // `applyProjectSettings` — l'UN DES DEUX seuls endroits qui écrivent le nom du projet.
  set name(v){
    this.settings.name = v;
    if(typeof refreshProjectLabel === 'function') refreshProjectLabel();
  },
  get layers(){ return this.settings.layers; },
  set layers(v){ this.settings.layers = v; },
  // Les calques de tri 2D, du fond vers l'avant. C'est le PROJET qui les porte et non la scène :
  // un sprite déplacé d'une scène à l'autre garderait sinon un nom de calque qui n'existe pas
  // là-bas, et `orderOfSort` l'enverrait au fond.
  get layers2d(){ return this.settings.layers2d; },
  set layers2d(v){ this.settings.layers2d = v; },
  // Les pixels par unité de RÉFÉRENCE : l'échelle de la grille 2D et celle dont le zoom entier
  // dérive. Un sprite peut avoir le sien, celui-ci cadre la vue.
  get ppu2d(){ return this.settings.ppu2d; },
  set ppu2d(v){ this.settings.ppu2d = v; },
  get inputs(){ return this.settings.inputs; },
  set inputs(v){ this.settings.inputs = v; },
  // Réglages de cuisson : ils appartiennent au projet, pas à la machine. Deux personnes qui
  // cuisent la même scène doivent obtenir la même chose.
  get lightmap(){ return this.settings.lightmap; },
  set lightmap(v){ this.settings.lightmap = v; },
  // Le document de conception : l'intention, les contraintes, ce qui a été écarté. Il voyage
  // avec le projet parce que c'est la seule chose qu'une scène ne dit pas — elle dit ce qui
  // EST, jamais ce qu'on voulait.
  get design(){ return this.settings.design; },
  set design(v){ this.settings.design = v; },
  // Afficher ou non le numéro de version dans le jeu publié. C'est un réglage de PROJET et non
  // une préférence d'éditeur : deux personnes qui publient le même projet doivent obtenir le
  // même build.
  get versionVisible(){ return this.settings.versionVisible; },
  set versionVisible(v){ this.settings.versionVisible = v; },
  // Les réglages multijoueur (voir sanitizeNetworkSettings, js/network-game.js).
  get network(){ return this.settings.network; },
  set network(v){ this.settings.network = v; }
};

export const scenesList = document.getElementById('scenes-list');

export function updateScenes(){
  let html = '';
  project.scenes.forEach(function(s, i){
    html += '<div class="scene-item' + (i === project.current ? ' active' : '') + '" data-i="' + i + '">'
      + '<span>🎬</span><span class="scene-name">' + escapeHtml(s.name) + '</span>'
      + '<button class="scene-x" title="Supprimer la scène">×</button></div>';
  });
  scenesList.innerHTML = html;
}

/**
 * L'instantané d'une scène SANS la liste des assets.
 *
 * `stateCurrent()` photographie aussi `assets` — c'est voulu pour Ctrl+Z, qui doit pouvoir
 * annuler une création d'asset. Mais les assets sont GLOBAUX au projet : rangée dans
 * `project.scenes[i].data` puis rejouée par `restoreState` à l'activation, cette photo
 * remplaçait la liste du projet par celle du jour où l'on avait quitté la scène (ou de la
 * dernière sauvegarde, `buildDataProject` y rangeant la sienne). Tout script, prefab ou texture
 * créé depuis disparaissait au changement de scène, à `fix_prefabs`, à la suppression de la
 * scène active — BUGS_MOTEUR n° 1, 2 et 17. Sans `assets`/`fieldsAssets`, `restoreAssets` et
 * `restoreFieldsAssets` ne touchent à rien (le cas « instantané d'une version antérieure »).
 */
export function sceneStateOnly(state){
  if(!state) return state;
  const out = Object.assign({}, state);
  delete out.assets;
  delete out.fieldsAssets;
  return out;
}

export function changeScene(i){
  if(i === project.current || !project.scenes[i]) return;
  if(phys.active) stopSimulation();
  project.scenes[project.current].data = sceneStateOnly(stateCurrent());
  project.current = i;
  // Le verrou suit la scene affichee : on libere la precedente et on repart en « non demande ».
  // Sans cela on garderait une scene verrouillee qu'on n'edite plus, et le bandeau mentirait.
  switchSceneLock(project.scenes[i].name);
  histo.undo.length = 0;
  histo.redo.length = 0;
  // `sceneStateOnly` AUSSI à la relecture : `buildDataProject` et l'observateur du copilote
  // rangent encore un instantané complet dans la scène courante.
  const d = project.scenes[i].data;
  if(d) restoreState(sceneStateOnly(d));
  else newScene(false);
  // Les machines de CETTE scène-ci n'avaient pas d'objet porteur tant qu'elle n'était pas
  // instanciée : c'est le premier instant où l'on sait de quel modèle vient leur « marche ».
  migrateMachinesOfScene();
  updateScenes();
  setStatus('Scène « ' + project.scenes[i].name + ' »', 2000);
}

export function addScene(){
  let n = project.scenes.length + 1;
  while(project.scenes.some(function(s){ return s.name === 'Scène ' + n; })) n++;
  project.scenes.push({name:'Scène ' + n, data:null});
  updateScenes();
  changeScene(project.scenes.length - 1);
}

export function renameScene(i){
  const s = project.scenes[i];
  if(!s) return;
  const name = prompt('Nom de la scène :', s.name);
  if(name && name.trim()){ s.name = name.trim(); updateScenes(); }
}

export function deleteScene(i){
  if(project.scenes.length < 2){ setStatus('Le projet doit garder au moins une scène', 2500); return; }
  const s = project.scenes[i];
  if(!confirm('Supprimer la scène « ' + s.name + ' » ? Cette action est définitive.')) return;
  if(i === project.current){
    changeScene(i === 0 ? 1 : 0);
    // l'index current a pu bouger : on retrouve la scène à supprimer par référence
  }
  const idx = project.scenes.indexOf(s);
  project.scenes.splice(idx, 1);
  if(project.current > idx) project.current--;
  updateScenes();
}

export function newProject(){
  if(!confirm('Nouveau projet ? Scènes ET assets actuels seront perdus (pensez à enregistrer).')) return;
  newScene(true);                       // vide la scène + les assets
  histo.undo.length = 0;
  histo.redo.length = 0;
  project.name = 'Mon projet';
  project.current = 0;
  project.scenes = [{name:'Scène 1', data:null}];
  project.inputs = JSON.parse(JSON.stringify(INPUTS_DEFAULT));
  project.folders = [];
  project.layers = JSON.parse(JSON.stringify(LAYERS_DEFAULT));
  project.lightmap = JSON.parse(JSON.stringify(LIGHTMAP_DEFAULT));
  setFolderCurrent('');
  ensureMaterialDefaultProject();
  updateScenes();
  setStatus('Nouveau projet', 2000);
}

scenesList.addEventListener('click', function(e){
  const item = e.target.closest('.scene-item');
  if(!item) return;
  const i = parseInt(item.dataset.i, 10);
  if(e.target.classList.contains('scene-x')) deleteScene(i);
  else changeScene(i);
});
scenesList.addEventListener('dblclick', function(e){
  const item = e.target.closest('.scene-item');
  if(item) renameScene(parseInt(item.dataset.i, 10));
});
document.getElementById('btn-scene-add').addEventListener('click', addScene);

// ---------- Ouverture d'un dossier de projet sur disque (File System Access API) ----------
export let idSessionEditor = 'session-' + Math.random().toString(36).slice(2);

// Applique en mémoire le résultat de loadProjectFromFolder() : vide la scène et
// les assets courants, reconstruit les assets du projet à partir du manifeste (le
// binaire réel est lu sur disque via entree.handle.getFile() — pas de base64, contrairement
// au format .p3d), remappe les références d'assets dans les scènes (ils reçoivent de
// nouveaux ids à chaque reconstruction, comme pour loadDataProject), puis restaure
// la première scène dans l'éditeur. Partagée par createFolderProject() et
// showProjectsRecents() (ui.js) pour éviter que ces deux chemins divergent.
export async function finalizeOpeningProjectFolder(handle, result){
  // MESURE TEMPORAIRE (à retirer une fois la lenteur signalée diagnostiquée) : chaque étape
  // de l'ouverture d'un dossier de projet est coûteuse en I/O (File System Access API) et rien
  // n'indiquait laquelle dominait. `console.time`/`timeEnd` plutôt qu'un profileur : la seule
  // façon d'observer un vrai dossier utilisateur, que ce code ne voit jamais en dehors du
  // navigateur de la personne qui l'ouvre.
  const t0 = performance.now();
  const { manifest, scenes, tree } = result;
  newScene(true);   // vide la scène live ET les assets du projet précédent
  histo.undo.length = 0;
  histo.redo.length = 0;

  // resolveAssetDescriptors() lit d'abord le contenu des scripts/matériaux
  // référencés (scripts/<name>.js, materials/<name>.material.json) depuis le disque,
  // et saute silencieusement ceux dont le fichier a disparu (voir project-folder.js) —
  // on avertit ici si des descripteurs ont été perdus en cours de route.
  // DÉCOUVERTE : les fichiers présents sous assets/ mais absents du manifeste (copiés à
  // la main, sortis d'un autre outil, arrivés par git) deviennent des assets à part
  // entière. Sans ça, la seule façon de les faire entrer dans le projet était de les
  // RÉIMPORTER — ce qui en écrivait un doublon juste à côté. Les descripteurs découverts
  // rejoignent ceux du manifeste avant résolution : à partir d'ici, rien ne les distingue.
  const declares = manifest.assets || [];
  // LES CARTES D'IDENTITÉ D'ABORD, avant de décider quel fichier est quoi. Deux services :
  //   — reloger les assets du manifeste dont le fichier a été renommé/déplacé à la main, au
  //     lieu de les perdre ET d'en redécouvrir un sosie anonyme au nouvel emplacement ;
  //   — rendre son id d'origine à un fichier qui revient (git, copie, autre outil), pour que
  //     les scènes qui le référencent le retrouvent.
  const metas = await readMetas(tree);
  const reloges = relocateAssetsByMeta(declares, metas, tree);
  if(reloges.length){
    console.warn('[projet] ' + reloges.length + ' asset(s) retrouve(s) a un nouvel emplacement'
      + ' grace a leur carte d identite (.meta) :\n'
      + reloges.map(function(r){ return '  • ' + r.name + ' : ' + r.before + ' → ' + r.after; }).join('\n'));
  }
  const decouverts = discoverFolderAssets(tree, declares, metas);
  const tAvantDescripteurs = performance.now();
  const descripteurs = await resolveAssetDescriptors(declares.concat(decouverts), tree);
  const tApresDescripteurs = performance.now();
  if(descripteurs.length < declares.length + decouverts.length){
    setStatus('Certains assets référencés dans le projet sont introuvables sur le disque (fichiers déplacés/supprimés).', 6000);
  }
  // Les fabriques d'assets réécrivent leur fichier sur disque à la création : pour un
  // asset qui VIENT du disque, cette écriture périmerait le `File` qu'on en lit ici.
  setAssetDiscoveryInProgress(true);
  let assetsById;
  try {
    assetsById = await rebuildAssetsFromDescriptors(descripteurs, async function(fileName, da){
      const filePath = 'assets/' + (da.folder ? da.folder + '/' : '') + fileName;
      const entry = tree.files.find(function(f){ return f.filePath === filePath; });
      if(!entry) throw new Error('Fichier manquant sur le disque : ' + filePath);
      return await entry.handle.getFile();
    });
  } finally { setAssetDiscoveryInProgress(false); }
  const tApresRebuild = performance.now();
  // AVANT le remappage, et pas après : c'est lui qui met les références mortes à null, donc
  // après son passage il n'y a plus rien à constater. Ce rapport ne dépend d'aucune table de
  // champs — il voit ce que le remappage ne sait pas voir.
  const nbDead = reportDeadReferences(scenes, assetsById);
  remapReferencesAssetsInScenes(scenes, assetsById);
  if(nbDead){
    setStatus(nbDead + " référence(s) d'asset perdue(s) dans ce projet — voir la console"
      + " (l'asset a été supprimé ou son fichier n'est plus là).", 8000);
  }
  if(decouverts.length){
    setStatus(decouverts.length + ' fichier(s) trouvé(s) dans le dossier et ajouté(s) au projet', 5000);
  }

  project.handleFolder = handle;
  project.name = manifest.name;
  project.folders = manifest.folders || [];
  // Les réglages de niveau projet, relus du manifeste. `??` et non `||` : `versionVisible:false`
  // est une VALEUR, pas une absence — un `||` la remonterait silencieusement à vrai.
  applyProjectSettings(manifest);
  project.scenes = scenes.length ? scenes : [{name:'Scène 1', data:null}];
  project.current = 0;
  updateScenes();

  const data = project.scenes[0].data;
  const tAvantRestore = performance.now();
  if(data) restoreState(data);
  else { select(null); updateHierarchy(); updateTimeline(); }
  const tApresRestore = performance.now();

  // Les dossiers du disque font foi au même titre que les fichiers : un sous-dossier de
  // assets/ créé hors de l'éditeur doit apparaître dans l'arbre, même vide.
  adoptFoldersOfDisk(tree);
  // Range dans son propre dossier tout modèle déjà présent qui embarque des clips — pas
  // seulement ceux importés après ce correctif. Après adoptFoldersOfDisk (dossiers du disque
  // déjà connus) et pendant que project.handleFolder est déjà posé (ligne plus haut) : c'est
  // ce qui permet le déplacement réel des fichiers, pas seulement en mémoire.
  organizeModelsInOwnFolders();
  // LA SURVEILLANCE PART D'ICI, et de l'arbre qu'on vient de lire : c'est la référence qui dit
  // « tout ceci est déjà dans le projet ». Démarrée sans elle, la première comparaison verrait
  // le projet entier comme des fichiers neufs et le redécouvrirait en double.
  startFolderWatch(tree);

  console.log(
    '[Hub] finalizeOpeningProjectFolder — ' + Math.round(performance.now() - t0) + ' ms au total\n'
    + '  découverte/déclaration assets : ' + Math.round(tAvantDescripteurs - t0) + ' ms (' + declares.length + ' déclarés + ' + decouverts.length + ' découverts)\n'
    + '  resolveAssetDescriptors (lecture disque des scripts/matériaux) : ' + Math.round(tApresDescripteurs - tAvantDescripteurs) + ' ms\n'
    + '  rebuildAssetsFromDescriptors (décodage textures/modèles/audio) : ' + Math.round(tApresRebuild - tApresDescripteurs) + ' ms (' + descripteurs.length + ' assets)\n'
    + '  remap + réglages projet + updateScenes : ' + Math.round(tAvantRestore - tApresRebuild) + ' ms\n'
    + '  restoreState (construction de la scène three) : ' + Math.round(tApresRestore - tAvantRestore) + ' ms'
  );
}

/**
 * Reprend sur `project` les réglages portés par une source relue — le manifeste d'un dossier ou
 * les données d'un `.p3d`.
 *
 * `projectSettingsOf` fait tout le travail : un champ absent reçoit son défaut, un champ présent
 * gagne même quand il vaut `false` ou `0`. C'est la même règle que les paliers de migration —
 * ne jamais écraser ce que l'utilisateur a réglé.
 */
export function applyProjectSettings(source){
  project.settings = projectSettingsOf(source);
  // LES LANGUES SUIVENT LE PROJET. Sans cet appel, l'apercu d'une interface de jeu dans
  // l'editeur montrerait les cles brutes alors que le jeu publie, lui, afficherait le texte
  // traduit : l'ecart ne se verrait qu'apres l'export. Voir js/locale.js.
  if(typeof setupLocales === 'function') setupLocales(project.settings.locales);
  // Le bloc entier est REMPLACÉ, donc l'accesseur `set name` n'est pas passé : c'est le second
  // point d'écriture du nom, et la barre du haut mentirait sans cet appel.
  if(typeof refreshProjectLabel === 'function') refreshProjectLabel();
  // LE MÉLANGE SUIT LE PROJET, comme les langues. Les bus de l'éditeur ont pu être créés pendant la
  // relecture des assets (un bruitage se calcule au chargement), donc avec les volumes du projet
  // PRÉCÉDENT ; ils gardaient aussi ses sourdines (revue du 2026-09-29, § 3.4). Et une boucle qui
  // tournait dans le rack s'arrête : elle appartient au projet qu'on quitte (§ 3.8).
  resetAudioMix();
  if(typeof stopSoundRackPlayback === 'function') stopSoundRackPlayback();
  // Le rack montre les bruitages et boucles du projet OUVERT, pas ceux du précédent.
  if(typeof refreshSoundRack === 'function') refreshSoundRack();
  // Les plugins rangés dans le projet (js/plugins.js). Pas avant le démarrage des plugins :
  // `loadPluginsAtStartup` s'en charge lui-même, après les plugins du navigateur.
  if(typeof loadProjectPlugins === 'function' && globalThis.pluginsState && globalThis.pluginsState.booted) loadProjectPlugins();
}

// Ajoute à project.dossiers les sous-dossiers de assets/ présents sur le disque et
// absents du manifeste. Sans ça, un dossier créé hors de l'éditeur n'apparaît dans
// l'arbre que s'il contient un fichier reconnu — et un dossier devenu VIDE (tous ses
// fichiers déplacés ailleurs) n'apparaissait jamais, même après un rafraîchissement :
// tree.folders (scanFolder) liste maintenant les dossiers eux-mêmes, pas seulement
// ceux qu'on peut déduire du chemin d'un fichier qu'ils contiennent.
export function adoptFoldersOfDisk(tree){
  if(!project.folders) project.folders = [];
  let ajout = 0;
  const chemins = new Set();
  for(const f of tree.files){
    if(f.filePath.indexOf('assets/') !== 0) continue;
    const segments = f.filePath.split('/').slice(1, -1);
    for(let i = 1; i <= segments.length; i++) chemins.add(segments.slice(0, i).join('/'));
  }
  for(const d of (tree.folders || [])){
    if(d.indexOf('assets/') !== 0) continue;
    const filePath = d.slice('assets/'.length);
    if(filePath) chemins.add(filePath);
  }
  for(const filePath of chemins){
    if(project.folders.indexOf(filePath) === -1){ project.folders.push(filePath); ajout++; }
  }
  if(ajout) updateProject();
}

// ---------- « Rafraîchir » et la SURVEILLANCE CONTINUE du dossier de projet ----------
//
// La File System Access API ne notifie AUCUN changement du disque : rien ne peut remplacer un
// re-scan. Le bouton « Rafraîchir » en déclenche un à la demande ; `folderWatch` en déclenche un
// périodiquement, et c'est tout ce qui les sépare — les deux passent par `pollFolder()`, puis par
// `applyDiskChanges()`. Un seul chemin de code, donc un seul comportement à comprendre.
//
// Ce qu'on ne fait PAS, et volontairement : recharger le projet. Le disque n'a autorité que sur
// `assets/`. La scène en cours d'édition, sa sélection et son historique vivent en mémoire et
// sont plus récents que `scenes/*.scene.json` — les relire écraserait le travail en cours.
//
// Les trois règles qui rendent le sondage sûr (écritures de l'éditeur ignorées, fichier en cours
// de copie retenu, disparition confirmée deux fois) vivent dans js/folder-watch.js, sans DOM ni
// disque, et sont mesurées par test/folder-watch.test.mjs.

export const folderWatch = {
  timer: null,
  running: false,
  /** L'état disque de référence : Map chemin -> signature. Vide = surveillance non démarrée. */
  baseline: new Map(),
  /** Les chemins vus changer une fois, en attente de confirmation. */
  pending: new Map(),
  intervalMs: WATCH_INTERVAL_MS,
  /** Dernier scan, en ms — c'est lui qui règle la cadence (voir intervalNext). */
  scanMs: 0,
  stopped: false,
  /** Signatures des fichiers de scène (voir changedScenes, folder-watch.js). */
  sceneBaseline: new Map()
};

/**
 * Une scène réécrite sur le disque HORS de l'éditeur (copilote, git, script).
 *
 * - Une scène qu'on n'affiche pas : sa version en mémoire est remplacée, sans risque — rien
 *   n'y est en cours d'édition.
 * - La scène affichée, sans modification non enregistrée : rechargée aussitôt. Garder
 *   l'ancienne, c'était jouer l'ancienne au lancement et l'écrire par-dessus la nouvelle au
 *   prochain Ctrl+S, sans un mot.
 * - La scène affichée AVEC des modifications non enregistrées : on ne choisit pas à la place
 *   de l'utilisateur — avertissement dans la Console, il rouvre ou enregistre en connaissance
 *   de cause.
 */
export async function applySceneChangesFromDisk(tree, names){
  const messages = [];
  for(const name of names){
    const i = project.scenes.findIndex(function(s){ return s.name === name; });
    if(i < 0) continue;
    let data;
    try { data = migrateSceneFile(await loadContentScene(tree, name)); }
    catch(e){ console.warn('[projet] scène « ' + name + ' » illisible sur le disque :', e); continue; }
    if(!data) continue;
    if(i !== project.current){
      project.scenes[i].data = data;
      messages.push('scène « ' + name + ' » relue');
      continue;
    }
    if(projectSave.unsaved){
      const msg = 'La scène « ' + name + ' » a été modifiée sur le disque, mais vous avez des '
        + 'modifications non enregistrées : elle n\'a PAS été rechargée. Enregistrer écrasera la '
        + 'version du disque ; rouvrir le projet la chargera.';
      // Par la globale : importer console.js ici tire scripts.js, selection.js… dans le cycle
      // de project.js et casse l'ordre d'évaluation au démarrage (KNOWN_ISSUES, v0.178.1).
      if(typeof globalThis.logConsole === 'function') globalThis.logConsole('warn', msg, null);
      setStatus(msg, 10000);
      continue;
    }
    project.scenes[i].data = data;
    histo.undo.length = 0;
    histo.redo.length = 0;
    restoreState(data);
    markProjectSaved();
    messages.push('scène « ' + name + ' » rechargée depuis le disque');
  }
  return messages;
}

export function folderWatchEnabled(){
  return Prefs.get('folderWatch.enabled') !== false;
}

/** L'arbre amputé des chemins encore instables : ce que la découverte a le droit de voir. */
export function treeStable(tree, pending){
  if(!pending || !pending.size) return tree;
  return {files: tree.files.filter(function(f){ return !pending.has(f.filePath); }),
          folders: tree.folders};
}

/** L'asset EN MÉMOIRE qui possède chaque chemin disque, avec son descripteur. */
export function assetsByDiskPath(){
  const out = new Map();
  for(const d of diskAssetManifest().assets){
    const prefixe = 'assets/' + (d.folder ? d.folder + '/' : '');
    const a = assets.find(function(x){ return x.id === d.id; });
    if(!a) continue;
    for(const f of (d.files || [])) out.set(prefixe + f, {asset: a, descriptor: d, file: f});
    if(d.file) out.set(prefixe + d.file, {asset: a, descriptor: d, file: d.file});
  }
  return out;
}

/**
 * Adopte les fichiers de `assets/` que le projet ne revendique pas encore.
 *
 * Exactement le chemin de l'ouverture d'un projet (découverte → résolution → reconstruction) :
 * un fichier posé à la main entre dans le projet de la même façon qu'un fichier déclaré, avec
 * son identité s'il a un `.meta`. Rend le nombre de fichiers adoptés.
 */
export async function adoptNewAssets(tree){
  // diskAssetManifest() calcule le chemin disque de CHAQUE asset en mémoire, y compris ceux
  // dont le nom de fichier n'existe qu'au moment de l'écriture (scripts, matériaux, graphes de
  // shader). C'est la seule liste fiable de ce qui est déjà connu.
  const dejaConnus = diskAssetManifest().assets;
  const metas = await readMetas(tree);
  const decouverts = discoverFolderAssets(tree, dejaConnus, metas);
  if(!decouverts.length) return 0;
  const descripteurs = await resolveAssetDescriptors(decouverts, tree);
  // Les fabriques d'assets réécrivent leur fichier sur disque à la création : pour un asset
  // qui VIENT du disque, cette écriture périmerait le `File` qu'on en lit ici.
  setAssetDiscoveryInProgress(true);
  try {
    await rebuildAssetsFromDescriptors(descripteurs, async function(fileName, da){
      const filePath = 'assets/' + (da.folder ? da.folder + '/' : '') + fileName;
      const entry = tree.files.find(function(f){ return f.filePath === filePath; });
      if(!entry) throw new Error('Fichier manquant sur le disque : ' + filePath);
      return await entry.handle.getFile();
    });
  } finally { setAssetDiscoveryInProgress(false); }
  return decouverts.length;
}

// Les champs de contenu que `resolveAssetDescriptors` sait relire depuis un fichier texte. Le
// rechargement à chaud les reprend tels quels : c'est la MÊME lecture qu'à l'ouverture du
// projet, donc aucune seconde interprétation du format à maintenir ici.
// `recipe` (bruitage, boucle) et `preset` y manquaient : le fichier modifié hors de l'éditeur était
// « rechargé » sans effet, puis réécrit par l'ancienne version au Ctrl+S suivant (revue du
// 2026-09-29, § 1.3).
export const FIELDS_CONTENT_ASSET = ['code', 'props', 'effects', 'machine', 'anim', 'sprite',
  'palette', 'html', 'css', 'text', 'target', 'nodes', 'links', 'outputs', 'properties', 'layout',
  'recipe', 'preset'];

/**
 * Relit sur le disque le contenu d'un asset DÉJÀ dans le projet, en place.
 *
 * « En place » est tout l'enjeu : l'asset garde son id, donc toutes les références des scènes
 * restent valides. Recréer l'asset (ce que ferait un simple ré-import) lui donnerait un id neuf
 * et viderait la scène de ses matériaux, scripts et textures d'un coup.
 */
export async function hotReloadAsset(a, d, tree, filePath){
  const entry = tree.files.find(function(f){ return f.filePath === filePath; });
  if(!entry) return false;
  const file = await entry.handle.getFile();

  if(a.kind === 'texture'){
    // replaceContentAssetTexture réécrit normalement le fichier sur le disque — ce qui, ici,
    // réécrirait par-dessus ce que l'utilisateur vient d'y poser ET périmerait le `File` qu'on
    // vient d'en lire. Le drapeau de découverte est exactement la garde prévue pour ça.
    setAssetDiscoveryInProgress(true);
    try { replaceContentAssetTexture(a, file); }
    finally { setAssetDiscoveryInProgress(false); }
    return true;
  }
  if(a.kind === 'audio'){
    a.file = file;
    await decodeAssetAudio(a);
    updateProject();
    return true;
  }
  if(a.kind === 'model'){
    // UN MODÈLE NE SE RECHARGE PAS EN PLACE, et prétendre le contraire serait pire que ne rien
    // faire : ses nœuds sont instanciés dans la scène, portent des composants, des matériaux et
    // des références d'animation posés par l'utilisateur. Remplacer le sous-arbre les perdrait
    // sans retour. On le signale, la réouverture du projet fait le reste.
    setStatus('Le modèle « ' + a.name + ' » a changé sur le disque — rouvrez le projet pour le recharger.', 7000);
    return false;
  }

  if(a.kind === 'prefab'){
    // Même raison que le modèle : le gabarit est un sous-arbre vivant, dont les instances de la
    // scène sont liées. Le remplacer en place perdrait ce qui les relie ; la réouverture du
    // projet relit le fichier proprement. Le dire, plutôt que d'ignorer le changement puis de
    // l'écraser au prochain Ctrl+S.
    setStatus('Le prefab « ' + a.name + ' » a changé sur le disque — rouvrez le projet pour le recharger.', 7000);
    return false;
  }

  // Genres texte : une seule et même lecture que celle de l'ouverture du projet.
  const resolus = await resolveAssetDescriptors([d], tree);
  if(!resolus.length) return false;
  const r = resolus[0];
  // Animation et planche de sprites gardent leur contenu À PLAT sur l'asset : le fichier relu
  // arrive dans `r.anim` / `r.sprite`, et le recopier tel quel n'aurait rien changé (voir
  // animationFieldsOf, serialization.js).
  if(a.kind === 'animation' && r.anim){
    Object.assign(a, animationFieldsOf(r.anim));
    a.rev = (a.rev || 0) + 1;
  } else if(a.kind === 'sprite' && r.sprite){
    Object.assign(a, spriteFieldsOf(r.sprite));
    refreshSpritesOfLAsset(a);
  } else {
    FIELDS_CONTENT_ASSET.forEach(function(k){ if(r[k] !== undefined) a[k] = r[k]; });
  }

  // Puis ce que ce contenu change ailleurs. Sans ces rappels, le fichier est bien relu mais
  // rien ne bouge à l'écran — le pire des deux mondes.
  if(a.kind === 'script'){
    // Le cache de compilation n'a rien à purger : compiledOf compare le code à chaque image.
    // Les `@expose`, elles, sont reparsées ici, sinon l'inspecteur montre d'anciennes variables.
    holdersOfScriptAsset(a.id).forEach(function(o){ mergeVarsDeclared(o, a.code); });
  }
  if(a.kind === 'material'){
    applyMaterialEverywhere(a);
  }
  if(a.kind === 'graphShader'){
    assets.filter(function(m){ return m.kind === 'material' && m.shaderId === a.id; })
      .forEach(function(m){ applyMaterialEverywhere(m); });
  }
  if(a.kind === 'animation') forgetClipCompiled(a.id);
  // Un son calculé se RECALCULE depuis sa nouvelle recette, et le rack la montre.
  if(a.kind === 'sfx') renderAssetSfx(a);
  if(a.kind === 'musicLoop') renderAssetLoop(a);
  if((a.kind === 'sfx' || a.kind === 'musicLoop') && typeof refreshSoundRack === 'function') refreshSoundRack();
  if(a.kind === 'tilePalette'){
    invalidateTilemapsOfPalette(a.id);
  }
  updateProject();
  return true;
}

/**
 * Un fichier RENOMMÉ ou DÉPLACÉ hors de l'éditeur arrive ici comme une disparition suivie d'une
 * apparition. Traité tel quel, l'asset serait supprimé du projet (avec ses références) puis
 * recréé — c'est un geste courant, et le plus coûteux à mal traiter.
 *
 * On le reconnaît par la carte d'identité : le `.meta` arrivé au nouvel emplacement porte l'id
 * de l'asset disparu. On se contente alors de déplacer le descripteur, comme le fait
 * `relocateAssetsByMeta` à l'ouverture, et les deux chemins sortent des listes.
 */
export async function relocateFromChanges(tree, changes, byPath){
  if(!changes.removed.length || !changes.added.length) return [];
  const metas = await readMetas(tree);
  const reloges = [];
  for(let i = changes.removed.length - 1; i >= 0; i--){
    const before = changes.removed[i];
    const owner = byPath.get(before);
    if(!owner) continue;
    const after = changes.added.find(function(p){
      const m = metas.get(p);
      return m && m.id === owner.asset.id;
    });
    if(!after) continue;
    const segments = after.split('/');
    const fileName = segments.pop();
    owner.asset.folder = segments.slice(1).join('/');
    // Le nom de fichier d'une texture ou d'un son EST celui de son `File` : sans le relire, le
    // projet réécrirait l'ancien nom au prochain enregistrement, et le fichier renommé
    // repasserait pour un inconnu au sondage suivant.
    const entry = tree.files.find(function(f){ return f.filePath === after; });
    if(entry && (owner.asset.kind === 'texture' || owner.asset.kind === 'audio')){
      owner.asset.file = await entry.handle.getFile();
    }
    changes.removed.splice(i, 1);
    changes.added.splice(changes.added.indexOf(after), 1);
    reloges.push({name: owner.asset.name, before: before, after: after});
  }
  if(reloges.length) updateProject();
  return reloges;
}

/** Retire du projet les assets dont TOUS les fichiers ont disparu du disque. */
export function applyRemovals(paths, byPath, tree){
  const presents = new Set(tree.files.map(function(f){ return f.filePath; }));
  const candidats = [];
  for(const filePath of paths){
    const owner = byPath.get(filePath);
    if(!owner || candidats.indexOf(owner.asset) !== -1) continue;
    const prefixe = 'assets/' + (owner.descriptor.folder ? owner.descriptor.folder + '/' : '');
    const files = owner.descriptor.files || (owner.descriptor.file ? [owner.descriptor.file] : []);
    // Un modèle est un PAQUET (gltf + bin + textures) : perdre une de ses textures ne fait pas
    // disparaître l'asset. On ne retire que ce dont il ne reste rien.
    if(files.some(function(f){ return presents.has(prefixe + f); })) continue;
    candidats.push(owner.asset);
  }
  if(!candidats.length) return [];
  // UN PAS D'HISTORIQUE AVANT DE RETIRER, comme la croix du panneau Projet : la liste des assets
  // fait partie de l'instantané, donc Ctrl+Z reste la sortie si la disparition était un accident
  // (un outil externe, une synchro cloud). Le fichier, lui, est déjà parti — on ne l'efface pas.
  pushHistory();
  const names = [];
  for(const a of candidats){
    const holders = removeAssetInMemory(a);
    names.push(a.name + (holders.length ? ' (' + holders.length + ' objet(s) sans script)' : ''));
  }
  return names;
}

/** Applique un diff déjà classé. Ordre imposé : relogements, suppressions, modifications, ajouts. */
export async function applyDiskChanges(tree, changes){
  const visible = treeStable(tree, changes.pending);
  const byPath = assetsByDiskPath();
  const messages = [];

  const reloges = await relocateFromChanges(visible, changes, byPath);
  if(reloges.length){
    console.log('[projet] ' + reloges.length + ' asset(s) suivi(s) a leur nouvel emplacement :\n'
      + reloges.map(function(r){ return '  • ' + r.name + ' : ' + r.before + ' → ' + r.after; }).join('\n'));
    messages.push(reloges.length + ' asset(s) déplacé(s)');
  }

  if(changes.removed.length){
    const names = applyRemovals(changes.removed, byPath, visible);
    if(names.length) messages.push(names.length + ' asset(s) retiré(s) : ' + names.join(', '));
  }

  let nbModifies = 0;
  for(const filePath of changes.modified){
    const owner = byPath.get(filePath);
    if(!owner) continue;   // fichier connu du disque mais d'aucun asset (compagnon d'un modèle)
    try {
      if(await hotReloadAsset(owner.asset, owner.descriptor, visible, filePath)) nbModifies++;
    } catch(e){
      console.warn('[projet] rechargement de « ' + owner.asset.name + ' » impossible : ' + e.message);
    }
  }
  if(nbModifies) messages.push(nbModifies + ' asset(s) rechargé(s)');

  if(changes.added.length){
    // Les dossiers du disque font foi au même titre que les fichiers : un sous-dossier créé hors
    // de l'éditeur doit apparaître dans l'arbre, même vide.
    adoptFoldersOfDisk(visible);
    const n = await adoptNewAssets(visible);
    if(n) messages.push(n + ' fichier(s) ajouté(s)');
  }

  return messages;
}

/**
 * Oublie l'empreinte d'écriture de tout chemin qui a bougé HORS de l'éditeur.
 *
 * Sans ça, l'enregistrement incrémental (js/write-cache.js) sauterait un fichier que
 * l'utilisateur vient de modifier à la main — l'éditeur croyant y avoir déjà mis ce contenu, sa
 * version resterait sur le disque, et rien ne le dirait.
 *
 * Il ne se contente PAS des listes `modified`/`removed` du classement : celles-ci sont filtrées
 * (un `.meta` est suivi mais jamais annoncé, les chemins en attente de stabilité ne sont pas
 * encore là). On compare donc les signatures brutes — la même source que le classement, sans
 * son filtre. `ours` est exclu : ce sont NOS écritures, dont l'empreinte est justement juste.
 */
export function invalidateWritesOfDisk(baseline, current, ours){
  for(const [filePath, sig] of current){
    if(baseline.get(filePath) === sig || (ours && ours.has(filePath))) continue;
    invalidateWrite(filePath);
  }
  for(const filePath of baseline.keys()){
    if(current.has(filePath) || (ours && ours.has(filePath))) continue;
    invalidateWrite(filePath);
  }
}

/**
 * Un sondage : scan, classement, application.
 *
 * `force` (le bouton « Rafraîchir ») relâche la règle d'attente : l'utilisateur vient de demander
 * l'état du disque MAINTENANT, on ne lui fait pas attendre un second sondage. C'est obtenu en
 * repassant le classement sur lui-même, donc sans seconde implémentation des règles.
 */
export async function pollFolder(force){
  if(!project.handleFolder || folderWatch.running) return null;
  folderWatch.running = true;
  const tDebut = Date.now();
  const t0 = chronoMs();
  try {
    const tree = await scanFolder(project.handleFolder);
    folderWatch.scanMs = chronoMs() - t0;
    const ours = takeDiskWritesOurs(tDebut);
    const current = signatureTree(tree);
    const baselineBefore = folderWatch.baseline;
    let res = classifyChanges(folderWatch.baseline, current, {ours: ours, pending: folderWatch.pending});
    if(force) res = classifyChanges(folderWatch.baseline, current, {ours: ours, pending: res.pending});
    folderWatch.baseline = res.baseline;
    folderWatch.pending = res.pending;
    invalidateWritesOfDisk(baselineBefore, current, ours);
    folderWatch.intervalMs = intervalNext(folderWatch.scanMs);
    const scenesNow = sceneSignatures(tree);
    const scenesChanged = changedScenes(folderWatch.sceneBaseline, scenesNow, ours);
    folderWatch.sceneBaseline = scenesNow;
    const sceneMessages = scenesChanged.length ? await applySceneChangesFromDisk(tree, scenesChanged) : [];
    if(!res.added.length && !res.modified.length && !res.removed.length){
      if(sceneMessages.length) setStatus('Dossier : ' + sceneMessages.join(' · '), 5000);
      return sceneMessages;
    }
    const messages = sceneMessages.concat(await applyDiskChanges(tree, res));
    if(messages.length) setStatus('Dossier : ' + messages.join(' · '), 5000);
    return messages;
  } finally { folderWatch.running = false; }
}

export function scheduleFolderWatch(delayMs){
  clearTimeout(folderWatch.timer);
  if(folderWatch.stopped) return;
  folderWatch.timer = setTimeout(runFolderWatch, delayMs || folderWatch.intervalMs);
}

export async function runFolderWatch(){
  if(!project.handleFolder || folderWatch.stopped) return;
  // Onglet caché : rien à montrer, et un scan de fond coûte au disque de l'utilisateur pour rien.
  const pause = folderWatch.running
    || (typeof document !== 'undefined' && document.hidden) || !folderWatchEnabled();
  if(!pause){
    try { await pollFolder(false); }
    catch(e){
      if(ERRORS_PERMISSION.has(e.name)){
        // La permission sur le dossier se perd (onglet rouvert, autorisation révoquée). Insister
        // toutes les deux secondes ne la rendra pas : on arrête et on le dit une fois.
        folderWatch.stopped = true;
        setStatus('Accès au dossier perdu — la synchronisation automatique est arrêtée. '
          + 'Utilisez « Rafraîchir » pour réautoriser.', 8000);
        return;
      }
      console.warn('[projet] surveillance du dossier :', e);
    }
  }
  scheduleFolderWatch();
}

/**
 * Démarre la surveillance sur le dossier qu'on vient d'ouvrir.
 *
 * La référence de départ est l'arbre lu à l'ouverture : sans elle, le premier sondage verrait
 * TOUT le projet comme des ajouts et le redécouvrirait en double.
 */
export function startFolderWatch(tree){
  // Les empreintes d'écriture appartiennent au dossier pour lequel elles ont été prises : un
  // AUTRE projet réutiliserait des « déjà à jour » qui ne parlent pas de ses fichiers.
  resetWriteCache();
  folderWatch.baseline = tree ? signatureTree(tree) : new Map();
  folderWatch.sceneBaseline = tree ? sceneSignatures(tree) : new Map();
  folderWatch.pending = new Map();
  folderWatch.intervalMs = WATCH_INTERVAL_MS;
  folderWatch.stopped = false;
  scheduleFolderWatch();
}

export function stopFolderWatch(){
  folderWatch.stopped = true;
  clearTimeout(folderWatch.timer);
}

// Le retour sur l'onglet est le moment où l'utilisateur REGARDE : c'est là qu'un fichier déposé
// pendant qu'il était ailleurs doit apparaître, pas à la fin de l'intervalle en cours.
if(typeof document !== 'undefined' && document.addEventListener){
  document.addEventListener('visibilitychange', function(){
    if(!document.hidden && project.handleFolder && !folderWatch.stopped) scheduleFolderWatch(200);
  });
}

export async function refreshFolderProject(){
  if(!project.handleFolder){
    setStatus('Aucun dossier de projet ouvert — utilisez « Ouvrir un dossier de projet… ».', 4000);
    return;
  }
  try {
    // Un « Rafraîchir » manuel rend aussi son droit à une surveillance arrêtée par une perte de
    // permission : le scan qui suit redemande l'accès, et s'il passe, la boucle repart.
    folderWatch.stopped = false;
    const messages = await pollFolder(true);
    if(messages && !messages.length) setStatus('Dossier à jour — aucun changement.', 3000);
    scheduleFolderWatch();
  } catch(e){
    setStatus('Rafraîchissement impossible : ' + e.message, 6000);
  }
}
export const btnRefreshFolder = document.getElementById('btn-refresh-folder');
if(btnRefreshFolder) btnRefreshFolder.addEventListener('click', function(){ refreshFolderProject(); });

export async function createFolderProject(){
  let handle;
  try {
    handle = await openFolderProject();
  } catch(e){
    // AbortError : l'utilisateur a annulé le sélecteur de dossier — pas une erreur à afficher.
    if(e.name !== 'AbortError') setStatus('Erreur : ' + e.message, 5000);
    return;
  }

  let manifestExiste = true;
  try { await handle.getFileHandle('project.json'); }
  catch(e){
    // Seule l'absence du fichier justifie de créer un projet.json minimal ;
    // une autre error (permission...) ne doit pas écraser un projet existant.
    if(e.name !== 'NotFoundError'){ setStatus('Erreur : ' + e.message, 5000); return; }
    manifestExiste = false;
  }

  if(!manifestExiste){
    const flux = await (await handle.getFileHandle('project.json', {create:true})).createWritable();
    await flux.write(JSON.stringify({ name: handle.name, version: 1, folders: [], scenes: [] }, null, 2));
    await flux.close();
  }

  let result;
  try {
    result = await loadProjectFromFolder(handle, idSessionEditor);
  } catch(e){
    setStatus('Erreur lors du chargement du projet : ' + e.message, 6000);
    return;
  }
  if(result.warningLock){
    setStatus('⚠ Ce dossier semble déjà ouvert dans un autre onglet.', 5000);
  }

  await finalizeOpeningProjectFolder(handle, result);
  try { await registerProjectRecent(handle); }
  catch(e){ console.warn('Impossible d\'enregistrer le projet récent :', e); }
  setStatus('Dossier de projet ouvert : ' + handle.name, 2000);
}

// ---------- Prise en charge d'un projet créé depuis le Hub (moteur/hub.html) ----------
//
// Le Hub crée le dossier et son project.json minimal, mais ne pose jamais le CONTENU d'un
// template : createSceneNode/addComponent/ensureGame n'existent que dans l'éditeur (voir
// js/hub/template-fps.js). Il se contente donc de déposer deux clés dans sessionStorage puis
// de rediriger ici — c'est cette fonction qui termine le travail, une fois le moteur chargé.
//
// sessionStorage et non localStorage : la remise à zéro à la lecture (`removeItem`) doit se
// produire une seule fois, pas survivre à un onglet qu'on recharge par erreur.
export async function autoOpenPendingHubProject(){
  const name = sessionStorage.getItem('hubPendingProjectName');
  if(!name) return;
  sessionStorage.removeItem('hubPendingProjectName');
  const templateId = sessionStorage.getItem('hubPendingTemplate');
  sessionStorage.removeItem('hubPendingTemplate');

  // L'overlay (posé en JS synchrone dans <head> d'editor.html, avant le premier <script defer>)
  // couvre TOUT ce bloc — scan du dossier, reconstruction des assets, application du template —
  // qui peut prendre plusieurs secondes sur un gros projet. `finally` : il doit se refermer même
  // si une erreur interrompt l'ouverture, sinon l'éditeur reste caché derrière lui pour toujours.
  try {
    let entry;
    try {
      const recents = await listProjectsRecents();
      entry = recents.find(function(r){ return r.name === name; });
    } catch(e){ setStatus('Erreur : ' + e.message, 5000); return; }
    if(!entry){
      setStatus('Projet introuvable dans les projets récents : ' + name, 6000);
      return;
    }

    let handle, result;
    try {
      handle = await openProjectRecent(entry);
      result = await loadProjectFromFolder(handle, idSessionEditor);
    } catch(e){
      setStatus('Erreur à l\'ouverture du projet créé depuis le Hub : ' + e.message, 6000);
      return;
    }
    await finalizeOpeningProjectFolder(handle, result);

    // Le template n'est appliqué QUE si le registre le connaît ET qu'il a un comportement
    // attaché — un id inconnu ou un placeholder (voir
    // hub-templates.js) laisse simplement le projet vide, sans erreur.
    if(templateId && typeof HubTemplates !== 'undefined'){
      const tpl = HubTemplates.get(templateId);
      if(tpl && tpl.applyInEditor){
        pushHistory();
        await tpl.applyInEditor();
        try { await registerInProjectOpen(); }
        catch(e){ setStatus('Projet créé, mais l\'enregistrement du template a échoué : ' + e.message, 6000); return; }
      }
    }
    setStatus('Projet ouvert : ' + handle.name, 2500);
  } finally {
    if(typeof window.hideHubLoadingOverlay === 'function') window.hideHubLoadingOverlay();
  }
}


// EXPOSÉ EN GLOBALE, à dessein. Ces symboles sont appelés depuis des fichiers
// que les mêmes pages ne chargent pas toutes : un `import` y pointerait un
// fichier absent, et la page ne démarrerait pas. Ils gardent donc leur garde
// `typeof` côté appelant, et se déclarent ici.
globalThis.changeScene = changeScene;
globalThis.project = project;

// ---------- Ouverture d'un projet HEBERGE ----------
// L'editeur est servi par le cloud sur /editeur/ : meme origine, donc le cookie de session
// suffit et il n'y a pas de CORS. L'identifiant arrive par /editeur/?projet=<id>.
//
// Rien ici ne reimplemente le chargement : `openCloudProject` fabrique un ARBRE VIRTUEL de la
// forme rendue par scanFolder(), donc loadManifestFromTree, loadContentScene et les migrations
// PAR FICHIER s'appliquent telles quelles. Un projet heberge et un projet dossier suivent le
// meme chemin — c'est ce qui evite qu'ils divergent en silence.
//
// Sans `?projet=`, cette fonction rend false sans rien faire : l'editeur ouvert directement
// depuis un fichier n'a aucune dependance au cloud.
/**
 * Ouvre un projet HEBERGE encore au format archive, pour le convertir.
 *
 * La conversion n'est pas une transformation cote serveur : le serveur ne sait pas lire un
 * `.p3d` — c'est un ZIP dont la structure n'a de sens que pour l'editeur, et l'interpreter en
 * double la-bas serait un second format a tenir d'accord. On fait donc le trajet naturel :
 * l'editeur ouvre l'archive comme il ouvre n'importe quel `.p3d`, puis enregistre un arbre.
 *
 * `manifest: {}` est ce qui rend l'enregistrement COMPLET : aucune scene n'ayant de fichier
 * dans un manifeste vide, `registerInCloudProject()` les ecrit toutes. Sans cette regle, la
 * conversion ne garderait que la scene affichee et perdrait les autres en silence.
 *
 * RIEN N'EST ECRIT ICI. Tant que l'utilisateur n'enregistre pas, le projet reste une archive
 * cote serveur : ouvrir pour regarder ne doit convertir personne.
 */
async function openCloudArchiveToConvert(id, api){
  setStatus('Projet au format archive — lecture…', 4000);
  const bytes = await api.readArchive(id);
  // `loadScene` prend ce qui sait rendre un arrayBuffer : c'est le MEME chemin que l'ouverture
  // d'un `.p3d` depuis le disque, migrations comprises. Un second chemin de lecture serait un
  // second endroit ou un vieux projet peut cesser de s'ouvrir.
  await loadScene(new Blob([bytes]));
  // APRES le chargement : `loadDataProject()` reconstruit `project`, et un marqueur pose avant
  // serait efface.
  project.cloud = { id, versionId: null, manifest: {}, api };
  initSceneLock(project.cloud, project.scenes[project.current].name);
  setStatus('Projet ouvert depuis son archive. Enregistrez pour le convertir en projet '
    + "editable en ligne — tant que vous ne le faites pas, rien n'est modifie cote serveur.", 12000);
  return true;
}

/**
 * Ouvre un projet HEBERGE qui n'a encore aucune version : on garde la scene de depart de
 * l'editeur et on se LIE au projet. `manifest: {}` et `versionId: null` font du premier
 * enregistrement un arbre complet, sans base — le serveur l'accepte tel quel.
 */
function openEmptyCloudProject(id, api, name){
  if(name) project.name = name;
  project.cloud = { id, versionId: null, manifest: {}, api };
  initSceneLock(project.cloud, project.scenes[project.current].name);
  setStatus('Projet hébergé vide ouvert — enregistrez pour écrire sa première version.', 5000);
  return true;
}

export async function openCloudProjectFromUrl(){
  const id = cloudProjectIdFromUrl(location.search);
  if(!id) return false;
  try {
    const api = cloudApi('');
    let opened;
    try {
      opened = await openCloudProject(id, api);
    } catch(e){
      // UN PROJET PAS ENCORE CONVERTI n'est pas une panne : c'est un projet enregistre avant
      // le format arborescent, donc un `.p3d` depose tel quel. On l'ouvre, et le premier
      // enregistrement ecrira un arbre. Sans ce chemin, tous les projets anterieurs restaient
      // definitivement inouvrables en ligne, avec un message qui parlait de « genre ».
      if(e && e.statut === 409 && e.details && e.details.code === 'archive'){
        return await openCloudArchiveToConvert(id, api);
      }
      // UN PROJET NEUF, cree depuis le site, n'a encore aucune version. On le traitait comme
      // une panne : `project.cloud` repassait a null, et l'enregistrement suivant ne savait plus
      // ou ecrire (« Aucun dossier de projet ouvert ») alors que l'URL portait le bon projet.
      if(e && e.statut === 404 && e.details && e.details.code === 'empty'){
        return openEmptyCloudProject(id, api, e.details.name);
      }
      throw e;
    }
    const manifest = migrateManifestFolder(await loadManifestFromTree(opened.tree));
    const listScenes = (manifest.scenes && manifest.scenes.length) ? manifest.scenes : [{name: 'Scène 1'}];
    const scenes = [];
    for(const sc of listScenes){
      scenes.push({ name: sc.name, data: migrateSceneFile(await loadContentScene(opened.tree, sc.name)) });
    }
    // Pose AVANT finalize : c'est ce marqueur qui fait aiguiller l'enregistrement vers le cloud
    // (serialization.js:registerInProjectOpen), et l'autosave peut partir des la fin du chargement.
    project.cloud = { id, versionId: opened.versionId, manifest: opened.manifest, api };
    // handle null : un projet heberge n'a pas de dossier. project.handleFolder reste donc vide,
    // et la surveillance de dossier — qui s'en garde deja — ne demarre pas.
    await finalizeOpeningProjectFolder(null, { manifest, scenes, tree: opened.tree, handle: null, warningLock: false });
    // Le verrou s'arme APRES l'ouverture : le chargement lui-meme n'est pas une modification,
    // et personne ne doit bloquer une scene qu'il se contente d'ouvrir.
    initSceneLock(project.cloud, project.scenes[project.current].name);
    setStatus('Projet hébergé ouvert — version ' + opened.versionId, 3000);
    return true;
  } catch(e){
    project.cloud = null;
    setStatus("Impossible d'ouvrir le projet hébergé : " + e.message, 8000);
    return false;
  }
}
