import { HELP_SCRIPTS, readHelpSource } from './help-env.mjs';
import { deEsm } from './engine-env.mjs';
// L'aide n'a de valeur que si elle est VRAIE du code de ce dépôt. Une page qui décrit un
// logiciel légèrement différent de celui qu'on a sous les yeux fait douter de tout le
// reste — c'est pire que pas d'aide.
//
// Une règle « on n'invente rien » qu'on se contente de promettre ne tient pas. Ce fichier
// la rend MÉCANIQUE. Il confronte l'aide au code sur cinq fronts :
//   1. les ANCRES — chaque page déclare les bouts de code exacts qui portent ses chiffres,
//      et chacun doit exister mot pour mot dans le fichier nommé ;
//   2. le CATALOGUE DU COPILOTE — comparé dans les deux sens à COMMANDS, chargé depuis
//      js/copilot.js lui-même ;
//   3. l'API DE SCRIPT — chaque nom cité doit être une entrée de apiFor() ;
//   4. les RACCOURCIS — chaque touche listée doit apparaître dans le code qui la traite ;
//   5. les LIENS et les FICHIERS cités, qui doivent mener quelque part.
//
// Chaque contrôle porte une assertion de VOLUME (« au moins N »). Sans elle, une
// extraction qui casse rendrait une liste vide, et un test qui ne vérifie rien passe au
// vert — c'est la façon la plus courante d'écrire une garde incapable d'échouer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(dirname, '..');

function read(relatif){ return readFileSync(path.join(root, relatif), 'utf8'); }

// ---------- Un DOM juste assez grand pour help-page.js ----------
// Écrit à la main, sans dépendance npm : la page n'a besoin que de quatre choses (poser
// du innerHTML, lire un champ, câbler un écouteur, mettre à plat du HTML pour la
// recherche). Un vrai navigateur n'apporterait rien de plus à ce que ces tests vérifient.
function faireElement(){
  const el = {
    value: '', innerHTML: '', dataset: {},
    addEventListener(){}, closest(){ return null; },
    querySelectorAll(){ return []; }
  };
  return el;
}
function faireDocument(){
  const parElement = new Map();
  return {
    getElementById(id){
      if(!parElement.has(id)) parElement.set(id, faireElement());
      return parElement.get(id);
    },
    createElement(){
      const el = faireElement();
      // Seul usage réel : mettre une page à plat pour la recherche. On retire les
      // balises, ce que fait `textContent` sur un vrai élément.
      Object.defineProperty(el, 'textContent', {
        get(){ return String(el.innerHTML).replace(/<[^>]*>/g, ' '); }
      });
      return el;
    },
    addEventListener(){},
    title: ''
  };
}

// Charge les scripts d'help.html dans un contexte vm, dans le même ordre que la page.
function contexteAide(){
  const bac = {
    console, Math, JSON, Object, Array, Map, Set, String, Number, RegExp, Error, decodeURIComponent,
    document: faireDocument(),
    location: {hash: ''},
    addEventListener(){},
    scrollTo(){}
  };
  bac.window = bac;
  bac.globalThis = bac;
  const ctx = vm.createContext(bac);
  HELP_SCRIPTS
    .forEach(function(f){
      vm.runInContext(deEsm(read(f)), ctx, {filename: f});
    });
  // Un `const` de premier niveau exécuté par vm rejoint l'environnement lexical du
  // contexte mais ne devient jamais une propriété de l'object global : sans ce pont, les
  // tables resteraient invisibles depuis le test.
  const aPonter = ['PARTS_HELP', 'PAGES_HELP', 'GLOSSARY_HELP', 'SHORTCUTS_HELP', 'COMMANDS_HELP',
                   'API_HELP', 'PROPS_MATERIAL'];
  vm.runInContext(aPonter.map(function(n){ return `this.${n} = ${n};`; }).join('\n'), ctx);
  // RAPATRIEMENT DANS LE ROYAUME DE L'HÔTE, et ce n'est pas de la cosmétique. Un tableau
  // né dans un contexte vm porte le prototype de CE contexte : `assert.deepEqual(liste, [])`
  // échoue alors même que les deux sont vides, en affichant « [] » des deux côtés — un
  // message qui n'aide personne et fait chercher un défaut de contenu là où il n'y en a
  // pas. Trois tests de ce fichier tombaient là-dessus. Le dépôt s'y était déjà fait
  // prendre ailleurs (tests dossierProjet).
  // Seuls les TABLEAUX sont recopiés ; les objets qu'ils portent restent ceux du vm, ce
  // qui suffit pour lire leurs propriétés.
  aPonter.forEach(function(n){
    if(Array.isArray(bac[n])) bac[n] = Array.from(bac[n]);
  });
  // Les générateurs sont des `function` de premier level : déjà sur l'object global.
  return bac;
}

const help = contexteAide();

// Le HTML de toutes les pages, rendu une fois — c'est le texte que le lecteur verra.
const htmlParPage = new Map(help.PAGES_HELP.map(function(p){ return [p.id, p.html()]; }));
const toutLeHtml = Array.from(htmlParPage.values()).join('\n');


// ---------- 1. Les ancres ----------

test('chaque page déclare des ancres, et chaque ancre existe encore dans le code', () => {
  const manquantes = [];
  let total = 0;
  help.PAGES_HELP.forEach((p) => {
    assert.ok(p.anchors && p.anchors.length,
      `la page « ${p.id} » n'a aucune ancre : rien ne la rattache au code`);
    p.anchors.forEach((a) => {
      total++;
      if(!existsSync(path.join(root, a.f))){ manquantes.push(`${p.id} : file absent ${a.f}`); return; }
      if(read(a.f).indexOf(a.c) === -1) manquantes.push(`${p.id} → ${a.f} ne contient plus : ${a.c}`);
    });
  });
  assert.deepEqual(manquantes, [], 'anchors périmées :\n' + manquantes.join('\n'));
  assert.ok(total >= 40, `seulement ${total} anchors relevées — l'extraction a-t-elle cassé ?`);
});


// ---------- 2. Le catalogue du copilote ----------

// js/copilot.js n'est pas chargé par help.html (il tirerait three.js) : le TEST, lui,
// peut le charger avec deux bouchons, et comparer la liste réelle à celle de l'aide.
//
// LES TROIS FICHIERS, ET C'EST LE CŒUR DE LA GARDE. `COMMANDS` naît dans js/copilot.js,
// puis js/copilot-workshop.js et js/copilot-observer.js y POUSSENT les leurs — c'est ce
// qui leur permet d'exister sans toucher au fichier d'origine. Ce test n'en lisait qu'un
// seul, et se disait pourtant « exactement ». Il a donc certifié pendant huit versions une
// aide à qui manquaient SEIZE des quarante-sept commandes, sans jamais rougir. Une garde
// qui ne regarde qu'une partie de ce qu'elle prétend couvrir est plus dangereuse qu'une
// garde absente : elle fait croire que la question est réglée.
const FICHIERS_COMMANDES = ['js/copilot.js', 'js/copilot-workshop.js', 'js/copilot-observer.js', 'js/copilot-blender.js'];

function commandesDuMoteur(){
  const bac = {
    console, Math, JSON, Object, Array, Map, Set, String, Number, RegExp, Error,
    THREE: {Box3: function(){}, MathUtils: {degToRad(){ return 0; }}, Vector3: function(){}},
    document: faireDocument(),
    localStorage: {getItem(){ return null; }, setItem(){}, removeItem(){}},
    addEventListener(){}
  };
  bac.window = bac;
  bac.globalThis = bac;
  const ctx = vm.createContext(bac);
  // Les deux modules dont copilot.js lit des valeurs au premier niveau (domaines d'outils,
  // outils d'inspection) : chargés d'abord, sans compter parmi les fichiers de commandes.
  ['js/ai-rules.js', 'js/ai-trace.js', 'js/ai-guidelines.js', 'js/copilot-budget.js', 'js/copilot-inspect.js'].concat(FICHIERS_COMMANDES).forEach(function(f){
    vm.runInContext(deEsm(read(f)), ctx, {filename: f});
  });
  vm.runInContext('this.COMMANDS = COMMANDS;', ctx);
  // `Array.from` RAPATRIE la liste dans le royaume de l'hôte. Un tableau né dans un
  // contexte vm porte le prototype de CE contexte : `assert.deepEqual(tableauVm, [])`
  // échoue alors même que les deux sont vides, en affichant « [] » des deux côtés — un
  // message qui n'aide personne. Le dépôt s'y est déjà fait prendre (tests dossierProjet).
  return Array.from(bac.COMMANDS, function(c){ return String(c.name); });
}

test('l\'aide list EXACTEMENT les commandes que le copilote expose', () => {
  const duMoteur = commandesDuMoteur();
  assert.ok(duMoteur.length >= 45,
    `seulement ${duMoteur.length} commandes lues — le chargement a échoué`);

  // CHAQUE FICHIER DOIT AVOIR CONTRIBUÉ. C'est l'assertion qui manquait : un « au moins 20 »
  // global restait vrai avec deux fichiers sur trois muets, et c'est exactement ce qui est
  // arrivé. Le nom des commandes est lu au texte, donc indépendamment du chargement en bac :
  // si l'un des trois n'a rien poussé, on le nomme au lieu d'annoncer un total plausible.
  FICHIERS_COMMANDES.forEach((f) => {
    const names = Array.from(read(f).matchAll(/name: *'([a-z_0-9]+)'/g), (m) => m[1]);
    assert.ok(names.length, `${f} ne déclare aucune commande — la lecture est cassée`);
    const absentes = names.filter((n) => duMoteur.indexOf(n) === -1);
    assert.deepEqual(absentes, [],
      `${f} déclare des commandes que le bac n'a pas vues (${absentes.join(', ')}) : `
      + 'le fichier a-t-il levé au chargement ?');
  });

  const documentees = help.COMMANDS_HELP.map((c) => c.name);
  const oubliees = duMoteur.filter((n) => documentees.indexOf(n) === -1);
  const inventees = documentees.filter((n) => duMoteur.indexOf(n) === -1);

  assert.deepEqual(oubliees, [], 'commandes du moteur absentes de l\'aide : ' + oubliees.join(', '));
  assert.deepEqual(inventees, [], 'commandes citées par l\'aide qui n\'existent pas : ' + inventees.join(', '));

  // et le tableau affiché les montre toutes
  const render = help.renderCommandsHelp();
  duMoteur.forEach((n) => {
    assert.ok(render.indexOf('<code>' + n + '</code>') !== -1, `« ${n} » manque au tableau affiché`);
  });
});


// ---------- 3. L'API de script ----------

// Les clés de l'object littéral renvoyé par apiFor() (js/scripts.js). Charger scripts.js
// entier demanderait la moitié du moteur ; on lit donc le littéral, à une indentation
// fixe de quatre espaces. Le garde qui rend cette lecture sûre est plus bas : TOUTES les
// clés de ALIAS_API doivent s'y retrouver, sinon c'est l'extraction qui est cassée.
function clesApiDuMoteur(){
  const src = read('js/scripts.js');
  const start = src.indexOf('return ({');
  assert.notEqual(start, -1, 'apiFor() ne commence plus par `return ({`');
  const end = src.indexOf('\n  });', start);
  assert.notEqual(end, -1, 'end de l\'object api introuvable');
  const keys = new Set();
  src.slice(start, end).split('\n').forEach(function(line){
    const m = line.match(/^ {4}(?:get\s+)?([A-Za-z_$][\w$]*)\s*[:(]/);
    if(m) keys.add(m[1]);
  });
  return keys;
}

test('chaque nom d\'api cité par l\'aide existe dans apiFor()', () => {
  const reelles = clesApiDuMoteur();
  assert.ok(reelles.size >= 40, `seulement ${reelles.size} entrées d'api lues — extraction cassée ?`);


  const cited = help.API_HELP.filter((e) => e.name).map((e) => e.name);
  assert.ok(cited.length >= 40, `l'aide ne documente que ${cited.length} entrées d'api`);
  const inventees = cited.filter((n) => !reelles.has(n));
  assert.deepEqual(inventees, [], 'api inventée par l\'aide : ' + inventees.join(', '));

  // la signature affichée doit porter le nom qu'elle prétend décrire
  help.API_HELP.filter((e) => e.name).forEach((e) => {
    assert.ok(e.sig.indexOf('api.' + e.name) === 0,
      `signature incohérente : « ${e.sig} » ne décrit pas ${e.name}`);
  });
});


// ---------- 4. Les raccourcis ----------

test('chaque raccourci listé apparaît dans le code qui le traite', () => {
  const faux = [];
  let total = 0;
  help.SHORTCUTS_HELP.forEach((r) => {
    if(r.group) return;
    total++;
    assert.ok(r.file && r.proof, `le raccourci « ${r.key} » n'est adossé à rien`);
    if(!existsSync(path.join(root, r.file))){ faux.push(`${r.key} : ${r.file} absent`); return; }
    if(read(r.file).indexOf(r.proof) === -1) faux.push(`${r.key} → introuvable dans ${r.file} : ${r.proof}`);
  });
  assert.deepEqual(faux, [], 'raccourcis périmés :\n' + faux.join('\n'));
  assert.ok(total >= 15, `seulement ${total} raccourcis relevés`);
});


// ---------- 5. Liens internes, files cités, tableaux engendrés ----------

test('tous les links internes mènent quelque part', () => {
  const ids = help.PAGES_HELP.map((p) => p.id).concat('glossary');
  const termes = help.GLOSSARY_HELP.map((g) => g.terme.toLowerCase());
  const casses = [];

  htmlParPage.forEach((html, id) => {
    for(const m of html.matchAll(/data-help="([^"]+)"/g)){
      if(ids.indexOf(m[1]) === -1) casses.push(`${id} -> ${m[1]}`);
    }
    for(const m of html.matchAll(/data-term="([^"]+)"/g)){
      const t = m[1].toLowerCase();
      if(!termes.some((x) => x.indexOf(t) !== -1)) casses.push(`${id} -> terme « ${m[1]} »`);
    }
  });
  help.GLOSSARY_HELP.forEach((g) => {
    if(ids.indexOf(g.page) === -1) casses.push(`glossaire « ${g.terme} » -> ${g.page}`);
  });

  assert.deepEqual(casses, [], 'links cassés : ' + casses.join(' | '));
  assert.ok(help.PAGES_HELP.length >= 15, 'le sommaire a fondu — pages perdues ?');
});

test('tout fichier du dépôt cité par l\'aide existe', () => {
  const cited = new Set();
  for(const m of toutLeHtml.matchAll(/\b((?:js|css|test)(?:\/[\w.-]+)+\.(?:js|mjs|css|html))\b/g)){
    cited.add(m[1]);
  }
  for(const m of toutLeHtml.matchAll(/\b([a-z-]+\.html)\b/g)) cited.add(m[1]);
  assert.ok(cited.size >= 4, `seulement ${cited.size} files cités — l'extraction a-t-elle cassé ?`);
  const absents = Array.from(cited).filter((f) => !existsSync(path.join(root, f)));
  assert.deepEqual(absents, [], 'files cités qui n\'existent pas : ' + absents.join(', '));
});

test('les absences que l\'aide affirme sont encore des absences', () => {
  // La page « Profiler » dit que le profiler n'existe pas dans le jeu. Une affirmation
  // négative ne peut pas s'ancrer sur un bout de code : elle s'ancre sur son contraire.
  assert.ok(read('editor.html').indexOf('js/profiler.js') !== -1,
    'l\'éditeur ne charge plus le profiler — la page « Profiler » est à réécrire');
  assert.equal(read('game-preview.html').indexOf('js/profiler.js'), -1,
    'l\'aperçu de jeu charge désormais le profiler : l\'aide affirme le contraire');

  // La page « Multijoueur » dit qu'un build ne contient pas le panneau créer/rejoindre.
  assert.equal(read('game-preview.html').indexOf('js/network-editor.js'), -1,
    'l\'aperçu de jeu embarque le panneau réseau : l\'aide affirme le contraire');
  assert.ok(read('game-preview.html').indexOf('js/network-game.js') !== -1,
    'l\'aperçu de jeu n\'embarque plus le moteur réseau — l\'aide affirme le contraire');
});

test('le tableau des matériaux est engendré depuis PROPS_MATERIAL, en entier', () => {
  const render = help.renderPropsMaterialHelp();
  const keys = help.PROPS_MATERIAL.filter((d) => d.key).map((d) => d.key);
  assert.ok(keys.length >= 15, `seulement ${keys.length} propriétés dans PROPS_MATERIAL`);
  const oubliees = keys.filter((c) => render.indexOf('<code>' + c + '</code>') === -1);
  assert.deepEqual(oubliees, [], 'propriétés absentes du tableau : ' + oubliees.join(', '));

  // les plages affichées viennent de la table, pas d'une recopie
  const smoothness = help.PROPS_MATERIAL.find((d) => d.key === 'smoothness');
  assert.ok(render.indexOf(smoothness.min + ' à ' + smoothness.max) !== -1,
    'la plage du lissage n\'est pas celle que déclare PROPS_MATERIAL');
});



// ---------- 6. Le câblage : l'aide doit vraiment s'ouvrir ----------

test('le menu Aide et F1 ouvrent la page', () => {
  const aideJs = read('js/help.js');
  assert.ok(/function openHelp\(/.test(aideJs), 'openHelp() a disparu de js/help.js');
  assert.ok(aideJs.indexOf("'help.html'") !== -1, 'js/help.js n\'ouvre plus help.html');

  assert.ok(read('js/viewport.js').indexOf("if(e.key === 'F1')") !== -1,
    'F1 n\'est plus traité dans js/viewport.js');
  assert.ok(read('js/viewport.js').indexOf('openContextHelp()') !== -1,
    'F1 n\'appelle plus openContextHelp()');

  const ui = read('js/ui.js');
  assert.ok(ui.indexOf("shortcut:'F1', action:function(){ openHelp(); }") !== -1,
    'l\'entrée de menu « Aide de l\'éditeur » n\'ouvre plus la page');
  // les entrées qui pointaient vers les anciennes modales doivent viser des pages réelles
  const ids = help.PAGES_HELP.map((p) => p.id).concat('glossary');
  for(const m of ui.matchAll(/openHelp\('([^']+)'\)/g)){
    assert.ok(ids.indexOf(m[1]) !== -1, `le menu ouvre « ${m[1] } », qui n'est pas une page`);
  }

  const html = read('help.html');
  ['js/material-props.js', 'js/help-content.js', 'js/help-page.js']
    .forEach((f) => {
      assert.ok(html.indexOf(f) !== -1, `help.html ne charge pas ${f}`);
    });
  assert.ok(read('editor.html').indexOf('js/help.js') !== -1,
    'l\'éditeur ne charge plus js/help.js : F1 n\'ouvrirait rien');
});

test('help.html ne charge que des fichiers du moteur sans effet de bord', () => {
  // Ces deux-là sont chargés pour leurs seules TABLES. S'ils se mettaient à toucher au
  // DOM au chargement, la page d'aide lèverait une erreur — et perdrait ses tableaux
  // engendrés sans que personne ne s'en aperçoive avant de la rouvrir.
  ['js/material-props.js'].forEach((f) => {
    const fautives = read(f).split('\n')
      .map((l, i) => ({n: i + 1, l}))
      .filter((x) => /^(document|window|addEventListener)\b/.test(x.l));
    assert.deepEqual(fautives.map((x) => `${f}:${x.n}`), [],
      `${f} agit au chargement : il ne peut plus être chargé par help.html`);
  });
});


// ---------- 7. Le manuel : parties, niveaux, fiches de composants, aide contextuelle ----------

test('chaque page a un id unique, une partie connue et un niveau connu', () => {
  const parts = help.PARTS_HELP.map((p) => p.id);
  const vus = new Set();
  const fautes = [];
  help.PAGES_HELP.forEach((p) => {
    if(vus.has(p.id)) fautes.push(`id en double : ${p.id}`);
    vus.add(p.id);
    if(parts.indexOf(p.part) === -1) fautes.push(`${p.id} : partie inconnue « ${p.part} »`);
    if(p.level && ['beginner', 'advanced', 'both'].indexOf(p.level) === -1)
      fautes.push(`${p.id} : niveau inconnu « ${p.level} »`);
  });
  assert.deepEqual(fautes, [], fautes.join(' | '));
});

// Les typeName lus au TEXTE dans js/components/ : ce que l'inspecteur peut afficher.
function typeNamesDuMoteur(){
  const dir = path.join(root, 'js/components');
  const noms = new Set();
  readdirSync(dir).filter((f) => f.endsWith('.js')).forEach((f) => {
    for(const m of readFileSync(path.join(dir, f), 'utf8').matchAll(/static get typeName\(\) *\{ *return '([A-Za-z0-9]+)'/g)) noms.add(m[1]);
  });
  return Array.from(noms);
}

test("chaque composant a sa fiche : le « ? » de l'inspecteur ne mène jamais nulle part", () => {
  const noms = typeNamesDuMoteur();
  assert.ok(noms.length >= 30, `seulement ${noms.length} composants lus — extraction cassée ?`);
  const ids = help.PAGES_HELP.map((p) => p.id);
  const sansFiche = noms.filter((n) => ids.indexOf('component-' + n) === -1);
  assert.deepEqual(sansFiche, [], 'composants sans fiche dans le manuel : ' + sansFiche.join(', '));
  assert.ok(read('js/inspector.js').indexOf('data-help-component') !== -1,
    "l'inspecteur ne pose plus le « ? » sur les composants");
});

test("chaque panneau relié à l'aide mène à une page réelle", () => {
  const src = read('js/help.js');
  const bloc = src.slice(src.indexOf('HELP_PAGE_OF_PANEL = {'), src.indexOf('};', src.indexOf('HELP_PAGE_OF_PANEL = {')));
  const cibles = Array.from(bloc.matchAll(/: *'([^']+)'/g), (m) => m[1]);
  assert.ok(cibles.length >= 8, 'table des panneaux illisible');
  const ids = help.PAGES_HELP.map((p) => p.id);
  const cassees = cibles.filter((c) => ids.indexOf(c) === -1);
  assert.deepEqual(cassees, [], "panneaux dont la page d'aide n'existe pas : " + cassees.join(', '));
  assert.ok(read('js/ui/dock.js').indexOf("'dock-help'") !== -1, 'le dock ne pose plus son « ? »');
});

test('chaque fiche de composant montre des exemples de script', () => {
  const sans = help.PAGES_HELP.filter((p) => p.id.indexOf('component-') === 0)
    .filter((p) => { const h = htmlParPage.get(p.id); return h.indexOf('Exemples de scripts') === -1 || h.indexOf('<pre><code>') === -1; })
    .map((p) => p.id);
  assert.deepEqual(sans, [], 'fiches sans section « Exemples de scripts » : ' + sans.join(', '));
});
