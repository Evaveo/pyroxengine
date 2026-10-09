// ---------- Sprites 2D : le calcul, sans three et sans DOM ----------
//
// Ce fichier est PUR, et c'est délibéré : tout ce qui décide de l'apparence d'un sprite —
// quelles coordonnées de texture, quelle taille, qui passe devant qui — se calcule ici et
// s'éprouve sans navigateur. Le branchement sur le mixeur de rendu vit ailleurs, et il est
// dupliqué éditeur/runtime ; ce calcul-ci ne l'est jamais.
//
// Partagé : chargé par editor.html, game-preview.html et build-test/index.html, embarqué par
// js/build.js. Une divergence entre ce que l'éditeur montre et ce que le jeu publié affiche ne
// se verrait qu'après export — c'est la famille de défaut la plus coûteuse de ce dépôt.
//
// Voir docs/superpowers/specs/2026-08-16-fondation-2d-design.md.

// ---------- UN SEUL MONDE ----------
//
// Ce fichier portait la séparation stricte 2D / 3D : un espace déclaré sur la racine du monde
// 2D, hérité en remontant les parents, et un refus dans `addComponent`. C'était la règle de
// Godot — deux arbres séparés — et elle a coûté plus qu'elle n'a rendu : des composants qu'on
// ne pouvait pas poser, un reparentage refusé, un dépôt d'asset qui exigeait le bon onglet, et
// des nœuds 2D qui perdaient leur espace dès que la parenté se cassait quelque part.
//
// Il n'y a plus qu'une scène. La 2D est une CONVENTION — le plan XY, une caméra orthographique
// — pas un second monde.
// ---------- Le GENRE d'un projet ----------
//
// DÉRIVÉ DU CONTENU, jamais déclaré. C'est la décision qui compte, et elle répond à la question qui
// tue l'idée d'un format `.p2d` séparé : que devient un projet 2D auquel on ajoute un objet 3D ?
// Avec un genre déclaré, il faudrait refuser l'objet ou mentir sur le genre. Dérivé, le projet
// devient simplement « mixte », et il reste ouvrable — le genre n'est qu'un indice de confort
// (quel tab ouvrir, quel préréglage proposer), jamais une contrainte.
//
// Il travaille sur les objets SÉRIALISÉS, pas sur la scène en mémoire : c'est là qu'on en a besoin,
// au moment d'écrire le manifeste, et c'est aussi la seule forme qu'un projet relu depuis un
// fichier présente avant d'être reconstruit.

/** Les données 2D qui, présentes sur un objet, en font un objet 2D. */
export const MARKERS_2D = ['sprite2d', 'animSprite', 'body2d', 'collider2d',
                      'controller2d'];

/** Les types qui n'existent QU'EN 3D — un sprite, lui, est un groupe porteur de `sprite2d`. */
export const TYPES_3D_ONLY = ['mesh', 'model', 'terrain', 'particles', 'probe',
                        'point', 'spot', 'directional'];

/** Un objet sérialisé porte-t-il une marque de 2D ? */
export function objectIs2d(d){
  if(!d) return false;
  // Les MARQUES 2D seules : ni `space` ni `root2d`, qui ont disparu avec la séparation des
  // deux mondes. Un objet est 2D parce qu'il porte un sprite, une tilemap ou un corps 2D.
  for(let i = 0; i < MARKERS_2D.length; i++) if(d[MARKERS_2D[i]]) return true;
  // La caméra 2D n'est plus un sac `cam2d` mais un composant `Camera` en projection
  // orthographique. Sans cette lecture, une scène qui n'a QUE sa caméra passerait pour 3D, et
  // l'allègement du build retirerait le module de cadrage dont elle a besoin.
  return (d.components || []).some(function(c){
    return c && (c.type === 'Tilemap' || c.type === 'CameraFollow'
      || (c.type === 'Camera' && c.data && c.data.projection === 'orthographic'));
  });
}

/**
 * Le genre d'un projet : `'2d'`, `'3d'` ou `'mixte'`.
 *
 * `scenes` est la liste des scènes sérialisées (`[{donnees: {objets: [...]}}]`), telle que le
 * manifeste la porte.
 *
 * Un projet VIDE rend `'3d'` : c'est le défaut historique de l'éditeur, et sa scène de départ est
 * une scène 3D. Rendre `'mixte'` ou `null` pour un projet empty obligerait chaque lecteur à traiter
 * un troisième cas qui ne veut rien dire.
 */
export function kindProject(scenes){
  let n2d = 0, n3d = 0;
  (scenes || []).forEach(function(s){
    const objects = (s && s.data && s.data.objects) || (s && s.objects) || [];
    objects.forEach(function(d){
      if(objectIs2d(d)){ n2d++; return; }
      // Un objet 3D est un objet d'un TYPE 3D. Un groupe nu ne compte ni d'un côté ni de l'autre :
      // il sert à organiser, et un projet 2D en contient autant qu'un projet 3D. Le compter en 3D
      // rendrait tout projet 2D « mixte », et le genre ne dirait plus rien.
      if(d && TYPES_3D_ONLY.indexOf(d.type) !== -1) n3d++;
    });
  });
  if(n2d && n3d) return 'mixte';
  if(n2d) return '2d';
  return '3d';
}

/**
 * Les coordonnées de texture d'une région, depuis des PIXELS.
 *
 * Une région se décrit comme dans n'importe quel outil d'image : origine en haut à gauche, y
 * vers le bas. Les coordonnées de texture d'OpenGL ont leur origine en bas à gauche, v vers le
 * haut. Le retournement se fait ICI, une seule fois — c'est le piège classique de la découpe
 * de planche, et il donne des sprites à l'envers sans le moindre message.
 *
 * Pas de retrait d'un demi-texel sur les bords : à filtrage au plus proche, caméra alignée sur
 * des pixels entiers et zoom entier — les trois règles de la spec — un texel de bord ne peut
 * pas déborder sur la région voisine. Ce choix DÉPEND donc de ces règles ; les relâcher
 * demanderait de réintroduire un retrait, et le test de netteté est ce qui s'en apercevrait.
 */
export function uvOfRegion(region, widthTex, heightTex){
  const W = Number(widthTex) || 0, H = Number(heightTex) || 0;
  if(!region || !(W > 0) || !(H > 0)) return null;
  const x = Number(region.x) || 0, y = Number(region.y) || 0;
  const l = Number(region.l) || 0, h = Number(region.h) || 0;
  if(!(l > 0) || !(h > 0)) return null;
  return {
    u0: x / W,
    u1: (x + l) / W,
    v0: 1 - (y + h) / H,   // bottom de la région : le y le PLUS GRAND en pixels
    v1: 1 - y / H          // haut de la région
  };
}

/** La taille d'une région dans le monde, en unités. */
export function sizeOfRegion(region, ppu){
  const p = Number(ppu) || 0;
  if(!region || !(p > 0)) return null;
  const l = Number(region.l) || 0, h = Number(region.h) || 0;
  if(!(l > 0) || !(h > 0)) return null;
  return {width: l / p, height: h / p};
}

/**
 * Le décalage à apply au plan pour que le PIVOT tombe sur l'origine du nœud.
 *
 * `pivot` est une fraction de la région, y vers le HAUT : {x:0.5, y:0.5} au centre,
 * {x:0.5, y:0} aux pieds — le repère naturel d'un personnage de plateforme, celui qui fait que
 * poser le personnage sur le sol revient à poser son y sur le sol.
 */
export function offsetOfPivot(region, pivot, ppu){
  const t = sizeOfRegion(region, ppu);
  if(!t) return {x: 0, y: 0};
  const px = (pivot && Number.isFinite(Number(pivot.x))) ? Number(pivot.x) : 0.5;
  const py = (pivot && Number.isFinite(Number(pivot.y))) ? Number(pivot.y) : 0.5;
  return {x: (0.5 - px) * t.width, y: (0.5 - py) * t.height};
}

// Un calque tient 1000 rangs. `order` est borné à ±499 pour qu'il ne puisse pas déborder sur le
// calque voisin : sans cette clamped, un ordre de 1200 sur « Décor » ferait passer le sprite
// devant tout « Jeu », sans erreur et sans que rien dans l'interface ne le laisse deviner.
export const SPRITE_RANKS_BY_LAYER = 1000;
export const SPRITE_ORDER_MAX = 499;

/**
 * Le rang de rendu d'un sprite. Plus grand = plus près de la caméra.
 *
 * L'ordre est AUTEUR, pas déduit de la profondeur : c'est ce qui distingue un vrai moteur 2D
 * d'un moteur 3D avec une caméra verrouillée. La position en Z n'entre pas dans ce calcul, et
 * un test le prouve en la faisant varier sans effet.
 *
 * La partie fractionnaire départage deux sprites du même calque au même ordre, par ordre de
 * CRÉATION — le dernier créé pass devant. Sans elle, deux sprites à égalité seraient départagés
 * par le tri interne du moteur de rendu, et pourraient s'inverser d'un rechargement à l'autre.
 */
export function orderOfSort(layers, layer, order, idNode){
  const list = Array.isArray(layers) ? layers : [];
  let i = list.indexOf(layer);
  if(i === -1) i = 0;                       // calque inconnu : le fond, jamais devant tout
  const raw = Number(order) || 0;
  const clamped = Math.max(-SPRITE_ORDER_MAX, Math.min(SPRITE_ORDER_MAX, Math.round(raw)));
  const departage = Math.min(0.999, Math.max(0, Number(idNode) || 0) * 1e-6);
  return i * SPRITE_RANKS_BY_LAYER + clamped + departage;
}

// Combien de rangs par unité de monde quand le tri suit la profondeur. Huit donne un huitième
// d'unité de résolution — plus fin que ce que l'œil distingue — tout en laissant ±62 unités de
// portée avant saturation, soit largement la hauteur d'une salle.
export const SPRITE_RANKS_BY_UNIT = 8;

/**
 * L'ordre de tri déduit de la PROFONDEUR, pour un monde vu de dessus.
 *
 * C'est ce qui permet à un personnage de passer DERRIÈRE un arbre quand il est plus haut, et
 * DEVANT quand il est plus bas. Sans lui l'ordre est figé à la création : le héros est
 * éternellement devant ou éternellement derrière, et ce genre de jeu ne peut pas exister.
 *
 * PLUS BAS = PLUS PRÈS, donc l'ordre est l'opposé de Y. C'est la convention de tous les jeux vus
 * de dessus, et elle vient d'une observation simple : ce qui est plus bas à l'écran est plus près
 * du spectateur.
 *
 * L'ordre SATURE au lieu de déborder. Au-delà de la portée deux objets gardent le même rang, ce
 * qui est sans conséquence — deux objets séparés de soixante unités ne se recouvrent pas — alors
 * qu'un débordement les ferait passer devant le calque voisin, sans erreur et sans que rien dans
 * l'interface ne le laisse deviner. C'est déjà la raison de la clamped sur `order`.
 */
export function orderDepth2d(yBottom){
  const y = Number(yBottom);
  if(!isFinite(y)) return 0;
  const rank = Math.round(-y * SPRITE_RANKS_BY_UNIT);
  return Math.max(-SPRITE_ORDER_MAX, Math.min(SPRITE_ORDER_MAX, rank));
}

/**
 * Le BAS d'un nœud 2D, en coordonnées de monde : c'est sur lui que se fait le tri.
 *
 * On trie sur les pieds et non sur le centre. Deux personnages de tailles différentes qui se
 * croisent doivent se départager sur le sol qu'ils occupent : trié au centre, un grand
 * personnage passerait derrière un petit dont les pieds sont pourtant plus haut à l'écran.
 *
 * Le collider prime sur la taille dessinée quand il y en a un — c'est lui qui dit où le
 * personnage POSE LES PIEDS, alors qu'un sprite porte souvent du vide au-dessus de la tête.
 */
export function bottomForSort2d(node, bottomLocal){
  if(!node || !node.position) return 0;
  const c = node.userData && node.userData.collider2d;
  if(c) return node.position.y + (c.dy || 0) - Math.max(0.001, (c.h || 1) / 2);
  const b = Number(bottomLocal);
  return node.position.y + (isFinite(b) ? b : 0);
}

/** Le bottom d'un sprite dans son repère local — pivot compris. Calculé une fois, à la construction. */
export function bottomLocalSprite(region, ppu, pivot){
  const t = sizeOfRegion(region, ppu);
  if(!t) return 0;
  const d = offsetOfPivot(region, pivot, ppu);
  return -t.height / 2 + ((d && d.y) || 0);
}

/**
 * Recalcule l'ordre de rendu des sprites triés par profondeur. Appelé À CHAQUE IMAGE.
 *
 * Seuls les sprites qui le demandent sont touchés : un décor de fond n'a aucune raison de payer
 * ce calcul, et surtout aucune raison de passer devant le héros parce qu'il est plus bas.
 *
 * La liste des calques est passée en argument plutôt que cherchée dans le global : l'éditeur et
 * le jeu publié la tiennent chacun de leur côté, et c'est ce qui permet à cette fonction d'être
 * la même des deux côtés.
 */
export function updateSortDepth2d(nodes, layers){
  let n = 0;
  // LES PORTEURS DE SPRITE, PAS LA SCÈNE ENTIÈRE. Même raison que `gatherWorld2d` : ce parcours
  // tournait sur les 5 000 objets d'une scène 3D à chaque image pour n'y trouver personne.
  // Sans registre (harnais de test), on retombe sur la liste complète.
  const candidates = (typeof Registry !== 'undefined' && Registry.nodesCarrying)
    ? Registry.nodesCarrying(nodes, ['SpriteRenderer', 'SpriteAnimator'])
    : (nodes || []);
  candidates.forEach(function(o){
    const d = o && o.userData && o.userData.sprite2d;
    if(!d || !d.sortDepth) return;
    const m = o.userData._meshSprite;
    if(!m) return;
    const bottom = bottomForSort2d(o, m.userData ? m.userData._bottomLocal : 0);
    m.renderOrder = orderOfSort(layers, d.layer, orderDepth2d(bottom), o.id);
    n++;
  });
  return n;
}

/** Une région par son nom, ou la première. Null si le sprite n'en a aucune. */
export function regionOfSprite(sprite, name){
  const regions = (sprite && sprite.regions) || [];
  if(!regions.length) return null;
  if(!name) return regions[0];
  return regions.find(function(r){ return r && r.name === name; }) || regions[0];
}

/**
 * Le `ppu` proposé à l'import, d'après la taille de la texture.
 *
 * 100 est la valeur d'usage pour une illustration ; sur une texture de moins de 128 px c'est du
 * pixel-art, et 100 y donnerait un sprite de 16 px large de 0,16 unité — invisible à côté d'un
 * cube de 1. Ce n'est qu'une PROPOSITION : le réglage d'import reste modifiable.
 */
export function ppuByDefault(widthTex, heightTex){
  const grand = Math.max(Number(widthTex) || 0, Number(heightTex) || 0);
  return (grand > 0 && grand < 128) ? 16 : 100;
}

/**
 * Les sprites dont le `ppu` diffère de celui d'une caméra pixel-perfect.
 *
 * La règle de la Pixel Perfect Camera d'Unity : « Assets Pixels Per Unit » doit valoir le PPU de
 * TOUS les sprites. Sinon un pixel d'art couvre un nombre fractionnaire de pixels d'écran — un
 * sprite importé à 16 (pixel-art, `ppuByDefault`) sous une caméra à 100 en couvre 6,25 — et le
 * rendu frémit ou bave, sans erreur. `sprites` : les assets `kind:'sprite'` à comparer.
 */
export function spritesOffPpu(ppu, sprites){
  const p = Number(ppu) || 0;
  return (sprites || []).filter(function(s){
    return s && Number(s.ppu) > 0 && Number(s.ppu) !== p;
  });
}

/**
 * Les dimensions en pixels d'une texture d'asset, quelle que soit sa provenance.
 *
 * Une texture IMPORTÉE n'a ni `template` ni `image` : `TextureLoader` est asynchrone et ne pose
 * que `imageSource` et `dimensionsSource`. Les cinq points qui lisaient `template || image`
 * rendaient donc 0 × 0 sur toute planche venue d'un fichier — un sprite à zéro région et à ppu 100,
 * un « Découper » qui ne produit rien, un « Fusionner » qui sort sans rien faire, une section
 * d'inspecteur qui annonce 0 × 0, et un `slice_sheet` qui refuse en citant « 0 × 0 px ».
 * Autrement dit tout le flux planche, mort pour un import, et vivant seulement pour les textures
 * fabriquées par le moteur — qui contournaient le problème en passant les dimensions à la main.
 *
 * L'ordre des sources n'est pas indifférent : `template` d'abord, parce qu'un asset relu d'un
 * project le porte, puis les formes vivantes du navigateur, et `dimensionsSource` en dernier — c'est
 * le seul qui survit sans image décodée, mais c'est aussi le seul qui puisse être périmé.
 */
export function dimensionsTexture(tex){
  if(!tex) return {l: 0, h: 0};
  const src = imageTexture(tex);
  const l = src && (src.width || src.naturalWidth);
  const h = src && (src.height || src.naturalHeight);
  if(l > 0 && h > 0) return {l: l, h: h};
  const d = tex.dimensionsSource;
  return {l: (d && Number(d[0])) || 0, h: (d && Number(d[1])) || 0};
}

/**
 * L'image dessinable d'une texture — la même chaîne de sources que `dimensionsTexture`, et
 * dans le même ordre, pour qu'une vignette montre exactement ce que les dimensions mesurent.
 */
export function imageTexture(tex){
  if(!tex) return null;
  return tex.template || tex.image || tex.imageSource || (tex.texture && tex.texture.image) || null;
}

/**
 * Découpe une planche en grille. `opts` : {marge, espacement, prefixe}.
 *
 * Lecture de gauche à droite puis de haut en bas, comme une planche s'écrit. Une cellule qui
 * dépasserait du bord est ABANDONNÉE plutôt que rognée : une demi-image dans un atlas est un
 * défaut qu'on ne remarque qu'à l'animation.
 */
export function sliceGrid(widthTex, heightTex, l, h, opts){
  const o = opts || {};
  const W = Number(widthTex) || 0, H = Number(heightTex) || 0;
  const cl = Number(l) || 0, ch = Number(h) || 0;
  if(!(W > 0) || !(H > 0) || !(cl > 0) || !(ch > 0)) return [];
  // `margin` est le nom de l'appelant moderne (outils du copilote) ; `marge` reste lu pour les
  // anciens appelants. Ne lire que `marge` faisait ignorer la marge passée par slice_sheet.
  const marge = Math.max(0, Number(o.margin !== undefined ? o.margin : o.marge) || 0);
  const esp = Math.max(0, Number(o.spacing) || 0);
  const prefixe = o.prefixe || 'img';
  const regions = [];
  let n = 0;
  for(let y = marge; y + ch <= H; y += ch + esp){
    for(let x = marge; x + cl <= W; x += cl + esp){
      regions.push({name: prefixe + '_' + n, x: x, y: y, l: cl, h: ch});
      n++;
    }
  }
  return regions;
}

/**
 * Le rapport pixels écran / pixels de sprite, et s'il est entier.
 *
 * Un rapport non entier casse la netteté : un texel s'étale sur 2,5 pixels écran, donc sur 2 ou
 * 3 selon l'endroit, et les colonnes du sprite n'ont plus la même largeur. L'espace de travail
 * l'affiche et le signale plutôt que de laisser chercher pourquoi « c'est un peu sale ».
 */
export function ratioPixel(heightEcranPx, heightViewUnits, ppu){
  const e = Number(heightEcranPx) || 0, u = Number(heightViewUnits) || 0, p = Number(ppu) || 0;
  if(!(e > 0) || !(u > 0) || !(p > 0)) return {ratio: 0, entier: false};
  const r = e / (u * p);
  return {ratio: r, entier: Math.abs(r - Math.round(r)) < 1e-9};
}

// ---------- La maille d'un sprite ----------
//
// Ces trois fonctions prennent `T` — l'espace de noms de three — EN ARGUMENT, au lieu de lire
// le global. Le module reste ainsi chargeable et éprouvable sans moteur de rendu, et surtout la
// construction n'existe qu'à UN exemplaire : l'éditeur et le jeu publié appellent les mêmes.
// Les recopier de chaque côté était la solution évidente, et c'est précisément la famille de
// défaut la plus coûteuse de ce dépôt — une divergence qui ne se voit qu'après export.

/**
 * Le plan d'une région, à la bonne taille, avec le pivot ramené sur l'origine.
 *
 * Le décalage est cuit dans la GÉOMÉTRIE et non posé sur la maille : sans quoi il faudrait le
 * défaire à chaque lecture de la position du nœud, et un script qui lit `objet.position`
 * obtiendrait autre chose que ce que l'inspecteur shown.
 */
export function geometrySprite(T, region, ppu, pivot){
  const t = sizeOfRegion(region, ppu);
  if(!t) return null;
  const g = new T.PlaneGeometry(t.width, t.height);
  const d = offsetOfPivot(region, pivot, ppu);
  if(d.x || d.y) g.translate(d.x, d.y, 0);
  return g;
}

/**
 * Pose les coordonnées de texture d'une région sur un plan.
 *
 * L'ordre des sommets d'un `PlaneGeometry` est : haut-gauche, haut-droit, bottom-gauche,
 * bottom-droit. Se tromper d'ordre donne un sprite en diagonale ou en miroir — visible, mais on
 * cherche du côté de la découpe plutôt que de celui du plan.
 *
 * Les retournements échangent les BORNES, ils ne mettent pas d'échelle négative sur le nœud :
 * une échelle négative casse les normales et se propage à toute la descendance.
 */
export function applyUvSprite(geometry, uv, retourneX, retourneY){
  if(!geometry || !uv || !geometry.attributes || !geometry.attributes.uv) return false;
  const u0 = retourneX ? uv.u1 : uv.u0, u1 = retourneX ? uv.u0 : uv.u1;
  const v0 = retourneY ? uv.v1 : uv.v0, v1 = retourneY ? uv.v0 : uv.v1;
  const a = geometry.attributes.uv;
  a.setXY(0, u0, v1);
  a.setXY(1, u1, v1);
  a.setXY(2, u0, v0);
  a.setXY(3, u1, v0);
  a.needsUpdate = true;
  return true;
}

/**
 * Le matériau d'un sprite.
 *
 * `depthTest` et `depthWrite` désactivés, et c'est LE point : en 2D l'ordre d'affichage est
 * décidé par `renderOrder`, pas par la profondeur. Les laisser actifs rendrait la position en Z
 * décisive et ferait clignoter les sprites les uns derrière les autres — le défaut classique de
 * tout moteur 3D qui « fait aussi de la 2D ».
 */
export function materialSprite(T, texture, teinte, near){
  if(texture && near){
    texture.magFilter = T.NearestFilter;
    texture.minFilter = T.NearestFilter;
    texture.generateMipmaps = false;
    // Image pas encore décodée (import en cours) : la marquer ferait planter WebGPU, et le
    // chargeur la marquera de toute façon à l'arrivée — avec ces filtres-là.
    if(texture.image && texture.image.complete !== false) texture.needsUpdate = true;
  }
  return new T.MeshBasicMaterial({
    map: texture || null,
    color: (teinte === undefined || teinte === null) ? 0xffffff : teinte,
    transparent: true,
    alphaTest: 0.001,          // les pixels franchement vides ne s'écrivent pas du tout
    depthTest: false,
    depthWrite: false,
    side: T.DoubleSide         // un sprite retourné reste visible
  });
}

/**
 * Les problèmes d'un sprite, en clair.
 *
 * Même rôle que `validateAnimator` : un sprite mal réglé n'a rien d'une erreur — il s'shown,
 * simplement pas comme prévu, et on cherche longtemps. `texturesConnues` permet de vérifier que
 * la texture citée existe encore dans le projet.
 */
export function validateSprite(sprite, texturesConnues){
  const p = [];
  if(!sprite || typeof sprite !== 'object') return ['Le sprite est vide ou illisible.'];
  if(!sprite.textureId) p.push('Aucune texture : ce sprite n\'a rien à afficher.');
  else if(texturesConnues && texturesConnues.indexOf(sprite.textureId) === -1){
    p.push('La texture de ce sprite n\'existe plus dans le projet.');
  }
  if(!(Number(sprite.ppu) > 0)) p.push('Les pixels par unité doivent être un nombre positif.');

  const regions = sprite.regions || [];
  if(!regions.length) p.push('Aucune région découpée : le sprite n\'a aucune image.');
  const vus = new Set();
  regions.forEach(function(r, i){
    const ou = 'La région n°' + (i + 1);
    if(!r || !r.name){ p.push(ou + ' n\'a pas de nom.'); return; }
    // Deux régions homonymes : `regionOfSprite` rend toujours la première, donc la seconde est
    // inatteignable — et un composant qui la désigne shown silencieusement l'autre image.
    if(vus.has(r.name)) p.push('Deux régions s\'appellent « ' + r.name + ' » : la seconde ne '
      + 'pourra jamais être désignée.');
    vus.add(r.name);
    if(!(Number(r.l) > 0) || !(Number(r.h) > 0)){
      p.push('La région « ' + r.name + ' » est vide (largeur ou hauteur nulle).');
    }
  });

  const pv = sprite.pivot;
  if(pv && (!(Number(pv.x) >= 0 && Number(pv.x) <= 1) || !(Number(pv.y) >= 0 && Number(pv.y) <= 1))){
    p.push('Le pivot sort de la région : ses deux valeurs doivent être entre 0 et 1.');
  }
  return p;
}


// EXPOSÉ EN GLOBALE, à dessein. Ces symboles sont appelés depuis des fichiers
// que les mêmes pages ne chargent pas toutes : un `import` y pointerait un
// fichier absent, et la page ne démarrerait pas. Ils gardent donc leur garde
// `typeof` côté appelant, et se déclarent ici.
globalThis.applyUvSprite = applyUvSprite;
globalThis.bottomLocalSprite = bottomLocalSprite;
globalThis.dimensionsTexture = dimensionsTexture;
globalThis.imageTexture = imageTexture;
globalThis.geometrySprite = geometrySprite;
globalThis.kindProject = kindProject;
globalThis.materialSprite = materialSprite;
globalThis.orderOfSort = orderOfSort;
globalThis.ppuByDefault = ppuByDefault;
globalThis.spritesOffPpu = spritesOffPpu;
globalThis.ratioPixel = ratioPixel;
globalThis.regionOfSprite = regionOfSprite;
globalThis.sliceGrid = sliceGrid;
globalThis.updateSortDepth2d = updateSortDepth2d;
globalThis.uvOfRegion = uvOfRegion;
globalThis.validateSprite = validateSprite;