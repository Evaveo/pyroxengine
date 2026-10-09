// moteur/js/ui/panels-postprofile.js
//
// Éditeur de l'asset postProfile (double-clic dans le panneau Projet) : un bloc par effet
// connu (voir js/post-profile.js, POST_PROFILE_DEFAULT_EFFECTS), chacun avec sa case « Actif »
// (overridden) qui montre/masque ses champs. Même moteur de champs déclaratifs que
// PANEL_RENDER (js/ui/panels-scene.js) et les panneaux de composant (js/ui/panels-components.js,
// js/component-views.js) — pas d'éditeur ad hoc. Le montage suit exactement le patron de la
// fenêtre Palette de tuiles (js/palette-ui.js, `PANEL_TILE_PALETTE`/`openWindowPalette`) : un
// descripteur, un `createForm(host, descripteur).setTargets([asset])`, et un panneau du dock
// (js/ui/panels-shell.js) qui adopte l'hôte déjà posé dans editor.html.

import { ensurePostProfileDefaults } from '../post-profile.js';
import { TONEMAPS } from '../postfx.js';
import { openPanelDock } from '../ui.js';
import { createForm } from './form.js';

/** Un champ numérique/texte/choix d'un effet : visible seulement si l'effet est « Actif ». */
export function postProfileField(id, label, key, subKey, opts){
  const o = opts || {};
  return Object.assign({
    ids: [id], label: label,
    visible: function(a){ return a.effects[key].overridden; },
    get: function(a){ return a.effects[key][subKey]; },
    set: function(a, v){ a.effects[key][subKey] = o.clamp ? o.clamp(v) : v; }
  }, o);
}

/** La section d'un effet : sa case « Actif » (overridden) puis ses champs propres, s'il en a. */
export function postProfileSection(key, title, fields){
  return { id: 'pp-' + key, title: title, fields: [
    { ids: ['f-pp-' + key + '-on'], label: 'Actif', type: 'checkbox',
      help: 'Un profil ne définit que ce qu\'il override (façon Unity Volume) : décoché, cet '
          + 'effet n\'est pas touché par ce profil.',
      get: function(a){ return !!a.effects[key].overridden; },
      set: function(a, v){ a.effects[key].overridden = !!v; } }
  ].concat(fields) };
}

export const PANEL_POSTPROFILE = {
  id: 'panel-postprofile',
  sections: [
    postProfileSection('bloom', 'Bloom', [
      postProfileField('f-pp-bloom-threshold', 'Seuil', 'bloom', 'threshold',
        {type: 'number', step: 0.05, min: 0, max: 1}),
      postProfileField('f-pp-bloom-intensity', 'Intensité', 'bloom', 'intensity',
        {type: 'number', step: 0.05, min: 0, max: 5}),
      postProfileField('f-pp-bloom-radius', 'Rayon', 'bloom', 'radius',
        {type: 'number', step: 0.1, min: 0.2, max: 5})
    ]),
    postProfileSection('vignette', 'Vignette', [
      postProfileField('f-pp-vignette', 'Intensité', 'vignette', 'amount',
        {type: 'number', step: 0.05, min: 0, max: 1})
    ]),
    postProfileSection('grain', 'Grain', [
      postProfileField('f-pp-grain', 'Intensité', 'grain', 'amount',
        {type: 'number', step: 0.05, min: 0, max: 1})
    ]),
    postProfileSection('toneMapping', 'Étalonnage (tone mapping)', [
      postProfileField('f-pp-tonemap', 'Mode', 'toneMapping', 'mode',
        // Même table que le post-traitement de scène (js/postfx.js `TONEMAPS`) : les valeurs
        // sont l'énumération réelle du moteur, pas une liste réinventée ici.
        {type: 'choice', options: function(){ return TONEMAPS; }})
    ]),
    postProfileSection('colorGrading', 'Gradation', [
      postProfileField('f-pp-contrast', 'Contraste', 'colorGrading', 'contrast',
        {type: 'number', step: 0.05, min: 0, max: 2}),
      postProfileField('f-pp-saturation', 'Saturation', 'colorGrading', 'saturation',
        {type: 'number', step: 0.05, min: 0, max: 2}),
      postProfileField('f-pp-temperature', 'Température', 'colorGrading', 'temperature',
        {type: 'number', step: 0.05, min: -1, max: 1}),
      postProfileField('f-pp-exposure', 'Exposition', 'colorGrading', 'exposure',
        {type: 'number', step: 0.05, min: 0, max: 5})
    ])
    // Plus de section « Anticrénelage (FXAA) » : l'effet a été retiré en v0.135.0 (il retournait
    // l'image).
  ]
};

export const postProfileWindow = { asset: null, form: null };

/** Ouvre la fenêtre d'édition du profil sur cet asset (double-clic dans le panneau Projet). */
export function openEditorPostProfile(a){
  if(!a || a.kind !== 'postProfile') return null;
  a.effects = ensurePostProfileDefaults(a.effects);
  postProfileWindow.asset = a;
  buildPostProfilePanel();
  openPanelDock('postprofile');
  return true;
}

/** Le contenu de la fenêtre : le socle le construit, à partir du descripteur ci-dessus. */
export function buildPostProfilePanel(){
  const el = document.getElementById('postprofile-panel');
  const a = postProfileWindow.asset;
  if(!el) return;
  if(!a){ el.innerHTML = ''; postProfileWindow.form = null; return; }
  postProfileWindow.form = createForm(el, PANEL_POSTPROFILE);
  postProfileWindow.form.setTargets([a]);
}

/** Les valeurs des champs, sans toucher à celui qu'on est en train de taper. */
export function syncPostProfilePanel(){
  if(postProfileWindow.form) postProfileWindow.form.sync();
}
