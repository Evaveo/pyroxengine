// LES COMMANDES DOIVENT ETRE REELLEMENT INERTES EN LECTURE SEULE.
//
// Jusqu'a la v0.155.0, le seul mecanisme etait le refus dans `pushHistory()` : on apprenait la
// lecture seule EN ESSAYANT, apres avoir tire une fleche du gizmo. js/readonly-ui.js coupe les
// commandes. Deux choses s'y cachent, et aucune ne fait tomber un test si elle casse :
//
//   1. `tc.enabled` a DEUX proprietaires — la simulation physique et la lecture seule. Avant
//      l'arbitre, l'arret de la simulation rallumait le gizmo d'une scene verrouillee par
//      quelqu'un d'autre. Un booleen a deux proprietaires ne se voit jamais.
//   2. En sortant de lecture seule, on ne doit rallumer QUE ce qu'on a eteint. Sans marquage,
//      une commande deja desactivee pour une autre raison redevenait cliquable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { creerContexte, deEsm } from './engine-env.mjs';

const racineMoteur = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Le module importe scene.js (tc, gizmoAttach, gizmoSyncSelection) et scene-lock.js
// (onLockChange). deEsm efface les imports : on pose les stubs a la place, et on compte.
function charger(){
  const env = creerContexte([]);
  vm.runInContext([
    'var appels = [];',
    'var tc = { enabled: true };',
    'function gizmoAttach(o){ appels.push(["attach", o]); }',
    'function gizmoSyncSelection(){ appels.push(["sync"]); }',
    'function onLockChange(fn){ globalThis.__abonne = fn; }'
  ].join('\n'), env);
  vm.runInContext(deEsm(readFileSync(path.join(racineMoteur, 'js/readonly-ui.js'), 'utf8')),
    env, { filename: 'js/readonly-ui.js' });
  vm.runInContext([
    'this.applyReadOnlyUI = applyReadOnlyUI;',
    'this.setGizmoBlocked = setGizmoBlocked;',
    'this.gizmoAllowed = gizmoAllowed;',
    'this.isReadOnly = isReadOnly;'
  ].join('\n'), env);
  return env;
}

function poserBouton(env, parent, id, deja){
  const b = env.document.createElement('button');
  b.id = id;
  if(deja) b.disabled = true;
  parent.appendChild(b);
  return b;
}

function page(env){
  const d = env.document;
  const insp = d.createElement('div'); insp.id = 'insp-body'; d.body.appendChild(insp);
  const gtools = d.createElement('div'); gtools.id = 'g-tools'; d.body.appendChild(gtools);
  poserBouton(env, gtools, 'g-translate');
  poserBouton(env, d.body, 'g-space');
  poserBouton(env, d.body, 'btn-scene-add');
  return { insp, gtools };
}

test("le module s'abonne au verrou de lui-meme : scene-lock reste une feuille", () => {
  const env = charger();
  assert.equal(typeof env.__abonne, 'function',
    'sans cet abonnement, rien ne relie l etat du verrou aux commandes');
});

// ---------- L'arbitre du gizmo ----------

test('le gizmo reste coupe tant qu il reste une raison de le couper', () => {
  const env = charger();

  env.setGizmoBlocked('physics', true);
  assert.equal(env.tc.enabled, false);
  env.setGizmoBlocked('lock', true);
  assert.equal(env.tc.enabled, false);

  // LE CAS QUI FAISAIT LE BUG : la simulation s'arrete pendant que la scene est verrouillee.
  // Une ecriture directe `tc.enabled = true` rallumait le gizmo d'une scene qu'un collegue edite.
  env.setGizmoBlocked('physics', false);
  assert.equal(env.tc.enabled, false,
    'la raison lock subsiste : le gizmo ne doit PAS se rallumer');

  env.setGizmoBlocked('lock', false);
  assert.equal(env.tc.enabled, true, 'plus aucune raison : le gizmo revient');
});

test('couper le gizmo le detache, le rallumer le remet sur la selection', () => {
  const env = charger();
  env.appels.length = 0;

  env.setGizmoBlocked('lock', true);
  // Array.from : le tableau vient du realm du vm, et deepStrictEqual compare aussi les
  // prototypes — piege deja rencontre (voir test/sonde-ambiance.test.mjs).
  assert.deepEqual(Array.from(env.appels, (a) => a[0]), ['attach'],
    'un gizmo visible mais inerte dirait tire-moi : il doit se detacher');
  assert.equal(env.appels[0][1], null);

  env.appels.length = 0;
  env.setGizmoBlocked('lock', false);
  assert.deepEqual(Array.from(env.appels, (a) => a[0]), ['sync'],
    'au retour, le gizmo se remet sur l objet selectionne');
});

// ---------- Les commandes ----------

test('la lecture seule coupe les commandes explicites, et les rend au retour', () => {
  const env = charger();
  page(env);
  const gtranslate = env.document.getElementById('g-translate');
  const gspace = env.document.getElementById('g-space');
  const add = env.document.getElementById('btn-scene-add');

  env.applyReadOnlyUI(true);
  assert.ok(gtranslate.disabled && gspace.disabled && add.disabled);
  assert.equal(env.isReadOnly(), true);
  assert.ok(env.document.body.classList.contains('scene-readonly'));

  env.applyReadOnlyUI(false);
  assert.ok(!gtranslate.disabled && !gspace.disabled && !add.disabled);
  assert.equal(env.isReadOnly(), false);
  assert.ok(!env.document.body.classList.contains('scene-readonly'));
});

test('on ne rallume QUE ce qu on a eteint', () => {
  const env = charger();
  page(env);
  // Une commande deja desactivee par l'editeur pour sa propre raison.
  const dejaOff = poserBouton(env, env.document.getElementById('g-tools'), 'g-rotate', true);

  env.applyReadOnlyUI(true);
  assert.equal(dejaOff.disabled, true);
  env.applyReadOnlyUI(false);
  assert.equal(dejaOff.disabled, true,
    'elle etait eteinte AVANT la lecture seule : la rallumer serait un effet de bord');
});

test('l inspecteur est coupe, sauf ce qui porte data-readonly-ok', () => {
  const env = charger();
  const { insp } = page(env);
  const d = env.document;

  const champ = d.createElement('input'); insp.appendChild(champ);
  const profond = d.createElement('div'); insp.appendChild(profond);
  const select = d.createElement('select'); profond.appendChild(select);
  const garde = d.createElement('button');
  garde.setAttribute('data-readonly-ok', '1');
  profond.appendChild(garde);

  env.applyReadOnlyUI(true);
  assert.equal(champ.disabled, true, 'un champ direct');
  assert.equal(select.disabled, true, 'un champ imbrique : le parcours doit descendre');
  assert.ok(!garde.disabled,
    'la liste est une LISTE BLANCHE : ce qui est explicitement garde reste vivant');

  env.applyReadOnlyUI(false);
  assert.equal(champ.disabled, false);
  assert.equal(select.disabled, false);
});

test('un champ arrive APRES le passage en lecture seule est coupe aussi', () => {
  const env = charger();
  const { insp } = page(env);
  env.applyReadOnlyUI(true);

  // L'inspecteur se reconstruit depuis une vingtaine de sites d'appel : le module ne peut pas
  // se brancher apres la construction. Dans un navigateur, un MutationObserver rattrape ; le
  // harnais n'en a pas, on verifie donc que la passe suivante rattrape — c'est exactement ce
  // que l'observateur declenche.
  const tardif = env.document.createElement('input');
  insp.appendChild(tardif);
  assert.ok(!tardif.disabled, 'sans nouvelle passe, il echappe — d ou l observateur');

  env.applyReadOnlyUI(true);
  assert.equal(tardif.disabled, true);
});
