// LES GARDES DU PASSAGE AUX MODULES ES.
//
// Le graphe d'imports est engendré par `outils/esm.mjs --ecrire`, pas écrit à la main. Ces
// tests gardent les règles que le générateur applique — parce qu'un `import` ajouté à la main,
// lui, ne les connaît pas.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { optionalModules } from '../outils/esm-write.mjs';

const racine = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const lire = (rel) => readFileSync(path.join(racine, rel), 'utf8');

function fichiersJs(){
  const out = [];
  const marcher = (rel) => {
    for(const e of readdirSync(path.join(racine, rel), { withFileTypes: true })){
      const sous = rel + '/' + e.name;
      if(e.isDirectory()) marcher(sous);
      else if(e.name.endsWith('.js')) out.push(sous);
    }
  };
  marcher('js');
  return out;
}

/** Les cibles des `import` d'un fichier, résolues en chemin depuis `moteur/`. */
function importsDe(rel){
  const out = [];
  for(const m of lire(rel).matchAll(/^import\s[^\n]*?from\s*'([^']+)';/gm)){
    out.push(path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1])));
  }
  return out;
}

const PAGES = ['editor.html', 'game-preview.html', 'build-test/index.html',
               'help.html', 'hub.html', 'external-editor.html'];

function chargesPar(page){
  const out = new Set();
  for(const m of lire(page).matchAll(/<script[^>]*\ssrc="([^"]+?)(?:\?[^"]*)?"/g)){
    let src = m[1];
    if(src.startsWith('../js/')) src = src.slice(3);
    if(src.startsWith('js/') && src.endsWith('.js')) out.add(src);
  }
  return out;
}

test('AUCUN import ne pointe vers un module que le build sait retirer', () => {
  // LE PIÈGE LE PLUS COÛTEUX DE CETTE MIGRATION, et il ne se voit que chez le joueur.
  // `js/build-trimming.js` retire du jeu publié les modules dont il ne se sert pas — un jeu 3D
  // sans tuiles n'embarque pas `tilemap.js`. Un appel gardé par `typeof` survit à cette
  // absence ; un `import` non : le navigateur va chercher le fichier, ne le trouve pas, et le
  // module qui l'a demandé ne s'exécute jamais. Mesuré avant la règle : 63 arêtes pointaient
  // vers ces neuf fichiers.
  const retirables = optionalModules();
  const fautes = [];
  for(const f of fichiersJs()){
    for(const cible of importsDe(f)){
      if(retirables.has(cible)) fautes.push(f + ' importe ' + cible);
    }
  }
  assert.deepEqual(fautes, [],
    'ces imports casseraient tout build allege — passer par une globale gardee par `typeof`');
});

// `f` (chargée par sa propre balise <script>) importe `cible`, qui n'a PAS de balise à elle sur
// la même page : exception voulue, PAS un oubli. Un `import` ES charge sa cible tout seul — la
// balise séparée était redondante, et une redondance sous UNE AUTRE URL (le `?v=` de
// cache-busting diffère entre <script src> et un import bare) fait charger le fichier DEUX FOIS,
// donc exécuter deux fois son code de premier niveau. `copilot-observer.js` l'a mesuré : ses
// `CopilotTools.register()` tournaient deux fois, et le second passage levait un doublon.
// Voir editor.html, test/copilote-observer.test.mjs, test/fichiers-charges.test.mjs.
const ARETES_SANS_BALISE_DEDIEE = new Set([
  'js/copilot-workshop.js -> js/copilot-observer.js',
  'js/ui-factory.js -> js/copilot-workshop.js'
]);

test('un fichier n importe que des fichiers presents sur TOUTES ses pages', () => {
  // La règle jumelle : un fichier partagé entre l'éditeur et le jeu publié (il y en a 57) ne
  // peut pas importer un module d'éditeur. Ce serait la même panne, du côté du joueur.
  const parPage = new Map(PAGES.map((p) => [p, chargesPar(p)]));
  const pagesDe = (f) => PAGES.filter((p) => parPage.get(p).has(f));
  const fautes = [];
  for(const f of fichiersJs()){
    const pages = pagesDe(f);
    if(!pages.length) continue;              // pas chargé par une page : rien à garantir
    for(const cible of importsDe(f)){
      if(ARETES_SANS_BALISE_DEDIEE.has(f + ' -> ' + cible)) continue;
      const manquantes = pages.filter((p) => !parPage.get(p).has(cible));
      if(manquantes.length){
        fautes.push(f + ' importe ' + cible + ', absent de ' + manquantes.join(', '));
      }
    }
  }
  assert.deepEqual(fautes, []);
});

test('les pages chargent les fichiers du moteur comme des MODULES', () => {
  // Une balise oubliée en script classique planterait sur son premier `import` — et seulement
  // dans le navigateur, jamais dans la suite de tests, qui monte une portée unique.
  const fautes = [];
  for(const page of PAGES){
    for(const m of lire(page).matchAll(/<script([^>]*)\ssrc="((?:\.\.\/)?js\/[^"]+)"/g)){
      if(!/type="module"/.test(m[1])) fautes.push(page + ' : ' + m[2] + ' sans type="module"');
    }
  }
  assert.deepEqual(fautes, []);
});

test('js/build.js publie le jeu en modules, et les vendors en scripts classiques', () => {
  // Les vendors posent des globales (`THREE`, `fflate`) : en module, ils ne le feraient plus.
  const source = lire('js/build.js');
  assert.ok(source.includes('type="module" src="\' + file + \'"'),
    'la balise engendree par `emb` doit etre un module pour les fichiers du moteur');
  assert.ok(source.includes("file.startsWith('vendor/')"),
    'les vendors doivent garder une balise classique');
});

// `export { x } from './y.js'` REEXPORTE sans lier `x` dans le module courant : s'en servir
// ensuite (`globalThis.x = x`, un appel) leve un ReferenceError au chargement — et le harnais
// node:vm, qui retire les reexportations, ne le voit pas. objects.js et hub-ui.js l'ont fait
// avec `escapeHtml` (v0.157.1) : l'editeur ne s'ouvrait plus. Il faut AUSSI un `import`.
test('un nom reexporte par `export { } from` et utilise sur place est aussi importe', () => {
  const fautes = [];
  for(const f of fichiersJs()){
    const src = lire(f);
    const importes = new Set();
    for(const m of src.matchAll(/^import\s*\{([^}]*)\}\s*from/gm)){
      for(const n of m[1].split(',')) importes.add(n.trim().split(/\s+as\s+/).pop());
    }
    const corps = src.replace(/^(?:import|export)\s[^\n]*?from\s*'[^']*';[ \t]*$/gm, '')
      .replace(/\/\/[^\n]*/g, '');
    for(const m of src.matchAll(/^export\s*\{([^}]*)\}\s*from/gm)){
      for(const n of m[1].split(',')){
        const nom = n.trim().split(/\s+as\s+/)[0];
        if(nom && !importes.has(nom) && new RegExp('\\b' + nom + '\\b').test(corps)){
          fautes.push(f + ' : ' + nom);
        }
      }
    }
  }
  assert.deepEqual(fautes, []);
});
