import { deEsm } from './engine-env.mjs';
// La géométrie d'un graphe rate en silence, et le symptôme est toujours le même : « l'éditeur
// est bizarre ». Quatre façons :
//
//  · une flèche qui part du CENTRE — elle commence sous la boîte, invisible, et sa pointe est
//    enfouie dans celle d'arrivée : on ne lit plus le sens du link ;
//  · deux transitions entre les mêmes états qui se superposent — la seconde n'existe pas à
//    l'écran, et un aller/retour se confond avec un aller simple ;
//  · un clic qui attrape la boîte du dessous — on déplace celle qu'on ne voit pas ;
//  · un rangement automatique qui repasse derrière l'utilisateur et défait son graphe.
//
// Aucun DOM ici : c'est du calcul, et c'est justement ce qui rend ces quatre cas vérifiables.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const racineMoteur = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(racineMoteur, f), 'utf8');

function contexte(){
  const bac = {console, Math, JSON, Set, Map, Array, Object, Number, Infinity};
  bac.window = bac; bac.self = bac; bac.globalThis = bac;
  const ctx = vm.createContext(bac);
  vm.runInContext(deEsm(read('js/animator-graph-geo.js')), ctx, {filename:'js/animator-graph-geo.js'});
  return ctx;
}

const L = 150, H = 44;   // doivent rester en phase avec GRAPH_STATE_L / _H

// --- le rangement automatique -------------------------------------------------------------

test('les etats SANS position en recoivent une, distincte', () => {
  const ctx = contexte();
  const m = {states:[{name:'A'}, {name:'B'}, {name:'C'}]};
  ctx.disposeStates(m, 900);
  const vues = new Set(m.states.map((e) => e.x + ',' + e.y));
  // Toutes en (0,0) donnerait un tas illisible que l'utilisateur devrait démêler avant même
  // de comprendre sa machine.
  assert.equal(vues.size, 3, 'des états se superposent : ' + [...vues].join(' | '));
  m.states.forEach((e) => {
    assert.ok(Number.isFinite(e.x) && Number.isFinite(e.y), e.name + ' n’a pas de position');
  });
});

test('une position DEJA posee n est jamais deplacee', () => {
  const ctx = contexte();
  const m = {states:[{name:'A', x:500, y:300}, {name:'B'}]};
  ctx.disposeStates(m, 900);
  // L'utilisateur a rangé son graphe. Un rangement automatique qui repasse derrière lui à
  // chaque ouverture serait insupportable, et c'est le genre de détail qui fait abandonner.
  assert.equal(m.states[0].x, 500);
  assert.equal(m.states[0].y, 300);
  assert.ok(Number.isFinite(m.states[1].x), 'le nouvel état n’a pas été placé');
});

test('un etat NEUF ne se pose pas sur un etat deja place', () => {
  const ctx = contexte();
  // Le cas réel : on a rangé son graphe, puis on clique « ＋ État ». Compter seulement les
  // états SANS position remettait le nouveau sur la première case de la grille — déjà occupée.
  // Il apparaissait caché sous un autre : invisible, mais bel et bien là, et attrapé au premier
  // clic à sa place. Trouvé en manipulant le graphe, pas en le relisant.
  const m = {states:[{name:'Idle', x:40, y:40}, {name:'Marche', x:490, y:285}, {name:'Neuf'}]};
  ctx.disposeStates(m, 900);
  const neuf = m.states[2];
  m.states.slice(0, 2).forEach((e) => {
    const colle = Math.abs(e.x - neuf.x) < 150 && Math.abs(e.y - neuf.y) < 44;
    assert.equal(colle, false, 'le nouvel état chevauche « ' + e.name + ' » : '
      + neuf.x + ',' + neuf.y + ' contre ' + e.x + ',' + e.y);
  });
});

test('plusieurs states neufs ne s empilent pas entre eux non plus', () => {
  const ctx = contexte();
  const m = {states:[{name:'A', x:40, y:40}, {name:'B'}, {name:'C'}, {name:'D'}]};
  ctx.disposeStates(m, 900);
  const vues = new Set(m.states.map((e) => e.x + ',' + e.y));
  assert.equal(vues.size, 4, 'positions : ' + [...vues].join(' | '));
});

test('le rangement passe a la ligne quand la largeur ne suffit plus', () => {
  const ctx = contexte();
  const m = {states:[{name:'A'}, {name:'B'}, {name:'C'}, {name:'D'}]};
  ctx.disposeStates(m, 420);          // de quoi tenir deux colonnes, pas quatre
  const lines = new Set(m.states.map((e) => e.y));
  assert.ok(lines.size >= 2, 'tout est resté sur une ligne : ' + [...lines].join(', '));
  const max = Math.max(...m.states.map((e) => e.x));
  assert.ok(max + 150 <= 420 + 1, 'un état déborde de la largeur disponible (x=' + max + ')');
});

// --- les links ------------------------------------------------------------------------------

test('un link part du BORD de la box, pas de son centre', () => {
  const ctx = contexte();
  const a = {name:'A', x:0, y:0}, b = {name:'B', x:400, y:0};
  const t = ctx.traceLink(a, b, 0);
  // Le centre de A est à (75, 22) ; son edge droit à x = 150. Partir du centre cacherait la
  // moitié de la flèche sous la boîte.
  assert.equal(t.ax, L, 'départ à x=' + t.ax + ' au lieu du bord droit (' + L + ')');
  assert.equal(t.bx, 400, 'arrivée à x=' + t.bx + ' au lieu du bord gauche de B (400)');
});

test('le link sort par le bon edge selon la direction', () => {
  const ctx = contexte();
  const a = {name:'A', x:400, y:0}, b = {name:'B', x:0, y:0};
  const t = ctx.traceLink(a, b, 0);
  // A est à DROITE de B : le link doit sortir par la gauche de A, pas par la droite.
  assert.equal(t.ax, 400, 'le link sort du bad côté : x=' + t.ax);
  assert.equal(t.bx, L, 'il arrive du bad côté : x=' + t.bx);
});

test('deux links entre les MEMES etats ne se superposent pas', () => {
  const ctx = contexte();
  const a = {name:'A', x:0, y:0}, b = {name:'B', x:400, y:0};
  const t0 = ctx.traceLink(a, b, 0);
  const t1 = ctx.traceLink(a, b, 1);
  // Sans décalage, le second trait est rigoureusement invisible : il existe dans la donnée et
  // pas à l'écran, ce qui se lit comme « ma transition n'a pas été créée ».
  assert.notEqual(t0.cy, t1.cy, 'les deux links ont le même point de contrôle');
  assert.ok(Math.abs(t1.cy - t0.cy) >= 10,
    'écart de seulement ' + Math.abs(t1.cy - t0.cy) + ' px : les traits se toucheront');
});

test('un aller et un retour s ecartent CHACUN DE SON COTE', () => {
  const ctx = contexte();
  const a = {name:'A', x:0, y:0}, b = {name:'B', x:400, y:0};
  const aller = ctx.traceLink(a, b, 0);
  const retour = ctx.traceLink(b, a, 0);
  const mi = (0 + 400 + L) / 2;
  // Le décalage suit le SENS du link. Sans cela, A→B et B→A se confondraient en un seul trait,
  // et l'utilisateur croirait à un aller simple — l'erreur la plus coûteuse à débusquer, parce
  // que le graphe a l'air juste.
  assert.ok((aller.cy - 22) * (retour.cy - 22) < 0,
    'aller et retour partent du même côté (cy ' + aller.cy + ' et ' + retour.cy + ')');
});

test('traceLink pousse le point de controle plus loin quand un etat tiers est sur le trace direct', () => {
  const ctx = contexte();
  // Trois états alignés : A à gauche, C au milieu (l'obstacle), B à droite — un tracé A→B
  // direct traverserait C.
  const A = {name:'A', x:0, y:100};
  const C = {name:'C', x:200, y:100};   // état TIERS, ni source ni cible
  const B = {name:'B', x:400, y:100};
  const sansObstacle = ctx.traceLink(A, B, 0);
  const avecObstacle = ctx.traceLink(A, B, 0, [C]);
  // Le point de contrôle doit s'éloigner du segment direct quand C est fourni comme obstacle —
  // sans lui (comportement d'avant), le contrôle reste proche du milieu du segment.
  const ecartSans = Math.abs(sansObstacle.cy - 100);
  const ecartAvec = Math.abs(avecObstacle.cy - 100);
  assert.ok(ecartAvec > ecartSans,
    'le controle doit s\'écarter davantage du segment direct en présence d\'un obstacle : '
    + ecartSans + ' -> ' + ecartAvec);
});

test('traceLink sans obstacle sur le chemin ne change pas de comportement (retro-compatible)', () => {
  const ctx = contexte();
  const A = {name:'A', x:0, y:0};
  const B = {name:'B', x:100, y:0};
  const loin = {name:'loin', x:500, y:500};   // hors du tracé : ne doit rien changer
  const sans = ctx.traceLink(A, B, 0);
  const avecLoin = ctx.traceLink(A, B, 0, [loin]);
  assert.deepEqual(avecLoin, sans);
});

test('un rang de link compte les DEUX sens', () => {
  const ctx = contexte();
  const trans = [{de:'A', vers:'B'}, {de:'B', vers:'A'}, {de:'A', vers:'B'}, {de:'C', vers:'D'}];
  assert.equal(ctx.rankOfLink(trans, 0), 0);
  // Le retour occupe le même segment à l'écran : il doit compter, sinon il se superpose.
  assert.equal(ctx.rankOfLink(trans, 1), 1, 'le retour ignore l’aller déjà tracé');
  assert.equal(ctx.rankOfLink(trans, 2), 2);
  // Un couple sans rapport repart de zéro.
  assert.equal(ctx.rankOfLink(trans, 3), 0);
});

test('une transition d un etat VERS LUI-MEME se dessine en boucle au-dessus', () => {
  const ctx = contexte();
  const e = {name:'A', x:100, y:200};
  const t = ctx.traceLoop(e);
  // Un link vers soi-même avec la formule normale donnerait un point : rien à voir à l'écran.
  assert.ok(t.cy < 200, 'la boucle doit passer AU-DESSUS de la boîte (cy=' + t.cy + ')');
  assert.notEqual(t.ax, t.bx, 'les deux extrémités se confondent');
});

// --- ce qu'on a sous le curseur ------------------------------------------------------------

test('le clic attrape la box sous le point, et rien sinon', () => {
  const ctx = contexte();
  const m = {states:[{name:'A', x:0, y:0}, {name:'B', x:400, y:100}]};
  assert.equal(ctx.stateSubPoint(m, 10, 10).name, 'A');
  assert.equal(ctx.stateSubPoint(m, 410, 110).name, 'B');
  assert.equal(ctx.stateSubPoint(m, 300, 300), null, 'le vide rend un état');
  // Juste au-delà du bord : la boîte fait 150 × 44, pas un pixel de plus.
  assert.equal(ctx.stateSubPoint(m, L + 1, 10), null, 'la boîte déborde à droite');
  assert.equal(ctx.stateSubPoint(m, 10, H + 1), null, 'la boîte déborde en bas');
});

test('quand deux boites se chevauchent, on attrape CELLE DU DESSUS', () => {
  const ctx = contexte();
  const m = {states:[{name:'dessous', x:0, y:0}, {name:'topdown', x:20, y:10}]};
  // Le rendu dessine dans l'ordre déclaré : la dernière est visuellement au-dessus. Attraper
  // l'autre ferait déplacer une boîte qu'on ne voit pas.
  assert.equal(ctx.stateSubPoint(m, 30, 20).name, 'topdown');
});

test('l etendue couvre le dernier etat, marge comprise', () => {
  const ctx = contexte();
  const e = ctx.extentGraph({states:[{name:'A', x:0, y:0}, {name:'B', x:600, y:400}]});
  // Sans marge, la dernière boîte colle au bord de la zone défilante et on ne peut plus
  // l'attraper pour la déplacer.
  assert.ok(e.width > 600 + L, 'width ' + e.width + ' : pas de marge après le dernier état');
  assert.ok(e.height > 400 + H, 'height ' + e.height + ' : pas de marge après le dernier état');
});

test('une machine vide ne casse rien', () => {
  const ctx = contexte();
  assert.deepEqual(Array.from(ctx.disposeStates(null, 900)), []);
  assert.equal(ctx.stateSubPoint(null, 0, 0), null);
  const e = ctx.extentGraph(null);
  assert.ok(e.width > 0 && e.height > 0);
});
