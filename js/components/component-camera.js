// moteur/js/components/component-camera.js
//
// UNE caméra, deux projections. `Camera2D` était une classe séparée qui réimplémentait la
// construction, le masque de calques, le repère filaire et l'activation : quatre occasions de
// diverger, et elles avaient divergé — le redimensionnement de la fenêtre ne recadrait que
// l'une des deux, et une caméra 2D rechargée revenait en perspective.
//
// Le CALCUL de cadrage vit dans js/camera-framing.js : pur, sans three ni DOM, et partagé avec
// le jeu publié. Ce fichier-ci ne fait que le brancher sur une THREE.Camera.
import { ed, ensureCamera } from '../component-data.js';
import { Registry } from '../component-registry.js';
import { Component, detachData, mergeIntoBag } from '../component.js';

export class Camera extends Component {
  constructor(node, opts) {
    super(node);
    // LE SAC EST LA SEULE VÉRITÉ (docs/REVUE_2026-09-14.md point 10) : `this.data` référencera
    // `userData.camera` dès `onAdd` (PAS `userData.cam` : déjà pris par le miroir de la
    // THREE.Camera, `o.userData.cam = ed(o).cam` dans game-runtime.js). Les accesseurs
    // ci-dessous gardent `c.fov`, `c.mode`… lisibles/écrivables tels quels — `setCamera2d()`
    // (camera-framing.js) lit `cam.data` directement, elle est réécrite avec ce lot.
    //
    // Les réglages `mode`/`widthLevel`/`ratio`/`ppu`/`pixelPerfect` que `settingCam2d` attend ne
    // servent qu'en orthographique, mais ils vivent ICI : un second sac de réglages ailleurs,
    // c'est exactement ce qu'on supprime. `mode` et PAS `framingMode` : c'est le nom que lit
    // `settingCam2d`. Un champ mal nommé y retombe SILENCIEUSEMENT sur 'height'.
    this.data = opts || {};
  }

  get projection() { return this.data.projection; }
  set projection(v) { this.data.projection = v; }
  get fov() { return this.data.fov; }
  set fov(v) { this.data.fov = v; }
  get near() { return this.data.near; }
  set near(v) { this.data.near = v; }
  get far() { return this.data.far; }
  set far(v) { this.data.far = v; }
  get orthoSize() { return this.data.orthoSize; }
  set orthoSize(v) { this.data.orthoSize = v; }
  get pixelPerfect() { return !!this.data.pixelPerfect; }
  set pixelPerfect(v) { this.data.pixelPerfect = !!v; }
  get ppu() { return this.data.ppu; }
  set ppu(v) { this.data.ppu = v; }
  get mode() { return this.data.mode; }
  set mode(v) { this.data.mode = v; }
  get widthLevel() { return this.data.widthLevel; }
  set widthLevel(v) { this.data.widthLevel = v; }
  get ratio() { return this.data.ratio; }
  set ratio(v) { this.data.ratio = v; }
  get main() { return !!this.data.main; }
  set main(v) { this.data.main = !!v; }

  onAdd() {
    this.data = mergeIntoBag(ensureCamera(this.node), this.data);
    this.applyProjection();
    this.markType('camera');
  }

  /**
   * (Re)construit la caméra three pour la projection courante.
   *
   * LE point unique de bascule : tout code qui lit la caméra passe par `this.objectThree` ou
   * `ed(node).cam`, personne d'autre ne teste `isOrthographicCamera`.
   *
   * On REMPLACE la caméra au lieu de la reconfigurer : perspective et orthographique sont deux
   * classes three distinctes, et garder l'ancienne sous le nœud laisserait deux caméras dont
   * une invisible — celle que le mode Lecture pourrait très bien choisir.
   */
  applyProjection() {
    const o = this.node;
    const ancienne = ed(o).cam;
    if (ancienne) o.remove(ancienne);

    let cam;
    if (this.projection === 'orthographic') {
      const hauteur = this.orthoSize * 2;
      const f = frustum2d(hauteur, hauteur * (16 / 9));
      // `f.near` / `f.far` et PAS les nôtres : le frustum 2D accepte les deux côtés de z. Un
      // `near` positif — le réflexe venu de la 3D — mangerait tous les sprites que l'auteur
      // décale en arrière-plan pour ordonner ses calques.
      cam = new THREE.OrthographicCamera(f.left, f.right, f.top, f.bottom, f.near, f.far);
    } else {
      cam = new THREE.PerspectiveCamera(this.fov, 16 / 9, this.near, this.far);
    }
    // LA MÊME ROTATION POUR LES DEUX PROJECTIONS, et c'est un correctif. Le boîtier a son
    // objectif en +Z (`makeCamera`, js/objects.js) : le nœud pointe donc vers +Z, et c'est ce
    // que dessinent le repère filaire et le gizmo. Une THREE.Camera, elle, regarde vers son -Z.
    //
    // L'orthographique n'avait pas cette rotation, héritée de `Camera2D` : elle filmait donc à
    // l'envers de son propre boîtier. On cadrait d'un côté et le rendu montrait l'autre — et
    // rien ne pouvait le signaler, les deux étant justes séparément.
    //
    // Le cas 2D (des sprites autour de z = 0, une caméra posée en +Z) se règle en tournant le
    // NŒUD, pas la caméra : `faceCameraToPlane()` plus bas. Ce qui pointe et ce qui filme
    // restent alors d'accord, ce qui est la seule chose qu'on puisse vérifier à l'œil.
    cam.rotation.y = Math.PI;
    o.add(cam);
    ed(o).cam = cam;
    this.objectThree = cam;
    if (typeof applyMaskCamera === 'function') applyMaskCamera(o, cam);
    // Le repère filaire est construit DEPUIS le frustum : sans cette reconstruction il continue
    // de dessiner la pyramide de la projection précédente, et l'auteur cadre avec une forme qui
    // ne correspond pas à ce qui est rendu.
    if (typeof createHelperFor === 'function') createHelperFor(o);
  }

  onRemove() {
    const o = this.node;
    if (typeof activeCam !== 'undefined' && activeCam === this.objectThree
        && typeof quitViewCamera === 'function') quitViewCamera();
    if (this.objectThree) { o.remove(this.objectThree); ed(o).cam = null; }
    if (o.userData.type === 'camera') o.userData.type = 'group';
    delete o.userData.camera;
    if (typeof removeHelper === 'function') removeHelper(o);
  }

  // mémorisé sur userData (et pas seulement l'instance) : c'est ce que lisent la sérialisation
  // et le runtime autonome, qui ne passent pas par le Registry de composants
  onActiveChange(active) {
    this.node.userData.camActive = active;
  }

  // DÉTACHÉE : `this.data` EST `userData.camera` (contrat de component.js, règle 4).
  serialize() {
    return detachData(this.data);
  }

  hydrate(d) {
    if (d) {
      if (d.projection !== undefined) this.projection = d.projection;
      if (d.fov !== undefined) this.fov = d.fov;
      if (d.near !== undefined) this.near = d.near;
      if (d.far !== undefined) this.far = d.far;
      if (d.orthoSize !== undefined) this.orthoSize = d.orthoSize;
      if (d.pixelPerfect !== undefined) this.pixelPerfect = !!d.pixelPerfect;
      if (d.ppu !== undefined) this.ppu = d.ppu;
      if (d.mode !== undefined) this.mode = d.mode;
      if (d.widthLevel !== undefined) this.widthLevel = d.widthLevel;
      if (d.ratio !== undefined) this.ratio = d.ratio;
      if (d.main !== undefined) this.main = !!d.main;
      // Une caméra DÉJÀ construite par la fabrique doit suivre les valeurs relues : c'est tout
      // l'objet de la relecture, et la projection peut avoir changé de nature.
      if (ed(this.node).cam) this.applyProjection();
    }
    this.node.userData.camActive = this.active;
  }

  static get creatable(){
    return { label: 'Caméra', icon: '🎥 ', components: [{ type: 'Camera' }] };
  }

  static get typeName() { return 'Camera'; }
  static get description(){ return 'Point de vue'; }
  static get icon(){ return Icons.html('video-camera') + ' '; }
  static get category() { return 'Gameplay'; }
}

Registry.registerClass(Camera);

/**
 * Tourne le NŒUD d'une caméra pour qu'il regarde le plan XY, où vit un décor 2D.
 *
 * Une caméra pointe vers le +Z de son nœud (voir `applyProjection`). Un décor 2D est autour de
 * z = 0 et sa caméra se pose en z positif : sans cette demi-tour, elle filmerait le vide
 * derrière elle. C'est le NŒUD qu'on tourne, jamais la caméra three — sinon le boîtier et le
 * repère filaire montreraient l'inverse de ce qui est rendu, et l'auteur cadrerait à l'aveugle.
 */
export function faceCameraToPlane(node){
  if(!node) return null;
  node.rotation.set(0, Math.PI, 0);
  if(node.position.z === 0) node.position.z = 10;
  return node;
}

