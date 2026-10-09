// L'API DE SCRIPT EXISTE DEUX FOIS, ET RIEN NE LES COMPARAIT.
//
// `apiFor()` est écrit dans js/scripts.js pour l'éditeur, et une seconde fois dans
// js/game-runtime.js pour le jeu publié. Les commentaires du moteur promettent « miroir exact
// de js/scripts.js » à cinq endroits — une promesse tenue à la main, donc tenue jusqu'au jour
// où elle ne l'est plus.
//
// Elle ne l'était plus deux fois :
//   · `api.node` existait dans l'éditeur et manquait au runtime. Trouvé et corrigé — par
//     quelqu'un qui a rencontré le plantage, pas par un test.
//   · `api.findByTag` existait dans l'éditeur, où il rendait TOUJOURS un tableau empty
//     (il lisait `userData.tag`, que rien n'écrit ; le tag est dans `userData.game.tag`), et
//     manquait au runtime, où il levait « n'est pas une fonction ». Trouvé en auditant l'aide.
//
// C'est la pire shape de divergence : le script tourne en édition — un tableau empty se lit
// comme « il n'y a pas d'ennemis dans la scène », donc on cherche le défaut dans la scène —
// et casse une fois publié, quand la boucle de correction est la plus lente. Ce fichier
// remplace la promesse par une mesure.
import { HELP_SCRIPTS, readHelpSource } from './help-env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');

/**
 * Les clés d'un objet littéral d'api, lues à une indentation fixe.
 *
 * On lit le TEXTE plutôt que d'exécuter : les deux fichiers tirent la moitié du moteur, et
 * un bouchon assez gros pour les faire tourner finirait par masquer ce qu'on mesure. Le
 * garde-fou de cette lecture est l'assertion de volume : une extraction cassée rend une
 * liste courte, et une liste vide ferait passer toutes les comparaisons.
 */
function litteralApi(file, debutMotif){
  const src = read(file).replace(/\r\n/g, '\n');
  const d = src.indexOf(debutMotif);
  assert.notEqual(d, -1, `${file} : « ${debutMotif} » a disparu — la lecture est à refaire`);
  const f = src.indexOf('\n  });', d);
  assert.notEqual(f, -1, `${file} : end de l'object api introuvable`);
  return src.slice(d, f);
}

function clesApi(litteral){
  const keys = new Set();
  litteral.split('\n').forEach((line) => {
    const m = line.match(/^ {4}(?:get\s+)?([A-Za-z_$][\w$]*)\s*[:(]/);
    if(!m) return;
    keys.add(m[1]);
    // PLUSIEURS CLÉS SUR UNE LIGNE. Le runtime écrit `me:o, node:o, dt:dt, time:game.time,
    // scene:game.scene,` d'un trait. Une lecture ancrée en début de ligne n'en voyait que la
    // première et déclarait les quatre autres absentes du jeu publié — quatre fausses
    // divergences, qui auraient fait « corriger » un moteur juste. On ne déplie que les
    // lines SIMPLES : dès qu'il y a une brace ou une parenthèse, la ligne ouvre une
    // fonction ou un objet, et les `key:` qu'elle contient ne sont plus des entrées d'api.
    if(/[{(]/.test(line)) return;
    line.trim().split(',').forEach((part) => {
      const p = part.match(/^\s*([A-Za-z_$][\w$]*)\s*:/);
      if(p) keys.add(p[1]);
    });
  });
  return keys;
}

// LE LITTÉRAL, PAS LE FICHIER, et ce n'est pas de la propreté. `byTag:` apparaît AUSSI dans
// la table des alias anglais de jeu-runtime.js (`byTag:'byTag'`), cinquante lignes plus haut.
// Chercher dans le fichier entier attrapait cette occurrence-là et comparait un nom d'alias à
// un body de fonction — un test rouge pour une raison fausse, ce qui apprend à ne plus le
// croire. Le dépôt s'est déjà fait prendre deux fois à ce piège d'`indexOf`.
const LITTERAL = {
  'js/scripts.js': litteralApi('js/scripts.js', 'return ({'),
  'js/game-runtime.js': litteralApi('js/game-runtime.js', 'return ({')
};
const EDITEUR = clesApi(LITTERAL['js/scripts.js']);
const JEU = clesApi(LITTERAL['js/game-runtime.js']);


// LES DIVERGENCES CONNUES, NOMMÉES UNE PAR UNE, AVEC LEUR RAISON.
//
// Une liste d'exceptions est un aveu, pas une échappatoire : c'est ce qui distingue « on
// sait, et l'aide le dit » de « personne ne sait ». Chaque entrée ici doit être signalée au
// lecteur dans la page « L'object api » — le test l'exige plus bas. Vider cette liste en
// portant la fonction est le but ; y add une ligne demande d'expliquer pourquoi.
const CONNUES_EDITEUR_SEUL = {
  // `hauteurSol` appelle heightTerrainIn() de js/terrain.js, que ni l'aperçu ni le build ne
  // chargent : le terrain sculpté est un outil d'ÉDITION, et sa grille de heights ne voyage
  // pas. Le porter est un vrai chantier (le module, les heights dans les données publiées,
  // les points de branchement), pas une ligne — donc on le DIT au lieu de le laisser
  // surprendre après l'export.
  groundHeight: 'js/terrain.js n\'est chargé ni par l\'aperçu ni par le build'
};

test('TOUTE ENTREE D API DE L EDITEUR existe aussi dans le jeu publie', () => {
  assert.ok(EDITEUR.size >= 40, `seulement ${EDITEUR.size} entrées lues côté éditeur — extraction cassée`);
  assert.ok(JEU.size >= 40, `seulement ${JEU.size} entrées lues côté game — extraction cassée`);
  // Auto-contrôle de la lecture : ces quatre-là sont sur UNE SEULE ligne du runtime. Si le
  // dépliage des lignes simples casse, elles repassent pour absentes et le test accuse un
  // moteur juste — c'est arrivé en écrivant ce fichier.
  ['node', 'dt', 'time', 'scene'].forEach((k) => {
    assert.ok(JEU.has(k), `api.${k} non lu côté game — le dépliage des lignes multi-clés est cassé`);
  });

  const manquantes = Array.from(EDITEUR)
    .filter((k) => !JEU.has(k) && !(k in CONNUES_EDITEUR_SEUL));
  assert.deepEqual(manquantes, [],
    'entrées présentes dans l\'éditeur et ABSENTES du jeu publié — un script qui les utilise\n'
    + 'passera l\'édition et lèvera « n\'est pas une fonction » après export : ' + manquantes.join(', '));

  // Une exception qui n'en est plus une doit sortir de la liste : sinon elle finit par
  // couvrir une vraie divergence, et l'aide continue d'annoncer une limite qui n'existe plus.
  const perimees = Object.keys(CONNUES_EDITEUR_SEUL).filter((k) => JEU.has(k));
  assert.deepEqual(perimees, [],
    'ces entrées existent maintenant dans le jeu : retirez-les de CONNUES_EDITEUR_SEUL et de '
    + 'l\'aide : ' + perimees.join(', '));
});

test('CHAQUE DIVERGENCE CONNUE est dite au lecteur dans l aide', () => {
  const src = readHelpSource();
  Object.keys(CONNUES_EDITEUR_SEUL).forEach((k) => {
    const i = src.indexOf("name:'" + k + "'");
    assert.notEqual(i, -1, `api.${k} n'a pas d'entrée dans API_HELP`);
    // L'AVERTISSEMENT DOIT ÊTRE DANS SON ENTRÉE, pas ailleurs dans le fichier : une page qui
    // parle d'édition trois cents lignes plus loin n'avertit personne. On clamped donc à
    // l'entrée suivante — chercher dans tout le fichier ferait passer ce test pour n'importe
    // quelle mention du mot, et c'est le piège d'`indexOf` que ce dépôt connaît bien.
    const sequence = src.slice(i);
    const finEntree = sequence.slice(1).search(/\n\s*\{name:|^\n\];/m);
    const entry = finEntree === -1 ? sequence.slice(0, 600) : sequence.slice(0, finEntree + 1);
    assert.ok(/éditeur seulement|dans l'éditeur seulement|pas dans le jeu publié/.test(entry),
      `l'entrée d'aide de api.${k} ne dit pas qu'elle ne marche que dans l'éditeur `
      + `(raison : ${CONNUES_EDITEUR_SEUL[k]})`);
  });
});

test('ET RECIPROQUEMENT : une entrée que le jeu seul possede est inatteignable', () => {
  // Moins grave, mais c'est la même maladie vue de l'autre côté : on ne peut pas écrire un
  // script contre une api que l'éditeur n'expose pas — on ne peut pas l'essayer avant de
  // publier. Une entrée volontairement propre au jeu devrait être NOMMÉE ici, avec sa raison.
  const propresAuJeu = [];
  const enTrop = Array.from(JEU).filter((k) => !EDITEUR.has(k) && !propresAuJeu.includes(k));
  assert.deepEqual(enTrop, [],
    'entrées du jeu publié absentes de l\'éditeur : ' + enTrop.join(', '));
});

test('LE TAG SE LIT DANS userData.game.tag, dans les deux moteurs', () => {
  // La faute exacte qui a rendu `trouverParTag` muet : `userData.tag`. Ce n'est pas une
  // faute de frappe plausible mais un chemin qui EXISTE en JavaScript et rend `undefined` —
  // donc aucune erreur, un tableau empty, et une recherche de bug dans la mauvaise moitié
  // du project. Aucun des deux fichiers ne doit plus le lire.
  const fautifs = [];
  for(const f of ['js/scripts.js', 'js/game-runtime.js']){
    read(f).replace(/\r\n/g, '\n').split('\n').forEach((line, i) => {
      // On ignore les commentaires : ceux qui EXPLIQUENT la faute citent forcément le chemin.
      if(/^\s*(\/\/|\*)/.test(line)) return;
      if(/userData\.tag\b/.test(line)) fautifs.push(`${f}:${i + 1} ${line.trim()}`);
    });
  }
  assert.deepEqual(fautifs, [],
    'le tag n\'est PAS dans userData.tag — rien ne l\'y écrit :\n' + fautifs.join('\n'));

  // Et les deux noms de la même recherche doivent bien rendre la même chose.
  //
  // AVANT, cette vérification comparait le CHEMIN LU (`x.userData.game.tag`) dans les quatre
  // corps de fonction — quatre `objects.filter(...)` recopiés, deux par moteur. Il n'y en a plus
  // qu'un : les deux noms sont des ALIAS de `nodesByTag` (js/components/component-tag.js), qui
  // interroge le Registry au lieu de balayer toute la scène à chaque appel. Deux noms d'une
  // seule fonction ne peuvent plus diverger par construction, et c'est ce qu'on mesure ici.
  // Voir docs/REVUE_2026-09-10.md § 1.6.
  for(const f of ['js/scripts.js', 'js/game-runtime.js']){
    const cible = (name) => {
      const m = LITTERAL[f].match(new RegExp('\\n {4}' + name + '\\s*:\\s*([A-Za-z_$][\\w$]*)\\s*,'));
      assert.ok(m, `${f} : api.${name} n'est plus un alias d'une fonction nommée. S'il a retrouvé`
        + ' un corps propre, la divergence entre les deux noms — et le balayage de scène — sont'
        + ' de retour.');
      return m[1];
    };
    assert.equal(cible('findByTag'), cible('byTag'),
      `${f} : api.findByTag et api.byTag ne désignent pas la même fonction`);
    assert.equal(cible('byTag'), 'nodesByTag',
      `${f} : api.byTag doit déléguer à nodesByTag (Registry), pas à un balayage de scène`);
  }

  // Et c'est bien `userData.game.tag` que cette unique fonction lit, par le Registry.
  const tagComp = read('js/components/component-tag.js').replace(/\r\n/g, '\n');
  const corps = tagComp.slice(tagComp.indexOf('function nodesByTag'));
  assert.match(corps, /userData\.game\.tag/,
    'nodesByTag ne lit plus userData.game.tag — le seul chemin où le tag existe vraiment');
  assert.match(corps, /Registry\.activeNodes\('Tag'\)/,
    'nodesByTag doit passer par le Registry : c\'est tout l\'intérêt du composant Tag');
});

test('L AIDE documente les DEUX noms, sans en oublier un', () => {
  // Une entrée d'api non documentée est une entrée que personne ne trouvera : l'aide est le
  // seul catalogue. Et le test de l'aide ne vérifiait que le sens inverse — que l'aide
  // n'invente rien — ce qui laissait passer les oublis en silence.
  const src = readHelpSource();
  // Les noms ANGLAIS : ce sont eux la shape canonique depuis l'inversion d'api-alias.js, et
  // c'est eux que porte API_HELP. Le francais reste un alias valide, documente une fois pour
  // toutes dans la page « scripts » plutot que repete sur chaque ligne du catalogue.
  ['findNode', 'findByTag', 'node'].forEach((k) => {
    assert.ok(src.includes("name:'" + k + "'"),
      `api.${k} existe dans le moteur et n'a pas d'entrée dans API_HELP`);
  });
});
