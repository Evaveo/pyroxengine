// ---------- Le synthé à bruitages : une RECETTE devient un son ----------
//
// Le moteur du module SX-1 du Rack sonore (docs/superpowers/specs/2026-09-28-sound-rack-v1-design.md).
// js/proc-sound.js savait fabriquer six bruitages FIGÉS ; le WAV produit perdait sa recette, donc on ne
// pouvait ni dire « le même, un peu plus grave », ni le retoucher. Ici l'asset `sfx` GARDE sa recette
// — un objet JSON plat, dans l'esprit de sfxr — et le son en est calculé à chaque chargement.
//
// TROIS PROPRIÉTÉS, et tout le fichier est écrit pour elles :
//   1. JS PUR. Ni DOM, ni THREE, ni AudioContext pour le calcul : `renderSfx` rend un `Float32Array`.
//      Seul `toAudioBuffer` reçoit un contexte, en paramètre. Tout se vérifie donc dans un test.
//   2. DÉTERMINISTE. Même recette, même graine → mêmes échantillons, octet pour octet. Le bruit vient
//      d'un générateur à graine, jamais de Math.random : c'est ce qui permet au copilote de dire « la
//      graine 7 » et à l'auteur d'entendre la même chose que lui.
//   3. PARTAGÉ. L'éditeur et le jeu publié exécutent CE fichier. Un bruitage recalculé par deux codes
//      différents sonnerait autrement chez le joueur, et une divergence de son ne se voit pas.
//
// Les règles d'écoute héritées de proc-sound.js, et gardées par test/chip-synth.test.mjs :
//   · une attaque et une extinction JAMAIS nulles — un son qui démarre à pleine amplitude CLAQUE ;
//   · les glissements de hauteur intégrés en PHASE — recalculer `sin(f·t)` avec un `f` qui bouge
//     fait des ruptures, un grésillement ;
//   · un écrêtage franc avant la sortie — le 16 bits transforme un dépassement en craquement.

export const SFX_SAMPLE_RATE = 22050;   // un bruitage court n'a rien à gagner à 48 kHz, et pèse le double
export const SFX_MAX_DURATION = 5;      // au-delà ce n'est plus un bruitage : on importe un vrai fichier
export const SFX_WAVES = ['square', 'triangle', 'sawtooth', 'sine', 'noise'];

// Les défauts : un bip carré court et propre. Un champ absent ou illisible retombe ICI, jamais sur
// un silence — une recette à moitié écrite par une IA doit rester jouable.
export const SFX_DEFAULT = {
  wave: 'square',
  duty: 0.5,
  pitch:    {start: 440, slide: 0, slideAccel: 0, min: 20},
  vibrato:  {depth: 0, speed: 6},
  arpeggio: {semitones: 0, at: 0.5},
  envelope: {attack: 0.005, sustain: 0.08, punch: 0, decay: 0.15},
  filter:   {lowpass: 1, resonance: 0, highpass: 0},
  crush:    {bits: 16, downsample: 1},
  repeat: 0,
  volume: 0.7,
  seed: 1
};

// Les bornes de chaque champ numérique : [min, max]. UNE table, lue par la normalisation, la
// validation, la mutation et l'interface — quatre endroits qui doivent dire la même chose.
export const SFX_BOUNDS = {
  duty: [0.05, 0.5],
  'pitch.start': [20, 8000],
  'pitch.slide': [-96, 96],            // demi-tons par seconde
  'pitch.slideAccel': [-400, 400],     // demi-tons par seconde²
  'pitch.min': [20, 8000],
  'vibrato.depth': [0, 12],            // demi-tons
  'vibrato.speed': [0, 40],            // Hz
  'arpeggio.semitones': [-24, 24],
  'arpeggio.at': [0, 1],               // fraction de la durée
  'envelope.attack': [0.002, 2],       // 2 ms minimum : c'est ce qui empêche le clic
  'envelope.sustain': [0, 2],
  'envelope.punch': [0, 1],
  'envelope.decay': [0.01, 3],         // 10 ms minimum, pour la même raison à la fin
  'filter.lowpass': [0, 1],            // 1 = ouvert
  'filter.resonance': [0, 1],
  'filter.highpass': [0, 1],           // 0 = aucun
  'crush.bits': [1, 16],
  'crush.downsample': [1, 16],
  repeat: [0, 1],                      // secondes ; 0 = pas de relance
  volume: [0, 1],
  seed: [0, 2147483647]
};

const GROUPS = ['pitch', 'vibrato', 'arpeggio', 'envelope', 'filter', 'crush'];
const INTEGER_FIELDS = {'crush.bits': 1, 'crush.downsample': 1, seed: 1};

/** La valeur au chemin pointé `p` (« pitch.slide ») d'une recette, ou undefined. */
export function readPath(o, p){
  const parts = p.split('.');
  let v = o;
  for(let i = 0; i < parts.length; i++){ if(!v || typeof v !== 'object') return undefined; v = v[parts[i]]; }
  return v;
}
function writePath(o, p, v){
  const parts = p.split('.');
  if(parts.length === 1){ o[p] = v; return; }
  o[parts[0]][parts[1]] = v;
}
function clampField(p, v, fallback){
  const n = Number(v);
  if(v === null || v === undefined || v === '' || typeof v === 'boolean' || !isFinite(n)) return fallback;
  const b = SFX_BOUNDS[p];
  let out = Math.max(b[0], Math.min(b[1], n));
  if(INTEGER_FIELDS[p]) out = Math.round(out);
  return out;
}

/** Une copie profonde des défauts — jamais la référence, qu'un appelant pourrait muter. */
export function sfxDefault(){ return JSON.parse(JSON.stringify(SFX_DEFAULT)); }

/**
 * LA recette jouable tirée de n'importe quelle entrée. Le SEUL point qui décide des défauts
 * (même rôle que `normalizeVoice` dans js/synth.js).
 */
export function normalizeSfx(d){
  const src = (d && typeof d === 'object') ? d : {};
  const out = sfxDefault();
  out.wave = (SFX_WAVES.indexOf(src.wave) !== -1) ? src.wave : SFX_DEFAULT.wave;
  Object.keys(SFX_BOUNDS).forEach(function(p){
    writePath(out, p, clampField(p, readPath(src, p), readPath(SFX_DEFAULT, p)));
  });
  // UNE ENVELOPPE TIENT DANS 5 S. Chaque champ est dans ses bornes, mais leur somme peut dépasser la
  // durée maximale : le son était alors coupé net en pleine extinction — le clic que ce fichier
  // interdit. On raccourcit le maintien d'abord, puis l'extinction, jamais l'attaque.
  const e = out.envelope;
  let excess = e.attack + e.sustain + e.decay - SFX_MAX_DURATION;
  if(excess > 0){
    const cut = Math.min(e.sustain, excess);
    e.sustain -= cut; excess -= cut;
    if(excess > 0) e.decay = Math.max(SFX_BOUNDS['envelope.decay'][0], e.decay - excess);
  }
  return out;
}

/** La durée d'une recette, en secondes : elle se DÉDUIT de l'enveloppe, elle ne se saisit pas. */
export function sfxDuration(d){
  const e = normalizeSfx(d).envelope;
  return Math.min(SFX_MAX_DURATION, e.attack + e.sustain + e.decay);
}

/**
 * Les problèmes d'une recette, en clair — pour le copilote, qui n'entend pas le résultat.
 * Rien n'y est bloquant : `normalizeSfx` rend toujours un son. On DIT ce qui a été corrigé.
 */
export function validateSfx(d){
  const p = [];
  if(!d || typeof d !== 'object' || Array.isArray(d)){
    p.push('La recette doit être un objet JSON.');
    return p;
  }
  if(d.wave !== undefined && SFX_WAVES.indexOf(d.wave) === -1){
    p.push('Onde inconnue : « ' + d.wave + ' ». Attendu ' + SFX_WAVES.join(', ') + '.');
  }
  const connus = ['wave', 'duty', 'repeat', 'volume', 'seed'].concat(GROUPS);
  Object.keys(d).forEach(function(k){
    if(connus.indexOf(k) === -1) p.push('Champ inconnu « ' + k + ' » : ignoré.');
  });
  GROUPS.forEach(function(g){
    const v = d[g];
    if(v === undefined) return;
    if(!v || typeof v !== 'object'){ p.push('« ' + g + ' » doit être un objet.'); return; }
    Object.keys(v).forEach(function(k){
      if(!SFX_BOUNDS[g + '.' + k]) p.push('Champ inconnu « ' + g + '.' + k + ' » : ignoré.');
    });
  });
  Object.keys(SFX_BOUNDS).forEach(function(path){
    const v = readPath(d, path);
    if(v === undefined) return;
    const n = Number(v);
    const b = SFX_BOUNDS[path];
    if(typeof v === 'boolean' || !isFinite(n)) p.push('« ' + path + ' » n\'est pas un nombre : défaut utilisé.');
    else if(n < b[0] || n > b[1]) p.push('« ' + path + ' » = ' + n + ' hors bornes [' + b[0] + ', ' + b[1] + '] : ramené dedans.');
  });
  const e = d.envelope || {};
  const total = (Number(e.attack) || 0) + (Number(e.sustain) || 0) + (Number(e.decay) || 0);
  if(total > SFX_MAX_DURATION){
    p.push('Enveloppe de ' + total.toFixed(2) + ' s : un bruitage est coupé à ' + SFX_MAX_DURATION
      + ' s. Au-delà, importez un vrai fichier.');
  }
  return p;
}

/** Un générateur à graine (LCG). Deux appels de même graine rendent la même suite. */
export function sfxRandom(seed){
  let g = (Math.round(Number(seed)) || 1) & 0x7fffffff;
  if(!g) g = 1;
  // `Math.imul` et pas `*` : le produit dépasse 2^53, les bits bas se perdaient avant le masque et la
  // suite retombait dans un cycle d'environ 10 000 valeurs — un bruit qui se répétait. Le calcul
  // 32 bits exact garde le déterminisme (revue du 2026-09-29, § 3.11).
  return function(){
    g = (Math.imul(g, 1103515245) + 12345) & 0x7fffffff;
    return g / 0x7fffffff;
  };
}

// Le gain propre de chaque onde : à amplitude égale, une carrée paraît deux fois plus forte qu'une
// sinusoïde. Sans cette table, changer d'onde changerait le volume, et on le « corrigerait » à côté.
const WAVE_GAIN = {square: 0.5, sawtooth: 0.6, triangle: 0.9, sine: 0.9, noise: 0.6};

/** La hauteur, en Hz, à l'instant `t` (secondes). Partagée par le rendu et par `describeSfx`. */
function pitchAt(r, t, duration){
  const tp = (r.repeat > 0) ? (t % r.repeat) : t;
  let semis = r.pitch.slide * tp + 0.5 * r.pitch.slideAccel * tp * tp;
  if(r.arpeggio.semitones && t >= r.arpeggio.at * duration) semis += r.arpeggio.semitones;
  if(r.vibrato.depth > 0) semis += r.vibrato.depth * Math.sin(2 * Math.PI * r.vibrato.speed * t);
  const f = r.pitch.start * Math.pow(2, semis / 12);
  return Math.max(r.pitch.min, Math.min(8000, f));
}

/** Le gain de l'enveloppe à l'instant `t` : attaque linéaire, maintien (avec punch), extinction. */
function envelopeAt(e, t){
  if(t < e.attack) return t / e.attack;
  const ts = t - e.attack;
  if(ts < e.sustain) return 1 + e.punch * (1 - ts / Math.max(1e-9, e.sustain));
  const td = ts - e.sustain;
  if(td < e.decay) return 1 - td / e.decay;
  return 0;
}

/**
 * Les échantillons d'une recette : `Float32Array` mono dans [-1, 1], à `sampleRate` (défaut 22 050).
 */
export function renderSfx(d, sampleRate){
  const r = normalizeSfx(d);
  const sr = Math.max(8000, Math.round(sampleRate || SFX_SAMPLE_RATE));
  const duration = Math.max(0.02, sfxDuration(r));
  const n = Math.round(duration * sr);
  const out = new Float32Array(n);
  const rnd = sfxRandom(r.seed);
  const gainWave = WAVE_GAIN[r.wave];

  let phase = 0;
  let noiseValue = rnd() * 2 - 1;
  // Filtre passe-bas à variable d'état (Chamberlin) : une coupure et une résonance, ce qu'il faut
  // pour qu'une explosion sonne sourde et un laser « miaule ». Bornée à sr/6 : au-delà ce filtre
  // devient instable, et 1 = ouvert le contourne tout à fait.
  const lpOn = r.filter.lowpass < 1;
  const lpHz = Math.min(sr / 6, 40 * Math.pow(2, r.filter.lowpass * 9));
  const lpF = 2 * Math.sin(Math.PI * lpHz / sr);
  const lpQ = 1 - r.filter.resonance * 0.9;
  let low = 0, band = 0;
  // Passe-haut à un pôle : enlève le grave, pour un clic ou un pas léger.
  const hpOn = r.filter.highpass > 0;
  const hpHz = 20 * Math.pow(2, r.filter.highpass * 9);
  const hpA = 1 / (1 + 2 * Math.PI * hpHz / sr);
  let hpX = 0, hpY = 0;
  // Le grain 8-bit, explicitement : échantillons tenus (`downsample`) et quantifiés (`bits`).
  const steps = Math.pow(2, r.crush.bits - 1);
  let held = 0;

  for(let i = 0; i < n; i++){
    const t = i / sr;
    const f = pitchAt(r, t, duration);
    phase += f / sr;
    let wrapped = false;
    if(phase >= 1){ phase -= Math.floor(phase); wrapped = true; }

    let s;
    if(r.wave === 'square') s = (phase < r.duty) ? 1 : -1;
    else if(r.wave === 'sawtooth') s = 2 * phase - 1;
    else if(r.wave === 'triangle') s = 1 - 4 * Math.abs(phase - 0.5);
    else if(r.wave === 'sine') s = Math.sin(2 * Math.PI * phase);
    else {
      // Le bruit est TENU d'une période à l'autre : sa hauteur règle sa couleur, grave pour une
      // explosion, aigu pour un souffle. C'est le bruit des consoles 8-bit, pas un bruit blanc.
      if(wrapped) noiseValue = rnd() * 2 - 1;
      s = noiseValue;
    }
    s *= gainWave;

    if(lpOn){
      low += lpF * band;
      const high = s - low - lpQ * band;
      band += lpF * high;
      s = low;
    }
    if(hpOn){
      const y = hpA * (hpY + s - hpX);
      hpX = s; hpY = y; s = y;
    }
    if(r.crush.downsample > 1){
      if(i % r.crush.downsample === 0) held = s;
      s = held;
    }
    if(r.crush.bits < 16) s = Math.round(s * steps) / steps;

    s *= envelopeAt(r.envelope, t) * r.volume;
    out[i] = Math.max(-1, Math.min(1, s));
  }
  // L'extinction linéaire finit à zéro, mais la quantification peut laisser un palier non nul :
  // le DERNIER échantillon est forcé à zéro, sinon la boucle d'un son répété claquerait.
  if(n) out[n - 1] = 0;
  return out;
}

/** Un `AudioBuffer` mono prêt à jouer, sur le contexte de l'hôte. */
export function toAudioBuffer(ctx, samples, sampleRate){
  const sr = Math.round(sampleRate || SFX_SAMPLE_RATE);
  const buf = ctx.createBuffer(1, Math.max(1, samples.length), sr);
  if(typeof buf.copyToChannel === 'function') buf.copyToChannel(samples, 0);
  else buf.getChannelData(0).set(samples);
  return buf;
}

/** Le son d'une recette, directement en `AudioBuffer` — ce qu'éditeur et runtime appellent. */
export function sfxBuffer(ctx, recipe){
  return toAudioBuffer(ctx, renderSfx(recipe, SFX_SAMPLE_RATE), SFX_SAMPLE_RATE);
}

/**
 * Ce qu'on ENTEND, en chiffres. Le copilote n'écoute pas : sans ce retour il ne saurait pas s'il a
 * obtenu un saut qui monte ou un son qui descend.
 */
export function describeSfx(d){
  const r = normalizeSfx(d);
  const duration = Math.max(0.02, sfxDuration(r));
  const samples = renderSfx(r, SFX_SAMPLE_RATE);
  let peak = 0;
  for(let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  const fEnd = pitchAt(Object.assign({}, r, {vibrato: {depth: 0, speed: 0}}), duration * 0.999, duration);
  return {
    wave: r.wave,
    duration: Math.round(duration * 1000) / 1000,
    startHz: Math.round(r.pitch.start),
    endHz: Math.round(fEnd),
    peak: Math.round(peak * 100) / 100,
    seed: r.seed
  };
}

// ---------- Les presets ----------
//
// Chaque preset est une FONCTION DE LA GRAINE : « 🎲 Saut » donne un nouveau saut à chaque tirage, pas
// le même. Les plages sont celles qu'on entend comme le genre — un saut MONTE, un laser DESCEND vite,
// une pièce saute d'un intervalle consonant.

function pick(rnd, a, b){ return a + (b - a) * rnd(); }
function choose(rnd, list){ return list[Math.floor(rnd() * list.length) % list.length]; }

export const SFX_PRESETS = {
  jump: function(rnd){ return {
    wave: choose(rnd, ['square', 'square', 'triangle']), duty: choose(rnd, [0.25, 0.5]),
    pitch: {start: pick(rnd, 260, 420), slide: pick(rnd, 24, 48)},
    envelope: {attack: 0.005, sustain: pick(rnd, 0.04, 0.1), punch: 0, decay: pick(rnd, 0.12, 0.25)}}; },
  coin: function(rnd){ return {
    wave: 'square', duty: choose(rnd, [0.25, 0.5]),
    pitch: {start: pick(rnd, 880, 1320)},
    arpeggio: {semitones: choose(rnd, [5, 7, 12]), at: pick(rnd, 0.2, 0.45)},
    envelope: {attack: 0.003, sustain: pick(rnd, 0.04, 0.08), punch: pick(rnd, 0.3, 0.6), decay: pick(rnd, 0.2, 0.35)}}; },
  laser: function(rnd){ return {
    wave: choose(rnd, ['sawtooth', 'square']), duty: pick(rnd, 0.1, 0.4),
    pitch: {start: pick(rnd, 900, 1700), slide: -pick(rnd, 75, 96), slideAccel: -pick(rnd, 40, 160), min: 60},
    envelope: {attack: 0.003, sustain: pick(rnd, 0.03, 0.08), punch: pick(rnd, 0, 0.3), decay: pick(rnd, 0.12, 0.22)}}; },
  explosion: function(rnd){ return {
    wave: 'noise',
    pitch: {start: pick(rnd, 60, 180), slide: -pick(rnd, 6, 24)},
    envelope: {attack: 0.004, sustain: pick(rnd, 0.08, 0.2), punch: pick(rnd, 0.4, 0.8), decay: pick(rnd, 0.4, 0.8)},
    filter: {lowpass: pick(rnd, 0.55, 0.8), resonance: pick(rnd, 0, 0.3)}}; },
  hit: function(rnd){ return {
    wave: choose(rnd, ['noise', 'square', 'sawtooth']),
    pitch: {start: pick(rnd, 250, 700), slide: -pick(rnd, 40, 80)},
    envelope: {attack: 0.002, sustain: pick(rnd, 0.01, 0.04), punch: pick(rnd, 0.2, 0.5), decay: pick(rnd, 0.08, 0.16)}}; },
  powerUp: function(rnd){ return {
    wave: choose(rnd, ['square', 'triangle']), duty: 0.5,
    pitch: {start: pick(rnd, 280, 480), slide: pick(rnd, 18, 36)},
    vibrato: {depth: pick(rnd, 0.2, 0.6), speed: pick(rnd, 8, 16)},
    repeat: choose(rnd, [0, pick(rnd, 0.08, 0.14)]),
    envelope: {attack: 0.005, sustain: pick(rnd, 0.2, 0.35), punch: 0, decay: pick(rnd, 0.2, 0.3)}}; },
  blip: function(rnd){ return {
    wave: choose(rnd, ['square', 'sine']), duty: 0.5,
    pitch: {start: pick(rnd, 600, 1100)},
    envelope: {attack: 0.003, sustain: pick(rnd, 0.03, 0.06), punch: 0, decay: pick(rnd, 0.03, 0.08)}}; },
  step: function(rnd){ return {
    wave: 'noise',
    pitch: {start: pick(rnd, 150, 400), slide: -pick(rnd, 0, 20)},
    envelope: {attack: 0.002, sustain: pick(rnd, 0.005, 0.02), punch: pick(rnd, 0, 0.3), decay: pick(rnd, 0.04, 0.08)},
    filter: {lowpass: pick(rnd, 0.45, 0.62), highpass: pick(rnd, 0, 0.15)}, volume: 0.55}; }
};

export const SFX_PRESET_NAMES = Object.keys(SFX_PRESETS);

/** La recette d'un preset, pour une graine donnée. Rend `null` pour un preset inconnu. */
export function presetSfx(name, seed){
  const make = SFX_PRESETS[name];
  if(!make) return null;
  const s = (Math.round(Number(seed)) || 1);
  const r = make(sfxRandom(s * 7919 + 17));
  r.seed = s;
  return normalizeSfx(r);
}

/** Fusionne une recette PARTIELLE dans une recette complète (champ par champ, un niveau de groupe). */
export function mergeSfx(base, patch){
  const out = normalizeSfx(base);
  if(!patch || typeof patch !== 'object') return out;
  Object.keys(patch).forEach(function(k){
    const v = patch[k];
    if(GROUPS.indexOf(k) !== -1 && v && typeof v === 'object') Object.assign(out[k], v);
    else out[k] = v;
  });
  return normalizeSfx(out);
}

/**
 * Une variante VOISINE : chaque réglage bouge d'au plus `amount` × 30 % de sa plage. L'onde reste :
 * muter un saut doit rendre un autre saut, pas un bruit. La graine du bruit change aussi.
 */
export function mutateSfx(d, amount, seed){
  const r = normalizeSfx(d);
  const a = Math.max(0, Math.min(1, amount === undefined ? 0.3 : Number(amount) || 0));
  const rnd = sfxRandom((Math.round(Number(seed)) || 1) * 104729 + 3);
  Object.keys(SFX_BOUNDS).forEach(function(p){
    if(p === 'seed' || p === 'pitch.min') return;
    const b = SFX_BOUNDS[p];
    const v = readPath(r, p);
    // La HAUTEUR bouge en octaves, pas en hertz : ±700 Hz, c'est un détail pour un laser à 1 500 Hz
    // et un autre son pour un saut à 300 Hz. À `amount` = 1, au plus une octave dans chaque sens.
    if(p === 'pitch.start'){ writePath(r, p, v * Math.pow(2, (rnd() * 2 - 1) * a)); return; }
    if(p === 'vibrato.speed' && !r.vibrato.depth) return;
    if(p === 'arpeggio.at' && !r.arpeggio.semitones) return;
    // Un effet ÉTEINT le reste : muter ne doit pas faire apparaître un vibrato ou un filtre qu'on
    // n'avait pas demandé — la variante changerait de nature.
    if((p === 'vibrato.depth' || p === 'arpeggio.semitones' || p === 'filter.highpass' || p === 'repeat') && !v) return;
    if(p === 'filter.lowpass' && v >= 1) return;
    if(p === 'crush.bits' && v >= 16) return;
    if(p === 'crush.downsample' && v <= 1) return;
    writePath(r, p, v + (rnd() * 2 - 1) * a * 0.3 * (b[1] - b[0]));
  });
  r.seed = Math.floor(rnd() * 1000000) + 1;
  return normalizeSfx(r);
}
