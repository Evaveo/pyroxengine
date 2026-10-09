import { deEsm } from './engine-env.mjs';
// UNE PALETTE HORS ÉCRAN EST UNE PALETTE PERDUE.
//
// POURQUOI CE TEST EXISTE. Mémoriser une position est facile ; la RELIRE est le piège. La
// position enregistrée reste « valide » — c'est un couple de nombres — alors que le viewport,
// lui, a changé : fenêtre réduite, écran différent, panneau ouvert en grand, dock retaillé.
// La palette se repose alors à 900px de la gauche d'un viewport qui en fait 400, et il
// n'existe aucun geste pour la ramener : elle est hors du cadre, donc sa poignée aussi.
// Rien ne lève, rien ne se journalise. L'outil a simplement disparu.
//
// `clampPosition` est écrite pure exactement pour être mesurée ici, sans DOM ni navigateur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const lire = (p) => deEsm(fs.readFileSync(path.join(root, p), 'utf8'));

// Le module est un script classique posé sur globalThis — même chargement que icones.test.mjs.
function charger(){
  return new Function(lire('js/ui/floating-palette.js') + '; return FloatingPalette;')();
}

const PALETTE = {width: 200, height: 80};
const HOST = {width: 1000, height: 600};

test('une position deja bonne n est pas touchee', () => {
  const P = charger();
  assert.deepEqual(P.clampPosition({x: 300, y: 200}, PALETTE, HOST), {x: 300, y: 200});
});

test('une position ENREGISTREE hors du viewport revient dans le cadre', () => {
  const P = charger();
  // Le cas réel : la fenêtre était large, elle ne l'est plus.
  const c = P.clampPosition({x: 900, y: 560}, PALETTE, {width: 400, height: 300});
  assert.ok(c.x + PALETTE.width <= 400, 'depasse a droite : ' + JSON.stringify(c));
  assert.ok(c.y + PALETTE.height <= 300, 'depasse en bas : ' + JSON.stringify(c));
});

test('elle ne se colle jamais au bord — la poignee doit rester visable', () => {
  const P = charger();
  const c = P.clampPosition({x: -500, y: -500}, PALETTE, HOST);
  assert.deepEqual(c, {x: P.MARGIN, y: P.MARGIN});
  const d = P.clampPosition({x: 99999, y: 99999}, PALETTE, HOST);
  assert.equal(d.x, HOST.width - PALETTE.width - P.MARGIN);
  assert.equal(d.y, HOST.height - PALETTE.height - P.MARGIN);
});

test('un viewport PLUS PETIT que la palette la cale en haut a gauche', () => {
  const P = charger();
  // Aucune position ne la contient. Le coin haut-gauche est celui où le contenu commence,
  // donc celui qu'on veut voir — pas un `max` négatif qui la sortirait par l'autre bord.
  const c = P.clampPosition({x: 40, y: 40}, PALETTE, {width: 100, height: 40});
  assert.deepEqual(c, {x: P.MARGIN, y: P.MARGIN});
});

test('une position ILLISIBLE ne fait pas disparaitre la palette', () => {
  const P = charger();
  [undefined, null, {}, {x: NaN, y: 10}, {x: '12', y: null}].forEach((brut) => {
    const c = P.clampPosition(brut, PALETTE, HOST);
    assert.ok(Number.isFinite(c.x) && Number.isFinite(c.y),
      'position non finie pour ' + JSON.stringify(brut) + ' : ' + JSON.stringify(c));
    assert.ok(c.x >= P.MARGIN && c.y >= P.MARGIN);
  });
});

test('la relecture des preferences tolere tout ce que le stockage peut rendre', () => {
  const P = charger();
  const prefs = (v) => ({get: () => v});
  // Jamais réglée, écrite par une version anterieure, ou JSON abime : trois cas, un seul
  // comportement — le coin haut-gauche, ou la palette est visible.
  [null, undefined, 'nimporte', 42, {}, {x: 'a', y: 'b'}].forEach((v) => {
    assert.deepEqual(P.storedPosition(prefs(v)), {x: P.MARGIN, y: P.MARGIN},
      'valeur stockee mal toleree : ' + JSON.stringify(v));
  });
  assert.deepEqual(P.storedPosition(prefs({x: 120, y: 40})), {x: 120, y: 40});
  // Sans Prefs du tout (fenetre flottante, page secondaire) : pas d'exception.
  assert.deepEqual(P.storedPosition(null), {x: P.MARGIN, y: P.MARGIN});
});

// ---------- Le cablage ----------

test('la position est une PREFERENCE declaree, pas une cle localStorage nue', () => {
  const P = charger();
  const prefs = lire('js/ui/prefs.js');
  assert.ok(prefs.indexOf("key: '" + P.PREF_KEY + "'") !== -1,
    P.PREF_KEY + ' n est pas declaree : elle n aurait ni defaut ni place dans l import');
  // Le module n'ecrit QUE par Prefs : une ecriture directe echapperait a la cle unique et au
  // rechargement inter-onglets (l ecouteur `storage` de prefs.js).
  const src = lire('js/ui/floating-palette.js');
  assert.ok(src.indexOf('localStorage') === -1,
    'floating-palette.js ecrit dans localStorage au lieu de passer par Prefs');
});

test('la palette ADOPTE #bar — elle ne le reconstruit pas', () => {
  // C'est ce qui garantit que le gizmo continue de fonctionner : js/scene.js:255-256 pose ses
  // ecouteurs sur des ids ecrits dans editor.html. Reconstruire les boutons ici les perdrait.
  const src = lire('js/ui/floating-palette.js');
  assert.match(src, /getElementById\('bar'\)/);
  assert.match(src, /appendChild\(bar\)/);
  // Sans les commentaires : l'en-tete du module CITE ces ids, justement pour dire qu'il n'y
  // touche pas. Interdire de les nommer pousserait a retirer l'explication.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  ['g-translate', 'g-rotate', 'g-scale', 'g-space'].forEach((id) => {
    assert.ok(code.indexOf(id) === -1,
      'floating-palette.js manipule ' + id + ' : il devrait ignorer le contenu de #bar');
    assert.ok(lire('editor.html').indexOf('id="' + id + '"') !== -1,
      id + ' a disparu de editor.html');
  });
});

test('boot est REENTRANTE — le demarrage de l editeur ne l est pas', () => {
  // Les plugins tournent en dernier (startup.js) et peuvent rebooter des morceaux d interface.
  // Une seconde palette empilee sur la premiere serait invisible et intercepterait les clics.
  const src = lire('js/ui/floating-palette.js');
  const corps = src.slice(src.indexOf('function boot()'));
  assert.match(corps.slice(0, 120), /if\(root\) return root;/,
    'boot() doit sortir si la palette existe deja');
});

test('elle est bootee APRES le dock, sinon elle se borne contre un viewport sans taille', () => {
  const src = lire('js/startup.js');
  const iDock = src.indexOf('bootDock()');
  const iPalette = src.indexOf('FloatingPalette.boot()');
  assert.ok(iDock !== -1 && iPalette !== -1, 'appel manquant dans startup.js');
  assert.ok(iPalette > iDock, 'la palette est bootee avant le dock');
});

test('rien d autre ne se pose dans le coin ou la palette apparait', () => {
  // LA COLLISION MESUREE : `#filters` etait en `top:12px;left:12px`, exactement la position de
  // depart de la palette — les deux se superposaient au premier lancement. Le conflit a ete
  // reglé a la racine : les filtres d'affichage sont ENTRES dans la palette, donc plus aucune
  // surface flottante ne revendique ce coin. Le test garde le resultat, pas le contournement.
  const css = lire('css/widgets.css').replace(/\/\*[\s\S]*?\*\//g, ' ');
  const fautes = [];
  for(const regle of css.matchAll(/([^{}]+)\{([^}]*)\}/g)){
    const corps = regle[2];
    if(!/position:absolute/.test(corps)) continue;
    // Un element flottant ancre en haut a gauche, a moins de 40px des deux bords, retombe
    // sous la palette. `#tool-palette` est evidemment exclu : c'est elle.
    const top = (corps.match(/top:(\d+)px/) || [])[1];
    const left = (corps.match(/left:(\d+)px/) || [])[1];
    const selecteur = regle[1].trim();
    if(selecteur.indexOf('#tool-palette') !== -1) continue;
    // Seules les SURFACES DU VIEWPORT comptent, et elles sont toutes designees par un id
    // (#filters, #banner-cam, #status, #view-gizmo). `.tile .kind` est un badge positionne
    // dans sa vignette, a l'autre bout de l'interface : son `top:2px;left:2px` ne dit rien
    // de l'endroit ou la palette se pose.
    if(selecteur.charAt(0) !== '#') continue;
    if(top !== undefined && left !== undefined && +top < 40 && +left < 40){
      fautes.push(selecteur);
    }
  }
  assert.deepEqual(fautes, [],
    'ces surfaces se posent sous la palette d outils :\n' + fautes.join('\n'));
});
