// UNE LISTE DYNAMIQUE EST UN PLAN, PAS UNE BOUCLE DE CONCATÉNATION.
//
// Le cas qui décide du contrat : les conditions de transition d'animateur
// (component-views.js:204-250). Le TYPE du sous-champ « valeur » dépend du type du paramètre
// testé, et un déclencheur n'a pas de valeur. Un contrat de liste qui suppose des lignes
// homogènes ne sait pas l'exprimer — et la migration du lot 2 se ferait alors sans socle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte } from './engine-env.mjs';

const env = creerContexte(['js/ui/registry.js', 'js/ui/form-plan.js']);
const { planForm } = env;

const liste = {
  type: 'list', id: 'conditions', label: 'Conditions',
  items: (t) => t.conditions,
  // `fields` reçoit l'ÉLÉMENT et son index : c'est ce qui permet à une ligne de porter des
  // champs différents de sa voisine.
  fields: (item, i) => {
    const out = [{ key: 'param', ids: ['f-cond-' + i + '-param'], type: 'choice',
                   options: [['speed', 'speed']] }];
    if(item.type !== 'trigger'){
      out.push({ key: 'value', ids: ['f-cond-' + i + '-val'],
                 type: item.type === 'bool' ? 'choice' : 'number',
                 options: item.type === 'bool' ? [[true, 'vrai'], [false, 'faux']] : null });
    }
    return out;
  },
  onAdd: (t) => { t.conditions.push({ param: 'speed', type: 'float', value: 0 }); },
  onRemove: (t, i) => { t.conditions.splice(i, 1); }
};

function plan(target){
  return planForm({ id: 'p', sections: [{ id: 's', fields: [liste] }] }, [target]);
}

test('une liste rend une ligne par element, avec ses sous-champs', () => {
  const t = { conditions: [{ param: 'speed', type: 'float', value: 2 },
                           { param: 'saut', type: 'trigger' }] };
  const e = plan(t).sections[0].entries[0];
  assert.equal(e.kind, 'list');
  assert.equal(e.rows.length, 2);
  assert.equal(e.rows[0].entries.length, 2, 'un float a un parametre ET une valeur');
  assert.equal(e.rows[1].entries.length, 1, 'un declencheur n a pas de valeur');
  assert.equal(e.rows[0].entries[1].value, 2);
});

test('les ids des sous-champs sont ceux que le descripteur donne', () => {
  const t = { conditions: [{ param: 'speed', type: 'float', value: 2 }] };
  const e = plan(t).sections[0].entries[0];
  assert.deepEqual(Array.from(e.rows[0].entries[1].ids), ['f-cond-0-val']);
});

test('la FORME change quand le nombre de lignes change', () => {
  const a = plan({ conditions: [{ param: 'a', type: 'float', value: 0 }] });
  const b = plan({ conditions: [{ param: 'a', type: 'float', value: 0 },
                                { param: 'b', type: 'float', value: 0 }] });
  assert.notEqual(a.shape, b.shape, 'une ligne ajoutee DOIT etre construite');
});

test('la FORME change avec le TYPE d une ligne, pas avec sa valeur', () => {
  const meme = plan({ conditions: [{ param: 'a', type: 'float', value: 9 }] });
  const autre = plan({ conditions: [{ param: 'a', type: 'float', value: 0 }] });
  assert.equal(meme.shape, autre.shape);
  const trig = plan({ conditions: [{ param: 'a', type: 'trigger' }] });
  assert.notEqual(meme.shape, trig.shape);
});

test('une liste est inerte en multi-selection, et le dit', () => {
  const p = planForm({ id: 'p', sections: [{ id: 's', fields: [liste] }] },
                     [{ conditions: [] }, { conditions: [] }]);
  const e = p.sections[0].entries[0];
  assert.equal(e.enabled, false);
  assert.equal(e.reason, 'un seul objet à la fois');
});

test('une liste vide rend zero ligne sans lever', () => {
  assert.equal(plan({ conditions: [] }).sections[0].entries[0].rows.length, 0);
});

// UNE LIGNE PEUT PORTER UNE LISTE — c'est le cas des ÉVÉNEMENTS : une règle « Quand… » tient
// zéro, une ou dix actions. Sans imbrication, migrer Events voudrait dire garder une seconde
// couche de HTML concaténé à côté du socle, avec ses propres délégations d'événements.
const evenements = {
  type: 'list', id: 'f-ev-list', label: 'Événements',
  items: (o) => o.events,
  fields: (ev, ei) => [
    { key: 'when', ids: ['f-ev-' + ei + '-when'], type: 'choice',
      options: [['startup', 'Au démarrage']] },
    { type: 'list', id: 'f-ev-' + ei + '-actions',
      items: (e) => e.actions,
      fields: (ac, ai) => [{ key: 'type', ids: ['f-ev-' + ei + '-' + ai + '-type'], type: 'text' }],
      onAdd: (e) => { e.actions.push({ type: 'montrer' }); },
      onRemove: (e, i) => { e.actions.splice(i, 1); } }
  ],
  onAdd: (o) => { o.events.push({ when: 'startup', actions: [] }); },
  onRemove: (o, i) => { o.events.splice(i, 1); }
};

function planEv(o){
  return planForm({ id: 'p', sections: [{ id: 's', fields: [evenements] }] }, [o]);
}

test('une ligne de liste peut porter une liste, et ses actions ecrivent sur SA ligne', () => {
  const o = { events: [{ when: 'startup', actions: [{ type: 'montrer' }, { type: 'hide' }] },
                       { when: 'startup', actions: [] }] };
  const e = planEv(o).sections[0].entries[0];
  assert.equal(e.rows.length, 2);
  const imbriquee = e.rows[0].entries[1];
  assert.equal(imbriquee.kind, 'list', 'la seconde entree de la ligne est une liste');
  assert.equal(imbriquee.rows.length, 2);
  assert.equal(imbriquee.rows[0].entries[0].value, 'montrer');
  assert.equal(e.rows[1].entries[1].rows.length, 0);
  // La cible d'un ajout imbriqué est L'ÉLÉMENT DE LA LIGNE, pas l'objet du panneau.
  imbriquee.onAdd(e.rows[0].item);
  assert.equal(o.events[0].actions.length, 3);
  assert.equal(o.events[1].actions.length, 0, 'la ligne voisine n a pas bouge');
});

test('ajouter une action change la forme du plan', () => {
  const o = { events: [{ when: 'startup', actions: [] }] };
  const avant = planEv(o).shape;
  o.events[0].actions.push({ type: 'montrer' });
  assert.notEqual(planEv(o).shape, avant,
                  'sans le nombre de lignes imbriquees dans la signature, rien ne se reconstruit');
});
