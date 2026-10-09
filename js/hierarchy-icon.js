// moteur/js/hierarchy-icon.js
//
// L'icône d'un nœud de hiérarchie. Elle vient des COMPOSANTS, pas d'un switch sur
// `userData.type` : ce switch était fermé à la modification (ajouter un type de nœud obligeait à
// rouvrir hierarchy.js), et il ne connaissait pas les tilemaps — une map de tuiles s'affichait
// donc avec l'icône « groupe ».
import { Icons } from './ui/icon.js';

export function iconOf(node){
  const list = (node && node.userData && node.userData.components) || [];
  for(let i = 0; i < list.length; i++){
    const c = list[i];
    // L'INSTANCE d'abord : l'icône d'une lumière dépend de son sous-type (spot, directionnelle,
    // ponctuelle), qui est une donnée d'instance et non de classe.
    if(c && typeof c.icon === 'function'){ const v = c.icon(); if(v) return v; }
    // Un DÉBRIS de composant (objet nu laissé par un clone, voir node.js) n'a pas de
    // constructor.icon : on le saute au lieu de planter sur toute la hiérarchie.
    const icon = c && c.constructor && c.constructor.icon;
    if(icon) return icon;
  }
  // Le repli : un nœud sans aucun composant porteur d'icône est un GROUPE — un conteneur nu.
  // `Icons` peut manquer dans un contexte qui n'évalue que ce fichier ; l'ancien symbole reste
  // alors, parce qu'une icône absente ne doit pas faire tomber tout l'arbre.
  return (typeof Icons !== 'undefined') ? (Icons.html('hexagon') + ' ') : '⬡ ';
}

if (typeof globalThis !== 'undefined') globalThis.iconOf = iconOf;
