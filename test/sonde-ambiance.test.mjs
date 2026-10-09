// moteur/test/probe-ambiance.test.mjs
// Deux régressions vécues au passage à WebGPURenderer, toutes deux SILENCIEUSES :
//   1. la cible cubemap était créée avec WebGLCubeRenderTarget, classe absente du paquet
//      three/webgpu — on passait donc au renderer une cible venue de l'autre bundle ;
//   2. la couleur d'ambiance était lue avec readRenderTargetPixels(), méthode qui n'existe
//      pas sur WebGPURenderer, et l'échec était avalé par un try/catch.
// Ces tests verrouillent le choix de classe et la lecture asynchrone, y compris
// l'alignement des lignes que WebGPU impose.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { creerContexte, deEsm } from './engine-env.mjs';

const racineMoteur = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// probes.js vit au milieu de l'éditeur : on ne charge que lui, avec le strict minimum de
// globales dont il a besoin pour être évalué (aucune n'intervient dans ce qu'on teste).
function chargerSondes(){
  const env = creerContexte([]);
  vm.runInContext(`
    var LAYER_HELPERS = 31;
    var scene = new THREE.Scene();
    var selection = null;
    function applyNodeMixin(o){ o.addComponent = function(){}; }
    function buildInspector(){}
    function listMats(){ return []; }
    function setStatus(){}
  `, env);
  // PROBE_DEFAULT/ensureProbe vivent dans js/component-data.js (partage avec le runtime)
  ['js/component-data.js', 'js/probes.js'].forEach((f) => {
    vm.runInContext(deEsm(readFileSync(path.join(racineMoteur, f), 'utf8')), env, { filename: f });
  });
  // les `const`/`function` de haut niveau d'un script vm ne deviennent pas des propriétés
  // de l'object global : on ponte explicitement ce que le test appelle
  vm.runInContext(`
    this.createTargetCube = createTargetCube;
    this.measureAmbientProbe = measureAmbientProbe;
  `, env);
  return env;
}

// Une face 16×16 dont seule la zone centrale 8×8 est colorée, avec des lignes DÉLIBÉRÉMENT
// remplies jusqu'à 256 bytes : c'est l'alignement qu'impose un transfert WebGPU, et lire la
// face en supposant `size * 4` octets par ligne donnerait une moyenne fausse.
const SIZE = 16, PAR_LIGNE = 256;   // 16 px × 4 o = 64 o, complétés à 256
const CENTRE = 8, DEC = 4;

function faireFace(r, v, b){
  const buf = new Uint8Array(SIZE * PAR_LIGNE);
  for(let y = DEC; y < DEC + CENTRE; y++){
    for(let x = DEC; x < DEC + CENTRE; x++){
      const i = y * PAR_LIGNE + x * 4;
      buf[i] = r; buf[i+1] = v; buf[i+2] = b; buf[i+3] = 255;
    }
  }
  return buf;
}

test('la cible cubemap suit le RENDERER : CubeRenderTarget sous WebGPU, classe WebGL sinon', () => {
  const env = chargerSondes();

  // three classique seul : CubeRenderTarget n'existe pas, on retombe sur la classe WebGL
  assert.equal(env.THREE.CubeRenderTarget, undefined, 'le bundle classique ne définit pas CubeRenderTarget');
  const cibleWebGL = env.createTargetCube(64);
  assert.ok(cibleWebGL.isWebGLCubeRenderTarget || cibleWebGL.isRenderTarget,
    'sans le paquet webgpu, une cible cubemap WebGL reste attendue');

  // paquet webgpu présent (ce que le pont ESM produit) : c'est SA classe qui doit servir
  let recu = null;
  vm.runInContext(`
    THREE = new Proxy(THREE, {
      get(target, p){
        if(p === 'CubeRenderTarget') return globalThis.__FauxCube;
        return target[p];
      }
    });
  `, env);
  vm.runInContext('this.__FauxCube = function(res, opt){ this.width = res; this.opt = opt; this.marque = "webgpu"; };', env);
  // Sous un renderer WebGL, les deux three étant chargés, c'est la classe WebGL qui sert : la
  // cible de l'autre bundle faisait téléverser six images absentes (texSubImage2D, v0.168.2).
  vm.runInContext('renderer = {isWebGLRenderer: true};', env);
  const sousWebGL = env.createTargetCube(32);
  assert.notEqual(sousWebGL.marque, 'webgpu', 'sous le renderer WebGL, la cible doit rester WebGL');
  vm.runInContext('renderer = {isWebGPURenderer: true};', env);
  recu = env.createTargetCube(128);
  assert.equal(recu.marque, 'webgpu', 'CubeRenderTarget doit primer dès que le paquet webgpu le fournit');
  assert.equal(recu.width, 128, 'la résolution est passée telle quelle');
  assert.equal(recu.opt.format, env.THREE.RGBAFormat, 'RGBA reste demandé (lecture des pixels)');
});

test('l\'ambiance est mesurée par la lecture asynchrone, alignement des lignes compris', async () => {
  const env = chargerSondes();
  const appels = [];
  vm.runInContext(`
    renderer = {
      isWebGPURenderer: true,
      readRenderTargetPixelsAsync(rt, x, y, l, h, index, face){
        globalThis.__appels.push({x: x, y: y, l: l, h: h, index: index, face: face});
        return Promise.resolve(globalThis.__face);
      }
    };
  `, env);
  env.__appels = appels;
  env.__face = faireFace(200, 100, 50);

  const color = await env.measureAmbientProbe({rt: {width: SIZE}});

  assert.equal(color, '#c86432', 'la moyenne ne doit porter que sur la zone centrale colorée');
  assert.equal(appels.length, 6, 'les six faces du cubemap sont lues');
  // copie dans le realm du test : l'object vient du contexte vm, et deepStrictEqual
  // compare aussi les prototypes (piège déjà rencontré, cf. commit b334e59)
  assert.deepStrictEqual({...appels[0]}, {x: 0, y: 0, l: SIZE, h: SIZE, index: 0, face: 0},
    'la face est lue ENTIÈRE : une largeur partielle tomberait à côté de l\'alignement WebGPU');
  assert.equal(appels[5].face, 5, 'l\'indice de face est bien celui du 7e argument');
});

test('une lecture impossible ne casse rien et ne se tait plus', async () => {
  const env = chargerSondes();
  const alertes = [];
  vm.runInContext(`
    renderer = {
      isWebGPURenderer: true,
      readRenderTargetPixelsAsync(){ throw new TypeError('pas de lecture ici'); }
    };
    console = { warn: function(){ globalThis.__alertes.push(Array.from(arguments).join(' ')); } };
  `, env);
  env.__alertes = alertes;

  const color = await env.measureAmbientProbe({rt: {width: SIZE}});

  assert.equal(color, null, 'la cuisson doit survivre à une mesure impossible');
  assert.equal(alertes.length, 1, 'un avertissement est émis — c\'est le silence qui avait masqué la régression');
  assert.match(alertes[0], /ambiance/i);
});

test('la version WebGL reste servie par un tampon fourni', async () => {
  const env = chargerSondes();
  const appels = [];
  vm.runInContext(`
    renderer = {
      readRenderTargetPixelsAsync(rt, x, y, l, h, buf, face){
        globalThis.__appels.push({fourni: buf instanceof Uint8Array, face: face});
        globalThis.__face.forEach(function(o, i){ buf[i] = o; });
        return Promise.resolve(buf);
      }
    };
  `, env);
  env.__appels = appels;
  // pas d'alignement côté WebGL : la ligne fait exactement size × 4 octets
  const plat = new Uint8Array(SIZE * SIZE * 4);
  for(let y = DEC; y < DEC + CENTRE; y++){
    for(let x = DEC; x < DEC + CENTRE; x++){
      const i = (y * SIZE + x) * 4;
      plat[i] = 200; plat[i+1] = 100; plat[i+2] = 50; plat[i+3] = 255;
    }
  }
  env.__face = plat;

  const color = await env.measureAmbientProbe({rt: {width: SIZE}});

  assert.equal(color, '#c86432');
  assert.equal(appels.length, 6);
  assert.ok(appels[0].fourni, 'la signature WebGL reçoit un tampon à remplir, pas un retour');
});
