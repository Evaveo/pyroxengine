// LES DESCRIPTEURS DE L'INSPECTEUR SONT DES DONNÉES, ET SE TESTENT COMME TELLES.
//
// Ils vivent dans js/ui/panels-inspector.js et non dans inspector.js : un descripteur qui exige
// inspBody, Registry, Editor et THREE pour être seulement LU n'est pas testable — c'est ce qui a
// laissé l'inspecteur sans un seul test pendant 736 lignes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte } from './engine-env.mjs';

function neuf(){
  return creerContexte(['js/ui/registry.js', 'js/ui/form-plan.js', 'js/ui/fields.js',
                        'js/ui/panels-inspector.js']);
}

// Un objet de scène factice : ce que le descripteur lit réellement, et rien de plus.
function objet(over){
  return Object.assign({
    name: 'Cube', id: 3,
    userData: { type: 'mesh', game: { tag: 'joueur', layer: 0 } },
    position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
    traverse(){}
  }, over || {});
}

test('identite : les ids d avant sont conserves, dans l ordre', () => {
  const env = neuf();
  const plan = env.planForm(env.PANEL_IDENTITY, [objet()]);
  const ids = plan.sections[0].entries.filter((e) => e.kind === 'field').map((e) => e.ids.join('+'));
  assert.deepEqual(Array.from(ids), ['f-name', 'f-jtag', 'f-jlayer']);
});

test('identite : le nom est mono-objet, le tag et le calque ne le sont pas', () => {
  const env = neuf();
  const plan = env.planForm(env.PANEL_IDENTITY, [objet(), objet()]);
  const [nom, tag, calque] = plan.sections[0].entries;
  assert.equal(nom.enabled, false);
  assert.equal(nom.reason, 'un seul objet à la fois');
  assert.equal(tag.enabled, true, 'deux objets peuvent partager un tag');
  assert.equal(calque.enabled, true, 'deux objets peuvent partager un calque');
});

test('identite : le calque lit ses options dans project.layers', () => {
  const env = neuf();
  env.project.layers = [{ id: 0, name: 'Défaut' }, { id: 7, name: 'Ennemis' }];
  const plan = env.planForm(env.PANEL_IDENTITY, [objet()]);
  assert.deepEqual(Array.from(plan.sections[0].entries[2].options.map((o) => o[1])),
                   ['Défaut', 'Ennemis']);
});

test('identite : ecrire le nom ecrit sur l objet, le tag sur son sac de jeu', () => {
  const env = neuf();
  const o = objet();
  const champs = env.PANEL_IDENTITY.sections[0].fields;
  env.writeField(champs[0], [o], 'Caisse');
  env.writeField(champs[1], [o], 'ennemi');
  assert.equal(o.name, 'Caisse');
  assert.equal(o.userData.game.tag, 'ennemi');
});

test('prefab : les deux boutons d etat suivent instanceModified', () => {
  const env = neuf();
  let modifie = false;
  env.instanceModified = () => modifie;
  env.assetPrefabOf = () => ({ name: 'Caisse' });
  const o = objet();

  const etat = () => {
    const byId = {};
    env.planForm(env.PANEL_PREFAB, [o]).sections[0].entries
      .forEach((e) => { if(e.ids) byId[e.ids[0]] = e; });
    return byId;
  };
  assert.equal(etat()['btn-prefab-apply'].enabled, false, 'rien a appliquer sur une instance intacte');
  modifie = true;
  assert.equal(etat()['btn-prefab-apply'].enabled, true);
  assert.equal(etat()['btn-prefab-reset'].enabled, true);
});

test('prefab : la source est un champ info, jamais saisissable', () => {
  const env = neuf();
  env.assetPrefabOf = () => ({ name: 'Caisse' });
  env.instanceModified = () => false;
  const info = env.planForm(env.PANEL_PREFAB, [objet()]).sections[0].entries
    .find((e) => e.type === 'info');
  assert.equal(info.enabled, false);
  assert.ok(String(info.value).indexOf('Caisse') !== -1);
});

test('modele : le compteur de maillages est un champ info', () => {
  const env = neuf();
  const o = objet({ traverse(fn){ fn({ isMesh: true }); fn({ isMesh: false }); fn({ isMesh: true }); } });
  const info = env.planForm(env.PANEL_MODEL, [o]).sections[0].entries.find((e) => e.type === 'info');
  assert.equal(info.value, 2);
});
