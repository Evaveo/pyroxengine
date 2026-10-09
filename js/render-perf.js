// ---------- Instanciation automatique du décor ----------
// Deux cents arbres identiques, c'est deux cents appels de dessin. Le GPU s'en moque,
// le pilote non : c'est le premier plafond qu'une scène dense rencontre, bien avant le
// nombre de triangles. Un `InstancedMesh` les rend en UN appel.
//
// LE CHOIX DE CONCEPTION. On aurait pu demander à l'utilisateur de marquer ses objets
// comme instanciables. On ne le fait pas : personne ne pense à cocher une case sur
// deux cents arbres, et un gain de performance qui demande du travail manuel n'est pas
// pris. Le regroupement est donc AUTOMATIQUE, à l'entrée du mode lecture.
//
// L'AUTOMATISME EXIGE UN FILET. Un objet regroupé peut être déplacé par un script, caché,
// ou détruit — et il n'est plus dessiné par lui-même. Plutôt que d'exclure par avance tout
// ce qui pourrait move (ce qui ne laisserait presque rien), chaque lot est RESYNCHRONISÉ
// à chaque image : on compare la matrice monde de la source à celle qu'on a écrite, et on
// ne réécrit que ce qui a changé. Comparer seize flottants coûte infiniment moins qu'un
// appel de dessin, et le lot reste juste quoi qu'il arrive.
//
// LE REGROUPEMENT TOURNE AUSSI EN ÉDITION depuis la v0.160.0. Il n'a longtemps vécu que
// pendant la lecture — « en édition, chaque objet reste lui-même, on doit pouvoir le
// sélectionner, le déplacer, voir son gizmo » —, mais le mode lecture en page a disparu et la
// garde `modeGame.active` de js/viewport.js n'est jamais devenue vraie : ce fichier était donc
// du code mort dans l'outil où l'on passe ses journées, pour 341 appels de dessin et 11,69 ms
// par image sur un décor de 5 000 objets.
//
// Ce qui rend l'édition compatible avec le regroupement tient en trois pièces, toutes plus bas :
//   · `visibleIntent()` — `visible = false` sur une source regroupée n'est PAS un masquage, et
//     tout ce qui décrit ou enregistre un objet doit lire l'intention ;
//   · `setVisibleIntent()` — et tout ce qui MASQUE doit l'écrire, sous peine de ne rien faire ;
//   · `detachFromBatch()` — l'objet qu'on manipule sort de son lot pour un appel de dessin, sans
//     qu'aucun lot ne soit reconstruit.
// La politique (quand refaire les lots, ce qui n'y entre jamais) vit dans js/editor-batching.js.
//
// MODULE PARTAGÉ entre l'éditeur et le jeu publié, comme jeu-ui.js et jeu-character.js. Il ne
// suppose donc aucun global : la scène et la liste d'objets lui sont PASSÉES, parce que
// l'éditeur les nomme `scene`/`objects` et le runtime `game.scene`/`game.objets`. Deux
// implémentations auraient fini par diverger — c'est exactement ce qui est arrivé au
// masque combiné, dont le runtime convertissait encore ce que l'éditeur ne convertissait
// plus.

// En dessous, le gain ne paie pas le coût de gestion du lot.
export const THRESHOLD_INSTANCES = 8;

export const engineInstances = {
  lots: [],          // {mesh, sources:[], matrices:[Float32Array(16)], zero:bool}
  active: false
};

// Un objet est regroupable s'il est un maillage simple dont l'apparence ne dépend que de
// sa géométrie et de son matériau. Tout ce qui porte sa propre logique de rendu (enfants,
// particules, sonde, terrain) est laissé de côté — pas par prudence excessive, mais parce
// qu'un InstancedMesh ne saurait pas le représenter.
export function instantiable(o){
  if(!o || !o.isMesh || !o.geometry || !o.material) return false;
  if(Array.isArray(o.material)) return false;           // multi-matériaux : plusieurs lots par objet
  if(o.children && o.children.length) return false;     // les enfants ne suivraient pas
  if(o.getComponent && (o.getComponent('Reflection') || o.getComponent('Terrain'))) return false;
  if(o.userData.particles || o.userData.subScene) return false;
  if(o.isSkinnedMesh || (o.geometry.morphAttributes
      && Object.keys(o.geometry.morphAttributes).length)) return false;
  // Gizmos et icônes : n'existent que dans l'éditeur, d'où le test d'existence.
  if(typeof isIconEdit === 'function' && isIconEdit(o)) return false;
  // Un objet SCRIPTÉ est laissé de côté, et c'est le seul compromis de tout ce fichier.
  // Un lot n'a qu'un matériau — celui du premier — alors qu'en édition chaque copie a le
  // sien. Tant que rien ne le modifie en cours de partie, c'est invisible ; un script qui
  // écrirait `api.me.material.color` teindrait en revanche toutes ses jumelles d'un coup.
  // Le déplacement, lui, est géré (updateInstances resynchronise), mais on ne peut pas
  // surveiller la mutation d'un matériau sans recalculer sa signature à chaque image.
  // On perd le regroupement des pièces qui tournent ; on ne perd pas la correction.
  if(o.userData.scripts && o.userData.scripts.length) return false;
  return true;
}

// Le matériau se compare par son CONTENU, pas par son identité. Dupliquer un objet dans
// l'éditeur partage sa géométrie mais lui donne un matériau à lui — pour qu'on puisse le
// modifier sans toucher l'original. Deux cents caisses copiées-collées ont donc deux
// cents matériaux distincts et strictement identiques : regrouper sur l'uuid ne trouvait
// rien, ce qui est précisément le cas d'usage que tout ceci aims.
export function signatureMaterial(o){
  if(o.userData.materialId) return 'asset:' + o.userData.materialId;   // même asset = même apparence
  const m = o.material;
  // UN MATÉRIAU À NŒUDS NE SE COMPARE PAS PAR SES SCALAIRES. Tout ce que la signature lit
  // plus bas (color, roughness, metalness, maps…) reste à sa valeur par défaut sur un
  // MeshStandard/PhysicalNodeMaterial construit depuis un graphe de shader : l'apparence vit
  // dans colorNode/roughnessNode/… Deux graphes totalement différents rendaient donc la MÊME
  // signature, et les objets partaient dans le même lot — un InstancedMesh n'a qu'un matériau,
  // celui du premier. Symptôme mesuré : les neuf sphères « Lit physical » d'une scène toutes
  // identiques dans le jeu publié (verre, velours, eau, lave…), et seulement là, puisque
  // l'éditeur ne regroupe pas. Deux matériaux à nœuds ne se regroupent donc QUE par leur
  // asset (branche ci-dessus, où l'égalité est vraiment garantie), jamais par leur contenu.
  // `isNodeMaterial` est la marque que three.js pose lui-même sur ces matériaux : un test,
  // pas un balayage de toutes les propriétés du matériau à chaque reconstruction des lots.
  // (Le repli sur les `*Node` reste pour un matériau standard auquel on aurait greffé un
  // nœud à la main — l'apparence vient alors du nœud, invisible pour la suite.)
  if(m && m.isNodeMaterial) return 'node:' + m.uuid;
  if(m.colorNode || m.roughnessNode || m.metalnessNode || m.emissiveNode
     || m.normalNode || m.opacityNode || m.positionNode || m.fragmentNode){
    return 'node:' + m.uuid;
  }
  const tex = function(t){ return t ? t.uuid : ''; };
  // ÉMISSIF : on lit `emissiveBase`, la valeur d'auteur, et non `m.emissive`, la valeur
  // affichée. Sélectionner un objet le surligne en écrivant dans son émissif ; sans cette
  // distinction, l'objet sélectionné au moment du lancement sortait de son lot — et
  // toujours un seul, ce qui est exactement le genre d'anomalie qu'on ne remarque pas.
  return [m.type, m.color && m.color.getHex(), m.roughness, m.metalness,
          (o.userData.emissiveBase || 0), m.opacity, m.transparent, m.side,
          m.flatShading, m.wireframe, m.bumpScale, m.displacementScale,
          m.normalScale && m.normalScale.x, m.normalScale && m.normalScale.y,
          tex(m.map), tex(m.normalMap), tex(m.roughnessMap), tex(m.metalnessMap),
          tex(m.aoMap), tex(m.emissiveMap), tex(m.bumpMap), tex(m.displacementMap)].join('|');
}

// La géométrie se compare elle aussi par son CONTENU quand elle en a un. Dans l'éditeur,
// dupliquer un objet partage la géométrie — l'uuid suffisait. Le jeu publié, lui,
// RECONSTRUIT chaque objet depuis les données : douze cubes identiques y ont douze
// géométries distinctes, aucun groupe n'atteignait le seuil, et le regroupement ne
// faisait donc RIEN dans les builds. Il paraissait marcher parce que l'éditeur, lui,
// regroupait bien.
//
// `parameters` n'existe que sur les géométries paramétriques de three (Box, Sphere…).
// Un maillage importé n'en a pas : on retombe sur l'uuid, ce qui est correct puisque
// les copies d'un même modèle partagent leur géométrie par référence.
export function signatureGeometry(g){
  return g.parameters ? (g.type + ':' + JSON.stringify(g.parameters)) : g.uuid;
}

export function keyBatch(o){
  // Le calque count : deux objets identiques sur deux calques différents peuvent être
  // filtrés séparément par le masque d'une caméra. Les mélanger ferait apparaître un
  // objet que la caméra devait ignorer.
  const layer = (o.userData.game && typeof o.userData.game.layer === 'number') ? o.userData.game.layer : 0;
  return signatureGeometry(o.geometry) + '|' + signatureMaterial(o) + '|' + layer
    + '|' + (o.castShadow !== false) + '|' + (o.receiveShadow !== false);
}

// LA TAILLE VISÉE D'UNE CELLULE, en unités de monde. C'est ce qui décide de l'efficacité de
// l'élimination : une cellule plus large que ce que la caméra embrasse ne sera jamais écartée.
// 40 est l'ordre de grandeur de ce qu'une caméra d'éditeur cadre à distance de travail.
export const CELL_SIZE = 40;
// Le plancher de peuplement d'une cellule. Découper plus fin donnerait des lots étiques :
// l'instanciation ne paie qu'à partir de quelques dizaines de copies, et chaque lot coûte un
// appel de dessin de plus le jour où l'on cadre le niveau entier.
export const CELL_MIN_INSTANCES = 32;
// LE PLAFOND DE LOTS POUR TOUT LE DÉCOR, et c'est le garde-fou qui compte.
//
// Sans lui, le découpage se multiplie par le nombre d'APPARENCES : seize groupes découpés en
// neuf cellules font cent quarante-quatre lots, donc cent quarante-quatre appels de dessin dès
// qu'on cadre le niveau entier. Mesuré dans l'éditeur sur un décor de 5 000 objets : 52 appels
// sans découpage, 159 avec. L'élimination ne rattrape pas ça quand on voit tout.
//
// Le budget est donc RÉPARTI entre les groupes : on découpe autant que le plafond le permet, et
// pas plus. Le décor batché ne peut ainsi jamais coûter plus de LOTS_MAX appels de dessin,
// quelle que soit la scène — et dans cette limite, les cellules sont aussi locales que possible.
export const LOTS_MAX = 64;
// Garde-fou par axe, quel que soit le budget.
export const CELLS_MAX = 16;

/**
 * Découpe un groupe d'objets identiques en CELLULES SPATIALES, pour que chaque lot ait une
 * boîte englobante locale et puisse être écarté du rendu quand on ne le regarde pas.
 *
 * ---------- LA TENSION, ET COMMENT ELLE EST ARBITRÉE ----------
 *
 * L'instanciation veut de GROS lots — un seul appel de dessin pour tout le décor. L'élimination
 * par le champ de vision veut de PETITS lots — sinon la boîte englobante couvre le niveau et
 * rien ne peut être écarté. Les deux tirent en sens contraire, et le découpage est le point
 * d'équilibre.
 *
 * Il est donc borné par les DEUX bouts, et pas seulement par le nombre d'objets :
 *   · par la TAILLE des cellules (`CELL_SIZE`), sans quoi un groupe très nombreux mais serré —
 *     une forêt de cinq mille arbres sur vingt mètres — se ferait découper en quatre-vingts
 *     lots dont aucun ne serait jamais éliminé, puisqu'on les voit tous à la fois ;
 *   · par leur PEUPLEMENT (`CELL_MIN_INSTANCES`), sans quoi un groupe étalé se ferait découper
 *     en cellules d'une poignée d'objets, et l'on aurait remplacé un appel de dessin par cent.
 *
 * Un groupe qui n'a besoin d'aucun des deux est rendu tel quel, en une seule cellule.
 *
 * Le découpage se fait sur X et Z, pas sur Y : un décor est étalé au sol et haut de quelques
 * mètres. Découper en hauteur multiplierait les lots sans rien éliminer de plus.
 */
export function cellsOfGroup(list, cellsBudget){
  const n = list.length;
  // Le budget d'axes que ce groupe a le droit de consommer, réparti par `instantiateStatic`.
  const plafond = Math.max(1, Math.min(CELLS_MAX, Math.floor(cellsBudget || CELLS_MAX)));
  if(plafond <= 1) return [list];

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for(let i = 0; i < n; i++){
    const o = list[i];
    o.updateWorldMatrix(true, false);
    const e = o.matrixWorld.elements, x = e[12], z = e[14];
    if(x < minX) minX = x; if(x > maxX) maxX = x;
    if(z < minZ) minZ = z; if(z > maxZ) maxZ = z;
  }
  const spanX = maxX - minX, spanZ = maxZ - minZ;

  const parTaille = Math.floor(Math.max(spanX, spanZ) / CELL_SIZE);
  const parPeuplement = Math.floor(Math.sqrt(n / CELL_MIN_INSTANCES));
  const cells = Math.min(plafond, parTaille, parPeuplement);
  // Un groupe sans étendue (tout au même endroit) n'a rien à découper non plus.
  if(cells <= 1 || (!(spanX > 0) && !(spanZ > 0))) return [list];

  const cellules = new Map();
  for(let i = 0; i < n; i++){
    const e = list[i].matrixWorld.elements;
    const ix = (spanX > 0) ? Math.min(cells - 1, Math.floor((e[12] - minX) / spanX * cells)) : 0;
    const iz = (spanZ > 0) ? Math.min(cells - 1, Math.floor((e[14] - minZ) / spanZ * cells)) : 0;
    const cle = ix * cells + iz;
    let c = cellules.get(cle);
    if(!c){ c = []; cellules.set(cle, c); }
    c.push(list[i]);
  }
  return Array.from(cellules.values());
}

export function instantiateStatic(scn, objectsScene){
  undoInstances();
  const groupes = new Map();
  objectsScene.forEach(function(o){
    if(!instantiable(o)) return;
    const c = keyBatch(o);
    if(!groupes.has(c)) groupes.set(c, []);
    groupes.get(c).push(o);
  });

  // LE BUDGET DE DÉCOUPAGE, RÉPARTI ENTRE LES GROUPES. Le découpage spatial se multiplie par le
  // nombre d'apparences : sans répartition, seize groupes de caisses différentes font seize fois
  // plus de lots qu'un seul. On décide donc d'abord combien de groupes vont être regroupés, puis
  // combien de cellules chacun a le droit de se tailler — voir LOTS_MAX.
  let nGroupes = 0;
  groupes.forEach(function(g){ if(g.length >= THRESHOLD_INSTANCES) nGroupes++; });
  const cellsBudget = nGroupes ? Math.floor(Math.sqrt(LOTS_MAX / nGroupes)) : 1;

  groupes.forEach(function(groupe){
    if(groupe.length < THRESHOLD_INSTANCES) return;
    cellsOfGroup(groupe, cellsBudget).forEach(function(list){
    // Une cellule trop peu peuplée ne vaut pas un lot : ses objets restent visibles et se
    // dessinent chacun pour soi, exactement comme avant le regroupement.
    if(list.length < THRESHOLD_INSTANCES) return;
    const model = list[0];
    const im = new THREE.InstancedMesh(model.geometry, model.material, list.length);
    im.castShadow = model.castShadow !== false;
    im.receiveShadow = model.receiveShadow !== false;
    im.layers.mask = model.layers.mask;
    // LE LOT EST ÉLIMINABLE PAR LE CHAMP DE VISION, parce qu'il est LOCAL.
    //
    // Il ne l'était pas, et la raison tenait en une ligne : « la boîte englobante d'un lot
    // couvre toute la scène ». C'était vrai tant qu'un lot rassemblait toutes les caisses du
    // niveau — et ça coûtait cher : l'éditeur soumettait 2,0 millions de triangles par image
    // au lieu de 124 000, tout le décor étant dessiné, y compris derrière la caméra.
    //
    // `cellsOfGroup` découpe chaque groupe par secteur : la boîte d'un lot ne couvre plus
    // qu'une cellule, et three peut l'écarter. La sphère englobante suit les instances —
    // recalculée par `updateInstances` dès que l'une d'elles bouge, sinon le décor
    // disparaîtrait en tournant la caméra.
    im.frustumCulled = true;
    im.userData.instancesEngine = true;

    const matrices = [];
    list.forEach(function(o, i){
      o.updateWorldMatrix(true, false);
      const m = o.matrixWorld.clone();
      im.setMatrixAt(i, m);
      matrices.push(m.elements.slice());
      // LA SOURCE EST MARQUÉE, et pas seulement masquée : masquée parce que REGROUPÉE, pas
      // parce qu'absente. `visible = false` dit au rendu « ne dessine pas » ; le reste du
      // moteur lit ce même champ pour savoir ce que la PERSONNE a demandé, et les deux ne
      // veulent plus dire la même chose.
      //
      // DEUX BESOINS SONT ARRIVÉS PAR DEUX CHEMINS, et ils portent la même marque :
      //   · la visée et la saisie en VR (js/xr-runtime.js) doivent pouvoir toucher un objet que
      //     son lot dessine ;
      //   · tout ce qui décrit, enregistre ou exporte un objet doit lire l'intention, sans quoi
      //     regrouper le décor enregistre un projet où tout le décor est masqué — un fichier
      //     corrompu par une optimisation, découvert à la réouverture.
      // `visibleIntent()` est la lecture correcte des deux côtés ; voir plus bas.
      o.userData.inInstanceBatch = true;
      o.userData.visibleWanted = (o.visible !== false);
      o.visible = false;
    });
    im.instanceMatrix.needsUpdate = true;
    // La sphère englobante d'un InstancedMesh se calcule sur ses INSTANCES, pas sur sa
    // géométrie : sans cet appel, three garderait celle d'un seul cube et éliminerait le lot
    // dès qu'on ne regarde pas exactement son origine.
    im.computeBoundingSphere();
    scn.add(im);
    // La scène est mémorisée avec le lot : c'est elle qu'il faudra pour le unregister, et
    // le runtime en change à chaque changement de niveau.
    engineInstances.lots.push({mesh:im, sources:list, matrices:matrices, scene:scn});
    });
  });
  engineInstances.active = engineInstances.lots.length > 0;
  return engineInstances.lots.reduce(function(n, l){ return n + l.sources.length; }, 0);
}

export const MAT_ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

// Resynchronisation par image : c'est ce qui rend l'automatisme sûr.
//
// UNE PASSE D'ARBRE, ET PAS UNE PAR OBJET. Chaque source appelait
// `o.updateWorldMatrix(true, false)`, qui remonte la chaîne des parents pour la remettre à
// jour : les cinquante objets d'un même secteur recalculaient donc leur parent cinquante fois.
// Mesuré sur 5 000 objets rangés en 100 secteurs : 1,76 ms rien que pour ces appels, contre
// 1,07 ms pour une seule passe `scene.updateMatrixWorld()` qui fait le même travail.
//
// Le reste de la fonction est écrit en boucles `for` plutôt qu'en `forEach` et hisse les
// lectures de `userData` hors du corps : à 4 900 sources par image, la mécanique de la boucle
// pesait autant que le calcul.
export function updateInstances(){
  if(!engineInstances.active) return;
  const lots = engineInstances.lots;
  // Les scènes des lots, mises à jour UNE fois chacune. Le runtime change de scène à chaque
  // niveau, et rien ne garantit qu'un lot et le suivant partagent la leur.
  let scenesVues = null;
  for(let l = 0; l < lots.length; l++){
    const scn = lots[l].scene;
    if(!scn) continue;
    if(scenesVues === null) scenesVues = new Set();
    if(scenesVues.has(scn)) continue;
    scenesVues.add(scn);
    scn.updateMatrixWorld();
  }
  for(let l = 0; l < lots.length; l++){
    const lot = lots[l], sources = lot.sources, matrices = lot.matrices, mesh = lot.mesh;
    let change = false;
    for(let i = 0; i < sources.length; i++){
      const o = sources[i], u = o.userData, cache16 = matrices[i];
      // Quatre façons de sortir d'un lot, toutes traitées par une échelle nulle :
      //  - DÉTRUIT par un script (api.destroy le retire de la scène : plus de parent).
      //    Sans ça il continuerait d'être dessiné après sa mort — un fantôme, et
      //    parfaitement inexplicable pour qui le voit.
      //  - MASQUÉ par un script : on lit `actifVoulu`, l'INTENTION, parce que `visible`
      //    vaut déjà false sur toute source regroupée.
      //  - TROP LOIN, décidé par le niveau de détail.
      //  - MASQUÉ À LA MAIN, par l'œil du panneau Hiérarchie. `visibleWanted` porte
      //    l'intention de la personne ; `visible`, lui, vaut déjà false sur toute source
      //    regroupée et ne peut donc plus rien dire. Sans cette ligne, cliquer sur l'œil d'un
      //    objet regroupé ne faisait RIEN à l'écran : le lot continuait de le dessiner.
      if(!o.parent || u.activeVoulu === false || u.visibleWanted === false || u.instanceCachee){
        if(cache16[0] !== 0 || cache16[5] !== 0){
          mesh.setMatrixAt(i, MAT_ZERO);
          cache16[0] = 0; cache16[5] = 0;
          change = true;
        }
        continue;
      }
      // PAS de `o.updateWorldMatrix()` ici : la passe d'arbre ci-dessus l'a déjà fait, et
      // mieux. La remettre rendrait le coût proportionnel à la PROFONDEUR de la hiérarchie
      // autant qu'à son nombre d'objets.
      const e = o.matrixWorld.elements;
      let bouge = false;
      for(let k = 0; k < 16; k++){ if(e[k] !== cache16[k]){ bouge = true; break; } }
      if(!bouge) continue;
      mesh.setMatrixAt(i, o.matrixWorld);
      for(let k = 0; k < 16; k++) cache16[k] = e[k];
      change = true;
    }
    // LA BOÎTE ENGLOBANTE SUIT LES INSTANCES, sinon le lot serait éliminé du champ de vision
    // sur une boîte périmée — un décor qui disparaît quand on tourne la caméra. Recalculée
    // SEULEMENT quand quelque chose a bougé : sur un décor immobile, c'est gratuit.
    if(change){
      mesh.instanceMatrix.needsUpdate = true;
      if(mesh.frustumCulled) mesh.computeBoundingSphere();
    }
  }
}

export function undoInstances(){
  engineInstances.lots.forEach(function(lot){
    lot.scene.remove(lot.mesh);
    lot.mesh.dispose();
    // On restitue l'intention du script quand il y en a une, et la visibilité sinon.
    // L'instantané de fin de partie repassera de toute façon derrière ; ceci évite
    // seulement une image où le décor aurait disparu.
    lot.sources.forEach(function(o){
      // L'INTENTION D'ABORD : un script qui a caché l'objet (`activeVoulu`) prime, sinon on rend
      // la visibilité que l'objet avait AVANT d'entrer dans le lot. Restituer `true` en dur
      // rallumerait un décor que la personne avait masqué à la main — et elle le découvrirait
      // en quittant le mode lecture, sans rien pour relier la cause à l'effet.
      o.visible = (o.userData.activeVoulu !== undefined)
        ? (o.userData.activeVoulu !== false)
        : (o.userData.visibleWanted !== false);
      delete o.userData.instanceCachee;
      delete o.userData.inInstanceBatch;
      delete o.userData.visibleWanted;
    });
  });
  engineInstances.lots = [];
  engineInstances.active = false;
  detachedSources.clear();
}

/**
 * CE QUE LA PERSONNE A DEMANDÉ, par opposition à ce que le rendu en fait.
 *
 * `o.visible` est l'état de RENDU. Sur un objet regroupé dans un lot d'instances, il vaut
 * `false` pour que le lot le dessine à sa place — ce n'est pas un masquage, et personne d'autre
 * que le rendu ne doit le lire comme tel.
 *
 * Tout ce qui décrit, enregistre ou exporte un objet passe donc par ici. La liste des lecteurs
 * n'est pas anecdotique : `serializeObject` et `exportDataGame` (le fichier de projet et le jeu
 * publié), les surcharges de modèle et de sous-scène, l'œil du panneau Hiérarchie, l'inventaire
 * du copilote, la navigation, l'analyse, les émetteurs de particules et la boucle de scripts.
 * Chacun lisait `visible` directement, ce qui était juste tant que le regroupement n'existait
 * que dans le jeu publié.
 */
export function visibleIntent(o){
  if(!o) return false;
  if(o.userData && o.userData.inInstanceBatch) return o.userData.visibleWanted !== false;
  return o.visible !== false;
}

/**
 * AFFICHE OU MASQUE un objet — la seule façon correcte de le faire.
 *
 * Écrire `o.visible` marche tant que l'objet se dessine lui-même, et ne fait RIEN sur un objet
 * regroupé : son lot continue de le dessiner, et la valeur écrite sera écrasée à la prochaine
 * reconstruction. Les deux gestes qui masquent — l'œil du panneau Hiérarchie et l'action
 * « cacher » d'un évènement — passent donc par ici.
 */
export function setVisibleIntent(o, wanted){
  if(!o) return;
  const v = wanted !== false;
  if(o.userData) o.userData.visibleWanted = v;
  // Sur une source regroupée, `visible` reste faux : c'est le lot qui dessine, et
  // `updateInstances` lit `visibleWanted` pour éteindre l'instance.
  o.visible = (o.userData && o.userData.inInstanceBatch) ? false : v;
}

/**
 * Sort UN objet de son lot, ou l'y remet — sans reconstruire quoi que ce soit.
 *
 * C'est ce qui rend le regroupement compatible avec l'édition. Un objet regroupé est dessiné
 * par le lot, avec LE matériau du lot : le surligner (survol, sélection) écrirait dans un
 * matériau que personne ne regarde, et l'objet resterait terne sous le curseur. Plutôt que de
 * refabriquer les lots à chaque mouvement de souris — ce qui coûterait cent fois ce que le
 * regroupement rapporte —, on éteint son instance (échelle nulle, par le même chemin que le
 * niveau de détail) et on le laisse se dessiner lui-même. Un appel de dessin pour l'objet qu'on
 * manipule : c'est exactement ce qu'on veut payer.
 */
export function detachFromBatch(o, detached){
  if(!o || !o.userData || !o.userData.inInstanceBatch) return false;
  o.userData.instanceCachee = !!detached;
  o.visible = detached ? (o.userData.visibleWanted !== false) : false;
  if(detached) detachedSources.add(o); else detachedSources.delete(o);
  return true;
}

// LE REGISTRE DES DÉTACHÉS, tenu ici et pas chez l'appelant. Un objet peut être sorti de son
// lot par deux chemins sans rapport — la sélection (js/editor-batching.js, à chaque image) et
// le surlignage (js/selection.js, au survol d'une liste de l'inspecteur). Sans registre commun,
// le second détache un objet que le premier ne sait pas remettre : il reste dessiné hors lot
// pour toujours, ce qui ne se voit pas à l'écran et annule le gain, objet par objet.
const detachedSources = new Set();

/** Les objets actuellement sortis de leur lot — copie, pour que personne ne modifie le registre. */
export function detachedFromBatch(){ return Array.from(detachedSources); }

// Combien d'appels de dessin le regroupement a-t-il économisés ? Sert au rapport et au
// profiler — une optimisation qu'on ne mesure pas est une optimisation qu'on croit.
export function summaryInstances(){
  const objectsRegroupes = engineInstances.lots.reduce(function(n, l){ return n + l.sources.length; }, 0);
  return {lots:engineInstances.lots.length, objects:objectsRegroupes,
          economie:Math.max(0, objectsRegroupes - engineInstances.lots.length)};
}


// ---------- Niveau de détail (LOD) par distance ----------
// Le second plafond d'une scène dense : dessiner des objets trop petits pour qu'on les
// distingue. Masquer au-delà d'une distance coûte une comparaison et supprime tout —
// géométrie, matériau, ombre.
//
// Notre LOD est une DISTANCE DE DISPARITION, pas une pyramide de maillages : trois
// niveaux de détail supposent qu'on ait trois maillages, ce que personne n'a au moment
// où il en aurait besoin. Ce que tout le monde a, en revanche, c'est trop de décor lointain.

export const engineDetail = {objects:[], active:false};

export function collectDetail(objectsScene){
  engineDetail.objects = (objectsScene || []).filter(function(o){
    return o.userData.detail && o.userData.detail.distance > 0;
  });
  engineDetail.active = engineDetail.objects.length > 0;
}

export function updateDetail(cam){
  if(!engineDetail.active || !cam) return;
  const pc = cam.getWorldPosition(new THREE.Vector3());
  const po = new THREE.Vector3();
  engineDetail.objects.forEach(function(o){
    const d = o.userData.detail;
    if(!d || !(d.distance > 0)) return;
    o.getWorldPosition(po);
    const loin = po.distanceTo(pc) > d.distance;
    // `instanceCachee` plutôt que `visible` : si l'objet fait partie d'un lot instancié,
    // c'est le lot qui décide de son affichage — écrire `visible` n'aurait aucun effet et
    // laisserait croire que le LOD ne marche pas.
    o.userData.instanceCachee = loin;
    if(!engineInstances.active) o.visible = !loin;
  });
}


// EXPOSÉ EN GLOBALE, à dessein. Ces symboles sont appelés depuis des fichiers
// que les mêmes pages ne chargent pas toutes : un `import` y pointerait un
// fichier absent, et la page ne démarrerait pas. Ils gardent donc leur garde
// `typeof` côté appelant, et se déclarent ici.
globalThis.collectDetail = collectDetail;
globalThis.instantiateStatic = instantiateStatic;
globalThis.updateDetail = updateDetail;
globalThis.updateInstances = updateInstances;
// `visibleIntent` est lue depuis une dizaine de fichiers, dont certains (js/lightmap-atlas.js,
// js/game-ui.js) n'ont aucun import par construction. `detachFromBatch` est appelée par
// js/selection.js, que render-perf.js ne peut pas importer sans créer un cycle.
globalThis.visibleIntent = visibleIntent;
globalThis.setVisibleIntent = setVisibleIntent;
globalThis.detachFromBatch = detachFromBatch;
// Pour js/editor-batching.js, qui ne peut PAS importer ce fichier : le build sait le retirer
// d'un jeu allégé, et un `import` vers un module absent empêche l'importateur de s'exécuter du
// tout (test/esm-modules.test.mjs). Le régime de globales survit à l'absence, l'import non.
globalThis.detachedFromBatch = detachedFromBatch;
globalThis.summaryInstances = summaryInstances;
globalThis.undoInstances = undoInstances;
globalThis.engineInstances = engineInstances;