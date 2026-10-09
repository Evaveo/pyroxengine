// ---------- Les descripteurs des panneaux de SCÈNE ----------
//
// DES DONNÉES, PAS DU CODE D'INTERFACE — même règle que js/ui/panels-inspector.js : aucun
// `document`, aucune chaîne HTML, donc testables sans navigateur.
//
// CE QUI EST DÉJÀ PAR SCÈNE, ET NE MIGRE DONC PAS. `history.js:112` photographie `env`,
// `serialization.js:785` écrit `{objects, tracks, duration, loop, env}` PAR SCÈNE, et
// `postfx.js:9` le dit noir sur blanc : « les réglages vivent dans env.post ». Ce lot est un
// re-rangement d'INTERFACE, pas une migration de données — une migration « recopier les réglages
// globaux dans chaque scène » aurait écrasé les réglages propres de chaque scène par ceux de la
// scène courante.
//
// Les bornes appliquées à l'écriture (`Math.max(0.1, …)`) ne sont pas de la décoration : elles
// étaient dans `readEnvironmentFromDom` et font partie du comportement. Elles vivent dans les
// accesseurs, avec l'appel à `applyEnvironment()` qui rend le réglage visible.

import { assets } from '../assets.js';
import { applyEnvironment } from '../environment.js';
import { project } from '../project.js';
import { applyFilters, filters } from '../scene.js';
import { sceneUsedAsSubScene } from '../subscenes.js';

/** Applique le changement à la scène. Sans lui, on règle une donnée et la vue ne bouge pas. */
export function envApply(){
  applyEnvironment();
}

export const PANEL_ENVIRONMENT = {
  id: 'environment', title: 'Environnement', icon: '🌤',
  defaultZone: 'right', minWidth: 240, onDemand: true,
  sections: [
    { id: 'sky', title: 'Ciel', fields: [
      // L'environnement appartient à la scène HÔTE : une scène instanciée ailleurs comme
      // sous-scène n'y apporte pas le sien (subscenes.js, populateSubScene). Rien à l'écran ne
      // le dirait, d'où cet avertissement — il ne s'affiche que dans le cas concerné.
      { type: 'note',
        when: function(){
          return typeof sceneUsedAsSubScene === 'function'
            && sceneUsedAsSubScene(project.scenes[project.current].name);
        },
        text: 'Cette scène est utilisée comme sous-scène ailleurs : ces réglages ne la suivront '
            + 'pas. L’environnement est toujours celui de la scène hôte.' },
      { ids: ['f-env-sky'], label: 'Type', type: 'choice',
        options: [['color', 'Couleur unie'], ['gradient', 'Dégradé'], ['image', 'Panorama (image)']],
        get: function(e){ return e.sky; },
        set: function(e, v){ e.sky = v; envApply(); } },
      { ids: ['f-env-skyc'], label: 'Couleur', type: 'color',
        visible: function(e){ return e.sky === 'color'; },
        get: function(e){ return e.skyColor; },
        set: function(e, v){ e.skyColor = v; envApply(); } },
      { ids: ['f-env-top'], label: 'Haut', type: 'color',
        visible: function(e){ return e.sky === 'gradient'; },
        get: function(e){ return e.skyTop; },
        set: function(e, v){ e.skyTop = v; envApply(); } },
      { ids: ['f-env-bottom'], label: 'Bas', type: 'color',
        visible: function(e){ return e.sky === 'gradient'; },
        get: function(e){ return e.skyBottom; },
        set: function(e, v){ e.skyBottom = v; envApply(); } },
      { ids: ['f-env-img'], label: 'Image', type: 'choice',
        visible: function(e){ return e.sky === 'image'; },
        options: function(){
          const texs = assets.filter(function(a){ return a.kind === 'texture'; });
          return [['', '— choisir —']].concat(texs.map(function(t){ return [t.id, t.name]; }));
        },
        get: function(e){ return e.skyAsset || ''; },
        set: function(e, v){ e.skyAsset = v || null; envApply(); } },
      { type: 'note',
        when: function(e){
          return e.sky === 'image' && !assets.some(function(a){ return a.kind === 'texture'; });
        },
        text: 'Importez d\'abord une image (panorama équirectangulaire) dans le panneau Projet.' },
      { ids: ['f-env-skyref'], label: 'Reflets du ciel', type: 'checkbox',
        help: 'Le ciel sert d\'environnement aux objets qu\'aucune sonde de réflexion ne couvre',
        // `!== false` et non `!!` : les reflets sont actifs TANT QU'ON N'A PAS DÉCOCHÉ. Un projet
        // enregistré avant l'apparition du champ ne porte pas la clé, et doit rester éclairé.
        get: function(e){ return e.skyReflets !== false; },
        set: function(e, v){ e.skyReflets = !!v; envApply(); } },
      { ids: ['f-env-cielrefi'], label: 'Intensité', type: 'number', step: 0.05, min: 0, max: 3,
        visible: function(e){ return e.skyReflets !== false; },
        get: function(e){ return e.skyRefletsIntensity; },
        set: function(e, v){ e.skyRefletsIntensity = Math.max(0, Math.min(3, v)); envApply(); } },
      { type: 'note',
        when: function(e){ return e.skyReflets !== false; },
        text: 'Sans ce repli, un métal ne reflète rien tant qu\'une sonde n\'a pas été posée à la main.' }
    ]},

    { id: 'fog', title: 'Brouillard', fields: [
      { ids: ['f-env-bra'], label: 'Actif', type: 'checkbox',
        get: function(e){ return !!e.brouillard; },
        set: function(e, v){ e.brouillard = !!v; envApply(); } },
      { ids: ['f-env-brc'], label: 'Couleur', type: 'color',
        get: function(e){ return e.brouillardColor; },
        set: function(e, v){ e.brouillardColor = v; envApply(); } },
      { ids: ['f-env-brp'], label: 'Début', type: 'number', step: 1, min: 1, max: 500,
        get: function(e){ return e.brouillardNear; },
        set: function(e, v){ e.brouillardNear = Math.max(0.1, v); envApply(); } },
      { ids: ['f-env-brl'], label: 'Fin', type: 'number', step: 1, min: 2, max: 1000,
        // La fin reste APRÈS le début : un brouillard qui finit avant de commencer n'a pas de
        // sens, et three le rend en nappe uniforme sans rien signaler.
        get: function(e){ return e.brouillardLoin; },
        set: function(e, v){ e.brouillardLoin = Math.max(e.brouillardNear + 1, v); envApply(); } }
    ]},

    { id: 'lighting', title: 'Éclairage global', fields: [
      { ids: ['f-env-amb'], label: 'Ambiante', type: 'number', step: 0.05, min: 0, max: 3,
        get: function(e){ return e.ambiante; },
        set: function(e, v){ e.ambiante = Math.max(0, v); envApply(); } },
      { ids: ['f-env-ambc'], label: 'Teinte ciel', type: 'color',
        get: function(e){ return e.ambianteColor; },
        set: function(e, v){ e.ambianteColor = v; envApply(); } },
      { ids: ['f-env-sol'], label: 'Soleil', type: 'number', step: 0.05, min: 0, max: 3,
        get: function(e){ return e.sun; },
        set: function(e, v){ e.sun = Math.max(0, v); envApply(); } }
    ]}
  ]
};

// ---------- Le panneau Rendu ----------
//
// UNE SEULE SOURCE DE VÉRITÉ POUR LE POST-TRAITEMENT : les composants PostVolume et les
// assets « Profil de post-traitement » (façon Unity Volume). La section « Post-traitement »
// qui vivait ici (quatorze champs écrivant dans `env.post`, par scène) est SUPPRIMÉE : deux
// sources concurrentes rendaient le résultat illisible — un profil pouvait ne rien changer à
// l'écran parce que le pipeline retombait en silence sur `env.post` (voir postfx.js,
// `postRender`). Un réglage qui n'a aucun effet visible est pire que pas de réglage.
//
// `env.post` reste dans le format de scène (il n'est plus lu par le rendu) : c'est la source
// du PRÉ-REMPLISSAGE du premier profil quand on pose un PostVolume global sur une scène
// d'avant ce changement (voir js/components/component-postvolume.js, `onAdd`). Rien n'est
// donc perdu, mais plus rien ne s'applique tant qu'aucun volume n'existe.
//
// Les TROIS FILTRES d'affichage (`filters`, scene.js:260), eux, restent ici : ce sont des
// états de SESSION de l'éditeur. Ils décrivent comment ON REGARDE, pas ce que la scène EST —
// les enregistrer dans le projet ferait rouvrir la scène en fil de fer chez quelqu'un
// d'autre. Une note le dit dans l'interface, parce que rien ne les distingue à l'œil.
//
// `render-perf.js` n'entre PAS ici : il n'expose aucun réglage: le regroupement en instances est
// automatique (son en-tête le dit). Un panneau qui l'afficherait promettrait un réglage inexistant.

export const PANEL_RENDER = {
  id: 'render', title: 'Rendu', icon: '🎨',
  defaultZone: 'right', minWidth: 240, onDemand: true,
  sections: [
    { id: 'post', title: 'Post-traitement', fields: [
      { type: 'note',
        text: 'Le post-traitement se règle avec un composant PostVolume (global ou zone) et '
            + 'un asset 🌈 Profil de post-traitement, comme les Volumes de Unity. '
            + 'La scène elle-même ne porte plus aucun réglage de post-traitement.' }
    ]},

    { id: 'display', title: 'Affichage', fields: [
      // PAS DE `key` sur ces trois-là, volontairement : un `key` est un chemin dans la donnée de
      // la CIBLE, et ces réglages n'appartiennent à aucune scène.
      { ids: ['f-filter-wireframe'], label: 'Fil de fer', type: 'checkbox',
        get: function(){ return filters.wireframe; },
        set: function(_t, v){ filters.wireframe = !!v; applyFilters(); } },
      { ids: ['f-filter-shadows'], label: 'Ombres', type: 'checkbox',
        get: function(){ return filters.shadows; },
        set: function(_t, v){ filters.shadows = !!v; applyFilters(); } },
      { ids: ['f-filter-textures'], label: 'Textures', type: 'checkbox',
        get: function(){ return filters.textures; },
        set: function(_t, v){ filters.textures = !!v; applyFilters(); } },
      { type: 'note',
        text: 'Ces trois réglages décrivent comment VOUS regardez la scène : ils ne sont pas '
            + 'enregistrés avec elle.' }
    ]}
  ]
};
