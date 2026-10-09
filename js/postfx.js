// ---------- Post-traitement (P2-4) ----------
// Pipeline maison (EffectComposer n'est pas embarqué dans vendor/) :
//   scène → cible HDR-ish → extraction des hautes lumières → flou séparable ×2
//   → composition (bloom + étalonnage + vignette + grain) → écran
// Les réglages ne viennent QUE des PostVolume et de leurs profils (js/post-profile.js,
// js/post-volume-blend.js). `env.post` n'est plus lu par le rendu : il ne survit dans le
// format de scène que pour pré-remplir le premier profil (component-postvolume.js, onAdd).
import { Registry } from './component-registry.js';
import { env } from './environment.js';
import { blendPostVolumes } from './post-volume-blend.js';
import { renderer } from './scene.js';
import { clamp } from './ui.js';

export const POST_DEFAULT = {
  active: false,
  toneMapping: 'aces',        // aucun | lineaire | reinhard | cineon | aces
  exposition: 1,
  bloom: true, bloomThreshold: 0.8, bloomIntensity: 0.7, bloomRadius: 1,
  contraste: 1, saturation: 1, temperature: 0,   // −1 froid … +1 chaud
  vignette: 0.25, grain: 0
};

// Le flip V (voir shaders plus bas) ne dépend que du backend de rendu actif, jamais du
// contenu de la scène : ce n'est plus un réglage utilisateur (ancien champ `env.post.retournerV`,
// une case à cocher qui obligeait chacun à deviner au pif). `renderer.backend.isWebGPUBackend`
// distingue le vrai backend WebGPU du repli WebGL2 automatique de THREE.WebGPURenderer — les
// deux ont `renderer.isWebGPURenderer === true`, seul `backend.isWebGPUBackend` dit lequel
// tourne réellement, et donc si la cible de rendu a sa ligne V=0 en haut ou en bas.
export function postFlipV(){
  return !!(renderer.backend && renderer.backend.isWebGPUBackend);
}

export const TONEMAPS = [
  ['none', 'Aucun (raw)'],
  ['lineaire', 'Linéarea'],
  ['reinhard', 'Reinhard'],
  ['cineon', 'Cineon'],
  ['aces', 'ACES Filmic (recommandé)']
];

export const postprod = {
  ready: false, w: 0, h: 0,
  rtScene: null, rtBright: null, rtA: null, rtB: null,
  quad: null, sceneQuad: null, camQuad: null,
  matBright: null, matBlur: null, matComposite: null
};

export function ensurePost(){
  if(!env.post) env.post = JSON.parse(JSON.stringify(POST_DEFAULT));
  return env.post;
}

// ---------- shaders (TSL — WebGPURenderer n'exécute pas les ShaderMaterial GLSL bruts) ----------
// Porté depuis le GLSL précédent (voir historique git pour la version WebGLRenderer/r128).
// Chaque passe garde EXACTEMENT la même formule, traduite en noeuds TSL — voir
// docs/superpowers/specs/2026-08-06-fondation-webgpu-tsl-design.md, section Tests : le
// rendu WebGPU n'est pas simulable par le harnais de test node:vm, vérification manuelle
// en navigateur requise pour toute cette section.
// Chaque matériel garde un noeud `texture()` PERSISTANT (créé une seule fois, ici) plutôt
// que d'en recréer un par frame : c'est `texture().value` qu'on réassigne à chaque passe
// (voir pass()/postRender() plus bas), pas `mat.tSrc` — le graphe TSL, lui, est figé une
// fois pour toutes à la création du matériau (mat.fragmentNode ne se reconstruit jamais).
// UV en V inversé, UNIQUEMENT pour lire postprod.rtScene (le rendu 3D raw) : sous
// WebGPURenderer, la texture d'une cible de rendu a sa ligne V=0 en HAUT (convention
// WebGPU/DirectX/Metal), alors que le quad plein écran (géométrie + uv() standard) suppose
// V=0 en BAS (convention WebGL historique, jamais changée ici). Toute la chaîne en aval
// (flou, bloom) recopie ensuite cette orientation fidèlement d'une passe à l'autre — un
// seul flip, au tout premier point de lecture de rtScene, suffit à redresser l'image finale
// (voir docs/KNOWN_ISSUES.md « Post-traitement : view retournée sous WebGPU »).

// ---------- lecture d'une cible de rendu : LA RÈGLE, une fois pour toutes ----------
// Sous WebGPU, une cible de rendu a sa ligne V=0 EN HAUT ; le quad plein écran (uv() standard)
// suppose V=0 en bas. TOUTE lecture d'une cible doit donc inverser le V — pas seulement celle
// de la scène. C'est ce « pas seulement » qui manquait : seule rtScene était inversée, et la
// chaîne du bloom (bright → flou ×4 → composition) accumulait un nombre IMPAIR de lectures non
// inversées. Résultat mesuré : la scène à l'endroit, le halo de bloom à l'envers, collé en haut
// de l'image. Un flou gaussien étant symétrique, les passes intermédiaires ne le montraient pas
// — seule la dernière lecture le rendait visible, ce qui rendait le défaut illisible.
// La règle est donc uniforme : une lecture de cible = un flip. Aucune exception.
export function uvTargetRead(uFlipV){
  return TSL.vec2(TSL.uv().x, TSL.mix(TSL.uv().y, TSL.float(1).sub(TSL.uv().y), uFlipV));
}

export function createMaterialBright(){
  const {Fn, texture, uv, uniform, dot, vec3, max: tmax, float} = TSL;
  const uThreshold = uniform(0.8);
  const uFlipV = uniform(0);
  const tSrc = texture(null, uvTargetRead(uFlipV));
  const mat = new THREE.NodeMaterial();
  mat.fragmentNode = Fn(() => {
    const c = tSrc.rgb;
    const l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    const f = tmax(float(0), l.sub(uThreshold)).div(tmax(float(0.0001), float(1).sub(uThreshold)));
    return vec3(c.mul(f)).toVec4(float(1));
  })();
  mat.depthTest = false;
  mat.depthWrite = false;
  // Quad plein ecran : NDC direct, ignore la transformation camera
  // (equivalent exact de l'ancien gl_Position = vec4(position.xy, 0.0, 1.0)).
  mat.positionNode = TSL.vec3(TSL.positionGeometry.xy, 0);
  mat.uThreshold = uThreshold;
  mat.uFlipV = uFlipV;
  mat.tSrcNode = tSrc;
  return mat;
}

// flou gaussien séparable (9 taps) — uDir = (1/w, 0) puis (0, 1/h)
export function createMaterialBlur(){
  const {Fn, texture, uv, uniform, vec2, vec3, float} = TSL;
  const uDir = uniform(new THREE.Vector2());
  const uFlipV = uniform(0);
  const tSrc = texture(null, uvTargetRead(uFlipV));
  const P = [0.227027, 0.194595, 0.121622, 0.054054, 0.016216];
  const mat = new THREE.NodeMaterial();
  mat.fragmentNode = Fn(() => {
    let s = tSrc.sample(uv()).rgb.mul(float(P[0]));
    for(let i = 1; i < 5; i++){
      const o = uDir.mul(float(i));
      s = s.add(tSrc.sample(uv().add(o)).rgb.mul(float(P[i])));
      s = s.add(tSrc.sample(uv().sub(o)).rgb.mul(float(P[i])));
    }
    return s.toVec4(float(1));
  })();
  mat.depthTest = false;
  mat.depthWrite = false;
  // Quad plein ecran : NDC direct, ignore la transformation camera
  // (equivalent exact de l'ancien gl_Position = vec4(position.xy, 0.0, 1.0)).
  mat.positionNode = TSL.vec3(TSL.positionGeometry.xy, 0);
  mat.uDir = uDir;
  mat.uFlipV = uFlipV;
  mat.tSrcNode = tSrc;
  return mat;
}

// Le tone mapping est fait ICI, pas via renderer.toneMapping : le changer à chaud ne
// doit pas recompiler tout le graphe, et il doit de toute façon s'apply APRÈS le bloom.
export function createMaterialComposite(){
  const {Fn, texture, uv, uniform, dot, mix, clamp, vec2, vec3, max: tmax,
    float, fract, sin} = TSL;
  const uBloom = uniform(0.7), uContraste = uniform(1), uSaturation = uniform(1),
    uTemperature = uniform(0), uVignette = uniform(0.25), uGrain = uniform(0),
    uTime = uniform(0), uExposition = uniform(1), uTone = uniform(4, 'int');
  // LES DEUX lectures sont des lectures de CIBLE, donc les deux passent par uvTargetRead() :
  // rtScene comme la chaîne de flou. Le commentaire d'avant disait le contraire (« tBloom est
  // déjà réorientée, pas de second flip ») et c'était le raisonnement faux qui a produit le
  // halo de bloom retourné — écrire dans une cible réintroduit le flip à CHAQUE passe, il
  // n'existe pas de texture « déjà remise à l'endroit ». Une lecture de cible = un flip.
  const uFlipV = uniform(0);
  const tSrc = texture(null, uvTargetRead(uFlipV));
  const tBloom = texture(null, uvTargetRead(uFlipV));
  const mat = new THREE.NodeMaterial();
  mat.fragmentNode = Fn(() => {
    const uvN = uv();
    let c = tSrc.rgb;
    c = c.add(tBloom.rgb.mul(uBloom));
    c = c.mul(uExposition);
    // 4 courbes de tonemap, sélection par valeur (pas de branchement de contrôle nécessaire)
    const cClamp = clamp(c, 0, 1);
    const cReinhard = c.div(vec3(1).add(c));
    const cCin = tmax(vec3(0), c.sub(0.004));
    const cCineon = cCin.mul(cCin.mul(6.2).add(0.5)).div(cCin.mul(cCin.mul(6.2).add(1.7)).add(0.06)).pow(2.2);
    const cACES = clamp(c.mul(c.mul(2.51).add(0.03)).div(c.mul(c.mul(2.43).add(0.59)).add(0.14)), 0, 1);
    c = uTone.equal(1).select(cClamp,
      uTone.equal(2).select(cReinhard,
        uTone.equal(3).select(cCineon,
          uTone.equal(4).select(cACES, c))));
    // température : chaud = plus de rouge, froid = plus de bleu
    const r = c.r.mul(float(1).add(uTemperature.mul(0.18)));
    const b = c.b.mul(float(1).sub(uTemperature.mul(0.18)));
    c = vec3(r, c.g, b);
    // saturation autour de la luminance
    const l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(l), c, uSaturation);
    // contraste autour du gris medium
    c = c.sub(0.5).mul(uContraste).add(0.5);
    // vignette
    const d = uvN.sub(0.5);
    c = c.mul(float(1).sub(uVignette.mul(dot(d, d)).mul(2.4)));
    // grain argentique — toujours calculé (pas de branchement), poids nul si uGrain = 0
    const n = fract(sin(dot(uvN.mul(1024).add(uTime), vec2(12.9898, 78.233))).mul(43758.5453));
    c = c.add(n.sub(0.5).mul(uGrain).mul(0.25));
    // PAS de conversion sRGB manuelle ici. Cette passe finale est rendue À L ÉCRAN, et un
    // NodeMaterial rendu à l écran reçoit déjà la conversion linéaire -> sRGB du renderer
    // (`renderer.outputColorSpace`, laissé à sa valeur par défaut SRGBColorSpace). Un
    // pow(1/2,2) ajouté ici était donc une SECONDE conversion : image laiteuse, blanchie,
    // contrastes écrasés — le « filtre blanc » qu on voyait dès qu un effet était actif,
    // quel que soit l effet. Toute la chaîne reste linéaire, le renderer convertit en bout.
    c = tmax(c, 0);
    return c.toVec4(float(1));
  })();
  mat.depthTest = false;
  mat.depthWrite = false;
  // Quad plein ecran : NDC direct, ignore la transformation camera
  // (equivalent exact de l'ancien gl_Position = vec4(position.xy, 0.0, 1.0)).
  mat.positionNode = TSL.vec3(TSL.positionGeometry.xy, 0);
  Object.assign(mat, {uBloom, uContraste, uSaturation, uTemperature, uVignette, uGrain,
    uTime, uExposition, uTone, uFlipV, tSrcNode: tSrc, tBloomNode: tBloom});
  return mat;
}

export function postInit(){
  if(postprod.ready) return;
  postprod.sceneQuad = new THREE.Scene();
  postprod.camQuad = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  postprod.matBright = createMaterialBright();
  postprod.matBlur = createMaterialBlur();
  postprod.matComposite = createMaterialComposite();
  postprod.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postprod.matComposite);
  postprod.quad.frustumCulled = false;
  postprod.sceneQuad.add(postprod.quad);
  postprod.ready = true;
}

export function postSizes(w, h){
  if(postprod.w === w && postprod.h === h && postprod.rtScene) return;
  postprod.w = w;
  postprod.h = h;
  [postprod.rtScene, postprod.rtBright, postprod.rtA, postprod.rtB].forEach(function(rt){
    if(rt) rt.dispose();
  });
  const opt = {minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
               format: THREE.RGBAFormat, stencilBuffer: false};
  const pr = renderer.getPixelRatio();
  const pw = Math.max(1, Math.floor(w * pr)), ph = Math.max(1, Math.floor(h * pr));
  postprod.rtScene = new THREE.WebGLRenderTarget(pw, ph, opt);
  postprod.rtScene.depthBuffer = true;
  const dw = Math.max(1, pw >> 1), dh = Math.max(1, ph >> 1);   // bloom en demi-résolution
  postprod.rtBright = new THREE.WebGLRenderTarget(dw, dh, opt);
  postprod.rtA = new THREE.WebGLRenderTarget(dw, dh, opt);
  postprod.rtB = new THREE.WebGLRenderTarget(dw, dh, opt);
}

// index du mode pour le shader de composition
export function postToneIndex(name){
  switch(name){
    case 'none':    return 0;
    case 'lineaire': return 1;
    case 'reinhard': return 2;
    case 'cineon':   return 3;
    default:         return 4;   // aces
  }
}

export function pass(mat, target){
  postprod.quad.material = mat;
  renderer.setRenderTarget(target || null);
  renderer.render(postprod.sceneQuad, postprod.camQuad);
}

// Traduit les PostVolume actifs de la scène en entrées pour blendPostVolumes() (voir
// js/post-volume-blend.js) : résout le profil de chaque volume, sa position/forme monde.
// Séparé de blendPostVolumes() pour que celle-ci reste pure et testable sans Registry/THREE.
export function resolvePostVolumesForBlend(){
  return Registry.active('PostVolume').map(function(c){
    const d = c.data;
    const profile = c.profile;
    const pos = c.node.getWorldPosition(new THREE.Vector3());
    return {
      global: !!d.global,
      priority: d.priority || 0,
      shape: d.shape,
      size: d.size,
      radius: d.radius,
      position: {x: pos.x, y: pos.y, z: pos.z},
      blendDistance: d.blendDistance,
      effects: profile ? profile.effects : null
    };
  });
}

// L état fusionné (forme par effet, voir post-volume-blend.js) -> le format plat que lit le
// reste du pipeline (POST_DEFAULT). Pas de nouvelle branche dans le pipeline TSL lui-même :
// seule la SOURCE des réglages change.
export function postStateToLegacyFormat(state){
  return {
    active: true,
    toneMapping: state.toneMapping.mode,
    exposition: state.colorGrading.exposure,
    bloom: state.bloom.intensity > 0,
    bloomThreshold: state.bloom.threshold,
    bloomIntensity: state.bloom.intensity,
    bloomRadius: state.bloom.radius,
    contraste: state.colorGrading.contrast,
    saturation: state.colorGrading.saturation,
    temperature: state.colorGrading.temperature,
    vignette: state.vignette.amount,
    grain: state.grain.amount
  };
}

// UN ÉTAT NEUTRE NE JUSTIFIE PAS UNE PASSE. Un profil peut très bien overrider un effet
// tout en le laissant à sa valeur d'absence (bloom coché mais intensité 0, gradation cochée
// mais laissée à 1) : `blendPostVolumes` rend alors un état non nul, et la chaîne complète
// (cible hors écran + composition, une passe plein écran par image) tournait pour redonner
// EXACTEMENT l'image d'entrée. On la saute : rendu direct à l'écran, pixel pour pixel le
// même résultat, sans le coût ni l'aller-retour par une cible.
export function postStateIsNoop(p){
  return !(p.bloom && p.bloomIntensity > 0)
    && (p.toneMapping === 'none')
    && p.exposition === 1 && p.contraste === 1 && p.saturation === 1
    && p.temperature === 0 && p.vignette === 0 && p.grain === 0;
}

// rend `sc` vu par `cam` avec post-traitement, dans le viewport (w × h)
//
// UNE SEULE SOURCE : les PostVolume actifs et leurs profils. Il n'y a plus de repli sur
// `env.post` — c'était exactement ce qui rendait le systeme illisible : un profil sans effet
// override (ou dont l'asset avait disparu) laissait le pipeline appliquer les valeurs de
// `env.post`, donc l'image gardait « toujours la meme gueule » quoi qu'on regle dans le
// profil. Aucun volume ne contribue = aucun post-traitement, point.
export function postRender(sc, cam, w, h, time){
  const volumes = resolvePostVolumesForBlend();
  const camPos = cam.getWorldPosition(new THREE.Vector3());
  const merged = volumes.length ? blendPostVolumes(volumes, {x:camPos.x, y:camPos.y, z:camPos.z}) : null;
  if(!merged){
    renderer.setRenderTarget(null);
    renderer.render(sc, cam);
    return;
  }
  const p = postStateToLegacyFormat(merged);
  if(postStateIsNoop(p)){
    renderer.setRenderTarget(null);
    renderer.render(sc, cam);
    return;
  }
  postInit();
  postSizes(w, h);

  // la scène est rendue brute : exposition et tone mapping sont faits à la composition
  renderer.setRenderTarget(postprod.rtScene);
  renderer.clear();
  renderer.render(sc, cam);

  // bloom
  let bloomTex = null;
  if(p.bloom && p.bloomIntensity > 0){
    postprod.matBright.tSrcNode.value = postprod.rtScene.texture;
  // MEME sens pour TOUTES les lectures de cible (voir uvTargetRead) : scene, flou, bloom
    postprod.matBright.uFlipV.value = postFlipV() ? 1 : 0;
    postprod.matBright.uThreshold.value = p.bloomThreshold;
    pass(postprod.matBright, postprod.rtBright);
    const tw = postprod.rtBright.width, th = postprod.rtBright.height;
    const r = Math.max(0.2, p.bloomRadius);
    postprod.matBlur.uFlipV.value = postFlipV() ? 1 : 0;
    let src = postprod.rtBright;
    for(let i = 0; i < 2; i++){          // deux itérations = halo plus large
      postprod.matBlur.tSrcNode.value = src.texture;
      postprod.matBlur.uDir.value.set(r * (i + 1) / tw, 0);
      pass(postprod.matBlur, postprod.rtA);
      postprod.matBlur.tSrcNode.value = postprod.rtA.texture;
      postprod.matBlur.uDir.value.set(0, r * (i + 1) / th);
      pass(postprod.matBlur, postprod.rtB);
      src = postprod.rtB;
    }
    bloomTex = postprod.rtB.texture;
  }

  // composition
  const mc = postprod.matComposite;
  mc.tSrcNode.value = postprod.rtScene.texture;
  mc.tBloomNode.value = bloomTex || postprod.rtBright.texture;
  mc.uFlipV.value = postFlipV() ? 1 : 0;
  mc.uBloom.value = bloomTex ? p.bloomIntensity : 0;
  mc.uContraste.value = p.contraste;
  mc.uSaturation.value = p.saturation;
  mc.uTemperature.value = p.temperature;
  mc.uVignette.value = p.vignette;
  mc.uGrain.value = p.grain;
  mc.uTime.value = time || 0;
  mc.uExposition.value = p.exposition;
  mc.uTone.value = postToneIndex(p.toneMapping);

  // L'ANTICRÉNELAGE FXAA A ÉTÉ RETIRÉ (v0.135.0) : sa cible intermédiaire relisait l'image
  // retournée, et la caméra apparaissait la tête en bas dès qu'il était coché.
  pass(postprod.matComposite, null);
  renderer.setRenderTarget(null);
}

// LE POST-TRAITEMENT DES SCÈNES D'AVANT LES PostVolume, dit une fois. `env.post` n'est plus
// lu par le rendu : une scène enregistrée avant ce changement, qui avait un post-traitement
// actif et aucun volume, s'ouvre SANS aucun effet. Le cas « profil introuvable » avertit déjà
// (js/serialization.js) ; celui-ci restait le dernier à disparaître en silence.
// Clé = l'objet `env.post` lui-même (WeakSet) : une fois par scène, sans rien à réinitialiser
// au changement de scène, et sans retenir la scène en mémoire.
export const postLegacyWarned = new WeakSet();

export function postActive(){
  // Le seul déclencheur : un PostVolume actif dans la scène. On ne calcule pas le mélange ici
  // (postRender() le refait, et sait bail-out si aucun volume ne contribue).
  const hasVolume = Registry.active('PostVolume').length > 0;
  if(!hasVolume && typeof env !== 'undefined' && env && env.post && env.post.active
     && !postLegacyWarned.has(env.post)){
    postLegacyWarned.add(env.post);
    console.warn('[scène] un ancien réglage de post-traitement de scène (env.post) est actif,'
      + ' mais la scène n a aucun PostVolume : plus rien ne s applique. Poser un PostVolume'
      + ' global et lui donner un profil de post-traitement.');
  }
  return hasVolume;
}

// ---------- L'interface du post-traitement a déménagé ----------
// `sectionPostHtml`, `syncPost` et `readPostFromDom` construisaient, synchronisaient et
// relisaient quatorze champs à la main. Ils sont remplacés par le descripteur PANEL_RENDER
// (js/ui/panels-scene.js) : même ids, mêmes bornes, mêmes replis.
//
// CE QUI N'A PAS BOUGÉ, ET NE DOIT PAS : `env.post` garde son nom dans le format sérialisé.
// Ce fichier n'est pas embarqué dans les builds (build.js:195-225) et le pipeline est
// réimplémenté dans game-runtime.js:2678, qui lit `env.post` sous ce nom — le renommer
// casserait le jeu publié en silence.
