// moteur/js/game-ui.js
// Rendu de l'interface de jeu : moteur PARTAGÉ éditeur/build (voir js/build.js).
// Rien ici ne connaît l'éditeur ni le runtime : une fonction reçoit un conteneur DOM,
// une liste de Noeuds (THREE.Object3D), une callback d'événement et un résolveur de
// document, et rend du DOM. Le HTML/CSS n'est plus inline sur userData.uiDoc (qui ne
// porte que documentUIId/feuilleStyleIds/valeurs) : il vit sur des assets documentUI/
// feuilleStyle, résolus par `resoudreDocument(node, uiDoc)` fourni par l'appelant
// (éditeur : lit `assets` ; build : lit `assetsById`) — ce module reste agnostique
// de la notion d'asset, comme il l'était déjà agnostique de l'éditeur/du runtime.

// ---------- Images du projet dans le CSS ----------
// `url("asset:Jardin")` dans une feuille de style désigne la TEXTURE du projet nommée « Jardin ».
// Sans ça, une interface ne pouvait montrer aucune image du projet : le CSS d'un document vit dans
// un asset, pas à côté des fichiers, et une URL relative n'y désigne rien. C'était le seul obstacle
// pour reprendre tel quel l'écran d'un prototype web (un fond `background: url(garden.png)`).
// `urlOf(name)` rend l'URL affichable de la texture, ou null : une référence inconnue est laissée
// telle quelle, et le navigateur l'ignore sans casser le reste de la règle.
export function resolveCssAssetUrls(css, urlOf) {
  if (!css || typeof urlOf !== 'function') return css;
  return String(css).replace(/url\(\s*(['"]?)asset:([^'")]+)\1\s*\)/g, function (whole, quote, name) {
    const url = urlOf(name.trim());
    return url ? 'url("' + url + '")' : whole;
  });
}

// ---------- Scoping CSS minimal ----------
// Découpe sur les accolades ; préfixe chaque sélecteur de règle par un id unique pour
// qu'un document n'affecte pas le style d'un autre document open en même temps
// (HUD + menu pause). Les at-rules (@media, @keyframes...) sont recopiées telles
// quelles avec leur bloc interne — un pourcentage de @keyframes n'est pas un sélecteur.
export function _findBraceClosing(css, depuis) {
  let depth = 0;
  for (let j = depuis; j < css.length; j++) {
    if (css[j] === '{') depth++;
    else if (css[j] === '}') { depth--; if (depth === 0) return j; }
  }
  return css.length - 1;
}

export function _scopeSelector(selector, prefixe) {
  return selector.split(',').map(function (s) { return prefixe + ' ' + s.trim(); }).join(', ');
}

export function scopeCss(css, idPrefixe) {
  if (!css) return '';
  const prefixe = '#' + idPrefixe;
  let result = '';
  let i = 0;
  while (i < css.length) {
    const brace = css.indexOf('{', i);
    if (brace === -1) { result += css.slice(i); break; }
    const raw = css.slice(i, brace);
    const header = raw.trim();
    const prefixeSpaces = raw.slice(0, raw.length - raw.trimStart().length);
    const end = _findBraceClosing(css, brace);
    if (!header) { result += css.slice(i, end + 1); i = end + 1; continue; }
    // LES AT-RULES SANS BLOC (`@charset "UTF-8";`, `@import url(…);`, `@namespace …;`) se
    // terminent par un POINT-VIRGULE, pas par une accolade. Sans ce cas, elles se retrouvaient
    // collées au sélecteur suivant dans le même `header` : celui-ci commençait alors par `@`, et
    // la règle qui suivait était recopiée SANS ÊTRE CANTONNÉE. Une feuille de style qui commence
    // par `@charset` — ce qui est courant, et ce qu'écrit le portage de jeux/Chromelo — voyait
    // donc sa première règle fuir sur toute la page. On les émet telles quelles et on reprend
    // juste après, pour que le sélecteur retrouve son traitement normal.
    const lastSemicolon = raw.lastIndexOf(';');
    if (header[0] === '@' && lastSemicolon !== -1) {
      result += css.slice(i, i + lastSemicolon + 1);
      i += lastSemicolon + 1;
      continue;
    }
    if (header[0] === '@') {
      // LES @media/@supports/@container CONTIENNENT DES RÈGLES, et leurs sélecteurs doivent être
      // cantonnés comme les autres. Ils étaient recopiés TELS QUELS avec tout leur bloc : le CSS
      // responsive d'un document s'appliquait donc à la page ENTIÈRE — l'interface de l'éditeur
      // comprise — au lieu du seul conteneur du document. Mesuré sur jeux/Chromelo, dont les
      // quatre `@media` retaillent `.game`, `.hud` et les bulles.
      //
      // `@keyframes`, `@font-face` et `@property` restent recopiés tels quels, et c'est
      // délibéré : ce qu'ils contiennent (`0%`, `from`, des descripteurs) N'EST PAS un sélecteur,
      // le préfixer donnerait une animation morte.
      if (/^@(media|supports|container|layer|scope)\b/i.test(header)) {
        const openInner = css.indexOf('{', i);
        result += css.slice(i, openInner + 1)
          + scopeCss(css.slice(openInner + 1, end), idPrefixe)
          + '}';
      } else {
        result += css.slice(i, end + 1);
      }
    } else {
      result += prefixeSpaces + _scopeSelector(header, prefixe) + css.slice(brace, end + 1);
    }
    i = end + 1;
  }
  return result;
}

// ---------- Ce qui est CLIQUABLE dans un document ----------
//
// LE PIÈGE QUI A COÛTÉ LE PLUS CHER À L'USAGE, et il ne produit AUCUNE erreur : la couche qui
// accueille les documents est en `pointer-events:none` (`#rj-ui` dans game-preview.html,
// `#ui-layer` dans css/panels.css), pour qu'un HUD plein écran ne bloque pas les clics sur la
// scène 3D derrière. Seule la classe `.ui-button` réactivait les clics — une classe que le
// moteur lui-même posait sur ses boutons, du temps de l'ancienne UI plate.
//
// Résultat pour une interface écrite à la main ou reprise d'un prototype web, qui n'a aucune
// raison de connaître cette classe : RIEN N'EST CLIQUABLE. Pas une erreur en console, pas un
// avertissement — les événements ne partent simplement jamais. On cherche le défaut dans son
// script, qui est pourtant juste. Mesuré sur jeux/Chromelo, dont tous les boutons sont des
// `<button>` ordinaires.
//
// Ces règles de base remplacent l'heuristique par la seule règle qui tienne : CE QUI EST
// INTERACTIF EST CLIQUABLE. Elles sont posées AVANT le CSS de l'auteur, donc il peut toujours
// les contredire — un `pointer-events:none` explicite sur un élément décoratif reste possible.
//
// La racine du document reste, elle, en `pointer-events:none` (héritée de la couche) : un HUD
// continue de laisser passer les clics dans ses zones vides. Un document qui est une PAGE entière
// et doit tout intercepter le déclare sur son propre élément racine, comme sur le web.
export function baseRulesUIDoc(id) {
  const p = '#' + id + ' ';
  const cibles = ['a[href]', 'button', 'input', 'select', 'textarea', 'label',
                  'canvas', 'video', 'audio', 'summary',
                  '[data-event]', '[data-bind]', '[contenteditable]', '[tabindex]'];
  return cibles.map(function (s) { return p + s; }).join(',')
    + '{pointer-events:auto}\n';
}

// ---------- Rendu ----------
// Cache par Noeud : évite de réécrire innerHTML/CSS à chaque appel (perdrait le focus
// d'un <input> en cours de saisie côté joueur) quand rien n'a changé depuis le dernier appel.
export const _renderUIDoc = new WeakMap();

// Suivi par CONTENEUR (et non global au module) des ids DOM rendus lors du dernier appel,
// pour pouvoir unregister du DOM ceux dont le Noeud a disparu de `noeuds` entre deux appels
// (ex: objet supprimé de la scène). La WeakMap `_renderUIDoc` est indexée par Noeud et ne
// permet pas d'itérer les Noeuds disparus ; on garde donc ici une structure itérable
// id -> {div, style, node} par conteneur.
export const _idsRenderedByContainer = new WeakMap();

export function _idDom(node) { return 'ui-doc-' + node.id; }

// `auEvenement(name, valeur)` est appelé au clic sur tout élément [data-event] sans
// [data-bind], ou au changement d'un élément [data-bind] (qui met aussi à jour
// uiDoc.valeurs[key]). Un élément portant les deux attributs n'émet qu'une fois, via le
// listener change/input (avec la vraie valeur), pas via le clic.
export function uiDocumentsRedraw(container, nodes, atEvent, resolveDocument) {
  const vus = new Set();
  let rendered = _idsRenderedByContainer.get(container);
  if (!rendered) {
    rendered = new Map();
    _idsRenderedByContainer.set(container, rendered);
  }
  nodes.forEach(function (node) {
    const uiDoc = node.userData && node.userData.uiDoc;
    if (!uiDoc) return;
    const doc = resolveDocument(node, uiDoc);
    if (!doc) return;
    const active = node.visible !== false;
    const id = _idDom(node);
    vus.add(id);
    let state = _renderUIDoc.get(node);
    if (!state) {
      const div = document.createElement('div');
      div.id = id;
      const style = document.createElement('style');
      style.id = id + '-style';
      container.appendChild(div);
      container.appendChild(style);
      state = {div: div, style: style, html: null, css: null, fingerprint: null};
      _renderUIDoc.set(node, state);
      div.addEventListener('click', function (e) {
        const target = e.target.closest ? e.target.closest('[data-event]') : null;
        if (target && !target.dataset.bind && atEvent) atEvent(target.dataset.event, undefined);
      });
      div.addEventListener('input', function (e) { _OnChangeBind(e, uiDoc, atEvent); });
      div.addEventListener('change', function (e) { _OnChangeBind(e, uiDoc, atEvent); });
    }
    rendered.set(id, {div: state.div, style: state.style, node: node});
    state.div.style.display = active ? 'block' : 'none';
    // LES VALEURS SONT REPOSÉES DÈS QU'ELLES CHANGENT, et c'est un correctif.
    //
    // `_appliquerValeursBind` n'était appelé QUE dans la branche « le HTML a changé » ci-dessous.
    // Le HTML vit sur un asset et ne change jamais pendant une partie : les liaisons étaient donc
    // posées à la PREMIÈRE image et plus jamais ensuite. Un script qui écrit `valeurs.score` à
    // chaque image affichait le score de la première image, pour toujours, sans une erreur — le
    // symptôme se lit comme « mon script ne tourne pas », et on va chercher le défaut dans le
    // script. Mesuré en écrivant un HUD (jeux/NeonBreach) : score, vague et vie restaient figés.
    //
    // L'empreinte évite de réécrire le DOM à chaque image quand rien n'a bougé : un HUD ne change
    // que quelques fois par seconde, et `textContent` sur trente éléments à 120 images/s se paie.
    const htmlNew = state.html !== doc.html;
    if (htmlNew) {
      state.div.innerHTML = doc.html || '';
      state.html = doc.html;
      state.index = null;
      state.last = null;
    }
    // INCRÉMENTAL : seules les clés qui ont changé depuis l'image précédente sont reposées, sur
    // les seuls éléments qui les lient (index construit une fois par HTML). Avant, une seule
    // valeur modifiée — un compte à rebours, une barre de vie — resérialisait TOUTES les valeurs
    // (JSON.stringify à chaque image) puis réécrivait tous les éléments liés : 70 à 90 sur le
    // HUD de jeux/Donjons, chaque image, ce qui pesait lourd sur téléphone.
    const changed = _changedKeys(state, uiDoc.values);
    if (htmlNew || changed === null) {
      state.index = _bindIndex(state.div);
      _applyValuesBind(state.div, uiDoc.values);
    } else if (changed.length) {
      if (typeof applyLocaleBind === 'function') applyLocaleBind(state.div);
      _applyChangedBind(state.index, uiDoc.values, changed);
    }
    _applyUIScale(container, state, uiDoc);
    if (state.css !== doc.css) {
      state.style.textContent = baseRulesUIDoc(id) + scopeCss(doc.css, id);
      state.css = doc.css;
    }
  });

  // Nettoyage : retire du DOM les UIDocument rendus lors d'un appel précédent mais absents
  // de `vus` cette fois (Noeud supprimé de la scène, uiDoc retiré, etc.).
  rendered.forEach(function (info, id) {
    if (vus.has(id)) return;
    if (info.div && info.div.remove) info.div.remove();
    if (info.style && info.style.remove) info.style.remove();
    if (info.node) _renderUIDoc.delete(info.node);
    rendered.delete(id);
  });
}

// Les clés changées depuis le dernier appel (null : tout reposer — premier passage). Comparaison
// par identité pour les scalaires, par sérialisation pour un objet/tableau (rare dans un HUD).
export function _changedKeys(state, values) {
  const v = values || {};
  const first = !state.last;
  const last = state.last || (state.last = {});
  const out = [];
  for (const k in v) {
    const x = v[k];
    const snap = (x !== null && typeof x === 'object') ? _fingerprintValues(x) : x;
    if (!(k in last) || last[k] !== snap) { last[k] = snap; out.push(k); }
  }
  return first ? null : out;
}

// clé → éléments qui la lient, pour chaque sorte de liaison.
export function _bindIndex(div) {
  const idx = {text: new Map(), cls: new Map(), rich: new Map()};
  if (!div || !div.querySelectorAll) return idx;
  const add = function (m, k, el) { if (k === undefined || k === null) return; let a = m.get(k); if (!a) m.set(k, a = []); a.push(el); };
  div.querySelectorAll('[data-bind], [data-bind-class], [data-bind-rich]').forEach(function (el) {
    add(idx.rich, el.dataset.bindRich, el);
    add(idx.cls, el.dataset.bindClass, el);
    add(idx.text, el.dataset.bind, el);
  });
  return idx;
}

export function _applyChangedBind(idx, values, keys) {
  if (!idx) return;
  keys.forEach(function (k) {
    const v = values[k];
    (idx.rich.get(k) || []).forEach(function (el) { _applyRichBind(el, v); });
    (idx.cls.get(k) || []).forEach(function (el) { _applyClassBind(el, v); });
    (idx.text.get(k) || []).forEach(function (el) { _applyOneBind(el, v); });
  });
}

// ---------- Mise à l'échelle (référence Unity : Canvas Scaler « Scale With Screen Size ») ----------
// Une interface écrite en pixels pour 1280×720 débordait d'un téléphone (844×390 en paysage) :
// textes coupés, panneaux hors écran. Le UIDocument déclare sa résolution de référence et le
// moteur met tout le document à l'échelle d'un bloc. `scaleMode` :
//   'none'   — rien (défaut, comportement historique) ;
//   'fit'    — tout tient à l'écran (min des deux rapports) — ce qu'il faut à un HUD ;
//   'fill'   — remplit (max des deux rapports) ;
//   'match'  — mélange logarithmique largeur/hauteur selon `match` (0 = largeur, 1 = hauteur).
// `maxScale` (défaut 1) évite qu'un écran 4K agrandisse le pixel-art au-delà du dessin d'origine.
export function uiScaleFactor(cfg, w, h) {
  const c = cfg || {};
  const mode = c.scaleMode || 'none';
  if (mode === 'none' || !(w > 0) || !(h > 0)) return 1;
  const rw = Number(c.referenceWidth) > 0 ? Number(c.referenceWidth) : 1280;
  const rh = Number(c.referenceHeight) > 0 ? Number(c.referenceHeight) : 720;
  const sx = w / rw, sy = h / rh;
  let k;
  if (mode === 'fit') k = Math.min(sx, sy);
  else if (mode === 'fill') k = Math.max(sx, sy);
  else {
    const m = Math.max(0, Math.min(1, Number.isFinite(Number(c.match)) ? Number(c.match) : 0.5));
    k = Math.pow(2, Math.log2(sx) * (1 - m) + Math.log2(sy) * m);
  }
  const max = Number(c.maxScale) > 0 ? Number(c.maxScale) : 1;
  const min = Number(c.minScale) > 0 ? Number(c.minScale) : 0.25;
  return Math.max(min, Math.min(max, k));
}

// La taille du conteneur, lue par ResizeObserver et non à chaque image : lire clientWidth
// juste après avoir écrit le DOM forcerait une mise en page complète par image.
const _containerSize = new WeakMap();
function _sizeOf(container) {
  let s = _containerSize.get(container);
  if (!s) {
    s = {w: container.clientWidth || (typeof innerWidth === 'number' ? innerWidth : 0),
         h: container.clientHeight || (typeof innerHeight === 'number' ? innerHeight : 0)};
    _containerSize.set(container, s);
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(function (entries) {
        const r = entries[0] && entries[0].contentRect;
        if (r) { s.w = r.width; s.h = r.height; }
      }).observe(container);
    }
  }
  return s;
}

function _applyUIScale(container, state, cfg) {
  const mode = cfg && cfg.scaleMode;
  if (!mode || mode === 'none') {
    if (state.scaleKey) {
      const st = state.div.style;
      ['position', 'left', 'top', 'width', 'height', 'transform', 'transformOrigin'].forEach(function (p) { st[p] = ''; });
      state.scaleKey = '';
    }
    return;
  }
  const size = _sizeOf(container);
  const k = uiScaleFactor(cfg, size.w, size.h);
  const key = k.toFixed(4) + '|' + size.w + 'x' + size.h;
  if (key === state.scaleKey) return;
  state.scaleKey = key;
  const st = state.div.style;
  st.position = 'absolute'; st.left = '0'; st.top = '0';
  st.width = (size.w / k) + 'px'; st.height = (size.h / k) + 'px';
  st.transform = 'scale(' + k + ')'; st.transformOrigin = '0 0';
}

// L'empreinte des valeurs liées. Comparer l'objet ne dirait rien (c'est le même objet, muté en
// place) ; sérialiser est le seul moyen honnête, et un HUD ne porte qu'une poignée de scalaires.
// Une valeur non sérialisable (cycle, fonction) rend une empreinte unique, donc « toujours
// changé » : on repose alors les liaisons à chaque image plutôt que de ne plus les reposer.
export function _fingerprintValues(values) {
  if (!values) return '';
  try { return JSON.stringify(values); }
  catch (e) { return String(Math.random()); }
}

export function _OnChangeBind(e, uiDoc, atEvent) {
  const target = e.target.closest ? e.target.closest('[data-bind]') : null;
  if (!target) return;
  const key = target.dataset.bind;
  const value = target.type === 'checkbox' ? target.checked : target.value;
  uiDoc.values[key] = value;
  if (atEvent && target.dataset.event) atEvent(target.dataset.event, value);
}

// Un champ de saisie recoit une VALEUR ; tout le reste recoit du TEXTE.
export function _isFieldOfInput(el) {
  const t = el.tagName;
  return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT';
}

// LA CLASSE EST LIABLE, PAS SEULEMENT LE TEXTE (`data-bind-class`).
//
// `data-bind` ne sait écrire que du texte ou une valeur de champ, et une feuille de style ne peut
// pas réagir à du texte. Tout ce qui fait le nerf d'un HUD de jeu — un voile rouge quand on prend
// un coup, une vie qui pulse en rouge sous 30 %, un palier de combo qui change de couleur, un
// réticule qui claque sur un impact — était donc hors de portée d'un script, alors que le CSS de
// l'asset le décrit en trois lignes. La classe de BASE écrite dans le HTML est conservée : la
// valeur liée s'y ajoute, sinon lier une classe effacerait la mise en page de l'élément.
export function _applyClassBind(el, value) {
  if (el.dataset.bindClassBase === undefined) el.dataset.bindClassBase = el.className || '';
  const base = el.dataset.bindClassBase;
  const add = (value === null || value === undefined || value === false) ? '' : String(value);
  el.className = (base && add) ? (base + ' ' + add) : (base || add);
}

// UN CHAMP EN COURS DE SAISIE N'EST PAS ÉCRASÉ. Les liaisons sont maintenant reposées à chaque
// changement de valeur : sans cette garde, un script qui touche à `valeurs` pendant que le joueur
// tape son nom lui remettrait le caret au end du champ à chaque frappe.
export function _fieldSeized(el) {
  return typeof document !== 'undefined' && document.activeElement === el;
}

export function _applyValuesBind(containerDiv, values) {
  // LES TRADUCTIONS D'ABORD, LES VALEURS ENSUITE, et l'ordre est un contrat : `data-t` pose un
  // libellé fixe traduit, `data-bind` pose une valeur que le script calcule. Un élément qui
  // porterait les deux doit finir par la valeur — un libellé traduit puis rempli, jamais
  // l'inverse. Voir js/locale.js. `typeof` : ce module est chargé par les pages de jeu, mais
  // game-ui.js est partagé et se veut tolérant à son absence.
  if (typeof applyLocaleBind === 'function') applyLocaleBind(containerDiv);
  if (!values || !containerDiv.querySelectorAll) return;
  // UN SEUL passage, et le tri se fait sur les ATTRIBUTS présents, pas sur le sélecteur qui a
  // ramené l'élément : un même élément peut porter les deux liaisons.
  containerDiv.querySelectorAll('[data-bind], [data-bind-class], [data-bind-rich]').forEach(function (el) {
    const keyRich = el.dataset.bindRich;
    if (keyRich !== undefined && keyRich !== null && (keyRich in values)) _applyRichBind(el, values[keyRich]);
    const keyClass = el.dataset.bindClass;
    if (keyClass !== undefined && keyClass !== null && (keyClass in values)) {
      _applyClassBind(el, values[keyClass]);
    }
    const key = el.dataset.bind;
    if (key === undefined || key === null) return;
    if (!(key in values)) return;
    _applyOneBind(el, values[key]);
  });
}

export function _applyOneBind(el, value) {
    if (_fieldSeized(el)) return;
    // UN ELEMENT QUI N'EST PAS UN CHAMP RECOIT LE TEXTE. Avant, `el.value = ...` posait une
    // propriete JS sur un <div> : aucune erreur, et rien a l'ecran. Un script ne pouvait donc
    // afficher AUCUN texte dans l'interface du jeu — le seul rendu possible etait un champ de
    // saisie, ce que personne n'ecrit pour un score, un niveau ou un compte a rebours.
    if (!_isFieldOfInput(el)) { el.textContent = String(value); return; }
    if (el.type === 'checkbox') el.checked = !!value;
    else el.value = value;
}

// ---------- Texte riche (`data-bind-rich`) ----------
// Né dans jeux/Donjons (script « Lib_Texte ») et remonté dans le moteur pour tous les projets.
// Un élément `data-bind-rich="cle"` reçoit la valeur liée comme TEXTE BALISÉ : couleurs, gras,
// effets animés lettre par lettre ([wave], [shake], [rainbow]…). Avec `data-typewriter="45"`,
// le texte s'écrit lettre par lettre (45 lettres/s) à chaque changement de valeur.
//
// L'apparition est entièrement en CSS (un délai d'animation par lettre) : aucun travail par image,
// pas de boucle à appeler depuis un script, et le DOM n'est réécrit que quand la valeur change.
// Une balise inconnue reste affichée telle quelle ; le HTML de la valeur est échappé (une valeur
// liée vient souvent du joueur : un pseudo ne doit pas pouvoir injecter de balises).
const RICH_COLORS = {'red': '#ff5a5a', 'orange': '#ffa23a', 'yellow': '#ffe24a', 'green': '#6bff8a', 'cyan': '#5ee6ff',
  'blue': '#6aa5ff', 'purple': '#b78cff', 'pink': '#ff8ad8', 'white': '#ffffff', 'gold': '#ffcf3a', 'gray': '#a8a8b8',
  'black': '#101018',
  // Noms français : le balisage est du CONTENU écrit par l'auteur du jeu, pas du code.
  rouge: '#ff5a5a', 'jaune': '#ffe24a', 'vert': '#6bff8a', 'bleu': '#6aa5ff', 'violet': '#b78cff', 'rose': '#ff8ad8',
  'blanc': '#ffffff', 'or': '#ffcf3a', 'gris': '#a8a8b8', 'noir': '#101018'};
const RICH_ALIASES = {'arc': 'rainbow', 'tremble': 'shake', 'vague': 'wave', 'saut': 'bounce', 'lueur': 'glow',
  'bold': 'b', 'italic': 'i', 'underline': 'u', 'strike': 's', 'c': 'color', 'couleur': 'color', 'taille': 'size',
  'grand': 'big', 'petit': 'small', 'fantome': 'ghost', 'scintille': 'sparkle', 'balance': 'swing', 'feu': 'fire',
  'glace': 'ice', 'contour': 'outline', 'ombre': 'shadow', 'fin': 'end'};
const RICH_EFFECTS = ['rainbow', 'shake', 'wave', 'bounce', 'pulse', 'sparkle', 'swing', 'fire', 'ice',
  'glitch', 'ghost', 'shadow', 'outline'];
const RICH_STATIC_EFFECTS = ['shadow', 'outline'];
const RICH_OTHER_TAGS = ['b', 'i', 'u', 's', 'color', 'size', 'big', 'small', 'glow', 'pause', 'end'];
export const RICH_TEXT_SPEED = 45;

export const RICH_TEXT_CSS = [
  '.rt-word{display:inline-block;white-space:nowrap}',
  '.rt-ch{white-space:pre-wrap}',
  '.rt-reveal{animation:rt-reveal 0s linear both}',
  '@keyframes rt-reveal{from{visibility:hidden}to{visibility:visible}}',
  // `rt-skip` sur l'élément (par data-bind-class) : la machine à écrire finit d'un coup.
  '.rt-skip .rt-reveal{animation:none}',
  '.rt-anim{display:inline-block;animation-delay:calc(var(--i,0) * var(--dl,-0.1s));animation-iteration-count:infinite;animation-timing-function:linear}',
  '.rt-rainbow{animation-name:rt-rainbow;animation-duration:2.2s;--dl:-0.13s}',
  '@keyframes rt-rainbow{0%{color:#ff4d4d}17%{color:#ffb84d}33%{color:#f2ff4d}50%{color:#4dff7a}67%{color:#4dc3ff}83%{color:#b04dff}100%{color:#ff4d4d}}',
  '.rt-shake{animation-name:rt-shake;animation-duration:.22s;animation-timing-function:steps(1,end);--dl:-0.057s}',
  '@keyframes rt-shake{0%{transform:translate(0,0)}20%{transform:translate(-.06em,.05em)}40%{transform:translate(.05em,-.06em)}60%{transform:translate(-.04em,-.04em)}80%{transform:translate(.06em,.04em)}100%{transform:translate(0,0)}}',
  '.rt-wave{animation-name:rt-wave;animation-duration:1.1s;animation-timing-function:ease-in-out;--dl:-0.09s}',
  '@keyframes rt-wave{0%,100%{transform:translateY(.12em)}50%{transform:translateY(-.28em)}}',
  '.rt-bounce{animation-name:rt-bounce;animation-duration:.9s;animation-timing-function:ease-out;--dl:-0.07s}',
  '@keyframes rt-bounce{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-.4em)}}',
  '.rt-pulse{animation-name:rt-pulse;animation-duration:.8s;animation-timing-function:ease-in-out;--dl:-0.05s}',
  '@keyframes rt-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.3)}}',
  '.rt-sparkle{animation-name:rt-sparkle;animation-duration:1.3s;animation-timing-function:steps(1,end);--dl:-0.21s}',
  '@keyframes rt-sparkle{0%{opacity:1;text-shadow:0 0 .5em #fff}15%{opacity:.35;text-shadow:none}30%{opacity:1;text-shadow:0 0 .8em #fff}55%{opacity:.6;text-shadow:none}70%{opacity:1;text-shadow:0 0 .4em #fff}100%{opacity:1}}',
  '.rt-swing{animation-name:rt-swing;animation-duration:1.4s;animation-timing-function:ease-in-out;transform-origin:50% 90%;--dl:-0.12s}',
  '@keyframes rt-swing{0%,100%{transform:rotate(-9deg)}50%{transform:rotate(9deg)}}',
  '.rt-fire{animation-name:rt-fire;animation-duration:.6s;animation-timing-function:ease-in-out;transform-origin:50% 100%;--dl:-0.083s}',
  '@keyframes rt-fire{0%{color:#ffe24a;transform:translateY(0) scaleY(1);text-shadow:0 0 .4em #ff7a1a}33%{color:#ff9a2a;transform:translateY(-.06em) scaleY(1.12);text-shadow:0 0 .6em #ff4a1a}66%{color:#ff5a2a;transform:translateY(.02em) scaleY(.95);text-shadow:0 0 .5em #ff7a1a}100%{color:#ffe24a;transform:translateY(0) scaleY(1);text-shadow:0 0 .4em #ff7a1a}}',
  '.rt-ice{animation-name:rt-ice;animation-duration:2s;animation-timing-function:ease-in-out;--dl:-0.15s}',
  '@keyframes rt-ice{0%,100%{color:#9be8ff;text-shadow:0 0 .35em #4dc3ff}50%{color:#ffffff;text-shadow:0 0 .7em #bff2ff}}',
  '.rt-glitch{animation-name:rt-glitch;animation-duration:1.6s;animation-timing-function:steps(1,end);--dl:-0.31s}',
  '@keyframes rt-glitch{0%,86%,100%{transform:translate(0,0);text-shadow:none}88%{transform:translate(.08em,-.03em) skewX(-14deg);text-shadow:-.07em 0 #ff3a6a,.07em 0 #3affd8}92%{transform:translate(-.1em,.02em);text-shadow:.07em 0 #ff3a6a,-.07em 0 #3affd8}96%{transform:translate(.03em,0) skewX(10deg);text-shadow:none}}',
  '.rt-ghost{animation-name:rt-ghost;animation-duration:2.4s;animation-timing-function:ease-in-out;--dl:-0.17s}',
  '@keyframes rt-ghost{0%,100%{opacity:1}50%{opacity:.15}}',
  '.rt-shadow{text-shadow:.08em .1em 0 rgba(0,0,0,.75)}',
  '.rt-outline{text-shadow:-.05em 0 #000,.05em 0 #000,0 -.05em #000,0 .05em #000,-.04em -.04em #000,.04em .04em #000,-.04em .04em #000,.04em -.04em #000}'
].join('\n');

function _richColor(v) {
  v = String(v || '').trim().toLowerCase();
  return RICH_COLORS[v] || (/^#[0-9a-f]{3,8}$/.test(v) || /^(rgb|hsl)a?\([0-9.,%\s]*\)$/.test(v) ? v : null);
}

function _richApply(state, name, value) {
  if (name === 'b' || name === 'i' || name === 'u' || name === 's') state[name] = 1;
  else if (name === 'color') state.color = _richColor(value) || state.color;
  else if (RICH_COLORS[name]) state.color = RICH_COLORS[name];
  else if (name === 'size') state.size = Math.max(0.5, Math.min(3, parseFloat(value) || 1));
  else if (name === 'big') state.size = 1.4;
  else if (name === 'small') state.size = 0.8;
  else if (name === 'glow') state.glow = _richColor(value) || '#ffffff';
  else if (RICH_EFFECTS.indexOf(name) >= 0 && state.fx.indexOf(name) < 0) state.fx.push(name);
}

// Texte balisé → liste de {c, e} (une lettre et son style) et de {pause} (secondes).
// `[/]` ferme la dernière balise ouverte ; `[/nom]` ferme jusqu'à la balise « nom » incluse.
export function parseRichText(src) {
  src = String(src == null ? '' : src).replace(/\[\/\]/g, '[/end]');
  const items = [], stack = [];
  let state = {b: 0, i: 0, u: 0, s: 0, color: null, size: null, glow: null, fx: []};
  const re = /\[(\/?)([A-Za-zÀ-ÿ]+)(?:=([^\]]*))?\]/g;
  let pos = 0, m;
  function text(t) { for (let k = 0; k < t.length; k++) items.push({c: t.charAt(k), e: state}); }
  while ((m = re.exec(src))) {
    let name = m[2].toLowerCase();
    name = RICH_ALIASES[name] || name;
    const known = RICH_EFFECTS.indexOf(name) >= 0 || RICH_OTHER_TAGS.indexOf(name) >= 0 || !!RICH_COLORS[name];
    if (!known) continue;   // balise inconnue : elle reste affichée
    text(src.slice(pos, m.index)); pos = re.lastIndex;
    if (m[1]) {
      let n = stack.length - 1;
      if (name !== 'end') while (n >= 0 && stack[n].name !== name) n--;
      if (n >= 0) { state = stack[n].state; stack.length = n; }
    }
    else if (name === 'pause') items.push({pause: Math.max(0, Math.min(5, parseFloat(m[3]) || 0.4))});
    else if (name !== 'end') {
      stack.push({state: state, name: name});
      state = {b: state.b, i: state.i, u: state.u, s: state.s, color: state.color, size: state.size,
               glow: state.glow, fx: state.fx.slice()};
      _richApply(state, name, m[3]);
    }
  }
  text(src.slice(pos));
  return items;
}

// Le même texte sans balises (journal, bulle, longueur, comparaison).
export function stripRichText(src) {
  return parseRichText(src).filter(function (x) { return x.pause === undefined; })
    .map(function (x) { return x.c; }).join('');
}

function _escapeHtml(c) {
  return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : c;
}

// Délai d'apparition de chaque élément (machine à écrire). Les fins de phrase et les virgules
// marquent un temps d'arrêt ; `[pause=s]` en ajoute un explicite.
function _richTimes(items, speed) {
  const times = [], d = 1 / Math.max(1, speed);
  let t = 0;
  items.forEach(function (it, n) {
    if (it.pause !== undefined) { t += it.pause; times.push(null); return; }
    if (it.c === ' ' || it.c === '\n') { times.push(t); return; }
    t += d;
    times.push(t);
    const next = items[n + 1];
    if (!next || next.c === ' ' || next.c === '\n' || next.pause !== undefined) {
      if (/[.!?…]/.test(it.c)) t += 0.3; else if (/[,;:]/.test(it.c)) t += 0.14;
    }
  });
  return {times: times, total: t};
}

// Durée (secondes) de l'écriture d'un texte balisé à `speed` lettres par seconde.
export function richTextDuration(src, speed) {
  return _richTimes(parseRichText(src), speed || RICH_TEXT_SPEED).total;
}

// Texte balisé → HTML (spans stylés). `opts.speed` : machine à écrire (lettres/s), sinon tout
// s'affiche d'un coup. Le CSS des effets (RICH_TEXT_CSS) doit être présent dans la page.
export function richTextToHtml(src, opts) {
  const items = parseRichText(src);
  const speed = opts && opts.speed > 0 ? opts.speed : 0;
  const times = speed ? _richTimes(items, speed).times : null;
  let html = '', inWord = false, k = 0;
  items.forEach(function (it, n) {
    if (it.pause !== undefined) return;
    if (it.c === '\n') { if (inWord) { html += '</span>'; inWord = false; } html += '<br>'; return; }
    const e = it.e;
    let style = '--i:' + k++;
    if (e.b) style += ';font-weight:bold';
    if (e.i) style += ';font-style:italic';
    if (e.u || e.s) style += ';text-decoration:' + [e.u ? 'underline' : '', e.s ? 'line-through' : ''].join(' ').trim();
    if (e.color) style += ';color:' + e.color;
    if (e.size) style += ';font-size:' + e.size + 'em';
    if (e.glow) style += ';text-shadow:0 0 .35em ' + e.glow + ',0 0 .8em ' + e.glow;
    let cls = 'rt-ch';
    e.fx.forEach(function (f) {
      cls += ' rt-' + f;
      if (RICH_STATIC_EFFECTS.indexOf(f) < 0) cls += ' rt-anim';
    });
    let letter = '<span class="' + cls + '" style="' + style + '">' + _escapeHtml(it.c) + '</span>';
    // L'apparition vit sur un ENVELOPPANT : l'effet animé de la lettre garde son propre `animation`.
    if (times) letter = '<span class="rt-reveal" style="animation-delay:' + times[n].toFixed(3) + 's">' + letter + '</span>';
    if (it.c === ' ') { if (inWord) { html += '</span>'; inWord = false; } html += letter; return; }
    if (!inWord) { html += '<span class="rt-word">'; inWord = true; }
    html += letter;
  });
  if (inWord) html += '</span>';
  return html;
}

// Pose le CSS des effets une fois dans la page (sans DOM, ne fait rien).
export function ensureRichTextCss() {
  if (typeof document === 'undefined' || !document.getElementById || !document.head) return;
  if (document.getElementById('rich-text-css')) return;
  const s = document.createElement('style');
  s.id = 'rich-text-css';
  s.textContent = RICH_TEXT_CSS;
  document.head.appendChild(s);
}

// Un élément `data-bind-rich` n'est réécrit que si SA valeur a changé : les liaisons sont
// reposées dès qu'une valeur quelconque du document bouge, et réécrire relancerait la machine
// à écrire de toutes les bulles à chaque point de score marqué.
export function _applyRichBind(el, value) {
  const src = value === null || value === undefined ? '' : String(value);
  if (el._richSource === src) return;
  el._richSource = src;
  ensureRichTextCss();
  const speed = el.dataset.typewriter !== undefined ? (parseFloat(el.dataset.typewriter) || RICH_TEXT_SPEED) : 0;
  el.innerHTML = richTextToHtml(src, {speed: speed});
}

// `api.richText` (éditeur ET jeu publié : le même objet, importé des deux côtés).
export const RICH_TEXT_API = Object.freeze({
  strip: stripRichText,
  duration: richTextDuration,
  toHtml: function (src, speed) { return richTextToHtml(src, {speed: speed}); }
});
globalThis.RICH_TEXT_API = RICH_TEXT_API;
