// LA SONDE DE PERFORMANCE DE play_and_measure (js/frame-probe.js, v1.14.0).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatFrameReport, installFrameProbe, summarizeFrames } from '../js/frame-probe.js';

test('le resume des durees d image : moyenne, mediane, 95 %, pire', () => {
  const d = Array(95).fill(10).concat(Array(5).fill(40));
  const s = summarizeFrames(d);
  assert.equal(s.frames, 100);
  assert.equal(s.avgMs, 11.5);
  assert.equal(s.p50Ms, 10);
  assert.equal(s.p95Ms, 40);
  assert.equal(s.worstMs, 40);
  assert.equal(s.fps, 87);
  assert.equal(summarizeFrames([]), null);
});

function fausseFenetre(){
  let t = 0; const cbs = [];
  return { performance: { now: () => t }, requestAnimationFrame: (f) => cbs.push(f),
    avance(ms){ t += ms; const f = cbs.shift(); if(f) f(); }, temps: (ms) => { t += ms; } };
}
function fauxRenderer(win){
  const info = { render: { drawCalls: 0, triangles: 0 } };
  return { info, shadowMap: { enabled: true }, domElement: { width: 800, height: 600 },
    getPixelRatio: () => 1.5,
    // autoReset : chaque rendu repart de zéro, comme WebGPURenderer
    render(){ info.render.drawCalls = 50; info.render.triangles = 1000; win.temps(2); } };
}

test('la sonde compte images, rendus, appels de dessin et temps processeur, puis se retire', () => {
  const win = fausseFenetre(); const r = fauxRenderer(win); const original = r.render;
  const p = installFrameProbe(win, r, {});
  win.avance(0);
  for(let i = 0; i < 10; i++){ r.render(); r.render(); win.avance(14); }
  const rep = p.stop();
  assert.equal(r.render, original, 'la sonde rend le renderer intact');
  assert.equal(rep.frames, 10);
  assert.equal(rep.avgMs, 18);          // 14 ms + 2 × 2 ms de rendu
  assert.equal(rep.rendersPerFrame, 2);
  assert.equal(rep.drawCalls, 100);
  assert.equal(rep.renderCpuMs, 4);
  assert.deepEqual(rep.canvas, [800, 600]);
  assert.match(formatFrameReport(rep), /i\/s en moyenne/);
});

test('shadows:false coupe les ombres le temps de la mesure et le dit', () => {
  const win = fausseFenetre(); const r = fauxRenderer(win);
  const p = installFrameProbe(win, r, {shadows: false});
  assert.equal(r.shadowMap.enabled, false);
  win.avance(0); win.avance(10); win.avance(10);
  assert.match(formatFrameReport(p.stop()), /OMBRES COUPÉES/);
});
