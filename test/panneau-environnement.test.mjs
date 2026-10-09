// LE PANNEAU ENVIRONNEMENT DIT LA MÊME CHOSE QUE L'ANCIEN REPLI, AU MÊME ENDROIT DE LA DONNÉE.
//
// L'environnement est DÉJÀ par scène (serialization.js:785, history.js:112) : ce lot ne migre
// aucune donnée. Ce test est donc une garde d'équivalence — mêmes clés d'`env`, mêmes bornes,
// mêmes dépendances entre champs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte } from './engine-env.mjs';

function neuf(){
  return creerContexte(['js/ui/registry.js', 'js/ui/form-plan.js', 'js/ui/fields.js',
                        'js/ui/panels-scene.js']);
}
function env0(){
  return { sky: 'color', skyColor: '#8899aa', skyTop: '#223344', skyBottom: '#aabbcc',
           skyAsset: null, skyReflets: true, skyRefletsIntensity: 1,
           brouillard: false, brouillardColor: '#8899aa', brouillardNear: 10, brouillardLoin: 100,
           ambiante: 0.5, ambianteColor: '#ffffff', sun: 1 };
}
function champ(env, id){
  return env.PANEL_ENVIRONMENT.sections
    .reduce((a, s) => a.concat(s.fields), [])
    .find((f) => (f.ids && f.ids[0] === id));
}
function idsAffiches(env, cible){
  return env.planForm(env.PANEL_ENVIRONMENT, [cible]).sections
    .reduce((a, s) => a.concat(s.entries), [])
    .filter((e) => e.kind === 'field').map((e) => e.ids[0]);
}

test('les ids sont ceux d avant', () => {
  const e = neuf();
  ['f-env-sky', 'f-env-skyc', 'f-env-skyref', 'f-env-cielrefi', 'f-env-bra', 'f-env-brc',
   'f-env-brp', 'f-env-brl', 'f-env-amb', 'f-env-ambc', 'f-env-sol'].forEach((id) => {
    assert.ok(champ(e, id), 'champ disparu : ' + id);
  });
});

test('les trois sections d avant sont la', () => {
  const e = neuf();
  const titres = e.PANEL_ENVIRONMENT.sections.map((s) => s.title);
  assert.deepEqual(Array.from(titres), ['Ciel', 'Brouillard', 'Éclairage global']);
});

test('la couleur unie n apparait que pour un ciel uni, le degrade que pour un degrade', () => {
  const e = neuf();
  const uni = idsAffiches(e, env0());
  const deg = idsAffiches(e, Object.assign(env0(), { sky: 'gradient' }));
  assert.ok(uni.indexOf('f-env-skyc') !== -1);
  assert.equal(deg.indexOf('f-env-skyc'), -1);
  assert.ok(deg.indexOf('f-env-top') !== -1 && deg.indexOf('f-env-bottom') !== -1);
});

test('l intensite des reflets n apparait que si les reflets sont actifs', () => {
  const e = neuf();
  assert.ok(idsAffiches(e, env0()).indexOf('f-env-cielrefi') !== -1);
  const sans = Object.assign(env0(), { skyReflets: false });
  assert.equal(idsAffiches(e, sans).indexOf('f-env-cielrefi'), -1);
});

test('les bornes de l ancien code sont conservees', () => {
  const e = neuf();
  const t = env0();
  e.writeField(champ(e, 'f-env-brp'), [t], -50);
  assert.ok(t.brouillardNear >= 0.1, 'un debut de brouillard negatif etait deja refuse');
  e.writeField(champ(e, 'f-env-brl'), [t], 1);
  assert.ok(t.brouillardLoin > t.brouillardNear, 'la fin reste apres le debut');
  e.writeField(champ(e, 'f-env-amb'), [t], -3);
  assert.ok(t.ambiante >= 0);
  e.writeField(champ(e, 'f-env-sol'), [t], -1);
  assert.ok(t.sun >= 0);
  e.writeField(champ(e, 'f-env-cielrefi'), [t], 99);
  assert.ok(t.skyRefletsIntensity <= 3);
});

test('changer le type de ciel change la FORME du panneau', () => {
  const e = neuf();
  const a = e.planForm(e.PANEL_ENVIRONMENT, [env0()]);
  const b = e.planForm(e.PANEL_ENVIRONMENT, [Object.assign(env0(), { sky: 'gradient' })]);
  assert.notEqual(a.shape, b.shape);
});

test('le panorama liste les textures du projet, et le dit quand il n y en a pas', () => {
  const e = neuf();
  e.assets = [];
  const t = Object.assign(env0(), { sky: 'image' });
  const notes = e.planForm(e.PANEL_ENVIRONMENT, [t]).sections
    .reduce((a, s) => a.concat(s.entries), []).filter((x) => x.kind === 'note');
  assert.ok(notes.length, 'sans texture, le panneau doit dire ou en importer');
  e.assets = [{ id: 'tex1', kind: 'texture', name: 'ciel.hdr' }];
  const opts = e.planForm(e.PANEL_ENVIRONMENT, [t]).sections
    .reduce((a, s) => a.concat(s.entries), [])
    .find((x) => x.ids && x.ids[0] === 'f-env-img').options;
  assert.ok(Array.from(opts.map((o) => o[0])).indexOf('tex1') !== -1);
});

test('ecrire un champ appelle applyEnvironment — sinon la vue ne bouge pas', () => {
  const e = neuf();
  let applique = 0;
  e.applyEnvironment = () => { applique += 1; };
  const t = env0();
  e.writeField(champ(e, 'f-env-skyc'), [t], '#ff0000');
  assert.equal(t.skyColor, '#ff0000');
  assert.equal(applique, 1);
});

test('la case des reflets et celle du brouillard ecrivent des BOOLEENS', () => {
  const e = neuf();
  const t = env0();
  e.writeField(champ(e, 'f-env-bra'), [t], true);
  assert.equal(t.brouillard, true);
  e.writeField(champ(e, 'f-env-skyref'), [t], false);
  assert.equal(t.skyReflets, false);
});
