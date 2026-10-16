// ---------- Particles (P1-3) ----------
// Émetteur = objet de scène portant le composant Particles ; sa recette vit dans
// userData.part (sac du composant, format de js/particle-asset.js). Le système vivant —
// simulation et maillage instancié — est construit par js/particle-system.js, le MÊME fichier
// que le jeu publié : il n'y a plus de copie du rendu à garder en phase. Ce fichier-ci ne tient
// que le registre de l'éditeur (quel émetteur a quel système) et l'aperçu.
import { PART_DEFAULT, ensurePart } from './component-data.js';
import { NodeShells, Registry } from './component-registry.js';
import { hideEditorMarker } from './editor-overlay.js';
import { applyNodeMixin } from './node.js';
import { isSceneObject } from './objects.js';
import { scene } from './scene.js';
import { engineScripts } from './scripts.js';
import { aliveCountOf, createParticleSystem, disposeParticleSystem, emitParticleBurst,
         pauseParticleSystem, playParticleSystem, refreshParticleSystem, restartParticleSystem,
         stopParticleSystem, updateParticleSystem } from './particle-system.js';

export const engineParticles = {systemes: [], inGamePrev: false, paused: false};

export function makeParticles(){
  const mesh = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.22),
    new THREE.MeshStandardMaterial({color:0x111111, emissive:0xff9944, emissiveIntensity:1.2}));
  mesh.name = 'Particles';
  mesh.userData.type = 'particles';
  mesh.userData.emissiveBase = 0xff9944;
  mesh.userData.emissiveSel = 0xff8830;
  mesh.userData.part = JSON.parse(JSON.stringify(PART_DEFAULT));
  // Repère d'édition ÉTEINT : son icône (js/gizmo-icons.js) le remplace — ni dessiné ni ombré.
  hideEditorMarker(mesh);
  applyNodeMixin(mesh);
  mesh.addComponent('Particles', mesh.userData.part);
  return mesh;
}

// L'hôte de l'éditeur (voir l'en-tête de js/particle-system.js).
export const editorParticleHost = {
  findAsset: function(id){
    const list = globalThis.assets || [];
    for(let i = 0; i < list.length; i++){ if(list[i] && list[i].id === id) return list[i]; }
    return null;
  },
  resolveTexture: function(id){
    const a = editorParticleHost.findAsset(id);
    return (a && a.kind === 'texture' && a.texture) ? a.texture : null;
  },
  sceneTarget: null,
  release: function(x){ if(x && x.dispose) x.dispose(); },
  camera: function(){ return (typeof globalThis.camCurrent === 'function') ? globalThis.camCurrent() : null; }
};

function particleEntryOf(o){
  return engineParticles.systemes.find(function(s){ return s.obj === o; }) || null;
}

export function systemOf(o){
  let e = particleEntryOf(o);
  if(!e && o.getComponent && o.getComponent('Particles')){
    ensurePart(o);
    editorParticleHost.sceneTarget = scene;
    e = {obj: o, sys: createParticleSystem(o, editorParticleHost)};
    engineParticles.systemes.push(e);
  }
  return e ? e.sys : null;
}

/**
 * À appeler après une édition de l'émetteur (inspecteur, copilote) : le système se RELIT —
 * il ne se détruit plus, les particules en vol restent. Le maillage n'est reconstruit que si
 * ce qui le fixe a changé (nombre max, mélange, texture, orientation, planche).
 */
export function resetSystemParticles(o){
  const e = particleEntryOf(o);
  if(!e) return;
  if(!o.getComponent || !o.getComponent('Particles') || !o.userData.part){
    disposeParticleSystem(e.sys);
    engineParticles.systemes.splice(engineParticles.systemes.indexOf(e), 1);
    return;
  }
  refreshParticleSystem(e.sys);
}

/** Tous les émetteurs relisent leur système (un asset `particles` a été modifié). */
export function refreshAllParticles(){
  engineParticles.systemes.forEach(function(e){ if(e.obj.userData.part) refreshParticleSystem(e.sys); });
}

// burst manuel — bouton de l'inspecteur, api.particles().emit(), événements
export function emitBurst(o, n){
  if(!o || !o.getComponent || !o.getComponent('Particles')) return;
  const sys = systemOf(o);
  if(sys) emitParticleBurst(sys, n);
}

/** Lecture / arrêt / pause par émetteur (api.particles(), inspecteur). */
export function controlParticles(o, action, arg){
  if(!o || !o.getComponent || !o.getComponent('Particles')) return;
  const sys = systemOf(o);
  if(!sys) return;
  if(action === 'play') playParticleSystem(sys);
  else if(action === 'stop') stopParticleSystem(sys, !!arg);
  else if(action === 'pause') pauseParticleSystem(sys, arg !== false);
  else if(action === 'restart') restartParticleSystem(sys);
}

export function particlesAliveCount(o){
  const e = particleEntryOf(o);
  return e ? aliveCountOf(e.sys) : 0;
}

// appelé chaque image par la boucle du viewport (dt = 0 en pause)
export function updateParticles(dt){
  // purge des systèmes dont l'émetteur a disparu (suppression, undo, changement de scène)
  for(let i = engineParticles.systemes.length - 1; i >= 0; i--){
    const e = engineParticles.systemes[i];
    if(!isSceneObject(e.obj) || !e.obj.getComponent || !e.obj.getComponent('Particles')){
      disposeParticleSystem(e.sys);
      engineParticles.systemes.splice(i, 1);
    }
  }
  const inGame = engineScripts.inProgress;
  if(inGame !== engineParticles.inGamePrev){
    engineParticles.inGamePrev = inGame;
    // Entrée ou sortie du mode jeu : chaque système repart de zéro, comme au chargement. En
    // jeu, « Lecture au démarrage » décochée le laisse muet jusqu'à api.particles().play().
    engineParticles.systemes.forEach(function(e){
      restartParticleSystem(e.sys);
      if(inGame && !e.sys.system.main.playOnAwake) stopParticleSystem(e.sys, true);
    });
  }
  // Émetteurs lus au Registry (composant Particles) et non par un balayage de toute la scène.
  // liveNodes et pas activeNodes : un émetteur décoché cesse d'ÉMETTRE mais ses particules
  // déjà en vol doivent finir leur course — les ignorer ici les figerait en l'air.
  Registry.liveNodes('Particles').forEach(function(o){
    const fresh = !particleEntryOf(o);
    const sys = systemOf(o);
    if(!sys) return;
    if(fresh && inGame && !sys.system.main.playOnAwake) stopParticleSystem(sys, true);
    const cfg = o.userData.part;
    const vis = (typeof visibleIntent === 'function')
      ? visibleIntent(o) && (!o.parent || visibleIntent(o.parent)) : o.visible !== false;
    // Hors jeu, l'aperçu relit l'asset quatre fois par seconde : une édition dans l'inspecteur
    // de l'asset se voit sans rien reconstruire à la main. En jeu, deux fois : un script qui
    // écrit un réglage (anciens noms à plat compris) est suivi, comme dans le jeu publié.
    updateParticleSystem(sys, engineParticles.paused ? 0 : dt, {
      emit: vis && cfg.active !== false,
      preview: !inGame,
      resolveEvery: inGame ? 0.5 : 0.25
    });
  });
}

// Le porteur d'un émetteur : l'octaèdre orange, repère d'édition (voir NodeShells).
NodeShells.register('Particles', function(){ return makeParticles(); });


// EXPOSÉ EN GLOBALE, à dessein. Ces symboles sont appelés depuis des fichiers
// que les mêmes pages ne chargent pas toutes : un `import` y pointerait un
// fichier absent, et la page ne démarrerait pas. Ils gardent donc leur garde
// `typeof` côté appelant, et se déclarent ici.
globalThis.resetSystemParticles = resetSystemParticles;
globalThis.refreshAllParticles = refreshAllParticles;
globalThis.controlParticles = controlParticles;
