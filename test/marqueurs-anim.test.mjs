import { deEsm } from './engine-env.mjs';
// Un marker d'animation rate de deux façons, et les deux sont silencieuses : il se déclenche
// DEUX fois (deux sons de pas pour un pas) ou il ne se déclenche JAMAIS (le pas est muet).
// Aucune des deux ne lève d'erreur, et aucune ne se voit sur une capture d'écran.
//
// Le franchissement est la seule partie qu'on peut mettre à l'épreuve sans moteur de rendu.
// C'est aussi la seule où une erreur ne se rattrape pas à l'œil : à soixante images par
// seconde, un intervalle mal borné produit un doublon toutes les quelques secondes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const racineMoteur = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(racineMoteur, f), 'utf8');

function contexte(){
  const bac = {console, Math, JSON, Set, Map, Array, Object, Float32Array, Uint16Array};
  bac.window = bac; bac.self = bac; bac.globalThis = bac;
  const ctx = vm.createContext(bac);
  // `sourceOfClipPlays` lit désormais `externalClipsOf` (js/anim-models.js), qui n'a besoin ici
  // que de `skinnedMeshRendererOf` — mais le fichier référence THREE en tête (des Quaternion de
  // travail), donc le vrai three vendorisé doit être chargé même si ce test ne l'exerce pas.
  vm.runInContext(deEsm(read('vendor/three.min.js')), ctx, {filename:'vendor/three.min.js'});
  vm.runInContext(deEsm(read('js/anim-models.js')), ctx, {filename:'js/anim-models.js'});
  vm.runInContext(deEsm(read('js/anim-markers.js')), ctx, {filename:'js/anim-markers.js'});
  return ctx;
}

const M = (...ts) => ts.map((t, i) => ({t, name:'m' + i}));
const names = (list) => Array.from(list.map((m) => m.name));

// --- l'intervalle -------------------------------------------------------------------------

test('un marker pile sur le DEBUT de l intervalle ne se rejoue pas', () => {
  const ctx = contexte();
  // À l'image précédente, le temps est arrivé exactement sur 0.5 et le marker a été joué.
  // L'image suivante part de 0.5 : le replay donnerait deux sons de pas pour un seul pas.
  assert.deepEqual(names(ctx.markersCrossed(M(0.5), 0.5, 0.6, 1, true)), [],
    'marker rejoué à l’image suivante : l’intervalle doit être OUVERT à gauche');
});

test('un marker pile sur la FIN de l intervalle se joue', () => {
  const ctx = contexte();
  // Symétrique du précédent, et c'est ce qui garantit qu'il se joue UNE fois : fermé à droite,
  // open à gauche. Les deux bounds ouvertes, et un marker tombant pile sur une image ne
  // serait jamais joué — un pas muet une fois sur soixante.
  assert.deepEqual(names(ctx.markersCrossed(M(0.6), 0.5, 0.6, 1, true)), ['m0']);
});

test('plusieurs markers dans une seule image sortent tous, dans l ordre', () => {
  const ctx = contexte();
  // Une image longue (chargement, tab en arrière-plan) peut couvrir plusieurs markers.
  // En sauter serait indétectable : le son missing passe pour un défaut d’animation.
  assert.deepEqual(names(ctx.markersCrossed(M(0.1, 0.2, 0.3, 0.9), 0.05, 0.35, 1, true)),
    ['m0', 'm1', 'm2']);
});

test('rien entre deux instants sans marker', () => {
  const ctx = contexte();
  assert.deepEqual(names(ctx.markersCrossed(M(0.1, 0.9), 0.2, 0.8, 1, true)), []);
});

// --- la boucle ----------------------------------------------------------------------------

test('en BOUCLE, repasser la end releve la end PUIS le start', () => {
  const ctx = contexte();
  // Le temps « recule » de 0.95 à 0.05 : il n'a pas reculé, il a fait le tour. Traiter
  // naïvement `apres < avant` comme un intervalle empty perdrait tous les markers de end de
  // cycle — et une marche en boucle perdrait un pas sur deux.
  const r = ctx.markersCrossed(M(0.2, 0.98), 0.95, 0.05, 1, true);
  assert.deepEqual(names(r), ['m1'], 'obtenu ' + names(r).join(', '));
});

test('en BOUCLE, un marker a t=0 est atteignable', () => {
  const ctx = contexte();
  // Un intervalle ouvert à gauche ne peut jamais atteindre 0 en marche avant. Le début de
  // loop est donc fermé à gauche — sans quoi t=0, qui est l'instant le plus naturel où poser
  // un marker, serait le seul qui ne marche jamais.
  assert.deepEqual(names(ctx.markersCrossed(M(0), 0.98, 0.02, 1, true)), ['m0']);
});

test('SANS loop, un retour en arriere ne declenche rien', () => {
  const ctx = contexte();
  // Sans bouclage, `apres < avant` veut dire qu'on a ramené la tête de lecture au début. Rien
  // n'a été traversé. Rejouer les markers de end de clip à ce moment-là ferait crier la
  // scène chaque fois qu'on appuie sur ⏮.
  assert.deepEqual(names(ctx.markersCrossed(M(0.2, 0.98), 0.95, 0.05, 1, false)), []);
});

// --- le scrub -----------------------------------------------------------------------------

test('deplacer la tete de lecture a la main ne declenche RIEN', () => {
  const ctx = contexte();
  const emis = [];
  const n = ctx.triggerMarkers(M(0.1, 0.2, 0.3), 0, 0.9, 1, true, false,
    (name) => emis.push(name));
  assert.equal(n, 0);
  // C'est LA règle qui rend la timeline utilisable. Sans elle, chercher une pose en glissant
  // la tête de lecture déclenche tous les sons du clip d'un coup.
  assert.deepEqual(emis, [], 'un scrub a déclenché : ' + emis.join(', '));
});

test('en playback, chaque marker franchi est EMIS par son nom', () => {
  const ctx = contexte();
  const emis = [];
  const n = ctx.triggerMarkers([{t:0.2, name:'pas'}, {t:0.7, name:'pas'}],
    0, 0.9, 1, true, true, (name) => emis.push(name));
  assert.equal(n, 2);
  assert.deepEqual(emis, ['pas', 'pas'], 'deux passages du même nom doivent émettre deux fois');
});

test('un marker sans nom n emet rien mais ne casse rien', () => {
  const ctx = contexte();
  const emis = [];
  ctx.triggerMarkers([{t:0.2, name:''}, {t:0.3, name:'ok'}], 0, 0.9, 1, true, true,
    (name) => emis.push(name));
  assert.deepEqual(emis, ['ok'],
    'un marker laissé sans nom émettrait un événement empty, que tous les écouteurs '
    + 'sans nom recevraient');
});

// --- la provenance ------------------------------------------------------------------------

test('un clip RECIBLE va chercher les markers de son fichier d origine', () => {
  const ctx = contexte();
  // `externalClips` vit désormais sur le composant SkinnedMeshRenderer (tâche 4.4) : on bouche
  // `getComponent`, le seul contrat que lit `skinnedMeshRendererOf`/`externalClipsOf`.
  const smr = {externalClips:[
    {assetId:'marche', sourceClip:'mixamo.com', localName:'Walking (1) · mixamo.com'}
  ]};
  const obj = {userData:{assetId:'perso'},
    getComponent: function(type){ return type === 'SkinnedMeshRenderer' ? smr : null; },
    traverse: function(fn){ fn(this); }};
  // Le point : un son de pas appartient à LA MARCHE, pas au personnage. Chercher les markers
  // sur l'asset du personnage les perdrait dès qu'on pose la même marche sur un second
  // personnage — c'est-à-dire exactement dans le cas que le reciblage vient de rendre possible.
  // Champ par champ, et pas `deepEqual` : l'object rendu vient du royaume du `vm`, donc il n'a
  // pas le même `Object` que celui de ce fichier et l'égalité stricte échoue sur deux valeurs
  // pourtant identiques à l'affichage. Piège récurrent des tests en `vm` de ce dépôt.
  const src = ctx.sourceOfClipPlays(obj, 'Walking (1) · mixamo.com');
  assert.equal(src.asset, 'marche', 'les markers sont cherchés sur ' + src.asset);
  assert.equal(src.clip, 'mixamo.com');
  // Un clip du modèle lui-même reste chez lui.
  const sien = ctx.sourceOfClipPlays(obj, 'idle');
  assert.equal(sien.asset, 'perso');
  assert.equal(sien.clip, 'idle');
});

test('un objet sans asset n a pas de source de markers', () => {
  const ctx = contexte();
  assert.equal(ctx.sourceOfClipPlays({userData:{}}, 'x'), null);
});

// --- pose et retrait ------------------------------------------------------------------------

test('les markers restent TRIES quand on en insere un avant les autres', () => {
  const ctx = contexte();
  const a = {id:'a1'};
  ctx.setMarker(a, 'marche', 0.8, 'tard');
  ctx.setMarker(a, 'marche', 0.2, 'tot');
  // Non trié, `markersCrossed` rendrait les événements dans le désordre d'insertion : sur
  // une image longue qui en couvre plusieurs, le son d'impact précéderait celui de l'élan.
  assert.deepEqual(Array.from(ctx.markersOfClip(a, 'marche').map((m) => m.name)),
    ['tot', 'tard']);
});

test('les markers d un clip ne debordent pas sur un autre', () => {
  const ctx = contexte();
  const a = {id:'a1'};
  ctx.setMarker(a, 'marche', 0.2, 'pas');
  ctx.setMarker(a, 'jump', 0.5, 'impact');
  assert.equal(ctx.markersOfClip(a, 'marche').length, 1);
  assert.equal(ctx.markersOfClip(a, 'jump').length, 1);
  assert.deepEqual(Array.from(ctx.markersOfClip(a, 'inconnu')), []);
});

test('retirer un marker ne touche que celui-la', () => {
  const ctx = contexte();
  const a = {id:'a1'};
  ctx.setMarker(a, 'marche', 0.2, 'un');
  ctx.setMarker(a, 'marche', 0.5, 'deux');
  ctx.setMarker(a, 'marche', 0.8, 'trois');
  ctx.removeMarker(a, 'marche', 1);
  assert.deepEqual(Array.from(ctx.markersOfClip(a, 'marche').map((m) => m.name)),
    ['un', 'trois']);
  // Un index hors bounds ne doit rien supprimer — pas le dernier, comme le ferait un splice
  // sur un index négatif.
  ctx.removeMarker(a, 'marche', -1);
  ctx.removeMarker(a, 'marche', 9);
  assert.equal(ctx.markersOfClip(a, 'marche').length, 2);
});

// `formatAnimatorStateMarkers` (ui/panels-components.js) formate la note en lecture seule sous
// l'état sélectionné dans le graphe Animator. `declareComponentPanel` n'est ici qu'un stub :
// le fichier l'appelle au chargement pour enregistrer chaque panneau de composant, ce que ce
// test n'exerce pas.
function contexteFormatage(){
  const bac = {console};
  bac.window = bac; bac.self = bac; bac.globalThis = bac;
  bac.declareComponentPanel = function(){};
  const ctx = vm.createContext(bac);
  vm.runInContext(deEsm(read('js/ui/panels-components.js')), ctx, {filename:'js/ui/panels-components.js'});
  return ctx;
}

test('format des marqueurs en lecture seule sous l etat selectionne', () => {
  const ctx = contexteFormatage();
  assert.equal(ctx.formatAnimatorStateMarkers([{t:0.3, name:'pas'}, {t:1.2, name:'impact'}]),
    '0.30 s — pas · 1.20 s — impact');
});

test('un marker sans nom s affiche quand meme dans la note', () => {
  const ctx = contexteFormatage();
  assert.equal(ctx.formatAnimatorStateMarkers([{t:0.5}]), '0.50 s — (sans nom)');
});
