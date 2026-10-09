// moteur/test/outils-renommage.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { segmenter, renommer } from '../outils/renommage.mjs';

function types(code) { return segmenter(code).map((s) => s.type); }
function texteDe(code, type) {
  return segmenter(code).filter((s) => s.type === type).map((s) => s.texte);
}

test('le code nu est un seul segment de code', () => {
  assert.deepEqual(types('const a = 1;'), ['code']);
});

test('une chaine simple quote est isolee, apostrophe echappee comprise', () => {
  assert.deepEqual(texteDe("const t = 'Nom de l\\'objet';", 'chaine'), ["'Nom de l\\'objet'"]);
});

test('une chaine double quote est isolee', () => {
  assert.deepEqual(texteDe('const t = "Nom";', 'chaine'), ['"Nom"']);
});

test('un gabarit est isole', () => {
  assert.deepEqual(texteDe('const t = `nom ${x}`;', 'gabarit'), ['`nom ${x}`']);
});

test('un commentaire de ligne est isole', () => {
  assert.deepEqual(texteDe('const a = 1; // le nom du noeud', 'ligne'), ['// le nom du noeud']);
});

test('un commentaire de bloc multiligne est isole', () => {
  assert.deepEqual(texteDe('/* le nom\n   du noeud */\nconst a = 1;', 'bloc'), ['/* le nom\n   du noeud */']);
});

test('un slash de division n est PAS pris pour une regex', () => {
  assert.deepEqual(types('const r = a / b / c;'), ['code']);
});

test('une regex litterale est isolee', () => {
  assert.deepEqual(texteDe('const r = /nom\\/x/g;', 'regex'), ['/nom\\/x/g']);
});

test('un // dans une chaine n ouvre pas un commentaire', () => {
  assert.deepEqual(texteDe("const u = 'http://x'; const a = 1;", 'chaine'), ["'http://x'"]);
});

const table = { nom: 'name', noeud: 'node' };

test('renomme un identifiant dans le code, par mot entier', () => {
  assert.equal(renommer('const nom = noeud.nom;', table, {}), 'const name = node.name;');
});

test('ne touche PAS un identifiant plus long qui contient le motif', () => {
  assert.equal(renommer('const nomFichier = 1;', table, {}), 'const nomFichier = 1;');
});

test('ne touche PAS le suffixe d un identifiant', () => {
  assert.equal(renommer('const monNom = 1;', table, {}), 'const monNom = 1;');
});

test('laisse les chaines intactes par defaut', () => {
  assert.equal(renommer("libelle('Nom du noeud');", table, {}), "libelle('Nom du noeud');");
});

test('laisse les commentaires intacts par defaut', () => {
  assert.equal(renommer('const nom = 1; // le nom du noeud', table, {}),
    'const name = 1; // le nom du noeud');
});

test('commentaires: true renomme AUSSI dans les commentaires', () => {
  assert.equal(renommer('const nom = 1; // voir noeud.nom', table, { commentaires: true }),
    'const name = 1; // voir node.name');
});

test('chaines: true renomme AUSSI dans les chaines (pour les ids DOM)', () => {
  assert.equal(renommer("get('btn-nom');", { 'btn-nom': 'btn-name' }, { chaines: true }),
    "get('btn-name');");
});

test('compter rend le nombre d occurrences remplacees par symbole', () => {
  const { resultat, comptes } = renommer('nom + nom + noeud;', table, { compter: true });
  assert.equal(resultat, 'name + name + node;');
  assert.deepEqual(comptes, { nom: 2, noeud: 1 });
});

test('un remplacement ne cascade jamais sur un autre symbole de la meme passe', () => {
  const t = { nom: 'noeud', noeud: 'x' };
  assert.equal(renommer('const nom = 1;', t, {}), 'const noeud = 1;');
});
