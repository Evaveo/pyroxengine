// ---------- Les panneaux de la coquille ----------
//
// TOUT EST UN PANNEAU, y compris la vue 3D, la hiérarchie, le projet et la console. C'est ce qui
// permet de les empiler, de les déplacer et de les rouvrir depuis le menu `Fenêtres` sans que
// chacun ait son cas particulier.
//
// Chacun ADOPTE un élément déjà écrit dans `editor.html` : le dock le déplace, il ne le
// reconstruit pas. Les ids et les écouteurs posés au chargement par une douzaine de fichiers
// continuent donc de fonctionner sans rien savoir du dock.

import { anim, closeClipAsset, updateTimeline } from '../animation.js';
import { drawGraph, updateTabsView } from '../animator-graph.js';
import { assets } from '../assets.js';
import { buildBlenderWorkshop, hideBlenderWorkshop } from '../blender-workshop.js';
import { markConsoleView } from '../console.js';
import { ensureCopilotUI } from '../copilot.js';
import { env } from '../environment.js';
import { setStatus } from '../hierarchy.js';
import { openWindowPalette, paletteWindow } from '../palette-ui.js';
import { project } from '../project.js';
import { assetSelected } from '../selection.js';
import { Dock } from './dock.js';
import { Panels } from './panel.js';
import { postProfileWindow } from './panels-postprofile.js';
import { PANEL_ENVIRONMENT, PANEL_RENDER } from './panels-scene.js';
import { PANEL_PREFERENCES, PANEL_PROJECT_SETTINGS } from './panels-settings.js';
import { Prefs } from './prefs.js';

export function registerPanelsShell(){
  Panels.register({
    id: 'hierarchy', title: 'Hiérarchie', icon: '🌳',
    adopt: 'hier', defaultZone: 'left', minWidth: 150
  });

  Panels.register({
    id: 'viewport', title: 'Vue', icon: '🎬',
    adopt: 'view', defaultZone: 'center', minWidth: 200,
    // La vue 3D ne se ferme pas : sans elle, il n'y a plus rien à regarder et aucun moyen
    // évident de la récupérer. C'est la seule exception, et elle est écrite ici.
    closable: false
  });

  Panels.register({
    id: 'inspector', title: 'Inspecteur', icon: '🔧',
    adopt: 'insp', defaultZone: 'right', minWidth: 180
  });

  Panels.register({
    id: 'project', title: 'Projet', icon: '📦',
    adopt: 'project-zone', toolbar: 'tools-project', defaultZone: 'bottom', minHeight: 110
  });

  // Les deux panneaux de SCÈNE. Ils décrivent la scène, pas l'objet sélectionné : les laisser
  // dans un repli « aucun objet sélectionné » de l'inspecteur, c'était les rendre invisibles dès
  // qu'on cliquait sur un cube. Ils rejoignent la colonne de droite, en onglets à côté de lui.
  Panels.register(Object.assign({}, PANEL_ENVIRONMENT, {
    targets: function(){ return [env]; }
  }));
  Panels.register(Object.assign({}, PANEL_RENDER, {
    // Le panneau Rendu vise `env.post` et `filters` par ses accesseurs : sa cible n'est qu'un
    // jeton, il ne lit rien dessus.
    targets: function(){ return [env]; }
  }));

  // Les deux fenêtres de RÉGLAGES. Des panneaux et non des modales : une fenêtre de réglages
  // qu'on ne peut pas laisser ouverte à côté de la vue force un aller-retour par essai.
  Panels.register(Object.assign({}, PANEL_PROJECT_SETTINGS, {
    targets: function(){ return [project.settings]; }
  }));
  Panels.register(Object.assign({}, PANEL_PREFERENCES, {
    // La cible est le registre lui-même : chaque champ lit et écrit par `Prefs.get/set`, donc
    // exactement comme le reste de l'éditeur lit et écrit ses préférences.
    targets: function(){ return [Prefs]; }
  }));

  Panels.register({
    id: 'console', title: 'Console', icon: '📋',
    adopt: 'console-body', toolbar: 'tools-console', defaultZone: 'bottom', minHeight: 110,
    onDemand: true,
    // Regarder la console remet son compteur d'erreurs non vues à zéro — c'est ce que faisait
    // `markConsoleView(quel === 'console')` dans le câblage des anciens onglets.
    onShow: function(){ markConsoleView(true); }
  });
}

/**
 * Les trois outils qui vivaient hors du dock (Animation, Animator, Palette de tuiles) :
 * chacun ADOPTE un élément déjà écrit dans `editor.html`, absent du layout par défaut
 * (`onDemand` : ouvrir un outil vide au démarrage n'aiderait personne), et rejoint le
 * layout — dockable, flottant, poppable — dès qu'on l'ouvre, comme n'importe quel panneau.
 */
export function registerPanelsTools(){
  Panels.register({
    id: 'animation', title: 'Animation', icon: '🎬',
    adopt: 'anim-body', toolbar: 'tools-anim', onDemand: true,
    // La règle graduée de la timeline se redessine d'après la largeur de son hôte courant —
    // qui change de taille à chaque redimensionnement, qu'il soit en page ou en fenêtre OS.
    onResize: function(){ updateTimeline(); },
    // Ouvrir le panneau depuis le menu Fenêtres ne redessine rien tout seul (contrairement aux
    // chemins d'ouverture « intelligents » de toggleViewAnimator/openAnimatorOnAsset) : sans
    // ceci, le panneau apparaît vide/non réglé tant qu'on n'a pas redimensionné quelque chose.
    onShow: function(){ updateTimeline(); },
    // Fermer pendant l'édition d'un clip laisserait la timeline écrire dans un asset sans
    // que rien ne le montre : on revient à l'animation de scène.
    onHide: function(){
      if(anim.assetClip && typeof closeClipAsset === 'function'){
        closeClipAsset();
      }
    }
  });

  Panels.register({
    id: 'animator', title: 'Animator', icon: '🔀',
    adopt: 'graph-animator', onDemand: true,
    onResize: function(){ if(typeof drawGraph === 'function') drawGraph(); },
    onShow: function(){ if(typeof drawGraph === 'function') drawGraph(); },
    onHide: function(){ updateTabsView(); }
  });

  Panels.register({
    id: 'palette', title: 'Palette de tuiles', icon: '▦',
    adopt: 'palette-panel', onDemand: true,
    // Seule Palette utilise `onOpenRequest` : c'est le seul des trois dont le SEUL point
    // d'entrée est l'action générique du menu Fenêtres (voir `ui.js`). Animation et Animator ont
    // leur logique d'ouverture « intelligente » directement dans `toggleViewAnimator`/
    // `openAnimatorOnAsset`, appelées depuis des chemins distincts (raccourcis, double-clic sur
    // un asset) qui ne passent pas par cette action générique — l'asymétrie n'est pas un oubli.
    //
    // Sur la palette SÉLECTIONNÉE, sinon la première du projet — ouvrir une fenêtre vide
    // laisserait chercher ce qu'il manque, alors qu'il ne manque qu'un asset à créer.
    onOpenRequest: function(){
      const a = (typeof assetSelected !== 'undefined' && assetSelected
                 && assetSelected.kind === 'tilePalette')
        ? assetSelected
        : (typeof assets !== 'undefined' ? assets.find(function(x){ return x.kind === 'tilePalette'; }) : null);
      if(!a){
        setStatus('Aucune palette de tuiles : créez-en une avec « ＋ Créer ».', 5000);
        return;
      }
      openWindowPalette(a);
    },
    onHide: function(){
      if(typeof paletteWindow !== 'undefined'){ paletteWindow.asset = null; paletteWindow.form = null; }
    }
  });

  // Le COPILOTE : autrefois une fenêtre fixe à lui (position:fixed, sa propre croix), désormais
  // un panneau comme les autres — dockable, flottant, poppable. `onDemand` : absent du layout par
  // défaut, donc un layout enregistré sans lui se relit tel quel ; `defaultZone: 'right'` : quand
  // on l'ouvre, il rejoint la colonne de droite en onglet, comme Environnement ou Préférences
  // (voir docs/KNOWN_ISSUES.md, « Rouvrir un panneau À LA DEMANDE »). L'élément est construit
  // ICI, avant le montage du dock : un layout enregistré qui le contient doit pouvoir l'adopter.
  ensureCopilotUI();
  Panels.register({
    id: 'copilot', title: 'Copilote IA', icon: '✨',
    adopt: 'copilot', toolbar: 'cop-toolbar', defaultZone: 'right', minWidth: 260, onDemand: true
  });

  // MULTIJOUEUR : remplace la fenêtre modale et le bandeau d'autrefois (js/network-editor.js).
  // Même patron que le Copilote : à la demande, rangé à droite quand on l'ouvre, et listé dans le
  // menu Fenêtres grâce à `defaultZone`. Le bouton « Multijoueur » de la barre l'ouvre aussi.
  Panels.register({
    id: 'network', title: 'Multijoueur', icon: '🌐',
    adopt: 'network-panel', defaultZone: 'right', minWidth: 280, onDemand: true,
    onShow: function(){ if(typeof buildNetworkPanel === 'function') buildNetworkPanel(); }
  });

  // LE RACK SONORE (js/sound-rack.js) : même patron que Multijoueur — à la demande, ouvert par
  // son bouton « Audio » de la barre du haut et listé dans le menu Fenêtres.
  Panels.register({
    id: 'sound-rack', title: 'Audio', icon: '🎛',
    adopt: 'sound-rack', defaultZone: 'right', minWidth: 280, onDemand: true,
    onShow: function(){ if(typeof buildSoundRack === 'function') buildSoundRack(); },
    // Fermer le panneau arrête la boucle en écoute et l'animation des LED : sans ça elles tournaient
    // sans fin, sans rien pour les couper (revue du 2026-09-29, § 5.13).
    onHide: function(){ if(typeof stopSoundRackPlayback === 'function') stopSoundRackPlayback(); }
  });

  // L'ATELIER BLENDER (js/blender-workshop.js) : remplace le plugin et l'application EVAVEO Studio.
  // Même patron que Multijoueur. Fermé, il ne sonde plus Blender.
  Panels.register({
    id: 'blender-workshop', title: 'Atelier Blender', icon: '🧱',
    adopt: 'blender-workshop-panel', defaultZone: 'right', minWidth: 300, onDemand: true,
    onShow: buildBlenderWorkshop, onHide: hideBlenderWorkshop
  });

  // Même patron que Palette de tuiles ci-dessus : une fenêtre, pas un panneau plein écran, et
  // dont le SEUL point d'entrée est le double-clic sur un asset (js/assets.js) — pas d'entrée
  // « intelligente » par le menu Fenêtres ici, un profil n'a pas d'équivalent à « la sélection
  // courante » comme la palette.
  Panels.register({
    id: 'postprofile', title: 'Profil de post-traitement', icon: '🌈',
    adopt: 'postprofile-panel', onDemand: true,
    onHide: function(){
      postProfileWindow.asset = null; postProfileWindow.form = null;
    }
  });
}

/**
 * Monte le dock et rend au badge de la console sa place.
 *
 * Appelé par startup.js, APRÈS les plugins : un plugin qui déclare un panneau doit le voir
 * apparaître (spec §9.4). `Dock.mount` relit le layout enregistré et retombe sur la disposition
 * par défaut — en le disant dans la console — si ce layout est illisible.
 */
export function bootDock(){
  registerPanelsShell();
  registerPanelsTools();
  Dock.mount(document.getElementById('dock'));

  // Le badge « n erreurs non vues » vit SUR l'onglet Console : c'est là qu'on le cherche, et
  // c'est là qu'il était avant le dock. Il est déplacé, pas recréé — `js/console.js` l'a saisi
  // au chargement et écrit dedans.
  const badge = document.getElementById('console-badge');
  const tab = Dock.tabElement('console');
  if(badge && tab) tab.appendChild(badge);

  // La console n'est pas l'onglet actif au démarrage : son compteur ne doit pas être remis à
  // zéro par un `onShow` qui n'a pas eu lieu.
  markConsoleView(Dock.activeOf('bottom') === 'console');
}
