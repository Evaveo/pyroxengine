// ---------- TeamColor : la couleur du joueur sur un modèle partagé ----------
//
// Né d'un jeu de stratégie (2026-09-29) : huit joueurs, un seul modèle par unité. Sans ce
// composant, il fallait soit un modèle par couleur (8 × 17 unités, autant d'assets à retoucher
// ensemble), soit un script qui fouille les maillages et clone des matériaux à la main — du
// contenu caché dans du code, exactement ce que js/script-asset-lint.js refuse.
//
// Le principe est celui d'Age of Empires : le modèle porte une partie « équipe » dessinée en
// niveaux de gris, dans un matériau reconnaissable par son NOM (`Team` par défaut). Ce composant
// teint, pour CET objet seulement, tous les maillages descendants qui portent ce matériau :
// couleur finale = gris du modèle × couleur du joueur. Les autres instances du même modèle ne
// bougent pas — le matériau est cloné une fois par maillage, jamais modifié en place.
//
// Depuis un script : `api.me.getComponent('TeamColor').color = '#3050e0'`.
// Partagé : le composant est chargé par l'éditeur ET le jeu publié.
import { Registry } from '../component-registry.js';
import { Component, detachData, mergeIntoBag } from '../component.js';

export const TEAM_COLOR_DEFAULT = {color: '#3060e0', material: 'Team'};

function hexToRgb(h){
  const s = String(h || '').replace('#', '');
  if(!/^[0-9a-fA-F]{6}$/.test(s)) return null;
  const n = parseInt(s, 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}

/**
 * Teint les matériaux nommés `materialName` sous `root`. Rend le nombre de maillages teints.
 * Exporté pour les tests : ne dépend que de la forme three (`children`, `material`, `color`).
 */
export function applyTeamColor(root, color, materialName){
  const rgb = hexToRgb(color);
  if(!root || !rgb) return 0;
  let n = 0;
  (function walk(m){
    (m.children || []).forEach(walk);
    if(!m.isMesh || !m.material) return;
    const list = Array.isArray(m.material) ? m.material : [m.material];
    let touched = false;
    const out = list.map(function(mat, k){
      // L'original est retenu sur le maillage : c'est lui qu'on reteint quand la couleur change,
      // pas la copie déjà teinte (sinon deux changements de couleur se multiplieraient).
      const src = (m.userData.teamSrc && m.userData.teamSrc[k]) || mat;
      if(!src || src.name !== materialName || !src.color) return mat;
      m.userData.teamSrc = m.userData.teamSrc || [];
      m.userData.teamSrc[k] = src;
      const own = (m.userData.teamOwn && m.userData.teamOwn[k]) || src.clone();
      m.userData.teamOwn = m.userData.teamOwn || [];
      m.userData.teamOwn[k] = own;
      own.color.copy(src.color);
      own.color.r *= rgb[0]; own.color.g *= rgb[1]; own.color.b *= rgb[2];
      touched = true;
      return own;
    });
    if(touched){ m.material = Array.isArray(m.material) ? out : out[0]; n++; }
  })(root);
  return n;
}

export class TeamColor extends Component {
  constructor(node, opts){
    super(node);
    this.data = opts || {};
  }

  get color(){ return this.data.color || TEAM_COLOR_DEFAULT.color; }
  set color(v){ this.data.color = v; this.refresh(); }
  get material(){ return this.data.material || TEAM_COLOR_DEFAULT.material; }
  set material(v){ this.data.material = v || TEAM_COLOR_DEFAULT.material; this.refresh(); }

  onAdd(){
    const bag = this.node.userData.teamColor = this.node.userData.teamColor || Object.assign({}, TEAM_COLOR_DEFAULT);
    this.data = mergeIntoBag(bag, this.data);
    this.refresh();
  }

  onRemove(){ delete this.node.userData.teamColor; }

  hydrate(d){
    if(!d) return;
    if(d.color !== undefined) this.data.color = d.color;
    if(d.material !== undefined) this.data.material = d.material;
    this.refresh();
  }

  /**
   * Réapplique la teinte. Un modèle se charge parfois APRÈS la pose du composant (ouverture d'un
   * projet) : tant qu'aucun maillage n'est trouvé, on réessaie quelques fois au lieu de laisser
   * l'objet gris sans un mot.
   */
  refresh(tries){
    const n = applyTeamColor(this.node, this.color, this.material);
    this.tinted = n;
    const left = (tries === undefined) ? 20 : tries;
    if(!n && left > 0 && typeof setTimeout === 'function'){
      const self = this;
      setTimeout(function(){ self.refresh(left - 1); }, 150);
    }
    return n;
  }

  serialize(){ return detachData(this.data); }

  static get typeName(){ return 'TeamColor'; }
  static get icon(){ return Icons.html('flag') + ' '; }
  static get description(){ return 'Couleur du joueur sur la partie « équipe » d\'un modèle'; }
  static get category(){ return 'Gameplay'; }
}

Registry.registerClass(TeamColor);
