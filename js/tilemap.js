// ---------- Tilemap 2D : la grille, l'auto-tuilage et les bands de collision ----------
//
// Trois décisions tiennent ce fichier, et la troisième est celle qui rend la chose utilisable :
//
//   1. UNE MAILLE PAR CARTE, pas un objet par tile. Une salle de 48 × 27 fait 1 296 tuiles ;
//      1 296 objets, c'est 1 296 matrices à composer et autant d'appels de rendu.
//   2. L'AUTO-TUILAGE se décide sur les quatre voisins — haut = 1, droite = 2, bottom = 4,
//      gauche = 8 — et un voisin est une case du MÊME matériau. Deux matériaux qui se touchent
//      montrent donc chacun son edge, ce qui est ce qu'on veut voir.
//   3. LES COLLISIONS SE REGROUPENT EN BANDES. C'est le point. Sans regroupement, le solveur
//      teste le personnage contre 1 296 boîtes à chaque image ; avec, un sol plat de 48 cases
//      devient UNE boîte. Le gain n'est pas un raffinement : c'est la différence entre un
//      platformer et un diaporama.
//
// PUR : ni three ni DOM, sauf `geometryTilemap` qui reçoit THREE en ARGUMENT — même convention
// que sprite-2d.js, pour que le calcul reste éprouvable sans moteur de rendu.
//
// Les PENTES ne sont pas des tuiles : elles se posent en objets, avec leur propre collider. Une
// pente dans une grille obligerait à décrire une géométrie par case, et l'auto-tuilage n'aurait
// plus de sens sur ses bords.
//
// Voir docs/superpowers/specs/2026-08-16-game-maree-design.md, phase 3.

export const TILEMAP_EMPTY = 0;

/**
 * (colonne, ligne) de la grille → position monde, selon le plan de la tilemap.
 *
 * C'est cette seule fonction qui rend une tilemap utilisable ailleurs que dans le plan de
 * l'écran : `xz` la pose à plat au sol, ce qui est le décor d'un jeu vu de dessus en 3D.
 */
export function projectCell(plane, x, y, cellSize){
  const u = x * cellSize, v = y * cellSize;
  if(plane === 'xz') return { x: u, y: 0, z: -v };
  if(plane === 'yz') return { x: 0, y: v, z: -u };
  return { x: u, y: v, z: 0 };
}

/** Position monde → (colonne, ligne), l'inverse de `projectCell`. */
export function cellFromWorld(plane, p, cellSize){
  const t = Number(cellSize) || 0.5;
  // L'axe des LIGNES descend : une ligne de plus, c'est un cran plus bas à l'écran (ou plus
  // loin au sol en `xz`). Le `-` est ce qui fait tenir l'aller et le retour ensemble.
  if(plane === 'xz') return { x: Math.floor(p.x / t), y: Math.floor(-p.z / t) };
  if(plane === 'yz') return { x: Math.floor(-p.z / t), y: Math.floor(-p.y / t) };
  return { x: Math.floor(p.x / t), y: Math.floor(-p.y / t) };
}

/**
 * Encodage par plages : une grille de 32×18 majoritairement vide passe de 576 entiers à une
 * poignée de paires. Sans lui, chaque map pèse le fichier de projet pour rien.
 */
export function encodeCells(cells){
  const out = [];
  let i = 0;
  while(i < cells.length){
    const v = cells[i] || 0;
    let n = 1;
    while(i + n < cells.length && (cells[i + n] || 0) === v) n++;
    out.push(v, n);
    i += n;
  }
  return out;
}

export function decodeCells(rle, size){
  const out = new Array(size).fill(0);
  let i = 0;
  for(let k = 0; k + 1 < rle.length; k += 2){
    const v = rle[k], n = rle[k + 1];
    for(let j = 0; j < n && i < size; j++, i++) out[i] = v;
  }
  return out;
}

/** Une map vide : `cells` est un tableau plat, lu en `y * width + x`, 0 = vide. */
export function mapEmpty(width, height, cellSize){
  const L = Math.max(1, Math.round(Number(width) || 1));
  const H = Math.max(1, Math.round(Number(height) || 1));
  return {width: L, height: H, cellSize: Number(cellSize) || 0.5, originX: 0, originY: 0,
          cells: new Array(L * H).fill(TILEMAP_EMPTY)};
}

/** La case (x, y), ou 0 hors de la map. */
export function cellTilemap(map, x, y){
  if(!map) return TILEMAP_EMPTY;
  if(x < 0 || y < 0 || x >= map.width || y >= map.height) return TILEMAP_EMPTY;
  return map.cells[y * map.width + x] || TILEMAP_EMPTY;
}

/** Pose une case. Rend vrai si quelque chose a changé — de quoi ne redessiner que si besoin. */
export function setCellTilemap(map, x, y, v){
  if(!map || x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
  const i = y * map.width + x;
  const n = Math.max(0, Math.round(Number(v) || 0));
  if(map.cells[i] === n) return false;
  map.cells[i] = n;
  return true;
}

/**
 * L'index d'auto-tuilage d'une case : 0 à 15, somme des voisins du MÊME matériau.
 *
 * Hors de la map count comme VIDE, donc comme un bord exposé. C'est le bon choix pour un jeu
 * en salles : le bord de la salle est un mur qu'on voit, et le traiter comme plein dessinerait
 * une coupe franche là où le joueur attend une arête.
 */
export function indexAutoTile(map, x, y){
  const m = cellTilemap(map, x, y);
  if(m === TILEMAP_EMPTY) return -1;
  return (cellTilemap(map, x, y - 1) === m ? 1 : 0)
       + (cellTilemap(map, x + 1, y) === m ? 2 : 0)
       + (cellTilemap(map, x, y + 1) === m ? 4 : 0)
       + (cellTilemap(map, x - 1, y) === m ? 8 : 0);
}

/**
 * LES 47 MASQUES DU « BLOB » (auto-tuilage 8 voisins), triés par valeur croissante. Bits :
 * N=1, NE=2, E=4, SE=8, S=16, SO=32, O=64, NO=128. Un coin ne compte que si ses DEUX côtés
 * adjacents sont du même matériau — sinon il ne change rien à l'image, et 256 masques se
 * réduisent à 47. L'image n° k d'une planche blob dessine le masque BLOB_MASKS[k].
 */
export const BLOB_MASKS = (function(){
  const out = [];
  for(let m = 0; m < 256; m++){
    const n = m & 1, e = m & 4, s = m & 16, w = m & 64;
    if((m & 2) && !(n && e)) continue;
    if((m & 8) && !(s && e)) continue;
    if((m & 32) && !(s && w)) continue;
    if((m & 128) && !(n && w)) continue;
    out.push(m);
  }
  return out;
})();
const BLOB_INDEX = (function(){ const t = {}; BLOB_MASKS.forEach(function(m, i){ t[m] = i; }); return t; })();

/** L'index blob d'une case (0 à 46, voir BLOB_MASKS), -1 si elle est vide. Hors map = vide. */
export function indexBlobTile(map, x, y){
  const m = cellTilemap(map, x, y);
  if(m === TILEMAP_EMPTY) return -1;
  const same = function(dx, dy){ return cellTilemap(map, x + dx, y + dy) === m; };
  const n = same(0, -1), e = same(1, 0), s = same(0, 1), w = same(-1, 0);
  const mask = (n ? 1 : 0) + (n && e && same(1, -1) ? 2 : 0) + (e ? 4 : 0) + (s && e && same(1, 1) ? 8 : 0)
    + (s ? 16 : 0) + (s && w && same(-1, 1) ? 32 : 0) + (w ? 64 : 0) + (n && w && same(-1, -1) ? 128 : 0);
  return BLOB_INDEX[mask];
}

/**
 * Regroupe les cases pleines en RECTANGLES, par matériau.
 *
 * Maillage glouton : on part de chaque case non encore prise, on étend au maximum vers la
 * droite, puis vers le bas tant que la rangée entière suit. Un sol plat de 48 cases donne un
 * rectangle ; une salle de plateformes en donne une poignée.
 *
 * Le regroupement est PAR MATÉRIAU et pas seulement par « plein » : une plateforme traversable
 * fondue dans le sol qui la borde deviendrait traversable elle aussi, ou l'inverse — et le
 * défaut ne se verrait qu'en jouant, sur un saut qui ne passe plus.
 */
export function bandsCollision(map){
  if(!map || !map.cells) return [];
  const L = map.width, H = map.height;
  const taken = new Array(L * H).fill(false);
  const bands = [];
  const plein = (x, y, m) => cellTilemap(map, x, y) === m && !taken[y * L + x];

  for(let y = 0; y < H; y++){
    for(let x = 0; x < L; x++){
      const m = cellTilemap(map, x, y);
      if(m === TILEMAP_EMPTY || taken[y * L + x]) continue;
      let larg = 1;
      while(x + larg < L && plein(x + larg, y, m)) larg++;
      let top = 1;
      for(;;){
        const yy = y + top;
        if(yy >= H) break;
        let toute = true;
        for(let i = 0; i < larg; i++){ if(!plein(x + i, yy, m)){ toute = false; break; } }
        if(!toute) break;
        top++;
      }
      for(let j = 0; j < top; j++){
        for(let i = 0; i < larg; i++) taken[(y + j) * L + (x + i)] = true;
      }
      bands.push({x: x, y: y, l: larg, h: top, material: m});
    }
  }
  return bands;
}

/**
 * Les bandes qui BLOQUENT : celles des tuiles dont la palette ne dit pas « Aucune », et aucune
 * si la map elle-même est réglée « Aucune » (un décor).
 *
 * `tiles` : les tuiles de la PALETTE (`palette.tiles`, lues par `Tilemap.tileDefs()`). Sans elles,
 * rien ne dit qu'une case est « Aucune » : tout reste solide, plutôt que de faire tomber le
 * personnage à travers un sol dont la palette n'est pas chargée.
 *
 * C'est aussi CE nombre qu'il faut afficher : une bande de tuiles « Aucune » ne coûte rien au
 * solveur, qui ne la voit jamais. (Avant v0.159.1 la collision était lue dans `map.materials`,
 * toujours vide en production — toute tuile était solide.)
 */
export function collidingBands(map, tiles){
  if(!map || map.collision === 'none') return [];
  const defs = tiles || [];
  return bandsCollision(map).filter(function(b){
    const def = defs[b.material - 1];
    return !(def && def.collision === 'none');
  });
}

/**
 * Les bands converties en obstacles du solveur — centre et demi-tailles, en unités du monde.
 *
 * L'axe Y de la GRILLE descend (une planche se lit de haut en bas), celui du MONDE monte. La
 * conversion est donc un miroir, et pas un simple facteur d'échelle : l'oublier retourne le
 * niveau et le plafond devient le sol, ce qui se voit tout de suite — mais un signe oublié dans
 * la demi-hauteur, lui, décale tout d'une demi-tile en silence.
 *
 * `tiles` : les tuiles de la palette — 'platform' donne un obstacle traversable par en dessous.
 * Les bandes « Aucune » sont écartées en amont, par `collidingBands`.
 */
export function obstaclesTilemap(map, bands, tiles){
  if(!map) return [];
  const t = Number(map.cellSize) || 0.5;
  const ox = Number(map.originX) || 0, oy = Number(map.originY) || 0;
  const defs = tiles || [];
  return (bands || []).map(function(b){
    const def = defs[b.material - 1] || {};
    return {
      x: ox + (b.x + b.l / 2) * t,
      y: oy - (b.y + b.h / 2) * t,
      dl: (b.l * t) / 2,
      dh: (b.h * t) / 2,
      statique: true,
      traversable: def.collision === 'platform',
      // Une bande de tuiles n'est jamais une pente : les pentes sont des objets.
      rolloff: false
    };
  });
}

/**
 * Une map lue depuis un TEXTE : une ligne par rangée, un caractère par case.
 *
 * C'est la forme sous laquelle une salle se décrit, se relit et se corrige — et celle qu'une IA
 * produit naturellement. Un tableau de 1 296 entiers ne se relit pas ; un plan en caractères, si.
 * `legende` associe un caractère à un index de matériau ; tout caractère absent est du vide.
 */
export function mapFromText(text, legende, tile){
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  // Une ligne empty en fin de texte est un artefact d'écriture, pas une rangée de la salle.
  while(lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  const H = Math.max(1, lines.length);
  const L = Math.max(1, lines.reduce(function(m, l){ return Math.max(m, l.length); }, 0));
  const c = mapEmpty(L, H, tile);
  const leg = legende || {};
  lines.forEach(function(line, y){
    for(let x = 0; x < line.length; x++){
      const v = leg[line[x]];
      if(v) c.cells[y * L + x] = v;
    }
  });
  return c;
}

/** La map redonnée en texte, avec la même légende — pour relire ce qui a été construit. */
export function textFromMap(map, legende){
  if(!map) return '';
  const inverse = {};
  Object.keys(legende || {}).forEach(function(k){ inverse[legende[k]] = k; });
  const lines = [];
  for(let y = 0; y < map.height; y++){
    let s = '';
    for(let x = 0; x < map.width; x++){
      const m = cellTilemap(map, x, y);
      s += (m && inverse[m]) ? inverse[m] : '.';
    }
    lines.push(s);
  }
  return lines.join('\n');
}

/**
 * La géométrie d'une map : QUATRE SOMMETS PAR CASE PLEINE, en une seule maille.
 *
 * `resoudreRegion(x, y, index)` rend la région en pixels de la tile à poser — c'est l'appelant
 * qui sait où sont les assets. `null` saute la case plutôt que d'afficher n'importe quoi.
 *
 * Rend `null` si la map est vide : une géométrie sans sommet fait tomber le calcul de sa boîte
 * englobante, et three la considère alors comme toujours visible ou jamais, selon les versions.
 */
export function geometryTilemap(T, map, resolveRegion, texL, texH, inset){
  if(!T || !map) return null;
  const t = Number(map.cellSize) || 0.5;
  // L'ORIGINE EST APPLIQUÉE ICI AUSSI. Elle ne l'était pas, et `obstaclesTilemap` l'appliquait :
  // une map d'origine non nulle dessinait donc ses tuiles à un endroit et posait ses boîtes de
  // collision à un autre. Personne ne s'en était aperçu parce que rien dans l'interface ne rendait
  // l'origine non nulle — le champ existait, la moitié du code le lisait, et le défaut attendait
  // le premier qui s'en servirait. Un test mesure maintenant que les deux CENTRES coïncident.
  const ox = Number(map.originX) || 0, oy = Number(map.originY) || 0;
  const pos = [], uvs = [], idx = [];
  let n = 0;
  for(let y = 0; y < map.height; y++){
    for(let x = 0; x < map.width; x++){
      const m = cellTilemap(map, x, y);
      if(m === TILEMAP_EMPTY) continue;
      // 4e argument : l'index blob (8 voisins), pour les tuiles `blob` — voir BLOB_MASKS.
      const region = resolveRegion(x, y, indexAutoTile(map, x, y), indexBlobTile(map, x, y));
      if(!region) continue;
      // Coin bas-gauche de la case. La projection passe par `projectCell` : c'est elle qui
      // décide du PLAN (xy, xz, yz), et recopier son calcul ici ferait dériver le rendu des
      // collisions au premier changement. L'axe des LIGNES descend (une planche se lit de haut
      // en bas), d'où le `- dv * (y + 1)` : l'oublier retourne le niveau.
      const plane = map.plane || 'xy';
      const o0 = projectCell(plane, 0, 0, t);
      const pu = projectCell(plane, 1, 0, t), pv = projectCell(plane, 0, 1, t);
      const du = {x: pu.x - o0.x, y: pu.y - o0.y, z: pu.z - o0.z};   // un pas de colonne
      const dv = {x: pv.x - o0.x, y: pv.y - o0.y, z: pv.z - o0.z};   // un pas de ligne
      const bx = ox + du.x * x - dv.x * (y + 1);
      const by = oy + du.y * x - dv.y * (y + 1);
      const bz = du.z * x - dv.z * (y + 1);
      pos.push(bx, by, bz,
               bx + du.x, by + du.y, bz + du.z,
               bx + dv.x, by + dv.y, bz + dv.z,
               bx + du.x + dv.x, by + du.y + dv.y, bz + du.z + dv.z);
      const uv = uvOfRegion(region, texL, texH);
      // RETRAIT DE BORD (`inset`, en texels) : sur une texture FILTRÉE, l'échantillonnage au bord
      // exact d'une région mélange la ligne de texels de l'image voisine de la planche — et comme
      // les tuiles se touchent, cela dessine une COUTURE à chaque joint (mesuré sur SkyStrike :
      // l'eau bavait sur la crête et le sable). En filtrage « near », 0 : les UV exacts sont ce
      // qui tient le rendu pixel-perfect (voir `uvOfRegion`).
      const k = Number(inset) || 0;
      if(uv && k > 0 && texL > 0 && texH > 0){
        const iu = Math.min(k / texL, (uv.u1 - uv.u0) / 2), iv = Math.min(k / texH, (uv.v1 - uv.v0) / 2);
        uv.u0 += iu; uv.u1 -= iu; uv.v0 += iv; uv.v1 -= iv;
      }
      if(!uv){
        // Région incalculable (texture sans dimensions) : la case est SAUTÉE. L'ancien repli
        // 0→1 affichait la planche entière dans la case — un décor faux qui ressemble à un bug
        // de découpe, là où un trou se voit et se reconstruit.
        pos.length -= 12;
        continue;
      }
      uvs.push(uv.u0, uv.v0,  uv.u1, uv.v0,  uv.u0, uv.v1,  uv.u1, uv.v1);
      idx.push(n, n + 1, n + 2,  n + 2, n + 1, n + 3);
      n += 4;
    }
  }
  if(!n) return null;
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// ---------- De la grille au monde, et retour : ce dont un pinceau a besoin ----------
//
// Les deux sens vivent COTE À COTE, et volontairement : le sens aller (`geometryTilemap`,
// `obstaclesTilemap`) et le sens retour (`cellSubPoint`) doivent rester inverses l'un de l'autre,
// et le seul medium de s'en assurer est de pouvoir les tester ensemble. Un pinceau dont l'inversion
// dérive d'une demi-case peint la case du dessus sans jamais rien signaler.

/** Le CENTRE d'une case, dans le repère local de la map. */
export function centerCellTilemap(map, x, y){
  const t = Number(map && map.cellSize) || 0.5;
  const ox = Number(map && map.originX) || 0, oy = Number(map && map.originY) || 0;
  return {x: ox + (x + 0.5) * t, y: oy - (y + 0.5) * t};
}

/**
 * La case sous un point donné en coordonnées LOCALES de la map, ou `null` hors de la grille.
 *
 * `null` et pas une case bornée : un pinceau qui rabat le clic sur le bord peindrait une colonne
 * entière de tuiles quand on relâche à côté, ce qui se lit comme un bug de la map.
 */
export function cellSubPoint(map, lx, ly){
  if(!map) return null;
  const t = Number(map.cellSize) || 0.5;
  const ox = Number(map.originX) || 0, oy = Number(map.originY) || 0;
  const x = Math.floor((Number(lx) - ox) / t);
  const y = Math.floor((oy - Number(ly)) / t);
  if(x < 0 || y < 0 || x >= map.width || y >= map.height) return null;
  return {x: x, y: y};
}

/**
 * Redimensionne une map en GARDANT ce qui tient encore.
 *
 * Le coin haut-gauche est l'anchor : c'est celui que l'axe Y descendant de la grille rend fixe, et
 * agrandir vers le bas et la droite est ce qu'on attend en dessinant un niveau. Refaire une map
 * empty ferait perdre le travail — et c'est ce qu'un `mapEmpty` de remplacement produirait.
 */
export function resizeMap(map, width, height){
  if(!map) return null;
  const L = Math.max(1, Math.round(Number(width) || 1)), H = Math.max(1, Math.round(Number(height) || 1));
  if(L === map.width && H === map.height) return map;
  const cells = new Array(L * H).fill(TILEMAP_EMPTY);
  for(let y = 0; y < Math.min(H, map.height); y++){
    for(let x = 0; x < Math.min(L, map.width); x++){
      cells[y * L + x] = map.cells[y * map.width + x] || TILEMAP_EMPTY;
    }
  }
  map.cells = cells; map.width = L; map.height = H;
  return map;
}

/**
 * Pose un RECTANGLE de cases. Rend le nombre de cases changées.
 *
 * Les deux coins sont donnés dans n'importe quel ordre : on tire un rectangle de bottom en haut aussi
 * souvent que l'inverse, et exiger un sens ne se remarquerait qu'à l'usage, comme un outil qui
 * « ne marche pas parfois ».
 */
export function setRectTilemap(map, x0, y0, x1, y1, v){
  if(!map) return 0;
  const ax = Math.min(x0, x1), bx = Math.max(x0, x1);
  const ay = Math.min(y0, y1), by = Math.max(y0, y1);
  let n = 0;
  for(let y = ay; y <= by; y++){
    for(let x = ax; x <= bx; x++) if(setCellTilemap(map, x, y, v)) n++;
  }
  return n;
}

/**
 * Les cases d'un TRAIT entre deux cases (Bresenham).
 *
 * Une souris ne livre pas toutes les positions par lesquelles elle est passée : à vitesse normale
 * elle saute trois ou quatre cases entre deux évènements. Peindre seulement les cases reçues laisse
 * un pointillé, et l'utilisateur en conclut que le pinceau « rate ».
 */
export function strokeTilemap(x0, y0, x1, y1){
  const pts = [];
  let x = Math.round(x0), y = Math.round(y0);
  const xf = Math.round(x1), yf = Math.round(y1);
  const dx = Math.abs(xf - x), dy = Math.abs(yf - y);
  const sx = (x < xf) ? 1 : -1, sy = (y < yf) ? 1 : -1;
  let err = dx - dy;
  for(;;){
    pts.push({x: x, y: y});
    if(x === xf && y === yf) break;
    const e2 = 2 * err;
    if(e2 > -dy){ err -= dy; x += sx; }
    if(e2 < dx){ err += dx; y += sy; }
    if(pts.length > 4096) break;      // filet : une boucle infinie ici gèlerait l'éditeur
  }
  return pts;
}

/**
 * Les problèmes d'une map, en clair.
 *
 * `tiles` : les tuiles de sa PALETTE (`Tilemap.tileDefs()`), `null` si elle n'en a pas. Ce
 * validateur lisait `map.materials`, toujours vide depuis la palette-asset : il signalait
 * « Aucun matériau » sur TOUTE map réelle, et plus rien de ce qui clochait vraiment.
 */
export function validateTilemap(map, spritesConnus, tiles){
  const p = [];
  if(!map || !Array.isArray(map.cells)) return ['La map est vide ou illisible.'];
  if(map.cells.length !== map.width * map.height){
    p.push('La grille annonce ' + map.width + ' × ' + map.height + ' cases mais en contient '
      + map.cells.length + ' : elle s\'affichera de travers.');
  }
  if(!(Number(map.cellSize) > 0)) p.push('La taille de tuile doit être un nombre positif.');
  if(!tiles){
    p.push('Aucune palette : la map n\'a rien à afficher.');
    return p;
  }
  if(!tiles.length) p.push('La palette ne contient aucune tuile : la map n\'a rien à afficher.');
  tiles.forEach(function(m, i){
    const ou = 'La tuile n°' + (i + 1) + (m && m.name ? ' (« ' + m.name + ' »)' : '');
    if(!m || !m.spriteId){ p.push(ou + ' ne désigne aucune planche.'); return; }
    if(spritesConnus && spritesConnus.indexOf(m.spriteId) === -1){
      p.push(ou + ' désigne une planche qui n\'existe plus dans le projet.');
    }
  });
  // Une case qui désigne une tuile absente affiche du vide : la map a l'air trouée, et on
  // cherche du côté du dessin.
  const max = tiles.length;
  let hors = 0;
  map.cells.forEach(function(v){ if(v > max) hors++; });
  if(hors){
    p.push(hors + ' case(s) désignent une tuile qui n\'existe pas dans la palette (il y en a '
      + max + ') : elles resteront vides.');
  }
  return p;
}

/**
 * La case visée par un point du MONDE, avec tout ce qu'il faut pour la lire ou l'écrire.
 *
 * Les scripts raisonnent en points du monde — la position d'un personnage, celle d'un clic, celle
 * d'un projectile — jamais en indices de grille. La conversion est courte et c'est exactement le
 * genre de chose qu'on écrit de travers une fois sur deux : `cellSubPoint` attend des coordonnées
 * LOCALES à la map, et la map est posée sur un nœud, lui-même sous la racine du monde 2D.
 *
 * La position MONDIALE du nœud, pas `node.position` : une racine 2D déplacée décalerait sinon
 * toutes les lectures d'autant, et le défaut se chercherait dans la map. Même raisonnement, et
 * même code, que le pinceau de l'éditeur (js/brush-tilemap.js).
 *
 * `T` est three.js, passé en paramètre comme partout ailleurs dans ce module : il doit rester
 * lisible par un test sans moteur de rendu.
 */
export function aimCellTilemap(T, node, wx, wy){
  const c = (node && node.getComponent) ? node.getComponent('Tilemap') : null;
  if(!c) return null;
  const w = node.getWorldPosition(new T.Vector3());
  const g = cellSubPoint(c, Number(wx) - w.x, Number(wy) - w.y);
  return g ? {node: node, map: c, x: g.x, y: g.y} : null;
}

/**
 * Résout « quelle map, quelle case » à partir des arguments souples d'un script.
 *
 * Trois écritures doivent marcher, parce que ce sont les trois qu'on essaie naturellement :
 * `api.tileAt()` (sous me), `api.tileAt(point)` (sous ce point), `api.tileAt(map, point)`
 * (sur cette map-là). Sans cette souplesse, la première tentative de quelqu'un échoue en
 * silence — `tuileA` rendrait 0, qui veut dire « du vide », et non « tu t'es trompé d'appel ».
 *
 * Une scène n'a presque jamais deux cartes : à défaut de cible, on prend la première trouvée.
 */
export function aimCell2d(T, target, position, soi, list){
  const hasMap = function(x){ return !!(x && x.getComponent && x.getComponent('Tilemap')); };
  // La cible peut être un NOM : sans ça, `api.setTile('Murs', p)` posait la case sur la première
  // carte venue, en silence.
  if(typeof target === 'string'){
    const name = target;
    target = (list || []).find(function(x){ return x && x.name === name && hasMap(x); })
          || (list || []).find(function(x){ return x && x.name === name; }) || null;
    if(!target) return null;
  }
  const isNode = !!(target && target.userData);
  // Un nœud désigné SANS Tilemap (le parent d'une grille, façon Unity) : chercher dans ses
  // enfants, jamais retomber sur une autre carte de la scène.
  let map = null;
  if(isNode){
    if(hasMap(target)) map = target;
    else map = (list || []).find(function(x){
      if(!hasMap(x)) return false;
      for(let p = x.parent; p; p = p.parent) if(p === target) return true;
      return false;
    }) || null;
    // Seul `soi` (appel sans cible) autorise le repli sur la première carte trouvée.
    // `api.tileAt(perso)` (sans point) se lit « sous ce nœud » : repli sur la première carte,
    // le point étant la position du nœud.
    if(!map && (target === soi || !position)){
      map = (list || []).find(hasMap) || null;
      if(map && !position && target.getWorldPosition) position = target.getWorldPosition(new T.Vector3());
    }
  } else {
    map = (list || []).find(hasMap) || null;
  }
  if(!map) return null;
  // Le point : celui qu'on donne, sinon le premier argument s'il ressemble à un point, sinon soi.
  let p = position;
  if(!p && !isNode && target && typeof target.x === 'number') p = target;
  if(!p && soi && soi.getWorldPosition) p = soi.getWorldPosition(new T.Vector3());
  if(!p) return null;
  return aimCellTilemap(T, map, p.x, p.y);
}


// EXPOSÉ EN GLOBALE, à dessein. Ces symboles sont appelés depuis des fichiers
// que les mêmes pages ne chargent pas toutes : un `import` y pointerait un
// fichier absent, et la page ne démarrerait pas. Ils gardent donc leur garde
// `typeof` côté appelant, et se déclarent ici.
globalThis.aimCell2d = aimCell2d;
globalThis.bandsCollision = bandsCollision;
globalThis.cellFromWorld = cellFromWorld;
globalThis.cellTilemap = cellTilemap;
globalThis.decodeCells = decodeCells;
globalThis.encodeCells = encodeCells;
globalThis.geometryTilemap = geometryTilemap;
globalThis.mapFromText = mapFromText;
globalThis.obstaclesTilemap = obstaclesTilemap;
globalThis.collidingBands = collidingBands;
globalThis.resizeMap = resizeMap;
globalThis.setCellTilemap = setCellTilemap;
globalThis.setRectTilemap = setRectTilemap;
globalThis.strokeTilemap = strokeTilemap;
globalThis.textFromMap = textFromMap;
globalThis.validateTilemap = validateTilemap;