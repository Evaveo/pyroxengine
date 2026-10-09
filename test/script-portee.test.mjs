// moteur/test/script-portee.test.mjs
//
// LA PORTÉE D'UN SCRIPT DE PROJET, MESURÉE — pas supposée.
//
// Un script voyage DANS le fichier de projet : ouvrir le projet de quelqu'un d'autre, c'est
// exécuter son code. Jusqu'en v0.149.4 ce code héritait de la portée globale entière, et le
// gain le plus direct pour un attaquant n'était pas d'abîmer la scène — c'était
// `localStorage.getItem('copilot-key')`, la clé d'API du copilote de la personne qui ouvre le
// projet, suivie d'un `fetch` vers n'importe où. Deux lignes.
//
// Ce fichier vérifie trois choses, et en oublier une aurait suffi à laisser passer le défaut :
//   1. les globales sensibles sont bien masquées À L'EXÉCUTION (on compile et on regarde) ;
//   2. les DEUX moteurs passent par la même fabrique — une portée plus large côté jeu publié
//      donnerait un script qui échoue à l'essai et passe une fois publié ;
//   3. la liste ne contient pas de nom qui casserait TOUT script (`eval`, `arguments`, un
//      mot-clé), ce qui est l'erreur qu'on ferait en voulant bien faire.
import { deEsm } from './engine-env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');

/** `compileScript` et sa liste, chargés depuis la source réelle. */
function portee(){
  const src = deEsm(read('js/script-scope.js'));
  return new Function(src + '\nreturn {compileScript, GLOBALS_HIDDEN};')();
}

test('UN SCRIPT DE PROJET garde acces au DOM — la regression de la v0.149.4', () => {
  // ⚠ CE TEST AFFIRMAIT L'INVERSE JUSQU'À LA v0.150.1, et c'est lui qui a donné confiance en un
  // masquage qui cassait le moteur. Il vérifiait que `document` et `window` étaient
  // `undefined` : vrai, mesurable, vert — et faux comme exigence.
  //
  // Les scripts de projet PILOTENT L'INTERFACE HTML du jeu (fonctionnalité UIDocument). Mesuré
  // sur `find jeux -path "*/assets/Scripts/*"` : `document` 84 fois, `window` 86, `open` 26,
  // `localStorage` 12. Le masquage a cassé « Interface » de Chromélo au premier lancement —
  // `Cannot read properties of undefined (reading 'getElementById')`, trois scripts d'un coup.
  //
  // La mesure qui avait validé le masquage utilisait le glob `jeux/*/assets/Scripts/*.js`, à UN
  // SEUL NIVEAU : elle ne voyait ni `Scripts/Commun/` ni `Scripts/Labyrinthe/`, et n'a donc
  // presque rien lu. Un résultat vide fait la même impression qu'une absence de problème.
  //
  // Ce test-ci tient désormais l'exigence RÉELLE : ce que les scripts utilisent doit marcher.
  // Node n'a ni `document` ni `window` : on les POSE le temps du test. C'est ce qui rend la
  // mesure honnête — si le masquage revenait, la sonde verrait `undefined` alors que le global
  // existe, exactement ce qui s'est passé dans le navigateur.
  const {compileScript} = portee();
  const poses = {document:{getElementById(){ return null; }}, window:{}, open(){}, localStorage:{}};
  const avant = {};
  Object.keys(poses).forEach((k) => { avant[k] = globalThis[k]; globalThis[k] = poses[k]; });
  try{
    const vu = compileScript(
      'return {doc: typeof document, win: typeof window, ouvrir: typeof open,'
      + ' stockage: typeof localStorage};', '')(null);
    assert.deepEqual(vu, {doc:'object', win:'object', ouvrir:'function', stockage:'object'},
      'une globale dont les scripts de projet ont besoin est masquée alors qu\'elle EXISTE — '
      + 'l\'interface HTML d\'un jeu ne peut plus fonctionner : ' + JSON.stringify(vu));
    // Et le geste exact qui plantait : `document.getElementById` depuis un script.
    assert.doesNotThrow(
      () => compileScript('return document.getElementById("game");', '')(null),
      'document.getElementById() lève depuis un script de projet — c\'est LA régression');
  } finally {
    Object.keys(poses).forEach((k) => {
      if(avant[k] === undefined) delete globalThis[k]; else globalThis[k] = avant[k];
    });
  }
});

test('LE MASQUAGE EST VIDE, et le rester est une DECISION', () => {
  // Retiré en v0.150.1, pas oublié. Deux raisons, et la seconde vaut indépendamment de la
  // régression : tant que `window` doit rester accessible — et il le doit —, `window.fetch` et
  // `window.localStorage` le sont aussi. Masquer les identifiants nus ne gênait que le code
  // honnête, tout en donnant l'impression d'une protection.
  //
  // Ce qui protège réellement est js/script-trust.js : ne pas exécuter du code qu'on n'a pas
  // écrit sans l'avoir demandé. Cette parade-là ne suppose rien de ce dont un script a besoin.
  const {GLOBALS_HIDDEN} = portee();
  assert.deepEqual(GLOBALS_HIDDEN, [],
    'des globales sont de nouveau masquées. Avant de refaire ça : mesurer sur TOUS les scripts '
    + 'de projet (find jeux -path "*/assets/Scripts/*"), et répondre à « qu\'est-ce que ça '
    + 'arrête, alors que window reste accessible ? ». Voir l\'en-tête de js/script-scope.js.');
  assert.match(read('js/script-scope.js'), /window\.fetch/,
    'la raison du retrait a disparu de l\'en-tête — sans elle, le masquage reviendra');
});

test('TOUTE la liste est masquee, pas seulement les noms qu on a en tete', () => {
  const {compileScript, GLOBALS_HIDDEN} = portee();
  const restants = GLOBALS_HIDDEN.filter(
    (n) => compileScript('return typeof ' + n + ';', '')(null) !== 'undefined');
  assert.deepEqual(restants, [],
    'nom(s) déclaré(s) masqué(s) mais toujours visible(s) depuis un script :\n  '
    + restants.join('\n  '));
});

test('api reste intact — le masquage ne coute rien au script legitime', () => {
  const {compileScript} = portee();
  // La contrepartie : si le durcissement cassait l'API, il serait retiré au premier bug.
  const f = compileScript('return api.me.name + "/" + Math.round(api.t) + "/" + typeof JSON;', '');
  assert.equal(f({me:{name:'Joueur'}, t:2.4}), 'Joueur/2/object');
});

test('un script qui utilise SEULEMENT api compile et tourne', () => {
  const {compileScript} = portee();
  const f = compileScript(
    'function start(){ api.log("ok"); }\nfunction update(dt){ api.me.x += dt; }',
    '\nreturn {start:(typeof start==="function")?start:null,'
    + 'update:(typeof update==="function")?update:null};');
  const r = f({log(){}, me:{x:0}});
  assert.equal(typeof r.start, 'function');
  assert.equal(typeof r.update, 'function');
});

test('LES DEUX MOTEURS compilent par la MEME fabrique', () => {
  // Le défaut qu'on refuse : une portée réduite d'un seul côté. Le script marcherait à l'essai
  // et casserait chez le joueur — ou l'inverse, ce qui est pire parce que ça se voit trop tard.
  const restants = [];
  ['js/scripts.js', 'js/game-runtime.js', 'js/analysis.js'].forEach((f) => {
    const code = read(f).split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    if(/new Function\(\s*'api'/.test(code)) restants.push(f);
    assert.ok(/\bcompileScript\(/.test(code), f + ' n\'appelle pas compileScript()');
  });
  assert.deepEqual(restants, [],
    'ce(s) fichier(s) compilent encore un script de projet par `new Function(\'api\', …)`, donc '
    + 'dans la portée globale complète. Passer par compileScript() (js/script-scope.js) :\n  '
    + restants.join('\n  '));
});

test('LA LISTE ne contient rien qui casserait tout script', () => {
  const {GLOBALS_HIDDEN, compileScript} = portee();
  // `eval` et `arguments` sont interdits comme noms de paramètre en mode strict, un mot-clé
  // aussi : les mettre ici ferait échouer la compilation de N'IMPORTE QUEL script — le genre de
  // durcissement qui casse tout et qu'on retire le lendemain.
  const interdits = ['eval', 'arguments', 'import', 'return', 'this', 'api'];
  const fautes = GLOBALS_HIDDEN.filter((n) => interdits.includes(n));
  assert.deepEqual(fautes, [],
    'nom(s) inutilisables comme paramètre : tout script deviendrait une SyntaxError.\n  '
    + fautes.join('\n  '));

  const doubles = GLOBALS_HIDDEN.filter((n, i) => GLOBALS_HIDDEN.indexOf(n) !== i);
  assert.deepEqual(doubles, [], 'doublon(s) dans la liste — SyntaxError en mode strict');

  // Et la preuve par l'exécution : un script vide compile.
  assert.doesNotThrow(() => compileScript('', ''), 'la liste rend tout script incompilable');
});

test('LE MODELE DE MENACE est ecrit, et distingue script et plugin', () => {
  // Cette garde-ci protège une DÉCISION, pas un comportement. Le jour où quelqu'un voudra
  // « durcir les plugins pour faire pareil », la raison de ne pas le faire doit être sous ses
  // yeux : un plugin ne voyage pas dans un projet, il est collé délibérément.
  const src = read('js/script-scope.js');
  assert.match(src, /VOYAGE DANS LE FICHIER DE PROJET/,
    'le modèle de menace a disparu de js/script-scope.js');
  assert.match(src, /NE VOYAGE PAS/, 'la distinction script/plugin a disparu');
  assert.match(src, /eval/,
    'la limite connue (eval non masquable) n\'est plus dite — une garde qu\'on croit étanche '
    + 'est pire que pas de garde');

  // Et le fait sur lequel repose toute la distinction : les plugins vivent hors du projet.
  assert.match(read('js/plugins.js'), /moteur3d-plugins/,
    'les plugins ne sont plus stockés dans le localStorage de l\'éditeur — si un plugin peut '
    + 'désormais voyager dans un fichier de projet, TOUT le modèle de menace de '
    + 'js/script-scope.js est à refaire');
});
