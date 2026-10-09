// ---------- Fenêtres flottantes de l'éditeur ----------
//
// Le modèle d'Unity : `Window ▸ Animation`, `Window ▸ Animator` ouvrent de VRAIES fenêtres —
// on les déplace, on les redimensionne, on les closed, et la vue 3D reste visible derrière.
// C'est la condition d'usage de ces deux outils-là : on déplace la tête de lecture et on
// REGARDE le personnage move. Un graphe qui remplace la vue, ou une bande de 168 px collée en
// bottom, rendent ce va-et-vient impossible.
//
// DEUX AUTRES CHEMINS ONT ÉTÉ ÉCARTÉS :
//
//  · `window.open` (js/external-editor.js, utilisé par l'éditeur de code et le graphe de
//    shader). Il convient à un contenu qui vit seul — du texte, du JSON —, pas à un outil
//    qu'on utilise EN REGARDANT la vue 3D : une fenêtre de navigateur séparée hidden l'éditeur
//    ou vit sur un autre écran, et son contenu ne partage pas le contexte WebGL.
//  · un onglet qui prend la place de la vue (ce que faisait l'Animator). C'était le plus
//    simple, et c'est précisément ce qui empêchait de voir l'effet de ce qu'on câblait.
//
// LE PRINCIPE : on ne reconstruit RIEN. Une fenêtre ADOPTE un élément déjà présent dans la
// page, avec ses identifiants et ses écouteurs. Tout le code qui aims `#tl-zone` ou
// `#graph-states` continue de fonctionner sans le savoir, et refermer la fenêtre remet
// l'élément exactement d'où il vient.

import { logConsole } from './console.js';
import { setStatus } from './hierarchy.js';
import { mode } from './viewport.js';

export const _windows = {};                    // id -> {box, hote, anchor, element}
export let _zWindow = 300;

/** Position et taille retenues d'une session à l'autre. Une fenêtre replacée à chaque
 *  ouverture au milieu de l'écran est une fenêtre qu'on replace à chaque ouverture. */
export function _keyWindow(id){ return 'window:' + id; }

export function _readGeometry(id){
  try { return JSON.parse(localStorage.getItem(_keyWindow(id)) || 'null'); }
  catch(e){ return null; }
}
export function _writeGeometry(id, g){
  try { localStorage.setItem(_keyWindow(id), JSON.stringify(g)); } catch(e){ /* mode privé */ }
}

export function windowOpen(id){ return !!_windows[id]; }

export function _front(box){
  _zWindow += 1;
  box.style.zIndex = _zWindow;
}

/**
 * Ouvre (ou ramène devant) une fenêtre qui adopte `element`.
 *
 * `opts` : `{titre, largeur, hauteur, x, y, surFermeture}`.
 */
export function openWindow(id, element, opts){
  const o = opts || {};
  const deja = _windows[id];
  if(deja){ _front(deja.box); return deja; }
  if(!element) return null;

  const g = _readGeometry(id) || {};
  const width = g.width || o.width || 760;
  const height = g.height || o.height || 380;
  // Bornée à la fenêtre du navigateur : une géométrie retenue sur un écran plus large
  // rouvrirait la fenêtre hors field, et elle aurait tout l'air d'avoir disparu.
  const x = Math.max(0, Math.min((g.x !== undefined ? g.x : o.x !== undefined ? o.x : 120),
    Math.max(0, window.innerWidth - 120)));
  const y = Math.max(0, Math.min((g.y !== undefined ? g.y : o.y !== undefined ? o.y : 120),
    Math.max(0, window.innerHeight - 60)));

  const box = document.createElement('div');
  box.className = 'window';
  box.dataset.window = id;
  box.style.cssText = 'left:' + x + 'px;top:' + y + 'px;width:' + width + 'px;height:'
    + height + 'px';
  box.innerHTML = '<div class="win-bar"><span class="win-title"></span>'
    + '<button class="win-popout" title="Détacher en fenêtre séparée">⧉</button>'
    + '<button class="win-close" title="Fermer">✕</button></div>'
    + '<div class="win-body"></div><div class="win-size" title="Redimensionner"></div>';
  box.querySelector('.win-title').textContent = o.title || id;

  // L'ANCRE est ce qui rend l'adoption réversible : un nœud vide laissé exactement à la place
  // de l'élément, pour l'y remettre à la fermeture. Sans elle, refermer la fenêtre devrait
  // deviner où l'élément vivait, et le remettre « à la fin du parent » suffit à casser une
  // mise en page à l'ordre significatif.
  // Plusieurs éléments quand l'outil est en deux morceaux : la timeline a sa bar de
  // transport d'un côté et ses pistes de l'autre, et les séparer n'aurait aucun sens.
  const elements = Array.isArray(element) ? element.filter(Boolean) : [element];
  const body = box.querySelector('.win-body');
  const anchors = elements.map(function(el){
    const anchor = document.createComment('window:' + id);
    if(el.parentNode) el.parentNode.insertBefore(anchor, el);
    body.appendChild(el);
    // L'élément adopté peut avoir été caché par le code qui le pilotait (`display:none`) :
    // dans une fenêtre, il est visible.
    el.style.display = '';
    return anchor;
  });
  document.body.appendChild(box);
  _front(box);

  const state = {box:box, anchors:anchors, elements:elements,
                onFermeture:o.onFermeture || null,
                // Le geste de RE-DOCK (dock.js) : la barre de titre sait où survole le
                // pointeur pendant un déplacement, et où il l'a lâché.
                onDragMove:o.onDragMove || null, onDragEnd:o.onDragEnd || null,
                // Le contenu peut avoir besoin de se redessiner à sa nouvelle taille — la
                // timeline (règle graduée) et le graphe Animator, par ex. Générique : plus
                // aucun id de panneau codé en dur dans ce module.
                onResize:o.onResize || null,
                onPopOut:o.onPopOut || null};
  _windows[id] = state;
  _bindWindow(id, state);
  return state;
}

/**
 * `sansRappel` : ne PAS appeler `onFermeture`. Sert au re-dock (dock.js) — la fenêtre se ferme
 * parce que le panneau vient de retrouver une zone PRÉCISE, pas la zone par défaut que
 * `onFermeture` lui aurait donnée.
 */
export function closeWindow(id, sansRappel){
  const e = _windows[id];
  if(!e) return false;
  // Les éléments retournent à leur place AVANT que la boîte parte : l'inverse les détruirait
  // avec elle.
  e.elements.forEach(function(el, i){
    const anchor = e.anchors[i];
    if(anchor && anchor.parentNode){
      anchor.parentNode.insertBefore(el, anchor);
      anchor.parentNode.removeChild(anchor);
    }
    el.style.display = 'none';
  });
  if(e.box.parentNode) e.box.parentNode.removeChild(e.box);
  // Les écouteurs posés sur `window` par `_bindWindow` ne partent pas avec la boîte.
  if(typeof e.teardown === 'function') e.teardown();
  delete _windows[id];
  if(!sansRappel && e.onFermeture) e.onFermeture();
  return true;
}

/** Déplacement par la bar de titre, redimensionnement par le coin, et rien d'autre. */
export function _bindWindow(id, state){
  const box = state.box;
  const bar = box.querySelector('.win-bar');
  const coin = box.querySelector('.win-size');

  box.addEventListener('pointerdown', function(){ _front(box); });
  box.querySelector('.win-close').addEventListener('click', function(){ closeWindow(id); });

  const boutonPop = box.querySelector('.win-popout');
  if(boutonPop){
    if(typeof state.onPopOut === 'function'){
      boutonPop.addEventListener('click', function(){ state.onPopOut(); });
    } else {
      boutonPop.style.display = 'none';   // pas de callback fourni : rien a faire, on le cache
    }
  }

  let geste = null;
  const start = function(mode, e){
    if(e.target.classList.contains('win-close')) return;
    geste = {mode:mode, x:e.clientX, y:e.clientY,
             gx:box.offsetLeft, gy:box.offsetTop,
             gl:box.offsetWidth, gh:box.offsetHeight};
    // Capture du pointeur : sans elle, un geste rapide qui sort de la bar de titre — ou qui
    // passe au-dessus du canvas WebGL — perd les événements en cours de route, et la fenêtre
    // reste accrochée au curseur.
    e.target.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  bar.addEventListener('pointerdown', function(e){ start('deplacer', e); });
  coin.addEventListener('pointerdown', function(e){ start('size', e); });

  const move = function(e){
    if(!geste) return;
    const dx = e.clientX - geste.x, dy = e.clientY - geste.y;
    if(geste.mode === 'deplacer'){
      box.style.left = Math.max(0, Math.min(window.innerWidth - 80, geste.gx + dx)) + 'px';
      box.style.top = Math.max(0, Math.min(window.innerHeight - 32, geste.gy + dy)) + 'px';
      if(typeof state.onDragMove === 'function') state.onDragMove(e.clientX, e.clientY);
    } else {
      box.style.width = Math.max(320, geste.gl + dx) + 'px';
      box.style.height = Math.max(140, geste.gh + dy) + 'px';
    }
  };
  const end = function(e){
    if(!geste) return;
    const mode = geste.mode;
    geste = null;
    _writeGeometry(id, {x:box.offsetLeft, y:box.offsetTop,
                          width:box.offsetWidth, height:box.offsetHeight});
    if(typeof state.onResize === 'function') state.onResize();
    // Le re-dock se décide au LÂCHER, jamais pendant le geste : `onDragEnd` peut fermer cette
    // fenêtre (`closeWindow`), et la fermer en plein `pointermove` couperait le geste en cours.
    if(mode === 'deplacer' && typeof state.onDragEnd === 'function'){
      state.onDragEnd(e.clientX, e.clientY);
    }
  };
  // Ces trois-là sont posés sur `window`, pas sur la boîte : un geste de déplacement doit
  // continuer d'être suivi quand le pointeur sort de la barre de titre. Ils NE MEURENT DONC PAS
  // avec la boîte, et c'est exactement pour ça qu'il faut les retirer à la main — sans ça,
  // chaque ouverture/fermeture laissait trois fermetures vivantes retenant une boîte déjà
  // détruite, et le moindre mouvement de souris les réveillait toutes. Aucune erreur, aucune
  // trace : juste une page qui ralentit et des gestes qui se marchent dessus.
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
  state.teardown = function(){
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
  };
}

// ---------- Fenêtres OS séparées (pop-out) ----------
//
// Même PRINCIPE que l'adoption en page : on ne reconstruit rien, on déplace l'élément RÉEL —
// juste vers le document d'une autre fenêtre. `window.open` sur la MÊME origine donne accès à
// `window.opener` : les écouteurs déjà posés sur l'élément continuent de fermer sur les mêmes
// variables (celles de LA fenêtre principale), sans rien resynchroniser. `document.adoptNode`
// retire l'élément de son document d'origine et change son `ownerDocument` — ses écouteurs
// restent attachés.
//
// Ce que ce mécanisme NE PEUT PAS faire : déplacer un contexte GPU (WebGL/WebGPU). Un canevas
// qui en porte un perd son contexte en changeant de fenêtre — c'est pour ça que la Vue 3D n'est
// jamais poppable (`poppable:false` posé côté panneau, jamais appelé ici).

export const _popped = {};   // id -> {win, anchors, elements, onFermeture}

export function windowPopped(id){ return !!_popped[id] && !_popped[id].win.closed; }

/**
 * Ouvre une fenêtre OS vide, y copie les feuilles de style de la page principale, puis
 * ADOPTE `element` (ou `[toolbar, element]`) dedans.
 *
 * `opts` : `{title, width, height, x, y, onFermeture}`. Rend `false` si le navigateur bloque
 * la popup — à l'appelant de prévenir l'utilisateur, ce module n'affiche rien lui-même.
 *
 * Attendu : `element` (ou chaque élément du tableau) est déjà attaché au document — c'est
 * l'ancre qui rend le rapatriement possible à la fermeture.
 */
export function popOutWindow(id, element, opts){
  const o = opts || {};
  const existante = _popped[id];
  if(existante && !existante.win.closed){ existante.win.focus(); return existante; }
  if(!element) return false;

  // Comme `external-editor.js` : pas de chaîne de features, sinon le navigateur ouvre un
  // popup sans chrome au lieu d'un onglet normal — bien moins pratique à manipuler (pas de
  // barre d'adresse, pas d'onglets, redimensionnement malaisé selon l'OS).
  const win = window.open('', 'panel-' + id);
  if(!win){
    setStatus('Autorisez les popups pour ce site pour détacher ce panneau en fenêtre.', 4000);
    return false;
  }

  win.document.title = o.title || id;
  // Les feuilles de style de la page principale, clonées : sans elles, l'élément adopté
  // s'affiche sans AUCUNE mise en forme dans son document neuf.
  document.querySelectorAll('link[rel="stylesheet"]').forEach(function(link){
    win.document.head.appendChild(win.document.importNode(link, true));
  });
  // Le thème (clair/sombre) est un attribut de `<html>`, pas une feuille de style : sans le
  // copier, la fenêtre poppée s'ouvrirait toujours claire.
  if(document.documentElement.dataset.theme){
    win.document.documentElement.dataset.theme = document.documentElement.dataset.theme;
  }
  win.document.head.insertAdjacentHTML('beforeend',
    '<style>html,body{margin:0;height:100%;}'
    + '.win-body{height:100%;display:flex;flex-direction:column;overflow:hidden;}'
    + '.win-body>.dock-toolbar{flex:0 0 auto;}'
    + '.win-body>*:not(.dock-toolbar){flex:1;min-height:0;}</style>');
  const body = win.document.createElement('div');
  body.className = 'win-body';
  win.document.body.appendChild(body);

  const elements = Array.isArray(element) ? element.filter(Boolean) : [element];
  const anchors = elements.map(function(el){
    const anchor = document.createComment('popup:' + id);
    if(el.parentNode){
      el.parentNode.insertBefore(anchor, el);
    } else {
      // Sans parent, l'ancre ne peut pas être posée : l'élément sera adopté quand même dans
      // la popup, mais _repatrierPopup n'aura nulle part où le remettre à la fermeture — il
      // serait perdu SANS AUCUN signal si on ne le disait pas ici.
      logConsole('warn', 'popOutWindow(' + id + ') : élément non attaché au document, '
        + 'il ne pourra pas être rapatrié à la fermeture de la fenêtre.', null);
    }
    body.appendChild(win.document.adoptNode(el));
    el.style.display = '';
    return anchor;
  });

  const state = {win: win, anchors: anchors, elements: elements, onFermeture: o.onFermeture || null};
  _popped[id] = state;

  // Fermer par la croix DE L'OS (Alt+F4, bouton natif de la fenêtre) doit rapatrier le
  // panneau comme la croix de la fenêtre en page — sinon fermer une fenêtre OS ferait
  // DISPARAÎTRE le panneau. `pagehide` (pas `beforeunload`) : il se déclenche à coup sûr à la
  // fermeture, sans dialogue de confirmation qui bloquerait le retour du DOM.
  win.addEventListener('pagehide', function(){
    if(_popped[id] !== state) return;   // déjà rapatrié par popInWindow()
    _repatrierPopup(id, state);
    if(state.onFermeture) state.onFermeture();
  });

  return state;
}

/** Rend les éléments à leur ancre, dans LE DOCUMENT PRINCIPAL — sans toucher à la fenêtre. */
export function _repatrierPopup(id, state){
  state.elements.forEach(function(el, i){
    const anchor = state.anchors[i];
    if(anchor && anchor.parentNode){
      anchor.parentNode.insertBefore(document.adoptNode(el), anchor);
      anchor.parentNode.removeChild(anchor);
    }
    el.style.display = 'none';
  });
  delete _popped[id];
}

/**
 * Ramène un panneau poppé dans la page, sans attendre que l'utilisateur ferme la fenêtre OS
 * lui-même (bouton « Redocker », ou dépôt précis sur une zone).
 *
 * `sansRappel` : comme `closeWindow` — ne pas appeler `onFermeture` quand c'est NOUS qui
 * décidons de fermer (le menu, un redock précis), pas la fenêtre qui se ferme d'elle-même.
 *
 * Suppose que les éléments popOutWindow-és étaient attachés au document à l'ouverture (sinon
 * un avertissement a déjà été loggé et l'élément ne sera pas rapatrié ici).
 */
export function popInWindow(id, sansRappel){
  const state = _popped[id];
  if(!state) return false;
  _repatrierPopup(id, state);
  if(!state.win.closed) state.win.close();
  if(!sansRappel && state.onFermeture) state.onFermeture();
  return true;
}
