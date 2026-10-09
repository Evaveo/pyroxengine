// ---------- CameraFollow : le suivi borné, séparé de la projection ----------
//
// Le suivi vivait dans le sac `cam2d` de la caméra 2D, ce qui le rendait indisponible en 3D
// alors qu'il n'a rien de 2D : borner une caméra pour qu'elle ne montre pas le vide au-delà du
// décor vaut dans les deux cas.
import { ensureCameraFollow } from '../component-data.js';
import { Registry } from '../component-registry.js';
import { Component, detachData, mergeIntoBag } from '../component.js';

export class CameraFollow extends Component {
  constructor(node, opts){
    super(node);
    // LE SAC EST LA SEULE VÉRITÉ (docs/REVUE_2026-09-14.md point 10) : `this.data` référencera
    // `userData.cameraFollow` dès `onAdd`. Les accesseurs ci-dessous gardent `c.targetName`,
    // `c.xMin`… lisibles/écrivables tels quels — `step()` passe `this` directement à
    // `applyFollow()` (camera-framing.js), qui lit ces mêmes noms génériquement.
    //
    // Les NOMS DE CHAMPS sont ceux de `follow2d` / `clampedData2d` (camera-framing.js), repris
    // tels quels : les renommer en `minX/maxX` ferait retomber `clampedData2d(undefined)` sur
    // `false`, donc « axe libre », donc des bornes silencieusement ignorées.
    this.data = opts || {};
  }

  get targetName() { return this.data.targetName || ''; }
  set targetName(v) { this.data.targetName = v || ''; }
  get xMin() { return this.data.xMin; }
  set xMin(v) { this.data.xMin = v; }
  get xMax() { return this.data.xMax; }
  set xMax(v) { this.data.xMax = v; }
  get yMin() { return this.data.yMin; }
  set yMin(v) { this.data.yMin = v; }
  get yMax() { return this.data.yMax; }
  set yMax(v) { this.data.yMax = v; }
  // Le décalage vertical place le personnage un peu SOUS le centre : dans un platformer on
  // regarde vers le haut, pas vers ses pieds. Défaut mesuré, ne pas le perdre (CAM2D_DEFAULT).
  get topOfView() { return this.data.topOfView; }
  set topOfView(v) { this.data.topOfView = v; }
  // L'anti-frémissement : sans lui les bords des sprites scintillent au déplacement, un texel
  // tombant à cheval sur deux pixels écran.
  get snapPixel() { return this.data.snapPixel; }
  set snapPixel(v) { this.data.snapPixel = v; }

  onAdd(){
    this.data = mergeIntoBag(ensureCameraFollow(this.node), this.data);
  }

  onRemove(){
    delete this.node.userData.cameraFollow;
  }

  /**
   * Une image de suivi. `framing` porte `{heightView, widthView}` — les hauteurs/largeurs
   * PLEINES, pas des demies : `follow2d` (camera-framing.js) divise déjà par deux. Passer des
   * demies fausse le cadrage d'un facteur 2, sans erreur.
   *
   * Une paire de bornes ABSENTE laisse l'axe libre (voir applyFollow, camera-framing.js).
   */
  step(node, targetPos, framing){
    if(typeof applyFollow === 'function') return applyFollow(node, this, framing, targetPos);
    return false;
  }

  // `hydrate` : le SEUL point de relecture (contrat de component.js, règle 2). Ce composant
  // lisait ses champs dans le constructeur seulement, donc `applyComponents` ne pouvait pas le
  // relire sur une instance déjà posée — et `Camera` en pose une par la migration de `cam2d`.
  hydrate(d){
    if(!d) return;
    if(d.targetName !== undefined) this.targetName = d.targetName || '';
    if(d.xMin !== undefined) this.xMin = d.xMin;
    if(d.xMax !== undefined) this.xMax = d.xMax;
    if(d.yMin !== undefined) this.yMin = d.yMin;
    if(d.yMax !== undefined) this.yMax = d.yMax;
    if(d.topOfView !== undefined) this.topOfView = d.topOfView;
    if(d.snapPixel !== undefined) this.snapPixel = d.snapPixel;
  }

  // DÉTACHÉE : `this.data` EST `userData.cameraFollow` (contrat de component.js, règle 4).
  serialize(){
    return detachData(this.data);
  }

  static get typeName(){ return 'CameraFollow'; }
  static get icon(){ return Icons.html('video-camera') + ' '; }
  static get description(){ return 'Caméra qui suit un objet'; }
  static get category(){ return 'Gameplay'; }
}

Registry.registerClass(CameraFollow);
