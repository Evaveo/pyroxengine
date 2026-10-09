import { deEsm } from './engine-env.mjs';
// Animation de sprite — le calcul, sans three et sans DOM.
//
// Le test qui porte le fichier est celui du PASSAGE DE BOUCLE : un événement posé près de la end
// d'une sequence qui loop doit partir une fois par tour, ni zéro ni deux. C'est le défaut qu'on ne
// voit pas en regardant tourner l'animation — le son de pas manque un tour sur trois, et on
// cherche du côté du son.
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
  vm.runInContext(deEsm(read('js/anim-sprite.js')), ctx, {filename: 'js/anim-sprite.js'});
  return ctx;
}

const DT = 1 / 60;
// Un tableau rendu par le bac à sable porte le prototype du bac, pas celui de l'hôte, et
// `deepEqual` échoue en affichant deux structures IDENTIQUES. On le ramène côté hôte avant toute
// comparaison — c'est cinq minutes perdues à chaque fois qu'on l'oublie.
const hote = (x) => [...x];
const images = (prefixe, n) => Array.from({length: n}, (_, i) => prefixe + '_' + i);
const sequence = (o) => Object.assign({name: 'course', images: images('course', 8), ips: 12,
                                    loop: true, events: []}, o || {});

/** Joue `secondes` et rend la liste des images affichées, image d'écran par image d'écran. */
function play(ctx, state, s, secondes){
  const vues = [], evs = [];
  const n = Math.round(secondes / DT);
  for(let i = 0; i < n; i++){
    const r = ctx.advanceAnimSprite(state, s, DT);
    vues.push(r.indice);
    r.events.forEach((e) => evs.push(e));
  }
  return {vues, evs};
}

test('la duree d une sequence est n / ips, la DERNIERE image comprise', () => {
  const ctx = contexte();
  // `(n-1)/ips` est l'erreur naturelle — on count les intervalles au lieu des images. Une sequence
  // de 8 images à 12 im/s durerait 0,583 s au lieu de 0,667 : la dernière image n'apparaîtrait
  // que le temps d'un arrondi, et l'animation aurait l'air de sauter à la boucle.
  assert.equal(ctx.durationSequence(sequence()), 8 / 12);
  assert.equal(ctx.durationSequence({images: ['a'], ips: 1}), 1);
  assert.equal(ctx.durationSequence({images: [], ips: 12}), 0, 'une sequence vide ne dure pas');
  assert.equal(ctx.durationSequence({images: ['a'], ips: 0}), 0, 'a 0 im/s elle ne dure pas non plus');
});

test('8 IMAGES A 12 IM/S tiennent exactement 8/12 s, chacune pour sa part', () => {
  const ctx = contexte();
  const s = sequence();
  const e = ctx.startAnimSprite({}, 'course');
  // Une seconde entière : 12 images jouées, donc 1,5 tour d'une sequence de 8.
  const {vues} = play(ctx, e, s, 1);
  // Chaque image doit occuper 1/12 s, soit 5 images d'écran à 60 Hz. On count les occurrences
  // du premier tour complet plutôt que de comparer une liste : c'est la DURÉE qui est en cause.
  const premierTour = vues.slice(0, Math.round((8 / 12) / DT));
  const comptes = {};
  premierTour.forEach((i) => { comptes[i] = (comptes[i] || 0) + 1; });
  for(let i = 0; i < 8; i++){
    assert.ok(Math.abs(comptes[i] - 5) <= 1,
      'l image ' + i + ' est restée ' + comptes[i] + ' images d écran, 5 attendues');
  }
  assert.equal(Object.keys(comptes).length, 8, 'les 8 images doivent toutes avoir été vues');
});

test('LA PREMIERE IMAGE RENDUE APRES UN DEMARRAGE est l image 0, pas la 1', () => {
  const ctx = contexte();
  // Le passage course → repos : si le premier avancement rendait déjà l'image 1, chaque
  // changement d'état sauterait une image. À 6 im/s sur une sequence de 4, ça se voit.
  const s = sequence({name: 'repos', images: images('repos', 4), ips: 6});
  const e = ctx.startAnimSprite({}, 'repos');
  const r = ctx.advanceAnimSprite(e, s, DT);
  assert.equal(r.indice, 0);
  assert.equal(r.image, 'repos_0');
});

test('UN EVENEMENT PART UNE FOIS PAR TOUR — le test qui porte le fichier', () => {
  const ctx = contexte();
  // Deux événements, dont un sur l'image 0 : c'est celui qui ne partirait jamais sans la nuance
  // « l'image 0 n'a pas encore été jouée » au démarrage, et celui qui partirait deux fois si le
  // passage de boucle était compté avec des indices ramenés au lieu d'images absolues.
  const s = sequence({events: [{image: 0, name: 'pas_gauche'}, {image: 4, name: 'pas_droit'}]});
  const e = ctx.startAnimSprite({}, 'course');
  const tours = 5;
  // MOINS une image d'écran : play EXACTEMENT cinq tours entre dans l'image 0 du sixième, et
  // l'événement de cette image part — à raison. Compter six déclenchements pour cinq tours
  // ferait chercher un défaut de boucle là où il n'y en a pas.
  const {evs} = play(ctx, e, s, tours * (8 / 12) - DT);
  const gauches = evs.filter((x) => x === 'pas_gauche').length;
  const droits = evs.filter((x) => x === 'pas_droit').length;
  assert.equal(gauches, tours, 'pas_gauche (image 0) est parti ' + gauches + ' fois en ' + tours + ' tours');
  assert.equal(droits, tours, 'pas_droit (image 4) est parti ' + droits + ' fois en ' + tours + ' tours');
  // Et dans le bon ORDRE : gauche puis droit, alternés.
  const attendu = [];
  for(let i = 0; i < tours; i++) attendu.push('pas_gauche', 'pas_droit');
  assert.deepEqual(evs, attendu);
});

test('LE PASSAGE DE BOUCLE franchit les images intermediaires, dans l ordre', () => {
  const ctx = contexte();
  // Un seul pas assez grand pour sauter par-dessus la end de la sequence : de l'image 6 à l'image 1
  // du tour suivant. Les images 7, 0 et 1 doivent être franchies, une fois chacune, dans cet
  // ordre. Comparer des indices ramenés donnerait « de 6 à 1 », soit rien du tout.
  const s = sequence({events: [{image: 6, name: 'six'}, {image: 7, name: 'sept'},
                                {image: 0, name: 'zero'}, {image: 1, name: 'un'}]});
  const e = ctx.startAnimSprite({}, 'course');
  ctx.advanceAnimSprite(e, s, 6 / 12 + 1e-9);        // on se pose sur l'image 6
  const r = ctx.advanceAnimSprite(e, s, 3 / 12);     // et on saute jusqu'à l'image 9 = 1
  assert.equal(r.indice, 1);
  assert.deepEqual(hote(r.events), ['sept', 'zero', 'un'],
    'les images franchies doivent l être dans l ordre, sans « six » qui était déjà jouée');
});

test('UN GEL DU NAVIGATEUR ne fait pas partir un evenement cent fois', () => {
  const ctx = contexte();
  // Un tab en arrière-plan rend un `dt` de plusieurs secondes. Sans clamped, un événement de
  // pas partirait autant de fois qu'il y a eu de tours — et la fichier de sons exploserait au
  // retour au premier plan.
  const s = sequence({events: [{image: 3, name: 'pas'}]});
  const e = ctx.startAnimSprite({}, 'course');
  const r = ctx.advanceAnimSprite(e, s, 30);         // 30 s = 45 tours
  assert.equal(r.events.length, 1, 'un seul cycle rejoué, pas 45 : ' + r.events.length);
});

test('SANS BOUCLE la sequence se fige sur la DERNIERE image et se declare finished', () => {
  const ctx = contexte();
  const s = sequence({name: 'noyade', images: images('noyade', 6), ips: 10, loop: false});
  const e = ctx.startAnimSprite({}, 'noyade');
  let r = ctx.advanceAnimSprite(e, s, 0.5);          // 5 images sur 6
  assert.equal(r.indice, 5);
  assert.equal(r.finished, false, 'a 0,5 s sur 0,6 s elle n est pas finished');
  r = ctx.advanceAnimSprite(e, s, 0.5);
  assert.equal(r.indice, 5, 'elle doit rester sur la dernière image, pas revenir a 0');
  assert.equal(r.finished, true);
  // Et elle le reste : une sequence finished ne redémarre pas toute seule.
  r = ctx.advanceAnimSprite(e, s, 10);
  assert.equal(r.indice, 5);
  assert.equal(r.finished, true);
});

test('SANS BOUCLE un evenement sur la DERNIERE image part quand meme', () => {
  const ctx = contexte();
  // Le cas qu'on n'imagine pas : la clamped « ne jamais dépasser la dernière image » pourrait
  // écarter l'image finale du calcul des franchissements, et un « réapparaître » posé dessus ne
  // partirait jamais. La mort serait sans end, et on chercherait du côté du script.
  const s = sequence({name: 'noyade', images: images('noyade', 6), ips: 10, loop: false,
                   events: [{image: 5, name: 'respawn'}]});
  const e = ctx.startAnimSprite({}, 'noyade');
  const {evs} = play(ctx, e, s, 1.5);
  assert.deepEqual(evs, ['respawn'], 'une fois, et une seule');
});

test('une sequence VIDE ou a 0 im/s ne change pas l image affichee', () => {
  const ctx = contexte();
  // Rendre `null` plutôt qu'une image par défaut : un réglage incomplet doit figer le
  // personnage, pas le faire disparaître. Une planche manquante se corrige ; un sprite invisible
  // s'attribue au rendu, à la caméra, au calque…
  const e = ctx.startAnimSprite({}, 'x');
  const empty = ctx.advanceAnimSprite(e, {images: [], ips: 12}, DT);
  assert.equal(empty.image, null);
  assert.equal(empty.finished, true);
  const figee = ctx.advanceAnimSprite(e, {images: ['a', 'b'], ips: 0}, DT);
  assert.equal(figee.image, null);
});

test('la vitesse de lecture ne depend PAS de la cadence d appel', () => {
  const ctx = contexte();
  // La même seconde jouée en 60 pas ou en 6 doit rendre la même image. Un counter d'images au
  // lieu d'un temps donnerait une animation deux fois plus lente sur une machine deux fois plus
  // lente — et le jeu ne serait pas le même selon l écran.
  const s = sequence();
  // On fixe la DURÉE et on fait varier le number de pas : toutes les cadences arrivent donc
  // exactement au même instant. Et on mesure à 0,52 s — soit 6,24 images — plutôt qu'à une
  // frontière d'image : à 0,5 s pile, l'accumulation en virgule flottante fait tomber une
  // cadence à 5,9999… et l'autre à 6,0000…, et le test punirait un ulp au lieu d'une dérive.
  const end = (nPas) => {
    const e = ctx.startAnimSprite({}, 'course');
    let r = null;
    for(let i = 0; i < nPas; i++) r = ctx.advanceAnimSprite(e, s, 0.52 / nPas);
    return r.indice;
  };
  assert.equal(end(31), 6, 'reference : 0,52 s a 12 im/s tombe dans l image 6');
  assert.equal(end(3), 6, '3 pas doivent finir sur la même image que 31');
  assert.equal(end(300), 6, '300 pas aussi');
});

test('LA PROGRESSION donne leur raison d etre aux deux bounds posees sur le temps', () => {
  const ctx = contexte();
  // Deux mutations survivaient avant ce test : supprimer le figeage du temps sans loop, et
  // supprimer son retour dans le cycle avec. Elles ne changeaient rien — l'indice d'image est de
  // toute façon ramené plus loin. C'étaient deux bounds MORTES. Elles cessent de l'être dès que
  // `e.t` veut dire quelque chose.
  const s = sequence({name: 'reception', images: images('rec', 3), ips: 10, loop: false});
  const e = ctx.startAnimSprite({}, 'reception');
  ctx.advanceAnimSprite(e, s, 0.15);                 // la moitié de 0,3 s
  assert.ok(Math.abs(ctx.progressAnimSprite(e, s) - 0.5) < 1e-9,
    'à mi-course la progress vaut 0,5, pas ' + ctx.progressAnimSprite(e, s));
  ctx.advanceAnimSprite(e, s, 10);                   // très au-delà de la end
  assert.equal(ctx.progressAnimSprite(e, s), 1, 'une sequence finished est à 1, pas à 33');

  // Avec loop, la progress repart : c'est la position DANS LE CYCLE. Et c'est ce qui rend
  // sûr de basculer « loop » pendant que la sequence joue — geste current dans l'inspecteur.
  const b = sequence({ips: 12});
  const eb = ctx.startAnimSprite({}, 'course');
  ctx.advanceAnimSprite(eb, b, 3 * (8 / 12) + (8 / 12) / 4);   // trois tours et un quart
  assert.ok(Math.abs(ctx.progressAnimSprite(eb, b) - 0.25) < 1e-9,
    'après trois tours et un quart, on est au quart du cycle, pas à 3,25');
  assert.equal(ctx.progressAnimSprite({t: 0.1}, {images: [], ips: 12}), 0,
    'une sequence sans durée ne progresse pas — et ne divise pas par zéro');
});

test('sameGeometrySprite distingue ce qui se recalcule de ce qui se reconstruit', () => {
  const ctx = contexte();
  // Toutes les images d'une planche ont la même cell : seules les coordonnées de texture
  // changent. Reconstruire la maille à chaque image allouerait géométrie et matériau douze fois
  // par seconde et par personnage.
  assert.equal(ctx.sameGeometrySprite({x: 0, y: 0, l: 24, h: 24}, {x: 24, y: 0, l: 24, h: 24}), true,
    'deux cellules de même taille à des endroits différents : même géométrie');
  assert.equal(ctx.sameGeometrySprite({l: 24, h: 24}, {l: 32, h: 24}), false);
  assert.equal(ctx.sameGeometrySprite({l: 24, h: 24}, {l: 24, h: 32}), false);
  assert.equal(ctx.sameGeometrySprite(null, {l: 24, h: 24}), false, 'sans région on reconstruit');
});

test('validateSequences NOMME ce qui joue autre chose que prevu', () => {
  const ctx = contexte();
  const regions = [{name: 'course_0'}, {name: 'course_1'}];
  const p = ctx.validateSequences([
    {name: 'course', images: ['course_0', 'course_9'], ips: 12},
    {name: 'course', images: ['course_1'], ips: 12},
    {name: 'repos', images: ['course_0'], ips: 0, events: [{image: 4, name: 'x'}, {image: 0}]},
    {images: ['course_0'], ips: 6}
  ], regions);
  const contient = (motif) => p.some((m) => m.includes(motif));
  assert.ok(contient('course_9'), 'une image qui ne désigne aucune région doit être nommée');
  assert.ok(contient('Deux suites'), 'deux suites homonymes : la seconde est injouable');
  assert.ok(contient('image par seconde'), '0 im/s doit être signalé');
  assert.ok(contient('hors des 1 images'), 'un événement hors bounds ne partira jamais');
  assert.ok(contient('n\'a pas de nom'), 'un événement sans nom, et une sequence sans nom');
  assert.deepEqual(hote(ctx.validateSequences([{name: 'ok', images: ['course_0'], ips: 12}], regions)), [],
    'une sequence correcte ne doit RIEN signaler — sinon le panneau crie tout le temps');
});

// ---------- l'orchestration : ce que l'éditeur et le jeu partagent ----------
//
// `stepAnimSprites` porte les trois règles qu'on ne remarque QUE si elles diffèrent entre les
// deux côtés : démarrage automatique, retour au défaut, image nulle qui ne change rien. Elle
// prend son résolveur d'asset et sa pose d'image en argument — c'est ce qui permet de l'éprouver
// ici sans moteur de rendu, et de n'en avoir qu'un exemplaire.

function scene(ctx, animSprite, sequences){
  const node = {userData: {animSprite: animSprite, sprite2d: {spriteId: 's1'}}};
  const asset = {id: 's1', kind: 'sprite', sequences: sequences};
  const posees = [], emis = [];
  const step = (dt) => ctx.stepAnimSprites([node], dt, () => asset,
    (o, img) => posees.push(img), (n) => emis.push(n));
  return {node, asset, posees, emis, step};
}

test('ORCHESTRATION : la sequence par defaut demarre toute seule', () => {
  const ctx = contexte();
  const s = scene(ctx, {defaultValue: 'repos', speed: 1, auto: true},
                  [sequence({name: 'repos', images: images('repos', 4), ips: 6})]);
  s.step(DT);
  assert.equal(s.node.userData._animSprite.sequence, 'repos');
  assert.equal(s.posees[0], 'repos_0', 'et la première image posée est la 0');
});

test('ORCHESTRATION : « play au demarrage » decoche laisse le personnage FIGE', () => {
  const ctx = contexte();
  // Une pose fixe est un réglage légitime — un décor, un objet ramassable. Démarrer quand même
  // rendrait la case inopérante, et on ne saurait pas dire ce qu'elle fait.
  const s = scene(ctx, {defaultValue: 'repos', speed: 1, auto: false},
                  [sequence({name: 'repos', images: images('repos', 4), ips: 6})]);
  s.step(DT); s.step(DT);
  assert.deepEqual(hote(s.posees), [], 'aucune image ne devait être posée');
});

test('ORCHESTRATION : une sequence SANS BOUCLE finished revient au defaut', () => {
  const ctx = contexte();
  // C'est ce qu'on attend d'une réception ou d'un atterrissage. L'écrire dans chaque script
  // serait la même ligne partout — et celui qui l'oublie laisse son personnage accroupi.
  const sequences = [sequence({name: 'repos', images: images('repos', 2), ips: 6}),
                  sequence({name: 'reception', images: images('rec', 3), ips: 10, loop: false})];
  const s = scene(ctx, {defaultValue: 'repos', speed: 1, auto: true}, sequences);
  s.step(DT);
  ctx.playAnimSprite(s.node, 'reception');
  for(let i = 0; i < 30; i++) s.step(DT);          // 0,5 s : la réception dure 0,3 s
  assert.equal(s.node.userData._animSprite.sequence, 'repos',
    'après la réception on doit être revenu au repos, pas resté sur « ' + s.node.userData._animSprite.sequence + ' »');
  assert.ok(s.posees.includes('rec_2'), 'la dernière image de la réception doit avoir été view');
  assert.ok(s.posees[s.posees.length - 1].startsWith('repos_'), 'et on finit sur le repos');
});

test('ORCHESTRATION : REJOUER LA SUITE EN COURS ne la redemarre pas', () => {
  const ctx = contexte();
  // Le défaut qu'on écrit sans y penser : `if(court) playAnimSprite(p, 'course')` à chaque
  // image. Sans la garde, le personnage reste figé sur sa première image et on cherche du côté
  // de la planche.
  const s = scene(ctx, {defaultValue: 'course', speed: 1, auto: true},
                  [sequence({name: 'course', images: images('course', 8), ips: 12})]);
  for(let i = 0; i < 20; i++){ ctx.playAnimSprite(s.node, 'course'); s.step(DT); }
  const vues = new Set(s.posees);
  assert.ok(vues.size > 1, 'le personnage est figé sur ' + s.posees[0] + ' : ' + vues.size + ' image(s) view(s)');
  // Et avec `forcer`, on redémarre bel et bien — sinon la garde empêcherait de replay un coup.
  ctx.playAnimSprite(s.node, 'course', true);
  assert.equal(s.node.userData._animSprite.t, 0);
});

test('ORCHESTRATION : la VITESSE multiplie le temps, pas la cadence', () => {
  const ctx = contexte();
  const sequences = [sequence({name: 'course', images: images('course', 8), ips: 12})];
  const lent = scene(ctx, {defaultValue: 'course', speed: 0.5, auto: true}, sequences);
  const vif = scene(ctx, {defaultValue: 'course', speed: 2, auto: true}, sequences);
  for(let i = 0; i < 30; i++){ lent.step(DT); vif.step(DT); }
  const iLent = lent.node.userData._animSprite;
  const iVif = vif.node.userData._animSprite;
  assert.ok(iVif.t > iLent.t || vif.posees.length >= lent.posees.length,
    'à speed 2 on doit avoir avancé plus qu à 0,5');
  const last = (l) => l[l.length - 1];
  assert.notEqual(last(lent.posees), last(vif.posees),
    'les deux ne doivent pas être sur la même image après une demi-seconde');
});

test('ORCHESTRATION : un noeud SANS asset ou SANS sequence connue ne fait rien, sans crier', () => {
  const ctx = contexte();
  // Une planche supprimée du project ne doit pas casser la boucle de jeu : le personnage se fige
  // sur sa dernière image, ce qui se voit et se corrige, plutôt qu une exception par image.
  const node = {userData: {animSprite: {defaultValue: 'repos'}, sprite2d: {spriteId: 'parti'}}};
  const n1 = ctx.stepAnimSprites([node], DT, () => null, () => { throw new Error('pas ici'); }, null);
  assert.equal(n1, 0);
  const asset = {id: 's1', kind: 'sprite', sequences: [sequence({name: 'autre'})]};
  const n2 = ctx.stepAnimSprites([node], DT, () => asset, () => { throw new Error('pas ici'); }, null);
  assert.equal(n2, 0, 'une sequence par défaut qui n existe pas dans la planche ne joue rien');
  // Et un nœud sans animateur du tout est simplement ignoré.
  assert.equal(ctx.stepAnimSprites([{userData: {}}], DT, () => asset, () => {}, null), 0);
});

test('ORCHESTRATION : les evenements remontent a l appelant', () => {
  const ctx = contexte();
  const s = scene(ctx, {defaultValue: 'course', speed: 1, auto: true},
                  [sequence({name: 'course', images: images('course', 8), ips: 12,
                          events: [{image: 4, name: 'pas'}]})]);
  for(let i = 0; i < Math.round((8 / 12) / DT) - 1; i++) s.step(DT);
  assert.deepEqual(hote(s.emis), ['pas'], 'un tour, un pas');
});

test('sequenceByName rend null plutot qu une sequence au hasard', () => {
  const ctx = contexte();
  const l = [{name: 'a', images: ['x'], ips: 1}, {name: 'b', images: ['y'], ips: 1}];
  assert.equal(ctx.sequenceByName(l, 'b').images[0], 'y');
  assert.equal(ctx.sequenceByName(l, 'c'), null, 'un nom inconnu ne doit pas jouer la première');
  assert.equal(ctx.sequenceByName(l, ''), null);
  assert.equal(ctx.sequenceByName(null, 'a'), null);
});
