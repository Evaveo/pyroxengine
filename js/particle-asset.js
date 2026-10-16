// moteur/js/particle-asset.js
// ---------- Le système de particules : format, migration, surcharges ----------
//
// Un émetteur (composant Particles) porte un SYSTÈME : la recette de l'effet, organisée en
// MODULES activables comme le Particle System de Unity (Shuriken). Le système vit à deux
// endroits possibles :
//
//   · dans un ASSET `particles` (`assets/particles/Feu.particles.json`), réutilisable par
//     plusieurs objets — c'est le cas normal, comme un matériau ;
//   · INTÉGRÉ au composant (`system`), quand l'objet n'en référence aucun — c'est ce que
//     devient, à la relecture, tout émetteur écrit avant cette version.
//
// LE SAC DU COMPOSANT (`userData.part`, version 2) :
//
//   { "version": 2, "active": true,
//     "particlesId": "a12" | null,        ← l'asset référencé, ou rien
//     "system": {…} | null,               ← le système intégré quand particlesId est vide
//     "overrides": {"main.startColor": ["#fff","#fff"], …} }   ← surcharges par objet
//
// Les surcharges sont des CHEMINS pointés vers une valeur : un objet peut garder l'asset
// « Feu » et ne changer que sa couleur, comme une surcharge de prefab. Elles ne servent que
// quand un asset est référencé ; sur un système intégré on écrit directement dedans.
//
// LE SYSTÈME garde la place d'un graphe (`graph: null`) : le jour où un éditeur nodal pilotera
// les particules, il s'ajoutera à ce format sans nouvelle migration.
//
// Ce fichier ne connaît ni three ni le DOM : il est PARTAGÉ tel quel avec le runtime du jeu
// publié (embarqué par build.js) et éprouvable hors navigateur.

export const PARTICLES_FORMAT_VERSION = 1;   // version du fichier d'asset
export const PART_BAG_VERSION = 2;           // version du sac du composant

export const BLENDINGS = ['additive', 'normal', 'multiply'];
export const RENDER_MODES = ['billboard', 'stretched', 'horizontal', 'vertical'];
export const SHAPE_TYPES = ['cone', 'sphere', 'hemisphere', 'box', 'circle', 'edge', 'point'];
export const SUB_EMITTER_EVENTS = ['birth', 'death', 'collision'];
export const MAX_PARTICLES_LIMIT = 20000;

// Le système par défaut. Ses valeurs sont celles de l'ancien PART_DEFAULT, traduites : un
// émetteur neuf ressemble exactement à ce qu'il était avant (cône orange, 25 par seconde).
export function defaultParticleSystem(){
  return {
    graph: null,
    main: {
      duration: 5, looping: true, prewarm: false, startDelay: 0, playOnAwake: true,
      startLifetime: [1.3 * 0.75, 1.3 * 1.25],   // [min, max] en secondes (ancien « vie » 1,3 ± 25 %)
      startSpeed: [2.5 * 0.75, 2.5 * 1.25],      // ancien « vitesse » 2,5 ± 25 %
      startSize: [0.3, 0.3],
      startRotation: [0, 0],            // degrés
      startColor: ['#ffffff', '#ffffff'],
      gravity: 0,                       // m/s² sur Y monde (négatif = retombe)
      simulationSpace: 'world',         // world | local
      maxParticles: 300
    },
    emission: { enabled: true, rateOverTime: 25, rateOverDistance: 0, bursts: [], manualCount: 40 },
    shape: { enabled: true, type: 'cone', angle: 20, radius: 0.4, radiusThickness: 1,
             size: [1, 0.2, 1], randomizeDirection: 0 },
    velocityOverLife: { enabled: false, linear: [0, 0, 0], space: 'local', speedCurve: null },
    forceOverLife: { enabled: false, force: [0, 0, 0] },
    limitVelocity: { enabled: false, limit: 0, dampen: 0.5, drag: 0 },
    noise: { enabled: false, strength: 1, frequency: 0.5, scrollSpeed: 0.3 },
    collision: { enabled: false, planeHeight: 0, bounce: 0.5, lifetimeLoss: 0, radiusScale: 1 },
    colorOverLife: { enabled: true,
      gradient: { keys: [{t: 0, color: '#ffb347', alpha: 1}, {t: 1, color: '#ff4422', alpha: 0}] } },
    sizeOverLife: { enabled: true, curve: { keys: [[0, 1], [1, 0.06 / 0.3]] } },   // ancienne taille 0,3 → 0,06
    rotationOverLife: { enabled: false, angularVelocity: [0, 0] },
    textureSheet: { enabled: false, tilesX: 4, tilesY: 4, mode: 'lifetime', fps: 12, cycles: 1,
                    randomStart: false },
    subEmitters: { enabled: false, list: [] },
    render: { blending: 'additive', textureId: null, renderMode: 'billboard',
                lengthScale: 1, speedScale: 0.1 }
  };
}

export function defaultPartBag(){
  return { version: PART_BAG_VERSION, active: true, particlesId: null,
           system: defaultParticleSystem(), overrides: {} };
}

function paClone(v){ return (v === undefined) ? undefined : JSON.parse(JSON.stringify(v)); }
function paNum(v, d){ const n = Number(v); return Number.isFinite(n) ? n : d; }
function paClamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
function paPairOf(v, d){
  if(Array.isArray(v) && v.length >= 2) return [paNum(v[0], d[0]), paNum(v[1], d[1])];
  if(typeof v === 'number' && Number.isFinite(v)) return [v, v];
  return d.slice();
}
function paColorPairOf(v, d){
  const ok = function(c){ return typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c); };
  if(Array.isArray(v) && ok(v[0]) && ok(v[1])) return [v[0], v[1]];
  if(ok(v)) return [v, v];
  return d.slice();
}
function paVec3Of(v, d){
  return (Array.isArray(v) && v.length >= 3) ? [paNum(v[0], d[0]), paNum(v[1], d[1]), paNum(v[2], d[2])] : d.slice();
}

/** Un ancien sac (sans `version`) : les champs à plat de PART_DEFAULT, avant cette version. */
export function isLegacyPart(part){
  return !!part && typeof part === 'object' && part.version === undefined;
}

/**
 * Traduit un ancien sac en système. Le rendu doit être IDENTIQUE : l'aléa codé en dur (± 25 %
 * sur la vie et la vitesse) devient un intervalle, le fondu linéaire taille/opacité/couleur
 * devient une courbe et un dégradé à deux clés, la rafale devient une salve à t = 0.
 */
export function systemFromLegacy(p){
  const s = defaultParticleSystem();
  const life = paNum(p.vie, 1.3) || 1.3;
  const speed = (p.speed !== undefined) ? paNum(p.speed, 2.5) : 2.5;
  s.main.startLifetime = [Math.max(0.05, life * 0.75), Math.max(0.05, life * 1.25)];
  s.main.startSpeed = [speed * 0.75, speed * 1.25];
  s.main.gravity = paNum(p.gravity, 0);
  s.main.maxParticles = paClamp(paNum(p.max, 300) | 0 || 300, 1, 5000);
  const t1 = (p.sizeStart !== undefined) ? paNum(p.sizeStart, 0.3) : 0.3;
  const t2 = (p.sizeEnd !== undefined) ? paNum(p.sizeEnd, 0.06) : 0.06;
  // La taille de départ porte l'échelle, la courbe un multiplicateur. Une taille de départ
  // nulle ferait diviser par zéro : la fin devient alors l'échelle, et la courbe part de 0.
  if(t1 > 0){
    s.main.startSize = [t1, t1];
    s.sizeOverLife.curve = { keys: [[0, 1], [1, t2 / t1]] };
  } else {
    s.main.startSize = [t2, t2];
    s.sizeOverLife.curve = { keys: [[0, 0], [1, 1]] };
  }
  const o1 = (p.opacityStart !== undefined) ? paNum(p.opacityStart, 1) : 1;
  const o2 = (p.opacityEnd !== undefined) ? paNum(p.opacityEnd, 0) : 0;
  s.colorOverLife.gradient = { keys: [
    {t: 0, color: p.colorStart || '#ffb347', alpha: o1},
    {t: 1, color: p.colorEnd || '#ff4422', alpha: o2}] };
  s.shape.type = SHAPE_TYPES.indexOf(p.shape) !== -1 ? p.shape : 'cone';
  s.shape.radius = (p.radius !== undefined) ? paNum(p.radius, 0.4) : 0.4;
  s.shape.angle = (p.angle !== undefined) ? paNum(p.angle, 20) : 20;
  s.shape.size = paVec3Of(p.dims, [1, 0.2, 1]);
  s.emission.manualCount = Math.max(1, paNum(p.amount, 40) | 0);
  if(p.mode === 'burst'){
    // Une rafale : une salve unique au départ, sans boucle. La durée vaut la vie, pour que
    // l'aperçu de l'éditeur la rejoue au même rythme qu'avant (vie + 0,8 s).
    s.main.looping = false;
    s.main.duration = life;
    s.emission.rateOverTime = 0;
    s.emission.bursts = [{time: 0, count: s.emission.manualCount, cycles: 1, interval: 0.5}];
  } else {
    s.emission.rateOverTime = (p.rate !== undefined) ? Math.max(0, paNum(p.rate, 25)) : 25;
  }
  s.render.blending = (p.additif === false) ? 'normal' : 'additive';
  return s;
}

/**
 * Remet un système en forme : modules manquants complétés, valeurs bornées. Un fichier écrit
 * à la main ou par un agent peut omettre n'importe quel champ : on comble avec les défauts,
 * jamais on ne lève. Rend un NOUVEL objet.
 */
export function normalizeParticleSystem(src){
  const d = defaultParticleSystem();
  const s = (src && typeof src === 'object') ? src : {};
  const out = {};
  out.graph = (s.graph && typeof s.graph === 'object') ? paClone(s.graph) : null;
  Object.keys(d).forEach(function(k){
    if(k === 'graph') return;
    out[k] = Object.assign({}, d[k], (s[k] && typeof s[k] === 'object') ? paClone(s[k]) : {});
  });
  const m = out.main;
  m.duration = Math.max(0.05, paNum(m.duration, 5));
  m.looping = m.looping !== false;
  m.prewarm = !!m.prewarm;
  m.playOnAwake = m.playOnAwake !== false;
  m.startDelay = Math.max(0, paNum(m.startDelay, 0));
  m.startLifetime = paPairOf(m.startLifetime, d.main.startLifetime).map(function(x){ return Math.max(0.01, x); });
  m.startSpeed = paPairOf(m.startSpeed, d.main.startSpeed);
  m.startSize = paPairOf(m.startSize, d.main.startSize).map(function(x){ return Math.max(0, x); });
  m.startRotation = paPairOf(m.startRotation, d.main.startRotation);
  m.startColor = paColorPairOf(m.startColor, d.main.startColor);
  m.gravity = paNum(m.gravity, 0);
  m.simulationSpace = (m.simulationSpace === 'local') ? 'local' : 'world';
  m.maxParticles = paClamp(paNum(m.maxParticles, 300) | 0, 1, MAX_PARTICLES_LIMIT);
  const e = out.emission;
  e.enabled = e.enabled !== false;
  e.rateOverTime = Math.max(0, paNum(e.rateOverTime, 0));
  e.rateOverDistance = Math.max(0, paNum(e.rateOverDistance, 0));
  e.manualCount = Math.max(1, paNum(e.manualCount, 40) | 0);
  e.bursts = (Array.isArray(e.bursts) ? e.bursts : []).map(function(b){
    b = b || {};
    return {time: Math.max(0, paNum(b.time, 0)), count: Math.max(0, paNum(b.count, 10) | 0),
            cycles: Math.max(1, paNum(b.cycles, 1) | 0), interval: Math.max(0.01, paNum(b.interval, 0.5))};
  });
  const sh = out.shape;
  sh.enabled = sh.enabled !== false;
  sh.type = SHAPE_TYPES.indexOf(sh.type) !== -1 ? sh.type : 'cone';
  sh.angle = paClamp(paNum(sh.angle, 20), 0, 89);
  sh.radius = Math.max(0, paNum(sh.radius, 0.4));
  sh.radiusThickness = paClamp(paNum(sh.radiusThickness, 1), 0, 1);
  sh.size = paVec3Of(sh.size, d.shape.size).map(function(x){ return Math.max(0, x); });
  sh.randomizeDirection = paClamp(paNum(sh.randomizeDirection, 0), 0, 1);
  out.velocityOverLife.linear = paVec3Of(out.velocityOverLife.linear, [0, 0, 0]);
  out.velocityOverLife.space = (out.velocityOverLife.space === 'world') ? 'world' : 'local';
  out.velocityOverLife.speedCurve = normalizeCurve(out.velocityOverLife.speedCurve, null);
  out.forceOverLife.force = paVec3Of(out.forceOverLife.force, [0, 0, 0]);
  const lv = out.limitVelocity;
  lv.limit = Math.max(0, paNum(lv.limit, 0));
  lv.dampen = paClamp(paNum(lv.dampen, 0.5), 0, 1);
  lv.drag = Math.max(0, paNum(lv.drag, 0));
  const nz = out.noise;
  nz.strength = paNum(nz.strength, 1);
  nz.frequency = Math.max(0.001, paNum(nz.frequency, 0.5));
  nz.scrollSpeed = paNum(nz.scrollSpeed, 0.3);
  const co = out.collision;
  co.planeHeight = paNum(co.planeHeight, 0);
  co.bounce = paClamp(paNum(co.bounce, 0.5), 0, 2);
  co.lifetimeLoss = paClamp(paNum(co.lifetimeLoss, 0), 0, 1);
  co.radiusScale = Math.max(0, paNum(co.radiusScale, 1));
  out.colorOverLife.gradient = normalizeGradient(out.colorOverLife.gradient);
  out.sizeOverLife.curve = normalizeCurve(out.sizeOverLife.curve, {keys: [[0, 1], [1, 1]]});
  out.rotationOverLife.angularVelocity = paPairOf(out.rotationOverLife.angularVelocity, [0, 0]);
  const ts = out.textureSheet;
  ts.tilesX = paClamp(paNum(ts.tilesX, 4) | 0, 1, 64);
  ts.tilesY = paClamp(paNum(ts.tilesY, 4) | 0, 1, 64);
  ts.mode = (ts.mode === 'fps') ? 'fps' : 'lifetime';
  ts.fps = Math.max(0, paNum(ts.fps, 12));
  ts.cycles = Math.max(0.01, paNum(ts.cycles, 1));
  ts.randomStart = !!ts.randomStart;
  out.subEmitters.list = (Array.isArray(out.subEmitters.list) ? out.subEmitters.list : []).map(function(x){
    x = x || {};
    return {event: SUB_EMITTER_EVENTS.indexOf(x.event) !== -1 ? x.event : 'death',
            particlesId: (typeof x.particlesId === 'string' && x.particlesId) ? x.particlesId : null,
            count: Math.max(1, paNum(x.count, 10) | 0)};
  });
  const r = out.render;
  r.blending = BLENDINGS.indexOf(r.blending) !== -1 ? r.blending : 'additive';
  r.renderMode = RENDER_MODES.indexOf(r.renderMode) !== -1 ? r.renderMode : 'billboard';
  r.textureId = (typeof r.textureId === 'string' && r.textureId) ? r.textureId : null;
  r.lengthScale = Math.max(0, paNum(r.lengthScale, 1));
  r.speedScale = Math.max(0, paNum(r.speedScale, 0.1));
  ['velocityOverLife', 'forceOverLife', 'limitVelocity', 'noise', 'collision', 'colorOverLife',
   'sizeOverLife', 'rotationOverLife', 'textureSheet', 'subEmitters'].forEach(function(k){
    out[k].enabled = !!out[k].enabled;
  });
  return out;
}

/**
 * Remet le sac du composant au format courant, EN PLACE : `userData.part` est partagé par
 * référence entre le composant et les systèmes (voir component-particles.js), il ne doit
 * jamais changer d'identité. Rend le sac.
 */
export function upgradePartBag(part){
  if(!part || typeof part !== 'object') return part;
  if(isLegacyPart(part)){
    const active = part.active !== false;
    const system = systemFromLegacy(part);
    Object.keys(part).forEach(function(k){ delete part[k]; });
    part.version = PART_BAG_VERSION;
    part.active = active;
    part.particlesId = null;
    part.system = system;
    part.overrides = {};
    return defineLegacyAccessors(part);
  }
  if(part.active === undefined) part.active = true;
  if(part.particlesId === undefined) part.particlesId = null;
  if(!part.overrides || typeof part.overrides !== 'object') part.overrides = {};
  if(!part.particlesId && (!part.system || typeof part.system !== 'object')) part.system = defaultParticleSystem();
  return defineLegacyAccessors(part);
}

// ---------- Les anciens noms, encore lisibles et écrivables par les scripts ----------
//
// Un script d'avant la v1.21.0 écrivait `getComponent('Particles').data.rate = 60` — l'aide le
// montrait même en exemple. Le sac n'a plus ces champs à plat : sans ce pont, l'écriture
// réussirait sur un champ que plus personne ne lit, et l'émetteur ignorerait le script SANS UN
// MOT. Ces accesseurs sont NON ÉNUMÉRABLES : jamais sérialisés, jamais recopiés par une fusion
// de sac, invisibles pour tout ce qui parcourt les clés. Ils écrivent par setParticleValue —
// donc en surcharge sur un émetteur relié à un asset, comme l'inspecteur.
const LEGACY_ACCESSORS = {
  rate:    {path: 'emission.rateOverTime', legacy: 'rate'},
  amount:  {path: 'emission.manualCount', legacy: 'amount'},
  vie:     {path: 'main.startLifetime', legacy: 'life', mid: true},
  speed:   {path: 'main.startSpeed', legacy: 'speed', mid: true},
  gravity: {path: 'main.gravity', legacy: 'gravity'},
  max:     {path: 'main.maxParticles', legacy: 'max'},
  shape:   {path: 'shape.type', legacy: 'shape'},
  radius:  {path: 'shape.radius'},
  angle:   {path: 'shape.angle'},
  additif: {path: 'render.blending', legacy: 'additive', read: function(v){ return v === 'additive'; }},
  mode:    {path: 'main.looping', legacy: 'mode', read: function(v){ return v === false ? 'burst' : 'continu'; }}
};

function legacyRead(part, path){
  const ov = part.overrides || {};
  if(part.particlesId && Object.prototype.hasOwnProperty.call(ov, path)) return ov[path];
  return getPath(normalizeParticleSystem(part.system || null), path);
}

export function defineLegacyAccessors(part){
  if(!part || Object.getOwnPropertyDescriptor(part, 'rate')) return part;
  Object.keys(LEGACY_ACCESSORS).forEach(function(k){
    const d = LEGACY_ACCESSORS[k];
    Object.defineProperty(part, k, {
      enumerable: false, configurable: true,
      get: function(){
        const v = legacyRead(part, d.path);
        if(d.read) return d.read(v);
        if(d.mid && Array.isArray(v)) return (v[0] + v[1]) / 2;
        return v;
      },
      set: function(v){
        if(d.legacy){
          const one = {}; one[d.legacy] = v;
          const paths = legacySettingsToPaths(one, part.system || null);
          Object.keys(paths).forEach(function(pth){ setParticleValue(part, pth, paths[pth]); });
        } else {
          setParticleValue(part, d.path, v);
        }
      }
    });
  });
  return part;
}

// ---------- Chemins pointés (surcharges) ----------

export function getPath(obj, path){
  const parts = String(path).split('.');
  let cur = obj;
  for(let i = 0; i < parts.length; i++){
    if(cur === null || cur === undefined) return undefined;
    cur = cur[parts[i]];
  }
  return cur;
}

export function setPath(obj, path, value){
  const parts = String(path).split('.');
  let cur = obj;
  for(let i = 0; i < parts.length - 1; i++){
    if(!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
  return obj;
}

/** Un chemin est-il un réglage CONNU du système ? (refuse les fautes de frappe d'un agent) */
export function isKnownPath(path){
  const parts = String(path).split('.');
  if(parts.length !== 2) return false;
  const d = defaultParticleSystem();
  return !!d[parts[0]] && typeof d[parts[0]] === 'object' && Object.prototype.hasOwnProperty.call(d[parts[0]], parts[1]);
}

/**
 * Le système EFFECTIF d'un émetteur : celui de l'asset référencé plus les surcharges, ou le
 * système intégré. `findAsset(id)` rend l'asset (ou null). Un asset introuvable retombe sur le
 * système intégré, puis sur les défauts : l'émetteur reste visible, il ne disparaît pas en
 * silence.
 */
export function resolveParticleSystem(part, findAsset){
  upgradePartBag(part);
  let base = null;
  if(part.particlesId && typeof findAsset === 'function'){
    const a = findAsset(part.particlesId);
    if(a && a.kind === 'particles') base = a.system;
  }
  if(!base) return normalizeParticleSystem(part.system || null);
  const s = normalizeParticleSystem(base);
  const ov = part.overrides || {};
  Object.keys(ov).forEach(function(k){ if(isKnownPath(k)) setPath(s, k, paClone(ov[k])); });
  return normalizeParticleSystem(s);
}

/**
 * Écrit UN réglage d'un émetteur, là où il doit aller : en SURCHARGE quand l'émetteur référence
 * un asset (l'asset, partagé, reste intact — comme une surcharge de prefab), dans le système
 * intégré sinon. Rend `true`, ou lève avec un message lisible pour un chemin inconnu.
 */
export function setParticleValue(part, path, value){
  if(!isKnownPath(path)) throw new Error('réglage de particules inconnu : « ' + path + ' » (forme attendue : module.réglage, ex. main.startSize)');
  upgradePartBag(part);
  if(part.particlesId){
    part.overrides[path] = paClone(value);
  } else {
    if(!part.system) part.system = defaultParticleSystem();
    setPath(part.system, path, paClone(value));
  }
  return true;
}

/** Retire une surcharge (« Rétablir ») ; sans `path`, les retire toutes. */
export function clearParticleOverride(part, path){
  upgradePartBag(part);
  if(path === undefined) part.overrides = {};
  else delete part.overrides[path];
}

/**
 * Sépare l'émetteur de son asset : le système effectif (asset + surcharges) devient son système
 * intégré. C'est « Unpack » d'un prefab.
 */
export function detachParticlesAsset(part, findAsset){
  const s = resolveParticleSystem(part, findAsset);
  part.particlesId = null;
  part.overrides = {};
  part.system = s;
  return part;
}

/** Relie l'émetteur à un asset ; les surcharges d'avant ne s'appliquent plus à rien, on les vide. */
export function attachParticlesAsset(part, assetId){
  upgradePartBag(part);
  part.particlesId = assetId || null;
  part.overrides = {};
  if(!assetId && !part.system) part.system = defaultParticleSystem();
  return part;
}

/**
 * Les champs À PLAT d'avant la v1.21.0 (`rate`, `life`, `sizeStart`…), encore acceptés par les
 * outils du copilote et du MCP, traduits en chemins de réglage. `current` est le système
 * effectif de l'émetteur : un dégradé ou une courbe n'est réécrit qu'à ses extrémités.
 */
export function legacySettingsToPaths(a, current){
  const out = {};
  const cur = normalizeParticleSystem(current);
  if(a.shape !== undefined) out['shape.type'] = a.shape;
  if(a.rate !== undefined) out['emission.rateOverTime'] = Math.max(0, paNum(a.rate, 25));
  if(a.amount !== undefined) out['emission.manualCount'] = Math.max(1, paNum(a.amount, 40) | 0);
  if(a.mode === 'burst'){
    const n = (a.amount !== undefined) ? Math.max(1, paNum(a.amount, 40) | 0) : cur.emission.manualCount;
    out['main.looping'] = false;
    out['emission.rateOverTime'] = 0;
    out['emission.bursts'] = [{time: 0, count: n, cycles: 1, interval: 0.5}];
  } else if(a.mode === 'continu' || a.mode === 'continuous'){
    out['main.looping'] = true;
    out['emission.bursts'] = [];
    if(a.rate === undefined && !cur.emission.rateOverTime) out['emission.rateOverTime'] = 25;
  }
  if(a.life !== undefined){ const l = Math.max(0.05, paNum(a.life, 1.3)); out['main.startLifetime'] = [l * 0.75, l * 1.25]; }
  if(a.speed !== undefined){ const v = paNum(a.speed, 2.5); out['main.startSpeed'] = [v * 0.75, v * 1.25]; }
  if(a.gravity !== undefined) out['main.gravity'] = paNum(a.gravity, 0);
  if(a.max !== undefined) out['main.maxParticles'] = paClamp(paNum(a.max, 300) | 0, 1, MAX_PARTICLES_LIMIT);
  if(a.additive !== undefined) out['render.blending'] = a.additive === false ? 'normal' : 'additive';
  if(a.sizeStart !== undefined || a.sizeEnd !== undefined){
    const s0 = cur.main.startSize[1];
    const ends = cur.sizeOverLife.curve.keys;
    const t1 = (a.sizeStart !== undefined) ? Math.max(0, paNum(a.sizeStart, 0.3)) : s0 * ends[0][1];
    const t2 = (a.sizeEnd !== undefined) ? Math.max(0, paNum(a.sizeEnd, 0.06)) : s0 * ends[ends.length - 1][1];
    const scale = Math.max(t1, t2) || 0.3;
    out['main.startSize'] = [scale, scale];
    out['sizeOverLife.enabled'] = true;
    out['sizeOverLife.curve'] = {keys: [[0, t1 / scale], [1, t2 / scale]]};
  }
  if(a.colorStart !== undefined || a.colorEnd !== undefined || a.opacityStart !== undefined || a.opacityEnd !== undefined){
    const keys = cur.colorOverLife.gradient.keys;
    const k0 = keys[0], k1 = keys[keys.length - 1];
    out['colorOverLife.enabled'] = true;
    out['colorOverLife.gradient'] = {keys: [
      {t: 0, color: a.colorStart || k0.color, alpha: (a.opacityStart !== undefined) ? paNum(a.opacityStart, 1) : k0.alpha},
      {t: 1, color: a.colorEnd || k1.color, alpha: (a.opacityEnd !== undefined) ? paNum(a.opacityEnd, 0) : k1.alpha}]};
  }
  return out;
}

// ---------- Courbes et dégradés ----------
//
// Une courbe : {keys: [[t, v], …]} avec t dans [0, 1], interpolation linéaire. Un dégradé :
// {keys: [{t, color: '#rrggbb', alpha}, …]}. Les deux sont triés par t et jamais vides.

export function normalizeCurve(c, fallback){
  if(!c || !Array.isArray(c.keys) || !c.keys.length) return fallback ? paClone(fallback) : null;
  const keys = c.keys.map(function(k){
    return [paClamp(paNum(k && k[0], 0), 0, 1), paNum(k && k[1], 0)];
  }).sort(function(a, b){ return a[0] - b[0]; });
  return {keys: keys};
}

export function evaluateCurve(c, t){
  if(!c || !c.keys || !c.keys.length) return 1;
  const k = c.keys;
  if(t <= k[0][0]) return k[0][1];
  const last = k[k.length - 1];
  if(t >= last[0]) return last[1];
  for(let i = 1; i < k.length; i++){
    if(t <= k[i][0]){
      const a = k[i - 1], b = k[i];
      const span = b[0] - a[0];
      const f = span > 0 ? (t - a[0]) / span : 0;
      return a[1] + (b[1] - a[1]) * f;
    }
  }
  return last[1];
}

export function particleHexToRgb(hex){
  const h = (typeof hex === 'string' && /^#[0-9a-f]{6}$/i.test(hex)) ? hex : '#ffffff';
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function normalizeGradient(g){
  const fallback = {keys: [{t: 0, color: '#ffffff', alpha: 1}, {t: 1, color: '#ffffff', alpha: 1}]};
  if(!g || !Array.isArray(g.keys) || !g.keys.length) return fallback;
  const keys = g.keys.map(function(k){
    k = k || {};
    return {t: paClamp(paNum(k.t, 0), 0, 1),
            color: (typeof k.color === 'string' && /^#[0-9a-f]{6}$/i.test(k.color)) ? k.color : '#ffffff',
            alpha: paClamp(paNum(k.alpha, 1), 0, 1)};
  }).sort(function(a, b){ return a.t - b.t; });
  return {keys: keys};
}

/**
 * Les clés d'un dégradé pré-converties en RVB, pour l'évaluer chaque image sans re-analyser
 * les chaînes hexadécimales. Rend [[t, r, g, b, a], …].
 */
export function compileGradient(g){
  return normalizeGradient(g).keys.map(function(k){
    const c = particleHexToRgb(k.color);
    return [k.t, c[0], c[1], c[2], k.alpha];
  });
}

/** Évalue un dégradé compilé ; écrit [r, g, b, a] dans `out`. */
export function evaluateGradient(compiled, t, out){
  const k = compiled;
  let a = k[0], b = k[0], f = 0;
  if(t <= k[0][0]){ a = b = k[0]; }
  else if(t >= k[k.length - 1][0]){ a = b = k[k.length - 1]; }
  else {
    for(let i = 1; i < k.length; i++){
      if(t <= k[i][0]){
        a = k[i - 1]; b = k[i];
        const span = b[0] - a[0];
        f = span > 0 ? (t - a[0]) / span : 0;
        break;
      }
    }
  }
  out[0] = a[1] + (b[1] - a[1]) * f;
  out[1] = a[2] + (b[2] - a[2]) * f;
  out[2] = a[3] + (b[3] - a[3]) * f;
  out[3] = a[4] + (b[4] - a[4]) * f;
  return out;
}

// ---------- Références d'asset contenues ----------

/**
 * Remappe les ids d'asset qu'un système cite (texture du rendu, sous-émetteurs) — les ids sont
 * RÉATTRIBUÉS au chargement d'un projet, une référence oubliée ici glisserait d'un rang à
 * chaque réouverture (voir remapReferencesAssetsInScenes, serialization.js).
 */
export function remapSystemRefs(system, remap){
  if(!system || typeof system !== 'object') return system;
  if(system.render && system.render.textureId) system.render.textureId = remap(system.render.textureId) || null;
  if(system.subEmitters && Array.isArray(system.subEmitters.list)){
    system.subEmitters.list.forEach(function(x){ if(x && x.particlesId) x.particlesId = remap(x.particlesId) || null; });
  }
  return system;
}

/** Même chose pour le sac d'un composant : l'asset, le système intégré et les surcharges. */
export function remapPartBagRefs(part, remap){
  if(!part || typeof part !== 'object' || isLegacyPart(part)) return part;
  if(part.particlesId) part.particlesId = remap(part.particlesId) || null;
  if(part.system) remapSystemRefs(part.system, remap);
  const ov = part.overrides;
  if(ov && typeof ov === 'object'){
    if(ov['render.textureId']) ov['render.textureId'] = remap(ov['render.textureId']) || null;
    if(ov['subEmitters.list']) remapSystemRefs({subEmitters: {list: ov['subEmitters.list']}}, remap);
  }
  return part;
}

/** Les ids d'asset qu'un système cite — pour l'export (build) et les dépendances. */
export function referencedAssetIds(system){
  const ids = [];
  if(system && system.render && system.render.textureId) ids.push(system.render.textureId);
  if(system && system.subEmitters && Array.isArray(system.subEmitters.list)){
    system.subEmitters.list.forEach(function(x){ if(x && x.particlesId) ids.push(x.particlesId); });
  }
  return ids;
}

// ---------- Presets livrés ----------
//
// Des points de départ, pas des effets finis : chacun se crée en asset et se règle ensuite.
// Ils n'ont pas de texture (disque doux par défaut) pour fonctionner dans tout projet.

function paPreset(patch){
  const s = defaultParticleSystem();
  Object.keys(patch).forEach(function(k){ s[k] = Object.assign({}, s[k], patch[k]); });
  return normalizeParticleSystem(s);
}

export const PARTICLE_PRESETS = {
  fire: { label: 'Feu', make: function(){ return paPreset({
    main: {startLifetime: [0.6, 1.1], startSpeed: [1.2, 2], startSize: [0.5, 0.8], gravity: 1.5,
           maxParticles: 400, startRotation: [0, 360]},
    emission: {rateOverTime: 60},
    shape: {type: 'cone', angle: 12, radius: 0.35},
    noise: {enabled: true, strength: 0.6, frequency: 1.2, scrollSpeed: 0.8},
    colorOverLife: {gradient: {keys: [{t: 0, color: '#fff3b0', alpha: 0}, {t: 0.12, color: '#ffb347', alpha: 1},
      {t: 0.55, color: '#ff5522', alpha: 0.8}, {t: 1, color: '#6b1a0a', alpha: 0}]}},
    sizeOverLife: {curve: {keys: [[0, 0.6], [0.3, 1], [1, 0.15]]}},
    rotationOverLife: {enabled: true, angularVelocity: [-60, 60]}
  }); } },
  smoke: { label: 'Fumée', make: function(){ return paPreset({
    main: {startLifetime: [2.5, 4], startSpeed: [0.4, 0.9], startSize: [0.6, 1], gravity: 0.25,
           maxParticles: 250, startRotation: [0, 360], startColor: ['#9a9a9a', '#c8c8c8']},
    emission: {rateOverTime: 14},
    shape: {type: 'cone', angle: 18, radius: 0.4},
    noise: {enabled: true, strength: 0.4, frequency: 0.4, scrollSpeed: 0.2},
    limitVelocity: {enabled: true, drag: 0.4},
    colorOverLife: {gradient: {keys: [{t: 0, color: '#ffffff', alpha: 0}, {t: 0.15, color: '#ffffff', alpha: 0.55},
      {t: 1, color: '#ffffff', alpha: 0}]}},
    sizeOverLife: {curve: {keys: [[0, 0.5], [1, 2.2]]}},
    rotationOverLife: {enabled: true, angularVelocity: [-25, 25]},
    render: {blending: 'normal'}
  }); } },
  sparks: { label: 'Étincelles', make: function(){ return paPreset({
    main: {startLifetime: [0.4, 0.9], startSpeed: [4, 8], startSize: [0.05, 0.09], gravity: -9.8,
           maxParticles: 500, looping: false, duration: 1},
    emission: {rateOverTime: 0, bursts: [{time: 0, count: 80, cycles: 1, interval: 0.5}]},
    shape: {type: 'hemisphere', radius: 0.1},
    collision: {enabled: true, planeHeight: 0, bounce: 0.35, lifetimeLoss: 0.2},
    colorOverLife: {gradient: {keys: [{t: 0, color: '#fffbe0', alpha: 1}, {t: 0.4, color: '#ffc040', alpha: 1},
      {t: 1, color: '#ff5a1a', alpha: 0}]}},
    sizeOverLife: {curve: {keys: [[0, 1], [1, 0.4]]}},
    render: {renderMode: 'stretched', lengthScale: 1, speedScale: 0.06}
  }); } },
  rain: { label: 'Pluie', make: function(){ return paPreset({
    main: {startLifetime: [1.2, 1.4], startSpeed: [0, 0], startSize: [0.03, 0.04], gravity: -14,
           maxParticles: 3000, simulationSpace: 'world', startColor: ['#b8c8e0', '#dfe8f5']},
    emission: {rateOverTime: 1200},
    shape: {type: 'box', size: [20, 0.1, 20]},
    colorOverLife: {gradient: {keys: [{t: 0, color: '#ffffff', alpha: 0.6}, {t: 1, color: '#ffffff', alpha: 0.6}]}},
    sizeOverLife: {enabled: false},
    collision: {enabled: true, planeHeight: 0, bounce: 0, lifetimeLoss: 1},
    render: {blending: 'normal', renderMode: 'stretched', lengthScale: 1.5, speedScale: 0.03}
  }); } },
  dust: { label: 'Poussière', make: function(){ return paPreset({
    main: {startLifetime: [4, 7], startSpeed: [0.02, 0.1], startSize: [0.03, 0.07],
           maxParticles: 400, startColor: ['#e8dcc0', '#fff5dc'], prewarm: true},
    emission: {rateOverTime: 50},
    shape: {type: 'box', size: [8, 3, 8]},
    noise: {enabled: true, strength: 0.15, frequency: 0.3, scrollSpeed: 0.1},
    colorOverLife: {gradient: {keys: [{t: 0, color: '#ffffff', alpha: 0}, {t: 0.3, color: '#ffffff', alpha: 0.7},
      {t: 0.7, color: '#ffffff', alpha: 0.7}, {t: 1, color: '#ffffff', alpha: 0}]}},
    sizeOverLife: {enabled: false},
    render: {blending: 'additive'}
  }); } },
  magic: { label: 'Magie', make: function(){ return paPreset({
    main: {startLifetime: [1, 1.8], startSpeed: [0.2, 0.6], startSize: [0.08, 0.18],
           maxParticles: 400, startColor: ['#8a5cff', '#3fd0ff']},
    emission: {rateOverTime: 70},
    shape: {type: 'sphere', radius: 0.6, radiusThickness: 0},
    velocityOverLife: {enabled: true, linear: [0, 0.6, 0], space: 'world'},
    noise: {enabled: true, strength: 1.2, frequency: 1.5, scrollSpeed: 1},
    colorOverLife: {gradient: {keys: [{t: 0, color: '#ffffff', alpha: 0}, {t: 0.2, color: '#ffffff', alpha: 1},
      {t: 1, color: '#ffffff', alpha: 0}]}},
    sizeOverLife: {curve: {keys: [[0, 0.3], [0.2, 1], [1, 0]]}}
  }); } }
};

/** Le système d'un preset (ou les défauts, pour un nom inconnu). */
export function systemOfPreset(name){
  const p = PARTICLE_PRESETS[name];
  return p ? p.make() : normalizeParticleSystem(defaultParticleSystem());
}

/** Ce qui part dans `assets/particles/X.particles.json`. */
export function particlesFileContent(system){
  return {format: 'particles', version: PARTICLES_FORMAT_VERSION, system: normalizeParticleSystem(system)};
}

/** Relit un fichier `.particles.json` (ou un objet déjà analysé). Ne lève jamais. */
export function readParticlesFile(data){
  const d = (typeof data === 'string') ? (function(){ try { return JSON.parse(data); } catch(e){ return null; } })() : data;
  if(!d || typeof d !== 'object') return normalizeParticleSystem(null);
  return normalizeParticleSystem(d.system || d);
}
