// Deux fichiers ne peuvent pas déclarer le MÊME nom au premier niveau.
//
// Ce dépôt n'a pas d'étape de build : chaque `js/*.js` est un `<script>` classique, et tous
// partagent une seule portée globale. Deux `const` du même nom y font une SyntaxError, et le
// second file cesse d'être évalué — en entier. Le symptôme n'a rien à voir avec la cause :
// on voit « anim is not defined » depuis startup.js, à l'autre bout du chargement.
//
// Défaut réellement livré en v0.45.0 : `js/anim-models.js` a déclaré `_qA`/`_vA`, que
// `js/animation.js` déclarait déjà. L'éditeur ne démarrait plus. Aucun test ne l'a vu, parce
// que chaque harnais monte ses fichiers dans un bac à sable séparé — c'est-à-dire jamais
// l'assemblage réel. Ce test-ci monte la LISTE de la page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');

/** Les scripts d'une page, dans l'ordre où le navigateur les évalue. */
function scriptsDe(page){
  const html = read(page);
  const names = [];
  const re = /<script\s+src="([^"?]+)/g;
  let m;
  while((m = re.exec(html))) names.push(m[1].replace(/^\.\//, ''));
  return names.filter((f) => f.startsWith('js/'));   // vendor : hors de notre contrôle
}

/**
 * Les noms déclarés au PREMIER niveau d'un fichier.
 *
 * Volontairement textuel plutôt qu'un vrai analyseur : ce qui compte est la colonne 0. Une
 * déclaration indentée est dans une fonction ou un bloc, donc sans effet global — et c'est
 * exactement le critère qui distingue les deux cas.
 */
function declarationsGlobales(source){
  const names = new Map();
  // Découpage sur `\r?\n`, et ce n'est PAS un détail de portabilité. En regex JavaScript, `.`
  // ne matche pas `\r` : sur une ligne en CRLF, `/^const\s+(.+)$/` échoue, et le fichier rend
  // zéro déclaration — silencieusement. Ce détecteur a d'abord été écrit avec `split('\n')` ;
  // il était aveugle à la quasi-totalité du dépôt, qui est en CRLF dans l'arbre de travail, et
  // il laissait passer le défaut même pour lequel il avait été écrit. Le test du bas le garde.
  source.split(/\r?\n/).forEach((line, i) => {
    let m = /^(?:function|class)\s+([A-Za-z_$][\w$]*)/.exec(line);
    if(m){ if(!names.has(m[1])) names.set(m[1], i + 1); return; }
    m = /^(?:const|let|var)\s+(.+)$/.exec(line);
    if(!m) return;
    // `const a = new X(), b = new Y();` déclare DEUX noms. On coupe sur les virgules de
    // premier level : celles à l'intérieur d'un appel n'introduisent rien.
    //
    // On s'arrête au `;` de premier niveau et au `//` hors chaîne, et c'est nécessaire, pas
    // cosmétique : sans ça, `const CALQUE = 31;  // … gizmo, helpers, sol, grille` fabriquait
    // trois fausses déclarations à partir du commentaire, et le détecteur criait au conflit
    // sur du texte. Un faux positif dans une garde, c'est une garde qu'on finit par désactiver.
    let depth = 0, current = '', guillemet = '';
    const morceaux = [];
    const body = m[1];
    for(let k = 0; k < body.length; k++){
      const c = body[k];
      if(guillemet){
        if(c === '\\'){ current += c + (body[k + 1] || ''); k++; continue; }
        if(c === guillemet) guillemet = '';
        current += c;
        continue;
      }
      if(c === '"' || c === "'" || c === '`'){ guillemet = c; current += c; continue; }
      if(c === '/' && body[k + 1] === '/') break;
      if(c === ';' && depth === 0) break;
      if('([{'.includes(c)) depth++;
      else if(')]}'.includes(c)) depth--;
      if(c === ',' && depth === 0){ morceaux.push(current); current = ''; }
      else current += c;
    }
    morceaux.push(current);
    morceaux.forEach((mo) => {
      const n = /^\s*([A-Za-z_$][\w$]*)/.exec(mo);
      if(n && !names.has(n[1])) names.set(n[1], i + 1);
    });
  });
  return names;
}

for(const page of ['editor.html', 'game-preview.html', 'build-test/index.html']){
  test(`aucun nom global declare deux fois dans ${page}`, () => {
    const prefixe = page.includes('/') ? '../' : '';
    const vus = new Map();
    const collisions = [];
    for(const f of scriptsDe(page)){
      const filePath = path.posix.join(page.includes('/') ? path.dirname(page) : '.', prefixe + f);
      let source;
      try{ source = read(filePath); }
      catch(e){ assert.fail(`${page} charge ${f}, introuvable en ${filePath}`); }
      declarationsGlobales(source).forEach((line, name) => {
        const deja = vus.get(name);
        if(deja) collisions.push(`« ${name} » : ${deja.f}:${deja.line} et ${f}:${line}`);
        else vus.set(name, {f, line});
      });
    }
    assert.deepEqual(collisions, [],
      'names déclarés deux fois au premier niveau — le SECOND file cesse d\'être évalué :\n  '
      + collisions.join('\n  '));
  });
}

test('le detecteur voit une collision quand il y en a une', () => {
  // Une garde qu'on n'a pas vue échouer n'est pas une garde. On lui donne le cas exact de la
  // v0.45.0 : deux fichiers, la même paire de constantes sur une seule line.
  const a = declarationsGlobales('const _vA = new THREE.Vector3(), _vB = new THREE.Vector3();');
  const b = declarationsGlobales('const _qA = 1;\nconst _vA = 2;');
  assert.deepEqual([...a.keys()], ['_vA', '_vB'], 'les deux noms d\'une même ligne doivent sortir');
  assert.ok(b.has('_vA') && b.has('_qA'));
  // EN CRLF AUSSI. C'est le cas qui a rendu la première version de ce détecteur inutile : elle
  // trouvait tout en LF, rien en CRLF, et l'arbre de travail est en CRLF. Un jeu d'essai écrit
  // uniquement en LF ne prouve donc rien du tout ici.
  const crlf = declarationsGlobales('const _vA = new THREE.Vector3(), _vB = new THREE.Vector3();\r\n'
    + 'function machin(){\r\n  const local = 1;\r\n}\r\n');
  assert.deepEqual([...crlf.keys()], ['_vA', '_vB', 'machin'], 'aveugle aux fins de ligne Windows');
  // Et il ne doit PAS crier sur ce qui est local : c'est ce qui le rendrait inutilisable.
  const local = declarationsGlobales('function f(){\n  const _vA = 1;\n}\n  let x = 2;');
  assert.deepEqual([...local.keys()], ['f'], 'une déclaration indentée n\'est pas globale');
  // Ni sur un COMMENTAIRE. Cas réel du dépôt : les virgules d'un commentaire de end de ligne
  // fabriquaient trois fausses déclarations, et la garde accusait `js/scene.js`.
  const commente = declarationsGlobales(
    'const CALQUE = 31;   // bit réservé (Layers va de 0 à 31) : gizmo, helpers, sol, grille');
  assert.deepEqual([...commente.keys()], ['CALQUE'], 'le commentaire a été lu comme du code');
  // Une chaîne qui CONTIENT « // » ne coupe rien : ce serait perdre la moitié d'une ligne.
  const url = declarationsGlobales("const A = 'https://x.fr', B = 2;");
  assert.deepEqual([...url.keys()], ['A', 'B']);
});
