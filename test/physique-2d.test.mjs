import { deEsm } from './engine-env.mjs';
// Physics 2D — le solveur, sans three et sans DOM.
//
// Le test qui porte tout le fichier est celui des JOINTURES : un corps qui glisse sur un sol
// fait de blocs jointifs ne doit pas s'accrocher. C'est le défaut que produit la méthode
// courante — résoudre selon l'axe de moindre pénétration — et c'est pour lui que ce solveur
// traite les deux axes séparément.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');

function contexte(){
  const bac = {console, Math, JSON, Set, Map, Array, Object, Number, isFinite};
  bac.window = bac; bac.self = bac; bac.globalThis = bac;
  const ctx = vm.createContext(bac);
  vm.runInContext(deEsm(read('js/physics-2d.js')), ctx, {filename:'js/physics-2d.js'});
  return ctx;
}

const G = -20;                                  // gravité, en unités par seconde carrée
const DT = 1 / 60;
const body = (x, y, dl, dh, vx, vy) => ({x, y, dl, dh, vx: vx || 0, vy: vy || 0});
const block = (x, y, dl, dh, extra) => Object.assign({x, y, dl, dh, statique: true}, extra || {});

/** Fait tourner `n` images et rend le body. */
function simuler(ctx, c, obstacles, n){
  for(let i = 0; i < n; i++) ctx.stepPhysics2d(c, obstacles, G, DT);
  return c;
}

test('la gravite tombe, et un corps statique y echappe', () => {
  const ctx = contexte();
  const c = body(0, 10, 0.5, 0.5);
  ctx.applyGravity2d(c, G, DT);
  assert.ok(Math.abs(c.vy - (G * DT)) < 1e-12);
  const stat = Object.assign(body(0, 10, 0.5, 0.5), {statique: true});
  ctx.applyGravity2d(stat, G, DT);
  assert.equal(stat.vy, 0, 'un obstacle qui tombe emporterait tout le niveau');
});

test('un body tombe et s arrete EXACTEMENT sur le sol', () => {
  const ctx = contexte();
  const ground = block(0, -1, 10, 1);               // sa face haute est à y = 0
  const c = simuler(ctx, body(0, 5, 0.5, 0.5), [ground], 120);
  // Le bottom du body doit reposer sur la face haute du sol, pas dedans, pas au-dessus.
  assert.ok(Math.abs((c.y - c.dh) - 0) < 1e-9, 'le bottom du body est à ' + (c.y - c.dh));
  assert.equal(c.vy, 0, 'la vitesse verticale doit être annulee, sinon il s enfonce');
  assert.equal(c.atGround, true);
});

test('LES JOINTURES N ACCROCHENT PAS — le test qui justifie les deux passes', () => {
  const ctx = contexte();
  // Un sol fait de six blocks JOINTIFS de 1 unité, comme une tilemap. Un body qui glisse
  // dessus ne doit rien sentir. Avec une résolution par pénétration minimale, il buterait sur
  // la première arête verticale : à cet instant la pénétration horizontale est la plus petite,
  // et le body est repoussé sur le côté — il s'arrête net au milieu d'un sol plat.
  const ground = [];
  for(let i = 0; i < 6; i++) ground.push(block(i * 1 + 0.5, -0.5, 0.5, 0.5));
  const c = body(0.5, 0.4, 0.4, 0.4, 3, 0);    // posé sur le sol, poussé vers la droite
  const xDepart = c.x;
  simuler(ctx, c, ground, 60);                     // une seconde à 3 unités/s
  assert.ok(c.x > xDepart + 2.5, 'le body s est accroché : parti de ' + xDepart + ', arrivé à ' + c.x);
  assert.equal(c.atGround, true, 'il doit rester au sol tout du long');
  assert.ok(Math.abs((c.y - c.dh) - 0) < 1e-9, 'sa hauteur ne doit pas avoir bougé');
});

test('UNE MARCHE se franchit, un MUR arrete — la difference est la hauteur', () => {
  const ctx = contexte();
  // Le défaut mesuré dans le navigateur : au sommet d'une pente, le personnage butait sur le
  // palier qu'elle rejoint et s'arrêtait à 0,3 unité du but, sans qu'aucun mur ne soit visible.
  // Une bordure d'un seul pixel produirait le même arrêt.
  //
  // 90 images à 4 unités/s = 6 unités parcourues, et la marche s'étend de 5 à 7 : le body est
  // DESSUS à la mesure. Une durée plus longue le ferait redescendre de l'autre côté et le test
  // mesurerait la descente au lieu de la montée — c'est ce qu'il faisait, et il criait « il n'est
  // pas monté » alors que le body était monté puis redescendu.
  const ground = block(0, -0.5, 12, 0.5);           // haut = 0, assez long pour l'élan
  const marche = block(6, 0.1, 1, 0.1);          // haut = 0,2 — franchissable
  const c = body(0, 0.4, 0.4, 0.4, 4, 0);
  simuler(ctx, c, [ground, marche], 90);
  // Buter donnerait x = 4,6 (la face gauche de la marche moins la demi-width).
  assert.ok(c.x > 5, 'le body a buté sur une marche de 0,2 : x = ' + c.x);
  assert.ok(Math.abs((c.y - c.dh) - 0.2) < 1e-6, 'il devrait être monté dessus, bottom = ' + (c.y - c.dh));

  // Et un vrai mur, lui, arrête : la clamped doit distinguer les deux, sinon un personnage
  // escaladerait les murs.
  const mur = block(6, 2, 1, 2);                 // haut = 4, bien au-dessus de la clamped
  const d = body(0, 0.4, 0.4, 0.4, 4, 0);
  simuler(ctx, d, [ground, mur], 90);
  assert.ok(Math.abs((d.x + d.dl) - (mur.x - mur.dl)) < 1e-6, 'le mur n a pas arrêté : x = ' + d.x);
  assert.equal(d.vx, 0);
});

test('LA MONTEE SUR LA MARCHE EST FAITE EN PASSE X, pas rattrapee par la passe Y', () => {
  const ctx = contexte();
  // Sans `body.y += marche`, la passe Y remonte le body dans presque tous les cas et la ligne
  // a l'air inutile — la mutation qui la neutralisait survivait à tous les tests. Elle ne
  // survit pas à CE cas : un rebord MINCE dont le centre est plus haut que celui du body.
  // La passe Y compare les CENTRES ; ici elle conclut « le body est sous l'obstacle » et le
  // repousse vers le BAS, enfonçant le personnage dans le sol au lieu de le poser sur le rebord.
  const rebord = block(3, 0.43, 0.5, 0.05);      // 0,1 d'épaisseur, dessus à 0,48
  // Une SEULE image, sur le corps déjà en contact : c'est la seule qui mesure quelque chose. La
  // montée faite, le body affleure le rebord — le chevauchement redevient nul — et plus rien ne
  // se produit ensuite. Mesurer soixante images plus tard aurait rendu le bon chiffre pour la
  // mauvaise raison : le body aurait déjà dépassé le rebord et flotterait à la même hauteur.
  const c = body(2.45, 0.4, 0.1, 0.4, 0, 0);   // pieds à 0, deux fois plus haut que le rebord
  Object.assign(c, {withoutGravity: true});
  const state = ctx.stepPhysics2d(c, [rebord], G, DT);
  assert.ok(Math.abs((c.y - c.dh) - 0.48) < 1e-9,
    'le body devait être posé sur le rebord (0,48), ses pieds sont à ' + (c.y - c.dh));
  // Et le contact au sol vient d'ici, pas de la passe Y qui ne voit plus rien. Sans cette pose,
  // le personnage serait « en l'air » debout sur une marche, et ne pourrait pas sauter.
  assert.equal(state.atGround, true, 'posé sur le rebord, il doit être au sol');
});

test('UN PETIT PERSONNAGE N ESCALADE PAS ce qui est un mur POUR LUI', () => {
  const ctx = contexte();
  // La clamped seule ne suffit pas : 0,4 est sous la clamped de 0,5, donc un obstacle deux fois plus
  // haut qu'un petit personnage serait « une marche » et il grimperait dessus. Le balayage en a
  // compté 69 configurations. Ce qui décide n'est pas la hauteur absolue mais le rapport au
  // body : le HAUT du body doit dépasser le dessus de l'obstacle.
  const rebord = block(3, 0.25, 0.5, 0.15);      // dessus à 0,4
  const c = body(0, 0.1, 0.1, 0.1, 4, 0);      // 0,2 de top : le rebord le dépass
  Object.assign(c, {withoutGravity: true});
  simuler(ctx, c, [rebord], 60);
  assert.ok(Math.abs((c.x + c.dl) - (rebord.x - rebord.dl)) < 1e-9,
    'il a escaladé un mur deux fois plus haut que lui : x = ' + c.x);
  assert.ok(Math.abs(c.y - 0.1) < 1e-9, 'il ne devait pas monter : y = ' + c.y);
  assert.equal(c.vx, 0);
});

test('UN OBSTACLE A HAUTEUR DE taille n est pas une marche, meme pour un grand body', () => {
  const ctx = contexte();
  // Deux conditions distinctes, et il faut les deux : le rapport au body dit « ce n'est pas un
  // mur POUR LUI », la clamped dit « ce n'est quand même pas une marche ». Sans la clamped, un
  // personnage d'une unité de haut escaladerait tout ce qui lui arrive à la ceinture, d'un coup
  // et sans sauter — le rapport au body, lui, l'autorise jusqu'à sa propre size.
  const rebord = block(3, 0.35, 0.5, 0.35);      // dessus à 0,7 : au-dessus de la clamped de 0,5
  const c = body(0, 0.5, 0.3, 0.5, 4, 0);      // 1 unité de haut, pieds à 0
  Object.assign(c, {withoutGravity: true});
  simuler(ctx, c, [rebord], 60);
  assert.ok(Math.abs((c.x + c.dl) - (rebord.x - rebord.dl)) < 1e-9,
    'il a escaladé 0,7 d un coup, sans sauter : x = ' + c.x);
  assert.ok(Math.abs(c.y - 0.5) < 1e-9, 'il ne devait pas monter : y = ' + c.y);

  // La clamped se règle PAR OBSTACLE : c'est ainsi qu'on autorise un escalier franc là où le reste
  // du décor reste infranchissable. Le même rebord, déclaré montable, se monte.
  const marchePied = block(3, 0.35, 0.5, 0.35, {stepUpMax: 1});
  const d = body(0, 0.5, 0.3, 0.5, 4, 0);
  Object.assign(d, {withoutGravity: true});
  simuler(ctx, d, [marchePied], 60);
  assert.ok(d.x > 3, 'le stepUpMax de l obstacle a été ignoré : x = ' + d.x);
  assert.ok(Math.abs((d.y - d.dh) - 0.7) < 1e-9, 'il devait monter à 0,7 : pieds à ' + (d.y - d.dh));
});

test('A EGALITE EXACTE de hauteur, l obstacle est un MUR', () => {
  const ctx = contexte();
  // Le cas limite de la comparaison : le dessus de l'obstacle est exactement à hauteur du crâne.
  // Monter dessus voudrait dire se téléporter de sa propre height en une image. La comparaison
  // doit être stricte ; relâchée en `>=`, elle laisse passer exactement ce cas.
  const rebord = block(3, 0.25, 0.5, 0.25);      // dessus à 0,5
  const c = body(0, 0.25, 0.2, 0.25, 4, 0);    // crâne à 0,5 lui aussi
  Object.assign(c, {withoutGravity: true});
  simuler(ctx, c, [rebord], 60);
  assert.ok(Math.abs((c.x + c.dl) - (rebord.x - rebord.dl)) < 1e-9,
    'il a escaladé un obstacle de sa propre height : x = ' + c.x);
  assert.ok(Math.abs(c.y - 0.25) < 1e-9, 'il ne devait pas monter : y = ' + c.y);
});

test('FROLER UNE MARCHE EN PLEIN SAUT ne rend pas le contact au sol', () => {
  const ctx = contexte();
  // Le défaut classique du platformer : le contact au sol rendu par le franchissement recharge
  // le saut à chaque image où le personnage touche le décor, et il remonte une paroi en tenant
  // la touche. Une seule image suffit à le mesurer.
  const marche = block(3, 0.15, 0.5, 0.15);      // dessus à 0,3
  const c = body(2.15, 0.4, 0.4, 0.4, 0, 5);   // en pleine montée, à cheval sur la marche
  Object.assign(c, {withoutGravity: true});
  const state = ctx.stepPhysics2d(c, [marche], G, DT);
  assert.ok(c.y > 0.4, 'le franchissement devait quand même le poser sur la marche : y = ' + c.y);
  assert.equal(state.atGround, false, 'un corps qui monte n est pas au sol — il y gagnerait un saut');
});

test('LA HAUTEUR DE SAUT DEMANDEE est celle qu on atteint', () => {
  const ctx = contexte();
  // L'inspecteur promet que le réglage est une HAUTEUR et pas une vitesse. Il mentait de 4 % :
  // l'intégrateur retranche une image de gravité avant le premier déplacement, et 2 unités
  // demandées en donnaient 1,92. Assez pour rater un rebord réglé au millimètre, et on
  // chercherait du côté du décor.
  const ground = block(0, -0.5, 20, 0.5);
  const sommetAtteint = (v) => {
    const c = body(0, 0.4, 0.4, 0.4, 0, v);
    let h = c.y;
    for(let i = 0; i < 120; i++){ ctx.stepPhysics2d(c, [ground], G, DT); h = Math.max(h, c.y); }
    return h - 0.4;                             // les pieds partaient de 0
  };
  const sansPas = sommetAtteint(ctx.speedOfJump2d(2, G));
  assert.ok(2 - sansPas > 0.05, 'la formule continue devrait sous-estimer : sommet = ' + sansPas);
  // Le reste est le grain du pas de temps lui-même : le sommet n'est pas échantillonné, il
  // tombe entre deux images. On ne peut pas descendre sous g·dt²/2, soit 0,0028 ici.
  const avecPas = sommetAtteint(ctx.speedOfJump2d(2, G, DT));
  assert.ok(Math.abs(avecPas - 2) < 0.003, 'sommet atteint = ' + avecPas + ' pour 2 demandés');
});

test('un mur arrete net, et annule la vitesse horizontale', () => {
  const ctx = contexte();
  const mur = block(3, 0, 0.5, 5);
  const c = body(0, 0, 0.5, 0.5, 5, 0);
  Object.assign(c, {withoutGravity: true});
  simuler(ctx, c, [mur], 60);
  assert.ok(Math.abs((c.x + c.dl) - (mur.x - mur.dl)) < 1e-9, 'x = ' + c.x);
  assert.equal(c.vx, 0);
});

test('UNE PLATEFORME A SENS UNIQUE : on la traverse par en dessous, on se pose par au-dessus', () => {
  const ctx = contexte();
  const plate = block(0, 2, 2, 0.1, {traversable: true});
  // 1. En montant, elle ne doit rien arrêter.
  const monte = body(0, 0, 0.4, 0.4, 0, 12);
  simuler(ctx, monte, [plate], 20);
  assert.ok(monte.y > plate.y + plate.dh, 'la plateforme a bloqué un corps qui montait : y = ' + monte.y);
  // 2. En retombant depuis au-dessus, elle doit le porter.
  const retombe = body(0, 6, 0.4, 0.4, 0, 0);
  simuler(ctx, retombe, [plate], 120);
  assert.ok(Math.abs((retombe.y - retombe.dh) - (plate.y + plate.dh)) < 1e-9,
    'il devrait reposer sur la plateforme, il est à ' + retombe.y);
  assert.equal(retombe.atGround, true);
});

test('ON PEUT SAUTER depuis une plateforme a sens unique', () => {
  const ctx = contexte();
  // Le cas que la condition « il descend » protège, et que je n'avais pas couvert : à l'instant
  // du saut, le body vient d'AU-DESSUS — il y était posé — donc sans cette condition il serait
  // recollé sur la plateforme à l'image même du saut. Le saut ne partirait jamais, et on
  // chercherait du côté des commandes.
  const plate = block(0, 2, 2, 0.1, {traversable: true});
  const c = body(0, 2.5, 0.4, 0.4, 0, 0);
  simuler(ctx, c, [plate], 60);                 // il se pose
  assert.equal(c.atGround, true, 'il devrait d abord reposer sur la plateforme');
  c.vy = ctx.speedOfJump2d(2, G);             // et il saute
  const yPose = c.y;
  simuler(ctx, c, [plate], 15);
  assert.ok(c.y > yPose + 0.5, 'le saut a été annulé par la plateforme : ' + yPose + ' → ' + c.y);
});

test('un SAUT SOUS UNE PENTE ne colle pas le body a sa surface', () => {
  const ctx = contexte();
  // Symétrique du cas précédent, et pas couvert non plus : un corps qui monte sous une pente
  // serait aimanté à sa face, saut compris. On se pose sur une pente en DESCENDANT vers elle.
  const rolloff = block(2, 3, 2, 1, {rolloff: true, stepUp: 'right'});
  const c = body(2, 0.5, 0.3, 0.3, 0, 0);
  c.vy = ctx.speedOfJump2d(1, G);             // un saut trop court pour la dépasser
  let sommet = c.y;
  for(let i = 0; i < 40; i++){ ctx.stepPhysics2d(c, [rolloff], G, DT); sommet = Math.max(sommet, c.y); }
  assert.ok(sommet < 2.5, 'le body a été aimanté à la pente : il est monté à ' + sommet);
  assert.ok(c.y < 1, 'il devrait être redescendu, il est à ' + c.y);
});

test('un body DEJA a l interieur d une plateforme n y reste pas piege', () => {
  const ctx = contexte();
  // Le cas qu'on n'imagine pas : un objet posé dans l'éditeur à cheval sur la plateforme.
  // Sans la troisième condition, il serait remonté dessus a chaque image et n'en sortirait
  // jamais — un objet collé en l'air, sans explication.
  const plate = block(0, 2, 2, 0.5, {traversable: true});
  const dedans = body(0, 2, 0.4, 0.4, 0, 0);
  simuler(ctx, dedans, [plate], 60);
  assert.ok(dedans.y < 1, 'le body est resté piégé dans la plateforme : y = ' + dedans.y);
});

test('une PENTE se monte sans sauter, et ne retient pas hors de sa box', () => {
  const ctx = contexte();
  // Boîte de x ∈ [0,4], y ∈ [0,2], montant vers la droite.
  const rolloff = block(2, 1, 2, 1, {rolloff: true, stepUp: 'right'});
  assert.equal(ctx.heightSlope2d(rolloff, 0), 0, 'le pied de la pente');
  assert.equal(ctx.heightSlope2d(rolloff, 4), 2, 'le sommet');
  assert.equal(ctx.heightSlope2d(rolloff, 2), 1, 'le milieu');
  // HORS de la boîte : null, et non la hauteur du bord — sinon un body flotterait au-delà de
  // la pente comme s'il y avait un mur invisible.
  assert.equal(ctx.heightSlope2d(rolloff, 5), null);
  assert.equal(ctx.heightSlope2d(rolloff, -1), null);
  // Montée vers la left : la symétrie.
  const inverse = block(2, 1, 2, 1, {rolloff: true, stepUp: 'left'});
  assert.equal(ctx.heightSlope2d(inverse, 0), 2);
  assert.equal(ctx.heightSlope2d(inverse, 4), 0);

  // Et en marchant dessus : le body monte, sans jamais sauter.
  const c = body(0.2, 0.5, 0.2, 0.4, 2, 0);
  const yDepart = c.y;
  simuler(ctx, c, [rolloff], 60);
  assert.ok(c.y > yDepart + 0.5, 'le body n a pas monté la pente : ' + yDepart + ' → ' + c.y);
  assert.equal(c.atGround, true);
});

test('une CHUTE RAPIDE sur une pente atterrit dessus, sans la traverser ni teleporter', () => {
  const ctx = contexte();
  // Deux gardes se rencontrent ici, et aucune autre mesure ne les distingue.
  //
  // · Tomber de 60 unités donne près de 50 unités/s, soit 0,8 par image — bien plus que la
  //   clamped de montée. Sans la règle « il vient de TRAVERSER la surface », le body passerait
  //   au travers de la pente et continuerait à tomber indéfiniment.
  // · Et sans la garde « il est encore au-dessus », il serait collé à la pente dès la première
  //   image, cinquante unités plus bas : une téléportation.
  const rolloff = block(2, 1, 2, 1, {rolloff: true, stepUp: 'right'});
  const c = body(2, 60, 0.3, 0.3, 0, 0);
  // Au bout de cinq images il doit encore être top : il tombe, il n'est pas aspiré.
  simuler(ctx, c, [rolloff], 5);
  assert.ok(c.y > 55, 'le body a été téléporté sur la pente : y = ' + c.y);
  // Puis il finit par se poser, sur la surface et pas ailleurs.
  simuler(ctx, c, [rolloff], 300);
  const surface = ctx.heightSlope2d(rolloff, c.x);
  assert.ok(Math.abs((c.y - c.dh) - surface) < 1e-6,
    'il devrait reposer à ' + surface + ', il est à ' + (c.y - c.dh));
  assert.equal(c.atGround, true);

  // Le franchissement rendu DÉTERMINISTE. Ci-dessus, la frame de traversée tombait par chance
  // dans la clamped de montée, et la règle « il vient de traverser » n'était donc pas exercée —
  // une mutation qui la supprimait survivait. Ici le pas d'intégration fait UNE unité pour
  // 0,05 de marge : seule la traversée peut rattraper le body.
  const s2 = ctx.heightSlope2d(rolloff, 2);
  const rapide = body(2, s2 + 0.3 + 0.05, 0.3, 0.3, 0, -60);
  ctx.stepPhysics2d(rapide, [rolloff], 0, DT);
  assert.ok(Math.abs((rapide.y - rapide.dh) - s2) < 1e-6,
    'le body a traversé la pente : il est à ' + (rapide.y - rapide.dh) + ' au lieu de ' + s2);
});

test('un saut atteint EXACTEMENT la hauteur demandee', () => {
  const ctx = contexte();
  // Régler un saut en unités par seconde oblige à essayer au jugé ; le régler en hauteur est ce
  // que l auteur a en tête. On vérifie donc que la conversion tient.
  const ground = block(0, -1, 10, 1);
  const c = body(0, 0.5, 0.5, 0.5);
  c.vy = ctx.speedOfJump2d(3, G);
  let sommet = c.y;
  for(let i = 0; i < 200; i++){
    ctx.stepPhysics2d(c, [ground], G, DT);
    sommet = Math.max(sommet, c.y);
  }
  const monte = sommet - 0.5;
  // Tolérance d'un pas d'intégration : l'échantillonnage à 60 Hz ne peut pas tomber pile au
  // sommet. 5 % est bien en dessous de ce qu'un joueur perçoit.
  assert.ok(Math.abs(monte - 3) < 0.15, 'le saut monte de ' + monte.toFixed(3) + ' au lieu de 3');
  assert.equal(ctx.speedOfJump2d(0, G), 0, 'aucune hauteur : aucun saut');
  assert.equal(ctx.speedOfJump2d(3, 0), 0, 'aucune gravité : la formule n a pas de sens');
});

test('LE COYOTE TIME et la MEMORISATION du saut', () => {
  const ctx = contexte();
  // Deux tolérances qu'on ne devine pas en jouant — on sent seulement que « ça ne répond pas ».
  const COYOTE = 0.1, MEM = 0.15;
  // Au ground : évidemment permis.
  assert.equal(ctx.jumpAllowed2d(true, 0, 0, COYOTE, MEM), true);
  // Vient de quitter le sol depuis 0,05 s : encore permis. C'est le bord de plateforme.
  assert.equal(ctx.jumpAllowed2d(false, 0.05, 0, COYOTE, MEM), true);
  // Depuis 0,3 s : trop tard, sinon on saute en plein vol.
  assert.equal(ctx.jumpAllowed2d(false, 0.3, 0, COYOTE, MEM), false);
  // Saut demandé il y a 0,1 s et on vient d atterrir : joué. Sans ça, la demande serait perdue.
  assert.equal(ctx.jumpAllowed2d(true, 0, 0.1, COYOTE, MEM), true);
  // Demandé il y a 0,5 s : trop vieux, sinon le personnage saute tout seul longtemps après.
  assert.equal(ctx.jumpAllowed2d(true, 0, 0.5, COYOTE, MEM), false);
  // Aucune demande en cours.
  assert.equal(ctx.jumpAllowed2d(true, 0, NaN, COYOTE, MEM), false);
});

test('le chevauchement ne compte pas un simple CONTACT comme une penetration', () => {
  const ctx = contexte();
  // Deux boîtes qui se touchent exactement edge à edge : sans ce seuil, elles se repousseraient
  // en boucle et un body posé sur le sol vibrerait.
  assert.equal(ctx.overlap2d(body(0, 0, 1, 1), block(2, 0, 1, 1)), null);
  const c = ctx.overlap2d(body(0, 0, 1, 1), block(1.5, 0, 1, 1));
  assert.ok(c && Math.abs(c.x - 0.5) < 1e-9);
  assert.equal(ctx.overlap2d(null, block(0, 0, 1, 1)), null);
});
