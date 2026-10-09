// ---------- Historique : undo / rétablir ----------
// Instantanés complets de la scène (objets + pistes d'animation), pris AVANT
// chaque mutation.
//
// LES ASSETS Y SONT ENTRÉS : leur LISTE, et leurs CHAMPS ÉDITABLES. Créer, supprimer, renommer,
// régler l'import, découper une planche, changer un matériau — tout cela s'annule.
//
// L'ORDRE DES DEUX CHANTIERS N'ÉTAIT PAS UN DÉTAIL. Photographier les champs sans que leurs sites
// d'édition empilent un pas aurait fait undo un renommage que rien n'a enregistré : Ctrl+Z aurait
// DÉTRUIT du travail au lieu d'en défaire, le pire comportement possible pour un historique. Le
// panneau d'assets empile donc d'abord un pas par PRISE DE FOCUS (js/import-settings.js) — un par
// rafale de frappe, pas un par caractère —, et seulement ensuite le contenu devient photographiable.
//
// LE CODE DES SCRIPTS Y EST ENTRÉ EN DERNIER, et pas par symétrie : parce qu'il MANQUAIT déjà. Le
// code d'un script d'objet vit dans `userData.scripts`, que `serializeObject` photographie depuis
// toujours — mais la fenêtre d'édition n'empilait aucun pas, « pour ne pas noyer la pile ». Le
// constat était juste, la conclusion non : un Ctrl+Z venu d'un geste ANTÉRIEUR remontait à un
// instantané pris avant l'édition et rendait l'ancien code, sans qu'aucun pas ne lui corresponde.
// Mesuré avant correction : « C1 du code TAPÉ » redevenait « C0 » en deux Ctrl+Z.
//
// Chaque session d'édition pose donc son pas, à la première frappe qui change quelque chose — donc
// sur l'état d'AVANT la session. Le grain fin reste celui de la <textarea>, qui garde son annulation
// native : les deux couches se complètent, et elles ne sont même pas dans la même fenêtre.
//
// L'INSTANTANÉ GARDE UNE RÉFÉRENCE À L'ASSET, ET UNE COPIE DE SES SEULS CHAMPS DE DONNÉES. Un asset
// porte aussi un `File`, une `THREE.Texture`, un `AudioBuffer`, une image décodée : ceux-là ne se
// clonent pas, et n'ont pas à l'être — ils ne changent pas quand on renomme. Le tri se fait par TYPE
// (primitives, tableaux et objets simples) et non par une liste de noms, pour qu'un champ ajouté
// demain soit couvert sans que personne ait à y penser.
//
// Note (project-folder) : les opérations disque (renommer/déplacer/supprimer un
// dossier ou un fichier d'asset) restent hors undo/redo et demandent une confirmation
// utilisateur avant exécution — voir js/assets.js et js/project-folder.js.
import { anim, btnPlayback, closeClipAsset, keySel, setKeySel, tracksOfScene, updateTimeline } from './animation.js';
import { claimIfNeeded, lockBlocks, lockMessage } from './scene-lock.js';
import { markProjectUnsaved } from './project-dirty.js';
import { assets, updateProject } from './assets.js';
import { autosave } from './autosave.js';
import { Registry } from './component-registry.js';
import { ENV_DEFAULT, applyEnvironment, env } from './environment.js';
import { setStatus, updateHierarchy } from './hierarchy.js';
import { applyImportAudio, applyImportModel, applyImportTexture, ensureParamsImport, refreshInspectorAsset, refreshSpritesOfLAsset } from './import-settings.js';
import { removeHelper } from './inspector.js';
import { applyMaterialEverywhere } from './materials.js';
import { addSceneObject, clearSceneObjects, listMats, objects } from './objects.js';
import { phys, stopSimulation } from './physics.js';
import { disposeAllProbes } from './probes.js';
import { applyFilters, gizmoAttach, refitShadows, scene } from './scene.js';
import { assetSelected, select, selectAsset, selection, selectionMulti, setHighlight, setSelectionRaw } from './selection.js';
import { rebuildTree, serializeObject } from './serialization.js';
import { boneByName, cleanVisualsSkeleton } from './skeleton.js';
import { captureOverrides, populateSubScene } from './subscenes.js';
import { loop } from './viewport.js';

export const histo = {undo:[], redo:[], limite:50, gel:false};

// Les champs qu'on NE photographie PAS, chacun avec sa raison. Une exclusion sans raison est un
// oubli déguisé, et celle du code est une dette qu'on veut voir.
export const FIELDS_ASSET_OUTSIDE_HISTO = {
  id: 'identité — elle ne change jamais, et la restaurer ne voudrait rien dire',
  kind: 'identité',
  preview: 'URL blob transitoire, gérée par restaurerAssets quand un asset revient',
  // Les poignées vivantes sont NOMMÉES en plus d'être écartées par le tri de type. Ceinture et
  // bretelles délibérées : le tri de type ne reconnaît une poignée qu'à son prototype, donc un
  // jour où l'une d'elles arriverait sous la forme d'un objet simple — un bouchon, un objet relu
  // d'un projet — elle serait clonée à chaque pas d'historique. Cinquante copies d'un PNG dans la
  // pile ne se voient pas : la page ralentit, puis manque de mémoire.
  file: 'File — les octets ne changent pas quand on renomme',
  texture: 'THREE.Texture — vit sur la map graphique',
  buffer: 'AudioBuffer décodé',
  imageSource: 'HTMLImageElement décodé',
  template: 'gabarit three.js d\'un modèle importé'
};

/**
 * Les champs de données d'un asset, copiés en profondeur.
 *
 * LE TRI SE FAIT PAR TYPE, pas par une liste de noms : un `File`, une `THREE.Texture`, un
 * `AudioBuffer` ou une `Image` ne sont ni des primitives, ni des tableaux, ni des objets simples,
 * donc ils sortent d'eux-mêmes — et un champ de données ajouté demain entre de lui-même. Une liste
 * de noms aurait l'inconvénient inverse : silencieuse quand elle devient incomplète.
 *
 * Les champs préfixés d'un `_` sont le brouillon de l'inspecteur (`_sN`, `_decL`, `_cache`…) : les
 * restore ferait sauter les champs d'un panneau open pendant qu'on y tape.
 */
export function fieldsAssetHisto(a){
  const out = {};
  Object.keys(a).forEach(function(k){
    if(k.charAt(0) === '_' || FIELDS_ASSET_OUTSIDE_HISTO[k]) return;
    const v = a[k];
    if(v === null || v === undefined){ out[k] = v; return; }
    const t = typeof v;
    if(t === 'string' || t === 'number' || t === 'boolean'){ out[k] = v; return; }
    if(t !== 'object') return;                                   // fonction : rien à retenir
    // Un objet SIMPLE seulement : `Object.create(null)` mis à part, tout ce qui porte un autre
    // prototype est une poignée vivante (Texture, File, AudioBuffer, Image, Blob…).
    const proto = Object.getPrototypeOf(v);
    if(!Array.isArray(v) && proto !== Object.prototype && proto !== null) return;
    try { out[k] = JSON.parse(JSON.stringify(v)); }
    catch(e){ /* structure circulaire ou non sérialisable : on laisse tomber ce champ */ }
  });
  return out;
}

export function stateCurrent(){
  // sous-scènes : on enregistre les écarts locaux, et on ne sérialise PAS le contenu
  // généré (il est régénéré depuis la scène source à la reconstruction)
  Registry.activeNodes('SubScene').forEach(function(o){
    captureOverrides(o);
  });
  return {
    // Une copie PLATE du tableau : ses éléments restent les assets eux-mêmes — c'est ce qui permet
    // de les remettre dans la liste sans toucher à leurs poignées vivantes.
    assets: assets.slice(),
    // Et, à côté, la photo de leurs champs de données. Séparée du tableau pour que la liste reste
    // restaurable même si un champ résiste à la copie.
    fieldsAssets: assets.map(function(a){ return {id: a.id, fields: fieldsAssetHisto(a)}; }),
    // Les nœuds d'un modèle non plus : ils sont regénérés depuis le fichier, et leurs écarts
    // voyagent sur la racine de l'instance (`modelNodes`, js/model-nodes.js).
    objects: objects.filter(function(o){
      return o.userData.ssInstance === undefined && o.userData.modelNode === undefined;
    }).map(serializeObject),
    // Une piste d'os s'adresse par (objet, NOM de l'os), jamais par l'identifiant de l'os.
    // Cet identifiant n'apparaît dans aucune table de correspondance : les os ne sont pas des
    // objets de projet, ils sont reconstruits avec leur modèle et reçoivent alors de nouveaux
    // identifiants. Le nom, lui, traverse — c'est déjà par le nom qu'un clip d'animation
    // s'adresse à ses nœuds.
    tracks: (typeof tracksOfScene === 'function' ? tracksOfScene() : anim.tracks).map(function(p){
      // `additif` décide de la LECTURE des clés : écart, ou pose absolue. Perdu, les mêmes
      // nombres seraient relus dans l'autre sens — l'os partirait à l'autre bout de la scène.
      return {obj:p.obj.id, os:(p.os ? p.os.name : null), additif:!!p.additif,
              keys:JSON.parse(JSON.stringify(p.keys))};
    }),
    duration: anim.duration,
    loop: anim.loop,
    env: JSON.parse(JSON.stringify(env)),
    selId: selection ? selection.id : null,
    multiIds: selectionMulti.map(function(o){ return o.id; })
  };
}

// ---------- Interaction de formulaire ouverte ----------
// L'historique est par INSTANTANÉ COMPLET : « ouvrir une transaction » n'a pas de sens ici.
// Ce qu'on tient, c'est un drapeau — l'instantané est pris avant la PREMIÈRE mutation d'une
// interaction, et réarmé quand l'interaction se referme (blur, change, fin de glissement).
// C'est la généralisation de `inspHistoTaken` (inspector.js), qui ne protégeait que
// l'inspecteur et rien d'autre.
//
// La garde compte autant que le drapeau : le gizmo et le copilote poussent des instantanés
// sans rien savoir du formulaire, et le copilote le fait de manière ASYNCHRONE, sur réponse
// réseau. Un instantané étranger pris au milieu d'une saisie photographie un état à moitié
// tapé, sur lequel Ctrl+Z ramène ensuite. On le refuse.
export let _interaction = null;      // identifiant du champ en cours, ou null
export let _snapshotTaken = false;

export function beginInteraction(fieldId){
  const id = fieldId || 'field';
  // RÉENTRANT sur le MÊME champ : chaque frappe rappelle `beginInteraction`, et réarmer là
  // referait un instantané par caractère — exactement ce que cette garde existe pour éviter.
  if(_interaction === id) return;
  _interaction = id;
  _snapshotTaken = false;
}
export function endInteraction(){
  _interaction = null;
  _snapshotTaken = false;
  // La fin d'une interaction est le moment JUSTE pour recadrer les ombres : c'est là que la
  // scène vient de changer de forme (un objet déplacé, redimensionné, un champ validé) et que
  // rien ne bouge plus. Le faire pendant le glissement recalculerait une boîte englobante par
  // image ; ne jamais le faire laisse l'ombre cadrée sur l'état d'avant.
  if(typeof refitShadows === 'function') refitShadows();
}
export function interactionOpen(){ return _interaction !== null; }

/** Levée quand la scène est verrouillée par quelqu'un d'autre : la mutation n'a pas eu lieu. */
export class ReadOnlySceneError extends Error {}

export function pushHistory(opts){
  // VERROU DE SCÈNE (projet hébergé) — le refus vit ICI, et nulle part ailleurs.
  // La convention du dépôt veut que pushHistory() soit appelé AVANT toute mutation de scène :
  // c'est donc le seul point qui les voie toutes, et le seul où refuser garantisse que rien n'a
  // encore bougé. On lève au lieu de rendre la main : 122 sites d'appel ne vérifient pas de
  // valeur de retour, et un refus silencieux laisserait la mutation se faire quand même — le
  // pire des deux mondes. Voir js/scene-lock.js.
  // La garde `typeof` n'est pas une coquetterie : le harnais node:vm des tests charge ce
  // fichier sans ses imports, et le repli DOIT etre l'ancien comportement — pas un blocage.
  if(typeof lockBlocks === 'function' && lockBlocks()){
    setStatus(lockMessage(), 6000);
    throw new ReadOnlySceneError(lockMessage());
  }
  // Premier geste sur une scène hébergée : on demande le verrou SANS attendre — pushHistory est
  // synchrone. La réponse basculera l'éditeur en lecture seule si la scène est prise ailleurs.
  if(typeof claimIfNeeded === 'function') claimIfNeeded();

  // LES LOTS D'INSTANCES DEVIENNENT PÉRIMÉS. Ici, et AVANT tous les retours anticipés de cette
  // fonction : une édition faite pendant une simulation ne s'empile pas dans l'historique, mais
  // elle change quand même la scène — et un lot périmé continuerait d'afficher l'ancienne
  // couleur ou l'ancienne forme, sans que rien ne le dise. C'est le seul point du programme qui
  // voie TOUTES les mutations de scène (122 sites d'appel), donc le seul endroit où ce
  // marquage ne peut pas être oublié. Voir js/editor-batching.js.
  // `assetOnly` : la retouche ne touche AUCUN objet de scène (recette d'un bruitage, d'une boucle).
  // Marquer les lots périmés relançait 900 ms plus tard le regroupement de TOUTE la scène, pour un
  // clic dans une grille de notes (revue du 2026-09-29, § 5.3).
  if(!(opts && opts.assetOnly) && typeof markBatchingDirty === 'function') markBatchingDirty();

  // Un instantané étranger pendant une interaction de formulaire est refusé (voir plus haut).
  // `opts.source` identifie l'appelant : sans source, l'appel vient du formulaire lui-même.
  if(_interaction !== null){
    if(opts && opts.source) return;
    if(_snapshotTaken) return;
    _snapshotTaken = true;
  }
  // LE MARQUAGE « MODIFIÉ » PASSE AVANT LES RETOURS ANTICIPÉS (docs/REVUE_2026-09-14.md § 2,
  // cause 4). Une édition faite pendant une simulation ne s'empile pas dans
  // l'historique — c'est voulu — mais elle MODIFIE quand même le projet : `stopSimulation()` ne
  // remet que les positions des corps photographiés. Sans cette ligne, ni l'autosave ni l'indicateur « projet non enregistré » ne voyaient
  // jamais ces éditions.
  //
  // `histo.gel` reste EXCLU, et ce n'est pas un oubli : c'est le drapeau de `restoreState()`,
  // donc le chemin undo/redo ET le chargement de projet. Marquer là rendrait tout projet
  // fraîchement ouvert « non enregistré » avant le moindre geste.
  if(phys.active){
    if(typeof autosave !== 'undefined') autosave.modifie = true;
    if(typeof markProjectUnsaved === 'function') markProjectUnsaved();
    return;
  }
  if(histo.gel) return;
  if(typeof autosave !== 'undefined') autosave.modifie = true;
  if(typeof markProjectUnsaved === 'function') markProjectUnsaved();
  histo.undo.push(stateCurrent());
  if(histo.undo.length > histo.limite) histo.undo.shift();
  histo.redo.length = 0;
}

/** Longueur de la pile d'historique — lue par les tests, jamais par du code d'interface. */
export function historyLength(){ return histo.undo.length; }

export function assetsByIdCurrent(){
  const m = {};
  assets.forEach(function(a){ m[a.id] = a; });
  return m;
}

/**
 * Remet la liste des assets telle qu'elle était, et rend ceux qui REVIENNENT utilisables.
 *
 * Un asset qui rentre dans la liste est un asset qu'on avait supprimé. Sa suppression a révoqué
 * l'URL de son aperçu (js/assets.js) : la tile du panneau Projet afficherait une image morte, et
 * on conclurait que l'annulation a ramené un asset abîmé. On la refabrique depuis le `File`, qui,
 * lui, a survécu — c'est aussi ce que fait `replaceContentAssetTexture` après une cuisson.
 *
 * La `THREE.Texture`, elle, n'est PAS refaite : la suppression ne l'a pas libérée, l'objet est
 * toujours en mémoire et déjà sur la map graphique. La recharger ferait clignoter tous les
 * matériaux qui la citent, pour rien.
 *
 * Appelée AVANT la reconstruction de l'arbre : `rebuildTree` lit les assets pour rebrancher
 * les matériaux, les modèles et les sons. Dans l'autre ordre, un objet dont l'asset vient d'être
 * restauré retomberait sur le matériau par défaut.
 */
export function restoreAssets(list){
  if(!list) return;                       // instantané d'une version antérieure : on ne touche à rien
  const presents = new Set(assets.map(function(a){ return a.id; }));
  list.forEach(function(a){
    if(presents.has(a.id)) return;
    if(a.kind === 'texture' && a.file && typeof URL !== 'undefined' && URL.createObjectURL){
      a.preview = URL.createObjectURL(a.file);
    }
  });
  assets.length = 0;
  list.forEach(function(a){ assets.push(a); });
  // La sélection du panneau peut désigner un asset qui vient de disparaître : l'inspecteur
  // continuerait d'afficher ses champs, et les écrire toucherait un objet hors du projet.
  if(typeof assetSelected !== 'undefined' && assetSelected
     && assets.indexOf(assetSelected) === -1){
    selectAsset(null);
  }
}

/**
 * Remet les champs de données de chaque asset, et RÉAPPLIQUE ce qui en dépend.
 *
 * La réapplication est le fond du travail, pas une finition. Remettre `paramsImport.filtrage` à
 * « proche » sans repasser par `applyImportTexture` changerait la donnée sans changer l'image :
 * la `THREE.Texture` resterait configurée comme avant, et l'annulation aurait l'air d'avoir échoué
 * alors qu'elle a réussi à moitié — le genre de bug qu'on cherche dans le bad fichier.
 *
 * On ne réapplique QUE pour les assets dont un champ a bougé. Repasser sur tout le projet à chaque
 * annulation reconfigurerait chaque texture et chaque matériau de la scène pour rien, et ça se sent
 * à la main sur un projet chargé.
 */
export function restoreFieldsAssets(photos){
  if(!photos) return;                      // instantané d'une version antérieure
  const byId = {};
  assets.forEach(function(a){ byId[a.id] = a; });
  photos.forEach(function(p){
    const a = byId[p.id];
    if(!a) return;                         // asset disparu depuis : rien à remettre
    let change = false;
    Object.keys(p.fields).forEach(function(k){
      const avant = JSON.stringify(a[k]), apres = JSON.stringify(p.fields[k]);
      if(avant === apres) return;
      // RE-CLONÉ à l'écriture : sans ça, l'asset et la photo partageraient le même objet, et la
      // mutation suivante réécrirait l'instantané qu'on vient de restore. Un rétablissement
      // rendrait alors la valeur d'après au lieu de celle d'avant.
      a[k] = (p.fields[k] && typeof p.fields[k] === 'object')
        ? JSON.parse(JSON.stringify(p.fields[k])) : p.fields[k];
      change = true;
    });
    if(change) reapplyAsset(a);
  });
}

/** Repasse un asset restauré dans la moulinette qui le rend visible. */
export function reapplyAsset(a){
  ensureParamsImport(a);
  if(a.kind === 'texture') applyImportTexture(a);
  else if(a.kind === 'model') applyImportModel(a, true);
  else if(a.kind === 'audio') applyImportAudio(a, true);
  // Un bruitage : sa recette vient d'être remise, son son doit être recalculé — sinon Ctrl+Z
  // changerait les réglages affichés et on entendrait toujours la version d'après.
  else if(a.kind === 'sfx' && typeof renderAssetSfx === 'function'){
    renderAssetSfx(a);
    if(typeof refreshSoundRack === 'function') refreshSoundRack();
  }
  else if(a.kind === 'musicLoop' && typeof renderAssetLoop === 'function'){
    renderAssetLoop(a);
    if(typeof refreshSoundRack === 'function') refreshSoundRack();
  }
  else if(a.kind === 'material') applyMaterialEverywhere(a);
  else if(a.kind === 'sprite') refreshSpritesOfLAsset(a);
}

/**
 * Un sous-système de `restoreState()`, isolé.
 *
 * `restoreState()` enchaîne une vingtaine de sous-systèmes sans le moindre filet : une exception
 * dans n'importe lequel abandonnait la restauration EN COURS DE ROUTE et laissait `histo.gel` à
 * `true` — donc plus aucune édition marquée, plus d'undo, plus d'autosave, pour tout le reste de
 * la session, et sans un message (docs/REVUE_2026-09-14.md § 2, cause 5).
 *
 * Même geste que `System.isolate` (js/systems.js), mais SANS sa déduplication par nom : celle-ci
 * ne signale un poste qu'une fois pour toute la vie de la page, ce qui est juste pour une boucle
 * à soixante images par seconde et faux ici, où chaque annulation est un événement distinct.
 */
function restoreStep(label, work){
  try { work(); }
  catch(e){
    const msg = 'Restauration — « ' + label + ' » : ' + ((e && e.message) || 'erreur inconnue');
    console.error(msg, e);
    if(typeof logConsole === 'function') logConsole('error', msg, null);
    setStatus('⛔ ' + msg + ' — voir la Console', 6000);
  }
}

export function restoreState(state){
  histo.gel = true;
  // LA SCÈNE ENTIÈRE EST REMPLACÉE : les lots pointent sur des objets qui n'existeront plus.
  // On les défait TOUT DE SUITE plutôt que de marquer « à refaire » — le démontage ci-dessous
  // retire les objets de la scène, et un lot qui leur survivrait continuerait de les dessiner.
  // C'est le chemin de l'annulation, du rétablissement ET du chargement de projet.
  if(typeof stopBatching === 'function') stopBatching();
  if(typeof markBatchingDirty === 'function') markBatchingDirty();
  // try/finally SUR TOUT LE CORPS : quoi qu'il arrive, `histo.gel` redevient `false`. C'est la
  // moitié non négociable du correctif — les `restoreStep` ci-dessous limitent les dégâts,
  // celui-ci garantit que l'éditeur ne reste jamais gelé.
  try {
  restoreStep('arrêt de la simulation', function(){ if(phys.active) stopSimulation(); });
  anim.playback = false;
  btnPlayback.textContent = '▶';
  restoreStep('gizmo', function(){ gizmoAttach(null); });

  restoreStep('démontage de la scène', function(){
    const racines = objects.filter(function(o){ return o.parent === scene; });
    objects.forEach(removeHelper);
    racines.forEach(function(r){
      scene.remove(r);
      r.traverse(function(o){
        if(o.geometry) o.geometry.dispose();
        listMats(o).forEach(function(m){ if(m.dispose) m.dispose(); });
      });
    });
  });
  clearSceneObjects();
  setSelectionRaw(null);
  selectionMulti.length = 0;
  anim.tracks = [];
  setKeySel(null);
  restoreStep('sondes de réflexion', function(){
    disposeAllProbes();
  });
  // Un objet supprime laisserait son visuel de squelette flottant dans la scene, sans plus
  // rien pour le rattacher ni le faire disparaitre.
  restoreStep('visuels de squelette', function(){
    cleanVisualsSkeleton();
  });

  // LES ASSETS D'ABORD. `rebuildTree` les consulte pour rebrancher matériaux, modèles et
  // sons : dans l'autre ordre, un objet dont l'asset vient d'être restauré retomberait sur le
  // matériau par défaut, et l'annulation aurait l'air d'avoir à moitié marché.
  restoreStep('liste des assets', function(){ restoreAssets(state.assets); });
  // Les CHAMPS après la LISTE : un asset qui vient de revenir doit être dans le tableau avant
  // qu'on lui réécrive son nom, et la réapplication (`applyImportTexture`…) parcourt le
  // tableau pour trouver ses utilisations.
  restoreStep('champs des assets', function(){ restoreFieldsAssets(state.fieldsAssets); });

  // Même raison que `tracks` ci-dessous : une scène vide écrite à la main (`{}`) ne doit pas
  // démonter l'éditeur en plein chargement. `restoreAssets` et `restoreFieldsAssets` se
  // défendent déjà de la même façon, deux lignes plus haut.
  const rec = rebuildTree(state.objects || [], assetsByIdCurrent(), true);
  rec.racines.forEach(function(r){ scene.add(r); });
  // addSceneObject et PAS objects.push : l'undo restaurait le tableau sans l'index, donc toute
  // la scène redevenait invisible de la hiérarchie et de l'ECS après un seul Ctrl+Z.
  Object.keys(rec.byId).forEach(function(k){ addSceneObject(rec.byId[k]); });

  // contenu des sous-scènes : régénéré depuis les scènes sources, puis overrides
  restoreStep('sous-scènes', function(){
    Registry.activeNodes('SubScene').forEach(function(o){ populateSubScene(o); });
  });

  // LES CHAMPS D'ANIMATION SONT OPTIONNELS, et c'est une correction. `state.tracks.map(…)` plus
  // bas levait un TypeError sur toute scène qui n'en portait pas — et le format dossier INVITE à
  // écrire un `.scene.json` à la main ou à le faire engendrer par un script (c'est tout son
  // intérêt). Une scène sans animation est parfaitement valide : elle n'a aucune raison de
  // déclarer `tracks: []`, `duration` et `loop` pour être lisible.
  //
  // Le coût de l'oubli était maximal : l'exception partait au MILIEU de `restoreState`, la scène
  // déjà démontée et pas encore remontée, pendant l'ouverture d'un projet. L'éditeur restait sur
  // un projet à moitié chargé, et le message (« Cannot read properties of undefined ») ne
  // désignait ni le fichier fautif ni le champ manquant. `env` et `multiIds` étaient déjà
  // défendus de cette façon quelques lignes plus loin ; ceux-ci ne l'étaient pas.
  anim.duration = state.duration === undefined ? 5 : state.duration;
  anim.loop = state.loop !== false;
  restoreStep('barre de temps', function(){
    document.getElementById('an-duration').value = anim.duration;
    document.getElementById('an-loop').classList.toggle('active', anim.loop);
  });
  // Un clip ouvert est FERMÉ avant de restore : l'undo porte sur la scène, et écraser
  // `anim.pistes` pendant qu'elles appartiennent à un asset perdrait le clip en cours.
  restoreStep('fermeture du clip ouvert', function(){
    if(typeof closeClipAsset === 'function') closeClipAsset();
  });
  anim.tracks = (state.tracks || []).map(function(dp){
    const obj = rec.byId[dp.obj];
    // Un os retrouvé par son nom dans le modèle reconstruit. S'il a disparu — modèle
    // réimporté depuis un fichier différent, os renommé — la piste est ÉCARTÉE par le filtre
    // ci-dessous plutôt que d'animer l'objet entier à sa place, ce qui ferait sauter le
    // modèle d'un bout à l'autre de la scène sans qu'on comprenne pourquoi.
    const os = (dp.os && obj) ? boneByName(obj, dp.os) : null;
    return {obj: obj, os: os, keys: dp.keys, additif: !!dp.additif, boneAttendu: dp.os || null};
  }).filter(function(p){
    return p.obj && p.keys.length && (!p.boneAttendu || p.os);
  });
  anim.t = Math.min(anim.t, anim.duration);
  restoreStep('environnement', function(){ applyEnvironment(state.env || ENV_DEFAULT); });

  restoreStep('sélection', function(){
    const sel = (state.selId !== null && state.selId !== undefined) ? rec.byId[state.selId] : null;
    select(sel || null);
    (state.multiIds || []).forEach(function(id){
      const o = rec.byId[id];
      if(o && o !== selection){ selectionMulti.push(o); setHighlight(o, true); }
    });
  });
  restoreStep('hiérarchie', function(){ updateHierarchy(); });
  restoreStep('barre de temps', function(){ updateTimeline(); });
  // Le panneau Projet est redessiné APRÈS l'arbre, et pas dans `restoreAssets` : la même
  // annulation peut avoir retiré un asset ET les objets qui le citaient, et redessiner entre les
  // deux montrerait un état qui n'a jamais existé.
  restoreStep('panneau Projet', function(){
    updateProject();
    refreshInspectorAsset();
  });
  restoreStep('calques', function(){ applyFilters(); });
  } finally {
    histo.gel = false;
  }
}

export function undo(){
  if(phys.active){ setStatus('Arrêtez la simulation avant d\'annuler', 2500); return; }
  if(!histo.undo.length){ setStatus('Rien à annuler', 1500); return; }
  histo.redo.push(stateCurrent());
  restoreState(histo.undo.pop());
  setStatus('Annulé', 1200);
}

export function restore(){
  if(phys.active){ setStatus('Arrêtez la simulation avant de rétablir', 2500); return; }
  if(!histo.redo.length){ setStatus('Rien à rétablir', 1500); return; }
  histo.undo.push(stateCurrent());
  restoreState(histo.redo.pop());
  setStatus('Rétabli', 1200);
}


// EXPOSÉ EN GLOBALE, à dessein. Ces symboles sont appelés depuis des fichiers
// que les mêmes pages ne chargent pas toutes : un `import` y pointerait un
// fichier absent, et la page ne démarrerait pas. Ils gardent donc leur garde
// `typeof` côté appelant, et se déclarent ici.
globalThis.restore = restore;
globalThis.stateCurrent = stateCurrent;