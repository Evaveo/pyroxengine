// moteur/test/script-confiance.test.mjs
//
// LA CONFIANCE ACCORDÉE AU CODE D'UN PROJET (js/script-trust.js).
//
// Le masquage de portée (js/script-scope.js) réduit la surface sans fermer `eval`. Ce qui ferme
// vraiment le vecteur, c'est de ne pas exécuter du code qu'on n'a pas écrit sans l'avoir
// demandé. Ce fichier mesure les comportements dont dépend cette promesse — et le quatrième est
// celui qu'on casse sans s'en rendre compte :
//
//   1. un code inconnu n'est pas de confiance ;
//   2. un code qu'on vient d'écrire l'est (la confiance suit la PATERNITÉ) ;
//   3. le MÊME code reste de confiance à travers un changement de fin de ligne — sinon la
//      question revient sans raison compréhensible, et on apprend à cliquer « oui » ;
//   4. un code MODIFIÉ redevient inconnu. C'est le cas le plus vicieux : le projet en qui on a
//      confiance, et dont la version suivante ne la mérite plus.
import { deEsm } from './engine-env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');

/** Le module, avec un localStorage en mémoire et une modale muette. */
function confiance(){
  const magasin = {};
  const stockage = {
    getItem: (k) => (k in magasin ? magasin[k] : null),
    setItem: (k, v) => { magasin[k] = String(v); },
    removeItem: (k) => { delete magasin[k]; }
  };
  const src = deEsm(read('js/script-trust.js'))
    .replace(/globalThis\.[A-Za-z]+ = [A-Za-z]+;/g, '');   // pas de globales dans le bac
  const fab = new Function('localStorage', 'openModal', 'closeModal', 'document',
    src + '\nreturn {fingerprintCode, sha256Hex, codeTrusted, trustCode, untrustedCode, codeOfAsset};');
  return {api: fab(stockage, function(){}, function(){}, {getElementById: () => null}), magasin};
}

test('un code INCONNU n est pas de confiance', () => {
  const {api} = confiance();
  assert.equal(api.codeTrusted('api.me.x += 1;'), false);
  // Un code vide n'est pas du code : il ne doit poser aucune question.
  assert.equal(api.codeTrusted(''), true);
  assert.equal(api.codeTrusted('   \n  '), true);
});

test('LA CONFIANCE SUIT LA PATERNITE : ce qu on vient d ecrire est de confiance', () => {
  const {api, magasin} = confiance();
  const code = 'function update(dt){ api.me.x += dt; }';
  api.trustCode(code);
  assert.equal(api.codeTrusted(code), true);
  // Et c'est bien persisté sous la clé attendue, en empreintes — jamais le code lui-même.
  const brut = magasin['moteur3d-scripts-confiance'];
  assert.ok(brut, 'rien n\'a été enregistré');
  assert.equal(brut.indexOf('api.me.x'), -1, 'le CODE est enregistré au lieu de son empreinte');
  assert.match(JSON.parse(brut)[0], /^s256:[0-9a-f]{64}$/);
});

test('UN CHANGEMENT DE FIN DE LIGNE ne fait pas reposer la question', () => {
  // Windows contre un dépôt en LF : le même script, deux octets près. Sans la normalisation,
  // la question revient à chaque aller-retour et on apprend à répondre oui sans lire.
  const {api} = confiance();
  api.trustCode('function start(){}\nfunction update(){}');
  assert.equal(api.codeTrusted('function start(){}\r\nfunction update(){}'), true);
});

test('UN CODE MODIFIE redevient inconnu — le cas du projet mis a jour', () => {
  const {api} = confiance();
  const v1 = 'api.log("bonjour");';
  api.trustCode(v1);
  assert.equal(api.codeTrusted(v1), true);
  assert.equal(api.codeTrusted(v1 + '\nfetch("//ailleurs");'), false,
    'une version modifiée hérite de la confiance accordée à la précédente : c\'est exactement '
    + 'le trou que la clé par EMPREINTE existe pour fermer');
});

test('untrustedCode ne retient que le code inconnu, et rien d autre', () => {
  const {api} = confiance();
  const connu = 'api.me.y = 0;';
  api.trustCode(connu);
  const listAssets = [
    {kind:'script', name:'connu', code:connu},
    {kind:'script', name:'inconnu', code:'api.me.y = 1;'},
    {kind:'script', name:'vide', code:'   '},
    {kind:'material', name:'pas du code', code:'api.me.y = 2;'}
  ];
  assert.deepEqual(api.untrustedCode(listAssets).map((a) => a.name), ['inconnu']);
});

// ---------- LE TROU QUE CES TESTS FERMENT ----------
// La garde ne regardait que `kind === 'script'`. Un asset `documentUI` porte du HTML de projet
// que js/game-ui.js ecrit dans `innerHTML` sans filtre — c'est sa fonction. Un projet SANS
// AUCUN SCRIPT mais avec un document d'interface passait donc la garde sans qu'aucune question
// soit posee, et ses gestionnaires en ligne s'executaient dans la page de l'editeur : acces a
// `localStorage` (ou vit la cle du copilote) et a `fetch`.
//
// Rien ne signalait ce chemin : la garde repondait « rien a demander » et avait l'air de
// fonctionner. C'est exactement la forme de defaut que ce depot appelle silencieuse.

test('UN DOCUMENT D INTERFACE EST DU CODE : il passe par la meme question', () => {
  const {api} = confiance();
  const html = '<img src=x onerror="fetch(String(localStorage.copilotKey))">';
  const listAssets = [{kind:'documentUI', name:'Menu', html}];

  assert.deepEqual(api.untrustedCode(listAssets).map((a) => a.name), ['Menu'],
    'un projet sans le moindre script doit quand meme poser la question');
  assert.equal(api.codeOfAsset(listAssets[0]), html,
    'le code d un documentUI est son HTML, pas son champ `code`');
});

test('un document d interface ecrit ICI ne repose pas la question', () => {
  // La paternite vaut pour le HTML comme pour un script : js/assets.js appelle trustCode()
  // a l'enregistrement. Sans ca, la personne serait interrogee sur son propre travail.
  const {api} = confiance();
  const html = '<div class="hud">Score</div>';
  api.trustCode(html);
  assert.deepEqual(api.untrustedCode([{kind:'documentUI', name:'HUD', html}]), []);
});

test('un document d interface MODIFIE repose la question', () => {
  const {api} = confiance();
  api.trustCode('<div>v1</div>');
  assert.deepEqual(
    api.untrustedCode([{kind:'documentUI', name:'HUD', html:'<div>v2</div>'}]).map((a) => a.name),
    ['HUD'],
    'le HTML a change, donc l empreinte aussi : c est un code qu on n a toujours pas ecrit');
});

test('une feuille de style n est PAS soumise a la question, et c est un choix', () => {
  // Son contenu part dans le `textContent` d'une balise <style>, qui n'execute aucun script.
  // Ce test EXISTE pour que le choix soit visible : si quelqu'un donne un jour au CSS un
  // chemin d'execution, c'est ici qu'il faut revenir.
  const {api} = confiance();
  const listAssets = [{kind:'feuilleStyle', name:'Theme', css:'body{color:red}'}];
  assert.deepEqual(api.untrustedCode(listAssets), []);
  assert.equal(api.codeOfAsset(listAssets[0]), '');
});

test('LES DEUX PORTES sont posees : la compilation et le bouton Jouer', () => {
  // Une seule des deux suffirait à croire le vecteur fermé alors qu'il ne l'est pas.
  // · compiledOf (js/scripts.js) couvre la simulation physique et la lecture d'animation, les
  //   deux moments où viewport.js fait tourner SystemScripts dans l'ÉDITEUR ;
  // · play() (js/play-mode.js) couvre « ▶ Jouer », qui ouvre game-preview.html — un onglet de
  //   MÊME ORIGINE, donc avec le même accès au localStorage que l'éditeur. Demander après
  //   l'ouverture ne servirait à rien : le code aurait déjà tourné.
  const scripts = read('js/scripts.js');
  assert.match(scripts, /codeTrusted\(code\)/,
    'js/scripts.js ne vérifie plus la confiance avant de compiler un script de projet');
  assert.match(read('js/play-mode.js'), /await allowRunScripts\(/,
    'js/play-mode.js n\'attend plus la réponse avant d\'ouvrir l\'onglet d\'aperçu');
  assert.match(scripts, /trustCode\(a\.code\)/,
    'js/scripts.js ne marque plus de confiance un script que la personne vient d\'écrire — la '
    + 'question se poserait alors sur son propre travail, et la garde serait désactivée');
});

test('LA PATERNITE vaut AUSSI pour un document d interface', () => {
  // Ajoute apres un test de mutation : retirer cette ligne de js/assets.js ne faisait tomber
  // AUCUN test, alors que la personne se serait vu demander l'autorisation d'executer le HTML
  // qu'elle venait de taper. Une garde qui interroge sur son propre travail est une garde
  // qu'on desactive dans la semaine — et le trou reviendrait entier.
  assert.match(read('js/assets.js'), /trustCode\(a\.html\)/,
    "js/assets.js ne marque plus de confiance un document d'interface que la personne vient "
    + "d'ecrire a l'enregistrement");
});

test('LE JEU PUBLIE n a PAS de porte de confiance', () => {
  // Décision, pas oubli : un joueur qui télécharge un jeu a déjà choisi de le lancer. Lui poser
  // la question serait du théâtre, et embarquer ce module alourdirait chaque build pour rien.
  assert.equal(/script-trust/.test(read('js/build.js')), false,
    'js/script-trust.js est embarqué dans le build : c\'est un module d\'ÉDITEUR');
  assert.equal(/script-trust/.test(read('game-preview.html')), false,
    'game-preview.html charge js/script-trust.js : la question n\'a pas de sens côté joueur');
  assert.equal(/script-trust/.test(read('js/game-runtime.js')), false,
    'le runtime dépend de js/script-trust.js, qui n\'est pas embarqué — 404 chez le joueur');
});

test('LES TEXTES VUS PAR LA PERSONNE sont en francais, et intacts', () => {
  // GARDE CONTRE UN PIÈGE VÉCU, DEUX FOIS. La passe de renommage automatique traduit aussi les
  // CHAÎNES : c'est ainsi qu'est né « linéarea » dans l'aide (docs/REVUE_2026-09-10.md § 1.3),
  // et c'est arrivé de nouveau en écrivant ce module — « le reste de l'éditeur » y était devenu
  // « le more de l'éditeur », dans la modale, sous les yeux de l'utilisateur.
  const src = read('js/script-trust.js');
  const modale = src.slice(src.indexOf('openModal('), src.indexOf('</div>'));
  ['more', 'items', 'names', 'unknown', 'trusted'].forEach((mot) => {
    assert.equal(new RegExp('[a-zàéèêç] ' + mot + '[ .,]').test(modale), false,
      'le mot anglais « ' + mot + ' » est apparu dans une phrase française de la modale — une '
      + 'passe de renommage a traduit une CHAÎNE au lieu du seul code');
  });
  assert.match(modale, /Ne pas exécuter/, 'le libellé du refus a disparu');
  assert.match(modale, /Exécuter les scripts/, 'le libellé de l\'acceptation a disparu');
});

test('RÉGRESSION § 2.2 — l empreinte est un SHA-256 exact (vecteurs FIPS 180-4)', () => {
  const {api} = confiance();
  assert.equal(api.sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(api.sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(api.sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  assert.ok(/^s256:[0-9a-f]{64}$/.test(api.fingerprintCode('api.me.x += 1;')));
  // Une ancienne empreinte FNV (8 caractères hexadécimaux) ne vaut plus confiance.
  const ancien = confiance();
  ancien.magasin['moteur3d-scripts-confiance'] = JSON.stringify(['1a2b3c4d']);
  assert.equal(ancien.api.codeTrusted('x'), false);
});
