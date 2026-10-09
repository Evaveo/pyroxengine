import { deEsm } from './engine-env.mjs';
// Trois défauts que ce fichier tient fermés. Aucun des trois ne lève d'erreur : chacun produit
// un éditeur qui a l'air de fonctionner et qui ne montre rien.
//
//  1. le bouton playback refusait de démarrer quand la seule chose à jouer était un clip importé,
//  2. l'inspecteur accrochait l'animation au squelette — donc rien pour un FBX sans peau,
//  3. le calage au sol d'un modèle SANS géométrie écrivait -Infinity puis NaN dans la position.
//
// Le vrai three vendorisé est chargé : Box3, Bone et SkinnedMesh sont exercés tels qu'ils
// arrivent d'un import, pas simulés.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const racineMoteur = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(racineMoteur, f), 'utf8');
// Un commentaire qui décrit la garde n'est pas la garde : on ne cherche jamais dans les
// commentaires. Piège récurrent des tests de ce dépôt.
const codeSeul = (src) => src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

// --- 1. la garde de `togglePlayback` ---------------------------------------------------

test('togglePlayback compte un CLIP AFFICHE comme quelque chose a play', () => {
  const src = codeSeul(read('js/animation.js'));
  const start = src.indexOf('function togglePlayback');
  assert.notEqual(start, -1, 'togglePlayback a disparu');
  const body = src.slice(start, start + 900);

  // Ce que la garde doit accepter. Sans ce terme, sélectionner un personnage animé puis
  // appuyer sur ▶ shown « Posez des clés d'animation » et n'anime rien : le seul cas où on
  // veut vraiment appuyer sur lecture est précisément celui qu'elle refuse.
  assert.match(body, /clipShown\.clip/,
    'la garde ignore le clip affiché : un modèle importé sélectionné ne se joue pas');
  // Et elle doit toujours refuser une scène où il n'y a rien du tout.
  assert.match(body, /anim\.tracks\.length/, 'la garde ne regarde plus les pistes du project');
  assert.match(body, /aScript/, 'la garde ne regarde plus les scripts');
  // On teste la CONDITION, pas la présence d'un `return`. Une mutation en `if(false)` laisse
  // le `return` en place dans le texte et neutralise pourtant la garde entière : chercher
  // `return;` était une assertion incapable d'échouer.
  assert.match(body, /if\(!aQuelqueChoseAPlay\)\{/,
    'la garde ne coupe plus sur ce qu’elle vient de compute : une scène vide passerait');
});

// --- 2. la section Animation ne dépend PAS du squelette ---------------------------------
//
// La section Animation a migré dans le panneau déclaratif SkinnedMeshRenderer (js/ui/panels-
// components.js, tâche 4.3) — `sectionSkeletonHtml`/`sectionAnimationHtml` (js/skeleton.js) ont
// disparu. On appelle directement `ComponentPanels.SkinnedMeshRenderer.sections(c)`, la même
// fonction que monte le formulaire réel, avec un composant factice `{node, skeleton, boneCount}`.

function contexteSquelette(){
  const bac = {console, Math, JSON, Set, Map, Array, Object, Float32Array, Uint16Array};
  bac.window = bac; bac.self = bac; bac.globalThis = bac;
  bac.escapeHtml = (s) => String(s);
  bac.ed = () => ({});
  bac.boneSelected = null;
  const ctx = vm.createContext(bac);
  vm.runInContext(deEsm(read('vendor/three.min.js')), ctx, {filename:'vendor/three.min.js'});
  vm.runInContext(deEsm(read('js/ui/panels-components.js')), ctx, {filename:'js/ui/panels-components.js'});
  return ctx;
}

// Un FBX d'animation seule (export Mixamo « without skin ») : des os, un clip, AUCUN maillage.
function rigSansPeau(ctx){
  const T = ctx.THREE;
  const root = new T.Group();
  const hanche = new T.Bone(); hanche.name = 'mixamorigHips';
  root.add(hanche);
  root.animations = [{name:'mixamo.com', duration:1.033}];
  return root;
}

test('un rig SANS peau montre quand meme son animation dans l inspecteur', () => {
  const ctx = contexteSquelette();
  const root = rigSansPeau(ctx);
  ctx.clipsOf = (o) => o.animations || [];
  ctx.animationsExternalFor = () => [];
  ctx.externalClipsOf = () => [];

  // L'état de fait qui motive tout : pas de SkinnedMesh, donc pas de squelette au sens
  // de `skeletonOf`. C'est ce qui cachait l'animation dans le fichier qui ne contient qu'elle.
  const c = {node: root, skeleton: null, boneCount: 0};
  // `ComponentPanels` est un `const` de tête de fichier : il n'existe pas comme propriété de
  // `ctx` (seules les déclarations `function`/`var` s'y posent), mais reste lisible en évaluant
  // une expression dans le même contexte — le patron déjà utilisé pour `clipShown` plus haut.
  const panel = vm.runInContext('ComponentPanels.SkinnedMeshRenderer', ctx);
  const sections = panel.sections(c);
  const clips = sections.find((s) => s.id === 'smr-clips');
  assert.ok(clips, 'la section Animation doit apparaître même sans squelette');
  const labels = clips.fields.map((f) => (typeof f.label === 'function' ? f.label() : f.label));
  assert.ok(labels.some((l) => /mixamo\.com/.test(l)),
    'le clip n’apparaît pas : l’animation reste invisible');
  assert.ok(clips.fields.some((f) => f.ids && f.ids[0] === 'smr-play'),
    'pas de bouton de lecture sur un rig sans peau');
});

test('la section Animation se tait quand il n y a aucun clip', () => {
  const ctx = contexteSquelette();
  const T = ctx.THREE;
  const nu = new T.Group();
  ctx.clipsOf = () => [];
  ctx.animationsExternalFor = () => [];
  ctx.externalClipsOf = () => [];
  const c = {node: nu, skeleton: null, boneCount: 0};
  // `ComponentPanels` est un `const` de tête de fichier : il n'existe pas comme propriété de
  // `ctx` (seules les déclarations `function`/`var` s'y posent), mais reste lisible en évaluant
  // une expression dans le même contexte — le patron déjà utilisé pour `clipShown` plus haut.
  const panel = vm.runInContext('ComponentPanels.SkinnedMeshRenderer', ctx);
  const sections = panel.sections(c);
  assert.equal(sections.find((s) => s.id === 'smr-clips'), undefined,
    'une section Animation vide sur chaque objet noierait l’inspecteur');
});

// --- 3. le calage au sol d'un modèle sans géométrie -------------------------------------

function contexteImport(){
  const bac = {console, Math, JSON, Set, Map, Array, Object};
  bac.window = bac; bac.self = bac; bac.globalThis = bac;
  bac.objects = [];
  bac.assets = [];
  bac.updateProject = () => {};
  bac.applyFilters = () => {};
  bac.previewObject3D = () => null;
  bac.applyMaterialsModel = () => {};
  // Surtout PAS de bouchon d'`ensureParamsImport` : le module en définit un, et sa déclaration
  // écrase la propriété du bac au chargement. Un faux bouchon aurait fait sortir
  // `applyImportModel` par son `return 0` initial — les deux tests seraient passés
  // sans jamais exercer une seule ligne de calage. On donne donc de VRAIS assets.
  //
  // import-settings.js branche aussi ses écouteurs sur le panneau au chargement : sans ces
  // bouchons-là le module ne s'évalue même pas.
  bac.inspBody = {addEventListener: () => {}};
  bac.document = {addEventListener: () => {}, getElementById: () => null,
    querySelector: () => null, querySelectorAll: () => []};
  const ctx = vm.createContext(bac);
  vm.runInContext(deEsm(read('vendor/three.min.js')), ctx, {filename:'vendor/three.min.js'});
  // import-settings.js lit MODEL_IMPORT_DEFAULT au premier niveau (les réglages de hiérarchie
  // et de géométrie, partagés avec le runtime) : sans ce fichier-là, il ne s'évalue pas.
  vm.runInContext(deEsm(read('js/model-import.js')), ctx, {filename:'js/model-import.js'});
  vm.runInContext(deEsm(read('js/import-settings.js')), ctx, {filename:'js/import-settings.js'});
  return ctx;
}

// La valeur exacte d'où vient tout le défaut. On la lit dans le three vendorisé plutôt que de
// la supposer : c'est elle qui fait de `y -= box.min.y` un -Infinity.
function boiteVideLue(ctx){
  return new ctx.THREE.Box3().min.y;
}

test('poser au sol un modele SANS geometrie ne deplace rien (ni -Infinity ni NaN)', () => {
  const ctx = contexteImport();
  const T = ctx.THREE;
  const t = new T.Group();
  const os = new T.Bone(); os.name = 'mixamorigHips'; os.position.set(0, 101.62, 0);
  t.add(os);
  const a = {id:'a1', kind:'model', template:t, unitFile:0.01,
    animationsBrutes:[{name:'mixamo.com', duration:1.03}],
    paramsImport:{unites:'auto', scale:1, centrer:true, setGround:true}};

  ctx.applyImportModel(a, true);

  // Le cœur : -Infinity pass inaperçu au premier tour (l'object part simplement très loin),
  // puis `dy = y - ancY` vaut -Infinity − (-Infinity) = NaN au second, et l'object quitte la
  // scène sans un mot en emmenant tous ses os.
  assert.ok(Number.isFinite(t.position.y),
    'position.y = ' + t.position.y + ' — le calage au sol a lu une boîte empty');
  assert.equal(t.position.y, 0, 'rien à mesurer, donc rien à déplacer');
  assert.ok(Number.isFinite(t.position.x), 'position.x = ' + t.position.x);

  // Deuxième passage : c'est LUI qui fabriquait le NaN, pas le premier.
  ctx.applyImportModel(a, true);
  assert.ok(Number.isFinite(t.position.y), 'position.y = ' + t.position.y + ' au second passage');

  // Pas d'assertion sur `a.dimensions` ici : three rend déjà [0,0,0] pour une boîte empty, donc
  // la vérifier ne distingue rien (une mutation qui l'a montré). C'est `min` qui vaut +Infinity.
  assert.equal(boiteVideLue(ctx), Infinity,
    'le jour où three protégera aussi `min`, cette garde n’aura plus d’object');
});

test('un modele AVEC geometrie est toujours pose au sol', () => {
  const ctx = contexteImport();
  const T = ctx.THREE;
  const t = new T.Group();
  // Un cube de 2 unités centré en y = 0 : sa base est à -1, il doit remonter de +1.
  const m = new T.Mesh(new T.BoxGeometry(2, 2, 2), new T.MeshBasicMaterial());
  t.add(m);
  const a = {id:'a2', kind:'model', template:t, unitFile:1, animationsBrutes:[],
    paramsImport:{unites:'auto', scale:1, centrer:false, setGround:true}};

  ctx.applyImportModel(a, false);

  // Sans cette vérification, court-circuiter le calage pour TOUT le monde passerait le test
  // précédent sans que rien ne le signale.
  assert.equal(t.position.y, 1, 'le calage au sol ne s’applique plus aux modèles qui ont un body');
  assert.deepEqual(Array.from(a.dimensions), [2, 2, 2]);
});
