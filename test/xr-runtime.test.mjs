// moteur/test/xr-runtime.test.mjs
//
// Le WebXR sans casque : les trois composants (js/components/component-xr.js) et la logique
// de js/xr-runtime.js — détection du projet, api inerte, téléportation, rotation par cran,
// saisie. Le rendu stéréo et `navigator.xr` ne sont PAS mesurables ici (pas de navigateur,
// voir CLAUDE.md) : le renderer est un double qui rend des Group three ordinaires pour les
// manettes, exactement ce que fait XRManager, et on pilote leurs poses à la main.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { creerContexte } from './engine-env.mjs';

function contexte(){
  const ctx = creerContexte(['js/component-registry.js', 'js/component.js', 'js/node.js',
    'js/component-data.js', 'js/components/component-xr.js', 'js/xr-runtime.js']);
  return ctx;
}

// Les valeurs rendues par le contexte vm ont les prototypes d'un AUTRE royaume : deepStrictEqual
// les refuserait. Le passage par JSON les ramène ici (et ne garde que de la donnée).
const run = (ctx, code) => {
  const v = vm.runInContext(code, ctx);
  return v === undefined ? v : JSON.parse(JSON.stringify(v));
};

test('les composants XR fusionnent les données reçues avec les défauts et sérialisent détaché', () => {
  const ctx = contexte();
  const r = run(ctx, `
    const n = new THREE.Group(); applyNodeMixin(n);
    const c = n.addComponent('XROrigin', {moveSpeed: 2});
    const s = c.serialize(); s.moveSpeed = 99;
    ({bag: n.userData.xrOrigin, s: c.serialize()});
  `);
  assert.equal(r.bag.moveSpeed, 2, 'la donnée reçue par addComponent doit survivre');
  assert.equal(r.bag.sessionMode, 'immersive-vr');
  assert.equal(r.bag.referenceSpace, 'local-floor');
  assert.equal(r.bag.snapTurn, 45);
  assert.equal(r.s.moveSpeed, 2, 'serialize() doit rendre une copie détachée');
});

test('hydrate relit les champs de XRGrabbable et XRTeleportArea', () => {
  const ctx = contexte();
  const r = run(ctx, `
    const n = new THREE.Group(); applyNodeMixin(n);
    const g = n.addComponent('XRGrabbable', {});
    g.hydrate({radius: 0.3, throwable: false});
    const m = new THREE.Group(); applyNodeMixin(m);
    const t = m.addComponent('XRTeleportArea', {});
    t.hydrate({maxSlope: 10});
    ({g: n.userData.xrGrabbable, t: m.userData.xrTeleportArea});
  `);
  assert.equal(r.g.radius, 0.3);
  assert.equal(r.g.throwable, false);
  assert.equal(r.g.keepOffset, true);
  assert.equal(r.t.maxSlope, 10);
});

test('projectUsesXr ne répond oui que si une scène porte un XROrigin', () => {
  const ctx = contexte();
  const r = run(ctx, `[
    projectUsesXr({scenes: [{data: {objects: [{components: [{type: 'Camera'}]}]}}]}),
    projectUsesXr({scenes: [{objects: []}, {data: {objects: [{components: [{type: 'XROrigin'}]}]}}]}),
    projectUsesXr(null)
  ]`);
  assert.deepEqual(r, [false, true, false]);
});

test('non installé (éditeur), api.xr répond « pas de casque » sans lever', () => {
  const ctx = contexte();
  const r = run(ctx, `({p: XRRuntime.api.presenting(), c: XRRuntime.api.controller('left').connected,
    b: XRRuntime.api.button('right', 'trigger'), h: XRRuntime.api.held('left'),
    v: XRRuntime.api.haptic('left', 1, 10)})`);
  assert.deepEqual(r, {p: false, c: false, b: false, h: null, v: false});
});

test('la téléportation amène la TÊTE, pas l’origine, sur le point visé', () => {
  const ctx = contexte();
  const p = run(ctx, `teleportOrigin({x: 1, y: 0, z: 1}, {x: 1.5, y: 1.6, z: 0.5}, {x: 4, y: 0.2, z: -3})`);
  assert.deepEqual(p, {x: 3.5, y: 0.2, z: -2.5});
});

test('la rotation par cran tourne autour de la tête, dans le sens de rotation.y', () => {
  const ctx = contexte();
  const r = run(ctx, `
    const head = {x: 1, z: 0};
    const np = rotateOriginAroundHead({x: 0, z: 0}, head, Math.PI / 2);
    // Référence : le même point tourné par three autour de la tête.
    const v = new THREE.Vector3(-1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    ({np, ref: {x: head.x + v.x, z: head.z + v.z}});
  `);
  assert.ok(Math.abs(r.np.x - r.ref.x) < 1e-9 && Math.abs(r.np.z - r.ref.z) < 1e-9, JSON.stringify(r));
});

test('edgeTrigger ne déclenche qu’une fois tant que le stick reste poussé', () => {
  const ctx = contexte();
  const r = run(ctx, `const s = {}; [0.8, 0.9, 0.5, 0.2, 0.8].map(v => edgeTrigger(s, 'k', v, 0.7, 0.3))`);
  assert.deepEqual(r, [true, false, false, false, true]);
});

test('stickOf lit les axes 2/3 en xr-standard, 0/1 sinon', () => {
  const ctx = contexte();
  const r = run(ctx, `[stickOf({axes: [0, 0, 0.5, -1]}), stickOf({axes: [0.2, 0.3]}), stickOf(null)]`);
  assert.deepEqual(r, [{x: 0.5, y: -1}, {x: 0.2, y: 0.3}, {x: 0, y: 0}]);
});

// ---------- session simulée ----------
// Un double de renderer : `xr` rend des Group (comme XRManager), `isPresenting` se bascule.
function sessionSimulee(){
  const ctx = contexte();
  run(ctx, `
    var scene = new THREE.Scene();
    function node(name, obj){ const n = obj || new THREE.Group(); n.name = name; applyNodeMixin(n); scene.add(n); addSceneObject(n); return n; }
    var origin = node('XR Origin'); origin.addComponent('XROrigin', {});
    var camNode = node('Cam'); origin.add(camNode); camNode.position.set(0, 1.6, 0);
    var cam = new THREE.PerspectiveCamera(); camNode.add(cam);
    var floor = node('Sol', new THREE.Mesh(new THREE.PlaneGeometry(20, 20).rotateX(-Math.PI / 2),
                                           new THREE.MeshBasicMaterial()));
    floor.addComponent('XRTeleportArea', {});
    var cube = node('Cube', new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshBasicMaterial()));
    cube.position.set(0.3, 1, -0.3);
    cube.addComponent('XRGrabbable', {});
    scene.updateMatrixWorld(true);

    var ctrls = [new THREE.Group(), new THREE.Group()], grips = [new THREE.Group(), new THREE.Group()];
    var xrCam = new THREE.PerspectiveCamera();
    var fakeRenderer = { xr: { enabled: false, isPresenting: false,
      getController: (i) => ctrls[i], getControllerGrip: (i) => grips[i], getCamera: () => xrCam } };
    var grabs = [];
    XRRuntime.install(fakeRenderer, {
      scene: () => scene, camera: () => cam, setCamera: () => {}, uiRoot: () => null,
      grabBody: (o, on, v) => grabs.push({name: o.name, on, v: v ? v.toArray() : null}),
      syncBody: () => {}
    });
    XRRuntime.sceneChanged();
    fakeRenderer.xr.isPresenting = true;
    var pads = [{buttons: [], axes: [0, 0, 0, 0]}, {buttons: [], axes: [0, 0, 0, 0]}];
    for(let i = 0; i < 6; i++) pads.forEach(p => p.buttons.push({pressed: false, value: 0}));
    ctrls[0].dispatchEvent({type: 'connected', data: {handedness: 'left', gamepad: pads[0]}});
    ctrls[1].dispatchEvent({type: 'connected', data: {handedness: 'right', gamepad: pads[1]}});
    // La tête à 1,6 m au-dessus du sol, décalée de 0,5 m en x dans l'espace de jeu.
    function setHead(x, y, z){ xrCam.position.set(x, y, z); xrCam.updateMatrixWorld(true); }
    setHead(0.5, 1.6, 0);
  `);
  return ctx;
}

test('en session, les manettes sont accrochées à l’origine et répondent via api.xr', () => {
  const ctx = sessionSimulee();
  const r = run(ctx, `
    grips[1].position.set(0.2, 1.2, -0.3);
    pads[1].buttons[0] = {pressed: true, value: 0.9};
    XRRuntime.update(1 / 60);
    const c = XRRuntime.api.controller('right');
    ({parent: ctrls[1].parent === origin, gripParent: grips[1].parent === origin,
      connected: c.connected, trigger: c.trigger, y: c.position.y,
      held: XRRuntime.api.button('right', 'trigger'), pressed: XRRuntime.api.buttonPressed('right', 'trigger')});
  `);
  assert.deepEqual(r, {parent: true, gripParent: true, connected: true, trigger: 0.9, y: 1.2,
                       held: true, pressed: true});
  const again = run(ctx, `XRRuntime.update(1 / 60); XRRuntime.api.buttonPressed('right', 'trigger')`);
  assert.equal(again, false, 'buttonPressed ne vaut qu’à l’image où le bouton s’enfonce');
});

test('stick droit en avant puis relâché : l’origine se téléporte sous le point visé', () => {
  const ctx = sessionSimulee();
  const r = run(ctx, `
    // La manette droite, à hauteur de hanche, vise vers l'avant et un peu vers le bas.
    ctrls[1].position.set(0.5, 1.2, 0);
    ctrls[1].rotation.set(-0.35, 0, 0);
    pads[1].axes[3] = -1;
    XRRuntime.update(1 / 60);
    const marker = scene.getObjectByName('xr-teleport-marker');
    const aimed = {visible: marker.visible, x: marker.position.x, z: marker.position.z};
    pads[1].axes[3] = 0;
    XRRuntime.update(1 / 60);
    ({aimed, origin: origin.position.toArray(), markerAfter: marker.visible});
  `);
  assert.equal(r.aimed.visible, true, 'le sol XRTeleportArea doit être visé');
  assert.ok(r.aimed.z < -1, 'le point visé doit être devant le joueur : ' + r.aimed.z);
  // La tête était en x = 0,5 dans l'espace de jeu : l'origine arrive 0,5 m à gauche du point.
  assert.ok(Math.abs(r.origin[0] - (r.aimed.x - 0.5)) < 1e-6, 'x origine : ' + r.origin[0]);
  assert.ok(Math.abs(r.origin[1]) < 1e-6, 'y origine = hauteur du sol : ' + r.origin[1]);
  assert.ok(Math.abs(r.origin[2] - r.aimed.z) < 1e-6, 'z origine : ' + r.origin[2]);
  assert.equal(r.markerAfter, false);
});

test('une surface trop pentue est refusée', () => {
  const ctx = sessionSimulee();
  const r = run(ctx, `
    floor.rotation.x = 0.9; scene.updateMatrixWorld(true);
    ctrls[1].position.set(0.5, 1.2, 0); ctrls[1].rotation.set(-0.35, 0, 0);
    pads[1].axes[3] = -1; XRRuntime.update(1 / 60);
    pads[1].axes[3] = 0; XRRuntime.update(1 / 60);
    origin.position.toArray();
  `);
  assert.deepEqual(r, [0, 0, 0], 'l’origine ne doit pas bouger');
});

test('rotation par cran : 45° par poussée, pas une par image', () => {
  const ctx = sessionSimulee();
  const r = run(ctx, `
    pads[1].axes[2] = 1;
    for(let i = 0; i < 10; i++) XRRuntime.update(1 / 60);
    origin.rotation.y;
  `);
  assert.ok(Math.abs(r + Math.PI / 4) < 1e-9, 'stick à droite = -45° : ' + r);
});

test('saisie : la gâchette latérale près d’un XRGrabbable le tient, le relâcher le lance', () => {
  const ctx = sessionSimulee();
  const r = run(ctx, `
    grips[1].position.set(0.3, 1, -0.3);
    XRRuntime.update(1 / 60);
    pads[1].buttons[1] = {pressed: true, value: 1};
    XRRuntime.update(1 / 60);
    const tenu = XRRuntime.api.held('right') === cube;
    grips[1].position.set(0.3, 1.1, -0.3);
    XRRuntime.update(1 / 60);
    const suivi = cube.position.y;
    pads[1].buttons[1] = {pressed: false, value: 0};
    XRRuntime.update(1 / 60);
    ({tenu, suivi, lache: XRRuntime.api.held('right'), grabs});
  `);
  assert.equal(r.tenu, true);
  assert.ok(Math.abs(r.suivi - 1.1) < 1e-6, 'l’objet suit la main : ' + r.suivi);
  assert.equal(r.lache, null);
  assert.equal(r.grabs.length, 2);
  assert.equal(r.grabs[0].on, true);
  assert.equal(r.grabs[1].on, false);
  assert.ok(r.grabs[1].v && r.grabs[1].v[1] > 0, 'le lâcher emporte la vitesse de la main');
});

test('un sol REGROUPÉ en lot instancié (visible = false) reste une cible de téléportation', () => {
  const ctx = sessionSimulee();
  const r = run(ctx, `
    // Ce que fait render-perf.js à une source regroupée : masquée, mais bien à l'écran.
    floor.visible = false; floor.userData.inInstanceBatch = true;
    cube.visible = false; cube.userData.inInstanceBatch = true;
    ctrls[1].position.set(0.5, 1.2, 0); ctrls[1].rotation.set(-0.35, 0, 0);
    pads[1].axes[3] = -1; XRRuntime.update(1 / 60);
    const vise = scene.getObjectByName('xr-teleport-marker').visible;
    pads[1].axes[3] = 0; XRRuntime.update(1 / 60);
    const z = origin.position.z;
    // La saisie, origine ramenée d'abord : les manettes en sont les enfants.
    origin.position.set(0, 0, 0); origin.updateMatrixWorld(true);
    grips[1].position.set(0.3, 1, -0.3); XRRuntime.update(1 / 60);
    pads[1].buttons[1] = {pressed: true, value: 1}; XRRuntime.update(1 / 60);
    ({vise, tenu: XRRuntime.api.held('right') === cube, z});
  `);
  assert.equal(r.vise, true, 'le sol regroupé doit être visé');
  assert.ok(r.z < -1, 'la téléportation doit avoir eu lieu : ' + r.z);
  assert.equal(r.tenu, true, 'un cube regroupé doit rester saisissable');
});

test('un objet masqué par api.setActive(false) n’est ni visé ni saisi', () => {
  const ctx = sessionSimulee();
  const r = run(ctx, `
    floor.userData.activeVoulu = false; floor.visible = false;
    ctrls[1].position.set(0.5, 1.2, 0); ctrls[1].rotation.set(-0.35, 0, 0);
    pads[1].axes[3] = -1; XRRuntime.update(1 / 60);
    scene.getObjectByName('xr-teleport-marker').visible;
  `);
  assert.equal(r, false);
});
