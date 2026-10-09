// QUI ECRASE QUI, QUAND DEUX PERSONNES ENREGISTRENT LA MEME SCENE.
//
// Le serveur refuse en 409 en NOMMANT les fichiers en conflit. L'editeur affichait ce nom et
// s'arretait la : on etait declare perdant sans rien pouvoir faire de l'information. La
// resolution rejoue l'enregistrement avec un arbitrage par fichier.
//
// LE PIEGE EST LE POINT DE DEPART. Il faut repartir du manifeste de TETE, pas du mien :
// repartir du mien effacerait les fichiers que le collegue a ecrits SANS conflit — ceux dont
// aucun ecran ne parle, et dont la disparition ne se verrait donc nulle part.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { myChanges, resolveConflict, scenesToWrite } from '../js/cloud-project.js';
import { conflictScreenHtml, readChoices } from '../js/conflict-screen.js';

const f = (sha, size = 10) => ({ sha: String(sha).padStart(64, '0'), size });

// Un cas complet : nous partons tous les deux de `base`.
//   - `scenes/a.scene.json` : modifie des DEUX cotes  -> conflit
//   - `project.json`        : modifie des DEUX cotes  -> conflit
//   - `assets/lui.png`      : ajoute par LUI seul     -> a conserver
//   - `assets/moi.png`      : ajoute par MOI seul     -> a enregistrer
//   - `scenes/b.scene.json` : intouche                -> a conserver
const base = {
  'project.json': f(1), 'scenes/a.scene.json': f(2), 'scenes/b.scene.json': f(3)
};
const head = {
  'project.json': f(11), 'scenes/a.scene.json': f(12), 'scenes/b.scene.json': f(3),
  'assets/lui.png': f(13)
};
const mine = {
  'project.json': f(21), 'scenes/a.scene.json': f(22), 'scenes/b.scene.json': f(3),
  'assets/moi.png': f(23)
};
const conflicts = ['project.json', 'scenes/a.scene.json'];

test('mes changements sont ceux qui different de MA base, suppressions comprises', () => {
  assert.deepEqual(myChanges(base, mine),
    ['assets/moi.png', 'project.json', 'scenes/a.scene.json']);

  const sansB = { ...mine };
  delete sansB['scenes/b.scene.json'];
  assert.ok(myChanges(base, sansB).includes('scenes/b.scene.json'),
    'supprimer un fichier est une modification comme une autre');
});

test('tout garder de moi : son travail SANS conflit survit quand meme', () => {
  const out = resolveConflict(base, head, mine, conflicts,
    { 'project.json': 'mine', 'scenes/a.scene.json': 'mine' });

  assert.equal(out['project.json'].sha, mine['project.json'].sha);
  assert.equal(out['scenes/a.scene.json'].sha, mine['scenes/a.scene.json'].sha);
  assert.equal(out['assets/moi.png'].sha, mine['assets/moi.png'].sha);
  // LE POINT QUI COMPTE : je n'ai jamais vu ce fichier, il n'est dans aucun ecran, et il ne
  // doit pas disparaitre parce que j'ai clique « tout garder de moi ».
  assert.equal(out['assets/lui.png'].sha, head['assets/lui.png'].sha,
    'un fichier que le collegue a ajoute sans conflit doit survivre a mon arbitrage');
  assert.equal(out['scenes/b.scene.json'].sha, base['scenes/b.scene.json'].sha);
});

test('tout garder de lui : mes changements SANS conflit sont quand meme enregistres', () => {
  const out = resolveConflict(base, head, mine, conflicts,
    { 'project.json': 'theirs', 'scenes/a.scene.json': 'theirs' });

  assert.equal(out['project.json'].sha, head['project.json'].sha);
  assert.equal(out['scenes/a.scene.json'].sha, head['scenes/a.scene.json'].sha);
  assert.equal(out['assets/moi.png'].sha, mine['assets/moi.png'].sha,
    "ceder sur la scene ne doit pas jeter le reste de mon travail");
  assert.equal(out['assets/lui.png'].sha, head['assets/lui.png'].sha);
});

test('un choix par fichier, pas un choix global', () => {
  const out = resolveConflict(base, head, mine, conflicts,
    { 'project.json': 'mine', 'scenes/a.scene.json': 'theirs' });

  assert.equal(out['project.json'].sha, mine['project.json'].sha);
  assert.equal(out['scenes/a.scene.json'].sha, head['scenes/a.scene.json'].sha);
});

test('SANS choix explicite, on garde la sienne : un arbitrage ne detruit pas par defaut', () => {
  const out = resolveConflict(base, head, mine, conflicts, {});
  assert.equal(out['project.json'].sha, head['project.json'].sha);
  assert.equal(out['scenes/a.scene.json'].sha, head['scenes/a.scene.json'].sha);
  assert.equal(out['assets/moi.png'].sha, mine['assets/moi.png'].sha,
    'le defaut ne porte que sur les fichiers EN CONFLIT');
});

test('une suppression de mon cote passe quand elle ne porte pas sur un conflit', () => {
  const mineSansB = { ...mine };
  delete mineSansB['scenes/b.scene.json'];
  const out = resolveConflict(base, head, mineSansB, conflicts, {});
  assert.ok(!('scenes/b.scene.json' in out), "j'ai supprime ce fichier, et je l'assume");
});

// ---------- L'ecran ----------

test("l ecran propose les deux versions, et la SIENNE est cochee par defaut", () => {
  const html = conflictScreenHtml(conflicts, mine, head, 'seb@evaveo.com');
  assert.ok(html.includes('seb@evaveo.com'), 'le collegue est nomme, pas « un collegue »');
  conflicts.forEach((p) => assert.ok(html.includes(p), 'chaque fichier en conflit est liste : ' + p));
  // Un seul `checked`, et c'est celui de la version enregistree.
  assert.equal((html.match(/value="theirs" checked/g) || []).length, conflicts.length);
  assert.equal((html.match(/value="mine" checked/g) || []).length, 0,
    'cocher ma version par defaut ferait ecraser son travail au premier clic distrait');
});

test("sans auteur connu, l ecran ne pretend pas en connaitre un", () => {
  const html = conflictScreenHtml(conflicts, mine, head, null);
  assert.ok(html.includes('un collègue'));
});

test('un chemin qui porte du HTML est echappe, pas interprete', () => {
  const mechant = 'scenes/<img src=x onerror=alert(1)>.json';
  const html = conflictScreenHtml([mechant], { [mechant]: f(9) }, {}, '<b>seb</b>');
  assert.ok(!html.includes('<img src=x'), 'le nom de fichier vient du serveur : jamais brut');
  assert.ok(html.includes('&lt;img'));
  assert.ok(!html.includes('<b>seb</b>'), "l e-mail non plus n'est pas du balisage");
});

test('la lecture des choix rend « theirs » pour ce qui n a pas ete touche', () => {
  const faux = {
    querySelectorAll(){
      return [
        { name: 'cft-project.json', value: 'mine', checked: false },
        { name: 'cft-project.json', value: 'theirs', checked: true }
      ];
    }
  };
  assert.deepEqual(readChoices(faux, ['project.json']), { 'project.json': 'theirs' });
});


// ---------- Conversion d'une archive en projet arborescent ----------
// Une archive `.p3d` est un ZIP que seul l'editeur sait lire : la conversion se fait donc chez
// lui — il ouvre l'archive, puis enregistre un arbre. Le piege est que l'enregistrement
// hebergé est un DELTA (project.json + la scene affichee). Applique tel quel a un manifeste
// vide, il ne garderait QU'UNE SEULE SCENE, et les autres disparaitraient sans une erreur :
// le manifeste les listerait, `loadContentScene()` ne trouverait pas leur fichier et rendrait
// `null`, et l'editeur ouvrirait une scene vide.
test('conversion : TOUTES les scenes partent, pas seulement celle affichee', () => {
  const scenes = [
    { name: 'Ville', data: { objects: [1] } },
    { name: 'Menu', data: { objects: [2] } },
    { name: 'Boss', data: { objects: [3] } }
  ];
  // Ce que l'enregistrement ecrit deja de lui-meme : la scene affichee.
  const deja = { 'project.json': '{}', 'scenes/Ville.scene.json': '{}' };

  const ajout = scenesToWrite(scenes, {}, deja);
  assert.deepEqual(Object.keys(ajout).sort(),
    ['scenes/Boss.scene.json', 'scenes/Menu.scene.json'],
    'un manifeste vide = une conversion : aucune scene ne doit rester sans fichier');
  assert.equal(JSON.parse(ajout['scenes/Menu.scene.json']).objects[0], 2);
});

test('projet deja arborescent : le delta reste un delta', () => {
  const scenes = [
    { name: 'Ville', data: { objects: [1] } },
    { name: 'Menu', data: { objects: [2] } }
  ];
  const base = { 'scenes/Ville.scene.json': {}, 'scenes/Menu.scene.json': {} };
  assert.deepEqual(scenesToWrite(scenes, base, { 'scenes/Ville.scene.json': '{}' }), {},
    'reecrire chaque scene a chaque enregistrement annulerait tout l interet du delta');
});

test('une scene AJOUTEE part meme si on enregistre depuis une autre', () => {
  const scenes = [
    { name: 'Ville', data: { objects: [1] } },
    { name: 'Nouvelle', data: { objects: [] } }
  ];
  const base = { 'scenes/Ville.scene.json': {} };
  const ajout = scenesToWrite(scenes, base, { 'scenes/Ville.scene.json': '{}' });
  assert.deepEqual(Object.keys(ajout), ['scenes/Nouvelle.scene.json'],
    'sans cela le manifeste listerait une scene dont le fichier n existe pas');
});

test("une scene JAMAIS chargee n'est pas ecrite vide", () => {
  const scenes = [{ name: 'Ville', data: { objects: [1] } }, { name: 'Jamais ouverte', data: null }];
  assert.deepEqual(scenesToWrite(scenes, {}, {}), {
    'scenes/Ville.scene.json': JSON.stringify({ objects: [1] }, null, 2)
  }, 'ecrire `null` a la place d une scene qu on n a pas lue la detruirait pour de bon');
});
