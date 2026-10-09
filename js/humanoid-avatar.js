// ---------- Avatar Humanoïde : reciblage entre DEUX SQUELETTES ÉTRANGERS ----------
//
// moteur/js/retargeting.js résout le cas où deux rigs PARTAGENT une convention de nommage
// (Mixamo, Rigify…) : la correspondance s'y fait par nom d'os, directement. Ce fichier résout
// le cas que Unity appelle « Humanoid » (par opposition à « Generic ») : DEUX SQUELETTES QUI NE
// SE RESSEMBLENT PAS PAR LE NOM — un rig Mixamo et un rig Maya biped, par exemple — mais qui
// sont tous deux des corps humains. La clé est la même que dans Mecanim : ne jamais comparer un
// os à un autre par son nom, mais chacun à un ENSEMBLE ABSTRAIT DE VINGT-DEUX EMPLACEMENTS
// (`HUMANOID_BONES`) — le squelette source dit « mon os `mixamorigLeftArm` EST le bras gauche »,
// le squelette cible dit « mon os `L_UpperArm` EST le bras gauche », et le reciblage ne relie
// plus jamais que ces deux déclarations entre elles. Deux squelettes sans AUCUN nom en commun
// peuvent alors se parler, du moment que chacun a son Avatar.
//
// Un « Avatar », ici, est juste `{mapping: {slot: boneName}}` — la table de correspondance
// emplacement→os d'UN squelette précis (`autoMapAvatar` la devine, un humain peut la corriger).
//
// LES DEUX CORRECTIONS DE moteur/js/retargeting.js RESTENT VALABLES ET SONT REPRISES ICI, mais
// mesurées à travers l'Avatar plutôt que sur un nom : la taille se mesure sur la chaîne de jambe
// DÉSIGNÉE PAR L'AVATAR (`LeftUpperLeg`→`LeftLowerLeg`→`LeftFoot`), et la pose de repos se
// corrige bone-à-bone via `restPoseAvatar`, exactement comme `retargetClip` le fait par nom.
//
// PAS DE MUSCLE SPACE NORMALISÉ (le [-1,1] par degré de liberté de Unity, avec ses limites
// articulaires calibrées à la main) : ce fichier retient uniquement ce qui a un effet mesurable
// sur un personnage qui marche — le report de mouvement relatif à la pose de repos et la mise à
// l'échelle. Documenté ici pour que la différence avec Unity ne soit jamais silencieuse.

/**
 * Les emplacements humanoïdes standard, dans l'ordre où Unity les présente. `required: true` =
 * sans cet os mappé, l'Avatar n'est pas exploitable (mêmes quinze emplacements que Unity exige
 * pour valider un Avatar Humanoid) ; les autres sont optionnels — un rig qui n'a pas de clavicule
 * ou d'orteils reste un Avatar valide.
 */
export const HUMANOID_BONES = [
  {slot: 'Hips', required: true},
  {slot: 'Spine', required: true},
  {slot: 'Chest', required: false},
  {slot: 'UpperChest', required: false},
  {slot: 'Neck', required: false},
  {slot: 'Head', required: true},
  {slot: 'LeftShoulder', required: false},
  {slot: 'LeftUpperArm', required: true},
  {slot: 'LeftLowerArm', required: true},
  {slot: 'LeftHand', required: true},
  {slot: 'RightShoulder', required: false},
  {slot: 'RightUpperArm', required: true},
  {slot: 'RightLowerArm', required: true},
  {slot: 'RightHand', required: true},
  {slot: 'LeftUpperLeg', required: true},
  {slot: 'LeftLowerLeg', required: true},
  {slot: 'LeftFoot', required: true},
  {slot: 'LeftToes', required: false},
  {slot: 'RightUpperLeg', required: true},
  {slot: 'RightLowerLeg', required: true},
  {slot: 'RightFoot', required: true},
  {slot: 'RightToes', required: false}
];

// Alias reconnus par emplacement, en nom NORMALISÉ (voir `nameBoneNormalized`,
// moteur/js/retargeting.js — même fonction, réutilisée telle quelle, pas redéfinie : les deux
// fichiers sont toujours chargés ensemble, dans l'éditeur comme au jeu publié).
//
// Correspondance EXACTE, jamais par sous-chaîne : « leftarm » (Mixamo, bras) et « leftforearm »
// (Mixamo, avant-bras) doivent rester deux emplacements distincts, une recherche par sous-chaîne
// les confondrait (« leftarm » est contenu dans « leftforearm »).
//
// Généré par combinaison CÔTÉ × MEMBRE plutôt que tapé à la main : une convention de nommage de
// rig dit son côté soit en toutes lettres (« Left »/« Right » — Mixamo, Rigify), soit par une
// seule lettre (« L_ »/« R_ »), et le pose soit AVANT le membre, soit APRÈS. Les quatre formes
// sont donc produites : `leftclavicle`, `lclavicle`, `clavicleleft`, `claviclel`.
//
// LE SUFFIXE EST CE QUI MANQUAIT, et c'est la convention la plus répandue hors Mixamo :
// `clavicle_l`, `thigh_r` (Mannequin Unreal), `Arm_L` (Maya, 3ds Max, la plupart des rigs de
// studio). Sans lui, l'auto-détection mappait le tronc (spine, neck, head, pelvis) et **aucun
// membre** — douze emplacements requis manquants sur quinze, mesuré sur un rig Unreal reconstruit
// dans `moteur/test/humanoid-avatar.test.mjs`.
export const SIDE_PREFIXES = {
  Left: ['left', 'l'],
  Right: ['right', 'r']
};
export const LIMB_SUFFIXES = {
  Shoulder: ['shoulder', 'clavicle'],
  UpperArm: ['arm', 'upperarm'],
  LowerArm: ['forearm', 'lowerarm'],
  Hand: ['hand'],
  UpperLeg: ['upleg', 'upperleg', 'thigh'],
  LowerLeg: ['leg', 'lowerleg', 'shin', 'calf'],
  Foot: ['foot'],
  Toes: ['toebase', 'toes', 'toe', 'ball']
};
export const ALIASES_BY_SLOT = {
  Hips: ['hips', 'pelvis'],
  Spine: ['spine', 'spine1', 'spine01'],
  Chest: ['chest', 'spine2', 'spine02'],
  UpperChest: ['upperchest', 'spine3', 'spine03'],
  Neck: ['neck', 'neck1'],
  Head: ['head', 'skull']
};
Object.keys(SIDE_PREFIXES).forEach(function(side){
  Object.keys(LIMB_SUFFIXES).forEach(function(limb){
    const alias = [];
    SIDE_PREFIXES[side].forEach(function(prefix){
      LIMB_SUFFIXES[limb].forEach(function(suffix){
        alias.push(prefix + suffix);    // leftclavicle, lclavicle
        alias.push(suffix + prefix);    // clavicleleft, claviclel
      });
    });
    ALIASES_BY_SLOT[side + limb] = alias;
  });
});

// Alias de DERNIER RECOURS : essayés seulement si l'emplacement n'a rien trouvé autrement.
// `root` est le cas d'école — sur beaucoup de rigs c'est le nœud de déplacement, au sol, PARENT
// du bassin ; sur d'autres (un export Unreal sans bone de mouvement) c'est le bassin lui-même.
// Le mapper d'office collerait l'Avatar au sol une fois sur deux ; en dernier recours, il ne sert
// que là où il n'y a rien d'autre.
export const ALIASES_WEAK_BY_SLOT = {
  Hips: ['root', 'bip01', 'bip001', 'cog', 'center']
};

/** La chaîne de jambe, DÉSIGNÉE PAR L'AVATAR — pour mesurer la taille sans jamais lire un nom. */
export const LEG_CHAIN_AVATAR = ['LeftUpperLeg', 'LeftLowerLeg', 'LeftFoot'];

/**
 * Devine l'Avatar d'un squelette : parcourt ses os, normalise chaque nom (même normalisation
 * que le reciblage par nom), et l'assigne au premier emplacement dont un alias correspond
 * EXACTEMENT. Premier arrivé, premier servi — même politique que `boneByNameNormalized`.
 *
 * Rend `{mapping, missing}` : `mapping` est `{slot: boneNameDansCeSquelette}`, `missing` la
 * liste des emplacements REQUIS qui n'ont trouvé aucun os — à corriger à la main dans
 * l'inspecteur (l'auto-détection ne devine jamais un emplacement requis manquant).
 */
export function autoMapAvatar(root){
  const mapping = {};
  const bones = bonesUnique(root);
  const normalized = function(x){
    return typeof nameBoneNormalized === 'function' ? nameBoneNormalized(x.name)
      : String(x.name || '').toLowerCase();
  };

  // 1. les alias sûrs
  const slotByAlias = {};
  HUMANOID_BONES.forEach(function(b){
    (ALIASES_BY_SLOT[b.slot] || []).forEach(function(alias){
      if(!(alias in slotByAlias)) slotByAlias[alias] = b.slot;
    });
  });
  bones.forEach(function(x){
    const slot = slotByAlias[normalized(x)];
    if(slot && !mapping[slot]) mapping[slot] = x.name;
  });

  // 2. les alias de dernier recours, pour les seuls emplacements restés vides
  Object.keys(ALIASES_WEAK_BY_SLOT).forEach(function(slot){
    if(mapping[slot]) return;
    const faibles = ALIASES_WEAK_BY_SLOT[slot];
    const trouve = bones.find(function(x){ return faibles.indexOf(normalized(x)) !== -1; });
    if(trouve) mapping[slot] = trouve.name;
  });

  // 3. la FORME du squelette, pour tout ce que les noms n'ont pas su dire
  mapStructural(root, bones, mapping);

  const missing = HUMANOID_BONES.filter(function(b){ return b.required && !mapping[b.slot]; })
    .map(function(b){ return b.slot; });
  return {mapping: mapping, missing: missing};
}

/**
 * Les os d'un squelette, SANS DOUBLON DE NOM.
 *
 * Un FBX rapporte très souvent le même os plusieurs fois — un nœud extérieur qui porte la
 * transformation et un homonyme intérieur resté à l'origine (le cas Mixamo, déjà documenté dans
 * `cloneModel`), ou une copie de la hiérarchie par maillage skinné. Un personnage à quatorze
 * maillages donnait donc quatorze `clavicle_r` dans la liste de l'inspecteur, et autant de
 * candidats indiscernables à l'auto-détection.
 *
 * On garde LA PREMIÈRE occurrence, jamais la dernière : c'est celle que `PropertyBinding.findNode`
 * de three retient, donc celle que le système d'animation adresse réellement. Le choix est le
 * même que dans `cloneModel` (js/anim-models.js), et pour la même raison.
 */
export function bonesUnique(root){
  const list = [];
  const vus = {};
  if(root && root.traverse) root.traverse(function(x){
    if(!x.isBone || vus[x.name]) return;
    vus[x.name] = true;
    list.push(x);
  });
  return list;
}

/** Combien d'os portent un nom déjà pris — ce que le fichier répète. */
export function countBonesDuplicated(root){
  let total = 0;
  const vus = {};
  if(root && root.traverse) root.traverse(function(x){
    if(!x.isBone) return;
    if(vus[x.name]) total++;
    else vus[x.name] = true;
  });
  return total;
}


// ---------- La détection par la FORME ----------
//
// Ce que les noms ne peuvent pas résoudre : un rig nommé dans une autre langue (`Bras_G`,
// `Jambe_D`), à la main sans convention, ou renommé par un pipeline maison. Un corps humain a
// pourtant toujours la même forme — c'est elle qu'on lit ici, exactement comme un humain
// regarderait la hiérarchie : le bassin est le nœud qui se sépare en trois (deux jambes qui
// descendent, une colonne qui monte), la main est l'os d'où partent les doigts, le pied est le
// troisième os de la chaîne qui descend.
//
// On ne remplace JAMAIS ce que les noms ont trouvé : cette passe ne comble que les vides.

/** La plus longue chaîne d'os sous cet os, lui compris. */
export function longestChainBone(bone){
  const kids = (bone.children || []).filter(function(c){ return c.isBone; });
  if(!kids.length) return [bone];
  let best = [];
  kids.forEach(function(k){
    const c = longestChainBone(k);
    if(c.length > best.length) best = c;
  });
  return [bone].concat(best);
}

/** Le côté qu'un nom annonce, s'il en annonce un. */
export function sideOfName(name){
  const n = String(name || '').toLowerCase();
  if(/(^|[^a-z])(l|left|lft|lf|g|gauche)([^a-z]|$)/.test(n)) return 'Left';
  if(/(^|[^a-z])(r|right|rgt|rt|d|droite)([^a-z]|$)/.test(n)) return 'Right';
  if(/left/.test(n)) return 'Left';
  if(/right/.test(n)) return 'Right';
  return null;
}

/**
 * Remplit les emplacements vides d'après la structure. `mapping` est modifié sur place.
 * Sans repère fiable de côté dans les noms, on suppose la convention glTF : le personnage
 * regarde +Z, sa GAUCHE est donc du côté des X positifs.
 */
export function mapStructural(root, bones, mapping){
  if(!root || !bones || !bones.length) return mapping;
  const manque = HUMANOID_BONES.some(function(b){ return b.required && !mapping[b.slot]; });
  if(!manque) return mapping;                 // les noms ont suffi : ne rien deviner
  root.updateMatrixWorld(true);

  const byName = {};
  bones.forEach(function(b){ byName[b.name] = b; });
  const world = function(b){ return new THREE.Vector3().setFromMatrixPosition(b.matrixWorld); };
  const put = function(slot, bone){ if(bone && !mapping[slot]) mapping[slot] = bone.name; };

  // 1. LE BASSIN : le premier os, en descendant depuis la racine du squelette, qui se sépare en
  //    au moins deux chaînes. Tout ce qui est au-dessus n'est qu'un nœud de déplacement.
  let hips = mapping.Hips ? byName[mapping.Hips] : null;
  if(!hips){
    let n = bones[0];
    for(let garde = 0; n && garde < 64; garde++){
      const kids = (n.children || []).filter(function(c){ return c.isBone; });
      if(kids.length >= 2 || !kids.length) break;
      n = kids[0];
    }
    hips = n;
  }
  if(!hips) return mapping;
  put('Hips', hips);

  const pHips = world(hips);
  const kids = (hips.children || []).filter(function(c){ return c.isBone; });
  if(kids.length < 2) return mapping;

  // 2. CE QUI MONTE est la colonne, CE QUI DESCEND sont les jambes.
  const haut = kids.slice().sort(function(a, b){ return world(b).y - world(a).y; });
  const spineStart = haut[0];
  const legs = haut.slice(1).filter(function(k){ return world(k).y <= pHips.y + 1e-6; });

  // 3. LES JAMBES : cuisse, tibia, pied, orteils, dans l'ordre de la chaîne.
  const sideOf = function(bone, autre){
    const s = sideOfName(bone.name);
    if(s) return s;
    const x = world(bone).x, xa = autre ? world(autre).x : 0;
    return (x >= xa) ? 'Left' : 'Right';
  };
  legs.slice(0, 2).forEach(function(leg, i){
    const side = sideOf(leg, legs[1 - i]);
    const chain = longestChainBone(leg);
    put(side + 'UpperLeg', chain[0]);
    put(side + 'LowerLeg', chain[1]);
    put(side + 'Foot', chain[2]);
    put(side + 'Toes', chain[3]);
  });

  // 4. LA COLONNE : on monte tant qu'il n'y a qu'un enfant. L'os où ça se sépare porte les bras
  //    et le cou.
  const spine = [];
  let n = spineStart;
  for(let garde = 0; n && garde < 32; garde++){
    spine.push(n);
    const c = (n.children || []).filter(function(x){ return x.isBone; });
    if(c.length !== 1) break;
    n = c[0];
  }
  put('Spine', spine[0]);
  if(spine.length > 1) put('Chest', spine[1]);
  if(spine.length > 2) put('UpperChest', spine[2]);

  const fork = spine[spine.length - 1];
  const branches = (fork.children || []).filter(function(x){ return x.isBone; });
  if(!branches.length) return mapping;

  // 5. LE COU monte, LES BRAS s'écartent. On compare l'écart en X à l'écart en Y depuis le tronc.
  const pFork = world(fork);
  const ecart = function(b){
    const p = world(b);
    return {x: Math.abs(p.x - pFork.x), y: p.y - pFork.y};
  };
  const cou = branches.filter(function(b){ const e = ecart(b); return e.y >= e.x; })
    .sort(function(a, b){ return ecart(b).y - ecart(a).y; })[0];
  const bras = branches.filter(function(b){ return b !== cou; })
    .sort(function(a, b){ return ecart(b).x - ecart(a).x; }).slice(0, 2);

  if(cou){
    const chain = longestChainBone(cou);
    put('Neck', chain[0]);
    put('Head', chain[1] || chain[0]);
  }

  // 6. LES BRAS : la MAIN est l'os d'où partent les doigts (trois chaînes ou plus). À défaut,
  //    le quatrième os de la chaîne — clavicule, bras, avant-bras, main.
  bras.forEach(function(arm, i){
    const side = sideOf(arm, bras[1 - i]);
    const chain = longestChainBone(arm);
    let iHand = -1;
    for(let k = 1; k < chain.length; k++){
      const c = (chain[k].children || []).filter(function(x){ return x.isBone; });
      if(c.length >= 3){ iHand = k; break; }
    }
    if(iHand === -1) iHand = Math.min(3, chain.length - 1);
    // Une clavicule n'existe que si la chaîne est assez longue pour en porter une.
    const avecClavicule = (iHand >= 3);
    put(side + 'Shoulder', avecClavicule ? chain[iHand - 3] : null);
    put(side + 'UpperArm', chain[iHand - 2]);
    put(side + 'LowerArm', chain[iHand - 1]);
    put(side + 'Hand', chain[iHand]);
  });
  return mapping;
}

/**
 * Les problèmes d'un Avatar, en clair — même politique que `validateAnimator`
 * (moteur/js/animator.js) : nommer ce qu'il faut corriger, jamais juste dire « invalide ».
 */
export function validateAvatar(avatar){
  const p = [];
  if(!avatar || typeof avatar !== 'object' || !avatar.mapping){
    return ['L\'Avatar est vide ou illisible.'];
  }
  HUMANOID_BONES.forEach(function(b){
    if(b.required && !avatar.mapping[b.slot]){
      p.push('L\'emplacement requis « ' + b.slot + ' » n\'est mappé à aucun os.');
    }
  });
  return p;
}

/** L'os réel d'un squelette pour un emplacement de l'Avatar, ou `null`. */
export function boneOfAvatar(root, avatar, slot){
  const boneName = avatar && avatar.mapping && avatar.mapping[slot];
  if(!boneName || !root || !root.getObjectByName) return null;
  return root.getObjectByName(boneName) || null;
}

/** La pose de repos, par emplacement — calibration nécessaire au report de mouvement. */
export function restPoseAvatar(root, avatar){
  const rest = {};
  HUMANOID_BONES.forEach(function(b){
    const bone = boneOfAvatar(root, avatar, b.slot);
    if(bone) rest[b.slot] = bone.quaternion.clone();
  });
  return rest;
}

/** Longueur de la chaîne de jambe DÉSIGNÉE PAR L'AVATAR — jamais un nom lu directement. */
export function sizeOfAvatar(root, avatar){
  let sum = 0;
  LEG_CHAIN_AVATAR.forEach(function(slot){
    const bone = boneOfAvatar(root, avatar, slot);
    if(bone) sum += bone.position.length();
  });
  return sum;
}

export function factorScaleAvatars(rootSource, avatarSource, rootTarget, avatarTarget){
  const s = sizeOfAvatar(rootSource, avatarSource);
  const c = sizeOfAvatar(rootTarget, avatarTarget);
  // Même garde que factorScaleRigs (retargeting.js) : sans chaîne de jambe des DEUX côtés, on
  // ne devine pas un facteur — un rig mal mappé doit produire un personnage visiblement mal
  // calé, pas un chiffre plausible et faux.
  if(!(s > 0) || !(c > 0)) return 1;
  return c / s;
}

/**
 * Produit un clip qui parle au squelette `target`, à partir d'un clip écrit pour le squelette
 * `source` — MÊME résultat que `retargetClip` (retargeting.js), mais la correspondance passe
 * PAR L'AVATAR (emplacement humanoïde), jamais par le nom de l'os : `avatarSource`/`avatarTarget`
 * peuvent désigner des squelettes qui ne partagent AUCUN nom d'os.
 *
 * Une piste dont l'os source n'est mappé à AUCUN emplacement de `avatarSource`, ou dont
 * l'emplacement correspondant est absent de `avatarTarget`, tombe silencieusement — comme une
 * piste dont l'os cible manque dans `retargetClip`.
 */
export function retargetClipViaAvatar(clip, rootSource, avatarSource, rootTarget, avatarTarget, name){
  if(!clip || !clip.tracks) return null;
  // Correspondance INVERSE nom d'os source → emplacement, construite une fois.
  const slotByBone = {};
  Object.keys(avatarSource.mapping || {}).forEach(function(slot){
    slotByBone[avatarSource.mapping[slot]] = slot;
  });
  const restSource = restPoseAvatar(rootSource, avatarSource);
  const restTarget = restPoseAvatar(rootTarget, avatarTarget);
  const factor = factorScaleAvatars(rootSource, avatarSource, rootTarget, avatarTarget);

  const qSource = new THREE.Quaternion();
  const qTarget = new THREE.Quaternion();
  const qKey = new THREE.Quaternion();
  const tracks = [];

  clip.tracks.forEach(function(t){
    const point = t.name.indexOf('.');
    if(point === -1) return;
    const boneNameSource = t.name.slice(0, point);
    const prop = t.name.slice(point + 1);
    const slot = slotByBone[boneNameSource];
    if(!slot) return;                                    // os hors Avatar : rien à recibler
    const boneTarget = boneOfAvatar(rootTarget, avatarTarget, slot);
    if(!boneTarget) return;                              // emplacement absent de la cible

    const values = Array.prototype.slice.call(t.values);

    if(prop === 'position' && slot === 'Hips' && factor !== 1){
      // Seul le BASSIN porte la translation d'un clip humanoïde standard (root motion) : les
      // autres os n'ont que des rotations. Restreint au bassin, comme Unity ne normalise le
      // déplacement racine que sur cet unique os.
      for(let i = 0; i < values.length; i++) values[i] *= factor;
    }

    if(prop === 'quaternion' && restSource[slot] && restTarget[slot]){
      // Même formule que retargetClip (retargeting.js) : écart relatif à la pose de repos
      // SOURCE, réappliqué depuis la pose de repos CIBLE.
      qSource.copy(restSource[slot]).invert();
      qTarget.copy(restTarget[slot]);
      for(let i = 0; i + 3 < values.length; i += 4){
        qKey.set(values[i], values[i+1], values[i+2], values[i+3]);
        qKey.premultiply(qSource).premultiply(qTarget);
        values[i] = qKey.x; values[i+1] = qKey.y;
        values[i+2] = qKey.z; values[i+3] = qKey.w;
      }
    }

    tracks.push(new t.constructor(boneTarget.name + '.' + prop,
      Array.prototype.slice.call(t.times), values));
  });

  if(!tracks.length) return null;
  return new THREE.AnimationClip(name || clip.name, clip.duration, tracks);
}
