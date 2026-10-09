// moteur/js/components/component-mesh.js
// Mesh = MeshFilter + MeshRenderer combinés (à la Unity) : PAS de champs
// dupliqués (couleur/rugosite/geo en hidden), mais des références DIRECTES vers
// le THREE.Mesh et son THREE.Material réels. `material` est un getter qui lit
// TOUJOURS this.node.material (jamais une copie mise en hidden) : après un
// applyMaterialOn(), o.materiau est remplacé par une NOUVELLE instance —
// un champ caché serait resté sur l'ancienne. Retirer ce composant retire la
// forme ET l'apparence : plus rien à afficher, comme unregister MeshFilter +
// MeshRenderer dans Unity (transform/enfants restent).
import { Registry } from '../component-registry.js';
import { Component } from '../component.js';

export class Mesh extends Component {
  constructor(node) {
    super(node);
    this.mesh = node;   // le THREE.Mesh porteur (mesh.geometry = forme)
  }

  get material() { return this.node.material; }

  onAdd() {
    // physics.js/materials.js reconnaissent une primitive éditable par
    // userData.type === 'mesh' (auto-check, corps rigide…) : sur un Noeud
    // « Vide », on pose le tag pour que ces systèmes le prennent en compte.
    this.markType('mesh');
  }

  onActiveChange(active) {
    this.node.visible = active;
  }

  onRemove() {
    // Un Terrain (component-terrain.js) possède aussi son THREE.Mesh.geometry —
    // rien n'empêche le popup + Component d'add Mesh sur un objet Terrain ;
    // disposer/remplacer sa géométrie casserait le terrain (voir Terrain.onAdd).
    if (this.node.getComponent && this.node.getComponent('Terrain')) return;
    if (this.mesh.geometry) this.mesh.geometry.dispose();
    this.mesh.geometry = new THREE.BufferGeometry();   // plus rien à dessiner
    delete this.node.userData.geo;
    delete this.node.userData.geoAsset;
  }

  /**
   * RECONSTRUCTIF : reposer ce composant avec ce que `serialize()` a rendu doit redonner la
   * même forme et la même apparence.
   *
   * C'était le « miroir jamais relu » du modèle de composants : `serialize()` écrivait
   * fidèlement geo/color/mat/texture, et `hydrate()` n'existait pas — c'est `rebuildTree` qui
   * rejouait tout à la main depuis les sacs `d.geo`/`d.mat`/`d.texAsset`. La même logique en
   * deux exemplaires, dont un seul était tenu à jour.
   *
   * Chaque champ est gardé sur sa présence : `makePrimitive` attache ce composant SANS données
   * (la forme et le matériau viennent d'être construits), et un `hydrate({})` ne doit rien
   * toucher.
   */
  hydrate(d) {
    if (!d) return;
    const o = this.node;
    // LA FORME. On ne reconstruit que si elle change vraiment : disposer puis rebâtir la
    // géométrie d'un maillage qui a déjà la bonne coûte cher pour rien, et perdrait un
    // dépliage d'UV rangé dans l'atlas de lightmap.
    if (d.geo && d.geo !== o.userData.geo && typeof buildGeometry === 'function') {
      const construite = buildGeometry(d.geo);
      if (o.geometry) o.geometry.dispose();
      o.geometry = construite.geo;
      o.userData.geo = construite.geoName;
    }
    // La géométrie venue d'un asset (forme importée) : elle remplace la primitive.
    // `assetOfReference` sait chercher dans la liste globale des assets quand on ne lui
    // passe pas de table d'anciens ids — c'est le cas ici, le composant ne connaît que
    // la référence qu'il porte.
    if (d.geoAsset && typeof assetOfReference === 'function'
        && typeof applyGeometryAsset === 'function') {
      const a = assetOfReference({}, d.geoAsset);
      if (a && a.template) applyGeometryAsset(o, a);
    }
    // L'APPARENCE.
    if (d.color !== undefined && this.material.color) this.material.color.setHex(d.color);
    if (d.mat) {
      const m = this.material;
      // Le fichier porte un LISSAGE, le matériau une rugosité : la conversion vit dans
      // js/materials.js pour l'éditeur, et dans roughnessRuntime pour le jeu publié, qui
      // n'embarque pas materials.js. Sans la seconde branche, tout matériau d'un jeu publié
      // repartait à la rugosité par défaut.
      if (typeof roughnessFromSmoothing === 'function') {
        m.roughness = roughnessFromSmoothing(d.mat.smoothness);
      } else if (typeof roughnessRuntime === 'function') {
        m.roughness = roughnessRuntime(d.mat);
      }
      if (d.mat.metal !== undefined) m.metalness = d.mat.metal;
      if (d.mat.emissive !== undefined && m.emissive) {
        m.emissive.setHex(d.mat.emissive);
        o.userData.emissiveBase = d.mat.emissive;
      }
      if (d.mat.opacity !== undefined) {
        m.opacity = d.mat.opacity;
        // Sans ça, une opacité < 1 est écrite dans le matériau et n'a aucun effet visible :
        // three ne mélange que si `transparent` est vrai.
        m.transparent = d.mat.opacity < 1;
      }
    }
    // LA TEXTURE. Deux environnements, deux résolveurs — et c'est le seul endroit du
    // composant où ils diffèrent : l'éditeur passe par la liste d'assets et applyTextureRaw,
    // le jeu publié par sa propre table (rtSetTextureDirect). Sans cette seconde branche, un
    // jeu publié perdait toutes ses textures directes — le composant les ignorait en silence.
    if (d.texAsset) {
      if (typeof rtSetTextureDirect === 'function') {
        rtSetTextureDirect(o, d.texAsset);
        o.userData.texAsset = d.texAsset;
      } else if (typeof assetOfReference === 'function' && typeof applyTextureRaw === 'function') {
        const t = assetOfReference({}, d.texAsset);
        if (t && applyTextureRaw(t, o, true)) o.userData.texAsset = t.id;
      }
    }
    // APRÈS le matériau : `toggleUnlit` le REMPLACE par un matériau non éclairé en
    // reprenant couleur, opacité et texture — l'appeler avant perdrait les trois.
    if (d.notEclaire && typeof toggleUnlit === 'function') toggleUnlit(o, true);
    if (d.ombreProjetee !== undefined) o.castShadow = d.ombreProjetee;
    if (d.ombreRecue !== undefined) o.receiveShadow = d.ombreRecue;
  }

  serialize() {
    const o = this.node;
    return {
      geo: o.userData.geo || null,
      geoAsset: o.userData.geoAsset || null,
      color: this.material.color.getHex(),
      mat: {
        // Même clé et même sens que serialization.js : un projet enregistré ne
        // doit pas contenir deux conventions contradictoires pour la même
        // propriété. Miroir jamais relu (Mesh.restore ignore `data`), mais un
        // humain qui ouvre le fichier, lui, le lit.
        // Calcul EN LIGNE, pas `smoothingFromRoughness` : cette globale vient de materials.js, que
        // le jeu publié ne charge pas — et le runtime passe ici en clonant un prefab (toJSON).
        // « smoothingFromRoughness is not defined » y faisait échouer chaque api.create.
        smoothness: Math.round(Math.max(0, Math.min(1, 1 - (this.material.roughness === undefined ? 0.55 : this.material.roughness))) * 1e6) / 1e6,
        metal: this.material.metalness,
        emissive: o.userData.emissiveBase || 0, opacity: this.material.opacity
      },
      texAsset: o.userData.texAsset || null,
      notEclaire: !!o.userData.notEclaire,
      ombreProjetee: o.castShadow !== false,
      ombreRecue: o.receiveShadow !== false
    };
  }

  static get typeName() { return 'Mesh'; }
  static get description(){ return 'Forme 3D visible'; }
  static get icon(){ return Icons.html('cube') + ' '; }
  static get category() { return 'Rendu'; }
  // 3D seulement. La separation est stricte : sans cette declaration, un composant
  // 3D se poserait sur un objet 2D — la porte de la phase 1 l'a attrape.
}

Registry.registerClass(Mesh);
