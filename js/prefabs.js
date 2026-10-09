// ---------- Prefabs liés : instances, application, réinitialisation, variantes ----------
// Une instance porte userData.prefabId → asset prefab source. « Appliquer » pousse
// l'état de l'instance dans le template et synchronise les autres instances de la
// scène courante. Les variantes sont des prefabs indépendants avec un champ `base`.
// v1 : apply sur un prefab de base ne cascade pas vers ses variantes.

import { updateTimeline } from './animation.js';
import { assetId, assets, nextAssetId, previewObject3D, updateProject } from './assets.js';
import { setStatus, updateHierarchy } from './hierarchy.js';
import { pushHistory } from './history.js';
import { buildInspector, deleteRoot } from './inspector.js';
import { cloneCleanly, isSceneObject, objects, reenableSubTree } from './objects.js';
import { applyFilters, gizmoAttach } from './scene.js';
import { select, selection } from './selection.js';
import { serializeTree } from './serialization.js';

export function assetPrefabOf(o){
  if(!o || !o.userData.prefabId) return null;
  return assets.find(function(a){
    return a.id === o.userData.prefabId && a.kind === 'prefab';
  }) || null;
}

// empreinte structurelle : sérialisation normalisée (sans ids, noms ni transform racine,
// flottants arrondis) — sert à détecter qu'une instance diverge de son template
export function fingerprintPrefab(root){
  const list = serializeTree(root);
  const idx = {};
  list.forEach(function(d, i){ idx[d.id] = i; });
  const copie = list.map(function(d, i){
    const c = JSON.parse(JSON.stringify(d));
    delete c.id;
    delete c.name;
    delete c.prefabId;
    // parent hors du sous-arbre (ex. instance enfant d'un autre objet) → racine
    c.parent = (d.parent === null || d.parent === undefined || idx[d.parent] === undefined)
      ? null : idx[d.parent];
    if(i === 0){ c.pos = [0, 0, 0]; c.quat = [0, 0, 0, 1]; c.ech = [1, 1, 1]; }
    return c;
  });
  return JSON.stringify(copie, function(k, v){
    return (typeof v === 'number') ? Math.round(v * 10000) / 10000 : v;
  });
}

export function instanceModified(o){
  const a = assetPrefabOf(o);
  return a ? (fingerprintPrefab(o) !== fingerprintPrefab(a.template)) : false;
}

// remplace une instance par un clone frais du template, en conservant sa transform racine
export function replaceByInstanceOf(inst, asset){
  const parent = inst.parent;
  const etaitSel = (inst === selection);
  const copie = asset.template.clone(true);
  reenableSubTree(copie);
  copie.userData.prefabId = asset.id;
  copie.position.copy(inst.position);
  copie.quaternion.copy(inst.quaternion);
  copie.scale.copy(inst.scale);
  if(etaitSel) gizmoAttach(null);
  deleteRoot(inst);
  parent.add(copie);
  if(etaitSel) select(copie);
  return copie;
}

export function resetInstance(){
  const a = assetPrefabOf(selection);
  if(!a) return;
  pushHistory();
  replaceByInstanceOf(selection, a);
  updateHierarchy();
  updateTimeline();
  applyFilters();
  setStatus('Instance réinitialisée depuis « ' + a.name + ' »', 2500);
}

// `target` : l'instance à pousser dans son prefab (défaut : la sélection de l'inspecteur).
// Le copilote/MCP l'appelle sans sélection — voir create_prefab.
export function applyAtPrefab(target){
  const source = target || selection;
  const a = assetPrefabOf(source);
  if(!a) return;
  pushHistory();
  const template = cloneCleanly(source);
  template.position.x = 0;
  template.position.z = 0;
  delete template.userData.prefabId;
  a.template = template;
  a.preview = previewObject3D(template);

  // synchronise les autres instances liées présentes dans la scène courante
  let n = 0;
  objects.filter(function(o){ return o !== source && o.userData.prefabId === a.id; })
    .forEach(function(o){
      if(!isSceneObject(o)) return;   // déjà remplacée via un parent
      replaceByInstanceOf(o, a);
      n++;
    });
  updateProject();
  updateHierarchy();
  updateTimeline();
  applyFilters();
  buildInspector();
  setStatus('Prefab « ' + a.name + ' » mis à jour'
    + (n ? ' — ' + n + ' autre(s) instance(s) synchronisée(s)' : ''), 3000);
}

export function renderInstanceUnique(){
  if(!selection || !selection.userData.prefabId) return;
  pushHistory();
  delete selection.userData.prefabId;
  buildInspector();
  setStatus('Instance détachée de son prefab (rendue unique)', 2500);
}

export function createVariantPrefab(){
  const a = assetPrefabOf(selection);
  if(!a) return;
  pushHistory();
  const template = cloneCleanly(selection);
  template.position.x = 0;
  template.position.z = 0;
  delete template.userData.prefabId;
  const nb = assets.filter(function(x){ return x.kind === 'prefab' && x.base === a.id; }).length + 1;
  const v = {id:'a'+(nextAssetId()), kind:'prefab', name:a.name + ' — variante ' + nb, base:a.id, folder:a.folder || '',
             preview:previewObject3D(template), template:template};
  assets.push(v);
  selection.userData.prefabId = v.id;
  updateProject();
  buildInspector();
  setStatus('Variante « ' + v.name + ' » créée — double-clic sur sa vignette pour la renommer', 3500);
}
