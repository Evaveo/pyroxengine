// Le repli sur le ciel a introduit un défaut que sa propre sequence ne pouvait pas voir, et
// qui frappait à la RÉOUVERTURE d'un project old — donc loin de sa cause.
//
// LE MÉCANISME, mesuré et non déduit :
//   `'envMap' in m` est vrai pour TOUS les matériaux de three, MeshBasicMaterial compris.
//   Sur un Basic, `combine` vaut MultiplyOperation par défaut : la couleur est MULTIPLIÉE
//   par l'environnement. Avec le ciel sombre de la scène par défaut (#14161a, environ 8 %
//   de gris), tout matériau « non éclairé » virait donc au noir.
//
// Ce test échoue si l'on rétablit la garde par présence de champ — vérifié par MUTATION,
// pas supposé.
//
// UN SECOND DÉFAUT AVAIT ÉTÉ SIGNALÉ, et il n'a pas de test ici : la garde d'idempotence
// comparait `envMapIntensity`, qui vaut `undefined` sur un Basic — elle échouait donc
// toujours et reposait `needsUpdate` à chaque appel. C'était réel. Mais une fois le
// premier défaut corrigé, seuls des matériaux PBR arrivent jusque-là, et Standard comme
// Physical définissent tous deux cette propriété (vérifié) : le cas est devenu
// INATTEIGNABLE. J'avais écrit un test pour lui ; il passait aussi bien avec le code
// fautif qu'avec le code corrigé. Je l'ai retiré — un test qui ne peut pas rougir ne
// teste rien, et en garder un donne l'illusion inverse.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { creerContexte, deEsm } from './engine-env.mjs';

const racineMoteur = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function contexteSondes(){
  const env = creerContexte([]);
  vm.runInContext(`
    var LAYER_HELPERS = 31;
    var scene = new THREE.Scene();
    var hemi = {intensity: 0, color: {set: function(){}}};
    var sun = {intensity: 0};
    var selection = null;
    var assets = [];
    var objects = [];
    var renderer = {__ready: true, isWebGPURenderer: true};
    function applyNodeMixin(o){ o.addComponent = function(){}; }
    function buildInspector(){}
    function setStatus(){}
    function ed(o){ if(!o.ed) o.ed = {}; return o.ed; }
    function listMats(x){
      return Array.isArray(x.material) ? x.material : (x.material ? [x.material] : []);
    }
  `, env);
  ['js/component-data.js', 'js/environment.js', 'js/probes.js'].forEach(function(f){
    vm.runInContext(deEsm(readFileSync(path.join(racineMoteur, f), 'utf8')), env, {filename: f});
  });
  return env;
}

test('un materiau non eclaire ne recoit JAMAIS d environnement', () => {
  const env = contexteSondes();
  const r = vm.runInContext(`(function(){
    const ciel = new THREE.Texture();
    const basic = new THREE.MeshBasicMaterial({color: 0xffffff});
    const standard = new THREE.MeshStandardMaterial({color: 0xffffff});
    setEnvironmentOn(basic, ciel, 1, null);
    setEnvironmentOn(standard, ciel, 1, null);
    return {
      champExisteSurBasic: 'envMap' in basic,
      combineBasic: basic.combine,
      multiply: THREE.MultiplyOperation,
      envBasic: basic.envMap === null,
      envStandard: standard.envMap === ciel
    };
  })()`, env);

  // Les deux faits qui rendaient le défaut inévitable. On les épingle pour que personne
  // ne « simplifie » la garde en revenant au test de présence de champ.
  assert.equal(r.champExisteSurBasic, true,
    'three expose envMap sur MeshBasicMaterial : la garde par présence ne pouvait pas protéger');
  assert.equal(r.combineBasic, r.multiply,
    'et il MULTIPLIE la couleur par l’environment : avec un ciel sombre, l’object vire au noir');

  assert.equal(r.envBasic, true,
    'un matériau non éclairé doit rester SANS environnement');
  assert.equal(r.envStandard, true,
    'un matériau PBR, lui, doit bien le recevoir — sinon on a corrigé en cassant la fonctionnalité');
});
