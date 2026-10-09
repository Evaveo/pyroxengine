// LES DEUX FENÊTRES DE RÉGLAGES, ET LA FRONTIÈRE ENTRE ELLES.
//
// « Paramètres du projet » vise `project.settings` : ce qui est là voyage avec le projet.
// « Préférences » vise `Prefs` : ce qui est là appartient à la machine, et ne part jamais dans
// un fichier de projet. Un réglage du mauvais côté est un bug silencieux — soit la clé API du
// copilote se retrouve dans un projet partagé, soit deux personnes qui publient le même projet
// obtiennent deux jeux différents. C'est ce que ce test empêche.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte } from './engine-env.mjs';

function neuf(){
  const env = creerContexte(['js/ui/registry.js', 'js/ui/form-plan.js', 'js/ui/fields.js',
                             'js/ui/prefs.js', 'js/scripts.js', 'js/environment.js',
                             'js/lightmap-bake.js', 'js/project-settings.js',
                             'js/ui/panels-settings.js']);
  env.setStatus = function(){};
  return env;
}

function champs(env, panneau, cible){
  const plan = env.planForm(panneau, [cible]);
  const out = [];
  plan.sections.forEach((s) => s.entries.forEach((e) => {
    if(e.kind === 'field' || e.kind === 'action') out.push(e.ids[0]);
    if(e.kind === 'list') out.push(e.ids[0]);
  }));
  return out;
}

test('les reglages de PROJET sont ceux de project.settings, et rien de plus', () => {
  const env = neuf();
  const s = env.projectSettingsOf({});
  const ids = champs(env, env.PANEL_PROJECT_SETTINGS, s);
  ['f-ps-name', 'f-ps-versionvisible', 'f-ps-layers', 'f-ps-layers2d', 'f-ps-ppu2d',
   'f-ps-inputs', 'f-ps-lm-res', 'f-ps-design'].forEach(function(id){
    assert.ok(ids.indexOf(id) !== -1, 'reglage de projet manquant : ' + id);
  });
  // Et AUCUNE préférence d'éditeur : la clé API du copilote ne doit pas pouvoir partir dans
  // un fichier de projet partagé.
  assert.equal(ids.some((id) => id.indexOf('copilot') !== -1), false);
  assert.equal(ids.some((id) => id.indexOf('theme') !== -1), false);
});

test('un calque se renomme, s ajoute, et le calque par defaut ne se retire PAS', () => {
  const env = neuf();
  const s = env.projectSettingsOf({});
  const liste = env.planForm(env.PANEL_PROJECT_SETTINGS, [s]).sections
    .reduce((a, x) => a.concat(x.entries), [])
    .find((e) => e.kind === 'list' && e.ids[0] === 'f-ps-layers');
  const avant = s.layers.length;
  liste.rows[0].entries[0].field.set(s.layers[0], 'Sol');
  assert.equal(s.layers[0].name, 'Sol');
  liste.onAdd(s);
  assert.equal(s.layers.length, avant + 1);
  liste.onRemove(s, 0);
  assert.equal(s.layers.length, avant + 1, 'le calque 0 est celui de tout objet sans choix');
  liste.onRemove(s, s.layers.length - 1);
  assert.equal(s.layers.length, avant);
});

test('le dernier calque de tri 2D ne se retire pas', () => {
  const env = neuf();
  const s = env.projectSettingsOf({});
  const liste = env.planForm(env.PANEL_PROJECT_SETTINGS, [s]).sections
    .reduce((a, x) => a.concat(x.entries), [])
    .find((e) => e.kind === 'list' && e.ids[0] === 'f-ps-layers2d');
  while(s.layers2d.length > 1) liste.onRemove(s, 0);
  liste.onRemove(s, 0);
  assert.equal(s.layers2d.length, 1,
    'un tableau vide renverrait tous les sprites au fond (orderOfSort)');
});

test('l ESPACE reste une touche : trim() l effacerait', () => {
  const env = neuf();
  const s = env.projectSettingsOf({});
  s.inputs = { actions: { sauter: [' '] }, axes: {} };
  const liste = env.planForm(env.PANEL_PROJECT_SETTINGS, [s]).sections
    .reduce((a, x) => a.concat(x.entries), [])
    .find((e) => e.kind === 'list' && e.ids[0] === 'f-ps-inputs');
  const ligne = liste.rows[0];
  assert.equal(ligne.entries[1].value, ' ');
  ligne.entries[1].field.set(ligne.item, 'z, w,  ');
  assert.deepEqual(Array.from(s.inputs.actions.sauter), ['z', 'w', ' ']);
});

test('les PREFERENCES sont calculees depuis le registre — un plugin y entre seul', () => {
  const env = neuf();
  const avant = champs(env, env.PANEL_PREFERENCES, env.Prefs);
  assert.ok(avant.indexOf('f-pref-ui-theme') !== -1);
  assert.equal(avant.indexOf('f-pref-monplugin-couleur'), -1);
  env.Prefs.define({ key: 'monplugin.couleur', label: 'Couleur', type: 'color',
                     category: 'Extensions', default: '#ff0000' });
  const apres = champs(env, env.PANEL_PREFERENCES, env.Prefs);
  assert.ok(apres.indexOf('f-pref-monplugin-couleur') !== -1,
    'une liste ecrite a la main aurait oblige chaque plugin a modifier l editeur');
});

test('une preference cachee n est pas un champ : elle a son propre ecran', () => {
  const env = neuf();
  const ids = champs(env, env.PANEL_PREFERENCES, env.Prefs);
  assert.equal(ids.indexOf('f-pref-dock-layout'), -1);
  assert.equal(ids.indexOf('f-pref-textures-naming'), -1);
  assert.ok(ids.indexOf('btn-pref-naming') !== -1, 'mais le bouton qui y mene existe');
});

test('regler une preference passe par Prefs, pas par un champ parallele', () => {
  const env = neuf();
  const champ = env.planForm(env.PANEL_PREFERENCES, [env.Prefs]).sections
    .reduce((a, x) => a.concat(x.entries), [])
    .find((e) => e.ids && e.ids[0] === 'f-pref-ui-density');
  assert.equal(champ.value, 'normale');
  champ.field.set(env.Prefs, 'compacte');
  assert.equal(env.Prefs.get('ui.density'), 'compacte');
});

test('les trois modales remplacees REDIRIGENT au lieu de rester en double', async () => {
  const fs = await import('node:fs');
  const lire = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
  assert.match(lire('js/layers.js'), /function modalLayers\(\)\{\s*\n\s*if\(typeof openPanelDock/,
    'modalLayers doit ouvrir le panneau, pas rouvrir sa propre modale');
  assert.match(lire('js/ui.js'), /function modalInputs\(\)\{\s*\n\s*if\(typeof openPanelDock/,
    'modalInputs doit ouvrir le panneau');
  // `modalPrefs` promettait toutes les préférences et n'en montrait qu'une : elle a été
  // renommée en `modalNaming`, ce qu'elle est réellement.
  assert.equal(lire('js/material-extraction.js').indexOf('function modalPrefs('), -1);
  assert.ok(lire('js/material-extraction.js').indexOf('function modalNaming(') !== -1);
});
