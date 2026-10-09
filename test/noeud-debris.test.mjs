import { deEsm } from './engine-env.mjs';
// Le défaut que ce fichier closed : sélectionner un modèle importé APRÈS avoir rechargé le
// project faisait planter l'inspecteur — `composant.inspectorFields is not a function`.
//
// La cause n'est pas dans notre code : `Object3D.clone()` de three recopie `userData` par
// `JSON.parse(JSON.stringify(...))`. Toute instance de composant qui s'y trouve en ressort en
// OBJET NU. `getComponent` compare `constructor.typeName`, qui vaut alors `undefined` : il ne
// voit plus le débris, `syncComponents` en recrée un propre À CÔTÉ, et le tableau
// finit avec quatre entrées dont deux fausses. L'inspecteur plante sur la première.
//
// Ce test n'a pas besoin de three : il reproduit ce que fait le clone — un objet nu à la place
// d'une instance — ce qui est exactement la condition à laquelle le correctif répond.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const racineMoteur = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(racineMoteur, f), 'utf8');

function contexte(){
  const bac = {console, Math, JSON, Set, Map, Array, Object};
  bac.window = bac; bac.self = bac; bac.globalThis = bac;
  const ctx = vm.createContext(bac);
  vm.runInContext(deEsm(read('js/component-registry.js')), ctx, { filename: 'js/component-registry.js' });
  vm.runInContext(deEsm(read('js/component.js')), ctx, {filename:'js/component.js'});
  vm.runInContext(deEsm(read('js/node.js')), ctx, {filename:'js/node.js'});
  return ctx;
}

// Un composant réel, du même moule que ceux de js/components/.
function vraiComposant(ctx, typeName){
  const C = vm.runInContext(
    '(class extends Component { static get typeName(){ return "' + typeName + '"; } })', ctx);
  return new C({});
}

// Ce que le clone de three laisse derrière lui : les champs, sans la classe.
const debris = () => ({data: {radius: 3}, active: true});

test('un DEBRIS de composant est jete, un vrai composant est garde', () => {
  const ctx = contexte();
  const vrai = vraiComposant(ctx, 'Collider');
  const o = {userData: {components: [debris(), vrai, debris()]}};

  ctx.applyNodeMixin(o);

  assert.equal(o.userData.components.length, 1,
    'restant : ' + o.userData.components.length + ' — les débris doivent partir, le vrai rester');
  assert.equal(o.userData.components[0], vrai, 'ce n’est pas le vrai composant qui a survécu');
});

test('apres le nettoyage, getComponent RETROUVE le composant', () => {
  const ctx = contexte();
  const o = {userData: {components: [debris(), vraiComposant(ctx, 'Physics')]}};
  ctx.applyNodeMixin(o);
  // C'est le symptôme complet : le débris masquait la vue, `getComponent` rendait null, et
  // `syncComponents` empilait un doublon.
  assert.ok(o.getComponent('Physics'), 'getComponent ne retrouve pas le composant');
  assert.equal(o.getComponents().length, 1, 'un doublon subsiste');
});

test('l inspecteur peut interroger le TYPE de tout ce qui reste', () => {
  const ctx = contexte();
  const o = {userData: {components: [debris(), vraiComposant(ctx, 'Collider'), debris()]}};
  ctx.applyNodeMixin(o);
  // Ce que l'inspecteur fait de chaque component : lire `constructor.typeName` pour trouver sa
  // view (js/component-views.js) et appeler `toJSON`. Un débris n'a ni l'un ni l'autre — il
  // rendait `undefined` comme typeName, donc aucune vue, donc un bloc vide sans le moindre
  // message. (Avant ce lot, l'assertion portait sur `inspectorFields`, méthode que les
  // composants ne portent plus depuis que la présentation est sortie du modèle.)
  o.userData.components.forEach((c) => {
    assert.equal(typeof c.toJSON, 'function',
      'un débris a survécu : l’inspecteur le rencontrera');
    assert.ok(c.constructor.typeName,
      'un débris a survécu : sans nomType, l’inspecteur n’a aucune vue à lui associer');
  });
});

test('un tableau SAIN n est pas reconstruit inutilement', () => {
  const ctx = contexte();
  const list = [vraiComposant(ctx, 'Collider'), vraiComposant(ctx, 'Physics')];
  const o = {userData: {components: list}};
  ctx.applyNodeMixin(o);
  // Le cas current — aucun clone en game. Remplacer le tableau à chaque appel casserait toute
  // référence gardée ailleurs, pour rien.
  assert.equal(o.userData.components, list, 'le tableau sain a été remplacé');
  assert.equal(o.userData.components.length, 2);
});

test('pas de tableau, ou un tableau empty : rien ne casse', () => {
  const ctx = contexte();
  const sans = {userData: {}};
  ctx.applyNodeMixin(sans);
  assert.deepEqual(Array.from(sans.userData.components), []);

  // Ce que `JSON.parse(JSON.stringify(...))` peut aussi rendre si le tableau n'existait pas
  // encore : une valeur qui n'est pas un tableau du tout.
  const casse = {userData: {components: {0: debris()}}};
  ctx.applyNodeMixin(casse);
  assert.ok(Array.isArray(casse.userData.components), 'components doit toujours être un tableau');
  assert.equal(casse.userData.components.length, 0);
});

test('estComposant ne se laisse pas berner par un objet qui IMITE un composant', () => {
  const ctx = contexte();
  // Un débris porte les mêmes fields qu'un component : c'est le contrôle de CLASSE qui
  // tranche, pas la présence d'une propriété. Un test par canard (`typeof c.serialize`)
  // aurait laissé passer tout objet mal formé venu d'un fichier de project trafiqué.
  assert.equal(ctx.isComponent({inspectorFields(){ return []; }, serialize(){ return {}; }}), false);
  assert.equal(ctx.isComponent(null), false);
  assert.equal(ctx.isComponent(vraiComposant(ctx, 'X')), true);
});
