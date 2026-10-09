// ---------- Lightmaps HDR : encodage RGBM ----------
//
// PARTAGÉ entre l'éditeur et le jeu publié. Chargé par editor.html, game-preview.html et le
// build (js/build.js) : une lightmap encodée doit se décoder à l'identique des deux côtés,
// sinon le jeu n'a pas l'éclairage de la vue d'édition.
//
// LE PROBLÈME. Un PNG porte 8 bits par canal, donc des valeurs de 0 à 1. Or l'irradiance d'une
// scène ne s'arrête pas à 1 : une fenêtre au soleil, un néon, un projecteur la dépassent
// largement. Tout écrêter à 1 rabat les hautes lumières sur un plateau uniforme — la nuance
// entre « lumineux » et « éblouissant » disparaît.
//
// LA SOLUTION. RGBM range une valeur HDR dans quatre octets : les trois premiers gardent la
// couleur, le quatrième un MULTIPLICATEUR commun. La portée pass ainsi de 1 à PORTÉE² (64
// ici), au prix de la précision sur les valeurs moyennes.
//
// La racine carrée avant division n'est pas décorative : elle répartit la précision des 8 bits
// vers les valeurs BASSES, où l'œil distingue le plus. Sans elle, une lightmap de sous-sol
// serait quantifiée en marches visibles. C'est la variante RGBM classique des cuiseurs de
// lightmaps, à portée 8 ; le décodage lui est strictement symétrique.
//
// POURQUOI PAS DE SHADER. Décoder au rendu demanderait d'intercepter l'échantillonnage de la
// lightmap, donc des matériaux à nœuds — nos matériaux sont des MeshStandardMaterial
// classiques, sans point d'accroche (vérifié : `lightMapNode`, `outputNode` absents,
// `NodeMaterial.fromMaterial` indisponible dans ce bundle). On décode donc UNE FOIS au
// chargement, vers une texture demi-flottante que three échantillonne normalement.

export const RGBM_RANGE = 8;   // portée linéaire = PORTÉE² = 64

// Linéarea → RGBM, dans l'ordre d'une ImageData (ligne 0 en haut).
//
// Le relevé de la cuisson a sa ligne 0 en v = 0 (mesuré), et une ImageData sa ligne 0 en haut :
// on retourne donc les lignes, exactement comme le fait la sortie 8 bits classique. Les deux
// encodages doivent produire la MÊME orientation, sinon changer d'encodage déplacerait
// l'éclairage.
export function encodeLightmapRgbm(data, res){
  const out = new Uint8ClampedArray(res * res * 4);
  for(let y = 0; y < res; y++){
    const src = y * res, dst = (res - 1 - y) * res;
    for(let x = 0; x < res; x++){
      const i = (src + x) * 4, j = (dst + x) * 4;
      const r = Math.sqrt(Math.max(0, data[i]))     / RGBM_RANGE;
      const g = Math.sqrt(Math.max(0, data[i + 1])) / RGBM_RANGE;
      const b = Math.sqrt(Math.max(0, data[i + 2])) / RGBM_RANGE;
      // Le texel noir est traité À PART, explicitement.
      //
      // Et il faut le dire : AUCUN test ne peut distinguer cette branche de son absence. Sans
      // elle, `0/0` donne NaN, et un NaN écrit dans un Uint8ClampedArray vaut déjà 0 — la
      // sortie est identique au bit près. Ce n'est donc pas une garde, c'est une intention
      // rendue lisible, et une protection si le tampon de sortie change un jour de type (un
      // Float32Array, lui, garderait le NaN et propagerait du noir NaN dans toute la texture).
      // Une branche qu'on ne peut pas tester doit au moins dire pourquoi elle est là.
      let m = Math.max(r, g, b);
      if(m <= 0){ out[j] = out[j+1] = out[j+2] = out[j+3] = 0; continue; }
      if(m > 1) m = 1;                       // au-delà de PORTÉE², on écrête — mais 64, pas 1
      m = Math.ceil(m * 255) / 255;          // arrondi VERS LE HAUT : garantit r/m ≤ 1
      out[j]     = Math.round(Math.min(1, r / m) * 255);
      out[j + 1] = Math.round(Math.min(1, g / m) * 255);
      out[j + 2] = Math.round(Math.min(1, b / m) * 255);
      out[j + 3] = Math.round(m * 255);
    }
  }
  return out;
}

// RGBM → demi-flottant linéaire, prêt pour une DataTexture.
//
// Les lignes sont RETOURNÉES une seconde fois. Une texture d'image porte `flipY = true` dans
// ce moteur et three la retourne à l'envoi ; une DataTexture, non. Pour que les deux chemins
// échantillonnent au même endroit, il faut donc rendre ici le retournement que l'encodage a
// appliqué. Se tromper là-dessus ne lève aucune erreur : l'éclairage se décale, et sur une
// scène symétrique ça ne se voit même pas.
export function decodeLightmapRgbm(bytes, width, height){
  const out = new Uint16Array(width * height * 4);
  const half = THREE.DataUtils.toHalfFloat;
  const un = half(1);
  for(let y = 0; y < height; y++){
    const src = y * width, dst = (height - 1 - y) * width;
    for(let x = 0; x < width; x++){
      const i = (src + x) * 4, j = (dst + x) * 4;
      const m = (bytes[i + 3] / 255) * RGBM_RANGE;
      // Symétrique de l'encodage : on remultiplie, puis on défait la racine par un carré.
      const r = (bytes[i]     / 255) * m;
      const g = (bytes[i + 1] / 255) * m;
      const b = (bytes[i + 2] / 255) * m;
      out[j]     = half(r * r);
      out[j + 1] = half(g * g);
      out[j + 2] = half(b * b);
      out[j + 3] = un;
    }
  }
  return out;
}

// Les pixels d'un asset texture, lus via un canvas. `asset.imageSource` est posé par le
// chargeur, donc seulement quand l'image est décodée — d'où le retour null, que l'appelant
// doit traiter au lieu de fabriquer une texture vide.
// `imageSource` est posé par l'éditeur ; le runtime, lui, ne construit pas ses assets de la
// même façon et n'a que `texture.image`. On lit les deux, sinon le jeu publié n'aurait aucune
// lightmap HDR — et sans erreur, puisque l'absence d'image est un cas prévu.
export function pixelsAssetTexture(asset){
  const img = (asset && asset.imageSource)
    || (asset && asset.texture && asset.texture.image) || null;
  if(!img || !img.width) return null;
  const cv = document.createElement('canvas');
  cv.width = img.width;
  cv.height = img.height;
  const cx = cv.getContext('2d', {willReadFrequently:false});
  cx.drawImage(img, 0, 0);
  return cx.getImageData(0, 0, img.width, img.height);
}

// La texture prête à brancher sur `material.lightMap`, décodée et mise en hidden sur l'asset.
//
// Le hidden n'est pas une optimisation de confort : sans lui, chaque reconstruction de matériau
// — et il y en a une à chaque modification — relancerait un décodage CPU de toute l'image.
export function textureLightmapRgbm(asset){
  if(asset.__texRgbm) return asset.__texRgbm;
  const img = pixelsAssetTexture(asset);
  if(!img) return null;
  const data = decodeLightmapRgbm(img.data, img.width, img.height);
  const tex = new THREE.DataTexture(data, img.width, img.height,
                                    THREE.RGBAFormat, THREE.HalfFloatType);
  // Espace LINÉAIRE, et c'est une différence de fond avec une lightmap importée. Celle-ci est
  // une image de couleur, donc sRGB (v0.26.0). Un RGBM n'est pas une couleur, c'est un
  // encodage : le lire en sRGB appliquerait une seconde correction de gamma à des valeurs qui
  // ont déjà été mises à la racine carrée, et l'éclairage sortirait délavé.
  tex.colorSpace = THREE.NoColorSpace;
  tex.flipY = false;      // le retournement est déjà fait dans les données — voir decoder…()
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  asset.__texRgbm = tex;
  return tex;
}

// À appeler quand le contenu de l'asset change (nouvelle cuisson) : sinon le hidden rendrait
// l'ancienne image, et l'utilisateur verrait sa cuisson « ne rien changer ».
export function forgetCacheRgbm(asset){
  if(asset && asset.__texRgbm){
    asset.__texRgbm.dispose();
    asset.__texRgbm = null;
  }
}


// EXPOSÉ EN GLOBALE, à dessein. Ces symboles sont appelés depuis des fichiers
// que les mêmes pages ne chargent pas toutes : un `import` y pointerait un
// fichier absent, et la page ne démarrerait pas. Ils gardent donc leur garde
// `typeof` côté appelant, et se déclarent ici.
globalThis.encodeLightmapRgbm = encodeLightmapRgbm;
globalThis.forgetCacheRgbm = forgetCacheRgbm;
globalThis.textureLightmapRgbm = textureLightmapRgbm;