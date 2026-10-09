import { deEsm } from './engine-env.mjs';
// Les bus de mixage (js/audio-bus.js), partagés éditeur/jeu publié.
//
// Le test qui porte le fichier est celui du ROUTAGE : un son three sort par `sound.gain`, et c'est ce
// seul maillon qu'on rebranche. Si on débranchait autre chose, une source 3D perdrait son
// panoramique ; si on ne débranchait rien, le son irait À LA FOIS au bus et directement aux
// haut-parleurs — baisser la musique ne la baisserait qu'à moitié, et personne ne saurait pourquoi.
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
  const bac = {console, Math, JSON, Number, String, Object, Array, isFinite};
  bac.window = bac; bac.self = bac; bac.globalThis = bac;
  const ctx = vm.createContext(bac);
  vm.runInContext(deEsm(read('js/audio-bus.js')), ctx, {filename: 'js/audio-bus.js'});
  return ctx;
}

/** Un nœud Web Audio factice : il RETIENT où il est branché. */
function fauxNoeud(nom){
  return {
    nom: nom, gain: {value: 1}, sorties: [],
    connect(n){ this.sorties.push(n); return n; },
    disconnect(){ this.sorties = []; }
  };
}
function fauxContexte(){
  const c = {destination: fauxNoeud('haut-parleurs'), crees: 0};
  c.createGain = function(){ c.crees++; return fauxNoeud('gain' + c.crees); };
  return c;
}

test('LE ROUTAGE ne rebranche que la sortie du son — le test qui porte le fichier', () => {
  const ctx = contexte();
  const ac = fauxContexte();
  const entreeListener = fauxNoeud('listener');
  const mix = ctx.createAudioBuses(ac, entreeListener, null);

  // Ce que three construit pour une PositionalAudio : panner → gain → entrée du listener.
  const gain = fauxNoeud('gain-son');
  const panner = fauxNoeud('panner');
  panner.connect(gain);
  gain.connect(entreeListener);
  const son = {gain: gain, panner: panner};

  assert.equal(mix.route(son, 'music'), true);
  assert.deepEqual(gain.sorties.map((n) => n.nom), [mix.nodes.music.nom],
    'le son doit sortir par le bus « music » SEULEMENT — pas aussi vers le listener');
  assert.equal(panner.sorties[0], gain, 'le panoramique 3D, en amont, ne doit pas être touché');

  // Le graphe : music et sfx → master → listener.
  assert.equal(mix.nodes.music.sorties[0], mix.nodes.master);
  assert.equal(mix.nodes.sfx.sorties[0], mix.nodes.master);
  assert.equal(mix.nodes.master.sorties[0], entreeListener);
});

test('un bus inconnu route sur « sfx », et un objet sans gain est refusé sans lever', () => {
  const ctx = contexte();
  const mix = ctx.createAudioBuses(fauxContexte(), fauxNoeud('l'), null);
  const gain = fauxNoeud('g');
  mix.route({gain: gain}, 'n-importe-quoi');
  assert.equal(gain.sorties[0], mix.nodes.sfx);
  assert.equal(mix.route(null, 'music'), false);
  assert.equal(mix.route({}, 'music'), false);
});

test('LA MIGRATION : une source sans bus sort sur « sfx », et le mélange par défaut ne change rien', () => {
  const ctx = contexte();
  assert.equal(ctx.busOfSource({}), 'sfx');
  assert.equal(ctx.busOfSource(null), 'sfx');
  assert.equal(ctx.busOfSource({bus: 'music'}), 'music');
  // `master` n'est pas un bus de SOURCE : tout y passe déjà, y router une source la ferait échapper
  // aux curseurs Musique et Effets.
  assert.equal(ctx.busOfSource({bus: 'master'}), 'sfx');
  // Un projet d'avant les bus : tout à 1, donc exactement le son d'avant.
  assert.deepEqual(plat(ctx.sanitizeAudioBuses(undefined)), {master: 1, music: 1, sfx: 1});
});

test('les volumes lus d un fichier sont bornés, et un 0 EXPLICITE reste 0', () => {
  const ctx = contexte();
  assert.deepEqual(plat(ctx.sanitizeAudioBuses({master: 0, music: 'abc', sfx: 7})),
    {master: 0, music: 1, sfx: 2}, 'un 0 est un choix (musique coupée), un NaN un fichier abîmé');
  assert.deepEqual(plat(ctx.sanitizeAudioBuses({master: -1, music: null, sfx: 0.5})),
    {master: 0, music: 1, sfx: 0.5});
});

test('LA SOURDINE se superpose au volume sans l effacer', () => {
  const ctx = contexte();
  const mix = ctx.createAudioBuses(fauxContexte(), fauxNoeud('l'), {music: 0.6});
  assert.equal(mix.nodes.music.gain.value, 0.6);
  mix.mute('music', true);
  assert.equal(mix.nodes.music.gain.value, 0);
  // Un volume réglé PENDANT la sourdine est retenu, pas appliqué.
  mix.setVolume('music', 0.3);
  assert.equal(mix.nodes.music.gain.value, 0);
  assert.equal(mix.volume('music'), 0.3);
  mix.mute('music', false);
  assert.equal(mix.nodes.music.gain.value, 0.3);
  mix.mute('sfx');
  mix.resetMutes();
  assert.equal(mix.isMuted('sfx'), false);
  // `apply` relit les réglages du projet — c'est le retour au mélange de l'auteur.
  mix.apply({master: 0.5});
  assert.equal(mix.nodes.master.gain.value, 0.5);
  assert.equal(mix.nodes.music.gain.value, 1);
});

test('api.audioBus : un bus inconnu est DIT, et sa poignée est inerte', () => {
  const ctx = contexte();
  const mix = ctx.createAudioBuses(fauxContexte(), fauxNoeud('l'), null);
  const dits = [];
  const faux = ctx.makeAudioBusApi(() => mix, 'musique', (m) => dits.push(m));
  assert.equal(dits.length, 1);
  assert.ok(/master, music, sfx/.test(dits[0]), 'le message doit lister les bus existants');
  assert.equal(faux.volume(0.2), 0);
  assert.equal(faux.mute(true), false);

  const music = ctx.makeAudioBusApi(() => mix, 'music', (m) => dits.push(m));
  assert.equal(music.volume(0.4), 0.4);
  assert.equal(mix.nodes.music.gain.value, 0.4);
  assert.equal(music.mute(true), true);
  assert.equal(music.muted(), true);
  // Avant que l'audio soit prêt, la poignée répond sans lever.
  const tot = ctx.makeAudioBusApi(() => null, 'sfx', () => {});
  assert.equal(tot.volume(), 0);
  assert.equal(tot.muted(), false);
});

test('LES DEUX MOTEURS routent leurs sons par les bus, et par la MÊME fonction', () => {
  // Le défaut qu'on ne veut pas revoir : un routage écrit dans l'éditeur et oublié dans le jeu publié.
  // Tout s'entendrait bien dans l'éditeur, et la musique ignorerait son curseur chez le joueur.
  const editeur = read('js/audio.js');
  const runtime = read('js/game-runtime.js');
  for(const [nom, src] of [['js/audio.js', editeur], ['js/game-runtime.js', runtime]]){
    assert.ok(/from '\.\/audio-bus\.js'/.test(src), nom + ' doit importer js/audio-bus.js');
    assert.ok(/createAudioBuses\(/.test(src), nom + ' doit construire ses bus avec createAudioBuses');
    assert.ok(/createSourceSound\(THREE, /.test(src),
      nom + ' : les sources audio doivent être construites par la fonction partagée (bus compris)');
    assert.ok(!/function createAudioBuses|function busOfSource/.test(src),
      nom + ' ne doit pas recopier le module partagé');
  }
  const scripts = read('js/scripts.js');
  assert.ok(/audioBus:\s*function\(name\)\{\s*return makeAudioBusApi\(/.test(scripts),
    'js/scripts.js doit exposer api.audioBus par makeAudioBusApi');
  assert.ok(/audioBus:function\(name\)\{\s*return makeAudioBusApi\(/.test(runtime),
    'js/game-runtime.js doit exposer api.audioBus par makeAudioBusApi');
});

test('le mélange est un réglage de PROJET : relu, borné, et parti dans le build', () => {
  const src = read('js/project-settings.js');
  assert.ok(/'audioBuses'/.test(src), 'audioBuses manque à PROJECT_SETTINGS_KEYS');
  assert.ok(/audioBuses:\s*sanitizeAudioBuses\(brut\.audioBuses\)/.test(src),
    'projectSettingsOf doit relire les volumes par sanitizeAudioBuses');
  const runtime = read('js/game-runtime.js');
  assert.ok(/createAudioBuses\([\s\S]{0,200}?DS\.audioBuses\)/.test(runtime),
    'le jeu publié doit partir des volumes réglés dans le projet');
});

test('les notes du synthé sortent par le bus « sfx » dans les deux moteurs', () => {
  // Sans destination, `playVoice` joue sur `ctx.destination` : les notes échapperaient au volume
  // général — un jeu « muet » par son menu d'options continuerait de biper.
  const scripts = read('js/scripts.js');
  const runtime = read('js/game-runtime.js');
  assert.ok(/makeSynthApi\([\s\S]{0,300}?audioMix\(\)\.node\('sfx'\)/.test(scripts));
  assert.ok(/makeSynthApi\([\s\S]{0,300}?rtAudioMix\(\)\.node\('sfx'\)/.test(runtime));
});

test('le panneau « Audio » (menu Fenêtres) est le Rack sonore, dont le mixeur couvre TOUS les bus', () => {
  const html = read('editor.html');
  assert.ok(!html.includes('id="btn-audio"'), 'le bouton Audio a quitté la barre du haut');
  assert.ok(html.includes('id="sound-rack"'), 'l\'hôte du panneau manque à editor.html');
  assert.ok(html.includes('src="js/sound-rack.js"'), 'js/sound-rack.js n\'est pas chargé par l\'éditeur');
  assert.ok(/id: 'sound-rack'[\s\S]{0,120}?adopt: 'sound-rack'/.test(read('js/ui/panels-shell.js')),
    'le panneau sound-rack n\'est pas déclaré au dock');
  // Un bus ajouté à AUDIO_BUSES sans tranche dans le mixeur serait réglable partout sauf là où
  // l'on regarde le mélange.
  const rack = read('js/sound-rack.js');
  const ctx = contexte();
  for(const bus of Array.from(vm.runInContext('AUDIO_BUSES', ctx))){
    assert.ok(new RegExp("bus: '" + bus + "'").test(rack), 'le mixeur n\'a pas de tranche pour « ' + bus + ' »');
  }
});

test('RÉGRESSION § 3.6 — mute(0) et mute("false") ne coupent pas le bus', () => {
  const ctx = contexte();
  const mix = ctx.createAudioBuses(fauxContexte(), fauxNoeud('l'), null);
  for(const v of [0, false, 'false', null]){
    mix.mute('music', true);
    mix.mute('music', v);
    assert.equal(mix.isMuted('music'), false, 'mute(' + JSON.stringify(v) + ') ne doit pas couper');
  }
  mix.mute('music');
  assert.equal(mix.isMuted('music'), true, 'sans argument : couper');
});

test('RÉGRESSION lot B — une seule porte pour les volumes, et elle marque le projet modifié', () => {
  const audio = read('js/audio.js');
  assert.ok(/export function setProjectBusVolumes[\s\S]{0,700}?markProjectUnsaved\(\)/.test(audio));
  for(const f of ['js/copilot-workshop.js', 'js/sound-rack.js', 'js/ui/panels-settings.js']){
    assert.ok(/setProjectBusVolumes\(/.test(read(f)), f + ' doit passer par setProjectBusVolumes');
    assert.ok(!/buses\.apply\(/.test(read(f)), f + ' ne doit plus appliquer les volumes lui-même');
  }
  // À l'ouverture d'un projet : son mélange, pas celui du précédent ; l'écoute du rack s'arrête.
  assert.ok(/export function applyProjectSettings[\s\S]{0,1200}?resetAudioMix\(\)[\s\S]{0,200}?stopSoundRackPlayback\(\)/.test(read('js/project.js')));
});

test('RÉGRESSION § 6.5 — une source se construit, se règle, se branche au bus et se lance au même endroit', () => {
  const ctx = contexte();
  const joues = [];
  function Faux(){ this.gain = fauxNoeud('gain-son'); this.reglages = {}; }
  Faux.prototype.setBuffer = function(b){ this.reglages.buffer = b; };
  Faux.prototype.setLoop = function(v){ this.reglages.loop = v; };
  Faux.prototype.setVolume = function(v){ this.reglages.volume = v; };
  Faux.prototype.setPlaybackRate = function(v){ this.reglages.pitch = v; };
  Faux.prototype.play = function(){ joues.push(this); };
  const THREE = {Audio: Faux, PositionalAudio: Faux};
  const mix = ctx.createAudioBuses(fauxContexte(), fauxNoeud('l'), null);
  const son = ctx.createSourceSound(THREE, {}, {bus: 'music', loop: true, volume: 0.5, pitch: 2}, 'B', mix, null, null);
  assert.deepEqual(plat(son.reglages), {buffer: 'B', loop: true, volume: 0.5, pitch: 2});
  assert.equal(son.gain.sorties[0], mix.nodes.music);
  assert.equal(joues.length, 1, 'auto par défaut : le son part');
  // Un play() qui lève est DIT, dans les deux moteurs.
  const dits = [];
  Faux.prototype.play = function(){ throw new Error('refus du navigateur'); };
  ctx.createSourceSound(THREE, {}, {}, 'B', mix, null, (m) => dits.push(m));
  assert.ok(/refus du navigateur/.test(dits[0] || ''));
});
