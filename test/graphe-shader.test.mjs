// moteur/test/graphe-shader.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { creerContexte } from './engine-env.mjs';

// Faux TSL minimal : chaque nœud numérique porte sa valeur évaluée (`__v`) pour les
// assertions ; les nœuds opaques (uv/time/texture) portent juste un `__tag` pour vérifier
// QUEL constructeur a été appelé, sans prétendre les évaluer (ils n'ont pas de valeur hors GPU).
const FAUX_TSL = `
  // min/max de clamp sont desormais des NOEUDS (entrees branchables), plus des nombres nus.
  function __brut(x){ return (x && x.__v !== undefined) ? x.__v : x; }
  function __n(v){
    var o = {__v: v};
    o.add = function(x){ return __n(o.__v + x.__v); };
    o.sub = function(x){ return __n(o.__v - x.__v); };
    o.mul = function(x){ return __n(o.__v * x.__v); };
    return o;
  }
  var TSL = {
    float: function(v){ return __n(v); },
    vec3: function(x,y,z){ var o = __n(null); o.__vec3 = [x,y,z]; return o; },
    color: function(hex){ var o = __n(null); o.__tag = 'color:' + hex; return o; },
    uv: function(){ return {__tag: 'uv'}; },
    time: {__tag: 'time'},
    mix: function(a,b,t){ return __n(a.__v + (b.__v - a.__v) * t.__v); },
    clamp: function(v,mn,mx){ return __n(Math.max(__brut(mn), Math.min(__brut(mx), __brut(v)))); },
    vec2: function(x,y){ var o = __n(null); o.__vec2 = [x,y]; return o; },
    vec4: function(x,y,z,w){ var o = __n(null); o.__vec4 = [x,y,z,w]; return o; },
    oneMinus: function(v){ return __n(1 - __brut(v)); },
    texture: function(tex, uvNode){ return {__tag: 'texture', tex: tex, uv: uvNode}; }
  };
`;

function env(){
  const e = creerContexte(['js/shader-graph.js']);
  vm.runInContext(FAUX_TSL, e);
  return e;
}

// Faux THREE.MeshStandardNodeMaterial/MeshBasicNodeMaterial : creerContexte charge déjà le
// VRAI vendor/three.min.js classique, qui ne les définit pas — on les ajoute nous-mêmes ici.
const FAUX_THREE_NODE_MATERIALS = `
  THREE.MeshStandardNodeMaterial = function(){ this.__type = 'MeshStandardNodeMaterial'; };
  THREE.MeshBasicNodeMaterial = function(){ this.__type = 'MeshBasicNodeMaterial'; };
`;

test('constant.float construit TSL.float(value)', () => {
  const e = env();
  const graphe = {target:'lit', nodes:[{id:'n1', type:'constant.float', params:{value:2.5}}],
    links:[], outputs:{}};
  const node = vm.runInContext('buildNodeGraph("n1", ' + JSON.stringify(graphe) + ', {}, {})', e);
  assert.equal(node.__v, 2.5);
});

test('uv et temps rendent les nœuds opaques attendus, sans paramètre', () => {
  const e = env();
  const grapheUv = {nodes:[{id:'n1', type:'uv', params:{}}], links:[]};
  const nUv = vm.runInContext('buildNodeGraph("n1", ' + JSON.stringify(grapheUv) + ', {}, {})', e);
  assert.equal(nUv.__tag, 'uv');

  const grapheTemps = {nodes:[{id:'n1', type:'time', params:{}}], links:[]};
  const nTemps = vm.runInContext('buildNodeGraph("n1", ' + JSON.stringify(grapheTemps) + ', {}, {})', e);
  assert.equal(nTemps.__tag, 'time');
});

test('math.add résout ses deux entrées récursivement via les links', () => {
  const e = env();
  const graphe = {
    nodes: [
      {id:'a', type:'constant.float', params:{value:2}},
      {id:'b', type:'constant.float', params:{value:3}},
      {id:'somme', type:'math.add', params:{}}
    ],
    links: [
      {node:'somme', entry:'a', source:'a'},
      {node:'somme', entry:'b', source:'b'}
    ]
  };
  const node = vm.runInContext('buildNodeGraph("somme", ' + JSON.stringify(graphe) + ', {}, {})', e);
  assert.equal(node.__v, 5);
});

test('une entrée non branchée retombe sur TSL.float(0)', () => {
  const e = env();
  const graphe = {
    nodes: [{id:'a', type:'constant.float', params:{value:10}}, {id:'somme', type:'math.add', params:{}}],
    links: [{node:'somme', entry:'a', source:'a'}]   // 'b' jamais branché
  };
  const node = vm.runInContext('buildNodeGraph("somme", ' + JSON.stringify(graphe) + ', {}, {})', e);
  assert.equal(node.__v, 10);   // 10 + 0
});

test('un nœud partagé par deux links n\'est construit qu\'une seule fois (hidden)', () => {
  const e = env();
  const graphe = {
    nodes: [
      {id:'partage', type:'constant.float', params:{value:7}},
      {id:'somme', type:'math.add', params:{}}
    ],
    links: [
      {node:'somme', entry:'a', source:'partage'},
      {node:'somme', entry:'b', source:'partage'}
    ]
  };
  vm.runInContext('globalThis.__cache = ' + JSON.stringify({}), e);
  // Instrumente TSL.float pour compter les constructions réelles : si la mémoïsation
  // est retirée, ce counter pass à 2 (une fois par link vers 'partage').
  vm.runInContext(`
    globalThis.__nbAppelsFloat = 0;
    (function(){
      var original = TSL.float;
      TSL.float = function(v){ globalThis.__nbAppelsFloat++; return original(v); };
    })();
  `, e);
  const node = vm.runInContext(
    'buildNodeGraph("somme", ' + JSON.stringify(graphe) + ', globalThis.__cache, {})', e);
  assert.equal(node.__v, 14);
  const tailleCache = vm.runInContext('Object.keys(globalThis.__cache).length', e);
  assert.equal(tailleCache, 2, 'partage + somme, chacun une seule fois');
  const nbAppelsFloat = vm.runInContext('globalThis.__nbAppelsFloat', e);
  assert.equal(nbAppelsFloat, 1, 'le nœud "partage" ne doit être construit qu\'une seule fois');
});

test('math.sub, math.mul calculent correctement', () => {
  const e = env();
  const g = (type) => ({
    nodes: [{id:'a', type:'constant.float', params:{value:8}},
             {id:'b', type:'constant.float', params:{value:3}},
             {id:'r', type: type, params:{}}],
    links: [{node:'r', entry:'a', source:'a'}, {node:'r', entry:'b', source:'b'}]
  });
  const sub = vm.runInContext('buildNodeGraph("r", ' + JSON.stringify(g('math.sub')) + ', {}, {})', e);
  assert.equal(sub.__v, 5);
  const mul = vm.runInContext('buildNodeGraph("r", ' + JSON.stringify(g('math.mul')) + ', {}, {})', e);
  assert.equal(mul.__v, 24);
});

test('math.mix interpole entre a et b selon t', () => {
  const e = env();
  const graphe = {
    nodes: [{id:'a', type:'constant.float', params:{value:0}},
             {id:'b', type:'constant.float', params:{value:10}},
             {id:'t', type:'constant.float', params:{value:0.25}},
             {id:'r', type:'math.mix', params:{}}],
    links: [{node:'r', entry:'a', source:'a'}, {node:'r', entry:'b', source:'b'},
            {node:'r', entry:'t', source:'t'}]
  };
  const node = vm.runInContext('buildNodeGraph("r", ' + JSON.stringify(graphe) + ', {}, {})', e);
  assert.equal(node.__v, 2.5);
});

test('math.clamp clamped la valeur entre min et max (params)', () => {
  const e = env();
  const graphe = {
    nodes: [{id:'v', type:'constant.float', params:{value:99}},
             {id:'r', type:'math.clamp', params:{min:0, max:1}}],
    links: [{node:'r', entry:'v', source:'v'}]
  };
  const node = vm.runInContext('buildNodeGraph("r", ' + JSON.stringify(graphe) + ', {}, {})', e);
  assert.equal(node.__v, 1);
});

test('texture appelle ctx.resolveTexture avec l\'id d\'asset et TSL.texture avec le résultat', () => {
  const e = env();
  const graphe = {nodes:[{id:'n1', type:'texture', params:{assetTexture:'a42'}}], links:[]};
  vm.runInContext(`
    globalThis.__ctx = { resolveTexture: function(id){ globalThis.__idDemande = id; return {__faux:'texture-' + id}; } };
  `, e);
  const node = vm.runInContext(
    'buildNodeGraph("n1", ' + JSON.stringify(graphe) + ', {}, globalThis.__ctx)', e);
  assert.equal(vm.runInContext('globalThis.__idDemande', e), 'a42');
  assert.equal(node.__tag, 'texture');
  assert.equal(node.tex.__faux, 'texture-a42');
  assert.equal(node.uv.__tag, 'uv', 'sans link sur "uv", TSL.uv() par défaut');
});

test('texture sans asset résolu (asset supprimé/introuvable) retombe sur une couleur noire, pas une exception', () => {
  const e = env();
  const graphe = {nodes:[{id:'n1', type:'texture', params:{assetTexture:'introuvable'}}], links:[]};
  vm.runInContext('globalThis.__ctx = { resolveTexture: function(){ return null; } };', e);
  const node = vm.runInContext(
    'buildNodeGraph("n1", ' + JSON.stringify(graphe) + ', {}, globalThis.__ctx)', e);
  assert.equal(node.__tag, 'color:#000000');
});

test('type de nœud inconnu lève une erreur explicite', () => {
  const e = env();
  const graphe = {nodes:[{id:'n1', type:'nimportequoi', params:{}}], links:[]};
  assert.throws(() => {
    vm.runInContext('buildNodeGraph("n1", ' + JSON.stringify(graphe) + ', {}, {})', e);
  }, /type de nœud inconnu/);
});

test('buildMaterialFromGraph : target lit branche color/roughness sur le bon type de materiau', () => {
  const e = env();
  vm.runInContext(FAUX_THREE_NODE_MATERIALS, e);
  const asset = {
    target: 'lit',
    nodes: [{id:'c', type:'constant.color', params:{color:'#ff0000'}},
             {id:'r', type:'constant.float', params:{value:0.3}}],
    links: [],
    outputs: {color:'c', roughness:'r'}
  };
  const m = vm.runInContext(
    'buildMaterialFromGraph(' + JSON.stringify(asset) + ', function(){ return null; })', e);
  assert.equal(m.__type, 'MeshStandardNodeMaterial');
  assert.equal(m.colorNode.__tag, 'color:#ff0000');
  assert.equal(m.roughnessNode.__v, 0.3);
  assert.equal(m.metalnessNode, undefined, 'output non déclarée dans `sorties` : slot non touché');
});

test('buildMaterialFromGraph : target unlit produit un MeshBasicNodeMaterial', () => {
  const e = env();
  vm.runInContext(FAUX_THREE_NODE_MATERIALS, e);
  const asset = {
    target: 'unlit',
    nodes: [{id:'c', type:'constant.color', params:{color:'#00ff00'}}],
    links: [], outputs: {color:'c'}
  };
  const m = vm.runInContext(
    'buildMaterialFromGraph(' + JSON.stringify(asset) + ', function(){ return null; })', e);
  assert.equal(m.__type, 'MeshBasicNodeMaterial');
  assert.equal(m.colorNode.__tag, 'color:#00ff00');
});

test('GRAPH_SHADER_DEFAULT produit un materiau valide tel quel', () => {
  const e = env();
  vm.runInContext(FAUX_THREE_NODE_MATERIALS, e);
  const m = vm.runInContext(
    'buildMaterialFromGraph(GRAPH_SHADER_DEFAULT, function(){ return null; })', e);
  assert.equal(m.__type, 'MeshStandardNodeMaterial');
  assert.ok(m.colorNode, 'le graphe par défaut doit brancher au moins une couleur');
});

test('param.float/param.color/param.texture retombent sur leur defaut sans valuesParams, et sont overrides avec', () => {
  const e = env();
  const grapheFloat = {nodes:[{id:'n1', type:'param.float', params:{name:'intensity', defaultValue:0.5}}], links:[]};
  const sansOverride = vm.runInContext(
    'buildNodeGraph("n1", ' + JSON.stringify(grapheFloat) + ', {}, {})', e);
  assert.equal(sansOverride.__v, 0.5, 'sans valuesParams : la valeur par defaut du graphe');
  const avecOverride = vm.runInContext(
    'buildNodeGraph("n1", ' + JSON.stringify(grapheFloat) + ', {}, {valuesParams:{intensity:0.9}})', e);
  assert.equal(avecOverride.__v, 0.9, 'valuesParams[name] du materiau instance prime sur le defaut');

  const grapheCouleur = {nodes:[{id:'c', type:'param.color', params:{name:'teinte', defaultValue:'#8899aa'}}], links:[]};
  const couleurDefaut = vm.runInContext(
    'buildNodeGraph("c", ' + JSON.stringify(grapheCouleur) + ', {}, {})', e);
  assert.equal(couleurDefaut.__tag, 'color:#8899aa');
  const couleurOverride = vm.runInContext(
    'buildNodeGraph("c", ' + JSON.stringify(grapheCouleur) + ', {}, {valuesParams:{teinte:"#ff0000"}})', e);
  assert.equal(couleurOverride.__tag, 'color:#ff0000');
});

test('param.texture demande l\'asset override (valuesParams) au resolveTexture du ctx, pas le defaut du graphe si present', () => {
  const e = env();
  const graphe = {nodes:[{id:'n1', type:'param.texture', params:{name:'albedo', assetTextureDefault:'a-defaut'}}], links:[]};
  vm.runInContext(`
    globalThis.__ctx = { valuesParams: {albedo:'a-override'},
      resolveTexture: function(id){ globalThis.__idDemande = id; return {__faux:'texture-' + id}; } };
  `, e);
  const node = vm.runInContext(
    'buildNodeGraph("n1", ' + JSON.stringify(graphe) + ', {}, globalThis.__ctx)', e);
  assert.equal(vm.runInContext('globalThis.__idDemande', e), 'a-override');
  assert.equal(node.tex.__faux, 'texture-a-override');
});

test('assetMaterialOf ne reconnait PAS un graphShader : seul un materiau (instance) est assignable a un objet', () => {
  const e = creerContexte(['js/assets.js', 'js/materials.js', 'js/model-import.js', 'js/import-settings.js',
                            'js/project-settings.js', 'js/serialization.js', 'js/shader-graph.js']);
  vm.runInContext(`
    assets.push({id:'gs1', kind:'graphShader', name:'Test', target:'lit',
      nodes:[], links:[], outputs:{}});
    globalThis.__obj = {userData:{materialId:'gs1'}};
  `, e);
  const trouve = vm.runInContext('assetMaterialOf(globalThis.__obj)', e);
  assert.equal(trouve, null);
});

test('applyMaterialOn, pour un materiau avec shaderId, construit via buildMaterialFromGraph et applique valuesParams', () => {
  const e = creerContexte(['js/objects.js', 'js/assets.js', 'js/materials.js', 'js/model-import.js', 'js/import-settings.js',
                            'js/project-settings.js', 'js/serialization.js', 'js/shader-graph.js']);
  vm.runInContext(`
    THREE.MeshStandardNodeMaterial = function(){ this.__type = 'MeshStandardNodeMaterial'; };
    var TSL = { color: function(hex){ return {__tag:'color:' + hex}; } };
    const shader = {id:'gs1', kind:'graphShader', target:'lit',
      nodes:[{id:'c', type:'param.color', params:{name:'teinte', defaultValue:'#8899aa'}}],
      links:[], outputs:{color:'c'}};
    const materiau = {id:'m1', kind:'material', name:'Eau', props:{},
      shaderId:'gs1', valuesParams:{teinte:'#123456'}};
    assets.push(shader, materiau);
    const geo = new THREE.BoxGeometry(1,1,1);
    const matAvant = new THREE.MeshStandardMaterial();
    const mesh = new THREE.Mesh(geo, matAvant);
    mesh.userData.type = 'mesh';
    globalThis.__resultat = applyMaterialOn(materiau, mesh);
    globalThis.__mesh = mesh;
  `, e);
  assert.equal(vm.runInContext('globalThis.__resultat', e), true);
  assert.equal(vm.runInContext('globalThis.__mesh.material.__type', e), 'MeshStandardNodeMaterial');
  assert.equal(vm.runInContext('globalThis.__mesh.material.colorNode.__tag', e), 'color:#123456');
  assert.equal(vm.runInContext('globalThis.__mesh.userData.materialId', e), 'm1');
});

test('assignShaderOnMaterial fixe shaderId, reinitialise valuesParams, et resynchronise les objets qui portent ce materiau', () => {
  const e = creerContexte(['js/objects.js', 'js/assets.js', 'js/materials.js',
                            'js/model-import.js', 'js/import-settings.js', 'js/project-settings.js', 'js/serialization.js', 'js/shader-graph.js']);
  vm.runInContext(`
    // pushHistory (history.js) dépend de "phys", posé par physics.js — hors
    // périmètre de ce test, qui vérifie seulement l'effet sur l'asset matériau.
    var pushHistory = function(){};
    THREE.MeshStandardNodeMaterial = function(){ this.__type = 'MeshStandardNodeMaterial'; };
    var TSL = { color: function(hex){ return {__tag:'color:' + hex}; } };
    const shader = {id:'gs1', kind:'graphShader', target:'lit',
      nodes:[{id:'c', type:'param.color', params:{name:'teinte', defaultValue:'#00ff00'}}],
      links:[], outputs:{color:'c'}};
    const materiau = {id:'m1', kind:'material', name:'M', props:{color:'#8899aa'},
      valuesParams:{ancienneCleObsolete:1}};
    assets.push(shader, materiau);
    assignShaderOnMaterial(materiau, shader);
    globalThis.__materiau = materiau;
  `, e);
  assert.equal(vm.runInContext('globalThis.__materiau.shaderId', e), 'gs1');
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext('globalThis.__materiau.valuesParams', e))), {});
});

test('createAssetGraphShader ajoute un asset avec le graphe par defaut', () => {
  const e = creerContexte(['js/assets.js', 'js/materials.js', 'js/model-import.js', 'js/import-settings.js',
                            'js/project-settings.js', 'js/serialization.js', 'js/shader-graph.js']);
  vm.runInContext('globalThis.__a = createAssetGraphShader();', e);
  const kind = vm.runInContext('globalThis.__a.kind', e);
  const nbNoeuds = vm.runInContext('globalThis.__a.nodes.length', e);
  const dansAssets = vm.runInContext('assets.indexOf(globalThis.__a) !== -1', e);
  assert.equal(kind, 'graphShader');
  assert.equal(nbNoeuds, 1);
  assert.ok(dansAssets);
});

test('un graphShader survit a un aller-retour assetsSerialized -> rebuildAssetsFromDescriptors', async () => {
  const e = creerContexte(['js/assets.js', 'js/materials.js', 'js/model-import.js', 'js/import-settings.js',
                            'js/project-settings.js', 'js/serialization.js', 'js/shader-graph.js']);
  vm.runInContext('globalThis.__a = createAssetGraphShader();', e);
  vm.runInContext('globalThis.__a.nodes[0].params.color = "#ff00ff";', e);
  const descripteurs = await vm.runInContext('assetsSerialized()', e);
  const d = descripteurs.find(function(x){ return x.kind === 'graphShader'; });
  assert.ok(d, 'assetsSerialized doit produire un descripteur graphShader');
  assert.equal(d.target, 'lit');
  assert.equal(d.nodes[0].params.color, '#ff00ff');

  vm.runInContext('assets.length = 0;', e);   // repart d'un project empty, comme au rechargement
  const byId = await vm.runInContext(
    'rebuildAssetsFromDescriptors(' + JSON.stringify(descripteurs) + ', async () => null)', e);
  const recharge = vm.runInContext('assets.find(a => a.kind === "graphShader")', e);
  assert.ok(recharge);
  assert.equal(recharge.nodes[0].params.color, '#ff00ff');
});

test('migrateProjectData passe la version 11 a la version courante (15) sans toucher aux autres champs', () => {
  const e = creerContexte(['js/assets.js', 'js/materials.js', 'js/model-import.js', 'js/import-settings.js', 'js/project-settings.js', 'js/serialization.js']);
  const data = {version: 11, scenes: [], assets: []};
  const migre = vm.runInContext('migrateProjectData(' + JSON.stringify(data) + ')', e);
  assert.equal(migre.version, 15, 'la boucle enchaine 11->12, 12->13, 13->14 puis 14->15');
});

test('migrateProjectData (12 -> 13) remplace un materialId pointant DIRECTEMENT sur un graphShader par un materiau instance qui le reference', () => {
  const e = creerContexte(['js/assets.js', 'js/materials.js', 'js/model-import.js', 'js/import-settings.js', 'js/project-settings.js', 'js/serialization.js']);
  const data = {
    version: 12, scenes: [{name:'S', data:{objects:[
      {id:1, type:'mesh', name:'A', materialId:'gs1'},
      {id:2, type:'mesh', name:'B', materialId:'gs1'},   // partage le meme shader : un seul materiau de substitution
      {id:3, type:'mesh', name:'C', materialId:'m-existant'}   // deja un vrai material : inchange
    ], tracks:[], duration:5, loop:true}}],
    assets: [
      {id:'gs1', kind:'graphShader', name:'Eau', target:'lit', nodes:[], links:[], outputs:{}},
      {id:'m-existant', kind:'material', name:'M', props:{}}
    ]
  };
  const migre = vm.runInContext('migrateProjectData(' + JSON.stringify(data) + ')', e);
  assert.equal(migre.version, 15);
  const objects = migre.scenes[0].data.objects;
  assert.notEqual(objects[0].materialId, 'gs1');
  assert.equal(objects[0].materialId, objects[1].materialId, 'les deux objets partagent le meme materiau de substitution');
  assert.equal(objects[2].materialId, 'm-existant', 'un materialId qui pointait deja sur un materiau reste inchange');
  const substitut = migre.assets.find(a => a.id === objects[0].materialId);
  assert.ok(substitut);
  assert.equal(substitut.kind, 'material');
  assert.equal(substitut.shaderId, 'gs1');
});

test('un materiau avec shaderId/valuesParams survit a un aller-retour assetsSerialized -> rebuildAssetsFromDescriptors', async () => {
  const e = creerContexte(['js/assets.js', 'js/materials.js', 'js/model-import.js', 'js/import-settings.js',
                            'js/project-settings.js', 'js/serialization.js', 'js/shader-graph.js']);
  vm.runInContext(`
    globalThis.__shader = createAssetGraphShader();
    globalThis.__mat = createAssetMaterial();
    globalThis.__mat.shaderId = globalThis.__shader.id;
    globalThis.__mat.valuesParams = {teinte:'#ff00ff'};
  `, e);
  const descripteurs = await vm.runInContext('assetsSerialized()', e);
  const dMat = descripteurs.find(x => x.kind === 'material');
  assert.equal(dMat.shaderId, vm.runInContext('globalThis.__shader.id', e));
  assert.deepEqual(JSON.parse(JSON.stringify(dMat.valuesParams)), {teinte:'#ff00ff'});

  vm.runInContext('assets.length = 0;', e);
  await vm.runInContext(
    'rebuildAssetsFromDescriptors(' + JSON.stringify(descripteurs) + ', async () => null)', e);
  const materiauRecharge = vm.runInContext('assets.find(a => a.kind === "material")', e);
  const shaderRecharge = vm.runInContext('assets.find(a => a.kind === "graphShader")', e);
  assert.equal(materiauRecharge.shaderId, shaderRecharge.id, 'shaderId remappe vers le NOUVEL id du shader recharge');
  assert.deepEqual(JSON.parse(JSON.stringify(materiauRecharge.valuesParams)), {teinte:'#ff00ff'});
});

test('diskAssetManifest ecrit un fichier .graph-shader.json et un descripteur avec fichier', () => {
  const e = creerContexte(['js/assets.js', 'js/materials.js', 'js/model-import.js', 'js/import-settings.js',
                            'js/project-settings.js', 'js/serialization.js', 'js/shader-graph.js']);
  vm.runInContext('globalThis.__a = createAssetGraphShader(); globalThis.__a.name = "Eau";', e);
  const {assets: dAssets, filesAWrite} = vm.runInContext('diskAssetManifest()', e);
  const d = dAssets.find(x => x.kind === 'graphShader');
  assert.ok(d, 'descripteur graphShader attendu');
  assert.ok(d.file.endsWith('.graph-shader.json'), 'nom de fichier : ' + d.file);
  const file = filesAWrite.find(f => f.filePath.endsWith(d.file));
  assert.ok(file, 'fichier a ecrire attendu');
  const content = JSON.parse(file.content);
  assert.equal(content.target, 'lit');
  assert.ok(Array.isArray(content.nodes));
});

// Le blackboard est du shader au meme titre que ses noeuds : il doit traverser CHACUN des
// trois chemins de persistance, sinon une propriete creee dans l'editeur se perd d'une
// ouverture a l'autre.
test('le blackboard survit a la sauvegarde (projet embarque ET fichier disque)', async () => {
  const e = creerContexte(['js/assets.js', 'js/materials.js', 'js/model-import.js', 'js/import-settings.js',
                            'js/project-settings.js', 'js/serialization.js', 'js/shader-graph.js',
                            'js/shader-graph-editor.js']);
  vm.runInContext(`
    globalThis.openEditorExternal = function(){};   // l'editeur externe n'existe pas ici
    globalThis.__a = createAssetGraphShader();
    addPropertyGraphShader(globalThis.__a, 'color', 'Teinte');
  `, e);

  const {assets: dAssets, filesAWrite} = vm.runInContext('diskAssetManifest()', e);
  const d = dAssets.find(x => x.kind === 'graphShader');
  const contenu = JSON.parse(filesAWrite.find(f => f.filePath.endsWith(d.file)).content);
  assert.equal(contenu.properties[0].name, 'Teinte', 'fichier .graph-shader.json');

  const descripteurs = await vm.runInContext('assetsSerialized()', e);
  const dg = descripteurs.find(x => x.kind === 'graphShader');
  assert.equal(dg.properties[0].name, 'Teinte', 'projet embarque');

  vm.runInContext('assets.length = 0;', e);
  await vm.runInContext(
    'rebuildAssetsFromDescriptors(' + JSON.stringify(descripteurs) + ', async () => null)', e);
  const recharge = vm.runInContext('assets.find(a => a.kind === "graphShader")', e);
  assert.equal(recharge.properties[0].name, 'Teinte', 'relecture');
  assert.equal(recharge.properties[0].type, 'color');
});

test('resolveAssetDescriptors relit un .graph-shader.json depuis l\'tree scanne', async () => {
  const e = creerContexte(['js/assets.js', 'js/materials.js', 'js/model-import.js', 'js/import-settings.js',
                            'js/project-settings.js', 'js/serialization.js', 'js/project-folder.js', 'js/shader-graph.js']);
  const descripteur = {id:'gs1', kind:'graphShader', name:'Eau', folder:'', file:'eau.graph-shader.json'};
  const contenuDisque = JSON.stringify({target:'lit',
    nodes:[{id:'n1', type:'constant.color', params:{color:'#0000ff'}}],
    links:[], outputs:{color:'n1'}, layout:{}});
  vm.runInContext(`
    globalThis.__arbre = { files: [{ filePath: 'assets/eau.graph-shader.json',
      handle: { getFile: async () => ({ text: async () => ${JSON.stringify(contenuDisque)} }) } }] };
  `, e);
  const resolus = await vm.runInContext(
    'resolveAssetDescriptors(' + JSON.stringify([descripteur]) + ', globalThis.__arbre)', e);
  assert.equal(resolus[0].target, 'lit');
  assert.equal(resolus[0].nodes[0].params.color, '#0000ff');
});

// Le slot `smoothness` porte la convention d'Unity (1 = lisse) ; three raisonne en rugosite.
// L'inversion doit donc se faire au branchement, et le slot `roughness` herite rester DIRECT.
test('la sortie smoothness alimente roughnessNode inversee, roughness reste directe', () => {
  const e = env();
  vm.runInContext(FAUX_TSL + FAUX_THREE_NODE_MATERIALS, e);
  const asset = {target:'lit', links:[],
    nodes:[{id:'n1', type:'constant.float', params:{value:0.25}}]};
  const lisse = vm.runInContext('buildMaterialFromGraph('
    + JSON.stringify(Object.assign({}, asset, {outputs:{smoothness:'n1'}})) + ', null, {})', e);
  assert.equal(lisse.roughnessNode.__v, 0.75, 'smoothness 0.25 => roughness 0.75');
  const brut = vm.runInContext('buildMaterialFromGraph('
    + JSON.stringify(Object.assign({}, asset, {outputs:{roughness:'n1'}})) + ', null, {})', e);
  assert.equal(brut.roughnessNode.__v, 0.25, 'la cle heritee ne s inverse pas');
});
