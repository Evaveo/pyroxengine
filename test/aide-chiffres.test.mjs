import { HELP_SCRIPTS, readHelpSource } from './help-env.mjs';
import { deEsm } from './engine-env.mjs';
// LES CHIFFRES DE L'AIDE QU'AUCUNE ANCRE NE PEUT TENIR.
//
// test/aide.test.mjs adosse chaque page à des bouts de code exacts. C'est efficace pour
// « la gravité 2D vaut −25 », qui se lit dans une ligne. Ça ne peut RIEN faire pour « le
// build passe de 23 balises à 11 » : ce number ne s'écrit nulle part, il se COMPTE sur le
// HTML engendré et sur la taille des fichiers.
//
// C'est exactement là que l'aide s'est trompée. Les vrais chiffres étaient 26 et 15, et
// « 178 Ko retirés d'un jeu 3D » venait d'une scène particulière présentée comme une
// propriété du moteur — donc invérifiable, donc infalsifiable. Ce fichier les RECALCULE :
// il appelle pageIndexBuild() pour de vrai, pèse les modules sur le disque, et confronte le
// résultat au texte que le lecteur a sous les yeux.
//
// DEUX RÉGIMES, ET LA DISTINCTION EST LE FOND DU FICHIER. Un COMPTE (26 balises, 17 modules)
// est structurel : il ne bouge que si quelqu'un ajoute ou retire une entrée, donc on l'exige
// à l'unité. Un POIDS en octets bouge à chaque ligne écrite : l'exiger à l'octet rendrait ce
// test rouge en permanence, et un test rouge en permanence finit désactivé — ce qui coûte
// plus cher que pas de test. On lui laisse donc 5 %, largement sous les 12 à 13 % d'écart
// qu'avaient atteints les chiffres périmés.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { buildModules } from './build-modules.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const weight = (f) => statSync(path.join(root, f)).size;

// ---------- Le moteur de build, dans un bac ----------
function moteurBuild(){
  const bac = {console, Math, JSON, Object, Array, Set, Map, String, Number, RegExp, Error,
               TextDecoder: class { decode(){ return ''; } }, atob: () => '',
               escapeHtml: (s) => String(s)};
  bac.window = bac; bac.globalThis = bac;
  const ctx = vm.createContext(bac);
  vm.runInContext(deEsm(read('js/build-trimming.js')), ctx, {filename: 'build-trimming.js'});
  vm.runInContext(deEsm(read('js/build.js')), ctx, {filename: 'build.js'});
  vm.runInContext('this.trimmingBuild = trimmingBuild; this.pageIndexBuild = pageIndexBuild;'
    + ' this.MODULES_OPTIONAL = MODULES_OPTIONAL;', ctx);
  return bac;
}

// ---------- Le texte que le lecteur voit ----------
function texteAide(){
  const faireElement = () => ({value:'', innerHTML:'', dataset:{}, addEventListener(){},
                               closest(){ return null; }, querySelectorAll(){ return []; }});
  const byId = new Map();
  const bac = {console, Math, JSON, Object, Array, Map, Set, String, Number, RegExp, Error,
               decodeURIComponent, location:{hash:''}, addEventListener(){}, scrollTo(){},
               document:{
                 getElementById(id){ if(!byId.has(id)) byId.set(id, faireElement()); return byId.get(id); },
                 createElement(){ const el = faireElement();
                   Object.defineProperty(el, 'textContent',
                     {get(){ return String(el.innerHTML).replace(/<[^>]*>/g, ' '); }});
                   return el; },
                 addEventListener(){}, title:''
               }};
  bac.window = bac; bac.globalThis = bac;
  const ctx = vm.createContext(bac);
  HELP_SCRIPTS
    .forEach((f) => vm.runInContext(deEsm(read(f)), ctx, {filename: f}));
  vm.runInContext('this.PAGES_HELP = PAGES_HELP; this.TAGS_BUILD_FULL = TAGS_BUILD_FULL;', ctx);
  const pages = Array.from(bac.PAGES_HELP);
  return {
    balisesDeclarees: bac.TAGS_BUILD_FULL,
    // Sans les balises : c'est le texte lu, pas le source. Les entités et le balisage
    // couperaient un number en deux et feraient échouer le test pour une raison fausse.
    text: pages.map((p) => p.html()).join('\n').replace(/<[^>]*>/g, ''),
    page: (id) => pages.find((p) => p.id === id).html().replace(/<[^>]*>/g, '')
  };
}

const compteBalises = (html) => (html.match(/<script/g) || []).length;

// Une scène de platformer 2D, réduite à ce que l'allègement regarde.
const SCENE_2D = {scenes: [{data: {objects: [
  {name: 'ground', sprite2d: {}, components: [{type: 'Tilemap', data: {}}]},
  {name: 'heros', sprite2d: {}, animSprite: {}, phys2d: {}, collider2d: {}, controller2d: {}},
  {name: 'cam', components: [{type: 'Camera', data: {projection: 'orthographic'}}]}
], scripts: []}}], assets: []};

/** L'écart relatif entre le chiffre annoncé et le chiffre pesé. */
function gap(annonce, reel){ return Math.abs(annonce - reel) / reel; }
const TOLERANCE = 0.05;


test('LE COMPTE DE BALISES du build complet est celui de la page engendrée', () => {
  const engine = moteurBuild();
  const help = texteAide();
  const reel = compteBalises(engine.pageIndexBuild('Jeu', [], null));

  assert.ok(reel > 0, 'pageIndexBuild() n\'a engendré aucune balise — le bac est cassé');
  assert.equal(help.balisesDeclarees, reel,
    `l'aide annonce ${help.balisesDeclarees} balises de script pour un build complet, il y en a ${reel}`);
  // Et le chiffre doit VRAIMENT apparaître dans la page : une constante juste que le texte
  // n'utilise pas laisserait le lecteur devant l'ancien number, écrit en dur à côté.
  assert.ok(help.page('project').includes(String(reel)),
    `la page « project » ne montre pas le chiffre ${reel}`);

  // build-test/index.html est l'image OCTET POUR OCTET du même appel : si les deux ne
  // comptent pas pareil, c'est le miroir du harnais qui a décroché, pas l'aide.
  assert.equal(compteBalises(read('build-test/index.html')), reel,
    'build-test/index.html ne porte plus le même number de balises que pageIndexBuild()');
});

test('LE COMPTE DE BALISES d\'un platformer 2D est celui que l\'aide annonce', () => {
  const engine = moteurBuild();
  const help = texteAide();
  const reel = compteBalises(engine.pageIndexBuild('Jeu', [], engine.trimmingBuild(SCENE_2D)));

  assert.ok(reel < compteBalises(engine.pageIndexBuild('Jeu', [], null)),
    'un jeu 2D devrait porter MOINS de balises qu\'un build complet — l\'allègement ne filtre plus rien');
  assert.ok(new RegExp('descend à ' + reel + ' balises').test(help.page('project')),
    `la page « project » n'annonce pas « descend à ${reel} balises »`);
});

test('LE PLAFOND RETIRABLE — 17 modules, et leur poids — est celui du disque', () => {
  const engine = moteurBuild();
  const help = texteAide();
  const modules = Array.from(engine.MODULES_OPTIONAL);

  // Le COMPTE, à l'unité : add un module facultatif sans le dire déshape la promesse.
  const nb = (help.page('project').match(/(\d+) modules? en sont retirables/) || [])[1];
  assert.ok(nb, 'la page « project » n\'annonce plus un number de modules retirables');
  assert.equal(Number(nb), modules.length,
    `l'aide annonce ${nb} modules facultatifs, MODULES_OPTIONAL en déclare ${modules.length}`);

  // Le POIDS, à 5 % : c'est la somme des fichiers, elle bouge à chaque ligne écrite.
  const bytes = modules.reduce((s, m) => s + weight(m.file), 0);
  const ko = (help.page('project').match(/(\d+) Ko\b[^.]*plafond|(\d+) Ko en tout/) || []).filter(Boolean);
  const annonce = Number((help.page('project').match(/(\d+) Ko en tout/) || [])[1]);
  assert.ok(annonce, 'la page « project » n\'annonce plus le poids total retirable');
  assert.ok(gap(annonce * 1000, bytes) < TOLERANCE,
    `l'aide annonce ${annonce} Ko retirables au plafond, le disque en pèse ${bytes} octets `
    + `(${Math.round(bytes / 1000)} Ko)`);
});

test('CE QU UN PLATFORMER 2D RETIRE vraiment, en octets', () => {
  const engine = moteurBuild();
  const help = texteAide();
  const retires = Array.from(engine.trimmingBuild(SCENE_2D).retires);
  const bytes = retires.reduce((s, r) => s + weight(r.file), 0);

  assert.ok(retires.length, 'l\'allègement ne retire rien d\'un platformer 2D — le calcul est cassé');
  const annonce = Number((help.page('project').match(/en atteint (\d+) Ko/) || [])[1]);
  assert.ok(annonce, 'la page « project » n\'annonce plus ce qu\'un jeu 2D retire');
  assert.ok(gap(annonce * 1000, bytes) < TOLERANCE,
    `l'aide annonce ${annonce} Ko pour un jeu 2D, la mesure donne ${bytes} octets`);

  // ET LE SOLVEUR 2D N'EN FAIT PAS PARTIE. Sans ce contrôle, un allègement qui retirerait
  // tout donnerait un poids « conforme » et un jeu qui ne démarre pas.
  const names = retires.map((r) => r.file);
  ['js/physics-2d.js', 'js/tilemap.js', 'js/camera-framing.js', 'js/sprite-2d.js'].forEach((f) => {
    assert.ok(!names.includes(f), `${f} a été retiré d'un jeu 2D qui en a besoin`);
  });
});

test('LA PART NON RETIRABLE — three.js et le rendu WebGPU — est celle qu on pèse', () => {
  const help = texteAide();
  // La liste des sources d'un build, lue dans js/build.js : la recopier ici la ferait
  // dériver, et c'est précisément le défaut que ce fichier corrige.
  const files = buildModules().map((m) => m.src);
  assert.ok(files.length >= 20, `seulement ${files.length} sources lues — extraction cassée`);

  const total = files.reduce((s, f) => s + weight(f), 0);
  const render = files.filter((f) => /three/.test(f)).reduce((s, f) => s + weight(f), 0);
  const part = Math.round(100 * render / total);

  const annonceMo = Number((help.page('project').match(/(\d+,\d+) Mo de code/) || [])[1]
    ? (help.page('project').match(/(\d+),(\d+) Mo de code/).slice(1, 3).join('.')) : 0);
  assert.ok(annonceMo, 'la page « project » n\'annonce plus le poids du code d\'un build');
  assert.ok(gap(annonceMo * 1e6, total) < TOLERANCE,
    `l'aide annonce ${annonceMo} Mo de code, la mesure donne ${total} octets`);

  const annoncePart = Number((help.page('project').match(/(\d+) % du code/) || [])[1]);
  assert.ok(annoncePart, 'la page « project » n\'annonce plus la part non retirable');
  assert.ok(Math.abs(annoncePart - part) <= 2,
    `l'aide annonce ${annoncePart} % pour three.js et WebGPU, la mesure donne ${part} %`);
});

test('LE NOMBRE DE commandes affiché est CALCULE, pas recopié', () => {
  // Le texte disait « les 34 commandes » quand il y en avait 47. Un count en toutes
  // lettres est le seul chiffre qu'aucune ancre ne peut tenir : on exige donc qu'il soit
  // engendré depuis la table, et le test le vérifie en lisant le SOURCE de la page.
  const src = readHelpSource();
  assert.ok(src.includes('COMMANDS_HELP.length'),
    'le compte de commandes de la page « copilot » n\'est plus calculé depuis la table');
  const enDur = src.match(/les \d+ commandes/);
  assert.equal(enDur, null, 'un compte de commandes écrit en dur est revenu : ' + (enDur && enDur[0]));
});
