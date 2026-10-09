// ---------- LE CONTRÔLE SEGMENTÉ : une façade sur un <select>, jamais un remplaçant ----------
//
// Un menu déroulant à trois valeurs cache deux options sur trois et demande deux clics pour en
// changer. Trois segments les montrent et en demandent un. C'est ce que la maquette montre pour
// le référentiel du gizmo.
//
// MAIS LE `<select>` RESTE, CACHÉ, ET C'EST LUI QUI PORTE LA VALEUR. Trois raisons, dans
// l'ordre d'importance :
//
//  1. `js/scene.js` écoute `change` sur `#g-space` et lit `.value` — le remplacer obligerait à
//     toucher au gizmo pour un changement d'habillage, ce qui est le meilleur moyen de casser
//     ce qui marchait ;
//  2. `applySpaceGizmo` DÉSACTIVE le select quand le mode Échelle impose l'espace local, et
//     réécrit son `title`. Cet état est produit ailleurs et doit se refléter ici : le segmenté
//     l'observe au lieu de le dupliquer ;
//  3. un `<select>` sait déjà ce qu'un groupe de boutons ne sait pas — être piloté au clavier,
//     être lu par une technologie d'assistance, retenir une valeur.
//
// Le segmenté ÉCRIT donc le select et émet son `change` ; il ne décide de rien.
import { select } from '../selection.js';

export const Segmented = (function(){

  /**
   * Relie un groupe `.ui-seg` à son `<select>`.
   *
   * Le lien est déclaré dans le markup : `data-for` porte l'id du select, chaque bouton porte
   * `data-space` (ou `data-value`) avec la valeur qu'il pose. Rien n'est codé en dur ici, pour
   * que le même module serve au prochain groupe de trois valeurs sans être rouvert.
   */
  function bind(group, select){
    if(!group || !select || group.dataset.bound === '1') return null;
    group.dataset.bound = '1';

    const buttons = Array.from(group.querySelectorAll('button[data-value],button[data-space]'));
    const valueOf = (b) => b.dataset.value || b.dataset.space;

    function sync(){
      const current = select.value;
      buttons.forEach(function(b){
        b.classList.toggle('active', valueOf(b) === current);
        // Le select désactivé (mode Échelle) désactive les segments : sans ça, on clique sur
        // « Monde », rien ne bouge, et rien ne dit pourquoi.
        b.disabled = select.disabled;
        b.title = select.disabled ? select.title : (b.dataset.title || '');
      });
    }

    buttons.forEach(function(b){
      // Le titre d'origine est retenu : `sync` le remplace par celui du select quand le groupe
      // est désactivé, et doit pouvoir le rendre ensuite.
      b.dataset.title = b.title;
      b.addEventListener('click', function(){
        if(select.disabled) return;
        if(select.value === valueOf(b)) return;
        select.value = valueOf(b);
        // `dispatchEvent` et non un appel direct : c'est le select qui est la source de vérité,
        // et tous ses écouteurs — pas seulement celui qu'on connaît — doivent être prévenus.
        select.dispatchEvent(new Event('change', {bubbles: true}));
      });
    });

    // Quelqu'un d'autre a changé la valeur ou l'état (applySpaceGizmo, un raccourci clavier,
    // le copilote) : le segmenté suit. C'est ce qui l'empêche d'afficher une valeur périmée.
    select.addEventListener('change', sync);
    if(typeof MutationObserver === 'function'){
      new MutationObserver(sync).observe(select, {
        attributes: true, attributeFilter: ['disabled', 'title']
      });
    }
    sync();
    return {sync: sync};
  }

  /** Relie tous les groupes de la page qui déclarent un `data-for`. Réentrante. */
  function bindAll(root){
    const scope = root || document;
    const out = [];
    scope.querySelectorAll('.ui-seg[data-for]').forEach(function(group){
      const select = document.getElementById(group.dataset.for);
      const bound = bind(group, select);
      if(bound) out.push(bound);
    });
    return out;
  }

  return {bind: bind, bindAll: bindAll};
})();

if (typeof globalThis !== 'undefined') globalThis.Segmented = Segmented;
