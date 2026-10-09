// ---------- Aide de l'éditeur : ouverture du manuel, et AIDE CONTEXTUELLE ----------
// L'aide est une PAGE (help.html), ouverte dans un onglet à part, et ce fichier y conduit.
//
// POURQUOI UNE PAGE. Une modale se referme dès qu'on veut essayer ce qu'on vient de lire.
// Elle interdit donc le seul usage qui compte — lire en travaillant, l'éditeur à côté.
//
// L'AIDE CONTEXTUELLE (façon Unity : le « ? » de chaque composant ouvre sa fiche).
//   - le « ? » d'une carte de composant de l'inspecteur → la fiche `component-<typeName>` ;
//   - le « ? » d'une barre d'onglets du dock → la page du panneau ACTIF de la zone ;
//   - F1 → la page de ce qui est sous la souris (composant, puis panneau), sinon l'accueil.
// Les pages visées sont vérifiées par test/aide.test.mjs : un « ? » ne mène jamais à
// « Page introuvable ».
//
// Le contenu vit dans js/help-content.js et js/help/, chargés par help.html SEULEMENT :
// l'éditeur n'a aucune raison de payer le poids de l'aide à chaque démarrage.

// Un seul onglet d'aide, réutilisé : F1 pressé dix fois ne doit pas ouvrir dix onglets.
// `window.open` sur un nom déjà pris navigue l'onglet existant au lieu d'en créer un.
import { setStatus } from './hierarchy.js';

export const HELP_TARGET_TAB = 'aide-editeur-3d';

// La page du manuel de chaque panneau du dock (id du descripteur → id de page).
export const HELP_PAGE_OF_PANEL = {
  hierarchy: 'panel-hierarchy',
  viewport: 'panel-viewport',
  inspector: 'panel-inspector',
  project: 'panel-project',
  console: 'panel-console',
  animation: 'animation',
  animator: 'animator',
  palette: 'game-2d',
  copilot: 'copilot',
  network: 'multiplayer',
  'sound-rack': 'audio',
  'blender-workshop': 'import-substance',
  postprofile: 'component-PostVolume',
  environment: 'panel-environment'
};

export function helpPageOfComponent(typeName){
  return 'component-' + typeName;
}

export function openHelp(id){
  const url = 'help.html' + (id ? '#' + id : '');
  const tab = window.open(url, HELP_TARGET_TAB);
  if(!tab){
    // bloqueur de fenêtres : ne pas laisser F1 sans effet ni explication
    setStatus('Ouverture de l\'aide bloquée par le navigateur — autorisez les fenêtres '
      + 'pour ce site, ou ouvrez help.html à la main.', 6000);
    return null;
  }
  // Réutiliser l'onglet le laisse EN ARRIÈRE-PLAN sur certains navigateurs, et la
  // deuxième pression sur F1 semble alors ne rien faire.
  if(tab.focus) tab.focus();
  return tab;
}

// Le panneau du dock qui contient un élément : l'id de l'onglet actif de sa zone.
function panelOfElement(el){
  const zone = el && el.closest ? el.closest('.dock-zone') : null;
  if(!zone) return null;
  const tab = zone.querySelector('.dock-tabs .tab.active');
  return tab ? tab.dataset.panel : null;
}

// La page qui répond à « de quoi parle ce que je regarde ? ». null : rien de précis.
export function contextHelpId(el){
  if(!el || !el.closest) return null;
  const card = el.closest('[data-typename]');
  if(card && card.dataset.typename) return helpPageOfComponent(card.dataset.typename);
  const panel = panelOfElement(el);
  return panel && HELP_PAGE_OF_PANEL[panel] ? HELP_PAGE_OF_PANEL[panel] : null;
}

// F1 regarde ce qui est SOUS LA SOURIS, pas le focus : on survole le composant dont on
// se demande ce qu'il fait, on n'a pas forcément cliqué dedans.
let lastPointed = null;

export function openContextHelp(){
  const active = document.activeElement;
  const fromFocus = active && active !== document.body ? contextHelpId(active) : null;
  return openHelp(contextHelpId(lastPointed) || fromFocus || undefined);
}

{
  document.addEventListener('pointerover', function(e){ lastPointed = e.target; }, true);
  document.addEventListener('click', function(e){
    const t = e.target && e.target.closest ? e.target : null;
    if(!t) return;
    const comp = t.closest('[data-help-component]');
    if(comp){
      e.stopPropagation();
      openHelp(helpPageOfComponent(comp.dataset.helpComponent));
      return;
    }
    if(t.closest('.dock-help')){
      openHelp(contextHelpId(t) || undefined);
    }
  });
}
