// moteur/js/components/component-light.js
import { ed, ensureLight } from '../component-data.js';
import { Registry } from '../component-registry.js';
import { Component, detachData, mergeIntoBag } from '../component.js';

export class Light extends Component {
  constructor(node, opts) {
    super(node);
    // LE SAC EST LA SEULE VÉRITÉ (docs/REVUE_2026-09-14.md point 10) : `this.data` référencera
    // `userData.lum` dès `onAdd` (`mergeIntoBag`), comme Physics/Collider/… Les accesseurs
    // ci-dessous gardent `c.color`, `c.intensity`… lisibles/écrivables tels quels : ~10 sites
    // d'appel externes (panneau inspecteur, commande copilote, tests) les utilisent déjà, et
    // les faire pointer vers `this.data` évite de les retoucher un par un pour un renommage qui
    // ne change rien au fond du problème (la double écriture sac/composant).
    this.data = opts || {};
  }

  get subType() { return this.data.subType; }
  set subType(v) { this.data.subType = v; }
  get color() { return this.data.color; }
  set color(v) { this.data.color = v; }
  get intensity() { return this.data.intensity; }
  set intensity(v) { this.data.intensity = v; }
  get range() { return this.data.range; }
  set range(v) { this.data.range = v; }
  get angle() { return this.data.angle; }
  set angle(v) { this.data.angle = v; }
  get penumbra() { return this.data.penumbra; }
  set penumbra(v) { this.data.penumbra = v; }
  // OMBRE D'UNE DIRECTIONNELLE (v0.189.0, champs facultatifs) : résolution de la carte, demi-largeur
  // de la boîte d'ombre, biais de profondeur. Absents = réglages automatiques (ShadowFit.lightSettings).
  get shadowMapSize() { return this.data.shadowMapSize; }
  set shadowMapSize(v) { this.data.shadowMapSize = v; }
  get shadowExtent() { return this.data.shadowExtent; }
  set shadowExtent(v) { this.data.shadowExtent = v; }
  get shadowBias() { return this.data.shadowBias; }
  set shadowBias(v) { this.data.shadowBias = v; }

  /**
   * Branche le sac sur la lumière three : le recadrage par image (updateShadows / rtUpdateShadows)
   * lit `light.userData.shadowSettings`. Une RÉFÉRENCE au sac, pas une copie : un réglage changé
   * plus tard est vu à l'image suivante sans rien rappeler.
   */
  applyShadowSettings() {
    const lum = ed(this.node).light;
    if (lum && lum.isDirectionalLight) lum.userData.shadowSettings = this.data;
  }

  onAdd() {
    this.data = mergeIntoBag(ensureLight(this.node), this.data);
    const o = this.node;
    let lum = ed(o).light;
    // Ajouté via +Component sur un Noeud qui n'a pas déjà de lumière THREE.*
    // (ex: objet Vide) : on la construit, comme makeLight() le ferait.
    if (!lum) {
      if (this.subType === 'spot') lum = new THREE.SpotLight(this.color, this.intensity, this.range, this.angle, this.penumbra, 1.5);
      else if (this.subType === 'directional') lum = new THREE.DirectionalLight(this.color, this.intensity);
      else lum = new THREE.PointLight(this.color, this.intensity, this.range, 2);
      lum.castShadow = true;
      if (lum.shadow && lum.shadow.mapSize) lum.shadow.mapSize.set(1024, 1024);
      o.add(lum);
      ed(o).light = lum;
      if (this.subType === 'spot' || this.subType === 'directional') {
        const target = new THREE.Object3D();
        target.position.set(0, -4, 0);
        target.userData.isTarget = true;
        o.add(target);
        lum.target = target;
      }
    }
    this.applyMarker();
    this.objectThree = lum;
    this.applyShadowSettings();
    this.markType(this.subType);
  }

  /**
   * Le repère visible de la lumière — la petite sphère, le cône ou l'octaèdre que porte le
   * nœud — prend la couleur de la lumière.
   *
   * C'était `rebuildTree` qui le faisait à la main à la relecture d'un projet, en lisant le
   * sac `d.lum`. Le faire ici est ce qui rend le composant RECONSTRUCTIF : `addComponent(
   * 'Light', data)` suffit désormais à retrouver l'état complet, sans que l'appelant ait à
   * retoucher le nœud derrière lui.
   *
   * `emissiveSel` (la couleur de surbrillance à la sélection) n'est PAS touchée : la fabrique
   * la pose en orange, et l'écraser ici changerait la surbrillance d'une lumière à laquelle on
   * ajoute le composant à la main.
   */
  applyMarker() {
    const o = this.node;
    if (!o.material || !o.material.emissive) return;
    o.material.emissive.setHex(this.color);
    o.userData.emissiveBase = this.color;
  }

  /**
   * Relit les champs sérialisés. Le constructeur les lit déjà à la création ; `hydrate` existe
   * pour l'autre cas — un composant DÉJÀ posé par la fabrique, qu'on relit depuis le fichier.
   * C'est ce que fait `rebuildTree` : la fabrique construit la lumière avec ses valeurs par
   * défaut, puis le format à composants dit lesquelles sont les bonnes.
   */
  hydrate(d) {
    if (!d) return;
    if (d.subType !== undefined) this.subType = d.subType;
    if (d.color !== undefined) this.color = d.color;
    if (d.intensity !== undefined) this.intensity = d.intensity;
    if (d.range !== undefined) this.range = d.range;
    if (d.angle !== undefined) this.angle = d.angle;
    if (d.penumbra !== undefined) this.penumbra = d.penumbra;
    ['shadowMapSize', 'shadowExtent', 'shadowBias'].forEach((k) => { if (d[k] !== undefined) this.data[k] = d[k]; });
    // Sur une lumière THREE qui existe déjà, les champs relus doivent redescendre dedans :
    // sans ça, l'inspecteur affiche la bonne couleur et la scène en montre une autre.
    const lum = ed(this.node).light;
    if (lum) {
      lum.color.setHex(this.color);
      lum.intensity = this.intensity;
      if (lum.distance !== undefined) lum.distance = this.range;
      if (this.subType === 'spot') { lum.angle = this.angle; lum.penumbra = this.penumbra; }
    }
    this.applyShadowSettings();
    this.applyMarker();
  }

  onRemove() {
    const o = this.node;
    if (this.objectThree) {
      const target = this.objectThree.target;
      o.remove(this.objectThree);
      if (target && target.parent === o) o.remove(target);
      ed(o).light = null;
    }
    if (o.userData.type === this.subType) o.userData.type = 'group';
    delete o.userData.lum;
    if (typeof removeHelper === 'function') removeHelper(o);
  }

  onActiveChange(active) {
    if (this.objectThree) this.objectThree.visible = active;
  }

  // DÉTACHÉE : `this.data` EST `userData.lum` (contrat de component.js, règle 4).
  serialize() {
    return detachData(this.data);
  }

  static get typeName() { return 'Light'; }
  static get description(){ return 'Éclaire la scène'; }
  static get icon(){ return Icons.html('lightbulb') + ' '; }

  // L'icône dépend du sous-type, donc de l'instance — `iconOf` interroge d'abord l'instance.
  icon(){
    return (this.subType === 'spot') ? Icons.html('flashlight') + ' '
         : (this.subType === 'directional') ? Icons.html('sun') + ' '
         : Icons.html('lightbulb') + ' ';
  }
  static get category() { return 'Rendu'; }
  // 3D seulement. La separation est stricte : sans cette declaration, un composant
  // 3D se poserait sur un objet 2D — la porte de la phase 1 l'a attrape.
}

Registry.registerClass(Light);
