// ---------- Le monde 2D : de la scène au solveur, et retour ----------
//
// Ce fichier fait le pont entre les objets de la scène et le solveur pur de js/physics-2d.js.
// Il est PARTAGÉ éditeur/runtime, et il l'est pour une raison précise : le runtime appelait
// `stepWorld2d` derrière un `typeof … === 'function'`, et comme la fonction ne vivait que dans un
// fichier de composant — jamais chargé par le jeu — la physique 2D ne tournait PAS dans un jeu
// exporté. Silencieusement : la garde faisait passer l'absence pour une désactivation normale.
//
// Rien ici ne dépend de three ni du DOM : seulement `userData`, `position`, et `actionActive`
// qui existe des deux côtés à l'identique. C'est ce qui rend le partage possible plutôt qu'un
// miroir de plus à tenir à jour.

export const PHYS2D_GRAVITY_DEFAULT = -25;   // unités/s². Plus sec que 9,81 : un platformer n'imite pas la Terre.

export function ensureBody2d(node){
  if(!node.userData.body2d){
    node.userData.body2d = {statique:false, withoutGravity:false, speedMax:40};
  }
  return node.userData.body2d;
}
export function ensureCollider2d(node){
  if(!node.userData.collider2d){
    node.userData.collider2d = {shape:'box', l:1, h:1, dx:0, dy:0,
                                 traversable:false, stepUp:'right'};
  }
  return node.userData.collider2d;
}
export function ensureController2d(node){
  if(!node.userData.controller2d){
    // `mode` : 'platform' (vue de côté — gravité, saut) ou 'topdown' (vue de dessus, huit
    // directions). Le défaut reste 'platform' : le changer ferait décoller tous les
    // personnages des projets existants, et le symptôme — un héros qui ne tombe plus — se
    // chercherait dans la gravité, pas dans un défaut qui a bougé.
    node.userData.controller2d = {mode:'platform',
                                   speed:6, heightJump:3, coyote:0.1, memoireJump:0.15,
                                   actionLeft:'left', actionRight:'right', actionJump:'jump',
                                   // `advance` et `back`, PAS `haut` et `bottom` : ces deux noms-là
                                   // n'existent dans AUCUNE table d'entrées, et `actionActive` rend
                                   // `false` pour une action inconnue — sans erreur, sans message.
                                   // Mesuré en jouant : un personnage vue de dessus neuf allait à
                                   // gauche et à droite et ne montait ni ne descendait, avec un
                                   // contrôleur dont tous les champs avaient l'air justes.
                                   // `advance`/`back` existent depuis toujours et portent déjà
                                   // les bonnes keys (z/w/↑ et s/↓).
                                   actionTop:'advance', actionBottom:'back'};
  }
  return node.userData.controller2d;
}

/**
 * Le contrôleur est-il en vue de dessus ?
 *
 * Un seul endroit lit ce champ, et c'est délibéré : un mode qui se teste à quatre endroits finit
 * par en oublier un, et le personnage se comporte à moitié comme l'un et à moitié comme l'autre.
 */
export function isControllerTop2d(ctrl){ return !!ctrl && ctrl.mode === 'topdown'; }

/**
 * La boîte 2D d'un nœud, dans la forme que le solveur attend (centre + demi-tailles).
 *
 * SON COLLIDER S'IL EN A UN, SINON L'ÉTENDUE PASSÉE. Ce repli n'est pas une commodité : un
 * déclencheur — porte, ramassage, zone de dégât — ne doit PAS porter de `Collider2D`, sinon il
 * devient un obstacle et le héros bute dessus au lieu d'entrer dedans. Sans repli, il faudrait
 * choisir entre « détectable » et « traversable ».
 *
 * L'étendue est calculée par l'appelant, qui seul a accès à three.js : ce module est partagé avec
 * le jeu publié et doit rester lisible par un test sans moteur de rendu.
 */
export function box2dOf(node, extent){
  const c = node && node.userData && node.userData.collider2d;
  if(c){
    return {x: node.position.x + (c.dx || 0), y: node.position.y + (c.dy || 0),
            dl: Math.max(0.001, (c.l || 1) / 2), dh: Math.max(0.001, (c.h || 1) / 2)};
  }
  if(!extent || !extent.min || !extent.max) return null;
  const l = extent.max.x - extent.min.x, h = extent.max.y - extent.min.y;
  // Une étendue empty — un nœud sans géométrie — rendrait une boîte de taille nulle qui ne
  // chevauche jamais rien. On rend `null` : « je ne sais pas » se voit, « jamais » se déduit mal.
  if(!(l > 0) || !(h > 0)) return null;
  return {x: (extent.min.x + extent.max.x) / 2, y: (extent.min.y + extent.max.y) / 2,
          dl: l / 2, dh: h / 2};
}

/**
 * Rassemble la scène 2D en body et obstacles, tels que le solveur les attend.
 *
 * Les tailles sont en DEMI-tailles parce que c'est ce que tous les calculs du solveur
 * utilisent ; convertir à chaque test doublerait les occasions de se tromper d'un facteur deux.
 * La position vient de l'objet, pas d'un état gardé à part : c'est elle que l'auteur déplace
 * dans l'éditeur, et un état parallèle finirait par en diverger.
 */
/**
 * Les obstacles d'une map de tuiles, mis en hidden sur le nœud.
 *
 * Le regroupement en bands coûte un parcours de toute la grille — 1 296 cases pour une salle.
 * Le redo à chaque image gâcherait précisément ce que les bands font gagner. Le hidden est
 * invalidé par le counter de version, que toute modification de la map incrémente : se fier à
 * un « la map a-t-elle changé ? » approximatif laisserait le solveur travailler sur l'ancien
 * décor après un coup de pinceau, et on peindrait un sol sur lequel le personnage tombe encore.
 */
export function obstacles2dOfNode(o){
  const c = (o.getComponent && o.getComponent('Tilemap')) || null;
  if(!c || typeof collidingBands !== 'function') return null;
  const v = c._v || 0;
  if(o.userData._obst2dV === v && o.userData._obst2d) return o.userData._obst2d;
  // La collision de la MAP passe avant celle de chaque tuile : « Aucune » en fait un décor.
  const tiles = (typeof c.tileDefs === 'function') ? c.tileDefs() : null;
  const base = obstaclesTilemap(c, collidingBands(c, tiles), tiles);
  // La map est posée sur son nœud : c'est lui que l'auteur déplace dans l'éditeur.
  const dx = o.position.x, dy = o.position.y;
  const obs = base.map(function(b){ return Object.assign({}, b, {x: b.x + dx, y: b.y + dy}); });
  o.userData._obst2d = obs;
  o.userData._obst2dV = v;
  o.userData._obst2dPos = dx + ',' + dy;
  return obs;
}

export function gatherWorld2d(list){
  const body = [], obstacles = [];
  // LES CANDIDATS, PAS LA SCÈNE ENTIÈRE. Ce parcours tournait sur tous les objets à chaque
  // image, en appelant `getComponent('Tilemap')` sur chacun — 2,15 ms par image sur une scène
  // de 5 000 objets qui n'a pas une seule pièce 2D. Le registre le sait sans rien parcourir.
  //
  // `typeof` : ce fichier est PARTAGÉ avec le jeu publié et n'a aucun import, à dessein. Sans
  // registre on retombe sur la liste complète, c'est-à-dire sur le comportement d'avant.
  const candidates = (typeof Registry !== 'undefined' && Registry.nodesCarrying)
    ? Registry.nodesCarrying(list, ['Collider2D', 'Tilemap'])
    : (list || []);
  candidates.forEach(function(o){
    if(o.getComponent && o.getComponent('Tilemap')){
      // Une map déplacée invalide son hidden au même titre qu'une map repeinte.
      if(o.userData._obst2dPos !== (o.position.x + ',' + o.position.y)) o.userData._obst2d = null;
      const t = obstacles2dOfNode(o);
      if(t) t.forEach(function(b){ obstacles.push(b); });
    }
    const c = o.userData && o.userData.collider2d;
    if(!c) return;
    const b = {
      node: o,
      x: o.position.x + (c.dx || 0), y: o.position.y + (c.dy || 0),
      dl: Math.max(0.001, (c.l || 1) / 2), dh: Math.max(0.001, (c.h || 1) / 2),
      vx: 0, vy: 0
    };
    const rb = o.userData.body2d;
    if(rb && !rb.statique){
      b.vx = rb._vx || 0; b.vy = rb._vy || 0;
      b.withoutGravity = !!rb.withoutGravity;
      body.push(b);
      return;
    }
    b.statique = true;
    b.traversable = !!c.traversable;
    b.rolloff = (c.shape === 'slope');
    b.stepUp = c.stepUp || 'right';
    obstacles.push(b);
  });
  return {body: body, obstacles: obstacles};
}

/**
 * Un pas du monde 2D. Rend le nombre de body simulés — de quoi le dire dans l'interface.
 *
 * La vitesse est REPORTÉE sur `userData` après le pas, et la position sur l'objet. Garder un
 * état de body parallèle à la scène obligerait à les resynchroniser à chaque geste de
 * l'éditeur, et c'est exactement là que les deux se mettent à diverger.
 */
export function stepWorld2d(list, dt, gravity, readAction){
  if(typeof stepPhysics2d !== 'function') return 0;
  const m = gatherWorld2d(list);
  const g = (gravity === undefined) ? PHYS2D_GRAVITY_DEFAULT : gravity;
  m.body.forEach(function(b){
    const ctrl = b.node.userData.controller2d;
    // LE MODE PORTE SES PROPRES CONSÉQUENCES PHYSIQUES, on ne les demande pas à l'auteur. Un
    // contrôleur vu de dessus exige gravité nulle ET franchissement de marche coupé ; laisser
    // ces deux cases à cocher garantirait qu'on en oublie une, et le symptôme — un héros qui
    // tombe, ou qui traverse les murs — se chercherait dans le décor.
    if(isControllerTop2d(ctrl)){ b.withoutGravity = true; b.withoutMarche = true; }
    if(ctrl) applyController2d(b, ctrl, dt, g, readAction);
    const state = stepPhysics2d(b, m.obstacles, g, dt);
    const rb = b.node.userData.body2d;
    const vm = Math.max(1, (rb && rb.speedMax) || 40);
    // Un plafond de vitesse, et pas par prudence : sans lui une chute longue finit par franchir
    // plus qu'un bloc entier par image, et le corps traverse le sol sans jamais le toucher.
    b.vy = Math.max(-vm, Math.min(vm, b.vy));
    b.vx = Math.max(-vm, Math.min(vm, b.vx));
    if(rb){ rb._vx = b.vx; rb._vy = b.vy; rb._AtGround = state.atGround; }
    const c = b.node.userData.collider2d || {};
    b.node.position.x = b.x - (c.dx || 0);
    b.node.position.y = b.y - (c.dy || 0);
  });
  return m.body.length;
}

/**
 * Les commandes du personnage : déplacement, saut, coyote time et mémorisation.
 *
 * LA LECTURE DES TOUCHES EST PASSÉE EN ARGUMENT, elle n'est plus cherchée dans le global.
 *
 * Elle l'était, et ce composant était MORT dans tout jeu exporté. `js/game-runtime.js` est
 * enveloppé dans une IIFE — il se termine par `})();` — donc rien de ce qu'il déclare n'est
 * global, `actionActive` compris. Le `typeof actionActive === 'function'` rendait donc toujours
 * faux : le personnage ne bougeait pas, sans une erreur, sans une trace. Troisième fois cette
 * semaine qu'une garde `typeof` transforme une absence en désactivation silencieuse.
 *
 * Sans lecteur, le contrôleur ne fait rien — et c'est voulu : dans l'éditeur hors mode game, un
 * personnage qui marcherait tout seul serait impossible à placer. Mais c'est maintenant un
 * argument absent, pas un global missing : la différence est qu'on peut la voir.
 */
export function applyController2d(b, ctrl, dt, gravity, readAction){
  const read = (name) => (typeof readAction === 'function') ? !!readAction(name) : false;
  const g = read(ctrl.actionLeft), d = read(ctrl.actionRight);
  const v = ctrl.speed || 6;

  // ---------- Vue de dessus : huit directions, pas de saut, pas de gravité ----------
  if(isControllerTop2d(ctrl)){
    const h = read(ctrl.actionTop), ba = read(ctrl.actionBottom);
    let ax = (d ? 1 : 0) - (g ? 1 : 0);
    let ay = (h ? 1 : 0) - (ba ? 1 : 0);
    // LA DIAGONALE EST NORMALISÉE. Sans ça, aller en haut à droite donne √2 ≈ 1,41 fois la
    // vitesse d'un déplacement droit : le joueur découvre en quelques minutes qu'on avance plus
    // vite en biais, et tout le jeu se parcourt en zigzag. C'est visible, ça ne ressemble pas à
    // un bug, et ça ruine le réglage de toutes les distances.
    if(ax && ay){ const k = Math.SQRT1_2; ax *= k; ay *= k; }
    b.vx = ax * v;
    b.vy = ay * v;
    // La DIRECTION REGARDÉE est mémorisée ici et pas dans le jeu : elle sert à l'animation et au
    // sens du coup, et chaque jeu la recalculerait autrement. On ne la met à jour que si l'on
    // bouge — sinon relâcher les cles ferait regarder vers le bas par défaut.
    if(ax || ay){
      const e2 = b.node.userData._ctrl2d || (b.node.userData._ctrl2d = {});
      e2.regardX = ax; e2.regardY = ay;
    }
    return;
  }

  b.vx = ((d ? 1 : 0) - (g ? 1 : 0)) * v;

  const e = b.node.userData._ctrl2d || (b.node.userData._ctrl2d = {fromGround: 0, request: NaN});
  const rb = b.node.userData.body2d;
  e.fromGround = (rb && rb._AtGround) ? 0 : e.fromGround + dt;
  e.request = isFinite(e.request) ? e.request + dt : NaN;
  if(read(ctrl.actionJump) && !e.appuye) e.request = 0;
  e.appuye = read(ctrl.actionJump);

  if(jumpAllowed2d(rb && rb._AtGround, e.fromGround, e.request, ctrl.coyote, ctrl.memoireJump)){
    // Le pas de temps est passé : sans lui la hauteur demandée est manquée de ~4 %, et l'aide de
    // l'inspecteur promet justement que le réglage est une HAUTEUR, pas une vitesse.
    b.vy = speedOfJump2d(ctrl.heightJump, gravity, dt);
    e.request = NaN;                 // consommée : sans ça le saut se rejouerait à chaque image
    e.fromGround = 999;               // et le coyote ne servirait pas deux fois
  }
}


// EXPOSÉ EN GLOBALE, à dessein. Ces symboles sont appelés depuis des fichiers
// que les mêmes pages ne chargent pas toutes : un `import` y pointerait un
// fichier absent, et la page ne démarrerait pas. Ils gardent donc leur garde
// `typeof` côté appelant, et se déclarent ici.
globalThis.box2dOf = box2dOf;
globalThis.ensureBody2d = ensureBody2d;
globalThis.ensureCollider2d = ensureCollider2d;
globalThis.ensureController2d = ensureController2d;
globalThis.gatherWorld2d = gatherWorld2d;
globalThis.stepWorld2d = stepWorld2d;