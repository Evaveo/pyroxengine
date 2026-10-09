// moteur/test/scoper-css.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte } from './engine-env.mjs';

const env = creerContexte(['js/game-ui.js']);

test('scopeCss : sélecteur simple', () => {
  assert.equal(env.scopeCss('button{color:red}', 'x'), '#x button{color:red}');
});

test('scopeCss : sélecteurs multiples séparés par virgule', () => {
  assert.equal(env.scopeCss('a, b{color:red}', 'x'), '#x a, #x b{color:red}');
});

// CE TEST AFFIRMAIT LE DÉFAUT. Il exigeait « @media laissé tel quel (bloc interne inclus) », ce
// qui revenait à laisser le CSS responsive d'un document s'appliquer à la PAGE ENTIÈRE —
// l'interface de l'éditeur comprise — au lieu de son seul conteneur. Un test vert qui garde un
// bug en place est pire que pas de test : il donne une raison de ne pas regarder. Mesuré sur
// jeux/Chromelo, dont les quatre `@media` retaillent `.game`, `.hud` et les bulles.
test('scopeCss : les règles DANS un @media sont cantonnées elles aussi', () => {
  assert.equal(env.scopeCss('@media (max-width:600px){button{color:blue}}', 'x'),
    '@media (max-width:600px){#x button{color:blue}}');
});

test('scopeCss : @supports et @container se comportent comme @media', () => {
  assert.equal(env.scopeCss('@supports (display:grid){.a{color:red}}', 'x'),
    '@supports (display:grid){#x .a{color:red}}');
  assert.equal(env.scopeCss('@container (min-width:10px){.a{color:red}}', 'x'),
    '@container (min-width:10px){#x .a{color:red}}');
});

test('scopeCss : un @media imbriqué est descendu jusqu\'au bout', () => {
  assert.equal(env.scopeCss('@media screen{@media (min-width:1px){.a{color:red}}}', 'x'),
    '@media screen{@media (min-width:1px){#x .a{color:red}}}');
});

test('scopeCss : @keyframes laissé tel quel — et il DOIT l\'être', () => {
  // `0%` et `from` ne sont pas des sélecteurs : les préfixer donnerait une animation morte.
  const css = '@keyframes k{0%{opacity:0}100%{opacity:1}}';
  assert.equal(env.scopeCss(css, 'x'), css);
});

test('scopeCss : @font-face laissé tel quel', () => {
  const css = '@font-face{font-family:"A";src:url(a.woff2)}';
  assert.equal(env.scopeCss(css, 'x'), css);
});

test('scopeCss : CSS empty', () => {
  assert.equal(env.scopeCss('', 'x'), '');
  assert.equal(env.scopeCss(null, 'x'), '');
});

test('scopeCss : plusieurs règles concaténées', () => {
  const css = 'button{color:red} .title{font-size:20px}';
  assert.equal(env.scopeCss(css, 'x'), '#x button{color:red} #x .title{font-size:20px}');
});

// ---------- At-rules SANS bloc ----------
// `@charset`/`@import`/`@namespace` finissent par un point-virgule, pas par une accolade. Elles
// se retrouvaient collées au sélecteur suivant : le `header` commençait par `@`, et la règle qui
// suivait partait NON CANTONNÉE sur toute la page. Une feuille qui commence par `@charset` — ce
// que produit le portage de jeux/Chromelo — perdait donc sa première règle dans la nature.
test('scopeCss : @charset ne mange pas la règle qui le suit', () => {
  assert.equal(env.scopeCss('@charset "UTF-8";\n.a{color:red}.b{color:blue}', 'x'),
    '@charset "UTF-8";\n#x .a{color:red}#x .b{color:blue}');
});

test('scopeCss : @import non plus', () => {
  assert.equal(env.scopeCss('@import url(a.css);.a{color:red}', 'x'),
    '@import url(a.css);#x .a{color:red}');
});

// ---------- Ce qui est cliquable ----------
// La couche des documents est en `pointer-events:none` pour qu'un HUD ne bloque pas la scène 3D.
// Seule la classe `.ui-button` réactivait les clics : une interface reprise d'un prototype web,
// faite de `<button>` ordinaires, n'était donc CLIQUABLE NULLE PART — sans une erreur, sans un
// avertissement. C'est le défaut le plus cher à l'usage de toute cette série.
test('les éléments interactifs d\'un document sont cliquables, sans classe à connaître', () => {
  const regles = env.baseRulesUIDoc('ui-doc-2');
  for(const balise of ['button', 'input', 'select', 'textarea', 'canvas', 'a[href]']){
    assert.ok(regles.includes('#ui-doc-2 ' + balise),
      balise + ' doit être cliquable sans que l\'auteur ait à le déclarer');
  }
  assert.ok(regles.includes('{pointer-events:auto}'));
});

test('les liaisons du moteur sont cliquables elles aussi', () => {
  const regles = env.baseRulesUIDoc('ui-doc-2');
  assert.ok(regles.includes('#ui-doc-2 [data-event]'));
  assert.ok(regles.includes('#ui-doc-2 [data-bind]'));
});
