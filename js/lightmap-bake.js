// ---------- Cuisson de lightmaps ----------
//
// v0.26.0 apprenait au moteur à CONSOMMER une lightmap cuite ailleurs. Ici il la calcule
// lui-même.
//
// La technique vient de `examples/jsm/misc/ProgressiveLightMapGPU.js` de three.js r185
// (MIT, three.js authors) : on rastérise en ESPACE UV — le sommet sort ses coordonnées de
// lightmap comme position à l'écran, donc chaque triangle se dessine dans ses propres
// texels — et on accumule image par image. Ce fichier n'est pas une copie : les quatre
// endroits où l'on s'émap de l'exemple sont signalés par « ÉCART ».
//
// Ce que la cuisson produit : de l'irradiance directe, ombres comprises. Plus un éventuel
// éclairage d'environnement, MAIS seulement si `scene.environment` est posé — ce qui n'est
// pas le cas par défaut ici : le ciel du moteur passe par les sondes, matériau par matériau
// (setEnvironmentOn, js/probes.js), pas par la scène. Mesuré : lampes à zéro et
// scene.environment nul donnent une map vide ; lampes à zéro et scene.environment posé
// sur une capture cube donnent de la lumière. C'est cette voie-là qui portera le rebond.
//
// PAS de rebond entre surfaces pour l'instant, et ce n'est pas propre à ce moteur : les
// cuiseurs temps réel comparables s'en passent aussi, pour une raison structurelle — une
// lightmap ne contient pas d'albédo, donc aucune surface ne peut en éclairer une autre.

// Résolution de l'atlas complet, pas d'un objet : tous les objets s'y partagent la place.
import { assets, awaitAssetTextureReady, createAssetTexture, disposeTexturesReplaced, replaceContentAssetTexture, updateProject } from './assets.js';
import { setStatus } from './hierarchy.js';
import { setTransformedAtlas } from './lightmap-atlas.js';
import { applyMaterialEverywhere, ensurePropsMaterial } from './materials.js';
import { listMats, objects } from './objects.js';
import { pass } from './postfx.js';
import { geometryForWrite } from './primitive-geometry.js';
import { acceptsEnvironment, createTargetCube } from './probes.js';
import { project } from './project.js';
import { LAYER_HELPERS, grid, renderer, scene } from './scene.js';
import { allSelection, selection } from './selection.js';
import { closeModal, openModal } from './ui.js';
import { isIconEdit } from './viewport.js';

export const LIGHTMAP_RES = 1024;
// Nombre d'images accumulées. C'est le curseur qualité/temps : la moyenne courante
// converge en 1/N, donc doubler N ne divise le bruit que par √2.
export const LIGHTMAP_IMAGES = 240;
// Rayon de gigue des lumières, en unités monde. C'est LUI qui fabrique les ombres douces :
// une source ponctuelle donne un bord dur, la même source secouée sur 240 images et
// moyennée donne une pénombre. À 0, les ombres sont dures.
export const LIGHTMAP_SMOOTH = 0.35;
// Marge autour de chaque îlot dans l'atlas, en texels. En dessous de 2, le filtrage
// bilinéaire va chercher les texels du voisin et l'éclairage d'un objet bave sur l'autre.
export const LIGHTMAP_MARGIN_TEXELS = 3;
// Nombre de rebonds. Chaque rebond coûte une capture et une passe complète, et n'apporte
// que l'albédo fois le précédent : le 2ᵉ rebond d'une scène à albédo 0,5 pèse 25 % du
// direct, le 3ᵉ 12 %. Au-delà de 2 on paie du temps pour de l'invisible.
export const LIGHTMAP_BOUNCES = 1;
// Résolution de la capture cube qui porte le rebond. Elle sert d'éclairage diffus, pas de
// reflet : monter au-delà de 128 affine une lumière déjà floue par nature.
export const LIGHTMAP_RES_CAPTURE = 128;

// Les réglages appartiennent au PROJET, pas à la machine : deux personnes qui cuisent la
// même scène doivent obtenir la même image. Même mécanique que INPUTS_DEFAULT et
// LAYERS_DEFAULT — valeurs par défaut ici, persistance dans `project.lightmap`.
export const LIGHTMAP_DEFAULT = {
  resolution: LIGHTMAP_RES,
  images: LIGHTMAP_IMAGES,
  bounces: LIGHTMAP_BOUNCES,
  smooth: LIGHTMAP_SMOOTH,
  // HDR par défaut : une lightmap est une mesure d'irradiance, pas une image, et rien ne
  // justifie de l'écrêter à 1 quand le même PNG peut en porter 64 (js/lightmap-rgbm.js). Le
  // prix est un décodage CPU au chargement et une texture demi-flottante — 8 Mo au lieu de 4
  // pour un atlas de 1024.
  rgbm: true,
  denoise: true
};

export function settingsLightmap(){
  const r = project.lightmap || {};
  return {
    resolution: r.resolution || LIGHTMAP_DEFAULT.resolution,
    images: r.images || LIGHTMAP_DEFAULT.images,
    // `|| defaut` serait faux ici : 0 rebond est un réglage LÉGITIME, et c'est même le seul
    // medium de cuire vite pour dégrossir. Il faut donc tester la présence, pas la vérité.
    bounces: (r.bounces !== undefined) ? r.bounces : LIGHTMAP_DEFAULT.bounces,
    smooth: (r.smooth !== undefined) ? r.smooth : LIGHTMAP_DEFAULT.smooth,
    // Deux booléens : `!== undefined` là aussi, sinon « décoché » serait indiscernable
    // d'« absent » et on ne pourrait jamais les désactiver.
    rgbm: (r.rgbm !== undefined) ? !!r.rgbm : LIGHTMAP_DEFAULT.rgbm,
    denoise: (r.denoise !== undefined) ? !!r.denoise : LIGHTMAP_DEFAULT.denoise
  };
}

// Lu par la boucle de rendu (viewport.js) : pendant une cuisson les matériaux des objets
// sont remplacés et la scène est rendue en espace UV. Une image intercalée par le viewport
// afficherait CE rendu-là dans la fenêtre d'édition.
export const lightmapBakeState = {active:false, image:0, total:0};

// ---------- 1. Analyse du dépliage ----------

// Le second game d'UV est le bon par convention (c'est ce qu'exporte un dépliage de
// lightmap Blender). À défaut on se rabat sur le premier, mais c'est un pis-aller que
// diagnoseUnfold() a pour tâche de dénoncer.
export function gameUvSource(geo){
  if(!geo || !geo.attributes) return null;
  // Un `uv1` que NOUS avons fabriqué n'est pas un dépliage : c'est déjà un atlas. Le
  // reprendre comme source ferait ranger un rangement — les îlots rétréciraient à chaque
  // cuisson jusqu'à disparaître, avec une image plausible à chaque étape. On revient
  // toujours au jeu d'origine, dont le nom est mémorisé avec la transformée.
  if(geo.userData.lightmapAtlas) return geo.userData.lightmapAtlas.game;
  if(geo.attributes.uv1) return 'uv1';
  if(geo.attributes.uv) return 'uv';
  return null;
}

export function trianglesUv(geo, name, visiter){
  const a = geo.attributes[name];
  if(!a) return;
  const idx = geo.index ? geo.index.array : null;
  const n = idx ? idx.length : a.count;
  for(let t = 0; t + 2 < n; t += 3){
    const i0 = idx ? idx[t] : t, i1 = idx ? idx[t+1] : t+1, i2 = idx ? idx[t+2] : t+2;
    visiter(a.getX(i0), a.getY(i0), a.getX(i1), a.getY(i1), a.getX(i2), a.getY(i2));
  }
}

// Somme des aires de tous les triangles dans le plan UV.
export function areaUvTotal(geo, name){
  let s = 0;
  trianglesUv(geo, name, function(u0,v0,u1,v1,u2,v2){
    s += Math.abs((u1-u0)*(v2-v0) - (u2-u0)*(v1-v0)) * 0.5;
  });
  return s;
}

export function boundsUv(geo, name){
  const a = geo.attributes[name];
  let min = Infinity, max = -Infinity;
  for(let i = 0; i < a.count; i++){
    const u = a.getX(i), v = a.getY(i);
    if(u < min) min = u; if(u > max) max = u;
    if(v < min) min = v; if(v > max) max = v;
  }
  return {min:min, max:max};
}

// LA GARDE QUI MANQUAIT. L'exemple de three fabrique `uv1` en recopiant `uv` : ce n'est
// pas un dépliage, c'est un rangement. Or les UV de texture se chevauchent par
// construction dès qu'on carrelle — et alors l'éclairage de deux endroits différents
// s'écrit dans les mêmes texels. Le rendu reste plausible, il est faux, et
// checkUvLightmap() ne peut rien voir puisque `uv1` existe bel et bien.
//
// Le test d'aire est SAIN mais INCOMPLET, et il faut le savoir pour ne pas s'y fier plus
// qu'il ne peut : une aire totale > 1 prouve le chevauchement (principe des tiroirs — ça
// ne rentre pas dans le carré unité), mais une aire ≤ 1 ne prouve rien du tout, deux
// îlots exactement superposés passeraient au travers. Il attrape le cas current sans
// jamais crier à tort.
export function diagnoseUnfold(geo, name){
  const b = boundsUv(geo, name);
  if(b.min < -1e-4 || b.max > 1 + 1e-4){
    return {ok:false, reason:'les UV sortent du carré unité (' + b.min.toFixed(2) + ' à '
      + b.max.toFixed(2) + ') — c\'est un carrelage, pas un dépliage'};
  }
  const area = areaUvTotal(geo, name);
  if(area > 1.0001){
    return {ok:false, reason:'aire UV totale ' + area.toFixed(2) + ' > 1 : des îlots se '
      + 'recouvrent forcément, l\'éclairage de deux surfaces ira dans les mêmes texels'};
  }
  return {ok:true, reason:''};
}

// ---------- 2. L'atlas ----------

// ÉCART n°1 avec l'exemple de three : il donne à chaque objet un carré de 1×1 dans
// l'atlas, quelle que soit sa taille — son propre commentaire le note comme un TODO
// (« Size these by object surface area »). Un sol de 400 m² recevait donc autant de texels
// qu'un boulon. On dimensionne à l'aire réelle, ce qui répartit la résolution là où il y a
// de la surface à éclairer.
export function areaWorld(mesh){
  const geo = mesh.geometry, pos = geo.attributes.position;
  if(!pos) return 1;
  mesh.updateWorldMatrix(true, false);
  const m = mesh.matrixWorld;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3();
  const idx = geo.index ? geo.index.array : null;
  const total = idx ? idx.length : pos.count;
  let s = 0;
  for(let t = 0; t + 2 < total; t += 3){
    const i0 = idx ? idx[t] : t, i1 = idx ? idx[t+1] : t+1, i2 = idx ? idx[t+2] : t+2;
    a.fromBufferAttribute(pos, i0).applyMatrix4(m);
    b.fromBufferAttribute(pos, i1).applyMatrix4(m);
    c.fromBufferAttribute(pos, i2).applyMatrix4(m);
    s += n.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a)).length() * 0.5;
  }
  return s > 1e-9 ? s : 1e-9;
}

// sourceUvFrozen() et setTransformedAtlas() ont DÉMÉNAGÉ dans js/lightmap-atlas.js
// (v0.149.3), avec reapplyAtlasLightmap() et collectAtlasLightmap(). Raison : ce
// fichier-ci importe douze modules d'éditeur, il ne pourra JAMAIS être embarqué dans un
// build — et le jeu publié, lui, doit savoir reposer un atlas au chargement. Elles sont
// importées en haut de ce fichier et s'utilisent exactement comme avant.

// Range tous les maillages dans un seul atlas. Retourne les avertissements de dépliage,
// sans bloquer : c'est à l'utilisateur de juger si son modèle est cuisible.
export function setAtlasLightmap(meshes, res){
  const marge = LIGHTMAP_MARGIN_TEXELS / res;
  const avertissements = [];
  const boites = [];
  meshes.forEach(function(m, i){
    const name = gameUvSource(m.geometry);
    if(!name){
      avertissements.push({mesh:m, reason:'aucun jeu d\'UV : rien à éclairer'});
      return;
    }
    if(name === 'uv'){
      const d = diagnoseUnfold(m.geometry, name);
      if(!d.ok) avertissements.push({mesh:m, reason:d.reason});
    }
    // Côté du carré réservé : √area, pour que la surface dans l'atlas soit
    // proportionnelle à la surface dans le monde.
    const cote = Math.sqrt(areaWorld(m));
    boites.push({w:cote + marge*2, h:cote + marge*2, x:0, y:0, index:i, cote:cote, game:name});
  });
  if(!boites.length) return {avertissements:avertissements, remplissage:0};

  const dim = potpack(boites);
  boites.forEach(function(b){
    // Le V est retourné (échelle négative) : c'est la convention de l'exemple de three,
    // qui la compense par un .flipY() côté sommet. Les deux vont ensemble — en changer un
    // seul donne une cuisson miroir verticalement, ce qui se voit mal sur une scène
    // symétrique et pas du tout sur un sol.
    // DÉTACHÉE AVANT D'ÊTRE ÉCRITE : les primitives partagent une géométrie par forme
    // (js/primitive-geometry.js), et chaque objet cuit a besoin de SON rangement dans
    // l'atlas. Sans cette copie, tous les cubes de la scène recevraient l'éclairage du
    // dernier cuit — une image plausible, et fausse partout.
    setTransformedAtlas(geometryForWrite(meshes[b.index]), b.game,
      [b.cote / dim.w, -b.cote / dim.h],
      [(b.x + marge) / dim.w, 1 - (b.y + marge) / dim.h]);
  });
  return {avertissements:avertissements, remplissage:dim.fill};
}

// ---------- 3. Le matériau de cuisson ----------

// Les noeuds TSL dont on dépend, nommés. Une montée de version de three qui en renomme un
// donnerait sinon une erreur illisible au milieu de la construction du graphe — c'est
// exactement ce qui est arrivé au post-traitement quand `.uv()` est devenu `.sample()`.
export const NODES_TSL_BAKE = ['uv', 'vec2', 'vec4', 'mix', 'float', 'texture', 'uniform', 'output'];

export function checkNodesTsl(){
  const missing = NODES_TSL_BAKE.filter(function(n){ return typeof TSL[n] === 'undefined'; });
  if(missing.length){
    throw new Error('Cuisson impossible : node(s) TSL absent(s) de cette version de '
      + 'three — ' + missing.join(', '));
  }
}

export function buildMaterialBake(texturePrecedente){
  checkNodesTsl();
  const {uv, vec2, vec4, mix, float, texture, uniform, output} = TSL;

  // ÉCART n°2, et c'est le plus important : le matériau est BLANC, sans aucune map.
  // Une lightmap doit contenir de l'irradiance seule. Si on cuisait avec le vrai matériau,
  // sa couleur entrerait dans la map, puis three multiplierait à nouveau par la couleur
  // au rendu : l'albédo serait appliqué deux fois et tout ce qui est coloré virerait au
  // sombre saturé. Tout cuiseur de lightmaps court-circuite le matériau pour cette raison.
  const m = new THREE.MeshStandardNodeMaterial({color:0xffffff, roughness:1, metalness:0,
                                                side:THREE.DoubleSide});
  // ÉCART n°3 : profondeur désactivée. En espace UV tous les fragments sortent au même z,
  // la profondeur ne veut plus rien dire et un test d'égalité mal tombé effacerait des
  // îlots entiers.
  m.depthTest = false;
  m.depthWrite = false;

  const window = uniform(1);
  const precedente = texture(texturePrecedente);

  // La ligne qui fait tout : la position du sommet EST sa coordonnée de lightmap, ramenée
  // de [0,1] à [-1,1]. Le rastériseur remplit alors les texels de l'îlot, et le fragment y
  // exécute l'éclairage réel du point de surface correspondant.
  m.vertexNode = vec4(uv(1).flipY().sub(vec2(0.5)).mul(2), 1, 1);
  // Moyenne courante avec l'image précédente : c'est la progressivité. `output` est la
  // couleur qu'aurait produite le matériau, donc ici la lumière reçue.
  m.outputNode = vec4(mix(precedente.sample(uv(1)), output, float(1).div(window)));

  return {material:m, window:window, precedente:precedente};
}

// ---------- 3bis. Le rebond ----------

// Une surface éclairée EST une source. Plutôt que de lancer des rayons pour le faire savoir
// aux autres, on la PHOTOGRAPHIE : une capture cube de la scène, posée en `scene.environment`
// de la passe suivante, apporte à chaque point la lumière renvoyée par tout ce qui l'entoure.
// Mesuré avant d'écrire une ligne : lampes à zéro et cette capture pour seule source, la
// cuisson produit de la lumière — c'est bien cette voie qui porte le rebond.
//
// LE PIÈGE, et il ne se voit pas : pendant la capture, les lampes doivent être ÉTEINTES. La
// lightmap de la passe précédente porte DÉJÀ l'éclairage direct ; laisser les lampes
// allumées ferait compter ce direct deux fois — une fois par elles, une fois par la map —
// et le rebond sortirait deux fois trop fort, avec une image parfaitement crédible.
//
// Les sondes, en revanche, RESTENT — et c'était une erreur de les unregister.
//
// Sur la justesse d'abord : ce que les sondes ajoutent à la capture, c'est l'ambiance du ciel
// réfléchie par les surfaces, donc le REBOND de la lumière du ciel. Ce n'est pas un double
// comptage : cette lumière n'est pas dans la lightmap, elle est dans les sondes. La série
// converge exactement comme le reste, en albédo par passe.
//
// Sur la solidité ensuite, et c'est ce qui a tranché : `removeProbesOfMaterials()` met
// `envMap` à `null`. Fait sur un matériau dont le pipeline WebGPU est DÉJÀ construit —
// c'est-à-dire dès qu'une image a été rendue entre deux cuissons — l'observateur de nœuds de
// three lit `isTexture` sur cette valeur nulle et le rendu s'arrête. Mesuré : deux cuissons
// enchaînées passaient, les mêmes séparées par un rendu tombaient dans la capture.
// `envMapIntensity = 0` a été essayé comme contournement et ne neutralise rien (mesuré).
//
// Le ciel entre donc dans la capture par deux voies — le fond, vu directement par la caméra
// cube, et les sondes — ce qui donne à la cuisson l'éclairage d'ambiance qu'elle ignorait.
//
// Au premier tour, `lightmapPrecedente` est nulle : les surfaces sont noires et la capture
// ne contient que le ciel, occulté. Un seul chemin de code sert donc aux deux usages.
export function captureEnvironmentBounce(meshes, lightmapPrecedente, res){
  const rt = createTargetCube(res);
  const cam = new THREE.CubeCamera(0.1, 800, rt);
  // Même masque que les sondes : une capture ne doit jamais voir le gizmo, la grille ni les
  // icônes d'édition — ils enverraient leur propre couleur en rebond dans toute la scène.
  const masquer = function(c){
    c.layers.disableAll();
    for(let i = 0; i < LAYER_HELPERS; i++) c.layers.enable(i);
  };
  masquer(cam);
  cam.traverse(masquer);

  // Au centre de ce qu'on cuit, pas à l'origine du monde : une scène décentrée récolterait
  // son rebond depuis le vide.
  const box = new THREE.Box3();
  meshes.forEach(function(m){ box.expandByObject(m); });
  if(!box.isEmpty()) box.getCenter(cam.position);

  const lights = [];
  scene.traverse(function(x){ if(x.isLight){ lights.push([x, x.intensity]); x.intensity = 0; } });

  const keys = [];
  if(lightmapPrecedente){
    lightmapPrecedente.channel = 1;
    const vus = new Set();
    meshes.forEach(function(x){
      listMats(x).forEach(function(m){
        if(vus.has(m) || !acceptsEnvironment(m)) return;
        vus.add(m);
        keys.push([m, m.lightMap, m.lightMapIntensity]);
        m.lightMap = lightmapPrecedente;
        m.lightMapIntensity = 1;
        // Ajouter une map change le graphe de nœuds, et three ne recalcule la clé de
        // hidden que si la version du matériau a bougé. Sans ça, la capture ne verrait rien
        // de la lightmap — et le rebond serait nul, sans erreur. Même raison que dans
        // setEnvironmentOn (js/probes.js).
        m.needsUpdate = true;
      });
    });
  }

  try { cam.update(renderer, scene); }
  finally {
    keys.forEach(function(t){
      t[0].lightMap = t[1];
      t[0].lightMapIntensity = t[2];
      t[0].needsUpdate = true;
    });
    lights.forEach(function(p){ p[0].intensity = p[1]; });
  }
  return rt;
}

// ---------- 4. La cuisson ----------

// Les icônes d'édition (gizmo de lumière, de caméra, de sonde, fil de fer des colliders)
// sont des maillages comme les autres pour three, mais elles n'existent pas dans le jeu.
// Cuites, elles occuperaient une région de l'atlas — de la résolution volée aux vraies
// surfaces — pour un éclairage que personne ne verra jamais.
// `racines` limite la cuisson à ces objets (cuisson sélective). Sans argument : toute la scène.
export function meshesBakeable(racines){
  const list = [];
  (racines && racines.length ? racines : objects).forEach(function(o){
    if(isIconEdit(o)) return;
    o.traverse(function(x){
      if(!x.isMesh || !x.geometry || !x.geometry.attributes) return;
      if(isIconEdit(x)) return;
      list.push(x);
    });
  });
  return list;
}

// Un matériau partagé entre un maillage cuit et un maillage NON cuit est le piège propre à la
// cuisson sélective : la lightmap est une propriété de matériau, donc le non-cuit la reçoit
// aussi — sans région d'atlas, donc plaquée n'importe où. Et rien ne le dirait : son `uv1`
// existe peut-être (celui de son fichier), ce qui suffit à faire taire checkUvLightmap.
export function materialsSharedWithOfNotBaked(meshes){
  const baked = new Set(meshes);
  const matsBaked = new Set();
  meshes.forEach(function(m){ listMats(m).forEach(function(x){ matsBaked.add(x); }); });
  const names = [];
  objects.forEach(function(o){
    if(isIconEdit(o) || o.userData.modelNode !== undefined) return;
    o.traverse(function(x){
      if(!x.isMesh || baked.has(x) || isIconEdit(x)) return;
      if(listMats(x).some(function(mm){ return matsBaked.has(mm); })) names.push(x.name || o.name);
    });
  });
  return names;
}

export async function bakeLightmap(opts){
  opts = opts || {};
  if(lightmapBakeState.active){ setStatus('Une cuisson est déjà en cours', 2500); return null; }

  // Les réglages du projet, qu'un appel direct peut surcharger (tests, scripts).
  const reg = settingsLightmap();
  const res = opts.resolution || reg.resolution;
  const total = opts.images || reg.images;
  const smooth = (opts.smooth !== undefined) ? opts.smooth : reg.smooth;

  // Cuisson sélective : la sélection si elle existe, toute la scène sinon.
  const racines = opts.selection || allSelection();
  const selectif = !!(racines && racines.length);
  const meshes = meshesBakeable(racines);
  if(!meshes.length){ setStatus('Aucun maillage à cuire', 3000); return null; }

  if(selectif){
    const shared = materialsSharedWithOfNotBaked(meshes);
    if(shared.length){
      setStatus('Attention : ' + shared.length + ' objet(s) non sélectionné(s) partagent un '
        + 'matériau avec la sélection (' + shared.slice(0, 3).join(', ') + '…). Ils recevront '
        + 'la lightmap sans avoir de place dans l\'atlas, donc un éclairage faux. Donnez-leur '
        + 'un matériau distinct, ou cuisez-les avec.', 12000);
    }
  }

  const atlas = setAtlasLightmap(meshes, res);
  atlas.avertissements.forEach(function(a){
    console.warn('Lightmap — ' + (a.mesh.name || 'maillage sans nom') + ' : ' + a.reason);
  });
  if(atlas.avertissements.length){
    setStatus(atlas.avertissements.length + ' objet(s) au dépliage douteux, voir la '
      + 'console — la cuisson continue mais leur éclairage sera faux', 8000);
  }

  const bounces = (opts.bounces !== undefined) ? opts.bounces : reg.bounces;
  const resCapture = opts.resolutionCapture || LIGHTMAP_RES_CAPTURE;

  const rt1 = new THREE.RenderTarget(res, res, {type:THREE.FloatType});
  const rt2 = new THREE.RenderTarget(res, res, {type:THREE.FloatType});
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const {material, window, precedente} = buildMaterialBake(rt1.texture);

  // Tout ce qu'on va abîmer, noté avant de l'abîmer. La restauration est dans un `finally` :
  // une cuisson qui échoue à mi-course ne doit pas laisser la scène avec des matériaux
  // blancs et la grille invisible.
  const matsOrigine = meshes.map(function(m){ return m.material; });
  const cullOrigine = meshes.map(function(m){ return m.frustumCulled; });
  const ombresOrigine = meshes.map(function(m){ return [m.castShadow, m.receiveShadow]; });
  // Ce qu'on fait des objets NON cuits — grille, gizmo, icônes d'édition, et en cuisson
  // sélective tout ce qui n'est pas sélectionné. Eux se dessineraient dans l'atlas en
  // projection caméra, par-dessus les îlots.
  //
  // On coupe leur écriture de COULEUR, on ne les masque PAS. La différence est tout l'intérêt
  // de la cuisson sélective : la passe d'ombre passe par le matériau de profondeur, qu'un
  // `colorWrite` n'affecte pas — donc un mur non sélectionné continue de projeter son ombre
  // sur le sol qu'on cuit. Masqué, il ne l'aurait pas fait, et on aurait cuit un sol sans
  // l'ombre de son mur, sans rien pour le signaler.
  //
  // `depthWrite` tombe avec : en espace UV tous les fragments sortent au même z, et un objet
  // non cuit qui écrit de la profondeur pourrait masquer un îlot entier.
  //
  // Un par un, et surtout PAS par leur parent. Première version : je masquais les enfants
  // de scène ne contenant aucun maillage à cuire — ce qui masquait les LUMIÈRES, puisque
  // le seul maillage d'un objet lumière est son icône, justement exclue de la cuisson.
  // Résultat : une cuisson qui va au bout, produit une image, et cette image est noire.
  // Une lumière n'étant pas dessinable, la masquer ne protégeait rien et coûtait tout.
  const aBake = new Set(meshes);
  const muets = [];              // matériaux rendus muets, dédupliqués (ils sont partageables)
  const vusMuets = new Set();
  scene.traverse(function(x){
    if(aBake.has(x)) return;
    if(!(x.isMesh || x.isLine || x.isPoints || x.isSprite)) return;
    listMats(x).forEach(function(m){
      if(!m || vusMuets.has(m)) return;
      vusMuets.add(m);
      muets.push([m, m.colorWrite, m.depthWrite]);
    });
  });
  const lights = [];
  scene.traverse(function(x){ if(x.isLight) lights.push([x, x.position.clone()]); });
  const targetOrigine = renderer.getRenderTarget();
  // Le fond de scène est une couleur OPAQUE (scene.js). Laissé en place, il remplirait
  // toute la cible avant même qu'on dessine : l'atlas serait noyé, et surtout l'alpha
  // vaudrait 1 partout — la dilatation ne saurait plus distinguer un texel empty d'un texel
  // éclairé, et n'aurait plus rien à faire.
  const fondOrigine = scene.background;
  const envOrigine = scene.environment;
  const clearOrigine = renderer.getClearColor(new THREE.Color());
  const alphaOrigine = renderer.getClearAlpha();

  // Deux états de scène alternent maintenant à chaque passe : l'état NORMAL, seul dans
  // lequel la capture de rebond a un sens (vrais matériaux, fond visible), et l'état de
  // CUISSON. Le passage doit donc être exact dans les deux sens, et pas seulement à la fin
  // — d'où ces deux fonctions plutôt qu'un bloc dans le `finally`.
  function enterInBake(){
    // On rend muet plutôt que de déplacer. L'exemple de three déplace les objets dans une
    // scène interne ; un plantage en cours de route les y laisserait, hors hiérarchie.
    // Deux booléens se remettent toujours d'aplomb.
    muets.forEach(function(p){ p[0].colorWrite = false; p[0].depthWrite = false; });
    scene.background = null;
    renderer.setClearColor(0x000000, 0);
    meshes.forEach(function(m){
      m.material = material;
      m.frustumCulled = false;   // la caméra ne veut rien dire ici : le sommet ignore sa projection
      m.castShadow = true;
      m.receiveShadow = true;
    });
  }
  function exitOfBake(){
    scene.background = fondOrigine;
    renderer.setClearColor(clearOrigine, alphaOrigine);
    meshes.forEach(function(m, i){
      m.material = matsOrigine[i];
      m.frustumCulled = cullOrigine[i];
      m.castShadow = ombresOrigine[i][0];
      m.receiveShadow = ombresOrigine[i][1];
    });
    muets.forEach(function(p){ p[0].colorWrite = p[1]; p[0].depthWrite = p[2]; });
    lights.forEach(function(p){ p[0].position.copy(p[1]); });
  }

  const passes = bounces + 1;
  lightmapBakeState.active = true;
  lightmapBakeState.total = total * passes;
  lightmapBakeState.image = 0;

  let data = null, finale = null, capture = null;
  try {
    for(let pass = 0; pass < passes; pass++){
      // 1. La capture, scène dans son état normal. Au 1er tour il n'y a pas de lightmap :
      // la capture ne rapporte que le ciel occulté par les objets, ce qui donne déjà à la
      // pass directe son éclairage d'ambiance.
      const ancienne = capture;
      capture = captureEnvironmentBounce(meshes, finale ? finale.texture : null, resCapture);
      if(ancienne) ancienne.dispose();
      scene.environment = capture.texture;

      // 2. La cuisson.
      enterInBake();
      let actif1 = true;
      for(let i = 0; i < total; i++){
        // La gigue des lumières : c'est elle qui transforme 240 ombres dures en une pénombre.
        if(smooth > 0){
          lights.forEach(function(p){
            p[0].position.set(
              p[1].x + (Math.random() - 0.5) * smooth,
              p[1].y + (Math.random() - 0.5) * smooth,
              p[1].z + (Math.random() - 0.5) * smooth);
          });
        }
        const target = actif1 ? rt1 : rt2;
        precedente.value = (actif1 ? rt2 : rt1).texture;
        actif1 = !actif1;
        // La fenêtre s'ouvre progressivement : à la 1ʳᵉ image on prend 100 % du rendu (il n'y
        // a rien à moyenner), puis 1/2, 1/3… C'est une vraie moyenne, pas un lissage
        // exponentiel — les premières images ne pèsent pas plus lourd que les dernières.
        // C'est aussi ce qui fait qu'une nouvelle passe REMPLACE la précédente au lieu de se
        // moyenner avec elle : à i = 0, la fenêtre vaut 1 et l'ancien contenu est écarté.
        window.value = Math.min(i + 1, total);
        renderer.setRenderTarget(target);
        await renderer.renderAsync(scene, cam);
        lightmapBakeState.image = pass * total + i + 1;
        if(i % 10 === 0 || i === total - 1){
          setStatus('Cuisson — passe ' + (pass + 1) + '/' + passes + ', image '
            + (i + 1) + '/' + total, 1000);
          // Rendre la main au navigateur, sinon la bar d'état ne se redessine jamais et
          // l'onglet passe pour figé.
          //
          // setTimeout et PAS requestAnimationFrame : rAF est suspendu dès que l'onglet
          // pass en arrière-plan. Une cuisson longue — c'est-à-dire toutes celles qui
          // méritent qu'on aille faire autre chose pendant — se figerait à la première
          // respiration et ne repartirait qu'au retour de l'utilisateur. Mesuré : bloquée à
          // l'image 1 sur 60, indéfiniment.
          await new Promise(function(r){ setTimeout(r, 0); });
        }
      }
      finale = actif1 ? rt2 : rt1;
      exitOfBake();
    }
    renderer.setRenderTarget(null);
    data = await renderer.readRenderTargetPixelsAsync(finale, 0, 0, res, res);
  } finally {
    renderer.setRenderTarget(targetOrigine);
    scene.environment = envOrigine;
    exitOfBake();
    if(capture) capture.dispose();
    rt1.dispose();
    rt2.dispose();
    material.dispose();
    lightmapBakeState.active = false;
  }

  if(!data) return null;
  const seams = seamsOfLAtlas(meshes, res);
  const asset = await exportLightmapInAsset(data, res, opts.name || 'Lightmap', {
    rgbm: (opts.rgbm !== undefined) ? !!opts.rgbm : reg.rgbm,
    denoise: (opts.denoise !== undefined) ? !!opts.denoise : reg.denoise,
    seams: seams
  });
  // ATTENDRE que l'image soit décodée avant de brancher la map sur les matériaux. Le
  // chargement est asynchrone : brancher trop tôt fait planter le rendu suivant, qui lit
  // `image.complete` sur null (mesuré : deux cuissons enchaînées tombaient dessus dès la
  // capture de la seconde). C'est aussi ce qui rend la lightmap visible immédiatement, au
  // lieu du prochain évènement qui reconstruit les matériaux.
  const prete = await awaitAssetTextureReady(asset);
  // Le décodage RGBM lit les pixels de l'image : il ne peut se faire qu'après le décodage de
  // celle-ci, donc après l'pending ci-dessus et pas avant.
  if(asset.rgbm) forgetCacheRgbm(asset);
  if(!prete){
    setStatus('La lightmap a été cuite mais son image n\'a pas fini de se décoder — elle '
      + 'n\'est pas branchée. Réessayez.', 8000);
    return asset;
  }
  assignLightmapToMaterials(meshes, asset);
  // MAINTENANT, et pas avant : les matériaux viennent d'être reconstruits sur la nouvelle
  // texture, donc plus aucun clone ne partage la source de l'ancienne. La libérer plus tôt
  // invalidait ces clones et faisait tomber le rendu suivant (voir js/assets.js).
  disposeTexturesReplaced();
  setStatus('Lightmap cuite : ' + res + '×' + res + ', ' + bounces + ' rebond(s), remplissage '
    + Math.round(atlas.remplissage * 100) + ' %', 6000);
  return asset;
}

// ---------- 5. Sortie ----------

// Dilatation : les texels jamais écrits (entre les îlots) restent à zéro, et le filtrage
// bilinéaire va les chercher au bord des îlots — d'où le liseré noir classique sur toutes
// les coutures. On étale la bordure de quelques texels vers le vide.
//
// Le masque « écrit / pas écrit » est l'alpha : la cible est effacée à alpha 0 et le
// matériau écrit 1, donc un texel jamais touché est le seul à valoir exactement 0.
export function dilate(pixels, res, passes){
  const lus = [-1, 1, -res, res, -res-1, -res+1, res-1, res+1];
  for(let p = 0; p < passes; p++){
    const copie = pixels.slice();
    for(let i = 0; i < res * res; i++){
      if(copie[i*4+3] > 0) continue;
      let r = 0, g = 0, b = 0, n = 0;
      for(let k = 0; k < lus.length; k++){
        const j = i + lus[k];
        if(j < 0 || j >= res*res) continue;
        if(copie[j*4+3] <= 0) continue;
        r += copie[j*4]; g += copie[j*4+1]; b += copie[j*4+2]; n++;
      }
      if(!n) continue;
      pixels[i*4] = r/n; pixels[i*4+1] = g/n; pixels[i*4+2] = b/n;
      pixels[i*4+3] = 1e-6;   // marqué comme rempli pour la passe suivante, sans peser
    }
  }
}

// ---------- Coutures ----------
//
// Une couture, c'est une arête qui existe UNE fois sur le modèle et DEUX fois dans le dépliage :
// les deux îlots se touchent en 3D mais sont posés loin l'un de l'autre dans l'atlas. Chacun y
// reçoit son éclairage indépendamment, avec ses propres arrondis et son propre bruit — d'où le
// trait visible qui court le long de l'arête sur le modèle assemblé.
//
// La dilatation n'y peut rien : elle étale vers le VIDE, alors qu'ici les deux côtés sont
// remplis. Il faut les faire se rejoindre.
//
// Détection : on regroupe les arêtes par leur paire de positions 3D (quantifiées). Une arête
// vue deux fois avec des UV différentes est une couture. C'est exact et local — pas
// d'heuristique de distance, pas de seuil à régler.
export function seamsOfLAtlas(meshes, res){
  const seams = [];
  const grid = 1e4;   // quantification des positions : 0,1 mm à l'échelle du mètre
  meshes.forEach(function(m){
    const geo = m.geometry;
    const pos = geo.attributes.position, uv1 = geo.attributes.uv1;
    if(!pos || !uv1) return;
    const idx = geo.index ? geo.index.array : null;
    const n = idx ? idx.length : pos.count;
    const key = function(i){
      return Math.round(pos.getX(i)*grid) + ',' + Math.round(pos.getY(i)*grid)
           + ',' + Math.round(pos.getZ(i)*grid);
    };
    const aretes = new Map();
    for(let t = 0; t + 2 < n; t += 3){
      const v = [idx ? idx[t] : t, idx ? idx[t+1] : t+1, idx ? idx[t+2] : t+2];
      for(let e = 0; e < 3; e++){
        const a = v[e], b = v[(e+1) % 3];
        const ka = key(a), kb = key(b);
        if(ka === kb) continue;               // arête dégénérée
        // Orientation canonique : sans elle, la même arête vue par ses deux triangles
        // donnerait deux clés différentes et aucune couture ne serait jamais trouvée.
        const order = ka < kb;
        const k = order ? ka + '|' + kb : kb + '|' + ka;
        const p = order ? [a, b] : [b, a];
        const seg = [[uv1.getX(p[0]), uv1.getY(p[0])], [uv1.getX(p[1]), uv1.getY(p[1])]];
        if(!aretes.has(k)) aretes.set(k, []);
        aretes.get(k).push(seg);
      }
    }
    aretes.forEach(function(segs){
      if(segs.length < 2) return;
      const A = segs[0], B = segs[1];
      // Même endroit dans l'atlas = arête intérieure, pas une couture. Le seuil est en TEXELS
      // et non en UV : à 512 comme à 4096, « décalé d'un texel et demi » veut dire la même
      // chose visuellement.
      const gap = Math.abs(A[0][0]-B[0][0]) + Math.abs(A[0][1]-B[0][1])
                  + Math.abs(A[1][0]-B[1][0]) + Math.abs(A[1][1]-B[1][1]);
      if(gap * res < 1.5) return;
      seams.push([A, B]);
    });
  });
  return seams;
}

// Moyenne les texels de part et d'autre de chaque couture, en marchant le long des deux
// segments en parallèle. Méthode itérative (celle de Bakery), pas un solveur : deux passes
// suffisent visuellement, et ça se relit.
//
// Le pas est d'UN texel : sauter des texels laisserait des trous dans le raccord, visibles
// comme des pointillés le long de l'arête — plus laid que la couture d'origine.
export function connectSeams(pixels, res, seams, passes){
  const dedans = function(v){ return v >= 0 && v < res; };
  for(let p = 0; p < (passes || 2); p++){
    for(let c = 0; c < seams.length; c++){
      const A = seams[c][0], B = seams[c][1];
      const lA = Math.hypot((A[1][0]-A[0][0])*res, (A[1][1]-A[0][1])*res);
      const lB = Math.hypot((B[1][0]-B[0][0])*res, (B[1][1]-B[0][1])*res);
      const step = Math.max(2, Math.ceil(Math.max(lA, lB)));
      for(let k = 0; k <= step; k++){
        const t = k / step;
        // yb = v × res : mesuré sur le relevé, sa ligne 0 est en v = 0.
        const ax = Math.round((A[0][0] + (A[1][0]-A[0][0])*t) * res);
        const ay = Math.round((A[0][1] + (A[1][1]-A[0][1])*t) * res);
        const bx = Math.round((B[0][0] + (B[1][0]-B[0][0])*t) * res);
        const by = Math.round((B[0][1] + (B[1][1]-B[0][1])*t) * res);
        if(!dedans(ax) || !dedans(ay) || !dedans(bx) || !dedans(by)) continue;
        const i = (ay*res + ax) * 4, j = (by*res + bx) * 4;
        // Un texel empty n'est pas une mesure : le moyenner tirerait le bord vers le noir et
        // fabriquerait le liseré que la dilatation existe pour supprimer.
        if(pixels[i+3] <= 0 || pixels[j+3] <= 0) continue;
        for(let ch = 0; ch < 3; ch++){
          const moy = (pixels[i+ch] + pixels[j+ch]) * 0.5;
          pixels[i+ch] = moy;
          pixels[j+ch] = moy;
        }
      }
    }
  }
}

// Débruitage bilatéral. La moyenne d'images fait converger le bruit en 1/√N : passer de 240
// à 960 images ne le divise que par deux. Un bilatéral bien réglé fait mieux, pour le prix
// d'une passe CPU.
//
// « Bilatéral » veut dire que le poids d'un voisin dépend de DEUX distances : sa distance
// géométrique (un noyau gaussien classique) et sa différence de valeur. C'est la seconde qui
// fait tout le travail ici : un voisin de luminance très différente est presque ignoré, donc
// le bord d'une ombre ne se fond pas dans la zone éclairée. Un flou gaussien seul mangerait
// les ombres, ce qui est exactement ce qu'on cuit.
//
// `sigmaValeur` est en unités d'irradiance, pas en 0-255 : on travaille sur le relevé
// flottant, avant tout écrêtage. Trop grand, le bilatéral redevient un flou ; trop petit, il
// ne fait rien. 0,15 tient le bruit sans toucher aux bords sur les scènes mesurées ici.
//
// Les texels vides (alpha 0) sont exclus des DEUX côtés : ni débruités, ni pris comme voisins.
// Sans ça le noir du vide serait moyenné dans les bords d'îlots — on aurait fabriqué le liseré
// que la dilatation existe pour enlever.
export function denoiseBilateral(pixels, res, radius, sigmaValue){
  const source = pixels.slice();
  const sigmaSpace = Math.max(1, radius / 2);
  const weightSpace = [];
  for(let d = -radius; d <= radius; d++) weightSpace.push(Math.exp(-(d*d) / (2*sigmaSpace*sigmaSpace)));
  const inv2sv = 1 / (2 * sigmaValue * sigmaValue);
  const lum = function(i){ return 0.2126*source[i*4] + 0.7152*source[i*4+1] + 0.0722*source[i*4+2]; };

  for(let y = 0; y < res; y++){
    for(let x = 0; x < res; x++){
      const i = y*res + x;
      if(source[i*4+3] <= 0) continue;
      const lc = lum(i);
      let r = 0, g = 0, b = 0, somme = 0;
      for(let dy = -radius; dy <= radius; dy++){
        const yy = y + dy;
        if(yy < 0 || yy >= res) continue;
        for(let dx = -radius; dx <= radius; dx++){
          const xx = x + dx;
          if(xx < 0 || xx >= res) continue;
          const j = yy*res + xx;
          if(source[j*4+3] <= 0) continue;
          const dl = lum(j) - lc;
          const p = weightSpace[dy + radius] * weightSpace[dx + radius] * Math.exp(-(dl*dl) * inv2sv);
          r += source[j*4] * p; g += source[j*4+1] * p; b += source[j*4+2] * p; somme += p;
        }
      }
      if(somme <= 0) continue;
      pixels[i*4] = r/somme; pixels[i*4+1] = g/somme; pixels[i*4+2] = b/somme;
    }
  }
}

// Linéarea → sRGB. La lightmap est relue comme une texture de COULEUR (v0.26.0), donc elle
// doit être encodée comme telle : l'écrire en linéaire donnerait un éclairage délavé.
export function toSrgb(c){
  if(c <= 0) return 0;
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1/2.4) - 0.055;
}

export async function exportLightmapInAsset(data, res, name, options){
  const o = options || {};
  // ORDRE : débruitage, PUIS coutures, PUIS dilatation. Chacun dépend du précédent.
  //   — le débruiteur a besoin du masque alpha intact pour ignorer le vide ;
  //   — le raccord de coutures doit travailler sur des valeurs déjà propres, sinon il
  //     propage le bruit d'un îlot à son voisin ;
  //   — la dilatation étale vers le vide et remplit l'alpha : elle vient en dernier, sinon
  //     les deux autres prendraient ses texels inventés pour des mesures.
  if(o.denoise !== false) denoiseBilateral(data, res, 2, 0.15);
  if(o.seams && o.seams.length) connectSeams(data, res, o.seams);
  dilate(data, res, 4);
  // HDR : le RGBM range l'irradiance sur une portée de 64 au lieu de 1, dans le même PNG
  // (js/lightmap-rgbm.js). Le retournement de lignes y est identique à celui de la sortie 8
  // bits juste en dessous — les deux encodages doivent produire la MÊME orientation, sinon
  // changer d'encodage déplacerait l'éclairage.
  if(o.rgbm){
    const bytes = encodeLightmapRgbm(data, res);
    const cv2 = document.createElement('canvas');
    cv2.width = res; cv2.height = res;
    cv2.getContext('2d').putImageData(new ImageData(bytes, res, res), 0, 0);
    const blob2 = await new Promise(function(r){ cv2.toBlob(r, 'image/png'); });
    const fichier2 = new File([blob2], name + '.png', {type:'image/png'});
    const old = assets.find(function(a){
      return a.kind === 'texture' && a.cuite && a.name === name + '.png';
    });
    if(old){
      forgetCacheRgbm(old);        // sinon la cuisson « ne changerait rien » à l'écran
      old.rgbm = true;
      return replaceContentAssetTexture(old, fichier2);
    }
    return createAssetTexture(fichier2, {name:name + '.png', cuite:true, rgbm:true});
  }

  // RETOURNEMENT VERTICAL, et il n'est pas cosmétique.
  //
  // Le relevé a sa ligne 0 en v = 0 (mesuré). Une ImageData a sa ligne 0 en HAUT. Et la
  // texture posée sur le matériau a `flipY = true`, comme toutes les textures d'image du
  // moteur — three retourne donc l'image à l'envoi. Écrire le relevé tel quel donnait un
  // atlas retourné une fois de trop.
  //
  // Ce n'était PAS un simple miroir visible à l'œil : le retournement s'applique à l'atlas
  // ENTIER, alors que la région d'un objet n'y est pas centrée. Chaque objet échantillonnait
  // donc à côté de sa propre région, avec un décalage qui dépend de sa place dans l'atlas.
  // Mesuré en comparant la position de l'ombre cuite à celle de l'ombre temps réel, cube
  // décalé : x juste à 0,018 près, y faux de 0,366. Invisible sur une scène symétrique —
  // c'est-à-dire sur la scène par défaut, où tout est centré.
  const img = new ImageData(res, res);
  for(let y = 0; y < res; y++){
    const src = y * res, dst = (res - 1 - y) * res;
    for(let x = 0; x < res; x++){
      const i = (src + x) * 4, j = (dst + x) * 4;
      // Le PNG plafonne à 1 : ce qui dépass est écrêté. Une scène très lumineuse perd donc
      // ses hautes lumières — c'est le prix d'une sortie 8 bits, et l'objet de l'encodage RGBM.
      img.data[j]     = Math.round(Math.min(1, toSrgb(data[i]))     * 255);
      img.data[j + 1] = Math.round(Math.min(1, toSrgb(data[i + 1])) * 255);
      img.data[j + 2] = Math.round(Math.min(1, toSrgb(data[i + 2])) * 255);
      img.data[j + 3] = 255;
    }
  }
  const cv = document.createElement('canvas');
  cv.width = res; cv.height = res;
  cv.getContext('2d').putImageData(img, 0, 0);
  const blob = await new Promise(function(r){ cv.toBlob(r, 'image/png'); });
  const file = new File([blob], name + '.png', {type:'image/png'});

  // Recuire REMPLACE la lightmap précédente au lieu d'en add une. Sans ça, dix essais
  // de réglage laissaient dix textures mortes dans le projet — et les matériaux pointant
  // toujours sur la première tant qu'on ne les rebranchait pas.
  //
  // On ne remplace que ce que la CUISSON a produit (`a.cuite`, posé par createAssetTexture et
  // persisté avec le projet). Une lightmap importée depuis Blender porte le même genre et
  // souvent le même nom : la reconnaître au nom l'aurait détruite au premier essai.
  const ancienne = assets.find(function(a){
    return a.kind === 'texture' && a.cuite && a.name === name + '.png';
  });
  if(ancienne){
    // Repasser de RGBM à 8 bits doit effacer les deux marques, sinon le matériau chercherait
    // encore à décoder du RGBM dans une image qui n'en contient plus.
    forgetCacheRgbm(ancienne);
    ancienne.rgbm = false;
    return replaceContentAssetTexture(ancienne, file);
  }
  return createAssetTexture(file, {name:name + '.png', cuite:true});
}

// ---------- 6. Les réglages ----------

// Deux nombres décident du coût, et ils ne coûtent pas la même chose : les IMAGES coûtent du
// temps, la RÉSOLUTION coûte de la mémoire — et beaucoup. Deux cibles flottantes RGBA font
// res² × 32 octets : 32 Mo en 1024, un demi-gigaoctet en 4096. C'est la seule limite de cette
// boîte qui peut faire tomber l'onglet, donc elle s'shown.
export function costBake(r){
  const passes = r.bounces + 1;
  return {
    rendered: passes * (r.images + 6),          // + 6 : les faces de la capture de rebond
    passes: passes,
    memoireMo: Math.round(r.resolution * r.resolution * 32 / 1048576)
  };
}

export function modalBakeLightmap(){
  if(lightmapBakeState.active){ setStatus('Une cuisson est déjà en cours', 2500); return; }
  const r = settingsLightmap();
  const sel = allSelection();
  const range = sel.length
    ? '<b>' + meshesBakeable(sel).length + ' maillage(s) sélectionné(s)</b>. Les objets non '
      + 'sélectionnés continueront de projeter leur ombre sur eux, sans occuper de place dans '
      + 'l\'atlas.'
    : '<b>Toute la scène</b> (' + meshesBakeable().length + ' maillages). Sélectionnez des '
      + 'objets avant d\'ouvrir cette fenêtre pour n\'en cuire qu\'une partie.';
  const choixRes = [256, 512, 1024, 2048, 4096].map(function(v){
    return '<option value="' + v + '"' + (v === r.resolution ? ' selected' : '') + '>'
      + v + ' × ' + v + '</option>';
  }).join('');
  openModal('Cuire les lightmaps',
    '<p style="margin-bottom:10px;line-height:1.5">Portée : ' + range + '</p>'
    + '<table>'
    + '<tr><td>Résolution de l\'atlas</td><td><select id="lm-res" style="width:100%">'
      + choixRes + '</select></td></tr>'
    + '<tr><td>Images accumulées</td><td><input type="number" id="lm-images" min="4" max="4000" '
      + 'step="4" value="' + r.images + '" style="width:100%"></td></tr>'
    + '<tr><td>Rebonds</td><td><input type="number" id="lm-bounces" min="0" max="3" '
      + 'value="' + r.bounces + '" style="width:100%"></td></tr>'
    + '<tr><td>Douceur des ombres</td><td><input type="number" id="lm-smooth" min="0" max="2" '
      + 'step="0.05" value="' + r.smooth + '" style="width:100%"></td></tr>'
    + '<tr><td>Hautes lumières (HDR)</td><td><label><input type="checkbox" id="lm-rgbm"'
      + (r.rgbm ? ' checked' : '') + '> encodage RGBM — portée 64 au lieu de 1</label></td></tr>'
    + '<tr><td>Débruitage</td><td><label><input type="checkbox" id="lm-denoise"'
      + (r.denoise ? ' checked' : '') + '> filtre bilatéral, préserve les bords d\'ombre</label></td></tr>'
    + '</table>'
    + '<p id="lm-cost" style="margin-top:10px;line-height:1.5"></p>'
    + '<p style="margin-top:8px;line-height:1.5;color:var(--txt-dim)">'
    + 'Les <b>images</b> coûtent du temps : la moyenne converge en 1/N, donc doubler ne divise '
    + 'le bruit que par √2. Les <b>rebonds</b> apportent l\'éclairage indirect, et chacun ne '
    + 'vaut plus grand-chose au-delà du premier — le 2ᵉ pèse l\'albédo au carré. La '
    + '<b>douceur</b> secoue les lampes d\'une image à l\'autre : à 0 les ombres sont dures.'
    + '</p>'
    + '<div style="display:flex;gap:8px;margin-top:12px;justify-content:flex-end">'
    + '<button class="btn-modal" id="lm-cancel">Annuler</button> '
    + '<button class="btn-modal accent" id="lm-bake">💡 Cuire</button></div>');

  const read = function(){
    return {
      resolution: parseInt(document.getElementById('lm-res').value, 10) || LIGHTMAP_DEFAULT.resolution,
      images: Math.max(4, parseInt(document.getElementById('lm-images').value, 10) || LIGHTMAP_DEFAULT.images),
      bounces: Math.min(3, Math.max(0, parseInt(document.getElementById('lm-bounces').value, 10) || 0)),
      smooth: Math.max(0, parseFloat(document.getElementById('lm-smooth').value) || 0),
      rgbm: document.getElementById('lm-rgbm').checked,
      denoise: document.getElementById('lm-denoise').checked
    };
  };
  const updateCost = function(){
    const c = costBake(read());
    document.getElementById('lm-cost').innerHTML =
      '<b>' + c.rendered + '</b> rendus à faire, en ' + c.passes + ' passe(s) — et <b>'
      + c.memoireMo + ' Mo</b> de cibles de rendu.'
      + (c.memoireMo > 200 ? ' <span style="color:var(--danger,#e06c6c)">À cette résolution, '
         + 'l\'onglet peut manquer de mémoire.</span>' : '');
  };
  ['lm-res', 'lm-images', 'lm-bounces', 'lm-smooth'].forEach(function(id){
    document.getElementById(id).addEventListener('input', updateCost);
  });
  updateCost();

  document.getElementById('lm-cancel').addEventListener('click', closeModal);
  document.getElementById('lm-bake').addEventListener('click', function(){
    project.lightmap = read();
    updateProject();               // les réglages font partie du projet : il devient à sauvegarder
    closeModal();
    // La sélection relevée à l'OUVERTURE, pas au clic : ce qui est cuit est exactement ce que
    // la fenêtre a annoncé, même si quelque chose l'a modifiée entre-temps.
    bakeLightmap({selection: sel}).catch(function(e){
      console.error(e);
      setStatus('Cuisson interrompue : ' + e.message, 8000);
    });
  });
}

// Un maillage tient son matériau de DEUX façons, et il faut lire les deux.
//
//   1. Par OBJET — primitives, matériau déposé sur un objet : `o.userData.materiauId`, qu'il
//      faut chercher en remontant la hiérarchie (applyMaterialOn, js/materials.js).
//   2. Par EMPLACEMENT — modèles importés : chaque matériau porte son asset dans
//      `m.userData.materiauAsset` (applyMaterialsModel, js/import-settings.js), et
//      l'objet ne porte RIEN pour cet emplacement.
//
// La première version ne lisait que (1). Un `.glb` était donc cuit — ses maillages
// occupaient leur région d'atlas et consommaient de la résolution — puis la lightmap allait
// sur le matériau d'objet au lieu de ceux réellement utilisés par ses emplacements. Vérifié
// à la main avant correction : link `materiauAsset` présent, aucun `materiauId` en
// remontant, lightmap non affectée. Aucun message.
//
// L'emplacement PRIME sur l'objet : c'est lui qui décide de ce qui est réellement rendu.
export function assetsMaterialsOf(mesh){
  const ids = [];
  let withoutAsset = 0;
  listMats(mesh).forEach(function(m){
    if(m && m.userData && m.userData.materialAsset) ids.push(m.userData.materialAsset);
    else withoutAsset++;
  });
  if(!ids.length){
    let o = mesh;
    while(o && !o.userData.materialId) o = o.parent;
    if(o && o.userData.materialId){ return {ids:[o.userData.materialId], withoutAsset:0}; }
  }
  return {ids:ids, withoutAsset:withoutAsset};
}

// Tous les matériaux portés par les objets cuits reçoivent la MÊME map : c'est un atlas,
// chaque objet y a sa région via son uv1. C'est aussi ce qui rend l'atlas obligatoire —
// `lightmapAsset` est une propriété de matériau, et un matériau peut être partagé.
export function assignLightmapToMaterials(meshes, asset){
  const vus = new Set();
  let orphelins = 0;
  meshes.forEach(function(mesh){
    const r = assetsMaterialsOf(mesh);
    orphelins += r.withoutAsset;
    r.ids.forEach(function(id){
      if(vus.has(id)) return;
      vus.add(id);
      const ma = assets.find(function(x){ return x.id === id && x.kind === 'material'; });
      if(!ma) return;
      const p = ensurePropsMaterial(ma);
      p.lightmapAsset = asset.id;
      p.lightmapUv = 1;
      applyMaterialEverywhere(ma);
    });
  });
  // Un emplacement de modèle laissé sur le matériau DU FICHIER n'est pas un asset du projet :
  // il n'y a rien où écrire `lightmapAsset`. Ces surfaces sont cuites mais resteront sans
  // éclairage précalculé, au milieu de voisines qui en ont — ça se voit, et il vaut mieux
  // l'annoncer que de laisser chercher.
  if(orphelins){
    setStatus(orphelins + ' emplacement(s) de matériau viennent du fichier de modèle et non '
      + 'du projet : ces surfaces ne recevront pas la lightmap. Affectez-leur un matériau du '
      + 'projet pour qu\'elles la reçoivent.', 9000);
  }
  return {materials:vus.size, orphelins:orphelins};
}
