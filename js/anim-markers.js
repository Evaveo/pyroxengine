// ---------- Marqueurs d'animation : « à cet instant du clip, émettre cet événement » ----------
//
// Un son de pas à l'image 12 de la marche, une hitbox qui s'ouvre au milieu d'un coup, une
// gerbe de particules quand le pied touche le sol. Unreal appelle ça des Anim Notifies.
//
// Ici un marker ne fait qu'UNE chose : émettre un événement nommé. Tout le reste existe déjà
// — js/events.js sait recevoir un événement (« À la réception d'un événement ») et sait
// jouer un son, émettre des particules, montrer, cacher, détruire, changer de scène. Ajouter
// un second vocabulaire d'actions ici aurait fait deux systèmes à apprendre au lieu d'un.
//
// Les marqueurs appartiennent au CLIP, donc à l'asset, pas à l'objet : un son de pas
// appartient à la marche, et doit se déclencher pour tous les personnages qui marchent. C'est
// aussi le modèle d'Unreal, où les notifies vivent dans l'Anim Sequence.

/** Marqueurs d'un clip d'asset, toujours triés dans le temps. Jamais null. */
export function markersOfClip(asset, nameClip){
  if(!asset || !asset.markers) return [];
  return asset.markers[nameClip] || [];
}

/**
 * D'où vient le clip que joue cet objet ? Pour un clip du modèle lui-même, de son propre asset.
 * Pour un clip reciblé, de l'asset SOURCE — sinon un son de pas posé sur la marche cesserait
 * d'exister dès qu'on pose cette marche sur un autre personnage, ce qui est précisément le
 * geste qu'on vient de rendre possible.
 */
export function sourceOfClipPlays(obj, nameClip){
  const refs = (typeof externalClipsOf === 'function') ? externalClipsOf(obj) : [];
  const ref = refs.find(function(r){ return r.localName === nameClip; });
  if(ref) return {asset:ref.assetId, clip:ref.sourceClip};
  const sien = obj && obj.userData && obj.userData.assetId;
  return sien ? {asset:sien, clip:nameClip} : null;
}

/**
 * Quels marqueurs ont été FRANCHIS en passant de `avant` à `apres` ?
 *
 * C'est ici que se joue toute la justesse du mécanisme, et les cas limites y sont plus nombreux
 * qu'il n'y paraît :
 *
 *  - l'intervalle est OUVERT à gauche et FERMÉ à droite. Un marker pile sur `avant` vient
 *    d'être joué à l'image précédente ; le rejouer donnerait deux sons de pas pour un pas ;
 *  - une boucle fait REVENIR le temps en arrière. `apres < avant` ne veut pas dire qu'on a
 *    reculé, mais qu'on a repassé la fin : il faut alors relever la fin du clip PUIS son début ;
 *  - un marker à t=0 ne serait jamais atteint par un intervalle ouvert à gauche si on ne
 *    traitait pas le début de boucle comme un franchissement — or c'est un instant très
 *    naturel où poser un marker.
 *
 * Fonction PURE, et c'est délibéré : c'est la seule partie qu'on peut mettre à l'épreuve sans
 * moteur de rendu, et c'est la seule où une erreur est silencieuse.
 */
export function markersCrossed(markers, avant, apres, duration, loop){
  const list = markers || [];
  if(!list.length) return [];
  const dans = function(a, b){
    return list.filter(function(m){ return m.t > a && m.t <= b; });
  };
  if(apres >= avant) return dans(avant, apres);
  // Le temps a reculé. Sans bouclage c'est un saut arrière volontaire (on a ramené la tête de
  // lecture au début) : rien n'a été « traversé », donc rien ne se déclenche.
  if(!loop) return [];
  // Avec bouclage : la fin du clip, puis le début — dans cet ordre, qui est celui du temps.
  // Le début est fermé à GAUCHE ici (`>= 0`), pour que t=0 soit atteignable.
  return dans(avant, duration).concat(list.filter(function(m){ return m.t >= 0 && m.t <= apres; }));
}

/**
 * Un marker ne doit PAS se déclencher quand on déplace la tête de lecture à la main.
 *
 * Faire crier tous les sons de pas parce qu'on cherche une pose rendrait la timeline
 * inutilisable, et c'est aussi ce que fait Unreal : un scrub ne joue pas les notifies. La règle
 * est donc « on lit » et pas « le temps a changé » — d'où ce paramètre explicite plutôt qu'une
 * comparaison de temps qui aurait confondu les deux.
 */
export function triggerMarkers(markers, avant, apres, duration, loop, inPlayback, emit){
  if(!inPlayback || typeof emit !== 'function') return 0;
  const crossed = markersCrossed(markers, avant, apres, duration, loop);
  crossed.forEach(function(m){ if(m.name) emit(m.name, m); });
  return crossed.length;
}

/** Ajoute un marqueur, en gardant la liste triée. Renvoie la liste de l'asset. */
export function setMarker(asset, nameClip, t, name){
  if(!asset) return [];
  if(!asset.markers) asset.markers = {};
  const list = asset.markers[nameClip] = (asset.markers[nameClip] || []);
  list.push({t:t, name:name || 'marker'});
  list.sort(function(a, b){ return a.t - b.t; });
  return list;
}

export function removeMarker(asset, nameClip, index){
  const list = (asset && asset.markers && asset.markers[nameClip]) || [];
  if(index >= 0 && index < list.length) list.splice(index, 1);
  return list;
}


// EXPOSÉ EN GLOBALE, à dessein. Ces symboles sont appelés depuis des fichiers
// que les mêmes pages ne chargent pas toutes : un `import` y pointerait un
// fichier absent, et la page ne démarrerait pas. Ils gardent donc leur garde
// `typeof` côté appelant, et se déclarent ici.
globalThis.markersOfClip = markersOfClip;
globalThis.removeMarker = removeMarker;
globalThis.setMarker = setMarker;
globalThis.sourceOfClipPlays = sourceOfClipPlays;
globalThis.triggerMarkers = triggerMarkers;