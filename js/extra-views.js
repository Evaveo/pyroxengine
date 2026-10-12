// ---------- Les vues SUPPLÉMENTAIRES rendues par la boucle de l'éditeur ----------
//
// La boucle de rendu (js/viewport.js) ne connaît qu'une vue : la vue Scène. La vue Jeu
// (js/game-view.js) a besoin d'être rendue DANS la même image, par le même renderer, au bon
// moment — après les Systèmes, avant le rendu de la vue Scène. Ce petit registre est le point de
// rencontre, et c'est tout ce qu'il est.
//
// SANS AUCUN IMPORT, à dessein : viewport.js l'importe, game-view.js aussi, et aucun des deux
// n'importe l'autre. Un `import` direct de game-view.js par viewport.js l'aurait fait entrer dans
// le grand cycle de modules du moteur (mesuré par test/cliquets-dette.test.mjs), pour un service
// qui n'en a aucun besoin.
//
// Une vue déclare `{name, active(), render(frame)}` : `active()` dit si on la regarde (elle ne
// coûte RIEN tant qu'elle est cachée), `render(frame)` la dessine.

export const EXTRA_VIEWS = [];

/** Inscrit une vue (une seule fois par nom : un second appel remplace le premier). */
export function registerExtraView(view){
  if(!view || !view.name || typeof view.render !== 'function'){
    throw new Error('vue supplémentaire : `name` et `render` sont obligatoires');
  }
  const i = EXTRA_VIEWS.findIndex(function(v){ return v.name === view.name; });
  if(i !== -1) EXTRA_VIEWS.splice(i, 1, view); else EXTRA_VIEWS.push(view);
  return view;
}

/** Au moins une vue supplémentaire est-elle regardée ? (La boucle ne s'endort pas alors, même
 *  quand la vue Scène est cachée derrière l'onglet Jeu.) */
export function extraViewsActive(){
  return EXTRA_VIEWS.some(function(v){
    try { return typeof v.active !== 'function' || !!v.active(); }
    catch(e){ return false; }
  });
}

/** Rend les vues regardées. `isolate(nom, travail)` : l'isolation d'erreur de la boucle
 *  (`System.isolate`) — une vue qui lève ne doit pas emporter le rendu de la vue Scène. */
export function renderExtraViews(frame, isolate){
  const run = (typeof isolate === 'function') ? isolate : function(n, fn){ fn(); };
  let n = 0;
  EXTRA_VIEWS.forEach(function(v){
    let on = false;
    try { on = typeof v.active !== 'function' || !!v.active(); } catch(e){ on = false; }
    if(!on) return;
    run(v.name, function(){ v.render(frame); });
    n++;
  });
  return n;
}
