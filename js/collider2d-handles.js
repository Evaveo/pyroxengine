// moteur/js/collider2d-handles.js
//
// Les poignées du Collider2D dans la vue Scène : on attrape un coin ou un milieu de côté du
// contour vert (js/collider.js) et on le tire, le côté opposé restant en place — le geste
// « Edit Collider » d'Unity. Sans elles, une zone de collision ne se réglait qu'en tapant des
// nombres dans l'inspecteur, sans voir où le personnage allait buter.
//
// Ctrl pendant le glisser : aimante au quart d'unité (une case de grille 2D = 1 unité).

import { dragHandle2d, handles2dPoints, updateColliderViz } from './collider.js';
import { registerInputs } from './editor-input.js';
import { setStatus } from './hierarchy.js';
import { pushHistory } from './history.js';
import { buildInspector } from './inspector.js';
import { renderer, tc } from './scene.js';
import { selection } from './selection.js';
import { camCurrent, coordsMouse, mouse, raycaster } from './viewport.js';

// Distance de saisie, en pixels écran.
const PICK_PX = 9;

const drag = {node: null, id: null, pushed: false};

function collider2dOfSelection(){
  if(!selection || !selection.userData || !selection.userData.collider2d) return null;
  const comp = selection.getComponent && selection.getComponent('Collider2D');
  if(!comp || comp.active === false) return null;
  return selection.userData.collider2d;
}

// La poignée sous le pointeur, ou null.
function handleUnder(e){
  const c = collider2dOfSelection();
  if(!c) return null;
  const rect = renderer.domElement.getBoundingClientRect();
  const cam = camCurrent();
  const base = selection.getWorldPosition(new THREE.Vector3());
  let best = null, bestD = PICK_PX;
  handles2dPoints(c).forEach(function(p){
    const v = new THREE.Vector3(base.x + p.x, base.y + p.y, base.z).project(cam);
    const sx = rect.left + (v.x + 1) / 2 * rect.width;
    const sy = rect.top + (1 - v.y) / 2 * rect.height;
    const d = Math.hypot(sx - e.clientX, sy - e.clientY);
    if(d < bestD){ bestD = d; best = p.id; }
  });
  return best;
}

// Le point visé, dans le plan du nœud, relatif à sa position monde.
function pointerLocal(e, node){
  coordsMouse(e);
  raycaster.setFromCamera(mouse, camCurrent());
  const base = node.getWorldPosition(new THREE.Vector3());
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -base.z);
  const hit = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
  if(!hit) return null;
  return {x: hit.x - base.x, y: hit.y - base.y};
}

const CURSORS = {l:'ew-resize', r:'ew-resize', t:'ns-resize', b:'ns-resize',
                 tl:'nwse-resize', br:'nwse-resize', tr:'nesw-resize', bl:'nesw-resize'};

// Appelée par startup.js (même raison que bindTerrainInputs : cycle d'imports via editor-input.js).
export function bindCollider2dHandles(){
  registerInputs({
    name: 'collider2d-handles',
    priorite: 25,
    pointerdown: function(e){
      if(e.button !== 0 || tc.dragging || tc.axis) return false;
      const id = handleUnder(e);
      if(!id) return false;
      e.preventDefault();
      drag.node = selection; drag.id = id; drag.pushed = false;
      renderer.domElement.setPointerCapture(e.pointerId);
      return true;
    },
    pointermove: function(e){
      if(!drag.node){
        // Survol : le curseur annonce la poignée, comme partout ailleurs.
        const id = (e.buttons === 0) ? handleUnder(e) : null;
        renderer.domElement.style.cursor = id ? CURSORS[id] : '';
        return false;
      }
      const p = pointerLocal(e, drag.node);
      if(!p) return true;
      if(e.ctrlKey){ p.x = Math.round(p.x * 4) / 4; p.y = Math.round(p.y * 4) / 4; }
      if(!drag.pushed){ pushHistory(); drag.pushed = true; }
      const c = drag.node.userData.collider2d;
      Object.assign(c, dragHandle2d(c, drag.id, p));
      updateColliderViz();
      setStatus('Collider 2D : ' + c.l + ' × ' + c.h + ' (décalage ' + c.dx + ', ' + c.dy + ')', 1500);
      return true;
    },
    pointerup: function(e){
      if(!drag.node) return false;
      if(renderer.domElement.hasPointerCapture(e.pointerId))
        renderer.domElement.releasePointerCapture(e.pointerId);
      const moved = drag.pushed;
      drag.node = null; drag.id = null; drag.pushed = false;
      if(moved) buildInspector();
      return true;
    }
  });
}
