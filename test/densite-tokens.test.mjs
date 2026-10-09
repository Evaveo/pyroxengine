// UN TOKEN QUE PERSONNE NE LIT EST UN RÉGLAGE QUI NE FAIT RIEN.
//
// LA BRÈCHE MESURÉE (v0.108.0). `tokens.css` déclarait `--sp-1..5`, `--r-1..3`, `--font`,
// `--fs` et `--lh` depuis leur création. Aucune feuille n'en lisait UN SEUL : les paddings,
// les rayons et la police étaient écrits en dur. Conséquence invisible — `html[data-density]`
// ne surcharge que ces variables-là, donc la préférence « compacte / confortable » de
// prefs.js posait bien son attribut sur <html> et l'interface ne bougeait pas d'un pixel.
// Rien ne levait, rien ne s'affichait dans la console : l'utilisateur changeait le réglage,
// regardait, et concluait que la densité normale était déjà compacte.
//
// Ce test mesure la seule chose qui compte ici : est-ce que quelqu'un LIT ce qui est déclaré.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const cssDir = path.join(root, 'css');
const lire = (f) => fs.readFileSync(path.join(cssDir, f), 'utf8');
const feuilles = () => fs.readdirSync(cssDir).filter((f) => f.endsWith('.css'));

// Tout le CSS du produit, commentaires ôtés : un `var(--x)` cité dans un commentaire
// n'applique rien, et le compter suffirait à faire passer le test sans rien corriger.
function toutLeCss(){
  return feuilles().map(lire).join('\n').replace(/\/\*[\s\S]*?\*\//g, ' ');
}

function estLu(nom){
  return toutLeCss().indexOf('var(' + nom + ')') !== -1;
}

test('CHAQUE variable surchargee par la densite est lue quelque part', () => {
  const src = lire('tokens.css');
  const fautes = [];
  // Les blocs `html[data-density="..."]` : ce qu'ils redéfinissent est, par construction, ce
  // par quoi la préférence agit. Une variable qui n'y sert à rien la rend inerte.
  for(const bloc of src.matchAll(/html\[data-density="([^"]+)"\]\s*\{([^}]*)\}/g)){
    for(const decl of bloc[2].matchAll(/(--[a-z0-9-]+)\s*:/g)){
      if(!estLu(decl[1])) fautes.push(bloc[1] + ' -> ' + decl[1]);
    }
  }
  assert.deepEqual(fautes, [], 'surcharges de densite que rien ne lit — le reglage ne fera '
    + 'RIEN pour elles :\n' + fautes.join('\n'));
});

test('l echelle d espacement et celle des rayons sont employees', () => {
  const fautes = [];
  ['--sp-1', '--sp-2', '--sp-3', '--sp-4', '--sp-5',
   '--r-1', '--r-2', '--r-3', '--r-4'].forEach((nom) => {
    if(!estLu(nom)) fautes.push(nom);
  });
  assert.deepEqual(fautes, [], 'declarees et jamais lues : ' + fautes.join(', '));
});

test('la typographie de base vient des tokens, pas de valeurs ecrites dans base.css', () => {
  const base = lire('base.css').replace(/\/\*[\s\S]*?\*\//g, ' ');
  assert.match(base, /font-family:\s*var\(--font\)/,
    'base.css ecrit une police en dur : --font ne pourra plus rien changer');
  assert.match(base, /font-size:\s*var\(--fs\)/,
    'base.css ecrit une taille en dur : la densite ne touchera pas le texte');
});

// ---------- Les etats interactifs ----------

test('l anneau de focus clavier est pose GLOBALEMENT, pas panneau par panneau', () => {
  const etats = lire('states.css').replace(/\/\*[\s\S]*?\*\//g, ' ');
  // Un sélecteur `:focus-visible` NU (sans rien devant) : c'est ce qui couvre les éléments
  // auxquels personne n'a pensé. `.field input:focus-visible` ne couvre que .field.
  assert.match(etats, /(^|[{}\s]):focus-visible\s*\{[^}]*outline\s*:/,
    'sans regle globale, le navigateur peint son anneau bleu sur une interface sans bleu');
});

test('les etats sont atteignables par l AIDE, qui ne peut pas charger base.css', () => {
  // help.html est une page de LECTURE : base.css y verrouillerait `overflow:hidden`. Si les
  // états retournaient dans base.css, l'aide perdrait son anneau de focus et ses barres de
  // défilement thémées sans que rien ne le signale — c'est arrivé à la palette avant les
  // tokens, recopiée dans help.css puis divergente.
  ['editor.html', 'help.html', 'external-editor.html'].forEach((page) => {
    const html = fs.readFileSync(path.join(root, page), 'utf8');
    assert.ok(html.indexOf('css/states.css') !== -1, page + ' ne charge pas css/states.css');
  });
});

test('aucune regle n eteint le focus sans en reposer un', () => {
  const fautes = [];
  feuilles().forEach((f) => {
    const src = lire(f);
    const sansCom = src.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
    for(const regle of sansCom.matchAll(/([^{}]+)\{([^}]*)\}/g)){
      const corps = regle[2];
      if(!/outline\s*:\s*none/.test(corps)) continue;
      const selecteur = regle[1].trim();
      if(!/:focus/.test(selecteur)) continue;
      // Éteindre l'anneau est légitime quand la règle en dessine un autre (bordure, ombre).
      if(/box-shadow|border-color|border\s*:/.test(corps)) continue;
      // Ou quand le remplacement est posé sur le CONTENEUR, via `:focus-within` — c'est le cas
      // d'un champ sans fond ni bordure propres (une puce d'axe) : un anneau autour de lui
      // flotterait au milieu de la boîte, donc c'est la boîte qui prend l'accent. On cherche
      // alors une règle `:focus-within` portant la MÊME première classe, dans la même feuille.
      const base = (selecteur.match(/\.[a-z0-9-]+/i) || [])[0];
      const conteneur = base
        && new RegExp('\\' + base + '[^{,]*:focus-within[^{]*\\{[^}]*(border-color|outline|box-shadow)')
          .test(sansCom);
      if(conteneur) continue;
      fautes.push(f + ' : ' + selecteur);
    }
  });
  assert.deepEqual(fautes, [],
    'focus eteint sans remplacement — la navigation au clavier devient invisible :\n'
    + fautes.join('\n'));
});

test('les barres de defilement sont thémées — sinon elles restent claires sur du sombre', () => {
  const etats = lire('states.css');
  assert.match(etats, /::-webkit-scrollbar-thumb\s*\{[^}]*var\(--/);
  assert.match(etats, /scrollbar-color\s*:\s*var\(--/);
});
