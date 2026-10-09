// UNE VALEUR AFFICHÉE EST UNE VALEUR DU PLAN, PAS UNE CHAÎNE HTML.
//
// L'inspecteur affiche trois choses qu'on ne peut pas taper : le nombre de maillages d'un
// modèle, le nom du prefab source, et son état « ● modifié ». Elles étaient concaténées dans le
// HTML, puis re-cherchées par getElementById pour être rafraîchies (updateStatePrefab). Tant que
// le socle ne sait pas porter une valeur en LECTURE SEULE, ces trois-là restent dehors — et avec
// elles la moitié des sections à migrer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte } from './engine-env.mjs';

const env = creerContexte(['js/ui/registry.js', 'js/ui/form-plan.js']);
const { planForm } = env;

function plan(fields, target){
  return planForm({ id: 'p', sections: [{ id: 's', fields: fields }] }, [target]);
}

test('un champ info porte une valeur calculee et n est jamais actif', () => {
  const p = plan([{ type: 'info', label: 'Maillages', get: (t) => t.meshes.length }],
                 { meshes: [1, 2, 3] });
  const e = p.sections[0].entries[0];
  assert.equal(e.kind, 'field');
  assert.equal(e.type, 'info');
  assert.equal(e.value, 3);
  assert.equal(e.enabled, false, 'un champ info ne se saisit pas');
});

test('une note peut calculer son texte sur la cible', () => {
  const p = plan([{ type: 'note', text: (t) => t.clips.length + ' animation(s)' }],
                 { clips: ['a', 'b'] });
  assert.equal(p.sections[0].entries[0].text, '2 animation(s)');
});

test('une note a texte fixe continue de marcher', () => {
  const p = plan([{ type: 'note', text: 'Aucune sonde.' }], {});
  assert.equal(p.sections[0].entries[0].text, 'Aucune sonde.');
});

test('le texte d une note ne fait PAS partie de la forme', () => {
  const d = { id: 'p', sections: [{ id: 's', fields: [
    { key: 'n', type: 'number' },
    { type: 'note', text: (t) => t.n + ' objet(s)' }
  ]}]};
  assert.equal(planForm(d, [{ n: 1 }]).shape, planForm(d, [{ n: 9 }]).shape,
    'un compteur qui bouge ne doit PAS refabriquer la section — la saisie d a cote serait coupee');
});

test('les options d un choice peuvent dependre de la cible', () => {
  const f = { key: 'layer', type: 'choice',
              options: (t) => t.layers.map((l) => [l.id, l.name]) };
  const p = plan([f], { layer: 1, layers: [{ id: 0, name: 'Défaut' }, { id: 1, name: 'Joueur' }] });
  assert.deepEqual(Array.from(p.sections[0].entries[0].options.map((o) => o[1])),
                   ['Défaut', 'Joueur']);
});

test('la FORME change quand la liste d options change', () => {
  const f = { key: 'layer', type: 'choice', options: (t) => t.layers.map((l) => [l.id, l.name]) };
  const d = { id: 'p', sections: [{ id: 's', fields: [f] }] };
  const a = planForm(d, [{ layer: 0, layers: [{ id: 0, name: 'Défaut' }] }]);
  const b = planForm(d, [{ layer: 0, layers: [{ id: 0, name: 'Défaut' }, { id: 1, name: 'Joueur' }] }]);
  assert.notEqual(a.shape, b.shape,
    'un calque ajoute doit refabriquer le select, sinon il n y apparait jamais');
});
