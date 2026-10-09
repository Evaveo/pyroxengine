// L'ARBRE DE LAYOUT EST UNE DONNÉE, ET SES CAS DÉGRADÉS SONT LA MOITIÉ DU SUJET.
//
// Un dock ne devient un piège que par ses bords : un plugin désinstallé laisse un onglet
// fantôme, une nouvelle version ajoute un panneau que le layout enregistré ignore, une clé
// corrompue empêche l'éditeur de s'ouvrir. Aucun de ces cas ne se voit sans être provoqué —
// et tous se mesurent ici, sans navigateur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte } from './engine-env.mjs';

const env = creerContexte(['js/ui/dock-tree.js']);
const { LAYOUT_DEFAULT, normalizeLayout, serializeLayout, parseLayout, zonesOf, panelsOf } = env;

const connus = ['hierarchy', 'viewport', 'inspector', 'project', 'console'];
function neuf(){ return normalizeLayout(LAYOUT_DEFAULT, connus, {}); }

test('la disposition par defaut reproduit la geometrie de la grille CSS', () => {
  const l = normalizeLayout(LAYOUT_DEFAULT, connus, {});
  const zones = zonesOf(l.root);
  const byName = {};
  zones.forEach((z) => { byName[z.zone] = z; });
  assert.deepEqual(Object.keys(byName).sort(), ['bottom', 'center', 'left', 'right']);
  // 'console' (et 'environment'/'render' dans la colonne de droite) ne sont PLUS dans la
  // disposition par défaut : trop de panneaux ouverts au premier démarrage. Ils restent
  // atteignables via `onDemand` (menu Fenêtres) — voir js/ui/panels-shell.js/panels-scene.js.
  assert.deepEqual(Array.from(byName.bottom.tabs), ['project']);
  // La colonne de droite descend jusqu'en bas : elle n'est PAS dans la colonne qui porte
  // le panneau bas (css/editor.css:22-27, `insp` couvre les rangees 3 a 5).
  const droite = l.root.children[1];
  assert.equal(droite.zone, 'right', 'l inspecteur est un enfant DIRECT de la racine');
});

test('les tailles sont relatives et somment a 1', () => {
  const l = normalizeLayout(LAYOUT_DEFAULT, connus, {});
  (function verifie(n){
    if(!n.split) return;
    const somme = n.sizes.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(somme - 1) < 1e-6, 'les tailles d un split somment a 1 : ' + n.sizes);
    assert.equal(n.sizes.length, n.children.length);
    n.children.forEach(verifie);
  })(l.root);
});

test('CAS 1 — un panneau inconnu est ignore, et une zone vide disparait', () => {
  const l = normalizeLayout({ version: 1, root: { split: 'row', sizes: [0.5, 0.5], children: [
    { zone: 'left', tabs: ['hierarchy', 'plugin-disparu'], active: 'plugin-disparu' },
    { zone: 'center', tabs: ['fantome'], active: 'fantome' } ] } }, connus, {});
  const zones = zonesOf(l.root);
  assert.equal(zones.length, 1, 'la zone qui ne contenait qu un fantome doit disparaitre');
  assert.deepEqual(Array.from(zones[0].tabs), ['hierarchy']);
  assert.equal(zones[0].active, 'hierarchy', 'l actif pointait sur le fantome : il est repris');
});

test('CAS 2 — un panneau connu absent du layout rejoint sa zone par defaut', () => {
  const l = normalizeLayout({ version: 1, root: { zone: 'left', tabs: ['hierarchy'], active: 'hierarchy' } },
    connus, { inspector: 'right', viewport: 'center', project: 'bottom', console: 'bottom' });
  const tous = panelsOf(l);
  connus.forEach((id) => assert.ok(tous.indexOf(id) !== -1, id + ' doit avoir ete injecte'));
});

test('CAS 2 bis — sans zone par defaut connue, le panneau part en flottant', () => {
  const l = normalizeLayout({ version: 1, root: { zone: 'left', tabs: ['hierarchy'], active: 'hierarchy' } },
    ['hierarchy', 'exotique'], {});
  assert.ok(l.floating.some((f) => f.panel === 'exotique'));
});

test('CAS 3 — un layout corrompu ou de version inconnue retombe sur le defaut', () => {
  assert.equal(parseLayout('{ pas du json', connus, {}).fallback, true);
  assert.equal(parseLayout(JSON.stringify({ version: 99, root: {} }), connus, {}).fallback, true);
  assert.equal(parseLayout(JSON.stringify({ version: 1 }), connus, {}).fallback, true);
  const bon = serializeLayout(normalizeLayout(LAYOUT_DEFAULT, connus, {}));
  assert.equal(parseLayout(bon, connus, {}).fallback, false);
});

test('CAS 4 — un layout absent (mode prive) donne le defaut, sans lever', () => {
  const r = parseLayout(null, connus, {});
  assert.equal(r.fallback, true);
  assert.equal(zonesOf(r.layout.root).length, 4);
});

test('aller-retour : serialiser puis relire rend le meme arbre', () => {
  const l = normalizeLayout(LAYOUT_DEFAULT, connus, {});
  const relu = parseLayout(serializeLayout(l), connus, {}).layout;
  assert.equal(serializeLayout(relu), serializeLayout(l));
});

test('un split a un seul enfant est aplati', () => {
  const l = normalizeLayout({ version: 1, root: { split: 'row', sizes: [1], children: [
    { zone: 'left', tabs: ['hierarchy'], active: 'hierarchy' } ] } }, ['hierarchy'], {});
  assert.equal(l.root.zone, 'left', 'un split d un seul enfant n a pas de sens : il disparait');
});

test('la vue 3D ne peut pas etre fermee', () => {
  const l = normalizeLayout({ version: 1, root: { zone: 'left', tabs: ['hierarchy'], active: 'hierarchy' } },
    connus, { viewport: 'center' }, { viewport: { closable: false } });
  assert.ok(panelsOf(l).indexOf('viewport') !== -1,
    'un layout sans vue 3D doit se voir en rendre une : sinon on ne peut plus la recuperer');
});


test('un panneau dont la zone par defaut a DISPARU rejoint une zone existante', () => {
  // POURQUOI CE TEST EXISTE. Deplacer le dernier onglet d une zone la fait disparaitre. Rouvrir
  // ensuite un panneau dont c etait la zone par defaut le renvoyait EN FLOTTANT : on refermait
  // sa fenetre, il rouvrait une fenetre, indefiniment. Un panneau qu on vient de rouvrir doit
  // revenir DANS la coquille.
  const l = normalizeLayout({ version: 1, root: { zone: 'left', tabs: ['hierarchy'], active: 'hierarchy' } },
    ['hierarchy', 'inspector'], { inspector: 'right' });
  assert.equal(l.floating.length, 0, 'sa zone par defaut n existe plus, mais il ne flotte pas');
  assert.ok(Array.from(zonesOf(l.root)[0].tabs).indexOf('inspector') !== -1);
});

test('un panneau onDemand absent du layout ne part PAS en flottant tout seul', () => {
  const descr = { animation: { onDemand: true } };
  const l = normalizeLayout(LAYOUT_DEFAULT, connus.concat('animation'), {}, descr);
  assert.equal(panelsOf(l).indexOf('animation'), -1,
    'onDemand : absent tant qu on ne l a pas ouvert explicitement, contrairement a un panneau exotique');
});

test('un layout releve avec un panneau POPPE le fait retomber flottant EN PAGE', () => {
  const avecPoppe = JSON.stringify(Object.assign({}, JSON.parse(serializeLayout(neuf())),
    { popped: [{ panel: 'inspector', x: 10, y: 10, w: 400, h: 300 }] }));
  const { layout } = parseLayout(avecPoppe, connus, {}, {});
  assert.equal(layout.popped.length, 0,
    'jamais de fenetre OS rouverte toute seule au chargement (bloque par le navigateur)');
  assert.ok(layout.floating.some((f) => f.panel === 'inspector'),
    'il retombe flottant EN PAGE, avec la meme geometrie');
});

test('un layout enregistre SANS copilote se relit tel quel (copilote a la demande)', () => {
  const ids = connus.concat(['copilot']);
  const zones = { copilot: 'right' };
  const descr = { copilot: { id: 'copilot', defaultZone: 'right', onDemand: true } };
  const ancien = normalizeLayout(LAYOUT_DEFAULT, connus, {});
  const relu = normalizeLayout(parseLayout(serializeLayout(ancien)), ids, zones, descr);
  assert.equal(panelsOf(relu).indexOf('copilot'), -1, 'pas injecte au demarrage');
  assert.deepEqual(panelsOf(relu).slice().sort(), panelsOf(ancien).slice().sort());
  // Rouvert explicitement (Dock.reopen leve onDemand) : il rejoint la colonne de droite.
  const ouvert = normalizeLayout(relu, ids, zones, { copilot: { id: 'copilot', defaultZone: 'right' } });
  const droite = zonesOf(ouvert.root).find((z) => z.zone === 'right');
  assert.ok(droite && droite.tabs.indexOf('copilot') !== -1);
});
