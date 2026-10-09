// ---------- Caméra 2D : le calcul, sans three et sans DOM ----------
//
// Trois choses qu'un jeu 2D exige et qu'aucune caméra 3D ne donne :
//
//   1. UNE PROJECTION ORTHOGRAPHIQUE. Le runtime n'avait que du perspectif. On peut s'en tirer en
//      gardant tous les sprites dans un même plan — une perspective sur un plan unique ne produit
//      qu'un grandissement uniforme — mais l'auteur n'a alors aucun réglage lisible, et le premier
//      objet placé à un autre z casse tout sans prévenir.
//   2. UN RAPPORT PIXEL ENTIER. C'est ce qui décide de la netteté, et rien d'autre : filtrage au
//      plus proche, absence de post-traitement et palette courte n'y changent rien. Mesuré sur un
//      game réel — 216 pixels d'art affichés dans 150 pixels d'écran, soit un rapport de 0,694 —
//      et c'était tout le « flou » qu'on attribuait au rendu.
//   3. UN SUIVI BORNÉ. Une caméra qui suit sans bounds montre le vide au-delà du niveau ; une
//      caméra clouée montre la moitié du niveau. Le défaut mesuré : caméra fixe en x sur une tour
//      de 46 unités, la moitié de l'écran hors du décor, et les plateformes hors field — d'où
//      « il n'y a aucune plateforme accessible » alors qu'elles étaient là.
//
// PUR : ni three ni DOM. Partagé éditeur/runtime, pour la raison habituelle — une divergence de
// cadrage ne se verrait qu'après export, et c'est la famille de défaut la plus coûteuse ici.

/**
 * Le rapport pixel entier, et la hauteur de vue qui en découle.
 *
 * `mode` décide du critère, et le bon dépend du niveau :
 *   · `height` — le plus grand rapport qui tienne dans la fenêtre. Le plus net, mais il montre
 *     peu, et laisse du vide si le niveau est plus étroit que la vue.
 *   · `width` — le plus PETIT rapport qui garde la vue à l'intérieur du niveau. C'est celui
 *     qu'on veut presque toujours : la moindre pixellisation possible sans jamais montrer le
 *     hors-field. Demande de connaître la largeur du niveau.
 *   · `fixed` — le rapport imposé, pour un jeu qui veut exactement sa fenêtre.
 *
 * Rend `{rapport, hauteurVue, largeurVue}` en unités du monde.
 */
export function framing2d(widthPx, heightPx, ppu, mode, widthLevel, ratioImpose){
  const L = Math.max(1, Number(widthPx) || 1), H = Math.max(1, Number(heightPx) || 1);
  const p = Math.max(1, Number(ppu) || 16);
  let r;
  if(mode === 'fixed'){
    r = Math.max(1, Math.round(Number(ratioImpose) || 1));
  } else if(mode === 'width' && Number(widthLevel) > 0){
    // Le plus petit rapport tel que la vue reste dans le niveau : L / (r·ppu) ≤ largeurNiveau.
    r = Math.max(1, Math.ceil(L / (p * Number(widthLevel))));
  } else {
    // Par défaut : le plus grand rapport qui tienne dans la hauteur de la fenêtre, une hauteur
    // de référence valant 216 px — la hauteur d'un écran 16:9 en pixel-art.
    r = Math.max(1, Math.floor(H / 216));
  }
  // `ppu` voyage AVEC le cadrage : le calage sur le pixel en a besoin, et le composant qui
  // suit (CameraFollow) ne porte pas d'echelle — c'est la camera qui la porte.
  return {ratio: r, heightView: H / (r * p), widthView: L / (r * p), ppu: p};
}

/**
 * La position de la caméra qui suit une cible, bornée aux limites du niveau.
 *
 * `bounds` : `{xMin, xMax, yMin, yMax}` en unités, chacune facultative. Une clamped absente laisse
 * l'axe libre — c'est ce qu'on veut sur la verticale d'une tour, dont on ne connaît pas la fin.
 *
 * Le décalage vertical (`hautDeVue`) place le personnage un peu SOUS le centre : dans un
 * platformer on regarde vers le haut, pas vers ses pieds. Exprimé en fraction de la hauteur de
 * view, il reste juste à toutes les résolutions.
 */
/**
 * Une clamped est-elle RENSEIGNÉE ?
 *
 * `isFinite(null)` rend VRAI — `Number(null)` valant 0. Une clamped absente notée `null` était donc
 * lue comme « borné à zéro », et deux bounds nulles font un niveau de largeur nulle : la caméra
 * était centrée sur l'origine et ne suivait plus rien. Aucune erreur, aucune trace — le suivi
 * marchait sur un jeu qui déclarait ses bounds et pas sur un jeu qui ne les déclarait pas, ce qu'on
 * aurait mis sur le compte du suivi lui-même. Un champ vide de l'inspecteur écrit précisément
 * `null`, donc le cas n'est pas théorique : c'est le cas par défaut.
 */
export function clampedData2d(v){
  return typeof v === 'number' && isFinite(v);
}

export function follow2d(target, heightView, widthView, bounds, topOfView){
  const b = bounds || {};
  const halfL = widthView / 2, halfH = heightView / 2;
  let x = Number(target && target.x) || 0;
  let y = (Number(target && target.y) || 0) + heightView * (Number(topOfView) || 0);
  // Les bounds sont appliquées en tenant count de la MOITIÉ de la vue : clamp le centre sur les
  // limites du niveau laisserait quand même dépasser une demi-fenêtre de vide.
  if(clampedData2d(b.xMin) && clampedData2d(b.xMax)){
    // Un niveau plus étroit que la vue : on le centre, plutôt que de coller un bord et montrer
    // du vide de l'autre côté.
    if((b.xMax - b.xMin) <= widthView) x = (b.xMin + b.xMax) / 2;
    else x = Math.max(b.xMin + halfL, Math.min(b.xMax - halfL, x));
  }
  if(clampedData2d(b.yMin) && clampedData2d(b.yMax)){
    if((b.yMax - b.yMin) <= heightView) y = (b.yMin + b.yMax) / 2;
    else y = Math.max(b.yMin + halfH, Math.min(b.yMax - halfH, y));
  }
  return {x, y};
}

/**
 * Le frustum d'une caméra orthographique, prêt à poser sur three.
 *
 * `near` négatif et `far` positif : en 2D les sprites sont autour de z = 0 et l'auteur les décale
 * dans les deux sens pour ordonner les plans. Un `near` à 0,1 — le réflexe venu de la 3D —
 * ferait disparaître tout ce qui passe derrière la caméra, c'est-à-dire la moitié des calques.
 */
export function frustum2d(heightView, widthView){
  return {left: -widthView / 2, right: widthView / 2,
          top: heightView / 2, bottom: -heightView / 2,
          near: -1000, far: 1000};
}

/**
 * Cale une position sur la grille de pixels de l'écran.
 *
 * Sans ça, une caméra à une position continue fait « frémir » tout le décor : chaque texel tombe
 * tantôt sur un pixel, tantôt entre deux, et les colonnes du sprite changent de largeur d'une
 * image à l'autre. C'est le défaut qu'on décrit comme « ça scintille » sans savoir le nommer.
 */
export function snapOnPixel2d(v, ppu, ratio){
  const step = 1 / (Math.max(1, Number(ppu) || 16) * Math.max(1, Number(ratio) || 1));
  return Math.round((Number(v) || 0) / step) * step;
}

// ---------- Le réglage, et son application ----------
//
// Les trois fonctions qui suivent touchent un objet caméra et un nœud, mais toujours par simple
// affectation de propriétés : rien n'y exige `THREE`, et un objet quelconque fait l'affaire dans un
// test. C'est ce qui permet de les PARTAGER plutôt que d'en tenir un miroir de chaque côté — et le
// miroir est ici particulièrement coûteux, parce que six affectations et un `near` négatif se
// recopient très bien à un détail près, qu'on ne voit qu'après export.

/**
 * Les valeurs par défaut d'une caméra 2D — un seul endroit.
 *
 * Elles étaient écrites en clair des deux côtés (`Number(r.ppu) || 16`, `r.mode || 'height'`), ce
 * qui est la même faute que d'avoir deux fois le code : le jour où le défaut change d'un côté, le
 * game exporté ne cadre plus comme l'éditeur, et rien ne le signale.
 */
export const CAM2D_DEFAULT = {
  mode: 'height',      // le cadrage. « largeur » est presque toujours le bon — voir framing2d.
  ppu: 100,             // pixels d'art par unité du monde — le même défaut que PPU2D_DEFAULT et Camera
  ratio: 1,           // seulement pour le mode « fixe »
  widthLevel: 0,     // seulement pour le mode « largeur », en unités
  suit: null,           // le nom de l'objet suivi ; sans lui la caméra ne bouge pas
  topOfView: 0.12,      // le suivi place la cible un peu SOUS le centre — on regarde vers le haut
  xMin: null, xMax: null, yMin: null, yMax: null,   // bounds du niveau ; une paire absente = axe libre
  snapPixel: true      // caler la caméra sur la grille de pixels : c'est ce qui empêche le frémissement
};

/**
 * Un réglage complet à partir d'un réglage partiel.
 *
 * `raw` accepte aussi bien un objet de réglages brut qu'une instance du composant `Camera` :
 * `Object.assign` ne copie que les propriétés PROPRES d'un objet, et depuis la migration du
 * composant vers `userData.camera` (docs/REVUE_2026-09-14.md point 10) ses champs (`ppu`,
 * `mode`…) sont des accesseurs du PROTOTYPE — invisibles à `Object.assign` comme à
 * `Object.keys`. Déballer `.data` ici évite de le faire à chaque appelant.
 */
export function settingCam2d(raw){
  const src = (raw && raw.data) ? raw.data : raw;
  const r = Object.assign({}, CAM2D_DEFAULT, src || {});
  // Tout ce qui n'est pas un nombre STRICTEMENT POSITIF retombe sur le défaut. Un `Math.max(1, …)`
  // ramènerait un ppu négatif à 1, c'est-à-dire à une unité par pixel : la vue serait cent fois
  // trop large, l'écran montrerait un décor minuscule, et le réglage aurait l'air pris en compte.
  r.ppu = (Number(r.ppu) > 0) ? Number(r.ppu) : CAM2D_DEFAULT.ppu;
  r.mode = (['height', 'width', 'fixed'].indexOf(r.mode) === -1) ? CAM2D_DEFAULT.mode : r.mode;
  return r;
}

/**
 * Le composant `Camera` d'un nœud — la source unique des réglages de cadrage.
 *
 * Il y avait un SECOND sac, `userData.cam2d`, rempli par `Camera2D`. Deux sacs pour un réglage,
 * c'est deux valeurs qui divergent : une caméra rechargée revenait en perspective parce que le
 * composant disait une chose et le sac une autre.
 */
export function cameraSettingOf(node){
  return (node && typeof node.getComponent === 'function') ? node.getComponent('Camera') : null;
}

/** Le composant de suivi d'un nœud, s'il en porte un. */
export function cameraFollowOf(node){
  return (node && typeof node.getComponent === 'function') ? node.getComponent('CameraFollow') : null;
}

/**
 * Pose le frustum d'une caméra orthographique pour une taille de toile donnée.
 *
 * Rend le cadrage (`{rapport, hauteurVue, largeurVue}`), dont le suivi a besoin ensuite.
 */
export function applyFraming2d(cam, setting, widthPx, heightPx){
  const r = settingCam2d(setting);
  const c = framing2d(widthPx, heightPx, r.ppu, r.mode, r.widthLevel, r.ratio);
  const f = frustum2d(c.heightView, c.widthView);
  cam.left = f.left; cam.right = f.right; cam.top = f.top; cam.bottom = f.bottom;
  cam.near = f.near; cam.far = f.far;
  if(typeof cam.updateProjectionMatrix === 'function') cam.updateProjectionMatrix();
  return c;
}

/**
 * Cadre une caméra orthographique selon son composant `Camera` — LE SEUL point de décision entre
 * cadrage pixel-perfect et cadrage `orthoSize`.
 *
 * Il y en avait trois (CameraSystem, resize du jeu, resize de l'éditeur) qui ne tranchaient pas
 * pareil : les resize appliquaient TOUJOURS le cadrage pixel-perfect, le CameraSystem ne le faisait
 * que si `pixelPerfect` était coché et sinon reposait `orthoSize` à chaque image. Résultat : un
 * `{mode:'fixed', ratio:2, ppu:24}` sans `pixelPerfect` n'avait aucun effet visible, et `cam.left`…
 * changeait selon qui avait parlé en dernier.
 *
 * Rend le cadrage `{ratio, heightView, widthView, ppu}`, posé aussi sur `comp._framing`.
 */
export function frameOrthoCamera(cam, comp, widthPx, heightPx){
  const w = Math.max(1, Number(widthPx) || 1), h = Math.max(1, Number(heightPx) || 1);
  let c;
  if(!comp || comp.pixelPerfect){
    c = applyFraming2d(cam, comp, w, h);
  } else {
    const half = Number(comp.orthoSize) > 0 ? Number(comp.orthoSize) : 5;
    const aspect = w / h;
    cam.top = half; cam.bottom = -half;
    cam.left = -half * aspect; cam.right = half * aspect;
    cam.near = -1000; cam.far = 1000;
    if(typeof cam.updateProjectionMatrix === 'function') cam.updateProjectionMatrix();
    const ppu = settingCam2d(comp).ppu;
    // Rapport RÉEL pixels d'écran par pixel d'art (non entier ici) : le calage du suivi en a
    // besoin pour tomber sur un pixel d'écran, et un `1` le calerait sur un pixel d'art.
    c = {ratio: h / (half * 2 * ppu), heightView: half * 2, widthView: half * 2 * aspect, ppu: ppu};
  }
  if(comp) comp._framing = c;
  return c;
}

/**
 * Déplace le nœud de la caméra pour suivre une cible, bounds et calage compris.
 *
 * Rend `true` si la caméra a bougé — de quoi ne pas travailler pour rien quand il n'y a pas de
 * cible. Sans cible on ne touche PAS la position : une caméra sans suivi est une caméra que
 * l'auteur a placée à la main, et la remettre à l'origine effacerait son travail.
 */
export function applyFollow(node, follow, framing, targetPos){
  const r = follow || {};
  if(!r.targetName || !targetPos) return false;
  const p = follow2d(targetPos, framing.heightView, framing.widthView,
                    {xMin: r.xMin, xMax: r.xMax, yMin: r.yMin, yMax: r.yMax}, r.topOfView);
  if(r.snapPixel){
    const ppu = (framing && framing.ppu) || r.ppu;
    node.position.x = snapOnPixel2d(p.x, ppu, framing.ratio);
    node.position.y = snapOnPixel2d(p.y, ppu, framing.ratio);
  } else {
    node.position.x = p.x;
    node.position.y = p.y;
  }
  return true;
}

/**
 * Les bounds d'un niveau, déduites de ses obstacles.
 *
 * Sans ça il faut taper quatre coordonnées à la main, ce qui demande de lire l'étendue d'une
 * tilemap — donc en pratique personne ne clamped sa caméra, donc elle finit par montrer le vide
 * au-delà du décor. C'est le défaut le plus visible qu'on ait mesuré sur un jeu réel, et il n'a
 * pas d'autre cause qu'un réglage trop pénible à renseigner.
 *
 * Rend `null` s'il n'y a rien : une scène vide n'a pas de bounds, et rendre `{0,0,0,0}` clouerait
 * la caméra à l'origine en donnant l'air d'avoir marché.
 */
export function boundsFromObstacles2d(obstacles){
  if(!obstacles || !obstacles.length) return null;
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for(let i = 0; i < obstacles.length; i++){
    const o = obstacles[i];
    const dl = Number(o.dl) || 0, dh = Number(o.dh) || 0;
    const x = Number(o.x) || 0, y = Number(o.y) || 0;
    if(x - dl < xMin) xMin = x - dl;
    if(x + dl > xMax) xMax = x + dl;
    if(y - dh < yMin) yMin = y - dh;
    if(y + dh > yMax) yMax = y + dh;
  }
  if(!isFinite(xMin) || !isFinite(yMin)) return null;
  return {xMin: xMin, xMax: xMax, yMin: yMin, yMax: yMax};
}

/** Les problèmes d'un réglage de caméra 2D, en clair. */
export function validateCamera2d(setting){
  const p = [];
  if(!setting || typeof setting !== 'object') return ['Le réglage de caméra est vide.'];
  const modes = ['height', 'width', 'fixed'];
  if(modes.indexOf(setting.mode) === -1){
    p.push('Mode de cadrage inconnu : « ' + setting.mode + ' ». Attendu ' + modes.join(', ') + '.');
  }
  if(setting.mode === 'width' && !(Number(setting.widthLevel) > 0)){
    p.push('Le cadrage sur la largeur a besoin de la largeur du niveau, en unités.');
  }
  if(setting.mode === 'fixed' && !(Number(setting.ratio) >= 1)){
    p.push('Le cadrage fixe a besoin d\'un rapport d\'au moins 1.');
  }
  if(setting.suit !== undefined && setting.suit !== null && typeof setting.suit !== 'string'){
    p.push('« Suit » attend le nom d\'un objet.');
  }
  // Des bounds à l'envers ne se voient pas : la caméra reste simplement coincée sur un bord.
  if(clampedData2d(setting.xMin) && clampedData2d(setting.xMax) && setting.xMin > setting.xMax){
    p.push('Les bounds horizontales sont inversées (xMin > xMax) : la caméra restera bloquée.');
  }
  if(clampedData2d(setting.yMin) && clampedData2d(setting.yMax) && setting.yMin > setting.yMax){
    p.push('Les bounds verticales sont inversées (yMin > yMax) : la caméra restera bloquée.');
  }
  // UNE SEULE clamped d'une paire ne clamped rien, et c'est le piège de l'interface : on remplit « X
  // min » puis on s'arrête, la caméra continue de montrer le vide à droite, et le réglage a l'air
  // fait. Le dire est la seule façon de l'apprendre.
  if(clampedData2d(setting.xMin) !== clampedData2d(setting.xMax)){
    p.push('Une seule clamped horizontale sur deux : il faut X min ET X max pour borner un axe.');
  }
  if(clampedData2d(setting.yMin) !== clampedData2d(setting.yMax)){
    p.push('Une seule clamped verticale sur deux : il faut Y min ET Y max pour borner un axe.');
  }
  return p;
}

/**
 * Applique des réglages à une caméra 2D, et rend son état.
 *
 * Sans argument, elle ne fait que LIRE : c'est ce qui permet à un script de sauver le cadrage
 * avant de zoomer, puis de le rendre. Avec un objet, seules les clés fournies sont écrites — un
 * `{ppu: 24}` ne doit pas effacer l'objet suivi ni les bounds du niveau.
 *
 * Le cadrage calculé est INVALIDÉ à chaque écriture. Il est mis en hidden par image, et sans cette
 * remise à zéro un changement de `ppu` ne se verrait qu'au prochain redimensionnement de la
 * fenêtre — c'est-à-dire jamais, en game.
 */
export function setCamera2d(node, settings){
  const cam = cameraSettingOf(node);
  if(!cam) return null;
  const follow = cameraFollowOf(node);
  // LIT/ÉCRIT `cam.data`/`follow.data`, PAS `cam`/`follow` : depuis la migration du composant
  // vers `userData.camera`/`userData.cameraFollow` (docs/REVUE_2026-09-14.md point 10), les
  // champs (`fov`, `xMin`…) sont des accesseurs du PROTOTYPE — `Object.keys(cam)` ne les
  // verrait plus, la donnée RÉELLE vit dans `.data`.
  if(settings && typeof settings === 'object'){
    Object.keys(settings).forEach(function(k){
      if(Object.prototype.hasOwnProperty.call(cam.data, k)) cam.data[k] = settings[k];
      else if(follow && Object.prototype.hasOwnProperty.call(follow.data, k)) follow.data[k] = settings[k];
    });
    // Le cadrage en cache vit sur le COMPOSANT, plus sur userData : un sac parallèle, c'est
    // une seconde vérité, et c'est ce qu'on vient de supprimer partout ailleurs.
    cam._framing = null;
    // La projection est reconstruite : un changement de `orthoSize` ou de projection qui
    // n'atteint pas la caméra three ne se verrait qu'au prochain redimensionnement, donc
    // jamais en jeu.
    if(typeof cam.applyProjection === 'function') cam.applyProjection();
  }
  const out = Object.assign({}, cam.data);
  if(follow){
    ['targetName', 'xMin', 'xMax', 'yMin', 'yMax', 'topOfView', 'snapPixel'].forEach(function(k){
      out[k] = follow.data[k];
    });
  }
  return JSON.parse(JSON.stringify(out));
}

/**
 * La caméra 2D qu'un script doit piloter : la principale, ou à défaut la première venue.
 *
 * Le même choix que fait le moteur au démarrage (`marquee || cams[0]`). En prendre un autre ferait
 * régler une caméra qui n'est pas celle qu'on regarde — un zoom sans effet, et rien pour le dire.
 */
/**
 * « Cette caméra est-elle la principale ? » — LE SEUL ENDROIT QUI RÉPOND À LA QUESTION.
 *
 * Il y avait DEUX stockages pour ce drapeau, et ils ne se parlaient pas. Le composant `Camera`
 * expose `main` (accesseur sur `data.main`, sérialisé dans `components[]`), tandis que
 * l'inspecteur écrivait `userData.game.main` et que le runtime ne lisait QUE ce dernier.
 * Conséquence : cocher « Caméra principale » dans l'inspecteur n'écrivait rien dans le
 * composant, et régler `main` par le composant ou par un script n'avait AUCUN effet sur la
 * caméra choisie au lancement. Ça ne se voyait pas tant qu'une scène n'avait qu'une caméra
 * (le repli `cams[0]` sauvait la mise) — et ça se voyait d'un coup, sans message, dès la
 * deuxième : le jeu filmait depuis la mauvaise.
 *
 * La source est désormais LE COMPOSANT. `userData.game.main` reste lu en repli pour les projets
 * enregistrés avant (component-migration.js le recopie sur le composant à la première
 * ouverture), jamais écrit.
 */
export function isCameraMain(node){
  const c = cameraSettingOf(node);
  if(c && c.main) return true;
  return !!(node && node.userData && node.userData.game && node.userData.game.main);
}

/**
 * Désigne `node` comme caméra principale, et retire le drapeau à toutes les autres caméras de
 * `list`. UNE SEULE principale : deux laisseraient le choix au moteur, qui prendrait la première
 * rencontrée — c'est-à-dire un choix dépendant de l'ordre des objets dans le fichier.
 * L'ancien emplacement est NETTOYÉ au passage, pour qu'un projet migré ne garde pas deux
 * réponses contradictoires.
 */
export function setCameraMain(node, list){
  (list || []).forEach(function(x){
    const c = cameraSettingOf(x);
    if(c) c.main = (x === node);
    if(x && x.userData && x.userData.game) delete x.userData.game.main;
  });
  const c = cameraSettingOf(node);
  if(c) c.main = true;
  if(node && node.userData && node.userData.game) delete node.userData.game.main;
}

export function cameraMain2d(list){
  const cams = (list || []).filter(function(o){
    const c = cameraSettingOf(o);
    return c && c.projection === 'orthographic';
  });
  return cams.find(isCameraMain) || cams[0] || null;
}

/**
 * Les problèmes d'un réglage de SUIVI, en clair. Même règle que `validateCamera2d` pour les
 * bornes : une seule borne d'une paire ne borne rien, et c'est le piège de l'interface.
 */
export function validateCameraFollow(follow){
  if(!follow || typeof follow !== 'object') return [];
  const p = [];
  if(clampedData2d(follow.xMin) && clampedData2d(follow.xMax) && follow.xMin > follow.xMax){
    p.push('Les bornes horizontales sont inversées (xMin > xMax) : la caméra restera bloquée.');
  }
  if(clampedData2d(follow.yMin) && clampedData2d(follow.yMax) && follow.yMin > follow.yMax){
    p.push('Les bornes verticales sont inversées (yMin > yMax) : la caméra restera bloquée.');
  }
  if(clampedData2d(follow.xMin) !== clampedData2d(follow.xMax)){
    p.push('Une seule borne horizontale sur deux : il faut X min ET X max pour borner un axe.');
  }
  if(clampedData2d(follow.yMin) !== clampedData2d(follow.yMax)){
    p.push('Une seule borne verticale sur deux : il faut Y min ET Y max pour borner un axe.');
  }
  return p;
}


// EXPOSÉ EN GLOBALE, à dessein. Ces symboles sont appelés depuis des fichiers
// que les mêmes pages ne chargent pas toutes : un `import` y pointerait un
// fichier absent, et la page ne démarrerait pas. Ils gardent donc leur garde
// `typeof` côté appelant, et se déclarent ici.
globalThis.applyFollow = applyFollow;
globalThis.applyFraming2d = applyFraming2d;
globalThis.frameOrthoCamera = frameOrthoCamera;
globalThis.boundsFromObstacles2d = boundsFromObstacles2d;
globalThis.cameraFollowOf = cameraFollowOf;
globalThis.cameraMain2d = cameraMain2d;
globalThis.cameraSettingOf = cameraSettingOf;
globalThis.framing2d = framing2d;
globalThis.frustum2d = frustum2d;
globalThis.isCameraMain = isCameraMain;
/**
 * LE POINT DE VUE IMPOSÉ PAR LE CADRE DE MESURE (play_and_measure {camera|focus}) :
 * `{position:[x,y,z], target:[x,y,z]}`, posé par l'éditeur sur `window.__measureCamera` du cadre,
 * jamais par le projet. Appliqué par la boucle du jeu APRÈS scripts et Systèmes (qui font suivre la
 * caméra) et avant le rendu, ombres comprises. Sans pose (un jeu normal) : rien.
 */
export function applyMeasureCamera(cam, pose){
  if(!cam || !pose || !Array.isArray(pose.position) || !Array.isArray(pose.target)) return false;
  cam.position.set(pose.position[0], pose.position[1], pose.position[2]);
  cam.lookAt(pose.target[0], pose.target[1], pose.target[2]);
  if(cam.updateMatrixWorld) cam.updateMatrixWorld();
  return true;
}

globalThis.applyMeasureCamera = applyMeasureCamera;
globalThis.setCameraMain = setCameraMain;
globalThis.setCamera2d = setCamera2d;
globalThis.settingCam2d = settingCam2d;
globalThis.validateCamera2d = validateCamera2d;
globalThis.validateCameraFollow = validateCameraFollow;