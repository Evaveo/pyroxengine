// moteur/test/ai-rules.test.mjs
//
// LES RÈGLES DE L'IA NE SONT PAS QUE DES PHRASES : le registre (js/ai-rules.js) fournit leur texte,
// et chaque garde du moteur (lint, audit, handlers) doit tirer son message de lui. Ce test garde
// que (1) le registre est cohérent, (2) les instructions de départ portent les règles critiques,
// (3) les messages du lint et de l'audit sont ceux du registre, (4) tout outil enregistré a un
// domaine ou est du noyau.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AI_RULES, ruleById, ruleText, ruleMessage, rulesOfLevel } from '../js/ai-rules.js';
import { engineRules, mcpInstructions } from '../js/ai-guidelines.js';
import { lintScriptAssets } from '../js/script-asset-lint.js';
import { auditProject } from '../js/project-audit.js';
import { CORE_TOOLS, TOOL_DOMAINS, domainOfTool } from '../js/copilot-budget.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('le registre est cohérent : ids uniques en anglais, niveaux connus, texte non vide', () => {
  const seen = new Set();
  for(const r of AI_RULES){
    assert.match(r.id, /^[a-z]+(\.[a-z0-9_]+)+$/, r.id + ' : id mal formé');
    assert.ok(!seen.has(r.id), r.id + ' en double');
    seen.add(r.id);
    assert.ok(['block', 'warn', 'audit'].includes(r.level), r.id + ' : niveau inconnu');
    assert.ok(r.text.length > 20, r.id + ' : texte vide');
  }
  assert.equal(ruleById('nope'), null);
  assert.throws(() => ruleText('nope'), /règle inconnue/);
  assert.match(ruleMessage('assets.folder'), /^règle assets\.folder : /);
  assert.ok(rulesOfLevel('block').length >= 5);
});

test('les instructions de départ portent les règles Blender critiques et l outil manquant', () => {
  for(const t of [engineRules(''), mcpInstructions()]){
    assert.ok(t.includes(ruleText('blender.edit_existing')));
    assert.ok(t.includes(ruleText('blender.no_import_unvalidated')));
    assert.ok(t.includes(ruleText('blender.no_smooth')));
    assert.ok(t.includes(ruleText('tools.missing_tool')));
  }
});

test('le lint des scripts tire ses messages du registre', () => {
  const r = lintScriptAssets("var a = 'data:image/png;base64,AAAA';");
  assert.deepEqual(r.blocking, [ruleText('scripts.no_base64')]);
  const l = lintScriptAssets("var s = new THREE.PointLight(0xffffff);");
  assert.deepEqual(l.blocking, [ruleText('scripts.no_lights')]);
});

test('l audit tire ses messages du registre', () => {
  const code = 'function start(api){\n  for(var i=0;i<9;i++){ api.create("PF", [i,0,0]); }\n}\n';
  const r = auditProject({scripts: [{name: 'S', folder: 'Scripts', code: code, holders: 1}], objects: [], assets: [{kind: 'model', name: 'M', folder: ''}]});
  assert.ok(r.issues.some((i) => i.text.includes(ruleText('scripts.no_level_in_start'))));
  assert.ok(r.issues.some((i) => i.text.includes(ruleText('assets.folder'))));
});

test('tout outil enregistré appartient à un domaine ou au noyau, sans doublon', () => {
  const names = new Set();
  for(const f of fs.readdirSync(path.join(ROOT, 'js')).filter((x) => /^copilot.*\.js$/.test(x))){
    for(const m of read('js/' + f).matchAll(/^\s{2,4}name:\s*'([a-z][a-z0-9_]+)'/gm)) names.add(m[1]);
  }
  const orphans = [...names].filter((n) => !CORE_TOOLS.includes(n) && domainOfTool(n) === null);
  // Un outil sans domaine est envoyé à chaque requête sans que personne l'ait décidé.
  assert.deepEqual(orphans, [], 'outils hors noyau et hors domaine : ' + orphans.join(', '));
  const inDomains = Object.values(TOOL_DOMAINS).flatMap((d) => d.tools);
  assert.equal(new Set(inDomains).size, inDomains.length, 'un outil figure dans deux domaines');
});

test('post-contrôle : asset à la racine, objet en vrac, nom générique, rappel de sauvegarde', async () => {
  const { checkAfterWrite, formatViolations, noteWrite, noteSave, recordViolation, violationCounts, resetViolations, SAVE_REMINDER_AFTER }
    = await import('../js/ai-rules.js');
  assert.deepEqual(checkAfterWrite({newObjects: [], newAssets: []}), []);
  const v = checkAfterWrite({
    newObjects: [{name: 'Cube 12', depth: 0, isGroup: false, generic: true}, {name: 'Environnement', depth: 0, isGroup: true, generic: false}],
    newAssets: [{kind: 'model', name: 'Renard', folder: ''}, {kind: 'prefab', name: 'PF', folder: 'Prefabs'}]
  });
  assert.deepEqual(v.map((x) => x.id), ['assets.folder', 'scene.root_object', 'scene.generic_name']);
  assert.match(formatViolations(v), /^ ⚠ règle assets\.folder : .*« Renard »/);
  assert.equal(formatViolations([]), '');
  // un groupe posé à la racine est légitime ; le rappel tombe tous les SAVE_REMINDER_AFTER outils
  assert.deepEqual(checkAfterWrite({newObjects: [{name: 'Lumières', depth: 0, isGroup: true}], newAssets: []}), []);
  assert.deepEqual(checkAfterWrite({writes: SAVE_REMINDER_AFTER}).map((x) => x.id), ['project.save']);
  assert.deepEqual(checkAfterWrite({writes: SAVE_REMINDER_AFTER + 1}), []);
  resetViolations();
  noteWrite(); noteWrite();
  assert.equal(noteWrite(), 3);
  noteSave();
  assert.equal(noteWrite(), 1);
  recordViolation('assets.folder'); recordViolation('assets.folder');
  assert.deepEqual(violationCounts(), {'assets.folder': 2});
  resetViolations();
});

test('copRun applique le post-contrôle, hors outils de lecture et hors sous-commandes de batch', () => {
  const src = read('js/copilot.js');
  assert.match(src, /READ_ONLY_TOOLS\.indexOf\(name\) === -1/);
  assert.match(src, /o\.origin !== 'batch'/);
  assert.match(src, /checkAfterWrite\(/);
});

test('audit renforcé : modèles/prefabs hors dossier, lumières en code, asset validé modifié, infractions de session', async () => {
  const { formatGraveIssues } = await import('../js/project-audit.js');
  const r = auditProject({
    scripts: [{name: 'Decor', folder: 'Scripts', code: 'function start(api){ var l = new THREE.PointLight(0xffffff); }', holders: 1}],
    objects: [],
    assets: [{kind: 'model', name: 'Renard', folder: 'Persos'}, {kind: 'prefab', name: 'PF', folder: 'Prefabs/Ennemis'},
      {kind: 'model', name: 'Arbre', folder: 'Models/Decor', validated: true, changedSinceValidation: true}],
    violations: {'assets.folder': 3}
  });
  const texts = r.issues.map((i) => i.level + ' ' + i.text).join('\n');
  assert.match(texts, /1 model\(s\) hors de Models\//);
  assert.doesNotMatch(texts, /prefab\(s\) hors/);
  assert.match(texts, /grave le script « Decor » crée des lumières en code/);
  assert.match(texts, /grave l'asset validé « Arbre » a été modifié/);
  assert.match(texts, /règle assets\.folder signalée 3 fois/);
  const g = formatGraveIssues(r);
  assert.match(g, /^\n✗ audit : 2 point\(s\) grave\(s\)/);
  assert.equal(formatGraveIssues({issues: [{level: 'attention', text: 'x'}]}), '');
});

test('save_project et play_and_measure portent les points graves de l audit', () => {
  assert.match(read('js/copilot.js'), /name === 'save_project' \|\| name === 'play_and_measure'/);
  assert.match(read('js/copilot-workshop.js'), /CopilotTools\.auditGrave = /);
});
