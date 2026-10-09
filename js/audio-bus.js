// ---------- Les BUS de mixage : Master, Musique, Effets sonores ----------
//
// Sans bus, chaque son part directement vers les haut-parleurs, et le seul réglage est le volume de
// CHAQUE source. On ne peut donc ni baisser la musique face aux bruitages, ni proposer au joueur un
// curseur « Musique » dans un menu d'options — deux choses qu'on attend de n'importe quel jeu. Et la
// première boucle rythmique du Rack sonore rendrait le mélange impossible à régler.
//
//     source ─▶ bus « music » ─┐
//     source ─▶ bus « sfx »   ─┴─▶ bus « master » ─▶ entrée du listener ─▶ haut-parleurs
//
// PARTAGÉ, comme js/audio-falloff.js : chargé par l'éditeur, l'aperçu, le harnais de build et embarqué
// dans les jeux publiés. Deux exemplaires du routage feraient sonner le jeu publié autrement que
// l'éditeur, et un mélange qui diverge ne se voit pas — il s'entend, chez le joueur.
//
// Ni DOM ni THREE : on reçoit un `AudioContext` et le nœud d'arrivée, et on ne touche un son three que
// par son champ `gain` — donc tout se vérifie avec un faux contexte (test/audio-bus.test.mjs).
//
// CE QUI EST PERSISTÉ, ET CE QUI NE L'EST PAS : les VOLUMES vivent dans les réglages du projet
// (`project.settings.audioBuses`) — c'est le mélange voulu par l'auteur, il voyage avec le projet et part
// dans le build. La SOURDINE, elle, est un état de partie (`api.audioBus('music').mute(true)`) : elle
// repart à zéro à chaque lancement, sinon un jeu arrêté pendant une cinématique muette le resterait.

export const AUDIO_BUSES = ['master', 'music', 'sfx'];

/** Les bus sur lesquels une source peut sortir. `master` n'en fait pas partie : tout y passe déjà. */
export const AUDIO_SOURCE_BUSES = ['sfx', 'music'];

export const AUDIO_BUSES_DEFAULT = {master: 1, music: 1, sfx: 1};

// 2 et pas 1 : même borne que le volume d'une source. Un bus sert aussi à REMONTER un groupe de sons
// trop discrets sans retoucher chacun d'eux.
export const AUDIO_BUS_VOLUME_MAX = 2;

function clampVolume(v, fallback){
  const n = Number(v);
  if(v === null || v === undefined || v === '' || typeof v === 'boolean' || !isFinite(n)) return fallback;
  return Math.max(0, Math.min(AUDIO_BUS_VOLUME_MAX, n));
}

/**
 * Les volumes de bus lus d'un fichier, ramenés dans leurs bornes.
 *
 * Un champ absent rend 1, un `NaN` aussi : un fichier abîmé ne doit pas rendre tout le jeu muet en
 * silence. Un 0 EXPLICITE reste 0 — c'est un choix (une musique coupée), pas une valeur manquante.
 */
export function sanitizeAudioBuses(raw){
  const r = (raw && typeof raw === 'object') ? raw : {};
  const out = {};
  AUDIO_BUSES.forEach(function(name){ out[name] = clampVolume(r[name], AUDIO_BUSES_DEFAULT[name]); });
  return out;
}

/**
 * Le bus d'une source audio (`userData.audio`).
 *
 * Un champ absent rend `sfx` : c'est la MIGRATION des projets écrits avant les bus, et elle ne change
 * rien à ce qu'on entend — tous les bus valent 1 par défaut, donc une source routée sur `sfx` sonne
 * exactement comme avant.
 */
export function busOfSource(ua){
  const b = ua && ua.bus;
  return (AUDIO_SOURCE_BUSES.indexOf(b) !== -1) ? b : 'sfx';
}

/** Le nom de bus demandé par un script ou le copilote, ou `null` s'il n'existe pas. */
export function busName(name){
  const n = String(name || '').trim();
  return (AUDIO_BUSES.indexOf(n) !== -1) ? n : null;
}

/**
 * Construit les trois bus sur `ctx` et les relie à `destination` (l'entrée du listener three).
 *
 * Rend un objet de mixage :
 *   · `route(sound, bus)`  — branche un son three (`THREE.Audio` / `PositionalAudio`) sur un bus ;
 *   · `setVolume(bus, v)`, `volume(bus)` — le volume réglé, sans la sourdine ;
 *   · `mute(bus, on)`, `isMuted(bus)`   — la sourdine de partie ;
 *   · `apply(volumes)`     — relit les volumes des réglages de projet ;
 *   · `resetMutes()`       — à chaque lancement de partie ;
 *   · `node(bus)`          — le `GainNode`, pour qui joue sans objet three (le synthé).
 */
export function createAudioBuses(ctx, destination, volumes){
  const nodes = {};
  const state = {};
  AUDIO_BUSES.forEach(function(name){
    nodes[name] = ctx.createGain();
    state[name] = {volume: 1, muted: false};
  });
  nodes.music.connect(nodes.master);
  nodes.sfx.connect(nodes.master);
  nodes.master.connect(destination || ctx.destination);

  function write(name){
    const s = state[name];
    nodes[name].gain.value = s.muted ? 0 : s.volume;
  }

  const mix = {
    nodes: nodes,
    node: function(name){ return nodes[busName(name) || 'sfx']; },
    setVolume: function(name, v){
      const n = busName(name);
      if(!n) return false;
      state[n].volume = clampVolume(v, state[n].volume);
      write(n);
      return true;
    },
    volume: function(name){
      const n = busName(name);
      return n ? state[n].volume : 0;
    },
    mute: function(name, on){
      const n = busName(name);
      if(!n) return false;
      // Sans argument : couper. Sinon la VÉRITÉ de la valeur — `mute(0)` ou `mute('false')`, lus
      // d'un menu d'options, coupaient le bus (revue du 2026-09-29, § 3.6).
      state[n].muted = (on === undefined) ? true : (!!on && on !== 'false');
      write(n);
      return true;
    },
    isMuted: function(name){
      const n = busName(name);
      return n ? state[n].muted : false;
    },
    resetMutes: function(){
      AUDIO_BUSES.forEach(function(name){ state[name].muted = false; write(name); });
    },
    apply: function(v){
      const clean = sanitizeAudioBuses(v);
      AUDIO_BUSES.forEach(function(name){ state[name].volume = clean[name]; write(name); });
    },
    /**
     * Branche un son three sur un bus.
     *
     * three relie `sound.gain` à l'entrée du listener dès la construction, et c'est le DERNIER maillon
     * de sa chaîne — le panoramique 3D d'une `PositionalAudio` est en amont (`panner → gain`). On ne
     * débranche donc que cette sortie-là : la spatialisation reste intacte, et le son passe par le bus
     * au lieu de le contourner.
     */
    route: function(sound, name){
      if(!sound || !sound.gain || typeof sound.gain.connect !== 'function') return false;
      const n = busName(name) || 'sfx';
      try{ sound.gain.disconnect(); } catch(e){}
      sound.gain.connect(nodes[n]);
      return true;
    }
  };
  mix.apply(volumes);
  return mix;
}

/**
 * L'entrée `api.audioBus(name)` des scripts. UNE implémentation pour les deux moteurs — même règle que
 * `makeSynthApi` (js/synth.js) : ce qui ne s'écrit pas deux fois ne peut pas diverger.
 *
 * `getMix()` rend l'objet de `createAudioBuses`, ou `null` tant que l'audio n'est pas prêt.
 * Un bus inconnu ne lève rien — un script qui plante coupe toute la partie — mais le DIT, et rend une
 * poignée inerte.
 */
export function makeAudioBusApi(getMix, name, warn){
  const n = busName(name);
  if(!n && typeof warn === 'function'){
    warn('api.audioBus : bus « ' + name + ' » inconnu. Bus disponibles : ' + AUDIO_BUSES.join(', '));
  }
  return {
    name: n,
    volume: function(v){
      const mix = getMix();
      if(!n || !mix) return 0;
      if(v !== undefined) mix.setVolume(n, v);
      return mix.volume(n);
    },
    mute: function(on){
      const mix = getMix();
      if(!n || !mix) return false;
      mix.mute(n, on);
      return mix.isMuted(n);
    },
    muted: function(){
      const mix = getMix();
      return !!(n && mix && mix.isMuted(n));
    }
  };
}

/**
 * Construit, règle et branche le son d'une SOURCE AUDIO (`userData.audio`), et le lance si elle
 * joue au démarrage. UNE implémentation pour les deux moteurs : ces vingt-cinq lignes existaient
 * dans js/audio.js ET dans js/game-runtime.js, et avaient déjà divergé — l'éditeur signalait un son
 * qui refuse de partir, le jeu publié l'avalait sans trace (revue du 2026-09-29, § 6.5).
 *
 * `THREE` et `listener` viennent de l'hôte ; `setFalloff` est `setFalloffAudio` (js/audio-falloff.js),
 * passé pour que ce fichier reste sans import ; `warn(msg)` est la console de l'hôte.
 */
export function createSourceSound(THREE, listener, ua, buffer, mix, setFalloff, warn){
  const son = (ua.spatial !== false) ? new THREE.PositionalAudio(listener) : new THREE.Audio(listener);
  son.setBuffer(buffer);
  son.setLoop(!!ua.loop);
  son.setVolume(ua.volume !== undefined ? ua.volume : 1);
  son.setPlaybackRate(ua.pitch || 1);
  if(typeof setFalloff === 'function') setFalloff(son, ua);
  if(mix) mix.route(son, busOfSource(ua));
  if(ua.auto !== false){
    try{ son.play(); } catch(e){ if(typeof warn === 'function') warn('audio : ' + e.message); }
  }
  return son;
}
