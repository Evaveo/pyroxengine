// ---------- Le graphe de machine à états, dans sa FENÊTRE ----------
//
// POURQUOI UNE FENÊTRE. Un graphe a besoin de hauteur : mesuré à 1600×900, le panneau du bas
// fait 1320×168, trois fois trop court pour empiler des états. La première réponse a été de
// prendre la place de la vue 3D — ce qui réglait la hauteur et créait un problème pire : on
// câblait une transition sans jamais voir son effet sur le personnage. Une fenêtre flottante
// (js/windows.js) donne la hauteur ET garde la vue, comme `Window ▸ Animator` d'Unity.
//
// La hiérarchie reste à gauche et l'inspecteur à droite : on clique un état, ses propriétés
// s'éditent dans l'inspecteur, comme n'importe quel objet. Aucun vocabulaire d'interface à
// apprendre en plus.
//
// La géométrie (placement, tracé des links, ce qu'on a sous le curseur) vit dans
// js/animator-graph-geo.js — c'est du calcul, donc éprouvé hors navigateur. Ici, rien que du
// DOM et des écouteurs.

import { clipsOf, playerAnimatorOf, previewAnimator, stopAnimator, togglePreviewAnimator } from './anim-models.js';
import { centerState, disposeStates, extentGraph, rankOfLink, stateSubPoint, traceLink, traceLoop } from './animator-graph-geo.js';
import { assetInDrag, assets } from './assets.js';
import { setStatus } from './hierarchy.js';
import { pushHistory } from './history.js';
import { buildInspector } from './inspector.js';
import { escapeHtml, objects } from './objects.js';
import { selection } from './selection.js';
import { openPanelDock } from './ui.js';
import { Dock } from './ui/dock.js';
import { loop } from './viewport.js';

export const graphAnim = {
  asset: null,          // l'asset animator en cours d'édition
  node: null,          // l'objet dont on édite la machine (pour relire ses clips)
  stateSel: null,        // l'état sélectionné, ou null
  transSel: null,       // la transition sélectionnée, ou null
  glisse: null,         // {etat, dx, dy} pendant un déplacement
  link: null            // {depuis, x, y} pendant la création d'une transition
};

export function machineOfGraph(){ return graphAnim.asset ? graphAnim.asset.machine : null; }

/**
 * Ouvre (ou referme) la FENÊTRE Animator — `Window ▸ Animator` d'Unity.
 *
 * Le graphe prenait la place de la vue 3D. Le motif d'alors — « un graphe a besoin de hauteur,
 * et le panneau du bas est trois fois trop court » — reste vrai, mais la conclusion était
 * fausse : ce qu'il fallait, c'est une fenêtre qu'on dimensionne, pas la confiscation de la
 * seule zone où l'on voit le personnage. On câble une transition ET on regarde son effet.
 *
 * Plus aucun appelant dans moteur/js : gardée parce que `help-content.js` la documente comme
 * atteignable depuis l'API de script. Limite connue si un futur appelant l'invoque sur un
 * panneau DOCKÉ : elle le ferme au lieu de le mettre au premier plan, contrairement à l'action
 * générique du menu Fenêtres qui, elle, sait le faire.
 */
export function toggleViewAnimator(toAnimator){
  if(typeof Dock === 'undefined') return;
  const veut = (toAnimator === undefined) ? !Dock.open('animator') : !!toAnimator;
  if(!veut){ Dock.close('animator'); updateTabsView(); return; }
  const c = (typeof selection !== 'undefined' && selection && selection.getComponent)
    ? selection.getComponent('AnimatorController') : null;
  if(c && c.asset){ graphAnim.asset = c.asset; graphAnim.node = selection; }
  openPanelDock('animator');
  updateTabsView();
  drawGraph();
}

/**
 * Ouvre la fenêtre Animator SUR UN ASSET, sans passer par un objet de la scène.
 *
 * C'est le geste d'Unity : on double-clique le contrôleur dans le panneau Projet et il s'ouvre.
 * La fenêtre édite un ASSET — la machine, ses états, ses paramètres — et pas l'objet
 * sélectionné ; ce dernier ne sert qu'à deux choses, savoir quels clips existent et montrer
 * l'état joué. Faire dépendre l'ouverture d'une sélection obligeait à poser un composant sur un
 * objet avant de pouvoir seulement REGARDER une machine.
 */
export function openAnimatorOnAsset(asset){
  if(!asset || asset.kind !== 'animator') return;
  graphAnim.asset = asset;
  // Un porteur de CETTE machine, s'il y en a un dans la scène : il donne les clips et l'état
  // current. Sinon on ouvre quand même, avec un graphe qui se lit mais ne se prévisualise pas.
  const holder = (typeof objects !== 'undefined') ? objects.find(function(o){
    return o.userData && o.userData.animator && o.userData.animator.assetId === asset.id;
  }) : null;
  graphAnim.node = holder || null;
  graphAnim.stateSel = null;
  graphAnim.transSel = null;
  openPanelDock('animator');
  updateTabsView();
  drawGraph();
  buildInspector();
}

/**
 * L'onglet au-dessus de la vue reflète l'état de la fenêtre — il ne la remplace plus.
 *
 * Trois onglets désormais, et un seul active : « Scène » l'est quand ni l'Animator ni l'espace
 * 2D ne le sont. Les laisser s'allumer ensemble laisserait croire qu'on regarde deux choses.
 */
export function updateTabsView(){
  // La barre d'onglets au-dessus de la vue a disparu (v0.91.0) : l'Animator est une FENÊTRE,
  // et c'est le menu Fenêtres qui coche son état. La fonction reste — une dizaine d'appelants
  // la nomment — et ne fait plus rien, plutôt que de laisser autant de gardes `typeof`.
}

/** Le graphe est-il visible ? Dock répond — docké, flottant ou poppé, peu importe. */
export function viewAnimatorActive(){
  return typeof Dock !== 'undefined' && Dock.open('animator');
}

/** Les noms de clips que la cible sait play — pour signaler un état qui aims un clip absent. */
export function clipsOfGraph(){
  const c = (graphAnim.node && graphAnim.node.getComponent)
    ? graphAnim.node.getComponent('AnimatorController') : null;
  const target = c ? c.target : null;
  return (target && typeof clipsOf === 'function') ? clipsOf(target).map(function(x){ return x.name; }) : [];
}

/**
 * Ce qu'une boîte affiche pour son animation, et si elle est jouable.
 *
 * Trois cas, et le troisième est celui qui doit se voir : l'asset d'animation (cas current),
 * l'ancien nom de clip (machine non migrée, ça joue encore), et le trou — asset supprimé, ou
 * clip absent du modèle. Sans le signalement, un état muet ressemble à un état qui marche.
 */
export function animOfBox(holder, clips){
  if(holder && holder.animation){
    const a = assets.find(function(x){ return x.id === holder.animation && x.kind === 'animation'; });
    if(!a) return {ok:false, caption:'— animation supprimée —'};
    const clipOk = !clips.length || clips.indexOf((a.source || {}).clip) !== -1;
    return {ok:clipOk, caption:(clipOk ? '' : '⚠ ') + a.name};
  }
  if(holder && holder.clip){
    const ok = !clips.length || clips.indexOf(holder.clip) !== -1;
    return {ok:ok, caption:holder.clip};
  }
  return {ok:false, caption:'— aucune animation —'};
}

export function drawGraph(){
  const zStates = document.getElementById('graph-states');
  const svg = document.getElementById('graph-links');
  const bar = document.getElementById('graph-title');
  if(!zStates || !svg) return;
  const m = machineOfGraph();
  if(!m){
    zStates.innerHTML = '<div class="graph-empty">Sélectionnez un objet qui porte un '
      + '<b>AnimatorController</b>, ou créez une machine depuis le panneau Projet : '
      + '<b>＋ Créer ▸ 🔀 Animator</b>.</div>';
    svg.innerHTML = '';
    if(bar) bar.textContent = '';
    if(typeof mountInspectorGraphAnimator === 'function') mountInspectorGraphAnimator();
    return;
  }
  // Le sélecteur de machine dans la bar : on pass d'un contrôleur à l'autre sans revenir
  // chercher un objet dans la scène. Même bandeau que l'éditeur de machine en JSON et que les
  // deux autres fenêtres d'édition (script, graphe de shader).
  if(bar){
    const machines = assets.filter(function(x){ return x.kind === 'animator'; });
    bar.innerHTML = '<select id="graph-file" title="Machine à états éditée">'
      + machines.map(function(a){
          return '<option value="' + a.id + '"' + (a === graphAnim.asset ? ' selected' : '')
            + '>' + escapeHtml(a.name) + '</option>';
        }).join('') + '</select>';
  }

  const zone = document.getElementById('graph-zone');
  disposeStates(m, zone ? zone.clientWidth : 900);
  const extent = extentGraph(m);
  svg.setAttribute('width', extent.width);
  svg.setAttribute('height', extent.height);
  zStates.style.width = extent.width + 'px';
  zStates.style.height = extent.height + 'px';

  drawParams(m);
  const clips = clipsOfGraph();
  const byName = {};
  (m.states || []).forEach(function(e){ if(e && e.name) byName[e.name] = e; });

  // --- les links, sous les boîtes ---
  let d = '<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7"'
    + ' markerHeight="7" orient="auto-start-reverse">'
    + '<path d="M0,0 L10,5 L0,10 z" fill="#7d8794"/></marker>'
    + '<marker id="arrow-sel" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7"'
    + ' markerHeight="7" orient="auto-start-reverse">'
    + '<path d="M0,0 L10,5 L0,10 z" fill="#5aa9e6"/></marker></defs>';
  (m.transitions || []).forEach(function(t, i){
    if(!t) return;
    const sel = (t === graphAnim.transSel);
    // Une transition « depuis partout » n'a pas d'état de départ à relier : elle est dessinée
    // comme une flèche entrante courte, sinon il faudrait inventer un nœud « * » flottant.
    const dep = (t.de === '*') ? null : byName[t.de];
    const arr = byName[t.vers];
    if(!arr) return;
    let g;
    if(!dep && t.de === '*'){
      const c = centerState(arr);
      g = {ax: c.x - 90, ay: c.y - 70, bx: c.x, by: (arr.y || 0), cx: c.x - 60, cy: c.y - 60};
    } else if(!dep){ return; }
    else if(dep === arr){ g = traceLoop(arr); }
    else { g = traceLink(dep, arr, rankOfLink(m.transitions, i), m.states); }
    const path = 'M' + g.ax + ',' + g.ay + ' Q' + g.cx + ',' + g.cy + ' ' + g.bx + ',' + g.by;
    // La cible cliquable RÉELLE : posée sous le trait visible, elle seule décide si le curseur
    // est « sur » la transition. Même patron que .ge-cable-hit (graphe de shader) — voir la
    // règle CSS .link-hit. Sans elle, cliquer un trait de 1,6px échoue neuf fois sur dix.
    d += '<path class="link-hit" data-ti="' + i + '" d="' + path + '"/>';
    d += '<path class="link' + (sel ? ' sel' : '') + '" data-ti="' + i + '"'
      + ' d="' + path + '"'
      + ' marker-end="url(#' + (sel ? 'arrow-sel' : 'arrow') + ')"/>';
    if(t.de === '*'){
      d += '<text class="link-tag" x="' + (g.ax - 4) + '" y="' + (g.ay + 4) + '">∗</text>';
    }
  });
  // Le link en cours de création suit le curseur : sans ce retour, on tire dans le vide et on
  // ne sait pas si le geste a été compris.
  if(graphAnim.link){
    const c = centerState(graphAnim.link.depuis);
    d += '<path class="link temp" d="M' + c.x + ',' + c.y + ' L'
      + graphAnim.link.x + ',' + graphAnim.link.y + '"/>';
  }
  svg.innerHTML = d;

  // --- les boîtes ---
  let h = '';
  (m.states || []).forEach(function(e, i){
    if(!e) return;
    const start = (m.start || ((m.states[0] || {}).name)) === e.name;
    const sel = (e === graphAnim.stateSel);
    // Un état de mélange dit ce qui le pilote et combien de clips il dose. Lui laisser la ligne
    // du clip simple afficherait « — aucun clip — » sur un état qui en joue trois.
    const blend = (typeof isStateBlend === 'function') && isStateBlend(e);
    const pts = blend ? (e.blend.points || []) : [];
    const dAnim = blend ? null : animOfBox(e, clips);
    const clipManquant = blend
      ? !!(clips.length && pts.some(function(p){ return p && !animOfBox(p, clips).ok; }))
      : !dAnim.ok;
    const caption = blend
      ? ('◈ ' + (e.blend.param || '(sans paramètre)') + ' · ' + pts.length
         + (pts.length > 1 ? ' clips' : ' clip'))
      : dAnim.caption;
    const current = stateCurrentOfGraph() === e.name;
    h += '<div class="graph-state' + (sel ? ' sel' : '') + (start ? ' start' : '')
      + (current ? ' current' : '') + '" data-ei="' + i + '"'
      + ' style="left:' + (e.x || 0) + 'px;top:' + (e.y || 0) + 'px">'
      + '<div class="ge-name">' + escapeHtml(e.name || '(sans nom)') + '</div>'
      + '<div class="ge-clip' + (clipManquant ? ' missing' : '') + '">'
      + escapeHtml(caption) + '</div>'
      + '<div class="ge-handle" title="Tirer vers un autre état pour créer une transition">→</div>'
      + '</div>';
  });
  zStates.innerHTML = h;

  // Les propriétés de ce qui vient d'être sélectionné, DANS la fenêtre (colonne de droite).
  // `typeof` et pas un `import` : ui/panels-components.js importe déjà ce fichier, l'importer en
  // retour fermerait un cycle — voir mountInspectorGraphAnimator pour le détail.
  if(typeof mountInspectorGraphAnimator === 'function') mountInspectorGraphAnimator();
}

/**
 * Les paramètres, réglables EN DIRECT pendant l'aperçu.
 *
 * C'est ce qui rend une machine éprouvable sans rien câbler : on pousse « vitesse » à 1 et on
 * regarde si la transition part. Sans ce panneau, il faudrait poser un événement sur un objet,
 * lancer le jeu, et deviner ce qui a échoué entre le réglage, la condition et le clip.
 */
export function drawParams(m){
  const zone = document.getElementById('graph-params');
  if(!zone) return;
  const params = (m && m.params) || [];
  const player = (graphAnim.node && typeof playerAnimatorOf === 'function')
    ? playerAnimatorOf(graphAnim.node) : null;
  if(!params.length){
    zone.innerHTML = '<span class="gp-empty">Aucun paramètre — rien à tester dans une '
      + 'transition.</span>'
      + '<button class="gp-plus" data-add-param="1">＋ Paramètre</button>';
    return;
  }
  zone.innerHTML = params.map(function(p, i){
    if(!p || !p.name) return '';
    const v = player ? player.params[p.name] : p.defaultValue;
    // Chaque paramètre porte sa croix : c'est le panneau Parameters d'Unity, où l'on ajoute et
    // retire sans passer par le JSON. Jusqu'ici il fallait ouvrir le fichier à la main, ce qui
    // veut dire connaître le format — et ce panneau existe justement pour ne pas avoir à.
    const croix = '<button class="gp-x" data-del-param="' + i + '" title="Retirer ce paramètre">×</button>';
    if(p.type === 'trigger'){
      return '<span class="gp-block"><button class="gp-decl" data-param="' + escapeHtml(p.name) + '"'
        + ' title="Arme le déclencheur, une fois.">⚡ ' + escapeHtml(p.name) + '</button>'
        + croix + '</span>';
    }
    if(p.type === 'bool'){
      return '<span class="gp-block"><label class="gp"><input type="checkbox" data-param="'
        + escapeHtml(p.name) + '"' + (v ? ' checked' : '') + '> ' + escapeHtml(p.name)
        + '</label>' + croix + '</span>';
    }
    return '<span class="gp-block"><label class="gp">' + escapeHtml(p.name)
      + '<input type="number" step="0.1" data-param="' + escapeHtml(p.name) + '" value="'
      + (v === undefined ? 0 : v) + '"></label>' + croix + '</span>';
  }).join('')
    + '<button class="gp-plus" data-add-param="1" title="Déclarer un paramètre">'
    + '＋ Paramètre</button>';
  // Sans aperçu, régler un paramètre ne produit rien de visible : le dire vaut mieux que de
  // laisser l'utilisateur pousser des curseurs devant un personnage immobile.
  if(!previewAnimator.active){
    zone.innerHTML += '<span class="gp-empty">— l\'aperçu est éteint, ces réglages ne '
      + 'bougeront rien tant qu\'il l\'est</span>';
  }
}

/**
 * Suit l'état joué, à chaque image, SANS redessiner le graphe.
 *
 * Tout reconstruire soixante fois par seconde viderait les champs de paramètres en cours de
 * saisie et rendrait le panneau inutilisable — précisément pendant qu'on s'en sert. On ne
 * touche donc qu'à la classe qui colore la boîte.
 */
export function refreshStateCurrent(){
  if(!viewAnimatorActive()) return;
  const m = machineOfGraph();
  if(!m) return;
  const current = stateCurrentOfGraph();
  const boites = document.querySelectorAll('#graph-states .graph-state');
  boites.forEach(function(b){
    const e = (m.states || [])[parseInt(b.dataset.ei, 10)];
    b.classList.toggle('current', !!e && e.name === current);
  });
}

/** L'état joué en ce moment, s'il y en a un — pour l'éclairer dans le graphe. */
export function stateCurrentOfGraph(){
  if(!graphAnim.node || typeof playerAnimatorOf !== 'function') return null;
  const l = playerAnimatorOf(graphAnim.node);
  return l ? l.state : null;
}

// ---------- interactions ----------

export function onMouseGraph(e){
  const zone = document.getElementById('graph-zone');
  const zStates = document.getElementById('graph-states');
  if(!zone || !zStates) return null;
  const r = zStates.getBoundingClientRect();
  return {x: e.clientX - r.left, y: e.clientY - r.top};
}

export function bindGraph(){
  const zone = document.getElementById('graph-zone');
  if(!zone) return;

  zone.addEventListener('mousedown', function(e){
    const m = machineOfGraph();
    if(!m) return;
    const p = onMouseGraph(e);
    if(!p) return;
    const target = stateSubPoint(m, p.x, p.y);

    // La poignée crée une transition ; le reste de la boîte la déplace. Deux gestes distincts
    // sur le même objet : sans zone dédiée, tout déplacement créerait un link par accident.
    if(target && e.target.classList && e.target.classList.contains('ge-handle')){
      graphAnim.link = {depuis: target, x: p.x, y: p.y};
      e.preventDefault();
      return;
    }
    if(target){
      graphAnim.stateSel = target;
      graphAnim.transSel = null;
      graphAnim.glisse = {state: target, dx: p.x - (target.x || 0), dy: p.y - (target.y || 0)};
      drawGraph();
      buildInspector();
      e.preventDefault();
      return;
    }
    // Clic dans le vide : on désélectionne. Un link sélectionné qui le reste après un clic
    // ailleurs ferait supprimer la mauvaise chose au clavier.
    const link = e.target.closest ? e.target.closest('.link, .link-hit') : null;
    if(link && link.dataset.ti !== undefined){
      graphAnim.transSel = m.transitions[parseInt(link.dataset.ti, 10)] || null;
      graphAnim.stateSel = null;
    } else {
      graphAnim.stateSel = null;
      graphAnim.transSel = null;
    }
    drawGraph();
    buildInspector();
  });

  zone.addEventListener('mousemove', function(e){
    if(!graphAnim.glisse && !graphAnim.link) return;
    const p = onMouseGraph(e);
    if(!p) return;
    if(graphAnim.glisse){
      graphAnim.glisse.state.x = Math.max(0, p.x - graphAnim.glisse.dx);
      graphAnim.glisse.state.y = Math.max(0, p.y - graphAnim.glisse.dy);
    } else {
      graphAnim.link.x = p.x; graphAnim.link.y = p.y;
    }
    drawGraph();
  });

  zone.addEventListener('mouseup', function(e){
    const m = machineOfGraph();
    if(graphAnim.link && m){
      const p = onMouseGraph(e);
      const arrivee = p ? stateSubPoint(m, p.x, p.y) : null;
      if(arrivee && arrivee !== graphAnim.link.depuis){
        pushHistory();
        m.transitions = m.transitions || [];
        m.transitions.push({de: graphAnim.link.depuis.name, vers: arrivee.name,
                            duration: 0.2, conditions: []});
        graphAnim.transSel = m.transitions[m.transitions.length - 1];
        graphAnim.stateSel = null;
        setStatus('Transition ' + graphAnim.link.depuis.name + ' → ' + arrivee.name
          + ' créée — ajoutez-lui une condition dans l\'inspector', 4000);
      }
    }
    graphAnim.glisse = null;
    graphAnim.link = null;
    drawGraph();
    buildInspector();
  });

  // Sortir de la zone en tenant le bouton laisserait un glissement fantôme qui reprendrait au
  // retour du curseur, sans qu'on ait rien demandé.
  zone.addEventListener('mouseleave', function(){
    if(!graphAnim.glisse && !graphAnim.link) return;
    graphAnim.glisse = null; graphAnim.link = null;
    drawGraph();
  });

  // Glisser une animation du panneau Projet sur une boîte d'état l'affecte. Même geste que
  // pour un matériau sur un objet : c'est celui que l'utilisateur connaît déjà, et il évite
  // d'aller chercher l'état dans une liste déroulante.
  zone.addEventListener('dragover', function(e){
    const a = (typeof assetInDrag !== 'undefined') ? assetInDrag : null;
    if(!a || a.kind !== 'animation') return;
    const m = machineOfGraph();
    const p = onMouseGraph(e);
    if(!m || !p || !stateSubPoint(m, p.x, p.y)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  zone.addEventListener('drop', function(e){
    const m = machineOfGraph();
    if(!m) return;
    const id = e.dataTransfer ? e.dataTransfer.getData('text/asset') : '';
    const a = assets.find(function(x){ return x.id === id && x.kind === 'animation'; })
      || ((typeof assetInDrag !== 'undefined' && assetInDrag && assetInDrag.kind === 'animation')
          ? assetInDrag : null);
    if(!a) return;
    const p = onMouseGraph(e);
    const state = p ? stateSubPoint(m, p.x, p.y) : null;
    if(!state) return;
    e.preventDefault();
    pushHistory();
    state.animation = a.id;
    delete state.clip;
    graphAnim.stateSel = state;
    setStatus('« ' + a.name + ' » affectée à l\'état ' + state.name, 3000);
    drawGraph();
    buildInspector();
  });

  const btnPreview = document.getElementById('graph-preview');
  if(btnPreview) btnPreview.addEventListener('click', function(){
    const active = togglePreviewAnimator();
    btnPreview.textContent = active ? '⏸ Aperçu' : '▶ Aperçu';
    btnPreview.classList.toggle('active', active);
  });

  // Les paramètres sont reconstruits à chaque image d'aperçu : on délègue sur le conteneur,
  // sinon chaque redessin emporterait les écouteurs posés sur les champs.
  const zParams = document.getElementById('graph-params');
  if(zParams){
    const apply = function(el, value){
      const l = (graphAnim.node && typeof playerAnimatorOf === 'function')
        ? playerAnimatorOf(graphAnim.node) : null;
      if(!l) return;
      setParamAnimator(l, el.dataset.param, value);
    };
    zParams.addEventListener('input', function(e){
      const el = e.target;
      if(!el.dataset || !el.dataset.param) return;
      apply(el, el.type === 'checkbox' ? el.checked : (parseFloat(el.value) || 0));
    });
    zParams.addEventListener('click', function(e){
      const target = e.target;
      if(target.dataset && target.dataset.addParam){ addParamGraph(); return; }
      if(target.dataset && target.dataset.delParam !== undefined){
        deleteParamGraph(parseInt(target.dataset.delParam, 10));
        return;
      }
      const b = target.closest ? target.closest('.gp-decl') : null;
      if(!b) return;
      apply(b, true);
      setStatus('Déclencheur « ' + b.dataset.param + ' » armé', 1500);
    });
  }

  const barTitle = document.getElementById('graph-title');
  if(barTitle){
    // Délégation : le sélecteur est reconstruit à chaque redessin, un écouteur posé dessus
    // partirait avec lui.
    barTitle.addEventListener('change', function(e){
      if(!e.target || e.target.id !== 'graph-file') return;
      const a = assets.find(function(x){ return x.id === e.target.value && x.kind === 'animator'; });
      if(a) openAnimatorOnAsset(a);
    });
  }

  const btnState = document.getElementById('graph-add-state');
  if(btnState) btnState.addEventListener('click', function(){
    const m = machineOfGraph();
    if(!m) return;
    pushHistory();
    m.states = m.states || [];
    // Un nom unique d'emblée : deux états homonymes rendraient toute transition ambiguë, et
    // `validateAnimator` le signalerait sans que l'utilisateur ait voulu ce doublon.
    let n = m.states.length + 1;
    while(m.states.some(function(e){ return e && e.name === 'État ' + n; })) n++;
    m.states.push({name: 'État ' + n, clip: '', loop: true});
    if(!m.start) m.start = m.states[0].name;
    graphAnim.stateSel = m.states[m.states.length - 1];
    drawGraph();
    buildInspector();
  });
}

/**
 * Déclare un paramètre. Nom et type demandés d'un coup, en une invite.
 *
 * Le type ne se change pas après coup, volontairement : une condition écrite sur un flottant
 * n'a plus de sens si le paramètre devient un déclencheur, et corriger toutes les conditions en
 * silence serait pire que de demander d'en créer un autre.
 */
export function addParamGraph(){
  const m = machineOfGraph();
  if(!m) return;
  const name = prompt('Nom du paramètre :');
  if(!name || !name.trim()) return;
  const propre = name.trim();
  m.params = m.params || [];
  if(m.params.some(function(p){ return p && p.name === propre; })){
    setStatus('« ' + propre + ' » existe déjà', 3000);
    return;
  }
  const type = prompt('Type — flottant, entier, booléen ou déclencheur :', 'flottant');
  if(!type) return;
  // Le dialogue AFFICHE des mots français : il doit les accepter. Il ne connaissait que les
  // valeurs internes (float, int…), et taper « entier » comme demandé donnait « Type inconnu »
  // (revue du 2026-09-29, § 1.8). Les valeurs anglaises restent acceptées.
  const typeLu = type.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const propreType = {flottant: 'float', entier: 'int', booleen: 'bool', declencheur: 'trigger'}[typeLu] || typeLu;
  if(ANIMATOR_TYPES_PARAM.indexOf(propreType) === -1){
    setStatus('Type inconnu « ' + propreType + ' » — attendus : '
      + ANIMATOR_TYPES_PARAM.join(', '), 5000);
    return;
  }
  pushHistory();
  m.params.push({name:propre, type:propreType,
                     defaultValue: propreType === 'bool' ? false : (propreType === 'trigger' ? undefined : 0)});
  // Le lecteur en cours ne connaît pas ce paramètre : le laisser tourner ferait qu'une
  // condition toute neuve resterait fausse jusqu'au prochain rechargement.
  if(graphAnim.node && typeof stopAnimator === 'function') stopAnimator(graphAnim.node);
  drawGraph();
  buildInspector();
}

export function deleteParamGraph(i){
  const m = machineOfGraph();
  const p = m && (m.params || [])[i];
  if(!p) return;
  // Les conditions qui le citaient partent avec lui : les laisser donnerait une transition qui
  // « teste un paramètre non déclaré », signalée à chaque ouverture pour une suppression que
  // l'utilisateur croit terminée. Même règle que pour un état supprimé.
  const utilisee = (m.transitions || []).reduce(function(n, t){
    return n + ((t && t.conditions) || []).filter(function(c){ return c.param === p.name; }).length;
  }, 0);
  if(utilisee && !confirm('« ' + p.name + ' » est testé par ' + utilisee + ' condition(s).\n'
    + 'Les supprimer aussi ?')) return;
  pushHistory();
  m.params.splice(i, 1);
  (m.transitions || []).forEach(function(t){
    if(t && t.conditions) t.conditions = t.conditions.filter(function(c){ return c.param !== p.name; });
  });
  // Un mélange piloté par ce paramètre resterait bloqué sur son premier clip, sans erreur.
  (m.states || []).forEach(function(e){
    if(e && e.blend && e.blend.param === p.name) e.blend.param = '';
  });
  if(graphAnim.node && typeof stopAnimator === 'function') stopAnimator(graphAnim.node);
  drawGraph();
  buildInspector();
}

/** Supprime ce qui est sélectionné. Appelée par le raccourci Suppr de l'éditeur. */
export function deleteSelectionGraph(){
  const m = machineOfGraph();
  if(!m) return false;
  if(graphAnim.transSel){
    pushHistory();
    m.transitions = (m.transitions || []).filter(function(t){ return t !== graphAnim.transSel; });
    graphAnim.transSel = null;
    drawGraph();
    return true;
  }
  if(graphAnim.stateSel){
    pushHistory();
    const name = graphAnim.stateSel.name;
    m.states = (m.states || []).filter(function(e){ return e !== graphAnim.stateSel; });
    // Les transitions qui le citaient partent avec lui : les laisser donnerait un graphe qui
    // « mène à un état qui n'existe pas », signalé par la validation à chaque ouverture pour
    // une suppression que l'utilisateur croit terminée.
    m.transitions = (m.transitions || []).filter(function(t){
      return t && t.de !== name && t.vers !== name;
    });
    if(m.start === name) m.start = (m.states[0] || {}).name || null;
    graphAnim.stateSel = null;
    drawGraph();
    return true;
  }
  return false;
}


// EXPOSÉ EN GLOBALE, à dessein. Ces symboles sont appelés depuis des fichiers
// que les mêmes pages ne chargent pas toutes : un `import` y pointerait un
// fichier absent, et la page ne démarrerait pas. Ils gardent donc leur garde
// `typeof` côté appelant, et se déclarent ici.
globalThis.drawGraph = drawGraph;