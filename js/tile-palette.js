// moteur/js/tile-palette.js
//
// La palette de tuiles : un ASSET, avec son fichier sur le disque.
//
// Elle vivait dans `userData.tilemap2d.materials`, donc dans un nœud : deux décors ne pouvaient
// pas partager les mêmes tuiles, et changer une planche demandait de reprendre chaque map.

import { palette } from './objects.js';

/** Une palette neuve : la taille d'une cellule en unités du monde, et aucune tuile. */
export function emptyPalette(cellSize){
  return { cellSize: cellSize || 0.5, tiles: [] };
}

/**
 * La tuile d'un indice de cellule. L'INDICE 0 EST TOUJOURS LE VIDE : sans cette convention,
 * effacer une cellule demanderait une valeur sentinelle propre à chaque palette.
 */
export function tileAt(palette, index){
  if(!palette || !index) return null;
  return palette.tiles[index - 1] || null;
}

/**
 * Une tuile normalisée. `region` est l'indice de l'image DANS la planche : une tuile n'est pas
 * une planche entière mais UNE de ses images, comme dans la Tile Palette d'Unity où glisser un
 * tileset découpé donne une tuile par cellule. Écrit seulement quand il n'est pas nul — les
 * palettes d'avant ce champ restent identiques octet pour octet.
 */
export function normalizeTile(t){
  const out = { name: t.name || 'Tuile', spriteId: t.spriteId || null,
                autotile: !!t.autotile, collision: t.collision || 'none' };
  const r = Math.max(0, Math.floor(Number(t.region) || 0));
  if(r) out.region = r;
  return out;
}

export function serializePalette(p){
  return { cellSize: p.cellSize, tiles: p.tiles.map(normalizeTile) };
}

export function parsePalette(json){
  const d = (typeof json === 'string') ? JSON.parse(json) : json;
  return { cellSize: d.cellSize || 0.5, tiles: (d.tiles || []).map(normalizeTile) };
}

/**
 * Glisse une planche dans la palette : UNE TUILE PAR IMAGE de la découpe, comme Unity. Les
 * images déjà présentes (même planche, même région) ne sont pas dupliquées — reglisser la planche
 * après un redécoupage n'ajoute que les nouvelles. Rend le nombre de tuiles ajoutées.
 *
 * `opts.autotile` : la planche entière devient UNE tuile auto-tuilée (ses 16 voisinages).
 */
export function addSpriteToPalette(palette, sprite, opts){
  if(!palette || !sprite || !sprite.id) return 0;
  const o = opts || {};
  const collision = o.collision || 'solid';
  if(o.autotile){
    const blob = !!o.blob;   // 8 voisins, 47 images (BLOB_MASKS, tilemap.js)
    const deja = palette.tiles.some(function(t){ return t.spriteId === sprite.id && t.autotile && !!t.blob === blob; });
    if(deja) return 0;
    const tile = { name: sprite.name || 'Tuile', spriteId: sprite.id, autotile: true, collision: collision };
    if(blob) tile.blob = true;
    palette.tiles.push(tile);
    return 1;
  }
  const regions = (sprite.regions && sprite.regions.length) ? sprite.regions : [{name: sprite.name}];
  let n = 0;
  regions.forEach(function(reg, i){
    const deja = palette.tiles.some(function(t){
      return t.spriteId === sprite.id && !t.autotile && (Number(t.region) || 0) === i;
    });
    if(deja) return;
    const tile = { name: (regions.length > 1 ? (reg && reg.name) : sprite.name) || ('Tuile ' + (i + 1)),
                   spriteId: sprite.id, autotile: false, collision: collision };
    if(i) tile.region = i;
    palette.tiles.push(tile);
    n++;
  });
  return n;
}

/**
 * La région d'image qu'une tuile affiche. Auto-tuilée : l'index de voisinage `auto` ; sinon la
 * région choisie. Modulo le nombre de régions : une planche redécoupée plus petite doit se voir
 * comme un décor bizarre, pas comme un trou — un trou s'attribue au moteur.
 */
export function regionIndexOfTile(tile, auto, count){
  const n = Number(count) || 0;
  if(!tile || n <= 0) return -1;
  const i = tile.autotile ? (Number(auto) || 0) : (Number(tile.region) || 0);
  return ((i % n) + n) % n;
}

/**
 * Le chemin disque d'une palette. Un vrai FICHIER, comme tout genre d'asset du projet : une
 * palette qui ne vivrait qu'en JSON dans le fichier de projet ne serait ni comparable d'une
 * version à l'autre, ni remplaçable à la main, ni partageable entre deux projets.
 */
export function fileNamePalette(name){
  const base = String(name || 'palette')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // accents
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'palette';
  return 'assets/palettes/' + base + '.tilepalette.json';
}


// EXPOSÉ EN GLOBALE, à dessein. Ces symboles sont appelés depuis des fichiers
// que les mêmes pages ne chargent pas toutes : un `import` y pointerait un
// fichier absent, et la page ne démarrerait pas. Ils gardent donc leur garde
// `typeof` côté appelant, et se déclarent ici.
globalThis.emptyPalette = emptyPalette;
globalThis.parsePalette = parsePalette;
globalThis.tileAt = tileAt;
globalThis.normalizeTile = normalizeTile;
globalThis.addSpriteToPalette = addSpriteToPalette;
globalThis.regionIndexOfTile = regionIndexOfTile;