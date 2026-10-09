// ---------- Repli silencieux d'une garde `typeof` ----------
// Le moteur n'a pas de build : ~250 gardes `typeof X === 'undefined'` protègent l'appel à un
// module optionnel (retiré par build-trimming.js) ou simplement pas encore chargé à ce point de
// l'exécution. La plupart sont légitimes — mais quand la dépendance est en réalité TOUJOURS
// requise (fichier oublié dans le build, faute de frappe dans le nom), le repli ne dit rien :
// c'est exactement ce qui a rendu shadow-fit.js absent du build invisible pendant des versions
// (docs/REVUE_2026-09-10.md § 1.1).
//
// SANS IMPORT, à dessein (même contrat que script-scope.js) : appelable depuis n'importe quel
// fichier sans entrer dans le graphe de modules ni risquer un cycle.
//
// Ce module ne DISTINGUE PAS le cas légitime du cas cassé — seul l'appelant le sait. Il ne
// s'applique donc qu'aux sites où l'absence est structurellement suspecte (un module du cœur du
// moteur, pas un plugin optionnel), pas à tous les `typeof` du dépôt.

const vus = new Set();

// Journalise UNE FOIS par nom et par session (évite le bruit d'un repli appelé à chaque image),
// dans la console du NAVIGATEUR (outil de développement) — pas la Console éditeur, qui est un
// texte destiné à l'utilisateur final.
//
// `moduleFile` : le fichier qui fournit `name`, tel que build-trimming.js le nomme (`dans`). Un jeu
// publie ALLEGE retire volontairement les modules dont sa scene n'a pas besoin, et en pose la
// liste dans `globalThis.ENGINE_TRIMMED_MODULES` (build.js:pageIndexBuild). Pour ces fichiers,
// l'absence est la decision de l'exportateur, pas une panne : se taire. Sans ce filtre, chaque
// jeu sans physique ni animator avertissait « dependance absente » pour CANNON et
// updatePlayerAnimator dans la console du joueur.
export function warnOnceMissing(name, moduleFile){
  if(moduleFile && (globalThis.ENGINE_TRIMMED_MODULES || []).includes(moduleFile)) return;
  if(vus.has(name)) return;
  vus.add(name);
  console.warn('[moteur] dépendance absente au moment de l\'appel : "' + name
    + '" — repli silencieux ignoré. Si ce module devrait être chargé ici, voir build.js / '
    + 'editor.html / l\'ordre de chargement.');
}
