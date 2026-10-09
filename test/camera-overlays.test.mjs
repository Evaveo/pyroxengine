// Les caméras en incrustation (js/camera-overlays.js) : une mini-carte est une caméra de la scène.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeViewport, viewportPixels, renderCameraOverlays } from '../js/camera-overlays.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');

test('LE RECTANGLE est borné à l\'écran, et un rectangle vide vaut « pas d\'incrustation »', () => {
  const b = normalizeViewport({x: 0.8, y: 0, w: 0.5, h: 0.3});
  assert.ok(Math.abs(b.w - 0.2) < 1e-9 && b.h === 0.3 && b.x === 0.8, JSON.stringify(b));
  assert.equal(normalizeViewport({x: 0, y: 0, w: 0, h: 0.5}), null);
  assert.equal(normalizeViewport(null), null);
  assert.deepEqual(viewportPixels({x: 0.5, y: 0.25, w: 0.25, h: 0.5}, 800, 600), {x: 400, y: 150, w: 200, h: 300});
});

function fakeRenderer(W, H){
  const log = [];
  return {log, domElement: {width: W * 2, height: H * 2}, getPixelRatio: () => 2, setViewport(...a){ log.push(['vp', ...a]); },
    setScissor(){}, setScissorTest(b){ log.push(['sc', b]); }, render(s, c){ log.push(['render', c.id]); }};
}
function camNode(id, viewport, ortho){
  const cam = ortho ? {id, isOrthographicCamera: true, top: 0, updateProjectionMatrix(){}}
                    : {id, isPerspectiveCamera: true, aspect: 1, updateProjectionMatrix(){}};
  return {userData: {cam}, getComponent: () => ({data: {viewport, orthoSize: 20}})};
}

test('SEULES les caméras incrustées sont rendues, jamais la principale, et l\'état est rendu', () => {
  const r = fakeRenderer(1000, 500);
  const main = camNode('main', {x: 0, y: 0, w: 0.3, h: 0.3});
  const mini = camNode('mini', {x: 0.8, y: 0, w: 0.2, h: 0.4}, true);
  const plain = camNode('plain', null);
  const n = renderCameraOverlays(r, {}, main.userData.cam, [main, mini, plain]);
  assert.equal(n, 1);
  assert.deepEqual(r.log.filter((x) => x[0] === 'render'), [['render', 'mini']]);
  assert.deepEqual(r.log.at(-1), ['vp', 0, 0, 1000, 500], 'le viewport plein écran doit être rétabli');
  assert.equal(mini.userData.cam.top, 20);
  assert.equal(mini.userData.cam.right, 20 * (200 / 200));
});

test('LE JEU PUBLIÉ appelle les incrustations après son rendu, et configure_camera les règle', () => {
  assert.match(read('js/game-runtime.js'), /renderCameraOverlays\(renderer, game\.scene, game\.cam, Registry\.activeNodes\('Camera'\)\)/);
  assert.match(read('js/copilot.js'), /viewport: \{type: \['object', 'null'\]/);
});
