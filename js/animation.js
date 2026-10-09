// ---------- Animation : timeline à images clés ----------
// Une piste par objet ; chaque clé mémorise la pose LOCALE (position, quaternion,
// échelle), donc les animations restent correctes sous un parent.
import { animationInProgress, clipsOf } from './anim-models.js';
import { assets } from './assets.js';
import { autosave } from './autosave.js';
import { ed } from './component-data.js';
import { logConsole } from './console.js';
import { iconOf } from './hierarchy-icon.js';
import { setStatus } from './hierarchy.js';
import { pushHistory } from './history.js';
import { syncInspector, syncInspectorThrottled } from './inspector.js';
import { escapeHtml, objects } from './objects.js';
import { aScript, engineScripts } from './scripts.js';
import { select, selection } from './selection.js';
import { field } from './shader-graph-editor.js';
import { boneByName, boneSelected, selectBone } from './skeleton.js';
import { closeModal, openModal, openPanelDock } from './ui.js';
import { Dock } from './ui/dock.js';
import { loop, mode } from './viewport.js';
import { additiveHasBase, applyEasing, applyTrackSample, segmentAt } from './track-sampling.js';

export const anim = {duration:5, t:0, playback:false, loop:true, tracks:[],
  // Mode « édition d'un clip » : la timeline n'écrit plus l'animation de la SCÈNE mais les
  // pistes d'un asset d'animation. `pistesScene` / `dureeScene` gardent l'animation de scène
  // pendant ce temps — elle n'est ni perdue ni mélangée à celle du clip.
  assetClip:null, rootClip:null, tracksScene:null, durationScene:null};

// ---------- La fenêtre Animation ----------
//
// `Window ▸ Animation` d'Unity. La timeline vivait dans une bande de 168 px au fond de
// l'éditeur, partagée avec le panneau Projet et la console : trop courte pour empiler les
// pistes d'un rig, et impossible à agrandir sans amputer la vue 3D. En fenêtre, elle flotte
// au-dessus de la vue — qu'on doit REGARDER pendant qu'on scrube — et se dimensionne au geste.

export function openWindowAnimation(){
  openPanelDock('animation');
  updateTimeline();
  return true;
}

// Plus aucun appelant dans moteur/js : gardée parce que `help-content.js` la documente comme
// atteignable depuis l'API de script. Limite connue si un futur appelant l'invoque sur un
// panneau DOCKÉ : elle le ferme au lieu de le mettre au premier plan, contrairement à l'action
// générique du menu Fenêtres qui, elle, sait le faire.
export function toggleWindowAnimation(){
  if(typeof Dock === 'undefined') return false;
  if(Dock.open('animation')){ Dock.close('animation'); return false; }
  openWindowAnimation();
  return true;
}

// ---------- Édition d'un clip d'asset ----------
//
// La différence de fond avec l'animation de scène : une piste de clip aims un CHEMIN RELATIF à
// la racine animée, pas un objet par identifiant. C'est le `relativePath` de
// `AnimationClip.SetCurve` d'Unity, et c'est ce qui rend un clip réutilisable — il décrit une
// forme de hiérarchie, pas des objets de cette scène-ci.

/** Le chemin de `obj` sous `root`, ou null s'il n'en descend pas. `''` = la racine. */
export function filePathRelativeClip(root, obj){
  const parts = [];
  let n = obj;
  while(n && n !== root){ parts.unshift(n.name); n = n.parent; }
  return n === root ? parts.join('/') : null;
}

/** L'inverse : l'objet vivant désigné par un chemin, ou null s'il a disparu. */
export function objectOfFilePathClip(root, filePath){
  if(!root) return null;
  if(!filePath) return root;
  let n = root;
  const parts = filePath.split('/');
  for(let i = 0; i < parts.length; i++){
    n = (n.children || []).find(function(c){ return c.name === parts[i]; });
    if(!n) return null;
  }
  return n;
}

/** Les pistes de l'ANIMATION DE SCÈNE, quel que soit le mode current. */
export function tracksOfScene(){ return anim.assetClip ? (anim.tracksScene || []) : anim.tracks; }
export function setTracksOfScene(list){
  if(anim.assetClip) anim.tracksScene = list;
  else anim.tracks = list;
}

export function assetClipOpen(){
  return anim.assetClip
    ? (assets.find(function(x){ return x.id === anim.assetClip; }) || null) : null;
}

/**
 * Les pistes de l'asset, vues comme des pistes de timeline.
 *
 * `cles` est LE MÊME tableau que celui de l'asset : tout ce que la timeline y écrit est déjà
 * dans le clip. Recopier obligerait à réécrire l'asset à chaque geste, et la moindre voie
 * oubliée perdrait le travail sans un mot.
 */
export function tracksLiveOfClip(asset, root){
  return (asset.tracks || []).map(function(p){
    const obj = p.os ? root : objectOfFilePathClip(root, p.filePath || '');
    const os = p.os ? boneByName(root, p.os) : null;
    return {obj:obj, os:os, keys:p.keys, additif:!!p.additif, src:p, filePath:p.filePath || ''};
  }).filter(function(p){ return p.obj && (!p.src.os || p.os); });
}

export function openClipAsset(asset){
  if(!asset) return false;
  const root = selection || anim.rootClip;
  if(!root){
    setStatus('Sélectionnez d\'abord l\'objet racine du clip — celui qui portera l\'Animator', 6000);
    return false;
  }
  if(anim.assetClip) closeClipAsset();
  if(anim.playback) togglePlayback();
  anim.tracksScene = anim.tracks;
  anim.durationScene = anim.duration;
  anim.assetClip = asset.id;
  anim.rootClip = root;
  anim.duration = asset.duration || 1;
  anim.t = 0;
  anim.tracks = tracksLiveOfClip(asset, root);
  keySel = null;
  document.getElementById('an-duration').value = anim.duration;
  updateTimeline();
  setStatus('Clip « ' + asset.name + ' » ouvert — racine : ' + root.name, 4000);
  return true;
}

export function closeClipAsset(){
  if(!anim.assetClip) return false;
  if(anim.playback) togglePlayback();
  anim.assetClip = null;
  anim.rootClip = null;
  anim.tracks = anim.tracksScene || [];
  anim.duration = anim.durationScene || 5;
  anim.tracksScene = null;
  anim.durationScene = null;
  anim.t = 0;
  keySel = null;
  const field = document.getElementById('an-duration');
  if(field) field.value = anim.duration;
  updateTimeline();
  return true;
}

/**
 * À appeler après toute écriture dans les clés d'un clip ouvert.
 *
 * `rev` est ce qui fait recuire le clip compilé : la liste des pistes reste le même objet quand
 * on déplace une clé, donc rien d'autre ne pourrait voir que le clip a changé — et l'Animator
 * continuerait de jouer l'ancienne version, indéfiniment.
 */
export function markClipModified(){
  const a = assetClipOpen();
  if(!a) return;
  a.rev = (a.rev || 0) + 1;
  a.duration = anim.duration;
  if(typeof autosave !== 'undefined') autosave.modifie = true;
}
export let keySel = null;          // {piste, key}
export function setKeySel(v){ keySel = v; }
export const tlNames = document.getElementById('tl-names');
export const tlNamesList = document.getElementById('tl-names-list');
export const tlZone = document.getElementById('tl-zone');
export const tlRule = document.getElementById('tl-ruler');
export const tlTracks = document.getElementById('tl-tracks');
export const tlPlayhead = document.getElementById('tl-playhead');
export const anTime = document.getElementById('an-time');
export const btnPlayback = document.getElementById('an-play');
export const btnDelKey = document.getElementById('an-del-key');

// Une piste aims un objet de projet, ou UN OS de son squelette (`os` non nul). Les deux
// coexistent : un modèle peut avoir une piste pour lui-même — son déplacement dans la scène —
// et une piste par os animé. Seule la CIBLE change, tout le reste du mécanisme est identique.
export function trackOf(obj, os, create){
  let p = anim.tracks.find(x => x.obj === obj && (x.os || null) === (os || null));
  if(p || !create) return p;
  if(anim.assetClip){
    const asset = assetClipOpen();
    // Un os n'a pas de chemin — il n'est pas un objet de projet (js/skeleton.js) — et three
    // le résout par son nom n'importe où dans le sous-arbre, comme Unity.
    const filePath = os ? '' : filePathRelativeClip(anim.rootClip, obj);
    // Hors de la racine : refusé, et non rattaché à la racine par défaut. Un clip qui anime un
    // objet qui n'est pas sous lui n'est pas réutilisable, et le découvrir à l'instanciation
    // du prefab serait très tard.
    if(!asset || filePath === null) return null;
    const src = {filePath:filePath, os:os ? os.name : null, keys:[]};
    asset.tracks = asset.tracks || [];
    asset.tracks.push(src);
    p = {obj:obj, os:os || null, keys:src.keys, src:src, filePath:filePath};
  } else {
    p = {obj:obj, os:os || null, keys:[]};
  }
  anim.tracks.push(p);
  return p;
}

export function targetOfTrack(p){ return p.os || p.obj; }

/**
 * Le clip affiché écrit-il la pose de CETTE cible, à chaque image ?
 *
 * C'est la condition d'existence d'une couche additive : il faut quelque chose à quoi
 * s'add, et surtout une base REPOSÉE à chaque image. Sans elle, l'écart s'accumulerait.
 *
 * La question se pose par OS, pas par objet. Un clip humanoïde anime 52 os sur 65 : sur un os
 * qu'il n'anime pas, personne ne repose la base, et composer un écart à chaque image le ferait
 * s'accumuler. C'est la dérive lente, sans erreur, qu'on met sur le compte de l'animation.
 */
export function clipDriven(obj, target){
  if(!obj || typeof clipShown === 'undefined') return false;
  if(clipShown.obj !== obj || !clipShown.action || !clipShown.clip) return false;
  if(!target) return false;
  // Et c'est TOUT : la présence d'une piste au nom de la cible répond à la question, qu'il
  // s'agisse d'un os ou de la racine du modèle. La MÊME fonction que le jeu publié
  // (js/track-sampling.js) : les deux moteurs décidaient différemment (revue du 2026-09-29, § 1.7).
  return additiveHasBase(clipShown.clip, target);
}

// (Le hidden d'interpolants a suivi `poseOfClip` dans js/animator.js. Le laisser ici aurait
// donné un second hidden, jamais rempli, qui aurait eu l'air d'expliquer les performances.)

/**
 * Écrit dans `key` l'écart entre la pose du clip (`base`) et celle que porte `cible`.
 *
 * Une piste du clip peut manquer pour une composante — Mixamo n'écrit qu'UNE piste de position
 * sur 53, celle du bassin. Sans piste, il n'y a pas de base : l'écart neutre est alors le bon,
 * parce qu'à l'application rien ne réécrira cette composante non plus.
 */
export function gapToKey(key, base, target){
  key.pos = base.pos
    ? [target.position.x - base.pos[0], target.position.y - base.pos[1], target.position.z - base.pos[2]]
    : [0, 0, 0];
  if(base.quat){
    key.quat = new THREE.Quaternion().fromArray(base.quat).invert()
      .multiply(target.quaternion).toArray();
  } else {
    key.quat = [0, 0, 0, 1];
  }
  key.ech = base.ech
    ? [target.scale.x / (base.ech[0] || 1), target.scale.y / (base.ech[1] || 1),
       target.scale.z / (base.ech[2] || 1)]
    : [1, 1, 1];
}

/**
 * La pose que le clip donne à cette cible à l'instant `t`, lue DANS SES PISTES.
 *
 * Le calcul vit dans le fichier PARTAGÉ js/animator.js : l'inertialisation en a besoin elle
 * aussi, des DEUX côtés du mur éditeur/runtime. Deux copies d'un même échantillonnage de clip
 * seraient exactement la famille de divergence la plus coûteuse de ce dépôt.
 *
 * Le pourquoi, qui n'a pas bougé : surtout pas en passant par le mixeur. `PropertyMixer.apply`
 * de three n'écrit dans la scène que si la valeur accumulée a CHANGÉ. Après qu'on a bougé l'os
 * à la main, redemander la même pose au même instant ne réécrit donc rien — l'os garde la pose
 * de l'utilisateur, et l'écart calculé par différence vaut l'identité. Défaut mesuré : la clé
 * enregistrée valait [0,0,0,1] au lieu des 30° demandés. On lit la source, elle ne ment pas.
 */
export function poseOfClip(clip, name, t){
  return poseOfClipFor(clip, name, t);
}

/**
 * Traduit les clés d'une piste quand son mode change.
 *
 * Une clé ne veut pas dire la même chose dans les deux modes : en « remplace » c'est une POSE,
 * en « ajoute » c'est un ÉCART. Basculer sans traduire enverrait l'os à l'autre bout de la
 * scène dans un sens, et l'écraserait sur l'origine dans l'autre — un résultat absurde qu'on
 * mettrait sur le compte d'un bug plutôt que sur celui du bouton qu'on vient de presser.
 *
 * Sans clip, il n'existe aucune base par rapport à quoi traduire : on laisse les clés telles
 * quelles, et la piste additive reste de toute façon inert tant qu'aucun clip ne joue.
 */
export function convertKeysOfTrack(p){
  const target = targetOfTrack(p);
  if(!clipDriven(p.obj, target)) return false;
  p.keys.forEach(function(c){
    // La base est lue DANS LES PISTES du clip, pas via le mixeur — même raison que dans
    // `setKey` : le mixeur ne réécrit pas une valeur qu'il croit inchangée.
    const b = poseOfClip(clipShown.clip, target.name, c.t);
    const bp = new THREE.Vector3().fromArray(b.pos || [0, 0, 0]);
    const bq = new THREE.Quaternion().fromArray(b.quat || [0, 0, 0, 1]);
    const be = new THREE.Vector3().fromArray(b.ech || [1, 1, 1]);
    const vp = new THREE.Vector3().fromArray(c.pos);
    const vq = new THREE.Quaternion().fromArray(c.quat);
    const ve = new THREE.Vector3().fromArray(c.ech);
    if(p.additif){                             // pose absolue → écart
      c.pos = vp.sub(bp).toArray();
      c.quat = bq.invert().multiply(vq).toArray();
      c.ech = [ve.x / (be.x || 1), ve.y / (be.y || 1), ve.z / (be.z || 1)];
    } else {                                   // écart → pose absolue
      c.pos = bp.add(vp).toArray();
      c.quat = bq.multiply(vq).toArray();
      c.ech = [be.x * ve.x, be.y * ve.y, be.z * ve.z];
    }
  });
  return true;
}

export function setKey(){
  if(!selection){ setStatus('Sélectionnez un objet pour poser une clé', 2500); return; }
  // Un os sélectionné prend la main sur son modèle : c'est lui qu'on vient de move au gizmo.
  const os = (typeof boneSelected !== 'undefined') ? boneSelected : null;

  // Le mixeur d'animation écrit dans les MÊMES transformées que la timeline. Les deux à la
  // fois donnent un personnage qui tremble, sans la moindre erreur : celui qui écrit en
  // dernier gagne, et ça change d'une image à l'autre. On refuse plutôt que de laisser
  // l'utilisateur chercher.
  if(os && animationInProgress(selection)){
    setStatus('Un clip est en lecture sur ce modèle : arrêtez-le avant de poser des clés sur '
      + 'ses os, sinon les deux se disputent la pose.', 7000);
    return;
  }

  // En mode clip, la clé s'écrit dans l'asset : l'historique de la SCÈNE n'a rien à register,
  // et le faire y verserait les pistes du clip.
  if(!anim.assetClip) pushHistory();
  const target = os || selection;
  const neuve = !trackOf(selection, os, false);
  const p = trackOf(selection, os, true);
  if(!p){
    setStatus('« ' + selection.name + ' » n\'est pas sous la racine du clip ('
      + (anim.rootClip ? anim.rootClip.name : '?') + ') : un clip ne peut animer que sa '
      + 'propre hiérarchie.', 7000);
    return;
  }
  // Une piste NEUVE naît additive s'il y a un clip à quoi s'add, et remplaçante sinon :
  // retoucher une animation existante est le geste attendu, et il n'y a rien à quoi s'add
  // quand aucun clip ne joue. Le mode reste changeable à la main, piste par piste.
  if(neuve) p.additif = clipDriven(selection, target);
  const existante = p.keys.find(c => Math.abs(c.t - anim.t) < 0.02);
  const key = existante || {t:anim.t};
  key.t = existante ? key.t : anim.t;
  if(p.additif){
    // On enregistre l'ÉCART à la pose du clip, pas la pose finale. Une pose absolue figerait
    // l'os : rejouée sur une autre partie du clip — ou sur un clip modifié — elle imposerait
    // la position d'alors, et « +10° de tête » deviendrait « tête à cette orientation-là ».
    const base = poseOfClip(clipShown.clip, target.name, anim.t);
    gapToKey(key, base, target);
  } else {
    key.pos = target.position.toArray();
    key.quat = target.quaternion.toArray();
    key.ech = target.scale.toArray();
  }
  if(!existante) p.keys.push(key);
  p.keys.sort((a,b) => a.t - b.t);
  keySel = {track:p, key:key};
  markClipModified();
  updateTimeline();
  setStatus((existante ? 'Clé remplacée' : 'Clé posée') + ' à ' + anim.t.toFixed(2) + ' s pour '
    + (os ? selection.name + ' › ' + os.name : selection.name), 2000);
}

export function deleteKey(){
  if(!keySel) return;
  if(!anim.assetClip) pushHistory();
  const p = keySel.track;
  p.keys.splice(p.keys.indexOf(keySel.key), 1);
  if(!p.keys.length){
    anim.tracks.splice(anim.tracks.indexOf(p), 1);
    // La piste part aussi de l'ASSET : la laisser empty y garderait un chemin mort, que la
    // validation signalerait à chaque ouverture pour une suppression déjà terminée.
    const asset = assetClipOpen();
    if(asset && p.src) asset.tracks = (asset.tracks || []).filter(function(x){ return x !== p.src; });
  }
  keySel = null;
  markClipModified();
  updateTimeline();
  applyAnimation(anim.t);
}

export const _vA = new THREE.Vector3(), _vB = new THREE.Vector3();
export const _qA = new THREE.Quaternion(), _qB = new THREE.Quaternion();

// Les courbes d'easing vivent dans js/track-sampling.js (partagé avec le jeu publié).
export { applyEasing };
const _tmpTrack = {vA: _vA, vB: _vB, qA: _qA, qB: _qB};

export function applyAnimation(t){
  // LE CLIP D'ABORD, NOS PISTES ENSUITE — l'ordre décide de qui gagne, et il décidait mal.
  //
  // Le clip affiché suit la tête de lecture : c'est ce qui rend ses clés utiles plutôt que
  // décoratives, puisque se déplacer dedans est la seule façon de choisir l'instant où poser
  // sa propre clé. Mais il était appliqué APRÈS nos pistes, donc il les écrasait : on posait
  // une clé sur un os, et elle ne faisait rien. Depuis que le clip s'shown automatiquement
  // à la sélection, c'était devenu le cas par défaut.
  //
  // Nos pistes passent donc en dernier. Deux façons pour une clé de cohabiter avec le clip :
  //  · REMPLACE — la clé impose sa pose. Le seul mode possible sans clip.
  //  · AJOUTE   — la clé porte un ÉCART, composé par-dessus la pose du clip à cet instant.
  //               « +10° de tête sur la marche » sans réécrire le mouvement de la tête.
  if(typeof updateClipShown === 'function') updateClipShown(t);
  anim.tracks.forEach(function(p){
    if(!p.keys.length) return;
    // Une piste additive n'a de sens que par-dessus quelque chose. Sans clip pour reposer la
    // base à chaque image, composer l'écart l'accumulerait — l'os dériverait un peu plus à
    // chaque image, doucement, sans erreur, jusqu'à sortir de l'écran.
    //
    // Elle est alors INERTE, et surtout pas rabattue sur « remplace » : ses clés sont des
    // ÉCARTS, et les lire comme des poses absolues collerait l'os près de l'origine. Ne rien
    // faire se voit ; faire n'importe quoi ressemble à une animation ratée.
    if(p.additif && !clipDriven(p.obj, targetOfTrack(p))) return;
    // L'écart (additif) est composé sur ce que le clip vient d'écrire. Idempotent : rejouer le
    // même instant redonne le même résultat, parce que le clip a remis la base juste avant.
    applyTrackSample(targetOfTrack(p), segmentAt(p.keys, t), p.additif, _tmpTrack);
  });
  // (Un SECOND appel à `updateClipShown(t)` vivait ici. La v0.32.2 avait remonté l'appel avant
  // les pistes pour que nos clés gagnent, sans supprimer l'original : le clip était donc
  // réappliqué juste après, ce qui aurait dû undo le correctif. Mesuré : la clé tenait
  // quand même — `PropertyMixer.apply` de three n'écrit dans la scène que si la valeur
  // accumulée a changé, et au même instant elle ne change pas. Le doublon ne cassait donc rien,
  // par ACCIDENT d'un détail interne de three, et coûtait une passe de mixeur par image.
  // On ne garde pas un correctif dont la survie dépend d'une optimisation qu'on ne contrôle pas.)
  if(selection && trackOf(selection, null)) syncInspectorThrottled();
}

export function updatePlayhead(){
  tlPlayhead.style.left = (anim.t / anim.duration * 100) + '%';
  anTime.textContent = anim.t.toFixed(2) + ' s';
}

export function updateTimeline(){
  // règle graduée
  let rule = '';
  const step = anim.duration > 20 ? 5 : (anim.duration > 8 ? 2 : 1);
  for(let s = 0; s <= anim.duration + 0.001; s += step){
    const x = (s / anim.duration * 100);
    rule += '<div class="tl-tick" style="left:'+x+'%"></div>'
           + '<div class="tl-grad" style="left:'+x+'%">'+s+'</div>';
  }
  tlRule.innerHTML = rule;

  // pistes + noms
  let names = '';
  let tracks = '';
  // Ce message se taisait-il quand un clip était affiché ? Non : il annonçait le vide au-dessus
  // de cinquante-deux lignes d'os parfaitement visibles à gauche. Deux affirmations
  // contradictoires dans la même fenêtre, et c'est la fausse qui était lisible.
  if(!anim.tracks.length && !clipShown.clip){
    tracks = '<div id="tl-empty">Aucune piste — sélectionnez un objet, placez-le, puis « 🔑 Poser une clé ». '
      + 'Déplacez la tête de lecture, changez la pose, posez d\'autres clés.</div>';
  }
  anim.tracks.forEach(function(p, pi){
    const isSel = (p.obj === selection);
    // Une piste d'os porte le nom du modèle ET celui de l'os : « Perso › mixamorig:Spine ».
    // Le seul nom de l'objet donnerait plusieurs pistes rigoureusement identiques à l'écran,
    // et on ne saurait plus laquelle anime quoi.
    const tag = p.os ? (p.obj.name + ' › ' + p.os.name) : p.obj.name;
    // Le mode est écrit sur la piste, pas caché dans un menu : « + » et « = » ne veulent pas
    // dire la même chose du tout, et rien d'autre à l'écran ne les distingue.
    const inert = p.additif && !clipDriven(p.obj, targetOfTrack(p));
    const mode = '<span class="tl-mode' + (p.additif ? ' add' : '') + (inert ? ' inert' : '')
      + '" data-mode="' + pi + '" title="'
      + (p.additif
          ? (inert
              ? 'AJOUTE au clip — mais aucun clip ne joue sur cet objet, donc cette piste ne '
                + 'fait rien pour l\'instant. Cliquez pour passer en « remplace ».'
              : 'AJOUTE au clip : la clé porte un écart, composé par-dessus l\'animation. '
                + 'Cliquez pour passer en « remplace ».')
          : 'REMPLACE le clip pour cette cible. Cliquez pour passer en « ajoute ».')
      + '">' + (p.additif ? '+' : '=') + '</span>';
    names += '<div class="tl-name'+(isSel?' sel':'')+'" data-pi="'+pi+'" title="'+escapeHtml(tag)+'">'
          + (p.os ? '🦴 ' : iconOf(p.obj)) + escapeHtml(tag) + mode + '</div>';
    let keys = '';
    p.keys.forEach(function(c, ci){
      const sel = (keySel && keySel.key === c) ? ' sel' : '';
      keys += '<div class="key'+sel+'" data-pi="'+pi+'" data-ci="'+ci+'" style="left:'+(c.t/anim.duration*100)+'%"></div>';
    });
    tracks += '<div class="tl-track'+(isSel?' sel':'')+'">'+keys+'</div>';
  });
  // Les os animés par le clip importé, en lecture seule. Ils viennent APRÈS nos pistes : ce
  // sont des données de l'asset, pas du projet, et l'ordre le dit.
  if(clipShown.clip){
    const tous = boneAnimatedOfClip(clipShown.clip);
    // Un rig humanoïde anime cinquante-deux os. Les dérouler tous, à chaque sélection, donne
    // une colonne qu'on ne lit pas et dans laquelle on ne trouve rien : le repli et le filtre
    // ne sont pas du confort, ils sont la condition pour que cette liste serve.
    const filter = (clipShown.filter || '').trim().toLowerCase();
    const ranks = filter
      ? tous.filter(function(r){ return r.name.toLowerCase().indexOf(filter) !== -1; })
      : tous;
    const count = filter ? (ranks.length + ' / ' + tous.length + ' os')
                          : (tous.length + ' os');
    names += '<div class="tl-name clip-header" id="tl-clip-header" title="Clip importé, en '
      + 'lecture seule — ces clés appartiennent à l\'asset et sont partagées par tous les '
      + 'objets qui s\'en servent. Cliquez pour replier.">'
      + (clipShown.folded ? '▸ ' : '▾ ') + '🎞 ' + escapeHtml(clipShown.clip.name)
      + ' <span class="tl-count">' + count + '</span></div>';
    tracks += '<div class="tl-track clip-header"></div>';

    // La piste de marqueurs, toujours visible même clip replié : c'est la seule chose de ce
    // groupe qu'on ÉDITE, et la replier avec les os la rendrait introuvable.
    const marq = markersOfClipShown();
    names += '<div class="tl-name clip-markers" title="Marqueurs d\'événement : à cet instant '
      + 'du clip, un événement nommé est émis. Un objet réglé sur « À la réception d\'un '
      + 'événement » peut alors jouer un son, lancer des particules, etc.">🔔 Marqueurs'
      + ' <span class="tl-count">' + marq.length + '</span></div>';
    tracks += '<div class="tl-track clip-markers">' + marq.map(function(m, i){
      return '<div class="marker" data-mi="' + i + '" style="left:'
        + (Math.min(1, m.t / anim.duration) * 100) + '%" title="' + escapeHtml(m.name || '(sans nom)')
        + ' à ' + m.t.toFixed(2) + ' s — clic pour renommer, Suppr pour retirer">'
        + '<span class="marker-name">' + escapeHtml(m.name || '?') + '</span></div>';
    }).join('') + '</div>';
    (clipShown.folded ? [] : ranks).forEach(function(r){
      // L'os en cours d'édition est surligné : c'est le seul link visible entre l'arbre du
      // squelette, à droite, et la ligne où sa clé va se poser, en bas.
      const aims = (typeof boneSelected !== 'undefined' && boneSelected
                    && boneSelected.name === r.name) ? ' aims' : '';
      names += '<div class="tl-name clip-bone' + aims + '" data-bone="' + escapeHtml(r.name)
        + '" title="' + escapeHtml(r.name) + ' — ' + r.instants.length
        + ' clés. Cliquez pour éditer cet os.">' + escapeHtml(r.name) + '</div>';
      // Échantillonnage à l'affichage : à 31 clés par seconde elles se touchent déjà, en
      // dessiner deux mille ne montre rien de plus et alourdit chaque rafraîchissement.
      const step = Math.max(1, Math.ceil(r.instants.length / MAX_KEYS_SHOWN));
      let dots = '';
      for(let i = 0; i < r.instants.length; i += step){
        dots += '<div class="key clip" style="left:'
          + (Math.min(1, r.instants[i] / anim.duration) * 100) + '%"></div>';
      }
      const viseP = (typeof boneSelected !== 'undefined' && boneSelected
                     && boneSelected.name === r.name) ? ' aims' : '';
      tracks += '<div class="tl-track clip-bone' + viseP + '">' + dots + '</div>';
    });
  }
  tlNamesList.innerHTML = names;
  tlTracks.innerHTML = tracks;
  btnDelKey.disabled = !keySel;
  const selEasing = document.getElementById('an-easing');
  selEasing.disabled = !keySel;
  selEasing.value = keySel ? (keySel.key.easing || 'lineaire') : 'lineaire';
  // Le filtre d'os n'a de sens qu'avec un clip sous les yeux : le laisser active en permanence
  // ferait un champ qui ne filtre rien, ce qui se lit comme une panne.
  const fieldFilter = document.getElementById('an-filter-bone');
  if(fieldFilter){
    fieldFilter.disabled = !clipShown.clip;
    fieldFilter.value = clipShown.filter || '';
  }
  // Un marker se pose SUR un clip : sans clip affiché le bouton n'aurait rien à viser.
  const btnMarq = document.getElementById('an-marker');
  if(btnMarq) btnMarq.disabled = !clipShown.clip;
  updatePlayhead();
}

document.getElementById('an-easing').addEventListener('change', function(){
  if(!keySel) return;
  pushHistory();
  keySel.key.easing = this.value;
  applyAnimation(anim.t);
});

// clic sur un nom de piste = sélection de l'objet
tlNames.addEventListener('click', function(e){
  // Le bascule de mode est DANS la ligne : sans ce test, changer de mode sélectionnerait
  // aussi l'objet, ce qui reconstruit l'inspecteur pour rien.
  const bascule = e.target.closest('.tl-mode');
  if(bascule){
    const p = anim.tracks[parseInt(bascule.dataset.mode, 10)];
    if(!p) return;
    pushHistory();
    p.additif = !p.additif;
    // Les clés changent de SENS avec le mode : une pose absolue lue comme un écart enverrait
    // l'os à l'autre bout de la scène, et un écart lu comme une pose absolue l'écraserait sur
    // l'origine. On les convertit plutôt que de laisser l'utilisateur devant un résultat absurde.
    convertKeysOfTrack(p);
    applyAnimation(anim.t);
    updateTimeline();
    setStatus(p.additif
      ? 'Cette piste AJOUTE au clip : ses clés sont des écarts'
      : 'Cette piste REMPLACE le clip pour sa cible', 3000);
    return;
  }
  const el = e.target.closest('.tl-name');
  if(!el) return;
  // En-tête du clip : replier ou déplier ses os. Cinquante-deux lignes se réduisent à une.
  if(el.id === 'tl-clip-header'){
    clipShown.folded = !clipShown.folded;
    updateTimeline();
    return;
  }
  // Ligne d'os du clip : la timeline DÉSIGNE l'os à éditer, au lieu de le faire chercher dans
  // l'arbre du squelette de l'inspecteur. C'est le même geste, dans le sens inverse.
  if(el.dataset.bone){
    const model = clipShown.obj;
    let os = null;
    if(model) model.traverse(function(x){
      if(!os && x.isBone && x.name === el.dataset.bone) os = x;
    });
    if(os) selectBone(os === boneSelected ? null : os);
    return;
  }
  const p = anim.tracks[parseInt(el.dataset.pi, 10)];
  if(p) select(p.obj);
});

document.getElementById('an-marker').addEventListener('click', function(){
  const src = sourceMarkersShown();
  if(!src){ setStatus('Affichez d\'abord une animation : un marqueur se pose sur un clip', 3500); return; }
  const name = (prompt('Nom de l\'événement à émettre à ' + anim.t.toFixed(2) + ' s\n\n'
    + 'Un objet réglé sur « À la réception d\'un événement » avec ce nom réagira : '
    + 'jouer un son, émettre des particules, montrer, cacher…', 'pas') || '').trim();
  if(!name) return;
  pushHistory();
  // Le temps est ramené dans le clip : la timeline peut être plus longue que lui, et un
  // marker posé au-delà de sa fin ne serait jamais franchi.
  setMarker(src.asset, src.clip, Math.min(anim.t, clipShown.clip.duration), name);
  updateTimeline();
  setStatus('Marqueur « ' + name + ' » posé sur « ' + src.clip + ' » — il appartient au clip, '
    + 'donc à tous les objets qui le jouent', 4500);
});

// Renommer ou unregister un marker. Le clic aims la piste, pas chaque puce : elles sont
// reconstruites à chaque rafraîchissement de la timeline.
tlTracks.addEventListener('click', function(e){
  const puce = e.target.closest('.marker');
  if(!puce) return;
  const src = sourceMarkersShown();
  if(!src) return;
  const i = parseInt(puce.dataset.mi, 10);
  const list = markersOfClip(src.asset, src.clip);
  if(!list[i]) return;
  const name = prompt('Nom de l\'événement (vide pour retirer le marqueur) :', list[i].name || '');
  if(name === null) return;               // Annuler ≠ chaîne vide : on ne supprime pas par erreur
  pushHistory();
  if(!name.trim()) removeMarker(src.asset, src.clip, i);
  else list[i].name = name.trim();
  updateTimeline();
});

export const fieldFilterBone = document.getElementById('an-filter-bone');
if(fieldFilterBone) fieldFilterBone.addEventListener('input', function(){
  clipShown.filter = this.value;
  updateTimeline();
  // `updateTimeline` reconstruit la colonne des noms, pas le champ : le focus reste où il est,
  // et on peut continuer à taper.
});

// molette temporelle : glisser dans la zone = déplacer la tête de lecture,
// glisser une clé = la déplacer dans le temps
export let dragKey = null;
export function timeFromX(clientX){
  const rect = tlTracks.getBoundingClientRect();
  const f = (clientX - rect.left) / rect.width;
  return Math.max(0, Math.min(anim.duration, f * anim.duration));
}

tlZone.addEventListener('pointerdown', function(e){
  const elKey = e.target.closest ? e.target.closest('.key') : null;
  if(elKey){
    const p = anim.tracks[parseInt(elKey.dataset.pi, 10)];
    const c = p && p.keys[parseInt(elKey.dataset.ci, 10)];
    if(!c) return;
    keySel = {track:p, key:c};
    pushHistory();
    dragKey = {el:elKey, key:c, track:p, bouge:false};
    btnDelKey.disabled = false;
    tlZone.setPointerCapture(e.pointerId);
    e.preventDefault();
    return;
  }
  anim.playback = false;
  btnPlayback.textContent = '▶';
  anim.t = timeFromX(e.clientX);
  applyAnimation(anim.t);
  updatePlayhead();
  dragKey = {scrub:true};
  tlZone.setPointerCapture(e.pointerId);
});

tlZone.addEventListener('pointermove', function(e){
  if(!dragKey) return;
  if(dragKey.scrub){
    anim.t = timeFromX(e.clientX);
    applyAnimation(anim.t);
    updatePlayhead();
  } else {
    dragKey.bouge = true;
    dragKey.key.t = timeFromX(e.clientX);
    dragKey.el.style.left = (dragKey.key.t / anim.duration * 100) + '%';
  }
});

tlZone.addEventListener('pointerup', function(e){
  if(dragKey && !dragKey.scrub){
    if(dragKey.bouge){
      dragKey.track.keys.sort((a,b) => a.t - b.t);
      markClipModified();
      applyAnimation(anim.t);
    } else {
      // simple clic sur la clé : on amène la tête de lecture dessus
      anim.t = dragKey.key.t;
      applyAnimation(anim.t);
    }
    updateTimeline();
  }
  dragKey = null;
});

export function togglePlayback(){
  // Un CLIP AFFICHÉ count, au même titre qu'une piste ou qu'un script.
  //
  // Cette garde est antérieure à l'affichage des clips importés et ne le connaissait pas :
  // un personnage rigué sélectionné, son animation étalée dans la timeline sous les yeux,
  // et le bouton lecture répondait « Posez des clés d'animation ». Le seul cas où on a
  // vraiment envie d'appuyer sur ▶ était précisément celui qu'elle refusait.
  const aQuelqueChoseAPlay = anim.tracks.length
    || (typeof clipShown !== 'undefined' && clipShown.clip)
    || objects.some(aScript);
  if(!aQuelqueChoseAPlay){
    setStatus('Posez des clés d\'animation, sélectionnez un modèle animé, ou ajoutez un '
      + 'script à un objet', 3000);
    return;
  }
  anim.playback = !anim.playback;
  if(anim.playback && anim.t >= anim.duration) anim.t = 0;
  btnPlayback.textContent = anim.playback ? '⏸' : '▶';
}

document.getElementById('an-key').addEventListener('click', setKey);
btnDelKey.addEventListener('click', deleteKey);
btnPlayback.addEventListener('click', togglePlayback);
document.getElementById('an-start').addEventListener('click', function(){
  anim.t = 0;
  applyAnimation(0);
  updatePlayhead();
});
document.getElementById('an-loop').addEventListener('click', function(){
  anim.loop = !anim.loop;
  this.classList.toggle('active', anim.loop);
});
document.getElementById('an-duration').addEventListener('change', function(){
  const v = parseFloat(this.value);
  // Un clip descend sous la seconde — un saut fait 0,4 s — alors qu'une animation de scène
  // part de 1 s. La clamped suit donc le mode, elle n'est pas la même chose dans les deux cas.
  const minimum = anim.assetClip ? 0.05 : 1;
  if(isNaN(v) || v < minimum) { this.value = anim.duration; return; }
  // Instantané AVANT d'écrêter : raccourcir la durée ramène le temps de toute clé qui dépass
  // à la nouvelle fin. Plusieurs clés s'y empilent alors au même instant, et leur position
  // d'origine est perdue — sans historique, Ctrl+Z ne la ramenait pas. Réduire la durée par
  // error, ne serait-ce qu'en tapant un chiffre de trop, détruisait le travail.
  const ecrete = anim.tracks.some(p => p.keys.some(c => c.t > v));
  if(ecrete && !anim.assetClip) pushHistory();
  anim.duration = v;
  anim.t = Math.min(anim.t, anim.duration);
  anim.tracks.forEach(p => p.keys.forEach(c => { c.t = Math.min(c.t, anim.duration); }));
  markClipModified();
  if(ecrete) setStatus('Durée réduite : des clés dépassaient et ont été ramenées à '
    + anim.duration + ' s. Ctrl+Z pour revenir.', 6000);
  updateTimeline();
});

// ---------- Préréglages d'animation de caméra ----------
//
// Une caméra était déjà animable — la timeline est générique, elle clé n'importe quel objet
// sélectionné. Ce qui manquait, c'est de ne pas avoir à poser vingt-quatre clés à la main pour
// un tour complet.
//
// Ces préréglages ne font rien qu'on ne puisse faire soi-même : ils ÉCRIVENT des clés
// ordinaires dans la piste de la caméra. On peut donc les retoucher, en supprimer une, changer
// une courbe — ce ne sont pas des trajectoires opaques posées à côté de la timeline.

export const STEP_ANGLE_PRESET = 15;   // degrés entre deux clés : au-delà, la corde se voit sur l'arc

// LA DIRECTION DE VUE D'UN OBJET CAMÉRA EST +Z, PAS −Z, et il faut le savoir.
//
// La `PerspectiveCamera` que porte l'objet est tournée d'un demi-tour autour de Y
// (`cam.rotation.y = Math.PI`, posé aux deux endroits qui fabriquent une caméra :
// js/objects.js et js/components/component-camera.js). Le −Z de la vraie caméra tombe donc sur
// le +Z de l'objet. C'est cohérent avec `Object3D.lookAt`, qui oriente +Z vers la cible pour
// tout ce qui n'est PAS une caméra three : un objet caméra se manipule ici comme un objet
// ordinaire.
//
// Prendre −Z — le réflexe — place le centre d'orbite DERRIÈRE la caméra : elle tourne alors
// autour d'un point qu'elle ne regarde pas, en lui tournant le dos. Mesuré avant correction :
// rayon variant de 10 à 30 m au lieu de rester à 10, et produit scalaire de −1 entre la
// direction de vue et celle du centre — l'exact opposé.
export function beforeCamera(cam){
  return new THREE.Vector3(0, 0, 1).applyQuaternion(cam.quaternion);
}

// Le point regardé, à la distance demandée. On le déduit de l'orientation actuelle plutôt que
// de demander trois coordonnées : la caméra est déjà pointée quelque part, c'est cet endroit-là
// qu'on veut tourner autour.
export function targetWatched(cam, distance){
  return cam.position.clone().addScaledVector(beforeCamera(cam), distance);
}

// Un quaternion qui regarde un point, sans toucher à la caméra : `lookAt` écrit dans l'objet,
// donc on passe par un mannequin plutôt que de move puis remettre.
export const _dummy = new THREE.Object3D();
export function orientationTo(depuis, vers){
  _dummy.position.copy(depuis);
  _dummy.up.set(0, 1, 0);
  _dummy.lookAt(vers);
  return _dummy.quaternion.clone();
}

export function setKeysCamera(cam, samples){
  // On REMPLACE la piste d'objet de cette caméra : accumuler deux préréglages donnerait des
  // clés entrelacées et un mouvement que personne n'a demandé.
  const ancienne = trackOf(cam, null);
  if(ancienne) anim.tracks.splice(anim.tracks.indexOf(ancienne), 1);
  const p = trackOf(cam, null, true);
  samples.forEach(function(e){
    p.keys.push({t:e.t, pos:e.pos.toArray(), quat:e.quat.toArray(), ech:cam.scale.toArray()});
  });
  p.keys.sort(function(a, b){ return a.t - b.t; });
  keySel = null;
  updateTimeline();
  applyAnimation(anim.t);
}

export const PRESETS_CAMERA = {
  orbite: {
    label: 'Orbite', help: 'Tourne autour du point regardé, en restant à la même hauteur.',
    fields: [['distance', 'Distance au centre (m)', 8], ['angle', 'Angle balayé (°)', 360]],
    compute: function(cam, o){
      const center = targetWatched(cam, o.distance);
      const radius = cam.position.clone().sub(center);
      const start = Math.atan2(radius.z, radius.x);
      const r = Math.hypot(radius.x, radius.z);
      const n = Math.max(2, Math.round(Math.abs(o.angle) / STEP_ANGLE_PRESET));
      const ech = [];
      for(let i = 0; i <= n; i++){
        const a = start + (o.angle * Math.PI / 180) * (i / n);
        const pos = new THREE.Vector3(center.x + Math.cos(a) * r, cam.position.y,
                                      center.z + Math.sin(a) * r);
        ech.push({t: anim.duration * (i / n), pos: pos, quat: orientationTo(pos, center)});
      }
      return ech;
    }
  },
  travelling: {
    label: 'Travelling', help: 'Avance ou recule en ligne droite, sans changer d\'orientation.',
    fields: [['distance', 'Distance parcourue (m), négatif pour reculer', 6]],
    compute: function(cam, o){
      const end = cam.position.clone().addScaledVector(beforeCamera(cam), o.distance);
      return [{t:0, pos:cam.position.clone(), quat:cam.quaternion.clone()},
              {t:anim.duration, pos:end, quat:cam.quaternion.clone()}];
    }
  },
  panoramique: {
    label: 'Panoramique', help: 'Pivote sur place, comme une caméra sur trépied.',
    fields: [['angle', 'Angle balayé (°)', 180]],
    compute: function(cam, o){
      const n = Math.max(2, Math.round(Math.abs(o.angle) / STEP_ANGLE_PRESET));
      const axe = new THREE.Vector3(0, 1, 0);
      const ech = [];
      for(let i = 0; i <= n; i++){
        const q = new THREE.Quaternion()
          .setFromAxisAngle(axe, (o.angle * Math.PI / 180) * (i / n))
          .multiply(cam.quaternion);
        ech.push({t: anim.duration * (i / n), pos: cam.position.clone(), quat: q});
      }
      return ech;
    }
  }
};

export function modalPresetsCamera(){
  const cam = selection;
  if(!cam || !cam.getComponent || !cam.getComponent('Camera')){
    setStatus('Sélectionnez une caméra pour lui apply un préréglage', 3000);
    return;
  }
  let html = '<p style="margin-bottom:10px;line-height:1.5">Les clés sont écrites dans la piste '
    + 'de <b>' + escapeHtml(cam.name) + '</b>, sur toute la durée de la timeline ('
    + anim.duration + ' s). Ce sont des clés ordinaires : retouchables une à une.</p>';
  Object.keys(PRESETS_CAMERA).forEach(function(k){
    const d = PRESETS_CAMERA[k];
    html += '<div class="sec">' + d.label + '</div>'
      + '<p style="margin:0 8px 6px;font-size:11px;line-height:1.4;color:var(--txt-dim,#9aa0a6)">'
      + d.help + '</p><table>'
      + d.fields.map(function(c){
          return '<tr><td>' + c[1] + '</td><td><input type="number" step="0.5" id="pc-' + k + '-'
            + c[0] + '" value="' + c[2] + '" style="width:100%"></td></tr>';
        }).join('')
      + '</table><div style="text-align:right;margin:0 8px 10px">'
      + '<button class="btn-modal accent" data-preset="' + k + '">Appliquer</button></div>';
  });
  openModal('Préréglages d\'animation de caméra', html);
  document.getElementById('modal-body').addEventListener('click', function(e){
    const b = e.target.closest('[data-preset]');
    if(!b) return;
    const k = b.dataset.preset, d = PRESETS_CAMERA[k];
    const o = {};
    d.fields.forEach(function(c){
      o[c[0]] = parseFloat(document.getElementById('pc-' + k + '-' + c[0]).value) || 0;
    });
    pushHistory();
    setKeysCamera(cam, d.compute(cam, o));
    closeModal();
    setStatus(d.label + ' appliqué à ' + cam.name + ' — '
      + trackOf(cam, null).keys.length + ' clés posées', 4000);
  });
}

document.getElementById('an-preset-cam').addEventListener('click', modalPresetsCamera);

// ---------- Afficher un clip importé dans la timeline ----------
//
// Un modèle rigué arrive avec ses clips, et jusqu'ici la timeline ne montrait que NOS pistes :
// les clés d'un « Walking » importé n'apparaissaient nulle part. On les affiche, en lecture
// seule, une ligne par os animé.
//
// EN LECTURE SEULE, et c'est une décision : ces clés appartiennent à l'ASSET, donc à tous les
// personnages qui s'en servent. Les rendre modifiables sur place ferait éditer le fichier
// source depuis la piste d'une instance — sans que rien ne le dise.
//
// Et la tête de lecture PILOTE le clip. Afficher des clés sans pouvoir se déplacer dedans
// serait une décoration ; c'est le déplacement qui permet de choisir l'instant où l'on veut
// poser sa propre clé.
// `folded` et `filtre` sont des états d'AFFICHAGE de la liste d'os, pas des données du clip :
// ils ne partent donc pas dans la scène, et ils se remettent à zéro quand on change de clip
// (un filtre oublié sur le clip précédent masquerait tout le nouveau, sans rien dire).
export const clipShown = {obj:null, clip:null, mixer:null, action:null, folded:false, filter:''};

// Au-delà de ce nombre, les clés d'une ligne sont échantillonnées à l'affichage. À 31 clés par
// seconde elles se touchent déjà : en dessiner deux mille ne montre rien de plus et alourdit
// chaque rafraîchissement de la timeline.
export const MAX_KEYS_SHOWN = 120;

export function boneAnimatedOfClip(clip){
  const byBone = new Map();
  clip.tracks.forEach(function(t){
    const name = t.name.split('.')[0];
    if(!byBone.has(name)) byBone.set(name, []);
    t.times.forEach(function(x){ byBone.get(name).push(x); });
  });
  const output = [];
  byBone.forEach(function(instants, name){
    const uniques = Array.from(new Set(instants)).sort(function(a, b){ return a - b; });
    output.push({name:name, instants:uniques});
  });
  return output;
}

// `caler` : recaler la durée de la timeline sur celle du clip. Vrai quand l'utilisateur
// demande ce clip explicitement, ou quand rien de sa main n'est encore posé.
export function showClipInTimeline(obj, clip, snap){
  stopClipShown();
  if(!obj || !clip) return;
  clipShown.obj = obj;
  clipShown.clip = clip;
  clipShown.mixer = new THREE.AnimationMixer(obj);
  clipShown.action = clipShown.mixer.clipAction(clip);
  clipShown.action.play();
  clipShown.action.paused = true;    // c'est la tête de lecture qui commande, pas le temps réel
  // La durée de la timeline se cale sur le clip : sur une règle de 5 s, un clip d'une seconde
  // se tasse dans le premier cinquième et ses clés deviennent illisibles. Mais seulement si
  // on y est autorisé — cette durée appartient au projet, et la changer sous les pieds de
  // quelqu'un qui compose son animation serait pire que des clés serrées.
  if(snap !== false){
    anim.duration = Math.max(0.1, +clip.duration.toFixed(3));
    document.getElementById('an-duration').value = anim.duration;
  }
  anim.t = Math.min(anim.t, anim.duration);
  applyAnimation(anim.t);
  updateTimeline();
  setStatus('Clip « ' + clip.name + ' » affiché : ' + boneAnimatedOfClip(clip).length
    + ' os animés, timeline calée sur ' + anim.duration + ' s', 5000);
}

// Appelé à chaque changement de sélection : un personnage sélectionné montre son animation,
// sans qu'on ait à la demander. C'est ce qu'on attend d'une timeline — voir ce que fait
// l'objet qu'on regarde.
//
// LA DURÉE N'EST RECALÉE QUE SI LA TIMELINE EST VIDE. Elle appartient au projet : la changer
// à chaque clic sur un personnage remanierait sous les pieds de l'utilisateur l'animation
// qu'il est en train de composer. Quand il n'a encore rien posé, il n'y a rien à déranger et
// caler rend les clés lisibles ; sinon on laisse sa règle tranquille, quitte à ce que le clip
// n'occupe qu'une partie de la piste.
export function clipAutoForSelection(obj){
  if(clipShown.obj === obj) return;              // déjà affiché : ne pas relancer le mixeur
  const avaitOfTracks = anim.tracks.length > 0;
  stopClipShown();
  if(!obj || ed(obj).clipMask){ updateTimeline(); return; }
  const clips = clipsOf(obj);
  // Un clip de durée nulle est un artefact d'export (une T-pose en porte un) : l'afficher
  // donnerait une ligne d'os sans une seule clé visible.
  const clip = clips.find(function(c){ return c.duration > 0.05; });
  if(!clip){ updateTimeline(); return; }
  showClipInTimeline(obj, clip, !avaitOfTracks);
}

export function stopClipShown(){
  if(clipShown.mixer) clipShown.mixer.stopAllAction();
  clipShown.obj = null; clipShown.clip = null;
  clipShown.mixer = null; clipShown.action = null;
  // Un filtre laissé en place masquerait tout le clip suivant, et un repli laissé en place le
  // montrerait empty : dans les deux cas l'utilisateur verrait une animation qui n'a « aucun os ».
  clipShown.folded = false; clipShown.filter = '';
}

// Amène le clip affiché à l'instant demandé. `setTime` puis `update(0)` : le mixeur applique
// alors la pose sans advance le temps de lui-même, ce qui est bien ce qu'on veut d'une tête de
// lecture qu'on déplace à la main.
export function updateClipShown(t){
  if(!clipShown.action) return;
  clipShown.action.time = Math.max(0, Math.min(clipShown.clip.duration, t));
  clipShown.mixer.update(0);
}

/** L'asset qui PORTE les marqueurs du clip affiché, et le nom du clip chez lui. */
export function sourceMarkersShown(){
  if(!clipShown.clip || typeof sourceOfClipPlays !== 'function') return null;
  const src = sourceOfClipPlays(clipShown.obj, clipShown.clip.name);
  if(!src) return null;
  const asset = assets.find(function(a){ return a.id === src.asset; });
  return asset ? {asset:asset, clip:src.clip} : null;
}

export function markersOfClipShown(){
  const src = sourceMarkersShown();
  return src ? markersOfClip(src.asset, src.clip) : [];
}

/**
 * Marqueurs du clip affiché, pendant la lecture dans l'éditeur.
 *
 * Appelé depuis la boucle de la vue et de là seulement : c'est le seul endroit qui distingue
 * « on lit » de « on a déplacé la tête de lecture ». Un marker déclenché au scrub ferait
 * crier toute la scène dès qu'on cherche une pose.
 */
export function triggerMarkersOfClipShown(tBefore, tAfter){
  if(!clipShown.clip || typeof triggerMarkers !== 'function') return 0;
  const list = markersOfClipShown();
  if(!list.length) return 0;
  return triggerMarkers(list, tBefore, tAfter, clipShown.clip.duration, anim.loop, true,
    function(name){
      // Même chemin d'émission que l'action « Émettre l'événement… » de js/events.js :
      // un marker n'invente aucun vocabulaire, il entre par la porte qui existe.
      (engineScripts.ecouteurs[name] || []).forEach(function(fn){
        try{ fn(); } catch(e){
          logConsole('error', 'marqueur « ' + name + ' » : ' + e.message, clipShown.obj);
        }
      });
    });
}


// EXPOSÉ EN GLOBALE, à dessein. Ces symboles sont appelés depuis des fichiers
// que les mêmes pages ne chargent pas toutes : un `import` y pointerait un
// fichier absent, et la page ne démarrerait pas. Ils gardent donc leur garde
// `typeof` côté appelant, et se déclarent ici.
globalThis._qA = _qA;
globalThis._vA = _vA;
globalThis.anim = anim;
globalThis.applyAnimation = applyAnimation;
globalThis.applyEasing = applyEasing;