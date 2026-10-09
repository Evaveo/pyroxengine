// ---------- Les deux fenêtres de réglages ----------
//
// DES DONNÉES, PAS DU CODE D'INTERFACE — même règle que panels-inspector.js et panels-scene.js.
//
// Deux fenêtres, et la frontière entre elles est la seule chose à retenir :
//
//   - **Paramètres du projet** vise `project.settings`. Ce qui est là voyage avec le projet :
//     deux personnes qui l'ouvrent doivent obtenir le même jeu.
//   - **Préférences** vise `Prefs`. Ce qui est là appartient à la machine et à la personne, et
//     ne part JAMAIS dans un fichier de projet.
//
// Ce sont des PANNEAUX et non des modales. Une fenêtre de réglages qu'on ne peut pas laisser
// ouverte à côté de la vue force un aller-retour par essai : ouvrir, régler, fermer, regarder,
// rouvrir. Les trois modales qu'elles remplacent (`modalLayers`, `modalInputs`, `modalPrefs`)
// redirigent vers elles.

import { AUDIO_BUS_VOLUME_MAX, sanitizeAudioBuses } from '../audio-bus.js';
import { setProjectBusVolumes } from '../audio.js';
import { ENV_DEFAULT, env } from '../environment.js';
import { setStatus, updateHierarchy } from '../hierarchy.js';
import { applyVisibilityLayers } from '../layers.js';
import { modalNaming } from '../material-extraction.js';
import { clampShadowDistance, clampShadowMapSize } from '../project-settings.js';
import { refitShadows } from '../scene.js';
import { Prefs } from './prefs.js';

/** Le projet a changé sous nos pieds : l'écran qui en dépend se remet à jour. */
export function projectSettingsApplied(){
  if(typeof applyVisibilityLayers === 'function') applyVisibilityLayers();
  if(typeof updateHierarchy === 'function') updateHierarchy();
}

/** Les touches d'une action, telles qu'on les tape : séparées par des virgules. */
export function keysText(list){ return (list || []).join(', '); }

/**
 * Relit une liste de touches tapée à la main.
 *
 * L'espace est une touche LÉGITIME (`' '` = saut), et `trim()` l'effacerait : c'est pour ça que
 * la valeur est comparée avant d'être coupée. Le comportement vient de `modalInputs`.
 */
export function keysOfText(text){
  return String(text || '').split(',')
    .map(function(t){ return (t === '  ' || t === ' ') ? ' ' : t.trim(); })
    .filter(function(t){ return t.length; });
}

// LA LANGUE QU'ON EST EN TRAIN DE TRADUIRE. État d'ÉDITEUR, pas de projet : il ne voyage pas
// avec le fichier, et deux personnes peuvent traduire deux langues en même temps sans se
// marcher dessus. Il retombe sur la langue par défaut du projet quand il ne désigne rien.
let localeEnEdition = '';

/** Toutes les clés connues, toutes langues confondues — une clé traduite ailleurs reste visible. */
export function localeKeysOf(locales){
  const vues = [];
  const tables = (locales && locales.tables) || {};
  Object.keys(tables).forEach(function(code){
    Object.keys(tables[code] || {}).forEach(function(k){
      if(vues.indexOf(k) === -1) vues.push(k);
    });
  });
  return vues.sort();
}

/**
 * Aligne les tables sur la liste de codes saisie : ajoute celles qui manquent, retire celles
 * qu'on a enlevées. Rend la table, modifiée en place.
 *
 * RETIRER UNE LANGUE EFFACE SES TRADUCTIONS, et c'est irréversible depuis ce champ. On ne
 * demande pas confirmation ici — le panneau écrit dans le projet, qui s'annule — mais on ne
 * retire JAMAIS la dernière : un projet sans aucune langue n'a plus de texte du tout.
 */
export function syncLocaleCodes(locales, codes){
  if(!locales.tables) locales.tables = {};
  const voulus = codes.filter(function(c){ return c; });
  if(!voulus.length) return locales;
  voulus.forEach(function(c){ if(!locales.tables[c]) locales.tables[c] = {}; });
  Object.keys(locales.tables).forEach(function(c){
    if(voulus.indexOf(c) === -1) delete locales.tables[c];
  });
  if(voulus.indexOf(locales.default) === -1) locales.default = voulus[0];
  return locales;
}

/** Le champ de volume d'un bus de mixage. Les bornes et les défauts sont ceux de js/audio-bus.js. */
export function busVolumeField(bus, label, help){
  return { ids: ['f-ps-bus-' + bus], label: label, type: 'number',
    min: 0, max: AUDIO_BUS_VOLUME_MAX, step: 0.05, help: help,
    get: function(s){ return sanitizeAudioBuses(s.audioBuses)[bus]; },
    set: function(s, v){
      // Entendu tout de suite, sans relancer la partie : régler un mélange se fait à l'oreille. Même
      // porte que le mixeur MX-3 et le copilote (setProjectBusVolumes).
      const patch = {};
      patch[bus] = v;
      setProjectBusVolumes(patch);
    } };
}

export const PANEL_PROJECT_SETTINGS = {
  id: 'project-settings', title: 'Paramètres du projet', icon: '⚙',
  defaultZone: 'right', minWidth: 260, onDemand: true,
  sections: [
    { id: 'ps-id', title: '', fields: [
      { ids: ['f-ps-name'], label: 'Nom', type: 'text',
        get: function(s){ return s.name; },
        set: function(s, v){ s.name = String(v || '').trim() || s.name; } },
      { ids: ['f-ps-versionvisible'], label: 'Afficher la version dans le jeu',
        type: 'checkbox',
        help: 'Réglage de PROJET et non préférence d\'éditeur : deux personnes qui publient le '
            + 'même projet doivent obtenir le même build.',
        get: function(s){ return s.versionVisible !== false; },
        set: function(s, v){ s.versionVisible = !!v; } }
    ]},

    // Le RENDU. Réglages de projet, donc embarqués dans le build : ils décident de ce que le
    // joueur voit, pas du confort de celui qui édite.
    { id: 'ps-render', title: 'Rendu', fields: [
      { ids: ['f-ps-shadowdistance'], label: 'Portée des ombres', type: 'number',
        min: 5, max: 500, step: 5,
        help: 'La distance, en unités, sur laquelle les lumières directionnelles projettent '
            + 'une ombre. Au-delà, plus aucune ombre n\'est calculée. Ce n\'est pas « plus '
            + 'grand, mieux » : la carte d\'ombre a une résolution fixe, donc doubler la '
            + 'portée double la taille d\'un texel au sol et adoucit d\'autant les contours.',
        get: function(s){ return s.shadowDistance; },
        set: function(s, v){
          // Les bornes sont posées par project-settings.js et pas ici : ce champ n'est qu'une
          // des portes d'entrée (un projet relu en est une autre), et deux jeux de bornes
          // finiraient par ne plus dire la même chose.
          s.shadowDistance = clampShadowDistance(v);
          if(typeof refitShadows === 'function') refitShadows();
        } },
      { ids: ['f-ps-shadowmapsize'], label: 'Finesse des ombres', type: 'choice',
        options: [[1024, 'Basse (1024)'],
                  [2048, 'Normale (2048)'],
                  [4096, 'Haute (4096)']],
        help: 'La résolution de la carte d\'ombre. Avec la portée, c\'est elle qui décide de la '
            + 'finesse : un texel couvre « 2 × portée ÷ résolution » au sol. Doubler la '
            + 'résolution revient à diviser la portée par deux, sans réduire la distance à '
            + 'laquelle les ombres existent — ça coûte de la mémoire vidéo à la place.',
        get: function(s){ return s.shadowMapSize; },
        set: function(s, v){
          s.shadowMapSize = clampShadowMapSize(v);
          // Le cadrage dépend de cette valeur : sans ce rappel, le réglage se range dans le
          // projet et l'écran ne bouge pas avant le prochain déplacement d'objet.
          if(typeof refitShadows === 'function') refitShadows();
        } }
    ]},

    // Le MÉLANGE : un volume par bus (js/audio-bus.js). Ce sont les niveaux de départ du jeu publié ;
    // un script peut les changer en cours de partie (api.audioBus), un menu d'options par exemple.
    { id: 'ps-audio', title: 'Mixage audio', fields: [
      busVolumeField('master', 'Volume général',
        'Tout ce que le jeu fait entendre passe par ce bus : musique, bruitages et notes du synthé.'),
      busVolumeField('music', 'Musique',
        'Les sources audio réglées sur le bus « Musique ». Baisser ce volume ne touche pas aux bruitages.'),
      busVolumeField('sfx', 'Effets sonores',
        'Les sources réglées sur « Effets sonores » (le défaut), les sons joués par api.playSound '
          + 'et les notes du synthé.')
    ]},

    // Les calques. La modale `modalLayers` faisait exactement ça, avec son propre HTML et sa
    // propre délégation d'événements.
    { id: 'ps-layers', title: 'Calques', fields: [
      { type: 'note',
        text: 'Un objet appartient à un calque (section Jeu de l\'inspecteur). La visibilité et '
            + 'le verrouillage s\'appliquent à tous ses objets, dans la vue et la hiérarchie.' },
      { type: 'list', id: 'f-ps-layers', label: 'Calques', addLabel: '＋ Nouveau calque',
        items: function(s){ return s.layers; },
        fields: function(layer, i){
          return [
            { ids: ['f-ps-layer-' + i + '-name'], type: 'text',
              get: function(l){ return l.name; },
              set: function(l, v){ l.name = String(v || '').trim() || l.name; projectSettingsApplied(); } },
            { ids: ['f-ps-layer-' + i + '-visible'], label: 'Visible', type: 'checkbox',
              get: function(l){ return l.visible !== false; },
              set: function(l, v){ l.visible = !!v; projectSettingsApplied(); } },
            { ids: ['f-ps-layer-' + i + '-lock'], label: 'Verrouillé', type: 'checkbox',
              get: function(l){ return !!l.verrouille; },
              set: function(l, v){ l.verrouille = !!v; projectSettingsApplied(); } }
          ];
        },
        // Trente-deux calques au maximum : l'identifiant sert de bit dans le masque de couches
        // d'une caméra (`camMask`), et un trente-troisième n'aurait nulle part où aller.
        onAdd: function(s){
          const idMax = s.layers.reduce(function(m, l){ return Math.max(m, l.id); }, 0);
          if(idMax >= 31){ setStatus('32 calques maximum', 2500); return; }
          s.layers.push({id: idMax + 1, name: 'Calque ' + (idMax + 1),
                         visible: true, verrouille: false});
        },
        // Le calque 0 ne se retire pas : c'est celui de tout objet qui n'en a pas choisi.
        onRemove: function(s, i){
          if(!s.layers[i]) return;
          if(s.layers[i].id === 0){
            setStatus('Le calque par défaut ne peut pas être retiré', 3000);
            return;
          }
          s.layers.splice(i, 1);
          projectSettingsApplied();
        } }
    ]},

    // Les calques de tri 2D, du fond vers l'avant. Ce sont des CHAÎNES, donc les accesseurs
    // écrivent dans le tableau par indice : une chaîne ne se mute pas.
    { id: 'ps-2d', title: '2D', fields: [
      { ids: ['f-ps-ppu2d'], label: 'Pixels par unité', type: 'number',
        step: 1, min: 1, max: 4096,
        help: 'L\'échelle de la grille 2D, et celle dont le zoom entier dérive.',
        get: function(s){ return s.ppu2d; },
        set: function(s, v){ s.ppu2d = Math.max(1, Math.round(v) || 100); } },
      { type: 'list', id: 'f-ps-layers2d', label: 'Calques de tri (du fond vers l\'avant)',
        addLabel: '＋ Nouveau calque 2D',
        items: function(s){ return s.layers2d; },
        fields: function(name, i, s){
          return [{ ids: ['f-ps-layer2d-' + i], type: 'text',
            get: function(){ return s.layers2d[i]; },
            set: function(_row, v){
              const propre = String(v || '').trim();
              if(propre) s.layers2d[i] = propre;
            } }];
        },
        onAdd: function(s){ s.layers2d.push('Calque ' + (s.layers2d.length + 1)); },
        // Un tableau vide renverrait tous les sprites au fond (`orderOfSort`) : le dernier
        // calque ne se retire pas.
        onRemove: function(s, i){
          if(s.layers2d.length <= 1){
            setStatus('Il faut au moins un calque de tri 2D', 3000);
            return;
          }
          s.layers2d.splice(i, 1);
        } }
    ]},

    // Les entrées. Ce que faisait `modalInputs`, aux mêmes règles près.
    { id: 'ps-inputs', title: 'Entrées', fields: [
      { type: 'note',
        text: 'Touches séparées par des virgules (z, w, ArrowUp). Les scripts lisent '
            + 'api.action(\'jump\'), api.actionPressed(\'interact\') et api.axis(\'horizontal\').' },
      // LA MANETTE SE CONFIGURE ICI PARCE QU'ELLE EST DANS LA MÊME TABLE : un bouton est une
      // touche, et `pad:0` s'écrit comme `z`. Sans cette note, la manette marcherait mais
      // personne ne saurait la recâbler — et une fonctionnalité qu'on ne sait pas atteindre
      // n'en est pas une.
      { type: 'note',
        text: 'Manette : pad:0 à pad:15 sont des touches comme les autres. 0 = A/croix, '
            + '1 = B/rond, 2 = X/carré, 3 = Y/triangle, 4 et 5 = LB/RB, 6 et 7 = LT/RT, '
            + '12 à 15 = croix directionnelle.' },
      { type: 'list', id: 'f-ps-inputs', label: 'Actions', addLabel: '＋ Nouvelle action',
        items: function(s){
          return Object.keys((s.inputs && s.inputs.actions) || {})
            .map(function(name){ return {name: name, actions: s.inputs.actions}; });
        },
        fields: function(row, i){
          return [
            { ids: ['f-ps-input-' + i + '-name'], type: 'info',
              get: function(r){ return r.name; } },
            { ids: ['f-ps-input-' + i + '-keys'], type: 'text', placeholder: 'z, w, ArrowUp',
              get: function(r){ return keysText(r.actions[r.name]); },
              set: function(r, v){ r.actions[r.name] = keysOfText(v); } }
          ];
        },
        onAdd: function(s){
          const name = prompt('Nom de la nouvelle action (ex. tirer) :');
          if(!name || !name.trim()) return;
          s.inputs.actions[name.trim()] = [];
        },
        onRemove: function(s, i){
          const name = Object.keys(s.inputs.actions)[i];
          if(name) delete s.inputs.actions[name];
        } },

      // LES AXES N'ÉTAIENT PAS ÉDITABLES DU TOUT. Tant qu'un axe n'était que deux actions, ça
      // se défendait — on éditait les actions. Depuis que sa troisième case porte la source
      // analogique d'une manette, ne pas pouvoir l'atteindre revient à ne pas pouvoir recâbler
      // les sticks, et un studio en aura besoin dès la première manette non standard.
      { type: 'note',
        text: 'Axes : action négative, action positive, puis — facultatif — la source '
            + 'analogique. pad:axis0 = stick gauche ↔, pad:axis1- = stick gauche ↕ inversé '
            + '(l\'axe Y d\'une manette est positif vers le bas).' },
      { type: 'list', id: 'f-ps-axes', label: 'Axes', addLabel: '＋ Nouvel axe',
        items: function(s){
          return Object.keys((s.inputs && s.inputs.axes) || {})
            .map(function(name){ return {name: name, axes: s.inputs.axes}; });
        },
        fields: function(row, i){
          return [
            { ids: ['f-ps-axis-' + i + '-name'], type: 'info',
              get: function(r){ return r.name; } },
            { ids: ['f-ps-axis-' + i + '-parts'], type: 'text',
              placeholder: 'left, right, pad:axis0',
              get: function(r){ return keysText(r.axes[r.name]); },
              set: function(r, v){ r.axes[r.name] = keysOfText(v); } }
          ];
        },
        onAdd: function(s){
          const name = prompt('Nom du nouvel axe (ex. regard) :');
          if(!name || !name.trim()) return;
          s.inputs.axes[name.trim()] = ['', ''];
        },
        onRemove: function(s, i){
          const name = Object.keys(s.inputs.axes)[i];
          if(name) delete s.inputs.axes[name];
        } }
    ]},

    // Le TEXTE DU JEU, traduit. Pas l'interface de l'éditeur, qui reste en français : ce que
    // le JOUEUR lit. Voir js/locale.js.
    { id: 'ps-locales', title: 'Langues du jeu', fields: [
      { type: 'note',
        text: 'Les scripts lisent api.t(« menu.start »), le HTML d\'interface utilise '
            + 'data-t="menu.start". Une clé sans traduction affiche LA CLÉ — c\'est voulu : '
            + 'un bouton vide se découvrirait chez le joueur.' },
      { ids: ['f-ps-locale-codes'], type: 'text', label: 'Langues',
        placeholder: 'fr, en',
        get: function(s){ return Object.keys((s.locales && s.locales.tables) || {}).join(', '); },
        set: function(s, v){ syncLocaleCodes(s.locales, keysOfText(v)); } },
      { ids: ['f-ps-locale-default'], type: 'text', label: 'Langue par défaut',
        placeholder: 'fr',
        get: function(s){ return (s.locales && s.locales.default) || ''; },
        set: function(s, v){ s.locales.default = String(v || '').trim(); } },
      { ids: ['f-ps-locale-editing'], type: 'text', label: 'Langue éditée ici',
        placeholder: 'fr',
        get: function(s){ return localeEnEdition || (s.locales && s.locales.default) || ''; },
        set: function(s, v){ localeEnEdition = String(v || '').trim(); } },
      { type: 'list', id: 'f-ps-locale-keys', label: 'Textes', addLabel: '＋ Nouvelle clé',
        items: function(s){
          const code = localeEnEdition || (s.locales && s.locales.default) || '';
          const table = ((s.locales && s.locales.tables) || {})[code] || {};
          return localeKeysOf(s.locales).map(function(k){ return {key: k, table: table}; });
        },
        fields: function(row, i){
          return [
            { ids: ['f-ps-locale-' + i + '-key'], type: 'info',
              get: function(r){ return r.key; } },
            { ids: ['f-ps-locale-' + i + '-text'], type: 'text', placeholder: '(à traduire)',
              get: function(r){ return r.table[r.key] || ''; },
              set: function(r, v){ r.table[r.key] = String(v); } }
          ];
        },
        onAdd: function(s){
          const key = prompt('Clé du nouveau texte (ex. menu.start) :');
          if(!key || !key.trim()) return;
          const code = localeEnEdition || s.locales.default;
          if(!s.locales.tables[code]) s.locales.tables[code] = {};
          s.locales.tables[code][key.trim()] = '';
        },
        onRemove: function(s, i){
          // La clé part de TOUTES les langues : la retirer d'une seule laisserait une
          // traduction orpheline, que plus rien n'afficherait jamais.
          const key = localeKeysOf(s.locales)[i];
          if(!key) return;
          Object.keys(s.locales.tables).forEach(function(c){ delete s.locales.tables[c][key]; });
        } }
    ]},

    // La cuisson. Les réglages appartiennent au projet et non à la machine : deux personnes qui
    // cuisent la même scène doivent obtenir la même image.
    { id: 'ps-lightmap', title: 'Cuisson de l\'éclairage', fields: [
      { ids: ['f-ps-lm-res'], label: 'Résolution', type: 'number', step: 128, min: 128, max: 4096,
        get: function(s){ return (s.lightmap || {}).resolution; },
        set: function(s, v){ s.lightmap.resolution = Math.max(128, Math.round(v) || 512); } },
      { ids: ['f-ps-lm-images'], label: 'Échantillons', type: 'number', step: 1, min: 1, max: 4096,
        get: function(s){ return (s.lightmap || {}).images; },
        set: function(s, v){ s.lightmap.images = Math.max(1, Math.round(v) || 1); } },
      { ids: ['f-ps-lm-bounces'], label: 'Rebonds', type: 'number', step: 1, min: 0, max: 8,
        get: function(s){ return (s.lightmap || {}).bounces; },
        set: function(s, v){ s.lightmap.bounces = Math.max(0, Math.round(v) || 0); } },
      { ids: ['f-ps-lm-rgbm'], label: 'HDR (RGBM)', type: 'checkbox',
        help: 'Une lightmap est une mesure d\'irradiance, pas une image : l\'écrêter à 1 perd '
            + 'ce qui dépasse. Le prix est un décodage au chargement.',
        get: function(s){ return (s.lightmap || {}).rgbm !== false; },
        set: function(s, v){ s.lightmap.rgbm = !!v; } },
      { ids: ['f-ps-lm-denoise'], label: 'Débruitage', type: 'checkbox',
        get: function(s){ return (s.lightmap || {}).denoise !== false; },
        set: function(s, v){ s.lightmap.denoise = !!v; } }
    ]},

    // Le document de conception : l'intention, les contraintes, ce qui a été écarté. Il voyage
    // avec le projet parce que c'est la seule chose qu'une scène ne dit pas — elle dit ce qui
    // EST, jamais ce qu'on voulait.
    { id: 'ps-design', title: 'Document de conception', fields: [
      { ids: ['f-ps-design'], label: '', type: 'textarea', rows: 10,
        placeholder: 'L\'intention, les contraintes, ce qui a été écarté et pourquoi.',
        get: function(s){ return s.design || ''; },
        set: function(s, v){ s.design = v; } }
    ]},

    // Les valeurs de départ d'une NOUVELLE scène. Un seul geste, parce que régler un ciel dans
    // une fenêtre de paramètres à l'aveugle n'a pas de sens : on le règle dans la scène, on
    // regarde, puis on en fait le défaut.
    { id: 'ps-newscene', title: 'Nouvelle scène', fields: [
      { type: 'note',
        text: 'L\'environnement que reçoit une scène nouvellement créée. Réglez le ciel, le '
            + 'brouillard et l\'éclairage dans la scène courante, puis reprenez-les ici.' },
      { ids: ['btn-ps-newscene-take'], type: 'action',
        label: '⤵ Reprendre l\'environnement de la scène courante',
        run: function(s){
          if(typeof env === 'undefined'){ return; }
          s.newScene.env = JSON.parse(JSON.stringify(env));
          setStatus('Une nouvelle scène partira de cet environnement', 3000);
        } },
      { ids: ['btn-ps-newscene-reset'], type: 'action', label: '↺ Revenir au défaut de l\'éditeur',
        run: function(s){
          s.newScene.env = (typeof ENV_DEFAULT === 'undefined')
            ? null : JSON.parse(JSON.stringify(ENV_DEFAULT));
          setStatus('Environnement de départ réinitialisé', 3000);
        } }
    ]}
  ]
};

// ---------------------------------------------------------------------------
// Préférences — les sections sont CALCULÉES depuis le registre.
//
// C'est ce qui fait qu'un plugin qui appelle `Editor.definePref` voit sa préférence apparaître
// dans la fenêtre sans y toucher : une liste écrite à la main ici aurait obligé chaque plugin à
// modifier l'éditeur.

/** Les catégories déclarées, dans l'ordre de première déclaration. */
export function prefsCategories(){
  const out = [];
  Prefs.all().forEach(function(d){
    if(d.type === 'hidden') return;
    if(out.indexOf(d.category || 'Divers') === -1) out.push(d.category || 'Divers');
  });
  return out;
}

/** Une préférence déclarée devient un champ du socle. */
export function prefField(d){
  return {
    ids: ['f-pref-' + d.key.replace(/\./g, '-')],
    label: d.label || d.key, type: d.type || 'text', help: d.help || null,
    options: d.options || null, min: d.min, max: d.max, step: d.step,
    // La cible du panneau est `Prefs` lui-même : le get et le set passent par lui, donc une
    // préférence est lue et écrite exactement comme le reste de l'éditeur la lit et l'écrit.
    get: function(p){ return p.get(d.key); },
    set: function(p, v){ p.set(d.key, v); }
  };
}

export const PANEL_PREFERENCES = {
  id: 'preferences', title: 'Préférences', icon: '🎛',
  defaultZone: 'right', minWidth: 260, onDemand: true,
  sections: function(){
    const sections = prefsCategories().map(function(cat){
      return { id: 'pref-' + cat.toLowerCase(), title: cat,
               fields: Prefs.byCategory(cat)
                 .filter(function(d){ return d.type !== 'hidden'; })
                 .map(prefField) };
    });
    // Les rôles de nommage de texture ont leur propre écran (material-extraction.js) : une
    // table de suffixes ne s'édite pas en un champ. Le bouton y mène, il ne la recopie pas.
    sections.push({ id: 'pref-naming', title: 'Textures', fields: [
      { type: 'note',
        text: 'Les rôles de nommage disent quel suffixe de fichier est une carte de normales, '
            + 'de rugosité, d\'occlusion… Ils décident de ce qu\'un import reconnaît tout seul.' },
      { ids: ['btn-pref-naming'], type: 'action', label: '🏷 Convention de nommage…',
        run: function(){ modalNaming(); } }
    ]});
    sections.push({ id: 'pref-where', title: '', fields: [
      { type: 'note',
        text: 'Ces réglages appartiennent à cette machine et à ce navigateur : ils ne partent '
            + 'pas dans le fichier de projet. Ce qui voyage avec le projet est dans '
            + '« Paramètres du projet ».' }
    ]});
    return sections;
  }
};
