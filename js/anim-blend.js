// ---------- Mélange de clips par os : marcher en bas, viser en haut ----------
//
// Le besoin : jouer DEUX animations à la fois sur des parties différentes du corps. Une marche
// qui pilote les jambes, une visée qui pilote le torse et les bras, sans que l'une écrase
// l'autre. Unreal appelle ça un Layered blend per bone, en mode Branch Filter.
//
// LA MÉTHODE, et la raison pour laquelle elle est simple.
//
// three sait déjà mélanger plusieurs actions : chacune a un poids, et le mixeur en fait une
// moyenne pondérée, propriété par propriété. Ce qu'il ne sait pas faire, c'est restreindre une
// action à un sous-ensemble d'os. On ne touche donc pas au mixeur : on lui donne des CLIPS déjà
// restreints — un clip n'est rien d'autre qu'une liste de pistes nommées, et en unregister est
// trivial.
//
// Conséquence importante : deux couches dont les os sont DISJOINTS ne se disputent rien, et le
// résultat est exact plutôt qu'approché. C'est pourquoi la couche haute est retirée de la base
// au lieu d'être simplement empilée dessus — deux actions de poids 1 sur le même os donneraient
// une moyenne 50/50, c'est-à-dire un personnage à mi-chemin entre marcher et viser.

/** L'os nommé et toute sa descendance, par leurs noms. Vide si l'os est introuvable. */
export function boneAndDescendants(root, nameBone){
  let start = null;
  if(root && root.traverse) root.traverse(function(x){
    if(!start && x.isBone && x.name === nameBone) start = x;
  });
  if(!start) return [];
  const names = [];
  start.traverse(function(x){ if(x.isBone) names.push(x.name); });
  return names;
}

/** Tous les os d'un modèle, par leurs noms. */
export function allBone(root){
  const names = [];
  if(root && root.traverse) root.traverse(function(x){ if(x.isBone) names.push(x.name); });
  return names;
}

// Clips restreints mémorisés : `mixeur.clipAction(clip)` indexe par identité de clip, donc en
// reconstruire un à chaque image créerait une action neuve à chaque fois — et le fondu, qui
// suppose de retrouver l'action précédente, ne retrouverait jamais rien.
export const _clipsRestricted = new WeakMap();

/**
 * Un clip réduit aux pistes qui visent ces os-là.
 *
 * Renvoie le clip d'origine si rien n'est retiré (pas de copie inutile), et `null` s'il ne
 * reste aucune piste — auquel cas il n'y a pas d'action à jouer, ce que l'appelant doit
 * traiter plutôt que de lancer une action vide qui ne ferait rien en silence.
 */
export function clipRestricted(clip, names, key){
  if(!clip || !clip.tracks) return null;
  const garde = new Set(names || []);
  const tracks = clip.tracks.filter(function(t){
    const i = t.name.indexOf('.');
    return garde.has(i === -1 ? t.name : t.name.slice(0, i));
  });
  if(!tracks.length) return null;
  if(tracks.length === clip.tracks.length) return clip;

  let hidden = _clipsRestricted.get(clip);
  if(!hidden){ hidden = {}; _clipsRestricted.set(clip, hidden); }
  const k = key || tracks.map(function(t){ return t.name; }).join('|');
  if(!hidden[k]){
    // Le nom porte la restriction : deux clips de même nom dans un même mixeur seraient
    // indiscernables dans un journal, et `clipAction` les distingue par identité, pas par nom.
    hidden[k] = new THREE.AnimationClip(clip.name + ' ⟨' + k + '⟩', clip.duration, tracks);
  }
  return hidden[k];
}

/**
 * Un clip PRIVÉ des pistes qui visent ces os-là.
 *
 * C'est ce qu'il faut pour la base, et non `clipRestricted` à la liste des os restants : un clip
 * peut animer autre chose que des os — la position d'un maillage, un nœud vide, une cible de
 * morphing. Les garder par une liste blanche d'OS les jetterait tous, en silence.
 */
export function clipExcept(clip, namesExclus, key){
  if(!clip || !clip.tracks) return null;
  const exclus = new Set(namesExclus || []);
  // (Un raccourci « aucune exclusion → rendre le clip » vivait ici. Il ne gardait rien : la
  // comparaison de longueurs plus bas rend déjà le clip d'origine dans ce cas, et la mutation
  // qui supprimait le raccourci passait tous les tests. Du code qui a l'air d'une garde.)
  const tracks = clip.tracks.filter(function(t){
    const i = t.name.indexOf('.');
    return !exclus.has(i === -1 ? t.name : t.name.slice(0, i));
  });
  if(!tracks.length) return null;
  if(tracks.length === clip.tracks.length) return clip;

  let hidden = _clipsRestricted.get(clip);
  if(!hidden){ hidden = {}; _clipsRestricted.set(clip, hidden); }
  const k = 'sauf:' + (key || Array.from(exclus).sort().join(','));
  if(!hidden[k]){
    hidden[k] = new THREE.AnimationClip(clip.name + ' ⟨' + k + '⟩', clip.duration, tracks);
  }
  return hidden[k];
}

// Clips remis sur place, mémorisés par clip d'origine — même raison que ci-dessus : un clip
// reconstruit à chaque image donnerait une action neuve à chaque image.
export const _clipsInPlace = new WeakMap();

/**
 * Le même clip, débarrassé du déplacement horizontal de sa racine — LES CLÉS sont réécrites.
 *
 * Un clip de locomotion tout fait avance pour de bon : mesuré sur le pack Mixamo utilisé par
 * jeux/TPS, la marche fait parcourir 1,72 m au bassin par cycle, la course 3,24 m, le pas de
 * côté 1,79 m. Quand c'est un script qui pose la vitesse, ce parcours est en trop.
 *
 * IL EST RETIRÉ DES CLÉS, et non corrigé après coup. La correction après coup existait — on
 * replaçait l'os à sa pose de repos après chaque pas du mixeur — et elle laissait passer tout
 * ce qui écrit sur le bassin APRÈS elle : l'inertialisation entre deux états, les couches par
 * os, le fondu d'une transition. Il en restait un glissement, faible mais permanent, qui
 * désalignait le personnage de la direction que le script lui donnait.
 *
 * X et Z seulement. Le Y reste : c'est le balancement vertical du bassin pendant la marche, et
 * l'aplatir donnerait une démarche de robot. La valeur gardée est celle de la PREMIÈRE clé, et
 * non zéro — un bassin est à un mètre du sol, y mettre zéro planterait le personnage dedans.
 *
 * Le clip rendu GARDE LE NOM de l'original, contrairement aux clips restreints ci-dessus : le
 * mixeur distingue ses actions par identité, et un suffixe « ⟨…⟩ » serait lu par
 * `readNameClipDerived` (js/anim-asset.js) comme le nom d'un asset de découpe qui n'existe pas.
 */
export function clipInPlace(clip){
  if(!clip || !clip.tracks) return clip;
  const memo = _clipsInPlace.get(clip);
  if(memo !== undefined) return memo;

  // La PREMIÈRE piste de position, comme `boneRootOfClip` (js/animator.js) : dans un clip de
  // locomotion il n'y en a qu'une, celle du bassin.
  // Un clip dont le rig déclare sa racine (« Root node » d'Unity) est remis sur place sur CELLE-
  // là, et pas sur la première piste venue.
  const info = clip.rootMotionInfo || null;
  const i = info
    ? clip.tracks.findIndex(function(t){ return t.name === info.rootNode + '.position'; })
    : clip.tracks.findIndex(function(t){ return /\.position$/.test(t.name); });
  if(i === -1){ _clipsInPlace.set(clip, clip); return clip; }   // déjà sur place : rien à copier

  const src = clip.tracks[i];
  const values = Array.prototype.slice.call(src.values);
  const x0 = values[0], z0 = values[2];
  for(let k = 0; k + 2 < values.length; k += 3){ values[k] = x0; values[k + 2] = z0; }
  const tracks = clip.tracks.slice();
  tracks[i] = new src.constructor(src.name, Array.prototype.slice.call(src.times), values);

  const surPlace = new THREE.AnimationClip(clip.name, clip.duration, tracks);
  if(info) surPlace.rootMotionInfo = info;
  _clipsInPlace.set(clip, surPlace);
  return surPlace;
}

/**
 * Répartit les os entre la base et ses couches, sans recouvrement.
 *
 * `couches` : [{depuis: 'nomOsRacine', …}]. Chaque couche prend son os et toute sa descendance ;
 * la base garde tout le reste. Deux couches qui se recouvrent sont départagées par leur ORDRE :
 * la dernière l'emporte, comme une pile de calques. Sans cette règle, un os réclamé deux fois
 * serait joué par deux actions de poids 1 — une moyenne, donc ni l'une ni l'autre.
 */
export function splitBone(root, layers){
  const tous = allBone(root);
  const prises = new Map();                     // name d'os → index de la couche qui le prend
  (layers || []).forEach(function(c, i){
    boneAndDescendants(root, c.depuis).forEach(function(n){ prises.set(n, i); });
  });
  const byLayer = (layers || []).map(function(){ return []; });
  const base = [];
  tous.forEach(function(n){
    const i = prises.get(n);
    if(i === undefined) base.push(n);
    else byLayer[i].push(n);
  });
  return {base:base, layers:byLayer};
}


// EXPOSÉ EN GLOBALE, à dessein. Ces symboles sont appelés depuis des fichiers
// que les mêmes pages ne chargent pas toutes : un `import` y pointerait un
// fichier absent, et la page ne démarrerait pas. Ils gardent donc leur garde
// `typeof` côté appelant, et se déclarent ici.
// ---------- Le clip DÉRIVÉ d'un asset : découpe + réglages de l'onglet Animation ----------
//
// PARTAGÉ éditeur ↔ runtime : les deux côtés cuisaient déjà la découpe chacun de leur côté
// (`clipSliceFor` / `rtClipSliceFor`), avec le même code recopié. Les réglages de clip ajoutés
// en v0.159 (miroir, Loop Pose, offsets, masque, racine) passent par ici, une seule fois.

/**
 * Cuit le clip joué pour un asset : `base` découpé à `bounds`, puis traité selon `r` (le résultat
 * de `resolveAnimAsset`). `name` est le nom du clip dérivé (`nameClipDerived`).
 */
export function deriveClip(base, name, bounds, r){
  const fps = 60;
  const whole = !(typeof sliceUseful === 'function' && sliceUseful(bounds, base.duration));
  // `subclip` EXCLUT la dernière image de sa plage : sur le clip entier, il perdrait la clé de
  // fin, et la boucle sauterait. Un clip qu'on ne découpe pas est donc cloné.
  let clip;
  if(whole){ clip = base.clone(); clip.name = name; }
  else clip = THREE.AnimationUtils.subclip(base, name,
    Math.round(bounds.start * fps), Math.round(bounds.end * fps), fps);
  if(r && typeof processClipTracks === 'function'){
    clip.tracks = processClipTracks(clip.tracks, r, r.rootNode || null);
  }
  if(r && r.rootNode){
    // Ce que le root motion aura le droit de sortir du clip : les composantes NON cuites.
    clip.rootMotionInfo = {rootNode: r.rootNode, xz: !r.rootXZBake, y: !r.rootYBake,
                           yaw: !r.rootRotationBake};
  }
  return clip;
}

// ---------- Root motion, partagé : ce qu'un pas du mixeur fait parcourir à la racine ----------

const _rootReaders = new WeakMap();

function rootReadersOf(clip){
  let e = _rootReaders.get(clip);
  if(e !== undefined) return e;
  const info = clip.rootMotionInfo || null;
  const name = info ? info.rootNode
    : (typeof boneRootOfClip === 'function' ? boneRootOfClip(clip) : null);
  const find = function(prop){
    const t = name ? (clip.tracks || []).find(function(x){ return x.name === name + '.' + prop; }) : null;
    return t ? t.createInterpolant() : null;
  };
  e = {name: name, info: info, pos: find('position'), quat: find('quaternion')};
  _rootReaders.set(clip, e);
  return e;
}

const _qRoot = new THREE.Quaternion(), _eRoot = new THREE.Euler();

function yawOf(arr){
  _qRoot.fromArray(arr);
  _eRoot.setFromQuaternion(_qRoot, 'YXZ');
  return _eRoot.y;
}

function wrapAngle(a){
  while(a > Math.PI) a -= 2 * Math.PI;
  while(a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/**
 * Le déplacement de la racine sur ce pas, et sa remise en place sur l'os.
 *
 * `parts` : [{action, tBefore, weight}]. Rend `{x, y, z, yaw, weight}` dans le repère du MODÈLE
 * (l'appelant l'oriente et l'échelonne comme l'objet qui porte l'Animator).
 *
 * Un clip SANS `rootMotionInfo` (rig sans racine déclarée) garde le comportement d'avant : seul
 * X/Z sort, depuis la première piste de position. Un clip AVEC ne sort que ses composantes non
 * cuites dans la pose — le « Bake Into Pose » d'Unity — et laisse les autres sur l'os.
 */
export function stepRootMotion(target, parts){
  const out = {x: 0, y: 0, z: 0, yaw: 0, weight: 0};
  let bx = 0, by = 0, bz = 0, byaw = 0, reset = null, resetInfo = null;
  (parts || []).forEach(function(p){
    if(!p.action || !(p.weight > 0)) return;
    const clip = p.action.getClip();
    const rd = rootReadersOf(clip);
    if(!rd.pos && !rd.quat) return;
    const info = rd.info;
    const useXZ = info ? info.xz : true, useY = info ? info.y : false;
    const useYaw = info ? info.yaw : false;
    const loop = p.action.loop !== THREE.LoopOnce;
    const clamp = function(t){ return Math.max(0, Math.min(clip.duration, t)); };
    if(rd.pos && (useXZ || useY)){
      const read = function(t){
        return Array.prototype.slice.call(rd.pos.evaluate(clamp(t)), 0, 3);
      };
      const d = moveRoot(read, p.tBefore, p.action.time, clip.duration, loop);
      const rest = read(0);
      if(useXZ){ out.x += d.x * p.weight; out.z += d.z * p.weight;
                 bx += rest[0] * p.weight; bz += rest[2] * p.weight; }
      if(useY){ out.y += d.y * p.weight; by += rest[1] * p.weight; }
    }
    if(rd.quat && useYaw){
      const yaw = function(t){ return yawOf(Array.prototype.slice.call(rd.quat.evaluate(clamp(t)), 0, 4)); };
      const a = p.tBefore, b = p.action.time;
      let dy = 0;
      if(b >= a) dy = wrapAngle(yaw(b) - yaw(a));
      else if(loop) dy = wrapAngle(yaw(clip.duration) - yaw(a)) + wrapAngle(yaw(b) - yaw(0));
      out.yaw += dy * p.weight;
      byaw += yaw(0) * p.weight;
    }
    out.weight += p.weight;
    if(!reset){ reset = rd.name; resetInfo = {xz: useXZ, y: useY, yaw: useYaw && !!rd.quat}; }
  });
  if(!out.weight) return out;
  // L'annulation sur l'os : sans elle, le déplacement compterait deux fois — une fois sur
  // l'objet, une fois sur le bassin.
  const os = (reset && target.getObjectByName) ? target.getObjectByName(reset) : null;
  if(os){
    const w = out.weight;
    if(resetInfo.xz){ os.position.x = bx / w; os.position.z = bz / w; }
    if(resetInfo.y) os.position.y = by / w;
    if(resetInfo.yaw){
      _eRoot.setFromQuaternion(os.quaternion, 'YXZ');
      os.quaternion.premultiply(_qRoot.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, byaw / w - _eRoot.y));
    }
  }
  return out;
}

/** Porte un pas de root motion sur l'objet qui porte l'Animator. */
export function applyRootStep(holder, d){
  if(!d || !d.weight) return;
  if(d.x || d.y || d.z){
    const v = new THREE.Vector3(d.x * holder.scale.x, d.y * holder.scale.y, d.z * holder.scale.z);
    v.applyQuaternion(holder.quaternion);
    holder.position.add(v);
  }
  if(d.yaw) holder.rotateY(d.yaw);
}

globalThis.applyRootStep = applyRootStep;
globalThis.deriveClip = deriveClip;
globalThis.stepRootMotion = stepRootMotion;
globalThis.clipExcept = clipExcept;
globalThis.clipInPlace = clipInPlace;
globalThis.clipRestricted = clipRestricted;
globalThis.splitBone = splitBone;