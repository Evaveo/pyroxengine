// L'API DE PLUGIN v2.
//
// Ce qui change, et ce qui NE DOIT PAS changer :
//
//   - une section d'inspecteur est un DESCRIPTEUR, plus `{html, sync, input, click}`. Les cinq
//     fabriques `Editor.api.fields` rendaient des chaînes HTML et obligeaient chaque plugin à
//     router ses événements par identifiant DOM — c'est ce que la refonte a retiré de
//     l'éditeur, et le laisser aux plugins aurait gardé vivante l'interface qu'on supprimait ;
//   - le PRÉFIXE ne protège que l'INTERFACE. `def.type` et `classe.typeName` ne sont pas
//     préfixés : ils finissent dans `userData.type` et dans le projet SÉRIALISÉ.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte } from './engine-env.mjs';
import fs from 'node:fs';

const lire = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');

function neuf(){
  const env = creerContexte(['js/ui/registry.js', 'js/ui/form-plan.js', 'js/ui/fields.js',
                             'js/ui/prefs.js', 'js/component-registry.js', 'js/component.js', 'js/plugins.js']);
  env.setStatus = function(){};
  env.logConsole = function(){};
  return env;
}

/** Installe un plugin sans passer par la modale : c'est `runPlugin` qui pose `inProgress`. */
function jouer(env, name, fn){
  env.Editor.plugins.push({name: name, code: '', active: true, uid: 'u-' + name});
  env.Editor.inProgress = name;
  try { fn(env.Editor); } finally { env.Editor.inProgress = null; }
}

test('la version de l API est 2.0', () => {
  assert.equal(neuf().Editor.version, '2.0');
});

test('registerInspector a DISPARU, registerInspectorSection la remplace', () => {
  const E = neuf().Editor;
  assert.equal(typeof E.registerInspector, 'undefined');
  assert.equal(typeof E.registerInspectorSection, 'function');
});

test('Editor.api.fields a DISPARU', () => {
  const E = neuf().Editor;
  assert.equal(E.api.fields, undefined,
    'les fabriques de chaines HTML ne survivent pas a la refonte de l interface');
});

test('les quatre nouveaux points d entree existent', () => {
  const E = neuf().Editor;
  ['registerPanel', 'registerFieldType', 'definePref', 'defineProjectSetting']
    .forEach((k) => assert.equal(typeof E[k], 'function', 'manquant : ' + k));
});

test('une section d inspecteur declarative est rendue par le socle', () => {
  const env = neuf();
  jouer(env, 'bornes', (E) => {
    E.registerInspectorSection({ id: 'borne', forType: 'borne', sections: [
      { id: 's', title: 'Borne', fields: [
        { label: 'Portée', type: 'number',
          get: (o) => o.userData.borne.range,
          set: (o, v) => { o.userData.borne.range = v; } }
      ]}
    ]});
  });
  const o = { userData: { type: 'borne', borne: { range: 5 } } };
  const sections = env.PluginSections.forObject(o);
  assert.equal(sections.length, 1);
  const plan = env.planForm(sections[0].descriptor, [o]);
  const champ = plan.sections[0].entries[0];
  assert.equal(champ.value, 5);
  champ.field.set(o, 12);
  assert.equal(o.userData.borne.range, 12);
});

test('une section visant un AUTRE type ne s affiche pas', () => {
  const env = neuf();
  jouer(env, 'bornes', (E) => {
    E.registerInspectorSection({ id: 'borne', forType: 'borne',
      sections: [{ id: 's', fields: [] }] });
  });
  assert.equal(env.PluginSections.forObject({ userData: { type: 'mesh' } }).length, 0);
});

test('registerTypeObject accepte un inspecteur DECLARATIF', () => {
  const env = neuf();
  jouer(env, 'bornes', (E) => {
    E.registerTypeObject({ type: 'borne', name: 'Borne', make: () => ({}),
      inspector: { sections: [{ id: 's', title: 'Borne', fields: [] }] } });
  });
  const sections = env.PluginSections.forObject({ userData: { type: 'borne' } });
  assert.equal(sections.length, 1);
  assert.equal(sections[0].descriptor.sections[0].title, 'Borne');
});

test('le PREFIXE protege les ids d INTERFACE', () => {
  const env = neuf();
  let idPanneau, idSection, clePref;
  jouer(env, 'a', (E) => {
    idSection = E.registerInspectorSection({ id: 'palette',
      sections: [{ id: 's', fields: [] }] });
    idPanneau = E.registerPanel({ id: 'palette', title: 'Palette' });
    clePref = E.definePref({ key: 'taille', label: 'Taille', type: 'number', default: 1 });
  });
  [idPanneau, idSection, clePref].forEach(function(id){
    assert.ok(String(id).indexOf('u-a:') === 0, 'non prefixe : ' + id);
  });
});

test('deux plugins de MEME NOM ne se volent pas leurs ids', () => {
  // C'est pour ça que le préfixe vient de l'identifiant d'INSTALLATION et non du nom de
  // fichier : deux `outils.js` différents peuvent coexister.
  const env = neuf();
  env.Editor.plugins.push({ name: 'outils', code: '', active: true, uid: 'u1' });
  env.Editor.inProgress = 'outils';
  const un = env.Editor.registerPanel({ id: 'palette', title: 'Palette' });
  env.Editor.inProgress = null;
  env.Editor.plugins[0].uid = 'u2';
  env.Editor.inProgress = 'outils';
  const deux = env.Editor.registerPanel({ id: 'palette', title: 'Palette' });
  env.Editor.inProgress = null;
  assert.notEqual(un, deux);
});

test('def.type et typeName ne sont PAS prefixes : ils vivent dans le projet serialise', () => {
  const env = neuf();
  let type;
  jouer(env, 'a', (E) => {
    type = E.registerTypeObject({ type: 'borne', name: 'Borne', make: () => ({}) });
  });
  assert.equal(type, 'borne',
    'prefixer le type casserait tout projet deja enregistre qui le cite');
});

test('un reglage de PROJET n est pas prefixe non plus, et pour la meme raison', () => {
  const env = neuf();
  env.project = { settings: {} };
  let cle;
  jouer(env, 'a', (E) => {
    cle = E.defineProjectSetting({ key: 'bornes.portee', label: 'Portée', type: 'number',
                                   default: 5 });
  });
  assert.equal(cle, 'bornes.portee');
  assert.equal(env.project.settings['bornes.portee'], 5,
    'un reglage declare doit avoir sa valeur par defaut des la declaration');
});

test('une preference de plugin rejoint le registre Prefs', () => {
  const env = neuf();
  jouer(env, 'a', (E) => {
    E.definePref({ key: 'taille', label: 'Taille', type: 'number', category: 'Extensions',
                   default: 3 });
  });
  assert.equal(env.Prefs.get('u-a:taille'), 3);
});

test('un type de champ de plugin rejoint le socle', () => {
  const env = neuf();
  let type;
  jouer(env, 'a', (E) => {
    type = E.registerFieldType({ type: 'courbe', create: () => [], write: () => {},
                                 read: () => undefined });
  });
  assert.ok(env.UIRegistry.fieldType(type), 'le type declare doit etre rendu par le socle');
});

test('le catalogue des extensions cite les VRAIS noms de collection', () => {
  // `typesObjets` et `materiaux` n'existent plus depuis le renommage : `Editor['typesObjets']`
  // valait `undefined`, et le `.filter` juste apres levait — la modale des plugins ne
  // s'ouvrait plus des qu'un plugin etait installe.
  const src = lire('js/plugins.js');
  const m = src.match(/const COLLECTIONS_PLUGIN = \[([\s\S]*?)\];/);
  assert.ok(m, 'la liste des collections doit etre nommee une seule fois');
  const E = neuf().Editor;
  m[1].match(/'([a-zA-Z]+)'/g).map((x) => x.replace(/'/g, '')).forEach(function(k){
    assert.ok(Array.isArray(E[k]), 'collection inconnue : ' + k);
  });
  // Hors commentaire : le commentaire, lui, EXPLIQUE le bug et doit rester.
  const code = src.replace(/^\s*\/\/.*$/gm, '');
  assert.equal(code.indexOf("'typesObjets'"), -1);
  assert.equal(code.indexOf("'materiaux'"), -1);
});

test('le plugin d exemple du depot est ecrit au contrat v2', () => {
  const src = lire('js/plugins.js');
  const exemple = src.slice(src.indexOf('function modalExamplePlugin'));
  assert.equal(exemple.indexOf('api.fields'), -1,
    'un exemple qui utilise une API supprimee apprend une API supprimee');
  assert.equal(exemple.indexOf('registerValidateur'), -1);
  assert.ok(exemple.indexOf('sections:') !== -1, 'la section doit etre declarative');
  assert.ok(exemple.indexOf('definePref') !== -1);
});

test('l inspecteur ne route plus les evenements des plugins par identifiant', () => {
  const src = lire('js/inspector.js');
  assert.equal(src.indexOf('Editor.inspecteurs'), -1);
  assert.equal(src.indexOf('ins.input('), -1);
  assert.equal(src.indexOf('ins.click('), -1);
  assert.ok(src.indexOf('PluginSections.mount') !== -1);
});

// Dans l'éditeur, `Editor` n'est PAS une globale (modules ES) : le plugin ne le voit que parce
// que runPlugin le lui passe en paramètre. Le harnais, lui, le pose sur le global — on l'y retire
// pour reproduire l'éditeur réel. Le paramètre s'appelait `Editeur` et tous les plugins écrits
// `Editor.register…` levaient un ReferenceError sans qu'aucun test ne le voie.
function sansPontGlobal(env, fn){
  const E = env.Editor;
  env.Editor = undefined;
  try { fn(E); } finally { env.Editor = E; }
}

test('runPlugin passe `Editor` au plugin, sans dépendre d une globale', () => {
  const env = neuf();
  sansPontGlobal(env, (E) => {
    const p = {name: 'demo', code: "Editor.registerValidator({name: 'v', check: function(){}});",
               active: true, uid: 'u-demo'};
    E.plugins.push(p);
    env.runPlugin(p);
    assert.equal(p.error, null);
    assert.equal(E.validators.filter((v) => v.plugin === 'demo').length, 1);
  });
});

test('l alias `Editeur` reste accepté pour les anciens plugins', () => {
  const env = neuf();
  sansPontGlobal(env, (E) => {
    const p = {name: 'ancien', code: "Editeur.registerValidator({check: function(){}});",
               active: true, uid: 'u-ancien'};
    E.plugins.push(p);
    env.runPlugin(p);
    assert.equal(p.error, null);
  });
});

test('Editor.api.Component permet à un plugin de déclarer un composant', () => {
  const env = neuf();
  sansPontGlobal(env, (E) => {
    const p = {name: 'compo', active: true, uid: 'u-compo', code:
      "class Spin extends Editor.api.Component { static get typeName(){ return 'Spin'; } }\n"
      + "Editor.registerComponent(Spin);"};
    E.plugins.push(p);
    env.runPlugin(p);
    assert.equal(p.error, null);
    assert.equal(E.components.some((c) => c.typeName === 'Spin'), true);
  });
});

test('registerCommandMenu lit `shortcut`, pas `raccourci`', () => {
  const env = neuf();
  if(!Array.isArray(env.defMenus)) return;   // ui.js non chargé dans ce contexte
  jouer(env, 'menu', (E) => {
    E.registerCommandMenu({menu: 'TestMenu', caption: 'X', shortcut: 'Ctrl+K', action(){}});
  });
  const m = env.defMenus.find((x) => x.title === 'TestMenu');
  assert.equal(m.items[0].shortcut, 'Ctrl+K');
});

test('registerSystem branche un système dans la boucle partagée, et le retrait l en sort', () => {
  const env = creerContexte(['js/ui/registry.js', 'js/ui/form-plan.js', 'js/ui/fields.js',
    'js/ui/prefs.js', 'js/component-registry.js', 'js/component.js', 'js/systems.js',
    'js/plugin-host.js', 'js/plugins.js']);
  env.setStatus = function(){}; env.logConsole = function(){};
  let appels = 0;
  jouer(env, 'sys', (E) => {
    E.registerSystem({name: 'compteur', onFrame(){ appels++; }});
    E.registerSystem({name: 'compteur', onFrame(){ appels++; }});   // réenregistré : remplace
  });
  env.System.runFrame(0.016, {mode: 'edit'});
  assert.equal(appels, 1);
  env.removePluginExtensions('sys');
  env.System.runFrame(0.016, {mode: 'edit'});
  assert.equal(appels, 1);
  assert.throws(() => jouer(env, 'x', (E) => E.registerSystem({name: 'sans'})), /onFrame/);
});

test('un plugin coché « Dans le projet » est copié dans project.settings.plugins', () => {
  const env = neuf();
  env.project = {settings: {}};
  env.updateProject = function(){};
  const p = {name: 'outil', code: '/* v1 */', uid: 'u1'};
  env.setPluginInProject(p, true);
  assert.deepEqual(JSON.parse(JSON.stringify(env.project.settings.plugins)),
                   [{name: 'outil', code: '/* v1 */', uid: 'u1'}]);
  assert.equal(env.isPluginInProject(p), true);
  env.setPluginInProject(p, false);
  assert.equal(env.project.settings.plugins.length, 0);
});

test('l hôte du jeu publié rejoue composants, systèmes, types et matériaux ; ignore le reste', () => {
  const env = creerContexte(['js/component-registry.js', 'js/component.js', 'js/systems.js',
                             'js/plugin-host.js']);
  const code = [
    "class Spin extends Editor.api.Component { static get typeName(){ return 'Jeu.Spin'; } }",
    "Editor.registerComponent(Spin);",
    "Editor.registerSystem({name: 'tourne', requires: ['Jeu.Spin'], onFrame(){ globalThis.tours = (globalThis.tours||0)+1; }});",
    "Editor.registerTypeObject({type: 'jeu-borne', make(){ return {userData: {}}; }});",
    "Editor.registerMaterial({name: 'Holo', make(){ return {isMaterial: true}; }});",
    "Editor.registerPanel({id: 'p', title: 'P'}); Editor.registerCommandMenu({caption: 'x', action(){}});",
    "if(!Editor.runtime) throw new Error('runtime attendu');"
  ].join('\n');
  env.PluginHost.run([{name: 'jeu', code: code}, {name: 'casse', code: 'throw new Error("x")'}]);
  assert.ok(env.PluginHost.typeOf('jeu-borne'));
  assert.ok(env.PluginHost.materialOf('Holo'));
  assert.equal(env.System.list.some((s) => s.name === 'tourne' && s.plugin === 'jeu'), true);
  assert.equal(env.Registry.registeredClasses.some((c) => c.typeName === 'Jeu.Spin'), true);
});

test('un panneau de plugin recoit une ZONE, sinon il n existe nulle part', () => {
  // LE DEFAUT SILENCIEUX, mesure le 2026-09-30 en installant un vrai plugin. `Dock.listable()`
  // — la source du menu Fenetres — ecarte tout descripteur sans zone. Un plugin qui suivait la
  // documentation a la lettre (`{id, title, sections}`, les seuls champs annonces obligatoires)
  // obtenait un panneau declare, enregistre, SANS ERREUR, et introuvable : absent du menu,
  // jamais monte, aucun message.
  const env = neuf();
  jouer(env, 'sans-zone', (E) => {
    const id = E.registerPanel({id: 'p', title: 'Sans zone'});
    const decl = E.panels.find((x) => x.id === id);
    assert.equal(decl.descriptor.defaultZone, 'right',
      'un panneau sans zone reste invisible : ni menu Fenetres, ni montage, ni erreur');
  });
  // Ce que le plugin CHOISIT prime : on comble un manque, on ne dicte pas la mise en page.
  jouer(env, 'avec-zone', (E) => {
    const id = E.registerPanel({id: 'q', title: 'Avec zone', defaultZone: 'bottom'});
    assert.equal(env.Editor.panels.find((x) => x.id === id).descriptor.defaultZone, 'bottom');
  });
});

test('un plugin peut FAIRE ENTRER un fichier dans le projet', () => {
  // LE METRE QUI MANQUAIT. Un plugin qui va chercher un modele ailleurs — un studio d'asset
  // local, une bibliotheque en ligne — pouvait le telecharger et ne rien en faire :
  // `importFiles` n'etait ni globale ni dans `api`, et il fallait demander a la personne de
  // glisser le fichier elle-meme.
  //
  // On verifie la DELEGATION, pas la presence d'un nom : c'est le chemin ordinaire du
  // glisser-deposer qui doit etre emprunte, sinon un modele importe par un plugin serait traite
  // autrement qu'un modele glisse — et l'ecart se verrait des le premier .glb anime.
  const env = neuf();
  const recu = [];
  env.importFiles = function(files, opts){ recu.push({files: Array.from(files), opts: opts}); };
  sansPontGlobal(env, (E) => {
    assert.equal(typeof E.api.importFiles, 'function',
      'Editor.api.importFiles a disparu : un plugin ne peut plus rien faire entrer dans le projet');
    const p = {name: 'import', active: true, uid: 'u-import', code:
      "Editor.api.importFiles([{name: 'modele.glb'}], {silencieux: true});"};
    E.plugins.push(p);
    env.runPlugin(p);
    assert.equal(p.error, null, 'le plugin a leve : ' + p.error);
  });
  assert.equal(recu.length, 1, 'l appel n a pas atteint le chemin d import du moteur');
  assert.equal(recu[0].files[0].name, 'modele.glb');
  assert.equal(recu[0].opts.silencieux, true, 'les options doivent etre transmises telles quelles');
});

test('projectSettingsOf garde les plugins du projet, et un projet sans plugins en reçoit []', () => {
  const env = creerContexte(['js/project-settings.js']);
  assert.deepEqual(JSON.parse(JSON.stringify(env.projectSettingsOf({}).plugins)), []);
  const s = env.projectSettingsOf({settings: {plugins: [{name: 'a', code: 'x'}]}});
  assert.equal(s.plugins[0].name, 'a');
});
