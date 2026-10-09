// moteur/test/graphe-shader-editeur.test.mjs
// Mutations pures du graphe (ajout/suppression de nœud, links, sorties) — la partie
// testable de l'éditeur nodal, sans DOM/canvas (voir shader-graph-editor.js pour le reste,
// vérifié manuellement en navigateur comme tout ce qui touche au rendu/interaction directe).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { creerContexte } from './engine-env.mjs';

function env(){
  return creerContexte(['js/shader-graph.js', 'js/shader-graph-editor.js']);
}

test('addNodeGraphShader pousse un noeud avec les defauts de META_NOEUDS et pose son layout', () => {
  const e = env();
  const asset = {nodes:[], links:[], outputs:{}, layout:{}};
  const id = vm.runInContext(
    'addNodeGraphShader(' + JSON.stringify(asset) + ', "constant.float", 10, 20)', e);
  // relit l'asset MODIFIÉ côté vm (l'appel ci-dessus a muté sa propre copie sérialisée ;
  // on rejoue donc l'appel sur un asset persistant côté contexte pour l'inspecter)
  vm.runInContext(`
    globalThis.__a = {nodes:[], links:[], outputs:{}, layout:{}};
    globalThis.__id = addNodeGraphShader(globalThis.__a, "constant.float", 10, 20);
  `, e);
  const a = vm.runInContext('globalThis.__a', e);
  const idReel = vm.runInContext('globalThis.__id', e);
  assert.equal(a.nodes.length, 1);
  assert.equal(a.nodes[0].type, 'constant.float');
  assert.equal(a.nodes[0].params.value, 0, 'defaut de META_NOEUDS.constant.float.fields');
  assert.equal(a.nodes[0].id, idReel);
  assert.deepEqual(JSON.parse(JSON.stringify(a.layout[idReel])), {x:10, y:20});
});

test('addNodeGraphShader deux fois ne collisionne jamais sur le meme id', () => {
  const e = env();
  vm.runInContext(`
    globalThis.__a = {nodes:[], links:[], outputs:{}, layout:{}};
    globalThis.__id1 = addNodeGraphShader(globalThis.__a, "uv", 0, 0);
    globalThis.__id2 = addNodeGraphShader(globalThis.__a, "time", 0, 0);
  `, e);
  const id1 = vm.runInContext('globalThis.__id1', e);
  const id2 = vm.runInContext('globalThis.__id2', e);
  assert.notEqual(id1, id2);
});

test('deleteNodeGraphShader retire le noeud, ses links (entrant ET sortant), et le debranche des sorties', () => {
  const e = env();
  vm.runInContext(`
    globalThis.__a = {
      nodes:[{id:'a', type:'constant.float', params:{value:1}},
              {id:'b', type:'constant.float', params:{value:2}},
              {id:'somme', type:'math.add', params:{}}],
      links:[{node:'somme', entry:'a', source:'a'}, {node:'somme', entry:'b', source:'b'}],
      outputs:{color:'somme'}, layout:{a:{x:0,y:0}, b:{x:0,y:0}, somme:{x:0,y:0}}
    };
    deleteNodeGraphShader(globalThis.__a, 'a');
  `, e);
  const a = vm.runInContext('globalThis.__a', e);
  assert.equal(a.nodes.length, 2);
  assert.ok(!a.nodes.some(n => n.id === 'a'));
  assert.equal(a.links.length, 1, 'le link qui SOURçait sur "a" disparait');
  assert.equal(a.links[0].entry, 'b');
  assert.equal(a.outputs.color, 'somme', 'la sortie qui pointait sur "somme" (pas "a") reste');
  assert.equal(a.layout.a, undefined);
});

test('deleteNodeGraphShader debranche une sortie qui pointait directement sur le noeud supprime', () => {
  const e = env();
  vm.runInContext(`
    globalThis.__a = {nodes:[{id:'c', type:'constant.color', params:{color:'#fff'}}],
      links:[], outputs:{color:'c'}, layout:{}};
    deleteNodeGraphShader(globalThis.__a, 'c');
  `, e);
  const a = vm.runInContext('globalThis.__a', e);
  assert.equal(a.outputs.color, null);
});

test('setLinkGraphShader remplace un link existant sur la meme entry (pas de doublon)', () => {
  const e = env();
  vm.runInContext(`
    globalThis.__a = {nodes:[], links:[{node:'r', entry:'a', source:'x'}], outputs:{}, layout:{}};
    setLinkGraphShader(globalThis.__a, 'r', 'a', 'y');
  `, e);
  const a = vm.runInContext('globalThis.__a', e);
  assert.equal(a.links.length, 1);
  assert.equal(a.links[0].source, 'y');
});

test('setLinkGraphShader avec une source empty debranche (supprime le link)', () => {
  const e = env();
  vm.runInContext(`
    globalThis.__a = {nodes:[], links:[{node:'r', entry:'a', source:'x'}], outputs:{}, layout:{}};
    setLinkGraphShader(globalThis.__a, 'r', 'a', null);
  `, e);
  const a = vm.runInContext('globalThis.__a', e);
  assert.equal(a.links.length, 0);
});

test('setOutputGraphShader pose et debranche un slot de sortie', () => {
  const e = env();
  vm.runInContext(`
    globalThis.__a = {nodes:[], links:[], outputs:{}, layout:{}};
    setOutputGraphShader(globalThis.__a, 'color', 'n1');
  `, e);
  assert.equal(vm.runInContext('globalThis.__a.outputs.color', e), 'n1');
  vm.runInContext('setOutputGraphShader(globalThis.__a, "color", null);', e);
  assert.equal(vm.runInContext('globalThis.__a.outputs.color', e), null);
});

// ---------- Valeur inline sur un port non branché (comme Unity : un champ éditable
// directement sur le port, pas besoin de glisser un nœud Constante séparé) — implémenté en
// créant/réutilisant un nœud constante.* MARQUÉ __auto, jamais dessiné comme un nœud à part
// (voir shader-graph-editor.js, rendu). Le format de graphe lui-même (noeuds/links) ne
// change pas : ces fonctions ne sont qu'une commodité d'édition.

test('setValueInputGraphShader cree un noeud constant.float __auto et le branche, sur une entrée vierge', () => {
  const e = env();
  vm.runInContext(`
    globalThis.__a = {nodes:[{id:'somme', type:'math.add', params:{}}], links:[],
      outputs:{}, layout:{somme:{x:200,y:50}}};
    globalThis.__id = setValueInputGraphShader(globalThis.__a, 'somme', 'a', 'number', 5);
  `, e);
  const a = vm.runInContext('globalThis.__a', e);
  const id = vm.runInContext('globalThis.__id', e);
  const auto = a.nodes.find(n => n.id === id);
  assert.equal(auto.type, 'constant.float');
  assert.equal(auto.params.value, 5);
  assert.equal(auto.params.__auto, true);
  assert.equal(a.links.length, 1);
  assert.deepEqual({node:a.links[0].node, entry:a.links[0].entry, source:a.links[0].source},
    {node:'somme', entry:'a', source:id});
});

test('setValueInputGraphShader reutilise le noeud __auto existant (pas de doublon) si on retape une valeur', () => {
  const e = env();
  vm.runInContext(`
    globalThis.__a = {nodes:[{id:'somme', type:'math.add', params:{}}], links:[], outputs:{}, layout:{}};
    setValueInputGraphShader(globalThis.__a, 'somme', 'a', 'number', 5);
    setValueInputGraphShader(globalThis.__a, 'somme', 'a', 'number', 9);
  `, e);
  const a = vm.runInContext('globalThis.__a', e);
  assert.equal(a.nodes.length, 2, 'toujours "somme" + UN SEUL auto, pas deux');
  assert.equal(a.nodes[1].params.value, 9);
  assert.equal(a.links.length, 1);
});

test('setValueInputGraphShader sur une entrée deja branchee a un VRAI node (pas auto) ne le remplace pas', () => {
  const e = env();
  vm.runInContext(`
    globalThis.__a = {
      nodes:[{id:'partage', type:'constant.float', params:{value:7}},
              {id:'somme', type:'math.add', params:{}}],
      links:[{node:'somme', entry:'a', source:'partage'}], outputs:{}, layout:{}};
    setValueInputGraphShader(globalThis.__a, 'somme', 'a', 'number', 99);
  `, e);
  const a = vm.runInContext('globalThis.__a', e);
  // Un nouveau noeud auto est cree (on ne touche jamais un noeud partage/nomme par l'utilisateur) ;
  // "partage" reste intact, disponible pour d'autres links.
  assert.equal(a.nodes.length, 3);
  assert.equal(a.nodes.find(n => n.id === 'partage').params.value, 7);
  const link = a.links.find(l => l.node === 'somme' && l.entry === 'a');
  assert.notEqual(link.source, 'partage');
});

test('unbindInputGraphShader retire le link ET supprime le noeud __auto associe (sans laisser de dechet)', () => {
  const e = env();
  vm.runInContext(`
    globalThis.__a = {nodes:[{id:'somme', type:'math.add', params:{}}], links:[], outputs:{}, layout:{}};
    setValueInputGraphShader(globalThis.__a, 'somme', 'a', 'number', 5);
    unbindInputGraphShader(globalThis.__a, 'somme', 'a');
  `, e);
  const a = vm.runInContext('globalThis.__a', e);
  assert.equal(a.nodes.length, 1, 'seul "somme" reste : le noeud auto est nettoye');
  assert.equal(a.links.length, 0);
});

test('unbindInputGraphShader sur un VRAI node (pas auto) le debranche mais ne le supprime pas', () => {
  const e = env();
  vm.runInContext(`
    globalThis.__a = {
      nodes:[{id:'partage', type:'constant.float', params:{value:7}},
              {id:'somme', type:'math.add', params:{}}],
      links:[{node:'somme', entry:'a', source:'partage'}], outputs:{}, layout:{}};
    unbindInputGraphShader(globalThis.__a, 'somme', 'a');
  `, e);
  const a = vm.runInContext('globalThis.__a', e);
  assert.equal(a.nodes.length, 2, '"partage" survit au debranchement');
  assert.equal(a.links.length, 0);
});

// ---------- Refus des boucles ----------
// Un cycle n'est pas juste "bizarre" : buildNodeGraph (shader-graph.js) descend
// récursivement et ne mémoïse qu'APRÈS construction — un cycle y part en récursion infinie.
test('setLinkGraphShader refuse un link direct d un noeud sur lui-meme', () => {
  const e = env();
  vm.runInContext(`
    globalThis.__a = {nodes:[{id:'somme', type:'math.add', params:{}}], links:[], outputs:{}, layout:{}};
    globalThis.__ok = setLinkGraphShader(globalThis.__a, 'somme', 'a', 'somme');
  `, e);
  assert.equal(vm.runInContext('globalThis.__ok', e), false);
  assert.equal(vm.runInContext('globalThis.__a.links.length', e), 0, 'aucun link ne doit avoir ete cree');
});

test('setLinkGraphShader refuse une boucle indirecte A->B->C->A', () => {
  const e = env();
  vm.runInContext(`
    globalThis.__a = {
      nodes:[{id:'A', type:'math.add', params:{}}, {id:'B', type:'math.add', params:{}},
              {id:'C', type:'math.add', params:{}}],
      links:[{node:'B', entry:'a', source:'A'}, {node:'C', entry:'a', source:'B'}],
      outputs:{}, layout:{}
    };
    globalThis.__ok = setLinkGraphShader(globalThis.__a, 'A', 'a', 'C');
  `, e);
  assert.equal(vm.runInContext('globalThis.__ok', e), false);
  assert.equal(vm.runInContext('globalThis.__a.links.length', e), 2, 'les links existants restent intacts');
});

test('setLinkGraphShader accepte un losange (deux chemins vers le meme noeud, sans loop)', () => {
  const e = env();
  // A alimente B et C ; brancher B ET C sur D n'est PAS un cycle.
  vm.runInContext(`
    globalThis.__a = {
      nodes:[{id:'A', type:'uv', params:{}}, {id:'B', type:'math.add', params:{}},
              {id:'C', type:'math.add', params:{}}, {id:'D', type:'math.add', params:{}}],
      links:[{node:'B', entry:'a', source:'A'}, {node:'C', entry:'a', source:'A'},
             {node:'D', entry:'a', source:'B'}],
      outputs:{}, layout:{}
    };
    globalThis.__ok = setLinkGraphShader(globalThis.__a, 'D', 'b', 'C');
  `, e);
  assert.equal(vm.runInContext('globalThis.__ok', e), true);
  assert.equal(vm.runInContext('globalThis.__a.links.length', e), 4);
});

test('setLinkGraphShader debranche toujours (source falsy jamais refusee)', () => {
  const e = env();
  vm.runInContext(`
    globalThis.__a = {
      nodes:[{id:'A', type:'uv', params:{}}, {id:'B', type:'math.add', params:{}}],
      links:[{node:'B', entry:'a', source:'A'}], outputs:{}, layout:{}
    };
    globalThis.__ok = setLinkGraphShader(globalThis.__a, 'B', 'a', null);
  `, e);
  assert.equal(vm.runInContext('globalThis.__ok', e), true);
  assert.equal(vm.runInContext('globalThis.__a.links.length', e), 0);
});

// ---------- Compatibilité des pastilles (règle de branchement) ----------
// Cette règle vivait dans la fermeture de l'éditeur et lisait la variable `liaison`
// directement, alors que l'appelant la met à null AVANT de valider la cible : elle répondait
// donc toujours « incompatible » au moment de conclure, et AUCUN branchement n'aboutissait.
// Elle prend désormais l'état en argument — ces tests verrouillent la règle.
test('une sortie peut se brancher sur une entrée de nœud ou un slot du Master', () => {
  const e = env();
  vm.runInContext(`
    globalThis.__l = {sens:'depuis-sortie', node:'A'};
    globalThis.__surEntree = badgeCompatibleGraphShader({inputNode:'B', inputName:'a'}, globalThis.__l);
    globalThis.__surMaster = badgeCompatibleGraphShader({targetOutput:'color'}, globalThis.__l);
  `, e);
  assert.equal(vm.runInContext('globalThis.__surEntree', e), true);
  assert.equal(vm.runInContext('globalThis.__surMaster', e), true);
});

test('une sortie ne peut PAS se brancher sur une autre sortie, ni sur son propre nœud', () => {
  const e = env();
  vm.runInContext(`
    globalThis.__l = {sens:'depuis-sortie', node:'A'};
    globalThis.__surSortie = badgeCompatibleGraphShader({outputNode:'B'}, globalThis.__l);
    globalThis.__surSoiMeme = badgeCompatibleGraphShader({inputNode:'A', inputName:'a'}, globalThis.__l);
  `, e);
  assert.equal(vm.runInContext('globalThis.__surSortie', e), false);
  assert.equal(vm.runInContext('globalThis.__surSoiMeme', e), false);
});

test('un fil parti d une ENTREE cherche une sortie, pas une autre entry', () => {
  const e = env();
  vm.runInContext(`
    globalThis.__l = {sens:'depuis-entree', node:'B', entry:'a'};
    globalThis.__surSortie = badgeCompatibleGraphShader({outputNode:'A'}, globalThis.__l);
    globalThis.__surEntree = badgeCompatibleGraphShader({inputNode:'C', inputName:'a'}, globalThis.__l);
    globalThis.__surSoiMeme = badgeCompatibleGraphShader({outputNode:'B'}, globalThis.__l);
  `, e);
  assert.equal(vm.runInContext('globalThis.__surSortie', e), true);
  assert.equal(vm.runInContext('globalThis.__surEntree', e), false);
  assert.equal(vm.runInContext('globalThis.__surSoiMeme', e), false);
});

test('un slot du Master laisse en pending cherche une sortie', () => {
  const e = env();
  vm.runInContext(`
    globalThis.__l = {sens:'depuis-entree', keyOutput:'roughness'};
    globalThis.__ok = badgeCompatibleGraphShader({outputNode:'A'}, globalThis.__l);
  `, e);
  assert.equal(vm.runInContext('globalThis.__ok', e), true);
});

test('sans liaison en cours, aucune pastille n est compatible', () => {
  const e = env();
  vm.runInContext(`
    globalThis.__ok = badgeCompatibleGraphShader({inputNode:'B', inputName:'a'}, null);
  `, e);
  assert.equal(vm.runInContext('globalThis.__ok', e), false);
});

// Toutes les catégories déclarées par un nœud doivent être connues du « Create Node », sinon
// le nœud atterrit en end de menu sans que personne ne s'en aperçoive.
test('chaque type de nœud declare une categorie listee dans CATEGORIES_GRAPH_SHADER', () => {
  const e = env();
  const metas = vm.runInContext('JSON.stringify(META_NODES_GRAPH_SHADER)', e);
  const categories = vm.runInContext('JSON.stringify(CATEGORIES_GRAPH_SHADER)', e);
  const connues = new Set(JSON.parse(categories));
  Object.entries(JSON.parse(metas)).forEach(function([type, meta]){
    assert.ok(meta.category, type + ' doit declarer une categorie');
    assert.ok(connues.has(meta.category),
      type + ' : categorie « ' + meta.category + ' » absente de CATEGORIES_GRAPH_SHADER');
  });
});

// Le registre (rendu, shader-graph.js) et les métadonnées d'édition (ce fichier-ci) doivent
// couvrir EXACTEMENT les mêmes types : un nœud constructible mais absent du « Create Node »
// est inatteignable, un nœud proposé au menu mais absent du registre plante à la construction.
test('registre de rendu et metadonnees d edit couvrent les memes types', () => {
  const e = env();
  const registre = JSON.parse(vm.runInContext('JSON.stringify(Object.keys(REGISTRY_GRAPH_SHADER))', e));
  const metas = JSON.parse(vm.runInContext('JSON.stringify(Object.keys(META_NODES_GRAPH_SHADER))', e));
  const sansMeta = registre.filter(t => metas.indexOf(t) === -1);
  const sansRegistre = metas.filter(t => registre.indexOf(t) === -1);
  assert.deepEqual(sansMeta, [], 'types constructibles mais absents du menu');
  assert.deepEqual(sansRegistre, [], 'types proposes au menu mais absents du registre');
});

test('les inputs declarees pour un widget inline existent vraiment sur le noeud', () => {
  const e = env();
  const registre = JSON.parse(vm.runInContext('JSON.stringify(Object.fromEntries('
    + 'Object.entries(REGISTRY_GRAPH_SHADER).map(([t, d]) => [t, d.inputs])))', e));
  const widgets = JSON.parse(vm.runInContext('JSON.stringify(TYPE_INPUT_GRAPH_SHADER)', e));
  const fautes = [];
  Object.entries(widgets).forEach(function([type, parEntree]){
    const attendues = registre[type];
    if(!attendues){ fautes.push(type + ' : type inconnu du registre'); return; }
    Object.keys(parEntree).forEach(function(name){
      if(attendues.indexOf(name) === -1) fautes.push(type + ' : entry « ' + name + ' » inexistante');
    });
  });
  assert.deepEqual(fautes, []);
});

// ---------- Blackboard (proprietes independantes du graphe) ----------
test('addPropertyGraphShader pousse la propriete dans le blackboard, SANS noeud sur le plan', () => {
  const e = env();
  vm.runInContext('globalThis.__a = {properties:[], nodes:[], links:[], outputs:{}, layout:{}};', e);
  vm.runInContext('addPropertyGraphShader(globalThis.__a, "color")', e);
  const a = JSON.parse(vm.runInContext('JSON.stringify(globalThis.__a)', e));
  assert.equal(a.properties.length, 1);
  assert.equal(a.properties[0].type, 'color');
  assert.equal(a.properties[0].defaultValue, '#8899aa');
  assert.deepEqual(a.nodes, [], 'une propriete neuve ne se pose pas d office sur le graphe');
});

// Le nom est la cle que le materiau utilise dans valuesParams : deux proprietes qui le
// partageraient seraient indiscernables cote materiau.
test('les noms de proprietes restent uniques, a la creation comme au renommage', () => {
  const e = env();
  vm.runInContext('globalThis.__a = {properties:[], nodes:[], links:[], outputs:{}, layout:{}};', e);
  vm.runInContext('addPropertyGraphShader(globalThis.__a, "float", "Teinte")', e);
  vm.runInContext('addPropertyGraphShader(globalThis.__a, "float", "Teinte")', e);
  const noms = JSON.parse(vm.runInContext(
    'JSON.stringify(globalThis.__a.properties.map(p => p.name))', e));
  assert.deepEqual(noms, ['Teinte', 'Teinte 2']);
  const renomme = vm.runInContext(
    'renamePropertyGraphShader(globalThis.__a, globalThis.__a.properties[1].id, "Teinte")', e);
  assert.equal(renomme, 'Teinte 2', 'le renommage ne peut pas creer de doublon');
});

test('une meme propriete se pose autant de fois qu on veut sur le graphe', () => {
  const e = env();
  vm.runInContext('globalThis.__a = {properties:[], nodes:[], links:[], outputs:{}, layout:{}};', e);
  vm.runInContext(`
    const p = addPropertyGraphShader(globalThis.__a, "float", "Vitesse");
    addNodePropertyGraphShader(globalThis.__a, p.id, 10, 10);
    addNodePropertyGraphShader(globalThis.__a, p.id, 200, 10);
  `, e);
  const a = JSON.parse(vm.runInContext('JSON.stringify(globalThis.__a)', e));
  assert.equal(a.nodes.length, 2);
  assert.deepEqual(a.nodes.map(n => n.type), ['property.ref', 'property.ref']);
  assert.equal(a.nodes[0].params.propertyId, a.nodes[1].params.propertyId);
  assert.equal(a.properties.length, 1, 'toujours UNE seule propriete exposee');
});

test('supprimer une propriete emporte les noeuds qui y renvoyaient', () => {
  const e = env();
  vm.runInContext(`
    globalThis.__a = {properties:[], nodes:[], links:[], outputs:{}, layout:{}};
    const p = addPropertyGraphShader(globalThis.__a, "float", "Vitesse");
    const n = addNodePropertyGraphShader(globalThis.__a, p.id, 10, 10);
    addNodeGraphShader(globalThis.__a, "math.add", 300, 10);
    setLinkGraphShader(globalThis.__a, globalThis.__a.nodes[1].id, "a", n);
    globalThis.__idProp = p.id;
  `, e);
  vm.runInContext('deletePropertyGraphShader(globalThis.__a, globalThis.__idProp)', e);
  const a = JSON.parse(vm.runInContext('JSON.stringify(globalThis.__a)', e));
  assert.deepEqual(a.properties, []);
  assert.deepEqual(a.nodes.map(n => n.type), ['math.add'], 'le renvoi disparait avec elle');
  assert.deepEqual(a.links, [], 'et le fil qui en partait aussi');
});

// Deux noeuds param.* de meme nom designaient DEJA la meme propriete cote materiau : ils
// doivent fusionner en une entree unique, avec deux renvois — ce que l'ancien modele ne
// savait pas exprimer.
test('migratePropertiesGraphShader convertit les noeuds param.* en blackboard + renvois', () => {
  const e = env();
  vm.runInContext(`
    globalThis.__a = {
      properties: [],
      nodes: [{id:'n1', type:'param.color', params:{name:'Teinte', defaultValue:'#ff0000'}},
              {id:'n2', type:'param.color', params:{name:'Teinte', defaultValue:'#ff0000'}},
              {id:'n3', type:'param.float', params:{name:'Vitesse', defaultValue:2.5}}],
      links: [], outputs: {color:'n1'}, layout: {}
    };
    globalThis.__count = migratePropertiesGraphShader(globalThis.__a);
  `, e);
  const a = JSON.parse(vm.runInContext('JSON.stringify(globalThis.__a)', e));
  assert.equal(vm.runInContext('globalThis.__count', e), 3);
  assert.deepEqual(a.properties.map(p => [p.name, p.type, p.defaultValue]),
    [['Teinte', 'color', '#ff0000'], ['Vitesse', 'float', 2.5]]);
  assert.deepEqual(a.nodes.map(n => n.type),
    ['property.ref', 'property.ref', 'property.ref']);
  assert.equal(a.nodes[0].params.propertyId, a.nodes[1].params.propertyId,
    'meme nom, meme type => une seule propriete, deux renvois');
  assert.equal(a.outputs.color, 'n1', 'les ids de noeuds ne bougent pas, les sorties tiennent');
});

// Le code genere est PROPOSE a l'execution (« Piloter le rendu par ce code ») : s'il ne
// compile pas, la fonctionnalite entiere ne veut rien dire. Une note de propriete en fin de
// ligne avalait le point-virgule que le generateur ajoute juste apres.
test('le code genere est syntaxiquement valide, notes de proprietes comprises', () => {
  const e = env();
  const asset = {
    name:'Eau', target:'lit',
    properties:[{id:'p1', name:'speed', type:'float', defaultValue:1},
                {id:'p2', name:'Teinte', type:'color', defaultValue:'#0080ff'},
                {id:'p3', name:'Direction', type:'vec3', defaultValue:{x:0, y:1, z:0}}],
    nodes:[{id:'n1', type:'property.ref', params:{propertyId:'p1'}},
            {id:'n2', type:'property.ref', params:{propertyId:'p2'}},
            {id:'n3', type:'property.ref', params:{propertyId:'p3'}},
            {id:'n4', type:'time', params:{}},
            {id:'n5', type:'math.mul', params:{}}],
    links:[{node:'n5', entry:'a', source:'n1'}, {node:'n5', entry:'b', source:'n4'}],
    outputs:{color:'n2', emissive:'n3', metalness:'n5'}, layout:{}
  };
  const code = vm.runInContext('generateCodeTslFromGraph(' + JSON.stringify(asset) + ')', e);
  // La compilation seule suffit : c'est la syntaxe qu'on verifie, pas le rendu.
  assert.doesNotThrow(function(){
    new Function('TSL', 'THREE', 'graph', 'material', code);
  }, 'le code genere doit compiler tel quel');
  assert.doesNotMatch(code, /\/\/.*;\s*$/m,
    'aucun point-virgule ne doit se retrouver DANS un commentaire de fin de ligne');
});

// Brancher un scalaire sur Position pose (n, n, n) a chaque sommet : le maillage s'ecrase sur
// la diagonale et semble disparaitre. Le slot doit refuser, et dire par quoi commencer.
test('le slot Position refuse un scalaire, mais accepte un vecteur 3', () => {
  const e = env();
  const graphe = {
    properties: [],
    nodes: [{id:'bruit', type:'procedural.bruit', params:{}},
             {id:'pos', type:'geo.position', params:{}}],
    links: [], outputs: {}, layout: {}
  };
  function versPosition(idSource){
    return vm.runInContext('badgeCompatibleGraphShader('
      + JSON.stringify({targetOutput:'position'}) + ', '
      + JSON.stringify({sens:'depuis-sortie', node:idSource}) + ', '
      + JSON.stringify(graphe) + ')', e);
  }
  assert.equal(versPosition('bruit'), false, 'un bruit (float) ecraserait tous les sommets');
  assert.equal(versPosition('pos'), true, 'un vec3, lui, a un sens');
  // Et le refus doit expliquer, pas seulement refuser.
  const message = vm.runInContext('SLOTS_VECTOR_STRICT_GRAPH_SHADER.position', e);
  assert.match(message, /vecteur 3/);
});

// ---------- Aller-retour code <-> graphe ----------
// Le panneau de code n'est pas un compte rendu : c'est le meme graphe, ecrit autrement. Un
// aller-retour doit donc rendre le MEME graphe, et le meme texte au passage suivant.
function grapheRiche(){
  return {
    name:'Eau', target:'lit',
    properties:[{id:'p1', name:'speed', type:'float', defaultValue:1},
                {id:'p2', name:'Teinte', type:'color', defaultValue:'#0080ff'}],
    nodes:[{id:'a', type:'property.ref', params:{propertyId:'p2'}},
            {id:'b', type:'uv', params:{}},
            {id:'c', type:'constant.float', params:{value:8, __auto:true}},
            {id:'d', type:'procedural.bruit', params:{}},
            {id:'e', type:'geo.position', params:{space:'local'}},
            {id:'f', type:'geo.normale', params:{space:'local'}},
            {id:'g', type:'math.mul', params:{}},
            {id:'h', type:'math.add', params:{}},
            {id:'i', type:'constant.float', params:{value:0.6}}],
    links:[{node:'d', entry:'uv', source:'b'}, {node:'d', entry:'scale', source:'c'},
            {node:'g', entry:'a', source:'f'}, {node:'g', entry:'b', source:'d'},
            {node:'h', entry:'a', source:'e'}, {node:'h', entry:'b', source:'g'}],
    outputs:{color:'a', smoothness:'i', position:'h'},
    layout:{}
  };
}

test('graphe -> code -> graphe : les noeuds, les liens et les sorties se retrouvent', () => {
  const e = env();
  vm.runInContext('globalThis.__a = ' + JSON.stringify(grapheRiche()) + ';', e);
  const code = vm.runInContext('generateCodeTslFromGraph(globalThis.__a)', e);
  vm.runInContext('applyCodeToGraphGraphShader(globalThis.__a, ' + JSON.stringify(code) + ')', e);
  const a = JSON.parse(vm.runInContext('JSON.stringify(globalThis.__a)', e));

  const types = a.nodes.map(n => n.type).sort();
  assert.deepEqual(types, ['constant.float', 'constant.float', 'geo.normale', 'geo.position',
    'math.add', 'math.mul', 'procedural.bruit', 'property.ref', 'uv'].sort());
  // La propriete est retrouvee par son NOM, et pointe bien sur l'entree du blackboard.
  const ref = a.nodes.find(n => n.type === 'property.ref');
  assert.equal(ref.params.propertyId, 'p2');
  // L'echelle d'un procedural est un PORT, pas un Multiply de plus : sinon chaque aller-retour
  // en empilerait un.
  const bruit = a.nodes.find(n => n.type === 'procedural.bruit');
  assert.ok(a.links.some(l => l.node === bruit.id && l.entry === 'scale'));
  assert.equal(a.nodes.filter(n => n.type === 'math.mul').length, 1);
  // La valeur tapee sur un port redevient une valeur inline, pas un noeud pose sur le plan.
  const echelle = a.nodes.find(n => n.id === a.links.find(l => l.entry === 'scale').source);
  assert.equal(echelle.params.__auto, true);
  assert.equal(echelle.params.value, 8);
  // Position (Vertex) et Smoothness sont bien revenues sur leurs slots.
  assert.ok(a.outputs.position && a.outputs.color && a.outputs.smoothness);
});

// Trois formes ont failli faire diverger l'aller-retour, chacune en s'ajoutant a elle-meme a
// chaque passage : une composante de Vector ecrite `float(3)` au lieu de `3` (le parametre
// devenait un noeud branche), un Blend a l'opacite par defaut (un Lerp de plus a chaque tour),
// et un swizzle ecrit sans parentheses (que l'analyseur ne relisait pas du tout).
test('Vector, Blend et swizzle ne font pas diverger l aller-retour', () => {
  const e = env();
  const asset = {
    name:'Divers', target:'lit', properties:[],
    nodes:[{id:'a', type:'constant.vec2', params:{x:3, y:0.5}},
            {id:'b', type:'geo.position', params:{space:'local'}},
            {id:'c', type:'vec.swizzle', params:{channels:'y'}},
            {id:'d', type:'constant.color', params:{color:'#204060'}},
            {id:'f', type:'constant.color', params:{color:'#c08040'}},
            {id:'g', type:'color.blend', params:{mode:'screen'}},
            {id:'h', type:'uv.tilingOffset', params:{}},
            {id:'i', type:'procedural.bruit', params:{}}],
    links:[{node:'c', entry:'v', source:'b'},
            {node:'g', entry:'base', source:'d'}, {node:'g', entry:'blend', source:'f'},
            {node:'h', entry:'tiling', source:'a'},
            {node:'i', entry:'uv', source:'h'}],
    outputs:{color:'g', metalness:'i', ao:'c'}, layout:{}
  };
  vm.runInContext('globalThis.__a = ' + JSON.stringify(asset) + ';', e);
  const code1 = vm.runInContext('generateCodeTslFromGraph(globalThis.__a)', e);
  assert.match(code1, /vec2\(3, 0\.5\)/, 'une composante non branchee s ecrit nue');
  assert.match(code1, /blendScreen\(/);
  assert.doesNotMatch(code1, /mix\(/, 'pas de fondu quand l opacite vaut son defaut');
  vm.runInContext('applyCodeToGraphGraphShader(globalThis.__a, ' + JSON.stringify(code1) + ')', e);
  const a = JSON.parse(vm.runInContext('JSON.stringify(globalThis.__a)', e));
  assert.ok(a.nodes.some(n => n.type === 'vec.swizzle'), 'le swizzle est relu');
  assert.equal(a.nodes.filter(n => n.type === 'color.blend').length, 1);
  // Le texte ne dit pas si un port etait branche ou laisse a son defaut : appliquer le rend
  // donc EXPLICITE (`uv()` devient un noeud UV). Ce qui doit tenir, c'est qu'appliquer une
  // seconde fois ne bouge plus rien — sinon le graphe grossirait a chaque passage.
  const code2 = vm.runInContext(
    'generateCodeTslFromGraph(Object.assign({}, globalThis.__a, {name:"Divers"}))', e);
  vm.runInContext('applyCodeToGraphGraphShader(globalThis.__a, ' + JSON.stringify(code2) + ')', e);
  const code3 = vm.runInContext(
    'generateCodeTslFromGraph(Object.assign({}, globalThis.__a, {name:"Divers"}))', e);
  assert.equal(code3, code2, 'stable des la premiere application');
});

test('le texte regenere apres un aller-retour est identique au premier', () => {
  const e = env();
  vm.runInContext('globalThis.__a = ' + JSON.stringify(grapheRiche()) + ';', e);
  const code1 = vm.runInContext('generateCodeTslFromGraph(globalThis.__a)', e);
  vm.runInContext('applyCodeToGraphGraphShader(globalThis.__a, ' + JSON.stringify(code1) + ')', e);
  const code2 = vm.runInContext(
    'generateCodeTslFromGraph(Object.assign({}, globalThis.__a, {name:"Eau"}))', e);
  assert.equal(code2, code1, 'le point fixe est atteint des le premier passage');
});

// Ecrire du code a la main doit poser les noeuds : c'est la moitie « code -> graphe » du
// contrat, celle qui n'existait pas.
test('du code ecrit a la main pose les noeuds et les liens correspondants', () => {
  const e = env();
  const asset = {target:'lit', properties:[{id:'p1', name:'Vitesse', type:'float', defaultValue:2}],
    nodes:[], links:[], outputs:{}, layout:{}};
  const code = `
    const { color, uv, time, sin, mx_noise_float, positionLocal, normalLocal } = TSL;
    const teinte = color('#0080ff');
    const bruit = mx_noise_float(uv().mul(graph.property('Vitesse')));
    material.colorNode = teinte;
    material.positionNode = positionLocal.add(normalLocal.mul(bruit));
  `;
  vm.runInContext('globalThis.__a = ' + JSON.stringify(asset) + ';', e);
  vm.runInContext('applyCodeToGraphGraphShader(globalThis.__a, ' + JSON.stringify(code) + ')', e);
  const a = JSON.parse(vm.runInContext('JSON.stringify(globalThis.__a)', e));
  assert.deepEqual(a.nodes.map(n => n.type).sort(),
    ['constant.color', 'geo.normale', 'geo.position', 'math.add', 'math.mul',
     'procedural.bruit', 'property.ref', 'uv'].sort());
  assert.equal(a.nodes.find(n => n.type === 'property.ref').params.propertyId, 'p1');
  assert.equal(a.outputs.color, a.nodes.find(n => n.type === 'constant.color').id);
  assert.equal(a.outputs.position, a.nodes.find(n => n.type === 'math.add').id);
  // Chaque noeud pose recoit une place : un graphe reconstruit ne doit pas s'empiler a l'origine.
  const places = a.nodes.filter(n => !n.params.__auto).map(n => a.layout[n.id]);
  assert.ok(places.every(pt => pt && typeof pt.x === 'number'), 'tout noeud visible a une place');
  assert.ok(new Set(places.map(pt => pt.x + 'x' + pt.y)).size === places.length, 'et une place a lui');
});

// Un terme inconnu ne doit RIEN casser : on nomme la ligne, et le graphe reste ce qu'il etait.
// La cible fait partie du shader : le texte doit pouvoir la poser, sinon coller un code
// Physical dans un graphe reste en Lit refuse ses couches sans que rien ne le dise.
test('material.target bascule la cible, et un slot d une autre cible nomme laquelle', () => {
  const e = env();
  const code = "material.target = 'physical';\nmaterial.clearcoatNode = float(0.8);";
  vm.runInContext('globalThis.__a = ' + JSON.stringify(
    {name:'X', target:'lit', properties:[], nodes:[], links:[], outputs:{}, layout:{}}) + ';', e);
  vm.runInContext('applyCodeToGraphGraphShader(globalThis.__a, ' + JSON.stringify(code) + ')', e);
  const a = JSON.parse(vm.runInContext('JSON.stringify(globalThis.__a)', e));
  assert.equal(a.target, 'physical');
  assert.ok(a.outputs.clearcoat, 'le slot du Physical est branche');
  // La cible est REECRITE dans le texte : les deux vues ne peuvent pas diverger dessus.
  const regen = vm.runInContext('generateCodeTslFromGraph(globalThis.__a)', e);
  assert.match(regen, /material\.target = 'physical';/);

  // Sans la ligne, le refus nomme la cible qui possede ce slot.
  assert.throws(function(){
    vm.runInContext('applyCodeToGraphGraphShader('
      + JSON.stringify({target:'lit', properties:[], nodes:[], links:[], outputs:{}, layout:{}})
      + ', ' + JSON.stringify('material.clearcoatNode = float(1);') + ')', e);
  }, /physical/);
});

test('un code incomprehensible est refuse en nommant la ligne, sans toucher au graphe', () => {
  const e = env();
  const asset = {target:'lit', properties:[], nodes:[{id:'n1', type:'uv', params:{}}],
    links:[], outputs:{color:'n1'}, layout:{n1:{x:5, y:5}}};
  vm.runInContext('globalThis.__a = ' + JSON.stringify(asset) + ';', e);
  assert.throws(function(){
    vm.runInContext('applyCodeToGraphGraphShader(globalThis.__a, '
      + JSON.stringify('const a = uv();\nconst b = tourbillon(a);\nmaterial.colorNode = b;') + ')', e);
  }, /ligne 2[\s\S]*tourbillon/);
  const a = JSON.parse(vm.runInContext('JSON.stringify(globalThis.__a)', e));
  assert.deepEqual(a.nodes.map(n => n.type), ['uv'], 'le graphe est intact');
  assert.deepEqual(a.layout.n1, {x:5, y:5});
});

// Le blackboard n'appartient pas au graphe seul : ecrire une propriete dans le code la CREE.
// C'est ce qui fait que les deux vues partagent la meme liste, dans les deux sens.
test('une propriete ecrite dans le code rejoint le blackboard, avec son type deduit', () => {
  const e = env();
  const code = `
    const { color, float, uv, vec3, mx_noise_float } = TSL;
    graph.property('Rugosite', 0.4);
    const bruit = mx_noise_float(uv().mul(graph.property('Echelle', 6)));
    material.colorNode = graph.property('Teinte', '#8fd8ff').mul(bruit);
    material.emissiveNode = graph.property('Lueur', vec3(0.1, 0.2, 0.3));
  `;
  vm.runInContext('globalThis.__a = ' + JSON.stringify(
    {name:'H', target:'lit', properties:[], nodes:[], links:[], outputs:{}, layout:{}}) + ';', e);
  vm.runInContext('applyCodeToGraphGraphShader(globalThis.__a, ' + JSON.stringify(code) + ')', e);
  const a = JSON.parse(vm.runInContext('JSON.stringify(globalThis.__a)', e));
  assert.deepEqual(a.properties.map(p => [p.name, p.type]),
    [['Rugosite', 'float'], ['Echelle', 'float'], ['Teinte', 'color'], ['Lueur', 'vec3']]);
  assert.equal(a.properties[0].defaultValue, 0.4);
  assert.equal(a.properties[2].defaultValue, '#8fd8ff');
  assert.deepEqual(a.properties[3].defaultValue, {x:0.1, y:0.2, z:0.3});
  // « Rugosite » n'est lue par personne : elle existe quand meme, et aucun noeud ne la porte.
  assert.equal(a.nodes.filter(n => n.type === 'property.ref').length, 3);
  // Elle doit reapparaitre dans le texte, sinon le blackboard ne serait visible que d'un cote.
  const regen = vm.runInContext('generateCodeTslFromGraph(globalThis.__a)', e);
  assert.match(regen, /graph\.property\('Rugosite', 0\.4\);/);
});

// Le blackboard reste PROPRIETAIRE de la valeur : reappliquer un code qui porte un autre
// defaut ne doit pas ecraser ce qui a ete regle dans le panneau.
test('une propriete qui existe deja garde le defaut du blackboard', () => {
  const e = env();
  vm.runInContext('globalThis.__a = ' + JSON.stringify(
    {name:'H', target:'lit', properties:[{id:'p1', name:'Vitesse', type:'float', defaultValue:9}],
     nodes:[], links:[], outputs:{}, layout:{}}) + ';', e);
  vm.runInContext('applyCodeToGraphGraphShader(globalThis.__a, '
    + JSON.stringify("material.colorNode = graph.property('Vitesse', 0.5);") + ')', e);
  const a = JSON.parse(vm.runInContext('JSON.stringify(globalThis.__a)', e));
  assert.equal(a.properties.length, 1, 'pas de doublon');
  assert.equal(a.properties[0].defaultValue, 9, 'le panneau garde la main sur la valeur');
});

test('une propriete absente du blackboard est refusee par son nom', () => {
  const e = env();
  vm.runInContext('globalThis.__a = ' + JSON.stringify(
    {target:'lit', properties:[], nodes:[], links:[], outputs:{}, layout:{}}) + ';', e);
  assert.throws(function(){
    vm.runInContext('applyCodeToGraphGraphShader(globalThis.__a, '
      + JSON.stringify("material.colorNode = graph.property('Absente');") + ')', e);
  }, /Absente/);
});

// ---------- Types de port (le filtre de branchement) ----------
test('portsCompatibleGraphShader : diffusion du scalaire, vec4 lu comme vec3, le reste refuse', () => {
  const e = env();
  const ok = (a, b) => vm.runInContext('portsCompatibleGraphShader("' + a + '", "' + b + '")', e);
  assert.equal(ok('float', 'vec3'), true, 'un scalaire se diffuse');
  assert.equal(ok('vec3', 'vec3'), true);
  assert.equal(ok('vec4', 'vec3'), true, 'une texture branchee sur une couleur');
  assert.equal(ok('vec3', 'float'), false, 'un vec3 sur une entry scalaire n a pas de sens');
  assert.equal(ok('vec2', 'vec3'), false);
  assert.equal(ok('dynamic', 'float'), true, 'un operateur polymorphe accepte tout');
});

test('typeOutputGraphShader remonte le type au travers des operateurs dynamiques', () => {
  const e = env();
  const graphe = {
    nodes: [{id:'v', type:'constant.vec3', params:{}},
             {id:'f', type:'constant.float', params:{}},
             {id:'m', type:'math.mul', params:{}}],
    links: [{node:'m', entry:'a', source:'v'}, {node:'m', entry:'b', source:'f'}],
    outputs: {}, layout: {}
  };
  const type = vm.runInContext('typeOutputGraphShader(' + JSON.stringify(graphe) + ', "m")', e);
  assert.equal(type, 'vec3', 'vec3 * float rend un vec3');
});

// Un graphe en cours d'edition peut porter un cycle le temps d'un geste : la remontee de
// type ne doit pas y partir en recursion infinie.
test('typeOutputGraphShader ne boucle pas sur un graphe cyclique', () => {
  const e = env();
  const graphe = {
    nodes: [{id:'a', type:'math.add', params:{}}, {id:'b', type:'math.add', params:{}}],
    links: [{node:'a', entry:'a', source:'b'}, {node:'b', entry:'a', source:'a'}],
    outputs: {}, layout: {}
  };
  assert.equal(vm.runInContext('typeOutputGraphShader(' + JSON.stringify(graphe) + ', "a")', e), 'dynamic');
});

test('badgeCompatibleGraphShader refuse un vec3 sur une entry float quand le graphe est fourni', () => {
  const e = env();
  const graphe = {
    nodes: [{id:'v', type:'constant.vec3', params:{}}, {id:'n', type:'procedural.bruit', params:{}}],
    links: [], outputs: {}, layout: {}
  };
  const cible = {inputNode:'n', inputName:'scale'};
  const liaison = {sens:'depuis-sortie', node:'v'};
  const args = JSON.stringify(cible) + ', ' + JSON.stringify(liaison);
  assert.equal(vm.runInContext('badgeCompatibleGraphShader(' + args + ')', e), true,
    'sans graphe, seule la geometrie du branchement compte');
  assert.equal(vm.runInContext('badgeCompatibleGraphShader(' + args + ', '
    + JSON.stringify(graphe) + ')', e), false, 'un vec3 ne pilote pas une echelle scalaire');
});

// ---------- Code TSL équivalent ----------
test('chaque type constructible a un modele de code TSL', () => {
  const e = env();
  const registre = JSON.parse(vm.runInContext('JSON.stringify(Object.keys(REGISTRY_GRAPH_SHADER))', e));
  const codes = JSON.parse(vm.runInContext('JSON.stringify(Object.keys(CODE_NODE_GRAPH_SHADER))', e));
  assert.deepEqual(registre.filter(t => codes.indexOf(t) === -1), [],
    'types constructibles sans modele de code');
});

// Le registre ne déclare de défaut par-entrée que pour `uv` : le générateur de code s'appuie
// sur cette hypothèse pour écrire `uv()` plutôt que `float(0)`. Si un autre défaut apparaît,
// ce test tombe et rappelle d'aller mettre le générateur à jour.
// Un defaut pose sur une entry qui n'existe pas est du code mort : buildNodeGraph ne
// parcourt que `inputs`, le defaut ne serait jamais evalue et le port jamais dessine.
test('tout defaut par-entry du registre porte sur une entry declaree', () => {
  const e = env();
  const orphelins = JSON.parse(vm.runInContext('JSON.stringify('
    + 'Object.entries(REGISTRY_GRAPH_SHADER).flatMap(([t, d]) => '
    + 'Object.keys(d.defaults || {}).filter(k => d.inputs.indexOf(k) === -1).map(k => t + "." + k)))', e));
  assert.deepEqual(orphelins, []);
});

test('generateCodeTslFromGraph produit un code lisible et dans le bon ordre', () => {
  const e = env();
  const asset = {
    name: 'Eau', target: 'lit',
    nodes: [{id:'a', type:'uv', params:{}},
             {id:'b', type:'procedural.voronoi', params:{scale:12, desordre:0.5}},
             {id:'c', type:'constant.float', params:{value:0.25}}],
    links: [{node:'b', entry:'uv', source:'a'}],
    outputs: {color:'b', roughness:'c'}
  };
  const code = vm.runInContext('generateCodeTslFromGraph(' + JSON.stringify(asset) + ')', e);
  assert.match(code, /const \{ [^}]*mx_worley_noise_float[^}]*\} = TSL;/, 'en-tete des fonctions utilisees');
  assert.ok(code.indexOf('uv()') !== -1);
  assert.match(code, /mx_worley_noise_float\(n1\.mul\(float\(12\)\), float\(0\.5\)\)/);
  assert.match(code, /material\.colorNode = n2;/);
  assert.match(code, /material\.roughnessNode = n3;/);
  assert.ok(code.indexOf('MeshStandardNodeMaterial') !== -1, 'l en-tete dit quel materiau est recu');
  // La dépendance doit être déclarée AVANT le nœud qui la consomme.
  assert.ok(code.indexOf('const n1 =') < code.indexOf('const n2 ='));
});

test('la cible unlit produit un MeshBasicNodeMaterial et ignore les slots absents', () => {
  const e = env();
  const asset = {name:'Plat', target:'unlit',
    nodes:[{id:'a', type:'constant.color', params:{color:'#ff0000'}}],
    links:[], outputs:{color:'a', roughness:'a'}};
  const code = vm.runInContext('generateCodeTslFromGraph(' + JSON.stringify(asset) + ')', e);
  assert.ok(code.indexOf('MeshBasicNodeMaterial') !== -1);
  assert.ok(code.indexOf('roughnessNode') === -1, 'unlit n a pas de slot roughness');
});

test('un noeud partage par deux sorties n est ecrit qu une fois', () => {
  const e = env();
  const asset = {name:'X', target:'lit',
    nodes:[{id:'a', type:'time', params:{}}], links:[], outputs:{color:'a', metalness:'a'}};
  const code = vm.runInContext('generateCodeTslFromGraph(' + JSON.stringify(asset) + ')', e);
  assert.equal(code.split('const n1 =').length - 1, 1);
  assert.ok(code.indexOf('material.colorNode = n1;') !== -1);
  assert.ok(code.indexOf('material.metalnessNode = n1;') !== -1);
});
