// ---------- L'ATLAS DE LIGHTMAP : la transformée d'UV, PARTAGÉE éditeur ↔ jeu publié ----------
//
// Ce fichier ne cuit rien. Il ne porte que les quatre fonctions qui décrivent OÙ un maillage
// se trouve dans son atlas, et qui savent reposer cette position sur une géométrie. La
// cuisson elle-même reste dans `js/lightmap-bake.js`.
//
// POURQUOI IL EXISTE (le défaut qui l'a produit, v0.149.3). `reapplyAtlasLightmap()` ne vivait
// que dans `js/lightmap-bake.js` — un fichier qui importe douze modules d'éditeur (`assets.js`,
// `ui.js`, `selection.js`, `scene.js`…) et qui n'est donc NI dans `js/build.js` NI dans
// `game-preview.html`, et ne pourra jamais y être. Le champ `lightmapAtlas` partait pourtant
// dans chaque fichier de projet, écrit par `serializeObject`. Résultat, côté jeu : un champ
// **écrit et inapplicable**. Les objets partageant un atlas cuit recevaient la mauvaise
// transformation d'UV — donc l'éclairage d'un autre objet — sans une seule erreur console.
//
// C'est la même forme que les ombres par objet et le LOD (v0.149.2, docs/KNOWN_ISSUES.md) :
// un réglage qui tient dans l'éditeur et disparaît à la publication. Ici la cause n'était pas
// une ligne oubliée mais une DÉPENDANCE : la fonction était du bon côté de la logique et du
// mauvais côté du graphe de modules.
//
// LA RAISON DE FOND, qui ne saute pas aux yeux : l'`uv1` fabriqué par la cuisson n'est nulle
// part dans le fichier du modèle. À la réouverture, un .glb rapporte SON uv1 d'origine — donc
// l'attribut existe, les vérifications se taisent, et la lightmap se retrouve plaquée
// n'importe où. On ne persiste pas le tableau d'UV (lourd, et redondant avec le modèle) mais
// les quatre nombres de l'affine, rejoués ici sur le jeu d'UV d'origine.
//
// AUCUN IMPORT, et c'est la condition pour qu'il soit chargeable par les trois pages
// (règle 1 du graphe de modules, voir docs/ARCHITECTURE.md). Il ne touche que `THREE`, posé
// en global par les vendors.

// Le jeu d'UV d'origine, gelé à la première demande.
//
// Il est MÉMORISÉ sur la géométrie parce que `setTransformedAtlas()` écrase `uv1` : sans
// copie, un second rangement partirait du résultat du premier, et les îlots rétréciraient à
// chaque cuisson jusqu'à disparaître — avec une image plausible à chaque étape.
export function sourceUvFrozen(geo, name){
  const g = geo.userData.lightmapUvSource;
  if(g && g.game === name) return g.values;
  const a = geo.attributes[name];
  if(!a) return null;
  const values = new Float32Array(a.count * 2);
  for(let i = 0; i < a.count; i++){ values[i*2] = a.getX(i); values[i*2+1] = a.getY(i); }
  geo.userData.lightmapUvSource = {game:name, values:values};
  return values;
}

// Écrit `uv1` = position dans l'atlas, et mémorise la transformation qui y mène. C'est une
// affine par axe, donc quatre nombres suffisent à la rejouer — voir l'en-tête pour pourquoi
// c'est ce qu'on persiste plutôt que le tableau.
export function setTransformedAtlas(geo, name, scale, offset){
  const src = sourceUvFrozen(geo, name);
  if(!src) return false;
  const n = src.length / 2;
  const dst = new Float32Array(n * 2);
  for(let i = 0; i < n; i++){
    dst[i*2]   = src[i*2]   * scale[0] + offset[0];
    dst[i*2+1] = src[i*2+1] * scale[1] + offset[1];
  }
  geo.setAttribute('uv1', new THREE.BufferAttribute(dst, 2));
  geo.attributes.uv1.needsUpdate = true;
  geo.userData.lightmapAtlas = {game:name, scale:[scale[0], scale[1]],
                                offset:[offset[0], offset[1]]};
  return true;
}

// Rejoue l'atlas après un rechargement de projet. Appelé par les DEUX moteurs :
// `rebuildTree()` (js/serialization.js) et `buildList()` (js/game-runtime.js), dans les deux
// cas AVANT d'appliquer le matériau — c'est lui qui branchera la lightmap sur `uv1`, et `uv1`
// doit déjà être celui de l'atlas, pas celui du fichier de modèle.
export function reapplyAtlasLightmap(o){
  const list = o.userData.lightmapAtlas;
  if(!list || !list.length) return;
  let i = 0;
  o.traverse(function(x){
    if(!x.isMesh || !x.geometry) return;
    const t = list[i++];
    if(!t || !t.game) return;
    if(x.geometry.userData.lightmapAtlas) return;   // déjà posé dans cette session
    // LA GÉOMÉTRIE EST DÉTACHÉE AVANT D'ÊTRE ÉCRITE. Les primitives partagent une seule
    // géométrie par forme (js/primitive-geometry.js) : y écrire `uv1` donnerait à tous les
    // cubes de la scène l'éclairage cuit d'un seul, et aucune erreur ne le dirait. `typeof`
    // plutôt qu'un import : ce fichier n'en a aucun, à dessein (voir l'en-tête).
    const geo = (typeof geometryForWrite === 'function') ? geometryForWrite(x) : x.geometry;
    setTransformedAtlas(geo, t.game, t.scale, t.offset);
  });
}

// L'inverse, appelé par la sérialisation : aplatit les transformées des maillages d'un objet
// dans l'ordre de parcours, LE MÊME que celui de la relecture ci-dessus. Les deux fonctions
// s'apparient par l'indice, donc ce parcours est un contrat : le changer d'un côté sans
// l'autre décalerait toutes les lightmaps d'un maillage.
export function collectAtlasLightmap(o){
  const list = [];
  let trouve = false;
  o.traverse(function(x){
    if(!x.isMesh || !x.geometry) return;
    const t = x.geometry.userData.lightmapAtlas;
    if(t){ trouve = true; list.push({game:t.game, scale:t.scale, offset:t.offset}); }
    else list.push(null);
  });
  return trouve ? list : null;
}
