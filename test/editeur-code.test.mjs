// moteur/test/editeur-code.test.mjs
// Coloration syntaxique : la seule partie PURE de l'éditeur de code (le reste — deux couches
// superposées, défilement synchronisé, indentation — se vérifie à l'œil dans le navigateur).
// Un colorateur à base d'expressions régulières se trompe vite et salement : une chaîne prise
// pour un commentaire, et la moitié du fichier change de couleur. D'où ces tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { creerContexte } from './engine-env.mjs';

function env(){ return creerContexte(['js/code-editor.js']); }
function colorer(e, code, langage){
  return vm.runInContext('ecColorize(' + JSON.stringify(code) + ', '
    + JSON.stringify(langage || 'js') + ')', e);
}

test('le HTML du code est echappe : du code ne peut jamais devenir du balisage', () => {
  const e = env();
  const html = colorer(e, 'if(a < b && c > d){ }');
  assert.ok(html.indexOf('&lt;') !== -1, '< doit etre echappe');
  assert.ok(html.indexOf('&gt;') !== -1, '> doit etre echappe');
  assert.ok(html.indexOf('&amp;') !== -1, '& doit etre echappe');
});

test('une balise ecrite dans une chaine reste du TEXTE, pas du balisage', () => {
  const e = env();
  const html = colorer(e, 'const s = "<img src=x onerror=alert(1)>";');
  assert.ok(html.indexOf('<img') === -1, 'aucune balise img ne doit sortir telle quelle');
  assert.ok(html.indexOf('&lt;img') !== -1);
});

test('un // dans une chaine ne demarre PAS un commentaire', () => {
  const e = env();
  const html = colorer(e, 'const u = "http://exemple.fr"; const x = 1;');
  // `const x` après la chaîne doit rester un mot-clé coloré : s'il avait été avalé par un
  // faux commentaire, il n'y aurait plus qu'une seule occurrence de la classe mot-clé.
  const motsCles = html.split('ec-t-key').length - 1;
  assert.equal(motsCles, 2, 'les deux `const` doivent etre colores');
  assert.ok(html.indexOf('ec-t-com') === -1, 'aucun commentaire ne doit etre detecte');
});

test('une chaine ecrite DANS un commentaire ne coupe pas le commentaire', () => {
  const e = env();
  const html = colorer(e, '// un "guillemet" seul\nconst a = 1;');
  assert.ok(html.indexOf('ec-t-com') !== -1);
  assert.ok(html.indexOf('ec-t-key') !== -1, '`const` de la ligne suivante reste un mot-key');
});

test('un commentaire de bloc couvre plusieurs lignes sans laisser fuir de mot-key', () => {
  const e = env();
  const html = colorer(e, '/* const a\n   return b */\nlet c;');
  assert.equal(html.split('ec-t-key').length - 1, 1, 'seul le `let` hors bloc est colore');
});

test('mots-keys, litteraux, nombres et appels de fonction ont chacun leur classe', () => {
  const e = env();
  const html = colorer(e, 'const n = 12.5; const v = true; maFonction(n);');
  assert.ok(html.indexOf('ec-t-key') !== -1, 'const');
  assert.ok(html.indexOf('ec-t-reads') !== -1, 'true');
  assert.ok(html.indexOf('ec-t-num') !== -1, '12.5');
  assert.ok(html.indexOf('ec-t-fn') !== -1, 'maFonction(');
});

test('un identifiant qui n est pas suivi d une parenthese n est pas pris pour une fonction', () => {
  const e = env();
  const html = colorer(e, 'const total = value;');
  assert.ok(html.indexOf('ec-t-fn') === -1);
});

test('un langage inconnu n est pas colore, mais reste echappe', () => {
  const e = env();
  const html = colorer(e, 'const a = 1; <b>', 'text');
  assert.ok(html.indexOf('ec-t-') === -1, 'aucune coloration');
  assert.ok(html.indexOf('&lt;b&gt;') !== -1, 'echappement quand meme');
});

test('le colorateur restitue le texte a l identique une fois les balises retirees', () => {
  const e = env();
  const source = 'function f(a){\n  // note\n  return "x" + a * 2;\n}\n';
  const html = colorer(e, source);
  const nu = html.replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  assert.equal(nu, source, 'aucun caractere ne doit etre perdu ni ajoute');
});
