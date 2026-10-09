import { deEsm } from './engine-env.mjs';
// Mélange 1D — plusieurs clips pilotés par UN paramètre.
//
// Le vrai sujet n'est PAS de pondérer deux clips : three sait déjà le faire avec des poids
// d'action. C'est la PHASE. Marche et Course n'ont ni la même durée ni la même cadence ;
// jouées chacune à son propre temps, les jambes bégaient — un pied qui touche pendant que
// l'autre décolle. Ces tests mesurent donc surtout le temps normalisé, pas les poids.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const racineMoteur = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(racineMoteur, f), 'utf8');

function contexte(){
  const bac = {console, Math, JSON, Set, Map, WeakMap, Array, Object, Number};
  bac.window = bac; bac.self = bac; bac.globalThis = bac;
  const ctx = vm.createContext(bac);
  vm.runInContext(deEsm(read('js/animator.js')), ctx, {filename:'js/animator.js'});
  return ctx;
}

const POINTS = [
  {clip:'idle',   value:0},
  {clip:'marche', value:2},
  {clip:'course', value:6}
];

test('sous le premier point et au-dessus du dernier, un seul clip a du poids', () => {
  const ctx = contexte();
  assert.deepEqual(ctx.weightBlend(POINTS, 0), [1, 0, 0]);
  assert.deepEqual(ctx.weightBlend(POINTS, 6), [0, 0, 1]);
  // Hors bounds on NE prolonge PAS la right : à speed 12, extrapoler donnerait un poids de
  // 2,5 sur la course et −1,5 sur la marche, c'est-à-dire une pose que personne n'a animée.
  assert.deepEqual(ctx.weightBlend(POINTS, -5), [1, 0, 0]);
  assert.deepEqual(ctx.weightBlend(POINTS, 12), [0, 0, 1]);
});

test('entre deux points, les poids sont lineaires et somment a 1', () => {
  const ctx = contexte();
  const p = ctx.weightBlend(POINTS, 3);   // un quart du chemin de marche (2) vers course (6)
  assert.ok(Math.abs(p[1] - 0.75) < 1e-9, 'marche = ' + p[1] + ' au lieu de 0,75');
  assert.ok(Math.abs(p[2] - 0.25) < 1e-9, 'course = ' + p[2] + ' au lieu de 0,25');
  assert.equal(p[0], 0, 'idle contribue alors qu\'il est hors du segment');
  assert.ok(Math.abs(p.reduce((a, b) => a + b, 0) - 1) < 1e-9, 'les poids ne somment pas à 1');
});

test('des points saisis DANS LE DESORDRE donnent quand meme les bons poids', () => {
  const ctx = contexte();
  // Un infographiste ajoute « course = 6 » puis se rend count qu'il lui manque « marche = 2 ».
  // Calculés sur un segment à l'envers, les poids seraient négatifs — trois clips joués
  // n'importe comment, sans la moindre erreur.
  const desordre = [{clip:'course', value:6}, {clip:'idle', value:0}, {clip:'marche', value:2}];
  const p = ctx.weightBlend(desordre, 3);
  assert.ok(p.every((w) => w >= 0), 'poids négatif : ' + JSON.stringify(p));
  assert.ok(Math.abs(p[0] - 0.25) < 1e-9, 'course = ' + p[0] + ' au lieu de 0,25');
  assert.ok(Math.abs(p[2] - 0.75) < 1e-9, 'marche = ' + p[2] + ' au lieu de 0,75');
  assert.equal(p[1], 0);
});

test('AUCUN doublon de valeur ne produit de poids NaN, ou l on saurait pourquoi', () => {
  const ctx = contexte();
  // Un écart nul entre deux points diviserait par zéro : poids infini, puis NaN, que three
  // applique en SILENCE — le personnage disparaît sans une ligne dans la console.
  //
  // Un cas choisi à la main ne prouverait rien ici : mon premier essai passait par le bornage
  // sans jamais atteindre le segment en cause. On balaie donc les quatre placements possibles
  // du doublon — début, milieu, end, partout — et une plage de valeurs qui déborde des deux
  // côtés. Ce test est ce qui autorise l'ABSENCE de garde dans le calcul des weight : si une
  // refonte rend un segment empty atteignable, il tombe ici.
  const jeux = [
    [['a', 0], ['b', 0]],
    [['a', 0], ['b', 2], ['c', 2], ['d', 6]],
    [['a', 0], ['b', 6], ['c', 6]],
    [['a', 2], ['b', 2], ['c', 2]],
    [['a', 6], ['b', 2], ['c', 2], ['d', 0]],   // et typed à l'envers, tant qu'à faire
    [['a', -1], ['b', -1], ['c', 3], ['d', 3]]
  ];
  let cas = 0;
  for(const game of jeux){
    const pts = game.map(([clip, value]) => ({clip, value}));
    for(let v = -3; v <= 9; v += 0.25){
      cas++;
      const p = ctx.weightBlend(pts, v);
      const ou = JSON.stringify(pts) + ' à ' + v + ' → ' + JSON.stringify(p);
      assert.ok(p.every((w) => Number.isFinite(w) && w >= 0), 'poids fautif : ' + ou);
      assert.ok(Math.abs(p.reduce((a, b) => a + b, 0) - 1) < 1e-9, 'somme ≠ 1 : ' + ou);
    }
  }
  assert.equal(cas, 294, 'le balayage a changé de taille : ' + cas);
});

test('un point sans clip ne prend pas la place d un vrai', () => {
  const ctx = contexte();
  // Une ligne à moitié saisie dans l'éditeur. Comptée comme un point, elle volerait la moitié
  // du poids à un clip existant : le personnage jouerait sa marche à 50 %, donc à moitié figé.
  const p = ctx.weightBlend([{clip:'idle', value:0}, {value:2}, {clip:'marche', value:4}], 2);
  assert.equal(p[1], 0, 'un point sans clip a reçu du poids');
  assert.ok(Math.abs(p.reduce((a, b) => a + b, 0) - 1) < 1e-9);
});

test('la duree melangee suit les poids, elle ne saute pas d un clip a l autre', () => {
  const ctx = contexte();
  const duration = (c) => ({idle:2, marche:1, course:0.6}[c]);
  // À mi-chemin entre marche (1 s) et course (0,6 s), le cycle dure 0,8 s. C'est ce qui fait
  // que la cadence change en DOUCEUR : choisir la durée d'un seul clip ferait accélérer le pas
  // d'un coup, à l'instant où le poids bascule.
  const p = ctx.weightBlend(POINTS, 4);
  assert.ok(Math.abs(ctx.durationBlended(POINTS, p, duration) - 0.8) < 1e-9);
  // Un clip de poids nul ne pèse rien dans la moyenne, même s'il dure une éternité.
  assert.equal(ctx.durationBlended(POINTS, ctx.weightBlend(POINTS, 6), duration), 0.6);
});

test('un clip introuvable ne ramene pas la duree melangee a zero', () => {
  const ctx = contexte();
  // Un clip renommé sur le modèle rend `durationOf` nul. Le compter comme une durée de 0
  // diviserait la moyenne par deux : le personnage courrait deux fois trop vite, pour un clip
  // qui n'est même pas là.
  const duration = (c) => (c === 'marche' ? 1 : 0);
  const p = ctx.weightBlend(POINTS, 4);
  assert.equal(ctx.durationBlended(POINTS, p, duration), 1);
});

test('chaque clip est lu a la vitesse qui le fait boucler EN MEME TEMPS que les autres', () => {
  const ctx = contexte();
  const duration = (c) => ({idle:2, marche:1, course:0.6}[c]);
  const p = ctx.weightBlend(POINTS, 4);              // moitié marche, moitié course
  const v = ctx.speedsBlend(POINTS, p, duration);
  const cycle = ctx.durationBlended(POINTS, p, duration);  // 0,8 s
  // La propriété qui définit tout : durée ÷ speed vaut le même cycle pour chacun.
  assert.ok(Math.abs(1 / v[1] - cycle) < 1e-9, 'marche loop en ' + (1 / v[1]) + ' s');
  assert.ok(Math.abs(0.6 / v[2] - cycle) < 1e-9, 'course loop en ' + (0.6 / v[2]) + ' s');
  // La marche est ralentie (1 s à jouer en 0,8), la course accélérée (0,6 s en 0,8).
  assert.ok(v[1] > 1 && v[2] < 1, 'vitesses = ' + JSON.stringify(v));
});

test('un clip de duree inconnue est joue a vitesse NORMALE, pas fige', () => {
  const ctx = contexte();
  // Vitesse 0 le figerait sur sa première image : un personnage à moitié en statue, sans
  // error et sans rien à quoi se raccrocher.
  const v = ctx.speedsBlend(POINTS, [0, 1, 0], (c) => (c === 'marche' ? 1 : 0));
  assert.ok(v.every((x) => x > 0), 'speed nulle : ' + JSON.stringify(v));
  assert.equal(v[0], 1);
});

// Simule ce que fait vraiment `AnimationMixer.update` : chaque action avance de
// `dt × speed` et reboucle sur sa propre durée. On ne teste pas une phase qu'on tiendrait
// à part — on teste le mécanisme par lequel les actions restent en pas toutes seules.
function simuler(ctx, pts, duration, images){
  const t = pts.map(() => 0);
  const ecarts = [];
  images.forEach(function(im){
    const p = ctx.weightBlend(pts, im.value);
    const v = ctx.speedsBlend(pts, p, duration);
    pts.forEach(function(pt, i){
      const d = duration(pt.clip);
      t[i] = (t[i] + im.dt * v[i]) % d;
    });
    // Fraction de cycle de chaque clip qui CONTRIBUE : c'est entre ceux-là que les pieds
    // doivent tomber ensemble. Un clip à poids nul n'a pas à être comparé, il ne se voit pas.
    const vus = pts.map((pt, i) => (p[i] > 0 ? t[i] / duration(pt.clip) : null))
                   .filter((x) => x !== null);
    // Écart CIRCULAIRE, et ce n'est pas une facilité : une phase à 0,999… et une à 0,000… sont
    // au même endroit du cycle, pas à un cycle l'une de l'autre. Mesuré en droite, ce test
    // rapportait un décalage de 0,9999999999999991 à l'image du bouclage — un artefact de
    // l'arrondi qui fait reboucler un clip une image avant l'autre, invisible à l'écran
    // puisque les deux extrémités d'une boucle sont la même pose.
    for(let i = 0; i < vus.length; i++){
      for(let j = i + 1; j < vus.length; j++){
        const raw = Math.abs(vus[i] - vus[j]);
        ecarts.push(Math.min(raw, 1 - raw));
      }
    }
  });
  return {time:t, pireEcart:ecarts.length ? Math.max(...ecarts) : 0, mesures:ecarts.length};
}

test('DEUX CLIPS DE DUREES DIFFERENTES RESTENT EN PAS, image apres image', () => {
  const ctx = contexte();
  // Le test central du lot. Marche dure 1 s, Course 0,6 s ; à speed 4 les deux contribuent.
  // Dix secondes à 60 images/s, en passant DEUX fois par la boucle de chaque clip.
  const duration = (c) => ({marche:1, course:0.6}[c]);
  const pts = [{clip:'marche', value:2}, {clip:'course', value:6}];
  const images = Array.from({length:600}, () => ({dt:1 / 60, value:4}));
  const r = simuler(ctx, pts, duration, images);
  assert.ok(r.mesures > 500, 'trop peu d\'images comparées : ' + r.mesures);
  assert.ok(r.pireEcart < 1e-9, 'pire décalage de phase : ' + r.pireEcart + ' de cycle');
});

test('le pas tient meme quand le parametre BOUGE en cours de route', () => {
  const ctx = contexte();
  // Le cas réel : le joueur accélère. Le cycle mélangé change à chaque image, donc les deux
  // vitesses changent — mais du même facteur, donc le rapport temps ÷ durée ne bouge pas.
  // C'est ce qui distingue ce mécanisme d'un simple « chacun sa vitesse ».
  const duration = (c) => ({marche:1, course:0.6}[c]);
  const pts = [{clip:'marche', value:2}, {clip:'course', value:6}];
  const images = Array.from({length:600}, (_, i) => ({dt:1 / 60, value:2 + 4 * (i / 599)}));
  const r = simuler(ctx, pts, duration, images);
  assert.ok(r.pireEcart < 1e-9, 'pire décalage de phase : ' + r.pireEcart + ' de cycle');
});

test('des images IRREGULIERES ne desynchronisent pas les clips', () => {
  const ctx = contexte();
  // Une image longue (chargement, tab en arrière-plan) doit décaler les deux clips
  // ensemble, pas l'un par rapport à l'autre.
  const duration = (c) => ({marche:1, course:0.6}[c]);
  const pts = [{clip:'marche', value:2}, {clip:'course', value:6}];
  const dts = [1 / 60, 1 / 30, 0.5, 1 / 120, 2, 1 / 60];
  const images = Array.from({length:300}, (_, i) => ({dt:dts[i % dts.length], value:4}));
  const r = simuler(ctx, pts, duration, images);
  assert.ok(r.pireEcart < 1e-9, 'pire décalage de phase : ' + r.pireEcart + ' de cycle');
});

test('un etat de melange est reconnu comme tel', () => {
  const ctx = contexte();
  assert.equal(ctx.isStateBlend({name:'Loco', blend:{param:'v', points:POINTS}}), true);
  assert.equal(ctx.isStateBlend({name:'Idle', clip:'idle'}), false);
  // Un mélange empty n'en est pas un : le traiter comme tel jouerait le néant à la place du clip.
  assert.equal(ctx.isStateBlend({name:'Loco', blend:{param:'v', points:[]}}), false);
  assert.equal(ctx.isStateBlend(null), false);
});

test('un point se lit et se reecrit sans se perdre en route', () => {
  const ctx = contexte();
  // Les objets rendus naissent DANS le bac à sable : leur prototype n'est pas celui d'ici, et
  // une comparaison stricte échouerait sur des valeurs pourtant identiques. On repasse donc
  // par JSON, qui ne garde que ce qu'on veut comparer.
  const lu = (s) => JSON.parse(JSON.stringify(ctx.readPointBlend(s) || null));
  assert.deepEqual(lu('marche = 2'), {clip:'marche', value:2});
  assert.deepEqual(lu('  course=6.5  '), {clip:'course', value:6.5});
  // La virgule décimale est ce qu'un francophone tape. La refuser en silence placerait le
  // point à 0 : un mélange qui ne mélange pas, sans rien à l'écran pour le dire.
  assert.deepEqual(lu('marche = 1,5'), {clip:'marche', value:1.5});
  // Un nom de clip exporté contient à peu près n'importe quoi — le DERNIER « = » sépare.
  assert.deepEqual(lu('a=b = 3'), {clip:'a=b', value:3});
  assert.equal(ctx.readPointBlend('marche'), null, 'une ligne sans valeur passe pour un point');
  assert.equal(ctx.readPointBlend('= 2'), null, 'une ligne sans clip passe pour un point');
  assert.equal(ctx.readPointBlend('marche = vite'), null);
  assert.equal(ctx.readPointBlend('   '), null);
  // Aller-retour : ce que l'éditeur réshown doit se relire à l'identique, sinon rouvrir un
  // état suffirait à déplacer ses points.
  const p = {clip:'course', value:-2.25};
  assert.deepEqual(lu(ctx.writePointBlend(p)), p);
  assert.equal(ctx.writePointBlend({clip:'idle'}), 'idle = 0');
  assert.equal(ctx.writePointBlend(null), '');
});

test('les fautes d un melange sont DITES, pas subies', () => {
  const ctx = contexte();
  const dis = (m) => ctx.validateAnimator(m, ['idle', 'marche']).join(' | ');
  const base = (state) => ({format:'animator', version:1, start:'Loco',
    params:[{name:'speed', type:'float'}],
    transitions:[{de:'Loco', vers:'Loco'}], states:[state]});

  // Un mélange correct ne déclenche PAS le « ne joue aucun clip » des états ordinaires.
  const bon = base({name:'Loco', blend:{param:'speed',
    points:[{clip:'idle', value:0}, {clip:'marche', value:2}]}});
  assert.equal(dis(bon), '', 'un mélange valide est signalé : ' + dis(bon));

  // Piloté par un paramètre qui n'existe pas, le mélange se lit toujours 0 : le personnage
  // reste sur le premier clip, à jamais, sans erreur. Même faute de frappe que dans une
  // condition, même silence, donc même contrôle.
  assert.match(dis(base({name:'Loco', blend:{param:'vitese',
    points:[{clip:'idle', value:0}, {clip:'marche', value:2}]}})), /n'est pas un paramètre/);

  assert.match(dis(base({name:'Loco', blend:{param:'speed',
    points:[{clip:'idle', value:0}, {clip:'sprint', value:2}]}})), /n'existe pas sur ce modèle/);
  // Le message dit ce qui est MESURÉ : à la valeur en double, un seul des deux joue, et lequel
  // dépend de la place dans la liste — le dernier gagne en bout de plage, le premier au milieu.
  // Annoncer « le second ne sera jamais joué » aurait été faux, une sonde l'a montré.
  assert.match(dis(base({name:'Loco', blend:{param:'speed',
    points:[{clip:'idle', value:0}, {clip:'marche', value:0}]}})), /un seul des deux est joué/);
  assert.match(dis(base({name:'Loco', blend:{param:'speed',
    points:[{clip:'idle', value:0}]}})), /ne mélange rien/);
});
