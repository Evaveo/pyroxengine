// moteur/test/animator-api.test.mjs
//
// L'object rendu par `api.animator()`. Il est fabriqué dans js/animator.js — partagé entre
// l'éditeur et le jeu publié — précisément pour qu'un script pousse la MÊME machine des deux
// côtés. Ce qui compte ici : qu'une faute de frappe se voie, que `params` ne soit pas une porte
// dérobée vers le lecteur, et que `replay` remette vraiment tout à zéro.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte } from './engine-env.mjs';

const env = creerContexte(['js/animator.js']);
const { createPlayerAnimator, createObjectAnimator } = env;

const MACHINE = {
  params: [{name:'speed', type:'float', defaultValue:0},
               {name:'arme', type:'int', defaultValue:0},
               {name:'atGround', type:'bool', defaultValue:true},
               {name:'saute', type:'trigger'}],
  states: [{name:'Idle'}, {name:'Marche'}],
  start: 'Idle',
  transitions: [{de:'Idle', vers:'Marche', duration:0.2,
                 conditions:[{param:'speed', operateur:'>', value:0.1}]}]
};

function monter(){
  const avertis = [];
  const player = createPlayerAnimator(MACHINE);
  const an = createObjectAnimator(player, MACHINE, function(name){ avertis.push(name); });
  return {player, an, avertis};
}

test('les quatre poseurs écrivent le bon type dans le lecteur', () => {
  const {player, an} = monter();
  an.setFloat('speed', '2.5');
  an.setInt('arme', 2.7);
  an.setBool('atGround', 0);
  an.setTrigger('saute');
  assert.equal(player.params.speed, 2.5, 'une chaîne chiffrée est convertie');
  assert.equal(player.params.arme, 3, 'un entier est arrondi, pas tronqué en douce');
  assert.equal(player.params.atGround, false, '0 devient false, pas 0');
  assert.equal(player.params.saute, true);
});

test('un paramètre inconnu avertit et ne crée rien', () => {
  // La faute de frappe est la panne la plus fréquente de ce système : le script « marche »,
  // la condition ne part jamais, et rien à l'écran ne dit pourquoi.
  const {player, an, avertis} = monter();
  assert.equal(an.setFloat('vitess', 3), false);
  assert.deepEqual([...avertis], ['vitess']);
  assert.equal('vitess' in player.params, false, 'aucun paramètre fantôme');
});

test('`lire` rend la valeur courante, et undefined pour un inconnu', () => {
  const {an} = monter();
  an.setFloat('speed', 4);
  assert.equal(an.get('speed'), 4);
  assert.equal(an.get('nexistepas'), undefined);
});

test('`state` suit le lecteur, `params` en est une COPIE', () => {
  const {player, an} = monter();
  assert.equal(an.state, 'Idle');
  player.state = 'Marche';
  assert.equal(an.state, 'Marche', 'la propriété lit le lecteur, elle ne l\'a pas recopié');

  const p = an.params;
  p.speed = 99;
  assert.notEqual(player.params.speed, 99,
    'écrire dans `params` ne doit rien set : sinon un script croirait avoir réglé la machine');
});

test('`replay` remet l\'état de départ ET les valeurs par défaut', () => {
  // Rendre l'état de départ sans remettre les paramètres en ressortirait à l'image suivante,
  // par la transition même qui les teste.
  const {player, an} = monter();
  an.setFloat('speed', 5);
  player.state = 'Marche';
  player.time = 3;
  assert.equal(an.restart(), 'Idle');
  assert.equal(player.params.speed, 0);
  assert.equal(player.time, 0);
});

test('l API de l animator est en anglais, et repond', () => {
  const {an} = monter();
  ['setFloat', 'setInt', 'setBool', 'setTrigger', 'get', 'restart'].forEach((k) => {
    assert.equal(typeof an[k], 'function', k + ' existe');
  });
  an.setTrigger('saute');
  assert.equal(an.get('saute'), true);
  assert.equal(an.state, an.state);
});

test('un déclencheur armé par un script est consommé par la transition, pas avant', () => {
  // Bout en bout : c'est le seul enchaînement qui prouve que l'object pousse la VRAIE machine.
  const {player, an} = monter();
  an.setFloat('speed', 0.5);
  const t = env.updatePlayerAnimator(MACHINE, player, 0.016, 0);
  assert.ok(t, 'la transition doit partir');
  assert.equal(an.state, 'Marche');
});

// ---------- Les réglages de transition d'Unity ----------

const { timeOfOutput, durationTransition, offsetTransition, transitionApplicable } = env;

test('Has Exit Time sans valeur vaut 100 % — les machines d\'avant ne changent pas', () => {
  assert.equal(timeOfOutput({awaitEnd:true}), 1);
  assert.equal(timeOfOutput({awaitEnd:true, exitTime:0.75}), 0.75);
  assert.equal(timeOfOutput({awaitEnd:false, exitTime:0.75}), null,
    'sans la case cochée, l\'instant de sortie n\'est pas exigé');
  assert.equal(timeOfOutput({}), null);
});

test('un Exit Time à 0,75 laisse partir aux trois quarts, pas avant', () => {
  const m = {states:[{name:'Coup'}, {name:'Idle'}],
             transitions:[{de:'Coup', vers:'Idle', awaitEnd:true, exitTime:0.75, conditions:[]}]};
  assert.equal(transitionApplicable(m, 'Coup', {}, 0.5), null);
  assert.ok(transitionApplicable(m, 'Coup', {}, 0.75), 'pile à 75 %, elle part');
  assert.ok(transitionApplicable(m, 'Coup', {}, 0.9));
});

test('Exit Time et conditions se cumulent, ils ne s\'annulent pas', () => {
  const m = {states:[{name:'Coup'}, {name:'Idle'}],
             transitions:[{de:'Coup', vers:'Idle', awaitEnd:true, exitTime:0.5,
                           conditions:[{param:'atGround', operateur:'==', value:true}]}]};
  assert.equal(transitionApplicable(m, 'Coup', {atGround:true}, 0.2), null, 'trop tôt');
  assert.equal(transitionApplicable(m, 'Coup', {atGround:false}, 0.9), null, 'condition fausse');
  assert.ok(transitionApplicable(m, 'Coup', {atGround:true}, 0.9), 'les deux : elle part');
});

test('Fixed Duration décide de l\'unité du fondu', () => {
  // Par défaut on reste en SECONDES : c'est le comportement d'avant, et le changer en douce
  // aurait rallongé ou raccourci tous les fondus déjà réglés.
  assert.equal(durationTransition({duration:0.25}, 2), 0.25);
  assert.equal(durationTransition({duration:0.25, durationFixe:true}, 2), 0.25);
  assert.equal(durationTransition({duration:0.25, durationFixe:false}, 2), 0.5,
    'en normalisé, 0,25 = un quart du clip de départ');
  assert.equal(durationTransition({}, 2), 0);
});

test('Transition Offset est une fraction, bornée à 1', () => {
  assert.equal(offsetTransition({offset:0.3}), 0.3);
  assert.equal(offsetTransition({offset:2}), 1, 'au-delà du clip, on démarre à la end');
  assert.equal(offsetTransition({offset:-1}), 0);
  assert.equal(offsetTransition({}), 0);
});
