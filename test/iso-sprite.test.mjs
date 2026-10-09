// Sprites isométriques cuits (js/iso-sprite.js).
//
// Le test qui porte le fichier est celui du SENS : dans le jeu façon Age of Empires qui a fait
// naître l'outil, un signe inversé entre la cuisson et le choix de direction faisait marcher
// toutes les unités à reculons. Ici, un modèle avec un « nez » vers +X doit montrer ce nez du
// côté où isoDirOf dit qu'il va.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderIsoModel, packIsoSheet, isoDirOf, isoDirAngle } from '../js/iso-sprite.js';

const body = [{type: 'box', min: [-0.2, -0.2, 0], max: [0.2, 0.2, 0.6], color: '#808080'},
  {type: 'box', min: [0.2, -0.05, 0.4], max: [0.6, 0.05, 0.5], color: '#ff0000'}];

// barycentre horizontal des pixels rouges, relatif à l'ancrage
function noseX(im){
  let s = 0, n = 0;
  for(let y = 0; y < im.h; y++) for(let x = 0; x < im.l; x++){ const o = (y * im.l + x) * 4; if(im.px[o + 3] === 255 && im.px[o] > 90 && im.px[o + 1] < 40){ s += x; n++; } }
  return n ? s / n - im.ox : null;
}

test('le nez pointe du côté que isoDirOf annonce, sur les 8 directions', () => {
  const r = renderIsoModel({frames: [{primitives: body}], directions: 8, shadow: false, outline: false});
  assert.equal(r.images.length, 8);
  const right = r.images[isoDirOf(1, -1, 8)], left = r.images[isoDirOf(-1, 1, 8)];
  assert.ok(noseX(right) > 5, 'aller vers la droite doit montrer le nez à droite : ' + noseX(right));
  assert.ok(noseX(left) < -5, 'aller vers la gauche doit montrer le nez à gauche : ' + noseX(left));
  for(let d = 0; d < 8; d++){ const a = isoDirAngle(d, 8); assert.equal(isoDirOf(Math.cos(a), Math.sin(a), 8), d, 'aller-retour de la direction ' + d); }
});

test('les parties team vont dans le masque, en gris ; les autres non', () => {
  const r = renderIsoModel({frames: [{primitives: [{type: 'sphere', center: [0, 0, 0.3], radius: 0.3, color: '#2050e0', team: true}]}]});
  assert.ok(r.hasTeam);
  const im = r.images[0]; let m = 0, grey = true;
  for(let i = 0; i < im.l * im.h; i++) if(im.mask[i * 4 + 3]){ m++; if(Math.abs(im.px[i * 4] - im.px[i * 4 + 2]) > 2) grey = false; }
  assert.ok(m > 100 && grey);
  assert.equal(renderIsoModel({frames: [{primitives: body}]}).hasTeam, false);
});

test('l\'ancrage est le pied du modèle, et la planche range tout sans chevauchement', () => {
  const r = renderIsoModel({frames: [{name: 'a', primitives: body}, {name: 'b', primitives: body}], directions: 4, shadow: false});
  const im = r.images[0];
  let near = false;
  const oy = Math.round(im.oy);
  for(let y = Math.max(0, oy - 12); y < Math.min(im.h, oy + 12); y++) if(im.px[(y * im.l + Math.round(im.ox)) * 4 + 3]) near = true;
  assert.ok(near, 'aucun pixel opaque près du point d\'ancrage');
  const p = packIsoSheet(r.images);
  assert.deepEqual(Object.keys(p.sprites).sort(), ['a/0', 'a/1', 'a/2', 'a/3', 'b/0', 'b/1', 'b/2', 'b/3']);
  const rects = Object.values(p.sprites);
  for(let i = 0; i < rects.length; i++) for(let j = i + 1; j < rects.length; j++){
    const A = rects[i], B = rects[j];
    assert.ok(A[0] + A[2] <= B[0] || B[0] + B[2] <= A[0] || A[1] + A[3] <= B[1] || B[1] + B[3] <= A[1], 'chevauchement');
  }
  assert.equal(p.sheet.px.length, p.sheet.l * p.sheet.h * 4);
});

test('les erreurs de description sont dites en clair', () => {
  assert.throws(() => renderIsoModel({frames: [{primitives: [{type: 'pyramide'}]}]}), /type inconnu/);
  assert.throws(() => renderIsoModel({frames: [{primitives: [{type: 'box', min: [0, 0], max: [1, 1, 1]}]}]}), /\[x, y, z\]/);
  assert.throws(() => renderIsoModel({frames: [{primitives: [{type: 'box', min: [0, 0, 0], max: [1, 1, 1], color: 'rouge'}]}]}), /couleur invalide/);
  assert.throws(() => renderIsoModel({frames: [{primitives: body}], directions: 3}), /directions/);
  assert.throws(() => renderIsoModel({frames: []}), /aucune image/);
});
