// ---------- « Le projet a-t-il des modifications non enregistrées ? » ----------
//
// Le drapeau existait déjà à moitié : `autosave.modifie` (js/autosave.js) sert la sauvegarde
// automatique en IndexedDB, et c'est ELLE qui le remet à false. Il ne répond donc pas à la
// question posée ici — un projet autosauvé se dirait « enregistré » alors que rien n'est allé
// sur le disque de l'utilisateur. Les deux drapeaux vivent côte à côte, chacun avec SON
// évènement de remise à zéro : l'autosave pour l'un, l'écriture dans le dossier pour l'autre.
//
// Ce module n'importe RIEN. C'est ce qui permet à js/history.js (posé à chaque mutation) et à
// js/serialization.js (remis à zéro à l'écriture) de l'appeler tous les deux sans créer de
// cycle d'imports, et de le charger dans un vm nu pour les tests.

export const projectSave = {
  unsaved: false,
  /** L'enregistrement en cours, ou null. `{done, total, label}` — voir startSave(). */
  progress: null
};

/**
 * Les étapes d'un enregistrement, et leur POIDS.
 *
 * Un pourcentage qui compte les étapes à parts égales ment : sur un gros projet, construire les
 * données (sérialisation de toutes les scènes) et écrire les fichiers d'assets prennent les
 * dix-neuf vingtièmes du temps, pendant que le manifeste part en un instant. Une barre qui
 * saute à 66 % puis s'immobilise une minute est pire que pas de barre — elle dit que c'est
 * presque fini. Les poids ci-dessous sont grossiers, mais ils vont dans le bon sens, et les
 * fichiers (la partie vraiment longue) sont comptés UN PAR UN, donc la barre y avance vraiment.
 */
export const STEPS_SAVE = [
  {key: 'build',    weight: 4, label: 'Préparation des données'},
  {key: 'manifest', weight: 1, label: 'Manifeste et scène'},
  {key: 'files',    weight: 5, label: 'Fichiers du projet'}
];

const WEIGHT_TOTAL = STEPS_SAVE.reduce(function(n, s){ return n + s.weight; }, 0);

/**
 * La fraction accomplie, entre 0 et 1.
 *
 * `done` est l'index de l'étape en cours, `ratio` sa propre avancée (0 à 1) — c'est ce qui
 * permet aux fichiers de faire monter la barre à chaque écriture au lieu d'un seul bond à la
 * fin. Séparé du DOM pour être mesurable sans navigateur (test/save-progression.test.mjs).
 */
export function fractionSave(stepIndex, ratio){
  let acquis = 0;
  for(let i = 0; i < stepIndex && i < STEPS_SAVE.length; i++) acquis += STEPS_SAVE[i].weight;
  const current = STEPS_SAVE[stepIndex];
  if(current) acquis += current.weight * Math.max(0, Math.min(1, ratio || 0));
  return Math.max(0, Math.min(1, acquis / WEIGHT_TOTAL));
}

/** Le bouton de la barre du haut, si la page en a un. Silencieux sinon (build de jeu, tests). */
function elSaveState(){
  return (typeof document !== 'undefined') ? document.getElementById('btn-save-state') : null;
}

export function refreshIndicatorSave(){
  const el = elSaveState();
  if(!el) return;
  const p = projectSave.progress;

  // PENDANT L'ENREGISTREMENT, le bouton devient la barre. Poser une seconde zone ailleurs dans
  // la barre du haut aurait demandé de la chercher : l'attente est à l'endroit exact où on
  // vient de cliquer.
  el.classList.toggle('saving', !!p);
  el.classList.toggle('unsaved', !p && projectSave.unsaved);
  el.disabled = !!p;
  if(p){
    const pct = Math.round(p.fraction * 100);
    // La barre est un fond dégradé piloté par une variable CSS : pas de second élément à créer,
    // donc `textContent` reste libre d'écrire le pourcentage sans détruire la barre.
    el.style.setProperty('--save-progress', pct + '%');
    el.textContent = '💾 Enregistrement… ' + pct + ' %';
    el.title = p.label + ' — ' + pct + ' %';
    return;
  }
  el.style.removeProperty('--save-progress');
  // Le libellé DIT L'ÉTAT, pas l'action : « Enregistrer » seul laisserait croire qu'il faut
  // cliquer même quand tout est écrit. L'icône accompagne le mot, elle ne le remplace pas.
  el.textContent = projectSave.unsaved ? '💾 À enregistrer' : '✓ Enregistré';
  el.title = projectSave.unsaved
    ? 'Modifications non enregistrées — cliquez pour enregistrer dans le dossier du projet'
    : 'Toutes les modifications sont enregistrées dans le dossier du projet';
}

export function markProjectUnsaved(){
  if(projectSave.unsaved || projectSave.progress) return;   // rien à retoucher dans le DOM
  projectSave.unsaved = true;
  refreshIndicatorSave();
}

export function markProjectSaved(){
  projectSave.unsaved = false;
  refreshIndicatorSave();
}

/**
 * Ouvre un enregistrement et rend son rapporteur d'avancement.
 *
 * `report(key, ratio)` : l'étape atteinte et son avancée. `endSave()` le referme — TOUJOURS,
 * y compris en échec, sinon le bouton reste bloqué sur « Enregistrement… » et l'utilisateur n'a
 * plus aucun moyen de réessayer (d'où le `finally` chez l'appelant).
 */
export function startSave(){
  projectSave.progress = {fraction: 0, label: STEPS_SAVE[0].label};
  refreshIndicatorSave();
  return function report(key, ratio){
    if(!projectSave.progress) return;
    const i = STEPS_SAVE.findIndex(function(s){ return s.key === key; });
    if(i < 0) return;
    projectSave.progress.fraction = fractionSave(i, ratio);
    projectSave.progress.label = STEPS_SAVE[i].label;
    refreshIndicatorSave();
  };
}

export function endSave(){
  projectSave.progress = null;
  refreshIndicatorSave();
}
