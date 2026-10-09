// ---------- Reciblage d'animation : poser le clip d'un fichier sur le rig d'un autre ----------
//
// Le geste que ce fichier rend possible : télécharger un personnage sur Mixamo, télécharger une
// marche à part, et faire marcher le personnage. Jusqu'ici un clip appartenait à son propre
// asset et à lui seul.
//
// Le reciblage complet (Unreal : IK Rig + IK Retargeter, une pile de treize opérations) résout
// le cas de deux squelettes ÉTRANGERS. Ce module traite le cas nettement plus current de deux
// rigs qui PARTAGENT une convention de nommage — c'est celui de Mixamo, de Rigify, de la
// plupart des bibliothèques. La correspondance se fait par nom d'os ; ce qui reste à corriger,
// ce sont les deux écarts qui subsistent même quand les noms coïncident :
//
//   1. la TAILLE — un rig plus grand doit voir la translation de bassin agrandie d'autant,
//      sinon le personnage flotte ou s'enfonce à chaque pas ;
//   2. la POSE DE REPOS — deux rigs en T-pose et en A-pose n'ont pas la même rotation d'épaule
//      au repos, et recopier la rotation brute rentrerait les bras dans le torse.
//
// Ces deux corrections sont INVISIBLES sur deux fichiers du même personnage : le facteur vaut 1
// et le delta est l'identité. Elles sont donc éprouvées sur des rigs synthétiques qui, eux,
// diffèrent (voir test/reciblage.test.mjs) — pas sur le cas qui a motivé le travail.

// Mixamo écrit `mixamorig:Hips` dans le fichier ; le chargeur FBX de three rend `mixamorigHips`,
// et un rig retravaillé dans Blender peut rendre `Hips` tout court. Les trois désignent le même
// os, et la normalisation est ce qui permet à un clip Mixamo de piloter un rig dénommé.
import { assetById } from './component-data.js';
import { retargetClipViaAvatar } from './humanoid-avatar.js';

export const PREFIXES_RIG = [/^mixamorig[:_]?/i, /^armature[:_|]?/i, /^root[:_]/i];

export function nameBoneNormalized(name){
  let n = String(name || '');
  PREFIXES_RIG.forEach(function(re){ n = n.replace(re, ''); });
  // séparateurs et casse : `LeftUpLeg`, `left_up_leg` et `Left Up Leg` deviennent le même mot
  return n.replace(/[\s_.:|-]/g, '').toLowerCase();
}

/** Os d'un modèle, indexés par nom normalisé. Premier arrivé, premier servi. */
export function boneByNameNormalized(root){
  const m = new Map();
  if(root && root.traverse) root.traverse(function(x){
    if(x.isBone && !m.has(nameBoneNormalized(x.name))) m.set(nameBoneNormalized(x.name), x);
  });
  return m;
}

/** Noms d'os cités par les pistes d'un clip, tels quels. */
export function boneCitedByClip(clip){
  const s = new Set();
  ((clip && clip.tracks) || []).forEach(function(t){
    const i = t.name.indexOf('.');
    s.add(i === -1 ? t.name : t.name.slice(0, i));
  });
  return s;
}

/**
 * Dans quelle mesure ce clip sait-il parler à ce rig ?
 * `taux` = part des os cités par le clip qui existent dans la cible. Un rig cible peut avoir
 * des os EN PLUS sans que cela gêne (Mixamo anime 52 os sur les 65 d'un personnage : les
 * bouts de doigts et le sommet du crâne ne bougent jamais).
 */
export function compatibilityClipRig(clip, target){
  const cited = boneCitedByClip(clip);
  const dispo = boneByNameNormalized(target);
  const missing = [];
  let communs = 0;
  cited.forEach(function(n){
    if(dispo.has(nameBoneNormalized(n))) communs++;
    else missing.push(n);
  });
  const total = cited.size;
  return {total:total, communs:communs, missing:missing,
          rate: total ? communs / total : 0};
}

// Rapport de taille entre deux rigs, mesuré sur la chaîne de jambe au repos.
//
// Pourquoi la jambe et pas la boîte englobante : la boîte dépend du maillage, et le rig source
// d'un fichier d'animation seule n'en a aucun. La chaîne hanche → cuisse → tibia → pied est la
// même sur tout rig humanoïde et se lit dans les os, qui sont ce qu'on a toujours.
export const STRING_SIZE = ['upleg', 'leg', 'foot', 'thigh', 'shin', 'calf'];

export function sizeOfRig(indexBone){
  let somme = 0;
  indexBone.forEach(function(os, name){
    // on ne prend qu'un côté : sommer les deux jambes doublerait la mesure sans rien changer
    // au RAPPORT, mais fausserait un rig asymétrique
    if(name.indexOf('left') !== 0 && name.indexOf('l') !== 0) return;
    if(!STRING_SIZE.some(function(m){ return name.indexOf(m) !== -1; })) return;
    somme += os.position.length();
  });
  return somme;
}

export function factorScaleRigs(indexSource, indexTarget){
  const s = sizeOfRig(indexSource);
  const c = sizeOfRig(indexTarget);
  // Aucune chaîne reconnue d'un côté ou de l'autre : on ne DEVINE pas un facteur. Laisser 1
  // affiche un personnage mal calé, ce qui se voit ; inventer un rapport donnerait un résultat
  // faux et crédible.
  if(!(s > 0) || !(c > 0)) return 1;
  return c / s;
}

/**
 * Produit un clip qui parle au rig `cible`, à partir d'un clip écrit pour le rig `source`.
 * Ne modifie ni le clip d'origine ni aucun des deux modèles.
 *
 * `name` : le nom du clip produit. Il DOIT être choisi par l'appelant, parce que deux exports
 * Mixamo s'appellent tous les deux « mixamo.com » — laisser le nom d'origine ferait qu'une
 * recherche par nom sur le personnage tomberait sur le bad clip, celui d'origine.
 */
export function retargetClip(clip, source, target, name){
  if(!clip || !clip.tracks) return null;
  const iSrc = boneByNameNormalized(source);
  const iCib = boneByNameNormalized(target);
  const factor = factorScaleRigs(iSrc, iCib);

  const qSrc = new THREE.Quaternion();
  const qCib = new THREE.Quaternion();
  const qKey = new THREE.Quaternion();
  const tracks = [];

  clip.tracks.forEach(function(t){
    const point = t.name.indexOf('.');
    if(point === -1) return;                       // piste sans propriété : rien à recibler
    const nameBone = t.name.slice(0, point);
    const prop = t.name.slice(point + 1);
    const boneTarget = iCib.get(nameBoneNormalized(nameBone));
    if(!boneTarget) return;                           // os absent de la cible : la piste tombe
    const boneSource = iSrc.get(nameBoneNormalized(nameBone));

    const values = Array.prototype.slice.call(t.values);

    if(prop === 'position' && factor !== 1){
      for(let i = 0; i < values.length; i++) values[i] *= factor;
    }

    if(prop === 'quaternion' && boneSource){
      // Report du MOUVEMENT et non de la rotation absolue :
      //   écart = repos_source⁻¹ · clé          (ce que l'os fait par rapport à SON repos)
      //   clé'  = repos_cible  · écart          (le même geste, depuis le repos de la cible)
      // Rigs de même pose de repos ⇒ écart = identité et clé' = clé, au bit près.
      qSrc.copy(boneSource.quaternion).invert();
      qCib.copy(boneTarget.quaternion);
      for(let i = 0; i + 3 < values.length; i += 4){
        qKey.set(values[i], values[i+1], values[i+2], values[i+3]);
        qKey.premultiply(qSrc).premultiply(qCib);
        values[i] = qKey.x; values[i+1] = qKey.y;
        values[i+2] = qKey.z; values[i+3] = qKey.w;
      }
    }

    // Même classe de piste que l'originale : une piste de quaternion interpole en SLERP, une
    // piste vectorielle en linéaire. Reconstruire tout en Vector ferait tourner les os par le
    // plus court chemin cartésien — visible sur les grandes rotations, invisible sur les autres.
    tracks.push(new t.constructor(boneTarget.name + '.' + prop,
      Array.prototype.slice.call(t.times), values));
  });

  if(!tracks.length) return null;
  return new THREE.AnimationClip(name || clip.name, clip.duration, tracks);
}

/** Nom unique pour un clip reciblé, lisible et non ambigu dans une liste. */
export function nameClipRetargeted(nameAsset, clip, dejaTaken){
  const base = (nameAsset || 'Animation') + ' · ' + ((clip && clip.name) || 'clip');
  if(!dejaTaken || !dejaTaken.length || dejaTaken.indexOf(base) === -1) return base;
  let n = 2;
  while(dejaTaken.indexOf(base + ' (' + n + ')') !== -1) n++;
  return base + ' (' + n + ')';
}

/**
 * Choisit la VOIE de reciblage : par Avatar humanoïde quand les deux modèles en ont un, par nom
 * d'os sinon.
 *
 * `js/humanoid-avatar.js` existait depuis le début avec ses vingt-deux emplacements et ses
 * tests — mais RIEN n'y menait : la seule voie branchée était la correspondance par nom, et un
 * rig Maya biped ne pouvait donc pas recevoir un clip Mixamo, faute d'un seul nom en commun.
 * C'est l'onglet Rig du panneau d'import qui pose les Avatars ; c'est ici qu'ils servent enfin.
 */
export function clipRetargetedBestWay(clip, rootSource, obj, name){
  const aSrc = assetById(rootSource && rootSource.userData && rootSource.userData.assetId);
  const aDst = assetById(obj && obj.userData && obj.userData.assetId);
  if(aSrc && aDst && aSrc.avatar && aDst.avatar){
    const viaAvatar = retargetClipViaAvatar(clip, rootSource, aSrc.avatar,
                                            obj, aDst.avatar, name);
    // Repli sur les noms plutôt que rien : un Avatar incomplet ne doit pas faire disparaître une
    // animation qui marchait avant qu'on coche « Humanoïde ».
    if(viaAvatar) return viaAvatar;
  }
  return retargetClip(clip, rootSource, obj, name);
}

/**
 * Attache à `obj` le clip de `racineSource`, reciblé. Renvoie le clip posé, ou null.
 * Appelé des DEUX côtés — éditeur et runtime — d'où le passage explicite de la racine source :
 * chacun retrouve son asset à sa façon, et ce fichier n'a pas à connaître les deux.
 */
export function setClipRetargetedOn(obj, rootSource, nameAsset, clip, nameImpose){
  if(!obj || !clip) return null;
  // `cloneModel` PARTAGE le tableau `animations` avec l'asset (les clips sont en lecture
  // seule, seul le mixeur est propre à l'instance). Y pousser sans copier d'abord ajouterait
  // l'animation à toutes les instances du modèle — et à l'asset lui-même.
  const existants = (obj.animations || []).slice();
  const name = nameImpose
    || nameClipRetargeted(nameAsset, clip, existants.map(function(c){ return c.name; }));
  const retargeted = clipRetargetedBestWay(clip, rootSource, obj, name);
  if(!retargeted) return null;
  existants.push(retargeted);
  obj.animations = existants;
  return retargeted;
}

/**
 * Rejoue les attachements enregistrés dans une scène. Le nom produit est IMPOSÉ depuis le
 * fichier : c'est lui que le réglage « au lancement » et la timeline citent, et un nom
 * recalculé (donc potentiellement suffixé « (2) ») romprait la référence en silence.
 *
 * Appelée par l'éditeur ET par le runtime, chacun fournissant sa propre recherche d'asset.
 */
export function reattachAnimationsExternal(obj, refs, assetById){
  const posees = [];
  (refs || []).forEach(function(ref){
    const a = ref && assetById(ref.asset);
    if(!a || !a.template) return;
    const clip = (a.template.animations || []).find(function(c){ return c.name === ref.clip; });
    if(!clip) return;
    const pose = setClipRetargetedOn(obj, a.template, a.name, clip, ref.name);
    if(pose) posees.push(pose);
  });
  return posees;
}


// EXPOSÉ EN GLOBALE, à dessein. Ces symboles sont appelés depuis des fichiers
// que les mêmes pages ne chargent pas toutes : un `import` y pointerait un
// fichier absent, et la page ne démarrerait pas. Ils gardent donc leur garde
// `typeof` côté appelant, et se déclarent ici.
globalThis.compatibilityClipRig = compatibilityClipRig;
globalThis.nameBoneNormalized = nameBoneNormalized;
globalThis.reattachAnimationsExternal = reattachAnimationsExternal;
globalThis.setClipRetargetedOn = setClipRetargetedOn;