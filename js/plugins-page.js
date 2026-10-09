// ---------- La page « Catalogue de plugins » ----------
//
// Elle présente ce que `exemples/catalogue.json` décrit, le filtre, et propose l'installation.
// Elle N'INSTALLE RIEN elle-même : installer veut dire exécuter du code dans l'éditeur, et cette
// page n'est pas l'éditeur. Elle lui envoie un NOM DE FICHIER par postMessage ; c'est lui qui
// vérifie, lit le fichier, avertit l'utilisateur et installe (js/plugins.js → listenPluginCatalog).
//
// La page fonctionne ouverte SEULE : la liste, la recherche, les filtres et le téléchargement du
// `.js` marchent sans éditeur. Seule l'installation en un clic demande d'être venu de l'éditeur,
// et la bannière le dit au lieu de laisser un bouton sans effet.
//
// Toute la logique testable (filtre, recherche, catégories, porte d'installation) est dans
// js/plugin-catalog.js, qui ne touche ni au DOM ni au réseau.
import {
  CATALOG_URL, CHANNEL_CATALOG, MESSAGE_DONE, MESSAGE_INSTALL,
  catalogCategories, catalogKeyFromHash, filterCatalog, pluginNameForFile,
} from './plugin-catalog.js';

const elQuery = document.getElementById('cat-q');
const elFilters = document.getElementById('cat-filters');
const elList = document.getElementById('cat-list');
const elError = document.getElementById('cat-error');
const elStandalone = document.getElementById('cat-standalone');

const page = {
  catalog: null,
  query: '',
  category: '',
  /** Ce que l'éditeur a répondu, par fichier : 'pending' | 'ok' | 'refused'. */
  states: {},
};

// LE JETON, et non `window.opener`. Un volet de navigateur intégré ouvre la fenêtre SANS opener
// (mesuré) : l'installation en un clic aurait été morte là, sans une erreur. Le jeton arrive dans
// le fragment, que l'éditeur a tiré au hasard pour cette ouverture.
const catalogKey = catalogKeyFromHash(location.hash);
// Effacé de la barre d'adresse dès qu'il est lu : il n'a rien à faire dans une capture d'écran
// ni dans un lien recopié. La page le garde en mémoire, le rechargement le perdra — et la page
// repassera alors en mode « ouverte seule », ce qui est exact.
if(catalogKey){
  try{ history.replaceState(null, '', location.pathname + location.search); }
  catch(e){ /* sans importance : la page marche avec le fragment visible */ }
}

const channel = (catalogKey && typeof BroadcastChannel === 'function')
  ? new BroadcastChannel(CHANNEL_CATALOG) : null;

function escapeHtml(s){
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Les plugins déjà installés dans CE navigateur. La page et l'éditeur partagent l'origine,
 * donc le même localStorage : le badge « Installé » n'a besoin de demander à personne.
 */
function installedNames(){
  try{
    const list = JSON.parse(localStorage.getItem('moteur3d-plugins') || '[]');
    return list.map(function(p){ return p && p.name; }).filter(Boolean);
  } catch(e){ return []; }
}

function renderFilters(){
  const cats = catalogCategories(page.catalog);
  let html = chipHtml('', 'Tous');
  cats.forEach(function(c){ html += chipHtml(c, c); });
  elFilters.innerHTML = html;
}

function chipHtml(value, label){
  return '<button type="button" class="cat-chip" data-category="' + escapeHtml(value) + '"'
    + ' aria-pressed="' + (page.category === value ? 'true' : 'false') + '">'
    + escapeHtml(label) + '</button>';
}

function renderList(){
  const shown = filterCatalog(page.catalog, page.query, page.category);
  if(!shown.length){
    elList.innerHTML = '<div class="none">Aucun plugin ne correspond à cette recherche.</div>';
    return;
  }
  const installed = installedNames();
  elList.innerHTML = shown.map(function(p){ return cardHtml(p, installed); }).join('');
}

function cardHtml(p, installed){
  const isInstalled = installed.indexOf(pluginNameForFile(p.file)) >= 0;
  const state = page.states[p.file];
  let html = '<article class="cat-card">'
    + '<div class="cat-card-head">'
    + '<span class="cat-icon" aria-hidden="true">' + escapeHtml(p.icon || '🧩') + '</span>'
    + '<div><h2 class="cat-title">' + escapeHtml(p.title) + '</h2>'
    + '<div class="cat-category">' + escapeHtml(p.category || '') + ' · <code>'
    + escapeHtml(p.file) + '</code></div></div>'
    + (isInstalled ? '<span class="cat-installed">✓ Installé</span>' : '')
    + '</div>'
    + '<p class="cat-summary">' + escapeHtml(p.summary) + '</p>'
    + '<p class="cat-desc">' + escapeHtml(p.description) + '</p>';

  if(p.extends && p.extends.length){
    html += '<div class="cat-block"><b>Ce qu\'il ajoute</b><ul class="cat-tags">'
      + p.extends.map(function(x){ return '<li>' + escapeHtml(x) + '</li>'; }).join('')
      + '</ul></div>';
  }
  if(p.requires && p.requires.length){
    html += '<div class="cat-block"><b>Prérequis</b><ul class="cat-req">'
      + p.requires.map(function(x){ return '<li>' + escapeHtml(x) + '</li>'; }).join('')
      + '</ul></div>';
  }
  if(p.warning) html += '<p class="cat-warn">⚠ ' + escapeHtml(p.warning) + '</p>';

  html += '<div class="cat-actions">';
  if(channel){
    html += '<button type="button" class="cat-btn accent cat-install" data-file="'
      + escapeHtml(p.file) + '">'
      + (isInstalled ? '↻ Réinstaller dans l\'éditeur' : '⇩ Installer dans l\'éditeur') + '</button>';
  }
  html += '<a class="cat-btn" href="exemples/' + encodeURIComponent(p.file) + '" download>'
    + 'Télécharger le .js</a>';
  if(state === 'pending') html += '<span class="cat-note">Demande envoyée à l\'éditeur…</span>';
  // « Installé » et RIEN DE PLUS. La barre de menus de l'éditeur est construite au démarrage :
  // un plugin qui ajoute un menu ne le fait apparaître qu'au rechargement (docs/PLUGINS.md § 1).
  // Écrire « l'éditeur est à jour » serait exact pour un matériau et faux pour un menu.
  else if(state === 'ok') html += '<span class="cat-note ok">Installé — rechargez l\'éditeur '
    + 'pour voir ses menus et ses panneaux.</span>';
  else if(state === 'refused') html += '<span class="cat-note bad">L\'éditeur n\'a pas installé ce plugin.</span>';
  html += '</div></article>';
  return html;
}

function requestInstall(file){
  if(!channel) return;
  page.states[file] = 'pending';
  renderList();
  // Le canal est borné à l'origine par le navigateur ; le jeton dit DE QUEL éditeur il s'agit.
  channel.postMessage({type: MESSAGE_INSTALL, key: catalogKey, file: file});
}

// ---------- branchements ----------

elQuery.addEventListener('input', function(){
  page.query = elQuery.value;
  renderList();
});

elFilters.addEventListener('click', function(e){
  const chip = e.target.closest('.cat-chip');
  if(!chip) return;
  page.category = chip.dataset.category;
  renderFilters();
  renderList();
});

elList.addEventListener('click', function(e){
  const btn = e.target.closest('.cat-install');
  if(!btn) return;
  requestInstall(btn.dataset.file);
});

// La réponse de l'éditeur. Le pendant exact de son contrôle à lui : nous n'acceptons de réponse
// que de celui qui porte NOTRE jeton — deux catalogues ouverts côte à côte ne s'échangent pas
// leurs réponses, et une autre page de l'origine ne peut pas nous en fabriquer une.
if(channel){
  channel.addEventListener('message', function(e){
    if(e.origin !== location.origin) return;
    if(!e.data || e.data.type !== MESSAGE_DONE || e.data.key !== catalogKey) return;
    page.states[e.data.file] = e.data.ok ? 'ok' : 'refused';
    renderList();
  });
} else {
  elStandalone.hidden = false;
  elStandalone.innerHTML = 'Cette page est ouverte seule : l\'installation en un clic passe par '
    + 'l\'éditeur. Ouvrez-la depuis <b>Fichier → 🧩 Plugins → 🏪 Parcourir le catalogue…</b>, ou '
    + 'téléchargez le <code>.js</code> ci-dessous et installez-le depuis la même fenêtre.';
}

fetch(CATALOG_URL)
  .then(function(r){
    if(!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  })
  .then(function(catalog){
    page.catalog = catalog;
    renderFilters();
    renderList();
  })
  .catch(function(err){
    elError.hidden = false;
    elError.textContent = 'Le catalogue (' + CATALOG_URL + ') n\'a pas pu être lu : ' + err.message;
  });
