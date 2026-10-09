// ---------- Fabriquer des pixels, sans graphiste ----------
//
// Le mur qui restait : le copilote pouvait DÉCOUPER une planche existante, jamais en créer une. Il ne
// savait donc assembler que de l'art déjà importé par un humain, et « conçois-me un jeu » butait sur
// l'absence du premier pixel. Mesuré sur un vrai game : dix-huit planches à fournir avant que
// l'éditeur puisse quoi que ce soit.
//
// Ce fichier rend des PIXELS, pas des images : `{l, h, px}` où `px` est un Uint8ClampedArray RGBA. Le
// dessin sur canvas et la création d'asset sont ailleurs (js/texture-proc-ui.js) — ici tout est pur, et
// c'est ce qui permet de vérifier une planche d'auto-tuilage bord par bord, sur les seize voisinages,
// sans ouvrir un navigateur.
//
// Le but n'est pas de remplacer un graphiste. C'est de rendre un niveau JOUABLE et LISIBLE tout de
// suite, pour que la boucle de conception tourne avant que l'art existe.

/** Une couleur, depuis '#rrggbb' ou '#rgb'. Rend [r, g, b, a]. */
export function colorProc(c, alpha){
  const s = String(c || '#ffffff').trim().replace('#', '');
  const h = (s.length === 3) ? s[0]+s[0]+s[1]+s[1]+s[2]+s[2] : s.padEnd(6, '0').slice(0, 6);
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha === undefined ? 255 : alpha];
}

/** Une toile de pixels empty (transparente). */
export function canvasProc(l, h){
  const L = Math.max(1, Math.round(l)), H = Math.max(1, Math.round(h));
  return {l: L, h: H, px: new Uint8ClampedArray(L * H * 4)};
}

export function setPixel(t, x, y, c){
  if(x < 0 || y < 0 || x >= t.l || y >= t.h) return;
  const i = (y * t.l + x) * 4;
  t.px[i] = c[0]; t.px[i+1] = c[1]; t.px[i+2] = c[2]; t.px[i+3] = c[3];
}

export function readPixel(t, x, y){
  if(x < 0 || y < 0 || x >= t.l || y >= t.h) return [0, 0, 0, 0];
  const i = (y * t.l + x) * 4;
  return [t.px[i], t.px[i+1], t.px[i+2], t.px[i+3]];
}

export function fillRect(t, x0, y0, l, h, c){
  for(let y = y0; y < y0 + h; y++) for(let x = x0; x < x0 + l; x++) setPixel(t, x, y, c);
}

/** Un aplat. */
export function textureSolid(l, h, color){
  const t = canvasProc(l, h);
  fillRect(t, 0, 0, t.l, t.h, colorProc(color));
  return t;
}

/** Un damier — la texture de repère par excellence : on y voit tout de suite l'échelle et l'étirement. */
export function textureChecker(l, h, size, colorA, colorB){
  const t = canvasProc(l, h);
  const p = Math.max(1, Math.round(size) || 8);
  const a = colorProc(colorA), b = colorProc(colorB);
  for(let y = 0; y < t.h; y++){
    for(let x = 0; x < t.l; x++){
      const pair = ((Math.floor(x / p) + Math.floor(y / p)) % 2) === 0;
      setPixel(t, x, y, pair ? a : b);
    }
  }
  return t;
}

/** Un dégradé vertical — un ciel, un fond de niveau. */
export function textureGradient(l, h, colorTop, colorBottom){
  const t = canvasProc(l, h);
  const a = colorProc(colorTop), b = colorProc(colorBottom);
  for(let y = 0; y < t.h; y++){
    const k = (t.h === 1) ? 0 : y / (t.h - 1);
    const c = [Math.round(a[0]+(b[0]-a[0])*k), Math.round(a[1]+(b[1]-a[1])*k),
               Math.round(a[2]+(b[2]-a[2])*k), 255];
    fillRect(t, 0, y, t.l, 1, c);
  }
  return t;
}

/**
 * Un bruit à GRAINE : deux appels avec la même graine donnent la même image.
 *
 * Sans graine, régénérer une texture donnerait un décor différent à chaque fois, et il serait
 * impossible de comparer deux versions d'un niveau — ni de reproduire un bug.
 */
export function textureNoise(l, h, colorA, colorB, seed){
  const t = canvasProc(l, h);
  const a = colorProc(colorA), b = colorProc(colorB);
  let g = (Math.round(Number(seed)) || 1) & 0x7fffffff;
  const next = function(){ g = (g * 1103515245 + 12345) & 0x7fffffff; return g / 0x7fffffff; };
  for(let y = 0; y < t.h; y++){
    for(let x = 0; x < t.l; x++){
      const k = next();
      setPixel(t, x, y, [Math.round(a[0]+(b[0]-a[0])*k), Math.round(a[1]+(b[1]-a[1])*k),
                           Math.round(a[2]+(b[2]-a[2])*k), 255]);
    }
  }
  return t;
}

// ---------- La planche d'auto-tuilage : LA pièce qui débloque un niveau ----------
//
// Le moteur attend SEIZE images dans une grille 4 × 4, lues de gauche à droite puis de haut en bas,
// et il choisit l'image par un index 4 bits : haut=1, droite=2, bottom=4, gauche=8, chaque bit disant
// « il y a un voisin du même matériau de ce côté ». La tile d'index `i` doit donc porter un bord
// dessiné sur chaque côté où le bit est À ZÉRO — c'est ce edge qui fait la silhouette du décor.
//
// C'est exactement ce que le test vérifie, côté par côté, sur les seize : se tromper d'un bit produit
// un décor dont les contours apparaissent au milieu des blocs, et on accuse l'auto-tuilage.

export const TILE_TOP = 1, TILE_RIGHT = 2, TILE_BOTTOM = 4, TILE_LEFT = 8;

/**
 * Une planche de 16 tuiles, prête pour l'auto-tuilage.
 *
 * `size` : côté d'une tile en pixels. `body` : la couleur pleine. `edge` : la couleur du contour.
 * `epaisseur` : épaisseur du contour, en pixels.
 */
export function sheet16Tiles(size, body, edge, thickness){
  const p = Math.max(4, Math.round(size) || 16);
  const e = Math.max(1, Math.min(Math.floor(p / 3), Math.round(thickness) || Math.max(1, Math.round(p / 8))));
  const t = canvasProc(p * 4, p * 4);
  const cBody = colorProc(body || '#6b7280');
  const cEdge = colorProc(edge || '#2a3038');
  for(let i = 0; i < 16; i++){
    const ox = (i % 4) * p, oy = Math.floor(i / 4) * p;
    fillRect(t, ox, oy, p, p, cBody);
    // Un edge là où il n'y a PAS de voisin. La lecture des bits est l'inverse de l'intuition : le bit
    // dit « voisin présent », donc le bord se dessine quand il est absent.
    if(!(i & TILE_TOP))   fillRect(t, ox, oy, p, e, cEdge);
    if(!(i & TILE_BOTTOM))    fillRect(t, ox, oy + p - e, p, e, cEdge);
    if(!(i & TILE_LEFT)) fillRect(t, ox, oy, e, p, cEdge);
    if(!(i & TILE_RIGHT)) fillRect(t, ox + p - e, oy, e, p, cEdge);
  }
  return t;
}

/**
 * Une planche de personnage : `nb` images d'un bonhomme qui se déplace verticalement.
 *
 * Volontairement rudimentaire, et volontairement LISIBLE : ce qu'on veut d'un substitut, c'est voir
 * que l'animation joue, dans quel sens, et à quelle cadence. Un placeholder joli ferait oublier qu'il
 * faut le remplacer.
 *
 * Le body est décalé d'un pixel vers le haut puis vers le bas au fil des images — de quoi voir la
 * cadence à l'œil, ce qu'un aplat immobile ne montrerait pas.
 */
export function sheetCharacter(cell, nb, body, accent){
  const p = Math.max(8, Math.round(cell) || 32);
  const n = Math.max(1, Math.min(16, Math.round(nb) || 4));
  const t = canvasProc(p * n, p);
  const c = colorProc(body || '#d9a05b');
  const a = colorProc(accent || '#2a3038');
  for(let i = 0; i < n; i++){
    const ox = i * p;
    // Une oscillation d'une image sur deux : visible sans être une animation prétentieuse.
    const dy = (i % 2 === 0) ? 0 : Math.max(1, Math.round(p / 16));
    const larg = Math.round(p * 0.44), top = Math.round(p * 0.52);
    const x = ox + Math.round((p - larg) / 2), y = Math.round(p * 0.40) + dy;
    fillRect(t, x, y, larg, top, c);                                   // le body
    const rTete = Math.round(p * 0.30);
    fillRect(t, ox + Math.round((p - rTete) / 2), y - rTete, rTete, rTete, c);   // la tête
    // Deux yeux : c'est ce qui donne un SENS de marche, et donc ce qui rend visible un retournement.
    const oe = Math.max(1, Math.round(p / 16));
    fillRect(t, ox + Math.round(p * 0.42), y - Math.round(rTete * 0.6), oe, oe, a);
    fillRect(t, ox + Math.round(p * 0.56), y - Math.round(rTete * 0.6), oe, oe, a);
  }
  return t;
}

/** Les problèmes d'une demande de texture, en clair. */

// ---------------------------------------------------------------------------------------------
// LE TEXTE — une police MATRICIELLE, et pas un canvas.
//
// Ce module ne dessine que dans un tampon de pixels : c'est ce qui le rend lisible par un test
// sans navigateur, et cette pureté a plus de valeur qu'un `fillText`. Une police 5 × 7 tracée à la
// main y suffit largement pour ce dont un jeu a besoin ici — un chiffre sur un cube, une étiquette
// sur un panneau, un score. Elle est nette à toute échelle entière, ce qu'aucune police vectorielle
// ne garantit sur une texture filtrée « au plus proche ».
//
// Chaque glyphe est 7 rangées de 5 bits, le bit de poids fort à GAUCHE.
// ---------------------------------------------------------------------------------------------
export const FONT_PROC = {
  '0':[0x0E,0x11,0x13,0x15,0x19,0x11,0x0E], '1':[0x04,0x0C,0x04,0x04,0x04,0x04,0x0E],
  '2':[0x0E,0x11,0x01,0x02,0x04,0x08,0x1F], '3':[0x1F,0x02,0x04,0x02,0x01,0x11,0x0E],
  '4':[0x02,0x06,0x0A,0x12,0x1F,0x02,0x02], '5':[0x1F,0x10,0x1E,0x01,0x01,0x11,0x0E],
  '6':[0x06,0x08,0x10,0x1E,0x11,0x11,0x0E], '7':[0x1F,0x01,0x02,0x04,0x08,0x08,0x08],
  '8':[0x0E,0x11,0x11,0x0E,0x11,0x11,0x0E], '9':[0x0E,0x11,0x11,0x0F,0x01,0x02,0x0C],
  'A':[0x0E,0x11,0x11,0x1F,0x11,0x11,0x11], 'B':[0x1E,0x11,0x11,0x1E,0x11,0x11,0x1E],
  'C':[0x0E,0x11,0x10,0x10,0x10,0x11,0x0E], 'D':[0x1C,0x12,0x11,0x11,0x11,0x12,0x1C],
  'E':[0x1F,0x10,0x10,0x1E,0x10,0x10,0x1F], 'F':[0x1F,0x10,0x10,0x1E,0x10,0x10,0x10],
  'G':[0x0E,0x11,0x10,0x17,0x11,0x11,0x0F], 'H':[0x11,0x11,0x11,0x1F,0x11,0x11,0x11],
  'I':[0x0E,0x04,0x04,0x04,0x04,0x04,0x0E], 'J':[0x07,0x02,0x02,0x02,0x02,0x12,0x0C],
  'K':[0x11,0x12,0x14,0x18,0x14,0x12,0x11], 'L':[0x10,0x10,0x10,0x10,0x10,0x10,0x1F],
  'M':[0x11,0x1B,0x15,0x15,0x11,0x11,0x11], 'N':[0x11,0x11,0x19,0x15,0x13,0x11,0x11],
  'O':[0x0E,0x11,0x11,0x11,0x11,0x11,0x0E], 'P':[0x1E,0x11,0x11,0x1E,0x10,0x10,0x10],
  'Q':[0x0E,0x11,0x11,0x11,0x15,0x12,0x0D], 'R':[0x1E,0x11,0x11,0x1E,0x14,0x12,0x11],
  'S':[0x0F,0x10,0x10,0x0E,0x01,0x01,0x1E], 'T':[0x1F,0x04,0x04,0x04,0x04,0x04,0x04],
  'U':[0x11,0x11,0x11,0x11,0x11,0x11,0x0E], 'V':[0x11,0x11,0x11,0x11,0x11,0x0A,0x04],
  'W':[0x11,0x11,0x11,0x15,0x15,0x1B,0x11], 'X':[0x11,0x11,0x0A,0x04,0x0A,0x11,0x11],
  'Y':[0x11,0x11,0x0A,0x04,0x04,0x04,0x04], 'Z':[0x1F,0x01,0x02,0x04,0x08,0x10,0x1F],
  ' ':[0,0,0,0,0,0,0],                      '+':[0x00,0x04,0x04,0x1F,0x04,0x04,0x00],
  '-':[0x00,0x00,0x00,0x1F,0x00,0x00,0x00], '=':[0x00,0x00,0x1F,0x00,0x1F,0x00,0x00],
  '.':[0x00,0x00,0x00,0x00,0x00,0x0C,0x0C], '!':[0x04,0x04,0x04,0x04,0x04,0x00,0x04],
  '?':[0x0E,0x11,0x01,0x02,0x04,0x00,0x04], '*':[0x00,0x11,0x0A,0x04,0x0A,0x11,0x00]
};
export const FONT_L = 5, FONT_H = 7, FONT_ESP = 1;

/** Le texte tel qu'il sera tracé : majuscules, et les caractères absents remplacés par « ? ». */
export function normalizeTextProc(text){
  return String(text === undefined || text === null ? '' : text).toUpperCase()
    .split('').map(function(c){ return FONT_PROC[c] ? c : '?'; }).join('');
}

/**
 * Le plus grand grossissement ENTIER qui tient dans la place, marge comprise.
 *
 * Entier, et jamais fractionnaire : un grossissement de 2,5 rendrait une rangée de pixels sur deux
 * plus épaisse que sa voisine, et le chiffre paraîtrait mal dessiné plutôt que petit.
 */
export function scaleTextProc(l, h, countChars, margin){
  const m = Math.max(0, Number(margin) || 0);
  const dispoL = l - 2 * m, dispoH = h - 2 * m;
  const widthText = Math.max(1, countChars) * (FONT_L + FONT_ESP) - FONT_ESP;
  return Math.max(1, Math.floor(Math.min(dispoL / widthText, dispoH / FONT_H)));
}

/**
 * Un texte centré sur un aplat — un chiffre sur un cube, une étiquette sur un panneau.
 *
 * Le texte est CENTRÉ et mis à l'échelle tout seul : demander la taille de police à l'auteur
 * l'obligerait à la recalculer à chaque changement de texte, et « 2 » puis « 2048 » ne peuvent pas
 * avoir la même taille sur une face de cube.
 */
export function textureText(l, h, text, colorFond, colorText, margin){
  const t = canvasProc(l, h);
  const fond = colorProc(colorFond || '#ffffff');
  const encre = colorProc(colorText || '#000000');
  fillRect(t, 0, 0, t.l, t.h, fond);
  const s = normalizeTextProc(text);
  if(!s.length) return t;
  const e = scaleTextProc(t.l, t.h, s.length, margin === undefined ? Math.round(t.l * 0.12) : margin);
  const width = s.length * (FONT_L + FONT_ESP) * e - FONT_ESP * e;
  const x0 = Math.round((t.l - width) / 2), y0 = Math.round((t.h - FONT_H * e) / 2);
  s.split('').forEach(function(c, i){
    const g = FONT_PROC[c];
    const ox = x0 + i * (FONT_L + FONT_ESP) * e;
    for(let r = 0; r < FONT_H; r++){
      for(let b = 0; b < FONT_L; b++){
        // bit de poids fort à GAUCHE : le glyphe se lit comme il s'écrit
        if(!(g[r] & (1 << (FONT_L - 1 - b)))) continue;
        fillRect(t, ox + b * e, y0 + r * e, e, e, encre);
      }
    }
  });
  return t;
}

export function validateTextureProc(d){
  const p = [];
  const genres = ['solid', 'checker', 'gradient', 'noise', 'tuiles16', 'character', 'text'];
  if(!d || genres.indexOf(d.kind) === -1){
    p.push('Genre de texture inconnu : « ' + (d && d.kind) + ' ». Attendu ' + genres.join(', ') + '.');
    return p;
  }
  const l = Number(d.width) || 0, h = Number(d.height) || 0;
  if(d.kind !== 'tuiles16' && d.kind !== 'character'){
    if(!(l > 0) || !(h > 0)) p.push('Il faut une largeur et une hauteur en pixels.');
    // 4096 : au-delà, la texture pèse plus lourd que tout le reste du jeu, et une map graphique
    // ancienne la refuse. Un substitut n'a aucune raison d'être grand.
    if(l > 4096 || h > 4096) p.push('Une texture de substitut au-delà de 4096 px n\'a pas de sens.');
  }
  if(d.kind === 'tuiles16' && !(Number(d.size) > 0)){
    p.push('Une planche de tuiles a besoin de la taille d\'une tuile, en pixels (16, 32…).');
  }
  // Un texte VIDE donnerait un aplat muet : l auteur croirait avoir ecrit quelque chose.
  // Des ESPACES ne comptent pas : «    » passait la validation et rendait un aplat muet,
  // impossible a distinguer d une texture unie. L auteur croirait avoir ecrit quelque chose.
  if(d.kind === 'text' && !normalizeTextProc(d.text).replace(/ /g, '').length){
    p.push('Une texture de texte a besoin d un texte. Caracteres connus : chiffres, A-Z, espace, + - = . ! ? *.');
  }
  if(d.kind === 'character' && !(Number(d.cell) > 0)){
    p.push('Une planche de personnage a besoin de la taille d\'une image, en pixels.');
  }
  return p;
}

/** Fabrique la toile décrite. Rend `null` si la demande est invalide. */
export function makeTextureProc(d){
  if(validateTextureProc(d).length) return null;
  const l = Math.round(Number(d.width) || 0), h = Math.round(Number(d.height) || 0);
  if(d.kind === 'solid')      return textureSolid(l, h, d.color);
  if(d.kind === 'checker')    return textureChecker(l, h, d.size, d.color, d.color2);
  if(d.kind === 'gradient')   return textureGradient(l, h, d.color, d.color2);
  if(d.kind === 'noise')     return textureNoise(l, h, d.color, d.color2, d.seed);
  if(d.kind === 'tuiles16')  return sheet16Tiles(d.size, d.color, d.color2, d.thickness);
  if(d.kind === 'character') return sheetCharacter(d.cell, d.images, d.color, d.color2);
  if(d.kind === 'text')      return textureText(l, h, d.text, d.color, d.color2, d.margin);
  return null;
}
