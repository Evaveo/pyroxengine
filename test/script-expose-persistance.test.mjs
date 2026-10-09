import { deEsm } from './engine-env.mjs';
// moteur/test/script-expose-persistance.test.mjs
//
// Les valeurs des variables @expose d'un ScriptJS doivent SURVIVRE à une sauvegarde et
// atteindre le jeu publié. Elles vivaient sur le composant, que serializeObject n'écrit
// pas : réglées dans l'inspecteur, elles disparaissaient au rechargement du project — et
// n'arrivaient jamais dans un build, qui recopie userData.scripts tel quel. Aucun message.
//
// La garde porte sur le CHEMIN de données (l'entrée poussée dans userData.scripts), pas sur
// l'interface : c'est lui qui avait été coupé.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));

// LE CODE VIT SUR L'ASSET, PAS SUR L'ENTRÉE. Le composant ne porte plus que `scriptId` : le
// harnais doit donc fournir la table `assets` que l'éditeur expose globalement, sinon `c.code`
// rend '' et aucune variable @expose n'est trouvée. Un seul asset suffit ici — c'est justement
// ce que la référence garantit : un code, plusieurs porteurs.
const ID_ASSET = 'a1';

function contexteScriptJS(champsDom) {
  // Faux DOM minimal : getElementById rend l'object-field fourni par le test, comme le
  // ferait l'inspecteur réel après insertion du HTML de htmlInspecteur().
  const elements = champsDom || {};
  const ctx = {
    assets: [{ id: ID_ASSET, kind: 'script', name: 'Script 1', code: CODE }],
    document: {
      getElementById: (id) => elements[id] || null,
      activeElement: null
    },
    renderFieldComponent: (field) => '<input id="f-comp-' + field.field.replace(/\./g, '-') + '">',
    escapeHtml: (s) => String(s),
    restaurerActif: (instance, data) => {
      if (data && data.active !== undefined) instance.active = data.active;
      return instance;
    }
  };
  vm.createContext(ctx);
  // js/component-views.js : depuis que la presentation est sortie des composants, c'est
  // LUI qui porte le remplissage des champs @expose (ComponentViews.sync). Son
  // chargement est inoffensif hors editeur — le fichier ne fait que declarer des vues,
  // dont les body ne s'executent qu'a l'appel.
  for (const f of ['js/component-registry.js', 'js/component.js', 'js/components/component-script.js', 'js/component-views.js',
                   'js/ui/registry.js', 'js/ui/form-plan.js', 'js/ui/panels-components.js']) {
    vm.runInContext(deEsm(fs.readFileSync(path.join(dirname, '..', f), 'utf8')), ctx);
  }
  // `class X {}` en tête de script crée une liaison LEXICALE, jamais une propriété du
  // global : ctx.ScriptJS reste undefined. On les récupère en évaluant leur nom dans le
  // contexte, seul medium d'atteindre la portée lexicale de celui-ci.
  return {
    ScriptJS: vm.runInContext('ScriptJS', ctx),
    parseExposures: vm.runInContext('parseExposures', ctx),
    ComponentViews: vm.runInContext('ComponentViews', ctx),
    ComponentPanels: vm.runInContext('ComponentPanels', ctx),
    planForm: vm.runInContext('planForm', ctx),
    assets: ctx.assets,
    document: ctx.document
  };
}

const CODE = [
  '/** @expose speed {number} = 5',
  ' *  @expose target {node}',
  ' */',
  'function update(api){ api.me.position.x += api.expose.speed * api.dt; }'
].join('\n');

test('les valeurs @expose vivent sur l\'entrée userData.scripts, pas sur le composant', () => {
  const ctx = contexteScriptJS();
  const node = { userData: {} };
  const c = new ctx.ScriptJS(node, { scriptId: ID_ASSET });
  c.onAdd();

  const entry = node.userData.scripts[0];
  assert.equal(node.userData.scripts.length, 1);
  // le défaut déclaré est appliqué…
  assert.equal(c.values.speed, 5);
  // …et il est LU depuis l'entrée sérialisable, pas depuis un champ du composant
  assert.equal(entry.values.speed, 5,
    'values doit vivre sur userData.scripts[i] — c\'est la seule chose que la scène écrit');

  c.values.speed = 12;
  assert.equal(entry.values.speed, 12,
    'régler une valeur dans l\'inspecteur doit modifier l\'entrée sérialisée');
});

test('une valeur réglée survit au cycle sauvegarde → rechargement', () => {
  const ctx = contexteScriptJS();
  const node = { userData: {} };
  const c = new ctx.ScriptJS(node, { scriptId: ID_ASSET });
  c.onAdd();
  c.values.speed = 42;
  c.values.target = 'Joueur';

  // ce que serializeObject écrit dans la scène : une copie JSON de userData.scripts
  const scenePersistee = JSON.parse(JSON.stringify(node.userData.scripts));
  assert.equal(scenePersistee[0].values.speed, 42,
    'la valeur doit être présente dans la scène enregistrée');

  // rechargement : syncComponents rattache un ScriptJS par entrée relue
  const noeud2 = { userData: {} };
  const c2 = new ctx.ScriptJS(noeud2, {
    scriptId: scenePersistee[0].scriptId,
    active: scenePersistee[0].active,
    values: scenePersistee[0].values
  });
  c2.onAdd();
  assert.equal(c2.values.speed, 42, 'la valeur réglée ne doit pas repartir à son défaut');
  assert.equal(c2.values.target, 'Joueur');
});

test('serialiser() rend les valeurs, et un défaut ne les écrase pas', () => {
  const ctx = contexteScriptJS();
  const node = { userData: {} };
  const c = new ctx.ScriptJS(node, { scriptId: ID_ASSET, values: { speed: 3 } });
  c.onAdd();
  assert.equal(c.serialize().values.speed, 3,
    'onAjout ne doit pas remettre le défaut déclaré sur une clé déjà réglée');
});

// LES VALEURS @EXPOSE ATTEIGNENT LES CHAMPS. Depuis v0.96.x, la vue de ScriptJS est un
// DESCRIPTEUR (js/ui/panels-components.js) : ses champs ne sont plus fabriqués à la main, et
// c'est le socle qui les remplit. Ce qu'on garde est inchangé — les variables exposées portent
// leur valeur, et non des cases blanches indiscernables d'un « rien n'est exposé ».
//
// La règle « ne pas écraser un champ en cours de saisie » n'est plus l'affaire de ce composant :
// elle est garantie une fois pour toutes par la couche DOM du socle, et mesurée par
// test/ui-formulaire-dom.test.mjs (« sync ne touche PAS un champ qui a le focus »).
test('les variables @expose arrivent dans le plan, avec leurs valeurs', () => {
  const ctx = contexteScriptJS();
  const node = { userData: { scripts: [] } };
  const entry = { scriptId: ID_ASSET, values: { speed: 7, target: 'Joueur' } };
  node.userData.scripts.push(entry);
  const c = new ctx.ScriptJS(node, entry);
  c.onAdd();

  const plan = ctx.planForm(ctx.ComponentPanels.ScriptJS, [c]);
  const champs = plan.sections.reduce((a, sec) => a.concat(sec.entries), [])
    .filter((e) => e.kind === 'field' && e.ids[0].indexOf('f-comp-values-') === 0);
  const parId = {};
  champs.forEach((e) => { parId[e.ids[0]] = e; });

  assert.equal(parId['f-comp-values-speed'].value, 7,
    'le champ doit porter la valeur réglée, pas rester vide');
  assert.equal(parId['f-comp-values-target'].value, 'Joueur');
  assert.equal(parId['f-comp-values-speed'].type, 'number',
    'le type déclaré par @expose choisit le type de champ');
});

test('une variable @expose jamais réglée prend son défaut déclaré', () => {
  const ctx = contexteScriptJS();
  const node = { userData: { scripts: [] } };
  const entry = { scriptId: ID_ASSET, values: {} };
  node.userData.scripts.push(entry);
  const c = new ctx.ScriptJS(node, entry);
  c.onAdd();

  ctx.planForm(ctx.ComponentPanels.ScriptJS, [c]);
  assert.equal(c.values.speed, 5,
    'sans defaut applique, le script tourne avec une valeur que personne n a choisie');
});

// Le runtime a sa PROPRE copie du parseur (rtParseExposures) : le jeu publié n'embarque
// pas le système de composants. Deux copies qui divergent, c'est exactement le bug qui a
// fait planter api.node — on vérifie donc qu'elles lisent la même déclaration pareil.
test('le parseur @expose du runtime lit la même chose que celui de l\'éditeur', () => {
  const ctx = contexteScriptJS();
  const attendu = ctx.parseExposures(CODE);

  const rt = { game: { objects: [] } };
  vm.createContext(rt);
  const source = fs.readFileSync(path.join(dirname, '..', 'js', 'game-runtime.js'), 'utf8');
  const start = source.indexOf('function rtParseExposures');
  assert.notEqual(start, -1, 'rtParseExposures doit exister dans le runtime');
  const end = source.indexOf('function rtValuesExposed');
  vm.runInContext(source.slice(start, end), rt);

  // Comparaison sur les DONNÉES et non sur les objets : les deux parseurs vivent dans deux
  // contextes vm distincts, donc deux prototypes Object différents — deepStrictEqual
  // échouerait sur des valeurs pourtant identiques.
  assert.equal(JSON.stringify(rt.rtParseExposures(CODE)), JSON.stringify(attendu),
    'les deux parseurs doivent produire exactement les mêmes expositions');
});
