// ---------- Le dock : la couche DOM ----------
//
// Il APPLIQUE l'arbre calculé par js/ui/dock-tree.js, et ne décide de rien.
//
// LE PRINCIPE, le même que celui de windows.js : on ne reconstruit RIEN. Une zone ADOPTE un
// élément déjà présent dans la page — `#hier`, `#view`, `#insp`, `#project` — avec ses
// identifiants et ses écouteurs. Déplacer un `<canvas>` dans le DOM conserve son contexte WebGL ;
// le recréer perdrait contexte, textures et buffers. Et une douzaine de fichiers ont posé leurs
// écouteurs sur `#hier-body`, `#project-body`, `#insp-body` au chargement : ils continuent de
// fonctionner sans le savoir.
//
// Le dock est un POUSSEUR (spec §4) : il appelle `Panels.setVisible(id, bool)` et lit les tailles
// minimales sur l'objet RÉSOLU du registre. Il ne demande jamais rien à `panel.js`, qui ne le
// connaît pas — c'est ce qui casse le cycle `dock → panel → form → dock`.

import { logConsole } from '../console.js';
import { setStatus } from '../hierarchy.js';
import { LAYOUT_DEFAULT, applyDrop, cloneLayout, dropTarget, normalizeLayout, panelsOf, parseLayout, popOutPanel, serializeLayout, zonesOf } from './dock-tree.js';
import { Panels } from './panel.js';
import { UIRegistry } from './registry.js';
import { resize } from '../viewport.js';
import { closeWindow, openWindow, popInWindow, popOutWindow, windowOpen, windowPopped } from '../windows.js';

export const Dock = (function(){
  const KEY_LAYOUT = 'moteur3d-layout';   // rejoint Prefs au lot 3 ; ici comme windows.js:34
  let host = null;
  let layout = null;
  const zoneBodies = new Map();   // nom de zone -> élément qui reçoit les panneaux
  // nom de zone -> le conteneur ENTIER (barre d'onglets + corps). `targetUnder` teste CE
  // rectangle, pas seulement `zoneBodies` : viser la barre d'onglets d'une zone qui a déjà des
  // panneaux (le geste naturel pour lui en ajouter un) tombait hors du rectangle du seul corps,
  // et le dépôt était refusé sans un mot.
  const zoneElements = new Map();
  const tabElements = new Map();  // id de panneau -> son élément d'onglet
  // id de panneau -> son ÉLÉMENT DE CORPS. Indispensable, et pas un raccourci : `buildZone`
  // construit la zone HORS du document (`render` ne l'attache qu'après), et
  // `document.getElementById` ne trouve que ce qui est DANS le document. Résoudre l'hôte par
  // son id pendant la construction rendait donc `null` pour tout panneau à hôte NEUF — donc
  // aucun `display:none` posé, donc TOUS les panneaux de la zone affichés les uns sous les
  // autres. Les panneaux ADOPTÉS échappaient au bug (leur élément est déjà dans la page), ce
  // qui l'a rendu invisible jusqu'à ce qu'une zone porte plusieurs panneaux à hôte neuf —
  // Environnement, Rendu, Paramètres du projet et Préférences dans la colonne de droite.
  const panelElements = new Map();
  let saveWaiting = false;

  function doc(){ return (host && host.ownerDocument) || document; }

  function descriptors(){
    const out = {};
    UIRegistry.panels().forEach(function(d){ out[d.id] = d; });
    return out;
  }
  function knownIds(){ return UIRegistry.panels().map(function(d){ return d.id; }); }
  function defaultZones(){
    const out = {};
    UIRegistry.panels().forEach(function(d){ if(d.defaultZone) out[d.id] = d.defaultZone; });
    return out;
  }

  /** Le descripteur d'un panneau, ou un objet vide — jamais `null` : les appelants le lisent. */
  function descriptorOf(id){ return UIRegistry.panel(id) || {}; }

  // ---------- Enregistrement du layout ----------
  // Différé : une poignée qu'on glisse produit des dizaines de changements par seconde, et
  // écrire dans localStorage à chaque pixel ferait ramer le glissement lui-même.
  function saveLayout(){
    if(saveWaiting) return;
    saveWaiting = true;
    const differer = (typeof requestAnimationFrame === 'function')
      ? requestAnimationFrame : function(fn){ return setTimeout(fn, 16); };
    differer(function(){
      saveWaiting = false;
      try { localStorage.setItem(KEY_LAYOUT, serializeLayout(layout)); }
      catch(e){ /* mode privé : tout fonctionne, rien n'est retenu */ }
    });
  }

  function journal(message){
    logConsole('warn', message, null);
  }

  // ---------- Construction du DOM ----------

  function buildZone(node){
    const d = doc();
    const zone = d.createElement('div');
    zone.classList.add('dock-zone');
    zone.dataset.zone = node.zone;

    const bar = d.createElement('div');
    bar.classList.add('title-panel');
    bar.classList.add('dock-tabs');
    zone.appendChild(bar);

    const body = d.createElement('div');
    body.classList.add('dock-body');
    zone.appendChild(body);
    zoneBodies.set(node.zone, body);
    zoneElements.set(node.zone, zone);

    node.tabs.forEach(function(id){
      const descr = descriptorOf(id);
      const tab = d.createElement('button');
      tab.classList.add('tab');
      tab.dataset.panel = id;
      tab.textContent = descr.title || id;
      // UN ONGLET OUVERT À LA DEMANDE SE FERME (Rack, Copilote, Multijoueur…) : rien ne disait
      // comment, en dehors du menu Fenêtres (revue du 2026-09-29, § 4.9). La croix ; le clic du
      // milieu ; Suppr quand l'onglet a le focus.
      if(descr.onDemand && descr.closable !== false){
        const croix = d.createElement('span');
        croix.className = 'tab-close';
        croix.textContent = '×';
        croix.title = 'Fermer';
        croix.setAttribute('aria-hidden', 'true');
        croix.addEventListener('click', function(e){ e.stopPropagation(); close(id); });
        tab.appendChild(croix);
        tab.setAttribute('aria-keyshortcuts', 'Delete');
        tab.addEventListener('auxclick', function(e){ if(e.button === 1){ e.preventDefault(); close(id); } });
        tab.addEventListener('keydown', function(e){ if(e.key === 'Delete'){ e.preventDefault(); e.stopPropagation(); close(id); } });
      }
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(id === node.active));
      if(id === node.active) tab.classList.add('active');
      tab.addEventListener('click', function(){ activate(node.zone, id); });
      bindDrag(tab, id, node.zone);
      bar.appendChild(tab);
      tabElements.set(id, tab);

      // ADOPTION : l'élément existe déjà dans la page, on le déplace. Un panneau sans `adopt`
      // reçoit un hôte neuf, que `Panels.boot` remplira.
      let el = descr.adopt ? d.getElementById(descr.adopt) : null;
      if(!el){
        el = d.createElement('div');
        el.id = 'dock-host-' + id;
        el.classList.add('dock-host');
      }
      el.classList.add('dock-panel');
      body.appendChild(el);
      panelElements.set(id, el);
      applyVisible(id, id === node.active);
    });

    // Un ressort entre les onglets et le reste : barres d'outils et « ? » vont à droite sans
    // se partager deux marges automatiques (le « ? » se retrouvait au milieu de la barre).
    const spring = d.createElement('span');
    spring.className = 'dock-spring';
    bar.appendChild(spring);

    // Les BARRES D'OUTILS apres TOUS les onglets, jamais entre deux : posees au fil de la
    // boucle, celle du premier panneau poussait les onglets suivants a l'autre bout de la barre
    // (elle est alignee a droite). Elles sont deplacees, jamais recopiees — leurs ecouteurs
    // sont poses au chargement.
    node.tabs.forEach(function(id){
      const idOutils = descriptorOf(id).toolbar;
      const outils = idOutils ? d.getElementById(idOutils) : null;
      if(!outils) return;
      outils.classList.add('dock-toolbar');
      bar.appendChild(outils);
      outils.style.display = (id === node.active) ? '' : 'none';
    });

    // LE « ? » DE LA ZONE, en bout de barre : il ouvre l'aide du panneau ACTIF de la zone.
    // Le dock ne sait rien de l'aide — il pose le bouton, js/help.js écoute ses clics
    // (délégation) et choisit la page. Pas d'import, donc pas de cycle de modules.
    const help = d.createElement('button');
    help.className = 'dock-help';
    help.type = 'button';
    help.textContent = '?';
    help.title = 'Aide sur ce panneau (F1)';
    bar.appendChild(help);
    return zone;
  }

  function buildNode(node){
    if(node.zone) return buildZone(node);
    const d = doc();
    const box = d.createElement('div');
    box.classList.add('dock-split');
    box.classList.add(node.split === 'col' ? 'dock-col' : 'dock-row');
    node.children.forEach(function(child, i){
      const wrap = d.createElement('div');
      wrap.classList.add('dock-cell');
      wrap.style.flex = String(node.sizes[i]);
      wrap.appendChild(buildNode(child));
      box.appendChild(wrap);
      // Une poignée ENTRE deux enfants, jamais après le dernier.
      if(i < node.children.length - 1) box.appendChild(buildHandle(node, i, wrap));
    });
    return box;
  }

  /**
   * Une poignée entre deux cellules. Pointer Events + `setPointerCapture` : un `mousemove`
   * global (ce que faisaient les anciens splitters) perd le geste dès que le curseur sort de
   * la fenêtre, et la poignée reste collée au curseur.
   */
  function buildHandle(node, index, cellAvant){
    const d = doc();
    const h = d.createElement('div');
    h.classList.add('dock-handle');
    h.classList.add(node.split === 'col' ? 'dock-handle-h' : 'dock-handle-v');
    h.setAttribute('title', 'Glisser pour redimensionner');
    let dragging = false;

    h.addEventListener('pointerdown', function(e){
      dragging = true;
      h.classList.add('active');
      if(h.setPointerCapture && e.pointerId !== undefined) h.setPointerCapture(e.pointerId);
      if(e.preventDefault) e.preventDefault();
    });
    h.addEventListener('pointermove', function(e){
      if(!dragging) return;
      const box = cellAvant.parentNode;
      if(!box || !box.getBoundingClientRect) return;
      const r = box.getBoundingClientRect();
      const horizontal = node.split !== 'col';
      const total = horizontal ? r.width : r.height;
      if(!total) return;
      const pos = horizontal ? (e.clientX - r.left) : (e.clientY - r.top);
      // La part cumulée des cellules qui précèdent : la poignée ne déplace QUE la frontière
      // entre `index` et `index + 1`, les autres ne bougent pas.
      let avant = 0;
      for(let i = 0; i < index; i++) avant += node.sizes[i];
      const paire = node.sizes[index] + node.sizes[index + 1];
      let part = (pos / total) - avant;
      // Aucune cellule ne peut tomber à zéro : une zone réduite à rien est une zone qu'on ne
      // sait plus rattraper à la souris.
      const min = 0.05;
      part = Math.max(min, Math.min(paire - min, part));
      node.sizes[index] = part;
      node.sizes[index + 1] = paire - part;
      applySizes(node, box);
      if(typeof resize === 'function') resize();
      saveLayout();
    });
    function fin(){
      if(!dragging) return;
      dragging = false;
      h.classList.remove('active');
      if(typeof resize === 'function') resize();
    }
    h.addEventListener('pointerup', fin);
    h.addEventListener('pointercancel', fin);
    return h;
  }

  function applySizes(node, box){
    let i = 0;
    // `children` est une HTMLCollection dans un navigateur : elle N'A PAS de `forEach`. Le
    // harnais de test, lui, en rend un tableau — d'où une TypeError qu'aucun test ne voyait.
    Array.prototype.slice.call(box.children || []).forEach(function(child){
      if(!child.classList || !child.classList.contains('dock-cell')) return;
      child.style.flex = String(node.sizes[i]);
      i += 1;
    });
  }

  function applyVisible(id, on){
    const el = hostOfPanel(id);
    if(el) el.style.display = on ? '' : 'none';
    const descr = descriptorOf(id);
    if(descr.toolbar){
      const outils = doc().getElementById(descr.toolbar);
      if(outils) outils.style.display = on ? '' : 'none';
    }
    // Le panneau peut vouloir savoir qu'on le regarde (la console remet son compteur à zéro).
    if(on && typeof descr.onShow === 'function') descr.onShow();
    if(typeof Panels !== 'undefined') Panels.setVisible(id, on);
  }

  function hostOfPanel(id){
    // La carte d'abord : elle répond même quand la zone n'est pas encore dans le document.
    const connu = panelElements.get(id);
    if(connu) return connu;
    const descr = descriptorOf(id);
    return doc().getElementById(descr.adopt || ('dock-host-' + id));
  }

  function zoneNodeOf(name){
    return zonesOf(layout.root).find(function(z){ return z.zone === name; }) || null;
  }
  function zoneOfPanel(id){
    return zonesOf(layout.root).find(function(z){ return z.tabs.indexOf(id) !== -1; }) || null;
  }

  // ---------- Le geste : tirer un onglet ----------
  //
  // Il est MINCE, et volontairement : aucune règle de décision ici. Il capte le pointeur,
  // demande à `dropTarget` où l'on est, dessine, puis appelle `applyDrop`. Tout ce qui se
  // décide est dans js/ui/dock-tree.js, donc mesurable sans navigateur — c'est la seule
  // parade quand le geste lui-même n'est vérifiable qu'à la main (spec §11.2).

  const DRAG_SEUIL = 4;   // px avant qu'un clic devienne un glissement
  let drag = null;

  function previewBox(){
    const d = doc();
    let el = d.getElementById('dock-preview');
    if(!el){
      el = d.createElement('div');
      el.id = 'dock-preview';
      el.classList.add('dock-preview');
      (d.body || host).appendChild(el);
    }
    return el;
  }

  function hidePreview(){
    const el = doc().getElementById('dock-preview');
    if(el) el.style.display = 'none';
  }

  /** La zone survolée, son rectangle, et ce que le curseur y vise. */
  function targetUnder(x, y){
    const d = doc();
    let found = null;
    zonesOf(layout.root).forEach(function(z){
      const el = zoneElements.get(z.zone);
      if(!el || !el.getBoundingClientRect) return;
      const r = el.getBoundingClientRect();
      const t = dropTarget({x: r.left, y: r.top, width: r.width, height: r.height}, x, y);
      if(t.where !== 'outside') found = {zone: z.zone, where: t.where, preview: t.preview};
    });
    return found || {where: 'outside', x: x, y: y, preview: null};
  }

  function endDrag(applique){
    if(!drag) return;
    const encours = drag;
    drag = null;
    hidePreview();
    if(encours.tab) encours.tab.classList.remove('dragging');
    if(typeof document !== 'undefined' && encours.onKey){
      document.removeEventListener('keydown', encours.onKey);
    }
    if(!applique || !encours.moved || !encours.target) return;
    const next = applyDrop(layout, encours.panel, encours.target, descriptors(), knownIds());
    if(next === layout) return;   // dépôt refusé : rien n'a bougé, rien à reconstruire
    layout = next;
    render();
    saveLayout();
  }

  function bindDrag(tab, panelId, zoneName){
    tab.addEventListener('pointerdown', function(e){
      drag = {panel: panelId, zone: zoneName, tab: tab,
              x0: e.clientX, y0: e.clientY, moved: false, target: null};
      // `Échap` annule : on jette la cible, et l'arbre n'a jamais été touché (applyDrop est
      // immuable). L'écouteur est retiré à la fin du geste — un écouteur global oublié rend
      // `Échap` inopérant ailleurs, trois lots plus tard.
      drag.onKey = function(ev){ if(ev.key === 'Escape') endDrag(false); };
      if(typeof document !== 'undefined') document.addEventListener('keydown', drag.onKey);
      if(tab.setPointerCapture && e.pointerId !== undefined) tab.setPointerCapture(e.pointerId);
    });

    tab.addEventListener('pointermove', function(e){
      if(!drag) return;
      // Un SEUIL avant de commencer : sans lui, un clic un peu appuyé sur un onglet
      // déclencherait un déplacement, et changer d'onglet deviendrait hasardeux.
      if(!drag.moved){
        if(Math.abs(e.clientX - drag.x0) < DRAG_SEUIL && Math.abs(e.clientY - drag.y0) < DRAG_SEUIL) return;
        drag.moved = true;
        tab.classList.add('dragging');
      }
      drag.target = targetUnder(e.clientX, e.clientY);
      const box = previewBox();
      const p = drag.target.preview;
      if(!p){ box.style.display = 'none'; return; }
      // Le rectangle est POSITIONNÉ, jamais recréé : soixante créations d'élément par seconde
      // pendant un glissement se voient à l'œil.
      box.style.display = 'block';
      box.style.left = p.x + 'px';
      box.style.top = p.y + 'px';
      box.style.width = p.width + 'px';
      box.style.height = p.height + 'px';
    });

    tab.addEventListener('pointerup', function(){ endDrag(true); });
    tab.addEventListener('pointercancel', function(){ endDrag(false); });
  }

  // ---------- API ----------

  function activate(zoneName, panelId){
    const z = zoneNodeOf(zoneName);
    if(!z || z.tabs.indexOf(panelId) === -1) return;
    z.active = panelId;
    z.tabs.forEach(function(id){
      applyVisible(id, id === panelId);
      const t = tabElements.get(id);
      if(t) t.classList.toggle('active', id === panelId);
    });
    // La zone a changé de contenu : le canvas peut avoir changé de taille utile.
    if(typeof resize === 'function') resize();
    saveLayout();
  }

  /**
   * Met à l'abri les éléments ADOPTÉS avant de refaire les zones.
   *
   * `host.innerHTML = ''` ne vide pas une boîte : il DÉTRUIT ce qu'elle contient. Les éléments
   * adoptés — le canvas, la hiérarchie, le panneau Projet — disparaîtraient de la page à la
   * première reconstruction (fermer un panneau, en rouvrir un, réinitialiser la disposition),
   * et rien ne pourrait les rendre. On les remise donc dans un porte-éléments caché, d'où
   * `buildZone` les reprend.
   */
  function detachAdopted(){
    const d = doc();
    let remise = d.getElementById('dock-detached');
    if(!remise){
      remise = d.createElement('div');
      remise.id = 'dock-detached';
      remise.style.display = 'none';
      (d.body || host).appendChild(remise);
    }
    UIRegistry.panels().forEach(function(descr){
      // Un panneau DÉTACHÉ vit dans une fenêtre flottante, qui l'a adopté avec son ancre
      // (windows.js). Le remiser ici le lui arracherait, et la fenêtre resterait vide.
      if(isFloating(descr.id)) return;
      if(typeof windowPopped === 'function' && windowPopped(keyWindow(descr.id))) return;
      [descr.adopt, descr.toolbar, 'dock-host-' + descr.id].forEach(function(id){
        if(!id) return;
        const el = d.getElementById(id);
        if(el) remise.appendChild(el);
      });
    });
  }

  function render(){
    detachAdopted();
    host.innerHTML = '';
    zoneBodies.clear();
    zoneElements.clear();
    tabElements.clear();
    panelElements.clear();
    host.appendChild(buildNode(layout.root));
    // Les panneaux sans `adopt` sont construits par le socle, dans l'hôte qu'on vient de poser.
    if(typeof Panels !== 'undefined'){
      const hosts = {};
      panelsOf(layout).forEach(function(id){
        const el = hostOfPanel(id);
        if(el) hosts[id] = el;
      });
      Panels.boot(hosts);
    }
    // Les panneaux DÉTACHÉS : on ouvre les fenêtres que le layout annonce.
    syncFloating();
    syncPopped();
    if(typeof resize === 'function') resize();
  }

  // ---------- Panneaux détachés en fenêtre flottante ----------
  //
  // `windows.js` sait DÉJÀ adopter un élément et le rendre à sa place (il pose une ancre —
  // un nœud vide — là où l'élément vivait). Détacher un panneau, c'est appeler ce qui existe,
  // pas écrire un second système de fenêtres.
  //
  // Le partage des données est explicite : le LAYOUT dit QUELLES fenêtres rouvrir, `windows.js`
  // garde leur GÉOMÉTRIE (clé `window:<id>`). Une seule source de vérité par donnée.

  function keyWindow(id){ return 'panel:' + id; }
  function isFloating(id){
    return typeof windowOpen === 'function' && windowOpen(keyWindow(id));
  }

  /**
   * Redépose un panneau flottant à un endroit précis du dock — le pendant, pour une fenêtre,
   * du lâcher d'onglet (`endDrag`). Appelé quand on relâche la barre de titre au-dessus d'une
   * zone : sans lui, la SEULE façon de rattacher une fenêtre était sa croix, qui la renvoie
   * toujours à sa zone par défaut plutôt qu'à celle visée.
   */
  function redockFloatingTo(id, target){
    const next = applyDrop(layout, id, target, descriptors(), knownIds());
    if(next === layout) return false;   // dépôt refusé : la fenêtre reste où elle est
    layout = next;
    // `sansRappel` : la fermeture ne doit PAS déclencher `onFermeture` (qui rattacherait le
    // panneau à sa zone par défaut) — on vient de choisir la sienne.
    closeWindow(keyWindow(id), true);
    render();
    saveLayout();
    return true;
  }

  /**
   * Ouvre les fenêtres que le layout annonce. Elle n'en FERME aucune : c'est la fenêtre qui
   * décide de se fermer (par sa croix), et sa fermeture rattache le panneau — dans l'autre sens,
   * on aurait une boucle `close → onFermeture → reopen → render → close`.
   */
  function syncFloating(){
    const attendus = (layout.floating || []).map(function(f){ return f.panel; });
    attendus.forEach(function(id){
      if(isFloating(id)) return;
      const el = hostOfPanel(id);
      if(!el) return;
      const descr = descriptorOf(id);
      const toolbar = descr.toolbar ? doc().getElementById(descr.toolbar) : null;
      if(toolbar) toolbar.classList.add('dock-toolbar');
      const g = (layout.floating || []).find(function(f){ return f.panel === id; }) || {};
      openWindow(keyWindow(id), toolbar ? [toolbar, el] : el, {
        title: (descr.icon ? descr.icon + ' ' : '') + (descr.title || id),
        x: g.x, y: g.y, width: g.w, height: g.h,
        // Refermer la fenêtre RATTACHE le panneau. Une fenêtre fermée qui ferait disparaître
        // son panneau serait une perte silencieuse : on ne saurait plus où le retrouver.
        onFermeture: function(){
          if(typeof descr.onHide === 'function') descr.onHide();
          reopen(id);
        },
        onResize: descr.onResize,
        // Glisser la barre de titre au-dessus d'une zone : même prévisualisation que l'onglet
        // (targetUnder / previewBox), pour que le geste se comporte pareil qu'on tire un
        // onglet ou une fenêtre.
        onDragMove: function(x, y){
          const t = targetUnder(x, y);
          const box = previewBox();
          const p = t.preview;
          if(!p){ box.style.display = 'none'; return; }
          box.style.display = 'block';
          box.style.left = p.x + 'px';
          box.style.top = p.y + 'px';
          box.style.width = p.width + 'px';
          box.style.height = p.height + 'px';
        },
        onDragEnd: function(x, y){
          hidePreview();
          const t = targetUnder(x, y);
          if(t.where === 'outside') return;   // reste flottante, simplement déplacée
          redockFloatingTo(id, t);
        },
        onPopOut: function(){ popOut(id); }
      });
      // Le panneau est CONFIRMÉ flottant : sans ceci, `Panels.syncAll()` le laisse invisible
      // pour toujours s'il n'était pas l'onglet actif de sa zone au moment de partir (bug
      // mesuré : formulaire vide après un pop-out depuis un onglet non actif).
      if(typeof Panels !== 'undefined') Panels.setVisible(id, true);
      if(typeof descr.onShow === 'function') descr.onShow();
    });
  }

  /**
   * Le pendant de `syncFloating`, pour les fenêtres OS séparées.
   *
   * Si le navigateur bloque la popup, `popOutWindow` rend `false` — le layout ne doit PAS
   * mentir en gardant le panneau marqué « poppé » sans fenêtre réelle derrière : il
   * retomberait invisible (élément resté dans `#dock-detached`) et bloqué (`Dock.open(id)`
   * le dirait présent, mais rien à l'écran, nulle part). On le fait retomber flottant EN
   * PAGE à la place — un logement qui, lui, ne peut pas être refusé par le navigateur.
   */
  function syncPopped(){
    // Une BOUCLE, jamais un `forEach` sur un instantane : le repli d'une popup bloquee (plus
    // bas) mute `layout.popped`/`layout.floating` et appelle `render()`, qui relance
    // `syncPopped()` en imbrique — sur l'etat FRAIS. Un `forEach` garderait son instantane
    // perime et retraiterait un id deja resolu par l'appel imbrique : `popOutWindow` serait
    // appele deux fois pour le meme id, et une seconde popup bloquee dupliquerait son entree
    // dans `layout.floating`. Relire `layout.popped` a CHAQUE iteration rend ca impossible :
    // un id traite ici (ouvert ou reparti en flottant) n'y figure plus au tour suivant.
    for(;;){
      const id = (layout.popped || []).map(function(f){ return f.panel; })
        .find(function(x){ return !(typeof windowPopped === 'function' && windowPopped(keyWindow(x))); });
      if(id === undefined) return;
      const el = hostOfPanel(id);
      if(!el) return;   // pas d'hote : rien a ouvrir, et le reessayer ne changerait rien ici
      const descr = descriptorOf(id);
      const toolbar = descr.toolbar ? doc().getElementById(descr.toolbar) : null;
      if(toolbar) toolbar.classList.add('dock-toolbar');
      const g = (layout.popped || []).find(function(f){ return f.panel === id; }) || {};
      const opened = popOutWindow(keyWindow(id), toolbar ? [toolbar, el] : el, {
        title: (descr.icon ? descr.icon + ' ' : '') + (descr.title || id),
        x: g.x, y: g.y, width: g.w, height: g.h,
        onFermeture: function(){ popBackIn(id); }
      });
      if(opened){
        // Meme raison que syncFloating : sans ceci, un panneau poppe depuis un onglet non
        // actif ne serait plus jamais synchronise par Panels.syncAll().
        if(typeof Panels !== 'undefined') Panels.setVisible(id, true);
        if(typeof descr.onShow === 'function') descr.onShow();
        continue;   // celui-ci est resolu, la boucle relit l'etat frais pour la suite
      }
      layout.popped = (layout.popped || []).filter(function(f){ return f.panel !== id; });
      layout.floating = (layout.floating || []).concat([{panel: id, x: g.x, y: g.y, w: g.w, h: g.h}]);
      layout = normalizeLayout(layout, knownIds().filter(function(x){ return !closed.has(x); }),
                               defaultZones(), descriptors());
      render();   // l'appel imbrique traite tout le reste de `layout.popped` sur l'etat frais
      return;     // ce passage-ci s'arrete la : continuer relirait un etat deja traite par lui
    }
  }

  /** Rapatriement quand c'est la fenêtre OS elle-même qui a décidé de se fermer. */
  function popBackIn(id){
    const descr = descriptorOf(id);
    if(typeof descr.onHide === 'function') descr.onHide();
    layout.popped = (layout.popped || []).filter(function(f){ return f.panel !== id; });
    reopen(id);
  }

  /** Un panneau, quel que soit son logement actuel, part en fenêtre OS séparée. */
  function popOut(id){
    const next = popOutPanel(layout, id, null, descriptors(),
      knownIds().filter(function(x){ return !closed.has(x); }), defaultZones());
    if(next === layout) return false;   // refusé (non poppable / non closable)
    layout = next;
    hidePanel(id);   // au cas où il était déjà flottant EN PAGE : une seule fenêtre à la fois
    render();
    saveLayout();
    return true;
  }

  /** Ramène un panneau poppé dans la page — l'inverse explicite de `popOut`. */
  function popIn(id){
    if(typeof windowPopped !== 'function' || !windowPopped(keyWindow(id))) return false;
    popInWindow(keyWindow(id), true);
    layout.popped = (layout.popped || []).filter(function(f){ return f.panel !== id; });
    layout = normalizeLayout(layout, knownIds().filter(function(x){ return !closed.has(x); }),
                             defaultZones(), descriptors());
    render();
    saveLayout();
    return true;
  }

  function mount(element, raw){
    host = element;
    const lu = parseLayout(raw === undefined ? readSaved() : raw,
                           knownIds(), defaultZones(), descriptors());
    layout = lu.layout;
    if(lu.fallback && raw){
      journal('Disposition des panneaux illisible : retour à la disposition par défaut.');
    }
    render();
    saveLayout();
    return layout;
  }

  function readSaved(){
    try { return localStorage.getItem(KEY_LAYOUT); } catch(e){ return null; }
  }

  function close(id){
    // Un panneau `closable: false` ne se ferme pas : sinon on peut se retrouver sans vue 3D et
    // sans aucun moyen de la récupérer.
    if(descriptorOf(id).closable === false) return false;
    const z = zoneOfPanel(id);
    const flottant = (layout.floating || []).some(function(f){ return f.panel === id; });
    const poppe = (layout.popped || []).some(function(f){ return f.panel === id; });
    if(!z && !flottant && !poppe) return false;   // deja absent : rien a fermer
    if(z) z.tabs = z.tabs.filter(function(x){ return x !== id; });
    layout.floating = (layout.floating || []).filter(function(f){ return f.panel !== id; });
    layout.popped = (layout.popped || []).filter(function(f){ return f.panel !== id; });
    layout = normalizeLayout(layout, knownIdsSauf(id), defaultZones(), descriptors());
    // La fenetre REELLE (page ou OS) doit se fermer AVEC le layout — sinon elle reste a
    // l'ecran, orpheline, pendant que le layout dit deja le panneau ferme.
    hidePanel(id);
    const descr = descriptorOf(id);
    if(typeof descr.onHide === 'function') descr.onHide();
    render();
    saveLayout();
    return true;
  }

  /**
   * Ferme sans rappel la fenetre reelle (page ou OS) qui porte ce panneau, si elle existe.
   * `sansRappel` : c'est NOUS qui decidons de fermer — sa propre fermeture ne doit pas
   * rattacher le panneau a sa zone par defaut (ce serait revenir sur la decision de fermer).
   */
  function hidePanel(id){
    if(typeof windowOpen === 'function' && windowOpen(keyWindow(id))){
      closeWindow(keyWindow(id), true);
    }
    if(typeof windowPopped === 'function' && windowPopped(keyWindow(id))){
      popInWindow(keyWindow(id), true);
    }
  }

  // Les ids connus MOINS celui qu'on ferme : c'est ce qui empêche la normalisation de le
  // réinjecter aussitôt dans sa zone par défaut.
  const closed = new Set();
  function knownIdsSauf(id){
    closed.add(id);
    return knownIds().filter(function(x){ return !closed.has(x); });
  }

  function reopen(id){
    closed.delete(id);
    layout.floating = (layout.floating || []).filter(function(f){ return f.panel !== id; });
    layout.popped = (layout.popped || []).filter(function(f){ return f.panel !== id; });
    const ids = knownIds().filter(function(x){ return !closed.has(x); });
    let next = normalizeLayout(layout, ids, defaultZones(), descriptors());
    // A LA DEMANDE (onDemand, sans zone par defaut) : jamais rajoute tout seul par
    // normalizeLayout (dock-tree.js — c'est un choix, pas un oubli). Rouvrir veut dire
    // l'ajouter nous-memes, sinon rouvrir un outil a la demande la premiere fois ne ferait rien.
    if(panelsOf(next).indexOf(id) === -1){
      const descr = descriptorOf(id);
      if(descr.defaultZone){
        // Un `onDemand` qui porte AUSSI une `defaultZone` doit y ALLER quand on le rouvre
        // explicitement — l'exclusion de `dock-tree.js` ne vise que l'auto-injection au
        // démarrage. Sans ce cas, un panneau comme Environnement retombait toujours en
        // fenêtre flottante à la position fixe (120,80), empilée sur tout autre panneau à
        // la demande déjà ouvert là — d'où l'illusion qu'il « ne s'ouvre pas ».
        const descrCiblee = Object.assign({}, descriptors());
        descrCiblee[id] = Object.assign({}, descr, {onDemand: false});
        next = normalizeLayout(next, ids, defaultZones(), descrCiblee);
      } else {
        next = cloneLayout(next);
        next.floating.push({panel: id, x: 120, y: 80, w: 420, h: 320});
        next = normalizeLayout(next, ids, defaultZones(), descriptors());
      }
    }
    layout = next;
    render();
    saveLayout();
    // Deja flottant en page : `render()` seul ne le ramene pas devant (`syncFloating` ignore
    // ce qui est deja ouvert, pour ne pas re-adopter un element en place). Le faire avancer
    // explicitement, sinon re-choisir un panneau deja ouvert semble ne rien faire.
    if(typeof windowOpen === 'function' && windowOpen(keyWindow(id))){
      openWindow(keyWindow(id));
    }
    return true;
  }

  function reset(){
    closed.clear();
    layout = normalizeLayout(LAYOUT_DEFAULT, knownIds(), defaultZones(), descriptors());
    render();
    saveLayout();
    setStatus('Disposition des panneaux réinitialisée', 2000);
  }

  return {
    mount: mount,
    render: render,
    activate: activate,
    reset: reset,
    close: close,
    reopen: reopen,
    serialize: function(){ return serializeLayout(layout); },
    layout: function(){ return layout; },
    tabsOf: function(name){ const z = zoneNodeOf(name); return z ? z.tabs.slice() : []; },
    activeOf: function(name){ const z = zoneNodeOf(name); return z ? z.active : null; },
    tabElement: function(id){ return tabElements.get(id) || null; },
    closable: function(id){ return descriptorOf(id).closable !== false; },
    // Les panneaux à proposer dans le menu Fenêtres — DÉPLACÉ depuis `ui.js` (docs/
    // REVUE_2026-09-14.md point 11) : c'est ici, et pas dans le menu, que doit vivre la
    // connaissance de la forme d'un descripteur. Un panneau adopté (`adopt`) ou casé par défaut
    // (`defaultZone`) est listable ; un panneau `onDemand` sans les deux (ex. la Palette avant
    // sa clé `adopt`) ne l'est pas encore.
    listable: function(){
      return UIRegistry.panels().filter(function(d){ return d.adopt || d.defaultZone; });
    },
    // Le geste « clic sur l'entrée du menu Fenêtres » — DÉPLACÉ depuis `ui.js`, même raison :
    // avant, le menu devait savoir qu'un panneau ouvert se ferme, qu'un panneau avec
    // `onOpenRequest` (la Palette, seule dans ce cas — voir son commentaire, panels-shell.js)
    // passe par sa propre action plutôt que par `reopen`, et que les autres se rouvrent
    // normalement. Trois formes de descripteur à connaître pour un seul geste : exactement la
    // violation de LSP que ce point corrige. `ui.js` n'a plus qu'à appeler `Dock.toggle(id)`.
    toggle: function(id){
      if(panelsOf(layout).indexOf(id) !== -1){ close(id); return; }
      const descr = descriptorOf(id);
      if(typeof descr.onOpenRequest === 'function'){ descr.onOpenRequest(); return; }
      reopen(id);
    },
    floating: function(id){
      return isFloating(id) || (layout.floating || []).some(function(f){ return f.panel === id; });
    },
    // La zone qui porte ce panneau — pour l'amener au premier plan depuis ailleurs.
    zoneOf: function(id){ const z = zoneOfPanel(id); return z ? z.zone : null; },
    // Détacher hors de la coquille — le geste passe par ici, et le menu pourra s'en servir.
    detach: function(id, x, y){
      const next = applyDrop(layout, id, {where: 'outside', x: x, y: y}, descriptors(), knownIds());
      if(next === layout) return false;   // refusé (panneau non détachable) : rien n'a bougé
      layout = next;
      render();
      saveLayout();
      return true;
    },
    // Rattacher un flottant à une cible PRÉCISE — le pendant de `detach`, utilisé quand on
    // lâche la barre de titre d'une fenêtre au-dessus d'une zone.
    redock: redockFloatingTo,
    popOut: popOut,
    popIn: popIn,
    // Contrairement a floating(), reste strict (windowPopped uniquement) : popOut() resout
    // la fenetre reelle de facon synchrone avant que layout.popped soit jamais observable,
    // donc pas besoin d'assouplir ce test-ci comme pour floating().
    popped: function(id){ return typeof windowPopped === 'function' && windowPopped(keyWindow(id)); },
    open: function(id){ return panelsOf(layout).indexOf(id) !== -1; },
    panels: function(){ return panelsOf(layout); }
  };
})();
