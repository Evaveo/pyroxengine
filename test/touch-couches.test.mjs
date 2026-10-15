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

// v1.18.0 — disposition demandée sur Donjon : bouton principal dans le coin, les autres en arc
// autour ; joystick rapproché du centre ; boutons de menu en haut, jamais sur la grappe.
test('grappe : principal plus gros dans le coin, les autres autour, vers le centre et le haut', () => {
  const ctx = creerContexte(['js/touch-input.js']);
  const g = ctx.clusterLayout(5, 72);
  assert.equal(g.length, 5);
  assert.ok(g[0].size > 72, 'le principal est plus gros');
  const main = g[0];
  g.slice(1).forEach((b) => {
    const d = Math.hypot(b.x - main.x, b.y - main.y);
    assert.ok(d > main.size / 2 + b.size / 2, 'pas de chevauchement avec le principal');
    assert.ok(b.x >= main.x - 1 && b.y >= main.y - 10, 'du côté du centre et vers le haut');
  });
  assert.equal(ctx.clusterLayout(9, 72).length, 9, 'au-delà de cinq, un second anneau');
});

test('joystick décollé du bord, menu déduit en haut et pas sur B', () => {
  const ctx = creerContexte(['js/touch-input.js']);
  const n = ctx.normalizeTouchControls({});
  assert.ok(n.joystick.inset >= 60 && n.joystick.lift >= 40, 'plus loin du bord que les 24 px d avant');
  assert.equal(n.layout, 'cluster');
  assert.equal(ctx.normalizeTouchControls({buttons: [{action: 'menu', side: 'top'}]}).buttons[0].side, 'top');
  const auto = ctx.autoTouchConfig({actions: {haut: ['ArrowUp'], attaque: [' ', 'pad:0'], annuler: ['Escape', 'pad:1'],
    menu: ['Tab', 'pad:8']}, axes: {}});
  const menu = auto.buttons.find((b) => b.action === 'menu');
  assert.equal(menu.side, 'top');
  assert.equal(auto.buttons.find((b) => b.label === 'B').action, 'annuler');
});

// v1.20.0 — capture Donjon : boutons 1-4 superposés, B pas en bas. L'écart est calculé, et les
// premiers boutons de la liste prennent la rangée du bas, à côté du principal.
test('grappe : aucun chevauchement, la rangée du bas se remplit d abord', () => {
  const ctx = creerContexte(['js/touch-input.js']);
  for(const n of [2, 4, 6, 8, 10]){
    const g = ctx.clusterLayout(n, 66);
    for(let i = 0; i < g.length; i++) for(let j = i + 1; j < g.length; j++){
      assert.ok(Math.hypot(g[i].x - g[j].x, g[i].y - g[j].y) >= (g[i].size + g[j].size) / 2 + 4,
        n + ' boutons : ' + i + ' et ' + j + ' se chevauchent');
    }
  }
  const g = ctx.clusterLayout(8, 66);
  assert.ok(Math.abs(g[1].y - g[0].y) < 2 && g[1].x > g[0].x, 'le 2ᵉ bouton (B) est à côté du principal, sur sa ligne');
  assert.ok(g[2].y < g[5].y, 'les premiers sont plus bas que les derniers');
});

test('position de la grappe réglable (pour la décoller d un HUD)', () => {
  const ctx = creerContexte(['js/touch-input.js']);
  const n = ctx.normalizeTouchControls({buttonsInset: 120, buttonsLift: 200});
  assert.equal(n.buttonsInset, 120);
  assert.equal(n.buttonsLift, 200);
});
