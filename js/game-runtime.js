// ============================================================================
// RUNTIME DE JEU — lecteur autonome des projets de l'éditeur 3D.
// Ce fichier est copié tel quel dans les builds Web (« runtime.js »).
// Il ne dépend d'AUCUN fichier de l'éditeur : uniquement three.js, cannon.js,
// fflate (vendor/) et window.GAME_DATA (data.js, format project v2).
// ============================================================================
import { bindDecoders, compressionsOfModel, decodersMissing, messageDecodersMissing, shareBlobs } from './asset-compression.js';
import { busOfSource, createAudioBuses, createSourceSound, makeAudioBusApi } from './audio-bus.js';
import { sfxBuffer } from './chip-synth.js';
import { loopBuffer } from './music-loop.js';
import { backgroundForCamera, isSkyBackground } from './sky-camera.js';
import { setFalloffAudio } from './audio-falloff.js';
import { PART_DEFAULT, ed, isActiveInHierarchy, isPlayableAudio } from './component-data.js';
import { warnOnceMissing } from './dev-guards.js';
import { RETRY_ATTEMPTS, checkerPixels, withRetry } from './load-retry.js';
import { raycastCandidates } from './raycast-candidates.js';
import { applyComponents, bagsOverriddenBy, nodeOfComponents } from './component-migration.js';
import { NodeShells, Registry } from './component-registry.js';
import { indexByTag, nodesByTag } from './components/component-tag.js';
import { bindSpriteMesh, rebuildMeshSprite, updateImageSprite } from './components/component-sprite.js';
import { resolveCssAssetUrls, uiDocumentsRedraw } from './game-ui.js';
import { reapplyAtlasLightmap } from './lightmap-atlas.js';
import { MODEL_IMPORT_DEFAULT, applyAnimationImport, applyModelGeometry, applyModelHierarchy, bakeScaleModel, fileMaterialFor } from './model-import.js';
import { applyModelOverrides, exposeModelNodes, exposedNodesOf, isLegacySkinnedEntry, modelNodeByKey, wantsAnimator } from './model-nodes.js';
import { compileScript } from './script-scope.js';
import { libraryHostForAssets } from './script-library.js';
import { renderCameraOverlays } from './camera-overlays.js';
import { applyNodeMixin } from './node.js';
import { ensurePostProfileDefaults } from './post-profile.js';
import { blendPostVolumes } from './post-volume-blend.js';
import { buildRigidBody, canHaveRigidBody } from './rigid-body.js';
import { ShadowFit } from './shadow-fit.js';
import { System } from './systems.js';
import { PluginHost } from './plugin-host.js';
import { primitiveGeometry } from './primitive-geometry.js';
import { buildExtraPrimitive } from './primitives-extra.js';
import { makeSynthApi } from './synth.js';
import { makeSteamApi, readSave, removeSave, writeSave } from './steam-bridge.js';
import { combineAxis, syncTouchControls, touchAxis } from './touch-input.js';

// LA CONSOLE DU JEU REMONTE À L'ÉDITEUR. En mode Lecture, ce runtime tourne dans une iframe de
// l'éditeur : ses console.error/warn (erreurs de script comprises) n'apparaissaient que dans les
// outils du navigateur, jamais dans read_console — le copilote et le pont MCP ne voyaient donc
// pas pourquoi un jeu cassait. On les relaie au puits de l'éditeur (js/copilot-inspect.js)
// quand il existe ; dans un build publié il n'y a pas de parent, rien ne change.
(function forwardConsoleToEditor(){
  // LE PUITS EST RELU À CHAQUE MESSAGE, jamais mémorisé. Un onglet ▶ Jouer (window.opener) survit
  // au rechargement de l'éditeur, mais la fonction du puits capturée au chargement appartenait à
  // l'ancienne page : après un rechargement, plus rien ne remontait (BUGS_MOTEUR § 20). Relu ici,
  // le puits de la NOUVELLE page est trouvé dès qu'elle l'a reposé. Iframe (play_and_measure) :
  // window.parent ; onglet d'aperçu : window.opener.
  function currentSink(){
    try{
      if(window.parent !== window && typeof window.parent.__copilotConsoleSink === 'function') return window.parent.__copilotConsoleSink;
    } catch(e){ /* autre origine */ }
    try{
      if(window.opener && !window.opener.closed && typeof window.opener.__copilotConsoleSink === 'function') return window.opener.__copilotConsoleSink;
    } catch(e){ /* autre origine */ }
    return null;
  }
  let hasEditor = false;
  try{ hasEditor = window.parent !== window || !!window.opener; } catch(e){ hasEditor = false; }
  if(!hasEditor) return;   // build publié : rien ne change
  function send(level, msg){
    const sink = currentSink();
    if(sink){ try{ sink(level, msg, 'jeu'); } catch(e){ /* éditeur fermé ou en rechargement */ } }
  }
  // `log` aussi : api.log écrit par console.log, et ne remontait jamais (BUGS_MOTEUR § 16).
  ['log', 'error', 'warn'].forEach(function(level){
    const original = console[level].bind(console);
    console[level] = function(){
      original.apply(null, arguments);
      // Le log ordinaire de la page (three.js, navigateur) reste local : seul le jeu remonte.
      if(level === 'log' && arguments[0] !== '[game]') return;
      try{ send(level, Array.prototype.map.call(arguments, formatConsoleArg).join(' ')); } catch(e){ /* idem */ }
    };
  });
  window.addEventListener('error', function(e){ send('error', (e && e.message) || 'erreur'); });
  window.addEventListener('unhandledrejection', function(e){
    send('error', 'promesse rejetée : ' + formatConsoleArg(e && e.reason));
  });
})();
function formatConsoleArg(a){
  if(a instanceof Error) return a.message + (a.stack /* la pile dit OÙ */ ? '\n' + String(a.stack).split('\n').slice(1, 7).join('\n') : '');
  if(typeof a === 'object' && a !== null){ try{ return JSON.stringify(a); } catch(e){ return String(a); } }
  return String(a);
}
import { XRRuntime } from './xr-runtime.js';
import { additiveHasBase, applyTrackSample, segmentAt } from './track-sampling.js';

(function(){
'use strict';

const D = window.GAME_DATA;
// Les réglages de projet — entrées, calques 2D, nom — ont rejoint `settings` au format v15. Le
// repli sur le premier niveau garde LISIBLE un build publié avant ce palier : le runtime ne
// migre pas (un export est toujours frais), donc c'est la seule façon de ne pas casser un jeu
// déjà en ligne.
const DS = (D && D.settings) || D || {};
if(!D || !Array.isArray(D.scenes)){ showError('data.js manquant ou invalide'); return; }

// LES PLUGINS DU PROJET, avant toute reconstruction : leurs composants doivent être au Registry
// quand `applyComponents` les nommera, leurs types et matériaux connus quand `buildList` et
// `makeMaterialRuntime` les croiseront. Voir js/plugin-host.js.
PluginHost.run(DS.plugins);

// ---------- animations des modèles importés ----------
// Même logique que js/anim-models.js côté éditeur, réécrite ici parce que ce
// fichier ne doit dépendre d'aucun fichier de l'éditeur.
const rtAnims = new Map();

function rtCloneModel(source){
  const copie = source.clone(true);
  // clone() recopie la RÉFÉRENCE du squelette : sans re-liaison, toutes les
  // copies d'un personnage rigué suivraient le squelette de l'original.
  let rigged = false;
  copie.traverse(function(o){ if(o.isSkinnedMesh) rigged = true; });
  if(rigged){
    const byName = {};
    // LA PREMIÈRE occurrence, pas la dernière. Copie conforme de cloneModel
    // (js/anim-models.js), où le raisonnement complet est écrit : un FBX Mixamo contient
    // chaque os en double, et `PropertyBinding.findNode` retient le premier. Garder le
    // dernier lie la peau à un homonyme que rien n'anime — le jeu publié afficherait alors
    // un personnage figé en T-pose pendant que son clip tourne.
    copie.traverse(function(o){ if(o.name && !(o.name in byName)) byName[o.name] = o; });
    copie.traverse(function(o){
      if(!o.isSkinnedMesh || !o.skeleton) return;
      const sq = o.skeleton;
      const os = sq.bones.map(function(b){ return byName[b.name] || b; });
      o.bind(new THREE.Skeleton(os, sq.boneInverses), o.bindMatrix);
      // Miroir de anim-models.js:cloneModel — voir ce fichier pour pourquoi ce composant se
      // reconstruit à chaque clone plutôt que de survivre à Object3D.clone().
      if(typeof applyNodeMixin === 'function'){
        applyNodeMixin(o);
        if(!o.getComponent('SkinnedMeshRenderer')) o.addComponent('SkinnedMeshRenderer');
      }
    });
  }
  if(source.animations && source.animations.length) copie.animations = source.animations;
  return copie;
}

/**
 * Miroir de `skinnedMeshRendererOf` (js/anim-models.js) : ce fichier ne dépend d'AUCUN fichier
 * de l'éditeur (voir l'en-tête), donc pas de celui-là non plus — même règle que `rtCloneModel`
 * juste au-dessus.
 */
function rtSkinnedMeshRendererOf(o){
  let trouve = null;
  if(o && o.traverse) o.traverse(function(x){
    if(!trouve && x.getComponent){
      const c = x.getComponent('SkinnedMeshRenderer');
      if(c) trouve = c;
    }
  });
  return trouve;
}

function rtClips(obj){
  if(!obj) return [];
  if(obj.animations && obj.animations.length) return obj.animations;
  const id = obj.userData && obj.userData.assetId;
  const a = id ? assetsById[id] : null;
  return (a && a.template && a.template.animations) || [];
}

function rtMixerOf(obj){
  let e = rtAnims.get(obj);
  if(!e){
    e = {mixer: new THREE.AnimationMixer(obj), action: null, name: null, layers: [],
         blend: null};
    rtAnims.set(obj, e);
  }
  return e;
}

// Miroir de la résolution des assets d'animation (js/anim-models.js). La DÉCISION — quel
// clip, quelle vitesse, quelles bounds — vient du fichier partagé js/anim-asset.js ; ce qui est
// dupliqué ici, c'est le branchement sur `assetsById`.
const _rtClipsSliced = new WeakMap();

function rtAssetById(id){ return assetsById[id] || null; }

function rtClipSliceFor(obj, base, assetId, bounds, settings){
  const name = nameClipDerived(base.name, assetId);
  let table = _rtClipsSliced.get(obj);
  if(!table){ table = new Map(); _rtClipsSliced.set(obj, table); }
  const signature = bounds.start + '/' + bounds.end + '/' + signatureClipProcessing(settings);
  const deja = table.get(name);
  if(deja && deja.source === base && deja.signature === signature) return deja.clip;
  // Même cuisson que l'éditeur, par le même code (js/anim-blend.js).
  const clip = deriveClip(base, name, bounds, settings || null);
  table.set(name, {clip: clip, source: base, signature: signature});
  return clip;
}

// Miroir de `clipOfKeys` (js/anim-models.js). La compilation vient du fichier partagé
// js/anim-asset.js ; ici, seule la fabrication des KeyframeTrack est répétée. Dans le jeu
// publié, `rev` ne bouge jamais : rien ne modifie un clip après l'export.
const _rtQuatA = new THREE.Quaternion(), _rtQuatB = new THREE.Quaternion();
const _rtClipsCompiled = new Map();

function rtSlerpArray(a, b, k){
  _rtQuatA.fromArray(a); _rtQuatB.fromArray(b);
  return _rtQuatA.slerp(_rtQuatB, k).toArray();
}

function rtClipOfKeys(asset){
  if(typeof dataClipAKeys !== 'function') return null;
  const deja = _rtClipsCompiled.get(asset.id);
  if(deja) return deja;
  const d = dataClipAKeys(asset, rtSlerpArray);
  if(!d.tracks.length) return null;
  const tracks = d.tracks.map(function(p){
    return p.size === 4
      ? new THREE.QuaternionKeyframeTrack(p.name, p.time, p.values)
      : new THREE.VectorKeyframeTrack(p.name, p.time, p.values);
  });
  const clip = new THREE.AnimationClip(nameClipDerived(asset.name || 'anim', asset.id), d.duration, tracks);
  _rtClipsCompiled.set(asset.id, clip);
  return clip;
}

function rtSettingsAnimFor(target, holder){
  if(!holder) return null;
  if(holder.animation && typeof resolveAnimAsset === 'function'){
    const asset = rtAssetById(holder.animation);
    const r = resolveAnimAsset(asset, rtAssetById);
    if(r && r.type === 'keys'){
      const clip = rtClipOfKeys(asset);
      if(clip){
        let table = _rtClipsSliced.get(target);
        if(!table){ table = new Map(); _rtClipsSliced.set(target, table); }
        table.set(clip.name, {clip: clip, source: asset, signature: 'keys'});
        return {name: clip.name, speed: r.speed, loop: r.loop};
      }
    }
    if(r && r.type !== 'keys'){
      const base = rtClipByName(target, r.clip);
      if(base){
        const bounds = boundsAnimAsset(r, base.duration);
        const derive = sliceUseful(bounds, base.duration) || clipNeedsProcessing(r);
        const clip = derive ? rtClipSliceFor(target, base, asset.id, bounds, r) : base;
        return {name: clip.name, speed: r.speed, loop: r.loop, cycleOffset: r.cycleOffset || 0};
      }
    }
  }
  if(holder.clip && rtClipByName(target, holder.clip)){
    return {name: holder.clip, speed: 1, loop: true};
  }
  return null;
}

function rtBlendResolved(target, state){
  const pts = (state.blend.points || []).map(function(pt){
    const r = rtSettingsAnimFor(target, pt);
    return r ? Object.assign({}, pt, {clip: r.name}) : pt;
  });
  return Object.assign({}, state, {blend: Object.assign({}, state.blend, {points: pts})});
}

// Miroir de `clipByName` (js/anim-models.js), guichet unique compris : c'est ici que le mode
// « sur place » retire le déplacement des clés (`clipInPlace`, js/anim-blend.js, partagé).
function rtClipByName(obj, name){
  const table = _rtClipsSliced.get(obj);
  const clips = rtClips(obj);
  const found = (name && table && table.has(name))
    ? table.get(name).clip
    : (name ? (clips.find(function(c){ return c.name === name; }) || null) : (clips[0] || null));
  const holder = rtHolderAnimator(obj);
  const mode = holder && holder.userData.animator ? holder.userData.animator.rootMotion : null;
  // Miroir de `clipByName` : un déplacement non cuit sort du clip, et sans root motion appliqué
  // le personnage reste sur place.
  const inPlace = mode === 'inPlace'
    || (!mode && !!(found && found.rootMotionInfo && found.rootMotionInfo.xz));
  return (found && inPlace && typeof clipInPlace === 'function') ? clipInPlace(found) : found;
}

// Miroir de `rebuildActions` (js/anim-models.js). Le partage des os et la restriction des
// clips viennent du fichier PARTAGÉ js/anim-blend.js ; ce qui reste dupliqué ici, c'est le
// branchement sur le mixeur, parce que l'éditeur et le jeu n'ont pas les mêmes tables d'objets.
// C'est le minimum de copie possible — et c'est déjà le maximum de risque, la divergence
// éditeur/runtime étant la famille de défaut la plus coûteuse de ce dépôt.
function rtRebuildActions(obj, fondu){
  const e = rtMixerOf(obj);
  const base = e.name ? rtClipByName(obj, e.name) : null;
  if(!base) return false;
  const part = splitBone(obj, e.layers);
  const taken = part.layers.reduce(function(acc, l){ return acc.concat(l); }, []);

  const ancienne = e.action;
  const clipBase = clipExcept(base, taken, 'base');
  e.action = clipBase ? e.mixer.clipAction(clipBase) : null;
  if(e.action){
    e.action.setLoop(e.loop === false ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    e.action.clampWhenFinished = (e.loop === false);
    e.action.timeScale = e.speed || 1;
    e.action.setEffectiveWeight(1);
    if(ancienne && ancienne !== e.action && fondu > 0){
      e.action.reset().play();
      ancienne.crossFadeTo(e.action, fondu, false);
    } else {
      if(ancienne && ancienne !== e.action) ancienne.stop();
      if(!e.action.isRunning()) e.action.reset().play();
    }
  } else if(ancienne){
    ancienne.stop();
  }

  e.layers.forEach(function(c, i){
    const clipC = rtClipByName(obj, c.name);
    const restricted = clipC ? clipRestricted(clipC, part.layers[i], 'c' + i) : null;
    if(!restricted){ if(c.action){ c.action.stop(); c.action = null; } return; }
    const a = e.mixer.clipAction(restricted);
    a.setLoop(THREE.LoopRepeat, Infinity);
    a.timeScale = c.speed || 1;
    a.setEffectiveWeight(c.weight === undefined ? 1 : c.weight);
    if(!a.isRunning()) a.reset().play();
    c.action = a;
  });
  return true;
}

function rtPlayAnimation(obj, name, opts){
  const clip = rtClipByName(obj, name);
  if(!clip) return false;
  const o = opts || {};
  const e = rtMixerOf(obj);
  e.name = clip.name;
  e.loop = o.loop;
  e.speed = (o.speed === undefined ? 1 : Number(o.speed)) || 1;
  return rtRebuildActions(obj, o.fondu === undefined ? 0.2 : Number(o.fondu));
}

function rtLayerAnimation(obj, nameClip, opts){
  const o = opts || {};
  if(!o.depuis || !rtClipByName(obj, nameClip)) return false;
  const e = rtMixerOf(obj);
  if(!e.name) return false;                       // une couche se pose SUR quelque chose
  const existante = e.layers.find(function(c){ return c.depuis === o.depuis; });
  const c = existante || {};
  c.name = nameClip; c.depuis = o.depuis;
  c.weight = (o.weight === undefined ? 1 : Number(o.weight));
  c.speed = (o.speed === undefined ? 1 : Number(o.speed)) || 1;
  if(!existante) e.layers.push(c);
  return rtRebuildActions(obj, o.fondu === undefined ? 0 : Number(o.fondu));
}

function rtRemoveLayer(obj, depuis){
  const e = rtAnims.get(obj);
  if(!e || !e.layers.length) return false;
  e.layers = e.layers.filter(function(c){
    if(depuis && c.depuis !== depuis) return true;
    if(c.action) c.action.stop();
    return false;
  });
  return rtRebuildActions(obj, 0);
}

function rtStopAnimation(obj){
  const e = rtAnims.get(obj);
  // `blend` remis à null comme dans l'éditeur : `stopAllAction` arrête bien les actions, mais
  // la trace resterait et le prochain état de mélange, de signature inchangée, ne rejouerait rien.
  if(e){ e.mixer.stopAllAction(); e.action = null; e.name = null; e.layers = []; e.blend = null; }
}

// ---------- Machines à états, côté game publié ----------
// Miroir de `updateAnimators` (js/anim-models.js). La DÉCISION vient du fichier partagé
// js/animator.js ; ce qui est dupliqué ici, c'est seulement le branchement sur les tables du
// runtime. Une machine qui ne tournerait que dans l'éditeur serait pire qu'aucune machine :
// on la câblerait en la voyant marcher, et elle ne marcherait pas dans le jeu.
const rtPlayersAnimator = new Map();

function rtMachineOf(obj){
  const ref = obj && obj.userData && obj.userData.animator;
  if(!ref || !ref.assetId) return null;
  const a = assetsById[ref.assetId];
  return (a && a.kind === 'animator' && a.machine) || null;
}

function rtTargetAnimator(obj){
  const nameVoulu = ((obj.userData.animator || {}).target || '').trim();
  let trouve = null;
  if(nameVoulu){
    obj.traverse(function(o){ if(!trouve && o.name === nameVoulu) trouve = o; });
    return trouve;
  }
  if(rtClips(obj).length) return obj;
  obj.traverse(function(o){ if(!trouve && o !== obj && rtClips(o).length) trouve = o; });
  return trouve || obj;
}

function rtPlayerAnimatorOf(obj){
  const machine = rtMachineOf(obj);
  if(!machine) return null;
  let l = rtPlayersAnimator.get(obj);
  if(!l || l.machine !== machine){
    l = createPlayerAnimator(machine);
    l.machine = machine;
    rtPlayersAnimator.set(obj, l);
    // ASYMÉTRIE DÉLIBÉRÉE avec l'éditeur, où la même fonction ne joue RIEN. Là-bottom elle est
    // appelée par l'inspecteur pour AFFICHER l'état current, et y démarrer le clip lançait
    // l'animation dès qu'on sélectionnait l'objet — le personnage devenait impossible à animer
    // à la main. Ici rien ne l'appelle pour regarder : le jeu n'a pas d'aperçu à éteindre, la
    // machine tourne toujours, et démarrer à la création est exactement ce qu'on veut.
    const target = rtTargetAnimator(obj);
    const start = target ? rtSettingsAnimFor(target, stateOfMachine(machine, l.state)) : null;
    if(start) rtPlayAnimation(target, start.name,
      {loop:start.loop, speed:start.speed, fondu:0});
  }
  return l;
}

function rtProgressClip(obj){
  const e = rtAnims.get(obj);
  if(!e || !e.action) return 0;
  const d = e.action.getClip().duration;
  return d > 0 ? Math.min(1, e.action.time / d) : 1;
}

// Miroir de `applyBlendModel` (js/anim-models.js). Les poids, le cycle commun et les
// vitesses de lecture viennent du fichier PARTAGÉ js/animator.js ; seul le branchement sur le
// mixeur est dupliqué. Tous les clips tournent en permanence, même à poids nul : three saute
// l'interpolation d'une action sans poids mais continue à en advance le temps, si bien qu'un
// clip qui reprend du poids est DÉJÀ en phase avec les autres.
function rtApplyBlend(obj, state, value){
  const e = rtMixerOf(obj);
  const pts = state.blend.points || [];
  const signature = state.name + '|' + e.layers.map(function(c){
    return c.name + '@' + c.depuis;
  }).join(',') + '|' + pts.map(function(p){ return p && p.clip; }).join(',');

  if(!e.blend || e.blend.signature !== signature){
    rtStopBlend(obj);
    if(e.action){ e.action.stop(); e.action = null; e.name = null; }
    const part = splitBone(obj, e.layers);
    const taken = part.layers.reduce(function(acc, l){ return acc.concat(l); }, []);
    const actions = pts.map(function(pt){
      const c = (pt && pt.clip) ? rtClipByName(obj, pt.clip) : null;
      const restricted = c ? clipExcept(c, taken, 'blend') : null;
      if(!restricted) return null;
      const a = e.mixer.clipAction(restricted);
      a.setLoop(THREE.LoopRepeat, Infinity);
      a.setEffectiveWeight(0);
      a.reset().play();
      return a;
    });
    e.blend = {signature:signature, state:state.name, actions:actions,
                 weight:actions.map(function(){ return 0; }),
                 avant:actions.map(function(){ return 0; })};
  }

  const durationOf = function(name){
    const c = rtClipByName(obj, name);
    return c ? c.duration : 0;
  };
  const weight = weightBlend(pts, value);
  const speeds = speedsBlend(pts, weight, durationOf);
  let dominant = -1;
  e.blend.actions.forEach(function(a, i){
    if(!a) return;
    a.setEffectiveWeight(weight[i]);
    a.timeScale = speeds[i] * (e.speed || 1);
    if(dominant < 0 || weight[i] > weight[dominant]) dominant = i;
  });
  e.blend.weight = weight;
  e.action = dominant >= 0 ? e.blend.actions[dominant] : null;
  e.name = dominant >= 0 ? (pts[dominant] || {}).clip || null : null;
}

function rtStopBlend(obj){
  const e = rtAnims.get(obj);
  if(!e || !e.blend) return;
  e.blend.actions.forEach(function(a){ if(a) a.stop(); });
  e.blend = null;
}

function rtUpdateAnimators(dt){
  if(typeof updatePlayerAnimator !== 'function'){ warnOnceMissing('updatePlayerAnimator', 'animator.js'); return; }
  // Porteurs d'un composant AnimatorController — même chemin que updateAnimators côté éditeur.
  Registry.activeNodes('AnimatorController').forEach(function(o){
    if(!o.userData.animator || !o.userData.animator.assetId) return;
    const l = rtPlayerAnimatorOf(o);
    if(!l) return;
    const target = rtTargetAnimator(o);
    if(!target) return;
    // Un mélange est réévalué à CHAQUE image : son paramètre bouge en continu, ce n'est pas un
    // clip qu'on lance une fois. Les vitesses de lecture en dépendent, donc la phase aussi.
    const current = stateOfMachine(l.machine, l.state);
    if(isStateBlend(current)){
      rtApplyBlend(target, rtBlendResolved(target, current), l.params[current.blend.param]);
    }
    const t = updatePlayerAnimator(l.machine, l, dt, rtProgressClip(target));
    if(!t) return;
    const arrivee = stateOfMachine(l.machine, l.state);
    // Inertialisation : fondu nul, le nouveau clip joue seul, et c'est l'écart avec la pose
    // affichée qui est résorbé après le pas du mixeur — pas ici, la pose d'arrivée n'existe
    // pas encore.
    const eMix = rtMixerOf(target);
    // Miroir de js/anim-models.js : la durée du fondu se calcule sur le clip de DÉPART quand
    // `dureeFixe` est faux, donc avant de lancer celui d'arrivée.
    const durationStart = eMix.action ? eMix.action.getClip().duration : 0;
    const fonduSec = durationTransition(t, durationStart);
    eMix.inertiaArm = t.inertia ? fonduSec : 0;
    const fondu = t.inertia ? 0 : fonduSec;
    if(isStateBlend(arrivee)){
      rtApplyBlend(target, rtBlendResolved(target, arrivee), l.params[arrivee.blend.param]);
      return;
    }
    rtStopBlend(target);
    const voulu = rtSettingsAnimFor(target, arrivee);
    if(voulu){
      rtPlayAnimation(target, voulu.name,
        {loop:voulu.loop, speed:voulu.speed, fondu:fondu});
      // Transition Offset, plus le Cycle Offset du clip (onglet Animation) — miroir de
      // `applyCycleOffset` (js/anim-models.js).
      const dec = offsetTransition(t) + (voulu.cycleOffset || 0);
      const e2 = rtAnims.get(target);
      if(dec && e2 && e2.action) e2.action.time = (dec % 1) * e2.action.getClip().duration;
    }
  });
}

// Miroir de applyRootMotion (js/anim-models.js). Le CALCUL vient du fichier partage
// js/animator.js ; seul le branchement diffère.
const _rtInterpRoot = new WeakMap();

// L'objet de scène à qui revient un impact de rayon : le plus proche ancêtre qui en est un.
function rtOwnerOfHit(x){
  while(x && !isSceneObject(x)) x = x.parent;
  return x;
}

function rtHolderAnimator(target){
  let n = target;
  while(n){
    if(n.userData && n.userData.animator && n.userData.animator.assetId) return n;
    n = n.parent;
  }
  return null;
}

// `parts` : [{action, tAvant, poids}]. Une seule part hors mélange ; le déplacement d'un
// mélange est la somme PONDÉRÉE de celui de chaque clip — suivre le seul clip dominant ferait
// sauter la vitesse du personnage au croisement des poids.
// N'agit QUE pour `rootMotion === true` (« Déplace l'objet »). Le mode 'inPlace' ne passe pas
// par ici : son déplacement est retiré des clés du clip dans `rtClipByName`.
function rtApplyRootMotion(target, parts){
  const holder = rtHolderAnimator(target);
  if(!holder || holder.userData.animator.rootMotion !== true) return;
  // Le calcul est partagé avec l'éditeur (js/anim-blend.js) : un seul endroit décide de ce qui
  // sort du clip, selon ses réglages « Bake Into Pose ».
  applyRootStep(holder, stepRootMotion(target, parts));
}

// Les calques de tri, lus sur les DONNÉES du projet. `layers2dOfProject` (component-sprite.js)
// l'appelle en globale : c'est le seul morceau du rendu de sprite qui reste propre au runtime.
function rtLayers2d(){
  // Lu sur les DONNÉES du projet, comme les entrées : c'est ce que l'éditeur a écrit. Le repli
  // n'est là que pour un export antérieur à la fondation 2D, qui n'a aucun sprite de toute façon.
  const l = (typeof DS !== 'undefined' && DS && DS.layers2d) || null;
  return (Array.isArray(l) && l.length) ? l : ['Fond', 'Décor', 'Jeu', 'Premier plan', 'Interface'];
}

/**
 * Le bus des événements d'animation : un événement de sprite et un marqueur de clip 3D s'écoutent
 * du même côté, sans quoi un script devrait savoir de quelle sorte d'animation il vient. Passé
 * aux Systèmes par le contexte d'image (`ctx.emit`).
 */
function rtEmitAnimEvent(name){
  (game.ecouteurs[name] || []).forEach(function(fn){
    try{ fn(); } catch(err){ console.error('événement d animation « ' + name + ' » :', err); }
  });
}

// `rtBuildMeshSprite`, `rtUpdateImageSprite` et `rtUpdateAnimatorsSprite` ont disparu (v0.159.2) :
// le jeu exécute js/components/component-sprite.js et le SpriteAnimatorSystem, comme l'éditeur.
// Les miroirs avaient divergé DEUX fois — maille précédente jamais retirée, `_region`/`_texSize`
// oubliés — et chaque divergence ne se voyait qu'après export.

// `rtBuildTilemap` a disparu : c'est le TilemapSystem (js/systems/tilemap-system.js) qui
// reconstruit les mailles, ici comme dans l'éditeur. Le miroir avait déjà divergé — le compteur
// de version y manquait, et une porte ouverte par un script continuait de bloquer.
function rtPartsRootMotion(e, avant){
  if(e.blend){
    return e.blend.actions.map(function(a, i){
      return {action:a, tBefore:e.blend.avant[i], weight:e.blend.weight[i]};
    });
  }
  return [{action:e.action, tBefore:avant, weight:1}];
}

// Miroir de l'inertialisation (js/anim-models.js). La COURBE et l'echantillonnage des clips
// viennent du fichier partage js/animator.js ; ce qui est duplique ici, c'est le releve de pose
// et son application au squelette, parce que l'editeur et le jeu n'ont pas les memes tables.
const _rtBoneAnimated = new WeakMap();
const _rtqA = new THREE.Quaternion(), _rtqB = new THREE.Quaternion(), _rtqC = new THREE.Quaternion();
const _rtvA = new THREE.Vector3(), _rtvB = new THREE.Vector3();

function rtBoneAddressesBy(target, clip){
  let byClip = _rtBoneAnimated.get(target);
  if(!byClip){ byClip = new Map(); _rtBoneAnimated.set(target, byClip); }
  let list = byClip.get(clip);
  if(!list){
    const names = new Set();
    (clip.tracks || []).forEach(function(t){
      const i = t.name.indexOf('.');
      names.add(i === -1 ? t.name : t.name.slice(0, i));
    });
    list = [];
    names.forEach(function(n){
      const o = target.getObjectByName ? target.getObjectByName(n) : null;
      if(o) list.push(o);
    });
    byClip.set(clip, list);
  }
  return list;
}

function rtSurveyPoseShown(e, target, dt){
  const os = e.action ? rtBoneAddressesBy(target, e.action.getClip()) : [];
  if(e.boneReleves !== os){
    e.boneReleves = os;
    e.poseBefore = new Float64Array(os.length * 7);
    e.poseCurrent = new Float64Array(os.length * 7);
    e.imagesRelevees = 0;
  }
  const tmp = e.poseBefore; e.poseBefore = e.poseCurrent; e.poseCurrent = tmp;
  os.forEach(function(o, i){
    const k = i * 7, p = o.position, q = o.quaternion;
    e.poseCurrent[k] = p.x; e.poseCurrent[k + 1] = p.y; e.poseCurrent[k + 2] = p.z;
    e.poseCurrent[k + 3] = q.x; e.poseCurrent[k + 4] = q.y;
    e.poseCurrent[k + 5] = q.z; e.poseCurrent[k + 6] = q.w;
  });
  e.dtReleve = dt;
  e.imagesRelevees = Math.min(2, (e.imagesRelevees || 0) + 1);
}

function rtArmInertia(e, target, duration){
  const os = e.boneReleves || [];
  if(!(duration > 0) || !os.length || e.imagesRelevees < 2 || !e.action) return;
  const clip = e.action.getClip();
  const dt = e.dtReleve > 0 ? e.dtReleve : 1 / 60;
  const tTarget = e.action.time;
  const parts = [];
  os.forEach(function(o, i){
    const k = i * 7;
    const cA = poseOfClipFor(clip, o.name, tTarget);
    const cB = poseOfClipFor(clip, o.name, tTarget + dt * (e.action.timeScale || 1));

    _rtqA.set(e.poseCurrent[k + 3], e.poseCurrent[k + 4], e.poseCurrent[k + 5], e.poseCurrent[k + 6]);
    _rtqB.copy(o.quaternion);
    _rtqC.copy(_rtqB).invert().premultiply(_rtqA);
    if(_rtqC.w < 0) _rtqC.set(-_rtqC.x, -_rtqC.y, -_rtqC.z, -_rtqC.w);
    const sin = Math.hypot(_rtqC.x, _rtqC.y, _rtqC.z);
    if(sin > 1e-9){
      const angle = 2 * Math.atan2(sin, _rtqC.w);
      const axe = new THREE.Vector3(_rtqC.x / sin, _rtqC.y / sin, _rtqC.z / sin);
      _rtqA.set(e.poseBefore[k + 3], e.poseBefore[k + 4], e.poseBefore[k + 5], e.poseBefore[k + 6]);
      _rtqC.copy(_rtqB).invert().premultiply(_rtqA);
      if(_rtqC.w < 0) _rtqC.set(-_rtqC.x, -_rtqC.y, -_rtqC.z, -_rtqC.w);
      const angleBefore = 2 * Math.atan2(_rtqC.x * axe.x + _rtqC.y * axe.y + _rtqC.z * axe.z, _rtqC.w);
      let v0 = (angle - angleBefore) / dt;
      if(cA.quat && cB.quat){
        _rtqA.fromArray(cA.quat); _rtqB.fromArray(cB.quat);
        _rtqC.copy(_rtqA).invert().premultiply(_rtqB);
        if(_rtqC.w < 0) _rtqC.set(-_rtqC.x, -_rtqC.y, -_rtqC.z, -_rtqC.w);
        v0 -= 2 * Math.atan2(_rtqC.x * axe.x + _rtqC.y * axe.y + _rtqC.z * axe.z, _rtqC.w) / dt;
      }
      const coef = coefficientsInertia(angle, v0, duration);
      if(coef) parts.push({os:o, axe:axe, coef:coef, rot:true});
    }

    _rtvA.set(e.poseCurrent[k], e.poseCurrent[k + 1], e.poseCurrent[k + 2]);
    _rtvB.copy(o.position);
    const d = _rtvA.clone().sub(_rtvB);
    const dist = d.length();
    if(dist > 1e-9){
      const dir = d.clone().divideScalar(dist);
      _rtvA.set(e.poseBefore[k], e.poseBefore[k + 1], e.poseBefore[k + 2]);
      const distBefore = _rtvA.sub(_rtvB).dot(dir);
      let v0 = (dist - distBefore) / dt;
      if(cA.pos && cB.pos){
        v0 -= ((cB.pos[0] - cA.pos[0]) * dir.x + (cB.pos[1] - cA.pos[1]) * dir.y
             + (cB.pos[2] - cA.pos[2]) * dir.z) / dt;
      }
      const coef = coefficientsInertia(dist, v0, duration);
      if(coef) parts.push({os:o, dir:dir, coef:coef, rot:false});
    }
  });
  e.inertia = parts.length ? {t:0, parts:parts} : null;
}

function rtApplyInertia(e, dt){
  if(!e.inertia) return;
  e.inertia.t += dt;
  let live = 0;
  e.inertia.parts.forEach(function(p){
    const x = evaluateInertia(p.coef, e.inertia.t);
    if(x === 0) return;
    live++;
    if(p.rot) p.os.quaternion.premultiply(_rtqA.setFromAxisAngle(p.axe, x));
    else p.os.position.addScaledVector(p.dir, x);
  });
  if(!live) e.inertia = null;
}

function rtUpdateAnimations(dt){
  if(!rtAnims.size) return;
  rtAnims.forEach(function(e, obj){
    if(!obj.parent){ e.mixer.stopAllAction(); rtAnims.delete(obj); return; }
    // Miroir de updateAnimationsModels (js/anim-models.js). Un marker qui ne se déclenche que
    // dans l'éditeur est pire qu'un marker absent : on l'entend en travaillant, pas en jouant.
    const avant = e.action ? e.action.time : 0;
    if(e.blend) e.blend.actions.forEach(function(a, i){ e.blend.avant[i] = a ? a.time : 0; });
    e.mixer.update(dt);
    if(e.action) rtMarkersDuringPlayback(obj, e.action, avant);
    if(e.action) rtApplyRootMotion(obj, rtPartsRootMotion(e, avant));
    // Même ordre que dans l'éditeur, et il compte : l'inertialisation APRÈS la racine motion, qui
    // réécrit la racine à sa pose de repos et effacerait sinon l'écart sur l'os du déplacement ;
    // le relevé EN DERNIER, parce que c'est la pose affichée qu'il faut mémoriser.
    if(e.inertiaArm){ rtArmInertia(e, obj, e.inertiaArm); e.inertiaArm = 0; }
    rtApplyInertia(e, dt);
    if(rtHolderAnimator(obj)) rtSurveyPoseShown(e, obj, dt);
  });
}

function rtMarkersDuringPlayback(obj, action, tBefore){
  if(typeof triggerMarkers !== 'function' || action.paused) return;
  const clip = action.getClip();
  // Miroir du traitement des clips DÉCOUPÉS de js/anim-models.js : un nom dérivé remonte à son
  // clip source, et les marqueurs sont remis dans le temps de la découpe. Sans ça, une découpe
  // ferait taire tous les sons de pas dans le jeu publié, et seulement là.
  const derive = (typeof readNameClipDerived === 'function') ? readNameClipDerived(clip.name) : null;
  const src = sourceOfClipPlays(obj, derive ? derive.clip : clip.name);
  if(!src) return;
  const asset = assetsById[src.asset] || null;
  let list = markersOfClip(asset, src.clip);
  if(derive){
    const r = resolveAnimAsset(rtAssetById(derive.asset), rtAssetById);
    const base = r ? rtClipByName(obj, r.clip) : null;
    if(r && base){
      const b = boundsAnimAsset(r, base.duration);
      list = markersAdjusted(list, b.start, b.end);
    }
  }
  if(!list.length) return;
  triggerMarkers(list, tBefore, action.time, clip.duration,
    action.loop !== THREE.LoopOnce, true, function(name){
      (game.ecouteurs[name] || []).forEach(function(fn){
        try{ fn(); } catch(err){ console.error('marker « ' + name + ' » :', err); }
      });
    });
}

// ---------- petites aides DOM ----------
// Copie locale de projet.js:LAYERS_DEFAULT — ce fichier ne dépend d'aucun autre fichier
// éditeur (voir en-tête). build.js n'exporte pas encore project.layers ; en attendant que
// le Lot 4 (Vue Game) ait besoin de ce pont, la résolution runtime reste volontairement
// simple et se limite aux 4 calques par défaut.
const LAYERS_DEFAULT = [
  {id:0, name:'Défaut', visible:true, verrouille:false},
  {id:1, name:'Joueur', visible:true, verrouille:false},
  {id:2, name:'Ennemis', visible:true, verrouille:false},
  {id:3, name:'Décor', visible:true, verrouille:false}
];
// Version runtime simplifiée de resolveLayer/sameLayer (scripts.js) : le build exporté
// n'a pas de projet.layers (voir build.js), donc on ne résout que contre LAYERS_DEFAULT.
function resolveLayerRt(cOrName){
  if(cOrName === undefined || cOrName === null) return cOrName;
  const byName = LAYERS_DEFAULT.find(function(l){ return l.name === cOrName; });
  return byName ? byName.id : cOrName;
}
function sameLayer(objectLayer, request){
  const resolvedRequest = resolveLayerRt(request);
  const resolvedObject = resolveLayerRt(objectLayer);
  return resolvedObject === resolvedRequest || objectLayer === request;
}

// Reprend la logique de camPrincipale() (moteur/js/play-mode.js, éditeur) : caméra marquée
// userData.game.principale, sinon la première caméra, sinon (build sans caméra) une erreur
// explicite plutôt qu'un plantage silencieux.
function rtCameraMain(listObjects){
  // Porteurs d'un composant Camera active. `listeObjets` n'est plus lu : le Registry est la
  // source, comme partout ailleurs. Le paramètre reste dans la signature parce que l'appelant
  // (loadSceneGame) le passe encore et qu'un jour il pourra restreindre la recherche à une
  // sous-scène — le supprimer maintenant serait un changement sans bénéfice.
  void listObjects;
  const cams = Registry.activeNodes('Camera');
  // `isCameraMain` (camera-framing.js) et RIEN D'AUTRE : ce test lisait `userData.game.main`,
  // que l'inspecteur écrit — mais le composant `Camera` porte SON PROPRE `main`, sérialisé
  // dans `components[]`, et c'était lui que le fichier de scène transportait. Les deux ne se
  // parlaient pas : une caméra cochée « principale » repartait non principale dans le jeu, et
  // seule la présence d'une unique caméra (repli `cams[0]`) masquait le défaut.
  const marquee = typeof isCameraMain === 'function'
    ? cams.find(isCameraMain)
    : cams.find(function(o){ return o.userData.game && o.userData.game.main; });
  const choisie = marquee || cams[0] || null;
  if(!choisie) console.error('Aucune camera dans la scene exportee : rien ne sera rendu.');
  return choisie;
}

function $(id){ return document.getElementById(id); }
function showError(msg){
  const e = $('rj-error');
  if(e){ e.style.display = 'block'; e.textContent = '⛔ ' + msg; }
  console.error('[runtime]', msg);
}
function hud(msg, duration){
  const h = $('rj-hud');
  if(!h) return;
  h.textContent = msg;
  h.style.display = 'block';
  clearTimeout(hud._t);
  hud._t = setTimeout(function(){ h.style.display = 'none'; }, duration || 2500);
}
// Le numéro de version, en bas à droite. `visible` est un réglage du PROJET, figé à la
// publication (js/build.js) : un build publié sans numéro n'en porte aucune trace non plus.
function showVersionBuild(){
  const el = $('rj-version');
  const b = D && D.build;
  if(!el || !b || b.visible === false) return;
  el.textContent = 'v' + b.engine + (b.date ? ' — ' + b.date : '');
}
function progress(txt){
  const p = $('rj-loading-txt');
  if(p) p.textContent = txt;
}

// ---------- rendu ----------
// WebGPURenderer (repli WebGL2 automatique) — voir js/render-webgpu-bridge.mjs, embarqué
// par js/build.js (pageIndexBuild) au même titre que ce fichier. render() n'attend PAS en
// interne la fin de init() : loop() vérifie renderer.__pret avant de rendre.
// UN PROJET XR PASSE PAR LE BACKEND WebGL2 du même WebGPURenderer : une session WebXR sur le
// backend WebGPU exige la fonctionnalité "webgpu", encore expérimentale — voir l'en-tête de
// js/xr-runtime.js. Décidé UNE fois au démarrage, depuis les données : le backend ne se change
// pas sur un renderer vivant.
const XR_WANTED = XRRuntime.projectUsesXr(D);
const renderer = new THREE.WebGPURenderer({antialias:true, forceWebGL: XR_WANTED});
renderer.__ready = (typeof renderer.init !== 'function');
// La promesse est CONSERVÉE, pas seulement lancée : le démarrage l'attend avant de charger
// les assets, parce que KTX2Loader interroge le GPU pour choisir sa cible de transcodage.
// Rappeler init() marcherait (three met sa promesse en hidden) mais reposerait sur un
// détail d'implémentation ; garder la référence ne repose sur rien.
renderer.__init = (typeof renderer.init === 'function')
  ? renderer.init().then(function(){ renderer.__ready = true; })
  : Promise.resolve();
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
// PCFSoftShadowMap est deprecie en r185 et three retombe de toute facon sur PCFShadowMap :
// on l ecrit explicitement plutot que de laisser un repli silencieux. Les ombres sont donc
// un cran plus dures qu en r128. VSMShadowMap redonnerait du flou mais apporte ses propres
// artefacts (fuite de lumiere) et demande un reglage de flou : a evaluer, pas a subir.
renderer.shadowMap.type = THREE.PCFShadowMap;
$('rj-view').appendChild(renderer.domElement);

if(XR_WANTED){
  XRRuntime.install(renderer, {
    scene: function(){ return game.scene; },
    camera: function(){ return game.cam; },
    setCamera: function(c){
      game.cam = c;
      if(listenerAudio.parent) listenerAudio.parent.remove(listenerAudio);
      c.add(listenerAudio);
    },
    uiRoot: function(){ return $('rj-ui'); },
    grabBody: rtXrGrabBody,
    syncBody: rtXrSyncBody,
    message: function(txt){ hud(txt, 4000); }
  });
}

const camDefault = new THREE.PerspectiveCamera(55, 1, 0.1, 500);
camDefault.position.set(9, 8, 9);
camDefault.lookAt(0, 1, 0);

// ---------- état global du jeu ----------
const game = {
  scene: null, cam: null, hemi: null, sun: null, skyTexture: null, skyBackground: null,
  objects: [],                       // racines + descendants gérés
  tracks: [], duration: 5, loop: true, t: 0,
  world: null, links: [], kinematic: [],
  minuteries: [], ecouteurs: {}, aDestroy: [], sceneDemandee: null,
  contacts: [],                     // api.onContact() — miroir de engineScripts.contacts
  // État de jeu global (api.state). Volontairement ABSENT de la remise à zéro de
  // loadSceneGame() : c'est tout l'intérêt, il traverse les changements de
  // scène. Score, inventaire et progress y survivent.
  state: {},
  persos: new WeakMap(),            // état du contrôleur de personnage, hors props sérialisées
  // LA PAUSE. Le monde s arrete, les scripts CONTINUENT — sinon rien ne pourrait la lever,
  // et un menu de pause serait impossible a ecrire. C est la seule forme qui marche.
  pause: false,
  time: 0, compiled: new Map(), demarres: new Map(),   // obj -> Map(i->{...}) / obj -> Set(i démarrés)
  sounds: [], ponctuels: [],          // sources audio des objets + one-shots
  particles: [],                   // systèmes de particules actifs
  post: null                        // réglages de post-traitement de la scène courante
};

// ---------- appartenance à la scène : l'index que le Registry de composants interroge ----------
//
// `isSceneObject` porte le même nom et le même sens que dans js/objects.js (côté éditeur) —
// c'est le contrat que Registry.activeNodes/liveNodes (js/component.js, PARTAGÉ) attend
// pour ne pas livrer aux Systèmes un composant porté par un Noeud détruit. Ici l'ensemble de
// référence est `game.objets` plutôt que `objects`, et rien d'autre ne change.
//
// Un `Set` et non `game.objets.indexOf(o)` : la question est posée une fois par composant et par
// interrogation du Registry, donc dans la boucle d'image.
const _indexObjectsGame = new Set();

function isSceneObject(o){
  return !!o && _indexObjectsGame.has(o);
}

function addSceneObject(o){
  if(!o || _indexObjectsGame.has(o)) return o;
  _indexObjectsGame.add(o);
  game.objects.push(o);
  return o;
}

function removeSceneObject(o){
  if(!_indexObjectsGame.delete(o)) return false;
  const i = game.objects.indexOf(o);
  if(i !== -1) game.objects.splice(i, 1);
  Registry.unindexNode(o);
  return true;
}

// Changement de scène : `game.objets` était remis à [] directement, ce qui laissait au Registry
// les composants de la scène précédente — que les Systèmes auraient ensuite itérés sur des
// objets détruits (voir Registry.clear, js/component.js).
function clearSceneObjects(){
  game.objects = [];
  _indexObjectsGame.clear();
  Registry.clear();
}

// ---------- sondes de réflexion (miroir de js/probes.js, sans édition) ----------
const rtProbes = new Map();          // objet sonde → {rt, cam, uni, noeudBoite}
let rtSkyProbe = null;              // cubemap du ciel : sonde par défaut de la scène
let rtEnvCurrent = null;             // env de la scène chargée, relu à la cuisson du ciel
let rtDomeBake = null;            // texture de fond jetable, libérée à la cuisson suivante
const RT_SKY_RESOLUTION = 64;       // identique à SKY_RESOLUTION (js/probes.js)

function rtTargetCube(res){
  // three/webgpu ne définit PAS WebGLCubeRenderTarget (classe propre au backend WebGL) :
  // il fournit CubeRenderTarget. Passer au WebGPURenderer une cible venue de l'autre
  // bundle revient à mélanger les classes, ce qu'il ne reconnaît pas.
  const optCube = {
    format: THREE.RGBAFormat, generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter};
  // LE RENDERER DÉCIDE, pas la présence de la classe. Quand les deux three sont chargés (pont
  // ESM + three.min.js, « Multiple instances of Three.js »), THREE.CubeRenderTarget existe AUSSI
  // sous le renderer WebGL : sa texture n'est alors pas reconnue comme cible de rendu, le
  // WebGLRenderer tente de TÉLÉVERSER six images absentes et lève « texSubImage2D : Overload
  // resolution failed » dans setTextureCube, à chaque image qui lit le reflet.
  const webgl = typeof renderer !== 'undefined' && renderer && !renderer.isWebGPURenderer;
  if(webgl && THREE.WebGLCubeRenderTarget) return new THREE.WebGLCubeRenderTarget(res, optCube);
  return THREE.CubeRenderTarget ? new THREE.CubeRenderTarget(res, optCube)
                                : new THREE.WebGLCubeRenderTarget(res, optCube);
}

// Correction de projection boîte — MÊME formule que nodeDirectionBox (js/probes.js),
// mêmes termes dans le même ordre. Un build doit rendre comme la vue de lecture, et deux
// écritures de la même correction auraient fini par diverger sans que ça se voie.
function rtNodeDirectionBox(uCenter, uHalf, uProbe){
  const {positionWorld, cameraPosition, transformedNormalWorld} = TSL;
  const pos = positionWorld;
  const dir = pos.sub(cameraPosition).normalize().reflect(transformedNormalWorld);
  const toMax = uCenter.add(uHalf).sub(pos).div(dir);
  const toMin = uCenter.sub(uHalf).sub(pos).div(dir);
  const front = toMax.max(toMin);
  const t = front.x.min(front.y).min(front.z);
  return pos.add(dir.mul(t)).sub(uProbe);
}

const _rtPosProbe = new THREE.Vector3();

function rtNodeEnvProbe(probe, c){
  const s = probe.userData.probe || {};
  if(!s.box) return null;
  if(typeof TSL === 'undefined' || !TSL || !TSL.pmremTexture) return null;
  if(!c.nodeBox){
    c.uni = {
      center: TSL.uniform(new THREE.Vector3()),
      half:   TSL.uniform(new THREE.Vector3()),
      probe:  TSL.uniform(new THREE.Vector3())
    };
    c.nodeBox = TSL.pmremTexture(c.rt.texture,
      rtNodeDirectionBox(c.uni.center, c.uni.half, c.uni.probe));
  }
  const size = s.boxSize || [12, 6, 12];
  const dec = s.boxOffset || [0, 0, 0];
  probe.getWorldPosition(_rtPosProbe);
  c.uni.probe.value.copy(_rtPosProbe);
  c.uni.center.value.set(_rtPosProbe.x + dec[0], _rtPosProbe.y + dec[1], _rtPosProbe.z + dec[2]);
  c.uni.half.value.set(Math.max(0.01, size[0] / 2), Math.max(0.01, size[1] / 2),
                       Math.max(0.01, size[2] / 2));
  return c.nodeBox;
}

// Le ciel sert de sonde par défaut à toute la scène (miroir du repli de js/probes.js) :
// sans lui, un métal reste mort tant qu'aucune sonde n'a été posée. Cuit dans une scène
// jetable qui ne contient QUE le dôme — aucun objet ne peut s'y glisser.
function rtBakeSky(env){
  if(!env || env.skyReflets === false){
    if(rtSkyProbe){ rtSkyProbe.rt.dispose(); rtSkyProbe = null; }
    return null;
  }
  try{
    if(rtDomeBake){
      // libérée seulement maintenant : sous WebGPU le rendu précédent n'était qu'encodé au
      // retour de update(), la détruire dans la foulée courait après le backend
      rtDomeBake.dispose();
      rtDomeBake = null;
    }
    const sc = new THREE.Scene();
    const fond = rtBuildSkyBackground(env);
    sc.background = fond;
    rtDomeBake = (fond && fond.isTexture) ? fond : null;
    if(!rtSkyProbe){
      const rt = rtTargetCube(RT_SKY_RESOLUTION);
      rtSkyProbe = {rt: rt, cam: new THREE.CubeCamera(0.1, 400, rt)};
    }
    rtSkyProbe.cam.position.set(0, 0, 0);
    rtSkyProbe.cam.update(renderer, sc);
    return rtSkyProbe.rt.texture;
  } catch(e){
    console.warn('[runtime] reflet du ciel non cuit —', e && e.message ? e.message : e);
    if(rtSkyProbe){ rtSkyProbe.rt.dispose(); rtSkyProbe = null; }
    return null;
  }
}

// Miroir de setEnvironmentOn (js/probes.js). Le needsUpdate n'est pas décoratif :
// envNode fait partie de la clé de hidden d'un objet de rendu, mais three ne la recalcule
// que si la version du matériau a bougé.
/**
 * Recadre les ombres du jeu sur ce que voit sa caméra — le miroir exact de `updateShadows`
 * (js/scene.js).
 *
 * DEUX IMPLÉMENTATIONS QUI DOIVENT DIRE LA MÊME CHOSE. C'est la sortie principale : ce que le
 * joueur voit fait foi, et l'éditeur doit lui ressembler. Le calcul partagé vit donc dans
 * js/shadow-fit.js, et seuls les accès à three.js sont écrits deux fois.
 */
const _rtCorners = [];
for(let i = 0; i < 8; i++) _rtCorners.push(new THREE.Vector3());
const _rtInv = new THREE.Matrix4();
const _rtDir = new THREE.Vector3();
const _rtCenter = new THREE.Vector3();
const _rtPos = new THREE.Vector3();
const _rtTarget = new THREE.Vector3();
const _rtView = new THREE.Matrix4();
const _rtInvView = new THREE.Matrix4();
const RT_UP = new THREE.Vector3(0, 1, 0);
// Ce qui est derrière la sphère visible mais projette dedans : sans cette marge, un mur hors
// champ voit son ombre coupée net par le plan proche dès qu'on tourne la caméra.
const RT_SHADOW_MARGIN = 60;

function rtUpdateShadows(camera){
  if(typeof ShadowFit === 'undefined' || !camera || !game.scene) return;
  const distance = (D && D.settings && D.settings.shadowDistance) || 60;
  _rtInv.copy(camera.projectionMatrix).invert();
  let i = 0;
  for(const z of [ShadowFit.nearNdcZ(camera), 1]){
    for(const y of [-1, 1]){
      for(const x of [-1, 1]){
        _rtCorners[i].set(x, y, z).applyMatrix4(_rtInv).applyMatrix4(camera.matrixWorld);
        i++;
      }
    }
  }
  ShadowFit.clampDepth(_rtCorners, camera, distance);
  const sphere = ShadowFit.frustumSphere(_rtCorners);
  _rtCenter.set(sphere.center.x, sphere.center.y, sphere.center.z);

  game.scene.traverse(function(l){
    if(!l.isDirectionalLight || !l.castShadow || !l.shadow || !l.shadow.camera) return;
    const st = ShadowFit.lightSettings(l.userData.shadowSettings, (D && D.settings && D.settings.shadowMapSize) || 2048, sphere.radius), wanted = st.mapSize;
    // CHANGER LA RÉSOLUTION EXIGE DE JETER LA CARTE. `mapSize` n'est lu qu'à l'allocation :
    // l'écrire sur une lumière déjà rendue ne fait rien du tout, et le réglage semble sans
    // effet — trois.js garde la texture qu'il a déjà, à l'ancienne taille.
    if(l.shadow.mapSize.x !== wanted){
      l.shadow.mapSize.set(wanted, wanted);
      if(l.shadow.map){ l.shadow.map.dispose(); l.shadow.map = null; }
    }
    const radius = st.radius;
    const texel = st.texel;

    l.getWorldPosition(_rtPos);
    if(l.target){ l.target.updateWorldMatrix(true, false); l.target.getWorldPosition(_rtTarget); }
    else _rtTarget.set(0, 0, 0);
    _rtDir.subVectors(_rtTarget, _rtPos);
    if(_rtDir.lengthSq() < 1e-8) _rtDir.set(0, -1, 0);
    _rtDir.normalize();

    // LA LUMIÈRE NE BOUGE PAS — même raison que dans l'éditeur (js/scene.js) : une caméra
    // orthographique accepte des bornes asymétriques, donc on décale la BOÎTE au lieu de
    // déplacer un objet que l'utilisateur a placé.
    _rtView.lookAt(_rtPos, _rtTarget, RT_UP);
    _rtInvView.copy(_rtView).invert();
    const local = _rtCenter.clone().applyMatrix4(_rtInvView);
    const cx = ShadowFit.snapToTexel(local.x, texel);
    const cy = ShadowFit.snapToTexel(local.y, texel);
    const depth = -local.z;   // une caméra regarde vers -Z

    const cam = l.shadow.camera;
    cam.left = cx - radius; cam.right = cx + radius;
    cam.bottom = cy - radius; cam.top = cy + radius;
    cam.near = Math.max(0.1, depth - radius - RT_SHADOW_MARGIN);
    cam.far = depth + radius + RT_SHADOW_MARGIN;
    cam.updateProjectionMatrix();
    l.shadow.normalBias = st.normalBias;
    l.shadow.bias = st.bias;
  });
}

function rtSetEnvironmentOn(m, tex, intensity, node){
  if(!('envMap' in m)) return;
  const nodeActuel = m.envNode || null;
  if(m.envMap === tex && nodeActuel === node
     && (tex === null || m.envMapIntensity === intensity)) return;
  // Le MÊME retrait asymétrique que dans js/probes.js, et pour la même raison : sous WebGPU,
  // le groupe de bindings qui porte le sampler de l'ancienne texture survit à `needsUpdate`
  // et déréférence `texture.isTexture` sur `null` à chaque image. Ici la conséquence est pire
  // que dans l'éditeur — c'est le jeu publié qui se figerait chez le joueur.
  // `dispose()` n'a lieu que sur la transition vers `null` : la garde d'égalité ci-dessus
  // sort sans rien faire quand l'état ne bouge pas.
  if(tex === null && (m.envMap || m.envNode) && typeof m.dispose === 'function') m.dispose();
  m.envMap = tex;
  if(node) m.envNode = node;
  else if(m.envNode) m.envNode = null;
  if(tex !== null && m.envMapIntensity !== undefined) m.envMapIntensity = intensity;
  m.needsUpdate = true;
}

let rtPendingProbes = 0;

function rtBakeProbes(){
  // WebGPURenderer.init() est asynchrone et loadSceneGame() peut passer avant lui :
  // cuire sur un backend absent ne lève rien de visible, les reflets manquent simplement.
  // Bornée à ~10 s : au-delà, le backend ne viendra plus et boucler n'y changerait rien.
  if(!renderer.__ready){
    if(rtPendingProbes >= 100) return;
    rtPendingProbes++;
    setTimeout(rtBakeProbes, 100);
    return;
  }
  rtPendingProbes = 0;

  rtProbes.forEach(function(c){ if(c.rt) c.rt.dispose(); });
  rtProbes.clear();
  const texSky = rtBakeSky(rtEnvCurrent);
  const intensitySky = (rtEnvCurrent && rtEnvCurrent.skyRefletsIntensity !== undefined)
    ? rtEnvCurrent.skyRefletsIntensity : 1;

  // Porteurs d'un composant Reflection, lus au Registry — même chemin que probesActive()
  // côté éditeur (js/probes.js), au lieu d'un balayage de toute la scène.
  const list = Registry.activeNodes('Reflection');
  list.forEach(function(o){
    const s = o.userData.probe || {};
    const res = Math.max(16, Math.min(512, s.resolution | 0 || 128));
    const rt = rtTargetCube(res);
    const cam = new THREE.CubeCamera(0.1, 800, rt);
    o.getWorldPosition(cam.position);
    cam.update(renderer, game.scene);
    rtProbes.set(o, {rt: rt, cam: cam});
  });
  // distribution aux maillages : la sonde qui les couvre, sinon le ciel
  const pA = new THREE.Vector3(), pB = new THREE.Vector3();
  // Receveurs d'environnement : les deux formes de rendu plus le terrain. Miroir exact de
  // receiversDEnvironment() (js/probes.js).
  Registry.activeNodes('Mesh').concat(Registry.activeNodes('Model'))
    .concat(Registry.activeNodes('Terrain')).forEach(function(o){
    o.getWorldPosition(pA);
    let best = null, bestD = Infinity;
    rtProbes.forEach(function(c, probe){
      probe.getWorldPosition(pB);
      const d = pA.distanceTo(pB);
      const radius = (probe.userData.probe && probe.userData.probe.radius) || 18;
      if(d <= radius && d < bestD){ best = probe; bestD = d; }
    });
    const c = best ? rtProbes.get(best) : null;
    const raw = best && best.userData.probe
      ? best.userData.probe.intensity : undefined;
    const tex = c ? c.rt.texture : texSky;
    const inten = c ? ((raw !== undefined) ? raw : 1) : intensitySky;
    const node = c ? rtNodeEnvProbe(best, c) : null;
    o.traverse(function(x){
      if(!x.isMesh) return;
      const mats = Array.isArray(x.material) ? x.material : (x.material ? [x.material] : []);
      mats.forEach(function(m){ rtSetEnvironmentOn(m, tex, inten, node); });
    });
  });
}

// ---------- post-traitement (miroir de js/postfx.js) ----------
const rtPost = {ready: false, w: 0, h: 0, rtScene: null, rtBright: null, rtA: null, rtB: null,
  sceneQuad: null, camQuad: null, quad: null,
  matBright: null, matBlur: null, matComposite: null};

// TSL — WebGPURenderer n'exécute pas les ShaderMaterial GLSL bruts. Même portage que
// js/postfx.js (dupliqué ici, game-runtime.js ne partage pas de code avec l'éditeur) —
// voir docs/superpowers/specs/2026-08-06-fondation-webgpu-tsl-design.md, section Tests.
// Miroir de postFlipV()/uvSceneInversee (postfx.js) : sous WebGPURenderer, la texture d'une
// cible de rendu a V=0 en HAUT, contrairement au quad plein écran (uv() suppose V=0 en BAS,
// convention WebGL jamais changée ici) — un seul flip à la lecture de rtScene (le rendu 3D
// raw) suffit, toute la chaîne en aval (flou, bloom) recopie fidèlement cette orientation
// ensuite. Le flip suit `renderer.backend.isWebGPUBackend` (vrai backend WebGPU, pas le repli
// WebGL2 automatique que THREE.WebGPURenderer choisit tout seul) — ce n'est plus une case à
// cocher que chacun devait deviner au pif.
function rtPostFlipV(){
  return !!(renderer.backend && renderer.backend.isWebGPUBackend);
}

// Miroir exact de resolvePostVolumesForBlend()/postStateToLegacyFormat() (js/postfx.js) —
// dupliqué, pas partagé (game-runtime.js ne partage pas de code avec l éditeur).
// LE POST-TRAITEMENT ABSENT NE DOIT PLUS ÊTRE MUET. Un PostVolume dont le profil ne se résout
// pas (asset supprimé, référence non remappée à la réouverture — voir
// remapReferencesAssetsInScenes, js/serialization.js) ou dont aucun effet n'est actif ne rend
// RIEN à l'écran, exactement comme s'il n'existait pas. Sans ce mot, il n'y a aucun moyen de
// distinguer les deux, ni de savoir lequel des deux on regarde : c'est ce qui a coûté plusieurs
// allers-retours. Une fois par id, jamais dans la boucle d'image.
const postVolumeReported = {};

// Vidée à chaque changement de scène (loadSceneGame) : les avertissements portent sur les
// volumes de LA scène courante. Sans ce vidage, une scène chargée plus tard restait muette
// parce qu'une autre avait déjà signalé le même id de profil.
function resetPostVolumeReports(){
  for(const key in postVolumeReported) delete postVolumeReported[key];
}

function reportPostVolume(key, message){
  if(postVolumeReported[key]) return;
  postVolumeReported[key] = true;
  console.warn('[runtime] post-traitement : ' + message);
}

function rtResolvePostVolumesForBlend(){
  return Registry.active('PostVolume').map(function(c){
    const d = c.data;
    const profile = c.profile;
    if(!profile){
      reportPostVolume('missing:' + d.profileId, d.profileId
        ? 'le PostVolume de « ' + (c.node.name || '?') + ' » référence le profil « ' + d.profileId
          + ' », introuvable dans les assets du jeu — aucun effet ne sera appliqué'
        : 'le PostVolume de « ' + (c.node.name || '?') + ' » n a aucun profil : rien à appliquer');
    } else if(!Object.keys(profile.effects || {}).some(function(k){
      return profile.effects[k] && profile.effects[k].overridden;
    })){
      reportPostVolume('empty:' + d.profileId,
        'le profil « ' + profile.name + ' » n a aucun effet actif — le volume ne change rien');
    }
    const pos = c.node.getWorldPosition(new THREE.Vector3());
    return {
      global: !!d.global, priority: d.priority || 0, shape: d.shape, size: d.size,
      radius: d.radius, position: {x: pos.x, y: pos.y, z: pos.z},
      blendDistance: d.blendDistance, effects: profile ? profile.effects : null
    };
  });
}

function rtPostStateToLegacyFormat(state){
  return {
    active: true, toneMapping: state.toneMapping.mode, exposition: state.colorGrading.exposure,
    bloom: state.bloom.intensity > 0, bloomThreshold: state.bloom.threshold,
    bloomIntensity: state.bloom.intensity, bloomRadius: state.bloom.radius,
    contraste: state.colorGrading.contrast, saturation: state.colorGrading.saturation,
    temperature: state.colorGrading.temperature, vignette: state.vignette.amount,
    grain: state.grain.amount
  };
}

// Calculé PAR FRAME : la caméra bouge, les volumes locaux doivent réagir. Rend null si
// aucun PostVolume ne contribue — c est le signal pour sauter rtPostRender entièrement.
// UN ÉTAT NEUTRE NE JUSTIFIE PAS UNE PASSE. Un profil peut très bien overrider un effet
// tout en le laissant à sa valeur d'absence (bloom coché mais intensité 0, gradation cochée
// mais laissée à 1) : `blendPostVolumes` rend alors un état non nul, et la chaîne complète
// (cible hors écran + composition, une passe plein écran par image) tournait pour redonner
// EXACTEMENT l'image d'entrée. On la saute : rendu direct à l'écran, pixel pour pixel le
// même résultat, sans le coût ni l'aller-retour par une cible.
function rtPostStateIsNoop(p){
  return !(p.bloom && p.bloomIntensity > 0)
    && (p.toneMapping === 'none')
    && p.exposition === 1 && p.contraste === 1 && p.saturation === 1
    && p.temperature === 0 && p.vignette === 0 && p.grain === 0;
}

function rtCurrentPostState(cam){
  const volumes = rtResolvePostVolumesForBlend();
  if(volumes.length){
    const camPos = cam.getWorldPosition(new THREE.Vector3());
    const merged = blendPostVolumes(volumes, {x:camPos.x, y:camPos.y, z:camPos.z});
    if(merged){
      const p = rtPostStateToLegacyFormat(merged);
      if(!rtPostStateIsNoop(p)) return p;
    }
  }
  // Aucun repli sur les réglages de scène : miroir exact de postRender() (js/postfx.js),
  // une seule source de vérité — les PostVolume et leurs profils.
  return null;
}

// ---------- lecture d'une cible de rendu : LA RÈGLE, une fois pour toutes ----------
// Sous WebGPU, une cible de rendu a sa ligne V=0 EN HAUT ; le quad plein écran (uv() standard)
// suppose V=0 en bas. TOUTE lecture d'une cible doit donc inverser le V — pas seulement celle
// de la scène. C'est ce « pas seulement » qui manquait : seule rtScene était inversée, et la
// chaîne du bloom (bright → flou ×4 → composition) accumulait un nombre IMPAIR de lectures non
// inversées. Résultat mesuré : la scène à l'endroit, le halo de bloom à l'envers, collé en haut
// de l'image. Un flou gaussien étant symétrique, les passes intermédiaires ne le montraient pas
// — seule la dernière lecture le rendait visible, ce qui rendait le défaut illisible.
// La règle est donc uniforme : une lecture de cible = un flip. Aucune exception.
function rtUvTargetRead(uFlipV){
  return TSL.vec2(TSL.uv().x, TSL.mix(TSL.uv().y, TSL.float(1).sub(TSL.uv().y), uFlipV));
}

function rtCreateMaterialBright(){
  const {Fn, texture, uv, uniform, dot, vec3, max: tmax, float} = TSL;
  const uThreshold = uniform(0.8);
  const uFlipV = uniform(0);
  const tSrc = texture(null, rtUvTargetRead(uFlipV));
  const mat = new THREE.NodeMaterial();
  mat.fragmentNode = Fn(() => {
    const c = tSrc.rgb;
    const l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    const f = tmax(float(0), l.sub(uThreshold)).div(tmax(float(0.0001), float(1).sub(uThreshold)));
    return vec3(c.mul(f)).toVec4(float(1));
  })();
  mat.depthTest = false;
  mat.depthWrite = false;
  // Quad plein ecran : NDC direct, ignore la transformation camera
  // (equivalent exact de l'ancien gl_Position = vec4(position.xy, 0.0, 1.0)).
  mat.positionNode = TSL.vec3(TSL.positionGeometry.xy, 0);
  mat.uThreshold = uThreshold;
  mat.uFlipV = uFlipV;
  mat.tSrcNode = tSrc;
  return mat;
}

function rtCreateMaterialBlur(){
  const {Fn, texture, uv, uniform, vec2, vec3, float} = TSL;
  const uDir = uniform(new THREE.Vector2());
  const uFlipV = uniform(0);
  const tSrc = texture(null, rtUvTargetRead(uFlipV));
  const P = [0.227027, 0.194595, 0.121622, 0.054054, 0.016216];
  const mat = new THREE.NodeMaterial();
  mat.fragmentNode = Fn(() => {
    let s = tSrc.sample(uv()).rgb.mul(float(P[0]));
    for(let i = 1; i < 5; i++){
      const o = uDir.mul(float(i));
      s = s.add(tSrc.sample(uv().add(o)).rgb.mul(float(P[i])));
      s = s.add(tSrc.sample(uv().sub(o)).rgb.mul(float(P[i])));
    }
    return s.toVec4(float(1));
  })();
  mat.depthTest = false;
  mat.depthWrite = false;
  // Quad plein ecran : NDC direct, ignore la transformation camera
  // (equivalent exact de l'ancien gl_Position = vec4(position.xy, 0.0, 1.0)).
  mat.positionNode = TSL.vec3(TSL.positionGeometry.xy, 0);
  mat.uDir = uDir;
  mat.uFlipV = uFlipV;
  mat.tSrcNode = tSrc;
  return mat;
}

function rtCreateMaterialComposite(){
  const {Fn, texture, uv, uniform, dot, mix, clamp, vec2, vec3, max: tmax,
    float, fract, sin} = TSL;
  const uBloom = uniform(0.7), uContraste = uniform(1), uSaturation = uniform(1),
    uTemperature = uniform(0), uVignette = uniform(0.25), uGrain = uniform(0),
    uTime = uniform(0), uExposition = uniform(1), uTone = uniform(4, 'int');
  // LES DEUX lectures sont des lectures de CIBLE, donc les deux passent par rtUvTargetRead().
  // Le commentaire d'avant disait le contraire (« tBloom est déjà réorientée, pas de second
  // flip ») et c'était le raisonnement faux qui a produit le halo de bloom retourné : écrire
  // dans une cible réintroduit le flip à CHAQUE passe. Une lecture de cible = un flip.
  const uFlipV = uniform(0);
  const tSrc = texture(null, rtUvTargetRead(uFlipV));
  const tBloom = texture(null, rtUvTargetRead(uFlipV));
  const mat = new THREE.NodeMaterial();
  mat.fragmentNode = Fn(() => {
    const uvN = uv();
    let c = tSrc.rgb;
    c = c.add(tBloom.rgb.mul(uBloom));
    c = c.mul(uExposition);
    const cClamp = clamp(c, 0, 1);
    const cReinhard = c.div(vec3(1).add(c));
    const cCin = tmax(vec3(0), c.sub(0.004));
    const cCineon = cCin.mul(cCin.mul(6.2).add(0.5)).div(cCin.mul(cCin.mul(6.2).add(1.7)).add(0.06)).pow(2.2);
    const cACES = clamp(c.mul(c.mul(2.51).add(0.03)).div(c.mul(c.mul(2.43).add(0.59)).add(0.14)), 0, 1);
    c = uTone.equal(1).select(cClamp,
      uTone.equal(2).select(cReinhard,
        uTone.equal(3).select(cCineon,
          uTone.equal(4).select(cACES, c))));
    const r = c.r.mul(float(1).add(uTemperature.mul(0.18)));
    const b = c.b.mul(float(1).sub(uTemperature.mul(0.18)));
    c = vec3(r, c.g, b);
    const l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(l), c, uSaturation);
    c = c.sub(0.5).mul(uContraste).add(0.5);
    const d = uvN.sub(0.5);
    c = c.mul(float(1).sub(uVignette.mul(dot(d, d)).mul(2.4)));
    const n = fract(sin(dot(uvN.mul(1024).add(uTime), vec2(12.9898, 78.233))).mul(43758.5453));
    c = c.add(n.sub(0.5).mul(uGrain).mul(0.25));
    // PAS de conversion sRGB manuelle ici. Cette passe finale est rendue À L ÉCRAN, et un
    // NodeMaterial rendu à l écran reçoit déjà la conversion linéaire -> sRGB du renderer
    // (`renderer.outputColorSpace`, laissé à sa valeur par défaut SRGBColorSpace). Un
    // pow(1/2,2) ajouté ici était donc une SECONDE conversion : image laiteuse, blanchie,
    // contrastes écrasés — le « filtre blanc » qu on voyait dès qu un effet était actif,
    // quel que soit l effet. Toute la chaîne reste linéaire, le renderer convertit en bout.
    c = tmax(c, 0);
    return c.toVec4(float(1));
  })();
  mat.depthTest = false;
  mat.depthWrite = false;
  // Quad plein ecran : NDC direct, ignore la transformation camera
  // (equivalent exact de l'ancien gl_Position = vec4(position.xy, 0.0, 1.0)).
  mat.positionNode = TSL.vec3(TSL.positionGeometry.xy, 0);
  Object.assign(mat, {uBloom, uContraste, uSaturation, uTemperature, uVignette, uGrain,
    uTime, uExposition, uTone, uFlipV, tSrcNode: tSrc, tBloomNode: tBloom});
  return mat;
}

function rtPostInit(){
  if(rtPost.ready) return;
  rtPost.sceneQuad = new THREE.Scene();
  rtPost.camQuad = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  rtPost.matBright = rtCreateMaterialBright();
  rtPost.matBlur = rtCreateMaterialBlur();
  rtPost.matComposite = rtCreateMaterialComposite();
  rtPost.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), rtPost.matComposite);
  rtPost.quad.frustumCulled = false;
  rtPost.sceneQuad.add(rtPost.quad);
  rtPost.ready = true;
}

function rtPostSizes(w, h){
  if(rtPost.w === w && rtPost.h === h && rtPost.rtScene) return;
  rtPost.w = w; rtPost.h = h;
  [rtPost.rtScene, rtPost.rtBright, rtPost.rtA, rtPost.rtB].forEach(function(rt){
    if(rt) rt.dispose();
  });
  const opt = {minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
               format: THREE.RGBAFormat, stencilBuffer: false};
  const pr = renderer.getPixelRatio();
  const pw = Math.max(1, Math.floor(w * pr)), ph = Math.max(1, Math.floor(h * pr));
  rtPost.rtScene = new THREE.WebGLRenderTarget(pw, ph, opt);
  const dw = Math.max(1, pw >> 1), dh = Math.max(1, ph >> 1);
  rtPost.rtBright = new THREE.WebGLRenderTarget(dw, dh, opt);
  rtPost.rtA = new THREE.WebGLRenderTarget(dw, dh, opt);
  rtPost.rtB = new THREE.WebGLRenderTarget(dw, dh, opt);
}

function rtToneIndex(name){
  switch(name){
    case 'none':    return 0;
    case 'lineaire': return 1;
    case 'reinhard': return 2;
    case 'cineon':   return 3;
    default:         return 4;
  }
}

function rtPass(mat, target){
  rtPost.quad.material = mat;
  renderer.setRenderTarget(target || null);
  renderer.render(rtPost.sceneQuad, rtPost.camQuad);
}

function rtPostRender(sc, cam, time){
  const p = game.post;
  rtPostInit();
  rtPostSizes(innerWidth, innerHeight);
  renderer.setRenderTarget(rtPost.rtScene);
  renderer.clear();
  renderer.render(sc, cam);

  let bloomTex = null;
  if(p.bloom && p.bloomIntensity > 0){
    rtPost.matBright.tSrcNode.value = rtPost.rtScene.texture;
  // MEME sens pour TOUTES les lectures de cible (voir rtUvTargetRead) : scene, flou, bloom
    rtPost.matBright.uFlipV.value = rtPostFlipV() ? 1 : 0;
    rtPost.matBright.uThreshold.value = (p.bloomThreshold !== undefined) ? p.bloomThreshold : 0.8;
    rtPass(rtPost.matBright, rtPost.rtBright);
    const tw = rtPost.rtBright.width, th = rtPost.rtBright.height;
    const r = Math.max(0.2, p.bloomRadius || 1);
    rtPost.matBlur.uFlipV.value = rtPostFlipV() ? 1 : 0;
    let src = rtPost.rtBright;
    for(let i = 0; i < 2; i++){
      rtPost.matBlur.tSrcNode.value = src.texture;
      rtPost.matBlur.uDir.value.set(r * (i + 1) / tw, 0);
      rtPass(rtPost.matBlur, rtPost.rtA);
      rtPost.matBlur.tSrcNode.value = rtPost.rtA.texture;
      rtPost.matBlur.uDir.value.set(0, r * (i + 1) / th);
      rtPass(rtPost.matBlur, rtPost.rtB);
      src = rtPost.rtB;
    }
    bloomTex = rtPost.rtB.texture;
  }
  const mc = rtPost.matComposite;
  mc.tSrcNode.value = rtPost.rtScene.texture;
  mc.tBloomNode.value = bloomTex || rtPost.rtBright.texture;
  mc.uFlipV.value = rtPostFlipV() ? 1 : 0;
  mc.uBloom.value = bloomTex ? p.bloomIntensity : 0;
  mc.uContraste.value = (p.contraste !== undefined) ? p.contraste : 1;
  mc.uSaturation.value = (p.saturation !== undefined) ? p.saturation : 1;
  mc.uTemperature.value = p.temperature || 0;
  mc.uVignette.value = (p.vignette !== undefined) ? p.vignette : 0;
  mc.uGrain.value = p.grain || 0;
  mc.uTime.value = time || 0;
  mc.uExposition.value = (p.exposition !== undefined) ? p.exposition : 1;
  mc.uTone.value = rtToneIndex(p.toneMapping);
  // Miroir de js/postfx.js : plus de FXAA (il retournait l'image).
  rtPass(rtPost.matComposite, null);
  renderer.setRenderTarget(null);
}

// ---------- terrain heightmap (miroir de js/terrain.js, sans sculpt) ----------
// terrIdx vit dans js/component-data.js, PARTAGÉ avec l'éditeur : la copie `rtTerrIdx`
// qui se trouvait ici n'avait plus d'appelant une fois le champ de hauteurs construit par
// buildRigidBody (js/rigid-body.js).

function rtMakeTerrain(t){
  const seg = t.segments;
  const n = (seg + 1) * (seg + 1);
  const geo = new THREE.PlaneGeometry(t.size, t.size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.92, metalness: 0}));
  mesh.receiveShadow = true;
  const pos = geo.attributes.position, col = geo.attributes.color;
  let hMax = 0.001;
  for(let i = 0; i < n; i++) hMax = Math.max(hMax, Math.abs(t.heights[i] || 0));
  for(let i = 0; i < n; i++) pos.setY(i, t.heights[i] || 0);
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  const cBottom = new THREE.Color(t.colorBottom || '#3f6b3a');
  const cTop = new THREE.Color(t.colorTop || '#8b8378');
  const cNeige = new THREE.Color(t.colorNeige || '#e8eef2');
  const nrm = geo.attributes.normal, c = new THREE.Color();
  const sr = (t.thresholdRoche !== undefined) ? t.thresholdRoche : 0.35;
  const sn = (t.thresholdNeige !== undefined) ? t.thresholdNeige : 0.8;
  for(let i = 0; i < n; i++){
    const alt = (t.heights[i] || 0) / hMax;
    let f = Math.max(0, Math.min(1, (alt - sr) / Math.max(0.01, 1 - sr)));
    if(t.rolloff !== false) f = Math.max(f, Math.min(1, (1 - Math.abs(nrm.getY(i))) * 2.2));
    c.copy(cBottom).lerp(cTop, f);
    if(alt > sn) c.lerp(cNeige, Math.min(1, (alt - sn) / Math.max(0.01, 1 - sn)));
    col.setXYZ(i, c.r, c.g, c.b);
  }
  col.needsUpdate = true;
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return mesh;
}

// ---------- navigation IA (grille au sol + A* — miroir de js/navigation.js) ----------
const NAV_CELL = 0.5, NAV_HALF = 40;
const rtNav = {grid: null, states: new Map()};
function rtNavReset(){ rtNav.grid = null; rtNav.states = new Map(); }

const _nBox = new THREE.Box3();
function rtNavGrid(){
  if(rtNav.grid) return rtNav.grid;
  const nx = Math.round((NAV_HALF * 2) / NAV_CELL);
  const bloque = new Uint8Array(nx * nx);
  const marge = 0.25;
  // Obstacles de la grille de navigation : ce qui a une forme de rendu et se voit.
  Registry.activeNodes('Mesh').concat(Registry.activeNodes('Model')).forEach(function(o){
    if(!o.visible) return;
    if(o.userData.game && o.userData.game.tag === 'ground') return;
    if(o.userData.collider && o.userData.collider.trigger) return;
    _nBox.setFromObject(o);
    if(_nBox.isEmpty() || _nBox.max.y < 0.15 || _nBox.min.y > 1.8) return;
    const x0 = Math.max(0, Math.floor((_nBox.min.x - marge + NAV_HALF) / NAV_CELL));
    const x1 = Math.min(nx - 1, Math.floor((_nBox.max.x + marge + NAV_HALF) / NAV_CELL));
    const z0 = Math.max(0, Math.floor((_nBox.min.z - marge + NAV_HALF) / NAV_CELL));
    const z1 = Math.min(nx - 1, Math.floor((_nBox.max.z + marge + NAV_HALF) / NAV_CELL));
    for(let z = z0; z <= z1; z++)
      for(let x = x0; x <= x1; x++) bloque[z * nx + x] = 1;
  });
  rtNav.grid = {nx: nx, bloque: bloque};
  return rtNav.grid;
}
function rtNavCell(v){
  const nx = Math.round((NAV_HALF * 2) / NAV_CELL) - 1;
  return {x: Math.max(0, Math.min(nx, Math.floor((v.x + NAV_HALF) / NAV_CELL))),
          z: Math.max(0, Math.min(nx, Math.floor((v.z + NAV_HALF) / NAV_CELL)))};
}
function rtNavWorld(cx, cz){
  return {x: (cx + 0.5) * NAV_CELL - NAV_HALF, z: (cz + 0.5) * NAV_CELL - NAV_HALF};
}
function rtNavFreeNear(g, cx, cz){
  if(!g.bloque[cz * g.nx + cx]) return {x: cx, z: cz};
  for(let r = 1; r < 12; r++)
    for(let dz = -r; dz <= r; dz++)
      for(let dx = -r; dx <= r; dx++){
        if(Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = cx + dx, z = cz + dz;
        if(x < 0 || z < 0 || x >= g.nx || z >= g.nx) continue;
        if(!g.bloque[z * g.nx + x]) return {x: x, z: z};
      }
  return null;
}
function rtNavLineFree(g, a, b){
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
      if(x0 === b.x) return true;
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
function rtNavAstar(g, dep, arr){
  const nx = g.nx, n = nx * nx;
  const gScore = new Float32Array(n).fill(Infinity);
  const fScore = new Float32Array(n).fill(Infinity);
  const parent = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const iDep = dep.z * nx + dep.x, iArr = arr.z * nx + arr.x;
  const tas = [iDep];
  gScore[iDep] = 0;
  fScore[iDep] = Math.hypot(arr.x - dep.x, arr.z - dep.z);
  function monte(i){
    while(i > 0){
      const p = (i - 1) >> 1;
      if(fScore[tas[p]] <= fScore[tas[i]]) break;
      const t = tas[p]; tas[p] = tas[i]; tas[i] = t; i = p;
    }
  }
  function pop(){
    const min = tas[0], end = tas.pop();
    if(tas.length){
      tas[0] = end;
      let i = 0;
      while(true){
        const a = 2*i+1, b = 2*i+2;
        let m = i;
        if(a < tas.length && fScore[tas[a]] < fScore[tas[m]]) m = a;
        if(b < tas.length && fScore[tas[b]] < fScore[tas[m]]) m = b;
        if(m === i) break;
        const t = tas[m]; tas[m] = tas[i]; tas[i] = t; i = m;
      }
    }
    return min;
  }
  const DIRS = [[1,0,1],[-1,0,1],[0,1,1],[0,-1,1],[1,1,1.414],[1,-1,1.414],[-1,1,1.414],[-1,-1,1.414]];
  let garde = 0;
  while(tas.length && garde++ < 30000){
    const cour = pop();
    if(cour === iArr) break;
    if(closed[cour]) continue;
    closed[cour] = 1;
    const cx = cour % nx, cz = (cour / nx) | 0;
    for(let d = 0; d < 8; d++){
      const x = cx + DIRS[d][0], z = cz + DIRS[d][1];
      if(x < 0 || z < 0 || x >= nx || z >= nx) continue;
      const idx = z * nx + x;
      if(g.bloque[idx] || closed[idx]) continue;
      if(DIRS[d][0] && DIRS[d][1] && (g.bloque[cz * nx + x] || g.bloque[z * nx + cx])) continue;
      const cost = gScore[cour] + DIRS[d][2];
      if(cost < gScore[idx]){
        gScore[idx] = cost;
        fScore[idx] = cost + Math.hypot(arr.x - x, arr.z - z);
        parent[idx] = cour;
        tas.push(idx);
        monte(tas.length - 1);
      }
    }
  }
  if(parent[iArr] === -1 && iArr !== iDep) return null;
  const raw = [];
  let i = iArr;
  while(i !== -1){ raw.unshift({x: i % nx, z: (i / nx) | 0}); i = parent[i]; }
  const lisse = [raw[0]];
  let a = 0;
  while(a < raw.length - 1){
    let b = raw.length - 1;
    while(b > a + 1 && !rtNavLineFree(g, raw[a], raw[b])) b--;
    lisse.push(raw[b]);
    a = b;
  }
  return lisse;
}
function rtNavPos(target){
  if(!target) return null;
  if(typeof target === 'string'){
    const o = game.objects.find(function(x){ return x.name === target; });
    return o ? o.getWorldPosition(new THREE.Vector3()) : null;
  }
  if(target.isObject3D) return target.getWorldPosition(new THREE.Vector3());
  if(target.x !== undefined && target.z !== undefined) return target;
  return null;
}
function rtNavFilePath(depuis, vers){
  const g = rtNavGrid();
  const a0 = rtNavFreeNear(g, rtNavCell(depuis).x, rtNavCell(depuis).z);
  const b0 = rtNavFreeNear(g, rtNavCell(vers).x, rtNavCell(vers).z);
  if(!a0 || !b0) return null;
  const cells = rtNavAstar(g, a0, b0);
  if(!cells) return null;
  const pts = cells.map(function(c){
    const m = rtNavWorld(c.x, c.z);
    return {x: m.x, y: depuis.y || 0, z: m.z};
  });
  pts[pts.length - 1] = {x: vers.x, y: depuis.y || 0, z: vers.z};
  return pts;
}
function rtNavAdvance(o, target, speed, dt){
  const but = rtNavPos(target);
  if(!but) return false;
  let state = rtNav.states.get(o);
  if(!state){ state = {}; rtNav.states.set(o, state); }
  const keyBut = Math.round(but.x * 2) + ':' + Math.round(but.z * 2);
  if(state.keyBut !== keyBut){
    state.filePath = rtNavFilePath(o.position, but);
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
function rtNavPatrol(o, points, speed, dt){
  if(!points || !points.length) return;
  let p = rtNav.states.get(o);
  if(!p){ p = {}; rtNav.states.set(o, p); }
  if(p.patrouille === undefined) p.patrouille = 0;
  const idx = p.patrouille % points.length;
  if(rtNavAdvance(o, points[idx], speed, dt)){
    p.patrouille = (idx + 1) % points.length;
    p.keyBut = null;
  }
}

// ---------- particules ----------
const rtPart = {texture: null};
// PART_DEFAULT vit dans js/component-data.js, PARTAGÉ avec l'éditeur. La copie qui se
// trouvait ici s'appelait PART_DEFAUT_RT : deux littéraux à tenir en phase pour un seul défaut,
// dans le sens éditeur → game publié où une divergence ne se voit qu'après export.

function rtTextureParticle(){
  if(rtPart.texture) return rtPart.texture;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const cx = cv.getContext('2d');
  const g = cx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.85)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  cx.fillStyle = g;
  cx.fillRect(0, 0, 64, 64);
  rtPart.texture = new THREE.CanvasTexture(cv);
  return rtPart.texture;
}

// Miroir de buildRenderParticles (js/particles.js) : game-runtime.js ne partage pas de
// code avec l'éditeur au-delà de jeu-ui.js/game-character.js, et particles.js dépend de globales
// d'éditeur (objets, engineScripts, LAYER_HELPERS) qu'un build n'a pas.
//
// Quads billboardés et NON THREE.Points : `pointUV` génère littéralement du GLSL
// (`gl_PointCoord`), invalide en WGSL — le pipeline WebGPU était rejeté à CHAQUE image
// (« unresolved value 'gl_PointCoord' »). WebGPU n'a ni coordonnée ni taille de point :
// `sizeNode` était mort avec. Garder les deux copies en phase.
function rtBuildRenderParticles(cfg, max){
  const gabarit = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', gabarit.attributes.position);
  geo.setAttribute('uv', gabarit.attributes.uv);
  geo.setIndex(gabarit.index);
  const instancie = function(name, n){
    const a = new THREE.InstancedBufferAttribute(new Float32Array(max * n), n);
    a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute(name, a);
  };
  instancie('aPos', 3);
  instancie('aSize', 1);
  instancie('aOpacity', 1);
  instancie('aColor', 3);
  geo.instanceCount = 0;
  const {attribute: rtAttribute, texture: rtTsltexture, uv: rtUv, vec3: rtVec3, vec4: rtVec4,
    cameraViewMatrix: rtCamView, cameraProjectionMatrix: rtCamProj,
    positionGeometry: rtPosGeo, float: rtFloat} = TSL;
  const rtASize = rtAttribute('aSize', 'float');
  const rtAOpacity = rtAttribute('aOpacity', 'float');
  const rtAColor = rtAttribute('aColor', 'vec3');
  const rtAPos = rtAttribute('aPos', 'vec3');
  const mat = new THREE.MeshBasicNodeMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: cfg.additif !== false ? THREE.AdditiveBlending : THREE.NormalBlending
  });
  const centerView = rtCamView.mul(rtVec4(rtAPos, rtFloat(1))).xyz;
  const offset = rtVec3(rtPosGeo.x.mul(rtASize), rtPosGeo.y.mul(rtASize), rtFloat(0));
  mat.vertexNode = rtCamProj.mul(rtVec4(centerView.add(offset), rtFloat(1)));
  mat.colorNode = rtVec4(rtAColor, rtAOpacity.mul(rtTsltexture(rtTextureParticle(), rtUv()).a));
  return {geo: geo, mat: mat};
}

function rtCreateSystem(o){
  const cfg = o.userData.part;
  const max = Math.max(1, Math.min(5000, cfg.max | 0 || 300));
  const render = rtBuildRenderParticles(cfg, max);
  const objet3d = new THREE.Mesh(render.geo, render.mat);
  objet3d.frustumCulled = false;
  objet3d.renderOrder = 500;
  game.scene.add(objet3d);
  return {obj: o, objet3d: objet3d, geo: render.geo, max: max,
    pos: new Float32Array(max * 3), vel: new Float32Array(max * 3),
    age: new Float32Array(max), vieP: new Float32Array(max),
    nb: 0, accu: 0, burstFait: false};
}

const _rpPos = new THREE.Vector3(), _rpDir = new THREE.Vector3(), _rpQ = new THREE.Quaternion();
const _rc1 = new THREE.Color(), _rc2 = new THREE.Color(), _rc3 = new THREE.Color();
function rtSphereRandom(v){
  do{
    v.set(Math.random()*2 - 1, Math.random()*2 - 1, Math.random()*2 - 1);
  } while(v.lengthSq() > 1 || v.lengthSq() < 1e-6);
  return v;
}

function rtEmitIn(sys, n){
  const cfg = sys.obj.userData.part;
  sys.obj.updateWorldMatrix(true, false);
  sys.obj.getWorldQuaternion(_rpQ);
  for(let k = 0; k < n && sys.nb < sys.max; k++){
    const i = sys.nb++;
    if(cfg.shape === 'box'){
      _rpPos.set((Math.random()-0.5) * (cfg.dims[0] || 1),
                 (Math.random()-0.5) * (cfg.dims[1] || 1),
                 (Math.random()-0.5) * (cfg.dims[2] || 1));
      _rpDir.set(0, 1, 0);
    } else if(cfg.shape === 'sphere'){
      rtSphereRandom(_rpDir).normalize();
      _rpPos.copy(_rpDir).multiplyScalar((cfg.radius || 0.4) * Math.cbrt(Math.random()));
    } else if(cfg.shape === 'point'){
      _rpPos.set(0, 0, 0);
      rtSphereRandom(_rpDir).normalize();
    } else {
      const a = THREE.MathUtils.degToRad(Math.max(0, Math.min(89, cfg.angle || 20)));
      const phi = Math.random() * Math.PI * 2;
      const cosMax = Math.cos(a);
      const cosT = cosMax + (1 - cosMax) * Math.random();
      const sinT = Math.sqrt(1 - cosT * cosT);
      _rpDir.set(sinT * Math.cos(phi), cosT, sinT * Math.sin(phi));
      const r = (cfg.radius || 0.4) * Math.sqrt(Math.random());
      _rpPos.set(Math.cos(phi) * r, 0, Math.sin(phi) * r);
    }
    _rpPos.applyMatrix4(sys.obj.matrixWorld);
    _rpDir.applyQuaternion(_rpQ).normalize()
          .multiplyScalar((cfg.speed !== undefined ? cfg.speed : 2.5) * (0.75 + Math.random() * 0.5));
    sys.pos[i*3] = _rpPos.x; sys.pos[i*3+1] = _rpPos.y; sys.pos[i*3+2] = _rpPos.z;
    sys.vel[i*3] = _rpDir.x; sys.vel[i*3+1] = _rpDir.y; sys.vel[i*3+2] = _rpDir.z;
    sys.age[i] = 0;
    sys.vieP[i] = Math.max(0.05, (cfg.vie || 1.3) * (0.75 + Math.random() * 0.5));
  }
}

function rtSystemOf(o){
  let sys = game.particles.find(function(s){ return s.obj === o; });
  if(!sys && o.getComponent && o.getComponent('Particles')){
    if(!o.userData.part) o.userData.part = JSON.parse(JSON.stringify(PART_DEFAULT));
    sys = rtCreateSystem(o);
    game.particles.push(sys);
  }
  return sys || null;
}

function rtEmitBurst(o, n){
  if(!o || !o.getComponent || !o.getComponent('Particles')) return;
  const sys = rtSystemOf(o);
  if(sys) rtEmitIn(sys, n || o.userData.part.amount || 40);
}

function rtUpdateParticles(dt){
  for(let i = game.particles.length - 1; i >= 0; i--){
    if(!isSceneObject(game.particles[i].obj)){
      const s = game.particles[i];
      if(s.objet3d.parent) s.objet3d.parent.remove(s.objet3d);
      s.geo.dispose();
      s.objet3d.material.dispose();
      game.particles.splice(i, 1);
    }
  }
  // liveNodes et pas activeNodes : un émetteur décoché cesse d'émettre (test cfg.active
  // plus bas) mais ses particules en vol doivent finir leur course. Même choix que
  // updateParticles() côté éditeur.
  Registry.liveNodes('Particles').forEach(function(o){
    const sys = rtSystemOf(o);
    if(!sys) return;
    const cfg = o.userData.part;
    if(dt > 0 && o.visible && cfg.active !== false){
      if(cfg.mode === 'burst'){
        if(!sys.burstFait){ sys.burstFait = true; rtEmitIn(sys, cfg.amount || 40); }
      } else {
        sys.accu += (cfg.rate || 25) * dt;
        const n = Math.floor(sys.accu);
        if(n > 0){ sys.accu -= n; rtEmitIn(sys, n); }
      }
    }
    // vieillissement + suppression
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
    const g = cfg.gravity || 0;
    _rc1.set(cfg.colorStart || '#ffb347');
    _rc2.set(cfg.colorEnd || '#ff4422');
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
      _rc3.copy(_rc1).lerp(_rc2, a);
      aCo[i*3] = _rc3.r; aCo[i*3+1] = _rc3.g; aCo[i*3+2] = _rc3.b;
    }
    sys.geo.instanceCount = sys.nb;
    // Même règle que l'éditeur (markParticlesUploaded, js/particles.js) : seule la partie vivante
    // part au GPU, et rien quand le système est vide (revue du 2026-09-29, § 5.11).
    const nbVivant = sys.nb || 0;
    if(nbVivant || sys._nbEnvoye){
      sys._nbEnvoye = nbVivant;
      ['aPos', 'aSize', 'aOpacity', 'aColor'].forEach(function(k){
        const attr = sys.geo.attributes[k];
        if(!attr) return;
        if(typeof attr.clearUpdateRanges === 'function'){
          attr.clearUpdateRanges();
          if(nbVivant) attr.addUpdateRange(0, nbVivant * attr.itemSize);
        }
        attr.needsUpdate = true;
      });
    }
  });
}

// ---------- audio ----------
const listenerAudio = new THREE.AudioListener();
function resumeAudio(){
  if(listenerAudio.context.state === 'suspended') listenerAudio.context.resume();
}
addEventListener('pointerdown', resumeAudio);
addEventListener('keydown', resumeAudio);

// Les bus de mixage — la MÊME construction que l'éditeur (js/audio-bus.js), avec les volumes réglés
// dans le projet. Créés au premier besoin, pas au chargement du fichier : le runtime ne lit rien d'un
// autre module au premier niveau (règle 3, docs/ARCHITECTURE.md). Jamais réinitialisés en cours de
// partie : une musique coupée par un script le reste d'une scène à l'autre.
let rtMix = null;
function rtAudioMix(){
  if(!rtMix) rtMix = createAudioBuses(listenerAudio.context, listenerAudio.getInput(), DS.audioBuses);
  return rtMix;
}

const _rtSynthApis = new WeakMap();
function rtSynthApiOf(o){
  let s = _rtSynthApis.get(o);
  if(!s){
    s = makeSynthApi(function(){ resumeAudio(); return listenerAudio.context; },
      function(){ return game.objects; }, o, function(m){ console.warn('[runtime] ' + m); },
      function(){ return rtAudioMix().node('sfx'); });
    _rtSynthApis.set(o, s);
  }
  return s;
}

// Miroir exact de pointerRayOf (js/scripts.js).
function rtPointerRay(cam){
  if(!cam || !cam.isCamera) return null;
  cam.updateMatrixWorld();
  const origin = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
  const target = new THREE.Vector3(mouseGame.x, mouseGame.y, 0.5).unproject(cam);
  const direction = target.sub(origin).normalize();
  if(cam.isOrthographicCamera){
    origin.set(mouseGame.x, mouseGame.y, -1).unproject(cam);
    direction.set(0, 0, -1).transformDirection(cam.matrixWorld);
  }
  return {origin: {x: origin.x, y: origin.y, z: origin.z}, direction: {x: direction.x, y: direction.y, z: direction.z}};
}

function rtPlaySound(nameAsset, volume, bus){
  const id = Object.keys(assetsById).find(function(k){
    return isPlayableAudio(assetsById[k]) && assetsById[k].name === nameAsset;
  });
  if(!id || !assetsById[id].buffer){
    console.warn('[runtime] api.playSound : « ' + nameAsset + ' » introuvable');
    return null;
  }
  resumeAudio();
  const son = new THREE.Audio(listenerAudio);
  son.setBuffer(assetsById[id].buffer);
  son.setVolume(volume !== undefined ? volume : 1);
  rtAudioMix().route(son, bus || 'sfx');
  son.play();
  game.ponctuels = game.ponctuels.filter(function(s){ return s.isPlaying; });
  game.ponctuels.push(son);
  return son;
}

function sourceAudioOf(obj){
  const s = game.sounds.find(function(x){ return x.obj === obj; });
  return s ? s.son : null;
}

function stopAudioScene(){
  game.sounds.forEach(function(s){
    try{ if(s.son.isPlaying) s.son.stop(); } catch(e){}
    if(s.son.parent) s.son.parent.remove(s.son);
  });
  game.sounds = [];
  game.ponctuels.forEach(function(son){
    try{ if(son.isPlaying) son.stop(); } catch(e){}
  });
  game.ponctuels = [];
}

function startAudioScene(){
  // Miroir de startAudioGame() (js/audio.js) : porteurs d'un composant SourceAudio.
  Registry.activeNodes('AudioSource').forEach(function(o){
    const ua = o.userData.audio;
    if(!ua || !ua.asset) return;
    const a = assetsById[ua.asset];
    // Un son absent le DIT, comme dans l'éditeur : il se taisait ici sans trace.
    if(!a || !a.buffer){ console.warn('[runtime] audio : son introuvable pour « ' + o.name + ' »'); return; }
    // La MÊME fonction que l'éditeur (js/audio-bus.js), pas un miroir.
    const son = createSourceSound(THREE, listenerAudio, ua, a.buffer, rtAudioMix(), setFalloffAudio,
      function(m){ console.warn('[runtime] ' + m); });
    o.add(son);
    game.sounds.push({obj:o, son:son});
  });
}

// ---------- entrées ----------
const keys = new Set();
let keysPrev = new Set();

// ---------- La SOURIS (api.mouse, api.click, api.clickHeld) ----------
// Un moteur de jeu dont les scripts ne peuvent pas lire la souris ne sait pas faire la moitié des
// jeux : viser, poser, glisser, choisir une colonne. Le navigateur a les événements depuis
// toujours, rien ne les exposait — le même défaut que le reste de ce dépôt, en plus large.
//
// La position est rendue en coordonnées NORMALISÉES (-1 à +1, origine au centre, y vers le haut),
// pas en pixels : c'est ce dont on a besoin pour viser, et c'est la seule forme qui ne change pas
// quand la fenêtre change de taille. Les pixels restent disponibles pour qui en veut.
const mouseGame = {x: 0, y: 0, px: 0, py: 0, dans: false, buttons: new Set()};
let buttonsPrev = new Set();

function updateMouseFrom(e, target){
  const r = target.getBoundingClientRect();
  if(!r.width || !r.height) return;
  mouseGame.px = e.clientX - r.left;
  mouseGame.py = e.clientY - r.top;
  mouseGame.x = (mouseGame.px / r.width) * 2 - 1;
  mouseGame.y = -((mouseGame.py / r.height) * 2 - 1);
  mouseGame.dans = mouseGame.px >= 0 && mouseGame.py >= 0
                && mouseGame.px <= r.width && mouseGame.py <= r.height;
}
// Miroir de js/scripts.js. La cible est la toile du jeu : les coordonnees doivent lui etre
// relatives, sinon un jeu affiche dans un cadre pointe a cote sans que rien ne le dise.
addEventListener('pointermove', function(e){ updateMouseFrom(e, renderer.domElement); });
// Miroir de js/scripts.js : un tap sans glisser n'émet que pointerdown.
addEventListener('pointerdown', function(e){ updateMouseFrom(e, renderer.domElement); mouseGame.buttons.add(e.button); });
addEventListener('pointerup',   function(e){ mouseGame.buttons.delete(e.button); });
addEventListener('blur', function(){ mouseGame.buttons.clear(); });

// ---------- La SOURIS RELATIVE et la CAPTURE DU POINTEUR (api.mouseDelta, api.lockMouse) ----------
// Une vue à la première personne ne se pilote PAS avec la position du pointeur. Deux raisons
// mesurées en écrivant un FPS (jeux/NeonBreach) :
//   · sans capture, le pointeur bute sur le bord de la fenêtre au bout d'un quart de tour, et la
//     vue se bloque net ;
//   · sous capture, la position ne bouge PLUS DU TOUT — le curseur est retiré de l'écran. La
//     seule mesure qui continue d'arriver est le DÉPLACEMENT relatif de l'image.
// Le navigateur a `movementX`/`movementY` et l'API de capture depuis toujours ; rien ne les
// exposait, exactement comme la souris elle-même avant la v0.68.0. Sans ces trois entrées, ce
// moteur ne peut pas faire un seul jeu à la première personne.
//
// Miroir de l'autre moteur, comme le bloc de souris ci-dessus, et gardé par le même test
// (test/souris-script.test.mjs).
const mouseLook = {dx: 0, dy: 0, wanted: false};

function canvasGame(){
  return renderer.domElement;
}

// Les deltas s'ACCUMULENT sur l'image. Plusieurs pointermove arrivent entre deux rendus : ne
// garder que le dernier jetterait la moitié du mouvement dès que l'image tombe à 30/s, et la
// visée deviendrait plus lente quand le jeu rame — l'inverse de ce qu'on veut.
//
// DEUX FILTRES, sans lesquels la caméra « se retourne » toute seule :
//   - hors capture, rien ne s'accumule : sinon le trajet du curseur jusqu'au clic de capture
//     arrivait d'un bloc à la première image capturée ;
//   - un pic isolé est jeté. Chrome sous Windows émet par moments, en capture, un movementX de
//     plusieurs centaines de pixels qui ne correspond à aucun geste (bug connu du navigateur).
//     Aucune main ne fait 400 px entre deux événements pointermove.
const MOUSE_SPIKE_PX = 400;
addEventListener('pointermove', function(e){
  if(!pointerLockedGame()) return;
  if(Math.abs(e.movementX || 0) > MOUSE_SPIKE_PX || Math.abs(e.movementY || 0) > MOUSE_SPIKE_PX) return;
  mouseLook.dx += e.movementX || 0;
  mouseLook.dy += e.movementY || 0;
});

// LA CAPTURE NE S'OBTIENT QUE DANS UN GESTE UTILISATEUR. `requestPointerLock()` appelé depuis la
// boucle de rendu est refusé par le navigateur, et refusé SANS BRUIT : une promesse rejetée que
// personne ne lit. Le script déclare donc son INTENTION (api.lockMouse(true)) et c'est le
// prochain clic qui la réalise. Échap rend la main au joueur ; l'intention restant posée, le clic
// suivant reprend la capture — le cycle de tous les jeux du genre.
addEventListener('pointerdown', function(){
  if(!mouseLook.wanted || pointerLockedGame()) return;
  const c = canvasGame();
  if(!c || !c.requestPointerLock) return;
  // Mouvement brut (sans l'accélération du système) quand le navigateur le permet : c'est aussi
  // ce qui supprime l'essentiel des pics parasites. Repli sur la capture simple sinon.
  let p = null;
  try{ p = c.requestPointerLock({unadjustedMovement: true}); } catch(e){ p = null; }
  if(p && typeof p.catch === 'function') p.catch(function(){ try{ c.requestPointerLock(); } catch(e){ /* refusée */ } });
});

// La capture est COMPARÉE à notre toile, pas testée en booléen : une capture posée ailleurs dans
// la page ne doit pas se lire comme « le jeu tient la souris ».
function pointerLockedGame(){
  return !!(document.pointerLockElement && document.pointerLockElement === canvasGame());
}

// Miroir de scripts.js (normalizeKey) : une lettre change de casse dans `KeyboardEvent.key`
// pendant qu'un modificateur (Maj = sprint, typiquement) est tenu, et disparaît donc d'une table
// d'actions configurée en minuscules seules — voir le commentaire complet dans scripts.js.
function normalizeKeyRt(k){ return (typeof k === 'string' && k.length === 1) ? k.toLowerCase() : k; }
// LE JEU PREND LE FOCUS CLAVIER. Intégré dans une page (iframe du catalogue, d'itch.io…), un
// jeu ne reçoit AUCUNE touche tant que son cadre n'a pas le focus — et un script qui fait
// preventDefault() sur mousedown (courant : éviter la sélection de texte) empêche le clic de le
// lui donner. Mesuré : dans la page catalogue, les contrôles ne répondaient pas, alors que le
// même jeu ouvert dans son propre onglet marchait. On le prend donc au chargement et à chaque
// pression, en phase de capture, avant tout script de jeu.
try{ window.focus(); }catch(e){ /* navigateur qui refuse : le clic suivant réessaiera */ }
addEventListener('pointerdown', function(){ try{ window.focus(); }catch(e){ /* sans effet */ } }, true);
addEventListener('keydown', function(e){ keys.add(normalizeKeyRt(e.key)); });
addEventListener('keyup', function(e){ keys.delete(normalizeKeyRt(e.key)); });
addEventListener('blur', function(){ keys.clear(); });
// LE REPLI DOIT SUIVRE INPUTS_DEFAULT (js/scripts.js), manette comprise : un projet
// enregistre AVANT que la table d'entrees existe passe par ici, et il doit se jouer a la
// manette comme un projet neuf. Deux tables qui divergent, c'est un jeu qui repond a la
// manette dans l'editeur et pas une fois publie.
const INPUTS = DS.inputs || {
  actions:{advance:['z','w','ArrowUp','pad:12'], back:['s','ArrowDown','pad:13'],
           left:['q','a','ArrowLeft','pad:14'], right:['d','ArrowRight','pad:15'],
           jump:[' ','pad:0'], interact:['e','pad:2']},
  axes:{horizontal:['left','right','pad:axis0'], vertical:['back','advance','pad:axis1-']}
};
function actionActive(name){
  const t = INPUTS.actions[name];
  return !!(t && (keys.has('steam:' + name) || t.some(function(k){ return keys.has(k); })));   // steam:<action> = Steam Input
}

// ---------- assets ----------
const assetsById = {};   // id → {kind, name, texture | template | arbre}

// ---------- PONT VERS LES FICHIERS DE COMPOSANTS PARTAGES ----------
// CE FICHIER EST ENVELOPPE DANS UNE IIFE. Tout ce qu'il declare — `assetsById`,
// `rtSetTextureDirect` — est donc PRIVE. Or les composants (js/components/*.js) sont des
// scripts SEPARES, partages avec l'editeur, et leur branche « je tourne dans le jeu publie »
// est gardee par `typeof assetsById !== 'undefined'` ou `typeof rtSetTextureDirect ===
// 'function'`. Dans leur portee, ces noms n'ont JAMAIS existe : la garde etait toujours
// fausse, la branche jamais executee, et personne ne le voyait — un profil de post-traitement
// introuvable, une texture directe perdue, sans une seule erreur.
//
// Les exposer explicitement ici est le contrat : ce que les composants ont le droit d'appeler
// depuis l'exterieur de l'IIFE est ecrit noir sur blanc, en un seul endroit.
//
// La liste vient du test moteur/test/pont-runtime-composants.test.mjs, qui relit les fichiers
// partages et refuse toute garde `typeof` portant sur un nom prive d'ici. Sept branches
// etaient mortes, pas une : la rugosite d'un materiau repartait a sa valeur par defaut, les
// scripts et les sons ne se rebranchaient pas, le tri des calques 2D lisait null, et le
// Registry ne filtrait plus sur l'appartenance a la scene.
globalThis.assetsById = assetsById;
globalThis.rtAssetById = rtAssetById;
// Des references DIRECTES : ces sept noms sont des declarations (hoistees) ou des `const`
// deja evaluees, jamais reassignees. Pas d'enveloppe — une enveloppe cacherait l'appel reel
// aux tests qui relisent la source pour verifier que la boucle appelle bien runScripts.
globalThis.rtSetTextureDirect = rtSetTextureDirect;
globalThis.roughnessRuntime = roughnessRuntime;
globalThis.sourceAudioOf = sourceAudioOf;
globalThis.runScripts = runScripts;
globalThis.rtLayers2d = rtLayers2d;
globalThis.isSceneObject = isSceneObject;
globalThis.game = game;

// RÉESSAYÉ, et le statut est LU. Avant, `r.blob()` était pris même sur un 429 : le corps de la
// réponse d'erreur partait au décodeur d'image, qui échouait, et la texture manquait sans un mot
// (BUGS_MOTEUR n° 19). Un `data:` ne passe pas par le réseau : un seul essai lui suffit.
function b64InBlob(entry){
  const src = entry && entry.b64;
  const once = function(){
    return fetch(src).then(function(r){
      if(!r.ok){
        throw Object.assign(new Error('fichier « ' + ((entry && entry.name) || '?') + ' » illisible (HTTP '
          + r.status + ')'), {status: r.status,
          retryAfter: r.headers && r.headers.get ? r.headers.get('retry-after') : null});
      }
      return r.blob();
    });
  };
  return withRetry(once, {attempts: (typeof src === 'string' && src.indexOf('data:') === 0) ? 1 : RETRY_ATTEMPTS});
}

// La texture de REMPLACEMENT d'une image qui n'a pas pu être chargée : un damier magenta, pour
// que la tuile ou le sprite se voie au lieu de disparaître (convention Unity).
function placeholderTextureRuntime(){
  const t = new THREE.DataTexture(checkerPixels(16, 4), 16, 16, THREE.RGBAFormat);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}
// Les textures manquantes, dites à l'écran — une seule ligne, tenue à jour.
const missingTexturesRuntime = [];
function warnMissingTexture(name, err){
  missingTexturesRuntime.push(name);
  console.error('[runtime] texture « ' + name + ' » non chargée — damier à la place :', err);
  showError('Texture(s) non chargée(s), remplacée(s) par un damier : '
    + missingTexturesRuntime.map(function(n){ return '« ' + n + ' »'; }).join(', '));
}

// Paramètres d'import des assets (panneau Projet de l'éditeur) : rejoués ici à
// l'identique pour que le build normalise et échantillonne comme l'éditeur.
const IMPORT_MODEL_DEFAULT = Object.assign({unites:'auto', scale:1, centrer:true, setGround:true},
                                           MODEL_IMPORT_DEFAULT);
const IMPORT_TEXTURE_DEFAULT = {type:'color', spaceColor:'auto', sizeMax:0,
                               mipmaps:true, repetition:'repeter', tuilage:[1, 1],
                               filtrage:'lineaire', anisotropy:1, invertY:'auto'};
const UNITS_METER = {m:1, cm:0.01, mm:0.001, in:0.0254, ft:0.3048};

// Unité d'un FBX (miroir de js/assets.js) : FBXLoader ignore
// GlobalSettings.UnitScaleFactor, qui vaut « centimètres par unité du fichier ».
function indexBytes(bytes, motif, start){
  const m = [];
  for(let i = 0; i < motif.length; i++) m.push(motif.charCodeAt(i));
  const end = bytes.length - m.length;
  for(let i = Math.max(0, start || 0); i <= end; i++){
    let ok = true;
    for(let j = 0; j < m.length; j++){
      if(bytes[i + j] !== m[j]){ ok = false; break; }
    }
    if(ok) return i;
  }
  return -1;
}

function valueAfterNameFbx(bytes, start){
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = start;
  for(let k = 0; k < 6 && p + 9 <= bytes.length; k++){
    const type = bytes[p];
    if(type === 0x53 || type === 0x52){
      p += 5 + view.getUint32(p + 1, true);
      continue;
    }
    if(type === 0x44) return view.getFloat64(p + 1, true);
    if(type === 0x46) return view.getFloat32(p + 1, true);
    if(type === 0x49) return view.getInt32(p + 1, true);
    return null;
  }
  return null;
}

function unitFbx(bytes){
  const gs = indexBytes(bytes, 'GlobalSettings', 0);
  const defs = gs === -1 ? -1 : indexBytes(bytes, 'Definitions', gs);
  const i = indexBytes(bytes, 'UnitScaleFactor', gs === -1 ? 0 : gs);
  if(i === -1 || (defs !== -1 && i > defs)) return null;
  const apres = i + 'UnitScaleFactor'.length;
  let f = valueAfterNameFbx(bytes, apres);
  if(f === null){
    const txt = new TextDecoder('latin1').decode(bytes.subarray(apres, apres + 120));
    const m = txt.match(/^"?\s*,\s*"[^"]*"\s*,\s*"[^"]*"\s*,\s*"[^"]*"\s*,\s*(-?[\d.eE+]+)/);
    if(m) f = parseFloat(m[1]);
  }
  if(!(f > 0) || !isFinite(f)) return null;
  return f / 100;
}

// `unite` = mètres par unité du fichier, détecté au même endroit que dans l'éditeur
function normalizeModel(root, params, unite){
  const p = Object.assign({}, IMPORT_MODEL_DEFAULT, params || {});
  // Hiérarchie et géométrie AVANT tout le reste, et avec le MÊME code que l'éditeur
  // (js/model-import.js) : rien de tout ça n'est dans le fichier de projet, seuls les réglages
  // y sont. Si les deux côtés ne rejouaient pas le même algorithme, un modèle déplié dans
  // l'éditeur arriverait sans son uv1 dans le jeu — donc avec une lightmap plaquée au hasard.
  applyModelHierarchy(root, p, root.animations || []);
  // Onglet Animation : Import Animation et réduction de clés, par le même code que l'éditeur.
  root.animations = applyAnimationImport(root.animations || [], p);
  const geo = applyModelGeometry(root, p);
  geo.warnings.forEach(function(w){ console.warn('[import] ' + w); });
  root.traverse(function(o){
    if(o.isMesh){ o.castShadow = true; o.receiveShadow = true; }
  });
  const u = (p.unites === 'auto') ? (unite > 0 ? unite : 1) : (UNITS_METER[p.unites] || 1);
  // Miroir de js/import-settings.js : soit le facteur est cuit dans la géométrie (l'échelle des
  // objets de la scène vaut alors 1, et c'est ce que le fichier de scène a enregistré), soit il
  // reste sur l'échelle de la racine. Se tromper de voie ici, c'est un jeu à l'échelle 1/100.
  const factor = u * (p.scale > 0 ? p.scale : 1);
  bakeScaleModel(root, p.convertUnits ? factor : 1);
  if(!p.convertUnits) root.scale.multiplyScalar(factor);
  const box = new THREE.Box3().setFromObject(root);
  if(p.centrer){
    const center = new THREE.Vector3(); box.getCenter(center);
    root.position.x -= center.x;
    root.position.z -= center.z;
  }
  if(p.setGround) root.position.y -= box.min.y;
}

// réduit l'image envoyée au GPU si elle dépass la taille max (miroir de js/import-settings.js)
function shrinkImageRuntime(img, max){
  const cote = Math.max(img.width, img.height);
  if(!max || !cote || cote <= max) return img;
  const f = max / cote;
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(img.width * f));
  cv.height = Math.max(1, Math.round(img.height * f));
  const cx = cv.getContext('2d');
  cx.imageSmoothingEnabled = true;
  cx.imageSmoothingQuality = 'high';
  cx.drawImage(img, 0, 0, cv.width, cv.height);
  return cv;
}

let warnedAnisotropyRt = false;

function configureTextureRuntime(tex, params){
  const p = Object.assign({}, IMPORT_TEXTURE_DEFAULT, params || {});
  const wraps = {repeter:THREE.RepeatWrapping, bloquer:THREE.ClampToEdgeWrapping,
                 miroir:THREE.MirroredRepeatWrapping};
  tex.wrapS = tex.wrapT = wraps[p.repetition] || THREE.RepeatWrapping;
  tex.repeat.set(p.tuilage[0], p.tuilage[1]);
  if(tex.image && tex.image.width) tex.image = shrinkImageRuntime(tex.image, p.sizeMax | 0);
  const mip = p.mipmaps !== false;
  tex.generateMipmaps = mip;
  if(p.filtrage === 'near'){
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = mip ? THREE.NearestMipmapNearestFilter : THREE.NearestFilter;
  } else {
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  }
  // « auto » suit l'usage et le pipeline, EXACTEMENT comme dans l'éditeur
  // (js/import-settings.js:spaceColorTexture) : le jeu publié doit normaliser une
  // texture comme la vue d'édition, sinon on livre autre chose que ce qu'on a vu.
  // Depuis r152 la sortie est en sRGB par défaut, donc « auto » sur une texture de
  // COULEUR donne sRGB ; les textures de DONNÉES (normale, rugosité, métal, occlusion)
  // restent linéaires — leurs octets sont des nombres, pas des couleurs.
  const outputSrgb = (renderer.outputColorSpace === THREE.SRGBColorSpace);
  tex.colorSpace = (p.spaceColor === 'srgb') ? THREE.SRGBColorSpace
    : (p.spaceColor === 'lineaire') ? THREE.LinearSRGBColorSpace
    : ((outputSrgb && p.type === 'color') ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace);
  // Miroir de anisotropyMax() (js/import-settings.js) : WebGPURenderer n'a pas de
  // `capabilities`, il expose getMaxAnisotropy() directement.
  let maxA = 1;
  try {
    maxA = (typeof renderer.getMaxAnisotropy === 'function'
      ? renderer.getMaxAnisotropy() : renderer.capabilities.getMaxAnisotropy()) || 1;
  } catch(e){
    if(!warnedAnisotropyRt){
      warnedAnisotropyRt = true;
      console.warn('Anisotropie maximale inconnue, plafonnée à 1 —', e && e.message ? e.message : e);
    }
  }
  tex.anisotropy = Math.max(1, Math.min(maxA, p.anisotropy || 1));
  // « auto » = le défaut du chargeur, comme dans l'éditeur pour les primitives
  if(p.invertY === 'oui') tex.flipY = true;
  else if(p.invertY === 'non') tex.flipY = false;
  tex.needsUpdate = true;
}

// Emplacements de matériaux d'un modèle : chaque matériau du fichier peut être
// remplacé par un matériau du projet (paramètres d'import, panneau Projet).
function applyMaterialsModelRt(entry){
  // Même sans remplacement, l'onglet Matériaux peut changer ce que porte un emplacement du
  // fichier (Material Creation Mode, sRGB Albedo Colors) : on repasse donc toujours ici.
  const map = (entry.paramsImport && entry.paramsImport.materials) || {};
  if(!entry.matBruts || !entry.template) return;
  const meshes = [];
  entry.template.traverse(function(o){ if(o.isMesh) meshes.push(o); });
  meshes.forEach(function(mesh, i){
    const bruts = entry.matBruts[i];
    if(!bruts || !bruts.length) return;
    const nouveaux = bruts.map(function(mb, k){
      const name = (mb && mb.name) ? mb.name : 'Matériau ' + (k + 1);
      const ma = map[name] ? assetsById[map[name]] : null;
      if(!ma || ma.kind !== 'material') return fileMaterialFor(mb, entry.paramsImport);
      const m = makeMaterialRuntime(ma);
      m.name = name;
      // Plus de duplication uv → uv2 : depuis three r152, l'aoMap lit `uv` comme les
      // autres maps (canal 0 par défaut). Voir ensureUv2 dans js/materials.js.
      return m;
    });
    mesh.material = (bruts.length > 1) ? nouveaux : nouveaux[0];
  });
}

// Annote une erreur de parsing glTF avec les compressions que le FICHIER exige, lues
// dans ses octets. Sans ça, un build exporté sans le bon décodeur perd le modèle en ne
// laissant qu'un avertissement de console — le défaut silencieux type.
// Le module de compression est un fichier À PART (js/asset-compression.js), recopié dans
// le build par js/build.js. Rien ne garantit qu'il soit là : un build old, une page
// bricolée à la main, une balise oubliée — c'est exactement ce qui venait d'arriver, les
// quatre balises manquaient dans editor.html ET jeu-preview.html.
// L'éditeur se gardait déjà (assets.js : compressionBindable) ; le runtime, non.
function compressionAvailable(){
  return typeof compressionsOfModel === 'function';
}

function errorCompression(err, name, content){
  const e = (err instanceof Error) ? err : new Error(String(err && err.message || err));
  // Garde indispensable ICI, parce qu'on est dans le chemin d'ERREUR : une ReferenceError
  // levée pendant le diagnostic remplacerait l'erreur d'origine par une autre, sans
  // rapport. Un catch qui jette est pire que pas de catch.
  if(compressionAvailable()){
    try { e.compressions = compressionsOfModel(name, content); } catch(x){ /* diagnostic seulement */ }
  }
  return e;
}

async function loadAssets(){
  const das = D.assets || [];
  let n = 0;
  for(const da of das){
    n++;
    progress('Chargement des assets… ' + n + '/' + das.length + ' (' + da.name + ')');
    try{
      if(da.kind === 'texture'){
        let url = null, tex = null;
        try {
          const blob = await b64InBlob(da.files[0]);
          url = URL.createObjectURL(blob);
          tex = await new Promise(function(res, rej){
            new THREE.TextureLoader().load(url, res, undefined, rej);
          });
        } catch(errTex){
          // L'ASSET RESTE dans la table, avec un damier : sans lui, `api.create`, les sprites et
          // les tilemaps qui le citent tombaient sur null, et la tilemap restait `_dirty` pour
          // toujours en attendant une image qui ne viendrait pas (BUGS_MOTEUR n° 19).
          warnMissingTexture(da.name, errTex);
          assetsById[da.id] = {kind:'texture', name:da.name, texture:placeholderTextureRuntime(),
                               url:null, paramsImport:da.paramsImport || null, unloaded:true,
                               dimensionsSource:[16, 16]};
          continue;
        }
        configureTextureRuntime(tex, da.paramsImport);
        // `url` est conservée pour l'interface de jeu : un élément d'UI est du
        // DOM, il lui faut une URL d'image, pas une THREE.Texture.
        assetsById[da.id] = {kind:'texture', name:da.name, texture:tex, url:url,
                              paramsImport:da.paramsImport || null};
      }
      else if(da.kind === 'model'){
        const files = [];
        for(const fe of da.files){
          files.push({name:fe.name, blob:await b64InBlob(fe)});
        }
        const blobs = {};
        files.forEach(function(f){ blobs[f.name] = URL.createObjectURL(f.blob); });
        const manager = new THREE.LoadingManager();
        manager.setURLModifier(function(url){
          const nameF = decodeURIComponent(url.replace(/^.*[\\/]/, '').split('?')[0]);
          return blobs[nameF] || url;
        });
        // Miroir exact de js/assets.js : mêmes décodeurs, même fichier
        // (js/asset-compression.js, recopié dans le build par js/build.js).
        if(compressionAvailable()) shareBlobs(blobs);
        const loaderGltf = function(){
          const l = new THREE.GLTFLoader(manager);
          // Sans les décodeurs, un glTF NON compressé se charge très bien : on ne refuse
          // que ce qui en a réellement besoin, et l'échec est nommé plus bas.
          if(compressionAvailable()) bindDecoders(l, renderer);
          return l;
        };
        const principal = files.find(function(f){ return /\.(glb|gltf|fbx)$/i.test(f.name); });
        let root;
        let unite = 1;                       // glTF : mètres par spec
        if(/\.fbx$/i.test(principal.name)){
          const buf = await principal.blob.arrayBuffer();
          const u = unitFbx(new Uint8Array(buf));
          unite = (u === null) ? 0.01 : u;   // sans info : centimètres (défaut Maya)
          root = new THREE.FBXLoader(manager).parse(buf, '');
        } else if(/\.glb$/i.test(principal.name)){
          const buf = await principal.blob.arrayBuffer();
          const g = await new Promise(function(res, rej){
            loaderGltf().parse(buf, '', res, function(err){
              rej(errorCompression(err, principal.name, buf));
            });
          });
          root = g.scene;
          root.animations = g.animations || [];   // les clips ne sont pas sur .scene
        } else {
          const txt = await principal.blob.text();
          const g = await new Promise(function(res, rej){
            loaderGltf().parse(txt, '', res, function(err){
              rej(errorCompression(err, principal.name, txt));
            });
          });
          root = g.scene;
          root.animations = g.animations || [];
        }
        // APRÈS normalizeModel, pas avant : les réglages de hiérarchie trient et replient
        // l'arbre, donc changent l'ordre de parcours — l'index d'un emplacement ne veut rien
        // dire tant que l'arbre n'a pas sa forme définitive.
        normalizeModel(root, da.paramsImport, unite);
        // matériaux du fichier, indexés dans l'ordre de parcours : base des
        // emplacements remplaçables par un matériau du projet
        const matBruts = [];
        root.traverse(function(o){
          if(o.isMesh) matBruts.push(Array.isArray(o.material)
            ? o.material.slice() : (o.material ? [o.material] : []));
        });
        assetsById[da.id] = {kind:'model', name:da.name, template:root,
                              matBruts:matBruts, paramsImport:da.paramsImport || null,
                              markers:da.markers || null};
        // Les clips du modèle (onglet Animation) : chacun est exposé comme un asset
        // `animation`, exactement comme dans l'éditeur (`clipAssetOfModel`, js/anim-asset.js).
        // Un export d'avant la v0.159 n'a pas de `clips` : ses assets autonomes sont dans la
        // liste, et restent la seule source.
        const clipsModel = (da.paramsImport && da.paramsImport.importAnimation !== false
          && Array.isArray(da.paramsImport.clips)) ? da.paramsImport.clips : [];
        clipsModel.forEach(function(c){
          if(c && c.id && !assetsById[c.id]) assetsById[c.id] = clipAssetOfModel(da.id, c, '');
        });
      }
      else if(da.kind === 'prefab'){
        assetsById[da.id] = {kind:'prefab', name:da.name, tree:da.tree || []};
      }
      else if(da.kind === 'material'){
        // `id` recopié dans l'entrée : `applyMaterialRuntime` en marque l'objet
        // (userData.materialId), comme l'éditeur — c'est la clé de regroupement des
        // instances (js/render-perf.js). La table est indexée PAR id, mais les valeurs ne le
        // portaient pas : `a.id` y valait undefined.
        assetsById[da.id] = {id:da.id, kind:'material', name:da.name, props:da.props || {},
          shaderId:da.shaderId || null, valuesParams:da.valuesParams || {}};
      }
      else if(da.kind === 'graphShader'){
        // `properties` (le blackboard) fait partie du shader autant que ses nœuds : sans lui,
        // un materiau du jeu exporté ne retrouve pas les propriétés qu'il surcharge.
        assetsById[da.id] = {kind:'graphShader', name:da.name, target:da.target || 'lit',
          properties:da.properties || [],
          nodes:da.nodes || [], links:da.links || [], outputs:da.outputs || {}};
      }
      else if(da.kind === 'audio'){
        const blob = await b64InBlob(da.files[0]);
        const buf = await blob.arrayBuffer();
        const buffer = await new Promise(function(res, rej){
          listenerAudio.context.decodeAudioData(buf, res, rej);
        });
        assetsById[da.id] = {kind:'audio', name:da.name, buffer:buffer};
      }
      // Un bruitage se CALCULE depuis sa recette, par le même js/chip-synth.js que l'éditeur : le
      // build n'embarque aucun octet audio pour lui, et le joueur entend ce que l'auteur a réglé.
      else if(da.kind === 'sfx'){
        assetsById[da.id] = {kind:'sfx', name:da.name, recipe:da.recipe || {},
                             buffer:sfxBuffer(listenerAudio.context, da.recipe || {})};
      }
      else if(da.kind === 'musicLoop'){
        assetsById[da.id] = {kind:'musicLoop', name:da.name, recipe:da.recipe || {},
                             buffer:loopBuffer(listenerAudio.context, da.recipe || {})};
      }
      else if(da.kind === 'documentUI'){
        assetsById[da.id] = {kind:'documentUI', name:da.name, html:da.html || ''};
      }
      else if(da.kind === 'sheetStyle'){
        assetsById[da.id] = {kind:'sheetStyle', name:da.name, css:da.css || ''};
      }
      else if(da.kind === 'animator'){
        assetsById[da.id] = {kind:'animator', name:da.name, machine:da.machine || {}};
      }
      else if(da.kind === 'animation'){
        assetsById[da.id] = Object.assign({kind:'animation', name:da.name}, da.anim || {});
      }
      else if(da.kind === 'sprite'){
        assetsById[da.id] = Object.assign({kind:'sprite', name:da.name}, da.sprite || {});
      }
      // LA PALETTE D'UNE TILEMAP. Sans cette branche, `paletteOfTilemap` ne trouvait rien dans le
      // jeu publié : la map ne dessinait AUCUNE tuile, et `collidingBands`, privé des réglages
      // par tuile, rendait tout solide — les pics et la déco devenaient des murs. Dans l'éditeur
      // tout était juste, le défaut n'existait qu'au ▶ Jouer (mesuré en montant jeux/MossyRun).
      else if(da.kind === 'tilePalette'){
        const p = da.palette || {};
        assetsById[da.id] = {kind:'tilePalette', name:da.name,
          palette: {cellSize: p.cellSize || 0.5, tiles: (p.tiles || []).map(function(t){
            return {name: t.name || 'Tuile', spriteId: t.spriteId || null,
                    autotile: !!t.autotile, blob: !!t.blob, collision: t.collision || 'none',
                    region: Math.max(0, Math.floor(Number(t.region) || 0))};
          })}};
      }
      // Les profils de post-traitement : sans cette branche, PostVolume.profile ne trouvait
      // rien dans le jeu publié (assetsById vide de ce genre) et AUCUN profil ne s appliquait.
      else if(da.kind === 'postProfile'){
        assetsById[da.id] = {kind:'postProfile', name:da.name,
                             effects: ensurePostProfileDefaults(da.effects)};
      }
      // LES ASSETS SCRIPT ENTRENT DANS LA TABLE. Le commentaire d'avant disait vrai à l'époque
      // (« ils ne servent qu'à l'édition ») : chaque composant Script portait une COPIE du code,
      // donc la scène publiée se suffisait. Depuis que le composant ne porte plus que `scriptId`,
      // le jeu publié doit résoudre la référence comme l'éditeur — même format des deux côtés,
      // et pas de code inline recréé au build.
      else if(da.kind === 'script'){
        assetsById[da.id] = {kind:'script', name:da.name, code:da.code || ''};
      }
    } catch(err){
      console.warn('[runtime] asset « ' + da.name + ' » ignoré :', err);
      // Un décodeur missing fait disparaître un modèle entier : ça ne peut pas rester
      // dans la console. On le dit à l'écran, en nommant le fichier à embarquer.
      if(!compressionAvailable()){
        // Le module absent est une cause à part entière, et la plus probable quand TOUS
        // les modèles compressés échouent d'un coup. Le dire, plutôt que de laisser
        // croire à un fichier corrompu.
        showError('« ' + da.name + ' » n’a pas pu être chargé, et asset-compression.js '
          + 'n’est pas dans ce build : un modèle Draco, meshopt ou KTX2 ne peut pas être lu.');
      } else {
        const missing = decodersMissing(err && err.compressions);
        if(missing.length) showError('« ' + da.name + ' » : ' + messageDecodersMissing(missing));
      }
    }
  }
  // emplacements de matériaux des modèles : après les assets matériaux, et avant les
  // templates de prefabs / les scènes qui clonent les modèles
  Object.keys(assetsById).forEach(function(id){
    const a = assetsById[id];
    if(a.kind === 'model') applyMaterialsModelRt(a);
  });
  // templates de prefabs (reconstruits après les modèles qu'ils peuvent référencer)
  Object.keys(assetsById).forEach(function(id){
    const a = assetsById[id];
    if(a.kind === 'prefab'){
      const rec = buildList(a.tree);
      a.template = rec.racines[0] || new THREE.Object3D();
    }
  });
}

// ---------- construction des objets ----------
const PALETTE_DEFAULT = 0x888888;

// L'affichage d'un objet, lu et ecrit correctement meme s'il est regroupe dans un lot
// d'instances. Miroir exact des deux helpers de js/events.js.
function rtVisible(o){
  return (typeof visibleIntent === 'function') ? visibleIntent(o) : (o.visible !== false);
}
function rtSetVisible(o, v){
  if(typeof setVisibleIntent === 'function') setVisibleIntent(o, v); else o.visible = v;
}

function makePrimitive(geoName){
  // LA TABLE DES FORMES EST PARTAGÉE AVEC L'ÉDITEUR (js/primitive-geometry.js). Elle était
  // recopiée ici mot pour mot : deux tables finissent par diverger, et l'écart entre la vue
  // d'édition et le jeu publié ne se voit qu'après l'export.
  //
  // La géométrie rendue est l'instance PARTAGÉE de la forme. C'est aussi ce qui rend le
  // regroupement en instances franc dans un build : `signatureGeometry` (js/render-perf.js)
  // comparait par paramètres précisément parce que le runtime reconstruisait une géométrie par
  // objet, et que l'identité ne trouvait donc jamais deux objets ensemble.
  const geo = primitiveGeometry(THREE, geoName || 'cube', buildExtraPrimitive)
    || primitiveGeometry(THREE, 'cube', buildExtraPrimitive);
  const mat = new THREE.MeshStandardMaterial({color:PALETTE_DEFAULT, roughness:0.55, metalness:0.1});
  if(geoName === 'plane') mat.side = THREE.DoubleSide;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

function textureMaterialRuntime(id, p){
  if(!id || !assetsById[id] || !assetsById[id].texture) return null;
  const tex = assetsById[id].texture.clone();
  tex.needsUpdate = true;
  tex.repeat.set((p.tiling || [1,1])[0], (p.tiling || [1,1])[1]);
  tex.offset.set((p.offset || [0,0])[0], (p.offset || [0,0])[1]);
  return tex;
}

// masque combiné (R métal · G AO · A lissage) repacké vers la convention three/glTF
const cacheCombinedRt = new Map();
// Miroir exact de textureCombined (js/materials.js). L'empaquetage NATIF est l'ORM de
// glTF : la texture part alors au GPU telle quelle, sans passe CPU ni copie. Seul un
// masque déclaré 'unity' (mask map HDRP) est converti.
//
// Ce test n'est pas une optimisation : sans lui, le jeu publié convertirait un masque
// ORM comme s'il était en HDRP — occlusion et métal permutés, rugosité inversée — et
// rendrait donc autrement que la vue d'édition. Un écart de ce genre ne se voit qu'à
// l'export, c'est-à-dire au pire moment.
function textureCombinedRuntime(id, p){
  if(!id || !assetsById[id] || !assetsById[id].texture) return null;
  if((p.combinePacking || 'orm') !== 'unity') return textureMaterialRuntime(id, p);
  let cv = cacheCombinedRt.get(id);
  if(!cv){
    const img = assetsById[id].texture.image;
    if(!img || !img.width) return null;
    cv = document.createElement('canvas');
    cv.width = img.width;
    cv.height = img.height;
    const cx = cv.getContext('2d');
    cx.drawImage(img, 0, 0);
    const data = cx.getImageData(0, 0, cv.width, cv.height);
    const px = data.data;
    for(let i = 0; i < px.length; i += 4){
      const metal = px[i], ao = px[i+1], smoothness = px[i+3];
      px[i] = ao;
      px[i+1] = 255 - smoothness;
      px[i+2] = metal;
      px[i+3] = 255;
    }
    cx.putImageData(data, 0, 0);
    cacheCombinedRt.set(id, cv);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set((p.tiling || [1,1])[0], (p.tiling || [1,1])[1]);
  tex.offset.set((p.offset || [0,0])[0], (p.offset || [0,0])[1]);
  return tex;
}

// L'éditeur travaille en LISSAGE (smoothness), three en rugosité : miroir exact de
// roughnessFromSmoothing dans js/materials.js. `rugosite` est
// encore lue pour un build produit depuis un projet non versionné (cf. migration 7 → 8).
function roughnessRuntime(p){
  if(p.smoothness !== undefined)
    return Math.round(Math.max(0, Math.min(1, 1 - p.smoothness)) * 1e6) / 1e6;
  if(p.roughness !== undefined) return p.roughness;
  return 0.55;
}
// Le paramètre MULTIPLIE la map. three le fait déjà pour le métal et l'émissif ; pour le
// lissage il multiplie deux rugosités, alors qu'il faut multiplier deux lissages :
//   rugosité_final = 1 − (1 − texel.g) × (1 − roughness)
// Miroir PARTIEL de multiplyInSmoothing() dans js/materials.js — et le « partiel » est tout
// le sujet de ces lignes.
//
// L'éditeur porte la formule en DEUX exemplaires, un par pipeline : en nœud TSL pour
// WebGPURenderer, et en patch GLSL (`onBeforeCompile`) pour le renderer WebGL classique de
// js/assets.js, celui des vignettes du panneau Projet.
//
// LE RUNTIME N'A QUE LE PREMIER, et c'est définitif : son unique renderer est le
// WebGPURenderer construit plus haut dans ce fichier, un jeu publié n'a pas de vignettes, et
// WebGPURenderer convertit tout matériau en NodeMaterial QUEL QUE SOIT son backend — y
// compris son repli WebGL2. `onBeforeCompile` n'y est donc jamais appelé : il n'y a aucun
// GLSL à patcher.
//
// La branche GLSL a vécu ici jusqu'à la v0.149.1, recopiée de materials.js SANS son
// consommateur — et son nom de hook y était fautif (`onBeforeCompiled`, avec un d). Personne
// ne pouvait le voir : du code injoignable ne casse jamais, et la revue qui l'a trouvé l'a
// d'abord pris pour un bug de rendu. C'est la forme de défaut qu'une recopie de miroir
// produit le plus facilement ; `test/surface-three-webgpu.test.mjs` garde désormais le nom
// des hooks eux-mêmes.
let warnedNodeSmoothingRt = false;

// Miroir de nodeRoughnessFromSmoothings() dans js/materials.js.
function nodeRoughnessFromSmoothingsRt(){
  const {float, materialReference} = TSL;
  const smoothingMap = float(1).sub(materialReference('roughnessMap', 'texture').g);
  const smoothingParam = float(1).sub(materialReference('roughness', 'float'));
  return float(1).sub(smoothingMap.mul(smoothingParam));
}

function multiplyInSmoothingRuntime(m){
  if(!m.roughnessMap) return;
  if(typeof TSL !== 'undefined' && TSL && TSL.materialReference){
    m.roughnessNode = nodeRoughnessFromSmoothingsRt();
  } else if(typeof renderer !== 'undefined' && renderer && renderer.isWebGPURenderer
            && !warnedNodeSmoothingRt){
    warnedNodeSmoothingRt = true;
    console.warn('Multiplication du lissage non appliquée : TSL indisponible alors que le '
      + 'rendu passe par le système de nœuds.');
  }
}

// Matériaux de plugin déjà signalés, pour ne le dire qu'une fois chacun.
const materialsPluginReportedRt = {};

function makeMaterialRuntime(a){
  const p = a.props;
  // Un matériau de plugin RANGÉ DANS LE PROJET est rejoué par js/plugin-host.js : on le fabrique
  // comme l'éditeur (makeMaterialPlugin, js/plugins.js), avec le même `ctx`.
  const mp = PluginHost.materialOf(p.materialPlugin);
  if(mp){
    try{
      const m = mp.make(p, {THREE: THREE, TSL: (typeof TSL !== 'undefined') ? TSL : null,
                            texture: function(key){ return textureMaterialRuntime(p[key], p); },
                            props: p});
      if(m && m.isMaterial) return m;
      console.error('matériau « ' + p.materialPlugin + ' » : make() doit renvoyer un matériau three');
    } catch(e){
      console.error('matériau « ' + p.materialPlugin + ' » : make() a levé — ' + e.message);
    }
  }
  // Sinon (plugin resté dans le navigateur, hors du projet), le lecteur N'A PAS SON CODE : ceux-ci vivent dans le localStorage de
  // l'éditeur, pas dans le projet publié. Un matériau piloté par un plugin
  // (Editor.enregistrerMateriau) est donc rendu ici par le chemin natif ci-dessous, avec
  // un aspect qui n'est pas celui de la vue d'édition.
  //
  // C'est exactement la forme de divergence éditeur/runtime qui a déjà coûté deux jours au
  // project en passant inaperçue. Elle reste, faute d'un medium d'embarquer le code du plugin
  // dans un build — mais elle ne sera pas SILENCIEUSE : la console du jeu la nomme.
  if(p.materialPlugin && !materialsPluginReportedRt[p.materialPlugin]){
    materialsPluginReportedRt[p.materialPlugin] = true;
    console.warn('Matériau « ' + p.materialPlugin + ' » : shader fourni par un plugin de '
      + 'l\'éditeur non rangé dans le projet (Plugins → « Dans le projet »), absent du jeu publié. Les objets qui le portent sont rendus avec le '
      + 'matériau standard — leur aspect diffère de la vue d\'édition.');
  }
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color(p.color || '#8899aa'),
    roughness: roughnessRuntime(p),
    metalness: (p.metal !== undefined) ? p.metal : 0.1,
    emissive: new THREE.Color(p.emissive || '#000000'),
    opacity: (p.opacity !== undefined) ? p.opacity : 1,
    transparent: (p.opacity !== undefined) && p.opacity < 1,
    side: p.doubleSided ? THREE.DoubleSide : THREE.FrontSide
  });
  m.map = textureMaterialRuntime(p.texAsset, p);
  const nrm = textureMaterialRuntime(p.normalAsset, p);
  // Y négatif = convention DirectX, comme dans l'éditeur (js/materials.js) : le jeu
  // publié doit éclairer le relief exactement comme la vue d'édition.
  if(nrm){
    const ni = p.normalIntensity || 1;
    m.normalMap = nrm;
    m.normalScale.set(ni, p.normalDirectX ? -ni : ni);
  }
  // Carte de hauteur : copie conforme d'applyHeight (js/materials.js), biais
  // compris — le gris medium doit valoir « surface d'origine » ici comme là-bas.
  const top = textureMaterialRuntime(p.heightAsset, p);
  if(top){
    const k = (p.heightIntensity !== undefined) ? p.heightIntensity : 1;
    if(p.heightMode === 'move'){
      m.displacementMap = top;
      m.displacementScale = k;
      m.displacementBias = -k / 2;
    } else {
      m.bumpMap = top;
      m.bumpScale = k;
    }
  }
  // Éclairage précalculé : copie conforme d'applyLightmap (js/materials.js), `channel`
  // compris. C'est lui qui fait échantillonner `uv1` ; l'oublier ici donnerait un jeu
  // publié éclairé autrement que la vue d'édition, sans la moindre erreur.
  // HDR : un asset marqué `rgbm` se décode UNE fois vers une texture demi-flottante linéaire
  // (js/lightmap-rgbm.js, partagé avec l'éditeur). Le chemin des images de couleur lui
  // appliquerait une correction de gamma en trop, et l'éclairage sortirait délavé.
  const aRgbm = p.lightmapAsset && assetsById[p.lightmapAsset];
  if(aRgbm && aRgbm.rgbm){
    const texHdr = textureLightmapRgbm(aRgbm);
    if(texHdr){
      m.lightMap = texHdr;
      m.lightMapIntensity = (p.lightmapIntensity !== undefined) ? p.lightmapIntensity : 1;
      texHdr.channel = (p.lightmapUv === 0) ? 0 : 1;
    }
  }
  const lm = (aRgbm && aRgbm.rgbm) ? null : textureMaterialRuntime(p.lightmapAsset, p);
  if(lm){
    m.lightMap = lm;
    m.lightMapIntensity = (p.lightmapIntensity !== undefined) ? p.lightmapIntensity : 1;
    lm.channel = (p.lightmapUv === 0) ? 0 : 1;
    // Une lightmap ne se carrelle jamais : elle décrit l'éclairage d'UNE surface, à sa
    // place exacte. Le reste des cartes hérite du tuilage du matériau, pas celle-ci.
    lm.repeat.set(1, 1);
    lm.offset.set(0, 0);
  }
  const comb = textureCombinedRuntime(p.combineAsset, p);
  if(comb){
    m.roughnessMap = comb; m.metalnessMap = comb; m.aoMap = comb;
    m.aoMapIntensity = (p.aoIntensity !== undefined) ? p.aoIntensity : 1;
  } else {
    m.roughnessMap = textureMaterialRuntime(p.roughnessAsset, p);
    m.metalnessMap = textureMaterialRuntime(p.metalAsset, p);
    const ao = textureMaterialRuntime(p.aoAsset, p);
    if(ao){ m.aoMap = ao; m.aoMapIntensity = (p.aoIntensity !== undefined) ? p.aoIntensity : 1; }
  }
  m.emissiveMap = textureMaterialRuntime(p.emissiveAsset, p);
  multiplyInSmoothingRuntime(m);
  return m;
}

// `a` (materiau) : soit PBR classique (shaderId absent, makeMaterialRuntime), soit
// une instance d'un grapheShader (a.shaderId → assetsById, a.valeursParams override ses
// nœuds param.*) construite par buildMaterialFromGraph — fichier RÉELLEMENT PARTAGÉ
// js/shader-graph.js (embarqué par build.js), pas de seconde implémentation à maintenir ici.
// Pose une texture d'asset directement sur la map d'un maillage (miroir de
// applyTextureRaw, js/assets.js). Rend false pour une texture de données ou absente.
function rtSetTextureDirect(o, ref){
  const ta = ref ? assetsById[ref] : null;
  if(!ta || !ta.texture || !o.material) return false;
  // le type de la texture décide de la map visée (miroir de js/assets.js)
  const key = (ta.paramsImport && ta.paramsImport.type === 'normal') ? 'normalMap' : 'map';
  o.material[key] = ta.texture;
  if(key === 'map') o.material.color.set(0xffffff);
  o.material.needsUpdate = true;
  return true;
}

function applyMaterialRuntime(a, root){
  const shaderDef = a.shaderId ? assetsById[a.shaderId] : null;
  function set(x){
    x.material = shaderDef
      ? buildMaterialFromGraph(shaderDef, textureMaterialRuntime, a.valuesParams || {})
      : makeMaterialRuntime(a);
  }
  if(root.isMesh) set(root);
  else root.traverse(function(x){ if(x.isMesh) set(x); });
  // MÊME MARQUE QUE L'ÉDITEUR (applyMaterialOn, js/materials.js) : l'objet dit de quel asset
  // vient son apparence. Ce n'est pas décoratif — `signatureMaterial` (js/render-perf.js) s'en
  // sert pour décider quels objets peuvent partager un lot d'instances. Sans elle, le jeu
  // publié tombait sur la comparaison par contenu, aveugle aux graphes de shader, et fondait
  // des matériaux différents dans un seul InstancedMesh.
  root.userData.materialId = a.id;
}

// sous-scènes : pile anti-cycle et profondeur max (miroir de js/subscenes.js)
const rtStackSS = [];
const RT_SS_MAX = 5;

function rtPopulateSubScene(o, ss){
  const name = ((ss && ss.scene) || '').trim();
  if(!name) return;
  if(rtStackSS.indexOf(name) !== -1 || rtStackSS.length >= RT_SS_MAX){
    console.warn('[runtime] sous-scène « ' + name +' » : cycle ou profondeur max');
    return;
  }
  const sc = D.scenes.find(function(s){ return s.name === name; });
  if(!sc || !sc.data){
    console.warn('[runtime] sous-scène « ' + name + ' » introuvable');
    return;
  }
  // buildList peuple déjà les sous-scènes imbriquées (voir sa fin) :
  // la pile reste en place le temps de la construction complète
  rtStackSS.push(name);
  const rec = buildList(sc.data.objects || []);
  rtStackSS.pop();
  // numérotation stable identique à l'éditeur, pour apply les overrides
  let n = 0;
  const byIndex = {};
  (sc.data.objects || []).forEach(function(d){
    const x = rec.byId[d.id];
    if(x){ byIndex[n] = x; x.userData.ssInstance = n; n++; }
  });
  rec.racines.forEach(function(r){ o.add(r); });
  Object.keys(rec.byId).forEach(function(k){ addSceneObject(rec.byId[k]); });
  const ovs = (ss && ss.overrides) || {};
  Object.keys(ovs).forEach(function(key){
    const x = byIndex[key];
    if(!x) return;
    const ov = ovs[key];
    if(ov.pos) x.position.fromArray(ov.pos);
    if(ov.quat) x.quaternion.fromArray(ov.quat);
    if(ov.ech) x.scale.fromArray(ov.ech);
    if(ov.visible !== undefined) x.visible = ov.visible;
  });
}

// ---------------------------------------------------------------------------
// Les PORTEURS du jeu publié (voir NodeShells, js/component.js).
//
// Le jeu n'embarque AUCUN repère d'édition : pas de sphère émissive pour une lumière, pas de
// boîtier pour une caméra, pas d'octaèdre filaire pour un nœud d'organisation. Un Object3D nu
// suffit, et c'est le composant qui y accroche sa THREE.Light ou sa THREE.Camera — exactement
// ce que faisait la cascade de buildList, en double avec celle de l'éditeur.
//
// Seuls trois types réclament ici un porteur : les autres se contentent du Group par défaut.
NodeShells.register('Mesh', function(d){ return makePrimitive(d.geo || 'cube'); });
NodeShells.register('Terrain', function(d){
  // Les hauteurs et le coloriage par altitude sont rejoués à la construction : la géométrie
  // d'un terrain EST ses données.
  return d ? rtMakeTerrain(d) : null;
});
NodeShells.register('Model', function(d, ctx){
  const a = d.assetId ? ((ctx && ctx.assetsById) || {})[d.assetId] : null;
  if(!a || !a.template) return null;
  const o = rtCloneModel(a.template);
  // Ses nœuds deviennent des objets de scène, comme dans l'éditeur (js/model-nodes.js) ;
  // `buildList` les range dans sa table et y repose leurs overrides.
  exposeModelNodes(o, a.paramsImport || {}, {node: rtExposeModelNode});
  // externalClips (SkinnedMeshRenderer) ne se repose PAS ici : ce composant vit sur le
  // DESCENDANT skinné du clone, un entry séparé de celui de cette racine Model (constat 3 du
  // plan animator) — au moment où ce shell tourne, ce descendant n'a pas encore été reconstruit
  // par `buildList`. Voir la passe de second temps à la fin de `buildList`, miroir EXACT de
  // celle de `rebuildTree` (js/serialization.js).
  return o;
});

// Les emplacements de matériaux remplacés sur un maillage d'instance — miroir de
// `applyMaterialSlots` (js/materials.js). Un emplacement sans override garde le matériau du
// modèle, déjà posé par le clone.
function rtApplyMaterialSlots(mesh){
  if(!mesh || !mesh.isMesh) return;
  const base = Array.isArray(mesh.material) ? mesh.material.slice() : [mesh.material];
  const slots = mesh.userData.materialSlots || [];
  const out = base.map(function(m, k){
    const a = slots[k] ? assetsById[slots[k]] : null;
    if(!a || a.kind !== 'material') return m;
    const shaderDef = a.shaderId ? assetsById[a.shaderId] : null;
    return shaderDef ? buildMaterialFromGraph(shaderDef, textureMaterialRuntime, a.valuesParams || {})
      : makeMaterialRuntime(a);
  });
  mesh.material = (out.length > 1) ? out : out[0];
}

// Un nœud de modèle exposé, côté jeu : le mixin, et le collider de « Generate Colliders » —
// miroir de `exposeModelInstance` (js/objects.js).
function rtExposeModelNode(n){
  applyNodeMixin(n);
  if(n.userData.collider && !n.getComponent('Collider')) n.addComponent('Collider', n.userData.collider);
}

// reconstruit une liste d'objets sérialisés (scène ou template de prefab)
function buildList(list){
  const byId = {};
  const racines = [];
  const subScenes = [];
  (list || []).forEach(function(d){
    // LE NŒUD VIENT DE SES COMPOSANTS, comme dans l'éditeur et par le même code partagé
    // (nodeOfComponents, js/component-migration.js). La cascade sur `d.type` qui vivait ici
    // était le JUMEAU de celle de la sérialisation : la même connaissance en deux copies, dont
    // une seule était tenue à jour — c'est ainsi qu'une caméra 2D revenait en perspective d'un
    // côté et pas de l'autre.
    // L'entrée fantôme d'avant la v0.159 — miroir de `rebuildTree` (js/serialization.js).
    if(isLegacySkinnedEntry(d)) return;
    const fait = nodeOfComponents(d, {assetsById: assetsById, entry: d});
    let o = fait.object3d;
    if(fait.missing){
      console.warn('« ' + d.name + ' » : le composant « ' + fait.missing
        + ' » n\'a pas pu construire son objet (asset absent) — nœud conservé en substitut');
    }
    // Un type d'objet de plugin — miroir de `rebuildTree` (js/serialization.js).
    const tp = d.type ? PluginHost.typeOf(d.type) : null;
    if(tp){
      try{
        o = tp.make();
        o.userData.type = d.type;
        applyNodeMixin(o);
        if(tp.restore) tp.restore(o, d.plug);
      } catch(e){
        console.error('plugin « ' + tp.plugin + ' » : reconstruction de « ' + d.name
          + ' » impossible — ' + e.message);
      }
    }
    if(!o) return;
    o.name = d.name;
    o.position.fromArray(d.pos);
    o.quaternion.fromArray(d.quat);
    o.scale.fromArray(d.ech);
    // LES MÊMES CHAMPS DE NŒUD QUE rebuildTree (js/serialization.js), et pas un de moins.
    // Ces trois lignes manquaient jusqu'en v0.149.2, chacune avec le même effet : un réglage
    // que l'utilisateur voit tenir dans l'éditeur, et qui disparaît une fois le jeu publié.
    //   · ombreProjetee / ombreRecue — un objet décoché « projette une ombre » en projetait
    //     quand même, parce que la construction les met à `true` par défaut (normalizeModel,
    //     makePrimitive) et que rien ne repassait derrière avec la valeur du fichier.
    //   · detail — le LOD. js/render-perf.js EST embarqué dans le build et lit
    //     `userData.detail` (collectDetail/updateDetail), mais le sac n'était jamais reposé :
    //     le système tournait à vide, sur zéro objet, à chaque image.
    o.castShadow = (d.ombreProjetee !== undefined) ? d.ombreProjetee : true;
    o.receiveShadow = (d.ombreRecue !== undefined) ? d.ombreRecue : true;
    if(d.detail) o.userData.detail = JSON.parse(JSON.stringify(d.detail));
    if(d.visible === false) o.visible = false;
    // Même règle que l'éditeur (js/serialization.js, rebuildTree) : un sac que le fichier NOMME
    // déjà par un composant ne doit pas être recopié à plat, sous peine que le jeu publié et
    // l'éditeur ne relisent pas le même projet de la même façon.
    const ignoreSacs = bagsOverriddenBy(d.components);
    if(d.phys && !ignoreSacs.phys) o.userData.phys = d.phys;
    if(d.game) o.userData.game = d.game;
    if(d.collider && !ignoreSacs.collider) o.userData.collider = d.collider;
    if(!ignoreSacs.scripts){
      if(d.scripts) o.userData.scripts = d.scripts;
      else if(d.script) o.userData.scripts = [d.script];   // compat projets pre-multiscripts
    }
    if(d.audio && !ignoreSacs.audio) o.userData.audio = d.audio;
    if(d.animator && !ignoreSacs.animator) o.userData.animator = d.animator;
    if(d.events && !ignoreSacs.events) o.userData.events = d.events;
    if(d.uiDoc && !ignoreSacs.uiDoc) o.userData.uiDoc = d.uiDoc;
    if(d.sprite2d && !ignoreSacs.sprite2d){ o.userData.sprite2d = d.sprite2d; rebuildMeshSprite(o); }
    if(d.animSprite && !ignoreSacs.animSprite) o.userData.animSprite = d.animSprite;
    if(d.body2d && !ignoreSacs.body2d) o.userData.body2d = d.body2d;
    if(d.collider2d && !ignoreSacs.collider2d) o.userData.collider2d = d.collider2d;
    if(d.controller2d && !ignoreSacs.controller2d) o.userData.controller2d = d.controller2d;
    // AVANT d'appliquer le matériau, exactement comme rebuildTree (js/serialization.js) :
    // c'est le matériau qui branchera la lightmap sur `uv1`, et `uv1` doit déjà être celui de
    // l'atlas, pas celui rapporté par le fichier de modèle.
    //
    // Manquait jusqu'en v0.149.3, et la cause n'était pas un oubli de ligne mais une
    // DÉPENDANCE : reapplyAtlasLightmap() ne vivait que dans js/lightmap-bake.js, qui importe
    // douze modules d'éditeur et ne peut donc pas être embarqué. Le champ partait dans chaque
    // fichier de projet et n'était applicable que côté éditeur — les objets partageant un
    // atlas cuit recevaient l'éclairage d'un autre objet, sans la moindre erreur.
    if(d.lightmapAtlas){
      o.userData.lightmapAtlas = JSON.parse(JSON.stringify(d.lightmapAtlas));
      reapplyAtlasLightmap(o);
    }
    if(d.materialId && assetsById[d.materialId] && assetsById[d.materialId].kind === 'material'){
      applyMaterialRuntime(assetsById[d.materialId], o);
      // Le matériau vient de REMPLACER o.material. Un `texAsset` enregistré ne peut signifier
      // qu'une chose — la texture a été posée APRÈS le matériau (applyMaterialOn efface
      // `texAsset`, js/materials.js) — donc elle se repose après lui ici aussi. Miroir de
      // js/serialization.js : sans cette reprise le jeu publié perd toutes ses textures.
      rtSetTextureDirect(o, d.texAsset);
    }
    // LE JEU PUBLIÉ PORTE LES MÊMES COMPOSANTS QUE L'ÉDITEUR, et il les pose par le même code
    // partagé : applyNodeMixin donne l'API composant à l'Object3D, applyComponents pose ce que
    // le FICHIER nomme. Avant, c'était syncComponents qui les DEVINAIT d'après `userData.type`
    // et les sacs présents — une table de correspondance de plus à tenir à jour, du même côté
    // que la cascade qu'on vient de retirer.
    //
    // Après cette ligne, `Registry.activeNodes('Physics')` répond ici exactement comme dans
    // l'éditeur — c'est ce qui permet à startPhysics(), rtBakeProbes(), rtUpdateParticles() et
    // evtInit() de découvrir leurs entités par le même chemin.
    //
    // APRÈS les sacs et le matériau, jamais avant : les composants les référencent.
    applyNodeMixin(o);
    applyComponents(o, d.components);
    // LES MIROIRS HISTORIQUES. Les composants Light et Camera rangent leur objet THREE dans
    // `ed(o)` (socle partagé) ; le runtime, lui, les lit dans `userData` — game.cam, le tri des
    // caméras de jeu, le cadrage 2D. Les deux doivent désigner le même objet.
    if(ed(o).light) o.userData.light = ed(o).light;
    if(ed(o).cam) o.userData.cam = ed(o).cam;
    // Le contenu d'une sous-scène est instancié APRÈS le parentage (les transforms doivent être
    // en place) : on note le nœud au passage.
    const ss = o.getComponent && o.getComponent('SubScene');
    if(ss) subScenes.push({obj: o, ss: o.userData.subScene});
    byId[d.id] = o;
    // Les nœuds d'une instance de modèle — miroir de `rebuildTree` : sous l'id qu'ils portaient
    // à l'enregistrement, pour que ce qui les cite les retrouve.
    if(o.getComponent && o.getComponent('Model')){
      const ids = (d.modelNodes && d.modelNodes.ids) || {};
      exposedNodesOf(o).forEach(function(n){
        const key = n.userData.modelNode;
        byId[ids[key] !== undefined ? ids[key] : ('m' + d.id + '/' + key)] = n;
      });
    }
  });
  (list || []).forEach(function(d){
    const o = byId[d.id];
    if(!o) return;
    let p = (d.parent !== null && d.parent !== undefined) ? byId[d.parent] : null;
    // Sous un nœud de modèle (une arme dans la main) : retrouvé par sa clé.
    if(p && d.parentNode) p = modelNodeByKey(p, d.parentNode) || p;
    if(p) p.add(o); else racines.push(o);
  });
  // Les écarts des nœuds de modèle au fichier, une fois l'arbre parenté.
  (list || []).forEach(function(d){
    const o = byId[d.id];
    if(!o || !d.modelNodes) return;
    applyModelOverrides(o, d.modelNodes, function(n, comps){
      applyComponents(n, comps);
      const c = comps.find(function(x){ return x.type === 'SkinnedMeshRenderer'; });
      if(c && c.data && (c.data.externalClips || []).length && typeof reattachAnimationsExternal === 'function'){
        reattachAnimationsExternal(o, c.data.externalClips.map(function(r){
          return {asset:r.assetId, clip:r.sourceClip, name:r.localName};
        }), function(id){ return assetsById[id]; });
      }
    }, rtApplyMaterialSlots);
  });
  // le contenu des sous-scènes vient après le parenting (transforms déjà en place)
  subScenes.forEach(function(e){ rtPopulateSubScene(e.obj, e.ss); });
  // externalClips (SkinnedMeshRenderer) : miroir EXACT de la passe de `rebuildTree`
  // (js/serialization.js, tâche 4.8) — ce composant vit sur le DESCENDANT skinné, un entry
  // séparé de celui de la racine Model qui l'a cloné (constat 3 du plan animator), donc il ne
  // peut être reposé qu'une fois l'arbre ENTIER construit et parenté.
  const entriesById = {};
  (list || []).forEach(function(d){ entriesById[d.id] = d; });
  (list || []).forEach(function(d){
    const c = (d.components || []).find(function(x){ return x.type === 'SkinnedMeshRenderer'; });
    if(!c || !c.data || !(c.data.externalClips || []).length) return;
    let racineEntry = d;
    while(racineEntry.parent !== null && racineEntry.parent !== undefined
          && entriesById[racineEntry.parent]){
      racineEntry = entriesById[racineEntry.parent];
    }
    const racine = byId[racineEntry.id];
    if(!racine) return;
    // Comme côté éditeur : viser le composant via `rtSkinnedMeshRendererOf`, pas
    // `byId[d.id].getComponent(...)` — `SkinnedMeshRenderer` n'a pas de shell propre, donc
    // `byId[d.id]` peut être un simple Group posé par `nodeOfComponents` pour cet entry.
    const compReel = rtSkinnedMeshRendererOf(racine);
    if(!compReel) return;
    compReel.externalClips = c.data.externalClips;
    if(typeof reattachAnimationsExternal === 'function'){
      reattachAnimationsExternal(racine, c.data.externalClips.map(function(r){
        return {asset:r.assetId, clip:r.sourceClip, name:r.localName};
      }), function(id){ return assetsById[id]; });
    }
  });
  return {byId:byId, racines:racines};
}

// ---------- environnement ----------
// Miroir de buildSkyBackground (js/environment.js) : le fond sert à l'affichage ET à la
// cuisson du reflet de ciel, et les deux doivent montrer le même ciel. Ce n'est plus un dôme
// sphérique — `scene.background` est rendu à l'infini derrière tout, donc le ciel ne
// disparaît plus quand la caméra s'éloigne de l'origine.
function rtBuildSkyBackground(env){
  if(env.sky === 'gradient'){
    const cv = document.createElement('canvas');
    cv.width = 16; cv.height = 256;
    const cx = cv.getContext('2d');
    const g = cx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, env.skyTop || '#6ea8dc');
    g.addColorStop(1, env.skyBottom || '#dfe9f2');
    cx.fillStyle = g; cx.fillRect(0, 0, 16, 256);
    const tex = new THREE.CanvasTexture(cv);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    if(THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }
  if(env.sky === 'image' && env.skyAsset && assetsById[env.skyAsset]){
    // CLONE, comme l'éditeur : la cuisson du ciel libère la texture de fond jetable, et
    // libérer la texture d'asset partagée éteindrait le ciel de toute la scène.
    const tex = assetsById[env.skyAsset].texture.clone();
    tex.mapping = THREE.EquirectangularReflectionMapping;
    if(THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }
  return new THREE.Color(env.skyColor || '#9fc4e8');
}

function applyEnvironment(env){
  env = env || {};
  rtEnvCurrent = env;   // relu par rtBakeProbes() pour le repli sur le ciel
  if(game.skyTexture){ if(game.skyTexture.userData.flat) game.skyTexture.userData.flat.dispose(); game.skyTexture.dispose(); game.skyTexture = null; }
  const fond = rtBuildSkyBackground(env);
  game.skyBackground = fond;
  game.scene.background = fond;
  game.skyTexture = (fond && fond.isTexture) ? fond : null;
  game.scene.fog = (env.brouillard !== false)
    ? new THREE.Fog(new THREE.Color(env.brouillardColor || '#cdd9e4'),
        env.brouillardNear || 40, env.brouillardLoin || 90)
    : null;
  game.hemi.intensity = (env.ambiante !== undefined) ? env.ambiante : 0.4;
  game.hemi.color.set(env.ambianteColor || '#bfd4ff'); game.hemi.groundColor.set(env.ambientGroundColor || '#30281e');
  game.sun.intensity = (env.sun !== undefined) ? env.sun : 0.55;
  // game.post n est plus posé ici : rtCurrentPostState() le recalcule CHAQUE image (la
  // caméra bouge, les PostVolume locaux doivent réagir) — voir la section post-traitement.
}

// ---------- physique ----------
const _wp = new THREE.Vector3(), _wq = new THREE.Quaternion(), _ws = new THREE.Vector3();
const _vT = new THREE.Vector3(); const _qParent = new THREE.Quaternion();

function objectAnimated(o){
  return game.tracks.some(function(p){
    if(p.obj === o) return true;
    let ok = false;
    p.obj.traverse(function(x){ if(x === o) ok = true; });
    return ok;
  });
}

// buildRigidBody() vit dans js/rigid-body.js, PARTAGÉ avec l'éditeur : la copie qui
// se trouvait ici a divergé de l'originale (terrain sans échelle ni pose monde, discrimination
// des primitives sur userData.type au lieu du composant Mesh). Voir l'en-tête de ce fichier-là.

// `api.create` n'avait aucun chemin jusqu'ici : tout ce qu'un script engendrait arrivait dans la
// scène SANS body. L'objet ne tombait pas, ne heurtait rien, et `api.setVelocity` ne trouvait
// aucun link à pousser — elle rendait `null`, sans un mot. Mesuré : des cubes tirés qui restent
// plantés à la bouche du canon, alors que leur prefab déclare bien `phys.active`.
//
// Rend le link créé, ou null. Un objet déjà branché ne l'est pas deux fois : deux body pour un
// maillage se repoussent l'un l'autre et l'objet part tout seul.
function rtBindBody(o){
  if(typeof CANNON === 'undefined' || !game.world || !o || !o.userData) return null;
  if(!canHaveRigidBody(o)) return null;
  if(game.links.some(function(l){ return l.obj === o; })) return null;
  if(game.kinematic.some(function(k){ return k.obj === o; })) return null;
  if(objectAnimated(o)){
    const fk = buildRigidBody(o, 0);
    fk.body.type = CANNON.Body.KINEMATIC;
    game.world.addBody(fk.body);
    game.kinematic.push({obj:o, body:fk.body});
    return null;
  }
  const p = o.userData.phys;
  if(!p || !p.active) return null;
  const fab = buildRigidBody(o, Math.max(0, p.masse));
  game.world.addBody(fab.body);
  game.world.addContactMaterial(new CANNON.ContactMaterial(game.matGround, fab.body.material, {
    friction:p.friction, restitution:p.bounce}));
  const link = {obj:o, body:fab.body, offset:fab.offset};
  game.links.push(link);
  return link;
}

// Et le unregister AVEC l'objet. Sans ça, un objet détruit laisse son collider dans le monde :
// rien à l'écran, et tout continue de buter dedans. Dans un jeu où chaque fusion en détruit
// deux, l'arène se remplirait de murs invisibles.
function rtDetachBody(o){
  [game.links, game.kinematic].forEach(function(list){
    for(let i = list.length - 1; i >= 0; i--){
      if(list[i].obj !== o) continue;
      game.world.removeBody(list[i].body);
      list.splice(i, 1);
    }
  });
}

function startPhysics(){
  // LA SEULE PORTE D'ENTRÉE DE CANNON, et c'est ce qui la rend intéressante : les quinze autres
  // références à `CANNON` du runtime sont soit dans ce body, soit dans `buildRigidBody` (appelé
  // d'ici seulement), soit derrière un `if(l)` qui exige un corps physique. Le pas de la boucle est
  // déjà protégé par `if(game.monde)`. Une garde ici suffit donc à rendre `vendor/cannon.js`
  // FACULTATIF dans un jeu publié — 132 Ko qu'un jeu 2D n'a aucune raison de télécharger.
  //
  // Un `return` et pas une erreur : l'absence est un CHOIX de l'exportateur, décidé depuis le contenu
  // de la scène (js/build-trimming.js). Si la scène n'a pas de physique 3D, ne rien faire ici est
  // exactement le bon comportement.
  if(typeof CANNON === 'undefined'){ warnOnceMissing('CANNON', 'vendor/cannon.js'); return; }
  game.world = new CANNON.World();
  game.world.gravity.set(0, -9.82, 0);
  game.world.solver.iterations = 10;
  const matGround = new CANNON.Material('ground');
  // retenu sur `game` : rtBindBody en a besoin bien après la construction de la scène
  game.matGround = matGround;
  // AUCUN sol implicite — miroir de js/physics.js. Le plan infini posé ici à y=0 faisait qu'un
  // jeu publié se comportait autrement que ce que la scène décrit : rien ne montrait ce sol, et
  // pourtant tout s'y arrêtait.

  // Terrains : sols statiques suivant le relief. Découverte par le REGISTRE de composants,
  // comme dans l'éditeur, et construction par l'implémentation partagée — le champ de hauteurs
  // était écrit ici une troisième fois, sans tenir compte de l'échelle ni de la pose monde.
  Registry.activeNodes('Terrain').forEach(function(o){
    if(!CANNON.Heightfield || !o.userData.terr) return;
    const fab = buildRigidBody(o, 0);
    game.world.addBody(fab.body);
    game.world.addContactMaterial(new CANNON.ContactMaterial(matGround, fab.material,
      {friction: 0.6, restitution: 0.1}));
  });

  // UN SEUL chemin de branchement, partagé avec api.create : deux copies de ces quinze lignes,
  // c'est la garantie qu'un jour l'une des deux recevra une correction et pas l'autre.
  // Corps dynamiques : porteurs d'un composant Physics active. Cinématiques : porteurs d'une
  // forme de rendu (Mesh ou modele) que la timeline anime. Exactement les deux ensembles de
  // startSimulation() côté éditeur, lus de la même façon — rtBindBody tranche entre les
  // deux, et reste LE seul chemin de branchement, partagé avec api.create.
  Registry.activeNodes('Physics')
    .concat(Registry.activeNodes('Mesh').concat(Registry.activeNodes('Model')).filter(objectAnimated))
    .forEach(function(o){ rtBindBody(o); });
}

// La saisie WebXR (js/xr-runtime.js) : un corps tenu en main devient CINÉMATIQUE — la main le
// pousse, il pousse le reste — puis redevient dynamique au lâcher, avec la vitesse de la main.
function rtXrGrabBody(o, grabbed, velocity){
  if(typeof CANNON === 'undefined') return;
  const l = game.links.find(function(x){ return x.obj === o; });
  if(!l) return;
  if(grabbed){
    l.xrType = l.body.type;
    l.body.type = CANNON.Body.KINEMATIC;
    l.body.velocity.set(0, 0, 0);
    l.body.angularVelocity.set(0, 0, 0);
  } else {
    l.body.type = (l.xrType !== undefined) ? l.xrType : CANNON.Body.DYNAMIC;
    delete l.xrType;
    if(velocity) l.body.velocity.set(velocity.x, velocity.y, velocity.z);
    l.body.wakeUp();
  }
}

// Le corps suit la pose que la main vient d'écrire : applyPhysics recopie ensuite le corps sur
// l'objet, et c'est exactement l'inverse de son calcul (position du corps = objet + décalage).
function rtXrSyncBody(o){
  const l = game.links.find(function(x){ return x.obj === o; });
  if(!l) return;
  o.getWorldPosition(_wp); o.getWorldQuaternion(_wq);
  _vT.copy(l.offset).applyQuaternion(_wq);
  l.body.position.set(_wp.x + _vT.x, _wp.y + _vT.y, _wp.z + _vT.z);
  l.body.quaternion.set(_wq.x, _wq.y, _wq.z, _wq.w);
}

function syncPhysics(){
  game.kinematic.forEach(function(l){
    l.obj.getWorldPosition(_wp); l.obj.getWorldQuaternion(_wq);
    l.body.position.set(_wp.x, _wp.y, _wp.z);
    l.body.quaternion.set(_wq.x, _wq.y, _wq.z, _wq.w);
  });
}

function applyPhysics(){
  game.links.forEach(function(l){
    _wq.set(l.body.quaternion.x, l.body.quaternion.y, l.body.quaternion.z, l.body.quaternion.w);
    _vT.copy(l.offset).applyQuaternion(_wq);
    _wp.set(l.body.position.x - _vT.x, l.body.position.y - _vT.y, l.body.position.z - _vT.z);
    if(l.obj.parent === game.scene){
      l.obj.position.copy(_wp);
      l.obj.quaternion.copy(_wq);
    } else {
      l.obj.position.copy(l.obj.parent.worldToLocal(_wp.clone()));
      l.obj.parent.getWorldQuaternion(_qParent);
      l.obj.quaternion.copy(_qParent.invert().multiply(_wq));
    }
  });
}

// ---------- animation ----------
// L'échantillonnage, l'easing et la décision « une piste additive a-t-elle une base » viennent de
// js/track-sampling.js — le MÊME code que l'éditeur (revue du 2026-09-29, § 1.7).
const _tmpTrack = {vA: new THREE.Vector3(), vB: new THREE.Vector3(),
                   qA: new THREE.Quaternion(), qB: new THREE.Quaternion()};
function applyAnimation(t){
  game.tracks.forEach(function(p){
    const keys = p.keys;
    if(!keys.length) return;
    // La cible est l'OS s'il y en a un, l'objet sinon — miroir de `targetOfTrack`
    // (js/animation.js). Écrire dans `p.obj` sans regarder `p.os` déplaçait le personnage
    // entier là où l'éditeur ne bougeait qu'un os.
    const target = p.os || p.obj;
    // Miroir de js/animation.js. Une piste additive porte un ÉCART, composé par-dessus la pose
    // qu'une animation vient d'écrire. Sans animation en cours sur cet objet, aucune base n'est
    // reposée à chaque image : l'écart s'accumulerait, et l'objet dériverait doucement hors de
    // l'écran sans la moindre erreur. La piste est alors inert — comme dans l'éditeur.
    // Inerte, et surtout pas rabattue sur « remplace » : ses clés sont des ÉCARTS, et les lire
    // comme des poses absolues collerait l'objet près de l'origine. Miroir de l'éditeur.
    //
    // PAR OS, comme l'éditeur : l'animation en cours doit écrire la pose de CETTE cible. Le test
    // « une animation tourne sur l'objet » laissait une clé additive posée sur un os non animé
    // s'accumuler à chaque image : l'os dérivait dans le jeu, jamais dans l'éditeur.
    if(p.additif && !rtClipDrives(p.obj, target)) return;
    applyTrackSample(target, segmentAt(keys, t), p.additif, _tmpTrack);
  });
}

/** L'animation en cours sur `obj` écrit-elle la pose de `target` à cette image ? */
function rtClipDrives(obj, target){
  if(!rtAnimationInProgress(obj)) return false;
  const e = rtAnims.get(obj);
  return additiveHasBase(e.action.getClip ? e.action.getClip() : null, target);
}

/** Une animation de modèle écrit-elle la pose de cet objet, à cette image ? */
function rtAnimationInProgress(obj){
  const e = rtAnims.get(obj);
  return !!(e && e.action && !e.action.paused && e.action.isRunning());
}

// ---------- scripts ----------
// LES ALIAS FRANCAIS ONT DISPARU. L api de script est en anglais, point. Le mecanisme
// d alias existait pour ne casser aucun project deja ecrit ; il n a plus d objet, et sa
// table avait le francais dans ses CLES — donc du francais dans le code, ce que le
// chantier de renommage supprime.
// Miroir de parseExposures (js/components/component-script.js) : lit les lignes
// « @expose name {type} = defaut » en tête d'un script. Le jeu publié n'embarque pas le
// système de composants, mais il reçoit le code ET les valeurs réglées dans l'inspecteur
// (userData.scripts[i].valeurs) — de quoi reconstruire api.expose à l'identique.
function rtParseExposures(source){
  const out = [];
  const lines = (source || '').split('\n');
  for(const line of lines){
    const m = line.match(/@expose\s+(\w+)\s*\{([^}]+)\}(?:\s*=\s*(.+))?/);
    if(!m) continue;
    const type = m[2].trim();
    let defaultValue = null;
    if(m[3] !== undefined){
      const raw = m[3].trim();
      if(type === 'number') defaultValue = Number(raw);
      else if(type === 'boolean') defaultValue = (raw === 'true');
      else defaultValue = raw;
    }
    out.push({name: m[1], type: type, defaultValue: defaultValue});
  }
  return out;
}

// Miroir de resolveValuesExposed (js/scripts.js) : 'node' → objet de la scène par nom,
// 'component:X' → getComponent sur ce noeud (ou sur le noeud nommé), le reste tel quel.
// `api.expose` est reconstruit à CHAQUE IMAGE pour chaque script : il relisait l'en-tête du script
// par expression régulière et cherchait chaque objet cité par `game.objects.find` — 3,6 ms par
// image pour 100 scripts dans 5 000 objets (revue du 2026-09-29, § 5.4). L'en-tête analysé est mis
// en cache par code source, et les objets se trouvent dans un index par nom reconstruit UNE fois
// par image (au premier besoin) : créations, destructions et renommages sont vus à l'image suivante,
// comme avant. L'objet rendu reste neuf à chaque image — un script qui y écrit ne pollue rien.
const _rtExposuresBySource = new Map();
function rtExposuresOf(source){
  let e = _rtExposuresBySource.get(source);
  if(!e){ e = rtParseExposures(source); _rtExposuresBySource.set(source, e); }
  return e;
}
let _rtNameIndex = null, _rtNameIndexTime = -1;
function rtObjectByName(name){
  if(_rtNameIndexTime !== game.time || !_rtNameIndex){
    _rtNameIndex = new Map();
    game.objects.forEach(function(x){ if(!_rtNameIndex.has(x.name)) _rtNameIndex.set(x.name, x); });
    _rtNameIndexTime = game.time;
  }
  return _rtNameIndex.get(name) || null;
}

function rtValuesExposed(o, i){
  const result = {};
  const s = (o.userData.scripts || [])[i];
  if(!s) return result;
  const values = s.values || {};
  rtExposuresOf(rtCodeOfScriptEntry(s)).forEach(function(e){
    const raw = (e.name in values) ? values[e.name] : e.defaultValue;
    if(e.type === 'node'){
      result[e.name] = raw ? rtObjectByName(raw) : null;
    } else if(e.type.indexOf('component:') === 0){
      const typeComponent = e.type.slice('component:'.length);
      const target = raw ? rtObjectByName(raw) : o;
      result[e.name] = (target && target.getComponent) ? target.getComponent(typeComponent) : null;
    } else {
      result[e.name] = raw;
    }
  });
  return result;
}

// ---------- Les temporaires de la surface `api.*` (miroir de js/scripts.js) ----------
//
// Meme raison, meme forme : `api.raycast` allouait un Raycaster, deux Vector3 et un tableau de
// candidats a CHAQUE APPEL, `api.overlapSphere` une Sphere plus une Box3 par objet de la scene.
// Ce sont les fonctions que les scripts appellent dans `update()`. Voir
// docs/REVUE_2026-09-10.md SS 2.4.
const _apiVecA = new THREE.Vector3();
const _apiVecB = new THREE.Vector3();
const _apiBox = new THREE.Box3();
const _apiSphere = new THREE.Sphere();
const _apiRay = new THREE.Raycaster();
const _apiCandidats = [];

// L'OBJET API EST CONSTRUIT UNE FOIS PAR (OBJET, SCRIPT) — miroir de js/scripts.js.
//
// Le litteral ci-dessous porte soixante-douze cles, presque toutes des fonctions anonymes, et il
// etait reconstruit a CHAQUE APPEL : une fois par script actif et par image. Voir
// docs/REVUE_2026-09-10.md SS 2.2.
//
// Seules deux fermetures dependent de l'image (`moveTo`, `patrol`) : elles lisent `frame.dt`.
// Les champs de DONNEES qui changent (`dt`, `dtReal`, `time`, `scene`, `expose`) sont reecrits
// sur l'objet a chaque appel, dans `apiFor`.
const _apiCache = new WeakMap();   // objet → Map(index de script → {api, frame})

function apiFor(o, dt, i){
  // Le dt REEL, meme en pause : c est ce qui permet d animer un menu pendant que le jeu est
  // arrete.
  const dtReel = (game.dtReel === undefined) ? dt : game.dtReel;
  let parIndex = _apiCache.get(o);
  if(!parIndex){ parIndex = new Map(); _apiCache.set(o, parIndex); }
  let e = parIndex.get(i);
  if(!e){
    const frame = { dt: 0 };
    e = { api: buildApi(o, i, frame), frame: frame };
    parIndex.set(i, e);
  }
  const api = e.api;
  e.frame.dt = dt;
  api.dt = dt;
  api.dtReal = dtReel;
  api.time = game.time;
  api.scene = game.scene;
  api.expose = rtValuesExposed(o, i);
  return api;
}

function buildApi(o, i, frame){
  return ({
    expose: null,                              // reecrit par apiFor
    // `node` : alias Unity-like de `me` (api.node.getComponent('Mesh')), présent côté
    // éditeur (scripts.js) depuis toujours mais oublié ici — un script qui l'utilisait
    // marchait dans l'éditeur et plantait dans le build/aperçu sur un « Cannot read
    // properties of undefined ».
    me:o, node:o, dt:0, dtReal:0, time:0, scene:null,
    find:function(name){ return game.objects.find(function(x){ return x.name === name; }) || null; },
    findNode:function(name){ return game.objects.find(function(x){ return x.name === name; }) || null; },
    // LE REGISTRY, pas un balayage de la scène : `nodesByTag` vit dans
    // js/components/component-tag.js, embarqué par le build, et n'interroge que les nœuds
    // réellement étiquetés. Les deux moteurs tenaient ici leur propre `objects.filter(...)` —
    // un parcours de toute la scène par appel, dans une fonction appelée en `update()`.
    // Voir docs/REVUE_2026-09-10.md § 1.6.
    byTag:nodesByTag,
    // `findByTag` manquait ICI et existait dans l'éditeur : un script qui l'appelait
    // tournait sans erreur en édition (il rendait un tableau vide, faute qui se lit comme
    // « aucun ennemi dans la scène ») puis levait un « n'est pas une fonction » dans le jeu
    // publié. Divergence éditeur/jeu du pire genre : elle ne se voit qu'après l'export.
    findByTag:nodesByTag,
    byLayer:function(c){ return game.objects.filter(function(x){ return x.userData.game && sameLayer(x.userData.game.layer, c); }); },
    props:function(target){ const c = target || o; if(!c.userData.game) c.userData.game = {tag:'', layer:'Défaut', props:{}}; return c.userData.game.props; },
    tag:function(target){ const c = target || o; return (c.userData.game && c.userData.game.tag) || ''; },
    key:function(k){ return keys.has(k); },
    mouse:function(){ return {x: mouseGame.x, y: mouseGame.y,
                               px: mouseGame.px, py: mouseGame.py, dans: mouseGame.dans}; },
    click:function(button){ return mouseGame.buttons.has(button === undefined ? 0 : button); },
    clickHeld:function(button){
      const b = (button === undefined) ? 0 : button;
      return mouseGame.buttons.has(b) && !buttonsPrev.has(b);
    },
    mouseDelta: function(){ return {x: mouseLook.dx, y: mouseLook.dy}; },
    lockMouse: function(wanted){
      mouseLook.wanted = (wanted !== false);
      if(!mouseLook.wanted && document.exitPointerLock) document.exitPointerLock();
      return pointerLockedGame();
    },
    mouseLocked: function(){ return pointerLockedGame(); },
    action:actionActive,
    actionPressed:function(name){
      const t = INPUTS.actions[name] || [];
      return t.some(function(k){ return keys.has(k) && !keysPrev.has(k); });
    },
    axis:function(name){
      const p = INPUTS.axes[name];
      if(!p) return 0;
      return combineAxis((actionActive(p[1]) ? 1 : 0) - (actionActive(p[0]) ? 1 : 0), name);
    },
    distance:function(a, b){
      return (a || o).getWorldPosition(_apiVecA).distanceTo((b || o).getWorldPosition(_apiVecB));
    },
    lookAt:function(target){ if(target) o.lookAt(target.getWorldPosition(new THREE.Vector3())); },
    // Miroir de `api.create` (js/scripts.js). Une PLANCHE count comme un asset engendrable : sans
    // ça, un jeu 2D publié ne peut faire apparaître ni projectile, ni ramassage, ni ennemi.
    create:function(nameAsset, position){
      const id = Object.keys(assetsById).find(function(k){
        const a = assetsById[k];
        return a.name === nameAsset
          && (a.kind === 'prefab' || a.kind === 'model' || a.kind === 'sprite');
      });
      if(!id){ console.warn('[runtime] api.create : « ' + nameAsset + ' » introuvable'); return null; }
      const asset = assetsById[id];
      let copie;
      if(asset.kind === 'sprite'){
        copie = new THREE.Group();
        copie.name = asset.name;
        copie.userData.type = 'group';
        copie.userData.sprite2d = {spriteId: id, region: '', layer: 'Jeu', order: 0,
          teinte: '#ffffff', retourneX: false, retourneY: false, sortDepth: false};
        rebuildMeshSprite(copie);
      } else {
        copie = rtCloneModel(asset.template);
        // Un modèle engendré expose ses nœuds comme une instance posée dans l'éditeur.
        if(asset.kind === 'model'){
          exposeModelNodes(copie, asset.paramsImport || {}, {node: rtExposeModelNode});
          // Miroir de `instantiateAsset` (js/assets.js) : l'Animator vide d'un modèle rigué.
          if(wantsAnimator(copie, asset.paramsImport)){
            if(typeof copie.addComponent !== 'function') applyNodeMixin(copie);
            if(!copie.getComponent('AnimatorController')) copie.addComponent('AnimatorController', {assetId: null, target: ''});
          }
        }
      }
      if(position) copie.position.set(position.x || 0, position.y || 0, position.z || 0);
      // À la racine de la scène, comme tout le reste — miroir de l'éditeur.
      game.scene.add(copie);
      copie.traverse(function(x){
        // `_meshSprite` ne survit pas au clone : le recâbler (voir `bindSpriteMesh`).
        if(x.userData.sprite2d) bindSpriteMesh(x);
        if(x.userData.type !== undefined || x.userData.modelNode !== undefined){
          // Un nœud de modèle cloné (instance posée dans un prefab) a perdu son mixin au clonage.
          if(x.userData.modelNode !== undefined && typeof x.addComponent !== 'function') applyNodeMixin(x);
          addSceneObject(x);
        }
      });
      if(copie.userData.type === undefined) addSceneObject(copie);
      // LA PHYSIQUE AUSSI. Un objet engendré sans body ne tombe pas, ne heurte rien, et
      // definirVitesse n'a rien à pousser : c'est le prefab qui dit s'il en veut un.
      copie.traverse(function(x){ rtBindBody(x); });
      return copie;
    },
    animations:function(target){ return rtClips(target || o).map(function(c){ return c.name; }); },
    playAnimation:function(target, name, opts){
      if(typeof target === 'string'){ opts = name; name = target; target = o; }
      return rtPlayAnimation(target || o, name, opts);
    },
    stopAnimation:function(target){ rtStopAnimation(target || o); },
    // WebXR : manettes, tête, session. Même objet que dans l'éditeur (js/scripts.js), où il
    // répond « pas de casque ».
    xr: XRRuntime.api,
    // Miroir de `api.animator` (js/scripts.js). L'OBJET vient du fichier partagé
    // js/animator.js ; seule la façon de retrouver le lecteur est propre au runtime.
    animator:function(target){
      const node = rtHolderAnimator(target || o);
      const l = node ? rtPlayerAnimatorOf(node) : null;
      if(!l){ console.warn('api.animator : cet objet ne porte pas d\'AnimatorController'); return null; }
      return createObjectAnimator(l, l.machine, function(name){
        console.warn('api.animator : « ' + name + ' » n\'est pas un paramètre de cette machine');
      });
    },
    layerAnimation:function(target, name, opts){
      if(typeof target === 'string'){ opts = name; name = target; target = o; }
      return rtLayerAnimation(target || o, name, opts);
    },
    removeLayer:function(target, depuis){
      if(typeof target === 'string'){ depuis = target; target = o; }
      return rtRemoveLayer(target || o, depuis);
    },
    destroy:function(target){ if(target && game.aDestroy.indexOf(target) === -1) game.aDestroy.push(target); },
    // `actifVoulu` comme dans l'éditeur (js/scripts.js) : un objet regroupé dans un
    // InstancedMesh a déjà visible = false, écrire `visible` dessus ne masquerait rien.
    // C'est l'intention que lit updateInstances.
    setActive:function(target, active){
      if(!target) return;
      target.userData.activeVoulu = (active !== false);
      target.visible = (active !== false);
    },
    isActive:function(target){ return isActiveInHierarchy(target || o); },
    // Miroir exact de js/scripts.js : un script écrit dans l'éditeur doit
    // fonctionner tel quel dans le jeu publié. Toute divergence ici se paie en
    // bug qui n'apparaît qu'après publication.
    bounds:function(target){
      const b = _apiBox.setFromObject(target || o);
      if(b.isEmpty()) return null;
      return {
        min:{x:b.min.x, y:b.min.y, z:b.min.z}, max:{x:b.max.x, y:b.max.y, z:b.max.z},
        size:{x:b.max.x - b.min.x, y:b.max.y - b.min.y, z:b.max.z - b.min.z},
        center:{x:(b.min.x + b.max.x)/2, y:(b.min.y + b.max.y)/2, z:(b.min.z + b.max.z)/2}
      };
    },
    onContact:function(tag, fn){ game.contacts.push({obj:o, tag:tag, fn:fn, dedans:new Set()}); },
    moveCharacter:function(options){
      let state = game.persos.get(o);
      if(!state){ state = {}; game.persos.set(o, state); }
      return characterUpdate(this, state, options);
    },
    respawn:function(position){
      const state = game.persos.get(o);
      if(state) characterRespawn(this, state, position);
    },
    bounce:function(force){
      const state = game.persos.get(o);
      if(state) characterBounce(state, force);
    },
    applyForce:function(target, f){
      const l = game.links.find(function(x){ return x.obj === (target || o); });
      if(l) l.body.applyImpulse(new CANNON.Vec3(f.x || 0, f.y || 0, f.z || 0), l.body.position);
    },
    velocity:function(target){
      const l = game.links.find(function(x){ return x.obj === (target || o); });
      return l ? {x:l.body.velocity.x, y:l.body.velocity.y, z:l.body.velocity.z} : null;
    },
    setPosition:function(target, p){
      const c = target || o;
      const l = game.links.find(function(x){ return x.obj === c; });
      if(l){
        l.body.position.set(p.x, p.y, p.z);
        l.body.velocity.set(0, 0, 0);
        l.body.angularVelocity.set(0, 0, 0);
      }
      if(c.parent && c.parent !== game.scene) c.position.copy(c.parent.worldToLocal(new THREE.Vector3(p.x, p.y, p.z)));
      else c.position.set(p.x, p.y, p.z);
      return c;
    },
    setVelocity:function(target, v){
      const l = game.links.find(function(x){ return x.obj === (target || o); });
      if(!l) return null;
      l.body.velocity.set(
        v.x !== undefined ? v.x : l.body.velocity.x,
        v.y !== undefined ? v.y : l.body.velocity.y,
        v.z !== undefined ? v.z : l.body.velocity.z);
      return l.body.velocity;
    },
    // Miroir de js/scripts.js (même calcul, caméra du jeu publié).
    pointerRay:function(){ return rtPointerRay(game.cam); },
    pick:function(filter, distance){
      const r = rtPointerRay(game.cam);
      return r ? this.raycast(r.origin, r.direction, distance || 1000, filter) : null;
    },
    raycast:function(origine, direction, distance, filter){
      game.scene.updateMatrixWorld();
      _apiRay.set(_apiVecA.set(origine.x, origine.y, origine.z),
                  _apiVecB.set(direction.x, direction.y, direction.z).normalize());
      _apiRay.near = 0;
      _apiRay.far = distance || 100;
      // Le filtre est appliqué AVANT l'intersection (voir raycastCandidates, js/raycast-candidates.js).
      raycastCandidates(game.objects, o, filter, rtOwnerOfHit, sameLayer, _apiCandidats);
      const hits = _apiRay.intersectObjects(_apiCandidats, false);
      if(!hits.length) return null;
      return {object:rtOwnerOfHit(hits[0].object), point:hits[0].point, distance:hits[0].distance};
    },
    // Miroir de js/scripts.js. La logique — quelle boîte, et le test de recouvrement — vit dans
    // js/world-2d.js et js/physics-2d.js, partagés : ici il ne reste que l'appel à three.js,
    // qui seul diffère entre les deux moteurs.
    overlaps2d:function(target, autre){
      const b = function(n){
        if(!n) return null;
        const e = new THREE.Box3().setFromObject(n);
        return box2dOf(n, e.isEmpty() ? null : e);
      };
      const A = b(target), B = b(autre || o);
      return !!(A && B && overlap2d(A, B));
    },
    // Miroir de `api.spriteImage` / `api.aim2d` (js/scripts.js). Une planche vue de dessus range
    // ses cases par (direction, état) et aucune animation ne les enchaîne : c'est le jeu qui choisit
    // l'image à chaque pas, et il lui faut donc les deux — lire le regard, poser la case.
    spriteImage:function(target, nameRegion){
      const n = (typeof target === 'string') ? target : null;
      const c = n ? o : (target || o);
      const name = n || nameRegion;
      // Le nom est vérifié ICI, pas laissé au rendu : `regionOfSprite` retombe volontairement sur
      // la première image quand le nom est inconnu, ce qui empêche un sprite de disparaître après
      // un renommage — mais transforme une faute de frappe dans un script en pose figée que rien
      // ne dénonce. Même décision que dans l'éditeur, pour que les deux répondent pareil.
      const d = c && c.userData && c.userData.sprite2d;
      const a = d ? assetsById[d.spriteId] : null;
      if(name && a && !(a.regions || []).some(function(r){ return r && r.name === name; })) return false;
      return updateImageSprite(c, name);
    },
    aim2d:function(target){
      const e = ((target || o).userData || {})._ctrl2d;
      return {x: (e && e.regardX) || 0, y: (e && e.regardY) || 0};
    },
    // Miroir de `api.tileAt` / `api.setTile` / `api.camera2d` (js/scripts.js). La résolution de
    // la case et le réglage de la caméra viennent des modules PARTAGÉS : seule la liste d'objets
    // où chercher est propre à chaque moteur.
    tileAt:function(target, position){
      const t = aimCell2d(THREE, target, position, o, game.objects);
      return t ? cellTilemap(t.map, t.x, t.y) : 0;
    },
    setTile:function(target, position, material){
      const t = aimCell2d(THREE, target, position, o, game.objects);
      if(!t) return false;
      // `setCell` du composant, et pas `setCellTilemap` : c'est lui qui pose `_dirty`, le
      // drapeau que le TilemapSystem consomme. Sans lui, on ouvre une porte qui reste dessinée
      // et qui bloque encore.
      const ok = t.map.setCell(t.x, t.y,
        (material === undefined || material === null) ? 0 : material);
      // Sans reconstruction, on ouvre une porte qui reste dessinée et qui bloque encore.
      return ok;
    },
    camera2d:function(settings){
      return setCamera2d(cameraMain2d(game.objects), settings);
    },
    // Miroir de `api.playSequence` / `api.currentSequence` (js/scripts.js). `playAnimSprite` vient du
    // module partagé js/anim-sprite.js : les deux moteurs ont la même règle du « on ne redémarre
    // pas une suite déjà en cours », qui est ce qui empêche un appel par image de tout figer.
    playSequence:function(target, name, forcer){
      if(typeof target === 'string'){ forcer = name; name = target; target = o; }
      return playAnimSprite(target || o, name, forcer);
    },
    currentSequence:function(target){
      const e = ((target || o).userData || {})._animSprite;
      return (e && e.sequence) || '';
    },
    // LA PAUSE. Sans argument elle se lit, avec un booleen elle s ecrit. Le monde s arrete —
    // physique, animations, particules, ligne de temps recoivent un dt NUL — et les SCRIPTS
    // continuent de tourner : c est la seule forme qui marche, puisque c est un script qui devra
    // la lever. api.dt vaut alors 0, si bien qu un t += api.dt gele tout seul, sans que personne
    // ait a connaitre l existence de la pause ; api.dtReal reste disponible pour animer un menu
    // pendant que le jeu, lui, ne bouge plus.
    pause:function(active){
      if(active !== undefined) game.pause = !!active;
      return !!game.pause;
    },
    overlapSphere:function(position, radius){
      _apiSphere.center.set(position.x, position.y, position.z);
      _apiSphere.radius = radius;
      return game.objects.filter(function(x){
        if(x === o) return false;
        const b = _apiBox.setFromObject(x);
        return !b.isEmpty() && b.intersectsSphere(_apiSphere);
      });
    },
    after:function(s, fn){ game.minuteries.push({t:game.time + s, fn:fn}); },
    emit:function(name, data){
      (game.ecouteurs[name] || []).forEach(function(fn){
        try{ fn(data); } catch(e){ console.error('[runtime] événement', name, e); }
      });
    },
    on:function(name, fn){ (game.ecouteurs[name] = game.ecouteurs[name] || []).push(fn); },
    // .html/.css sont en LECTURE SEULE : le contenu vit sur les assets documentUI/feuilleStyle
    // référencés (partagés, potentiellement par plusieurs Noeuds) — un script ne les réécrit pas
    // à la volée, comme Unity ne laisse pas un script réécrire l'UXML d'un document en game.
    // .valeurs (data-bind) reste lecture/écriture : c'est le canal prévu pour piloter l'UI.
    uiDocument:function(node){
      const n = node || o;
      const d = n && n.userData && n.userData.uiDoc;
      if(!d) return null;
      if(!d.values) d.values = {};
      return {
        get html(){ const a = d.documentUIId ? assetsById[d.documentUIId] : null; return a ? a.html : ''; },
        get css(){
          return (d.sheetStyleIds || []).map(function(id){
            const a = assetsById[id]; return a ? a.css : '';
          }).join('\n');
        },
        get values(){ return d.values; }
      };
    },
    changeScene:function(name){
      const i = D.scenes.findIndex(function(s){ return s.name === name; });
      if(i !== -1) game.sceneDemandee = i;
    },
    pathTo:function(target){
      const but = rtNavPos(target);
      return but ? rtNavFilePath(o.getWorldPosition(new THREE.Vector3()), but) : null;
    },
    moveTo:function(target, speed){ return rtNavAdvance(o, target, speed, frame.dt); },
    patrol:function(points, speed){ rtNavPatrol(o, points, speed, frame.dt); },
    playSound:function(name, volume, bus){ return rtPlaySound(name, volume, bus); },
    // Miroir exact de js/scripts.js : la même fonction (js/audio-bus.js), pas une copie.
    audioBus:function(name){
      return makeAudioBusApi(rtAudioMix, name, function(m){ console.warn('[runtime] ' + m); });
    },
    // Miroir exact de js/scripts.js : même implémentation (js/synth.js).
    playNote:function(id, opts){ return rtSynthApiOf(o).playNote(id, opts); },
    playNotes:function(ids, opts){ return rtSynthApiOf(o).playNotes(ids, opts); },
    notes:function(target){ return rtSynthApiOf(o).notes(target); },
    speak:function(text, opts){ return rtSynthApiOf(o).speak(text, opts); },
    stopSpeaking:function(){ return rtSynthApiOf(o).stopSpeaking(); },
    // ---------- Manette ----------
    // Les BOUTONS ne passent pas par ici : ils sont des touches comme les autres
    // (`api.action('jump')`, `api.key('pad:0')`) — voir js/gamepad-input.js.
    // Ce qui suit est ce qu'une touche ne sait pas dire.
    /** La valeur analogique d'un axe pilote au stick, dans [-1, 1]. 0 sans manette. */
    padAxis: function(name){
      return (typeof gamepadAxis === 'function') ? gamepadAxis(name) : 0;
    },
    /** Le nombre de manettes branchees. Pour afficher « branchez une manette » a propos. */
    gamepads: function(){
      return (typeof gamepadState !== 'undefined') ? gamepadState.connected : 0;
    },
    /**
     * Fait vibrer la manette. `force` dans [0, 1], `ms` en millisecondes.
     * Rend `false` quand le materiel ne sait pas vibrer — beaucoup de manettes et de
     * navigateurs ne le savent pas, et un jeu ne doit jamais en dependre.
     */
    rumble: function(force, ms){
      return (typeof rumbleGamepad === 'function') ? rumbleGamepad(force, ms) : false;
    },
    // ---------- Texte traduit ----------
    // La table vit dans les reglages du projet et voyage avec lui. Une cle absente rend LA CLE
    // elle-meme : un bouton qui affiche « menu.start » se corrige le jour ou on le voit, un
    // bouton vide se decouvre chez le joueur. Voir js/locale.js.
    /** Le texte d'une cle, avec substitution : api.t('score', {n: 42}). */
    t: function(key, params){
      return (typeof translateText === 'function') ? translateText(key, params) : String(key);
    },
    /** La langue active (code court : 'fr', 'en'). */
    locale: function(){
      return (typeof localeCurrent === 'function') ? localeCurrent() : '';
    },
    /** Les langues que le projet fournit — pour construire un menu de choix. */
    locales: function(){
      return (typeof localesAvailable === 'function') ? localesAvailable() : [];
    },
    /**
     * Change la langue en cours de partie et la memorise. Rend `false` si le projet ne la
     * fournit pas — changer pour une langue absente viderait tout le texte du jeu.
     */
    setLocale: function(code){
      return (typeof setLocale === 'function') ? setLocale(code) : false;
    },
    // ---------- Application de bureau ----------
    // Vrai seulement dans le build Electron, ou `preload.js` pose `window.bureau`. Voir
    // js/build-desktop.js.
    /** Le jeu tourne-t-il dans l'application de bureau plutot que dans un navigateur ? */
    desktop: function(){
      return (typeof window !== 'undefined') && !!window.bureau;
    },
    /**
     * Ferme l'application. Rend `false` dans un navigateur, ou c'est IMPOSSIBLE : une page ne
     * peut pas se fermer elle-meme si elle n'a pas ete ouverte par un script. Un bouton
     * « Quitter » doit donc se cacher quand `api.desktop()` est faux, plutot que de ne rien
     * faire quand on le presse.
     */
    quitGame: function(){
      if(typeof window === 'undefined' || !window.bureau) return false;
      window.bureau.quitter();
      return true;
    },
    get steam(){ return makeSteamApi(function(msg){ console.warn('[game] ' + msg); }); },
    touchAxis:function(name){ return touchAxis(name); },
    particles:function(target){
      const c = target || o;
      return {
        emit:function(n){ rtEmitBurst(c, n); },
        setActive:function(active){ if(c.userData.part) c.userData.part.active = (active !== false); }
      };
    },
    audio:function(target){
      const son = sourceAudioOf(target || o);
      return {
        play:function(){ if(son && !son.isPlaying){ resumeAudio(); son.play(); } },
        stop:function(){ if(son && son.isPlaying) son.stop(); },
        volume:function(v){
          if(son && v !== undefined) son.setVolume(Math.max(0, v));
          return son ? son.getVolume() : 0;
        }
      };
    },
    // Miroir de js/scripts.js : état global qui survit aux changements de
    // scène, sauvegarde sur la machine du joueur, et tables de contenu.
    get state(){ return game.state; },
    save:function(name){
      try{ return writeSave(name, JSON.stringify(game.state)); }
      catch(e){ console.warn('[game] api.save :', e.message); return false; }
    },
    load:function(name){
      try{
        const raw = readSave(name);
        if(!raw) return false;
        Object.assign(game.state, JSON.parse(raw));
        return true;
      } catch(e){ console.warn('[game] api.load :', e.message); return false; }
    },
    clearSave:function(name){
      try{ return removeSave(name); } catch(e){ return false; }
    },
    // Multijoueur — miroir de js/scripts.js.
    //
    // LES DEUX SONT GARDÉES, et c'était le dernier obstacle à rendre `js/network-game.js` facultatif :
    // cet objet est construit POUR CHAQUE SCRIPT de la scène, et il ne s'agit pas d'un appel derrière
    // une condition mais d'une valeur de propriété. `networkHandle()` est un appel, et
    // `estAutorite: networkIsAuthority` une simple citation — or citer un identifiant absent lève déjà
    // une ReferenceError. Un jeu solo sans multijoueur tombait donc au premier script.
    //
    // `estAutorite` vaut VRAI par défaut : un jeu sans réseau est sa propre autorité, et c'est ce que
    // tout script écrit pour du multijoueur attend en solo. Rendre faux ferait taire la moitié de la
    // logique de jeu sans un mot.
    network: (typeof networkHandle === 'function') ? networkHandle() : null,
    isAuthority: (typeof networkIsAuthority === 'function') ? networkIsAuthority
                                                          : function(){ return true; },
    lib:function(name){ return (game.libraries = game.libraries || libraryHostForAssets(function(){ return D.assets; }, {data: function(n){ return apiFor(o, 0, 0).data(n); }, log: console.log, warn: console.warn, error: console.error})).lib(name); },
    data:function(name){
      const d = (D.assets || []).find(function(x){ return x.kind === 'data' && x.name === name; });
      if(!d){ console.warn('[game] api.data : table « ' + name + ' » introuvable'); return null; }
      if(d._cache === undefined || d._cacheText !== d.text){
        try{ d._cache = JSON.parse(d.text); d._cacheText = d.text; }
        catch(e){ console.error('[game] api.data : « ' + name + ' » JSON invalide —', e.message); d._cache = null; }
      }
      return d._cache;
    },
    // Miroir de `api.image` (js/scripts.js) : l'image d'un asset texture, pour qu'un script qui
    // dessine lui-même (canvas d'interface) lise des sprites posés en ASSETS au lieu de les refaire.
    image:function(name){
      const ids = Object.keys(assetsById);
      for(let i = 0; i < ids.length; i++){
        const a = assetsById[ids[i]];
        if(!a || a.kind !== 'texture' || a.name !== name) continue;
        if(a.texture && a.texture.image && a.texture.image.width) return a.texture.image;
        if(!a._img && a.url){ a._img = new Image(); a._img.src = a.url; }
        return a._img || null;
      }
      console.warn('[game] api.image : texture « ' + name + ' » introuvable');
      return null;
    },
    log:function(m){ console.log('[game]', m); },
    warn:function(m){ console.warn('[game]', m); },
    error:function(m){ console.error('[game]', m); },
    status:hud,
    V3:function(x, y, z){ return new THREE.Vector3(x || 0, y || 0, z || 0); }
  });
}

// Miroir de codeOfScriptEntry (js/scripts.js) : le code vit sur l'asset référencé, l'entrée de
// userData.scripts ne porte que `scriptId`.
function rtCodeOfScriptEntry(entry){
  if(!entry || !entry.scriptId) return '';
  const a = (typeof assetsById !== 'undefined' && assetsById) ? assetsById[entry.scriptId] : null;
  return (a && a.kind === 'script') ? (a.code || '') : '';
}

// Une erreur d'exécution : console (remontée à read_console) et bandeau de debug persistant. Le
// même message répété à chaque image n'est relogué qu'une fois par seconde, avec son compte.
function reportScriptError(c, o, i, e){
  const msg = (e && e.message) || String(e);
  const now = Date.now();
  const r = c.lastError || (c.lastError = {msg: null, count: 0, at: -Infinity});
  if(r.msg !== msg){ r.msg = msg; r.count = 0; r.at = -Infinity; }
  r.count++;
  if(now - r.at < 1000) return;
  r.at = now;
  const label = 'script ' + (i + 1) + ' de « ' + o.name + ' »';
  console.error('[runtime] ' + label + ' :', msg + (r.count > 1 ? ' (×' + r.count + ')' : '')
    + (e && e.stack ? '\n' + String(e.stack).split('\n').slice(1, 4).join('\n') : ''));
  scriptErrorBanner('⛔ ' + label + ' : ' + msg + (r.count > 1 ? ' (×' + r.count + ')' : ''));
}
function scriptErrorBanner(text){
  let el = document.getElementById('rj-script-error');
  if(!el){
    el = document.createElement('div');
    el.id = 'rj-script-error';
    el.title = 'Erreur de script — cliquer pour masquer';
    el.style.cssText = 'position:fixed;left:8px;right:8px;top:8px;z-index:9999;padding:6px 10px;background:rgba(140,20,20,.92);color:#fff;font:12px/1.4 monospace;border-radius:4px;white-space:pre-wrap;cursor:pointer;pointer-events:auto';
    el.addEventListener('click', function(){ el.style.display = 'none'; });
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.style.display = 'block';
}

// Même règle que mergeVarsDeclared (js/scripts.js) : une clé ajoutée au bloc /* @vars */ après
// l'attachement reçoit sa valeur par défaut, sans écraser une valeur déjà réglée (§ 12).
function rtMergeVarsDeclared(o, code){
  const m = /\/\*\s*@vars\s*(\{[\s\S]*?\})\s*\*\//.exec(code || '');
  if(!m) return;
  let decl;
  try{ decl = JSON.parse(m[1]); } catch(e){ return; }
  if(!decl || typeof decl !== 'object' || Array.isArray(decl)) return;
  if(!o.userData.game) o.userData.game = {tag:'', layer:'Défaut', props:{}};
  if(!o.userData.game.props) o.userData.game.props = {};
  const props = o.userData.game.props;
  Object.keys(decl).forEach(function(k){
    const v = decl[k];
    if(!(k in props) && (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string')) props[k] = v;
  });
}

function compiledOf(o, i){
  const s = (o.userData.scripts || [])[i];
  const code = rtCodeOfScriptEntry(s);
  if(!s || !s.active || !code.trim()) return null;
  let byObject = game.compiled.get(o);
  if(!byObject){ byObject = new Map(); game.compiled.set(o, byObject); }
  let c = byObject.get(i);
  if(c) return c.error ? null : c;
  c = {error:false, start:null, update:null};
  byObject.set(i, c);
  rtMergeVarsDeclared(o, code);
  try{
    // Miroir EXACT de compiledOf() (js/scripts.js) : même portée réduite, même module partagé.
    // Une portée plus large ici donnerait un script qui échoue à l'essai et passe une fois
    // publié — ou l'inverse, ce qui est pire.
    const fab = compileScript(code,
      '\nreturn {start:(typeof start==="function")?start:null,'
      + 'update:(typeof update==="function")?update:null};');
    const r = fab(apiFor(o, 0, i));
    c.start = r.start;
    c.update = r.update;
  } catch(e){
    c.error = true;
    console.error('[runtime] script ' + (i + 1) + ' de « ' + o.name + ' » :', e.message);
    hud('⛔ Script « ' + o.name + ' » (script ' + (i + 1) + ') : ' + e.message, 5000);
  }
  return c.error ? null : c;
}

// Contacts par recouvrement de boîtes — miroir de evaluateContacts() dans
// js/scripts.js. On ne notifie qu'à l'ENTRÉE, sinon chaque script devrait tenir
// lui-même la liste de ce qu'il a déjà traité.
const _rtCtcA = new THREE.Box3();
const _rtCtcB = new THREE.Box3();
function evaluateContactsGame(){
  if(!game.contacts.length) return;
  // Miroir de js/scripts.js : un seul passage sur la scène, partagé par tous
  // les gestionnaires. Voir le commentaire plus bas pour la mesure qui l'a motivé.
  const byTag = indexByTag();
  game.contacts.forEach(function(c){
    if(!isSceneObject(c.obj)) return;
    const candidats = byTag.get(c.tag);
    if(!candidats || !candidats.length){ c.dedans.clear(); return; }
    _rtCtcA.setFromObject(c.obj);
    if(_rtCtcA.isEmpty()) return;
    const vus = new Set();
    for(let i = 0; i < candidats.length; i++){
      const autre = candidats[i];
      if(autre === c.obj) continue;
      _rtCtcB.setFromObject(autre);
      if(_rtCtcB.isEmpty() || !_rtCtcA.intersectsBox(_rtCtcB)) continue;
      vus.add(autre);
      if(!c.dedans.has(autre)){
        c.dedans.add(autre);
        try{ c.fn(autre); } catch(e){ console.error('[game] api.onContact', e); }
      }
    }
    c.dedans.forEach(function(x){ if(!vus.has(x)) c.dedans.delete(x); });
  });
}

// Photo des entrées locales, envoyée à l'autorité — miroir de
// snapshotInputs() dans js/scripts.js. On transmet les AXES et les actions
// active, pas les cles : la table d'entrées peut différer d'un poste à
// l'autre, alors que le sens du jeu est le même partout.
function rtSnapshotInputs(){
  const actions = [];
  Object.keys(INPUTS.actions || {}).forEach(function(name){
    if(actionActive(name)) actions.push(name);
  });
  const axes = {};
  Object.keys(INPUTS.axes || {}).forEach(function(name){
    const p = INPUTS.axes[name];
    axes[name] = (actionActive(p[1]) ? 1 : 0) - (actionActive(p[0]) ? 1 : 0);
  });
  return {axes: axes, actions: actions};
}

function runScripts(dt, dtReel){
  game.dtReel = (dtReel === undefined) ? dt : dtReel;
  game.time += dt;
  if(typeof networkActive === 'function' && networkActive()){
    if(networkIsAuthority()) networkBroadcast(game.state, game.time);
    else {
      networkApply(game.state, function(name){
        return game.objects.find(function(o){ return o.name === name; }) || null;
      }, dt);
      networkSendInputs(rtSnapshotInputs());
    }
  }
  evaluateContactsGame();
  game.objects.slice().forEach(function(o){
    // L'activité, pas la visibilité — même règle que l'éditeur (js/scripts.js, isActiveInHierarchy).
    if(!isSceneObject(o) || !isActiveInHierarchy(o)) return;
    const scripts = o.userData.scripts || [];
    if(!scripts.length) return;
    let demarresObj = game.demarres.get(o);
    if(!demarresObj){ demarresObj = new Set(); game.demarres.set(o, demarresObj); }
    scripts.forEach(function(s, i){
      const c = compiledOf(o, i);
      if(!c) return;
      const api = apiFor(o, dt, i);
      try{
        if(!demarresObj.has(i)){ demarresObj.add(i); if(c.start) c.start(api); }
        if(c.update) c.update(api);
      } catch(e){
        // COMPORTEMENT UNITY : une exception dans update n'éteint PAS le script — il est rappelé
        // à l'image suivante, et l'erreur est dite (BUGS_MOTEUR § 22 : un générateur qui plantait
        // une fois figeait tout le jeu, sans un mot). La répétition est regroupée.
        reportScriptError(c, o, i, e);
      }
    });
  });
  const dues = game.minuteries.filter(function(m){ return m.t <= game.time; });
  game.minuteries = game.minuteries.filter(function(m){ return m.t > game.time; });
  dues.forEach(function(m){ try{ m.fn(); } catch(e){ console.error('[runtime] apres :', e); } });
  game.aDestroy.forEach(function(target){
    if(!isSceneObject(target)) return;
    // removeSceneObject désindexe aussi les composants du Noeud : un objet détruit par
    // api.destroy() restait sinon dans le Registry, et les Systèmes continuaient de le
    // simuler jusqu'au changement de scène.
    target.traverse(function(x){ removeSceneObject(x); rtDetachBody(x); });
    if(target.parent) target.parent.remove(target);
  });
  game.aDestroy = [];
  keysPrev = new Set(keys);
  buttonsPrev = new Set(mouseGame.buttons);
  // Les deltas sont CONSOMMÉS par l'image : sans cette remise à zéro, un script qui ne lit pas
  // mouseDelta à une image verrait le mouvement de deux images arriver à la suivante — un
  // sursaut de visée après chaque pause, chaque menu, chaque changement de scène.
  mouseLook.dx = 0; mouseLook.dy = 0;
}

// ---------- événements visuels « Quand… Alors… » ----------
const evtRt = {states:new Map(), demarres:false};

function evtTarget(o, name){
  if(!name) return o;
  return game.objects.find(function(x){ return x.name === name; }) || null;
}

function evtActions(o, actions, depuis){
  for(let i = depuis; i < (actions || []).length; i++){
    const ac = actions[i];
    const target = evtTarget(o, (ac.target || '').trim());
    switch(ac.type){
      // MIROIR DE js/events.js, et correction d'un défaut qui ne vivait QUE ici : le jeu publié
      // regroupe son décor en lots d'instances dès le chargement de la scène. Sur une source
      // regroupée, écrire `visible` ne fait rien — le lot continue de la dessiner. Une action
      // « cacher » posée sur un objet de décor était donc sans effet dans le jeu, et marchait
      // dans l'éditeur, qui ne regroupait pas. `setVisibleIntent` écrit ce que le lot lit.
      // `typeof` parce que js/render-perf.js est retirable d'un build : sans lui, rien n'est
      // regroupé et `visible` redevient exactement juste.
      case 'montrer': if(target) rtSetVisible(target, true); break;
      case 'hide':    if(target) rtSetVisible(target, false); break;
      case 'toggle':  if(target) rtSetVisible(target, !rtVisible(target)); break;
      case 'destroy':
        if(target && game.aDestroy.indexOf(target) === -1) game.aDestroy.push(target);
        break;
      case 'emit': {
        const name = (ac.value || '').trim();
        (game.ecouteurs[name] || []).forEach(function(fn){
          try{ fn(); } catch(e){ console.error('[runtime] événement', name, e); }
        });
        break;
      }
      case 'jouerSon': rtPlaySound((ac.value || '').trim()); break;
      // Le MÊME test que l'éditeur (le composant, pas `userData.type`), et le même avertissement :
      // les deux moteurs décidaient différemment qu'un objet est un émetteur.
      case 'burstParticules':
        if(target && ((target.getComponent && target.getComponent('Particles'))
                      || target.userData.type === 'particles'))
          rtEmitBurst(target, parseInt(ac.value, 10) || undefined);
        else console.warn('[runtime] événement : « ' + ((ac.target || '').trim() || o.name)
          + ' » n\'est pas un émetteur de particules');
        break;
      case 'status': hud(String(ac.value || ''), 2500); break;
      // Miroir de js/events.js. `readSettingParam` n'est PAS recopiée : elle vit dans
      // le fichier partagé js/animator.js, parce que deux lectures divergentes de
      // « vitesse = 1 » donneraient un jeu qui ne réagit pas comme l'éditeur.
      case 'parametreAnim': {
        const setting = readSettingParam(ac.value);
        if(!setting) break;
        const onQui = target || o;
        const player = rtPlayerAnimatorOf(onQui);
        if(player) setParamAnimator(player, setting.name, setting.value);
        break;
      }
      case 'changerScene': {
        const idx = D.scenes.findIndex(function(s){ return s.name === (ac.value || '').trim(); });
        if(idx !== -1) game.sceneDemandee = idx;
        return;
      }
      default:
        console.warn('[runtime] événement : action inconnue « ' + ac.type + ' » — ignorée');
        break;
      case 'wait': {
        const reste = i + 1;
        game.minuteries.push({t: game.time + (parseFloat(ac.value) || 0),
          fn: function(){ evtActions(o, actions, reste); }});
        return;
      }
    }
  }
}

function evtInit(){
  evtRt.states = new Map();
  evtRt.demarres = false;
  // Porteurs du composant Events. Miroir exact d'initEventsVisuals() (js/events.js).
  Registry.activeNodes('Events').forEach(function(o){
    (o.userData.events || []).forEach(function(ev){
      if(ev.when === 'event' && (ev.param || '').trim()){
        const name = ev.param.trim();
        (game.ecouteurs[name] = game.ecouteurs[name] || [])
          .push(function(){ evtActions(o, ev.actions, 0); });
      }
    });
  });
}

const _ebA = new THREE.Box3(), _ebB = new THREE.Box3();
function evtRun(){
  if(!evtRt.demarres){
    evtRt.demarres = true;
    game.objects.slice().forEach(function(o){
      (o.userData.events || []).forEach(function(ev){
        if(ev.when === 'startup') evtActions(o, ev.actions, 0);
      });
    });
  }
  // Miroir de js/events.js : porteurs d'abord, cibles indexées par tag une
  // seule fois. Voir le commentaire plus bas pour les mesures qui l'ont motivé.
  const porteurs = [];
  for(let i = 0; i < game.objects.length; i++){
    const evs = game.objects[i].userData.events;
    if(evs && evs.length) porteurs.push(game.objects[i]);
  }
  if(!porteurs.length) return;

  const byTag = indexByTag();

  porteurs.forEach(function(o){
    const evs = o.userData.events;
    for(let ei = 0; ei < evs.length; ei++){
      const ev = evs[ei];
      if(ev.when !== 'entreeTrigger' && ev.when !== 'sortieTrigger') continue;
      const targets = byTag.get((ev.param || 'joueur').trim());
      if(!targets || !targets.length) continue;
      _ebA.setFromObject(o);
      if(_ebA.isEmpty()) continue;
      for(let k = 0; k < targets.length; k++){
        const autre = targets[k];
        if(autre === o) continue;
        const key = o.id + ':' + ei + ':' + autre.id;
        _ebB.setFromObject(autre);
        const dedans = !_ebB.isEmpty() && _ebA.intersectsBox(_ebB);
        const avant = evtRt.states.get(key) || false;
        if(dedans !== avant){
          evtRt.states.set(key, dedans);
          if(dedans && ev.when === 'entreeTrigger') evtActions(o, ev.actions, 0);
          if(!dedans && ev.when === 'sortieTrigger') evtActions(o, ev.actions, 0);
        }
      }
    }
  });
}

// clic sur un objet du jeu → événements « Au clic »
renderer.domElement.addEventListener('pointerdown', function(e){
  if(!game.scene || !game.cam) return;
  const rect = renderer.domElement.getBoundingClientRect();
  const mouse = new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1);
  const rc = new THREE.Raycaster();
  rc.setFromCamera(mouse, game.cam);
  const hits = rc.intersectObjects(game.objects, true);
  if(!hits.length) return;
  let root = hits[0].object;
  while(root && !isSceneObject(root)) root = root.parent;
  if(root) (root.userData.events || []).forEach(function(ev){
    if(ev.when === 'click') evtActions(root, ev.actions, 0);
  });
});

// ---------- construction / changement de scène ----------
/**
 * Libère les ressources GPU propres à une scène : matériaux des maillages, cartes d'ombre des
 * lumières. PAS les géométries ni les textures : elles appartiennent aux assets (gabarits de
 * modèles, formes partagées de js/primitive-geometry.js, textures d'asset) et resservent à la scène
 * suivante. Un matériau partagé avec un gabarit est seulement ré-envoyé au GPU s'il resert —
 * `dispose` libère le programme et les tampons, l'objet three reste utilisable.
 */
function rtDisposeScene(scene){
  if(!scene) return;
  const vus = new Set();
  scene.traverse(function(o){
    if(o.isLight && o.shadow && o.shadow.map){ o.shadow.map.dispose(); o.shadow.map = null; }
    if(!o.isMesh && !o.isPoints && !o.isLine && !o.isSprite) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach(function(m){
      if(m && !vus.has(m) && typeof m.dispose === 'function'){ vus.add(m); m.dispose(); }
    });
  });
}

function loadSceneGame(index){
  stopAudioScene();
  game.particles.forEach(function(s){
    if(s.objet3d.parent) s.objet3d.parent.remove(s.objet3d);
    s.geo.dispose();
    s.objet3d.material.dispose();
  });
  game.particles = [];
  rtNavReset();
  // LA SCÈNE QU'ON QUITTE REND SA MÉMOIRE GPU. Elle était remplacée sans être libérée : matériaux,
  // ciel en texture et cartes d'ombre restaient sur la carte graphique, et la mémoire montait à
  // chaque changement de niveau — le ramasse-miettes JS ne libère pas la mémoire GPU (revue du
  // 2026-09-29, § 5.6 ; docs/BONNES_PRATIQUES.md).
  rtDisposeScene(game.scene);
  if(game.skyTexture){ game.skyTexture.dispose(); game.skyTexture = null; }
  const sc = D.scenes[index];
  const data = (sc && sc.data) || {objects:[], tracks:[], duration:5, loop:true, env:null};

  game.scene = new THREE.Scene();
  game.hemi = new THREE.HemisphereLight(0xbfd4ff, 0x30281e, 0.4);
  game.sun = new THREE.DirectionalLight(0xffffff, 0.55);
  game.sun.position.set(8, 14, 6);
// Miroir de scene.js : ce soleil est l'ÉCLAIRAGE GLOBAL de l'environnement, sans composant ni
// existence dans le projet. Le laisser projeter une ombre doublait celle d'un composant Light
// directionnel ajouté par l'utilisateur — seul ce dernier doit en projeter une.
game.sun.castShadow = false;

  game.scene.add(game.hemi, game.sun);
  game.skyTexture = null;

  // AVANT buildList, jamais apres : buildList appelle applyComponents, qui enregistre les
  // composants au Registry. Vider la scene ensuite appelait Registry.clear() et effacait
  // ces composants tout juste crees — plus aucune Camera, donc plus rien de rendu.
  clearSceneObjects();
  const rec = buildList(data.objects);
  rec.racines.forEach(function(r){ game.scene.add(r); });
  Object.keys(rec.byId).forEach(function(k){ addSceneObject(rec.byId[k]); });
  // Les ombres directionnelles, cadrées sur la scène qu'on vient de construire. Sans cet
  // appel, le jeu publié garde la caméra d'ombre de 10 × 10 unités que three.js pose par
  // défaut : au-delà, tout se lit comme ombré, avec une frontière rectiligne en travers du
  // niveau. C'est une fois par chargement de scène, jamais par image.
  rtUpdateShadows(game.cam);
  // LE POST-TRAITEMENT DES SCÈNES D'AVANT LES PostVolume. `env.post` n'est plus lu par le
  // rendu (une seule source : les volumes et leurs profils). Une scène enregistrée avant ce
  // changement, qui avait un post-traitement actif et aucun volume, s'ouvre donc SANS aucun
  // effet — et c'est exactement le genre de disparition silencieuse que le reste de ce
  // fichier s'emploie à rendre audible. On le dit, une fois, au chargement de la scène.
  resetPostVolumeReports();
  if(data.env && data.env.post && data.env.post.active
     && Registry.active('PostVolume').length === 0){
    reportPostVolume('legacy:' + index,
      'la scène « ' + ((sc && sc.name) || index) + ' » porte un ancien réglage de scène'
      + ' (env.post) mais aucun PostVolume : plus rien ne s applique. Poser un PostVolume'
      + ' global et lui donner un profil dans l éditeur.');
  }
  rtAnims.clear();                          // la scène précédente a disparu

  // Regroupement du décor et niveau de détail — MÊME module que l'éditeur
  // (js/render-perf.js), donc mêmes règles, même seuil, mêmes exclusions. Le jeu publié
  // doit rendre la même image que la vue de lecture, et à la même vitesse ; deux
  // implémentations auraient fini par répondre différemment.
  // Appelé ici, après la construction complète de la scène : regrouper plus tôt figerait
  // des matrices que la reconstruction n'a pas encore posées.
  if(typeof collectDetail === 'function') collectDetail(game.objects);
  if(typeof instantiateStatic === 'function') instantiateStatic(game.scene, game.objects);

  // Copie conforme de la reconstruction des pistes de l'éditeur (`restoreState`,
  // js/history.js). `dp.os` était IGNORÉ ici : une piste d'os publiée appliquait ses clés
  // au modèle ENTIER — précisément ce que l'éditeur refuse de produire. Un avant-bras qui fait
  // partir tout le personnage à l'autre bout de la scène, et rien pour le voir venir tant
  // qu'on n'a pas exporté.
  //
  // Un os se retrouve par son NOM : ce ne sont pas des objets de projet, ils sont reconstruits
  // avec leur modèle et n'apparaissent dans aucune table de correspondance.
  game.tracks = (data.tracks || []).map(function(dp){
    const obj = rec.byId[dp.obj];
    let os = null;
    if(dp.os && obj) obj.traverse(function(x){ if(!os && x.isBone && x.name === dp.os) os = x; });
    return {obj:obj, os:os, keys:dp.keys || [], additif:!!dp.additif, boneAttendu:dp.os || null};
  }).filter(function(p){
    // Une piste qui ATTENDAIT un os et ne l'a pas trouvé est écartée, jamais rabattue sur
    // l'objet — même règle que l'éditeur.
    return p.obj && p.keys.length && (!p.boneAttendu || p.os);
  });
  game.duration = data.duration || 5;
  game.loop = data.loop !== false;
  game.t = 0;

  applyEnvironment(data.env);

  // caméra principale : reprend la même logique que camPrincipale() (éditeur), pour que le
  // build et la Vue Game en éditeur rendent toujours depuis la même caméra.
  const nCam = rtCameraMain(game.objects);
  game.camNode = nCam || null;
  game.cam = nCam ? (ed(nCam).cam || nCam.userData.cam) : camDefault;
  if(game.cam.isOrthographicCamera) rtFrameCamera2d(game.cam, innerWidth, innerHeight);
  if(listenerAudio.parent) listenerAudio.parent.remove(listenerAudio);
  game.cam.add(listenerAudio);

  // état de jeu réinitialisé
  game.links = []; game.kinematic = [];
  game.minuteries = []; game.ecouteurs = {}; game.aDestroy = []; game.contacts = []; game.persos = new WeakMap();
  game.time = 0; game.compiled = new Map(); game.demarres = new Map(); game.libraries = null;   // api.lib : repart de zéro
  game.scene.updateMatrixWorld();
  evtInit();
  startPhysics();
  startAudioScene();
  // LES LANGUES AVANT TOUT AFFICHAGE : une interface de jeu se dessine des la premiere
  // image, et une table installee apres elle montrerait les cles brutes le temps d'une
  // image — juste assez pour qu'on le voie, jamais assez pour qu'on sache pourquoi.
  if(typeof setupLocales === 'function') setupLocales(DS.locales);
  rtBakeProbes();      // reflets cuits une fois le décor complet en place
  if(XR_WANTED) XRRuntime.sceneChanged();
  hud('Scène : ' + (sc ? sc.name : '?'), 2000);
}

// ---------- loop ----------
function resize(){
  // En session, la taille est celle du casque : three refuse (et le signale) qu'on la change.
  if(XR_WANTED && XRRuntime.isPresenting()) return;
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h);
  [camDefault, game.cam].forEach(function(c){
    if(!c) return;
    // Une orthographique n'a PAS d'`aspect` : lui en poser un ne fait rien et ne dit rien. Son
    // cadrage se recalcule, et il se recalcule sur un RAPPORT PIXEL ENTIER — c'est ce qui décide
    // de la netteté d'un jeu en pixel-art, et rien d'autre.
    if(c.isOrthographicCamera){ rtFrameCamera2d(c, w, h); return; }
    c.aspect = w / h; c.updateProjectionMatrix();
  });
}

/**
 * (Re)cadre une caméra orthographique sur la fenêtre, à rapport pixel entier.
 *
 * Le réglage vit sur le composant `Camera` du nœud : mode de cadrage, largeur du niveau,
 * rapport imposé. Le mode « largeur » est celui qu'on veut presque toujours — le moins de
 * pixellisation possible sans jamais montrer le hors-field.
 */
function rtFrameCamera2d(cam, w, h){
  const n = rtNodeOfCamera2d(cam);
  const comp = cameraSettingOf(n);
  return frameOrthoCamera(cam, comp, w, h);
}
/**
 * `game.cam` suit la THREE.Camera COURANTE du nœud principal.
 *
 * `Camera.applyProjection()` REMPLACE la THREE.Camera (perspective et orthographique sont deux
 * classes). Après un remplacement en jeu (hydratation, script qui change la projection), le
 * CameraSystem cadrait la nouvelle — `cam.objectThree` — pendant que le rendu continuait de
 * passer par l'ancienne, détachée, restée au frustum de construction (`top = orthoSize`). Le
 * cadrage pixel-perfect avait donc l'air ignoré.
 */
function rtSyncCameraMain(){
  const n = game.camNode;
  const cur = n ? ed(n).cam : null;
  if(!cur || cur === game.cam) return;
  if(listenerAudio.parent) listenerAudio.parent.remove(listenerAudio);
  n.userData.cam = cur;
  game.cam = cur;
  game.cam.add(listenerAudio);
  if(cur.isOrthographicCamera) rtFrameCamera2d(cur, innerWidth, innerHeight);
  else { cur.aspect = innerWidth / Math.max(1, innerHeight); cur.updateProjectionMatrix(); }
}
function rtNodeOfCamera2d(cam){
  return (game.objects || []).find(function(o){ return o.userData.cam === cam || ed(o).cam === cam; }) || null;
}

// `rtUpdateCamera2d` a disparu : le CameraSystem (js/systems/camera-system.js) cadre et suit,
// ici comme dans l'éditeur.
/**
 * Une fenêtre de LECTURE SEULE sur l'état du jeu.
 *
 * Ce fichier est enveloppé dans une IIFE : rien de ce qu'il déclare n'est joignable de l'extérieur, et
 * c'est voulu — un jeu publié n'a pas à exposer ses entrailles. Mais cette fermeture a un coût qu'on a
 * payé toute la session : pour savoir si le héros se posait au bon endroit, il fallait glisser un
 * script DANS la scène et lui faire écrire sur `window`. Un agent n'a pas ce détour, et un humain qui
 * débogue son jeu non plus.
 *
 * On expose donc ce qui se MESURE, et rien qui se modifie : le temps, et pour chaque objet son nom, sa
 * position et l'état de son body 2D. Pas la scène, pas les matériaux, aucun setter — c'est la
 * différence entre observer et piloter, et elle est volontaire.
 */
window.__stateGame = function(){
  return {
    shadows: ShadowFit.report(game.scene, renderer, game.cam),
    time: +game.time.toFixed(3),
    objects: (game.objects || []).map(function(o){
      const c = o.userData.body2d;
      return {
        name: o.name,
        x: +o.position.x.toFixed(4), y: +o.position.y.toFixed(4), z: +o.position.z.toFixed(4),
        visible: o.visible !== false,
        atGround: c ? !!c._AtGround : null,
        vy: c ? +(c._vy || 0).toFixed(3) : null
      };
    })
  };
};
addEventListener('resize', resize);

// THREE.Clock est déprécié en r185 au profit de Timer, et l'échange n'est PAS un renommage :
// Clock démarrait au premier getDelta(), Timer démarre à sa construction. Ici la construction
// précède `await loadAssets()`, donc sans amorçage la première image vaudrait toute la
// durée de chargement du jeu. Le plafond ci-dessous la ramènerait à 0,05 s au lieu de 0 —
// une saccade d'entrée de jeu, discrète et jamais signalée. Miroir exact de viewport.js.
const clock = new THREE.Timer();
let clockPrimed = false;
function loop(){
  // Un projet XR est cadencé par `renderer.setAnimationLoop` (démarrage, plus bas) : en session,
  // c'est le casque qui appelle, et un requestAnimationFrame de la fenêtre ne tournerait plus.
  if(!XR_WANTED) requestAnimationFrame(loop);
  if(!renderer.__ready) return;
  // reset() avant update(), jamais après : reset() ne remet pas à zéro un delta déjà calculé.
  if(!clockPrimed){ clock.reset(); clockPrimed = true; }
  // update() consomme le temps écoulé ; il doit rester inconditionnel, sinon la première
  // image qui suit une interruption encaisse toute la durée de l'interruption.
  clock.update();
  const dt = Math.min(clock.getDelta(), 0.05);
  // EN PAUSE, LE MONDE RECOIT ZERO. Geler la boucle entiere arreterait aussi le rendu et les
  // scripts : l ecran figerait sur la derniere image et plus aucun code ne pourrait relancer.
  // On passe donc un dt NUL a tout ce qui simule, et le dt reel reste disponible aux scripts
  // (api.dtReal) pour animer un menu pendant que le jeu, lui, ne bouge plus.
  const dtGame = game.pause ? 0 : dt;
  // LES CLIPS D'ABORD, NOS PISTES ENSUITE — l'ordre inverse de celui d'avant, et c'est une
  // DIVERGENCE avec l'éditeur qui est corrigée ici.
  //
  // La v0.32.2 a remonté le clip avant les pistes dans js/animation.js, pour qu'une clé posée
  // sur un os gagne sur l'animation importée. Le runtime, lui, mettait toujours ses mixeurs en
  // dernier : la même scène donnait donc la clé dans l'éditeur et le clip dans le jeu publié.
  // Invisible tant qu'on n'exporte pas — exactement la famille de défaut la plus coûteuse de
  // ce dépôt. Les couches additives rendaient en plus la chose impossible : composer un écart
  // avant que la base n'existe ne veut rien dire.
  //
  // Les scripts restent APRÈS les pistes : `api.setPosition` doit continuer de primer sur une clé.
  rtUpdateAnimators(dtGame);
  rtUpdateAnimations(dtGame);
  // La physique 2D AVANT les scripts, comme la 3D : un script qui lit la position doit lire
  // celle que la simulation vient d'écrire, pas celle de l'image précédente.
  if(typeof stepWorld2d === 'function') stepWorld2d(game.objects, dtGame, undefined, actionActive);
  // L'ANIMATION DE SPRITES et le TRI PAR PROFONDEUR sont des Systèmes (js/systems/sprite-system.js),
  // lancés par `System.runFrame` juste après — donc APRÈS la physique : trier sur la position de
  // l'image précédente ferait passer le héros derrière un décor qu'il vient de dépasser.
  // LES SYSTEMES — les mêmes que l'éditeur, et non un miroir. Après la physique : cadrer avant
  // montrerait la position de l'image précédente, soit un décalage d'une image sur tout l'écran,
  // visible comme un flottement.
  System.runFrame(dtGame, { mode: 'play', width: innerWidth, height: innerHeight,
                            emit: rtEmitAnimEvent });
  if(game.tracks.length){
    game.t += dtGame;
    if(game.t >= game.duration){
      if(game.loop) game.t = game.t % game.duration;
      else game.t = game.duration;
    }
    applyAnimation(game.t);
  }
  // Les manettes et la locomotion AVANT les scripts : `api.xr` lit l'état de cette image.
  if(XR_WANTED) XRRuntime.update(dt);
  // LA MANETTE, JUSTE AVANT LES SCRIPTS : ils doivent lire l'etat de CETTE image, pas de la
  // precedente. Elle pose ses boutons dans le meme jeu de touches que le clavier, donc
  // `actionActive` et `api.key()` la voient sans rien savoir d'elle — voir
  // js/gamepad-input.js. `typeof` parce que le module est retirable d'un build allege.
  if(typeof pollGamepads === 'function') pollGamepads(keys, INPUTS);
  runScripts(dtGame, dt);
  evtRun();
  rtUpdateParticles(dtGame);
  if(game.sceneDemandee !== null){
    const target = game.sceneDemandee;
    game.sceneDemandee = null;
    loadSceneGame(target);
    resize();
    return;
  }
  if(game.world){
    syncPhysics();
    game.world.step(1/60, dt, 3);
    applyPhysics();
  }
  rtSyncCameraMain();
  applyMeasureCamera(game.cam, window.__measureCamera);   // play_and_measure {camera|focus} — camera-framing.js
  // APRÈS la physique et les scripts, JUSTE AVANT le rendu : les lots doivent refléter
  // les poses de cette image-ci. Placés plus haut, ils afficheraient celles de la
  // précédente — un décalage d'une image, invisible à l'arrêt et très visible en mouvement.
  if(typeof updateDetail === 'function') updateDetail(game.cam);
  if(typeof updateInstances === 'function') updateInstances();
  redrawUIGame();
  // LE RECADRAGE DES OMBRES NE DÉPEND PAS DU CHEMIN DE RENDU. Il vivait dans la seule branche
  // SANS post-traitement : dès qu'une scène portait un PostVolume — donc tout projet un peu
  // fini — la carte d'ombre restait cadrée là où le CHARGEMENT l'avait posée, et plus rien ne
  // la suivait. Symptôme exact et mesuré : des ombres partout dans l'éditeur, dont la boucle
  // recadre AVANT de choisir sa branche (js/viewport.js), et « pas ou peu d'ombres » dès qu'on
  // joue. La cause n'était pas l'éclairage, c'était l'endroit de cet appel.
  //
  // Il se fait donc ici, avant le choix — exactement comme du côté éditeur, et c'est ce qui
  // garantit que les deux sorties montrent la même image.
  if(typeof rtUpdateShadows === 'function') rtUpdateShadows(game.cam);

  // En session XR, pas de post-traitement : le pipeline de postfx.js ne connaît qu'une vue, le
  // rendu stéréo est celui de three (voir js/xr-runtime.js).
  // Le ciel suit le type de la caméra de jeu (js/sky-camera.js).
  if(isSkyBackground(game.scene.background, game.skyBackground)) game.scene.background = backgroundForCamera(game.skyBackground, game.cam);
  const postState = (XR_WANTED && XRRuntime.isPresenting()) ? null : rtCurrentPostState(game.cam);
  if(postState){
    // rtPostRender lit `game.post` en interne : le poser temporairement le fait utiliser
    // l état du frame courant sans changer sa signature.
    const savedPost = game.post;
    game.post = postState;
    rtPostRender(game.scene, game.cam, clock.getElapsed());
    game.post = savedPost;
  } else {
    renderer.render(game.scene, game.cam);
  }
  renderCameraOverlays(renderer, game.scene, game.cam, Registry.activeNodes('Camera'));   // mini-cartes, vues secondaires
}

// ---------- plein écran ----------
$('rj-full-screen').addEventListener('click', function(){
  if(document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen();
});

// ---------- interface de jeu ----------
// Le rendu vient de jeu-ui.js, embarqué à côté de ce fichier par js/build.js.
// uiDocumentsRedraw est appelé chaque frame (voir la boucle de rendu ci-dessous) :
// il ne réécrit le DOM que si le HTML/CSS d'un Noeud a changé depuis la dernière frame.
function eventUIDocumentRuntime(name, value){
  // La valeur d'un champ data-bind accompagne l'événement (undefined pour un simple clic).
  (game.ecouteurs[name] || []).forEach(function(fn){
    try{ fn(value); } catch(e){ console.error('[runtime] événement UI', name, e); }
  });
}

// Résout le HTML/CSS effectif d'un uiDoc depuis les assets documentUI/feuilleStyle
// embarqués dans le build (assetsById, peuplé au chargement — voir plus haut).
// L'URL affichable d'une texture du projet, par son nom — pour `url("asset:Nom")` dans le CSS.
function rtTextureUrlByName(name){
  for(const id in assetsById){
    const a = assetsById[id];
    if(a.kind === 'texture' && a.name === name && a.url) return a.url;
  }
  return null;
}

function resolveDocumentUIRuntime(node, uiDoc){
  const doc = uiDoc.documentUIId ? assetsById[uiDoc.documentUIId] : null;
  if(!doc) return null;
  const css = (uiDoc.sheetStyleIds || []).map(function(id){
    const a = assetsById[id]; return a ? a.css : '';
  }).join('\n');
  return {html: doc.html, css: resolveCssAssetUrls(css, rtTextureUrlByName)};
}

function redrawUIGame(){
  const container = $('rj-ui');
  if(!container) return;
  uiDocumentsRedraw(container, game.objects, eventUIDocumentRuntime, resolveDocumentUIRuntime);
  syncTouchControls(container, game.objects, {keys: keys, inputs: INPUTS});
}

// ---------- démarrage ----------
(async function(){
  try{
    document.title = DS.name || D.projectName || 'Jeu';
    // Avant tout chargement : si le démarrage échoue, savoir DE QUEL build il s'agit est
    // précisément ce qu'on veut pouvoir lire à l'écran.
    showVersionBuild();
    // Attendre que le backend réponde AVANT de charger les assets. KTX2Loader appelle
    // `detectSupport(renderer)` pour choisir sa cible de transcodage selon ce que le GPU
    // sait lire (DXT, ASTC, ETC…) : branché sur un renderer pas encore initialisé, il
    // choisit mal ou renonce, et la texture se dégrade sans erreur. `init()` est
    // asynchrone sur WebGPURenderer, et rien d'autre ne l'attendait ici.
    if(!renderer.__ready){
      progress('Initialisation du moteur de rendu…');
      // UN ÉCHEC D'INITIALISATION DOIT PARLER. Le commentaire d'avant disait « loop() garde
      // déjà __pret » : c'est vrai, et c'est justement le problème — elle rend la main à chaque
      // image et ne fait plus jamais rien. Le démarrage continuait, la scène se construisait, le
      // voile de chargement se retirait, et le joueur obtenait un écran noir SANS UN MOT.
      // Mesuré : `game.temps` restait à 0, aucun script ne tournait, le bandeau d'erreur restait
      // empty, et la seule trace était une exception de three.js dans la console.
      try { await renderer.__init; }
      catch(e){
        showError('Le moteur de rendu n\'a pas pu démarrer : ' + (e && e.message ? e.message : e)
          + ' — le jeu ne peut pas s\'afficher.');
        console.error('[runtime] init() du renderer a échoué', e);
        window.__gameStartError = 'rendu : ' + (e && e.message ? e.message : e); return;
      }
    }
    progress('Chargement des assets…');
    await loadAssets();
    progress('Construction de la scène…');
    // La scène de départ réglée (settings.startScene, par nom) l'emporte sur la scène active à l'export.
    const startIdx = DS.startScene ? D.scenes.findIndex(function(sc){ return sc && sc.name === DS.startScene; }) : -1;
    loadSceneGame(startIdx >= 0 ? startIdx : Math.min(D.current || 0, D.scenes.length - 1));
    resize();
    $('rj-loading').style.display = 'none';
    if(XR_WANTED) renderer.setAnimationLoop(loop); else loop();
    window.__gameReady = true; // attendu par play_and_measure : __stateGame existe bien avant
  } catch(e){ window.__gameStartError = e.message;
    showError('Démarrage impossible : ' + e.message);
    console.error(e);
  }
})();

})();
