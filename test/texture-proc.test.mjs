import { deEsm } from './engine-env.mjs';
// Fabriquer des pixels sans graphiste.
//
// Le test qui porte le fichier est celui de la PLANCHE D'AUTO-TUILAGE, vérifiée côté par côté sur les
// seize voisinages. Se tromper d'un bit produit un décor dont les contours apparaissent au milieu des
// blocks — et comme l'auto-tuilage du moteur, lui, est juste (16 tests derrière lui), on accuserait
// l'auto-tuilage.
//
// La convention du engine : haut=1, droite=2, bottom=4, gauche=8, et chaque bit dit « il y a un voisin du
// même matériau de ce côté ». Le edge se dessine donc là où le bit est À ZÉRO — l'inverse de
// l'intuition, et c'est précisément pour ça que ça se teste.
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
  const bac = {console, Math, JSON, Number, String, Object, Array, isFinite,
               parseInt, parseFloat, Uint8ClampedArray};
  bac.window = bac; bac.self = bac; bac.globalThis = bac;
  const ctx = vm.createContext(bac);
  vm.runInContext(deEsm(read('js/proc-texture.js')), ctx, {filename: 'js/proc-texture.js'});
  return ctx;
}

const HAUT = 1, DROITE = 2, BAS = 4, GAUCHE = 8;

test('LES SEIZE TUILES portent leur edge là où il n y a PAS de voisin', () => {
  const ctx = contexte();
  for(const p of [8, 16, 32]){
    const t = ctx.sheet16Tiles(p, '#808080', '#000000', 2);
    assert.equal(t.l, p * 4, 'la planche doit faire 4 tuiles de large');
    assert.equal(t.h, p * 4, 'et 4 de haut');
    const fautes = [];
    for(let i = 0; i < 16; i++){
      const ox = (i % 4) * p, oy = Math.floor(i / 4) * p;
      const milieu = Math.floor(p / 2);
      // Un pixel au MILIEU de chaque côté : les coins appartiennent à deux bords à la fois et ne
      // disent rien de l'un ni de l'autre.
      const cotes = [
        ['haut',   HAUT,   ox + milieu, oy],
        ['bottom',    BAS,    ox + milieu, oy + p - 1],
        ['left', GAUCHE, ox,          oy + milieu],
        ['right', DROITE, ox + p - 1,  oy + milieu]
      ];
      for(const [name, bit, x, y] of cotes){
        const px = ctx.readPixel(t, x, y);
        const estBord = px[0] === 0 && px[1] === 0 && px[2] === 0;
        const devraitEtreBord = !(i & bit);
        if(estBord !== devraitEtreBord){
          fautes.push('tile ' + i + ' côté ' + name + ' : edge=' + estBord
            + ', attendu ' + devraitEtreBord + ' (bit ' + bit + (i & bit ? ' mis' : ' à zéro') + ')');
        }
      }
      // Et le CŒUR de la tile est toujours du body : une tile entièrement edgeée resterait
      // lisible, une tile entièrement noire ne serait qu'un trou.
      const coeur = ctx.readPixel(t, ox + milieu, oy + milieu);
      if(!(coeur[0] === 128 && coeur[3] === 255)){
        fautes.push('tile ' + i + ' : le cœur n\'est pas la couleur du body (' + coeur.join(',') + ')');
      }
    }
    assert.deepEqual(fautes, [],
      'size ' + p + ' : la planche ne suit pas la convention d\'auto-tuilage du moteur.\n'
      + 'Le décor montrera des contours au milieu des blocs, et on accusera l\'auto-tuilage.\n'
      + fautes.join('\n'));
  }
});

test('LA TUILE 15 (entouree) n a AUCUN edge, la TUILE 0 (isolee) en a quatre', () => {
  const ctx = contexte();
  const p = 16;
  const t = ctx.sheet16Tiles(p, '#808080', '#000000', 2);
  const noir = (x, y) => { const c = ctx.readPixel(t, x, y); return c[0] === 0 && c[1] === 0 && c[2] === 0; };
  // Tuile 15 : voisins partout, donc pleine — c'est celle qui remplit l'intérieur d'un bloc de décor.
  const o15 = {x: (15 % 4) * p, y: Math.floor(15 / 4) * p};
  let bordsEn15 = 0;
  for(let k = 0; k < p; k++){
    if(noir(o15.x + k, o15.y)) bordsEn15++;
    if(noir(o15.x + k, o15.y + p - 1)) bordsEn15++;
    if(noir(o15.x, o15.y + k)) bordsEn15++;
    if(noir(o15.x + p - 1, o15.y + k)) bordsEn15++;
  }
  assert.equal(bordsEn15, 0, 'la tile 15 doit être pleine : ' + bordsEn15 + ' pixels de bord');
  // Tuile 0 : aucun voisin, donc edgeée des quatre côtés — un bloc solitaire.
  assert.ok(noir(p / 2, 0) && noir(p / 2, p - 1) && noir(0, p / 2) && noir(p - 1, p / 2),
    'la tile 0 doit être edgeée des quatre côtés');
});

test('LE BRUIT EST REPRODUCTIBLE — sinon on ne peut comparer aucune version', () => {
  const ctx = contexte();
  const a = ctx.textureNoise(16, 16, '#000000', '#ffffff', 42);
  const b = ctx.textureNoise(16, 16, '#000000', '#ffffff', 42);
  assert.deepEqual([...a.px], [...b.px], 'la même graine doit donner la même image');
  const c = ctx.textureNoise(16, 16, '#000000', '#ffffff', 43);
  assert.notDeepEqual([...a.px], [...c.px], 'deux graines différentes doivent différer');
  // Et sans graine, ça reste déterministe plutôt qu'aléatoire : régénérer un décor ne doit pas le
  // changer sous les pieds de l'auteur.
  assert.deepEqual([...ctx.textureNoise(8, 8, '#000', '#fff').px],
                   [...ctx.textureNoise(8, 8, '#000', '#fff').px]);
});

test('LES COULEURS sont lues en 3 comme en 6 chiffres', () => {
  const ctx = contexte();
  assert.deepEqual(hote(ctx.colorProc('#ff8000')), [255, 128, 0, 255]);
  assert.deepEqual(hote(ctx.colorProc('#f80')), [255, 136, 0, 255]);
  assert.deepEqual(hote(ctx.colorProc('ff8000')), [255, 128, 0, 255], 'le # doit être optionnel');
  // Une couleur absente ne fait pas tomber le calcul : un substitut blanc vaut mieux qu'une erreur au
  // milieu d'une séquence de commandes.
  assert.deepEqual(hote(ctx.colorProc(null)), [255, 255, 255, 255]);
});

test('LE DAMIER alterne vraiment, et le DEGRADE va bien d un bout a l autre', () => {
  const ctx = contexte();
  const d = ctx.textureChecker(16, 16, 4, '#000000', '#ffffff');
  // Deux cases voisines diffèrent : un damier qui ne damiere pas est un aplat, et il ne montre plus
  // ni l'échelle ni l'étirement — tout son intérêt.
  assert.notDeepEqual(hote(ctx.readPixel(d, 1, 1)), hote(ctx.readPixel(d, 5, 1)));
  assert.deepEqual(hote(ctx.readPixel(d, 1, 1)), hote(ctx.readPixel(d, 9, 1)), 'une case sur deux');

  const g = ctx.textureGradient(4, 10, '#000000', '#ffffff');
  assert.deepEqual(hote(ctx.readPixel(g, 0, 0)), [0, 0, 0, 255], 'le haut doit être la 1re color');
  assert.deepEqual(hote(ctx.readPixel(g, 0, 9)), [255, 255, 255, 255], 'le bottom la seconde');
  // Et monotone entre les deux : un dégradé qui repart en arrière se voit comme une bande.
  let precedent = -1, monotone = true;
  for(let y = 0; y < 10; y++){
    const v = ctx.readPixel(g, 0, y)[0];
    if(v < precedent) monotone = false;
    precedent = v;
  }
  assert.ok(monotone, 'le dégradé n\'est pas monotone');
});

test('LA PLANCHE DE PERSONNAGE bouge d une image a l autre', () => {
  const ctx = contexte();
  const p = 32, n = 4;
  const t = ctx.sheetCharacter(p, n, '#d9a05b', '#000000');
  assert.equal(t.l, p * n, 'une image par cellule, en line');
  assert.equal(t.h, p);
  // Ce qu'on veut d'un substitut : VOIR que l'animation joue. Deux images identiques ne le montrent
  // pas, et l'auteur conclurait que sa cadence est cassée.
  const column = (i) => {
    const out = [];
    for(let y = 0; y < p; y++) out.push(ctx.readPixel(t, i * p + Math.floor(p / 2), y).join(','));
    return out.join('|');
  };
  assert.notEqual(column(0), column(1), 'les images 0 et 1 sont identiques : rien ne bougera');
  assert.equal(column(0), column(2), 'l\'oscillation doit avoir une période de 2');
  // Chaque image porte quelque chose : une image vide au milieu d'une sequence fait un clignotement
  // qu'on met sur le compte du moteur.
  for(let i = 0; i < n; i++){
    let opaques = 0;
    for(let y = 0; y < p; y++) for(let x = 0; x < p; x++){
      if(ctx.readPixel(t, i * p + x, y)[3] > 0) opaques++;
    }
    assert.ok(opaques > p * 2, 'image ' + i + ' presque empty (' + opaques + ' pixels)');
  }
});

test('validateTextureProc REFUSE ce qui ne se dessine pas', () => {
  const ctx = contexte();
  assert.ok(ctx.validateTextureProc({kind: 'arc-en-ciel'}).some((x) => x.includes('inconnu')));
  assert.ok(ctx.validateTextureProc({kind: 'solid'}).some((x) => x.includes('largeur')));
  assert.ok(ctx.validateTextureProc({kind: 'tuiles16'}).some((x) => x.includes('taille d')));
  assert.ok(ctx.validateTextureProc({kind: 'character'}).some((x) => x.includes('taille d')));
  // Une texture de substitut énorme n'a pas de sens et pèserait plus que tout le jeu.
  assert.ok(ctx.validateTextureProc({kind: 'solid', width: 8000, height: 10}).some((x) => x.includes('4096')));
  assert.deepEqual(hote(ctx.validateTextureProc({kind: 'solid', width: 32, height: 32})), []);
  assert.deepEqual(hote(ctx.validateTextureProc({kind: 'tuiles16', size: 16})), []);
  // Et une demande invalide rend `null` plutôt qu'une toile empty : une toile empty passerait pour une
  // texture réussie et donnerait un décor invisible.
  assert.equal(ctx.makeTextureProc({kind: 'solid'}), null);
  assert.ok(ctx.makeTextureProc({kind: 'tuiles16', size: 16}));
});
