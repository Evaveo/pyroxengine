// ---------- Extraire les matériaux d'un modèle importé (« Extract Materials ») ----------
// Un FBX arrive avec ses matériaux et les NOMS de ses textures, mais rien qui dise à
// l'éditeur quelle image va sur quelle map : le nom de fichier est la seule information
// disponible, et c'est celle qu'utilisent tous les pipelines de production. Ce module
// fabrique donc un asset matériau par emplacement du fichier et y branche les textures
// dont le nom concorde — l'équivalent du bouton « Extract Materials » d'Unity.
//
// LA CONVENTION EST UNE PRÉFÉRENCE, pas une devinette. Chaque studio a la sienne
// (`TX_NomA_C` / `M_NomA` ici, `nomA_BaseColor` ailleurs) ; la déduire au hasard
// donnerait un outil qui marche pour son auteur et pour personne d'autre. Elle se règle
// dans Édition → ⚙ Préférences, avec un banc d'essai pour vérifier sur ses vrais noms.
//
// OÙ SONT CHERCHÉES LES TEXTURES : uniquement « à côté du modèle ». Un navigateur n'a
// pas accès au disque, donc le dossier du FBX, ici, ce sont deux choses — les fichiers
// arrivés AVEC lui à l'import (`a.paquet`, conservé dans le .p3d, donc encore là après
// rechargement) et les assets texture rangés dans le même dossier de projet que le
// modèle. Rien d'autre n'est parcouru : une texture d'un autre dossier ne peut pas être
// affectée par accident.

// Rôles de map : l'ordre est celui des préférences et du rapport d'extraction.
// `prop` est la clé du matériau asset (voir MATERIAL_DEFAULT dans materiaux.js),
// `type` le paramètre d'import de la texture créée — il décide de son espace de couleur.
import { assetId, assets, createAssetTexture, nextAssetId, updateProject } from './assets.js';
import { logConsole } from './console.js';
import { inputs } from './editor-input.js';
import { setStatus } from './hierarchy.js';
import { pushHistory } from './history.js';
import { IMPORT_DEFAULT, KEYS_MAP_THREE, applyImportModel, applyImportTexture, countInstancesModel, ensureParamsImport, ipChecked, ipText, nameSlotMat, refreshInspectorAsset, slotsMaterialsModel, updateTargetsImport } from './import-settings.js';
import { MATERIAL_DEFAULT, adjustEmissiveByMap, ensurePropsMaterial, previewMaterial, smoothingFromRoughness } from './materials.js';
import { escapeHtml } from './objects.js';
import { closeModal, openModal } from './ui.js';

export const NAMING_ROLES = [
  {key:'color',  prop:'texAsset',      label:'Couleur de base', type:'color'},
  {key:'combined',  prop:'combineAsset',  label:'Masque combiné',  type:'data'},
  {key:'normal',  prop:'normalAsset',   label:'Normale',         type:'normal'},
  {key:'emissive',  prop:'emissiveAsset',  label:'Émissive',        type:'color'},
  {key:'roughness', prop:'roughnessAsset', label:'Rugosité',        type:'data'},
  {key:'metal',    prop:'metalAsset',    label:'Métal',           type:'data'},
  {key:'ao',       prop:'aoAsset',       label:'Occlusion',       type:'data'},
  {key:'height',  prop:'heightAsset',  label:'Hauteur',         type:'data'},
  {key:'lightmap', prop:'lightmapAsset', label:'Lightmap',        type:'color'}
];

// Valeurs par défaut : suffixes courts ET longs pour couvrir sans réglage la plupart
// des conventions rencontrées, à commencer par celles que produit Substance Painter
// avec ses préréglages d'export (glTF PBR Metal Roughness, Unreal, Unity).
//
// `_ORM` était volontairement EXCLU tant que notre masque combiné suivait le packing
// de HDRP : un ORM n'a pas les mêmes canaux et aurait été mal lu. Ce n'est plus le cas
// depuis que l'ORM de glTF est notre convention native — c'est même devenu le suffixe
// qu'on veut voir en premier. Chaque suffixe de masque déclare désormais l'empaquetage
// qu'il implique (voir PACKING_BY_SUFFIX ci-dessous).
export const NAMING_DEFAULT = {
  prefixeTexture:'TX_',
  prefixeMaterial:'M_',
  suffixes:{
    color:'_C, _BaseColor, _Base_Color, _Albedo, _Diffuse, _Diff, _D, _COL',
    combined:'_OcclusionRoughnessMetallic, _ORM, _ARM, _MADS, _MaskMap, _Mask',
    normal:'_N, _Normal, _Normal_OpenGL, _NormalGL, _Normal_DirectX, _NormalDX, _Nrm, _NM',
    emissive:'_E, _Emissive, _EM',
    roughness:'_R, _Roughness, _Rough',
    metal:'_M, _Metallic, _Metal, _Met',
    ao:'_AO, _AmbientOcclusion, _Occlusion, _Occ',
    height:'_Height, _H, _Displacement, _Disp, _Bump',
    lightmap:'_Lightmap, _LightMap, _LM, _Baked'
  },
  correspondance:'exacte',      // 'exacte' | 'souple' (la base de la texture peut prolonger celle du matériau)
  ignorerCasse:true,
  withoutSuffixColor:true       // une texture sans suffixe reconnu = couleur de base
};

// Un suffixe de masque combiné dit AUSSI dans quel ordre ses canaux sont peints : un
// `_ORM` et un `_MaskMap` ne se lisent pas pareil. Le nom du fichier est la seule
// information disponible à l'extraction, et se tromper ici ne lève aucune erreur —
// ça donne un rendu faux mais plausible, occlusion et métal permutés.
// Testé du plus long au plus court, comme la reconnaissance de rôle.
export const PACKING_BY_SUFFIX = [
  {sfx:'_OcclusionRoughnessMetallic', packing:'orm'},   // préréglages glTF et Unreal de Substance
  {sfx:'_ORM',     packing:'orm'},
  {sfx:'_ARM',     packing:'orm'},                      // Ambient/Roughness/Metallic = mêmes canaux
  {sfx:'_MADS',    packing:'unity'},
  {sfx:'_MaskMap', packing:'unity'},                    // préréglage HDRP de Substance
  {sfx:'_Mask',    packing:'unity'}
];

// Substance exporte les normales en OpenGL ou en DirectX selon le préréglage, et les
// deux ne diffèrent QUE par le canal vert. Branchée sans correction, une normale
// DirectX inverse le relief — les bosses deviennent des creux. Rien ne le signale :
// l'image est valide, le matériau se construit, seule la lumière est à l'envers.
export const SUFFIXES_NORMAL_DIRECTX = ['_Normal_DirectX', '_NormalDX', '_DX'];

// Nom de fichier (avec ou sans extension) → empaquetage du masque. Par défaut 'orm',
// notre convention native : c'est ce qu'on veut quand le nom ne dit rien, parce que
// c'est ce que produisent les exports glTF.
export function packingFromName(name){
  const n = String(name || '').replace(EXT_IMAGE_NAMING, '');
  let meilleur = null;
  PACKING_BY_SUFFIX.forEach(function(p){
    if(!endsByNaming(n, p.sfx, true)) return;
    if(meilleur && meilleur.sfx.length >= p.sfx.length) return;
    meilleur = p;
  });
  return meilleur ? meilleur.packing : 'orm';
}

export function isNormalDirectX(name){
  const n = String(name || '').replace(EXT_IMAGE_NAMING, '');
  return SUFFIXES_NORMAL_DIRECTX.some(function(s){ return endsByNaming(n, s, true); });
}

// Préférence de CET ORDINATEUR, comme les plugins et la clé du copilote : une
// convention de nommage suit la personne et son pipeline DCC, pas le projet.
export const KEY_NAMING = 'moteur3d-nommage';

// extensions réellement chargeables par le TextureLoader — la même liste que l'import
// (assets.js). Un .tga cité par un FBX n'est pas lisible dans un navigateur : il est
// ignoré plutôt que de fabriquer un asset texture vide.
export const EXT_IMAGE_NAMING = /\.(png|jpe?g|webp|gif|bmp)$/i;

export function namingCurrent(){
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(KEY_NAMING) || 'null'); }
  catch(e){ raw = null; }
  const n = Object.assign(JSON.parse(JSON.stringify(NAMING_DEFAULT)), raw || {});
  // fusion à part : un ancien réglage peut ne connaître qu'une partie des rôles
  n.suffixes = Object.assign(JSON.parse(JSON.stringify(NAMING_DEFAULT.suffixes)),
                             (raw && raw.suffixes) || {});
  return n;
}

export function registerNaming(n){
  try { localStorage.setItem(KEY_NAMING, JSON.stringify(n)); }
  catch(e){ setStatus('Convention de nommage non enregistrée : ' + e.message, 4000); }
}

export function roleNaming(key){
  return NAMING_ROLES.find(function(r){ return r.key === key; }) || null;
}


// ---------- Lecture d'un nom de fichier selon la convention ----------
export function listSuffixes(txt){
  return String(txt || '').split(',')
    .map(function(s){ return s.trim(); })
    .filter(function(s){ return s.length; });
}

export function withoutExtensionFile(name){
  return String(name || '').replace(/\.[^.]+$/, '');
}

export function sameTextNaming(a, b, ignorerCasse){
  return ignorerCasse ? a.toLowerCase() === b.toLowerCase() : a === b;
}
export function startsByNaming(name, start, ignorerCasse){
  if(!start) return true;
  if(name.length < start.length) return false;
  return sameTextNaming(name.slice(0, start.length), start, ignorerCasse);
}
export function endsByNaming(name, end, ignorerCasse){
  if(!end || name.length < end.length) return false;
  return sameTextNaming(name.slice(name.length - end.length), end, ignorerCasse);
}

// {base, role, suffixe} pour un nom de fichier de texture, ou null s'il n'entre pas
// dans la convention.
// Longueur à partir de laquelle un suffixe se suffit à lui-même, sans préfixe. Quatre
// caractères : `_ORM`, `_AO ` non — `_AO` en fait 3 et passe aussi, voir ci-dessous.
// La ligne est tracée entre les suffixes d'UNE lettre (`_C`, `_N`, `_D`), qui peuvent
// tomber par hasard sur n'importe quel nom de fichier, et les suffixes explicites
// (`_BaseColor`, `_Normal`, `_ORM`), qui ne se produisent pas par accident.
export const LENGTH_SUFFIX_STANDALONE = 3;

export function analyzeNameTexture(fileName, conv){
  let n = withoutExtensionFile(fileName);
  // Un préfixe déclaré est un FILTRE : il évite qu'une capture d'écran ou un plan de
  // référence posé à côté du FBX soit pris pour une texture. Vide = tous les noms sont
  // candidats.
  //
  // Mais il ne peut pas être un filtre ABSOLU : Substance Painter exporte
  // `<JeuDeTextures>_BaseColor.png`, sans préfixe, et le préfixe par défaut `TX_`
  // rejetait donc l'intégralité d'un export Substance — l'outil paraissait simplement
  // ne rien trouver. Le filtre est conservé là où il sert vraiment, c'est-à-dire pour
  // les noms AMBIGUS : sans suffixe reconnu, ou avec un suffixe d'une seule lettre.
  // Un fichier qui finit par `_OcclusionRoughnessMetallic` n'est pas une capture d'écran.
  let aPrefixe = true;
  if(conv.prefixeTexture){
    aPrefixe = startsByNaming(n, conv.prefixeTexture, conv.ignorerCasse);
    if(aPrefixe) n = n.slice(conv.prefixeTexture.length);
  }
  // Suffixe le PLUS LONG qui corresponde : « _MADS » gagne sur « _M », « _Normal » sur
  // « _N ». Sans cette règle, l'ordre des rôles déciderait à la place de l'utilisateur.
  let meilleur = null;
  NAMING_ROLES.forEach(function(r){
    listSuffixes(conv.suffixes[r.key]).forEach(function(sfx){
      if(!endsByNaming(n, sfx, conv.ignorerCasse)) return;
      if(meilleur && meilleur.suffix.length >= sfx.length) return;
      meilleur = {role:r.key, suffix:sfx};
    });
  });
  if(meilleur && (aPrefixe || meilleur.suffix.length >= LENGTH_SUFFIX_STANDALONE))
    return {base:n.slice(0, n.length - meilleur.suffix.length),
            role:meilleur.role, suffix:meilleur.suffix};
  // Le repli « pas de suffixe = couleur de base » est le plus large de tous : il reste
  // réservé aux noms qui portent le préfixe.
  if(aPrefixe && conv.withoutSuffixColor && n) return {base:n, role:'color', suffix:''};
  return null;
}

// Base d'un emplacement de matériau. Le préfixe des matériaux n'est PAS un filtre : un
// emplacement reçoit son matériau même quand le DCC l'a nommé « Carrosserie » — seule
// la recherche de textures dépend de la base.
export function baseMaterialNaming(nameSlot, conv){
  const n = String(nameSlot || '');
  if(conv.prefixeMaterial && startsByNaming(n, conv.prefixeMaterial, conv.ignorerCasse))
    return n.slice(conv.prefixeMaterial.length);
  return n;
}

// Distance entre deux bases : 0 = identiques, > 0 = acceptable en correspondance souple
// (plus petit = plus proche), −1 = pas de correspondance.
export function gapBases(baseTexture, baseMaterial, conv){
  if(sameTextNaming(baseTexture, baseMaterial, conv.ignorerCasse)) return 0;
  if(conv.correspondance !== 'souple') return -1;
  if(startsByNaming(baseTexture, baseMaterial, conv.ignorerCasse))
    return baseTexture.length - baseMaterial.length;
  if(startsByNaming(baseMaterial, baseTexture, conv.ignorerCasse))
    return baseMaterial.length - baseTexture.length;
  return -1;
}


// ---------- Textures présentes « à côté du modèle » ----------
export function assetTextureOfFile(fileName){
  const bottom = String(fileName).toLowerCase();
  return assets.find(function(x){
    return x.kind === 'texture' && x.file && x.file.name.toLowerCase() === bottom;
  }) || null;
}

// Entrées candidates : {name, base, role} + `asset` (déjà dans le projet) ou `fichier`
// (venu avec le modèle, l'asset sera créé seulement s'il sert).
export function texturesOfFolder(a, conv){
  const folder = a.folder || '';
  const inputs = [];
  const vus = {};
  function add(name, extra){
    const bottom = name.toLowerCase();
    if(vus[bottom]) return;
    const info = analyzeNameTexture(name, conv);
    if(!info) return;
    vus[bottom] = true;
    inputs.push(Object.assign({name:name, base:info.base, role:info.role}, extra));
  }
  // assets texture du même dossier de projet. Un asset renommé après l'import garde son
  // fichier : on tente le nom de fichier d'abord, le nom d'asset ensuite.
  assets.forEach(function(x){
    if(x.kind !== 'texture' || (x.folder || '') !== folder) return;
    const nameF = (x.file && x.file.name) || '';
    if(nameF && analyzeNameTexture(nameF, conv)) add(nameF, {asset:x});
    else add(x.name, {asset:x});
  });
  // fichiers arrivés avec le modèle : le dossier du FBX, vu du navigateur
  (a.paquet || []).forEach(function(f){
    if(EXT_IMAGE_NAMING.test(f.name)) add(f.name, {file:f});
  });
  return inputs;
}

export function bestInputTexture(inputs, baseMat, role, conv){
  let best = null, gapMin = -1;
  inputs.forEach(function(e){
    if(e.role !== role) return;
    const ec = gapBases(e.base, baseMat, conv);
    if(ec < 0) return;
    if(best === null || ec < gapMin){ best = e; gapMin = ec; }
  });
  return best;
}

// Asset texture correspondant à une entrée, créé au besoin depuis le fichier venu avec
// le modèle. `entree.creee` signale une création, pour le rapport.
export function assetTextureForInput(entry, folder){
  if(entry.asset) return entry.asset;
  // le même fichier peut déjà être un asset rangé ailleurs : le réutiliser plutôt que
  // d'en fabriquer un doublon (il vient bien, lui aussi, du dossier du modèle)
  const existant = assetTextureOfFile(entry.name);
  if(existant){ entry.asset = existant; return existant; }
  const role = roleNaming(entry.role);
  const t = createAssetTexture(entry.file, {paramsImport:{type: role ? role.type : 'color'}});
  t.folder = folder;   // le dossier du modèle, pas le dossier current du panneau
  entry.asset = t;
  entry.creee = true;
  return t;
}

// Le rôle déduit du nom est une information plus sûre que le défaut de l'import, mais
// moins sûre qu'un choix explicite : on ne réécrit donc qu'un type resté au défaut.
export function fixTypeTexture(t, role){
  const p = ensureParamsImport(t);
  if(!role || p.type === role.type || p.type !== IMPORT_DEFAULT.texture.type) return false;
  p.type = role.type;
  applyImportTexture(t);
  return true;
}


// ---------- Extraction ----------
export function materialAssetOfName(name, folder){
  return assets.find(function(x){
    return x.kind === 'material' && x.name === name && (x.folder || '') === (folder || '');
  }) || null;
}

// Matériau raw du fichier portant ce nom d'emplacement (le premier rencontré : les
// suivants sont le même matériau partagé par d'autres maillages).
export function matRawOfSlot(a, name){
  let trouve = null;
  (a.matBruts || []).forEach(function(bruts){
    bruts.forEach(function(mb, i){
      if(!trouve && nameSlotMat(mb, i) === name) trouve = mb;
    });
  });
  return trouve;
}

// UN MATÉRIAU EXTRAIT PART AVEC DES MULTIPLICATEURS NEUTRES. Chaque paramètre multiplie sa
// map (voir materials.js) : la valeur neutre est donc 1, ou le blanc pour une couleur.
//   · couleur #ffffff : reprendre le gris du fichier teinterait un albédo qui porte déjà
//     sa teinte ;
//   · métal 1 : à 0,1, un métal peint dans le canal R du masque sortait dix fois trop
//     low.
// Le LISSAGE est mis à 1 seulement si une map le pilote (masque combiné ou map de
// rugosité) : sans map, 1 ferait un miroir d'une surface qui n'a rien demandé — le défaut
// du matériau est alors le bon choix. Même logique pour l'émissif, noir tant qu'aucune map
// ne l'allume.
export const EXCERPT_NEUTRAL = {color:'#ffffff', metal:1};

// Du matériau du fichier, on reprend ce qu'il déclare vraiment et qui ne double pas une
// texture : émissif, opacité, double face. PAS la rugosité — FBXLoader fabrique un
// MeshPhongMaterial, qui n'en a aucune notion, et la déduire de `shininess` serait une
// invention. Un glTF, lui, la déclare, et elle est reprise (convertie en lissage).
export function propsFromMatRaw(mb){
  const p = Object.assign(JSON.parse(JSON.stringify(MATERIAL_DEFAULT)), EXCERPT_NEUTRAL);
  if(!mb) return p;
  if(mb.emissive) p.emissive = '#' + mb.emissive.getHexString();
  if(mb.opacity !== undefined) p.opacity = mb.opacity;
  if(mb.roughness !== undefined) p.smoothness = smoothingFromRoughness(mb.roughness);
  if(mb.metalness !== undefined) p.metal = mb.metalness;
  p.doubleSided = (mb.side === THREE.DoubleSide);
  return p;
}

// maps portées par le matériau du fichier (textures intégrées au FBX ou résolues par le
// loader) : elles ne survivent pas au passage en matériau asset, il faut le dire.
export function aOfMapsFile(mb){
  if(!mb) return false;
  return KEYS_MAP_THREE.some(function(k){ return !!mb[k]; });
}

export function createMaterialExcerpt(name, folder, mb){
  // createAssetMaterial sélectionne l'asset créé : ici ce serait voler l'inspecteur au
  // modèle en cours d'extraction, on fabrique donc l'asset directement.
  const a = {id:'a' + (nextAssetId()), kind:'material', name:name, folder:folder,
             props: propsFromMatRaw(mb)};
  a.preview = previewMaterial(a);
  assets.push(a);
  return a;
}

// Crée un matériau du projet par emplacement du modèle et y branche les textures
// trouvées à côté de lui. Ré-extraire COMPLÈTE sans défaire : un emplacement de map
// déjà rempli (à la main ou par une extraction précédente) n'est jamais écrasé.
export function extractMaterialsModel(a){
  if(!a || a.kind !== 'model') return null;
  const p = ensureParamsImport(a);
  const slots = slotsMaterialsModel(a);
  if(!slots.length){
    setStatus('« ' + a.name + ' » ne déclare aucun matériau : rien à extraire', 3500);
    return null;
  }
  const conv = namingCurrent();
  const inputs = texturesOfFolder(a, conv);
  const folder = a.folder || '';
  const summary = {materials:0, repris:0, maps:0, texturesCreees:0, typesCorriges:0,
                 withoutTexture:0, mapsFile:0};

  // toucher aux instances touche à la scène : même instantané d'historique que les
  // autres réglages d'import (les assets, eux, n'en font pas partie — cf. history.js)
  if(updateTargetsImport && countInstancesModel(a)) pushHistory();
  if(!p.materials) p.materials = {};

  slots.forEach(function(s){
    const base = baseMaterialNaming(s.name, conv);
    const mb = matRawOfSlot(a, s.name);
    let ma = materialAssetOfName(s.name, folder);
    if(ma) summary.repris++;
    else { ma = createMaterialExcerpt(s.name, folder, mb); summary.materials++; }

    const props = ensurePropsMaterial(ma);
    const affectees = [];
    let dejaRemplies = 0;
    NAMING_ROLES.forEach(function(r){
      if(props[r.prop]){ dejaRemplies++; return; }  // déjà branché : on ne défait pas
      const e = bestInputTexture(inputs, base, r.key, conv);
      if(!e) return;
      const t = assetTextureForInput(e, folder);
      if(e.creee){ summary.texturesCreees++; e.creee = false; }
      if(fixTypeTexture(t, r)) summary.typesCorriges++;
      props[r.prop] = t.id;
      summary.maps++;
      let note = '';
      // Le nom du fichier porte deux informations qu'on perdrait à ne lire que le rôle.
      if(r.key === 'combined'){
        props.combinePacking = packingFromName(e.name);
        note = ' [' + (props.combinePacking === 'orm' ? 'ORM' : 'HDRP') + ']';
        if(props.combinePacking === 'orm') summary.masquesOrm = (summary.masquesOrm || 0) + 1;
      }
      if(r.key === 'normal' && isNormalDirectX(e.name)){
        props.normalDirectX = true;
        note = ' [DirectX corrigé]';
        summary.normalesDx = (summary.normalesDx || 0) + 1;
      }
      affectees.push(r.label + ' ← ' + e.name + note);
    });
    // multiplicateurs neutres pour les canaux qu'une map vient de prendre en charge
    if(affectees.length){
      if(props.combineAsset || props.roughnessAsset) props.smoothness = 1;
      adjustEmissiveByMap(props, false);
    }
    const empty = !affectees.length && !dejaRemplies;
    if(empty) summary.withoutTexture++;
    // un matériau resté sans aucune map alors que le fichier en portait : ses images
    // sont intégrées au FBX, elles ne passent pas dans un matériau asset
    if(empty && aOfMapsFile(mb)) summary.mapsFile++;

    p.materials[s.name] = ma.id;
    ma.preview = previewMaterial(ma);
    // couleur du fichier abandonnée au profit du blanc : dit, jamais silencieux
    const teinte = (mb && mb.color && mb.color.getHexString() !== 'ffffff')
      ? ' · couleur du fichier (#' + mb.color.getHexString() + ') remplacée par du blanc, '
        + 'qui ne teinte pas l\'albédo' : '';
    logConsole(empty ? 'warn' : 'log',
      'Extraction « ' + a.name + ' » · emplacement ' + s.name + ' → matériau ' + ma.name
      + (affectees.length ? ' · ' + affectees.join(' · ') : '')
      + (dejaRemplies ? ' · ' + dejaRemplies + ' map(s) déjà en place, conservée(s)' : '')
      + (empty ? ' · aucune texture de base « ' + base + ' » à côté du modèle' : '')
      + teinte, null);
  });

  const nInst = applyImportModel(a, updateTargetsImport);
  refreshInspectorAsset();
  updateProject();

  const bouts = [];
  if(summary.materials) bouts.push(summary.materials + ' matériau(x) créé(s)');
  if(summary.repris) bouts.push(summary.repris + ' repris');
  bouts.push(summary.maps + ' texture(s) affectée(s)');
  if(summary.texturesCreees) bouts.push(summary.texturesCreees + ' importée(s) du dossier du modèle');
  if(summary.typesCorriges) bouts.push(summary.typesCorriges + ' type(s) d\'import corrigé(s)');
  if(summary.withoutTexture) bouts.push(summary.withoutTexture + ' emplacement(s) sans texture');
  if(nInst) bouts.push(nInst + ' instance(s) mise(s) à jour');
  setStatus('Matériaux de « ' + a.name + ' » : ' + bouts.join(' · '), 6000);
  if(summary.mapsFile)
    logConsole('warn', 'Extraction « ' + a.name + ' » : ' + summary.mapsFile
      + ' emplacement(s) avaient une texture intégrée au fichier, que le matériau du '
      + 'projet ne reprend pas. Exportez ces images à côté du modèle et relancez '
      + 'l\'extraction.', null);
  return summary;
}


// ---------- Préférences : convention de nommage ----------
export function prefFieldText(id, label, val, title){
  return '<div class="field"' + (title ? ' title="' + escapeHtml(title) + '"' : '')
    + '><label>' + label + '</label>'
    + '<input type="text" id="' + id + '" spellcheck="false" value="' + escapeHtml(val) + '"></div>';
}

// Exemple de test rempli avec la convention affichée : le banc d'essai part donc
// toujours d'un cas qui marche, et on le remplace par ses vrais noms.
export function exampleTestNaming(conv){
  const prem = function(key){ return listSuffixes(conv.suffixes[key])[0] || ''; };
  return [conv.prefixeMaterial + 'NomA',
          conv.prefixeTexture + 'NomA' + prem('color') + '.png',
          conv.prefixeTexture + 'NomA' + prem('combine') + '.png',
          conv.prefixeTexture + 'NomB' + prem('normal') + '.png'].join('\n');
}

export function readFormNaming(){
  const n = {prefixeTexture: (ipText('pref-ptex') || '').trim(),
             prefixeMaterial: (ipText('pref-pmat') || '').trim(),
             suffixes:{},
             correspondance: ipText('pref-match') || 'exacte',
             ignorerCasse: ipChecked('pref-case', true),
             withoutSuffixColor: ipChecked('pref-nosuffix', true)};
  NAMING_ROLES.forEach(function(r){
    n.suffixes[r.key] = ipText('pref-sfx-' + r.key) || '';
  });
  return n;
}

// Une ligne du banc d'essai est un emplacement de matériau si elle porte le préfixe des
// matériaux ; sans préfixe déclaré, c'est l'absence d'extension d'image qui la désigne.
export function isLineMaterialTest(l, conv){
  if(conv.prefixeMaterial) return startsByNaming(l, conv.prefixeMaterial, conv.ignorerCasse);
  return !EXT_IMAGE_NAMING.test(l);
}

export function updateTestNaming(){
  const output = document.getElementById('pref-result');
  if(!output) return;
  const conv = readFormNaming();
  const lines = (ipText('pref-test') || '').split(/[\r\n,;]+/)
    .map(function(s){ return s.trim(); }).filter(function(s){ return s.length; });

  const mats = [], textures = [], ignorees = [];
  lines.forEach(function(l){
    if(isLineMaterialTest(l, conv)){ mats.push(l); return; }
    const info = analyzeNameTexture(l, conv);
    if(info) textures.push({name:l, base:info.base, role:info.role});
    else ignorees.push(l);
  });

  let h = '';
  const utilisees = {};
  mats.forEach(function(name){
    const base = baseMaterialNaming(name, conv);
    const parts = [];
    NAMING_ROLES.forEach(function(r){
      const e = bestInputTexture(textures, base, r.key, conv);
      if(!e) return;
      utilisees[e.name] = true;
      parts.push(r.label + ' ← <code>' + escapeHtml(e.name) + '</code>');
    });
    h += '<div><b>' + escapeHtml(name) + '</b> (base « ' + escapeHtml(base) + ' ») → '
      + (parts.length ? parts.join(' · ') : '<i>aucune texture correspondante</i>') + '</div>';
  });
  textures.forEach(function(e){
    if(utilisees[e.name]) return;
    const r = roleNaming(e.role);
    h += '<div><code>' + escapeHtml(e.name) + '</code> → ' + (r ? r.label : e.role)
      + ', base « ' + escapeHtml(e.base) + ' » — <i>réclamée par aucun matériau testé</i></div>';
  });
  ignorees.forEach(function(l){
    h += '<div><code>' + escapeHtml(l) + '</code> → <i>hors convention (préfixe ou '
      + 'suffixe non reconnu) : jamais affectée</i></div>';
  });
  output.innerHTML = h || '<i>Saisissez un nom d\'emplacement et des noms de fichiers.</i>';
}

// `conv` permet de rouvrir la modale sur des valeurs non enregistrées (button ↺ Par défaut).
// La CONVENTION DE NOMMAGE des textures, et rien d'autre. Elle s'appelait `modalPrefs` — un nom
// qui promettait toutes les préférences de l'éditeur et n'en montrait qu'une. Celles-là sont
// maintenant un panneau (js/ui/panels-settings.js), qui renvoie ici pour cet écran précis :
// une table de suffixes ne s'édite pas en un champ.
export function modalNaming(conv){
  const n = conv || namingCurrent();
  let sfx = '';
  NAMING_ROLES.forEach(function(r){
    sfx += prefFieldText('pref-sfx-' + r.key, r.label, n.suffixes[r.key],
      'Suffixes acceptés pour cette map, séparés par des virgules. Le plus long '
      + 'l\'emporte : « _MADS » n\'est pas lu comme « _M ».');
  });
  openModal('Préférences — convention de nommage des assets',
    '<div id="pref-body">'
    + '<p>Ces réglages pilotent <b>🎨 Extraire les matériaux</b>, dans les paramètres '
    + 'd\'import d\'un modèle : un matériau y est rapproché de ses textures par leur '
    + '<b>nom de fichier</b>. Avec les valeurs par défaut, l\'emplacement '
    + '<code>M_NomA</code> reçoit <code>TX_NomA_C</code> en couleur de base et '
    + '<code>TX_NomA_MADS</code> en masque combiné, tandis que <code>TX_NomB_N</code> '
    + 'reste de côté.</p>'
    + '<p style="color:var(--txt-dim)">Préférence de <b>cet ordinateur</b> (comme les '
    + 'plugins et la clé du copilote), pas du projet : une convention suit la personne '
    + 'et son pipeline.</p>'
    + '<div class="sec">Préfixes</div>'
    + prefFieldText('pref-ptex', 'Textures', n.prefixeTexture,
        'Exigé pour qu\'un fichier soit considéré comme une texture — de quoi écarter '
        + 'une référence ou une capture posée dans le même dossier. Vide : tous les noms '
        + 'sont candidats.')
    + prefFieldText('pref-pmat', 'Matériaux', n.prefixeMaterial,
        'Retiré du nom de l\'emplacement pour obtenir la base à chercher. Un emplacement '
        + 'qui ne le porte pas reçoit quand même son matériau.')
    + '<div class="sec">Suffixes par map — séparés par des virgules</div>'
    + sfx
    + '<div class="ip-note">Le <b>masque combiné</b> suit la convention Unity : '
    + '<b>R</b> métal · <b>G</b> occlusion · <b>B</b> ignoré · <b>A</b> lissage. '
    + 'Un packing ORM/RMA n\'a pas ces canaux — n\'ajoutez son suffixe ici que si le '
    + 'vôtre est bien celui-là, sinon utilisez les maps séparées.</div>'
    + '<div class="sec">Règles</div>'
    + '<div class="field" title="Exacte : la base de la texture doit être identique à '
    + 'celle du matériau. Souple : elle peut la prolonger (M_Perso ← TX_Perso_Corps_C).">'
    + '<label>Correspondance</label><select id="pref-match">'
    + '<option value="exacte"' + (n.correspondance !== 'souple' ? ' selected' : '') + '>Exacte</option>'
    + '<option value="souple"' + (n.correspondance === 'souple' ? ' selected' : '') + '>Souple (préfixe commun)</option>'
    + '</select></div>'
    + '<div class="field" title="Recommandé : les exports DCC ne sont pas constants sur la casse.">'
    + '<label>Ignorer la casse</label>'
    + '<input type="checkbox" id="pref-case"' + (n.ignorerCasse !== false ? ' checked' : '') + '></div>'
    + '<div class="field" title="Pour les pipelines où l\'albédo n\'est pas suffixé (bois.png + bois_N.png).">'
    + '<label>Sans suffixe = couleur</label>'
    + '<input type="checkbox" id="pref-nosuffix"' + (n.withoutSuffixColor !== false ? ' checked' : '') + '></div>'
    + '<div class="sec">Banc d\'essai — un nom par ligne</div>'
    + '<textarea id="pref-test" spellcheck="false" style="height:78px">'
    + escapeHtml(exampleTestNaming(n)) + '</textarea>'
    + '<div id="pref-result" class="ip-note"></div>'
    + '<div style="display:flex;gap:8px;margin-top:12px;justify-content:space-between">'
    + '<button class="btn-modal" id="pref-default">↺ Par défaut</button>'
    + '<span><button class="btn-modal" id="pref-cancel">Annuler</button> '
    + '<button class="btn-modal accent" id="pref-ok">Appliquer</button></span></div>'
    + '</div>');

  const body = document.getElementById('pref-body');
  // écouteurs posés sur le corps de la modale, détruit à la prochaine ouverture :
  // rien ne s'accumule d'une ouverture à l'autre
  body.addEventListener('input', updateTestNaming);
  body.addEventListener('change', updateTestNaming);
  updateTestNaming();

  document.getElementById('pref-default').addEventListener('click', function(){
    modalNaming(JSON.parse(JSON.stringify(NAMING_DEFAULT)));
  });
  document.getElementById('pref-cancel').addEventListener('click', closeModal);
  document.getElementById('pref-ok').addEventListener('click', function(){
    registerNaming(readFormNaming());
    closeModal();
    refreshInspectorAsset();   // le compte de textures détectées change avec la convention
    setStatus('Convention de nommage enregistrée (préférence de cet ordinateur)', 3000);
  });
}
