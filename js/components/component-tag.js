// moteur/js/components/component-tag.js
//
// L'étiquette de gameplay d'un Noeud (« ennemi », « ramassable », « sol »). C'est ce que
// désignent `api.parTag('ennemi')`, `api.auContact('ramassable', …)` et les règles visuelles
// « Quand j'entre en contact avec … ».
//
// POURQUOI UN COMPOSANT. Le tag vit dans `userData.game.tag`, et tout le monde le trouvait en
// balayant la scène. Le commentaire de `evaluateContacts()` (js/scripts.js) annonçait pourtant
// l'inverse — « le coût suit désormais le nombre d'objets TAGUÉS, pas la taille de la scène » —
// alors que la construction de l'index par tag, elle, parcourait bien tous les objets à chaque
// image. Le pré-calcul avait supprimé un facteur (un parcours PAR gestionnaire), pas le
// parcours lui-même. Avec ce composant, la promesse devient vraie : `Registry.activeNodes('Tag')`
// ne rend que les objets réellement étiquetés.
//
// Il est attaché SEULEMENT quand le tag est non vide — un objet sans étiquette n'est pas une
// entité du système de tags, et l'y faire figurer annulerait tout le bénéfice. D'où
// `updateComponentTag()` ci-dessous, à appeler quand le tag change : c'est le prix de la précision
// de l'index, et les deux seuls endroits qui écrivent un tag (le champ de l'inspecteur et
// l'action du copilote) l'appellent. Rien ne modifie un tag pendant une partie : `api.tag()`
// est en lecture seule des deux côtés.
import { ensureGame } from '../component-data.js';
import { Registry } from '../component-registry.js';
import { Component } from '../component.js';

export class Tag extends Component {
  get data() { return ensureGame(this.node); }
  get value() { return (this.data.tag || '').trim(); }

  // Rien : `userData.game` est déjà écrit par serializeObject, tag compris. Ce composant est un
  // index, pas un deuxième stockage.
  serialize() { return {}; }

  static get typeName() { return 'Tag'; }
  static get icon(){ return Icons.html('tag') + ' '; }
  static get category() { return 'Gameplay'; }
  // Index pur : la provenance du modèle, le tag et la sous-scène ont déjà leur
  // section dédiée dans l'inspecteur. Voir Component.internal.
  static get internal() { return true; }
}

Registry.registerClass(Tag);

// Aligne la présence du composant sur la valeur du tag. Idempotent : appelable à chaque frappe
// dans le champ de l'inspecteur.
export function updateComponentTag(node) {
  if (!node || typeof node.getComponent !== 'function') return;
  const tag = (node.userData.game && node.userData.game.tag || '').trim();
  const existant = node.getComponent('Tag');
  if (tag && !existant) node.addComponent('Tag', {});
  else if (!tag && existant) node.removeComponent(existant);
}

// Les Noeuds portant un tag donné. Une seule implémentation pour les deux côtés — l'éditeur et
// le runtime avaient chacun leur `objets.filter(x => x.userData.game && x.userData.game.tag === t)`.
export function nodesByTag(tag) {
  const voulu = String(tag == null ? '' : tag);
  return Registry.activeNodes('Tag').filter(function (o) {
    return o.userData.game && o.userData.game.tag === voulu;
  });
}

// L'index complet tag → Noeuds VISIBLES, construit en un passage sur les seuls objets étiquetés.
// Partagé par evaluateContacts (scripts.js), majEvenementsVisuels (events.js) et leurs deux
// miroirs runtime, qui en tenaient chacun une copie.
export function indexByTag() {
  const byTag = new Map();
  Registry.activeNodes('Tag').forEach(function (o) {
    if (!o.visible) return;
    const t = o.userData.game && o.userData.game.tag;
    if (!t) return;
    let list = byTag.get(t);
    if (!list) { list = []; byTag.set(t, list); }
    list.push(o);
  });
  return byTag;
}
