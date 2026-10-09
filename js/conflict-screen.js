// ---------- Écran de résolution de conflit ----------
// Le serveur refuse un enregistrement en 409 quand un collègue a touché un fichier que je
// touche aussi, et il nomme ces fichiers. Jusqu'ici l'éditeur les affichait dans un message de
// statut de neuf secondes : on apprenait qu'on avait perdu, sans rien à faire de l'information
// et sans aucun moyen d'enregistrer. Cet écran rend l'arbitrage à qui le doit.
//
// CE QU'IL NE FAIT PAS : il ne fusionne aucun contenu. Deux personnes qui ont déplacé le même
// objet dans la même scène ont deux scènes entières différentes, et il n'existe pas de fusion
// à trois branches d'un fichier de scène — prétendre le contraire produirait des scènes
// invalides, silencieusement. Le choix est donc par FICHIER, et il est entier.
//
// LE DÉFAUT NE DÉTRUIT RIEN : un fichier dont on ne dit rien garde la version du collègue.
// Un écran d'arbitrage qui écrase par défaut est un écran qui écrase.
import { resolveConflict } from './cloud-project.js';
// `escapeHtml` vient d'un module FEUILLE : il en existait deja deux exemplaires ecrits
// differemment (objects.js, hub/hub-ui.js), et l'importer d'objects.js tirait THREE puis
// l'editeur entier — cet ecran serait devenu intestable seul.
import { escapeHtml } from './escape-html.js';

function sizeOf(entry){
  if(!entry) return 'absent';
  const n = entry.size || 0;
  if(n < 1024) return n + ' o';
  if(n < 1024 * 1024) return Math.round(n / 1024) + ' Ko';
  return (n / (1024 * 1024)).toFixed(1) + ' Mo';
}

/**
 * Le corps HTML de l'écran. Séparé du reste pour être vérifiable sans modale ni réseau.
 *
 * @param conflicts chemins en conflit, dans l'ordre où le serveur les a nommés
 * @param mine      mon manifeste  { chemin -> {sha, size} }
 * @param head      le manifeste de tête (celui du collègue)
 * @param who       e-mail du collègue, ou null
 */
export function conflictScreenHtml(conflicts, mine, head, who){
  const author = who ? escapeHtml(who) : 'un collègue';
  const rows = (conflicts || []).map((path) => {
    const id = 'cft-' + encodeURIComponent(path).replace(/[^a-zA-Z0-9]/g, '_');
    return '<tr>'
      + '<td class="cft-path">' + escapeHtml(path) + '</td>'
      + '<td><label><input type="radio" name="' + id + '" value="theirs" checked> '
      + 'La sienne <span class="none">(' + sizeOf(head[path]) + ')</span></label></td>'
      + '<td><label><input type="radio" name="' + id + '" value="mine"> '
      + 'La mienne <span class="none">(' + sizeOf(mine[path]) + ')</span></label></td>'
      + '</tr>';
  }).join('');

  // « La derniere version, enregistree par X » et non « X a modifie ce fichier » : le serveur
  // envoie l'auteur de la DERNIERE VERSION, qui n'est pas forcement celui qui a touche le
  // fichier dispute (il a pu arriver par une fusion anterieure). Affirmer le second serait
  // faux une fois sur deux, et personne ne le verifierait.
  return '<p>La dernière version enregistrée — par ' + author + ' — touche '
    + (conflicts.length > 1 ? 'ces fichiers' : 'ce fichier')
    + ', que vous avez modifié' + (conflicts.length > 1 ? 's' : '') + ' de votre côté. '
    + 'Choisissez, fichier par fichier, la version à garder.</p>'
    + '<p class="none">Les fichiers que vous avez modifiés SANS conflit sont enregistrés dans '
    + 'tous les cas, et ceux que les autres ont modifiés de leur côté sont conservés : seule '
    + 'la liste ci-dessous se décide.</p>'
    + '<table id="cft-table"><thead><tr><th>Fichier</th><th>Version enregistrée</th>'
    + '<th>Votre version</th></tr></thead><tbody>' + rows + '</tbody></table>'
    + '<p class="none">⚠ Garder la version enregistrée pour un fichier remplace ce que '
    + 'vous avez à l\'écran : le projet est rechargé après l\'enregistrement.</p>'
    + '<div class="cft-actions">'
    + '<button id="cft-all-theirs">Tout garder la version enregistrée</button>'
    + '<button id="cft-all-mine">Tout garder la mienne</button>'
    + '<button id="cft-cancel">Annuler</button>'
    + '<button id="cft-save" class="primary">Enregistrer</button>'
    + '</div>';
}

/** Lit les choix cochés dans un conteneur. Sortie : { chemin -> 'mine' | 'theirs' }. */
export function readChoices(root, conflicts){
  const out = {};
  (conflicts || []).forEach((path) => {
    const id = 'cft-' + encodeURIComponent(path).replace(/[^a-zA-Z0-9]/g, '_');
    const buttons = root.querySelectorAll ? root.querySelectorAll('input') : [];
    let chosen = 'theirs';
    Array.prototype.forEach.call(buttons, (b) => {
      if(b.name === id && b.checked) chosen = b.value;
    });
    out[path] = chosen;
  });
  return out;
}

/**
 * Ouvre l'écran et rend une promesse : { choices, manifest } si l'on enregistre, `null` si
 * l'on annule. Aucune écriture réseau ici — l'appelant enregistre, parce que c'est lui qui
 * sait quoi faire de l'échec suivant.
 *
 * `deps` rassemble tout ce qui vient de l'éditeur, pour que cette fonction soit testable :
 * { openModal, closeModal, getBody }.
 */
export function openConflictScreen({ conflicts, base, head, mine, who }, deps){
  const { openModal, closeModal, getBody } = deps;
  return new Promise((resolve) => {
    openModal('Conflit d\'enregistrement', conflictScreenHtml(conflicts, mine, head, who));
    const body = getBody();
    if(!body){ resolve(null); return; }

    const checkAll = (wanted) => {
      const buttons = body.querySelectorAll('input');
      Array.prototype.forEach.call(buttons, (b) => { b.checked = (b.value === wanted); });
    };
    const bind = (id, fn) => {
      const el = body.querySelector('#' + id);
      if(el) el.addEventListener('click', fn);
    };

    bind('cft-all-theirs', () => checkAll('theirs'));
    bind('cft-all-mine', () => checkAll('mine'));
    bind('cft-cancel', () => { closeModal(); resolve(null); });
    bind('cft-save', () => {
      const choices = readChoices(body, conflicts);
      closeModal();
      resolve({ choices, manifest: resolveConflict(base, head, mine, conflicts, choices) });
    });
  });
}
