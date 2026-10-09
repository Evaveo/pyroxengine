// ---------- Le brouillard de guerre : FogOfWar (la carte) + Vision (qui voit, qui est vu) ----------
//
// Né d'un jeu de stratégie (2026-09-29) dont le brouillard était une grille tenue par le script
// du jeu et peinte dans un canevas : rien ne se réglait dans l'éditeur, et le moteur 3D ne savait
// rien de ce qui devait être caché. Ici tout est composant, sérialisé, partagé par l'éditeur et
// le jeu publié :
//
//   · FogOfWar, posé sur un objet (le terrain, un groupe « Carte ») : la grille (origine, taille
//     de case, colonnes × lignes), l'ÉQUIPE qui regarde et ses alliés, les couleurs. Il pose
//     au-dessus du sol une surface sombre, un simple enfant three — jamais sérialisé.
//   · Vision, posé sur tout ce qui voit OU peut être caché : un rayon (en mètres), une équipe,
//     et `remember` — un bâtiment ou une ressource aperçus restent affichés sous le brouillard,
//     comme dans Age of Empires. Rayon 0 : l'objet ne voit rien mais reste caché tant qu'il n'est
//     pas en vue (arbre, mine, bâtiment ennemi).
//
// Le système (js/systems/fog-system.js) ne tourne qu'EN JEU : en édition, la surface est masquée et rien n'est caché — on
// ne construit pas un niveau dans le noir. Changer d'équipe (joueur en réseau) ou tout dévoiler
// (fin de partie) se fait depuis un script : `fog.team = 2`, `fog.revealAll = true`.
import { Registry } from '../component-registry.js';
import { Component, detachData, mergeIntoBag } from '../component.js';
import { FOG_EXPLORED, FOG_VISIBLE, createFogGrid, fogBeginUpdate, fogCellIndex, fogReveal, fogRevealAll, fogToRGBA } from '../fog-grid.js';

export const FOG_DEFAULT = {origin: [0, 0], cellSize: 1, cols: 96, rows: 96, team: 1, allies: [],
  height: 0.08, color: '#000000', exploredOpacity: 0.55, updateInterval: 0.2, revealAll: false};
export const VISION_DEFAULT = {radius: 6, team: 0, remember: false};

function rgbOf(h){
  const s = String(h || '').replace('#', '');
  const n = /^[0-9a-fA-F]{6}$/.test(s) ? parseInt(s, 16) : 0;
  return [n >> 16 & 255, n >> 8 & 255, n & 255];
}

export class FogOfWar extends Component {
  constructor(node, opts){ super(node); this.data = opts || {}; }

  get team(){ return this.data.team; }
  set team(v){ this.data.team = v | 0; this._timer = 0; }
  get revealAll(){ return !!this.data.revealAll; }
  set revealAll(v){ this.data.revealAll = !!v; this._timer = 0; }

  onAdd(){
    const bag = this.node.userData.fogOfWar = this.node.userData.fogOfWar || JSON.parse(JSON.stringify(FOG_DEFAULT));
    this.data = mergeIntoBag(bag, this.data);
    this.reset();
  }
  onRemove(){ this.disposeOverlay(); delete this.node.userData.fogOfWar; }
  hydrate(d){ if(d) Object.keys(d).forEach((k) => { this.data[k] = d[k]; }); this.reset(); }
  serialize(){ return detachData(this.data); }

  /** Repart d'une carte inconnue (lancement, grille changée). */
  reset(){
    this.grid = createFogGrid(this.data.cols, this.data.rows);
    this._timer = 0;
    this.disposeOverlay();
  }

  /** Les équipes dont la vision compte pour le joueur : la sienne et ses alliés. */
  friendly(team){ return team === (this.data.team | 0) || (this.data.allies || []).indexOf(team) !== -1; }

  /** L'état (0 inconnu, 1 exploré, 2 vu) au point du monde (x, z). */
  stateAt(x, z){
    const i = fogCellIndex(this.grid, x, z, this.data.origin, this.data.cellSize);
    return i < 0 ? 0 : this.grid.state[i];
  }

  /** La surface sombre, créée au premier affichage. Enfant three brut : non sérialisé. */
  ensureOverlay(){
    if(this.overlay) return this.overlay;
    const g = this.grid, cs = this.data.cellSize, w = g.cols * cs, h = g.rows * cs;
    this.pixels = new Uint8Array(g.cols * g.rows * 4);
    const tex = new THREE.DataTexture(this.pixels, g.cols, g.rows, THREE.RGBAFormat);
    // LINÉAIRE : les bords de la vision s'estompent sur une case au lieu de marcher en escalier.
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter;
    const mat = new THREE.MeshBasicMaterial({map: tex, transparent: true, depthWrite: false});
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    // Le plan three est vertical (XY) : couché sur XZ, la ligne 0 de la texture côté z minimal.
    mesh.rotation.x = Math.PI / 2;
    mesh.name = 'FogOfWar (surface)';
    mesh.renderOrder = 900;
    this.texture = tex;
    this.overlay = mesh;
    this.placeOverlay();
    this.node.add(mesh);
    return mesh;
  }

  /** Place la surface dans le repère du monde, quel que soit le parent qui porte le composant. */
  placeOverlay(){
    const o = this.overlay, g = this.grid, cs = this.data.cellSize;
    if(!o) return;
    const cx = this.data.origin[0] + g.cols * cs / 2, cz = this.data.origin[1] + g.rows * cs / 2;
    this.node.updateMatrixWorld(true);
    const inv = this.node.matrixWorld.clone().invert();
    o.position.set(cx, this.data.height, cz).applyMatrix4(inv);
  }

  disposeOverlay(){
    if(!this.overlay) return;
    this.node.remove(this.overlay);
    this.overlay.geometry.dispose(); this.overlay.material.dispose(); this.texture.dispose();
    this.overlay = null; this.texture = null;
  }

  /** Une mise à jour : la grille, puis ce qui est caché, puis la surface. */
  update(visions){
    const g = this.grid, d = this.data, cs = d.cellSize;
    if(d.revealAll) fogRevealAll(g);
    else {
      fogBeginUpdate(g);
      visions.forEach((v) => {
        // Masqué par quelqu'un d'autre que le brouillard (dans un bâtiment, désactivé) : ne voit rien.
        if(!shown(v.node) && !v.node.userData.fogHidden) return;
        if(!this.friendly(v.team) || !(v.radius > 0)) return;
        const p = v.node.getWorldPosition(_p);
        fogReveal(g, Math.floor((p.x - d.origin[0]) / cs), Math.floor((p.z - d.origin[1]) / cs), v.radius / cs);
      });
    }
    visions.forEach((v) => {
      if(this.friendly(v.team)){ setFogHidden(v.node, false); return; }
      const p = v.node.getWorldPosition(_p);
      const st = this.stateAt(p.x, p.z);
      if(st === FOG_VISIBLE) v.seen = true;
      setFogHidden(v.node, !(st === FOG_VISIBLE || (v.remember && v.seen && st === FOG_EXPLORED)));
    });
    this.ensureOverlay().visible = true;
    fogToRGBA(g, this.pixels, rgbOf(d.color), d.exploredOpacity);
    this.texture.needsUpdate = true;
  }

  static get typeName(){ return 'FogOfWar'; }
  static get icon(){ return Icons.html('eye-slash') + ' '; }
  static get description(){ return 'Brouillard de guerre : ce que l\'équipe du joueur voit, a vu, ignore'; }
  static get category(){ return 'Gameplay'; }
}

export class Vision extends Component {
  constructor(node, opts){ super(node); this.data = opts || {}; }
  get radius(){ return Number(this.data.radius) || 0; }
  set radius(v){ this.data.radius = Number(v) || 0; }
  get team(){ return this.data.team | 0; }
  set team(v){ this.data.team = v | 0; }
  get remember(){ return !!this.data.remember; }
  set remember(v){ this.data.remember = !!v; }
  onAdd(){
    const bag = this.node.userData.vision = this.node.userData.vision || Object.assign({}, VISION_DEFAULT);
    this.data = mergeIntoBag(bag, this.data);
  }
  onRemove(){ setFogHidden(this.node, false); delete this.node.userData.vision; }
  hydrate(d){ if(d) Object.keys(d).forEach((k) => { this.data[k] = d[k]; }); }
  serialize(){ return detachData(this.data); }
  static get typeName(){ return 'Vision'; }
  static get icon(){ return Icons.html('eye') + ' '; }
  static get description(){ return 'Voit (rayon) et peut être caché par le brouillard de guerre'; }
  static get category(){ return 'Gameplay'; }
}

const _p = new THREE.Vector3();

// Le brouillard CACHE sans toucher à l'intention de l'auteur : `fogHidden` retient que c'est lui
// qui a masqué l'objet, pour ne rendre visible que ce qu'il a lui-même caché.
//
// PAR setVisibleIntent (js/render-perf.js) : une forêt, ce sont des centaines d'arbres identiques que
// le moteur REGROUPE en lots — écrire `visible` sur un objet regroupé ne cache rien, c'est le lot qui
// le dessine. Sans le module (harnais de test), `visible` suffit : rien n'y est regroupé.
function shown(node){ return typeof visibleIntent === 'function' ? visibleIntent(node) : node.visible !== false; }
function show(node, v){ if(typeof setVisibleIntent === 'function') setVisibleIntent(node, v); else node.visible = v; }
export function setFogHidden(node, hidden){
  if(hidden){
    if(node.userData.fogHidden || !shown(node)) return;   // déjà masqué, par lui ou par un autre
    node.userData.fogHidden = true; show(node, false);
  } else if(node.userData.fogHidden){
    node.userData.fogHidden = false; show(node, true);
  }
}

Registry.registerClass(FogOfWar);
Registry.registerClass(Vision);
