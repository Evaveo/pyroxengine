// moteur/js/static-batching.js — les objets « Statique » (le Static d'Unity), v1.13.0.
//
// PARTAGÉ entre l'éditeur et le jeu publié, SANS IMPORT : il ne touche que `THREE`, posé en global
// par les vendors (règle 1 du graphe de modules, docs/ARCHITECTURE.md). Importé par
// js/game-runtime.js (le jeu publié), js/lightmap-bake.js (la règle de cuisson) et
// js/ui/panels-inspector.js (la case de l'inspecteur).
//
// CE QUE LE DRAPEAU PROMET. `userData.static === true` (sérialisé `static: true`, absent = faux)
// dit « cet objet ne bougera pas dans le jeu publié ». Dans l'éditeur, il ne change RIEN : l'objet
// reste sélectionnable, déplaçable, éditable. C'est le jeu publié qui en tire parti, une fois, au
// chargement de chaque scène :
//   1. MATÉRIAUX PARTAGÉS — deux maillages statiques dont le matériau FINAL est identique
//      (même asset, mêmes réglages, mêmes textures) reçoivent la MÊME instance ;
//   2. FUSION DE GÉOMÉTRIE — les maillages statiques d'un même matériau sont fondus en un seul
//      maillage par cellule de l'espace, en coordonnées monde : un appel de dessin au lieu de N ;
//   3. AUCUN TRAVAIL PAR IMAGE — matrices figées (matrixAutoUpdate = false).
// Et la cuisson de lightmap (js/lightmap-bake.js) ne cuit que les statiques dès qu'il y en a un.
//
// LE CHOIX OPT-IN. Le regroupement en instances (js/render-perf.js) est automatique et doit donc
// se resynchroniser à chaque image, faute de savoir ce qui bougera. Ici, la personne le DIT : on
// peut figer, et fondre ce que l'instanciation ne sait pas regrouper (géométries différentes,
// objets cuits à leur propre place d'atlas).

/** Taille d'une cellule de fusion, en unités de monde — la même que celle des lots d'instances. */
export const STATIC_CELL_SIZE = 40;
/**
 * Plafond de sommets d'un maillage fusionné. Les index passent en 32 bits au-delà de 65 535
 * (WebGPU et WebGL2 les acceptent) ; le plafond borne surtout la taille d'un envoi au GPU et garde
 * des morceaux assez petits pour que l'élimination par le champ de vision ait prise.
 */
export const STATIC_MERGE_MAX_VERTICES = 262144;

// L état de la scène chargée (une seule à la fois dans le jeu publié), pour les gestes qui masquent.
let currentStaticScene = null;

/** L'objet porte-t-il lui-même le drapeau ? */
export function isStatic(o){
  return !!(o && o.userData && o.userData.static === true);
}

/**
 * Le drapeau EFFECTIF d'un objet. Un nœud de modèle importé (os, sous-maillage) n'a pas de case à
 * lui : il hérite de sa racine, comme les sous-maillages d'un modèle Unity marqué Static. Un enfant
 * ORDINAIRE n'hérite pas — c'est « appliquer aux enfants » qui le marque, comme dans Unity.
 */
export function staticOf(o){
  let x = o;
  while(x && x.userData){
    if(x.userData.static === true) return true;
    if(x.userData.modelNode === undefined) return false;
    x = x.parent;
  }
  return false;
}

// ---------- les objets qui bougeront de toute façon ----------
//
// Le drapeau est une promesse de la personne ; certains composants la rompent à coup sûr, sans
// qu'un script y soit pour rien : un corps physique dynamique, un Animator, une piste de la
// timeline. Fondre leur maillage figerait à l'écran ce que le moteur déplace. On les laisse donc
// hors de la fusion et du gel — et on le DIT une fois au chargement, sans quoi la case paraîtrait
// sans effet.
function moverReason(x, isAnimated){
  const ud = x.userData || {};
  if(ud.phys && ud.phys.active && ud.phys.masse > 0) return 'corps physique dynamique';
  if(x.getComponent && x.getComponent('Animator')) return 'Animator';
  if(ud.particles) return 'particules';
  if(isAnimated && isAnimated(x)) return 'piste de timeline';
  return null;
}
function moverInChain(o, isAnimated){
  for(let x = o; x && x.userData; x = x.parent){
    const r = moverReason(x, isAnimated);
    if(r) return r;
  }
  return null;
}

// ---------- 1. matériaux partagés ----------

const TEXTURE_KEYS = ['map', 'normalMap', 'bumpMap', 'displacementMap', 'roughnessMap',
  'metalnessMap', 'aoMap', 'emissiveMap', 'lightMap', 'alphaMap'];
const NODE_KEYS = ['colorNode', 'roughnessNode', 'metalnessNode', 'emissiveNode', 'normalNode',
  'opacityNode', 'positionNode', 'fragmentNode', 'outputNode'];
const SHAREABLE_TYPES = {MeshStandardMaterial: 1, MeshPhysicalMaterial: 1, MeshBasicMaterial: 1,
  MeshLambertMaterial: 1, MeshPhongMaterial: 1};

function textureSignature(t){
  if(!t) return '';
  // La SOURCE (l'image), pas l'uuid : textureMaterialRuntime CLONE la texture d'asset pour chaque
  // matériau — deux clones de la même image, au même tuilage, rendent la même chose.
  const src = t.source ? t.source.uuid : t.uuid;
  return [src, t.repeat.x, t.repeat.y, t.offset.x, t.offset.y, t.rotation, t.center.x, t.center.y,
    t.wrapS, t.wrapT, t.channel, t.colorSpace, t.flipY, t.magFilter, t.minFilter, t.anisotropy,
    t.type].join(',');
}
function hex(c){ return c && c.getHex ? c.getHex() : ''; }

/**
 * La signature du matériau FINAL d'un maillage — après matériau d'asset, composant Mesh, texture
 * directe et lightmap. Deux maillages de même signature rendent la même image : ils peuvent
 * partager l'instance. Rend null quand l'égalité n'est pas garantissable :
 *   · plusieurs matériaux (un tableau) ;
 *   · un matériau de plugin (son code peut lire n'importe quoi) ;
 *   · un matériau à nœuds SANS asset — l'apparence vit dans un graphe qu'on ne compare pas
 *     (même raison que signatureMaterial, js/render-perf.js). Avec un asset, le graphe est
 *     reconstruit à l'identique depuis lui : l'asset et ses paramètres suffisent.
 * La clé ne lit PAS l'uuid du matériau : c'est précisément ce qu'on veut rendre commun.
 */
export function staticMaterialSignature(mesh, asset){
  const m = mesh.material;
  if(!m || Array.isArray(m) || !m.isMaterial) return null;
  if(asset && asset.props && asset.props.materialPlugin) return null;
  if(m.userData && m.userData.pluginMaterial) return null;
  const nodes = NODE_KEYS.filter(function(k){ return !!m[k]; });
  if((m.isNodeMaterial || nodes.length) && !asset) return null;
  if(!m.isNodeMaterial && !SHAREABLE_TYPES[m.type]) return null;
  const parts = [m.type, asset ? ('asset:' + asset.id + ':' + (asset.shaderId || '')
      + ':' + JSON.stringify(asset.valuesParams || null)) : 'content', nodes.join('+'),
    hex(m.color), m.roughness, m.metalness, hex(m.emissive), m.emissiveIntensity, m.opacity,
    m.transparent, m.alphaTest, m.side, m.flatShading, m.wireframe, m.vertexColors, m.fog,
    m.toneMapped, m.depthWrite, m.depthTest, m.envMapIntensity, m.aoMapIntensity,
    m.lightMapIntensity, m.bumpScale, m.displacementScale, m.displacementBias,
    m.normalScale ? (m.normalScale.x + ':' + m.normalScale.y) : '', m.normalMapType,
    m.userData && m.userData.lightmapOwn ? 'lmown' : ''];
  if(m.type === 'MeshPhysicalMaterial'){
    parts.push(m.clearcoat, m.clearcoatRoughness, m.transmission, m.ior, m.thickness, m.sheen,
      hex(m.sheenColor), m.iridescence, m.specularIntensity, hex(m.specularColor));
  }
  TEXTURE_KEYS.forEach(function(k){ parts.push(textureSignature(m[k])); });
  return parts.join('|');
}

/**
 * Remplace le matériau de chaque maillage statique par l'instance commune de sa signature.
 * `assetOf(mesh)` rend l'asset matériau de l'objet (ou null). Les matériaux remplacés n'ont
 * jamais été envoyés au GPU (le partage tourne avant la première image) : le ramasse-miettes
 * suffit. Rend le nombre de maillages qui ont rejoint un matériau déjà vu.
 */
export function shareStaticMaterials(meshes, cache, assetOf){
  let shared = 0;
  meshes.forEach(function(x){
    const sig = staticMaterialSignature(x, assetOf ? assetOf(x) : null);
    if(!sig) return;
    const m = cache.get(sig);
    if(!m){ cache.set(sig, x.material); return; }
    if(m !== x.material){ x.material = m; shared++; }
  });
  return shared;
}

// ---------- 2. fusion de géométrie ----------

/**
 * Un maillage statique peut-il être fondu ? On écarte tout ce dont l'image dépend de son
 * identité d'objet, et que la fusion en un maillage monde changerait :
 *   · squelette, cibles de morphing, InstancedMesh — la géométrie n'est pas celle qu'on voit ;
 *   · 2D, terrain, sonde de reflet, particules, sous-scène — leur propre logique de rendu ;
 *   · plusieurs matériaux — un groupe par emplacement, pas implémenté ici ;
 *   · transparence — three trie les transparents PAR OBJET : fondus, ils se trieraient d'un bloc ;
 *   · déplacement de sommets (displacementMap, positionNode) et matériaux à nœuds — l'effet est
 *     calculé dans l'espace de l'OBJET, et le maillage fusionné n'a plus d'objet ;
 *   · niveau de détail (`userData.detail`) — sa visibilité change avec la distance ;
 *   · invisible au chargement — on ne fond que ce qu'on dessine.
 */
export function staticMergeable(x){
  if(!x || !x.isMesh || x.isInstancedMesh || x.isSkinnedMesh || x.isSprite) return false;
  const g = x.geometry, m = x.material;
  if(!g || !g.attributes || !g.attributes.position || !m || Array.isArray(m)) return false;
  if(g.morphAttributes && Object.keys(g.morphAttributes).length) return false;
  const ud = x.userData || {};
  if(ud.sprite2d || ud.animSprite || ud.particles || ud.subScene || ud.detail) return false;
  if(ud.inInstanceBatch || ud.staticMerged) return false;
  if(x.getComponent && (x.getComponent('Terrain') || x.getComponent('Reflection'))) return false;
  if(m.transparent || m.opacity < 1 || m.displacementMap || m.isNodeMaterial) return false;
  if(NODE_KEYS.some(function(k){ return !!m[k] && k !== 'roughnessNode'; })) return false;
  return true;
}

function worldVisible(x){
  for(let a = x; a; a = a.parent){
    if(a.visible === false) return false;
    if(a.userData && a.userData.activeVoulu === false) return false;
  }
  return true;
}

function attributeSignature(g){
  return Object.keys(g.attributes).sort().map(function(k){
    return k + ':' + g.attributes[k].itemSize;
  }).join(',');
}

/** Clé de groupe : seuls fondent ensemble des maillages que three dessinerait à l'identique. */
export function staticMergeKey(x){
  return x.material.uuid + '|' + attributeSignature(x.geometry) + '|' + (x.castShadow === true)
    + '|' + (x.receiveShadow === true) + '|' + x.layers.mask + '|' + (x.renderOrder || 0);
}

/**
 * Fond UNE liste de maillages (même clé) en une géométrie monde. Chaque attribut est relu par
 * getX/getY… (donc dénormalisé, entrelacé ou non) et écrit en Float32 ; les index sont décalés,
 * et le sens des triangles est inversé pour un objet en miroir (déterminant négatif) — three
 * retourne la face avant d'un maillage miroir, ce que le maillage fusionné (matrice identité) ne
 * ferait plus. Rend {geometry, ranges:[{source, start, count}]}.
 */
export function mergeWorldGeometries(list){
  const names = Object.keys(list[0].geometry.attributes);
  let vertexCount = 0, indexCount = 0;
  list.forEach(function(x){
    const g = x.geometry;
    vertexCount += g.attributes.position.count;
    indexCount += g.index ? g.index.count : g.attributes.position.count;
  });
  const arrays = {};
  names.forEach(function(k){ arrays[k] = new Float32Array(vertexCount * list[0].geometry.attributes[k].itemSize); });
  const index = (vertexCount > 65535) ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
  const ranges = [];
  let vOff = 0, iOff = 0;
  list.forEach(function(x){
    x.updateWorldMatrix(true, false);
    // three sait transformer position, normale et tangente : on lui laisse, sur une copie.
    const g = x.geometry.clone();
    g.applyMatrix4(x.matrixWorld);
    const n = g.attributes.position.count;
    names.forEach(function(k){
      const a = g.attributes[k], size = a.itemSize, out = arrays[k];
      for(let i = 0; i < n; i++){
        const o = (vOff + i) * size;
        out[o] = a.getX(i);
        if(size > 1) out[o + 1] = a.getY(i);
        if(size > 2) out[o + 2] = a.getZ(i);
        if(size > 3) out[o + 3] = a.getW(i);
      }
    });
    const flip = x.matrixWorld.determinant() < 0;
    const idx = g.index;
    const count = idx ? idx.count : n;
    for(let t = 0; t + 2 < count; t += 3){
      const a = idx ? idx.getX(t) : t, b = idx ? idx.getX(t + 1) : t + 1, c = idx ? idx.getX(t + 2) : t + 2;
      index[iOff + t] = vOff + a;
      index[iOff + t + 1] = vOff + (flip ? c : b);
      index[iOff + t + 2] = vOff + (flip ? b : c);
    }
    g.dispose();   // copie CPU, jamais envoyée au GPU
    ranges.push({source: x, start: vOff, count: n});
    vOff += n; iOff += count;
  });
  const geometry = new THREE.BufferGeometry();
  names.forEach(function(k){
    geometry.setAttribute(k, new THREE.BufferAttribute(arrays[k], list[0].geometry.attributes[k].itemSize));
  });
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return {geometry: geometry, ranges: ranges};
}

/** Découpe une liste en cellules X/Z de `cell` unités, puis en morceaux sous le plafond de sommets. */
export function chunkStatic(list, cell, maxVertices){
  const cells = new Map();
  const box = new THREE.Box3(), c = new THREE.Vector3();
  list.forEach(function(x){
    if(!x.geometry.boundingBox) x.geometry.computeBoundingBox();
    box.copy(x.geometry.boundingBox).applyMatrix4(x.matrixWorld).getCenter(c);
    const key = Math.floor(c.x / cell) + ':' + Math.floor(c.z / cell);
    let l = cells.get(key);
    if(!l){ l = []; cells.set(key, l); }
    l.push(x);
  });
  const chunks = [];
  cells.forEach(function(l){
    let cur = [], n = 0;
    l.forEach(function(x){
      const v = x.geometry.attributes.position.count;
      if(cur.length && n + v > maxVertices){ chunks.push(cur); cur = []; n = 0; }
      cur.push(x); n += v;
    });
    if(cur.length) chunks.push(cur);
  });
  return chunks;
}

/**
 * La préparation complète d'une scène du jeu publié : partage, fusion, gel. Appelée UNE fois par
 * chargement de scène, après la construction (matrices posées) et avant le regroupement en
 * instances, qui ignore les sources fondues.
 *
 * opts : {assetOf(mesh), isAnimated(o), cell, maxVertices, materialCache(Map)}
 *
 * Les SOURCES restent dans le graphe de scène — les scripts les trouvent par nom, tag, collider,
 * déclencheur ; la physique et le lancer de rayon lisent leur géométrie — mais leur maillage est
 * masqué (`visible = false`, marqué `inStaticMerge`, intention gardée dans `visibleWanted` : même
 * contrat que les lots d'instances, voir visibleIntent dans js/render-perf.js). Un maillage qui a
 * des ENFANTS n'est fondu que si tous ses descendants le sont aussi : masquer un parent masque ses
 * enfants, et un enfant non fondu disparaîtrait.
 *
 * Rend l'état {meshes, ranges:Map(source → [{mesh, start, count}]), frozen:[], skipped:[]}.
 */
export function buildStaticScene(scn, objectsScene, opts){
  opts = opts || {};
  const state = {meshes: [], ranges: new Map(), frozen: [], skipped: [], shared: 0};
  const statics = (objectsScene || []).filter(staticOf);
  if(!statics.length) return state;
  scn.updateMatrixWorld(true);

  // Les objets statiques que le moteur déplacera quand même : ni gelés ni fondus.
  const frozen = [];
  statics.forEach(function(o){
    const why = moverInChain(o, opts.isAnimated);
    if(why){ state.skipped.push({object: o, reason: why}); return; }
    frozen.push(o);
  });
  state.frozen = frozen;
  if(state.skipped.length){
    console.warn('Statique : ' + state.skipped.length + ' objet(s) ignoré(s) car déplacé(s) par le moteur ('
      + state.skipped.slice(0, 3).map(function(s){ return '« ' + s.object.name + ' » : ' + s.reason; }).join(', ')
      + (state.skipped.length > 3 ? '…' : '') + ').');
  }

  // 1. matériaux partagés
  const meshes = [];
  const seen = new Set();
  frozen.forEach(function(o){
    if(o.isMesh && !seen.has(o)){ seen.add(o); meshes.push(o); }
    // Les sous-maillages d'un modèle statique (nœuds de modèle, qui héritent du drapeau).
    o.traverse(function(x){
      if(x !== o && x.isMesh && !seen.has(x) && x.userData.modelNode !== undefined && staticOf(x)){
        seen.add(x); meshes.push(x);
      }
    });
  });
  state.shared = shareStaticMaterials(meshes, opts.materialCache || new Map(), opts.assetOf);

  // 2. fusion
  const candidates = new Set(meshes.filter(function(x){ return staticMergeable(x) && worldVisible(x); }));
  // Un parent fondu masquerait ses enfants : il faut qu'ils le soient tous. Point fixe, la scène
  // est petite à l'échelle de ce calcul (une passe par niveau de profondeur au pire).
  let changed = true;
  while(changed){
    changed = false;
    candidates.forEach(function(x){
      for(let i = 0; i < x.children.length; i++){
        let ok = true;
        x.children[i].traverse(function(y){ if(!candidates.has(y)) ok = false; });
        if(!ok){ candidates.delete(x); changed = true; return; }
      }
    });
  }
  const groups = new Map();
  candidates.forEach(function(x){
    const k = staticMergeKey(x);
    let l = groups.get(k);
    if(!l){ l = []; groups.set(k, l); }
    l.push(x);
  });
  groups.forEach(function(list){
    if(list.length < 2) return;   // un seul maillage : rien à gagner
    chunkStatic(list, opts.cell || STATIC_CELL_SIZE, opts.maxVertices || STATIC_MERGE_MAX_VERTICES)
      .forEach(function(chunk){
        if(chunk.length < 2) return;
        const r = mergeWorldGeometries(chunk);
        const model = chunk[0];
        const mesh = new THREE.Mesh(r.geometry, model.material);
        mesh.name = 'Statique fusionné';
        mesh.castShadow = model.castShadow === true;
        mesh.receiveShadow = model.receiveShadow === true;
        mesh.layers.mask = model.layers.mask;
        mesh.renderOrder = model.renderOrder || 0;
        mesh.frustumCulled = true;
        mesh.userData.staticMerged = true;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        mesh.updateMatrixWorld(true);
        mesh.matrixWorldAutoUpdate = false;
        scn.add(mesh);
        state.meshes.push(mesh);
        r.ranges.forEach(function(rg){
          const s = rg.source;
          s.userData.inStaticMerge = true;
          s.userData.visibleWanted = (s.visible !== false);
          s.visible = false;
          state.ranges.set(s, {mesh: mesh, start: rg.start, count: rg.count, saved: null});
        });
      });
  });

  // 3. gel des matrices — sans travail par image. `matrixAutoUpdate = false` est sûr sur tout
  // objet gelé (sa matrice locale ne change plus ; ses enfants restent parcourus). La passe monde
  // (`matrixWorldAutoUpdate = false`) ne l'est que si TOUT le sous-arbre est gelé : three ne
  // descend plus dans un nœud qui l'a coupée, et un enfant mobile resterait figé.
  const frozenSet = new Set(frozen);
  frozen.forEach(function(o){
    o.userData.staticFrozen = true;
    o.updateMatrix();
    o.matrixAutoUpdate = false;
  });
  frozen.forEach(function(o){
    let all = true;
    o.traverse(function(y){
      if(y === o) return;
      if(!frozenSet.has(y) && !(y.userData && y.userData.modelNode !== undefined && staticOf(y))) all = false;
    });
    if(all) o.traverse(function(y){
      y.matrixAutoUpdate = false;
      y.matrixWorldAutoUpdate = false;
    });
  });
  currentStaticScene = state;
  return state;
}

/**
 * Libère ce que la fusion a créé : les géométries fusionnées (jamais les matériaux, qui sont ceux
 * des sources et que la libération de scène traite déjà). Différé par `releaseLater`
 * (js/gpu-release.js) — le maillage peut encore être dans un rendu encodé (docs/KNOWN_ISSUES.md).
 */
export function undoStaticScene(state){
  if(!state) return;
  state.meshes.forEach(function(m){
    if(m.parent) m.parent.remove(m);
    if(typeof releaseLater === 'function') releaseLater(m.geometry); else m.geometry.dispose();
  });
  state.meshes = [];
  state.ranges = new Map();
  if(currentStaticScene === state) currentStaticScene = null;
}

// ---------- masquer une PARTIE d'un maillage fusionné ----------
//
// Un maillage fusionné ne sait pas masquer un objet à lui seul… sauf à écraser ses sommets. On
// garde, pour chaque source, la plage qu'elle occupe ; la masquer ramène tous ses sommets sur le
// premier (des triangles dégénérés, que le GPU élimine), et l'on mémorise les positions pour les
// reposer à l'affichage. Une écriture au moment du geste, jamais par image — c'est ce qui permet à
// api.setVisible, api.setActive et api.destroy de garder leur sens sur un objet statique.

function setRangeHidden(rg, hidden){
  const pos = rg.mesh.geometry.attributes.position;
  const a = pos.array, s = rg.start * 3, e = (rg.start + rg.count) * 3;
  if(hidden){
    if(rg.saved) return;
    rg.saved = a.slice(s, e);
    for(let i = s; i < e; i += 3){ a[i] = a[s]; a[i + 1] = a[s + 1]; a[i + 2] = a[s + 2]; }
  } else {
    if(!rg.saved) return;
    a.set(rg.saved, s);
    rg.saved = null;
  }
  pos.needsUpdate = true;
}

/** Visibilité EFFECTIVE d'une source fondue : son intention et celle de tous ses ancêtres. */
function intendedVisible(x){
  for(let a = x; a; a = a.parent){
    const ud = a.userData || {};
    if(ud.activeVoulu === false) return false;
    if(ud.inStaticMerge ? ud.visibleWanted === false : a.visible === false) return false;
  }
  return true;
}

/**
 * Remet en accord, sous `o`, les plages des maillages fusionnés avec la visibilité voulue.
 * `forceHidden` : l'objet va être détruit. Rend le nombre de plages touchées.
 */
export function refreshStaticVisibility(o, forceHidden){
  const state = currentStaticScene;
  if(!state || !o || !state.ranges.size) return 0;
  let n = 0;
  o.traverse(function(x){
    const rg = state.ranges.get(x);
    if(!rg) return;
    setRangeHidden(rg, forceHidden ? true : !intendedVisible(x));
    n++;
  });
  return n;
}

// ---------- 5. la garde des scripts ----------
//
// Un objet gelé ne bouge plus : `api.setPosition`, `api.lookAt`, `api.moveTo` et `api.patrol` sur
// lui sont IGNORÉS, avec un avertissement une seule fois par objet. Les écritures directes
// (`obj.position.x = …`, `mesh.material.color.set(…)`) ne peuvent pas être interceptées sans
// surveiller chaque objet à chaque image — ce que le drapeau sert justement à éviter : elles sont
// documentées dans l'aide (Scripts → objets Statiques), pas gardées.
const warned = new WeakSet();

/** Rend vrai (et prévient une fois) si `o` est gelé : l'appelant doit alors ignorer le geste. */
export function staticBlocked(o){
  if(!o || !o.userData || !o.userData.staticFrozen) return false;
  if(!warned.has(o)){
    warned.add(o);
    console.warn('« ' + (o.name || 'objet') + ' » est Statique : modification ignorée dans le jeu '
      + 'publié (décochez Statique pour le déplacer)');
  }
  return true;
}

// ---------- 4. la règle de cuisson ----------

/**
 * Unity : dès qu'un objet de la scène est statique, seuls les statiques sont cuits. Si aucun ne
 * l'est, tout est cuit — les projets d'avant la v1.13.0 cuisent comme avant. Rend {meshes, mode}
 * avec mode 'static' ou 'all'.
 */
export function bakeSelectionStatic(meshes, objectsScene){
  const any = (objectsScene || []).some(staticOf);
  if(!any) return {meshes: meshes, mode: 'all'};
  return {meshes: meshes.filter(staticOf), mode: 'static'};
}

/**
 * Pose le drapeau sur `o` et, si demandé, sur tous ses descendants qui sont des objets de scène
 * (nœuds à composants). Rend le nombre d'objets modifiés.
 */
export function setStaticFlag(o, value, withChildren){
  let n = 0;
  function set(x){
    if(!x.userData) return;
    const was = x.userData.static === true;
    if(value) x.userData.static = true; else delete x.userData.static;
    if(was !== !!value) n++;
  }
  set(o);
  if(withChildren) o.traverse(function(x){
    if(x !== o && x.userData && Array.isArray(x.userData.components) && x.userData.modelNode === undefined) set(x);
  });
  return n;
}

globalThis.refreshStaticVisibility = refreshStaticVisibility;
globalThis.staticOf = staticOf;
