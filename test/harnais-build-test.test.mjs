import { deEsm } from './engine-env.mjs';
// moteur/test/harnais-build-test.test.mjs
// GARDE anti-fossile sur moteur/build-test/.
//
// Ce dossier a longtemps contenu une COPIE FIGÉE du runtime — 27 Ko contre 106 Ko au vrai
// js/game-runtime.js — et son propre vendor/ en three r128 alors que le dépôt est en r185
// (mesuré : THREE.REVISION de chaque bundle). « Tester le build » y revenait donc à exercer
// un autre moteur, sur une autre version de three, sans que rien ne le dise. C'est
// exactement le terrain sur lequel une divergence éditeur/runtime survit des mois.
//
// La copie est supprimée : build-test/index.html charge maintenant les VRAIS fichiers du
// dépôt. Reste le risque suivant, plus discret : que la page du harnais et celle que
// fabrique l'exportateur (pageIndexBuild, js/build.js) DÉRIVENT. Un <script> ajouté à
// l'export et oublié ici, et le harnais recommence à tester autre chose que le build.
//
// Ce test interdit cette dérive : le harnais doit être, au caractère près, la page de
// l'exportateur avec les chemins réécrits vers le dépôt. Rien d'autre n'est toléré.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const racineMoteur = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(racineMoteur, rel), 'utf8').replace(/\r\n/g, '\n');

// Le build exporte est a plat (tout a la racine du ZIP) ; le harnais, lui, vit dans le
// depot et doit remonter d'un cran vers les sources reelles. Seule difference admise.
//
// UNE REGLE, pas une table. Cette table existait, a 60 lignes recopiees a la main -- le meme
// defaut que la double liste de `js/build.js` (voir docs/REVUE_2026-09-10.md SS 1.2) : ajouter un
// module au build obligeait a l'ajouter ici aussi, et l'oublier faisait echouer le test pour la
// mauvaise raison. Les chemins se DEDUISENT : ce qui est deja dans `vendor/` ou `vendor-esm/`
// garde sa place, `runtime.js` est le seul renommage, tout le reste vient de `js/`.
const RENOMMES_BUILD = {'runtime.js': '../js/game-runtime.js'};

function cheminHarnais(url){
  if(RENOMMES_BUILD[url]) return RENOMMES_BUILD[url];
  if(url.startsWith('vendor/') || url.startsWith('vendor-esm/')) return '../' + url;
  if(url === 'data.js') return url;                     // la fixture a la sienne
  return '../js/' + url;
}

/** La page de l'exportateur, chemins reecrits vers le depot. */
function reecrirePourHarnais(html){
  return html.replace(/\r\n/g, '\n')
    .replace(/"\.\/vendor-esm\//g, '"../vendor-esm/')
    .replace(/src="([^"]+)"/g, function(_, url){ return 'src="' + cheminHarnais(url) + '"'; });
}



// Nom du project embarqué dans la fixture : c'est lui que l'exportateur met dans le <title>.
function nomProjetFixture(){
  const bac = { window: {} };
  vm.runInContext(deEsm(read('build-test/data.js')), vm.createContext(bac), { filename: 'data.js' });
  assert.ok(bac.window.GAME_DATA, 'build-test/data.js ne définit plus window.GAME_DATA');
  // Le nom du projet a rejoint `settings` au format v15 ; le repli garde le test lisible
  // face à une fixture régénérée depuis un export antérieur.
  const d = bac.window.GAME_DATA;
  return (d.settings && d.settings.name) || d.projectName;
}

// pageIndexBuild() vient du vrai js/build.js ; escapeHtml() du vrai js/escape-html.js (un stub
// pourrait échapper autrement et faire diverger le <title> pour de mauvaises raisons).
// Il vivait dans js/objects.js jusqu'a la v0.157.0 — extrait en module feuille, parce qu'il en
// existait deux exemplaires et qu'un troisieme allait naitre.
function pageExportee(title){
  const source = read('js/escape-html.js');
  const start = source.indexOf('function escapeHtml(s){');
  assert.notEqual(start, -1, 'escapeHtml introuvable dans js/escape-html.js');
  const end = source.indexOf('\n}\n', start);
  const bac = { console };
  bac.globalThis = bac;
  const ctx = vm.createContext(bac);
  vm.runInContext(source.slice(start, end + 3), ctx, { filename: 'escapeHtml' });
  vm.runInContext(deEsm(read('js/build.js')), ctx, { filename: 'js/build.js' });
  return vm.runInContext('pageIndexBuild(' + JSON.stringify(title) + ')', ctx);
}

test('le harnais build-test ne contient AUCUNE copie de code moteur', () => {
  const folder = path.join(racineMoteur, 'build-test');
  const inputs = readdirSync(folder, { withFileTypes: true }).map((e) => (e.isDirectory() ? e.name + '/' : e.name));
  const attendu = ['data.js', 'index.html'];
  assert.deepEqual(inputs.slice().sort(), attendu,
    'build-test/ ne doit contenir que la page du harnais et sa fixture. Tout .js de moteur, '
    + 'tout vendor/ local, est une copie qui recommencera à diverger en silence — c\'est '
    + 'précisément ce qui s\'est produit avec runtime.js (27 Ko figés) et three r128.');
});

test('le harnais charge le VRAI runtime, pas une copie', () => {
  const html = read('build-test/index.html');
  // Plus de `defer` attendu : les fichiers du moteur sont des modules ES, et un module est
  // différé par nature. Ce qui compte reste le même — la page charge le VRAI runtime.
  assert.match(html, /<script[^>]*\ssrc="\.\.\/js\/game-runtime\.js"[^>]*>/,
    'la page doit charger ../js/game-runtime.js');
  assert.doesNotMatch(html, /src="runtime\.js"/, 'plus aucune référence à un runtime.js local');
});

test('le harnais est la page de l\'exportateur, aux chemins pres', () => {
  const title = nomProjetFixture();
  let attendu = reecrirePourHarnais(pageExportee(title));

  // Le harnais s'explique en tête de <head> ; ces commentaires ne font pas partie de la
  // page exportée et sont retirés avant comparaison.
  //
  // Retrait par SPANS, et non line à line. L'ancien filtre `/^<!--.*-->$/` ne supprimait
  // qu'une ligne ENTIÈREMENT commentée : un commentaire open sur une ligne et fermé sur
  // une autre laissait passer tout ce qu'il enrobe. Concrètement, une balise <script>
  // commentée sur plusieurs lines survivait à la normalisation — la comparaison restait
  // donc vraie même quand le harnais avait dérivé du build réel. La garde était aveugle
  // exactement au cas qu'elle devait attraper.
  const sansCommentaires = function(s){
    return s.replace(/<!--[\s\S]*?-->/g, '')
      .split('\n').filter(function(l){ return l.trim() !== ''; }).join('\n');
  };
  const obtenu = sansCommentaires(read('build-test/index.html'));
  attendu = sansCommentaires(attendu);

  assert.equal(obtenu, attendu,
    'build-test/index.html a dérivé de pageIndexBuild() (js/build.js). Le harnais doit rester '
    + 'l\'image exacte du build publié, sinon il valide autre chose que ce que jouent les '
    + 'joueurs. Régénérer : reprendre la sortie de pageIndexBuild(projectName) et apply les '
    + 'réécritures de chemins listées dans ce test.');
});
