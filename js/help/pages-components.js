// ---------- Aide de l'éditeur : partie « Composants » ----------
// Une fiche par composant (id `component-<typeName>`), comme la référence des composants du
// manuel Unity. Le « ? » de chaque carte de l'inspecteur y mène (js/help.js) ; une fiche
// manquante fait échouer test/aide.test.mjs.
import { PAGES_COMPONENTS_3D } from './pages-components-3d.js';
import { PAGES_COMPONENTS_2D } from './pages-components-2d.js';

export const PAGES_COMPONENTS = [].concat(PAGES_COMPONENTS_3D, PAGES_COMPONENTS_2D);
