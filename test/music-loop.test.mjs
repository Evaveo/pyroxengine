import { deEsm } from './engine-env.mjs';
// La boîte à musique (js/music-loop.js), partagée éditeur/jeu publié.
//
// Le test qui porte le fichier est celui du RACCORD : une boucle se rejoue sans fin, et le moindre saut
// entre son dernier échantillon et le premier s'entend comme un clic à chaque tour. On mesure donc le
// saut au raccord et on le compare aux sauts à l'intérieur de la boucle — il ne doit pas en dépasser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const plat = (x) => JSON.parse(JSON.stringify(x));

function contexte(){
  const bac = {console, Math, JSON, Number, String, Object, Array, isFinite, Float32Array};
  bac.window = bac; bac.self = bac; bac.globalThis = bac;
  const ctx = vm.createContext(bac);
  vm.runInContext(deEsm(read('js/music-loop.js')), ctx, {filename: 'js/music-loop.js'});
  vm.runInContext('this.LOOP_PRESET_NAMES = LOOP_PRESET_NAMES; this.LOOP_SAMPLE_RATE = LOOP_SAMPLE_RATE;'
    + ' this.SCALE_NAMES = SCALE_NAMES; this.DRUM_VOICES = DRUM_VOICES; this.INSTRUMENT_NAMES = INSTRUMENT_NAMES;', ctx);
  return ctx;
}

test('LE RACCORD ne claque pas : aucun saut au bouclage plus grand qu à l intérieur — le test qui porte le fichier', () => {
  const ctx = contexte();
  for(const nom of Array.from(ctx.LOOP_PRESET_NAMES)){
    const s = ctx.renderLoop(ctx.presetLoop(nom));
    let maxInterne = 0;
    for(let i = 1; i < s.length; i++) maxInterne = Math.max(maxInterne, Math.abs(s[i] - s[i - 1]));
    const raccord = Math.abs(s[0] - s[s.length - 1]);
    assert.ok(raccord <= maxInterne, nom + ' : saut au raccord ' + raccord.toFixed(4) + ' > ' + maxInterne.toFixed(4));
    for(let i = 0; i < s.length; i++) if(!(Math.abs(s[i]) <= 1)) assert.fail(nom + ' : échantillon ' + i + ' = ' + s[i]);
  }
});

test('la boucle dure EXACTEMENT mesures × 16 pas, à l échantillon près', () => {
  const ctx = contexte();
  for(const [tempo, bars] of [[120, 1], [90, 4], [137, 3], [40, 2]]){
    const d = {tempo, bars, drums: {lanes: {kick: 'x...'}}};
    const s = ctx.renderLoop(d);
    assert.equal(s.length, Math.round(bars * 16 * (60 / tempo / 4) * ctx.LOOP_SAMPLE_RATE));
    assert.ok(Math.abs(ctx.loopDuration(d) - bars * 16 * 15 / tempo) < 1e-9);
  }
});

test('DÉTERMINISTE : deux rendus de la même recette sont identiques', () => {
  const ctx = contexte();
  const a = ctx.renderLoop(ctx.presetLoop('chiptune')), b = ctx.renderLoop(ctx.presetLoop('chiptune'));
  assert.equal(a.length, b.length);
  for(let i = 0; i < a.length; i += 7) if(a[i] !== b[i]) assert.fail('diverge à ' + i);
});

test('les notes : noms, dièses, bémols, MIDI', () => {
  const ctx = contexte();
  assert.equal(ctx.noteToMidi('C4'), 60);
  assert.equal(ctx.noteToMidi('A4'), 69);
  assert.equal(ctx.noteToMidi('Bb3'), 58);
  assert.equal(ctx.noteToMidi('C#5'), 73);
  assert.equal(ctx.noteToMidi('H2'), null);
  assert.equal(ctx.midiToNote(61), 'C#4');
  assert.ok(Math.abs(ctx.midiToHz(69) - 440) < 1e-9);
});

test('LA GAMME CHOISIE décide des notes de la grille', () => {
  const ctx = contexte();
  const n = (key, scale) => Array.from(ctx.scaleNotes(key, scale, 60, 72)).map((m) => ctx.midiToNote(m));
  assert.deepEqual(n('C', 'major'), ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5']);
  assert.deepEqual(n('A', 'minor'), ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5']);
  assert.deepEqual(n('C', 'pentatonicMinor'), ['C4', 'D#4', 'F4', 'G4', 'A#4', 'C5']);
  assert.equal(n('C', 'chromatic').length, 13);
  // Recaler : un Fa dièse n'est pas en Do majeur, il redescend sur Fa.
  assert.equal(ctx.midiToNote(ctx.snapToScale(ctx.noteToMidi('F#4'), 'C', 'major')), 'F4');
});

test('les accords de la gamme : I ii iii IV V vi vii° en Do, i ii° III iv v VI VII en La mineur', () => {
  const ctx = contexte();
  assert.deepEqual(Array.from(ctx.diatonicChords('C', 'major')), ['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim']);
  assert.deepEqual(Array.from(ctx.diatonicChords('A', 'minor')), ['Am', 'Bdim', 'C', 'Dm', 'Em', 'F', 'G']);
  // Une gamme à cinq notes emprunte ses accords à la gamme de même couleur.
  assert.deepEqual(Array.from(ctx.diatonicChords('A', 'pentatonicMinor')), Array.from(ctx.diatonicChords('A', 'minor')));
  assert.equal(ctx.progressionChords('C', 'major', 'pop', 4), 'C G Am F');
  assert.equal(ctx.progressionChords('G', 'major', 'pop', 4), 'G D Em C');
  const c = plat(ctx.parseChord('F#m7'));
  assert.equal(c.root, 6);
  assert.deepEqual(c.intervals, [0, 3, 7, 10]);
  assert.equal(ctx.parseChord('Xm'), null);
  assert.equal(ctx.parseChord('Cmaj9'), null);
});

test('les pistes : silence, tenue, accent, répétition d un motif court', () => {
  const ctx = contexte();
  const e = plat(ctx.parseNotes('C4 - - . E4! | G4', 6));
  assert.deepEqual(e.map((x) => [x.step, x.midi, x.length, x.accent]),
    [[0, 60, 3, false], [4, 64, 1, true], [5, 67, 1, false]]);
  // Un motif de 4 pas remplit 8 pas, et la tenue du motif ne déborde pas sur sa répétition.
  const r = plat(ctx.parseNotes('C4 - - -', 8));
  assert.deepEqual(r.map((x) => [x.step, x.length]), [[0, 4], [4, 4]]);
  assert.deepEqual(Array.from(ctx.parseLane('x.X.', 8)), [1, 0, 2, 0, 1, 0, 2, 0]);
});

test('CHANGER DE GAMME garde la musique : transposition, recalage, accords par degré', () => {
  const ctx = contexte();
  const base = ctx.presetLoop('pop');   // Do majeur, C G Am F
  const g = plat(ctx.retuneLoop(base, 'G', 'major'));
  assert.equal(g.key, 'G');
  assert.equal(g.chords.progression, 'G D Em C', 'un I-V-vi-IV reste un I-V-vi-IV');
  // Transposition la plus COURTE : Do → Sol descend d'une quarte plutôt que de monter d'une quinte.
  assert.ok(g.bass.notes.startsWith('G1'), 'la basse est transposée : ' + g.bass.notes.slice(0, 12));
  const m = plat(ctx.retuneLoop(base, 'C', 'minor'));
  // i – v – VI – iv : les degrés sont gardés, leur couleur devient celle de la gamme mineure.
  assert.deepEqual(m.chords.progression.split(' '), ['Cm', 'Gm', 'G#', 'Fm']);
  // Toute note de la mélodie recalée appartient à la nouvelle gamme.
  for(const e of Array.from(ctx.parseNotes(m.melody.notes, 32))) assert.ok(ctx.inScale(e.midi, 'C', 'minor'));
});

test('la validation DIT ce qui cloche, pour le copilote qui n entend rien', () => {
  const ctx = contexte();
  const p = Array.from(ctx.validateLoop({scale: 'jazz', drums: {lanes: {cloche: 'x'}},
    melody: {notes: 'C5 Z9 F#5', instrument: 'violon'}, chords: {progression: 'C Hm G'}, bars: 1}));
  assert.ok(p.some((m) => /Gamme inconnue/.test(m)));
  assert.ok(p.some((m) => /Percussion inconnue « cloche »/.test(m)));
  assert.ok(p.some((m) => /jetons illisibles \(Z9\)/.test(m)));
  assert.ok(p.some((m) => /instrument inconnu « violon »/.test(m)));
  assert.ok(p.some((m) => /hors de la gamme/.test(m)), 'F#5 hors de Do majeur doit être signalé');
  assert.ok(p.some((m) => /symboles illisibles \(Hm\)/.test(m)));
  for(const nom of Array.from(ctx.LOOP_PRESET_NAMES)){
    assert.deepEqual(Array.from(ctx.validateLoop(ctx.presetLoop(nom))), [], nom + ' ne doit rien signaler');
  }
});

test('chaque piste s ENTEND : couper une piste change le son', () => {
  const ctx = contexte();
  const base = ctx.presetLoop('pop');
  const energie = (s) => { let e = 0; for(let i = 0; i < s.length; i += 3) e += s[i] * s[i]; return e; };
  const e0 = energie(ctx.renderLoop(base));
  for(const piste of ['melody', 'bass', 'chords']){
    const sans = plat(base);
    if(piste === 'chords') sans.chords.progression = ''; else sans[piste].notes = '';
    assert.ok(energie(ctx.renderLoop(sans)) < e0 * 0.97, 'couper ' + piste + ' ne change presque rien');
  }
  for(const v of Array.from(ctx.DRUM_VOICES)){
    const s = ctx.drumSamples(v, 44100);
    let pic = 0; for(const x of s) pic = Math.max(pic, Math.abs(x));
    assert.ok(pic > 0.1, v + ' est muet');
    assert.ok(Math.abs(s[0]) < 1e-9 && Math.abs(s[s.length - 1]) < 1e-9, v + ' claque au début ou à la fin');
  }
});

test('describeLoop résume ce qu on entend', () => {
  const ctx = contexte();
  const d = plat(ctx.describeLoop(ctx.presetLoop('pop')));
  assert.equal(d.bars, 2);
  assert.deepEqual(d.chords, ['C', 'G', 'Am', 'F']);
  assert.equal(d.drumHits.kick, 8);
  assert.ok(d.melody.notes > 0 && /–/.test(d.melody.range));
});

test('LA GRILLE : poser, retirer, tenir une note ; un motif court est déplié', () => {
  const ctx = contexte();
  const C5 = ctx.noteToMidi('C5'), E5 = ctx.noteToMidi('E5');
  let t = ctx.toggleNoteAt('', 16, 0, C5);
  assert.equal(ctx.expandTokens(t, 16)[0], 'C5');
  t = ctx.holdNoteTo(t, 16, 3, C5);
  assert.deepEqual(Array.from(ctx.expandTokens(t, 16)).slice(0, 5), ['C5', '-', '-', '-', '.']);
  // Cliquer DANS la tenue de la même note la retire entière.
  t = ctx.toggleNoteAt(t, 16, 2, C5);
  assert.deepEqual(Array.from(ctx.expandTokens(t, 16)).slice(0, 4), ['.', '.', '.', '.']);
  // Une autre note au milieu d'une tenue la coupe.
  t = ctx.holdNoteTo(ctx.toggleNoteAt('', 16, 0, C5), 16, 3, C5);
  t = ctx.toggleNoteAt(t, 16, 2, E5);
  // … sans hériter de sa tenue : le `-` qui suivait appartenait au C5 (revue du 2026-09-29, § 3.9).
  assert.deepEqual(Array.from(ctx.expandTokens(t, 16)).slice(0, 4), ['C5', '-', 'E5', '.']);
  // Un motif d'une mesure dans une boucle de deux : la retouche porte sur la mesure 2 seulement.
  const deux = ctx.toggleNoteAt('C4 . . .', 32, 20, ctx.noteToMidi('G4'));
  const liste = Array.from(ctx.expandTokens(deux, 32));
  assert.equal(liste[16], 'C4');
  assert.equal(liste[20], 'G4');
  assert.equal(liste[4], 'C4', 'la mesure 1 garde son motif');
  assert.ok(/ \| /.test(deux), 'les mesures sont séparées par « | » pour rester lisibles');
});

test('LA GRILLE : percussions et accords', () => {
  const ctx = contexte();
  const l = ctx.setDrumStep('x...', 32, 17, 2);
  assert.deepEqual(Array.from(ctx.parseLane(l, 32)).slice(16, 18), [1, 2]);
  assert.equal(ctx.setChordAt('C G', 2, 2, 3, 'Am'), 'C G C Am');
  assert.deepEqual(Array.from(ctx.chordSlots('', 1, 2)), ['.', '.']);
});

test('LA BOUCLE VOYAGE et se joue partout : .p3d, .loop.json, dossier, jeu publié, source audio', () => {
  const ser = read('js/serialization.js');
  assert.ok(/kind:'musicLoop', name:a\.name, folder:a\.folder \|\| '',\s*recipe:/.test(ser));
  assert.ok(/'\.loop\.json'/.test(ser));
  assert.ok(/x\.kind === 'musicLoop'[\s\S]{0,200}?createAssetLoop\(da\.recipe/.test(ser));
  const pf = read('js/project-folder.js');
  assert.ok(/\\\.loop\\\.json\$\/i,\s*'musicLoop'/.test(pf));
  assert.ok(/da\.kind === 'musicLoop' \? \{recipe:/.test(pf));
  const rt = read('js/game-runtime.js');
  assert.ok(/from '\.\/music-loop\.js'/.test(rt) && /da\.kind === 'musicLoop'[\s\S]{0,300}?loopBuffer\(/.test(rt));
  assert.ok(!/function renderLoop|function normalizeLoop/.test(rt), 'le runtime ne doit pas recopier music-loop');
  assert.ok(/PLAYABLE_AUDIO_KINDS = \[[^\]]*'musicLoop'/.test(read('js/component-data.js')));
  // Posée sur un objet, une boucle devient une musique de fond : en boucle, non spatiale, bus Musique.
  assert.ok(/asset\.kind === 'musicLoop'\)\{ ua\.loop = true; ua\.spatial = false; ua\.bus = 'music'; \}/.test(read('js/audio.js')));
});

test('le rack et le copilote passent par les MÊMES fonctions, et le rack se replie', () => {
  const cw = read('js/copilot-workshop.js');
  for(const n of ['create_music_loop', 'edit_music_loop']) assert.ok(cw.includes("name: '" + n + "'"), n + ' manque');
  assert.ok(/createAssetLoop\(recipe/.test(cw) && /setLoopRecipe\(asset/.test(cw));
  const ctx = contexte();
  const liste = cw.match(/preset: \{type: 'string', enum: \['pop', 'chiptune', 'lofi'\]\}/);
  assert.ok(liste, 'le schéma du copilote liste les presets du moteur');
  assert.deepEqual(Array.from(ctx.LOOP_PRESET_NAMES), ['pop', 'chiptune', 'lofi']);
  const rack = read('js/sound-rack.js');
  assert.ok(/setLoopRecipe\(a, recipe/.test(rack) && /createAssetLoop\(/.test(rack));
  // Chaque gamme, chaque percussion a son libellé dans le rack : une gamme ajoutée au moteur sans
  // libellé s'afficherait sous son nom de code.
  for(const s of Array.from(ctx.SCALE_NAMES)) assert.ok(new RegExp('\\b' + s + ": '").test(rack), 'libellé manquant : ' + s);
  for(const v of Array.from(ctx.DRUM_VOICES)) assert.ok(new RegExp('\\b' + v + ": '").test(rack), 'libellé manquant : ' + v);
  // Replier un module : un bouton par module, un état mémorisé sur la machine.
  assert.ok(/rack-fold/.test(rack) && /localStorage\.setItem\(COLLAPSED_KEY/.test(rack));
  assert.ok(/\.rack-module\.is-collapsed > :not\(\.rack-head\)\{display:none;\}/.test(read('css/panels.css')));
});

test('CLEAR SONG vide les pistes et garde le cadre', () => {
  const ctx = contexte();
  const base = ctx.retuneLoop(ctx.presetLoop('chiptune'), 'D', 'dorian');
  const vide = plat(ctx.clearLoop(base));
  assert.deepEqual(vide.drums.lanes, {});
  assert.equal(vide.melody.notes + vide.bass.notes + vide.chords.progression, '');
  for(const k of ['tempo', 'bars', 'key', 'scale', 'swing']) assert.equal(vide[k], plat(base)[k], k + ' ne doit pas bouger');
  assert.equal(vide.melody.instrument, 'chip', 'les instruments restent');
  const s = ctx.renderLoop(vide);
  let pic = 0; for(const x of s) pic = Math.max(pic, Math.abs(x));
  assert.equal(pic, 0, 'une boucle vidée est silencieuse');
});

test('RÉGRESSION § 3.9 — tenir ne passe pas par-dessus une autre note, poser n hérite pas d une tenue', () => {
  const ctx = contexte();
  const C5 = ctx.noteToMidi('C5'), D5 = ctx.noteToMidi('D5');
  const t = ctx.holdNoteTo('C5 . E5 . . . . . . . . . . . . .', 16, 4, C5);
  assert.equal(Array.from(ctx.expandTokens(t, 16))[2], 'E5', 'le E5 intermédiaire doit survivre');
  const u = ctx.toggleNoteAt('C5 - - - . . . . . . . . . . . .', 16, 1, D5);
  assert.deepEqual(Array.from(ctx.expandTokens(u, 16)).slice(0, 5), ['C5', 'D5', '.', '.', '.']);
});

test('RÉGRESSION § 3.2 — une tonalité ou une gamme illisible ne transpose rien', () => {
  const ctx = contexte();
  const base = ctx.presetLoop('chiptune');
  const r = plat(ctx.retuneLoop(base, 'H', 'jazz'));
  assert.equal(r.key, 'A');
  assert.equal(r.scale, 'minor');
  assert.equal(r.melody.notes, plat(base).melody.notes);
  assert.equal(r.chords.progression, plat(base).chords.progression);
});

test('RÉGRESSION § 1.3 et § 1.4 — rechargement d une recette, export WAV sous un nom libre', () => {
  const proj = read('js/project.js');
  const liste = proj.match(/FIELDS_CONTENT_ASSET = \[([\s\S]*?)\]/)[1];
  assert.ok(/'recipe'/.test(liste) && /'preset'/.test(liste), 'recipe et preset doivent être relus à chaud');
  assert.ok(/a\.kind === 'sfx'\) renderAssetSfx\(a\)/.test(proj) && /a\.kind === 'musicLoop'\) renderAssetLoop\(a\)/.test(proj));
  const rack = read('js/sound-rack.js');
  assert.equal((rack.match(/freeAudioFileName\(folderCurrent/g) || []).length, 2, 'les deux exports WAV du rack');
  assert.ok(!/slugFile\(a\.name\) \+ '\.wav'/.test(rack), 'plus aucun nom de WAV fixe');
});
