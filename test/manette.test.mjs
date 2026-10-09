// LA MANETTE, ET LES QUATRE FAÇONS DONT ELLE PEUT CASSER EN SILENCE.
//
// Aucune ne lève d'erreur, et aucune ne se voit sur une machine de développement où la manette
// est branchée et neuve :
//
//  1. LA ZONE MORTE. Un stick au repos ne rend jamais zéro — il flotte entre 0,05 et 0,15 selon
//     l'usure. Sans zone morte, le personnage dérive tout seul, et le joueur accuse le jeu.
//     Avec une zone morte SANS réétalement, la valeur saute de 0 à 0,18 dès qu'on bouge : la
//     visée devient inutilisable, et personne ne saura dire pourquoi.
//
//  2. LE DÉBRANCHEMENT. Si l'on retire la manette pendant que le stick est poussé, l'état
//     resterait figé : le personnage court pour toujours. C'est le genre de panne qu'on met une
//     heure à relier à sa cause.
//
//  3. LES LIAISONS PAR DÉFAUT. Elles pointent des indices de boutons. Un indice faux ne lève
//     rien : le bouton ne fait simplement rien, et l'on croit que la manette n'est pas gérée.
//
//  4. LA DIVERGENCE ÉDITEUR / JEU PUBLIÉ. Le runtime porte SA propre table d'entrées de repli.
//     Si elle ne suit pas celle de l'éditeur, le jeu répond à la manette dans l'éditeur et plus
//     une fois publié — la famille de défauts la plus coûteuse de ce dépôt.
//
// Rien ici ne demande de matériel : `navigator.getGamepads` est remplacé par une fonction qui
// rend ce qu'on veut. C'est ce qui rend la manette testable du tout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { creerContexte } from './engine-env.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const lire = (f) => readFileSync(path.join(root, f), 'utf8');

const env = creerContexte(['js/gamepad-input.js', 'js/touch-input.js']);

/** Une manette factice : boutons enfoncés par indice, axes par indice. */
function manette(boutons, axes){
  return {
    connected: true, mapping: 'standard',
    buttons: Array.from({length: 16}, (_, i) => ({
      pressed: (boutons || []).indexOf(i) !== -1,
      value: (boutons || []).indexOf(i) !== -1 ? 1 : 0
    })),
    axes: axes || [0, 0, 0, 0]
  };
}

/** Branche zéro, une ou plusieurs manettes factices. */
function brancher(...pads){
  env.navigator = { getGamepads: () => pads };
}

const TABLE = {
  actions: {jump: [' ', 'pad:0'], interact: ['e', 'pad:2']},
  axes: {horizontal: ['left', 'right', 'pad:axis0'], vertical: ['back', 'advance', 'pad:axis1-']}
};

// ---------- 1. La zone morte ----------

test('un stick au repos ne bouge RIEN', () => {
  // 0,12 est une derive banale sur une manette usee. Sans zone morte, le personnage avance
  // tout seul et le joueur pense que le jeu est casse.
  assert.equal(env.applyDeadZone(0.12, 0.18), 0);
  assert.equal(env.applyDeadZone(-0.12, 0.18), 0);
  assert.equal(env.applyDeadZone(0, 0.18), 0);
});

test('la zone morte REETALE, elle ne tronque pas', () => {
  // LE PIEGE : retirer la zone morte sans reetaler fait sauter la valeur de 0 a 0,18 des qu'on
  // quitte le repos. Une visee au stick devient inutilisable, et ca ne ressemble pas a un bug.
  const juste = env.applyDeadZone(0.19, 0.18);
  assert.ok(juste > 0 && juste < 0.03,
    'juste au-dela du seuil, la valeur doit partir de presque zero (recu ' + juste + ')');
  assert.ok(Math.abs(env.applyDeadZone(1, 0.18) - 1) < 1e-9,
    'a fond, le stick doit rendre exactement 1 : sinon le personnage n atteint jamais sa vitesse max');
  assert.ok(Math.abs(env.applyDeadZone(-1, 0.18) + 1) < 1e-9);
});

test('la courbe est MONOTONE, sans marche', () => {
  let prec = 0;
  for(let v = 0; v <= 1.0001; v += 0.05){
    const y = env.applyDeadZone(v, 0.18);
    assert.ok(y >= prec - 1e-9, 'la courbe redescend a ' + v.toFixed(2));
    assert.ok(y - prec < 0.12, 'marche de ' + (y - prec).toFixed(3) + ' a ' + v.toFixed(2));
    prec = y;
  }
});

// ---------- 2. Les boutons sont des touches ----------

test('un bouton enfonce pose SA touche dans le meme jeu que le clavier', () => {
  // C'EST TOUT LE CHOIX DE CONCEPTION. Si cette ligne tombe, il a fallu ecrire une resolution
  // d'action pour la manette — donc une seconde, qui divergera de la premiere.
  const keys = new Set([' ']);
  brancher(manette([0, 2]));
  env.pollGamepads(keys, TABLE);
  assert.ok(keys.has('pad:0'), 'le bouton A doit poser pad:0');
  assert.ok(keys.has('pad:2'), 'le bouton X doit poser pad:2');
  assert.ok(keys.has(' '), 'et ne doit pas effacer les touches du clavier');
  assert.equal(keys.has('pad:1'), false, 'un bouton non enfonce ne doit rien poser');
});

test('un bouton relache retire sa touche', () => {
  const keys = new Set();
  brancher(manette([0]));
  env.pollGamepads(keys, TABLE);
  assert.ok(keys.has('pad:0'));
  brancher(manette([]));
  env.pollGamepads(keys, TABLE);
  assert.equal(keys.has('pad:0'), false, 'le bouton reste enfonce apres son relachement');
});

test('DEBRANCHER la manette efface ce qu elle avait pose', () => {
  // Le personnage court pour toujours, et rien ne relie la cause a l effet.
  const keys = new Set(['e']);
  brancher(manette([0, 12]));
  env.pollGamepads(keys, TABLE);
  assert.equal(keys.size, 3);
  brancher();   // plus rien de branche
  env.pollGamepads(keys, TABLE);
  assert.equal(keys.has('pad:0'), false, 'une manette debranchee laisse son bouton enfonce');
  assert.equal(keys.has('pad:12'), false);
  assert.ok(keys.has('e'), 'et elle ne doit pas emporter les touches du clavier avec elle');
  assert.equal(env.gamepadAxis('horizontal'), 0, 'ni laisser un axe pousse');
});

test('une gachette analogique compte comme un bouton passe son seuil', () => {
  // Une gachette rend une valeur continue et ne dit jamais `pressed` sur certaines manettes :
  // sans le seuil, LT et RT ne font rien du tout.
  const pad = manette([]);
  pad.buttons[6] = {pressed: false, value: 0.8};
  pad.buttons[7] = {pressed: false, value: 0.1};
  brancher(pad);
  const keys = new Set();
  env.pollGamepads(keys, TABLE);
  assert.ok(keys.has('pad:6'), 'une gachette a 0,8 doit compter comme enfoncee');
  assert.equal(keys.has('pad:7'), false, 'une gachette a 0,1 est un repos, pas une pression');
});

// ---------- 3. Les axes ----------

test('une source d axe se lit, inversion comprise', () => {
  assert.deepEqual(Array.from([env.parseAxisSource('pad:axis0')].map((s) => s && s.index)), [0]);
  assert.equal(env.parseAxisSource('pad:axis1-').sign, -1,
    'le suffixe « - » inverse l axe : l axe Y d une manette est positif vers le BAS');
  assert.equal(env.parseAxisSource('pad:axis1').sign, 1);
  assert.equal(env.parseAxisSource('e'), null, 'une touche ordinaire n est pas une source d axe');
  assert.equal(env.parseAxisSource(undefined), null, 'la troisieme case est facultative');
});

test('le stick alimente l axe nomme, et l axe Y est bien inverse', () => {
  brancher(manette([], [0.9, -0.9, 0, 0]));
  env.pollGamepads(new Set(), TABLE);
  assert.ok(env.gamepadAxis('horizontal') > 0.8, 'stick a droite = horizontal positif');
  assert.ok(env.gamepadAxis('vertical') > 0.8,
    'stick vers le HAUT (valeur negative cote manette) doit donner un vertical POSITIF — sans '
    + 'inversion, le personnage recule quand on pousse en avant');
});

test('un axe SANS troisieme case reste au clavier', () => {
  brancher(manette([], [0.9, 0.9, 0, 0]));
  env.pollGamepads(new Set(), {actions: {}, axes: {horizontal: ['left', 'right']}});
  assert.equal(env.gamepadAxis('horizontal'), 0,
    'un axe que le projet n a pas branche sur un stick ne doit pas bouger tout seul');
});

test('combineAxis laisse gagner la source la plus franche', () => {
  // LE SEUL ENDROIT OU LES SOURCES SE MELANGENT. Le clavier doit rester utilisable pendant
  // qu un stick use flotte, et le stick doit primer des qu on le pousse vraiment.
  brancher(manette([], [0.9, 0, 0, 0]));
  env.pollGamepads(new Set(), TABLE);
  assert.ok(env.combineAxis(0, 'horizontal') > 0.8, 'le stick doit piloter quand le clavier se tait');
  assert.equal(env.combineAxis(-1, 'horizontal'), -1,
    'une touche franche doit primer sur un stick a 0,88 — sinon on ne peut plus jouer au '
    + 'clavier des qu une manette est branchee');
});

// ---------- 4. Les liaisons par défaut, des DEUX côtés ----------

test('les liaisons par defaut pointent des boutons qui existent', () => {
  // `INPUTS_DEFAULT` et `GAMEPAD_BUTTONS` sont des `const` top-niveau : ils vivent dans la
  // portee lexicale du contexte, jamais parmi les proprietes de l'objet global. On les lit
  // donc DEDANS.
  const inputs = vm.runInContext('INPUTS_DEFAULT', creerContexte(['js/scripts.js']));
  const max = vm.runInContext('GAMEPAD_BUTTONS', env).length;
  Object.keys(inputs.actions).forEach((nom) => {
    inputs.actions[nom].filter((k) => String(k).indexOf('pad:') === 0).forEach((k) => {
      const i = Number(String(k).slice(4));
      assert.ok(Number.isInteger(i) && i >= 0 && i < max,
        'l action « ' + nom + ' » est liee a « ' + k + ' », qui n est pas un bouton standard');
    });
  });
});

test('LE JEU PUBLIE a les MEMES liaisons par defaut que l editeur', () => {
  // LA DIVERGENCE QU'ON FERME : js/game-runtime.js porte sa propre table de repli, pour les
  // projets enregistres avant que la table d entrees existe. Si elle ne suit pas, le jeu
  // repond a la manette dans l editeur et plus une fois publie — et ca ne se voit qu a l export.
  const runtime = lire('js/game-runtime.js');
  const editeur = lire('js/scripts.js');
  ['pad:12', 'pad:13', 'pad:14', 'pad:15', 'pad:0', 'pad:2',
   'pad:axis0', 'pad:axis1-'].forEach((liaison) => {
    assert.ok(editeur.includes("'" + liaison + "'"),
      'js/scripts.js ne lie plus « ' + liaison +' »');
    assert.ok(runtime.includes("'" + liaison + "'"),
      'js/game-runtime.js ne lie plus « ' + liaison + ' » : le jeu publie ne repondra pas '
      + 'comme l editeur, et ca ne se verra qu apres l export');
  });
});

test('les DEUX moteurs lisent la manette a chaque image', () => {
  // Un module charge mais jamais appele est du code mort — et ce depot en a deja eu un, le
  // regroupement en instances, qui a dormi des mois dans l editeur.
  [['js/viewport.js', 'l editeur'], ['js/game-runtime.js', 'le jeu publie']].forEach(([f, qui]) => {
    const src = lire(f).split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    assert.ok(/pollGamepads\s*\(/.test(src),
      qui + ' (' + f + ') n appelle plus pollGamepads : la manette est branchee et ne fait rien');
  });
});

test('le module part dans les builds', () => {
  const build = lire('js/build.js');
  assert.ok(build.includes("{src: 'js/gamepad-input.js'}"),
    'js/gamepad-input.js manque a la liste des modules embarques : la manette marchera dans '
    + 'l apercu et pas dans le jeu exporte');
  assert.ok(build.includes('src="gamepad-input.js"'),
    'js/gamepad-input.js manque aux balises de la page engendree');
});

// ---------- 5. Ce que le matériel refuse ----------

test('sans API de manette, tout se tait au lieu de lever', () => {
  // Un vieux navigateur, ou une page sans geste utilisateur : `getGamepads` peut manquer ou
  // lever. Le jeu doit continuer au clavier, pas tomber.
  env.navigator = {};
  assert.equal(env.pollGamepads(new Set(), TABLE), 0);
  env.navigator = { getGamepads(){ throw new Error('refus du navigateur'); } };
  assert.equal(env.pollGamepads(new Set(), TABLE), 0);
  assert.equal(env.gamepadAxis('horizontal'), 0);
});

test('la vibration rend false quand le materiel ne sait pas vibrer', () => {
  brancher(manette([]));
  assert.equal(env.rumble(1, 200), false,
    'une manette sans moteur de vibration doit le DIRE : un jeu qui croit avoir vibre donne un '
    + 'retour que le joueur ne recevra jamais');
  const pad = manette([]);
  let recu = null;
  pad.vibrationActuator = { playEffect(type, opts){ recu = {type, opts}; } };
  brancher(pad);
  assert.equal(env.rumble(0.5, 300), true);
  assert.equal(recu.type, 'dual-rumble');
  assert.equal(recu.opts.duration, 300);
  assert.equal(recu.opts.strongMagnitude, 0.5);
});
