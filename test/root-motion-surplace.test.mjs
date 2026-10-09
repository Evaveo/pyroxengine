import { deEsm } from './engine-env.mjs';
// LE MODE « SUR PLACE » RETIRE LE DÉPLACEMENT DES CLÉS, et ce fichier le mesure.
//
// La première version du mode corrigeait APRÈS coup : elle replaçait l'os racine à sa pose de
// repos après chaque pas du mixeur. Ça se testait mal et, surtout, ça laissait passer tout ce
// qui écrit sur le bassin ensuite — inertialisation, couches par os, fondu de transition. Il en
// restait un glissement lent, invisible sur une image et flagrant après dix secondes de jeu :
// le personnage n'allait plus tout à fait où le script l'envoyait.
//
// Retirer le déplacement DES CLÉS enlève la question : il n'y a plus rien à rattraper. Et c'est
// vérifiable sans moteur de rendu, ce qui est exactement ce qu'il faut ici.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const racineMoteur = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(racineMoteur, f), 'utf8');

function contexte(){
  const bac = {console, Math, JSON, Set, Map, Array, Object, Float32Array, Uint16Array,
               WeakMap, RegExp, Number, String};
  bac.window = bac; bac.self = bac; bac.globalThis = bac;
  bac.document = {createElement: () => ({style:{}, getContext: () => null}),
                  createElementNS: () => ({style:{}, getContext: () => null}),
                  addEventListener(){}};
  const ctx = vm.createContext(bac);
  vm.runInContext(deEsm(read('vendor/three.min.js')), ctx, {filename:'vendor/three.min.js'});
  vm.runInContext(deEsm(read('js/anim-blend.js')), ctx, {filename:'js/anim-blend.js'});
  return ctx;
}

const ctx = contexte();
const THREE = vm.runInContext('THREE', ctx);
const clipInPlace = vm.runInContext('clipInPlace', ctx);

// Une marche à la Mixamo : le bassin part de (2, 100, 5) et avance de 170 cm sur Z, en montant
// et redescendant de 7 cm. Les unités sont celles d'un FBX — des centimètres — comme le vrai pack.
function clipWalking(){
  const times = [0, 0.25, 0.5, 0.75, 1];
  const pos = [2, 100, 5,   2, 107, 47,   2, 100, 90,   2, 107, 132,   2, 100, 175];
  return new THREE.AnimationClip('walking', 1, [
    new THREE.VectorKeyframeTrack('Hips.position', times, pos),
    new THREE.QuaternionKeyframeTrack('Hips.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
    new THREE.VectorKeyframeTrack('LeftFoot.position', [0, 0.25], [0, 0, 0, 0, 5, 10])
  ]);
}

const trackPosition = (clip) => clip.tracks.find((t) => /\.position$/.test(t.name));
const amplitude = (values, axis) => {
  let min = Infinity, max = -Infinity;
  for(let i = axis; i < values.length; i += 3){ min = Math.min(min, values[i]); max = Math.max(max, values[i]); }
  return max - min;
};

test('LE DÉPLACEMENT HORIZONTAL DISPARAÎT des clés — c est tout l objet du mode', () => {
  const v = trackPosition(clipInPlace(clipWalking())).values;
  assert.equal(amplitude(v, 0), 0, 'X ne doit plus varier d une clé à l autre');
  assert.equal(amplitude(v, 2), 0, 'Z ne doit plus varier d une clé à l autre');
});

test('LE BALANCEMENT VERTICAL RESTE : l aplatir donnerait une démarche de robot', () => {
  const v = trackPosition(clipInPlace(clipWalking())).values;
  assert.equal(amplitude(v, 1), 7, 'le Y du bassin garde son amplitude d origine');
});

test('LA POSITION GARDÉE est celle de la PREMIÈRE clé, pas zéro', () => {
  // Mettre X/Z à zéro « pour remettre au centre » déplacerait le personnage hors de son pivot :
  // un bassin exporté n est presque jamais à l origine de son rig.
  const v = trackPosition(clipInPlace(clipWalking())).values;
  assert.equal(v[0], 2, 'X reste celui de la première clé');
  assert.equal(v[1], 100, 'Y de la première clé inchangé');
  assert.equal(v[2], 5, 'Z reste celui de la première clé');
});

test('LE CLIP D ORIGINE N EST PAS MUTÉ — il sert encore au mode « Déplace l objet »', () => {
  const clip = clipWalking();
  clipInPlace(clip);
  const v = trackPosition(clip).values;
  assert.equal(v[v.length - 1], 175, 'la dernière clé du clip source garde son déplacement');
});

test('LE MÊME CLIP RENVOIE LE MÊME OBJET — sinon le mixeur créerait une action par image', () => {
  const clip = clipWalking();
  assert.equal(clipInPlace(clip), clipInPlace(clip),
    'clipAction indexe par identité : un clip reconstruit à chaque image casserait les fondus');
});

test('LES AUTRES PISTES SONT INTACTES, et le nom ne change pas', () => {
  const clip = clipWalking();
  const sp = clipInPlace(clip);
  assert.equal(sp.tracks.length, clip.tracks.length);
  assert.equal(sp.name, clip.name,
    'un suffixe « ⟨…⟩ » serait lu par readNameClipDerived comme un asset de découpe');
  assert.equal(sp.duration, clip.duration);
  // SEULE la première piste de position est touchée : celle du bassin. Un pied qui bouge dans le
  // clip doit continuer de bouger — c est la marche elle-même.
  const pied = sp.tracks.find((t) => t.name === 'LeftFoot.position');
  assert.deepEqual(Array.from(pied.values), [0, 0, 0, 0, 5, 10]);
});

test('UN CLIP DÉJÀ SUR PLACE est rendu tel quel, sans copie', () => {
  const clip = new THREE.AnimationClip('idle', 1, [
    new THREE.QuaternionKeyframeTrack('Hips.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1])
  ]);
  assert.equal(clipInPlace(clip), clip, 'aucune piste de position : rien à retirer');
});
