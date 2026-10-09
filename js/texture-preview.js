// ---------- Voir une texture dans l'inspecteur ----------
// Les emplacements de texture d'un matériau n'étaient qu'une liste de NOMS, et l'inspecteur d'une
// texture n'en montrait qu'une vignette de 44 px : rien pour juger d'une image, ni sa
// transparence, ni si c'est bien la bonne. Ce module porte les deux : une miniature à côté de
// chaque emplacement, et un aperçu à la largeur du panneau dans l'inspecteur de la texture.
//
// SORTI de js/import-settings.js, qui est sous cliquet de taille (test/cliquets-dette.test.mjs).
// Il n'importe que js/escape-html.js et lit la liste des assets par sa globale : l'importer depuis
// js/assets.js l'aurait fait entrer dans le grand cycle d'imports, lui aussi sous cliquet.

import { escapeHtml } from './escape-html.js';

function textureAssets(){
  return (globalThis.assets || []).filter(function(x){ return x.kind === 'texture'; });
}

function textureOptionsHtml(value){
  let opts = '<option value="">— aucune —</option>';
  textureAssets().forEach(function(t){
    opts += '<option value="' + t.id + '"' + (value === t.id ? ' selected' : '')
      + '>' + escapeHtml(t.name) + '</option>';
  });
  return opts;
}

/** La miniature d'un emplacement de texture : l'image choisie, ou une case vide. */
export function thumbTextureHtml(textureId){
  const t = textureId ? textureAssets().find(function(x){ return x.id === textureId; }) : null;
  return '<span class="ip-tex-thumb"' + (t && t.preview
    ? ' style="background-image:url(\'' + t.preview + '\')" title="' + escapeHtml(t.name) + '"'
    : ' title="Aucune texture"') + '></span>';
}

// select de texture SANS glisser-déposer ni data-tex-slot (les propriétés d'un shader vivent
// dans a.valeursParams, pas dans a.props — un mécanisme d'écriture séparé, voir
// applyFormMaterial).
export function ipSelectTextureShader(id, label, value, title){
  return '<div class="field"' + (title ? ' title="' + escapeHtml(title) + '"' : '')
    + '><label>' + escapeHtml(label) + '</label>' + thumbTextureHtml(value)
    + '<select id="' + id + '" data-tex-thumb>' + textureOptionsHtml(value) + '</select></div>';
}

// emplacement de map : select des textures du projet + cible de glisser-déposer
export function ipSlotTexture(key, label, p, title){
  return '<div class="field ip-slot" title="' + escapeHtml(label + ' — glissez une texture du panneau Projet ici'
    + (title ? '. ' + title : ''))
    + '"><label>' + label + '</label>' + thumbTextureHtml(p[key])
    + '<select id="ip-tex-' + key + '" data-tex-slot="' + key + '" data-tex-thumb>'
    + textureOptionsHtml(p[key]) + '</select></div>';
}

/**
 * L'aperçu d'une texture, à la largeur du panneau : sur un damier (la transparence se voit), et en
 * pixels nets quand le filtrage est « Proche » — comme elle sera rendue.
 */
export function sectionPreviewTextureHtml(a, params){
  if(!a.preview) return '';
  return '<div class="sec">Aperçu</div>'
    + '<div class="ip-preview ip-preview-tex' + (params && params.filtrage === 'near' ? ' pixelated' : '')
    + '"><img src="' + a.preview + '" alt="" title="' + escapeHtml(a.name) + '"></div>';
}

/**
 * Changer de texture dans un emplacement ne reconstruit pas toujours le panneau (seulement quand
 * une map est branchée ou débranchée) : la miniature suit le choix d'elle-même.
 */
export function bindTextureThumbs(root){
  root.addEventListener('change', function(e){
    const sel = e.target;
    if(!sel || !sel.hasAttribute || !sel.hasAttribute('data-tex-thumb')) return;
    const old = sel.previousElementSibling;
    if(!old || !old.classList.contains('ip-tex-thumb')) return;
    const tmp = document.createElement('span');
    tmp.innerHTML = thumbTextureHtml(sel.value);
    old.replaceWith(tmp.firstChild);
  });
}

// js/material-props.js l'appelle par sa globale (même raison que les `ip*` exposés en fin de
// js/import-settings.js : il ne l'importe pas).
globalThis.ipSlotTexture = ipSlotTexture;
