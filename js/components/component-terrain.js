// moteur/js/components/component-terrain.js
// this.donnees référence DIRECTEMENT userData.terr : source unique, lue par
// terrain.js/physics.js et par ce composant.
import { ensureTerrain } from '../component-data.js';
import { Registry } from '../component-registry.js';
import { Component, detachData } from '../component.js';

export class Terrain extends Component {
  constructor(node, opts) {
    super(node);
    this.data = opts || {};
  }

  onAdd() {
    const o = this.node;
    // Les données REÇUES sont la source ; `userData.terr` est la copie de travail que lisent
    // terrain.js et physics.js. Cette ligne les jetait (`this.data = ensureTerrain(...)`) :
    // un terrain reposé depuis ses données revenait plat et à la taille par défaut.
    const recues = this.data || {};
    // ensureTerrain AVANT la recopie : il ne garnit les défauts que si le sac est absent.
    const sac = ensureTerrain(o);
    // `buildTerrain` passe le sac LUI-MÊME en données : pas de recopie sur soi.
    if (recues !== sac) Object.keys(recues).forEach(function (k) { sac[k] = recues[k]; });
    // Les mêmes bornes que buildTerrain, et pour la même raison : un `segments` hors bornes
    // ou un tableau de hauteurs de la mauvaise longueur produit une géométrie incohérente
    // avec les index que le sculptage et la physique calculent.
    sac.segments = Math.max(4, Math.min(200, sac.segments | 0));
    const nSommets = (sac.segments + 1) * (sac.segments + 1);
    if (!Array.isArray(sac.heights) || sac.heights.length !== nSommets) {
      sac.heights = new Array(nSommets).fill(0);
    }
    this.data = sac;
    // On reconstruit la géométrie quand elle manque, quand elle n'est pas une géométrie de
    // terrain (pas d'attribut `color`), ET quand elle ne correspond plus au maillage demandé.
    // Ce dernier cas manquait : reposer le composant avec un autre `segments` gardait
    // l'ancienne géométrie, et `applyHeightsTerrain` écrivait alors des hauteurs à côté.
    // Le jeu publié construit son terrain autrement (rtMakeTerrain, js/game-runtime.js) et
    // n'embarque pas js/terrain.js : sans ces gardes, tout terrain le faisait planter au
    // chargement. Son porteur a déjà posé géométrie ET hauteurs, il n'y a rien à refaire.
    if (typeof buildGeometryTerrain === 'function') {
      const posit = o.geometry && o.geometry.attributes.position;
      // On reconstruit quand la géométrie manque, quand ce n'est pas une géométrie de terrain
      // (pas d'attribut `color`), ET quand elle ne correspond plus au maillage demandé — ce
      // dernier cas manquait : reposer le composant avec un autre `segments` gardait l'ancienne
      // géométrie, et les hauteurs s'écrivaient à côté.
      if (!o.geometry || !o.geometry.attributes.color || !posit || posit.count !== nSommets) {
        const construit = buildGeometryTerrain(this.data);
        if (o.geometry) o.geometry.dispose();
        o.geometry = construit.geo;
        o.material = construit.mat;
        o.receiveShadow = true;
        o.castShadow = false;
      }
      // TOUJOURS : les hauteurs relues doivent descendre dans la géométrie, qu'elle vienne
      // d'être construite ou qu'elle préexiste.
      if (typeof applyHeightsTerrain === 'function') applyHeightsTerrain(o);
    }
    this.markType('terrain');
  }

  // Les données relues deviennent celles du composant. `onAdd` les recopiera dans le sac
  // `userData` que lisent les systèmes ; rejouer `hydrate` puis `onAdd` sur une instance déjà
  // posée est ainsi ce qui relit le terrain depuis le fichier.
  hydrate(d) {
    if (d) this.data = d;
  }

  onRemove() {
    delete this.node.userData.terr;
    if (this.node.userData.type === 'terrain') this.node.userData.type = 'group';
  }

  onActiveChange(active) {
    if (!active && sculpt.active && sculpt.target === this.node) stopSculpt();
  }

  // DÉTACHÉES (contrat de component.js, règle 4) : `this.data` EST `userData.terr`. La copie
  // est profonde, donc le tableau de hauteurs est copié : c'est voulu, un appelant qui trie ou
  // normalise le résultat ne doit pas déformer le terrain de la scène.
  serialize() { return detachData(this.data); }

  static get typeName() { return 'Terrain'; }
  static get description(){ return 'Sol sculpté et texturé'; }
  static get icon(){ return Icons.html('mountains') + ' '; }
  static get category() { return 'Monde'; }
  // 3D seulement. La separation est stricte : sans cette declaration, un composant
  // 3D se poserait sur un objet 2D — la porte de la phase 1 l'a attrape.
}

Registry.registerClass(Terrain);
