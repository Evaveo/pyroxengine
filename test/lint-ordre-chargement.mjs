// LINT D'ORDRE DE CHARGEMENT — version modules ES.
//
// CE QUE CE FICHIER FAISAIT, ET POURQUOI IL NE POUVAIT PLUS LE FAIRE. Il lisait l'ordre des
// balises <script> de `editor.html` et vérifiait qu'aucun fichier ne référence, au premier
// niveau, un symbole déclaré par un fichier chargé APRÈS lui. C'était la garde de la régression
// du commit 60f35f3 : `objects.js` appelait `NodeShells.register(...)` alors que
// `component.js`, qui déclare `NodeShells`, venait plus loin — ReferenceError au chargement, et
// tout le reste du fichier perdu, sans que rien ne le signale.
//
// Depuis le passage aux modules ES, la prémisse est fausse : l'ordre d'exécution ne se lit plus
// dans l'ordre des balises, il se DÉDUIT du graphe d'imports. Un fichier peut parfaitement
// citer un symbole d'un fichier listé plus bas dans la page — son `import` garantit que le
// module sera évalué avant. Garder l'ancienne logique aurait produit du bruit, et un lint qui
// crie à tort est un lint qu'on finit par ignorer.
//
// LA MESURE EST DONC DÉLÉGUÉE à `outils/esm.mjs --risques`, qui répond à la même question en
// plus juste : il calcule l'ordre d'évaluation réel des modules, distingue ce qui est HISSÉ
// (`function`, `var` — sûrs même dans un cycle) de ce qui ne l'est pas (`const`, `let`,
// `class`), et ne signale qu'une lecture réellement dangereuse. La classe de bugs gardée est la
// même ; la méthode est celle qui reste vraie après la migration.
//
// Il tourne AVANT la suite (`npm test`), à sa place d'avant : une erreur ici est un démarrage
// cassé, et il vaut mieux le savoir avant les 1509 tests que pendant.

import { evaluationRisks } from '../outils/esm.mjs';

const parPage = evaluationRisks();
const problemes = [];
for (const [page, risques] of parPage) {
  for (const r of risques) {
    problemes.push(page + ' — ' + r.f + ':' + r.n + ' lit ' + r.genre + ' « ' + r.nom
      + ' » de ' + r.fournisseur + ', évalué APRÈS lui');
  }
}

if (problemes.length) {
  console.error('Lint ordre de chargement : ' + problemes.length + ' lecture(s) risquée(s) au '
    + 'premier niveau\n' + problemes.join('\n')
    + '\n\nUn câblage au premier niveau qui lit un `const` d\'un autre module ne tient que par '
    + 'la chance de l\'ordre d\'évaluation. Le placer dans une fonction appelée par startup.js, '
    + 'ou sortir le symbole vers un module sans dépendance (voir js/component-registry.js).');
  process.exit(1);
}

let n = 0;
for (const risques of parPage.values()) n += risques.length;
console.log('Lint ordre de chargement : OK (' + parPage.size + ' pages, ' + n
  + ' lecture risquée)');
