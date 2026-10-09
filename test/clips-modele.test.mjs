// moteur/test/clips-modele.test.mjs
//
// Les clips d'un modèle, sous-assets de son importeur (onglet Animation, v0.159) : réglages par
// clip (miroir, Loop Pose, masque, offsets de la racine), exposition en asset `animation`,
// cuisson du clip dérivé et réduction de clés (js/anim-asset.js, js/anim-blend.js,
// js/model-import.js — tous trois partagés avec le runtime).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte } from './engine-env.mjs';

const env = creerContexte(['js/anim-asset.js', 'js/animator.js', 'js/anim-blend.js',
                           'js/model-import.js']);
const THREE = env.THREE;
const nu = (o) => JSON.parse(JSON.stringify(o));

function piste(name, times, values){
  return {name: name, times: Float32Array.from(times), values: Float32Array.from(values)};
}

test('le miroir passe chaque piste à l’os symétrique et réfléchit sa valeur', () => {
  const t = [piste('mixamorigLeftArm.quaternion', [0, 1], [0.1, 0.2, 0.3, 0.927, 0.1, 0.2, 0.3, 0.927]),
             piste('Hips.position', [0, 1], [1, 2, 3, 1, 2, 3])];
  const out = env.processClipTracks(t, {mirror: true}, null);
  assert.equal(out[0].name, 'mixamorigRightArm.quaternion');
  assert.deepEqual(Array.from(out[0].values.slice(0, 4)).map(v => +v.toFixed(3)), [0.1, -0.2, -0.3, 0.927]);
  assert.equal(out[1].name, 'Hips.position', 'un os sans symétrique garde son nom');
  assert.equal(out[1].values[0], -1);
});

test('les conventions de nommage symétrique sont reconnues', () => {
  assert.equal(env.mirrorBoneName('upperarm.L'), 'upperarm.R');
  assert.equal(env.mirrorBoneName('hand_r'), 'hand_l');
  assert.equal(env.mirrorBoneName('L_Foot'), 'R_Foot');
  assert.equal(env.mirrorBoneName('Spine'), null);
});

test('Loop Pose fait rejoindre la dernière image à la première', () => {
  const t = [piste('Hips.position', [0, 0.5, 1], [0, 1, 0,  1, 1, 0,  2, 1, 0])];
  env.processClipTracks(t, {loopPose: true}, null);
  const v = t[0].values;
  assert.ok(Math.abs(v[6] - v[0]) < 1e-6, 'x de fin = x de début');
  assert.ok(Math.abs(v[3] - 0) < 1e-6, 'l’écart est réparti linéairement');
});

test('Loop Pose sur une rotation rend un quaternion unitaire, et referme la boucle', () => {
  const q0 = new THREE.Quaternion(), q1 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.2);
  const t = [piste('Hips.quaternion', [0, 1], [...q0.toArray(), ...q1.toArray()])];
  env.processClipTracks(t, {loopPose: true}, null);
  const v = t[0].values;
  assert.ok(Math.abs(Math.hypot(v[4], v[5], v[6], v[7]) - 1) < 1e-6);
  for(let c = 0; c < 4; c++) assert.ok(Math.abs(v[4 + c] - v[c]) < 1e-6);
});

test('le masque ne garde que les os choisis', () => {
  const t = [piste('Hips.position', [0], [0, 0, 0]), piste('Head.quaternion', [0], [0, 0, 0, 1])];
  const out = env.processClipTracks(t, {maskBones: ['Head']}, null);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, 'Head.quaternion');
});

test('les offsets de la racine décalent la hauteur et tournent autour de Y', () => {
  const t = [piste('Hips.position', [0], [0, 1, 0]), piste('Hips.quaternion', [0], [0, 0, 0, 1])];
  env.processClipTracks(t, {rootYOffset: 0.5, rootRotationOffset: 90}, 'Hips');
  assert.equal(t[0].values[1], 1.5);
  const q = new THREE.Quaternion().fromArray(Array.from(t[1].values));
  const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
  assert.ok(Math.abs(e.y - Math.PI / 2) < 1e-5);
});

test('sans liste de clips, le modèle expose un clip par prise ; une liste présente fait foi', () => {
  let n = 0;
  const mk = () => 'c' + (++n);
  const takes = [{name: 'Walk'}, {name: 'Run'}];
  assert.equal(env.clipsOfModelParams({}, takes, mk).length, 2);
  assert.equal(env.clipsOfModelParams({clips: []}, takes, mk).length, 0, 'une liste vide est un choix');
  assert.equal(env.clipsOfModelParams({importAnimation: false}, takes, mk).length, 0);
});

test('un clip est exposé comme un asset animation ordinaire, qui garde son id', () => {
  const a = env.clipAssetOfModel('a3', {id: 'a9', name: 'Marche', take: 'Walk', loopPose: true}, 'Persos');
  assert.equal(a.id, 'a9');
  assert.equal(a.kind, 'animation');
  assert.equal(a.embedded, 'a3');
  assert.deepEqual(nu(a.source), {type: 'model', asset: 'a3', clip: 'Walk'});
  assert.equal(a.loopPose, true);
  assert.equal(a.folder, 'Persos');
});

test('la résolution porte les réglages du clip et le nœud racine du rig source', () => {
  const model = {id: 'a3', kind: 'model', paramsImport: {rootNode: 'Hips'}};
  const clip = env.clipAssetOfModel('a3', {id: 'a9', name: 'M', take: 'Walk', mirror: true, cycleOffset: 1.25});
  const r = env.resolveAnimAsset(clip, (id) => id === 'a3' ? model : null);
  assert.equal(r.rootNode, 'Hips');
  assert.equal(r.mirror, true);
  assert.equal(r.cycleOffset, 0.25, 'ramené dans [0, 1[');
  assert.equal(env.clipNeedsProcessing(r), true);
});

test('un asset autonome d’avant garde exactement ce qu’il jouait', () => {
  const model = {id: 'a3', kind: 'model'};
  const r = env.resolveAnimAsset({id: 'a5', kind: 'animation', source: {asset: 'a3', clip: 'Walk'}},
    (id) => id === 'a3' ? model : null);
  assert.equal(env.clipNeedsProcessing(r), false, 'aucun clip dérivé à cuire');
  assert.equal(r.rootNode, null);
});

test('le clip dérivé ENTIER garde sa dernière clé, et porte ce que le root motion peut sortir', () => {
  const base = new THREE.AnimationClip('Walk', 1, [
    new THREE.VectorKeyframeTrack('Hips.position', [0, 0.5, 1], [0, 1, 0, 1, 1, 0, 2, 1, 0])]);
  const r = {start: 0, end: null, rootNode: 'Hips', rootXZBake: false, rootYBake: true,
             rootRotationBake: true, loopPose: false};
  const c = env.deriveClip(base, 'Walk⟨a9⟩', {start: 0, end: 1}, r);
  assert.equal(c.tracks[0].times.length, 3, 'la clé de fin est toujours là');
  assert.deepEqual(nu(c.rootMotionInfo), {rootNode: 'Hips', xz: true, y: false, yaw: false});
  assert.equal(base.tracks[0].values[6], 2, 'la prise du fichier n’est jamais modifiée');
});

test('la réduction de clés retire les clés redondantes et garde celles qui comptent', () => {
  const times = [0, 1, 2, 3, 4], lin = [0, 1, 2, 3, 4];
  const r = env.reduceTrackKeys(Float32Array.from(times), Float32Array.from(lin), 1, 0.01, false);
  assert.equal(r.times.length, 2, 'une droite se résume à ses deux bouts');
  const bosse = [0, 0, 1, 0, 0];
  const r2 = env.reduceTrackKeys(Float32Array.from(times), Float32Array.from(bosse), 1, 0.01, false);
  assert.ok(Array.from(r2.times).includes(2), 'le sommet de la bosse reste');
});

test('Import Animation décoché : le modèle n’expose plus aucun clip', () => {
  const clip = new THREE.AnimationClip('Walk', 1, []);
  assert.equal(env.applyAnimationImport([clip], {importAnimation: false}).length, 0);
  const same = [clip];
  assert.equal(env.applyAnimationImport(same, {}), same, 'sans compression, les prises passent telles quelles');
});
