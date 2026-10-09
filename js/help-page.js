// ---------- Aide de l'éditeur : la mécanique de la page ----------
// Trois colonnes : le sommaire par PARTIES (repliables), la page, et « Sur cette page »
// (les intertitres de la page courante). La page courante est dans l'adresse
// (#identifiant) : un lien vers une page se copie, se met en favori, et Précédent /
// Suivant du navigateur marchent sans une ligne de plus.
//
// LA RECHERCHE a sa propre vue : taper dans le champ remplace la page par une liste de
// résultats, chacun avec l'extrait où le mot apparaît. Le sommaire, lui, se filtre aussi.
// Vider le champ rend la page qu'on lisait.
//
// Ce fichier contient aussi les TROIS générateurs de tableaux. Ils sont ici et pas dans
// help-content.js parce qu'ils lisent des tables du moteur (PROPS_MATERIAL) : le contenu
// reste du texte, la mécanique reste de la mécanique.
//
// Chargé aussi, par import dynamique, DEPUIS L'ÉDITEUR (copilot-inspect.js lit API_HELP
// via help-content.js, qui importe ce fichier) : tout ce qui touche au DOM de la page
// d'aide est donc gardé par la présence de #help-page.

import { API_HELP, COMMANDS_HELP, GLOSSARY_HELP, PAGES_HELP, PARTS_HELP, SHORTCUTS_HELP, linkHelp } from './help-content.js';
import { LEVELS_HELP } from './help/help-format.js';
import { PROPS_MATERIAL } from './material-props.js';

export function escapeHtmlHelp(s){
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const PAGE_HELP_DEFAULT = 'getting-started';
export let helpPageCurrent = PAGE_HELP_DEFAULT;
export let helpSearch = '';


// ---------- Générateurs de tableaux ----------

export function renderShortcutsHelp(){
  let h = '';
  let open = false;
  SHORTCUTS_HELP.forEach(function(r){
    if(r.group){
      if(open) h += '</table></div>';
      h += '<h3>' + escapeHtmlHelp(r.group) + '</h3>'
        + '<div class="help-array"><table>';
      open = true;
      return;
    }
    h += '<tr><td><kbd>' + escapeHtmlHelp(r.key) + '</kbd></td><td>' + r.effet + '</td></tr>';
  });
  if(open) h += '</table></div>';
  return h;
}

// Plage lisible d'une propriété de matériau, déduite de sa description — jamais recopiée.
export function rangePropMaterial(d){
  if(d.type === 'number'){
    const min = (d.min !== undefined) ? d.min : '—';
    const max = (d.max !== undefined) ? d.max : '—';
    return min + ' à ' + max;
  }
  if(d.type === 'choice'){
    return d.options.map(function(o){ return '<code>' + escapeHtmlHelp(o[0]) + '</code>'; }).join(' · ');
  }
  if(d.type === 'color') return '<code>#rrggbb</code>';
  if(d.type === 'checkbox') return 'coché / décoché';
  if(d.type === 'texture') return 'une texture du projet';
  if(d.type === 'pair') return 'deux nombres';
  return '';
}

export function renderPropsMaterialHelp(){
  let h = '<div class="help-array"><table>'
    + '<tr><th>Propriété</th><th>Champ</th><th>Plage</th><th>Demande</th><th>Ce que ça fait</th></tr>';
  PROPS_MATERIAL.forEach(function(d){
    // Les `note` de la table sont les encarts de l'inspecteur : leur place est dans le
    // panneau, à côté du champ concerné, pas dans un tableau de référence.
    if(d.note) return;
    if(d.section){
      h += '<tr><td colspan="5"><b>' + escapeHtmlHelp(d.section) + '</b></td></tr>';
      return;
    }
    const dep = d.requires
      ? d.requires.map(function(k){ return '<code>' + escapeHtmlHelp(k) + '</code>'; }).join(' ou ')
        + ' — sinon ' + (d.ifMissing === 'hidden' ? 'sans objet' : 'sans effet')
      : '';
    h += '<tr>'
      + '<td><code>' + escapeHtmlHelp(d.key) + '</code></td>'
      + '<td>' + escapeHtmlHelp(d.label) + '</td>'
      + '<td>' + rangePropMaterial(d) + '</td>'
      + '<td>' + dep + '</td>'
      + '<td>' + (d.help || '') + '</td>'
      + '</tr>';
  });
  return h + '</table></div>';
}

export function renderApiHelp(){
  let h = '';
  let open = false;
  API_HELP.forEach(function(e){
    if(e.group){
      if(open) h += '</table></div>';
      h += '<h3>' + escapeHtmlHelp(e.group) + '</h3><div class="help-array"><table>';
      open = true;
      return;
    }
    h += '<tr><td><code>' + escapeHtmlHelp(e.sig) + '</code></td><td>' + e.quoi + '</td></tr>';
  });
  if(open) h += '</table></div>';
  return h;
}

export function renderCommandsHelp(){
  return '<div class="help-array"><table>'
    + COMMANDS_HELP.map(function(c){
        return '<tr><td><code>' + escapeHtmlHelp(c.name) + '</code></td><td>' + c.quoi + '</td></tr>';
      }).join('')
    + '</table></div>';
}


// ---------- Pages, parties, ordre de lecture ----------

// Le glossaire n'est pas une page de PAGES_HELP (il est engendré depuis GLOSSARY_HELP) mais
// il a sa place dans le sommaire, dans la partie Référence.
const GLOSSARY_ENTRY = {id:'glossary', part:'reference', section:'Référence', title:'Glossaire',
  level:'both'};

export function pageHelpById(id){
  if(id === 'glossary') return GLOSSARY_ENTRY;
  return PAGES_HELP.find(function(p){ return p.id === id; }) || null;
}

export function partHelpById(id){
  return PARTS_HELP.find(function(p){ return p.id === id; }) || null;
}

// L'ordre de LECTURE : celui du sommaire, parties dans l'ordre, glossaire en dernier.
export function readingOrderHelp(){
  const list = [];
  PARTS_HELP.forEach(function(part){
    PAGES_HELP.forEach(function(p){ if(p.part === part.id) list.push(p); });
    if(part.id === 'reference') list.push(GLOSSARY_ENTRY);
  });
  return list;
}

// Le texte d'une page, mis à plat, pour la recherche. Passer par un élément détaché
// enlève le balisage : chercher « table » ne doit pas répondre à cause de <table>.
const cacheText = new Map();
export function textPlainPage(p){
  if(cacheText.has(p.id)) return cacheText.get(p.id);
  const d = document.createElement('div');
  d.innerHTML = p.id === 'glossary' ? glossaryHtml('') : p.html();
  const t = String(d.textContent).replace(/\s+/g, ' ').trim();
  cacheText.set(p.id, t);
  return t;
}
export function textRawPage(p){
  return (p.title + ' ' + p.section + ' ' + textPlainPage(p)).toLowerCase();
}

// Une recherche à plusieurs mots exige TOUS les mots, dans n'importe quel ordre.
function searchWords(q){
  return q.toLowerCase().split(/\s+/).filter(Boolean);
}
function matchesPage(p, words){
  const t = textRawPage(p);
  return words.every(function(w){ return t.indexOf(w) !== -1; });
}
// Score : un mot dans le titre compte bien plus que dans le corps.
function scorePage(p, words){
  const title = p.title.toLowerCase();
  const body = textRawPage(p);
  let s = 0;
  words.forEach(function(w){
    if(title.indexOf(w) !== -1) s += 10;
    s += Math.min(5, body.split(w).length - 1);
  });
  return s;
}
function snippetPage(p, words){
  const t = textPlainPage(p);
  const low = t.toLowerCase();
  let at = -1;
  words.some(function(w){ at = low.indexOf(w); return at !== -1; });
  if(at === -1) return escapeHtmlHelp(t.slice(0, 160)) + '…';
  const from = Math.max(0, at - 70);
  let s = escapeHtmlHelp((from ? '…' : '') + t.slice(from, at + 110) + '…');
  words.forEach(function(w){
    const re = new RegExp('(' + escapeHtmlHelp(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
    s = s.replace(re, '<mark>$1</mark>');
  });
  return s;
}


// ---------- Sommaire ----------

function levelDot(p){
  const l = p.level || 'both';
  return '<span class="help-dot help-dot-' + l + '" title="' + escapeHtmlHelp(LEVELS_HELP[l] || '') + '"></span>';
}

export function summaryHelpHtml(){
  const words = searchWords(helpSearch);
  const current = pageHelpById(helpPageCurrent);
  let h = '';
  let shown = 0;
  PARTS_HELP.forEach(function(part){
    let pages = PAGES_HELP.filter(function(p){ return p.part === part.id; });
    if(part.id === 'reference') pages = pages.concat([GLOSSARY_ENTRY]);
    if(words.length) pages = pages.filter(function(p){ return matchesPage(p, words); });
    if(!pages.length) return;
    shown += pages.length;
    const open = words.length || (current && current.part === part.id);
    h += '<details class="help-part"' + (open ? ' open' : '') + ' data-part="' + part.id + '">'
      + '<summary><span class="help-part-icon">' + part.icon + '</span>'
      + escapeHtmlHelp(part.title) + '<span class="help-count">' + pages.length + '</span></summary>';
    let section = null;
    pages.forEach(function(p){
      // L'intertitre de section n'est utile que s'il distingue : une partie dont toutes
      // les pages ont la section de son titre n'en affiche pas.
      if(p.section !== section && p.section !== part.title){
        section = p.section;
        h += '<div class="help-section">' + escapeHtmlHelp(p.section) + '</div>';
      }
      h += '<a href="#' + p.id + '" class="help-item' + (p.id === helpPageCurrent ? ' active' : '')
        + '" data-help="' + p.id + '">' + levelDot(p) + escapeHtmlHelp(p.title) + '</a>';
    });
    h += '</details>';
  });
  if(!shown){
    h += '<div class="help-empty">Rien pour « ' + escapeHtmlHelp(helpSearch.trim()) + ' »</div>';
  }
  return h;
}


// ---------- Corps ----------

export function glossaryHtml(q){
  const query = (q === undefined ? helpSearch : q).trim().toLowerCase();
  const termes = GLOSSARY_HELP.filter(function(g){
    return !query || (g.terme + ' ' + g.def).toLowerCase().indexOf(query) !== -1;
  }).slice().sort(function(a, b){ return a.terme.localeCompare(b.terme, 'fr'); });
  if(!termes.length) return '<p>Aucun terme ne correspond.</p>';
  let letter = '';
  return '<p class="help-lead">Seulement les termes dont le sens ici n\'est pas celui qu\'on devine.</p>'
    + termes.map(function(g){
        const l = g.terme.charAt(0).toUpperCase();
        const head = l !== letter ? '<h3>' + escapeHtmlHelp(l) + '</h3>' : '';
        letter = l;
        return head + '<div class="help-gloss"><b>' + escapeHtmlHelp(g.terme) + '</b> — ' + g.def
          + ' <span class="help-gloss-view">' + linkHelp(g.page, 'en savoir plus →') + '</span></div>';
      }).join('');
}

function breadcrumbHtml(p){
  const part = partHelpById(p.part);
  return '<div class="help-crumbs">'
    + (part ? '<span>' + part.icon + ' ' + escapeHtmlHelp(part.title) + '</span>' : '')
    + (p.section && (!part || p.section !== part.title) ? '<span>' + escapeHtmlHelp(p.section) + '</span>' : '')
    + '</div>';
}

function pagerHtml(p){
  const order = readingOrderHelp();
  const i = order.findIndex(function(x){ return x.id === p.id; });
  if(i === -1) return '';
  const prev = order[i - 1];
  const next = order[i + 1];
  return '<nav class="help-pager">'
    + (prev ? '<a class="help-pager-prev" href="#' + prev.id + '"><small>← Précédent</small>'
      + escapeHtmlHelp(prev.title) + '</a>' : '<span></span>')
    + (next ? '<a class="help-pager-next" href="#' + next.id + '"><small>Suivant →</small>'
      + escapeHtmlHelp(next.title) + '</a>' : '<span></span>')
    + '</nav>';
}

export function searchResultsHtml(){
  const words = searchWords(helpSearch);
  const all = readingOrderHelp().filter(function(p){ return matchesPage(p, words); })
    .map(function(p){ return {p: p, s: scorePage(p, words)}; })
    .sort(function(a, b){ return b.s - a.s; });
  let h = '<h1>Recherche</h1><p class="help-lead">' + all.length + ' page(s) pour « '
    + escapeHtmlHelp(helpSearch.trim()) + ' » — <kbd>Entrée</kbd> ouvre la première.</p>';
  if(!all.length){
    return h + '<p>Aucun résultat. Essayez un mot plus court, ou parcourez le sommaire.</p>';
  }
  return h + '<div class="help-results">' + all.map(function(r){
    const part = partHelpById(r.p.part);
    return '<a class="help-result" href="#' + r.p.id + '" data-help="' + r.p.id + '">'
      + '<span class="help-result-title">' + escapeHtmlHelp(r.p.title) + '</span>'
      + '<span class="help-result-where">' + (part ? escapeHtmlHelp(part.title) + ' › ' : '')
      + escapeHtmlHelp(r.p.section || '') + '</span>'
      + '<span class="help-result-snippet">' + snippetPage(r.p, words) + '</span></a>';
  }).join('') + '</div>';
}

export function bodyHelpHtml(){
  if(helpSearch.trim()) return searchResultsHtml();
  const p = pageHelpById(helpPageCurrent);
  if(!p){
    return '<h1>Page introuvable</h1>'
      + '<p>Cette adresse ne correspond à aucune page. Le sommaire est à gauche, ou '
      + linkHelp(PAGE_HELP_DEFAULT, 'revenir au début') + '.</p>';
  }
  const level = p.level || 'both';
  return breadcrumbHtml(p)
    + '<h1>' + escapeHtmlHelp(p.title) + '</h1>'
    + '<div class="help-meta"><span class="help-badge help-badge-' + level + '">'
    + escapeHtmlHelp(LEVELS_HELP[level] || '') + '</span>'
    + (p.summary ? '<span class="help-summary">' + p.summary + '</span>' : '') + '</div>'
    + '<article class="help-body">' + (p.id === 'glossary' ? glossaryHtml('') : p.html()) + '</article>'
    + pagerHtml(p);
}

// « Sur cette page » : les intertitres h3 de la page affichée, numérotés pour s'y rendre.
function renderToc(){
  const toc = document.getElementById('help-toc');
  const main = document.getElementById('help-page');
  const heads = Array.from(main.querySelectorAll('.help-body h3'));
  heads.forEach(function(el, i){ el.id = 'sec-' + i; });
  toc.innerHTML = heads.length < 2 ? '' : '<div class="help-toc-title">Sur cette page</div>'
    + heads.map(function(el, i){
        return '<button class="help-toc-item" data-toc="' + i + '">' + escapeHtmlHelp(el.textContent) + '</button>';
      }).join('');
}

function applyAdvancedPref(){
  const open = document.body.classList.contains('help-adv-on');
  Array.from(document.querySelectorAll('.help-advanced')).forEach(function(d){ d.open = open; });
}

export function renderHelp(){
  document.getElementById('help-nav').innerHTML = summaryHelpHtml();
  document.getElementById('help-page').innerHTML = bodyHelpHtml();
  renderToc();
  applyAdvancedPref();
  const p = pageHelpById(helpPageCurrent);
  document.title = (helpSearch.trim() ? 'Recherche' : (p ? p.title : 'Aide'))
    + ' — Manuel de PyroxEngine';
}

// L'adresse fait foi : c'est elle que lit openHelp() depuis l'éditeur, elle que
// changent les liens internes, et elle que restaurent les flèches du navigateur.
export function applyAddressHelp(){
  let id = decodeURIComponent(location.hash.replace(/^#/, '')) || PAGE_HELP_DEFAULT;
  // Ancienne adresse du glossaire, encore présente dans des favoris.
  if(id === 'glossaire') id = 'glossary';
  helpPageCurrent = id;
  // Suivre un lien quitte la recherche : on veut lire la page, pas la liste.
  helpSearch = '';
  const field = document.getElementById('help-q');
  if(field) field.value = '';
  document.body.classList.remove('help-nav-open');
  renderHelp();
  // Chaque page se lit depuis son début, même quand la précédente était longue.
  window.scrollTo(0, 0);
}


// ---------- Câblage (page d'aide seulement) ----------

function wireHelpPage(){
  const field = document.getElementById('help-q');
  let timer = null;
  field.addEventListener('input', function(){
    clearTimeout(timer);
    timer = setTimeout(function(){
      helpSearch = field.value;
      renderHelp();
    }, 120);
  });
  field.addEventListener('keydown', function(e){
    if(e.key === 'Enter'){
      const first = document.querySelector('.help-result');
      if(first) location.hash = first.dataset.help;
    } else if(e.key === 'Escape'){
      field.value = '';
      helpSearch = '';
      renderHelp();
    }
  });

  // « / » donne le focus à la recherche, comme sur la plupart des sites de documentation.
  document.addEventListener('keydown', function(e){
    if(e.key === '/' && document.activeElement !== field){
      e.preventDefault();
      field.focus();
      field.select();
    }
  });

  document.addEventListener('click', function(e){
    // Un terme cité dans une page mène au glossaire, déjà filtré sur ce terme.
    const term = e.target.closest('[data-term]');
    if(term){
      e.preventDefault();
      location.hash = 'glossary';
      setTimeout(function(){
        document.getElementById('help-page').innerHTML = breadcrumbHtml(GLOSSARY_ENTRY)
          + '<h1>Glossaire</h1><article class="help-body">' + glossaryHtml(term.dataset.term) + '</article>';
      }, 0);
      return;
    }
    const toc = e.target.closest('[data-toc]');
    if(toc){
      const target = document.getElementById('sec-' + toc.dataset.toc);
      if(target) target.scrollIntoView({behavior: 'smooth', block: 'start'});
      return;
    }
    if(e.target.closest('#help-menu')) document.body.classList.toggle('help-nav-open');
  });

  // Mode avancé : les blocs « Avancé » s'ouvrent d'office. Préférence de confort, gardée
  // dans le navigateur — l'aide marche à l'identique si le stockage est refusé.
  const adv = document.getElementById('help-adv-open');
  try { adv.checked = localStorage.getItem('help-adv-open') === '1'; } catch(err) { /* stockage refusé */ }
  document.body.classList.toggle('help-adv-on', adv.checked);
  adv.addEventListener('change', function(){
    document.body.classList.toggle('help-adv-on', adv.checked);
    try { localStorage.setItem('help-adv-open', adv.checked ? '1' : '0'); } catch(err) { /* idem */ }
    applyAdvancedPref();
  });

  addEventListener('hashchange', applyAddressHelp);
  applyAddressHelp();
}

// Seulement sur la page d'aide : le harnais de test et l'éditeur (import dynamique) n'ont
// pas de #help-toc.
if(document.body && document.getElementById('help-toc')){
  // DIFFÉRÉ : help-page.js s'évalue au milieu du cycle d'imports, avant help-content.js ;
  // PAGES_HELP n'existe qu'une fois tout le graphe évalué.
  setTimeout(wireHelpPage, 0);
}
