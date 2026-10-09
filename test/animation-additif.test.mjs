import { deEsm } from './engine-env.mjs';
// Une couche additive rate de trois façons, et aucune ne lève d'erreur :
//
//  · elle DÉRIVE — l'écart se recompose à chaque image, l'os s'éloigne un peu plus, doucement,
//    jusqu'à sortir de l'écran, et l'animation « a l'air cassée » sans qu'on sache depuis quand ;
//  · elle est LUE DANS LE MAUVAIS SENS — la même clé vaut « +10° » ou « à 10° » selon le mode,
//    et se tromper envoie l'os à l'autre bout de la scène ;
//  · elle DIVERGE entre l'éditeur et le jeu publié, et là on ne le voit qu'après l'export.
//
// Ce fichier tient les trois. La composition elle-même est vérifiée en exécutant le VRAI
// `applyAnimation` de js/animation.js dans un `vm`, pas une réécriture : une réécriture
// prouverait que ma copie est juste, pas que le moteur l'est.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const racineMoteur = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(racineMoteur, f), 'utf8');
const codeSeul = (src) => src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

// js/animation.js est très lié au DOM : il attrape ses boutons au chargement et branche des
// écouteurs. On lui donne un document en carton — le but n'est pas de simuler l'éditeur, mais
// d'exécuter `applyAnimation` sur de vraies classes three.
function contexte(){
  const el = () => ({
    style:{}, classList:{toggle(){}, add(){}, remove(){}, contains(){ return false; }},
    addEventListener(){}, appendChild(){}, textContent:'', value:'', disabled:false,
    dataset:{}, innerHTML:'', getBoundingClientRect(){ return {left:0, width:100, top:0, height:10}; },
    closest(){ return null; }, querySelector(){ return null; }, querySelectorAll(){ return []; }
  });
  const bac = {console, Math, JSON, Set, Map, Array, Object, Float32Array, prompt:() => null};
  bac.window = bac; bac.self = bac; bac.globalThis = bac;
  bac.document = {getElementById: el, querySelector: el, querySelectorAll(){ return []; },
                  addEventListener(){}, createElement: el, body: el()};
  bac.setStatus = () => {};
  bac.pushHistory = () => {};
  bac.updateTimeline = () => {};
  bac.syncInspector = () => {};
  bac.updateHierarchy = () => {};
  bac.escapeHtml = (s) => String(s);
  bac.iconOf = () => '';
  bac.selection = null;
  bac.objects = [];
  bac.assets = [];
  bac.boneSelected = null;
  bac.engineScripts = {ecouteurs:{}};
  bac.logConsole = () => {};
  const ctx = vm.createContext(bac);
  vm.runInContext(deEsm(read('vendor/three.min.js')), ctx, {filename:'vendor/three.min.js'});
  vm.runInContext(deEsm(read('js/anim-markers.js')), ctx, {filename:'js/anim-markers.js'});
  // AVANT animation.js, comme dans editor.html : `poseOfClip` y délègue son échantillonnage,
  // qui est désormais partagé avec le runtime. Un harnais qui charge moins que la page finit
  // par éprouver un assemblage qui n'existe nulle part.
  vm.runInContext(deEsm(read('js/animator.js')), ctx, {filename:'js/animator.js'});
  vm.runInContext(deEsm(read('js/track-sampling.js')), ctx, {filename:'js/track-sampling.js'});
  vm.runInContext(deEsm(read('js/animation.js')), ctx, {filename:'js/animation.js'});
  return ctx;
}

// Un objet nu, et un faux clip qui repose la base à chaque appel — c'est exactement ce que fait
// un mixeur three, et c'est la seule propriété dont dépend la couche additive.
function scene(ctx, baseY){
  const T = ctx.THREE;
  const obj = new T.Object3D();
  obj.name = 'perso';
  const anim = vm.runInContext('anim', ctx);
  const clipShown = vm.runInContext('clipShown', ctx);
  clipShown.obj = obj;
  // Le clip doit porter une piste AU NOM de la cible : c'est ce que `clipDriven` vérifie, os
  // par os. Un clip qui n'anime pas cet os-là ne repose pas sa base, donc rien à quoi s'add.
  clipShown.clip = {name:'marche', duration:1, tracks:[
    new T.QuaternionKeyframeTrack('perso.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1])
  ]};
  clipShown.action = {time:0};
  // updateClipShown est remplacée par une base connue : on teste la COMPOSITION, pas three.
  ctx.updateClipShown = function(){
    obj.position.set(0, baseY, 0);
    obj.quaternion.set(0, 0, 0, 1);
    obj.scale.set(1, 1, 1);
  };
  return {obj, anim, clipShown};
}

// --- la composition ------------------------------------------------------------------------

test('une piste ADDITIVE ajoute son ecart a la pose du clip', () => {
  const ctx = contexte();
  const {obj, anim} = scene(ctx, 10);
  anim.tracks.push({obj:obj, os:null, additif:true,
    keys:[{t:0, pos:[0, 2, 0], quat:[0, 0, 0, 1], ech:[1, 1, 1]}]});

  ctx.applyAnimation(0);
  assert.equal(obj.position.y, 12, 'attendu base 10 + écart 2 ; obtenu ' + obj.position.y);
});

test('une piste qui REMPLACE impose sa pose, sans regarder le clip', () => {
  const ctx = contexte();
  const {obj, anim} = scene(ctx, 10);
  anim.tracks.push({obj:obj, os:null, additif:false,
    keys:[{t:0, pos:[0, 2, 0], quat:[0, 0, 0, 1], ech:[1, 1, 1]}]});

  ctx.applyAnimation(0);
  // Le mode par défaut historique : sans ce test, rendre tout additif passerait inaperçu sur
  // les projets existants — ils bougeraient « un peu », ce qui ressemble à un réglage.
  assert.equal(obj.position.y, 2, 'attendu la pose absolue 2 ; obtenu ' + obj.position.y);
});

test('apply DEUX FOIS le meme instant donne le meme resultat (aucune derive)', () => {
  const ctx = contexte();
  const {obj, anim} = scene(ctx, 10);
  anim.tracks.push({obj:obj, os:null, additif:true,
    keys:[{t:0, pos:[0, 2, 0], quat:[0, 0, 0, 1], ech:[1, 1, 1]}]});

  ctx.applyAnimation(0);
  const premier = obj.position.y;
  for(let i = 0; i < 20; i++) ctx.applyAnimation(0);
  // LE défaut à craindre : 12, 14, 16… La dérive est lente, sans erreur, et on l'attribue à
  // l'animation plutôt qu'au moteur. Vingt images suffisent à la rendre criante.
  assert.equal(obj.position.y, premier,
    'après 21 images au même instant : ' + obj.position.y + ' au lieu de ' + premier);
});

test('une piste additive SANS clip ne fait rien — plutot que de deriver', () => {
  const ctx = contexte();
  const {obj, anim, clipShown} = scene(ctx, 10);
  clipShown.action = null;              // plus rien ne repose la base
  clipShown.clip = null;
  ctx.updateClipShown = function(){};      // et donc plus personne n'écrit la base
  obj.position.set(0, 5, 0);
  anim.tracks.push({obj:obj, os:null, additif:true,
    keys:[{t:0, pos:[0, 2, 0], quat:[0, 0, 0, 1], ech:[1, 1, 1]}]});

  for(let i = 0; i < 30; i++) ctx.applyAnimation(0);
  // Sans base reposée, composer l'écart trente fois donnerait y = 65. La piste doit être
  // INERTE : c'est visible (rien ne bouge) là où la dérive ne l'est pas.
  assert.equal(obj.position.y, 5,
    'la piste a dérivé jusqu’à ' + obj.position.y + ' faute de base à quoi s’add');
});

test('un os que le clip N ANIME PAS ne recoit pas de calque additive', () => {
  const ctx = contexte();
  const T = ctx.THREE;
  const {obj, anim, clipShown} = scene(ctx, 10);
  // Un clip humanoïde anime 52 os sur 65 : les bouts de doigts, le sommet du crâne ne bougent
  // jamais. Sur CES os-là, personne ne repose la base — la question se pose donc par os, pas
  // par objet, et la traiter par objet ferait dériver un doigt pendant que le body marche.
  clipShown.clip = {name:'marche', duration:1, tracks:[
    new T.QuaternionKeyframeTrack('unAutreOs.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1])
  ]};
  obj.position.set(0, 5, 0);
  anim.tracks.push({obj:obj, os:null, additif:true,
    keys:[{t:0, pos:[0, 2, 0], quat:[0, 0, 0, 1], ech:[1, 1, 1]}]});
  ctx.updateClipShown = function(){};        // le clip n'écrit rien sur cette cible

  for(let i = 0; i < 30; i++) ctx.applyAnimation(0);
  assert.equal(obj.position.y, 5,
    'la piste a dérivé jusqu’à ' + obj.position.y + ' sur un os que le clip n’anime pas');
});

test('un clip AFFICHE mais sans action en cours ne sert pas de base', () => {
  const ctx = contexte();
  const {obj, anim, clipShown} = scene(ctx, 10);
  // Le clip est là, ses pistes aussi, mais aucune action ne tourne : personne n'écrit la pose.
  // C'est ce que laisse `stopClipShown` à mi-chemin, et un mixeur qui n'a pas démarré.
  clipShown.action = null;
  ctx.updateClipShown = function(){};
  obj.position.set(0, 5, 0);
  anim.tracks.push({obj:obj, os:null, additif:true,
    keys:[{t:0, pos:[0, 2, 0], quat:[0, 0, 0, 1], ech:[1, 1, 1]}]});

  for(let i = 0; i < 20; i++) ctx.applyAnimation(0);
  assert.equal(obj.position.y, 5,
    'dérive à ' + obj.position.y + ' : la présence d’un clip ne suffit pas, il faut qu’une '
    + 'action REPOSE la base à chaque image');
});

test('l ecart de ROTATION se compose, il ne remplace pas', () => {
  const ctx = contexte();
  const T = ctx.THREE;
  const {obj, anim} = scene(ctx, 0);
  const q45 = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), Math.PI / 4);
  // La base n'est plus l'identité : c'est le seul montage où « composer » et « remplacer »
  // donnent des résultats différents.
  ctx.updateClipShown = function(){
    obj.position.set(0, 0, 0); obj.scale.set(1, 1, 1);
    obj.quaternion.copy(q45);
  };
  const q30 = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), Math.PI / 6);
  anim.tracks.push({obj:obj, os:null, additif:true,
    keys:[{t:0, pos:[0, 0, 0], quat:q30.toArray(), ech:[1, 1, 1]}]});

  ctx.applyAnimation(0);
  const attendu = q45.clone().multiply(q30);           // 45° + 30° = 75°
  const gap = 2 * Math.acos(Math.min(1, Math.abs(obj.quaternion.dot(attendu)))) * 180 / Math.PI;
  assert.ok(gap < 0.01, 'écart de ' + gap.toFixed(2) + '° — la rotation n’est pas composée');
});

test('l ecart d ECHELLE se multiplie, il ne remplace pas', () => {
  const ctx = contexte();
  const {obj, anim} = scene(ctx, 0);
  ctx.updateClipShown = function(){
    obj.position.set(0, 0, 0); obj.quaternion.set(0, 0, 0, 1); obj.scale.set(2, 2, 2);
  };
  anim.tracks.push({obj:obj, os:null, additif:true,
    keys:[{t:0, pos:[0, 0, 0], quat:[0, 0, 0, 1], ech:[1.5, 1.5, 1.5]}]});
  ctx.applyAnimation(0);
  // Une échelle s'ajoute mal : +1,5 sur une base de 2 donnerait 3,5 au lieu de 3, et un écart
  // « neutre » vaudrait 0 au lieu de 1. Le neutre multiplicatif est 1, et il doit l'être.
  assert.equal(obj.scale.x, 3, 'attendu 2 × 1,5 = 3 ; obtenu ' + obj.scale.x);
});

test('un ecart NEUTRE ne change rien a la pose du clip', () => {
  const ctx = contexte();
  const {obj, anim} = scene(ctx, 7);
  anim.tracks.push({obj:obj, os:null, additif:true,
    keys:[{t:0, pos:[0, 0, 0], quat:[0, 0, 0, 1], ech:[1, 1, 1]}]});
  ctx.applyAnimation(0);
  assert.equal(obj.position.y, 7);
  assert.equal(obj.scale.x, 1);
});

// --- la CAPTURE de la clé ---------------------------------------------------------------

test('poser une cle additive enregistre l ECART, lu dans le clip et pas sur l os', () => {
  const ctx = contexte();
  const T = ctx.THREE;
  const {obj, anim, clipShown} = scene(ctx, 0);
  // Un clip qui tourne l'objet de 45° à l'instant 0.
  const q45 = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), Math.PI / 4);
  clipShown.clip = {name:'marche', duration:1, tracks:[
    new T.QuaternionKeyframeTrack('perso.quaternion', [0, 1],
      q45.toArray().concat(q45.toArray()))
  ]};
  ctx.selection = obj;
  anim.t = 0;

  // L'utilisateur tourne de 30° DE PLUS que ce que dit le clip.
  const q30 = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), Math.PI / 6);
  obj.quaternion.copy(q45).multiply(q30);
  ctx.setKey();

  const p = anim.tracks[0];
  assert.ok(p, 'aucune piste créée');
  assert.equal(p.additif, true, 'une piste neuve doit naître additive quand un clip joue');
  const enregistre = new T.Quaternion().fromArray(p.keys[0].quat);
  const gap = 2 * Math.acos(Math.min(1, Math.abs(enregistre.dot(q30)))) * 180 / Math.PI;
  // LE défaut mesuré dans le navigateur : la base était relue via le mixeur, qui ne réécrit
  // pas une valeur qu'il croit inchangée. L'os gardait donc la pose de l'utilisateur, la
  // différence valait l'identité, et la clé enregistrée était [0,0,0,1] — un « +0° » parfait.
  assert.ok(gap < 0.1, 'écart enregistré à ' + gap.toFixed(2) + '° des 30° attendus — la '
    + 'base a-t-elle été lue sur l’os plutôt que dans le clip ?');
});

test('poser une cle SANS clip enregistre la pose absolue, et la piste remplace', () => {
  const ctx = contexte();
  const {obj, anim, clipShown} = scene(ctx, 0);
  clipShown.clip = null; clipShown.action = null;
  ctx.selection = obj;
  anim.t = 0;
  obj.position.set(1, 2, 3);
  ctx.setKey();
  const p = anim.tracks[0];
  assert.equal(p.additif, false, 'sans clip, il n’y a rien à quoi s’add');
  assert.deepEqual(Array.from(p.keys[0].pos), [1, 2, 3]);
});

// --- le miroir editeur / runtime -------------------------------------------------------------

test('le runtime lit `additif` et compose comme l editeur', () => {
  const rt = codeSeul(read('js/game-runtime.js'));
  const start = rt.indexOf('function applyAnimation(');
  assert.notEqual(start, -1, 'applyAnimation a disparu du runtime');
  const body = rt.slice(start, rt.indexOf('\n}', start));
  // La divergence éditeur/runtime est la famille de défaut la plus coûteuse de ce dépôt :
  // elle est invisible tant qu'on n'exporte pas. Ces trois motifs sont ceux qui la fermeraient
  // s'ils disparaissaient.
  assert.match(body, /p\.additif/, 'le runtime ignore le mode : une calque additive y sera lue '
    + 'comme une pose absolue, et l’object partira à l’autre bout de la scène');
  // PAR OS, comme l'éditeur (revue du 2026-09-29, § 1.7) : l'animation doit écrire la pose de CETTE
  // cible. Le test « une animation tourne sur l'objet » laissait dériver un os que le clip n'anime pas.
  assert.match(body, /rtClipDrives\(p\.obj, target\)/,
    'le runtime ne vérifie pas que l’animation repose la base DE CET OS : la piste dérivera');
  assert.match(rt, /function rtClipDrives[\s\S]{0,300}?additiveHasBase\(/,
    'le runtime doit décider avec la même fonction que l’éditeur (js/track-sampling.js)');
  assert.match(read('js/animation.js'), /return additiveHasBase\(clipShown\.clip, target\)/);
  // La composition vit dans js/track-sampling.js, que le runtime appelle avec le mode de la piste.
  assert.match(body, /applyTrackSample\(target, segmentAt\(keys, t\), p\.additif/,
    'le runtime ne passe pas le mode additif à l échantillonnage partagé');
  assert.match(read('js/track-sampling.js'), /target\.quaternion\.multiply/,
    'l échantillonnage partagé ne COMPOSE pas la rotation');
});

test('dans le runtime les clips passent AVANT les pistes, comme dans l editeur', () => {
  const rt = codeSeul(read('js/game-runtime.js'));
  // L'APPEL, pas la définition. `lastIndexOf('rtUpdateAnimations(dt)')` matche aussi
  // `function rtUpdateAnimations(dt){`, qui vit en haut du fichier : supprimer l'appel laissait
  // la garde verte, puisque la définition est bien avant les pistes. Mutation qui a survécu
  // une fois — même famille que l'assertion sur `updateClipShown` en v0.35.
  const iMix = rt.lastIndexOf('\n  rtUpdateAnimations(');
  const iPistes = rt.lastIndexOf('applyAnimation(game.t)');
  assert.ok(iMix > 0, 'l’appel à rtUpdateAnimations a disparu de la boucle du runtime');
  assert.ok(iPistes > 0, 'applyAnimation a disparu de la boucle du runtime');
  // C'est l'ordre qui rend la composition possible : composer un écart avant que la base
  // n'existe ne veut rien dire. Et c'était DÉJÀ une divergence avant les couches additives —
  // depuis la v0.32.2, l'éditeur donnait la clé et le jeu publié le clip, pour la même scène.
  assert.ok(iMix < iPistes,
    'les mixeurs passent après les pistes : le clip écrase la clé dans le jeu publié, et une '
    + 'layer additive n’a aucune base sur quoi se poser');
});

test('les trois etapes de persistance connaissent `additif`', () => {
  // Écriture, relecture, runtime. Une seule manquante, et le mode se perd à l'enregistrement :
  // les mêmes nombres sont alors relus dans l'autre sens, en silence.
  const manquantes = [];
  const histo = read('js/history.js');
  if(histo.indexOf('additif:!!p.additif') === -1) manquantes.push('écriture (history.js)');
  if(histo.indexOf('additif: !!dp.additif') === -1) manquantes.push('relecture (history.js)');
  if(read('js/game-runtime.js').indexOf('additif:!!dp.additif') === -1) manquantes.push('runtime');
  assert.deepEqual(manquantes, [], 'étapes qui perdent le mode : ' + manquantes.join(', '));
});
