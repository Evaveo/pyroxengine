import { deEsm } from './engine-env.mjs';
// Un mélange par os rate de trois façons, et aucune ne lève d'erreur :
//
//  · les deux couches se disputent le MÊME os — three en fait une moyenne pondérée, et le
//    personnage reste à mi-chemin entre marcher et viser, ce qui ressemble à une animation molle
//    plutôt qu'à un défaut ;
//  · la couche prend trop d'os, ou trop peu — un bras qui suit la marche pendant que l'autre
//    aims, et on cherche du côté de l'animation ;
//  · le clip restreint est reconstruit à chaque image — le mixeur crée alors une action neuve à
//    chaque fois, le fondu ne retrouve jamais l'action précédente, et rien ne se mélange.
//
// Le vrai three vendorisé est chargé : `Bone` et `AnimationClip` sont exercés tels quels.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const racineMoteur = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(racineMoteur, f), 'utf8');

function contexte(){
  const bac = {console, Math, JSON, Set, Map, Array, Object, WeakMap, Float32Array};
  bac.window = bac; bac.self = bac; bac.globalThis = bac;
  const ctx = vm.createContext(bac);
  vm.runInContext(deEsm(read('vendor/three.min.js')), ctx, {filename:'vendor/three.min.js'});
  vm.runInContext(deEsm(read('js/anim-blend.js')), ctx, {filename:'js/anim-blend.js'});
  return ctx;
}

// Un demi-humanoïde : bassin → colonne → (bras gauche, bras droit), et bassin → jambe. Assez
// pour que « depuis la colonne » ait un sens, et que la frontière base/couche soit vérifiable.
function rig(ctx){
  const T = ctx.THREE;
  const os = {};
  const faire = (name, parent) => {
    const b = new T.Bone(); b.name = name; os[name] = b;
    if(parent) os[parent].add(b);
    return b;
  };
  const root = new T.Group();
  root.add(faire('Hips'));
  faire('Spine', 'Hips');
  faire('LeftArm', 'Spine');
  faire('LeftHand', 'LeftArm');
  faire('RightArm', 'Spine');
  faire('LeftUpLeg', 'Hips');
  faire('LeftFoot', 'LeftUpLeg');
  return {root, os};
}

function clip(ctx, names, name){
  const T = ctx.THREE;
  return new T.AnimationClip(name || 'c', 1, names.map(function(n){
    return new T.QuaternionKeyframeTrack(n + '.quaternion', [0, 1], [0,0,0,1, 0,0,0,1]);
  }));
}

const nomsDe = (c) => Array.from(c.tracks.map((t) => t.name.split('.')[0])).sort();

// --- la chaîne d'os -------------------------------------------------------------------------

test('« depuis un os » prend l os ET toute sa descendance', () => {
  const ctx = contexte();
  const {root} = rig(ctx);
  assert.deepEqual(Array.from(ctx.boneAndDescendants(root, 'Spine')).sort(),
    ['LeftArm', 'LeftHand', 'RightArm', 'Spine']);
  // La feuille ne prend qu'elle-même — sans quoi « depuis la main » emporterait le bras.
  assert.deepEqual(Array.from(ctx.boneAndDescendants(root, 'LeftHand')), ['LeftHand']);
});

test('un os introuvable ne prend RIEN, et surtout pas tout', () => {
  const ctx = contexte();
  const {root} = rig(ctx);
  // Un rig réimporté, un os renommé : la couche doit disparaître, pas s'emparer du body
  // entier — ce que ferait un `[]` interprété plus loin comme « aucune restriction ».
  assert.deepEqual(Array.from(ctx.boneAndDescendants(root, 'Inexistant')), []);
});

// --- la restriction d'un clip ------------------------------------------------------------

test('un clip restreint ne garde que les pistes des os demandes', () => {
  const ctx = contexte();
  const c = clip(ctx, ['Hips', 'Spine', 'LeftArm', 'LeftUpLeg']);
  const r = ctx.clipRestricted(c, ['Spine', 'LeftArm'], 'haut');
  assert.deepEqual(nomsDe(r), ['LeftArm', 'Spine']);
  assert.equal(r.duration, c.duration, 'la durée doit survivre à la restriction');
});

test('restreindre a TOUT rend le clip d origine, sans copie', () => {
  const ctx = contexte();
  const c = clip(ctx, ['Hips', 'Spine']);
  // Pas seulement une économie : `mixeur.clipAction` indexe par IDENTITÉ de clip. Rendre une
  // copie là où rien n'est retiré ferait deux actions pour le même clip, dont une invisible.
  assert.equal(ctx.clipRestricted(c, ['Hips', 'Spine'], 'all'), c);
});

test('restreindre a des os ABSENTS du clip rend null, pas un clip vide', () => {
  const ctx = contexte();
  const c = clip(ctx, ['Hips', 'Spine']);
  // Une action sur un clip vide se lance, tourne, et ne fait rien. L'appelant doit pouvoir le
  // savoir : une couche qui ne s'applique à rien est une erreur de réglage, pas un cas normal.
  assert.equal(ctx.clipRestricted(c, ['Queue'], 'x'), null);
});

test('le MEME clip restreint est rendu deux fois (le fondu en depend)', () => {
  const ctx = contexte();
  const c = clip(ctx, ['Hips', 'Spine', 'LeftArm']);
  const a = ctx.clipRestricted(c, ['Spine', 'LeftArm'], 'haut');
  const b = ctx.clipRestricted(c, ['Spine', 'LeftArm'], 'haut');
  // `clipAction(clip)` retrouve son action par l'identité du clip. Reconstruire à chaque image
  // créerait une action neuve à chaque fois : le fondu ne retrouverait jamais la précédente, et
  // le mélange ne se ferait jamais — sans la moindre erreur à l'écran.
  assert.equal(a, b, 'deux appels identiques doivent rendre le MÊME objet clip');
  // Deux restrictions différentes du même clip restent distinctes.
  assert.notEqual(a, ctx.clipRestricted(c, ['Hips'], 'bottom'));
});

// --- le partage des os --------------------------------------------------------------------

test('la calque prend sa chaine, la base garde TOUT LE RESTE', () => {
  const ctx = contexte();
  const {root} = rig(ctx);
  const r = ctx.splitBone(root, [{depuis:'Spine'}]);
  assert.deepEqual(Array.from(r.base).sort(), ['Hips', 'LeftFoot', 'LeftUpLeg']);
  assert.deepEqual(Array.from(r.layers[0]).sort(),
    ['LeftArm', 'LeftHand', 'RightArm', 'Spine']);
});

test('aucun os n est pris DEUX fois', () => {
  const ctx = contexte();
  const {root} = rig(ctx);
  const r = ctx.splitBone(root, [{depuis:'Spine'}]);
  const tous = r.base.concat(r.layers[0]);
  // LE point : deux actions de poids 1 sur le même os donnent une MOYENNE. Le personnage
  // resterait à mi-chemin entre marcher et viser, ce qui ressemble à une animation molle
  // plutôt qu'à un défaut de moteur.
  assert.equal(new Set(tous).size, tous.length, 'un os est réclamé par deux actions à la fois');
  assert.equal(tous.length, ctx.allBone(root).length, 'des os ont disparu du partage');
});

test('deux calques qui se recouvrent : la DERNIERE l emporte', () => {
  const ctx = contexte();
  const {root} = rig(ctx);
  const r = ctx.splitBone(root, [{depuis:'Spine'}, {depuis:'LeftArm'}]);
  // Empiler comme des calques est la seule règle qui ne laisse aucun os partagé. Sans elle,
  // « viser » et « saluer » se disputeraient le bras gauche.
  assert.deepEqual(Array.from(r.layers[0]).sort(), ['RightArm', 'Spine']);
  assert.deepEqual(Array.from(r.layers[1]).sort(), ['LeftArm', 'LeftHand']);
  assert.deepEqual(Array.from(r.base).sort(), ['Hips', 'LeftFoot', 'LeftUpLeg']);
});

test('sans calque, la base garde tous les os', () => {
  const ctx = contexte();
  const {root} = rig(ctx);
  const r = ctx.splitBone(root, []);
  assert.equal(r.base.length, ctx.allBone(root).length);
  assert.deepEqual(Array.from(r.layers), []);
});

test('une calque dont l os est introuvable ne prend rien a la base', () => {
  const ctx = contexte();
  const {root} = rig(ctx);
  const r = ctx.splitBone(root, [{depuis:'Inexistant'}]);
  assert.equal(r.base.length, ctx.allBone(root).length,
    'un os de calque introuvable ne doit pas amputer la base');
  assert.deepEqual(Array.from(r.layers[0]), []);
});

// --- ce que garde la base -------------------------------------------------------------------

test('la base garde les pistes qui ne visent AUCUN os', () => {
  const ctx = contexte();
  const T = ctx.THREE;
  // Un clip d'un modèle réel n'anime pas que des os : la position d'un maillage, un nœud vide,
  // une cible de morphing. Construire la base par liste blanche d'os les jetterait toutes, en
  // silence — le personnage marcherait bien, et son épée aurait cessé de tourner.
  const c = new T.AnimationClip('c', 1, [
    new T.QuaternionKeyframeTrack('Spine.quaternion', [0,1], [0,0,0,1, 0,0,0,1]),
    new T.QuaternionKeyframeTrack('Hips.quaternion', [0,1], [0,0,0,1, 0,0,0,1]),
    new T.VectorKeyframeTrack('Epee.position', [0,1], [0,0,0, 1,1,1])
  ]);
  const base = ctx.clipExcept(c, ['Spine', 'LeftArm'], 'base');
  assert.deepEqual(nomsDe(base), ['Epee', 'Hips'],
    'obtenu ' + nomsDe(base).join(', ') + ' — une piste hors squelette a disparu');
});

test('sans os exclu, la base est le clip d origine lui-meme', () => {
  const ctx = contexte();
  const c = clip(ctx, ['Hips', 'Spine']);
  // Même raison que pour `clipRestricted` : `clipAction` indexe par identité de clip.
  assert.equal(ctx.clipExcept(c, [], 'base'), c);
  assert.equal(ctx.clipExcept(c, ['Queue'], 'base'), c);
});

test('une base entierement prise par les calques rend null', () => {
  const ctx = contexte();
  const c = clip(ctx, ['Spine', 'LeftArm']);
  // Les couches ont tout taken : le clip principal ne sert plus à rien. Ce n'est pas une erreur,
  // mais il ne faut pas lancer une action vide pour autant.
  assert.equal(ctx.clipExcept(c, ['Spine', 'LeftArm'], 'base'), null);
});

test('le meme clip « sauf » est rendu deux fois', () => {
  const ctx = contexte();
  const c = clip(ctx, ['Hips', 'Spine', 'LeftArm']);
  assert.equal(ctx.clipExcept(c, ['Spine'], 'base'), ctx.clipExcept(c, ['Spine'], 'base'));
});

test('base et calque ne partagent AUCUNE piste', () => {
  const ctx = contexte();
  const {root} = rig(ctx);
  const c = clip(ctx, ctx.allBone(root));
  const part = ctx.splitBone(root, [{depuis:'Spine'}]);
  const base = ctx.clipExcept(c, part.layers[0], 'base');
  const layer = ctx.clipRestricted(c, part.layers[0], 'c0');
  const communs = nomsDe(base).filter((n) => nomsDe(layer).indexOf(n) !== -1);
  // LE point de tout le mécanisme : deux actions de poids 1 sur le même os donnent une moyenne.
  // Le personnage resterait à mi-chemin entre marcher et viser — ce qui se lit comme une
  // animation molle, pas comme un défaut.
  assert.deepEqual(communs, [], 'os joués par les DEUX actions : ' + communs.join(', '));
  assert.equal(nomsDe(base).length + nomsDe(layer).length, ctx.allBone(root).length,
    'des os ont disparu entre la base et la calque');
});
