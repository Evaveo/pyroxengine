// ---------- Scan récursif d'un dossier project (File System Access API) ----------
// Fichier complet pour le plan de conversion vers un projet sur disque (tâches
// 2-6 et 10) : scanFolder, loadManifestFromTree, diffTrees,
// checkLock, openFolderProject, loadContentScene,
// loadProjectFromFolder, writeFileInFolder, registerInFolder
// et createFolderEmptyOnDisk sont toutes implémentées ci-dessous.

// `performance` n'existe pas dans tous les contextes qui chargent ce fichier — notamment
// test/dossierProjet.test.mjs, qui l'exécute dans un vm.createContext({}) nu, sans DOM. Ce
// fichier n'a par ailleurs AUCUNE autre dépendance navigateur (voir l'en-tête plus haut) :
// un repli sur Date.now() (moins précis, suffisant pour un diagnostic en millisecondes) évite
// d'en introduire une pour la seule mesure de temps.
import { validateNameFile } from './file-names.js';

export function chronoMs(){
  return (typeof performance !== 'undefined') ? performance.now() : Date.now();
}

// Parcourt récursivement un FileSystemDirectoryHandle (ou un faux handle
// compatible utilisé dans les tests) et retourne la liste plate des fichiers
// trouvés, avec leur chemin relatif (séparé par '/'), leur handle, leur taille
// et leur date de dernière modification (utiles pour comparer lors d'un re-scan),
// ainsi que la liste plate des DOSSIERS rencontrés (`folders`), fichiers ou non.
// Sans `folders`, un dossier vide (ou dont tous les fichiers ont été déplacés
// ailleurs) est indétectable : il ne laisse aucune trace dans `files`, et
// adoptFoldersOfDisk() — qui n'infère les dossiers QUE depuis les chemins de
// fichiers — ne peut jamais le faire réapparaître dans l'arbre de l'éditeur,
// même après un « Rafraîchir » ou une réouverture complète du projet.
export async function scanFolder(root, prefixe = ''){
  const files = [];
  const folders = [];
  for await (const [name, entry] of root.entries()){
    const filePath = prefixe ? prefixe + '/' + name : name;
    if(entry.kind === 'directory'){
      folders.push(filePath);
      const sous = await scanFolder(entry, filePath);
      files.push(...sous.files);
      folders.push(...sous.folders);
    } else {
      const f = await entry.getFile();
      files.push({ filePath, handle: entry, size: f.size, lastModif: f.lastModified });
    }
  }
  return { files, folders };
}

// Charge et parse le manifeste project.json à partir d'un arbre déjà scanné
// (retourné par scanFolder). Lève une erreur explicite si le dossier
// scanné ne contient pas de projet.json — ce n'est alors pas un dossier
// project valide.
export async function loadManifestFromTree(tree){
  // `projet.json` est accepté en repli : c'est le nom que portaient les archives `.p3d` avant
  // l'unification, et sans ce repli un `.p3d` simplement dézippé se faisait refuser d'un « ce n'est
  // pas un projet valide » — alors que tout son contenu était là, au nom du manifeste près.
  const entry = tree.files.find(f => f.filePath === 'project.json')
              || tree.files.find(f => f.filePath === 'projet.json');
  if(!entry) throw new Error('project.json introuvable dans ce dossier — ce n\'est pas un projet valide.');
  const f = await entry.handle.getFile();
  return JSON.parse(await f.text());
}

// Compare deux arbres (avant/après re-scan) et retourne les chemins des
// fichiers ajoutés, modifiés (taille ou date de dernière modif différente)
// et supprimés, pour permettre un rafraîchissement incrémental.
export function diffTrees(avant, apres){
  const byFilePath = new Map(avant.files.map(f => [f.filePath, f]));
  const vus = new Set();
  const ajoutes = [], modifies = [];
  for(const f of apres.files){
    vus.add(f.filePath);
    const old = byFilePath.get(f.filePath);
    if(!old) ajoutes.push(f.filePath);
    else if(old.size !== f.size || old.lastModif !== f.lastModif) modifies.push(f.filePath);
  }
  const supprimes = avant.files.filter(f => !vus.has(f.filePath)).map(f => f.filePath);
  return { ajoutes, modifies, supprimes };
}

// Verrou multi-tab : dépose un fichier marker .editeur-lock.json à la
// racine du dossier project pour signaler qu'une session l'a open. Ce n'est
// pas un verrou strict (l'API File System Access ne l'offre pas) : on se
// contente d'warn si un autre tab/session semble avoir ce dossier ouvert
// récemment. On écrit systématiquement notre propre marker pour que les
// autres onglets nous détectent à leur tour.
export const LOCK_NAME = '.editeur-lock.json';
export const LOCK_EXPIRY_MS = 10 * 60 * 1000; // 10 min : au-delà, considéré périmé (tab fermé sans nettoyage)

export async function checkLock(root, idSession){
  let dejaOpenAilleurs = false;
  try {
    const handle = await root.getFileHandle(LOCK_NAME);
    const f = await handle.getFile();
    const data = JSON.parse(await f.text());
    const age = Date.now() - data.horodatage;
    if(data.session !== idSession && age < LOCK_EXPIRY_MS) dejaOpenAilleurs = true;
  } catch(e){
    // Seule l'absence du fichier (pas encore de verrou posé) est un cas normal.
    // Une autre error (permission, JSON corrompu...) ne doit pas être avalée
    // silencieusement : on ne peut alors pas garantir l'absence de verrou.
    if(e.name !== 'NotFoundError') throw e;
  }

  const handleEcriture = await root.getFileHandle(LOCK_NAME, { create: true });
  const flux = await handleEcriture.createWritable();
  await flux.write(JSON.stringify({ session: idSession, horodatage: Date.now() }));
  await flux.close();

  return { dejaOpenAilleurs };
}

// Ouvre un sélecteur de dossier natif (File System Access API). Ne fonctionne
// que dans un navigateur (Chrome/Edge) ; non testable par noeud:test.
export async function openFolderProject(){
  if(!window.showDirectoryPicker){
    throw new Error('Votre navigateur ne supporte pas l\'ouverture de dossier. Utilisez Chrome ou Edge, ou ouvrez un fichier .p3d.');
  }
  // `readwrite` demandé dès le sélecteur : par défaut le handle est en lecture seule, et
  // l'écriture du verrou (checkLock), qui arrive après un long scan sans geste utilisateur,
  // échouait alors en NotAllowedError (« The request is not allowed by the user agent… »).
  return await window.showDirectoryPicker({ mode: 'readwrite' });
}

// ---------- Le format DOSSIER migre, lui aussi ----------
//
// `migrateProjectData` n'a qu'un appelant : le chemin FICHIER (.p3d). Un projet ouvert en
// dossier n'est jamais passé par lui — tout palier ajouté ci-dessus s'appliquait donc aux .p3d
// et sautait les dossiers, jusqu'à faire diverger deux formats du même projet sans un message.
//
// La migration d'un dossier se fait à DEUX niveaux, et c'est le point important :
//
//   - le MANIFESTE (project.json) porte le projet : ses réglages, la liste de ses scènes ;
//   - CHAQUE FICHIER DE SCÈNE porte sa propre version, parce que `registerInFolder` n'écrit que
//     la scène courante. Un numéro unique, au manifeste, monterait pour tout le projet alors
//     que les autres scènes — jamais rouvertes, donc jamais réécrites — resteraient au vieux
//     schéma, et seraient ensuite relues comme si elles avaient migré.
//
// Les deux tables sont vides aujourd'hui : le format dossier naît ici avec sa version 1. Elles
// existent pour que le prochain palier ait un endroit où aller, et le test qui les couvre
// (test/migration-dossier.test.mjs) mesure qu'un document déjà à jour n'est pas retouché.
export const VERSION_MANIFEST = 2;
export const VERSION_SCENE_FILE = 1;
export const MANIFEST_MIGRATIONS = {
  1: function(manifest){
    // v1 -> v2 : les réglages de projet rejoignent `settings`, comme au palier 14 du format
    // fichier. Un manifeste de la v1 les porte à plat — quand il les porte : jusqu'à la
    // correction de ce lot, il n'en écrivait aucun, et `projectSettingsOf` pose alors les
    // défauts pour les champs manquants sans rien écraser de ce qui est là.
    manifest.settings = projectSettingsOf(manifest);
    PROJECT_SETTINGS_KEYS_MIGRATED.forEach(function(k){ delete manifest[k]; });
    manifest.version = 2;
  }
};
export const SCENE_FILE_MIGRATIONS = {};

/** Applique une table de paliers à un document versionné, puis le hisse à `versionCible`. */
export function applyStages(doc, stages, versionCible){
  // Même règle que migrateProjectData (js/serialization.js) : un palier qui ne fait pas monter
  // la version lève, au lieu de boucler jusqu'à une garde muette.
  while(stages[doc.version]){
    const from = doc.version;
    stages[from](doc);
    if(!(doc.version > from)) throw new Error('la migration du dossier de projet depuis la version ' + from + ' n\'a pas fait monter la version');
  }
  // Un document SANS version est un document d'avant le versionnage du format dossier : il est
  // au schéma de la version 1, il lui manque seulement le numéro. Un document DÉJÀ plus récent
  // que nous (projet rouvert dans une version antérieure de l'éditeur) garde le sien : le
  // rabaisser prétendrait savoir le relire.
  if(!(doc.version >= versionCible)) doc.version = versionCible;
  return doc;
}

/** Le manifeste d'un dossier de projet (project.json). */
export function migrateManifestFolder(manifest){
  if(!manifest) return manifest;
  return applyStages(manifest, MANIFEST_MIGRATIONS, VERSION_MANIFEST);
}

/**
 * Un fichier de scène (scenes/<nom>.scene.json). Rend `null` tel quel : une scène listée au
 * manifeste mais jamais enregistrée n'a pas de fichier, et ce n'est pas une erreur.
 */
export function migrateSceneFile(data){
  if(!data) return data;
  return applyStages(data, SCENE_FILE_MIGRATIONS, VERSION_SCENE_FILE);
}

// Charge le contenu réel (donnees) d'une scène référencée par le manifeste, à
// partir du fichier scenes/<name>.scene.json de l'arbre déjà scanné. Retourne
// null si la scène est listée dans le manifeste mais jamais encore enregistrée
// sur disque (cas d'une scène tout juste créée, pas encore sauvegardée).
export async function loadContentScene(tree, nameScene){
  const filePath = 'scenes/' + nameScene + '.scene.json';
  const entry = tree.files.find(f => f.filePath === filePath);
  if(!entry) return null; // scène listée dans le manifeste mais jamais encore enregistrée sur disque
  const f = await entry.handle.getFile();
  return JSON.parse(await f.text());
}

// Charge un projet complet depuis un dossier (handle racine) : scanne l'arbre,
// charge le manifeste, vérifie le verrou multi-tab et charge le contenu
// réel de chaque scène référencée dans le manifeste.
export async function loadProjectFromFolder(handle, idSession){
  // MESURE TEMPORAIRE (voir la même note dans project.js:finalizeOpeningProjectFolder) : ce
  // scan récursif est la première chose qui touche le disque à l'ouverture, avant même de
  // savoir combien d'assets le projet contient.
  const t0 = chronoMs();
  const tree = await scanFolder(handle);
  const tApresScan = chronoMs();
  // La migration est PAR FICHIER : registerInFolder n'écrit que la scène courante, donc un
  // numéro de version porté par le seul manifeste mentirait sur les autres scènes.
  const manifest = migrateManifestFolder(await loadManifestFromTree(tree));
  const lock = await checkLock(handle, idSession);
  const tApresLock = chronoMs();
  // Le manifeste ne stocke que {name} par scène (le contenu réel — donnees — vit
  // dans scenes/<name>.scene.json, écrit par registerInFolder — voir Task 6).
  const listScenes = (manifest.scenes && manifest.scenes.length) ? manifest.scenes : [{name: 'Scène 1'}];
  const scenes = [];
  for(const s of listScenes){
    scenes.push({ name: s.name, data: migrateSceneFile(await loadContentScene(tree, s.name)) });
  }
  console.log(
    '[Hub] loadProjectFromFolder — ' + Math.round(chronoMs() - t0) + ' ms au total\n'
    + '  scanFolder (parcours récursif du dossier) : ' + Math.round(tApresScan - t0) + ' ms (' + tree.files.length + ' fichiers)\n'
    + '  manifeste + verrou multi-onglet : ' + Math.round(tApresLock - tApresScan) + ' ms\n'
    + '  lecture des fichiers de scène : ' + Math.round(chronoMs() - tApresLock) + ' ms (' + listScenes.length + ' scène(s))'
  );
  return { manifest, scenes, tree, handle, warningLock: lock.dejaOpenAilleurs };
}

// Écrit un fichier à un chemin relatif (potentiellement imbriqué, séparé par
// '/') dans le dossier racine donné, créant les sous-dossiers intermédiaires
// au besoin. Valide le nom de fichier final via validateNameFile (Task 1,
// file-names.js — partagé sur window dans l'éditeur réel). En cas de perte
// de permission d'écriture (ou toute autre error lors de l'écriture réelle),
// relance une erreur explicite invitant à réautoriser l'accès.
export const ERRORS_PERMISSION = new Set(['NotAllowedError', 'SecurityError']);

// ---------- Le registre de NOS écritures ----------
//
// La surveillance du dossier (js/folder-watch.js) ne peut pas distinguer, sur le disque, un
// fichier posé par l'utilisateur d'un fichier que l'éditeur vient lui-même d'écrire : les deux
// ont simplement une date de modification neuve. Sans ce registre, chaque enregistrement se
// ferait relire comme un changement externe, et le rechargement qui s'ensuit réécrirait à son
// tour — une boucle sans fin, et des assets remplacés sous les doigts de l'utilisateur.
//
// Chaque chemin est noté AVEC l'instant de l'écriture et consommé au premier sondage qui le
// voit changer. La péremption (`TTL_WRITE_OURS`) existe pour le cas contraire : une écriture
// qu'aucun sondage ne rapproche (fichier réécrit à l'identique, donc invisible au diff) ne doit
// pas rester à masquer un vrai changement du même chemin pour toujours.
export const writesOurs = new Map();
export const TTL_WRITE_OURS = 30000;

export function noteDiskWriteOurs(filePath, now){
  // `=== undefined` et non `||` : un horodatage de 0 est une VALEUR (les tests s'en servent),
  // et un `||` le remplacerait par l'instant présent — l'entrée ne périmerait alors jamais.
  writesOurs.set(filePath, now === undefined ? Date.now() : now);
}

/**
 * Les chemins écrits par l'éditeur, à masquer au sondage en cours.
 *
 * `debutScan` est l'instant où le sondage a COMMENCÉ à lire le disque, et il compte : une
 * écriture faite APRÈS ce moment a pu échapper à la lecture, donc elle est rendue (elle masque
 * ce tour-ci) mais GARDÉE pour masquer aussi le tour suivant, qui la verra. Sans cette
 * distinction, une sauvegarde tombant pendant un scan repassait pour un changement externe —
 * exactement la boucle que ce registre existe pour empêcher.
 */
export function takeDiskWritesOurs(debutScan, now){
  const t = now === undefined ? Date.now() : now;
  const debut = debutScan === undefined ? t : debutScan;
  const out = new Set();
  const consommes = [];
  writesOurs.forEach(function(ts, filePath){
    if(t - ts > TTL_WRITE_OURS){ consommes.push(filePath); return; }
    out.add(filePath);
    if(ts <= debut) consommes.push(filePath);
  });
  consommes.forEach(function(filePath){ writesOurs.delete(filePath); });
  return out;
}

export async function writeFileInFolder(root, filePath, content){
  const segments = filePath.split('/');
  const fileName = segments.pop();
  const errorName = validateNameFile(fileName);
  if(errorName) throw new Error(errorName);

  let folder = root;
  for(const seg of segments){
    folder = await folder.getDirectoryHandle(seg, { create: true });
  }
  try {
    const handleFile = await folder.getFileHandle(fileName, { create: true });
    const flux = await handleFile.createWritable();
    await flux.write(content);
    await flux.close();
    // LE SEUL ENTONNOIR D'ÉCRITURE de l'éditeur : tout ce qui part sur le disque passe ici
    // (manifeste, scènes, fichiers d'assets, `.meta`). C'est donc le seul endroit où noter nos
    // écritures pour que la surveillance ne les prenne pas pour des changements externes.
    noteDiskWriteOurs(filePath);
  } catch(e){
    // Seules les erreurs de permission/sécurité justifient d'inviter à réautoriser
    // l'accès ; une autre error (quota disque dépassé, I/O...) garde son vrai message.
    if(ERRORS_PERMISSION.has(e.name)){
      throw new Error('Accès au dossier perdu — réautorisez pour continuer. (' + e.message + ')');
    }
    throw e;
  }
}

// Enregistre le manifeste project.json et le contenu de la scène courante
// (scenes/<nomScene>.scene.json) directement dans le dossier project open.
//
// `write` remplace l'écriture par celle de l'appelant — c'est par là que passe l'enregistrement
// incrémental (js/write-cache.js), qui saute un fichier dont le contenu est déjà celui du
// disque. Absent, on écrit les deux fichiers comme avant : un appelant qui ne connaît pas le
// cache ne peut pas, par oubli, sauter une écriture.
export async function registerInFolder(root, manifest, sceneCurrent, nameScene, write){
  const put = write || function(filePath, content){ return writeFileInFolder(root, filePath, content); };
  await put('project.json', JSON.stringify(manifest, null, 2));
  await put('scenes/' + nameScene + '.scene.json', JSON.stringify(sceneCurrent, null, 2));
}

// Matérialise un dossier vide sur le disque : un dossier qui ne contient aucun
// asset n'existerait sinon jamais physiquement (l'API File System Access ne
// modélise pas les dossiers vides). On y dépose un fichier marker
// .gardefolder (contenu empty) pour que le dossier survive au re-scan et
// apparaisse bien dans l'explorateur d'un autre outil/tab.
export async function createFolderEmptyOnDisk(root, filePath){
  const segments = filePath.split('/');
  let folder = root;
  for(const seg of segments){
    folder = await folder.getDirectoryHandle(seg, { create: true });
  }
  const handleFile = await folder.getFileHandle('.gardefolder', { create: true });
  const flux = await handleFile.createWritable();
  await flux.write('');
  await flux.close();
}

// Écrit le(s) fichier(s) binaire(s) réel(s) d'un asset dans assets/<folder>/ du
// project open, à l'IMPORT (quand un fichier existe déjà). Un asset a soit `fichier`
// (un seul File — texture, audio), soit `paquet` (plusieurs File — modèle
// multi-fichiers gltf+bin+textures), soit ni l'un ni l'autre (script, matériau,
// table de données, prefab : pas de fichier à l'import, leur contenu textuel n'existe
// qu'au moment de l'enregistrement — voir diskAssetManifest/registerInProjectOpen
// dans serialization.js pour scripts/materiaux écrits en fichiers réels à ce moment-là).
// Ne modifie pas le manifeste ni les scènes — voir registerInFolder pour ça.
// Vrai pendant la DÉCOUVERTE d'assets déjà présents sur le disque (voir
// discoverFolderAssets ci-dessous). Les fabriques d'assets (createAssetTexture,
// createAssetAudio…) écrivent leur fichier sur disque dès la création : pour un asset
// qui VIENT du disque, cette écriture réécrit le fichier sur lui-même — et, `File`
// étant un instantané, cela PÉRIME le fichier qu'on vient tout juste d'en lire. Toute
// lecture ultérieure (aperçu, ▶ Jouer, autosave) échoue alors sur ce fichier.
export let assetDiscoveryInProgress = false;
export function setAssetDiscoveryInProgress(v){ assetDiscoveryInProgress = v; }

export async function writeAssetInFolder(root, asset){
  if(assetDiscoveryInProgress) return;
  const files = asset.file ? [asset.file] : (asset.paquet || []);
  const prefixe = asset.folder ? 'assets/' + asset.folder + '/' : 'assets/';
  for(const f of files){
    const content = await f.arrayBuffer();
    await writeFileInFolder(root, prefixe + f.name, content);
  }
}

// Déplace les fichiers d'un asset d'un dossier de `assets/` vers un autre, sur le
// disque. Sans ça, ranger un asset dans le panneau Projet ne bougeait rien sur le
// disque : le manifeste pointait vers un chemin empty (asset perdu à la réouverture) et
// le fichier resté en place était re-découvert comme un asset EN DOUBLE.
// Un fichier absent à l'ancien emplacement est ignoré — le but est l'état final.
/** Une liste de noms de fichiers, augmentée de leur carte d'identité (`<nom>.meta`). */
// ---------- LES ÉCHECS DISQUE NE SONT PLUS MUETS ----------
//
// Toutes les opérations disque de ce fichier sont *best-effort* : elles avalent leurs erreurs
// pour qu'un fichier verrouillé n'interrompe pas toute une suppression. C'est le bon choix pour
// le DÉROULEMENT, et c'était le pire pour le DIAGNOSTIC : un utilisateur a signalé « les assets
// supprimés reviennent », console du navigateur parfaitement vide. Impossible de savoir si le
// code ne s'exécutait pas, échouait, ou visait le mauvais chemin.
//
// Avaler l'erreur reste juste ; se taire ne l'est pas. Chaque échec est désormais nommé dans la
// Console de l'éditeur, avec le chemin exact qui a résisté.
//
// `logConsole` est pris sur `globalThis` avec une garde : ce fichier est chargé par des pages
// qui n'ont pas la console de l'éditeur (règle des modules partagés, docs/ARCHITECTURE.md).
export function reportDiskFailure(operation, filePath, err){
  // `NotFoundError` N'EST PAS UN ÉCHEC pour une suppression : le fichier n'est pas là, c'est
  // exactement l'état recherché. Un asset peut n'avoir jamais eu de fichier — créé puis
  // supprimé sans enregistrement entre les deux, il n'a jamais été écrit sur le disque.
  //
  // La distinction compte : une garde qui crie à chaque cas normal apprend à être ignorée, et
  // le jour où elle signale un vrai problème, personne ne le lit. Elle reste donc visible en
  // trace simple — savoir qu'on a visé un fichier absent aide à comprendre un chemin faux —
  // mais elle ne s'annonce comme un AVERTISSEMENT que quand quelque chose a réellement résisté.
  const benin = err && (err.name === 'NotFoundError' || /could not be found/i.test(err.message || ''));
  const message = 'Disque — ' + operation + (benin ? ' : rien à faire, ' : ' impossible : ')
    + filePath + (benin ? ' était déjà absent' : (err && err.message ? ' (' + err.message + ')' : ''));
  if(typeof globalThis.logConsole === 'function'){
    globalThis.logConsole(benin ? 'log' : 'warn', message, null);
  } else if(!benin) console.warn('[project-folder] ' + message);
}

export function withMetas(names){
  const out = [];
  for(const n of (names || [])){
    out.push(n);
    if(!String(n).endsWith(META_SUFFIX)) out.push(n + META_SUFFIX);
  }
  return out;
}

export async function moveFilesAssetOnDisk(root, folderBefore, folderAfter, names){
  if(folderBefore === folderAfter) return;
  const prefixeBefore = 'assets/' + (folderBefore ? folderBefore + '/' : '');
  const prefixeAfter = 'assets/' + (folderAfter ? folderAfter + '/' : '');
  // La carte d'identité suit son fichier, TOUJOURS et sans que l'appelant ait à y penser.
  // Laissée derrière, elle ferait deux dégâts d'un coup : l'asset déplacé perdrait son
  // identité au rechargement suivant, et le `.meta` orphelin resté à l'ancien emplacement
  // continuerait de revendiquer son id. C'est la raison pour laquelle la liste est complétée
  // ICI et pas chez les appelants — il y en a plusieurs, et un seul oubli suffit.
  names = withMetas(names);
  for(const name of names){
    let d = root, missing = false;
    for(const seg of prefixeBefore.split('/').filter(Boolean)){
      try { d = await d.getDirectoryHandle(seg); } catch(e){ missing = true; break; }
    }
    if(missing) continue;
    let content;
    try { content = await (await (await d.getFileHandle(name)).getFile()).arrayBuffer(); }
    catch(e){ continue; }
    await writeFileInFolder(root, prefixeAfter + name, content);
    try {
      await d.removeEntry(name);
      noteDiskWriteOurs(prefixeBefore + name);
    } catch(e){ /* fichier verrouillé/déjà parti : l'état final est bon */ }
  }
}

// Supprime du disque les fichiers d'un asset qu'on retire du projet. Sans ça, une
// suppression dans le panneau Projet n'effaçait que l'entrée en mémoire : le fichier
// restait sous assets/, et le prochain chargement/rafraîchissement le redécouvrait
// comme un asset ORPHELIN (discoverFolderAssets), faisant réapparaître ce qu'on
// venait de supprimer. Best-effort comme moveFilesAssetOnDisk : un fichier déjà
// absent (ou verrouillé) est ignoré plutôt que de faire échouer toute la suppression.
export async function removeFilesAssetOnDisk(root, folder, names){
  names = withMetas(names);   // même raison que dans moveFilesAssetOnDisk : la carte suit le fichier
  const prefixe = 'assets/' + (folder ? folder + '/' : '');
  let d = root;
  for(const seg of prefixe.split('/').filter(Boolean)){
    try { d = await d.getDirectoryHandle(seg); }
    catch(e){
      // LE DOSSIER N'EXISTE PAS À CE CHEMIN. C'était un `return` muet, et c'est exactement par
      // là qu'une suppression pouvait échouer sans que personne ne l'apprenne : le fichier
      // restait sur le disque et l'asset « supprimé » revenait au rafraîchissement suivant.
      reportDiskFailure('suppression', prefixe + ' (dossier introuvable sur le disque)', e);
      return;
    }
  }
  for(const name of names){
    try {
      await d.removeEntry(name);
      noteDiskWriteOurs(prefixe + name);
    } catch(e){
      // Un `.meta` absent est NORMAL (tous les assets n'en ont pas) : on ne le signale pas.
      if(!String(name).endsWith(META_SUFFIX)) reportDiskFailure('suppression', prefixe + name, e);
    }
  }
}

// Relit le fichier d'un asset depuis le dossier project open.
//
// Un `File` n'est qu'un INSTANTANÉ : déplacer, supprimer ou réécrire le fichier
// d'origine sur le disque le rend définitivement illisible (`FileReader` échoue), et
// c'est le cas current — on importe une texture depuis son dossier de téléchargements,
// dont l'éditeur a fait une copie sous `assets/`, puis on range/supprime l'original.
// La copie du projet, elle, est toujours là : on la relit. Retourne null si le dossier
// project ne la contient pas (ou s'il n'y a pas de dossier project open).
/**
 * Déplace UN fichier d'`assets/` vers un autre chemin — dossier différent, nom différent, ou
 * les deux. La carte d'identité `.meta` suit, sans que l'appelant ait à y penser.
 *
 * `moveFilesAssetOnDisk` ne sait déplacer qu'à nom CONSTANT (un asset qui change de dossier).
 * Or le nom de fichier de la moitié des genres est `slugFile(a.name)` : RENOMMER un asset
 * change son chemin disque autant que le déplacer. C'est ce que cette primitive couvre, et
 * c'est ce qui manquait pour fermer la famille de défauts « la mémoire bouge, le disque non »
 * (voir reconcileDiskPaths, js/assets.js).
 *
 * Best-effort, comme ses voisines : une source absente ou une destination verrouillée laisse
 * l'état tel quel plutôt que de faire échouer toute l'opération.
 */
export async function moveFileOnDisk(root, fromPath, toPath){
  if(!root || !fromPath || !toPath || fromPath === toPath) return false;
  const aDeplacer = [[fromPath, toPath], [fromPath + META_SUFFIX, toPath + META_SUFFIX]];
  let bouge = false;
  for(const [de, vers] of aDeplacer){
    const segments = de.split('/').filter(Boolean);
    const name = segments.pop();
    let d = root, missing = false;
    for(const seg of segments){
      try { d = await d.getDirectoryHandle(seg); } catch(e){ missing = true; break; }
    }
    if(missing) continue;
    let content;
    try { content = await (await (await d.getFileHandle(name)).getFile()).arrayBuffer(); }
    catch(e){
      // Pas de source. Pour un `.meta` c'est normal (tous les assets n'en ont pas) ; pour le
      // fichier lui-même, c'est le signe que le chemin calculé ne correspond pas au disque —
      // et c'est CE cas-là qu'il fallait rendre audible.
      if(!de.endsWith(META_SUFFIX)) reportDiskFailure('déplacement', de + ' introuvable', e);
      continue;
    }
    // ÉCRIRE AVANT D'EFFACER. L'inverse perdrait le fichier si l'écriture échoue — et comme
    // tout ici est best-effort, cet échec-là serait silencieux.
    await writeFileInFolder(root, vers, content);
    try {
      await d.removeEntry(name);
      noteDiskWriteOurs(de);
    } catch(e){
      // Un doublon vaut mieux qu'une perte : la copie est déjà écrite à destination. Mais il
      // FAUT le dire, sinon l'ancien fichier sera réadopté au rafraîchissement suivant.
      reportDiskFailure('retrait après déplacement', de, e);
    }
    bouge = true;
  }
  return bouge;
}

/**
 * Retire du disque un dossier d'`assets/` DEVENU VIDE, et ses parents vidés du même coup.
 *
 * Appelée après que `deleteFolder` (js/assets.js) a fait remonter les fichiers dans le dossier
 * parent : sans ça, le répertoire vide subsisterait et `scanFolder` continuerait de le proposer
 * comme un dossier du projet, à chaque rafraîchissement.
 *
 * **JAMAIS RÉCURSIF, ET C'EST LE POINT.** `removeEntry(name, {recursive:true})` effacerait le
 * contenu en même temps que le dossier — donc, si la remontée des fichiers a échoué, les assets
 * de la personne. Sans l'option, le navigateur REFUSE de retirer un dossier non vide : un défaut
 * à l'étape précédente se solde par un dossier vide qui traîne, jamais par une perte de fichier.
 * Best-effort, comme les autres opérations disque de ce fichier.
 */
export async function removeEmptyFolderOnDisk(root, filePath){
  const segments = ('assets/' + filePath).split('/').filter(Boolean);
  // Du plus profond vers la racine : retirer « a/b » peut vider « a », qui part alors aussi.
  for(let fin = segments.length; fin > 1; fin--){
    let d = root;
    let missing = false;
    for(const seg of segments.slice(0, fin - 1)){
      try { d = await d.getDirectoryHandle(seg); } catch(e){ missing = true; break; }
    }
    if(missing) return;
    try {
      await d.removeEntry(segments[fin - 1]);
      noteDiskWriteOurs('assets/' + segments.slice(1, fin).join('/'));
    } catch(e){ return; }   // pas vide, ou déjà parti : on s'arrête là, sans rien forcer
  }
}

export async function rereadFileFromFolder(root, folderAsset, fileName){
  if(!root) return null;
  try {
    let d = root;
    for(const seg of ('assets/' + (folderAsset ? folderAsset + '/' : '')).split('/').filter(Boolean)){
      d = await d.getDirectoryHandle(seg);
    }
    return await (await d.getFileHandle(fileName)).getFile();
  } catch(e){ return null; }
}

// ---------- Découverte automatique des fichiers du dossier project ----------
// Un fichier posé à la main sous `assets/` (copié depuis l'explorateur, sorti d'un
// autre outil, récupéré d'un dépôt git) n'existe pour l'éditeur que s'il figure dans
// la liste `assets` de projet.json. Sans découverte, la seule façon de l'y faire
// entrer est de le RÉ-IMPORTER — ce qui en écrit un doublon à côté. On aligne donc le
// comportement sur celui d'un moteur : le dossier fait foi, le manifeste ne fait que
// porter les métadonnées (name, paramètres d'import, identifiants).
export const EXT_KIND_ASSET = [
  [/\.(png|jpe?g|webp|gif|bmp|avif|svg)$/i, 'texture'],
  [/\.(mp3|wav|ogg|m4a)$/i,                 'audio'],
  [/\.(glb|gltf|fbx)$/i,                    'model'],
  [/\.material\.json$/i,                    'material'],
  [/\.postprofile\.json$/i,                 'postProfile'],
  [/\.preset\.json$/i,                      'preset'],
  [/\.graph-shader\.json$/i,               'graphShader'],
  [/\.animator\.json$/i,                    'animator'],
  [/\.animation\.json$/i,                   'animation'],
  [/\.tilepalette\.json$/i,                'tilePalette'],
  // Planches de sprites et tables de données : ÉCRITES par serialization.js sous ces
  // extensions, mais absentes de cette table jusqu'à la v0.197.0 — donc jamais redécouvertes.
  // Dès que project.json ne les citait plus (manifeste réécrit, fichier revenu par git, copie à
  // la main), elles disparaissaient du projet et toutes leurs références mouraient.
  [/\.sprite\.json$/i,                     'sprite'],
  [/\.prefab\.json$/i,                     'prefab'],
  [/\.data\.json$/i,                       'data'],
  [/\.sfx\.json$/i,                        'sfx'],
  [/\.loop\.json$/i,                       'musicLoop'],
  [/\.js$/i,                                'script'],
  [/\.html?$/i,                             'documentUI'],
  [/\.css$/i,                               'sheetStyle']
];

// Fichiers de service du dossier project : ni assets, ni compagnons de modèle.
// `.meta` en fait partie : c'est la carte d'identité d'un asset (voir META_SUFFIX ci-dessous),
// pas un asset. Oublié ici, chaque sauvegarde ferait apparaître autant de faux assets que de
// fichiers dans le panneau Projet, et ils se multiplieraient à chaque ouverture.
export const FILES_IGNORED_DISCOVERY = /(^|\/)(\.gardefolder|\.editeur-lock\.json)$|\.meta$/;

// ---------- LA CARTE D'IDENTITÉ D'UN ASSET-FICHIER (convention Unity) ----------
//
// À côté de `chromelo.html`, l'éditeur écrit `chromelo.html.meta` : `{version, id, kind, name}`.
// L'id qu'il porte est l'identité PERSISTANTE de l'asset — le même numéro que celui écrit dans
// les scènes qui le référencent.
//
// Ce que ça achète, et que le manifeste seul ne peut pas donner : un fichier RENOMMÉ ou DÉPLACÉ
// à la main (dans l'explorateur, par git, par un autre outil) emporte son `.meta` avec lui. Le
// projet le retrouve alors à son nouvel emplacement AVEC son identité — au lieu de le perdre
// (entrée du manifeste devenue morte) et d'en redécouvrir un inconnu au même endroit, avec un
// numéro neuf, laissant toutes les références orphelines. C'est exactement le geste que fait
// Unity, et pour exactement cette raison.
export const META_SUFFIX = '.meta';
export const VERSION_META = 1;

/** Le contenu d'un `.meta` pour un asset. Une seule fabrique, pour que lecture et écriture ne divergent pas. */
export function contentMeta(asset){
  return JSON.stringify({version: VERSION_META, id: asset.id, kind: asset.kind,
                         name: asset.name || ''}, null, 2);
}

/**
 * Lit tous les `.meta` d'un arbre déjà scanné. Rend une Map : chemin du fichier d'asset
 * (SANS le suffixe `.meta`) -> {id, kind, name}.
 *
 * Un `.meta` illisible est signalé et ignoré : il fait perdre une identité, pas le projet.
 */
export async function readMetas(tree){
  const byFilePath = new Map();
  for(const f of tree.files){
    if(!f.filePath.endsWith(META_SUFFIX)) continue;
    try {
      const m = JSON.parse(await (await f.handle.getFile()).text());
      if(m && m.id) byFilePath.set(f.filePath.slice(0, -META_SUFFIX.length), m);
    } catch(e){
      console.warn('[projet] carte d identite illisible, ignoree : ' + f.filePath + ' — ' + e.message);
    }
  }
  return byFilePath;
}

/**
 * Rattrape les assets du manifeste dont le fichier a été renommé ou déplacé à la main : on
 * cherche, parmi les `.meta` du disque, celui qui porte le MÊME id, et on réécrit `folder` /
 * `file` du descripteur vers son emplacement réel.
 *
 * Sans ça, ce cas donnait un asset perdu (« project.json cite un fichier absent ») ET un
 * doublon découvert au nouvel emplacement — donc toutes les références de la scène mortes,
 * alors que le fichier était là, intact, à trois centimètres.
 *
 * Rend la liste des relogements effectués, pour que l'appelant puisse le dire à l'utilisateur.
 */
export function relocateAssetsByMeta(manifestAssets, metas, tree){
  const presents = new Set(tree.files.map(function(f){ return f.filePath; }));
  const byId = new Map();
  metas.forEach(function(m, filePath){ if(!byId.has(m.id)) byId.set(m.id, filePath); });
  const relogements = [];
  for(const da of (manifestAssets || [])){
    if(!da.file) continue;   // texture/audio/modèle : `files[]`, traités par leur propre voie
    const filePath = 'assets/' + (da.folder ? da.folder + '/' : '') + da.file;
    if(presents.has(filePath)) continue;
    const trouve = byId.get(da.id);
    if(!trouve || !presents.has(trouve) || trouve.indexOf('assets/') !== 0) continue;
    const segments = trouve.split('/');
    const fileName = segments.pop();
    const before = filePath;
    da.folder = segments.slice(1).join('/');
    da.file = fileName;
    relogements.push({id: da.id, name: da.name, before: before, after: trouve});
  }
  return relogements;
}

export function kindOfFileAsset(name){
  // `.bin` : compagnon d'un .gltf, jamais un asset en soi — il est chargé via le
  // LoadingManager du modèle, pas comme une entrée du panneau Projet.
  if(/\.bin$/i.test(name)) return null;
  for(const [re, kind] of EXT_KIND_ASSET) if(re.test(name)) return kind;
  return null;
}

// Le nom d'asset d'un fichier découvert. Les textures, sons et modèles gardent le nom
// que leur donnerait un import manuel (nom de fichier complet pour les deux premiers,
// nom de base pour un modèle) ; les genres texte perdent leur extension composée, qui
// est un détail de stockage (`herbe.material.json` → « herbe »).
export function nameAssetFromFile(fileName, kind){
  if(kind === 'texture' || kind === 'audio') return fileName;
  if(kind === 'model') return fileName.replace(/\.[^.]+$/, '');
  return fileName.replace(/\.(material|postprofile|graph-shader|animator|animation|tilepalette|sprite|prefab|data|sfx|loop)\.json$/i, '')
                   .replace(/\.[^.]+$/, '');
}

// Descripteurs d'assets pour les fichiers de `assets/` que le manifeste ne revendique
// PAS. On rend la MÊME forme que project.json (`{id, kind, name, folder, fichiers|fichier}`)
// pour que la suite du chargement soit exactement celle d'un asset déclaré : résolution
// par resolveAssetDescriptors() puis rebuildAssetsFromDescriptors(). Aucun
// chemin de chargement parallèle à maintenir.
//
// `manifesteAssets` est la liste BRUTE du manifeste (avant résolution) : chaque asset y
// cite ses fichiers soit par `fichiers[]` (texture/audio/modèle) soit par `fichier`
// (genres texte).
export function discoverFolderAssets(tree, manifestAssets, metas){
  const revendiques = new Set();
  for(const da of (manifestAssets || [])){
    const prefixe = 'assets/' + (da.folder ? da.folder + '/' : '');
    for(const f of (da.files || [])) revendiques.add(prefixe + f);
    if(da.file) revendiques.add(prefixe + da.file);
  }
  // Les ids DÉJÀ pris par le manifeste : une carte d'identité orpheline (le fichier a été
  // dupliqué avec son `.meta`, ou le manifeste a repris l'asset sous un autre chemin) ne doit
  // pas faire naître un second asset portant le même numéro — ce serait la collision même que
  // toute cette mécanique existe pour empêcher.
  const idsTaken = new Set((manifestAssets || []).map(function(da){ return da.id; }));
  const inlineIds = new Map();
  (manifestAssets || []).forEach(function(da){
    if(!da.file && !(da.files && da.files.length)) inlineIds.set(da.id, da.kind);
  });
  const descripteurs = [];
  for(const f of tree.files){
    if(f.filePath.indexOf('assets/') !== 0) continue;
    if(revendiques.has(f.filePath) || FILES_IGNORED_DISCOVERY.test(f.filePath)) continue;
    const segments = f.filePath.split('/');
    const fileName = segments.pop();
    const kind = kindOfFileAsset(fileName);
    if(!kind) continue;
    const folder = segments.slice(1).join('/');
    // L'IDENTITÉ D'ABORD. Un fichier accompagné de son `.meta` reprend l'id qu'il portait :
    // c'est ce qui fait qu'un fichier déplacé/renommé hors de l'éditeur, ou revenu par git,
    // garde toutes ses références. Sans `.meta` (fichier réellement neuf, déposé à la main),
    // `decouvert:<chemin>` n'est PAS une identité persistante — l'asset recevra un numéro
    // frais, qui deviendra le sien pour de bon à la première sauvegarde.
    const meta = metas && metas.get(f.filePath);
    // LE MANIFESTE PORTE DÉJÀ CET ASSET EN LIGNE (ancien format, sans fichier : prefab, table de
    // données d'avant leur passage au fichier) et le fichier est le sien — même id, même genre.
    // C'est le cas d'un project.json revenu en arrière par git après une conversion : adopter le
    // fichier ferait un DOUBLON du prefab. Le manifeste fait foi ; le fichier sera réécrit
    // depuis lui au prochain enregistrement.
    if(meta && meta.id && inlineIds.has(meta.id) && inlineIds.get(meta.id) === kind) continue;
    const idMeta = (meta && meta.id && !idsTaken.has(meta.id)) ? meta.id : null;
    if(idMeta) idsTaken.add(idMeta);
    const base = {id: idMeta || ('decouvert:' + f.filePath), kind: kind,
                  name: (meta && meta.name) || nameAssetFromFile(fileName, kind), folder: folder};
    if(kind === 'texture' || kind === 'audio'){
      descripteurs.push(Object.assign(base, {files: [fileName]}));
    } else if(kind === 'model'){
      // Un .gltf ne se charge pas seul : son .bin et ses textures sont des fichiers
      // FRÈRES, résolus par nom via le LoadingManager. Le paquet reprend donc tout ce
      // qui l'entoure dans le même dossier disque (hors autres modèles). Un .glb ou un
      // .fbx est autonome, mais la règle uniforme ne lui coûte rien.
      const prefixeFrere = f.filePath.slice(0, f.filePath.length - fileName.length);
      const paquet = tree.files
        .filter(function(g){
          return g.filePath.indexOf(prefixeFrere) === 0
            && g.filePath.indexOf('/', prefixeFrere.length) === -1
            && (g.filePath === f.filePath || !/\.(glb|gltf|fbx)$/i.test(g.filePath));
        })
        .map(function(g){ return g.filePath.slice(prefixeFrere.length); });
      descripteurs.push(Object.assign(base, {files: paquet}));
    } else {
      descripteurs.push(Object.assign(base, {file: fileName}));
    }
  }
  return descripteurs;
}

// Résout, pour chaque descripteur d'asset du manifeste, un éventuel `fichier` de
// script/matériau en le contenu inline (`code`/`props`) que
// rebuildAssetsFromDescriptors() (serialization.js) attend, en le lisant
// dans l'arbre déjà scanné. Le chemin réel (assets/<folder>/<fichier>) suit
// exactement la même convention que les autres assets (texture/audio/modèle) —
// TOUT vit sous assets/<a.folder>/, le même arbre que l'utilisateur organise
// librement dans le panneau Projet, sans dossier séparé par type de fichier.
// Les descripteurs sans `fichier` (texture/audio/model : résolus autrement via
// leur propre `fichiers[]` ; donnees/prefab : déjà inline) passent inchangés.
// Un fichier de script/matériau introuvable sur le disque (supprimé/déplacé
// manuellement) fait sauter cet asset plutôt que de planter tout le chargement
// du projet — l'appelant compare les tailles avant/après pour warn.
export async function resolveAssetDescriptors(manifestAssets, tree){
  const resolus = [];
  for(const da of manifestAssets){
    if((da.kind === 'script' || da.kind === 'material' || da.kind === 'documentUI'
        || da.kind === 'sheetStyle' || da.kind === 'animator'
        || da.kind === 'animation' || da.kind === 'sprite' || da.kind === 'tilePalette'
        || da.kind === 'graphShader' || da.kind === 'postProfile' || da.kind === 'data'
        || da.kind === 'preset' || da.kind === 'sfx' || da.kind === 'musicLoop'
        || da.kind === 'prefab') && da.file){
      const filePath = 'assets/' + (da.folder ? da.folder + '/' : '') + da.file;
      const entry = tree.files.find(function(f){ return f.filePath === filePath; });
      if(!entry){
        // Le manifeste (project.json) cite un fichier absent du disque — renommé/déplacé/supprimé
        // à la main, ou une désynchronisation manifeste/disque. Sans cette ligne, l'asset
        // disparaît silencieusement du panneau Projet : rien dans la Console ne le dit.
        console.warn('[projet] asset « ' + (da.name || da.id) + ' » (' + da.kind
          + ') introuvable sur le disque : ' + filePath + ' — project.json cite un fichier absent.');
        continue;
      }
      const text = await (await entry.handle.getFile()).text();
      const field = da.kind === 'script' ? {code: text}
        : da.kind === 'material' ? {props: JSON.parse(text)}
        : da.kind === 'preset' ? {preset: (function(){
            // Même politique que les autres genres texte : un .preset.json cassé ne doit pas
            // faire échouer le chargement du projet entier.
            try { const d = JSON.parse(text); return {kind:d.kind || '', params:d.params || {}}; }
            catch(e){ console.error('preset « ' + da.name + ' » illisible :', e.message);
              return {kind:'', params:{}}; }
          })()}
        : da.kind === 'postProfile' ? {effects: ensurePostProfileDefaults((function(){
            // Meme politique que material/animator : un .postprofile.json casse ne doit pas
            // faire echouer le chargement du projet entier. ensurePostProfileDefaults()
            // comble aussi un fichier partiel/édité à la main (clé d'effet manquante).
            try { return JSON.parse(text); }
            catch(e){ console.error('profil « ' + da.name + ' » illisible :', e.message); return {}; }
          })())}
        : da.kind === 'animator' ? {machine: (function(){
            // Un .animator.json casse ne doit pas faire echouer le CHARGEMENT DU PROJET :
            // on rend une machine empty, que validateAnimator signalera comme telle.
            try { return JSON.parse(text); }
            catch(e){ console.error('animator « ' + da.name + ' » illisible :', e.message); return {}; }
          })()}
        : da.kind === 'animation' ? {anim: (function(){
            // Même politique que l'animator : un fichier cassé rend un asset vide et signalé
            // par validateAnimAsset, il ne fait pas échouer le chargement du projet entier.
            try { return JSON.parse(text); }
            catch(e){ console.error('animation « ' + da.name + ' » illisible :', e.message); return {}; }
          })()}
        : da.kind === 'sprite' ? {sprite: (function(){
            // Même politique que l'animator et l'animation : un fichier cassé rend un asset
            // empty, que validateSprite signalera, et ne fait pas échouer le projet entier.
            try { return JSON.parse(text); }
            catch(e){ console.error('sprite « ' + da.name + ' » illisible :', e.message); return {}; }
          })()}
        : da.kind === 'tilePalette' ? {palette: (function(){
            // Même politique que l'animator : un fichier cassé rend une palette vide plutôt
            // que de faire échouer le chargement du projet entier.
            try { return parsePalette(text); }
            catch(e){ console.error('palette « ' + da.name + ' » illisible :', e.message); return emptyPalette(0.5); }
          })()}
        : da.kind === 'sfx' ? {recipe: (function(){
            // Même politique que l'animator : un .sfx.json cassé rend la recette par défaut
            // (normalizeSfx), il ne fait pas échouer le chargement du projet entier.
            try { return JSON.parse(text); }
            catch(e){ console.error('bruitage « ' + da.name + ' » illisible :', e.message); return {}; }
          })()}
        : da.kind === 'musicLoop' ? {recipe: (function(){
            try { return JSON.parse(text); }
            catch(e){ console.error('boucle « ' + da.name + ' » illisible :', e.message); return {}; }
          })()}
        : da.kind === 'prefab' ? (function(){
            // Le même {base, tree} que l'ancien prefab en ligne dans project.json : la suite du
            // chargement ne voit aucune différence. Un fichier cassé rend un arbre vide, que
            // rebuildAssetsFromDescriptors signale (« illisible au chargement »), sans faire
            // échouer le projet entier.
            try { const d = JSON.parse(text); return {base: d.base || null, tree: d.tree || []}; }
            catch(e){ console.error('prefab « ' + da.name + ' » illisible :', e.message); return {base: null, tree: []}; }
          })()
        : da.kind === 'documentUI' ? {html: text}
        : da.kind === 'sheetStyle' ? {css: text}
        : da.kind === 'data' ? {text: text}
        : JSON.parse(text);   // graphShader : {cible, noeuds, links, sorties, layout} directement
      resolus.push(Object.assign({}, da, field));
    } else {
      resolus.push(da);
    }
  }
  return resolus;
}
