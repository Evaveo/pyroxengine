// LE PANNEAU RENDU PORTE DEUX CHOSES DE NATURE DIFFÉRENTE, ET LE DIT.
//
// Le post-traitement n'y est PLUS : il vit dans les PostVolume et leurs profils, seule source
// de vérité (voir js/postfx.js). Les trois filtres
// d'affichage (`filters`, scene.js:260) sont des états de SESSION de l'éditeur : ils décrivent
// comment on regarde, pas ce que la scène est. Les enregistrer dans le projet ferait rouvrir la
// scène en fil de fer chez quelqu'un d'autre.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte } from './engine-env.mjs';

function neuf(){
  const env = creerContexte(['js/ui/registry.js', 'js/ui/form-plan.js', 'js/ui/fields.js',
                             'js/ui/panels-scene.js']);
  env.TONEMAPS = [['none', 'Aucun'], ['aces', 'ACES']];
  return env;
}
function post0(){
  return { active: true, toneMapping: 'aces', exposition: 1,
           bloom: true, bloomThreshold: 0.8, bloomIntensity: 0.7, bloomRadius: 1,
           contraste: 1, saturation: 1, temperature: 0, vignette: 0.25, grain: 0,
           fxaa: false };
}
function champ(env, id){
  return env.PANEL_RENDER.sections.reduce((a, s) => a.concat(s.fields), [])
    .find((f) => f.ids && f.ids[0] === id);
}
function idsAffiches(env, p, f){
  env.ensurePost = () => p;
  env.filters = f || { wireframe: false, shadows: true, textures: true };
  return env.planForm(env.PANEL_RENDER, [{}]).sections
    .reduce((a, s) => a.concat(s.entries), [])
    .filter((e) => e.kind === 'field').map((e) => e.ids[0]);
}

test('AUCUN champ de post-traitement dans le panneau Rendu : une seule source de verite', () => {
  const e = neuf();
  ['f-env-post', 'f-env-ptm', 'f-env-pexpo', 'f-env-pbl', 'f-env-pbls', 'f-env-pbli',
   'f-env-pblr', 'f-env-pcon', 'f-env-psat', 'f-env-ptemp', 'f-env-pvig', 'f-env-pgrain',
   'f-env-pfxaa'].forEach((id) => {
    assert.equal(champ(e, id), undefined,
      'le post-traitement se regle par PostVolume + profil, pas ici : ' + id);
  });
  assert.equal(idsAffiches(e, post0()).filter((i) => i.indexOf('f-env-p') === 0).length, 0);
});

test('la section Post-traitement renvoie vers PostVolume et les profils', () => {
  const e = neuf();
  e.filters = { wireframe: false, shadows: true, textures: true };
  const notes = e.planForm(e.PANEL_RENDER, [{}]).sections
    .reduce((a, s) => a.concat(s.entries), []).filter((x) => x.kind === 'note')
    .map((x) => x.text).join(' ');
  assert.ok(/PostVolume/.test(notes) && /[Pp]rofil/.test(notes),
    'un panneau qui n a plus le reglage doit dire ou il est parti');
});

test('les trois filtres d affichage ecrivent dans filters et rappellent applyFilters', () => {
  const e = neuf();
  const f = { wireframe: false, shadows: true, textures: true };
  e.filters = f;
  let appliques = 0;
  e.applyFilters = () => { appliques += 1; };
  e.writeField(champ(e, 'f-filter-wireframe'), [{}], true);
  e.writeField(champ(e, 'f-filter-shadows'), [{}], false);
  assert.equal(f.wireframe, true);
  assert.equal(f.shadows, false);
  assert.equal(appliques, 2, 'sans applyFilters, la case bascule et la vue ne change pas');
});

test('une note dit que les filtres ne sont PAS enregistres avec la scene', () => {
  const e = neuf();
  e.ensurePost = () => post0();
  e.filters = { wireframe: false, shadows: true, textures: true };
  const notes = e.planForm(e.PANEL_RENDER, [{}]).sections
    .reduce((a, s) => a.concat(s.entries), []).filter((x) => x.kind === 'note')
    .map((x) => x.text).join(' ');
  assert.ok(/enregistr/i.test(notes),
    'un reglage de session qui ressemble a un reglage de scene doit le DIRE');
});

test('les filtres ne sont dans AUCUNE donnee serialisee', () => {
  // Ce que le panneau ne doit jamais faire : ranger `wireframe` dans `env`. Une case
  // d affichage enregistree dans le projet ferait rouvrir la scene en fil de fer chez
  // quelqu un d autre.
  const e = neuf();
  const cles = e.PANEL_RENDER.sections
    .reduce((a, s) => a.concat(s.fields), [])
    .filter((f) => f.ids && f.ids[0].indexOf('f-filter-') === 0)
    .map((f) => f.key);
  assert.deepEqual(Array.from(cles.filter(Boolean)), [],
    'un filtre ne porte pas de `key` : il n a pas de chemin dans la donnee de scene');
});
