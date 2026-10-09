// moteur/outils/renommer.mjs
// Applique une vague du glossaire à tout le dépôt et imprime un rapport.
//
//   node outils/renommer.mjs --section sur --symboles noeud,composant
//   node outils/renommer.mjs --section sur --tout --essai
//
// --essai n'écrit rien : il imprime seulement ce qui changerait. À lancer
// systématiquement avant la vraie passe.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renommer } from './renommage.mjs';

const racine = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const glossaire = JSON.parse(readFileSync(path.join(racine, 'outils', 'glossaire.json'), 'utf8'));

const args = process.argv.slice(2);
const valeur = (drapeau) => { const i = args.indexOf(drapeau); return i === -1 ? null : args[i + 1]; };
const section = valeur('--section') || 'sur';
const essai = args.includes('--essai');
const tout = args.includes('--tout');
// Deux garde-fous pour les vagues tardives : ne toucher QUE le code (les commentaires
// francais ne doivent pas etre traduits mot a mot), et limiter la cible aux modules JS.
const sansCommentaires = args.includes('--sans-commentaires');
const cibleJs = args.includes('--js-seulement');
// --cibles js,test,exemples,mcp : limite les dossiers balayes (et retire les pages HTML).
const cibles = (valeur('--cibles') || '').split(',').filter(Boolean);
const demandes = tout ? null : (valeur('--symboles') || '').split(',').filter(Boolean);

const source = glossaire[section] || {};
const table = {};
Object.keys(source).forEach((fr) => {
  if (!demandes || demandes.indexOf(fr) !== -1) table[fr] = source[fr];
});
if (Object.keys(table).length === 0) {
  console.error('Aucun symbole sélectionné — vérifier --section / --symboles.');
  process.exit(1);
}

const options = {
  compter: true,
  // `identifiants` comme `sur` : les cibles sont sans ambiguite, et un commentaire qui cite
  // une fonction par son nom doit suivre — sinon il pointe vers un nom qui n'existe plus.
  commentaires: !sansCommentaires && (section === 'sur' || section === 'idsDom' || section === 'identifiants'),
  // La section `fichiers` vit dans des CHAINES et des attributs HTML (`<script src=...>`,
  // `lire('js/...')`, la table FICHIERS de build.js) : sans `chaines`, le renommage ne
  // toucherait aucun des trois chargeurs.
  chaines: section === 'idsDom' || section === 'fichiers'
};

// Le renommage est REPO-WIDE par construction : une déclaration et tous ses sites
// d'appel doivent bouger dans la même passe, sinon l'éditeur est cassé entre deux
// commits. On balaie donc js/, test/, et les trois pages HTML.
// `exemples/` et `mcp/` font partie de la SURFACE : le plugin d'exemple s'enregistre par la
// meme API que les plugins d'utilisateurs, et le pont MCP expose les commandes du copilote.
// Oublies d'un renommage, ils cessent de fonctionner — et c'est test/materiau-plugin.test.mjs
// qui l'a dit.
const CIBLES = ['js', 'test', 'exemples', 'mcp'];
// `build-test/index.html` est l'image exacte de la page engendree par build.js (garde :
// test/harnais-build-test.test.mjs) : oublie ici, la garde le dirait, mais apres coup.
const FICHIERS_PLATS = ['editor.html', 'game-preview.html', 'help.html',
                        'external-editor.html', 'build-test/index.html'];

function fichiersDe(dossier) {
  const base = path.join(racine, dossier);
  const sortie = [];
  (function marcher(d) {
    readdirSync(d).forEach((e) => {
      const p = path.join(d, e);
      if (statSync(p).isDirectory()) return marcher(p);
      if (/\.(js|mjs|html)$/.test(e)) sortie.push(p);
    });
  })(base);
  return sortie;
}

// Les fixtures de ce test SONT du français, par construction : il vérifie que le segmenteur
// distingue `// le nom du noeud` (commentaire) de `const nom = ...` (code). Le renommer, c'est
// lui retirer son sujet. naming-anglais.test.mjs, lui, NOMME les anciens noms exprès.
// `js/api-alias.js` est une TABLE dont les cles SONT les noms francais de l'api de script
// (`vitesse: 'velocity'`). Un renommage mot-a-mot la detruit : `speed: 'velocity'` ne mappe
// plus rien. Elle doit etre INVERSEE a la main (phase D du plan), pas renommee.
const EXCLUS = ['test/outils-renommage.test.mjs', 'test/naming-anglais.test.mjs',
                'js/api-alias.js'];

const fichiers = (cibles.length ? cibles : (cibleJs ? ['js', 'test'] : CIBLES)).flatMap(fichiersDe)
  .concat((cibleJs || cibles.length) ? [] : FICHIERS_PLATS.map((f) => path.join(racine, f)))
  .filter((f) => !EXCLUS.some((e) => f.endsWith(e.replace('/', path.sep))));

const totaux = {};
let fichiersTouches = 0;
for (const f of fichiers) {
  const avant = readFileSync(f, 'utf8');
  const { resultat, comptes } = renommer(avant, table, options);
  if (resultat === avant) continue;
  fichiersTouches++;
  Object.keys(comptes).forEach((k) => { totaux[k] = (totaux[k] || 0) + comptes[k]; });
  console.log(path.relative(racine, f), '—', Object.entries(comptes).map(([k, v]) => k + ':' + v).join(' '));
  if (!essai) writeFileSync(f, resultat);
}

console.log('\n' + (essai ? '[ESSAI] ' : '') + fichiersTouches + ' fichier(s), '
  + Object.values(totaux).reduce((a, b) => a + b, 0) + ' occurrence(s).');

const jamaisVus = Object.keys(table).filter((k) => !totaux[k]);
if (jamaisVus.length) console.log('⚠ jamais trouvés (faute de frappe ?) : ' + jamaisVus.join(', '));
