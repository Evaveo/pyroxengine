import { deEsm } from './engine-env.mjs';
// Une machine à états rate en SILENCE, et c'est ce qui la rend dangereuse pour sa cible : un
// infographiste voit un personnage figé, sans erreur, sans console, sans rien à quoi se
// raccrocher. Les quatre façons de se figer :
//
//  · un déclencheur qui n'est jamais consommé — le saut se relance à chaque image, éternellement ;
//  · deux transitions applicables au même instant et un ordre non déterminé — ça marche un jour
//    sur deux, selon des détails qui n'ont rien à voir ;
//  · un cycle A→B→A résolu DANS une seule image — le programme se fige, sans message ;
//  · une faute de frappe dans un nom de paramètre — la condition n'est jamais vraie.
//
// Ce fichier tient les quatre, plus la porte du lot : une machine écrite à la main fait passer
// un personnage d'Idle à Marche quand un paramètre change, sans la moindre interface.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const racineMoteur = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(racineMoteur, f), 'utf8');

// Aucun bouchon, aucun three, aucun DOM : ce module est PUR, et c'est exactement ce qui le
// rend éprouvable ici alors que rien de ce qui touche au mixeur ne l'est.
function contexte(){
  const bac = {console, Math, JSON, Set, Map, WeakMap, Array, Object};
  bac.window = bac; bac.self = bac; bac.globalThis = bac;
  const ctx = vm.createContext(bac);
  vm.runInContext(deEsm(read('js/animator.js')), ctx, {filename:'js/animator.js'});
  return ctx;
}

// La machine du commentaire d'en-tête, mot pour mot. Si le format change, ce montage casse —
// c'est voulu : le format est ce que le lot A fige, et un exemple de documentation qui ne
// tourne plus est un exemple faux.
const MACHINE = {
  format:'animator', version:1,
  params: [
    {name:'speed', type:'float', defaultValue:0},
    {name:'saute',   type:'trigger'}
  ],
  states: [
    {name:'Idle',   clip:'idle',   loop:true},
    {name:'Marche', clip:'marche', loop:true},
    {name:'Saut',   clip:'jump',   loop:false}
  ],
  start: 'Idle',
  transitions: [
    {de:'Idle',   vers:'Marche', duration:0.2, conditions:[{param:'speed', operateur:'>', value:0.1}]},
    {de:'Marche', vers:'Idle',   duration:0.2, conditions:[{param:'speed', operateur:'<=', value:0.1}]},
    {de:'*',      vers:'Saut',   duration:0.1, conditions:[{param:'saute', operateur:'declenche'}]},
    {de:'Saut',   vers:'Idle',   duration:0.2, awaitEnd:true, conditions:[]}
  ]
};

// --- LA PORTE DU LOT ------------------------------------------------------------------------

test('PORTE : un fichier ecrit a la main fait passer Idle → Marche quand le parametre change', () => {
  const ctx = contexte();
  const l = ctx.createPlayerAnimator(MACHINE);
  assert.equal(l.state, 'Idle', 'la machine doit démarrer sur son état de départ');

  // Rien ne bouge tant que le paramètre ne bouge pas — sinon le test ne prouverait rien.
  ctx.updatePlayerAnimator(MACHINE, l, 0.016, 0);
  assert.equal(l.state, 'Idle');

  ctx.setParamAnimator(l, 'speed', 0.5);
  const t = ctx.updatePlayerAnimator(MACHINE, l, 0.016, 0);
  assert.equal(l.state, 'Marche', 'le changement de paramètre n’a pas déclenché la transition');
  assert.equal(t.duration, 0.2, 'la durée de fondu doit remonter à l’appelant, c’est lui qui enchaîne');
  assert.equal(ctx.clipOfLState(MACHINE, l.state), 'marche',
    'l’état doit dire quel clip play — c’est tout ce que l’appelant a besoin de savoir');

  // Et le retour, pour prouver que ce n'est pas un aller simple.
  ctx.setParamAnimator(l, 'speed', 0);
  ctx.updatePlayerAnimator(MACHINE, l, 0.016, 0);
  assert.equal(l.state, 'Idle');
});

// --- les quatre pièges ---------------------------------------------------------------------

test('un declencheur est CONSOMME par la transition qui s en sert', () => {
  const ctx = contexte();
  const l = ctx.createPlayerAnimator(MACHINE);
  ctx.armTriggerAnimator(l, 'saute');
  ctx.updatePlayerAnimator(MACHINE, l, 0.016, 0);
  assert.equal(l.state, 'Saut');
  // LE piège : sans consommation, le déclencheur reste armé et la transition « depuis partout »
  // repart à chaque image. Le personnage saute éternellement, sans erreur.
  assert.equal(l.params.saute, false, 'le déclencheur est resté armé après avoir servi');
  // La preuve par le comportement : une fois le saut fini, on repart bien vers Idle et pas
  // vers Saut.
  ctx.updatePlayerAnimator(MACHINE, l, 0.016, 1);
  assert.equal(l.state, 'Idle', 'le saut s’est relancé au lieu de rendre la main');
});

test('l ORDRE de declaration decide quand deux transitions conviennent', () => {
  const ctx = contexte();
  const machine = {
    states:[{name:'A', clip:'a'}, {name:'B', clip:'b'}, {name:'C', clip:'c'}],
    start:'A', params:[{name:'x', type:'float', defaultValue:5}],
    transitions:[
      {de:'A', vers:'B', conditions:[{param:'x', operateur:'>', value:1}]},
      {de:'A', vers:'C', conditions:[{param:'x', operateur:'>', value:2}]}
    ]
  };
  const l = ctx.createPlayerAnimator(machine);
  ctx.updatePlayerAnimator(machine, l, 0.016, 0);
  // Les deux conditions sont vraies. Sans règle d'ordre, le résultat dépendrait de détails
  // d'implémentation : ça marcherait un jour sur deux, et l'éditeur ne pourrait rien promettre.
  assert.equal(l.state, 'B', 'la première transition déclarée doit l’emporter');
});

test('UNE SEULE transition par image, meme quand un cycle est possible', () => {
  const ctx = contexte();
  const machine = {
    states:[{name:'A', clip:'a'}, {name:'B', clip:'b'}],
    start:'A', params:[],
    transitions:[{de:'A', vers:'B', conditions:[]}, {de:'B', vers:'A', conditions:[]}]
  };
  const l = ctx.createPlayerAnimator(machine);
  // Enchaîner tant qu'une transition s'applique ferait tourner A→B→A→B… à l'infini DANS une
  // seule image : le programme se fige, sans erreur et sans rien à l'écran. Le test se termine,
  // et c'est en soi ce qu'il vérifie.
  ctx.updatePlayerAnimator(machine, l, 0.016, 0);
  assert.equal(l.state, 'B');
  ctx.updatePlayerAnimator(machine, l, 0.016, 0);
  assert.equal(l.state, 'A', 'une image, un changement d’état');
});

test('un parametre INCONNU rend la condition fausse, et ne plante pas', () => {
  const ctx = contexte();
  const machine = {
    states:[{name:'A', clip:'a'}, {name:'B', clip:'b'}], start:'A',
    params:[{name:'speed', type:'float', defaultValue:9}],
    transitions:[{de:'A', vers:'B', conditions:[{param:'vitese', operateur:'>', value:1}]}]
  };
  const l = ctx.createPlayerAnimator(machine);
  ctx.updatePlayerAnimator(machine, l, 0.016, 0);
  // Une faute de frappe ne doit ni tout bloquer par une exception, ni ouvrir la transition
  // « au cas où ». Elle ne se déclenche pas — et `validateAnimator` la nomme (test plus bas).
  assert.equal(l.state, 'A', 'une condition sur un paramètre inexistant s’est déclenchée');
});

test('un parametre inconnu compare avec != ou == ne declenche PAS', () => {
  const ctx = contexte();
  // LE cas qui distingue une vraie garde d'un accident. Avec `>`, un paramètre absent vaut
  // `undefined` et `undefined > 1` est faux : ça marche sans garde, par chance. Avec `!=`,
  // `undefined !== 1` est VRAI — la transition partirait sur une faute de frappe, et le
  // personnage changerait d'état sans qu'aucune condition écrite ne soit remplie.
  const machine = {
    states:[{name:'A', clip:'a'}, {name:'B', clip:'b'}], start:'A',
    params:[{name:'speed', type:'float', defaultValue:0}],
    transitions:[{de:'A', vers:'B', conditions:[{param:'vitese', operateur:'!=', value:1}]}]
  };
  const l = ctx.createPlayerAnimator(machine);
  ctx.updatePlayerAnimator(machine, l, 0.016, 0);
  assert.equal(l.state, 'A', 'un « != » sur un paramètre inexistant a déclenché la transition');
  assert.equal(ctx.conditionMet({param:'absent', operateur:'=='}, {}), false);
});

test('un declencheur ne compte comme arme que s il vaut VRAI, pas « verite-ish »', () => {
  const ctx = contexte();
  const l = ctx.createPlayerAnimator(MACHINE);
  // `setParamAnimator` accepte n'importe quelle valeur : rien n'empêche d'écrire 1 dans
  // un déclencheur, par confusion avec un booléen. Une comparaison molle le prendrait pour
  // armé et lancerait le saut — un état changé par une valeur que personne n'a voulue.
  ctx.setParamAnimator(l, 'saute', 1);
  ctx.updatePlayerAnimator(MACHINE, l, 0.016, 0);
  assert.equal(l.state, 'Idle', 'un déclencheur à 1 (et non true) a été pris pour armé');
  ctx.armTriggerAnimator(l, 'saute');
  ctx.updatePlayerAnimator(MACHINE, l, 0.016, 0);
  assert.equal(l.state, 'Saut', 'armer pour de bon doit, lui, fonctionner');
});

// --- attendre la end du clip ------------------------------------------------------------

test('« attendre la end » retient la transition tant que le clip n est pas fini', () => {
  const ctx = contexte();
  const l = ctx.createPlayerAnimator(MACHINE);
  ctx.armTriggerAnimator(l, 'saute');
  ctx.updatePlayerAnimator(MACHINE, l, 0.016, 0);
  assert.equal(l.state, 'Saut');
  // À mi-clip, on reste. C'est ce qui rend une animation one-shot utilisable : sans cela, le
  // saut rendrait la main à la première image et ne se verrait jamais.
  ctx.updatePlayerAnimator(MACHINE, l, 0.016, 0.5);
  assert.equal(l.state, 'Saut', 'la transition est partie avant la end du clip');
  ctx.updatePlayerAnimator(MACHINE, l, 0.016, 1);
  assert.equal(l.state, 'Idle');
});

test('« depuis partout » ne loop pas sur l etat ou l on est deja', () => {
  const ctx = contexte();
  const l = ctx.createPlayerAnimator(MACHINE);
  ctx.armTriggerAnimator(l, 'saute');
  ctx.updatePlayerAnimator(MACHINE, l, 0.016, 0);
  assert.equal(l.state, 'Saut');
  ctx.armTriggerAnimator(l, 'saute');
  const t = ctx.updatePlayerAnimator(MACHINE, l, 0.016, 0);
  // Une transition `*` → Saut prise DEPUIS Saut relancerait le clip depuis le début à chaque
  // image tant que le déclencheur est armé : le personnage resterait sur la première pose,
  // ce qui se lit comme un modèle cassé et pas comme une machine mal câblée.
  assert.equal(t, null, 'la transition « depuis partout » s’est appliquée à son propre état');
});

// --- valeurs par défaut ------------------------------------------------------------------

test('un declencheur part toujours desarme, quel que soit son defaut declare', () => {
  const ctx = contexte();
  const p = ctx.paramsByDefault({params:[
    {name:'saute', type:'trigger', defaultValue:true},
    {name:'speed', type:'float', defaultValue:2},
    {name:'assis', type:'bool'}
  ]});
  // Un déclencheur armé au chargement ferait sauter le personnage dès l'apparition de la scène.
  assert.equal(p.saute, false, 'un déclencheur ne doit jamais naître armé');
  assert.equal(p.speed, 2, 'la valeur par défaut d’un flottant doit être respectée');
  assert.equal(p.assis, false, 'un booléen sans défaut vaut faux');
});

test('poser un parametre inexistant ECHOUE au lieu d en creer un fantome', () => {
  const ctx = contexte();
  const l = ctx.createPlayerAnimator(MACHINE);
  // Créer le paramètre en silence donnerait un réglage qui ne pilote rien, et l'utilisateur
  // chercherait du côté des transitions. On rend false : l'appelant peut le dire.
  assert.equal(ctx.setParamAnimator(l, 'vitese', 1), false);
  assert.equal('vitese' in l.params, false);
  assert.equal(ctx.setParamAnimator(l, 'speed', 1), true);
});

// --- validation ---------------------------------------------------------------------------

test('la machine de reference est VALIDE (sinon les tests ci-dessus ne prouvent rien)', () => {
  const ctx = contexte();
  const p = ctx.validateAnimator(MACHINE, ['idle', 'marche', 'jump']);
  assert.deepEqual(Array.from(p), [], 'problèmes signalés à tort :\n' + p.join('\n'));
});

test('la validation NOMME ce qui cloche, en clair', () => {
  const ctx = contexte();
  const p = ctx.validateAnimator({
    states:[{name:'A', clip:'absent'}, {name:'A', clip:'a'}, {name:'B'}],
    start:'Z',
    params:[{name:'x', type:'bizarre'}],
    transitions:[{de:'A', vers:'Inconnu', conditions:[{param:'y', operateur:'~'}]}]
  }, ['a']);
  const joint = p.join(' | ');
  // Chaque message doit désigner CE QU'IL FAUT CORRIGER. « Machine invalide » n'aide personne,
  // et c'est précisément l'utilisateur qui ne code pas qui n'a aucun autre medium de savoir.
  assert.match(joint, /« absent », qui n'existe pas sur ce modèle/, joint);
  assert.match(joint, /Deux états s'appellent « A »/, joint);
  // « aucune animation » et non « aucun clip » depuis la v0.52 : un état peut désigner soit un
  // asset d'animation, soit — en repli — un nom de clip. Aucun des deux, c'est ce cas-ci.
  assert.match(joint, /L'état « B » ne joue aucune animation/, joint);
  assert.match(joint, /départ « Z » n'existe pas/, joint);
  assert.match(joint, /type inconnu/, joint);
  assert.match(joint, /mène à « Inconnu »/, joint);
  assert.match(joint, /teste « y »/, joint);
  assert.match(joint, /opérateur inconnu/, joint);
});

test('la validation signale un etat SANS SORTIE — la premiere cause de « ca reste bloque »', () => {
  const ctx = contexte();
  const p = ctx.validateAnimator({
    states:[{name:'A', clip:'a'}, {name:'Cul-de-sac', clip:'b'}], start:'A', params:[],
    transitions:[{de:'A', vers:'Cul-de-sac', conditions:[]}]
  }, ['a', 'b']);
  assert.ok(p.some((x) => /« Cul-de-sac » n'a aucune transition sortante/.test(x)),
    'un état sans sortie doit être signalé : ' + p.join(' | '));
  // Mais ce n'est pas une erreur bloquante — un état final est légitime. A, lui, a une sortie.
  assert.equal(p.some((x) => /« A » n'a aucune transition/.test(x)), false);
});

test('une transition « depuis partout » donne une sortie a TOUS les etats', () => {
  const ctx = contexte();
  const p = ctx.validateAnimator({
    states:[{name:'A', clip:'a'}, {name:'B', clip:'b'}], start:'A', params:[],
    transitions:[{de:'*', vers:'B', conditions:[]}]
  }, ['a', 'b']);
  // A n'a aucune transition nommée, mais le `*` en fournit une : le signaler serait un faux
  // positif, et un avertissement qui crie à tort finit ignoré — y compris quand il a raison.
  assert.equal(p.some((x) => /« A » n'a aucune transition sortante/.test(x)), false,
    'faux positif : ' + p.join(' | '));
  assert.ok(p.some((x) => /« B » n'a aucune transition sortante/.test(x)),
    'B n’est atteint que par le `*`, qui ne compte pas comme sa propre output');
});

// --- la ligne que saisit l'utilisateur --------------------------------------------------

test('« speed = 1 » se lit en name + number', () => {
  const ctx = contexte();
  const r = ctx.readSettingParam('speed = 1');
  assert.equal(r.name, 'speed');
  assert.equal(r.value, 1);
  // Les espaces sont ceux d'un humain qui tape, pas une faute à sanctionner.
  assert.equal(ctx.readSettingParam('  speed=2.5  ').value, 2.5);
});

test('« vrai » et « faux » sont lus AVANT les nombres', () => {
  const ctx = contexte();
  // `Number('true')` vaut NaN. Sans ce passage-là en premier, le paramètre recevrait un NaN,
  // toutes ses comparaisons deviendraient fausses, et rien à l'écran ne le dirait.
  assert.equal(ctx.readSettingParam('assis = vrai').value, true);
  assert.equal(ctx.readSettingParam('assis = FAUX').value, false);
  assert.equal(ctx.readSettingParam('assis = true').value, true);
});

test('un nom SEUL arme un declencheur', () => {
  const ctx = contexte();
  const r = ctx.readSettingParam('saute');
  // C'est la shape la plus courte et la plus fréquente : « quand on appuie sur Espace →
  // régler le paramètre : saute ». Exiger « saute = vrai » serait un piège à faute de frappe.
  assert.equal(r.name, 'saute');
  assert.equal(r.value, true);
  assert.equal(r.trigger, true);
});

test('un texte qui n est pas un number RESTE du texte', () => {
  const ctx = contexte();
  // Comparer une chaîne avec `==` est un usage légitime (« arme == epee »). La convertir en
  // NaN casserait la condition sans un mot.
  assert.equal(ctx.readSettingParam('arme = epee').value, 'epee');
});

test('une ligne vide ou sans nom ne regle RIEN', () => {
  const ctx = contexte();
  assert.equal(ctx.readSettingParam(''), null);
  assert.equal(ctx.readSettingParam('   '), null);
  assert.equal(ctx.readSettingParam(null), null);
  // « = 1 » : l'utilisateur a effacé le nom. Régler un paramètre sans nom créerait une entrée
  // fantôme que rien ne lit.
  assert.equal(ctx.readSettingParam(' = 1'), null);
});

// --- les conditions ecrites a la main -------------------------------------------------------
//
// SUPPRIMÉ en v0.55.0, avec `lireCondition` / `ecrireCondition`. Les conditions s'éditaient
// dans une zone de texte, à la syntaxe « speed > 0.1 » : il fallait la connaître, rien ne
// disait quels paramètres existaient, et une faute de frappe donnait une transition qui ne
// part jamais. Elles s'éditent maintenant en LIGNES à listes déroulantes (le panneau de
// transition d'Unity), où l'on ne peut nommer qu'un paramètre déclaré et où les opérateurs
// proposés sont ceux que son type autorise — `OPERATORS_BY_TYPE`, éprouvé ailleurs.
//
// Ces six tests couvraient l'analyseur de texte. Il n'a plus d'appelant, et un analyseur sans
// appelant qu'on continue d'éprouver donne l'illusion d'une fonctionnalité qui n'existe plus.

// --- root motion ---------------------------------------------------------------------------

// Une marche qui avance de 2 m par cycle d'une seconde, en Z. `lire(t)` rend la position du
// bassin — c'est exactement ce que la piste de position du clip contient.
const marcheAvance = (t) => [0, 100, 2 * t];

test('la racine avance de ce que le clip parcourt entre deux instants', () => {
  const ctx = contexte();
  const d = ctx.moveRoot(marcheAvance, 0.2, 0.5, 1, true);
  assert.ok(Math.abs(d.z - 0.6) < 1e-9, 'z = ' + d.z + ' au lieu de 0,6');
  assert.equal(d.x, 0);
  assert.equal(d.y, 0, 'la hauteur ne bouge pas sur une marche à plat');
});

test('A LA BOUCLE, le personnage n est PAS catapulte en arriere', () => {
  const ctx = contexte();
  // De 0,9 s à 0,1 s : le clip a rebouclé. Le bassin est passé de z=1,8 à z=0,2, soit une
  // différence brute de −1,6 — le personnage reculerait de presque tout un cycle en UNE image.
  // Le vrai parcours est 0,2 (end du cycle) + 0,2 (début du suivant) = 0,4.
  const d = ctx.moveRoot(marcheAvance, 0.9, 0.1, 1, true);
  assert.ok(d.z > 0, 'déplacement négatif à la boucle : z = ' + d.z + ' — le personnage recule');
  assert.ok(Math.abs(d.z - 0.4) < 1e-9, 'z = ' + d.z + ' au lieu de 0,4');
});

test('un retour en arriere SANS loop ne deplace rien', () => {
  const ctx = contexte();
  // On a ramené la tête de lecture au début, ou l'action s'est arrêtée. Rien n'a été PARCOURU :
  // téléporter l'object là-dessus serait absurde.
  const d = ctx.moveRoot(marcheAvance, 0.9, 0.1, 1, false);
  assert.deepEqual([d.x, d.y, d.z], [0, 0, 0]);
});

test('un clip qui ne bouge pas ne fait pas advance', () => {
  const ctx = contexte();
  const surPlace = () => [0, 100, 0];
  const d = ctx.moveRoot(surPlace, 0.1, 0.9, 1, true);
  assert.deepEqual([d.x, d.y, d.z], [0, 0, 0]);
});

test('l os racine est celui qui porte la piste de POSITION', () => {
  const ctx = contexte();
  // Mesuré sur un export Mixamo : 53 tracks, dont une seule de position. C'est elle qui porte
  // tout le déplacement.
  const clip = {tracks:[
    {name:'mixamorigSpine.quaternion'},
    {name:'mixamorigHips.position'},
    {name:'mixamorigHips.quaternion'}
  ]};
  assert.equal(ctx.boneRootOfClip(clip), 'mixamorigHips');
  // Un clip sans piste de position ne peut pas porter de racine motion : le dire par `null`
  // vaut mieux que de deviner un os et de déplacer le personnage au hasard.
  assert.equal(ctx.boneRootOfClip({tracks:[{name:'a.quaternion'}]}), null);
  assert.equal(ctx.boneRootOfClip(null), null);
});

test('un os racine dont le nom contient un point est lu en entier', () => {
  const ctx = contexte();
  // `mixamo.com` est un nom de clip réel ; rien n'interdit un os nommé avec un point. Couper
  // au PREMIER point donnerait « armature » au lieu de « armature.001 », et la recherche de
  // l'os échouerait — root motion silencieusement morte.
  assert.equal(ctx.boneRootOfClip({tracks:[{name:'armature.001.position'}]}), 'armature.001');
});

test('un fichier vide ou illisible se dit, il ne plante pas', () => {
  const ctx = contexte();
  assert.equal(ctx.validateAnimator(null).length, 1);
  assert.match(ctx.validateAnimator(null)[0], /vide ou illisible/);
  assert.equal(ctx.createPlayerAnimator(null).state, null);
  assert.equal(ctx.updatePlayerAnimator(null, ctx.createPlayerAnimator(null), 0.016, 0), null);
});

test('moveTransition échange deux transitions adjacentes dans le tableau', () => {
  const ctx = contexte();
  const m = { transitions: [{de:'A',vers:'B'}, {de:'B',vers:'C'}, {de:'C',vers:'A'}] };
  ctx.moveTransition(m, 1, -1);
  assert.deepEqual(m.transitions.map(t => t.vers), ['C', 'B', 'A']);
});

test('moveTransition ne fait rien en butée (index 0 vers le haut, dernier vers le bas)', () => {
  const ctx = contexte();
  const m = { transitions: [{de:'A',vers:'B'}, {de:'B',vers:'C'}] };
  ctx.moveTransition(m, 0, -1);
  assert.deepEqual(m.transitions.map(t => t.vers), ['B', 'C']);
  ctx.moveTransition(m, 1, 1);
  assert.deepEqual(m.transitions.map(t => t.vers), ['B', 'C']);
});
