// moteur/js/lightmap-unwrap.js — dépliage AUTOMATIQUE d'UV de lightmap (v1.11.0).
//
// PUR, sans import ni THREE : chargé par lightmap-atlas.js, donc par l'éditeur ET le jeu publié.
// La relecture d'un projet REJOUE ce calcul au lieu de lire un tableau d'UV : il doit donc donner
// exactement le même résultat des deux côtés, à partir des seules positions locales du maillage et
// de la marge mémorisée dans l'entrée d'atlas. Aucun hasard, aucun ordre de tri instable.
//
// LE PROBLÈME. La cuisson rangeait le `uv1` ou le `uv` existant dans l'atlas. Un modèle sans
// dépliage de lightmap n'a que des UV de texture, carrelées ou superposées : plusieurs points du
// monde écrivent alors dans les mêmes texels — éclairage moyenné, taches, aucun halo localisé.
// diagnoseUnfold() (js/lightmap-bake.js) le détectait, et ne faisait que prévenir.
//
// LA MÉTHODE, volontairement simple : chaque triangle devient sa propre carte. Il est posé à plat
// dans son plan (aucune distorsion), à l'échelle de sa surface locale (la résolution suit la
// surface), puis toutes les cartes sont rangées en étagères avec une marge, sans recouvrement.
// Le prix : des coutures entre tous les triangles (la dilatation et le raccord de coutures de la
// cuisson les traitent) et la moitié de chaque rectangle perdue. Un vrai dépliage (Blender,
// xatlas) reste meilleur ; celui-ci est juste, et automatique.

/**
 * Cartes d'UV d'une liste de triangles NON indexée.
 * @param {ArrayLike<number>} positions xyz par sommet, 3 sommets par triangle
 * @param {number} [pad] marge entre cartes, en fraction du carré final (défaut 0,01)
 * @returns {Float32Array} uv par sommet (2 nombres), toutes dans [0,1]²
 */
export function unwrapTriangles(positions, pad){
  const nTri = Math.floor(positions.length / 9);
  const uv = new Float32Array(nTri * 6);
  if(!nTri) return uv;
  const p = (pad > 0) ? Math.min(pad, 0.1) : 0.01;

  // 1. Chaque triangle à plat dans son plan : a = (0,0), b = (|ab|, 0), c = (c·u, c·v).
  const local = new Float64Array(nTri * 6);
  const rects = [];
  let areaSum = 0;
  for(let t = 0; t < nTri; t++){
    const o = t * 9;
    const e1x = positions[o+3] - positions[o],   e1y = positions[o+4] - positions[o+1], e1z = positions[o+5] - positions[o+2];
    const e2x = positions[o+6] - positions[o],   e2y = positions[o+7] - positions[o+1], e2z = positions[o+8] - positions[o+2];
    const l1 = Math.hypot(e1x, e1y, e1z);
    let cu = 0, cv = 0;
    if(l1 > 1e-12){
      const ux = e1x / l1, uy = e1y / l1, uz = e1z / l1;
      cu = e2x*ux + e2y*uy + e2z*uz;
      // composante de e2 orthogonale à u : sa norme est la hauteur du triangle
      cv = Math.hypot(e2x - cu*ux, e2y - cu*uy, e2z - cu*uz);
    }
    const minX = Math.min(0, cu), maxX = Math.max(l1, cu);
    const w = Math.max(maxX - minX, 1e-9), h = Math.max(cv, 1e-9);
    const q = t * 6;
    local[q] = -minX;      local[q+1] = 0;
    local[q+2] = l1 - minX; local[q+3] = 0;
    local[q+4] = cu - minX; local[q+5] = cv;
    rects.push({t: t, w: w, h: h, x: 0, y: 0});
    areaSum += w * h;
  }

  // 2. Marge en unités locales : `p` du côté d'un carré qui contiendrait toutes les cartes.
  const side = Math.sqrt(areaSum);
  const g = p * side;

  // 3. Étagères. Tri par hauteur décroissante, l'indice départageant : tri STABLE et total, donc
  // identique d'un moteur JS à l'autre.
  const order = rects.slice().sort(function(a, b){ return (b.h - a.h) || (a.t - b.t); });
  let packedArea = 0;
  order.forEach(function(r){ packedArea += (r.w + g) * (r.h + g); });
  const shelfW = Math.max(Math.sqrt(packedArea) * 1.05, order.reduce(function(m, r){ return Math.max(m, r.w + g); }, 0));
  let x = g, y = g, shelfH = 0, usedW = 0;
  order.forEach(function(r){
    if(x + r.w + g > shelfW + g && x > g){ x = g; y += shelfH + g; shelfH = 0; }
    r.x = x; r.y = y;
    x += r.w + g;
    if(r.h > shelfH) shelfH = r.h;
    if(x > usedW) usedW = x;
  });
  const usedH = y + shelfH + g;
  // Échelle UNIFORME : les rapports de surface sont conservés (une carte deux fois plus grande
  // dans le monde reçoit deux fois plus de texels).
  const s = 1 / Math.max(usedW, usedH);

  rects.forEach(function(r){
    const q = r.t * 6;
    for(let k = 0; k < 3; k++){
      uv[q + k*2]     = Math.min(1, Math.max(0, (r.x + local[q + k*2]) * s));
      uv[q + k*2 + 1] = Math.min(1, Math.max(0, (r.y + local[q + k*2 + 1]) * s));
    }
  });
  return uv;
}

/**
 * La marge à utiliser pour un maillage, d'après la part de l'atlas qu'il recevra : environ deux
 * texels. `meshTexels` = côté estimé de sa région dans l'atlas, en texels.
 */
export function unwrapPadding(meshTexels){
  const t = Math.max(1, meshTexels || 0);
  return Math.min(0.05, Math.max(0.002, 2 / t));
}
