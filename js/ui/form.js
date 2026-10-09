// ---------- Couche DOM du formulaire ----------
// Elle APPLIQUE ce que js/ui/form-plan.js a calculé, et ne décide de rien.
//
// TROIS RÈGLES, chacune contre une panne mesurée dans l'inspecteur actuel :
//
//  1. On construit UNE FOIS. `sync()` recopie les valeurs dans les éléments existants ;
//     il ne refabrique rien. (Avant : `inspBody.innerHTML = html` à chaque changement.)
//  2. `sync()` ne touche jamais un champ dont la saisie est en cours — focus, valeur non
//     lisible, ou composition IME ouverte.
//  3. La reconstruction de FORME est DIFFÉRÉE tant qu'un champ a le focus, et le focus est
//     restauré ensuite sur le champ de même clé. C'était la vraie panne : plusieurs handlers
//     `input` appelaient `buildInspector()`, détruisant l'élément en cours de frappe.

import { logConsole } from '../console.js';
import { beginInteraction, endInteraction, pushHistory } from '../history.js';
import { planForm, writeField } from './form-plan.js';
import { Icons } from './icon.js';
import { UIRegistry } from './registry.js';

export function createForm(host, descriptor){
  const doc = host.ownerDocument || document;
  const byField = new Map();     // clé de champ -> {entry, els}
  let targets = [];
  let shape = null;
  let shapeDirty = false;
  let composing = false;

  function keyOf(entry){ return entry.ids.join('+'); }

  function focusedKey(){
    const active = doc.activeElement;
    if(!active) return null;
    for(const [k, rec] of byField){ if(rec.els.indexOf(active) !== -1) return k; }
    return null;
  }
  function anyFocused(){ return focusedKey() !== null; }

  // `writeTargets` : les cibles sur lesquelles CE champ écrit. C'est `targets` pour un champ
  // normal, et l'ÉLÉMENT DE LA LIGNE pour un sous-champ de liste — un sous-champ écrit sur sa
  // ligne, jamais sur l'objet entier.
  /** Le champ refuse la valeur, et DIT pourquoi : la bordure seule laisse chercher. */
  function marquerInvalide(els, raison){
    els.forEach(function(el){
      el.classList.add('invalid');
      el.setAttribute('title', raison);
    });
  }
  function demarquerInvalide(els){
    els.forEach(function(el){
      el.classList.remove('invalid');
      el.removeAttribute('title');
    });
  }

  function onInput(entry, els, writeTargets){
    const type = UIRegistry.fieldType(entry.type);
    const value = type.read(els);
    if(value === undefined){
      // Saisie en cours ou illisible : on n'écrit RIEN, et on le montre. La bordure seule ne
      // suffit pas — elle dit qu'il y a un problème, pas lequel : le titre dit lequel.
      marquerInvalide(els, "Cette saisie n'est pas lisible : rien n'a été écrit.");
      return;
    }
    demarquerInvalide(els);
    beginInteraction(keyOf(entry));
    // Même raison que le filet de writeField : un instantané d'historique qui lève ne doit pas
    // empêcher d'écrire le réglage. On perd l'annulation de CE geste, pas le geste.
    try { pushHistory(); } catch(e){
      logConsole('historique non enregistré : ' + e.message, 'error');
    }
    const res = writeField(entry.field, writeTargets || targets, value);
    if(res.failed){
      marquerInvalide(els, res.reason || "Cette valeur n'a pas pu être écrite.");
    }
    if(planForm(descriptor, targets).shape !== shape) shapeDirty = true;
  }

  // Pose UN champ dans `parent`, l'enregistre dans la table `champ -> éléments`, et branche ses
  // écouteurs. Partagé par les champs de section et les sous-champs de liste : ces derniers
  // DOIVENT entrer dans `byField` comme les autres, sinon `sync()` ne les met jamais à jour et
  // la règle « ne pas écraser une saisie en cours » ne s'applique pas là où on tape le plus.
  function buildField(entry, parent, writeTargets, sharedRow){
    const type = UIRegistry.fieldType(entry.type);
    if(!type) throw new Error('type de champ inconnu : ' + entry.type);
    // `sharedRow` : la ligne d'une section `layout:'inline'`, partagée par tous ses champs.
    const row = sharedRow || doc.createElement('div');
    if(!sharedRow) row.classList.add('field');
    if(entry.label && !sharedRow){
      const label = doc.createElement('label');
      label.textContent = entry.label;
      if(entry.help) label.setAttribute('title', entry.help);
      row.appendChild(label);
    }

    const els = type.create(entry, doc);
    // LE LIBELLÉ NOMME SON CHAMP. Il était posé À CÔTÉ du champ, sans `for` : aucun champ déclaratif
    // n'avait de nom accessible, et cliquer le libellé ne donnait pas le focus (revue du
    // 2026-09-29, § 4.5). Un champ à plusieurs cases (vec3, paire) nomme chacune en plus.
    if(entry.label && !sharedRow && els && els[0] && els[0].id){
      const lab = row.querySelector('label');
      if(lab) lab.htmlFor = els[0].id;
    }
    if(entry.label && els && els.length > 1){
      const axes = els.length === 3 ? ['X', 'Y', 'Z'] : ['1', '2'];
      els.forEach(function(el, i){
        if(el && el.setAttribute && !el.getAttribute('aria-label')) el.setAttribute('aria-label', entry.label + ' ' + axes[i]);
      });
    }
    // Un champ à plusieurs éléments (vec3, pair) garde son conteneur `.vec3` : c'est lui
    // qui les met sur une ligne dans la feuille de style de l'éditeur.
    let box = row;
    if(els.length > 1){
      box = doc.createElement('div');
      box.classList.add('vec3');
      row.appendChild(box);
    }
    els.forEach(function(el){
      if(entry.cssClass) el.classList.add(entry.cssClass);
      if(entry.reason) el.setAttribute('title', entry.reason);
      el.disabled = !entry.enabled;
      if(entry.reason) el.setAttribute('title', entry.reason);
      el.addEventListener('input', function(){ if(!composing) onInput(entry, els, writeTargets); });
      // `change` sur un <select> (ou une case) = interaction TERMINÉE, et pourtant l'élément
      // garde le focus : la garde `!anyFocused()` reportait alors la reconstruction jusqu'à ce
      // qu'on clique ailleurs. Choisir « Panorama (image) » dans le type de ciel ne faisait donc
      // apparaître AUCUN champ Image, et le réglage passait pour cassé. `rebuild()` reconstruit
      // en remettant le focus sur le même champ — on ne coupe personne.
      el.addEventListener('change', function(){ endInteraction(); if(shapeDirty) rebuild(); });
      el.addEventListener('blur', function(){ endInteraction(); if(shapeDirty && !anyFocused()) build(); });
      el.addEventListener('compositionstart', function(){ composing = true; });
      el.addEventListener('compositionend', function(){ composing = false; onInput(entry, els, writeTargets); });
      box.appendChild(el);
    });
    if(!sharedRow) parent.appendChild(row);
    byField.set(keyOf(entry), {entry: entry, els: els});
    type.write(els, entry.value, entry.mixed);
    els.forEach(function(el){ el.classList.toggle('mixed', !!entry.mixed); });
  }

  // Un bouton d'action (bouton de section, ajout ou retrait d'une ligne de liste) : un
  // instantané d'historique, la mutation, et la forme marquée à refaire.
  function buildAction(id, label, enabled, reason, run, parent, icon){
    const btn = doc.createElement('button');
    // `ui-btn` : le style du design system (css/components.css). Les boutons des formulaires n'avaient
    // aucune classe, et l'inspecteur d'objet ne ressemblait pas à l'inspecteur d'asset (§ 4.17).
    btn.classList.add('ui-btn');
    if(id) btn.id = id;
    // Le descripteur porte un NOM d'icône, jamais du markup : `panels-components.js` est une
    // couche de données PURES, et le libellé se pose ici par texte — du HTML passé en `label`
    // s'afficherait en toutes lettres. L'icône est donc construite en élément, ici.
    if(icon && typeof Icons !== 'undefined') btn.appendChild(Icons.el(icon));
    btn.appendChild(doc.createTextNode(label));
    btn.disabled = !enabled;
    if(reason) btn.setAttribute('title', reason);
    btn.addEventListener('click', function(){
      if(!enabled) return;
      beginInteraction(id || 'action');
      pushHistory();
      run();
      endInteraction();
      shapeDirty = true;
      if(!anyFocused()) build();
    });
    parent.appendChild(btn);
    return btn;
  }

  /**
   * Une entrée du plan devient du DOM. Récursive : une ligne de liste peut elle-même
   * porter une liste — les ACTIONS d'un événement — et c'est le MÊME rendu qui s'applique.
   */
  function buildEntry(entry, host, targets, inlineRow){
    if(entry.kind === 'subsection'){
      const el = doc.createElement('div');
      el.classList.add('sec');
      el.textContent = entry.title;
      host.appendChild(el);
      return;
    }
    if(entry.kind === 'note'){
      const el = doc.createElement('div');
      el.classList.add('ip-note');
      el.textContent = entry.text;
      host.appendChild(el);
      return;
    }
    if(entry.kind === 'action'){
      buildAction(entry.ids[0], entry.label, entry.enabled, entry.reason,
                  function(){ entry.run(targets[0], targets); }, host, entry.icon);
      return;
    }
    if(entry.kind === 'list'){
      const bloc = doc.createElement('div');
      bloc.classList.add('field-list');
      if(entry.ids && entry.ids[0]) bloc.id = entry.ids[0];
      if(entry.label){
        const head = doc.createElement('div');
        head.classList.add('sec2');
        head.textContent = entry.label;
        bloc.appendChild(head);
        if(entry.onAdd){
          buildAction(null, entry.addLabel, entry.enabled, entry.reason,
                      function(){ entry.onAdd(targets[0]); }, head);
        }
      }
      entry.rows.forEach(function(row){
        const ligne = doc.createElement('div');
        ligne.classList.add('list-row');
        // Un sous-champ écrit sur SON élément de ligne, pas sur la cible du panneau.
        row.entries.forEach(function(sub){ buildEntry(sub, ligne, [row.item], null); });
        if(entry.onRemove){
          buildAction(null, '×', entry.enabled, entry.reason,
                      function(){ entry.onRemove(targets[0], row.index); }, ligne);
        }
        bloc.appendChild(ligne);
      });
      host.appendChild(bloc);
      return;
    }
    buildField(entry, host, targets, inlineRow);
  }

  function build(){
    host.innerHTML = '';
    byField.clear();
    const plan = planForm(descriptor, targets);
    shape = plan.shape;
    shapeDirty = false;

    plan.sections.forEach(function(section){
      if(section.title){
        const head = doc.createElement('div');
        head.classList.add('sec');
        head.textContent = section.title;
        host.appendChild(head);
      }
      // Une section en ligne : UNE seule `.field`, et tous ses champs dedans.
      let inlineRow = null;
      if(section.layout === 'inline'){
        inlineRow = doc.createElement('div');
        inlineRow.classList.add('field');
        inlineRow.classList.add('field-name');
        const lab = doc.createElement('label');
        const premier = section.entries.find(function(e){ return e.kind === 'field'; });
        lab.textContent = premier ? premier.label : '';
        inlineRow.appendChild(lab);
        host.appendChild(inlineRow);
      }
      section.entries.forEach(function(entry){
        buildEntry(entry, host, targets, inlineRow);
      });
    });
  }

  // `selectionStart` n'existe QUE sur les champs texte : y toucher sur une case à cocher, un
  // <select> ou un input color lève `InvalidStateError` (mesuré dans Chrome). Le caret était
  // lu et réécrit sans distinction — reconstruire depuis un de ces champs levait donc, et la
  // reconstruction n'avait jamais lieu : choisir « Panorama » laissait les champs du dégradé
  // à l'écran. Rien à restaurer sur ces types : ils n'ont pas de curseur.
  const TYPES_AVEC_CARET = ['text', 'search', 'url', 'tel', 'password'];
  function aUnCaret(el){
    if(!el) return false;
    if(el.tagName === 'TEXTAREA') return true;
    return el.tagName === 'INPUT' && TYPES_AVEC_CARET.indexOf(el.type) !== -1;
  }

  function rebuild(){
    const keep = focusedKey();
    const elAvant = keep ? byField.get(keep).els[0] : null;
    const caret = aUnCaret(elAvant) ? elAvant.selectionStart : null;
    build();
    if(keep && byField.has(keep)){
      const el = byField.get(keep).els[0];
      el.focus();
      if(caret !== null && aUnCaret(el)) el.selectionStart = el.selectionEnd = caret;
    }
  }

  function sync(){
    const plan = planForm(descriptor, targets);
    if(plan.shape !== shape){
      // La forme a changé. Si un champ est en cours de saisie, on ATTEND — sinon on coupe
      // la frappe exactement comme le faisait l'ancien inspecteur.
      if(anyFocused()){ shapeDirty = true; return; }
      rebuild();
      return;
    }
    const active = doc.activeElement;
    plan.sections.forEach(function(section){
      // `sync()` ne CONSTRUIT rien : il recopie des valeurs dans des éléments qui existent.
      // Une ligne de section fabriquée ici s'empilait à chaque synchronisation — soixante
      // « Nom » par seconde pendant un glissement de gizmo.
      section.entries.forEach(function(entry){
        if(entry.kind !== 'field') return;
        const rec = byField.get(keyOf(entry));
        if(!rec) return;
        if(rec.els.indexOf(active) !== -1) return;        // règle 2 : focus
        if(composing) return;                             // règle 2 : IME
        const type = UIRegistry.fieldType(entry.type);
        // Règle 2, dernier cas : une SAISIE en cours qu'on ne sait pas relire (« 1.2e », « - »).
        // Elle ne vaut que là où l'on saisit. `el.value !== undefined` est ce qui le dit : un
        // `<span>` n'en a pas. Sans ce garde-fou, `String(undefined)` donnait « undefined » —
        // jamais vide — et la règle gelait DÉFINITIVEMENT tout champ `info`, dont le `read` rend
        // `undefined` par définition (« rien à relire »). Or `info` est précisément le seul type
        // dont la valeur ne peut changer QUE par une synchronisation.
        // Mesuré sur le panneau d'exemples/plugin-evaveo-studio.js : son champ « État » restait
        // sur « Export demandé au Studio… » pour toujours, pendant que la barre d'état de
        // l'éditeur affichait la bonne valeur. Deux affichages de la même chose, l'un mort.
        const typing = rec.els.some(function(el){
          return el.value !== undefined && String(el.value).trim() !== '';
        });
        if(type.read(rec.els) === undefined && typing) return;
        type.write(rec.els, entry.value, entry.mixed);
        rec.els.forEach(function(el){
          el.classList.toggle('mixed', !!entry.mixed);
          el.disabled = !entry.enabled;
        });
      });
    });
  }

  build();

  return {
    // `setTargets` est rappelé à CHAQUE synchronisation de panneau : reconstruire à chaque
    // fois détruirait le champ en cours de saisie soixante fois par seconde. On ne
    // reconstruit donc que si la FORME change, et jamais pendant une saisie.
    setTargets: function(list){
      // MUTATION EN PLACE, jamais de réaffectation. Chaque champ capture `targets` (le TABLEAU,
      // pas son contenu) dans la fermeture de son écouteur `input` à la construction du DOM
      // (`buildField` → `writeTargets`), et `setTargets` ne reconstruit RIEN tant que la forme du
      // panneau ne change pas (juste en dessous). `targets = list || []` remplaçait la variable
      // par un NOUVEAU tableau : les écouteurs déjà posés gardaient l'ANCIEN, à jamais orphelin
      // dès que la forme ne changeait pas — la cible écrite restait celle du tout premier build.
      // Symptôme mesuré : le panneau Environnement affichait bien l'`env` d'un projet rechargé
      // (la LECTURE suit `targets` à jour via `planForm`), mais toute saisie n'avait aucun effet
      // (l'ÉCRITURE visait l'`env` d'avant le chargement). Muter le même tableau tient les deux
      // à jour, sans rien changer au reste du contrat de `setTargets`.
      targets.length = 0;
      (list || []).forEach(function(t){ targets.push(t); });
      const next = planForm(descriptor, targets).shape;
      if(next !== shape){
        if(anyFocused()){ shapeDirty = true; return; }
        rebuild();
      }
    },
    targets: function(){ return targets.slice(); },
    sync: sync,
    rebuild: rebuild,
    shape: function(){ return shape; }
  };
}
