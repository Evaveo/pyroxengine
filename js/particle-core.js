// moteur/js/particle-core.js
// ---------- Le pas de simulation des particules, sans three ni DOM ----------
//
// Tout ce qui DÉCIDE (émettre, avancer, faire mourir, colorer) est ici, sur des tableaux
// typés, sans dépendre de three : c'est ce qui le rend éprouvable hors navigateur et PARTAGÉ
// tel quel entre l'éditeur et le jeu publié. Avant cette version, la même boucle existait en
// deux copies (js/particles.js et js/game-runtime.js) à « garder en phase » — à la main.
//
// La couche three (géométrie instanciée, matériau TSL, envoi au GPU) est dans
// js/particle-system.js ; elle lit les tableaux de sortie (`out`) que ce fichier remplit.
//
// L'émetteur est décrit par sa matrice monde (16 nombres, colonne d'abord, comme
// THREE.Matrix4.elements) et son quaternion monde : c'est tout ce qu'il faut savoir de lui.

import { compileGradient, evaluateCurve, evaluateGradient, particleHexToRgb } from './particle-asset.js';

const PC_DEG = Math.PI / 180;

/**
 * Prépare un système (déjà normalisé) pour la boucle : dégradé converti en RVB, couleurs de
 * départ analysées, angles en radians. À refaire quand le système change, pas à chaque image.
 */
export function compileSystem(system){
  const s = system;
  return {
    s: s,
    gradient: (s.colorOverLife && s.colorOverLife.enabled) ? compileGradient(s.colorOverLife.gradient) : null,
    color0: particleHexToRgb(s.main.startColor[0]),
    color1: particleHexToRgb(s.main.startColor[1]),
    coneAngle: Math.max(0, Math.min(89, s.shape.angle)) * PC_DEG,
    tiles: Math.max(1, s.textureSheet.tilesX * s.textureSheet.tilesY)
  };
}

/** L'état d'un système vivant : les particules et l'horloge de l'émission. */
export function createParticleState(max, random){
  const n = Math.max(1, max | 0);
  return {
    max: n, nb: 0,
    pos: new Float32Array(n * 3), vel: new Float32Array(n * 3),
    age: new Float32Array(n), life: new Float32Array(n),
    size0: new Float32Array(n), rot: new Float32Array(n), rotVel: new Float32Array(n),
    col0: new Float32Array(n * 3), frame0: new Float32Array(n),
    time: 0, accu: 0, distAccu: 0, delayLeft: -1,
    lastEmitter: null,       // dernière position monde de l'émetteur (émission à la distance)
    playing: true, emitting: true, prewarmed: false, loops: 0,
    random: random || Math.random
  };
}

/** Remet l'horloge à zéro et vide les particules (lecture qui recommence). */
export function restartState(st){
  st.nb = 0; st.time = 0; st.accu = 0; st.distAccu = 0; st.delayLeft = -1;
  st.lastEmitter = null; st.playing = true; st.emitting = true; st.prewarmed = false; st.loops = 0;
}

function pcLerp(a, b, f){ return a + (b - a) * f; }
function pcBetween(st, pair){ return pcLerp(pair[0], pair[1], st.random()); }

// vecteur unitaire aléatoire (rejet dans la boule, comme l'ancien pointSphereRandom)
function pcRandomUnit(st, out){
  let x, y, z, l;
  do {
    x = st.random() * 2 - 1; y = st.random() * 2 - 1; z = st.random() * 2 - 1;
    l = x * x + y * y + z * z;
  } while(l > 1 || l < 1e-6);
  l = Math.sqrt(l);
  out[0] = x / l; out[1] = y / l; out[2] = z / l;
  return out;
}

function pcApplyMatrix(m, v){
  const x = v[0], y = v[1], z = v[2];
  v[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
  v[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
  v[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  return v;
}

function pcApplyQuat(q, v){
  const x = v[0], y = v[1], z = v[2];
  const qx = q[0], qy = q[1], qz = q[2], qw = q[3];
  const ix = qw * x + qy * z - qz * y;
  const iy = qw * y + qz * x - qx * z;
  const iz = qw * z + qx * y - qy * x;
  const iw = -qx * x - qy * y - qz * z;
  v[0] = ix * qw + iw * -qx + iy * -qz - iz * -qy;
  v[1] = iy * qw + iw * -qy + iz * -qx - ix * -qz;
  v[2] = iz * qw + iw * -qz + ix * -qy - iy * -qx;
  return v;
}

const _pcP = [0, 0, 0], _pcD = [0, 0, 0], _pcR = [0, 0, 0], _pcG = [0, 0, 0], _pcC = [0, 0, 0, 0];
const PC_IDENTITY = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
const PC_NO_ROT = [0, 0, 0, 1];

/** Position et direction LOCALES d'une naissance, selon la forme d'émission. */
function pcShapeSample(st, c, pos, dir){
  const sh = c.s.shape;
  const th = sh.radiusThickness;
  const type = sh.enabled ? sh.type : 'point';
  if(type === 'box'){
    pos[0] = (st.random() - 0.5) * (sh.size[0] || 0);
    pos[1] = (st.random() - 0.5) * (sh.size[1] || 0);
    pos[2] = (st.random() - 0.5) * (sh.size[2] || 0);
    dir[0] = 0; dir[1] = 1; dir[2] = 0;
  } else if(type === 'sphere' || type === 'hemisphere'){
    pcRandomUnit(st, dir);
    if(type === 'hemisphere') dir[1] = Math.abs(dir[1]);
    const r = sh.radius * Math.cbrt(1 - th + th * st.random());
    pos[0] = dir[0] * r; pos[1] = dir[1] * r; pos[2] = dir[2] * r;
  } else if(type === 'circle'){
    const phi = st.random() * Math.PI * 2;
    const r = sh.radius * Math.sqrt(1 - th + th * st.random());
    pos[0] = Math.cos(phi) * r; pos[1] = 0; pos[2] = Math.sin(phi) * r;
    dir[0] = Math.cos(phi); dir[1] = 0; dir[2] = Math.sin(phi);
  } else if(type === 'edge'){
    pos[0] = (st.random() * 2 - 1) * sh.radius; pos[1] = 0; pos[2] = 0;
    dir[0] = 0; dir[1] = 1; dir[2] = 0;
  } else if(type === 'point'){
    pos[0] = pos[1] = pos[2] = 0;
    pcRandomUnit(st, dir);
  } else { // cone (le code de l'ancien emitIn, à l'identique pour radiusThickness = 1)
    const phi = st.random() * Math.PI * 2;
    const cosMax = Math.cos(c.coneAngle);
    const cosT = cosMax + (1 - cosMax) * st.random();
    const sinT = Math.sqrt(1 - cosT * cosT);
    dir[0] = sinT * Math.cos(phi); dir[1] = cosT; dir[2] = sinT * Math.sin(phi);
    const r = sh.radius * Math.sqrt(1 - th + th * st.random());
    pos[0] = Math.cos(phi) * r; pos[1] = 0; pos[2] = Math.sin(phi) * r;
  }
  const rd = sh.enabled ? sh.randomizeDirection : 0;
  if(rd > 0){
    pcRandomUnit(st, _pcR);
    dir[0] = pcLerp(dir[0], _pcR[0], rd); dir[1] = pcLerp(dir[1], _pcR[1], rd); dir[2] = pcLerp(dir[2], _pcR[2], rd);
    const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    dir[0] /= l; dir[1] /= l; dir[2] /= l;
  }
}

/**
 * Fait naître `n` particules. `emitter` = {matrix, quat} monde ; `at` (facultatif) = une
 * position monde imposée — c'est ainsi qu'un sous-émetteur naît là où sa particule mère meurt.
 * Rend le nombre réellement émis (borné par `max`).
 */
export function emitParticles(st, c, n, emitter, at, onEvent){
  const s = c.s;
  const local = s.main.simulationSpace === 'local' && !at;
  const m = (emitter && emitter.matrix) || PC_IDENTITY;
  const q = (emitter && emitter.quat) || PC_NO_ROT;
  let done = 0;
  for(let k = 0; k < n && st.nb < st.max; k++){
    const i = st.nb++;
    pcShapeSample(st, c, _pcP, _pcD);
    if(at){
      _pcP[0] = at[0]; _pcP[1] = at[1]; _pcP[2] = at[2];
      pcRandomUnit(st, _pcD);
    } else if(!local){
      pcApplyMatrix(m, _pcP);
      pcApplyQuat(q, _pcD);
    }
    const speed = pcBetween(st, s.main.startSpeed);
    st.pos[i*3] = _pcP[0]; st.pos[i*3+1] = _pcP[1]; st.pos[i*3+2] = _pcP[2];
    st.vel[i*3] = _pcD[0] * speed; st.vel[i*3+1] = _pcD[1] * speed; st.vel[i*3+2] = _pcD[2] * speed;
    st.age[i] = 0;
    st.life[i] = Math.max(0.01, pcBetween(st, s.main.startLifetime));
    st.size0[i] = pcBetween(st, s.main.startSize);
    st.rot[i] = pcBetween(st, s.main.startRotation) * PC_DEG;
    st.rotVel[i] = s.rotationOverLife.enabled ? pcBetween(st, s.rotationOverLife.angularVelocity) * PC_DEG : 0;
    const f = st.random();
    st.col0[i*3] = pcLerp(c.color0[0], c.color1[0], f);
    st.col0[i*3+1] = pcLerp(c.color0[1], c.color1[1], f);
    st.col0[i*3+2] = pcLerp(c.color0[2], c.color1[2], f);
    st.frame0[i] = s.textureSheet.randomStart ? Math.floor(st.random() * c.tiles) : 0;
    done++;
    if(onEvent) onEvent('birth', st, i);
  }
  return done;
}

/** Les salves dont l'instant tombe dans [t0, t1[ de l'horloge du système. */
function pcBurstsBetween(c, t0, t1){
  let n = 0;
  const list = c.s.emission.bursts;
  for(let b = 0; b < list.length; b++){
    const bu = list[b];
    for(let k = 0; k < bu.cycles; k++){
      const bt = bu.time + k * bu.interval;
      if(bt >= t0 && bt < t1) n += bu.count;
    }
  }
  return n;
}

// Un champ de « bruit » sans divergence apparente, à base de sinus : pas une vraie curl
// noise, mais un mouvement tourbillonnant cohérent dans l'espace et le temps, pour le prix de
// six sinus par particule. Assez pour une fumée ou une magie qui ondule.
function pcNoiseAt(x, y, z, t, out){
  out[0] = 0.5 * (Math.sin(y * 1.7 + t) + Math.cos(z * 1.3 - t * 0.8));
  out[1] = 0.5 * (Math.sin(z * 1.9 + t * 1.1) + Math.cos(x * 1.1 + t * 0.6));
  out[2] = 0.5 * (Math.sin(x * 1.5 - t * 0.9) + Math.cos(y * 1.6 + t * 0.7));
  return out;
}

/**
 * Avance le système de `dt` secondes.
 *
 *   emitter : {matrix, quat, invQuat} monde de l'émetteur ;
 *   opts    : {emit (l'émetteur a le droit d'émettre : actif ET visible), onEvent(type, st, i)} ;
 *   out     : {pos, size, color (rgba), rot, frame, vel} — tableaux de sortie à remplir, au
 *             moins `max` éléments (×3 ou ×4 selon le cas). Rend le nombre de vivantes.
 */
export function stepParticles(st, c, dt, emitter, opts, out){
  const s = c.s;
  const o = opts || {};
  const onEvent = o.onEvent || null;
  if(dt > 0 && st.playing){
    // Préchauffage : un système en boucle démarre comme s'il tournait depuis une durée entière.
    if(s.main.prewarm && s.main.looping && !st.prewarmed){
      st.prewarmed = true;
      const steps = Math.min(600, Math.ceil(s.main.duration * 30));
      for(let k = 0; k < steps; k++) stepParticles(st, c, s.main.duration / steps, emitter, {emit: o.emit, onEvent: onEvent}, null);
    }
    if(st.delayLeft < 0) st.delayLeft = s.main.startDelay;
    if(st.delayLeft > 0){
      st.delayLeft = Math.max(0, st.delayLeft - dt);
    } else if(o.emit !== false && st.emitting && s.emission.enabled){
      let n = 0;
      st.accu += s.emission.rateOverTime * dt;
      n += Math.floor(st.accu);
      st.accu -= Math.floor(st.accu);
      if(s.emission.rateOverDistance > 0 && emitter && emitter.matrix){
        const m = emitter.matrix;
        if(st.lastEmitter){
          const dx = m[12] - st.lastEmitter[0], dy = m[13] - st.lastEmitter[1], dz = m[14] - st.lastEmitter[2];
          st.distAccu += Math.hypot(dx, dy, dz) * s.emission.rateOverDistance;
          n += Math.floor(st.distAccu);
          st.distAccu -= Math.floor(st.distAccu);
        }
        st.lastEmitter = [m[12], m[13], m[14]];
      }
      const t0 = st.time, t1 = st.time + dt, dur = s.main.duration;
      if(t1 < dur){
        n += pcBurstsBetween(c, t0, t1);
        st.time = t1;
      } else {
        n += pcBurstsBetween(c, t0, dur + 1e-9);
        if(s.main.looping){
          st.loops++;
          st.time = (t1 - dur) % dur;
          n += pcBurstsBetween(c, 0, st.time);
        } else {
          // Fin d'un système sans boucle : il cesse d'émettre, ses particules finissent leur vie.
          st.time = dur;
          st.emitting = false;
          st.accu = 0;
        }
      }
      if(n > 0) emitParticles(st, c, n, emitter, null, onEvent);
    }
  }
  // En pause, rien ne bouge : ni émission (plus haut) ni avancement.
  pcIntegrate(st, c, st.playing ? dt : 0, emitter, onEvent);
  if(out) writeOutputs(st, c, emitter, out);
  return st.nb;
}

function pcRemoveAt(st, i){
  const d = --st.nb;
  if(i === d) return;
  st.pos[i*3] = st.pos[d*3]; st.pos[i*3+1] = st.pos[d*3+1]; st.pos[i*3+2] = st.pos[d*3+2];
  st.vel[i*3] = st.vel[d*3]; st.vel[i*3+1] = st.vel[d*3+1]; st.vel[i*3+2] = st.vel[d*3+2];
  st.age[i] = st.age[d]; st.life[i] = st.life[d];
  st.size0[i] = st.size0[d]; st.rot[i] = st.rot[d]; st.rotVel[i] = st.rotVel[d];
  st.col0[i*3] = st.col0[d*3]; st.col0[i*3+1] = st.col0[d*3+1]; st.col0[i*3+2] = st.col0[d*3+2];
  st.frame0[i] = st.frame0[d];
}

function pcIntegrate(st, c, dt, emitter, onEvent){
  if(!(dt > 0)) return;
  const s = c.s;
  const local = s.main.simulationSpace === 'local';
  // Vieillissement et disparition : on parcourt À REBOURS, la dernière vivante prend la place.
  for(let i = st.nb - 1; i >= 0; i--){
    st.age[i] += dt;
    if(st.age[i] >= st.life[i]){
      if(onEvent) onEvent('death', st, i);
      pcRemoveAt(st, i);
    }
  }
  // La gravité est sur Y MONDE : en espace local, on la ramène dans le repère de l'émetteur.
  _pcG[0] = 0; _pcG[1] = s.main.gravity; _pcG[2] = 0;
  if(s.forceOverLife.enabled){
    _pcG[0] += s.forceOverLife.force[0]; _pcG[1] += s.forceOverLife.force[1]; _pcG[2] += s.forceOverLife.force[2];
  }
  if(local && emitter && emitter.invQuat) pcApplyQuat(emitter.invQuat, _pcG);
  const vol = s.velocityOverLife.enabled ? s.velocityOverLife : null;
  let lx = 0, ly = 0, lz = 0;
  if(vol){
    _pcR[0] = vol.linear[0]; _pcR[1] = vol.linear[1]; _pcR[2] = vol.linear[2];
    // `space` est celui des vitesses : « local » suit l'émetteur, « world » est absolu.
    if(vol.space === 'local' && !local && emitter && emitter.quat) pcApplyQuat(emitter.quat, _pcR);
    if(vol.space === 'world' && local && emitter && emitter.invQuat) pcApplyQuat(emitter.invQuat, _pcR);
    lx = _pcR[0]; ly = _pcR[1]; lz = _pcR[2];
  }
  const lim = s.limitVelocity.enabled ? s.limitVelocity : null;
  const nz = s.noise.enabled ? s.noise : null;
  const col = (s.collision.enabled && !local) ? s.collision : null;
  const nt = st.time * (nz ? nz.scrollSpeed : 0) + st.loops * (nz ? nz.scrollSpeed * s.main.duration : 0);
  for(let i = 0; i < st.nb; i++){
    const a = Math.min(1, st.age[i] / st.life[i]);
    let vx = st.vel[i*3] + _pcG[0] * dt, vy = st.vel[i*3+1] + _pcG[1] * dt, vz = st.vel[i*3+2] + _pcG[2] * dt;
    if(lim){
      if(lim.drag > 0){
        const k = Math.max(0, 1 - lim.drag * dt);
        vx *= k; vy *= k; vz *= k;
      }
      if(lim.limit > 0){
        const sp = Math.hypot(vx, vy, vz);
        if(sp > lim.limit){
          const target = sp - (sp - lim.limit) * lim.dampen;
          const k = target / sp;
          vx *= k; vy *= k; vz *= k;
        }
      }
    }
    st.vel[i*3] = vx; st.vel[i*3+1] = vy; st.vel[i*3+2] = vz;
    const mul = (vol && vol.speedCurve) ? evaluateCurve(vol.speedCurve, a) : 1;
    let px = st.pos[i*3] + (vx * mul + lx) * dt;
    let py = st.pos[i*3+1] + (vy * mul + ly) * dt;
    let pz = st.pos[i*3+2] + (vz * mul + lz) * dt;
    if(nz){
      const f = nz.frequency;
      pcNoiseAt(px * f, py * f, pz * f, nt, _pcR);
      px += _pcR[0] * nz.strength * dt; py += _pcR[1] * nz.strength * dt; pz += _pcR[2] * nz.strength * dt;
    }
    if(col){
      const rad = st.size0[i] * 0.5 * col.radiusScale;
      if(py - rad < col.planeHeight && st.vel[i*3+1] < 0){
        py = col.planeHeight + rad;
        st.vel[i*3+1] = -st.vel[i*3+1] * col.bounce;
        st.vel[i*3] *= 0.8; st.vel[i*3+2] *= 0.8;
        if(col.lifetimeLoss > 0) st.age[i] += st.life[i] * col.lifetimeLoss;
        if(onEvent) onEvent('collision', st, i);
      }
    }
    st.pos[i*3] = px; st.pos[i*3+1] = py; st.pos[i*3+2] = pz;
    st.rot[i] += st.rotVel[i] * dt;
  }
}

/** Remplit les tableaux de rendu : position MONDE, taille, couleur rgba, rotation, case, vitesse. */
export function writeOutputs(st, c, emitter, out){
  const s = c.s;
  const local = s.main.simulationSpace === 'local';
  const m = (emitter && emitter.matrix) || PC_IDENTITY;
  const q = (emitter && emitter.quat) || PC_NO_ROT;
  const sizeCurve = s.sizeOverLife.enabled ? s.sizeOverLife.curve : null;
  const ts = s.textureSheet.enabled ? s.textureSheet : null;
  const vol = s.velocityOverLife.enabled ? s.velocityOverLife : null;
  for(let i = 0; i < st.nb; i++){
    const a = Math.min(1, st.age[i] / st.life[i]);
    _pcP[0] = st.pos[i*3]; _pcP[1] = st.pos[i*3+1]; _pcP[2] = st.pos[i*3+2];
    _pcD[0] = st.vel[i*3]; _pcD[1] = st.vel[i*3+1]; _pcD[2] = st.vel[i*3+2];
    if(vol && vol.speedCurve){ const k = evaluateCurve(vol.speedCurve, a); _pcD[0] *= k; _pcD[1] *= k; _pcD[2] *= k; }
    if(local){ pcApplyMatrix(m, _pcP); pcApplyQuat(q, _pcD); }
    if(out.pos){ out.pos[i*3] = _pcP[0]; out.pos[i*3+1] = _pcP[1]; out.pos[i*3+2] = _pcP[2]; }
    if(out.vel){ out.vel[i*3] = _pcD[0]; out.vel[i*3+1] = _pcD[1]; out.vel[i*3+2] = _pcD[2]; }
    if(out.size) out.size[i] = st.size0[i] * (sizeCurve ? evaluateCurve(sizeCurve, a) : 1);
    if(out.color){
      if(c.gradient) evaluateGradient(c.gradient, a, _pcC);
      else { _pcC[0] = _pcC[1] = _pcC[2] = _pcC[3] = 1; }
      out.color[i*4] = st.col0[i*3] * _pcC[0];
      out.color[i*4+1] = st.col0[i*3+1] * _pcC[1];
      out.color[i*4+2] = st.col0[i*3+2] * _pcC[2];
      out.color[i*4+3] = _pcC[3];
    }
    if(out.rot) out.rot[i] = st.rot[i];
    if(out.frame){
      let f = 0;
      if(ts){
        f = (ts.mode === 'fps') ? Math.floor(st.frame0[i] + st.age[i] * ts.fps)
                                : Math.floor(st.frame0[i] + a * ts.cycles * c.tiles);
        f = ((f % c.tiles) + c.tiles) % c.tiles;
      }
      out.frame[i] = f;
    }
  }
}

/** Position monde d'une particule (pour un événement de sous-émetteur). */
export function worldPositionOf(st, c, i, emitter, outVec){
  outVec[0] = st.pos[i*3]; outVec[1] = st.pos[i*3+1]; outVec[2] = st.pos[i*3+2];
  if(c.s.main.simulationSpace === 'local' && emitter && emitter.matrix) pcApplyMatrix(emitter.matrix, outVec);
  return outVec;
}

/** Durée après laquelle un système sans boucle n'a plus rien à montrer (aperçu de l'éditeur). */
export function totalDurationOf(c){
  const s = c.s;
  return s.main.startDelay + s.main.duration + s.main.startLifetime[1];
}
