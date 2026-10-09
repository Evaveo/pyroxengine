// ---------- Graphe de machine à états : la géométrie ----------
//
// Séparé du rendu à dessein. Placer les états, tracer les links et savoir ce qu'on a sous le
// curseur sont des calculs — donc éprouvables hors navigateur, alors que le DOM ne l'est pas.
// Une flèche qui part du bad edge ou un clic qui attrape la mauvaise boîte ne lève aucune
// error : ça se voit comme « l'éditeur est bizarre », et on cherche longtemps.

export const GRAPH_STATE_L = 150;      // largeur d'une boîte d'état
export const GRAPH_STATE_H = 44;
export const GRAPH_MARGIN = 40;

/**
 * Donne une position aux états qui n'en ont pas, sans toucher à ceux qui en ont.
 *
 * Une machine écrite à la main — ou produite par le lot A — n'a aucune coordonnée. Les empiler
 * toutes en (0,0) donnerait un graphe illisible que l'utilisateur devrait démêler à la souris
 * avant de comprendre quoi que ce soit. On les range donc en colonnes, dans l'ordre déclaré.
 */
export function disposeStates(machine, widthDispo){
  const states = (machine && machine.states) || [];
  const byLine = Math.max(1, Math.floor(((widthDispo || 900) - GRAPH_MARGIN)
    / (GRAPH_STATE_L + GRAPH_MARGIN)));
  const places = states.filter(function(e){
    return e && Number.isFinite(e.x) && Number.isFinite(e.y);
  });
  const cellFree = function(x, y){
    // Un état neuf ne doit JAMAIS se poser sur un état déjà placé. Compter seulement les états
    // sans position remettait le suivant sur la première case de la grille — déjà occupée dès
    // qu'on avait rangé son graphe. On ajoutait un état, et il apparaissait caché sous un
    // autre : invisible, mais bel et bien là, et attrapé au premier clic à sa place.
    return !places.some(function(p){
      return Math.abs((p.x || 0) - x) < GRAPH_STATE_L && Math.abs((p.y || 0) - y) < GRAPH_STATE_H;
    });
  };
  let slot = 0;
  states.forEach(function(e){
    if(!e) return;
    // Une position DÉJÀ posée ne bouge jamais : l'utilisateur a rangé son graphe, et un
    // rangement automatique qui repasse derrière lui serait insupportable.
    if(Number.isFinite(e.x) && Number.isFinite(e.y)) return;
    let x, y;
    do {
      x = GRAPH_MARGIN + (slot % byLine) * (GRAPH_STATE_L + GRAPH_MARGIN);
      y = GRAPH_MARGIN + Math.floor(slot / byLine) * (GRAPH_STATE_H + GRAPH_MARGIN + 20);
      slot++;
    } while(!cellFree(x, y));
    // (Un `places.push(e)` vivait ici, pour que deux états neufs ne se posent pas l'un sur
    // l'autre. Il ne gardait rien : `slot` n'avance que dans un sens, et deux créneaux
    // distincts de la grille sont par construction plus éloignés que la taille d'une boîte.
    // La mutation qui le supprimait passait tous les tests.)
    e.x = x; e.y = y;
  });
  return states;
}

/** Le centre d'une boîte d'état. */
export function centerState(e){
  return {x: (e.x || 0) + GRAPH_STATE_L / 2, y: (e.y || 0) + GRAPH_STATE_H / 2};
}

/**
 * Le point où un link touche le bord d'une boîte, en visant `vers`.
 *
 * Partir du centre donnerait une flèche qui commence SOUS la boîte, invisible, et une pointe
 * enfouie dans la boîte d'arrivée. On sort donc par le bord, sur la droite qui joint les deux
 * centres — c'est ce qui rend le sens du link lisible sans le déduire.
 */
export function pointOnEdge(e, vers){
  const c = centerState(e);
  const dx = vers.x - c.x, dy = vers.y - c.y;
  if(dx === 0 && dy === 0) return c;
  const halfL = GRAPH_STATE_L / 2, halfH = GRAPH_STATE_H / 2;
  // Quel edge la droite coupe-t-elle en premier ? Celui dont le rapport est le plus contraignant.
  const tX = dx !== 0 ? halfL / Math.abs(dx) : Infinity;
  const tY = dy !== 0 ? halfH / Math.abs(dy) : Infinity;
  const t = Math.min(tX, tY);
  return {x: c.x + dx * t, y: c.y + dy * t};
}

/**
 * Le rectangle d'un état, en coordonnées absolues (mêmes unités que `e.x`/`e.y`).
 */
export function rectState(e){
  return {x0: e.x || 0, y0: e.y || 0, x1: (e.x || 0) + GRAPH_STATE_L, y1: (e.y || 0) + GRAPH_STATE_H};
}

/**
 * Le segment `[a,b]` traverse-t-il le rectangle `r` ? Test simple par échantillonnage du
 * segment (pas une intersection segment/AABB exacte à la Cohen-Sutherland — inutile ici, la
 * seule décision qui en dépend est « pousser le contrôle plus loin ou non », une approximation
 * suffit et reste lisible).
 */
export function segmentTraverseRect(a, b, r){
  const PAS = 12;
  for(let i = 0; i <= PAS; i++){
    const t = i / PAS;
    const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
    if(x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) return true;
  }
  return false;
}

/**
 * Le tracé d'une transition entre deux états, décalé pour ne pas se superposer aux autres, ET
 * contourné si le segment direct traverse un état TIERS (ni source ni cible).
 *
 * `rang` : combien de links existent déjà entre CE couple d'états. Deux transitions A→B et
 * A→B (conditions différentes) se recouvriraient parfaitement, et le second serait invisible ;
 * pire, une transition A→B et son retour B→A se confondraient en un seul trait, ce qui ferait
 * croire à un aller simple.
 *
 * `etatsTiers` : les états de la machine autres que `ofState`/`toState` — passés par
 * l'appelant (animator-graph.js connaît `m.states`, cette fonction reste pure et ne les cherche
 * pas elle-même). Absent ou vide : comportement inchangé (rétro-compatible avec tout appelant
 * qui ne le fournit pas encore).
 */
export function traceLink(ofState, toState, rank, etatsTiers){
  const cd = centerState(ofState), cv = centerState(toState);
  const a = pointOnEdge(ofState, cv);
  const b = pointOnEdge(toState, cd);
  // Décalage PERPENDICULAIRE au link : le sens du décalage suit celui du link, donc A→B et
  // B→A s'écartent chacun de leur côté au lieu de se superposer.
  const dx = b.x - a.x, dy = b.y - a.y;
  const lg = Math.hypot(dx, dy) || 1;
  const gap = 14 * ((rank || 0) + 1);
  const nx = -dy / lg * gap, ny = dx / lg * gap;
  let cx = (a.x + b.x) / 2 + nx, cy = (a.y + b.y) / 2 + ny;
  // Contournement : si le SEGMENT DIRECT (a→b, sans le décalage de rang) traverse un état
  // tiers, on pousse le contrôle plus loin sur la MÊME perpendiculaire — au-delà du plus grand
  // rectangle rencontré, pas juste d'un pas fixe, pour que le contournement s'adapte à la
  // taille réelle de l'obstacle.
  (etatsTiers || []).forEach(function(e){
    if(e === ofState || e === toState) return;
    const r = rectState(e);
    if(!segmentTraverseRect(a, b, r)) return;
    // Distance du CENTRE de l'obstacle à la droite a→b, projetée sur la perpendiculaire :
    // pousser le contrôle au-delà de cette distance + une marge, sur le même côté que le
    // décalage de rang (nx/ny), jamais de l'autre — sinon le contournement inverserait le
    // sens du décalage anti-recouvrement déjà posé au-dessus.
    const centre = centerState(e);
    const proj = ((centre.x - a.x) * nx + (centre.y - a.y) * ny) / gap;   // signe du côté
    const demiDiag = Math.hypot(GRAPH_STATE_L, GRAPH_STATE_H) / 2;
    const distanceVoulue = demiDiag + 20;
    if(Math.abs(proj) < distanceVoulue || proj < 0){
      const signe = proj < 0 ? -1 : 1;
      const scale = distanceVoulue / gap;
      cx = (a.x + b.x) / 2 + nx * scale * signe;
      cy = (a.y + b.y) / 2 + ny * scale * signe;
    }
  });
  return {ax: a.x, ay: a.y, bx: b.x, by: b.y, cx: cx, cy: cy};
}

/** Un link qui revient sur lui-même : une boucle au-dessus de la boîte. */
export function traceLoop(e){
  const x = (e.x || 0), y = (e.y || 0);
  return {ax: x + GRAPH_STATE_L * 0.3, ay: y, bx: x + GRAPH_STATE_L * 0.7, by: y,
          cx: x + GRAPH_STATE_L * 0.5, cy: y - 46};
}

/**
 * Combien de transitions relient déjà ce couple d'états, dans un sens OU DANS L'AUTRE ?
 *
 * Dans les deux sens, parce que c'est le recouvrement à l'écran qu'on cherche à éviter, et
 * qu'un aller et un retour occupent exactement le même segment.
 */
export function rankOfLink(transitions, i){
  const t = transitions[i];
  let rank = 0;
  for(let k = 0; k < i; k++){
    const u = transitions[k];
    if(!u) continue;
    if((u.de === t.de && u.vers === t.vers) || (u.de === t.vers && u.vers === t.de)) rank++;
  }
  return rank;
}

/**
 * Quel état se trouve sous ce point ? Le DERNIER déclaré gagne.
 *
 * Deux boîtes peuvent se chevaucher — l'utilisateur en a le droit. C'est celle qu'il voit,
 * donc celle dessinée en dernier, qu'il s'attend à attraper.
 */
export function stateSubPoint(machine, x, y){
  const states = (machine && machine.states) || [];
  for(let i = states.length - 1; i >= 0; i--){
    const e = states[i];
    if(!e) continue;
    if(x >= (e.x || 0) && x <= (e.x || 0) + GRAPH_STATE_L
       && y >= (e.y || 0) && y <= (e.y || 0) + GRAPH_STATE_H) return e;
  }
  return null;
}

/** L'étendue occupée par le graphe, pour dimensionner la zone défilante. */
export function extentGraph(machine){
  const states = (machine && machine.states) || [];
  let l = 0, h = 0;
  states.forEach(function(e){
    if(!e) return;
    l = Math.max(l, (e.x || 0) + GRAPH_STATE_L);
    h = Math.max(h, (e.y || 0) + GRAPH_STATE_H);
  });
  return {width: l + GRAPH_MARGIN, height: h + GRAPH_MARGIN};
}
