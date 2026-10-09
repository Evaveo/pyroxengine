// ---------- L'arbre de layout du dock : la couche PURE ----------
//
// Séparé de dock.js parce que TOUT ce qui peut casser un dock est ici — un onglet fantôme laissé
// par un plugin désinstallé, un panneau neuf qu'un layout enregistré ignore, une clé corrompue —
// et que rien de tout cela n'a besoin d'un DOM pour être mesuré. Le harnais de test n'a pas de
// navigateur : ce qui n'est pas dans ce fichier n'est vérifiable qu'à la main.
//
// Nœuds internes = `split` (direction + tailles RELATIVES, jamais des pixels : un layout
// enregistré sur un écran large doit rester utilisable sur un portable). Feuilles = `zone`
// (une pile d'onglets et celui qui est actif).

export const LAYOUT_VERSION = 1;

// La disposition par défaut REPRODUIT la grille CSS d'avant le dock (css/editor.css:18-27) :
//
//   grid-template-areas: "hier sg view sd insp"
//                        "sb   sb sb   sb insp"
//                        "project project project project insp"
//
// Deux faits que cette grille dit et qu'un schéma « une colonne, une rangée » perdrait :
// l'inspecteur descend jusqu'en BAS (il couvre les trois rangées), et le panneau bas s'arrête
// AVANT la colonne de droite. D'où la forme ci-dessous : la colonne de droite est un enfant
// direct de la racine, et le panneau bas vit dans la colonne de gauche.
//
// Les proportions valent les 240 / 280 / 210 pixels d'origine sur une fenêtre de 1440×900.
export const LAYOUT_DEFAULT = {
  version: LAYOUT_VERSION,
  root: { split: 'row', sizes: [0.82, 0.18], children: [
    { split: 'col', sizes: [0.74, 0.26], children: [
      { split: 'row', sizes: [0.23, 0.77], children: [
        { zone: 'left',   tabs: ['hierarchy'], active: 'hierarchy' },
        { zone: 'center', tabs: ['viewport'],  active: 'viewport' } ] },
      { zone: 'bottom', tabs: ['project'], active: 'project' } ] },
    { zone: 'right', tabs: ['inspector'], active: 'inspector' } ] },
  floating: [],
  popped: []
};

/** Copie profonde d'un arbre. Les mutations rendent un arbre NEUF, jamais celui d'entrée. */
export function cloneLayout(layout){
  return JSON.parse(JSON.stringify(layout));
}

/** Toutes les feuilles (zones) d'un nœud, dans l'ordre de l'arbre. */
export function zonesOf(node){
  if(!node) return [];
  if(node.zone) return [node];
  return (node.children || []).reduce(function(acc, c){ return acc.concat(zonesOf(c)); }, []);
}

/** Tous les panneaux du layout — dans les zones ET en flottant. */
export function panelsOf(layout){
  const out = [];
  zonesOf(layout.root).forEach(function(z){
    (z.tabs || []).forEach(function(id){ if(out.indexOf(id) === -1) out.push(id); });
  });
  (layout.floating || []).forEach(function(f){
    if(f && f.panel && out.indexOf(f.panel) === -1) out.push(f.panel);
  });
  (layout.popped || []).forEach(function(f){
    if(f && f.panel && out.indexOf(f.panel) === -1) out.push(f.panel);
  });
  return out;
}

/**
 * Nettoie un nœud : retire les onglets inconnus, supprime les zones vides, aplatit les splits
 * à un seul enfant, renormalise les tailles. Rend `null` quand il ne reste rien.
 *
 * TOUTE mutation de l'arbre repasse par ici (voir `normalizeLayout`) : une seule porte de
 * sortie, donc un seul endroit où l'arbre peut redevenir valide.
 */
export function cleanNode(node, knownIds){
  if(!node) return null;
  if(node.zone){
    const tabs = (node.tabs || []).filter(function(id){ return knownIds.indexOf(id) !== -1; });
    if(!tabs.length) return null;
    // L'actif pointait peut-être sur un onglet qui vient de disparaître : on le reprend sur
    // le premier plutôt que de laisser une zone qui n'affiche rien.
    const active = (tabs.indexOf(node.active) !== -1) ? node.active : tabs[0];
    return {zone: node.zone, tabs: tabs, active: active};
  }
  if(!node.split || !Array.isArray(node.children)) return null;
  const kept = [], sizes = [];
  node.children.forEach(function(child, i){
    const c = cleanNode(child, knownIds);
    if(!c) return;
    kept.push(c);
    sizes.push((node.sizes && node.sizes[i]) || 0);
  });
  if(!kept.length) return null;
  // Un split d'un seul enfant n'a pas de sens : il remonte à sa place.
  if(kept.length === 1) return kept[0];
  const total = sizes.reduce(function(a, b){ return a + b; }, 0);
  const norm = total > 0 ? sizes.map(function(s){ return s / total; })
                         : kept.map(function(){ return 1 / kept.length; });
  return {split: node.split === 'col' ? 'col' : 'row', sizes: norm, children: kept};
}

/** La première zone portant ce nom, ou `null`. */
export function findZone(node, name){
  return zonesOf(node).find(function(z){ return z.zone === name; }) || null;
}

/**
 * Un layout brut → un layout utilisable.
 *
 * `knownIds` : les panneaux réellement déclarés. `defaultZones` : `{id: 'right'}` pour placer un
 * panneau connu qui manque. `descriptors` : `{id: {closable, floatable}}`.
 */
export function normalizeLayout(layout, knownIds, defaultZones, descriptors){
  const known = knownIds || [];
  const zones = defaultZones || {};
  const descr = descriptors || {};
  const src = (layout && layout.root) ? cloneLayout(layout) : cloneLayout(LAYOUT_DEFAULT);
  let root = cleanNode(src.root, known);
  if(!root) root = cleanNode(cloneLayout(LAYOUT_DEFAULT).root, known);
  const floating = (src.floating || []).filter(function(f){
    return f && known.indexOf(f.panel) !== -1;
  });
  const popped = (src.popped || []).filter(function(f){
    return f && known.indexOf(f.panel) !== -1;
  });
  const out = {version: LAYOUT_VERSION, root: root, floating: floating, popped: popped};

  // Un panneau déclaré mais absent du layout : il rejoint sa zone par défaut, sinon il flotte.
  // Sans cette règle, un panneau ajouté par une nouvelle version resterait invisible, et il n'y
  // aurait aucun moyen de deviner qu'il existe.
  const present = panelsOf(out);
  known.forEach(function(id){
    if(present.indexOf(id) !== -1) return;
    // A LA DEMANDE, TESTÉ EN PREMIER : un panneau peut déclarer À LA FOIS une zone par défaut
    // (où il ira QUAND on l'ouvre) et `onDemand` (il ne s'auto-injecte pas tout seul). Tester
    // `zones[id]` en premier rendait `onDemand` mort pour ces panneaux-là — la zone par défaut
    // gagnait toujours et les réinjectait à chaque démarrage.
    if((descr[id] || {}).onDemand) return;
    if(zones[id]){
      // Sa zone par défaut peut avoir DISPARU — elle s'est vidée quand on a déplacé son
      // dernier onglet ailleurs. Le panneau rejoint alors la première zone venue : le renvoyer
      // en flottant ferait sortir de la coquille un panneau qu'on vient seulement de rouvrir.
      const zone = findZone(out.root, zones[id]) || zonesOf(out.root)[0];
      if(zone){ zone.tabs.push(id); return; }
    }
    // Aucune zone par défaut déclarée : le panneau flotte. C'est le cas d'un panneau exotique
    // (un plugin) dont personne ne sait où il devrait aller.
    out.floating.push({panel: id, x: 120, y: 80, w: 420, h: 320});
  });

  // Un panneau qu'on ne peut pas fermer ne peut pas non plus être absent : sinon on se retrouve
  // sans vue 3D et sans moyen de la récupérer.
  known.forEach(function(id){
    if((descr[id] || {}).closable === false && panelsOf(out).indexOf(id) === -1){
      const zone = findZone(out.root, zones[id] || 'center') || zonesOf(out.root)[0];
      if(zone) zone.tabs.push(id);
    }
  });
  return out;
}

/** Chaîne JSON stable : mêmes clés, même ordre — c'est ce qui rend l'aller-retour mesurable. */
export function serializeLayout(layout){
  function node(n){
    if(n.zone) return {zone: n.zone, tabs: n.tabs.slice(), active: n.active};
    return {split: n.split, sizes: n.sizes.slice(), children: n.children.map(node)};
  }
  return JSON.stringify({
    version: LAYOUT_VERSION,
    root: node(layout.root),
    floating: (layout.floating || []).map(function(f){
      return {panel: f.panel, x: f.x, y: f.y, w: f.w, h: f.h};
    }),
    popped: (layout.popped || []).map(function(f){
      return {panel: f.panel, x: f.x, y: f.y, w: f.w, h: f.h};
    })
  });
}

/**
 * Relit un layout enregistré. Rend `{layout, fallback}` — et ne LÈVE JAMAIS : un JSON corrompu
 * ou d'une version inconnue doit ouvrir l'éditeur sur la disposition par défaut, pas l'empêcher
 * de s'ouvrir. `fallback` dit à l'appelant qu'il doit le signaler dans la console de l'éditeur :
 * un retour au défaut silencieux fait chercher ce qu'on a perdu.
 */
export function parseLayout(raw, knownIds, defaultZones, descriptors){
  let parsed = null;
  try { parsed = raw ? JSON.parse(raw) : null; } catch(e){ parsed = null; }
  const ok = !!(parsed && parsed.version === LAYOUT_VERSION && parsed.root);
  const base = ok ? parsed : LAYOUT_DEFAULT;
  // Un panneau POPPE ne rouvre JAMAIS sa fenetre OS tout seul au chargement — le navigateur
  // bloquerait une rafale de popups sans geste utilisateur. Il retombe flottant EN PAGE,
  // avec la meme geometrie retenue : seul docked/floating est un etat stable entre sessions.
  const migre = (ok && (base.popped || []).length)
    ? Object.assign({}, base, {floating: (base.floating || []).concat(base.popped), popped: []})
    : base;
  return {layout: normalizeLayout(migre, knownIds, defaultZones, descriptors),
          fallback: !ok};
}

// ---------- Où tombe le curseur ----------
//
// Une RÈGLE GÉOMÉTRIQUE, donc une fonction — pas un `if` dans un `pointermove`. Écrite dans le
// gestionnaire, elle ne se vérifierait qu'à la souris, et ses bords (une zone très plate, un
// curseur sur la diagonale d'un coin, un rectangle de largeur nulle pendant une animation) ne se
// vérifieraient pas du tout.

// La bande de bord vaut un QUART de la dimension concernée.
export const DROP_EDGE = 0.25;

/**
 * `rect` : le rectangle de la zone survolée, en coordonnées de page. `x`/`y` : le curseur.
 * Rend `{where, preview}` — `where` vaut 'center', 'left', 'right', 'top', 'bottom' ou
 * 'outside', et `preview` est le rectangle translucide à dessiner (`null` pour 'outside').
 */
export function dropTarget(rect, x, y){
  const w = rect.width || 0, h = rect.height || 0;
  if(x < rect.x || x > rect.x + w || y < rect.y || y > rect.y + h){
    return {where: 'outside', preview: null};
  }
  if(w <= 0 || h <= 0) return {where: 'center', preview: {x: rect.x, y: rect.y, width: w, height: h}};

  // Les distances aux quatre bords, EN PROPORTION de la dimension concernée, et jamais en
  // pixels : sur une zone très plate, 20 px du haut est un bord et 20 px du gauche n'en est pas
  // un. Comparer des pixels ferait scinder dans la mauvaise direction une fois sur deux.
  const parts = [
    {where: 'left',   d: (x - rect.x) / w},
    {where: 'right',  d: (rect.x + w - x) / w},
    {where: 'top',    d: (y - rect.y) / h},
    {where: 'bottom', d: (rect.y + h - y) / h}
  ];
  let plusProche = parts[0];
  parts.forEach(function(p){ if(p.d < plusProche.d) plusProche = p; });
  if(plusProche.d > DROP_EDGE){
    return {where: 'center', preview: {x: rect.x, y: rect.y, width: w, height: h}};
  }
  const moities = {
    left:   {x: rect.x,           y: rect.y,           width: w / 2, height: h},
    right:  {x: rect.x + w / 2,   y: rect.y,           width: w / 2, height: h},
    top:    {x: rect.x,           y: rect.y,           width: w,     height: h / 2},
    bottom: {x: rect.x,           y: rect.y + h / 2,   width: w,     height: h / 2}
  };
  return {where: plusProche.where, preview: moities[plusProche.where]};
}

// ---------- Déplacer un onglet ----------
//
// TROIS RÈGLES, et elles ne sont pas négociables :
//
//  1. IMMUABLE. `applyDrop` rend un arbre NEUF et ne touche jamais celui qu'on lui donne.
//     C'est ce qui permet d'annuler un dépôt (`Échap`) en jetant simplement le résultat, et de
//     comparer l'avant et l'après.
//  2. UN DÉPÔT REFUSÉ REND L'ARBRE D'ENTRÉE, inchangé — jamais un arbre à moitié muté.
//  3. TOUTE mutation repasse par `normalizeLayout`. Une seule porte de sortie, donc un seul
//     endroit où l'arbre redevient valide : zones vides supprimées, splits à un enfant aplatis,
//     tailles renormalisées, actif réparé.

/** Le nœud parent d'une zone, et l'index de celle-ci — `null` pour la racine. */
export function parentOfZone(root, zoneName){
  let trouve = null;
  (function marche(n){
    if(!n || !n.split) return;
    n.children.forEach(function(c, i){
      if(c.zone === zoneName) trouve = {parent: n, index: i};
      else marche(c);
    });
  })(root);
  return trouve;
}

/** Retire `panelId` de toutes les zones et des flottants. Mute l'arbre DONNÉ (déjà cloné). */
export function removePanel(layout, panelId){
  zonesOf(layout.root).forEach(function(z){
    z.tabs = z.tabs.filter(function(id){ return id !== panelId; });
    if(z.active === panelId) z.active = z.tabs[0] || null;
  });
  layout.floating = (layout.floating || []).filter(function(f){ return f.panel !== panelId; });
  layout.popped = (layout.popped || []).filter(function(f){ return f.panel !== panelId; });
}

/**
 * Un dépôt → un nouvel arbre.
 *
 * `target` : `{zone, where, index}` rendu par `dropTarget` (plus `where:'tab'` avec un `index`
 * pour un réordonnancement dans une pile, et `where:'outside'` avec `x`/`y` pour un
 * détachement). `descriptors` : `{id: {closable, floatable}}`. `knownIds` : les panneaux
 * déclarés, pour la normalisation finale.
 */
export function applyDrop(layout, panelId, target, descriptors, knownIds){
  const descr = (descriptors || {})[panelId] || {};
  const known = knownIds || panelsOf(layout);
  const zones = {};
  const next = cloneLayout(layout);

  if(target.where === 'outside'){
    // Un panneau qu'on ne peut pas fermer ne peut pas non plus flotter : détacher la vue 3D
    // reviendrait à pouvoir la perdre derrière la coquille.
    if(descr.floatable === false || descr.closable === false) return layout;
    removePanel(next, panelId);
    next.floating.push({panel: panelId, x: target.x || 120, y: target.y || 80,
                        w: target.w || 420, h: target.h || 320});
    return normalizeLayout(next, known, zones, descriptors);
  }

  const targetZone = zonesOf(next.root).find(function(z){ return z.zone === target.zone; });
  if(!targetZone) return layout;

  // Déposer un onglet au centre de SA propre zone ne veut rien dire : on rend l'arbre tel quel
  // plutôt qu'un arbre identique reconstruit — c'est ce qui rend « rien n'a bougé » mesurable.
  const dejaSeul = targetZone.tabs.length === 1 && targetZone.tabs[0] === panelId;
  if(target.where === 'center' && dejaSeul) return layout;

  if(target.where === 'center' || target.where === 'tab'){
    const memeZone = targetZone.tabs.indexOf(panelId) !== -1;
    removePanel(next, panelId);
    const z = zonesOf(next.root).find(function(x){ return x.zone === target.zone; }) || targetZone;
    if(target.where === 'tab' && typeof target.index === 'number'){
      z.tabs.splice(Math.max(0, Math.min(z.tabs.length, target.index)), 0, panelId);
    } else {
      z.tabs.push(panelId);
    }
    // Un onglet qu'on vient de poser est celui qu'on regarde — sauf un simple réordonnancement,
    // qui ne change pas ce qu'on regardait.
    if(!(target.where === 'tab' && memeZone)) z.active = panelId;
    return normalizeLayout(next, known, zones, descriptors);
  }

  // Un bord : la zone visée se scinde en deux, et la nouvelle moitié reçoit l'onglet.
  const vertical = (target.where === 'top' || target.where === 'bottom');
  const avant = (target.where === 'top' || target.where === 'left');
  removePanel(next, panelId);
  const z = zonesOf(next.root).find(function(x){ return x.zone === target.zone; });
  if(!z) return layout;

  const neuve = {zone: target.zone + '-' + panelId, tabs: [panelId], active: panelId};
  const reste = {zone: z.zone, tabs: z.tabs.slice(), active: z.active};
  const split = {split: vertical ? 'col' : 'row', sizes: [0.5, 0.5],
                 children: avant ? [neuve, reste] : [reste, neuve]};

  const p = parentOfZone(next.root, target.zone);
  if(p) p.parent.children[p.index] = split;
  else next.root = split;
  return normalizeLayout(next, known, zones, descriptors);
}

/**
 * Un panneau part en fenetre OS separee. Pendant de `applyDrop(..., {where:'outside'})`
 * (qui pope en fenetre FLOTTANTE EN PAGE) — deux logements distincts, donc deux portes de
 * sortie distinctes, mais la meme regle : `poppable:false` ou `closable:false` refuse.
 */
export function popOutPanel(layout, panelId, geometry, descriptors, knownIds, defaultZones){
  const descr = (descriptors || {})[panelId] || {};
  const known = knownIds || panelsOf(layout);
  if(descr.poppable === false || descr.closable === false) return layout;
  const next = cloneLayout(layout);
  removePanel(next, panelId);
  const g = geometry || {};
  next.popped.push({panel: panelId, x: g.x || 120, y: g.y || 80, w: g.w || 640, h: g.h || 420});
  return normalizeLayout(next, known, defaultZones || {}, descriptors);
}

