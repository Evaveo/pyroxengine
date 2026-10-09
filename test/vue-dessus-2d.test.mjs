import { deEsm } from './engine-env.mjs';
// LA VUE DE DESSUS : ce qui change quand le Y cesse d'être une hauteur.
//
// Le moteur 2D était entièrement vu de côté. Passer à la vue de dessus n'est pas « enlever la
// gravité » : c'est changer le SENS de l'axe Y, et deux comportements du solveur deviennent alors
// faux au lieu d'être seulement inutiles.
//
// LE TEST QUI PORTE LE FICHIER est celui du franchissement de marche. Vu de côté, un obstacle dont
// le dessus dépass à peine les pieds est une marche : on monte dessus, et c'est ce qui permet aux
// pentes de rejoindre leur palier. Vu de dessus, il n'y a plus de dessus — tout mur situé un peu
// plus bas que le héros devient une marche qu'il gravit, donc qu'il TRAVERSE. Le personnage se
// promènerait à travers le décor en montant d'un cran à chaque contact, et le défaut se
// chercherait dans les collisions ou dans le décor, jamais dans une règle de plateforme.
//
// Le second est la DIAGONALE : sans normalisation on avance √2 fois plus vite en biais. Ça ne
// ressemble pas à un bug, ça se découvre en quelques minutes de jeu, et ça fausse le réglage de
// toutes les distances du jeu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
// RAPATRIEMENT DANS LE ROYAUME DE L'HÔTE. Un objet né dans un contexte vm porte le prototype de CE
// contexte, et `deepEqual` échoue en affichant deux structures identiques — « same structure but
// not reference-equal ». Quatrième fois que ce dépôt s'y fait prendre : c'est le premier réflexe à
// avoir devant ce message.
const hote = (x) => (x === null || x === undefined) ? x : JSON.parse(JSON.stringify(x));

function contexte(){
  const bac = {console, Math, JSON, Object, Array, Number, String, isFinite};
  bac.window = bac; bac.globalThis = bac;
  const ctx = vm.createContext(bac);
  vm.runInContext(deEsm(read('js/physics-2d.js')), ctx, {filename: 'js/physics-2d.js'});
  vm.runInContext(deEsm(read('js/world-2d.js')), ctx, {filename: 'js/world-2d.js'});
  vm.runInContext(deEsm(read('js/sprite-2d.js')), ctx, {filename: 'js/sprite-2d.js'});
  vm.runInContext('this.PHYS2D_GRAVITY_DEFAULT = PHYS2D_GRAVITY_DEFAULT;'
    + ' this.PHYS2D_STEPUP_MAX = PHYS2D_STEPUP_MAX;', ctx);
  return bac;
}
const C = contexte();

/** Un nœud de scène réduit à ce que le monde 2D en lit. */
function node(x, y, extra){
  return {position: {x: x, y: y, z: 0}, userData: Object.assign({}, extra)};
}
/** Un héros vu de dessus : body mobile, collider, contrôleur en mode « dessus ». */
function heros(x, y, ctrl){
  return node(x, y, {
    body2d: {statique: false, speedMax: 40},
    collider2d: {shape: 'box', l: 1, h: 1, dx: 0, dy: 0},
    controller2d: Object.assign({mode: 'topdown', speed: 6,
                                 actionLeft: 'left', actionRight: 'right',
                                 actionTop: 'haut', actionBottom: 'bottom'}, ctrl || {})
  });
}
/** Un mur : collider statique. */
function mur(x, y, l, h){
  return node(x, y, {collider2d: {shape: 'box', l: l || 1, h: h || 1, dx: 0, dy: 0}});
}
/** Les cles enfoncées, sous la shape que `stepWorld2d` attend. */
const keys = (...names) => (n) => names.indexOf(n) !== -1;


test('UN MUR ARRETE, il ne se laisse pas escalader — le test qui porte le fichier', () => {
  // LE MUR EST À CÔTÉ, PAS DESSOUS, et c'est tout le test. Le franchissement de marche est un
  // mécanisme du déplacement HORIZONTAL : on avance dans un obstacle, et s'il ne dépass les pieds
  // que de moins de `PHYS2D_STEPUP_MAX`, on monte dessus. Un mur poussé par le BAS ne passe jamais
  // par là — il arrête le héros par simple collision, avec ou sans la coupure. Mesuré : la version
  // qui retire `withoutMarche` laisse ce scénario-là parfaitement vert, et ce fichier a vécu une
  // journée avec une garde qui ne pouvait pas échouer pour la raison qu'elle annonçait.
  //
  // Vu de dessus, un mur « un peu plus bas » n'est pas plus bas : il est plus LOIN. Le gravir,
  // c'est le traverser.
  const stepUpMax = C.PHYS2D_STEPUP_MAX;
  // Deux dépassements DANS la fenêtre de franchissement — au-delà, le solveur bloque de toute
  // façon et le test redeviendrait vert sans rien mesurer.
  [stepUpMax * 0.4, stepUpMax * 0.8].forEach(function(depassement){
    const h = heros(0, 0);
    // Le haut du mur (y + 0,5) dépass les pieds du héros (−0,5) de `depassement`.
    const m = mur(2, -1 + depassement, 1, 1);
    const list = [h, m];
    for(let i = 0; i < 120; i++) C.stepWorld2d(list, 1 / 60, undefined, keys('right'));

    assert.ok(h.position.x < 1.001,
      `le héros a traversé le mur : x = ${h.position.x.toFixed(3)} (attendu ≤ 1) pour un `
      + `dépassement de ${depassement}. Le franchissement de marche n'est pas coupé, et tout mur `
      + 'du décor est escaladable');
    assert.ok(Math.abs(h.position.y) < 0.001,
      `le héros a MONTÉ de ${h.position.y.toFixed(3)} : vu de dessus, monter c'est traverser`);
  });

  // Le mur posé SOUS les pieds arrête aussi. C'est vrai, ça ne discrimine rien, et c'est écrit ici
  // pour qu'on ne le reprenne pas un jour comme garde du franchissement.
  const h2 = heros(0, 0);
  const m2 = mur(0, -1, 4, 1);
  for(let i = 0; i < 60; i++) C.stepWorld2d([h2, m2], 1 / 60, undefined, keys('bottom'));
  assert.ok(h2.position.y >= -0.001 && h2.position.y < 0.001,
    'un mur sous les pieds doit arrêter aussi, sans faire reculer');
});

test('LES QUATRE DIRECTIONS repondent, et la gravite ne s applique pas', () => {
  const dt = 1 / 60;
  const essai = (t) => {
    const h = heros(0, 0);
    for(let i = 0; i < 30; i++) C.stepWorld2d([h], dt, undefined, t);
    return {x: +h.position.x.toFixed(3), y: +h.position.y.toFixed(3)};
  };
  const d = essai(keys('right')), g = essai(keys('left'));
  const ht = essai(keys('haut')), b = essai(keys('bottom'));
  assert.ok(d.x > 2.5 && d.y === 0, 'droite : ' + JSON.stringify(d));
  assert.ok(g.x < -2.5 && g.y === 0, 'gauche : ' + JSON.stringify(g));
  assert.ok(ht.y > 2.5 && ht.x === 0, 'haut : ' + JSON.stringify(ht));
  assert.ok(b.y < -2.5 && b.x === 0, 'bottom : ' + JSON.stringify(b));

  // SANS TOUCHE, IL NE BOUGE PAS. C'est ce qui prouve que la gravité ne s'applique plus : en
  // mode plateforme, trente images de chute font tomber de plus d'un mètre.
  const immobile = essai(() => false);
  assert.deepEqual(hote(immobile), {x: 0, y: 0},
    'le héros dérive sans qu\'on touche à rien — la gravité s\'applique encore');
});

test('LA DIAGONALE ne va pas plus vite que la ligne droite', () => {
  const dt = 1 / 60, n = 30;
  const parcours = (t) => {
    const h = heros(0, 0);
    for(let i = 0; i < n; i++) C.stepWorld2d([h], dt, undefined, t);
    return Math.hypot(h.position.x, h.position.y);
  };
  const droit = parcours(keys('right'));
  const biais = parcours(keys('right', 'haut'));
  assert.ok(droit > 2.5, 'le déplacement droit ne marche pas : ' + droit);
  // Tolérance d'un pour mille : c'est du calcul flottant, pas une mesure physique.
  assert.ok(Math.abs(biais - droit) / droit < 0.001,
    `en diagonale on parcourt ${biais.toFixed(3)} contre ${droit.toFixed(3)} en line droite `
    + `(${((biais / droit - 1) * 100).toFixed(0)} % de plus) : les diagonales ne sont pas `
    + 'normalisées, et tout le jeu se parcourra en zigzag');
});

test('LE MODE PLATEFORME n est pas key : il tombe et il saute toujours', () => {
  // La garde qui protège l'existant. Le mode par défaut doit rester 'platform' : le changer
  // ferait décoller tous les personnages des projets déjà faits.
  const n = {position: {x: 0, y: 0, z: 0}, userData: {}};
  const ctrl = C.ensureController2d(n);
  assert.equal(ctrl.mode, 'platform', 'le défaut n\'est plus la vue de côté');
  assert.equal(C.isControllerTop2d(ctrl), false);

  const h = node(0, 5, {
    body2d: {statique: false}, collider2d: {shape: 'box', l: 1, h: 1, dx: 0, dy: 0},
    controller2d: C.ensureController2d({position: {x: 0, y: 0, z: 0}, userData: {}})
  });
  for(let i = 0; i < 30; i++) C.stepWorld2d([h], 1 / 60, undefined, () => false);
  assert.ok(h.position.y < 4, 'un personnage en mode plateforme ne tombe plus : y = ' + h.position.y);
});

test('UN CONTROLEUR SANS MODE — project anterieur — reste en plateforme', () => {
  // Les projets d'avant ce lot n'ont pas de champ `mode`. Le lire comme « dessus » les ferait
  // tous décoller à l'ouverture, et la cause serait invisible.
  const h = node(0, 5, {
    body2d: {statique: false}, collider2d: {shape: 'box', l: 1, h: 1, dx: 0, dy: 0},
    controller2d: {speed: 6, heightJump: 3, actionLeft: 'left', actionRight: 'right'}
  });
  assert.equal(C.isControllerTop2d(h.userData.controller2d), false);
  for(let i = 0; i < 30; i++) C.stepWorld2d([h], 1 / 60, undefined, () => false);
  assert.ok(h.position.y < 4, 'un contrôleur sans mode ne tombe plus : il a été pris pour du dessus');
});

test('LA DIRECTION REGARDEE est memorisee, et ne retombe pas au relachement', () => {
  // Elle sert à l'animation et au sens du coup. La recalculer dans chaque jeu donnerait autant
  // de conventions que de jeux ; la remettre à zéro au relâchement ferait regarder le héros
  // droit devant chaque fois qu'il s'arrête.
  const h = heros(0, 0);
  for(let i = 0; i < 10; i++) C.stepWorld2d([h], 1 / 60, undefined, keys('haut'));
  const e = h.userData._ctrl2d;
  assert.ok(e && e.regardY > 0 && e.regardX === 0, 'regard après « haut » : ' + JSON.stringify(e));

  for(let i = 0; i < 10; i++) C.stepWorld2d([h], 1 / 60, undefined, () => false);
  assert.ok(h.userData._ctrl2d.regardY > 0,
    'le regard est retombé quand les cles ont été relâchées');
});

test('box2dOf prend le collider, sinon l etendue — et rend null quand il n y a rien', () => {
  // C'est ce repli qui permet à un déclencheur — porte, ramassage — d'être détecté SANS porter
  // de Collider2D, donc sans devenir un obstacle. Sans lui il faudrait choisir entre
  // « détectable » et « traversable ».
  const avecCollider = node(3, 4, {collider2d: {l: 2, h: 1, dx: 0.5, dy: -0.5}});
  assert.deepEqual(hote(C.box2dOf(avecCollider, null)), {x: 3.5, y: 3.5, dl: 1, dh: 0.5});

  const sansCollider = node(0, 0, {});
  const extent = {min: {x: -1, y: -2}, max: {x: 1, y: 2}};
  assert.deepEqual(hote(C.box2dOf(sansCollider, extent)), {x: 0, y: 0, dl: 1, dh: 2});

  // Le collider PRIME sur l'étendue : un sprite dessiné plus large que sa boîte de collision est
  // le cas normal, et c'est la boîte qui fait foi.
  assert.equal(C.box2dOf(avecCollider, extent).dl, 1);

  assert.equal(C.box2dOf(sansCollider, null), null, 'sans rien, on doit rendre null');
  assert.equal(C.box2dOf(sansCollider, {min: {x: 0, y: 0}, max: {x: 0, y: 0}}), null,
    'une étendue empty doit rendre null : une boîte de taille nulle ne chevaucherait jamais rien, '
    + 'et « jamais » se déduit mal de « je ne sais pas »');
});

test('LES DEUX MOTEURS exposent api.overlaps2d, et par la MEME logique', () => {
  const manques = [];
  for(const f of ['js/scripts.js', 'js/game-runtime.js']){
    const s = read(f).replace(/\r\n/g, '\n');
    if(!/overlaps2d\s*:\s*function/.test(s)) manques.push(f + ' n\'expose pas api.overlaps2d');
    // La logique doit venir des modules PARTAGÉS : une comparaison de boîtes réécrite à la main
    // d'un côté finirait par ne plus détecter les mêmes contacts que de l'autre, et l'écart ne se
    // verrait qu'après export.
    if(!/box2dOf\(/.test(s)) manques.push(f + ' ne passe pas par box2dOf');
    if(!/overlap2d\(A, B\)/.test(s)) manques.push(f + ' ne passe pas par overlap2d');
  }
  assert.deepEqual(manques, [], manques.join('\n'));
});

// ---------- Le tri par profondeur ----------
//
// Sans lui, l'ordre d'affichage est figé à la construction : le héros est éternellement devant
// ou éternellement derrière un arbre. Un jeu vu de dessus ne peut pas exister comme ça.

/** Un sprite trié par profondeur, avec sa maille factice. */
function spriteTri(id, y, opts){
  const o = {id: id, position: {x: 0, y: y, z: 0},
             userData: {sprite2d: Object.assign({layer: 'Jeu', order: 0, sortDepth: true},
                                                (opts && opts.sprite) || {})}};
  o.userData._meshSprite = {renderOrder: 0, userData: {_bottomLocal: (opts && opts.bottomLocal) || 0}};
  if(opts && opts.collider) o.userData.collider2d = opts.collider;
  return o;
}
const CALQUES = ['Fond', 'Decor', 'Jeu', 'Devant'];

test('CE QUI EST PLUS BAS PASSE DEVANT — le test qui porte le tri', () => {
  const top = spriteTri(1, 5), bottom = spriteTri(2, -5);
  C.updateSortDepth2d([top, bottom], CALQUES);
  assert.ok(bottom.userData._meshSprite.renderOrder > top.userData._meshSprite.renderOrder,
    'le sprite le plus BAS doit être rendu par-dessus : c\'est toute la convention de la vue de '
    + 'dessus, et sans elle le héros ne peut pas contourner un arbre');
});

test('LE TRI SUIT LE MOUVEMENT, il n est pas fige a la construction', () => {
  const heros = spriteTri(1, 5), tree = spriteTri(2, 0);
  C.updateSortDepth2d([heros, tree], CALQUES);
  const derriere = heros.userData._meshSprite.renderOrder < tree.userData._meshSprite.renderOrder;
  heros.position.y = -5;                       // le héros descend sous l'arbre
  C.updateSortDepth2d([heros, tree], CALQUES);
  const front = heros.userData._meshSprite.renderOrder > tree.userData._meshSprite.renderOrder;
  assert.ok(derriere && front,
    'le héros doit passer DERRIÈRE l\'arbre quand il est au-dessus, et DEVANT quand il descend');
});

test('ON TRIE SUR LES PIEDS, pas sur le centre', () => {
  // Deux personnages de tailles différentes, centrés à la même hauteur. Le grand a les pieds
  // PLUS BAS : c'est lui qui doit passer devant. Trié au centre, ils seraient à égalité.
  const grand = spriteTri(1, 0, {bottomLocal: -2});
  const petit = spriteTri(2, 0, {bottomLocal: -0.5});
  C.updateSortDepth2d([grand, petit], CALQUES);
  assert.ok(grand.userData._meshSprite.renderOrder > petit.userData._meshSprite.renderOrder,
    'le personnage dont les pieds sont plus bas doit passer devant');

  // Et le COLLIDER prime sur le dessin : c'est lui qui dit où l'on pose les pieds, un sprite
  // portant souvent du vide au-dessus de la tête.
  const avecCollider = spriteTri(3, 0, {bottomLocal: -2, collider: {l: 1, h: 1, dy: 0}});
  C.updateSortDepth2d([avecCollider], CALQUES);
  const attendu = C.orderOfSort(CALQUES, 'Jeu', C.orderDepth2d(-0.5), 3);
  assert.equal(avecCollider.userData._meshSprite.renderOrder, attendu,
    'le collider doit décider du bas, pas la taille dessinée');
});

test('UN SPRITE NON COCHE n est pas touche', () => {
  // Sans ça, cocher la case sur un personnage réordonnerait tout le décor de fond du project.
  const fond = spriteTri(1, -50, {sprite: {sortDepth: false, order: 7}});
  fond.userData._meshSprite.renderOrder = 1234;
  const n = C.updateSortDepth2d([fond], CALQUES);
  assert.equal(fond.userData._meshSprite.renderOrder, 1234, 'un sprite non coché a été réordonné');
  assert.equal(n, 0, 'il ne doit pas être compté comme trié');
});

test('L ORDRE SATURE au lieu de deborder sur le calque voisin', () => {
  // Deux objets à soixante unités l'un de l'autre ne se recouvrent pas : les voir garder le même
  // rang est sans conséquence. Un débordement, lui, les ferait passer devant tout le calque
  // suivant — sans erreur, et sans que rien ne le laisse deviner.
  const tresBas = spriteTri(1, -10000), basNormal = spriteTri(2, -80);
  C.updateSortDepth2d([tresBas, basNormal], CALQUES);
  const rangJeu = CALQUES.indexOf('Jeu') * 1000;
  assert.ok(tresBas.userData._meshSprite.renderOrder < rangJeu + 500,
    'l\'ordre a déedgeé sur le calque suivant');
  assert.ok(tresBas.userData._meshSprite.renderOrder >= rangJeu + 499,
    'il doit saturer à la clamped, pas retomber à zéro');
});

test('LES DEUX MOTEURS appellent le MEME tri, a chaque image', () => {
  // Le tri est un SYSTÈME (v0.159.2) : écrit une fois, lancé par `System.runFrame` dans les deux
  // boucles. Avant, chaque boucle l'appelait à la main — et le runtime avait sa propre maille.
  const manques = [];
  if(!/updateSortDepth2d\(/.test(read('js/systems/sprite-system.js'))) manques.push('le SpriteSystem ne trie jamais par profondeur');
  for(const f of ['js/viewport.js', 'js/game-runtime.js']){
    if(!/System\.runFrame\(/.test(read(f))) manques.push(f + ' ne lance pas les Systemes');
  }
  // Et la maille — la seule, partagée — doit porter le bottom local : sans lui, on trierait les
  // sprites sur leur centre et non sur leurs pieds.
  if(!/_bottomLocal = bottomLocalSprite\(/.test(read('js/components/component-sprite.js'))) manques.push('component-sprite.js ne pose pas _bottomLocal');
  assert.deepEqual(manques, [], manques.join('\n'));
});

// ---------------------------------------------------------------------------------------------
// LES CHEMINS D'ACCÈS. Quatre manques trouvés en montant un essai jouable, tous de la même
// famille : la capacité existait dans le moteur, et rien ne permettait de l'atteindre.
// ---------------------------------------------------------------------------------------------

/** Les tables d'entrées des DEUX moteurs, extraites de leur source. */
function actionsConnues(){
  const names = new Set();
  ['js/scripts.js', 'js/game-runtime.js'].forEach(function(f){
    const src = read(f);
    // `actions:{advance:[...], reculer:[...]}` — on ne retient que le bloc `actions`.
    const i = src.indexOf('actions:');
    if(i < 0) return;
    const block = src.slice(i, src.indexOf('axes', i) > i ? src.indexOf('axes', i) : i + 400);
    (block.match(/(\w+)\s*:\s*\[/g) || []).forEach(function(m){
      names.add(m.replace(/\s*:\s*\[$/, ''));
    });
  });
  names.delete('actions');
  return names;
}

test('TOUTE ACTION visee par le controleur par defaut EXISTE dans la table d inputs', () => {
  // Le défaut visait `haut` et `bottom`, qui n'existent dans aucune table. `actionActive` rend
  // `false` pour une action inconnue — sans erreur et sans message. Mesuré en jouant : un
  // personnage vue de dessus neuf allait à gauche et à droite, et ne montait ni ne descendait.
  const src = read('js/world-2d.js');
  const block = src.slice(src.indexOf('userData.controller2d = {'),
                         src.indexOf('return node.userData.controller2d'));
  const vises = (block.match(/action\w+\s*:\s*'([^']+)'/g) || [])
    .map(function(m){ return m.replace(/^.*'([^']+)'$/, '$1'); });
  assert.ok(vises.length >= 5, 'aucune action lue dans les défauts : le test ne mesure plus rien');
  const connues = actionsConnues();
  assert.ok(connues.size >= 4, 'table d\'entrées non lue (' + connues.size + ')');
  const fantomes = vises.filter(function(a){ return !connues.has(a); });
  assert.deepEqual(fantomes, [], 'le contrôleur aims des actions qui n\'existent pas : '
    + fantomes.join(', ') + '. Elles rendront `false` en silence.');
});

test('TOUT REGLAGE du controleur et du collider est ATTEIGNABLE par le copilote', () => {
  // `mode` n'était joignable que par l'inspecteur : le copilote pouvait créer un personnage view
  // de dessus, pas le faire marcher en huit directions. Et le collider n'offrait ni `dx` ni `dy`,
  // donc la boîte restait centrée sur le sprite — un personnage qui bute avec la tête.
  const world = read('js/world-2d.js');
  const raw = world.slice(world.indexOf('userData.controller2d = {'),
                           world.indexOf('return node.userData.controller2d'));
  // SANS LES COMMENTAIRES : « Mesuré en jouant : » donnait la clé « jouant ». Un test qui lit du
  // code doit lire du code, sinon il dénonce la prose qui l'explique.
  const defaults = raw.split('\n').filter(function(l){ return !/^\s*\/\//.test(l); }).join('\n');
  const regles = (defaults.match(/(\w+)\s*:/g) || [])
    .map(function(m){ return m.replace(/\s*:$/, ''); })
    .filter(function(k){ return !/^action/.test(k) && k !== 'userData' && k !== 'controller2d'; });
  assert.ok(regles.length >= 4, 'aucun réglage lu : le test ne mesure plus rien (' + regles + ')');
  const cop = read('js/copilot.js');
  const start = cop.indexOf("name: 'configure_physics_2d'");
  const schema = cop.slice(start, cop.indexOf('exec: function', start));
  // La cle interne (userData, francais) et le PARAMETRE de commande (anglais depuis le
  // chantier 2 du renommage) diffferent : la table dit la correspondance.
  const PARAM = {speed: 'speed', speedMax: 'maxSpeed', heightJump: 'jumpHeight',
                 memoireJump: 'jumpBuffer', stepUp: 'stepUp', coyote: 'coyote',
                 statique: 'static', traversable: 'walkThrough', shape: 'shape'};
  const absents = regles.filter(function(k){ return schema.indexOf((PARAM[k] || k) + ':') < 0; });
  assert.deepEqual(absents, [], 'réglages du contrôleur hors de portée du copilote : ' + absents.join(', '));
  // La boîte doit pouvoir se poser AILLEURS qu'au centre.
  assert.ok(schema.indexOf('dx:') >= 0, 'le collider du copilote n\'offre pas dx');
  assert.ok(schema.indexOf('dy:') >= 0, 'le collider du copilote n\'offre pas dy');
  // Et les deux vues doivent être nommées, sinon `mode` est un champ libre où l'on écrit n'importe quoi.
  assert.ok(schema.indexOf("enum: ['platform', 'topdown']") >= 0, 'les deux vues ne sont pas énumérées');
});

test('CHOISIR L IMAGE et LIRE LE REGARD sont dans les DEUX moteurs', () => {
  // Le contrôleur mémorise `regardX`/`regardY` depuis le premier jour, et rien ne pouvait les lire.
  // Sur une planche vue de dessus chaque case est un couple (direction, état) : sans ces deux
  // entrées, le personnage marche en huit directions en regardant toujours dans le même sens.
  const ed = read('js/scripts.js'), rt = read('js/game-runtime.js');
  const a = (src, n) => src.indexOf(n + ': function') >= 0 || src.indexOf(n + ':function') >= 0;
  ['spriteImage', 'aim2d'].forEach(function(n){
    assert.ok(a(ed, n), 'éditeur : api.' + n + ' absente');
    assert.ok(a(rt, n), 'game publié : api.' + n + ' absente');
  });
  // Les deux moteurs posent l'image par la MÊME fonction partagée (le miroir runtime a disparu).
  assert.match(ed.slice(ed.indexOf('spriteImage:')), /updateImageSprite\(/);
  assert.match(rt.slice(rt.indexOf('spriteImage:')), /[^t]updateImageSprite\(/);
  // `regard2d` lit la mémoire écrite par la branche vue de dessus, pas une autre.
  assert.match(read('js/world-2d.js'), /e2\.regardX = ax; e2\.regardY = ay;/);
});

test('UN NOM D IMAGE INCONNU est refuse, et ne change RIEN a l affichage', () => {
  // `regionOfSprite` retombe volontairement sur la première image quand le nom est inconnu : c'est
  // ce qui empêche un sprite de disparaître après qu'on a renommé sa région. Pour un script, ce
  // repli est un piège muet — une faute de frappe montre la pose n° 1 à chaque image, pour
  // toujours, et rien ne le dit. Mesuré avant correction : `api.spriteImage('img_inexistante')`
  // changeait l'affichage ET rendait `true`.
  const ed = read('js/scripts.js'), rt = read('js/game-runtime.js');
  [['éditeur', ed, 'spriteImage: function'], ['game publié', rt, 'spriteImage:function']].forEach(function(p){
    const i = p[1].indexOf(p[2]);
    assert.notEqual(i, -1, p[0] + ' : api.spriteImage introuvable');
    const body = p[1].slice(i, i + 1400);
    assert.match(body, /return false;/,
      p[0] + ' : api.spriteImage ne refuse aucun nom — le repli du rendu passe pour un succès');
    // Le refus doit venir d'une VÉRIFICATION du nom dans les régions, pas d'un garde-fou voisin.
    assert.match(body, /regions \|\| \[\]\)\.some/,
      p[0] + ' : le nom n\'est pas cherché dans les régions de la planche');
  });
  // Et le repli du RENDU doit rester : c'est lui qui sauve un sprite dont la région a été renommée.
  assert.match(read('js/sprite-2d.js'), /regions\.find\(function\(r\)\{ return r && r\.name === name; \}\) \|\| regions\[0\]/,
    'le repli de regionOfSprite a disparu : un renommage de région ferait disparaître le sprite');
});
