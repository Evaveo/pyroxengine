// ---------- Terrain heightmap (P2-1) ----------
// Objet de type 'terrain' : grille de hauteurs sculptable à la souris.
// userData.terr = {taille, segments, hauteurs:[…], couleurs, seuils} — entièrement
// sérialisable (les hauteurs sont un tableau plat de (segments+1)² nombres, très
// bien compressé par le gzip du .p3d). Coloration automatique par altitude et
// pente (vertex colors) ; collider CANNON.Heightfield pour la physique.
// pinceau de sculpt (état d'éditeur, non sérialisé)
import { TERRAIN_DEFAULT, terrIdx } from './component-data.js';
import { NodeShells } from './component-registry.js';
import { registerInputs } from './editor-input.js';
import { setStatus } from './hierarchy.js';
import { pushHistory } from './history.js';
import { buildInspector } from './inspector.js';
import { applyNodeMixin } from './node.js';
import { gizmoAttach, renderer, scene, viewEl } from './scene.js';
import { selection } from './selection.js';
import { field } from './shader-graph-editor.js';
import { camCurrent, coordsMouse, mode, mouse, raycaster } from './viewport.js';

export const sculpt = {
  active: false, target: null, mode: 'elever',
  radius: 5, force: 0.6, inProgress: false, aPousseHisto: false
};
export const SCULPT_MODES = [
  ['elever',  'Élever'],
  ['creuser', 'Creuser'],
  ['lisser',  'Lisser'],
  ['flatten', 'Aplanir (au niveau du clic)'],
  ['noise',   'Bruit (rugosité)']
];

// Construit la géométrie/matériau de terrain à partir de données déjà normalisées
// (t.segments/t.hauteurs cohérents) — partagé par buildTerrain() (création)
// et Terrain.onAdd() (ajout du composant sur un Noeud qui n'a pas encore la
// géométrie de terrain, ex: objet Vide via +Component).
export function buildGeometryTerrain(t){
  const seg = t.segments;
  const n = (seg + 1) * (seg + 1);
  const geo = new THREE.PlaneGeometry(t.size, t.size, seg, seg);
  geo.rotateX(-Math.PI / 2);          // plan XZ, hauteur sur Y
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.92, metalness: 0, flatShading: false});
  return {geo: geo, mat: mat};
}

export function buildTerrain(data){
  const t = Object.assign(JSON.parse(JSON.stringify(TERRAIN_DEFAULT)), data || {});
  const seg = Math.max(4, Math.min(200, t.segments | 0));
  t.segments = seg;
  const n = (seg + 1) * (seg + 1);
  if(!Array.isArray(t.heights) || t.heights.length !== n) t.heights = new Array(n).fill(0);

  const construit = buildGeometryTerrain(t);
  const mesh = new THREE.Mesh(construit.geo, construit.mat);
  mesh.name = 'Terrain';
  mesh.userData.type = 'terrain';
  mesh.userData.terr = t;
  mesh.userData.emissiveBase = 0x000000;
  mesh.userData.emissiveSel = 0x1e3a2a;
  mesh.receiveShadow = true;
  mesh.castShadow = false;            // un terrain qui s'auto-ombre coûte cher pour rien
  applyHeightsTerrain(mesh);
  applyNodeMixin(mesh);
  mesh.addComponent('Terrain', t);
  return mesh;
}

// index d'un sommet (ix, iz) dans les tableaux
// écrit les hauteurs dans la géométrie + recalcule couleurs et normales
export function applyHeightsTerrain(o){
  const t = o.userData.terr;
  const seg = t.segments;
  const pos = o.geometry.attributes.position;
  const col = o.geometry.attributes.color;
  // PlaneGeometry énumère les sommets par lignes (z croissant) : même ordre que nos index
  let hMax = 0.001;
  for(let i = 0; i < t.heights.length; i++) hMax = Math.max(hMax, Math.abs(t.heights[i]));
  for(let i = 0; i < t.heights.length; i++) pos.setY(i, t.heights[i]);
  pos.needsUpdate = true;
  o.geometry.computeVertexNormals();

  // coloration par altitude + pente
  const cBottom = new THREE.Color(t.colorBottom);
  const cTop = new THREE.Color(t.colorTop);
  const cNeige = new THREE.Color(t.colorNeige);
  const nrm = o.geometry.attributes.normal;
  const c = new THREE.Color();
  const step = t.size / seg;
  for(let iz = 0; iz <= seg; iz++){
    for(let ix = 0; ix <= seg; ix++){
      const i = terrIdx(t, ix, iz);
      const alt = t.heights[i] / hMax;                   // 0 … 1 (relatif au plus haut)
      let f = Math.max(0, Math.min(1, (alt - t.thresholdRoche) / Math.max(0.01, 1 - t.thresholdRoche)));
      if(t.rolloff){
        // normale peu verticale = pente forte → roche
        const rolloff = 1 - Math.abs(nrm.getY(i));
        f = Math.max(f, Math.min(1, rolloff * 2.2));
      }
      c.copy(cBottom).lerp(cTop, f);
      if(alt > t.thresholdNeige){
        const fn = Math.min(1, (alt - t.thresholdNeige) / Math.max(0.01, 1 - t.thresholdNeige));
        c.lerp(cNeige, fn);
      }
      col.setXYZ(i, c.r, c.g, c.b);
    }
  }
  col.needsUpdate = true;
  o.geometry.computeBoundingSphere();
  o.geometry.computeBoundingBox();
  void step;
}

// hauteur du terrain sous un point monde (interpolation bilinéaire) — utile aux scripts
export function heightTerrainIn(o, x, z){
  const t = o.userData.terr;
  const local = o.worldToLocal(new THREE.Vector3(x, 0, z));
  const half = t.size / 2;
  const fx = (local.x + half) / t.size * t.segments;
  const fz = (local.z + half) / t.size * t.segments;
  if(fx < 0 || fz < 0 || fx > t.segments || fz > t.segments) return null;
  const ix = Math.min(t.segments - 1, Math.floor(fx));
  const iz = Math.min(t.segments - 1, Math.floor(fz));
  const dx = fx - ix, dz = fz - iz;
  const h00 = t.heights[terrIdx(t, ix, iz)];
  const h10 = t.heights[terrIdx(t, ix + 1, iz)];
  const h01 = t.heights[terrIdx(t, ix, iz + 1)];
  const h11 = t.heights[terrIdx(t, ix + 1, iz + 1)];
  const h = h00 * (1 - dx) * (1 - dz) + h10 * dx * (1 - dz)
          + h01 * (1 - dx) * dz + h11 * dx * dz;
  return o.position.y + h;
}

// ----- génération procédurale (bruit fractal simple, déterministe) -----
export function generateTerrain(o, amplitude, scale, graine){
  const t = o.userData.terr;
  const seg = t.segments;
  let s = (graine === undefined ? 1234 : graine) | 0;
  function alea(){ s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }
  // grilles de bruit à 3 octaves, interpolées en douceur
  const octaves = [];
  for(let o2 = 0; o2 < 3; o2++){
    const n = Math.max(2, Math.round((seg / Math.max(1, scale || 8)) * Math.pow(2, o2))) + 1;
    const g = new Float32Array(n * n);
    for(let i = 0; i < g.length; i++) g[i] = alea() * 2 - 1;
    octaves.push({n: n, g: g, amp: (amplitude || 6) / Math.pow(2, o2)});
  }
  function lisse(a){ return a * a * (3 - 2 * a); }
  for(let iz = 0; iz <= seg; iz++){
    for(let ix = 0; ix <= seg; ix++){
      let h = 0;
      octaves.forEach(function(oc){
        const fx = (ix / seg) * (oc.n - 1), fz = (iz / seg) * (oc.n - 1);
        const x0 = Math.floor(fx), z0 = Math.floor(fz);
        const x1 = Math.min(oc.n - 1, x0 + 1), z1 = Math.min(oc.n - 1, z0 + 1);
        const tx = lisse(fx - x0), tz = lisse(fz - z0);
        const v00 = oc.g[z0 * oc.n + x0], v10 = oc.g[z0 * oc.n + x1];
        const v01 = oc.g[z1 * oc.n + x0], v11 = oc.g[z1 * oc.n + x1];
        h += oc.amp * (v00 * (1 - tx) * (1 - tz) + v10 * tx * (1 - tz)
                     + v01 * (1 - tx) * tz + v11 * tx * tz);
      });
      t.heights[terrIdx(t, ix, iz)] = h;
    }
  }
  applyHeightsTerrain(o);
}

export function flattenTerrain(o){
  const t = o.userData.terr;
  for(let i = 0; i < t.heights.length; i++) t.heights[i] = 0;
  applyHeightsTerrain(o);
}

// ----- sculpt -----
export function toggleSculpt(o){
  if(sculpt.active && sculpt.target === o){ stopSculpt(); return; }
  const comp = o.getComponent && o.getComponent('Terrain');
  if(comp && !comp.active){ setStatus('Composant Terrain désactivé — réactivez-le pour sculpter', 2500); return; }
  sculpt.active = true;
  sculpt.target = o;
  viewEl.classList.add('sculpt');
  gizmoAttach(null);
  setStatus('⛏ Sculpture : glissez dans la vue pour modeler · molette = rayon · '
    + 'Maj = inverser · Échap pour quitter', 6000);
  buildInspector();
}

export function stopSculpt(){
  if(!sculpt.active) return;
  sculpt.active = false;
  sculpt.target = null;
  sculpt.inProgress = false;
  viewEl.classList.remove('sculpt');
  if(selection) gizmoAttach(selection);
  setStatus('Sculpture terminée', 1500);
  buildInspector();
}

// applique le pinceau autour d'un point monde
export function brushTerrain(o, pointWorld, invert){
  const t = o.userData.terr;
  const seg = t.segments;
  const local = o.worldToLocal(pointWorld.clone());
  const half = t.size / 2;
  const step = t.size / seg;
  const cx = (local.x + half) / step;      // centre en coordonnées de grille
  const cz = (local.z + half) / step;
  const radiusG = sculpt.radius / step;
  const x0 = Math.max(0, Math.floor(cx - radiusG)), x1 = Math.min(seg, Math.ceil(cx + radiusG));
  const z0 = Math.max(0, Math.floor(cz - radiusG)), z1 = Math.min(seg, Math.ceil(cz + radiusG));
  const signe = invert ? -1 : 1;
  const target = local.y;                  // pour « aplanir » : hauteur du point cliqué

  // le lissage lit les hauteurs d'origine pour ne pas se propager pendant la boucle
  const source = (sculpt.mode === 'lisser') ? t.heights.slice() : null;

  for(let iz = z0; iz <= z1; iz++){
    for(let ix = x0; ix <= x1; ix++){
      const d = Math.hypot(ix - cx, iz - cz) / radiusG;
      if(d > 1) continue;
      const weight = Math.pow(1 - d * d, 2);          // atténuation douce au bord
      const i = terrIdx(t, ix, iz);
      const f = sculpt.force * weight;
      if(sculpt.mode === 'elever')       t.heights[i] += signe * f * 0.5;
      else if(sculpt.mode === 'creuser') t.heights[i] -= signe * f * 0.5;
      else if(sculpt.mode === 'flatten') t.heights[i] += (target - t.heights[i]) * Math.min(1, f);
      else if(sculpt.mode === 'noise')   t.heights[i] += (Math.random() * 2 - 1) * f * 0.4;
      else if(sculpt.mode === 'lisser'){
        let somme = 0, nb = 0;
        for(let dz = -1; dz <= 1; dz++)
          for(let dx = -1; dx <= 1; dx++){
            const jx = ix + dx, jz = iz + dz;
            if(jx < 0 || jz < 0 || jx > seg || jz > seg) continue;
            somme += source[terrIdx(t, jx, jz)];
            nb++;
          }
        t.heights[i] += (somme / nb - t.heights[i]) * Math.min(1, f);
      }
    }
  }
  applyHeightsTerrain(o);
}

// interception des événements pointeur quand la sculpt est active (capture)
export function terrPointFrom(e, o){
  coordsMouse(e);
  scene.updateMatrixWorld(true);
  raycaster.setFromCamera(mouse, camCurrent());
  const hits = raycaster.intersectObject(o, false);
  return hits.length ? hits[0].point : null;
}

// ----- sculpt : enregistrée dans le dispatcher d'entrées (priorité la plus haute) -----
//
// DIFFÉRÉE POUR LA MÊME RAISON QUE `bindEditorInput` : `registerInputs` écrit dans `inputs`, un
// `const` de `editor-input.js`. Ce fichier est dans un cycle d'imports avec lui (via scene.js ->
// objects.js -> terrain.js -> editor-input.js) ; y appeler `registerInputs` au premier niveau ne
// tenait que par l'ordre de résolution des imports, pas par le graphe de modules — et s'est
// rompu en zone morte temporelle sur `inputs`. Appelée par `startup.js`.
export function bindTerrainInputs(){
  registerInputs({
  name: 'sculpt',
  priorite: 30,
  pointerdown: function(e){
    if(!sculpt.active || !sculpt.target || e.button !== 0) return false;
    const pt = terrPointFrom(e, sculpt.target);
    if(!pt) return true;
    e.preventDefault();
    if(!sculpt.aPousseHisto){ pushHistory(); sculpt.aPousseHisto = true; }
    sculpt.inProgress = true;
    renderer.domElement.setPointerCapture(e.pointerId);
    brushTerrain(sculpt.target, pt, e.shiftKey);
    return true;
  },
  pointermove: function(e){
    if(!sculpt.active || !sculpt.inProgress || !sculpt.target) return false;
    const pt = terrPointFrom(e, sculpt.target);
    if(pt) brushTerrain(sculpt.target, pt, e.shiftKey);
    return true;
  },
  pointerup: function(e){
    if(!sculpt.active) return false;
    sculpt.inProgress = false;
    sculpt.aPousseHisto = false;   // le prochain trait ouvre un nouvel undo
    if(renderer.domElement.hasPointerCapture(e.pointerId))
      renderer.domElement.releasePointerCapture(e.pointerId);
    return true;
  },
  wheel: function(e){
    if(!sculpt.active) return false;
    e.preventDefault();
    sculpt.radius = Math.max(0.5, Math.min(40, sculpt.radius * (e.deltaY > 0 ? 1.12 : 0.89)));
    setStatus('Rayon du pinceau : ' + (Math.round(sculpt.radius * 10) / 10) + ' m', 1200);
    const field = document.getElementById('f-sc-radius');
    if(field) field.value = Math.round(sculpt.radius * 10) / 10;
    return true;
  },
  escape: function(){
    if(!sculpt.active) return false;
    stopSculpt();
    return true;
  }
  });
}

// Le porteur d'un terrain : sa géométrie EST ses données, les hauteurs sont rejouées à la
// construction (voir NodeShells, js/component.js).
NodeShells.register('Terrain', function(d){ return buildTerrain(d || null); });


// EXPOSÉ EN GLOBALE, à dessein. Ces symboles sont appelés depuis des fichiers
// que les mêmes pages ne chargent pas toutes : un `import` y pointerait un
// fichier absent, et la page ne démarrerait pas. Ils gardent donc leur garde
// `typeof` côté appelant, et se déclarent ici.
globalThis.applyHeightsTerrain = applyHeightsTerrain;
globalThis.buildGeometryTerrain = buildGeometryTerrain;
globalThis.sculpt = sculpt;
globalThis.stopSculpt = stopSculpt;