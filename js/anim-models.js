// ---------- Animations des modèles importés (glTF, FBX) ----------
// Un personnage exporté de Blender arrive avec ses clips ; jusqu'ici ils étaient
// simplement ignorés — et pour le glTF, jetés dès le chargement (les clips sont
// sur `gltf.animations`, pas sur `gltf.scene`).
//
// Deux choses à faire correctement :
//   1. cloner un modèle SANS casser son squelette. Object3D.clone() recopie la
//      référence du Skeleton : toutes les copies restent pilotées par le
//      squelette de l'original, donc elles s'animent toutes ensemble et suivent
//      un objet qui n'est même pas dans la scène. Il faut relier les os clonés.
//   2. faire tourner un AnimationMixer par objet animé, dans la même loop que
//      le reste, et le libérer quand l'objet disparaît.

import { drawGraph } from './animator-graph.js';
import { assetId, assets, findOrCreateAssetAnimation, updateProject } from './assets.js';
import { Registry } from './component-registry.js';
import { logConsole } from './console.js';
import { stateCurrent } from './history.js';
import { buildInspector } from './inspector.js';
import { applyNodeMixin } from './node.js';
import { engineScripts } from './scripts.js';
import { skeletonOf } from './skeleton.js';
import { loop } from './viewport.js';

export const animModels = new Map();   // objet -> {mixeur, action, name}

/** Clone un objet en re-liant les squelettes des SkinnedMesh. */
export function cloneModel(source){
  const copie = source.clone(true);
  rebindSkeletons(copie, true);
  // Les clips sont partagés (ils sont en lecture seule) ; seul le mixeur est
  // propre à chaque instance.
  if(source.animations && source.animations.length) copie.animations = source.animations;
  return copie;
}

/**
 * Relie chaque maillage skinné d'une COPIE aux os de cette copie. `Object3D.clone()` garde le
 * squelette de l'original : sans cette passe, dupliquer un personnage donnait une copie dont la
 * peau suivait les os du premier. `withRenderer` : repose aussi le SkinnedMeshRenderer (un clone
 * du template n'en a pas ; une copie d'instance, si — reconstruit depuis son JSON).
 */
export function rebindSkeletons(copie, withRenderer){

  // On repère les nœuds clonés par nom : c'est ce que fait SkeletonUtils, et
  // les exporteurs (Blender inclus) nomment systématiquement les os.
  let aOfBone = false;
  copie.traverse(function(o){ if(o.isSkinnedMesh) aOfBone = true; });
  if(aOfBone){
    const byName = {};
    // LA PREMIÈRE occurrence, pas la dernière — et ce n'est pas un détail de style.
    //
    // Un FBX Mixamo chargé par three contient chaque os EN DOUBLE, imbriqués : un nœud
    // extérieur qui porte la position réelle et les os enfants, et à l'intérieur un homonyme
    // resté à l'origine, sans enfant. Mesuré sur un export réel : 64 os sur 65 dans ce cas.
    //
    // Or `PropertyBinding.findNode` — donc tout le système d'animation de three — résout un
    // nom par un parcours et retient le PREMIER trouvé, l'extérieur. Une table qui garde le
    // dernier liait la peau à l'homonyme intérieur, celui que rien n'anime jamais : le clip
    // tournait, des os bougeaient, et le personnage restait figé en T-pose. Aucune erreur,
    // et rien pour orienter la recherche.
    //
    // La règle qui en sort vaut au-delà de ce cas : la peau doit suivre les os que le système
    // d'animation ADRESSE. Sans doublon, premier et dernier désignent le même nœud — ce choix
    // ne change donc rien ailleurs.
    copie.traverse(function(o){ if(o.name && !(o.name in byName)) byName[o.name] = o; });
    copie.traverse(function(o){
      if(!o.isSkinnedMesh || !o.skeleton) return;
      const skeleton = o.skeleton;                       // encore celui de l'original
      const os = skeleton.bones.map(function(b){ return byName[b.name] || b; });
      o.bind(new THREE.Skeleton(os, skeleton.boneInverses), o.bindMatrix);
      // SkinnedMeshRenderer, RECONSTRUIT à CHAQUE CLONE — jamais hérité du template : un
      // composant posé une fois ne survit pas à `Object3D.clone()` (voir component-skinned-
      // mesh.js, qui explique pourquoi), exactement comme la re-liaison du squelette ci-dessus.
      if(withRenderer && typeof applyNodeMixin === 'function'){
        applyNodeMixin(o);
        if(!o.getComponent('SkinnedMeshRenderer')) o.addComponent('SkinnedMeshRenderer');
      }
    });
  }
}

/** Clips disponibles sur un objet, ou sur l'asset dont il est issu. */
export function clipsOf(obj){
  if(!obj) return [];
  if(obj.animations && obj.animations.length) return obj.animations;
  const id = obj.userData && obj.userData.assetId;
  if(id && typeof assets !== 'undefined'){
    const a = assets.find(function(x){ return x.id === id; });
    if(a && a.template && a.template.animations) return a.template.animations;
  }
  return [];
}

export function namesAnimations(obj){
  return clipsOf(obj).map(function(c){ return c.name; });
}

/**
 * Le PREMIER composant SkinnedMeshRenderer du sous-arbre, ou `null`.
 *
 * Même règle que `skeletonOf` (js/skeleton.js) : un modèle peut porter plusieurs
 * THREE.SkinnedMesh (body + vêtements exportés séparément), qui partagent le même squelette.
 * `externalClips` est donc porté par le premier composant rencontré — pas par la racine
 * `Model`, qui ne détient jamais de squelette (component-model.js).
 */
export function skinnedMeshRendererOf(o){
  let trouve = null;
  if(o && o.traverse) o.traverse(function(x){
    if(!trouve && x.getComponent){
      const c = x.getComponent('SkinnedMeshRenderer');
      if(c) trouve = c;
    }
  });
  return trouve;
}

// ---------- Animations venues d'un AUTRE asset ----------
//
// Le geste Mixamo : un personnage d'un côté, une marche de l'autre. Jusqu'ici un clip
// n'appartenait qu'à son propre asset — voir js/retargeting.js pour le transfert lui-même.

/** Les clips des autres assets, avec ce qu'ils savent de ce rig. Triés du meilleur au pire. */
export function animationsExternalFor(o){
  if(!o || typeof assets === 'undefined' || typeof compatibilityClipRig !== 'function') return [];
  const sien = o.userData && o.userData.assetId;
  const list = [];
  assets.forEach(function(a){
    if(a.id === sien || a.kind !== 'model' || !a.template) return;
    (a.template.animations || []).forEach(function(c){
      // Un clip de durée nulle est un artefact d'export (toute T-pose en porte un) : le
      // proposer ne mènerait qu'à une déception.
      if(!(c.duration > 0.05)) return;
      const compat = compatibilityClipRig(c, o);
      if(!compat.communs) return;      // aucun os en commun : ce clip ne parle pas à ce rig
      list.push({asset:a, clip:c, compat:compat});
    });
  });
  return list.sort(function(x, y){ return y.compat.rate - x.compat.rate; });
}

/** Attache pour de bon le clip d'un autre asset. Renvoie le clip posé, ou null. */
export function attachAnimationExternal(o, asset, clip){
  if(typeof setClipRetargetedOn !== 'function') return null;
  const pose = setClipRetargetedOn(o, asset.template, asset.name, clip);
  if(!pose) return null;
  // On enregistre la PROVENANCE, pas le clip : le fichier de scène reste léger et le reciblage
  // est refait au chargement depuis les mêmes sources. Sans elle, l'éditeur montrerait une
  // animation que le jeu exporté serait incapable de reproduire.
  const smr = skinnedMeshRendererOf(o);
  if(!smr) return pose;   // pas de squelette sous ce nœud : rien à enregistrer, mais le clip a été posé
  const refs = (smr.externalClips || []).slice();
  refs.push({assetId:asset.id, sourceClip:clip.name, localName:pose.name});
  smr.externalClips = refs;
  return pose;
}

/** Retire un clip attaché depuis un autre asset — et lui seul. */
export function detachAnimationExternal(o, name){
  const smr = skinnedMeshRendererOf(o);
  if(smr) smr.externalClips = (smr.externalClips || []).filter(function(r){ return r.localName !== name; });
  o.animations = (o.animations || []).filter(function(c){ return c.name !== name; });
}

/** Les provenances de clips externes portées par ce nœud (ou son descendant skinné). */
export function externalClipsOf(o){
  const smr = skinnedMeshRendererOf(o);
  return smr ? (smr.externalClips || []) : [];
}

export function mixerOf(obj){
  let e = animModels.get(obj);
  if(!e){
    // `couches` : les mélanges par os posés par-dessus le clip principal — [{name, depuis,
    // poids, action}]. Vide dans le cas current, et alors rien ne change de l'ancien
    // comportement : une seule action, un seul clip, un fondu entre les deux.
    // `blend` : non nul seulement quand l'état current de l'Animator mélange plusieurs clips
    // sous un paramètre. Il REMPLACE alors l'action de base au lieu de s'y add.
    e = {mixer: new THREE.AnimationMixer(obj), action: null, name: null, layers: [],
         blend: null};
    animModels.set(obj, e);
  }
  return e;
}

// ---------- Mélange par os ----------
//
// « Marcher en bas, viser en haut. » Le partage des os et la restriction des clips vivent dans
// js/anim-blend.js ; ici on ne fait que les brancher sur le mixeur.

// ---------- De l'asset d'animation au clip jouable ----------
//
// Un état de machine désigne son animation par ASSET (`animation: "aNN"`), et l'asset porte la
// vitesse, la boucle et la découpe. La décision — quel clip, quels réglages — vit dans le
// fichier partagé js/anim-asset.js ; ici, on ne fait que fabriquer le clip découpé et le
// retenir. Même partage que pour la machine elle-même : sans lui, l'éditeur et le jeu publié
// découperaient différemment, et ça ne se verrait qu'après export.

export const _clipsSliced = new WeakMap();   // objet -> Map(nomDerivé -> {clip, source, bounds})

export function assetByIdAnim(id){
  return (typeof assets !== 'undefined')
    ? (assets.find(function(x){ return x.id === id; }) || null) : null;
}

/**
 * Le clip découpé d'un asset : cuit UNE FOIS, puis retrouvé.
 *
 * Cuit, et non rogné image par image en jouant : un rognage du temps à chaque image se
 * désynchronise du fondu de transition, qui fait advance deux actions à la fois, et du relevé
 * des marqueurs, qui compare deux instants successifs.
 */
export function clipSliceFor(obj, base, assetId, bounds, settings){
  const name = nameClipDerived(base.name, assetId);
  let table = _clipsSliced.get(obj);
  if(!table){ table = new Map(); _clipsSliced.set(obj, table); }
  // Les réglages de l'onglet Animation font partie de la signature : changer le miroir ou le
  // Loop Pose d'un clip doit recuire son dérivé, pas rejouer l'ancien.
  const signature = bounds.start + '/' + bounds.end + '/'
    + (typeof signatureClipProcessing === 'function' ? signatureClipProcessing(settings) : '');
  const deja = table.get(name);
  // La source est comparée aussi : un réimport du modèle remplace les clips, et un clip
  // découpé qui survit à sa source anime un squelette qui n'existe plus.
  if(deja && deja.source === base && deja.signature === signature) return deja.clip;
  const clip = deriveClip(base, name, bounds, settings || null);
  table.set(name, {clip: clip, source: base, signature: signature});
  return clip;
}

/**
 * Ce qu'un porteur d'animation — un état, ou un point de mélange — veut jouer sur `cible` :
 * `{name, vitesse, loop}`, ou null s'il n'y a rien de jouable.
 *
 * `porteur.animation` d'abord, `porteur.clip` en repli. Le repli n'est pas transitoire : une
 * machine partagée par deux modèles ne peut pas être migrée, et un projet exporté avant la
 * v0.52 ne repassera jamais par la migration.
 */
// Le slerp que js/anim-asset.js n'a pas le droit de connaître : il ne dépend pas de three, pour
// rester éprouvable hors navigateur. Il rend la décision, on fournit la trigonométrie.
export const _qClipA = new THREE.Quaternion(), _qClipB = new THREE.Quaternion();
export function slerpArray(a, b, k){
  _qClipA.fromArray(a); _qClipB.fromArray(b);
  return _qClipA.slerp(_qClipB, k).toArray();
}

/**
 * Le `THREE.AnimationClip` d'un clip à clés, compilé une fois puis retrouvé.
 *
 * Compilé, et non joué à la main image par image : une fois que c'est une `AnimationClip`, TOUT
 * le reste marche sans rien savoir de son origine — les fondus de transition, le mélange 1D,
 * les couches par os, l'inertialisation, le racine motion, les marqueurs. Écrire un second
 * lecteur pour les clips maison aurait doublé chacune de ces pièces.
 *
 * `asset.rev` est incrémenté par la timeline à chaque modification : c'est ce qui fait recuire
 * le clip quand on déplace une clé, et rien d'autre ne le ferait, la liste des pistes restant
 * le même objet.
 */
export const _clipsCompiled = new Map();     // id d'asset -> {clip, rev}

export function clipOfKeys(asset){
  if(typeof dataClipAKeys !== 'function') return null;
  const rev = asset.rev || 0;
  const deja = _clipsCompiled.get(asset.id);
  if(deja && deja.rev === rev) return deja.clip;
  const d = dataClipAKeys(asset, slerpArray);
  if(!d.tracks.length) return null;
  const tracks = d.tracks.map(function(p){
    return p.size === 4
      ? new THREE.QuaternionKeyframeTrack(p.name, p.time, p.values)
      : new THREE.VectorKeyframeTrack(p.name, p.time, p.values);
  });
  const clip = new THREE.AnimationClip(nameClipDerived(asset.name || 'anim', asset.id),
    d.duration, tracks);
  _clipsCompiled.set(asset.id, {clip: clip, rev: rev});
  return clip;
}

/** Oublie le clip compilé d'un asset — à l'appeler quand l'asset disparaît. */
export function forgetClipCompiled(id){ _clipsCompiled.delete(id); }

export function settingsAnimFor(target, holder){
  if(!holder) return null;
  if(holder.animation && typeof resolveAnimAsset === 'function'){
    const asset = assetByIdAnim(holder.animation);
    const r = resolveAnimAsset(asset, assetByIdAnim);
    if(r && r.type === 'keys'){
      const clip = clipOfKeys(asset);
      if(clip){
        // Le clip compilé est rangé dans la table de l'objet, comme une découpe : c'est par là
        // que `clipByName` le retrouvera, sans qu'il ait à figurer dans `obj.animations`.
        let table = _clipsSliced.get(target);
        if(!table){ table = new Map(); _clipsSliced.set(target, table); }
        table.set(clip.name, {clip: clip, source: asset, signature: 'keys' + (asset.rev || 0)});
        return {name: clip.name, speed: r.speed, loop: r.loop};
      }
    }
    if(r && r.type !== 'keys'){
      const base = clipByName(target, r.clip);
      if(base){
        const bounds = boundsAnimAsset(r, base.duration);
        const derive = sliceUseful(bounds, base.duration)
          || (typeof clipNeedsProcessing === 'function' && clipNeedsProcessing(r));
        const clip = derive ? clipSliceFor(target, base, asset.id, bounds, r) : base;
        return {name: clip.name, speed: r.speed, loop: r.loop, cycleOffset: r.cycleOffset || 0};
      }
    }
  }
  if(holder.clip && clipByName(target, holder.clip)){
    return {name: holder.clip, speed: 1, loop: true};
  }
  return null;
}

/**
 * Le Cycle Offset d'un clip (onglet Animation d'Unity) : le clip démarre à cette fraction de son
 * cycle. S'ajoute au Transition Offset de la transition qui y mène, s'il y en a un.
 */
export function applyCycleOffset(target, cycle, fromTransition){
  if(!cycle) return;
  const e = animModels.get(target);
  if(!e || !e.action) return;
  const f = ((fromTransition || 0) + cycle) % 1;
  e.action.time = f * e.action.getClip().duration;
}

/** Le Transition Offset d'Unity : démarrer le clip d'arrivée à une fraction de sa durée. */
export function applyOffsetTransition(target, t){
  const dec = (typeof offsetTransition === 'function') ? offsetTransition(t) : 0;
  if(!dec) return;
  const e = animModels.get(target);
  if(!e || !e.action) return;
  e.action.time = dec * e.action.getClip().duration;
}

/** Un état de mélange dont chaque point est ramené à un nom de clip réellement jouable. */
export function resolvedBlend(target, state){
  const pts = (state.blend.points || []).map(function(pt){
    const r = settingsAnimFor(target, pt);
    return r ? Object.assign({}, pt, {clip: r.name}) : pt;
  });
  return Object.assign({}, state, {blend: Object.assign({}, state.blend, {points: pts})});
}

/** Le clip d'un objet, par son nom — y compris les clips découpés fabriqués ci-dessus. */
// LE SEUL GUICHET par où passe un clip avant d'être joué — base, couche par os, point de
// mélange. C'est donc ici, et nulle part ailleurs, que le mode « sur place » retire le
// déplacement des clés (`clipInPlace`, js/anim-blend.js).
export function clipByName(obj, name){
  const table = _clipsSliced.get(obj);
  const clips = clipsOf(obj);
  const found = (name && table && table.has(name))
    ? table.get(name).clip
    : (name ? (clips.find(function(c){ return c.name === name; }) || null) : (clips[0] || null));
  // Unity : un déplacement NON cuit dans la pose (onglet Animation, « Bake Into Pose » décoché)
  // sort toujours du clip ; sans root motion appliqué, il est perdu — le personnage reste sur
  // place. Seuls les clips dont le rig déclare sa racine portent `rootMotionInfo`.
  const mode = rootMotionActive(obj);
  const flatten = mode === 'inPlace'
    || (!mode && found && found.rootMotionInfo && found.rootMotionInfo.xz);
  return (found && flatten && typeof clipInPlace === 'function') ? clipInPlace(found) : found;
}

/**
 * Reconstruit les actions de `obj` : le clip de base sur les os que personne ne réclame, et
 * une action par couche sur sa propre chaîne d'os.
 *
 * Tout est refait d'un bloc à chaque changement, plutôt que modifié en place. Une couche
 * ajoutée change la part de la base : la mettre à jour « juste ce qu'il faut » demanderait de
 * savoir quels os viennent d'être cédés, et c'est précisément le calcul qu'on referait.
 */
export function rebuildActions(obj, fondu){
  const e = mixerOf(obj);
  const base = e.name ? clipByName(obj, e.name) : null;
  if(!base) return false;
  const part = splitBone(obj, e.layers);

  const ancienne = e.action;
  // La base garde tout SAUF les os cédés aux couches — et non « les os restants ». Un clip
  // peut animer autre chose que des os (la position d'un maillage, un nœud vide) : une liste
  // blanche d'os jetterait ces pistes-là sans rien dire.
  const taken = part.layers.reduce(function(acc, l){ return acc.concat(l); }, []);
  const clipBase = clipExcept(base, taken, 'base');
  // Un clip de base qui ne garde AUCUN os : les couches ont tout pris. Ce n'est pas une erreur
  // — c'est un mélange où le clip principal ne sert plus à rien — mais il ne faut pas lancer
  // une action vide pour autant.
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
    const clipC = clipByName(obj, c.name);
    const restricted = clipC ? clipRestricted(clipC, part.layers[i], 'c' + i) : null;
    if(!restricted){
      // La chaîne d'os n'existe pas dans ce clip, ou l'os de départ est introuvable. On le DIT :
      // une couche silencieusement inert se cherche longtemps.
      if(c.action){ c.action.stop(); c.action = null; }
      if(!c.signale){
        c.signale = true;
        logConsole('warn', 'Couche « ' + c.name + ' » depuis « ' + c.depuis + '  » : aucune '
          + 'piste ne correspond à ces os, elle ne joue rien.', obj);
      }
      return;
    }
    c.signale = false;
    const a = e.mixer.clipAction(restricted);
    a.setLoop(THREE.LoopRepeat, Infinity);
    a.timeScale = c.speed || 1;
    // Poids 1 par défaut, et c'est le cas exact : les os sont disjoints, donc aucune moyenne
    // à faire. Un poids < 1 mélange la couche avec la pose de repos de ses os, pas avec la
    // base — celle-ci ne les touche plus.
    a.setEffectiveWeight(c.weight === undefined ? 1 : c.weight);
    if(!a.isRunning()) a.reset().play();
    c.action = a;
  });
  return true;
}

// ---------- Mélange 1D : plusieurs clips sous UN paramètre ----------
//
// Les poids, le cycle commun et les vitesses de lecture vivent dans js/animator.js, qui est
// pur ; ici on ne fait que les brancher sur le mixeur.

/**
 * Met en place, ou rafraîchit, les actions d'un état de mélange.
 *
 * TOUS les clips du mélange tournent en permanence, y compris à poids nul. Ça paraît coûteux
 * et ça ne l'est pas : three saute l'interpolation d'une action de poids nul mais continue à
 * en advance le temps. Un clip qui reprend du poids est donc DÉJÀ en phase avec les autres,
 * sans qu'on ait à le repositionner — c'est-à-dire sans le seul endroit où un décalage d'un
 * demi-pas aurait pu s'introduire.
 */
export function applyBlendModel(obj, state, value){
  const e = mixerOf(obj);
  const pts = state.blend.points || [];
  // La signature englobe les couches : un mélange cède ses os aux couches exactement comme le
  // clip de base, donc les clips restreints sont à redo si la répartition change.
  const signature = state.name + '|' + e.layers.map(function(c){
    return c.name + '@' + c.depuis;
  }).join(',') + '|' + pts.map(function(p){ return p && p.clip; }).join(',');

  if(!e.blend || e.blend.signature !== signature){
    stopBlendModel(obj);
    // Le clip simple qui tournait avant n'a plus de raison d'être : sans ça, l'état précédent
    // continuerait sous le mélange, à poids plein, et personne ne verrait d'où ça vient.
    if(e.action){ e.action.stop(); e.action = null; e.name = null; }
    const part = splitBone(obj, e.layers);
    const taken = part.layers.reduce(function(acc, l){ return acc.concat(l); }, []);
    const actions = pts.map(function(pt, i){
      const c = (pt && pt.clip) ? clipByName(obj, pt.clip) : null;
      if(!c){
        if(pt && pt.clip) logConsole('warn', 'Mélange « ' + state.name + ' » : le clip « '
          + pt.clip + ' » n\'existe pas sur « ' + obj.name + ' », ce point est ignoré.', obj);
        return null;
      }
      const restricted = clipExcept(c, taken, 'blend');
      if(!restricted) return null;
      const a = e.mixer.clipAction(restricted);
      a.setLoop(THREE.LoopRepeat, Infinity);
      a.setEffectiveWeight(0);
      // Tous remis à zéro d'un coup : c'est le seul instant où la mise en phase se décide.
      a.reset().play();
      return a;
    });
    e.blend = {signature:signature, state:state.name, actions:actions,
                 weight:actions.map(function(){ return 0; }),
                 avant:actions.map(function(){ return 0; })};
  }

  const durationOf = function(name){
    const c = clipByName(obj, name);
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
  // L'action dominante sert de référence au reste de l'éditeur : marqueurs, progress de la
  // timeline, name affiché. Le déplacement de la racine, lui, est bien pondéré sur TOUTES les
  // parts — c'est la seule chose que suivre un seul clip rendrait faux.
  e.action = dominant >= 0 ? e.blend.actions[dominant] : null;
  e.name = dominant >= 0 ? (pts[dominant] || {}).clip || null : null;
  return true;
}

export function stopBlendModel(obj){
  const e = animModels.get(obj);
  if(!e || !e.blend) return;
  e.blend.actions.forEach(function(a){ if(a) a.stop(); });
  e.blend = null;
}

/**
 * Pose une couche : `nomClip` joué sur `depuis` et toute sa descendance.
 * Rejouer avec le même os de départ remplace la couche au lieu d'en empiler une seconde.
 */
export function layerAnimation(obj, nameClip, opts){
  const o = opts || {};
  if(!o.depuis){ logConsole('warn', 'Une couche a besoin d\'un os de départ', obj); return false; }
  if(!clipByName(obj, nameClip)) return false;
  const e = mixerOf(obj);
  if(!e.name){ logConsole('warn', 'Aucune animation de base : lancez-en une avant d\'y '
    + 'superposer une couche.', obj); return false; }
  const existante = e.layers.find(function(c){ return c.depuis === o.depuis; });
  const c = existante || {};
  c.name = nameClip; c.depuis = o.depuis;
  c.weight = (o.weight === undefined ? 1 : Number(o.weight));
  c.speed = (o.speed === undefined ? 1 : Number(o.speed)) || 1;
  if(!existante) e.layers.push(c);
  return rebuildActions(obj, o.fondu === undefined ? 0 : Number(o.fondu));
}

/** Retire une couche. Sans `depuis`, les retire toutes. */
export function removeLayer(obj, depuis){
  const e = animModels.get(obj);
  if(!e || !e.layers.length) return false;
  e.layers = e.layers.filter(function(c){
    if(depuis && c.depuis !== depuis) return true;
    if(c.action) c.action.stop();
    return false;
  });
  return rebuildActions(obj, 0);
}

// ---------- Machines à états : le pilotage image par image ----------
//
// La DÉCISION vit dans js/animator.js (partagé, pur, éprouvé hors navigateur). Ici on ne fait
// que la brancher : lire la progress du clip en cours, demander à la machine si l'on change
// d'état, et apply la réponse avec le fondu qu'elle indique.

export const playersAnimator = new Map();

export function machineOf(node){
  const ref = node && node.userData && node.userData.animator;
  if(!ref || !ref.assetId || typeof assets === 'undefined') return null;
  const a = assets.find(function(x){ return x.id === ref.assetId && x.kind === 'animator'; });
  return (a && a.machine) || null;
}

/** Le nœud réellement piloté — miroir de `AnimatorController.cible`, sans le composant. */
export function targetAnimator(node){
  const nameVoulu = ((node.userData.animator || {}).target || '').trim();
  let trouve = null;
  if(nameVoulu){
    node.traverse(function(o){ if(!trouve && o.name === nameVoulu) trouve = o; });
    return trouve;
  }
  if(clipsOf(node).length) return node;
  node.traverse(function(o){ if(!trouve && o !== node && clipsOf(o).length) trouve = o; });
  return trouve || node;
}

export function playerAnimatorOf(node){
  const machine = machineOf(node);
  if(!machine) return null;
  let l = playersAnimator.get(node);
  // Le lecteur est jeté dès que la machine change d'identité : garder un état d'une machine
  // qu'on vient de remplacer donnerait un état current qui n'existe plus, et une transition
  // introuvable — sans erreur, juste un personnage figé.
  if(!l || l.machine !== machine){
    l = createPlayerAnimator(machine);
    l.machine = machine;
    playersAnimator.set(node, l);
    // AUCUN effet de bord ici, et c'est le point : cette fonction est appelée par l'inspecteur
    // simplement pour AFFICHER l'état current. Y lancer le clip faisait démarrer l'animation
    // dès qu'on sélectionnait l'objet — aperçu éteint ou non —, et le personnage redevenait
    // impossible à animer à la main. Mesuré : `animationInProgress` rendait un clip alors que
    // l'aperçu était off. C'est `updateAnimators` qui joue, et lui seul.
  }
  return l;
}

export function stopAnimator(node){ playersAnimator.delete(node); }

// ---------- Root motion : apply le déplacement du clip à l'OBJET ----------
//
/**
 * Reporte sur l'objet ce que les clips ont fait parcourir à la racine, et l'ANNULE sur l'os.
 *
 * Sans l'annulation, le déplacement compterait deux fois : une fois sur l'objet, une fois sur
 * le bassin — le personnage s'éloignerait de son propre squelette.
 *
 * Seuls X et Z sont reportés. La composante verticale reste sur l'os : c'est le balancement du
 * bassin pendant la marche, et le porter sur l'objet ferait sautiller le personnage entier.
 * (Un saut a besoin de Y, mais il a aussi besoin d'un contrôleur qui décide de la gravité —
 * ce n'est pas à l'animation de trancher ça.)
 *
 * `parts` : [{action, tAvant, poids}]. Une seule part dans le cas current ; plusieurs quand
 * l'état est un mélange, et le déplacement est alors la somme PONDÉRÉE — voir plus bas.
 *
 * N'est appelée QUE pour le mode 'move'. Le mode 'inPlace' ne corrige rien après coup : son
 * déplacement est retiré des clés du clip avant qu'il soit joué (`clipInPlace`, js/anim-blend.js).
 */
export function applyRootMotion(obj, target, parts){
  // Le calcul est PARTAGÉ avec le runtime (`stepRootMotion`, js/anim-blend.js) : quelles
  // composantes sortent du clip dépend de ses réglages « Bake Into Pose » (onglet Animation).
  // Le déplacement est exprimé dans le repère du MODÈLE ; `applyRootStep` l'oriente et
  // l'échelonne comme l'objet — un modèle Mixamo est à l'échelle 0,01, et appliquer les
  // centimètres du clip tels quels enverrait le personnage à cent fois trop loin.
  applyRootStep(obj, stepRootMotion(target, parts));
}

// ---------- Inertialisation ----------
//
// La courbe vit dans js/animator.js, qui est pur ; ici on la branche sur un squelette. Trois
// pièces : garder deux images de pose, armer la résorption au moment d'une transition, et
// apply l'écart après chaque pas du mixeur.

export const _boneAnimated = new WeakMap();

/** Les nœuds qu'un clip adresse — c'est sur eux, et eux seuls, que l'écart s'applique. */
export function boneAddressesBy(target, clip){
  let byClip = _boneAnimated.get(target);
  if(!byClip){ byClip = new Map(); _boneAnimated.set(target, byClip); }
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

/**
 * Mémorise la pose AFFICHÉE, sur deux images.
 *
 * Deux, et pas une : une transition arrive sans prévenir, et la VITESSE qu'avait chaque os juste
 * avant ne peut pas se retrouver après coup. C'est la pose affichée qu'on relève, pas celle du
 * clip — s'il y avait déjà une résorption en cours, c'est d'elle qu'il faut repartir, sinon la
 * seconde transition ferait ressurgir l'écart que la première était en train d'effacer.
 */
export function surveyPoseShown(e, target, dt){
  const os = e.action ? boneAddressesBy(target, e.action.getClip()) : [];
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

export const _qInertiaA = new THREE.Quaternion(), _qInertiaB = new THREE.Quaternion(), _qInertiaC = new THREE.Quaternion();
export const _vInertiaA = new THREE.Vector3(), _vInertiaB = new THREE.Vector3();

/**
 * Arme la résorption : mesure l'écart entre la pose affichée et celle que le nouveau clip veut.
 *
 * À appeler APRÈS le pas du mixeur qui a écrit la pose d'arrivée. La vitesse de départ est la
 * différence des DEUX vitesses — celle qu'avait le personnage MOINS celle du clip d'arrivée.
 * N'en prendre qu'une donnerait à la sortie la somme des deux au lieu de la seule source.
 *
 * Ce que ça vaut, mesuré plutôt que supposé : sur un balayage d'un cycle entier, le pire saut
 * de vitesse passe de 2,61 à 2,53 fois la variation naturelle. C'est petit — le résidu vient
 * d'ailleurs (l'axe de l'écart est figé au départ alors que la vraie différence tourne). On le
 * garde parce que c'est la formule juste et qu'elle ne coûte qu'une lecture d'interpolant déjà
 * en hidden, pas parce qu'elle sauverait le raccord.
 */
export function armInertia(e, target, duration){
  const os = e.boneReleves || [];
  if(!(duration > 0) || !os.length || e.imagesRelevees < 2 || !e.action) return;
  const clip = e.action.getClip();
  const dt = e.dtReleve > 0 ? e.dtReleve : 1 / 60;
  const tTarget = e.action.time;
  const parts = [];
  os.forEach(function(o, i){
    const k = i * 7;
    // Vitesse du clip d'ARRIVÉE, lue dans ses pistes. En avant plutôt qu'en arrière : l'action
    // vient d'être remise à zéro, il n'y a rien avant elle.
    const cA = poseOfClipFor(clip, o.name, tTarget);
    const cB = poseOfClipFor(clip, o.name, tTarget + dt * (e.action.timeScale || 1));

    // --- rotation ---
    _qInertiaA.set(e.poseCurrent[k + 3], e.poseCurrent[k + 4], e.poseCurrent[k + 5], e.poseCurrent[k + 6]);
    _qInertiaB.copy(o.quaternion);                                   // la pose que le clip vient d'écrire
    _qInertiaC.copy(_qInertiaB).invert().premultiply(_qInertiaA);                  // écart = affichée ⊖ cible
    if(_qInertiaC.w < 0) _qInertiaC.set(-_qInertiaC.x, -_qInertiaC.y, -_qInertiaC.z, -_qInertiaC.w);    // le chemin court, pas le long
    const sin = Math.hypot(_qInertiaC.x, _qInertiaC.y, _qInertiaC.z);
    if(sin > 1e-9){
      const angle = 2 * Math.atan2(sin, _qInertiaC.w);
      const axe = new THREE.Vector3(_qInertiaC.x / sin, _qInertiaC.y / sin, _qInertiaC.z / sin);
      // La même mesure une image plus tôt, PROJETÉE sur le même axe : c'est la variation de
      // l'écart le long d'une direction fixe qui donne sa vitesse, pas deux angles sans rapport.
      _qInertiaA.set(e.poseBefore[k + 3], e.poseBefore[k + 4], e.poseBefore[k + 5], e.poseBefore[k + 6]);
      _qInertiaC.copy(_qInertiaB).invert().premultiply(_qInertiaA);
      if(_qInertiaC.w < 0) _qInertiaC.set(-_qInertiaC.x, -_qInertiaC.y, -_qInertiaC.z, -_qInertiaC.w);
      const angleBefore = 2 * Math.atan2(_qInertiaC.x * axe.x + _qInertiaC.y * axe.y + _qInertiaC.z * axe.z, _qInertiaC.w);
      let v0 = (angle - angleBefore) / dt;
      if(cA.quat && cB.quat){
        _qInertiaA.fromArray(cA.quat); _qInertiaB.fromArray(cB.quat);
        _qInertiaC.copy(_qInertiaA).invert().premultiply(_qInertiaB);
        if(_qInertiaC.w < 0) _qInertiaC.set(-_qInertiaC.x, -_qInertiaC.y, -_qInertiaC.z, -_qInertiaC.w);
        const dTarget = 2 * Math.atan2(_qInertiaC.x * axe.x + _qInertiaC.y * axe.y + _qInertiaC.z * axe.z, _qInertiaC.w);
        v0 -= dTarget / dt;
      }
      const coef = coefficientsInertia(angle, v0, duration);
      if(coef) parts.push({os:o, axe:axe, coef:coef, rot:true});
    }

    // --- position ---
    _vInertiaA.set(e.poseCurrent[k], e.poseCurrent[k + 1], e.poseCurrent[k + 2]);
    _vInertiaB.copy(o.position);
    const d = _vInertiaA.clone().sub(_vInertiaB);
    const dist = d.length();
    if(dist > 1e-9){
      const dir = d.clone().divideScalar(dist);
      _vInertiaA.set(e.poseBefore[k], e.poseBefore[k + 1], e.poseBefore[k + 2]);
      const distBefore = _vInertiaA.sub(_vInertiaB).dot(dir);
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

/** Applique l'écart restant. À appeler APRÈS le pas du mixeur, et après la racine motion. */
export function applyInertia(e, dt){
  if(!e.inertia) return;
  e.inertia.t += dt;
  let live = 0;
  e.inertia.parts.forEach(function(p){
    const x = evaluateInertia(p.coef, e.inertia.t);
    if(x === 0) return;
    live++;
    if(p.rot) p.os.quaternion.premultiply(_qInertiaA.setFromAxisAngle(p.axe, x));
    else p.os.position.addScaledVector(p.dir, x);
  });
  // On lâche la structure dès que plus rien ne décroît : la garder ferait tourner une boucle sur
  // tout le squelette à chaque image, pour add zéro.
  if(!live) e.inertia = null;
}

/** Les parts de racine motion d'un objet : son mélange s'il en joue un, sinon sa seule action. */
export function partsRootMotion(e, avant){
  if(e.blend){
    return e.blend.actions.map(function(a, i){
      return {action:a, tBefore:e.blend.avant[i], weight:e.blend.weight[i]};
    });
  }
  return [{action:e.action, tBefore:avant, weight:1}];
}

/** Progression 0→1 du clip en cours sur cet objet. 0 s'il n'en joue aucun. */
export function progressClip(obj){
  const e = animModels.get(obj);
  if(!e || !e.action) return 0;
  const d = e.action.getClip().duration;
  return d > 0 ? Math.min(1, e.action.time / d) : 1;
}

/**
 * L'aperçu des machines dans l'ÉDITEUR : éteint par défaut.
 *
 * Il tournait en permanence, et ça cassait le travail de l'utilisateur : `setKey` refuse une
 * clé sur un os quand un clip joue — « arrêtez-le avant de poser des clés » —, donc attacher un
 * Animator rendait le personnage impossible à animer à la main. Mesuré, pas supposé.
 *
 * Même choix qu'Unity, dont l'Animator ne tourne qu'en mode Jeu. En mode Jeu et dans le jeu
 * publié, l'aperçu est sans objet : la machine tourne toujours.
 */
export const previewAnimator = {active: false};

export function togglePreviewAnimator(v){
  previewAnimator.active = (v === undefined) ? !previewAnimator.active : !!v;
  if(!previewAnimator.active){
    // On rend la pose de repos plutôt que de laisser le personnage figé au milieu d'un pas :
    // c'est cette pose-là qu'on veut retrouver pour poser une clé.
    Registry.activeNodes('AnimatorController').forEach(function(o){
      if(!o.userData.animator || !o.userData.animator.assetId) return;
      const target = targetAnimator(o);
      if(!target) return;
      stopAnimationModel(target);
      const sq = skeletonOf(target);
      if(sq && sq.pose) sq.pose();
      stopAnimator(o);
    });
  }
  if(typeof drawGraph === 'function') drawGraph();
  buildInspector();
  return previewAnimator.active;
}

/** Appelée à chaque image, AVANT `updateAnimationsModels` : décider puis agir. */
export function updateAnimators(dt){
  if(typeof updatePlayerAnimator !== 'function') return;
  if(!previewAnimator.active) return;
  // Porteurs d'un composant AnimatorController, lus au Registry : avant, toute la scène était
  // parcourue à CHAQUE image pour trouver les quelques personnages qui ont une machine à états.
  Registry.activeNodes('AnimatorController').forEach(function(o){
    if(!o.userData.animator || !o.userData.animator.assetId) return;
    const l = playerAnimatorOf(o);
    if(!l) return;
    const target = targetAnimator(o);
    if(!target) return;
    // Remettre le clip de l'état current s'il ne joue pas : c'est le cas au premier tour, et
    // à chaque rallumage de l'aperçu. Sans cette reprise, allumer l'aperçu ne relancerait rien
    // tant qu'aucune transition ne se produit — un personnage figé sur une machine qui tourne.
    const stateCurrent = stateOfMachine(l.machine, l.state);
    if(isStateBlend(stateCurrent)){
      // Un mélange est réévalué à CHAQUE image : son paramètre bouge en continu, ce n'est pas
      // un clip qu'on lance une fois. Les vitesses de lecture en dépendent, donc la phase aussi.
      applyBlendModel(target, resolvedBlend(target, stateCurrent),
        l.params[stateCurrent.blend.param]);
    } else {
      stopBlendModel(target);
      const voulu = settingsAnimFor(target, stateCurrent);
      if(voulu && animationInProgress(target) !== voulu.name){
        playAnimationModel(target, voulu.name,
          {loop:voulu.loop, speed:voulu.speed, fondu:0});
        applyCycleOffset(target, voulu.cycleOffset, 0);
      }
    }
    const t = updatePlayerAnimator(l.machine, l, dt, progressClip(target));
    if(!t) return;
    const arrivee = stateOfMachine(l.machine, l.state);
    // Inertialisation : le nouveau clip démarre SEUL et à plein régime — fondu nul — et c'est
    // l'écart avec la pose affichée qui est résorbé, après le pas du mixeur. On ne peut pas
    // l'armer ici : la pose d'arrivée n'est pas encore écrite.
    const eMix = mixerOf(target);
    // La durée du fondu dépend du clip de DÉPART quand `dureeFixe` est faux (le Fixed Duration
    // d'Unity) : on la calcule donc AVANT de lancer le clip d'arrivée, pendant que l'action en
    // cours est encore celle qu'on quitte.
    const durationStart = eMix.action ? eMix.action.getClip().duration : 0;
    const fonduSec = durationTransition(t, durationStart);
    eMix.inertiaArm = t.inertia ? fonduSec : 0;
    const fondu = t.inertia ? 0 : fonduSec;
    if(isStateBlend(arrivee)){
      applyBlendModel(target, resolvedBlend(target, arrivee),
        l.params[arrivee.blend.param]);
      return;
    }
    stopBlendModel(target);
    const voulu = settingsAnimFor(target, arrivee);
    // Un état sans clip jouable ne doit pas laisser tourner le précédent en douce : c'est le
    // kind d'erreur de saisie qu'on met sur le compte de l'animation.
    if(voulu){
      playAnimationModel(target, voulu.name,
        {loop:voulu.loop, speed:voulu.speed, fondu:fondu});
      // Transition Offset : le clip d'arrivée ne démarre pas forcément à sa première image.
      // Posé APRÈS le lancement, sinon `rebuildActions` remettrait le temps à zéro.
      applyOffsetTransition(target, t);
      applyCycleOffset(target, voulu.cycleOffset,
        (typeof offsetTransition === 'function') ? offsetTransition(t) : 0);
    }
    else logConsole('warn', 'Animator : l\'état « ' + l.state + ' » ne joue aucun clip '
      + 'connu de « ' + target.name + ' »', o);
  });
}

/**
 * Bascule les machines de la scène courante de `clip: "marche"` vers `animation: "aNN"`.
 *
 * Appelée à l'ouverture d'un projet et à chaque changement de scène — et pas une seule fois au
 * chargement, parce qu'une seule scène est instanciée à la fois : les machines des autres
 * scènes n'ont, à cet instant, aucun objet porteur d'où lire le modèle. Elles migreront à
 * l'ouverture de leur scène, et jouent d'ici là par le repli `clip`.
 *
 * UNE MACHINE PORTÉE PAR DEUX MODÈLES DIFFÉRENTS N'EST PAS MIGRÉE. « marche » n'y désigne pas
 * le même clip, et deviner recâblerait en silence l'animation d'un personnage sur celle d'un
 * autre. `validateAnimator` le signale à qui peut encore le corriger.
 */
export function migrateMachinesOfScene(){
  if(typeof migrateStatesToAnimAssets !== 'function') return 0;
  const byMachine = new Map();     // asset animator -> Set(id d'asset modèle)
  Registry.activeNodes('AnimatorController').forEach(function(o){
    const ref = o.userData && o.userData.animator;
    if(!ref || !ref.assetId) return;
    const machine = assets.find(function(x){ return x.id === ref.assetId && x.kind === 'animator'; });
    if(!machine) return;
    const target = targetAnimator(o);
    const model = target && target.userData && target.userData.assetId;
    if(!model) return;
    if(!byMachine.has(machine)) byMachine.set(machine, new Set());
    byMachine.get(machine).add(model);
  });

  let total = 0;
  byMachine.forEach(function(models, machine){
    if(models.size !== 1) return;
    const modelId = models.values().next().value;
    const model = assets.find(function(x){ return x.id === modelId; });
    const clips = (model && model.template && model.template.animations) || [];
    total += migrateStatesToAnimAssets(machine.machine, {
      model: modelId,
      clipsConnus: clips.map(function(c){ return c.name; }),
      findOrCreate: findOrCreateAssetAnimation
    });
  });
  if(total) updateProject();
  return total;
}

/** Les couches en cours, pour l'inspecteur et pour la sauvegarde. */
export function layersOf(obj){
  const e = animModels.get(obj);
  return e ? e.layers.map(function(c){
    return {name:c.name, depuis:c.depuis, weight:c.weight, speed:c.speed};
  }) : [];
}

/**
 * Joue un clip. `opts` : {loop:true, vitesse:1, fondu:0.2}.
 * Un fondu non nul enchaîne proprement depuis le clip en cours.
 */
export function playAnimationModel(obj, name, opts){
  // `clipByName` et non une recherche dans `clipsOf` : les clips DÉCOUPÉS d'un asset
  // d'animation ne sont pas dans la liste de l'objet — les y verser ferait jouer la découpe
  // à tout ce qui demande encore le clip entier.
  const clip = clipByName(obj, name);
  if(!clip) return false;

  const o = opts || {};
  const e = mixerOf(obj);
  // Les réglages sont retenus sur le mixeur, pas seulement appliqués : poser une couche
  // reconstruit l'action de base, et il faut alors pouvoir lui redonner sa boucle et sa vitesse.
  e.name = clip.name;
  e.loop = o.loop;
  e.speed = (o.speed === undefined ? 1 : Number(o.speed)) || 1;
  // Changer de clip de base garde les couches en place : on passe de « marcher » à « courir »
  // sans cesser de viser.
  return rebuildActions(obj, o.fondu === undefined ? 0.2 : Number(o.fondu));
}

export function stopAnimationModel(obj){
  const e = animModels.get(obj);
  if(!e) return;
  e.mixer.stopAllAction();
  e.action = null;
  e.name = null;
  // Les couches partent avec la base : ce sont des couches SUR quelque chose, et les laisser
  // tourner seules donnerait un personnage qui aims dans le vide, torse animé et jambes figées.
  e.layers = [];
  // `stopAllAction` a déjà arrêté les actions du mélange, mais la trace, elle, resterait : le
  // prochain état de mélange retrouverait sa signature inchangée et ne rejouerait rien.
  e.blend = null;
}

export function animationInProgress(obj){
  const e = animModels.get(obj);
  return e ? e.name : null;
}

/** Appelée à chaque image. dt en secondes. */
export function updateAnimationsModels(dt){
  if(!animModels.size) return;
  animModels.forEach(function(e, obj){
    // objet détruit ou sorti de la scène : on libère le mixeur
    if(!obj.parent){ e.mixer.stopAllAction(); animModels.delete(obj); return; }
    // Le temps est relevé AVANT et APRÈS le pas du mixeur, et pas calculé à partir de `dt` :
    // l'action a sa propre vitesse, elle peut boucler, être en fondu ou à l'arrêt. Le seul
    // temps juste est celui que le mixeur vient d'écrire.
    const avant = e.action ? e.action.time : 0;
    // Chaque clip d'un mélange a son propre temps — c'est même tout l'objet du lot — donc son
    // propre « avant ». Relever celui de la seule action dominante donnerait à l'autre un
    // déplacement calculé sur un intervalle qui n'est pas le sien.
    if(e.blend) e.blend.actions.forEach(function(a, i){
      e.blend.avant[i] = a ? a.time : 0;
    });
    e.mixer.update(dt);
    if(e.action) markersDuringPlayback(obj, e.action, avant);
    // Root motion APRÈS le pas du mixeur : c'est lui qui vient d'écrire la pose de la racine,
    // et c'est cette pose-là qu'on annule après l'avoir reportée sur l'objet.
    // 'inPlace' ne passe PAS par ici : son déplacement a déjà été retiré des CLÉS du clip
    // (`clipByName` → `clipInPlace`). Il n'y a donc rien à reporter, et rien à annuler.
    if(e.action && rootMotionActive(obj) === 'move'){
      applyRootMotion(holderAnimator(obj), obj, partsRootMotion(e, avant));
    }
    // L'inertialisation vient APRÈS la racine motion : celle-ci réécrit la position de la racine
    // à sa pose de repos, et le ferait donc sur un os qu'on vient d'écarter — l'écart serait
    // effacé sur le seul os qui porte le déplacement.
    if(e.inertiaArm){ armInertia(e, obj, e.inertiaArm); e.inertiaArm = 0; }
    applyInertia(e, dt);
    // Relevé EN DERNIER : c'est la pose affichée qu'on mémorise, écart compris. Relever avant
    // reviendrait à repartir, à la transition suivante, d'une pose que personne n'a vue.
    if(holderAnimator(obj)) surveyPoseShown(e, obj, dt);
  });
}

/**
 * Quel root motion est demandé pour cet objet : '' (aucun), 'move' ou 'inPlace' ?
 *
 * Réglage EXPLICITE, et c'est délibéré : si un corps physique ou un script déplace déjà le
 * personnage, deux écritures se disputeraient la même position. On ne devine pas — root motion
 * OU déplacement piloté, jamais les deux en silence.
 *
 * 'inPlace' est le troisième cas, et il manquait : il ANNULE la translation du bassin sans la
 * reporter sur l'objet. C'est ce qu'il faut à un personnage dont un script pose la vitesse et
 * dont les clips portent leur propre déplacement — Mixamo, et la plupart des packs. Sans lui, un
 * tel pack n'avait que deux réglages : l'animation conduit le personnage, ou le modèle dérive
 * hors de son pivot pendant que le script le déplace par-dessus.
 *
 * Le champ sérialisé ne change pas de forme : `true` vaut 'move', absent ou faux vaut ''. Aucune
 * scène déjà enregistrée ne change de comportement.
 */
export function rootMotionActive(target){
  const p = holderAnimator(target);
  const v = p && p.userData.animator ? p.userData.animator.rootMotion : null;
  if(v === 'inPlace') return 'inPlace';
  return v ? 'move' : '';
}

/**
 * L'objet de projet qui porte l'Animator.
 *
 * C'est lui qu'on déplace en root motion — pas l'os. Il sert aussi à savoir si un objet est
 * candidat à l'inertialisation, d'où le nom : « porteurRootMotion » aurait menti sur le second
 * usage, et un nom qui ment coûte plus cher qu'un nom long.
 */
export function holderAnimator(target){
  let n = target;
  while(n){
    if(n.userData && n.userData.animator && n.userData.animator.assetId) return n;
    n = n.parent;
  }
  return null;
}

/** Émet les événements des marqueurs franchis par une action en cours de lecture. */
export function markersDuringPlayback(obj, action, tBefore){
  if(typeof triggerMarkers !== 'function' || action.paused) return;
  const clip = action.getClip();
  // Un clip DÉCOUPÉ par un asset d'animation porte un nom dérivé que `sourceOfClipPlays` ne
  // connaît pas : on remonte au clip source, et les marqueurs sont ensuite remis dans le temps
  // du clip découpé. Sans ça, une découpe ferait taire tous les sons de pas — en silence.
  const derive = (typeof readNameClipDerived === 'function') ? readNameClipDerived(clip.name) : null;
  const src = sourceOfClipPlays(obj, derive ? derive.clip : clip.name);
  if(!src) return;
  const asset = assets.find(function(a){ return a.id === src.asset; });
  let list = markersOfClip(asset, src.clip);
  if(derive){
    const dec = assets.find(function(a){ return a.id === derive.asset; });
    const r = (typeof resolveAnimAsset === 'function') ? resolveAnimAsset(dec, assetByIdAnim) : null;
    const base = r ? clipByName(obj, r.clip) : null;
    if(r && base){
      const b = boundsAnimAsset(r, base.duration);
      list = markersAdjusted(list, b.start, b.end);
    }
  }
  if(!list.length) return;
  triggerMarkers(list, tBefore, action.time, clip.duration,
    action.loop !== THREE.LoopOnce, true, function(name){
      (engineScripts.ecouteurs[name] || []).forEach(function(fn){
        try{ fn(); } catch(err){
          logConsole('error', 'marqueur « ' + name + ' » : ' + err.message, obj);
        }
      });
    });
}



// EXPOSÉ EN GLOBALE, à dessein. Ces symboles sont appelés depuis des fichiers
// que les mêmes pages ne chargent pas toutes : un `import` y pointerait un
// fichier absent, et la page ne démarrerait pas. Ils gardent donc leur garde
// `typeof` côté appelant, et se déclarent ici.
globalThis.clipsOf = clipsOf;
globalThis.rebindSkeletons = rebindSkeletons;
globalThis.externalClipsOf = externalClipsOf;
globalThis.layerAnimation = layerAnimation;
globalThis.removeLayer = removeLayer;
globalThis.stopAnimator = stopAnimator;