// moteur/test/mcp-tool-gaps.test.mjs
//
// Les manques rencontrés en construisant « Zeldo » avec les SEULS outils MCP du moteur (2026-10-02) :
// lecture paginée d'un long script, point de vue imposé à play_and_measure, réimport d'un modèle EN
// PLACE, pivot explicite à l'import, export Blender d'un seul élément, ombre d'une directionnelle et
// couleur de sol de l'hémisphère. Ce qui se garde ici est la partie PURE de chacun (le reste demande
// un navigateur ou Blender — voir outils/blender-addon/tests/blender_smoke.py).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deEsm } from './engine-env.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');
const host = (x) => JSON.parse(JSON.stringify(x));

function load(files, prelude){
  const sandbox = {console, Math, JSON, Number, String, Object, Array, Set, Map, Date, isFinite, Error};
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  if(prelude) vm.runInContext(prelude, ctx);
  for(const f of files) vm.runInContext(deEsm(read(f)), ctx, {filename: f});
  return (expr) => vm.runInContext(expr, ctx);
}

// ---------- 1. read_script par pages ----------
test('read_script se lit par pages : offset/limit en caractères, la sortie coupée donne la suite', () => {
  const $ = load(['js/copilot-budget.js', 'js/copilot-inspect.js', 'js/copilot-providers.js'],
    'var consoleEditor = {inputs: []}; var assets = []; var objects = [];'
    + 'function codeOfScriptEntry(e){ return ""; }');
  const code = 'a'.repeat(25000) + 'FIN';
  $('assets').push({id: 's1', kind: 'script', name: 'Long', code});
  const tool = $('INSPECTION_TOOLS').find((t) => t.name === 'read_script');
  assert.ok(tool.schema.properties.offset && tool.schema.properties.limit, 'offset/limit absents du schéma');
  const first = tool.exec({name: 'Long'});
  const m = first.match(/read_script \{name, offset: (\d+)\}/);
  assert.ok(m, 'la sortie coupée doit dire comment lire la suite : ' + first.slice(-200));
  const rest = tool.exec({name: 'Long', offset: Number(m[1])});
  assert.ok(rest.endsWith('FIN'), 'la page suivante doit atteindre la fin');
  assert.ok(!/tronqué/.test(rest), 'la dernière page n\'est pas tronquée');
  // Les deux pages recousues redonnent le texte entier (en-tête « // script » compris).
  const body = rest.replace(/^…\[caractères \d+ à \d+ sur \d+\]\n/, '');
  assert.equal(first.split('\n…[tronqué')[0] + body, '// script « Long »\n' + code);
  const small = tool.exec({name: 'Long', offset: 100, limit: 5});
  assert.match(small, /^…\[caractères 100 à 105 sur \d+\]\naaaaa\n…\[tronqué/);
  assert.match(tool.exec({name: 'Long', offset: 1e6}), /au-delà de la fin/);
});

// ---------- 5. play_and_measure : point de vue imposé ----------
test('play_and_measure : camera/focus deviennent une pose, sans rien écrire dans le projet', () => {
  const $ = load(['js/copilot-observer.js'], 'var CopilotTools = {register: function(){}};');
  assert.equal($('measureCameraPose({})'), null, 'sans option : pas de pose, le jeu garde sa caméra');
  const exact = host($('measureCameraPose({camera: {position: {x: 1, y: 2, z: 3}, target: {x: 4, y: 0, z: -1}}})'));
  assert.deepEqual(exact, {position: [1, 2, 3], target: [4, 0, -1]});
  const focus = host($('measureCameraPose({focus: {x: 10, y: 0, z: 5}, distance: 10})'));
  assert.deepEqual(focus.target, [10, 0, 5]);
  assert.deepEqual(focus.position, [10, 6, 13], 'en haut et de biais, depuis +Z');
  assert.throws(() => $('measureCameraPose({camera: {target: {x: 0}}})'), /camera\.position est requis/);
});

test('le runtime applique la pose de mesure avant le rendu, et seulement si elle existe', () => {
  const src = read('js/game-runtime.js');
  const fn = read('js/camera-framing.js').match(/export function applyMeasureCamera\(cam, pose\)\{[\s\S]*?\n\}/);
  assert.ok(fn, 'applyMeasureCamera absente de camera-framing.js');
  const apply = new Function(deEsm(fn[0]) + '; return applyMeasureCamera;')();
  const calls = [];
  const cam = {position: {set: (...v) => calls.push(['pos', v])}, lookAt: (...v) => calls.push(['look', v]),
    updateMatrixWorld: () => calls.push(['upd'])};
  assert.equal(apply(cam, undefined), false);
  assert.equal(calls.length, 0, 'sans pose, la caméra du jeu n\'est pas touchée');
  assert.equal(apply(cam, {position: [1, 2, 3], target: [0, 0, 0]}), true);
  assert.deepEqual(calls[0], ['pos', [1, 2, 3]]);
  assert.deepEqual(calls[1], ['look', [0, 0, 0]]);
  // Dans la boucle, APRÈS les scripts et Systèmes (qui font suivre la caméra) et AVANT les ombres.
  const loop = src.slice(src.indexOf('function loop(){'));
  const iApply = loop.indexOf('applyMeasureCamera(game.cam');
  assert.ok(iApply > loop.indexOf('System.runFrame') && iApply > loop.indexOf('runScripts('));
  assert.ok(iApply < loop.indexOf('rtUpdateShadows(game.cam)'));
});

// ---------- 6e / 7. réimport en place, pivot explicite ----------
test('réimport en place : même id, contenu neuf, réglages explicites prioritaires, clips gardés', () => {
  const $ = load(['js/model-replace.js']);
  const target = {id: 'a7', kind: 'model', name: 'Coffre', folder: 'Models', template: {userData: {assetId: 'a7'}},
    paramsImport: {centrer: true, scale: 2}};
  const fresh = {id: 'a99', kind: 'model', name: 'Coffre', folder: 'Autre', template: {userData: {assetId: 'a99'}},
    paquet: ['f'], animationsBrutes: [{name: 'Open'}]};
  const out = $('transferModelContent')(target, fresh);
  assert.equal(out.id, 'a7');
  assert.equal(out.folder, 'Models', 'le dossier de l\'asset existant est gardé');
  assert.equal(out.template, fresh.template);
  assert.equal(out.template.userData.assetId, 'a7', 'le gabarit neuf pointe sur l\'id GARDÉ');
  assert.deepEqual(host($('mergeReplacedParams')({centrer: true, scale: 2}, {centrer: false, setGround: undefined})),
    {centrer: false, scale: 2});
  let n = 0;
  const clips = $('reconcileClips')([{id: 'c1', take: 'Open'}, {id: 'c2', take: 'Gone'}], [{name: 'Open'}, {name: 'Close'}],
    (take) => ({id: 'n' + (++n), take}));
  assert.deepEqual(host(clips), [{id: 'c1', take: 'Open'}, {id: 'n1', take: 'Close'}]);
  assert.equal($('reconcileClips')(undefined, [{name: 'X'}], () => null), undefined);
  // Les racines d'instance d'un modèle dans un gabarit de prefab (pas ses nœuds exposés).
  const node = (ud, kids) => ({userData: ud, children: kids || [], traverse(f){ f(this); this.children.forEach((c) => c.traverse(f)); }});
  const tree = node({}, [node({assetId: 'a7'}, [node({assetId: 'a7', modelNode: 'k'})]), node({assetId: 'a8'})]);
  assert.equal($('modelRootsIn')(tree, 'a7').length, 1);
});

test('pivot d\'import : center/setGround explicites, décrits en clair', () => {
  const $ = load(['js/model-replace.js']);
  assert.deepEqual(host($('explicitPivotParams({})')), {});
  assert.deepEqual(host($('explicitPivotParams({center: false, setGround: false})')), {centrer: false, setGround: false});
  assert.match($('describePivot({})'), /recentré.*center:true.*Y=0/);
  assert.match($('describePivot({centrer: false, setGround: false})'), /center:false.*setGround:false/);
});

// ---------- 6a. export Blender d'un élément ----------
test('blender_import_to_project : objects et origin partent dans la spec, validés', () => {
  const $ = load(['js/copilot-blender.js'], 'var CopilotTools = {register: function(){}}; var BlenderLink = {};');
  const base = host($('exportSpecFor({name: "Kit"})'));
  assert.equal(base.objects, undefined, 'sans objects : toute la scène, comme avant');
  assert.equal(base.individual, false);
  const one = host($('exportSpecFor({name: "Porte", objects: ["Door"], origin: "bottom"})'));
  assert.deepEqual(one.objects, ['Door']);
  assert.equal(one.origin, 'bottom');
  assert.deepEqual(host($('exportSpecFor({name: "P", origin: [0, 0.5, 1]})')).origin, [0, 0.5, 1]);
  assert.throws(() => $('exportSpecFor({name: "P", objects: []})'), /objects/);
  assert.throws(() => $('exportSpecFor({name: "P", origin: "milieu"})'), /origin/);
});

test('l\'addon Blender : cleanup ne lisse plus par défaut, rename existe, iso sait cadrer une cible', () => {
  const py = read('outils/blender-addon/evaveo_blender_bridge/production.py');
  assert.ok(!/s\.get\('smooth',True\)/.test(py), 'cleanup lisse encore par défaut');
  assert.match(py, /if 'smooth' in s:shading=/);
  assert.match(py, /if action=='rename':return rename_object/);
  assert.match(py, /zs=number\(s\.get\('z_scale',1 if target else/);
  assert.match(py, /pick_named\(items,s\['objects'\]\)/);
  const js = read('js/copilot-blender.js');
  assert.match(js, /'cleanup', 'origin', 'rename'\]/);
});

// ---------- 8. ombre d'une directionnelle, sol de l'hémisphère ----------
test('ombre d\'une directionnelle : réglages imposés, sinon automatiques', () => {
  const ShadowFit = new Function(deEsm(read('js/shadow-fit.js')) + '; return ShadowFit;')();
  const auto = ShadowFit.lightSettings(undefined, 2048, 30);
  assert.equal(auto.mapSize, 2048);
  assert.equal(auto.radius, 30);
  assert.equal(auto.bias, ShadowFit.depthBias(60 / 2048));
  const forced = ShadowFit.lightSettings({shadowMapSize: 4096, shadowExtent: 12, shadowBias: -0.001}, 2048, 30);
  assert.deepEqual([forced.mapSize, forced.radius, forced.bias], [4096, 12, -0.001]);
  assert.equal(forced.texel, 24 / 4096);
  assert.deepEqual(ShadowFit.toolFields({shadowMapSize: 0, shadowExtent: 20, shadowBias: 'auto'}),
    {shadowMapSize: null, shadowExtent: 20, shadowBias: null});
  assert.equal(ShadowFit.toolFields({shadowMapSize: 100000}).shadowMapSize, 8192);
  assert.throws(() => ShadowFit.toolFields({shadowBias: 3}), /shadowBias/);
  // Éditeur et jeu passent par le MÊME calcul.
  for(const f of ['js/scene.js', 'js/game-runtime.js']){
    assert.match(read(f), /ShadowFit\.lightSettings\(l\.userData\.shadowSettings/, f + ' ignore les réglages de la lumière');
  }
});

test('environnement : les clés de configure_environment atteignent le format, le sol de l\'hémisphère aussi', () => {
  const calls = [];
  const $ = load(['js/environment.js'],
    'var THREE = {Color: function(c){ this.c = c; }, Fog: function(){}};'
    + 'var hemi = {color: {set: function(v){ calls.push(["sky", v]); }}, groundColor: {set: function(v){ calls.push(["ground", v]); }}};'
    + 'var sun = {}; var scene = {}; var assets = []; var calls = [];');
  const keys = host($('ENV_TOOL_KEYS'));
  const defaults = host($('ENV_DEFAULT'));
  for(const k of Object.keys(keys)) assert.ok(keys[k] in defaults, k + ' → ' + keys[k] + ' n\'est pas une clé du format');
  assert.equal(defaults.ambientGroundColor, '#30281e');
  // Une scène d'avant le champ : le défaut s'applique, sans migration.
  $('applyEnvironment({sky: "color", skyColor: "#000000", brouillard: false, ambianteColor: "#ffffff"})');
  const got = host($('calls'));
  assert.deepEqual(got.find((c) => c[0] === 'ground'), ['ground', '#30281e']);
  $('calls.length = 0; applyEnvironment({sky: "color", brouillard: false, ambientGroundColor: "#112233"})');
  assert.deepEqual(host($('calls')).find((c) => c[0] === 'ground'), ['ground', '#112233']);
});
