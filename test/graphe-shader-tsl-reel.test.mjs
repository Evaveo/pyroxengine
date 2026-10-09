import { deEsm } from './engine-env.mjs';
// moteur/test/graphe-shader-tsl-reel.test.mjs
// Construit CHAQUE type du registre avec le VRAI TSL de vendor-esm/, et non le faux TSL des
// autres tests.
//
// Aucun GPU n'est nécessaire : assembler un graphe de nœuds TSL est du pur calcul d'objets,
// seul le RENDU exige un contexte WebGPU. C'est donc le seul filet capable d'attraper une
// signature fausse — bad number d'arguments, fonction absente ou renommée par une montée
// de version de three. Le faux TSL des autres tests, lui, accepte n'importe quoi : il aurait
// laissé passer un `TSL.voronoi()` qui n'existe pas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const racineMoteur = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

async function contexteTslReel(){
  const THREE = await import('../vendor-esm/three.webgpu.min.js');
  const sandbox = {
    THREE: THREE, TSL: THREE.TSL,
    console, Math, Number, Object, JSON, Set, Array, String, Error,
    // shader-graph.js accroche un bouton s'il existe : il n'existe pas ici.
    document: {getElementById(){ return null; }}
  };
  sandbox.globalThis = sandbox;
  const contexte = vm.createContext(sandbox);
  const filePath = path.join(racineMoteur, 'js/shader-graph.js');
  vm.runInContext(deEsm(readFileSync(filePath, 'utf8')), contexte, {filename: filePath});
  return contexte;
}

test('chaque type du registre se construit avec le VRAI TSL', async () => {
  const contexte = await contexteTslReel();
  const types = vm.runInContext('Object.keys(REGISTRY_GRAPH_SHADER)', contexte);
  assert.ok(types.length >= 30, 'registre attendu fourni, ' + types.length + ' types trouvés');

  const echecs = [];
  types.forEach(function(type){
    vm.runInContext(`
      globalThis.__err = null;
      try {
        const def = {target:'lit', links:[], outputs:{color:'n1'},
          nodes:[{id:'n1', type:${JSON.stringify(type)}, params:{}}]};
        const n = buildNodeGraph('n1', def, {},
          {resolveTexture:function(){ return null; }, valuesParams:{}});
        if(n === null || n === undefined) globalThis.__err = 'a rendu ' + n;
      } catch(e){ globalThis.__err = e.message; }
    `, contexte);
    const err = vm.runInContext('globalThis.__err', contexte);
    if(err) echecs.push(type + ' :: ' + err);
  });

  assert.deepEqual(echecs, [], 'types qui ne se construisent pas :\n' + echecs.join('\n'));
});

test('les parametres nommes des noeuds proceduraux sont bien lus (scale, octaves, desordre)', async () => {
  const contexte = await contexteTslReel();
  // On ne peut pas comparer deux graphes TSL numériquement sans GPU ; ce qu'on vérifie ici,
  // c'est qu'une valeur de paramètre EXPLICITE ne fait pas exploser la construction — le cas
  // qui casserait si une signature MaterialX changeait d'ordre d'arguments.
  const cas = [
    ['procedural.bruit', {scale: 24}],
    ['procedural.bruitFractal', {scale: 4, octaves: 5, lacunarite: 2.3, falloff: 0.4}],
    ['procedural.voronoi', {scale: 12, desordre: 0.6}],
    ['procedural.damier', {scale: 3}],
    ['uv.tilingOffset', {tileX: 2, tileY: 3, offsetX: 0.25, offsetY: 0}],
    ['uv.rotate', {angle: 1.2, centerX: 0.5, centerY: 0.5}],
    ['math.remap', {eMin: -1, eMax: 1, sMin: 0, sMax: 1}]
  ];
  cas.forEach(function(c){
    vm.runInContext(`
      globalThis.__err = null;
      try {
        const def = {target:'lit', links:[], outputs:{color:'n1'},
          nodes:[{id:'n1', type:${JSON.stringify(c[0])}, params:${JSON.stringify(c[1])}}]};
        buildNodeGraph('n1', def, {}, {resolveTexture:function(){ return null; }});
      } catch(e){ globalThis.__err = e.message; }
    `, contexte);
    const err = vm.runInContext('globalThis.__err', contexte);
    assert.equal(err, null, c[0] + ' avec params explicites : ' + err);
  });
});

test('une scale de 0 reste 0 et ne retombe pas sur le defaut', async () => {
  const contexte = await contexteTslReel();
  // `Number(x) || defaut` trahissait ici : 0 est falsy. numberOr() existe pour ça.
  const zero = vm.runInContext('numberOr(0, 8)', contexte);
  const empty = vm.runInContext('numberOr(undefined, 8)', contexte);
  const text = vm.runInContext('numberOr("abc", 8)', contexte);
  assert.equal(zero, 0);
  assert.equal(empty, 8);
  assert.equal(text, 8);
});

test('buildMaterialFromGraph rend un vrai NodeMaterial three, lit comme unlit', async () => {
  const contexte = await contexteTslReel();
  vm.runInContext(`
    const def = {target:'lit', links:[{node:'noise', entry:'uv', source:'uv1'}],
      outputs:{color:'noise', roughness:'f'},
      nodes:[{id:'uv1', type:'uv', params:{}},
              {id:'noise', type:'procedural.voronoi', params:{scale:10}},
              {id:'f', type:'constant.float', params:{value:0.3}}]};
    globalThis.__lit = buildMaterialFromGraph(def, function(){ return null; }, {});
    const defUnlit = Object.assign({}, def, {target:'unlit', outputs:{color:'noise'}});
    globalThis.__unlit = buildMaterialFromGraph(defUnlit, function(){ return null; }, {});
  `, contexte);
  assert.equal(vm.runInContext('__lit.isMeshStandardNodeMaterial === true', contexte), true);
  assert.equal(vm.runInContext('!!__lit.colorNode', contexte), true);
  assert.equal(vm.runInContext('!!__lit.roughnessNode', contexte), true);
  assert.equal(vm.runInContext('__unlit.isMeshBasicNodeMaterial === true', contexte), true);
});

test('les proprietes d\'un graphe sont des uniformes que setShaderProperty change en jeu', async () => {
  const contexte = await contexteTslReel();
  const r = vm.runInContext(`
    const asset = {target:'lit', properties:[
        {id:'p1', name:'Onde', type:'float', defaultValue:0},
        {id:'p2', name:'Teinte', type:'color', defaultValue:'#000000'},
        {id:'p3', name:'Centre', type:'vec3', defaultValue:{x:0, y:0, z:0}}],
      nodes:[{id:'n1', type:'property.ref', params:{propertyId:'p2'}},
             {id:'n2', type:'property.ref', params:{propertyId:'p2'}},
             {id:'n3', type:'property.ref', params:{propertyId:'p1'}},
             {id:'n4', type:'property.ref', params:{propertyId:'p3'}}],
      links:[], outputs:{color:'n1', emissive:'n2', metalness:'n3', normal:'n4'}};
    const m = buildMaterialFromGraph(asset, function(){ return null; }, {Onde: 0.25});
    const p = m.userData.shaderProperties;
    const avant = p.Onde.value;
    const ok = [setShaderProperty(m, 'Onde', 3), setShaderProperty(m, 'Teinte', '#ff0000'),
                setShaderProperty(m, 'Centre', [1, 2, 3]), setShaderProperty(m, 'Absent', 1)];
    ({avant: avant, onde: p.Onde.value, rouge: p.Teinte.value.r, z: p.Centre.value.z, ok: ok,
      partage: m.colorNode === m.emissiveNode})
  `, contexte);
  assert.equal(r.avant, 0.25, 'la valeur du materiau (valuesParams) initialise l\'uniforme');
  assert.equal(r.onde, 3);
  assert.equal(r.rouge, 1);
  assert.equal(r.z, 3);
  assert.deepEqual([...r.ok], [true, true, true, false]);
  assert.equal(r.partage, true, 'deux lectures de la meme propriete partagent UN uniforme');
});
