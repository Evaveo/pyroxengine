// moteur/test/materiau-shader-inspecteur.test.mjs
// Panneau matériau de l'inspecteur : sélecteur de shader + propriétés exposées dynamiques
// (import-settings.js). Le rendu DOM interactif (applyFormMaterial lisant les champs)
// n'est pas testable ici — creerContexte() renvoie un nouveau stub à chaque getElementById,
// donc rien ne persiste entre deux lectures (voir engine-env.mjs). Testé : les fonctions
// PURES (propertiesExposedOfShader) et le HTML produit par sectionMaterialHtml, qui ne
// touchent jamais le DOM elles-mêmes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { creerContexte } from './engine-env.mjs';

function env(){
  return creerContexte(['js/assets.js', 'js/materials.js', 'js/material-props.js',
                          'js/model-import.js', 'js/import-settings.js', 'js/project-settings.js', 'js/serialization.js', 'js/shader-graph.js']);
}

test('propertiesExposedOfShader extrait les noeuds param.* avec leur nom, type et defaut', () => {
  const e = env();
  vm.runInContext(`
    globalThis.__shader = {kind:'graphShader', nodes:[
      {id:'n1', type:'param.color', params:{name:'teinte', defaultValue:'#ff0000'}},
      {id:'n2', type:'param.float', params:{name:'intensite', defaultValue:2}},
      {id:'n3', type:'param.vec3', params:{name:'offset', x:1, y:2, z:3}},
      {id:'n4', type:'constant.float', params:{value:9}}
    ]};
  `, e);
  const props = vm.runInContext('propertiesExposedOfShader(globalThis.__shader)', e);
  assert.equal(props.length, 3, 'seuls les noeuds param.* sont exposes, pas constant.float');
  assert.deepEqual(JSON.parse(JSON.stringify(props[0])), {name:'teinte', type:'color', defaultValue:'#ff0000'});
  assert.deepEqual(JSON.parse(JSON.stringify(props[1])), {name:'intensite', type:'float', defaultValue:2});
  assert.deepEqual(JSON.parse(JSON.stringify(props[2])), {name:'offset', type:'vec3', defaultValue:{x:1, y:2, z:3}});
});

test('propertiesExposedOfShader sur un shader sans noeud param.* renvoie un tableau empty', () => {
  const e = env();
  vm.runInContext(`globalThis.__shader = {kind:'graphShader', nodes:[{id:'n1', type:'uv', params:{}}]};`, e);
  const props = vm.runInContext('propertiesExposedOfShader(globalThis.__shader)', e);
  assert.equal(props.length, 0);
});

test('sectionMaterialHtml, sans shaderId, affiche le select "PBR classique" et les champs PBR', () => {
  const e = env();
  vm.runInContext(`
    globalThis.__mat = {id:'m1', kind:'material', name:'M', props:{}};
  `, e);
  const html = vm.runInContext('sectionMaterialHtml(globalThis.__mat)', e);
  assert.ok(html.includes('id="ip-mat-shader"'), 'le select de shader doit toujours etre present');
  assert.ok(html.includes('PBR classique'));
  assert.ok(html.includes('id="ip-mcouleur"'), 'sans shaderId : les champs PBR habituels');
  assert.ok(!html.includes('ip-shp-'), 'pas de champ de propriete de shader sans shaderId');
});

test('sectionMaterialHtml, avec shaderId, affiche les proprietes exposees au lieu des champs PBR', () => {
  const e = env();
  vm.runInContext(`
    globalThis.__shader = {id:'gs1', kind:'graphShader', name:'Eau', target:'lit',
      nodes:[{id:'n1', type:'param.color', params:{name:'teinte', defaultValue:'#0000ff'}}],
      links:[], outputs:{}};
    assets.push(globalThis.__shader);
    globalThis.__mat = {id:'m1', kind:'material', name:'M', props:{}, shaderId:'gs1', valuesParams:{}};
  `, e);
  const html = vm.runInContext('sectionMaterialHtml(globalThis.__mat)', e);
  assert.ok(html.includes('id="ip-mat-shader"'));
  assert.ok(html.includes('<option value="gs1" selected>Eau</option>'), 'le shader current est preselectionne');
  assert.ok(html.includes('id="ip-shp-teinte"'), 'un champ pour la propriete "teinte" exposee par le shader');
  assert.ok(!html.includes('id="ip-mcouleur"'), 'les champs PBR classiques disparaissent quand un shader est assigne');
});

test('sectionMaterialHtml, shaderId pointant sur un asset supprime, avertit au lieu de planter', () => {
  const e = env();
  vm.runInContext(`
    globalThis.__mat = {id:'m1', kind:'material', name:'M', props:{}, shaderId:'introuvable', valuesParams:{}};
  `, e);
  const html = vm.runInContext('sectionMaterialHtml(globalThis.__mat)', e);
  assert.ok(html.includes('introuvable') || html.toLowerCase().includes('shader'));
});
