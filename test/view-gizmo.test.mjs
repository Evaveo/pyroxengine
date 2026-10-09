// moteur/test/view-gizmo.test.mjs
//
// Les orientations du gizmo. Ce sont des quaternions : les verifier a la main dans le viewport
// veut dire « ca a l'air bon », ce qui n'a jamais attrape une vue Arriere confondue avec la vue
// Face.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte } from './engine-env.mjs';

test('chaque axe donne une direction de vue distincte', () => {
  const ctx = creerContexte(['js/view-gizmo.js']);
  const vues = ['+x', '-x', '+y', '-y', '+z', '-z'];
  const vus = new Set();
  vues.forEach((v) => {
    const d = ctx.viewDirection(v);
    vus.add([d.x, d.y, d.z].map((n) => Math.round(n * 1000)).join(','));
  });
  assert.equal(vus.size, 6, 'deux vues alignees pointent au meme endroit');
});

test('la vue Face regarde selon -Z', () => {
  const ctx = creerContexte(['js/view-gizmo.js']);
  const d = ctx.viewDirection('+z');
  // La camera est POSEE en +Z et regarde vers l'origine : c'est la vue de travail 2D.
  assert.equal(Math.round(d.z), 1);
  assert.equal(Math.round(d.x), 0);
  assert.equal(Math.round(d.y), 0);
});

test('une vue alignee est orthographique', () => {
  const ctx = creerContexte(['js/view-gizmo.js']);
  assert.equal(ctx.projectionForView('+z'), 'orthographic');
  assert.equal(ctx.projectionForView('free'), 'perspective');
});

test('LE GIZMO TOURNE AVEC LA CAMERA : vue de face, puis quart de tour a droite', () => {
  const ctx = creerContexte(['js/view-gizmo.js']);
  const at = (q, axe) => ctx.gizmoAxesLayout(q, 25).find((p) => p.axis === axe);
  // Caméra identité (regarde vers -Z) : X à droite, Y en haut, Z vers l'œil (devant tout).
  const id = {x: 0, y: 0, z: 0, w: 1};
  assert.equal(Math.round(at(id, '+x').x), 61);
  assert.equal(Math.round(at(id, '+y').y), 11);
  const ordre = ctx.gizmoAxesLayout(id, 25).map((p) => p.axis);
  assert.equal(ordre[ordre.length - 1], '+z', '+Z pointe vers l oeil : dessine en dernier');
  // Caméra tournée de 90° autour de Y (regarde vers -X, sa droite est -Z) : +Z passe à GAUCHE,
  // +X vient vers l'œil.
  const s = Math.SQRT1_2;
  const q = {x: 0, y: s, z: 0, w: s};
  assert.equal(Math.round(at(q, '+z').x), 11);
  assert.ok(at(q, '+x').z > 0.99);
});
