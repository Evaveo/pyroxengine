// UN FICHIER NE PEUT PAS PUBLIER CE QU'IL N'A PAS.
//
// VÉCU LE 2026-09-24, ET LE HARNAIS L'A MASQUÉ. `escapeHtml` vivait dans js/objects.js ; il a
// été extrait dans js/escape-html.js et objects.js n'a gardé qu'une RÉEXPORTATION :
//
//     export { escapeHtml } from './escape-html.js';
//
// Une réexportation rend le nom disponible aux IMPORTATEURS et à personne d'autre. Le fichier
// qui l'écrit ne peut toujours pas l'appeler — et objects.js l'appelle. L'éditeur est mort au
// chargement sur `escapeHtml is not defined`, pendant que les 1831 tests restaient VERTS :
// test/engine-env.mjs pose un `escapeHtml` de substitution dans le bac à sable, donc le nom
// existait pour les tests et pour eux seuls.
//
// CE TEST NE PASSE PAS PAR LE BAC À SABLE, à dessein : c'est la seule façon de voir une panne
// que le harnais fabrique lui-même. Il lit la source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function fichiersJs(dossier){
  return readdirSync(dossier).flatMap((n) => {
    const p = path.join(dossier, n);
    if(statSync(p).isDirectory()) return fichiersJs(p);
    return n.endsWith('.js') ? [p] : [];
  });
}

/** Les noms que ce fichier AMÈNE dans sa portée : import, déclaration, ou paramètre global. */
function nomsAmenes(src){
  const noms = new Set();
  // import { a, b as c } from '…'  /  import d from '…'  /  import * as e from '…'
  for(const m of src.matchAll(/^import\s+([^;]+?)\s+from\s*['"][^'"]+['"];/gm)){
    const clause = m[1];
    for(const n of clause.matchAll(/([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?/g)){
      noms.add(n[2] || n[1]);
    }
  }
  // déclarations de premier niveau ET imbriquées : on ne cherche pas la portée exacte, on
  // cherche « ce nom existe-t-il quelque part dans ce fichier ». Une garde qui se tromperait
  // en étant trop stricte serait désactivée à la première fausse alerte.
  for(const m of src.matchAll(/\b(?:function|class)\s+([A-Za-z_$][\w$]*)/g)) noms.add(m[1]);
  for(const m of src.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) noms.add(m[1]);
  return noms;
}

/**
 * LA RÈGLE, ET POURQUOI ELLE EST ÉTROITE.
 *
 * Une première version signalait « tout fichier qui appelle un symbole sans l'importer ». Elle
 * a rendu neuf fichiers, tous LÉGITIMES : le dépôt assume un régime de globales
 * (`globalThis.x = x` posé par un module, lu par un autre — voir docs/ARCHITECTURE.md). Une
 * garde qui crie au loup neuf fois est une garde qu'on désactive.
 *
 * La règle retenue est exactement le défaut vécu, et rien de plus :
 *
 *     UN FICHIER QUI ÉCRIT `globalThis.X = X` DOIT AVOIR X DANS SA PROPRE PORTÉE.
 *
 * C'est vrai sans exception — on ne peut pas publier ce qu'on n'a pas — et c'est précisément ce
 * qui a cassé : `objects.js` posait `globalThis.escapeHtml = escapeHtml` alors qu'il ne gardait
 * plus qu'une réexportation du nom. Zéro fausse alerte possible.
 */
function publicationsSansPortee(src){
  const amenes = nomsAmenes(src);
  const fautes = [];
  for(const m of src.matchAll(/globalThis\.([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*;/g)){
    const valeur = m[2];
    if(!amenes.has(valeur)) fautes.push(valeur);
  }
  return fautes;
}

test('un fichier ne publie jamais en globale un nom qu il n a pas', () => {
  const coupables = [];
  for(const abs of fichiersJs(path.join(racine, 'js'))){
    const src = readFileSync(abs, 'utf8');
    const relatif = path.relative(racine, abs).split(path.sep).join('/');
    for(const nom of publicationsSansPortee(src)){
      coupables.push(relatif + ' publie ' + nom + ', qu il n a ni declare ni importe');
    }
  }
  assert.deepEqual(coupables, [],
    "Ces fichiers ecrivent `globalThis.X = X` sans avoir X dans leur portee : la ligne leve "
    + "une ReferenceError au chargement et tue l'editeur. Le bac a sable de test fournit un "
    + "substitut, donc les autres tests restent verts. Si le symbole est REEXPORTE, se "
    + "rappeler que `export { x } from` ne ramene PAS x dans la portee du fichier — il faut "
    + "l'importer aussi.");
});

test('la garde reconnait le defaut reellement vecu', () => {
  // Contre-essai : sans lui, une expression reguliere qui ne capture plus rien ferait passer le
  // test precedent en silence, en comparant une liste vide a une liste vide.
  const casse = "export { escapeHtml } from './escape-html.js';\n"
    + 'globalThis.escapeHtml = escapeHtml;';
  assert.deepEqual(publicationsSansPortee(casse), ['escapeHtml'],
    'une reexportation seule ne ramene pas le nom dans la portee : c est le defaut du 24/09');

  const repare = "import { escapeHtml } from './escape-html.js';\nexport { escapeHtml };\n"
    + 'globalThis.escapeHtml = escapeHtml;';
  assert.deepEqual(publicationsSansPortee(repare), [],
    'importe PUIS reexporte : le nom est dans la portee, la publication est licite');
});
