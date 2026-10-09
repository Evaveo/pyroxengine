// ---------- Événements visuels « Quand… Alors… » (sans code) ----------
// Chaque objet porte userData.events = [{when, param, actions:[{type, target, value}]}].
// Édités dans l'inspecteur, exécutés en mode lecture (et dans les builds Web).
// Ils partagent le bus d'événements et les minuteries des scripts : un script peut
// émettre un événement écouté visuellement, et inversement.
// Les LIBELLÉS des « Quand » et des « Alors » sont partis avec la vue :
// js/ui/panels-components.js. Ce fichier n'a plus que l'exécution.

// `readSettingParam` vit dans js/animator.js — fichier PARTAGÉ avec le runtime. Deux
// lectures divergentes de « vitesse = 1 » donneraient un jeu publié qui ne réagit pas comme
// l'éditeur, et ça ne se verrait qu'après export.

// ---------- moteur d'exécution (éditeur) ----------
import { playerAnimatorOf } from './anim-models.js';
import { playSoundGlobal } from './audio.js';
import { Registry } from './component-registry.js';
import { indexByTag } from './components/component-tag.js';
import { logConsole } from './console.js';
import { setStatus } from './hierarchy.js';
import { objects } from './objects.js';
import { emitBurst } from './particles.js';
import { project } from './project.js';
import { engineScripts } from './scripts.js';

export const evtGame = {states:new Map(), demarres:false};

// L'affichage d'un objet, lu et écrit correctement même s'il est regroupé dans un lot
// d'instances (js/render-perf.js). Le repli n'est pas une dégradation : sans ce module, rien
// n'est regroupé, et `visible` EST l'intention.
function visible(o){
  return (typeof visibleIntent === 'function') ? visibleIntent(o) : (o.visible !== false);
}
function setVisible(o, v){
  if(typeof setVisibleIntent === 'function') setVisibleIntent(o, v); else o.visible = v;
}

export function initEventsVisuals(){
  evtGame.states = new Map();
  evtGame.demarres = false;
  // abonnements « à la réception d'un événement » sur le bus des scripts.
  // Porteurs lus au Registry (composant Events) : avant, toute la scène était
  // balayée pour trouver les quelques objets qui portent des règles.
  Registry.activeNodes('Events').forEach(function(o){
    (o.userData.events || []).forEach(function(ev){
      if(ev.when === 'event' && (ev.param || '').trim()){
        const name = ev.param.trim();
        (engineScripts.ecouteurs[name] = engineScripts.ecouteurs[name] || [])
          .push(function(){ runActionsVisual(o, ev.actions, 0); });
      }
    });
  });
}

export function stopEventsVisuals(){
  evtGame.states = new Map();
  evtGame.demarres = false;
}

export function targetAction(o, name){
  if(!name) return o;
  return objects.find(function(x){ return x.name === name; }) || null;
}

export function runActionsVisual(o, actions, depuis){
  for(let i = depuis; i < (actions || []).length; i++){
    const ac = actions[i];
    const target = targetAction(o, (ac.target || '').trim());
    switch(ac.type){
      // `setVisibleIntent` et pas `target.visible` : sur un objet regroupé dans un lot
      // d'instances, écrire `visible` ne fait RIEN — le lot continue de le dessiner, et la
      // valeur écrite disparaît à la reconstruction suivante. Une action « cacher » sur un
      // objet de décor n'aurait donc eu aucun effet, sans la moindre erreur. `typeof` parce que
      // js/render-perf.js est retirable d'un jeu allégé : sans lui, rien n'est regroupé et
      // écrire `visible` redevient exactement juste.
      case 'montrer': if(target) setVisible(target, true); break;
      case 'hide':    if(target) setVisible(target, false); break;
      case 'toggle':  if(target) setVisible(target, !visible(target)); break;
      case 'destroy':
        if(target && engineScripts.aDestroy.indexOf(target) === -1) engineScripts.aDestroy.push(target);
        break;
      case 'emit': {
        const name = (ac.value || '').trim();
        (engineScripts.ecouteurs[name] || []).forEach(function(fn){
          try{ fn(); } catch(e){ logConsole('error', 'événement « ' + name + ' » : ' + e.message, o); }
        });
        break;
      }
      case 'jouerSon': playSoundGlobal((ac.value || '').trim(), undefined, o); break;
      case 'burstParticules':
        if(target && target.getComponent && target.getComponent('Particles'))
          emitBurst(target, parseInt(ac.value, 10) || undefined);
        else logConsole('warn', 'événement : « ' + ((ac.target || '').trim() || o.name)
          + ' » n\'est pas un émetteur de particules', o);
        break;
      case 'status': setStatus(String(ac.value || ''), 2500); break;
      case 'parametreAnim': {
        const setting = readSettingParam(ac.value);
        if(!setting){
          logConsole('warn', 'Régler le paramètre : rien à régler (attendu « vitesse = 1 » '
            + 'ou « saute »)', o);
          break;
        }
        // La cible par défaut est l'objet PORTEUR de l'événement, comme partout ailleurs ici.
        const onQui = target || o;
        const player = playerAnimatorOf(onQui);
        if(!player){
          logConsole('warn', '« ' + onQui.name + ' » n\'a pas de machine à états : le '
            + 'paramètre « ' + setting.name + ' » ne va nulle part', o);
          break;
        }
        // `setParamAnimator` refuse un paramètre non déclaré. On le DIT : un réglage qui
        // ne pilote rien se cherche du côté des transitions, alors que la faute est ici.
        if(!setParamAnimator(player, setting.name, setting.value)){
          logConsole('warn', 'La machine de « ' + onQui.name + ' » ne déclare aucun '
            + 'paramètre « ' + setting.name + ' »', o);
        }
        break;
      }
      case 'changerScene': {
        const idx = project.scenes.findIndex(function(s){ return s.name === (ac.value || '').trim(); });
        if(idx === -1) logConsole('warn', 'événement : scène « ' + ac.value + ' » introuvable', o);
        else engineScripts.sceneDemandee = idx;
        return;
      }
      // Une action que ni l'éditeur ni le jeu ne savent faire (nom ancien, faute de frappe) : on le
      // DIT. Le `switch` n'avait pas de `default` — l'action était enregistrée, publiée, puis
      // ignorée partout sans un mot (revue du 2026-09-29, § 1.6).
      default:
        logConsole('warn', 'événement : action inconnue « ' + ac.type + ' » — ignorée', o);
        break;
      case 'wait': {
        const reste = i + 1;
        engineScripts.minuteries.push({
          t: engineScripts.time + (parseFloat(ac.value) || 0),
          fn: function(){ runActionsVisual(o, actions, reste); },
          obj: o
        });
        return;   // la suite reprendra après le délai
      }
    }
  }
}

export const _evbA = new THREE.Box3(), _evbB = new THREE.Box3();
export function runEventsVisuals(){
  if(!evtGame.demarres){
    evtGame.demarres = true;
    objects.slice().forEach(function(o){
      (o.userData.events || []).forEach(function(ev){
        if(ev.when === 'startup') runActionsVisual(o, ev.actions, 0);
      });
    });
  }
  // Triggers d'entrée / sortie, par recouvrement de boîtes englobantes.
  //
  // Deux coûts ont été mesurés puis supprimés ici :
  //  - « objets.indexOf(o) » à l'intérieur d'une boucle sur objets, soit du
  //    O(n²) qui tournait même quand AUCUN objet ne portait d'événement :
  //    0,9 % du budget d'image à 2000 objets, pour rien ;
  //  - un parcours de toute la scène POUR CHAQUE trigger : 9,9 % du budget avec
  //    seulement vingt zones, ce qui n'a rien d'excessif pour un vrai game.
  // On repère d'abord les porteurs d'événements, puis on indexe les cibles par
  // tag une seule fois. Même correctif que evaluateContacts dans js/scripts.js.
  // Les porteurs de règles : une interrogation du Registry, plus un balayage.
  // Le commentaire ci-dessus décrit le O(n²) déjà supprimé une première fois par
  // ce pré-calcul ; le Registry en retire le dernier parcours complet, celui qui
  // tournait même quand AUCUN objet ne portait d'événement.
  const porteurs = Registry.activeNodes('Events')
    .filter(function(o){ const e = o.userData.events; return e && e.length; });
  if(!porteurs.length) return;

  const byTag = indexByTag();

  porteurs.forEach(function(o){
    const evs = o.userData.events;
    for(let ei = 0; ei < evs.length; ei++){
      const ev = evs[ei];
      if(ev.when !== 'entreeTrigger' && ev.when !== 'sortieTrigger') continue;
      const targets = byTag.get((ev.param || 'joueur').trim());
      if(!targets || !targets.length) continue;
      _evbA.setFromObject(o);
      if(_evbA.isEmpty()) continue;
      for(let k = 0; k < targets.length; k++){
        const autre = targets[k];
        if(autre === o) continue;
        const key = o.id + ':' + ei + ':' + autre.id;
        _evbB.setFromObject(autre);
        const dedans = !_evbB.isEmpty() && _evbA.intersectsBox(_evbB);
        const avant = evtGame.states.get(key) || false;
        if(dedans !== avant){
          evtGame.states.set(key, dedans);
          if(dedans && ev.when === 'entreeTrigger') runActionsVisual(o, ev.actions, 0);
          if(!dedans && ev.when === 'sortieTrigger') runActionsVisual(o, ev.actions, 0);
        }
      }
    }
  });
}


// L'ÉDITION des règles est un descripteur : js/ui/panels-components.js (composant Events).

