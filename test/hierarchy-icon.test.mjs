import { deEsm } from './engine-env.mjs';
// moteur/test/hierarchy-icon.test.mjs
//
// L'icône d'un nœud vient de ses COMPOSANTS, pas d'un switch fermé sur `userData.type`.
// Le switch de hierarchy.js ne connaissait pas les tilemaps : une map de tuiles s'affichait
// avec l'icône « groupe » — et ajouter un type de nœud obligeait à rouvrir la hiérarchie.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');

function contexte(){
  const bac = { console, Math, JSON, Set, Map, Array, Object, Number, Error };
  bac.window = bac; bac.self = bac; bac.globalThis = bac;
  bac.isSceneObject = () => true;
  const ctx = vm.createContext(bac);
  vm.runInContext(deEsm(read('js/component-registry.js')), ctx, { filename: 'js/component-registry.js' });
  vm.runInContext(deEsm(read('js/component.js')), ctx, { filename: 'js/component.js' });
  vm.runInContext(deEsm(read('js/node.js')), ctx, { filename: 'js/node.js' });
  vm.runInContext(deEsm(read('js/hierarchy-icon.js')), ctx, { filename: 'js/hierarchy-icon.js' });
  return ctx;
}

function noeud(ctx){ const o = { userData: {}, parent: null }; ctx.applyNodeMixin(o); return o; }

test('l icone vient du premier composant qui en declare une', () => {
  const ctx = contexte();
  vm.runInContext('Registry.registerClass(class extends Component {'
    + ' static get typeName(){ return "Muet"; } });', ctx);
  vm.runInContext('Registry.registerClass(class extends Component {'
    + ' static get typeName(){ return "Tilemap"; } static get icon(){ return "▦ "; } });', ctx);

  const o = noeud(ctx);
  o.addComponent('Muet');
  o.addComponent('Tilemap');
  assert.equal(ctx.iconOf(o), '▦ ');
});

test('un noeud sans composant a icone rend le symbole de groupe', () => {
  const ctx = contexte();
  assert.equal(ctx.iconOf(noeud(ctx)), '⬡ ');
});

test('hierarchy.js ne contient plus de switch sur userData.type', () => {
  const src = read('js/hierarchy.js');
  assert.equal(/case 'point'|case 'camera'|case 'terrain'/.test(src), false,
    'le switch ferme doit avoir disparu au profit de iconOf');
});
