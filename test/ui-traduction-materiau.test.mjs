// CRITÈRE DE FIN DU CONTRAT DE DESCRIPTEUR.
//
// PROPS_MATERIAL est la table la plus riche du dépôt : elle porte des ids explicites, un
// champ composé à DEUX ids, des dépendances à deux comportements distincts (grisé / masqué),
// des slots de texture, des sections et des textes d'aide. Le brouillon du contrat du socle
// perdait la moitié de ces informations. Ce test l'interdit : si la table ne se traduit pas
// intégralement, le contrat n'est pas fini.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte } from './engine-env.mjs';

const env = creerContexte(['js/ui/registry.js', 'js/ui/form-plan.js',
                           'js/assets.js', 'js/materials.js', 'js/material-props.js']);
const { PROPS_MATERIAL, sectionsFromPropsTable, planForm, statePropMaterial, stateField } = env;

// Un jeu de propriétés de matériau qui ACTIVE tout ce qui est conditionnel, pour que la
// traduction soit mesurée sur la table entière et pas sur sa moitié visible par défaut.
function propsComplets(){
  return {
    color: '#ffffff', smoothness: 0.5, metal: 0, emissive: '#000000', opacity: 1,
    doubleSided: false, texAsset: 'tex1', normalAsset: 'tex2', normalIntensity: 1,
    normalDirectX: false, combineAsset: 'tex3', combinePacking: 'orm',
    roughnessAsset: 'tex4', metalAsset: 'tex5', aoAsset: 'tex6', aoIntensity: 1,
    emissiveAsset: 'tex7', lightmapAsset: 'tex8', lightmapIntensity: 1, lightmapUv: 1,
    heightAsset: 'tex9', heightMode: 'relief', heightIntensity: 0.05,
    tiling: [1, 1], offset: [0, 0]
  };
}

test('chaque entree de PROPS_MATERIAL se retrouve dans le descripteur traduit', () => {
  const sections = sectionsFromPropsTable(PROPS_MATERIAL);
  const plan = planForm({ id: 'material', sections: sections }, [propsComplets()]);
  const entries = plan.sections.reduce((acc, s) => acc.concat(s.entries), []);

  const attendues = PROPS_MATERIAL.filter((d) => !d.section && !d.note).map((d) => d.key);
  const rendues = entries.filter((e) => e.kind === 'field').map((e) => e.field.key);

  const manquantes = Array.from(attendues.filter((k) => rendues.indexOf(k) === -1));
  assert.deepEqual(manquantes, [],
    'proprietes perdues a la traduction : ' + manquantes.join(', '));
});

test('les ids explicites sont conserves, y compris les champs a deux ids', () => {
  const sections = sectionsFromPropsTable(PROPS_MATERIAL);
  const plan = planForm({ id: 'material', sections: sections }, [propsComplets()]);
  const entries = plan.sections.reduce((acc, s) => acc.concat(s.entries), []);

  const liss = entries.find((e) => e.kind === 'field' && e.field.key === 'smoothness');
  assert.deepEqual(Array.from(liss.ids), ['ip-mliss'], 'l id explicite de la table doit gagner');

  const pair = PROPS_MATERIAL.find((d) => d.type === 'pair');
  if(pair){
    const e = entries.find((x) => x.kind === 'field' && x.field.key === pair.key);
    assert.deepEqual(Array.from(e.ids), Array.from(pair.id), 'un champ compose garde ses DEUX ids');
  }
});

test('les textes d aide ne sont pas perdus', () => {
  const sections = sectionsFromPropsTable(PROPS_MATERIAL);
  const plan = planForm({ id: 'material', sections: sections }, [propsComplets()]);
  const entries = plan.sections.reduce((acc, s) => acc.concat(s.entries), []);
  const avecAide = PROPS_MATERIAL.filter((d) => d.help).map((d) => d.key);
  avecAide.forEach((k) => {
    const e = entries.find((x) => x.kind === 'field' && x.field.key === k);
    assert.ok(e && e.help, 'aide perdue pour ' + k);
  });
});

test('stateField rend EXACTEMENT ce que statePropMaterial rendait', () => {
  const cas = [
    { normalAsset: null }, { normalAsset: 'tex' }, { combineAsset: null }, { combineAsset: 'tex' }
  ];
  PROPS_MATERIAL.filter((d) => d.requires).forEach((d) => {
    cas.forEach((p) => {
      const ancien = statePropMaterial(d, p);
      const nouveau = stateField(d, p);
      assert.equal(nouveau.visible, ancien.visible, d.key + ' : visible diverge');
      assert.equal(nouveau.enabled, ancien.active, d.key + ' : actif diverge');
      assert.equal(nouveau.reason, ancien.reason, d.key + ' : raison diverge');
    });
  });
});

test('les sections de la table deviennent des sections du descripteur', () => {
  const sections = sectionsFromPropsTable(PROPS_MATERIAL);
  const titres = sections.map((s) => s.title);
  assert.ok(titres.indexOf('Base') !== -1, 'section Base perdue');
  assert.ok(titres.indexOf('Maps PBR') !== -1, 'section Maps PBR perdue');
});
