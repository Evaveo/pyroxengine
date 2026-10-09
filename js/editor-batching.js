// moteur/js/editor-batching.js
//
// LE REGROUPEMENT DU DÉCOR DANS L'ÉDITEUR.
//
// ---------- LE DÉFAUT QU'ON FERME ----------
//
// js/render-perf.js regroupe les objets identiques en `InstancedMesh` : mille caisses, un appel
// de dessin. Il existait depuis longtemps, il marchait, et il ne tournait QUE dans le jeu
// publié — les deux appels de js/viewport.js étaient gardés par `if(modeGame.active)`, et
// `modeGame.active` ne devenait plus jamais vrai depuis que « ▶ Jouer » ouvre un onglet
// (drapeau retiré depuis, docs/REVUE_2026-09-29.md § 6.1). Du code mort, donc, dans l'outil où l'on passe ses
// journées.
//
// Ce que ça coûtait, mesuré sur un décor de 5 000 objets : 341 appels de dessin pour la seule
// portion visible, 11,69 ms de CPU par image rien qu'à les encoder. Le partage des géométries
// (js/primitive-geometry.js) n'y a rien changé — 11,69 ms avant comme après : le coût est par
// APPEL, pas par ressource. Seul le regroupement le fait tomber.
//
// ---------- CE QUI REND ÇA COMPATIBLE AVEC L'ÉDITION ----------
//
// Un objet regroupé est dessiné par le lot, avec LE matériau du lot, et sa source porte
// `visible = false`. Trois conséquences, trois réponses :
//
//  1. ON NE PEUT PLUS LE SURLIGNER. Le survol et la sélection écrivent dans l'émissif du
//     matériau de l'objet — que plus personne ne regarde. Réponse : `detachFromBatch()`, qui
//     éteint l'instance et rend l'objet à lui-même, pour lui seul. Aucun lot n'est reconstruit,
//     donc ça tient la cadence d'un mouvement de souris.
//
//  2. `visible = false` N'EST PAS UN MASQUAGE, et une dizaine de fichiers le lisaient comme
//     tel — dont la sérialisation, qui l'aurait écrit dans le fichier de projet. Réponse :
//     `visibleIntent()` (js/render-perf.js), et les lecteurs corrigés un par un. C'est la
//     partie dangereuse de ce chantier, et c'est celle que test/regroupement-editeur couvre.
//
//  3. LES LOTS PÉRIMENT. Changer la couleur d'un objet regroupé ne se verrait pas : le lot
//     garde le matériau qu'il avait. Réponse : `pushHistory()` — le point de passage unique de
//     toute mutation de scène — marque les lots à refaire, et la reconstruction attend un
//     moment de calme. On ne reconstruit donc jamais pendant qu'on travaille, seulement après.
//
// ---------- CE QU'ON NE FAIT PAS ----------
//
// Le NIVEAU DE DÉTAIL (`updateDetail`) reste au jeu publié. Il fait disparaître le décor au-delà
// d'une distance ; le voir s'effacer pendant qu'on le pose serait une régression, pas un gain.
//
// ---------- AUCUN IMPORT, ET CE N'EST PAS UN CHOIX DE STYLE ----------
//
// Ce fichier ne travaille que sur js/render-perf.js, et js/build-trimming.js sait RETIRER
// js/render-perf.js d'un jeu allégé. Un `import` vers un module absent n'échoue pas tout seul :
// il empêche l'importateur de s'exécuter du tout, en silence (test/esm-modules.test.mjs le
// garde, et c'est lui qui a attrapé la première version de ce fichier). Le régime de globales
// gardées par `typeof`, lui, survit à l'absence — le regroupement ne se fait simplement pas.
//
// La scène, la liste d'objets et la sélection sont PASSÉES en argument, pour la même raison que
// dans js/render-perf.js : ce module est appelé depuis la boucle de js/viewport.js, qui est
// déjà au centre d'un cycle d'imports.

// Le délai de calme avant de refaire les lots. Assez long pour qu'une suite de gestes (poser
// dix objets, glisser une couleur) ne déclenche qu'une reconstruction ; assez court pour qu'on
// n'ait pas le temps de se demander pourquoi la scène rame.
export const BATCH_DELAY_MS = 900;

export const editorBatching = {
  enabled: true,
  dirty: true,
  lastChange: 0,
  builds: 0,
  detached: []   // les objets sortis de leur lot pour être édités
};

/** Les lots sont périmés : `pushHistory()` l'appelle, donc toute mutation de scène l'appelle. */
export function markBatchingDirty(){
  editorBatching.dirty = true;
  editorBatching.lastChange = Date.now();
}

/**
 * Rend à eux-mêmes les objets qu'on est en train de manipuler, et remet les autres dans leur
 * lot. Appelée à chaque changement de sélection ou de survol — donc souvent, d'où l'absence
 * totale de reconstruction ici.
 */
export function setBatchingEdited(list){
  if(typeof detachedFromBatch !== 'function') return;
  const wanted = (list || []).filter(Boolean);
  // LE REGISTRE FAIT FOI, pas la liste de l'appel précédent : un objet peut avoir été détaché
  // par un autre chemin (le surlignage d'une ligne de l'inspecteur, js/selection.js), et il
  // faut le remettre dans son lot quand la souris s'en va. Sans ça, chaque survol sortait un
  // objet du regroupement définitivement — invisible à l'écran, et le gain s'érode.
  detachedFromBatch().forEach(function(o){
    if(wanted.indexOf(o) === -1) detachFromBatch(o, false);
  });
  wanted.forEach(function(o){ detachFromBatch(o, true); });
  editorBatching.detached = wanted;
}

/** Défait tout : sortie du mode, préférence coupée, changement de projet. */
export function stopBatching(){
  editorBatching.detached = [];
  if(typeof engineInstances !== 'undefined' && engineInstances.active
     && typeof undoInstances === 'function') undoInstances();
}

/**
 * Un tour de boucle. `now` est passé pour que le test n'ait pas à attendre une seconde.
 *
 * L'ordre compte : on reconstruit AVANT de resynchroniser, sinon les lots neufs afficheraient
 * les poses de l'image précédente — un décalage d'une image, invisible à l'arrêt et très
 * visible en mouvement. C'est la même règle que la boucle du jeu publié.
 */
export function updateEditorBatching(scene, objects, edited, now, moving){
  // LE MODULE DE REGROUPEMENT PEUT NE PAS ETRE LA : js/build-trimming.js sait le retirer.
  // On sort sans rien faire plutot que de lever — le decor se dessinera objet par objet,
  // comme avant, ce qui est exactement le repli voulu.
  if(typeof instantiateStatic !== 'function' || typeof updateInstances !== 'function') return null;
  if(!editorBatching.enabled){
    stopBatching();
    return null;
  }
  // LA SÉLECTION EST RENDUE À ELLE-MÊME À CHAQUE IMAGE, et pas à chaque changement de
  // sélection. C'est délibéré : il y a six chemins qui modifient la sélection (clic, Ctrl+clic,
  // hiérarchie, inspecteur, historique, copilote), et en oublier un donnerait un objet
  // sélectionné qu'on ne peut ni voir surligné ni distinguer — sans erreur. Deux comparaisons
  // de tableaux par image valent mieux que six accroches à tenir.
  setBatchingEdited(edited);

  const t = (now === undefined) ? Date.now() : now;
  if(editorBatching.dirty && (t - editorBatching.lastChange) >= BATCH_DELAY_MS){
    editorBatching.dirty = false;
    editorBatching.builds++;
    // LA SÉLECTION N'ENTRE PAS DANS UN LOT. On l'édite : son matériau doit rester le sien, et
    // son gizmo doit pouvoir la déplacer sans que rien d'autre ne la redessine.
    const hors = (edited || []).filter(Boolean);
    undoInstances();
    instantiateStatic(scene, (objects || []).filter(function(o){ return hors.indexOf(o) === -1; }));
    editorBatching.detached = [];
  }

  // ON NE RESYNCHRONISE QUE SI QUELQUE CHOSE A PU BOUGER.
  //
  // La resynchronisation coûte 3,6 ms par image sur 5 000 objets, et c'est incompressible : une
  // passe d'arbre plus 4 900 comparaisons de matrices. Mais dans l'éditeur AU REPOS, rien ne
  // peut bouger, et ces 3,6 ms sont entièrement perdues — c'est l'état dans lequel on regarde
  // son niveau, on tourne la caméra, on cherche un objet.
  //
  // La condition est EXACTE, pas heuristique. Trois façons, et trois seulement, qu'une source
  // regroupée se déplace :
  //   · une lecture ou une simulation tourne (`moving`) ;
  //   · le gizmo tire la sélection — ou un groupe dont des sources regroupées descendent — et
  //     la sélection n'est jamais vide dans ce cas ;
  //   · une mutation vient d'avoir lieu, et `pushHistory()` l'a signalée en posant `dirty`.
  //     C'est le seul point de passage des 122 sites de mutation de scène, y compris ceux du
  //     copilote et de l'inspecteur.
  // Hors de ces trois cas, les matrices du lot sont celles de la dernière reconstruction, et
  // elles sont justes.
  const peutBouger = !!moving || editorBatching.dirty
    || (editorBatching.detached && editorBatching.detached.length > 0);
  if(peutBouger) updateInstances();
  return summaryInstances();
}

// EXPOSÉ EN GLOBALE, à dessein — même régime que js/render-perf.js. `markBatchingDirty` est
// appelée par js/history.js et `setBatchingEdited` par js/selection.js ; ni l'un ni l'autre ne
// peut importer ce fichier sans fabriquer un cycle avec js/viewport.js.
globalThis.markBatchingDirty = markBatchingDirty;
globalThis.setBatchingEdited = setBatchingEdited;
globalThis.stopBatching = stopBatching;
