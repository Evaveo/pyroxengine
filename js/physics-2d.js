// ---------- Physics 2D : un monde à part, et c'est la décision qui fait tout ----------
//
// Ce solveur n'a AUCUN rapport avec Cannon.js. Unity et Godot maintiennent tous les deux deux
// mondes physiques séparés — Box2D d'un côté, PhysX ou Jolt de l'autre — et ce n'est pas de la
// paresse d'architecture : un jeu 2D a besoin de choses qu'un moteur 3D contraint ne donnera
// jamais proprement. Pas de dérive en rotation hors du plan, des collisions exactes contre des
// blocs jointifs, des plateformes à sens unique, des pentes, et un « au sol » sur lequel on
// puisse fonder un saut.
//
// Contraindre Cannon en verrouillant deux axes donne ce qu'on voit dans tous les moteurs 3D qui
// « font aussi de la 2D » : ça marche en démonstration et ça s'effondre sur un platformer.
//
// PUR : ni three, ni DOM. Partagé éditeur/runtime — voir
// docs/superpowers/specs/2026-08-16-fondation-2d-design.md, phase 2.

// Un body : centre (x, y), demi-tailles (dl, dh), vitesse (vx, vy).
// Les demi-tailles plutôt que largeur/hauteur parce que c'est ce que TOUS les calculs
// utilisent — convertir à chaque test doublerait les occasions de se tromper d'un facteur deux.

export const PHYS2D_EPSILON = 1e-6;

// De combien une pente peut « rattraper » un corps qui la monte, par image. Assez pour une
// pente raide parcourue vite — 5 unités/s sur 45° montent de 0,083 par image à 60 Hz — et bien
// moins qu'un saut, pour qu'un personnage qui passe sous une pente ne s'y colle pas.
export const PHYS2D_STEPUP_MAX = 0.5;

/** Applique la gravité. Séparée de l'intégration pour qu'un corps puisse s'en exempter. */
export function applyGravity2d(body, gravity, dt){
  if(!body || body.statique || body.withoutGravity) return body;
  body.vy += (Number(gravity) || 0) * (Number(dt) || 0);
  return body;
}

/** Les deux boîtes se chevauchent-elles ? Rend les profondeurs, ou null. */
export function overlap2d(a, b){
  if(!a || !b) return null;
  const px = (a.dl + b.dl) - Math.abs(a.x - b.x);
  const py = (a.dh + b.dh) - Math.abs(a.y - b.y);
  if(px <= PHYS2D_EPSILON || py <= PHYS2D_EPSILON) return null;
  return {x: px, y: py};
}

/**
 * Une plateforme à sens unique arrête-t-elle CE body, à cette image ?
 *
 * Trois conditions, et il faut les trois : le corps descend, il venait d'AU-DESSUS, et il n'est
 * pas déjà enfoncé dedans. Sans la deuxième on ne peut jamais traverser par en dessous ; sans
 * la troisième, un corps qui apparaît à l'intérieur y reste piégé pour toujours.
 */
export function platformStopped(body, plate, bottomBefore){
  if(!body || !plate) return false;
  if(body.vy > 0) return false;                       // il monte : elle le laisse passer
  const topPlate = plate.y + plate.dh;
  return bottomBefore >= topPlate - PHYS2D_EPSILON;
}

/**
 * La hauteur de la surface d'une pente à l'abscisse `x`.
 *
 * Une pente est décrite par sa boîte englobante et le côté par lequel elle MONTE :
 * `montee: 'right'` = le point haut est à droite. Hors de la boîte, on rend `null` — et non la
 * hauteur du bord, qui ferait flotter un corps au-delà de la pente comme s'il y avait un mur
 * invisible.
 */
export function heightSlope2d(rolloff, x){
  if(!rolloff) return null;
  const g = rolloff.x - rolloff.dl, d = rolloff.x + rolloff.dl;
  if(x < g - PHYS2D_EPSILON || x > d + PHYS2D_EPSILON) return null;
  const bottom = rolloff.y - rolloff.dh, top = rolloff.y + rolloff.dh;
  const t = (d - g) > PHYS2D_EPSILON ? (x - g) / (d - g) : 0;
  const k = Math.max(0, Math.min(1, t));
  return (rolloff.stepUp === 'left') ? (top + (bottom - top) * k) : (bottom + (top - bottom) * k);
}

/**
 * Un pas de simulation, pour UN body contre une liste d'obstacles.
 *
 * LES DEUX AXES SONT TRAITÉS SÉPARÉMENT — d'abord X, puis Y — et c'est la décision qui rend ce
 * solveur utilisable. La méthode courante, « résoudre selon l'axe de moindre pénétration »,
 * accroche sur les jointures : un corps qui glisse sur un sol fait de blocs jointifs bute sur
 * les arêtes verticales entre deux blocs, parce qu'à cet instant la pénétration horizontale est
 * la plus petite. Le personnage s'arrête net au milieu d'un sol plat, sans raison visible.
 *
 * Deux passes séparées suppriment le cas : pendant la passe X, le corps est encore à son
 * ancienne hauteur, donc il ne touche pas encore le bloc suivant.
 *
 * Renvoie ce que le pas a produit : au sol, contre un mur, et de quel côté.
 */
export function stepPhysics2d(body, obstacles, gravity, dt){
  const state = {atGround: false, plafond: false, murLeft: false, murRight: false};
  if(!body || body.statique) return state;
  const step = Number(dt) || 0;
  applyGravity2d(body, gravity, step);
  const list = obstacles || [];

  // --- pass X ---
  body.x += body.vx * step;
  list.forEach(function(o){
    if(!o || o.rolloff || o.traversable) return;         // ni pente ni plateforme en pass X
    const c = overlap2d(body, o);
    if(!c) return;
    // FRANCHISSEMENT DE MARCHE. Un obstacle dont le dessus dépass à peine les pieds n'est pas
    // un mur, c'est une marche : on monte dessus au lieu d'être arrêté. Sans ça, toute jonction
    // entre une pente et le palier qu'elle rejoint bloque le personnage — mesuré : il s'arrêtait
    // à 0,3 unité du palier, au sommet de la pente, sans qu'aucun mur ne soit visible. Une
    // bordure d'un seul pixel produirait le même arrêt.
    //
    // La seconde condition n'est PAS `marche > 0` : à ce point du code il y a chevauchement, et
    // un balayage de 3 159 configurations atteignables en donne 0 où `marche > 0` serait faux —
    // c'était une garde morte. Pire, elle en laissait passer 69 où le HAUT du corps est sous le
    // dessus de l'obstacle : pour ce body-là ce n'est pas une marche, c'est un mur, et la garde
    // le faisait grimper dessus. Un petit personnage escaladait donc les plafonds bottom.
    const marche = (o.y + o.dh) - (body.y - body.dh);
    const franchissable = (body.y + body.dh) > (o.y + o.dh);
    // `sansMarche` COUPE LE FRANCHISSEMENT, et c'est lui qui rend la vue de dessus possible.
    // Vu de côté, un obstacle dont le dessus dépass à peine les pieds est une marche : on monte
    // dessus. Vu de dessus, il n'y a plus de « dessus » — le Y n'est plus une hauteur mais une
    // PROFONDEUR, et tout mur situé un peu plus bas que le héros devient une marche qu'il gravit,
    // donc qu'il TRAVERSE. Le personnage se promènerait à travers le décor en montant d'un cran à
    // chaque contact, et on chercherait le défaut dans les collisions plutôt qu'ici.
    if(!body.withoutMarche && franchissable && marche <= (o.stepUpMax || PHYS2D_STEPUP_MAX)){
      body.y += marche;
      // Le contact au sol n'est rendu que si le corps NE MONTE PAS. Un personnage qui frôle une
      // marche en plein saut est en train de la quitter, pas de s'y poser : lui rendre le contact
      // lui rend son saut à chaque image, et il grimpe indéfiniment le long du décor.
      if(body.vy <= 0) state.atGround = true;
      return;
    }
    if(body.x < o.x){ body.x = o.x - o.dl - body.dl; state.murRight = true; }
    else { body.x = o.x + o.dl + body.dl; state.murLeft = true; }
    if((body.vx > 0 && state.murRight) || (body.vx < 0 && state.murLeft)) body.vx = 0;
  });

  // --- pass Y ---
  const bottomBefore = body.y - body.dh;
  body.y += body.vy * step;
  list.forEach(function(o){
    if(!o) return;
    if(o.rolloff){
      const surface = heightSlope2d(o, body.x);
      if(surface === null) return;
      const bottom = body.y - body.dh;
      if(bottom > surface + PHYS2D_EPSILON) return;       // encore au-dessus : il tombe encore
      // DEUX façons légitimes de se retrouver sur une pente, et il faut les deux :
      //   · on vient de la TRAVERSER en tombant — c'est l'atterrissage, et il doit marcher même
      //     à grande vitesse, où un pas d'intégration franchit largement la surface ;
      //   · on est juste en dessous et on MONTE la pente en marchant — la surface s'élève d'un
      //     peu à chaque image, et il faut suivre.
      //
      // Sans la seconde clamped, une pente aimanterait tout ce qui passe sous elle, à n'importe
      // quelle distance : un saut trois unités plus bas collerait le personnage à sa face.
      // Défaut mesuré, et trouvé par le test du saut sous une pente.
      const traverse = bottomBefore >= surface - PHYS2D_EPSILON;
      const stepUp = (surface - bottom) <= (o.stepUpMax || PHYS2D_STEPUP_MAX);
      if(!traverse && !stepUp) return;
      body.y = surface + body.dh;
      if(body.vy < 0) body.vy = 0;                   // un saut en cours n'est pas annulé
      state.atGround = true;
      return;
    }
    const c = overlap2d(body, o);
    if(!c) return;
    if(o.traversable){
      if(!platformStopped(body, o, bottomBefore)) return;
      body.y = o.y + o.dh + body.dh;
      body.vy = 0;
      state.atGround = true;
      return;
    }
    if(body.y > o.y){ body.y = o.y + o.dh + body.dh; state.atGround = true; }
    else { body.y = o.y - o.dh - body.dh; state.plafond = true; }
    body.vy = 0;
  });
  body.atGround = state.atGround;
  return state;
}

/**
 * La vitesse verticale à donner pour atteindre EXACTEMENT `height`.
 *
 * `v = √(2·g·h)`. Régler un saut en unités par seconde oblige à essayer au jugé et à recommencer
 * dès qu'on touche à la gravité ; le régler en hauteur de saut est ce que l'auteur a en tête.
 */
export function speedOfJump2d(height, gravity, dt){
  const h = Number(height) || 0;
  // Pas de garde `g <= 0` : `g` est une valeur absolue, donc jamais négative, et une gravité
  // nulle donne √0 = 0 toute seule. La garde était du code qui avait l'air d'en être une — la
  // mutation qui la supprimait survivait à tous les tests.
  const g = Math.abs(Number(gravity) || 0);
  if(h <= 0) return 0;
  const step = Math.abs(Number(dt) || 0);
  if(!(step > 0)) return Math.sqrt(2 * g * h);   // la limite dt → 0
  // AVEC le pas de temps. L'intégrateur semi-implicite retranche une image de gravité AVANT le
  // premier déplacement, et le sommet vaut donc `v²/2g − v·dt/2`, pas `v²/2g` : mesuré 1,917
  // pour 2 demandés à 60 Hz, soit 4 % de moins. C'est assez pour rater un rebord réglé au
  // millimètre, et on chercherait du côté du décor. On inverse la vraie relation plutôt que la
  // relation continue : v² − g·dt·v − 2gh = 0.
  const b = g * step;
  return (b + Math.sqrt(b * b + 8 * g * h)) / 2;
}

/**
 * Le saut est-il permis à cet instant ? `depuisSol` en secondes, `demandeIlY` en secondes.
 *
 * Les deux tolérances qui séparent un platformer agréable d'un platformer frustrant, et qu'on
 * ne devine pas en jouant — on sent seulement que « ça ne répond pas » :
 *   · le COYOTE TIME : sauter reste possible quelques centièmes après avoir quitté le sol,
 *     parce qu'un joueur appuie presque toujours un peu trop tard au bord d'une plateforme ;
 *   · la MÉMORISATION : un saut demandé juste avant d'atterrir est joué à l'atterrissage, au
 *     lieu d'être perdu.
 */
export function jumpAllowed2d(atGround, fromGround, requestIlY, coyote, memoire){
  const t = Number(fromGround) || 0;
  const d = Number(requestIlY);
  if(!isFinite(d) || d < 0) return false;
  if(d > (Number(memoire) || 0)) return false;         // la demande est trop vieille
  return !!atGround || t <= (Number(coyote) || 0);
}


// EXPOSÉ EN GLOBALE, à dessein. Ces symboles sont appelés depuis des fichiers
// que les mêmes pages ne chargent pas toutes : un `import` y pointerait un
// fichier absent, et la page ne démarrerait pas. Ils gardent donc leur garde
// `typeof` côté appelant, et se déclarent ici.
globalThis.jumpAllowed2d = jumpAllowed2d;
globalThis.overlap2d = overlap2d;
globalThis.speedOfJump2d = speedOfJump2d;
globalThis.stepPhysics2d = stepPhysics2d;