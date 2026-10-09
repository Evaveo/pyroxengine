// La couleur d'équipe (js/components/component-team-color.js) : un seul modèle, huit joueurs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deEsm } from './engine-env.mjs';
import vm from 'node:vm';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const ctx = vm.createContext({Icons: {html: () => ''}, Object, Array, String, Number, parseInt, setTimeout: () => 0,
  Registry: {registerClass(){}}, Component: class { constructor(n){ this.node = n; } },
  detachData: (d) => JSON.parse(JSON.stringify(d)), mergeIntoBag: (b, r) => Object.assign(b, r)});
vm.runInContext(deEsm(read('js/components/component-team-color.js')) + '\nthis.applyTeamColor = applyTeamColor; this.TeamColor = TeamColor;', ctx);
const { applyTeamColor } = ctx;

function color(r, g, b){ return {r, g, b, copy(c){ this.r = c.r; this.g = c.g; this.b = c.b; return this; }}; }
function mat(name, r = 0.8, g = 0.8, b = 0.8){ return {name, color: color(r, g, b), clone(){ return mat(this.name, this.color.r, this.color.g, this.color.b); }}; }
function mesh(material){ return {isMesh: true, material, userData: {}, children: []}; }
function node(children){ return {userData: {}, children}; }

test('SEUL le matériau « Team » est teint, en multipliant le gris du modèle', () => {
  const team = mat('Team'), wood = mat('Bois');
  const a = mesh(team), b = mesh(wood);
  assert.equal(applyTeamColor(node([a, b]), '#ff8000', 'Team'), 1);
  assert.equal(b.material, wood, 'un autre matériau ne doit pas être touché');
  assert.notEqual(a.material, team, 'le matériau partagé ne doit jamais être modifié en place');
  assert.deepEqual([a.material.color.r, +a.material.color.g.toFixed(3), a.material.color.b], [0.8, +(0.8 * 128 / 255).toFixed(3), 0]);
  assert.equal(team.color.r, 0.8, 'l\'original partagé garde sa couleur');
});

test('DEUX INSTANCES du même modèle gardent chacune leur couleur', () => {
  const shared = mat('Team', 1, 1, 1);
  const u1 = mesh(shared), u2 = mesh(shared);
  applyTeamColor(node([u1]), '#ff0000', 'Team');
  applyTeamColor(node([u2]), '#0000ff', 'Team');
  assert.deepEqual([u1.material.color.r, u1.material.color.b], [1, 0]);
  assert.deepEqual([u2.material.color.r, u2.material.color.b], [0, 1]);
});

test('RECOLORER repart de l\'original : deux couleurs ne se multiplient pas', () => {
  const m = mesh(mat('Team', 1, 1, 1)), n = node([m]);
  applyTeamColor(n, '#808080', 'Team');
  applyTeamColor(n, '#ffffff', 'Team');
  assert.equal(m.material.color.r, 1);
});

test('UNE COULEUR INVALIDE ne teint rien', () => {
  assert.equal(applyTeamColor(node([mesh(mat('Team'))]), 'rouge', 'Team'), 0);
});

test('LE COMPOSANT est chargé par l\'éditeur, le jeu publié et le build', () => {
  for(const f of ['editor.html', 'game-preview.html', 'build-test/index.html', 'js/build.js'])
    assert.match(read(f), /component-team-color\.js/, f);
});
