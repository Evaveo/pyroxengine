// moteur/js/ui/panels-particles.js
// ---------- L'inspecteur des particules : composant ET asset ----------
//
// Un SEUL jeu de sections, un par module comme le Particle System de Unity, sert à deux cibles :
//
//   · le composant Particles (`c.data` = sac de l'émetteur) — un réglage modifié sur un émetteur
//     relié à un asset devient une SURCHARGE de cet objet (l'asset partagé reste intact), et
//     s'écrit dans le système intégré sinon. C'est setParticleValue (js/particle-asset.js) qui
//     décide, pas ce fichier ;
//   · l'asset `particles` (`a.system`), sélectionné dans le panneau Projet : l'éditer change
//     tous les émetteurs qui le suivent.
//
// Chaque module a sa case « Activé » ; ses réglages n'apparaissent que coché, comme les modules
// repliés de Unity. Les champs relisent le système EFFECTIF (asset + surcharges), donc ce qu'on
// voit est ce qui tourne.

import { attachParticlesAsset, clearParticleOverride, detachParticlesAsset, getPath,
         normalizeParticleSystem, PARTICLE_PRESETS, resolveParticleSystem, setParticleValue,
         setPath, systemOfPreset } from '../particle-asset.js';
import { declareComponentPanel } from './panels-components.js';
import { createForm } from './form.js';

function particleAssets(kind){
  const list = Array.isArray(globalThis.assets) ? globalThis.assets : [];
  return list.filter(function(a){ return a && a.kind === kind; });
}
function findParticleAsset(id){
  const list = Array.isArray(globalThis.assets) ? globalThis.assets : [];
  for(let i = 0; i < list.length; i++){ if(list[i] && list[i].id === id) return list[i]; }
  return null;
}
function isAssetTarget(t){ return !!t && t.kind === 'particles'; }

// Le système effectif d'une cible, relu au plus toutes les 30 ms : un panneau compte une
// centaine de champs, et chacun le demande à la planification.
const panelCache = new WeakMap();
export function effectiveParticleSystem(t){
  if(isAssetTarget(t)){
    if(!t.system || !t.system.main) t.system = normalizeParticleSystem(t.system);
    return t.system;
  }
  const now = Date.now();
  const hit = panelCache.get(t);
  if(hit && now - hit.at < 30) return hit.sys;
  const sys = resolveParticleSystem(t.data, findParticleAsset);
  panelCache.set(t, {at: now, sys: sys});
  return sys;
}

function afterWrite(t){
  if(isAssetTarget(t)){
    if(typeof globalThis.refreshAllParticles === 'function') globalThis.refreshAllParticles();
    return;
  }
  panelCache.delete(t);
  if(typeof resetSystemParticles === 'function') resetSystemParticles(t.node);
  else if(typeof globalThis.resetSystemParticles === 'function') globalThis.resetSystemParticles(t.node);
}

/** Écrit un réglage : dans l'asset, ou sur l'émetteur (surcharge ou système intégré). */
export function writeParticleSetting(t, path, value){
  if(isAssetTarget(t)){
    setPath(t.system, path, value);
    t.system = normalizeParticleSystem(t.system);
  } else {
    setParticleValue(t.data, path, value);
  }
  afterWrite(t);
}

/** Un champ de réglage, par son chemin `module.réglage`. */
function pf(path, label, type, opts){
  const o = opts || {};
  return {
    ids: ['f-pa-' + path.replace(/\./g, '-')], label: label, type: type,
    step: o.step, min: o.min, max: o.max, help: o.help, options: o.options,
    visible: o.visible,
    get: function(t){
      const v = getPath(effectiveParticleSystem(t), path);
      return o.read ? o.read(v) : v;
    },
    set: function(t, v){ writeParticleSetting(t, path, o.clamp ? o.clamp(v) : v); }
  };
}
const on = function(mod){ return function(t){ return !!getPath(effectiveParticleSystem(t), mod + '.enabled'); }; };
const and = function(a, b){ return function(t){ return a(t) && b(t); }; };
const shapeIs = function(){
  const types = Array.prototype.slice.call(arguments);
  return function(t){ return types.indexOf(getPath(effectiveParticleSystem(t), 'shape.type')) !== -1; };
};
const pos = function(v){ return Math.max(0, v); };
const unit = function(v){ return Math.max(0, Math.min(1, v)); };
const posPair = function(v){ return [Math.max(0, v[0]), Math.max(0, v[1])]; };
const bool = function(v){ return !!v; };

/** Une liste (salves, sous-émetteurs) : chaque ligne relit et réécrit la liste ENTIÈRE. */
function listField(id, label, path, addLabel, makeRow, subFields, visible){
  const current = function(t){ return JSON.parse(JSON.stringify(getPath(effectiveParticleSystem(t), path) || [])); };
  return {
    type: 'list', id: id, label: label, addLabel: addLabel,
    items: function(t){ return (visible && !visible(t)) ? [] : (getPath(effectiveParticleSystem(t), path) || []); },
    fields: function(item, i, t){
      return subFields().map(function(sf){
        return {ids: [id + '-' + i + '-' + sf.key], label: sf.label, type: sf.type, options: sf.options,
                step: sf.step, min: sf.min,
                get: function(row){ return (row[sf.key] === null || row[sf.key] === undefined) ? '' : row[sf.key]; },
                set: function(_row, v){
                  const list = current(t);
                  if(!list[i]) return;
                  list[i][sf.key] = sf.clamp ? sf.clamp(v) : v;
                  writeParticleSetting(t, path, list);
                }};
      });
    },
    onAdd: function(t){ const list = current(t); list.push(makeRow()); writeParticleSetting(t, path, list); },
    onRemove: function(t, i){ const list = current(t); list.splice(i, 1); writeParticleSetting(t, path, list); }
  };
}

function enabledField(mod){ const f = pf(mod + '.enabled', 'Activé', 'checkbox', {read: bool}); f.header = true; return f; }

/** Les sections des modules — identiques pour le composant et pour l'asset. */
export function particleModuleSections(){
  return [
    { id: 'pa-main', foldable: true, collapsed: false, title: 'Principal', fields: [
      pf('main.duration', 'Durée (s)', 'number', {step: 0.1, min: 0.05, clamp: function(v){ return Math.max(0.05, v); }}),
      pf('main.looping', 'Boucle', 'checkbox', {read: bool}),
      pf('main.prewarm', 'Préchauffage', 'checkbox', {read: bool,
        help: 'Démarre comme si le système tournait déjà depuis une durée entière (boucle seulement).',
        visible: function(t){ return !!getPath(effectiveParticleSystem(t), 'main.looping'); }}),
      pf('main.startDelay', 'Délai de départ (s)', 'number', {step: 0.1, min: 0, clamp: pos}),
      pf('main.playOnAwake', 'Lecture au démarrage', 'checkbox', {read: bool,
        help: 'Décoché : le système attend api.particles().play() en jeu.'}),
      pf('main.startLifetime', 'Durée de vie (min / max s)', 'pair', {step: 0.1,
        clamp: function(v){ return [Math.max(0.01, v[0]), Math.max(0.01, v[1])]; }}),
      pf('main.startSpeed', 'Vitesse (min / max)', 'pair', {step: 0.1}),
      pf('main.startSize', 'Taille (min / max m)', 'pair', {step: 0.05, clamp: posPair}),
      pf('main.startRotation', 'Rotation (min / max °)', 'pair', {step: 5}),
      pf('main.startColor', 'Couleur (entre deux)', 'colorPair', {}),
      // Librement NÉGATIVE : c'est ainsi qu'une étincelle retombe… et positive, qu'une fumée monte.
      pf('main.gravity', 'Gravité (m/s² sur Y)', 'number', {step: 0.1}),
      pf('main.simulationSpace', 'Espace', 'choice', {options: [['world', 'Monde (traînée)'], ['local', 'Local (suit l\'objet)']]}),
      pf('main.maxParticles', 'Max particules', 'number', {step: 10, min: 1, max: 20000,
        clamp: function(v){ return Math.max(1, Math.min(20000, Math.round(v))); }})
    ]},
    { id: 'pa-emission', foldable: true, collapsed: true, title: 'Émission', fields: [
      enabledField('emission'),
      pf('emission.rateOverTime', 'Débit (/s)', 'number', {step: 1, min: 0, clamp: pos, visible: on('emission')}),
      pf('emission.rateOverDistance', 'Débit (/m parcouru)', 'number', {step: 0.5, min: 0, clamp: pos, visible: on('emission'),
        help: 'Particules par mètre parcouru par l\'émetteur : une traînée derrière un objet qui bouge.'}),
      pf('emission.manualCount', 'Salve manuelle', 'number', {step: 1, min: 1, visible: on('emission'),
        clamp: function(v){ return Math.max(1, Math.round(v)); },
        help: 'Nombre émis par « Émettre maintenant », api.particles().emit() sans nombre, ou l\'action d\'événement.'}),
      listField('f-pa-bursts', 'Salves', 'emission.bursts', '＋ Ajouter une salve',
        function(){ return {time: 0, count: 30, cycles: 1, interval: 0.5}; },
        function(){ return [
          {key: 'time', label: 'À (s)', type: 'number', step: 0.1, min: 0, clamp: pos},
          {key: 'count', label: 'Nombre', type: 'number', step: 1, min: 0, clamp: function(v){ return Math.max(0, Math.round(v)); }},
          {key: 'cycles', label: 'Répétitions', type: 'number', step: 1, min: 1, clamp: function(v){ return Math.max(1, Math.round(v)); }},
          {key: 'interval', label: 'Intervalle (s)', type: 'number', step: 0.1, min: 0.01, clamp: function(v){ return Math.max(0.01, v); }}
        ]; }, on('emission'))
    ]},
    { id: 'pa-shape', foldable: true, collapsed: true, title: 'Forme', fields: [
      enabledField('shape'),
      pf('shape.type', 'Forme', 'choice', {visible: on('shape'), options: [
        ['cone', 'Cône'], ['sphere', 'Sphère'], ['hemisphere', 'Demi-sphère'], ['box', 'Boîte'],
        ['circle', 'Cercle (plat)'], ['edge', 'Segment'], ['point', 'Point']]}),
      pf('shape.angle', 'Angle (°)', 'number', {step: 1, min: 0, max: 89, visible: and(on('shape'), shapeIs('cone')),
        clamp: function(v){ return Math.max(0, Math.min(89, v)); }}),
      pf('shape.radius', 'Rayon', 'number', {step: 0.1, min: 0, clamp: pos,
        visible: and(on('shape'), shapeIs('cone', 'sphere', 'hemisphere', 'circle', 'edge'))}),
      pf('shape.radiusThickness', 'Épaisseur (0 = bord, 1 = plein)', 'number', {step: 0.05, min: 0, max: 1, clamp: unit,
        visible: and(on('shape'), shapeIs('cone', 'sphere', 'hemisphere', 'circle'))}),
      pf('shape.size', 'Taille de la boîte', 'vec3', {step: 0.1, visible: and(on('shape'), shapeIs('box')),
        clamp: function(v){ return v.map(pos); }}),
      pf('shape.randomizeDirection', 'Direction aléatoire', 'number', {step: 0.05, min: 0, max: 1, clamp: unit, visible: on('shape')})
    ]},
    { id: 'pa-vol', foldable: true, collapsed: true, title: 'Vitesse sur la durée de vie', fields: [
      enabledField('velocityOverLife'),
      pf('velocityOverLife.linear', 'Vitesse ajoutée', 'vec3', {step: 0.1, visible: on('velocityOverLife')}),
      pf('velocityOverLife.space', 'Repère', 'choice', {visible: on('velocityOverLife'),
        options: [['local', 'Local (suit l\'objet)'], ['world', 'Monde']]}),
      pf('velocityOverLife.speedCurve', 'Multiplicateur de vitesse', 'curve', {min: 0, max: 2, visible: on('velocityOverLife')})
    ]},
    { id: 'pa-force', foldable: true, collapsed: true, title: 'Force sur la durée de vie', fields: [
      enabledField('forceOverLife'),
      pf('forceOverLife.force', 'Force (m/s², monde)', 'vec3', {step: 0.1, visible: on('forceOverLife'),
        help: 'Une accélération constante : le vent, un courant.'})
    ]},
    { id: 'pa-limit', foldable: true, collapsed: true, title: 'Limite de vitesse et frottement', fields: [
      enabledField('limitVelocity'),
      pf('limitVelocity.limit', 'Vitesse max (0 = aucune)', 'number', {step: 0.1, min: 0, clamp: pos, visible: on('limitVelocity')}),
      pf('limitVelocity.dampen', 'Amortissement au-delà', 'number', {step: 0.05, min: 0, max: 1, clamp: unit, visible: on('limitVelocity')}),
      pf('limitVelocity.drag', 'Frottement de l\'air', 'number', {step: 0.05, min: 0, clamp: pos, visible: on('limitVelocity')})
    ]},
    { id: 'pa-noise', foldable: true, collapsed: true, title: 'Bruit', fields: [
      enabledField('noise'),
      pf('noise.strength', 'Force', 'number', {step: 0.1, visible: on('noise')}),
      pf('noise.frequency', 'Fréquence', 'number', {step: 0.05, min: 0.001, visible: on('noise'),
        clamp: function(v){ return Math.max(0.001, v); }}),
      pf('noise.scrollSpeed', 'Défilement', 'number', {step: 0.05, visible: on('noise')})
    ]},
    { id: 'pa-collision', foldable: true, collapsed: true, title: 'Collision (plan du sol)', fields: [
      enabledField('collision'),
      { type: 'note', when: on('collision'),
        text: 'Un plan horizontal en Y monde. Sans effet en espace local.' },
      pf('collision.planeHeight', 'Hauteur du plan (Y)', 'number', {step: 0.1, visible: on('collision')}),
      pf('collision.bounce', 'Rebond', 'number', {step: 0.05, min: 0, max: 2, visible: on('collision'),
        clamp: function(v){ return Math.max(0, Math.min(2, v)); }}),
      pf('collision.lifetimeLoss', 'Perte de vie au choc', 'number', {step: 0.05, min: 0, max: 1, clamp: unit, visible: on('collision'),
        help: '1 = la particule meurt au premier contact (pluie qui s\'écrase).'}),
      pf('collision.radiusScale', 'Échelle du rayon', 'number', {step: 0.1, min: 0, clamp: pos, visible: on('collision')})
    ]},
    { id: 'pa-color', foldable: true, collapsed: true, title: 'Couleur sur la durée de vie', fields: [
      enabledField('colorOverLife'),
      pf('colorOverLife.gradient', 'Dégradé', 'gradient', {visible: on('colorOverLife'),
        help: 'Multiplie la couleur de départ. L\'alpha des clés fait le fondu.'})
    ]},
    { id: 'pa-size', foldable: true, collapsed: true, title: 'Taille sur la durée de vie', fields: [
      enabledField('sizeOverLife'),
      pf('sizeOverLife.curve', 'Multiplicateur de taille', 'curve', {min: 0, max: 1, visible: on('sizeOverLife')})
    ]},
    { id: 'pa-rot', foldable: true, collapsed: true, title: 'Rotation sur la durée de vie', fields: [
      enabledField('rotationOverLife'),
      pf('rotationOverLife.angularVelocity', 'Vitesse angulaire (min / max °/s)', 'pair', {step: 5, visible: on('rotationOverLife')})
    ]},
    { id: 'pa-sheet', foldable: true, collapsed: true, title: 'Planche de sprites (flipbook)', fields: [
      enabledField('textureSheet'),
      { type: 'note', when: on('textureSheet'),
        text: 'La planche est la texture choisie dans « Rendu ». Les cases se lisent de gauche à droite, de haut en bas.' },
      pf('textureSheet.tilesX', 'Colonnes', 'number', {step: 1, min: 1, max: 64, visible: on('textureSheet'),
        clamp: function(v){ return Math.max(1, Math.min(64, Math.round(v))); }}),
      pf('textureSheet.tilesY', 'Lignes', 'number', {step: 1, min: 1, max: 64, visible: on('textureSheet'),
        clamp: function(v){ return Math.max(1, Math.min(64, Math.round(v))); }}),
      pf('textureSheet.mode', 'Défilement', 'choice', {visible: on('textureSheet'),
        options: [['lifetime', 'Sur la durée de vie'], ['fps', 'Images par seconde']]}),
      pf('textureSheet.cycles', 'Cycles sur la vie', 'number', {step: 0.5, min: 0.01, clamp: function(v){ return Math.max(0.01, v); },
        visible: and(on('textureSheet'), function(t){ return getPath(effectiveParticleSystem(t), 'textureSheet.mode') !== 'fps'; })}),
      pf('textureSheet.fps', 'Images / s', 'number', {step: 1, min: 0, clamp: pos,
        visible: and(on('textureSheet'), function(t){ return getPath(effectiveParticleSystem(t), 'textureSheet.mode') === 'fps'; })}),
      pf('textureSheet.randomStart', 'Case de départ au hasard', 'checkbox', {read: bool, visible: on('textureSheet')})
    ]},
    { id: 'pa-sub', foldable: true, collapsed: true, title: 'Sous-émetteurs', fields: [
      enabledField('subEmitters'),
      { type: 'note', when: on('subEmitters'),
        text: 'Un autre asset de particules, émis là où une particule naît, meurt ou touche le sol (explosion à l\'impact).' },
      listField('f-pa-subs', 'Sous-émetteurs', 'subEmitters.list', '＋ Ajouter un sous-émetteur',
        function(){ return {event: 'death', particlesId: null, count: 10}; },
        function(){ return [
          {key: 'event', label: 'Quand', type: 'choice',
           options: [['birth', 'Naissance'], ['death', 'Mort'], ['collision', 'Collision']]},
          {key: 'particlesId', label: 'Système', type: 'assetSlot',
           options: [['', '— aucun —']].concat(particleAssets('particles').map(function(a){ return [a.id, a.name]; })),
           clamp: function(v){ return v || null; }},
          {key: 'count', label: 'Nombre', type: 'number', step: 1, min: 1,
           clamp: function(v){ return Math.max(1, Math.round(v)); }}
        ]; }, on('subEmitters'))
    ]},
    { id: 'pa-render', foldable: true, collapsed: true, title: 'Rendu', fields: [
      pf('render.blending', 'Mélange', 'choice', {options: [['additive', 'Additif (lueurs, feu)'],
        ['normal', 'Normal (fumée, poussière)'], ['multiply', 'Multiplier (ombre, suie)']]}),
      { ids: ['f-pa-render-textureId'], label: 'Texture', type: 'assetSlot',
        help: 'Glissez une texture du panneau Projet. Vide : un disque doux.',
        options: function(){
          return [['', '— disque doux —']].concat(particleAssets('texture').map(function(a){ return [a.id, a.name]; }));
        },
        get: function(t){ return getPath(effectiveParticleSystem(t), 'render.textureId') || ''; },
        set: function(t, v){ writeParticleSetting(t, 'render.textureId', v || null); } },
      pf('render.renderMode', 'Orientation', 'choice', {options: [['billboard', 'Face caméra'],
        ['stretched', 'Étirée selon la vitesse'], ['horizontal', 'À plat (horizontale)'], ['vertical', 'Debout (axe Y)']]}),
      pf('render.lengthScale', 'Échelle de longueur', 'number', {step: 0.1, min: 0, clamp: pos,
        visible: function(t){ return getPath(effectiveParticleSystem(t), 'render.renderMode') === 'stretched'; }}),
      pf('render.speedScale', 'Allongement par la vitesse', 'number', {step: 0.01, min: 0, clamp: pos,
        visible: function(t){ return getPath(effectiveParticleSystem(t), 'render.renderMode') === 'stretched'; }})
    ]}
  ];
}

// ---------- Le composant ----------

function linked(c){ return !!(c && c.data && c.data.particlesId); }
function overrideCount(c){ return (c && c.data && c.data.overrides) ? Object.keys(c.data.overrides).length : 0; }

export const PARTICLES_COMPONENT_SECTIONS = [
  { id: 'pa-system', foldable: true, collapsed: false, title: 'Système', fields: [
    { ids: ['f-pa-asset'], label: 'Asset', type: 'assetSlot',
      help: 'Un asset de particules réutilisable (panneau Projet ▸ ＋ Créer ▸ Système de particules). '
        + 'Vide : le système est intégré à cet objet.',
      options: function(){
        return [['', '— intégré à l\'objet —']].concat(particleAssets('particles').map(function(a){ return [a.id, a.name]; }));
      },
      get: function(c){ return (c.data && c.data.particlesId) || ''; },
      set: function(c, v){
        if(v) attachParticlesAsset(c.data, v);
        else detachParticlesAsset(c.data, findParticleAsset);
        afterWrite(c);
      } },
    { type: 'note',
      when: function(c){ return linked(c) && !findParticleAsset(c.data.particlesId); },
      text: 'L\'asset référencé est introuvable : l\'émetteur montre ses réglages par défaut.' },
    { type: 'note',
      when: function(c){ return linked(c) && overrideCount(c) > 0; },
      text: function(c){
        return overrideCount(c) + ' réglage(s) surchargé(s) sur cet objet : '
          + Object.keys(c.data.overrides).join(', ') + '.';
      } },
    { type: 'action', ids: ['btn-pa-revert'], label: '↺ Rétablir les surcharges',
      visible: function(c){ return linked(c) && overrideCount(c) > 0; },
      run: function(c){ clearParticleOverride(c.data); afterWrite(c); } },
    { type: 'action', ids: ['btn-pa-save-asset'], label: '💾 Enregistrer comme asset',
      visible: function(c){ return !linked(c); },
      run: function(c){
        const make = (typeof globalThis.createAssetParticles === 'function') ? globalThis.createAssetParticles : null;
        if(!make) return;
        const a = make(null, (c.node && c.node.name) ? c.node.name : null);
        a.system = resolveParticleSystem(c.data, findParticleAsset);
        attachParticlesAsset(c.data, a.id);
        afterWrite(c);
      } },
    { type: 'action', ids: ['btn-pa-detach'], label: '✂ Détacher de l\'asset',
      help: 'Recopie le système (asset + surcharges) dans cet objet, qui ne suit plus l\'asset.',
      visible: linked,
      run: function(c){ detachParticlesAsset(c.data, findParticleAsset); afterWrite(c); } },
    { type: 'action', ids: ['btn-part-emit'], label: '✨ Émettre maintenant',
      run: function(c){ if(typeof emitBurst === 'function') emitBurst(c.node); } },
    { type: 'action', ids: ['btn-pa-restart'], label: '⟲ Redémarrer',
      run: function(c){ if(typeof globalThis.controlParticles === 'function') globalThis.controlParticles(c.node, 'restart'); } }
  ]}
].concat(particleModuleSections());

declareComponentPanel('Particles', {
  id: 'component-particles',
  sections: PARTICLES_COMPONENT_SECTIONS
});

// ---------- L'asset (inspecteur, panneau Projet) ----------

export const PARTICLES_ASSET_PANEL = {
  id: 'asset-particles',
  sections: [
    { id: 'pa-preset', foldable: true, collapsed: false, title: 'Asset de particules', fields: [
      { type: 'note', text: 'Tous les émetteurs qui suivent cet asset changent avec lui. '
        + 'Un réglage modifié sur un émetteur devient une surcharge de cet objet seul.' },
      { ids: ['f-pa-preset'], label: 'Repartir d\'un preset', type: 'choice',
        help: 'Remplace tous les réglages de l\'asset par ceux du preset.',
        options: [['', '—']].concat(Object.keys(PARTICLE_PRESETS).map(function(k){ return [k, PARTICLE_PRESETS[k].label]; })),
        get: function(){ return ''; },
        set: function(a, v){
          if(!v) return;
          a.system = systemOfPreset(v);
          afterWrite(a);
        } }
    ]}
  ].concat(particleModuleSections())
};

/** Pose le formulaire de l'asset dans `host` (inspecteur d'asset, js/import-settings.js). */
export function mountParticleAssetForm(a, host){
  if(!a || a.kind !== 'particles' || !host) return null;
  if(!a.system || !a.system.main) a.system = normalizeParticleSystem(a.system);
  const form = createForm(host, PARTICLES_ASSET_PANEL);
  form.setTargets([a]);
  return form;
}

globalThis.mountParticleAssetForm = mountParticleAssetForm;
