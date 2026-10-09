// ---------- Sous-scènes instanciables (P2-2) ----------
// Un objet de type 'subScene' référence UNE AUTRE SCÈNE du projet et affiche son
// contenu comme ses enfants. Seul le nœud est sérialisé (référence + overrides) :
// le contenu est régénéré depuis la scène source, donc modifier la source met à jour
// toutes les instances. Les enfants portent userData.ssInstance = index de traversée
// (stable) et sont ignorés par la sérialisation.
//
// Overrides : capturés AUTOMATIQUEMENT à la sérialisation en comparant l'état current
// des enfants avec celui de la scène source (transform + visibilité), comme l'empreinte
// des prefabs. Déplacer un enfant d'instance crée donc un override sans rien demander.
import { assets } from './assets.js';
import { NodeShells } from './component-registry.js';
import { logConsole } from './console.js';
import { setStatus, updateHierarchy } from './hierarchy.js';
import { pushHistory } from './history.js';
import { buildInspector, removeHelper } from './inspector.js';
import { applyNodeMixin } from './node.js';
import { addSceneObject, listMats, nextCounter, removeSceneObject } from './objects.js';
import { changeScene, project } from './project.js';
import { applyFilters, scene } from './scene.js';
import { select } from './selection.js';
import { rebuildTree } from './serialization.js';

export const SS_DEPTH_MAX = 5;
export const stackSubScenes = [];        // noms en cours de construction (détection de cycles)

export function makeSubScene(nameScene){
  const mesh = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.34),
    new THREE.MeshStandardMaterial({color: 0x8a6bd8, wireframe: true}));
  mesh.name = nameScene ? ('◈ ' + nameScene) : 'Sous-scène';
  mesh.userData.type = 'subScene';
  mesh.userData.subScene = {scene: nameScene || '', overrides: {}};
  mesh.userData.emissiveBase = 0x000000;
  mesh.userData.emissiveSel = 0x2a1a4a;
  applyNodeMixin(mesh);   // permet + Component (dont ScriptJS) sur les sous-scènes
  mesh.addComponent('SubScene');   // ce que l'objet EST — voir component-subscene.js
  return mesh;
}

export function indexScene(name){
  return project.scenes.findIndex(function(s){ return s.name === name; });
}

// Données de la scène source. Une scène ne peut pas s'instancier elle-même : au-delà
// du cycle, lire l'état vivant pendant une reconstruction donnerait un état partiel.
export function dataSceneSource(name){
  const i = indexScene(name);
  if(i === -1 || i === project.current) return null;
  return project.scenes[i].data;
}

// parcourt les descendants d'une instance SANS entrer dans les sous-scènes imbriquées
// (leur contenu appartient à leur propre nœud, avec sa propre numérotation)
export function traversesSubScene(o, fn){
  o.children.forEach(function(c){
    fn(c);
    if(c.userData.type !== 'subScene') traversesSubScene(c, fn);
  });
}

// retire les enfants générés (mais garde les éventuels enfants ajoutés à la main)
export function clearSubScene(o){
  const aRemove = o.children.filter(function(c){
    return c.userData && c.userData.ssInstance !== undefined;
  });
  aRemove.forEach(function(c){
    c.traverse(function(x){
      removeSceneObject(x);
      removeHelper(x);
    });
    o.remove(c);
    c.traverse(function(x){
      if(x.geometry) x.geometry.dispose();
      listMats(x).forEach(function(m){ if(m.dispose) m.dispose(); });
    });
  });
}

// (re)construit le contenu d'un nœud sous-scène
// L'ENVIRONNEMENT ET LE RENDU APPARTIENNENT À LA SCÈNE HÔTE. Une sous-scène n'apporte JAMAIS
// les siens : on ne lit ici que `data.objects`, et `data.env` de la source est ignoré
// délibérément. La règle a l'air d'un détail tant qu'on ne l'a pas enfreinte — instancier une
// sous-scène changerait alors le ciel, le brouillard et le post-traitement de la scène qu'on
// est en train d'éditer, à chaque rechargement de l'instance.
//
// Le panneau Environnement avertit dans l'autre sens : quand la scène éditée sert de source
// ailleurs, ses réglages ne suivront pas (voir `sceneUsedAsSubScene` plus bas).
// Gardé par test/sous-scene-environnement.test.mjs.
export function populateSubScene(o){
  const ss = o.userData.subScene;
  if(!ss) return;
  clearSubScene(o);
  const name = (ss.scene || '').trim();
  if(!name) return;

  if(stackSubScenes.indexOf(name) !== -1){
    logConsole('error', 'sous-scène « ' + name + ' » : référence circulaire ignorée', o);
    return;
  }
  if(stackSubScenes.length >= SS_DEPTH_MAX){
    logConsole('warn', 'sous-scènes imbriquées : profondeur max (' + SS_DEPTH_MAX + ') atteinte', o);
    return;
  }
  const data = dataSceneSource(name);
  if(!data){
    logConsole('warn', 'sous-scène : scène « ' + name + ' » introuvable ou vide', o);
    return;
  }

  stackSubScenes.push(name);
  let rec = null;
  try{
    const assetsById = {};
    assets.forEach(function(a){ assetsById[a.id] = a; });
    rec = rebuildTree(data.objects || [], assetsById, true);
  } catch(e){
    logConsole('error', 'sous-scène « ' + name + ' » : ' + e.message, o);
  }
  stackSubScenes.pop();
  if(!rec) return;

  // numérotation stable : ordre de la liste sérialisée
  let n = 0;
  const order = [];
  (data.objects || []).forEach(function(d){
    const x = rec.byId[d.id];
    if(x) order.push(x);
  });
  order.forEach(function(x){
    x.userData.ssInstance = n++;
    addSceneObject(x);
  });
  rec.racines.forEach(function(r){ o.add(r); });

  // sous-scènes imbriquées : rebuildTree les crée vides, on les peuple ici
  // (toujours dans la pile anti-cycle du niveau current)
  const imbriquees = [];
  order.forEach(function(x){ if(x.userData.type === 'subScene') imbriquees.push(x); });
  stackSubScenes.push(name);
  imbriquees.forEach(function(x){ populateSubScene(x); });
  stackSubScenes.pop();

  applyOverrides(o);
}

export function setOverride(x, ov){
  if(!x || !ov) return;
  if(ov.pos) x.position.fromArray(ov.pos);
  if(ov.quat) x.quaternion.fromArray(ov.quat);
  if(ov.ech) x.scale.fromArray(ov.ech);
  if(ov.visible !== undefined) x.visible = ov.visible;
}

// applique les écarts enregistrés (transform, visibilité) sur les enfants générés.
// Les clés « 3/1 » visent l'enfant 1 de la sous-scène imbriquée 3 : les nœuds
// imbriqués n'étant pas sérialisés, leurs overrides remontent dans ce nœud-ci.
export function applyOverrides(o){
  const ss = o.userData.subScene;
  if(!ss || !ss.overrides) return;
  const byIndex = {};
  traversesSubScene(o, function(x){
    if(x.userData.ssInstance !== undefined) byIndex[x.userData.ssInstance] = x;
  });
  const imbriques = {};
  Object.keys(ss.overrides).forEach(function(key){
    const slash = key.indexOf('/');
    if(slash === -1){ setOverride(byIndex[key], ss.overrides[key]); return; }
    const i = key.slice(0, slash), reste = key.slice(slash + 1);
    (imbriques[i] = imbriques[i] || {})[reste] = ss.overrides[key];
  });
  Object.keys(imbriques).forEach(function(i){
    const node = byIndex[i];
    if(!node || !node.userData.subScene) return;
    node.userData.subScene.overrides =
      Object.assign(node.userData.subScene.overrides || {}, imbriques[i]);
    applyOverrides(node);
  });
}

// compare l'état current des enfants à la source et met à jour ss.overrides
export function captureOverrides(o){
  const ss = o.userData.subScene;
  if(!ss) return;
  const data = dataSceneSource((ss.scene || '').trim());
  if(!data){ return; }
  const source = {};
  let n = 0;
  (data.objects || []).forEach(function(d){ source[n++] = d; });
  const ovs = {};
  const near = function(a, b){
    for(let i = 0; i < a.length; i++) if(Math.abs(a[i] - b[i]) > 1e-4) return false;
    return true;
  };
  traversesSubScene(o, function(x){
    if(x.userData.ssInstance === undefined) return;
    const d = source[x.userData.ssInstance];
    if(!d) return;
    const ov = {};
    if(!near(x.position.toArray(), d.pos)) ov.pos = x.position.toArray();
    if(!near(x.quaternion.toArray(), d.quat)) ov.quat = x.quaternion.toArray();
    if(!near(x.scale.toArray(), d.ech)) ov.ech = x.scale.toArray();
    // `visibleIntent` : meme piege que les surcharges de modele, voir js/model-nodes.js.
    if(visibleIntent(x) !== (d.visible !== false)) ov.visible = visibleIntent(x);
    if(Object.keys(ov).length) ovs[x.userData.ssInstance] = ov;
  });
  // sous-scènes imbriquées : leurs overrides remontent ici, préfixés par leur index
  traversesSubScene(o, function(x){
    if(x.userData.type !== 'subScene' || x.userData.ssInstance === undefined) return;
    captureOverrides(x);
    const sous = (x.userData.subScene && x.userData.subScene.overrides) || {};
    Object.keys(sous).forEach(function(k){ ovs[x.userData.ssInstance + '/' + k] = sous[k]; });
  });
  ss.overrides = ovs;
}

/**
 * Cette scène est-elle instanciée comme sous-scène ailleurs dans le projet ?
 *
 * Sert à AVERTIR : ses réglages d'environnement et de rendu ne suivront pas dans les scènes qui
 * l'instancient — c'est la scène hôte qui gagne, et rien à l'écran ne le dirait.
 */
export function sceneUsedAsSubScene(name){
  if(!name) return false;
  return project.scenes.some(function(s, i){
    if(i === indexScene(name)) return false;
    const objs = (s.data && s.data.objects) || [];
    return objs.some(function(d){
      return d && d.subScene && (d.subScene.scene || '').trim() === name;
    });
  });
}

export function countOverrides(o){
  const ss = o.userData.subScene;
  return (ss && ss.overrides) ? Object.keys(ss.overrides).length : 0;
}

export function resetSubScene(o){
  pushHistory();
  o.userData.subScene.overrides = {};
  populateSubScene(o);
  updateHierarchy();
  buildInspector();
  setStatus('Instance réinitialisée sur la scène source', 2500);
}

// détache l'instance : le contenu devient des objets normaux, éditables et sérialisés
export function renderUniqueSubScene(o){
  pushHistory();
  const enfants = o.children.filter(function(c){ return c.userData.ssInstance !== undefined; });
  enfants.forEach(function(c){
    c.traverse(function(x){ delete x.userData.ssInstance; });
  });
  delete o.userData.subScene;
  o.userData.type = 'group';
  o.name = o.name.replace(/^◈\s*/, '');
  updateHierarchy();
  buildInspector();
  setStatus('Sous-scène détachée : son contenu est devenu un groupe modifiable', 3500);
}

export function openSceneSource(o){
  const ss = o.userData.subScene;
  const i = indexScene((ss.scene || '').trim());
  if(i === -1){ setStatus('Scène source introuvable', 2500); return; }
  if(i === project.current){ setStatus('Vous êtes déjà dans cette scène', 2000); return; }
  changeScene(i);
}

// ---------- création ----------
export function createSubScene(nameScene){
  const dispo = project.scenes.filter(function(s, i){ return i !== project.current; });
  if(!dispo.length){
    setStatus('Créez d\'abord une autre scène dans le projet (panneau Scènes → ＋)', 4000);
    return null;
  }
  const name = nameScene || dispo[0].name;
  pushHistory();
  const o = makeSubScene(name);
  nextCounter();
  scene.add(o);
  addSceneObject(o);
  populateSubScene(o);
  select(o);
  updateHierarchy();
  applyFilters();
  setStatus('Sous-scène « ' + name + ' » instanciée — modifiez la source, toutes les '
    + 'instances suivront', 4000);
  return o;
}

// ---------- section d'inspecteur ----------
// La section d'inspecteur de la sous-scène est un DESCRIPTEUR : PANEL_SUBSCENE, dans
// js/ui/panels-inspector.js. `sectionSubSceneHtml` construisait la chaîne HTML et laissait
// ses quatre boutons et son <select> à des branches de gestionnaires d'inspector.js.

// Le porteur d'une instance de scène. Son CONTENU n'est pas relu du fichier : il est régénéré
// depuis la scène source après le parentage (populateSubScene), puis les overrides réappliqués.
NodeShells.register('SubScene', function(d){ return makeSubScene((d && d.scene) || ''); });
