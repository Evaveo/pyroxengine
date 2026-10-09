// moteur/outils/esm-write.mjs
//
// LA RÉÉCRITURE. `esm.mjs` mesure, ce fichier écrit.
//
// LA RÈGLE QUI COMMANDE TOUT : un fichier A ne peut importer d'un fichier B que si TOUTE page
// qui charge A charge aussi B. Sans elle, un fichier partagé entre l'éditeur et le jeu publié
// (il y en a 57) importerait un module que le jeu n'embarque pas, et le jeu ne démarrerait plus
// — une panne chez le joueur, invisible depuis l'éditeur. C'est le mode de défaillance de
// `shadow-fit.js` (revue du 2026-09-10, § 1.1), mais en pire : une erreur de chargement au lieu
// d'une fonctionnalité éteinte.
//
// Ce que la règle interdit reste donc une GLOBALE : `setStatus`, `logConsole`, `pushHistory`,
// `Panels`… sont appelés depuis des fichiers partagés et n'existent pas dans le jeu publié. Ils
// gardent leur garde `typeof` côté appelant, et leur fichier d'origine les expose sur
// `globalThis` — ce que `component.js` faisait déjà à la main pour `Component`. C'est la famille
// « d'éditeur seulement » du plan lot 5, rendue explicite au lieu d'être supposée.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { segmenter } from './renommage.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

const PAGES = ['editor.html', 'game-preview.html', 'build-test/index.html',
               'help.html', 'hub.html', 'external-editor.html'];

// Dupliquée volontairement depuis `esm.mjs` : ces deux outils doivent pouvoir diverger le jour
// où l'un mesure autre chose que ce que l'autre écrit.
const AMBIENT = new Set([
  'window', 'document', 'globalThis', 'self', 'console', 'navigator', 'location', 'history',
  'localStorage', 'sessionStorage', 'fetch', 'Image', 'Audio', 'Blob', 'File', 'FileReader',
  'FormData', 'Headers', 'Request', 'Response', 'URL', 'URLSearchParams', 'WebSocket', 'Worker',
  'AbortController', 'ResizeObserver', 'MutationObserver', 'IntersectionObserver',
  'requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout', 'setInterval',
  'clearInterval', 'queueMicrotask', 'structuredClone', 'alert', 'confirm', 'prompt',
  'getComputedStyle', 'matchMedia', 'devicePixelRatio', 'innerWidth', 'innerHeight',
  'addEventListener', 'removeEventListener', 'dispatchEvent', 'CustomEvent', 'Event',
  'KeyboardEvent', 'PointerEvent', 'MouseEvent', 'DragEvent', 'performance', 'crypto',
  'THREE', 'fflate', 'Ammo', 'RAPIER', 'import', 'export', 'default', 'from', 'as',
  'Object', 'Array', 'String', 'Number', 'Boolean', 'Math', 'JSON', 'Date', 'RegExp', 'Error',
  'TypeError', 'RangeError', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise', 'Symbol', 'Proxy',
  'Reflect', 'BigInt', 'Function', 'Infinity', 'NaN', 'undefined', 'isNaN', 'isFinite',
  'parseInt', 'parseFloat', 'encodeURIComponent', 'decodeURIComponent', 'escape', 'unescape',
  'Uint8Array', 'Uint8ClampedArray', 'Uint16Array', 'Uint32Array', 'Int8Array', 'Int16Array',
  'Int32Array', 'Float32Array', 'Float64Array', 'ArrayBuffer', 'DataView', 'TextEncoder',
  'TextDecoder', 'Intl', 'process'
]);

function codeOnly(source){
  return segmenter(source).map((s) => (s.type === 'code' ? s.texte
    : s.texte.replace(/[^\n]/g, ' '))).join('');
}

/**
 * Les modules que `js/build-trimming.js` sait RETIRER d'un jeu publié.
 *
 * Personne ne peut les importer statiquement. Un `import` est une dépendance DURE : le
 * navigateur va chercher le fichier, et son absence arrête le module qui l'a demandé. Or
 * l'allègement du build retire ces fichiers-là quand le jeu ne s'en sert pas — un jeu 3D sans
 * tuiles n'embarque pas `tilemap.js`. Les appels vers eux gardent donc leur garde `typeof` et
 * passent par une globale, ce qui est exactement le contrat qu'ils avaient déjà.
 *
 * Mesuré : 63 arêtes du graphe pointent vers ces neuf fichiers. Les laisser devenir des imports
 * aurait cassé tout build allégé, sans qu'aucun test du dépôt ne le voie.
 */
export function optionalModules(){
  const source = read('js/build-trimming.js');
  const debut = source.indexOf('const MODULES_OPTIONAL');
  if(debut === -1) throw new Error('MODULES_OPTIONAL introuvable dans js/build-trimming.js');
  const fin = source.indexOf('\n];', debut);
  const bloc = source.slice(debut, fin === -1 ? undefined : fin);
  const out = new Set();
  for(const m of bloc.matchAll(/file:\s*'([^']+)'/g)) out.add(m[1]);
  return out;
}

/** Les pages qui chargent chaque fichier de `js/`. */
function membership(){
  const table = new Map();
  for(const page of PAGES){
    for(const m of read(page).matchAll(/<script[^>]*\ssrc="([^"]+?)(?:\?[^"]*)?"/g)){
      let src = m[1];
      if(src.startsWith('../js/')) src = src.slice(3);
      if(!src.startsWith('js/') || !src.endsWith('.js')) continue;
      if(!table.has(src)) table.set(src, new Set());
      table.get(src).add(page);
    }
  }
  return table;
}

/**
 * Les déclarations de PREMIER NIVEAU DU MODULE, avec leur numéro de ligne (0-indexé).
 *
 * « Premier niveau » se mesure à la PROFONDEUR DE PARENTHÈSES, pas à l'indentation. La nuance
 * n'est pas théorique : `js/game-runtime.js` enveloppe tout son corps dans une IIFE et écrit ses
 * déclarations à la marge. Elles ont donc l'air globales et ne le sont pas — elles sont privées
 * depuis toujours. Les juger à l'indentation leur collait un `export` au milieu d'une fonction,
 * ce qui est une erreur de syntaxe, et leur donnait la propriété de noms qu'elles ne
 * possédaient pas (c'est de là que venaient les « 46 symboles ambigus » du premier diagnostic).
 */
function declarationLines(source){
  const code = codeOnly(source);
  const lignes = code.split('\n');
  // Profondeur au DÉBUT de chaque ligne.
  const profondeur = [];
  let d = 0;
  for(const l of lignes){
    profondeur.push(d);
    for(const c of l){
      if(c === '{' || c === '(' || c === '[') d++;
      else if(c === '}' || c === ')' || c === ']') d--;
    }
  }
  const out = [];
  lignes.forEach((l, i) => {
    if(profondeur[i] !== 0) return;
    let m = l.match(/^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/);
    if(m){ out.push({ line: i, name: m[1] }); return; }
    m = l.match(/^class\s+([A-Za-z_$][\w$]*)/);
    if(m){ out.push({ line: i, name: m[1] }); return; }
    m = l.match(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[=;]/);
    if(m) out.push({ line: i, name: m[1] });
  });
  return out;
}

function identifiersOf(source){
  const out = new Set();
  for(const m of codeOnly(source).matchAll(/(^|[^.?\w$])([A-Za-z_$][\w$]*)/gm)) out.add(m[2]);
  return out;
}

/** `js/ui/dock.js` important `js/scene.js` → `../scene.js`. */
function relative(from, to){
  let rel = path.relative(path.dirname(from), to).split(path.sep).join('/');
  if(!rel.startsWith('.')) rel = './' + rel;
  return rel;
}

/** Le graphe résolu : qui importe quoi, et ce qui doit rester une globale. */
export function plan(){
  const pagesDe = membership();
  const files = [...pagesDe.keys()].sort();
  const sources = new Map(files.map((f) => [f, read(f)]));
  const declarations = new Map(files.map((f) => [f, declarationLines(sources.get(f))]));
  const owner = new Map();
  for(const f of files){
    for(const d of declarations.get(f)){
      if(!owner.has(d.name)) owner.set(d.name, []);
      if(!owner.get(d.name).includes(f)) owner.get(d.name).push(f);
    }
  }
  const retirables = optionalModules();
  // Joignable = présent partout où vit l'importateur, ET jamais retiré du build.
  const visible = (a, b) => !retirables.has(b)
    && [...pagesDe.get(a)].every((p) => pagesDe.get(b).has(p));

  const imports = new Map();
  const libres = new Map();
  for(const f of files){
    const locaux = new Set(declarations.get(f).map((d) => d.name));
    const table = new Map();
    for(const nom of identifiersOf(sources.get(f))){
      if(locaux.has(nom) || AMBIENT.has(nom)) continue;
      const proprietaires = (owner.get(nom) || []).filter((p) => p !== f);
      if(!proprietaires.length) continue;                 // inconnu : laissé tel quel
      const joignables = proprietaires.filter((p) => visible(f, p));
      if(joignables.length === 1){
        const p = joignables[0];
        if(!table.has(p)) table.set(p, new Set());
        table.get(p).add(nom);
      } else {
        if(!libres.has(nom)) libres.set(nom, new Set());
        proprietaires.forEach((p) => libres.get(nom).add(p));
      }
    }
    imports.set(f, table);
  }

  const bridges = new Map();
  for(const [nom, fournisseurs] of libres){
    for(const p of fournisseurs){
      if(!bridges.has(p)) bridges.set(p, new Set());
      bridges.get(p).add(nom);
    }
  }
  return { files, sources, declarations, imports, libres, bridges };
}

export function generate(options){
  const opts = options || {};
  const g = plan();
  const rapport = { files: g.files.length, imports: 0, exports: 0, bridges: 0,
                    libres: g.libres.size };
  for(const t of g.imports.values()) rapport.imports += t.size;
  if(opts.dryRun){
    for(const noms of g.bridges.values()) rapport.bridges += noms.size;
    return rapport;
  }

  for(const f of g.files){
    const lignes = g.sources.get(f).split('\n');
    // 1. `export` devant chaque déclaration de premier niveau. De BAS en HAUT, pour que les
    //    numéros de ligne déjà calculés restent valides pendant qu'on insère.
    const decls = g.declarations.get(f).slice().sort((a, b) => b.line - a.line);
    for(const d of decls){
      if(!/^export\s/.test(lignes[d.line])){
        lignes[d.line] = 'export ' + lignes[d.line];
        rapport.exports++;
      }
    }
    // 2. Les ponts `globalThis`, en fin de fichier.
    const pont = g.bridges.get(f);
    if(pont && pont.size){
      const deja = g.sources.get(f);
      const aPoser = [...pont].sort().filter((n) => !deja.includes('globalThis.' + n + ' ='));
      if(aPoser.length){
        lignes.push('');
        lignes.push('// EXPOSÉ EN GLOBALE, à dessein. Ces symboles sont appelés depuis des fichiers');
        lignes.push('// que les mêmes pages ne chargent pas toutes : un `import` y pointerait un');
        lignes.push('// fichier absent, et la page ne démarrerait pas. Ils gardent donc leur garde');
        lignes.push('// `typeof` côté appelant, et se déclarent ici.');
        for(const n of aPoser) lignes.push('globalThis.' + n + ' = ' + n + ';');
        rapport.bridges += aPoser.length;
      }
    }
    // 3. Les `import`, APRÈS l'en-tête de commentaires : ces fichiers commencent par expliquer
    //    ce qu'ils font, et décapiter cette explication par un bloc d'imports rendrait le dépôt
    //    moins lisible qu'avant la migration.
    const table = g.imports.get(f);
    if(table && table.size){
      let i = 0;
      while(i < lignes.length && (/^\s*\/\//.test(lignes[i]) || lignes[i].trim() === '')) i++;
      const bloc = [...table.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([p, noms]) => 'import { ' + [...noms].sort().join(', ') + ' } from \''
          + relative(f, p) + '\';');
      bloc.push('');
      lignes.splice(i, 0, ...bloc);
    }
    writeFileSync(path.join(root, f), lignes.join('\n'));
  }
  return rapport;
}
