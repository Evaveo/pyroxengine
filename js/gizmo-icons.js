// moteur/js/gizmo-icons.js
//
// ---------- Les ICÔNES D'ÉDITION et les gizmos de SÉLECTION, comme la vue Scène d'Unity ----------
//
// LE BESOIN. Une scène de huit lumières, une caméra, une sonde de reflets et un volume de
// post-traitement était illisible : cônes de spots, portées de ponctuelles, frustum de caméra,
// sphère chromée de sonde, tous affichés EN PERMANENCE — et les repères des lampes et caméras
// étaient de vrais objets 3D (sphère, cône, octaèdre, boîtier noir) dessinés dans la scène, au
// point d'y projeter des ombres (docs/KNOWN_ISSUES.md).
//
// LA RÈGLE, celle d'Unity :
//   1. un objet NON sélectionné ne montre qu'une ICÔNE — un pictogramme par genre, toujours face
//      à la caméra, de taille constante à l'écran, qui s'estompe puis disparaît au loin. Elle
//      est cliquable : `pick()` est interrogé par le viewport AVANT les maillages ;
//   2. un objet SÉLECTIONNÉ montre en plus ses gizmos : cône et portée de la lampe, frustum de
//      la caméra, sphère d'influence de la sonde, portées de la source audio (les boîtes de
//      collider, de sonde et de volume ont déjà leurs modules, qui ne suivent que la sélection) ;
//   3. rien de tout ça n'existe hors de la vue d'édition : tout vit sur le calque des aides,
//      qu'aucune caméra de jeu, sonde ni cuisson ne voit, et SOUS UNE RACINE À PART (`root`),
//      jamais sous un nœud — donc jamais sérialisé, cloné, dupliqué, ni embarqué dans un build
//      (ce fichier n'est chargé que par editor.html).
//
// CE MODULE N'IMPORTE RIEN DU GRAND CYCLE (scene.js, viewport.js, selection.js…) : la scène, la
// caméra, la sélection et le calque lui sont PASSÉS par l'appelant. C'est ce qui le garde hors
// du cycle d'imports que mesure test/cliquets-dette.test.mjs, et testable dans un `node:vm`.
import { ed } from './component-data.js';
import { Registry } from './component-registry.js';
import { EDITOR_OVERLAY_ORDER, hideEditorMarker, isEditorMarkerHidden } from './editor-overlay.js';
// PAS d'import de js/render-perf.js (le build allégé sait le retirer, test/esm-modules.test.mjs) ni
// de js/ui/prefs.js (l'importer d'ici avançait son évaluation, test/ordre-evaluation.test.mjs) :
// les préférences arrivent par l'appelant (`iconSettings(Prefs)`).

/**
 * Un genre d'icône par sorte d'objet. `glyph` est le nom Phosphor et `code` son point de code
 * dans la fonte vendorée (vendor/phosphor/phosphor.css — test/gizmo-icones.test.mjs vérifie
 * chaque paire). `color` teinte le pictogramme ; celui d'une lampe prend sa couleur à elle.
 */
export const ICON_KINDS = {
  'light-point':       {glyph: 'lightbulb',    code: 0xe2dc, color: 0xffffff, label: 'Lumière ponctuelle'},
  'light-spot':        {glyph: 'flashlight',   code: 0xe246, color: 0xffffff, label: 'Spot'},
  'light-directional': {glyph: 'sun',          code: 0xe472, color: 0xffffff, label: 'Lumière directionnelle'},
  camera:              {glyph: 'video-camera', code: 0xe4da, color: 0xcfe3ff, label: 'Caméra'},
  probe:               {glyph: 'sphere',       code: 0xee66, color: 0x9fe0ff, label: 'Sonde de reflets'},
  'post-volume':       {glyph: 'aperture',     code: 0xe00a, color: 0xc3b6ff, label: 'Volume de post-traitement'},
  audio:               {glyph: 'speaker-high', code: 0xe44a, color: 0xa6f0c0, label: 'Source audio'},
  particles:           {glyph: 'sparkle',      code: 0xe6a2, color: 0xffb877, label: 'Émetteur de particules'}
};

/** Les composants qui donnent une icône à leur nœud, dans l'ordre de priorité (un seul par nœud). */
export const ICON_COMPONENTS = ['Light', 'Camera', 'Reflection', 'PostVolume', 'AudioSource', 'Particles'];

/**
 * Les nœuds dont le maillage EST un repère d'édition (le nœud d'une lampe est sa sphère, celui
 * d'une caméra son boîtier…) : celui-là est éteint, l'icône le remplace. Un cube qui porte une
 * source audio, lui, garde évidemment son maillage — d'où la liste fermée de types.
 */
export const MARKER_TYPES = new Set(['point', 'spot', 'directional', 'camera', 'probe', 'particles']);

// Les réglages par défaut — repris par les préférences (js/ui/prefs.js), qui en sont la source.
export const ICON_SIZE_DEFAULT = 32;          // pixels à l'écran
export const ICON_FADE_DEFAULT = 80;          // mètres ; 0 = jamais
// L'icône est pleine jusqu'à 70 % de la distance de fondu, puis s'efface linéairement jusqu'à 0.
export const ICON_FADE_START = 0.7;
// Une icône plus transparente que ça n'est plus ni dessinée ni cliquable.
export const ICON_MIN_OPACITY = 0.02;
// Ce que gagne l'icône de l'objet sélectionné, pour qu'on la retrouve d'un coup d'œil.
export const ICON_SELECTED_SCALE = 1.2;

/** Le genre d'icône d'un nœud, ou `null`. */
export function iconKindOf(node){
  if(!node || typeof node.getComponent !== 'function') return null;
  const light = node.getComponent('Light');
  if(light){
    return (light.subType === 'spot') ? 'light-spot'
         : (light.subType === 'directional') ? 'light-directional' : 'light-point';
  }
  if(node.getComponent('Camera')) return 'camera';
  if(node.getComponent('Reflection')) return 'probe';
  if(node.getComponent('PostVolume')) return 'post-volume';
  if(node.getComponent('AudioSource')) return 'audio';
  if(node.getComponent('Particles')) return 'particles';
  return null;
}

/** Le maillage de ce nœud est-il un repère d'édition à éteindre ? */
export function isMarkerNode(node){
  return !!node && node.isMesh === true && MARKER_TYPES.has(node.userData && node.userData.type);
}

/**
 * L'opacité d'une icône à `distance` mètres de la caméra. Pleine jusqu'à
 * `fadeDistance × ICON_FADE_START`, nulle à `fadeDistance` et au-delà. `fadeDistance` nul ou
 * négatif : jamais de fondu.
 */
export function iconOpacity(distance, fadeDistance){
  if(!(fadeDistance > 0)) return 1;
  const start = fadeDistance * ICON_FADE_START;
  if(distance <= start) return 1;
  if(distance >= fadeDistance) return 0;
  return 1 - (distance - start) / (fadeDistance - start);
}

/**
 * La taille MONDE qui donne `pixels` pixels à l'écran, pour un objet à `depth` mètres devant
 * `camera` (profondeur le long du regard), dans une vue haute de `viewHeight` pixels. C'est ce
 * qui garde une icône de taille constante, comme celles d'Unity, sans `sizeAttenuation: false`
 * (dont le raycast de three ne sait rien des caméras orthographiques).
 */
export function iconWorldSize(camera, depth, pixels, viewHeight){
  const h = Math.max(1, viewHeight || 1);
  if(camera && camera.isOrthographicCamera){
    return pixels * (camera.top - camera.bottom) / (camera.zoom || 1) / h;
  }
  const fov = (camera && camera.fov) ? camera.fov : 50;
  return pixels * 2 * Math.max(depth, 1e-3) * Math.tan(fov * Math.PI / 360) / h;
}

/** Les gizmos d'un nœud (cône, frustum, sphère d'influence…) ne se montrent qu'à sa sélection. */
export function gizmosVisibleFor(node, selected, enabled){
  return enabled !== false && !!node && !!selected && selected.has(node);
}

/** Le nœud est-il dans la scène, et visible tout le long de sa chaîne de parents ? */
export function shownInScene(node, scene){
  let o = node;
  while(o){
    if(o === scene) return true;
    // L'INTENTION, comme `visibleIntent` (js/render-perf.js) : un objet rangé dans un lot
    // d'instances porte `visible = false` sans être masqué pour autant.
    const ud = o.userData || {};
    if(ud.inInstanceBatch ? ud.visibleWanted === false : o.visible === false) return false;
    o = o.parent;
  }
  return false;
}

/** Les réglages de l'utilisateur (Préférences → Apparence), lus dans `prefs` (js/ui/prefs.js). */
export function iconSettings(prefs){
  const get = function(k, d){
    const v = (prefs && typeof prefs.get === 'function') ? prefs.get(k) : undefined;
    return (v === undefined || v === null) ? d : v;
  };
  return {
    enabled: get('gizmos.icons', true) !== false,
    size: Math.max(8, Number(get('gizmos.iconSize', ICON_SIZE_DEFAULT)) || ICON_SIZE_DEFAULT),
    fade: Math.max(0, Number(get('gizmos.iconFade', ICON_FADE_DEFAULT)) || 0)
  };
}

// ---------- Les pictogrammes ----------
//
// Dessinés au chargement dans un canvas, avec la fonte Phosphor vendorée (`Phosphor-Fill`) que
// l'interface charge déjà : aucune ressource réseau. Une pastille sombre cerclée de blanc (de
// l'orange quand l'objet est sélectionné) les rend lisibles sur un ciel clair comme sur un sol
// sombre. Tant que la fonte n'est pas prête, un disque plein tient la place ; la texture est
// redessinée dès qu'elle l'est.

const TEXTURE_SIZE = 128;
const RING_SELECTED = '#ffb347';
const WHITE = new THREE.Color(0xffffff);

function drawIcon(canvas, kind, selected, fontReady){
  const k = ICON_KINDS[kind];
  const cx = canvas.getContext && canvas.getContext('2d');
  if(!cx || typeof cx.arc !== 'function') return false;   // pas de canvas 2D complet (tests)
  const s = TEXTURE_SIZE, r = s / 2;
  cx.clearRect(0, 0, s, s);
  cx.beginPath();
  cx.arc(r, r, r - 6, 0, Math.PI * 2);
  cx.fillStyle = 'rgba(18, 20, 24, 0.82)';
  cx.fill();
  cx.lineWidth = selected ? 9 : 5;
  cx.strokeStyle = selected ? RING_SELECTED : 'rgba(255, 255, 255, 0.9)';
  cx.stroke();
  const hex = '#' + ('00000' + k.color.toString(16)).slice(-6);
  cx.fillStyle = hex;
  if(fontReady && typeof cx.fillText === 'function'){
    cx.font = Math.round(s * 0.56) + 'px "Phosphor-Fill"';
    cx.textAlign = 'center';
    cx.textBaseline = 'middle';
    cx.fillText(String.fromCodePoint(k.code), r, r + 2);
  } else {
    cx.beginPath();
    cx.arc(r, r, r * 0.3, 0, Math.PI * 2);
    cx.fill();
  }
  return true;
}

// ---------- Le système ----------

export const EditorIcons = {
  root: null,
  icons: new Map(),      // nœud → {sprite, kind}
  extras: new Map(),     // nœud → Group des gizmos de sélection propres à ce module
  textures: new Map(),   // 'genre|sel' → CanvasTexture
  fontReady: false,
  fontRequested: false,

  /** La racine des icônes, posée dans `scene` (et reposée si un vidage de scène l'a retirée). */
  ensureRoot(scene, layer){
    if(!this.root){
      this.root = new THREE.Group();
      this.root.name = 'Icônes d\'édition';
      this.root.userData.editorFixture = true;
      this.root.raycast = function(){};
    }
    if(layer !== undefined) this.root.layers.set(layer);
    if(scene && this.root.parent !== scene) scene.add(this.root);
    return this.root;
  },

  /** Demande la fonte une fois ; les textures déjà faites sont redessinées quand elle arrive. */
  requestFont(){
    if(this.fontRequested) return;
    this.fontRequested = true;
    const fonts = (typeof document === 'object' && document) ? document.fonts : null;
    if(!fonts || typeof fonts.load !== 'function') return;
    const self = this;
    fonts.load('64px "Phosphor-Fill"').then(function(list){
      if(list && list.length === 0) return;   // fonte absente de la page : on garde le disque
      self.fontReady = true;
      self.textures.forEach(function(tex, key){
        const parts = key.split('|');
        if(drawIcon(tex.image, parts[0], parts[1] === '1', true)) tex.needsUpdate = true;
      });
    }, function(){ /* hors ligne sans la fonte : le disque reste */ });
  },

  textureFor(kind, selected){
    const key = kind + '|' + (selected ? 1 : 0);
    let tex = this.textures.get(key);
    if(tex) return tex;
    this.requestFont();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = TEXTURE_SIZE;
    drawIcon(canvas, kind, selected, this.fontReady);
    tex = new THREE.CanvasTexture(canvas);
    if(THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    this.textures.set(key, tex);
    return tex;
  },

  makeSprite(kind, layer){
    const mat = new THREE.SpriteMaterial({map: this.textureFor(kind, false), transparent: true,
      depthTest: false, depthWrite: false, fog: false});
    mat.toneMapped = false;
    const sprite = new THREE.Sprite(mat);
    sprite.name = 'Icône ' + ICON_KINDS[kind].label;
    sprite.renderOrder = EDITOR_OVERLAY_ORDER + 10;   // au-dessus des autres aides, sous le gizmo
    sprite.castShadow = false;
    sprite.receiveShadow = false;
    if(layer !== undefined) sprite.layers.set(layer);
    return sprite;
  },

  disposeIcon(node){
    const e = this.icons.get(node);
    if(!e) return;
    if(e.sprite.parent) e.sprite.parent.remove(e.sprite);
    e.sprite.material.dispose();   // la texture est partagée par genre : gardée en cache
    this.icons.delete(node);
  },

  disposeExtra(node){
    const g = this.extras.get(node);
    if(!g) return;
    if(g.parent) g.parent.remove(g);
    g.children.forEach(function(c){ if(c.material) c.material.dispose(); });
    this.extras.delete(node);
  },

  /** Les nœuds candidats : les porteurs d'un composant à icône, lus au Registre. */
  candidates(){
    const set = new Set();
    ICON_COMPONENTS.forEach(function(t){ liveNodesOf(t).forEach(function(n){ set.add(n); }); });
    return set;
  },

  /**
   * Une image : pose, taille, fondu et teinte de chaque icône ; gizmos de la sélection ; repères
   * éteints ; cartes d'ombre tenues hors du calque des aides.
   *
   * `ctx` : {scene, camera, viewHeight, selected (tableau ou Set), layer, settings?}.
   */
  sync(ctx){
    const scene = ctx.scene, camera = ctx.camera, layer = ctx.layer;
    const st = ctx.settings || iconSettings(null);
    const selected = (ctx.selected && typeof ctx.selected.has === 'function')
      ? ctx.selected : new Set(ctx.selected || []);
    const root = this.ensureRoot(scene, layer);
    const nodes = this.candidates();
    const self = this;

    // Ce qui a quitté la scène, ou perdu son composant.
    Array.from(this.icons.keys()).forEach(function(n){ if(!nodes.has(n)) self.disposeIcon(n); });
    Array.from(this.extras.keys()).forEach(function(n){
      if(!nodes.has(n) || !gizmosVisibleFor(n, selected, st.enabled)) self.disposeExtra(n);
    });

    const camPos = new THREE.Vector3(), camDir = new THREE.Vector3();
    const pos = new THREE.Vector3(), toNode = new THREE.Vector3();
    if(camera){ camera.getWorldPosition(camPos); camera.getWorldDirection(camDir); }
    // La carte d'ombre d'une lampe adopte le masque de calques de la caméra qui rend (three
    // r185) : celle d'édition voit le calque des aides. On lui donne le même masque, MOINS ce
    // calque — aucune aide d'édition n'entre jamais dans une ombre.
    const shadowMask = (camera && layer !== undefined) ? (camera.layers.mask & ~(1 << layer)) : null;

    nodes.forEach(function(node){
      const kind = iconKindOf(node);
      const inScene = shownInScene(node, scene);
      // Le repère 3D (sphère, cône, boîtier…) reste éteint, quoi que la relecture d'un fichier
      // ait reposé sur `castShadow` (serialization.js le relit, `true` par défaut).
      if(isMarkerNode(node) && !isEditorMarkerHidden(node)) hideEditorMarker(node);
      const light = ed(node).light;
      if(shadowMask !== null && light && light.shadow && light.shadow.camera
         && light.shadow.camera.layers.mask !== shadowMask){
        light.shadow.camera.layers.mask = shadowMask;
      }
      const isSel = selected.has(node);
      const showGizmos = inScene && gizmosVisibleFor(node, selected, st.enabled);
      const helper = ed(node).helper;
      if(helper) helper.visible = showGizmos;
      self.syncExtra(node, showGizmos, root, layer);

      if(!kind || !inScene){ self.disposeIcon(node); return; }
      let e = self.icons.get(node);
      if(e && e.kind !== kind){ self.disposeIcon(node); e = null; }
      if(!e){
        e = {sprite: self.makeSprite(kind, layer), kind: kind, selected: false};
        root.add(e.sprite);
        self.icons.set(node, e);
      }
      const sprite = e.sprite;
      node.getWorldPosition(pos);
      sprite.position.copy(pos);
      const dist = camera ? camPos.distanceTo(pos) : 0;
      const depth = camera ? toNode.copy(pos).sub(camPos).dot(camDir) : 1;
      // En orthographique, la distance à la caméra ne dit rien de ce qu'on voit : pas de fondu.
      const ortho = !!(camera && camera.isOrthographicCamera);
      let opacity = (isSel || ortho) ? 1 : iconOpacity(dist, st.fade);
      // Un composant décoché garde son icône, atténuée — comme dans Unity, on doit pouvoir le
      // retrouver pour le recocher.
      const comp = node.getComponent(componentOfKind(kind));
      if(comp && comp.active === false) opacity *= 0.45;
      if(e.selected !== isSel){
        sprite.material.map = self.textureFor(kind, isSel);
        sprite.material.needsUpdate = true;
        e.selected = isSel;
      }
      // Une lampe teinte son icône de SA couleur, éclaircie : une lampe rouge sombre resterait
      // sinon invisible sur la pastille.
      if(kind.indexOf('light') === 0 && comp && typeof comp.color === 'number'){
        sprite.material.color.setHex(comp.color).lerp(WHITE, 0.35);
      }
      sprite.material.opacity = opacity;
      sprite.visible = st.enabled && opacity > ICON_MIN_OPACITY && depth > 0;
      const size = iconWorldSize(camera, depth, st.size * (isSel ? ICON_SELECTED_SCALE : 1), ctx.viewHeight);
      sprite.scale.set(size, size, 1);
    });
  },

  /** Les gizmos de sélection propres à ce module : sphère d'influence d'une sonde, portées audio. */
  syncExtra(node, show, root, layer){
    const radii = show ? extraRadii(node) : [];
    if(!radii.length){ this.disposeExtra(node); return; }
    let g = this.extras.get(node);
    if(!g || g.children.length !== radii.length){
      this.disposeExtra(node);
      g = new THREE.Group();
      g.name = 'Gizmo de sélection';
      radii.forEach(function(r){
        const line = new THREE.LineSegments(unitRings(), new THREE.LineBasicMaterial({
          color: r.color, transparent: true, opacity: 0.6, depthTest: false, depthWrite: false, fog: false}));
        line.renderOrder = EDITOR_OVERLAY_ORDER + 5;
        line.raycast = function(){};
        if(layer !== undefined) line.layers.set(layer);
        g.add(line);
      });
      if(layer !== undefined) g.layers.set(layer);
      root.add(g);
      this.extras.set(node, g);
    }
    node.getWorldPosition(g.position);
    node.getWorldQuaternion(g.quaternion);
    radii.forEach(function(r, i){ g.children[i].scale.setScalar(Math.max(r.radius, 1e-3)); });
  },

  /**
   * Le nœud dont l'icône est sous le rayon, ou `null`. Interrogé par le viewport AVANT les
   * maillages : l'icône est dessinée par-dessus tout (`depthTest: false`), c'est donc elle que
   * l'on vise quand on clique dessus. Seules comptent les icônes visibles.
   */
  pick(raycaster){
    if(!this.root || !raycaster) return null;
    this.root.updateMatrixWorld(true);
    let best = null, bestDist = Infinity;
    this.icons.forEach(function(e, node){
      if(!e.sprite.visible || e.sprite.material.opacity <= ICON_MIN_OPACITY) return;
      const hits = [];
      // `raycast` direct et non `intersectObject` : le calque de l'icône n'a pas à figurer dans
      // le masque du raycaster appelant.
      e.sprite.raycast(raycaster, hits);
      if(hits.length && hits[0].distance < bestDist){ bestDist = hits[0].distance; best = node; }
    });
    return best;
  },

  /**
   * Exécute `fn` icônes et gizmos d'édition masqués, puis rend tout à l'identique. Pour une
   * CAPTURE (capture_view du copilote / MCP) : on y veut la scène, pas l'outil.
   * `others` : aides supplémentaires à masquer (le gizmo de transformation…).
   */
  withHidden(fn, others){
    const saved = [];
    const hide = function(o){ if(o && o.visible){ saved.push(o); o.visible = false; } };
    hide(this.root);
    (others || []).forEach(hide);
    this.candidates().forEach(function(n){ hide(ed(n).helper); });
    // Les visuels de sélection des autres modules (collider, boîte de sonde, zone de volume) :
    // enfants de leur nœud, rangés dans son sac d'édition.
    ['Collider', 'Collider2D', 'Reflection', 'PostVolume'].forEach(function(t){
      liveNodesOf(t).forEach(function(n){
        const e = ed(n);
        [e.colliderViz, e.collider2dViz, e.boxViz, e.postVolumeViz].forEach(hide);
      });
    });
    try { return fn(); }
    finally { saved.forEach(function(o){ o.visible = true; }); }
  }
};

function liveNodesOf(typeName){
  return (Registry && typeof Registry.liveNodes === 'function') ? Registry.liveNodes(typeName) : [];
}

/** Le composant qui donne son genre à une icône. */
export function componentOfKind(kind){
  if(kind && kind.indexOf('light') === 0) return 'Light';
  return {camera: 'Camera', probe: 'Reflection', 'post-volume': 'PostVolume',
          audio: 'AudioSource', particles: 'Particles'}[kind] || null;
}

/**
 * Les sphères que montre un nœud sélectionné, en plus des helpers de three : l'influence d'une
 * sonde (`radius`), la portée d'une source audio spatiale (`range`, puis `distanceMax`).
 */
export function extraRadii(node){
  const out = [];
  if(!node || typeof node.getComponent !== 'function') return out;
  const probe = node.getComponent('Reflection');
  const pd = node.userData && node.userData.probe;
  if(probe && probe.active !== false && pd && pd.radius > 0) out.push({radius: pd.radius, color: 0x9fe0ff});
  const audio = node.getComponent('AudioSource');
  const ad = node.userData && node.userData.audio;
  if(audio && ad && ad.spatial !== false){
    if(ad.range > 0) out.push({radius: ad.range, color: 0xa6f0c0});
    if(ad.distanceMax > 0 && ad.distanceMax !== ad.range) out.push({radius: ad.distanceMax, color: 0x5f9c78});
  }
  return out;
}

// Trois cercles unitaires (plans XY, XZ, YZ) : la « sphère » filaire d'Unity, lisible sans
// remplir l'écran de méridiens. Une seule géométrie, mise à l'échelle par gizmo.
let _unitRings = null;
function unitRings(){
  if(_unitRings) return _unitRings;
  const seg = 64, pts = [];
  for(let axis = 0; axis < 3; axis++){
    for(let i = 0; i < seg; i++){
      const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2;
      [a0, a1].forEach(function(a){
        const c = Math.cos(a), s = Math.sin(a);
        if(axis === 0) pts.push(c, s, 0);
        else if(axis === 1) pts.push(c, 0, s);
        else pts.push(0, c, s);
      });
    }
  }
  _unitRings = new THREE.BufferGeometry();
  _unitRings.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return _unitRings;
}

