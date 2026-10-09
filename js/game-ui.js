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
    }
    const fingerprint = _fingerprintValues(uiDoc.values);
    if (htmlNew || fingerprint !== state.fingerprint) {
      _applyValuesBind(state.div, uiDoc.values);
      state.fingerprint = fingerprint;
    }
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
  containerDiv.querySelectorAll('[data-bind], [data-bind-class]').forEach(function (el) {
    const keyClass = el.dataset.bindClass;
    if (keyClass !== undefined && keyClass !== null && (keyClass in values)) {
      _applyClassBind(el, values[keyClass]);
    }
    const key = el.dataset.bind;
    if (key === undefined || key === null) return;
    if (!(key in values)) return;
    if (_fieldSeized(el)) return;
    // UN ELEMENT QUI N'EST PAS UN CHAMP RECOIT LE TEXTE. Avant, `el.value = ...` posait une
    // propriete JS sur un <div> : aucune erreur, et rien a l'ecran. Un script ne pouvait donc
    // afficher AUCUN texte dans l'interface du jeu — le seul rendu possible etait un champ de
    // saisie, ce que personne n'ecrit pour un score, un niveau ou un compte a rebours.
    if (!_isFieldOfInput(el)) { el.textContent = String(values[key]); return; }
    if (el.type === 'checkbox') el.checked = !!values[key];
    else el.value = values[key];
  });
}
