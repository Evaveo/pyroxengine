// moteur/test/composant-uidocument.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte } from './engine-env.mjs';

const env = creerContexte([
  'js/assets.js', 'js/materials.js', 'js/model-import.js', 'js/import-settings.js', 'js/objects.js',
  // component-data.js : les defauts du composant (ensureUIDoc) y vivent depuis qu'ils
  // sont PARTAGES avec le runtime du jeu publie.
  'js/component-data.js', 'js/component-registry.js', 'js/component.js', 'js/node.js', 'js/components/component-uidocument.js'
]);

function fabriquerNoeud(){
  const o = new env.THREE.Object3D();
  env.applyNodeMixin(o);
  return o;
}

test('UIDocument : addComponent sans options pose les défauts explicites', () => {
  const o = fabriquerNoeud();
  const c = o.addComponent('UIDocument');
  assert.deepEqual(JSON.parse(JSON.stringify(o.userData.uiDoc)),
    {documentUIId: null, sheetStyleIds: [], values: {}});
  assert.equal(c.documentUI, null);
  assert.equal(c.feuillesStyle.length, 0);
});

test('UIDocument : référence un asset documentUI/sheetStyle existant, pas une copie', () => {
  const o = fabriquerNoeud();
  const doc = env.createAssetDocumentUI('Test');
  const sheet = env.createAssetSheetStyle('Test');
  doc.html = '<button data-event="go">Go</button>';
  sheet.css = 'button{color:red}';

  const c = o.addComponent('UIDocument', {documentUIId: doc.id, sheetStyleIds: [sheet.id], values: {}});
  assert.equal(c.documentUI, doc);
  assert.equal(c.feuillesStyle[0], sheet);

  // modifier l'asset après coup doit se répercuter (référence en direct, pas une copie)
  doc.html = '<p>changé</p>';
  assert.equal(c.documentUI.html, '<p>changé</p>');
});

test('UIDocument : deux Noeuds peuvent partager la même sheetStyle', () => {
  const o1 = fabriquerNoeud();
  const o2 = fabriquerNoeud();
  const sheet = env.createAssetSheetStyle('Thème commun');
  const c1 = o1.addComponent('UIDocument', {sheetStyleIds: [sheet.id]});
  const c2 = o2.addComponent('UIDocument', {sheetStyleIds: [sheet.id]});
  sheet.css = '.x{color:blue}';
  assert.equal(c1.feuillesStyle[0].css, '.x{color:blue}');
  assert.equal(c2.feuillesStyle[0].css, '.x{color:blue}');
});

test('UIDocument : asset supprimé -> résolution renvoie null/[] sans exception', () => {
  const o = fabriquerNoeud();
  const c = o.addComponent('UIDocument', {documentUIId: 'introuvable', sheetStyleIds: ['introuvable-aussi']});
  assert.equal(c.documentUI, null);
  assert.equal(c.feuillesStyle.length, 0);
});

test('UIDocument : sérialisation, retrait', () => {
  const o = fabriquerNoeud();
  const doc = env.createAssetDocumentUI('Test');
  const c = o.addComponent('UIDocument', {documentUIId: doc.id, sheetStyleIds: [], values: {score: 1}});
  assert.deepEqual(JSON.parse(JSON.stringify(c.serialize())),
    JSON.parse(JSON.stringify(o.userData.uiDoc)));

  o.removeComponent(c);
  assert.equal(o.userData.uiDoc, undefined);
  assert.equal(o.getComponent('UIDocument'), null);
});
