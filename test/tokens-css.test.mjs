// UNE SEULE FEUILLE ÉCRIT DES COULEURS.
//
// POURQUOI CE TEST EXISTE. `editor.css` portait un bloc `:root`, et `css/help.css` en avait un
// SECOND avec les mêmes valeurs recopiées plus un `--link` — parce que `help.html` ne charge que
// sa propre feuille. Deux palettes pour un seul produit : elles dérivent, et personne ne le voit
// avant de mettre les deux pages côte à côte.
//
// La garde ne juge pas le goût : elle mesure QUI a le droit d'écrire une couleur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = (f) => fs.readFileSync(path.join(root, 'css', f), 'utf8');
const feuilles = () => fs.readdirSync(path.join(root, 'css')).filter((f) => f.endsWith('.css'));

// Couleurs tolérées hors tokens, chacune avec sa raison.
const TOLEREES = [
  // Un noir ou un blanc PUR à opacité partielle n'est pas une teinte : c'est une ombre ou un
  // voile posé sur ce qui est dessous. Le tokeniser ne dirait rien de plus que « sombre ».
  /^rgba\(0\s*,\s*0\s*,\s*0\s*,/,
  /^rgba\(255\s*,\s*255\s*,\s*255\s*,/
];

function couleursEnDur(src){
  // Les couleurs citées dans un COMMENTAIRE ne peignent rien : elles expliquent souvent
  // pourquoi une valeur a été choisie, et les interdire pousserait à ne plus l'expliquer.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const out = [];
  for(const m of code.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) out.push(m[0]);
  for(const m of code.matchAll(/\b(?:rgb|rgba|hsl|hsla)\([^)]*\)/g)){
    if(!TOLEREES.some((t) => t.test(m[0]))) out.push(m[0]);
  }
  return out;
}

test('seul tokens.css declare des couleurs', () => {
  const fautes = [];
  feuilles().forEach((f) => {
    if(f === 'tokens.css') return;
    couleursEnDur(css(f)).forEach((c) => fautes.push(f + ' : ' + c));
  });
  assert.deepEqual(fautes, [],
    'couleurs ecrites hors de tokens.css :\n' + fautes.join('\n'));
});

test('il n y a qu UN bloc :root dans tout le CSS', () => {
  const total = feuilles().reduce((n, f) => n + (css(f).match(/:root\s*\{/g) || []).length, 0);
  assert.equal(total, 1, 'deux :root, c est deux palettes qui vont deriver');
});

test('les deux pages chargent tokens.css', () => {
  ['editor.html', 'help.html'].forEach((page) => {
    const html = fs.readFileSync(path.join(root, page), 'utf8');
    assert.ok(html.indexOf('css/tokens.css') !== -1, page + ' ne charge pas les tokens');
  });
});

test('les tokens du socle existent — sinon ses etats sont invisibles', () => {
  const t = css('tokens.css');
  ['--invalid', '--mixed', '--focus'].forEach((v) => {
    assert.ok(t.indexOf(v) !== -1, 'token manquant : ' + v);
  });
});

test('les couleurs semantiques par genre d asset sont conservees', () => {
  // Elles portent du SENS (une texture, un modèle, un prefab se reconnaissent à leur couleur
  // dans le panneau Projet), pas de la décoration : elles ne se fondent pas dans l'accent.
  const t = css('tokens.css');
  ['--c-texture', '--c-model', '--c-prefab'].forEach((v) => assert.ok(t.indexOf(v) !== -1, v));
});

// ---------- Le contraste ----------
//
// La spec demande le niveau AA (4,5:1) pour le texte. Le texte ATTÉNUÉ est celui qui manque : il
// sert aux libellés, aux aides et aux valeurs secondaires, c'est-à-dire à ce qu'on lit vraiment.

function luminance(hex){
  const v = hex.replace('#', '');
  const n = (i) => {
    const c = parseInt(v.slice(i * 2, i * 2 + 2), 16) / 255;
    return (c <= 0.03928) ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * n(0) + 0.7152 * n(1) + 0.0722 * n(2);
}
function contraste(a, b){
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
function token(nom){
  const m = css('tokens.css').match(new RegExp('\\' + nom + '\\s*:\\s*(#[0-9a-fA-F]{6})'));
  assert.ok(m, 'token introuvable : ' + nom);
  return m[1];
}

test('le texte atteint le niveau AA sur les surfaces ou il est pose', () => {
  ['--bg', '--panel', '--panel2'].forEach(function(surface){
    assert.ok(contraste(token('--txt'), token(surface)) >= 4.5,
      '--txt sur ' + surface + ' : ' + contraste(token('--txt'), token(surface)).toFixed(2));
  });
});

test('le texte ATTENUE aussi — c est celui qu on lit le plus', () => {
  ['--bg', '--panel', '--panel2'].forEach(function(surface){
    const r = contraste(token('--txt-dim'), token(surface));
    assert.ok(r >= 4.5, '--txt-dim sur ' + surface + ' : ' + r.toFixed(2)
      + ' — les libelles et les aides sont ecrits avec');
  });
});
