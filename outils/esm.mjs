// moteur/outils/esm.mjs
//
// LE PASSAGE DE `moteur/js/` AUX MODULES ES NATIFS, en un seul coup et par un outil.
//
// Pourquoi un outil et pas 160 fichiers modifiés à la main : la table « qui a besoin de qui »
// n'existe nulle part aujourd'hui. Elle est portée par l'ordre des 161 balises <script> de
// `editor.html` et par ~470 gardes `typeof X === 'function'` qui demandent poliment si un
// symbole est là. Cette table-là se DÉDUIT du code ; l'écrire à la main serait la périmer.
//
// DEUX MODES :
//
//   node outils/esm.mjs --analyse   ne touche à rien, rend les chiffres et les pièges
//   node outils/esm.mjs --ecrire    réécrit js/**.js avec leurs import/export
//
// CE QUE L'OUTIL NE FAIT PAS, ET POURQUOI :
//
//  · il ne retire AUCUNE garde `typeof X === 'function'`. Une garde sur un symbole désormais
//    importé est simplement toujours vraie — inutile, mais inoffensive. Les retirer dans le
//    même passage mélangerait une transformation mécanique vérifiable avec un jugement au cas
//    par cas (§ 4.1 de docs/REVUE_2026-09-10.md), exactement ce que la revue reproche au dépôt.
//  · il ne déplace, ne scinde et ne renomme rien. Le diff doit rester relisible.

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { segmenter } from './renommage.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

// Les pages qui chargent le moteur. L'ordre de leurs <script> EST le contrat d'exécution
// d'aujourd'hui : c'est à lui qu'on comparera l'ordre déduit par les modules.
const PAGES = ['editor.html', 'game-preview.html', 'build-test/index.html'];

// Ce que le navigateur fournit, ou ce que fournit un vendor chargé hors module. Ces noms-là ne
// s'importent de nulle part et ne doivent jamais devenir un `import`.
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
  'THREE', 'fflate', 'Ammo', 'RAPIER',
  // Objets standard du langage.
  'Object', 'Array', 'String', 'Number', 'Boolean', 'Math', 'JSON', 'Date', 'RegExp', 'Error',
  'TypeError', 'RangeError', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise', 'Symbol', 'Proxy',
  'Reflect', 'BigInt', 'Function', 'Infinity', 'NaN', 'undefined', 'isNaN', 'isFinite',
  'parseInt', 'parseFloat', 'encodeURIComponent', 'decodeURIComponent', 'escape', 'unescape',
  'Uint8Array', 'Uint8ClampedArray', 'Uint16Array', 'Uint32Array', 'Int8Array', 'Int16Array',
  'Int32Array', 'Float32Array', 'Float64Array', 'ArrayBuffer', 'DataView', 'TextEncoder',
  'TextDecoder', 'Intl', 'process'
]);

/** Le code seul : commentaires et chaînes retirés, pour ne jamais lire un mot pour un symbole. */
function codeOnly(source){
  return segmenter(source).map((s) => {
    if(s.type === 'code') return s.texte;
    // Les RETOURS À LA LIGNE survivent au blanchiment. Les écraser en espaces — ce que faisait
    // la première version — fusionnait un commentaire de bloc de vingt lignes en une seule :
    // toute la numérotation partait de travers, et l'indentation d'une ligne noyée dans ce
    // magma ne voulait plus rien dire. Or ici l'indentation EST le critère de « premier niveau ».
    return s.texte.replace(/[^\n]/g, ' ');
  }).join('');
}

/** Les fichiers de `js/`, chemins relatifs à `moteur/`, triés. */
function jsFiles(){
  const out = [];
  const walk = (rel) => {
    for(const e of readdirSync(path.join(root, rel), { withFileTypes: true })){
      const sub = rel + '/' + e.name;
      if(e.isDirectory()) walk(sub);
      else if(e.name.endsWith('.js')) out.push(sub);
    }
  };
  walk('js');
  return out.sort();
}

/**
 * Les déclarations de PREMIER NIVEAU d'un fichier — celles qui deviendront ses `export`.
 *
 * « Premier niveau » se lit ici à l'indentation : une déclaration collée à la marge. C'est le
 * style du dépôt sans exception mesurée, et c'est le seul critère fiable sans analyseur
 * syntaxique complet. Une `const` indentée est une variable locale, et l'exporter serait faux.
 */
function declarationsOf(source){
  const code = codeOnly(source);
  const names = new Map();   // nom -> 'function' | 'class' | 'const' | 'let' | 'var'
  for(const m of code.matchAll(/^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/gm)){
    names.set(m[1], 'function');
  }
  for(const m of code.matchAll(/^class\s+([A-Za-z_$][\w$]*)/gm)) names.set(m[1], 'class');
  for(const m of code.matchAll(/^(const|let|var)\s+([A-Za-z_$][\w$]*)\s*[=;]/gm)){
    names.set(m[2], m[1]);
  }
  return names;
}

/** Tous les identifiants nommés dans le code d'un fichier, sans les accès de propriété. */
function identifiersOf(source){
  const code = codeOnly(source);
  const out = new Set();
  // `[^.\w$]NOM` : le garde-fou `[^.]` est ce qui empêche de prendre `a.render` pour un appel à
  // la fonction globale `render` — la confusion qui rendrait la table inutilisable.
  for(const m of code.matchAll(/(^|[^.?\w$])([A-Za-z_$][\w$]*)/gm)) out.add(m[2]);
  return out;
}

/** L'ordre des `<script src="js/...">` d'une page, tel que le navigateur les exécute. */
function pageOrder(page){
  const html = read(page);
  const out = [];
  for(const m of html.matchAll(/<script[^>]*\ssrc="([^"]+?)(?:\?[^"]*)?"/g)){
    let src = m[1];
    // `build-test/index.html` vit dans un sous-dossier et désigne les sources par `../js/`.
    // Sans cette normalisation, la page entière passait à la trappe — elle rendait « 0 script »
    // et l'outil annonçait tranquillement qu'il n'y avait rien à y vérifier.
    if(src.startsWith('../js/')) src = src.slice(3);
    if(src.startsWith('js/') && src.endsWith('.js')) out.push(src);
  }
  return out;
}

// ---------- Le graphe ----------

/**
 * Le graphe, pour un ENSEMBLE DE FICHIERS DONNÉ — par défaut tout `js/`, mais en pratique les
 * fichiers d'UNE page.
 *
 * Pourquoi la portée compte, et pourquoi la mesurer globalement induit en erreur : deux
 * fichiers peuvent parfaitement déclarer `resize` chacun de leur côté si aucune page ne les
 * charge tous les deux. C'est le cas de `js/game-runtime.js` — le miroir du moteur de jeu — et
 * de ses jumeaux d'éditeur : 45 « ambiguïtés » apparentes qui n'en sont pas, parce que
 * `editor.html` ne charge PAS `game-runtime.js` et que les pages de jeu ne chargent ni
 * `scripts.js` ni `viewport.js`. En modules ES, ce sont deux graphes disjoints, et deux graphes
 * disjoints n'ont aucun conflit de nom à trancher.
 */
function build(fichiers){
  const files = fichiers || jsFiles();
  const declarations = new Map();   // fichier -> Map(nom -> genre)
  const owner = new Map();          // nom -> [fichiers]
  const sources = new Map();

  for(const f of files){
    const src = read(f);
    sources.set(f, src);
    const d = declarationsOf(src);
    declarations.set(f, d);
    for(const nom of d.keys()){
      if(!owner.has(nom)) owner.set(nom, []);
      owner.get(nom).push(f);
    }
  }

  // Les besoins : un identifiant cité ici, déclaré ailleurs, et nulle part en local.
  const needs = new Map();   // fichier -> Map(fichier fournisseur -> Set(noms))
  for(const f of files){
    const locaux = declarations.get(f);
    const table = new Map();
    for(const nom of identifiersOf(sources.get(f))){
      if(locaux.has(nom) || AMBIENT.has(nom)) continue;
      const proprietaires = owner.get(nom);
      if(!proprietaires || proprietaires.length !== 1) continue;   // inconnu, ou ambigu
      const source = proprietaires[0];
      if(source === f) continue;
      if(!table.has(source)) table.set(source, new Set());
      table.get(source).add(nom);
    }
    needs.set(f, table);
  }

  return { files, declarations, owner, needs, sources };
}

/** Les cycles du graphe d'imports — ESM les supporte, mais ils déplacent l'ordre d'évaluation. */
function cycles(needs){
  const trouve = [];
  const etat = new Map();   // fichier -> 1 en cours, 2 fini
  const pile = [];
  const visiter = (f) => {
    etat.set(f, 1);
    pile.push(f);
    for(const voisin of (needs.get(f) || new Map()).keys()){
      if(etat.get(voisin) === 1){
        trouve.push(pile.slice(pile.indexOf(voisin)).concat(voisin));
      } else if(!etat.has(voisin)) visiter(voisin);
    }
    pile.pop();
    etat.set(f, 2);
  };
  for(const f of needs.keys()) if(!etat.has(f)) visiter(f);
  return trouve;
}

/**
 * L'ordre d'évaluation qu'ESM produira pour une page : parcours en profondeur des imports, dans
 * l'ordre où l'entrée les liste. C'est CE calcul qui dit si le passage aux modules change
 * l'ordre d'exécution — et un changement d'ordre est la seule façon dont cette migration peut
 * casser le démarrage sans qu'aucun test ne le montre.
 */
function evaluationOrder(entree, needs){
  const vus = new Set();
  const ordre = [];
  const visiter = (f) => {
    if(vus.has(f)) return;
    vus.add(f);
    for(const voisin of (needs.get(f) || new Map()).keys()) visiter(voisin);
    ordre.push(f);
  };
  entree.forEach(visiter);
  return ordre;
}

// ---------- Modes ----------

function analyse(){
  const tout = process.argv.includes('--tout');
  for(const page of PAGES){
    const actuel = pageOrder(page);
    if(!actuel.length){ console.log('\n=== ' + page + ' : aucun <script src="js/…">'); continue; }
    // Le graphe est celui de CETTE page, pas celui de `js/` entier — voir build().
    const g = build(actuel);
    const ambigus = [...g.owner.entries()].filter(([, f]) => f.length > 1);
    let liens = 0;
    for(const t of g.needs.values()) liens += t.size;
    const c = cycles(g.needs);
    const attendu = evaluationOrder(actuel, g.needs);
    const deplaces = actuel.filter((f, i) => attendu[i] !== f);

    console.log('\n=== ' + page);
    console.log('  fichiers               : ' + actuel.length);
    console.log('  symboles de 1er niveau : ' + g.owner.size);
    console.log('  arêtes fichier→fichier : ' + liens);
    console.log('  symboles ambigus       : ' + ambigus.length
      + (ambigus.length ? '   ← à trancher : ESM ne sait pas les exprimer' : ''));
    for(const [nom, f] of ambigus.slice(0, tout ? ambigus.length : 12)){
      console.log('     · ' + nom + ' : ' + f.join(', '));
    }
    console.log('  cycles d\'import        : ' + c.length);
    for(const boucle of c.slice(0, tout ? c.length : 5)) console.log('     · ' + boucle.join(' → '));
    console.log('  rangs d\'exécution qui changent : ' + deplaces.length + ' / ' + actuel.length);
    for(const f of deplaces.slice(0, tout ? deplaces.length : 8)){
      console.log('     · ' + f + '  ' + actuel.indexOf(f) + ' → ' + attendu.indexOf(f));
    }
  }
}

/**
 * LA SEULE MESURE QUI DÉCIDE DE LA MIGRATION.
 *
 * 408 cycles, ça n'effraie que tant qu'on ne sait pas ce qu'ils touchent. Les modules ES
 * supportent parfaitement un cycle : les `function` sont hissées, et un module qui en appelle
 * une d'un module pas encore évalué la trouve quand même. Ce qui casse, et ce qui casse SANS
 * message clair, c'est un `const`/`let`/`class` lu pendant l'évaluation, avant que le module
 * qui le déclare ait tourné.
 *
 * Donc on ne compte pas les cycles : on compte les endroits où un fichier, AU PREMIER NIVEAU
 * (donc pendant son évaluation), cite une liaison NON HISSÉE fournie par un module qui, dans
 * l'ordre d'évaluation, passe après lui. Chacun de ces endroits est un plantage au démarrage,
 * et la liste tient dans une revue humaine.
 *
 * Approximation assumée du « premier niveau » : l'indentation nulle. C'est le même critère que
 * `declarationsOf`, et le style du dépôt s'y tient sans exception mesurée.
 */
export function evaluationRisks(){
  const parPage = new Map();
  for(const page of PAGES){
    const actuel = pageOrder(page);
    if(!actuel.length) continue;
    const g = build(actuel);
    const ordre = evaluationOrder(actuel, g.needs);
    const rang = new Map(ordre.map((f, i) => [f, i]));
    const trouves = [];

    for(const f of actuel){
      // Les lignes à la marge : ce qui s'exécute pendant l'évaluation du module.
      const lignes = codeOnly(g.sources.get(f)).split(/\r?\n/)
        .map((l, i) => [i + 1, l])
        .filter(([, l]) => l.length && !/^\s/.test(l)
          && !/^(?:async\s+)?function\b|^class\b|^\}|^\)/.test(l));
      for(const [fournisseur, noms] of g.needs.get(f)){
        if(rang.get(fournisseur) <= rang.get(f)) continue;   // déjà évalué : aucun risque
        for(const nom of noms){
          const genre = g.declarations.get(fournisseur).get(nom);
          if(genre === 'function' || genre === 'var') continue;   // hissé : sûr même en cycle
          // `[^:]` en fin de motif : `{grid: null}` déclare une CLÉ qui s'appelle `grid`, pas
          // une lecture de la liaison `grid`. Sans ce garde-fou, tout objet littéral dont une
          // clé porte le nom d'un symbole du moteur ressortait en risque — mesuré : 2 cas
          // sur 30, et il n'en faut pas plus pour qu'on cesse de croire la liste.
          for(const [n, l] of lignes){
            if(new RegExp('(^|[^.?\\w$])' + nom + '\\s*($|[^\\w$:])').test(l)){
              trouves.push({ f, n, nom, genre, fournisseur });
            }
          }
        }
      }
    }

    parPage.set(page, trouves);
  }
  return parPage;
}

function risques(){
  let total = 0;
  for(const [page, trouves] of evaluationRisks()){
    console.log('\n=== ' + page + ' : ' + trouves.length
      + ' lecture(s) risquée(s) au premier niveau');
    for(const r of trouves){
      console.log('   · ' + r.f + ':' + r.n + '  lit ' + r.genre + ' `' + r.nom
        + '` de ' + r.fournisseur + ' (évalué après)');
    }
    total += trouves.length;
  }
  console.log('\nTotal : ' + total);
}

// Le bloc de ligne de commande ne tourne QUE si ce fichier est le point d'entrée. Sans cette
// garde, le test qui importe `evaluationRisks` affichait le mode d'emploi au milieu de la suite.
if(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href){
  const args = process.argv.slice(2);
  if(args.includes('--risques')) risques();
  else if(args.includes('--analyse')) analyse();
  else if(args.includes('--ecrire') || args.includes('--essai')){
    const essai = args.includes('--essai');
    import('./esm-write.mjs').then(({ generate }) => {
      const r = generate({ dryRun: essai });
      console.log((essai ? '[essai] ' : '') + 'fichiers : ' + r.files
        + ' | imports : ' + r.imports + ' | exports : ' + r.exports
        + ' | ponts globalThis : ' + r.bridges + ' | symboles laissés globaux : ' + r.libres);
    });
  }
  else console.log('usage : node outils/esm.mjs --analyse [--tout] | --risques | --essai | --ecrire');
}
