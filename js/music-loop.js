// ---------- La boîte à musique : une RECETTE devient une boucle ----------
//
// Le moteur du module BX-16 du Rack sonore (docs/superpowers/specs/2026-09-28-sound-rack-v1-design.md,
// lot D). Une boucle de 1 à 4 mesures : percussions synthétisées, basse, mélodie et accords, dans une
// TONALITÉ et une GAMME choisies. Comme js/chip-synth.js pour les bruitages, l'asset `musicLoop` ne
// garde que sa recette ; le son en est calculé au chargement, dans l'éditeur ET dans le jeu publié.
//
// LE FORMAT EST ÉCRIT POUR ÊTRE LU PAR UN HUMAIN ET ÉCRIT PAR UNE IA : une piste est une chaîne de
// jetons, un par pas (`"C5 - . E5"`), et les accords des symboles (`"Am F C G"`). Claude compose très
// bien sous cette forme ; il ne sait pas écrire des échantillons.
//
// JS PUR et DÉTERMINISTE : ni DOM, ni THREE, ni AudioContext pour le calcul — seul `toLoopBuffer`
// reçoit un contexte. Le bruit des percussions vient d'un générateur à graine fixe : deux rendus de
// la même recette sont identiques à l'échantillon près (test/music-loop.test.mjs).
//
// LA BOUCLE NE CLAQUE PAS : tout son est écrit MODULO la longueur de la boucle. La queue d'une caisse
// claire qui dépasse la fin est repliée au début — exactement ce qu'on entendrait au tour suivant — et
// le raccord n'a donc aucune discontinuité à produire.

export const LOOP_SAMPLE_RATE = 44100;   // les charlestons perdent leur brillance en dessous
export const LOOP_STEPS_PER_BAR = 16;
export const LOOP_MAX_BARS = 4;

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Les gammes, en demi-tons depuis la tonique.
export const SCALES = {
  major:           [0, 2, 4, 5, 7, 9, 11],
  minor:           [0, 2, 3, 5, 7, 8, 10],
  harmonicMinor:   [0, 2, 3, 5, 7, 8, 11],
  dorian:          [0, 2, 3, 5, 7, 9, 10],
  phrygian:        [0, 1, 3, 5, 7, 8, 10],
  mixolydian:      [0, 2, 4, 5, 7, 9, 10],
  pentatonicMajor: [0, 2, 4, 7, 9],
  pentatonicMinor: [0, 3, 5, 7, 10],
  blues:           [0, 3, 5, 6, 7, 10],
  chromatic:       [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
};
export const SCALE_NAMES = Object.keys(SCALES);

export const DRUM_VOICES = ['kick', 'snare', 'closedHat', 'openHat', 'clap', 'tomLow', 'tomHigh', 'cowbell'];

// Les qualités d'accord, en demi-tons depuis la fondamentale. L'ordre compte pour l'analyse : `m7`
// doit être essayé avant `m`, sinon « Am7 » se lirait « Am » suivi d'un « 7 » inconnu.
export const CHORD_QUALITIES = {
  maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], '7': [0, 4, 7, 10], dim: [0, 3, 6], aug: [0, 4, 8],
  sus2: [0, 2, 7], sus4: [0, 5, 7], m: [0, 3, 7], '': [0, 4, 7]
};
export const CHORD_STYLES = ['pad', 'stab', 'arp'];

// Les instruments : des voix synthétisées. `cutoff` 0-1 (1 = filtre ouvert), enveloppe en secondes.
export const INSTRUMENTS = {
  lead:  {wave: 'square',   duty: 0.5,  attack: 0.005, decay: 0.12, sustain: 0.6, release: 0.08, cutoff: 0.8,  resonance: 0,   gain: 0.5},
  chip:  {wave: 'square',   duty: 0.25, attack: 0.003, decay: 0.08, sustain: 0.5, release: 0.04, cutoff: 1,    resonance: 0,   gain: 0.45},
  pluck: {wave: 'sawtooth', duty: 0.5,  attack: 0.002, decay: 0.2,  sustain: 0,   release: 0.06, cutoff: 0.6,  resonance: 0.2, gain: 0.55},
  flute: {wave: 'sine',     duty: 0.5,  attack: 0.04,  decay: 0.1,  sustain: 0.8, release: 0.12, cutoff: 1,    resonance: 0,   gain: 0.7},
  bass:  {wave: 'triangle', duty: 0.5,  attack: 0.004, decay: 0.12, sustain: 0.7, release: 0.05, cutoff: 1,    resonance: 0,   gain: 0.9},
  acid:  {wave: 'sawtooth', duty: 0.5,  attack: 0.003, decay: 0.15, sustain: 0.3, release: 0.04, cutoff: 0.35, resonance: 0.7, gain: 0.6},
  pad:   {wave: 'sawtooth', duty: 0.5,  attack: 0.12,  decay: 0.3,  sustain: 0.7, release: 0.3,  cutoff: 0.35, resonance: 0.1, gain: 0.4},
  organ: {wave: 'square',   duty: 0.5,  attack: 0.01,  decay: 0.05, sustain: 0.9, release: 0.05, cutoff: 0.5,  resonance: 0,   gain: 0.35}
};
export const INSTRUMENT_NAMES = Object.keys(INSTRUMENTS);

// Les enchaînements tout faits, en DEGRÉS (0 = I). Ils valent pour toute tonalité et toute gamme :
// c'est ce qui fait qu'« épique » en La mineur sonne épique aussi.
export const PROGRESSIONS = {
  pop:    [0, 4, 5, 3],   // I – V – vi – IV
  ballad: [0, 5, 3, 4],   // I – vi – IV – V
  epic:   [5, 3, 0, 4],   // vi – IV – I – V
  canon:  [0, 4, 5, 2, 3, 0, 3, 4],
  simple: [0, 3, 4, 0]    // I – IV – V – I
};

export const LOOP_DEFAULT = {
  tempo: 120, swing: 0, bars: 1, key: 'C', scale: 'major',
  drums:  {volume: 0.9, lanes: {}},
  bass:   {instrument: 'bass', volume: 0.8, notes: ''},
  melody: {instrument: 'lead', volume: 0.6, notes: ''},
  chords: {instrument: 'pad', style: 'pad', perBar: 1, octave: 4, volume: 0.5, progression: ''},
  volume: 0.8
};

// ---------- Les notes ----------

/** Le numéro MIDI d'un nom de note (`C4` = 60, `A4` = 69), ou `null`. Accepte `#` et `b`. */
export function noteToMidi(name){
  const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(String(name || '').trim());
  if(!m) return null;
  let pc = NOTE_NAMES.indexOf(m[1].toUpperCase());
  if(m[2] === '#') pc += 1;
  if(m[2] === 'b') pc -= 1;
  return (Number(m[3]) + 1) * 12 + pc;
}

/** Le nom d'un numéro MIDI, en dièses (`61` → `C#4`). */
export function midiToNote(midi){
  const n = Math.round(midi);
  return NOTE_NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
}

export function midiToHz(midi){ return 440 * Math.pow(2, (midi - 69) / 12); }

/** La classe de hauteur d'une tonalité (`C` = 0, `F#` = 6), ou `null`. */
export function keyIndex(key){
  const k = String(key || '').trim();
  const m = /^([A-Ga-g])([#b]?)$/.exec(k);
  if(!m) return null;
  let pc = NOTE_NAMES.indexOf(m[1].toUpperCase());
  if(m[2] === '#') pc += 1;
  if(m[2] === 'b') pc -= 1;
  return ((pc % 12) + 12) % 12;
}

/** Vrai si la note MIDI appartient à la gamme. */
export function inScale(midi, key, scale){
  const k = keyIndex(key);
  const steps = SCALES[scale] || SCALES.major;
  return steps.indexOf((((midi - (k || 0)) % 12) + 12) % 12) !== -1;
}

/** La note de la gamme la plus proche (en cas d'égalité, celle du dessous). */
export function snapToScale(midi, key, scale){
  for(let d = 0; d <= 6; d++){
    if(inScale(midi - d, key, scale)) return midi - d;
    if(inScale(midi + d, key, scale)) return midi + d;
  }
  return midi;
}

/** Les notes MIDI de la gamme entre deux bornes incluses, du grave à l'aigu — les lignes d'une grille. */
export function scaleNotes(key, scale, lowMidi, highMidi){
  const out = [];
  for(let m = lowMidi; m <= highMidi; m++) if(inScale(m, key, scale)) out.push(m);
  return out;
}

// ---------- Les accords ----------

/** Analyse un symbole d'accord (`Am7`, `F#dim`, `Bb`) : `{root, quality, intervals}` ou `null`. */
export function parseChord(symbol){
  const m = /^([A-G])([#b]?)(.*)$/.exec(String(symbol || '').trim());
  if(!m) return null;
  const q = m[3];
  if(!Object.prototype.hasOwnProperty.call(CHORD_QUALITIES, q)) return null;
  const root = keyIndex(m[1] + m[2]);
  return {root: root, quality: q, intervals: CHORD_QUALITIES[q].slice()};
}

/** Le nom d'un accord à partir de sa fondamentale (classe de hauteur) et de sa qualité. */
export function chordName(root, quality){ return NOTE_NAMES[((root % 12) + 12) % 12] + (quality || ''); }

// La gamme d'où tirer les accords. Les gammes à cinq ou six notes n'empilent pas de tierces
// régulières : on prend la gamme heptatonique de même couleur — majeure ou mineure.
function harmonicScaleOf(scale){
  if(SCALES[scale] && SCALES[scale].length === 7) return scale;
  return (scale === 'pentatonicMinor' || scale === 'blues') ? 'minor' : 'major';
}

/**
 * Les accords DE LA GAMME, degré par degré (I à VII) : ceux que le rack propose, et ceux que les
 * enchaînements tout faits utilisent. Triades empilées en tierces dans la gamme.
 */
export function diatonicChords(key, scale){
  const k = keyIndex(key) || 0;
  const s = SCALES[harmonicScaleOf(scale)];
  const out = [];
  for(let i = 0; i < 7; i++){
    const a = s[i], b = s[(i + 2) % 7] + (i + 2 >= 7 ? 12 : 0), c = s[(i + 4) % 7] + (i + 4 >= 7 ? 12 : 0);
    const third = b - a, fifth = c - a;
    const q = (third === 4 && fifth === 7) ? '' : (third === 3 && fifth === 7) ? 'm'
      : (third === 3 && fifth === 6) ? 'dim' : (third === 4 && fifth === 8) ? 'aug' : '';
    out.push(chordName(k + a, q));
  }
  return out;
}

/** Un enchaînement tout fait, en symboles, répété ou tronqué à `count` accords. */
export function progressionChords(key, scale, name, count){
  const degrees = PROGRESSIONS[name] || PROGRESSIONS.pop;
  const chords = diatonicChords(key, scale);
  const out = [];
  for(let i = 0; i < Math.max(1, count || degrees.length); i++) out.push(chords[degrees[i % degrees.length]]);
  return out.join(' ');
}

// ---------- Les pistes ----------

/** Les jetons d'une chaîne, séparateurs de mesure `|` retirés. */
export function tokens(text){
  return String(text || '').split(/\s+/).filter(function(t){ return t && t !== '|'; });
}

/**
 * Une piste de notes en événements `{step, midi, length, accent}`, sur `total` pas. Une chaîne plus
 * courte est RÉPÉTÉE (un motif d'une mesure remplit quatre mesures), une plus longue tronquée. Un jeton
 * illisible compte comme un silence — et `validateLoop` le signale.
 */
export function parseNotes(text, total){
  const t = tokens(text);
  const events = [];
  if(!t.length) return events;
  let last = null;
  for(let i = 0; i < total; i++){
    const tok = t[i % t.length];
    // La répétition d'un motif ne prolonge pas la dernière note du tour précédent.
    if(i % t.length === 0 && i > 0) last = null;
    if(tok === '-'){ if(last) last.length++; continue; }
    const accent = tok.charAt(tok.length - 1) === '!';
    const midi = noteToMidi(accent ? tok.slice(0, -1) : tok);
    if(midi === null){ last = null; continue; }
    last = {step: i, midi: midi, length: 1, accent: accent};
    events.push(last);
  }
  return events;
}

/** Une ligne de percussions (`x...X...`) en `[0 | 1 | 2]` par pas (2 = accent), répétée sur `total`. */
export function parseLane(text, total){
  const s = String(text || '').replace(/[\s|]/g, '');
  const out = new Array(total).fill(0);
  if(!s.length) return out;
  for(let i = 0; i < total; i++){
    const c = s.charAt(i % s.length);
    out[i] = (c === 'X') ? 2 : (c === 'x') ? 1 : 0;
  }
  return out;
}

// ---------- Normalisation et validation ----------

function clamp(v, lo, hi, fallback){
  const n = Number(v);
  if(v === null || v === undefined || v === '' || typeof v === 'boolean' || !isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}
function str(v){ return (typeof v === 'string') ? v : ''; }

/** LA recette jouable tirée de n'importe quelle entrée. Seul point qui décide des défauts. */
export function normalizeLoop(d){
  const src = (d && typeof d === 'object' && !Array.isArray(d)) ? d : {};
  const def = LOOP_DEFAULT;
  const g = function(k){ return (src[k] && typeof src[k] === 'object') ? src[k] : {}; };
  const lanesIn = (g('drums').lanes && typeof g('drums').lanes === 'object') ? g('drums').lanes : {};
  const lanes = {};
  DRUM_VOICES.forEach(function(v){ if(typeof lanesIn[v] === 'string' && lanesIn[v].trim()) lanes[v] = lanesIn[v]; });
  const inst = function(v, fallback){ return (INSTRUMENT_NAMES.indexOf(v) !== -1) ? v : fallback; };
  return {
    tempo: Math.round(clamp(src.tempo, 40, 240, def.tempo)),
    swing: clamp(src.swing, 0, 0.5, def.swing),
    bars: Math.round(clamp(src.bars, 1, LOOP_MAX_BARS, def.bars)),
    key: (keyIndex(src.key) !== null) ? NOTE_NAMES[keyIndex(src.key)] : def.key,
    scale: (SCALE_NAMES.indexOf(src.scale) !== -1) ? src.scale : def.scale,
    drums: {volume: clamp(g('drums').volume, 0, 1, def.drums.volume), lanes: lanes},
    bass: {instrument: inst(g('bass').instrument, def.bass.instrument),
           volume: clamp(g('bass').volume, 0, 1, def.bass.volume), notes: str(g('bass').notes)},
    melody: {instrument: inst(g('melody').instrument, def.melody.instrument),
             volume: clamp(g('melody').volume, 0, 1, def.melody.volume), notes: str(g('melody').notes)},
    chords: {instrument: inst(g('chords').instrument, def.chords.instrument),
             style: (CHORD_STYLES.indexOf(g('chords').style) !== -1) ? g('chords').style : def.chords.style,
             perBar: Math.round(clamp(g('chords').perBar, 1, 2, def.chords.perBar)),
             octave: Math.round(clamp(g('chords').octave, 2, 6, def.chords.octave)),
             volume: clamp(g('chords').volume, 0, 1, def.chords.volume),
             progression: str(g('chords').progression)},
    volume: clamp(src.volume, 0, 1, def.volume)
  };
}

/** Le nombre de pas de la boucle. */
export function loopSteps(d){ return normalizeLoop(d).bars * LOOP_STEPS_PER_BAR; }

/** La durée d'un pas, en secondes (une double croche). */
export function stepSeconds(d){ return 60 / normalizeLoop(d).tempo / 4; }

/** La durée exacte de la boucle, en secondes. */
export function loopDuration(d){ return loopSteps(d) * stepSeconds(d); }

/**
 * Les problèmes d'une recette, en clair — pour le copilote, qui n'entend pas. Rien n'est bloquant :
 * `normalizeLoop` rend toujours une boucle jouable. On DIT ce qui a été corrigé ou ignoré.
 */
export function validateLoop(d){
  const p = [];
  if(!d || typeof d !== 'object' || Array.isArray(d)){ p.push('La recette doit être un objet JSON.'); return p; }
  const known = ['tempo', 'swing', 'bars', 'key', 'scale', 'drums', 'bass', 'melody', 'chords', 'volume'];
  Object.keys(d).forEach(function(k){ if(known.indexOf(k) === -1) p.push('Champ inconnu « ' + k + ' » : ignoré.'); });
  if(d.key !== undefined && keyIndex(d.key) === null) p.push('Tonalité inconnue « ' + d.key + ' » : C utilisé.');
  if(d.scale !== undefined && SCALE_NAMES.indexOf(d.scale) === -1){
    p.push('Gamme inconnue « ' + d.scale + ' ». Attendu : ' + SCALE_NAMES.join(', ') + '.');
  }
  const r = normalizeLoop(d);
  const total = r.bars * LOOP_STEPS_PER_BAR;
  const lanesIn = (d.drums && d.drums.lanes) || {};
  Object.keys(lanesIn).forEach(function(v){
    if(DRUM_VOICES.indexOf(v) === -1) p.push('Percussion inconnue « ' + v + ' ». Attendu : ' + DRUM_VOICES.join(', ') + '.');
    else {
      const n = String(lanesIn[v] || '').replace(/[\s|]/g, '').length;
      if(n > total) p.push('drums.' + v + ' : ' + n + ' pas pour une boucle de ' + total + ' — tronqué.');
    }
  });
  ['bass', 'melody', 'chords'].forEach(function(t){
    const inst = d[t] && d[t].instrument;
    if(inst !== undefined && INSTRUMENT_NAMES.indexOf(inst) === -1){
      p.push(t + ' : instrument inconnu « ' + inst + ' ». Attendu : ' + INSTRUMENT_NAMES.join(', ') + '.');
    }
  });
  ['bass', 'melody'].forEach(function(t){
    const text = (d[t] && d[t].notes) || '';
    const tk = tokens(text);
    const bad = tk.filter(function(x){
      const y = x.charAt(x.length - 1) === '!' ? x.slice(0, -1) : x;
      return y !== '.' && y !== '-' && noteToMidi(y) === null;
    });
    if(bad.length) p.push(t + ' : jetons illisibles (' + bad.slice(0, 5).join(', ') + ') — comptés comme silences.');
    if(tk.length > total) p.push(t + ' : ' + tk.length + ' pas pour une boucle de ' + total + ' — tronqué.');
    const off = parseNotes(text, total).filter(function(e){ return !inScale(e.midi, r.key, r.scale); });
    if(off.length){
      p.push(t + ' : ' + off.length + ' note(s) hors de la gamme ' + r.key + ' ' + r.scale + ' ('
        + off.slice(0, 4).map(function(e){ return midiToNote(e.midi); }).join(', ') + ').');
    }
  });
  const ch = tokens(r.chords.progression);
  const bad = ch.filter(function(c){ return c !== '.' && !parseChord(c); });
  if(bad.length) p.push('chords : symboles illisibles (' + bad.slice(0, 5).join(', ') + ') — ignorés.');
  const slots = r.bars * r.chords.perBar;
  if(ch.length && ch.length !== slots){
    p.push('chords : ' + ch.length + ' accord(s) pour ' + slots + ' emplacement(s) (' + r.bars
      + ' mesure(s) × ' + r.chords.perBar + ') — ' + (ch.length < slots ? 'répétés.' : 'tronqués.'));
  }
  return p;
}

// ---------- Le son ----------

/**
 * Un générateur à graine (LCG), le même que sfxRandom (js/chip-synth.js) — même suite pour une
 * même graine entière. Recopié À DESSEIN : music-loop.js n'importe rien et se charge seul.
 */
function random(seed){
  let g = (seed & 0x7fffffff) || 1;
  // `Math.imul` : voir sfxRandom (js/chip-synth.js) — le produit flottant tronquait le cycle.
  return function(){ g = (Math.imul(g, 1103515245) + 12345) & 0x7fffffff; return g / 0x7fffffff; };
}

/**
 * Additionne `src` dans `out` à partir de `at`, MODULO la longueur : la queue revient au début.
 * En deux boucles simples plutôt qu'un modulo par échantillon (revue du 2026-09-29, § 1.10).
 */
function mixInto(out, src, at, gain){
  const n = out.length;
  if(!n) return;
  let j = ((at % n) + n) % n;
  let i = 0;
  while(i < src.length){
    const bloc = Math.min(src.length - i, n - j);
    for(let k = 0; k < bloc; k++) out[j + k] += src[i + k] * gain;
    i += bloc;
    j = 0;
  }
}

// Une rampe de 1 ms à l'attaque et de 4 ms à la fin de tout son : sans elle, un son synthétisé qui
// démarre ou s'arrête ailleurs qu'à zéro produit un clic.
function fadeEdges(buf, sr){
  const a = Math.min(buf.length, Math.round(0.001 * sr));
  const r = Math.min(buf.length, Math.round(0.004 * sr));
  for(let i = 0; i < a; i++) buf[i] *= i / a;
  for(let i = 0; i < r; i++) buf[buf.length - 1 - i] *= i / r;
  return buf;
}

/** Un coup de percussion synthétisé. Déterministe : la graine du bruit dépend de la voix seule. */
export function drumSamples(voice, sr){
  const rnd = random(DRUM_VOICES.indexOf(voice) * 7919 + 101);
  const noise = function(){ return rnd() * 2 - 1; };
  const len = {kick: 0.45, snare: 0.25, closedHat: 0.06, openHat: 0.35, clap: 0.22,
               tomLow: 0.35, tomHigh: 0.3, cowbell: 0.25}[voice] || 0.2;
  const n = Math.round(len * sr);
  const out = new Float32Array(n);
  let phase = 0, phase2 = 0, lp = 0, hpX = 0, hpY = 0;
  const hp = function(x, a){ const y = a * (hpY + x - hpX); hpX = x; hpY = y; return y; };
  for(let i = 0; i < n; i++){
    const t = i / sr;
    let s = 0;
    if(voice === 'kick'){
      const f = 45 + 110 * Math.exp(-t * 28);
      phase += f / sr;
      s = Math.sin(2 * Math.PI * phase) * Math.exp(-t * 7) + noise() * 0.08 * Math.exp(-t * 200);
    } else if(voice === 'snare'){
      phase += 185 / sr;
      s = hp(noise(), 0.7) * 0.7 * Math.exp(-t * 18) + Math.sin(2 * Math.PI * phase) * 0.45 * Math.exp(-t * 22);
    } else if(voice === 'closedHat'){
      s = hp(noise(), 0.35) * 0.5 * Math.exp(-t * 70);
    } else if(voice === 'openHat'){
      s = hp(noise(), 0.35) * 0.4 * Math.exp(-t * 9);
    } else if(voice === 'clap'){
      // Trois claquements rapprochés puis la réverbération : c'est ce qui distingue un clap d'une caisse.
      const burst = (t < 0.03) ? Math.exp(-((t % 0.01) * 400)) : Math.exp(-(t - 0.03) * 22);
      lp += 0.35 * (noise() - lp);
      s = hp(lp, 0.8) * 0.9 * burst;
    } else if(voice === 'tomLow' || voice === 'tomHigh'){
      const base = voice === 'tomLow' ? 95 : 160;
      phase += (base + base * 0.5 * Math.exp(-t * 20)) / sr;
      s = Math.sin(2 * Math.PI * phase) * 0.8 * Math.exp(-t * 9);
    } else if(voice === 'cowbell'){
      phase += 540 / sr; phase2 += 800 / sr;
      const sq = ((phase % 1) < 0.5 ? 1 : -1) + ((phase2 % 1) < 0.5 ? 1 : -1);
      lp += 0.3 * (sq - lp);
      s = lp * 0.2 * Math.exp(-t * 14);
    }
    out[i] = s;
  }
  return fadeEdges(out, sr);
}

/** Une note jouée par un instrument : enveloppe ADSR, filtre passe-bas résonant, rampes anti-clic. */
export function noteSamples(instrument, midi, seconds, sr, accent){
  const ins = INSTRUMENTS[instrument] || INSTRUMENTS.lead;
  const hold = Math.max(0.01, seconds);
  const n = Math.round((hold + ins.release) * sr);
  const out = new Float32Array(n);
  const f = midiToHz(midi);
  const cutHz = Math.min(sr / 6, 80 * Math.pow(2, ins.cutoff * 8));
  const lpF = 2 * Math.sin(Math.PI * cutHz / sr);
  const lpQ = 1 - ins.resonance * 0.85;
  let low = 0, band = 0, phase = 0;
  const peak = accent ? 1.3 : 1;
  for(let i = 0; i < n; i++){
    const t = i / sr;
    phase += f / sr;
    if(phase >= 1) phase -= Math.floor(phase);
    let s;
    if(ins.wave === 'square') s = (phase < ins.duty) ? 1 : -1;
    else if(ins.wave === 'sawtooth') s = 2 * phase - 1;
    else if(ins.wave === 'triangle') s = 1 - 4 * Math.abs(phase - 0.5);
    else s = Math.sin(2 * Math.PI * phase);
    if(ins.cutoff < 1){
      low += lpF * band;
      band += lpF * (s - low - lpQ * band);
      s = low;
    }
    let env;
    if(t < ins.attack) env = t / ins.attack;
    else if(t < ins.attack + ins.decay) env = 1 - (1 - ins.sustain) * (t - ins.attack) / ins.decay;
    else env = ins.sustain;
    if(t >= hold){
      // Le relâchement part du niveau atteint, pas du maintien théorique : une note plus courte que
      // son attaque ne doit pas faire un saut vers le haut en se relâchant.
      const at = (hold < ins.attack) ? hold / ins.attack
        : (hold < ins.attack + ins.decay) ? 1 - (1 - ins.sustain) * (hold - ins.attack) / ins.decay : ins.sustain;
      env = at * Math.max(0, 1 - (t - hold) / ins.release);
    }
    out[i] = s * env * ins.gain * peak;
  }
  return fadeEdges(out, sr);
}

/** La position (en échantillons) d'un pas, swing compris : les pas impairs sont retardés. */
function stepAt(step, r, sr){
  const sec = 60 / r.tempo / 4;
  const swing = (step % 2 === 1) ? r.swing * sec * 0.66 : 0;
  return Math.round((step * sec + swing) * sr);
}

/**
 * Les échantillons de la boucle : `Float32Array` mono dans [-1, 1], de longueur EXACTE
 * `bars × 16 × durée d'un pas` — un tour de boucle, ni plus ni moins, pour qu'elle se reboucle juste.
 */
export function renderLoop(d, sampleRate){
  const r = normalizeLoop(d);
  const sr = Math.max(8000, Math.round(sampleRate || LOOP_SAMPLE_RATE));
  const total = r.bars * LOOP_STEPS_PER_BAR;
  const sec = 60 / r.tempo / 4;
  const n = Math.round(total * sec * sr);
  const out = new Float32Array(n);
  // UNE NOTE IDENTIQUE N'EST CALCULÉE QU'UNE FOIS. Une boucle de 4 mesures appelait `noteSamples`
  // 192 fois pour 13 notes distinctes : ~25 ms et ~12 Mo de tampons jetés à chaque clic dans la
  // grille (revue du 2026-09-29, § 1.10). Le résultat est identique à l'échantillon près.
  const notes = new Map();
  const noteSamplesCached = function(instrument, midi, seconds, accent){
    const key = instrument + '|' + midi + '|' + Math.round(seconds * sr) + '|' + (accent ? 1 : 0);
    let s = notes.get(key);
    if(!s){ s = noteSamples(instrument, midi, seconds, sr, accent); notes.set(key, s); }
    return s;
  };

  // Percussions : un coup calculé une fois par voix, recopié à chaque pas.
  const cache = {};
  Object.keys(r.drums.lanes).forEach(function(v){
    const hits = parseLane(r.drums.lanes[v], total);
    hits.forEach(function(h, step){
      if(!h) return;
      if(!cache[v]) cache[v] = drumSamples(v, sr);
      mixInto(out, cache[v], stepAt(step, r, sr), r.drums.volume * (h === 2 ? 1 : 0.7));
    });
  });

  ['bass', 'melody'].forEach(function(t){
    const tr = r[t];
    parseNotes(tr.notes, total).forEach(function(e){
      mixInto(out, noteSamplesCached(tr.instrument, e.midi, e.length * sec * 0.95, e.accent),
              stepAt(e.step, r, sr), tr.volume);
    });
  });

  // Accords : un par emplacement (une ou deux par mesure), voicés autour de l'octave demandée.
  const syms = tokens(r.chords.progression);
  if(syms.length){
    const slots = r.bars * r.chords.perBar;
    const slotSteps = total / slots;
    for(let k = 0; k < slots; k++){
      const c = parseChord(syms[k % syms.length]);
      if(!c) continue;
      const rootMidi = (r.chords.octave + 1) * 12 + c.root;
      const notes = c.intervals.map(function(iv){ return rootMidi + iv; });
      const g = r.chords.volume / Math.sqrt(notes.length);
      const s0 = k * slotSteps;
      if(r.chords.style === 'pad'){
        notes.forEach(function(m){
          mixInto(out, noteSamplesCached(r.chords.instrument, m, slotSteps * sec * 0.98, false), stepAt(s0, r, sr), g);
        });
      } else if(r.chords.style === 'stab'){
        for(let s = 0; s < slotSteps; s += 4){
          notes.forEach(function(m){
            mixInto(out, noteSamplesCached(r.chords.instrument, m, sec * 1.5, false), stepAt(s0 + s, r, sr), g);
          });
        }
      } else {
        // Arpège montant en doubles croches, puis l'octave : la forme la plus reconnaissable.
        const seq = notes.concat([notes[0] + 12]);
        for(let s = 0; s < slotSteps; s++){
          mixInto(out, noteSamplesCached(r.chords.instrument, seq[s % seq.length], sec * 0.9, false),
                  stepAt(s0 + s, r, sr), r.chords.volume * 0.8);
        }
      }
    }
  }

  // Le mélange : volume général puis saturation DOUCE plutôt qu'un écrêtage franc — plusieurs pistes
  // qui se cumulent sur un temps fort ne doivent pas craquer.
  for(let i = 0; i < n; i++) out[i] = Math.tanh(out[i] * r.volume);
  return out;
}

/** Un `AudioBuffer` mono prêt à jouer en boucle, sur le contexte de l'hôte. */
export function loopBuffer(ctx, recipe){
  const s = renderLoop(recipe, LOOP_SAMPLE_RATE);
  const buf = ctx.createBuffer(1, Math.max(1, s.length), LOOP_SAMPLE_RATE);
  if(typeof buf.copyToChannel === 'function') buf.copyToChannel(s, 0);
  else buf.getChannelData(0).set(s);
  return buf;
}

/** Ce qu'on ENTEND, en chiffres — pour le copilote. */
export function describeLoop(d){
  const r = normalizeLoop(d);
  const total = r.bars * LOOP_STEPS_PER_BAR;
  const hits = {};
  Object.keys(r.drums.lanes).forEach(function(v){
    hits[v] = parseLane(r.drums.lanes[v], total).filter(Boolean).length;
  });
  const range = function(ev){
    if(!ev.length) return null;
    const ms = ev.map(function(e){ return e.midi; });
    return midiToNote(Math.min.apply(null, ms)) + '–' + midiToNote(Math.max.apply(null, ms));
  };
  const mel = parseNotes(r.melody.notes, total), bass = parseNotes(r.bass.notes, total);
  const slots = r.bars * r.chords.perBar;
  const syms = tokens(r.chords.progression);
  const chords = [];
  for(let k = 0; syms.length && k < slots; k++) chords.push(syms[k % syms.length]);
  return {
    duration: Math.round(loopDuration(r) * 1000) / 1000,
    tempo: r.tempo, bars: r.bars, key: r.key, scale: r.scale,
    drumHits: hits,
    melody: {notes: mel.length, range: range(mel)},
    bass: {notes: bass.length, range: range(bass)},
    chords: chords
  };
}

/**
 * Change la tonalité et/ou la gamme en gardant la musique : les notes sont TRANSPOSÉES de l'écart
 * entre les deux toniques, puis recalées sur la nouvelle gamme ; chaque accord est remplacé par
 * l'accord du même DEGRÉ dans la nouvelle gamme (un I reste un I). Un accord hors gamme est transposé.
 */
export function retuneLoop(d, key, scale){
  const r = normalizeLoop(d);
  // Une tonalité ou une gamme ILLISIBLE est ignorée : sans cette garde, `key: 'H'` était normalisé
  // en Do et toute la boucle partait transposée, sans un mot.
  if(!key || keyIndex(key) === null) key = r.key;
  if(!scale || SCALE_NAMES.indexOf(scale) === -1) scale = r.scale;
  const to = normalizeLoop(Object.assign({}, r, {key: key, scale: scale}));
  const shift = ((keyIndex(to.key) - keyIndex(r.key)) + 12) % 12;
  const delta = shift > 6 ? shift - 12 : shift;     // la transposition la plus courte
  const moveNotes = function(text){
    return tokens(text).map(function(tok){
      const accent = tok.charAt(tok.length - 1) === '!';
      const m = noteToMidi(accent ? tok.slice(0, -1) : tok);
      if(m === null) return tok;
      return midiToNote(snapToScale(m + delta, to.key, to.scale)) + (accent ? '!' : '');
    }).join(' ');
  };
  const fromChords = diatonicChords(r.key, r.scale), toChords = diatonicChords(to.key, to.scale);
  const fromRoots = fromChords.map(function(c){ return parseChord(c).root; });
  const moveChord = function(sym){
    const c = parseChord(sym);
    if(!c) return sym;
    const deg = fromRoots.indexOf(c.root);
    if(deg !== -1){
      const target = parseChord(toChords[deg]);
      // Une septième reste une septième : on ne garde de l'accord cible que sa fondamentale et sa couleur.
      const q = (c.quality === '7' || c.quality === 'maj7' || c.quality === 'm7')
        ? (target.quality === 'm' ? 'm7' : target.quality === '' ? c.quality : target.quality)
        : target.quality;
      return chordName(target.root, q);
    }
    return chordName(c.root + delta, c.quality);
  };
  to.melody.notes = moveNotes(r.melody.notes);
  to.bass.notes = moveNotes(r.bass.notes);
  to.chords.progression = tokens(r.chords.progression).map(moveChord).join(' ');
  return to;
}

/** Fusion partielle : les pistes se fusionnent champ par champ, les lignes de percussion une à une. */
export function mergeLoop(base, patch){
  const out = normalizeLoop(base);
  if(!patch || typeof patch !== 'object') return out;
  Object.keys(patch).forEach(function(k){
    const v = patch[k];
    if((k === 'bass' || k === 'melody' || k === 'chords') && v && typeof v === 'object') Object.assign(out[k], v);
    else if(k === 'drums' && v && typeof v === 'object'){
      if(v.volume !== undefined) out.drums.volume = v.volume;
      if(v.lanes && typeof v.lanes === 'object') Object.assign(out.drums.lanes, v.lanes);
    } else out[k] = v;
  });
  return normalizeLoop(out);
}

// ---------- Les boucles de départ ----------
//
// Un « ＋ NOUVEAU » doit déjà sonner : une boucle vide ne donne aucune idée de ce que l'outil sait faire.

export const LOOP_PRESETS = {
  pop: function(){ return {
    tempo: 110, bars: 2, key: 'C', scale: 'major',
    drums: {volume: 0.9, lanes: {kick: 'x...x...x...x...', snare: '....x.......x...', closedHat: 'x.x.x.x.x.x.x.x.'}},
    bass: {instrument: 'bass', notes: 'C2 . . C2 . . C2 . G1 . . G1 . . G1 . A1 . . A1 . . A1 . F1 . . F1 . . G1 .'},
    melody: {instrument: 'lead', notes: 'E5 - . G5 . . D5 - . . . . . . . . C5 - . E5 . . A4 - . . C5 . . . . .'},
    chords: {instrument: 'pad', style: 'pad', perBar: 2, octave: 4, progression: 'C G Am F'}}; },
  chiptune: function(){ return {
    tempo: 140, bars: 2, key: 'A', scale: 'minor',
    drums: {volume: 0.8, lanes: {kick: 'x.....x...x.....', snare: '....X.......X...', closedHat: 'x.xxx.xxx.xxx.xx'}},
    bass: {instrument: 'chip', notes: 'A2 . A3 . A2 . A3 . F2 . F3 . F2 . F3 . C3 . C4 . C3 . C4 . G2 . G3 . G2 . G3 .'},
    melody: {instrument: 'chip', notes: 'A4 . C5 . E5 . A5 - G5 . E5 . C5 - . . A4 . C5 . F5 . E5 - D5 . B4 . G4 - . .'},
    chords: {instrument: 'organ', style: 'arp', perBar: 1, octave: 4, volume: 0.25, progression: 'Am F'}}; },
  lofi: function(){ return {
    tempo: 80, swing: 0.3, bars: 2, key: 'D', scale: 'dorian',
    drums: {volume: 0.75, lanes: {kick: 'x......x..x.....', snare: '....x.......x...', closedHat: 'x.x.x.x.x.x.x.xx'}},
    bass: {instrument: 'bass', notes: 'D2 - . . . . . . . . . . A1 - . . C2 - . . . . . . . . . . G1 - . .'},
    melody: {instrument: 'flute', notes: 'F4 - . A4 . . C5 - . . . . . . . . E4 - . G4 . . B4 - . . . . . . . .'},
    chords: {instrument: 'pad', style: 'pad', perBar: 1, octave: 4, progression: 'Dm7 Cmaj7'}}; }
};
export const LOOP_PRESET_NAMES = Object.keys(LOOP_PRESETS);

export function presetLoop(name){
  const make = LOOP_PRESETS[name];
  return make ? normalizeLoop(make()) : null;
}

// ---------- L'édition pas à pas (grilles du module BX-16) ----------
//
// Des fonctions PURES chaîne → chaîne : la grille du rack ne manipule jamais d'autre état que la
// recette elle-même, et chaque geste se vérifie dans un test. Une piste courte (un motif d'une mesure
// dans une boucle de quatre) est DÉPLIÉE à la première retouche : on édite ce qu'on entend.

/** Les jetons d'une piste sur exactement `total` pas (motif répété, excédent coupé, vide = silences). */
export function expandTokens(text, total){
  const t = tokens(text);
  const out = [];
  for(let i = 0; i < total; i++) out.push(t.length ? t[i % t.length] : '.');
  return out;
}

/** Une liste de jetons en chaîne lisible : un `|` entre les mesures. */
export function joinSteps(list){
  const bars = [];
  for(let i = 0; i < list.length; i += LOOP_STEPS_PER_BAR) bars.push(list.slice(i, i + LOOP_STEPS_PER_BAR).join(' '));
  return bars.join(' | ');
}

/** Pose un coup de percussion (0 rien, 1 coup, 2 accent) au pas `step`. */
export function setDrumStep(text, total, step, value){
  const lane = parseLane(text, total);
  lane[step] = value;
  const chars = lane.map(function(v){ return v === 2 ? 'X' : v === 1 ? 'x' : '.'; });
  const bars = [];
  for(let i = 0; i < chars.length; i += LOOP_STEPS_PER_BAR) bars.push(chars.slice(i, i + LOOP_STEPS_PER_BAR).join(''));
  return bars.join(' ');
}

function isNoteToken(tok){ return tok !== '.' && tok !== '-' && noteToMidi(tok.replace(/!$/, '')) !== null; }

/** La note qui SONNE au pas `step` (début ou tenue) : `{start, midi}` ou `null`. */
export function noteAt(list, step){
  for(let i = step; i >= 0; i--){
    const tok = list[i];
    if(tok === '-') continue;
    if(isNoteToken(tok)) return {start: i, midi: noteToMidi(tok.replace(/!$/, ''))};
    return null;
  }
  return null;
}

/**
 * Le clic sur une case de la grille : la note `midi` au pas `step`. Si cette note y sonne déjà, elle
 * est retirée avec sa tenue ; sinon elle remplace ce qui s'y trouvait (piste monophonique).
 */
export function toggleNoteAt(text, total, step, midi){
  const list = expandTokens(text, total);
  const here = noteAt(list, step);
  if(here && here.midi === midi){
    list[here.start] = '.';
    for(let i = here.start + 1; i < total && list[i] === '-'; i++) list[i] = '.';
  } else {
    // Une tenue qui passait par ce pas est coupée ici : la nouvelle note prend la place, SANS hériter
    // de la suite de la tenue — les `-` qui suivaient appartenaient à l'ancienne note.
    list[step] = midiToNote(midi);
    for(let i = step + 1; i < total && list[i] === '-'; i++) list[i] = '.';
  }
  return joinSteps(list);
}

/**
 * Maj+clic : TENIR jusqu'ici la dernière note de cette hauteur qui commence avant `step`. Rend la
 * chaîne inchangée s'il n'y en a pas.
 */
export function holdNoteTo(text, total, step, midi){
  const list = expandTokens(text, total);
  for(let i = step - 1; i >= 0; i--){
    if(isNoteToken(list[i])){
      // La note la plus proche avant ce pas doit être CELLE-CI : tenir par-dessus une autre note
      // l'effaçait sans signal. Une autre hauteur au milieu arrête le geste.
      if(noteToMidi(list[i].replace(/!$/, '')) !== midi) return String(text || '');
      for(let j = i + 1; j <= step; j++) list[j] = '-';
      return joinSteps(list);
    }
  }
  return String(text || '');
}

/** Les accords par emplacement (`bars × perBar`), motif répété — `'.'` pour un emplacement vide. */
export function chordSlots(progression, bars, perBar){
  return expandTokens(progression, bars * perBar);
}

/** Change l'accord d'un emplacement. */
export function setChordAt(progression, bars, perBar, index, symbol){
  const slots = chordSlots(progression, bars, perBar);
  slots[index] = symbol || '.';
  return slots.join(' ');
}

/**
 * CLEAR SONG : vide toutes les pistes — percussions, basse, mélodie, accords — et GARDE le cadre
 * (tempo, swing, mesures, tonalité, gamme, instruments, volumes). On repart d'une page blanche dans
 * le même décor, sans avoir à tout re-régler.
 */
export function clearLoop(d){
  const r = normalizeLoop(d);
  r.drums.lanes = {};
  r.bass.notes = '';
  r.melody.notes = '';
  r.chords.progression = '';
  return r;
}
