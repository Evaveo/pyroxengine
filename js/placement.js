// ---------- Placement pro (P1-5) ----------
// Poser au sol (avec ou sans alignement à la normale), aligner / distribuer
// la multi-sélection, duplication en série (ligne / cercle), paint de
// prefabs au clic dans le viewport. Menu Objet + button 🖌 des tuiles prefab.

// ----- poser au sol -----
import { assets, updateProject } from './assets.js';
import { registerInputs } from './editor-input.js';
import { setStatus, updateHierarchy } from './hierarchy.js';
import { pushHistory } from './history.js';
import { syncInspector } from './inspector.js';
import { cloneCleanly, objects, reenableSubTree } from './objects.js';
import { applyFilters, scene, viewEl } from './scene.js';
import { allSelection, select, selection, selectionMulti, setHighlight } from './selection.js';
import { stopSculpt } from './terrain.js';
import { closeModal, openModal } from './ui.js';
import { camCurrent, coordsMouse, mode, mouse, raycaster } from './viewport.js';

export const _plRay = new THREE.Raycaster();
export const _plBox = new THREE.Box3();

export function setAtGround(alignNormal){
  const group = allSelection();
  if(!group.length){ setStatus('Sélectionnez d\'abord un objet', 2500); return; }
  pushHistory();
  // le Raycaster ne rafraîchit pas les matrices : un objet déplacé
  // dans la même image serait raycasté à son ancienne position
  scene.updateMatrixWorld(true);
  group.forEach(function(o){
    scene.updateMatrixWorld(true);   // l'objet précédent a pu bouger (pile d'objets)
    const origine = o.getWorldPosition(new THREE.Vector3());
    _plBox.setFromObject(o);
    const halfHeight = origine.y - _plBox.min.y;   // distance pivot → bottom de l'objet
    // rayon vers le bas depuis bien au-dessus de l'objet, en ignorant son propre sous-arbre
    _plRay.set(new THREE.Vector3(origine.x, _plBox.max.y + 50, origine.z), new THREE.Vector3(0, -1, 0));
    const exclus = new Set();
    o.traverse(function(x){ exclus.add(x); });
    const targets = objects.filter(function(x){ return !exclus.has(x); });
    const hits = _plRay.intersectObjects(targets, true)
      .filter(function(h){ return h.point.y <= _plBox.min.y + 0.001 || h.point.y < origine.y; });
    let y = 0, normal = new THREE.Vector3(0, 1, 0);
    if(hits.length){
      y = hits[0].point.y;
      if(hits[0].face){
        normal.copy(hits[0].face.normal)
          .transformDirection(hits[0].object.matrixWorld)
          .normalize();
        if(normal.y < 0) normal.negate();
      }
    }
    // position (dans le repère du parent)
    const targetWorld = new THREE.Vector3(origine.x, y + halfHeight, origine.z);
    if(o.parent && o.parent !== scene) o.position.copy(o.parent.worldToLocal(targetWorld));
    else o.position.copy(targetWorld);
    if(alignNormal){
      const lacet = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), o.rotation.y);
      const align = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
      o.quaternion.copy(align).multiply(lacet);
    }
  });
  if(selection) syncInspector();
  setStatus(group.length + ' objet(s) posé(s) au sol' + (alignNormal ? ' (alignés à la normale)' : ''), 2500);
}

// ----- aligner / distribuer -----
export function alignSelection(axe, mode){
  const group = allSelection();
  if(group.length < 2){ setStatus('Aligner : sélectionnez au moins 2 objets (Ctrl+clic)', 3000); return; }
  pushHistory();
  const values = group.map(function(o){ return o.getWorldPosition(new THREE.Vector3())[axe]; });
  let ref;
  if(mode === 'min') ref = Math.min.apply(null, values);
  else if(mode === 'max') ref = Math.max.apply(null, values);
  else ref = values.reduce(function(a, b){ return a + b; }, 0) / values.length;
  group.forEach(function(o){
    const p = o.getWorldPosition(new THREE.Vector3());
    p[axe] = ref;
    if(o.parent && o.parent !== scene) o.position.copy(o.parent.worldToLocal(p));
    else o.position.copy(p);
  });
  if(selection) syncInspector();
  setStatus('Alignés sur ' + axe.toUpperCase() + ' (' + mode + ')', 2000);
}

export function distributeSelection(axe){
  const group = allSelection();
  if(group.length < 3){ setStatus('Distribuer : sélectionnez au moins 3 objets (Ctrl+clic)', 3000); return; }
  pushHistory();
  const tries = group.slice().sort(function(a, b){
    return a.getWorldPosition(new THREE.Vector3())[axe] - b.getWorldPosition(new THREE.Vector3())[axe];
  });
  const p0 = tries[0].getWorldPosition(new THREE.Vector3())[axe];
  const p1 = tries[tries.length - 1].getWorldPosition(new THREE.Vector3())[axe];
  tries.forEach(function(o, i){
    const p = o.getWorldPosition(new THREE.Vector3());
    p[axe] = p0 + (p1 - p0) * (i / (tries.length - 1));
    if(o.parent && o.parent !== scene) o.position.copy(o.parent.worldToLocal(p));
    else o.position.copy(p);
  });
  if(selection) syncInspector();
  setStatus('Distribués équitablement sur ' + axe.toUpperCase(), 2000);
}

export function modalAlignDistribute(){
  function row(title, prefixe){
    return '<tr><td>' + title + '</td>'
      + ['x', 'y', 'z'].map(function(a){
          return '<td><button class="btn-modal" data-al="' + prefixe + ':' + a + '">' + a.toUpperCase() + '</button></td>';
        }).join('') + '</tr>';
  }
  openModal('Aligner / distribuer la sélection',
    '<p style="margin-bottom:8px;color:var(--txt-dim)">Agit sur la multi-sélection '
    + '(Ctrl+clic). Aligner : 2 objets ou plus · Distribuer : 3 ou plus.</p>'
    + '<table style="text-align:center">'
    + row('Aligner (min)', 'min')
    + row('Aligner (centre)', 'center')
    + row('Aligner (max)', 'max')
    + row('Distribuer', 'dist')
    + '</table>');
  document.getElementById('modal-body').addEventListener('click', function(e){
    const d = e.target.dataset ? e.target.dataset.al : null;
    if(!d) return;
    const parts = d.split(':');
    if(parts[0] === 'dist') distributeSelection(parts[1]);
    else alignSelection(parts[1], parts[0]);
  });
}

// ----- duplication en série (ligne / cercle) -----
export function modalDuplicateSeries(){
  if(!selection){ setStatus('Sélectionnez d\'abord un objet', 2500); return; }
  openModal('Dupliquer en série — ' + selection.name,
    '<div class="field"><label>Copies</label><input type="number" id="ds-n" value="5" min="1" max="200" step="1"></div>'
    + '<div class="field"><label>Mode</label><select id="ds-mode">'
    + '<option value="ligne">Ligne (décalage par copie)</option>'
    + '<option value="cercle">Cercle (autour de la sélection)</option></select></div>'
    + '<div id="ds-line">'
    + '<div class="field"><label>Décalage</label><div class="vec3">'
    + '<input type="number" id="ds-dx" value="2" step="0.5">'
    + '<input type="number" id="ds-dy" value="0" step="0.5">'
    + '<input type="number" id="ds-dz" value="0" step="0.5"></div></div></div>'
    + '<div id="ds-circle" style="display:none">'
    + '<div class="field"><label>Rayon</label><input type="number" id="ds-radius" value="4" min="0.1" step="0.5"></div>'
    + '<div class="field"><label>Arc °</label><input type="number" id="ds-arc" value="360" min="10" max="360" step="10"></div>'
    + '<div class="field"><label>Orienter</label><input type="checkbox" id="ds-orient" checked '
    + 'title="Chaque copie tourne pour suivre le cercle"></div></div>'
    + '<div style="display:flex;gap:8px;margin-top:10px;justify-content:flex-end">'
    + '<button class="btn-modal" id="ds-cancel">Annuler</button>'
    + '<button class="btn-modal accent" id="ds-ok">Dupliquer</button></div>');
  document.getElementById('ds-mode').addEventListener('input', function(){
    const cercle = this.value === 'cercle';
    document.getElementById('ds-line').style.display = cercle ? 'none' : '';
    document.getElementById('ds-circle').style.display = cercle ? '' : 'none';
  });
  document.getElementById('ds-cancel').addEventListener('click', closeModal);
  document.getElementById('ds-ok').addEventListener('click', function(){
    const n = Math.max(1, Math.min(200, parseInt(document.getElementById('ds-n').value, 10) || 5));
    const mode = document.getElementById('ds-mode').value;
    pushHistory();
    const source = selection;
    const copies = [];
    for(let i = 1; i <= n; i++){
      const c = cloneCleanly(source);
      reenableSubTree(c);
      if(mode === 'ligne'){
        c.position.x += (parseFloat(document.getElementById('ds-dx').value) || 0) * i;
        c.position.y += (parseFloat(document.getElementById('ds-dy').value) || 0) * i;
        c.position.z += (parseFloat(document.getElementById('ds-dz').value) || 0) * i;
      } else {
        const radius = parseFloat(document.getElementById('ds-radius').value) || 4;
        const arc = THREE.MathUtils.degToRad(parseFloat(document.getElementById('ds-arc').value) || 360);
        const complet = Math.abs(arc - Math.PI * 2) < 1e-3;
        const a = complet ? (arc * i / (n + 1)) : (arc * i / Math.max(1, n));
        c.position.x = source.position.x + Math.cos(a) * radius;
        c.position.z = source.position.z + Math.sin(a) * radius;
        if(document.getElementById('ds-orient').checked) c.rotation.y = -a;
      }
      source.parent.add(c);
      copies.push(c);
    }
    closeModal();
    select(copies[0]);
    copies.slice(1).forEach(function(c){
      selectionMulti.push(c);
      setHighlight(c, true);
    });
    updateHierarchy();
    applyFilters();
    setStatus(n + ' copie(s) créée(s) en ' + (mode === 'ligne' ? 'ligne' : 'cercle'), 2500);
  });
}

// ----- paint de prefabs -----
export const modePaint = {asset: null};

export function togglePaint(asset){
  if(modePaint.asset === asset){ stopPaint(); return; }
  stopSculpt();
  modePaint.asset = asset;
  viewEl.classList.add('paint');
  setStatus('🖌 Peinture : cliquez dans la vue pour poser « ' + asset.name
    + ' » (rotation aléatoire) — Échap ou re-clic 🖌 pour quitter', 6000);
  updateProject();
}

export function stopPaint(){
  if(!modePaint.asset) return;
  modePaint.asset = null;
  viewEl.classList.remove('paint');
  setStatus('Peinture terminée', 1500);
  updateProject();
}

// ----- paint de prefabs : enregistrée dans le dispatcher d'entrées (priorité haute) -----
//
// DIFFÉRÉE POUR LA MÊME RAISON QUE `bindEditorInput`/`bindTerrainInputs` : `registerInputs` écrit
// dans `inputs`, un `const` de `editor-input.js`. Ce fichier est dans un cycle d'imports avec lui ;
// y appeler `registerInputs` au premier niveau ne tenait que par l'ordre de résolution des
// imports, pas par le graphe de modules. Appelée par `startup.js`.
export function bindPlacementInputs(){
  registerInputs({
  name: 'paint',
  priorite: 20,
  pointerdown: function(e){
    if(!modePaint.asset || e.button !== 0) return false;
    e.preventDefault();
    const asset = modePaint.asset;
    if(assets.indexOf(asset) === -1){ stopPaint(); return true; }
    coordsMouse(e);
    scene.updateMatrixWorld(true);
    raycaster.setFromCamera(mouse, camCurrent());
    const hits = raycaster.intersectObjects(objects, true);
    let pt;
    if(hits.length) pt = hits[0].point;
    else {
      const plan = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      pt = new THREE.Vector3();
      if(!raycaster.ray.intersectPlane(plan, pt)) return true;
    }
    pushHistory();
    const copie = asset.template.clone(true);
    reenableSubTree(copie);
    if(asset.kind === 'prefab') copie.userData.prefabId = asset.id;
    copie.position.set(pt.x, Math.max(0, pt.y), pt.z);
    copie.rotation.y = Math.random() * Math.PI * 2;
    scene.add(copie);
    updateHierarchy();
    applyFilters();
    return true;
  },
  escape: function(){
    if(!modePaint.asset) return false;
    stopPaint();
    return true;
  }
  });
}
