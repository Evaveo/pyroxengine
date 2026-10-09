// ---------- Caméras en INCRUSTATION : une mini-carte, un rétroviseur, une vue secondaire ----------
//
// Né d'un jeu de stratégie (2026-09-29) : la mini-carte était dessinée point par point dans un
// canevas par le script du jeu — du contenu en code, que personne ne voyait dans la scène. Ici, la
// mini-carte est une CAMÉRA de la scène (vue de dessus, orthographique, ses propres calques), posée
// et réglée dans l'éditeur comme n'importe quel objet ; son composant Camera porte un rectangle
// d'affichage `viewport {x, y, w, h}` normalisé (0..1, origine en BAS à gauche, comme Unity).
//
// Rendu APRÈS l'image principale, dans l'ordre de la scène. La caméra principale n'est jamais
// incrustée. Aucune dépendance au DOM ni à THREE.

/** Un rectangle d'affichage valide, borné à l'écran, ou `null`. */
export function normalizeViewport(v){
  if(!v || typeof v !== 'object') return null;
  const n = function(k, d){ const x = Number(v[k]); return isFinite(x) ? x : d; };
  const x = Math.max(0, Math.min(1, n('x', 0))), y = Math.max(0, Math.min(1, n('y', 0)));
  const w = Math.max(0, Math.min(1 - x, n('w', 0))), h = Math.max(0, Math.min(1 - y, n('h', 0)));
  return (w > 0.001 && h > 0.001) ? {x: x, y: y, w: w, h: h} : null;
}

/** Le rectangle en pixels CSS (ce qu'attendent setViewport/setScissor de three). */
export function viewportPixels(vp, width, height){
  return {x: Math.round(vp.x * width), y: Math.round(vp.y * height),
          w: Math.max(1, Math.round(vp.w * width)), h: Math.max(1, Math.round(vp.h * height))};
}

/**
 * Rend, par-dessus l'image déjà produite, chaque caméra active qui porte un `viewport`.
 * `nodes` : les porteurs d'un composant Camera (Registry.activeNodes('Camera')).
 * Rend le nombre de caméras incrustées.
 */
export function renderCameraOverlays(renderer, scene, mainCam, nodes){
  if(!renderer || !nodes || !nodes.length) return 0;
  // Taille en pixels CSS, lue sur le canevas : c'est ce qu'attendent setViewport/setScissor.
  const el = renderer.domElement, pr = renderer.getPixelRatio ? renderer.getPixelRatio() : 1;
  const W = el.width / pr, H = el.height / pr;
  let n = 0;
  nodes.forEach(function(node){
    const comp = node.getComponent && node.getComponent('Camera');
    const cam = node.userData && node.userData.cam;
    if(!comp || !cam || cam === mainCam) return;
    const vp = normalizeViewport(comp.data && comp.data.viewport);
    if(!vp) return;
    const px = viewportPixels(vp, W, H), aspect = px.w / px.h;
    if(cam.isPerspectiveCamera){
      if(cam.aspect !== aspect){ cam.aspect = aspect; cam.updateProjectionMatrix(); }
    } else if(cam.isOrthographicCamera){
      const hh = Number(comp.data.orthoSize) || 5;
      if(cam.top !== hh || cam.right !== hh * aspect){
        cam.top = hh; cam.bottom = -hh; cam.left = -hh * aspect; cam.right = hh * aspect;
        cam.updateProjectionMatrix();
      }
    }
    renderer.setViewport(px.x, px.y, px.w, px.h);
    renderer.setScissor(px.x, px.y, px.w, px.h);
    renderer.setScissorTest(true);
    renderer.render(scene, cam);
    n++;
  });
  if(n){
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, W, H);
  }
  return n;
}
