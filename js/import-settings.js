// ---------- Paramètres d'import des assets (panneau Projet) ----------
// Un clic simple sur une tile du panneau Projet sélectionne l'asset : l'inspecteur
// affiche alors ses paramètres d'import (l'équivalent de l'onglet « Import Settings »
// d'Unity) au lieu d'un objet de la scène. Les réglages vivent sur `a.paramsImport`,
// sont sérialisés dans le .p3d et rejoués par le runtime des builds, pour que
// l'éditeur et le jeu exporté normalisent à l'identique.
// La sélection d'asset elle-même est dans selection.js (assetSelected).

// L'ÉDITEUR TRAVAILLE EN MÈTRES : 1 unité three = 1 m, comme la spec glTF et comme
// la gravité de cannon (−9,81 m/s²). Un modèle importé est donc ramené en mètres à
// partir de l'unité déclarée par son fichier, pour faire exactement la taille qu'il
// a dans Maya, 3ds Max ou Blender.
import { anim, closeClipAsset, openClipAsset } from './animation.js';
import { cloneModel } from './anim-models.js';
import { assetInDrag, assets, createAssetPreset, createAssetTexture, ensureClipsOfModel, folderCurrent, listFolders, newClipId, previewObject3D, reconcileDiskPaths, removeAsset, setFolderCurrent, snapshotDiskPaths, syncClipAssetsOfModel, updateProject } from './assets.js';
import { engineAudio, togglePreviewAudio } from './audio.js';
import { rebuildMeshSprite } from './components/component-sprite.js';
import { Registry } from './component-registry.js';
import { applyComponents } from './component-migration.js';
import { setStatus, updateHierarchy } from './hierarchy.js';
import { HUMANOID_BONES, autoMapAvatar, bonesUnique, countBonesDuplicated, validateAvatar } from './humanoid-avatar.js';
import { pushHistory } from './history.js';
import { inspBody } from './inspector.js';
import { extractMaterialsModel, namingCurrent, texturesOfFolder } from './material-extraction.js';
import { PROPS_MATERIAL, readPropsMaterialFromDom, renderPropsMaterial } from './material-props.js';
import { adjustEmissiveByMap, applyMaterialEverywhere, assignShaderOnMaterial, cacheCombined, channelsMapped, ensurePropsMaterial, ensureUv2, makeMaterialThree } from './materials.js';
import { addSceneObject, escapeHtml, exposeModelInstance, isSceneObject, listMats, objects, removeSceneObject } from './objects.js';
import { serializeComponentsOf } from './serialization.js';
import { MODEL_IMPORT_DEFAULT, applyAnimationImport, applyModelGeometry, applyModelHierarchy, bakeScaleModel, collapsedCount } from './model-import.js';
import { materialPluginOf, tablePropsMaterial } from './plugins.js';
import { project } from './project.js';
import { applyFilters, renderer } from './scene.js';
import { openEditorScriptAsset } from './scripts.js';
import { assetSelected, select, selectAsset } from './selection.js';
import { field, openEditorGraphShader } from './shader-graph-editor.js';
import { modalAtlasSprite } from './sprite-atlas-ui.js';
import { openEditorPostProfile } from './ui/panels-postprofile.js';
import { loop } from './viewport.js';
import { Prefs } from './ui/prefs.js';
import { bindTextureThumbs, ipSelectTextureShader, ipSlotTexture, sectionPreviewTextureHtml } from './texture-preview.js';

export const UNITS_METER = {m:1, cm:0.01, mm:0.001, in:0.0254, ft:0.3048};
export const NAMES_UNIT = {m:'mètres', cm:'centimètres', mm:'millimètres',
                    in:'pouces', ft:'pieds'};

export const IMPORT_DEFAULT = {
  // modèle : unité du fichier → mètres, puis échelle libre.
  // `materiaux` = {name d'emplacement du fichier → id d'asset matériau} (absent = du fichier)
  // `MODEL_IMPORT_DEFAULT` (js/model-import.js) apporte les traitements de hiérarchie et de
  // géométrie, partagés avec le runtime : ils sont posés là-bas, pas ici, pour que le jeu
  // publié parte des mêmes valeurs sans recopie.
  // `animationType` est l'onglet Rig d'Unity : « aucune » (pas de rig), « générique » (les os
  // se correspondent par leur NOM — js/retargeting.js) ou « humanoïde » (par EMPLACEMENT, via un
  // Avatar — js/humanoid-avatar.js). Il vit ici et pas dans MODEL_IMPORT_DEFAULT : le runtime
  // n'en a rien à faire, il relit l'Avatar, qui est sérialisé sur l'asset.
  model:   Object.assign({unites:'auto', scale:1, centrer:true, setGround:true, materials:{},
                          animationType:'generic'},
                         MODEL_IMPORT_DEFAULT),
  // texture : `type` = usage (il décide de l'espace de couleur et de la map visée
  // au glisser-déposer) ; `tailleMax` = 0 pour la résolution d'origine
  texture: {type:'color', spaceColor:'auto', sizeMax:0, mipmaps:true,
            repetition:'repeter', tuilage:[1, 1], filtrage:'lineaire',
            anisotropy:1, invertY:'auto'},
  // audio : valeurs posées sur la source au moment de l'attachement à un objet
  audio:   {volume:1, loop:false, spatial:true, range:10, pitch:1}
};

// genres sans paramètres d'import : ils ne viennent pas d'un fichier
// `sprite` en fait partie : il ne vient pas d'un fichier, il RÉFÉRENCE une texture qui, elle,
// a ses paramètres d'import. Lui en donner créerait deux endroits où régler le filtrage, dont
// un sans effet.
export const WITHOUT_IMPORT = {prefab:1, script:1, material:1, graphShader:1, animation:1, sprite:1,
                        postProfile:1, animator:1, preset:1, sfx:1, musicLoop:1};

export function ensureParamsImport(a){
  if(!a || !IMPORT_DEFAULT[a.kind]) return null;
  const stored = a.paramsImport || {};
  const hadType = stored.animationType !== undefined;
  a.paramsImport = Object.assign(
    JSON.parse(JSON.stringify(IMPORT_DEFAULT[a.kind])), stored);
  // Un Avatar posé AVANT que ce réglage existe (il se détectait depuis le composant
  // SkinnedMeshRenderer) vaut « humanoïde » : sans cette ligne, le défaut « générique » l'aurait
  // effacé au premier « Appliquer » d'un projet ouvert avec cette version.
  if(a.kind === 'model' && !hadType && a.avatar) a.paramsImport.animationType = 'humanoid';
  return a.paramsImport;
}

// fichier source (pour l'affichage) : le principal du paquet pour un modèle
export function fileSourceAsset(a){
  if(a.file) return a.file;
  if(a.kind === 'model' && a.paquet && a.paquet.length){
    return a.paquet.find(function(f){ return /\.(glb|gltf|fbx)$/i.test(f.name); }) || a.paquet[0];
  }
  return null;
}

export function weightReadable(o){
  if(!(o > 0)) return '—';
  if(o < 1024) return o + ' o';
  if(o < 1024*1024) return (o/1024).toFixed(0) + ' Ko';
  return (o/(1024*1024)).toFixed(1) + ' Mo';
}


// ---------- Modèles : emplacements de matériaux ----------
// Un FBX/glTF arrive avec ses propres matériaux, souvent plusieurs (un par matériau
// défini dans le DCC). Chaque matériau du fichier devient un « emplacement » nommé,
// remplaçable par un matériau du projet — l'équivalent de l'onglet Materials d'Unity.
// `a.matBruts` garde les matériaux du fichier, indexés dans l'ordre de parcours des
// maillages, pour pouvoir revenir en arrière.

// maillages d'un modèle dans un ordre stable (les visualisations de collider, posées
// sur les instances, ne comptent pas : elles décaleraient les index)
export function meshesModel(root){
  const list = [];
  root.traverse(function(o){
    if(o.isMesh && !o.userData.isColliderViz) list.push(o);
  });
  return list;
}

export function nameSlotMat(mat, i){
  return (mat && mat.name) ? mat.name : 'Matériau ' + (i + 1);
}

// Les matériaux QUE LE FICHIER a posés sur chaque maillage, retenus sur le maillage lui-même.
//
// `a.matBruts` est un tableau indexé par l'ordre de parcours — et cet ordre CHANGE quand les
// réglages de hiérarchie trient ou replient l'arbre. Sans mémoire par maillage, un tri par nom
// redistribuait les emplacements de matériaux sur les mauvais maillages, en silence. Une WeakMap
// plutôt que `userData` : `Object3D.copy` fait passer `userData` par JSON.stringify au clonage,
// ce qui détruirait (et sérialiserait bêtement) des THREE.Material.
export const matFileByMesh = new WeakMap();

/** Rend les matériaux du fichier dans l'ordre de parcours COURANT, en les mémorisant au passage. */
export function captureMatFile(root){
  return meshesModel(root).map(function(m){
    if(!matFileByMesh.has(m)) matFileByMesh.set(m, listMats(m).slice());
    return matFileByMesh.get(m);
  });
}

// emplacements distincts (par nom), dans l'ordre de rencontre
export function slotsMaterialsModel(a){
  const slots = [];
  const vus = {};
  (a.matBruts || []).forEach(function(bruts){
    bruts.forEach(function(mb, i){
      const name = nameSlotMat(mb, i);
      if(vus[name]){ vus[name].n++; return; }
      vus[name] = {name:name, n:1, type:(mb && mb.type) || '—'};
      slots.push(vus[name]);
    });
  });
  return slots;
}

export function materialAssetById(id){
  if(!id) return null;
  return assets.find(function(x){ return x.id === id && x.kind === 'material'; }) || null;
}

// Pose sur chaque maillage le matériau du projet choisi pour son emplacement, ou
// celui du fichier. Les matériaux fabriqués ne sont pas libérés : ils peuvent encore
// être partagés par des instances clonées avant l'application (three partage les
// matériaux au clonage).
export function applyMaterialsModel(a, root){
  if(a && root === a.template) forgetPreviewsModel(a);   // les matériaux se voient dans l'aperçu
  const p = ensureParamsImport(a);
  const map = (p && p.materials) || {};
  if(!a.matBruts) return 0;
  let n = 0;
  meshesModel(root).forEach(function(mesh, i){
    const bruts = a.matBruts[i];
    if(!bruts || !bruts.length) return;
    const nouveaux = bruts.map(function(mb, k){
      const name = nameSlotMat(mb, k);
      const ma = materialAssetById(map[name]);
      // Sans matériau du projet, l'emplacement porte celui du FICHIER — tel que l'onglet
      // Matériaux le fabrique (Material Creation Mode, sRGB Albedo Colors).
      if(!ma) return (typeof fileMaterialFor === 'function') ? fileMaterialFor(mb, p) : mb;
      n++;
      const m = makeMaterialThree(ma);
      m.name = name;
      m.userData.materialAsset = ma.id;
      return m;
    });
    // Sur une instance, un emplacement remplacé par l'utilisateur (override du nœud) reste le
    // sien : le modèle ne fait que changer ce vers quoi l'emplacement revient.
    if(root !== a.template && mesh.userData.modelNode !== undefined && typeof setModelMaterials === 'function'){
      setModelMaterials(mesh, nouveaux);
      return;
    }
    mesh.material = (bruts.length > 1) ? nouveaux : nouveaux[0];
    if(nouveaux.some(function(m){ return m && m.aoMap; })) ensureUv2(mesh);
  });
  return n;
}

// matériau supprimé du projet : les modèles qui l'utilisaient reprennent le fichier
export function disposeMaterialOfModels(matAsset){
  assets.forEach(function(x){
    if(x.kind !== 'model') return;
    const map = x.paramsImport && x.paramsImport.materials;
    if(!map) return;
    let key = false;
    Object.keys(map).forEach(function(k){
      if(map[k] === matAsset.id){ delete map[k]; key = true; }
    });
    if(key) applyImportModel(x, true);
  });
}

// modèles dont un emplacement pointe sur ce matériau (appelé quand le matériau change)
export function refreshModelsOfMaterial(matAsset){
  assets.forEach(function(x){
    if(x.kind !== 'model') return;
    const map = x.paramsImport && x.paramsImport.materials;
    if(!map) return;
    if(Object.keys(map).some(function(k){ return map[k] === matAsset.id; }))
      applyImportModel(x, true);
  });
}


// ---------- Modèles : mise à l'échelle rejouable ----------
// `a.raw` garde le transform du fichier pour que chaque application reparte de
// l'original au lieu d'empiler les mises à l'échelle.
// `a.uniteFichier` = mètres par unité du fichier (détecté à l'import, voir assets.js).

// La boîte englobante d'un modèle, en monde — SANS passer par `Box3.setFromObject`.
//
// Sur un modèle rigué, `setFromObject` ne rend pas la taille réelle : il tient count du
// squelette et des matrices de liaison, et sur un personnage Mixamo il renvoyait une hauteur
// CENT FOIS trop petite. Le panneau d'import annonçait donc « 0,018 m » pour un personnage qui
// mesure bien 1,81 m dans la scène — un chiffre faux sous les yeux de quelqu'un qui s'en sert
// justement pour choisir son unité, et qui allait le corriger à tort.
//
// On mesure donc la géométrie de bind, transformée par la matrice monde : les huit coins de la
// boîte de chaque maillage, ce qui reste juste pour un maillage rigué comme pour un autre.
export function boxBoundingReliable(root){
  const box = new THREE.Box3();
  const coin = new THREE.Vector3();
  root.updateMatrixWorld(true);
  root.traverse(function(o){
    if(!o.geometry) return;
    if(!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const b = o.geometry.boundingBox;
    if(!b) return;
    for(let i = 0; i < 8; i++){
      coin.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z)
          .applyMatrix4(o.matrixWorld);
      box.expandByPoint(coin);
    }
  });
  return box;
}

// facteur appliqué à l'échelle du fichier : unité → mètres, puis échelle libre
export function factorScaleModel(a, p){
  const unite = (p.unites === 'auto')
    ? (a.unitFile > 0 ? a.unitFile : 1)
    : (UNITS_METER[p.unites] || 1);
  return unite * (p.scale > 0 ? p.scale : 1);
}

export function applyImportModel(a, updateInstances){
  const p = ensureParamsImport(a);
  const t = a && a.template;
  if(!p || !t) return 0;
  if(!a.raw) a.raw = {scale:t.scale.clone(), position:t.position.clone()};
  const structureBefore = t.userData.importStructure || '';

  // Hiérarchie AVANT tout le reste : replier ou trier change l'ordre de parcours des maillages,
  // donc la numérotation des emplacements de matériaux, et déplace des transformations. Le repli
  // ne touche jamais la racine, `a.raw` reste donc valable.
  forgetPreviewsModel(a);
  applyModelHierarchy(t, p, a.animationsBrutes || []);
  applyRigModel(a, p);
  // Recapture seulement s'il y a déjà eu une capture : `matBruts` naît à la création de l'asset
  // (createAssetModel), ici on ne fait que le remettre dans l'ordre de parcours courant.
  if(a.matBruts) a.matBruts = captureMatFile(t);
  const geo = applyModelGeometry(t, p);
  a.warningsImport = geo.warnings;
  a.skinInfo = {clamped:geo.skinClamped, renormalized:geo.skinRenormalized};
  if(geo.warnings.length) setStatus(geo.warnings[0], 6000);

  const ancScale = t.scale.x || 1;
  const ancY = t.position.y;

  t.traverse(function(o){
    if(!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
  });
  // Les prises du fichier, passées par l'onglet Animation (Import Animation, réduction de clés).
  // `animationsBrutes` n'est jamais modifié : c'est le fichier.
  t.animations = applyAnimationImport(a.animationsBrutes || [], p);

  // CONVERTIR LES UNITÉS = cuire le facteur dans la géométrie plutôt que dans l'échelle de la
  // racine, pour que les instances affichent 1, 1, 1 dans l'inspecteur (« Convert Units » d'Unity).
  // Les deux voies donnent exactement la même taille à l'écran ; c'est le nombre qu'on lit et
  // qu'on modifie ensuite qui change.
  const factor = factorScaleModel(a, p);
  bakeScaleModel(t, p.convertUnits ? factor : 1);
  t.scale.copy(a.raw.scale);
  t.position.copy(a.raw.position);
  if(!p.convertUnits) t.scale.multiplyScalar(factor);
  const box = boxBoundingReliable(t);
  // Un FBX d'animation seule (export Mixamo « without skin ») n'a AUCUNE géométrie : la boîte
  // reste vide et ses bounds valent ±Infinity. Recentrer ou poser au sol là-dessus écrit
  // -Infinity dans la position, puis NaN au premier `dy = y - ancY` — l'objet quitte la scène
  // sans un mot et tous ses os héritent du NaN. Rien à mesurer, donc rien à déplacer.
  // `getSize` et `getCenter` rendent déjà [0,0,0] sur une boîte empty — vérifié dans le three
  // vendorisé, et deux mutations survivantes l'ont confirmé. Le seul accès dangereux est `min`,
  // qui vaut +Infinity : c'est lui, et lui seul, qu'il faut garder.
  a.dimensions = box.getSize(new THREE.Vector3()).toArray();   // en mètres, pour le panneau
  if(p.centrer){
    const center = box.getCenter(new THREE.Vector3());
    t.position.x -= center.x;
    t.position.z -= center.z;
  }
  if(p.setGround && !box.isEmpty()) t.position.y -= box.min.y;

  applyMaterialsModel(a, t);
  a.preview = previewObject3D(t);
  // Les clips du modèle sont des sous-assets (onglet Animation) : leur vue `animation` suit ce
  // qui vient d'être appliqué.
  if(typeof ensureClipsOfModel === 'function'){ ensureClipsOfModel(a); syncClipAssetsOfModel(a); }

  // instances déjà posées : l'échelle suit le ratio (un redimensionnement manuel
  // reste donc proportionnel) et l'offset de sol est corrigé du même delta.
  let n = 0;
  if(updateInstances){
    // UNE INSTANCE EST UN CLONE, pas une vue. Les géométries, elles, sont partagées — normales,
    // tangentes et dépliage arrivent donc tout seuls chez les instances. Mais la STRUCTURE (les
    // nœuds, leurs positions) a été recopiée au moment où l'instance a été posée : trier la
    // hiérarchie ou cuire les unités ne l'atteint pas. On rebâtit alors le sous-arbre depuis le
    // template — c'était le défaut rapporté sur « Trier par nom », sans effet sur la scène.
    // LE FACTEUR CUIT FAIT PARTIE DE LA STRUCTURE, et c'est ce qui manquait.
    //
    // Les géométries sont PARTAGÉES entre le template et ses instances : rééchelonner les
    // positions les atteint donc toutes seules. Mais une instance est un clone, et
    // `cloneModel` fige à la copie le `bindMatrix` et les `boneInverses` de son squelette. Ces
    // matrices-là valent pour l'ANCIENNE échelle de la géométrie ; après un simple changement
    // de « Échelle » ou d'« Unités », la peau d'un personnage riggé partait donc dans tous les
    // sens, alors que le template, lui, avait été relié (voir `bakeScaleModel`). Le seul
    // remède est de recloner : on l'inscrit dans la signature plutôt que d'ajouter un second
    // chemin de re-liaison qui divergerait du premier.
    // Les réglages qui décident de QUELS nœuds l'instance expose en font partie aussi.
    const structure = [p.preserveHierarchy, p.sortHierarchy, p.convertUnits,
                       p.convertUnits ? factor : 1, p.generateColliders, p.optimizeGameObjects,
                       (p.extraTransforms || []).join(','), p.importCameras, p.importLights].join('|');
    if(structure !== structureBefore) rebuildInstancesStructure(a);
    t.userData.importStructure = structure;

    const ratio = (t.scale.x || 1) / ancScale;
    const dy = t.position.y - ancY;
    objects.forEach(function(o){
      if(o.userData.assetId !== a.id) return;
      n++;
      o.scale.multiplyScalar(ratio);
      o.position.y += dy;
      o.animations = t.animations;
      // un matériau affecté à l'objet entier (glisser-déposer) prime sur les
      // emplacements du modèle, comme un override de renderer dans Unity
      if(!o.userData.materialId) applyMaterialsModel(a, o);
    });
    applyFilters();
  } else {
    t.userData.importStructure = [p.preserveHierarchy, p.sortHierarchy, p.convertUnits,
                                  p.convertUnits ? factor : 1, p.generateColliders,
                                  p.optimizeGameObjects, (p.extraTransforms || []).join(','),
                                  p.importCameras, p.importLights].join('|');
  }
  updateProject();
  return n;
}

/**
 * Rebâtit le sous-arbre de chaque instance à partir du template.
 *
 * Ce qui est PRÉSERVÉ : l'instance elle-même (son identité, ses composants, sa transformation) et
 * les objets de scène que l'utilisateur a parentés dessous — ils ne viennent pas du modèle, ils
 * n'ont donc pas à disparaître avec lui. Le reste (les nœuds du fichier, les visuels d'édition)
 * est remplacé par un clone frais, squelettes re-liés.
 */
export function rebuildInstancesStructure(a){
  let n = 0;
  // `objects` change pendant la boucle (les nœuds sortent et rentrent) : on fige les racines.
  objects.filter(function(o){
    return o.userData.assetId === a.id && o.userData.modelNode === undefined;
  }).forEach(function(o){
    n++;
    if(typeof removeColliderViz === 'function') removeColliderViz(o);
    // 1. LES OVERRIDES D'ABORD, pendant que les anciens nœuds sont encore là : transformées,
    //    composants ajoutés, et les objets de l'utilisateur parentés sous un nœud (à n'importe
    //    quelle profondeur), avec la clé du nœud qui les porte.
    const overrides = (typeof captureModelOverrides === 'function')
      ? captureModelOverrides(o, null, serializeComponentsOf) : null;
    const userChildren = [];
    o.traverse(function(x){
      if(x === o || !isSceneObject(x) || x.userData.modelNode !== undefined) return;
      const p = x.parent;
      if(p && p.userData.modelNode !== undefined) userChildren.push({node: x, key: p.userData.modelNode});
    });
    userChildren.forEach(function(u){ o.attach(u.node); });
    // 2. Les anciens nœuds sortent de la scène ET de l'index.
    o.children.slice().forEach(function(c){
      if(isSceneObject(c) && c.userData.modelNode === undefined) return;
      c.traverse(function(x){
        Registry.unindexNode(x);
        if(x.userData.modelNode !== undefined) removeSceneObject(x);
      });
      o.remove(c);
    });
    // 3. Le modèle neuf, exposé, indexé, et ses écarts reposés.
    const fresh = cloneModel(a.template);
    fresh.children.slice().forEach(function(c){ o.add(c); });
    o.animations = a.template.animations;
    if(typeof exposeModelInstance === 'function'){
      exposeModelInstance(o, a).forEach(function(e){ addSceneObject(e.node); });
      if(overrides && typeof applyModelOverrides === 'function'){
        applyModelOverrides(o, overrides, function(x, list){ applyComponents(x, list); },
          function(x){ if(typeof applyMaterialSlots === 'function') applyMaterialSlots(x); });
      }
    }
    userChildren.forEach(function(u){
      const target = (typeof modelNodeByKey === 'function') ? modelNodeByKey(o, u.key) : null;
      if(target) target.attach(u.node);
    });
  });
  if(n && typeof updateColliderViz === 'function') updateColliderViz();
  if(n) updateHierarchy();
  return n;
}

export function countInstancesModel(a){
  return objects.filter(function(o){ return o.userData.assetId === a.id; }).length;
}


// ---------- Textures : réglages d'échantillonnage ----------
export const WRAP_IMPORT = {
  repeter: THREE.RepeatWrapping,
  bloquer: THREE.ClampToEdgeWrapping,
  miroir:  THREE.MirroredRepeatWrapping
};

// map visée quand on lâche la texture sur un objet de la scène, selon son usage.
// Une texture de données (rugosité, métal, AO, masque) n'a pas de cible évidente :
// elle se branche dans un matériau, pas directement sur un objet.
export const MAP_BY_TYPE = {color:'map', normal:'normalMap'};

// `WebGPURenderer` n'a PAS de `capabilities` (c'est son backend qui en a un) : il expose
// getMaxAnisotropy() directement, et délègue — l'extension EXT côté WebGL2, 16 côté WebGPU.
// Lire renderer.capabilities levait donc, le catch renvoyait 1, et le réglage d'anisotropy
// était mort EN SILENCE — plafonné à 1 jusque dans l'interface, qui annonçait « max 1 sur ce
// GPU ». `capabilities` reste consulté en repli pour un renderer WebGL classique.
export let warnedAnisotropy = false;
export function anisotropyMax(){
  try {
    if(typeof renderer.getMaxAnisotropy === 'function') return renderer.getMaxAnisotropy() || 1;
    return renderer.capabilities.getMaxAnisotropy() || 1;
  } catch(e){
    if(!warnedAnisotropy){
      warnedAnisotropy = true;
      console.warn('Anisotropie maximale inconnue, plafonnée à 1 —', e && e.message ? e.message : e);
    }
    return 1;
  }
}

// La sortie du renderer est-elle en sRGB ? De cela dépend l'espace de couleur correct
// pour les textures : marquer une texture sRGB devant une sortie linéaire la décoderait
// sans la réencoder à l'affichage — donc l'assombrirait au lieu de la corriger.
//
// Depuis three r152 la gestion des couleurs est explicite et `outputColorSpace` vaut
// sRGB PAR DÉFAUT — ce test renvoie donc vrai là où il renvoyait faux en r128. C'est le
// bon comportement (l'éclairage se calcule en linéaire, l'affichage réencode), et c'est
// aussi la raison pour laquelle le rendu bouge au passage à r185. Le « faisait pareil
// avant » n'est pas un objectif ici : avant, c'était faux.
export function outputSrgb(){
  return renderer.outputColorSpace === THREE.SRGBColorSpace;
}

// « auto » suit l'usage ET le pipeline. Une texture de DONNÉES (normale, rugosité,
// métal, occlusion) ne doit jamais être décodée : ses octets sont des nombres, pas des
// couleurs. Seul le type « couleur » pass en sRGB.
export function spaceColorTexture(p){
  if(p.spaceColor === 'srgb') return THREE.SRGBColorSpace;
  if(p.spaceColor === 'lineaire') return THREE.LinearSRGBColorSpace;
  return (outputSrgb() && p.type === 'color') ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
}

// Image à envoyer au GPU : l'originale, ou une réduction si elle dépass la taille
// max (le fichier source, lui, reste intact — c'est un réglage d'import, pas un
// réencodage). `a.imageSource` est posée au chargement de l'image.
export function imageForTexture(a, p){
  const src = a.imageSource;
  if(!src || !src.width) return null;
  const max = p.sizeMax | 0;
  const cote = Math.max(src.width, src.height);
  if(!max || cote <= max) return src;
  const f = max / cote;
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(src.width * f));
  cv.height = Math.max(1, Math.round(src.height * f));
  const cx = cv.getContext('2d');
  cx.imageSmoothingEnabled = true;
  cx.imageSmoothingQuality = 'high';
  cx.drawImage(src, 0, 0, cv.width, cv.height);
  return cv;
}

// Applique les réglages d'un asset texture à une instance de THREE.Texture.
// opts.flipYAuto : valeur de flipY quand « inverserY » vaut auto (absent = ne pas toucher).
// opts.tuilage === false : le tuilage est piloté ailleurs (matériau asset), on ne l'écrase pas.
export function configureTexture(tex, p, opts){
  if(!tex || !p) return;
  opts = opts || {};
  tex.wrapS = tex.wrapT = WRAP_IMPORT[p.repetition] || THREE.RepeatWrapping;
  if(opts.tuilage !== false) tex.repeat.set(p.tuilage[0], p.tuilage[1]);
  const mip = p.mipmaps !== false;
  tex.generateMipmaps = mip;
  if(p.filtrage === 'near'){
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = mip ? THREE.NearestMipmapNearestFilter : THREE.NearestFilter;
  } else {
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  }
  tex.colorSpace = spaceColorTexture(p);
  tex.anisotropy = Math.max(1, Math.min(anisotropyMax(), p.anisotropy || 1));
  if(opts.flipYAuto !== undefined){
    tex.flipY = (p.invertY === 'auto') ? !!opts.flipYAuto : (p.invertY === 'oui');
  }
  markTextureDirty(tex);
}

// `needsUpdate` sur une texture dont l'image n'est pas encore décodée fait planter
// WebGPURenderer au rendu suivant (« Cannot read properties of null (reading 'complete') ») :
// il lit `image.complete` sans tester null. C'est le cas de toute texture importée entre
// `TextureLoader.load()` et son rappel. Rien n'est perdu à attendre : le chargeur marque
// lui-même l'original, et `applyImportTexture` (appelé au chargement) reconfigure les clones.
export function textureReady(tex){
  const img = tex && tex.image;
  return !!img && img.complete !== false;
}
export function markTextureDirty(tex){
  if(textureReady(tex)) tex.needsUpdate = true;
}

// maps parcourues pour retrouver les clones d'une texture déjà posés sur la scène
export const KEYS_MAP_THREE = ['map', 'normalMap', 'roughnessMap', 'metalnessMap',
                        'aoMap', 'emissiveMap', 'alphaMap'];

export function applyImportTexture(a){
  const p = ensureParamsImport(a);
  if(!p || !a.texture) return 0;
  // réduction éventuelle : le masque combiné est repacké depuis l'image, son hidden saute
  const img = imageForTexture(a, p);
  if(img && a.texture.image !== img){
    a.texture.image = img;
    cacheCombined.delete(a.id);
  }
  configureTexture(a.texture, p, {});

  // clones posés directement sur des objets (glisser-déposer d'une texture)
  let n = 0;
  const vus = new Set();
  objects.forEach(function(root){
    root.traverse(function(m){
      if(!m.isMesh) return;
      listMats(m).forEach(function(mat){
        KEYS_MAP_THREE.forEach(function(k){
          const tex = mat[k];
          if(!tex || !tex.userData || tex.userData.assetTexture !== a.id || vus.has(tex)) return;
          vus.add(tex);
          // les clones des matériaux assets sont refaits juste après (canvas repacké
          // pour le masque combiné) : on ne touche pas à leur image
          if(!tex.userData.tuilageMaterial && a.texture.image) tex.image = a.texture.image;
          configureTexture(tex, p, {flipYAuto: tex.userData.flipYAuto,
                                     tuilage: !tex.userData.tuilageMaterial});
          mat.needsUpdate = true;
          n++;
        });
      });
    });
  });

  // matériaux assets : leurs maps sont des clones refaits à chaque application
  const KEYS_ASSET = ['texAsset', 'normalAsset', 'roughnessAsset', 'metalAsset',
                      'aoAsset', 'emissiveAsset', 'combineAsset'];
  assets.filter(function(x){ return x.kind === 'material'; }).forEach(function(mA){
    const pr = mA.props || {};
    if(!KEYS_ASSET.some(function(k){ return pr[k] === a.id; })) return;
    applyMaterialEverywhere(mA);
    n++;
  });

  applyFilters();
  updateProject();
  return n;
}


// ---------- Audio : valeurs par défaut des sources ----------
export const KEYS_AUDIO_IMPORT = ['volume', 'loop', 'spatial', 'range', 'pitch'];

// recopie les réglages de l'asset sur une source (userData.audio)
export function setDefaultsAudio(a, ua){
  const p = ensureParamsImport(a);
  if(!p || !ua) return;
  KEYS_AUDIO_IMPORT.forEach(function(k){ ua[k] = p[k]; });
}

export function applyImportAudio(a, updateSources){
  if(!updateSources) return 0;
  let n = 0;
  objects.forEach(function(o){
    const ua = o.userData.audio;
    if(!ua || ua.asset !== a.id) return;
    setDefaultsAudio(a, ua);
    n++;
  });
  return n;
}


// ---------- Inspecteur : panneau « paramètres d'import » ----------
// les instances/sources existantes sont-elles mises à jour avec les réglages ?
export let updateTargetsImport = true;

export function ipCell(id, label, checked, title, disabled){
  return '<div class="field"' + (title ? ' title="' + escapeHtml(title) + '"' : '')
    + '><label>' + label + '</label>'
    + '<input type="checkbox" id="' + id + '"' + (checked ? ' checked' : '')
    + (disabled ? ' disabled' : '') + '></div>';
}
export function ipNumber(id, label, val, step, min, max, disabled, title){
  return '<div class="field"' + (title ? ' title="' + escapeHtml(title) + '"' : '')
    + '><label>' + label + '</label>'
    + '<input type="number" id="' + id + '" step="' + step + '" min="' + min + '" max="' + max
    + '" value="' + val + '"' + (disabled ? ' disabled' : '') + '></div>';
}
export function ipSelect(id, label, options, val, title){
  let opts = '';
  options.forEach(function(o){
    opts += '<option value="' + o[0] + '"' + (o[0] === val ? ' selected' : '') + '>' + o[1] + '</option>';
  });
  return '<div class="field"' + (title ? ' title="' + escapeHtml(title) + '"' : '')
    + '><label>' + label + '</label><select id="' + id + '">' + opts + '</select></div>';
}
export function ipInfo(label, value, id, title){
  return '<div class="field"' + (title ? ' title="' + escapeHtml(title) + '"' : '') + '><label>' + label + '</label>'
    + '<span class="ip-info"' + (id ? ' id="' + id + '"' : '') + '>'
    + escapeHtml(value) + '</span></div>';
}

// nom de l'unité correspondant à un facteur « mètres par unité », ou null
export function unitNamed(factor){
  const f = factor > 0 ? factor : 1;
  return Object.keys(UNITS_METER).find(function(k){
    return Math.abs(UNITS_METER[k] - f) < 1e-9;
  }) || null;
}

// résolution envoyée au GPU, avec celle du fichier quand elle a été réduite
export function resolutionReadable(a){
  const img = a.texture && a.texture.image;
  if(!img || !img.width) return 'chargement…';
  const src = a.dimensionsSource;
  const txt = img.width + ' × ' + img.height + ' px';
  return (src && (src[0] !== img.width || src[1] !== img.height))
    ? txt + '  (source ' + src[0] + ' × ' + src[1] + ')' : txt;
}

// maps de la scène alimentées par cette texture
export function countUsagesTexture(a){
  let n = 0;
  const vus = new Set();
  objects.forEach(function(root){
    root.traverse(function(m){
      if(!m.isMesh) return;
      listMats(m).forEach(function(mat){
        KEYS_MAP_THREE.forEach(function(k){
          const tex = mat[k];
          if(tex && tex.userData && tex.userData.assetTexture === a.id && !vus.has(tex)){
            vus.add(tex);
            n++;
          }
        });
      });
    });
  });
  return n;
}

// encombrement du modèle après conversion, en unités lisibles (donc en mètres)
export function dimensionsReadable(a){
  const d = a.dimensions;
  if(!d) return '—';
  const max = Math.max(d[0], d[1], d[2]);
  const petit = max > 0 && max < 0.5;   // sous 50 cm, les cm parlent mieux
  const f = petit ? 100 : 1;
  const n = function(v){ return (v * f).toFixed(petit ? 1 : 2); };
  return n(d[0]) + ' × ' + n(d[1]) + ' × ' + n(d[2]) + (petit ? ' cm' : ' m');
}

export const NAMES_KIND = {texture:'Texture', model:'Modèle 3D', prefab:'Prefab',
                    script:'Script', material:'Matériau', audio:'Son', graphShader:'Graphe de shader',
                    animation:'Animation', sprite:'Sprite 2D', postProfile:'Profil de post-traitement',
                    animator:'Machine Animator', preset:"Preset d'import"};


// ---------- Sprite : réglages et découpe de planche ----------
//
// La découpe en grille est le geste qui transforme une planche en animation : sans elle, un
// sprite reste une image et il faut ressortir un logiciel d'image pour en tirer des cases.
// `sliceGrid` fait le calcul (js/sprite-2d.js, éprouvé) ; ici on ne fait que le régler.

export function sectionAssetSpriteHtml(a){
  const tex = assets.find(function(x){ return x.id === a.textureId; }) || null;
  const dims = dimensionsTexture(tex);
  const L = dims.l, H = dims.h;
  const regions = a.regions || [];
  const soucis = (typeof validateSprite === 'function')
    ? validateSprite(a, assets.filter(function(x){ return x.kind === 'texture'; }).map(function(x){ return x.id; }))
    : [];

  let h = '<div class="sec">Sprite</div>';
  if(soucis.length){
    h += '<div class="anim-issue"><b>' + soucis.length + ' problème(s)</b><ul>'
      + soucis.map(function(s){ return '<li>' + escapeHtml(s) + '</li>'; }).join('') + '</ul></div>';
  }
  h += ipInfo('Texture', tex ? (tex.name + ' · ' + L + '×' + H + ' px') : '— introuvable —')
    + ipNumber('ip-sp-ppu', 'Pixels par unité', a.ppu, 1, 1, 4096, false,
        'Combien de pixels de l\'image occupent une unité du monde. 16 pour du pixel-art, '
        + '100 pour une illustration. Changer cette valeur change la taille affichée.')
    + ipTwoNumbers('ip-sp-pivx', 'ip-sp-pivy', 'Pivot (0→1)',
        [(a.pivot && a.pivot.x !== undefined) ? a.pivot.x : 0.5,
         (a.pivot && a.pivot.y !== undefined) ? a.pivot.y : 0.5], 0.05,
        'Le point du sprite qui tombe sur l\'origine de l\'objet. 0,5 / 0 = les pieds : poser '
        + 'le personnage sur le sol revient alors à poser son y sur le sol.')
    + ipInfo('Images', regions.length + (regions.length > 1 ? ' régions' : ' région'));

  h += '<div class="sec">Découper la planche</div>'
    + '<div class="ip-note">Découpe en grille, de gauche à droite puis de haut en bas. Une '
    + 'cellule qui dépasserait du bord est abandonnée plutôt que rognée — une demi-image ne se '
    + 'remarque qu\'à l\'animation.</div>'
    + ipTwoNumbers('ip-sp-cl', 'ip-sp-ch', 'Cellule (px)', [a._decL || 16, a._decH || 16], 1)
    + ipTwoNumbers('ip-sp-marge', 'ip-sp-esp', 'Marge · espacement', [a._decM || 0, a._decE || 0], 1)
    + '<div class="field"><label></label><button class="btn-modal accent" id="ip-sp-slice">'
    + '✂ Découper</button></div>';
  if(L > 0 && H > 0){
    const preview = (typeof sliceGrid === 'function')
      ? sliceGrid(L, H, a._decL || 16, a._decH || 16,
          {marge: a._decM || 0, spacing: a._decE || 0}).length : 0;
    h += '<div class="ip-note">Cette grille donnerait <b>' + preview + '</b> image(s).</div>';
  }
  if(regions.length > 1){
    h += '<div class="field"><label></label><button class="btn-modal" id="ip-sp-merge">'
      + '↩ Revenir à une seule image</button></div>';
  }
  // Assembler PLUSIEURS planches. Sans cette étape, un personnage livré en neuf planches — repos,
  // marche, course, saut… — ne peut pas être animé du tout : un SpriteAnimator lit toutes ses
  // suites dans UN SEUL asset. Ce n'était pas une limite du format, c'était une étape manquante.
  const autres = assets.filter(function(x){ return x.kind === 'sprite' && x !== a; }).length;
  if(autres > 0){
    h += '<div class="sec">Assembler plusieurs planches</div>'
      + '<div class="ip-note">Un animateur de sprite lit toutes ses suites dans <b>une seule</b> '
      + 'planche. Un personnage livré en plusieurs fichiers — un par état — doit donc être réuni '
      + 'ici : l\'assemblage crée une nouvelle planche qui contient toutes les images, nommées '
      + '<code>fichier/image</code>.</div>'
      + '<div class="field"><label></label><button class="btn-modal" id="ip-sp-atlas">'
      + '🧩 Assembler avec d\'autres planches…</button></div>';
  }

  // ---------- Les suites d'animation ----------
  // Elles vivent sur la PLANCHE et pas sur l'objet : ce sont des images de cette planche-ci, et
  // deux personnages qui la partagent doivent partager la découpe. Les régler par objet
  // obligerait à les ressaisir à chaque copie, et à les corriger partout après un redécoupage.
  const sequences = a.sequences || [];
  h += '<div class="sec">Suites d\'animation</div>';
  const soucisSequences = (typeof validateSequences === 'function') ? validateSequences(sequences, regions) : [];
  if(soucisSequences.length){
    h += '<div class="anim-issue"><b>' + soucisSequences.length + ' problème(s)</b><ul>'
      + soucisSequences.map(function(s){ return '<li>' + escapeHtml(s) + '</li>'; }).join('')
      + '</ul></div>';
  }
  if(!sequences.length){
    h += '<div class="ip-note">Aucune suite. Une suite est une liste d\'images jouée à une '
      + 'cadence : « course », images 0 à 7, 12 images par seconde.</div>';
  } else {
    h += '<div class="ip-list">' + sequences.map(function(s, i){
      const n = (s.images || []).length;
      return '<div class="ip-line"><b>' + escapeHtml(s.name) + '</b>'
        + '<span>' + n + ' img · ' + s.ips + ' im/s · ' + (s.loop ? 'loop' : 'une fois')
        + ' · ' + (n && s.ips > 0 ? (n / s.ips).toFixed(2) : '0') + ' s</span>'
        + '<button class="btn-mini" data-sequence-del="' + i + '" title="Supprimer cette suite">✕</button>'
        + '</div>';
    }).join('') + '</div>';
  }
  if(regions.length){
    h += ipText2('ip-sp-sn', 'Nom', a._sN || '', 'Le nom que les scripts joueront : '
        + 'jouerAnimSprite(objet, \'course\').')
      + ipTwoNumbers('ip-sp-sd', 'ip-sp-snb', 'Depuis l\'image · combien',
          [a._sD || 0, a._sCount || Math.min(regions.length, 4)], 1,
          'Les images sont numérotées dans l\'ordre de la découpe : de gauche à droite puis de '
          + 'haut en bas.')
      + ipNumber('ip-sp-sips', 'Images par seconde', a._sIps || 12, 1, 1, 60, false,
          '12 pour une course, 6 pour un repos, 16 pour un impact.')
      + ipCell('ip-sp-sb', 'Boucle', a._sB !== false,
          'Décoché : la suite se joue une fois puis rend la main à la suite par défaut de '
          + 'l\'objet — c\'est ce qu\'on veut d\'une réception ou d\'un atterrissage.')
      + '<div class="field"><label></label><button class="btn-modal accent" id="ip-sp-add-sequence">'
      + '＋ Ajouter la suite</button></div>';
  }
  return h;
}

/** Un champ texte d'inspecteur d'asset. Les autres `ip*` couvraient tout sauf celui-là. */
export function ipText2(id, label, val, title){
  return '<div class="field"' + (title ? ' title="' + escapeHtml(title) + '"' : '')
    + '><label>' + label + '</label><input type="text" id="' + id + '" value="'
    + escapeHtml(val || '') + '" spellcheck="false"></div>';
}

export function applyFormSprite(a){
  const n = (id, def) => { const v = parseFloat((document.getElementById(id) || {}).value); return isFinite(v) ? v : def; };
  a.ppu = Math.max(1, n('ip-sp-ppu', a.ppu));
  a.pivot = {x: Math.max(0, Math.min(1, n('ip-sp-pivx', 0.5))),
             y: Math.max(0, Math.min(1, n('ip-sp-pivy', 0.5)))};
  // Les réglages de découpe ne sont PAS enregistrés dans l'asset : ils décrivent un geste, pas
  // le sprite. Les persister ferait croire qu'ils décrivent l'état current des régions, alors
  // qu'on peut très bien avoir découpé puis ajusté une région à la main.
  a._decL = Math.max(1, n('ip-sp-cl', 16));
  a._decH = Math.max(1, n('ip-sp-ch', 16));
  a._decM = Math.max(0, n('ip-sp-marge', 0));
  a._decE = Math.max(0, n('ip-sp-esp', 0));
  // Idem pour le formulaire de suite : il décrit le geste « add », pas la planche.
  const field = document.getElementById('ip-sp-sn');
  if(field) a._sN = field.value;
  a._sD = Math.max(0, n('ip-sp-sd', 0));
  a._sCount = Math.max(1, n('ip-sp-snb', 4));
  a._sIps = Math.max(1, Math.min(60, n('ip-sp-sips', 12)));
  const c = document.getElementById('ip-sp-sb');
  if(c) a._sB = c.checked;
  refreshSpritesOfLAsset(a);
}

/** Toute maille qui affiche ce sprite est refaite : le ppu et le pivot en changent la taille. */
export function refreshSpritesOfLAsset(a){
  objects.forEach(function(o){
    if(o.userData && o.userData.sprite2d && o.userData.sprite2d.spriteId === a.id){
      rebuildMeshSprite(o);
    }
  });
}

// ---------- Matériau : éditeur complet dans l'inspecteur ----------
// Sélectionner une tile 🎨 donne directement accès à toutes les propriétés PBR ;
// les maps acceptent le glisser-déposer d'une texture du panneau Projet.
export function ipColor(id, label, val, title, disabled){
  return '<div class="field"' + (title ? ' title="' + escapeHtml(title) + '"' : '')
    + '><label>' + label + '</label>'
    + '<input type="color" id="' + id + '" value="' + val + '"'
    + (disabled ? ' disabled' : '') + '></div>';
}
export function ipTwoNumbers(id1, id2, label, vals, step, title){
  return '<div class="field"' + (title ? ' title="' + escapeHtml(title) + '"' : '')
    + '><label>' + label + '</label>'
    + '<input type="number" id="' + id1 + '" step="' + step + '" style="width:60px" value="' + vals[0] + '"> '
    + '<input type="number" id="' + id2 + '" step="' + step + '" style="width:60px" value="' + vals[1] + '"></div>';
}

export function ipThreeNumbers(idBase, label, vals, step, title){
  return '<div class="field"' + (title ? ' title="' + escapeHtml(title) + '"' : '')
    + '><label>' + label + '</label>'
    + '<input type="number" id="' + idBase + '-x" step="' + step + '" style="width:44px" value="' + (vals.x || 0) + '"> '
    + '<input type="number" id="' + idBase + '-y" step="' + step + '" style="width:44px" value="' + (vals.y || 0) + '"> '
    + '<input type="number" id="' + idBase + '-z" step="' + step + '" style="width:44px" value="' + (vals.z || 0) + '"></div>';
}

// Propriétés exposées par un grapheShader : son BLACKBOARD (`asset.properties`, voir
// shader-graph-editor.js) — et, pour un graphe pas encore rouvert dans l'éditeur, ses vieux
// nœuds `param.*`, qui portaient la même chose avant que les propriétés ne deviennent
// indépendantes du plan. materiaux.js/assignShaderOnMaterial dit comment un materiau vient à
// référencer un shader. Rien ici ne dépend de META_NODES_GRAPH_SHADER (fichier ÉDITEUR SEUL,
// pas garanti chargé partout où un materiau peut s'afficher).
export function propertiesExposedOfShader(shaderAsset){
  if(!shaderAsset) return [];
  if((shaderAsset.properties || []).length){
    return shaderAsset.properties.map(function(p){
      return {name:p.name, type:p.type, defaultValue:p.defaultValue};
    });
  }
  return (shaderAsset.nodes || [])
    .filter(function(n){ return n.type.indexOf('param.') === 0; })
    .map(function(n){
      const type = n.type.replace('param.', '');
      const defaultValue = type === 'vec3' ? {x:n.params.x, y:n.params.y, z:n.params.z}
        : type === 'texture' ? n.params.defaultTextureAsset
        : n.params.defaultValue;
      return {name:n.params.name || n.id, type:type, defaultValue:defaultValue};
    });
}

export function renderPropsShaderMaterial(a, shaderAsset){
  if(!shaderAsset){
    return '<div class="ip-note">⚠ Ce matériau référence un graphe de shader introuvable '
      + '(asset supprimé) — repli sur un aspect neutre.</div>';
  }
  const props = propertiesExposedOfShader(shaderAsset);
  a.valuesParams = a.valuesParams || {};
  let html = '<div class="sec">Propriétés — ' + escapeHtml(shaderAsset.name) + '</div>';
  if(!props.length){
    html += '<div class="ip-note" title="Ajoutez des propriétés au blackboard du graphe pour '
      + 'qu\'elles apparaissent ici, éditables par matériau.">Ce shader n\'expose aucune propriété.</div>';
    return html;
  }
  props.forEach(function(p){
    const id = 'ip-shp-' + p.name;
    const val = a.valuesParams[p.name];
    const title = 'Propriété exposée par le shader « ' + shaderAsset.name + ' ».';
    if(p.type === 'color') html += ipColor(id, p.name, val !== undefined ? val : p.defaultValue, title);
    else if(p.type === 'texture') html += ipSelectTextureShader(id, p.name, val !== undefined ? val : p.defaultValue, title);
    else if(p.type === 'vec3') html += ipThreeNumbers(id, p.name, val !== undefined ? val : p.defaultValue, 0.1, title);
    else html += ipNumber(id, p.name, val !== undefined ? val : p.defaultValue, 0.01, -1e6, 1e6, false, title);
  });
  return html;
}

// L'inspecteur matériau est désormais la PROJECTION de la table déclarative
// (js/material-props.js) : types, plages, libellés, dépendances et infobulles y vivent
// une seule fois, et le copilote lit la même chose. Ce qui reste ici est ce qui ne
// concerne QUE l'affichage : le décount des objets et le rappel sur le glisser-déposer.
export function sectionMaterialHtml(a){
  const countObjects = objects.filter(function(o){ return o.userData.materialId === a.id; }).length;
  const shaders = assets.filter(function(x){ return x.kind === 'graphShader'; });
  let html = '<div class="sec">Shader</div>'
    + ipSelect('ip-mat-shader', 'Shader', [['', '— PBR classique —']].concat(
        shaders.map(function(s){ return [s.id, s.name]; })), a.shaderId || '',
        'Un graphe de shader personnalisé remplace les propriétés PBR par celles qu\'il '
        + 'expose (ses nœuds « Property : … »). Se choisit aussi en glissant un 🧩 sur '
        + 'cette vignette depuis le panneau Projet.');
  if(a.shaderId){
    const shaderAsset = shaders.find(function(s){ return s.id === a.shaderId; });
    html += renderPropsShaderMaterial(a, shaderAsset);
  } else {
    const p = ensurePropsMaterial(a);
    // Matériau de plugin : MÊME projection, autre table. C'est le seul endroit où l'on
    // choisit laquelle, et c'est aussi celui qui traite le projet rouvert SANS son plugin —
    // cas où la table est introuvable alors que les valeurs, elles, sont toujours dans le
    // project.
    html += headerMaterialPluginHtml(p) + renderPropsMaterial(p, tablePropsMaterialOrNative(p));
  }
  return html + ipInfo('Objets', countObjects + ' dans la scène', null,
    'Les objets et modèles qui utilisent ce matériau sont mis à jour immédiatement. Glissez '
    + 'la vignette 🎨 sur un objet de la vue pour l\'affecter, ou sur un emplacement de matériau '
    + 'd\'un modèle importé.');
}

// `typeof` partout : import-settings.js doit rester utilisable sans le système de plugins
// (il est chargé après), et une page qui ne l'inclut pas doit voir le matériau natif, pas
// une exception.
export function tablePropsMaterialOrNative(p){
  return (typeof tablePropsMaterial === 'function') ? tablePropsMaterial(p) : PROPS_MATERIAL;
}

// Un matériau de plugin doit DIRE qu'il en est un, et dire ce qui lui manque. Deux états
// distincts qu'il serait facile de confondre :
//   plugin présent  → l'inspecteur montre sa table ; la vignette, elle, ne peut pas montrer
//                     son shader (voir previewMaterial, js/materials.js).
//   plugin absent   → le projet a été rouvert sans lui. Les valeurs sont intactes dans le
//                     fichier, mais plus rien ne sait les afficher NI les rendre : on
//                     retombe sur la table native, et on le dit au lieu de faire comme si
//                     le matériau avait toujours été natif.
export function headerMaterialPluginHtml(p){
  if(!p.materialPlugin) return '';
  const def = (typeof materialPluginOf === 'function') ? materialPluginOf(p) : null;
  if(!def){
    return '<div class="ip-note">⚠ Ce matériau est piloté par le plugin « '
      + escapeHtml(p.materialPlugin) + ' », qui n\'est pas installé dans ce navigateur. '
      + 'Ses réglages sont conservés dans le projet mais ne sont ni affichés ni rendus : '
      + 'ce sont les propriétés natives ci-dessous qui s\'appliquent.</div>';
  }
  return '<div class="sec">Matériau « ' + escapeHtml(def.name) + ' »</div>'
    + '<div class="ip-note">Shader fourni par un plugin (' + escapeHtml(def.category)
    + '). La vignette du panneau Projet n\'affiche PAS ce shader — elle est rendue par le '
    + 'renderer classique, qui ne compile pas les matériaux à nœuds. Ce matériau ne part '
    + 'pas non plus dans un jeu publié.</div>';
}

// ---------- Le brouillon : ce qui est saisi n'est pas encore appliqué ----------
//
// Les réglages d'import s'appliquaient AU FIL DE LA FRAPPE. C'est faux pour un import : changer
// l'unité d'un modèle reconstruit toutes ses instances, recuire un dépliage prend du temps, et
// une valeur intermédiaire tapée au clavier (un « 0 » avant « 0,5 ») était appliquée pour de bon.
// Unity bufferise pour la même raison, et affiche Revert / Apply.
//
// Le brouillon vit sur l'asset (`a.paramsDraft`). Il n'est JAMAIS sérialisé : un projet
// enregistré ne contient que ce qui a été appliqué.

/** Les réglages à AFFICHER : le brouillon s'il existe, sinon ceux qui sont appliqués. */
export function paramsShown(a){
  return (a && a.paramsDraft) ? a.paramsDraft : ensureParamsImport(a);
}

export function ensureDraft(a){
  const p = ensureParamsImport(a);
  if(!a.paramsDraft) a.paramsDraft = JSON.parse(JSON.stringify(p));
  return a.paramsDraft;
}

export function importDirty(a){
  if(!a || !a.paramsDraft || !a.paramsImport) return false;
  return JSON.stringify(a.paramsDraft) !== JSON.stringify(a.paramsImport);
}

export function discardDraft(a){ if(a) a.paramsDraft = null; }

/** Applique le brouillon pour de bon. C'est le seul chemin qui touche la scène. */
export function applyDraft(a){
  if(!a) return 0;
  if(a.paramsDraft){
    // Un seul pas d'historique pour toute la saisie : c'est le geste « Appliquer » qu'on annule,
    // pas les quinze frappes qui l'ont précédé.
    pushHistory();
    a.paramsImport = a.paramsDraft;
    a.paramsDraft = null;
  }
  let n = 0;
  if(a.kind === 'model'){
    n = applyImportModel(a, true);
    // « Location : Use External Materials » : chaque emplacement sans matériau du projet en
    // reçoit un, extrait du fichier, à chaque application — comme l'import legacy d'Unity.
    const map = a.paramsImport.materials || {};
    if(a.paramsImport.materialLocation === 'external'
       && slotsMaterialsModel(a).some(function(s){ return !map[s.name]; })){
      extractMaterialsModel(a);
    }
  }
  else if(a.kind === 'texture') n = applyImportTexture(a);
  else if(a.kind === 'audio') n = applyImportAudio(a, true);
  setStatus('Import de « ' + a.name + ' » appliqué'
    + (n ? ' · ' + n + ' élément(s) mis à jour' : ''), 2500);
  buildInspectorAsset(a);
  updateProject();
  return n;
}

/**
 * Le garde-fou de la sélection : on ne quitte pas un asset dont les réglages ne sont pas
 * appliqués sans avoir répondu. Rend `false` quand la sélection ne doit PAS bouger.
 *
 * Appelé par selection.js à travers une garde `typeof` : le panneau Projet n'existe que dans
 * l'éditeur, et selection.js ne doit pas dépendre de ce fichier-ci (le cycle serait réel).
 */
export function guardImportDirty(next, proceed){
  const a = assetSelected;
  if(!a || a === next || !importDirty(a)) return true;
  if(typeof openModal !== 'function'){ discardDraft(a); return true; }
  openModal('Modifications non appliquées',
    '<p>Les paramètres d\'import de <b>' + escapeHtml(a.name) + '</b> ont été modifiés sans '
    + 'être appliqués.</p>'
    + '<p style="margin-top:8px;color:var(--txt-dim)">« Abandonner » rend les valeurs '
    + 'appliquées la dernière fois. Rien n\'est perdu dans le fichier source : les paramètres '
    + 'd\'import ne le modifient jamais.</p>'
    + '<div style="margin-top:14px;display:flex;gap:8px;justify-content:flex-end">'
    + '<button class="btn-modal" id="dirty-cancel">Annuler</button>'
    + '<button class="btn-modal" id="dirty-discard">Abandonner</button>'
    + '<button class="btn-modal accent" id="dirty-save">Enregistrer</button></div>');
  const close = function(){ if(typeof closeModal === 'function') closeModal(); };
  document.getElementById('dirty-cancel').onclick = close;
  document.getElementById('dirty-discard').onclick = function(){
    discardDraft(a);
    close();
    if(proceed) proceed();
  };
  document.getElementById('dirty-save').onclick = function(){
    applyDraft(a);
    close();
    if(proceed) proceed();
  };
  return false;
}
globalThis.guardImportDirty = guardImportDirty;


// ---------- Aperçu : le modèle, et ses UV ----------
//
// Unity montre le modèle et sa grille d'UV dans la fenêtre d'import, et ce n'est pas décoratif :
// c'est là qu'on voit qu'un dépliage de lightmap est correct, qu'une planche d'UV sort du carré
// unité, ou qu'un modèle n'a tout simplement pas d'`uv1`.

export const ANGLES_PREVIEW = [0, 45, 90, 135, 180, 225, 270, 315];

/** Jeux d'UV réellement présents — de tout le modèle, ou d'un seul de ses maillages. */
export function uvSetsOfModel(a, mesh){
  const sets = [];
  const target = mesh || (a && a.template);
  if(!target) return sets;
  target.traverse(function(o){
    if(!o.isMesh || !o.geometry || o.userData.isColliderViz) return;
    Object.keys(o.geometry.attributes).forEach(function(name){
      if(/^uv\d*$/.test(name) && sets.indexOf(name) === -1) sets.push(name);
    });
  });
  return sets.sort();
}

/**
 * Dessine les triangles d'un jeu d'UV dans un canvas 2D. Le carré unité est tracé en repère :
 * ce qui en sort est un carrelage, pas un dépliage — voir `diagnoseUnfold` (js/lightmap-bake.js).
 */
export function drawUvModel(canvas, a, name, mesh){
  if(!canvas || !canvas.getContext) return 0;
  const cx = canvas.getContext('2d');
  const L = canvas.width, H = canvas.height;
  cx.clearRect(0, 0, L, H);
  cx.fillStyle = '#15171c';
  cx.fillRect(0, 0, L, H);
  // le carré unité, et ses quarts
  cx.strokeStyle = '#3a3f4a';
  cx.lineWidth = 1;
  for(let i = 0; i <= 4; i++){
    const v = Math.round(i * (L - 1) / 4) + 0.5;
    cx.beginPath(); cx.moveTo(v, 0); cx.lineTo(v, H); cx.stroke();
    cx.beginPath(); cx.moveTo(0, v); cx.lineTo(L, v); cx.stroke();
  }
  let triangles = 0;
  cx.strokeStyle = 'rgba(120, 200, 255, 0.75)';
  cx.lineWidth = 0.7;
  cx.beginPath();
  const target = mesh || (a && a.template);
  (target ? [target] : []).forEach(function(root){
    root.traverse(function(o){
      if(!o.isMesh || !o.geometry || o.userData.isColliderViz) return;
      const attr = o.geometry.attributes[name];
      if(!attr) return;
      const idx = o.geometry.index ? o.geometry.index.array : null;
      const total = idx ? idx.length : attr.count;
      for(let t = 0; t + 2 < total; t += 3){
        const i0 = idx ? idx[t] : t, i1 = idx ? idx[t + 1] : t + 1, i2 = idx ? idx[t + 2] : t + 2;
        // V vers le haut dans l'espace UV, vers le bas dans un canvas
        const x0 = attr.getX(i0) * L, y0 = (1 - attr.getY(i0)) * H;
        const x1 = attr.getX(i1) * L, y1 = (1 - attr.getY(i1)) * H;
        const x2 = attr.getX(i2) * L, y2 = (1 - attr.getY(i2)) * H;
        cx.moveTo(x0, y0); cx.lineTo(x1, y1); cx.lineTo(x2, y2); cx.closePath();
        triangles++;
      }
    });
  });
  cx.stroke();
  return triangles;
}


// ---------- L'onglet Animation ----------
//
// Le Model Importer d'Unity, onglet Animation : les réglages d'import des prises du fichier, puis
// la LISTE DES CLIPS qu'on en tire — plusieurs clips peuvent découper la même prise — et les
// réglages du clip sélectionné. Tout passe par le brouillon, comme le reste du panneau : rien ne
// joue autrement avant « Appliquer ».
//
// CE QUI N'EST PAS REPRIS, et pourquoi. « Import Constraints », « Bake Animations » et « Resample
// Curves » n'ont pas d'objet ici : three échantillonne déjà les courbes en clés et ne lit pas les
// contraintes du FBX. « Animated Custom Properties » et « Curves » demandent des courbes nommées
// que le moteur n'a pas. « Additive Reference Pose » attend des couches additives, que l'Animator
// n'a pas encore.

export function clipsDraftOf(a, p){
  if(!Array.isArray(p.clips)){
    p.clips = (typeof defaultClipsOfTakes === 'function')
      ? defaultClipsOfTakes((a.animationsBrutes || (a.template && a.template.animations) || []),
          newClipId)
      : [];
  }
  return p.clips;
}

/** La prise du fichier qui porte ce nom — le clip brut, avant réglages. */
export function takeOfModel(a, name){
  const takes = (a && (a.animationsBrutes || (a.template && a.template.animations))) || [];
  return takes.find(function(t){ return t.name === name; }) || null;
}

/**
 * Le voyant de bouclage d'Unity : la pose de fin rejoint-elle celle du début ? Rend `{deg, level}`
 * où `level` vaut ok (< 1°), near (< 5°) ou off — l'écart de rotation le plus grand entre les deux
 * bouts de la découpe, os par os.
 */
export function loopMatchOfClip(a, c){
  const take = takeOfModel(a, c.take);
  if(!take || !take.tracks) return null;
  const d = take.duration || 0;
  const start = Math.max(0, Math.min(d, Number(c.start) || 0));
  const end = (c.end === null || c.end === undefined) ? d : Math.max(0, Math.min(d, Number(c.end)));
  let worst = 0;
  take.tracks.forEach(function(t){
    if(!/\.quaternion$/.test(t.name)) return;
    const it = t.createInterpolant();
    const q0 = Array.prototype.slice.call(it.evaluate(start), 0, 4);
    const q1 = Array.prototype.slice.call(it.evaluate(end), 0, 4);
    const dot = Math.min(1, Math.abs(q0[0] * q1[0] + q0[1] * q1[1] + q0[2] * q1[2] + q0[3] * q1[3]));
    worst = Math.max(worst, 2 * Math.acos(dot) * 180 / Math.PI);
  });
  return {deg: worst, level: worst < 1 ? 'ok' : (worst < 5 ? 'near' : 'off')};
}

export function sectionAnimationTabHtml(a, p){
  const takes = (a.animationsBrutes || (a.template && a.template.animations) || []);
  let h = '<div class="sec">Import</div>'
    + ipCell('ip-anim-import', 'Importer l\'animation', p.importAnimation !== false,
        'Décoché : aucune prise du fichier n\'est importée, et le modèle n\'expose aucun clip — '
        + '« Import Animation » d\'Unity.');
  if(!takes.length){
    return h + '<div class="ip-note">Ce fichier ne porte aucune prise d\'animation.</div>';
  }
  if(p.importAnimation === false) return h;
  h += ipSelect('ip-anim-compression', 'Compression', [['off', 'Aucune'],
        ['reduction', 'Réduction des clés']], p.animCompression || 'off',
        'Retire les clés que l\'interpolation redonne à la tolérance près — « Anim. Compression : '
        + 'Keyframe Reduction » d\'Unity. Allège le clip sans changer ce qu\'on voit.')
    + (p.animCompression === 'reduction'
      ? ipNumber('ip-anim-err-rot', 'Erreur de rotation', p.animRotationError, 0.1, 0, 10, false,
          'En degrés.')
        + ipNumber('ip-anim-err-pos', 'Erreur de position', p.animPositionError, 0.1, 0, 10, false,
          'En pour cent de l\'amplitude de la piste.')
        + ipNumber('ip-anim-err-scale', 'Erreur d\'échelle', p.animScaleError, 0.1, 0, 10, false,
          'En pour cent de l\'amplitude de la piste.')
      : '');

  const clips = clipsDraftOf(a, p);
  const sel = Math.max(0, Math.min(clips.length - 1, a._clipSel || 0));
  a._clipSel = sel;
  h += '<div class="sec">Clips</div><div class="ip-clip-list">'
    + (clips.length ? clips.map(function(c, i){
        const take = takeOfModel(a, c.take);
        const d = take ? take.duration : 0;
        const end = (c.end === null || c.end === undefined) ? d : c.end;
        return '<div class="ip-clip-row' + (i === sel ? ' on' : '') + '" data-clip-sel="' + i + '">'
          + '<span data-clip-sel="' + i + '">' + escapeHtml(c.name || c.take) + '</span>'
          + '<span class="ip-info" data-clip-sel="' + i + '">' + (Number(c.start) || 0).toFixed(2)
          + ' → ' + Number(end).toFixed(2) + ' s</span></div>';
      }).join('') : '<div class="ip-note">Aucun clip : ce modèle n\'expose aucune animation.</div>')
    + '</div><div class="field"><label></label>'
    + '<button class="btn-mini" id="ip-clip-add" title="Ajouter un clip — on peut en découper '
    + 'plusieurs dans la même prise">＋ Clip</button> '
    + '<button class="btn-mini" id="ip-clip-del"' + (clips.length ? '' : ' disabled')
    + ' title="Retirer le clip sélectionné. Un état d\'Animator qui le jouait le signalera.">'
    + '－ Retirer</button></div>';
  const c = clips[sel];
  if(!c) return h;

  const take = takeOfModel(a, c.take);
  const duration = take ? take.duration : 0;
  const match = loopMatchOfClip(a, c);
  const colors = {ok: '#6fdc8c', near: '#ffd166', off: '#ff6b6b'};
  h += '<div class="sec">Clip « ' + escapeHtml(c.name || c.take) + ' »</div>'
    + '<div class="field"><label>Nom</label><input type="text" id="ip-clip-name" value="'
    + escapeHtml(c.name || '') + '"></div>'
    + ipSelect('ip-clip-take', 'Prise source', takes.map(function(t){ return [t.name, t.name]; }),
        c.take, 'La prise (take) du fichier dont ce clip est tiré — « Source Take » d\'Unity.')
    + ipInfo('Durée de la prise', duration.toFixed(2) + ' s')
    + ipTwoNumbers('ip-clip-start', 'ip-clip-end', 'Début / fin (s)',
        [Number(c.start) || 0, (c.end === null || c.end === undefined) ? duration : c.end], 0.01,
        'La découpe, en secondes de la prise. Plusieurs clips peuvent découper la même prise.')
    + ipNumber('ip-clip-speed', 'Vitesse', c.speed === undefined ? 1 : c.speed, 0.05, 0.05, 10, false,
        'Multiplicateur de lecture du clip.')
    + ipCell('ip-clip-loop', 'Boucle (Loop Time)', c.loop !== false,
        'Le clip repart au début une fois fini.')
    + ipCell('ip-clip-loop-pose', 'Boucler la pose (Loop Pose)', !!c.loopPose,
        'Répartit l\'écart entre la dernière et la première image sur tout le clip, pour que la '
        + 'boucle ne saute pas.')
    + ipNumber('ip-clip-cycle', 'Décalage de cycle', c.cycleOffset || 0, 0.05, 0, 0.99, false,
        'Fraction du cycle où le clip démarre — « Cycle Offset » d\'Unity. Utile pour désynchroniser '
        + 'deux personnages qui jouent la même marche.')
    + (match ? '<div class="field" title="Écart de rotation le plus grand entre le début et la fin '
        + 'de la découpe. Vert : la boucle ne se voit pas.">'
        + '<label>Correspondance de boucle</label><span class="ip-info">'
        + '<span style="color:' + colors[match.level] + '">●</span> '
        + match.deg.toFixed(1) + '°</span></div>' : '');

  const rigRoot = p.rootNode || '';
  h += '<div class="sec">Racine (root motion)</div>'
    + (rigRoot
      ? ipInfo('Nœud racine', rigRoot + ' (onglet Rig)')
      : '<div class="ip-note">Aucun <b>nœud racine</b> n\'est déclaré dans l\'onglet Rig : le root '
        + 'motion suit la première piste de position, et seul le déplacement X/Z sort du clip — '
        + 'le comportement d\'avant. Déclarez-le pour régler ce qui est cuit dans la pose.</div>')
    + ipCell('ip-clip-rot-bake', 'Rotation — cuite dans la pose', c.rootRotationBake !== false,
        'Coché : la rotation de la racine reste dans l\'animation. Décoché : elle tourne l\'objet '
        + 'quand l\'Animator applique le root motion — « Root Transform Rotation : Bake Into Pose ».',
        !rigRoot)
    + ipNumber('ip-clip-rot-offset', 'Rotation — décalage', c.rootRotationOffset || 0, 1, -180, 180,
        !rigRoot, 'En degrés autour de Y.')
    + ipCell('ip-clip-y-bake', 'Hauteur (Y) — cuite dans la pose', c.rootYBake !== false,
        'Décoché : la montée et la descente de la racine déplacent l\'objet (un saut) — « Root '
        + 'Transform Position (Y) : Bake Into Pose ».', !rigRoot)
    + ipNumber('ip-clip-y-offset', 'Hauteur (Y) — décalage', c.rootYOffset || 0, 0.01, -100, 100,
        !rigRoot, 'Ajouté à la hauteur de la racine.')
    + ipCell('ip-clip-xz-bake', 'Déplacement (XZ) — cuit dans la pose', !!c.rootXZBake,
        'Coché : le déplacement reste dans l\'animation, l\'objet ne bouge pas. Décoché : il '
        + 'déplace l\'objet quand l\'Animator applique le root motion.', !rigRoot);

  h += '<div class="sec">Divers</div>'
    + ipCell('ip-clip-mirror', 'Miroir', !!c.mirror,
        'Échange la gauche et la droite — un os « Left… » joue ce que faisait « Right… ». Suppose '
        + 'un rig construit en miroir (Mixamo, Blender, Maya).');

  // Le masque : la liste des os que le clip anime
  const bones = bonesOfModel(a).map(function(b){ return b.name; });
  const custom = Array.isArray(c.maskBones);
  h += '<div class="sec">Masque</div>'
    + ipSelect('ip-clip-mask', 'Os animés', [['all', 'Tout le squelette'], ['custom', 'Choisis']],
        custom ? 'custom' : 'all', 'Restreint le clip à une partie du squelette — le « Mask » d\'Unity.');
  if(custom && bones.length){
    const keep = new Set(c.maskBones);
    h += '<div class="field"><label></label><button class="btn-mini" id="ip-mask-all">Tout</button> '
      + '<button class="btn-mini" id="ip-mask-none">Rien</button></div>'
      + '<div class="ip-mask-list">' + bones.map(function(n){
          return '<label class="ip-mask-bone"><input type="checkbox" data-mask-bone="'
            + escapeHtml(n) + '"' + (keep.has(n) ? ' checked' : '') + '> ' + escapeHtml(n) + '</label>';
        }).join('') + '</div>';
  }

  // Les événements : les marqueurs de la prise, dans la découpe. Ils s'enregistrent tout de suite,
  // comme l'Avatar : ce ne sont pas des réglages d'import.
  const markers = (a.markers && a.markers[c.take]) || [];
  const end = (c.end === null || c.end === undefined) ? duration : Number(c.end);
  h += '<div class="sec">Événements</div>'
    + (markers.length ? markers.map(function(m, i){
        const inRange = m.t >= (Number(c.start) || 0) - 1e-6 && m.t <= end + 1e-6;
        return '<div class="field"' + (inRange ? '' : ' style="opacity:.5" title="Hors de la '
          + 'découpe de ce clip : il ne se déclenchera pas"') + '><label>' + m.t.toFixed(2)
          + ' s</label><span class="ip-info">' + escapeHtml(m.name || '') + '</span> '
          + '<button class="btn-mini" data-ev-del="' + i + '" title="Retirer">×</button></div>';
      }).join('') : '<div class="ip-note">Aucun événement sur cette prise.</div>')
    + '<div class="field"><label>Ajouter</label>'
    + '<input type="number" id="ip-ev-t" step="0.01" min="0" style="width:60px" value="'
    + (Number(c.start) || 0).toFixed(2) + '"> '
    + '<input type="text" id="ip-ev-name" placeholder="nom" style="width:90px"> '
    + '<button class="btn-mini" id="ip-ev-add">＋</button></div>'
    + '<div class="ip-note">Un événement appartient à la PRISE : tous les clips qui la découpent '
    + 'le partagent, et chacun ne déclenche que ceux de sa découpe.</div>';
  return h;
}

/** Lit les champs de l'onglet Animation dans le brouillon. */
export function readFormAnimationTab(a, p){
  p.importAnimation = ipChecked('ip-anim-import', p.importAnimation !== false);
  p.animCompression = ipText('ip-anim-compression') || p.animCompression;
  p.animRotationError = Math.max(0, ipNum('ip-anim-err-rot', p.animRotationError));
  p.animPositionError = Math.max(0, ipNum('ip-anim-err-pos', p.animPositionError));
  p.animScaleError = Math.max(0, ipNum('ip-anim-err-scale', p.animScaleError));
  if(!Array.isArray(p.clips)) return;
  const c = p.clips[a._clipSel || 0];
  if(!c || !document.getElementById('ip-clip-name')) return;
  const name = ipText('ip-clip-name');
  if(name !== null && name.trim()) c.name = name.trim();
  c.take = ipText('ip-clip-take') || c.take;
  const take = takeOfModel(a, c.take);
  const d = take ? take.duration : 0;
  c.start = Math.max(0, ipNum('ip-clip-start', c.start || 0));
  const end = ipNum('ip-clip-end', d);
  // La fin au bout de la prise s'enregistre `null` : c'est « jusqu'au bout », et un réimport qui
  // rallonge la prise rallonge le clip, comme dans Unity.
  c.end = (Math.abs(end - d) < 1e-4) ? null : end;
  c.speed = Math.max(0.05, ipNum('ip-clip-speed', c.speed === undefined ? 1 : c.speed));
  c.loop = ipChecked('ip-clip-loop', c.loop !== false);
  c.loopPose = ipChecked('ip-clip-loop-pose', !!c.loopPose);
  c.cycleOffset = Math.max(0, Math.min(0.99, ipNum('ip-clip-cycle', c.cycleOffset || 0)));
  c.rootRotationBake = ipChecked('ip-clip-rot-bake', c.rootRotationBake !== false);
  c.rootRotationOffset = ipNum('ip-clip-rot-offset', c.rootRotationOffset || 0);
  c.rootYBake = ipChecked('ip-clip-y-bake', c.rootYBake !== false);
  c.rootYOffset = ipNum('ip-clip-y-offset', c.rootYOffset || 0);
  c.rootXZBake = ipChecked('ip-clip-xz-bake', !!c.rootXZBake);
  c.mirror = ipChecked('ip-clip-mirror', !!c.mirror);
  const mask = ipText('ip-clip-mask');
  if(mask === 'all') c.maskBones = null;
  else if(mask === 'custom'){
    const boxes = inspBody.querySelectorAll('input[data-mask-bone]');
    if(boxes.length){
      const list = [];
      boxes.forEach(function(b){ if(b.checked) list.push(b.dataset.maskBone); });
      c.maskBones = list;
    }
    else if(!Array.isArray(c.maskBones)) c.maskBones = bonesOfModel(a).map(function(b){ return b.name; });
  }
}

// ---------- L'onglet Rig ----------
//
// Ce que le réglage décide vraiment, et ce n'est pas cosmétique : la VOIE de reciblage. En
// « générique », un clip venu d'un autre fichier est reporté os par os PAR SON NOM
// (js/retargeting.js) — ce qui marche entre deux exports Mixamo et échoue complètement entre un
// rig Mixamo et un rig Maya biped, qui n'ont pas un nom en commun. En « humanoïde », chaque
// squelette déclare ses vingt-deux emplacements dans un Avatar, et le report se fait
// d'emplacement à emplacement (js/humanoid-avatar.js) : deux rigs étrangers peuvent alors se
// parler. C'est `clipRetargetedBestWay` (js/retargeting.js) qui choisit, d'après les Avatars.

/**
 * Les os du modèle, SANS DOUBLON DE NOM (voir `bonesUnique`, js/humanoid-avatar.js).
 *
 * Un FBX à plusieurs maillages skinnés rapporte le même squelette plusieurs fois : le panneau
 * offrait donc dix « clavicle_r » indiscernables dans la même liste déroulante. Trois nœuds
 * portant le même nom ne sont de toute façon qu'une seule cible pour l'animation, qui résout
 * toujours le premier.
 */
export function bonesOfModel(a){
  return (a && a.template) ? bonesUnique(a.template) : [];
}

/** Pose ou retire l'Avatar selon le type d'animation demandé. */
export function applyRigModel(a, p){
  if(!a || a.kind !== 'model') return;
  if(p.animationType === 'humanoid'){
    if(p.avatarDefinition === 'copy'){
      const src = assets.find(function(x){ return x.id === p.avatarSource && x.kind === 'model'; });
      if(src && src.avatar) a.avatar = JSON.parse(JSON.stringify(src.avatar));
      return;
    }
    if(!a.avatar && a.template) a.avatar = autoMapAvatar(a.template);
  } else if(a.avatar){
    // Comme Unity : changer de type d'animation jette l'Avatar. Le dire dans le panneau, parce
    // qu'un mappage corrigé à la main représente du travail.
    a.avatar = null;
  }
}

export function sectionRigHtml(a, p){
  const bones = bonesOfModel(a);
  let h = '<div class="sec">Rig</div>'
    + ipSelect('ip-anim-type-rig', 'Type d\'animation',
        [['none', 'Aucune'], ['generic', 'Générique'], ['humanoid', 'Humanoïde']],
        p.animationType,
        'Générique : les clips se reportent d\'un rig à l\'autre par le NOM des os — parfait '
        + 'entre deux fichiers de la même bibliothèque (Mixamo, Rigify). Humanoïde : chaque '
        + 'squelette déclare ses emplacements dans un Avatar, et deux rigs qui n\'ont aucun nom '
        + 'en commun peuvent alors échanger leurs animations.')
    + ipInfo('Os', bones.length ? (bones.length + ' dans le squelette') : 'aucun — ce modèle n\'est pas rigué');

  if(!bones.length){
    return h + '<div class="ip-note">Sans squelette, le type d\'animation ne change rien : il n\'y '
      + 'a pas d\'os à faire correspondre.</div>';
  }

  // Poids de peau. La renormalisation, elle, n'est pas un choix : elle corrige ce que le
  // chargeur casse en tronquant (voir applySkinWeights, js/model-import.js).
  const skin = a.skinInfo || {};
  h += ipSelect('ip-skin-weights', 'Poids de peau',
        [[4, 'Standard (4 os)'], [2, '2 os'], [1, '1 os']], p.skinWeights,
        'Nombre d\'os qui peuvent influencer un même sommet. 4 est le maximum que le rendu '
        + 'sait faire ; descendre allège le calcul et durcit les déformations.')
    + (skin.renormalized
      ? '<div class="ip-note">⚠ <b>' + skin.renormalized + ' sommet(s)</b> avaient des poids qui '
        + 'ne sommaient pas à 1 — le chargeur FBX supprime les influences au-delà de quatre '
        + '<b>sans renormaliser</b>, ce qui tire ces sommets vers l\'origine du rig. '
        + 'Ils ont été renormalisés.</div>'
      : '')
    + (skin.clamped
      ? '<div class="ip-note">' + skin.clamped + ' sommet(s) ramené(s) à ' + p.skinWeights
        + ' influence(s).</div>' : '');
  if(p.animationType === 'none'){
    return h + '<div class="ip-note">Aucun reciblage : seuls les clips de ce fichier-ci pourront '
      + 'jouer sur ce modèle.</div>';
  }
  // Le « Root node » d'Unity : l'os d'où sort le root motion. Vide = le comportement d'avant
  // (la première piste de position de chaque clip).
  h += ipSelect('ip-rig-root', 'Nœud racine', [['', '— aucun (première piste de position)']]
        .concat(bones.map(function(b){ return [b.name, b.name]; })), p.rootNode || '',
        'L\'os dont le mouvement devient le root motion. Une fois déclaré, l\'onglet Animation '
        + 'règle clip par clip ce qui reste cuit dans la pose (rotation, hauteur, déplacement).');
  // « Optimize Game Objects » : le squelette reste interne aux instances, seuls les maillages et
  // les transforms listés apparaissent dans la hiérarchie.
  h += ipCell('ip-rig-optimize', 'Optimiser les GameObjects', !!p.optimizeGameObjects,
        'Coché : les os ne deviennent PAS des objets de scène — la hiérarchie ne montre que les '
        + 'maillages et les transforms listés ci-dessous. « Optimize Game Objects » d\'Unity.')
    + (p.optimizeGameObjects
      ? '<div class="field" title="Noms d\'os séparés par des virgules — « Extra Transforms to '
        + 'Expose » d\'Unity. Utile pour accrocher une arme à la main.">'
        + '<label>Transforms exposés</label><input type="text" id="ip-rig-extra" value="'
        + escapeHtml((p.extraTransforms || []).join(', ')) + '"></div>' : '');
  if(p.animationType === 'generic'){
    return h + '<div class="ip-note">Les os sont reconnus par leur nom, à la normalisation près '
      + '(<code>mixamorig:Hips</code>, <code>Hips</code> et <code>hips</code> sont le même os). '
      + 'Passez en <b>humanoïde</b> si vous voulez poser une animation venue d\'un rig qui ne '
      + 'nomme pas ses os pareil.</div>';
  }

  // « Avatar Definition » d'Unity : créé depuis ce modèle, ou COPIÉ d'un autre — le cas d'un
  // fichier d'animation seule, qui doit parler avec le même Avatar que le personnage.
  const others = assets.filter(function(x){ return x.kind === 'model' && x !== a && x.avatar; });
  h += ipSelect('ip-avatar-def', 'Définition de l\'Avatar', [['create', 'Créer depuis ce modèle'],
        ['copy', 'Copier d\'un autre modèle']], p.avatarDefinition || 'create',
        '« Avatar Definition » d\'Unity.');
  if(p.avatarDefinition === 'copy'){
    h += ipSelect('ip-avatar-source', 'Modèle source', [['', '— choisir —']].concat(
          others.map(function(x){ return [x.id, x.name]; })), p.avatarSource || '',
          'Le modèle dont l\'Avatar est recopié. Les os doivent porter les mêmes noms.');
  }
  const avatar = a.avatar;
  const mapping = (avatar && avatar.mapping) || {};
  const mapped = HUMANOID_BONES.filter(function(s){ return mapping[s.slot]; }).length;
  const problems = avatar ? validateAvatar(avatar) : ['Aucun Avatar : rien n\'est encore mappé.'];
  h += ipInfo('Avatar', avatar ? ('créé depuis ce modèle — ' + mapped + ' / '
        + HUMANOID_BONES.length + ' emplacements') : '— appliquez pour le détecter');
  if(problems.length){
    h += '<div class="ip-note" style="color:#ffb3b8">' + problems.map(escapeHtml).join('<br>')
      + '</div>';
  } else {
    h += '<div class="ip-note">Les quinze emplacements requis sont mappés : ce modèle peut '
      + 'recevoir l\'animation de n\'importe quel autre Avatar.</div>';
  }
  h += '<div class="field"><label></label>'
    + '<button class="btn-modal accent" id="ip-avatar-config"' + (avatar ? '' : ' disabled')
    + '>🦴 Configurer l\'Avatar…</button></div>'
    + '<div class="field"><label></label>'
    + '<button class="btn-modal" id="ip-avatar-detect">↻ Redétecter</button></div>'
    + '<div class="ip-note">Repasser en « générique » ou « aucune » <b>efface</b> l\'Avatar, '
    + 'corrections à la main comprises.</div>';
  return h;
}

/** La fenêtre de correspondance : un emplacement humanoïde, un os. */
// Les emplacements groupés comme Unity les présente : on ne cherche pas « LeftLowerArm » dans une
// liste de vingt-deux lignes, on cherche « le bras gauche » puis on descend.
export const GROUPS_AVATAR = [
  {title: 'Tronc', slots: ['Hips', 'Spine', 'Chest', 'UpperChest', 'Neck', 'Head']},
  {title: 'Bras gauche', slots: ['LeftShoulder', 'LeftUpperArm', 'LeftLowerArm', 'LeftHand']},
  {title: 'Bras droit', slots: ['RightShoulder', 'RightUpperArm', 'RightLowerArm', 'RightHand']},
  {title: 'Jambe gauche', slots: ['LeftUpperLeg', 'LeftLowerLeg', 'LeftFoot', 'LeftToes']},
  {title: 'Jambe droite', slots: ['RightUpperLeg', 'RightLowerLeg', 'RightFoot', 'RightToes']}
];

// Le nom français de chaque emplacement : c'est de l'interface, elle reste en français.
export const LABELS_AVATAR = {
  Hips:'Bassin', Spine:'Colonne', Chest:'Torse', UpperChest:'Haut du torse', Neck:'Cou', Head:'Tête',
  LeftShoulder:'Clavicule', LeftUpperArm:'Bras', LeftLowerArm:'Avant-bras', LeftHand:'Main',
  RightShoulder:'Clavicule', RightUpperArm:'Bras', RightLowerArm:'Avant-bras', RightHand:'Main',
  LeftUpperLeg:'Cuisse', LeftLowerLeg:'Jambe', LeftFoot:'Pied', LeftToes:'Orteils',
  RightUpperLeg:'Cuisse', RightLowerLeg:'Jambe', RightFoot:'Pied', RightToes:'Orteils'
};

// Position de chaque emplacement sur la silhouette, en pourcentage de la boîte. Le personnage est
// vu DE FACE : sa gauche est donc à droite de l'image, comme dans Unity.
export const POINTS_AVATAR = {
  Hips:[50,52], Spine:[50,44], Chest:[50,37], UpperChest:[50,31], Neck:[50,25], Head:[50,16],
  LeftShoulder:[60,29], LeftUpperArm:[66,32], LeftLowerArm:[74,42], LeftHand:[80,52],
  RightShoulder:[40,29], RightUpperArm:[34,32], RightLowerArm:[26,42], RightHand:[20,52],
  LeftUpperLeg:[57,58], LeftLowerLeg:[58,72], LeftFoot:[58,88], LeftToes:[60,94],
  RightUpperLeg:[43,58], RightLowerLeg:[42,72], RightFoot:[42,88], RightToes:[40,94]
};

/** L'état d'un emplacement : mappé, requis manquant, ou optionnel vide. */
export function stateSlotAvatar(slot, required, mapping){
  if(mapping[slot]) return 'ok';
  return required ? 'missing' : 'empty';
}

/** La silhouette et ses pastilles — vert mappé, rouge requis manquant, creux optionnel vide. */
export function silhouetteAvatarHtml(mapping){
  // Les couleurs viennent des tokens du thème (css/tokens.css), jamais écrites en dur : c'est
  // la règle que `test/tokens-css.test.mjs` tient, et un SVG engendré n'y échappe pas.
  const COLORS = {ok:'var(--ok)', missing:'var(--invalid)', empty:'none'};
  let pts = '';
  HUMANOID_BONES.forEach(function(b){
    const p = POINTS_AVATAR[b.slot];
    if(!p) return;
    const state = stateSlotAvatar(b.slot, b.required, mapping);
    pts += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="2.6" fill="' + COLORS[state]
      + '" stroke="' + (state === 'empty' ? 'var(--edge-strong)' : COLORS[state]) + '" stroke-width="0.8"'
      + (state === 'empty' ? ' stroke-dasharray="1.2 1.2"' : '')
      + '><title>' + b.slot + '</title></circle>';
  });
  // Un corps schématique : deux traits pour la colonne, quatre pour les membres. Il n'a pas à
  // être beau, il a à dire d'un coup d'œil ce qui manque et où.
  return '<svg class="avatar-body" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" '
    + 'aria-label="Silhouette humanoïde">'
    + '<g stroke="var(--edge-strong)" stroke-width="1.2" fill="none" stroke-linecap="round">'
    + '<path d="M50 22 L50 52"/>'
    + '<path d="M40 29 L50 27 L60 29"/>'
    + '<path d="M60 29 L66 32 L74 42 L80 52"/>'
    + '<path d="M40 29 L34 32 L26 42 L20 52"/>'
    + '<path d="M50 52 L57 58 L58 72 L58 88 L60 94"/>'
    + '<path d="M50 52 L43 58 L42 72 L42 88 L40 94"/>'
    + '<circle cx="50" cy="16" r="6"/>'
    + '</g>' + pts + '</svg>';
}

/**
 * La fenêtre de correspondance : chaque emplacement du corps humain désigne un os.
 *
 * Elle est GROUPÉE par membre et montre l'état de chaque emplacement, parce que la question qu'on
 * se pose devant elle n'est jamais « que vaut LeftLowerArm » mais « qu'est-ce qui manque ».
 */
export function modalAvatarConfig(a){
  if(typeof openModal !== 'function' || !a.avatar) return;
  const bones = bonesOfModel(a);
  const doubles = a.template ? countBonesDuplicated(a.template) : 0;
  const mapping = a.avatar.mapping || (a.avatar.mapping = {});
  const required = {};
  HUMANOID_BONES.forEach(function(b){ required[b.slot] = b.required; });
  const manquants = HUMANOID_BONES.filter(function(b){ return b.required && !mapping[b.slot]; });
  const mapped = HUMANOID_BONES.filter(function(b){ return mapping[b.slot]; }).length;

  /**
   * Les options d'un emplacement. Un os MANQUANT (mapping hérité d'un fichier réimporté sans
   * lui) reste affiché et sélectionné, marqué comme absent : le faire disparaître de la liste
   * ferait afficher le premier os venu à sa place, et la correspondance mentirait en silence.
   */
  const optionsFor = function(chosen){
    let o = '<option value=""' + (chosen ? '' : ' selected') + '>— aucun —</option>';
    let vu = false;
    bones.forEach(function(b){
      if(b.name === chosen) vu = true;
      o += '<option value="' + escapeHtml(b.name) + '"'
        + (b.name === chosen ? ' selected' : '') + '>' + escapeHtml(b.name) + '</option>';
    });
    if(chosen && !vu){
      o += '<option value="' + escapeHtml(chosen) + '" selected>' + escapeHtml(chosen)
        + ' — absent du squelette</option>';
    }
    return o;
  };

  let h = '<div class="avatar-head">'
    + silhouetteAvatarHtml(mapping)
    + '<div class="avatar-summary">'
    + '<div class="avatar-count"><b>' + mapped + '</b> / ' + HUMANOID_BONES.length
    + ' emplacements</div>'
    + (manquants.length
      ? '<div class="avatar-alert">' + manquants.length + ' emplacement(s) <b>requis</b> '
        + 'manquant(s) :<br>' + manquants.map(function(b){
            return escapeHtml(LABELS_AVATAR[b.slot] + ' ' + sideOfSlotLabel(b.slot)); }).join(', ')
        + '</div>'
      : '<div class="avatar-ok">Avatar exploitable : les quinze emplacements requis sont '
        + 'désignés.</div>')
    + '<div class="ip-note">' + bones.length + ' os distincts'
    + (doubles ? ' — le fichier en répète <b>' + doubles + '</b>, ignorés ici : three n\'adresse '
        + 'jamais que le premier de chaque nom.' : '.') + '</div>'
    + '<div class="field" style="margin-top:8px"><label></label>'
    + '<button class="btn-modal" id="avatar-auto">↻ Redétecter</button> '
    + '<button class="btn-modal" id="avatar-clear">✕ Tout effacer</button></div>'
    + '</div></div>';

  h += '<div class="avatar-map">';
  GROUPS_AVATAR.forEach(function(g){
    h += '<div class="sec">' + g.title + '</div>';
    g.slots.forEach(function(slot){
      const chosen = mapping[slot] || '';
      const state = stateSlotAvatar(slot, required[slot], mapping);
      h += '<div class="field avatar-line ' + state + '">'
        + '<label><span class="avatar-dot"></span>' + LABELS_AVATAR[slot]
        + (required[slot] ? ' *' : '') + '</label>'
        + '<select data-slot-avatar="' + slot + '">' + optionsFor(chosen) + '</select></div>';
    });
  });
  h += '</div>'
    + '<div class="ip-note">* requis. Les autres emplacements améliorent le report du geste sans '
    + 'être nécessaires : un rig sans clavicule ni orteils reste un Avatar valable.</div>'
    + '<div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end">'
    + '<button class="btn-modal accent" id="avatar-close">Fermer</button></div>';

  openModal('Avatar humanoïde — ' + a.name, h);

  const body = document.getElementById('modal-body');
  body.addEventListener('change', function(e){
    const slot = e.target.dataset && e.target.dataset.slotAvatar;
    if(!slot) return;
    if(e.target.value) mapping[slot] = e.target.value;
    else delete mapping[slot];
    // L'Avatar n'est PAS un paramètre d'import : il vit sur l'asset et se sérialise à part.
    // Il n'entre donc pas dans le brouillon, et se corrige sans passer par « Appliquer ».
    modalAvatarConfig(a);
    buildInspectorAsset(a);
  });
  document.getElementById('avatar-auto').onclick = function(){
    pushHistory();
    a.avatar = autoMapAvatar(a.template);
    modalAvatarConfig(a);
    buildInspectorAsset(a);
  };
  document.getElementById('avatar-clear').onclick = function(){
    pushHistory();
    a.avatar = {mapping: {}, missing: HUMANOID_BONES.filter(function(b){ return b.required; })
      .map(function(b){ return b.slot; })};
    modalAvatarConfig(a);
    buildInspectorAsset(a);
  };
  document.getElementById('avatar-close').onclick = function(){
    if(typeof closeModal === 'function') closeModal();
  };
}

/** « gauche » / « droit » pour un libellé lisible ; rien pour le tronc. */
export function sideOfSlotLabel(slot){
  if(slot.indexOf('Left') === 0) return 'gauche';
  if(slot.indexOf('Right') === 0) return 'droit';
  return '';
}


// ---------- Ce que le fichier CONTIENT, en lecture seule ----------
//
// Unity laisse déplier un FBX dans la fenêtre Project : maillages, matériaux, clips, Avatar. On
// n'y règle RIEN, on regarde — les paramètres, eux, restent sur le fichier. C'est la même
// séparation ici : `a._sub` ({kind, index}) est une VUE, pas un réglage, et il ne se sérialise pas.

/**
 * Ce qu'un modèle importé contient, dans l'ordre où le panneau Projet le déplie.
 * Rend `[{kind, index, name, icon}]` — `kind` vaut mesh | material | animation | skeleton.
 */
export function subAssetsOfModel(a){
  const list = [];
  if(!a || a.kind !== 'model' || !a.template) return list;
  meshesModel(a.template).forEach(function(m, i){
    list.push({kind:'mesh', index:i, name:nameMeshOfModel(m, i), icon:'◳'});
  });
  slotsMaterialsModel(a).forEach(function(s, i){
    list.push({kind:'material', index:i, name:s.name, icon:'◍'});
  });
  // Les CLIPS réglés (onglet Animation), pas les prises brutes : c'est ce que le fichier expose,
  // comme dans Unity. Chacun porte l'id de l'asset qui le représente, pour être glissé tel quel
  // sur un état de l'Animator.
  const p = a.paramsImport || {};
  const clips = (p.importAnimation === false) ? []
    : (Array.isArray(p.clips) ? p.clips
      : (a.template.animations || []).map(function(c){ return {name: c.name, take: c.name}; }));
  clips.forEach(function(c, i){
    list.push({kind:'animation', index:i, name:c.name || c.take || ('Clip ' + (i + 1)), icon:'🎞',
               clipId: c.id || null});
  });
  if(a.avatar) list.push({kind:'avatar', index:0, name:'Avatar', icon:'🧍'});
  if(bonesOfModel(a).length) list.push({kind:'skeleton', index:0, name:'Squelette', icon:'🦴'});
  return list;
}

/** La vue en lecture seule du sous-asset sélectionné. */
export function sectionSubAssetHtml(a){
  const sub = a._sub || {};
  if(sub.kind === 'material') return sectionMaterialFileHtml(a, sub.index);
  if(sub.kind === 'animation') return sectionClipFileHtml(a, sub.index);
  if(sub.kind === 'skeleton') return sectionSkeletonHtml(a);
  if(sub.kind === 'avatar') return sectionAvatarSubHtml(a);
  return sectionMeshHtml(a);
}

/** Un matériau du FICHIER : ce qu'il déclare, et par quoi il est remplacé dans le projet. */
export function sectionMaterialFileHtml(a, index){
  const slots = slotsMaterialsModel(a);
  const s = slots[index];
  if(!s) return '<div class="ip-note">Ce matériau n\'existe plus.</div>';
  // le matériau three tel que le chargeur l'a fabriqué, pour en lire les valeurs
  let raw = null;
  (a.matBruts || []).forEach(function(bruts){
    (bruts || []).forEach(function(mb, k){ if(!raw && nameSlotMat(mb, k) === s.name) raw = mb; });
  });
  const p = ensureParamsImport(a);
  const remplace = materialAssetById(p.materials && p.materials[s.name]);
  const maps = raw ? KEYS_MAP_THREE.filter(function(k){ return raw[k]; }) : [];

  let h = '<div class="sec">Matériau du fichier — lecture seule</div>'
    + '<div class="ip-note">Les paramètres d\'import sont sur le fichier : cliquez sa vignette pour '
    + 'y revenir. Pour <b>modifier</b> ce matériau, extrayez-le (onglet Matériaux) — un matériau '
    + 'du projet est alors créé, et c\'est lui qui devient modifiable.</div>'
    + ipInfo('Nom', s.name)
    + ipInfo('Type', s.type)
    + ipInfo('Maillages', s.n + ' dans ce fichier')
    + ipInfo('Remplacé par', remplace ? remplace.name : '— du fichier —');
  if(raw){
    if(raw.color) h += ipInfo('Couleur', '#' + raw.color.getHexString());
    if(raw.emissive) h += ipInfo('Émissif', '#' + raw.emissive.getHexString());
    if(raw.opacity !== undefined) h += ipInfo('Opacité', raw.opacity.toFixed(2));
    if(raw.roughness !== undefined) h += ipInfo('Rugosité', raw.roughness.toFixed(2));
    if(raw.metalness !== undefined) h += ipInfo('Métal', raw.metalness.toFixed(2));
    h += ipInfo('Double face', (raw.side === THREE.DoubleSide) ? 'oui' : 'non')
      + ipInfo('Textures', maps.length ? maps.join(', ') : 'aucune');
  }
  // Un matériau que le chargeur n'a pas su traduire : l'éditeur est PBR, Phong n'a ni rugosité
  // ni métal, et rien ne le dirait ailleurs qu'en console.
  if(s.type === 'MeshPhongMaterial' || s.type === 'MeshLambertMaterial'){
    h += '<div class="ip-note">⚠ Le chargeur FBX ne sait fabriquer que du Phong et du Lambert : '
      + 'un matériau <b>OpenPBR, Arnold ou Standard Surface</b> arrive ici sans sa rugosité ni '
      + 'son métal. L\'extraction en fabrique un matériau PBR propre et rebranche les textures '
      + 'trouvées à côté du modèle.</div>';
  }
  return h;
}

/** L'Avatar du fichier, en lecture seule : il se règle dans l'onglet Rig. */
export function sectionAvatarSubHtml(a){
  const mapping = (a.avatar && a.avatar.mapping) || {};
  const mapped = HUMANOID_BONES.filter(function(b){ return mapping[b.slot]; }).length;
  const problems = a.avatar ? validateAvatar(a.avatar) : [];
  return '<div class="sec">Avatar — lecture seule</div>'
    + '<div class="ip-note">L\'Avatar se crée, se copie et se corrige dans l\'onglet <b>Rig</b> '
    + 'du fichier.</div>'
    + ipInfo('Emplacements', mapped + ' / ' + HUMANOID_BONES.length)
    + (problems.length ? '<div class="ip-note" style="color:#ffb3b8">'
        + problems.map(escapeHtml).join('<br>') + '</div>'
      : '<div class="ip-note">Complet : ce modèle peut recevoir l\'animation de n\'importe quel '
        + 'autre Avatar.</div>');
}

/**
 * « Search and Remap » : chaque emplacement reçoit, dans le BROUILLON, le matériau du projet qui
 * porte son nom. `scope` : `local` (le dossier du modèle) ou `project`. Rend le nombre remappé.
 */
export function searchAndRemapMaterials(a, scope){
  const p = ensureDraft(a);
  if(!p.materials) p.materials = {};
  const pool = assets.filter(function(x){
    return x.kind === 'material' && (scope === 'project' || (x.folder || '') === (a.folder || ''));
  });
  let n = 0;
  slotsMaterialsModel(a).forEach(function(s){
    const found = pool.find(function(m){ return m.name === s.name; })
      || pool.find(function(m){ return m.name.toLowerCase() === s.name.toLowerCase(); });
    if(found && p.materials[s.name] !== found.id){ p.materials[s.name] = found.id; n++; }
  });
  return n;
}

/**
 * « Extract Textures » : les textures EMBARQUÉES dans le fichier deviennent des assets texture du
 * dossier du modèle (et des fichiers sur le disque, en mode dossier). Une texture déjà extraite —
 * même nom dans le même dossier — n'est pas refaite.
 */
export async function extractTexturesModel(a){
  const seen = new Set();
  const list = [];
  (a.matBruts || []).forEach(function(bruts){
    (bruts || []).forEach(function(mb){
      if(!mb) return;
      ['map', 'normalMap', 'emissiveMap', 'aoMap', 'alphaMap', 'bumpMap', 'specularMap',
       'roughnessMap', 'metalnessMap'].forEach(function(k){
        const t = mb[k];
        if(!t || !t.image || seen.has(t)) return;
        seen.add(t);
        list.push({tex: t, role: k});
      });
    });
  });
  let n = 0;
  for(const e of list){
    const img = e.tex.image;
    const w = img.width || img.naturalWidth, h = img.height || img.naturalHeight;
    if(!(w > 0 && h > 0)) continue;
    const base = (e.tex.name || (a.name + '-' + e.role)).replace(/\.[a-z0-9]+$/i, '')
      .replace(/[\\/:*?"<>|]/g, '-');
    const name = base + '.png';
    if(assets.some(function(x){ return x.kind === 'texture' && x.name === name
        && (x.folder || '') === (a.folder || ''); })) continue;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0);
    const blob = await new Promise(function(res){ canvas.toBlob(res, 'image/png'); });
    if(!blob) continue;
    const before = folderCurrent;
    setFolderCurrent(a.folder || '');
    try {
      createAssetTexture(new File([blob], name, {type: 'image/png'}), {name: name,
        paramsImport: {type: e.role === 'normalMap' ? 'normal' : (e.role === 'map' || e.role === 'emissiveMap') ? 'color' : 'data'}});
    } finally { setFolderCurrent(before); }
    n++;
  }
  return n;
}

/** Un clip du fichier : sa découpe et sa prise. Ses réglages vivent dans l'onglet Animation. */
export function sectionClipFileHtml(a, index){
  const p = a.paramsImport || {};
  const c = Array.isArray(p.clips) ? p.clips[index] : null;
  const clip = c ? takeOfModel(a, c.take) : (a.template.animations || [])[index];
  if(!clip) return '<div class="ip-note">Ce clip n\'existe plus.</div>';
  const os = {};
  (clip.tracks || []).forEach(function(t){
    const i = t.name.indexOf('.');
    os[i === -1 ? t.name : t.name.slice(0, i)] = true;
  });
  const names = Object.keys(os);
  const asset = assets.find(function(x){
    return x.kind === 'animation' && x.source && x.source.asset === a.id && x.source.clip === clip.name;
  });
  const d = clip.duration;
  const end = c && c.end !== null && c.end !== undefined ? c.end : d;
  return '<div class="sec">Clip du fichier — lecture seule</div>'
    + '<div class="ip-note">Découpe, boucle, root motion, miroir, masque et événements se règlent '
    + 'dans l\'onglet <b>Animation</b> du fichier. Glissez ce clip sur un état de l\'Animator pour '
    + 'le lui affecter.</div>'
    + '<div class="field"><label></label><button class="btn-modal accent" id="ip-goto-anim" '
    + 'data-clip="' + index + '">🎞 Régler dans l\'onglet Animation</button></div>'
    + ipInfo('Nom', c ? (c.name || c.take) : clip.name)
    + ipInfo('Prise', clip.name)
    + (c ? ipInfo('Découpe', (Number(c.start) || 0).toFixed(2) + ' → ' + Number(end).toFixed(2) + ' s')
         + ipInfo('Boucle', c.loop !== false ? 'oui' : 'non') : '')
    + ipInfo('Durée', clip.duration.toFixed(2) + ' s')
    + ipInfo('Pistes', (clip.tracks || []).length)
    + ipInfo('Cibles', names.length + ' os / nœuds')
    + ipInfo('Asset d\'animation', asset ? asset.name : '— aucun (créez-en un pour l\'utiliser) —')
    + (names.length
      ? '<div class="ip-note">' + names.slice(0, 12).map(escapeHtml).join(', ')
        + (names.length > 12 ? ' … (+' + (names.length - 12) + ')' : '') + '</div>' : '');
}

/** Le squelette : ce que le fichier porte, et ce que l'Avatar en a fait. */
export function sectionSkeletonHtml(a){
  const bones = bonesOfModel(a);
  const doubles = a.template ? countBonesDuplicated(a.template) : 0;
  const mapping = (a.avatar && a.avatar.mapping) || {};
  const mapped = HUMANOID_BONES.filter(function(b){ return mapping[b.slot]; }).length;
  const roots = bones.filter(function(b){ return !b.parent || !b.parent.isBone; });
  return '<div class="sec">Squelette — lecture seule</div>'
    + '<div class="ip-note">Le type d\'animation et l\'Avatar se règlent dans l\'onglet '
    + '<b>Rig</b> du fichier.</div>'
    + ipInfo('Os distincts', bones.length)
    + ipInfo('Répétitions', doubles
        ? (doubles + ' — le fichier rapporte le squelette une fois par maillage skinné')
        : 'aucune')
    + ipInfo('Racine(s)', roots.map(function(b){ return b.name; }).join(', ') || '—')
    + ipInfo('Avatar', a.avatar ? (mapped + ' / ' + HUMANOID_BONES.length + ' emplacements')
        : 'aucun')
    + '<div class="ip-note">' + bones.slice(0, 16).map(function(b){ return escapeHtml(b.name); })
        .join(', ') + (bones.length > 16 ? ' … (+' + (bones.length - 16) + ')' : '') + '</div>';
}

export function nameMeshOfModel(mesh, i){
  return (mesh && mesh.name) ? mesh.name : ('Maillage ' + (i + 1));
}

export const FORMATS_ATTRIBUTE = {
  position:'Position', normal:'Normale', tangent:'Tangente', uv:'UV0', uv1:'UV1',
  uv2:'UV2', color:'Couleur de sommet', skinIndex:'Index d\'os', skinWeight:'Poids d\'os'
};

export function sectionMeshHtml(a){
  const meshes = meshesModel(a.template);
  const i = Math.max(0, Math.min(meshes.length - 1, (a._sub && a._sub.index) | 0));
  const mesh = meshes[i];
  if(!mesh) return '<div class="ip-note">Ce maillage n\'existe plus.</div>';
  const geo = mesh.geometry;
  const nVertices = geo.attributes.position ? geo.attributes.position.count : 0;
  const nIndices = geo.index ? geo.index.count : nVertices;
  const box = geo.boundingBox || (geo.computeBoundingBox(), geo.boundingBox);
  const size = box ? box.getSize(new THREE.Vector3()) : new THREE.Vector3();
  const center = box ? box.getCenter(new THREE.Vector3()) : new THREE.Vector3();
  const trois = function(v){ return v.toArray().map(function(x){ return x.toFixed(3); }).join(' · '); };

  let h = '<div class="sec">Maillage — lecture seule</div>'
    + '<div class="ip-note">Les paramètres d\'import sont sur le fichier : cliquez la vignette du '
    + 'modèle pour y revenir.</div>'
    + ipInfo('Nom', nameMeshOfModel(mesh, i))
    + ipInfo('Sommets', nVertices.toLocaleString('fr-FR'))
    + ipInfo('Triangles', Math.floor(nIndices / 3).toLocaleString('fr-FR'))
    + ipInfo('Index', geo.index ? (geo.index.array.constructor.name + ' — ' + nIndices) : 'aucun (soupe de triangles)')
    + ipInfo('Groupes', (geo.groups && geo.groups.length ? geo.groups.length : 1)
        + ' (un par matériau)')
    + ipInfo('Type', mesh.isSkinnedMesh ? 'maillage skinné' : 'maillage statique');

  h += '<div class="sec">Attributs</div>';
  const lines = Object.keys(geo.attributes).map(function(name){
    const at = geo.attributes[name];
    const octets = at.array.BYTES_PER_ELEMENT * at.itemSize;
    return '<div class="ip-line"><b>' + escapeHtml(FORMATS_ATTRIBUTE[name] || name) + '</b>'
      + '<span>' + at.array.constructor.name.replace('Array', '') + ' × ' + at.itemSize
      + ' (' + octets + ' o)</span></div>';
  });
  const morphs = Object.keys(geo.morphAttributes || {});
  if(morphs.length) lines.push('<div class="ip-line"><b>Formes de mélange</b><span>'
    + geo.morphAttributes[morphs[0]].length + '</span></div>');
  h += '<div class="ip-list">' + lines.join('') + '</div>'
    + (geo.attributes.color ? '' : '<div class="ip-note">Pas de couleur de sommet dans ce '
      + 'maillage.</div>');

  h += '<div class="sec">Boîte englobante</div>'
    + ipInfo('Centre', trois(center))
    + ipInfo('Taille', trois(size));

  return h + sectionPreviewModelHtml(a, mesh);
}

/**
 * Les boutons d'application, en bas et toujours au même endroit — comme Revert / Apply d'Unity.
 * Réservés aux genres qui ont des paramètres d'import : un matériau ou une animation s'éditent
 * au fil de l'eau, l'inspecteur EST leur éditeur.
 */
export function sectionApplyHtml(a){
  if(!IMPORT_DEFAULT[a.kind]) return '';
  const dirty = importDirty(a);
  return '<div class="sec">Application</div>'
    + (dirty
      ? '<div class="ip-note" style="color:#ffd479">⚠ Réglages modifiés, <b>pas encore '
        + 'appliqués</b>.</div>'
      : '<div class="ip-note">Tout est appliqué.</div>')
    + '<div class="field" style="margin-top:6px"><label></label>'
    + '<button class="btn-insp accent" id="ip-apply"' + (dirty ? '' : ' disabled')
    + ' title="Applique les réglages à l\'asset et à toutes ses instances">'
    + '💾 Appliquer</button></div>'
    + '<div class="field"><label></label>'
    + '<button class="btn-modal" id="ip-revert"' + (dirty ? '' : ' disabled')
    + ' title="Revenir aux valeurs appliquées la dernière fois">↩ Abandonner</button> '
    + '<button class="btn-modal" id="ip-reset" title="Revenir aux valeurs d\'import par défaut">'
    + '↺ Par défaut</button></div>';
}

/** L'onglet Matériaux : un emplacement par matériau du fichier, plus l'extraction. */
export function sectionMaterialsModelHtml(a, p){
  let h = '<div class="sec">Création</div>'
    + ipSelect('ip-mat-creation', 'Mode de création', [['import', 'Importer (du fichier)'],
        ['standard', 'Standard (PBR refait)'], ['none', 'Aucun (matériau par défaut)']],
        p.materialCreation || 'import',
        '« Material Creation Mode » d\'Unity. Standard refait un matériau PBR à partir de ce que le '
        + 'fichier déclare : le chargeur FBX ne fabrique que du Phong et du Lambert, sans rugosité '
        + 'ni métal. Aucun pose un matériau gris sur chaque emplacement.')
    + ipCell('ip-mat-srgb', 'Couleurs d\'albédo sRGB', p.srgbAlbedo !== false,
        'Coché : la couleur du fichier est lue comme une couleur d\'écran (sRGB). Décoché : elle est '
        + 'lue comme linéaire — « sRGB Albedo Colors » d\'Unity.')
    + ipSelect('ip-mat-location', 'Emplacement', [['embedded', 'Matériaux du fichier'],
        ['external', 'Matériaux externes (extraits à l\'application)']], p.materialLocation || 'embedded',
        '« Location » d\'Unity. Externes : à chaque « Appliquer », un matériau du projet est créé '
        + 'pour chaque emplacement qui n\'en a pas encore, et c\'est lui que le modèle porte.');
  // un emplacement par matériau du fichier (un FBX en a souvent plusieurs)
  const slots = slotsMaterialsModel(a);
  const mats = assets.filter(function(x){ return x.kind === 'material'; });
  h += '<div class="sec">Matériaux — ' + slots.length + ' emplacement'
    + (slots.length > 1 ? 's' : '') + '</div>';
  if(!slots.length){
    h += '<div class="ip-note">Ce fichier ne déclare aucun matériau.</div>';
  } else {
    if(!mats.length)
      h += '<div class="ip-note">Aucun matériau dans le projet : créez-en un avec '
        + '<b>🎨 Nouveau matériau</b> pour pouvoir l\'affecter ici.</div>';
    slots.forEach(function(s, i){
      const chosen = materialAssetById(p.materials && p.materials[s.name]);
      let opts = '<option value="">— du fichier —</option>';
      mats.forEach(function(m){
        opts += '<option value="' + m.id + '"' + (chosen && chosen.id === m.id ? ' selected' : '')
          + '>' + escapeHtml(m.name) + '</option>';
      });
      h += '<div class="field ip-slot" title="'
        + escapeHtml(s.name + ' — ' + s.n + ' maillage(s) · ' + s.type) + '">'
        + '<label>' + escapeHtml(s.name) + '</label>'
        + '<select id="ip-mat-' + i + '" data-slot="' + escapeHtml(s.name) + '"'
        + (mats.length ? '' : ' disabled') + '>' + opts + '</select></div>';
    });
    h += '<div class="ip-note">« du fichier » garde le matériau importé. Le choix vaut '
      + 'pour toutes les instances du modèle, et suit les modifications du matériau.</div>';

    // « Search and Remap » d'Unity : affecter à chaque emplacement le matériau du projet qui porte
    // son nom — dans le dossier du modèle d'abord, ou dans tout le projet.
    h += '<div class="sec">Recherche</div>'
      + ipSelect('ip-mat-search', 'Chercher dans', [['local', 'Le dossier du modèle'],
          ['project', 'Tout le projet']], a._matSearch || 'local',
          'Où chercher un matériau du projet qui porte le nom de l\'emplacement.')
      + '<div class="field"><label></label><button class="btn-modal" id="ip-mat-remap">'
      + '🔎 Rechercher et remapper</button></div>';

    // Extraction (équivalent d'« Extract Materials » d'Unity) : un matériau du projet
    // par emplacement, textures branchées d'après leur nom. Voir material-extraction.js.
    const nTex = texturesOfFolder(a, namingCurrent()).length;
    h += '<div class="sec">Extraction des matériaux</div>'
      + ipInfo('Textures', nTex + ' reconnue(s) à côté du modèle')
      + '<button class="btn-insp accent" id="ip-extract" title="Crée un matériau du projet '
      + 'par emplacement et y branche les textures trouvées à côté du modèle.">'
      + '🎨 Extraire les matériaux</button> '
      + '<button class="btn-insp" id="ip-extract-tex" title="Écrit dans le dossier du modèle les '
      + 'textures EMBARQUÉES dans le fichier, comme assets texture — « Extract Textures » d\'Unity.">'
      + '🖼 Extraire les textures</button>'
      + '<div class="ip-note">Les textures sont cherchées <b>uniquement à côté de ce '
      + 'modèle</b> — fichiers arrivés avec lui à l\'import, et assets texture du même '
      + 'dossier de projet — et rapprochées par leur nom selon la convention réglée dans '
      + '<b>Édition → ⚙ Préférences</b>. Ré-extraire complète sans défaire : une map déjà '
      + 'branchée n\'est pas écrasée.</div>';
  }
  return h;
}

// ---------- Les caches de l'aperçu ----------
//
// L'aperçu 3D et la planche d'UV étaient RECALCULÉS à chaque reconstruction du panneau : changer
// d'onglet, tourner la vue, cocher une case qui refait la mise en page. Un aperçu, c'est un clone
// complet du modèle, une boîte englobante (que three recalcule sommet par sommet, os appliqués,
// sur un maillage skinné — et le clone n'a jamais la sienne en cache), un rendu sur le second
// contexte WebGL et un encodage PNG synchrone ; une planche d'UV, c'est TOUS les triangles du
// modèle tracés dans un canvas. C'était la lenteur de chaque clic.
//
// Rien de ce qu'ils montrent ne change sans « Appliquer » (applyImportModel) ou sans un changement
// de matériau (applyMaterialsModel) : ce sont les deux seuls endroits qui les oublient.
export function forgetPreviewsModel(a){
  if(!a) return;
  a._previews = null;
  a._uvPlates = null;
}

function keyPreviewTarget(a, target){
  return (!target || target === a.template) ? 'root' : target.uuid;
}

/** L'aperçu rendu de `target` sous `angle`, calculé une seule fois tant que rien n'est appliqué. */
export function previewModelCached(a, target, angle){
  if(!target) return a.preview || '';
  if(!a._previews) a._previews = new Map();
  const key = keyPreviewTarget(a, target) + '@' + angle;
  let url = a._previews.get(key);
  if(url === undefined){
    url = previewObject3D(target, {size:256, angle:angle});
    a._previews.set(key, url);
  }
  return url;
}

/** Le bloc « Aperçu » : le modèle rendu en grand, et ses jeux d'UV. */
export function sectionPreviewModelHtml(a, mesh){
  const sets = uvSetsOfModel(a, mesh);
  const shown = (a._uvSet && sets.indexOf(a._uvSet) !== -1) ? a._uvSet : (sets[0] || '');
  a._uvSet = shown;
  const angle = a._previewAngle || 0;
  const target = mesh || a.template;
  const url = previewModelCached(a, target, angle);
  return '<div class="sec">Aperçu</div>'
    + '<div class="ip-preview"><img id="ip-preview-img" src="' + url + '" alt=""></div>'
    + '<div class="field"><label>Vue</label>'
    + '<button class="btn-mini" id="ip-preview-left" title="Tourner à gauche">◀</button> '
    + '<span id="ip-preview-angle">' + angle + '°</span> '
    + '<button class="btn-mini" id="ip-preview-right" title="Tourner à droite">▶</button></div>'
    + (sets.length
      ? ipSelect('ip-uvset', 'Jeu d\'UV', sets.map(function(n){
          return [n, n === 'uv' ? 'uv (texture)' : (n === 'uv1' ? 'uv1 (lightmap)' : n)]; }), shown,
          'uv sert les textures, uv1 la lightmap. Un dépliage correct tient dans le carré et '
          + 'ne se recouvre pas.')
        + '<div class="ip-preview"><canvas id="ip-uv" width="240" height="240"></canvas></div>'
        + '<div class="ip-note" id="ip-uv-note"></div>'
      : '<div class="ip-note">Ce modèle n\'a aucun jeu d\'UV : ni texture ni lightmap ne '
        + 'peuvent s\'y plaquer.</div>');
}

/** Ce que le repli a retiré à ce modèle — vide si la hiérarchie est conservée. */
export function repliedNodes(a){
  const n = (a && a.template) ? collapsedCount(a.template) : 0;
  return n ? (n + ' nœud(s) vide(s)') : '';
}


// ---------- L'EN-TÊTE d'un asset : vignette, nom, chemin, presets ----------
//
// Le bandeau qu'Unity pose en haut de son Inspector, et qui remplace ici la ligne « Modèle 3D —
// asset du projet » suivie d'un champ « Nom » : deux lignes pleines pour ce que la vignette et
// le titre disent mieux. Le nom se renomme au DOUBLE-CLIC, comme dans la hiérarchie — un champ
// de saisie permanent invite à taper dedans par erreur, et rien n'annule un renommage
// accidentel d'asset.
//
// Ce qu'on n'a PAS repris d'Unity : « Ignored », « Add… » et « Check in » sont les commandes de
// son gestionnaire de version. L'éditeur n'en a pas.

export const ICONS_KIND = {model:'🧊', texture:'🖼', material:'🎨', audio:'🔊', script:'📜',
                    data:'🗂', documentUI:'📄', sheetStyle:'🎨', animator:'🔀', animation:'🎞',
                    graphShader:'🧩', tilePalette:'▦', sprite:'🖼', prefab:'📦',
                    postProfile:'🌈', preset:'🔖', sfx:'🎛', musicLoop:'🎹'};

/**
 * Le chemin du dossier de l'asset tel qu'on le LIT : celui du panneau Projet.
 *
 * Sans le préfixe `assets/`, qui est vrai sur le disque mais ne dit rien — tous les assets y
 * sont, il ne distingue donc aucun d'entre eux et ne fait que manger la largeur disponible sur
 * une arborescence déjà profonde.
 */
export function pathFolderAsset(a){
  return (a && a.folder) ? a.folder : '';
}

/**
 * Le même chemin, mais celui du DISQUE : `assets/<dossier>`.
 *
 * Le préfixe réapparaît ici et nulle part ailleurs, parce qu'un chemin qu'on copie pour le
 * coller dans un explorateur ou un terminal doit EXISTER (voir `writeAssetInFolder`,
 * js/project-folder.js : tout vit sous `assets/`).
 */
export function pathDiskAsset(a){
  const f = pathFolderAsset(a);
  return 'assets' + (f ? '/' + f : '');
}

/** Le nom du dossier du projet ouvert, ou à défaut le nom du projet. */
export function nameFolderProject(){
  return (project.handleFolder && project.handleFolder.name) || project.name || '';
}

/** La racine disque retenue pour ce projet, ou '' si on ne l'a jamais demandée. */
export function rootDiskProject(){
  const roots = Prefs.get('project.rootsDisk') || {};
  return roots[nameFolderProject() || 'projet'] || '';
}

export function setRootDiskProject(filePath){
  const roots = Object.assign({}, Prefs.get('project.rootsDisk') || {});
  roots[nameFolderProject() || 'projet'] = filePath;
  Prefs.set('project.rootsDisk', roots);
  return filePath;
}

/**
 * Le chemin complet du dossier de l'asset sur CE disque.
 *
 * Le navigateur ne le connaît pas : l'API File System Access ne donne jamais de chemin absolu,
 * par conception — on n'a que le NOM du dossier ouvert. La racine est donc demandée une fois
 * puis retenue par projet (préférence de machine). Rend `null` si elle est refusée : mieux vaut
 * ne rien copier qu'un chemin faux, qu'on collerait dans un terminal sans le relire.
 */
export function fullPathAsset(a){
  let root = rootDiskProject();
  if(!root){
    const typed = prompt('Où ce projet se trouve-t-il sur ce disque ?\n\n'
      + 'Le navigateur ne peut pas le savoir : l\'API des dossiers ne donne jamais de chemin '
      + 'absolu. Collez le chemin du dossier du projet — il sera retenu pour ce projet, sur '
      + 'cet ordinateur.', 'C:\\' + (nameFolderProject() || 'MonProjet'));
    if(typed === null) return null;
    root = setRootDiskProject(typed.trim().replace(/[\\/]+$/, ''));
  }
  if(!root) return null;
  return root + '\\' + pathDiskAsset(a).split('/').join('\\');
}

/**
 * Copie du texte dans le presse-papier.
 *
 * `navigator.clipboard` n'existe QUE dans un contexte sécurisé : l'éditeur ouvert en `file://`,
 * ou servi en http depuis une autre machine que localhost, ne l'a pas. D'où le repli sur un
 * textarea hors écran et `execCommand`, déprécié mais universel.
 */
export function copyToClipboard(text){
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(text).catch(function(){ copyFallback(text); });
    return;
  }
  copyFallback(text);
}

function copyFallback(text){
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch(e){ /* rien de plus à tenter */ }
  ta.remove();
}

/** Bascule le titre en champ de saisie. Le champ n'est visible que le temps du renommage. */
// La photographie des chemins disque, prise au DÉBUT d'un renommage et consommée à sa
// validation (le `focusout` du champ `ip-name`).
//
// POURQUOI PAS À CHAQUE FRAPPE : l'écouteur `input` de ce champ écrit `a.name` à chaque
// caractère. Y faire suivre le disque déplacerait le fichier lettre par lettre — autant
// d'écritures que de touches, et un dossier jonché d'états intermédiaires si la frappe est
// interrompue. On photographie une fois, on réconcilie une fois.
let snapshotRenameAsset = null;

export function startRenameAsset(a){
  const title = document.getElementById('ip-head-name');
  const input = document.getElementById('ip-name');
  if(!title || !input) return;
  snapshotRenameAsset = snapshotDiskPaths();
  title.hidden = true;
  input.hidden = false;
  input.dataset.before = a.name;
  input.focus();
  input.select();
}

export function headAssetHtml(a){
  const kindName = NAMES_KIND[a.kind] || a.kind;
  const subtitle = IMPORT_DEFAULT[a.kind] ? 'Paramètres d\'import' : kindName;
  const filePath = pathFolderAsset(a);
  // Un asset à la racine n'a pas de chemin à montrer, et une ligne vide se lit comme un bug.
  const shownPath = filePath || '📦 Racine du projet';
  const src = fileSourceAsset(a);
  return '<div class="ip-head">'
    + '<div class="ip-head-thumb" title="' + escapeHtml(kindName) + '">'
    + (a.preview ? '<img src="' + a.preview + '" alt="">'
                 : '<span>' + (ICONS_KIND[a.kind] || '📦') + '</span>')
    + '</div>'
    + '<div class="ip-head-main">'
    + '<div class="ip-head-title" id="ip-head-name" title="Double-clic : renommer">'
    + '<b>' + escapeHtml(a.name) + '</b><span>' + escapeHtml(subtitle) + '</span></div>'
    + '<input type="text" class="ip-head-rename" id="ip-name" spellcheck="false" hidden value="'
    + escapeHtml(a.name) + '">'
    + '<div class="ip-head-path">'
    + '<span class="ip-head-folder" title="' + escapeHtml(shownPath) + '">'
    + escapeHtml(shownPath) + '</span>'
    + '<button class="btn-mini" id="ip-copy-path" title="Copier « ' + escapeHtml(shownPath)
    + ' », le chemin du dossier dans le projet">⧉ chemin</button>'
    + '<button class="btn-mini" id="ip-copy-fullpath" title="Copier le chemin complet sur ce '
    + 'disque. La racine du projet est demandée la première fois : le navigateur ne la connaît '
    + 'pas.">⧉ complet</button>'
    + '</div></div>'
    + (IMPORT_DEFAULT[a.kind]
      ? '<div class="ip-head-actions"><button class="ip-head-icon" id="ip-presets" '
        + 'title="Presets d\'import : appliquer un jeu de réglages enregistré, ou en créer un à '
        + 'partir de ceux-ci">🔖</button></div>'
      : '')
    + '</div>'
    + (src ? ipInfo('Fichier', src.name + ' · ' + weightReadable(src.size)) : '');
}


// ---------- Les PRESETS d'import ----------
//
// Un preset est un jeu de réglages d'import NOMMÉ, réappliquable à n'importe quel asset du même
// genre : « Personnage » (centimètres, rig humanoïde, UV de lightmap), « Décor », « Texture
// d'interface »… C'est le Preset d'Unity, en plus petit.
//
// C'EST UN ASSET, avec son fichier `<nom>.preset.json` dans un dossier du projet. Il a d'abord
// vécu dans `project.settings` : invisible, non rangeable, absent du disque, donc impossible à
// mettre dans git ou à reprendre d'un projet à l'autre. Un asset se range, se renomme, se
// déplace et se versionne comme le reste — et on choisit où il atterrit au moment de le créer.
//
// CE QU'UN PRESET NE PORTE PAS : `materials`, les affectations par emplacement. Un emplacement
// est nommé par le fichier ; recopier la table d'un modèle sur un autre affecterait un matériau
// à un emplacement qui n'existe pas — ou, bien pire, au mauvais.

/** Les presets du projet qui visent ce genre d'asset. */
export function importPresetsOf(kind){
  return assets.filter(function(a){
    return a.kind === 'preset' && a.preset && a.preset.kind === kind;
  });
}

/** Les réglages à retenir dans un preset : tout sauf ce qui nomme le contenu d'un fichier. */
export function paramsForPreset(params){
  const copy = JSON.parse(JSON.stringify(params || {}));
  delete copy.materials;
  // La liste des clips est celle d'UN fichier (ses prises, ses ids) — même raison.
  delete copy.clips;
  return copy;
}

/**
 * Pose un preset dans le BROUILLON de l'asset.
 *
 * Comme « ↺ Par défaut » : rien n'est appliqué tant qu'on n'a pas cliqué « 💾 Appliquer ». Un
 * preset qui toucherait la scène au clic serait le geste le plus regretté du panneau.
 */
export function applyImportPreset(a, idPreset){
  const preset = assets.find(function(x){ return x.id === idPreset && x.kind === 'preset'; });
  if(!preset || !a || !preset.preset || preset.preset.kind !== a.kind) return false;
  if(!IMPORT_DEFAULT[a.kind]) return false;
  const before = paramsShown(a) || {};
  a.paramsDraft = Object.assign(
    JSON.parse(JSON.stringify(IMPORT_DEFAULT[a.kind])),
    JSON.parse(JSON.stringify(preset.preset.params || {})),
    // Les emplacements de matériaux restent ceux de CET asset : voir l'en-tête de section.
    (a.kind === 'model')
      ? Object.assign({materials: JSON.parse(JSON.stringify(before.materials || {}))},
          Array.isArray(before.clips) ? {clips: JSON.parse(JSON.stringify(before.clips))} : {})
      : {});
  return true;
}

/** La fenêtre des presets : en choisir un, ou en créer un à partir des réglages affichés. */
export function modalImportPresets(a){
  if(!a || !IMPORT_DEFAULT[a.kind] || typeof openModal !== 'function') return;
  const kind = a.kind;
  const list = importPresetsOf(kind);
  const rows = list.length
    ? list.map(function(p){
        return '<div class="prs-row">'
          + '<span class="prs-name" title="' + escapeHtml(pathFolderAsset(p) || '📦 racine')
          + '">🔖 ' + escapeHtml(p.name) + '</span>'
          + '<button class="btn-modal accent prs-apply" data-id="' + p.id + '">Appliquer</button>'
          + '<button class="btn-modal prs-del" data-id="' + p.id
          + '" title="Supprimer ce preset du projet">×</button></div>';
      }).join('')
    : '<div class="ip-note">Aucun preset pour ce genre d\'asset. Réglez celui-ci comme il vous '
      + 'convient, puis enregistrez-le ci-dessous : il s\'appliquera ensuite en un clic à tous '
      + 'les autres.</div>';

  // Où le fichier atterrit. Les dossiers du projet, plus sa racine — c'est le même arbre que le
  // panneau Projet, et le fichier s'écrira réellement là (`assets/<dossier>/<nom>.preset.json`).
  const folderSuggested = (a.folder || '');
  const optsFolder = [''].concat(listFolders()).map(function(f){
    return '<option value="' + escapeHtml(f) + '"'
      + (f === folderSuggested ? ' selected' : '') + '>'
      + escapeHtml(f || '📦 Racine du projet') + '</option>';
  }).join('');

  openModal('Presets d\'import — ' + (NAMES_KIND[kind] || kind),
    '<div id="prs-body">'
    + '<p>Un preset est un jeu de réglages d\'import nommé, rangé dans le projet comme un asset '
    + '(<code>&lt;nom&gt;.preset.json</code>). L\'appliquer remplit les réglages de <b>'
    + escapeHtml(a.name) + '</b> <b>sans rien changer tout de suite</b> : c\'est « 💾 Appliquer », '
    + 'en bas de l\'inspecteur, qui les valide.</p>'
    + '<div class="sec">Presets du projet</div>'
    + rows
    + '<div class="sec">Créer à partir des réglages affichés</div>'
    + '<div class="field"><label>Nom</label>'
    + '<input type="text" id="prs-new-name" spellcheck="false" placeholder="Personnage"></div>'
    + '<div class="field" title="Le dossier du projet où le fichier .preset.json sera écrit.">'
    + '<label>Dossier</label><select id="prs-new-folder">' + optsFolder + '</select></div>'
    + '<div class="ip-note">Un preset ne reprend pas les <b>emplacements de matériaux</b> : '
    + 'ils nomment le contenu d\'un fichier précis, et n\'ont pas de sens sur un autre.</div>'
    + '<div style="display:flex;gap:8px;margin-top:12px;justify-content:space-between">'
    + '<button class="btn-modal accent" id="prs-create">➕ Enregistrer ces réglages</button>'
    + '<button class="btn-modal" id="prs-close">Fermer</button></div>'
    + '</div>');

  // Écouteur posé sur le corps de la modale, détruit à la prochaine ouverture : rien ne
  // s'accumule d'une ouverture à l'autre (même patron que modalNaming).
  document.getElementById('prs-body').addEventListener('click', function(e){
    const id = e.target.dataset ? e.target.dataset.id : null;
    if(id && e.target.classList.contains('prs-apply')){
      if(applyImportPreset(a, id)){
        if(typeof closeModal === 'function') closeModal();
        buildInspectorAsset(a);
        setStatus('Preset posé sur « ' + a.name + ' » — « Appliquer » pour le valider', 4000);
      }
      return;
    }
    if(id && e.target.classList.contains('prs-del')){
      const p = assets.find(function(x){ return x.id === id; });
      // `removeAsset` pose son propre pas d'historique et retire le fichier du disque :
      // c'est le même retrait que la croix d'une tile du panneau Projet, pas un second chemin.
      if(p) removeAsset(p);
      modalImportPresets(a);
      return;
    }
    if(e.target.id === 'prs-close'){
      if(typeof closeModal === 'function') closeModal();
      return;
    }
    if(e.target.id === 'prs-create'){
      const name = (document.getElementById('prs-new-name').value || '').trim();
      if(!name){ setStatus('Donnez un nom au preset', 2500); return; }
      const folder = document.getElementById('prs-new-folder').value || '';
      pushHistory();
      const p = createAssetPreset(kind, name, paramsForPreset(paramsShown(a)), folder);
      modalImportPresets(a);
      setStatus('Preset « ' + p.name + ' » enregistré dans '
        + (folder ? 'assets/' + folder : 'la racine du projet'), 4000);
    }
  });
}

/** Ce qu'un asset preset montre dans l'inspecteur : ce qu'il vise, et ce qu'il porte. */
export function sectionAssetPresetHtml(a){
  const d = a.preset || {};
  const kindName = NAMES_KIND[d.kind] || d.kind || '—';
  const keys = Object.keys(d.params || {});
  return '<div class="sec">Preset d\'import</div>'
    + ipInfo('S\'applique à', kindName + ' (' + keys.length + ' réglage'
        + (keys.length > 1 ? 's' : '') + ')')
    + (IMPORT_DEFAULT[d.kind]
      ? '<div class="ip-note">Sélectionnez un asset de ce genre dans le panneau Projet, puis '
        + '🔖 dans l\'en-tête de l\'inspecteur pour appliquer ce preset.</div>'
      : '<div class="ip-note" style="color:#ffb3b8">Ce preset vise un genre d\'asset qui n\'a '
        + 'pas de paramètres d\'import : il ne s\'appliquera à rien.</div>')
    + (keys.length
      ? '<div class="sec">Réglages</div><div class="ip-note">'
        + keys.map(function(k){
            return escapeHtml(k) + ' = <b>' + escapeHtml(JSON.stringify(d.params[k])) + '</b>';
          }).join('<br>') + '</div>'
      : '');
}

export function buildInspectorAsset(a){
  let h = headAssetHtml(a);

  if(a.kind === 'model' && a._sub){
    // Un sous-asset sélectionné dans le panneau Projet : de la VISUALISATION, rien d'autre.
    h += sectionSubAssetHtml(a);
    inspBody.innerHTML = h;
    refreshUvPreview(a);
    return;
  }
  if(a.kind === 'model'){
    const p = paramsShown(a);
    const nb = countInstancesModel(a);
    const detectee = NAMES_UNIT[unitNamed(a.unitFile)]
      || ('×' + (a.unitFile || 1));
    const tab = a._tab || 'model';
    // Les onglets d'Unity. Le panneau d'un modèle porte trois familles de réglages qui n'ont
    // rien à se dire, et les empiler faisait une colonne de deux écrans de haut.
    h += '<div class="ip-tabs">'
      + [['model', 'Modèle'], ['rig', 'Rig'], ['animation', 'Animation'],
         ['materials', 'Matériaux']].map(function(t){
          return '<button class="ip-tab' + (tab === t[0] ? ' on' : '') + '" data-tab="' + t[0]
            + '">' + t[1] + '</button>';
        }).join('') + '</div>';
    if(tab === 'animation'){
      h += sectionAnimationTabHtml(a, p);
      h += sectionApplyHtml(a);
      inspBody.innerHTML = h;
      return;
    }
    if(tab === 'rig'){
      h += sectionRigHtml(a, p) + sectionPreviewModelHtml(a);
      h += sectionApplyHtml(a);
      inspBody.innerHTML = h;
      refreshUvPreview(a);
      return;
    }
    if(tab === 'materials'){
      h += sectionMaterialsModelHtml(a, p) + sectionPreviewModelHtml(a);
      h += sectionApplyHtml(a);
      inspBody.innerHTML = h;
      refreshUvPreview(a);
      return;
    }
    h += '<div class="sec">Scène</div>'
      + ipSelect('ip-unites', 'Unités', [['auto', 'Auto (fichier : ' + detectee + ')'],
          ['m', 'Mètres'], ['cm', 'Centimètres'], ['mm', 'Millimètres'],
          ['in', 'Pouces'], ['ft', 'Pieds']], p.unites,
          'Unité dans laquelle le fichier a été exporté. Le modèle est converti en mètres '
          + 'pour faire la taille qu\'il a dans Maya / Blender / 3ds Max.')
      // L'ÉCHELLE ET LA TAILLE SUR LA MÊME LIGNE. Ce sont la cause et son effet : on tape un
      // multiplicateur pour obtenir une taille, et les lire à deux endroits obligeait à faire
      // l'aller-retour du regard à chaque frappe. `ip-dims` garde son id — c'est lui que
      // `updateStatesFieldsImport` réécrit sans reconstruire le panneau.
      + '<div class="field" title="Multiplicateur appliqué après la conversion d’unité. '
        + 'La taille est celle du modèle une fois converti, en mètres.">'
        + '<label>Échelle</label>'
        + '<input type="number" id="ip-echelle" step="0.1" min="0.0001" max="10000" '
        + 'style="width:60px" value="' + p.scale + '">'
        + '<span class="ip-info" id="ip-dims">' + escapeHtml(dimensionsReadable(a))
        + '</span></div>'
      + ipCell('ip-convertir', 'Convertir les unités', p.convertUnits,
          'Coché : la conversion est cuite dans la géométrie, et les objets de la scène gardent '
          + 'une échelle de 1, 1, 1 — c\'est « Convert Units » d\'Unity. Décoché : elle vit sur '
          + 'l\'échelle de l\'objet, qui affiche alors ' + (a.unitFile && a.unitFile !== 1
            ? a.unitFile.toString().replace('.', ',') : '0,01') + ' pour un fichier en '
          + (a.unitFile === 0.01 ? 'centimètres' : 'unités non métriques')
          + '. La taille à l\'écran est la même dans les deux cas.')
      + ipCell('ip-centrer', 'Centrer X/Z', p.centrer, 'Centre le modèle sur son origine en X et Z.')
      + ipCell('ip-sol', 'Poser au sol', p.setGround, 'Aligne la base du modèle sur Y = 0.')
      + ipCell('ip-blendshapes', 'Importer les blend shapes', p.importBlendShapes !== false,
          'Les formes de morphing du fichier (expressions, correctifs). Décoché : elles sont '
          + 'retirées du maillage — « Import BlendShapes » d\'Unity.')
      + ipCell('ip-visibility', 'Importer la visibilité', p.importVisibility !== false,
          'Coché : un nœud caché dans le fichier reste caché. Décoché : tout est visible — '
          + '« Import Visibility » d\'Unity.')
      + ipCell('ip-cameras', 'Importer les caméras', p.importCameras !== false,
          'Les caméras du fichier. Décoché : elles sont retirées de la hiérarchie, leurs '
          + 'enfants remontent — « Import Cameras » d\'Unity.')
      + ipCell('ip-lights', 'Importer les lumières', p.importLights !== false,
          'Les lumières du fichier. Décoché : elles sont retirées — sinon elles éclairent la '
          + 'scène à chaque instance posée. « Import Lights » d\'Unity.')
      + ipInfo('Instances', nb + ' dans la scène'
          + (nb ? ' — toutes mises à jour à l\'application' : ''));

    h += '<div class="sec">Hiérarchie</div>'
      + ipCell('ip-hier-garder', 'Conserver la hiérarchie', p.preserveHierarchy,
          'Décoché : les nœuds vides — ceux qui ne portent ni maillage, ni os, ni lumière, ni '
          + 'caméra — sont repliés dans leur parent. Un nœud cité par une animation n\'est jamais '
          + 'replié, et rien ne bouge dans la vue : sa transformation passe à ses enfants.')
      + ipCell('ip-hier-trier', 'Trier par nom', p.sortHierarchy,
          'Range les enfants de chaque nœud par ordre alphabétique. Sans ça, c\'est le fichier '
          + 'qui décide de l\'ordre — et donc de la numérotation des emplacements de matériaux.')
      + (repliedNodes(a) ? ipInfo('Nœuds repliés', repliedNodes(a)) : '');

    h += '<div class="sec">Maillages</div>'
      + ipCell('ip-gen-colliders', 'Générer les colliders', !!p.generateColliders,
          'Pose un collider ajusté sur chaque maillage du modèle, dans chaque instance — '
          + '« Generate Colliders » d\'Unity. Le moteur physique n\'a pas de collider maillage '
          + 'exact : chacun épouse la boîte de son maillage.');

    h += '<div class="sec">Géométrie</div>'
      + ipSelect('ip-normales', 'Normales', [['import', 'Importer (du fichier)'],
          ['calculate', 'Calculer'], ['none', 'Aucune']], p.normals,
          'D\'où viennent les normales de sommet. « Calculer » les refait à partir de la '
          + 'géométrie — utile si le fichier n\'en a pas, ou si elles sont fausses.')
      + ipSelect('ip-blendshape-normals', 'Normales des blend shapes', [['import', 'Importer'],
          ['calculate', 'Calculer'], ['none', 'Aucune']], p.blendShapeNormals || 'import',
          'D\'où viennent les normales des formes de morphing — « Blend Shape Normals » d\'Unity. '
          + 'Sans elles, l\'éclairage d\'une expression reste celui du visage neutre.')
      + ipSelect('ip-normales-mode', 'Mode des normales',
          [['areaAngle', 'Aire et angle'], ['area', 'Aire'], ['angle', 'Angle'],
           ['unweighted', 'Sans pondération']], p.normalsMode,
          'Poids de chaque face dans la normale d\'un sommet. « Aire » est ce que three fait '
          + 'seul ; « aire et angle » est le défaut d\'Unity, plus juste sur un maillage aux '
          + 'triangles très inégaux. Le lissage, lui, vient du partage des sommets dans le '
          + 'fichier, ou de l\'angle de lissage ci-dessous.')
      + ipSelect('ip-smooth-source', 'Source du lissage', [['groups', 'Groupes du fichier'],
          ['angle', 'Angle de lissage'], ['none', 'Aucun (arêtes dures)']],
          p.smoothnessSource || 'groups',
          'Quand les normales sont CALCULÉES : « Groupes » lisse ce que le fichier soude, '
          + '« Angle » lisse deux faces qui se touchent si elles font moins que l\'angle — '
          + '« Smoothness Source » d\'Unity.')
      + ipNumber('ip-smooth-angle', 'Angle de lissage', p.smoothingAngle === undefined ? 60
          : p.smoothingAngle, 1, 0, 180, p.normals !== 'calculate' || p.smoothnessSource !== 'angle',
          'En degrés. Au-delà, l\'arête est dure — « Smoothing Angle » d\'Unity.')
      + ipSelect('ip-tangentes', 'Tangentes', [['import', 'Importer (du fichier)'],
          ['mikktspace', 'Calculer (Mikktspace)'], ['calculate', 'Calculer (hérité de three)'],
          ['none', 'Aucune']], p.tangents,
          'Nécessaires à une carte de normales. Sans elles, three en déduit du repère de '
          + 'l\'écran, ce qui se voit sur les surfaces vues en biais. <b>Mikktspace</b> est la '
          + 'convention des outils qui cuisent les cartes (Blender, Substance, Marmoset) : '
          + 'soudure sur position + normale + UV, groupes d\'orientation, moyenne pondérée par '
          + 'l\'angle. Le calcul hérité de three ignore les trois et exige un index.')
      + ipCell('ip-swap-uvs', 'Échanger les UV', !!p.swapUvs,
          'Échange uv et uv1 — utile quand l\'exportateur a mis la lightmap dans le premier '
          + 'jeu. « Swap UVs » d\'Unity.')
      + ipCell('ip-uv-lightmap', 'UV de lightmap', p.lightmapUv,
          'Déplie le modèle dans un second jeu d\'UV (uv1) sans recouvrement, que la cuisson de '
          + 'lightmap utilisera. Sans lui elle se rabat sur les UV de texture, qui se recouvrent '
          + 'dès qu\'une texture est carrelée — deux surfaces éclairées dans les mêmes texels.')
      + (p.lightmapUv
        ? ipNumber('ip-lm-hard-angle', 'Angle dur', p.lightmapHardAngle === undefined ? 60
            : p.lightmapHardAngle, 1, 0, 180, false,
            'Au-delà de cet angle, deux faces voisines partent dans deux îlots — « Hard Angle » '
            + 'd\'Unity.')
          + ipNumber('ip-lm-margin', 'Marge d\'empaquetage', p.lightmapPackMargin === undefined
            ? 4 : p.lightmapPackMargin, 1, 0, 64, false,
            'Espace entre îlots, en texels d\'une lightmap de 1024 — « Pack Margin » d\'Unity. '
            + 'Trop faible : la lumière d\'un îlot bave sur son voisin.')
        : '')
      + (p.lightmapUv ? '<div class="ip-note">Dépliage par projection plane : un îlot par groupe '
          + 'de faces orientées pareil, rangés dans le carré unité. Des sommets sont dédoublés '
          + 'aux coutures, le modèle en compte donc un peu plus qu\'à l\'import.</div>' : '')
      + sectionPreviewModelHtml(a);

  }
  else if(a.kind === 'texture'){
    const p = paramsShown(a);
    const autoSrgb = (spaceColorTexture({spaceColor:'auto', type:p.type}) === THREE.SRGBColorSpace);
    h += '<div class="sec">Import de la texture</div>'
      + ipInfo('Résolution', resolutionReadable(a), 'ip-res')
      + ipSelect('ip-type', 'Type', [['color', 'Couleur (albédo)'],
          ['normal', 'Carte de normales'], ['data', 'Données (masque, AO…)']], p.type,
          'Usage de la texture : décide de son espace de couleur et, au glisser-déposer '
          + 'sur un objet, de la map visée (albédo ou normales). Une texture de données '
          + 'se branche dans un matériau.')
      + ipSelect('ip-srgb', 'Espace couleur',
          [['auto', 'Auto (' + (autoSrgb ? 'sRGB' : 'linéaire') + ')'],
           ['srgb', 'sRGB'], ['lineaire', 'Linéarea']], p.spaceColor,
          'Les images de couleur sont encodées en sRGB, les données (normales, '
          + 'rugosité, masques) en linéaire.')
      + (!outputSrgb() && p.spaceColor === 'srgb'
        ? '<div class="ip-note">⚠ La sortie du rendu est linéaire : marquer cette texture '
          + 'sRGB va l\'assombrir. Voir la note sur le pipeline couleur dans les '
          + 'spécifications.</div>' : '')
      + ipSelect('ip-taillemax', 'Taille max', [[0, 'Résolution d\'origine'],
          [4096, '4096 px'], [2048, '2048 px'], [1024, '1024 px'],
          [512, '512 px'], [256, '256 px'], [128, '128 px']], p.sizeMax,
          'Réduit l\'image envoyée au GPU (mémoire vidéo). Le fichier source reste intact.')
      + ipSelect('ip-repetition', 'Répétition', [['repeter', 'Répéter'],
          ['bloquer', 'Bloquer aux bords'], ['miroir', 'Miroir']], p.repetition,
          'Comportement des UV hors de l\'intervalle 0–1.')
      + '<div class="field" title="Nombre de répétitions de l\'image sur la surface.">'
      + '<label>Tuilage U/V</label>'
      + '<input type="number" id="ip-tu" step="0.5" min="0.01" style="width:60px" value="' + p.tuilage[0] + '"> '
      + '<input type="number" id="ip-tv" step="0.5" min="0.01" style="width:60px" value="' + p.tuilage[1] + '"></div>'
      + ipSelect('ip-filtrage', 'Filtrage', [['lineaire', 'Linéarea (lissé)'],
          ['near', 'Proche (pixel art)']], p.filtrage,
          'Proche garde les pixels nets, sans interpolation.')
      + ipCell('ip-mipmaps', 'Mipmaps', p.mipmaps,
          'Niveaux réduits précalculés : indispensable de loin, à couper pour une '
          + 'texture d\'interface ou du pixel art net.')
      + ipNumber('ip-aniso', 'Anisotropie', p.anisotropy, 1, 1, anisotropyMax(), !p.mipmaps,
          'Netteté des surfaces vues en biais (max ' + anisotropyMax() + ' sur ce GPU).')
      + ipSelect('ip-flip', 'Inverser Y', [['auto', 'Auto (selon le format)'],
          ['oui', 'Toujours'], ['non', 'Jamais']], p.invertY,
          'Auto : conservé pour les primitives, inversé pour les UV glTF. À forcer si la texture apparaît retournée.')
      + ipInfo('Utilisations', countUsagesTexture(a) + ' dans la scène')
      + sectionPreviewTextureHtml(a, p);
  }
  else if(a.kind === 'audio'){
    const p = paramsShown(a);
    const nb = objects.filter(function(o){
      return o.userData.audio && o.userData.audio.asset === a.id; }).length;
    h += '<div class="sec">Import du son</div>'
      + (a.duration ? ipInfo('Durée', a.duration.toFixed(2) + ' s') : ipInfo('Durée', 'décodage…'))
      + ipNumber('ip-volume', 'Volume', p.volume, 0.05, 0, 1, false)
      + ipCell('ip-boucle', 'Boucle', p.loop)
      + ipCell('ip-spatial', 'Spatial 3D', p.spatial,
          'Son positionnel atténué par la distance (sinon volume constant).')
      + ipNumber('ip-portee', 'Portée', p.range, 1, 0.1, 1000, !p.spatial,
          'Distance de référence de l\'atténuation.')
      + ipNumber('ip-pitch', 'Pitch', p.pitch, 0.05, 0.1, 4, false, 'Vitesse de lecture.')
      + '<div class="field"><label></label><button class="btn-modal" id="ip-listen">'
      + ((engineAudio.preview && engineAudio.preview.assetId === a.id) ? '⏹ Arrêter' : '▶ Écouter')
      + '</button></div>'
      + ipInfo('Sources', nb + ' dans la scène'
          + (nb ? ' — toutes mises à jour à l\'application' : ''))
      + '<div class="ip-note">Ces valeurs sont posées sur la source au moment où le son '
      + 'est attaché à un objet ; elles restent réglables par objet dans l\'inspecteur.</div>';
  }
  else if(a.kind === 'sfx'){
    // Un bruitage calculé : sa recette se règle dans le Rack sonore (module SX-1), pas ici — un
    // formulaire de vingt champs numériques ne se juge pas à l'oreille. L'inspecteur montre ce
    // qu'on entend et ouvre le rack.
    const r = a.recipe || {};
    const nb = objects.filter(function(o){
      return o.userData.audio && o.userData.audio.asset === a.id; }).length;
    h += '<div class="sec">Bruitage</div>'
      + ipInfo('Durée', (a.duration || 0).toFixed(2) + ' s')
      + ipInfo('Onde', escapeHtml(r.wave || '?'))
      + ipInfo('Hauteur', Math.round((r.pitch && r.pitch.start) || 0) + ' Hz')
      + ipInfo('Sources', nb + ' dans la scène')
      + '<div class="field"><label></label><button class="btn-modal" id="ip-listen">'
      + ((engineAudio.preview && engineAudio.preview.assetId === a.id) ? '⏹ Arrêter' : '▶ Écouter')
      + '</button></div>'
      + '<div class="field"><label></label><button class="btn-modal accent" id="ip-edit">'
      + '🎛 Régler dans le Rack sonore</button></div>'
      + '<div class="ip-note">Un bruitage n\'a pas de fichier audio : il est recalculé depuis sa recette '
      + '(<code>.sfx.json</code>), dans l\'éditeur comme dans le jeu publié.</div>';
  }
  else if(a.kind === 'musicLoop'){
    const r = a.recipe || {};
    const nb = objects.filter(function(o){
      return o.userData.audio && o.userData.audio.asset === a.id; }).length;
    h += '<div class="sec">Boucle musicale</div>'
      + ipInfo('Durée', (a.duration || 0).toFixed(2) + ' s')
      + ipInfo('Tempo', (r.tempo || 0) + ' BPM, ' + (r.bars || 1) + ' mesure(s)')
      + ipInfo('Tonalité', escapeHtml((r.key || '?') + ' ' + (r.scale || '')))
      + ipInfo('Sources', nb + ' dans la scène')
      + '<div class="field"><label></label><button class="btn-modal accent" id="ip-edit">'
      + '🎹 Composer dans le Rack sonore</button></div>'
      + '<div class="ip-note">Recalculée depuis sa recette (<code>.loop.json</code>), dans l’éditeur comme '
      + 'dans le jeu publié. Posée sur un objet, elle joue en boucle sur le bus Musique.</div>';
  }
  else if(a.kind === 'material'){
    h += sectionMaterialHtml(a);
  }
  else if(a.kind === 'animation' && a.embedded){
    // Un clip de modèle est un SOUS-ASSET : ses réglages sont dans l'onglet Animation de son
    // fichier, comme dans Unity, où l'inspecteur d'un clip d'FBX renvoie à son importeur.
    const model = assets.find(function(x){ return x.id === a.embedded; });
    h += '<div class="sec">Clip d\'un modèle</div>'
      + '<div class="ip-note">Ce clip appartient à <b>' + escapeHtml(model ? model.name : '?')
      + '</b>. Il se règle dans l\'onglet <b>Animation</b> de ce fichier.</div>'
      + '<div class="field"><label></label><button class="btn-modal accent" id="ip-open-model">'
      + '🎞 Ouvrir l\'onglet Animation du modèle</button></div>';
  }
  else if(a.kind === 'animation'){
    h += sectionAssetAnimationHtml(a);
  }
  else if(a.kind === 'sprite'){
    h += sectionAssetSpriteHtml(a);
  }
  else if(a.kind === 'animator'){
    // Les états et transitions ne s'éditent PAS ici : la fenêtre Animator (ouverte au double-clic,
    // voir assets.js) est le seul endroit qui les affiche — un mini-inspecteur s'y monte à part
    // dès qu'un état ou une transition y est sélectionné (panels-components.js,
    // mountInspectorAnimatorAsset), sous ce message.
    h += '<div class="ip-note">Éditez les états et transitions dans la fenêtre <b>Animator</b> '
      + '(ouverte au double-clic sur cette vignette) : cliquez un état ou une transition dans le '
      + 'graphe, ses réglages apparaissent juste en dessous.</div>';
  }
  else if(a.kind === 'preset'){
    h += sectionAssetPresetHtml(a);
  }
  else if(a.kind === 'tilePalette'){
    h += sectionAssetTilePaletteHtml(a);
  }
  else if(WITHOUT_IMPORT[a.kind]){
    h += '<div class="sec">Paramètres</div>'
      + '<div class="ip-note">Cet asset est créé dans l\'éditeur : il n\'a pas de paramètres '
      + 'd\'import.</div>';
    if(a.kind === 'script')
      h += '<div class="field"><label></label><button class="btn-modal accent" id="ip-edit">📜 Éditer le script</button></div>';
    if(a.kind === 'graphShader')
      h += '<div class="field"><label></label><button class="btn-modal accent" id="ip-edit">🧩 Éditer le graphe (fenêtre séparée)</button></div>';
    if(a.kind === 'postProfile')
      h += '<div class="field"><label></label><button class="btn-modal accent" id="ip-edit">🌈 Éditer le profil</button></div>';
  }

  h += sectionApplyHtml(a);

  inspBody.innerHTML = h;
  if(a.kind === 'model') refreshUvPreview(a);
  // Les vignettes se dessinent APRÈS la pose du HTML : ce sont des canvas. Globale gardée, pas
  // d'import : palette-ui.js importe déjà ce que ce fichier importe, et la boucle d'imports
  // ne gagnerait rien.
  if(a.kind === 'tilePalette' && typeof globalThis.drawTileThumbs === 'function'){
    globalThis.drawTileThumbs(inspBody.querySelector('.ip-tp-grid'), a.palette);
  }
}

/**
 * L'inspecteur d'une palette : ce qu'elle contient, EN IMAGES. Il était vide (le genre n'avait
 * aucune branche ici), si bien que sélectionner une palette ne montrait rien du tout.
 */
export function sectionAssetTilePaletteHtml(a){
  const p = a.palette || {cellSize: 0.5, tiles: []};
  const maps = Registry.active
    ? Registry.active('Tilemap').filter(function(t){ return t.paletteId === a.id; }).length : 0;
  let h = '<div class="sec">Palette de tuiles</div>'
    + ipInfo('Tuiles', String(p.tiles.length))
    + ipInfo('Cellule', p.cellSize + ' unité(s)')
    + ipInfo('Maps', maps + ' dans la scène');
  h += p.tiles.length
    ? '<div class="ip-tp-grid">' + p.tiles.map(function(t, i){
        return '<canvas width="32" height="32" data-index="' + i + '" title="'
          + escapeHtml((i + 1) + ' · ' + (t.name || 'Tuile')) + '"></canvas>';
      }).join('') + '</div>'
    : '<div class="ip-note">Palette vide : ouvrez-la et glissez-y une planche découpée — une '
      + 'tuile par image.</div>';
  h += '<div class="field"><label></label><button class="btn-modal accent" id="ip-edit">'
    + '▦ Ouvrir la palette</button></div>';
  return h;
}

/** Redessine la planche d'UV après que le panneau a été (re)construit. */
export function refreshUvPreview(a){
  const canvas = document.getElementById('ip-uv');
  if(!canvas || !canvas.getContext) return;
  const sub = (a.kind === 'model' && a._sub && a._sub.kind === 'mesh') ? a._sub : null;
  const mesh = sub ? meshesModel(a.template)[sub.index] : null;
  // La planche est tracée UNE fois dans un canvas hors écran, puis recopiée : `drawImage` d'un
  // canvas de 240 px ne coûte rien, retracer cent mille triangles si.
  if(!a._uvPlates) a._uvPlates = new Map();
  const key = keyPreviewTarget(a, mesh) + '#' + a._uvSet + '@' + canvas.width + 'x' + canvas.height;
  let plate = a._uvPlates.get(key);
  if(!plate){
    const off = document.createElement('canvas');
    off.width = canvas.width;
    off.height = canvas.height;
    plate = {canvas: off, triangles: drawUvModel(off, a, a._uvSet, mesh)};
    a._uvPlates.set(key, plate);
  }
  const cx = canvas.getContext('2d');
  if(cx){ cx.clearRect(0, 0, canvas.width, canvas.height); cx.drawImage(plate.canvas, 0, 0); }
  const n = plate.triangles;
  const note = document.getElementById('ip-uv-note');
  if(note) note.textContent = n + ' triangle(s) dans « ' + a._uvSet + ' »';
}

// ---------- Animation : un clip d'un modèle, plus ses réglages ----------
//
// L'asset RÉFÉRENCE le clip, il ne le recopie pas (js/anim-asset.js). L'inspecteur montre donc
// d'abord D'OÙ vient le clip, puis ce qu'on en fait.

export function sectionAssetAnimationHtml(a){
  const type = (typeof typeSourceAnim === 'function') ? typeSourceAnim(a) : 'model';
  let h = '<div class="sec">Source</div>'
    + ipSelect('ip-anim-type', 'Type', [['keys', 'Clés posées dans l\'éditeur'],
        ['model', 'Clip d\'un modèle importé']], type,
        'Un clip créé ici, comme « Create New Clip » d\'Unity — ou une référence à un clip '
        + 'd\'un fichier .glb / .fbx importé.');
  if(type === 'keys') return h + sectionAnimAKeysHtml(a);
  return h + sectionAnimModelHtml(a);
}

/**
 * Un clip à clés. L'édition des clés se fait dans la TIMELINE, pas ici : c'est là qu'il y a une
 * règle graduée, une tête de lecture et le viewport à côté. L'inspecteur ne porte que ce qui
 * n'est pas temporel.
 */
export function sectionAnimAKeysHtml(a){
  const tracks = (a.tracks || []).filter(function(p){ return p && p.keys && p.keys.length; });
  const nKeys = tracks.reduce(function(n, p){ return n + p.keys.length; }, 0);
  const open = anim.assetClip === a.id;
  let h = '<div class="field"><label></label>'
    + '<button class="btn-modal accent" id="ip-anim-open">'
    + (open ? '⏹ Fermer le clip' : '🎬 Ouvrir dans la timeline') + '</button></div>'
    + (open
      ? '<div class="ip-note">La timeline édite ce clip. Sélectionnez un objet sous la racine '
        + 'et posez des clés avec <b>🔑</b>, comme pour une animation de scène.</div>'
      : '<div class="ip-note">Sélectionnez d\'abord l\'objet qui sert de <b>racine</b> — celui '
        + 'qui portera l\'AnimatorController — puis ouvrez le clip : les pistes sont '
        + 'enregistrées en <b>chemin relatif</b> à cette racine, ce qui rend le clip '
        + 'réutilisable sur un autre objet de même forme.</div>');

  h += '<div class="sec">Clip</div>'
    + ipNumber('ip-anim-duree', 'Durée (s)', a.duration || 1, 0.1, 0.05, 600)
    + ipNumber('ip-anim-fps', 'Images/s', a.imagesBySeconde || 60, 1, 1, 240,
        false, 'Cadence d\'échantillonnage à la compilation. 60 comme Unity.')
    + ipNumber('ip-anim-vitesse', 'Vitesse', a.speed === undefined ? 1 : a.speed, 0.05, 0.01, 10)
    + ipCell('ip-anim-boucle', 'Boucle', a.loop === undefined ? true : !!a.loop);

  h += '<div class="sec">Pistes — ' + tracks.length + ' · ' + nKeys + ' clé'
    + (nKeys > 1 ? 's' : '') + '</div>';
  h += tracks.length
    ? '<div class="ip-note">' + tracks.map(function(p){
        return escapeHtml(p.os ? ('🦴 ' + p.os) : (p.filePath || '(racine)'))
          + ' — ' + p.keys.length + ' clé' + (p.keys.length > 1 ? 's' : '');
      }).join('<br>') + '</div>'
    : '<div class="ip-note">Aucune clé. Ouvrez le clip dans la timeline pour en poser.</div>';
  return h;
}

export function sectionAnimModelHtml(a){
  const models = assets.filter(function(x){
    return x.kind === 'model' && x.template && (x.template.animations || []).length;
  });
  const model = assets.find(function(x){ return x.id === (a.source && a.source.asset); }) || null;
  const clips = (model && model.template && model.template.animations) || [];
  const clip = clips.find(function(c){ return c.name === (a.source && a.source.clip); }) || null;
  const duration = clip ? clip.duration : 0;

  let h = '';
  if(!models.length){
    return '<div class="ip-note">Aucun modèle importé ne porte d\'animations. Importez un '
      + 'modèle animé (glTF / FBX) : c\'est lui qui fournit les clips.</div>';
  }
  h += ipSelect('ip-anim-modele', 'Modèle',
        models.map(function(m){ return [m.id, m.name]; }), model ? model.id : '',
        'Le modèle importé d\'où vient le clip.')
    + ipSelect('ip-anim-clip', 'Clip',
        clips.map(function(c){ return [c.name, c.name]; }), a.source ? a.source.clip : '',
        'Le clip du fichier. Un même clip peut servir à plusieurs animations, réglées '
        + 'différemment.')
    + ipInfo('Durée', clip ? (duration.toFixed(2) + ' s') : '— clip introuvable');

  // Les problèmes AVANT les réglages : régler la vitesse d'un clip qui n'existe pas n'a pas
  // de sens, et la cause doit se lire au même endroit que le symptôme.
  const pbs = (typeof validateAnimAsset === 'function')
    ? validateAnimAsset(a, function(id){ return assets.find(function(x){ return x.id === id; }) || null; })
    : [];
  if(pbs.length){
    h += '<div class="ip-note" style="color:#ffb3b8">' + pbs.map(escapeHtml).join('<br>') + '</div>';
  }

  const bounds = (typeof boundsAnimAsset === 'function')
    ? boundsAnimAsset(a, duration) : {start:0, end:duration};
  h += '<div class="sec">Lecture</div>'
    + ipNumber('ip-anim-vitesse', 'Vitesse', a.speed === undefined ? 1 : a.speed,
        0.05, 0.01, 10, false, 'Multiplicateur de vitesse de lecture.')
    + ipCell('ip-anim-boucle', 'Boucle', a.loop === undefined ? true : !!a.loop,
        'Décoché : le clip s\'arrête sur sa dernière image. C\'est ce qu\'attend une '
        + 'transition « attendre la fin ».')
    + '<div class="sec">Découpe</div>'
    + ipNumber('ip-anim-debut', 'Début (s)', a.start || 0, 0.05, 0, Math.max(0, duration), !clip)
    + ipNumber('ip-anim-fin', 'Fin (s)', (a.end === undefined || a.end === null) ? duration : a.end,
        0.05, 0, Math.max(0, duration), !clip)
    + ipInfo('Jouée', clip ? ((bounds.end - bounds.start).toFixed(2) + ' s') : '—')
    + '<div class="ip-note">Bornes en secondes du clip source. Une découpe vide ou inversée '
    + 'rend le clip entier plutôt que rien.</div>';

  // Les marqueurs appartiennent au CLIP, donc à l'asset du modèle (js/anim-markers.js), et
  // s'éditent sur la timeline. Ils sont montrés ici — c'est la vue où l'on se demande ce que
  // ce clip déclenche — mais PAS édités : deux surfaces d'écriture pour une seule donnée,
  // c'est la divergence assurée.
  const marq = (model && typeof markersOfClip === 'function' && a.source)
    ? markersOfClip(model, a.source.clip) : [];
  h += '<div class="sec">Marqueurs d\'événement — ' + marq.length + '</div>';
  h += marq.length
    ? '<div class="ip-note">' + marq.map(function(m){
        const dedans = m.t >= bounds.start && m.t <= bounds.end;
        return (dedans ? '' : '⚠ ') + m.t.toFixed(2) + ' s → ' + escapeHtml(m.event || '?')
          + (dedans ? '' : ' <i>(hors découpe : jamais émis)</i>');
      }).join('<br>') + '</div>'
    : '<div class="ip-note">Aucun.</div>';
  h += '<div class="ip-note">Les marqueurs appartiennent au clip, pas à cette animation : ils '
    + 'se posent sur la <b>timeline</b>, et valent pour toutes les animations qui utilisent ce '
    + 'clip. Ceux qui tombent hors de la découpe ne sont jamais émis.</div>';
  return h;
}

export function applyFormAnimation(a){
  a.source = a.source || {type:'keys', asset:null, clip:''};
  const typeVoulu = ipText('ip-anim-type');
  if(typeVoulu && typeVoulu !== typeSourceAnim(a)){
    a.source.type = typeVoulu;
    // Changer de type ne détruit rien : les clés d'un côté et la référence de l'autre restent
    // écrites, et repasser en arrière les retrouve. Seule la sérialisation ne garde que ce que
    // le type current utilise.
    buildInspectorAsset(a);
    updateProject();
    return;
  }
  if(typeSourceAnim(a) === 'keys'){
    a.duration = Math.max(0.05, ipNum('ip-anim-duree', 1));
    a.imagesBySeconde = Math.max(1, Math.round(ipNum('ip-anim-fps', 60)));
    a.speed = ipNum('ip-anim-vitesse', 1);
    a.loop = ipChecked('ip-anim-boucle', true);
    a.rev = (a.rev || 0) + 1;     // le clip compilé est périmé : la cadence a pu changer
    if(anim.assetClip === a.id) anim.duration = a.duration;
    updateProject();
    buildInspectorAsset(a);
    return;
  }
  const modelBefore = a.source && a.source.asset;
  const modelId = ipText('ip-anim-modele');
  if(modelId) a.source.asset = modelId;
  // Changer de modèle invalide le clip choisi : on prend le premier du nouveau fichier plutôt
  // que de garder un nom qui n'y existe pas et de laisser l'état muet.
  if(modelId && modelId !== modelBefore){
    const m = assets.find(function(x){ return x.id === modelId; });
    const clips = (m && m.template && m.template.animations) || [];
    a.source.clip = clips.length ? clips[0].name : '';
  } else {
    const clip = ipText('ip-anim-clip');
    if(clip !== null) a.source.clip = clip;
  }
  a.speed = ipNum('ip-anim-vitesse', 1);
  a.loop = ipChecked('ip-anim-boucle', true);
  a.start = ipNum('ip-anim-debut', 0);
  const end = ipNum('ip-anim-fin', 0);
  const m = assets.find(function(x){ return x.id === a.source.asset; });
  const clips = (m && m.template && m.template.animations) || [];
  const c = clips.find(function(x){ return x.name === a.source.clip; });
  // `fin` à la durée du clip = « jusqu'au bout », et on l'écrit comme tel : figer la valeur
  // ferait qu'un réimport plus long serait tronqué à l'ancienne durée, sans un mot.
  a.end = (c && Math.abs(end - c.duration) < 1e-3) ? null : end;
  updateProject();
  buildInspectorAsset(a);
}

// reconstruit le panneau si un asset est sélectionné (état d'aperçu audio, compteurs…)
export function refreshInspectorAsset(){
  if(assetSelected) buildInspectorAsset(assetSelected);
}


// ---------- lecture du formulaire ----------
export function ipNum(id, defaultValue){
  const el = document.getElementById(id);
  if(!el) return defaultValue;
  const v = parseFloat(el.value);
  return isNaN(v) ? defaultValue : v;
}
export function ipChecked(id, defaultValue){
  const el = document.getElementById(id);
  return el ? el.checked : defaultValue;
}
export function ipText(id){
  const el = document.getElementById(id);
  return el ? el.value : null;
}

export function ipSetVal(id, v){
  const el = document.getElementById(id);
  if(el && document.activeElement !== el) el.value = v;
}
export function ipDisable(id, off){
  const el = document.getElementById(id);
  if(el) el.disabled = !!off;
}

// Recale l'affichage sans reconstruire le panneau : une reconstruction à chaque
// « change » volerait le focus des champs numériques (flèches du spinner).
export function updateStatesFieldsImport(a){
  const p = paramsShown(a);
  if(!p) return;
  if(a.kind === 'model'){
    ipSetVal('ip-echelle', p.scale);
    const dims = document.getElementById('ip-dims');
    if(dims) dims.textContent = dimensionsReadable(a);
    // Sans normales, le mode n'a rien à pondérer et une tangente n'a pas de repère : les deux
    // champs sont grisés plutôt que de faire semblant d'agir.
    ipDisable('ip-normales-mode', p.normals === 'none');
    ipDisable('ip-tangentes', p.normals === 'none');
    ipDisable('ip-smooth-source', p.normals !== 'calculate');
    ipDisable('ip-smooth-angle', p.normals !== 'calculate' || p.smoothnessSource !== 'angle');
  }
  else if(a.kind === 'texture'){
    ipSetVal('ip-tu', p.tuilage[0]);
    ipSetVal('ip-tv', p.tuilage[1]);
    ipSetVal('ip-aniso', p.anisotropy);
    ipDisable('ip-aniso', !p.mipmaps);   // sans mipmaps, l'anisotropy n'agit pas
    const res = document.getElementById('ip-res');
    if(res) res.textContent = resolutionReadable(a);
  }
  else if(a.kind === 'audio'){
    ipDisable('ip-portee', !p.spatial);
    ipSetVal('ip-volume', p.volume);
    ipSetVal('ip-portee', p.range);
    ipSetVal('ip-pitch', p.pitch);
  }
}

/**
 * Lit le formulaire dans le BROUILLON. Rien n'est appliqué ici : c'est « Appliquer » qui touche
 * l'asset et la scène (voir applyDraft). L'ancienne version appliquait à chaque frappe.
 */
export function readFormImport(a){
  const p = ensureDraft(a);
  if(!p) return;

  if(a.kind === 'model'){
    const before = signatureFormModel(p);
    p.unites   = ipText('ip-unites') || p.unites;
    p.scale  = Math.max(0.0001, ipNum('ip-echelle', p.scale));
    p.centrer  = ipChecked('ip-centrer', p.centrer);
    p.setGround = ipChecked('ip-sol', p.setGround);
    p.convertUnits      = ipChecked('ip-convertir', p.convertUnits);
    p.preserveHierarchy = ipChecked('ip-hier-garder', p.preserveHierarchy);
    p.sortHierarchy     = ipChecked('ip-hier-trier', p.sortHierarchy);
    p.normals           = ipText('ip-normales') || p.normals;
    p.normalsMode       = ipText('ip-normales-mode') || p.normalsMode;
    p.tangents          = ipText('ip-tangentes') || p.tangents;
    p.lightmapUv        = ipChecked('ip-uv-lightmap', p.lightmapUv);
    p.generateColliders = ipChecked('ip-gen-colliders', !!p.generateColliders);
    p.optimizeGameObjects = ipChecked('ip-rig-optimize', !!p.optimizeGameObjects);
    const extra = ipText('ip-rig-extra');
    if(extra !== null) p.extraTransforms = extra.split(',').map(function(x){ return x.trim(); })
      .filter(Boolean);
    p.materialCreation  = ipText('ip-mat-creation') || p.materialCreation;
    p.srgbAlbedo        = ipChecked('ip-mat-srgb', p.srgbAlbedo !== false);
    p.materialLocation  = ipText('ip-mat-location') || p.materialLocation;
    const matSearch     = ipText('ip-mat-search');
    if(matSearch) a._matSearch = matSearch;
    const rigRoot       = ipText('ip-rig-root');
    if(rigRoot !== null) p.rootNode = rigRoot;
    p.avatarDefinition  = ipText('ip-avatar-def') || p.avatarDefinition;
    const avatarSource  = ipText('ip-avatar-source');
    if(avatarSource !== null) p.avatarSource = avatarSource || null;
    if(a._tab === 'animation') readFormAnimationTab(a, p);
    p.importBlendShapes = ipChecked('ip-blendshapes', p.importBlendShapes !== false);
    p.importVisibility  = ipChecked('ip-visibility', p.importVisibility !== false);
    p.importCameras     = ipChecked('ip-cameras', p.importCameras !== false);
    p.importLights      = ipChecked('ip-lights', p.importLights !== false);
    p.blendShapeNormals = ipText('ip-blendshape-normals') || p.blendShapeNormals;
    p.smoothnessSource  = ipText('ip-smooth-source') || p.smoothnessSource;
    p.smoothingAngle    = Math.max(0, Math.min(180, ipNum('ip-smooth-angle', p.smoothingAngle)));
    p.swapUvs           = ipChecked('ip-swap-uvs', !!p.swapUvs);
    p.lightmapHardAngle = Math.max(0, Math.min(180, ipNum('ip-lm-hard-angle', p.lightmapHardAngle)));
    p.lightmapPackMargin = Math.max(0, Math.min(64, ipNum('ip-lm-margin', p.lightmapPackMargin)));
    p.animationType     = ipText('ip-anim-type-rig') || p.animationType;
    p.skinWeights       = parseInt(ipText('ip-skin-weights'), 10) || p.skinWeights;
    // emplacements de matériaux : un select par matériau du fichier
    if(!p.materials) p.materials = {};
    inspBody.querySelectorAll('select[data-slot]').forEach(function(s){
      if(s.value) p.materials[s.dataset.slot] = s.value;
      else delete p.materials[s.dataset.slot];
    });
    if(before !== signatureFormModel(p)){ buildInspectorAsset(a); return; }
  }
  else if(a.kind === 'texture'){
    const avant = p.type + '/' + p.spaceColor;
    p.type          = ipText('ip-type') || p.type;
    p.spaceColor = ipText('ip-srgb') || p.spaceColor;
    p.sizeMax     = Math.max(0, ipNum('ip-taillemax', p.sizeMax));
    p.repetition    = ipText('ip-repetition') || p.repetition;
    p.tuilage       = [Math.max(0.01, ipNum('ip-tu', p.tuilage[0])),
                       Math.max(0.01, ipNum('ip-tv', p.tuilage[1]))];
    p.filtrage      = ipText('ip-filtrage') || p.filtrage;
    p.mipmaps       = ipChecked('ip-mipmaps', p.mipmaps);
    p.anisotropy   = Math.max(1, ipNum('ip-aniso', p.anisotropy));
    p.invertY     = ipText('ip-flip') || p.invertY;
    // type et espace de couleur changent le libellé de « auto » et l'avertissement de pipeline
    if(avant !== p.type + '/' + p.spaceColor){ buildInspectorAsset(a); return; }
  }
  else if(a.kind === 'audio'){
    p.volume  = Math.max(0, Math.min(1, ipNum('ip-volume', p.volume)));
    p.loop  = ipChecked('ip-boucle', p.loop);
    p.spatial = ipChecked('ip-spatial', p.spatial);
    p.range  = Math.max(0.1, ipNum('ip-portee', p.range));
    p.pitch   = Math.max(0.1, ipNum('ip-pitch', p.pitch));
  }
  updateStatesFieldsImport(a);
  refreshStateApply(a);
}

/** Les réglages dont le changement REFAIT le panneau (libellés, notes, champs conditionnels). */
export function signatureFormModel(p){
  return [p.preserveHierarchy, p.sortHierarchy, p.convertUnits, p.normals, p.normalsMode,
          p.tangents, p.lightmapUv, p.animationType, p.skinWeights, p.smoothnessSource,
          p.rootNode, p.avatarDefinition, p.importAnimation, p.animCompression,
          JSON.stringify((p.clips || []).map(function(c){
            return [c.name, c.take, Array.isArray(c.maskBones)]; }))].join('|');
}

/** Recale les boutons d'application sans reconstruire le panneau (le focus resterait volé). */
export function refreshStateApply(a){
  const dirty = importDirty(a);
  ipDisable('ip-apply', !dirty);
  ipDisable('ip-revert', !dirty);
}

// matériau : l'inspecteur EST l'éditeur, les champs s'appliquent au fil de l'eau
export function applyFormMaterial(a){
  // Changement de shader : reconstruit tout le panneau (les propriétés PBR et les
  // propriétés exposées ne coexistent jamais) — traité à part, avant tout le reste.
  const elShader = document.getElementById('ip-mat-shader');
  if(elShader){
    const newShaderId = elShader.value || null;
    if(newShaderId !== (a.shaderId || null)){
      const shaderAsset = newShaderId ? assets.find(function(x){ return x.id === newShaderId; }) : null;
      if(shaderAsset) assignShaderOnMaterial(a, shaderAsset);
      else {
        pushHistory();
        a.shaderId = null;
        a.valuesParams = {};
        applyMaterialEverywhere(a);
      }
      buildInspectorAsset(a);
      return;
    }
  }
  if(a.shaderId){
    const shaderAsset = assets.find(function(x){ return x.id === a.shaderId; });
    a.valuesParams = a.valuesParams || {};
    propertiesExposedOfShader(shaderAsset).forEach(function(p){
      const id = 'ip-shp-' + p.name;
      if(p.type === 'vec3'){
        const ex = document.getElementById(id + '-x');
        if(!ex) return;
        a.valuesParams[p.name] = {x:Number(ex.value) || 0,
          y:Number(document.getElementById(id + '-y').value) || 0,
          z:Number(document.getElementById(id + '-z').value) || 0};
        return;
      }
      const el = document.getElementById(id);
      if(!el) return;
      a.valuesParams[p.name] = (p.type === 'color' || p.type === 'texture') ? (el.value || null) : Number(el.value);
    });
    applyMaterialEverywhere(a);
    setStatus('Matériau « ' + a.name + ' » mis à jour', 2000);
    return;
  }
  const p = ensurePropsMaterial(a);
  const mappeBefore = JSON.stringify(channelsMapped(p));
  const avaitEmissiveMap = !!p.emissiveAsset;
  const modeHeightBefore = p.heightMode;
  // Toutes les propriétés sont lues par la table déclarative (js/material-props.js) :
  // types, plages et bornage y vivent une seule fois, et un champ absent du DOM n'écrase
  // rien — c'est ce qui laisse une propriété masquée garder sa valeur. Restent ici les
  // emplacements de texture, qui passent par donnees-tex-slot.
  // La table doit être EXACTEMENT celle qui a produit le formulaire : relire un matériau de
  // plugin avec la table native ne lèverait rien, ne trouverait aucun de ses champs, et
  // rendrait le formulaire inert — chaque saisie perdue en silence.
  readPropsMaterialFromDom(p, tablePropsMaterialOrNative(p));
  inspBody.querySelectorAll('select[data-tex-slot]').forEach(function(s){
    p[s.dataset.texSlot] = s.value || null;
  });
  // Pas de garde ici pour un masque fraîchement branché : ensurePropsMaterial a déjà
  // posé le défaut natif ('orm') en tête de fonction, à un moment où combineAsset était
  // encore nul — donc son fichiert « masque sans empaquetage = HDRP » n'a pas pu se
  // déclencher. Le champ n'est jamais indéfini en sortant d'ici.
  adjustEmissiveByMap(p, avaitEmissiveMap);
  applyMaterialEverywhere(a);
  setStatus('Matériau « ' + a.name + ' » mis à jour', 2000);
  // Brancher ou débrancher une map change l'état des champs (intensités grisées, émissif
  // passé au blanc) : le panneau doit être reconstruit. Seulement dans ce cas —
  // reconstruire à chaque « change » volerait le focus des champs numériques.
  // Le mode de hauteur count aussi : passer en Déplacement fait apparaître
  // l'avertissement sur le maillage subdivisé, et l'enlever le fait disparaître. Sans
  // cette condition, l'avertissement resterait affiché après un retour en Relief.
  if(JSON.stringify(channelsMapped(p)) !== mappeBefore
     || avaitEmissiveMap !== !!p.emissiveAsset
     || modeHeightBefore !== p.heightMode)
    buildInspectorAsset(a);
}

// ---------- Un instantané d'historique par PRISE DE FOCUS, pas un par frappe ----------
//
// Sans coalescence, renommer « sol » en « sol de pierre » empilerait treize pas : Ctrl+Z rendrait
// les caractères un par un, et treize gestes plus tard l'historique de la SCÈNE aurait été chassé
// de la pile, qui est bornée à 50. Une rafale de frappe est un seul geste — c'est déjà ainsi que
// fonctionne l'inspecteur d'objets (js/inspector.js), et on reprend son patron.
//
// C'EST CE PAS QUI REND LA PHOTO DES CHAMPS D'ASSET SÛRE, et il devait donc venir avant elle. Tant
// qu'il n'existait pas, capturer le nom d'un asset dans l'instantané aurait fait undo un
// renommage que rien n'avait enregistré : Ctrl+Z aurait détruit du travail au lieu d'en défaire.
export let assetHistoTaken = true;
/**
 * Les saisies et clics de l'inspecteur d'asset. Appelée par `startup.js`.
 *
 * Différée pour la même raison que `bindEditorInput` : `inspBody` est un `const` de
 * `js/inspector.js`, et ce fichier est dans un cycle d'imports avec lui. Le câblage au
 * premier niveau ne tenait que par l'ordre des <script>, pas par le graphe de modules.
 */
export function bindAssetInspectorInput(){
  inspBody.addEventListener('focusin', function(){ if(assetSelected) assetHistoTaken = false; });

  /** Empile un pas si la rafale en cours n'en a pas encore posé. */
  function histoAssetTimes(){
    if(assetHistoTaken) return;
    pushHistory();
    assetHistoTaken = true;
  }

  inspBody.addEventListener('change', function(e){
    const a = assetSelected;
    if(!a || !e.target.id || e.target.id.indexOf('ip-') !== 0) return;
    if(e.target.id === 'ip-name') return;   // traité à l'input
    if(e.target.id === 'ip-uvset') return;  // une vue, pas un réglage (écouteur plus bas)
    // Les paramètres d'import ne posent PAS de pas d'historique à la frappe : rien n'est
    // appliqué avant « Appliquer », et c'est lui qui en pose un (applyDraft).
    if(IMPORT_DEFAULT[a.kind]){ readFormImport(a); return; }
    histoAssetTimes();
    if(a.kind === 'material') applyFormMaterial(a);
    else if(a.kind === 'animation') applyFormAnimation(a);
    else if(a.kind === 'sprite'){ applyFormSprite(a); buildInspectorAsset(a); }
  });

  inspBody.addEventListener('input', function(e){
    const a = assetSelected;
    if(!a || e.target.id !== 'ip-name') return;
    const name = ipText('ip-name');
    if(name && name.trim()){
      histoAssetTimes();
      a.name = name.trim();
      updateProject();
    }
  });

  // LE RENOMMAGE. Le titre bascule en champ de saisie au double-clic, comme dans la
  // hiérarchie ; la frappe est déjà lue par l'écouteur `input` ci-dessus (id `ip-name`).
  inspBody.addEventListener('dblclick', function(e){
    const a = assetSelected;
    if(!a || !e.target.closest || !e.target.closest('#ip-head-name')) return;
    startRenameAsset(a);
  });
  inspBody.addEventListener('keydown', function(e){
    if(e.target.id !== 'ip-name') return;
    if(e.key === 'Enter'){ e.target.blur(); return; }
    // Échap rend le nom d'avant : un renommage d'asset ne se retrouve pas à l'œil dans
    // l'historique, et c'est le geste qu'on veut pouvoir annuler sans réfléchir.
    if(e.key === 'Escape'){
      const a = assetSelected;
      if(a && e.target.dataset.before){ a.name = e.target.dataset.before; updateProject(); }
      e.target.blur();
    }
  });
  inspBody.addEventListener('focusout', function(e){
    if(e.target.id !== 'ip-name') return;
    // LE RENOMMAGE EST VALIDÉ : le disque suit, une seule fois. Le nom de fichier de la moitié
    // des genres est `slugFile(a.name)` — sans ceci, l'ancien fichier resterait et reviendrait
    // en DOUBLE au rafraîchissement suivant (voir reconcileDiskPaths, js/assets.js).
    if(snapshotRenameAsset){
      const avant = snapshotRenameAsset;
      snapshotRenameAsset = null;
      reconcileDiskPaths(avant).catch(function(err){
        setStatus('Asset renommé dans le projet, mais le disque n\'a pas suivi : ' + err.message
          + ' — « Rafraîchir » peut faire apparaître des assets en double', 8000);
      });
    }
    if(assetSelected) buildInspectorAsset(assetSelected);   // le titre reprend sa place
  });

  inspBody.addEventListener('click', function(e){
    const a = assetSelected;
    if(!a) return;
    // LES ONGLETS N'ONT PAS D'ID, seulement un `data-tab` : la garde `!e.target.id` juste en
    // dessous les avalait en silence, et cliquer « Rig » ou « Matériaux » ne faisait rien.
    const tab = e.target.dataset && e.target.dataset.tab;
    if(tab){ a._tab = tab; buildInspectorAsset(a); return; }
    // L'onglet Animation : même raison, ses lignes n'ont qu'un `data-*`.
    const clipSel = e.target.dataset && e.target.dataset.clipSel;
    if(clipSel !== undefined && a.kind === 'model'){
      a._clipSel = parseInt(clipSel, 10) || 0;
      buildInspectorAsset(a);
      return;
    }
    const evDel = e.target.dataset && e.target.dataset.evDel;
    if(evDel !== undefined && a.kind === 'model'){
      const c = (paramsShown(a).clips || [])[a._clipSel || 0];
      if(c && typeof removeMarker === 'function'){
        pushHistory();
        removeMarker(a, c.take, parseInt(evDel, 10));
        buildInspectorAsset(a);
      }
      return;
    }
    if(!e.target.id) return;
    if(e.target.id === 'ip-copy-path'){
      const rel = pathFolderAsset(a);
      copyToClipboard(rel);
      setStatus('Chemin copié : ' + rel, 2500);
      return;
    }
    if(e.target.id === 'ip-copy-fullpath'){
      const full = fullPathAsset(a);
      if(!full) return;             // racine refusée : rien n'a été copié, et c'est voulu
      copyToClipboard(full);
      setStatus('Chemin complet copié : ' + full, 3500);
      return;
    }
    if(e.target.id === 'ip-presets'){ modalImportPresets(a); return; }
    if(e.target.id === 'ip-listen'){ togglePreviewAudio(a); return; }
    if(e.target.id === 'ip-extract'){ extractMaterialsModel(a); return; }
    if(e.target.id === 'ip-anim-open'){
      if(anim.assetClip === a.id) closeClipAsset();
      else openClipAsset(a);
      buildInspectorAsset(a);
      return;
    }
    if(e.target.id === 'ip-edit'){
      if(a.kind === 'script') openEditorScriptAsset(a);
      else if(a.kind === 'graphShader') openEditorGraphShader(a);
      else if(a.kind === 'postProfile') openEditorPostProfile(a);
      else if((a.kind === 'sfx' || a.kind === 'musicLoop') && typeof globalThis.openSoundRack === 'function') globalThis.openSoundRack(a);
      else if(a.kind === 'tilePalette' && typeof globalThis.openWindowPalette === 'function'){
        globalThis.openWindowPalette(a);
      }
      return;
    }
    if(e.target.id === 'ip-sp-add-sequence'){
      const regions = a.regions || [];
      const name = (a._sN || '').trim();
      const d = Math.max(0, Math.round(a._sD || 0));
      const nb = Math.max(1, Math.round(a._sCount || 1));
      if(!name){ setStatus('Donnez un nom à la suite : c\'est lui que les scripts joueront.', 5000); return; }
      if(sequenceByName(a.sequences, name)){
        setStatus('Une suite « ' + name + ' » existe déjà dans cette planche.', 5000);
        return;
      }
      // La plage est bornée à ce qui EXISTE plutôt que refusée : une suite de 8 images demandée sur
      // une planche qui en a 6 en donne 6, ce qui se voit et se corrige. La refuser obligerait à
      // compter les images à la main avant chaque ajout.
      const choisies = regions.slice(d, d + nb).map(function(r){ return r.name; });
      if(!choisies.length){
        setStatus('Aucune image à partir de la n°' + d + ' : cette planche en a ' + regions.length + '.', 6000);
        return;
      }
      pushHistory();
      a.sequences = (a.sequences || []).concat([{name: name, images: choisies,
                                           ips: Math.max(1, a._sIps || 12), loop: a._sB !== false,
                                           events: []}]);
      a._sN = '';
      a._sD = d + choisies.length;          // la suite suivante commence là où celle-ci s'arrête
      updateProject();
      buildInspectorAsset(a);
      setStatus('Suite « ' + name + ' » : ' + choisies.length + ' image(s), '
        + (choisies.length / Math.max(1, a._sIps || 12)).toFixed(2) + ' s', 4000);
      return;
    }
    if(e.target.dataset && e.target.dataset.sequenceDel !== undefined){
      const i = parseInt(e.target.dataset.sequenceDel, 10);
      const s = (a.sequences || [])[i];
      if(!s) return;
      pushHistory();
      a.sequences.splice(i, 1);
      updateProject();
      buildInspectorAsset(a);
      setStatus('Suite « ' + s.name + ' » supprimée', 3000);
      return;
    }
    if(e.target.id === 'ip-sp-atlas'){
      modalAtlasSprite(a);
      return;
    }
    if(e.target.id === 'ip-sp-slice'){
      const tex = assets.find(function(x){ return x.id === a.textureId; });
      const dims = dimensionsTexture(tex);
      const regions = sliceGrid(dims.l, dims.h, a._decL || 16, a._decH || 16,
        {marge: a._decM || 0, spacing: a._decE || 0, prefixe: 'img'});
      if(!regions.length){
        setStatus('Cette grille ne donne aucune image : la cellule est plus grande que la texture, '
          + 'ou la marge la déborde.', 6000);
        return;
      }
      pushHistory();
      a.regions = regions;
      // LE PPU SE DÉCIDE SUR LA CELLULE, PAS SUR LA PLANCHE. `ppuByDefault` répond « est-ce du
      // pixel-art ? » ; posé sur la planche entière il se trompe sur toute vraie feuille de
      // sprites — mesuré : 8 images de 24 px font 192 px de large, donc au-delà du seuil, donc
      // ppu 100 et un personnage affiché six fois trop petit, sans un mot. On ne réaims que le
      // défaut qu'on a choisi soi-même : un ppu réglé à la main n'est jamais touché.
      let note = '';
      if(typeof ppuByDefault === 'function'){
        const defaultSheet = ppuByDefault(dims.l, dims.h);
        const defaultCell = ppuByDefault(a._decL || 16, a._decH || 16);
        if(Number(a.ppu) === defaultSheet && defaultCell !== defaultSheet){
          a.ppu = defaultCell;
          note = ' — pixels par unité passés à ' + defaultCell + ' (taille de la cellule)';
        }
      }
      refreshSpritesOfLAsset(a);
      updateProject();
      buildInspectorAsset(a);
      setStatus(regions.length + ' image(s) découpée(s) dans « ' + a.name + ' »' + note, 4500);
      return;
    }
    if(e.target.id === 'ip-sp-merge'){
      const tex = assets.find(function(x){ return x.id === a.textureId; });
      const dims = dimensionsTexture(tex);
      if(!(dims.l > 0)) return;
      pushHistory();
      a.regions = [{name:'image', x:0, y:0, l:dims.l, h:dims.h}];
      refreshSpritesOfLAsset(a);
      updateProject();
      buildInspectorAsset(a);
      return;
    }
    if(e.target.id === 'ip-open-model' && a.kind === 'animation' && a.embedded){
      const model = assets.find(function(x){ return x.id === a.embedded; });
      if(!model) return;
      const clips = (model.paramsImport && model.paramsImport.clips) || [];
      model._tab = 'animation';
      model._clipSel = Math.max(0, clips.findIndex(function(c){ return c.id === a.id; }));
      delete model._sub;
      selectAsset(model);
      return;
    }
    if(e.target.id === 'ip-mat-remap' && a.kind === 'model'){
      const n = searchAndRemapMaterials(a, a._matSearch || 'local');
      buildInspectorAsset(a);
      setStatus(n ? n + ' emplacement(s) remappé(s) — « Appliquer » pour valider'
        : 'Aucun matériau du projet ne porte le nom d\'un emplacement', 4000);
      return;
    }
    if(e.target.id === 'ip-extract-tex' && a.kind === 'model'){
      extractTexturesModel(a).then(function(n){
        setStatus(n ? n + ' texture(s) extraite(s) dans « ' + (a.folder || 'la racine') + ' »'
          : 'Ce fichier n\'embarque aucune texture lisible', 4000);
        buildInspectorAsset(a);
      });
      return;
    }
    if(e.target.id === 'ip-avatar-config'){ modalAvatarConfig(a); return; }
    if(e.target.id === 'ip-clip-add' && a.kind === 'model'){
      const p = ensureDraft(a);
      const clips = clipsDraftOf(a, p);
      const cur = clips[a._clipSel || 0];
      const takes = a.animationsBrutes || (a.template && a.template.animations) || [];
      const take = cur ? cur.take : (takes[0] && takes[0].name);
      if(!take) return;
      clips.push(Object.assign({id: newClipId(), name: take + ' ' + (clips.length + 1), take: take},
        (typeof CLIP_SETTINGS_DEFAULT !== 'undefined') ? CLIP_SETTINGS_DEFAULT : {}));
      a._clipSel = clips.length - 1;
      buildInspectorAsset(a);
      return;
    }
    if(e.target.id === 'ip-clip-del' && a.kind === 'model'){
      const p = ensureDraft(a);
      const clips = clipsDraftOf(a, p);
      if(!clips.length) return;
      clips.splice(a._clipSel || 0, 1);
      a._clipSel = Math.max(0, (a._clipSel || 0) - 1);
      buildInspectorAsset(a);
      return;
    }
    if((e.target.id === 'ip-mask-all' || e.target.id === 'ip-mask-none') && a.kind === 'model'){
      const c = (ensureDraft(a).clips || [])[a._clipSel || 0];
      if(!c) return;
      c.maskBones = e.target.id === 'ip-mask-all' ? bonesOfModel(a).map(function(b){ return b.name; }) : [];
      buildInspectorAsset(a);
      return;
    }
    if(e.target.id === 'ip-ev-add' && a.kind === 'model'){
      const c = (paramsShown(a).clips || [])[a._clipSel || 0];
      if(!c || typeof setMarker !== 'function') return;
      pushHistory();
      setMarker(a, c.take, Math.max(0, ipNum('ip-ev-t', 0)), (ipText('ip-ev-name') || '').trim() || 'événement');
      buildInspectorAsset(a);
      return;
    }
    if(e.target.id === 'ip-goto-anim' && a.kind === 'model'){
      a._tab = 'animation';
      a._clipSel = parseInt(e.target.dataset.clip, 10) || 0;
      delete a._sub;
      buildInspectorAsset(a);
      updateProject();
      return;
    }
    if(e.target.id === 'ip-avatar-detect'){
      // L'Avatar n'est pas un paramètre d'import : il se corrige tout de suite, sans « Appliquer ».
      pushHistory();
      a.avatar = autoMapAvatar(a.template);
      buildInspectorAsset(a);
      setStatus('Avatar redétecté sur « ' + a.name + ' »', 2500);
      return;
    }
    if(e.target.id === 'ip-apply'){ applyDraft(a); return; }
    if(e.target.id === 'ip-revert'){
      discardDraft(a);
      buildInspectorAsset(a);
      setStatus('Réglages de « ' + a.name + ' » revenus aux valeurs appliquées', 2500);
      return;
    }
    if(e.target.id === 'ip-preview-left' || e.target.id === 'ip-preview-right'){
      const i = ANGLES_PREVIEW.indexOf(a._previewAngle || 0);
      const pas = (e.target.id === 'ip-preview-right') ? 1 : -1;
      a._previewAngle = ANGLES_PREVIEW[(i + pas + ANGLES_PREVIEW.length) % ANGLES_PREVIEW.length];
      buildInspectorAsset(a);
      return;
    }
    if(e.target.id === 'ip-reset'){
      // « Par défaut » remplit le BROUILLON : comme tout le reste du panneau, il ne touche rien
      // tant qu'on n'a pas appliqué. C'est le geste qu'on regrette le plus vite.
      const before = paramsShown(a) || {};
      a.paramsDraft = JSON.parse(JSON.stringify(IMPORT_DEFAULT[a.kind]));
      // Les emplacements de matériaux et la liste des clips nomment les parties d'UN fichier :
      // les remettre « par défaut » effacerait des affectations et des identités, pas des réglages.
      if(a.kind === 'model'){
        a.paramsDraft.materials = JSON.parse(JSON.stringify(before.materials || {}));
        if(Array.isArray(before.clips)) a.paramsDraft.clips = JSON.parse(JSON.stringify(before.clips));
      }
      buildInspectorAsset(a);
      setStatus('Valeurs par défaut posées — « Appliquer » pour les valider', 3500);
    }
  });

  // Le jeu d'UV montré : un select de plus dans le panneau, mais qui ne règle RIEN — c'est une
  // vue. Il est donc traité ici et pas dans la lecture du formulaire.
  inspBody.addEventListener('change', function(e){
    const a = assetSelected;
    if(!a || e.target.id !== 'ip-uvset') return;
    a._uvSet = e.target.value;
    refreshUvPreview(a);
  });
}


// ---------- Glisser-déposer d'une tile du projet sur un emplacement ----------
// Emplacements de matériaux d'un modèle (data-slot) et maps d'un matériau
// (data-tex-slot) : mêmes gestes que le dépôt d'un asset dans la vue.
export function slotRepo(target){
  const line = (target && target.closest) ? target.closest('.ip-slot') : null;
  if(!line) return null;
  const sel = line.querySelector('select');
  if(!sel) return null;
  return {line:line, select:sel, kind: sel.dataset.texSlot ? 'texture' : 'material'};
}

export function assetOfRepo(e){
  const id = e.dataTransfer ? e.dataTransfer.getData('text/asset') : '';
  if(id){
    const a = assets.find(function(x){ return x.id === id; });
    if(a) return a;
  }
  return assetInDrag || null;   // dragover n'expose pas encore les données
}

/**
 * Le dépôt d'un asset dans un slot de l'inspecteur d'asset. Appelée par `startup.js`.
 *
 * Différée pour la même raison que `bindEditorInput` : `inspBody` est un `const` de
 * `js/inspector.js`, et ce fichier est dans un cycle d'imports avec lui. Le câblage au
 * premier niveau ne tenait que par l'ordre des <script>, pas par le graphe de modules.
 */
export function bindAssetSlotDrop(){
  bindTextureThumbs(inspBody);   // la miniature d'un emplacement suit le choix
  inspBody.addEventListener('dragover', function(e){
    const s = slotRepo(e.target);
    if(!s || !assetSelected || !assetInDrag || assetInDrag.kind !== s.kind) return;
    e.preventDefault();
    inspBody.querySelectorAll('.ip-slot.hover').forEach(function(x){ x.classList.remove('hover'); });
    s.line.classList.add('hover');
  });

  inspBody.addEventListener('dragleave', function(e){
    const s = slotRepo(e.target);
    if(s) s.line.classList.remove('hover');
  });

  inspBody.addEventListener('drop', function(e){
    const s = slotRepo(e.target);
    if(!s || !assetSelected) return;
    e.preventDefault();
    s.line.classList.remove('hover');
    const dep = assetOfRepo(e);
    if(!dep) return;
    if(dep.kind !== s.kind){
      setStatus('Déposez ' + (s.kind === 'texture' ? 'une texture' : 'un matériau')
        + ' sur cet emplacement', 3000);
      return;
    }
    s.select.value = dep.id;
    // Un dépôt n'a PAS pris le focus : la coalescence n'a donc rien posé, et sans ce pas explicite
    // affecter un matériau à un emplacement resterait le seul geste du panneau qui ne s'annule pas.
    pushHistory();
    if(assetSelected.kind === 'material') applyFormMaterial(assetSelected);
    else readFormImport(assetSelected);
    buildInspectorAsset(assetSelected);
    setStatus('« ' + dep.name + ' » affecté à l\'emplacement '
      + (s.select.dataset.slot || s.select.dataset.texSlot), 2500);
  });
}


// EXPOSÉ EN GLOBALE, à dessein. Ces symboles sont appelés depuis des fichiers
// que les mêmes pages ne chargent pas toutes : un `import` y pointerait un
// fichier absent, et la page ne démarrerait pas. Ils gardent donc leur garde
// `typeof` côté appelant, et se déclarent ici.
globalThis.UNITS_METER = UNITS_METER;
globalThis.ipCell = ipCell;
globalThis.ipChecked = ipChecked;
globalThis.ipColor = ipColor;
globalThis.ipNum = ipNum;
globalThis.ipNumber = ipNumber;
globalThis.ipSelect = ipSelect;
globalThis.ipText = ipText;
globalThis.ipTwoNumbers = ipTwoNumbers;
globalThis.outputSrgb = outputSrgb;