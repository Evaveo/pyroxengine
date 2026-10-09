// ---------- La grille du brouillard de guerre : inconnu, exploré, vu ----------
//
// Le noyau PUR du brouillard (js/components/component-fog-of-war.js) : ni three ni DOM, testé
// sous node. Une case vaut 0 (jamais vue), 1 (explorée, plus en vue) ou 2 (en vue). À chaque mise
// à jour, tout ce qui était vu redevient « exploré », puis chaque source de vision rallume son
// disque — c'est ce qui fait que l'ombre se referme derrière une unité qui s'éloigne.

export const FOG_UNKNOWN = 0, FOG_EXPLORED = 1, FOG_VISIBLE = 2;

export function createFogGrid(cols, rows){
  const c = Math.max(1, Math.min(1024, cols | 0)), r = Math.max(1, Math.min(1024, rows | 0));
  return {cols: c, rows: r, state: Uint8Array.from({length: c * r}, () => 0), disks: Object.create(null)};
}

/** Tout ce qui était en vue redevient exploré (début d'une mise à jour). */
export function fogBeginUpdate(g){
  const s = g.state;
  for(let i = 0; i < s.length; i++) if(s[i] === FOG_VISIBLE) s[i] = FOG_EXPLORED;
}

/** Les décalages d'un disque de rayon r (en cases), mis en cache. */
function diskOf(g, r){
  const k = Math.max(0, Math.round(r));
  if(g.disks[k]) return g.disks[k];
  const out = [];
  for(let dy = -k; dy <= k; dy++) for(let dx = -k; dx <= k; dx++) if(dx * dx + dy * dy <= k * k + k) out.push(dx, dy);
  return (g.disks[k] = out);
}

/** Allume le disque de rayon `r` cases autour de la case (cx, cy). */
export function fogReveal(g, cx, cy, r){
  const d = diskOf(g, r), s = g.state, C = g.cols, R = g.rows;
  for(let k = 0; k < d.length; k += 2){
    const x = cx + d[k], y = cy + d[k + 1];
    if(x >= 0 && y >= 0 && x < C && y < R) s[y * C + x] = FOG_VISIBLE;
  }
}

/** Tout en vue (fin de partie, spectateur). */
export function fogRevealAll(g){ g.state.fill(FOG_VISIBLE); }

/** La case d'un point du monde (x, z), ou -1 hors grille. `origin` = coin (x, z) minimal. */
export function fogCellIndex(g, x, z, origin, cellSize){
  const cx = Math.floor((x - origin[0]) / cellSize), cy = Math.floor((z - origin[1]) / cellSize);
  return (cx < 0 || cy < 0 || cx >= g.cols || cy >= g.rows) ? -1 : cy * g.cols + cx;
}

export function fogStateAt(g, x, z, origin, cellSize){
  const i = fogCellIndex(g, x, z, origin, cellSize);
  return i < 0 ? FOG_UNKNOWN : g.state[i];
}

/**
 * Écrit l'opacité de chaque case dans un tampon RGBA (une case = un texel). `rgb` = couleur du
 * brouillard (0..255), `exploredAlpha` 0..1. Rend le tampon.
 */
export function fogToRGBA(g, out, rgb, exploredAlpha){
  const s = g.state, ea = Math.round(Math.max(0, Math.min(1, exploredAlpha)) * 255);
  for(let i = 0; i < s.length; i++){
    const o = i * 4;
    out[o] = rgb[0]; out[o + 1] = rgb[1]; out[o + 2] = rgb[2];
    out[o + 3] = s[i] === FOG_VISIBLE ? 0 : s[i] === FOG_EXPLORED ? ea : 255;
  }
  return out;
}
