// Audit de structure (js/project-audit.js) : il doit reconnaître un jeu caché dans un script
// (Age of Ampyre) et laisser tranquille un projet bien construit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditProject, formatAudit, isGenericName } from '../js/project-audit.js';

const lines = (n, body) => Array.from({length: n}, (_, i) => (body || '  x = ' + i + ';')).join('\n');

test('un jeu entier dans un script, scène vide : grave', () => {
  const code = 'function start(api){\n  for(let i = 0; i < 50; i++){ api.create("Arbre", [i, 0, 0]); }\n' + lines(600) + '\n}';
  const r = auditProject({
    scripts: [{name: 'Jeu', folder: '', code, holders: 1}],
    objects: [{name: 'Camera', depth: 0}, {name: 'Jeu', depth: 0}],
    assets: [{kind: 'script', name: 'Jeu', folder: ''}]
  });
  const grave = r.issues.filter((i) => i.level === 'grave').map((i) => i.text).join('\n');
  assert.match(grave, /porte 100 % du code/);
  assert.match(grave, /en boucle dans start/);
  assert.match(grave, /la scène ne compte que 2 objet/);
  assert.match(formatAudit(r), /^1 script\(s\)/);
});

test('un projet bien construit : structure saine', () => {
  const small = '/* @vars {"vitesse": 4} */\nfunction update(api){ api.me.position.x += api.props().vitesse * api.dt; }';
  const objects = [{name: 'Environnement', depth: 0}, {name: 'Sol', depth: 1}, {name: 'Gameplay', depth: 0},
    {name: 'Piece_01', depth: 1}, {name: 'Joueur', depth: 0}, {name: 'Camera', depth: 0}];
  const r = auditProject({
    scripts: [{name: 'Joueur_Deplacement', folder: 'Scripts/Joueur', code: small, holders: 1},
              {name: 'Outils', folder: 'Scripts/Communs', code: 'exports.f = function(){};', holders: 0}],
    objects,
    assets: [{kind: 'material', name: 'Herbe', folder: 'Materials'}, {kind: 'data', name: 'Ennemis', folder: 'Data'}]
  });
  assert.deepEqual(r.issues, []);
  assert.match(formatAudit(r), /Structure saine/);
});

test('rangement : racine encombrée, noms génériques, assets en vrac, script non attaché', () => {
  const objects = Array.from({length: 10}, (_, i) => ({name: 'Cube ' + i, depth: 0, generic: isGenericName('Cube ' + i)}));
  const r = auditProject({
    scripts: [{name: 'Orphelin', folder: 'Scripts', code: 'function update(api){}', holders: 0}],
    objects,
    assets: [{kind: 'material', name: 'Rouge', folder: ''}]
  });
  const t = r.issues.map((i) => i.text).join('\n');
  assert.match(t, /10 objets à la racine/);
  assert.match(t, /nom générique/);
  assert.match(t, /1 asset\(s\) à la racine/);
  assert.match(t, /n'est attaché à aucun objet/);
});

test('noms génériques', () => {
  for(const n of ['Cube', 'Cube 12', 'Sphere 3', 'Groupe 2', 'Plane']) assert.ok(isGenericName(n), n);
  for(const n of ['Mur_Nord', 'Cible_03', 'Joueur']) assert.ok(!isGenericName(n), n);
});

// Le HUD de Zeldo (2026-10-01) : `class="invite off"` + data-bind-class — le moteur garde « off » et
// y ajoute la valeur liée, l'invite et les dialogues ne se sont jamais affichés.
test('une classe d\'état écrite en dur sur un élément lié est signalée', async () => {
  const { frozenBoundClasses } = await import('../js/project-audit.js');
  const css = '<style>.invite.off{display:none}.dlg.off{display:none}.cible.masque{opacity:0}</style>';
  const bad = css + '<div class="invite off" data-bind-class="inviteClasse" data-bind="invite"></div>'
    + '<div class="dlg off" data-bind-class="dlgClasse"></div><div class="cible gros masque" data-bind-class="c"></div>';
  assert.deepEqual(frozenBoundClasses(bad).map((f) => f.key + ':' + f.cls), ['inviteClasse:off', 'dlgClasse:off', 'c:masque']);
  // corrigé : la classe de base seule, ou une classe de mise en page en plus — rien à dire
  const good = css + '<div class="invite" data-bind-class="inviteClasse"></div><div class="tl coeurs" data-bind-class="x"></div>'
    + '<div class="aide off"></div>';
  assert.deepEqual(frozenBoundClasses(good), []);
  const r = auditProject({scripts: [], objects: [], assets: [{kind: 'documentUI', name: 'HUD_Jeu', folder: 'UI', html: bad}]});
  assert.match(formatAudit(r), /HUD_Jeu.*« off ».*inviteClasse/);
});

test('BUGS_MOTEUR § 16 : `var X = exports; X.f = …` est une bibliothèque', async () => {
  const { isLibraryCode } = await import('../js/project-audit.js');
  assert.equal(isLibraryCode('var Outils = exports;\nOutils.f = function(){};'), true);
  assert.equal(isLibraryCode('exports.f = 1;'), true);
  assert.equal(isLibraryCode('function update(api){}'), false);
  const r = auditProject({scripts: [{name: 'Lib', folder: 'Scripts/Outils', code: 'var L = exports;\nL.f = 1;', holders: 0}],
    objects: [], assets: []});
  assert.ok(!r.issues.some((i) => /n'est pas une bibliothèque/.test(i.text)));
});
