// moteur/js/systems.js
//
// Les Systèmes : le travail par image, adossé au Registry.
//
// Avant eux, chaque sujet avait sa boucle ad hoc dans l'éditeur (updateCamera2d, rebuildTilemap
// appelé à la main) ET son miroir dans le jeu exporté (rtUpdateCamera2d, rtBuildTilemap). Deux
// implémentations d'une même règle divergent toujours ; ici c'est le jeu publié qui différait de
// ce que l'auteur avait sous les yeux.
import { Registry } from './component-registry.js';

export const System = {
  list: [],

  register(def){
    this.list.push({ name: def.name, requires: def.requires || [],
                     order: def.order || 0, onFrame: def.onFrame,
                     plugin: def.plugin || null });
    this.list.sort((a, b) => a.order - b.order);
  },

  clear(){ this.list.length = 0; },

  /**
   * Une image. `ctx` = { mode: 'edit' | 'play', width, height }.
   *
   * Chaque système est isolé : une erreur dans l'un ne doit pas empêcher les suivants de
   * tourner. Sans cette isolation, une exception fige le rendu entier, et le symptôme
   * (« l'éditeur est gelé ») ne désigne pas le coupable.
   */
  runFrame(dt, ctx){
    for(let i = 0; i < this.list.length; i++){
      const s = this.list[i];
      let instances = [];
      if(s.requires.length){
        s.requires.forEach(function(t){ instances = instances.concat(Registry.active(t)); });
      }
      System.isolate(s.name, function(){ s.onFrame(instances, dt, ctx || {}); });
    }
  },

  /**
   * Exécute un travail d'image en l'ISOLANT, sous un nom.
   *
   * `runFrame` avait cette isolation ; les travaux d'image appelés IMPÉRATIVEMENT par la boucle
   * de `viewport.js` — `SystemScripts.update`, `SystemPhysics.update`, `SystemParticles.update`,
   * `updateAnimators`, le tri 2D, les lightmaps… — ne l'avaient pas. Une exception dans l'un
   * d'eux interrompait donc TOUTE la fin de l'image : plus de rendu, plus de gizmo, plus de
   * grille. Le symptôme est « l'éditeur est gelé », et il ne désigne pas le coupable — exactement
   * ce que l'en-tête de ce fichier annonce vouloir empêcher.
   * Voir docs/REVUE_2026-09-10.md § 3.4.
   *
   * L'erreur est journalisée UNE FOIS par poste, pas une fois par image : soixante messages
   * identiques par seconde rendent la console illisible et cachent la première ligne, celle qui
   * porte la pile.
   */
  _reported: Object.create(null),

  isolate(name, work){
    try { work(); }
    catch(e){
      if(this._reported[name]) return;
      this._reported[name] = true;
      const msg = 'Système « ' + name + ' » : ' + (e && e.message);
      console.error(msg, e);
      // La Console de l'éditeur quand elle existe : c'est là que l'utilisateur regarde.
      if(typeof logConsole === 'function') logConsole('error', msg + ' (signalé une seule fois)', null);
      if(typeof setStatus === 'function') setStatus('⛔ ' + msg + ' — voir la Console', 6000);
    }
  },

  /** Remet à zéro les postes déjà signalés (lancement d'une partie, changement de scène). */
  clearReports(){ this._reported = Object.create(null); }
};

if (typeof globalThis !== 'undefined') globalThis.System = System;
