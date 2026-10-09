import { deEsm } from './engine-env.mjs';
// Tilemap 2D — la grille, l'auto-tuilage et les bands de collision.
//
// Le test qui porte le fichier est celui des BANDES : une salle de 48 × 27 doit donner quelques
// dizaines de boîtes de collision, pas 1 296. Sans ce regroupement, le solveur teste le
// personnage contre chaque case à chaque image, et le jeu passe de jouable à diaporama sans
// qu'aucune erreur ne soit levée — on accuse le rendu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');

function contexte(){
  const bac = {console, Math, JSON, Set, Map, Array, Object, Number, String, isFinite};
  bac.window = bac; bac.self = bac; bac.globalThis = bac;
  const ctx = vm.createContext(bac);
  // sprite-2d.js d'abord : `uvOfRegion` vient de là, et la tilemap l'appelle. Les charger dans
  // le désordre donnerait une erreur d'exécution qui ressemble à un défaut de la tilemap.
  vm.runInContext(deEsm(read('js/sprite-2d.js')), ctx, {filename: 'js/sprite-2d.js'});
  vm.runInContext(deEsm(read('js/tilemap.js')), ctx, {filename: 'js/tilemap.js'});
  return ctx;
}

const hote = (x) => JSON.parse(JSON.stringify(x));
const LEGENDE = {'#': 1, '=': 2};

/** Une salle de 48 × 27 comme celles du jeu : sol, plateformes, murs, plafond. */
function salle(ctx){
  const lines = [];
  for(let y = 0; y < 27; y++){
    let s = '';
    for(let x = 0; x < 48; x++){
      const edge = (x === 0 || x === 47 || y === 0 || y >= 25);
      const plateforme = (y === 18 && x >= 6 && x <= 16) || (y === 13 && x >= 22 && x <= 30);
      const passerelle = (y === 8 && x >= 34 && x <= 44);
      s += edge || plateforme ? '#' : (passerelle ? '=' : '.');
    }
    lines.push(s);
  }
  return ctx.mapFromText(lines.join('\n'), LEGENDE, 0.5);
}

test('LES BANDES DE COLLISION — le test qui porte le fichier', () => {
  const ctx = contexte();
  const c = salle(ctx);
  const pleines = c.cells.filter((v) => v !== 0).length;
  const bands = ctx.bandsCollision(c);
  // Le témoin : la salle doit vraiment contenir du décor, sinon « peu de boîtes » ne prouve
  // rien. 223 cases pleines sur les 1 296 de la grille — bordure, sol, deux plateformes, une
  // passerelle. C'est une salle du jeu, pas une figure.
  assert.ok(pleines > 200, 'la salle témoin doit être bien remplie : ' + pleines + ' cases');
  assert.ok(bands.length < 60,
    pleines + ' cases pleines ont donné ' + bands.length + ' boîtes de collision, moins de 60 attendues');

  // Et surtout : les bands doivent COUVRIR exactement les cases pleines, ni plus ni moins.
  // Un regroupement qui perd des cases ferait tomber le personnage à travers un sol qui se voit.
  const couvert = new Set();
  bands.forEach((b) => {
    for(let j = 0; j < b.h; j++) for(let i = 0; i < b.l; i++) {
      const key = (b.y + j) + ',' + (b.x + i);
      assert.ok(!couvert.has(key), 'la case ' + key + ' est couverte deux fois');
      couvert.add(key);
      assert.equal(ctx.cellTilemap(c, b.x + i, b.y + j), b.material,
        'la bande déborde sur une case d un autre matériau en ' + key);
    }
  });
  assert.equal(couvert.size, pleines, 'toutes les cases pleines doivent être couvertes');
});

test('UNE BANDE NE FUSIONNE JAMAIS DEUX MATERIAUX', () => {
  const ctx = contexte();
  // Une passerelle traversable posée dans le prolongement d'un sol plein. Fondues en une seule
  // boîte, l'une des deux prendrait la nature de l'autre — et le défaut ne se verrait qu'en
  // jouant, sur un saut qui ne traverse plus.
  const c = ctx.mapFromText('####====', LEGENDE, 0.5);
  const b = ctx.bandsCollision(c);
  assert.equal(b.length, 2, 'deux matériaux côte à côte donnent deux bands, pas ' + b.length);
  const mats = b.map((x) => x.material).sort();
  assert.deepEqual(hote(mats), [1, 2]);
});

test('un SOL PLAT de 48 cases donne UNE box', () => {
  const ctx = contexte();
  const c = ctx.mapFromText('#'.repeat(48), LEGENDE, 0.5);
  const b = ctx.bandsCollision(c);
  assert.equal(b.length, 1);
  assert.deepEqual(hote(b[0]), {x: 0, y: 0, l: 48, h: 1, material: 1});
});

test('un BLOC PLEIN se regroupe en deux dimensions, pas seulement en rangees', () => {
  const ctx = contexte();
  // Un carré 4 × 4 doit donner UNE boîte. Un regroupement qui ne travaille qu'en rangées en
  // donnerait quatre — quatre fois plus de tests de collision pour le même mur.
  const c = ctx.mapFromText(['####', '####', '####', '####'].join('\n'), LEGENDE, 0.5);
  const b = ctx.bandsCollision(c);
  assert.equal(b.length, 1, 'un carré plein doit donner une seule boîte, pas ' + b.length);
  assert.equal(b[0].l, 4);
  assert.equal(b[0].h, 4);
});

test('LES 16 CONFIGURATIONS de voisinage donnent les 16 index attendus', () => {
  const ctx = contexte();
  // haut = 1, droite = 2, bottom = 4, gauche = 8. On construit chaque voisinage explicitement et on
  // relit l'index : c'est la table que les graphistes dessinent, et une inversion haut/bottom y
  // passerait inaperçue jusqu'à ce que tout le décor soit à l'envers.
  for(let masque = 0; masque < 16; masque++){
    const c = ctx.mapEmpty(3, 3, 0.5);
    ctx.setCellTilemap(c, 1, 1, 1);
    if(masque & 1) ctx.setCellTilemap(c, 1, 0, 1);     // haut
    if(masque & 2) ctx.setCellTilemap(c, 2, 1, 1);     // droite
    if(masque & 4) ctx.setCellTilemap(c, 1, 2, 1);     // bottom
    if(masque & 8) ctx.setCellTilemap(c, 0, 1, 1);     // gauche
    assert.equal(ctx.indexAutoTile(c, 1, 1), masque,
      'voisinage ' + masque.toString(2).padStart(4, '0') + ' → index ' + ctx.indexAutoTile(c, 1, 1));
  }
});

test('LE BORD DE LA CARTE compte comme du VIDE, donc comme une arete', () => {
  const ctx = contexte();
  // Une case seule au coin haut-gauche d'une map pleine : ses voisins hors map doivent
  // compter comme absents. Les traiter comme pleins dessinerait une coupe franche au bord de la
  // salle, là où le joueur attend une arête.
  const c = ctx.mapFromText(['##', '##'].join('\n'), LEGENDE, 0.5);
  assert.equal(ctx.indexAutoTile(c, 0, 0), 2 + 4, 'le coin haut-gauche n a que droite et bottom');
  assert.equal(ctx.indexAutoTile(c, 1, 1), 1 + 8, 'le coin bottom-droit n a que haut et gauche');
});

test('DEUX MATERIAUX voisins montrent CHACUN son edge', () => {
  const ctx = contexte();
  // Un voisin n'est pas « une case pleine », c'est « une case du même matériau ». Sinon la
  // pierre et le bois se fondraient l'un dans l'autre, sans joint.
  const c = ctx.mapFromText('#=', LEGENDE, 0.5);
  assert.equal(ctx.indexAutoTile(c, 0, 0), 0, 'la pierre est isolée du bois');
  assert.equal(ctx.indexAutoTile(c, 1, 0), 0, 'et réciproquement');
  assert.equal(ctx.indexAutoTile(c, 5, 5), -1, 'hors map : pas de tile du tout');
});

test('LES OBSTACLES SONT DANS LE BON SENS — l axe Y de la grille descend, celui du monde monte', () => {
  const ctx = contexte();
  // Le défaut silencieux de toute tilemap : la grille se lit de haut en bas, le monde se count
  // de bottom en haut. Un signe oublié retourne le niveau — ce qui se voit — mais un demi-pas
  // oublié décale tout d'une demi-tile, ce qui ne se voit pas et fait « accrocher » le sol.
  const c = ctx.mapFromText(['..', '##'].join('\n'), LEGENDE, 0.5);
  const obs = ctx.obstaclesTilemap(c, ctx.bandsCollision(c));
  assert.equal(obs.length, 1);
  const o = obs[0];
  // La rangée 1 (la seconde) occupe le monde de y = −1 à y = −0,5 : centre −0,75, demi-height 0,25.
  assert.ok(Math.abs(o.y - (-0.75)) < 1e-9, 'centre en y = ' + o.y + ', −0,75 attendu');
  assert.ok(Math.abs(o.dh - 0.25) < 1e-9, 'demi-height ' + o.dh + ', 0,25 attendue');
  assert.ok(Math.abs(o.x - 0.5) < 1e-9, 'centre en x = ' + o.x + ', 0,5 attendu');
  assert.ok(Math.abs(o.dl - 0.5) < 1e-9);
  assert.equal(o.statique, true);
  assert.equal(o.rolloff, false, 'une bande de tuiles n est jamais une pente');
});

test('une tuile PLATEFORME donne des obstacles traversables', () => {
  const ctx = contexte();
  const c = ctx.mapFromText('==', LEGENDE, 0.5);
  const tiles = [{spriteId: 'pierre', collision: 'solid'}, {spriteId: 'sheet', collision: 'platform'}];
  const obs = ctx.obstaclesTilemap(c, ctx.collidingBands(c, tiles), tiles);
  assert.equal(obs.length, 1);
  assert.equal(obs[0].traversable, true, 'sans ça la plateforme à sens unique devient un mur');
});

test('L ORIGINE deplace la map entiere, obstacles compris', () => {
  const ctx = contexte();
  const c = ctx.mapFromText('#', LEGENDE, 0.5);
  c.originX = 10; c.originY = 4;
  const o = ctx.obstaclesTilemap(c, ctx.bandsCollision(c))[0];
  assert.ok(Math.abs(o.x - 10.25) < 1e-9, 'x = ' + o.x);
  assert.ok(Math.abs(o.y - 3.75) < 1e-9, 'y = ' + o.y);
});

test('LE PLAN EN TEXTE fait l aller-retour sans rien perdre', () => {
  const ctx = contexte();
  // C'est la shape sous laquelle une salle se relit, se corrige — et celle qu'une IA produit
  // naturellement. Un aller-retour qui perd une case rendrait le copilote inutilisable, et le
  // défaut se verrait comme un trou dans le décor.
  const plan = ['#.......#', '#...=...#', '#.......#', '#########'].join('\n');
  const c = ctx.mapFromText(plan, LEGENDE, 0.5);
  assert.equal(c.width, 9);
  assert.equal(c.height, 4);
  assert.equal(ctx.textFromMap(c, LEGENDE), plan);
  // Les lignes plus courtes sont complétées par du vide, pas rognées : un plan écrit à la main
  // a rarement toutes ses lignes de la même longueur.
  const court = ctx.mapFromText(['###', '#'].join('\n'), LEGENDE, 0.5);
  assert.equal(court.width, 3);
  assert.equal(ctx.cellTilemap(court, 2, 1), 0);
  assert.equal(ctx.cellTilemap(court, 0, 1), 1);

  // Et la largeur se prend sur la ligne LA PLUS LONGUE, pas sur la première. C'est le cas
  // current et pas le cas tordu : la rangée du haut d'une salle est presque toujours la plus
  // empty, donc la plus courte une fois écrite. La prendre pour référence rognerait toute la
  // salle à sa largeur — et le sol disparaîtrait sans qu'aucune erreur ne soit levée.
  const hautVide = ctx.mapFromText(['#', '#####'].join('\n'), LEGENDE, 0.5);
  assert.equal(hautVide.width, 5, 'width ' + hautVide.width + ', 5 attendue');
  assert.equal(ctx.cellTilemap(hautVide, 4, 1), 1, 'la end du sol ne doit pas avoir été rognée');
});

test('une LIGNE VIDE EN FIN de plan n ajoute pas de rangee', () => {
  const ctx = contexte();
  // Un texte se termine presque toujours par un retour à la ligne. Le compter donnerait une
  // rangée vide de plus, donc une salle plus haute d'une tile que ce qu'on a dessiné.
  const c = ctx.mapFromText('##\n##\n', LEGENDE, 0.5);
  assert.equal(c.height, 2, 'height ' + c.height + ', 2 attendue');
});

test('setCellTilemap dit s il s est passe quelque chose, et refuse le hors-map', () => {
  const ctx = contexte();
  const c = ctx.mapEmpty(3, 3, 0.5);
  assert.equal(ctx.setCellTilemap(c, 1, 1, 1), true);
  assert.equal(ctx.setCellTilemap(c, 1, 1, 1), false, 'reposer la même valeur ne change rien');
  assert.equal(ctx.setCellTilemap(c, 9, 0, 1), false, 'hors map : refusé, pas une exception');
  assert.equal(ctx.setCellTilemap(c, -1, 0, 1), false);
  assert.equal(ctx.cellTilemap(c, 1, 1), 1);
});

test('validateTilemap NOMME ce qui laisse des trous', () => {
  const ctx = contexte();
  const c = ctx.mapFromText('#=', LEGENDE, 0.5);
  // La tuile 2 est désignée par une case mais absente de la palette.
  const p = ctx.validateTilemap(c, ['connu'], [{spriteId: 'connu'}]);
  assert.ok(p.some((m) => m.includes('n\'existe pas')), 'une case sans tuile doit être nommée');
  const c2 = ctx.mapFromText('#', LEGENDE, 0.5);
  assert.ok(ctx.validateTilemap(c2, ['connu'], [{spriteId: 'parti'}]).some((m) => m.includes('n\'existe plus')));
  // Sans palette, le dire — et pas « aucun matériau », que le validateur signalait sur TOUTE
  // map réelle quand il lisait encore `map.materials`.
  assert.ok(ctx.validateTilemap(c2, ['connu'], null).some((m) => m.includes('Aucune palette')));
  const bon = ctx.mapFromText('#', LEGENDE, 0.5);
  assert.deepEqual(hote(ctx.validateTilemap(bon, ['connu'], [{spriteId: 'connu'}])), [],
    'une map correcte ne doit RIEN signaler');
});

test('LA GEOMETRIE ne fait QUATRE SOMMETS que par case PLEINE', () => {
  const ctx = contexte();
  // Un faux three, juste assez pour compter : ce qui est en cause est le number de sommets et
  // d index, pas le moteur de rendu.
  const T = {
    BufferGeometry: function(){ this.attributes = {}; this.index = null;
      this.setAttribute = function(n, a){ this.attributes[n] = a; };
      this.setIndex = function(i){ this.index = i; };
      this.computeBoundingSphere = function(){}; },
    Float32BufferAttribute: function(tab, size){ this.array = tab; this.itemSize = size; }
  };
  const c = ctx.mapFromText(['#.#', '.#.'].join('\n'), LEGENDE, 0.5);
  const region = {x: 0, y: 0, l: 8, h: 8};
  const g = ctx.geometryTilemap(T, c, () => region, 32, 32);
  assert.equal(g.attributes.position.array.length, 3 * 4 * 3, '3 cases pleines × 4 sommets × 3');
  assert.equal(g.index.length, 3 * 6, '3 cases × 2 triangles × 3 index');
  // Une case dont la région est introuvable est SAUTÉE, pas affichée n importe comment.
  const g2 = ctx.geometryTilemap(T, c, (x) => (x === 0 ? null : region), 32, 32);
  assert.equal(g2.attributes.position.array.length, 2 * 4 * 3, 'la case sans région est sautée');
  // Une map entièrement empty rend null : une géométrie sans sommet fait tomber le calcul de
  // sa boîte englobante, et three la traite alors comme toujours visible, ou jamais.
  assert.equal(ctx.geometryTilemap(T, ctx.mapEmpty(4, 4, 0.5), () => region, 32, 32), null);
});

// ---------- Le brush : l'aller et le retour doivent être inverses ----------

test('LE DESSIN ET LA COLLISION COINCIDENT, origine non nulle comprise', () => {
  const ctx = contexte();
  const T = {
    BufferGeometry: function(){ this.attributes = {}; this.index = null;
      this.setAttribute = function(n, a){ this.attributes[n] = a; };
      this.setIndex = function(i){ this.index = i; };
      this.computeBoundingSphere = function(){}; },
    Float32BufferAttribute: function(tab, size){ this.array = tab; this.itemSize = size; }
  };
  // Défaut mesuré : `obstaclesTilemap` appliquait l'origine, `geometryTilemap` ne l'appliquait
  // PAS. Une map d'origine non nulle dessinait ses tuiles à un endroit et posait ses boîtes de
  // collision à un autre — et rien dans l'interface ne rendait l'origine non nulle, donc le défaut
  // attendait le premier qui s'en servirait. Ici on compare les deux CENTRES.
  for(const [ox, oy] of [[0, 0], [10, 4], [-3.5, 2.25]]){
    const c = ctx.mapFromText('.#.', LEGENDE, 0.5);
    c.originX = ox; c.originY = oy;
    const g = ctx.geometryTilemap(T, c, () => ({x: 0, y: 0, l: 8, h: 8}), 32, 32);
    const p = g.attributes.position.array;
    // Les 4 sommets de l'unique case pleine : centre = moyenne.
    let cx = 0, cy = 0;
    for(let i = 0; i < 4; i++){ cx += p[i * 3]; cy += p[i * 3 + 1]; }
    cx /= 4; cy /= 4;
    const obs = ctx.obstaclesTilemap(c, ctx.bandsCollision(c));
    assert.equal(obs.length, 1, 'une seule case pleine attendue');
    assert.ok(Math.abs(obs[0].x - cx) < 1e-9,
      'origine ' + ox + ',' + oy + ' : la maille est en x=' + cx + ', la collision en x=' + obs[0].x);
    assert.ok(Math.abs(obs[0].y - cy) < 1e-9,
      'origine ' + ox + ',' + oy + ' : la maille est en y=' + cy + ', la collision en y=' + obs[0].y);
    // Et le CENTRE calculé par centerCellTilemap doit être le même : c'est lui que le brush
    // inverse, donc s'il dérive, le brush peint à côté.
    const center = ctx.centerCellTilemap(c, 1, 0);
    assert.ok(Math.abs(center.x - cx) < 1e-9 && Math.abs(center.y - cy) < 1e-9,
      'centerCellTilemap dérive de la maille');
  }
});

test('cellSubPoint est L INVERSE EXACT de centerCellTilemap, sur toute la grille', () => {
  const ctx = contexte();
  // C'est le test qui protège le brush. Une inversion qui dérive d'une demi-case peint la case du
  // dessus, et l'utilisateur en conclut que la grille est décalée — on chercherait alors du côté du
  // rendu, où il n'y a rien.
  for(const [tile, ox, oy] of [[0.5, 0, 0], [1, 10, 4], [0.25, -3.5, 2.25], [2, 7, -7]]){
    const c = ctx.mapEmpty(9, 7, tile);
    c.originX = ox; c.originY = oy;
    for(let y = 0; y < c.height; y++){
      for(let x = 0; x < c.width; x++){
        const p = ctx.centerCellTilemap(c, x, y);
        const r = ctx.cellSubPoint(c, p.x, p.y);
        assert.deepEqual(hote(r), {x, y},
          'tile ' + tile + ' origine ' + ox + ',' + oy + ' : centre de (' + x + ',' + y + ') rendu ' + JSON.stringify(r));
        // Et juste à l'intérieur des deux coins de la case : le bord ne doit pas basculer trop tôt.
        const e = tile * 0.49;
        assert.deepEqual(hote(ctx.cellSubPoint(c, p.x - e, p.y + e)), {x, y}, 'coin haut-gauche');
        assert.deepEqual(hote(ctx.cellSubPoint(c, p.x + e, p.y - e)), {x, y}, 'coin bottom-droit');
      }
    }
    // HORS grid : `null`, et pas une case rabattue sur le bord. Rabattre ferait paint une
    // colonne entière quand on relâche à côté de la map.
    assert.equal(ctx.cellSubPoint(c, ox - tile / 2, oy - tile / 2), null, 'a gauche');
    assert.equal(ctx.cellSubPoint(c, ox + tile / 2, oy + tile / 2), null, 'au dessus');
    assert.equal(ctx.cellSubPoint(c, ox + (c.width + 0.5) * tile, oy - tile / 2), null, 'a droite');
    assert.equal(ctx.cellSubPoint(c, ox + tile / 2, oy - (c.height + 0.5) * tile), null, 'en dessous');
  }
});

test('un TRAIT ne laisse pas de trou, meme quand la souris saute des cases', () => {
  const ctx = contexte();
  // Une souris ne livre pas toutes les positions par lesquelles elle pass : à speed normale elle
  // saute trois ou quatre cases. Peindre seulement les cases reçues laisse un pointillé, et
  // l'utilisateur en conclut que le brush rate.
  const pts = ctx.strokeTilemap(0, 0, 9, 4);
  assert.deepEqual(hote(pts[0]), {x: 0, y: 0});
  assert.deepEqual(hote(pts[pts.length - 1]), {x: 9, y: 4});
  // CONTINU : deux cases consécutives sont voisines (8-connexité), donc aucun trou.
  for(let i = 1; i < pts.length; i++){
    const d = Math.max(Math.abs(pts[i].x - pts[i-1].x), Math.abs(pts[i].y - pts[i-1].y));
    assert.equal(d, 1, 'saut de ' + d + ' cases entre ' + JSON.stringify(pts[i-1]) + ' et ' + JSON.stringify(pts[i]));
  }
  // Un trait sur place rend UNE case, pas zéro : cliquer sans move doit paint.
  assert.equal(ctx.strokeTilemap(3, 3, 3, 3).length, 1);
  // Et dans l'autre sens, le même trait à l'envers.
  const inv = ctx.strokeTilemap(9, 4, 0, 0);
  assert.equal(inv.length, pts.length);
});

test('le RECTANGLE se tire dans les quatre sens et compte ce qu il change', () => {
  const ctx = contexte();
  const c = ctx.mapEmpty(10, 10, 0.5);
  // Les deux coins dans n'importe quel order : on tire de bottom en haut aussi souvent que l'inverse.
  assert.equal(ctx.setRectTilemap(c, 5, 5, 2, 2, 1), 16, '4 × 4 cases');
  assert.equal(ctx.cellTilemap(c, 2, 2), 1);
  assert.equal(ctx.cellTilemap(c, 5, 5), 1);
  assert.equal(ctx.cellTilemap(c, 6, 5), 0, 'rien au dela du coin');
  // Repasser le MÊME rectangle ne change plus rien : c'est ce qui permet de ne redessiner que si
  // besoin, et donc de tirer un rectangle sans reconstruire la maille à chaque pixel de mouse.
  assert.equal(ctx.setRectTilemap(c, 2, 2, 5, 5, 1), 0);
  // Débordant : les cases hors grille sont ignorées, les autres posées.
  assert.equal(ctx.setRectTilemap(c, 8, 8, 12, 12, 2), 4, 'seules les 2 × 2 cases dans la grille');
});

test('REDIMENSIONNER une map GARDE ce qui tient encore', () => {
  const ctx = contexte();
  const c = ctx.mapFromText(['##.', '.#.', '..#'].join('\n'), LEGENDE, 0.5);
  ctx.resizeMap(c, 5, 5);
  assert.equal(c.width, 5); assert.equal(c.height, 5);
  assert.equal(c.cells.length, 25, 'le tableau doit suivre la taille, sinon tout se décale');
  // Le contenu est au même endroit : le coin haut-gauche est l'anchor.
  assert.equal(ctx.cellTilemap(c, 0, 0), 1);
  assert.equal(ctx.cellTilemap(c, 1, 1), 1);
  assert.equal(ctx.cellTilemap(c, 2, 2), 1);
  assert.equal(ctx.cellTilemap(c, 4, 4), 0, 'la place gagnée est vide');
  // En RÉTRÉCISSANT, ce qui sort est perdu — mais ce qui reste ne bouge pas d'une case.
  ctx.resizeMap(c, 2, 2);
  assert.equal(c.cells.length, 4);
  assert.equal(ctx.cellTilemap(c, 0, 0), 1);
  assert.equal(ctx.cellTilemap(c, 1, 1), 1);
  // Et la map reste VALIDE : une longueur de tableau qui ne colle pas à l × h est justement ce
  // que validateTilemap surveille.
  assert.deepEqual(hote(ctx.validateTilemap(c, [])).filter((x) => x.includes('cases')), []);
});
test('TEXTURE FILTREE : les UV reculent d un demi-texel, sinon chaque joint dessine une couture', () => {
  const ctx = contexte();
  const T = {
    BufferGeometry: function(){ this.attributes = {};
      this.setAttribute = function(n, a){ this.attributes[n] = a; };
      this.setIndex = function(){}; this.computeBoundingSphere = function(){}; },
    Float32BufferAttribute: function(tab){ this.array = tab; }
  };
  const c = ctx.mapFromText('#', LEGENDE, 0.5);
  // L'eau de SkyStrike : la 2e image d'une planche 64×16, entre la crête et le sable.
  const region = {x: 16, y: 0, l: 16, h: 16};
  const exact = ctx.geometryTilemap(T, c, () => region, 64, 16).attributes.uv.array;
  assert.equal(exact[0], 16 / 64, 'en « near » (retrait 0), les UV sont exacts : pixel-perfect');
  const uv = ctx.geometryTilemap(T, c, () => region, 64, 16, 0.5).attributes.uv.array;
  assert.equal(uv[0], 16.5 / 64);
  assert.equal(uv[2], 31.5 / 64);
});
