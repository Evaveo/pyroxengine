// moteur/js/components/component-tilemap.js
//
// La map de tuiles : des DONNÉES, portées par le composant — plus un sac `userData.tilemap2d`.
// Enfermées dans userData, elles échappaient au Registry, aux Systèmes, et à toute vue qui
// interroge les composants.
//
// Le calcul — auto-tuilage, bandes de collision, géométrie, projection — vit dans js/tilemap.js,
// partagé et pur. La construction des mailles vit ici, et le TilemapSystem l'appelle : le jeu
// publié n'en tient plus de miroir, il exécute ce fichier-ci.
//
// Une maille par TUILE et pas une seule : deux tuiles, ce sont deux planches, donc deux textures,
// donc deux matériaux de rendu. Les fondre demanderait un atlas commun — c'est-à-dire exiger des
// graphistes qu'ils dessinent tout sur une seule image.

import { assetById, ed, ensureTilemap } from '../component-data.js';
import { Registry } from '../component-registry.js';
import { Component, detachData, mergeIntoBag } from '../component.js';
import { layers2dOfProject } from './component-sprite.js';

/**
 * Les cellules reçues (constructeur ou `hydrate`), décodées si besoin.
 *
 * Le RLE est MARQUÉ, pas un simple tableau : un tableau de cellules brutes et un tableau RLE
 * sont tous deux des `Array`, et tout chemin qui passe des cellules brutes (copier/coller,
 * prefab, pinceau) serait décodé comme du RLE — une grille corrompue, silencieusement.
 *
 * Rend `undefined` quand `raw` ne porte aucune cellule : c'est ce qui permet à `mergeIntoBag`
 * de laisser le sac persisté intact plutôt que de l'écraser par une grille vide (même piège que
 * Physics, docs/REVUE_2026-09-10.md § 3.3, mais dans l'autre sens — ici c'est le tableau REÇU
 * qui serait vide).
 */
function cellsOf(raw, width, height){
  if(raw && Array.isArray(raw.rle)) return decodeCells(raw.rle, width * height);
  if(Array.isArray(raw)) return raw.slice();
  return undefined;
}

/** La palette d'une tilemap, cherchée dans les assets du projet. */
export function paletteOfTilemap(map){
  if(!map || !map.paletteId) return null;
  const a = assetById(map.paletteId);
  return (a && a.kind === 'tilePalette') ? a.palette : null;
}

/**
 * La région qu'affiche une tuile : l'index de voisinage `auto` si elle est auto-tuilée, sinon
 * SA région (`tile.region`) — une tuile est UNE image de sa planche, pas la première d'office.
 *
 * Une planche d'auto-tuilage a SEIZE images, dans l'ordre de la découpe. Si elle en a moins,
 * on prend modulo plutôt que de ne rien afficher : une planche incomplète doit se voir comme
 * un décor bizarre, pas comme un trou — un trou s'attribue au moteur. (Même règle que
 * `regionIndexOfTile`, tile-palette.js — recopiée parce que ce fichier tourne aussi dans le jeu
 * publié, où l'on n'importe pas l'éditeur.)
 */
export function regionTile(tile, auto, blob){
  if(!tile || !tile.spriteId) return null;
  const a = assetById(tile.spriteId);
  if(!a || a.kind !== 'sprite') return null;
  const regions = a.regions || [];
  if(!regions.length) return null;
  // `blob` : auto-tuilage 8 voisins, planche de 47 images (BLOB_MASKS, tilemap.js).
  const i = tile.autotile ? (Number(tile.blob ? blob : auto) || 0) : (Number(tile.region) || 0);
  return regions[((i % regions.length) + regions.length) % regions.length];
}

/** La texture d'une tuile et ses dimensions, pour les coordonnées de texture. */
export function textureTile(tile){
  if(!tile || !tile.spriteId) return null;
  const a = assetById(tile.spriteId);
  if(!a || a.kind !== 'sprite') return null;
  const tex = assetById(a.textureId);
  if(!tex) return null;
  const dims = dimensionsTexture(tex);
  return {tex: tex, texture: tex.texture || tex.template || null,
          L: dims.l, H: dims.h,
          near: !!(tex.paramsImport && tex.paramsImport.filtrage === 'near')};
}

/** Nombre de reconstructions « en attente d'image » tolérées avant d'abandonner (≈ 10 s à 60 i/s). */
export const TILEMAP_PENDING_MAX = 600;

/**
 * Faut-il garder la map `_dirty` ? Oui tant qu'une image manque — mais PAS POUR TOUJOURS. Une
 * texture qui ne décode jamais (chargement raté, BUGS_MOTEUR n° 18/19) gardait la map en
 * reconstruction à chaque image, indéfiniment, sans rien dire. Au-delà de TILEMAP_PENDING_MAX
 * essais on abandonne, on le dit une fois ; un `setCell` ou une texture arrivée relance.
 */
export function pendingTilemap(map, pending){
  if(!pending){ map._pendingTries = 0; return false; }
  map._pendingTries = (map._pendingTries || 0) + 1;
  if(map._pendingTries < TILEMAP_PENDING_MAX) return true;
  if(!map._pendingWarned){
    map._pendingWarned = true;
    console.warn('Tilemap : une image de la palette n\'arrive pas — reconstruction abandonnée '
      + '(texture non chargée ?)');
  }
  return false;
}

/** (Re)construit les mailles d'une map : une par tuile de palette utilisée. */
export function rebuildTilemap(node){
  const map = (node.getComponent && node.getComponent('Tilemap')) || null;
  if(!map) return 0;
  (ed(node).tilemapMeshes || []).forEach(function(m){
    node.remove(m);
    if(m.geometry) m.geometry.dispose();
    if(m.material) m.material.dispose();
  });
  ed(node).tilemapMeshes = [];
  const palette = paletteOfTilemap(map);
  const tiles = (palette && palette.tiles) || [];
  const meshes = [];
  let pending = false;
  tiles.forEach(function(tile, i){
    const index = i + 1;
    const t = textureTile(tile);
    if(!t) return;
    // IMAGE PAS ENCORE DÉCODÉE : dimensions nulles, donc aucune région calculable. Construire
    // quand même posait la planche ENTIÈRE dans chaque case (crête|eau|sable|île répétées), et
    // rien ne reconstruisait ensuite — le défaut « des fois » selon l'ordre de chargement.
    if(!(t.L > 0) || !(t.H > 0)){ pending = true; return; }
    const geo = geometryTilemap(THREE, map,
      function(x, y, auto, blob){
        return map.cellAt(x, y) === index ? regionTile(tile, auto, blob) : null;
      // En « near », un retrait infime (1/50 de texel) : il ne change aucun texel choisi, donc le
      // rendu reste pixel-perfect, mais l'arrondi au joint ne retombe plus sur la colonne de
      // l'image VOISINE de la planche — un trait clair entre deux tuiles pourtant pleines.
      }, t.L, t.H, t.near ? 0.02 : 0.5);
    if(!geo) return;
    const mat = materialSprite(THREE, t.texture, 0xffffff, t.near);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = '__tuiles_' + index;
    mesh.userData.interne = true;
    mesh.renderOrder = orderOfSort(layers2dOfProject(), map.layer || 'Décor', map.order || 0, node.id);
    node.add(mesh);
    meshes.push(mesh);
  });
  ed(node).tilemapMeshes = meshes;
  // Le compteur de version invalide le cache des obstacles : sans lui, le solveur continuerait
  // de tester l'ancienne forme du décor après chaque coup de pinceau, et on peindrait un sol sur
  // lequel le personnage tombe encore.
  map._v = (map._v || 0) + 1;
  map._dirty = pendingTilemap(map, pending);   // réessayé par le TilemapSystem tant qu'une image manque
  return meshes.length;
}

export class Tilemap extends Component {
  constructor(node, opts){
    super(node);
    opts = opts || {};
    // LE SAC EST LA SEULE VÉRITÉ (docs/REVUE_2026-09-14.md point 10) : `this.data` référencera
    // `userData.tilemap` dès `onAdd`. `cells` reste calculé ICI, sur les données REÇUES et pas
    // encore mergées : `mergeIntoBag` copie les clés telles quelles, et un `cells` encore au
    // format `{rle:[...]}` corromprait la grille en silence (voir `cellsOf` plus haut).
    const width = (opts.width !== undefined) ? opts.width : 32;
    const height = (opts.height !== undefined) ? opts.height : 18;
    const cells = cellsOf(opts.cells, width, height);
    this.data = Object.assign({}, opts);
    if(cells !== undefined) this.data.cells = cells;
    this._dirty = true;
  }

  get plane() { return this.data.plane || 'xy'; }
  set plane(v) { this.data.plane = v || 'xy'; }
  get cellSize() { return this.data.cellSize; }
  set cellSize(v) { this.data.cellSize = v; }
  get width() { return this.data.width; }
  set width(v) { this.data.width = v; }
  get height() { return this.data.height; }
  set height(v) { this.data.height = v; }
  get originX() { return this.data.originX || 0; }
  set originX(v) { this.data.originX = v || 0; }
  get originY() { return this.data.originY || 0; }
  set originY(v) { this.data.originY = v || 0; }
  get paletteId() { return this.data.paletteId || null; }
  set paletteId(v) { this.data.paletteId = v || null; }
  get layer() { return this.data.layer || 'Décor'; }
  set layer(v) { this.data.layer = v || 'Décor'; }
  get order() { return this.data.order || 0; }
  set order(v) { this.data.order = v || 0; }
  get collision() { return this.data.collision || 'solid'; }
  set collision(v) { this.data.collision = v || 'solid'; }
  get cells() { return this.data.cells; }
  set cells(v) { this.data.cells = v; }

  onAdd(){
    // `ensureTilemap` complète les champs absents ET garantit un `cells` de la bonne taille —
    // mais seulement quand le sac n'en a pas déjà un valide, donc jamais aux dépens de celui
    // qu'on vient de calculer dans le constructeur (voir son commentaire, component-data.js).
    this.data = mergeIntoBag(ensureTilemap(this.node), this.data);
    // `ensureTilemap` a pu tailler `cells` pour un width/height que `mergeIntoBag` vient
    // d'ÉCRASER juste après (des `opts.width/height` différents des défauts) : revérifier ici,
    // sans quoi `cells.length` et `width*height` divergent silencieusement.
    if(!Array.isArray(this.data.cells) || this.data.cells.length !== this.data.width * this.data.height){
      this.data.cells = new Array(this.data.width * this.data.height).fill(0);
    }
    if(typeof rebuildTilemap === 'function' && typeof THREE !== 'undefined') rebuildTilemap(this.node);
  }

  // `hydrate` : le SEUL point de relecture (contrat de component.js, règle 2). Rejoue le
  // décodage RLE des cellules, la seule partie délicate — voir `cellsOf` plus haut.
  hydrate(d){
    if(!d) return;
    if(d.plane !== undefined) this.plane = d.plane;
    if(d.cellSize !== undefined) this.cellSize = d.cellSize;
    if(d.width !== undefined) this.width = d.width;
    if(d.height !== undefined) this.height = d.height;
    if(d.originX !== undefined) this.originX = d.originX;
    if(d.originY !== undefined) this.originY = d.originY;
    if(d.paletteId !== undefined) this.paletteId = d.paletteId;
    if(d.layer !== undefined) this.layer = d.layer;
    if(d.order !== undefined) this.order = d.order;
    if(d.collision !== undefined) this.collision = d.collision;
    const cells = cellsOf(d.cells, this.width, this.height);
    if(cells !== undefined) this.cells = cells;
    this._dirty = true;
  }

  /**
   * L'indice de tuile d'une cellule. Hors grille = vide, SANS erreur : peindre jusqu'au bord est
   * le cas normal, et lever ici arrêterait le pinceau en plein geste.
   */
  cellAt(x, y){
    if(x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    return this.cells[y * this.width + x] || 0;
  }

  /**
   * Les tuiles de la palette, ou `null` si elle n'est pas résolue. Une MÉTHODE et pas une
   * globale : `world-2d.js` la lit sur l'instance, sans `typeof paletteOfTilemap` — la garde
   * qui rend toujours faux dans le jeu publié (docs/KNOWN_ISSUES.md, runtime en IIFE).
   */
  tileDefs(){
    const palette = paletteOfTilemap(this);
    return (palette && palette.tiles) || null;
  }

  setCell(x, y, index){
    if(x < 0 || y < 0 || x >= this.width || y >= this.height) return false;
    const i = y * this.width + x;
    const n = Math.max(0, Math.round(Number(index) || 0));
    if(this.cells[i] === n) return false;
    this.cells[i] = n;
    // Le drapeau, et PAS une reconstruction immédiate : un coup de pinceau touche des dizaines
    // de cellules, et reconstruire à chacune refait toute la géométrie autant de fois.
    this._dirty = true;
    return true;
  }

  onRemove(){
    (ed(this.node).tilemapMeshes || []).forEach((m) => {
      this.node.remove(m);
      if(m.geometry) m.geometry.dispose();
      if(m.material) m.material.dispose();
    });
    ed(this.node).tilemapMeshes = [];
    delete this.node.userData.tilemap;
  }

  // DÉTACHÉE : `this.data` EST `userData.tilemap` (contrat de component.js, règle 4). `cells`
  // seul reste transformé — au format RLE, pas la copie brute du tableau en mémoire.
  serialize(){
    const d = detachData(this.data);
    d.cells = { rle: encodeCells(this.cells) };
    return d;
  }

  static get typeName(){ return 'Tilemap'; }
  static get description(){ return 'Carte de tuiles'; }
  static get category(){ return 'Rendu'; }
  static get icon(){ return Icons.html('grid-four') + ' '; }
  static get creatable(){
    return { label: 'Map de tuiles', icon: '▦ ', components: [{ type: 'Tilemap' }] };
  }
}

Registry.registerClass(Tilemap);
