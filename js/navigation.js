// ---------- Navigation IA (P1-4) ----------
// Grille d'occupation au sol + A* 8 directions + lissage par ligne de vue.
// La grille se construit paresseusement au premier appel pendant la lecture
// (les obstacles = meshes/modèles visibles qui chevauchent la tranche de
// marche 0,15 m – 1,8 m ; les triggers et les objets tagués « sol » sont
// ignorés). API scripts : api.pathTo, api.moveTo, api.patrol.
import { grid } from './scene.js';

export const NAV_CELL = 0.5;    // taille d'une cellule (m)
export const NAV_HALF = 40;        // demi-étendue de la grille (–40 … 40 m)

export const engineNav = {grid: null, states: new Map()};

export function navReset(){
  engineNav.grid = null;
  engineNav.states = new Map();
}

export const _nBox = new THREE.Box3();
export function navBuildGrid(listObjects){
  const nx = Math.round((NAV_HALF * 2) / NAV_CELL);
  const bloque = new Uint8Array(nx * nx);
  const marge = 0.25;   // rayon de l'agent
  listObjects.forEach(function(o){
    const t = o.userData.type;
    if(t !== 'mesh' && t !== 'model') return;
    if(!visibleIntent(o)) return;
    if(o.userData.game && o.userData.game.tag === 'ground') return;
    if(o.userData.collider && o.userData.collider.trigger) return;
    _nBox.setFromObject(o);
    if(_nBox.isEmpty()) return;
    // ne bloque que ce qui chevauche la tranche de marche (sols plats exclus)
    if(_nBox.max.y < 0.15 || _nBox.min.y > 1.8) return;
    const x0 = Math.max(0, Math.floor((_nBox.min.x - marge + NAV_HALF) / NAV_CELL));
    const x1 = Math.min(nx - 1, Math.floor((_nBox.max.x + marge + NAV_HALF) / NAV_CELL));
    const z0 = Math.max(0, Math.floor((_nBox.min.z - marge + NAV_HALF) / NAV_CELL));
    const z1 = Math.min(nx - 1, Math.floor((_nBox.max.z + marge + NAV_HALF) / NAV_CELL));
    for(let z = z0; z <= z1; z++)
      for(let x = x0; x <= x1; x++) bloque[z * nx + x] = 1;
  });
  return {nx: nx, bloque: bloque};
}

export function navGrid(listObjects){
  if(!engineNav.grid) engineNav.grid = navBuildGrid(listObjects);
  return engineNav.grid;
}

export function navCell(v){
  return {
    x: Math.max(0, Math.min(159, Math.floor((v.x + NAV_HALF) / NAV_CELL))),
    z: Math.max(0, Math.min(159, Math.floor((v.z + NAV_HALF) / NAV_CELL)))
  };
}
export function navWorld(cx, cz){
  return {x: (cx + 0.5) * NAV_CELL - NAV_HALF, z: (cz + 0.5) * NAV_CELL - NAV_HALF};
}

// cellule libre la plus proche (spirale) — pour départ/arrivée dans un mur
export function navFreeNear(g, cx, cz){
  if(!g.bloque[cz * g.nx + cx]) return {x: cx, z: cz};
  for(let r = 1; r < 12; r++){
    for(let dz = -r; dz <= r; dz++)
      for(let dx = -r; dx <= r; dx++){
        if(Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = cx + dx, z = cz + dz;
        if(x < 0 || z < 0 || x >= g.nx || z >= g.nx) continue;
        if(!g.bloque[z * g.nx + x]) return {x: x, z: z};
      }
  }
  return null;
}

// ligne de vue sur la grille (Bresenham canonique, dz négatif) — pour lisser le chemin
export function navLineFree(g, a, b){
  let x0 = a.x, z0 = a.z;
  const dx = Math.abs(b.x - x0), dz = -Math.abs(b.z - z0);
  const sx = x0 < b.x ? 1 : -1, sz = z0 < b.z ? 1 : -1;
  let err = dx + dz;
  let garde = 0;
  while(garde++ < 4000){
    if(g.bloque[z0 * g.nx + x0]) return false;
    if(x0 === b.x && z0 === b.z) return true;
    const e2 = 2 * err;
    if(e2 >= dz){
      if(x0 === b.x) return true;   // fin de course sur x : ligne parcourue
      err += dz;
      x0 += sx;
    }
    if(e2 <= dx){
      if(z0 === b.z) return true;
      err += dx;
      z0 += sz;
    }
  }
  return false;
}

// A* 8 directions (tas binaire), coupe de coin interdite
export function navAstar(g, dep, arr){
  const nx = g.nx, n = nx * nx;
  const gScore = new Float32Array(n).fill(Infinity);
  const parent = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const iDep = dep.z * nx + dep.x, iArr = arr.z * nx + arr.x;
  const tas = [iDep];            // indices, triés par f
  const fScore = new Float32Array(n).fill(Infinity);
  gScore[iDep] = 0;
  fScore[iDep] = Math.hypot(arr.x - dep.x, arr.z - dep.z);
  function tasMonte(i){
    while(i > 0){
      const p = (i - 1) >> 1;
      if(fScore[tas[p]] <= fScore[tas[i]]) break;
      const t = tas[p]; tas[p] = tas[i]; tas[i] = t;
      i = p;
    }
  }
  function tasPop(){
    const min = tas[0];
    const end = tas.pop();
    if(tas.length){
      tas[0] = end;
      let i = 0;
      while(true){
        const a = 2*i + 1, b = 2*i + 2;
        let m = i;
        if(a < tas.length && fScore[tas[a]] < fScore[tas[m]]) m = a;
        if(b < tas.length && fScore[tas[b]] < fScore[tas[m]]) m = b;
        if(m === i) break;
        const t = tas[m]; tas[m] = tas[i]; tas[i] = t;
        i = m;
      }
    }
    return min;
  }
  const DIRS = [[1,0,1],[-1,0,1],[0,1,1],[0,-1,1],[1,1,1.414],[1,-1,1.414],[-1,1,1.414],[-1,-1,1.414]];
  let garde = 0;
  while(tas.length && garde++ < 30000){
    const cour = tasPop();
    if(cour === iArr) break;
    if(closed[cour]) continue;
    closed[cour] = 1;
    const cx = cour % nx, cz = (cour / nx) | 0;
    for(let d = 0; d < 8; d++){
      const x = cx + DIRS[d][0], z = cz + DIRS[d][1];
      if(x < 0 || z < 0 || x >= nx || z >= nx) continue;
      const idx = z * nx + x;
      if(g.bloque[idx] || closed[idx]) continue;
      // diagonale : les deux cellules orthogonales doivent être libres
      if(DIRS[d][0] && DIRS[d][1]){
        if(g.bloque[cz * nx + x] || g.bloque[z * nx + cx]) continue;
      }
      const cost = gScore[cour] + DIRS[d][2];
      if(cost < gScore[idx]){
        gScore[idx] = cost;
        fScore[idx] = cost + Math.hypot(arr.x - x, arr.z - z);
        parent[idx] = cour;
        tas.push(idx);
        tasMonte(tas.length - 1);
      }
    }
  }
  if(parent[iArr] === -1 && iArr !== iDep) return null;
  // remontée puis lissage par ligne de vue
  const raw = [];
  let i = iArr;
  while(i !== -1){ raw.unshift({x: i % nx, z: (i / nx) | 0}); i = parent[i]; }
  const lisse = [raw[0]];
  let a = 0;
  while(a < raw.length - 1){
    let b = raw.length - 1;
    while(b > a + 1 && !navLineFree(g, raw[a], raw[b])) b--;
    lisse.push(raw[b]);
    a = b;
  }
  return lisse;
}

// position {x,z} depuis un objet, un nom d'objet ou un {x,z}
export function navPos(target, listObjects){
  if(!target) return null;
  if(typeof target === 'string'){
    const o = listObjects.find(function(x){ return x.name === target; });
    return o ? o.getWorldPosition(new THREE.Vector3()) : null;
  }
  if(target.isObject3D) return target.getWorldPosition(new THREE.Vector3());
  if(target.x !== undefined && target.z !== undefined) return target;
  return null;
}

// chemin en points monde entre deux positions ; null si impossible
export function navFilePath(depuis, vers, listObjects){
  const g = navGrid(listObjects);
  const a0 = navFreeNear(g, navCell(depuis).x, navCell(depuis).z);
  const b0 = navFreeNear(g, navCell(vers).x, navCell(vers).z);
  if(!a0 || !b0) return null;
  const cells = navAstar(g, a0, b0);
  if(!cells) return null;
  const pts = cells.map(function(c){
    const m = navWorld(c.x, c.z);
    return {x: m.x, y: depuis.y || 0, z: m.z};
  });
  // dernière étape : la destination exacte si la cellule d'arrivée n'était pas déplacée
  pts[pts.length - 1] = {x: vers.x, y: depuis.y || 0, z: vers.z};
  return pts;
}

// avance o d'un pas le long d'un chemin vers cible ; renvoie true à l'arrivée
export function navAdvance(o, target, speed, dt, listObjects){
  const but = navPos(target, listObjects);
  if(!but) return false;
  let state = engineNav.states.get(o);
  if(!state){ state = {}; engineNav.states.set(o, state); }
  const keyBut = Math.round(but.x * 2) + ':' + Math.round(but.z * 2);
  if(state.keyBut !== keyBut){
    state.filePath = navFilePath(o.position, but, listObjects);
    state.idx = 1;
    state.keyBut = keyBut;
  }
  if(!state.filePath) return false;
  const arrivee = state.filePath[state.filePath.length - 1];
  if(Math.hypot(o.position.x - arrivee.x, o.position.z - arrivee.z) < 0.2) return true;
  let wp = state.filePath[Math.min(state.idx, state.filePath.length - 1)];
  if(Math.hypot(o.position.x - wp.x, o.position.z - wp.z) < 0.15 && state.idx < state.filePath.length - 1){
    state.idx++;
    wp = state.filePath[state.idx];
  }
  const dx = wp.x - o.position.x, dz = wp.z - o.position.z;
  const d = Math.hypot(dx, dz);
  if(d > 1e-4){
    const step = Math.min(d, (speed || 2) * dt);
    o.position.x += (dx / d) * step;
    o.position.z += (dz / d) * step;
    o.rotation.y = Math.atan2(dx, dz);
  }
  return Math.hypot(o.position.x - arrivee.x, o.position.z - arrivee.z) < 0.2;
}

// patrouille cyclique entre plusieurs points / objets
export function navPatrol(o, points, speed, dt, listObjects){
  if(!points || !points.length) return;
  let p = engineNav.states.get(o);
  if(!p){ p = {}; engineNav.states.set(o, p); }
  if(p.patrouille === undefined) p.patrouille = 0;
  const idx = p.patrouille % points.length;
  if(navAdvance(o, points[idx], speed, dt, listObjects)){
    p.patrouille = (idx + 1) % points.length;
    p.keyBut = null;   // force le recalcul vers le point suivant
  }
}


// EXPOSÉ EN GLOBALE, à dessein. Ces symboles sont appelés depuis des fichiers
// que les mêmes pages ne chargent pas toutes : un `import` y pointerait un
// fichier absent, et la page ne démarrerait pas. Ils gardent donc leur garde
// `typeof` côté appelant, et se déclarent ici.
globalThis.NAV_CELL = NAV_CELL;
globalThis.NAV_HALF = NAV_HALF;
globalThis._nBox = _nBox;