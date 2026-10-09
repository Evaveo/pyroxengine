import { deEsm } from './engine-env.mjs';
// Fabriquer des sons sans banque de bruitages.
//
// Le test qui porte le fichier est celui de L'ENVELOPPE. Sur un son court, c'est la seule chose qui
// s'entend vraiment : un son qui commence à pleine amplitude fait passer le haut-parleur de zéro à
// l'amplitude en un échantillon, ce qui produit un clic sec. Il est audible, désagréable, et on
// l'attribue au moteur audio ou au navigateur — jamais au fichier, qui est pourtant le seul coupable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const hote = (x) => JSON.parse(JSON.stringify(x));

function contexte(){
  const bac = {console, Math, JSON, Number, String, Object, Array, isFinite,
               Float32Array, Uint8Array, DataView, ArrayBuffer};
  bac.window = bac; bac.self = bac; bac.globalThis = bac;
  const ctx = vm.createContext(bac);
  vm.runInContext(deEsm(read('js/proc-sound.js')), ctx, {filename: 'js/proc-sound.js'});
  return ctx;
}

const GENRES = ['beep', 'jump', 'fall', 'impact', 'step', 'coin'];

test('AUCUN SON NE CLAQUE — le test qui porte le fichier', () => {
  const ctx = contexte();
  const fautes = [];
  for(const kind of GENRES){
    for(const duration of [0.05, 0.15, 0.5]){
      const e = ctx.samplesSound({kind: kind, duration: duration, frequency: 440, volume: 1, seed: 7});
      const n = e.length;
      // Le PREMIER échantillon doit être quasi nul : c'est là que le clic naît.
      if(Math.abs(e[0]) > 0.02) fautes.push(kind + ' ' + duration + 's : démarre à ' + e[0].toFixed(3));
      // Et le DERNIER : une coupure nette à pleine amplitude claque autant qu'un démarrage.
      if(Math.abs(e[n - 1]) > 0.02) fautes.push(kind + ' ' + duration + 's : finit à ' + e[n-1].toFixed(3));
      // L'attaque doit MONTER, pas être plate : un son qui reste à zéro sur son premier quart n'a
      // pas d'enveloppe, il a un silence — et il claquera à la end de ce silence.
      let maxDebut = 0;
      for(let i = 0; i < Math.min(n, Math.round(n * 0.25)); i++) maxDebut = Math.max(maxDebut, Math.abs(e[i]));
      if(maxDebut < 0.05) fautes.push(kind + ' ' + duration + 's : rien dans le premier quart');
    }
  }
  assert.deepEqual(fautes, [],
    'Ces sons claquent. Le clic s\'entend, et on l\'attribue au moteur audio ou au navigateur —\n'
    + 'jamais au fichier, qui est pourtant le seul coupable.\n' + fautes.join('\n'));
});

test('RIEN NE SATURE : tout reste dans [-1, 1]', () => {
  const ctx = contexte();
  const fautes = [];
  for(const kind of GENRES){
    // Volume 1 ET impact, qui ADDITIONNE deux sources : c'est le cas qui dépass.
    const e = ctx.samplesSound({kind: kind, duration: 0.2, frequency: 220, volume: 1, seed: 3});
    let pic = 0;
    for(let i = 0; i < e.length; i++) pic = Math.max(pic, Math.abs(e[i]));
    if(pic > 1.0000001) fautes.push(kind + ' : pic à ' + pic.toFixed(4));
  }
  assert.deepEqual(fautes, [],
    'Un échantillon au-delà de 1 sature à l\'encodage en 16 bits, ce qui s\'entend comme un\n'
    + 'craquement — et on le met sur le compte du volume de la source.\n' + fautes.join('\n'));
});

test('LE WAV EST UN VRAI WAV : en-tete et tailles coherentes', () => {
  const ctx = contexte();
  const e = ctx.samplesSound({kind: 'beep', duration: 0.1, frequency: 440});
  const w = ctx.encodeWav(e, 22050);
  const lireTexte = (o, n) => { let s = ''; for(let i = 0; i < n; i++) s += String.fromCharCode(w[o+i]); return s; };
  const u32 = (o) => w[o] | (w[o+1] << 8) | (w[o+2] << 16) | (w[o+3] << 24);
  const u16 = (o) => w[o] | (w[o+1] << 8);

  assert.equal(lireTexte(0, 4), 'RIFF');
  assert.equal(lireTexte(8, 4), 'WAVE');
  assert.equal(lireTexte(12, 4), 'fmt ');
  assert.equal(lireTexte(36, 4), 'data');
  // Les TAILLES sont ce qui fait qu'un décodeur accepte ou refuse le fichier — et un décodeur qui
  // refuse ne dit pas laquelle est fausse.
  assert.equal(w.length, 44 + e.length * 2, 'longueur totale');
  assert.equal(u32(4), w.length - 8, 'size RIFF = tout sauf les 8 premiers octets');
  assert.equal(u32(40), e.length * 2, 'taille du bloc data');
  assert.equal(u16(20), 1, 'PCM entier');
  assert.equal(u16(22), 1, 'mono');
  assert.equal(u32(24), 22050, 'taux d\'échantillonnage');
  assert.equal(u32(28), 22050 * 2, 'octets par seconde');
  assert.equal(u16(32), 2, 'octets par trame');
  assert.equal(u16(34), 16, 'bits par échantillon');
});

test('L ENCODAGE ne repasse JAMAIS en negatif sur une crete', () => {
  const ctx = contexte();
  // +1,0 doit donner 32767 et non 32768 : 32768 n'est pas représentable en entier signé 16 bits et
  // repasserait à −32768 — une crête qui devient un creux, donc un craquement à chaque sommet.
  const e = new Float32Array([1, -1, 0, 0.5, -0.5, 2, -2]);
  const w = ctx.encodeWav(e, 22050);
  const i16 = (o) => { const v = w[o] | (w[o+1] << 8); return v > 32767 ? v - 65536 : v; };
  assert.equal(i16(44), 32767, '+1 doit donner 32767');
  assert.equal(i16(46), -32767, '-1 doit donner -32767');
  assert.equal(i16(48), 0);
  // Et un échantillon hors bounds est ÉCRÊTÉ, pas replié.
  assert.equal(i16(54), 32767, '+2 doit être écrêté à 32767');
  assert.equal(i16(56), -32767, '-2 doit être écrêté à -32767');
});

test('SAUT MONTE et CHUTE DESCEND — sinon le son dit le contraire du geste', () => {
  const ctx = contexte();
  // La hauteur se mesure au number de passages par zéro : plus il y en a, plus c'est aigu. Un son de
  // saut qui descend est pire qu'un son absent : il contredit ce que le joueur voit.
  const croisements = (e, de, a) => {
    let n = 0;
    for(let i = de + 1; i < a; i++) if((e[i-1] < 0) !== (e[i] < 0)) n++;
    return n;
  };
  for(const [kind, attendu] of [['jump', 'monte'], ['fall', 'descend']]){
    const e = ctx.samplesSound({kind: kind, duration: 0.4, frequency: 300, volume: 1});
    const n = e.length, t = Math.floor(n / 3);
    const start = croisements(e, 0, t), end = croisements(e, n - t, n);
    if(attendu === 'monte'){
      assert.ok(end > start * 1.2,
        'saut : ' + start + ' croisements au début, ' + end + ' à la end — ça ne monte pas');
    } else {
      assert.ok(end < start * 0.9,
        'chute : ' + start + ' au début, ' + end + ' à la end — ça ne descend pas');
    }
  }
});

test('LE BRUIT EST REPRODUCTIBLE, et la duree est celle demandee', () => {
  const ctx = contexte();
  const a = ctx.samplesSound({kind: 'impact', duration: 0.2, seed: 42});
  const b = ctx.samplesSound({kind: 'impact', duration: 0.2, seed: 42});
  assert.deepEqual([...a], [...b], 'même graine, même son');
  const c = ctx.samplesSound({kind: 'impact', duration: 0.2, seed: 43});
  assert.notDeepEqual([...a], [...c], 'deux graines doivent différer');
  // Sans graine, ça reste déterministe : régénérer un bruitage ne doit pas le changer sous les pieds.
  assert.deepEqual([...ctx.samplesSound({kind: 'step', duration: 0.1})],
                   [...ctx.samplesSound({kind: 'step', duration: 0.1})]);
  // La durée : 0,25 s à 22 050 Hz font 5 512 ou 5 513 échantillons selon l'arrondi.
  const d = ctx.samplesSound({kind: 'beep', duration: 0.25});
  assert.ok(Math.abs(d.length - 0.25 * 22050) <= 1, d.length + ' échantillons pour 0,25 s');
});

test('validateSoundProc REFUSE ce qui ne se fabrique pas', () => {
  const ctx = contexte();
  assert.ok(ctx.validateSoundProc({kind: 'symphonie'}).some((x) => x.includes('inconnu')));
  assert.ok(ctx.validateSoundProc({kind: 'beep', duration: 0}).some((x) => x.includes('durée')));
  assert.ok(ctx.validateSoundProc({kind: 'beep', duration: 30}).some((x) => x.includes('5 s')));
  assert.ok(ctx.validateSoundProc({kind: 'beep', frequency: -3}).some((x) => x.includes('fréquence')));
  assert.deepEqual(hote(ctx.validateSoundProc({kind: 'beep'})), [], 'un genre seul doit suffire');
  // Une demande invalide rend `null` et non un WAV empty : un WAV empty passerait pour un son réussi et
  // donnerait un silence qu'on chercherait ailleurs.
  assert.equal(ctx.makeSoundProc({kind: 'symphonie'}), null);
  const w = ctx.makeSoundProc({kind: 'coin'});
  assert.ok(w && w.length > 44, 'un son valide doit produire des octets');
});
