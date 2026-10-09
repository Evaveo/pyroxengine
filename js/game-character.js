// ---------- Contrôleur de personnage : moteur PARTAGÉ ----------
// Chargé par l'éditeur ET embarqué dans le build publié (js/build.js), comme
// js/game-ui.js. Il ne touche à rien de global : il ne reçoit qu'un `api` de
// script et son propre état. C'est ce qui permet le partage — les fonctions
// qu'il utilise (me, dt, axe, actionAppuyee, raycast, box) existent des deux
// côtés à l'identique.
//
// Pourquoi ce fichier existe : marcher, sauter et tenir sur une plateforme
// demande une trentaine de lignes — gravité, détection du sol au raycast,
// calage sur la surface, réapparition. Tout le monde les réécrit, et les
// réécrit mal : oublier de clamp `dt` fait traverser le sol au premier
// ralentissement, oublier de filtrer le raycast fait « atterrir » sur une pièce
// qui flotte.
//
// Volontairement CINÉMATIQUE : la physique du moteur écrit body → objet et
// jamais l'inverse, si bien qu'un personnage en corps rigide ne peut pas être
// replacé. Un contrôleur cinématique donne en prime un contact de plateforme
// net, ce que les jeux du genre font tous.

export const CHARACTER_DEFAULT = {
  speed: 7,          // unités par seconde, au sol comme en l'air
  jump: 9.5,           // impulsion verticale
  gravity: 24,         // chute — volontairement plus forte que la gravité réelle
  tagGround: 'ground',       // seuls les objets portant ce tag portent le personnage
  // LE CAP REGARDÉ, en radians, ou null pour le déplacement en axes du MONDE.
  //
  // Sans cette option, ce contrôleur ne sait déplacer un personnage que le long de X et de Z du
  // monde : parfait pour une plateforme vue de côté, inutilisable dès que la caméra tourne — en
  // vue à la première personne, « advance » emmenait vers -Z quel que soit l'endroit où le
  // joueur regardait. Le repère est celui des nœuds du moteur, dont l'avant est +Z
  // (`makeCamera`, js/objects.js) : avant = (sin cap, 0, cos cap), droite = (cos cap, 0, -sin cap).
  yaw: null,
  // LE DEMI-HAUTEUR DU PERSONNAGE, ou null pour la déduire de sa boîte englobante.
  //
  // La déduction est juste quand le nœud EST le personnage, et fausse dès qu'il ne l'est pas.
  // Mesuré sur une vue à la première personne (jeux/NeonBreach) : le nœud du joueur ne porte
  // aucun maillage, et ses seuls enfants sont l'arme tenue devant l'objectif. La boîte
  // englobante mesurait donc l'ARME — 8 cm de haut, soit un rayon de 4 cm — et le personnage se
  // posait les yeux au ras du sol, sans que rien ne le signale : il touchait bien le sol, à la
  // bonne hauteur pour ce qu'on avait mesuré. Le même piège attend tout personnage dont le
  // visuel est un modèle enfant plus petit que lui.
  radius: null,
  axeH: 'horizontal',
  axeV: 'vertical',
  actionJump: 'jump',
  chuteMortelle: -12,  // sous cette hauteur, le personnage est considéré tombé
  dtMax: 0.05          // clamped : sans elle, un ralentissement fait traverser le sol
};

// Un pas de simulation. `state` est conservé par l'appelant (l'API le range dans
// une table hors des propriétés sérialisées : y mettre des fonctions ou des
// références casserait la sauvegarde du projet).
// Renvoie {auSol, vy, aSaute, tombe} — de quoi enchaîner une animation, un son
// ou une perte de vie sans redemander l'information au moteur.
export function characterUpdate(api, state, options){
  const o = Object.assign({}, CHARACTER_DEFAULT, options || {});
  const m = api.me;
  const dt = Math.min(api.dt, o.dtMax);

  if(state.radius === undefined){
    const b = (o.radius === null || o.radius === undefined) ? api.bounds(m) : null;
    state.radius = (o.radius !== null && o.radius !== undefined)
      ? o.radius
      : (b ? (b.size.y / 2) : 0.5);
    state.vy = 0;
    state.start = {x: m.position.x, y: m.position.y, z: m.position.z};
  }

  // déplacement horizontal
  const h = api.axis(o.axeH), v = api.axis(o.axeV);
  if(o.yaw === null || o.yaw === undefined){
    m.position.x += h * o.speed * dt;
    m.position.z += -v * o.speed * dt;
  } else {
    // LA DIAGONALE NE VA PAS PLUS VITE, et seulement dans ce mode-ci : normaliser en axes du
    // monde changerait le comportement de tous les jeux de plateforme déjà écrits, alors qu'un
    // personnage à la première personne qui court 41 % plus vite en biais se remarque au premier
    // essai — c'est le défaut de jeunesse de tous les FPS des années 90.
    const len = Math.hypot(h, v) || 1;
    const nh = h / Math.max(1, len), nv = v / Math.max(1, len);
    // LA DROITE DE L'ÉCRAN EST LE −X DU NŒUD, ET C'EST UN CORRECTIF.
    //
    // L'avant d'un nœud est +Z. Mais le composant Camera tourne la caméra three d'un demi-tour
    // autour de Y pour qu'elle regarde ce +Z (`applyProjection`, components/component-camera.js),
    // et ce demi-tour retourne AUSSI son axe X : la droite de l'écran est donc −X, pas +X.
    //
    // Mesuré contre three, colonne X de la matrice monde de la caméra :
    //   cap 0   → regard (0,0,1)  droite (−1, 0, 0)
    //   cap π/2 → regard (1,0,0)  droite ( 0, 0, 1)
    // La première version prenait +X et inversait donc le pas de côté À TOUS LES CAPS. Le défaut
    // ne se voit pas en lisant le code — les deux axes sont perpendiculaires au regard dans les
    // deux cas, et le déplacement a l'air juste — mais il se sent au premier essai à la manette.
    const sin = Math.sin(o.yaw), cos = Math.cos(o.yaw);
    m.position.x += (nv * sin - nh * cos) * o.speed * dt;
    m.position.z += (nv * cos + nh * sin) * o.speed * dt;
  }

  // sol sous les pieds — filtré par tag, sinon un objet ramassable qui flotte
  // devant la plateforme servirait de plancher
  const sous = api.raycast({x: m.position.x, y: m.position.y, z: m.position.z},
                           {x: 0, y: -1, z: 0}, 100, {tag: o.tagGround});
  const groundY = sous ? sous.point.y : null;
  const atGround = (groundY !== null) && (m.position.y - state.radius <= groundY + 0.12) && state.vy <= 0.01;

  let aSaute = false;
  if(atGround && api.actionPressed(o.actionJump)){ state.vy = o.jump; aSaute = true; }

  state.vy -= o.gravity * dt;
  m.position.y += state.vy * dt;

  // calage sur la surface : on ne s'arrête QUE si on descend, sinon on serait
  // collé au plafond d'une plateforme traversée par le bottom
  if(groundY !== null && state.vy <= 0 && m.position.y - state.radius < groundY){
    m.position.y = groundY + state.radius;
    state.vy = 0;
  }

  return {
    atGround: atGround, vy: state.vy, aSaute: aSaute,
    tombe: m.position.y < o.chuteMortelle,
    ground: sous ? sous.object : null
  };
}

// Remet le personnage à son point de départ (celui où il se trouvait au premier
// appel de characterUpdate) ou à une position donnée.
export function characterRespawn(api, state, position){
  const p = position || state.start;
  if(!p) return;
  api.me.position.set(p.x, p.y, p.z);
  state.vy = 0;
}

// Donne au personnage une impulsion verticale — rebond après avoir écrasé un
// ennemi, tremplin, double saut géré par le script appelant.
export function characterBounce(state, force){
  state.vy = (force === undefined) ? 7 : force;
}


// EXPOSÉ EN GLOBALE, à dessein. Ces symboles sont appelés depuis des fichiers
// que les mêmes pages ne chargent pas toutes : un `import` y pointerait un
// fichier absent, et la page ne démarrerait pas. Ils gardent donc leur garde
// `typeof` côté appelant, et se déclarent ici.
globalThis.characterBounce = characterBounce;
globalThis.characterRespawn = characterRespawn;
globalThis.characterUpdate = characterUpdate;