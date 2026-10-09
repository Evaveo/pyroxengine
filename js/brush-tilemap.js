// ---------- Le pinceau de tuiles ----------
//
// Sans lui, une map de tuiles ne se remplit que par une commande du copilote ou par un tableau
// d'entiers dans un fichier. C'est-à-dire que l'éditeur savait TOUT faire d'un jeu 2D sauf en
// dessiner le décor à la main — et dessiner le décor est à peu près tout le travail.
//
// Le calcul est ailleurs et il est PUR : `cellSubPoint` (l'inverse exact du placement des tuiles),
// `strokeTilemap` (les cases entre deux positions de mouse), `setRectTilemap`. Ici ne vivent que
// les gestes et l'aperçu. Ce partage n'est pas cosmétique : l'inversion grille↔monde est la seule
// chose qui peut dériver d'une demi-case, et une dérive d'une demi-case ne se voit pas — on peint
// la rangée du dessus en croyant que la grille est décalée.

import { assets } from './assets.js';
import { liftOverlay } from './editor-overlay.js';
import { paletteOfTilemap, rebuildTilemap } from './components/component-tilemap.js';
import { setStatus } from './hierarchy.js';
import { pushHistory } from './history.js';
import { buildInspector } from './inspector.js';
import { escapeHtml, objects, palette } from './objects.js';
import { LAYER_HELPERS, renderer, scene } from './scene.js';
import { selection } from './selection.js';
import { pointOnPlaneFrom } from './view-gizmo.js';

export const brush2d = {
  tool: 'none',        // 'none' | 'paint' | 'erase' | 'rect' | 'pick'
  material: 1,           // index de matériau, 1..n — 0 est le vide
  _last: null,       // dernière case touchée, pour relier le trait
  _anchor: null,          // premier coin du rectangle en cours
  _dirty: false,          // une reconstruction est à faire
  _frame: null,          // le cadre d'aperçu sous le curseur
  _node: null           // le nœud dont on a construit le cadre
};

/**
 * La map visée : la sélection, son ascendance, ou l'unique map de la scène.
 *
 * Remonter l'ascendance est ce qui rend l'outil utilisable : après un coup de pinceau on sélectionne
 * souvent la maille interne ou un enfant, et exiger la sélection exacte du nœud porteur donnerait un
 * pinceau qui « ne marche plus » sans dire pourquoi. L'unique map en dernier recours parce que
 * c'est le cas le plus fréquent : un niveau, une map.
 */
export function nodeTilemapActive(){
  let n = (typeof selection !== 'undefined') ? selection : null;
  while(n){
    if(n.getComponent && n.getComponent('Tilemap')) return n;
    n = n.parent;
  }
  const cartes = objects
    .filter(function(o){ return o.getComponent && o.getComponent('Tilemap'); });
  return (cartes.length === 1) ? cartes[0] : null;
}

/** La case de la map sous la souris, ou `null` hors de la grille. */
export function cellSubMouse2d(e, node){
  const c = node.getComponent('Tilemap');
  const p = pointOnPlaneFrom(e);
  // La map est posée sur son nœud : le point passe en coordonnées LOCALES avant l'inversion.
  // La position MONDIALE et pas `node.position` : un nœud parent déplacé décalerait sinon tout
  // le pinceau d'autant.
  const w = node.getWorldPosition(new THREE.Vector3());
  // L'inverse de `projectCell`, et pas une projection XY en dur : une tilemap posée à plat au
  // sol (`xz`) se peindrait sinon dans le plan de l'écran, à côté de son propre décor.
  const g = cellFromWorld(c.plane || 'xy',
    {x: p.x - w.x - (c.originX || 0), y: p.y - w.y - (c.originY || 0), z: (p.z || 0) - w.z},
    c.cellSize);
  if(g.x < 0 || g.y < 0 || g.x >= c.width || g.y >= c.height) return null;
  return g;
}

/** Reconstruit la map au plus tard à la prochaine image — jamais deux fois pour un même geste. */
export function markMapDirty2d(node){
  brush2d._dirty = true;
  if(brush2d._InPending) return;
  brush2d._InPending = true;
  requestAnimationFrame(function(){
    brush2d._InPending = false;
    if(!brush2d._dirty) return;
    brush2d._dirty = false;
    rebuildTilemap(node);
    if(selection === node) buildInspector();
  });
}

/** La valeur que l'outil current pose. */
export function valueBrush2d(){
  return (brush2d.tool === 'erase') ? 0 : Math.max(1, brush2d.material | 0);
}

/**
 * Un coup de pinceau sur une case, en reliant à la précédente.
 *
 * Le trait n'est pas un luxe : une souris ne livre pas toutes les positions par lesquelles elle
 * pass, elle en saute trois ou quatre à vitesse normale. Peindre seulement les cases reçues laisse
 * un pointillé, et on en conclut que le pinceau rate.
 */
export function shotOfBrush2d(node, cell){
  const c = node.getComponent('Tilemap');
  const v = valueBrush2d();
  let n = 0;
  const d = brush2d._last;
  const cases = d ? strokeTilemap(d.x, d.y, cell.x, cell.y) : [cell];
  cases.forEach(function(k){ if(setCellTilemap(c, k.x, k.y, v)) n++; });
  brush2d._last = cell;
  if(n) markMapDirty2d(node);
  return n;
}

/** Le cadre d'aperçu : la case (ou le rectangle) que le prochain clic touchera. */
export function updateFrameBrush2d(node, cell){
  if(brush2d._frame && brush2d._node !== node){
    scene.remove(brush2d._frame);
    brush2d._frame.geometry.dispose();
    brush2d._frame = null;
  }
  if(!cell || brush2d.tool === 'none'){
    if(brush2d._frame) brush2d._frame.visible = false;
    return;
  }
  const c = node.getComponent('Tilemap');
  // `cellSize`/`originX`/`originY` : les noms du composant. Ce cadre lisait encore `c.tile` et
  // `c.origineX` d'avant la migration en anglais — il valait 0,5 u quelle que soit la map et
  // ignorait son origine, donc il n'encadrait pas la case réellement peinte.
  const t = Number(c.cellSize) || 0.5;
  const a = brush2d._anchor;
  const x0 = a ? Math.min(a.x, cell.x) : cell.x, x1 = a ? Math.max(a.x, cell.x) : cell.x;
  const y0 = a ? Math.min(a.y, cell.y) : cell.y, y1 = a ? Math.max(a.y, cell.y) : cell.y;
  const ox = Number(c.originX) || 0, oy = Number(c.originY) || 0;
  const gx = ox + x0 * t, gX = ox + (x1 + 1) * t;
  const gy = oy - (y1 + 1) * t, gY = oy - y0 * t;
  const pts = [gx,gy,0, gX,gy,0,  gX,gy,0, gX,gY,0,  gX,gY,0, gx,gY,0,  gx,gY,0, gx,gy,0];
  if(!brush2d._frame){
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const m = new THREE.LineBasicMaterial({color: 0x6fd3ff});
    const l = new THREE.LineSegments(g, m);
    l.userData.interne = true;
    l.raycast = function(){};
    liftOverlay(l, 1);
    l.layers.set(LAYER_HELPERS);           // une aide d'édition : aucune caméra de jeu ne la voit
    scene.add(l);
    brush2d._frame = l;
    brush2d._node = node;
  } else {
    brush2d._frame.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    brush2d._frame.geometry.attributes.position.needsUpdate = true;
    brush2d._frame.geometry.computeBoundingSphere();
  }
  // Le cadre suit le nœud : c'est lui qui porte la map.
  const w = node.getWorldPosition(new THREE.Vector3());
  brush2d._frame.position.set(w.x, w.y, w.z + 0.01);
  brush2d._frame.material.color.setHex(brush2d.tool === 'erase' ? 0xff8a6f : 0x6fd3ff);
  brush2d._frame.visible = true;
}

export function hideFrameBrush2d(){
  if(brush2d._frame) brush2d._frame.visible = false;
}

/** Choisit l'outil. `'none'` rend les gestes à la sélection et au gizmo. */
export function chooseTool2d(name){
  brush2d.tool = (brush2d.tool === name) ? 'none' : name;
  brush2d._anchor = null;
  brush2d._last = null;
  if(brush2d.tool === 'none') hideFrameBrush2d();
  if(typeof updateBarTilemap === 'function') updateBarTilemap();
  if(typeof setStatus === 'function'){
    const m = {
      paint: 'Pinceau : cliquez-glissez pour poser des tuiles. Le voisinage est recalculé tout seul.',
      erase: 'Gomme : cliquez-glissez pour effacer.',
      rect: 'Rectangle : cliquez un coin, relâchez sur l\'autre.',
      pick: 'Prélever : cliquez une case pour reprendre sa tuile.',
      no: 'Outil rangé — le clic sélectionne à nouveau.'
    };
    setStatus(m[brush2d.tool] || '', 4000);
  }
  return brush2d.tool;
}

/**
 * Les gestes du pinceau, en phase de CAPTURE.
 *
 * En capture et avec `stopPropagation` : sans ça le clic sélectionne un objet et arme le gizmo, et
 * le premier glissement déplacerait la map au lieu de la paint. Les écouteurs de la vue 3D
 * restent intacts — c'est ce qui permet de ne rien casser du côté 3D.
 */
export function bindBrush2d(){
  const el = renderer.domElement;
  if(!el) return;
  let peint = false;

  // Plus d'onglet 2D : c'est l'OUTIL ARMÉ qui décide, et lui seul. Un pinceau armé mange les
  // clics de sélection, donc `chooseTool2d('none')` reste le moyen de le ranger.
  const active = () => brush2d.tool !== 'none';

  el.addEventListener('mousedown', function(e){
    if(!active() || e.button !== 0) return;
    const n = nodeTilemapActive();
    if(!n){
      setStatus('Aucune map de tuiles : créez-en une (menu de création) '
        + 'ou sélectionnez-la.', 5000);
      return;
    }
    const cell = cellSubMouse2d(e, n);
    if(!cell) return;              // hors de la grille : on laisse le clic à la sélection
    e.preventDefault(); e.stopPropagation();

    if(brush2d.tool === 'pick'){
      const v = n.getComponent('Tilemap').cellAt(cell.x, cell.y);
      if(v > 0){
        brush2d.material = v;
        if(typeof updateBarTilemap === 'function') updateBarTilemap();
        setStatus('Tuile ' + v + ' prélevée', 2000);
      } else {
        setStatus('Case vide : rien à prélever', 2000);
      }
      return;
    }
    // UN SEUL point d'historique par geste, pas un par case : sinon undo un trait de cinquante
    // tuiles demanderait cinquante annulations.
    pushHistory();
    if(brush2d.tool === 'rect'){ brush2d._anchor = cell; return; }
    peint = true;
    brush2d._last = null;
    shotOfBrush2d(n, cell);
  }, true);

  el.addEventListener('mousemove', function(e){
    if(!active()){ hideFrameBrush2d(); return; }
    const n = nodeTilemapActive();
    if(!n) return;
    const cell = cellSubMouse2d(e, n);
    updateFrameBrush2d(n, cell);
    if(!peint || !cell) return;
    e.preventDefault(); e.stopPropagation();
    shotOfBrush2d(n, cell);
  }, true);

  window.addEventListener('mouseup', function(e){
    if(!active()){ peint = false; brush2d._anchor = null; return; }
    const n = nodeTilemapActive();
    if(n && brush2d._anchor){
      const cell = cellSubMouse2d(e, n);
      if(cell){
        const a = brush2d._anchor;
        const posees = setRectTilemap(n.getComponent('Tilemap'), a.x, a.y, cell.x, cell.y,
                                       valueBrush2d());
        if(posees) markMapDirty2d(n);
        setStatus(posees + ' case(s) posée(s)', 2000);
      }
    }
    peint = false;
    brush2d._anchor = null;
    brush2d._last = null;
  }, true);

  // La molette zoome déjà ; on quitte l'outil par Échap, comme partout ailleurs.
  window.addEventListener('keydown', function(e){
    if(e.key === 'Escape' && brush2d.tool !== 'none'){ chooseTool2d('none'); }
  });
}


// ---------- La barre du pinceau ----------
//
// Elle vivait dans `view-2d.js` avec l'onglet 2D, et portait AUSSI les boutons de création.
// L'onglet a disparu (un seul monde) : la création passe par `createFromCreatable`, et il ne
// reste ici que les outils du pinceau et le choix du matériau.

/** L'état de la barre : visible dès qu'il y a une map à peindre, outil courant en évidence. */
export function updateBarTilemap(){
  const b = document.getElementById('bar-tilemap');
  if(!b) return;
  const n = (typeof nodeTilemapActive === 'function') ? nodeTilemapActive() : null;
  // CONTEXTUELLE : la barre n'a de sens que devant une map de tuiles. Toujours visible, elle
  // occuperait le viewport d'un projet 3D avec des outils qui n'y peignent rien.
  b.style.display = n ? 'flex' : 'none';
  // La fenêtre Palette montre le même outil et la même tuile : elle suit (js/palette-ui.js).
  if(typeof globalThis.refreshPaletteSelection === 'function') globalThis.refreshPaletteSelection();
  b.querySelectorAll('[data-tool2d]').forEach(function(x){
    x.classList.toggle('active', typeof brush2d !== 'undefined' && brush2d.tool === x.dataset.tool2d);
  });
  const sel = document.getElementById('brush-mat');
  if(!sel) return;
  // La liste des matériaux vient de la map visée : proposer « matériau 3 » quand la map n'en a
  // que deux ferait peindre un index sans planche, donc des cases invisibles — ce qui se lit
  // comme un pinceau qui ne peint pas.
  // Les tuiles viennent de la PALETTE, qui est un asset partagé : deux décors peuvent la
  // partager, et changer une planche se fait une fois pour tout le niveau.
  const map = n ? n.getComponent('Tilemap') : null;
  const palette = map ? paletteOfTilemap(map) : null;
  const mats = (palette && palette.tiles) || [];
  // Le NOM DE LA TUILE d'abord : depuis qu'une planche découpée donne une tuile par image,
  // plusieurs tuiles partagent la même planche, et son nom seul les rendrait indiscernables.
  const labelOf = function(m, i){
    if(m && m.name) return m.name;
    const a = (m && m.spriteId && typeof assets !== 'undefined')
      ? assets.find(function(x){ return x.id === m.spriteId; }) : null;
    return a ? a.name : 'tuile ' + (i + 1);
  };
  const veut = mats.map(function(m, i){ return (i + 1) + '|' + labelOf(m, i); }).join('~');
  if(sel.dataset.state === veut){
    if(typeof brush2d !== 'undefined') sel.value = String(Math.min(brush2d.material, Math.max(1, mats.length)));
    return;
  }
  sel.dataset.state = veut;
  sel.innerHTML = mats.length
    ? mats.map(function(m, i){
        return '<option value="' + (i + 1) + '">' + (i + 1) + ' · ' + escapeHtml(labelOf(m, i)) + '</option>';
      }).join('')
    : '<option value="1">— aucun matériau —</option>';
  if(typeof brush2d !== 'undefined') sel.value = String(Math.min(brush2d.material, Math.max(1, mats.length)));
}

/** Branche la barre du pinceau. Un seul écouteur délégué : elle est refaite à chaque bascule. */
export function bindBarTilemap(){
  const b = document.getElementById('bar-tilemap');
  if(!b) return;
  b.addEventListener('click', function(e){
    const o = e.target.closest('[data-tool2d]');
    if(o && typeof chooseTool2d === 'function'){ chooseTool2d(o.dataset.tool2d); return; }
  });
  const sel = document.getElementById('brush-mat');
  if(sel){
    sel.addEventListener('change', function(){
      if(typeof brush2d !== 'undefined') brush2d.material = Math.max(1, parseInt(sel.value, 10) || 1);
      if(typeof globalThis.refreshPaletteSelection === 'function') globalThis.refreshPaletteSelection();
    });
  }
  updateBarTilemap();
}
