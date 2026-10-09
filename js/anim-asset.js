// ---------- L'asset d'animation : un clip, plus ses réglages ----------
//
// Jusqu'ici un état de machine désignait son animation par un NOM DE CHAÎNE (`clip: "idle"`),
// résolu dans les clips du modèle importé. Rien à glisser depuis le panneau d'assets, rien à
// régler, rien à partager : le nom n'existait que dans le fichier de la machine.
//
// Un asset d'animation RÉFÉRENCE un clip, il ne le recopie pas. Un clip cuit dupliquerait les
// données du `.glb` et les deux copies divergeraient au premier réimport. C'est aussi ce que
// fait Unity, dont le `.anim` d'un modèle importé n'est qu'une vue sur le fichier source.
//
// LE FORMAT (`.animation.json`) :
//
//   {
//     "format": "animation", "version": 1,
//     "source": { "asset": "a3", "clip": "Armature|Walk" },
//     "vitesse": 1, "loop": true, "debut": 0, "fin": null
//   }
//
// `debut`/`fin` sont en SECONDES DU CLIP SOURCE ; `fin: null` = jusqu'au bout.
//
// Ce fichier ne connaît ni three ni le DOM : il décide, l'appelant agit. C'est ce qui le rend
// éprouvable hors navigateur, et c'est pourquoi il est PARTAGÉ tel quel avec le runtime du jeu
// publié — une divergence éditeur/runtime ne se verrait qu'après export.
//
// LES MARQUEURS N'Y SONT PAS, et c'est délibéré : ils appartiennent déjà à l'asset du MODÈLE,
// indexés par nom de clip (js/anim-markers.js). Les recopier ici ferait deux propriétaires
// pour la même donnée, donc deux vérités le jour où l'une des deux est modifiée. L'asset
// d'animation n'en est que la surface d'édition, et `markersAdjusted` les remet dans le temps
// du clip découpé au moment de les jouer.

import { applyEasing, segmentAt } from './track-sampling.js';

// DEUX SOURCES, comme Unity. Un clip y vient soit d'un fichier importé (sous-asset du modèle,
// en lecture seule), soit de la fenêtre Animation, où on le crée VIDE et où on pose des clés.
// Nous avons les deux sous le même genre d'asset :
//
//   "source": {"type":"modele", "asset":"a3", "clip":"Walk"}      ← référence un .glb
//   "source": {"type":"cles"}                                     ← clés posées dans l'éditeur
//
// Un clip à clés porte ses pistes :
//
//   "duration": 2, "imagesParSeconde": 60,
//   "pistes": [ {"chemin":"",       "os":null,             "cles":[…]},
//               {"chemin":"Bras",   "os":null,             "cles":[…]},
//               {"chemin":"",       "os":"mixamorig:Head", "cles":[…]} ]
//
// `chemin` est le CHEMIN RELATIF à la racine animée — le `relativePath` de
// `AnimationClip.SetCurve(relativePath, type, propriété, courbe)`. `""` = la racine elle-même.
// C'est ce qui rend un clip réutilisable : il ne cite aucun objet de scène par identifiant, il
// décrit une forme de hiérarchie. Notre timeline, elle, aims des objets par id — c'est pour ça
// qu'elle ne pouvait pas produire de clip.
//
// `os` désigne un os du squelette au lieu d'un enfant : chez nous les os ne sont pas des objets
// de projet (js/skeleton.js), ils n'ont donc pas de chemin. three, lui, résout un nom d'os
// n'importe où dans le sous-arbre, exactement comme un nom d'enfant.
//
// CE QU'ON N'A PAS, et il vaut mieux le dire que le laisser découvrir : Unity stocke des
// COURBES par canal (position.x séparée de position.y), avec tangentes éditables. Nos clés
// portent la transformée entière et une courbe d'accélération choisie dans une liste. La
// compilation échantillonne donc à `imagesParSeconde` plutôt que d'exporter des tangentes.

export const ANIM_ASSET_VERSION = 2;

/** La source d'un asset, avec le défaut qui rend les assets de la v0.52 lisibles. */
export function typeSourceAnim(asset){
  const src = (asset && asset.source) || {};
  if(src.type) return src.type;
  return src.asset ? 'model' : 'keys';
}

export function isAnimAKeys(asset){ return typeSourceAnim(asset) === 'keys'; }

/**
 * Résout un asset d'animation en `{modele, clip, vitesse, loop, debut, fin}`, ou null.
 *
 * `trouverAsset` est une fonction `id -> asset` : l'éditeur cherche dans son tableau `assets`,
 * le runtime dans sa table par id. Passer la fonction plutôt que la collection est ce qui
 * permet aux deux côtés d'appeler LE MÊME code.
 *
 * Rend null — jamais une exception — si la source a disparu. Un asset cassé doit laisser le
 * personnage sur son clip précédent et se signaler dans la validation, pas arrêter la boucle
 * de rendu.
 */
export function resolveAnimAsset(asset, findAsset){
  if(!asset) return null;
  // Une vitesse nulle ou négative fige le clip sans rien dire, quel que soit le type de source.
  const vRaw = Number(asset.speed);
  const commun = {
    speed: (isFinite(vRaw) && vRaw > 0) ? vRaw : 1,
    loop: asset.loop === undefined ? true : !!asset.loop
  };
  if(isAnimAKeys(asset)){
    // Un clip à clés sans aucune clé ne se résout pas : compilé, il donnerait une
    // `AnimationClip` sans piste, que three joue sans rien animer et sans rien dire.
    const aOfKeys = (asset.tracks || []).some(function(p){ return p && p.keys && p.keys.length; });
    if(!aOfKeys) return null;
    return Object.assign(commun, {type:'keys', model:null, clip:null, start:0, end:null});
  }
  if(!asset.source || !asset.source.asset || !asset.source.clip) return null;
  const model = findAsset ? findAsset(asset.source.asset) : null;
  if(!model) return null;
  // Les réglages de l'onglet Animation (v0.159). Un asset autonome d'avant ne les a pas : ses
  // défauts reproduisent exactement ce qu'il jouait.
  const s = normalizeClipSettings(asset);
  const rig = model.paramsImport || {};
  return Object.assign(commun, {
    type: 'model',
    model: asset.source.asset,
    clip: asset.source.clip,
    start: Number(asset.start) || 0,
    end: (asset.end === undefined || asset.end === null) ? null : Number(asset.end),
    loopPose: s.loopPose, cycleOffset: s.cycleOffset, mirror: s.mirror,
    rootRotationBake: s.rootRotationBake, rootRotationOffset: s.rootRotationOffset,
    rootYBake: s.rootYBake, rootYOffset: s.rootYOffset, rootXZBake: s.rootXZBake,
    maskBones: s.maskBones,
    // La racine du root motion est un réglage du RIG du fichier source (« Root node » d'Unity).
    // Vide : le comportement d'avant — la première piste de position fait office de racine.
    rootNode: rig.rootNode || null
  });
}

/**
 * Les bounds réelles de la découpe, ramenées dans la durée du clip.
 *
 * Une découpe vide ou inversée rend le clip ENTIER plutôt que rien : un clip de durée nulle ne
 * se voit pas à l'écran, alors qu'un clip trop long se voit et se corrige.
 */
export function boundsAnimAsset(settings, duration){
  const d = Number(duration) || 0;
  let start = Math.max(0, Math.min(d, Number((settings || {}).start) || 0));
  const raw = (settings || {}).end;
  let end = (raw === undefined || raw === null) ? d : Math.max(0, Math.min(d, Number(raw) || 0));
  if(!(end > start)){ start = 0; end = d; }
  return {start: start, end: end};
}

/** Y a-t-il vraiment quelque chose à découper ? */
export function sliceUseful(bounds, duration){
  return bounds.start > 1e-4 || bounds.end < (Number(duration) || 0) - 1e-4;
}

/**
 * Le nom du clip DÉRIVÉ d'un asset découpé.
 *
 * Le clip découpé vit à côté du clip source dans `obj.animations` : il lui faut donc un nom à
 * lui, sinon il l'écraserait, et tout ce qui joue encore le clip entier jouerait la découpe.
 * Le nom dépend de l'asset et de lui seul, pour que deux découpes différentes du même clip
 * cohabitent et que la même découpe soit retrouvée au lieu d'être recuite.
 */
export function nameClipDerived(nameClip, assetId){
  return nameClip + '⟨' + assetId + '⟩';
}

/** Est-ce le nom d'un clip dérivé, et de quel asset ? */
export function readNameClipDerived(name){
  const m = /^(.*)⟨([^⟩]+)⟩$/.exec(name || '');
  return m ? {clip: m[1], asset: m[2]} : null;
}

/**
 * Les marqueurs d'un clip, remis dans le temps du clip DÉCOUPÉ.
 *
 * Un marker hors de la découpe disparaît : le clip ne passe jamais par cet instant, et le
 * garder ferait tirer un son de pas à un moment qui n'existe plus.
 */
export function markersAdjusted(list, start, end){
  const l = list || [];
  if(!start && (end === null || end === undefined)) return l;
  const d = Number(start) || 0;
  const f = (end === null || end === undefined) ? Infinity : Number(end);
  return l.filter(function(m){ return m && m.t >= d && m.t <= f; })
    .map(function(m){ return Object.assign({}, m, {t: m.t - d}); });
}

// ---------- Clips à clés : échantillonnage et compilation ----------
//
// La courbe d'accélération est portée par la clé de DÉPART du segment. Elle vivait dans
// js/animation.js, qui est éditeur seul ; elle est ici parce qu'un clip à clés doit se
// compiler à l'identique dans le jeu publié. Deux lectures de « douce » donneraient deux
// animations différentes, et ça ne se verrait qu'après export.

// L'easing et l'échantillonnage vivent dans js/track-sampling.js, partagé et non retirable : ils
// existaient ici, dans js/animation.js et dans js/game-runtime.js, et ces copies avaient divergé
// (revue du 2026-09-29, § 1.7). Les deux noms restent, pour les appelants et les tests.
export function applyEasingAnim(easing, a){ return applyEasing(easing, a); }

/**
 * Où en est une piste à l'instant `t` : `{avant, apres, alpha}`, alpha déjà passé à l'easing.
 *
 * Rendu sous cette forme plutôt qu'en pose calculée : l'interpolation d'un quaternion est un
 * slerp, qui a besoin de three, et ce fichier n'en dépend pas. L'appelant compose.
 */
export function segmentOfTrack(keys, t){ return segmentAt(keys, t); }

/** La durée utile d'un clip à clés : la dernière clé, jamais moins que ce qui est déclaré. */
export function durationAnimAKeys(asset){
  let end = 0;
  ((asset && asset.tracks) || []).forEach(function(p){
    ((p && p.keys) || []).forEach(function(c){ if(c && c.t > end) end = c.t; });
  });
  const declaree = Number((asset || {}).duration) || 0;
  return Math.max(end, declaree, 0.0001);
}

/**
 * Le nom de piste three d'un chemin relatif : `'Bras/Main'` → `'Bras/Main.position'`, `''` →
 * `'.position'` (la racine du mixeur, comme le `relativePath` empty d'Unity).
 *
 * Un os court-circuite le chemin : three résout un nom de nœud n'importe où dans le sous-arbre,
 * et chez nous un os n'a pas de chemin puisqu'il n'est pas un objet de projet.
 */
export function nameTrackThree(track, property){
  const target = (track && track.os) ? track.os : ((track && track.filePath) || '');
  return target + '.' + property;
}

/**
 * Compile un clip à clés en DONNÉES de pistes three : `[{name, temps, valeurs, taille}]`.
 *
 * Échantillonné à `imagesParSeconde` plutôt qu'exporté clé à clé, et c'est le prix de nos
 * courbes d'accélération : une `KeyframeTrack` interpole linéairement entre ses clés, elle ne
 * sait pas qu'un segment devait décélérer. Échantillonner rend la courbe telle qu'on la voit
 * dans l'éditeur ; exporter les clés brutes en ferait une autre animation, plus raide, sans
 * qu'aucun message ne le dise.
 *
 * `slerp(a, b, alpha)` est fourni par l'appelant, pour la même raison que ci-dessus : ce
 * fichier ne connaît pas three.
 */
export function dataClipAKeys(asset, slerp){
  const duration = durationAnimAKeys(asset);
  const fps = Math.max(1, Math.min(240, Number((asset || {}).imagesBySeconde) || 60));
  const n = Math.max(2, Math.round(duration * fps) + 1);
  const time = [];
  for(let i = 0; i < n; i++) time.push(Math.min(duration, i / fps));

  const tracks = [];
  ((asset && asset.tracks) || []).forEach(function(p){
    if(!p || !p.keys || !p.keys.length) return;
    const pos = [], quat = [], ech = [];
    time.forEach(function(t){
      const s = segmentOfTrack(p.keys, t);
      const a = s.avant, b = s.apres, k = s.alpha;
      for(let j = 0; j < 3; j++) pos.push(a.pos[j] + (b.pos[j] - a.pos[j]) * k);
      const q = slerp(a.quat, b.quat, k);
      for(let j = 0; j < 4; j++) quat.push(q[j]);
      for(let j = 0; j < 3; j++) ech.push(a.ech[j] + (b.ech[j] - a.ech[j]) * k);
    });
    tracks.push({name: nameTrackThree(p, 'position'), time: time, values: pos, size: 3});
    tracks.push({name: nameTrackThree(p, 'quaternion'), time: time, values: quat, size: 4});
    tracks.push({name: nameTrackThree(p, 'scale'), time: time, values: ech, size: 3});
  });
  return {duration: duration, tracks: tracks};
}

/** Liste les problèmes d'un asset d'animation, en clair. Vide = rien à signaler. */
export function validateAnimAsset(asset, findAsset){
  const p = [];
  if(!asset) return ['L\'asset d\'animation est vide.'];
  if(isAnimAKeys(asset)){
    const tracks = (asset.tracks || []).filter(function(x){ return x && x.keys && x.keys.length; });
    if(!tracks.length){
      p.push('L\'animation « ' + (asset.name || '?') + ' » n\'a aucune clé : ouvrez-la dans la '
        + 'timeline et posez-en.');
    }
    // Une seule clé ne bouge rien : la pose est constante. Ça ressemble à un clip qui ne marche
    // pas, alors que c'est un clip qu'on n'a pas fini d'écrire.
    tracks.forEach(function(x){
      if(x.keys.length === 1){
        p.push('La piste « ' + (x.os || x.filePath || 'root') + ' » de « ' + (asset.name || '?')
          + ' » n\'a qu\'une clé : elle fige la pose au lieu de l\'animer.');
      }
    });
    return p;
  }
  const src = asset.source || {};
  if(!src.asset){
    p.push('L\'animation « ' + (asset.name || '?') + ' » ne aims aucun modèle.');
    return p;
  }
  const model = findAsset ? findAsset(src.asset) : null;
  if(!model){
    p.push('L\'animation « ' + (asset.name || '?') + ' » aims un modèle qui n\'existe plus.');
    return p;
  }
  const clips = ((model.template && model.template.animations) || []).map(function(c){ return c.name; });
  if(!src.clip) p.push('L\'animation « ' + (asset.name || '?') + ' » ne aims aucun clip de « '
    + (model.name || '?') + ' ».');
  else if(clips.length && clips.indexOf(src.clip) === -1){
    p.push('L\'animation « ' + (asset.name || '?') + ' » aims « ' + src.clip
      + ' », qui n\'existe pas sur « ' + (model.name || '?') + ' ».');
  }
  return p;
}

/**
 * Ce qu'un état veut jouer : `{animation, clip}`.
 *
 * Les DEUX sont rendus parce que le repli n'est pas transitoire. Une machine portée par deux
 * modèles différents ne peut pas être migrée (voir plus bas) ; ses états restent sur `clip`
 * pour toujours, et un projet déjà publié aussi.
 */
export function animationOfLState(machine, nameState){
  const e = ((machine && machine.states) || []).find(function(x){ return x && x.name === nameState; });
  if(!e) return {animation: null, clip: null};
  return {animation: e.animation || null, clip: e.clip || null};
}

/**
 * Bascule les états d'une machine de `clip: "marche"` vers `animation: "aNN"`.
 *
 * `ctx` : `{modele, clipsConnus, trouverOuCreer(modele, clip) -> assetId}`. Rend le nombre
 * d'états migrés. Idempotent : un état qui a déjà son `animation` n'est pas retouché, et
 * `trouverOuCreer` doit rendre le même asset pour le même couple — deux états sur le même clip
 * partagent alors un seul asset, ce qui est tout l'intérêt de l'opération.
 *
 * UN CLIP INCONNU DU MODÈLE N'EST PAS MIGRÉ. C'est le cas d'une machine partagée par deux
 * personnages, où « marche » ne désigne pas le même clip : deviner reviendrait à recâbler en
 * silence l'animation de l'un sur celle de l'autre. L'état garde son `clip`, et
 * `validateAnimator` le signale à qui peut encore le corriger.
 *
 * `clip` N'EST PAS EFFACÉ. Il reste le repli permanent, y compris pour les projets déjà
 * exportés qui ne repasseront jamais par cette fonction.
 */
export function migrateStatesToAnimAssets(machine, ctx){
  if(!machine || !ctx || !ctx.findOrCreate) return 0;
  const connus = ctx.clipsConnus || [];
  let n = 0;
  const migrate = function(holder){
    if(!holder || holder.animation || !holder.clip) return;
    if(connus.indexOf(holder.clip) === -1) return;
    const id = ctx.findOrCreate(ctx.model, holder.clip);
    if(!id) return;
    holder.animation = id;
    n++;
  };
  (machine.states || []).forEach(function(e){
    if(!e) return;
    migrate(e);
    if(e.blend && e.blend.points) e.blend.points.forEach(migrate);
  });
  return n;
}


// ---------- Les clips d'un MODÈLE : l'onglet Animation d'Unity ----------
//
// Depuis la v0.159, un clip tiré d'un fichier importé n'est plus un asset à part : c'est un
// SOUS-ASSET du modèle, comme dans Unity, où les clips d'un FBX vivent dans son Model Importer
// (`clipAnimations`) et se règlent dans son onglet Animation. Les réglages vivent donc dans
// `paramsImport.clips` du modèle — bufferisés et appliqués comme le reste du panneau.
//
// Pour que TOUT ce qui lisait un asset d'animation continue de marcher sans rien savoir du
// changement (états de l'Animator, points de mélange, timeline, runtime), chaque clip est
// EXPOSÉ comme un asset `animation` ordinaire, marqué `embedded: <id du modèle>` et reconstruit
// depuis le modèle : `clipAssetOfModel`. Il porte l'id du clip, et c'est cet id que les états
// référencent. Il n'a PAS de fichier : il n'est jamais sérialisé pour lui-même.
//
// Un asset d'animation À CLÉS reste un asset autonome : c'est le `.anim` d'Unity, créé dans
// l'éditeur, qui n'appartient à aucun fichier importé.

// Les défauts d'un clip. Le « Bake Into Pose » d'Unity est décoché par défaut ; ici rotation et
// hauteur sont CUITES par défaut, parce que c'est ce que faisait le moteur jusqu'ici (seul le
// déplacement X/Z sortait du clip en root motion) — un défaut « à la Unity » changerait en
// silence la marche de tous les personnages des projets existants.
export const CLIP_SETTINGS_DEFAULT = {
  start: 0, end: null,           // secondes du clip SOURCE ; `end: null` = jusqu'au bout
  speed: 1,
  loop: true,                    // Loop Time
  loopPose: false,               // Loop Pose : la dernière image rejoint la première
  cycleOffset: 0,                // Cycle Offset : fraction [0, 1[ du cycle où démarrer
  mirror: false,                 // Mirror : gauche ↔ droite
  rootRotationBake: true,        // Root Transform Rotation — Bake Into Pose
  rootRotationOffset: 0,         //   … Offset, en degrés autour de Y
  rootYBake: true,               // Root Transform Position (Y) — Bake Into Pose
  rootYOffset: 0,                //   … Offset
  rootXZBake: false,             // Root Transform Position (XZ) — Bake Into Pose
  maskBones: null                // Mask : null = tout le squelette, sinon la liste des os gardés
};

/** Un clip complété de ses défauts — sans jamais écraser ce qui est posé. */
export function normalizeClipSettings(c){
  const out = Object.assign({}, CLIP_SETTINGS_DEFAULT, c || {});
  const v = Number(out.speed);
  out.speed = (isFinite(v) && v > 0) ? v : 1;
  const o = Number(out.cycleOffset) || 0;
  out.cycleOffset = o - Math.floor(o);            // ramené dans [0, 1[
  out.start = Math.max(0, Number(out.start) || 0);
  out.end = (out.end === null || out.end === undefined || out.end === '') ? null : Number(out.end);
  out.rootRotationOffset = Number(out.rootRotationOffset) || 0;
  out.rootYOffset = Number(out.rootYOffset) || 0;
  if(out.maskBones && !Array.isArray(out.maskBones)) out.maskBones = null;
  return out;
}

/**
 * Les clips PAR DÉFAUT d'un fichier : un par prise (take), comme Unity quand l'importeur n'a
 * encore aucun clip réglé. `makeId()` fournit l'identité — l'éditeur la tire de son compteur
 * d'assets.
 */
export function defaultClipsOfTakes(takes, makeId){
  return (takes || []).filter(function(t){ return t && t.name; }).map(function(t){
    return Object.assign({id: makeId(), name: t.name, take: t.name}, CLIP_SETTINGS_DEFAULT);
  });
}

/**
 * L'asset `animation` qui EXPOSE un clip du modèle. Même forme qu'un asset autonome de source
 * `model` : c'est ce qui permet à `resolveAnimAsset` et à tous ses appelants de ne rien changer.
 */
export function clipAssetOfModel(modelId, clip, folder){
  const c = normalizeClipSettings(clip);
  return Object.assign({}, c, {
    id: clip.id, kind: 'animation', name: clip.name || clip.take, embedded: modelId,
    folder: folder || '',
    source: {type: 'model', asset: modelId, clip: clip.take}
  });
}

/** Le clip exige-t-il un clip DÉRIVÉ (cuit une fois), au-delà d'une simple découpe ? */
export function clipNeedsProcessing(s){
  if(!s) return false;
  return !!(s.loopPose || s.mirror || s.rootYOffset || s.rootRotationOffset
    || (Array.isArray(s.maskBones)) || s.rootNode);
}

/** Ce qui, dans les réglages, change le clip dérivé — la clé de son cache. */
export function signatureClipProcessing(s){
  if(!s) return '';
  return [s.loopPose ? 1 : 0, s.mirror ? 1 : 0, s.rootYOffset || 0, s.rootRotationOffset || 0,
    Array.isArray(s.maskBones) ? s.maskBones.join(',') : '*', s.rootNode || '',
    s.rootXZBake ? 1 : 0, s.rootYBake ? 1 : 0, s.rootRotationBake ? 1 : 0].join('|');
}

/**
 * Le nom de l'os SYMÉTRIQUE, ou null. Conventions reconnues : `Left`/`Right` (Mixamo, Unreal),
 * `left`/`right`, suffixes `_L`/`_R`, `.L`/`.R` (Blender), `-L`/`-R`, préfixes `L_`/`R_`.
 */
export function mirrorBoneName(name){
  const n = String(name || '');
  const pairs = [[/Left/, 'Right'], [/Right/, 'Left'], [/left/, 'right'], [/right/, 'left'],
    [/([._-])L$/, '$1R'], [/([._-])R$/, '$1L'], [/([._-])l$/, '$1r'], [/([._-])r$/, '$1l'],
    [/^L([._-])/, 'R$1'], [/^R([._-])/, 'L$1'], [/^l([._-])/, 'r$1'], [/^r([._-])/, 'l$1']];
  for(let i = 0; i < pairs.length; i++){
    if(pairs[i][0].test(n)) return n.replace(pairs[i][0], pairs[i][1]);
  }
  return null;
}

function splitTrackName(name){
  const i = name.lastIndexOf('.');
  return i === -1 ? {node: name, prop: ''} : {node: name.slice(0, i), prop: name.slice(i + 1)};
}

function quatNormalizeAt(v, o){
  const l = Math.hypot(v[o], v[o + 1], v[o + 2], v[o + 3]) || 1;
  v[o] /= l; v[o + 1] /= l; v[o + 2] /= l; v[o + 3] /= l;
}

/** q ← r · q, avec r une rotation de `angle` radians autour de Y. */
function quatPremultiplyYaw(v, o, angle){
  const s = Math.sin(angle / 2), c = Math.cos(angle / 2);
  const x = v[o], y = v[o + 1], z = v[o + 2], w = v[o + 3];
  // (0, s, 0, c) ⊗ (x, y, z, w)
  v[o]     = c * x + s * z;
  v[o + 1] = c * y + s * w;
  v[o + 2] = c * z - s * x;
  v[o + 3] = c * w - s * y;
}

/**
 * Applique les réglages d'un clip à ses pistes, EN PLACE. `tracks` : des objets à la forme des
 * `KeyframeTrack` de three (`name`, `times`, `values`) — ce fichier ne connaît pas three.
 * Rend la liste des pistes gardées (le masque en retire).
 *
 * L'ORDRE compte : masque, miroir, offsets de la racine, puis Loop Pose — boucler la pose APRÈS
 * l'avoir corrigée, sinon la correction de bouclage porterait sur une pose qui n'est pas jouée.
 */
export function processClipTracks(tracks, s, rootNode){
  let list = (tracks || []).slice();
  if(!s) return list;

  // 1. Mask : seuls les os de la liste restent animés
  if(Array.isArray(s.maskBones)){
    const keep = new Set(s.maskBones);
    list = list.filter(function(t){ return keep.has(splitTrackName(t.name).node); });
  }

  // 2. Mirror : chaque piste passe à l'os symétrique, et sa valeur est réfléchie par le plan YZ
  //    du modèle — position (x, y, z) → (−x, y, z), rotation (x, y, z, w) → (x, −y, −z, w).
  //    Juste tant que les repères locaux des os sont symétriques, ce qui est le cas des rigs
  //    construits en miroir (Mixamo, Blender, Maya) ; Unity passe par l'espace des muscles de
  //    l'Avatar, que nous n'avons pas.
  if(s.mirror){
    list.forEach(function(t){
      const parts = splitTrackName(t.name);
      const other = mirrorBoneName(parts.node);
      if(other) t.name = other + '.' + parts.prop;
      const v = t.values;
      if(parts.prop === 'position'){
        for(let k = 0; k + 2 < v.length; k += 3) v[k] = -v[k];
      }
      else if(parts.prop === 'quaternion'){
        for(let k = 0; k + 3 < v.length; k += 4){ v[k + 1] = -v[k + 1]; v[k + 2] = -v[k + 2]; }
      }
    });
  }

  // 3. Offsets de la racine
  if(rootNode){
    list.forEach(function(t){
      const parts = splitTrackName(t.name);
      if(parts.node !== rootNode) return;
      const v = t.values;
      if(parts.prop === 'position' && s.rootYOffset){
        for(let k = 1; k < v.length; k += 3) v[k] += s.rootYOffset;
      }
      if(parts.prop === 'quaternion' && s.rootRotationOffset){
        const a = s.rootRotationOffset * Math.PI / 180;
        for(let k = 0; k + 3 < v.length; k += 4) quatPremultiplyYaw(v, k, a);
      }
    });
  }

  // 4. Loop Pose : l'écart entre la dernière et la première image est réparti sur tout le clip,
  //    pour que la boucle ne saute pas. Une rotation est corrigée composante par composante puis
  //    renormalisée — l'écart d'une boucle presque juste est petit, la linéarisation suffit.
  if(s.loopPose){
    list.forEach(function(t){
      const n = t.times.length;
      if(n < 2) return;
      const size = t.values.length / n;
      if(size !== 3 && size !== 4) return;
      const v = t.values, t0 = t.times[0], span = (t.times[n - 1] - t0) || 1;
      const last = (n - 1) * size;
      // Deux quaternions opposés sont la même rotation : on compare la dernière image à la
      // première dans le même hémisphère, sinon l'écart mesuré serait un tour complet.
      let sign = 1;
      if(size === 4){
        const dot = v[0] * v[last] + v[1] * v[last + 1] + v[2] * v[last + 2] + v[3] * v[last + 3];
        sign = dot < 0 ? -1 : 1;
      }
      const delta = [];
      for(let c = 0; c < size; c++) delta.push(v[last + c] * sign - v[c]);
      for(let i = 0; i < n; i++){
        const k = (t.times[i] - t0) / span, o = i * size;
        if(size === 4 && sign < 0){
          // ramène l'image dans l'hémisphère de la première avant de la corriger
          const dot = v[0] * v[o] + v[1] * v[o + 1] + v[2] * v[o + 2] + v[3] * v[o + 3];
          if(dot < 0) for(let c = 0; c < 4; c++) v[o + c] = -v[o + c];
        }
        for(let c = 0; c < size; c++) v[o + c] -= delta[c] * k;
        if(size === 4) quatNormalizeAt(v, o);
      }
    });
  }
  return list;
}

/**
 * Les clips d'un modèle à partir de ses réglages. `paramsImport.clips` absent = l'importeur n'a
 * jamais été réglé : un clip par prise. Présent — même vide — il fait foi, comme la liste
 * `clipAnimations` d'Unity une fois qu'on y a touché.
 */
export function clipsOfModelParams(params, takes, makeId){
  if(params && params.importAnimation === false) return [];
  if(params && Array.isArray(params.clips)) return params.clips;
  return defaultClipsOfTakes(takes, makeId);
}


// EXPOSÉ EN GLOBALE, à dessein. Ces symboles sont appelés depuis des fichiers
// que les mêmes pages ne chargent pas toutes : un `import` y pointerait un
// fichier absent, et la page ne démarrerait pas. Ils gardent donc leur garde
// `typeof` côté appelant, et se déclarent ici.
globalThis.CLIP_SETTINGS_DEFAULT = CLIP_SETTINGS_DEFAULT;
globalThis.clipAssetOfModel = clipAssetOfModel;
globalThis.clipNeedsProcessing = clipNeedsProcessing;
globalThis.clipsOfModelParams = clipsOfModelParams;
globalThis.defaultClipsOfTakes = defaultClipsOfTakes;
globalThis.mirrorBoneName = mirrorBoneName;
globalThis.normalizeClipSettings = normalizeClipSettings;
globalThis.processClipTracks = processClipTracks;
globalThis.signatureClipProcessing = signatureClipProcessing;
globalThis.boundsAnimAsset = boundsAnimAsset;
globalThis.dataClipAKeys = dataClipAKeys;
globalThis.markersAdjusted = markersAdjusted;
globalThis.migrateStatesToAnimAssets = migrateStatesToAnimAssets;
globalThis.nameClipDerived = nameClipDerived;
globalThis.readNameClipDerived = readNameClipDerived;
globalThis.resolveAnimAsset = resolveAnimAsset;
globalThis.sliceUseful = sliceUseful;
globalThis.typeSourceAnim = typeSourceAnim;
globalThis.validateAnimAsset = validateAnimAsset;