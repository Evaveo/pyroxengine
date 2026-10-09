// ---------- L'OMBRE D'UNE DIRECTIONNELLE : la caler sur la SCÈNE, pas sur rien ----------
//
// LE BUG MESURÉ (v0.108.0). Une lumière directionnelle éclaire toute la scène — un éclairage
// directionnel est indépendant de la distance. Son OMBRE, elle, ne portait que sur 10 × 10
// unités monde : c'est la caméra orthographique que three.js donne par défaut à
// `DirectionalLightShadow`, `(-5, 5, 5, -5, 0.5, 500)`, et rien dans le moteur ne la
// redimensionnait — `js/objects.js` et `js/components/component-light.js` réglaient
// `shadow.mapSize` (la RÉSOLUTION) et jamais `shadow.camera` (l'ÉTENDUE couverte).
//
// Au-delà de cette boîte, les fragments échantillonnent hors de la carte d'ombre et se lisent
// comme ombrés. Sur une scène plus grande que dix unités — c'est-à-dire presque toutes — on
// voyait une frontière RECTILIGNE, sans rapport avec la géométrie, avec tout le lointain dans
// le noir. Rien ne lève, rien ne se journalise : ça ressemble à un problème d'éclairage, et
// c'est un problème de cadrage.
//
// POURQUOI UNE FONCTION PURE. Le calcul est le seul endroit où l'on peut se tromper, et son
// erreur ne se voit qu'à l'écran — le harnais n'a pas de moteur de rendu. Elle ne touche donc
// aucun objet three : elle reçoit des nombres et en rend.
export const ShadowFit = (function(){

  /**
   * Le cadrage d'une ombre directionnelle.
   *
   * @param box    les bornes de la scène : `{min:{x,y,z}, max:{x,y,z}}`
   * @param target le point que la caméra d'ombre vise — la cible de la lumière
   * @param maxDistance la portée réglée sur le projet (`settings.shadowDistance`)
   * @param mapSize la résolution de la carte, pour en déduire la taille d'un texel
   *
   * Le rayon est la distance de la CIBLE au coin le plus éloigné de la scène, et non la
   * demi-diagonale de la boîte : la cible d'une lumière n'est pas au centre du monde (celle
   * d'un composant Light est un enfant posé à `(0,-4,0)`, donc sous le gizmo). Mesurer depuis
   * le centre laisserait hors champ toute la moitié de scène opposée à la lumière.
   *
   * Il est ensuite PLAFONNÉ par la portée du projet. Sans plafond, un seul objet égaré à mille
   * unités de l'origine étirerait la caméra d'ombre sur deux mille unités, et l'ombre de toute
   * la scène deviendrait un pâté de quelques texels.
   */
  function fit(box, target, maxDistance, mapSize){
    const t = target || {x: 0, y: 0, z: 0};
    const radius = radiusFromCorners(box, t);
    const capped = Math.min(radius, Math.max(1, Number(maxDistance) || 0));
    const resolution = Math.max(1, Number(mapSize) || 1);
    return {
      left: -capped, right: capped, top: capped, bottom: -capped,
      // `far` doit couvrir l'aller ET le retour : la caméra d'ombre est reculée le long de la
      // direction de la lumière, donc la scène s'étend des deux côtés de la cible.
      near: 0.5, far: Math.max(1, capped * 4),
      radius: capped,
      // Ce que couvre UN texel de la carte d'ombre, au sol. C'est la seule grandeur qui dise
      // si les contours seront nets ou mous, et c'est d'elle que se déduit le biais.
      texelWorldSize: (capped * 2) / resolution
    };
  }

  /**
   * La sphère englobante des huit coins du frustum visible.
   *
   * UNE SPHÈRE ET NON UNE BOÎTE, et c'est la décision qui compte ici. Une boîte alignée sur la
   * direction de la lumière change de taille quand la caméra tourne : la carte d'ombre change
   * alors d'échelle à chaque mouvement, et les contours grouillent. Le rayon d'une sphère, lui,
   * ne dépend pas de l'orientation — il ne bouge que si la caméra recule.
   *
   * Le centre est celui de la sphère minimale approchée par le milieu des extrêmes : exact pour
   * un frustum symétrique, et suffisant pour le reste (au pire quelques pour cent de rayon en
   * trop, c'est-à-dire un peu de résolution perdue, jamais une ombre manquante).
   */
  function frustumSphere(corners){
    if(!corners || !corners.length) return {center: {x: 0, y: 0, z: 0}, radius: 1};
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for(let i = 0; i < corners.length; i++){
      const c = corners[i];
      if(c.x < minX) minX = c.x; if(c.x > maxX) maxX = c.x;
      if(c.y < minY) minY = c.y; if(c.y > maxY) maxY = c.y;
      if(c.z < minZ) minZ = c.z; if(c.z > maxZ) maxZ = c.z;
    }
    const center = {x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2};
    let radius = 0;
    for(let i = 0; i < corners.length; i++){
      const c = corners[i];
      const dx = c.x - center.x, dy = c.y - center.y, dz = c.z - center.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if(d > radius) radius = d;
    }
    return {center: center, radius: Math.max(radius, 1)};
  }

  /**
   * Cale une coordonnée sur la grille des texels de la carte d'ombre.
   *
   * SANS ÇA, LES CONTOURS GROUILLENT. La carte d'ombre suit la caméra ; si son centre se
   * déplace d'un demi-texel, chaque bord d'ombre se redessine sur des texels différents à
   * chaque image — un fourmillement permanent sur toutes les ombres, très visible en
   * mouvement lent et impossible à attribuer à autre chose qu'« un problème de qualité ».
   *
   * On ne déplace donc la carte que par multiples entiers d'un texel : les bords retombent
   * exactement sur les mêmes texels d'une image à l'autre.
   */
  function snapToTexel(value, texelWorldSize){
    const t = Number(texelWorldSize);
    if(!Number.isFinite(t) || t <= 0) return value;
    return Math.floor(value / t) * t;
  }

  /** La distance de `target` au coin le plus éloigné de `box`. */
  function radiusFromCorners(box, target){
    if(!box || !box.min || !box.max) return 1;
    const t = target || {x: 0, y: 0, z: 0};
    const xs = [box.min.x, box.max.x];
    const ys = [box.min.y, box.max.y];
    const zs = [box.min.z, box.max.z];
    let best = 0;
    for(let i = 0; i < 2; i++){
      for(let j = 0; j < 2; j++){
        for(let k = 0; k < 2; k++){
          const dx = xs[i] - t.x, dy = ys[j] - t.y, dz = zs[k] - t.z;
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if(d > best) best = d;
        }
      }
    }
    // Une scène VIDE (ou d'un seul point) rendrait 0 : la caméra d'ombre serait dégénérée, et
    // three.js ne dirait rien — il projetterait sur un plan de largeur nulle. On garde un
    // minimum, pour que l'ombre du premier objet posé se voie tout de suite.
    return Math.max(best, 1);
  }

  /**
   * Le biais à donner, déduit de la taille d'un texel au sol.
   *
   * Une constante ne peut pas convenir : c'est le rapport entre l'étendue couverte et la
   * résolution qui décide de l'acné d'ombre. Un biais réglé pour 10 unités laisse rayer toute
   * la scène dès qu'on passe à 200 ; réglé pour 200, il décolle les ombres de leurs objets
   * (« peter-panning ») quand on revient à 10.
   *
   * `normalBias` plutôt que `bias` : il décale le point échantillonné le long de la NORMALE,
   * donc proportionnellement à la géométrie, ce qui tient sur une pente comme sur un plat.
   */
  function normalBias(texelWorldSize){
    const t = Math.max(0, Number(texelWorldSize) || 0);
    // UN DEMI-TEXEL, et pas un et demi comme dans la première version. Le décalage se fait le
    // long de la normale, en unités MONDE : à une portée de 60 sur une carte de 2048, un texel
    // vaut déjà 6 cm, donc « un texel et demi » décalait l'échantillon de 9 cm. Sur des objets
    // d'une unité, c'est le contact entre l'objet et son ombre qui disparaît — l'ombre se
    // détache, s'étale, et tout se met à baver. Un demi-texel suffit à écarter l'acné tant que
    // le biais constant ci-dessous prend la surface rasante à sa charge.
    return t * 0.5;
  }

  /**
   * Le biais de PROFONDEUR, lui aussi déduit du texel.
   *
   * Il complète `normalBias` : celui-là décale le point échantillonné le long de la normale,
   * celui-ci recule la profondeur comparée. Les deux petits valent mieux qu'un seul gros — un
   * `normalBias` suffisant à lui seul pour les surfaces rasantes est toujours trop grand pour
   * les contacts.
   *
   * NÉGATIF : dans three.js, `shadow.bias` est ajouté à la profondeur enregistrée, donc c'est
   * une valeur négative qui éloigne l'ombre de la surface. Un signe inversé ici double l'acné
   * au lieu de la supprimer, et ça ressemble à un biais « pas assez fort ».
   */
  function depthBias(texelWorldSize){
    const t = Math.max(0, Number(texelWorldSize) || 0);
    return -t * 0.002;
  }

  /**
   * Les réglages d'ombre d'UNE directionnelle : ceux qu'elle impose (composant Light :
   * `shadowMapSize`, `shadowExtent`, `shadowBias` — posés par configure_light), sinon les
   * réglages automatiques (résolution du projet, rayon de la sphère du frustum, biais déduit du
   * texel). Partagé par l'éditeur (js/scene.js) et le jeu (js/game-runtime.js) : un seul calcul,
   * pour que les deux montrent la même ombre.
   *
   * `shadowExtent` est la DEMI-largeur de la boîte d'ombre : elle reste centrée sur la vue (la
   * carte suit toujours la caméra), mais ne change plus de taille avec elle.
   */
  function lightSettings(over, projectMapSize, sphereRadius){
    const o = over || {};
    const ms = Number(o.shadowMapSize);
    const mapSize = (ms > 0) ? Math.max(256, Math.min(8192, Math.round(ms))) : (Number(projectMapSize) || 2048);
    const ext = Number(o.shadowExtent);
    const radius = (ext > 0) ? ext : Math.max(1, Number(sphereRadius) || 1);
    const texel = (radius * 2) / mapSize;
    const bias = (typeof o.shadowBias === 'number' && Number.isFinite(o.shadowBias)) ? o.shadowBias : depthBias(texel);
    return {mapSize: mapSize, radius: radius, texel: texel, normalBias: normalBias(texel), bias: bias};
  }

  /**
   * Les champs d'ombre donnés à configure_light, normalisés : un nombre valide est gardé, 0 (taille,
   * étendue) ou « auto » (biais) rendent null — « revenir à l'automatique ». Un champ omis n'apparaît pas.
   */
  function toolFields(a){
    const out = {};
    if(!a) return out;
    if(a.shadowMapSize !== undefined){
      const v = Number(a.shadowMapSize);
      if(!Number.isFinite(v) || v < 0) throw new Error('shadowMapSize : nombre positif attendu (0 = automatique)');
      out.shadowMapSize = v > 0 ? Math.max(256, Math.min(8192, Math.round(v))) : null;
    }
    if(a.shadowExtent !== undefined){
      const v = Number(a.shadowExtent);
      if(!Number.isFinite(v) || v < 0) throw new Error('shadowExtent : nombre positif attendu (0 = automatique)');
      out.shadowExtent = v > 0 ? v : null;
    }
    if(a.shadowBias !== undefined){
      if(a.shadowBias === null || a.shadowBias === 'auto') out.shadowBias = null;
      else {
        const v = Number(a.shadowBias);
        if(!Number.isFinite(v) || Math.abs(v) > 0.1) throw new Error('shadowBias : nombre entre -0.1 et 0.1 attendu, ou « auto »');
        out.shadowBias = v;
      }
    }
    return out;
  }

  /**
   * La profondeur NDC du plan proche d'une caméra : -1 en WebGL, 0 en WebGPU (z dans [0, 1]).
   * Dé-projeter les coins avec -1 sous WebGPU place le « plan proche » derrière la caméra de
   * toute la profondeur du frustum : invisible en perspective (près de la caméra), mais une
   * caméra ORTHOGRAPHIQUE (jeu iso) voyait sa sphère d'ombre reculer de ~far unités — la boîte
   * d'ombre cadrait le vide, et le jeu n'avait aucune ombre alors que l'éditeur en avait.
   * On lit le système de coordonnées de la caméra elle-même : c'est lui qui a construit sa matrice.
   */
  function nearNdcZ(camera){
    return (camera && camera.coordinateSystem === 2001) ? 0 : -1;   // 2001 = THREE.WebGPUCoordinateSystem
  }

  /**
   * Resserre les huit coins du frustum (4 proches puis 4 lointains) sur la tranche de profondeur
   * qui reçoit des ombres : de max(near, 0) à `distance`, sans dépasser `far`.
   *
   * Le `max(near, 0)` compte : une caméra orthographique de jeu a souvent un near NÉGATIF
   * (-1000 ici). Les coins proches sont alors à 1000 unités DERRIÈRE la caméra, la sphère d'ombre
   * recule avec eux, et la boîte d'ombre cadre le vide à des centaines d'unités de la scène.
   * `corners` : des THREE.Vector3 (clone, lerpVectors) modifiés sur place.
   */
  function clampDepth(corners, camera, distance){
    const n = camera.near, f = camera.far;
    const lo = Math.max(n, 0);
    const hi = Math.min(f, Math.max(lo + 0.1, distance));
    const span = Math.max(1e-6, f - n);
    const a = (lo - n) / span, b = (hi - n) / span;
    if(a <= 0 && b >= 1) return corners;
    for(let k = 0; k < 4; k++){
      const near = corners[k].clone(), far = corners[k + 4].clone();
      corners[k].lerpVectors(near, far, a);
      corners[k + 4].lerpVectors(near, far, b);
    }
    return corners;
  }

  /**
   * Le relevé des ombres d'une scène, pour play_and_measure : rendu actif, caméra, objets qui
   * projettent/reçoivent, et pour chaque directionnelle sa boîte d'ombre. Lecture seule.
   */
  function report(scene, renderer, camera){
    const r2 = function(v){ return Math.round(v * 10) / 10; };
    const out = {rendererOn: !!renderer.shadowMap.enabled, lights: [], casters: 0, receivers: 0, camera: null};
    if(camera) out.camera = {type: camera.isOrthographicCamera ? 'ortho' : 'persp', coord: camera.coordinateSystem,
      near: camera.near, far: camera.far};
    const pile = [scene];
    while(pile.length){
      const o = pile.pop();
      for(let k = 0; k < o.children.length; k++) pile.push(o.children[k]);
      if(o.isMesh){ if(o.castShadow) out.casters++; if(o.receiveShadow) out.receivers++; }
      if(!o.isDirectionalLight) continue;
      const c = o.shadow && o.shadow.camera, e = o.matrixWorld.elements;
      out.lights.push({name: o.parent && o.parent.name, cast: o.castShadow, visible: o.visible, intensity: o.intensity,
        pos: [r2(e[12]), r2(e[13]), r2(e[14])], map: o.shadow && o.shadow.mapSize.x,
        box: c ? [c.left, c.right, c.bottom, c.top, c.near, c.far].map(r2) : null,
        bias: o.shadow && o.shadow.bias, settings: o.userData.shadowSettings || null});
    }
    return out;
  }

  return {fit: fit, clampDepth: clampDepth, report: report, normalBias: normalBias, depthBias: depthBias, lightSettings: lightSettings, toolFields: toolFields,
          nearNdcZ: nearNdcZ,
          radiusFromCorners: radiusFromCorners,
          frustumSphere: frustumSphere, snapToTexel: snapToTexel};
})();

if (typeof globalThis !== 'undefined') globalThis.ShadowFit = ShadowFit;
