// ---------- Le Rack sonore (panneau « Audio » du dock) ----------
//
// Ouvert par le bouton « Audio » de la barre du haut, à côté de Physics, et au double-clic sur un
// bruitage. C'est la maison des outils sonores décrits dans
// docs/superpowers/specs/2026-09-28-sound-rack-v1-design.md : des MODULES empilés comme dans un rack,
// chacun avec sa façade d'appareil des années 80.
//
//   · MX-3  — la console de mixage des trois bus (js/audio-bus.js) ;
//   · SX-1  — le synthé à bruitages : il règle la RECETTE d'un asset `sfx` (js/chip-synth.js) ;
//   · BX-16 — la boîte à musique : percussions, basse, mélodie, accords (asset `musicLoop`,
//     js/music-loop.js).
//
// CHAQUE MODULE SE REPLIE par le triangle de son en-tête ; l'état replié est une préférence de CETTE
// machine (localStorage), pas une donnée du projet.
//
// Ce fichier ne contient QUE de l'interface. Le son (bornes, défauts, calcul) reste dans
// js/chip-synth.js ; les volumes passent par `project.settings.audioBuses` ; une recette s'écrit par
// `setSfxRecipe` (js/audio.js) — les mêmes portes que le copilote, donc les mêmes résultats.
//
// LES MODULES SONT DÉCRITS PAR DES DONNÉES (`MIXER_STRIPS`, `SX1_SECTIONS`) et montés par un seul
// code : pas de HTML concaténé à la main, la leçon de js/import-settings.js (revue du 22/09, § 2.1).

import { AUDIO_BUS_VOLUME_MAX, sanitizeAudioBuses } from './audio-bus.js';
import { audioMix, auditionBuffer, auditionLoop, createAssetAudio, createAssetLoop, createAssetSfx, engineAudio, freeAudioFileName, loopAuditionPosition, setLoopRecipe, setProjectBusVolumes, setSfxRecipe, stopLoopAudition } from './audio.js';
import { assets, folderCurrent } from './assets.js';
import { SFX_BOUNDS, SFX_PRESET_NAMES, SFX_SAMPLE_RATE, SFX_WAVES, mutateSfx, normalizeSfx, presetSfx, readPath, renderSfx } from './chip-synth.js';
import { setStatus } from './hierarchy.js';
import { pushHistory } from './history.js';
import { CHORD_STYLES, DRUM_VOICES, clearLoop, INSTRUMENT_NAMES, LOOP_MAX_BARS, LOOP_PRESET_NAMES, LOOP_SAMPLE_RATE, LOOP_STEPS_PER_BAR, NOTE_NAMES, PROGRESSIONS, SCALE_NAMES, chordSlots, diatonicChords, expandTokens, holdNoteTo, keyIndex, midiToNote, noteAt, parseLane, parseNotes, presetLoop, progressionChords, renderLoop, retuneLoop, scaleNotes, setChordAt, setDrumStep, stepSeconds, toggleNoteAt } from './music-loop.js';
import { encodeWav } from './proc-sound.js';
import { markProjectUnsaved } from './project-dirty.js';
import { project } from './project.js';
import { selectAsset } from './selection.js';
import { slugFile } from './serialization.js';
import { openPanelDock } from './ui.js';

export const btnAudio = document.getElementById('btn-audio');

/**
 * L'état du rack : le bruitage ouvert dans SX-1, la boucle ouverte dans BX-16, la mesure éditée,
 * l'octave affichée par piste de notes, la lecture en cours, les modules repliés.
 */
export const rack = {sfxId: null, loopId: null, bar: 0, octave: {}, playing: false,
                     collapsed: readCollapsed()};

const COLLAPSED_KEY = 'soundRack.collapsed';
function readCollapsed(){
  try { return JSON.parse(localStorage.getItem('soundRack.collapsed') || '{}') || {}; }
  catch(e){ return {}; }
}
function writeCollapsed(){
  try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify(rack.collapsed)); } catch(e){}
}

// ---------- MX-3 : la console de mixage ----------

// Les tranches, de gauche à droite : les deux bus de sources, puis le général — l'ordre d'une vraie
// console, où le master est toujours à droite. `cap` : la teinte de pas du rack.
export const MIXER_STRIPS = [
  {bus: 'music', label: 'MUSIQUE', cap: 'var(--rack-step-1)',
   help: 'Les sources audio réglées sur le bus « Musique ».'},
  {bus: 'sfx', label: 'EFFETS', cap: 'var(--rack-step-2)',
   help: 'Les sources sur « Effets sonores » (le défaut), api.playSound et les notes du synthé.'},
  {bus: 'master', label: 'GÉNÉRAL', cap: 'var(--rack-step-4)',
   help: 'Tout ce que le jeu fait entendre.'}
];


function volumes(){
  return sanitizeAudioBuses(project && project.settings ? project.settings.audioBuses : null);
}

/** Le volume affiché sur l'afficheur 7 segments : deux décimales, comme un appareil. */
export function segmentText(v){
  return (Math.round(Number(v) * 100) / 100).toFixed(2);
}

/** Écrit un volume de bus dans le projet, et le fait entendre tout de suite. */
export function setBusVolume(bus, v){
  const patch = {};
  patch[bus] = v;
  const r = setProjectBusVolumes(patch);
  return r ? r[bus] : null;
}

function el(tag, cls, text){
  const e = document.createElement(tag);
  if(cls) e.className = cls;
  if(text !== undefined) e.textContent = text;
  return e;
}

function button(label, onClick, cls){
  const b = el('button', 'rack-btn' + (cls ? ' ' + cls : ''), label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

function buildStrip(strip){
  const box = el('div', 'rack-strip');
  box.title = strip.help;
  const cap = el('div', 'rack-strip-cap');
  cap.style.background = strip.cap;
  const seg = el('div', 'rack-seg', segmentText(volumes()[strip.bus]));
  seg.setAttribute('aria-hidden', 'true');

  const fader = el('input', 'rack-fader');
  fader.type = 'range';
  fader.min = '0';
  fader.max = String(AUDIO_BUS_VOLUME_MAX);
  fader.step = '0.05';
  fader.value = String(volumes()[strip.bus]);
  fader.id = 'rack-fader-' + strip.bus;
  fader.setAttribute('aria-label', 'Volume ' + strip.label);
  fader.addEventListener('input', function(){
    const v = setBusVolume(strip.bus, Number(fader.value));
    if(v === null) return;
    seg.textContent = segmentText(v);
    fader.setAttribute('aria-valuetext', segmentText(v));
  });
  // Double-clic : retour à 1, le réglage neutre.
  fader.addEventListener('dblclick', function(){
    fader.value = '1';
    fader.dispatchEvent(new Event('input'));
  });

  // LA SOURDINE NE S'ENREGISTRE PAS : c'est un état d'écoute, comme sur une console. Elle vit sur
  // les bus de l'éditeur et tombe au prochain lancement de partie (resetAudioMix).
  const mute = el('button', 'rack-btn');
  mute.type = 'button';
  mute.appendChild(el('span', 'rack-led'));
  mute.appendChild(document.createTextNode('MUET'));
  mute.title = 'Coupe ce bus pendant l\'écoute dans l\'éditeur. Non enregistré dans le projet.';
  mute.setAttribute('aria-pressed', String(!!(engineAudio.buses && engineAudio.buses.isMuted(strip.bus))));
  mute.addEventListener('click', function(){
    const mix = audioMix();
    const on = !mix.isMuted(strip.bus);
    mix.mute(strip.bus, on);
    mute.setAttribute('aria-pressed', String(on));
  });

  box.appendChild(cap);
  box.appendChild(seg);
  box.appendChild(fader);
  box.appendChild(el('div', 'rack-label', strip.label));
  box.appendChild(mute);
  return box;
}

/**
 * La façade d'un module : son en-tête avec le triangle qui le REPLIE, et le corps. Replié, seul
 * l'en-tête reste — on garde la console sous les yeux sans qu'elle mange le panneau.
 */
export function moduleShell(name, sub, label){
  const mod = el('section', 'rack-module' + (rack.collapsed[name] ? ' is-collapsed' : ''));
  mod.setAttribute('aria-label', label || name);
  const head = buildModuleHead(name, sub);
  const fold = el('button', 'rack-fold', rack.collapsed[name] ? '▸' : '▾');
  fold.type = 'button';
  fold.setAttribute('aria-expanded', String(!rack.collapsed[name]));
  fold.setAttribute('aria-label', (rack.collapsed[name] ? 'Déplier ' : 'Replier ') + name);
  fold.addEventListener('click', function(){
    rack.collapsed[name] = !rack.collapsed[name];
    writeCollapsed();
    buildSoundRack();
  });
  head.insertBefore(fold, head.firstChild);
  mod.appendChild(head);
  return {mod: mod, head: head};
}

function buildModuleHead(name, sub){
  const head = el('div', 'rack-head');
  head.appendChild(el('span', 'rack-name', name));
  head.appendChild(el('span', 'rack-sub', sub));
  return head;
}

function buildMixer(){
  const mixer = moduleShell('MX-3', 'MIXER', 'Console de mixage').mod;
  if(!project || !project.settings){
    mixer.appendChild(el('p', 'rack-note', 'Ouvrez un projet pour régler le mixage.'));
    return mixer;
  }
  const strips = el('div', 'rack-strips');
  MIXER_STRIPS.forEach(function(s){ strips.appendChild(buildStrip(s)); });
  mixer.appendChild(strips);
  mixer.appendChild(el('p', 'rack-note',
    'Volumes enregistrés dans le projet et embarqués dans le jeu publié. Double-clic : retour à 1. '
    + 'Le bus d\'une source se choisit dans son inspecteur.'));
  return mixer;
}

// ---------- SX-1 : le synthé à bruitages ----------

// Les boutons de preset, sérigraphiés en majuscules comme sur une façade. L'ordre des teintes suit
// celui des pas de la boîte à rythmes : rouge, orange, jaune, crème, par groupes de deux.
export const SX1_PRESET_LABELS = {jump: 'JUMP', coin: 'COIN', laser: 'LASER', explosion: 'BOOM',
  hit: 'HIT', powerUp: 'POWER', blip: 'BLIP', step: 'STEP'};
export const SX1_PRESET_TITLES = {jump: 'saut', coin: 'pièce', laser: 'laser', explosion: 'explosion',
  hit: 'coup', powerUp: 'bonus', blip: 'bip d\'interface', step: 'pas'};
export const SX1_WAVE_LABELS = {square: 'SQR', triangle: 'TRI', sawtooth: 'SAW', sine: 'SIN', noise: 'NOISE'};

// Les réglages, par section. `log` : un curseur en OCTAVES — sur une échelle linéaire de 20 à
// 8 000 Hz, tous les sons utiles tiendraient dans le premier dixième de la course.
export const SX1_SECTIONS = [
  {title: 'OSC', controls: [
    {path: 'duty', label: 'DUTY', step: 0.01, unit: ''},
    {path: 'volume', label: 'VOL', step: 0.01, unit: ''}]},
  {title: 'PITCH', controls: [
    {path: 'pitch.start', label: 'FREQ', log: true, unit: 'Hz'},
    {path: 'pitch.slide', label: 'SLIDE', step: 1, unit: 'st/s'},
    {path: 'pitch.slideAccel', label: 'ACCEL', step: 5, unit: ''},
    {path: 'pitch.min', label: 'FLOOR', log: true, unit: 'Hz'}]},
  {title: 'MOD', controls: [
    {path: 'vibrato.depth', label: 'VIB', step: 0.05, unit: 'st'},
    {path: 'vibrato.speed', label: 'RATE', step: 0.5, unit: 'Hz'},
    {path: 'arpeggio.semitones', label: 'ARP', step: 1, unit: 'st'},
    {path: 'arpeggio.at', label: 'ARP AT', step: 0.01, unit: ''},
    {path: 'repeat', label: 'REPEAT', step: 0.01, unit: 's'}]},
  {title: 'ENV', controls: [
    {path: 'envelope.attack', label: 'ATTACK', step: 0.001, unit: 's'},
    {path: 'envelope.sustain', label: 'SUSTAIN', step: 0.01, unit: 's'},
    {path: 'envelope.punch', label: 'PUNCH', step: 0.01, unit: ''},
    {path: 'envelope.decay', label: 'DECAY', step: 0.01, unit: 's'}]},
  {title: 'FILTER', controls: [
    {path: 'filter.lowpass', label: 'LOWPASS', step: 0.01, unit: ''},
    {path: 'filter.resonance', label: 'RESO', step: 0.01, unit: ''},
    {path: 'filter.highpass', label: 'HIPASS', step: 0.01, unit: ''}]},
  {title: 'CRUSH', controls: [
    {path: 'crush.bits', label: 'BITS', step: 1, unit: ''},
    {path: 'crush.downsample', label: 'DOWN', step: 1, unit: '×'}]}
];

const LOG_STEPS = 1000;

function withPath(recipe, p, v){
  const out = JSON.parse(JSON.stringify(recipe));
  const parts = p.split('.');
  if(parts.length === 1) out[p] = v; else out[parts[0]][parts[1]] = v;
  return out;
}

/** Position d'un curseur (0..LOG_STEPS) pour une valeur, sur une échelle en octaves. */
export function logPosition(p, v){
  const b = SFX_BOUNDS[p];
  return Math.round(LOG_STEPS * Math.log(v / b[0]) / Math.log(b[1] / b[0]));
}
/** Et l'inverse : la valeur d'une position. */
export function logValue(p, pos){
  const b = SFX_BOUNDS[p];
  return b[0] * Math.pow(b[1] / b[0], pos / LOG_STEPS);
}

/** La valeur lisible d'un réglage : entière pour les hertz, trois décimales au plus ailleurs. */
export function controlText(ctl, v){
  const n = Number(v);
  const a = Math.abs(n);
  const txt = (ctl.log || a >= 100) ? String(Math.round(n))
    : (a >= 10) ? String(Math.round(n * 10) / 10)
    : String(Math.round(n * 1000) / 1000);
  return txt + (ctl.unit ? ' ' + ctl.unit : '');
}

function sfxAssets(){
  return (typeof assets !== 'undefined') ? assets.filter(function(a){ return a.kind === 'sfx'; }) : [];
}
function currentSfx(){
  const list = sfxAssets();
  return list.find(function(a){ return a.id === rack.sfxId; }) || list[0] || null;
}

/** Joue le bruitage ouvert — à chaque réglage relâché, comme on juge un son : à l'oreille. */
export function auditionSfx(a){
  return (a && a.buffer) ? auditionBuffer(a.buffer) : null;
}

/** Dessine la forme d'onde CALCULÉE (pas une analyse temps réel : on a les échantillons). */
/** Les échantillons d'un bruitage : son tampon déjà calculé, sinon un rendu de sa recette. */
function samplesOfSfx(a){
  return (a.buffer && typeof a.buffer.getChannelData === 'function')
    ? a.buffer.getChannelData(0) : renderSfx(a.recipe, SFX_SAMPLE_RATE);
}

export function drawScope(canvas, samples){
  if(!canvas || !canvas.getContext) return;
  const w = canvas.clientWidth || 280, h = canvas.clientHeight || 64;
  const dpr = (typeof devicePixelRatio === 'number' && devicePixelRatio > 0) ? devicePixelRatio : 1;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const g = canvas.getContext('2d');
  if(!g) return;
  const css = getComputedStyle(document.documentElement);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  g.strokeStyle = css.getPropertyValue('--rack-scope-grid').trim();
  g.lineWidth = 1;
  g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
  // Les échantillons sont DONNÉS : le son vient d'être calculé par setSfxRecipe, le recalculer ici
  // doublait le coût de chaque mouvement de curseur (revue du 2026-09-29, § 5.14).
  const s = samples;
  g.fillStyle = css.getPropertyValue('--rack-scope').trim();
  const per = Math.max(1, Math.floor(s.length / w));
  for(let x = 0; x < w; x++){
    let lo = 0, hi = 0;
    const start = Math.floor(x * s.length / w);
    for(let i = start; i < Math.min(s.length, start + per); i++){
      if(s[i] < lo) lo = s[i];
      if(s[i] > hi) hi = s[i];
    }
    const y1 = h / 2 - hi * (h / 2 - 2), y2 = h / 2 - lo * (h / 2 - 2);
    g.fillRect(x, y1, 1, Math.max(1, y2 - y1));
  }
}

/** Remplace la recette du bruitage ouvert, le recalcule, et le fait entendre. */
function applyRecipe(a, recipe, opts){
  setSfxRecipe(a, recipe, opts);
  buildSoundRack();
  if(!(opts && opts.silent)) auditionSfx(a);
}

function buildControl(a, ctl, scope){
  const row = el('label', 'rack-ctl');
  row.appendChild(el('span', '', ctl.label));
  const input = el('input');
  input.type = 'range';
  const b = SFX_BOUNDS[ctl.path];
  const v = readPath(a.recipe, ctl.path);
  if(ctl.log){
    input.min = '0'; input.max = String(LOG_STEPS); input.step = '1';
    input.value = String(logPosition(ctl.path, v));
  } else {
    input.min = String(b[0]); input.max = String(b[1]); input.step = String(ctl.step);
    input.value = String(v);
  }
  input.setAttribute('aria-label', ctl.label);
  const out = el('span', 'rack-ctl-value', controlText(ctl, v));
  // UN PAS D'HISTORIQUE PAR GESTE, pas par position : glisser un curseur émet des dizaines
  // d'`input`, et cinquante annulations pour revenir en arrière d'un seul geste ne serviraient à
  // personne. L'historique est pris au premier mouvement, le son rejoué au relâchement.
  let pushed = false;
  input.addEventListener('input', function(){
    if(!pushed){ pushHistory({assetOnly: true}); pushed = true; }
    const next = ctl.log ? logValue(ctl.path, Number(input.value)) : Number(input.value);
    setSfxRecipe(a, withPath(a.recipe, ctl.path, next), {noHistory: true});
    const shown = readPath(a.recipe, ctl.path);
    out.textContent = controlText(ctl, shown);
    input.setAttribute('aria-valuetext', controlText(ctl, shown));
    drawScope(scope, samplesOfSfx(a));
  });
  input.addEventListener('change', function(){
    pushed = false;
    auditionSfx(a);
    if(typeof markProjectUnsaved === 'function') markProjectUnsaved();
  });
  row.appendChild(input);
  row.appendChild(out);
  return row;
}

/** Fige le bruitage en fichier WAV : un asset `audio` ordinaire, qui ne se recalcule plus. */
export function exportSfxToWav(a){
  const wav = encodeWav(renderSfx(a.recipe, SFX_SAMPLE_RATE), SFX_SAMPLE_RATE);
  pushHistory({assetOnly: true});
  return createAssetAudio(new File([wav], freeAudioFileName(folderCurrent, slugFile(a.name), '.wav'),
                                  {type: 'audio/wav'}), {name: a.name + '.wav'});
}

function newSfx(){
  pushHistory({assetOnly: true});
  const a = createAssetSfx(presetSfx('jump', Math.floor(Math.random() * 100000) + 1), {name: uniqueAssetName('Saut')});
  rack.sfxId = a.id;
  selectAsset(a);
  buildSoundRack();
  auditionSfx(a);
}

function buildSynth(){
  const shell = moduleShell('SX-1', 'SOUND EFFECT GENERATOR', 'Synthé à bruitages');
  const mod = shell.mod, head = shell.head;
  const a = currentSfx();

  const list = sfxAssets();
  if(list.length){
    const pick = el('select', 'rack-select');
    pick.setAttribute('aria-label', 'Bruitage réglé');
    list.forEach(function(x){
      const o = el('option', '', x.name);
      o.value = x.id;
      if(a && x.id === a.id) o.selected = true;
      pick.appendChild(o);
    });
    pick.addEventListener('change', function(){
      rack.sfxId = pick.value;
      const x = currentSfx();
      if(x) selectAsset(x);
      buildSoundRack();
      auditionSfx(x);
    });
    head.appendChild(pick);
  }
  head.appendChild(button('＋ NOUVEAU', newSfx));

  if(!a){
    mod.appendChild(el('p', 'rack-note', 'Aucun bruitage dans le projet. « ＋ NOUVEAU » en crée un, '
      + 'ou « ＋ Créer → Bruitage » dans le panneau Projet.'));
    return mod;
  }
  rack.sfxId = a.id;

  // Les presets : un clic remplace la recette par un nouveau tirage du genre, et le joue.
  const presets = el('div', 'rack-row');
  SFX_PRESET_NAMES.forEach(function(name, i){
    const b = button(SX1_PRESET_LABELS[name] || name.toUpperCase(), function(){
      pushHistory({assetOnly: true});
      applyRecipe(a, presetSfx(name, Math.floor(Math.random() * 1000000) + 1), {noHistory: true});
    }, 'is-step-' + (Math.floor(i / 2) + 1));
    b.title = 'Nouveau tirage : ' + (SX1_PRESET_TITLES[name] || name);
    presets.appendChild(b);
  });
  mod.appendChild(presets);

  const waves = el('div', 'rack-row');
  waves.setAttribute('role', 'group');
  waves.setAttribute('aria-label', 'Forme d\'onde');
  SFX_WAVES.forEach(function(w){
    const b = button(SX1_WAVE_LABELS[w] || w, function(){
      applyRecipe(a, Object.assign({}, a.recipe, {wave: w}));
    });
    b.setAttribute('aria-pressed', String(a.recipe.wave === w));
    waves.appendChild(b);
  });
  mod.appendChild(waves);

  const scope = el('canvas', 'rack-scope');
  scope.setAttribute('aria-hidden', 'true');
  mod.appendChild(scope);

  const sections = el('div', 'rack-sections');
  SX1_SECTIONS.forEach(function(sec){
    const box = el('div', 'rack-section');
    box.appendChild(el('div', 'rack-section-title', sec.title));
    sec.controls.forEach(function(ctl){ box.appendChild(buildControl(a, ctl, scope)); });
    sections.appendChild(box);
  });
  mod.appendChild(sections);

  const actions = el('div', 'rack-row');
  actions.style.marginTop = 'var(--sp-4)';
  actions.appendChild(button('▶ ÉCOUTER', function(){ auditionSfx(a); }));
  actions.appendChild(button('🎲 HASARD', function(){
    pushHistory({assetOnly: true});
    const name = SFX_PRESET_NAMES[Math.floor(Math.random() * SFX_PRESET_NAMES.length)];
    applyRecipe(a, presetSfx(name, Math.floor(Math.random() * 1000000) + 1), {noHistory: true});
  }));
  actions.appendChild(button('⤳ MUTER', function(){
    applyRecipe(a, mutateSfx(a.recipe, 0.3, Math.floor(Math.random() * 1000000) + 1));
  }));
  actions.appendChild(button('⤓ WAV', function(){
    const w = exportSfxToWav(a);
    if(w) selectAsset(w);
    if(w) setStatus('WAV créé : ' + w.file.name + ' (panneau Projet)', 4000);
  }));
  actions.appendChild(el('span', 'rack-sub', 'SEED ' + normalizeSfx(a.recipe).seed));
  mod.appendChild(actions);

  // Le dessin attend la mise en page : un canvas pas encore posé mesure 0 de large.
  requestAnimationFrame(function(){ drawScope(scope, samplesOfSfx(a)); });
  return mod;
}


// ---------- BX-16 : la boîte à musique ----------
//
// Percussions, basse, mélodie et accords sur 16 pas par mesure, dans une tonalité et une gamme
// CHOISIES. Les grilles de notes n'offrent que les notes de la gamme : on ne peut pas y poser de
// fausse note. Changer de tonalité ou de gamme transpose la boucle et recale ses notes (retuneLoop).
//
// Chaque clic = UN pas d'historique, la boucle recalculée, et — si elle tourne — remplacée sans perdre
// la mesure (auditionLoop reprend à la même position). On compose en écoutant.

// Les libellés affichés. Les CLÉS sont celles du moteur (anglais) ; les valeurs, de l'interface.
export const SCALE_LABELS = {major: 'Majeur', minor: 'Mineur', harmonicMinor: 'Mineur harmonique',
  dorian: 'Dorien', phrygian: 'Phrygien', mixolydian: 'Mixolydien', pentatonicMajor: 'Penta majeure',
  pentatonicMinor: 'Penta mineure', blues: 'Blues', chromatic: 'Chromatique'};
export const DRUM_LABELS = {kick: 'KICK', snare: 'SNARE', closedHat: 'C.HAT', openHat: 'O.HAT',
  clap: 'CLAP', tomLow: 'LO TOM', tomHigh: 'HI TOM', cowbell: 'COWBELL'};
export const PROGRESSION_LABELS = {pop: 'Pop I–V–vi–IV', ballad: 'Ballade I–vi–IV–V',
  epic: 'Épique vi–IV–I–V', canon: 'Canon', simple: 'Simple I–IV–V–I'};
export const LOOP_PRESET_LABELS = {pop: 'Pop', chiptune: 'Chiptune', lofi: 'Lo-fi'};
export const CHORD_STYLE_LABELS = {pad: 'Tenu', stab: 'Plaqué', arp: 'Arpège'};

// Les deux pistes de notes : leur étendue dans la grille, une octave au-dessus de la tonique de départ.
export const NOTE_TRACKS = [
  {track: 'melody', label: 'MELODY', octave: 4},
  {track: 'bass', label: 'BASS', octave: 2}
];

function loopAssets(){
  return (typeof assets !== 'undefined') ? assets.filter(function(a){ return a.kind === 'musicLoop'; }) : [];
}
function currentLoop(){
  const list = loopAssets();
  return list.find(function(a){ return a.id === rack.loopId; }) || list[0] || null;
}

function select(options, value, onChange, label){
  const s = el('select', 'rack-select');
  if(label) s.setAttribute('aria-label', label);
  options.forEach(function(o){
    const opt = el('option', '', o[1]);
    opt.value = o[0];
    if(String(o[0]) === String(value)) opt.selected = true;
    s.appendChild(opt);
  });
  s.addEventListener('change', function(){ onChange(s.value); });
  return s;
}

/** Applique une modification de recette : historique, recalcul, écoute sans couper la mesure. */
function editLoop(a, recipe){
  pushHistory({assetOnly: true});
  setLoopRecipe(a, recipe, {noHistory: true});
  if(rack.playing && a.buffer) auditionLoop(a.buffer);
  if(typeof markProjectUnsaved === 'function') markProjectUnsaved();
  buildSoundRack();
}

function withTrack(recipe, track, patch){
  const r = JSON.parse(JSON.stringify(recipe));
  Object.assign(r[track], patch);
  return r;
}

let _ledFrame = 0;
function animateLeds(){
  cancelAnimationFrame(_ledFrame);
  const tick = function(){
    const leds = document.querySelectorAll('#sound-rack .bx-led');
    const a = currentLoop();
    const pos = rack.playing ? loopAuditionPosition() : -1;
    const step = (pos >= 0 && a) ? Math.floor(pos / stepSeconds(a.recipe)) : -1;
    leds.forEach(function(led, i){
      led.classList.toggle('is-on', step === rack.bar * LOOP_STEPS_PER_BAR + i);
    });
    if(rack.playing) _ledFrame = requestAnimationFrame(tick);
  };
  tick();
}

function togglePlay(a){
  if(rack.playing){ stopLoopAudition(); rack.playing = false; }
  else if(a && a.buffer){ auditionLoop(a.buffer); rack.playing = true; }
  buildSoundRack();
  animateLeds();
}

function newLoop(){
  pushHistory({assetOnly: true});
  const a = createAssetLoop(presetLoop('pop'), {name: uniqueAssetName('Boucle')});
  rack.loopId = a.id;
  rack.bar = 0;
  selectAsset(a);
  buildSoundRack();
}

function stepClass(i){ return 'bx-cell is-step-' + (Math.floor(i / 4) + 1); }

function buildDrumGrid(a, total){
  const box = el('div', 'rack-section');
  box.appendChild(el('div', 'rack-section-title', 'DRUMS'));
  const r = a.recipe;
  const bar0 = rack.bar * LOOP_STEPS_PER_BAR;
  DRUM_VOICES.forEach(function(v){
    const row = el('div', 'bx-row');
    row.appendChild(el('span', 'bx-label', DRUM_LABELS[v] || v));
    const lane = parseLane(r.drums.lanes[v] || '', total);
    for(let i = 0; i < LOOP_STEPS_PER_BAR; i++){
      const step = bar0 + i;
      const c = el('button', stepClass(i) + (lane[step] ? ' is-on' : '') + (lane[step] === 2 ? ' is-accent' : ''));
      c.type = 'button';
      c.setAttribute('aria-label', (DRUM_LABELS[v] || v) + ' pas ' + (i + 1));
      c.setAttribute('aria-pressed', String(!!lane[step]));
      c.title = 'Clic : coup · Maj+clic : accent';
      c.addEventListener('click', function(e){
        const next = e.shiftKey ? (lane[step] === 2 ? 0 : 2) : (lane[step] ? 0 : 1);
        const rec = JSON.parse(JSON.stringify(r));
        rec.drums.lanes[v] = setDrumStep(r.drums.lanes[v] || '', total, step, next);
        if(!/[xX]/.test(rec.drums.lanes[v])) delete rec.drums.lanes[v];
        editLoop(a, rec);
      });
      row.appendChild(c);
    }
    box.appendChild(row);
  });
  const vol = el('label', 'rack-ctl');
  vol.appendChild(el('span', '', 'VOL'));
  vol.appendChild(volumeInput(a, 'drums'));
  vol.appendChild(el('span', 'rack-ctl-value', Math.round(a.recipe.drums.volume * 100) + ' %'));
  box.appendChild(vol);
  return box;
}

function volumeInput(a, track){
  const input = el('input');
  input.type = 'range'; input.min = '0'; input.max = '1'; input.step = '0.05';
  input.value = String(a.recipe[track].volume);
  input.setAttribute('aria-label', 'Volume ' + (TRACK_LABELS[track] || track));
  input.setAttribute('aria-valuetext', Math.round(a.recipe[track].volume * 100) + ' %');
  // La valeur s'AFFICHE, pendant le geste : la ligne VOL avait une case de valeur toujours vide
  // (revue du 2026-09-29, § 4.13). Le recalcul, lui, attend le relâchement.
  input.addEventListener('input', function(){
    const out = input.parentNode && input.parentNode.querySelector('.rack-ctl-value');
    if(out) out.textContent = Math.round(Number(input.value) * 100) + ' %';
    input.setAttribute('aria-valuetext', Math.round(Number(input.value) * 100) + ' %');
  });
  input.addEventListener('change', function(){
    editLoop(a, withTrack(a.recipe, track, {volume: Number(input.value)}));
  });
  return input;
}

// Les noms des pistes, pour ce que l'interface DIT (libellés d'accessibilité).
const TRACK_LABELS = {drums: 'percussions', bass: 'basse', melody: 'mélodie', chords: 'accords'};

/** Un nom d'asset libre : « Saut », puis « Saut 2 », « Saut 3 »… — ＋ NOUVEAU créait des homonymes. */
export function uniqueAssetName(base){
  const pris = new Set((typeof assets !== 'undefined' ? assets : []).map(function(x){ return x.name; }));
  if(!pris.has(base)) return base;
  let i = 2;
  while(pris.has(base + ' ' + i)) i++;
  return base + ' ' + i;
}

function instrumentSelect(a, track){
  return select(INSTRUMENT_NAMES.map(function(n){ return [n, n.toUpperCase()]; }), a.recipe[track].instrument,
    function(v){ editLoop(a, withTrack(a.recipe, track, {instrument: v})); }, 'Instrument ' + (TRACK_LABELS[track] || track));
}

function buildNoteGrid(a, total, spec){
  const r = a.recipe;
  const box = el('div', 'rack-section');
  const title = el('div', 'rack-section-title bx-track-head');
  title.appendChild(el('span', '', spec.label));
  title.appendChild(instrumentSelect(a, spec.track));
  // L'octave affichée : celle choisie, sinon celle où commence la piste — une mélodie écrite en
  // octave 5 par le copilote doit s'ouvrir sur ses notes, pas sur une grille vide.
  let oct = rack.octave[spec.track];
  if(oct === undefined){
    const ev = parseNotes(r[spec.track].notes, total);
    oct = ev.length
      ? Math.floor((Math.min.apply(null, ev.map(function(e){ return e.midi; })) - keyIndex(r.key)) / 12) - 1
      : spec.octave;
  }
  title.appendChild(button('◂', function(){ rack.octave[spec.track] = Math.max(1, oct - 1); buildSoundRack(); }));
  title.appendChild(el('span', 'rack-sub', 'OCT ' + oct));
  title.appendChild(button('▸', function(){ rack.octave[spec.track] = Math.min(7, oct + 1); buildSoundRack(); }));
  box.appendChild(title);

  // Les lignes : les notes de la gamme sur une octave et demie depuis la tonique, l'aigu en haut. Une
  // octave seule coupait la plupart des mélodies en deux ; deux octaves ne tiennent plus en hauteur.
  const low = (oct + 1) * 12 + keyIndex(r.key);
  const rows = scaleNotes(r.key, r.scale, low, low + 19).reverse();
  const list = expandTokens(r[spec.track].notes, total);
  const bar0 = rack.bar * LOOP_STEPS_PER_BAR;
  rows.forEach(function(midi){
    const row = el('div', 'bx-row');
    row.appendChild(el('span', 'bx-label', midiToNote(midi)));
    for(let i = 0; i < LOOP_STEPS_PER_BAR; i++){
      const step = bar0 + i;
      const tok = list[step];
      const here = noteAt(list, step);
      const on = !!(here && here.midi === midi);
      const start = on && here.start === step;
      const c = el('button', stepClass(i) + (start ? ' is-on' : on ? ' is-hold' : ''));
      c.type = 'button';
      c.setAttribute('aria-label', midiToNote(midi) + ' pas ' + (i + 1));
      c.setAttribute('aria-pressed', String(on));
      c.title = 'Clic : note · Maj+clic : tenir la note précédente jusqu\'ici';
      c.addEventListener('click', function(e){
        const text = e.shiftKey ? holdNoteTo(r[spec.track].notes, total, step, midi)
                                : toggleNoteAt(r[spec.track].notes, total, step, midi);
        editLoop(a, withTrack(r, spec.track, {notes: text}));
      });
      if(tok === undefined) c.disabled = true;
      row.appendChild(c);
    }
    box.appendChild(row);
  });
  // Ce que la grille ne montre pas se DIT : une note hors de l'octave affichée ou hors de la gamme
  // (écrite par le copilote, ou restée d'une autre gamme) jouerait sans qu'on la voie.
  const hidden = parseNotes(r[spec.track].notes, total).filter(function(e){
    return e.step >= bar0 && e.step < bar0 + LOOP_STEPS_PER_BAR && rows.indexOf(e.midi) === -1;
  }).length;
  if(hidden) box.appendChild(el('p', 'rack-note', hidden + ' note(s) de cette mesure hors de la grille '
    + '(autre octave ou hors gamme) — changez d\'octave pour les voir.'));
  const vol = el('label', 'rack-ctl');
  vol.appendChild(el('span', '', 'VOL'));
  vol.appendChild(volumeInput(a, spec.track));
  vol.appendChild(el('span', 'rack-ctl-value', Math.round(a.recipe[spec.track].volume * 100) + ' %'));
  box.appendChild(vol);
  return box;
}

function buildChords(a){
  const r = a.recipe;
  const box = el('div', 'rack-section');
  const title = el('div', 'rack-section-title bx-track-head');
  title.appendChild(el('span', '', 'CHORDS'));
  title.appendChild(instrumentSelect(a, 'chords'));
  title.appendChild(select(CHORD_STYLES.map(function(s){ return [s, CHORD_STYLE_LABELS[s]]; }), r.chords.style,
    function(v){ editLoop(a, withTrack(r, 'chords', {style: v})); }, 'Style des accords'));
  title.appendChild(select([['1', '1 / mesure'], ['2', '2 / mesure']], r.chords.perBar,
    function(v){
      // Passer de 1 à 2 accords par mesure DOUBLE chaque accord : la musique ne change pas, on
      // gagne seulement des emplacements.
      const old = chordSlots(r.chords.progression, r.bars, r.chords.perBar);
      const n = Number(v);
      const next = [];
      for(let k = 0; k < r.bars * n; k++) next.push(old[Math.floor(k * r.chords.perBar / n)]);
      // Dans l'autre sens, un accord sur deux disparaît : on le DIT (Ctrl+Z le rend).
      if(n < r.chords.perBar){
        const lost = old.filter(function(c, k){ return k % 2 === 1 && c !== '.'; });
        if(lost.length) setStatus('Un accord par mesure : ' + lost.join(', ') + ' retiré(s) — Ctrl+Z pour revenir', 5000);
      }
      editLoop(a, withTrack(r, 'chords', {perBar: n, progression: next.join(' ')}));
    }, 'Accords par mesure'));
  box.appendChild(title);

  const diat = diatonicChords(r.key, r.scale);
  const roman = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
  const slots = chordSlots(r.chords.progression, r.bars, r.chords.perBar);
  const row = el('div', 'rack-row');
  for(let j = 0; j < r.chords.perBar; j++){
    const k = rack.bar * r.chords.perBar + j;
    const cur = slots[k];
    const opts = [['.', '—']].concat(diat.map(function(c, i){ return [c, roman[i] + ' · ' + c]; }));
    if(cur !== '.' && diat.indexOf(cur) === -1) opts.push([cur, cur + ' (hors gamme)']);
    row.appendChild(select(opts, cur, function(v){
      editLoop(a, withTrack(r, 'chords', {progression: setChordAt(r.chords.progression, r.bars, r.chords.perBar, k, v)}));
    }, 'Accord ' + (k + 1)));
  }
  box.appendChild(row);
  const prog = el('div', 'rack-row');
  prog.appendChild(select([['', 'Enchaînement…']].concat(Object.keys(PROGRESSIONS).map(function(p){
    return [p, PROGRESSION_LABELS[p] || p]; })), '', function(v){
    if(!v) return;
    editLoop(a, withTrack(r, 'chords', {progression: progressionChords(r.key, r.scale, v, r.bars * r.chords.perBar)}));
  }, 'Enchaînement tout fait'));
  box.appendChild(prog);
  const vol = el('label', 'rack-ctl');
  vol.appendChild(el('span', '', 'VOL'));
  vol.appendChild(volumeInput(a, 'chords'));
  vol.appendChild(el('span', 'rack-ctl-value', Math.round(a.recipe.chords.volume * 100) + ' %'));
  box.appendChild(vol);
  return box;
}

function buildLoopMachine(){
  const shell = moduleShell('BX-16', 'RHYTHM & MELODY COMPOSER', 'Boîte à musique');
  const mod = shell.mod, head = shell.head;
  const a = currentLoop();
  const list = loopAssets();
  if(list.length){
    head.appendChild(select(list.map(function(x){ return [x.id, x.name]; }), a ? a.id : '', function(v){
      if(rack.playing){ stopLoopAudition(); rack.playing = false; }
      rack.loopId = v; rack.bar = 0;
      const x = currentLoop();
      if(x) selectAsset(x);
      buildSoundRack();
    }, 'Boucle composée'));
  }
  head.appendChild(button('＋ NOUVEAU', newLoop));
  if(!a){
    mod.appendChild(el('p', 'rack-note', 'Aucune boucle dans le projet. « ＋ NOUVEAU » en crée une, '
      + 'ou « ＋ Créer → Boucle musicale » dans le panneau Projet.'));
    return mod;
  }
  rack.loopId = a.id;
  const r = a.recipe;
  const total = r.bars * LOOP_STEPS_PER_BAR;
  if(rack.bar >= r.bars) rack.bar = 0;

  // Transport : lecture, tempo, swing, mesures.
  const transport = el('div', 'rack-row');
  const play = button(rack.playing ? '■ STOP' : '▶ LECTURE', function(){ togglePlay(a); }, 'rack-btn-play');
  play.setAttribute('aria-pressed', String(!!rack.playing));
  transport.appendChild(play);
  transport.appendChild(el('span', 'rack-sub', 'TEMPO'));
  const seg = el('span', 'rack-seg', String(r.tempo));
  transport.appendChild(seg);
  const tempo = el('input');
  tempo.type = 'range'; tempo.min = '40'; tempo.max = '240'; tempo.step = '1'; tempo.value = String(r.tempo);
  tempo.className = 'bx-tempo';
  tempo.setAttribute('aria-label', 'Tempo');
  tempo.addEventListener('input', function(){ seg.textContent = tempo.value; });
  tempo.addEventListener('change', function(){ editLoop(a, Object.assign({}, r, {tempo: Number(tempo.value)})); });
  transport.appendChild(tempo);
  mod.appendChild(transport);

  const setup = el('div', 'rack-row');
  setup.appendChild(el('span', 'rack-sub', 'KEY'));
  setup.appendChild(select(NOTE_NAMES.map(function(n){ return [n, n]; }), r.key, function(v){
    editLoop(a, retuneLoop(r, v, r.scale));
  }, 'Tonalité'));
  setup.appendChild(select(SCALE_NAMES.map(function(s){ return [s, SCALE_LABELS[s] || s]; }), r.scale, function(v){
    editLoop(a, retuneLoop(r, r.key, v));
  }, 'Gamme'));
  setup.appendChild(el('span', 'rack-sub', 'SWING'));
  const swing = el('input');
  swing.type = 'range'; swing.min = '0'; swing.max = '0.5'; swing.step = '0.05'; swing.value = String(r.swing);
  swing.className = 'bx-swing';
  swing.setAttribute('aria-label', 'Swing');
  const swingValue = el('span', 'rack-ctl-value', Math.round(r.swing * 100) + ' %');
  swing.addEventListener('input', function(){ swingValue.textContent = Math.round(Number(swing.value) * 100) + ' %'; });
  swing.addEventListener('change', function(){ editLoop(a, Object.assign({}, r, {swing: Number(swing.value)})); });
  setup.appendChild(swing);
  setup.appendChild(swingValue);
  mod.appendChild(setup);

  // Les mesures : combien, et laquelle on édite.
  const bars = el('div', 'rack-row');
  bars.appendChild(el('span', 'rack-sub', 'BARS'));
  for(let b = 1; b <= LOOP_MAX_BARS; b++){
    const btn = button(String(b), function(){ editLoop(a, Object.assign({}, r, {bars: b})); });
    btn.setAttribute('aria-pressed', String(r.bars === b));
    btn.title = b + ' mesure(s) — une piste plus courte est répétée';
    bars.appendChild(btn);
  }
  bars.appendChild(el('span', 'rack-sub', 'EDIT'));
  for(let b = 0; b < r.bars; b++){
    const btn = button('M' + (b + 1), function(){ rack.bar = b; buildSoundRack(); });
    btn.setAttribute('aria-pressed', String(rack.bar === b));
    btn.title = 'Afficher la mesure ' + (b + 1) + ' dans les grilles';
    bars.appendChild(btn);
  }
  mod.appendChild(bars);

  const leds = el('div', 'bx-row bx-leds');
  leds.appendChild(el('span', 'bx-label', ''));
  for(let i = 0; i < LOOP_STEPS_PER_BAR; i++) leds.appendChild(el('span', 'bx-led'));
  leds.setAttribute('aria-hidden', 'true');
  mod.appendChild(leds);

  const sections = el('div', 'bx-sections');
  sections.appendChild(buildDrumGrid(a, total));
  NOTE_TRACKS.forEach(function(spec){ sections.appendChild(buildNoteGrid(a, total, spec)); });
  sections.appendChild(buildChords(a));
  mod.appendChild(sections);

  const actions = el('div', 'rack-row');
  actions.style.marginTop = 'var(--sp-4)';
  // CLEAR SONG : un seul pas d'historique, donc Ctrl+Z rend tout — pas de confirmation à cliquer.
  const clear = button('⌫ EFFACER', function(){ editLoop(a, clearLoop(a.recipe)); });
  clear.title = 'Vide percussions, basse, mélodie et accords ; garde tempo, tonalité, gamme et instruments. Ctrl+Z pour revenir.';
  actions.appendChild(clear);
  actions.appendChild(select([['', 'Repartir de…']].concat(LOOP_PRESET_NAMES.map(function(p){
    return [p, LOOP_PRESET_LABELS[p] || p]; })), '', function(v){ if(v) editLoop(a, presetLoop(v)); },
    'Repartir d\'une boucle toute faite'));
  actions.appendChild(button('⤓ WAV', function(){
    const wav = encodeWav(renderLoop(a.recipe, LOOP_SAMPLE_RATE), LOOP_SAMPLE_RATE);
    pushHistory({assetOnly: true});
    const w = createAssetAudio(new File([wav], freeAudioFileName(folderCurrent, slugFile(a.name), '.wav'),
                                        {type: 'audio/wav'}), {name: a.name + '.wav'});
    if(w) selectAsset(w);
    if(w) setStatus('WAV créé : ' + w.file.name + ' (panneau Projet)', 4000);
  }));
  mod.appendChild(actions);
  return mod;
}

// ---------- Le rack ----------

export function buildSoundRack(){
  const host = document.getElementById('sound-rack');
  if(!host) return;
  const scroll = host.scrollTop;
  // LE FOCUS CLAVIER SURVIT À LA RECONSTRUCTION. Chaque geste reconstruit le rack ; l'élément qui
  // avait le focus disparaissait, et le focus retombait sur la page : composer 16 pas au clavier
  // était impossible (revue du 2026-09-29, § 1.11). On le retrouve par sa position dans le rack —
  // la structure est identique d'une reconstruction à l'autre.
  const focused = document.activeElement;
  const focusables = function(){
    return Array.prototype.slice.call(host.querySelectorAll('button, input, select'));
  };
  const rangFocus = (focused && host.contains(focused)) ? focusables().indexOf(focused) : -1;
  host.textContent = '';
  host.appendChild(buildMixer());
  host.appendChild(buildSynth());
  host.appendChild(buildLoopMachine());
  if(rack.playing) animateLeds();
  host.scrollTop = scroll;
  if(rangFocus !== -1){
    const target = focusables()[rangFocus];
    if(target) target.focus({preventScroll: true});
  }
}

/** Reconstruit le rack s'il est affiché — après une annulation ou une commande du copilote. */
export function refreshSoundRack(){
  // La boucle en écoute suit sa recette : après un Ctrl+Z ou une commande du copilote, on
  // continuait d'entendre l'ancien son sous une grille déjà à jour (revue du 2026-09-29, § 3.8).
  if(rack.playing){
    const a = currentLoop();
    if(a && a.buffer) auditionLoop(a.buffer); else stopSoundRackPlayback();
  }
  const host = document.getElementById('sound-rack');
  if(host && host.offsetParent !== null) buildSoundRack();
}

/**
 * Arrête la boucle en écoute. `a` (facultatif) : n'arrêter que si c'est CETTE boucle qui joue — pour
 * la suppression d'un asset. Appelée aussi à l'ouverture d'un projet et à la fermeture du panneau.
 */
export function stopSoundRackPlayback(a){
  if(!rack.playing) return;
  if(a && a.id !== rack.loopId) return;
  stopLoopAudition();
  rack.playing = false;
  cancelAnimationFrame(_ledFrame);
  const host = document.getElementById('sound-rack');
  if(host && host.offsetParent !== null) buildSoundRack();
}

/** Ouvre le rack, sur le bruitage `a` s'il est donné. */
export function openSoundRack(a){
  if(a && a.kind === 'sfx') rack.sfxId = a.id;
  if(a && a.kind === 'musicLoop'){ rack.loopId = a.id; rack.bar = 0; }
  buildSoundRack();
  openPanelDock('sound-rack');
}

if(btnAudio) btnAudio.addEventListener('click', function(){ openSoundRack(); });

// CONSTRUIT DÈS LE CHARGEMENT : le dock RESTAURE l'onglet Audio d'une session à l'autre sans passer
// par `onShow`, et l'onglet restait vide tant qu'on ne recliquait pas sur le bouton.
buildSoundRack();

// EXPOSÉ EN GLOBALE, à dessein : js/ui/panels-shell.js, js/assets.js, js/history.js et le copilote
// l'appellent sans l'importer — même patron que buildNetworkPanel (js/network-editor.js).
globalThis.buildSoundRack = buildSoundRack;
globalThis.openSoundRack = openSoundRack;
globalThis.refreshSoundRack = refreshSoundRack;
globalThis.stopSoundRackPlayback = stopSoundRackPlayback;
globalThis.uniqueAssetName = uniqueAssetName;
