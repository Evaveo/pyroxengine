import { deEsm } from './engine-env.mjs';
// Les sous-menus de la barre de menus (v0.179.0) : le menu Fichier comptait vingt-cinq entrées
// à plat. On vérifie le rendu (chemins `data-i`, entrées masquées, sous-menu vide qui disparaît),
// la résolution d'un chemin, et la forme du menu Fichier.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ui = readFileSync(path.join(root, 'js/ui.js'), 'utf8');

function slice(name){
  const debut = ui.indexOf('export function ' + name);
  assert.ok(debut >= 0, name + ' introuvable');
  return ui.slice(debut, ui.indexOf('\n}', debut) + 2);
}

function contexte(){
  const bac = {String, parseInt, isReadOnly: () => false};
  bac.globalThis = bac;
  const ctx = vm.createContext(bac);
  vm.runInContext(deEsm([slice('subItemsOf'), slice('menuItemsHtml'), slice('menuItemAt')].join('\n')), ctx);
  return ctx;
}

test('un sous-menu se rend avec des chemins, et ses entrées masquées ne comptent pas', () => {
  const ctx = contexte();
  ctx.list = [
    {label: 'A', action: () => 'a'},
    {sep: true},
    {label: 'Exporter', submenu: [
      {label: 'Web', action: () => 'web'},
      {label: 'Caché', hidden: () => true, action: () => 'x'},
      {label: 'Bureau', active: () => false, action: () => 'bureau'}
    ]},
    {label: 'Vide', submenu: [{label: 'Caché', hidden: () => true}, {sep: true}]}
  ];
  const html = vm.runInContext('menuItemsHtml(list, "")', ctx);
  assert.match(html, /data-i="0"/);
  assert.match(html, /data-sub="2"/);
  assert.match(html, /data-i="2\.0"/);
  assert.ok(!/data-i="2\.1"/.test(html), 'l entrée masquée n est pas rendue');
  assert.match(html, /class="item disabled" data-i="2\.2"/, 'l indice reste celui de la liste complète');
  assert.ok(!/Vide/.test(html), 'un sous-menu sans entrée visible disparaît');
  assert.equal(vm.runInContext('menuItemAt(list, "2.2").action()', ctx), 'bureau');
  assert.equal(vm.runInContext('menuItemAt(list, "0").action()', ctx), 'a');
  assert.equal(vm.runInContext('menuItemAt(list, "0.1")', ctx), null);
});

test('le menu Fichier est groupé : Nouveau, Ouvrir, Enregistrer sous, Scène, Exporter', () => {
  const debut = ui.indexOf("{title:'Fichier', items:[");
  const corps = ui.slice(debut, ui.indexOf("{title:'Édition', items:["));
  for (const sous of ['Nouveau', 'Ouvrir', 'Enregistrer sous', 'Scène', 'Exporter']) {
    assert.ok(corps.includes("{label:'" + sous + "', submenu:["), sous);
  }
  // Premier niveau : les entrées qui ne sont pas dans un sous-menu restent peu nombreuses.
  let profondeur = 0, premierNiveau = 0;
  for (const ligne of corps.split('\n').slice(1)) {
    if (profondeur === 0 && /^\s*\{(label|sep)/.test(ligne)) premierNiveau++;
    profondeur += (ligne.match(/submenu:\[/g) || []).length;
    if (/^\s*\]\},?\s*$/.test(ligne) && profondeur > 0) profondeur--;
  }
  assert.ok(premierNiveau <= 17, 'le menu Fichier a de nouveau ' + premierNiveau + ' entrées de premier niveau');
});

test('les sous-menus s ouvrent au clavier et ne s affichent pas tous avec leur menu', () => {
  assert.match(ui, /e\.key === 'ArrowRight'/);
  assert.match(ui, /e\.key === 'ArrowLeft' && list\.classList\.contains\('submenu'\)/);
  const css = readFileSync(path.join(root, 'css/widgets.css'), 'utf8');
  assert.ok(css.includes('.menu.open > .dropdown{display:block;}'));
  assert.ok(!css.includes('.menu.open .dropdown{display:block;}'));
});
