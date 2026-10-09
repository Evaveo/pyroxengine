// ---------- L'échantillonnage des pistes d'animation à clés, en un seul endroit ----------
//
// PARTAGÉ éditeur / jeu publié, sans aucun import, et NON retirable d'un build : c'est ce qui
// permet à js/game-runtime.js de l'importer (règle 2, docs/ARCHITECTURE.md).
//
// Pourquoi ce fichier existe (revue du 2026-09-29, § 1.7). La lecture d'une piste — où en est-on,
// avec quelle courbe, et une piste ADDITIVE a-t-elle une base sous elle — existait en TROIS
// exemplaires : js/animation.js (éditeur), js/game-runtime.js (jeu publié), js/anim-asset.js
// (clips à clés). Ils avaient divergé sur le point qui compte : l'éditeur décidait qu'une piste
// additive est inerte OS PAR OS (le clip anime-t-il CET os ?), le jeu publié OBJET PAR OBJET (une
// animation tourne-t-elle sur l'objet ?). Une clé additive posée sur un os que le clip n'anime pas
// était donc inerte dans l'éditeur, et s'accumulait à chaque image dans le jeu : l'os dérivait
// chez le joueur, jamais chez l'auteur.
//
// Ni THREE ni DOM : les vecteurs et quaternions de travail sont PASSÉS par l'appelant, qui les
// possède déjà — un slerp demande three, ce fichier n'en dépend pas.

// La courbe est portée par la clé de DÉPART du segment.
// Valeurs sérialisées en français (`acc`, `dec`, `douce`, `palier`) : voir CLAUDE.md, enums.
export function applyEasing(easing, a){
  switch(easing){
    case 'acc':    return a * a;                    // accélère (ease-in)
    case 'dec':    return a * (2 - a);              // décélère (ease-out)
    case 'douce':  return a * a * (3 - 2 * a);      // douce (ease-in-out)
    case 'palier': return a >= 1 ? 1 : 0;           // palier (step)
    default:       return a;                        // linéaire
  }
}

/** Où en est une piste à l'instant `t` : `{avant, apres, alpha}`, alpha déjà passé à l'easing. */
export function segmentAt(keys, t){
  if(!keys || !keys.length) return null;
  let i = 0;
  while(i < keys.length && keys[i].t <= t) i++;
  const apres = keys[Math.min(i, keys.length - 1)];
  const avant = keys[Math.max(i - 1, 0)];
  let alpha = 0;
  if(avant !== apres && apres.t > avant.t) alpha = (t - avant.t) / (apres.t - avant.t);
  return {avant: avant, apres: apres, alpha: applyEasing(avant.easing, Math.max(0, Math.min(1, alpha)))};
}

/** La piste d'un clip three qui anime la cible nommée `name`, ou `null`. */
export function clipTrackFor(clip, name){
  if(!clip || !name) return null;
  const prefixe = name + '.';
  return (clip.tracks || []).find(function(tr){ return tr.name.indexOf(prefixe) === 0; }) || null;
}

/**
 * Une piste ADDITIVE a-t-elle une base sous elle ? Oui seulement si le clip en cours écrit la pose
 * de CETTE cible à chaque image — la question se pose PAR OS : un clip humanoïde anime 52 os sur
 * 65, et sur un os qu'il n'anime pas personne ne repose la base, donc l'écart s'accumulerait.
 */
export function additiveHasBase(clip, target){
  return !!(clip && target && clipTrackFor(clip, target.name));
}

/**
 * Pose l'échantillon d'une piste sur sa cible. `tmp` = {vA, vB, qA, qB} (Vector3 ×2, Quaternion ×2)
 * fournis par l'appelant. `additif` : compose l'écart sur la pose courante au lieu de la remplacer.
 */
export function applyTrackSample(target, seg, additif, tmp){
  const a = seg.avant, b = seg.apres, alpha = seg.alpha;
  tmp.vA.fromArray(a.pos); tmp.vB.fromArray(b.pos);
  tmp.qA.fromArray(a.quat); tmp.qB.fromArray(b.quat);
  if(additif){
    target.position.add(tmp.vA.lerp(tmp.vB, alpha));
    target.quaternion.multiply(tmp.qA.slerp(tmp.qB, alpha));
    tmp.vA.fromArray(a.ech); tmp.vB.fromArray(b.ech);
    target.scale.multiply(tmp.vA.lerp(tmp.vB, alpha));
  } else {
    target.position.lerpVectors(tmp.vA, tmp.vB, alpha);
    target.quaternion.copy(tmp.qA).slerp(tmp.qB, alpha);
    tmp.vA.fromArray(a.ech); tmp.vB.fromArray(b.ech);
    target.scale.lerpVectors(tmp.vA, tmp.vB, alpha);
  }
}
