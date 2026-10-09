// moteur/js/sky-camera.js
//
// LE CIEL VU PAR UNE CAMÉRA ORTHOGRAPHIQUE (toute caméra 2D). Partagé par l'éditeur
// (environment.js / viewport.js) et le jeu publié (game-runtime.js) : une seule règle, sinon la
// vue et le jeu finiraient par montrer deux ciels différents.
//
// Un fond équirectangulaire (dégradé, panorama) est une sphère autour d'une caméra PERSPECTIVE :
// vu par une caméra orthographique, three ne le dessine pas correctement — le ciel « Dégradé »
// d'une scène 2D ne s'affichait pas, et le régler ne changeait rien à l'écran (signalé cinq
// fois). Pour une caméra orthographique, le même ciel devient une image PLEIN ÉCRAN (UVMapping) :
// haut de l'image en haut de l'écran, bas en bas. Copie faite une fois, rangée sur l'original.
export function backgroundForCamera(fond, cam){
  if(!fond || !fond.isTexture || !cam || !cam.isOrthographicCamera) return fond;
  if(!fond.userData.flat){
    const t = fond.clone();
    t.mapping = THREE.UVMapping;
    if(t.image && t.image.complete !== false) t.needsUpdate = true;
    fond.userData.flat = t;
  }
  return fond.userData.flat;
}

/** Le fond posé sur la scène est-il ce ciel-là (original ou copie plein écran) ? */
export function isSkyBackground(current, fond){
  return !!fond && (current === fond || (fond.isTexture && current === fond.userData.flat));
}
