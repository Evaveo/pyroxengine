// LES POINTS DE MÉLANGE SONT UNE LISTE ÉDITABLE, PAS UNE ZONE DE TEXTE BRUTE.
//
// `sectionsAnimatorState` (js/ui/panels-components.js) décrit le mini-inspecteur d'un état de
// la machine Animator. Ce test fige le contrat du champ `f-gr-state-blendpoints` AVANT la
// migration de la textarea vers un descripteur `type: 'list'` : items()/fields()/onAdd/onRemove.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte } from './engine-env.mjs';

function neuf(){
  return creerContexte(['js/ui/form-plan.js', 'js/ui/panels-components.js']);
}

// Un composant AnimatorController factice, juste assez pour que `sectionsAnimatorState`
// (qui ne lit que `c.machine`) fonctionne sans monter Registry ni Noeud.
function composant(){
  return { asset: { id: 'a1' }, machine: { params: [], states: [], transitions: [] } };
}

test('les points de melange sont un champ type liste avec items/fields/onAdd/onRemove', () => {
  const env = neuf();
  const c = composant();
  const e = { name: 'Locomotion', blend: { param: '', points: [{clip: 'marche', value: 0}, {clip: 'course', value: 5}] } };
  const sections = env.sectionsAnimatorState(c, e);
  const champ = sections[0].fields.find((f) => f.id === 'f-gr-state-blendpoints' || (f.ids && f.ids[0] === 'f-gr-state-blendpoints'));
  assert.ok(champ, 'le champ des points de melange doit exister');
  assert.equal(champ.type, 'list');
  const items = champ.items(c);
  assert.equal(items.length, 2);
  const lignes0 = champ.fields(items[0], 0, c);
  assert.equal(lignes0.length, 2, 'un point = un selecteur de clip + un champ de valeur');
  champ.onAdd(c);
  assert.equal(e.blend.points.length, 3);
  assert.equal(e.blend.points[2].clip, '');
  assert.equal(e.blend.points[2].value, 0);
  champ.onRemove(c, 0);
  assert.equal(e.blend.points.length, 2);
  assert.equal(e.blend.points[0].clip, 'course');
});
