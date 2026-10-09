// LA GARDE DU PASSAGE AUX MODULES ES.
//
// Ce que ce test mesure : les endroits où un fichier, PENDANT SON ÉVALUATION (donc au premier
// niveau, hors de toute fonction), lit une liaison non hissée — un `const`, un `let`, une
// `class` — déclarée par un fichier qui, dans l'ordre d'évaluation des modules, passe APRÈS lui.
//
// Pourquoi ça compte : aujourd'hui tout `js/` vit en portée globale, et l'ordre des 154 balises
// <script> de `editor.html` suffit à garantir que la liaison existe au moment où on la lit. En
// modules ES, cet ordre n'est plus choisi à la main : il est déduit du graphe d'imports, et le
// graphe de ce dépôt contient 408 cycles. Chacune de ces lectures devient alors une
// ReferenceError de zone morte temporelle, AU DÉMARRAGE — et comme le projet n'automatise aucun
// navigateur, rien d'autre que ce test ne la verrait venir.
//
// LE COMPTE EST À ZÉRO, et il doit y rester. Il est passé par 28 (cinq câblages DOM posés à la
// marge de leur fichier, déplacés dans des `bind…()` appelées par `startup.js`) puis par 10 (les
// inscriptions `Registry.registerClass` / `NodeShells.register` des fichiers de composants,
// réglées en sortant `Registry` et `NodeShells` vers `js/component-registry.js` — un module sans
// dépendance, donc évalué en premier quoi qu'il arrive).
//
// La règle de ce test : zéro, strictement. Un câblage au premier niveau qui lit un `const` d'un
// autre fichier est une régression, même si l'éditeur démarre encore aujourd'hui — il ne
// démarrerait plus une fois en modules ES, et rien d'autre ne le dirait.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluationRisks } from '../outils/esm.mjs';

// Mesuré le 2026-09-11 : 28 → 10 (câblages DOM différés) → 0 (extraction du registre).
const PLAFOND = 0;

test('aucune lecture risquee au premier niveau', () => {
  const parPage = evaluationRisks();
  const total = [...parPage.values()].reduce((n, l) => n + l.length, 0);
  const detail = [...parPage.values()].flat()
    .map((r) => '  ' + r.f + ':' + r.n + ' lit ' + r.genre + ' `' + r.nom + '` de ' + r.fournisseur)
    .join('\n');
  assert.ok(total <= PLAFOND,
    'le nombre de lectures risquees est passe de ' + PLAFOND + ' a ' + total + ' :\n' + detail
    + '\n\nUn cablage au premier niveau qui lit un `const` d un autre fichier ne tient que par'
    + ' l ordre des <script>. Le placer dans une fonction appelee par startup.js.');
});

test('les pages de JEU restent a zero', () => {
  // Le jeu publié n'a pas de `startup.js` où différer quoi que ce soit : une lecture risquée y
  // serait bien plus coûteuse à corriger. Le zéro d'aujourd'hui se garde donc strictement.
  const parPage = evaluationRisks();
  for(const [page, risques] of parPage){
    if(page === 'editor.html') continue;
    assert.equal(risques.length, 0,
      page + ' doit rester sans lecture risquee au premier niveau');
  }
});

test('les cablages DOM deplaces ne sont plus a la marge de leur fichier', () => {
  // La garde de la correction elle-même : ces cinq-là ont été déplacés dans des `bind…()`
  // appelées par `startup.js`, et les remettre à la marge relancerait le problème en silence.
  const parPage = evaluationRisks();
  const editeur = parPage.get('editor.html') || [];
  for(const nom of ['renderer', 'viewEl', 'inspBody', 'assetSelected']){
    const restant = editeur.filter((r) => r.nom === nom);
    assert.equal(restant.length, 0,
      '`' + nom + '` est de nouveau lu au premier niveau : '
      + restant.map((r) => r.f + ':' + r.n).join(', '));
  }
});
