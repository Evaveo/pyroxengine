// LE TEXTE RICHE (`data-bind-rich`) : né dans jeux/Donjons, remonté dans le moteur.
// Exécuté sur de vrais objets via le harnais node:vm, sans navigateur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { creerContexte } from './engine-env.mjs';

const env = creerContexte(['js/game-ui.js']);

test('les balises disparaissent du texte, les inconnues restent', () => {
  assert.equal(env.stripRichText('[b][red]12 PV[/][/] !'), '12 PV !');
  assert.equal(env.stripRichText('[x2] pour [PNJ]'), '[x2] pour [PNJ]');
  assert.equal(env.stripRichText('a[pause=1]b'), 'ab');
});

test('les noms français de Donjons sont compris', () => {
  const items = env.parseRichText('[c=rouge][vague]x[/][/]');
  assert.equal(items[0].e.color, '#ff5a5a');
  assert.deepEqual(Array.from(items[0].e.fx), ['wave']);
});

test('[/nom] ferme jusqu à la balise nommée', () => {
  const items = env.parseRichText('[b][red]a[/b]b');
  assert.equal(items[1].e.b, 0);
  assert.equal(items[1].e.color, null);
});

test('le HTML de la valeur est échappé', () => {
  const html = env.richTextToHtml('<img src=x onerror=alert(1)>');
  assert.ok(!html.includes('<img'), html);
  assert.ok(html.includes('&lt;'));
});

test('une couleur ne peut pas sortir du style', () => {
  const html = env.richTextToHtml('[color=red;background:url(x)]a[/]');
  assert.ok(!html.includes('background'), html);
});

test('la machine à écrire pose un délai croissant, pauses comprises', () => {
  const html = env.richTextToHtml('ab[pause=1]c', {speed: 10});
  const delays = [...html.matchAll(/animation-delay:([\d.]+)s/g)].map((m) => parseFloat(m[1]));
  assert.deepEqual(delays, [0.1, 0.2, 1.3]);
  assert.ok(Math.abs(env.richTextDuration('ab[pause=1]c', 10) - 1.3) < 1e-9);
});

test('data-bind-rich rend le texte et ne le reconstruit que s il change', () => {
  const el = {tagName: 'DIV', dataset: {bindRich: 'msg', typewriter: ''}, innerHTML: ''};
  const root = {querySelectorAll: () => [el]};
  env._applyValuesBind(root, {msg: '[wave]Salut[/]'});
  assert.ok(el.innerHTML.includes('rt-wave'));
  assert.ok(el.innerHTML.includes('rt-reveal'), 'data-typewriter sans valeur = vitesse par défaut');
  el.innerHTML = 'intact';
  env._applyValuesBind(root, {msg: '[wave]Salut[/]', autre: 1});
  assert.equal(el.innerHTML, 'intact', 'même texte : la machine à écrire ne doit pas repartir');
});

test('rt-skip termine la machine à écrire', () => {
  const src = readFileSync(new URL('../js/game-ui.js', import.meta.url), 'utf8');
  assert.ok(src.includes("'.rt-skip .rt-reveal{animation:none}'"));
});
