// ---------- LA PALETTE D'OUTILS FLOTTANTE ----------
//
// Les outils qui agissent sur la VUE (gizmo, référentiel, création d'objets) étaient dans une
// barre pleine largeur en haut de l'écran, loin de l'endroit où l'on travaille. Ils sont
// maintenant posés SUR le viewport, à portée du curseur, et déplaçables.
//
// ELLE ADOPTE, ELLE NE RECONSTRUIT PAS. `#bar` reste écrit dans editor.html avec ses ids
// (`g-translate`, `g-rotate`, `g-scale`, `g-space`, `bar-types-creatable`) et ses écouteurs
// posés par js/scene.js ; la palette change seulement son parent. C'est le même contrat que
// js/ui/dock.js avec `#hier` et `#insp` — et c'est ce qui rend ce module incapable de casser
// le gizmo : il ne touche à aucun bouton.
//
// LA POSITION EST BORNÉE, PAS SEULEMENT MÉMORISÉE. Une position relue telle quelle est une
// palette qui disparaît : il suffit d'avoir réduit la fenêtre, changé d'écran, ou ouvert un
// panneau qui rétrécit le viewport entre deux sessions. `clampPosition` est donc appliquée à
// la relecture ET à chaque redimensionnement, pas seulement pendant le glissement.
import { palette } from '../objects.js';
import { Icons } from './icon.js';
import { Prefs } from './prefs.js';

export const FloatingPalette = (function(){

  // Le même registre que le dock : une position s'observe, elle ne se règle pas.
  const PREF_KEY = 'palette.position';

  // La marge minimale entre la palette et le bord du viewport. Non nulle : collée au bord,
  // la poignée de glissement devient impossible à viser.
  const MARGIN = 8;

  /**
   * Borne une position dans son hôte.
   *
   * PURE, et exposée pour ça : c'est la seule règle de ce module qu'on peut se tromper en
   * écrivant, et la seule dont l'erreur ne se voit pas tout de suite (elle attend un
   * redimensionnement). Elle ne lit aucun DOM et ne dépend d'aucun état.
   *
   * Quand la palette est PLUS GRANDE que son hôte — viewport écrasé par un panneau ouvert en
   * grand — il n'existe aucune position qui la contienne : on la cale alors sur la marge haute
   * et gauche, parce que c'est le coin où le contenu commence et donc celui qu'on veut voir.
   */
  function clampPosition(pos, palette, host){
    const p = pos || {};
    const w = (palette && palette.width) || 0;
    const h = (palette && palette.height) || 0;
    const hw = (host && host.width) || 0;
    const hh = (host && host.height) || 0;
    const maxX = hw - w - MARGIN;
    const maxY = hh - h - MARGIN;
    const x = Number.isFinite(p.x) ? p.x : MARGIN;
    const y = Number.isFinite(p.y) ? p.y : MARGIN;
    return {
      x: (maxX < MARGIN) ? MARGIN : Math.min(Math.max(x, MARGIN), maxX),
      y: (maxY < MARGIN) ? MARGIN : Math.min(Math.max(y, MARGIN), maxY)
    };
  }

  /**
   * La position relue depuis les préférences, ou celle de départ.
   *
   * Tolère tout ce que le stockage peut rendre : `null` jamais réglé, objet incomplet écrit
   * par une version antérieure, `NaN` venu d'un JSON abîmé. Aucun de ces cas n'est une erreur
   * — ils rendent tous le coin haut-gauche, où la palette est visible.
   */
  function storedPosition(prefs){
    const raw = (prefs && typeof prefs.get === 'function') ? prefs.get(PREF_KEY) : null;
    if(!raw || typeof raw !== 'object') return {x: MARGIN, y: MARGIN};
    const x = Number(raw.x);
    const y = Number(raw.y);
    return {
      x: Number.isFinite(x) ? x : MARGIN,
      y: Number.isFinite(y) ? y : MARGIN
    };
  }

  // ---------- Ce qui touche au DOM ----------

  let root = null;
  let host = null;

  function sizes(){
    return {
      palette: {width: root.offsetWidth, height: root.offsetHeight},
      host: {width: host.clientWidth, height: host.clientHeight}
    };
  }

  function place(pos){
    const s = sizes();
    const c = clampPosition(pos, s.palette, s.host);
    root.style.left = c.x + 'px';
    root.style.top = c.y + 'px';
    return c;
  }

  function save(pos){
    if(!Prefs) return;
    try { Prefs.set(PREF_KEY, {x: pos.x, y: pos.y}); }
    catch(e){ /* mode privé : la position vit le temps de la session */ }
  }

  function makeHeader(){
    const head = document.createElement('div');
    head.className = 'palette-head';
    head.title = 'Glisser pour déplacer la palette';
    const grip = (typeof Icons !== 'undefined') ? Icons.html('dots-six-vertical') : '';
    head.innerHTML = grip + '<span class="palette-title">Outils</span>';
    return head;
  }

  function startDrag(e, head){
    // `setPointerCapture` et non un écouteur sur `document` : sans lui, un glissement rapide
    // qui sort du viewport perd le `pointermove` et la palette reste collée au curseur.
    const start = root.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    const dx = e.clientX - start.left;
    const dy = e.clientY - start.top;
    let last = {x: start.left - hostRect.left, y: start.top - hostRect.top};

    function move(ev){
      const r = host.getBoundingClientRect();
      last = place({x: ev.clientX - r.left - dx, y: ev.clientY - r.top - dy});
    }
    function end(){
      head.removeEventListener('pointermove', move);
      head.removeEventListener('pointerup', end);
      head.removeEventListener('pointercancel', end);
      root.classList.remove('dragging');
      save(last);
    }
    root.classList.add('dragging');
    head.setPointerCapture(e.pointerId);
    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', end);
    head.addEventListener('pointercancel', end);
  }

  /**
   * Sort `#bar` de la coquille et le pose sur le viewport.
   *
   * Réentrante : appelée deux fois, elle ne fabrique pas deux palettes. Le démarrage de
   * l'éditeur n'est pas linéaire (les plugins tournent en dernier, startup.js), et un module
   * qui suppose n'être booté qu'une fois finit toujours par l'être deux.
   */
  function boot(){
    if(root) return root;
    host = document.getElementById('view');
    const bar = document.getElementById('bar');
    if(!host || !bar) return null;

    root = document.createElement('div');
    root.id = 'tool-palette';
    const head = makeHeader();
    root.appendChild(head);
    // L'ADOPTION : `#bar` garde son id, ses classes et ses écouteurs — il change de parent.
    root.appendChild(bar);
    host.appendChild(root);

    head.addEventListener('pointerdown', function(e){
      if(e.button !== 0) return;
      e.preventDefault();
      startDrag(e, head);
    });

    place(storedPosition(Prefs));

    // Le viewport rétrécit quand on ouvre un panneau ou qu'on tire une poignée du dock. Sans
    // ce ré-ancrage, la palette sort du cadre et devient inatteignable — sa position est
    // pourtant toujours « valide » dans les préférences, donc rien ne la ramènerait.
    if(typeof ResizeObserver === 'function'){
      new ResizeObserver(function(){
        place({x: root.offsetLeft, y: root.offsetTop});
      }).observe(host);
    }
    return root;
  }

  return {boot: boot, clampPosition: clampPosition, storedPosition: storedPosition,
          PREF_KEY: PREF_KEY, MARGIN: MARGIN};
})();

if (typeof globalThis !== 'undefined') globalThis.FloatingPalette = FloatingPalette;
