// ---------- Particles (P1-3) ----------
// Émetteur = objet de scène (type 'particles', config sérialisable dans
// userData.part). Le système runtime (THREE.Points en espace MONDE + shader
// taille/opacité/couleur par particule) vit dans ed(o).part et se reconstruit
// paresseusement — jamais sérialisé. Les particules tournent aussi dans
// l'éditeur (aperçu), et à l'identique dans les builds Web (game-runtime.js).
import { PART_DEFAULT, ensurePart } from './component-data.js';
import { NodeShells, Registry } from './component-registry.js';
import { applyNodeMixin } from './node.js';
import { isSceneObject } from './objects.js';
import { LAYER_HELPERS, scene } from './scene.js';
import { engineScripts } from './scripts.js';

export const engineParticles = {systemes: [], texture: null, inGamePrev: false};

export function makeParticles(){
  const mesh = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.22),
    new THREE.MeshStandardMaterial({color:0x111111, emissive:0xff9944, emissiveIntensity:1.2}));
  mesh.name = 'Particles';
  mesh.userData.type = 'particles';
  mesh.userData.emissiveBase = 0xff9944;
  mesh.userData.emissiveSel = 0xff8830;
  mesh.userData.part = JSON.parse(JSON.stringify(PART_DEFAULT));
  // icône d'édition uniquement : jamais visible par une caméra de jeu
  mesh.layers.set(LAYER_HELPERS);
  applyNodeMixin(mesh);
  mesh.addComponent('Particles', mesh.userData.part);
  return mesh;
}

// disque doux partagé par tous les systèmes
export function textureParticle(){
  if(engineParticles.texture) return engineParticles.texture;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const cx = cv.getContext('2d');
  const g = cx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.85)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  cx.fillStyle = g;
  cx.fillRect(0, 0, 64, 64);
  engineParticles.texture = new THREE.CanvasTexture(cv);
  return engineParticles.texture;
}

// Construit la géométrie instanciée + le matériau TSL d'un système de particules.
// Miroir dans jeu-runtime.js (rtBuildRenderParticles) : ce fichier dépend de globales
// d'éditeur (objets, engineScripts, LAYER_HELPERS) qu'un build publié n'a pas, il ne peut
// donc pas y être embarqué. Garder les deux copies en phase.
//
// Quads billboardés et NON THREE.Points : `pointUV` génère littéralement du GLSL
// (`gl_PointCoord`, voir PointUVNode.generate dans le bundle three), invalide en WGSL —
// le pipeline WebGPU était rejeté à CHAQUE image (« unresolved value 'gl_PointCoord' »,
// puis Invalid RenderPipeline/CommandBuffer en boucle). WebGPU n'a d'ailleurs ni
// coordonnée de point ni taille de point : `sizeNode` était mort avec.
// Un quad par particule, orienté face caméra en espace VUE, donne de vraies UV et une
// vraie taille sur les deux backends.
export function buildRenderParticles(cfg, max){
  const gabarit = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', gabarit.attributes.position);
  geo.setAttribute('uv', gabarit.attributes.uv);
  geo.setIndex(gabarit.index);
  const instancie = function(name, n){
    const a = new THREE.InstancedBufferAttribute(new Float32Array(max * n), n);
    a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute(name, a);
    return a;
  };
  instancie('aPos', 3);
  instancie('aSize', 1);
  instancie('aOpacity', 1);
  instancie('aColor', 3);
  geo.instanceCount = 0;
  // Les particules sont intégrées en espace MONDE (voir emitIn) et l'objet porteur
  // reste à l'origine : la matrice de modèle est l'identité, on passe donc directement du
  // monde à la vue.
  const {attribute, texture, uv, vec3, vec4, cameraViewMatrix, cameraProjectionMatrix,
    positionGeometry, float} = TSL;
  const aSize = attribute('aSize', 'float');
  const aOpacity = attribute('aOpacity', 'float');
  const aColor = attribute('aColor', 'vec3');
  const aPos = attribute('aPos', 'vec3');
  const mat = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: cfg.additif !== false ? THREE.AdditiveBlending : THREE.NormalBlending
  });
  // billboard : centre de la particule en espace view + décalage du quad dans le plan
  // écran (X droite, Y haut de la caméra), mis à l'échelle par la taille de la particule.
  const centerView = cameraViewMatrix.mul(vec4(aPos, float(1))).xyz;
  const offset = vec3(positionGeometry.x.mul(aSize), positionGeometry.y.mul(aSize), float(0));
  mat.vertexNode = cameraProjectionMatrix.mul(vec4(centerView.add(offset), float(1)));
  mat.colorNode = vec4(aColor, aOpacity.mul(texture(textureParticle(), uv()).a));
  return {geo: geo, mat: mat};
}

export function createSystemParticles(o, sceneTarget){
  const cfg = ensurePart(o);
  const max = Math.max(1, Math.min(5000, cfg.max | 0 || 300));
  const render = buildRenderParticles(cfg, max);
  const objet3d = new THREE.Mesh(render.geo, render.mat);
  objet3d.frustumCulled = false;
  objet3d.raycast = function(){};
  objet3d.userData.isParticles = true;   // jamais sérialisé (pas de userData.type)
  objet3d.renderOrder = 500;
  sceneTarget.add(objet3d);
  return {
    obj: o, objet3d: objet3d, geo: render.geo, max: max,
    pos: new Float32Array(max * 3), vel: new Float32Array(max * 3),
    age: new Float32Array(max), vieP: new Float32Array(max),
    nb: 0, accu: 0, burstFait: false, previewT: 1e9
  };
}

export function destroySystemParticles(sys){
  if(sys.objet3d.parent) sys.objet3d.parent.remove(sys.objet3d);
  sys.geo.dispose();
  sys.objet3d.material.dispose();
}

// à appeler quand additif / max changent (reconstruit au prochain tick)
export function resetSystemParticles(o){
  const i = engineParticles.systemes.findIndex(function(s){ return s.obj === o; });
  if(i !== -1){
    destroySystemParticles(engineParticles.systemes[i]);
    engineParticles.systemes.splice(i, 1);
  }
}

export const _pPos = new THREE.Vector3(), _pDir = new THREE.Vector3(), _pQ = new THREE.Quaternion();
export function pointSphereRandom(v){
  do{
    v.set(Math.random()*2 - 1, Math.random()*2 - 1, Math.random()*2 - 1);
  } while(v.lengthSq() > 1 || v.lengthSq() < 1e-6);
  return v;
}

export function emitIn(sys, n){
  const cfg = sys.obj.userData.part;
  sys.obj.updateWorldMatrix(true, false);
  sys.obj.getWorldQuaternion(_pQ);
  for(let k = 0; k < n && sys.nb < sys.max; k++){
    const i = sys.nb++;
    // position et direction locales selon la forme
    if(cfg.shape === 'box'){
      _pPos.set((Math.random()-0.5) * (cfg.dims[0] || 1),
                (Math.random()-0.5) * (cfg.dims[1] || 1),
                (Math.random()-0.5) * (cfg.dims[2] || 1));
      _pDir.set(0, 1, 0);
    } else if(cfg.shape === 'sphere'){
      pointSphereRandom(_pDir).normalize();
      _pPos.copy(_pDir).multiplyScalar((cfg.radius || 0.4) * Math.cbrt(Math.random()));
    } else if(cfg.shape === 'point'){
      _pPos.set(0, 0, 0);
      pointSphereRandom(_pDir).normalize();
    } else { // cone
      const a = THREE.MathUtils.degToRad(Math.max(0, Math.min(89, cfg.angle || 20)));
      const phi = Math.random() * Math.PI * 2;
      const cosMax = Math.cos(a);
      const cosT = cosMax + (1 - cosMax) * Math.random();
      const sinT = Math.sqrt(1 - cosT * cosT);
      _pDir.set(sinT * Math.cos(phi), cosT, sinT * Math.sin(phi));
      const r = (cfg.radius || 0.4) * Math.sqrt(Math.random());
      _pPos.set(Math.cos(phi) * r, 0, Math.sin(phi) * r);
    }
    _pPos.applyMatrix4(sys.obj.matrixWorld);
    _pDir.applyQuaternion(_pQ).normalize()
         .multiplyScalar((cfg.speed !== undefined ? cfg.speed : 2.5) * (0.75 + Math.random() * 0.5));
    sys.pos[i*3] = _pPos.x; sys.pos[i*3+1] = _pPos.y; sys.pos[i*3+2] = _pPos.z;
    sys.vel[i*3] = _pDir.x; sys.vel[i*3+1] = _pDir.y; sys.vel[i*3+2] = _pDir.z;
    sys.age[i] = 0;
    sys.vieP[i] = Math.max(0.05, (cfg.vie || 1.3) * (0.75 + Math.random() * 0.5));
  }
}

export function systemOf(o){
  let sys = engineParticles.systemes.find(function(s){ return s.obj === o; });
  if(!sys && o.getComponent && o.getComponent('Particles')){
    sys = createSystemParticles(o, scene);
    engineParticles.systemes.push(sys);
  }
  return sys || null;
}

// burst manuel — bouton de l'inspecteur, api.particles().emit(), événements
export function emitBurst(o, n){
  if(!o || !o.getComponent || !o.getComponent('Particles')) return;
  const sys = systemOf(o);
  if(sys) emitIn(sys, n || o.userData.part.amount || 40);
}

export const _c1 = new THREE.Color(), _c2 = new THREE.Color(), _c3 = new THREE.Color();
export function integrateSystem(sys, dt){
  const cfg = sys.obj.userData.part;
  // vieillissement + suppression (échange avec la dernière vivante)
  for(let i = sys.nb - 1; i >= 0; i--){
    sys.age[i] += dt;
    if(sys.age[i] >= sys.vieP[i]){
      const d = --sys.nb;
      if(i !== d){
        sys.pos[i*3] = sys.pos[d*3]; sys.pos[i*3+1] = sys.pos[d*3+1]; sys.pos[i*3+2] = sys.pos[d*3+2];
        sys.vel[i*3] = sys.vel[d*3]; sys.vel[i*3+1] = sys.vel[d*3+1]; sys.vel[i*3+2] = sys.vel[d*3+2];
        sys.age[i] = sys.age[d];
        sys.vieP[i] = sys.vieP[d];
      }
    }
  }
  // intégration + écriture des attributs
  const g = cfg.gravity || 0;
  _c1.set(cfg.colorStart || '#ffb347');
  _c2.set(cfg.colorEnd || '#ff4422');
  const aPos = sys.geo.attributes.aPos.array;
  const aTa = sys.geo.attributes.aSize.array;
  const aOp = sys.geo.attributes.aOpacity.array;
  const aCo = sys.geo.attributes.aColor.array;
  const t1 = (cfg.sizeStart !== undefined) ? cfg.sizeStart : 0.3;
  const t2 = (cfg.sizeEnd !== undefined) ? cfg.sizeEnd : 0.06;
  const o1 = (cfg.opacityStart !== undefined) ? cfg.opacityStart : 1;
  const o2 = (cfg.opacityEnd !== undefined) ? cfg.opacityEnd : 0;
  for(let i = 0; i < sys.nb; i++){
    sys.vel[i*3+1] += g * dt;
    sys.pos[i*3]   += sys.vel[i*3]   * dt;
    sys.pos[i*3+1] += sys.vel[i*3+1] * dt;
    sys.pos[i*3+2] += sys.vel[i*3+2] * dt;
    const a = Math.min(1, sys.age[i] / sys.vieP[i]);
    aPos[i*3] = sys.pos[i*3]; aPos[i*3+1] = sys.pos[i*3+1]; aPos[i*3+2] = sys.pos[i*3+2];
    aTa[i] = t1 + (t2 - t1) * a;
    aOp[i] = o1 + (o2 - o1) * a;
    _c3.copy(_c1).lerp(_c2, a);
    aCo[i*3] = _c3.r; aCo[i*3+1] = _c3.g; aCo[i*3+2] = _c3.b;
  }
  // instanceCount et non setDrawRange : le nombre d'instances (= de particules vivantes)
  // pilote le rendu, l'index du quad gabarit reste entier.
  sys.geo.instanceCount = sys.nb;
  markParticlesUploaded(sys);
}

/**
 * N'envoie au GPU que la PARTIE VIVANTE des tampons, et rien du tout quand il n'y a rien à dessiner
 * ni avant ni maintenant. Les quatre tampons entiers (`max` particules, 160 Ko pour 5 000) partaient
 * à chaque image, système vide ou en pause compris (revue du 2026-09-29, § 5.11). Un moteur qui
 * ignore les plages d'envoi retombe sur l'envoi complet d'avant : rien de pire.
 */
export function markParticlesUploaded(sys){
  const nb = sys.nb || 0;
  if(!nb && !sys._nbEnvoye) return;
  sys._nbEnvoye = nb;
  ['aPos', 'aSize', 'aOpacity', 'aColor'].forEach(function(k){
    const attr = sys.geo.attributes[k];
    if(!attr) return;
    if(typeof attr.clearUpdateRanges === 'function' && typeof attr.addUpdateRange === 'function'){
      attr.clearUpdateRanges();
      if(nb) attr.addUpdateRange(0, nb * attr.itemSize);
    }
    attr.needsUpdate = true;
  });
}

// appelé chaque image par la boucle du viewport (dt = 0 en pause)
export function updateParticles(dt){
  // purge des systèmes dont l'émetteur a disparu (suppression, undo, changement de scène)
  for(let i = engineParticles.systemes.length - 1; i >= 0; i--){
    if(!isSceneObject(engineParticles.systemes[i].obj)){
      destroySystemParticles(engineParticles.systemes[i]);
      engineParticles.systemes.splice(i, 1);
    }
  }
  const inGame = engineScripts.inProgress;
  if(inGame !== engineParticles.inGamePrev){
    engineParticles.inGamePrev = inGame;
    engineParticles.systemes.forEach(function(s){ s.burstFait = false; s.previewT = 1e9; });
  }
  // Emetteurs lus au Registry (composant Particles) et non par un balayage de
  // toute la scene filtre sur userData.type. liveNodes et pas activeNodes :
  // un emetteur decoche cesse d'EMETTRE (test cfg.active ci-dessous) mais ses
  // particules deja en vol doivent finir leur course — les ignorer ici les
  // figerait en l'air jusqu'au prochain reglage.
  Registry.liveNodes('Particles').forEach(function(o){
    const sys = systemOf(o);
    if(!sys) return;
    const cfg = o.userData.part;
    const emetteurVisible = visibleIntent(o) && (!o.parent || visibleIntent(o.parent));
    if(dt > 0 && emetteurVisible && cfg.active !== false){
      if(cfg.mode === 'burst'){
        if(inGame){
          if(!sys.burstFait){ sys.burstFait = true; emitIn(sys, cfg.amount || 40); }
        } else {
          // aperçu éditeur : burst répété
          sys.previewT += dt;
          if(sys.previewT >= (cfg.vie || 1.3) + 0.8){ sys.previewT = 0; emitIn(sys, cfg.amount || 40); }
        }
      } else {
        sys.accu += (cfg.rate || 25) * dt;
        const n = Math.floor(sys.accu);
        if(n > 0){ sys.accu -= n; emitIn(sys, n); }
      }
    }
    integrateSystem(sys, dt);
  });
}

// Le porteur d'un émetteur : l'octaèdre orange, repère d'édition (voir NodeShells).
NodeShells.register('Particles', function(){ return makeParticles(); });


// EXPOSÉ EN GLOBALE, à dessein. Ces symboles sont appelés depuis des fichiers
// que les mêmes pages ne chargent pas toutes : un `import` y pointerait un
// fichier absent, et la page ne démarrerait pas. Ils gardent donc leur garde
// `typeof` côté appelant, et se déclarent ici.
globalThis.resetSystemParticles = resetSystemParticles;
globalThis.updateParticles = updateParticles;