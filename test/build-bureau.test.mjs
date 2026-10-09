// L'EXPORT BUREAU — et pourquoi ses pannes se découvrent tard.
//
// Un ZIP de projet Electron ne se vérifie pas d'un coup d'œil : on le découvre cassé après
// `npm install`, `npm run dist`, et une fenêtre noire. Les quatre façons dont ça arrive :
//
//  1. LE PROTOCOLE. `win.loadFile()` charge la page en `file://`, et Chromium REFUSE les
//     modules ES en `file://`. Tout ce moteur en est fait : la fenêtre est noire, avec une
//     erreur de CORS que rien ne relie à l'emballage. C'est le piège central de ce fichier.
//
//  2. LE JEU MANQUANT. L'enveloppe est parfaite et le dossier du jeu vide, ou à côté du chemin
//     que `main.js` sert. On ne le voit qu'à l'exécution.
//
//  3. LA DIVERGENCE AVEC LA SORTIE WEB. Deux collectes séparées finissent par publier deux jeux
//     différents, et l'écart ne se voit qu'en comparant deux téléchargements.
//
//  4. LE JAVASCRIPT ENGENDRÉ QUI NE PARSE PAS. Une apostrophe mal échappée dans un gabarit, et
//     `main.js` est un fichier mort. Ici, il est PARSÉ pour de vrai — pas cherché dans la
//     source à coups d'expressions régulières.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { creerContexte } from './engine-env.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const lire = (f) => readFileSync(path.join(root, f), 'utf8');

const env = creerContexte(['js/build-desktop.js']);
const enveloppe = env.desktopWrapperFiles('Mon Jeu Génial');
// `DESKTOP_GAME_DIR` est un `const` top-niveau : il vit dans la portee lexicale du contexte,
// jamais parmi les proprietes de l'objet global. On le lit DEDANS.
const DOSSIER_JEU = vm.runInContext('DESKTOP_GAME_DIR', env);

/**
 * Le CODE d'un fichier engendre, commentaires retires.
 *
 * Indispensable ici : `main.js` porte un commentaire qui DIT « ne pas remplacer par
 * win.loadFile() », et une garde qui cherche « loadFile » dans la source brute tombe sur sa
 * propre mise en garde. Une assertion qui lit la prose au lieu du code est une garde incapable
 * d'echouer — et ce depot commente beaucoup.
 */
const codeSeul = (src) => src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

// ---------- 1. Le piège du protocole ----------

test('main.js NE charge PAS la page en file://', () => {
  // LE PIEGE CENTRAL. Chromium refuse les modules ES servis en file://, et ce moteur est fait
  // de <script type="module"> : `loadFile` donne une fenetre noire et une erreur de CORS que
  // rien ne relie a l'emballage.
  const main = codeSeul(enveloppe['main.js']);
  assert.equal(/\.loadFile\s*\(/.test(main), false,
    'main.js utilise loadFile : la fenetre sera noire, et l erreur parlera de CORS');
  assert.ok(/loadURL\s*\(\s*'jeu:\/\//.test(main),
    'main.js doit charger la page par le protocole maison');
});

test('le protocole est declare STANDARD et SUR', () => {
  // `standard` donne une vraie origine — c'est ce qui debloque les modules ES ET le
  // localStorage, donc les sauvegardes du jeu. `secure` le place au rang de https pour les
  // regles de contenu mixte. Sans l'un ou l'autre, le jeu demarre et perd ses sauvegardes.
  const main = enveloppe['main.js'];
  assert.ok(/registerSchemesAsPrivileged/.test(main), 'le schema doit etre declare privilegie');
  assert.ok(/standard:\s*true/.test(main), 'sans `standard`, pas de modules ES ni de stockage');
  assert.ok(/secure:\s*true/.test(main), 'sans `secure`, le schema est traite comme non fiable');
});

test('le protocole refuse de sortir du dossier du jeu', () => {
  // Une application locale, oui — mais elle chargera un jour du contenu que l'auteur n'a pas
  // ecrit (un classement, une publicite), et cette ligne ne coute rien aujourd'hui.
  const main = enveloppe['main.js'];
  assert.ok(/path\.relative\(/.test(main) && /startsWith\('\.\.'\)/.test(main),
    'main.js ne verifie plus que le chemin demande reste dans le dossier du jeu');
});

// ---------- 2. Le JavaScript engendré doit être du JavaScript ----------

test('main.js et preload.js se PARSENT', () => {
  // Une apostrophe mal echappee dans un gabarit, et le fichier est mort. On ne cherche pas un
  // motif dans la source : on demande a node de le lire.
  ['main.js', 'preload.js'].forEach((f) => {
    assert.doesNotThrow(() => new vm.Script(enveloppe[f], {filename: f}),
      f + ' engendre ne se parse pas — Electron l ignorera et la fenetre restera vide');
  });
});

test('package.json est du JSON valide et complet', () => {
  const pkg = JSON.parse(enveloppe['package.json']);
  assert.equal(pkg.main, 'main.js');
  assert.equal(pkg.scripts.dist, 'electron-builder');
  assert.ok(pkg.devDependencies.electron, 'sans electron, npm install ne donne rien');
  assert.ok(pkg.devDependencies['electron-builder'], 'sans electron-builder, pas d executable');
  // `files` BORNE ce qui entre dans le binaire. Sans elle, electron-builder embarque
  // node_modules en entier — des centaines de Mo de dependances de compilation dans un jeu
  // qui n en utilise aucune.
  assert.ok(Array.isArray(pkg.build.files) && pkg.build.files.length,
    'sans `build.files`, le binaire embarque node_modules en entier');
  assert.ok(pkg.build.files.some((f) => f.indexOf(DOSSIER_JEU) === 0),
    'le dossier du jeu doit entrer dans le binaire, sinon l application est vide');
  assert.ok(pkg.build.appId, 'macOS et Windows exigent un identifiant d application');
});

test('l identifiant d application est TOUJOURS valide', () => {
  // Un identifiant vide fait echouer la compilation avec un message qui ne designe pas le
  // projet, et l on cherche une heure.
  ['', '   ', '!!!', 'Éléphant Bleu 3000'].forEach((nom) => {
    const id = env.appIdOf(nom);
    assert.ok(/^com\.[a-z0-9]+\.[a-z0-9-]+$/.test(id),
      'nom « ' + nom + ' » donne l identifiant invalide « ' + id + ' »');
  });
  assert.equal(env.appIdOf('Éléphant Bleu'), 'com.studio.elephant-bleu',
    'les accents et les espaces doivent etre normalises, pas laisses tels quels');
  // Le moteur sert a plusieurs studios : le studio regle dans Parametres du projet signe le jeu.
  assert.equal(env.appIdOf('Éléphant Bleu', 'Mon Studio'), 'com.monstudio.elephant-bleu');
  const pkg = JSON.parse(env.packageJsonDesktop('Jeu', 'Mon Studio'));
  assert.equal(pkg.author, 'Mon Studio');
  assert.match(pkg.description, /Mon Studio/);
  assert.doesNotMatch(pkg.description, /Evaveo/i);
});

// ---------- 3. Le jeu est vraiment là, et c'est le même ----------

test('main.js sert le dossier que le ZIP remplit', () => {
  // LE PIEGE 2 : l enveloppe parfaite et le jeu a cote du chemin servi. On verifie que les deux
  // nomment le MEME dossier, et que c est la constante partagee qui le dit.
  const main = enveloppe['main.js'];
  assert.ok(main.includes(JSON.stringify(DOSSIER_JEU)),
    'main.js ne sert plus le dossier ' + DOSSIER_JEU);
  const build = lire('js/build.js');
  assert.ok(/DESKTOP_GAME_DIR \+ '\/' \+ k/.test(build),
    'l export ne range plus le jeu dans DESKTOP_GAME_DIR : le protocole servira un dossier vide');
});

test('LES DEUX SORTIES partent de la MEME collecte', () => {
  // LE PIEGE 3. Deux collectes separees finissent par publier deux jeux differents, et l ecart
  // ne se voit qu en comparant deux telechargements.
  const build = codeSeul(lire('js/build.js'));
  /** Le corps d'une fonction, jusqu'à la déclaration suivante — quel que soit l'ordre du fichier. */
  const corps = (nom) => {
    const i = build.indexOf('export async function ' + nom);
    assert.ok(i !== -1, 'js/build.js n a plus de fonction ' + nom);
    const suite = build.indexOf('\nexport ', i + 1);
    return build.slice(i, suite === -1 ? build.length : suite);
  };
  const web = corps('exportBuildWeb');
  const bureau = corps('exportBuildDesktop');
  // La collecte commune s'appelle `assembleBuild` depuis la fusion avec « Publier en ligne »
  // (v0.173.0) : elle sert AUSSI la publication cloud, troisième sortie du même jeu.
  assert.ok(/assembleBuild\(\)/.test(web), 'l export web ne passe plus par la collecte commune');
  assert.ok(/assembleBuild\(\)/.test(bureau), 'l export bureau ne passe plus par la collecte commune');
  // Ni l un ni l autre ne doit refabriquer la page ou les donnees de son cote.
  assert.equal(/pageIndexBuild\(/.test(bureau), false,
    'l export bureau refabrique la page : elle divergera de celle du web');
  assert.equal(/GAME_DATA/.test(bureau), false,
    'l export bureau refabrique les donnees : elles divergeront de celles du web');
});

// ---------- 4. La sécurité de l'enveloppe ----------

test('Node n est PAS expose a la page du jeu', () => {
  // Un jeu execute des scripts de projet, et ce moteur laisse deja ouvrir le projet d autrui
  // (js/script-trust.js). Exposer Node a la page reviendrait a donner le disque entier au
  // premier script venu.
  const main = enveloppe['main.js'];
  assert.ok(/nodeIntegration:\s*false/.test(main), 'nodeIntegration doit rester eteint');
  assert.ok(/contextIsolation:\s*true/.test(main), 'contextIsolation doit rester actif');
  assert.ok(/sandbox:\s*true/.test(main));
  assert.ok(/preload:/.test(main), 'sans preload, le jeu n a aucun pont vers le systeme');
});

test('le pont expose quitter, plein ecran, Steam et le cloud — et rien de plus', () => {
  // Chaque fonction de plus est une surface de plus. Quitter et le plein ecran sont les deux
  // choses qu une page web ne sait pas faire ; `steam` et `cloud` sont les deux familles ajoutees
  // en v0.194.0 (test/steam.test.mjs en verifie les canaux). Une cinquieme cle doit etre voulue.
  const preload = enveloppe['preload.js'];
  assert.ok(/exposeInMainWorld\('bureau'/.test(preload));
  assert.ok(/quitter:/.test(preload) && /pleinEcran:/.test(preload));
  const cles = [...preload.slice(preload.indexOf('exposeInMainWorld')).matchAll(/^  ([A-Za-z]+): /gm)].map((m) => m[1]);
  assert.deepEqual(cles, ['version', 'quitter', 'pleinEcran', 'steam', 'cloud']);
  assert.equal(/require\('node:fs'\)|require\("fs"\)|require\('fs'\)/.test(preload), false,
    'le preload ne doit exposer aucun acces au disque');
});

// ---------- 5. Ce que le jeu y gagne ----------

test('les DEUX moteurs offrent api.desktop() et api.quitGame()', () => {
  // Un jeu publie en web et en bureau depuis le MEME projet : les deux runtimes doivent
  // repondre pareil, sinon un bouton « Quitter » marche a l apercu et pas dans le binaire.
  [['js/scripts.js', 'l editeur'], ['js/game-runtime.js', 'le jeu publie']].forEach(([f, qui]) => {
    const src = lire(f).split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    assert.ok(/desktop:\s*function/.test(src), qui + ' (' + f + ') n a plus api.desktop()');
    assert.ok(/quitGame:\s*function/.test(src), qui + ' (' + f + ') n a plus api.quitGame()');
    assert.ok(/window\.bureau/.test(src),
      qui + ' ne regarde plus le pont pose par preload.js : api.desktop() rendra toujours faux');
  });
});

// ---------- 6. Ce que le LISEZMOI doit dire ----------

test('le LISEZMOI dit les deux commandes ET les deux pieges de livraison', () => {
  // Un mode d emploi qui oublie la signature envoie un studio decouvrir a la veille de la
  // sortie que macOS refuse d ouvrir son jeu.
  const txt = enveloppe['LISEZMOI.md'];
  ['npm install', 'npm run dist'].forEach((cmd) => {
    assert.ok(txt.includes(cmd), 'le LISEZMOI ne dit plus « ' + cmd + ' »');
  });
  // ON EXIGE LA CONSEQUENCE, PAS LE MOT. Une premiere version cherchait « sign », qui se
  // trouvait encore dans la prose apres avoir retire le titre de la section : la mutation
  // passait. Ce qu'un studio doit lire, c'est ce qui se passe s'il ne signe pas.
  assert.ok(/SmartScreen/.test(txt),
    'le LISEZMOI ne dit plus ce que fait Windows sans signature');
  assert.ok(/macOS refuse/.test(txt),
    'le LISEZMOI ne dit plus que macOS refuse d ouvrir un jeu non signe — on le decouvrira la '
    + 'veille de la sortie');
  assert.ok(/pingl/.test(txt),
    'le LISEZMOI ne dit plus d epingler les versions : deux compilations ne rendront pas le '
    + 'meme binaire');
  assert.ok(/file:\/\//.test(txt),
    'le LISEZMOI ne dit plus pourquoi le protocole maison existe — quelqu un le remplacera');
});

test('le .gitignore ecarte ce qui ne doit pas etre versionne', () => {
  const ignore = enveloppe['.gitignore'];
  assert.ok(ignore.includes('node_modules'));
  assert.ok(ignore.includes('dist'));
});

// ---------- 7. L'entrée de menu ----------

test('l entree de menu existe et a la MEME condition que le build web', () => {
  // Une entree active d un cote et grisee de l autre ferait chercher une difference qui
  // n existe pas : les deux publient le meme jeu.
  const ui = lire('js/ui.js');
  assert.ok(/exportBuildDesktop/.test(ui), 'aucune entree de menu ne lance l export bureau');
  // Depuis v0.179.0, les deux entrées partagent UNE fonction de condition (projectHasContent) :
  // l'égalité ne tient plus à deux copies qu'il fallait garder identiques.
  const web = ui.match(/active:(\w+), action:exportBuildWeb\}/);
  const bureau = ui.match(/active:(\w+), action:exportBuildDesktop\}/);
  assert.ok(web && bureau, 'les entrées web et bureau n ont plus de condition d activation nommée');
  assert.equal(bureau[1], web[1],
    'l entree bureau n a pas la meme condition d activation que l entree web');
  const corps = ui.slice(ui.indexOf('function ' + web[1]));
  assert.ok(/objects\.length > 0[\s\S]{0,200}project\.scenes/.test(corps.slice(0, 400)),
    'la condition ne regarde plus toutes les scènes du projet');
});
