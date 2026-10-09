// ---------- Sondes de réflexion & d'ambiance (P2-5) ----------
// Une sonde cuit l'environnement vu depuis sa position dans un cubemap
// (THREE.CubeCamera) et le distribue comme envMap aux maillages situés dans son
// rayon d'influence : les surfaces métalliques et lisses reflètent alors leur
// décor local. La moyenne du cubemap donne aussi une couleur d'ambiance
// exploitable pour l'éclairage global de la scène.
//
// Le cubemap n'est JAMAIS sérialisé (il est recuit à l'ouverture et dans les
// builds) : seuls les réglages de la sonde le sont.
import { PROBE_DEFAULT, ed, ensureProbe } from './component-data.js';
import { NodeShells, Registry } from './component-registry.js';
import { liftOverlay } from './editor-overlay.js';
import { buildSkyBackground, env } from './environment.js';
import { setStatus } from './hierarchy.js';
import { buildInspector } from './inspector.js';
import { applyNodeMixin } from './node.js';
import { isSceneObject, listMats } from './objects.js';
import { LAYER_HELPERS, renderer, scene } from './scene.js';
import { selection } from './selection.js';

export function probeActive(o){
  return o.userData.type === 'probe' && o.userData.probe && o.userData.probe.active !== false;
}

// Les Noeuds porteurs d'un composant Reflection active et vivant. Remplace les
// `objets.filter(probeActive)` / `objets.forEach(... if probeActive)` qui
// balayaient TOUTE la scène pour trouver les deux ou trois sondes qu'elle
// contient. À lire une fois et à passer aux appelés — voir applyProbes(),
// dont c'était le défaut de complexité principal.
export function probesActive(){
  return Registry.activeNodes('Reflection').filter(probeActive);
}

// Les Noeuds qui REÇOIVENT un environnement : les deux formes de rendu (Mesh,
// Model) plus le terrain. Même bascule — avant, un test sur userData.type
// appliqué à tous les objets de la scène.
export function receiversDEnvironment(){
  return Registry.activeNodes('Mesh')
    .concat(Registry.activeNodes('Model'))
    .concat(Registry.activeNodes('Terrain'));
}

export const engineProbes = {
  cuites: new Map(),   // objet sonde → {rt, cam, couleur, uni, noeudBoite}
  sky: null           // cubemap du ciel de la scène (sonde par défaut) → {rt, cam, key}
};

export function makeProbe(){
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.4, 24, 16),
    new THREE.MeshStandardMaterial({color: 0xdddddd, roughness: 0.05, metalness: 1}));
  mesh.name = 'Sonde';
  mesh.userData.type = 'probe';
  mesh.userData.probe = JSON.parse(JSON.stringify(PROBE_DEFAULT));
  mesh.userData.emissiveBase = 0x000000;
  mesh.userData.emissiveSel = 0x14324a;
  // icône d'édition uniquement : jamais visible par une caméra de jeu
  mesh.layers.set(LAYER_HELPERS);
  applyNodeMixin(mesh);
  mesh.addComponent('Reflection', mesh.userData.probe);
  return mesh;
}

export function disposeProbe(o){
  const c = engineProbes.cuites.get(o);
  if(!c) return;
  if(c.rt) c.rt.dispose();
  engineProbes.cuites.delete(o);
}

// ---------- le ciel comme sonde par défaut (repli) ----------
// Un objet qu'aucune sonde ne couvre reçoit le ciel de la scène en environnement, comme
// dans Unity (Skybox → Environment Reflections). C'est cuit une seule fois
// par ciel, partagé par toute la scène, et jamais sérialisé.
export const SKY_RESOLUTION = 64;   // le ciel n'a pas de détail : 64 suffit et coûte 6 rendus minuscules
export let domeBake = null;       // texture de fond jetable de la cuisson précédente (voir disposeDomeBake)
export let pendingSky = 0;          // tentatives restantes quand le backend n'est pas encore prêt

// Tout ce qui change l'apparence du ciel. applyEnvironment() est rappelé au moindre
// réglage de brouillard ou d'ambiance : sans cette signature on recuirait à chaque frappe.
export function keySky(e){
  return [e.sky, e.skyColor, e.skyTop, e.skyBottom, e.skyAsset,
          e.skyReflets !== false, SKY_RESOLUTION].join('|');
}

// La texture de fond n'est PAS libérée dans la foulée du rendu : sous WebGPU le rendu n'est
// qu'encodé au retour de update(), et la détruire aussitôt reviendrait à courir
// après le backend. Elle attend la cuisson suivante.
export function disposeDomeBake(){
  if(!domeBake) return;
  domeBake.dispose();
  domeBake = null;
}

export function disposeSky(){
  if(engineProbes.sky && engineProbes.sky.rt) engineProbes.sky.rt.dispose();
  engineProbes.sky = null;
  disposeDomeBake();
}

// Cuit le CIEL SEUL, dans une scène jetable vide dont le ciel est le seul fond : aucun objet
// du décor ne peut s'y glisser, donc rien à masquer ni à remettre en place ensuite.
export function bakeSky(key){
  try{
    disposeDomeBake();
    const sc = new THREE.Scene();
    const fond = buildSkyBackground(env);
    sc.background = fond;
    if(fond && fond.isTexture) domeBake = fond;

    let c = engineProbes.sky;
    if(!c || !c.rt){
      const rt = createTargetCube(SKY_RESOLUTION);
      c = {rt: rt, cam: new THREE.CubeCamera(0.1, 400, rt), key: null};
      engineProbes.sky = c;
    }
    c.cam.position.set(0, 0, 0);
    c.cam.update(renderer, sc);
    c.key = key;
    return c;
  } catch(e){
    // Jamais en silence : c'est exactement ce qui avait laissé la mesure d'ambiance
    // disparaître pendant toute la migration WebGPU.
    console.warn('Sonde : reflet du ciel non cuit —', e && e.message ? e.message : e);
    disposeSky();
    return null;
  }
}

// WebGPURenderer.init() est asynchrone et applyEnvironment() pass AVANT lui au
// démarrage (startup.js). On ne cuit pas de force sur un backend absent — on repasse.
export function scheduleResumeSky(){
  if(pendingSky > 0) return;
  pendingSky = 100;   // ~10 s à 100 ms : au-delà, le backend ne viendra plus
  const reessayer = function(){
    pendingSky--;
    if(pendingSky <= 0){ pendingSky = 0; return; }
    if(!renderer.__ready){ setTimeout(reessayer, 100); return; }
    pendingSky = 0;
    applyProbes();   // cuira le ciel, maintenant que le backend répond
  };
  setTimeout(reessayer, 100);
}

// Texture d'environnement du ciel, cuite à la demande. null = pas de repli (désactivé,
// ou backend pas encore prêt et rien de cuit).
export function envMapOfSky(){
  if(typeof env === 'undefined' || env.skyReflets === false){
    disposeSky();
    return null;
  }
  const key = keySky(env);
  const dejaCuit = engineProbes.sky;
  if(dejaCuit && dejaCuit.key === key) return dejaCuit.rt.texture;
  if(!renderer.__ready){
    scheduleResumeSky();
    return dejaCuit ? dejaCuit.rt.texture : null;   // mieux vaut l'ancien ciel que rien
  }
  const c = bakeSky(key);
  return c ? c.rt.texture : null;
}

// ---------- cuisson ----------
// Cible cubemap. Le paquet three/webgpu ne définit PAS WebGLCubeRenderTarget (classe
// spécifique au backend WebGL) — il fournit CubeRenderTarget. Comme le pont ESM donne la
// priorité au paquet webgpu pour ce qu'il définit et retombe sur le THREE classique pour
// le reste, écrire `new THREE.WebGLCubeRenderTarget(...)` donnait au WebGPURenderer une
// cible venue de l'AUTRE bundle, qu'il ne reconnaît pas — le même mélange de classes qui
// avait rendu les lumières inertes (voir render-webgpu-bridge.mjs).
export function createTargetCube(res){
  const opt = {
    // RGBA : obligatoire pour relire les pixels (mesure d'ambiance) côté WebGL,
    // et déjà le défaut côté WebGPU.
    format: THREE.RGBAFormat,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter
  };
  // LE RENDERER DÉCIDE, pas la présence de la classe. Quand les deux three sont chargés (pont
  // ESM + three.min.js, « Multiple instances of Three.js »), THREE.CubeRenderTarget existe AUSSI
  // sous le renderer WebGL : sa texture n'est alors pas reconnue comme cible de rendu, le
  // WebGLRenderer tente de TÉLÉVERSER six images absentes et lève « texSubImage2D : Overload
  // resolution failed » dans setTextureCube, à chaque image qui lit le reflet.
  const webgl = renderer && !renderer.isWebGPURenderer;
  if(webgl && THREE.WebGLCubeRenderTarget) return new THREE.WebGLCubeRenderTarget(res, opt);
  return THREE.CubeRenderTarget ? new THREE.CubeRenderTarget(res, opt)
                                : new THREE.WebGLCubeRenderTarget(res, opt);
}

// Les proxies de sondes et les aides visuelles sont masqués : une sonde ne doit
// ni se voir elle-même, ni capturer les gizmos de l'éditeur.
export function bakeProbe(o){
  const s = ensureProbe(o);
  const res = Math.max(16, Math.min(512, s.resolution | 0 || 128));
  let c = engineProbes.cuites.get(o);
  if(!c || !c.rt || c.rt.width !== res){
    if(c && c.rt) c.rt.dispose();
    c = {rt: createTargetCube(res), color: null};
    c.cam = new THREE.CubeCamera(0.1, 800, c.rt);
    // voit tous les calques de PROJET (0-30, comme un objet peut être sur n'importe lequel
    // depuis le Lot 2), mais jamais LAYER_HELPERS (31) : une sonde ne doit jamais voir le
    // gizmo, les helpers, le sol ou la grille dans ses reflets. CubeCamera rend avec 6
    // sous-caméras internes (object3D.layers n'est pas hérité par les enfants) : on
    // applique donc le masque à l'objet ET à chacun de ses enfants.
    const applyMaskProbe = function(cam3){
      cam3.layers.disableAll();
      for(let i = 0; i < LAYER_HELPERS; i++) cam3.layers.enable(i);
    };
    applyMaskProbe(c.cam);
    c.cam.traverse(applyMaskProbe);
    engineProbes.cuites.set(o, c);
  }
  // masquage temporaire des autres sondes (le gizmo/helpers/sol/grille sont sur
  // LAYER_HELPERS, jamais vu par ce CubeCamera qui reste sur le calque 0 par défaut —
  // corrige au passage le bug où la sonde cuisait la grille dans ses reflets)
  const masques = [];
  Registry.activeNodes('Reflection').forEach(function(x){
    if(x.visible){ masques.push(x); x.visible = false; }
  });

  o.getWorldPosition(c.cam.position);
  c.cam.update(renderer, scene);

  masques.forEach(function(x){ x.visible = true; });

  // La couleur d'ambiance demande de RELIRE les pixels, ce qui est asynchrone sous
  // WebGPU. On ne rend pas toute la chaîne de cuisson asynchrone pour autant : le
  // cubemap (donc les reflets) est prêt ici et maintenant, l'ambiance est une valeur
  // dérivée et facultative, qui arrive quand elle peut.
  c.color = null;
  measureAmbientProbe(c).then(function(color){
    if(engineProbes.cuites.get(o) !== c) return;   // sonde recuite ou libérée entre-temps
    c.color = color;
    // l'inspecteur shown l'ambiance mesurée : le reconstruire s'il montre cette sonde,
    // sauf si l'utilisateur est en train de saisir un champ (on lui volerait le focus)
    const a = document.activeElement;
    const inInput = a && (a.tagName === 'INPUT' || a.tagName === 'SELECT' || a.tagName === 'TEXTAREA');
    if(color && selection === o && !inInput) buildInspector();
  });
  return c;
}

// Une face entière du cubemap, en octets RGBA. On lit la face COMPLÈTE et non la seule
// zone utile : WebGPU aligne les lignes d'un transfert sur 256 octets, et une largeur
// partielle (48 px = 192 o) tomberait à côté. Le surcoût est négligeable et hors
// chemin de rendu.
export function readFaceProbe(rt, size, face){
  if(renderer.isWebGPURenderer){
    // Signature WebGPU : (cible, x, y, largeur, hauteur, index, face) — et elle
    // RETOURNE le tampon au lieu d'en remplir un fourni, contrairement à WebGL.
    return renderer.readRenderTargetPixelsAsync(rt, 0, 0, size, size, 0, face);
  }
  const buf = new Uint8Array(size * size * 4);
  if(renderer.readRenderTargetPixelsAsync)
    return renderer.readRenderTargetPixelsAsync(rt, 0, 0, size, size, buf, face);
  renderer.readRenderTargetPixels(rt, 0, 0, size, size, buf, face);
  return Promise.resolve(buf);
}

// moyenne des 6 faces → couleur d'ambiance locale. On n'agrège que la zone CENTRALE de
// chaque face : ses coins regardent en biais et ne représentent pas ce que la sonde voit
// réellement.
export async function measureAmbientProbe(c){
  try{
    const size = c.rt.width;
    const n = Math.max(8, Math.min(48, Math.floor(size / 2)));
    const dec = Math.floor((size - n) / 2);
    let r = 0, v = 0, b = 0, nb = 0;
    for(let face = 0; face < 6; face++){
      const buf = await readFaceProbe(c.rt, size, face);
      if(!buf || buf.length < size * size * 4) return null;
      // déduit du tampon reçu : absorbe un éventuel remplissage d'alignement des lignes
      const byLine = Math.floor(buf.length / size);
      for(let y = dec; y < dec + n; y++){
        for(let x = dec; x < dec + n; x++){
          const i = y * byLine + x * 4;
          r += buf[i]; v += buf[i+1]; b += buf[i+2]; nb++;
        }
      }
    }
    if(!nb) return null;
    return '#' + [r, v, b].map(function(x){
      const h = Math.round(x / nb).toString(16);
      return h.length < 2 ? '0' + h : h;
    }).join('');
  } catch(e){
    // Ne plus échouer en silence : c'est ce qui avait masqué la disparition de
    // readRenderTargetPixels() sous WebGPU pendant toute une migration.
    console.warn('Sonde : mesure de la couleur d\'ambiance impossible —', e && e.message ? e.message : e);
    return null;
  }
}

export function bakeAllProbes(silencieux){
  const list = probesActive();
  // Cuisson FORCÉE du ciel : la signature ne voit pas le contenu d'un panorama réimporté,
  // et c'est précisément ce bouton qu'on presse quand le reflet semble périmé.
  if(engineProbes.sky) engineProbes.sky.key = null;
  list.forEach(bakeProbe);
  applyProbes();
  if(silencieux) return list.length;
  if(list.length) setStatus(list.length + ' sonde(s) cuite(s) — reflets mis à jour', 2500);
  else if(env.skyReflets !== false)
    setStatus('Aucune sonde : les objets reflètent le ciel de la scène '
      + '(Objet → 🔮 Sonde de réflexion pour un reflet local)', 3500);
  else
    setStatus('Aucune sonde, et les reflets du ciel sont coupés : aucun objet ne reflète '
      + 'quoi que ce soit', 3500);
  return list.length;
}

// ---------- distribution aux matériaux ----------
export const _sdA = new THREE.Vector3(), _sdB = new THREE.Vector3();

// `sondes` est la liste des sondes active, calculee UNE FOIS par l'appelant.
// Avant, cette fonction rebalayait `objects` en entier a chaque appel — et
// applyProbes() l'appelle une fois PAR OBJET de la scene : le cout etait en
// O(objets x objets), declenche notamment a chaque creation d'objet (voir
// register(), objects.js). Il est desormais en O(objets x sondes).
export function probeMoreNear(o, probes){
  o.getWorldPosition(_sdA);
  let best = null, bestD = Infinity;
  (probes || probesActive()).forEach(function(x){
    const c = engineProbes.cuites.get(x);
    if(!c || !c.rt) return;
    x.getWorldPosition(_sdB);
    const d = _sdA.distanceTo(_sdB);
    const s = ensureProbe(x);
    if(d <= s.radius && d < bestD){ best = x; bestD = d; }
  });
  return best;
}

// libère tous les cubemaps (changement de scène, undo : les objets sont recréés)
export function disposeAllProbes(){
  engineProbes.cuites.forEach(function(c){ if(c.rt) c.rt.dispose(); });
  engineProbes.cuites.clear();
}

// ---------- projection boîte ----------
// Le cubemap a été cuit depuis UN point ; l'échantillonner avec le vecteur de réflexion
// raw revient à supposer le décor infiniment loin. Dans une pièce, on cherche plutôt où
// le rayon réfléchi PERCE les murs, et on regarde ce point depuis la sonde.
//
// Cette fonction existe en DEUX exemplaires — ici en JS, juste en dessous en nœuds TSL —
// et c'est assumé : seul l'exemplaire JS est mesurable sans GPU, et le test compare le
// graphe de nœuds à lui, cas par cas. `pos`, `dir`, `center`, `demi`, `posSonde` sont des
// triplets en repère MONDE ; `dir` doit être normalisé.
export function fixReflectionBox(pos, dir, center, half, posProbe){
  let t = Infinity;
  for(let i = 0; i < 3; i++){
    // Des deux plans de l'axe, un seul est devant le rayon : leurs deux distances sont de
    // signes opposés, `max` désigne donc toujours celui de devant sans avoir à tester le
    // signe de dir (et un dir nul donne ±Infini, qui ne contraint rien — voulu).
    t = Math.min(t, Math.max((center[i] + half[i] - pos[i]) / dir[i],
                             (center[i] - half[i] - pos[i]) / dir[i]));
  }
  return [pos[0] + dir[0] * t - posProbe[0],
          pos[1] + dir[1] * t - posProbe[1],
          pos[2] + dir[2] * t - posProbe[2]];
}

// Transcription en nœuds de fixReflectionBox, terme pour terme. Le vecteur de
// réflexion est recalculé en repère monde plutôt que repris de three : celui du contexte
// de radiance (EnvironmentNode) est déjà mélangé à la normale selon la rugosité et n'est
// pas exposé.
export function nodeDirectionBox(uCenter, uHalf, uProbe){
  const {positionWorld, cameraPosition, transformedNormalWorld} = TSL;
  const pos = positionWorld;
  const dir = pos.sub(cameraPosition).normalize().reflect(transformedNormalWorld);
  const toMax = uCenter.add(uHalf).sub(pos).div(dir);
  const toMin = uCenter.sub(uHalf).sub(pos).div(dir);
  const front = toMax.max(toMin);
  const t = front.x.min(front.y).min(front.z);
  return pos.add(dir.mul(t)).sub(uProbe);
}

export let warnedBoxWithoutTsl = false;

// Nœud d'environnement d'une sonde, ou null quand elle n'a pas de projection boîte (three
// prend alors son chemin normal depuis envMap).
//
// `pmremTexture` est EXACTEMENT ce que three place lui-même sous EnvironmentNode pour une
// envMap : on garde donc son filtrage par rugosité (le niveau de mip vient du contexte
// appelant), on ne remplace que le vecteur d'échantillonnage.
//
// LIMITE CONNUE : ce vecteur sert aussi au terme d'irradiance, que three échantillonnerait
// avec la normale. Sur un métal — le cas visé — l'irradiance ne contribue pas ; sur un
// diélectrique rugueux, l'ambiance vient du mur reflété au lieu du mur regardé. Un seul
// uvNode est exposé par three, il n'y a pas de medium de distinguer les deux contextes.
export function nodeEnvProbe(probe, c){
  const s = ensureProbe(probe);
  if(!s.box) return null;
  if(typeof TSL === 'undefined' || !TSL || !TSL.pmremTexture){
    if(!warnedBoxWithoutTsl){
      warnedBoxWithoutTsl = true;
      console.warn('Sonde : projection boîte ignorée — TSL indisponible, le reflet reste '
        + 'calculé comme venant de l\'infini.');
    }
    return null;
  }
  if(!c.nodeBox){
    c.uni = {
      center: TSL.uniform(new THREE.Vector3()),
      half:   TSL.uniform(new THREE.Vector3()),
      probe:  TSL.uniform(new THREE.Vector3())
    };
    c.nodeBox = TSL.pmremTexture(c.rt.texture,
      nodeDirectionBox(c.uni.center, c.uni.half, c.uni.probe));
  }
  // Uniformes rafraîchies à chaque distribution : la sonde a pu bouger ou sa boîte changer
  // de taille depuis la cuisson, et le nœud, lui, est construit une fois pour toutes.
  probe.getWorldPosition(_sdA);
  c.uni.probe.value.copy(_sdA);
  c.uni.center.value.set(_sdA.x + s.boxOffset[0],
                         _sdA.y + s.boxOffset[1],
                         _sdA.z + s.boxOffset[2]);
  c.uni.half.value.set(Math.max(0.01, s.boxSize[0] / 2),
                       Math.max(0.01, s.boxSize[1] / 2),
                       Math.max(0.01, s.boxSize[2] / 2));
  return c.nodeBox;
}

// Seule porte d'écriture de l'environnement sur un matériau. `node` est le nœud de
// projection boîte, ou null pour le chemin normal de three.
//
// Le needsUpdate n'est pas décoratif : envNode fait bien partie de la clé de hidden d'un
// objet de rendu, mais three ne la RECALCULE que si la version du matériau a bougé. Sans
// lui, poser un envNode après la première image ne changerait rien — sans erreur.
// Quels matériaux acceptent un environnement. On les NOMME, plutôt que de tester la
// présence d'un champ : `'envMap' in m` est vrai pour TOUS les matériaux de three, y
// compris MeshBasicMaterial — mesuré, le champ existe bel et bien.
//
// Et sur un Basic, `combine` vaut MultiplyOperation par défaut : la couleur de l'objet
// est MULTIPLIÉE par le ciel. Avec le ciel sombre de la scène par défaut (#14161a, à peu
// près 8 % de gris), tout matériau « non éclairé » virait donc au noir — à la simple
// RÉOUVERTURE d'un projet old, sans que personne n'ait rien touché. Un reflet n'a de
// sens que sur un matériau qui fait de l'éclairage physique.
export function acceptsEnvironment(m){
  return !!m && (m.isMeshStandardMaterial === true || m.isMeshPhysicalMaterial === true);
}

// Seule porte d'écriture de l'environnement sur un matériau. `node` est le nœud de
// projection boîte, ou null pour le chemin normal de three.
//
// Le needsUpdate n'est pas décoratif : envNode fait bien partie de la clé de hidden d'un
// objet de rendu, mais three ne la RECALCULE que si la version du matériau a bougé. Sans
// lui, poser un envNode après la première image ne changerait rien — sans erreur.
export function setEnvironmentOn(m, tex, intensity, node){
  if(!acceptsEnvironment(m)) return;
  // Comparer `envMapIntensity` est sûr ICI, et seulement ici : cette propriété vaut
  // `undefined` sur les matériaux qui ne la portent pas — un MeshBasicMaterial par
  // exemple — et la comparaison échouerait alors TOUJOURS, reposant `needsUpdate` à
  // chaque appel : une recompilation de pipeline par image, et par cran du curseur de
  // brouillard. Si `acceptsEnvironment` s'élargit un jour à un type qui n'a pas cette
  // propriété, cette ligne redevient fausse en silence — vérifié : Standard et Physical
  // la définissent tous deux à 1.
  const nodeActuel = m.envNode || null;
  if(m.envMap === tex && nodeActuel === node
     && (tex === null || m.envMapIntensity === intensity)) return;
  // RETIRER un environnement n'est pas symétrique d'en poser un — et c'est ce qui plantait.
  //
  // LE PLANTAGE MESURÉ (v0.108.0). Couper les reflets du ciel fait rendre `null` à
  // `envMapOfSky()`, donc passer ici avec `tex === null`. Sous le renderer WebGPU, le
  // matériau a DÉJÀ construit le groupe de bindings qui porte le sampler de l'ancienne
  // texture. `needsUpdate` reconstruit le PROGRAMME, pas ce groupe-là : le binding survit en
  // référençant une texture devenue nulle, et son `equals()` déréférence `texture.isTexture`
  // à chaque image — `TypeError: Cannot read properties of null` répété dans la boucle de
  // rendu, jusqu'au rechargement de la page.
  //
  // `dispose()` libère justement les ressources GPU du matériau, bindings compris ; tout est
  // reconstruit à l'image suivante, cette fois sans environnement. C'est un geste coûteux,
  // mais il n'a lieu QUE sur la transition vers `null` — la garde d'égalité au-dessus sort
  // sans rien faire quand l'état ne change pas, donc jamais par image.
  const removed = (tex === null && (m.envMap || m.envNode));
  if(removed && typeof m.dispose === 'function') m.dispose();
  m.envMap = tex;
  if(node) m.envNode = node;
  else if(m.envNode) m.envNode = null;
  if(tex !== null) m.envMapIntensity = intensity;
  m.needsUpdate = true;
}

// applique l'envMap de chaque maillage : la sonde qui le couvre, sinon le ciel de la scène
export function applyProbes(){
  // purge des cubemaps dont la sonde a disparu (suppression, undo)
  Array.from(engineProbes.cuites.keys()).forEach(function(o){
    if(!isSceneObject(o)) disposeProbe(o);
  });
  const probes = probesActive();
  const texSky = envMapOfSky();
  const intensitySky = (typeof env !== 'undefined' && env.skyRefletsIntensity !== undefined)
    ? env.skyRefletsIntensity : 1;
  receiversDEnvironment().forEach(function(o){
    const probe = probes.length ? probeMoreNear(o, probes) : null;
    const c = probe ? engineProbes.cuites.get(probe) : null;
    const s = probe ? ensureProbe(probe) : null;
    const tex = c ? c.rt.texture : texSky;
    const intensity = c ? s.intensity : intensitySky;
    const node = c ? nodeEnvProbe(probe, c) : null;
    o.traverse(function(x){
      if(!x.isMesh) return;
      // Les aides d'édition (visuel de collider, boîte de sonde) sont des enfants de
      // l'objet : depuis que le repli sur le ciel touche TOUS les maillages, elles
      // recevraient un reflet qu'elles n'avaient jamais eu.
      if(x !== o && x.layers.isEnabled(LAYER_HELPERS)) return;
      listMats(x).forEach(function(m){ setEnvironmentOn(m, tex, intensity, node); });
    });
  });
}

// retire toutes les envMap issues des sondes (avant suppression / nouvelle scène)
export function removeProbesOfMaterials(){
  receiversDEnvironment().forEach(function(o){
    o.traverse(function(x){
      if(!x.isMesh) return;
      listMats(x).forEach(function(m){
        if(!acceptsEnvironment(m) || (!m.envMap && !m.envNode)) return;
        // Même raison que dans `setEnvironmentOn` : sous WebGPU, le binding de l'ancienne
        // texture survit à `needsUpdate` et déréférence `null.isTexture` à chaque image.
        if(typeof m.dispose === 'function') m.dispose();
        m.envMap = null;
        if(m.envNode) m.envNode = null;   // sinon la projection boîte survit à la scène
        m.needsUpdate = true;
      });
    });
  });
}

// ---------- L'interface de la sonde a déménagé ----------
// `sectionProbeHtml`, `syncProbe` et `readProbeFromDom` construisaient, synchronisaient et
// relisaient quinze champs à la main. Elles sont remplacées par le descripteur du composant
// Reflection (js/ui/panels-components.js) : mêmes ids, mêmes bornes, et le même état de
// cuisson affiché — « non cuite », ou « cuite (256px) · 4 objet(s) couvert(s) ». Ce fichier ne
// garde que la DONNÉE et la cuisson elle-même.

// ---------- repère de la boîte ----------
// Sans repère visible, régler une boîte de projection revient à taper des nombres au
// hasard. Même dispositif que le visuel de collider (inspector.js) : filaire, enfant de
// la sonde, sur LAYER_HELPERS donc jamais vu par une caméra de jeu ni par une cuisson.
export const matBoxProbe = new THREE.MeshBasicMaterial({
  color: 0xff9f43, wireframe: true, transparent: true, opacity: 0.5, depthTest: false});

// Le maillage est rangé dans `ed(o)` et surtout PAS dans userData : Object3D.copy recopie
// userData par JSON.parse(JSON.stringify(...)), et un Mesh n'y survivrait pas.
export function removeBoxProbeViz(o){
  const v = ed(o).boxViz;
  if(!v) return;
  o.remove(v);
  v.geometry.dispose();
  v.material.dispose();
  ed(o).boxViz = null;
}

export function updateBoxProbeViz(){
  // Seules les SONDES portent une boîte de visualisation : parcourir toute la
  // scène pour trouver celles à unregister revenait à poser la question à des
  // milliers d'objets qui ne peuvent pas y répondre oui. liveNodes et pas
  // activeNodes : une sonde qu'on vient de décocher doit justement voir sa
  // boîte disparaître, donc elle doit encore être atteignable ici.
  Registry.liveNodes('Reflection').forEach(function(o){
    if(ed(o).boxViz && o !== selection) removeBoxProbeViz(o);
  });
  if(!selection || !isSceneObject(selection)) return;
  removeBoxProbeViz(selection);
  if(!probeActive(selection)) return;
  const s = ensureProbe(selection);
  if(!s.box) return;
  const viz = new THREE.Mesh(
    new THREE.BoxGeometry(s.boxSize[0], s.boxSize[1], s.boxSize[2]),
    matBoxProbe.clone());
  viz.position.fromArray(s.boxOffset);
  viz.raycast = function(){};
  liftOverlay(viz);
  viz.userData.isHelpProbe = true;   // purgé des copies par cloneCleanly (objects.js)
  viz.layers.set(LAYER_HELPERS);
  selection.add(viz);
  ed(selection).boxViz = viz;
}

// Le porteur d'une sonde : la sphère miroir, repère d'édition (voir NodeShells).
NodeShells.register('Reflection', function(){ return makeProbe(); });


// EXPOSÉ EN GLOBALE, à dessein. Ces symboles sont appelés depuis des fichiers
// que les mêmes pages ne chargent pas toutes : un `import` y pointerait un
// fichier absent, et la page ne démarrerait pas. Ils gardent donc leur garde
// `typeof` côté appelant, et se déclarent ici.
globalThis.applyProbes = applyProbes;
globalThis.disposeProbe = disposeProbe;
globalThis.removeBoxProbeViz = removeBoxProbeViz;
globalThis.updateBoxProbeViz = updateBoxProbeViz;