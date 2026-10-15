// moteur/js/environment-map.js
//
// LE CIEL ET LES REFLETS, PARTAGÉS ÉDITEUR ↔ JEU PUBLIÉ. Ce que le ciel pose sur une scène
// (fond, rotation, exposition), ce qu'un reflet pose sur un matériau, et la lecture d'une image
// HDR (.hdr, .exr). Une seule écriture pour les deux moteurs : le jeu publié doit montrer le ciel
// que la vue d'édition montre, et refléter les mêmes sondes.
//
// AUCUN IMPORT, à dessein (règle 1 du graphe de modules, docs/ARCHITECTURE.md) : ce fichier est
// chargé par les trois pages. Il ne touche que `THREE`, posé en global par les vendors, et le
// `document` du dégradé de ciel.

// ---------- 1. La clé de pipeline d'un matériau qui reçoit un reflet ----------
//
// LE DÉFAUT QUI A FAIT NAÎTRE CETTE FONCTION : « la cuisson des sondes ne fonctionne pas ».
// La sonde cuisait bel et bien (l'inspecteur disait « cuite · 4 objet(s) couvert(s) ») et rien
// ne changeait à l'écran. La cause est dans le renderer WebGPU de three (r185), pas dans la
// cuisson :
//
//   1. Un matériau qui reçoit une `envMap` est compilé avec un EnvironmentNode qui lit la
//      texture EN PLACE au moment de la compilation (`material[property]`) et en tire son
//      PMREM. Le nœud ne relit jamais `envMap` ensuite.
//   2. `needsUpdate = true` ne recompile que si la clé de cache du matériau change. Or cette
//      clé ne voit d'une texture que son `mapping`, ses filtres et ses répétitions — pas QUELLE
//      texture. Le cube du ciel et celui d'une sonde ont exactement les mêmes : même clé, donc
//      `renderObject.version = material.version` et rien n'est recompilé.
//   3. Et la clé ne contient pas non plus l'identité du matériau : deux objets de réglages
//      identiques partagent le MÊME programme, donc le même PMREM — celui du premier compilé.
//
// Depuis que le ciel sert de sonde par défaut (2026-08-08), TOUT matériau standard est compilé
// une première fois avec le cube du ciel. Poser ensuite le cube d'une sonde ne changeait donc
// rien, sans erreur ni avertissement : chaque objet continuait de refléter le ciel. Même chose
// entre deux sondes de même résolution, et pour la projection boîte (`envNode`).
//
// Le remède : faire entrer l'identité de l'environnement dans la clé, par le seul point
// d'extension que three prévoit pour ça, `customProgramCacheKey`. La fonction d'origine est
// gardée et appelée (le lissage de materials.js en pose une à lui) ; la nôtre n'y ajoute qu'un
// suffixe. Elle est reposée si quelqu'un l'a remplacée depuis.
const ENV_KEY_FUNCTIONS = new WeakMap();   // matériau → la fonction de clé posée ici
const ENV_IDENTITIES = new WeakMap();      // texture ou nœud → numéro stable pour la session
let envIdentityNext = 0;

function envIdentity(x){
  let id = ENV_IDENTITIES.get(x);
  if(id === undefined){ id = ++envIdentityNext; ENV_IDENTITIES.set(x, id); }
  return id;
}

/** Ce qui distingue l'environnement de ce matériau d'un autre : le nœud de boîte, sinon l'envMap. */
export function environmentKeyOf(m){
  if(m && m.envNode) return 'n' + envIdentity(m.envNode);
  if(m && m.envMap) return 't' + envIdentity(m.envMap);
  return '-';
}

/**
 * Fait entrer l'environnement du matériau dans sa clé de pipeline (voir plus haut). Idempotente :
 * rend `false` quand la clé est déjà la nôtre. NON énumérable, pour ne pas entrer elle-même dans
 * la clé que three calcule en parcourant les propriétés du matériau.
 */
export function bindEnvironmentKey(m){
  if(!m || typeof m.customProgramCacheKey !== 'function') return false;
  if(ENV_KEY_FUNCTIONS.get(m) === m.customProgramCacheKey) return false;
  const base = m.customProgramCacheKey;
  const keyed = function(){ return base.call(this) + '|env:' + environmentKeyOf(this); };
  ENV_KEY_FUNCTIONS.set(m, keyed);
  Object.defineProperty(m, 'customProgramCacheKey',
    {value: keyed, writable: true, configurable: true, enumerable: false});
  return true;
}

// Quels matériaux acceptent un environnement. On les NOMME, plutôt que de tester la présence
// d'un champ : `'envMap' in m` est vrai pour TOUS les matériaux de three, y compris
// MeshBasicMaterial — dont la couleur est alors MULTIPLIÉE par le ciel (`combine` vaut
// MultiplyOperation). Le jeu publié testait encore `'envMap' in m` : un matériau « non éclairé »
// y sortait assombri par le ciel alors que la vue d'édition le montrait juste.
export function acceptsEnvironment(m){
  return !!m && (m.isMeshStandardMaterial === true || m.isMeshPhysicalMaterial === true);
}

// ---------- Retirer un reflet : JAMAIS `envMap = null` sur un matériau déjà rendu ----------
//
// three r185 (`NodeMaterialObserver`, lu dans vendor-esm/three.webgpu.min.js) photographie, par
// matériau et pour TOUTE sa vie, chaque texture de sa liste `refreshUniforms` qu'il a vue non
// nulle — dans une WeakMap que rien ne vide, `dispose()` compris. Remettre `envMap` à null fait
// ensuite lire `null.isTexture` dans `equals()` à chaque image : « Cannot read properties of null
// (reading 'isTexture') » dans la boucle de rendu (décocher « reflets du ciel »). Le `dispose()`
// posé en v0.108.0 ne protégeait plus rien depuis la montée en r185.
//
// On pose donc une texture NEUTRE (cube 1 px, noir) avec une intensité 0 : aucune contribution,
// et l'observateur garde une texture à comparer. Une par renderer : une texture GPU appartient au
// device qui l'a créée.
const NEUTRAL_ENVIRONMENTS = new WeakMap();   // renderer → texture neutre

export function neutralEnvironment(renderer, makeCube){
  let tex = NEUTRAL_ENVIRONMENTS.get(renderer);
  if(tex) return tex;
  const rt = makeCube(1);
  // Une cible jamais rendue n'a pas de texture GPU : on efface ses six faces une fois.
  const before = renderer.getRenderTarget ? renderer.getRenderTarget() : null;
  for(let face = 0; face < 6; face++){
    renderer.setRenderTarget(rt, face);
    renderer.clear();
  }
  renderer.setRenderTarget(before);
  tex = rt.texture;
  tex.userData.neutralEnvironment = true;
  NEUTRAL_ENVIRONMENTS.set(renderer, tex);
  return tex;
}

/** Le matériau reçoit-il un vrai reflet (pas la texture neutre) ? */
export function hasEnvironment(m){
  return !!(m && (m.envNode || (m.envMap && !(m.envMap.userData && m.envMap.userData.neutralEnvironment))));
}

/** Retire le reflet d'un matériau sans jamais écrire `null` dans `envMap` (voir plus haut). */
export function removeEnvironmentFrom(m, neutral){
  if(m.envNode) m.envNode = null;
  if(m.envMap){ m.envMap = neutral; m.envMapIntensity = 0; }
  m.needsUpdate = true;
}

// ---------- 2. Les images HDR (HDRI) ----------
//
// Un panorama .hdr (RGBE) ou .exr porte de la LUMIÈRE, pas une image : des valeurs bien au-delà
// de 1 (un soleil à 50 000). Le navigateur ne sait pas les décoder dans une balise <img> — d'où
// les lecteurs de three (HDRLoader, EXRLoader), embarqués dans vendor/three-addons.min.js
// (vendor/RECETTE-addons.md). Toujours en DEMI-FLOTTANT : filtrable partout, contrairement au
// flottant 32 bits, qui exige une extension WebGPU que tous les GPU n'ont pas.

/** Le nom de fichier désigne-t-il une image HDR ? */
export function isHdrFileName(name){
  return /\.(hdr|exr)$/i.test(name || '');
}

/** Une texture à grande dynamique : jamais sRGB, jamais réduite par un canvas. */
export function isHdrTexture(tex){
  return !!tex && (tex.type === THREE.HalfFloatType || tex.type === THREE.FloatType);
}

/** Lit les octets d'un .hdr ou d'un .exr en une DataTexture demi-flottante, linéaire. */
export function textureFromHdr(buffer, name){
  const exr = /\.exr$/i.test(name || '');
  const Loader = exr ? THREE.EXRLoader : THREE.HDRLoader;
  if(typeof Loader !== 'function'){
    throw new Error('lecteur ' + (exr ? 'EXR' : 'HDR') + ' absent : vendor/three-addons.min.js '
      + 'n\'est pas chargé, ou date d\'avant le ciel HDRI');
  }
  const tex = new Loader().setDataType(THREE.HalfFloatType).createDataTexture(buffer);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.name = name || '';
  return tex;
}

/** Une texture tirée d'un fichier : HDR lu par three, le reste par le navigateur (<img>). */
export function loadTextureFile(blob, name, url){
  if(isHdrFileName(name)){
    return blob.arrayBuffer().then(function(buffer){ return textureFromHdr(buffer, name); });
  }
  return new Promise(function(resolve, reject){
    new THREE.TextureLoader().load(url, resolve, undefined, reject);
  });
}

/**
 * Une vignette 8 bits d'une texture HDR, pour le panneau Projet et l'inspecteur : la lumière y
 * est ramenée dans [0, 1] (Reinhard), puis encodée en sRGB. PURE : rend des pixels RGBA, le
 * dessin dans un canvas est l'affaire de l'appelant.
 */
export function hdrPreviewPixels(tex, maxWidth){
  const img = tex && tex.image;
  if(!img || !img.data || !img.width || !img.height) return null;
  const width = Math.max(1, Math.min(maxWidth || 256, img.width));
  const height = Math.max(1, Math.round(img.height * width / img.width));
  const channels = tex.format === THREE.RedFormat ? 1 : (tex.format === THREE.RGFormat ? 2 : 4);
  const half = tex.type === THREE.HalfFloatType;
  const read = function(i){ return half ? THREE.DataUtils.fromHalfFloat(img.data[i]) : img.data[i]; };
  const encode = function(v){
    const x = v > 0 ? v / (1 + v) : 0;
    const s = x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
    return Math.round(Math.max(0, Math.min(1, s)) * 255);
  };
  const out = new Uint8ClampedArray(width * height * 4);
  for(let y = 0; y < height; y++){
    // `flipY` dit où est le haut : vrai (HDR), la ligne 0 des données est le haut de l'image ;
    // faux (EXR, que three range déjà de bas en haut), c'est le bas.
    const sy = Math.min(img.height - 1, Math.floor(y * img.height / height));
    const row = tex.flipY ? sy : img.height - 1 - sy;
    for(let x = 0; x < width; x++){
      const sx = Math.min(img.width - 1, Math.floor(x * img.width / width));
      const i = (row * img.width + sx) * channels;
      const r = read(i);
      const g = channels > 1 ? read(i + 1) : r;
      const b = channels > 2 ? read(i + 2) : r;
      const o = (y * width + x) * 4;
      out[o] = encode(r); out[o + 1] = encode(g); out[o + 2] = encode(b); out[o + 3] = 255;
    }
  }
  return {width: width, height: height, data: out};
}

// ---------- 3. Le ciel de la scène ----------

export const SKY_EXPOSURE_MAX = 8;   // la borne du Skybox/Panoramic d'Unity

/** Exposition du ciel (multiplicateur de sa lumière), bornée ; 1 pour un env d'avant le champ. */
export function skyExposureOf(e){
  const v = Number(e && e.skyExposure);
  return (isFinite(v) && v >= 0) ? Math.min(SKY_EXPOSURE_MAX, v) : 1;
}

/** Rotation du ciel autour de l'axe vertical, en degrés ; 0 pour un env d'avant le champ. */
export function skyRotationOf(e){
  const v = Number(e && e.skyRotation);
  return isFinite(v) ? v : 0;
}

/**
 * Le FOND d'une scène : une couleur unie, ou une texture équirectangulaire (dégradé, panorama,
 * HDRI) pour `scene.background`. `textureOf(id)` rend la texture d'un asset, ou null — chaque
 * moteur range ses assets à sa façon.
 *
 * Écrit UNE fois pour l'éditeur (environment.js) et le jeu publié (game-runtime.js), qui en
 * portaient chacun une copie : le reflet du ciel, cuit à partir de ce fond, doit montrer le
 * ciel qu'on voit derrière les objets.
 */
export function skyBackgroundFor(e, textureOf){
  if(e.sky === 'gradient'){
    const cv = document.createElement('canvas');
    cv.width = 16; cv.height = 256;
    const cx = cv.getContext('2d');
    const g = cx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, e.skyTop || '#6ea8dc');
    g.addColorStop(1, e.skyBottom || '#dfe9f2');
    cx.fillStyle = g;
    cx.fillRect(0, 0, 16, 256);
    const tex = new THREE.CanvasTexture(cv);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    if(THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }
  if(e.sky === 'image' && e.skyAsset){
    const source = textureOf ? textureOf(e.skyAsset) : null;
    if(source){
      // CLONE : la cuisson du reflet libère la texture qu'elle a posée en fond, et libérer la
      // texture d'asset partagée éteindrait le ciel de toute la scène.
      const tex = source.clone();
      tex.mapping = THREE.EquirectangularReflectionMapping;
      // Une HDRI est déjà linéaire : la marquer sRGB la décoderait une seconde fois.
      if(!isHdrTexture(tex) && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
      // Image pas encore décodée : la marquer ferait planter WebGPU (voir markTextureDirty).
      if(tex.image && tex.image.complete !== false) tex.needsUpdate = true;
      return tex;
    }
  }
  return new THREE.Color(e.skyColor || '#9fc4e8');
}

/**
 * Rotation et exposition du ciel, posées sur une SCÈNE (le « Rotation » et l'« Exposure » du
 * Skybox/Panoramic d'Unity). Sur la scène et pas sur la texture : c'est ce que three lit, et
 * c'est ce qui permet de les poser aussi sur la scène jetable de la cuisson du reflet — le reflet
 * tourne et s'éclaire avec le ciel. Seul un panorama est concerné : un dégradé n'a rien à
 * tourner, et une couleur unie n'est pas une texture.
 */
export function applySkyFraming(sc, e){
  if(!sc) return;
  const image = !!e && e.sky === 'image';
  if(sc.backgroundRotation && sc.backgroundRotation.set){
    sc.backgroundRotation.set(0, image ? skyRotationOf(e) * Math.PI / 180 : 0, 0);
  }
  sc.backgroundIntensity = image ? skyExposureOf(e) : 1;
}
