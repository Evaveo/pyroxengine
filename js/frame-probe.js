// moteur/js/frame-probe.js
//
// LA MESURE DE PERFORMANCE D'UN JEU LANCÉ — module PUR et SANS IMPORT (testable sous node).
//
// Né d'une question restée sans réponse (Diobla, 2026-10-15) : « pourquoi 60 i/s et pas 144 ? ».
// play_and_measure rendait des positions et une image, aucun chiffre de performance : on ne pouvait
// que deviner le poste qui coûte. La sonde se pose de L'EXTÉRIEUR sur la fenêtre du jeu (le cadre de
// mesure) — rien n'est ajouté à la boucle de js/game-runtime.js :
//   - la durée de chaque image, par le requestAnimationFrame de la fenêtre du jeu ;
//   - le temps processeur passé dans `renderer.render` (soumission, pas le travail du GPU), le
//     nombre de rendus par image (ombres, post-traitement, vues) et les appels de dessin.
// Une image longue alors que le rendu processeur est court = le GPU (pixels, ombres) ou les scripts.

/** Résume une liste de durées d'image (ms). */
export function summarizeFrames(deltas){
  const d = (deltas || []).filter(function(x){ return x > 0 && Number.isFinite(x); });
  if(!d.length) return null;
  const sorted = d.slice().sort(function(a, b){ return a - b; });
  const at = function(q){ return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]; };
  const avg = d.reduce(function(s, x){ return s + x; }, 0) / d.length;
  const r1 = function(x){ return Math.round(x * 10) / 10; };
  return {frames: d.length, fps: r1(1000 / avg), avgMs: r1(avg), p50Ms: r1(at(0.5)),
          p95Ms: r1(at(0.95)), worstMs: r1(sorted[sorted.length - 1])};
}

// Les compteurs d'info du renderer sont REMIS À ZÉRO avant chaque rendu : la valeur lue après est
// alors celle de CE rendu, que le renderer les remette lui-même à zéro (autoReset) ou les cumule.
// Lire un écart avant/après ne marchait pas : deux rendus identiques remis à zéro donnaient 0.
const CALL_KEYS = ['drawCalls', 'calls', 'triangles'];
function zeroInfo(renderer){
  const r = renderer && renderer.info && renderer.info.render;
  if(r) CALL_KEYS.forEach(function(k){ if(typeof r[k] === 'number') r[k] = 0; });
}
function infoOf(renderer){
  const r = renderer && renderer.info && renderer.info.render;
  if(!r) return {calls: 0, triangles: 0};
  return {calls: Number(r.drawCalls !== undefined ? r.drawCalls : r.calls) || 0, triangles: Number(r.triangles) || 0};
}

/**
 * Pose la sonde. `win` : la fenêtre du jeu ; `renderer` : son renderer. `opts.shadows === false`
 * coupe les ombres le temps de la mesure (le cadre est jeté ensuite, rien n'est écrit). Rend
 * `{stop()}` ; `stop()` retire la sonde et rend le rapport.
 */
export function installFrameProbe(win, renderer, opts){
  const o = opts || {};
  const now = function(){ return win.performance.now(); };
  const deltas = [], perFrame = [];
  let cur = {cpu: 0, renders: 0, calls: 0, triangles: 0};
  let last = null, live = true;
  if(o.shadows === false && renderer.shadowMap) renderer.shadowMap.enabled = false;
  const tick = function(){
    if(!live) return;
    const t = now();
    if(last !== null){ deltas.push(t - last); perFrame.push(cur); }
    cur = {cpu: 0, renders: 0, calls: 0, triangles: 0};
    last = t;
    win.requestAnimationFrame(tick);
  };
  win.requestAnimationFrame(tick);
  const render = renderer.render;
  renderer.render = function(){
    zeroInfo(renderer);
    const t0 = now();
    try { return render.apply(this, arguments); }
    finally {
      const after = infoOf(renderer);
      cur.cpu += now() - t0; cur.renders++;
      cur.calls += after.calls;
      cur.triangles += after.triangles;
    }
  };
  return {
    stop: function(){
      live = false;
      renderer.render = render;
      const s = summarizeFrames(deltas);
      if(!s) return null;
      const mean = function(k){ return perFrame.reduce(function(a, f){ return a + f[k]; }, 0) / Math.max(1, perFrame.length); };
      const cv = renderer.domElement;
      s.renderCpuMs = Math.round(mean('cpu') * 10) / 10;
      s.rendersPerFrame = Math.round(mean('renders') * 10) / 10;
      s.drawCalls = Math.round(mean('calls'));
      s.triangles = Math.round(mean('triangles'));
      s.pixelRatio = renderer.getPixelRatio ? renderer.getPixelRatio() : null;
      s.canvas = cv ? [cv.width, cv.height] : null;
      s.shadows = !(renderer.shadowMap && renderer.shadowMap.enabled === false);
      return s;
    }
  };
}

/** Le rapport en une ligne lisible (français : c'est de l'interface). */
export function formatFrameReport(r){
  if(!r) return 'performance : aucune image mesurée';
  return 'performance : ' + r.fps + ' i/s en moyenne (' + r.avgMs + ' ms ; médiane ' + r.p50Ms + ' ; 95 % sous '
    + r.p95Ms + ' ; pire ' + r.worstMs + ') sur ' + r.frames + ' images · rendu côté processeur '
    + r.renderCpuMs + ' ms/image, ' + r.rendersPerFrame + ' rendu(s)/image · ' + r.drawCalls
    + ' appels de dessin · ' + r.triangles + ' triangles · toile ' + (r.canvas ? r.canvas.join('×') : '?')
    + ' (rapport de pixels ' + r.pixelRatio + ')' + (r.shadows ? '' : ' · OMBRES COUPÉES pour cette mesure');
}
