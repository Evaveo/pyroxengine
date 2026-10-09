// Le jeu PUBLIÉ doit regrouper son décor comme la vue de lecture. C'est le seul test de
// ce dépôt qui exerce `js/game-runtime.js` par son vrai chemin : une page autonome, des
// données de jeu, aucun morceau de l'éditeur.
//
// IL EXISTE PARCE QUE LE PORTAGE ÉTAIT INERTE SANS QUE RIEN NE LE DISE. L'éditeur
// regroupait, le jeu publié non : il RECONSTRUIT chaque objet depuis les données, donc
// douze cubes identiques y avaient douze géométries distinctes et aucun groupe n'atteignait
// le seuil. Vu de l'éditeur, tout allait bien.
//
// DEUX PIÈGES DE HARNAIS, appris à la dure :
//  - `game-runtime.js` est enveloppé dans une IIFE. Ni `game`, ni `camDefault`, ni rien de son
//    intérieur n'est visible depuis un `evaluate` — c'est voulu, il ne dépend de rien et
//    n'expose rien. On observe donc par `summaryInstances()`, qui vient du module PARTAGÉ et
//    reste global.
//  - `build-test/runtime.js` ne sert pas : copie figée de 27 Ko quand le vrai file en
//    fait 98. Tester contre elle testerait du code mort.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(dirname, '..', '..');
const dossierTmp = path.join(root, 'tmp-runtime-test');

let navigateur = null;
before(async () => {
  navigateur = await chromium.launch({ args: ['--use-gl=swiftshader', '--ignore-gpu-blocklist'] });
});
after(async () => {
  if (navigateur) await navigateur.close();
  try { fs.rmSync(dossierTmp, { recursive: true, force: true }); } catch (e) {}
});

test('le jeu publie regroupe son decor comme la vue de lecture', async () => {
  const contexte = await navigateur.newContext();
  try {
    // 1. l'éditeur produit les données de jeu
    const editeur = await contexte.newPage();
    await editeur.goto(pathToFileURL(path.join(root, 'editor.html')).href);
    await editeur.waitForFunction('typeof createObject === "function"', { timeout: 30000 });
    const data = await editeur.evaluate(async () => {
      const C = (name, a) => COMMANDS.find((c) => c.name === name).exec(a || {});
      const lister = () => JSON.parse(COMMANDS.find((c) => c.name === 'list_scene').exec()).objects;
      // re-lister après CHAQUE suppression : delete_object emporte les enfants
      for (let garde = 0; garde < 200; garde++) {
        const restant = lister().find((o) => o.type !== 'camera');
        if (!restant) break;
        C('delete_object', { name: restant.name });
      }
      C('create_object', { type: 'cube', name: 'Caisse 1', position: { x: 0, y: 0, z: 0 } });
      for (let i = 2; i <= 12; i++) {
        C('duplicate_object', { name: 'Caisse 1', fresh: 'Caisse ' + i, position: { x: i * 2, y: 0, z: 0 } });
      }
      return await buildDataProject();
    });
    await editeur.close();

    // 2. une page autonome, dans l'ordre exact que produit exportBuildWeb
    fs.mkdirSync(dossierTmp, { recursive: true });
    fs.writeFileSync(path.join(dossierTmp, 'data.js'),
      'window.DONNEES_JEU = ' + JSON.stringify(data) + ';\n');
    fs.writeFileSync(path.join(dossierTmp, 'index.html'),
      '<!doctype html><meta charset="utf-8"><body>\n'
      + '<div id="rj-view"></div>\n'
      + '<div id="rj-loading"><h1>…</h1><div id="rj-bar"></div>'
      + '<div id="rj-loading-txt"></div></div>\n'
      + '<div id="rj-hud"></div><div id="rj-error"></div><div id="rj-ui"></div>\n'
      + '<button id="rj-full-screen"></button>\n'
      + ['../vendor/three.min.js', '../vendor/cannon.js', '../vendor/fflate.js',
         '../js/game-ui.js', '../js/game-character.js', '../js/network-game.js',
         '../js/render-perf.js', 'data.js', '../js/game-runtime.js']
        .map((s) => '<script src="' + s + '"><\/script>').join('\n'));

    // 3. le jeu se charge tout seul
    const jeuPage = await contexte.newPage();
    const errors = [];
    jeuPage.on('pageerror', (e) => errors.push(e.message));
    jeuPage.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await jeuPage.goto(pathToFileURL(path.join(dossierTmp, 'index.html')).href);
    // l'écran de chargement disparaît quand la scène est prête : c'est le signal observable
    await jeuPage.waitForFunction(
      'document.getElementById("rj-loading") && document.getElementById("rj-loading").style.display === "none"',
      { timeout: 30000 });

    const r = await jeuPage.evaluate('({'
      + 'bilan: summaryInstances(),'
      + 'erreurAffichee: (document.getElementById("rj-error")||{}).textContent,'
      + 'canvas: document.querySelectorAll("#rj-view canvas").length })');

    assert.deepEqual(errors, [], 'le jeu publié ne doit lever aucune erreur : ' + errors.join(' | '));
    assert.equal(r.erreurAffichee, '', 'le runtime ne doit afficher aucune erreur');
    assert.equal(r.canvas, 1, 'le jeu doit rendre');
    assert.equal(r.bilan.lots, 1, 'les 12 caisses doivent former UN lot dans le jeu publié');
    assert.equal(r.bilan.objects, 12);
    assert.equal(r.bilan.economie, 11, '12 objects rendus en 1 appel de dessin');
  } finally {
    await contexte.close();
  }
});
