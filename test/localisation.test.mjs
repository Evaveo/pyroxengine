// LE TEXTE DU JEU, TRADUIT — et les cinq façons dont ça casse sans lever d'erreur.
//
//  1. LA CLÉ MANQUANTE RENDUE VIDE. C'est le comportement de beaucoup de moteurs, et c'est le
//     pire : un bouton vide passe les tests, passe la relecture, et se découvre en production.
//     Ici une clé absente rend LA CLÉ, qui s'affiche en toutes lettres.
//
//  2. LA LANGUE RÉGIONALE. Un joueur qui demande `en-GB` alors que le projet fournit `en` doit
//     avoir l'anglais. Sans la règle des étiquettes, la moitié du monde anglophone se voit
//     servir la langue par défaut du projet.
//
//  3. LE PARAMÈTRE OUBLIÉ. `'Score : {n}'` sans `n` doit laisser `{n}` visible. Le remplacer
//     par du vide donne « Score : », qu'on lit comme une faute de traduction alors que c'est le
//     script qui a oublié la valeur.
//
//  4. LA LANGUE INEXISTANTE. `setLocale('de')` sur un projet qui n'a pas d'allemand viderait
//     tout le texte du jeu, et l'on chercherait la panne dans les traductions.
//
//  5. LA DIVERGENCE ÉDITEUR / JEU PUBLIÉ. Si l'un des deux moteurs n'installe pas la table, son
//     interface affiche les clés brutes — et l'écart ne se voit qu'après l'export.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { creerContexte } from './engine-env.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const lire = (f) => readFileSync(path.join(root, f), 'utf8');

const env = creerContexte(['js/locale.js']);

const TABLE = {
  default: 'fr',
  tables: {
    fr: {'menu.start': 'Commencer', 'hud.score': 'Score : {n}', 'fin.gagne': 'Gagné !'},
    en: {'menu.start': 'Start', 'hud.score': 'Score: {n}'}
  }
};

/** Installe la table en forçant la langue, pour que le test ne dépende pas du navigateur. */
function langue(code){ env.setupLocales(TABLE, [code]); }

// ---------- 1. Une clé manquante se voit ----------

test('une cle traduite rend sa traduction', () => {
  langue('fr');
  assert.equal(env.translateText('menu.start'), 'Commencer');
  langue('en');
  assert.equal(env.translateText('menu.start'), 'Start');
});

test('une cle ABSENTE rend la cle, jamais du vide', () => {
  // LA REGLE QUI TIENT TOUT LE FICHIER. Un bouton qui affiche « menu.quit » se corrige le jour
  // ou on le voit ; un bouton vide se decouvre chez le joueur.
  langue('en');
  assert.equal(env.translateText('menu.quit'), 'menu.quit',
    'une cle inconnue doit s afficher en toutes lettres');
  assert.notEqual(env.translateText('menu.quit'), '',
    'rendre du vide est exactement ce que ce moteur refuse de faire');
});

test('une cle absente dans la langue active retombe sur la langue par defaut', () => {
  // « fin.gagne » n'existe qu'en francais : un joueur anglais doit lire le francais plutot que
  // la cle. Le repli est un demi-mal, la cle brute est le dernier recours.
  langue('en');
  assert.equal(env.translateText('fin.gagne'), 'Gagné !');
});

test('les cles manquantes sont RETENUES, pas seulement affichees', () => {
  langue('en');
  env.translateText('menu.start');       // presente : ne doit rien signaler
  env.translateText('fin.gagne');        // repli : manquante en anglais
  env.translateText('menu.quit');        // absente partout
  const manquantes = Array.from(env.missingLocaleKeys());
  assert.deepEqual(manquantes, ['fin.gagne', 'menu.quit'],
    'la liste des cles a traduire est ce qu on envoie au traducteur : elle doit etre exacte');
});

// ---------- 2. Le choix de la langue ----------

test('une etiquette regionale trouve la langue courte', () => {
  const dispo = ['fr', 'en'];
  assert.equal(env.pickLocale(dispo, ['en-GB'], 'fr'), 'en',
    'en-GB doit tomber sur en : sans ca, la moitie du monde anglophone lit le francais');
  assert.equal(env.pickLocale(dispo, ['fr-CA', 'en'], 'en'), 'fr');
});

test('une langue courte trouve la variante regionale', () => {
  assert.equal(env.pickLocale(['fr', 'en-US'], ['en'], 'fr'), 'en-US',
    'le projet ne fournit que en-US et le joueur demande en : il doit avoir l anglais');
});

test('le code court GENERIQUE prime sur une autre variante regionale', () => {
  // Le projet fournit un anglais generique ET un anglais americain ; le joueur demande
  // l anglais britannique. Il doit recevoir le generique, pas l americain — sans quoi un
  // joueur de Londres lit « color » et « sidewalk ».
  assert.equal(env.pickLocale(['en-US', 'en', 'fr'], ['en-GB'], 'fr'), 'en',
    'la recherche par prefixe seule rendrait en-US, qui arrive en premier dans la liste');
});

test('l ORDRE des preferences est respecte', () => {
  assert.equal(env.pickLocale(['fr', 'en', 'es'], ['es', 'en'], 'fr'), 'es',
    'la premiere langue que le joueur prefere et que le projet fournit doit gagner');
});

test('sans correspondance, la langue par defaut du projet', () => {
  assert.equal(env.pickLocale(['fr', 'en'], ['de', 'it'], 'en'), 'en');
  assert.equal(env.pickLocale(['fr'], [], 'zz'), 'fr',
    'une langue par defaut absente de la table ne doit pas rendre une langue vide');
  assert.equal(env.pickLocale([], ['fr'], 'fr'), '', 'aucune langue : rien a choisir');
});

// ---------- 3. Les paramètres ----------

test('un parametre se substitue', () => {
  langue('fr');
  assert.equal(env.translateText('hud.score', {n: 42}), 'Score : 42');
  assert.equal(env.translateText('hud.score', {n: 0}), 'Score : 0',
    'zero est une valeur : il ne doit pas etre traite comme absent');
});

test('un parametre OUBLIE reste visible', () => {
  langue('fr');
  assert.equal(env.translateText('hud.score'), 'Score : {n}',
    'sans valeur, « {n} » doit rester : « Score : » tout seul se lit comme une faute de '
    + 'traduction alors que c est le script qui a oublie de passer le nombre');
  assert.equal(env.translateText('hud.score', {autre: 1}), 'Score : {n}');
});

test('la substitution marche aussi sur une cle rendue telle quelle', () => {
  langue('fr');
  assert.equal(env.translateText('brut {n}', {n: 7}), 'brut 7',
    'une cle non traduite doit rester lisible, parametres compris');
});

// ---------- 4. Changer de langue ----------

test('changer pour une langue fournie marche', () => {
  langue('fr');
  assert.equal(env.setLocale('en'), true);
  assert.equal(env.localeCurrent(), 'en');
  assert.equal(env.translateText('menu.start'), 'Start');
});

test('changer pour une langue ABSENTE est refuse, et ne vide rien', () => {
  langue('fr');
  assert.equal(env.setLocale('de'), false,
    'accepter une langue absente viderait tout le texte du jeu, et l on chercherait la panne '
    + 'dans les traductions');
  assert.equal(env.localeCurrent(), 'fr', 'la langue active ne doit pas avoir bouge');
  assert.equal(env.translateText('menu.start'), 'Commencer');
});

test('les langues disponibles sont celles du projet', () => {
  langue('fr');
  assert.deepEqual(Array.from(env.localesAvailable()), ['fr', 'en']);
});

// ---------- 5. Le HTML d'interface ----------

test('data-t traduit le HTML du jeu', () => {
  langue('en');
  const elements = [
    {dataset: {t: 'menu.start'}, textContent: ''},
    {dataset: {t: 'menu.quit'}, textContent: ''},
    {dataset: {}, textContent: 'intact'}
  ];
  const conteneur = {querySelectorAll(sel){
    assert.equal(sel, '[data-t]');
    return elements.filter((e) => e.dataset.t !== undefined);
  }};
  assert.equal(env.applyLocaleBind(conteneur), 2);
  assert.equal(elements[0].textContent, 'Start');
  assert.equal(elements[1].textContent, 'menu.quit', 'une cle absente reste visible dans le HTML');
  assert.equal(elements[2].textContent, 'intact', 'un element sans data-t ne doit pas etre touche');
});

test('LES TRADUCTIONS PASSENT AVANT LES VALEURS liees par un script', () => {
  // L'ORDRE EST UN CONTRAT. `data-t` pose un libelle fixe traduit, `data-bind` une valeur que
  // le script calcule. Un element qui porte les deux doit finir par la valeur — l inverse
  // effacerait le score a chaque image, et on chercherait la faute dans le script.
  const src = lire('js/game-ui.js');
  const i = src.indexOf('applyLocaleBind');
  const j = src.indexOf("querySelectorAll('[data-bind], [data-bind-class]')");
  assert.ok(i !== -1, 'js/game-ui.js n applique plus les traductions : le HTML de jeu montrera '
    + 'les cles brutes');
  assert.ok(i < j, 'les traductions doivent etre appliquees AVANT les valeurs liees');
});

// ---------- 6. Les deux moteurs, et le build ----------

test('LES DEUX MOTEURS installent la table', () => {
  // Si l'un des deux ne le fait pas, son interface affiche les cles brutes — et l ecart entre
  // l editeur et le jeu publie ne se voit qu apres l export.
  [['js/project.js', 'l editeur'], ['js/game-runtime.js', 'le jeu publie']].forEach(([f, qui]) => {
    const src = lire(f).split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    assert.ok(/setupLocales\s*\(/.test(src),
      qui + ' (' + f + ') n installe plus les langues : son texte restera en cles brutes');
  });
});

test('la table est un reglage de PROJET, migre comme les autres', () => {
  const src = lire('js/project-settings.js');
  assert.ok(src.includes("'locales'"),
    'sans « locales » dans PROJECT_SETTINGS_KEYS_MIGRATED, un projet d avant la migration perd '
    + 'ses traductions au premier enregistrement');
  assert.ok(/locales:\s*brut\.locales/.test(src),
    'projectSettingsOf ne pose plus de table de langues par defaut');
});

test('le module part dans les builds', () => {
  const build = lire('js/build.js');
  assert.ok(build.includes("{src: 'js/locale.js'}"),
    'js/locale.js manque a la liste des modules embarques : le jeu exporte affichera les cles');
  assert.ok(build.includes('src="locale.js"'),
    'js/locale.js manque aux balises de la page engendree');
});

// ---------- 7. Le va-et-vient avec un traducteur ----------

test('exporter puis reimporter une langue la rend a l identique', () => {
  // `plat` : les objets fabriques dans le realm du `vm` n'ont pas le meme prototype que ceux du
  // test, et `deepStrictEqual` compare les prototypes. Piege connu du depot.
  const plat = (o) => JSON.parse(JSON.stringify(o));
  const projet = plat(TABLE);
  const json = env.exportLocaleJson(projet, 'en');
  assert.deepEqual(JSON.parse(json), TABLE.tables.en);

  projet.tables.en = {};
  const n = env.importLocaleJson(projet, 'en', json);
  assert.equal(n, 2);
  assert.deepEqual(plat(projet.tables.en), TABLE.tables.en);
});

test('un fichier de traduction ABIME ne detruit pas la table', () => {
  // Un traducteur rend un fichier avec une virgule de trop, ou un tableau au lieu d un objet.
  // Ecraser la table avec ca perdrait le travail deja fait.
  const projet = JSON.parse(JSON.stringify(TABLE));
  assert.equal(env.importLocaleJson(projet, 'en', '{ ceci n est pas du json'), null);
  assert.equal(env.importLocaleJson(projet, 'en', '["a", "b"]'), null);
  assert.deepEqual(JSON.parse(JSON.stringify(projet.tables.en)), TABLE.tables.en,
    'la table doit etre intacte');

  // Ce qui n est pas une chaine est ecarte, le reste est repris : un fichier a demi juste
  // vaut mieux qu un refus sec.
  const n = env.importLocaleJson(projet, 'en', '{"a":"A","b":42,"c":"C"}');
  assert.equal(n, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(projet.tables.en)), {a: 'A', c: 'C'});
});
