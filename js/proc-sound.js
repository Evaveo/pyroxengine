// ---------- Fabriquer des sons, sans banque de bruitages ----------
//
// Le pendant de js/proc-texture.js. Le copilote savait fabriquer des pixels et pas un bip : sonoriser
// un prototype demandait une banque de sons, donc du temps et des droits, donc en pratique un jeu muet
// jusqu'à ce que quelqu'un s'en occupe. Or un saut sans bruit ne se JUGE pas — la sensation d'un
// platformer se règle autant à l'oreille qu'à l'œil.
//
// Rend des ÉCHANTILLONS (`Float32Array`, mono, dans [-1, 1]) puis un vrai fichier WAV. Aucune
// dépendance à `AudioContext` : tout est calculé, donc tout est vérifiable dans un test — y compris la
// seule chose qui s'entend vraiment sur un son court, et que ce fichier surveille : l'ENVELOPPE.
//
// UN SON QUI COMMENCE À PLEINE AMPLITUDE CLAQUE. Le haut-parleur passe de zéro à l'amplitude en un
// échantillon, ce qui produit un clic sec — audible, désagréable, et qu'on attribue au moteur audio ou
// au navigateur plutôt qu'au fichier. Même chose à la fin. Chaque son sort donc d'une attaque et d'une
// extinction, et le test mesure les deux.

export const SOUND_PROC_SR = 22050;   // 22 kHz : un bruitage court n'a rien à gagner à 48 kHz, et pèse le double

/** Une enveloppe attaque/extinction, en fraction de la durée. Rend le gain à l'échantillon i. */
export function envelopeSound(i, n, attaque, extinction){
  const a = Math.max(1, Math.round(n * attaque));
  const e = Math.max(1, Math.round(n * extinction));
  if(i < a) return i / a;
  if(i > n - e) return Math.max(0, (n - i) / e);
  return 1;
}

/** Un générateur de bruit à GRAINE : deux appels identiques donnent le même son. */
export function noiseProc(seed){
  let g = (Math.round(Number(seed)) || 1) & 0x7fffffff;
  return function(){
    g = (g * 1103515245 + 12345) & 0x7fffffff;
    return (g / 0x7fffffff) * 2 - 1;
  };
}

/**
 * Les échantillons d'un son décrit.
 *
 * `kind` :
 *   · `beep`     — une sinusoïde franche, pour valider qu'une source joue ;
 *   · `jump`    — une hauteur qui MONTE : l'oreille lit une montée, ce qui va avec un saut ;
 *   · `fall`   — l'inverse, pour un dégât ou une perte ;
 *   · `impact`  — un bruit qui s'éteint vite, pour un choc ou un atterrissage ;
 *   · `pas`     — un impact très court et sourd, à répéter ;
 *   · `coin`   — deux notes montantes, le son de ramassage universel.
 */
export function samplesSound(d){
  const sr = SOUND_PROC_SR;
  const duration = Math.max(0.02, Math.min(5, Number(d.duration) || 0.15));
  const n = Math.round(duration * sr);
  const out = new Float32Array(n);
  const f0 = Math.max(20, Math.min(8000, Number(d.frequency) || 440));
  const vol = Math.max(0, Math.min(1, d.volume === undefined ? 0.7 : Number(d.volume)));
  const alea = noiseProc(d.seed);
  const kind = d.kind;

  // Une attaque courte mais NON NULLE, et une extinction plus longue : c'est ce qui distingue un son
  // d'un clic. Les valeurs diffèrent par genre parce qu'un impact doit claquer et une pièce chanter.
  let attaque = 0.02, extinction = 0.3;
  if(kind === 'impact' || kind === 'step'){ attaque = 0.005; extinction = 0.85; }
  if(kind === 'beep'){ attaque = 0.03; extinction = 0.25; }

  let phase = 0;
  for(let i = 0; i < n; i++){
    const t = i / n;
    let s = 0;
    if(kind === 'beep'){
      s = Math.sin(2 * Math.PI * f0 * i / sr);
    } else if(kind === 'jump' || kind === 'fall'){
      // Un balayage de hauteur intégré en PHASE et non calculé sur `f * t` : recalculer la phase à
      // chaque pas depuis une fréquence qui change fait des ruptures — un son qui grésille.
      const f = (kind === 'jump') ? f0 * (1 + 1.5 * t) : f0 * (1 - 0.6 * t);
      phase += 2 * Math.PI * Math.max(20, f) / sr;
      s = Math.sin(phase);
    } else if(kind === 'impact'){
      // Du bruit plus une composante grave : le bruit seul fait un « ch », la grave donne le poids.
      s = 0.7 * alea() + 0.5 * Math.sin(2 * Math.PI * (f0 * 0.35) * i / sr);
    } else if(kind === 'step'){
      s = 0.9 * alea();
    } else if(kind === 'coin'){
      // Deux notes : la seconde à la quinte au-dessus, dans la seconde moitié.
      const f = (t < 0.45) ? f0 : f0 * 1.5;
      phase += 2 * Math.PI * f / sr;
      s = Math.sin(phase);
    }
    out[i] = s * envelopeSound(i, n, attaque, extinction) * vol;
  }
  // ÉCRÊTAGE FRANC. `impact` additionne deux sources et peut dépasser 1 ; laisser passer produirait
  // une saturation que l'encodage en 16 bits transforme en craquement, et qu'on mettrait sur le count
  // du volume de la source.
  for(let i = 0; i < n; i++) out[i] = Math.max(-1, Math.min(1, out[i]));
  return out;
}

/**
 * Un fichier WAV mono 16 bits, prêt à devenir un asset.
 *
 * Rend un `Uint8Array`. L'en-tête est écrit à la main : c'est 44 octets, et ça évite une dépendance
 * pour un format dont la moitié est constante.
 */
export function encodeWav(samples, sr){
  const n = samples.length;
  const rate = Math.max(8000, Math.round(sr || SOUND_PROC_SR));
  const oct = 44 + n * 2;
  const u = new Uint8Array(oct);
  const v = new DataView(u.buffer);
  const txt = function(o, s){ for(let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  txt(0, 'RIFF');
  v.setUint32(4, oct - 8, true);          // taille du reste du fichier
  txt(8, 'WAVE');
  txt(12, 'fmt ');
  v.setUint32(16, 16, true);              // taille du bloc fmt
  v.setUint16(20, 1, true);               // PCM entier
  v.setUint16(22, 1, true);               // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);        // octets par seconde
  v.setUint16(32, 2, true);               // octets par trame
  v.setUint16(34, 16, true);              // bits par échantillon
  txt(36, 'data');
  v.setUint32(40, n * 2, true);
  for(let i = 0; i < n; i++){
    const s = Math.max(-1, Math.min(1, samples[i]));
    // 32767 et non 32768 : un échantillon à −1 donnerait −32768, qui est représentable, mais +1
    // donnerait +32768 qui ne l'est pas et repasserait en négatif — un craquement à chaque crête.
    v.setInt16(44 + i * 2, Math.round(s * 32767), true);
  }
  return u;
}

/** Les problèmes d'une demande de son, en clair. */
export function validateSoundProc(d){
  const p = [];
  const genres = ['beep', 'jump', 'fall', 'impact', 'step', 'coin'];
  if(!d || genres.indexOf(d.kind) === -1){
    p.push('Genre de son inconnu : « ' + (d && d.kind) + ' ». Attendu ' + genres.join(', ') + '.');
    return p;
  }
  if(d.duration !== undefined && !(Number(d.duration) > 0)) p.push('La durée doit être positive, en secondes.');
  if(Number(d.duration) > 5) p.push('Au-delà de 5 s, ce n\'est plus un bruitage : importez un vrai fichier.');
  if(d.frequency !== undefined && !(Number(d.frequency) > 0)){
    p.push('La fréquence doit être positive, en hertz (440 = un la).');
  }
  return p;
}

/** Fabrique le WAV décrit. Rend `null` si la demande est invalide. */
export function makeSoundProc(d){
  if(validateSoundProc(d).length) return null;
  return encodeWav(samplesSound(d), SOUND_PROC_SR);
}
