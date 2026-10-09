// moteur/test/migration-uidocument.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte } from './engine-env.mjs';

const env = creerContexte(['js/assets.js', 'js/materials.js', 'js/model-import.js', 'js/import-settings.js', 'js/project-settings.js', 'js/serialization.js']);

test('project v9 avec UI plate -> Noeud UIDocument (migration 9 -> 10)', () => {
  const v9 = {
    version: 9, projectName: 'p', current: 0,
    ui: {elements: [
      {name: 'Score', type: 'text', anchor: 'hg', x: 20, y: 20, l: 200, h: 40, text: 'Score: 0',
       color: '#fff', fond: '', bordure: '', radius: 0, opacity: 1, visible: true},
      {name: 'Jouer', type: 'button', anchor: 'bc', x: 0, y: 40, l: 160, h: 48, text: 'Jouer',
       event: 'play', color: '#fff', fond: '#1d2026', bordure: '#5aa9e6', radius: 8, opacity: 1, visible: true}
    ]},
    scenes: [{name: 'S', data: {objects: [{id: 1, type: 'group', name: 'X'}], tracks: [], duration: 5, loop: true}}],
    assets: []
  };
  const apres = env.migrateProjectData(JSON.parse(JSON.stringify(v9)));

  assert.equal(apres.version, 15);
  assert.equal(apres.ui, undefined);
  const objects = apres.scenes[0].data.objects;
  const noeudUI = objects.find(function(o){ return o.name === 'UI (migré)'; });
  assert.ok(noeudUI, 'un Noeud UI (migré) doit être créé');
  assert.ok(noeudUI.uiDoc.documentUIId, 'le HTML doit être référencé via un asset documentUI (migration 10 -> 11)');
  const docAsset = apres.assets.find(function(a){ return a.id === noeudUI.uiDoc.documentUIId; });
  assert.ok(docAsset && docAsset.kind === 'documentUI');
  assert.ok(docAsset.html.includes('Score: 0'));
  assert.ok(docAsset.html.includes('data-event="play"'));
  assert.equal(objects.length, 2, 'les objets existants ne sont pas perdus');
});

test('anchor centrée verticalement (cc/cg) -> top:50% valide, pas top:5050%', () => {
  const v9 = {
    version: 9, projectName: 'p', current: 0,
    ui: {elements: [
      {name: 'Vie', type: 'text', anchor: 'cc', x: 0, y: 0, l: 100, h: 30, text: 'Vie',
       color: '#fff', fond: '', bordure: '', radius: 0, opacity: 1, visible: true},
      {name: 'Mana', type: 'text', anchor: 'cg', x: 10, y: 25, l: 100, h: 30, text: 'Mana',
       color: '#fff', fond: '', bordure: '', radius: 0, opacity: 1, visible: true}
    ]},
    scenes: [{name: 'S', data: {objects: [], tracks: [], duration: 5, loop: true}}],
    assets: []
  };
  const apres = env.migrateProjectData(JSON.parse(JSON.stringify(v9)));
  const noeudUI = apres.scenes[0].data.objects.find(function(o){ return o.name === 'UI (migré)'; });
  const docAsset = apres.assets.find(function(a){ return a.id === noeudUI.uiDoc.documentUIId; });
  const html = docAsset.html;

  assert.ok(html.includes('top:50%;'), 'anchor "cc" sans décalage doit produire top:50% valide');
  assert.ok(!/top:\d+50%/.test(html), 'ne doit jamais produire un top numérique+% invalide comme top:5050%');
  assert.ok(html.includes('top:calc(50% + 25px);'), 'anchor "cg" avec décalage y doit produire un calc() valide');
});

test('project v9 sans UI -> pas de Noeud créé', () => {
  const v9 = {
    version: 9, projectName: 'p', current: 0, ui: {elements: []},
    scenes: [{name: 'S', data: {objects: [], tracks: [], duration: 5, loop: true}}], assets: []
  };
  const apres = env.migrateProjectData(JSON.parse(JSON.stringify(v9)));
  assert.equal(apres.version, 15);
  assert.equal(apres.scenes[0].data.objects.length, 0);
});

test('project v10 avec UIDocument inline -> assets documentUI/sheetStyle référencés (migration 10 -> 11)', () => {
  const v10 = {
    version: 10, projectName: 'p', current: 0,
    scenes: [{name: 'S', data: {objects: [
      {id: 1, type: 'group', name: 'HUD', uiDoc: {html: '<p>Score</p>', css: 'p{color:red}', values: {score: 3}}}
    ], tracks: [], duration: 5, loop: true}}],
    assets: []
  };
  const apres = env.migrateProjectData(JSON.parse(JSON.stringify(v10)));

  assert.equal(apres.version, 15);
  const node = apres.scenes[0].data.objects[0];
  assert.equal(node.uiDoc.html, undefined, 'html ne doit plus être inline');
  assert.equal(node.uiDoc.css, undefined, 'css ne doit plus être inline');
  assert.deepEqual(node.uiDoc.values, {score: 3}, 'values (data-bind) doit être préservé');
  const doc = apres.assets.find(function(a){ return a.id === node.uiDoc.documentUIId; });
  const sheet = apres.assets.find(function(a){ return a.id === node.uiDoc.sheetStyleIds[0]; });
  assert.ok(doc && doc.kind === 'documentUI' && doc.html === '<p>Score</p>');
  assert.ok(sheet && sheet.kind === 'sheetStyle' && sheet.css === 'p{color:red}');
});
