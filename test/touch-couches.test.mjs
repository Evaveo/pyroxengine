// LE JOYSTICK ET LES BOUTONS TACTILES PASSENT AU-DESSUS DE L'INTERFACE (v1.17.1).
// Toute la surcouche était sous les documents d'interface (z-index −1) : un fond plein écran — le
// menu de Donjon, `.menu-fond { inset: 0; background: … }` — la cachait sur tous les écrans du jeu.
// Seule la zone de glisser (plein écran) reste dessous, pour ne pas manger les clics de l'interface.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte } from './engine-env.mjs';

test('glisser sous l interface, joystick et boutons au-dessus', () => {
  const ctx = creerContexte(['js/touch-input.js']);
  ctx.matchMedia = () => ({ matches: true });   // écran tactile
  const host = ctx.document.createElement('div');
  ctx.document.body.appendChild(host);
  const ui = ctx.document.createElement('div');   // un document d'interface déjà posé
  host.appendChild(ui);
  const data = { showOnDesktop: false, joystick: { enabled: true }, swipe: { enabled: true },
    buttons: [{ id: 'b1', label: 'A', action: 'attaque', side: 'right' }] };
  const node = { visible: true, getComponent: (t) => (t === 'TouchControls' ? { active: true, data } : null) };
  assert.equal(ctx.syncTouchControls(host, [node], { keys: new Set(), inputs: { actions: { attaque: ['x'] }, axes: {} } }), true);
  const kids = Array.from(host.children);
  const bas = kids.find((k) => k.className === 'touch-controls');
  const haut = kids.find((k) => k.className === 'touch-controls-top');
  assert.ok(bas && haut, 'deux couches');
  assert.equal(String(bas.style.zIndex), '-1');
  assert.ok(Number(haut.style.zIndex) > 0, 'la couche du joystick passe au-dessus');
  assert.equal(kids.indexOf(haut), kids.length - 1, 'posée après les documents d interface');
  assert.equal(haut.style.pointerEvents, 'none', 'transparente aux clics hors des contrôles');
  assert.ok(haut.children.length >= 2, 'joystick et colonne de boutons dans la couche du dessus');
  assert.ok(Array.from(bas.children).some((k) => k.className === 'touch-swipe'), 'le glisser reste dessous');
  ctx.clearTouchControls();
  assert.equal(Array.from(host.children).filter((k) => /touch-controls/.test(k.className || '')).length, 0, 'les deux couches partent');
});
