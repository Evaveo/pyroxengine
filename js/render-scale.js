// moteur/js/render-scale.js
//
// Résolution de rendu adaptative — module PARTAGÉ, PUR et SANS IMPORT (testable sous node).
//
// UN TÉLÉPHONE N'EST PAS UN PC AVEC UN PETIT ÉCRAN. Son devicePixelRatio vaut 3, son GPU est
// une fraction de celui d'un portable, et le runtime rendait à `min(dpr, 2)` avec anticrénelage :
// quatre fois les pixels d'un écran 1080p ordinaire, sur la puce la plus lente. C'était la
// première cause du « ça lag sur téléphone », avant tout script.
//
// Deux décisions, toutes deux par la mesure plutôt que par une liste d'appareils :
//   1. le PLAFOND de départ dépend du type d'écran (tactile → 1,5 ; sinon 2), et un projet peut
//      l'imposer (`settings.maxPixelRatio`) ;
//   2. la résolution DESCEND seule quand les images sont trop longues, et remonte prudemment
//      quand elles redeviennent courtes (`settings.adaptiveResolution: false` la fige).

export const RENDER_SCALE_DEFAULT = {
  desktopCap: 2,
  touchCap: 1.5,
  minRatio: 0.6,            // en dessous, l'image devient illisible
  window: 1.0,              // secondes de mesure par décision
  slowFrame: 1 / 45,        // moyenne au-delà : on descend
  fastFrame: 1 / 57,        // moyenne en deçà : candidate à remonter
  goodWindowsToRaise: 3,    // fenêtres rapides consécutives avant de remonter (pas d'oscillation)
  down: 0.85,
  up: 1.1
};

/** Le plafond de départ du rapport de pixels. */
export function pixelRatioCap(dpr, isTouch, projectCap){
  const d = (typeof dpr === 'number' && dpr > 0) ? dpr : 1;
  const p = Number(projectCap);
  if(projectCap !== null && projectCap !== undefined && Number.isFinite(p) && p > 0) return Math.min(d, p);
  return Math.min(d, isTouch ? RENDER_SCALE_DEFAULT.touchCap : RENDER_SCALE_DEFAULT.desktopCap);
}

/**
 * Le contrôleur : `sample(dt)` à chaque image ; renvoie le NOUVEAU rapport quand il change, sinon
 * null. `adaptive: false` le fige au plafond.
 */
export function createRenderScaler(cap, opts){
  const o = Object.assign({}, RENDER_SCALE_DEFAULT, opts || {});
  const floor = Math.min(cap, o.minRatio);
  const s = {ratio: cap, cap: cap, acc: 0, n: 0, good: 0, adaptive: o.adaptive !== false};
  s.sample = function(dt){
    if(!s.adaptive || !(dt > 0)) return null;
    // Une image d'un quart de seconde est un onglet revenu au premier plan, pas une charge GPU.
    if(dt > 0.25){ s.acc = 0; s.n = 0; return null; }
    s.acc += dt; s.n++;
    if(s.acc < o.window) return null;
    const avg = s.acc / s.n;
    s.acc = 0; s.n = 0;
    let next = s.ratio;
    if(avg > o.slowFrame){ s.good = 0; next = Math.max(floor, s.ratio * o.down); }
    else if(avg < o.fastFrame){
      if(++s.good >= o.goodWindowsToRaise){ s.good = 0; next = Math.min(s.cap, s.ratio * o.up); }
    } else s.good = 0;
    next = Math.round(next * 100) / 100;
    if(Math.abs(next - s.ratio) < 0.01) return null;
    s.ratio = next;
    return next;
  };
  return s;
}

export function isTouchScreen(){
  const nav = globalThis.navigator;
  return (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches)
    || !!(nav && nav.maxTouchPoints > 0);
}

/**
 * Tout le réglage de rendu du jeu publié, pour que js/game-runtime.js n'en porte que l'appel.
 * L'ANTICRÉNELAGE MATÉRIEL EST COUPÉ SUR UN ÉCRAN TACTILE DENSE : à 3 pixels physiques par pixel
 * CSS il multiplie le coût de chaque pixel pour un gain invisible. `settings.antialias`
 * (true/false) tranche quand le projet a un avis ; `settings.maxPixelRatio` impose le plafond ;
 * `settings.adaptiveResolution: false` fige la résolution.
 */
export function renderSetupFor(settings, dpr, isTouch){
  const st = settings || {};
  const touch = (isTouch === undefined) ? isTouchScreen() : !!isTouch;
  const antialias = (typeof st.antialias === 'boolean') ? st.antialias : !(touch && dpr >= 2);
  const scaler = createRenderScaler(pixelRatioCap(dpr, touch, st.maxPixelRatio), {adaptive: st.adaptiveResolution !== false});
  let renderer = null, onResize = null, paused = null;
  return {
    antialias: antialias, touch: touch, scaler: scaler,
    attach: function(r, resize, isPaused){
      renderer = r; onResize = resize; paused = isPaused;
      r.setPixelRatio(scaler.ratio);
    },
    // Appelé à chaque image avec le dt BRUT ; ne touche au renderer que quand le rapport change.
    tick: function(dt){
      if(!renderer || (paused && paused())) return;
      if(scaler.sample(dt) === null) return;
      renderer.setPixelRatio(scaler.ratio);
      if(onResize) onResize();
    }
  };
}

globalThis.RenderScale = {pixelRatioCap, createRenderScaler, isTouchScreen, renderSetupFor};
