// moteur/js/gpu-release.js — libération DIFFÉRÉE des ressources GPU (textures, cibles de rendu,
// matériaux, géométries).
//
// PARTAGÉ entre l'éditeur et le jeu publié, sans dépendance : importé par lightmap-rgbm.js,
// probes.js, lightmap-bake.js, assets.js et game-runtime.js.
//
// POURQUOI. En WebGPU, un rendu n'est qu'ENCODÉ au retour de `render()` / `cube.update()` : la
// soumission au GPU suit. Et three garde ses propres références sur ce qu'il a déjà branché
// (observateur de nœuds d'un matériau, `ShadowNode.shadowMap`, fond de scène). Détruire une
// texture encore branchée donne « Destroyed texture … used in a submit », ou un rendu qui lit
// `isTexture` sur null (docs/KNOWN_ISSUES.md, v1.10.8 et v1.10.9). La règle est donc : on
// DÉBRANCHE d'abord (on repointe les matériaux, la scène), puis on libère quelques images plus
// tard, quand plus aucune soumission en vol ne peut s'y référer.
//
// La file se cadence elle-même (requestAnimationFrame, setTimeout à défaut — onglet en
// arrière-plan, node:test) : aucune des deux boucles d'image n'a à l'appeler.

export const RELEASE_DELAY_FRAMES = 3;

const queue = [];   // [{res, frames}]
let scheduled = false;

function schedule(){
  if(scheduled || !queue.length) return;
  scheduled = true;
  const next = function(){ scheduled = false; tickGpuRelease(); };
  // rAF seul se suspend en arrière-plan : la mémoire s'accumulerait. setTimeout prend le relais.
  if(typeof requestAnimationFrame === 'function'){
    let done = false;
    const once = function(){ if(done) return; done = true; next(); };
    requestAnimationFrame(once);
    setTimeout(once, 50);
  } else setTimeout(next, 16);
}

/** Libère `res` (objet à méthode dispose) après `frames` images. Ignore null et les doublons. */
export function releaseLater(res, frames){
  if(!res || typeof res.dispose !== 'function') return;
  if(queue.some(function(e){ return e.res === res; })) return;
  queue.push({res: res, frames: (frames === undefined) ? RELEASE_DELAY_FRAMES : Math.max(0, frames | 0)});
  schedule();
}

/** Une image s'est écoulée : libère ce qui est arrivé à échéance. Exporté pour les tests. */
export function tickGpuRelease(){
  for(let i = queue.length - 1; i >= 0; i--){
    const e = queue[i];
    if(e.frames-- > 0) continue;
    queue.splice(i, 1);
    try { e.res.dispose(); } catch(err){ console.warn('Libération GPU différée :', err); }
  }
  schedule();
}

/** Nombre de ressources en attente (diagnostic, tests). */
export function pendingGpuRelease(){ return queue.length; }

globalThis.releaseLater = releaseLater;
