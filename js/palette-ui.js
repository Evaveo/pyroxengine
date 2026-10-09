// moteur/js/palette-ui.js
//
// La fenêtre « Palette de tuiles », calquée sur la Tile Palette d'Unity : on y VOIT ses tuiles.
//
// Elle était une liste de formulaires — une ligne « Tuile 1 / Planche / Auto-tuilage / Collision »
// par tuile, sans une seule image. On ne choisit pas une dalle de sol en lisant son nom : on la
// regarde. La fenêtre a donc désormais trois étages, comme celle d'Unity :
//
//   1. la barre : la palette ouverte, les outils du pinceau (les MÊMES que la barre du viewport,
//      js/brush-tilemap.js — un seul état `brush2d`), l'ajout d'une planche ;
//   2. la GRILLE des tuiles, en vignettes : un clic choisit la tuile ET arme le pinceau, glisser
//      une planche découpée depuis le panneau Projet y ajoute une tuile par image ;
//   3. les réglages de la tuile choisie (image, auto-tuilage, collision) — un descripteur de
//      formulaire, construit par le socle (js/ui/form.js).
//
// La palette est un asset partagé : ce qu'on change ici change tous les décors qui la
// référencent, d'où le marquage `_dirty` sur chacun — sinon la modification n'apparaîtrait
// qu'au prochain rechargement du projet, c'est-à-dire jamais pendant qu'on travaille.

import { assets } from './assets.js';
import { brush2d, chooseTool2d, nodeTilemapActive, updateBarTilemap } from './brush-tilemap.js';
import { Registry } from './component-registry.js';
import { rebuildTilemap } from './components/component-tilemap.js';
import { setStatus } from './hierarchy.js';
import { pushHistory } from './history.js';
import { escapeHtml } from './objects.js';
import { addSpriteToPalette, emptyPalette, regionIndexOfTile } from './tile-palette.js';
import { openPanelDock } from './ui.js';
import { createForm } from './ui/form.js';

export const paletteWindow = { asset: null, form: null, tileForm: null, tile: null };

// Taille d'une vignette de la grille, en pixels. Assez grande pour reconnaître une dalle de
// 16 px agrandie ×3, assez petite pour voir un tileset de 48 tuiles sans défiler.
const THUMB = 48;

// L'image d'auto-tuilage montrée en vignette : le voisinage « entouré des quatre côtés », c'est-
// à-dire la tuile du MILIEU d'un bloc — celle qui ressemble à la matière, pas à un bord.
const AUTO_THUMB_INDEX = 15;

/**
 * Toutes les tilemaps qui utilisent cette palette sont à refaire.
 *
 * Sans ce marquage, changer une planche ne se verrait qu'au rechargement du projet : la palette
 * est partagée, et c'est justement ce qui la rend utile — une correction vaut pour tout le
 * niveau, à condition qu'on la voie.
 */
export function invalidateTilemapsOfPalette(paletteId){
  if(!Registry.active) return 0;
  let n = 0;
  Registry.active('Tilemap').forEach(function(t){
    if(t.paletteId !== paletteId) return;
    t._dirty = true;
    rebuildTilemap(t.node);
    n++;
  });
  return n;
}

/** Le décor a changé : on le refait, la barre de peinture et la grille suivent. */
export function paletteApplied(){
  const a = paletteWindow.asset;
  if(!a) return;
  invalidateTilemapsOfPalette(a.id);
  updateBarTilemap();
  renderGrid();
}

function assetOf(id){
  return id ? assets.find(function(x){ return x.id === id; }) || null : null;
}

/** Les planches disponibles, pour le choix d'une tuile. */
export function spriteSheetsOptions(){
  const sprites = assets.filter(function(x){ return x.kind === 'sprite'; });
  return [['', '— aucune —']].concat(sprites.map(function(s){ return [s.id, s.name]; }));
}

/** Les images de la planche d'une tuile, pour le choix de SA région. */
function regionOptions(tile){
  const s = assetOf(tile && tile.spriteId);
  const regions = (s && s.regions) || [];
  if(!regions.length) return [['0', '— planche vide —']];
  return regions.map(function(r, i){ return [String(i), (i + 1) + ' · ' + (r.name || 'image')]; });
}

// ---------- Les vignettes ----------

/**
 * La source dessinable d'une tuile : l'image de sa texture et la région à y découper.
 * `null` quand il manque quelque chose — la vignette montre alors un fond rouge « introuvable ».
 */
export function thumbSourceOfTile(tile){
  const s = assetOf(tile && tile.spriteId);
  if(!s || s.kind !== 'sprite') return null;
  const tex = assetOf(s.textureId);
  if(!tex) return null;
  // Globale gardée, pas d'import : sprite-2d.js est un module que le build allégé peut retirer.
  const img = (typeof globalThis.imageTexture === 'function') ? globalThis.imageTexture(tex) : null;
  const regions = s.regions || [];
  const i = regionIndexOfTile(tile, AUTO_THUMB_INDEX, regions.length);
  if(!img || i < 0) return null;
  const r = regions[i];
  // Lissage seulement pour une illustration : une petite tuile agrandie est du pixel-art, et
  // lissée elle devient une tache floue.
  const near = !!(tex.paramsImport && tex.paramsImport.filtrage === 'near') || (r.l <= 64 && r.h <= 64);
  return { img: img, region: r, near: near };
}

function drawThumb(canvas, tile){
  const ctx = canvas.getContext && canvas.getContext('2d');
  if(!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const src = thumbSourceOfTile(tile);
  if(!src){
    ctx.fillStyle = 'rgba(255,90,90,.35)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return;
  }
  const r = src.region;
  ctx.imageSmoothingEnabled = !src.near;
  // Rapport conservé : une tuile non carrée (un arbre de 16×32) ne doit pas être écrasée.
  const k = Math.min(canvas.width / r.l, canvas.height / r.h);
  const w = r.l * k, h = r.h * k;
  try {
    ctx.drawImage(src.img, r.x, r.y, r.l, r.h, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
  } catch(e){ /* image pas encore décodée : la vignette se redessine au prochain rendu */ }
}

// ---------- La tuile choisie ----------

/** L'indice (0-based) de la tuile que le pinceau pose, ou -1 si la palette est vide. */
function selectedIndex(){
  const a = paletteWindow.asset;
  const n = (a && a.palette && a.palette.tiles.length) || 0;
  if(!n) return -1;
  return Math.min(Math.max(1, brush2d.material | 0), n) - 1;
}

/**
 * La map active doit peindre AVEC cette palette. Une map sans palette la reçoit — c'est le cas
 * du premier coup de pinceau sur une map neuve. Une map qui en a une AUTRE ne change pas de
 * palette en douce : ses cases désigneraient d'autres tuiles et tout le décor changerait.
 */
function bindActiveTilemap(a){
  const node = nodeTilemapActive();
  const map = node ? node.getComponent('Tilemap') : null;
  if(!map) return;
  if(!map.paletteId){
    pushHistory();
    map.paletteId = a.id;
    rebuildTilemap(node);
    setStatus('« ' + node.name + ' » peint maintenant avec « ' + a.name + ' »', 3000);
  } else if(map.paletteId !== a.id){
    const autre = assetOf(map.paletteId);
    setStatus('La map « ' + node.name + ' » utilise la palette « ' + (autre ? autre.name : '?')
      + ' » : changez-la dans son inspecteur pour peindre avec celle-ci.', 6000);
  }
}

function selectTile(i){
  const a = paletteWindow.asset;
  if(!a) return;
  brush2d.material = i + 1;
  // Choisir une tuile, c'est vouloir la poser (Unity arme le pinceau de la même façon). Le
  // rectangle reste armé s'il l'était : on change de tuile, pas d'outil.
  if(brush2d.tool !== 'paint' && brush2d.tool !== 'rect') chooseTool2d('paint');
  bindActiveTilemap(a);
  updateBarTilemap();
  refreshPaletteSelection();
}

// ---------- Les descripteurs ----------

export const PANEL_TILE_PALETTE = {
  id: 'tile-palette',
  sections: [{ id: 'pal', title: '', fields: [
    { ids: ['f-pal-cell'], label: 'Taille de cellule (unités)', type: 'number',
      step: 0.05, min: 0.01, max: 16,
      get: function(a){ return (a.palette || {}).cellSize; },
      set: function(a, v){ a.palette.cellSize = Math.max(0.01, v || 0.5); paletteApplied(); } }
  ]}]
};

export const PANEL_TILE = {
  id: 'tile-palette-tile',
  sections: [{ id: 'tile', title: '', fields: [
    { ids: ['f-tile-name'], label: 'Nom', type: 'text',
      get: function(t){ return t.name || ''; },
      set: function(t, v){ t.name = v; paletteApplied(); } },
    { ids: ['f-tile-sprite'], label: 'Planche', type: 'choice',
      options: spriteSheetsOptions,
      get: function(t){ return t.spriteId || ''; },
      set: function(t, v){ t.spriteId = v || null; t.region = 0; paletteApplied(); } },
    { ids: ['f-tile-region'], label: 'Image', type: 'choice',
      options: regionOptions,
      enabled: function(t){ return !t.autotile; },
      get: function(t){ return String(Number(t.region) || 0); },
      set: function(t, v){ t.region = Math.max(0, parseInt(v, 10) || 0); paletteApplied(); } },
    { ids: ['f-tile-auto'], label: 'Auto-tuilage', type: 'checkbox',
      help: 'La planche porte les 16 voisinages, en grille 4 × 4 : le moteur choisit l\'image '
          + 'selon les cases voisines.',
      get: function(t){ return !!t.autotile; },
      set: function(t, v){ t.autotile = !!v; paletteApplied(); } },
    { ids: ['f-tile-col'], label: 'Collision', type: 'choice',
      options: [['none', 'Aucune'], ['solid', 'Solide'],
                ['platform', 'Plateforme (traversable par en dessous)']],
      get: function(t){ return t.collision || 'none'; },
      set: function(t, v){ t.collision = v; paletteApplied(); } }
  ]}]
};

// ---------- La fenêtre ----------

export function openWindowPalette(asset){
  if(!asset || asset.kind !== 'tilePalette') return null;
  paletteWindow.asset = asset;
  buildPalettePanel();
  openPanelDock('palette');
  return true;
}

function toolbarHtml(a){
  const palettes = assets.filter(function(x){ return x.kind === 'tilePalette'; });
  const sprites = assets.filter(function(x){ return x.kind === 'sprite'; });
  const btn = function(id, icon, title){
    return '<button data-tool2d="' + id + '" class="' + (brush2d.tool === id ? 'active' : '')
      + '" title="' + escapeHtml(title) + '">' + icon + '</button>';
  };
  // Une planche de 16 images et plus peut aussi entrer ENTIÈRE, comme une tuile auto-tuilée.
  const addOpts = sprites.map(function(s){
    const n = (s.regions || []).length;
    let o = '<option value="' + escapeHtml(s.id) + '">' + escapeHtml(s.name) + ' — '
      + n + (n > 1 ? ' images' : ' image') + '</option>';
    if(n >= 16) o += '<option value="auto:' + escapeHtml(s.id) + '">' + escapeHtml(s.name)
      + ' — 1 tuile auto-tuilée</option>';
    return o;
  }).join('');
  return '<div class="tp-bar">'
    + '<select id="tp-palette" title="La palette affichée">'
    + palettes.map(function(p){
        return '<option value="' + escapeHtml(p.id) + '"' + (p === a ? ' selected' : '') + '>'
          + escapeHtml(p.name) + '</option>';
      }).join('') + '</select>'
    + '<span class="tp-tools">'
    + btn('paint', '🖌', 'Pinceau — pose la tuile choisie')
    + btn('rect', '▭', 'Rectangle — remplit un rectangle')
    + btn('pick', '💧', 'Pipette — reprend la tuile d\'une case')
    + btn('erase', '⌫', 'Gomme — efface')
    + '</span>'
    + '<select id="tp-add" title="Ajoute une planche : une tuile par image de sa découpe">'
    + '<option value="">＋ Ajouter une planche…</option>' + addOpts + '</select>'
    + '</div>';
}

/** Le contenu de la fenêtre. */
export function buildPalettePanel(){
  const el = document.getElementById('palette-panel');
  const a = paletteWindow.asset;
  if(!el) return;
  paletteWindow.tileForm = null;
  paletteWindow.tile = null;
  if(!a){ el.innerHTML = ''; paletteWindow.form = null; return; }
  if(!a.palette) a.palette = emptyPalette(0.5);
  el.classList.add('tile-palette-window');
  el.innerHTML = toolbarHtml(a)
    + '<div class="tp-grid" id="tp-grid"></div>'
    + '<div class="tp-props"><div id="tp-tile"></div>'
    + '<button class="btn-modal" id="tp-remove">🗑 Supprimer la tuile</button>'
    + '<div id="tp-pal"></div></div>';
  paletteWindow.form = createForm(document.getElementById('tp-pal'), PANEL_TILE_PALETTE);
  paletteWindow.form.setTargets([a]);
  bindPanel(el, a);
  renderGrid();
}

function buildTileForm(){
  const a = paletteWindow.asset;
  const host = document.getElementById('tp-tile');
  const rm = document.getElementById('tp-remove');
  if(!a || !host) return;
  const i = selectedIndex();
  const tile = (i >= 0) ? a.palette.tiles[i] : null;
  if(rm) rm.style.display = tile ? '' : 'none';
  if(!tile){ host.innerHTML = ''; paletteWindow.tileForm = null; paletteWindow.tile = null; return; }
  // MÊME TUILE : on ne reconstruit pas. Chaque frappe dans « Nom » repasse par `paletteApplied`,
  // et refaire le formulaire à chaque fois arracherait le champ en cours de saisie.
  if(paletteWindow.tileForm && paletteWindow.tile === tile && host.firstChild){
    paletteWindow.tileForm.setTargets([tile]);
    paletteWindow.tileForm.sync();
    return;
  }
  paletteWindow.tile = tile;
  host.innerHTML = '<div class="tp-props-title">Tuile ' + (i + 1) + '</div><div></div>';
  paletteWindow.tileForm = createForm(host.lastChild, PANEL_TILE);
  paletteWindow.tileForm.setTargets([tile]);
}

/** La grille des vignettes. */
function renderGrid(){
  const grid = document.getElementById('tp-grid');
  const a = paletteWindow.asset;
  if(!grid || !a) return;
  const tiles = a.palette.tiles;
  grid.innerHTML = '';
  if(!tiles.length){
    grid.innerHTML = '<div class="tp-empty">Palette vide.<br>Glissez ici une planche (sprite) '
      + 'depuis le panneau Projet, ou utilisez « ＋ Ajouter une planche ». Une planche découpée '
      + 'donne une tuile par image.</div>';
    buildTileForm();
    return;
  }
  const sel = selectedIndex();
  tiles.forEach(function(t, i){
    const cell = document.createElement('button');
    cell.className = 'tp-cell' + (i === sel ? ' selected' : '');
    cell.dataset.index = String(i);
    cell.title = (i + 1) + ' · ' + (t.name || 'Tuile')
      + (t.autotile ? ' (auto-tuilage)' : '')
      + (t.collision && t.collision !== 'none' ? ' — ' + t.collision : '');
    const c = document.createElement('canvas');
    c.width = THUMB; c.height = THUMB;
    drawThumb(c, t);
    cell.appendChild(c);
    if(t.autotile){
      const b = document.createElement('span');
      b.className = 'tp-badge';
      b.textContent = 'A';
      cell.appendChild(b);
    }
    grid.appendChild(cell);
  });
  buildTileForm();
}

/** Met à jour la surbrillance et l'état des outils sans refaire les vignettes. */
export function refreshPaletteSelection(){
  const el = document.getElementById('palette-panel');
  if(!el || !paletteWindow.asset) return;
  const sel = selectedIndex();
  let changed = false;
  el.querySelectorAll('.tp-cell').forEach(function(c){
    const on = Number(c.dataset.index) === sel;
    if(c.classList.contains('selected') !== on) changed = true;
    c.classList.toggle('selected', on);
  });
  el.querySelectorAll('.tp-bar [data-tool2d]').forEach(function(b){
    b.classList.toggle('active', brush2d.tool === b.dataset.tool2d);
  });
  if(changed) buildTileForm();
}

function addSprite(a, value){
  const auto = value.indexOf('auto:') === 0;
  const s = assetOf(auto ? value.slice(5) : value);
  if(!s) return;
  if(s.kind === 'texture'){
    setStatus('Une texture ne va pas dans une palette : créez-en d\'abord un sprite, et découpez-le '
      + 'en tuiles dans son inspecteur.', 6000);
    return;
  }
  if(s.kind !== 'sprite') return;
  const avant = a.palette.tiles.length;
  const n = addSpriteToPalette(a.palette, s, {autotile: auto});
  if(!n){
    setStatus('« ' + s.name + ' » est déjà dans la palette.', 3000);
    return;
  }
  if(!avant) brush2d.material = 1;
  paletteApplied();
  setStatus(n + ' tuile(s) ajoutée(s) depuis « ' + s.name + ' »'
    + ((s.regions || []).length <= 1 && !auto
      ? ' — la planche n\'est pas découpée : découpez-la dans son inspecteur pour une tuile par image.'
      : ''), 5000);
}

function bindPanel(el, a){
  el.querySelector('#tp-palette').addEventListener('change', function(e){
    const p = assetOf(e.target.value);
    if(p) openWindowPalette(p);
  });
  el.querySelector('#tp-add').addEventListener('change', function(e){
    const v = e.target.value;
    e.target.value = '';
    if(v) addSprite(a, v);
  });
  el.querySelector('.tp-tools').addEventListener('click', function(e){
    const b = e.target.closest('[data-tool2d]');
    if(!b) return;
    chooseTool2d(b.dataset.tool2d);
    if(brush2d.tool !== 'none') bindActiveTilemap(a);
    refreshPaletteSelection();
  });
  const grid = el.querySelector('#tp-grid');
  grid.addEventListener('click', function(e){
    const c = e.target.closest('.tp-cell');
    if(c) selectTile(Number(c.dataset.index));
  });
  // Glisser une planche depuis le panneau Projet (même type de données que le reste de
  // l'éditeur, js/assets.js : 'text/asset').
  grid.addEventListener('dragover', function(e){
    if(e.dataTransfer && Array.from(e.dataTransfer.types || []).indexOf('text/asset') !== -1){
      e.preventDefault();
      grid.classList.add('drop');
    }
  });
  grid.addEventListener('dragleave', function(){ grid.classList.remove('drop'); });
  grid.addEventListener('drop', function(e){
    grid.classList.remove('drop');
    const id = e.dataTransfer ? e.dataTransfer.getData('text/asset') : '';
    if(!id) return;
    e.preventDefault();
    addSprite(a, id);
  });
  el.querySelector('#tp-remove').addEventListener('click', function(){
    const i = selectedIndex();
    if(i < 0) return;
    // SUPPRIMER DÉCALE LES INDICES : les cases qui pointaient la tuile retirée pointeraient la
    // suivante, et le décor changerait de matière tout seul. On le dit plutôt que de le faire
    // en silence.
    a.palette.tiles.splice(i, 1);
    brush2d.material = Math.max(1, Math.min(brush2d.material, a.palette.tiles.length));
    paletteApplied();
    setStatus('Tuile supprimée : les cases qui la désignaient pointent maintenant la tuile '
      + 'suivante — vérifiez le décor.', 6000);
  });
}

/**
 * Il n'y a plus rien à brancher au démarrage : la fenêtre pose ses écouteurs à chaque
 * construction. La fonction reste parce que `startup.js` l'appelle, et qu'un appel à une
 * fonction disparue coûterait tout le reste du démarrage.
 */
export function bindPalettePanel(){ /* voir buildPalettePanel */ }

// Appelée par la barre du pinceau (js/brush-tilemap.js) sans import : les deux fichiers
// s'importeraient l'un l'autre.
globalThis.refreshPaletteSelection = refreshPaletteSelection;

/** Dessine les vignettes d'une palette dans les canvas `[data-index]` d'un conteneur. */
export function drawTileThumbs(container, palette){
  if(!container || !palette) return;
  container.querySelectorAll('canvas[data-index]').forEach(function(c){
    const t = palette.tiles[Number(c.dataset.index)];
    if(t) drawThumb(c, t);
  });
}
// L'inspecteur d'asset (js/import-settings.js) s'en sert sans import, pour la même raison.
globalThis.drawTileThumbs = drawTileThumbs;
globalThis.openWindowPalette = openWindowPalette;
