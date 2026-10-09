// TOUT ÉLÉMENT QUE LE DOCK ADOPTE DOIT EXISTER DANS LA PAGE.
//
// POURQUOI CE TEST EXISTE. `adopt: 'project-zone'` est une CHAÎNE : une faute de frappe ne lève
// rien. Le dock fabrique alors un hôte vide à la place, la zone s'affiche — vide —, et l'élément
// d'origine reste où il était, invisible, avec ses écouteurs intacts. Rien ne le signale : ni
// `node --check`, ni le lint d'ordre de chargement, ni les tests d'interface, qui montent leur
// propre DOM et ne lisent jamais editor.html.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'editor.html'), 'utf8');
const shell = fs.readFileSync(path.join(root, 'js', 'ui', 'panels-shell.js'), 'utf8');

function ids(cle){
  return [...shell.matchAll(new RegExp(cle + ":\s*'([a-z0-9-]+)'", 'g'))].map((m) => m[1]);
}

test('chaque element adopte par un panneau existe dans editor.html', () => {
  const manquants = ids('adopt').filter((id) => html.indexOf('id="' + id + '"') === -1);
  assert.deepEqual(manquants, [], 'adoptes mais absents de la page : ' + manquants.join(', '));
});

test('chaque barre d outils declaree existe dans editor.html', () => {
  const manquants = ids('toolbar').filter((id) => html.indexOf('id="' + id + '"') === -1);
  assert.deepEqual(manquants, [], 'barres d outils absentes : ' + manquants.join(', '));
});

test('le conteneur du dock existe, et la grille CSS a bien disparu', () => {
  assert.ok(html.indexOf('id="dock"') !== -1, 'editor.html doit porter <div id="dock">');
  assert.equal(html.indexOf('id="split-g"'), -1, 'les poignees de la grille doivent avoir disparu');
  assert.equal(html.indexOf('data-tab='), -1, 'les onglets du panneau bas doivent avoir disparu');
  // `editor.css` a été scindé (lot 4) : la grille aurait pu ressusciter dans n'importe
  // laquelle des feuilles, donc on les lit TOUTES.
  const css = fs.readdirSync(path.join(root, 'css'))
    .filter((f) => f.endsWith('.css'))
    .map((f) => fs.readFileSync(path.join(root, 'css', f), 'utf8')).join(' ');
  assert.equal(css.indexOf('grid-template-areas'), -1, 'la grille CSS doit avoir disparu');
  assert.equal(css.indexOf('--lg:'), -1, 'les trois largeurs de la grille doivent avoir disparu');
});

test('le dock est monte au demarrage, apres les plugins', () => {
  const startup = fs.readFileSync(path.join(root, 'js', 'startup.js'), 'utf8');
  const iPlugins = startup.indexOf('loadPluginsAtStartup()');
  const iDock = startup.indexOf('bootDock()');
  assert.ok(iDock !== -1, 'startup.js doit appeler bootDock()');
  assert.ok(iPlugins !== -1 && iDock > iPlugins,
    'le dock se monte APRES les plugins : un panneau declare par un plugin doit avoir sa zone');
});

test('le copilote est un panneau du dock (adopte #copilot, a la demande, colonne de droite)', () => {
  const m = shell.match(/id:\s*'copilot'[\s\S]*?\}\);/);
  assert.ok(m, 'panneau copilot absent de panels-shell.js');
  assert.match(m[0], /title:\s*'Copilote IA'/);
  assert.match(m[0], /adopt:\s*'copilot'/);
  assert.match(m[0], /defaultZone:\s*'right'/);
  assert.match(m[0], /onDemand:\s*true/);
  const cop = fs.readFileSync(path.join(root, 'js', 'copilot.js'), 'utf8');
  assert.equal(cop.indexOf('cop-close'), -1, 'la croix propre au copilote doit avoir disparu');
});
