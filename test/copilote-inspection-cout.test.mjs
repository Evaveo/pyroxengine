// moteur/test/copilote-inspection-cout.test.mjs
//
// Les outils d'inspection du copilote, et les quatre leviers de coût : mise en cache du préfixe,
// outils chargés par domaine, compactage de l'historique, prix d'un tour.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deEsm } from './engine-env.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const hote = (x) => JSON.parse(JSON.stringify(x));

function contexte(){
  const bac = {console, Math, JSON, Number, String, Object, Array, Set, ArrayBuffer, Date, isFinite};
  bac.globalThis = bac;
  const ctx = vm.createContext(bac);
  // Bouchons des imports de copilot-inspect.js
  vm.runInContext('var consoleEditor = {inputs: []}; var assets = []; var objects = [];'
    + 'function codeOfScriptEntry(e){ var a = assets.find(function(x){ return x.id === e.scriptId; }); return a ? a.code : ""; }', ctx);
  for(const f of ['js/copilot-budget.js', 'js/copilot-inspect.js', 'js/copilot-providers.js']){
    vm.runInContext(deEsm(read(f)), ctx, {filename: f});
  }
  ctx.$ = (expr) => vm.runInContext(expr, ctx);
  return ctx;
}

function fakeObject(name, type, pos, extra){
  const o = Object.assign({
    name, id: Math.floor(Math.random() * 1e6),
    position: {x: pos[0], y: pos[1], z: pos[2]}, rotation: {x: 0, y: Math.PI / 2, z: 0},
    scale: {x: 1, y: 1, z: 1}, visible: true, children: [], parent: null,
    userData: {type}
  }, extra || {});
  return o;
}

test('get_object rend une forme compacte : arrondis, composants, matériau, scripts, enfants', () => {
  const ctx = contexte();
  const parent = fakeObject('Joueur', 'mesh', [1.23456789, 0, -2]);
  const enfant = fakeObject('Arme', 'mesh', [0, 1, 0]);
  enfant.parent = parent; parent.children.push(enfant);
  parent.userData.game = {tag: 'player', layer: 'Défaut'};
  parent.userData.components = [{toJSON: () => ({typeName: 'Rigidbody', mass: 1.00049, heights: new Array(100).fill(0.5)})}];
  parent.userData.scripts = [{scriptId: 's1', active: true}];
  parent.material = {type: 'MeshStandardMaterial', roughness: 0.123456, metalness: 0,
    color: {getHexString: () => 'ff0000'}};
  ctx.$('assets').push({id: 's1', kind: 'script', name: 'Mouvement', code: 'x'.repeat(5000)});
  ctx.$('objects').push(parent, enfant);
  const out = JSON.parse(ctx.$('INSPECTION_TOOLS').find((t) => t.name === 'get_object').exec({name: 'Joueur'}));
  assert.deepEqual(out.position, [1.235, 0, -2]);
  assert.deepEqual(out.rotationDeg, [0, 90, 0]);
  assert.equal(out.tag, 'player');
  assert.deepEqual(out.children, ['Arme']);
  assert.equal(out.components[0].typeName, 'Rigidbody');
  assert.equal(out.components[0].mass, 1);
  assert.ok(out.components[0].heights.length <= 17, 'un tableau long doit être coupé');
  assert.equal(out.material.color, '#ff0000');
  assert.equal(out.material.roughness, 0.123);
  assert.equal(out.scripts[0].name, 'Mouvement');
  assert.equal(out.scripts[0].length, 5000);
  assert.ok(out.scripts[0].source.length < 2100 && /tronqué/.test(out.scripts[0].source));
});

test('find_objects filtre et pagine ; get_hierarchy indente ; read_script et read_console', () => {
  const ctx = contexte();
  const objs = ctx.$('objects');
  const a = fakeObject('Ennemi 1', 'mesh', [0, 0, 0]); a.userData.game = {tag: 'enemy'};
  const b = fakeObject('Ennemi 2', 'mesh', [10, 0, 0]); b.userData.game = {tag: 'enemy'};
  const c = fakeObject('Sol', 'mesh', [0, 0, 0]);
  const g = fakeObject('Groupe', 'group', [0, 0, 0]);
  g.children.push(a); a.parent = g;
  objs.push(g, a, b, c);
  const tools = ctx.$('INSPECTION_TOOLS');
  const run = (n, x) => tools.find((t) => t.name === n).exec(x);
  let r = JSON.parse(run('find_objects', {tag: 'enemy'}));
  assert.equal(r.total, 2);
  r = JSON.parse(run('find_objects', {name: 'ennemi', near: [0, 0, 0], radius: 3}));
  assert.deepEqual(hote(r.objects.map((o) => o.name)), ['Ennemi 1']);
  assert.equal(r.objects[0].parent, 'Groupe');
  r = JSON.parse(run('find_objects', {limit: 1, offset: 1}));
  assert.equal(r.total, 4); assert.equal(r.objects.length, 1);

  const h = run('get_hierarchy', {});
  assert.match(h, /^Groupe \[group\]\n {2}Ennemi 1 \[mesh\]/);
  assert.match(run('get_hierarchy', {depth: 1}), /… 1 enfant/);

  ctx.$('assets').push({id: 'z', kind: 'script', name: 'IA', code: 'api.log(1)'});
  assert.match(run('read_script', {name: 'IA'}), /api\.log\(1\)/);
  assert.throws(() => run('read_script', {name: 'Rien'}), /scripts : IA/);

  ctx.$('consoleEditor').inputs.push({level: 'log', msg: 'bonjour', heure: '10:00'},
    {level: 'error', msg: 'boum', objName: 'Ennemi 1', heure: '10:01'});
  assert.match(run('read_console', {level: 'error'}), /error Ennemi 1 : boum/);
  assert.doesNotMatch(run('read_console', {level: 'error'}), /bonjour/);
  assert.match(ctx.$('capOutput')('x'.repeat(7000)), /tronqué/);
});

test('build_room : sol, murs percés d une porte, plafond — tailles réelles', () => {
  const ctx = contexte();
  const boxes = hote(ctx.$('roomLayout')({center: [0, 0, 0], size: [6, 3, 4], wallThickness: 0.2,
    ceiling: true, doors: [{wall: 'south', width: 1, height: 2}]}));
  const names = boxes.map((b) => b.name);
  assert.ok(names.includes('sol') && names.includes('plafond'));
  assert.ok(names.includes('mur_north') && names.includes('mur_east') && names.includes('mur_west'));
  const sud = boxes.filter((b) => b.name.startsWith('mur_south'));
  assert.equal(sud.length, 3, 'deux pans et un linteau');
  const pans = sud.filter((b) => !b.name.includes('linteau'));
  assert.equal(pans.reduce((s, b) => s + b.size[0], 0), 5, '6 m moins 1 m de porte');
  const linteau = sud.find((b) => b.name.includes('linteau'));
  assert.deepEqual(linteau.size, [1, 1, 0.2]);
  assert.equal(linteau.center[1], 2.5);
});

test('LA MISE EN CACHE : dernier outil, système, dernier bloc du dernier message', () => {
  const ctx = contexte();
  const F = ctx.$('PROVIDERS');
  const conv = [{role: 'user', content: 'salut'}, {role: 'assistant', content: [{type: 'text', text: 'ok'}]},
    {role: 'user', content: [{type: 'tool_result', tool_use_id: 'a', content: 'r'}]}];
  const body = hote(F.anthropic.body({model: 'm', maxTokens: 10, system: 'S',
    commands: [{name: 'a', description: '', schema: {}}, {name: 'b', description: '', schema: {}}], messages: conv}));
  assert.equal(body.tools[0].cache_control, undefined);
  assert.deepEqual(body.tools[1].cache_control, {type: 'ephemeral'});
  assert.deepEqual(body.system[0].cache_control, {type: 'ephemeral'});
  assert.deepEqual(body.messages[2].content[0].cache_control, {type: 'ephemeral'});
  assert.equal(body.messages[0].content, 'salut', 'seul le DERNIER message est marqué');
  assert.equal(conv[2].content[0].cache_control, undefined, 'la conversation d origine n est pas touchée');
  const s = hote(F.anthropic.body({model: 'm', maxTokens: 10, system: 'S', commands: [],
    messages: [{role: 'user', content: 'q'}]}));
  assert.deepEqual(s.messages[0].content, [{type: 'text', text: 'q', cache_control: {type: 'ephemeral'}}]);
  assert.equal(F.anthropic.models[0], 'claude-sonnet-5', 'Sonnet est le modèle par défaut');
  assert.ok(F.anthropic.models.includes('claude-opus-5'), 'Opus reste au choix');
});

test('load_tools : le noyau toujours, un domaine seulement une fois chargé, l inconnu jamais caché', () => {
  const ctx = contexte();
  const cmds = ['list_scene', 'get_object', 'paint_room', 'play_sound', 'outil_de_plugin'].map((name) => ({name}));
  const sel = (d) => hote(ctx.$('selectTools')(cmds, d)).map((c) => c.name);
  assert.deepEqual(sel([]), ['list_scene', 'get_object', 'outil_de_plugin']);
  assert.deepEqual(sel(['2d']), ['list_scene', 'get_object', 'paint_room', 'outil_de_plugin']);
  assert.deepEqual(sel(['2d', 'audio']), ['list_scene', 'get_object', 'paint_room', 'play_sound', 'outil_de_plugin']);
  const core = ctx.$('CORE_TOOLS');
  for(const d of Object.values(ctx.$('TOOL_DOMAINS'))){
    for(const t of d.tools) assert.ok(!core.includes(t), t + ' est à la fois noyau et domaine');
  }
  // Les noms du tableau des domaines existent vraiment dans le code des outils.
  const src = ['js/copilot.js', 'js/copilot-observer.js', 'js/copilot-workshop.js', 'js/copilot-inspect.js', 'js/copilot-blender.js']
    .map(read).join('\n');
  for(const d of Object.values(ctx.$('TOOL_DOMAINS'))){
    for(const t of d.tools) assert.match(src, new RegExp("name: '" + t + "'"), t + ' introuvable');
  }
  for(const t of core) assert.match(src, new RegExp("name: '" + t + "'"), t + ' (noyau) introuvable');
});

test('LE COMPACTAGE garde les paires appel/résultat, les derniers échanges, et est stable', () => {
  const ctx = contexte();
  const conv = [];
  for(let i = 0; i < 10; i++){
    conv.push({role: 'assistant', content: [{type: 'tool_use', id: 't' + i, name: 'list_scene', input: {}}]});
    conv.push({role: 'user', content: [{type: 'tool_result', tool_use_id: 't' + i, content: 'R'.repeat(2000)}]});
  }
  const compact = ctx.$('compactHistory');
  assert.equal(compact(conv, {thresholdTokens: 1e9}).compacted, 0, 'sous le seuil, rien ne bouge');
  const r = compact(conv, {thresholdTokens: 1000, keepMessages: 6});
  assert.equal(r.messages.length, conv.length, 'aucun message retiré');
  r.messages.forEach((m, i) => {
    if(m.role === 'user') assert.equal(m.content[0].tool_use_id, 't' + ((i - 1) / 2), 'paire rompue');
  });
  assert.ok(r.messages[1].content[0].content.endsWith('…[résumé]'));
  assert.ok(r.messages[1].content[0].content.length < 220);
  assert.equal(r.messages[19].content[0].content.length, 2000, 'les derniers échanges restent entiers');
  assert.equal(conv[1].content[0].content.length, 2000, 'l entrée n est pas modifiée');
  const again = compact(r.messages, {thresholdTokens: 1000, keepMessages: 6});
  assert.deepEqual(hote(again.messages.slice(0, 14)), hote(r.messages.slice(0, 14)), 'recompacter ne change pas le préfixe');
  // forme OpenAI
  const oa = compact([{role: 'tool', tool_call_id: 'x', content: 'Z'.repeat(5000)}, {role: 'user', content: 'q'}],
    {thresholdTokens: 10, keepMessages: 1});
  assert.ok(oa.messages[0].content.endsWith('…[résumé]'));
  assert.equal(oa.messages[0].tool_call_id, 'x');
});

test('LE COÛT d un tour à partir de usage, et le modèle inconnu', () => {
  const ctx = contexte();
  const c = hote(ctx.$('costOfUsage')({input_tokens: 1e6, output_tokens: 1e6,
    cache_read_input_tokens: 1e6, cache_creation_input_tokens: 1e6}, 'claude-sonnet-5'));
  const p = ctx.$('COPILOT_PRICES')['claude-sonnet-5'];
  assert.equal(c.cost, p.input + p.output + p.cacheRead + p.cacheWrite);
  assert.equal(ctx.$('costOfUsage')({input_tokens: 5}, 'gpt-5').cost, null);
  assert.equal(ctx.$('formatCost')(0.01234), '0,0123 $');
});
