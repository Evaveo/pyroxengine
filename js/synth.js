// moteur/js/synth.js
//
// Synthé temps réel et voix parlée — module PARTAGÉ éditeur/jeu publié.
//
// Le pendant « en direct » de js/proc-sound.js. proc-sound fabrique des fichiers WAV à
// l'avance ; ici on joue une NOTE décrite par des données, au moment où le jeu la demande.
// C'est ce qu'il faut à un jeu musical : une note dont la hauteur ou le timbre se règlent dans
// le fichier de scène, sans réimporter d'asset.
//
// TOUT EST DONNÉE. Une voix est un objet JSON plat (onde, fréquence, enveloppe, harmoniques),
// sérialisé tel quel dans le composant Synthesizer : on peut l'éditer à la main dans le
// `.scene.json`. `normalizeVoice` est le seul point qui décide des défauts — un champ absent ou
// faux retombe sur une valeur jouable, jamais sur un silence.
//
// Aucun DOM, aucun THREE : la partie Web Audio reçoit son `AudioContext` en paramètre, ce qui
// permet de la tester avec un faux contexte.

export const SYNTH_WAVES = ['sine', 'triangle', 'square', 'sawtooth'];

export const SYNTH_VOICE_DEFAULT = {
  id: 'note',
  label: 'Note',
  wave: 'triangle',
  frequency: 440,
  duration: 0.5,      // secondes, extinction comprise
  attack: 0.01,
  decay: 0.08,
  sustain: 0.6,       // fraction du gain tenue après la décroissance
  release: 0.25,
  gain: 0.8,
  detune: 0,          // cents
  vibratoRate: 0,     // Hz
  vibratoDepth: 0,    // cents
  glide: 1,           // rapport de fréquence atteint en fin de glissé (1 = pas de glissé)
  glideTime: 0.2,     // secondes
  overtones: [],      // [{ratio: 2, gain: 0.3}]
  meta: {}            // libre, pour le jeu : couleur, forme… (lu par api.notes)
};

export const SYNTH_DEFAULT = {
  volume: 0.7,
  voices: []
};

function num(v, def, min, max){
  const n = Number(v);
  if(v === null || v === undefined || v === '' || !Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}

/** Une voix complète et bornée, à partir de données éventuellement partielles ou éditées à la main. */
export function normalizeVoice(v, index){
  const d = SYNTH_VOICE_DEFAULT;
  const s = v || {};
  const id = (typeof s.id === 'string' && s.id.trim()) ? s.id.trim() : ('note' + ((index || 0) + 1));
  return {
    id: id,
    label: (typeof s.label === 'string' && s.label) ? s.label : id,
    wave: SYNTH_WAVES.indexOf(s.wave) >= 0 ? s.wave : d.wave,
    frequency: num(s.frequency, d.frequency, 20, 20000),
    duration: num(s.duration, d.duration, 0.02, 30),
    attack: num(s.attack, d.attack, 0.001, 10),
    decay: num(s.decay, d.decay, 0, 10),
    sustain: num(s.sustain, d.sustain, 0, 1),
    release: num(s.release, d.release, 0.005, 10),
    gain: num(s.gain, d.gain, 0, 2),
    detune: num(s.detune, d.detune, -2400, 2400),
    vibratoRate: num(s.vibratoRate, d.vibratoRate, 0, 40),
    vibratoDepth: num(s.vibratoDepth, d.vibratoDepth, 0, 1200),
    glide: num(s.glide, d.glide, 0.05, 20),
    glideTime: num(s.glideTime, d.glideTime, 0.001, 10),
    meta: (s.meta && typeof s.meta === "object" && !Array.isArray(s.meta)) ? s.meta : {},
    overtones: (Array.isArray(s.overtones) ? s.overtones : []).map(function(h){
      return {ratio: num(h && h.ratio, 2, 0.1, 32), gain: num(h && h.gain, 0.3, 0, 2)};
    })
  };
}

export function normalizeSynth(data){
  const s = data || {};
  return {
    volume: num(s.volume, SYNTH_DEFAULT.volume, 0, 2),
    voices: (Array.isArray(s.voices) ? s.voices : []).map(normalizeVoice)
  };
}

export function voiceOf(synth, id){
  const voices = (synth && synth.voices) || [];
  for(let i = 0; i < voices.length; i++) if(voices[i] && voices[i].id === id) return voices[i];
  return null;
}

/**
 * Les points de l'enveloppe de gain, en secondes depuis le début de la note : [[t, gain], ...].
 * La note ne commence ni ne finit jamais à pleine amplitude (voir js/proc-sound.js : ça claque).
 * Si la durée est plus courte qu'attaque + décroissance + extinction, les trois phases sont
 * comprimées proportionnellement plutôt que tronquées.
 */
export function envelopePoints(voice, volume){
  const v = normalizeVoice(voice);
  const peak = v.gain * (volume === undefined ? 1 : volume);
  let a = v.attack, d = v.decay, r = v.release;
  const sum = a + d + r;
  if(sum > v.duration){ const k = v.duration / sum; a *= k; d *= k; r *= k; }
  const holdEnd = v.duration - r;
  return [[0, 0], [a, peak], [a + d, peak * v.sustain], [holdEnd, peak * v.sustain], [v.duration, 0]];
}

/**
 * Joue une voix sur un AudioContext. `opts` : {volume, when (s, relatif), pitch (multiplicateur),
 * destination}. Rend un handle {stop(), endsAt} ou null si le contexte manque.
 */
export function playVoice(ctx, voice, opts){
  if(!ctx || typeof ctx.createOscillator !== 'function') return null;
  const o = opts || {};
  const v = normalizeVoice(voice);
  const t0 = ctx.currentTime + Math.max(0, Number(o.when) || 0);
  const pitch = num(o.pitch, 1, 0.05, 20);
  const dest = o.destination || ctx.destination;

  const amp = ctx.createGain();
  const pts = envelopePoints(v, o.volume === undefined ? 1 : o.volume);
  amp.gain.setValueAtTime(0, t0);
  for(let i = 1; i < pts.length; i++) amp.gain.linearRampToValueAtTime(pts[i][1], t0 + pts[i][0]);
  amp.connect(dest);

  const partials = [{ratio: 1, gain: 1}].concat(v.overtones);
  const oscs = [];
  let lfo = null, depth = null;
  if(v.vibratoRate > 0 && v.vibratoDepth > 0){
    lfo = ctx.createOscillator();
    lfo.frequency.setValueAtTime(v.vibratoRate, t0);
    depth = ctx.createGain();
    depth.gain.setValueAtTime(v.vibratoDepth, t0);
    lfo.connect(depth);
  }
  partials.forEach(function(p){
    const osc = ctx.createOscillator();
    osc.type = v.wave;
    osc.frequency.setValueAtTime(v.frequency * p.ratio * pitch, t0);
    // Le glissé (une goutte qui tombe) : exponentiel, comme l'oreille entend la hauteur.
    if(v.glide !== 1) osc.frequency.exponentialRampToValueAtTime(v.frequency * p.ratio * pitch * v.glide, t0 + v.glideTime);
    osc.detune.setValueAtTime(v.detune, t0);
    if(depth) depth.connect(osc.detune);
    const g = ctx.createGain();
    g.gain.setValueAtTime(p.gain, t0);
    osc.connect(g);
    g.connect(amp);
    osc.start(t0);
    osc.stop(t0 + v.duration + 0.05);
    oscs.push(osc);
  });
  if(lfo){ lfo.start(t0); lfo.stop(t0 + v.duration + 0.05); }

  return {
    endsAt: t0 + v.duration,
    stop: function(){
      const now = ctx.currentTime;
      try{
        amp.gain.cancelScheduledValues(now);
        amp.gain.setValueAtTime(amp.gain.value, now);
        amp.gain.linearRampToValueAtTime(0, now + 0.03);
      } catch(e){}
      oscs.concat(lfo ? [lfo] : []).forEach(function(x){ try{ x.stop(now + 0.05); } catch(e){} });
    }
  };
}

/** Joue une suite d'ids de voix, espacés de `gap` secondes. Rend les handles (null pour un id inconnu). */
export function playSequence(ctx, synth, ids, opts){
  const o = opts || {};
  const gap = num(o.gap, 0.5, 0, 10);
  const base = (o.volume === undefined ? 1 : o.volume) * ((synth && synth.volume !== undefined) ? synth.volume : 1);
  return (ids || []).map(function(id, i){
    const v = voiceOf(synth, id);
    if(!v) return null;
    return playVoice(ctx, v, Object.assign({}, o, {when: (Number(o.when) || 0) + i * gap, volume: base}));
  });
}

// ---------- Entrées de l'api de script ----------
// UNE SEULE IMPLÉMENTATION pour l'éditeur (js/scripts.js) et le jeu publié (js/game-runtime.js).
// Les deux api ont déjà divergé ailleurs (`findByTag`, voir game-runtime.js) : ce qui ne se
// réécrit pas deux fois ne peut pas diverger.
//
// `getContext()` rend l'AudioContext du moteur hôte, `getNodes()` les nœuds de la scène,
// `self` le nœud du script, `warn(msg)` la console du moteur, `getDestination()` (facultatif) le nœud
// où sortent les notes — le bus « sfx » (js/audio-bus.js). Sans lui, les notes partaient droit vers
// les haut-parleurs et échappaient au volume général du jeu.

function synthDataOf(node){
  const c = (node && typeof node.getComponent === 'function') ? node.getComponent('Synthesizer') : null;
  return c ? c.data : null;
}

export function makeSynthApi(getContext, getNodes, self, warn, getDestination){
  function resolve(target){
    if(target) return synthDataOf(target);
    const own = synthDataOf(self);
    if(own) return own;
    const nodes = getNodes() || [];
    for(let i = 0; i < nodes.length; i++){ const d = synthDataOf(nodes[i]); if(d) return d; }
    return null;
  }
  function withDestination(opts){
    const o = Object.assign({}, opts || {});
    if(!o.destination && typeof getDestination === 'function') o.destination = getDestination() || undefined;
    return o;
  }
  function ctx(){
    const c = getContext();
    if(c && c.state === 'suspended' && typeof c.resume === 'function'){ try{ c.resume(); } catch(e){} }
    return c;
  }
  function note(id, opts, target){
    const s = resolve(target);
    if(!s){ warn('api.playNote : aucun composant Synthesizer dans la scène'); return null; }
    const v = voiceOf(s, id);
    if(!v){ warn('api.playNote : note « ' + id + ' » introuvable'); return null; }
    const o = withDestination(opts);
    o.volume = (o.volume === undefined ? 1 : o.volume) * s.volume;
    return playVoice(ctx(), v, o);
  }
  return {
    playNote: function(id, opts){ return note(id, opts, opts && opts.target); },
    playNotes: function(ids, opts){
      const s = resolve(opts && opts.target);
      if(!s){ warn('api.playNotes : aucun composant Synthesizer dans la scène'); return []; }
      return playSequence(ctx(), s, ids, withDestination(opts));
    },
    // Les notes déclarées, en copie : un script peut les lire (couleurs, libellés) sans pouvoir
    // muter les données sérialisées par accident.
    notes: function(target){
      const s = resolve(target);
      return s ? JSON.parse(JSON.stringify(s.voices)) : [];
    },
    speak: function(text, opts){ return speakText(text, opts); },
    stopSpeaking: stopSpeaking
  };
}

// ---------- Voix parlée ----------
// `speechSynthesis` est optionnel selon le navigateur et l'appareil : l'absence rend false,
// jamais une exception — une consigne parlée ne doit pas pouvoir casser un jeu.

export function speechAvailable(){
  return typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';
}

/** Dit un texte. `opts` : {lang ('fr-FR'), rate, pitch, volume, interrupt (true)}. */
export function speakText(text, opts){
  if(!speechAvailable() || !text) return false;
  const o = opts || {};
  try{
    if(o.interrupt !== false) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(String(text));
    u.lang = o.lang || 'fr-FR';
    u.rate = num(o.rate, 1, 0.1, 10);
    u.pitch = num(o.pitch, 1, 0, 2);
    u.volume = num(o.volume, 1, 0, 1);
    speechSynthesis.speak(u);
    return true;
  } catch(e){ return false; }
}

export function stopSpeaking(){
  if(!speechAvailable()) return false;
  try{ speechSynthesis.cancel(); return true; } catch(e){ return false; }
}
