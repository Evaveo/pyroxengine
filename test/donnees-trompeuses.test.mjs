import { HELP_SCRIPTS, readHelpSource } from './help-env.mjs';
import { deEsm } from './engine-env.mjs';
// Lot C de la revue du 2026-09-29 (docs/REVUE_2026-09-29.md, § 1.5, 1.6, 1.8, 1.9, 2.3) : ce que
// l'éditeur ou le copilote AFFIRMAIENT et qui était faux. Chaque garde vise une affirmation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');

test('§ 1.6 — le copilote ne propose que des actions que les deux moteurs exécutent', () => {
  const copilot = read('js/copilot.js');
  const liste = copilot.match(/EVENT_ACTION_TYPES = \[([\s\S]*?)\]/)[1].match(/'([^']+)'/g).map((s) => s.slice(1, -1));
  // La table de l'inspecteur fait foi : elle nomme ce que l'utilisateur peut choisir.
  const table = read('js/ui/panels-components.js').match(/EVENT_THEN = \[([\s\S]*?)\n\];/)[1];
  const types = Array.from(table.matchAll(/\['([a-zA-Z]+)',/g), (m) => m[1]);
  assert.deepEqual(liste, types, 'EVENT_ACTION_TYPES (copilote) et EVENT_THEN (inspecteur) divergent');
  // Chaque type est un `case` des deux moteurs.
  for(const f of ['js/events.js', 'js/game-runtime.js']){
    const src = read(f);
    for(const t of types) assert.ok(src.includes("case '" + t + "'"), f + ' ne sait pas exécuter « ' + t + ' »');
    assert.ok(/default:\s*\n?\s*[^\n]*action inconnue/.test(src), f + ' doit dire une action inconnue');
  }
  // La description n'enseigne plus les anciens noms.
  // `\r?\n` : même piège CRLF que test/performance-lot-e.test.mjs. Sans lui, `match` rend `null`
  // et le test tombe sur un TypeError qui ne désigne rien — on cherche la panne dans le copilote.
  const desc = copilot.match(/name: 'add_event',\s*\/\/[\s\S]*?description: '([^\r\n]*)',\r?\n/)[1];
  for(const ancien of ['cacher', 'basculer', 'detruire', 'emettre', 'attendre']){
    assert.ok(!new RegExp('\\b' + ancien + '\\b').test(desc), 'la description cite encore « ' + ancien + ' »');
  }
  assert.ok(/type: \{type: 'string', enum: EVENT_ACTION_TYPES\}/.test(copilot), 'le type d action doit être une énumération');
});

test('§ 1.8 — l aide et le copilote documentent l API qui existe', () => {
  const aide = readHelpSource();
  for(const faux of ['poserFlottant', 'poserEntier', 'declencher(', 'an.lire(', 'an.rejouer(', 'an.etat', '.valeurs</code>']){
    assert.ok(!aide.includes(faux), 'l aide cite encore « ' + faux + ' »');
  }
  assert.ok(!/uiDocument\([^)]*\)\.valeurs/.test(read('js/copilot.js')), 'le copilote enseigne encore .valeurs');
  // Et ce qu'elle cite existe bien.
  const animator = read('js/animator.js');
  for(const vrai of ['setFloat', 'setInt', 'setBool', 'setTrigger', 'restart']){
    assert.ok(animator.includes(vrai + ':'), vrai + ' n existe pas dans js/animator.js');
  }
  assert.ok(/o\.weight/.test(read('js/anim-models.js')) && /\{depuis, weight, speed, fondu\}/.test(aide));
});

test('§ 1.8 — le dialogue de paramètre de l Animator accepte les mots qu il affiche', () => {
  const src = read('js/animator-graph.js');
  assert.ok(/flottant: 'float', entier: 'int', booleen: 'bool', declencheur: 'trigger'/.test(src));
});

test('§ 1.5 — Suppr, Retour arrière et Espace sur un bouton n agissent pas sur la scène', () => {
  const src = read('js/viewport.js');
  const garde = src.indexOf("const surBouton = e.target.tagName === 'BUTTON'");
  const suppr = src.indexOf("&& selection) deleteSelection()");
  const espace = src.indexOf("if(e.key === ' '){");
  assert.ok(garde !== -1, 'la garde des boutons manque');
  assert.ok(garde < suppr && garde < espace, 'la garde doit passer AVANT la suppression et la lecture');
});

test('§ 1.9 — supprimer un asset en mode dossier se confirme ; § 2.3 — le bandeau échappe ses noms', () => {
  const assets = read('js/assets.js');
  assert.ok(/project\.handleFolder && !confirm\('Supprimer « /.test(assets));
  const lock = read('js/scene-lock.js');
  assert.ok(/const scene = escapeHtml\(sceneLock\.scene/.test(lock) && /escapeHtml\(sceneLock\.holder\)/.test(lock));
  assert.ok(/r\.detenteur/.test(lock), 'le détenteur est lu dans le champ que renvoie le serveur');
});

test('§ 2.3 — escapeHtml neutralise un nom de scène piégé', () => {
  const bac = {String, Object};
  bac.globalThis = bac;
  const ctx = vm.createContext(bac);
  vm.runInContext(deEsm(read('js/escape-html.js')), ctx);
  const sortie = vm.runInContext('escapeHtml("<img src=x onerror=alert(1)>")', ctx);
  assert.ok(!/<img/.test(sortie), 'sortie : ' + sortie);
});
