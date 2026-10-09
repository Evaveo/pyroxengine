// ---------- Hiérarchie (arbre + glisser-déposer) ----------
import { updateTimeline } from './animation.js';
import { applyTexture, assetInDrag, assets, attachDocumentUIAsset, attachScriptAsset, attachSheetStyleAsset, instantiateAsset } from './assets.js';
import { attachAudioAsset } from './audio.js';
import { ed, isPlayableAudio } from './component-data.js';
import { iconOf } from './hierarchy-icon.js';
import { pushHistory } from './history.js';
import { buildInspector, syncInspector } from './inspector.js';
import { attachMaterialAsset } from './materials.js';
import { escapeHtml, isSceneObject, itemsCreationContext, markAllLayersDirty, objectOfSceneById, objects, openMenuContext } from './objects.js';
import { refitShadows, scene } from './scene.js';
import { select, selection, selectionMulti, toggleMulti } from './selection.js';
import { field } from './shader-graph-editor.js';
import { Icons } from './ui/icon.js';

export const hierBody = document.getElementById('hier-body');
export let dragId = null;

// `iconOf` vit dans js/hierarchy-icon.js : elle interroge les composants du nœud au lieu
// du switch fermé qui vivait ici.
export const hierFilter = document.getElementById('hier-filter');
hierFilter.addEventListener('input', function(){ updateHierarchy(); });

/**
 * Combien d'objets de SCÈNE un nœud cache, à tous les niveaux.
 *
 * Récursive et non `children.length` : plier « Collectibles » cache aussi les enfants de ses
 * enfants, et annoncer « 3 » sur un groupe qui en contient trente serait pire que ne rien
 * annoncer. `isSceneObject` écarte ce qui n'appartient pas à la scène (aides de l'éditeur,
 * gizmos), sans quoi le compte affiché ne correspondrait à rien de ce qu'on voit en dépliant.
 */
export function countSceneChildren(node){
  let n = 0;
  node.children.forEach(function(child){
    if(!isSceneObject(child)) return;
    n += 1 + countSceneChildren(child);
  });
  return n;
}

export function updateHierarchy(){
  // LE FILET DES CALQUES. La resynchronisation du bit `Object3D.layers` ne se fait plus par
  // balayage de la scène à chaque image (voir markLayersDirty, js/objects.js) : elle suit une
  // liste de nœuds marqués. `addSceneObject` marque le nœud qui entre, mais pas la descendance
  // qui lui est AJOUTÉE ensuite — les maillages internes d'un modèle importé, le contenu d'une
  // sous-scène, une instance de prefab. Or tout changement de STRUCTURE repeint la hiérarchie,
  // et ce sont exactement les mêmes moments : on redemande donc une passe complète ici.
  //
  // Une passe complète par changement de structure, au lieu d'une par image : le coût disparaît
  // sans que rater un cas puisse produire un nœud rendu par une caméra qui devrait l'ignorer.
  if(typeof markAllLayersDirty === 'function') markAllLayersDirty();

  const filter = (hierFilter.value || '').trim().toLowerCase();
  if(!objects.length){
    hierBody.innerHTML = '<div class="none">scène vide</div>';
    return;
  }
  let html = '';
  (function marcher(parent, prof){
    parent.children.forEach(function(enfant){
      if(!isSceneObject(enfant)) return;
      const correspond = !filter || enfant.name.toLowerCase().indexOf(filter) !== -1;
      const aEnfants = enfant.children.some(function(c){ return isSceneObject(c); });
      const plie = !filter && !!ed(enfant).plie;   // le filtre déplie tout
      if(correspond){
        // Une instance de modèle et ses nœuds se reconnaissent à leur couleur, comme l'instance
        // d'un prefab dans Unity : ce qu'on y voit vient du fichier.
        const modelNode = enfant.userData.modelNode !== undefined;
        const modelRoot = !modelNode && !!(enfant.getComponent && enfant.getComponent('Model'));
        const cls = 'node' + (enfant === selection ? ' sel' : '')
                  + (selectionMulti.indexOf(enfant) !== -1 ? ' multi' : '')
                  + (visibleIntent(enfant) ? '' : ' hidden')
                  + (modelNode ? ' model-node' : '') + (modelRoot ? ' model-root' : '');
        // `--depth` porte la profondeur au CSS, qui en tire l'indentation ET les rails
        // verticaux (panels.css). L'arbre est une liste PLATE — un nœud profond n'est pas
        // imbriqué dans son parent —, donc les rails ne peuvent pas être des `border-left`
        // hérités : ils sont dessinés par un dégradé répété dont la largeur vient d'ici.
        html += '<div class="'+cls+'" draggable="true" data-id="'+enfant.id+'" style="--depth:'+prof+'">'
              + '<span class="fold'+(aEnfants ? '' : ' empty')+'" title="Plier / déplier">'
              + Icons.html(plie ? 'caret-right' : 'caret-down')+'</span>'
              + iconOf(enfant)
              + '<span class="node-name">'+escapeHtml(enfant.name)+'</span>'
              // Ce qu'on vient de cacher en pliant. Sans ce compte, plier un groupe le rend
              // indiscernable d'une feuille : le chevron dit qu'il y a « quelque chose »,
              // jamais combien, et on déplie pour le savoir.
              + (plie && aEnfants
                  ? '<span class="node-count">' + countSceneChildren(enfant) + '</span>' : '')
              // `visibleIntent` : un objet regroupe dans un lot d'instances porte
              // `visible = false` pour que le lot le dessine. L'oeil doit montrer ce que la
              // personne a demande, pas ce que le rendu en fait — sinon regrouper le decor
              // barrerait tous les yeux du panneau d'un coup.
              + '<span class="eye'+(visibleIntent(enfant) ? '' : ' off')+'" title="Afficher / masquer">'
              + Icons.html(visibleIntent(enfant) ? 'eye' : 'eye-slash')+'</span>'
              + '</div>';
      }
      if(!plie || !correspond) marcher(enfant, prof + (correspond ? 1 : 0));
    });
  })(scene, 0);
  hierBody.innerHTML = html || '<div class="none">aucun objet ne correspond au filtre</div>';
  // La hiérarchie se redessine à chaque ajout, suppression, reparentage et chargement de
  // scène — c'est-à-dire exactement quand les bornes de la scène changent. Recadrer l'ombre
  // ici évite un drapeau « à recalculer » qu'il faudrait poser à six endroits, et dont le
  // septième appelant serait oublié.
  if(typeof refitShadows === 'function') refitShadows();
}

export function objFromNode(el){
  const node = el && el.closest ? el.closest('.node') : null;
  if(!node) return null;
  return objectOfSceneById(parseInt(node.dataset.id, 10));
}

hierBody.addEventListener('click', function(e){
  const obj = objFromNode(e.target);
  if(!obj) return;
  // 'empty' (objet sans enfant, rien à plier/déplier) : ne PAS retourner ici — la plupart
  // des objets de scène sont des feuilles, et le clic sur cette icône (juste avant le nom)
  // ne sélectionnait donc jamais rien, en silence. Seul un vrai fold/défold doit court-circuiter
  // la sélection.
  // `closest` et non `classList.contains` : depuis que le chevron et l'œil sont des icônes
  // Phosphor, le clic atterrit sur le `<i>` INTÉRIEUR au `<span class="fold">`, dont la liste
  // de classes est `ph ph-caret-down`. Tester la cible elle-même faisait donc tomber le clic
  // dans la branche « sélectionner » — plier/déplier et masquer cessaient de répondre, sans
  // rien casser de visible : on croyait à un arbre qui ne se plie plus.
  const fold = e.target.closest ? e.target.closest('.fold') : null;
  if(fold && !fold.classList.contains('empty')){
    ed(obj).plie = !ed(obj).plie;
    updateHierarchy();
    return;
  }
  if(e.target.closest && e.target.closest('.eye')){
    pushHistory();
    // On BASCULE L'INTENTION. Sur un objet regroupe, ecrire `visible` ne ferait rien de
    // visible (le lot continue de le dessiner) et se perdrait a la reconstruction suivante.
    setVisibleIntent(obj, !visibleIntent(obj));
    if(typeof markBatchingDirty === 'function') markBatchingDirty();
    updateHierarchy();
    return;
  }
  if(e.ctrlKey || e.metaKey) toggleMulti(obj);
  else select(obj);
});

// double-clic sur le nom : renommage en place
hierBody.addEventListener('dblclick', function(e){
  // Même raison qu'au clic simple : la cible peut être l'icône, pas le `<span>` qui la porte.
  if(e.target.closest && (e.target.closest('.fold') || e.target.closest('.eye'))) return;
  const node = e.target.closest ? e.target.closest('.node') : null;
  const obj = objFromNode(e.target);
  if(!node || !obj || node.querySelector('input')) return;
  // Le nom d'un nœud de modèle est son ADRESSE : celle de ses overrides, et celle par laquelle
  // un clip retrouve un os. Le renommer casserait l'animation sans un mot.
  if(obj.userData.modelNode !== undefined){
    setStatus('Un nœud de modèle importé garde le nom du fichier : c\'est par lui que les '
      + 'animations le retrouvent', 4000);
    return;
  }
  const nameEl = node.querySelector('.node-name');
  if(!nameEl) return;
  node.draggable = false;
  const field = document.createElement('input');
  field.type = 'text';
  field.value = obj.name;
  field.spellcheck = false;
  nameEl.replaceWith(field);
  field.focus();
  field.select();
  function validate(){
    const v = field.value.trim();
    if(v && v !== obj.name){
      pushHistory();
      obj.name = v;
      if(obj === selection) syncInspector();
    }
    updateHierarchy();
    updateTimeline();
  }
  field.addEventListener('blur', validate);
  field.addEventListener('keydown', function(ev){
    ev.stopPropagation();
    if(ev.key === 'Enter') field.blur();
    if(ev.key === 'Escape'){
      field.removeEventListener('blur', validate);
      updateHierarchy();
    }
  });
});

hierBody.addEventListener('contextmenu', function(e){
  e.preventDefault();
  const target = objFromNode(e.target);
  const items = itemsCreationContext(function(nouvelObj){
    if(target) target.attach(nouvelObj);
    updateHierarchy();
  });
  const title = target ? ('Ajouter un enfant de ' + target.name) : 'Ajouter';
  openMenuContext(e.clientX, e.clientY, [{label: title, header: true}, {sep:true}].concat(items));
});

hierBody.addEventListener('dragstart', function(e){
  const obj = objFromNode(e.target);
  if(!obj){ e.preventDefault(); return; }
  dragId = obj.id;
  e.dataTransfer.effectAllowed = 'move';
  // marque de type supplémentaire : permet au panneau Projet (assets.js) de
  // reconnaître un drag venant de la hiérarchie et d'en faire un prefab au drop,
  // sans interférer avec le drop de réordonnancement déjà géré dans hierBody
  e.dataTransfer.setData('text/scene-object', String(obj.id));
});

hierBody.addEventListener('dragover', function(e){
  const types = e.dataTransfer ? Array.from(e.dataTransfer.types) : [];
  if(types.indexOf('text/asset') !== -1){
    // tout genre d'asset se dépose sur un nœud de la hiérarchie (voir drop ci-dessous
    // pour ce que chaque genre y déclenche)
    if(!assetInDrag) return;
    e.preventDefault();
    hierBody.querySelectorAll('.hover').forEach(function(n){ n.classList.remove('hover'); });
    const node = e.target.closest ? e.target.closest('.node') : null;
    if(node) node.classList.add('hover');
    return;
  }
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  hierBody.querySelectorAll('.hover').forEach(n => n.classList.remove('hover'));
  hierBody.classList.remove('hover-root');
  const node = e.target.closest ? e.target.closest('.node') : null;
  if(node) node.classList.add('hover');
  else hierBody.classList.add('hover-root');
});

hierBody.addEventListener('dragleave', function(e){
  if(e.target === hierBody) hierBody.classList.remove('hover-root');
});

hierBody.addEventListener('drop', function(e){
  e.preventDefault();
  hierBody.querySelectorAll('.hover').forEach(n => n.classList.remove('hover'));
  hierBody.classList.remove('hover-root');
  // dépôt d'un asset du panneau Projet sur un nœud (ou en racine de la hiérarchie)
  const aid = e.dataTransfer ? e.dataTransfer.getData('text/asset') : '';
  if(aid){
    const asset = assets.find(function(a){ return a.id === aid; });
    if(!asset) return;
    const target = objFromNode(e.target);
    if(asset.kind === 'script') attachScriptAsset(asset, target);
    else if(asset.kind === 'material') attachMaterialAsset(asset, target);
    else if(asset.kind === 'documentUI') attachDocumentUIAsset(asset, target);
    else if(asset.kind === 'sheetStyle') attachSheetStyleAsset(asset, target);
    else if(isPlayableAudio(asset)) attachAudioAsset(asset, target);
    else if(asset.kind === 'texture'){
      if(target && target.isMesh) applyTexture(asset, target);
      else setStatus('Déposez la texture sur un objet de la hiérarchie', 3000);
    }
    else if(asset.kind === 'prefab' || asset.kind === 'model'){
      const copie = instantiateAsset(asset, null);
      if(copie && target) target.attach(copie);
      updateHierarchy();
    }
    return;
  }
  const traine = objectOfSceneById(dragId);
  dragId = null;
  if(!traine) return;
  // Comme Unity : on ne restructure pas une instance de modèle (« Cannot restructure Prefab
  // instance »). Y DÉPOSER un objet — une arme sous la main — reste permis.
  if(traine.userData.modelNode !== undefined){
    setStatus('Un nœud de modèle importé ne se déplace pas dans la hiérarchie : il vient du '
      + 'fichier. On peut en revanche y accrocher un objet.', 5000);
    return;
  }
  const target = objFromNode(e.target);
  // Aucune parenté interdite entre 2D et 3D : un seul monde depuis v0.91.0.
  if(!target){
    if(traine.parent !== scene) scene.attach(traine);
  } else {
    if(target === traine) return;
    if(isDescendant(target, traine)){ setStatus('Impossible : la cible est un descendant de l\'objet déplacé', 2500); return; }
    pushHistory();
    target.attach(traine);
  }
  buildInspector();
  updateHierarchy();
});

hierBody.addEventListener('dragend', function(){
  hierBody.querySelectorAll('.hover').forEach(n => n.classList.remove('hover'));
  hierBody.classList.remove('hover-root');
  dragId = null;
});

export function isDescendant(candidat, root){
  let ok = false;
  root.traverse(function(o){ if(o === candidat) ok = true; });
  return ok;
}


// ---------- Statut ----------
export const status = document.getElementById('status');
export let statusTimer = null;
export function setStatus(txt, duration){
  clearTimeout(statusTimer);
  if(txt){
    status.textContent = txt; status.style.display = 'block';
    if(duration) statusTimer = setTimeout(() => status.style.display = 'none', duration);
  } else status.style.display = 'none';
}


// EXPOSÉ EN GLOBALE, à dessein. Ces symboles sont appelés depuis des fichiers
// que les mêmes pages ne chargent pas toutes : un `import` y pointerait un
// fichier absent, et la page ne démarrerait pas. Ils gardent donc leur garde
// `typeof` côté appelant, et se déclarent ici.
globalThis.setStatus = setStatus;
globalThis.status = status;