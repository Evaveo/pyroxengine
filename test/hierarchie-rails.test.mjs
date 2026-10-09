// L'ARBRE EST UNE LISTE PLATE, ET ÇA SE PAIE EN CSS.
//
// `updateHierarchy` aplatit la récursion en HTML : un nœud profond n'est PAS imbriqué dans son
// parent. Deux conséquences que ce test garde, parce qu'aucune des deux ne se voit autrement
// qu'en ouvrant l'éditeur — ce que le harnais ne fait pas (pas de moteur de rendu).
//
//  1. Les rails d'indentation ne peuvent pas être des `border-left` hérités : ils sont un
//     dégradé répété dont la largeur vient de `--depth`. Une règle d'état qui écrirait
//     `background:` au lieu de `background-color:` effacerait ce dégradé — et le rail
//     disparaîtrait précisément sur la ligne survolée et sur la ligne sélectionnée, les deux
//     qu'on regarde.
//  2. Le chevron et l'œil sont maintenant des icônes Phosphor, donc le clic atterrit sur le
//     `<i>` INTÉRIEUR au `<span class="fold">`. Tester `e.target.classList` au lieu de
//     `closest()` fait tomber le clic dans la branche « sélectionner » : l'arbre cesse de se
//     plier et l'œil de masquer, sans qu'aucune erreur ne soit levée.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const lire = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const sansCommentaires = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/[^\n]*/gm, ' ');

test('la profondeur est portee au CSS, pas ecrite en pixels dans le markup', () => {
  const js = sansCommentaires(lire('js/hierarchy.js'));
  assert.match(js, /--depth:'\s*\+\s*prof/,
    'la profondeur doit voyager en variable CSS : c est elle qui dessine les rails');
  assert.doesNotMatch(js, /padding-left:'\s*\+/,
    'une indentation calculee en JS ne peut plus etre changee par la densite');
});

test('AUCUNE regle d etat de .node n efface le degrade des rails', () => {
  const css = sansCommentaires(lire('css/panels.css'));
  const fautes = [];
  // Toute règle dont le sélecteur porte `.node` et qui écrit le RACCOURCI `background:`.
  for(const regle of css.matchAll(/([^{}]*\.node[^{}]*)\{([^}]*)\}/g)){
    const selecteur = regle[1].trim();
    // `.node input` et `.node-count` sont des éléments INTÉRIEURS : ils n'ont pas de rail à
    // effacer, et leur imposer background-color n'aurait aucun sens.
    if(/\.node\s+input|\.node-count|\.node-name/.test(selecteur)) continue;
    if(/(^|[;{\s])background\s*:/.test(regle[2])) fautes.push(selecteur);
  }
  assert.deepEqual(fautes, [],
    'ces regles effacent background-image, donc les rails :\n' + fautes.join('\n'));
});

test('le rail se dessine sur la LARGEUR de l indentation, et pas au-dela', () => {
  const css = sansCommentaires(lire('css/panels.css'));
  const bloc = css.slice(css.indexOf('.node{'), css.indexOf('.node:hover'));
  assert.match(bloc, /background-size:calc\(var\(--depth, ?0\)/,
    'sans background-size lie a --depth, le degrade couvre toute la ligne');
  assert.match(bloc, /background-repeat:no-repeat/,
    'sans no-repeat, le motif se repete sous le nom de l objet');
});

test('les clics du chevron et de l oeil remontent depuis l ICONE', () => {
  const js = sansCommentaires(lire('js/hierarchy.js'));
  assert.doesNotMatch(js, /e\.target\.classList\.contains\('fold'\)/,
    'la cible du clic est le <i>, pas le <span> : il faut closest()');
  assert.doesNotMatch(js, /e\.target\.classList\.contains\('eye'\)/,
    'la cible du clic est le <i>, pas le <span> : il faut closest()');
  assert.match(js, /closest\('\.fold'\)/);
  assert.match(js, /closest\('\.eye'\)/);
});

// ---------- Le compte d un groupe replie ----------

test('le compte est RECURSIF — un groupe replie cache aussi les petits-enfants', () => {
  const js = lire('js/hierarchy.js');
  const corps = js.slice(js.indexOf('function countSceneChildren'));
  assert.match(corps.slice(0, 400), /countSceneChildren\(child\)/,
    'un compte non recursif annoncerait 3 sur un groupe qui en contient trente');
  assert.match(corps.slice(0, 400), /isSceneObject\(child\)/,
    'sans ce filtre, le compte inclut les aides de l editeur et ne correspond a rien');
});

test('le compte n apparait QUE sur un groupe replie qui a des enfants', () => {
  const js = sansCommentaires(lire('js/hierarchy.js'));
  assert.match(js, /plie\s*&&\s*aEnfants/,
    'affiche sur une feuille, le compte vaudrait toujours zero ; affiche deplie, il ferait '
    + 'doublon avec ce qu on voit');
});

// ---------- Les icones de type ----------

test('AUCUN composant ne rend encore un emoji comme icone', () => {
  const fautes = [];
  const dir = path.join(root, 'js', 'components');
  fs.readdirSync(dir).filter((f) => f.endsWith('.js')).forEach((f) => {
    const src = sansCommentaires(lire('js/components/' + f));
    for(const m of src.matchAll(/icon\(\)\s*\{[^}]*\}|get icon\(\)\s*\{[^}]*\}/g)){
      // Un emoji tient sur un point de code hors du plan latin : c'est le signe qu'on est
      // reste sur un glyphe systeme, dont la largeur et la ligne de base varient d'une
      // machine a l'autre — et qui ignore currentColor, donc l'accent et l'etat desactive.
      if(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u.test(m[0])){
        fautes.push(f + ' : ' + m[0].replace(/\s+/g, ' ').trim());
      }
    }
  });
  assert.deepEqual(fautes, [], 'icones encore en emoji :\n' + fautes.join('\n'));
});

test('le repli de iconOf reste TOLERANT quand Icons n est pas charge', () => {
  // js/hierarchy-icon.js est evalue seul par d autres tests. Un appel nu a Icons y ferait
  // tomber tout l arbre pour un nœud sans composant — c est-a-dire pour un simple groupe.
  const src = lire('js/hierarchy-icon.js');
  assert.match(src, /typeof Icons !== 'undefined'/,
    'iconOf doit survivre a l absence de Icons');
});
