import { deEsm } from './engine-env.mjs';
// Inertialisation — résorber l'écart au lieu de mélanger deux poses.
//
// Ce fichier n'éprouve QUE la courbe. C'est la seule partie qui se calcule sans squelette, et
// c'est aussi celle où une erreur ne se verrait pas : un raccord qui a l'air correct à l'œil
// peut avoir une cassure de vitesse, et une cassure de vitesse est exactement ce que ce lot
// prétend supprimer. On la mesure donc, au lieu de la regarder.
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

// Dérivées par différences centrées : on mesure la courbe telle qu'elle sera EMPLOYÉE, à
// travers `evaluateInertia`, plutôt que de redériver le polynôme à côté — ce qui reviendrait à
// tester ma propre algèbre contre elle-même.
// À t = 0 la sonde doit être UNILATÉRALE : `evaluateInertia` clamped les temps négatifs à leur
// départ, donc une différence centrée y lirait deux fois la même valeur à gauche et rendrait la
// moitié de la vraie pente. Mon premier essai est tombé là-dessus — la courbe était juste, la
// mesure non.
const h = 1e-5;
const d1 = (ctx, c, t) => (t > h)
  ? (ctx.evaluateInertia(c, t + h) - ctx.evaluateInertia(c, t - h)) / (2 * h)
  : (-3 * ctx.evaluateInertia(c, t) + 4 * ctx.evaluateInertia(c, t + h)
     - ctx.evaluateInertia(c, t + 2 * h)) / (2 * h);
const d2 = (ctx, c, t) => (ctx.evaluateInertia(c, t + h) - 2 * ctx.evaluateInertia(c, t)
                           + ctx.evaluateInertia(c, t - h)) / (h * h);

test('la courbe part de l ECART et de la VITESSE qu on lui donne', () => {
  const ctx = contexte();
  const c = ctx.coefficientsInertia(0.5, -0.2, 0.25);
  assert.ok(Math.abs(ctx.evaluateInertia(c, 0) - 0.5) < 1e-12, 'x(0) = ' + ctx.evaluateInertia(c, 0));
  // LA condition du lot : sans elle, le membre repart d'une vitesse nulle et le raccord fait
  // une cassure — invisible sur une image fixe, très visible en mouvement.
  assert.ok(Math.abs(d1(ctx, c, 0) - (-0.2)) < 1e-4, "x'(0) = " + d1(ctx, c, 0));
});

test('elle arrive a zero SANS secousse : position, speed ET acceleration', () => {
  const ctx = contexte();
  const c = ctx.coefficientsInertia(0.5, -0.2, 0.25);
  const t = c.duration;
  // On probe juste AVANT la end : `evaluateInertia` rend zéro tout court au-delà, ce qui
  // masquerait une courbe qui n'y arrive pas d'elle-même.
  const e = 1e-4;
  assert.ok(Math.abs(ctx.evaluateInertia(c, t - e)) < 1e-8, 'x(end) = ' + ctx.evaluateInertia(c, t - e));
  assert.ok(Math.abs(d1(ctx, c, t - e)) < 1e-5, "x'(end) = " + d1(ctx, c, t - e));
  // La troisième condition, celle qu'on oublie : sans elle le mouvement s'arrête d'un coup au
  // moment précis où l'on croit avoir fini.
  assert.ok(Math.abs(d2(ctx, c, t - e)) < 1e-2, 'x"(end) = ' + d2(ctx, c, t - e));
});

test('passe la duree, l ecart vaut EXACTEMENT zero', () => {
  const ctx = contexte();
  const c = ctx.coefficientsInertia(1, 0, 0.2);
  assert.equal(ctx.evaluateInertia(c, 0.2), 0);
  assert.equal(ctx.evaluateInertia(c, 5), 0);
  // Un polynôme de degré cinq laissé libre repart à l'infini : hors de sa fenêtre il vaut
  // 4·t⁵, donc un membre qui s'envole si un dt oublié pousse `t` au-delà.
  assert.equal(ctx.evaluateInertia(c, 1e6), 0);
});

test('un temps NEGATIF ne fait pas repartir la courbe en arriere', () => {
  const ctx = contexte();
  const c = ctx.coefficientsInertia(1, 0, 0.2);
  // Peut arriver sur une image où l'horloge recule (tab réactivé). Le polynôme évalué à
  // t < 0 rendrait n'importe quoi ; on le clamped à son départ.
  assert.equal(ctx.evaluateInertia(c, -1), 1);
});

test('L ECART NE DEPASSE JAMAIS : ni sous zero, ni au-dessus du start', () => {
  const ctx = contexte();
  // Un dépassement se voit comme un petit rebond du membre au-delà de la pose visée, et ça
  // ressemble à un défaut de rig. On balaie donc largement plutôt que d'y croire.
  let pireSous = 0, pireAuDessus = 0, cas = 0;
  for(const x0 of [0.01, 0.2, 1, 5]){
    for(const v0 of [-20, -8, -3, -0.5, 0, 0.5, 3, 8]){
      for(const t1 of [0.05, 0.15, 0.3, 1]){
        const c = ctx.coefficientsInertia(x0, v0, t1);
        if(!c) continue;
        for(let k = 0; k <= 200; k++){
          cas++;
          const x = ctx.evaluateInertia(c, c.duration * k / 200);
          if(x < pireSous) pireSous = x;
          // Une vitesse initiale positive fait légitimement croître l'écart avant qu'il ne
          // retombe ; ce qu'on refuse, c'est qu'il EXPLOSE.
          const marge = x / (x0 + Math.abs(v0) * c.duration);
          if(marge > pireAuDessus) pireAuDessus = marge;
        }
      }
    }
  }
  assert.ok(cas > 3000, 'balayage trop maigre : ' + cas);
  assert.ok(pireSous > -1e-9, 'la courbe pass sous zéro : ' + pireSous);
  assert.ok(pireAuDessus <= 1.001, 'la courbe dépass son envelope : ' + pireAuDessus);
});

test('un ecart qui se referme DEJA vite raccourcit la duree', () => {
  const ctx = contexte();
  // Le membre file droit vers la pose visée : lui laisser 0,3 s le ferait passer au-delà avant
  // d'y revenir. La durée est donc ramenée à ce que la vitesse rend atteignable.
  assert.ok(ctx.durationInertia(0.1, -5, 0.3) < 0.3);
  assert.ok(Math.abs(ctx.durationInertia(0.1, -5, 0.3) - 0.1) < 1e-12, 'durée = ' + ctx.durationInertia(0.1, -5, 0.3));
  // Mais on ne l'ALLONGE jamais : une vitesse low ne doit pas faire durer le raccord plus
  // longtemps que ce que la transition demande.
  assert.equal(ctx.durationInertia(0.1, -0.01, 0.3), 0.3);
  // Et un écart qui GRANDIT ne raccourcit rien : le bornage n'existe que pour empêcher un
  // dépassement, et il n'y a rien à dépasser quand on s'éloigne encore. Le cas doit être choisi
  // pour que la clamped MORDE si elle s'appliquait — sinon le test passe sans rien prouver, ce
  // qu'une mutation m'a montré : avec x0 = 1 et v0 = 5 la clamped vaut 1 s, donc au-dessus des
  // 0,3 s demandées, et les deux versions rendaient la même chose.
  assert.equal(ctx.durationInertia(1, 5, 0.3), 0.3);
  assert.equal(ctx.durationInertia(0.01, 5, 0.3), 0.3, 'la durée est bornée alors que l\'écart grandit');
});

test('rien a resorber : pas de courbe du tout', () => {
  const ctx = contexte();
  // Deux poses identiques au moment de la transition. Il n'y a alors AUCUNE direction dans
  // laquelle apply un écart — la direction se prend en normalisant la différence, et une
  // différence nulle n'en a pas. On ne fabrique donc pas de courbe.
  assert.equal(ctx.coefficientsInertia(0, -1, 0.2), null);
  // Y compris quand les poses coïncident mais s'éloignent : sans direction, une courbe non
  // nulle pousserait chaque os n'importe où. C'est le cas que la version bornée seule laissait
  // passer, avec des coefficients à −120.
  assert.equal(ctx.coefficientsInertia(0, 3, 0.2), null);
  assert.equal(ctx.coefficientsInertia(0, 0, 0.2), null);
  assert.equal(ctx.coefficientsInertia(1, 0, 0), null, 'une durée nulle doit être refusée');
  assert.equal(ctx.coefficientsInertia(1, 0, -1), null);
  assert.equal(ctx.evaluateInertia(null, 0.1), 0);
});

test('la resorption est FRANCHE, pas molle', () => {
  const ctx = contexte();
  // Le choix d'accélération initiale se mesure ici. Laissée à zéro, la courbe garderait la
  // moitié de l'écart à mi-parcours : le personnage traînerait visiblement son ancienne pose.
  const c = ctx.coefficientsInertia(1, 0, 0.2);
  const milieu = ctx.evaluateInertia(c, 0.1);
  assert.ok(milieu < 0.25, 'écart restant à mi-parcours : ' + milieu + ' — résorption molle');
  assert.ok(milieu > 0.1, 'écart restant à mi-parcours : ' + milieu + ' — résorption brutale');
});
