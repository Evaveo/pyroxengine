import { deEsm } from './engine-env.mjs';
// Sprites 2D — le calcul pur.
//
// Deux pièges dominent ce fichier, et ce sont eux qu'on mesure :
//   · le RETOURNEMENT vertical entre les pixels d'une image (origine en haut) et les
//     coordonnées de texture (origine en bas) — se trompe silencieusement, donne des sprites
//     à l'envers ;
//   · l'ordre d'affichage, qui doit être AUTEUR et non déduit de la profondeur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');

// Aucun three, aucun DOM : c'est ce qui rend ce calcul éprouvable ici alors que rien de ce qui
// touche au rendu ne l'est.
function contexte(){
  const bac = {console, Math, JSON, Set, Map, Array, Object, Number};
  bac.window = bac; bac.self = bac; bac.globalThis = bac;
  const ctx = vm.createContext(bac);
  vm.runInContext(deEsm(read('js/sprite-2d.js')), ctx, {filename:'js/sprite-2d.js'});
  return ctx;
}

// Les objets rendus naissent DANS le bac à sable : leur prototype n'est pas celui d'ici, et une
// comparaison stricte échoue sur des valeurs pourtant identiques. On repasse par JSON, qui ne
// garde que ce qu'on veut comparer.
const nu = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v));


// TOUS les fichiers de js/, pas une liste écrite à la main. C'est une liste de trois noms qui a
// laissé passer `js/components/component-sprite.js` — le seul site dont le défaut se voyait à
// l'écran, puisque c'est lui qui pose les coordonnées de texture : sans dimensions, le sprite
// affichait la PLANCHE ENTIÈRE sur sa case, et les seize personnages devenaient un seul.
const FICHIERS_JS = readdirSync(path.join(root, 'js'), {recursive: true})
  .map((p) => 'js/' + String(p))
  .filter((p) => p.endsWith('.js'));

const CALQUES = ['Fond', 'Décor', 'Jeu', 'Premier plan', 'Interface'];

test('UV : le HAUT de l image donne le v le PLUS GRAND', () => {
  const ctx = contexte();
  // Le piège de toute découpe de planche. Une région collée en haut à gauche d'une texture de
  // 64×64 : en pixels elle occupe y de 0 à 16, en coordonnées de texture v de 0,75 à 1.
  // Inverser donne un sprite à l'envers, sans erreur et sans rien pour orienter la recherche.
  const uv = ctx.uvOfRegion({x:0, y:0, l:16, h:16}, 64, 64);
  assert.equal(uv.u0, 0);
  assert.equal(uv.u1, 0.25);
  assert.equal(uv.v1, 1, 'le bord HAUT de la région doit être à v = 1');
  assert.equal(uv.v0, 0.75, 'le bord BAS de la région doit être à v = 0,75');
  // Et la région du bas donne les v les plus petits — la symétrie de la précédente.
  const bottom = ctx.uvOfRegion({x:0, y:48, l:16, h:16}, 64, 64);
  assert.equal(bottom.v0, 0);
  assert.equal(bottom.v1, 0.25);
});

test('UV : une region qui couvre toute la texture donne 0 a 1', () => {
  const ctx = contexte();
  const uv = ctx.uvOfRegion({x:0, y:0, l:32, h:32}, 32, 32);
  assert.deepEqual([uv.u0, uv.u1, uv.v0, uv.v1], [0, 1, 0, 1]);
});

test('UV : une entrée absurde rend null, pas des NaN', () => {
  const ctx = contexte();
  // Des UV NaN ne lèvent aucune erreur : le sprite disparaît, tout simplement.
  assert.equal(ctx.uvOfRegion({x:0, y:0, l:0, h:16}, 64, 64), null, 'width nulle');
  assert.equal(ctx.uvOfRegion({x:0, y:0, l:16, h:16}, 0, 64), null, 'texture sans largeur');
  assert.equal(ctx.uvOfRegion(null, 64, 64), null);
});

test('la taille dans le monde suit les pixels par unite', () => {
  const ctx = contexte();
  // 16 px à 16 ppu = 1 unité : la convention du pixel-art, un sprite de personnage fait 1 de haut.
  assert.deepEqual(nu(ctx.sizeOfRegion({l:16, h:32}, 16)), {width:1, height:2});
  // La même image à 100 ppu tient dans 0,16 unité — d'où la proposition de 16 à l'import.
  assert.deepEqual(nu(ctx.sizeOfRegion({l:16, h:16}, 100)), {width:0.16, height:0.16});
  assert.equal(ctx.sizeOfRegion({l:16, h:16}, 0), null, 'un ppu nul doit être refusé');
});

test('le pivot aux PIEDS remonte le sprite d une demi-height', () => {
  const ctx = contexte();
  // Le cas qui sert : poser le personnage sur le sol revient alors à poser son y sur le sol.
  const pieds = ctx.offsetOfPivot({l:16, h:32}, {x:0.5, y:0}, 16);
  assert.equal(pieds.x, 0);
  assert.equal(pieds.y, 1, 'la moitié de 2 unités de haut');
  // Au centre, aucun décalage — c'est le défaut.
  assert.deepEqual(nu(ctx.offsetOfPivot({l:16, h:32}, {x:0.5, y:0.5}, 16)), {x:0, y:0});
  assert.deepEqual(nu(ctx.offsetOfPivot({l:16, h:32}, null, 16)), {x:0, y:0}, 'pivot absent = centre');
  // Le coin haut-gauche pousse dans les deux sens, en sens opposés.
  const coin = ctx.offsetOfPivot({l:16, h:32}, {x:0, y:1}, 16);
  assert.equal(coin.x, 0.5);
  assert.equal(coin.y, -1);
});

test('LE CALQUE DOMINE L ORDRE, toujours', () => {
  const ctx = contexte();
  // Un sprite tout en haut du calque « Fond » doit rester DERRIÈRE un sprite tout en bas du
  // layer « Décor ». C'est la promesse d'un calque : sinon il ne sert à rien.
  const fondHaut = ctx.orderOfSort(CALQUES, 'Fond', 499, 0);
  const decorBas = ctx.orderOfSort(CALQUES, 'Décor', -499, 0);
  assert.ok(fondHaut < decorBas, 'Fond/499 = ' + fondHaut + ' n\'est pas derrière Décor/−499 = ' + decorBas);
  // Et l'ordre départage à l'intérieur d'un même calque.
  assert.ok(ctx.orderOfSort(CALQUES, 'Jeu', 1, 0) < ctx.orderOfSort(CALQUES, 'Jeu', 2, 0));
});

test('un ordre demesure NE DEBORDE PAS sur le calque voisin', () => {
  const ctx = contexte();
  // Sans clamped, un ordre de 1200 sur « Décor » passerait devant tout « Jeu » — sans erreur, et
  // rien dans l'interface ne laisserait deviner pourquoi.
  const debordant = ctx.orderOfSort(CALQUES, 'Décor', 1200, 0);
  const voisinBas = ctx.orderOfSort(CALQUES, 'Jeu', -499, 0);
  assert.ok(debordant < voisinBas, 'Décor/1200 = ' + debordant + ' est passé devant Jeu');
  // Symétrique vers le bas.
  const sousSol = ctx.orderOfSort(CALQUES, 'Décor', -5000, 0);
  assert.ok(sousSol > ctx.orderOfSort(CALQUES, 'Fond', 499, 0), 'Décor est passé derrière Fond');
});

test('un calque inconnu tombe au FOND, pas devant tout', () => {
  const ctx = contexte();
  // Un calque supprimé du project laisse des sprites qui le citent encore. Les envoyer au fond
  // est réparable d'un coup d'œil ; les envoyer devant masquerait la scène entière.
  const perdu = ctx.orderOfSort(CALQUES, 'CalqueSupprimé', 0, 0);
  assert.ok(perdu < ctx.orderOfSort(CALQUES, 'Décor', -499, 0));
});

test('deux sprites a egalite sont departages par ordre de CREATION', () => {
  const ctx = contexte();
  // Sans départage, le tri interne du moteur de rendu tranche — et peut s'inverser d'un
  // rechargement à l'autre. Le dernier créé pass devant.
  const vieux = ctx.orderOfSort(CALQUES, 'Jeu', 0, 10);
  const neuf = ctx.orderOfSort(CALQUES, 'Jeu', 0, 11);
  assert.ok(neuf > vieux, 'aucun départage : ' + vieux + ' vs ' + neuf);
  // Mais le départage ne doit JAMAIS franchir le rang suivant.
  assert.ok(ctx.orderOfSort(CALQUES, 'Jeu', 0, 999999999) < ctx.orderOfSort(CALQUES, 'Jeu', 1, 0));
});

test('la decoupe en grille lit de gauche a droite puis de haut en bas', () => {
  const ctx = contexte();
  const r = ctx.sliceGrid(64, 32, 16, 16, {prefixe:'marche'});
  assert.equal(r.length, 8, '4 colonnes × 2 rangées');
  assert.deepEqual(nu(r[0]), {name:'marche_0', x:0, y:0, l:16, h:16});
  assert.deepEqual(nu(r[3]), {name:'marche_3', x:48, y:0, l:16, h:16}, 'la 4e est en bout de rangée');
  assert.deepEqual(nu(r[4]), {name:'marche_4', x:0, y:16, l:16, h:16}, 'la 5e repart à gauche');
});

test('une cellule qui DEPASSE du bord est abandonnee, pas rognee', () => {
  const ctx = contexte();
  // Une demi-image dans un atlas ne se remarque qu'à l'animation, quand un pied est coupé.
  const r = ctx.sliceGrid(40, 16, 16, 16, {});
  assert.equal(r.length, 2, '40 px ne tiennent que deux cellules de 16, pas deux et demie');
  assert.equal(r[1].x + r[1].l, 32);
});

test('marge et spacing sont respectes', () => {
  const ctx = contexte();
  const r = ctx.sliceGrid(70, 20, 16, 16, {marge:2, spacing:2});
  assert.equal(r.length, 3, '2 + 3×16 + 2×2 = 54 ≤ 70, la 4e déborderait');
  assert.deepEqual([r[0].x, r[1].x, r[2].x], [2, 20, 38]);
});

test('le ppu propose distingue le pixel-art de l illustration', () => {
  const ctx = contexte();
  assert.equal(ctx.ppuByDefault(16, 16), 16, 'du pixel-art');
  assert.equal(ctx.ppuByDefault(64, 32), 16);
  assert.equal(ctx.ppuByDefault(512, 512), 100, 'une illustration');
  assert.equal(ctx.ppuByDefault(64, 256), 100, 'c\'est le PLUS GRAND côté qui décide');
  assert.equal(ctx.ppuByDefault(0, 0), 100, 'size inconnue : la valeur d\'usage');
});

test('le rapport pixel dit quand la nettete est perdue', () => {
  const ctx = contexte();
  // 720 px d'écran, une vue de 45 unités, 16 ppu → 720 / 720 = 1 : chaque texel un pixel.
  assert.deepEqual(nu(ctx.ratioPixel(720, 45, 16)), {ratio:1, entier:true});
  assert.equal(ctx.ratioPixel(1440, 45, 16).ratio, 2);
  // 2,5 : un texel s'étale sur 2 ou 3 pixels selon l'endroit, les colonnes n'ont plus la même
  // width. C'est ça, « c'est un peu sale ».
  assert.equal(ctx.ratioPixel(1800, 45, 16).entier, false);
  assert.deepEqual(nu(ctx.ratioPixel(0, 45, 16)), {ratio:0, entier:false});
});

test('une region se retrouve par son nom, et le missing ne plante pas', () => {
  const ctx = contexte();
  const s = {regions:[{name:'a'}, {name:'b'}]};
  assert.equal(ctx.regionOfSprite(s, 'b').name, 'b');
  assert.equal(ctx.regionOfSprite(s, null).name, 'a', 'sans nom : la première');
  // Une région renommée laisse des composants qui citent l'ancien name. Afficher la première
  // vaut mieux qu'un sprite invisible que personne ne relie au renommage.
  assert.equal(ctx.regionOfSprite(s, 'disparue').name, 'a');
  assert.equal(ctx.regionOfSprite({regions:[]}, 'a'), null);
  assert.equal(ctx.regionOfSprite(null, 'a'), null);
});

// Un faux three : juste ce que les trois constructeurs touchent. Il rend le module éprouvable
// sans moteur de rendu — c'est tout l'intérêt de lui PASSER l'space de noms plutôt que de le
// lire dans le global.
function fauxThree(){
  const uv = {tab:[], setXY(i, u, v){ this.tab[i] = [u, v]; }, needsUpdate:false};
  return {
    NearestFilter: 'near',
    DoubleSide: 'deux-faces',
    PlaneGeometry: function(l, h){
      this.params = {l, h};
      this.attributes = {uv};
      this.offset = null;
      this.translate = function(x, y, z){ this.offset = [x, y, z]; return this; };
    },
    MeshBasicMaterial: function(o){ Object.assign(this, o); }
  };
}

test('la geometrie porte la bonne size ET le pivot cuit dedans', () => {
  const ctx = contexte();
  const T = fauxThree();
  const g = ctx.geometrySprite(T, {l:16, h:32}, 16, {x:0.5, y:0});
  assert.deepEqual(nu(g.params), {l:1, h:2});
  // Le décalage est CUIT dans la géométrie, pas posé sur la mesh : sinon un script qui lit
  // `object.position` obtiendrait autre chose que ce que l'inspecteur shown.
  assert.deepEqual(nu(g.offset), [0, 1, 0]);
  // Pivot au center : rien à décaler, et on ne touche donc pas à la géométrie.
  assert.equal(ctx.geometrySprite(T, {l:16, h:32}, 16, {x:0.5, y:0.5}).offset, null);
  assert.equal(ctx.geometrySprite(T, {l:0, h:0}, 16, null), null, 'une région vide');
});

test('les UV suivent l ordre des sommets d un plan : haut-gauche, haut-droit, bottom-gauche, bottom-droit', () => {
  const ctx = contexte();
  const T = fauxThree();
  const g = new T.PlaneGeometry(1, 1);
  const uv = {u0:0.25, u1:0.5, v0:0.75, v1:1};
  assert.equal(ctx.applyUvSprite(g, uv, false, false), true);
  // Se tromper d'ordre donne un sprite en diagonale ou en miroir — visible, mais on cherche du
  // côté de la découpe plutôt que de celui du plan.
  assert.deepEqual(nu(g.attributes.uv.tab), [[0.25, 1], [0.5, 1], [0.25, 0.75], [0.5, 0.75]]);
  assert.equal(g.attributes.uv.needsUpdate, true);
});

test('les retournements ECHANGENT LES BORNES, ils ne mettent pas d scale negative', () => {
  const ctx = contexte();
  const T = fauxThree();
  const uv = {u0:0, u1:1, v0:0, v1:1};
  const gx = new T.PlaneGeometry(1, 1);
  ctx.applyUvSprite(gx, uv, true, false);
  assert.deepEqual(nu(gx.attributes.uv.tab[0]), [1, 1], 'le haut-gauche doit lire le bord droit');
  assert.deepEqual(nu(gx.attributes.uv.tab[1]), [0, 1]);
  const gy = new T.PlaneGeometry(1, 1);
  ctx.applyUvSprite(gy, uv, false, true);
  assert.deepEqual(nu(gy.attributes.uv.tab[0]), [0, 0], 'le haut-gauche doit lire le bord bottom');
  // Une géométrie sans attribut uv ne doit pas planter : elle rend simplement false.
  assert.equal(ctx.applyUvSprite({attributes:{}}, uv, false, false), false);
  assert.equal(ctx.applyUvSprite(null, uv, false, false), false);
});

test('LE MATERIAU DESACTIVE LA PROFONDEUR — c est ce qui rend l ordre auteur', () => {
  const ctx = contexte();
  const T = fauxThree();
  const m = ctx.materialSprite(T, null, undefined, false);
  // Les laisser actifs rendrait la position en Z décisive et ferait clignoter les sprites les
  // uns derrière les autres. C'est LE réglage qui distingue la 2D de la 3D vue de face.
  assert.equal(m.depthTest, false);
  assert.equal(m.depthWrite, false);
  assert.equal(m.transparent, true);
  assert.equal(m.color, 0xffffff, 'sans teinte : blanc, donc la texture intacte');
  assert.equal(ctx.materialSprite(T, null, 0xff0000, false).color, 0xff0000);
});

test('le filtre PROCHE est pose sur la texture, mipmaps coupes', () => {
  const ctx = contexte();
  const T = fauxThree();
  const tex = {magFilter:'lineaire', minFilter:'lineaire', generateMipmaps:true, needsUpdate:false,
               image:{width:16, height:16, complete:true}};
  ctx.materialSprite(T, tex, undefined, true);
  assert.equal(tex.magFilter, 'near');
  assert.equal(tex.minFilter, 'near', 'la RÉDUCTION aussi : sinon un zoom arrière relisse tout');
  assert.equal(tex.generateMipmaps, false);
  assert.equal(tex.needsUpdate, true, 'sans ça three garde l\'ancien filtrage jusqu\'au prochain envoi');
  // Et sans pixel-art, on ne touche à rien : une illustration veut son lissage.
  const lisse = {magFilter:'lineaire', minFilter:'lineaire', generateMipmaps:true, needsUpdate:false};
  ctx.materialSprite(T, lisse, undefined, false);
  assert.equal(lisse.magFilter, 'lineaire');
  assert.equal(lisse.needsUpdate, false);
});

test('une texture dont l\'image n\'est pas encore chargee n\'est PAS marquee a jour', () => {
  // WebGPURenderer lit `image.complete` sans tester null : marquer une texture importée avant la
  // fin de son TextureLoader plantait le rendu. Le filtre est posé quand même — le chargeur
  // marquera la texture lui-même à l'arrivée de l'image.
  const ctx = contexte();
  const T = fauxThree();
  const tex = {magFilter:'lineaire', minFilter:'lineaire', generateMipmaps:true, needsUpdate:false, image:null};
  ctx.materialSprite(T, tex, undefined, true);
  assert.equal(tex.magFilter, 'near');
  assert.equal(tex.needsUpdate, false);
});

test('les fautes d un sprite sont DITES, pas subies', () => {
  const ctx = contexte();
  const dis = (s) => ctx.validateSprite(s, ['t1']).join(' | ');
  const bon = {textureId:'t1', ppu:16, pivot:{x:0.5, y:0}, regions:[{name:'a', l:16, h:16}]};
  assert.equal(dis(bon), '', 'un sprite valide est signalé : ' + dis(bon));

  assert.match(dis(Object.assign({}, bon, {textureId:null})), /Aucune texture/);
  assert.match(dis(Object.assign({}, bon, {textureId:'disparue'})), /n'existe plus/);
  assert.match(dis(Object.assign({}, bon, {ppu:0})), /pixels par unité/);
  assert.match(dis(Object.assign({}, bon, {regions:[]})), /Aucune région/);
  assert.match(dis(Object.assign({}, bon, {regions:[{name:'a', l:16, h:16}, {name:'a', l:8, h:8}]})),
    /jamais être désignée/);
  assert.match(dis(Object.assign({}, bon, {regions:[{name:'a', l:0, h:16}]})), /est vide/);
  assert.match(dis(Object.assign({}, bon, {pivot:{x:1.5, y:0}})), /sort de la région/);
  assert.equal(ctx.validateSprite(null).length, 1);
});

// ---------------------------------------------------------------------------------------------
// Les dimensions d'une texture, quelle que soit sa provenance.
//
// Le défaut qui a fait écrire ces tests : une planche IMPORTÉE depuis un fichier donnait un sprite
// à zéro région et à ppu 100, un « Découper » sans effet, un « Fusionner » qui sortait aussitôt, et
// un `slice_sheet` qui refusait en annonçant une texture de « 0 × 0 px » — alors que l'image
// faisait 1254 × 1254 et s'affichait dans le panneau. Cinq points lisaient `template || image`, que
// seule une texture FABRIQUÉE par le moteur possède.
// ---------------------------------------------------------------------------------------------

test('UNE TEXTURE IMPORTEE rend ses vraies dimensions — le cas qui etait mort', () => {
  const ctx = contexte();
  // Exactement la shape mesurée dans le navigateur après `importFiles` : ni template, ni image.
  const importee = {kind:'texture', name:'heros.png',
                    imageSource:{width:1254, height:1254},
                    dimensionsSource:[1254, 1254],
                    texture:{image:{width:1254, height:1254}}};
  assert.deepEqual(nu(ctx.dimensionsTexture(importee)), {l:1254, h:1254});
  // Et la découpe qui en découle doit rendre les 16 cases, pas zéro.
  const d = ctx.dimensionsTexture(importee);
  assert.equal(ctx.sliceGrid(d.l, d.h, 313, 313, {}).length, 16);
});

test('CHAQUE SOURCE seule suffit, et l ordre de preference est tenu', () => {
  const ctx = contexte();
  const D = (t) => nu(ctx.dimensionsTexture(t));
  assert.deepEqual(D({template:{width:8, height:9}}), {l:8, h:9}, 'template seul');
  assert.deepEqual(D({image:{width:8, height:9}}), {l:8, h:9}, 'image seule');
  assert.deepEqual(D({imageSource:{width:8, height:9}}), {l:8, h:9}, 'imageSource seule');
  assert.deepEqual(D({texture:{image:{width:8, height:9}}}), {l:8, h:9}, 'texture.image seule');
  assert.deepEqual(D({dimensionsSource:[8, 9]}), {l:8, h:9}, 'dimensionsSource seul');
  // Une image du DOM ne porte que naturalWidth/naturalHeight tant qu'elle n'est pas dans la page.
  assert.deepEqual(D({image:{naturalWidth:8, naturalHeight:9}}), {l:8, h:9}, 'naturalWidth');
  // La préférence : `template` gagne sur tout le reste, `dimensionsSource` ne sert qu'en dernier —
  // c'est le seul qui survive sans image décodée, et le seul qui puisse être périmé.
  assert.deepEqual(D({template:{width:1, height:1}, image:{width:2, height:2},
                      imageSource:{width:3, height:3}, dimensionsSource:[4, 4]}), {l:1, h:1});
  assert.deepEqual(D({imageSource:{width:3, height:3}, dimensionsSource:[4, 4]}), {l:3, h:3});
});

test('RIEN D EXPLOITABLE rend zero, sans jeter', () => {
  const ctx = contexte();
  const D = (t) => nu(ctx.dimensionsTexture(t));
  assert.deepEqual(D(null), {l:0, h:0});
  assert.deepEqual(D({}), {l:0, h:0});
  // Une image pas encore décodée porte des dimensions NULLES : il faut retomber sur
  // `dimensionsSource` et pas rendre 0, sinon la découpe échoue au premier import.
  assert.deepEqual(D({imageSource:{width:0, height:0}, dimensionsSource:[1254, 1254]}),
                   {l:1254, h:1254});
});

test('AUCUN FICHIER de js/ ne relit template || image — le helper est le seul filePath', () => {
  // La version précédente de cette garde nommait TROIS fichiers à la main, et c'est exactement ce
  // qui a laissé passer `js/components/component-sprite.js` : le seul site dont le défaut se voyait
  // à l'écran, puisque c'est lui qui pose les coordonnées de texture. Sans dimensions, le sprite
  // affichait la PLANCHE ENTIÈRE dans sa case — les seize personnages n'en faisaient plus qu'un.
  // Une garde qui énumère ses targets ne protège que ce qu'on avait déjà en tête.
  const fautifs = [];
  FICHIERS_JS.forEach(function(f){
    const src = read(f);
    if(/function dimensionsTexture/.test(src)) return;   // le helper a le droit : c'est son travail
    if(/template \|\| \w+\.image/.test(src)) fautifs.push(f);
  });
  assert.deepEqual(fautifs, [], 'ces fichiers relisent encore template || image : ' + fautifs.join(', '));
  // Sept points de branchement : création du sprite, slice_sheet, section d'inspecteur,
  // button Découper, button Fusionner, reconstruction de la maille, et la map de tuiles.
  // On count les APPELS, pas la définition — la compter donnait un total de huit, et unregister
  // un vrai point laissait encore sept : la garde survivait à ce qu'elle prétend surveiller.
  const n = FICHIERS_JS.reduce(function(t, f){
    return t + (read(f).match(/(^|[^\w.])dimensionsTexture\(/g) || [])
      .filter(function(m){ return !/function\s*$/.test(m); }).length;
  }, 0) - FICHIERS_JS.filter(function(f){ return /function dimensionsTexture/.test(read(f)); }).length;
  assert.equal(n, 7, 'il doit y avoir exactement 7 appels à dimensionsTexture, trouvé ' + n);
});

test('AUCUN img ORPHELIN ne survit pres d un dimensionsTexture', () => {
  // Deux `img.width` avaient survécu au remplacement — dont un dans le bouton « Découper » de
  // l'inspecteur. Le `const img = …` ayant disparu du bloc, ces lignes ne sont plus des valeurs
  // fausses : ce sont des ReferenceError, qui ne se voient qu'à l'exécution. Mesuré : la découpe
  // posait bien ses 16 régions puis jetait « img is not defined » à la ligne suivante, laissant
  // un historique empilé et aucun message à l'écran.
  const orphelins = [];
  FICHIERS_JS.forEach(function(f){
    const lines = read(f).replace(/\r\n/g, '\n').split('\n');
    let reste = 0;
    lines.forEach(function(l, i){
      if(/dimensionsTexture\(/.test(l)) reste = 30;                 // la portée du bloc réécrit
      else if(reste > 0){
        if(/\bimg\.(width|height|naturalWidth|naturalHeight)\b/.test(l))
          orphelins.push(f + ':' + (i + 1) + ' → ' + l.trim());
        reste--;
      }
    });
  });
  assert.deepEqual(orphelins, [], 'référence à `img` dans un bloc qui ne le déclare plus :\n  '
    + orphelins.join('\n  '));
});

test('UN SPRITE A UN AUTRE PPU que la camera pixel-perfect est signale', () => {
  const ctx = contexte();
  // La règle de la Pixel Perfect Camera d'Unity. Un sprite pixel-art importé à 16 sous une caméra
  // à 100 couvre 6,25 pixels d'écran par pixel d'art : flou, et aucune erreur ne le dit.
  const sprites = [{name: 'heros', ppu: 16}, {name: 'decor', ppu: 100}, {name: 'sans', ppu: 0}];
  const off = ctx.spritesOffPpu(100, sprites);
  assert.deepEqual(off.map((s) => s.name), ['heros'], 'un ppu absent ou nul ne se compare pas');
  assert.equal(ctx.spritesOffPpu(16, [{name: 'heros', ppu: 16}]).length, 0);
});
