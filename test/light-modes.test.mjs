// moteur/test/light-modes.test.mjs
//
// LE MODE D'UNE LUMIÈRE (v1.7.0) — realtime / mixed / baked, le « Mode » d'une lumière Unity.
//
// Trois choses peuvent se tromper sans qu'aucune image ne paraisse fausse, et ce sont elles qui
// sont mesurées ici :
//   1. la table des rôles : quelle lampe est allumée pendant les passes DIRECTES de la cuisson,
//      laquelle pendant la CAPTURE du rebond. Une lampe cuite allumée dans la capture compte son
//      direct deux fois (une fois par elle, une fois par la lightmap qu'elle a déjà remplie) ;
//      une lampe mixte éteinte dans la capture ne rebondit jamais. Les deux donnent une image
//      crédible ;
//   2. une lampe cuite n'éclaire plus en temps réel — et ce, après relecture du projet, après
//      désactivation puis réactivation du composant ;
//   3. la cuisson rend chaque lampe EXACTEMENT dans son état d'avant (visible, intensité) : une
//      lampe cuite qu'elle laisserait visible éclairerait deux fois la scène qu'elle vient de cuire.
// La cuisson elle-même exige un GPU (voir lightmap-cuisson.test.mjs) : ce sont ses décisions qui
// sont testées, pas ses pixels.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { creerContexte } from './engine-env.mjs';

function contexte(){
  const ctx = creerContexte(['js/component-registry.js', 'js/component.js', 'js/node.js',
    'js/component-data.js', 'js/components/component-light.js', 'js/lightmap-bake.js']);
  vm.runInContext(`
    var _ed = new WeakMap();
    function ed(o){ if(!_ed.has(o)) _ed.set(o, {}); return _ed.get(o); }
    function removeHelper(){}
    // Le nœud d'une lumière est le MAILLAGE repère, comme dans l'éditeur (makeLight).
    function noeudLumiere(data){
      const n = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), new THREE.MeshStandardMaterial({}));
      n.userData.type = 'group';
      applyNodeMixin(n);
      n.addComponent('Light', data);
      return n;
    }
  `, ctx);
  return ctx;
}

test('le mode par défaut est mixed, et un mode inconnu y retombe', () => {
  const ctx = contexte();
  // Des `const` de haut niveau : lisibles dans le contexte, pas comme propriétés de l'objet global.
  assert.equal(vm.runInContext('LIGHT_DEFAULT.mode', ctx), 'mixed');
  assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(LIGHT_MODES)', ctx)), ['realtime', 'mixed', 'baked']);
  assert.equal(ctx.lightModeOf(null), 'mixed');
  assert.equal(ctx.lightModeOf({}), 'mixed');
  assert.equal(ctx.lightModeOf({mode: 'Baked'}), 'mixed');   // sensible à la casse : un fichier faux ne devient pas « cuit »
  assert.equal(ctx.lightModeOf({mode: 'baked'}), 'baked');
});

test('la table des rôles pendant la cuisson', () => {
  const ctx = contexte();
  const role = (m, p) => ctx.bakeLightRole(m, p);
  // Les passes directes : seules les lampes cuites.
  assert.equal(role('baked', 'direct'), true);
  assert.equal(role('mixed', 'direct'), false);
  assert.equal(role('realtime', 'direct'), false);
  // La capture du rebond : seules les lampes mixtes (le direct des cuites est déjà dans la map).
  assert.equal(role('baked', 'bounce'), false);
  assert.equal(role('mixed', 'bounce'), true);
  assert.equal(role('realtime', 'bounce'), false);
  // 'none' (la capture du premier tour) : tout éteint.
  for(const m of ['baked', 'mixed', 'realtime']) assert.equal(role(m, 'none'), false);
  // Seule une lampe cuite cesse d'éclairer en temps réel.
  assert.equal(ctx.litInRealtime('baked'), false);
  assert.equal(ctx.litInRealtime('mixed'), true);
  assert.equal(ctx.litInRealtime('realtime'), true);
  assert.equal(ctx.litInRealtime(undefined), true);
});

test('une lampe cuite est éteinte en temps réel, y compris après relecture et réactivation', () => {
  const ctx = contexte();
  vm.runInContext(`
    const a = noeudLumiere({subType: 'spot', intensity: 40, mode: 'baked'});
    const ca = a.getComponent('Light');
    const relu = noeudLumiere(ca.serialize());
    const cr = relu.getComponent('Light');
    const etats = {cuiteVisible: ca.objectThree.visible, serialise: ca.serialize().mode,
      reluVisible: cr.objectThree.visible, reluMode: cr.mode};
    // Désactiver puis réactiver ne doit pas la rallumer.
    cr.active = false; cr.onActiveChange(false);
    cr.active = true; cr.onActiveChange(true);
    etats.apresReactivation = cr.objectThree.visible;
    // Passer en mixte la rallume aussitôt, sans rien rappeler.
    cr.mode = 'mixed';
    etats.mixteVisible = cr.objectThree.visible;
    // Un composant désactivé reste éteint quel que soit son mode.
    cr.active = false; cr.onActiveChange(false);
    etats.mixteInactive = cr.objectThree.visible;
    // Une lampe d'avant v1.7.0 (aucun mode écrit) éclaire comme avant.
    const ancienne = noeudLumiere({subType: 'point', intensity: 2});
    etats.ancienneVisible = ancienne.getComponent('Light').objectThree.visible;
    this.etats = etats;
  `, ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.etats)), {
    cuiteVisible: false, serialise: 'baked', reluVisible: false, reluMode: 'baked',
    apresReactivation: false, mixteVisible: true, mixteInactive: false, ancienneVisible: true
  });
});

test('la cuisson allume chaque lampe selon la phase, puis rend son état exact', () => {
  const ctx = contexte();
  vm.runInContext(`
    const scene = new THREE.Scene();
    const cuite = noeudLumiere({subType: 'spot', intensity: 40, mode: 'baked'});
    const mixte = noeudLumiere({subType: 'spot', intensity: 50, mode: 'mixed'});
    const tempsReel = noeudLumiere({subType: 'point', intensity: 3, mode: 'realtime'});
    const coupee = noeudLumiere({subType: 'point', intensity: 7, mode: 'baked'});
    const cc = coupee.getComponent('Light'); cc.active = false; cc.onActiveChange(false);
    [cuite, mixte, tempsReel, coupee].forEach((n) => scene.add(n));
    const L = (n) => n.getComponent('Light').objectThree;
    const photo = () => [cuite, mixte, tempsReel, coupee].map((n) => [L(n).visible, L(n).intensity]);
    const avant = photo();
    const etat = bakeLightsState(scene);
    setBakePhase(etat, 'direct');  const direct = photo();
    setBakePhase(etat, 'bounce');  const rebond = photo();
    setBakePhase(etat, 'none');    const aucune = photo();
    restoreBakeLights(etat);       const apres = photo();
    this.r = {avant, direct, rebond, aucune, apres};
  `, ctx);
  const r = JSON.parse(JSON.stringify(ctx.r));
  // [visible, intensité] de : cuite, mixte, temps réel, cuite au composant désactivé.
  assert.deepEqual(r.avant, [[false, 40], [true, 50], [true, 3], [false, 7]]);
  // Une lampe cuite est RALLUMÉE pour la passe directe (elle était éteinte en temps réel).
  assert.deepEqual(r.direct, [[true, 40], [true, 0], [true, 0], [false, 0]]);
  assert.deepEqual(r.rebond, [[true, 0], [true, 50], [true, 0], [false, 0]]);
  assert.deepEqual(r.aucune, [[true, 0], [true, 0], [true, 0], [false, 0]]);
  // Et rendue éteinte : sinon elle éclairerait deux fois la scène qu'elle vient de cuire.
  assert.deepEqual(r.apres, r.avant);
});
