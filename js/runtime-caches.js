// moteur/js/runtime-caches.js
//
// CACHES DE LA BOUCLE D'IMAGE DU JEU PUBLIÉ (js/game-runtime.js). Chacun remplace un travail
// refait à chaque image alors que son résultat ne change presque jamais : un balayage linéaire
// de la scène pour `api.find`, un `scene.traverse` complet pour trouver les lumières, un
// recollage de CSS passé à la regex pour chaque document d'interface.
//
// Module PUR (aucune dépendance à three.js ni au DOM) : il se teste tel quel sous node
// (test/runtime-caches.test.mjs), et l'éditeur peut le reprendre sans rien changer.

/**
 * Index nom → nœud, MÊME SÉMANTIQUE que `list().find(o => o.name === name)` : le PREMIER de la
 * liste qui porte ce nom.
 *   - `invalidate()` est appelé quand la liste change (ajout, retrait, changement de scène) ;
 *   - un renommage n'est pas intercepté (`o.name = …` est une simple écriture) : une entrée dont
 *     le nom ne correspond plus est rejetée, et un nom absent de l'index retombe sur le
 *     balayage d'origine — l'index est alors refait.
 * Seul cas non couvert : deux nœuds de même nom dont le plus ancien est renommé VERS ce nom
 * après coup (l'index rend encore l'autre jusqu'au prochain ajout/retrait).
 */
export function createNameIndex(list){
  let dirty = true;
  const byName = new Map();
  function rebuild(){
    byName.clear();
    const objs = list();
    for(let k = 0; k < objs.length; k++){
      const o = objs[k];
      if(!byName.has(o.name)) byName.set(o.name, o);
    }
    dirty = false;
  }
  return {
    invalidate: function(){ dirty = true; },
    find: function(name){
      if(dirty) rebuild();
      const hit = byName.get(name);
      if(hit && hit.name === name) return hit;
      const found = list().find(function(x){ return x.name === name; }) || null;
      if(found || hit) dirty = true;   // un renommage a eu lieu : l'index est périmé
      return found;
    }
  };
}

/**
 * Lumières d'une scène, triées en directionnelles et locales (ponctuelles/spots). La liste est
 * refaite quand la scène change d'identité, après `invalidate()`, ou — si `refreshEvery` est
 * donné — toutes les `refreshEvery` lectures (l'éditeur, qui ajoute des objets par trop de
 * chemins pour les intercepter tous).
 */
export function createLightCache(refreshEvery){
  const c = {scene: null, dirty: true, reads: 0, directional: [], locals: []};
  return {
    invalidate: function(){ c.dirty = true; },
    get: function(scene){
      if(refreshEvery && ++c.reads >= refreshEvery){ c.reads = 0; c.dirty = true; }
      if(c.dirty || c.scene !== scene){
        c.scene = scene; c.dirty = false;
        c.directional.length = 0; c.locals.length = 0;
        scene.traverse(function(l){
          if(l.isPointLight || l.isSpotLight) c.locals.push(l);
          else if(l.isDirectionalLight) c.directional.push(l);
        });
      }
      return c;
    }
  };
}

/**
 * Résolution d'un document d'interface en {html, css}, MÉMOÏSÉE par `uiDoc`. Le résultat est
 * rendu tel quel (même objet) tant que l'asset du document, son HTML, la liste des feuilles et
 * le CSS de chacune n'ont pas changé — vérifié sans allocation.
 */
export function createUIDocResolver(assets, resolveCss){
  const memo = new WeakMap();
  return function(node, uiDoc){
    const byId = assets();
    const doc = uiDoc.documentUIId ? byId[uiDoc.documentUIId] : null;
    if(!doc) return null;
    const ids = uiDoc.sheetStyleIds || [];
    const m = memo.get(uiDoc);
    if(m && m.doc === doc && m.html === doc.html && m.ids.length === ids.length){
      let same = true;
      for(let k = 0; k < ids.length && same; k++){
        const a = byId[ids[k]];
        same = m.ids[k] === ids[k] && m.css[k] === (a ? a.css : '');
      }
      if(same) return m.result;
    }
    const css = ids.map(function(id){ const a = byId[id]; return a ? a.css : ''; });
    const result = {html: doc.html, css: resolveCss(css.join('\n'))};
    memo.set(uiDoc, {doc: doc, html: doc.html, ids: ids.slice(), css: css, result: result});
    return result;
  };
}

/**
 * Le monde physique a-t-il quelque chose à simuler ? Un monde fait SEULEMENT de corps statiques
 * n'a ni mouvement ni contact (deux statiques ne se testent pas). Un seul corps dynamique ou
 * cinématique suffit à répondre oui — les déclencheurs entre cinématiques ont besoin du pas.
 */
export function worldHasMovingBody(world, staticType){
  const bodies = (world && world.bodies) || [];
  for(let k = 0; k < bodies.length; k++){ if(bodies[k].type !== staticType) return true; }
  return false;
}

/**
 * Cible d'un Animator (le nœud qui porte les clips), MÊME RÉSULTAT que le parcours complet du
 * sous-arbre refait à chaque image : `obj.traverse` du nom voulu, ou du premier descendant à clips.
 * Le résultat trouvé est gardé par objet et simplement REVALIDÉ (nom inchangé, toujours
 * descendant de l'objet, porte encore des clips) : quelques remontées de parents au lieu d'un
 * parcours. Une recherche infructueuse n'est pas gardée — un enfant ajouté plus tard est vu.
 * Seul cas non couvert, comme pour l'index de noms : un SECOND nœud qualifiant ajouté avant le
 * premier dans l'ordre de parcours (le premier reste rendu tant qu'il qualifie).
 */
export function createAnimatorTargetCache(clipsOf){
  const cache = new WeakMap();
  function isDescendant(o, root){
    for(let p = o; p; p = p.parent) if(p === root) return true;
    return false;
  }
  return function resolve(obj, wantedName){
    // L'objet lui-même d'abord, comme le parcours d'origine : il a pu recevoir ses clips depuis.
    if(!wantedName && clipsOf(obj).length) return obj;
    const hit = cache.get(obj);
    if(hit && hit.name === wantedName && isDescendant(hit.found, obj)
       && (wantedName ? hit.found.name === wantedName : (hit.found !== obj && clipsOf(hit.found).length))){
      return hit.found;
    }
    let found = null;
    if(wantedName){
      obj.traverse(function(o){ if(!found && o.name === wantedName) found = o; });
    } else {
      obj.traverse(function(o){ if(!found && o !== obj && clipsOf(o).length) found = o; });
    }
    if(found) cache.set(obj, {name: wantedName, found: found});
    else cache.delete(obj);
    return found || (wantedName ? null : obj);
  };
}
