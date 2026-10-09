// ---------- Sprites ISOMÉTRIQUES cuits à partir d'un modèle 3D décrit en JSON ----------
//
// Le mur qu'on a rencontré en faisant un jeu de stratégie façon Age of Empires : un sprite
// isométrique doit exister dans 8 directions × plusieurs poses, avec ombre portée et couleur
// d'équipe. Dessiné à la main pixel par pixel, c'est des centaines d'images ; généré dans un
// script au lancement, le jeu refait tout à chaque démarrage. Ici on décrit un modèle en
// primitives (boîtes, tubes, ellipsoïdes, toits…), et le moteur le rend UNE fois en planche.
//
// Le rendu : chaque primitive est échantillonnée en points de surface, projetés en dimétrie 2:1
// (la vue d'AoE2 : une tuile au sol fait tile × tile/2 pixels), triés par z-buffer, éclairés par
// une lumière directionnelle venue du haut-gauche. Chaque point projette aussi son ombre au sol.
// Les parties marquées `team` sont rendues en niveaux de gris ET dans un masque séparé : le jeu
// les teinte à la couleur du joueur (luminance du gris × couleur).
//
// Pur : aucun DOM, aucun import. Rend des toiles `{l, h, px}` (px = Uint8ClampedArray RGBA),
// comme js/proc-texture.js. La création d'assets est dans js/copilot-workshop.js.
//
// Repère du modèle : +X devant, +Y à gauche, +Z en haut, en UNITÉS DE TUILE (1 = un côté de
// tuile). L'origine est le point d'ancrage au sol : les pieds d'une unité, le centre de
// l'emprise d'un bâtiment. Direction d : 0 = vers le bas de l'écran, puis sens horaire à
// l'écran par pas de 360/n degrés (d = n/4 : vers la droite). `isoDirOf` fait l'inverse.

const VIEW = [0.612, 0.612, 0.5];

function norm(v){ const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const LIGHT = norm([-0.75, -0.2, 1.0]);

export function isoHash(x, y, z){
  let h = (Math.floor(x) * 374761393 + Math.floor(y) * 668265263 + Math.floor(z) * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function parseHex(h){
  const s = String(h || '').replace('#', '');
  if(!/^[0-9a-fA-F]{6}$/.test(s)) throw new Error('couleur invalide : « ' + h + ' » (attendu #rrggbb)');
  const n = parseInt(s, 16); return [n >> 16 & 255, n >> 8 & 255, n & 255];
}
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const jit = (c, k, h) => { const f = 1 + (h - 0.5) * k; return [c[0] * f, c[1] * f, c[2] * f]; };

/** Direction d (sur n) → angle du modèle autour de z. Le repère local +X devient ce « devant ». */
export function isoDirAngle(d, n){
  const t = d * 2 * Math.PI / n, fx = (Math.cos(t) + Math.sin(t)) / Math.SQRT2, fy = (Math.cos(t) - Math.sin(t)) / Math.SQRT2;
  return Math.atan2(fy, fx);
}
/** L'inverse, pour un jeu : quelle direction (sur n) pour un déplacement monde (dx, dy) ? */
export function isoDirOf(dx, dy, n){
  const sx = dx - dy, sy = (dx + dy) / 2;
  return ((Math.round(Math.atan2(sx, sy) / (2 * Math.PI / n)) % n) + n) % n;
}

// ---------- la scène de rendu ----------
class IsoScene {
  constructor(o){
    this.W = o.w; this.H = o.h; this.ox = o.ox; this.oy = o.oy;
    this.S = o.tile / 2; this.SZ = o.tile / 2 * (o.height === undefined ? 0.92 : o.height);
    this.shadowOn = o.shadow !== false;
    const n = this.W * this.H;
    this.col = new Float32Array(n * 3); this.dep = new Float32Array(n).fill(-1e9);
    this.team = new Uint8Array(n); this.shadow = new Uint8Array(n); this.alpha = new Uint8Array(n);
    this.ca = 1; this.sa = 0; this.k = 1;
  }
  setRotation(angle, k){ this.ca = Math.cos(angle); this.sa = Math.sin(angle); this.k = k; }
  xp(p){ return [(p[0] * this.ca - p[1] * this.sa) * this.k, (p[0] * this.sa + p[1] * this.ca) * this.k, p[2] * this.k]; }
  xn(n){ return [n[0] * this.ca - n[1] * this.sa, n[0] * this.sa + n[1] * this.ca, n[2]]; }
  proj(p){ return [this.ox + (p[0] - p[1]) * this.S, this.oy + (p[0] + p[1]) * this.S / 2 - p[2] * this.SZ]; }
  slen(a, b){ const p = this.proj(a), q = this.proj(b); return Math.hypot(p[0] - q[0], p[1] - q[1]); }
  plot(p, n, c, team, twoSided){
    if(dot(n, VIEW) < -0.02){ if(!twoSided) return; n = mul(n, -1); }
    const q = this.proj(p), x = Math.floor(q[0]), y = Math.floor(q[1]);
    if(x < 0 || y < 0 || x >= this.W || y >= this.H) return;
    const i = y * this.W + x, d = (p[0] + p[1]) * 0.612 + p[2] * 0.5;
    if(d <= this.dep[i]) return;
    this.dep[i] = d;
    const sh = 0.46 + 0.72 * Math.max(0, dot(n, LIGHT)) + 0.08 * Math.max(0, n[2]);
    this.col[i * 3] = c[0] * sh; this.col[i * 3 + 1] = c[1] * sh; this.col[i * 3 + 2] = c[2] * sh;
    this.alpha[i] = 1; this.team[i] = team ? 1 : 0;
    if(this.shadowOn && p[2] > 0.03){
      const g = sub(p, mul(LIGHT, p[2] / LIGHT[2])), s = this.proj(g), sx = Math.floor(s[0]), sy = Math.floor(s[1]);
      if(sx >= 0 && sy >= 0 && sx < this.W && sy < this.H) this.shadow[sy * this.W + sx] = 1;
    }
  }
  emit(pl, nl, m, face, u, v, twoSided){
    const r = m.shade(pl, nl, face, u, v); if(!r) return;
    this.plot(this.xp(pl), this.xn(nl), r, m.team, twoSided || m.twoSided);
  }
  quad(p0, p1, p2, p3, m, face, twoSided){
    const P = [p0, p1, p2, p3].map((p) => this.xp(p));
    let nl = cross(sub(p1, p0), sub(p3, p0));
    if(Math.hypot(nl[0], nl[1], nl[2]) < 1e-9) nl = cross(sub(p1, p0), sub(p2, p0));
    nl = norm(nl);
    const nu = Math.max(1, Math.ceil(Math.max(this.slen(P[0], P[1]), this.slen(P[3], P[2])) / 0.33));
    const nv = Math.max(1, Math.ceil(Math.max(this.slen(P[0], P[3]), this.slen(P[1], P[2])) / 0.33));
    if(nu * nv > 4e6) throw new Error('primitive trop grande pour être rendue');
    for(let j = 0; j <= nv; j++) for(let i = 0; i <= nu; i++){
      const u = i / nu, v = j / nv;
      const a = add(mul(p0, 1 - u), mul(p1, u)), b = add(mul(p3, 1 - u), mul(p2, u));
      this.emit(add(mul(a, 1 - v), mul(b, v)), nl, m, face, u, v, twoSided);
    }
  }
  box(x0, y0, z0, x1, y1, z1, m){
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], m, 'top');
    this.quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], m, 'x');
    this.quad([x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], m, 'y');
    this.quad([x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], m, 'x');
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], m, 'y');
  }
  ellipsoid(c, r, m){
    const rr = Math.max(r[0], r[1], r[2]) * this.k * this.S;
    const nt = Math.max(8, Math.ceil(rr * 2 * Math.PI / 0.33)), np = Math.max(4, Math.ceil(rr * Math.PI / 0.33));
    for(let j = 0; j <= np; j++){
      const ph = -Math.PI / 2 + Math.PI * j / np, cp = Math.cos(ph), sp = Math.sin(ph), nti = Math.max(4, Math.ceil(nt * cp));
      for(let i = 0; i < nti; i++){
        const th = 2 * Math.PI * i / nti, d = [cp * Math.cos(th), cp * Math.sin(th), sp];
        this.emit([c[0] + d[0] * r[0], c[1] + d[1] * r[1], c[2] + d[2] * r[2]], norm([d[0] / r[0], d[1] / r[1], d[2] / r[2]]), m, 'round', i / nti, j / np);
      }
    }
  }
  tube(a, b, ra, rb, m){
    const ax = sub(b, a), len = Math.hypot(ax[0], ax[1], ax[2]); if(len < 1e-6) return;
    const w = mul(ax, 1 / len), t = Math.abs(w[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const u = norm(cross(w, t)), v = cross(w, u);
    const nl = Math.max(2, Math.ceil(len * this.k * this.S / 0.3)), nc = Math.max(6, Math.ceil(Math.max(ra, rb) * this.k * this.S * 2 * Math.PI / 0.33));
    for(let j = 0; j <= nl; j++){
      const s = j / nl, r = ra + (rb - ra) * s, cc = add(a, mul(ax, s));
      for(let i = 0; i < nc; i++){
        const th = 2 * Math.PI * i / nc, d = add(mul(u, Math.cos(th)), mul(v, Math.sin(th)));
        this.emit(add(cc, mul(d, r)), d, m, 'round', s, i / nc);
      }
    }
  }
  disc(c, nrm, r, m){
    const w = norm(nrm), t = Math.abs(w[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0], u = norm(cross(w, t)), v = cross(w, u);
    const nr = Math.max(2, Math.ceil(r * this.k * this.S / 0.33));
    for(let j = 0; j <= nr; j++){
      const rr = r * j / nr, nc = Math.max(6, Math.ceil(rr * this.k * this.S * 2 * Math.PI / 0.33));
      for(let i = 0; i < nc; i++){ const th = 2 * Math.PI * i / nc; this.emit(add(c, add(mul(u, Math.cos(th) * rr), mul(v, Math.sin(th) * rr))), w, m, 'flat', j / nr, i / nc, true); }
    }
  }
  cone(c, r, z, h, m){
    const n = 24, top = [c[0], c[1], z + h];
    for(let i = 0; i < n; i++){
      const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2;
      this.quad([c[0] + Math.cos(a0) * r, c[1] + Math.sin(a0) * r, z], [c[0] + Math.cos(a1) * r, c[1] + Math.sin(a1) * r, z], top, top, m, 'roof');
    }
  }
  hipRoof(x0, y0, x1, y1, z, h, m){
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, lx = x1 - x0, ly = y1 - y0;
    if(lx >= ly){
      const d = ly / 2, a = [x0 + d, cy, z + h], b = [x1 - d, cy, z + h];
      this.quad([x0, y1, z], a, b, [x1, y1, z], m, 'roof'); this.quad([x1, y0, z], b, a, [x0, y0, z], m, 'roof');
      this.quad([x1, y1, z], b, [x1, y0, z], [x1, y0, z], m, 'roof'); this.quad([x0, y0, z], a, [x0, y1, z], [x0, y1, z], m, 'roof');
    } else {
      const d = lx / 2, a = [cx, y0 + d, z + h], b = [cx, y1 - d, z + h];
      this.quad([x1, y0, z], [x1, y1, z], b, a, m, 'roof'); this.quad([x0, y1, z], [x0, y0, z], a, b, m, 'roof');
      this.quad([x0, y1, z], [x1, y1, z], b, b, m, 'roof'); this.quad([x1, y0, z], [x0, y0, z], a, a, m, 'roof');
    }
  }
  gableRoof(x0, y0, x1, y1, z, h, m, wall, axis){
    if(axis !== 'y'){
      const cy = (y0 + y1) / 2;
      this.quad([x0, y1, z], [x0, cy, z + h], [x1, cy, z + h], [x1, y1, z], m, 'roof');
      this.quad([x1, y0, z], [x1, cy, z + h], [x0, cy, z + h], [x0, y0, z], m, 'roof');
      if(wall){ this.quad([x1, y0, z], [x1, y1, z], [x1, cy, z + h], [x1, cy, z + h], wall, 'x'); this.quad([x0, y1, z], [x0, y0, z], [x0, cy, z + h], [x0, cy, z + h], wall, 'x'); }
    } else {
      const cx = (x0 + x1) / 2;
      this.quad([x1, y0, z], [x1, y1, z], [cx, y1, z + h], [cx, y0, z + h], m, 'roof');
      this.quad([x0, y1, z], [x0, y0, z], [cx, y0, z + h], [cx, y1, z + h], m, 'roof');
      if(wall){ this.quad([x0, y1, z], [cx, y1, z + h], [x1, y1, z], [x1, y1, z], wall, 'y'); this.quad([x1, y0, z], [cx, y0, z + h], [x0, y0, z], [x0, y0, z], wall, 'y'); }
    }
  }
  // image recadrée : {l, h, px, mask, ox, oy} (ox, oy = ancrage au sol dans l'image)
  finish(outline){
    const W = this.W, H = this.H;
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for(let y = 0; y < H; y++) for(let x = 0; x < W; x++){ const i = y * W + x; if(this.alpha[i] || this.shadow[i]){ if(x < x0) x0 = x; if(y < y0) y0 = y; if(x > x1) x1 = x; if(y > y1) y1 = y; } }
    if(x1 < 0) return {l: 1, h: 1, px: new Uint8ClampedArray(4), mask: new Uint8ClampedArray(4), ox: 0, oy: 0, hasTeam: false};
    x0 = Math.max(0, x0 - 1); y0 = Math.max(0, y0 - 1); x1 = Math.min(W - 1, x1 + 1); y1 = Math.min(H - 1, y1 + 1);
    const l = x1 - x0 + 1, h = y1 - y0 + 1, px = new Uint8ClampedArray(l * h * 4), mask = new Uint8ClampedArray(l * h * 4);
    let hasTeam = false;
    for(let y = 0; y < h; y++) for(let x = 0; x < l; x++){
      const X = x + x0, Y = y + y0, i = Y * W + X, o = (y * l + x) * 4;
      if(this.alpha[i]){
        let k = 1;
        if(outline) for(const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]){ const X2 = X + dx, Y2 = Y + dy; if(X2 < 0 || Y2 < 0 || X2 >= W || Y2 >= H || !this.alpha[Y2 * W + X2]){ k = 0.6; break; } }
        px[o] = this.col[i * 3] * k; px[o + 1] = this.col[i * 3 + 1] * k; px[o + 2] = this.col[i * 3 + 2] * k; px[o + 3] = 255;
        if(this.team[i]){ mask[o] = mask[o + 1] = mask[o + 2] = mask[o + 3] = 255; hasTeam = true; }
      } else if(this.shadowOn){
        let s = 0, c = 0;
        for(let dy = -1; dy <= 1; dy++) for(let dx = -1; dx <= 1; dx++){ const X2 = X + dx, Y2 = Y + dy; if(X2 >= 0 && Y2 >= 0 && X2 < W && Y2 < H){ c++; s += this.shadow[Y2 * W + X2]; } }
        const a = s / c * 0.28; if(a > 0.01) px[o + 3] = a * 255;
      }
    }
    return {l, h, px, mask, ox: this.ox - x0, oy: this.oy - y0, hasTeam};
  }
}

// ---------- matériaux ----------
export const ISO_MATERIALS = ['solid', 'bricks', 'planks', 'timbered', 'thatch', 'tiles', 'slate', 'leaves'];
function makeMaterial(p){
  const base = parseHex(p.color || '#b0a890'), dark = mix(base, [40, 30, 20], 0.55);
  const k = p.noise === undefined ? 0.12 : +p.noise, kind = p.material || 'solid';
  if(ISO_MATERIALS.indexOf(kind) < 0) throw new Error('matériau inconnu « ' + kind + ' » — valeurs : ' + ISO_MATERIALS.join(', '));
  const team = !!p.team;
  // une partie d'équipe est rendue en gris : c'est sa luminance que le jeu multiplie par la couleur
  const tint = function(c){ if(!team) return c; const g = c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11; return [g, g, g]; };
  const horiz = (q, face) => face === 'x' ? q[1] : q[0];
  let shade;
  switch(kind){
    case 'bricks': shade = function(q, n, face){
      if(face === 'top') return jit(base, 0.2, isoHash(q[0] * 7, q[1] * 7, 9));
      const s = horiz(q, face), row = Math.floor(q[2] / 0.12), col = Math.floor(s / 0.24 + (row % 2) * 0.5);
      const fs = s / 0.24 + (row % 2) * 0.5 - col, fz = q[2] / 0.12 - row;
      if(fs < 0.07 || fz < 0.12) return dark;
      return jit(mix(base, dark, isoHash(col, row, 3) * 0.3), k, isoHash(q[0] * 60, q[1] * 60, q[2] * 60)); }; break;
    case 'planks': shade = function(q, n, face){
      const s = face === 'top' ? q[0] : horiz(q, face), i = Math.floor(s / 0.1);
      if(s / 0.1 - i < 0.1) return dark;
      return jit(mix(base, dark, isoHash(i, 7, 7) * 0.35), k, isoHash(q[0] * 90, q[1] * 90, q[2] * 90)); }; break;
    case 'timbered': {
      const beam = p.color2 ? parseHex(p.color2) : [90, 59, 32], z0 = p.z0 || 0, z1 = p.z1 || 1;
      shade = function(q, n, face){
        if(face === 'top') return beam;
        const s = horiz(q, face), fz = (q[2] - z0) / (z1 - z0), fs = ((s % 0.42) + 0.42) % 0.42;
        if(fz < 0.07 || fz > 0.93 || Math.abs(fz - 0.5) < 0.035 || fs < 0.05) return beam;
        return jit(base, 0.08, isoHash(q[0] * 80, q[1] * 80, q[2] * 80));
      }; break;
    }
    case 'thatch': shade = function(q){ return jit(mix(base, dark, isoHash(Math.floor(q[0] * 30 + q[1] * 30), Math.floor(q[2] / 0.07), 5) * 0.4), k, isoHash(q[0] * 70, q[1] * 70, q[2] * 70)); }; break;
    case 'tiles': case 'slate': shade = function(q){
      const row = Math.floor(q[2] / 0.07), i = Math.floor((q[0] - q[1]) / 0.1 + (row % 2) * 0.5);
      if(q[2] / 0.07 - row < 0.18) return dark;
      return jit(mix(base, dark, isoHash(i, row, 2) * 0.3), k, isoHash(q[0] * 50, q[1] * 50, q[2] * 50)); }; break;
    case 'leaves': shade = function(q){ const b2 = mix(base, [255, 255, 200], 0.25); return jit(mix(base, b2, isoHash(Math.floor(q[0] * 18), Math.floor(q[1] * 18), Math.floor(q[2] * 18))), 0.25, isoHash(q[0] * 60, q[1] * 60, q[2] * 60)); }; break;
    default: shade = function(q){ return jit(base, k, isoHash(q[0] * 40, q[1] * 40, q[2] * 40)); };
  }
  return {team, twoSided: !!p.twoSided, shade: function(q, n, face, u, v){ return tint(shade(q, n, face, u, v)); }};
}

// ---------- primitives JSON ----------
export const ISO_PRIMITIVES = ['box', 'tube', 'ellipsoid', 'sphere', 'quad', 'disc', 'cone', 'hipRoof', 'gableRoof'];
const P3 = (v, what) => { if(!Array.isArray(v) || v.length !== 3 || v.some((x) => typeof x !== 'number' || !isFinite(x))) throw new Error(what + ' : attendu [x, y, z]'); return v; };
function drawPrimitive(sc, p, idx){
  const where = 'primitive ' + idx + ' (' + p.type + ')';
  if(ISO_PRIMITIVES.indexOf(p.type) < 0) throw new Error(where + ' : type inconnu — types : ' + ISO_PRIMITIVES.join(', '));
  const m = makeMaterial(p);
  switch(p.type){
    case 'box': { const a = P3(p.min, where + ' min'), b = P3(p.max, where + ' max'); sc.box(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2]), Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2]), m); break; }
    case 'tube': { const r = p.radius === undefined ? 0.05 : p.radius, r2 = p.radius2 === undefined ? r : p.radius2; sc.tube(P3(p.from, where + ' from'), P3(p.to, where + ' to'), r, r2, m); break; }
    case 'sphere': case 'ellipsoid': { const r = typeof p.radius === 'number' ? [p.radius, p.radius, p.radius] : P3(p.radius, where + ' radius'); sc.ellipsoid(P3(p.center, where + ' center'), r, m); break; }
    case 'quad': { if(!Array.isArray(p.points) || p.points.length < 3 || p.points.length > 4) throw new Error(where + ' : points = 3 ou 4 points [x,y,z]'); const q = p.points.map((v) => P3(v, where + ' point')); sc.quad(q[0], q[1], q[2], q[3] || q[2], m, 'flat', true); break; }
    case 'disc': sc.disc(P3(p.center, where + ' center'), P3(p.normal || [0, 0, 1], where + ' normal'), p.radius || 0.2, m); break;
    case 'cone': { const c = P3(p.center, where + ' center'); sc.cone(c, p.radius || 0.5, c[2], p.height || 1, m); break; }
    case 'hipRoof': case 'gableRoof': {
      const a = P3(p.min, where + ' min'), b = P3(p.max, where + ' max'), o = p.overhang === undefined ? 0.1 : p.overhang;
      if(p.type === 'hipRoof') sc.hipRoof(a[0] - o, a[1] - o, b[0] + o, b[1] + o, a[2] - 0.02, b[2] - a[2], m);
      else sc.gableRoof(a[0] - o, a[1] - o, b[0] + o, b[1] + o, a[2], b[2] - a[2], m, p.wallColor ? makeMaterial({color: p.wallColor, material: p.wallMaterial || 'solid'}) : null, p.axis);
      break;
    }
  }
}

/**
 * Rend un modèle. spec = {frames: [{name, primitives}], directions: 1|2|4|8|16, tile (px, largeur
 * d'une tuile, défaut 96), height (échelle des hauteurs, défaut 0.92), scale (défaut 1), shadow,
 * outline, extent (taille de la zone de rendu en tuiles, défaut 2)}.
 * Rend {images: [{key, frame, dir, l, h, px, mask, ox, oy}], hasTeam}.
 */
export function renderIsoModel(spec){
  const frames = spec.frames;
  if(!Array.isArray(frames) || !frames.length) throw new Error('aucune image à rendre : donnez `primitives` ou `frames`');
  const dirs = spec.directions === undefined ? 1 : spec.directions;
  if([1, 2, 4, 8, 16].indexOf(dirs) < 0) throw new Error('directions : 1, 2, 4, 8 ou 16');
  const tile = spec.tile === undefined ? 96 : spec.tile;
  if(!(tile >= 8 && tile <= 512)) throw new Error('tile : largeur d\'une tuile en pixels, entre 8 et 512');
  const scale = spec.scale === undefined ? 1 : spec.scale;
  const total = frames.reduce((s, f) => s + (f.primitives || []).length, 0) * dirs;
  if(total > 20000) throw new Error('trop de primitives × directions (' + total + ', maximum 20000)');
  const out = []; let hasTeam = false;
  const size = Math.min(2048, Math.ceil(tile * 2 * Math.max(1, scale) * (spec.extent || 2)));
  frames.forEach(function(f, fi){
    if(!Array.isArray(f.primitives) || !f.primitives.length) throw new Error('image ' + fi + ' : aucune primitive');
    const fname = String(f.name === undefined ? fi : f.name);
    for(let d = 0; d < dirs; d++){
      const sc = new IsoScene({w: size, h: size, ox: size / 2, oy: size * 0.72, tile, height: spec.height, shadow: spec.shadow});
      sc.setRotation(dirs === 1 ? 0 : isoDirAngle(d, dirs), scale);
      f.primitives.forEach(function(p, i){ drawPrimitive(sc, p, i); });
      const im = sc.finish(spec.outline !== false);
      hasTeam = hasTeam || im.hasTeam;
      out.push(Object.assign(im, {key: fname + '/' + d, frame: fname, dir: d}));
    }
  });
  return {images: out, hasTeam};
}

/** Range les images en étagères (1 px de marge). Rend {sheet, mask, sprites: {clé: [x, y, l, h, ox, oy]}}. */
export function packIsoSheet(images, maxWidth){
  const maxW = maxWidth || 2048;
  const area = images.reduce((s, im) => s + (im.l + 1) * (im.h + 1), 0);
  const widest = Math.max(...images.map((im) => im.l + 1));
  if(widest > maxW) throw new Error('une image fait ' + widest + ' px de large, plus que la planche (' + maxW + ')');
  const width = Math.min(maxW, Math.max(widest, Math.pow(2, Math.ceil(Math.log2(Math.sqrt(area) * 1.15)))));
  const sorted = images.slice().sort((a, b) => b.h - a.h);
  let x = 0, y = 0, rowH = 0; const pos = new Map();
  for(const im of sorted){ if(x + im.l > width){ x = 0; y += rowH + 1; rowH = 0; } pos.set(im, [x, y]); x += im.l + 1; rowH = Math.max(rowH, im.h); }
  const height = y + rowH;
  if(height > 8192) throw new Error('la planche dépasserait 8192 px de haut : réduisez tile, directions ou images');
  const sheet = new Uint8ClampedArray(width * height * 4), mask = new Uint8ClampedArray(width * height * 4), sprites = {};
  for(const im of images){
    const [x0, y0] = pos.get(im);
    for(let r = 0; r < im.h; r++){ sheet.set(im.px.subarray(r * im.l * 4, (r + 1) * im.l * 4), ((y0 + r) * width + x0) * 4); mask.set(im.mask.subarray(r * im.l * 4, (r + 1) * im.l * 4), ((y0 + r) * width + x0) * 4); }
    sprites[im.key] = [x0, y0, im.l, im.h, Math.round(im.ox), Math.round(im.oy)];
  }
  return {sheet: {l: width, h: height, px: sheet}, mask: {l: width, h: height, px: mask}, sprites};
}
