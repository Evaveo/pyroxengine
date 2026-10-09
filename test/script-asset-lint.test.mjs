// Un script est du COMPORTEMENT, pas du contenu (js/script-asset-lint.js), et les outils qui font du
// contenu des assets existent (fin de js/copilot-workshop.js). Né d'un jeu façon Age of Empires dont
// tout le contenu tenait dans un script de 180 000 caractères.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintScriptAssets, enforceScriptAssets, SCRIPT_LINES_MAX } from '../js/script-asset-lint.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');

test('UN SCRIPT DE COMPORTEMENT passe sans un mot', () => {
  const code = 'function update(api){\n  if(api.key("ArrowLeft")) api.me.position.x -= 3 * api.dt;\n  api.playSound("saut");\n}\n';
  assert.deepEqual(lintScriptAssets(code), {blocking: [], warnings: []});
  assert.equal(enforceScriptAssets(code), '');
});

test('UN FICHIER EN BASE64 dans un script est REFUSÉ', () => {
  assert.throws(() => enforceScriptAssets('const img = "data:image/png;base64,iVBORw0KGgo=";'), /import_image/);
  assert.throws(() => enforceScriptAssets('const s = "data:audio/wav;base64,UklGR";'), /ASSETS/);
});

test('DESSINER SUR UN CANEVAS, SYNTHÉTISER DU SON : refusé', () => {
  assert.throws(() => enforceScriptAssets('const c = document.createElement("canvas"); const x = c.getContext("2d"); x.fillRect(0,0,4,4);'), /create_texture/);
  assert.throws(() => enforceScriptAssets('const ac = new AudioContext(); ac.createOscillator();'), /create_sfx/);
});

test('UN SCRIPT MONOLITHIQUE est refusé, un gros script est signalé', () => {
  const big = Array(SCRIPT_LINES_MAX + 5).fill('x++;').join('\n');
  assert.throws(() => enforceScriptAssets(big), /lignes/);
  assert.match(enforceScriptAssets(Array(400).fill('x++;').join('\n')), /⚠/);
});

test('UNE TABLE DE CONTENU EN LITTÉRAL est signalée vers create_data', () => {
  const rows = Array.from({length: 15}, (_, i) => `  u${i}: {name: 'U${i}', hp: ${i}, atk: 2, speed: 1},`).join('\n');
  const r = lintScriptAssets('const UNITS = {\n' + rows + '\n};');
  assert.equal(r.blocking.length, 0);
  assert.ok(r.warnings.some((w) => /create_data/.test(w)), r.warnings.join(' | '));
});

test('attach_script ET replace_script passent par le contrôle', () => {
  const c = read('js/copilot.js');
  const n = (c.match(/\bwarn = enforceScriptAssets\(a\.code\)/g) || []).length;
  assert.equal(n, 2, 'les deux commandes qui écrivent un script doivent appeler enforceScriptAssets');
  // La règle vit dans js/ai-guidelines.js, que COPILOT_SYSTEM inclut (et le pont MCP aussi).
  assert.match(read('js/ai-guidelines.js'), /RÈGLE DES ASSETS/, 'la règle doit être dite au modèle AVANT que le refus tombe');
  assert.match(c, /engineRules\(/);
});

test('LES OUTILS DE CONTENU sont enregistrés et rangés dans un domaine', () => {
  const w = read('js/copilot-workshop.js'), b = read('js/copilot-budget.js');
  for(const name of ['create_material', 'import_model', 'import_audio', 'read_data', 'write_animation', 'read_asset']){
    assert.match(w, new RegExp("name: '" + name + "'"), name + ' absent de copilot-workshop.js');
    assert.match(b, new RegExp("'" + name + "'"), name + ' absent des domaines (copilot-budget.js)');
  }
});

test('UNE LUMIÈRE CRÉÉE EN CODE est REFUSÉE (Zeldo : soleil et feux créés par les scripts)', () => {
  const w = lintScriptAssets('function start(api){ var s = new THREE.DirectionalLight(0xffffff, 1); api.me.add(s); }').blocking;
  assert.ok(w.some((x) => /lumières en code/.test(x.msg || x)), JSON.stringify(w));
  assert.deepEqual(lintScriptAssets('function update(api){ var l = api.find("Feu_Lumiere"); l.intensity = 2; }').warnings, []);
});

test('UN NIVEAU GÉNÉRÉ EN BOUCLE DANS start est REFUSÉ ; api.create hors de start reste permis', () => {
  const NL = String.fromCharCode(10);
  const src = (lines) => lines.join(NL) + NL;
  const loop = src(['function start(api){', '  for(var i = 0; i < 9; i++){ api.create("Mur", [i, 0, 0]); }', '}']);
  assert.ok(lintScriptAssets(loop).blocking.some((x) => /en boucle dans start/.test(x)), 'boucle de création dans start');
  const shot = src(['function update(api){', '  if(api.key("Space")){ api.create("Tir", [0, 1, 0]); }', '}']);
  assert.deepEqual(lintScriptAssets(shot).blocking, []);
  const fewInStart = src(['function start(api){', '  api.create("Joueur", [0, 0, 0]);', '}']);
  assert.deepEqual(lintScriptAssets(fewInStart).blocking, []);
});

test('BUGS_MOTEUR § 16 : une PETITE boucle bornée dans start passe, une grande ou non bornée est refusée', async () => {
  const { spawnsLevelInStart } = await import('../js/script-asset-lint.js');
  const ui = 'function start(api){\n  for (let i = 0; i < 4; i++) api.create("Bouton", [i, 0, 0]);\n}\n';
  assert.equal(spawnsLevelInStart(ui), false);
  assert.deepEqual(lintScriptAssets(ui).blocking, []);
  assert.equal(spawnsLevelInStart('function start(api){\n  for (let i = 0; i <= 8; i++) api.create("A");\n}\n'), true);
  assert.equal(spawnsLevelInStart('function start(api){\n  for (let i = 0; i < 200; i++) api.create("A");\n}\n'), true);
  assert.equal(spawnsLevelInStart('function start(api){\n  for (let i = 0; i < n; i++) api.create("A");\n}\n'), true);
  assert.equal(spawnsLevelInStart('function start(api){\n  while (k--) api.create("A");\n}\n'), true);
});
