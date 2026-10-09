// moteur/js/component-views.js
//
// LES FORMULAIRES DE COMPOSANTS, montés dans l'inspecteur — et rien d'autre.
//
// Trois états successifs de ce fichier, qu'il faut connaître pour lire ce qui reste :
//
//   1. Chaque composant portait ses données ET son formulaire : `htmlInspecteur()` construisait
//      des chaînes HTML, `syncDom()` allait chercher `document.getElementById('f-pmass')`,
//      `inputDom()` routait des événements par identifiant DOM. Un composant de trente lignes de
//      données en faisait cent-cinquante, `moteur/` ne pouvait pas tourner sans un DOM contenant
//      littéralement `f-pmass`, et deux composants du même type ne pouvaient pas coexister sur un
//      nœud sans se marcher dessus — une limite de l'ECS imposée par le HTML.
//   2. Ces quatre fonctions ont été DÉPLACÉES ici, hors des classes : un composant est redevenu
//      un porteur de données et de cycle de vie, sa vue vivait à côté.
//   3. Les vingt-et-une vues sont maintenant des DESCRIPTEURS — des données pures, dans
//      js/ui/panels-components.js — rendus par le socle (js/ui/form.js). Il ne reste ici que le
//      MONTAGE : associer un composant à son descripteur, et le formulaire à son hôte.
//
// Le contrat `{html, sync, input, click}` de l'étape 2 a disparu avec la dernière vue migrée
// (AnimatorController) : le routage par identifiant DOM avec lui — l'inspecteur laisse
// simplement passer ce qui se trouve dans un hôte `cmp-host-*`. Un composant SANS descripteur reste parfaitement légitime — un composant
// de plugin, par exemple : l'inspecteur affiche alors son bloc (nom, case d'activation, croix de
// retrait) et pas de corps.
import { component } from './shader-graph-editor.js';
import { createForm } from './ui/form.js';

export const ComponentViews = {
  panels: new Map(),   // typeName -> descripteur
  forms: new Map(),    // composant -> formulaire vivant

  registerPanel(typeName, descriptor) {
    this.panels.set(typeName, descriptor);
    return descriptor;
  },

  /** Le descripteur d'un composant, ou `null`. */
  panelFor(component) {
    if (!component || !component.constructor) return null;
    return this.panels.get(component.constructor.typeName) || null;
  },

  /** L'id de l'hôte d'un composant, dans le bloc que buildBlocksComponents assemble. */
  hostId(idx) { return 'cmp-host-' + idx; },

  /**
   * Un HÔTE VIDE dans le bloc du composant : `buildBlocksComponents` assemble une seule chaîne
   * HTML qu'il pose d'un coup, on ne peut donc pas y construire de DOM en chemin. Le formulaire
   * y est monté après (`mount`).
   */
  html(component, idx) {
    return this.panelFor(component) ? '<div id="' + this.hostId(idx) + '"></div>' : '';
  },

  /** Construit les formulaires, une fois le HTML de l'inspecteur posé. `root` : l'élément
   *  DANS lequel chercher les hôtes — jamais `document.getElementById`, qui répond toujours
   *  pour le document de LA FENÊTRE PRINCIPALE et ne trouve plus rien une fois l'inspecteur
   *  détaché dans un autre onglet (`document.adoptNode`, `windows.js`). Une référence directe
   *  reste valide quel que soit le document qui la possède actuellement.
   */
  mount(node, root) {
    this.forms.clear();
    if (!node || !node.getComponents) return;
    const conteneur = root || document;
    node.getComponents().forEach((component, idx) => {
      const descriptor = this.panelFor(component);
      if (!descriptor) return;
      const host = conteneur.querySelector('#' + this.hostId(idx));
      if (!host) return;
      const form = createForm(host, descriptor);
      form.setTargets([component]);
      this.forms.set(component, form);
    });
  },

  sync(component) {
    const form = this.forms.get(component);
    if (form) form.sync();
  }
};

if (typeof globalThis !== 'undefined') globalThis.ComponentViews = ComponentViews;
