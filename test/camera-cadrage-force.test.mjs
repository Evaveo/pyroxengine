import { deEsm } from './engine-env.mjs';
// Cadrage 2D imposé (BUGS_MOTEUR 4, 13, 24) : un `{mode:'fixed', ratio:2, ppu:24}` doit gagner
// contre `orthoSize`, que ce soit le resize ou le CameraSystem qui parle en dernier ; le frustum
// lu sur la caméra doit être celui rendu ; et le suivi doit se caler à 1/(ppu×ratio).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');

function context(){
  const box = {console, Math, JSON, Number, isFinite, Array, Object};
  box.window = box; box.self = box; box.globalThis = box;
  const ctx = vm.createContext(box);
  vm.runInContext(deEsm(read('js/camera-framing.js')), ctx, {filename: 'js/camera-framing.js'});
  return ctx;
}
const fakeCam = () => ({updates: 0, updateProjectionMatrix(){ this.updates++; }});

test('pixel-perfect : le cadrage imposé gagne contre orthoSize, à chaque appel', () => {
  const ctx = context();
  const comp = {pixelPerfect: true, mode: 'fixed', ratio: 2, ppu: 24, orthoSize: 5};
  const cam = fakeCam();
  for(let i = 0; i < 3; i++) ctx.frameOrthoCamera(cam, comp, 1920, 1080);
  assert.equal(cam.top, 1080 / (2 * 24) / 2);
  assert.equal(cam.right, 1920 / (2 * 24) / 2);
  assert.equal(comp._framing.ratio, 2);
  assert.equal(comp._framing.ppu, 24);
});

test('sans pixel-perfect : orthoSize et aspect, et un rapport réel pour le calage', () => {
  const ctx = context();
  const comp = {pixelPerfect: false, orthoSize: 5, ppu: 24};
  const cam = fakeCam();
  const c = ctx.frameOrthoCamera(cam, comp, 1600, 1000);
  assert.equal(cam.top, 5); assert.equal(cam.right, 8);
  assert.equal(c.ratio, 1000 / (10 * 24));
});

test('le CameraSystem, les deux resize et la commande passent par frameOrthoCamera', () => {
  assert.match(read('js/systems/camera-system.js'), /frameOrthoCamera\(cam\.objectThree, cam, w, h\)/);
  assert.match(read('js/game-runtime.js'), /return frameOrthoCamera\(cam, comp, w, h\)/);
  assert.match(read('js/viewport.js'), /frameOrthoCamera\(activeCam, comp, w, h\)/);
  // configure_camera_2d active le pixel-perfect dès qu'on règle le cadrage.
  assert.match(read('js/copilot-workshop.js'), /r\.pixelPerfect = true/);
});

test('suivi calé à 1/(ppu×ratio) avec le cadrage imposé', () => {
  const ctx = context();
  const comp = {pixelPerfect: true, mode: 'fixed', ratio: 2, ppu: 24};
  const framing = ctx.frameOrthoCamera(fakeCam(), comp, 1920, 1080);
  const node = {position: {x: 0, y: 0}};
  ctx.applyFollow(node, {targetName: 'p', snapPixel: true, topOfView: 0}, framing, {x: 3.01234, y: 1.98765});
  const step = 1 / 48;
  for(const v of [node.position.x, node.position.y]){
    assert.ok(Math.abs(v / step - Math.round(v / step)) < 1e-9, v + ' pas calé sur 1/48');
  }
});
