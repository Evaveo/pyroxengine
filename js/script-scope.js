// ---------- LE POINT DE COMPILATION UNIQUE D'UN SCRIPT DE PROJET ----------
// ---------- PARTAGÉ éditeur ↔ jeu publié ----------
//
// ⚠ CE FICHIER A MASQUÉ DES GLOBALES EN v0.149.4. LA LISTE EST VIDE DEPUIS LA v0.150.1, ET
// C'EST UN RETRAIT ASSUMÉ, PAS UN OUBLI. Lire ce qui suit avant de vouloir la re-remplir.
//
// ---------- POURQUOI LE MASQUAGE A ÉTÉ RETIRÉ ----------
//
// La v0.149.4 masquait `fetch`, `localStorage`, `document`, `window`, `Function`… dans la portée
// d'un script, en les passant en paramètres laissés vides. La prémisse était : « un script de
// GAMEPLAY n'a rien à faire dans le DOM — il a `api` ». Elle est FAUSSE, et la mesure qui
// l'avait validée était trop étroite (elle n'avait regardé qu'un dossier de scripts sur deux).
//
// Les scripts de projet réels pilotent l'INTERFACE HTML du jeu — c'est la fonctionnalité
// UIDocument, l'une des raisons d'être du moteur. Mesuré sur les scripts de `jeux/` :
// `document` 84 fois, `window` 86, `open` 26, `localStorage` 12. Le masquage a cassé
// « Interface » de Chromélo dès le premier lancement : `Cannot read properties of undefined
// (reading 'getElementById')`, trois scripts d'un coup.
//
// ET IL ÉTAIT DE TOUTE FAÇON ILLUSOIRE. C'est le point qui tranche, indépendamment de la
// régression : à partir du moment où `document` et `window` DOIVENT rester disponibles,
// `window.fetch` et `window.localStorage` le sont aussi. Masquer les identifiants nus n'arrêtait
// donc personne — ça ne gênait que le code honnête, tout en donnant l'impression d'une
// protection. Une garde qu'on croit étanche est pire qu'une garde absente.
//
// ---------- CE QUI PROTÈGE VRAIMENT ----------
//
// `js/script-trust.js` : on ne masque pas ce qu'un script peut faire, on DEMANDE avant
// d'exécuter du code qu'on n'a pas écrit. C'est la seule parade qui tienne, et elle ne repose
// sur aucune hypothèse quant à ce dont un script a besoin.
//
// ---------- LE MODÈLE DE MENACE, qui lui reste vrai ----------
//
//   · UN SCRIPT VOYAGE DANS LE FICHIER DE PROJET. Ouvrir le projet de quelqu'un d'autre, c'est
//     exécuter son code. C'est le vecteur.
//   · UN PLUGIN NE VOYAGE PAS. Il vit dans `localStorage['moteur3d-plugins']` (js/plugins.js),
//     collé délibérément — même geste, même confiance que coller du code dans la console. La
//     sérialisation ne référence que des NOMS DE TYPES de plugin, jamais du code.
//
// ---------- POURQUOI CE FICHIER SURVIT QUAND MÊME ----------
//
// Le masquage est parti ; le POINT DE COMPILATION UNIQUE reste, et il vaut à lui seul le
// fichier. Les deux moteurs compilaient chacun leur script avec leur propre `new Function`, et
// toute divergence entre les deux donne un script qui marche à l'essai et casse chez le joueur —
// la forme de défaut la plus coûteuse du dépôt (docs/KNOWN_ISSUES.md).
//
// ---------- SI VOUS VOULEZ RE-REMPLIR LA LISTE ----------
//
// Deux conditions, et la première a déjà manqué une fois :
//   1. mesurer sur TOUS les scripts de projet du dépôt (`find jeux -path "*/assets/Scripts/*"`),
//      pas sur un dossier choisi au hasard ;
//   2. expliquer ce que le masquage arrête ALORS QUE `window` reste accessible. Sans réponse à
//      cette question-là, le masquage ne protège de rien.
//
// NE JAMAIS Y METTRE `eval` NI `arguments` (interdits comme noms de paramètre en mode strict :
// SyntaxError sur TOUT script), ni un mot-clé comme `import`.
export const GLOBALS_HIDDEN = [];

/**
 * Compile un script de projet.
 *
 * `corps` est le code de l'utilisateur, `queue` ce que le moteur ajoute après (le `return` qui
 * récupère `start`/`update`). Les noms de `GLOBALS_HIDDEN` deviennent des paramètres laissés
 * vides à l'appel — le mécanisme reste, la liste est vide, voir l'en-tête.
 *
 * LES DEUX MOTEURS PASSENT PAR ICI, et c'est ce qui justifie le fichier : une divergence de
 * compilation entre l'éditeur et le jeu publié donnerait un script qui marche à l'essai et
 * casse chez le joueur — la forme de défaut la plus coûteuse du dépôt (docs/KNOWN_ISSUES.md).
 */
export function compileScript(corps, queue){
  const fabrique = new Function('api', ...GLOBALS_HIDDEN,
    '"use strict";\n' + corps + (queue || ''));
  return function(api){ return fabrique(api); };
}
