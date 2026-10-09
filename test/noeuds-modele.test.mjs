// moteur/test/noeuds-modele.test.mjs
//
// Les nœuds d'un modèle importé, objets de scène comme dans Unity (js/model-nodes.js, v0.159) :
// clés stables, exposition, overrides capturés PUIS reposés sur une instance neuve, entrée
// fantôme d'avant la v0.159, « Optimize Game Objects » et « Generate Colliders ».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte } from './engine-env.mjs';

const env = creerContexte(['js/model-nodes.js']);
const THREE = env.THREE;

/** Un petit personnage : Armature > Hips > (Spine > Head), un maillage, deux « Cube » homonymes. */
function template(){
  const root = new THREE.Group(); root.name = 'Perso';
  const arm = new THREE.Object3D(); arm.name = 'Armature';
  const hips = new THREE.Bone(); hips.name = 'Hips';
  const spine = new THREE.Bone(); spine.name = 'Spine'; spine.position.set(0, 1, 0);
  const head = new THREE.Bone(); head.name = 'Head'; head.position.set(0, 0.5, 0);
  hips.add(spine); spine.add(head); arm.add(hips);
  const body = new THREE.Mesh(new THREE.BoxGeometry()); body.name = 'Body';
  const c1 = new THREE.Mesh(new THREE.BoxGeometry()); c1.name = 'Cube';
  const c2 = new THREE.Mesh(new THREE.BoxGeometry()); c2.name = 'Cube';
  root.add(arm, body, c1, c2);
  return root;
}

const keys = (list) => list.map((e) => e.key).join(',');

test('chaque nœud a une clé : son nom, et un rang pour les homonymes', () => {
  assert.equal(keys(env.modelNodesOf(template())), 'Armature,Hips,Spine,Head,Body,Cube,Cube#2');
});

test('exposer pose la clé, un tableau de composants, et appelle le crochet sur chaque nœud', () => {
  const r = template().clone(true);
  const vus = [];
  const out = env.exposeModelNodes(r, {}, {node: (o) => vus.push(o.name)});
  assert.equal(out.length, 7);
  assert.equal(vus.length, 7);
  const head = env.modelNodeByKey(r, 'Head');
  assert.equal(head.name, 'Head');
  assert.ok(Array.isArray(head.userData.components));
  assert.equal(env.modelRootOf(head), r, 'on remonte jusqu’à la racine de l’instance');
});

test('un objet de l’utilisateur accroché sous un os n’est PAS un nœud du modèle', () => {
  const r = template().clone(true);
  const arme = new THREE.Group(); arme.name = 'Épée'; arme.userData.components = [{}];
  env.modelNodesOf(r).find((e) => e.key === 'Head').node.add(arme);
  const out = env.exposeModelNodes(r, {}, {skip: (c) => c.name === 'Épée'});
  assert.ok(!out.some((e) => e.node === arme));
  assert.equal(arme.userData.modelNode, undefined);
});

test('seul un nœud ÉDITÉ écrit sa transformée : une pose d’aperçu n’est pas un override', () => {
  const t = template();
  const r = t.clone(true);
  env.exposeModelNodes(r, {}, {});
  const head = env.modelNodeByKey(r, 'Head');
  head.position.set(9, 9, 9);                       // l'aperçu d'animation a bougé l'os
  assert.deepEqual(Object.keys(env.captureModelOverrides(r, t, () => []).overrides), []);
  env.markModelNodeEdited(head);                    // … puis l'utilisateur, au gizmo
  const cap = env.captureModelOverrides(r, t, () => []);
  assert.deepEqual(Object.keys(cap.overrides), ['Head']);
  assert.deepEqual(Array.from(cap.overrides.Head.pos), [9, 9, 9]);
  assert.equal(cap.ids.Head, head.id, 'l’identifiant de chaque nœud voyage, pour ce qui le cite');
});

test('les overrides capturés se reposent sur une instance NEUVE du même fichier', () => {
  const t = template();
  const a = t.clone(true);
  env.exposeModelNodes(a, {}, {});
  const spine = env.modelNodeByKey(a, 'Spine');
  spine.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.5);
  env.markModelNodeEdited(spine);
  env.modelNodeByKey(a, 'Cube#2').visible = false;
  const cap = JSON.parse(JSON.stringify(env.captureModelOverrides(a, t,
    (o) => o.name === 'Body' ? [{type: 'Collider', data: {shape: 'auto'}}] : [])));

  const b = t.clone(true);
  env.exposeModelNodes(b, {}, {});
  const poses = [];
  const n = env.applyModelOverrides(b, cap, (o, list) => poses.push(o.name + ':' + list[0].type));
  assert.equal(n, 3);
  const q = env.modelNodeByKey(b, 'Spine').quaternion;
  assert.ok(Math.abs(q.z - Math.sin(0.25)) < 1e-6);
  assert.equal(env.modelNodeByKey(b, 'Cube#2').visible, false);
  assert.equal(env.modelNodeByKey(b, 'Cube').visible, true, 'l’homonyme n’est pas touché');
  assert.deepEqual(poses, ['Body:Collider']);
});

test('au réimport, la référence des écarts est l’état du nœud à son exposition', () => {
  const r = template().clone(true);
  env.exposeModelNodes(r, {}, {});
  const head = env.modelNodeByKey(r, 'Head');
  env.markModelNodeEdited(head);
  const cap = env.captureModelOverrides(r, null, () => []);
  assert.deepEqual(Object.keys(cap.overrides), [], 'édité mais pas déplacé : aucun écart');
  head.position.x = 2;
  assert.deepEqual(Object.keys(env.captureModelOverrides(r, null, () => []).overrides), ['Head']);
});

test('un override dont le nœud a disparu du fichier est ignoré, jamais posé ailleurs', () => {
  const r = template().clone(true);
  env.exposeModelNodes(r, {}, {});
  assert.equal(env.applyModelOverrides(r, {overrides: {Disparu: {visible: false}}}), 0);
});

test('Optimize Game Objects : seuls les maillages et les transforms listés sont exposés', () => {
  const r = template().clone(true);
  const out = env.exposeModelNodes(r, {optimizeGameObjects: true, extraTransforms: ['Head']}, {});
  assert.equal(keys(out), 'Armature,Hips,Spine,Head,Body,Cube,Cube#2',
    'Head et ses ancêtres restent atteignables');
  const r2 = template().clone(true);
  assert.equal(keys(env.exposeModelNodes(r2, {optimizeGameObjects: true}, {})), 'Body,Cube,Cube#2');
});

test('Generate Colliders pose un collider ajusté sur chaque maillage, et sur eux seuls', () => {
  const r = template().clone(true);
  env.exposeModelNodes(r, {generateColliders: true}, {});
  assert.equal(env.modelNodeByKey(r, 'Body').userData.collider.shape, 'auto');
  assert.equal(env.modelNodeByKey(r, 'Hips').userData.collider, undefined);
});

test('l’entrée fantôme d’avant la v0.159 est reconnue, une instance d’aujourd’hui non', () => {
  assert.equal(env.isLegacySkinnedEntry({parent: 12, components: [{type: 'SkinnedMeshRenderer'}]}), true);
  assert.equal(env.isLegacySkinnedEntry({parent: null, components: [{type: 'SkinnedMeshRenderer'}]}), false);
  assert.equal(env.isLegacySkinnedEntry({parent: 12, components: [{type: 'Model'}]}), false);
});

test('un modèle rigué ou animé reçoit un Animator, un décor statique non, et « Aucune » jamais', () => {
  const rig = template();
  const skinned = new THREE.SkinnedMesh(new THREE.BoxGeometry());
  rig.add(skinned);
  assert.equal(env.wantsAnimator(rig, {}), true, 'un squelette : comme Unity');
  assert.equal(env.wantsAnimator(rig, {animationType: 'none'}), false, 'le Rig dit « Aucune »');
  const prop = template();
  assert.equal(env.wantsAnimator(prop, {}), false, 'un caillou du décor n’en a pas besoin');
  prop.animations = [new THREE.AnimationClip('Ouvrir', 1, [])];
  assert.equal(env.wantsAnimator(prop, {}), true, 'des clips : il peut s’animer');
});

test('un matériau posé sur un emplacement d’UNE instance voyage en override, et se repose', () => {
  const t = template();
  const a = t.clone(true);
  env.exposeModelNodes(a, {}, {});
  env.modelNodeByKey(a, 'Body').userData.materialSlots = ['m7'];
  const cap = JSON.parse(JSON.stringify(env.captureModelOverrides(a, t, () => [])));
  assert.deepEqual(cap.overrides.Body.materialSlots, ['m7']);
  assert.equal(cap.overrides.Cube, undefined, 'un emplacement non remplacé n’est pas un écart');
  const b = t.clone(true);
  env.exposeModelNodes(b, {}, {});
  const poses = [];
  env.applyModelOverrides(b, cap, null, (o) => poses.push(o.name + ':' + o.userData.materialSlots[0]));
  assert.deepEqual(poses, ['Body:m7']);
});
