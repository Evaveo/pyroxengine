import { deEsm } from './engine-env.mjs';
// moteur/test/runtime-partage.test.mjs
// GARDE sur les fichiers PARTAGÉS du runtime.
//
// Le même code de jeu tourne dans TROIS contextes : le mode jeu de l'éditeur
// (game-preview.html), le build exporté (js/build.js) et le harnais (build-test/index.html,
// couvert par harnais-build-test.test.mjs). Ajouter un fichier partagé demande donc de le
// déclarer partout — et c'est exactement ce qui a été raté : `js/shader-graph.js` avait été
// embarqué dans le build mais pas dans jeu-preview.html, si bien que lancer le jeu depuis
// l'éditeur mourait sur « buildMaterialFromGraph is not defined » alors que le build
// exporté, lui, marchait. Le symptôme n'apparaît qu'au démarrage d'une partie : aucun test ne
// le voyait.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSources, embeddedInBuild } from './build-modules.mjs';

const racineMoteur = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => deEsm(readFileSync(path.join(racineMoteur, rel), 'utf8'));

// Les `js/...` embarqués par le build : la définition de « ce que le jeu publié embarque », donc
// de ce dont le jeu a besoin pour tourner. La LECTURE de la table vit dans
// test/build-modules.mjs — quatre tests la refaisaient chacun à leur façon, et changer la forme
// de la table dans js/build.js les cassait tous les quatre pour la même raison.
function fichiersJsDuBuild(){
  return buildSources();
}

test('tout fichier js embarque dans le build est aussi charge par le mode jeu de l editeur', () => {
  const preview = read('game-preview.html');
  const missing = fichiersJsDuBuild().filter(function(f){
    // le `?v=NNN` d'anti-cache fait partie de l'URL : on compare le CHEMIN, pas la query
    return preview.indexOf('"' + f + '"') === -1 && preview.indexOf('"' + f + '?v=') === -1;
  });
  assert.deepEqual(missing, [],
    'files embarqués par le build mais absents d\'game-preview.html — le mode jeu de '
    + 'l\'éditeur plantera là où le build exporté fonctionne');
});

test('ET RECIPROQUEMENT : tout fichier js du mode jeu est embarque par le build', () => {
  // LE SENS QUI MANQUAIT, et par lequel `js/shadow-fit.js` est passé pendant des versions :
  // chargé par editor.html ET par game-preview.html, jamais embarqué par le build. Comme
  // `rtUpdateShadows()` commence par `if(typeof ShadowFit === 'undefined') return;`, le cadrage
  // des ombres directionnelles marchait dans l'aperçu ▶ Jouer et ne tournait JAMAIS dans un jeu
  // exporté — sans un seul message. Le test d'au-dessus, lui, ne regardait que build ⊆ aperçu :
  // un fichier absent du build sortait des deux ensembles à la fois, donc n'était refusé nulle
  // part. Voir docs/REVUE_2026-09-10.md § 1.1.
  const preview = read('game-preview.html').replace(/\r\n/g, '\n');
  const charges = [...preview.matchAll(/<script[^>]*\ssrc="(js\/[A-Za-z0-9_\/.-]+)(?:\?v=\d+)?"/g)]
    .map((m) => m[1]);
  assert.ok(charges.length >= 40, 'seulement ' + charges.length + ' scripts lus — motif changé ?');

  // Ce que le mode jeu charge SANS que le build en ait besoin. `game-runtime.js` y est sous son
  // nom de source et devient `runtime.js` dans le ZIP : `embeddedInBuild` connaît le renommage.
  const absents = charges.filter((f) => !embeddedInBuild(f));
  assert.deepEqual(absents, [],
    'Ces fichiers sont chargés par game-preview.html et le build ne les embarque PAS. Le jeu\n'
    + 'exporté tournera sans eux : soit il plante, soit — bien pire — une garde\n'
    + '`typeof X === "undefined"` éteint la fonctionnalité en silence, et seul le joueur le voit.\n'
    + absents.join('\n'));
});

test('le mode game charge shader-graph.js AVANT game-runtime.js qui s en sert', () => {
  const preview = read('game-preview.html');
  const iGraphe = preview.indexOf('js/shader-graph.js');
  const iRuntime = preview.indexOf('js/game-runtime.js');
  assert.notEqual(iGraphe, -1, 'shader-graph.js doit être chargé par le mode game');
  assert.ok(iGraphe < iRuntime, 'shader-graph.js doit précéder game-runtime.js');
});

test('game-runtime.js n appelle que des fonctions partagees reellement embarquees', () => {
  // Contrôle ciblé sur le pont graphe de shader, la dépendance la plus récente et celle qui
  // vient de casser : la fonction appelée doit être définished dans un fichier embarqué.
  const runtime = read('js/game-runtime.js');
  if(runtime.indexOf('buildMaterialFromGraph') === -1) return;   // plus utilisée : rien à garder
  assert.ok(fichiersJsDuBuild().indexOf('js/shader-graph.js') !== -1,
    'game-runtime.js appelle buildMaterialFromGraph : js/shader-graph.js doit être embarqué');
  assert.ok(read('js/shader-graph.js').indexOf('function buildMaterialFromGraph') !== -1,
    'buildMaterialFromGraph doit être définished dans js/shader-graph.js');
});
