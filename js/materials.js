// ---------- Assets matériaux : créer, configurer, affecter ----------
// Un matériau est un asset partagé (🎨 dans le panneau Projet). On le glisse sur un
// objet (primitive OU modèle importé) pour l'affecter ; l'objet garde userData.materiauId.
// Éditer l'asset met à jour TOUS les objets qui l'utilisent (comme dans Unity/Godot).
// L'ÉDITEUR TRAVAILLE EN LISSAGE (smoothness), pas en rugosité : `smoothing` = 1 pour un
// miroir, 0 pour un mat parfait. C'est la convention d'Unity, celle dans laquelle sont
// peintes les textures de la plupart des pipelines, et c'est déjà celle du canal alpha du
// masque combiné — avoir un curseur en rugosité en face d'un masque en lissage obligeait à
// faire la soustraction de tête. three, lui, ne connaît que `roughness` : la conversion
// (1 − lissage) est faite au seul endroit où le matériau three est fabriqué, ci-dessous.
import { assetId, assets, folderCurrent, nextAssetId, previewObject3D, updateProject } from './assets.js';
import { logConsole } from './console.js';
import { setStatus } from './hierarchy.js';
import { pushHistory } from './history.js';
import { configureTexture, ensureParamsImport, refreshModelsOfMaterial } from './import-settings.js';
import { buildInspector } from './inspector.js';
import { isSceneObject, listMats, objects } from './objects.js';
import { makeMaterialPlugin, materialPluginOf } from './plugins.js';
import { applyProbes } from './probes.js';
import { applyFilters, renderer } from './scene.js';
import { selectAsset, selection } from './selection.js';

export const MATERIAL_DEFAULT = {
  color:'#8899aa', smoothness:0.45, metal:0.1, emissive:'#000000', opacity:1,
  doubleSided:false, tiling:[1, 1], offset:[0, 0],
  // maps PBR : chacune référence une texture du panneau Projet (ou null)
  texAsset:null,          // albedo (couleur de base)
  normalAsset:null, normalIntensity:1,
  // Convention de la map de normales. glTF, three et OpenGL veulent le vert vers le
  // HAUT ; DirectX le veut vers le bas, et Substance exporte les deux selon le
  // préréglage. Les deux images sont valides et ne diffèrent que par ce canal : branchée
  // sans correction, une normale DirectX transforme les bosses en creux, et rien ne le
  // signale. La correction est une négation de normalScale.y, faite à la fabrication.
  normalDirectX:false,
  // Une map séparée reste encodée en RUGOSITÉ : c'est ce que lit three, et c'est ce que
  // produisent les suffixes _R / _Roughness. Le lissage, lui, vit dans l'alpha du masque
  // combiné ci-dessous.
  roughnessAsset:null,     // roughness map (canal vert)
  metalAsset:null,        // metalness map (canal bleu)
  aoAsset:null, aoIntensity:1,
  // Carte de hauteur. three N'A PAS de parallaxe — le « Height Map » d'Unity décale les
  // UV dans le shader, three ne sait pas le faire nativement. Il offre deux autres
  // choses, qui ne sont pas la même et qu'on expose donc explicitement plutôt que d'en
  // choisir une en silence :
  //   'relief'      → bumpMap : des normales dérivées de la hauteur. Marche sur
  //                   N'IMPORTE QUELLE géométrie, effet visible tout de suite, mais la
  //                   silhouette de l'objet ne bouge pas.
  //   'move' → displacementMap : les sommets bougent VRAIMENT, la silhouette
  //                   change — mais il faut un maillage subdivisé, sinon il ne se pass
  //                   rien (ou n'importe quoi) et l'utilisateur croit que c'est cassé.
  heightAsset:null, heightMode:'relief', heightIntensity:1,
  // ÉCLAIRAGE PRÉCALCULÉ (lightmap). On ne CUIT pas de lightmap ici : on accepte celles
  // cuites ailleurs — Blender le fait très bien, et exporte le second game d'UV dans le
  // glTF. Vérifié : un TEXCOORD_1 ressort bien en `uv1` sur la géométrie, distinct de `uv`.
  //
  // `lightmapUv` vaut 1 par convention (un dépliage de lightmap ne réutilise jamais les UV
  // de texture, qui se chevauchent), mais reste réglable : une lightmap peinte à la main
  // sur le premier jeu existe aussi.
  lightmapAsset:null, lightmapIntensity:1, lightmapUv:1,
  emissiveAsset:null,
  // Masque combiné, prioritaire sur rugositeAsset/metalAsset/aoAsset.
  combineAsset:null,
  // Empaquetage des canaux du masque. NOTRE CONTRAT NATIF EST 'orm' — la convention
  // glTF de Khronos, qui est une norme ouverte et non le format d'un moteur, et que
  // three lit DIRECTEMENT (aoMap ← R, roughnessMap ← G, metalnessMap ← B). C'est aussi
  // ce que produisent Blender, Substance et tout export glTF.
  // Les autres valeurs existent pour accueillir un asset venu d'ailleurs sans obliger
  // l'artiste à repasser par son logiciel : elles sont converties à la volée.
  //   'orm'   R occlusion · G rugosité · B métal          (glTF/Khronos — natif, aucune conversion)
  //   'unity' R métal     · G occlusion · A lissage       (mask map HDRP)
  combinePacking:'orm'
};

// Convertit un masque NON natif vers l'ORM de glTF, une seule fois, en hidden par
// (texture, empaquetage). Le chemin 'orm' ne passe jamais ici : c'est tout l'intérêt
// d'avoir pris la norme ouverte comme contrat — pas de passe CPU, pas de copie en
// mémoire, la texture part telle quelle au GPU.
export const cacheCombined = new Map();
export const CONVERSIONS_MASK = {
  // mask map HDRP → ORM. L'alpha est en LISSAGE : l'inversion vers la rugosité
  // attendue par three se fait ici, et nulle part ailleurs.
  unity: function(px){
    for(let i = 0; i < px.length; i += 4){
      const metal = px[i], ao = px[i+1], smoothness = px[i+3];
      px[i]     = ao;             // R ← occlusion
      px[i+1]   = 255 - smoothness;  // G ← rugosité = 1 − lissage
      px[i+2]   = metal;          // B ← métal
      px[i+3]   = 255;
    }
  }
};

export function canvasCombined(ta, packing){
  const key = ta.id + '|' + packing;
  if(cacheCombined.has(key)) return cacheCombined.get(key);
  const img = ta.texture.image;
  if(!img || !img.width) return null;
  const cv = document.createElement('canvas');
  cv.width = img.width;
  cv.height = img.height;
  const cx = cv.getContext('2d');
  cx.drawImage(img, 0, 0);
  const data = cx.getImageData(0, 0, cv.width, cv.height);
  CONVERSIONS_MASK[packing](data.data);
  cx.putImageData(data, 0, 0);
  cacheCombined.set(key, cv);
  return cv;
}

export function textureCombined(assetId, p){
  if(!assetId) return null;
  const ta = assets.find(function(x){ return x.id === assetId && x.kind === 'texture'; });
  if(!ta) return null;
  const packing = p.combinePacking || 'orm';

  // Chemin natif : la texture est DÉJÀ dans la convention que three attend.
  if(!CONVERSIONS_MASK[packing]) return textureMaterial(assetId, p);

  const cv = canvasCombined(ta, packing);
  if(!cv) return null;
  const tex = new THREE.CanvasTexture(cv);
  // répétition/filtrage viennent des paramètres d'import de la texture source ;
  // le tuilage, lui, est celui du matériau
  tex.userData = {assetTexture:ta.id, tuilageMaterial:true};
  configureTexture(tex, ensureParamsImport(ta), {tuilage:false});
  tex.repeat.set(p.tiling[0], p.tiling[1]);
  tex.offset.set(p.offset[0], p.offset[1]);
  return tex;
}

// Complète les props MANQUANTES, SUR PLACE. L'objet renvoyé est toujours `a.props`
// lui-même : l'ancienne version en fabriquait un neuf à chaque appel, si bien qu'une
// poignée gardée en variable devenait muette dès que quelque chose reconstruisait le
// matériau entre-temps (makeMaterialThree appelle cette fonction). Écrire dans
// cette poignée ne changeait alors plus rien, sans erreur.
export function ensurePropsMaterial(a){
  const p = a.props || (a.props = {});
  // Filet de sécurité : un matériau qui porte encore l'ancienne `rugosite` pass en
  // `smoothing`. Les projets versionnés sont convertis par la migration 7 → 8
  // (serialization.js) ; celui-ci rattrape les chemins non versionnés — scène `.s3d`
  // legacy, prefab collé depuis un ancien presse-papiers, plugin écrit avant le
  // changement. Idempotent : après un passage, `rugosite` n'existe plus.
  if(p.roughness !== undefined){
    if(p.smoothness === undefined) p.smoothness = invert01(p.roughness);
    delete p.roughness;
  }
  // Même filet pour l'empaquetage du masque. Un matériau qui porte un masque combiné
  // SANS dire lequel a forcément été peint avant l'existence du champ, donc dans
  // l'unique convention qu'on acceptait alors : celle de HDRP. Le défaut 'orm' ne doit
  // surtout pas s'apply à lui — il changerait son aspect sans un mot.
  // Les projets versionnés passent par la migration 8 → 9 ; ceci rattrape le reste
  // (scène .s3d legacy, prefab d'un ancien presse-papiers, plugin). Idempotent.
  if(p.combineAsset && p.combinePacking === undefined) p.combinePacking = 'unity';
  Object.keys(MATERIAL_DEFAULT).forEach(function(k){
    if(p[k] === undefined) p[k] = JSON.parse(JSON.stringify(MATERIAL_DEFAULT[k]));
  });
  // Matériau de plugin : ses propres défauts EN PLUS des natifs, jamais à leur place. Les
  // clés natives restent posées parce que le reste du moteur les lit sans se demander qui
  // fabrique le matériau — `tiling`/`decalage` servent au résolveur de textures que les
  // plugins réutilisent, et l'asset doit rester cohérent si on retire le plugin.
  // `typeof` plutôt qu'un appel direct : plugins.js est chargé APRÈS ce fichier, et rien
  // n'oblige une page qui inclut materials.js à inclure aussi le système de plugins.
  if(p.materialPlugin && typeof materialPluginOf === 'function'){
    const def = materialPluginOf(p);
    if(def) Object.keys(def.defaults).forEach(function(k){
      if(p[k] === undefined) p[k] = JSON.parse(JSON.stringify(def.defaults[k]));
    });
  }
  return p;
}

export function assetMaterialOf(o){
  if(!o || !o.userData.materialId) return null;
  return assets.find(function(a){
    return a.id === o.userData.materialId && a.kind === 'material';
  }) || null;
}

// texture du projet préparée avec le tuilage/décalage du matériau (ou null)
export function textureMaterial(assetId, p){
  if(!assetId) return null;
  const ta = assets.find(function(x){ return x.id === assetId && x.kind === 'texture'; });
  if(!ta) return null;
  const tex = ta.texture.clone();
  tex.userData = {assetTexture:ta.id, flipYAuto:true, tuilageMaterial:true};
  configureTexture(tex, ensureParamsImport(ta), {flipYAuto:true, tuilage:false});
  tex.repeat.set(p.tiling[0], p.tiling[1]);
  tex.offset.set(p.offset[0], p.offset[1]);
  return tex;
}

// SEUL point de conversion entre la convention de l'éditeur (lissage) et celle de three
// (rugosité). `smoothing` absent = valeur par défaut, pas 0 : un matériau incomplet doit
// ressembler au défaut, pas devenir un mat parfait.
// L'arrondi au millionième n'est pas cosmétique : `1 − 0.55` vaut 0.44999999999999996 en
// binaire, et cette valeur-là finissait écrite dans chaque project enregistré et affichée
// telle quelle dans le champ de l'inspecteur. Le pas de réglage est de 0,05.
export function invert01(v){
  return Math.round(Math.max(0, Math.min(1, 1 - v)) * 1e6) / 1e6;
}
export function roughnessFromSmoothing(smoothness){
  return invert01((smoothness === undefined || smoothness === null) ? MATERIAL_DEFAULT.smoothness : smoothness);
}
export function smoothingFromRoughness(roughness){
  return invert01((roughness === undefined || roughness === null) ? 0.55 : roughness);
}

// LE PARAMÈTRE MULTIPLIE LA MAP, canal par canal. C'est vrai gratuitement pour le métal
// (`metalnessMap × metalness`) et pour l'émissif (`totalEmissiveRadiance *= emissiveColor`,
// donc `emissiveMap × emissive`) : three les multiplie déjà, et dans le bon sens.
//
// PAS pour le lissage, et c'est le seul cas qui demande du travail. three raisonne en
// RUGOSITÉ et calcule `roughnessFactor = roughness × texel.g` — il multiplie donc deux
// rugosités. Ce qu'on veut, c'est multiplier deux LISSAGES :
//     lissage_final  = lissage_map × lissage_param
//   → rugosité_final = 1 − (1 − texel.g) × (1 − roughness)
// Aucun réglage de three ne produit cette formule : un facteur scalaire ne peut pas agir
// dans l'espace inverse du sien. Le paramètre reste dans tous les cas une valeur LUE au
// rendu, donc le curseur reste VIVANT ; repacker la texture à la place coûterait un
// passage sur chaque pixel à chaque mouvement.
//
// Elle existe en DEUX exemplaires, un par pipeline de rendu, et c'est assumé :
//   • en nœud TSL (`roughnessNode`) pour WebGPURenderer — le chemin normal, éditeur et
//     builds. `onBeforeCompile` n'y est JAMAIS appelé : il n'y a pas de GLSL à patcher.
//   • en patch GLSL (`onBeforeCompile`) pour le renderer WebGL classique, qui ne sert plus
//     qu'aux vignettes d'assets (js/assets.js).
// Les deux cohabitent sans se gêner : chaque pipeline ignore la propriété qui ne le
// concerne pas.
export const GLSL_RUG_THREE = 'roughnessFactor *= texelRoughness.g;';
export const GLSL_RUG_SMOOTHING = 'roughnessFactor = 1.0 - ( 1.0 - texelRoughness.g ) * ( 1.0 - roughness );';
export let warnedPatchSmoothing = false;
export let warnedNodeSmoothing = false;

// Version nœuds de la formule. `materialReference` est le primitif dont three se sert
// lui-même pour sa rugosité (`getFloat('roughness')` → materialReference('roughness',
// 'float') et `getTexture('roughness')` → materialReference('roughnessMap', 'texture'),
// puis `.g`) : on hérite donc de sa gestion des UV et de sa relecture du matériau à chaque
// image, au lieu de la réinventer. On remplace juste son `×` par notre formule.
export function nodeRoughnessFromSmoothings(){
  const {float, materialReference} = TSL;
  const smoothingMap = float(1).sub(materialReference('roughnessMap', 'texture').g);
  const smoothingParam = float(1).sub(materialReference('roughness', 'float'));
  return float(1).sub(smoothingMap.mul(smoothingParam));
}

export function multiplyInSmoothing(m){
  if(!m.roughnessMap) return;   // sans map, `roughness` est déjà la bonne valeur

  // Posé sur le MeshStandardMaterial classique, et c'est suffisant : NodeLibrary
  // .fromMaterial() recopie TOUTES les propriétés énumérables du matériau vers le
  // MeshStandardNodeMaterial qu'il fabrique (`for(const k in materiau) node[k] = ...`).
  if(typeof TSL !== 'undefined' && TSL && TSL.materialReference){
    m.roughnessNode = nodeRoughnessFromSmoothings();
  } else if(renderer && renderer.isWebGPURenderer
            && !warnedNodeSmoothing){
    // Ne pas se taire : c'est le silence d'un repli enfermé dans onBeforeCompile qui avait
    // laissé le lissage s'apply à l'envers pendant toute la migration WebGPU.
    warnedNodeSmoothing = true;
    logConsole('warn', 'Multiplication du lissage non appliquée : TSL est indisponible '
      + 'alors que le rendu passe par le système de nœuds. Les maps de rugosité sont '
      + 'multipliées en rugosité, comportement par défaut de three.', null);
  }

  m.onBeforeCompile = function(shader){
    if(shader.fragmentShader.indexOf(GLSL_RUG_THREE) === -1){
      // three a changé son chunk : on ne casse rien, on retombe sur SA multiplication (en
      // rugosité), et on le dit une fois — plutôt que de laisser un PBR faux en silence.
      if(!warnedPatchSmoothing){
        warnedPatchSmoothing = true;
        logConsole('warn', 'Multiplication du lissage non appliquée : le shader de three '
          + 'ne contient plus le motif attendu (' + GLSL_RUG_THREE + '). Les maps de rugosité '
          + 'sont multipliées en rugosité, comportement par défaut de three.', null);
      }
      return;
    }
    shader.fragmentShader = shader.fragmentShader.replace(GLSL_RUG_THREE, GLSL_RUG_SMOOTHING);
  };
  // Sans clé propre, three réutiliserait le programme NON patché déjà compilé pour un
  // MeshStandardMaterial équivalent : le patch n'aurait aucun effet visible.
  m.customProgramCacheKey = function(){ return 'lissage-multiply'; };
}

// Une intensité de normale ou d'AO n'a de sens QU'AVEC sa map : l'inspecteur grise ces deux
// champs quand la map manque. Le lissage, le métal et l'émissif, eux, restent actifs — ils
// multiplient leur map.
export function channelsMapped(p){
  return {
    normal: !!p.normalAsset,
    ao:      !!(p.combineAsset || p.aoAsset),
    height: !!p.heightAsset,
    lightmap: !!p.lightmapAsset
  };
}

// Une lightmap réglée sur le second game d'UV alors que le maillage n'en a pas est LE piège
// de cette fonctionnalité : three échantillonne alors des UV absentes, l'objet part en
// noir ou en bouillie, et rien ne dit pourquoi. Le cas est fréquent — toutes les primitives
// du moteur n'ont qu'un jeu d'UV, et seul un modèle exporté avec un dépliage de lightmap
// en porte deux.
export function checkUvLightmap(a){
  const p = ensurePropsMaterial(a);
  if(!p.lightmapAsset || p.lightmapUv !== 1) return true;
  const withoutUv1 = objects.filter(function(o){
    if(o.userData.materialId !== a.id) return false;
    let manque = false;
    o.traverse(function(x){
      if(x.isMesh && x.geometry && x.geometry.attributes && !x.geometry.attributes.uv1) manque = true;
    });
    return manque;
  });
  if(!withoutUv1.length) return true;
  setStatus('Lightmap sur le 2ᵉ game d\'UV, mais ' + withoutUv1.length + ' objet(s) n\'en ont '
    + 'qu\'un (' + withoutUv1.slice(0, 3).map(function(o){ return o.name; }).join(', ')
    + ') : exportez le modèle avec son dépliage de lightmap, ou passez le jeu d\'UV à 1er.', 8000);
  return false;
}

export function isEmissiveBlack(hex){
  return new THREE.Color(hex || '#000000').getHex() === 0;
}

// Brancher une map émissive met la couleur à BLANC (sinon elle multiplierait la map par du
// noir : rien ne s'allumerait), la débrancher la remet à NOIR (sinon l'objet resterait à
// émettre du blanc uni). Dans les deux sens, on ne touche qu'à la valeur qu'on avait posée
// soi-même — un émissif choisi à la main n'est jamais écrasé.
export function adjustEmissiveByMap(p, avaitMap){
  const aMap = !!p.emissiveAsset;
  if(aMap && !avaitMap && isEmissiveBlack(p.emissive)) p.emissive = '#ffffff';
  else if(!aMap && avaitMap && p.emissive === '#ffffff') p.emissive = '#000000';
}

// Branche l'éclairage précalculé. Copie conforme côté runtime (js/game-runtime.js).
//
// `channel` est ce qui compte : c'est lui qui dit à three d'échantillonner `uv1` plutôt
// que `uv`. Sans lui, une lightmap défoldée sur le second game serait lue avec les UV de
// texture — qui se chevauchent par construction — et l'éclairage apparaîtrait plaqué
// n'importe où, sans erreur.
export function applyLightmap(m, p){
  // Une lightmap CUITE en HDR est encodée en RGBM : elle se décode une fois, vers une texture
  // demi-flottante linéaire, au lieu de passer par le chemin des images de couleur. Copie
  // conforme côté runtime (js/game-runtime.js), et la même distinction y est faite.
  const aRgbm = assets.find(function(x){
    return x.id === p.lightmapAsset && x.kind === 'texture' && x.rgbm;
  });
  if(aRgbm){
    const texHdr = textureLightmapRgbm(aRgbm);
    if(texHdr){
      m.lightMap = texHdr;
      m.lightMapIntensity = (p.lightmapIntensity !== undefined) ? p.lightmapIntensity : 1;
      texHdr.channel = (p.lightmapUv === 0) ? 0 : 1;
      return;
    }
    // Image pas encore décodée : on ne pose rien plutôt que de poser une texture vide, et le
    // prochain passage (applyMaterialEverywhere après le chargement) la posera.
    return;
  }
  const tex = textureMaterial(p.lightmapAsset, p);
  if(!tex) return;
  m.lightMap = tex;
  m.lightMapIntensity = (p.lightmapIntensity !== undefined) ? p.lightmapIntensity : 1;
  tex.channel = (p.lightmapUv === 0) ? 0 : 1;
  // Le carrelage du matériau ne s'applique PAS à la lightmap, et c'est le seul emplacement
  // dans ce cas. Les autres cartes décrivent une matière qui se répète — une brique, un
  // bois ; une lightmap décrit l'éclairage d'UNE surface précise, à sa place exacte. La
  // répéter deux fois plaquerait l'éclairage du haut du mur en son milieu.
  // textureMaterial() pose le tuilage pour toutes les cartes : on le défait ici, et ici
  // seulement. (Défaut introduit en v0.26.0, corrigé en v0.27.0.)
  tex.repeat.set(1, 1);
  tex.offset.set(0, 0);
}

// Branche la map de hauteur selon le mode choisi. Partagé avec le runtime par copie
// conforme (js/game-runtime.js) : le jeu publié doit donner le même relief que la vue.
//
// Le biais de déplacement vaut −échelle/2 : une map de hauteur est peinte entre 0 et
// 1 avec le gris medium pour « surface d'origine », c'est la convention de Substance et
// de tout le monde. Sans ce biais, brancher une hauteur ferait GONFLER l'objet entier
// avant de le sculpter — on verrait la pièce grandir, pas se creuser.
export function applyHeight(m, p){
  const tex = textureMaterial(p.heightAsset, p);
  if(!tex) return;
  const k = (p.heightIntensity !== undefined) ? p.heightIntensity : 1;
  if(p.heightMode === 'move'){
    m.displacementMap = tex;
    m.displacementScale = k;
    m.displacementBias = -k / 2;
  } else {
    m.bumpMap = tex;
    m.bumpScale = k;
  }
}

// construit un THREE.MeshStandardMaterial complet (PBR) depuis les props d'un asset
export function makeMaterialThree(a){
  const p = ensurePropsMaterial(a);
  // Un matériau de plugin (Editor.enregistrerMateriau) remplace TOUT ce qui suit : sa table
  // décrit d'autres propriétés, son shader est en nœuds. Il rend null s'il n'y en a pas, ou
  // si la fabrication a échoué — et dans ce second cas elle l'a déjà dit dans la Console,
  // plutôt que de laisser un objet noir sans explication.
  if(typeof makeMaterialPlugin === 'function'){
    const mPlugin = makeMaterialPlugin(p);
    if(mPlugin) return mPlugin;
  }
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color(p.color),
    roughness: roughnessFromSmoothing(p.smoothness),
    metalness: p.metal,
    emissive: new THREE.Color(p.emissive),
    opacity: p.opacity,
    transparent: p.opacity < 1,
    side: p.doubleSided ? THREE.DoubleSide : THREE.FrontSide
  });
  m.map = textureMaterial(p.texAsset, p);
  const nrm = textureMaterial(p.normalAsset, p);
  if(nrm){
    m.normalMap = nrm;
    const ni = p.normalIntensity || 1;
    m.normalScale.set(ni, p.normalDirectX ? -ni : ni);   // Y négatif = convention DirectX
  }
  applyHeight(m, p);
  applyLightmap(m, p);
  const comb = textureCombined(p.combineAsset, p);
  if(comb){
    // masque combiné : une seule texture branchée sur les trois canaux three
    m.roughnessMap = comb;
    m.metalnessMap = comb;
    m.aoMap = comb;
    m.aoMapIntensity = (p.aoIntensity !== undefined) ? p.aoIntensity : 1;
  } else {
    m.roughnessMap = textureMaterial(p.roughnessAsset, p);
    m.metalnessMap = textureMaterial(p.metalAsset, p);
    const ao = textureMaterial(p.aoAsset, p);
    if(ao){
      m.aoMap = ao;
      m.aoMapIntensity = (p.aoIntensity !== undefined) ? p.aoIntensity : 1;
    }
  }
  m.emissiveMap = textureMaterial(p.emissiveAsset, p);
  multiplyInSmoothing(m);   // le facteur multiplie la map EN LISSAGE, pas en rugosité
  return m;
}

// Jusqu'à r150, l'aoMap de three lisait OBLIGATOIREMENT un second game d'UV (`uv2`) :
// il fallait dupliquer `uv` → `uv2` sur chaque maillage, sans quoi l'occlusion ne
// s'appliquait pas — silencieusement.
//
// Depuis r152, chaque texture porte un `channel` qui vaut 0 par défaut, donc l'aoMap
// lit `uv` comme toutes les autres maps. La duplication n'a plus d'objet : elle
// copiait un tableau d'UV par maillage pour rien.
//
// La fonction est conservée — elle est appelée depuis assets.js, import-settings.js et
// le runtime — mais elle documente désormais pourquoi elle ne fait rien, plutôt que de
// disparaître et de laisser croire à un oubli. Elle redeviendra utile le jour où on
// voudra une occlusion sur un VRAI second game d'UV (`uv1` en three moderne), ce qui
// demandera aussi `m.aoMap.channel = 1`.
export function ensureUv2(){ /* sans objet depuis three r152 : aoMap lit `uv` (channel 0) */ }

// bascule un mesh entre MeshStandardMaterial (éclairé) et MeshBasicMaterial (non éclairé,
// ignore toutes les lumières). Ne touche PAS aux maps PBR : un mesh unlit n'en a pas besoin,
// seules couleur/opacité/texture albedo sont conservées lors du basculement.
export function toggleUnlit(mesh, unlit){
  const anc = mesh.material;
  const color = anc.color ? anc.color.clone() : new THREE.Color(0x888888);
  const opacity = (anc.opacity !== undefined) ? anc.opacity : 1;
  const map = anc.map || null;
  const cote = anc.side !== undefined ? anc.side : THREE.FrontSide;
  const neuf = unlit
    ? new THREE.MeshBasicMaterial({color: color, opacity: opacity, transparent: opacity < 1, map: map, side: cote})
    : new THREE.MeshStandardMaterial({color: color, opacity: opacity, transparent: opacity < 1, map: map, side: cote,
        roughness: 0.55, metalness: 0.1});
  if(anc.dispose) anc.dispose();
  mesh.material = neuf;
  mesh.userData.notEclaire = unlit;
  // Le matériau vient d'être REMPLACÉ : le neuf n'a ni envMap ni signature. Sans ce
  // rappel, repasser en éclairé laisserait l'objet sans reflet jusqu'au prochain
  // évènement qui recalcule les sondes — souvent une réouverture de projet, donc une
  // cause et un effet séparés par une sauvegarde. C'est le pire cas à diagnostiquer.
  if(typeof applyProbes === 'function') applyProbes();
}

// La vignette du panneau Projet est rendue par le renderer WebGL CLASSIQUE (previewObject3D,
// js/assets.js) sur son propre canvas — pas par le WebGPURenderer de la vue. Ce renderer-là
// choisit son programme d'après `material.type` dans son ShaderLib : le type d'un matériau à
// NŒUDS n'y figure pas, et un matériau de plugin ne peut donc pas y être prévisualisé.
// On lui substitue une sphère explicitement neutre au lieu d'envoyer le matériau à un
// renderer qui ne le comprend pas — une vignette fausse mais crédible coûterait plus cher
// qu'une vignette qui n'essaie pas de mentir. L'inspecteur le dit en toutes lettres.
export function materialPreviewNeutral(p){
  const c = /^#[0-9a-fA-F]{6}$/.test(String(p.color)) ? p.color : '#8899aa';
  return new THREE.MeshStandardMaterial({color:new THREE.Color(c), roughness:0.5, metalness:0.1});
}

export function previewMaterial(a){
  // Même limite que les matériaux de plugin juste au-dessus : un matériau à shader
  // custom n'a pas de rendu WebGL classique fiable pour cette vignette.
  if(a.shaderId){
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), materialPreviewNeutral({color:'#8899aa'}));
    return previewObject3D(sphere);
  }
  const p = ensurePropsMaterial(a);
  const isPlugin = (typeof materialPluginOf === 'function') && !!materialPluginOf(p);
  const mat = isPlugin ? materialPreviewNeutral(p) : makeMaterialThree(a);
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), mat);
  return previewObject3D(sphere);
}

// Matériau "Défaut" : un seul par project, créé automatiquement (fallback intégré au
// moteur, pas une action utilisateur) — assigné à tout nouveau mesh/modèle plutôt que
// des couleurs en dur sur l'objet, pour que changer l'aspect par défaut d'un coup soit
// possible (comme les autres matériaux assets, cf. commentaire en tête de fichier).
export function ensureMaterialDefaultProject(){
  let a = assets.find(function(x){ return x.kind === 'material' && x.byDefault; });
  if(a) return a;
  a = {id:'a'+(nextAssetId()), kind:'material', name:'Défaut', folder:'', byDefault:true,
       props: JSON.parse(JSON.stringify(MATERIAL_DEFAULT))};
  a.preview = previewMaterial(a);
  assets.push(a);
  return a;
}

export function createAssetMaterial(){
  const n = assets.filter(function(x){ return x.kind === 'material'; }).length + 1;
  const a = {id:'a'+(nextAssetId()), kind:'material', name:'Matériau ' + n, folder:folderCurrent,
             props: JSON.parse(JSON.stringify(MATERIAL_DEFAULT))};
  a.preview = previewMaterial(a);
  assets.push(a);
  updateProject();
  selectAsset(a);   // ses propriétés s'éditent dans l'inspecteur (import-settings.js)
  return a;
}
// Lie ici, pas dans assets.js : ce fichier est charge apres, donc une reference
// a createAssetMaterial depuis assets.js leve une ReferenceError qui interrompt
// le reste du fichier (import, prefab, script, depots dans la vue).

// affecte un matériau à un objet : primitive (matériau remplacé) ou modèle importé
// (tous les sous-maillages). L'objet garde le link pour les mises à jour.
// Un Noeud porteur d'un composant Mesh (ajouté via +Component, même sur un
// objet créé « Vide ») est accepté au même titre qu'un userData.type 'mesh'
// historique — c'est le composant, pas le type figé, qui fait foi désormais.
// ---------- Les emplacements de matériaux d'un maillage de MODÈLE (v0.159.2) ----------
//
// Le Renderer d'Unity : chaque maillage d'une instance de modèle porte la liste de ses matériaux,
// un par emplacement (sous-maillage), et on peut en remplacer un sur CETTE instance sans toucher
// au modèle. `userData.materialSlots[k]` est l'id du matériau du projet posé sur l'emplacement k,
// ou null — l'emplacement porte alors celui du modèle (fichier ou onglet Matériaux de l'import).
// C'est un override du nœud (js/model-nodes.js) : il se sérialise avec l'instance.

// Ce que le MODÈLE pose sur chaque emplacement, par maillage d'instance : c'est vers lui qu'un
// emplacement vidé revient. Hors `userData` : ce sont des THREE.Material.
const modelMaterialsOf = new WeakMap();

export function isModelMeshNode(o){
  return !!(o && o.isMesh && o.userData && o.userData.modelNode !== undefined);
}

/** Le matériau three d'un asset matériau — graphe de shader compris. */
export function materialThreeOfAsset(asset){
  const shaderAsset = asset.shaderId
    ? assets.find(function(a){ return a.id === asset.shaderId && a.kind === 'graphShader'; })
    : null;
  return shaderAsset
    ? buildMaterialFromGraph(shaderAsset, textureMaterial, asset.valuesParams || {})
    : makeMaterialThree(asset.shaderId ? {props: MATERIAL_DEFAULT} : asset);
}

function modelMaterials(mesh){
  if(!modelMaterialsOf.has(mesh)) modelMaterialsOf.set(mesh, listMats(mesh).slice());
  return modelMaterialsOf.get(mesh);
}

/** Pose les emplacements du nœud : l'override s'il y en a un, le matériau du modèle sinon. */
export function applyMaterialSlots(mesh){
  if(!mesh || !mesh.isMesh) return;
  const base = modelMaterials(mesh);
  const slots = mesh.userData.materialSlots || [];
  const out = base.map(function(m, k){
    const a = slots[k] ? assets.find(function(x){ return x.id === slots[k] && x.kind === 'material'; }) : null;
    if(!a) return m;
    const mm = materialThreeOfAsset(a);
    mm.userData.materialAsset = a.id;
    return mm;
  });
  mesh.material = (out.length > 1) ? out : out[0];
  if(out.some(function(m){ return m && m.aoMap; })) ensureUv2(mesh);
}

/** Le modèle vient de reposer ses matériaux sur ce maillage : les overrides passent par-dessus. */
export function setModelMaterials(mesh, mats){
  modelMaterialsOf.set(mesh, mats.slice());
  applyMaterialSlots(mesh);
}

/** Change UN emplacement (`id` null : retour au matériau du modèle). */
export function setMaterialSlot(mesh, k, id){
  if(!isModelMeshNode(mesh)) return;
  modelMaterials(mesh);
  const slots = (mesh.userData.materialSlots || []).slice();
  while(slots.length < listMats(mesh).length) slots.push(null);
  slots[k] = id || null;
  if(slots.some(Boolean)) mesh.userData.materialSlots = slots;
  else delete mesh.userData.materialSlots;
  applyMaterialSlots(mesh);
  applyFilters();
}

export function applyMaterialOn(asset, root){
  // Un maillage d'instance de modèle (un SkinnedMesh, un sous-objet du FBX) : le matériau va sur
  // TOUS ses emplacements, en override — comme lâcher un matériau sur un Renderer dans Unity.
  if(isModelMeshNode(root)){
    const n = listMats(root).length || 1;
    modelMaterials(root);
    root.userData.materialSlots = new Array(n).fill(asset.id);
    applyMaterialSlots(root);
    applyFilters();
    return true;
  }
  const aComponentMesh = !!(root && root.getComponent && root.getComponent('Mesh'));
  const isMeshLegacy = root && root.userData.type === 'mesh';
  if(!root || (!aComponentMesh && !isMeshLegacy && root.userData.type !== 'model')){
    setStatus('Déposez le matériau sur une primitive ou un modèle importé', 3000);
    return false;
  }
  const targets = [];
  if(aComponentMesh || isMeshLegacy) targets.push(root);
  else root.traverse(function(x){ if(x.isMesh && !x.userData.isColliderViz) targets.push(x); });
  const shaderAsset = asset.shaderId
    ? assets.find(function(a){ return a.id === asset.shaderId && a.kind === 'graphShader'; })
    : null;
  targets.forEach(function(m){
    listMats(m).forEach(function(anc){ if(anc.dispose) anc.dispose(); });
    m.material = shaderAsset
      ? buildMaterialFromGraph(shaderAsset, textureMaterial, asset.valuesParams || {})
      // shaderId posé mais shader introuvable (asset supprimé) : repli PBR neutre, comme
      // un `texture` sans asset résolu retombe sur du noir plutôt que de planter.
      : makeMaterialThree(asset.shaderId ? {props: MATERIAL_DEFAULT} : asset);
    if(m.material.aoMap) ensureUv2(m);
  });
  root.userData.materialId = asset.id;
  if((aComponentMesh || isMeshLegacy) && !asset.shaderId){
    root.userData.emissiveBase = new THREE.Color(asset.props.emissive).getHex();
    root.userData.texAsset = null;   // le matériau asset remplace la texture directe
  }
  applyFilters();
  return true;
}

export function attachMaterialAsset(asset, root){
  if(!root || !isSceneObject(root)){
    setStatus('Déposez le matériau sur un objet de la scène', 3000);
    return;
  }
  pushHistory();
  if(applyMaterialOn(asset, root)){
    if(root === selection) buildInspector();
    setStatus('Matériau « ' + asset.name + ' » affecté à ' + root.name, 2500);
  }
}

// crée un asset matériau à partir du matériau inline d'un mesh, puis l'affecte à ce mesh —
// l'objet garde exactement son apparence actuelle, mais devient éditable comme un asset
// partagé. N'affecte AUCUN autre objet existant (contrairement à une édition d'asset).
export function extractMaterialFromInline(mesh){
  if(!mesh || mesh.userData.type !== 'mesh' || mesh.userData.materialId) return null;
  const m = mesh.material;
  const props = JSON.parse(JSON.stringify(MATERIAL_DEFAULT));
  props.color = '#' + m.color.getHexString();
  props.smoothness = smoothingFromRoughness(m.roughness);
  props.metal = (m.metalness !== undefined) ? m.metalness : 0.1;
  props.emissive = '#' + new THREE.Color(mesh.userData.emissiveBase || 0).getHexString();
  props.opacity = (m.opacity !== undefined) ? m.opacity : 1;
  props.texAsset = mesh.userData.texAsset || null;
  const n = assets.filter(function(x){ return x.kind === 'material'; }).length + 1;
  const a = {id:'a'+(nextAssetId()), kind:'material', name:mesh.name + ' — matériau ' + n,
             folder: folderCurrent, props: props};
  a.preview = previewMaterial(a);
  assets.push(a);
  updateProject();
  applyMaterialOn(a, mesh);
  return a;
}

// resynchronise tous les objets de la scène courante qui utilisent ce matériau
export function applyMaterialEverywhere(asset){
  objects.forEach(function(o){
    if(o.userData.materialId === asset.id) applyMaterialOn(asset, o);
  });
  // modèles importés qui l'affectent à un emplacement (paramètres d'import)
  refreshModelsOfMaterial(asset);
  // Après affectation, et pas avant : c'est ici qu'on sait enfin QUELS maillages portent
  // ce matériau, donc si l'un d'eux n'a pas le second game d'UV que la lightmap réclame.
  checkUvLightmap(asset);
  // applyMaterialOn() a RECONSTRUIT les matériaux : les neufs n'ont ni envMap ni
  // signature de sonde. Sans ce rappel, la moindre modification de matériau fait perdre
  // ses reflets à l'objet jusqu'au prochain évènement qui recalcule les sondes — souvent
  // une réouverture de projet, donc une cause et un effet séparés par une sauvegarde.
  // Mesuré : `applyMaterialEverywhere()` seul, sans rien d'autre, suffisait à passer de
  // « envMap posée » à « envMap nulle » sur toute la scène. Le même rappel existait déjà
  // pour la bascule éclairé/non-éclairé (voir plus bas) ; il manquait ici.
  if(typeof applyProbes === 'function') applyProbes();
  asset.preview = previewMaterial(asset);
  updateProject();
}

// Glisser un `graphShader` (logique pure) sur un asset `material` (instance) fixe le
// shader de ce matériau — comme glisser un Shader sur un materiau dans Unity. Réinitialise
// `valeursParams` : les anciennes valeurs surchargées n'ont aucune raison de correspondre
// aux points `param.*` du nouveau graphe.
export function assignShaderOnMaterial(materialAsset, shaderAsset){
  if(!materialAsset || materialAsset.kind !== 'material') return;
  if(!shaderAsset || shaderAsset.kind !== 'graphShader') return;
  pushHistory();
  materialAsset.shaderId = shaderAsset.id;
  materialAsset.valuesParams = {};
  applyMaterialEverywhere(materialAsset);
  setStatus('Shader « ' + shaderAsset.name + ' » assigné au matériau « ' + materialAsset.name + ' »', 2500);
}


// EXPOSÉ EN GLOBALE, à dessein. Ces symboles sont appelés depuis des fichiers
// que les mêmes pages ne chargent pas toutes : un `import` y pointerait un
// fichier absent, et la page ne démarrerait pas. Ils gardent donc leur garde
// `typeof` côté appelant, et se déclarent ici.
globalThis.MATERIAL_DEFAULT = MATERIAL_DEFAULT;
globalThis.applyMaterialSlots = applyMaterialSlots;
globalThis.setMaterialSlot = setMaterialSlot;
globalThis.setModelMaterials = setModelMaterials;
globalThis.applyMaterialEverywhere = applyMaterialEverywhere;
globalThis.roughnessFromSmoothing = roughnessFromSmoothing;
globalThis.smoothingFromRoughness = smoothingFromRoughness;
globalThis.toggleUnlit = toggleUnlit;