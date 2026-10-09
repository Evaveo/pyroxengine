// ---------- Traitements d'import d'un modèle : hiérarchie, normales, tangentes, UV de lightmap ----------
//
// PARTAGÉ éditeur ↔ runtime, comme component-data.js : l'éditeur applique ces traitements sur
// le template de l'asset (js/import-settings.js), le jeu publié les REJOUE à l'identique sur le
// modèle qu'il vient de charger (js/game-runtime.js). Aucun des résultats n'est sérialisé — ni
// les normales recalculées, ni le dépliage — parce que rien de tout ça ne tient dans le format
// de projet sans y recopier la géométrie entière. Ce qui est sérialisé, ce sont les RÉGLAGES ;
// ce fichier est la fonction qui, des mêmes réglages et du même fichier, redonne le même
// résultat des deux côtés. C'est donc le seul endroit où ces algorithmes ont le droit d'exister.
//
// Tout est RÉVERSIBLE : chaque opération mémorise juste ce qu'il faut pour revenir à ce que le
// fichier contenait (`geo.userData.importOrigin`, `node.userData.importOrder`, la table des
// replis). Décocher une case doit rendre le modèle d'origine sans
// relire le fichier — sinon le réglage ne serait pas un réglage, mais une destruction.

export const MODEL_IMPORT_DEFAULT = {
  // Les défauts reproduisent le comportement d'AVANT ces options (v0.140 et antérieures), pas
  // ceux d'Unity : `ensureParamsImport` complète les assets déjà enregistrés avec les valeurs
  // ci-dessous, et un défaut « à la Unity » changerait en silence tous les modèles des projets
  // existants à leur prochaine ouverture.
  preserveHierarchy: true,    // Unity : décoché par défaut
  sortHierarchy: false,       // Unity : coché par défaut
  convertUnits: false,        // Unity : coché par défaut
  normals: 'import',          // import | calculate | none
  normalsMode: 'areaAngle',   // unweighted | area | angle | areaAngle
  tangents: 'import',         // import | mikktspace | calculate | none
  lightmapUv: false,
  skinWeights: 4,             // 1 | 2 | 4 influences par sommet (« Skin Weights » d'Unity)
  // --- ajoutés en v0.159 pour rejoindre l'onglet Model d'Unity. Défauts = comportement d'avant.
  importBlendShapes: true,    // Unity : « Import BlendShapes » (morph targets de three)
  blendShapeNormals: 'import',// import | calculate | none — Unity : « Blend Shape Normals »
  importVisibility: true,     // Unity : « Import Visibility » (la visibilité écrite par le fichier)
  importCameras: true,        // Unity : « Import Cameras »
  importLights: true,         // Unity : « Import Lights »
  // D'où vient le lissage quand les normales sont CALCULÉES — « Smoothness Source » d'Unity :
  // `groups` = le partage des sommets dans le fichier (le comportement d'avant), `angle` = l'angle
  // de lissage ci-dessous, `none` = toutes les arêtes dures.
  smoothnessSource: 'groups',
  smoothingAngle: 60,         // degrés — Unity : « Smoothing Angle », 60 par défaut
  swapUvs: false,             // Unity : « Swap UVs » (uv ↔ uv1)
  lightmapHardAngle: 60,      // Unity : « Hard Angle » du dépliage de lightmap
  lightmapPackMargin: 4,      // Unity : « Pack Margin », en texels d'une lightmap de 1024
  // --- onglet Animation
  importAnimation: true,      // Unity : « Import Animation »
  animCompression: 'off',     // off | reduction — Unity : « Anim. Compression » (Keyframe Reduction)
  animRotationError: 0.5,     // degrés
  animPositionError: 0.5,     // pour cent de l'amplitude de la piste
  animScaleError: 0.5,        // pour cent de l'amplitude de la piste
  // --- onglet Matériaux
  materialCreation: 'import', // import | standard | none — Unity : « Material Creation Mode »
  srgbAlbedo: true,           // Unity : « sRGB Albedo Colors »
  materialLocation: 'embedded',// embedded | external — Unity : « Location »
  // --- nœuds de l'instance (js/model-nodes.js)
  generateColliders: false,   // Unity : « Generate Colliders » — un collider ajusté par maillage
  rootNode: '',               // Unity (Rig) : « Root node » — l'os d'où sort le root motion
  optimizeGameObjects: false, // Unity (Rig) : « Optimize Game Objects »
  extraTransforms: []         // Unity (Rig) : « Extra Transforms to Expose »
};

// Les replis, par racine de modèle. PAS dans `userData` : `Object3D.copy` fait passer `userData`
// par `JSON.parse(JSON.stringify(...))` à chaque clonage, et un enregistrement contient des
// Object3D — leur `toJSON()` aurait sérialisé la moitié de la scène à chaque instance posée.
const collapsedByRoot = new WeakMap();
// Même mécanique pour les caméras et lumières retirées par « Import Cameras / Lights » : le nœud
// est détaché (pas détruit), ses enfants remontent, et tout se défait sans relire le fichier.
const strippedByRoot = new WeakMap();

/** Combien de nœuds vides ont été repliés sous cette racine. */
export function collapsedCount(root){
  const list = root && collapsedByRoot.get(root);
  return list ? list.length : 0;
}

// Angle maximal entre la normale d'une face et la normale moyenne de son îlot. Au-delà, la face
// ouvre un nouvel îlot. Plus l'angle est grand, moins il y a de coutures et plus la projection
// plane écrase les faces obliques ; 60° est le compromis habituel des dépliages automatiques.
export const ANGLE_CHART_MAX = 60;

// Marge autour de chaque îlot dans le carré unité, en unités normalisées (≈ 4 texels pour une
// lightmap de 1024). Sans elle, le filtrage bilinéaire de la lightmap va chercher la couleur de
// l'îlot voisin sur les bords — la fuite de lumière classique.
export const MARGIN_CHART = 4 / 1024;


// ---------- Noms protégés : ceux qu'une animation adresse ----------
//
// Un clip ne cite pas les nœuds par chemin strict : `PropertyBinding` RETROUVE le nœud par son
// nom quelque part sous la racine. Supprimer un nœud dont le nom apparaît dans une piste casse
// donc la piste, en silence (three avertit une fois en console, puis se tait). C'est la seule
// chose qui interdit vraiment de replier un nœud vide.

/** Les noms de nœuds cités par des pistes de ces clips. */
export function namesUsedByClips(clips){
  const names = new Set();
  (clips || []).forEach(function(clip){
    (clip && clip.tracks || []).forEach(function(track){
      const raw = String(track.name || '');
      // « .bones[Hips].position » — la forme que produit un SkinnedMesh
      const bone = raw.match(/\.bones\[([^\]]+)\]/);
      if(bone) names.add(bone[1]);
      // « Armature/Hips.quaternion » — le chemin de nœuds, avant la propriété
      const path = raw.split('.')[0];
      if(path) path.split('/').forEach(function(n){ if(n) names.add(n); });
    });
  });
  return names;
}


// ---------- Hiérarchie ----------

/** Un nœud est REPLIABLE s'il ne porte rien : ni géométrie, ni os, ni lumière, ni caméra. */
export function nodeIsEmpty(o){
  return !!o && !o.isMesh && !o.isBone && !o.isLight && !o.isCamera
      && !o.isPoints && !o.isLine && !o.isSprite && !o.isSkinnedMesh;
}

/** Mémorise, une seule fois, la place de chaque nœud dans la fratrie telle que le fichier l'a écrite. */
export function rememberOrder(root){
  root.traverse(function(o){
    o.children.forEach(function(c, i){
      if(c.userData.importOrder === undefined) c.userData.importOrder = i;
    });
  });
}

/** Rend à chaque fratrie l'ordre du fichier. */
export function restoreOrder(root){
  root.traverse(function(o){
    if(o.children.length < 2) return;
    o.children.sort(function(a, b){
      return (a.userData.importOrder || 0) - (b.userData.importOrder || 0);
    });
  });
}

/**
 * Trie chaque fratrie par nom.
 *
 * Comparaison par POINTS DE CODE, pas `localeCompare` : l'éditeur et le jeu publié doivent ranger
 * pareil, et `localeCompare` dépend de la locale du navigateur qui exécute. Deux ordres différents
 * pour le même fichier, ce sont deux numérotations d'emplacements de matériaux différentes.
 */
export function sortChildrenByName(root){
  root.traverse(function(o){
    if(o.children.length < 2) return;
    o.children.sort(function(a, b){
      const na = String(a.name || ''), nb = String(b.name || '');
      if(na < nb) return -1;
      if(na > nb) return 1;
      return (a.userData.importOrder || 0) - (b.userData.importOrder || 0);
    });
  });
}

/**
 * Replie les nœuds vides : leur transformation est cuite dans celle de leurs enfants, puis ils
 * disparaissent. Les matrices MONDE de tout ce qui reste sont inchangées — c'est ce qui rend
 * l'opération sûre pour un maillage skinné, dont la liaison au squelette est exprimée en monde.
 *
 * Chaque repli est mémorisé (`collapsedByRoot`) avec de quoi le défaire : le nœud lui-même
 * (détaché, pas détruit), son parent, sa place et sa matrice.
 */
export function collapseNodesEmpty(root, protectedNames){
  const candidates = [];
  root.traverse(function(o){
    if(o === root || !nodeIsEmpty(o) || !o.children.length) return;
    if(protectedNames && protectedNames.has(o.name)) return;
    candidates.push(o);
  });
  return collapseNodes(root, candidates, collapsedByRoot);
}

/**
 * Replie une liste de nœuds dans leur parent, en mémorisant de quoi défaire chaque repli dans
 * `store` (une WeakMap racine → enregistrements). Partagé par le repli des nœuds vides et par le
 * retrait des caméras et lumières.
 */
export function collapseNodes(root, candidates, store){
  const records = store.get(root) || [];
  // Des feuilles vers la racine : replier un parent avant son enfant laisserait l'enfant avec
  // une matrice déjà cuite une fois, donc appliquée deux fois.
  candidates.reverse();
  candidates.forEach(function(o){
    const parent = o.parent;
    if(!parent) return;
    o.updateMatrix();
    const matrix = o.matrix.clone();
    const index = parent.children.indexOf(o);
    const children = o.children.slice();
    children.forEach(function(c, k){
      c.applyMatrix4(matrix);
      c.parent = parent;
      parent.children.splice(index + k, 0, c);
    });
    o.children.length = 0;
    parent.children.splice(parent.children.indexOf(o), 1);
    o.parent = null;
    records.push({node:o, parent:parent, index:index, matrix:matrix, count:children.length});
  });
  store.set(root, records);
  return candidates.length;
}

/** Défait tous les replis, du dernier au premier. */
export function restoreNodesCollapsed(root, store){
  store = store || collapsedByRoot;
  const records = store.get(root) || [];
  const inverse = new THREE.Matrix4();
  for(let i = records.length - 1; i >= 0; i--){
    const r = records[i];
    const children = r.parent.children.splice(r.index, r.count);
    inverse.copy(r.matrix).invert();
    children.forEach(function(c){
      c.applyMatrix4(inverse);
      c.parent = r.node;
    });
    r.node.children = children;
    r.node.parent = r.parent;
    r.parent.children.splice(r.index, 0, r.node);
  }
  store.set(root, []);
  return records.length;
}

/** Combien de caméras et lumières du fichier ont été retirées sous cette racine. */
export function strippedCount(root){
  const list = root && strippedByRoot.get(root);
  return list ? list.length : 0;
}

/**
 * « Import Visibility » : décoché, tout nœud que le fichier avait caché est rendu visible. La
 * visibilité du fichier est mémorisée une fois (`importVisible`) pour que recocher la rende.
 */
export function applyVisibilityImport(root, importVisibility){
  root.traverse(function(o){
    if(o.userData.importVisible === undefined) o.userData.importVisible = o.visible;
    o.visible = importVisibility ? o.userData.importVisible : true;
  });
}

/**
 * Applique les deux réglages de hiérarchie. Toujours depuis la forme du FICHIER : on défait
 * d'abord ce qui avait été fait, sinon deux passages successifs ne donneraient pas le même
 * arbre que le premier.
 */
export function applyModelHierarchy(root, params, clips){
  if(!root) return {collapsed:0, sorted:false};
  const p = Object.assign({}, MODEL_IMPORT_DEFAULT, params || {});
  // Ne rien refaire si rien n'a changé. Ce n'est pas qu'une économie : défaire puis refaire un
  // repli fait passer chaque enfant par applyMatrix4 → decompose, qui n'est pas exactement
  // réversible en flottants. `applyImportModel` est rappelé à CHAQUE retouche de matériau — la
  // dérive finirait par se voir.
  const signature = [p.preserveHierarchy, p.sortHierarchy, p.importCameras, p.importLights,
                     p.importVisibility].join('|');
  if(root.userData.importHierarchy === signature){
    return {collapsed:collapsedCount(root), sorted:!!p.sortHierarchy, stripped:strippedCount(root)};
  }
  root.userData.importHierarchy = signature;
  restoreNodesCollapsed(root);
  restoreNodesCollapsed(root, strippedByRoot);
  rememberOrder(root);
  restoreOrder(root);
  applyVisibilityImport(root, p.importVisibility !== false);
  // Caméras et lumières AVANT le repli : un nœud vide qui ne portait qu'une lumière devient
  // vide à son tour, et le repli doit le voir comme tel.
  const strip = [];
  root.traverse(function(o){
    if(o === root) return;
    if((o.isCamera && p.importCameras === false) || (o.isLight && p.importLights === false))
      strip.push(o);
  });
  const stripped = strip.length ? collapseNodes(root, strip, strippedByRoot) : 0;
  let collapsed = 0;
  if(!p.preserveHierarchy) collapsed = collapseNodesEmpty(root, namesUsedByClips(clips));
  if(p.sortHierarchy) sortChildrenByName(root);
  return {collapsed:collapsed, sorted:!!p.sortHierarchy, stripped:stripped};
}


// ---------- Normales ----------

/**
 * Normales de sommet pondérées, en quatre modes — l'équivalent du « Normals Mode » d'Unity.
 *
 * `computeVertexNormals()` de three est le mode `area` et lui seul : il accumule les produits
 * vectoriels NON normalisés, dont la longueur vaut deux fois l'aire du triangle. Les trois
 * autres modes n'existent pas dans three, d'où ce calcul écrit ici.
 *
 * Ici, ce qui décide du lissage est le partage des sommets DANS LE FICHIER : deux faces qui
 * partagent leurs index sont lissées, deux faces qui ont chacune leurs sommets restent dures.
 * C'est la source « groupes de lissage » d'Unity ; l'angle de lissage est `computeNormalsByAngle`.
 */
export function computeNormalsWeighted(geo, mode){
  const pos = geo.attributes.position;
  if(!pos || !pos.count) return false;
  const useArea = (mode === 'area' || mode === 'areaAngle');
  const useAngle = (mode === 'angle' || mode === 'areaAngle');
  const dst = new Float32Array(pos.count * 3);
  const idx = geo.index ? geo.index.array : null;
  const total = idx ? idx.length : pos.count;
  const pA = new THREE.Vector3(), pB = new THREE.Vector3(), pC = new THREE.Vector3();
  const cb = new THREE.Vector3(), ab = new THREE.Vector3(), normal = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  const corners = [0, 0, 0];

  function angleAt(p0, p1, p2){
    e1.subVectors(p1, p0);
    e2.subVectors(p2, p0);
    const l = e1.length() * e2.length();
    if(l < 1e-20) return 0;
    // acos borné : l'arrondi flottant sort de [-1, 1] sur un triangle dégénéré, et acos rend NaN
    return Math.acos(Math.max(-1, Math.min(1, e1.dot(e2) / l)));
  }

  for(let t = 0; t + 2 < total; t += 3){
    corners[0] = idx ? idx[t]     : t;
    corners[1] = idx ? idx[t + 1] : t + 1;
    corners[2] = idx ? idx[t + 2] : t + 2;
    pA.fromBufferAttribute(pos, corners[0]);
    pB.fromBufferAttribute(pos, corners[1]);
    pC.fromBufferAttribute(pos, corners[2]);
    cb.subVectors(pC, pB);
    ab.subVectors(pA, pB);
    normal.crossVectors(cb, ab);
    const doubleArea = normal.length();
    if(doubleArea < 1e-20) continue;    // triangle dégénéré : il n'oriente rien
    normal.divideScalar(doubleArea);
    for(let k = 0; k < 3; k++){
      let w = 1;
      if(useArea) w *= doubleArea * 0.5;
      if(useAngle){
        const p0 = (k === 0) ? pA : (k === 1) ? pB : pC;
        const p1 = (k === 0) ? pB : (k === 1) ? pC : pA;
        const p2 = (k === 0) ? pC : (k === 1) ? pA : pB;
        w *= angleAt(p0, p1, p2);
      }
      const o = corners[k] * 3;
      dst[o]     += normal.x * w;
      dst[o + 1] += normal.y * w;
      dst[o + 2] += normal.z * w;
    }
  }

  for(let i = 0; i < dst.length; i += 3){
    const l = Math.hypot(dst[i], dst[i + 1], dst[i + 2]);
    if(l < 1e-20){ dst[i] = 0; dst[i + 1] = 1; dst[i + 2] = 0; continue; }
    dst[i] /= l; dst[i + 1] /= l; dst[i + 2] /= l;
  }
  geo.setAttribute('normal', new THREE.BufferAttribute(dst, 3));
  geo.attributes.normal.needsUpdate = true;
  return true;
}


/**
 * Normales lissées PAR ANGLE — « Smoothness Source : From Angle » et « Smoothing Angle » d'Unity.
 *
 * Les sommets sont ressoudés par position (`weldByPosition`) : deux faces se lissent si elles
 * touchent le même point de l'espace ET que leurs normales font moins de `angle` degrés, quel que
 * soit le partage des index dans le fichier. `angle` à 0 donne des arêtes toutes dures (la source
 * « None » d'Unity). Chaque coin reçoit sa normale ; les coins d'un même sommet qui n'en ont pas
 * la même sont dédoublés, en fin de tableau, par `splitCorners` — donc réversibles par troncature.
 */
export function computeNormalsByAngle(geo, mode, angle){
  const pos = geo.attributes.position;
  if(!pos || !pos.count) return false;
  const idx = geo.index ? geo.index.array : null;
  const nTri = Math.floor((idx ? idx.length : pos.count) / 3);
  if(!nTri) return false;
  const corner = function(t, k){ return idx ? idx[t * 3 + k] : t * 3 + k; };
  const useArea = (mode === 'area' || mode === 'areaAngle');
  const useAngle = (mode === 'angle' || mode === 'areaAngle');
  const cosMax = Math.cos(Math.max(0, Math.min(180, angle)) * Math.PI / 180);

  // 1. normale unitaire et poids de chaque coin de chaque face
  const faceN = new Float32Array(nTri * 3);
  const cornerW = new Float32Array(nTri * 3);
  const pA = new THREE.Vector3(), pB = new THREE.Vector3(), pC = new THREE.Vector3();
  const cb = new THREE.Vector3(), ab = new THREE.Vector3(), n = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  const pts = [pA, pB, pC];
  for(let t = 0; t < nTri; t++){
    pA.fromBufferAttribute(pos, corner(t, 0));
    pB.fromBufferAttribute(pos, corner(t, 1));
    pC.fromBufferAttribute(pos, corner(t, 2));
    n.crossVectors(cb.subVectors(pC, pB), ab.subVectors(pA, pB));
    const dA = n.length();
    if(dA < 1e-20) continue;          // dégénéré : poids nul, il n'oriente rien
    n.divideScalar(dA);
    faceN[t * 3] = n.x; faceN[t * 3 + 1] = n.y; faceN[t * 3 + 2] = n.z;
    for(let k = 0; k < 3; k++){
      let w = 1;
      if(useArea) w *= dA * 0.5;
      if(useAngle){
        e1.subVectors(pts[(k + 1) % 3], pts[k]);
        e2.subVectors(pts[(k + 2) % 3], pts[k]);
        const l = e1.length() * e2.length();
        w *= (l < 1e-20) ? 0 : Math.acos(Math.max(-1, Math.min(1, e1.dot(e2) / l)));
      }
      cornerW[t * 3 + k] = w;
    }
  }

  // 2. les coins autour de chaque point soudé
  const weld = weldByPosition(pos);
  const around = new Map();
  for(let t = 0; t < nTri; t++){
    for(let k = 0; k < 3; k++){
      const w = weld[corner(t, k)];
      let list = around.get(w);
      if(!list){ list = []; around.set(w, list); }
      list.push(t * 3 + k);
    }
  }

  // 3. normale de chaque coin : la somme pondérée des faces voisines à moins de `angle`
  const cornerN = new Float32Array(nTri * 9);
  for(let t = 0; t < nTri; t++){
    const fx = faceN[t * 3], fy = faceN[t * 3 + 1], fz = faceN[t * 3 + 2];
    for(let k = 0; k < 3; k++){
      const list = around.get(weld[corner(t, k)]);
      let x = 0, y = 0, z = 0;
      for(let i = 0; i < list.length; i++){
        const c = list[i], u = (c / 3) | 0;
        const gx = faceN[u * 3], gy = faceN[u * 3 + 1], gz = faceN[u * 3 + 2];
        if(u !== t && fx * gx + fy * gy + fz * gz < cosMax) continue;
        const w = cornerW[c];
        x += gx * w; y += gy * w; z += gz * w;
      }
      const l = Math.hypot(x, y, z);
      const o = (t * 3 + k) * 3;
      // un triangle dégénéré n'a pas de normale à lui : on garde « vers le haut »
      if(l < 1e-20){ cornerN[o] = 0; cornerN[o + 1] = 1; cornerN[o + 2] = 0; }
      else { cornerN[o] = x / l; cornerN[o + 1] = y / l; cornerN[o + 2] = z / l; }
    }
  }

  // 4. dédoublement des sommets dont les coins ne s'accordent pas sur leur normale
  const keyOf = function(t, k){
    const o = (t * 3 + k) * 3;
    return Math.round(cornerN[o] * 1e3) + ',' + Math.round(cornerN[o + 1] * 1e3) + ','
         + Math.round(cornerN[o + 2] * 1e3);
  };
  const split = splitCorners(nTri, corner, keyOf, pos.count);
  if(split.remap.length > pos.count) duplicateVertices(geo, split.remap);
  geo.setIndex(new THREE.BufferAttribute(split.newIndex, 1));
  const dst = new Float32Array(split.remap.length * 3);
  for(let t = 0; t < nTri; t++){
    for(let k = 0; k < 3; k++){
      const slot = split.newIndex[t * 3 + k], o = (t * 3 + k) * 3;
      dst[slot * 3] = cornerN[o]; dst[slot * 3 + 1] = cornerN[o + 1]; dst[slot * 3 + 2] = cornerN[o + 2];
    }
  }
  geo.setAttribute('normal', new THREE.BufferAttribute(dst, 3));
  geo.attributes.normal.needsUpdate = true;
  return true;
}


// ---------- Blend shapes (morph targets) ----------

// Les morph targets du fichier, par géométrie. Hors `userData` pour la même raison que les
// replis : ce sont des BufferAttribute, que le clonage ferait passer par JSON.
const morphsOrigin = new WeakMap();

function copyMorphs(morphs){
  const out = {};
  Object.keys(morphs || {}).forEach(function(name){
    out[name] = morphs[name].map(function(a){
      const c = new THREE.BufferAttribute(a.array.slice(), a.itemSize, a.normalized);
      c.name = a.name;
      return c;
    });
  });
  return out;
}

/** Mémorise une fois les morph targets du fichier, et les rend tels quels. */
export function restoreMorphs(geo){
  if(!morphsOrigin.has(geo)) morphsOrigin.set(geo, copyMorphs(geo.morphAttributes));
  geo.morphAttributes = copyMorphs(morphsOrigin.get(geo));
}

/**
 * Normales des blend shapes recalculées depuis leurs positions — « Blend Shape Normals :
 * Calculate ». Chaque cible est reconstruite en absolu, ses normales calculées avec le même mode
 * que le maillage, puis rendues relatives si la géométrie l'est.
 */
export function computeMorphNormals(geo, mode){
  const targets = geo.morphAttributes && geo.morphAttributes.position;
  const base = geo.attributes.position, baseN = geo.attributes.normal;
  if(!targets || !targets.length || !base || !baseN) return false;
  const relative = !!geo.morphTargetsRelative;
  const tmp = new THREE.BufferGeometry();
  if(geo.index) tmp.setIndex(geo.index);
  geo.morphAttributes.normal = targets.map(function(t){
    const abs = new Float32Array(base.count * 3);
    for(let i = 0; i < base.count; i++){
      abs[i * 3]     = t.getX(i) + (relative ? base.getX(i) : 0);
      abs[i * 3 + 1] = t.getY(i) + (relative ? base.getY(i) : 0);
      abs[i * 3 + 2] = t.getZ(i) + (relative ? base.getZ(i) : 0);
    }
    tmp.setAttribute('position', new THREE.BufferAttribute(abs, 3));
    computeNormalsWeighted(tmp, mode);
    const out = tmp.attributes.normal.array;
    if(relative){
      for(let i = 0; i < base.count; i++){
        out[i * 3] -= baseN.getX(i); out[i * 3 + 1] -= baseN.getY(i); out[i * 3 + 2] -= baseN.getZ(i);
      }
    }
    const a = new THREE.BufferAttribute(out, 3);
    a.name = t.name;
    return a;
  });
  return true;
}


// ---------- Mémoire de ce que le fichier contenait ----------

/**
 * Copie, une seule fois, les attributs que les réglages peuvent écraser. `null` veut dire
 * « le fichier n'en avait pas » — une information aussi utile que les valeurs elles-mêmes,
 * puisque c'est elle qui dit si « Importer » doit restaurer ou effacer.
 */
export function rememberGeoOrigin(geo){
  if(geo.userData.importOrigin) return geo.userData.importOrigin;
  function copy(name){
    const a = geo.attributes[name];
    if(!a) return null;
    return {array:Float32Array.from(a.array), itemSize:a.itemSize};
  }
  geo.userData.importOrigin = {
    normal: copy('normal'), tangent: copy('tangent'), uv: copy('uv'), uv1: copy('uv1'),
    skinWeight: copy('skinWeight'),
    countVertices: geo.attributes.position ? geo.attributes.position.count : 0,
    index: geo.index ? geo.index.array.slice() : null
  };
  return geo.userData.importOrigin;
}

export function restoreAttribute(geo, name, saved){
  if(!saved){ geo.deleteAttribute(name); return false; }
  geo.setAttribute(name, new THREE.BufferAttribute(Float32Array.from(saved.array), saved.itemSize));
  geo.attributes[name].needsUpdate = true;
  return true;
}


// ---------- Poids de peau : limiter les influences, et surtout RENORMALISER ----------
//
// LE DÉFAUT QUE CETTE PASSE CORRIGE, et qui n'a jamais rien dit d'autre qu'un avertissement de
// console : « THREE.FBXLoader: Vertex has more than 4 skinning weights assigned to vertex.
// Deleting additional weights. » Le chargeur garde les quatre poids les plus forts et
// **ne renormalise pas**. Or le shader de skinning de three calcule
//
//     skinned = Σ boneMatrix_i · vertex · weight_i
//
// sans diviser par la somme : un sommet dont les poids sommaient à 1 et n'en gardent que 0,95
// se retrouve à 95 % de sa position DANS L'ESPACE DE LIAISON, donc tiré vers l'origine du rig.
// Ça se voit là où l'infographiste a chargé les influences — épaules, hanches, aisselles — et
// jamais ailleurs. C'est exactement ce que le réglage « Skin Weights » d'Unity prend en charge.
//
// La renormalisation tourne donc MÊME à la limite de 4 : c'est une correction, pas une option.

/**
 * Limite le nombre d'influences par sommet et renormalise les poids.
 * Rend le nombre de sommets tronqués et le nombre de sommets renormalisés.
 */
export function applySkinWeights(geo, limit){
  const w = geo.attributes.skinWeight;
  if(!w) return null;
  const n = Math.max(1, Math.min(4, limit | 0)) || 4;
  const a = w.array;
  let clamped = 0, renormalized = 0;
  const quatre = [0, 1, 2, 3];
  for(let v = 0; v < w.count; v++){
    const o = v * 4;
    if(n < 4){
      // les `n` plus forts survivent ; les autres tombent à zéro. Trier quatre valeurs par
      // index évite de toucher `skinIndex`, qui reste valable puisqu'un poids nul l'ignore.
      const order = quatre.slice().sort(function(i, j){ return a[o + j] - a[o + i]; });
      let coupe = false;
      for(let k = n; k < 4; k++){
        if(a[o + order[k]] !== 0){ a[o + order[k]] = 0; coupe = true; }
      }
      if(coupe) clamped++;
    }
    const somme = a[o] + a[o + 1] + a[o + 2] + a[o + 3];
    if(somme > 1e-8 && Math.abs(somme - 1) > 1e-6){
      a[o] /= somme; a[o + 1] /= somme; a[o + 2] /= somme; a[o + 3] /= somme;
      renormalized++;
    }
  }
  w.needsUpdate = true;
  return {clamped:clamped, renormalized:renormalized, count:w.count};
}


// ---------- Conversion d'unités : la mise à l'échelle CUITE dans la géométrie ----------
//
// L'ÉDITEUR TRAVAILLE EN MÈTRES. Sans conversion, un FBX exporté en centimètres est ramené à sa
// taille réelle par l'échelle de la RACINE — qui vaut alors 0,01, et chaque instance posée dans
// la scène affiche `0.01, 0.01, 0.01` dans son inspecteur. C'est ce que « Convert Units » d'Unity
// évite : le facteur est cuit dans les sommets et dans les translations des nœuds, et l'objet
// garde une échelle de 1, 1, 1 — celle qu'on veut pouvoir lire et modifier.
//
// Le facteur appliqué est mémorisé sur la géométrie et sur le nœud : changer de réglage n'applique
// que le DELTA. On ne garde pas une copie des positions d'origine, contrairement aux normales —
// une mise à l'échelle uniforme est son propre inverse, et une copie des positions d'un modèle
// lourd coûterait autant que le modèle.

/** Facteur déjà cuit dans cette géométrie (1 = aucun). */
export function bakedFactor(geo){
  const f = geo.userData.importScaleBaked;
  return (f > 0) ? f : 1;
}

/**
 * Cuit le facteur `target` dans le modèle : sommets, translations des nœuds, liaison des
 * squelettes. Les géométries partagées ne sont traitées qu'une fois.
 */
export function bakeScaleModel(root, target){
  const factor = (target > 0) ? target : 1;
  const geos = new Set();
  const skinned = [];
  let delta = 1;
  root.traverse(function(o){
    if(o.isSkinnedMesh) skinned.push(o);
    if(!o.geometry || geos.has(o.geometry)) return;
    geos.add(o.geometry);
  });
  geos.forEach(function(geo){
    const d = factor / bakedFactor(geo);
    if(Math.abs(d - 1) < 1e-12) return;
    delta = d;
    scaleAttribute(geo.attributes.position, d);
    Object.keys(geo.morphAttributes || {}).forEach(function(name){
      if(name === 'position') geo.morphAttributes[name].forEach(function(a){ scaleAttribute(a, d); });
    });
    geo.boundingBox = null;
    geo.boundingSphere = null;
    geo.userData.importScaleBaked = factor;
  });

  // Les translations : tout ce qui est SOUS la racine. La racine, elle, ne bouge pas — c'est
  // `applyImportModel` qui décide de son échelle, et elle porte le recentrage et la pose au sol.
  const dNode = factor / ((root.userData.importScaleBaked > 0) ? root.userData.importScaleBaked : 1);
  if(Math.abs(dNode - 1) > 1e-12){
    root.children.forEach(function(c){ scaleTranslations(c, dNode); });
    root.userData.importScaleBaked = factor;
    delta = dNode;
  }

  // Le squelette d'un maillage skinné est lié en MONDE : ses matrices de liaison ont été calculées
  // avant la mise à l'échelle et renverraient la peau à l'ancienne taille. On relie sur la pose
  // courante, qui est la pose de repos au moment de l'import.
  if(skinned.length && Math.abs(delta - 1) > 1e-12){
    root.updateMatrixWorld(true);
    skinned.forEach(function(m){
      if(!m.skeleton) return;
      m.skeleton.calculateInverses();
      m.bind(m.skeleton, m.matrixWorld);
      // LA BOÎTE ET LA SPHÈRE DU SKINNEDMESH LUI-MÊME, pas celles de sa géométrie.
      //
      // `THREE.SkinnedMesh` porte SES PROPRES `boundingBox`/`boundingSphere`, calculées sur la
      // pose skinnée et mises en cache une fois pour toutes — vider celles de la géométrie ne
      // les touche pas. Deux conséquences, toutes deux vécues après un simple changement
      // d'échelle : `Box3.setFromObject` les préfère à celles de la géométrie, donc l'aperçu se
      // cadrait sur l'ANCIENNE taille (modèle minuscule ou hors champ, « on perd la
      // prévisualisation ») ; et le renderer s'en sert pour le tri d'occlusion, donc le
      // personnage disparaissait selon l'angle de caméra. `null` suffit : three les recalcule
      // à la première demande.
      m.boundingBox = null;
      m.boundingSphere = null;
    });
  }
  return factor;
}

export function scaleAttribute(attr, d){
  if(!attr) return;
  const a = attr.array;
  for(let i = 0; i < a.length; i++) a[i] *= d;
  attr.needsUpdate = true;
}

export function scaleTranslations(node, d){
  node.position.multiplyScalar(d);
  node.updateMatrix();
  node.children.forEach(function(c){ scaleTranslations(c, d); });
}


// ---------- Tangentes : MikkTSpace ----------
//
// POURQUOI UNE IMPLÉMENTATION ET PAS LE MODULE DE RÉFÉRENCE. `computeMikkTSpaceTangents` de three
// délègue à `mikktspace`, un module WASM qui n'est pas vendorisé ici — et ce dépôt n'installe rien
// (application statique, aucun build). C'est donc l'ALGORITHME de Morten Mikkelsen qui est écrit
// ici, en JS, et il tourne des deux côtés (éditeur et jeu publié).
//
// Ce qui le distingue de `BufferGeometry.computeTangents()` de three, et qui est exactement ce
// qu'on vient chercher quand on a cuit ses cartes de normales dans Blender ou Substance :
//
//   1. la SOUDURE se fait sur (position, normale, UV) et pas sur l'index. Deux sommets dédoublés
//      par l'exporteur — le cas normal dès qu'il y a une couture d'UV — retrouvent la même
//      tangente ; three, lui, les traite comme deux sommets étrangers ;
//   2. les faces sont GROUPÉES par orientation d'UV. Une face dont les UV sont en miroir n'est
//      jamais moyennée avec ses voisines : c'est ce qui donne une couture nette au lieu d'une
//      tangente moyenne fausse des deux côtés ;
//   3. la moyenne est pondérée par l'ANGLE au sommet, pas par le nombre de faces.
//
// Ce qui n'y est PAS, et qu'il faut savoir : le rattrapage des triangles dégénérés de mikktspace
// (il les met de côté, calcule sans eux, puis leur recopie la base d'un voisin). Ici un triangle
// dégénéré ne contribue simplement à rien. Sur un maillage sain, les deux reviennent au même.

const TANGENT_ORIENT = 1;

/** Base par triangle : vOs/vOt normalisés, et le sens de l'orientation des UV. */
export function trianglesTangentBasis(geo, corner, nTri){
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  const os = new Float32Array(nTri * 3), ot = new Float32Array(nTri * 3);
  const flag = new Uint8Array(nTri);
  const p0 = new THREE.Vector3(), p1 = new THREE.Vector3(), p2 = new THREE.Vector3();
  const d1 = new THREE.Vector3(), d2 = new THREE.Vector3();
  const vOs = new THREE.Vector3(), vOt = new THREE.Vector3();
  for(let t = 0; t < nTri; t++){
    const i0 = corner(t, 0), i1 = corner(t, 1), i2 = corner(t, 2);
    p0.fromBufferAttribute(pos, i0);
    p1.fromBufferAttribute(pos, i1);
    p2.fromBufferAttribute(pos, i2);
    const u0 = uv.getX(i0), v0 = uv.getY(i0);
    const t21x = uv.getX(i1) - u0, t21y = uv.getY(i1) - v0;
    const t31x = uv.getX(i2) - u0, t31y = uv.getY(i2) - v0;
    d1.subVectors(p1, p0);
    d2.subVectors(p2, p0);
    const areaX2 = t21x * t31y - t21y * t31x;
    if(areaX2 > 0) flag[t] = TANGENT_ORIENT;
    // eq. 18 et 19 de mikktspace.c
    vOs.set(t31y * d1.x - t21y * d2.x, t31y * d1.y - t21y * d2.y, t31y * d1.z - t21y * d2.z);
    vOt.set(-t31x * d1.x + t21x * d2.x, -t31x * d1.y + t21x * d2.y, -t31x * d1.z + t21x * d2.z);
    const sign = (flag[t] === TANGENT_ORIENT) ? 1 : -1;
    const lS = vOs.length(), lT = vOt.length();
    if(lS > 1e-20){ os[t * 3] = sign * vOs.x / lS; os[t * 3 + 1] = sign * vOs.y / lS; os[t * 3 + 2] = sign * vOs.z / lS; }
    if(lT > 1e-20){ ot[t * 3] = sign * vOt.x / lT; ot[t * 3 + 1] = sign * vOt.y / lT; ot[t * 3 + 2] = sign * vOt.z / lT; }
  }
  return {os:os, ot:ot, flag:flag};
}

/**
 * Soudure de mikktspace : deux coins sont le MÊME sommet s'ils ont la même position, la même
 * normale ET les mêmes UV. C'est la soudure qui fait qu'une couture d'UV garde une tangente
 * continue là où la géométrie, elle, est continue.
 */
export function weldCornersTangent(geo, corner, nTri){
  const pos = geo.attributes.position, nor = geo.attributes.normal, uv = geo.attributes.uv;
  const map = new Map();
  const weld = new Int32Array(nTri * 3);
  for(let c = 0; c < nTri * 3; c++){
    const i = corner((c / 3) | 0, c % 3);
    const key = pos.getX(i) + ',' + pos.getY(i) + ',' + pos.getZ(i) + '|'
              + nor.getX(i) + ',' + nor.getY(i) + ',' + nor.getZ(i) + '|'
              + uv.getX(i) + ',' + uv.getY(i);
    const seen = map.get(key);
    if(seen === undefined){ map.set(key, c); weld[c] = c; }
    else weld[c] = seen;
  }
  return weld;
}

/**
 * Groupes de lissage : deux coins d'un même sommet soudé appartiennent au même groupe s'ils sont
 * reliés par une arête partagée entre deux faces DE MÊME ORIENTATION d'UV. Union-find sur les
 * coins — c'est la forme compacte des « 4 rule groups » de mikktspace.
 */
export function groupsTangent(weld, flag, corner, nTri){
  const parent = new Int32Array(nTri * 3);
  for(let c = 0; c < parent.length; c++) parent[c] = c;
  function find(x){
    while(parent[x] !== x){ parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  }
  function union(a, b){
    const ra = find(a), rb = find(b);
    if(ra !== rb) parent[ra] = rb;
  }
  // arête (sommets soudés) -> coins qui la portent, face par face
  const byEdge = new Map();
  for(let t = 0; t < nTri; t++){
    for(let k = 0; k < 3; k++){
      const ca = t * 3 + k, cb = t * 3 + (k + 1) % 3;
      const a = weld[ca], b = weld[cb];
      const key = (a < b) ? (a + '_' + b) : (b + '_' + a);
      const list = byEdge.get(key);
      if(list) list.push(ca); else byEdge.set(key, [ca]);
    }
  }
  byEdge.forEach(function(corners){
    for(let i = 1; i < corners.length; i++){
      const t0 = (corners[0] / 3) | 0, ti = (corners[i] / 3) | 0;
      if(flag[t0] !== flag[ti]) continue;      // UV en miroir : surtout ne pas moyenner
      // les DEUX extrémités de l'arête partagée
      for(let k0 = 0; k0 < 3; k0++){
        for(let ki = 0; ki < 3; ki++){
          if(weld[t0 * 3 + k0] === weld[ti * 3 + ki]) union(t0 * 3 + k0, ti * 3 + ki);
        }
      }
    }
  });
  // les coins d'un même sommet soudé qui ne se touchent pas restent dans des groupes distincts,
  // mais un coin et son soudé direct, eux, sont le même sommet
  for(let c = 0; c < parent.length; c++) if(weld[c] !== c) union(c, weld[c]);
  const group = new Int32Array(parent.length);
  for(let c = 0; c < parent.length; c++) group[c] = find(c);
  return group;
}

/**
 * Tangentes MikkTSpace. Écrit un attribut `tangent` à 4 composantes, `w` suivant la convention de
 * three (bitangente = cross(normal, tangent) × w) — la même que celle de `computeTangents()`, pour
 * que changer de mode ne change pas le sens des cartes de normales.
 *
 * Les sommets sont DÉDOUBLÉS là où un même index porterait deux groupes de lissage différents,
 * comme le fait le dépliage. C'est ce qui permet à une géométrie indexée d'avoir de vraies
 * tangentes de couture au lieu d'une moyenne des deux côtés.
 */
export function computeTangentsMikkTSpace(geo){
  const pos = geo.attributes.position, nor = geo.attributes.normal, uv = geo.attributes.uv;
  if(!pos || !nor || !uv) return null;
  const idx = geo.index ? geo.index.array : null;
  const nTri = Math.floor((idx ? idx.length : pos.count) / 3);
  if(!nTri) return null;
  const corner = function(t, k){ return idx ? idx[t * 3 + k] : t * 3 + k; };

  const basis = trianglesTangentBasis(geo, corner, nTri);
  const weld = weldCornersTangent(geo, corner, nTri);
  const group = groupsTangent(weld, basis.flag, corner, nTri);

  // Un sommet ne peut porter qu'une tangente : là où un index se retrouve dans deux groupes, il
  // faut une copie. Même mécanique que le dépliage, donc même retour en arrière.
  const split = splitCorners(nTri, corner, function(t, k){ return group[t * 3 + k]; }, pos.count);
  if(split.remap.length > pos.count){
    duplicateVertices(geo, split.remap);
    geo.setIndex(new THREE.BufferAttribute(split.newIndex, 1));
  }
  const count = split.remap.length;

  // accumulation par groupe, pondérée par l'angle au coin
  const sums = new Map();
  const p0 = new THREE.Vector3(), p1 = new THREE.Vector3(), p2 = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  const n = new THREE.Vector3(), vs = new THREE.Vector3(), vt = new THREE.Vector3();
  const position = geo.attributes.position, normal = geo.attributes.normal;
  for(let t = 0; t < nTri; t++){
    for(let k = 0; k < 3; k++){
      const slot = split.newIndex[t * 3 + k];
      const g = group[t * 3 + k];
      p0.fromBufferAttribute(position, slot);
      p1.fromBufferAttribute(position, split.newIndex[t * 3 + (k + 1) % 3]);
      p2.fromBufferAttribute(position, split.newIndex[t * 3 + (k + 2) % 3]);
      e1.subVectors(p1, p0); e2.subVectors(p2, p0);
      const l = e1.length() * e2.length();
      const angle = (l < 1e-20) ? 0 : Math.acos(Math.max(-1, Math.min(1, e1.dot(e2) / l)));
      if(angle <= 0) continue;
      n.fromBufferAttribute(normal, slot);
      // la base de la face, redressée dans le plan tangent du sommet
      vs.set(basis.os[t * 3], basis.os[t * 3 + 1], basis.os[t * 3 + 2]);
      vt.set(basis.ot[t * 3], basis.ot[t * 3 + 1], basis.ot[t * 3 + 2]);
      vs.addScaledVector(n, -n.dot(vs));
      vt.addScaledVector(n, -n.dot(vt));
      if(vs.lengthSq() > 1e-20) vs.normalize();
      if(vt.lengthSq() > 1e-20) vt.normalize();
      let acc = sums.get(g);
      if(!acc){ acc = {s:new THREE.Vector3(), t:new THREE.Vector3()}; sums.set(g, acc); }
      acc.s.addScaledVector(vs, angle);
      acc.t.addScaledVector(vt, angle);
    }
  }

  const out = new Float32Array(count * 4);
  const bitangent = new THREE.Vector3(), cross = new THREE.Vector3();
  for(let t = 0; t < nTri; t++){
    for(let k = 0; k < 3; k++){
      const slot = split.newIndex[t * 3 + k];
      const acc = sums.get(group[t * 3 + k]);
      if(!acc) continue;
      n.fromBufferAttribute(normal, slot);
      vs.copy(acc.s);
      vs.addScaledVector(n, -n.dot(vs));
      if(vs.lengthSq() < 1e-20) continue;
      vs.normalize();
      bitangent.copy(acc.t);
      if(bitangent.lengthSq() > 1e-20) bitangent.normalize();
      const w = (cross.crossVectors(n, vs).dot(bitangent) < 0) ? -1 : 1;
      out[slot * 4] = vs.x; out[slot * 4 + 1] = vs.y; out[slot * 4 + 2] = vs.z; out[slot * 4 + 3] = w;
    }
  }
  // Les sommets sans tangente exploitable — un pôle de sphère, un sommet dont les UV sont
  // dégénérés, un sommet qu'aucun triangle n'utilise. Zéro y serait pire qu'une valeur
  // arbitraire : le shader normaliserait (0,0,0) et rendrait du NaN, donc un pixel noir.
  const fallback = new THREE.Vector3(), axis = new THREE.Vector3();
  for(let i = 0; i < count; i++){
    if(out[i * 4] !== 0 || out[i * 4 + 1] !== 0 || out[i * 4 + 2] !== 0) continue;
    n.fromBufferAttribute(normal, i);
    axis.set(0, 0, 1);
    if(Math.abs(n.z) > 0.9) axis.set(1, 0, 0);
    fallback.crossVectors(axis, n);
    if(fallback.lengthSq() < 1e-20) fallback.set(1, 0, 0); else fallback.normalize();
    out[i * 4] = fallback.x; out[i * 4 + 1] = fallback.y; out[i * 4 + 2] = fallback.z;
    out[i * 4 + 3] = 1;
  }

  geo.setAttribute('tangent', new THREE.BufferAttribute(out, 4));
  geo.attributes.tangent.needsUpdate = true;
  return {vertices:count, added:count - pos.count, groups:sums.size};
}


// ---------- Dépliage de lightmap ----------
//
// Ce que le réglage résout : `js/lightmap-bake.js` se rabat sur `uv` quand il n'y a pas d'`uv1`,
// et diagnostiqueUnfold() n'a alors qu'un avertissement à offrir — « c'est un carrelage, pas un
// dépliage ». Un modèle qui carrelle sa texture écrivait donc l'éclairage de deux surfaces dans
// les mêmes texels. Générer `uv1` à l'import, c'est lui donner le dépliage qui lui manque.

/** Sommets confondus (même position) : l'adjacence des faces se lit sur eux, pas sur les index. */
export function weldByPosition(pos){
  const map = new Map();
  const weld = new Int32Array(pos.count);
  for(let i = 0; i < pos.count; i++){
    // quantification au dixième de millimètre : deux sommets d'une même arête sortent d'un
    // exportateur avec des bits de poids faible différents
    const key = Math.round(pos.getX(i) * 1e4) + ',' + Math.round(pos.getY(i) * 1e4)
              + ',' + Math.round(pos.getZ(i) * 1e4);
    const seen = map.get(key);
    if(seen === undefined){ map.set(key, i); weld[i] = i; }
    else weld[i] = seen;
  }
  return weld;
}

/**
 * Regroupe les triangles en îlots : on part d'une face, on avale ses voisines tant qu'elles
 * regardent dans la même direction (à `ANGLE_CHART_MAX` près de la moyenne de l'îlot).
 * Rend un tableau `chartOfTriangle`.
 */
export function chartsOfGeometry(geo, angleMax){
  const pos = geo.attributes.position;
  const idx = geo.index ? geo.index.array : null;
  const nTri = Math.floor((idx ? idx.length : pos.count) / 3);
  const weld = weldByPosition(pos);
  const corner = function(t, k){ return idx ? idx[t * 3 + k] : t * 3 + k; };

  // arête (deux sommets soudés) -> triangles qui la portent
  const byEdge = new Map();
  for(let t = 0; t < nTri; t++){
    for(let k = 0; k < 3; k++){
      const a = weld[corner(t, k)], b = weld[corner(t, (k + 1) % 3)];
      const key = (a < b) ? (a + '_' + b) : (b + '_' + a);
      const list = byEdge.get(key);
      if(list) list.push(t); else byEdge.set(key, [t]);
    }
  }

  const normals = new Float32Array(nTri * 3);
  const pA = new THREE.Vector3(), pB = new THREE.Vector3(), pC = new THREE.Vector3();
  const cb = new THREE.Vector3(), ab = new THREE.Vector3(), n = new THREE.Vector3();
  for(let t = 0; t < nTri; t++){
    pA.fromBufferAttribute(pos, corner(t, 0));
    pB.fromBufferAttribute(pos, corner(t, 1));
    pC.fromBufferAttribute(pos, corner(t, 2));
    n.crossVectors(cb.subVectors(pC, pB), ab.subVectors(pA, pB));
    if(n.lengthSq() > 1e-30) n.normalize(); else n.set(0, 1, 0);
    normals[t * 3] = n.x; normals[t * 3 + 1] = n.y; normals[t * 3 + 2] = n.z;
  }

  const cosMax = Math.cos((angleMax === undefined ? ANGLE_CHART_MAX : angleMax) * Math.PI / 180);
  const chartOf = new Int32Array(nTri).fill(-1);
  let nCharts = 0;
  for(let seed = 0; seed < nTri; seed++){
    if(chartOf[seed] !== -1) continue;
    const c = nCharts++;
    // Direction de référence FIGÉE sur la face de départ, jamais une moyenne courante. Une
    // moyenne qui suit les faces avalées dérive : sur une sphère, elle tourne avec l'îlot et
    // finit par en faire un seul, replié sur lui-même — un dépliage qui se recouvre partout,
    // donc exactement ce que le réglage est censé empêcher. Mesuré : une sphère rendait 1 îlot
    // et une aire UV de 1,16 (il faut ≤ 1). Figée, chaque face de l'îlot regarde à moins de
    // `angleMax` de la direction de projection, donc aucune ne s'y retourne.
    const axis = [normals[seed * 3], normals[seed * 3 + 1], normals[seed * 3 + 2]];
    chartOf[seed] = c;
    const queue = [seed];
    while(queue.length){
      const t = queue.pop();
      for(let k = 0; k < 3; k++){
        const a = weld[corner(t, k)], b = weld[corner(t, (k + 1) % 3)];
        const key = (a < b) ? (a + '_' + b) : (b + '_' + a);
        const voisins = byEdge.get(key) || [];
        for(let v = 0; v < voisins.length; v++){
          const u = voisins[v];
          if(chartOf[u] !== -1) continue;
          const d = normals[u * 3] * axis[0] + normals[u * 3 + 1] * axis[1] + normals[u * 3 + 2] * axis[2];
          if(d < cosMax) continue;
          chartOf[u] = c;
          queue.push(u);
        }
      }
    }
  }
  return {chartOf:chartOf, nCharts:nCharts, nTri:nTri};
}

/**
 * Range des rectangles dans le carré unité (étagères, les plus hauts d'abord) et rend l'échelle
 * commune à appliquer. Un packer maison plutôt que `potpack` (vendor) : `potpack` n'est pas dans
 * le jeu publié, et le runtime doit obtenir EXACTEMENT le même rangement que l'éditeur.
 */
export function packCharts(boxes){
  let area = 0, wMax = 0;
  boxes.forEach(function(b){ area += b.w * b.h; if(b.w > wMax) wMax = b.w; });
  const order = boxes.map(function(b, i){ return i; })
    .sort(function(i, j){
      const d = boxes[j].h - boxes[i].h;
      return d !== 0 ? d : (i - j);       // départage stable : même rangement partout
    });

  function layout(width, write){
    let x = 0, y = 0, shelf = 0, used = 0;
    for(let k = 0; k < order.length; k++){
      const b = boxes[order[k]];
      if(x + b.w > width && x > 0){ y += shelf; x = 0; shelf = 0; }
      if(write){ b.x = x; b.y = y; }
      x += b.w;
      if(b.h > shelf) shelf = b.h;
      if(y + shelf > used) used = y + shelf;
    }
    return used || 1;
  }

  // Le carré final est le côté le plus long : une largeur mal choisie fait perdre de la
  // résolution partout dans la lightmap. Quelques largeurs sont essayées et la meilleure gagne
  // — c'est déterministe, donc l'éditeur et le jeu rangent toujours pareil.
  const base = Math.max(wMax, Math.sqrt(area)) || 1;
  let width = base, best = Infinity;
  [0.8, 1, 1.1, 1.2, 1.5, 2].forEach(function(f){
    const w = Math.max(wMax, base * f);
    const side = Math.max(w, layout(w, false));
    if(side < best - 1e-9){ best = side; width = w; }
  });
  return {width:width, height:layout(width, true)};
}

/**
 * Écrit `uv1` : un dépliage par projection plane, un îlot à la fois, rangé dans le carré unité.
 *
 * DÉDOUBLEMENT DES SOMMETS. Un sommet partagé par deux îlots ne peut pas porter deux UV : il
 * est recopié, une fois par îlot supplémentaire. Les copies sont AJOUTÉES À LA FIN et les
 * sommets d'origine gardent leur index — c'est ce qui permet de revenir en arrière en tronquant
 * les attributs, sans garder une copie de toute la géométrie.
 */
export function unwrapLightmapUv(geo, opts){
  const pos = geo.attributes.position;
  if(!pos || !pos.count) return null;
  const o = opts || {};
  const margin = (o.margin === undefined) ? MARGIN_CHART : o.margin;
  const info = chartsOfGeometry(geo, o.angleMax);
  if(!info.nTri) return null;
  const idx = geo.index ? geo.index.array : null;
  const corner = function(t, k){ return idx ? idx[t * 3 + k] : t * 3 + k; };
  const count = pos.count;

  // 1. une place par (sommet, îlot) — l'îlot qui arrive le premier garde l'index d'origine
  const split = splitCorners(info.nTri, corner, function(t){ return info.chartOf[t]; }, count);
  const remap = split.remap, newIndex = split.newIndex, chartOfSlot = split.keyOfSlot;

  // 2. projection plane par îlot : base (T, B) orthogonale à sa normale moyenne
  const normals = new Array(info.nCharts);
  for(let c = 0; c < info.nCharts; c++) normals[c] = new THREE.Vector3();
  const pA = new THREE.Vector3(), pB = new THREE.Vector3(), pC = new THREE.Vector3();
  const cb = new THREE.Vector3(), ab = new THREE.Vector3(), n = new THREE.Vector3();
  for(let t = 0; t < info.nTri; t++){
    pA.fromBufferAttribute(pos, corner(t, 0));
    pB.fromBufferAttribute(pos, corner(t, 1));
    pC.fromBufferAttribute(pos, corner(t, 2));
    n.crossVectors(cb.subVectors(pC, pB), ab.subVectors(pA, pB));
    normals[info.chartOf[t]].add(n);
  }
  const axes = new Array(info.nCharts);
  const up = new THREE.Vector3();
  for(let c = 0; c < info.nCharts; c++){
    const nc = normals[c];
    if(nc.lengthSq() < 1e-30) nc.set(0, 1, 0); else nc.normalize();
    up.set(0, 1, 0);
    if(Math.abs(nc.dot(up)) > 0.99) up.set(1, 0, 0);
    const tan = new THREE.Vector3().crossVectors(up, nc).normalize();
    const bit = new THREE.Vector3().crossVectors(nc, tan).normalize();
    axes[c] = {t:tan, b:bit};
  }

  const uv = new Float32Array(remap.length * 2);
  const boxes = new Array(info.nCharts);
  for(let c = 0; c < info.nCharts; c++) boxes[c] = {minU:Infinity, minV:Infinity, maxU:-Infinity, maxV:-Infinity, w:0, h:0, x:0, y:0};
  const p = new THREE.Vector3();
  for(let s = 0; s < remap.length; s++){
    const c = chartOfSlot[s];
    if(c === undefined || c < 0) continue;
    p.fromBufferAttribute(pos, remap[s]);
    const u = p.dot(axes[c].t), v = p.dot(axes[c].b);
    uv[s * 2] = u; uv[s * 2 + 1] = v;
    const bx = boxes[c];
    if(u < bx.minU) bx.minU = u;
    if(u > bx.maxU) bx.maxU = u;
    if(v < bx.minV) bx.minV = v;
    if(v > bx.maxV) bx.maxV = v;
  }
  boxes.forEach(function(bx){
    if(!isFinite(bx.minU)){ bx.minU = bx.minV = 0; bx.maxU = bx.maxV = 0; }
    // un îlot plat (tous les points alignés) aurait une hauteur nulle : il occuperait une
    // bande de zéro pixel et disparaîtrait de la lightmap
    bx.w = Math.max(bx.maxU - bx.minU, 1e-6) + margin * 2;
    bx.h = Math.max(bx.maxV - bx.minV, 1e-6) + margin * 2;
  });

  // 3. rangement, puis mise à l'échelle commune pour tenir dans [0, 1]
  const dim = packCharts(boxes);
  const scale = 1 / Math.max(dim.width, dim.height);
  for(let s = 0; s < remap.length; s++){
    const c = chartOfSlot[s];
    if(c === undefined || c < 0){ uv[s * 2] = 0; uv[s * 2 + 1] = 0; continue; }
    const bx = boxes[c];
    uv[s * 2]     = (bx.x + margin + (uv[s * 2]     - bx.minU)) * scale;
    uv[s * 2 + 1] = (bx.y + margin + (uv[s * 2 + 1] - bx.minV)) * scale;
  }

  // 4. écriture : d'abord les sommets dédoublés, puis uv1, puis l'index
  if(remap.length > count) duplicateVertices(geo, remap);
  geo.setAttribute('uv1', new THREE.BufferAttribute(uv, 2));
  geo.attributes.uv1.needsUpdate = true;
  geo.setIndex(new THREE.BufferAttribute(newIndex, 1));
  // Les caches de cuisson portent sur l'ANCIEN jeu d'UV : les garder ferait ranger dans
  // l'atlas un dépliage qui n'existe plus (voir sourceUvFrozen, js/lightmap-bake.js).
  delete geo.userData.lightmapUvSource;
  delete geo.userData.lightmapAtlas;
  geo.userData.lightmapUnwrapped = true;
  return {charts:info.nCharts, vertices:remap.length, added:remap.length - count};
}

/**
 * Alloue une place par (sommet, clé) — la clé étant l'îlot du dépliage ou le groupe de lissage
 * des tangentes. Un sommet dont tous les coins portent la même clé garde SON index ; les autres
 * reçoivent une copie, ajoutée À LA FIN. C'est cette règle qui rend le retour en arrière possible
 * par simple troncature (`restoreVertices`), sans copie de toute la géométrie.
 */
export function splitCorners(nTri, corner, keyOf, countVertices){
  const firstKey = new Array(countVertices);
  for(let t = 0; t < nTri; t++){
    for(let k = 0; k < 3; k++){
      const v = corner(t, k);
      if(firstKey[v] === undefined) firstKey[v] = keyOf(t, k);
    }
  }
  const remap = new Array(countVertices);
  for(let i = 0; i < countVertices; i++) remap[i] = i;
  const keyOfSlot = firstKey.slice();
  const extra = new Map();
  const newIndex = new Uint32Array(nTri * 3);
  for(let t = 0; t < nTri; t++){
    for(let k = 0; k < 3; k++){
      const v = corner(t, k), key = keyOf(t, k);
      let slot = v;
      if(firstKey[v] !== key){
        const kk = v + ':' + key;
        slot = extra.get(kk);
        if(slot === undefined){
          slot = remap.length;
          extra.set(kk, slot);
          remap.push(v);
          keyOfSlot.push(key);
        }
      }
      newIndex[t * 3 + k] = slot;
    }
  }
  return {remap:remap, newIndex:newIndex, keyOfSlot:keyOfSlot};
}

/** Rallonge tous les attributs (et les morph targets) selon `remap` : `new[i] = old[remap[i]]`. */
export function duplicateVertices(geo, remap){
  function rebuild(attr){
    const out = new attr.array.constructor(remap.length * attr.itemSize);
    for(let i = 0; i < remap.length; i++){
      const src = remap[i] * attr.itemSize, dst = i * attr.itemSize;
      for(let k = 0; k < attr.itemSize; k++) out[dst + k] = attr.array[src + k];
    }
    const a = new THREE.BufferAttribute(out, attr.itemSize, attr.normalized);
    a.needsUpdate = true;
    return a;
  }
  Object.keys(geo.attributes).forEach(function(name){
    geo.setAttribute(name, rebuild(geo.attributes[name]));
  });
  Object.keys(geo.morphAttributes || {}).forEach(function(name){
    geo.morphAttributes[name] = geo.morphAttributes[name].map(rebuild);
  });
}

/** Ramène la géométrie au nombre de sommets et à l'index du fichier. */
export function restoreVertices(geo, origin){
  if(!origin || !origin.countVertices) return false;
  const pos = geo.attributes.position;
  if(pos && pos.count > origin.countVertices){
    Object.keys(geo.attributes).forEach(function(name){
      const a = geo.attributes[name];
      const out = a.array.slice(0, origin.countVertices * a.itemSize);
      geo.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize, a.normalized));
    });
    Object.keys(geo.morphAttributes || {}).forEach(function(name){
      geo.morphAttributes[name] = geo.morphAttributes[name].map(function(a){
        return new THREE.BufferAttribute(a.array.slice(0, origin.countVertices * a.itemSize),
                                         a.itemSize, a.normalized);
      });
    });
  }
  if(origin.index) geo.setIndex(new THREE.BufferAttribute(origin.index.slice(), 1));
  else geo.setIndex(null);
  delete geo.userData.lightmapUvSource;
  delete geo.userData.lightmapAtlas;
  delete geo.userData.lightmapUnwrapped;
  return true;
}


// ---------- L'application, géométrie par géométrie ----------

export function applyGeoImport(geo, p, warnings, label){
  // Même raison que pour la hiérarchie : `applyImportModel` repasse ici à chaque retouche de
  // matériau, et réécrire les normales à chaque fois, c'est un envoi au GPU pour rien.
  const signature = [p.normals, p.normalsMode, p.tangents, p.lightmapUv, p.skinWeights,
                     p.importBlendShapes, p.blendShapeNormals, p.smoothnessSource,
                     p.smoothingAngle, p.swapUvs, p.lightmapHardAngle,
                     p.lightmapPackMargin].join('|');
  if(geo.userData.importApplied === signature) return;
  geo.userData.importApplied = signature;
  const origin = rememberGeoOrigin(geo);

  // ON REPART TOUJOURS DE L'ÉTAT DU FICHIER. Le dépliage comme les tangentes DÉDOUBLENT des
  // sommets ; enchaîner deux réglages sans revenir en arrière empilerait les copies, et l'ordre
  // des changements finirait par compter. Ce n'est pas cher : on ne passe ici que quand un
  // réglage a vraiment changé.
  restoreVertices(geo, origin);
  restoreAttribute(geo, 'normal', origin.normal);
  restoreAttribute(geo, 'tangent', origin.tangent);
  // `uv` n'est mémorisé que depuis « Swap UVs » : une origine plus ancienne ne l'a pas, et
  // l'effacer sur elle détruirait les UV de texture.
  if(origin.uv !== undefined) restoreAttribute(geo, 'uv', origin.uv);
  restoreAttribute(geo, 'uv1', origin.uv1);
  if(origin.skinWeight) restoreAttribute(geo, 'skinWeight', origin.skinWeight);
  restoreMorphs(geo);
  if(p.importBlendShapes === false) geo.morphAttributes = {};

  // Swap UVs AVANT le dépliage : Unity échange les jeux du fichier, la génération de lightmap
  // vient ensuite et écrit uv1 par-dessus si elle est demandée.
  if(p.swapUvs){
    const uv = geo.attributes.uv, uv1 = geo.attributes.uv1;
    if(uv1) geo.setAttribute('uv', uv1); else geo.deleteAttribute('uv');
    if(uv) geo.setAttribute('uv1', uv); else geo.deleteAttribute('uv1');
  }

  // 0. les poids de peau : avant tout le reste, parce que le dédoublement de sommets qui suit
  //    recopie les attributs tels qu'ils sont à ce moment-là.
  const skin = applySkinWeights(geo, p.skinWeights);
  if(skin) geo.userData.importSkin = skin;

  // 1. le dépliage d'abord : ce qui suit doit travailler sur la géométrie définitive
  if(p.lightmapUv && !unwrapLightmapUv(geo, {angleMax: p.lightmapHardAngle,
      margin: Math.max(0, p.lightmapPackMargin) / 1024})) warnings.push(label + ' : rien à déplier');

  // 2. normales
  if(p.normals === 'none') geo.deleteAttribute('normal');
  else if(p.normals === 'calculate'){
    if(p.smoothnessSource === 'angle') computeNormalsByAngle(geo, p.normalsMode, p.smoothingAngle);
    else if(p.smoothnessSource === 'none') computeNormalsByAngle(geo, p.normalsMode, 0);
    else computeNormalsWeighted(geo, p.normalsMode);
  }
  // « Importer » sur un fichier qui n'en a pas : il en faut quand même, sinon le maillage est
  // noir. Unity fait pareil — l'option dit d'où elles viennent, pas s'il peut ne pas y en avoir.
  else if(!geo.attributes.normal) computeNormalsWeighted(geo, p.normalsMode);

  // 2 bis. normales des blend shapes, une fois celles du maillage définitives
  if(geo.morphAttributes && geo.morphAttributes.position){
    if(p.blendShapeNormals === 'none') delete geo.morphAttributes.normal;
    else if(p.blendShapeNormals === 'calculate') computeMorphNormals(geo, p.normalsMode);
  }

  // 3. tangentes (après les normales : leur calcul en dépend)
  if(p.tangents === 'none') geo.deleteAttribute('tangent');
  else if(p.tangents === 'mikktspace' || p.tangents === 'calculate'){
    if(!geo.attributes.normal || !geo.attributes.uv){
      warnings.push(label + ' : tangentes non calculables (il faut des normales et des UV)');
    }
    else if(p.tangents === 'mikktspace'){
      if(!computeTangentsMikkTSpace(geo)) warnings.push(label + ' : tangentes non calculables');
    }
    else if(!geo.index){
      warnings.push(label + ' : le calcul hérité de three exige une géométrie indexée '
        + '(Mikktspace, lui, n\'en a pas besoin)');
    }
    else {
      try { geo.computeTangents(); }
      catch(e){ warnings.push(label + ' : ' + (e && e.message ? e.message : 'calcul des tangentes impossible')); }
    }
  }
}

/**
 * Applique les réglages de géométrie à tout le modèle. Une géométrie partagée par deux maillages
 * n'est traitée qu'une fois — c'est le cas courant d'un modèle instancié dans son propre fichier.
 */
export function applyModelGeometry(root, params){
  const p = Object.assign({}, MODEL_IMPORT_DEFAULT, params || {});
  const warnings = [];
  const seen = new Set();
  let charts = 0, meshes = 0, skinClamped = 0, skinRenormalized = 0;
  root.traverse(function(o){
    if(!o.isMesh || !o.geometry || o.userData.isColliderViz) return;
    if(seen.has(o.geometry)) return;
    seen.add(o.geometry);
    meshes++;
    applyGeoImport(o.geometry, p, warnings, o.name || 'maillage');
    // Des blend shapes retirées ou rendues : le maillage doit relire la liste de ses cibles.
    // `updateMorphTargets` de three ne fait RIEN quand il n'y a plus de cible : les poids de
    // l'ancienne liste resteraient, et un script qui les lit verrait des formes fantômes.
    if(!Object.keys(o.geometry.morphAttributes || {}).length){
      o.morphTargetInfluences = undefined;
      o.morphTargetDictionary = undefined;
    }
    else if(o.updateMorphTargets) o.updateMorphTargets();
    if(o.geometry.userData.lightmapUnwrapped) charts++;
    const s = o.geometry.userData.importSkin;
    if(s){ skinClamped += s.clamped; skinRenormalized += s.renormalized; }
  });
  return {meshes:meshes, unwrapped:charts, warnings:warnings,
          skinClamped:skinClamped, skinRenormalized:skinRenormalized};
}

// ---------- Animation : Import Animation, et la réduction de clés ----------
//
// « Anim. Compression : Keyframe Reduction » d'Unity. Un export Mixamo ou Maya écrit une clé par
// image et par os, qu'elle serve ou non : sur une marche de 30 images et 65 os, la plupart des
// clés de position sont redondantes. Une clé est retirée quand l'interpolation entre ses voisines
// GARDÉES la redonne à la tolérance près — degrés pour les rotations, pour cent de l'amplitude de
// la piste pour les positions et les échelles, comme les trois « Error » d'Unity.
//
// Partagé avec le runtime, pour la même raison que la géométrie : le résultat n'est pas
// sérialisé, le jeu publié le rejoue.

const reducedByClips = new WeakMap();

function angleBetweenQuats(v, i, w, j){
  const dot = Math.abs(v[i] * w[j] + v[i + 1] * w[j + 1] + v[i + 2] * w[j + 2] + v[i + 3] * w[j + 3]);
  return 2 * Math.acos(Math.min(1, dot)) * 180 / Math.PI;
}

/** Réduit les clés d'une piste. Rend `{times, values}` — les tableaux d'origine si rien ne part. */
export function reduceTrackKeys(times, values, size, tolerance, isQuat){
  const n = times.length;
  if(n < 3) return {times: times, values: values};
  const keep = [0];
  const tmp = new Float32Array(size);
  for(let i = 1; i < n - 1; i++){
    // l'interpolation entre la dernière clé GARDÉE et la suivante
    const a = keep[keep.length - 1], b = i + 1;
    const k = (times[i] - times[a]) / ((times[b] - times[a]) || 1);
    let sign = 1;
    if(isQuat){
      let dot = 0;
      for(let c = 0; c < 4; c++) dot += values[a * 4 + c] * values[b * 4 + c];
      sign = dot < 0 ? -1 : 1;
    }
    for(let c = 0; c < size; c++){
      tmp[c] = values[a * size + c] * (1 - k) + values[b * size + c] * sign * k;
    }
    let err;
    if(isQuat){
      const l = Math.hypot(tmp[0], tmp[1], tmp[2], tmp[3]) || 1;
      for(let c = 0; c < 4; c++) tmp[c] /= l;
      err = angleBetweenQuats(tmp, 0, values, i * 4);
    } else {
      err = 0;
      for(let c = 0; c < size; c++) err = Math.max(err, Math.abs(tmp[c] - values[i * size + c]));
    }
    if(err > tolerance) keep.push(i);
  }
  keep.push(n - 1);
  if(keep.length === n) return {times: times, values: values};
  const t2 = new Float32Array(keep.length), v2 = new Float32Array(keep.length * size);
  keep.forEach(function(src, dst){
    t2[dst] = times[src];
    for(let c = 0; c < size; c++) v2[dst * size + c] = values[src * size + c];
  });
  return {times: t2, values: v2};
}

/** L'amplitude d'une piste, base de la tolérance « en pour cent » des positions et échelles. */
function amplitudeOfTrack(values, size){
  let m = 0;
  for(let c = 0; c < size; c++){
    let lo = Infinity, hi = -Infinity;
    for(let k = c; k < values.length; k += size){
      if(values[k] < lo) lo = values[k];
      if(values[k] > hi) hi = values[k];
    }
    m = Math.max(m, hi - lo, Math.abs(hi), Math.abs(lo));
  }
  return m || 1;
}

/**
 * Les clips que le modèle expose, d'après les réglages de l'onglet Animation. `raw` : les prises
 * du fichier, jamais modifiées. Le résultat est mémorisé tant que les réglages ne changent pas —
 * un clip neuf à chaque application ferait repartir de zéro toutes les actions du mixeur.
 */
export function applyAnimationImport(raw, params){
  const p = Object.assign({}, MODEL_IMPORT_DEFAULT, params || {});
  const clips = raw || [];
  if(p.importAnimation === false) return [];
  if(p.animCompression !== 'reduction') return clips;
  const signature = [p.animRotationError, p.animPositionError, p.animScaleError].join('|');
  const memo = reducedByClips.get(clips);
  if(memo && memo.signature === signature) return memo.result;
  const result = clips.map(function(clip){
    const tracks = clip.tracks.map(function(t){
      const size = t.getValueSize ? t.getValueSize() : (t.values.length / t.times.length);
      const prop = t.name.slice(t.name.lastIndexOf('.') + 1);
      const isQuat = prop === 'quaternion';
      let tol;
      if(isQuat) tol = Math.max(0, p.animRotationError);
      else if(prop === 'position' || prop === 'scale'){
        const e = prop === 'position' ? p.animPositionError : p.animScaleError;
        tol = Math.max(0, e) / 100 * amplitudeOfTrack(t.values, size);
      }
      else return t;   // morph targets, visibilité… : pas de tolérance définie, on n'y touche pas
      const r = reduceTrackKeys(t.times, t.values, size, tol, isQuat);
      if(r.times === t.times) return t;
      return new t.constructor(t.name, r.times, r.values);
    });
    return new THREE.AnimationClip(clip.name, clip.duration, tracks, clip.blendMode);
  });
  reducedByClips.set(clips, {signature: signature, result: result});
  return result;
}

globalThis.applyAnimationImport = applyAnimationImport;


// ---------- Matériaux du fichier : Material Creation Mode et sRGB Albedo Colors ----------
//
// Ce qu'un emplacement de matériau porte quand AUCUN matériau du projet ne le remplace. Partagé
// avec le runtime : le jeu publié ne relit que les réglages, il doit refabriquer le même matériau.
//
//   import   — le matériau tel que le chargeur l'a construit (« Import via MaterialDescription »)
//   standard — un MeshStandardMaterial PBR refait à partir de ce que le fichier déclare, pour les
//              matériaux Phong / Lambert du chargeur FBX (« Standard (Legacy) ») ; la rugosité est
//              tirée de la brillance, le métal est nul
//   none     — un matériau par défaut, gris (« None »)
//
// « sRGB Albedo Colors » décoché : la couleur écrite dans le fichier est LINÉAIRE. Le chargeur de
// three l'a pourtant convertie comme si elle était sRGB ; on défait donc cette conversion.

const fileMaterials = new WeakMap();

const KEYS_MAPS_FILE = ['map', 'normalMap', 'emissiveMap', 'aoMap', 'alphaMap', 'bumpMap',
                        'lightMap', 'roughnessMap', 'metalnessMap', 'displacementMap'];

function standardFromFile(mb){
  const m = new THREE.MeshStandardMaterial();
  if(mb.color) m.color.copy(mb.color);
  KEYS_MAPS_FILE.forEach(function(k){ if(mb[k] && k in m) m[k] = mb[k]; });
  if(mb.normalScale && m.normalScale) m.normalScale.copy(mb.normalScale);
  if(mb.emissive) m.emissive.copy(mb.emissive);
  if(mb.emissiveIntensity !== undefined) m.emissiveIntensity = mb.emissiveIntensity;
  ['opacity', 'transparent', 'side', 'alphaTest', 'vertexColors', 'flatShading', 'bumpScale',
   'displacementScale', 'aoMapIntensity'].forEach(function(k){
    if(mb[k] !== undefined && k in m) m[k] = mb[k];
  });
  // Phong : la brillance (0–1000) donne la rugosité par l'approximation de Blinn-Phong
  // α = √(2 / (n + 2)). Un Lambert n'a pas de reflet : il est mat.
  m.roughness = (typeof mb.shininess === 'number')
    ? Math.max(0.04, Math.min(1, Math.sqrt(2 / (mb.shininess + 2)))) : (mb.roughness !== undefined ? mb.roughness : 1);
  m.metalness = mb.metalness !== undefined ? mb.metalness : 0;
  return m;
}

/** Le matériau qu'un emplacement du FICHIER porte, selon les réglages de l'onglet Matériaux. */
export function fileMaterialFor(mb, params){
  if(!mb) return mb;
  const p = Object.assign({}, MODEL_IMPORT_DEFAULT, params || {});
  const mode = p.materialCreation || 'import', srgb = p.srgbAlbedo !== false;
  if(mode === 'import' && srgb) return mb;
  const signature = mode + '|' + srgb;
  let memo = fileMaterials.get(mb);
  if(!memo){ memo = new Map(); fileMaterials.set(mb, memo); }
  if(memo.has(signature)) return memo.get(signature);
  let out;
  if(mode === 'none') out = new THREE.MeshStandardMaterial({color: 0xcccccc, roughness: 0.6, metalness: 0});
  else if(mode === 'standard' && !mb.isMeshStandardMaterial) out = standardFromFile(mb);
  else out = mb.clone();
  out.name = mb.name;
  if(!srgb && mode !== 'none' && out.color && out.color.convertLinearToSRGB) out.color.convertLinearToSRGB();
  memo.set(signature, out);
  return out;
}

globalThis.fileMaterialFor = fileMaterialFor;

// L'éditeur charge ce fichier comme module ES ; le jeu publié aussi. Les globales ne servent
// qu'aux fichiers gardés par `typeof` (voir docs/ARCHITECTURE.md).
globalThis.MODEL_IMPORT_DEFAULT = MODEL_IMPORT_DEFAULT;
globalThis.applyModelGeometry = applyModelGeometry;
globalThis.applyModelHierarchy = applyModelHierarchy;
