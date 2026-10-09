// moteur/test/synth-touch.test.mjs
// Synthé temps réel (js/synth.js) et commandes tactiles (js/touch-input.js) : la partie PURE,
// plus le branchement Web Audio contre un faux AudioContext.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeVoice, normalizeSynth, envelopePoints, playVoice, playSequence, voiceOf, makeSynthApi } from '../js/synth.js';
import { joystickVector, normalizeTouchControls, combineAxis, touchState } from '../js/touch-input.js';

function fakeCtx(){
  const log = {osc: 0, started: 0, ramps: []};
  const param = () => ({ value: 0, setValueAtTime(){}, linearRampToValueAtTime(v, t){ log.ramps.push([t, v]); }, exponentialRampToValueAtTime(){ log.glides = (log.glides || 0) + 1; },
    cancelScheduledValues(){} });
  return {
    log, currentTime: 10, destination: {}, state: 'running',
    createGain(){ return {gain: param(), connect(){}}; },
    createOscillator(){ log.osc++; return {type: '', frequency: param(), detune: param(), connect(){},
      start(){ log.started++; }, stop(){}}; }
  };
}

test('une voix éditée de travers retombe sur des valeurs jouables', () => {
  const v = normalizeVoice({id: ' do ', wave: 'banjo', frequency: 'abc', gain: 99, meta: {color: '#f00'}});
  assert.equal(v.id, 'do');
  assert.equal(v.wave, 'triangle');
  assert.equal(v.frequency, 440);
  assert.equal(v.gain, 2);
  assert.deepEqual(v.meta, {color: '#f00'});
  assert.equal(normalizeVoice({}, 2).id, 'note3');
});

test('l enveloppe part et finit à zéro, et se comprime si la note est courte', () => {
  const p = envelopePoints({duration: 0.1, attack: 0.1, decay: 0.1, release: 0.1, gain: 1}, 1);
  assert.equal(p[0][1], 0);
  assert.equal(p[p.length - 1][1], 0);
  assert.ok(Math.abs(p[p.length - 1][0] - 0.1) < 1e-9);
  for(let i = 1; i < p.length; i++) assert.ok(p[i][0] >= p[i - 1][0] - 1e-12, 'temps croissants');
});

test('playVoice crée un oscillateur par partiel et programme la note au bon instant', () => {
  const ctx = fakeCtx();
  const h = playVoice(ctx, {frequency: 300, duration: 1, overtones: [{ratio: 2, gain: 0.2}]}, {when: 0.5});
  assert.equal(ctx.log.osc, 2);
  assert.equal(ctx.log.started, 2);
  assert.equal(h.endsAt, 11.5);
  assert.equal(playVoice(null, {}), null);
  const g = fakeCtx();
  playVoice(g, {glide: 0.4});
  assert.equal(g.log.glides, 1, 'le glissé est programmé');
});

test('playSequence ignore un id inconnu sans lever', () => {
  const ctx = fakeCtx();
  const s = normalizeSynth({voices: [{id: 'a'}, {id: 'b'}]});
  const out = playSequence(ctx, s, ['a', 'zz', 'b'], {gap: 0.2});
  assert.equal(out.length, 3);
  assert.equal(out[1], null);
  assert.equal(voiceOf(s, 'b').id, 'b');
});

test('makeSynthApi trouve le Synthesizer de la scène et prévient si une note manque', () => {
  const ctx = fakeCtx();
  const warns = [];
  const node = {getComponent: (t) => t === 'Synthesizer' ? {data: normalizeSynth({voices: [{id: 'mi', meta: {shape: 'star'}}]})} : null};
  const api = makeSynthApi(() => ctx, () => [{getComponent: () => null}, node], {getComponent: () => null}, (m) => warns.push(m));
  assert.ok(api.playNote('mi'));
  assert.equal(api.playNote('fa'), null);
  assert.equal(warns.length, 1);
  const notes = api.notes();
  notes[0].meta.shape = 'muté';
  assert.equal(api.notes()[0].meta.shape, 'star', 'api.notes rend une copie');
});

test('joystick : zone morte retirée, amplitude bornée à 1, y vers le haut', () => {
  assert.deepEqual(joystickVector(5, 0, 100, 0.15), {x: 0, y: 0});
  const v = joystickVector(0, -500, 100, 0.15);
  assert.ok(Math.abs(v.y - 1) < 1e-9);
  const w = joystickVector(57.5, 0, 100, 0.15);
  assert.ok(Math.abs(w.x - 0.5) < 1e-9, 'réétalé après la zone morte');
});

test('la config tactile est normalisée, et l axe tactile ne masque pas le clavier', () => {
  const c = normalizeTouchControls({joystick: {side: 'haut', size: 5}, buttons: [{action: 'wave'}]});
  assert.equal(c.joystick.side, 'left');
  assert.equal(c.joystick.size, 60);
  assert.deepEqual(c.buttons[0], {id: 'button1', label: 'wave', action: 'wave', side: 'right'});
  touchState.axes = {horizontal: 0.4};
  assert.equal(combineAxis(-1, 'horizontal'), -1);
  assert.equal(combineAxis(0, 'horizontal'), 0.4);
  touchState.axes = {};
});
