// moteur/js/editor-camera.js
//
// La caméra d'ÉDITION et sa projection. Elle était une PerspectiveCamera en dur : travailler en
// 2D exigeait donc un onglet séparé avec sa propre caméra, sa propre grille et ses propres
// gestes — soit un second éditeur à maintenir à côté du premier.

/** La caméra d'édition initiale. */
export function createEditorCamera(){
  // Les MÊMES réglages qu'avant (fov 55, near 0.1, far 500) : ce lot change la projection, pas
  // le cadrage. Changer le champ de vision au passage se verrait tout de suite.
  const c = new THREE.PerspectiveCamera(55, 1, 0.1, 500);
  c.layers.enableAll();   // elle voit tout, y compris LAYER_HELPERS
  return c;
}

/**
 * Échange la projection en CONSERVANT la taille apparente à la distance d'orbite.
 *
 * La formule : à distance `d` et champ `fov`, la demi-hauteur vue vaut d·tan(fov/2). C'est elle
 * qu'on reporte en `top`/`bottom` de l'orthographique. Sans cette conservation, la bascule
 * change brutalement le zoom et se lit comme un défaut de navigation.
 *
 * Elle REND une nouvelle caméra sans muter l'ancienne : perspective et orthographique sont deux
 * classes three distinctes. C'est pour ça que `setEditorCamera` doit recâbler ce qui la capture.
 */
export function setEditorProjection(cam, projection, opts){
  opts = opts || {};
  const d = opts.distance, fov = opts.fov || 50, aspect = opts.aspect || 1;
  let c;
  if(projection === 'orthographic'){
    const h = d * Math.tan((fov * Math.PI / 180) / 2);
    c = new THREE.OrthographicCamera(-h * aspect, h * aspect, h, -h, cam.near, cam.far);
  } else {
    c = new THREE.PerspectiveCamera(fov, aspect, cam.near, cam.far);
  }
  c.position.copy(cam.position);
  c.quaternion.copy(cam.quaternion);
  c.layers.mask = cam.layers.mask;
  c.updateProjectionMatrix();
  return c;
}
