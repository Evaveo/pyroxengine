// ---------- Profiler & budgets (P2-3) ----------
// Overlay temps réel : FPS, temps par poste (scripts / physique / particules /
// rendu), draw calls, triangles, mémoire GPU, effectifs de scène — comparés à
// un budget de plateforme (PC ou mobile). Coût nul quand il est désactivé :
// depthStart/depthEnd sortent immédiatement si profiler.active est faux.
import { ed } from './component-data.js';
import { setStatus } from './hierarchy.js';
import { objects } from './objects.js';
import { engineParticles } from './particles.js';
import { renderer, viewEl } from './scene.js';

export const DEPTH_BUDGETS = {
  pc:     {name: 'PC / desktop', fps: 60, drawCalls: 400, triangles: 1500000, textures: 80, lights: 8},
  mobile: {name: 'Mobile / web léger', fps: 30, drawCalls: 100, triangles: 300000, textures: 30, lights: 4}
};

export const profiler = {
  active: false,
  budget: 'pc',
  time: {},          // poste → ms cumulées de l'image en cours
  _t0: {},            // horodatages d'ouverture
  moyennes: {},       // poste → ms lissées
  fps: 0,
  hist: [],           // 120 derniers temps d'image (ms)
  el: null, canvas: null, lastRender: 0
};

export function depthStart(key){
  if(!profiler.active) return;
  profiler._t0[key] = performance.now();
}
export function depthEnd(key){
  if(!profiler.active) return;
  const t = profiler._t0[key];
  if(t === undefined) return;
  profiler.time[key] = (profiler.time[key] || 0) + (performance.now() - t);
}

export function toggleProfiler(){
  profiler.active = !profiler.active;
  if(profiler.active){
    if(!profiler.el) depthBuildUI();
    profiler.el.style.display = 'block';
    profiler.hist = [];
    setStatus('Profiler activé — budget ' + DEPTH_BUDGETS[profiler.budget].name, 2500);
  } else {
    if(profiler.el) profiler.el.style.display = 'none';
    setStatus('Profiler désactivé', 1500);
  }
}

export function depthBuildUI(){
  profiler.el = document.createElement('div');
  profiler.el.id = 'profiler';
  profiler.el.innerHTML =
    '<div id="prof-header"><b>📊 Profiler</b>'
    + '<span><select id="prof-budget">'
    + Object.keys(DEPTH_BUDGETS).map(function(k){
        return '<option value="' + k + '">' + DEPTH_BUDGETS[k].name + '</option>';
      }).join('')
    + '</select><button id="prof-close" title="Fermer (Affichage → Profiler)">✕</button></span></div>'
    + '<canvas id="prof-graph" width="230" height="38"></canvas>'
    + '<div id="prof-body"></div>';
  viewEl.appendChild(profiler.el);
  profiler.canvas = document.getElementById('prof-graph');
  document.getElementById('prof-budget').value = profiler.budget;
  document.getElementById('prof-budget').addEventListener('input', function(){
    profiler.budget = this.value;
  });
  document.getElementById('prof-close').addEventListener('click', toggleProfiler);
}

// `info.render.calls` ne compte PAS la même chose selon le renderer : sous WebGPURenderer
// c'est le nombre de PASSES de rendu (1 à 6 avec le post-traitement), et les draw calls
// vivent dans `render.drawCalls`, incrémenté par Info.update() — au même endroit que
// `triangles`, qui lui est donc resté juste. Afficher `calls` rendait le budget draw calls
// toujours vert : quelques unités face à un budget de plusieurs centaines.
export function depthDrawCalls(info){
  const r = info && info.render;
  if(!r) return 0;
  return (r.drawCalls !== undefined) ? r.drawCalls : (r.calls || 0);
}

// ligne « valeur / budget » avec code couleur (vert < 75 %, orange < 100 %, rouge au-delà)
export function depthNumber(v){
  if(v >= 10000) return Math.round(v / 1000) + 'k';
  if(v >= 100) return Math.round(v);
  return Math.round(v * 10) / 10;
}

export function depthLine(caption, value, budget, unite, inverse){
  let classe = 'ok';
  if(budget){
    if(inverse){                     // FPS : sous le budget = bad
      classe = value >= budget ? 'ok' : (value >= budget * 0.75 ? 'medium' : 'bad');
    } else {
      const ratio = value / budget;
      classe = ratio <= 0.75 ? 'ok' : (ratio <= 1 ? 'medium' : 'bad');
    }
  }
  return '<div class="prof-l"><span>' + caption + '</span>'
    + '<span class="' + classe + '">' + depthNumber(value) + (unite || '')
    + (budget ? ' <i>/ ' + depthNumber(budget) + '</i>' : '')
    + '</span></div>';
}

export function depthGraph(){
  const cx = profiler.canvas.getContext('2d');
  const w = profiler.canvas.width, h = profiler.canvas.height;
  cx.clearRect(0, 0, w, h);
  const target = 1000 / DEPTH_BUDGETS[profiler.budget].fps;   // ligne de budget
  const scale = Math.max(target * 2, 33);
  // repère du budget
  cx.strokeStyle = 'rgba(255,255,255,.22)';
  cx.beginPath();
  const yb = h - (target / scale) * h;
  cx.moveTo(0, yb); cx.lineTo(w, yb); cx.stroke();
  // barres
  const n = profiler.hist.length;
  for(let i = 0; i < n; i++){
    const ms = profiler.hist[i];
    const hb = Math.min(h, (ms / scale) * h);
    cx.fillStyle = (ms <= target) ? '#98c379' : (ms <= target * 1.6 ? '#e5c07b' : '#e06c75');
    cx.fillRect(Math.round(i * (w / 120)), h - hb, Math.max(1, w / 120 - 0.5), hb);
  }
}

// appelé en fin de boucle du viewport
export function depthFrame(dtSecondes){
  if(!profiler.active) return;
  const msFrame = dtSecondes * 1000;
  profiler.hist.push(msFrame);
  if(profiler.hist.length > 120) profiler.hist.shift();
  // lissage exponentiel des postes
  ['scripts', 'physics', 'particles', 'render', 'render-game'].forEach(function(k){
    const v = profiler.time[k] || 0;
    profiler.moyennes[k] = (profiler.moyennes[k] || v) * 0.9 + v * 0.1;
  });
  // FPS sur la moyenne des 20 dernières images : réactive et honnête
  const recent = profiler.hist.slice(-20);
  const msMoyen = recent.reduce(function(a, b){ return a + b; }, 0) / recent.length;
  profiler.fps = msMoyen > 0 ? 1000 / msMoyen : 0;
  profiler.time = {};

  // rafraîchissement du DOM 5 fois par seconde (le reste du temps : coût nul)
  const maintenant = performance.now();
  if(maintenant - profiler.lastRender < 200) return;
  profiler.lastRender = maintenant;

  const b = DEPTH_BUDGETS[profiler.budget];
  const info = renderer.info;
  const draws = depthDrawCalls(info);
  let countLum = 0, countMesh = 0;
  objects.forEach(function(o){
    if(ed(o).light) countLum++;
    // les nœuds de modèle sont comptés avec la racine de leur instance
    if(o.userData.modelNode !== undefined) return;
    o.traverse(function(x){ if(x.isMesh) countMesh++; });
  });
  const m = profiler.moyennes;
  const cpu = (m.scripts || 0) + (m.physics || 0) + (m.particles || 0) + (m.render || 0);

  document.getElementById('prof-body').innerHTML =
    depthLine('FPS', profiler.fps, b.fps, '', true)
    + depthLine('Image', msFrame, 1000 / b.fps, ' ms')
    + '<div class="prof-sec">Temps CPU par poste</div>'
    + depthLine('Scripts + événements', m.scripts || 0, 0, ' ms')
    + depthLine('Physics', m.physics || 0, 0, ' ms')
    + depthLine('Particles', m.particles || 0, 0, ' ms')
    + depthLine('Rendu (appel JS)', m.render || 0, 0, ' ms')
    + depthLine('Total mesuré', cpu, 1000 / b.fps, ' ms')
    + '<div class="prof-sec">Charge GPU</div>'
    + depthLine('Draw calls', draws, b.drawCalls, '')
    + depthLine('Triangles', info.render.triangles, b.triangles, '')
    + depthLine('Textures', info.memory.textures, b.textures, '')
    + depthLine('Géométries', info.memory.geometries, 0, '')
    + '<div class="prof-sec">Scène</div>'
    + depthLine('Objets gérés', objects.length, 0, '')
    + depthLine('Maillages', countMesh, 0, '')
    + depthLine('Lumières', countLum, b.lights, '')
    + depthLine('Particules vivantes',
        engineParticles.systemes.reduce(function(s, x){ return s + x.nb; }, 0), 0, '')
    + '<div class="prof-note">Budget : ' + b.name + ' · les postes CPU sont lissés. '
    + 'Les draw calls et triangles comptent la dernière image rendue.</div>';
  depthGraph();
}
