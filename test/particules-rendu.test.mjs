// moteur/test/particules-rendu.test.mjs
//
// La couche three PARTAGÉE des particules (js/particle-system.js) : celle qui tourne à
// l'identique dans l'éditeur et dans le jeu publié. Le vrai three.min.js (géométries, maillage,
// attributs instanciés) et un TSL FACTICE — chaque fonction rend un nœud qui accepte toutes les
// méthodes : le test ne juge pas le shader, il vérifie que la construction ne lève pas, que
// chaque orientation et la planche se construisent, et que le maillage n'est reconstruit QUE
// quand ce qui le fixe change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { creerContexte } from './engine-env.mjs';

function contexte(){
  const ctx = creerContexte([]);
  vm.runInContext(`
    var node = new Proxy(function(){}, {
      get: function(t, k){ return k === Symbol.toPrimitive ? function(){ return 0; } : node; },
      apply: function(){ return node; }
    });
    var TSL = new Proxy({}, {get: function(t, k){
      if(k === 'uniform') return function(v){
        return new Proxy({value: v}, {get: function(o, kk){ return kk === 'value' ? o.value : node; }});
      };
      return node;   // propriété (positionGeometry) ou fonction (vec3) : le même nœud appelable
    }});
    THREE.MeshBasicNodeMaterial = class extends THREE.MeshBasicMaterial {};
    psSoftTexture = new THREE.Texture();
    var released = [];
    var host = {
      findAsset: function(id){ return (globalThis.assetsTest || []).find(function(a){ return a.id === id; }) || null; },
      resolveTexture: function(){ return new THREE.Texture(); },
      sceneTarget: new THREE.Scene(),
      release: function(x){ released.push(x); },
      camera: function(){ return null; }
    };
    function emitter(part){
      const o = new THREE.Object3D();
      o.userData.part = part;
      return o;
    }
  `, ctx);
  return ctx;
}

test('un emetteur se construit, emet, et ses particules partent au GPU', () => {
  const ctx = contexte();
  const r = vm.runInContext(`
    (function(){
      const o = emitter(defaultPartBag());
      const sys = createParticleSystem(o, host);
      for(let i = 0; i < 30; i++) updateParticleSystem(sys, 1 / 60, {emit: true});
      return {nb: sys.state.nb, count: sys.geo.instanceCount, inScene: host.sceneTarget.children.length};
    })()
  `, ctx);
  assert.ok(r.nb > 5, 'des particules vivantes');
  assert.equal(r.count, r.nb, 'le nombre d instances suit les vivantes');
  assert.equal(r.inScene, 1, 'le maillage est posé dans la scène de l hôte');
});

test('un ANCIEN sac (champs a plat) se lit tel quel par le systeme partage', () => {
  const ctx = contexte();
  const r = vm.runInContext(`
    (function(){
      const o = emitter({rate: 120, vie: 3, mode: 'continu'});
      const sys = createParticleSystem(o, host);
      for(let i = 0; i < 60; i++) updateParticleSystem(sys, 1 / 60, {emit: true});
      return {nb: sys.state.nb, version: o.userData.part.version};
    })()
  `, ctx);
  assert.equal(r.version, 2);
  assert.ok(Math.abs(r.nb - 120) <= 2, '120 par seconde, mesuré ' + r.nb);
});

test('chaque orientation et la planche de sprites se construisent', () => {
  const ctx = contexte();
  ['billboard', 'stretched', 'horizontal', 'vertical'].forEach((mode) => {
    ['additive', 'normal', 'multiply'].forEach((blend) => {
      const ok = vm.runInContext(`
        (function(){
          const bag = defaultPartBag();
          bag.system.render.renderMode = '${mode}';
          bag.system.render.blending = '${blend}';
          bag.system.textureSheet.enabled = true;
          bag.system.textureSheet.tilesX = 4;
          const sys = createParticleSystem(emitter(bag), host);
          updateParticleSystem(sys, 1 / 60, {emit: true});
          return !!sys.mesh;
        })()
      `, ctx);
      assert.ok(ok, mode + ' / ' + blend);
    });
  });
});

test('le maillage n est reconstruit que si ce qui le fixe change', () => {
  const ctx = contexte();
  const r = vm.runInContext(`
    (function(){
      const o = emitter(defaultPartBag());
      const sys = createParticleSystem(o, host);
      const m1 = sys.mesh;
      o.userData.part.system.main.startColor = ['#00ff00', '#00ff00'];
      refreshParticleSystem(sys);
      const m2 = sys.mesh;
      o.userData.part.system.main.maxParticles = 900;
      refreshParticleSystem(sys);
      return {sameAfterColor: m1 === m2, rebuiltAfterMax: sys.mesh !== m2, max: sys.state.max,
              released: released.length, inScene: host.sceneTarget.children.length};
    })()
  `, ctx);
  assert.equal(r.sameAfterColor, true, 'une couleur ne reconstruit rien');
  assert.equal(r.rebuiltAfterMax, true, 'la taille des tampons, si');
  assert.equal(r.max, 900);
  assert.equal(r.released, 2, 'géométrie et matériau de l ancien maillage rendus à l hôte');
  assert.equal(r.inScene, 1, 'pas de maillage orphelin dans la scène');
});

test('sous-emetteur : la mort d une particule en fait naitre ailleurs', () => {
  const ctx = contexte();
  const r = vm.runInContext(`
    (function(){
      globalThis.assetsTest = [{id: 'a9', kind: 'particles', system: normalizeParticleSystem({
        emission: {rateOverTime: 0}, main: {startLifetime: [5, 5]}})}];
      const bag = defaultPartBag();
      bag.system.main.startLifetime = [0.1, 0.1];
      bag.system.subEmitters = {enabled: true, list: [{event: 'death', particlesId: 'a9', count: 5}]};
      const sys = createParticleSystem(emitter(bag), host);
      for(let i = 0; i < 30; i++) updateParticleSystem(sys, 1 / 60, {emit: true});
      return {subs: sys.subs.length, enfants: sys.subs[0].child.state.nb, total: aliveCountOf(sys)};
    })()
  `, ctx);
  assert.equal(r.subs, 1);
  assert.ok(r.enfants > 0, 'des particules filles sont nées');
  assert.ok(r.total > r.enfants);
});

test('arreter / jouer / redemarrer', () => {
  const ctx = contexte();
  const r = vm.runInContext(`
    (function(){
      const sys = createParticleSystem(emitter(defaultPartBag()), host);
      for(let i = 0; i < 20; i++) updateParticleSystem(sys, 1 / 60, {emit: true});
      stopParticleSystem(sys, true);
      const apresStop = sys.state.nb;
      for(let i = 0; i < 20; i++) updateParticleSystem(sys, 1 / 60, {emit: true});
      const toujoursMuet = sys.state.nb;
      playParticleSystem(sys);
      for(let i = 0; i < 20; i++) updateParticleSystem(sys, 1 / 60, {emit: true});
      return {apresStop: apresStop, toujoursMuet: toujoursMuet, repart: sys.state.nb};
    })()
  `, ctx);
  assert.equal(r.apresStop, 0);
  assert.equal(r.toujoursMuet, 0, 'arrêté, il n émet plus');
  assert.ok(r.repart > 0, 'play le relance');
});
