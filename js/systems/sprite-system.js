// moteur/js/systems/sprite-system.js
//
// Les sprites, pour les DEUX moteurs : l'animation par images, puis l'ordre de rendu.
//
// Ces deux travaux étaient appelés impérativement dans la boucle de `viewport.js` ET mirroités
// dans `game-runtime.js` (`rtUpdateAnimatorsSprite`, `rtBuildMeshSprite`…) — l'ordonnanceur
// réel était la boucle, et son ordre un savoir implicite (docs/REVUE_2026-09-10.md § 3.4).
// Enregistrés ici, ils ont l'ordre, l'isolation d'erreur et le partage éditeur/runtime.
//
// L'ORDRE compte : l'animation (250) peut reconstruire la maille — donc changer son bas local —
// avant que le tri (300) ne le lise ; et tous deux passent APRÈS la physique 2D, qui tourne avant
// `System.runFrame` dans les deux boucles : le tri par profondeur doit voir les positions finales.
import { System } from '../systems.js';
import { updateAnimatorsSprite } from '../components/component-anim-sprite.js';
import { layers2dOfProject } from '../components/component-sprite.js';

System.register({
  name: 'SpriteAnimatorSystem',
  requires: ['SpriteAnimator'],
  order: 250,
  // Tourne AUSSI en édition : voir bouger le personnage est la seule façon de juger une cadence.
  // `ctx.emit` : le bus d'événements du jeu publié ; l'éditeur n'en passe pas.
  onFrame(anims, dt, ctx){
    if(!anims.length) return;
    updateAnimatorsSprite(anims.map(function(a){ return a.node; }), dt, ctx && ctx.emit);
  }
});

System.register({
  name: 'SpriteSystem',
  requires: ['SpriteRenderer'],
  order: 300,
  onFrame(sprites){
    // L'ordre recalculé à la main à chaque endroit qui touchait un calque — création, changement
    // d'ordre, chargement : un seul oubli faisait passer un personnage DERRIÈRE le décor.
    sprites.forEach(function(s){
      if(!s._dirtyOrder || typeof s.applyRenderOrder !== 'function') return;
      s.applyRenderOrder();
      s._dirtyOrder = false;
    });
    // LE TRI PAR PROFONDEUR (vue de dessus), aussi en édition : on pose un décor à la main, et
    // il faut voir tout de suite s'il passera devant ou derrière le personnage. Garde `typeof` :
    // js/sprite-2d.js est facultatif dans un build allégé.
    if(sprites.length && typeof updateSortDepth2d === 'function'){
      updateSortDepth2d(sprites.map(function(s){ return s.node; }), layers2dOfProject());
    }
  }
});
