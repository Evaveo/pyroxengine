import { deEsm } from './engine-env.mjs';
// Assembler plusieurs planches en une seule.
//
// Le test qui porte le fichier est celui du NON-CHEVAUCHEMENT, vérifié par balayage sur des
// centaines de rangements. Deux images qui se recouvrent d'un seul pixel donnent un sprite avec un
// bout d'un autre collé au bord — et comme les coordonnées de texture sont justes, on cherche du
// côté du rendu, où il n'y a rien.
//
// Le manque que tout ceci comble : un SpriteAnimator lit ses sequences dans UN SEUL asset. Un
// personnage livré en neuf planches ne pouvait donc pas être animé du tout. Mesuré sur un vrai game :
// dix-huit planches, et un script hors de l'éditeur pour les composer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const hote = (x) => JSON.parse(JSON.stringify(x));

function contexte(){
  const bac = {console, Math, JSON, Number, String, Object, Array, isFinite};
  bac.window = bac; bac.self = bac; bac.globalThis = bac;
  const ctx = vm.createContext(bac);
  vm.runInContext(deEsm(read('js/sprite-atlas.js')), ctx, {filename: 'js/sprite-atlas.js'});
  return ctx;
}

/** Deux rectangles se recouvrent-ils ? Marge comprise. */
function chevauche(a, b, m){
  return (a.x - m) < (b.x + b.l + m) && (b.x - m) < (a.x + a.l + m)
      && (a.y - m) < (b.y + b.h + m) && (b.y - m) < (a.y + a.h + m);
}

test('AUCUNE image ne chevauche une autre — le test qui porte le fichier', () => {
  const ctx = contexte();
  // Des jeux d'images variés : carrés égaux, bands très larges, très hautes, tailles mélangées, et
  // le cas réel — neuf états d'un personnage en 96 × 96.
  const jeux = [
    {name: '9 etats de personnage', boites: Array.from({length: 9}, (_, i) => ({key: 'e' + i, l: 96, h: 96}))},
    {name: '18 planches de 8 images', boites: Array.from({length: 18 * 8}, (_, i) => ({key: 'p' + i, l: 96, h: 96}))},
    {name: 'bands larges', boites: Array.from({length: 12}, (_, i) => ({key: 'b' + i, l: 512, h: 16}))},
    {name: 'colonnes hautes', boites: Array.from({length: 12}, (_, i) => ({key: 'c' + i, l: 16, h: 512}))},
    {name: 'tailles melangees', boites: [
      {key: 'a', l: 100, h: 30}, {key: 'b', l: 7, h: 7}, {key: 'c', l: 64, h: 64},
      {key: 'd', l: 33, h: 129}, {key: 'e', l: 200, h: 5}, {key: 'f', l: 1, h: 1},
      {key: 'g', l: 48, h: 48}, {key: 'h', l: 300, h: 300}]},
    {name: 'une seule image', boites: [{key: 'x', l: 40, h: 24}]}
  ];
  for(const marge of [0, 1, 4]){
    for(const game of jeux){
      const p = ctx.planeAtlas(game.boites, marge);
      assert.ok(p, game.name + ' : aucun plan rendu');
      assert.equal(p.cases.length, game.boites.length,
        game.name + ' : ' + p.cases.length + ' rangées sur ' + game.boites.length + ' — une image perdue');
      // TOUT DANS L'ATLAS, marge comprise : une image qui dépass est coupée, ce qui se voit comme
      // un sprite tronqué et jamais comme un défaut de rangement.
      for(const c of p.cases){
        assert.ok(c.x >= marge && c.y >= marge,
          game.name + ' marge ' + marge + ' : ' + c.key + ' colle le bord (' + c.x + ',' + c.y + ')');
        assert.ok(c.x + c.l + marge <= p.l,
          game.name + ' : ' + c.key + ' depasse en x (' + (c.x + c.l) + ' > ' + p.l + ')');
        assert.ok(c.y + c.h + marge <= p.h,
          game.name + ' : ' + c.key + ' depasse en y (' + (c.y + c.h) + ' > ' + p.h + ')');
      }
      // LE BALAYAGE : toutes les paires.
      for(let i = 0; i < p.cases.length; i++){
        for(let j = i + 1; j < p.cases.length; j++){
          assert.ok(!chevauche(p.cases[i], p.cases[j], 0),
            game.name + ' marge ' + marge + ' : ' + p.cases[i].key + ' et ' + p.cases[j].key
            + ' se recouvrent — ' + JSON.stringify(hote(p.cases[i])) + ' / ' + JSON.stringify(hote(p.cases[j])));
        }
      }
      // Et la taille reste raisonnable : l'aire de l'atlas ne doit pas dépasser 4× l'aire utile,
      // sinon le rangement gâche plus qu'il ne sert et une texture de personnage devient énorme.
      const useful = game.boites.reduce((s, b) => s + b.l * b.h, 0);
      assert.ok(p.l * p.h <= useful * 4 + 4096,
        game.name + ' marge ' + marge + ' : atlas ' + p.l + '×' + p.h + ' pour ' + useful + ' px utiles');
    }
  }
});

test('LE RANGEMENT EST DETERMINISTE, et ne touche pas la liste de l appelant', () => {
  const ctx = contexte();
  // Un rangement qui change d'un import à l'autre rendrait impossible de comparer deux atlas, et les
  // régions enregistrées d'une scène pointeraient à côté au réimport.
  // L'ORDRE D'ENTRÉE N'EST PAS DÉJÀ L'ORDRE DE TRI, et c'est ce qui rend le test capable d'échouer :
  // avec une liste déjà triée par hauteur décroissante, un tri sur place ne la changerait pas et la
  // garde passerait sans rien vérifier. La courte est donc en premier.
  const faire = () => [{key: 'c', l: 90, h: 10}, {key: 'a', l: 30, h: 40}, {key: 'b', l: 30, h: 40}];
  const a = ctx.planeAtlas(faire(), 1);
  const b = ctx.planeAtlas(faire(), 1);
  assert.deepEqual(hote(a), hote(b), 'deux appels identiques doivent donner le MÊME rangement');
  // Deux images de MÊME taille sont départagées par leur clé : sans ce départage, l'ordre dépendrait
  // de la stabilité du tri, donc du moteur JS.
  const inverse = ctx.planeAtlas([{key: 'b', l: 30, h: 40}, {key: 'c', l: 90, h: 10}, {key: 'a', l: 30, h: 40}], 1);
  assert.deepEqual(hote(inverse), hote(a), 'l ordre d entry ne doit pas changer le rangement');
  // Et la liste passée ne doit pas être triée sur place : son ordre donne son numéro à chaque image
  // d une sequence d animation.
  const list = faire();
  ctx.planeAtlas(list, 1);
  assert.deepEqual(list.map((x) => x.key), ['c', 'a', 'b'], 'la liste de l appelant a ete triee');
});

test('LES NOMS SONT UNIQUES — sinon une animation joue les images d un autre etat', () => {
  const ctx = contexte();
  // Deux planches contiennent presque toujours une région du même nom (« image », « 1 »). Sans
  // préfixe, la seconde écraserait la première et le personnage marcherait en jouant sa mort — sans
  // la moindre erreur.
  const names = ctx.namesRegionsAtlas([
    {sheet: 'repos', region: 'image'},
    {sheet: 'course', region: 'image'},
    {sheet: 'repos', region: '1'},
    {sheet: 'repos', region: 'image'}      // vrai doublon : même planche, même région
  ]);
  assert.deepEqual(hote(names), ['repos/image', 'course/image', 'repos/1', 'repos/image#2']);
  assert.equal(new Set(hote(names)).size, 4, 'les noms doivent tous differer');
  // Un cas dégénéré ne doit pas produire deux fois le même nom non plus.
  const bis = ctx.namesRegionsAtlas([{}, {}, {}]);
  assert.equal(new Set(hote(bis)).size, 3, JSON.stringify(hote(bis)));
});

test('validateAtlas REFUSE des ppu differents — l scale serait fausse selon l state joue', () => {
  const ctx = contexte();
  const ok = [
    {name: 'repos', ppu: 48, textureId: 't1', regions: [{name: 'a', x: 0, y: 0, l: 96, h: 96}]},
    {name: 'course', ppu: 48, textureId: 't2', regions: [{name: 'a', x: 0, y: 0, l: 96, h: 96}]}
  ];
  assert.deepEqual(hote(ctx.validateAtlas(ok)), [], 'un assemblage correct ne doit RIEN signaler');
  // Le contrôle qui compte : l'atlas ne porte qu'un ppu. Mélanger du 16 et du 48 donnerait un
  // personnage trois fois trop grand selon l'état joué.
  const blend = [ok[0], Object.assign({}, ok[1], {ppu: 16})];
  assert.ok(ctx.validateAtlas(blend).some((x) => x.includes('pixels par unité')),
    JSON.stringify(hote(ctx.validateAtlas(blend))));
  // Une planche non découpée n'apporterait rien : le dire vaut mieux qu'un atlas incomplet.
  assert.ok(ctx.validateAtlas([ok[0], {name: 'x', ppu: 48, textureId: 't3', regions: []}])
              .some((x) => x.includes('sans aucune image découpée')));
  assert.ok(ctx.validateAtlas([ok[0], {name: 'y', ppu: 48, regions: [{name: 'a', x: 0, y: 0, l: 8, h: 8}]}])
              .some((x) => x.includes('sans image source')));
  // Une seule sheet : rien à assembler, et le dire évite un atlas inutile qui double la texture.
  assert.ok(ctx.validateAtlas([ok[0]]).some((x) => x.includes('au moins deux')));
  assert.ok(ctx.validateAtlas([]).length > 0);
});

test('LE PLAN GARDE L ORDRE DES SOURCES, pas celui du rangement', () => {
  const ctx = contexte();
  // Le rangement trie par hauteur pour gâcher moins de place. Les RÉGIONS, elles, doivent garder
  // l'ordre des planches et l'ordre de découpe dans chacune : c'est cet ordre qui donne son numéro à
  // chaque image d'une sequence. Les mélanger jouerait les animations dans le désordre.
  // LA PLANCHE COURTE EST EN PREMIER, exprès : si l'ordre des sources coïncidait avec l'ordre du
  // rangement (height décroissante), un mélange ne changerait rien et la garde ne mesurerait rien.
  // C'est le piège qu'une mutation a révélé — deux fixtures étaient déjà triées.
  const sources = [
    {name: 'course', ppu: 48, textureId: 't2', regions: [
      {name: '1', x: 0, y: 0, l: 64, h: 16}, {name: '2', x: 64, y: 0, l: 64, h: 16},
      {name: '3', x: 128, y: 0, l: 64, h: 16}]},
    {name: 'repos', ppu: 48, textureId: 't1', regions: [
      {name: '1', x: 0, y: 0, l: 32, h: 96}, {name: '2', x: 32, y: 0, l: 32, h: 96}]}
  ];
  const plan = ctx.planeAtlasFromSprites(sources, 1);
  assert.equal(plan.regions.length, 5);
  // `[...]` : un tableau né dans le bac à sable porte le prototype DU BAC, et `deepStrictEqual`
  // échoue alors sur des valeurs pourtant identiques — le message montre deux listes semblables et
  // on cherche le défaut dans le code testé.
  assert.deepEqual([...plan.regions].map((r) => r.name),
    ['course/1', 'course/2', 'course/3', 'repos/1', 'repos/2'],
    'l ordre des regions doit suivre les sources, PAS les heights');
  // Le rangement, lui, a bien mis les hautes d'abord : les deux « repos » (96 de haut) sont sur la
  // première étagère, donc à y minimal.
  const regions = [...plan.regions];
  const yRepos = regions.filter((r) => r.name.startsWith('repos')).map((r) => r.y);
  const yCourse = regions.filter((r) => r.name.startsWith('course')).map((r) => r.y);
  assert.ok(Math.min(...yRepos) <= Math.min(...yCourse), 'les hautes images doivent passer en premier');
  // Chaque région porte de quoi la DESSINER : sa source et la région d'origine.
  for(const r of regions){
    assert.ok(r.source && r.sourceRegion, r.name + ' : sans source, rien ne peut la dessiner');
    assert.equal(r.l, r.sourceRegion.l, r.name + ' : la largeur doit etre conservee');
    assert.equal(r.h, r.sourceRegion.h, r.name + ' : la hauteur doit etre conservee');
  }
  // Le ppu de l'atlas est celui des sources — c'est ce que `validateAtlas` a garanti identique.
  assert.equal(plan.ppu, 48);
  // Et rien à assembler ne rend PAS un atlas empty, qui produirait une texture de 1 × 1 et un asset
  // que rien ne signalerait comme inutilisable.
  assert.equal(ctx.planeAtlasFromSprites([{name: 'empty', ppu: 48, regions: []}], 1), null);
  assert.equal(ctx.planeAtlasFromSprites([], 1), null);
});

test('UNE IMAGE TROP GRANDE rend null, elle n est pas coupee', () => {
  const ctx = contexte();
  // Au-delà de 16 384 px aucune map graphique courante n'accepte la texture. Rendre un atlas où
  // l'image serait coupée donnerait un sprite tronqué, et on chercherait du côté de la découpe.
  assert.equal(ctx.planeAtlas([{key: 'enorme', l: 20000, h: 10}], 1), null);
  assert.equal(ctx.planeAtlas([{key: 'a', l: 32, h: 32}, {key: 'enorme', l: 20000, h: 10}], 1), null);
  // Juste en dessous de la limite, ça pass — et l'image n'est pas rognée.
  const p = ctx.planeAtlas([{key: 'large', l: 16000, h: 8}], 1);
  assert.ok(p, 'une image de 16 000 px doit encore passer');
  assert.equal(p.cases[0].l, 16000, 'la largeur ne doit pas etre rognee');
  assert.ok(p.cases[0].x + p.cases[0].l <= p.l, 'et elle doit tenir dans l atlas');
});

test('LES DIMENSIONS SONT DES PUISSANCES DE DEUX', () => {
  const ctx = contexte();
  const p2 = (n) => (n & (n - 1)) === 0;
  for(const boites of [
    [{key: 'a', l: 3, h: 3}],
    [{key: 'a', l: 96, h: 96}, {key: 'b', l: 96, h: 96}, {key: 'c', l: 96, h: 96}],
    Array.from({length: 40}, (_, i) => ({key: 'x' + i, l: 17, h: 23}))
  ]){
    const p = ctx.planeAtlas(boites, 1);
    assert.ok(p2(p.l), 'width ' + p.l + ' n est pas une puissance de deux');
    assert.ok(p2(p.h), 'height ' + p.h + ' n est pas une puissance de deux');
  }
});
