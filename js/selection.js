// ---------- Sélection ----------
import { clipAutoForSelection, updateTimeline } from './animation.js';
import { updateProject } from './assets.js';
import { updateBarTilemap } from './brush-tilemap.js';
import { updateColliderViz } from './collider.js';
import { ed } from './component-data.js';
import { isDescendant, setStatus, updateHierarchy } from './hierarchy.js';
import { buildInspector } from './inspector.js';
import { applyMaskCamera, listMats } from './objects.js';
import { phys } from './physics.js';
import { updatePostVolumeViz } from './post-volume-viz.js';
import { updateBoxProbeViz } from './probes.js';
import { activeCam, gizmoAttach, previewCam, setPreviewCam } from './scene.js';
import { boneSelected, setBoneSelected } from './skeleton.js';
import { animBody } from './viewport.js';

export let selection = null;
// sélection multiple : `selection` reste l'objet principal (gizmo, inspecteur),
// `selectionMulti` contient les objets secondaires ajoutés par Ctrl+clic.
export const selectionMulti = [];

// Écriture BRUTE de `selection`, SANS les effets de bord de `select()` (highlight, gizmo,
// inspecteur) — pour un TEARDOWN (restauration d'historique, vidage de scène) où les objets
// visés sont déjà détachés/disposés : leur passer par `select()` tenterait de les surligner.
export function setSelectionRaw(v){ selection = v; }

// Asset du panneau Projet sélectionné (tile cliquée). Exclusif avec `selection` :
// l'inspecteur montre soit un objet de la scène, soit les paramètres d'import d'un
// asset (voir import-settings.js).
export let assetSelected = null;

export function selectAsset(a){
  // Des paramètres d'import saisis mais pas appliqués retiennent la sélection le temps d'une
  // question (enregistrer / abandonner / annuler). La garde vit dans js/import-settings.js —
  // ce fichier-ci ne doit pas en dépendre, le cycle serait réel.
  if(typeof guardImportDirty === 'function'
     && !guardImportDirty(a, function(){ selectAsset(a); })) return;
  if(a && selection) select(null);   // vide déjà assetSelected
  assetSelected = a || null;
  buildInspector();
  updateProject();
}

export function allSelection(){
  return selection ? [selection].concat(selectionMulti) : selectionMulti.slice();
}

export function clearMulti(){
  selectionMulti.forEach(function(o){ setHighlight(o, false); });
  selectionMulti.length = 0;
}

export function toggleMulti(obj){
  if(!obj) return;
  if(!selection){ select(obj); return; }
  if(obj === selection){
    // unregister le principal : le premier secondaire le remplace
    const next = selectionMulti.shift() || null;
    select(next, true);
    return;
  }
  const i = selectionMulti.indexOf(obj);
  if(i !== -1){
    setHighlight(obj, false);
    selectionMulti.splice(i, 1);
  } else {
    // pas de multi-sélection imbriquée (parent + son propre enfant)
    const group = allSelection();
    if(group.some(function(g){ return isDescendant(obj, g) || isDescendant(g, obj); })){
      setStatus('Impossible : cet objet est parent ou enfant d\'un objet déjà sélectionné', 3000);
      return;
    }
    selectionMulti.push(obj);
    setHighlight(obj, true);
  }
  updateHierarchy();
  setStatus(allSelection().length + ' objet(s) sélectionné(s)', 2000);
}

// Ajoute plusieurs objets à la sélection en une seule fois (rubber band). Filtre les
// ancestor/descendant AVANT de toucher la sélection ou le DOM, puis ne reconstruit la
// hiérarchie qu'une fois — évite le O(n²) et le spam de messages de toggleMulti
// appelé objet par objet sur une grosse sélection.
export function addMultiInBatch(list){
  if(!list.length) return;
  const groupActuel = allSelection();
  const rejetes = [];
  const retenus = [];
  list.forEach(function(obj){
    const dejaPresent = groupActuel.indexOf(obj) !== -1 || retenus.indexOf(obj) !== -1;
    if(dejaPresent) return;
    const conflit = groupActuel.concat(retenus).some(function(g){
      return isDescendant(obj, g) || isDescendant(g, obj);
    });
    if(conflit) rejetes.push(obj);
    else retenus.push(obj);
  });
  if(!selection && retenus.length){
    selection = retenus.shift();
    setHighlight(selection, true);
  }
  retenus.forEach(function(o){
    selectionMulti.push(o);
    setHighlight(o, true);
  });
  updateHierarchy();
  if(rejetes.length){
    setStatus(retenus.length + ' objet(s) ajouté(s), ' + rejetes.length
      + ' ignoré(s) (parent/enfant d\'un objet déjà sélectionné)', 3000);
  } else if(retenus.length){
    setStatus(allSelection().length + ' objet(s) sélectionné(s)', 2000);
  }
}

export function setHighlight(obj, active){
  if(!obj) return;
  // SURLIGNER UN OBJET REGROUPÉ NE SE VOIT PAS : le lot d'instances le dessine avec SON
  // matériau, pas celui de l'objet, et l'émissif écrit plus bas partirait dans un matériau que
  // personne ne regarde. On le sort donc de son lot le temps qu'il soit surligné — une
  // instance éteinte, un appel de dessin de plus, aucune reconstruction. La remise dans le lot
  // est faite par js/editor-batching.js, qui tient le registre des détachés : la faire ici
  // rallumerait l'instance de l'objet SÉLECTIONNÉ dès qu'on survole autre chose.
  if(active && typeof detachFromBatch === 'function') detachFromBatch(obj, true);
  if(obj.getComponent && obj.getComponent('Model')){
    if(active){
      ed(obj)._emisSauve = [];
      obj.traverse(function(m){
        if(!m.isMesh) return;
        listMats(m).forEach(function(mat){
          if(mat.emissive){
            ed(obj)._emisSauve.push([mat, mat.emissive.getHex()]);
            mat.emissive.setHex(0x3a2a08);
          }
        });
      });
    } else {
      (ed(obj)._emisSauve || []).forEach(function(p){ p[0].emissive.setHex(p[1]); });
      ed(obj)._emisSauve = null;
    }
  }
  else if(obj.material && obj.material.emissive){
    obj.material.emissive.setHex(active
      ? (obj.userData.emissiveSel !== undefined ? obj.userData.emissiveSel : 0x3a2a08)
      : (obj.userData.emissiveBase || 0));
  }
}

export function select(obj, keepMulti){
  // Même garde que selectAsset, mais seulement quand on va VERS un objet : un `select(null)` de
  // teardown (vidage de scène, restauration d'historique) ne doit jamais ouvrir de modale.
  if(obj && assetSelected && typeof guardImportDirty === 'function'
     && !guardImportDirty(null, function(){ select(obj, keepMulti); })) return;
  // Changer d'objet abandonne l'os en cours d'édition : garder l'os d'un modèle qu'on ne
  // regarde plus donnerait une timeline qui pose des clés sur une cible invisible, et un
  // gizmo attaché à un squelette hors écran.
  if(typeof boneSelected !== 'undefined' && boneSelected && obj !== selection){
    setBoneSelected(null);
  }
  // sélectionner dans la scène (ou clear la sélection) libère la tile du panneau Projet
  if(assetSelected){
    assetSelected = null;
    updateProject();
  }
  if(!keepMulti) clearMulti();
  else if(obj){
    const im = selectionMulti.indexOf(obj);
    if(im !== -1) selectionMulti.splice(im, 1);
  }
  if(selection) setHighlight(selection, false);
  selection = obj;
  if(selection) setHighlight(selection, true);
  if(selection && !phys.active) gizmoAttach(selection); else gizmoAttach(null);
  // Un personnage sélectionné montre son animation dans la timeline, sans qu'on ait à la
  // demander. `clipAutoForSelection` rafraîchit la timeline lui-même — d'où le `else`, qui
  // évite de la reconstruire deux fois à chaque clic dans la hiérarchie.
  if(typeof clipAutoForSelection === 'function') clipAutoForSelection(selection);
  else if(animBody.style.display !== 'none') updateTimeline();
  setPreviewCam((selection && selection.userData.type === 'camera' && activeCam !== ed(selection).cam)
    ? ed(selection).cam : null);
  if(previewCam) applyMaskCamera(selection, previewCam);
  document.getElementById('preview-frame').style.display = previewCam ? 'block' : 'none';
  if(previewCam) document.getElementById('preview-name').textContent = selection.name;
  buildInspector();
  updateColliderViz();
  updatePostVolumeViz();
  updateBoxProbeViz();
  // La liste des matériaux du pinceau suit la map SÉLECTIONNÉE : proposer les matériaux d'une
  // autre map ferait paint un index sans planche, donc des cases invisibles — qu'on lirait
  // comme un pinceau qui ne peint pas.
  updateBarTilemap();
  updateHierarchy();
}


// EXPOSÉ EN GLOBALE, à dessein. Ces symboles sont appelés depuis des fichiers
// que les mêmes pages ne chargent pas toutes : un `import` y pointerait un
// fichier absent, et la page ne démarrerait pas. Ils gardent donc leur garde
// `typeof` côté appelant, et se déclarent ici.
globalThis.selectAsset = selectAsset;
globalThis.selection = selection;