// moteur/test/mcp-real-path.test.mjs
//
// v0.191.1 — les correctifs de la v0.191.0 testaient la fonction pure ; la revérification par MCP
// a montré que les bugs persistaient. Ces tests passent par le CHEMIN RÉEL : l'outil du copilote
// (son `exec`, tel que MCP l'appelle), puis la sérialisation des composants, puis ce que lit le jeu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { creerContexte, deEsm } from './engine-env.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const run = (ctx, f) => vm.runInContext(deEsm(read(f)), ctx, { filename: f });

/** Le moteur d'édition juste assez complet pour exécuter les outils du copilote. */
function engine(){
  const ctx = creerContexte(['js/component-registry.js', 'js/component.js', 'js/node.js', 'js/component-data.js',
    'js/camera-framing.js', 'js/sprite-2d.js', 'js/components/component-camera.js',
    'js/components/component-camera-follow.js', 'js/component-migration.js', 'js/components/component-script.js']);
  vm.runInContext('var LAYER_HELPERS = 31; var scene = new THREE.Scene();'
    + ' function updateHierarchy(){} function select(){} function removeHelper(){}'
    + ' var activeCam = null; function quitViewCamera(){}', ctx);
  run(ctx, 'js/objects.js');
  run(ctx, 'js/scripts.js');
  ['js/ai-rules.js', 'js/ai-guidelines.js', 'js/copilot-budget.js', 'js/copilot-inspect.js', 'js/copilot.js',
   'js/copilot-workshop.js'].forEach((f) => run(ctx, f));
  // Les effets de bord d'éditeur (historique, inspecteur, disque) ne sont pas ce qu'on mesure.
  vm.runInContext(`
    // Le bac d'engine-env partage UN tableau assets entre contextes : on le vide.
    assets.length = 0;
    function slugFile(n){ return String(n); }
    function pushHistory(){} function updateProject(){} function enforceScriptAssets(){ return ''; }
    function buildInspector(){} function syncInspector(){} function rebuildMeshSprite(){}
    function refreshSpritesOfLAsset(){} function moveAssetTo(){}
    function isValidated(){ return false; }
    project.settings = {validatedAssets: []};
    var _assetSeq = 0;
    function createAssetTexture(file, o){ const a = {id: 'tex' + (++_assetSeq), kind: 'texture', name: o.name}; assets.push(a); return a; }
    function createAssetSprite(tex, name){ const a = {id: 'spr' + (++_assetSeq), kind: 'sprite', name: name, textureId: tex.id, ppu: 100, regions: []}; assets.push(a); return a; }
    function replaceContentAssetTexture(a, file){ a.replaced = (a.replaced || 0) + 1; }
    function removeAsset(a){ assets.splice(assets.indexOf(a), 1); }
    function ensureParamsImport(){ return {}; }
    function newAssetScript(name, code){ const a = {id: 'scr' + (++_assetSeq), kind: 'script', name: name, code: code}; assets.push(a); return a; }
    function tool(name, args){ return CopilotTools.get(name).exec(args); }
    var XRRuntime = { api: {} };
    function nodesByTag(){ return []; }
  `, ctx);
  ctx.atob = (b64) => Buffer.from(b64, 'base64').toString('binary');
  return ctx;
}

/** Un PNG minimal (signature + IHDR) : `decodePngBase64` n'en lit que la largeur et la hauteur. */
function pngBase64(w, h){
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b.toString('base64');
}

test('n° 4 — configure_camera_2d → sérialisation → cadrage du jeu : la caméra RENDUE est cadrée', () => {
  const ctx = engine();
  const r = vm.runInContext(`
    // Deux caméras 2D : la première du tableau n'est PAS la principale (la scène en avait une, une
    // seconde a été créée et désignée). Le jeu rend par la principale (rtCameraMain).
    const autre = createSceneNode({ name: 'Ancienne', silent: true,
      components: [{ type: 'Camera', data: { projection: 'orthographic' } }] });
    const cam = createSceneNode({ name: 'Cam2D', silent: true,
      components: [{ type: 'Camera', data: { projection: 'orthographic' } }] });
    tool('configure_camera', { name: 'Cam2D', main: true });
    const msg = tool('configure_camera_2d', { mode: 'fixed', ratio: 2, ppu: 24 });
    // Ce que le fichier de scène transporte, puis ce que le jeu reconstruit (même code partagé).
    // Miroir de componentEntriesOf (js/serialization.js) : ce que serializeObject écrit.
    const entries = JSON.parse(JSON.stringify(cam.userData.components.map(function(c){
      return { type: c.constructor.typeName, data: c.serialize(), active: c.active !== false };
    })));
    const inGame = createSceneNode({ name: 'Cam2D', silent: true, components: entries });
    frameOrthoCamera(ed(inGame).cam, cameraSettingOf(inGame), 1200, 675);
    JSON.stringify({ top: ed(inGame).cam.top, main: isCameraMain(inGame), autreMain: isCameraMain(autre),
      autrePP: autre.getComponent('Camera').pixelPerfect, msg: msg });
  `, ctx);
  const o = JSON.parse(r);
  assert.ok(Math.abs(o.top - 675 / (2 * 24 * 2)) < 1e-9, 'cam.top = ' + o.top + ' au lieu de 7,03 — ' + o.msg);
  assert.equal(o.main, true, 'la principale doit survivre à la sérialisation (composant Camera.main)');
  assert.equal(o.autreMain, false);
  assert.equal(o.autrePP, false, 'sans nom, la commande règle la caméra PRINCIPALE, pas la première du tableau');
});

test('n° 4 — le jeu suit la THREE.Camera courante du nœud principal', () => {
  const src = read('js/game-runtime.js');
  assert.match(src, /function rtSyncCameraMain\(\)/);
  assert.match(src, /rtSyncCameraMain\(\);\s*\n\s*applyMeasureCamera/);
});

test('n° 26 — configure_sprite {depthSort:true} pose sortDepth, et la réponse le montre', () => {
  const ctx = engine();
  const r = vm.runInContext(`
    const s = createSceneNode({ name: 'Arbre', silent: true });
    s.userData.sprite2d = { spriteId: null, region: '', layer: 'Jeu', order: 0, teinte: '#ffffff',
      retourneX: false, retourneY: false, sortDepth: false };
    const msg = tool('configure_sprite', { name: 'Arbre', depthSort: true, flipX: true, tint: '#ff0000' });
    JSON.stringify({ d: s.userData.sprite2d, msg: msg });
  `, ctx);
  const o = JSON.parse(r);
  assert.equal(o.d.sortDepth, true);
  assert.equal(o.d.retourneX, true);
  assert.equal(o.d.teinte, '#ff0000');
  assert.match(o.msg, /"sortDepth":true/);
});

test('n° 10 — slice_sheet : ppu automatique = la tuile, ppu explicite appliqué', () => {
  const ctx = engine();
  const r = vm.runInContext(`
    // Planche importée en cases de 26 px (import_image cell) : ppu automatique 26.
    const tex = { id: 'T', kind: 'texture', name: 'tuiles', dimensionsSource: [26 * 4, 26 * 2] };
    const sh = { id: 'S', kind: 'sprite', name: 'tuiles', textureId: 'T', ppu: 26,
      regions: sliceGrid(104, 52, 26, 26, {}) };
    assets.push(tex, sh);
    tool('slice_sheet', { sheet: 'tuiles', cell: { l: 24, h: 24 }, margin: 1, spacing: 2 });
    const auto = sh.ppu;
    tool('slice_sheet', { sheet: 'tuiles', cell: { l: 24, h: 24 }, margin: 1, spacing: 2, ppu: 32 });
    const explicit = sh.ppu;
    // Un ppu RÉGLÉ À LA MAIN (ni défaut, ni case précédente) n'est pas touché par une redécoupe.
    tool('slice_sheet', { sheet: 'tuiles', cell: { l: 24, h: 24 }, margin: 1, spacing: 2 });
    JSON.stringify({ auto: auto, explicit: explicit, kept: sh.ppu, n: sh.regions.length });
  `, ctx);
  const o = JSON.parse(r);
  assert.equal(o.auto, 24);
  assert.equal(o.explicit, 32);
  assert.equal(o.kept, 32);
  assert.ok(o.n > 0);
});

test('n° 12 — replace_script / write_script_asset : les porteurs reçoivent les nouvelles clés @vars', () => {
  const ctx = engine();
  const r = vm.runInContext(`
    assets.push({ id: 's1', kind: 'script', name: 'Mob', code: '/* @vars {"a": 1} */\\nfunction update(api){}' });
    const m1 = createSceneNode({ name: 'Mob1', components: [{ type: 'ScriptJS', data: { scriptId: 's1' } }] });
    const m2 = createSceneNode({ name: 'Mob2', components: [{ type: 'ScriptJS', data: { scriptId: 's1' } }] });
    mergeVarsDeclared(m1, assets[0].code); mergeVarsDeclared(m2, assets[0].code);
    tool('set_script_vars', { name: 'Mob2', values: { a: 9 } });
    tool('replace_script', { name: 'Mob1', code: '/* @vars {"a": 5, "b": 2} */\\nfunction update(api){}' });
    const afterReplace = JSON.parse(JSON.stringify([m1.userData.game.props, m2.userData.game.props]));
    tool('write_script_asset', { name: 'Mob', code: '/**\\n * @expose vitesse {number} = 3\\n */\\n/* @vars {"a": 5, "b": 2, "c": "x"} */\\nfunction update(api){}' });
    JSON.stringify({ afterReplace: afterReplace, m1: m1.userData.game.props, m2: m2.userData.game.props,
      expose: m2.getComponent('ScriptJS').values });
  `, ctx);
  const o = JSON.parse(r);
  assert.deepEqual(o.afterReplace, [{ a: 1, b: 2 }, { a: 9, b: 2 }], 'l\'existant est gardé, la nouvelle clé arrive');
  assert.deepEqual(o.m1, { a: 1, b: 2, c: 'x' });
  assert.deepEqual(o.m2, { a: 9, b: 2, c: 'x' });
  assert.equal(o.expose.vitesse, 3, 'les @expose nouvelles arrivent aussi dans les values du composant');
});

test('n° 8bis — import_image avec cell sur un asset existant : même texture, même planche, redécoupée', () => {
  const ctx = engine();
  const r = vm.runInContext(`
    tool('import_image', { name: 'arbre', png: '${pngBase64(96, 64)}', cell: { l: 48, h: 64 } });
    const tex = assets.find(function(x){ return x.kind === 'texture'; });
    const sh = assets.find(function(x){ return x.kind === 'sprite'; });
    const ids = [tex.id, sh.id];
    const msg = tool('import_image', { name: 'arbre', png: '${pngBase64(144, 64)}', cell: { l: 48, h: 64 } });
    JSON.stringify({ ids: ids, msg: msg,
      textures: assets.filter(function(x){ return x.kind === 'texture'; }).map(function(x){ return x.id; }),
      sheets: assets.filter(function(x){ return x.kind === 'sprite'; }).map(function(x){ return x.id; }),
      regions: sh.regions.length, replaced: tex.replaced || 0 });
  `, ctx);
  const o = JSON.parse(r);
  assert.deepEqual(o.textures, [o.ids[0]], 'une seule texture, celle d\'origine : ' + o.msg);
  assert.deepEqual(o.sheets, [o.ids[1]], 'une seule planche, celle d\'origine');
  assert.equal(o.replaced, 1);
  assert.equal(o.regions, 3, 'la planche existante est redécoupée sur la nouvelle image');
});

test('n° 8bis — `replace` et `ppu` sont déclarés au schéma d\'import_image', () => {
  const ctx = engine();
  const props = vm.runInContext('Object.keys(CopilotTools.get("import_image").schema.properties)', ctx);
  assert.ok(props.indexOf('replace') !== -1);
  assert.ok(props.indexOf('ppu') !== -1);
});

test('n° 25 — visible=false n\'arrête pas les scripts ; seul l\'état actif (api.setActive) le fait', () => {
  const ctx = engine();
  vm.runInContext(`
    function resetAudioMix(){} function initEventsVisuals(){} function startAudioGame(){} function navReset(){}
    function networkActive(){ return false; } function runEventsVisuals(){} function evaluateContacts(){}
    function codeTrusted(){ return true; } function logConsole(k, m){ globalThis._logs = (globalThis._logs || []).concat(m); } function setStatus(){} var networkIsAuthority = function(){ return {}; }; var networkHandle = function(){ return {}; };
    function compileScript(body, tail){ const f = new Function('api', body + (tail || '')); return function(api){ return f(api); }; }
  `, ctx);
  const r = vm.runInContext(`
    assets.push({ id: 'k', kind: 'script', name: 'Compteur', code: 'function update(api){ api.me.userData.n = (api.me.userData.n || 0) + 1; }' });
    const parent = createSceneNode({ name: 'Parent' });
    const o = createSceneNode({ name: 'Cache', components: [{ type: 'ScriptJS', data: { scriptId: 'k' } }] });
    parent.add(o);
    o.visible = false;
    let ran;
    try { runScripts(1 / 60); ran = o.userData.n || 0; } catch(e){ ran = 'ERR ' + e.message; }
    parent.userData.activeVoulu = false;              // api.setActive(parent, false)
    try { runScripts(1 / 60); } catch(e){}
    JSON.stringify({ logs: globalThis._logs, ran: ran, afterInactive: o.userData.n || 0, active: isActiveInHierarchy(o) });
  `, ctx);
  const o = JSON.parse(r);
  assert.equal(o.ran, 1, 'un objet masqué doit continuer d\'exécuter ses scripts — ' + JSON.stringify(o.logs));
  assert.equal(o.afterInactive, 1, 'un parent inactif arrête les scripts de ses enfants');
  assert.equal(o.active, false);
  assert.match(read('js/game-runtime.js'), /!isSceneObject\(o\) \|\| !isActiveInHierarchy\(o\)/);
});
