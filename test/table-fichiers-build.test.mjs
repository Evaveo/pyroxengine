import { deEsm } from './engine-env.mjs';
// La table des modules du ZIP : ce qui est téléchargé, ce qui est publié, et sous quel nom.
//
// HISTOIRE DE CE FICHIER. `js/build.js` tenait DEUX listes parallèles — `sources` (les URL à
// télécharger) et `files` (la table du ZIP) — reliées par des index littéraux :
// `'components/component-collider.js': fflate.strToU8(textes[35])`. Rien ne rattachait le nom de
// gauche à l'URL de droite. Un décalage d'un cran publiait donc un fichier SOUS LE NOM D'UN
// AUTRE : le jeu téléchargeait `physics-2d.js` et recevait le contenu de `sprite-2d.js`. Ce n'est
// pas théorique — deux chantiers ont ajouté leur module au même index 17, et le seul symptôme
// était une page de jeu blanche dont le message désignait le mauvais fichier. Sept commentaires
// « A LA FIN » tenaient l'invariant à la main, et ce test comparait les deux listes index par
// index pour attraper leurs oublis.
//
// Le défaut n'existe plus : il n'y a qu'UNE table (`BUILD_MODULES`), le nom dans le ZIP se déduit
// de l'URL, et l'ordre n'a plus de sens. Ce test ne compare donc plus des index — il vérifie ce
// qui peut encore casser :
//   1. deux modules qui atterrissent sous le MÊME nom dans le ZIP ;
//   2. un renommage non déclaré (le nom du ZIP ne correspond pas à l'URL) ;
//   3. une balise `<script>` de la page publiée sans fichier dans le ZIP — un 404 chez le joueur ;
//   4. un fichier du ZIP que la page n'appelle jamais — du poids mort.
//
// (3) et (4) sont ce que l'ancienne version ne savait PAS voir, et c'est précisément par là que
// `js/shadow-fit.js` est passé : téléchargé par l'aperçu, jamais embarqué par le build, donc
// `rtUpdateShadows()` s'éteignait en silence dans tout jeu exporté. Voir
// docs/REVUE_2026-09-10.md § 1.1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildModules, buildOutputs } from './build-modules.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');

// Un fichier du ZIP peut légitimement être RENOMMÉ au passage. La table dit lesquels, pour que
// « le nom ne correspond pas » reste une erreur partout ailleurs.
const RENOMMES = { 'runtime.js': 'js/game-runtime.js' };

/**
 * Les fichiers que la page publiée SANS allègement réclame, par les deux voies possibles :
 * les `src="…"` des balises, et les cibles de l'importmap.
 *
 * L'importmap compte autant qu'une balise : `render-webgpu-bridge.mjs` fait
 * `import … from 'three/webgpu'`, que le navigateur résout vers `./vendor-esm/…`. Un paquet ESM
 * absent du ZIP est donc un 404 exactement comme une balise sans fichier — il n'apparaît
 * simplement pas dans un `src=`.
 */
function fichiersReclames(){
  // pageIndexBuild() vient du vrai js/build.js, et escapeHtml() du vrai js/escape-html.js : un
  // bouchon pourrait échapper autrement et faire diverger le <title> pour une mauvaise raison.
  // (Il vivait dans js/objects.js jusqu'a la v0.157.0, en double avec js/hub/hub-ui.js.)
  const objets = read('js/escape-html.js');
  const debut = objets.indexOf('function escapeHtml(s){');
  assert.notEqual(debut, -1, 'escapeHtml introuvable dans js/escape-html.js');
  const fin = objets.indexOf('\n}\n', debut);
  const bac = { console };
  bac.globalThis = bac;
  const ctx = vm.createContext(bac);
  vm.runInContext(objets.slice(debut, fin + 3), ctx, { filename: 'escapeHtml' });
  vm.runInContext(deEsm(read('js/build.js')), ctx, { filename: 'js/build.js' });
  const html = vm.runInContext('pageIndexBuild("Jeu")', ctx);
  const balises = [...html.matchAll(/src="([^"]+)"/g)].map((m) => m[1]);
  // Les cibles de l'importmap, `"./vendor-esm/x.js"` → `vendor-esm/x.js`. Plus `three.core`,
  // que le paquet `three/webgpu` importe lui-même : il n'est nommé nulle part dans la page,
  // et c'est bien pour ça qu'il doit être déclaré ici et pas deviné.
  const importmap = [...html.matchAll(/":\s*"\.\/(vendor-esm\/[^"]+)"/g)].map((m) => m[1]);
  return { balises: balises, importmap: importmap.concat(['vendor-esm/three.core.min.js']) };
}

test('AUCUN module du build n atterrit sous le nom d un autre', () => {
  const modules = buildModules();

  // Deux modules au même nom de sortie : le second écrase le premier dans le ZIP, et le premier
  // part avec le contenu du second. C'est le défaut exact qui s'est produit à l'index 17.
  const vus = new Map();
  const doubles = [];
  for(const m of modules){
    if(vus.has(m.out)) doubles.push(m.out + ' : ' + vus.get(m.out) + ' et ' + m.src);
    else vus.set(m.out, m.src);
  }
  assert.deepEqual(doubles, [],
    'Deux modules entrent dans le ZIP sous le MÊME nom :\n' + doubles.join('\n'));

  // Le nom du ZIP doit être l'URL sans son préfixe `js/`, sauf renommage déclaré. Un `out:` écrit
  // à la main qui ne correspond pas à sa source publierait un fichier sous un nom trompeur.
  const fautes = [];
  for(const m of modules){
    const attendue = RENOMMES[m.out];
    if(attendue){
      if(m.src !== attendue) fautes.push(m.out + ' ← ' + m.src + ' (renommage déclaré : ' + attendue + ')');
      continue;
    }
    if(m.out !== m.src.replace(/^js\//, '')) fautes.push(m.out + ' ← ' + m.src);
  }
  assert.deepEqual(fautes, [],
    'Le nom dans le ZIP ne correspond pas à sa source. Le jeu exporté servira le mauvais contenu\n'
    + 'sous ce nom, et le message d\'erreur du navigateur désignera le mauvais fichier.\n'
    + 'Si un renommage est voulu, il se déclare dans RENOMMES.\n' + fautes.join('\n'));
});

test('CHAQUE balise de la page publiee a son fichier dans le ZIP, et reciproquement', () => {
  const dansLeZip = new Set(buildOutputs());
  // `data.js` est engendré (le projet sérialisé), pas téléchargé. Il n'a pas de source.
  dansLeZip.add('data.js');

  const reclames = fichiersReclames();
  const balises = reclames.balises;
  assert.ok(balises.length >= 40,
    'seulement ' + balises.length + ' balises lues dans la page publiée — motif changé ?');
  assert.ok(reclames.importmap.length >= 3,
    'l\'importmap de la page publiée ne nomme plus les paquets ESM — motif changé ?');

  const sansFichier = balises.concat(reclames.importmap).filter((b) => !dansLeZip.has(b));
  assert.deepEqual(sansFichier, [],
    'La page publiée demande ces fichiers, et le ZIP ne les contient pas : le joueur reçoit un\n'
    + '404 au chargement.\n' + sansFichier.join('\n'));

  // L'inverse : un module embarqué que la page n'appelle jamais. Soit c'est du poids mort, soit
  // — bien plus grave — le module est censé s'exécuter et ne le fera pas. C'est le cas de
  // `shadow-fit.js` avant la v0.126.0 : présent nulle part, donc `rtUpdateShadows()` sortait
  // immédiatement sur son `typeof ShadowFit === 'undefined'`, sans un seul message.
  const vues = new Set(balises.concat(reclames.importmap));
  const sansBalise = buildOutputs().filter((o) => !vues.has(o));
  assert.deepEqual(sansBalise, [],
    'Ces fichiers sont embarqués dans le ZIP mais AUCUNE balise de la page publiée ne les\n'
    + 'charge. Soit c\'est du poids mort, soit le module ne s\'exécutera jamais chez le joueur —\n'
    + 'et une garde `typeof X === "undefined"` rendra la panne muette.\n' + sansBalise.join('\n'));
});
