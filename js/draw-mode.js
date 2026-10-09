// ---------- LES MODES D'AFFICHAGE : une seule pile de substitution ----------
//
// POURQUOI CE MODULE. L'éditeur avait DEUX mécanismes de remplacement de matériau, écrits
// séparément dans js/scene.js : un pour couper les graphes de shader, un pour couper les
// textures. Ils se marchaient dessus — le second substituait par-dessus le substitut du
// premier et le mémorisait comme « l'original », de sorte que rétablir les textures rendait
// à l'objet le matériau neutre du filtre Shaders au lieu du sien. Une panne qui ne se voit
// qu'en combinant deux bascules, donc rarement, donc tard.
//
// Ajouter les modes de rendu façon Unity par-dessus aurait fait un TROISIÈME mécanisme. Ce
// module les remplace tous : il DÉCIDE, en une fois, ce que devient un matériau — et il ne
// construit rien. La décision est ainsi mesurable sans navigateur ni renderer, ce que le
// harnais exige, et c'est elle qui contient toute la logique où l'on peut se tromper.
import { filters } from './scene.js';
import { mode } from './viewport.js';

export const DrawMode = (function(){

  // L'ordre est celui de la barre d'outils, du plus courant au plus spécialisé.
  const MODES = [
    {id: 'shaded', label: 'Ombré', icon: 'sphere',
     help: 'Le rendu normal : matériaux, lumières et ombres.'},
    {id: 'wireframe', label: 'Fil de fer', icon: 'polygon',
     help: 'La géométrie seule, sans éclairage — pour juger une topologie ou trouver une face '
         + 'retournée.'},
    {id: 'unlit', label: 'Non éclairé', icon: 'circle-half',
     help: 'Les couleurs et textures sans aucun éclairage — pour voir ce qui vient du matériau '
         + 'et ce qui vient des lumières.'},
    {id: 'lighting', label: 'Éclairage seul', icon: 'lightbulb-filament',
     help: 'Tous les matériaux en blanc mat : il ne reste que la lumière et les ombres. C\'est '
         + 'le mode qui montre qu\'une zone est sombre parce qu\'elle est mal éclairée, et non '
         + 'parce que sa texture est sombre.'}
  ];

  const DEFAULT = 'shaded';

  function isMode(id){
    return MODES.some(function(m){ return m.id === id; });
  }

  /**
   * Ce qu'il faut faire d'UN matériau, pour un mode et un jeu de bascules donnés.
   *
   * `info` décrit le matériau sans le contenir : `{isNodeMaterial, hasMaps}`. C'est ce qui
   * permet de tester cette fonction avec des objets nus.
   *
   * Rend un plan, jamais un matériau :
   *   `keep`          — ne rien faire, l'objet garde son matériau (le cas de loin le plus
   *                     fréquent, et le seul qui ne coûte rien)
   *   `wireframe`     — dessiner les arêtes, sans éclairage
   *   `unlit`         — la couleur du matériau, sans éclairage
   *   `white`         — un blanc mat, pour ne montrer que l'éclairage
   *   `stripMaps`     — retirer les textures du matériau conservé
   *   `neutralShader` — remplacer un matériau à graphe par un PBR neutre
   */
  function planFor(mode, filters, info){
    const f = filters || {};
    const i = info || {};
    const m = isMode(mode) ? mode : DEFAULT;

    const plan = {keep: true, wireframe: false, unlit: false, white: false,
                  stripMaps: false, neutralShader: false};

    if(m === 'wireframe'){ plan.keep = false; plan.wireframe = true; plan.unlit = true; }
    else if(m === 'unlit'){ plan.keep = false; plan.unlit = true; }
    else if(m === 'lighting'){ plan.keep = false; plan.white = true; }

    // Les bascules s'appliquent PAR-DESSUS le mode, et non à sa place : couper les textures en
    // mode « Éclairage seul » n'ajoute rien (il n'y en a déjà plus), mais couper les shaders
    // en mode Ombré doit continuer de marcher exactement comme avant.
    if(f.textures === false && i.hasMaps && !plan.white && !plan.wireframe){
      plan.stripMaps = true;
      plan.keep = false;
    }
    if(f.shaders === false && i.isNodeMaterial){
      plan.neutralShader = true;
      plan.keep = false;
    }
    return plan;
  }

  /**
   * Une empreinte de l'état d'affichage.
   *
   * C'est elle qui dit s'il faut refaire une substitution ou la laisser en place. Sans elle,
   * on reconstruirait un matériau par image ; avec une empreinte incomplète, on garderait un
   * substitut périmé après un changement de mode — les deux pannes sont invisibles, l'une
   * coûte des images par seconde et l'autre affiche l'état d'avant.
   */
  function keyOf(mode, filters){
    const f = filters || {};
    return [isMode(mode) ? mode : DEFAULT,
            f.textures === false ? 'T0' : 'T1',
            f.shaders === false ? 'S0' : 'S1'].join('|');
  }

  return {MODES: MODES, DEFAULT: DEFAULT, isMode: isMode, planFor: planFor, keyOf: keyOf};
})();

if (typeof globalThis !== 'undefined') globalThis.DrawMode = DrawMode;
