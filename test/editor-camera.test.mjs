// moteur/test/editor-camera.test.mjs
//
// La bascule de projection de la camera d'EDITION. Elle doit conserver ce que l'oeil suit : la
// cible d'orbite et la taille apparente. Une bascule qui « saute » se lit comme un bug de
// navigation, et c'est ce qui fait qu'on n'ose plus s'en servir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte } from './engine-env.mjs';

test('la bascule conserve la taille apparente', () => {
  const ctx = creerContexte(['js/editor-camera.js']);
  // `setEditorProjection` RETOURNE une nouvelle camera, il ne mute pas l'argument : asserter sur
  // `cam` testerait la camera perspective d'origine, dont `top` vaut `undefined`.
  const ortho = ctx.setEditorProjection(ctx.createEditorCamera(), 'orthographic',
                                        { distance: 10, fov: 55, aspect: 16 / 9 });
  const attendu = 10 * Math.tan((55 * Math.PI / 180) / 2);
  assert.equal(Math.abs(ortho.top - attendu) < 0.01, true,
    'la taille apparente doit etre conservee, sinon la bascule saute');
});

test('revenir en perspective restaure le champ de vision', () => {
  const ctx = creerContexte(['js/editor-camera.js']);
  const ortho = ctx.setEditorProjection(ctx.createEditorCamera(), 'orthographic',
                                        { distance: 10, fov: 55, aspect: 16 / 9 });
  const revenue = ctx.setEditorProjection(ortho, 'perspective',
                                          { distance: 10, fov: 55, aspect: 16 / 9 });
  assert.equal(revenue.isPerspectiveCamera, true);
  assert.equal(revenue.fov, 55);
});
