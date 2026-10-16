// moteur/test/particules-systeme.test.mjs
//
// Le système de particules de la v1.21.0 : format (js/particle-asset.js) et simulation
// (js/particle-core.js), tous deux purs — importés tels quels, sans harnais ni navigateur.
//
// Ce que ces tests tiennent : un émetteur d'AVANT se relit À L'IDENTIQUE, une surcharge ne
// touche jamais l'asset partagé, et chaque module fait ce que son libellé promet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachParticlesAsset, clearParticleOverride, defaultPartBag, defaultParticleSystem,
         detachParticlesAsset, evaluateCurve, evaluateGradient, compileGradient, isKnownPath,
         legacySettingsToPaths, normalizeParticleSystem, PARTICLE_PRESETS, particlesFileContent,
         readParticlesFile, remapPartBagRefs, remapSystemRefs, resolveParticleSystem,
         setParticleValue, systemFromLegacy, upgradePartBag } from '../js/particle-asset.js';
import { compileSystem, createParticleState, emitParticles, stepParticles,
         writeOutputs } from '../js/particle-core.js';

/** Un tirage déterministe : la simulation doit se rejouer à l'identique. */
function seeded(seed){
  let s = seed >>> 0;
  return function(){ s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const IDENTITY = {matrix: [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1], quat: [0, 0, 0, 1], invQuat: [0, 0, 0, 1]};
function outFor(max){
  return {pos: new Float32Array(max * 3), size: new Float32Array(max), color: new Float32Array(max * 4),
          rot: new Float32Array(max), frame: new Float32Array(max), vel: new Float32Array(max * 3)};
}
function run(system, seconds, opts){
  const s = normalizeParticleSystem(system);
  const c = compileSystem(s);
  const st = createParticleState(s.main.maxParticles, seeded(7));
  const out = outFor(s.main.maxParticles);
  const dt = 1 / 60;
  for(let t = 0; t < seconds - 1e-9; t += dt) stepParticles(st, c, dt, IDENTITY, opts || {}, out);
  return {st, c, out};
}

// ---------- Migration de l'ancien sac ----------

test('un ancien emetteur (champs a plat) se traduit sans rien perdre — l aleatoire de 25 % devient un intervalle', () => {
  const s = systemFromLegacy({shape: 'sphere', radius: 2, rate: 40, vie: 2, speed: 4, gravity: -3,
    sizeStart: 0.5, sizeEnd: 0.1, opacityStart: 0.8, opacityEnd: 0.2, colorStart: '#112233',
    colorEnd: '#445566', additif: false, max: 900});
  assert.deepEqual(s.main.startLifetime, [1.5, 2.5]);
  assert.deepEqual(s.main.startSpeed, [3, 5]);
  assert.equal(s.main.gravity, -3);
  assert.equal(s.main.maxParticles, 900);
  assert.equal(s.emission.rateOverTime, 40);
  assert.equal(s.shape.type, 'sphere');
  assert.equal(s.shape.radius, 2);
  assert.deepEqual(s.main.startSize, [0.5, 0.5]);
  assert.ok(Math.abs(evaluateCurve(s.sizeOverLife.curve, 1) * 0.5 - 0.1) < 1e-9, 'taille de fin conservée');
  const g = compileGradient(s.colorOverLife.gradient);
  const c0 = evaluateGradient(g, 0, [0, 0, 0, 0]), c1 = evaluateGradient(g, 1, [0, 0, 0, 0]);
  assert.ok(Math.abs(c0[3] - 0.8) < 1e-9 && Math.abs(c1[3] - 0.2) < 1e-9, 'opacités de début et de fin');
  assert.ok(Math.abs(c0[0] - 0x11 / 255) < 1e-6 && Math.abs(c1[2] - 0x66 / 255) < 1e-6, 'couleurs de début et de fin');
  assert.equal(s.render.blending, 'normal');
});

test('un ancien burst devient une salve unique a t = 0, sans boucle', () => {
  const s = systemFromLegacy({mode: 'burst', amount: 70, vie: 1});
  assert.equal(s.main.looping, false);
  assert.equal(s.emission.rateOverTime, 0);
  assert.deepEqual(s.emission.bursts, [{time: 0, count: 70, cycles: 1, interval: 0.5}]);
  const r = run(s, 0.05);
  assert.equal(r.st.nb, 70, 'la salve part à la première image');
  const r2 = run(s, 3);
  assert.equal(r2.st.nb, 0, 'puis plus rien : un burst ne se répète pas en jeu');
});

test('le sac est traduit EN PLACE — le composant et les systemes partagent le meme objet', () => {
  const bag = {rate: 12, shape: 'box', dims: [3, 1, 2]};
  const same = upgradePartBag(bag);
  assert.equal(same, bag);
  assert.equal(bag.version, 2);
  assert.equal(bag.system.emission.rateOverTime, 12);
  assert.deepEqual(bag.system.shape.size, [3, 1, 2]);
  assert.equal(Object.keys(bag).indexOf('rate'), -1, 'les champs à plat ne traînent plus dans le sac');
});

test('les defauts du systeme sont ceux de l ancien emetteur (cone orange, 25 par seconde)', () => {
  const legacy = systemFromLegacy({});
  const now = normalizeParticleSystem(defaultParticleSystem());
  assert.deepEqual(normalizeParticleSystem(legacy), now);
});

// ---------- Asset, surcharges, détacher ----------

test('sur un emetteur relie a un asset, un reglage est une SURCHARGE — l asset ne bouge pas', () => {
  const asset = {id: 'a3', kind: 'particles', system: PARTICLE_PRESETS.fire.make()};
  const find = (id) => (id === 'a3' ? asset : null);
  const bag = defaultPartBag();
  attachParticlesAsset(bag, 'a3');
  const avant = JSON.stringify(asset.system);
  setParticleValue(bag, 'main.startColor', ['#00ff00', '#00ff00']);
  assert.equal(JSON.stringify(asset.system), avant);
  assert.deepEqual(resolveParticleSystem(bag, find).main.startColor, ['#00ff00', '#00ff00']);
  assert.equal(resolveParticleSystem(bag, find).noise.enabled, true, 'le reste vient de l asset');
  clearParticleOverride(bag);
  assert.deepEqual(resolveParticleSystem(bag, find).main.startColor, asset.system.main.startColor);
});

test('detacher recopie le systeme EFFECTIF (asset + surcharges) dans l objet', () => {
  const asset = {id: 'a3', kind: 'particles', system: PARTICLE_PRESETS.smoke.make()};
  const bag = defaultPartBag();
  attachParticlesAsset(bag, 'a3');
  setParticleValue(bag, 'emission.rateOverTime', 99);
  detachParticlesAsset(bag, () => asset);
  assert.equal(bag.particlesId, null);
  assert.deepEqual(bag.overrides, {});
  assert.equal(bag.system.emission.rateOverTime, 99);
  assert.equal(bag.system.render.blending, 'normal', 'la fumée garde son mélange');
});

test('un asset introuvable retombe sur un systeme visible, jamais sur rien', () => {
  const bag = defaultPartBag();
  attachParticlesAsset(bag, 'a404');
  const s = resolveParticleSystem(bag, () => null);
  assert.ok(s.main.maxParticles > 0 && s.emission.rateOverTime > 0);
});

test('un chemin inconnu est REFUSE avec un message lisible (faute de frappe d un agent)', () => {
  assert.equal(isKnownPath('main.startSize'), true);
  assert.equal(isKnownPath('main.startSise'), false);
  assert.throws(() => setParticleValue(defaultPartBag(), 'noise.force', 1), /inconnu/);
});

test('le fichier .particles.json se relit, meme partiel ou casse', () => {
  const s = PARTICLE_PRESETS.sparks.make();
  const text = JSON.stringify(particlesFileContent(s));
  assert.deepEqual(readParticlesFile(text), normalizeParticleSystem(s));
  assert.ok(readParticlesFile('{pas du json').main, 'un fichier cassé rend les défauts');
  assert.equal(readParticlesFile({system: {emission: {rateOverTime: 3}}}).emission.rateOverTime, 3);
});

test('les references d asset contenues sont remappees (texture, sous-emetteurs, surcharges)', () => {
  const map = {a1: 'a10', a2: 'a20', a3: 'a30'};
  const remap = (id) => map[id] || null;
  const s = normalizeParticleSystem({render: {textureId: 'a1'}, subEmitters: {enabled: true,
    list: [{event: 'death', particlesId: 'a2', count: 4}]}});
  remapSystemRefs(s, remap);
  assert.equal(s.render.textureId, 'a10');
  assert.equal(s.subEmitters.list[0].particlesId, 'a20');
  const bag = defaultPartBag();
  bag.particlesId = 'a3';
  bag.overrides['render.textureId'] = 'a1';
  remapPartBagRefs(bag, remap);
  assert.equal(bag.particlesId, 'a30');
  assert.equal(bag.overrides['render.textureId'], 'a10');
});

test('tous les presets livres sont des systemes valides', () => {
  Object.keys(PARTICLE_PRESETS).forEach((k) => {
    const s = PARTICLE_PRESETS[k].make();
    assert.deepEqual(normalizeParticleSystem(s), s, k + ' : normalisé');
    const n = normalizeParticleSystem(s), c = compileSystem(n);
    const st = createParticleState(n.main.maxParticles, seeded(11));
    let pic = 0;
    for(let i = 0; i < 90; i++){ stepParticles(st, c, 1 / 60, IDENTITY, {}, null); pic = Math.max(pic, st.nb); }
    assert.ok(pic > 0, k + ' : émet quelque chose en 1,5 s');
  });
});

test('les anciens champs a plat des outils (rate, life, colorStart…) deviennent des chemins', () => {
  const p = legacySettingsToPaths({rate: 80, life: 2, colorEnd: '#0000ff', additive: false, mode: 'burst', amount: 15},
    defaultParticleSystem());
  assert.equal(p['emission.rateOverTime'], 0, 'un burst coupe le débit');
  assert.deepEqual(p['emission.bursts'], [{time: 0, count: 15, cycles: 1, interval: 0.5}]);
  assert.deepEqual(p['main.startLifetime'], [1.5, 2.5]);
  assert.equal(p['render.blending'], 'normal');
  assert.equal(p['colorOverLife.gradient'].keys[1].color, '#0000ff');
  Object.keys(p).forEach((k) => assert.ok(isKnownPath(k), k));
});

// ---------- Simulation ----------

test('emission continue : le debit est tenu sur la duree', () => {
  const r = run({emission: {rateOverTime: 30}, main: {startLifetime: [10, 10], maxParticles: 1000}}, 2);
  assert.ok(Math.abs(r.st.nb - 60) <= 1, 'environ 60 en 2 s, mesuré ' + r.st.nb);
});

test('le plafond max particules tient', () => {
  const r = run({emission: {rateOverTime: 1000}, main: {startLifetime: [10, 10], maxParticles: 50}}, 1);
  assert.equal(r.st.nb, 50);
});

test('salves : instant, nombre, repetitions', () => {
  const s = {main: {looping: false, duration: 3, startLifetime: [10, 10], maxParticles: 500},
    emission: {rateOverTime: 0, bursts: [{time: 0.5, count: 10, cycles: 3, interval: 0.5}]}};
  assert.equal(run(s, 0.4).st.nb, 0);
  assert.equal(run(s, 0.6).st.nb, 10);
  assert.equal(run(s, 1.6).st.nb, 30);
  assert.equal(run(s, 2.9).st.nb, 30, 'pas de quatrième cycle');
});

test('emetteur decoche : plus de naissances, mais les particules en vol finissent leur vie', () => {
  const s = normalizeParticleSystem({emission: {rateOverTime: 60}, main: {startLifetime: [1, 1]}});
  const c = compileSystem(s);
  const st = createParticleState(300, seeded(1));
  for(let i = 0; i < 30; i++) stepParticles(st, c, 1 / 60, IDENTITY, {emit: true}, null);
  const n = st.nb;
  assert.ok(n > 0);
  for(let i = 0; i < 30; i++) stepParticles(st, c, 1 / 60, IDENTITY, {emit: false}, null);
  assert.ok(st.nb <= n && st.nb > 0, 'elles vivent encore');
  for(let i = 0; i < 90; i++) stepParticles(st, c, 1 / 60, IDENTITY, {emit: false}, null);
  assert.equal(st.nb, 0, 'puis elles meurent');
});

test('en pause, rien ne bouge', () => {
  const s = normalizeParticleSystem({emission: {rateOverTime: 60}, main: {startLifetime: [5, 5]}});
  const c = compileSystem(s);
  const st = createParticleState(300, seeded(2));
  for(let i = 0; i < 20; i++) stepParticles(st, c, 1 / 60, IDENTITY, {}, null);
  st.playing = false;
  const avant = Array.from(st.pos.slice(0, st.nb * 3));
  const nb = st.nb;
  for(let i = 0; i < 20; i++) stepParticles(st, c, 1 / 60, IDENTITY, {}, null);
  assert.equal(st.nb, nb);
  assert.deepEqual(Array.from(st.pos.slice(0, nb * 3)), avant);
});

test('collision : la particule rebondit sur le plan et n y passe jamais dessous', () => {
  const s = {main: {gravity: -20, startSpeed: [0, 0], startLifetime: [5, 5], startSize: [0.2, 0.2]},
    shape: {type: 'point'}, emission: {rateOverTime: 0, bursts: [{time: 0, count: 1, cycles: 1, interval: 1}]},
    collision: {enabled: true, planeHeight: -1, bounce: 0.5}};
  let minY = Infinity, events = 0;
  const n = normalizeParticleSystem(s);
  const c = compileSystem(n);
  const st = createParticleState(10, seeded(3));
  for(let i = 0; i < 120; i++){
    stepParticles(st, c, 1 / 60, IDENTITY, {onEvent: (t) => { if(t === 'collision') events++; }}, null);
    if(st.nb) minY = Math.min(minY, st.pos[1]);
  }
  assert.ok(events >= 1, 'au moins un choc');
  assert.ok(minY >= -1 + 0.1 - 1e-6, 'jamais sous le plan (rayon compris), mesuré ' + minY);
});

test('sous-emetteurs : la mort d une particule est annoncee', () => {
  const n = normalizeParticleSystem({main: {startLifetime: [0.2, 0.2], startSpeed: [0, 0]}, shape: {type: 'point'},
    emission: {rateOverTime: 0, bursts: [{time: 0, count: 3, cycles: 1, interval: 1}]}});
  const c = compileSystem(n);
  const st = createParticleState(10, seeded(4));
  let morts = 0;
  for(let i = 0; i < 30; i++) stepParticles(st, c, 1 / 60, IDENTITY, {onEvent: (t) => { if(t === 'death') morts++; }}, null);
  assert.equal(morts, 3);
});

test('espace LOCAL : les particules suivent l emetteur deplace', () => {
  const n = normalizeParticleSystem({main: {simulationSpace: 'local', startSpeed: [0, 0], startLifetime: [5, 5]},
    shape: {type: 'point'}, emission: {rateOverTime: 0, bursts: [{time: 0, count: 1, cycles: 1, interval: 1}]}});
  const c = compileSystem(n);
  const st = createParticleState(4, seeded(5));
  const out = outFor(4);
  stepParticles(st, c, 1 / 60, IDENTITY, {}, out);
  const moved = {matrix: [1,0,0,0, 0,1,0,0, 0,0,1,0, 7,0,0,1], quat: [0, 0, 0, 1], invQuat: [0, 0, 0, 1]};
  writeOutputs(st, c, moved, out);
  assert.ok(Math.abs(out.pos[0] - 7) < 1e-6, 'la particule a suivi l emetteur de 7 m');
});

test('espace MONDE : la position de naissance suit la matrice de l emetteur', () => {
  const n = normalizeParticleSystem({main: {startSpeed: [0, 0]}, shape: {type: 'point'}});
  const c = compileSystem(n);
  const st = createParticleState(4, seeded(6));
  const at = {matrix: [1,0,0,0, 0,1,0,0, 0,0,1,0, 2,3,4,1], quat: [0, 0, 0, 1]};
  emitParticles(st, c, 1, at, null, null);
  assert.deepEqual(Array.from(st.pos.slice(0, 3)), [2, 3, 4]);
});

test('couleur et taille sur la vie : le debut, puis la fin', () => {
  const n = normalizeParticleSystem({main: {startSize: [1, 1], startLifetime: [1, 1], startSpeed: [0, 0]},
    shape: {type: 'point'},
    emission: {rateOverTime: 0, bursts: [{time: 0, count: 1, cycles: 1, interval: 1}]},
    sizeOverLife: {enabled: true, curve: {keys: [[0, 1], [1, 0.25]]}},
    colorOverLife: {enabled: true, gradient: {keys: [{t: 0, color: '#ffffff', alpha: 1}, {t: 1, color: '#ff0000', alpha: 0}]}}});
  const c = compileSystem(n);
  const st = createParticleState(2, seeded(8));
  const out = outFor(2);
  stepParticles(st, c, 1 / 60, IDENTITY, {}, out);
  assert.ok(out.size[0] > 0.95 && out.color[3] > 0.95);
  for(let i = 0; i < 55; i++) stepParticles(st, c, 1 / 60, IDENTITY, {}, out);
  assert.ok(out.size[0] < 0.35, 'taille vers 0,25, mesuré ' + out.size[0]);
  assert.ok(out.color[1] < 0.15 && out.color[3] < 0.1, 'vers le rouge transparent');
});

test('planche de sprites : la case avance sur la vie et reste dans la planche', () => {
  const n = normalizeParticleSystem({main: {startLifetime: [1, 1], startSpeed: [0, 0]}, shape: {type: 'point'},
    emission: {rateOverTime: 0, bursts: [{time: 0, count: 1, cycles: 1, interval: 1}]},
    textureSheet: {enabled: true, tilesX: 4, tilesY: 2, mode: 'lifetime', cycles: 1}});
  const c = compileSystem(n);
  const st = createParticleState(2, seeded(9));
  const out = outFor(2);
  const vus = new Set();
  for(let i = 0; i < 59; i++){ stepParticles(st, c, 1 / 60, IDENTITY, {}, out); if(st.nb) vus.add(out.frame[0]); }
  assert.deepEqual([...vus].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7]);
});

test('meme graine, meme simulation : le systeme se rejoue a l identique', () => {
  const a = run(PARTICLE_PRESETS.magic.make(), 1);
  const b = run(PARTICLE_PRESETS.magic.make(), 1);
  assert.equal(a.st.nb, b.st.nb);
  assert.deepEqual(Array.from(a.out.pos.slice(0, a.st.nb * 3)), Array.from(b.out.pos.slice(0, b.st.nb * 3)));
});

test('un script d AVANT (data.rate = 60) agit encore — par des accesseurs jamais serialises', () => {
  const bag = upgradePartBag({rate: 10});
  bag.rate = 60;
  assert.equal(bag.system.emission.rateOverTime, 60);
  assert.equal(bag.rate, 60);
  bag.vie = 2;
  assert.deepEqual(bag.system.main.startLifetime, [1.5, 2.5]);
  bag.mode = 'burst';
  assert.equal(bag.mode, 'burst');
  assert.deepEqual(Object.keys(bag), ['version', 'active', 'particlesId', 'system', 'overrides']);
  assert.ok(!JSON.stringify(bag).includes('"rate"'), 'rien d ancien ne part dans le fichier');
  const relie = defaultPartBag();
  upgradePartBag(relie);
  attachParticlesAsset(relie, 'a1');
  relie.gravity = -4;
  assert.equal(relie.overrides['main.gravity'], -4, 'relié à un asset : c est une surcharge');
});
