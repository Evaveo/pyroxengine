// ---------- Physics (cannon.js) ----------
// Le bouton Simuler prend un instantané des poses, crée les corps rigides à
// partir des objets marqués dans l'inspecteur, puis restaure tout à l'arrêt.
import { _vA, anim, tracksOfScene } from './animation.js';
import { Registry } from './component-registry.js';
import { isDescendant, setStatus } from './hierarchy.js';
import { syncInspector, syncInspectorThrottled } from './inspector.js';
import { buildRigidBody, canHaveRigidBody } from './rigid-body.js';
import { gizmoAttach, scene, tc } from './scene.js';
import { setGizmoBlocked } from './readonly-ui.js';
import { selection } from './selection.js';

export const phys = {active:false, world:null, matGround:null, links:[], kinematic:[], snapshot:[]};
export const btnSim = document.getElementById('btn-sim');

// ensurePhys vit dans composant-data.js (partagé éditeur/runtime, vague 1 du naming) —
// doublon exact réintroduit par le merge de main, retiré ici (voir docs/KNOWN_ISSUES.md).

export const _wp = new THREE.Vector3(), _wq = new THREE.Quaternion(), _ws = new THREE.Vector3();

export function objectAnimated(o){
  // Les pistes de SCÈNE : un clip d'asset open dans la timeline est en cours d'édition, il
  // ne doit pas rendre cinématiques les objets qu'il touche.
  const list = (typeof tracksOfScene === 'function') ? tracksOfScene() : anim.tracks;
  return list.some(function(p){ return p.obj === o || isDescendant(o, p.obj); });
}

// buildRigidBody vit dans rigid-body.js (fichier PARTAGE editeur <-> runtime) — la copie
// `construireCorpsPour` reintroduite ici par le merge de main a ete retiree (elle etait de
// surcroit moins complete : discrimination Mesh/Terrain sur userData.type au lieu des
// composants). Voir docs/KNOWN_ISSUES.md.

// canHaveRigidBody vit dans rigid-body.js (partagé éditeur/runtime, vague 1 du naming) —
// doublon réintroduit par le merge de main (et moins complet : sans le cas Model), retiré
// ici (voir docs/KNOWN_ISSUES.md).

// MIROIR de rtBindBody (js/game-runtime.js) — brancher la physique sur un objet, y compris
// sur un objet engendré EN COURS DE SIMULATION par api.create. Sans ce chemin, tout ce qu'un
// script fait apparaître arrive sans body : ça ne tombe pas, ça ne heurte rien, et
// api.setVelocity ne trouve aucun link à pousser.
export function bindBodyPhysics(o){
  if(typeof CANNON === 'undefined' || !phys.world || !o || !o.userData) return null;
  if(!canHaveRigidBody(o)) return null;
  if(phys.links.some(function(l){ return l.obj === o; })) return null;
  if(phys.kinematic.some(function(k){ return k.obj === o; })) return null;
  if(objectAnimated(o)){
    const fk = buildRigidBody(o, 0);
    fk.body.type = CANNON.Body.KINEMATIC;
    phys.world.addBody(fk.body);
    phys.kinematic.push({obj:o, body:fk.body});
    return null;
  }
  const r = o.userData.phys;
  if(!r || !r.active) return null;
  const fab = buildRigidBody(o, Math.max(0, r.masse));
  phys.world.addBody(fab.body);
  phys.world.addContactMaterial(new CANNON.ContactMaterial(phys.matGround, fab.material, {
    friction: r.friction, restitution: r.bounce}));
  const link = {obj:o, body:fab.body, offset:fab.offset};
  phys.links.push(link);
  return link;
}

// Retirer le corps AVEC l'objet : un objet supprimé qui garde son collider laisse un mur
// invisible au milieu de la scène.
export function detachBodyPhysics(o){
  if(!phys.world) return;
  [phys.links, phys.kinematic].forEach(function(list){
    for(let i = list.length - 1; i >= 0; i--){
      if(list[i].obj !== o) continue;
      phys.world.removeBody(list[i].body);
      list.splice(i, 1);
    }
  });
}

export function startSimulation(inModeGame){
  // Les candidats viennent du REGISTRE de composants, pas d'un balayage de toute
  // la scène : `Registry.activeNodes('Physics')` rend directement les Noeuds
  // portant un composant Physics active et vivant. Avant, c'était
  // `objets.filter(o => o.userData.phys && o.userData.phys.active && ...)` — un
  // parcours linéaire des milliers d'objets d'une scène pour en retenir dix, et
  // un test sur un sac `userData` là où la question posée est « qui a ce
  // composant ? ». Le coût suit désormais le nombre de porteurs.
  const porteurs = Registry.activeNodes('Physics');
  // dynamiques : corps rigides cochés, non animés
  const candidats = porteurs.filter(function(o){
    return o.userData.phys && o.userData.phys.active
      && canHaveRigidBody(o)
      && !objectAnimated(o);
  });
  // cinématiques : les objets ANIMÉS deviennent des obstacles mobiles pilotés
  // par la timeline (plateformes, portes…) qui poussent les corps dynamiques.
  //
  // Ceux-là NE passent pas par le composant Physics : un décor animé n'a
  // aucune raison d'avoir « corps rigide » coché pour repousser le joueur. Le
  // critère reste donc « peut porter un corps » + « est animé », et l'ensemble
  // de départ est celui des porteurs d'une FORME DE RENDU — même raisonnement de
  // Registry (Mesh ET modele : un décor animé est très souvent un modèle
  // importé, une porte ou une plateforme).
  const animated = Registry.activeNodes('Mesh')
    .concat(Registry.activeNodes('Model'))
    .filter(objectAnimated);
  if(!candidats.length && !inModeGame){
    setStatus(animated.length
      ? 'Aucun corps dynamique : les objets animés sont cinématiques — cochez « Corps rigide » sur un objet non animé'
      : 'Aucun objet avec la physique activée — cochez « Corps rigide » dans l\'inspector', 4500);
    return;
  }

  phys.world = new CANNON.World();
  phys.world.gravity.set(0, -9.82, 0);
  phys.world.solver.iterations = 10;

  const matGround = new CANNON.Material('ground');
  phys.matGround = matGround;   // bindBodyPhysics en a besoin bien après ce démarrage
  // AUCUN sol implicite. Un plan infini était posé ici à y=0 : un collider que rien n'affichait,
  // absent de la hiérarchie, impossible à sélectionner ou à supprimer — une scène « vide »
  // arrêtait quand même les objets. Un sol se pose maintenant comme tout le reste : un objet
  // avec un corps rigide, ou un Terrain. La grille n'est qu'un gizmo, elle n'arrête rien.

  // Les terrains sont toujours des sols statiques (pas besoin de cocher « body
  // rigide »). Porteurs lus au Registry, et pour la première fois la case
  // d'activation du composant Terrain compte : un Terrain DÉSACTIVÉ ne pose plus
  // de sol de collision. Avant, elle n'arrêtait que la sculpt — un terrain
  // décoché restait un sol invisible et infranchissable, sans aucun medium de le
  // deviner depuis l'inspecteur.
  Registry.activeNodes('Terrain').forEach(function(o){
    const fab = buildRigidBody(o, 0);
    phys.world.addBody(fab.body);
    phys.world.addContactMaterial(new CANNON.ContactMaterial(matGround, fab.material,
      {friction: 0.6, restitution: 0.1}));
  });

  // UN SEUL chemin de branchement, partagé avec api.create (miroir de js/game-runtime.js) : deux
  // copies de ces quinze lignes, c'est la garantie qu'un jour l'une recevra une correction et
  // pas l'autre.
  candidats.forEach(function(o){
    // instantané pour restauration à l'arrêt
    phys.snapshot.push({obj:o, pos:o.position.clone(), quat:o.quaternion.clone()});
    bindBodyPhysics(o);
  });

  animated.forEach(function(o){ bindBodyPhysics(o); });

  phys.active = true;
  // Passe par l'arbitre plutot que d'ecrire `tc.enabled` en direct : la lecture seule est un
  // SECOND proprietaire de ce booleen, et le dernier qui ecrivait gagnait — l'arret de la
  // simulation rallumait le gizmo d'une scene verrouillee par quelqu'un d'autre.
  setGizmoBlocked('physics', true);
  if(!inModeGame){
    if(btnSim){ btnSim.textContent = '■ Arrêter'; btnSim.classList.add('active'); }
    setStatus(candidats.length + ' body dynamique(s)'
      + (phys.kinematic.length ? ' + ' + phys.kinematic.length + ' obstacle(s) animé(s)' : '')
      + ' — « Arrêter » restaure les poses', 3500);
  }
}

export function stopSimulation(){
  phys.snapshot.forEach(function(s){
    s.obj.position.copy(s.pos);
    s.obj.quaternion.copy(s.quat);
  });
  phys.active = false;
  phys.world = null;
  phys.links = [];
  phys.kinematic = [];
  phys.snapshot = [];
  // Retire la raison « physique » seulement : si la lecture seule en a pose une, le gizmo
  // reste coupe et l'objet n'est pas re-arme.
  setGizmoBlocked('physics', false);
  if(btnSim){ btnSim.textContent = '⚙ Physique'; btnSim.classList.remove('active'); }
  syncInspector();
}

/** Bascule la simulation physique seule — menu Affichage (le bouton de la barre du haut a disparu). */
export function toggleSimulation(){
  if(phys.active) stopSimulation(); else startSimulation();
}
if(btnSim) btnSim.addEventListener('click', toggleSimulation);

// les corps cinématiques suivent la pose ACTUELLE des objets animés (timeline/scripts)
export function syncKinematic(){
  phys.kinematic.forEach(function(l){
    l.obj.getWorldPosition(_wp);
    l.obj.getWorldQuaternion(_wq);
    l.body.position.set(_wp.x, _wp.y, _wp.z);
    l.body.quaternion.set(_wq.x, _wq.y, _wq.z, _wq.w);
  });
}

export const _qParent = new THREE.Quaternion();
export function syncPhysics(){
  phys.links.forEach(function(l){
    _wq.set(l.body.quaternion.x, l.body.quaternion.y, l.body.quaternion.z, l.body.quaternion.w);
    // origine de l'objet = position du corps - décalage tourné
    _vA.copy(l.offset).applyQuaternion(_wq);
    _wp.set(l.body.position.x - _vA.x, l.body.position.y - _vA.y, l.body.position.z - _vA.z);
    if(l.obj.parent === scene){
      l.obj.position.copy(_wp);
      l.obj.quaternion.copy(_wq);
    } else {
      l.obj.position.copy(l.obj.parent.worldToLocal(_wp.clone()));
      l.obj.parent.getWorldQuaternion(_qParent);
      l.obj.quaternion.copy(_qParent.invert().multiply(_wq));
    }
  });
  if(selection && phys.links.some(l => l.obj === selection)) syncInspectorThrottled();
}


// EXPOSÉ EN GLOBALE, à dessein. Ces symboles sont appelés depuis des fichiers
// que les mêmes pages ne chargent pas toutes : un `import` y pointerait un
// fichier absent, et la page ne démarrerait pas. Ils gardent donc leur garde
// `typeof` côté appelant, et se déclarent ici.
globalThis._qParent = _qParent;
globalThis._wp = _wp;
globalThis.objectAnimated = objectAnimated;
globalThis.phys = phys;
globalThis.syncKinematic = syncKinematic;
globalThis.syncPhysics = syncPhysics;