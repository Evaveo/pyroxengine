// ---------- Panneaux ----------
// Un panneau se DÉCLARE (dans n'importe quel ordre, à n'importe quel moment) et se
// CONSTRUIT au `boot()`. Deux propriétés de ce contrat sont des exigences dures :
//
//  · `boot()` est RÉENTRANT. Les plugins sont exécutés en dernier au démarrage
//    (startup.js), donc un panneau peut être déclaré bien après l'initialisation. Un boot
//    qui ne construirait que ce qui existait au premier appel condamnerait les plugins à
//    n'avoir aucun panneau.
//  · Un panneau qui LÈVE est isolé : placard d'erreur dans sa zone, marqué en échec, plus
//    synchronisé TANT QU'IL RESTE EN ÉCHEC. Aujourd'hui, un plugin qui plante emporte
//    l'inspecteur entier.
//
// L'ÉCHEC N'EST PAS DÉFINITIF, et c'est une correction : `failed` était une condamnation à vie.
// Une exception passagère — un asset pas encore chargé, une sélection vide au mauvais moment —
// éteignait le panneau pour toute la session, avec un seul message au premier plantage puis
// plus rien. Le symptôme côté utilisateur : « l'inspecteur ne réagit plus », sans une ligne en
// console. On garde l'isolation (pas de boucle d'erreurs à chaque image) mais on rouvre trois
// portes de reprise : un nouvel hôte, un panneau qu'on ré-affiche, et le bouton « Réessayer »
// du placard. Le compteur d'échecs part dans le message : deux échecs de suite ne se
// confondent plus avec un seul.

import { logConsole } from '../console.js';
import { register } from '../objects.js';
import { createForm } from './form.js';
import { UIRegistry } from './registry.js';

export const Panels = (function(){
  const live = new Map();   // id -> {descriptor, host, form, visible, failed}

  function register(descriptor){
    UIRegistry.declarePanel(descriptor);
    if(!live.has(descriptor.id)){
      live.set(descriptor.id, {descriptor: descriptor, host: null, form: null,
                               visible: true, failed: false, failures: 0});
    } else {
      // Redéclaration : on remplace le descripteur et on refera construire au prochain boot.
      const rec = live.get(descriptor.id);
      rec.descriptor = descriptor;
      rec.form = null;
      rec.failed = false;
      rec.booted = false;
    }
    return descriptor.id;
  }

  function placardError(id, host, title, err){
    const doc = host.ownerDocument || document;
    host.innerHTML = '';
    const box = doc.createElement('div');
    box.classList.add('panel-error');
    box.textContent = 'Le panneau « ' + (title || '?') + ' » n\'a pas pu s\'afficher : '
      + (err && err.message ? err.message : 'erreur inconnue');
    // Le bouton est la SEULE porte de sortie quand la cause était passagère : sans lui,
    // l'utilisateur n'a que le rechargement de la page pour retrouver un panneau vivant.
    const retryButton = doc.createElement('button');
    retryButton.className = 'panel-error-retry';
    retryButton.type = 'button';
    retryButton.textContent = 'Réessayer';
    retryButton.addEventListener('click', function(){ retry(id); });
    box.appendChild(retryButton);
    host.appendChild(box);
  }

  /** Un échec annoncé, à chaque fois — pas seulement au premier. */
  function reportFailure(rec, id, e){
    rec.failed = true;
    rec.failures = (rec.failures || 0) + 1;
    placardError(id, rec.host, rec.descriptor.title, e);
    logConsole('panneau « ' + id + ' » en échec (' + rec.failures + ') : ' + e.message, 'error');
    // Même quand la console de l'éditeur n'est pas chargée, la trace doit exister quelque part :
    // c'est précisément la classe de bugs « rien ne s'affiche nulle part » qu'on corrige ici.
    if(typeof console !== 'undefined' && console.error) console.error(e);
  }

  /**
   * Reconstruit un panneau tombé en échec. Rend `true` si la reconstruction a réussi.
   *
   * Appelée par le bouton du placard, et à chaque fois qu'un panneau retrouve un hôte neuf ou
   * redevient visible : ces trois moments sont ceux où la cause de l'échec a pu disparaître.
   */
  function retry(id){
    const rec = live.get(id);
    if(!rec || !rec.host) return false;
    rec.failed = false;
    rec.booted = false;
    buildOne(id, rec.host);
    if(!rec.failed){ rec.booted = true; rec.builtIn = rec.host; }
    return !rec.failed;
  }

  function buildOne(id, host){
    const rec = live.get(id);
    if(!rec) return;
    rec.host = host || rec.host;
    if(!rec.host) return;
    try {
      if(typeof rec.descriptor.build === 'function'){
        rec.descriptor.build(rec.host);
      } else if(rec.descriptor.sections){
        rec.form = createForm(rec.host, rec.descriptor);
        rec.form.setTargets(rec.descriptor.targets ? rec.descriptor.targets() : []);
      }
      // SANS `sections` NI `build`, ON NE TOUCHE À RIEN. Un panneau qui ADOPTE un élément déjà
      // écrit dans la page (la vue 3D, la hiérarchie, le panneau Projet) n'a pas de formulaire :
      // lui en fabriquer un vidait son hôte — `createForm` commence par `host.innerHTML = ''` —
      // et emportait le canvas, le gizmo de vue et le cadre du mode Lecture avec.
      // Symptôme mesuré : `loop()` levait une TypeError sur `#view-game-frame` disparu, à
      // chaque image.
      rec.failed = false;
      UIRegistry.resolve(id, {host: rec.host, visible: rec.visible,
                              minWidth: rec.descriptor.minWidth, minHeight: rec.descriptor.minHeight});
    } catch(e){
      rec.form = null;
      reportFailure(rec, id, e);
    }
  }

  /**
   * Construit tout ce qui a un hôte et n'est pas encore construit. `hosts` : {id: element}.
   *
   * RÉENTRANT : on peut l'appeler autant de fois qu'on veut, et à n'importe quel moment. Un
   * panneau déjà construit (`rec.booted`) est laissé tel quel — sinon rappeler `boot()` après
   * l'enregistrement d'un plugin détruirait tous les panneaux déjà en place.
   */
  function boot(hosts){
    const map = hosts || {};
    Object.keys(map).forEach(function(id){
      const rec = live.get(id);
      if(rec) rec.host = map[id];
    });
    live.forEach(function(rec, id){
      // Un hôte REMPLACÉ (l'inspecteur reconstruit son corps par innerHTML) rend le panneau
      // à reconstruire : ses éléments d'avant ne sont plus dans le document.
      const hostNeuf = rec.builtIn !== rec.host;
      if(rec.booted && map[id] && hostNeuf) rec.booted = false;
      // Un hôte NEUF efface l'échec : la construction d'avant a échoué dans un autre élément,
      // et rien ne dit qu'elle échouerait ici. Sans ça, un panneau tombé une fois restait vide
      // même après que le dock lui ait donné une zone toute neuve.
      if(rec.failed && hostNeuf) rec.failed = false;
      if(rec.failed || rec.booted || !rec.host) return;
      buildOne(id, rec.host);
      rec.booted = true;
      rec.builtIn = rec.host;
    });
  }

  function syncAll(){
    live.forEach(function(rec, id){
      if(rec.failed || !rec.visible || !rec.host) return;
      try {
        if(typeof rec.descriptor.sync === 'function') rec.descriptor.sync();
        else if(rec.form){
          rec.form.setTargets(rec.descriptor.targets ? rec.descriptor.targets() : []);
          rec.form.sync();
        }
      } catch(e){
        reportFailure(rec, id, e);
      }
    });
  }

  return {
    register: register,
    boot: boot,
    syncAll: syncAll,
    form: function(id){ const r = live.get(id); return r ? r.form : null; },
    // L'hôte DOM d'un panneau. Le dock en a besoin pour le DÉPLACER, et il ne doit pas le
    // déduire du DOM : un panneau adopté garde l'id de l'élément d'origine, pas celui du dock.
    hostOf: function(id){ const r = live.get(id); return r ? r.host : null; },
    failed: function(id){ const r = live.get(id); return !!(r && r.failed); },
    // Combien de fois ce panneau est tombé depuis le début de la session. Sert aux gardes, et
    // à distinguer « il est tombé une fois » de « il tombe à chaque synchronisation ».
    failures: function(id){ const r = live.get(id); return r ? (r.failures || 0) : 0; },
    retry: retry,
    setVisible: function(id, on){
      const r = live.get(id);
      if(!r) return;
      // Ré-afficher un panneau en échec le fait retenter : c'est le geste naturel de
      // l'utilisateur devant un panneau mort (le fermer, le rouvrir), et il ne servait à rien.
      if(!!on && !r.visible && r.failed && r.host) retry(id);
      r.visible = !!on;
      if(UIRegistry.resolved(id)) UIRegistry.resolve(id, {host: r.host, visible: r.visible});
    },
    visible: function(id){ const r = live.get(id); return !!(r && r.visible); }
  };
})();
