// TROIS DÉFAUTS D'OUTIL — petits, et chacun a coûté une fausse conclusion.
//
// Ils ne cassent aucun jeu. Ils font perdre du temps à celui qui construit : une fonction qui
// travaille sans le dire, un gabarit juste en 3D et faux en 2D, un fichier qu'on ne retrouve pas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');

/** Le body d'une fonction, des accolades équilibrées. */
function body(src, header){
  const i = src.indexOf(header);
  assert.notEqual(i, -1, header + ' introuvable');
  let n = 0;
  for(let k = src.indexOf('{', i); k < src.length; k++){
    if(src[k] === '{') n++;
    else if(src[k] === '}'){ n--; if(!n) return src.slice(i, k + 1); }
  }
  return src.slice(i);
}

test('CREER UN PREFAB REND L ASSET — une fonction qui travaille doit le dire', () => {
  // Elle poussait l'asset dans `assets` et ne rendait rien. Tout appelant voulant enchaîner devait
  // aller le repêcher. Mesuré : un essai a conclu « échec de création » alors que le prefab
  // existait bel et bien.
  const c = body(read('js/assets.js'), 'function createPrefabFromSelection(');
  assert.match(c, /\n  return a;\n/,
    'createPrefabFromSelection ne rend pas l\'asset créé');
  // Les sorties anticipées, elles, doivent rester muettes : rendre `undefined` quand rien n'a été
  // créé est la bonne réponse, et c'est ce qui distingue « pas fait » de « fait ».
  assert.match(c, /if\(!source\)\{[\s\S]{0,120}return; \}/,
    'la sortie « aucune sélection » doit rendre undefined, pas un asset');
});

test('LE GABARIT D UN PREFAB est recentre en X et Z, jamais en Y', () => {
  // `y` est la HAUTEUR : la remettre à zéro poserait au sol tout objet suspendu — un
  // lampadaire fabriqué depuis un objet accroché, et l'auteur le voudrait rarement.
  //
  // Un cas particulier existait pour les objets 2D, où `y` est une coordonnée du plan au même
  // titre que `x` : leur gabarit voyait aussi son `y` remis à zéro. Il reposait sur la
  // séparation des deux mondes, qui n'existe plus — un objet à sprite est un objet comme un
  // autre, et son gabarit garde la position que son auteur voit.
  const c = body(read('js/assets.js'), 'function createPrefabFromSelection(');
  assert.match(c, /template.position.x = 0;/);
  assert.match(c, /template.position.z = 0;/);
  assert.equal(/template.position.y = 0;/.test(c), false,
    'le gabarit remet Y a zero : tout prefab fabrique depuis un objet suspendu tomberait au sol');
});

test('ENREGISTRER DEMANDE OU, et ne retombe pas sur le telechargement quand on refuse', () => {
  // `<a download>` laisse le navigateur nommer le fichier : mesuré, un .p3d de 1,7 Mo arrivé sous
  // un nom d'identifiant suffixé .tmp, retrouvé à sa taille et à sa signature ZIP. Un project qu'on
  // ne reconnaît plus est un project perdu.
  const src = read('js/serialization.js');
  const c = body(src, 'async function writeFileChosen(');
  // LA CONDITION, pas le nom. Chercher le nom quelque part dans la fonction laissait passer un
  // if(false) qui rend la branche morte : le nom reste ecrit, et plus rien ne demande jamais ou
  // register. Meme famille que le filtre d acceptation d api.create.
  assert.ok(c.indexOf("if(typeof showSaveFilePicker === 'function'){") >= 0,
    "la demande de destination n est plus conditionnee a la presence de l API — branche morte ?");
  assert.ok(c.indexOf("await showSaveFilePicker({") >= 0, "l API n est jamais appelee");
  assert.match(c, /suggestedName: fileName/, 'le nom proposé n\'est pas celui du project');
  // UN REFUS N EST PAS UNE PANNE. Sans ce cas, undo la boîte de dialogue déclencherait le
  // repli et déposerait quand même le fichier — l'utilisateur a dit non, pas « fais autrement ».
  assert.match(c, /if\(e && e\.name === 'AbortError'\) return 'annule';/,
    'un refus de l\'utilisateur retombe sur le téléchargement');
  // Le repli existe quand même : l'API n'est pas partout.
  assert.match(c, /a\.download = fileName;/, 'aucun repli : un navigateur sans l\'API ne sauve plus rien');
  // Et l'appelant doit traiter le refus, sinon il annonce « enregistré » alors que rien ne l'est.
  const e = body(src, 'async function registerScene(');
  assert.match(e, /=== 'annule'/, 'registerScene annonce un succès même quand on annule');
});
