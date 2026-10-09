// LES GARDES `typeof` SUR UN NOM QUE LE FICHIER IMPORTE LUI-MÊME — un cliquet.
//
// `if(typeof X === 'function') X()` a un sens quand X est une GLOBALE qu'une autre page peut ne pas
// charger (les `globalThis.X = X` des modules). Quand le MÊME fichier écrit `import { X } from …`,
// la garde ne protège de rien : si le module de X manque, l'import fait échouer la page avant la
// première ligne ; s'il est présent, X est défini. Et dans un cycle d'imports, X peut encore être
// en zone morte temporelle (TDZ) : `typeof X` y LÈVE une ReferenceError au lieu de rendre
// 'undefined'. La garde est donc inutile dans le cas normal et fausse dans le seul cas où l'on
// croirait qu'elle sert (docs/REVUE_2026-09-29.md § 6.3).
//
// 473 de ces gardes ont été comptées à la revue ; la plupart ont été simplifiées mécaniquement
// (`typeof X === 'function' && Y` → `Y`, `if(typeof X === 'function') f()` → `f()`, etc.). Il en
// RESTE, et c'est assumé :
//   - celles dont un test a besoin : les harnais `node:vm` (test/engine-env.mjs) chargent un
//     fichier SANS ses imports, et la garde y remplace un module absent ;
//   - celles que la simplification automatique ne savait pas réécrire sans risque (formes
//     composées, `let` exporté qui peut valoir `undefined`, valeur de retour d'un appel…) ;
//   - quelques-unes que des tests de source exigent telles quelles.
//
// Ce test compte celles qui restent et ÉCHOUE SI LE NOMBRE MONTE. S'il baisse, abaisser CEILING
// dans le même commit : sans quoi le terrain gagné pourrait se reperdre sans que rien ne le signale.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CEILING = 190;

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const jsDir = path.join(root, 'js');

function listFiles(d){
  return readdirSync(d).flatMap((f) => {
    const p = path.join(d, f);
    return statSync(p).isDirectory() ? listFiles(p) : (f.endsWith('.js') ? [p] : []);
  });
}

/** Le source avec commentaires et contenu des chaînes remplacés par des espaces. Les guillemets
 *  restent : `typeof X === ''` garde sa forme, seul le mot entre eux disparaît — on le relit dans
 *  le source original, à la même position. */
function maskSource(src){
  const out = src.split('');
  const blank = (a, b) => { for(let k = a; k < b; k++) if(out[k] !== '\n') out[k] = ' '; };
  let i = 0;
  while(i < src.length){
    const c = src[i];
    if(c === '/' && src[i + 1] === '/'){ const e = src.indexOf('\n', i); const f = e < 0 ? src.length : e; blank(i, f); i = f; continue; }
    if(c === '/' && src[i + 1] === '*'){ const e = src.indexOf('*/', i + 2); const f = e < 0 ? src.length : e + 2; blank(i, f); i = f; continue; }
    if(c === '\'' || c === '"' || c === '`'){
      let k = i + 1;
      while(k < src.length && src[k] !== c){ if(src[k] === '\\') k++; k++; }
      blank(i + 1, k); i = k + 1; continue;
    }
    // Une regex littérale (`/['"]/`) désynchroniserait le repérage des chaînes : on la saute. Elle
    // commence là où une valeur est attendue, c'est-à-dire après un opérateur ou une ouverture.
    if(c === '/'){
      let p = i - 1;
      while(p >= 0 && /\s/.test(src[p])) p--;
      if(p < 0 || '(,=:[!&|?{};'.includes(src[p]) || /\breturn$/.test(src.slice(Math.max(0, p - 6), p + 1))){
        let k = i + 1, inClass = false;
        while(k < src.length && src[k] !== '\n'){
          if(src[k] === '\\'){ k += 2; continue; }
          if(src[k] === '[') inClass = true;
          else if(src[k] === ']') inClass = false;
          else if(src[k] === '/' && !inClass) break;
          k++;
        }
        blank(i + 1, k); i = k + 1; continue;
      }
    }
    i++;
  }
  return out.join('');
}

/** Les noms locaux que le fichier importe (nommés, par défaut, espace de noms). */
function importedNames(src, masked){
  const names = new Set();
  const re = /(^|\n)\s*import\s+([^'";]*?)\s+from\s*['"]/g;
  let m;
  while((m = re.exec(src))){
    const at = src.indexOf('import', m.index);
    if(masked.slice(at, at + 6) !== 'import') continue;   // dans un commentaire
    const clause = m[2];
    const ns = clause.match(/\*\s+as\s+([\w$]+)/);
    if(ns) names.add(ns[1]);
    const braces = clause.match(/\{([^}]*)\}/);
    if(braces){
      braces[1].split(',').map((s) => s.trim()).filter(Boolean)
        .forEach((spec) => names.add(spec.split(/\s+as\s+/).pop()));
    }
    const byDefault = clause.replace(/\{[^}]*\}/, '').replace(/\*\s+as\s+[\w$]+/, '').replace(/,/g, ' ').trim();
    if(byDefault) names.add(byDefault);
  }
  return names;
}

const GUARD = /typeof\s+([A-Za-z_$][\w$]*)\s*[!=]==?\s*(['"])(?:function|undefined)\2|(['"])(?:function|undefined)\3\s*[!=]==?\s*typeof\s+([A-Za-z_$][\w$]*)/g;

function guardsOnImports(){
  const found = [];
  for(const f of listFiles(jsDir)){
    const src = readFileSync(f, 'utf8');
    const masked = maskSource(src);
    const names = importedNames(src, masked);
    if(!names.size) continue;
    let m;
    GUARD.lastIndex = 0;
    while((m = GUARD.exec(src))){
      const pos = src.indexOf('typeof', m.index);
      if(masked.slice(pos, pos + 6) !== 'typeof') continue;   // commentaire ou chaîne
      const name = m[1] || m[4];
      if(names.has(name)){
        const line = src.slice(0, m.index).split('\n').length;
        found.push(path.relative(root, f).replace(/\\/g, '/') + ':' + line + ' ' + name);
      }
    }
  }
  return found;
}

test('les gardes typeof sur un nom importé par le fichier lui-même ne remontent pas', () => {
  const guards = guardsOnImports();
  assert.ok(guards.length <= CEILING,
    guards.length + ' gardes `typeof` portent sur un nom que leur fichier importe (plafond : '
    + CEILING + '). Une garde de ce genre ne peut pas échouer — et lève en TDZ dans un cycle '
    + 'd\'imports. Écrire l\'appel directement. Dernières trouvées :\n  '
    + guards.slice(-10).join('\n  '));
});

test('le compteur voit bien une garde sur un nom importé, et pas celle sur une globale', () => {
  // Contre-essai du détecteur lui-même : sans lui, un détecteur cassé qui ne trouve plus rien
  // laisserait le cliquet vert pour toujours.
  const src = "import { a, b as c } from './x.js';\nimport * as NS from './y.js';\n"
    + "if(typeof a === 'function') a();\nif(typeof c !== 'undefined') c.x = 1;\n"
    + "if('undefined' !== typeof NS) NS.y();\nif(typeof globale === 'function') globale();\n"
    + "// typeof a === 'function' dans un commentaire\nconst s = \"typeof a === 'function'\";\n";
  const names = importedNames(src, maskSource(src));
  assert.deepEqual([...names].sort(), ['NS', 'a', 'c']);
  const masked = maskSource(src);
  let n = 0, m;
  GUARD.lastIndex = 0;
  while((m = GUARD.exec(src))){
    const pos = src.indexOf('typeof', m.index);
    if(masked.slice(pos, pos + 6) === 'typeof' && names.has(m[1] || m[4])) n++;
  }
  assert.equal(n, 3);
});
