import { deEsm } from './engine-env.mjs';
// Le synthé à bruitages (js/chip-synth.js), partagé éditeur/jeu publié.
//
// Le test qui porte le fichier est celui du CLIC : un son qui démarre ou finit à pleine amplitude
// claque, et on met ce claquement sur le compte du navigateur. On le mesure sur TOUS les presets, à
// vingt graines chacun — un preset qui ne claque qu'une fois sur vingt serait livré sinon.
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
  vm.runInContext(deEsm(read('js/chip-synth.js')), ctx, {filename: 'js/chip-synth.js'});
  vm.runInContext('this.SFX_PRESET_NAMES = SFX_PRESET_NAMES; this.SFX_BOUNDS = SFX_BOUNDS;'
    + ' this.SFX_SAMPLE_RATE = SFX_SAMPLE_RATE; this.SFX_WAVES = SFX_WAVES;', ctx);
  return ctx;
}

test('PAS DE CLIC : chaque preset commence et finit près de zéro — le test qui porte le fichier', () => {
  const ctx = contexte();
  const fautes = [];
  for(const nom of Array.from(ctx.SFX_PRESET_NAMES)){
    for(let graine = 1; graine <= 20; graine++){
      const s = ctx.renderSfx(ctx.presetSfx(nom, graine));
      // Le premier échantillon est exactement 0 (attaque linéaire depuis 0) ; le deuxième, à 22 kHz
      // et 2 ms d'attaque minimum, reste sous 1/44 de l'amplitude.
      if(Math.abs(s[0]) > 1e-9) fautes.push(nom + '#' + graine + ' premier = ' + s[0]);
      if(Math.abs(s[1]) > 0.05) fautes.push(nom + '#' + graine + ' deuxième = ' + s[1].toFixed(3));
      if(Math.abs(s[s.length - 1]) > 1e-9) fautes.push(nom + '#' + graine + ' dernier = ' + s[s.length - 1]);
      // Les derniers 2 ms s'éteignent : pas une falaise.
      const avant = s[s.length - 1 - Math.round(0.002 * ctx.SFX_SAMPLE_RATE)];
      if(Math.abs(avant) > 0.2) fautes.push(nom + '#' + graine + ' 2 ms avant la fin = ' + avant.toFixed(3));
    }
  }
  assert.deepEqual(fautes, [], 'des presets claquent :\n' + fautes.join('\n'));
});

test('DÉTERMINISTE : même recette, même graine, mêmes échantillons', () => {
  const ctx = contexte();
  for(const nom of Array.from(ctx.SFX_PRESET_NAMES)){
    const a = ctx.renderSfx(ctx.presetSfx(nom, 7));
    const b = ctx.renderSfx(ctx.presetSfx(nom, 7));
    assert.equal(a.length, b.length);
    for(let i = 0; i < a.length; i++) if(a[i] !== b[i]) assert.fail(nom + ' diverge à l\'échantillon ' + i);
    // Et deux graines donnent bien deux sons : sinon « 🎲 » ne tirerait rien.
    const c = ctx.renderSfx(ctx.presetSfx(nom, 8));
    let differe = c.length !== a.length;
    for(let i = 0; !differe && i < a.length; i++) if(a[i] !== c[i]) differe = true;
    assert.ok(differe, nom + ' : les graines 7 et 8 rendent le même son');
  }
});

test('BORNES : n importe quelle recette rend un son dans [-1, 1], de 5 s au plus', () => {
  const ctx = contexte();
  const folles = [
    null, 42, [], {wave: 'banane'}, {pitch: {start: 1e9, slide: 1e9}},
    {envelope: {attack: 10, sustain: 10, decay: 10}, filter: {lowpass: 0, resonance: 1}},
    {wave: 'noise', crush: {bits: 1, downsample: 16}, volume: 5},
    {pitch: {start: 'abc'}, duty: true, repeat: -3}
  ];
  for(const r of folles){
    const s = ctx.renderSfx(r);
    assert.ok(s.length > 0, 'recette ' + JSON.stringify(r) + ' : aucun échantillon');
    assert.ok(s.length <= 5 * ctx.SFX_SAMPLE_RATE + 1, 'recette ' + JSON.stringify(r) + ' : plus de 5 s');
    for(let i = 0; i < s.length; i++){
      if(!(Math.abs(s[i]) <= 1)) assert.fail('recette ' + JSON.stringify(r) + ' : échantillon ' + i + ' = ' + s[i]);
    }
  }
});

test('LE GENRE S ENTEND : un saut monte, un laser descend, une pièce saute d un intervalle', () => {
  const ctx = contexte();
  for(let g = 1; g <= 10; g++){
    const saut = plat(ctx.describeSfx(ctx.presetSfx('jump', g)));
    assert.ok(saut.endHz > saut.startHz, 'jump#' + g + ' ne monte pas : ' + JSON.stringify(saut));
    const laser = plat(ctx.describeSfx(ctx.presetSfx('laser', g)));
    assert.ok(laser.endHz < laser.startHz / 2, 'laser#' + g + ' ne descend pas assez : ' + JSON.stringify(laser));
    const piece = plat(ctx.describeSfx(ctx.presetSfx('coin', g)));
    assert.ok(piece.endHz > piece.startHz, 'coin#' + g + ' ne saute pas vers le haut');
    // Chaque preset doit s'ENTENDRE : une crête minuscule serait un bruitage muet.
    for(const nom of Array.from(ctx.SFX_PRESET_NAMES)){
      const d = plat(ctx.describeSfx(ctx.presetSfx(nom, g)));
      assert.ok(d.peak >= 0.15, nom + '#' + g + ' trop faible : crête ' + d.peak);
      assert.ok(d.duration <= 1.5, nom + '#' + g + ' trop long pour un bruitage : ' + d.duration + ' s');
    }
  }
});

test('la normalisation borne chaque champ, et un 0 explicite reste 0', () => {
  const ctx = contexte();
  const r = plat(ctx.normalizeSfx({volume: 0, duty: 9, pitch: {start: 5}, crush: {bits: 7.6}}));
  assert.equal(r.volume, 0);
  assert.equal(r.duty, 0.5);
  assert.equal(r.pitch.start, 20);
  assert.equal(r.crush.bits, 8, 'les bits sont entiers');
  assert.equal(r.envelope.attack, 0.005, 'un champ absent prend son défaut');
  // L'attaque et l'extinction minimales sont ce qui empêche le clic : 0 est refusé.
  const z = plat(ctx.normalizeSfx({envelope: {attack: 0, decay: 0}}));
  assert.ok(z.envelope.attack >= 0.002 && z.envelope.decay >= 0.01);
});

test('la validation DIT ce qu elle corrige, pour le copilote qui n entend rien', () => {
  const ctx = contexte();
  const p = Array.from(ctx.validateSfx({wave: 'laser', pitch: {start: 99999, hauteur: 3}, couleur: 'rouge'}));
  assert.ok(p.some((m) => /Onde inconnue/.test(m)));
  assert.ok(p.some((m) => /pitch\.hauteur/.test(m)), 'un sous-champ inconnu doit être signalé');
  assert.ok(p.some((m) => /« couleur »/.test(m)), 'un champ inconnu doit être signalé');
  assert.ok(p.some((m) => /pitch\.start.*hors bornes/.test(m)));
  assert.deepEqual(Array.from(ctx.validateSfx(ctx.presetSfx('coin', 3))), [],
    'un preset ne doit déclencher aucun avertissement');
});

test('muter garde la nature du son : même onde, effets éteints restent éteints', () => {
  const ctx = contexte();
  const base = ctx.presetSfx('jump', 4);
  for(let g = 1; g <= 10; g++){
    const m = plat(ctx.mutateSfx(base, 0.5, g));
    assert.equal(m.wave, base.wave);
    assert.equal(m.vibrato.depth, 0, 'une mutation ne doit pas inventer un vibrato');
    assert.equal(m.filter.lowpass, 1, 'ni un filtre');
    assert.ok(m.pitch.start >= base.pitch.start / 2 && m.pitch.start <= base.pitch.start * 2,
      'la hauteur bouge d une octave au plus : ' + m.pitch.start);
  }
  // amount = 0 : seule la graine change.
  const zero = plat(ctx.mutateSfx(base, 0, 1));
  assert.equal(zero.pitch.start, base.pitch.start);
});

test('fusion partielle : « plus grave » ne touche que la hauteur', () => {
  const ctx = contexte();
  const base = ctx.presetSfx('laser', 2);
  const grave = plat(ctx.mergeSfx(base, {pitch: {start: 400}}));
  assert.equal(grave.pitch.start, 400);
  assert.equal(grave.pitch.slide, base.pitch.slide, 'le reste du groupe pitch ne bouge pas');
  assert.equal(grave.wave, base.wave);
});

test('toAudioBuffer copie les échantillons au bon débit', () => {
  const ctx = contexte();
  let cree = null;
  const faux = {createBuffer(ch, n, sr){
    const data = new Float32Array(n);
    cree = {ch, n, sr, getChannelData(){ return data; }, data};
    return cree;
  }};
  const s = ctx.renderSfx(ctx.presetSfx('blip', 1));
  ctx.toAudioBuffer(faux, s, ctx.SFX_SAMPLE_RATE);
  assert.equal(cree.ch, 1);
  assert.equal(cree.sr, 22050);
  assert.equal(cree.n, s.length);
  assert.equal(cree.data[100], s[100]);
});

test('UN BRUITAGE SE JOUE PARTOUT où un son importé se joue — éditeur, jeu publié, copilote', () => {
  // Le défaut qu'on ne veut pas : un `sfx` accepté par l'éditeur mais refusé en silence par le jeu
  // publié, parce qu'un `kind === 'audio'` y serait resté. Le joueur n'entendrait rien, sans erreur.
  const data = read('js/component-data.js');
  assert.ok(/PLAYABLE_AUDIO_KINDS = \['audio', 'sfx', 'musicLoop'\]/.test(data));
  const sites = {
    'js/audio.js': /isPlayableAudio\(x\) && x\.name === nameAsset/,
    'js/game-runtime.js': /isPlayableAudio\(assetsById\[k\]\) && assetsById\[k\]\.name === nameAsset/,
    'js/ui/panels-components.js': /assets\.filter\(isPlayableAudio\)/,
    'js/hierarchy.js': /isPlayableAudio\(asset\)\) attachAudioAsset/,
    'js/copilot-workshop.js': /isPlayableAudio\(x\) && x\.name === a\.sound/
  };
  for(const [f, re] of Object.entries(sites)) assert.ok(re.test(read(f)), f + ' ne passe pas par isPlayableAudio');
  // Le jeu publié CALCULE le son par le même module, il ne le recopie pas.
  const rt = read('js/game-runtime.js');
  assert.ok(/from '\.\/chip-synth\.js'/.test(rt) && /da\.kind === 'sfx'[\s\S]{0,400}?sfxBuffer\(/.test(rt));
  assert.ok(!/function renderSfx|function normalizeSfx/.test(rt), 'le runtime ne doit pas recopier chip-synth');
});

test('la recette voyage : .p3d, fichier .sfx.json, relecture du dossier', () => {
  const ser = read('js/serialization.js');
  assert.ok(/kind:'sfx', name:a\.name, folder:a\.folder \|\| '',\s*recipe:/.test(ser), '.p3d : la recette n est pas écrite');
  assert.ok(/'\.sfx\.json'/.test(ser), 'format dossier : pas de fichier .sfx.json');
  assert.ok(/x\.kind === 'sfx'[\s\S]{0,200}?createAssetSfx\(da\.recipe/.test(ser), 'relecture : le bruitage n est pas recréé');
  const pf = read('js/project-folder.js');
  assert.ok(/\\.sfx\\.json\$\/i,\s*'sfx'/.test(pf), 'un .sfx.json posé à la main ne serait pas découvert');
  assert.ok(/da\.kind === 'sfx' \? \{recipe:/.test(pf), 'le fichier .sfx.json n est pas relu en recette');
});

test('les commandes du copilote et le rack passent par les MÊMES fonctions', () => {
  const cw = read('js/copilot-workshop.js');
  for(const n of ['create_sfx', 'edit_sfx', 'mutate_sfx']) assert.ok(cw.includes("name: '" + n + "'"), n + ' manque');
  assert.ok(/createAssetSfx\(recipe/.test(cw) && /setSfxRecipe\(asset/.test(cw));
  // La liste des presets du schéma est écrite en dur (lire une constante d'un autre module au
  // premier niveau est interdit, règle 3) : elle doit donc rester ÉGALE à celle du moteur.
  const ctx = contexte();
  const liste = cw.match(/SFX_PRESETS_LIST = \[([^\]]*)\]/)[1].match(/'([^']+)'/g).map((s) => s.slice(1, -1));
  assert.deepEqual(liste, Array.from(ctx.SFX_PRESET_NAMES), 'le schéma du copilote et le moteur ne listent pas les mêmes presets');
  const rackSrc = read('js/sound-rack.js');
  assert.ok(/setSfxRecipe\(a,/.test(rackSrc) && /createAssetSfx\(/.test(rackSrc));
  // Et le rack a un curseur pour CHAQUE réglage numérique du moteur (la graine mise à part).
  for(const p of Object.keys(ctx.SFX_BOUNDS)){
    if(p === 'seed') continue;
    assert.ok(rackSrc.includes("path: '" + p + "'"), 'SX-1 n a pas de curseur pour « ' + p + ' »');
  }
});

test('RÉGRESSION § 3.5 — une enveloppe plus longue que 5 s est raccourcie, pas coupée net', () => {
  const ctx = contexte();
  const r = plat(ctx.normalizeSfx({envelope: {attack: 2, sustain: 2, decay: 3}}));
  const total = r.envelope.attack + r.envelope.sustain + r.envelope.decay;
  assert.ok(total <= 5 + 1e-9, 'enveloppe de ' + total + ' s');
  assert.equal(r.envelope.attack, 2, 'l attaque n est jamais raccourcie');
  const s = ctx.renderSfx({wave: 'square', envelope: {attack: 2, sustain: 2, decay: 3}});
  let crete = 0;
  for(let i = s.length - 200; i < s.length; i++) crete = Math.max(crete, Math.abs(s[i]));
  assert.ok(crete < 0.05, 'les 200 derniers échantillons doivent être éteints (crête ' + crete.toFixed(3) + ')');
});

test('RÉGRESSION § 3.11 — le générateur à graine ne retombe pas dans un cycle court', () => {
  const ctx = contexte();
  const rnd = ctx.sfxRandom(1);
  const vus = new Set();
  for(let i = 0; i < 50000; i++) vus.add(rnd());
  assert.ok(vus.size > 49000, 'seulement ' + vus.size + ' valeurs distinctes sur 50 000');
});
