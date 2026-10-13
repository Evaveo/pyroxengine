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
// UN SEUL IMPORT, pur : js/lightmap-unwrap.js (v1.11.0), lui-même sans import. Aucun module
// d'éditeur — c'est la condition pour qu'il soit chargeable par les trois pages (règle 1 du graphe
// de modules, voir docs/ARCHITECTURE.md). Il ne touche que `THREE`, posé en global par les vendors.
import { unwrapTriangles } from './lightmap-unwrap.js';

// DÉPLIAGE AUTOMATIQUE (v1.11.0). Le jeu d'origine `'auto'` n'est pas un attribut : c'est l'uv
// GÉNÉRÉ par unwrapTriangles() à partir des positions locales, avec la marge `pad` de l'entrée
// d'atlas. Rien de lourd n'est donc persisté : la relecture refait le même calcul, à l'identique
// dans l'éditeur et dans le jeu. Il faut une carte par triangle, donc des sommets non partagés :
// la géométrie est d'abord DÉSINDEXÉE (même rendu, sommets dupliqués) — prepareAutoUnwrap().
export const AUTO_UV = 'auto';

/** Rend la géométrie du maillage prête au dépliage automatique (non indexée, propre à lui). */
export function prepareAutoUnwrap(mesh){
  const geo = mesh.geometry;
  if(geo.index){
    const flat = geo.toNonIndexed();
    flat.name = geo.name;
    // Le TYPE et les paramètres suivent : la physique lit `geometry.type` d'une primitive pour
    // choisir sa forme de collision exacte (js/rigid-body.js), toNonIndexed() les perdrait.
    flat.type = geo.type;
    if(geo.parameters) flat.parameters = Object.assign({}, geo.parameters);
    mesh.geometry = flat;
    return flat;
  }
  return (typeof geometryForWrite === 'function') ? geometryForWrite(mesh) : geo;
}

// Le jeu d'UV d'origine, gelé à la première demande.
//
// Il est MÉMORISÉ sur la géométrie parce que `setTransformedAtlas()` écrase `uv1` : sans
// copie, un second rangement partirait du résultat du premier, et les îlots rétréciraient à
// chaque cuisson jusqu'à disparaître — avec une image plausible à chaque étape.
export function sourceUvFrozen(geo, name, pad){
  const g = geo.userData.lightmapUvSource;
  if(g && g.game === name && (name !== AUTO_UV || g.pad === pad)) return g.values;
  if(name === AUTO_UV){
    const pos = geo.attributes.position;
    if(!pos || geo.index) return null;   // prepareAutoUnwrap() d'abord
    const flat = new Float32Array(pos.count * 3);
    for(let i = 0; i < pos.count; i++){ flat[i*3] = pos.getX(i); flat[i*3+1] = pos.getY(i); flat[i*3+2] = pos.getZ(i); }
    const values = unwrapTriangles(flat, pad);
    geo.userData.lightmapUvSource = {game:name, values:values, pad:pad};
    return values;
  }
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
export function setTransformedAtlas(geo, name, scale, offset, pad){
  const src = sourceUvFrozen(geo, name, pad);
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
  if(name === AUTO_UV) geo.userData.lightmapAtlas.pad = pad;
  return true;
}

// L'inverse de `setTransformedAtlas` : rend à la géométrie le jeu d'UV qu'elle avait avant la
// cuisson (« Effacer la cuisson », js/lightmap-bake.js). Si la cuisson était partie d'un `uv1`
// d'origine, il est REPOSÉ tel qu'il a été gelé ; si elle était partie de `uv` (pas de second jeu),
// l'`uv1` qu'elle avait fabriqué est RETIRÉ — la géométrie redevient ce qu'elle était. Rend vrai
// quand il y avait un atlas à retirer.
export function clearTransformedAtlas(geo){
  const t = geo && geo.userData.lightmapAtlas;
  if(!t) return false;
  const g = geo.userData.lightmapUvSource;
  if(t.game === 'uv1' && g && g.game === 'uv1'){
    geo.setAttribute('uv1', new THREE.BufferAttribute(new Float32Array(g.values), 2));
    geo.attributes.uv1.needsUpdate = true;
  } else if(t.game !== 'uv1' && geo.attributes.uv1){
    geo.deleteAttribute('uv1');
  }
  delete geo.userData.lightmapAtlas;
  delete geo.userData.lightmapUvSource;
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
    if(t.lightmap) x.userData.lightmapOverride = t.lightmap;   // voir applyLightmapOverrides
    if(x.geometry.userData.lightmapAtlas) return;   // déjà posé dans cette session
    // LA GÉOMÉTRIE EST DÉTACHÉE AVANT D'ÊTRE ÉCRITE. Les primitives partagent une seule
    // géométrie par forme (js/primitive-geometry.js) : y écrire `uv1` donnerait à tous les
    // cubes de la scène l'éclairage cuit d'un seul, et aucune erreur ne le dirait. `typeof`
    // plutôt qu'un import : ce fichier n'en a aucun, à dessein (voir l'en-tête).
    const geo = (t.game === AUTO_UV) ? prepareAutoUnwrap(x)
      : (typeof geometryForWrite === 'function') ? geometryForWrite(x) : x.geometry;
    setTransformedAtlas(geo, t.game, t.scale, t.offset, t.pad);
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
    if(t){
      trouve = true;
      const e = {game:t.game, scale:t.scale, offset:t.offset};
      if(t.pad !== undefined) e.pad = t.pad;
      if(x.userData.lightmapOverride) e.lightmap = x.userData.lightmapOverride;
      list.push(e);
    }
    else list.push(null);
  });
  return trouve ? list : null;
}

// LIGHTMAP PAR MAILLAGE, pour les emplacements qui n'ont PAS de matériau du projet (v1.10.5).
//
// La cuisson écrit `lightmapAsset` sur les MATÉRIAUX du projet. Un modèle importé dont les
// emplacements gardent le matériau DU FICHIER (glTF, materialLocation « embedded ») n'en a
// aucun : la lightmap était calculée, exportée… et posée nulle part — 0 maillage éclairé, et
// « Effacer la cuisson » n'y trouvait rien. Le maillage porte donc lui-même l'asset
// (`userData.lightmapOverride`, persisté dans l'entrée d'atlas du nœud, `lightmap`).
//
// Le matériau du fichier est CLONÉ avant d'être écrit : il est partagé par toutes les
// instances du modèle, et une instance non cuite (sans uv1 d'atlas) recevrait sinon un
// éclairage plaqué n'importe où. L'original est gardé pour « Effacer la cuisson ».
// `applyLightmap(m, props)` est celui du moteur appelant (applyLightmap de js/materials.js
// dans l'éditeur, rtApplyLightmap dans le jeu publié) : ce fichier n'importe rien, à dessein.
export function applyLightmapOverrides(o, applyLightmap){
  let n = 0;
  o.traverse(function(x){
    const id = x.isMesh && x.userData.lightmapOverride;
    if(!id) return;
    const multi = Array.isArray(x.material);
    const mats = multi ? x.material : [x.material];
    const out = mats.map(function(m, k){
      if(!m || (m.userData && m.userData.materialAsset)) return m;   // matériau du projet : lui porte la lightmap
      let own = m;
      if(!(m.userData && m.userData.lightmapOwn)){
        own = m.clone();
        own.userData = Object.assign({}, m.userData, {lightmapOwn: true});
        if(!x.userData.lightmapOrigMats) x.userData.lightmapOrigMats = mats.slice();
      }
      applyLightmap(own, {lightmapAsset: id, lightmapUv: 1, lightmapIntensity: 1});
      own.needsUpdate = true;
      n++;
      return own;
    });
    x.material = multi ? out : out[0];
  });
  return n;
}

// L'inverse : rend au maillage ses matériaux d'origine et oublie l'asset. Rend vrai s'il y en avait.
export function clearLightmapOverride(x){
  if(!x.userData.lightmapOverride) return false;
  const orig = x.userData.lightmapOrigMats;
  if(orig) x.material = Array.isArray(x.material) ? orig : orig[0];
  delete x.userData.lightmapOverride;
  delete x.userData.lightmapOrigMats;
  return true;
}
