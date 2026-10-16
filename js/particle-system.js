// moteur/js/particle-system.js
// ---------- Un système de particules vivant : simulation + rendu three ----------
//
// PARTAGÉ tel quel entre l'éditeur (js/particles.js) et le jeu publié (js/game-runtime.js,
// embarqué par build.js). Jusqu'ici le rendu existait en deux copies — buildRenderParticles et
// rtBuildRenderParticles — « à garder en phase » : la seconde n'était jamais à jour. Ce qui
// diffère entre les deux environnements passe par l'HÔTE, un petit objet que chacun fournit :
//
//   host = {
//     findAsset(id)        → l'asset (genre `particles`, `texture`…) ou null,
//     resolveTexture(id)   → une THREE.Texture pour un asset texture, ou null,
//     sceneTarget          → l'Object3D où poser les maillages,
//     release(obj)         → libération GPU (différée côté jeu, immédiate côté éditeur),
//     camera()             → la caméra qui regarde (orientation « verticale »), ou null
//   }
//
// THREE et TSL sont les globales de la page, comme partout ailleurs dans le moteur.
//
// QUADS INSTANCIÉS, PAS THREE.Points : `pointUV` génère littéralement du GLSL (`gl_PointCoord`),
// invalide en WGSL — le pipeline WebGPU était rejeté à chaque image. Un quad par particule,
// orienté en espace VUE, donne de vraies UV et une vraie taille sur les deux backends.

import { resolveParticleSystem, normalizeParticleSystem, upgradePartBag } from './particle-asset.js';
import { compileSystem, createParticleState, emitParticles, restartState, stepParticles,
         totalDurationOf, worldPositionOf } from './particle-core.js';

let psSoftTexture = null;

/** Le disque doux par défaut, partagé par tous les systèmes sans texture. */
export function particleSoftTexture(){
  if(psSoftTexture) return psSoftTexture;
  if(typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const cx = cv.getContext('2d');
  const g = cx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.85)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  cx.fillStyle = g;
  cx.fillRect(0, 0, 64, 64);
  psSoftTexture = new THREE.CanvasTexture(cv);
  return psSoftTexture;
}

/**
 * Ce qui oblige à RECONSTRUIRE le maillage : la taille des tampons, le mélange et la texture
 * posés sur le matériau, la façon d'orienter les quads, le découpage en cases. Le reste
 * (couleurs, courbes, forces…) se lit à chaque image sans rien reconstruire.
 */
export function renderSignature(s){
  const ts = s.textureSheet;
  const r = s.render;
  return [s.main.maxParticles, r.blending, r.textureId || '', r.renderMode,
          r.renderMode === 'stretched' ? r.lengthScale + ':' + r.speedScale : '',
          ts.enabled ? ts.tilesX + 'x' + ts.tilesY : '-'].join('|');
}

const PS_ATTRS = [['aPos', 3], ['aSize', 1], ['aColor', 4], ['aRot', 1], ['aFrame', 1], ['aVel', 3]];

/** Géométrie instanciée + matériau TSL d'un système. */
export function buildParticleRender(s, max, map){
  const gabarit = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', gabarit.attributes.position);
  geo.setAttribute('uv', gabarit.attributes.uv);
  geo.setIndex(gabarit.index);
  PS_ATTRS.forEach(function(d){
    const a = new THREE.InstancedBufferAttribute(new Float32Array(max * d[1]), d[1]);
    a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute(d[0], a);
  });
  geo.instanceCount = 0;
  const T = TSL;
  const aPos = T.attribute('aPos', 'vec3');
  const aSize = T.attribute('aSize', 'float');
  const aColor = T.attribute('aColor', 'vec4');
  const aRot = T.attribute('aRot', 'float');
  const aFrame = T.attribute('aFrame', 'float');
  const aVel = T.attribute('aVel', 'vec3');
  const r = s.render;
  const mat = new THREE.MeshBasicNodeMaterial({transparent: true, depthWrite: false, side: THREE.DoubleSide});
  if(r.blending === 'additive') mat.blending = THREE.AdditiveBlending;
  else if(r.blending === 'multiply'){
    // Multiplier : la couleur assombrit ce qu'il y a derrière (ombre, suie). Le fragment
    // rend `mix(blanc, couleur, alpha)` — un blanc ne change rien —, mélangé par DstColor.
    mat.blending = THREE.CustomBlending;
    mat.blendSrc = THREE.DstColorFactor;
    mat.blendDst = THREE.ZeroFactor;
  } else mat.blending = THREE.NormalBlending;

  const uCamRight = T.uniform(new THREE.Vector3(1, 0, 0));
  // Le coin du quad gabarit, tourné de la rotation de la particule.
  const cx = T.positionGeometry.x, cy = T.positionGeometry.y;
  const cr = T.cos(aRot), sr = T.sin(aRot);
  const rx = cx.mul(cr).sub(cy.mul(sr));
  const ry = cx.mul(sr).add(cy.mul(cr));
  const view = T.cameraViewMatrix, proj = T.cameraProjectionMatrix;
  if(r.renderMode === 'stretched'){
    // Étiré selon la vitesse, dans le plan de l'écran : longueur = taille × échelle + vitesse ×
    // facteur, comme le « Stretched Billboard » de Unity.
    const velView = view.mul(T.vec4(aVel, T.float(0))).xy;
    const dir = T.normalize(velView.add(T.vec2(0, 1e-5)));
    const perp = T.vec2(dir.y.negate(), dir.x);
    const len = aSize.mul(T.float(r.lengthScale)).add(T.length(aVel).mul(T.float(r.speedScale)));
    const off = perp.mul(cx.mul(aSize)).add(dir.mul(cy.mul(len)));
    const centerView = view.mul(T.vec4(aPos, T.float(1))).xyz;
    mat.vertexNode = proj.mul(T.vec4(centerView.add(T.vec3(off.x, off.y, T.float(0))), T.float(1)));
  } else if(r.renderMode === 'horizontal'){
    const world = aPos.add(T.vec3(rx.mul(aSize), T.float(0), ry.mul(aSize)));
    mat.vertexNode = proj.mul(view.mul(T.vec4(world, T.float(1))));
  } else if(r.renderMode === 'vertical'){
    const world = aPos.add(uCamRight.mul(rx.mul(aSize))).add(T.vec3(0, 1, 0).mul(ry.mul(aSize)));
    mat.vertexNode = proj.mul(view.mul(T.vec4(world, T.float(1))));
  } else {
    const centerView = view.mul(T.vec4(aPos, T.float(1))).xyz;
    mat.vertexNode = proj.mul(T.vec4(centerView.add(T.vec3(rx.mul(aSize), ry.mul(aSize), T.float(0))), T.float(1)));
  }
  // La case de la planche (sprite sheet) : lue de gauche à droite et de HAUT en bas, comme une
  // planche dessinée — la texture, elle, a son origine en bas.
  let uvNode = T.uv();
  const ts = s.textureSheet;
  if(ts.enabled && (ts.tilesX > 1 || ts.tilesY > 1)){
    const tx = T.float(ts.tilesX), ty = T.float(ts.tilesY);
    const col = T.mod(aFrame, tx);
    const row = T.floor(aFrame.div(tx));
    uvNode = T.vec2(uvNode.x.add(col).div(tx), uvNode.y.add(ty.sub(1).sub(row)).div(ty));
  }
  const tex = T.texture(map || particleSoftTexture(), uvNode);
  if(r.blending === 'multiply'){
    const a = aColor.w.mul(tex.a);
    mat.colorNode = T.vec4(T.mix(T.vec3(1, 1, 1), aColor.xyz.mul(tex.rgb), a), T.float(1));
  } else {
    mat.colorNode = T.vec4(aColor.xyz.mul(tex.rgb), aColor.w.mul(tex.a));
  }
  return {geo: geo, mat: mat, uniforms: {camRight: uCamRight}};
}

function psMakeMesh(sys){
  const s = sys.system;
  const max = s.main.maxParticles;
  const map = s.render.textureId && sys.host.resolveTexture ? sys.host.resolveTexture(s.render.textureId) : null;
  const render = buildParticleRender(s, max, map);
  const mesh = new THREE.Mesh(render.geo, render.mat);
  mesh.frustumCulled = false;
  mesh.raycast = function(){};
  mesh.userData.isParticles = true;   // jamais sérialisé (pas de userData.type)
  mesh.renderOrder = 500;
  if(sys.host.sceneTarget) sys.host.sceneTarget.add(mesh);
  sys.mesh = mesh; sys.geo = render.geo; sys.mat = render.mat; sys.uniforms = render.uniforms;
  sys.out = {pos: render.geo.attributes.aPos.array, size: render.geo.attributes.aSize.array,
             color: render.geo.attributes.aColor.array, rot: render.geo.attributes.aRot.array,
             frame: render.geo.attributes.aFrame.array, vel: render.geo.attributes.aVel.array};
  sys.sentCount = 0;
}

function psDropMesh(sys){
  if(!sys.mesh) return;
  if(sys.mesh.parent) sys.mesh.parent.remove(sys.mesh);
  const rel = sys.host.release || function(x){ if(x && x.dispose) x.dispose(); };
  rel(sys.geo); rel(sys.mat);
  sys.mesh = null; sys.geo = null; sys.mat = null; sys.out = null;
}

/** Remplace le système résolu ; reconstruit seulement ce que la signature exige. */
function psApplySystem(sys, system){
  const sig = renderSignature(system);
  const maxChanged = !sys.state || sys.state.max !== system.main.maxParticles;
  sys.system = system;
  sys.compiled = compileSystem(system);
  if(maxChanged){
    const old = sys.state;
    sys.state = createParticleState(system.main.maxParticles, sys.random);
    if(old){ sys.state.time = old.time; sys.state.loops = old.loops; }
  }
  if(sig !== sys.sig || maxChanged){
    psDropMesh(sys);
    psMakeMesh(sys);
    sys.sig = sig;
  }
  if(!sys.isChild) psRebuildSubs(sys);
}

function psRebuildSubs(sys){
  const s = sys.system;
  const want = (s.subEmitters.enabled ? s.subEmitters.list : []).filter(function(x){ return x.particlesId; });
  const key = want.map(function(x){ return x.event + ':' + x.particlesId + ':' + x.count; }).join(',');
  if(key === sys.subsKey){
    // Même liste : on relit quand même le système de chaque enfant, son asset a pu changer.
    (sys.subs || []).forEach(function(sub){
      const a = sys.host.findAsset ? sys.host.findAsset(sub.child.assetId) : null;
      if(a && a.kind === 'particles') psApplySystem(sub.child, normalizeParticleSystem(a.system));
    });
    return;
  }
  (sys.subs || []).forEach(function(sub){ disposeParticleSystem(sub.child); });
  sys.subs = [];
  sys.subsKey = key;
  want.forEach(function(x){
    const a = sys.host.findAsset ? sys.host.findAsset(x.particlesId) : null;
    if(!a || a.kind !== 'particles') return;
    // Un enfant n'a pas d'enfants : un asset qui se citerait lui-même tournerait sans fin.
    const child = {node: null, host: sys.host, isChild: true, random: sys.random, assetId: x.particlesId,
                   subs: [], sig: null, state: null};
    psApplySystem(child, normalizeParticleSystem(a.system));
    sys.subs.push({event: x.event, count: x.count, child: child});
  });
}

/**
 * Crée le système d'un émetteur. `node` porte `userData.part` (sac du composant Particles).
 * `opts.random` remplace Math.random (tests).
 */
export function createParticleSystem(node, host, opts){
  const o = opts || {};
  const sys = {node: node, host: host || {}, isChild: false, random: o.random || Math.random,
               subs: [], subsKey: '', sig: null, state: null, sinceResolve: 0,
               previewT: 0};
  upgradePartBag(node.userData.part);
  psApplySystem(sys, resolveParticleSystem(node.userData.part, sys.host.findAsset));
  return sys;
}

/** Relit le système de l'émetteur (asset, surcharges) : après une édition. */
export function refreshParticleSystem(sys){
  if(sys.isChild || !sys.node) return;
  psApplySystem(sys, resolveParticleSystem(sys.node.userData.part, sys.host.findAsset));
  sys.sinceResolve = 0;
}

const _psM = new Array(16).fill(0), _psQ = [0, 0, 0, 1], _psQI = [0, 0, 0, 1];
const _psAT = [0, 0, 0];
const PS_IDENTITY_EMITTER = {matrix: [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1], quat: [0, 0, 0, 1], invQuat: [0, 0, 0, 1]};

function psEmitterOf(sys){
  const node = sys.node;
  if(!node || !node.matrixWorld) return PS_IDENTITY_EMITTER;
  if(node.updateWorldMatrix) node.updateWorldMatrix(true, false);
  const e = node.matrixWorld.elements;
  for(let i = 0; i < 16; i++) _psM[i] = e[i];
  // Quaternion monde sans allouer : décomposition de la matrice, échelle retirée.
  const sx = Math.hypot(e[0], e[1], e[2]) || 1, sy = Math.hypot(e[4], e[5], e[6]) || 1, sz = Math.hypot(e[8], e[9], e[10]) || 1;
  const m11 = e[0] / sx, m12 = e[4] / sy, m13 = e[8] / sz;
  const m21 = e[1] / sx, m22 = e[5] / sy, m23 = e[9] / sz;
  const m31 = e[2] / sx, m32 = e[6] / sy, m33 = e[10] / sz;
  const tr = m11 + m22 + m33;
  let x, y, z, w;
  if(tr > 0){ const s = 0.5 / Math.sqrt(tr + 1); w = 0.25 / s; x = (m32 - m23) * s; y = (m13 - m31) * s; z = (m21 - m12) * s; }
  else if(m11 > m22 && m11 > m33){ const s = 2 * Math.sqrt(1 + m11 - m22 - m33); w = (m32 - m23) / s; x = 0.25 * s; y = (m12 + m21) / s; z = (m13 + m31) / s; }
  else if(m22 > m33){ const s = 2 * Math.sqrt(1 + m22 - m11 - m33); w = (m13 - m31) / s; x = (m12 + m21) / s; y = 0.25 * s; z = (m23 + m32) / s; }
  else { const s = 2 * Math.sqrt(1 + m33 - m11 - m22); w = (m21 - m12) / s; x = (m13 + m31) / s; y = (m23 + m32) / s; z = 0.25 * s; }
  _psQ[0] = x; _psQ[1] = y; _psQ[2] = z; _psQ[3] = w;
  _psQI[0] = -x; _psQI[1] = -y; _psQI[2] = -z; _psQI[3] = w;
  return {matrix: _psM, quat: _psQ, invQuat: _psQI};
}

function psUploadSys(sys){
  if(!sys.geo) return;
  const nb = sys.state.nb;
  sys.geo.instanceCount = nb;
  // Seule la partie VIVANTE des tampons part au GPU, et rien quand le système est vide ni
  // avant ni maintenant (revue du 2026-09-29, § 5.11).
  if(!nb && !sys.sentCount) return;
  sys.sentCount = nb;
  PS_ATTRS.forEach(function(d){
    const attr = sys.geo.attributes[d[0]];
    if(!attr) return;
    if(typeof attr.clearUpdateRanges === 'function' && typeof attr.addUpdateRange === 'function'){
      attr.clearUpdateRanges();
      if(nb) attr.addUpdateRange(0, nb * attr.itemSize);
    }
    attr.needsUpdate = true;
  });
}

function psEventHandler(sys, emitter){
  if(!sys.subs || !sys.subs.length) return null;
  return function(type, st, i){
    for(let k = 0; k < sys.subs.length; k++){
      const sub = sys.subs[k];
      if(sub.event !== type) continue;
      worldPositionOf(st, sys.compiled, i, emitter, _psAT);
      emitParticles(sub.child.state, sub.child.compiled, sub.count, null, _psAT, null);
    }
  };
}

/**
 * Avance le système de `dt`. `opts` :
 *   emit         — l'émetteur a le droit d'émettre (composant actif ET objet visible) ;
 *   preview      — aperçu de l'éditeur : un système sans boucle se rejoue en continu ;
 *   resolveEvery — relire l'asset toutes les N secondes (éditeur : les éditions s'y voient).
 */
export function updateParticleSystem(sys, dt, opts){
  const o = opts || {};
  if(o.resolveEvery > 0){
    sys.sinceResolve += dt > 0 ? dt : 0.016;
    if(sys.sinceResolve >= o.resolveEvery) refreshParticleSystem(sys);
  }
  const emitter = psEmitterOf(sys);
  const st = sys.state;
  if(o.preview && !sys.system.main.looping && dt > 0){
    sys.previewT += dt;
    if(sys.previewT >= totalDurationOf(sys.compiled) + 0.8){
      sys.previewT = 0;
      st.time = 0; st.emitting = true; st.accu = 0; st.delayLeft = -1;
    }
  }
  if(sys.uniforms && sys.system.render.renderMode === 'vertical' && sys.host.camera){
    const cam = sys.host.camera();
    if(cam && cam.matrixWorld){
      const e = cam.matrixWorld.elements;
      const l = Math.hypot(e[0], e[2]) || 1;
      sys.uniforms.camRight.value.set(e[0] / l, 0, e[2] / l);
    }
  }
  stepParticles(st, sys.compiled, dt, emitter, {emit: o.emit !== false, onEvent: psEventHandler(sys, emitter)}, sys.out);
  psUploadSys(sys);
  (sys.subs || []).forEach(function(sub){
    stepParticles(sub.child.state, sub.child.compiled, dt, null, {emit: false}, sub.child.out);
    psUploadSys(sub.child);
  });
  return st.nb;
}

/** Salve manuelle : bouton de l'inspecteur, api.particles().emit(), événement visuel. */
export function emitParticleBurst(sys, n){
  const count = (n | 0) > 0 ? (n | 0) : sys.system.emission.manualCount;
  const emitter = psEmitterOf(sys);
  emitParticles(sys.state, sys.compiled, count, emitter, null, psEventHandler(sys, emitter));
}

/** Lecture depuis le début (vide les particules, remet l'horloge à zéro). */
export function restartParticleSystem(sys){
  restartState(sys.state);
  sys.previewT = 0;
  (sys.subs || []).forEach(function(sub){ restartState(sub.child.state); });
}

export function stopParticleSystem(sys, clear){
  sys.state.emitting = false;
  if(clear){ sys.state.nb = 0; (sys.subs || []).forEach(function(sub){ sub.child.state.nb = 0; }); }
}

export function playParticleSystem(sys){
  sys.state.playing = true;
  if(!sys.state.emitting){ sys.state.emitting = true; sys.state.time = 0; sys.state.delayLeft = -1; }
}

export function pauseParticleSystem(sys, paused){ sys.state.playing = !paused; }

export function disposeParticleSystem(sys){
  if(!sys) return;
  (sys.subs || []).forEach(function(sub){ disposeParticleSystem(sub.child); });
  sys.subs = [];
  psDropMesh(sys);
}

/** Nombre total de particules vivantes (sous-émetteurs compris) — profileur, tests. */
export function aliveCountOf(sys){
  let n = sys.state ? sys.state.nb : 0;
  (sys.subs || []).forEach(function(sub){ n += sub.child.state.nb; });
  return n;
}
