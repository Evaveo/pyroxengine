// Le savoir-faire de l'IA (js/ai-guidelines.js) : UNE source pour le copilote intégré et pour le
// pont MCP. Ce test garde trois choses : le module reste pur (le pont l'importe sous node), les
// outils qu'il cite existent (une règle qui nomme un outil disparu fait tâtonner l'IA), et le
// copilote lit bien le même texte que le pont.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GUIDES, LIVE_RESOURCES, RECIPES, engineRules, knowledgePayload, mcpInstructions, renderRecipe }
  from '../js/ai-guidelines.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

// Les noms de commande déclarés par l'éditeur (`name: 'xxx'` dans les fichiers du copilote).
function commandNames(){
  const names = new Set();
  for(const f of fs.readdirSync(path.join(ROOT, 'js')).filter((x) => /^copilot.*\.js$/.test(x))){
    for(const m of read('js/' + f).matchAll(/\bname:\s*'([a-z][a-z0-9_]+)'/g)) names.add(m[1]);
  }
  return names;
}

test('module pur : le seul import est le registre pur ai-rules.js', () => {
  const imports = [...read('js/ai-guidelines.js').matchAll(/^\s*import\s.*$/gm)].map((m) => m[0]);
  assert.equal(imports.length, 1);
  assert.match(imports[0], /from '\.\/ai-rules\.js'/);
  assert.doesNotMatch(read('js/ai-rules.js'), /^\s*import\s/m);
});

test('les instructions MCP portent la méthode et la règle des assets, sans éditeur', () => {
  const t = mcpInstructions();
  assert.match(t, /RÈGLE DES ASSETS/);
  assert.match(t, /MÉTHODE — construis PAR ÉTAPES/);
  assert.match(t, /Pas de « GameManager » qui fait tout/);
  assert.match(t, /@vars/);
  assert.match(t, /editeur3d:\/\/guide\//);
});

test('chaque outil cité dans les règles, guides, ressources et recettes existe', () => {
  const known = commandNames();
  known.add('editor_status');           // outil du pont lui-même
  const texts = [mcpInstructions()].concat(GUIDES.map((g) => g.text()), RECIPES.map((r) => r.template));
  const cited = new Set();
  for(const t of texts){
    // un identifiant snake_case d'au moins deux mots qui ressemble à une commande
    for(const m of t.matchAll(/\b([a-z]+(?:_[a-z0-9]+)+)\b/g)) cited.add(m[1]);
  }
  LIVE_RESOURCES.forEach((r) => cited.add(r.tool));
  const missing = [...cited].filter((n) => !known.has(n));
  assert.deepEqual(missing, [], 'outils cités mais absents du catalogue : ' + missing.join(', '));
});

test('le copilote intégré lit les mêmes règles que le pont', () => {
  const src = read('js/copilot.js');
  assert.match(src, /import \{ engineRules \} from '\.\/ai-guidelines\.js'/);
  assert.match(src, /\+ engineRules\(describeDomains\(\)\)/);
  // et le corps n'a pas été recopié à côté
  assert.doesNotMatch(src, /RÈGLE DES ASSETS — le créateur/);
  assert.ok(engineRules('- 2d : x').includes('- 2d : x'));
});

test('recettes : trous remplis, argument absent signalé', () => {
  const r = RECIPES.find((x) => x.name === 'ajouter_comportement');
  const t = renderRecipe(r, {objet: 'Joueur'});
  assert.match(t, /« Joueur »/);
  assert.match(t, /à préciser/);
  assert.doesNotMatch(t, /\{\w+\}/);
});

test('knowledgePayload est du JSON pur (le relais cloud le reçoit tel quel)', () => {
  const k = knowledgePayload();
  const back = JSON.parse(JSON.stringify(k));
  assert.deepEqual(back, k);
  assert.equal(k.guides.length, GUIDES.length);
  assert.ok(k.guides.every((g) => /^[\w-]+$/.test(g.id) && g.text.length > 100));
  assert.ok(k.prompts.every((p) => /^\w+$/.test(p.name)));
});
