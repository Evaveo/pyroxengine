// moteur/test/copilote-registre.test.mjs
//
// LES OUTILS DU COPILOTE SONT UNIQUES, ET TOUS PASSENT PAR LE REGISTRE.
//
// `copRun(name)` fait `COMMANDS.find(x => x.name === name)`. Deux outils du même nom, et le
// second est silencieusement inatteignable : il apparaît dans le catalogue envoyé au modèle
// (`copToolsApi` mappe TOUT le tableau, doublon compris), le modèle l'appelle, et c'est le
// premier qui s'exécute. Le symptôme est « le copilote fait autre chose que ce qu'il dit ».
//
// Soixante-huit outils répartis sur trois fichiers, et rien ne le vérifiait : `copilot.js`
// déclarait les siens dans un littéral, `copilot-observer.js` et `copilot-workshop.js`
// poussaient les leurs directement dans le tableau. Voir docs/REVUE_2026-09-10.md § 4.3.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');

const FICHIERS = ['js/copilot.js', 'js/copilot-observer.js', 'js/copilot-workshop.js'];

/**
 * Les noms d'outils déclarés par un fichier.
 *
 * Deux indentations, parce que les deux formes de déclaration existent : quatre espaces dans le
 * littéral `COMMANDS = [ { … } ]` de copilot.js, deux dans un `CopilotTools.register({ … })` des
 * deux autres fichiers. Lire une seule des deux ne verrait qu'une partie du catalogue — et un
 * test de doublon qui ne voit qu'une partie ne prouve rien.
 */
function nomsOutils(file){
  return [...read(file).matchAll(/^\s{2,4}name:\s*'([a-z0-9_]+)'/gm)].map((m) => m[1]);
}

test('AUCUN nom d outil n est declare deux fois, tous fichiers confondus', () => {
  const vus = new Map();
  const doubles = [];
  for(const f of FICHIERS){
    for(const n of nomsOutils(f)){
      if(vus.has(n)) doubles.push(n + ' : ' + vus.get(n) + ' et ' + f);
      else vus.set(n, f);
    }
  }
  assert.ok(vus.size >= 50,
    'seulement ' + vus.size + ' outils lus — le motif de lecture de ce test est périmé');
  assert.deepEqual(doubles, [],
    'Deux outils portent le MEME nom. `copRun` prend le premier : le second est inatteignable,\n'
    + 'alors qu il est bien annonce au modele. Le copilote fera donc autre chose que ce qu il dit.\n'
    + doubles.join('\n'));
});

test('TOUT ajout d outil passe par CopilotTools.register, jamais par un push brut', () => {
  // Le registre est le seul endroit qui refuse un doublon. Un `COMMANDS.push` le contourne, et
  // avec lui la seule verification qui existe.
  const fautifs = [];
  for(const f of FICHIERS){
    read(f).split('\n').forEach((line, i) => {
      if(/^\s*(\/\/|\*)/.test(line)) return;
      // Le seul push legitime est celui du registre lui-meme.
      if(/COMMANDS\.push\(outil\)/.test(line)) return;
      if(/COMMANDS\.push\(/.test(line)) fautifs.push(f + ':' + (i + 1) + ' ' + line.trim().slice(0, 70));
    });
  }
  assert.deepEqual(fautifs, [],
    'Ces lignes poussent dans COMMANDS sans passer par le registre :\n' + fautifs.join('\n'));

  // Et le registre existe bien, avec son refus.
  const src = read('js/copilot.js');
  assert.match(src, /const CopilotTools = \{/, 'le registre a disparu de js/copilot.js');
  assert.match(src, /est déjà enregistré/,
    'le registre ne refuse plus un doublon de nom : il ne sert plus a rien');
  assert.match(src, /sans exec\(\)/,
    'le registre ne verifie plus qu un outil est appelable : un outil sans exec() plante a l appel');
});

test('les deux fichiers qui etendent le copilote importent CopilotTools, et copilot-workshop.js est charge APRES lui', () => {
  // `CopilotTools` s'obtient par `import { CopilotTools } from './copilot.js'` — c'est le
  // graphe de modules ES qui garantit l'ordre, pas la position des <script> d'editor.html.
  // Compter sur l'ordre des <script> a deja produit un bug : copilot-observer.js avait AUSSI sa
  // propre balise (en plus d'etre importe par copilot-workshop.js), donc il se chargeait sous
  // deux URL differentes (avec/sans le ?v= de cache-busting) et s'executait deux fois — ses
  // CopilotTools.register() levaient un doublon des le second passage. Voir
  // test/copilote-observer.test.mjs.
  for(const f of ['js/copilot-observer.js', 'js/copilot-workshop.js']){
    const src = read(f);
    assert.match(src, /import\s*\{[^}]*\bCopilotTools\b[^}]*\}\s*from\s*['"]\.\/copilot\.js['"]/,
      f + ' doit importer CopilotTools, pas compter sur une globale posee par l ordre des <script>');
  }
  // NI copilot-observer.js NI copilot-workshop.js n'ont leur propre balise : le premier est deja
  // charge par l'import de copilot-workshop.js, et le second par l'import de ui-factory.js —
  // chacun a mesure le meme double-chargement (capture_view, puis create_texture).
  const html = read('editor.html');
  for(const f of ['js/copilot-observer.js', 'js/copilot-workshop.js']){
    assert.equal((html.match(new RegExp('src="' + f.replace('.', '\\.') + '(?:\\?|")')) || []).length, 0,
      f + ' ne doit pas avoir son propre <script> : une balise separee le double-execute');
  }
  const iCopilot = html.indexOf('js/copilot.js');
  assert.notEqual(iCopilot, -1, 'editor.html ne charge plus js/copilot.js');
  const iUiFactory = html.indexOf('js/ui-factory.js');
  assert.notEqual(iUiFactory, -1, 'editor.html ne charge plus js/ui-factory.js');
  assert.ok(iCopilot < iUiFactory,
    'js/ui-factory.js est charge AVANT js/copilot.js : CopilotTools serait indefini');
});
