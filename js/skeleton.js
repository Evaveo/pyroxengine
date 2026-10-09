// ---------- Squelettes : voir le rig d'un modèle importé ----------
//
// Un personnage rigué (Mixamo, Blender, Maya…) arrive avec un squelette : une hiérarchie d'os
// qui déforment le maillage. Jusqu'ici le moteur le préservait correctement — `cloneModel`
// re-lie les squelettes à chaque instance, ce qui est le détail de justesse le plus vicieux du
// sujet — mais ne le MONTRAIT nulle part. On ne pouvait ni compter les os, ni vérifier qu'un
// import avait bien ramené son rig, ni lire les noms sur lesquels un clip s'adresse.
//
// LES OS SONT DES OBJETS DE SCÈNE depuis la v0.159, comme dans Unity (js/model-nodes.js).
// La décision d'avant — les garder hors de `objects` — venait de quatre façons de casser un
// rig : sérialiser, sélectionner, supprimer, déplacer. Chacune a désormais sa réponse : les
// nœuds d'un modèle ne sont jamais sérialisés pour eux-mêmes (seuls leurs écarts, sur la racine
// de l'instance), ils se sélectionnent et se déplacent au gizmo (ce sont des overrides), et ils
// ne se suppriment ni ne se renomment ni ne changent de parent (hierarchy.js, inspector.js).
//
// Ce fichier garde le VISUEL du squelette et la sélection d'os par la timeline (`selectBone`),
// qui reste le chemin des pistes d'os d'un clip.

import { updateTimeline } from './animation.js';
import { assets } from './assets.js';
import { ed } from './component-data.js';
import { liftOverlay } from './editor-overlay.js';
import { setStatus } from './hierarchy.js';
import { buildInspector } from './inspector.js';
import { escapeHtml, isSceneObject } from './objects.js';
import { LAYER_HELPERS, gizmoAttach, scene } from './scene.js';
import { selection } from './selection.js';
import { animBody } from './viewport.js';

export const visualsSkeleton = new Map();   // objet de projet -> THREE.SkeletonHelper

// L'os en cours d'édition, ou null. C'est une sélection SECONDAIRE, à côté de `selection` et
// non à sa place : des dizaines d'endroits du moteur supposent que `selection` appartient à
// `objects` — la hiérarchie, la sérialisation, la suppression, les composants. Y glisser un os
// aurait demandé de vérifier chacun d'eux, pour un gain nul : ce dont on a besoin, c'est que
// le gizmo et la timeline s'adressent à l'os, et ces deux-là suffisent à le dire.
export let boneSelected = null;
export function setBoneSelected(v){ boneSelected = v; }

// Le premier SkinnedMesh rencontré porte le squelette. Un modèle peut en avoir plusieurs
// (body + vêtements exportés séparément) : ils partagent alors le MÊME squelette, puisque
// c'est lui qui les déforme ensemble. On prend donc le premier sans chercher plus loin.
export function skeletonOf(o){
  let sq = null;
  if(o && o.traverse) o.traverse(function(x){ if(!sq && x.isSkinnedMesh && x.skeleton) sq = x.skeleton; });
  return sq;
}

export function isRigged(o){ return !!skeletonOf(o); }

// L'asset modèle dont `o` est une instance — même résolution que `Model.asset`
// (component-model.js), mais accessible ici sans dépendre du composant : l'Avatar se pose sur
// l'ASSET (partagé par toutes les instances), jamais sur un nœud de scène précis.
export function modelAssetOf(o){
  const id = o && o.userData && o.userData.assetId;
  if(!id || typeof assets === 'undefined') return null;
  return assets.find(function(a){ return a.id === id && a.kind === 'model'; }) || null;
}

// Les os d'un squelette forment une hiérarchie, mais `skeleton.bones` est une liste PLATE, dans
// l'ordre où l'exportateur les a écrits. On reconstruit l'arbre par les links de parenté, en ne
// gardant comme racine que les os dont le parent n'est pas lui-même un os du squelette — sinon
// un rig dont la racine est parentée à un nœud vide ne montrerait aucune racine du tout.
export function boneTree(sq){
  if(!sq || !sq.bones) return [];
  const dedans = new Set(sq.bones);
  const enfantsOf = new Map();
  const racines = [];
  sq.bones.forEach(function(b){
    if(b.parent && dedans.has(b.parent)){
      if(!enfantsOf.has(b.parent)) enfantsOf.set(b.parent, []);
      enfantsOf.get(b.parent).push(b);
    } else racines.push(b);
  });
  return racines.map(function node(b){
    return {os:b, enfants:(enfantsOf.get(b) || []).map(node)};
  });
}

// Mixamo préfixe tous ses os de `mixamorig:`. Le signaler n'est pas cosmétique : c'est
// précisément cette convention de nommage qui permettra de jouer le clip d'un export sur le
// personnage d'un autre, puisque les pistes d'un clip s'adressent aux nœuds PAR NOM.
export function conventionOfNaming(sq){
  if(!sq || !sq.bones || !sq.bones.length) return null;
  // LE SÉPARATEUR EST FACULTATIF, parce que three le mange.
  //
  // Dans le fichier, Mixamo écrit `mixamorig:Hips`. Le chargeur FBX de three assainit les
  // noms de nœuds et rend `mixamorigHips` — mesuré sur un export réel. Exiger le deux-points
  // faisait donc échouer la détection sur exactement les fichiers qu'elle aims, et le libellé
  // « Mixamo » ne s'affichait jamais.
  //
  // La parenthèse `(?=[:_A-Z])` évite de prendre pour un rig Mixamo tout nom commençant par
  // ces neuf lettres : il faut un séparateur, ou la majuscule qui ouvre le nom de l'os.
  const mixamo = sq.bones.filter(function(b){
    return /^mixamorig(?=[:_A-Z])/.test(b.name || '');
  }).length;
  if(mixamo > sq.bones.length / 2) return 'mixamo';
  return null;
}

// ---------- Le visuel ----------

// Sur LAYER_HELPERS, comme la grille et le gizmo : une caméra de jeu ne doit jamais le voir, et
// la cuisson de lightmaps ne doit jamais le paint dans l'atlas.
//
// `depthTest` désactivé : un squelette est INTÉRIEUR au maillage qu'il déforme. Testé en
// profondeur, il serait caché par la peau qu'il anime — donc invisible exactement quand on en a
// besoin, et personne ne comprendrait pourquoi la case ne fait rien.
export function ensureVisualSkeleton(o){
  if(visualsSkeleton.has(o)) return visualsSkeleton.get(o);
  const sq = skeletonOf(o);
  if(!sq) return null;
  const h = new THREE.SkeletonHelper(o);
  h.material.depthTest = false;
  h.material.depthWrite = false;
  h.material.transparent = true;
  liftOverlay(h);
  h.layers.set(LAYER_HELPERS);
  h.traverse(function(x){ x.layers.set(LAYER_HELPERS); });
  scene.add(h);
  visualsSkeleton.set(o, h);
  return h;
}

export function removeVisualSkeleton(o){
  const h = visualsSkeleton.get(o);
  if(!h) return;
  scene.remove(h);
  if(h.material && h.material.dispose) h.material.dispose();
  if(h.geometry && h.geometry.dispose) h.geometry.dispose();
  visualsSkeleton.delete(o);
}

export function toggleVisualSkeleton(o, active){
  if(active) ensureVisualSkeleton(o); else removeVisualSkeleton(o);
  ed(o).skeletonVisible = !!active;
}

// Un objet supprimé de la scène laisserait son visuel derrière lui — un squelette flottant que
// rien ne rattache plus à rien, et que personne ne saurait faire disparaître.
export function cleanVisualsSkeleton(){
  Array.from(visualsSkeleton.keys()).forEach(function(o){
    if(!isSceneObject(o)) removeVisualSkeleton(o);
  });
}

// ---------- La section d'inspecteur ----------

// ---------- Sélection d'un os ----------

// Le nom d'un os est son ADRESSE : c'est par lui qu'une piste d'animation le retrouvera après
// un rechargement de projet, et c'est par lui qu'un clip s'adresse à ses nœuds. Un os sans nom
// est donc inutilisable comme cible — mieux vaut refuser de le sélectionner que poser des clés
// qu'on ne saura jamais recharger.
export function selectBone(os){
  if(os && !os.name){
    setStatus('Cet os n\'a pas de nom : il ne peut pas être animé, une piste n\'aurait aucun '
      + 'medium de le retrouver au rechargement.', 6000);
    return;
  }
  boneSelected = os || null;
  // Le gizmo suit l'os quand il y en a un, et revient à l'objet quand on le désélectionne.
  gizmoAttach(boneSelected || selection);
  buildInspector();
  // La timeline surligne l'os visé : sans ce rafraîchissement, choisir un os dans l'arbre du
  // squelette laissait la ligne correspondante éteinte, et le link entre les deux panneaux —
  // sa seule raison d'être — ne se voyait que si autre chose redessinait la timeline.
  if(animBody.style.display !== 'none') updateTimeline();
}

// (Une fonction `oublierOsSiHorsSelection` a vécu ici sans jamais être appelée : la même
// logique était écrite en ligne dans `select` (js/selection.js), qui est le seul endroit
// où elle a un sens. Deux exemplaires d'une règle, dont un mort — retiré.)

export function boneByName(o, name){
  const sq = skeletonOf(o);
  if(!sq) return null;
  return sq.bones.find(function(b){ return b.name === name; }) || null;
}

export function linesBoneHtml(nodes, prof){
  let h = '';
  nodes.forEach(function(n){
    const name = n.os.name || '(sans nom)';
    const sel = (n.os === boneSelected) ? ' sel' : '';
    h += '<div class="sq-bone' + sel + '" data-bone="' + escapeHtml(name) + '" '
      + 'style="padding-left:' + (prof * 12) + 'px" title="' + escapeHtml(name)
      + ' — cliquer pour le prendre au gizmo et poser des clés dessus">'
      + (n.enfants.length ? '▾ ' : '· ') + escapeHtml(name) + '</div>'
      + linesBoneHtml(n.enfants, prof + 1);
  });
  return h;
}
