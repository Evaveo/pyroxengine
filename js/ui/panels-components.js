// ---------- Les descripteurs des vues de COMPOSANTS ----------
//
// DES DONNÉES, PAS DU CODE D'INTERFACE — même règle que panels-inspector.js et panels-scene.js.
// Un composant est un porteur de données ; sa vue était jusqu'ici quatre fonctions
// (`html`/`sync`/`input`/`click`) dans js/component-views.js, soit 1927 lignes de chaînes HTML
// et de routage par identifiant DOM. Elle devient un descripteur.
//
// LE CONTRAT DE CIBLE. La cible d'un formulaire de composant est LE COMPOSANT lui-même : `get`
// et `set` reçoivent donc l'instance, et lisent `c.data` — exactement ce que faisait `this.data`
// dans l'ancienne vue. C'est ce qui permet de tester un descripteur avec un objet factice de
// deux champs, sans monter ni Registry, ni Noeud, ni THREE.
//
// LES IDS NE CHANGENT PAS. Ils sont ceux d'avant, à la lettre : ce lot ne doit rien apprendre au
// reste du dépôt.

import { animationsExternalFor, attachAnimationExternal, clipsOf, detachAnimationExternal, externalClipsOf, layersOf, playerAnimatorOf, stopAnimator } from '../anim-models.js';
import { normalizeViewport } from '../camera-overlays.js';
import { clipShown, showClipInTimeline, stopClipShown, togglePlayback, updateTimeline } from '../animation.js';
import { clipsOfGraph, drawGraph, graphAnim, openAnimatorOnAsset } from '../animator-graph.js';
import { assets, createAssetAnimator, createAssetDocumentUI, createAssetSheetStyle, updateProject } from '../assets.js';
import { busOfSource } from '../audio-bus.js';
import { validateFalloffAudio } from '../audio-falloff.js';
import { applyKindDefaultsAudio, ensureListenerAudio, testAudioSelection } from '../audio.js';
import { updateBarTilemap } from '../brush-tilemap.js';
import { updateColliderViz } from '../collider.js';
import { ed, ensureGame, ensureProbe, isPlayableAudio } from '../component-data.js';
import { Registry } from '../component-registry.js';
import { ComponentViews } from '../component-views.js';
import { assetSpriteOfNode } from '../components/component-anim-sprite.js';
import { openEditorMachineJson } from '../components/component-animator.js';
import { layers2dOfProject, rebuildMeshSprite } from '../components/component-sprite.js';
import { rebuildTilemap } from '../components/component-tilemap.js';
import { applyEnvironment, env } from '../environment.js';
import { openEditorExternal } from '../external-editor.js';
import { setStatus, updateHierarchy } from '../hierarchy.js';
import { pushHistory } from '../history.js';
import { HUMANOID_BONES, autoMapAvatar, validateAvatar } from '../humanoid-avatar.js';
import { buildInspector, inspBody, quitViewCamera } from '../inspector.js';
import { applyMaterialOn, assetMaterialOf, extractMaterialFromInline, roughnessFromSmoothing, smoothingFromRoughness, toggleUnlit } from '../materials.js';
import { applyGeometryAsset, applyMaskCamera, buildGeometry, createHelperFor, objects } from '../objects.js';
import { emitBurst, resetSystemParticles } from '../particles.js';
import { updatePostVolumeViz } from '../post-volume-viz.js';
import { applyProbes, bakeAllProbes, bakeProbe, engineProbes, probeMoreNear, probesActive, receiversDEnvironment, updateBoxProbeViz } from '../probes.js';
import { project } from '../project.js';
import { activeCam, previewCam, setActiveCam, tc, viewEl } from '../scene.js';
import { openEditorScript } from '../scripts.js';
import { select, selectAsset, selection } from '../selection.js';
import { SYNTH_WAVES, normalizeSynth, normalizeVoice, playSequence } from '../synth.js';
import { openEditorGraphShader } from '../shader-graph-editor.js';
import { conventionOfNaming, modelAssetOf, toggleVisualSkeleton } from '../skeleton.js';
import { SCULPT_MODES, applyHeightsTerrain, flattenTerrain, generateTerrain, sculpt, toggleSculpt } from '../terrain.js';
import { clamp } from '../ui.js';
import { createForm } from './form.js';
import { resize } from '../viewport.js';

export const ComponentPanels = {};

/** Déclare le descripteur d'un composant, et l'enregistre auprès de la façade. */
export function declareComponentPanel(typeName, descriptor){
  ComponentPanels[typeName] = descriptor;
  if(typeof ComponentViews !== 'undefined' && ComponentViews.registerPanel){
    ComponentViews.registerPanel(typeName, descriptor);
  }
  return descriptor;
}

// ---------------------------------------------------------------------------
// Rigidbody2D — un corps physique 2D : statique ou non, soumis à la gravité ou non.

declareComponentPanel('Rigidbody2D', {
  id: 'component-rigidbody2d',
  sections: [{ id: 'rb2', title: '', fields: [
    { ids: ['f-rb2-stat'], label: 'Statique', type: 'checkbox',
      help: 'Un body statique ne bouge pas et sert d obstacle : sol, mur, plateforme.',
      get: function(c){ return !!c.data.statique; },
      set: function(c, v){ c.data.statique = !!v; } },
    { ids: ['f-rb2-sg'], label: 'Sans gravité', type: 'checkbox',
      get: function(c){ return !!c.data.withoutGravity; },
      set: function(c, v){ c.data.withoutGravity = !!v; } },
    // 40 quand le champ manque — et la borne basse à 1 : une vitesse max nulle immobiliserait
    // le corps sans que rien ne le dise.
    { ids: ['f-rb2-vmax'], label: 'Vitesse max', type: 'number', step: 1, min: 1, max: 500,
      get: function(c){ return c.data.speedMax || 40; },
      set: function(c, v){ c.data.speedMax = Math.max(1, v || 40); } }
  ]}]
});

// ---------------------------------------------------------------------------
// Collider2D — une boîte ou une pente. Les deux n'ont pas les mêmes réglages : une pente monte
// vers la gauche ou la droite, une boîte peut être traversable (plateforme à sens unique).

declareComponentPanel('Collider2D', {
  id: 'component-collider2d',
  sections: [{ id: 'c2', title: '', fields: [
    { ids: ['f-c2-shape'], label: 'Forme', type: 'choice',
      options: [['box', 'Boîte'], ['slope', 'Pente']],
      get: function(c){ return c.data.shape || 'box'; },
      set: function(c, v){ c.data.shape = v; updateColliderViz(); } },
    { ids: ['f-c2-l'], label: 'Largeur', type: 'number', step: 0.1, min: 0.01,
      get: function(c){ return c.data.l; },
      set: function(c, v){ c.data.l = Math.max(0.01, v || 0); updateColliderViz(); } },
    { ids: ['f-c2-h'], label: 'Hauteur', type: 'number', step: 0.1, min: 0.01,
      get: function(c){ return c.data.h; },
      set: function(c, v){ c.data.h = Math.max(0.01, v || 0); updateColliderViz(); } },
    // Les décalages sont librement négatifs : c'est leur raison d'être.
    { ids: ['f-c2-dx'], label: 'Décalage X', type: 'number', step: 0.1,
      get: function(c){ return c.data.dx || 0; },
      set: function(c, v){ c.data.dx = v || 0; updateColliderViz(); } },
    { ids: ['f-c2-dy'], label: 'Décalage Y', type: 'number', step: 0.1,
      get: function(c){ return c.data.dy || 0; },
      set: function(c, v){ c.data.dy = v || 0; updateColliderViz(); } },
    { ids: ['f-c2-montee'], label: 'Monte vers', type: 'choice',
      options: [['right', 'la droite'], ['left', 'la gauche']],
      visible: function(c){ return c.data.shape === 'slope'; },
      get: function(c){ return c.data.stepUp || 'right'; },
      set: function(c, v){ c.data.stepUp = v; updateColliderViz(); } },
    { ids: ['f-c2-walk'], label: 'Traversable', type: 'checkbox',
      help: 'Plateforme à sens unique : on la traverse par en dessous et on se pose dessus par '
          + 'au-dessus. Le saut depuis la plateforme reste possible.',
      visible: function(c){ return (c.data.shape || 'box') !== 'slope'; },
      get: function(c){ return !!c.data.traversable; },
      set: function(c, v){ c.data.traversable = !!v; } }
  ]}]
});

// ---------------------------------------------------------------------------
// Light — ponctuelle, spot ou directionnelle. Changer de sous-type RECONSTRUIT l'objet three :
// une lumière n'est pas un réglage d'une autre, ce sont trois classes distinctes.
//
// AU PASSAGE, UN CHAMP MORT. L'ancienne vue routait `['f-lcolor', 'f-intensite', 'f-portee',
// 'f-angle', 'f-penombre']` alors que le champ construit s'appelle `f-range` : la PORTÉE d'une
// lumière ne s'enregistrait pas. Le routage par liste d'identifiants ne pardonne pas une
// traduction à moitié faite — et il ne dit rien.

declareComponentPanel('Light', {
  id: 'component-light',
  sections: [{ id: 'light', title: '', fields: [
    { ids: ['f-lsubtype'], label: 'Type', type: 'choice',
      options: [['point', 'Ponctuelle'], ['spot', 'Spot'], ['directional', 'Directionnelle']],
      get: function(c){ return c.subType; },
      set: function(c, v){
        if(v === c.subType) return;
        const o = c.node;
        // L'ancien objet three s'en va AVEC sa cible : une directionnelle en pose une comme
        // enfant, et l'oublier laisserait un objet orphelin dans la scène.
        if(c.objectThree){
          const target = c.objectThree.target;
          o.remove(c.objectThree);
          if(target && target.parent === o) o.remove(target);
        }
        if(o.userData.type === c.subType) o.userData.type = 'group';
        c.subType = v;
        c.objectThree = null;
        ed(o).light = null;
        c.onAdd();
        createHelperFor(o);
        buildInspector();
      } },
    { ids: ['f-lcolor'], label: 'Couleur', type: 'color',
      get: function(c){ return c.objectThree ? '#' + c.objectThree.color.getHexString() : '#ffffff'; },
      set: function(c, v){
        const lum = c.objectThree;
        if(!lum) return;
        lum.color.set(v);
        // Le maillage qui REPRÉSENTE la lumière prend sa couleur : sans ça, on règle une
        // lumière jaune et son repère reste blanc dans la vue.
        const o = c.node;
        o.material.emissive.set(v);
        o.userData.emissiveBase = lum.color.getHex();
        o.userData.emissiveSel = lum.color.getHex();
        c.color = lum.color.getHex();
      } },
    { ids: ['f-intensite'], label: 'Intensité', type: 'number', step: 0.05, min: 0, max: 8,
      get: function(c){ return c.objectThree ? c.objectThree.intensity : c.intensity; },
      set: function(c, v){ if(c.objectThree) c.objectThree.intensity = v; c.intensity = v; } },
    { ids: ['f-range'], label: 'Portée', type: 'number', step: 1, min: 0, max: 100,
      // Une directionnelle éclaire depuis l'infini : elle n'a pas de portée.
      visible: function(c){ return c.subType !== 'directional'; },
      get: function(c){ return c.objectThree ? c.objectThree.distance : c.range; },
      set: function(c, v){
        if(c.objectThree && c.objectThree.distance !== undefined) c.objectThree.distance = v;
        c.range = v;
      } },
    { ids: ['f-angle'], label: 'Angle °', type: 'number', step: 1, min: 5, max: 85,
      visible: function(c){ return c.subType === 'spot'; },
      // Degrés à l'écran, radians dans three : la conversion est une affaire d'interface.
      get: function(c){ return c.objectThree ? THREE.MathUtils.radToDeg(c.objectThree.angle) : 0; },
      set: function(c, v){
        if(!c.objectThree) return;
        c.objectThree.angle = THREE.MathUtils.degToRad(v);
        c.angle = c.objectThree.angle;
      } },
    { ids: ['f-penombre'], label: 'Pénombre', type: 'number', step: 0.05, min: 0, max: 1,
      visible: function(c){ return c.subType === 'spot'; },
      get: function(c){ return c.objectThree ? c.objectThree.penumbra : c.penumbra; },
      set: function(c, v){ if(c.objectThree) c.objectThree.penumbra = v; c.penumbra = v; } }
  ]}]
});

// ---------------------------------------------------------------------------
// Collider — la forme de collision. « Auto » suit la boîte englobante du maillage et n'a donc ni
// dimensions ni décalage à régler ; les trois autres en ont.

declareComponentPanel('Collider', {
  id: 'component-collider',
  sections: [{ id: 'collider', title: '', fields: [
    { ids: ['f-cshape'], label: 'Forme', type: 'choice',
      options: [['auto', 'Auto (boîte englobante)'], ['box', 'Boîte'],
                ['sphere', 'Sphère'], ['cylindre', 'Cylindre']],
      get: function(c){ return c.data.shape; },
      set: function(c, v){ c.data.shape = v; updateColliderViz(); } },
    { ids: ['f-cdx', 'f-cdy', 'f-cdz'], label: 'Taille', type: 'vec3', step: 0.1,
      visible: function(c){ return c.data.shape === 'box'; },
      get: function(c){ return c.data.dims.slice(); },
      set: function(c, v){
        // 0.05 au minimum : un collider d'épaisseur nulle ne touche jamais rien, et ça se
        // cherche longtemps.
        c.data.dims = v.map(function(x){ return Math.max(0.05, x); });
        updateColliderViz();
      } },
    { ids: ['f-crayon'], label: 'Rayon', type: 'number', step: 0.1, min: 0.05, max: 100,
      visible: function(c){ return c.data.shape === 'sphere' || c.data.shape === 'cylindre'; },
      get: function(c){ return c.data.radius; },
      set: function(c, v){ c.data.radius = Math.max(0.05, v); updateColliderViz(); } },
    { ids: ['f-chauteur'], label: 'Hauteur', type: 'number', step: 0.1, min: 0.05, max: 100,
      visible: function(c){ return c.data.shape === 'cylindre'; },
      get: function(c){ return c.data.height; },
      set: function(c, v){ c.data.height = Math.max(0.05, v); updateColliderViz(); } },
    { ids: ['f-cox', 'f-coy', 'f-coz'], label: 'Décalage', type: 'vec3', step: 0.1,
      visible: function(c){ return c.data.shape !== 'auto'; },
      get: function(c){ return c.data.offset.slice(); },
      set: function(c, v){ c.data.offset = v.slice(); updateColliderViz(); } },
    { ids: ['f-ctrigger'], label: 'Déclencheur', type: 'checkbox',
      help: 'Trigger : détecté mais ne bloque pas (collisionResponse désactivée)',
      visible: function(c){ return c.data.shape !== 'auto'; },
      get: function(c){ return !!c.data.trigger; },
      set: function(c, v){ c.data.trigger = !!v; updateColliderViz(); } }
  ]}]
});

// ---------------------------------------------------------------------------
// PostVolume — zone (ou volume global) de post-traitement, référence un profil réutilisable.

declareComponentPanel('PostVolume', {
  id: 'component-postvolume',
  sections: [{ id: 'postvolume', title: '', fields: [
    { ids: ['f-pv-profile'], label: 'Profil', type: 'choice',
      options: function(){
        return [['', '— aucun —']].concat(
          assets.filter(function(a){ return a.kind === 'postProfile'; })
                .map(function(a){ return [a.id, a.name]; }));
      },
      get: function(c){ return c.data.profileId || ''; },
      set: function(c, v){ c.data.profileId = v || null; } },
    { type: 'note',
      when: function(c){ return !assets.some(function(a){ return a.kind === 'postProfile'; }); },
      text: 'Créez d\'abord un profil 🌈 dans le panneau Projet.' },
    { ids: ['f-pv-global'], label: 'Global', type: 'checkbox',
      help: 'Un volume global s\'applique partout, sans zone. Décochez pour poser une zone locale.',
      get: function(c){ return !!c.data.global; },
      set: function(c, v){ c.data.global = !!v; updatePostVolumeViz(); } },
    { ids: ['f-pv-shape'], label: 'Forme', type: 'choice',
      visible: function(c){ return !c.data.global; },
      options: [['box', 'Boîte'], ['sphere', 'Sphère']],
      get: function(c){ return c.data.shape; },
      set: function(c, v){ c.data.shape = v; updatePostVolumeViz(); } },
    { ids: ['f-pv-sx', 'f-pv-sy', 'f-pv-sz'], label: 'Taille', type: 'vec3', step: 0.1,
      visible: function(c){ return !c.data.global && c.data.shape === 'box'; },
      get: function(c){ return [c.data.size.x, c.data.size.y, c.data.size.z]; },
      set: function(c, v){
        c.data.size = {x: Math.max(0.05, v[0]), y: Math.max(0.05, v[1]), z: Math.max(0.05, v[2])};
        updatePostVolumeViz();
      } },
    { ids: ['f-pv-radius'], label: 'Rayon', type: 'number', step: 0.1, min: 0.05, max: 1000,
      visible: function(c){ return !c.data.global && c.data.shape === 'sphere'; },
      get: function(c){ return c.data.radius; },
      set: function(c, v){ c.data.radius = Math.max(0.05, v); updatePostVolumeViz(); } },
    { ids: ['f-pv-blend'], label: 'Distance de fondu', type: 'number', step: 0.1, min: 0, max: 1000,
      visible: function(c){ return !c.data.global; },
      help: 'Largeur de la zone de transition progressive autour de la forme',
      get: function(c){ return c.data.blendDistance; },
      set: function(c, v){ c.data.blendDistance = Math.max(0, v); } },
    { ids: ['f-pv-priority'], label: 'Priorité', type: 'number', step: 1, min: -100, max: 100,
      help: 'À poids égal, la priorité la plus haute domine',
      get: function(c){ return c.data.priority; },
      set: function(c, v){ c.data.priority = v; } }
  ]}]
});

// ---------------------------------------------------------------------------
// Physics — masse, rebond, friction d'un corps rigide 3D.

declareComponentPanel('Physics', {
  id: 'component-physics',
  sections: [{ id: 'phys', title: 'Physique', fields: [
    { ids: ['f-pmass'], label: 'Masse', type: 'number', step: 0.1, min: 0, max: 1000,
      // Masse 0 = corps statique dans cannon : c'est une valeur légitime, pas une absence.
      get: function(c){ return c.data.masse; },
      set: function(c, v){ c.data.masse = v; } },
    { ids: ['f-prebond'], label: 'Rebond', type: 'number', step: 0.05, min: 0, max: 1,
      get: function(c){ return c.data.bounce; },
      set: function(c, v){ c.data.bounce = Math.max(0, Math.min(1, v)); } },
    { ids: ['f-pfriction'], label: 'Friction', type: 'number', step: 0.05, min: 0, max: 1,
      get: function(c){ return c.data.friction; },
      set: function(c, v){ c.data.friction = Math.max(0, Math.min(1, v)); } }
  ]}]
});

// ---------------------------------------------------------------------------
// SpriteAnimator — les suites d'animation appartiennent à la PLANCHE, pas à l'objet : sans
// planche, il n'y a rien à régler ici, et il faut le dire plutôt que d'afficher trois champs
// vides.
//
// AU PASSAGE, UN AUTRE CHAMP MORT. Le champ était construit sous l'id `f-as-vitesse` et
// relu sous `f-as-speed` : la VITESSE d'une animation de sprite ne s'enregistrait pas.

declareComponentPanel('SpriteAnimator', {
  id: 'component-spriteanimator',
  sections: [{ id: 'sa', title: '', fields: [
    { type: 'note',
      when: function(c){ return !assetSpriteOfNode(c.node); },
      text: 'Cet objet n\'a pas encore de SpriteRenderer réglé sur une planche. Les suites '
          + 'd\'animation sont des images de cette planche : choisissez-la d\'abord.' },
    // Les problèmes AVANT le reste : une suite mal réglée n'est pas une erreur, elle joue
    // simplement autre chose que ce qu'on croit.
    { type: 'note',
      when: function(c){ return spriteSequenceIssues(c).length > 0; },
      text: function(c){
        const s = spriteSequenceIssues(c);
        return s.length + ' problème(s) : ' + s.join(' · ');
      } },
    { type: 'note',
      when: function(c){
        const a = assetSpriteOfNode(c.node);
        return !!a && !(a.sequences || []).length;
      },
      text: function(c){
        return 'La planche « ' + assetSpriteOfNode(c.node).name + ' » n\'a aucune suite '
             + 'd\'animation. Créez-les dans le panneau Projet, sur la planche elle-même : '
             + 'elles appartiennent à la planche, pas à cet objet.';
      } },
    { ids: ['f-as-defaut'], label: 'Suite par défaut', type: 'choice',
      visible: function(c){ return spriteSequences(c).length > 0; },
      options: function(c){
        return [['', '— aucune —']].concat(spriteSequences(c).map(function(s){ return [s.name, s.name]; }));
      },
      get: function(c){ return c.data.defaultValue || ''; },
      set: function(c, v){
        c.data.defaultValue = v;
        // On redémarre sur la nouvelle suite : régler « défaut » sans rien voir changer dans la
        // vue laisserait croire que le réglage n'a pas pris.
        playAnimSprite(c.node, v, true);
      } },
    { ids: ['f-as-vitesse'], label: 'Vitesse', type: 'number', step: 0.1, min: 0.01, max: 20,
      visible: function(c){ return spriteSequences(c).length > 0; },
      get: function(c){ return c.data.speed === undefined ? 1 : c.data.speed; },
      set: function(c, v){ c.data.speed = Math.max(0.01, Math.min(20, v || 1)); } },
    { ids: ['f-as-auto'], label: 'Jouer au démarrage', type: 'checkbox',
      visible: function(c){ return spriteSequences(c).length > 0; },
      get: function(c){ return c.data.auto !== false; },
      set: function(c, v){ c.data.auto = !!v; } },
    { type: 'note',
      when: function(c){ return spriteSequences(c).length > 0; },
      text: 'La suite par défaut est reprise dès qu\'une suite sans boucle se termine — une '
          + 'réception, un atterrissage. Un script joue une autre suite avec '
          + 'playAnimSprite(objet, \'nom\').' }
  ]}]
});

/** Les suites d'animation de la planche de ce sprite, ou une liste vide. */
export function spriteSequences(c){
  const a = assetSpriteOfNode(c.node);
  return (a && a.sequences) || [];
}
/** Ce qui cloche dans ces suites — mesuré par validateSequences quand il est chargé. */
export function spriteSequenceIssues(c){
  const a = assetSpriteOfNode(c.node);
  if(!a || typeof validateSequences !== 'function') return [];
  return validateSequences(a.sequences || [], a.regions) || [];
}

// ---------------------------------------------------------------------------
// CharacterController2D — de côté ou de dessus. Les champs du saut DISPARAISSENT en vue de
// dessus au lieu d'être grisés : un réglage visible mais sans effet se règle quand même, et on
// cherche ensuite pourquoi il ne fait rien.

declareComponentPanel('CharacterController2D', {
  id: 'component-charactercontroller2d',
  sections: [{ id: 'ct2', title: '', fields: [
    { ids: ['f-ct2-mode'], label: 'Vue', type: 'choice',
      options: [['platform', 'de côté (plateforme)'], ['topdown', 'de dessus (8 directions)']],
      get: function(c){ return c.data.mode || 'platform'; },
      set: function(c, v){ c.data.mode = (v === 'topdown') ? 'topdown' : 'platform'; } },
    { ids: ['f-ct2-vit'], label: 'Vitesse', type: 'number', step: 0.5, min: 0,
      get: function(c){ return c.data.speed; },
      set: function(c, v){ c.data.speed = Math.max(0, v || 0); } },
    { type: 'note',
      when: function(c){ return c.data.mode === 'topdown'; },
      text: 'En vue de dessus, ce personnage ne subit pas la gravité et n\'escalade rien : les '
          + 'deux sont posés par le mode, il n\'y a pas de case à cocher à côté. Les diagonales '
          + 'sont ramenées à la vitesse des lignes droites — sans quoi on avance 41 % plus vite '
          + 'en biais, et tout le jeu se parcourt en zigzag.' },
    { ids: ['f-ct2-saut'], label: 'Hauteur de saut', type: 'number', step: 0.1, min: 0,
      visible: function(c){ return (c.data.mode || 'platform') !== 'topdown'; },
      get: function(c){ return c.data.heightJump; },
      set: function(c, v){ c.data.heightJump = Math.max(0, v || 0); } },
    { ids: ['f-ct2-coy'], label: 'Coyote (s)', type: 'number', step: 0.01, min: 0, max: 1,
      visible: function(c){ return (c.data.mode || 'platform') !== 'topdown'; },
      get: function(c){ return c.data.coyote; },
      set: function(c, v){ c.data.coyote = Math.max(0, v || 0); } },
    { ids: ['f-ct2-mem'], label: 'Mémoire du saut (s)', type: 'number', step: 0.01, min: 0, max: 1,
      visible: function(c){ return (c.data.mode || 'platform') !== 'topdown'; },
      get: function(c){ return c.data.memoireJump; },
      set: function(c, v){ c.data.memoireJump = Math.max(0, v || 0); } },
    { type: 'note',
      when: function(c){ return (c.data.mode || 'platform') !== 'topdown'; },
      text: 'La hauteur de saut se règle en unités, pas en vitesse : changer la gravité ne la '
          + 'refait pas mentir. Le coyote laisse sauter quelques centièmes après avoir quitté le '
          + 'sol, la mémoire joue un saut demandé juste avant d\'atterrir. Sans elles, le jeu '
          + 'répond mal sans qu\'on sache dire pourquoi.' }
  ]}]
});

// ---------------------------------------------------------------------------
// CameraFollow — le suivi borné. Sa donnée n'est PAS dans `c.data` mais sur le composant
// lui-même (`c.targetName`, `c.xMin`…) : les accesseurs le disent, plutôt que d'uniformiser un
// modèle qui ne l'est pas.
//
// UNE BORNE ABSENTE EST `null`, PAS ZÉRO. Zéro est une borne parfaitement légitime ; les
// confondre bornerait l'axe à l'origine, et la caméra buterait sur un mur invisible.

/** Une borne de niveau : vide quand elle est absente, jamais zéro. */
export function boundField(id, label, key){
  return {
    ids: [id], label: label, type: 'number', step: 0.5,
    get: function(c){
      return (typeof c[key] === 'number' && isFinite(c[key])) ? c[key] : null;
    },
    set: function(c, v){ c[key] = (v === null || v === undefined) ? null : v; }
  };
}

/** Ce qui cloche dans ce suivi, quand le validateur est chargé. */
export function cameraFollowIssues(c){
  return (typeof validateCameraFollow === 'function') ? (validateCameraFollow(c) || []) : [];
}

declareComponentPanel('CameraFollow', {
  id: 'component-camerafollow',
  sections: [
    { id: 'camf', title: '', fields: [
      // Le suivi par une LISTE et non un champ libre : un nom mal tapé donne une caméra qui ne
      // suit rien, sans erreur — et on cherche le défaut du côté de la caméra.
      { ids: ['f-camf-target'], label: 'Suit', type: 'choice',
        options: function(c){
          const o = c.node;
          const names = objects
            .filter(function(x){ return x !== o && x.name; })
            .map(function(x){ return [x.name, x.name]; });
          return [['', '— personne (caméra fixe) —']].concat(names);
        },
        get: function(c){ return c.targetName || ''; },
        set: function(c, v){ c.targetName = v || ''; } },
      { ids: ['f-camf-top'], label: 'Regard vers le haut', type: 'number',
        step: 0.01, min: -0.5, max: 0.5,
        get: function(c){ return c.topOfView; },
        set: function(c, v){ c.topOfView = v || 0; } },
      { ids: ['f-camf-snap'], label: 'Caler sur le pixel', type: 'checkbox',
        help: 'Arrondit la caméra à la grille de pixels. Sans ça tout le décor frémit au '
            + 'déplacement, un texel tombant tantôt sur un pixel, tantôt entre deux.',
        get: function(c){ return !!c.snapPixel; },
        set: function(c, v){ c.snapPixel = !!v; } }
    ]},
    { id: 'camf-bounds', title: 'Bornes du niveau', fields: [
      boundField('f-camf-xmin', 'X min', 'xMin'),
      boundField('f-camf-xmax', 'X max', 'xMax'),
      boundField('f-camf-ymin', 'Y min', 'yMin'),
      boundField('f-camf-ymax', 'Y max', 'yMax'),
      { type: 'action', ids: ['btn-camf-bounds'], label: 'Déduire du décor',
        run: function(c){
          // Les bornes DÉDUITES du décor : l'union des obstacles. Les taper à la main demande de
          // lire les coordonnées d'une tilemap, ce que personne ne fait — donc en pratique
          // personne ne borne, donc la caméra montre le vide au-delà du décor.
          const obs = (typeof gatherWorld2d === 'function') ? gatherWorld2d(objects).obstacles : [];
          const b = boundsFromObstacles2d(obs);
          if(!b){
            setStatus('Aucun sol ni mur trouvé : posez d abord le décor (tilemap ou colliders '
              + 'statiques), les bornes s en déduisent.', 6000);
            return;
          }
          Object.assign(c, {xMin: b.xMin, xMax: b.xMax, yMin: b.yMin, yMax: b.yMax});
          setStatus('Bornes déduites : X ' + b.xMin.toFixed(1) + '…' + b.xMax.toFixed(1)
            + ', Y ' + b.yMin.toFixed(1) + '…' + b.yMax.toFixed(1), 4000);
        } },
      { type: 'action', ids: ['btn-camf-free'], label: 'Enlever les bornes',
        run: function(c){
          ['xMin', 'xMax', 'yMin', 'yMax'].forEach(function(k){ c[k] = null; });
          setStatus('Bornes enlevées : la caméra suit sans limite', 2500);
        } },
      { type: 'note',
        text: 'Une paire de bornes absente laisse l axe LIBRE — c est ce qu on veut sur la '
            + 'verticale d une tour dont on ne connaît pas la fin. Une caméra sans bornes du tout '
            + 'finit par montrer le vide au-delà du décor.' },
      // Les problèmes mesurés (une borne min au-dessus de sa max, une cible introuvable) :
      // affichés, pas devinés.
      { type: 'note',
        when: function(c){ return cameraFollowIssues(c).length > 0; },
        text: function(c){ return cameraFollowIssues(c).join(' · '); } }
    ]}
  ]
});

// ---------------------------------------------------------------------------
// TeamColor — la couleur du joueur sur la partie « équipe » d'un modèle partagé.

declareComponentPanel('FogOfWar', {
  id: 'component-fogofwar',
  sections: [{ id: 'fog', title: '', fields: [
    { ids: ['f-fog-team'], label: 'Équipe du joueur', type: 'number', step: 1, min: 0, max: 16,
      get: function(c){ return c.data.team; }, set: function(c, v){ c.data.team = v; if(c.reset && /cols|rows|cellSize/.test('team')) c.reset(); } },
    { ids: ['f-fog-cell'], label: 'Taille de case (m)', type: 'number', step: 0.25, min: 0.25,
      get: function(c){ return c.data.cellSize; }, set: function(c, v){ c.data.cellSize = v; if(c.reset && /cols|rows|cellSize/.test('cellSize')) c.reset(); } },
    { ids: ['f-fog-cols'], label: 'Colonnes', type: 'number', step: 1, min: 1, max: 1024,
      get: function(c){ return c.data.cols; }, set: function(c, v){ c.data.cols = v; if(c.reset && /cols|rows|cellSize/.test('cols')) c.reset(); } },
    { ids: ['f-fog-rows'], label: 'Lignes', type: 'number', step: 1, min: 1, max: 1024,
      get: function(c){ return c.data.rows; }, set: function(c, v){ c.data.rows = v; if(c.reset && /cols|rows|cellSize/.test('rows')) c.reset(); } },
    { ids: ['f-fog-h'], label: 'Hauteur de la surface', type: 'number', step: 0.01,
      get: function(c){ return c.data.height; }, set: function(c, v){ c.data.height = v; if(c.reset && /cols|rows|cellSize/.test('height')) c.reset(); } },
    { ids: ['f-fog-exp'], label: 'Opacité exploré', type: 'number', step: 0.05, min: 0, max: 1,
      get: function(c){ return c.data.exploredOpacity; }, set: function(c, v){ c.data.exploredOpacity = v; if(c.reset && /cols|rows|cellSize/.test('exploredOpacity')) c.reset(); } },
    { ids: ['f-fog-color'], label: 'Couleur', type: 'color',
      get: function(c){ return c.data.color; }, set: function(c, v){ c.data.color = v; } },
    { type: 'note', text: 'Actif en JEU seulement : en édition rien n est caché. Origine = coin (x, z) minimal de la grille, réglable par configure_fog_of_war.' }
  ]}]
});

declareComponentPanel('Vision', {
  id: 'component-vision',
  sections: [{ id: 'vis', title: '', fields: [
    { ids: ['f-vis-r'], label: 'Rayon (m)', type: 'number', step: 0.5, min: 0,
      get: function(c){ return c.data.radius; }, set: function(c, v){ c.data.radius = v; if(c.reset && /cols|rows|cellSize/.test('radius')) c.reset(); } },
    { ids: ['f-vis-team'], label: 'Équipe', type: 'number', step: 1, min: 0, max: 16,
      get: function(c){ return c.data.team; }, set: function(c, v){ c.data.team = v; if(c.reset && /cols|rows|cellSize/.test('team')) c.reset(); } },
    { ids: ['f-vis-mem'], label: 'Mémoriser', type: 'checkbox',
      help: 'Une fois aperçu, reste affiché sous le brouillard (bâtiments, ressources).',
      get: function(c){ return !!c.data.remember; }, set: function(c, v){ c.data.remember = !!v; } }
  ]}]
});

declareComponentPanel('TeamColor', {
  id: 'component-teamcolor',
  sections: [{ id: 'teamc', title: '', fields: [
    { ids: ['f-teamc-color'], label: 'Couleur', type: 'color',
      get: function(c){ return c.color; }, set: function(c, v){ c.color = v; } },
    { ids: ['f-teamc-mat'], label: 'Matériau teint', type: 'text',
      help: 'Nom du matériau du modèle qui porte la partie équipe, dessinée en niveaux de gris.',
      get: function(c){ return c.material; }, set: function(c, v){ c.material = v; } },
    { type: 'note', when: function(c){ return !c.tinted; },
      text: function(c){ return 'Aucun maillage de ce modèle ne porte un matériau nommé « ' + c.material + ' » : rien n' + "'" + 'est teint.'; } }
  ]}]
});

// ---------------------------------------------------------------------------
// ScriptJS — un script attaché, et ses variables `@expose`.
//
// SES CHAMPS NE SONT PAS CONNUS D'AVANCE : ce sont les variables que le script expose, lues sur
// l'instance. D'où des `sections` calculées sur la cible. Les ids restent
// `f-comp-values-<nom>` — c'est ce que l'ancien routage par préfixe visait.

declareComponentPanel('ScriptJS', {
  id: 'component-scriptjs',
  sections: function(c){
    if(!c) return [];
    // Une variable exposée sans valeur prend sa valeur par défaut À L'AFFICHAGE : sans ça, le
    // champ naît vide et le script tourne avec une valeur que personne n'a choisie.
    (c.exposures || []).forEach(function(e){
      if(!(e.name in c.values)) c.values[e.name] = e.defaultValue;
    });
    const i = c.node.userData.scripts.indexOf(c.entry);
    // LE NOM DE L'ASSET, ET UN AVERTISSEMENT QUAND IL NE RÉSOUT RIEN. Le champ disait
    // « (vide) » pour un code vide, ce qui ne distingue pas un script vide d'un script
    // INTROUVABLE : depuis que le composant référence son asset, un objet peut porter un
    // `scriptId` dont l'asset a été supprimé — ou venir d'un projet d'avant la référence, qui
    // portait le code en dur. Dans les deux cas l'objet n'exécute plus rien, et c'est ici, sur
    // le composant lui-même, qu'on doit pouvoir le lire.
    const a = c.asset;
    // LE CHAMP EST UN SLOT, PAS UN LIBELLÉ. Il affichait le nom de l'asset en lecture seule :
    // un composant ScriptJS fraîchement ajouté (scriptId nul) n'offrait alors AUCUN moyen de
    // désigner son script — ni liste, ni dépôt. On pouvait poser le composant et pas s'en
    // servir. Le slot liste les scripts du projet ET accepte qu'on y lâche un script du
    // panneau Projet (type `assetSlot`, js/ui/fields.js), comme un champ d'objet Unity.
    const scripts = (typeof assets !== 'undefined' && Array.isArray(assets))
      ? assets.filter(function(x){ return x.kind === 'script'; }) : [];
    return [{ id: 'script', title: '', fields: [
      { ids: ['f-script-asset-' + c.uid], label: 'Script ' + (i + 1), type: 'assetSlot',
        help: 'Le script exécuté par cet objet. Glissez-y un script du panneau Projet, ou '
          + 'choisissez-le dans la liste.',
        options: function(){
          return [['', '— aucun —']].concat(scripts.map(function(x){
            // Un script vide se dit ICI : sinon on croit le composant branché et rien ne tourne.
            return [x.id, (x.code && x.code.trim()) ? x.name : x.name + ' (vide)'];
          }));
        },
        get: function(x){ return x.entry.scriptId || ''; },
        set: function(x, v){
          const asset = v ? scripts.find(function(y){ return y.id === v; }) : null;
          x.entry.scriptId = asset ? asset.id : null;
          // Les variables @expose du NOUVEAU script : celles de l'ancien n'ont plus de sens, et
          // les garder ferait traîner des réglages qu'aucun champ n'affiche plus.
          x.entry.values = {};
          (x.exposures || []).forEach(function(e){ x.entry.values[e.name] = e.defaultValue; });
        } },
      // L'avertissement ne vit QUE quand il y a quelque chose à signaler : une ligne « ✓ ok »
      // permanente ne se lit plus au bout de trois composants.
      { ids: ['f-script-missing-' + c.uid], label: '', type: 'info',
        visible: function(x){ return !!(x.entry.scriptId && !x.asset); },
        get: function(){ return '⚠ script introuvable — cet asset a été supprimé'; } },
      { type: 'action', ids: ['btn-script-edit-' + c.uid], label: '✎ Éditer…',
        enabled: function(x){ return !!x.asset; },
        run: function(x){ openEditorScript(x.node, x.node.userData.scripts.indexOf(x.entry)); } }
    ].concat((c.exposures || []).map(function(e){
      return {
        ids: ['f-comp-values-' + e.name], label: e.name,
        // Le vocabulaire des `@expose` (`boolean`, `number`, `color`, `text`) n'est pas celui du
        // socle : on traduit ICI, une fois, au lieu de laisser chaque champ le deviner.
        type: (e.type === 'boolean') ? 'checkbox'
            : (e.type === 'number') ? 'number'
            : (e.type === 'color') ? 'color' : 'text',
        get: function(x){ return x.values[e.name]; },
        set: function(x, v){ x.values[e.name] = v; }
      };
    }))}];
  }
});

// ---------------------------------------------------------------------------
// UIDocument — un document d'interface et sa feuille de style, tous deux des ASSETS. Le bouton
// change de libellé selon qu'il y a quelque chose à éditer ou tout à créer : « Éditer » sur du
// vide ouvrirait un éditeur sans rien dedans, sans dire qu'on vient d'en créer un.

declareComponentPanel('UIDocument', {
  id: 'component-uidocument',
  sections: [{ id: 'uidoc', title: '', fields: [
    { ids: ['f-uidoc-doc'], label: 'Document UI', type: 'choice',
      options: function(){
        return [['', '— aucun (créer) —']].concat(
          assets.filter(function(a){ return a.kind === 'documentUI'; })
                .map(function(a){ return [a.id, a.name]; }));
      },
      get: function(c){ return c.data.documentUIId || ''; },
      set: function(c, v){
        const asset = v ? assets.find(function(a){ return a.id === v && a.kind === 'documentUI'; }) : null;
        c.data.documentUIId = asset ? asset.id : null;
      } },
    { ids: ['f-uidoc-sheet'], label: 'Feuille de style', type: 'choice',
      options: function(){
        return [['', '— aucune (créer) —']].concat(
          assets.filter(function(a){ return a.kind === 'sheetStyle'; })
                .map(function(a){ return [a.id, a.name]; }));
      },
      // Une seule feuille en interface, même si la donnée en accepte plusieurs : c'est ce que
      // faisait l'ancienne vue, et exposer un tableau ici demanderait un type de champ qui
      // n'existe pas encore.
      get: function(c){ return c.data.sheetStyleIds[0] || ''; },
      set: function(c, v){
        const asset = v ? assets.find(function(a){ return a.id === v && a.kind === 'sheetStyle'; }) : null;
        c.data.sheetStyleIds = asset ? [asset.id] : [];
      } },
    { type: 'action', ids: ['btn-uidoc-edit'],
      label: '✎ Éditer…',
      visible: function(c){ return !!(c.documentUI || c.feuillesStyle[0]); },
      run: function(c){ editUIDocument(c); } },
    { type: 'action', ids: ['btn-uidoc-create'],
      label: '＋ Créer et éditer…',
      visible: function(c){ return !(c.documentUI || c.feuillesStyle[0]); },
      run: function(c){ editUIDocument(c); } }
  ]}]
});

/**
 * Ouvre l'éditeur HTML/CSS sur ce composant, et CRÉE les assets manquants à l'enregistrement.
 *
 * Les créer à l'ouverture laisserait deux assets vides derrière soi dès qu'on referme sans rien
 * écrire — c'est le panneau Projet qui se remplirait de documents fantômes.
 */
export function editUIDocument(c){
  let doc = c.documentUI;
  let sheet = c.feuillesStyle[0] || null;
  openEditorExternal('html-css', {html: doc ? doc.html : '', css: sheet ? sheet.css : ''},
    function(maj){
      if(!doc){
        doc = createAssetDocumentUI(c.node.name);
        c.data.documentUIId = doc.id;
      }
      doc.html = maj.html;
      if(!sheet){
        sheet = createAssetSheetStyle(c.node.name);
        c.data.sheetStyleIds = [sheet.id];
      }
      sheet.css = maj.css;
      updateProject();
      if(c.node === selection) buildInspector();
    });
}

// ---------------------------------------------------------------------------
// AudioSource — un son du projet, son volume, sa spatialisation.
//
// LE SON SE CHOISIT DANS UNE LISTE, jamais au clavier : un identifiant tapé à la main ne
// désigne rien, et le seul symptôme serait un silence — qu'on mettrait sur le compte du
// navigateur.

declareComponentPanel('AudioSource', {
  id: 'component-audiosource',
  sections: [{ id: 'audio', title: '', fields: [
    { ids: ['f-ausrc'], label: 'Son', type: 'choice',
      options: function(){
        const sounds = (typeof assets !== 'undefined')
          ? assets.filter(isPlayableAudio) : [];
        return [['', '— aucun —']].concat(sounds.map(function(a){ return [a.id, a.name]; }));
      },
      get: function(c){ return c.data.asset || ''; },
      set: function(c, v){
        c.data.asset = v || null;
        // Mêmes défauts par genre qu'au glisser-déposer : une boucle choisie ici devient une
        // musique de fond, un bruitage qui la remplace redevient un son ponctuel.
        const a = (v && typeof assets !== 'undefined') ? assets.find(function(x){ return x.id === v; }) : null;
        if(a) applyKindDefaultsAudio(a, c.data);
      } },
    // Un asset disparu ne lève rien : la source reste, et elle est muette.
    { type: 'note',
      when: function(c){
        const a = c.data.asset;
        if(!a || typeof assets === 'undefined') return false;
        return !assets.some(function(x){ return x.id === a; });
      },
      text: 'L\'asset audio de cette source est manquant : le son ne jouera pas. Réimportez-le, '
          + 'ou choisissez-en un autre.' },
    // Le BUS décide quel curseur du mixage règle ce son (Paramètres du projet → Mixage audio).
    { ids: ['f-aubus'], label: 'Bus', type: 'choice',
      help: 'Musique ou effets sonores : chaque groupe a son volume dans les paramètres du projet, '
          + 'et un script peut le changer en cours de partie (api.audioBus).',
      options: [['sfx', 'Effets sonores'], ['music', 'Musique']],
      get: function(c){ return busOfSource(c.data); },
      set: function(c, v){ c.data.bus = busOfSource({bus: v}); } },
    { ids: ['f-auvol'], label: 'Volume', type: 'number', step: 0.05, min: 0, max: 2,
      get: function(c){ return c.data.volume !== undefined ? c.data.volume : 1; },
      set: function(c, v){ c.data.volume = Math.max(0, Math.min(2, v || 0)); } },
    { ids: ['f-aupitch'], label: 'Vitesse', type: 'number', step: 0.05, min: 0.25, max: 4,
      get: function(c){ return c.data.pitch || 1; },
      set: function(c, v){ c.data.pitch = Math.max(0.25, Math.min(4, v || 1)); } },
    { ids: ['f-auloop'], label: 'Boucle', type: 'checkbox',
      get: function(c){ return !!c.data.loop; },
      set: function(c, v){ c.data.loop = !!v; } },
    { ids: ['f-auauto'], label: 'Au lancement', type: 'checkbox',
      help: 'Joue automatiquement au démarrage du jeu',
      get: function(c){ return c.data.auto !== false; },
      set: function(c, v){ c.data.auto = !!v; } },
    { ids: ['f-auspatial'], label: '3D (spatial)', type: 'checkbox',
      help: 'Le volume dépend de la distance à la caméra',
      get: function(c){ return c.data.spatial !== false; },
      set: function(c, v){ c.data.spatial = !!v; } },
    { ids: ['f-auportee'], label: 'Portée', type: 'number', step: 0.5, min: 0.5, max: 100,
      get: function(c){ return c.data.range || 10; },
      set: function(c, v){ c.data.range = Math.max(0.5, v || 10); } },
    { ids: ['f-audmax'], label: 'Distance max', type: 'number', step: 1, min: 1, max: 2000,
      visible: function(c){ return c.data.spatial !== false; },
      get: function(c){ return c.data.distanceMax || 100; },
      set: function(c, v){ c.data.distanceMax = Math.max(1, v || 100); } },
    { ids: ['f-aupente'], label: 'Pente', type: 'number', step: 0.1, min: 0, max: 10,
      visible: function(c){ return c.data.spatial !== false; },
      get: function(c){ return c.data.rolloff === undefined ? 1 : c.data.rolloff; },
      set: function(c, v){ c.data.rolloff = Math.max(0, v || 0); } },
    { ids: ['f-aumodele'], label: 'Atténuation', type: 'choice',
      visible: function(c){ return c.data.spatial !== false; },
      options: [['inverse', 'inverse — ne se tait jamais'],
                ['lineaire', 'linéaire — silence à la distance max'],
                ['exponentiel', 'exponentielle — chute rapide']],
      get: function(c){ return c.data.model || 'inverse'; },
      set: function(c, v){ c.data.model = v; } },
    // Le nom du champ PROMET la mauvaise chose, et le dire vaut mieux que de le renommer en
    // silence : « portée » suggère une limite au-delà de laquelle on n'entend plus rien. C'est
    // en réalité la distance de RÉFÉRENCE du modèle d'atténuation.
    { type: 'note',
      when: function(c){ return c.data.spatial !== false; },
      text: 'La portée est la distance à laquelle le son garde son volume plein ; la distance '
          + 'max est celle où il s\'éteint — mais seul le modèle linéaire l\'éteint vraiment.' },
    // Le message est CALCULÉ, pas écrit : il donne le gain réel à dix fois la portée, ce qui
    // rend la différence entre les modèles mesurable au lieu d'être une affaire de mots.
    { type: 'note',
      when: function(c){ return c.data.spatial !== false && audioFalloffIssues(c).length > 0; },
      text: function(c){ return audioFalloffIssues(c).join(' · '); } },
    { type: 'action', ids: ['btn-audio-test'], label: '▶ Écouter',
      run: function(){ testAudioSelection(); } }
  ]}]
});

/** Ce que le modèle d'atténuation choisi fait vraiment, quand le validateur est chargé. */
export function audioFalloffIssues(c){
  return (typeof validateFalloffAudio === 'function') ? (validateFalloffAudio(c.data) || []) : [];
}

// ---------------------------------------------------------------------------
// Terrain — la grille, la sculpture, le relief, et les couleurs par altitude.
//
// DEUX DONNÉES DIFFÉRENTES DANS LE MÊME PANNEAU, comme pour le panneau Rendu : les couleurs et
// les seuils appartiennent au terrain (`c.data`, sérialisé avec la scène), tandis que le
// pinceau de sculpture est un OUTIL de l'éditeur (`sculpt`, partagé, non sérialisé). Les champs
// du pinceau ne s'affichent que pendant la sculpture — les montrer en dehors ferait régler un
// outil qu'on n'a pas en main.

declareComponentPanel('Terrain', {
  id: 'component-terrain',
  sections: [
    { id: 'terrain', title: 'Terrain', fields: [
      { ids: ['terr-grid'], label: 'Grille', type: 'info',
        get: function(c){
          const te = c.data;
          const sommets = (te.segments + 1) * (te.segments + 1);
          return te.size + ' m · ' + te.segments + '×' + te.segments + ' (' + sommets + ' sommets)';
        } },
      { type: 'action', ids: ['btn-terr-sculpt'],
        label: '⛏ Sculpter le terrain',
        visible: function(c){ return !sculpting(c); },
        run: function(c){ toggleSculpt(c.node); } },
      { type: 'action', ids: ['btn-terr-sculpt-stop'],
        label: '⛏ Quitter la sculpture',
        visible: function(c){ return sculpting(c); },
        run: function(c){ toggleSculpt(c.node); } },
      { ids: ['f-scmode'], label: 'Pinceau', type: 'choice',
        visible: function(c){ return sculpting(c); },
        options: function(){ return SCULPT_MODES; },
        get: function(){ return sculpt.mode; },
        set: function(_c, v){ sculpt.mode = v; } },
      { ids: ['f-sc-radius'], label: 'Rayon m', type: 'number', step: 0.5, min: 0.5, max: 40,
        visible: function(c){ return sculpting(c); },
        get: function(){ return sculpt.radius; },
        set: function(_c, v){ sculpt.radius = Math.max(0.5, Math.min(40, v)); } },
      { ids: ['f-scforce'], label: 'Force', type: 'number', step: 0.05, min: 0.05, max: 3,
        visible: function(c){ return sculpting(c); },
        get: function(){ return sculpt.force; },
        set: function(_c, v){ sculpt.force = Math.max(0.05, Math.min(3, v)); } },
      { type: 'note',
        when: function(c){ return sculpting(c); },
        text: 'Glissez dans la vue · Maj inverse · molette = rayon · Échap pour quitter. '
            + 'Chaque trait est annulable (Ctrl+Z).' }
    ]},

    { id: 'relief', title: 'Relief', fields: [
      // Amplitude et échelle ne sont PAS des réglages du terrain : ce sont les paramètres du
      // prochain tirage. Ils vivent donc sur le composant, pas dans sa donnée sérialisée.
      { ids: ['f-tramp'], label: 'Amplitude', type: 'number', step: 0.5, min: 0.5, max: 60,
        get: function(c){ return c.reliefAmplitude === undefined ? 6 : c.reliefAmplitude; },
        set: function(c, v){ c.reliefAmplitude = v; } },
      { ids: ['f-trech'], label: 'Échelle des formes', type: 'number', step: 1, min: 2, max: 40,
        get: function(c){ return c.reliefScale === undefined ? 8 : c.reliefScale; },
        set: function(c, v){ c.reliefScale = v; } },
      { type: 'action', ids: ['btn-terr-generate'], label: '🎲 Générer un relief',
        run: function(c){
          pushHistory();
          generateTerrain(c.node, c.reliefAmplitude || 6, c.reliefScale || 8,
                          Math.floor(Math.random() * 100000));
          setStatus('Relief généré — 🎲 pour un autre tirage, ⛏ pour retoucher', 3000);
        } },
      { type: 'action', ids: ['btn-terr-flat'], label: '▭ Tout aplanir',
        run: function(c){
          pushHistory();
          flattenTerrain(c.node);
          setStatus('Terrain aplani', 2000);
        } }
    ]},

    { id: 'terrain-colors', title: 'Couleurs par altitude', fields: [
      { ids: ['f-trbottom'], label: 'Bas (herbe)', type: 'color',
        get: function(c){ return c.data.colorBottom; },
        set: function(c, v){ c.data.colorBottom = v; applyHeightsTerrain(c.node); } },
      { ids: ['f-trtop'], label: 'Haut (roche)', type: 'color',
        get: function(c){ return c.data.colorTop; },
        set: function(c, v){ c.data.colorTop = v; applyHeightsTerrain(c.node); } },
      { ids: ['f-trsnow'], label: 'Sommet (neige)', type: 'color',
        get: function(c){ return c.data.colorNeige; },
        set: function(c, v){ c.data.colorNeige = v; applyHeightsTerrain(c.node); } },
      { ids: ['f-trsr'], label: 'Seuil roche', type: 'number', step: 0.05, min: 0, max: 1,
        get: function(c){ return c.data.thresholdRoche; },
        set: function(c, v){
          c.data.thresholdRoche = Math.max(0, Math.min(1, v));
          applyHeightsTerrain(c.node);
        } },
      { ids: ['f-trsn'], label: 'Seuil neige', type: 'number', step: 0.05, min: 0, max: 1,
        get: function(c){ return c.data.thresholdNeige; },
        set: function(c, v){
          c.data.thresholdNeige = Math.max(0, Math.min(1, v));
          applyHeightsTerrain(c.node);
        } },
      { ids: ['f-trslope'], label: 'Roche sur pentes', type: 'checkbox',
        help: 'Les fortes pentes prennent la couleur de roche',
        get: function(c){ return c.data.rolloff !== false; },
        set: function(c, v){ c.data.rolloff = !!v; applyHeightsTerrain(c.node); } }
    ]}
  ]
});

/** Ce terrain-ci est-il celui qu'on sculpte en ce moment ? */
export function sculpting(c){
  return sculpt.active && sculpt.target === c.node;
}

// ---------------------------------------------------------------------------
// SpriteRenderer — l'image affichée, son calque, son ordre.
//
// LE CHAMP « ORDRE » DISPARAÎT quand le tri par profondeur décide : le laisser visible ferait
// régler un champ sans effet, puis chercher pourquoi il ne fait rien.

/** Le sprite de ce composant, ou `null`. */
export function spriteAssetOf(c){
  if(typeof assets === 'undefined') return null;
  return assets.find(function(a){ return a.kind === 'sprite' && a.id === c.data.spriteId; }) || null;
}
/** Ce qui cloche dans ce sprite — un sprite mal réglé n'a rien d'une erreur, il s'affiche
 *  simplement autrement que prévu. */
export function spriteIssues(c){
  const asset = spriteAssetOf(c);
  if(!asset || typeof validateSprite !== 'function') return [];
  const textures = (typeof assets !== 'undefined')
    ? assets.filter(function(a){ return a.kind === 'texture'; }).map(function(a){ return a.id; })
    : null;
  return validateSprite(asset, textures) || [];
}

declareComponentPanel('SpriteRenderer', {
  id: 'component-spriterenderer',
  sections: [{ id: 'sp', title: '', fields: [
    { ids: ['f-sp-asset'], label: 'Sprite', type: 'choice',
      options: function(){
        const sprites = (typeof assets !== 'undefined')
          ? assets.filter(function(a){ return a.kind === 'sprite'; }) : [];
        return [['', '— aucun —']].concat(sprites.map(function(a){ return [a.id, a.name]; }));
      },
      get: function(c){ return c.data.spriteId || ''; },
      set: function(c, v){
        c.data.spriteId = v || null;
        // L'ancienne région n'existe pas dans le nouveau sprite : la garder afficherait une
        // image au hasard, ou rien.
        c.data.region = '';
        rebuildMeshSprite(c.node);
      } },
    { type: 'note',
      when: function(c){ return !spriteAssetOf(c); },
      text: 'Créez un sprite dans le panneau Projet : sélectionnez une texture, puis '
          + '« 🖼 Nouveau sprite ».' },
    { type: 'note',
      when: function(c){ return spriteIssues(c).length > 0; },
      text: function(c){
        const s = spriteIssues(c);
        return s.length + ' problème(s) : ' + s.join(' · ');
      } },
    // Une planche à une seule image n'a pas de choix à offrir.
    { ids: ['f-sp-region'], label: 'Image', type: 'choice',
      visible: function(c){ const a = spriteAssetOf(c); return !!a && (a.regions || []).length > 1; },
      options: function(c){
        const a = spriteAssetOf(c);
        return ((a && a.regions) || []).map(function(r){ return [r.name, r.name]; });
      },
      get: function(c){ return c.data.region || ''; },
      set: function(c, v){ c.data.region = v; rebuildMeshSprite(c.node); } },
    { ids: ['f-sp-layer'], label: 'Calque', type: 'choice',
      visible: function(c){ return !!spriteAssetOf(c); },
      options: function(){ return layers2dOfProject().map(function(x){ return [x, x]; }); },
      get: function(c){ return c.data.layer || 'Jeu'; },
      set: function(c, v){
        c.data.layer = v;
        // `_dirtyOrder` : c'est le SpriteSystem qui repose l'ordre de rendu, à l'image suivante.
        // Le recalculer ici en plus de là-bas, ce serait deux endroits pour une même règle.
        c._dirtyOrder = true;
        rebuildMeshSprite(c.node);
      } },
    { ids: ['f-sp-depthsort'], label: 'Trier par profondeur', type: 'checkbox',
      visible: function(c){ return !!spriteAssetOf(c); },
      help: 'Vue de dessus : ce qui est plus bas passe devant. À cocher sur les personnages et '
          + 'les décors qu\'on doit pouvoir contourner.',
      get: function(c){ return !!c.data.sortDepth; },
      set: function(c, v){
        c.data.sortDepth = !!v;
        // Rebâtir la maille : sinon l'ordre posé à la construction reste celui d'avant jusqu'à
        // la première image — un clignotement à chaque coche.
        rebuildMeshSprite(c.node);
      } },
    { type: 'note',
      when: function(c){ return !!spriteAssetOf(c) && !!c.data.sortDepth; },
      text: 'L\'ordre est calculé sur le BAS de la silhouette — les pieds, pas le centre. Le '
          + 'Collider2D fait foi s\'il y en a un. Attention : le tri ne joue QU\'À L\'INTÉRIEUR '
          + 'du calque (comme les Sorting Layers d\'Unity) — deux sprites de calques différents '
          + 'restent dans l\'ordre des calques, quelle que soit leur hauteur à l\'écran. Mettre '
          + 'le personnage et les décors à contourner sur le MÊME calque.' },
    { ids: ['f-sp-ordre'], label: 'Ordre', type: 'number', step: 1, min: -499, max: 499,
      visible: function(c){ return !!spriteAssetOf(c) && !c.data.sortDepth; },
      get: function(c){ return c.data.order === undefined ? 0 : c.data.order; },
      set: function(c, v){
        c.data.order = Math.max(-499, Math.min(499, Math.round(v) || 0));
        c._dirtyOrder = true;
        rebuildMeshSprite(c.node);
      } },
    { ids: ['f-sp-teinte'], label: 'Teinte', type: 'color',
      visible: function(c){ return !!spriteAssetOf(c); },
      get: function(c){ return c.data.teinte || '#ffffff'; },
      set: function(c, v){ c.data.teinte = v; rebuildMeshSprite(c.node); } },
    { ids: ['f-sp-flipx'], label: 'Retourner X', type: 'checkbox',
      visible: function(c){ return !!spriteAssetOf(c); },
      help: 'Inverse les coordonnées de texture, pas l\'échelle du nœud : une échelle négative '
          + 'casse les normales et se propage aux enfants.',
      get: function(c){ return !!c.data.retourneX; },
      set: function(c, v){ c.data.retourneX = !!v; rebuildMeshSprite(c.node); } },
    { ids: ['f-sp-flipy'], label: 'Retourner Y', type: 'checkbox',
      visible: function(c){ return !!spriteAssetOf(c); },
      get: function(c){ return !!c.data.retourneY; },
      set: function(c, v){ c.data.retourneY = !!v; rebuildMeshSprite(c.node); } },
    { type: 'note',
      when: function(c){ return !!spriteAssetOf(c); },
      text: function(c){
        return spriteAssetOf(c).ppu + ' pixels par unité — réglé sur le sprite, dans le '
             + 'panneau Projet.';
      } }
  ]}]
});

// ---------------------------------------------------------------------------
// Particles — la forme d'émission décide des champs affichés : une boîte a une taille, un cône
// un rayon et un angle, un point n'a ni l'un ni l'autre. Le mode fait de même : un tir en
// rafale a une quantité, un flux continu a un débit.

/** Un champ de particules : même `get`/`set` sur `c.data`, seule la borne change. */
export function particleField(id, label, key, opts){
  const o = opts || {};
  return {
    ids: [id], label: label, type: o.type || 'number',
    step: o.step, min: o.min, max: o.max, help: o.help, visible: o.visible,
    get: function(c){ return c.data[key]; },
    set: function(c, v){
      c.data[key] = o.clamp ? o.clamp(v) : v;
      if(o.reset) resetSystemParticles(c.node);
    }
  };
}

declareComponentPanel('Particles', {
  id: 'component-particles',
  sections: [{ id: 'part', title: 'Particules', fields: [
    { ids: ['f-pashape'], label: 'Forme', type: 'choice',
      options: [['cone', 'Cône (directionnel)'], ['point', 'Point (explosion)'],
                ['box', 'Boîte (vers le haut)'], ['sphere', 'Sphère (radial)']],
      get: function(c){ return c.data.shape; },
      set: function(c, v){ c.data.shape = v; } },
    { ids: ['f-padx', 'f-pady', 'f-padz'], label: 'Taille zone', type: 'vec3', step: 0.1,
      visible: function(c){ return c.data.shape === 'box'; },
      get: function(c){ return c.data.dims.slice(); },
      set: function(c, v){ c.data.dims = v.map(function(x){ return Math.max(0.01, x); }); } },
    particleField('f-parayon', 'Rayon', 'radius', {step: 0.1, min: 0, max: 20,
      visible: function(c){ return c.data.shape === 'sphere' || c.data.shape === 'cone'; },
      clamp: function(v){ return Math.max(0, v); }}),
    particleField('f-paangle', 'Angle °', 'angle', {step: 1, min: 0, max: 89,
      visible: function(c){ return c.data.shape === 'cone'; },
      clamp: function(v){ return Math.max(0, Math.min(89, v)); }}),
    { ids: ['f-pamode'], label: 'Mode', type: 'choice',
      options: [['continu', 'Continu'], ['burst', 'Burst (rafale)']],
      get: function(c){ return c.data.mode; },
      set: function(c, v){ c.data.mode = v; } },
    particleField('f-paquantite', 'Quantité', 'amount', {step: 1, min: 1, max: 2000,
      visible: function(c){ return c.data.mode === 'burst'; },
      clamp: function(v){ return Math.max(1, Math.round(v)); }}),
    particleField('f-pataux', 'Débit /s', 'rate', {step: 1, min: 0, max: 500,
      visible: function(c){ return c.data.mode !== 'burst'; },
      clamp: function(v){ return Math.max(0, v); }}),
    particleField('f-pavie', 'Durée de vie s', 'vie', {step: 0.1, min: 0.05, max: 20,
      clamp: function(v){ return Math.max(0.05, v); }}),
    particleField('f-pavitesse', 'Vitesse', 'speed', {step: 0.1, min: 0, max: 50,
      clamp: function(v){ return Math.max(0, v); }}),
    // La gravité est librement NÉGATIVE : c'est ainsi qu'une fumée monte.
    particleField('f-pagravite', 'Gravité', 'gravity', {step: 0.1, min: -30, max: 30}),
    particleField('f-pataille1', 'Taille début', 'sizeStart', {step: 0.05, min: 0.01, max: 5,
      clamp: function(v){ return Math.max(0.01, v); }}),
    particleField('f-pataille2', 'Taille fin', 'sizeEnd', {step: 0.05, min: 0, max: 5,
      clamp: function(v){ return Math.max(0, v); }}),
    particleField('f-paopa1', 'Opacité début', 'opacityStart', {step: 0.05, min: 0, max: 1,
      clamp: function(v){ return Math.max(0, Math.min(1, v)); }}),
    particleField('f-paopa2', 'Opacité fin', 'opacityEnd', {step: 0.05, min: 0, max: 1,
      clamp: function(v){ return Math.max(0, Math.min(1, v)); }}),
    particleField('f-pacolor1', 'Couleur début', 'colorStart', {type: 'color'}),
    particleField('f-pacolor2', 'Couleur fin', 'colorEnd', {type: 'color'}),
    // Additif et Max reconstruisent le système : le nombre de particules fixe la taille des
    // tampons, et le mélange est posé sur le matériau à la construction.
    { ids: ['f-paadditive'], label: 'Additif', type: 'checkbox',
      help: 'Mélange additif (lueurs, feu). Décoché : mélange normal (fumée)',
      get: function(c){ return c.data.additif !== false; },
      set: function(c, v){ c.data.additif = !!v; resetSystemParticles(c.node); } },
    particleField('f-pamax', 'Max particules', 'max', {step: 10, min: 10, max: 5000, reset: true,
      clamp: function(v){ return Math.max(10, Math.min(5000, Math.round(v))); }}),
    { type: 'action', ids: ['btn-part-emit'], label: '✨ Émettre maintenant',
      run: function(c){ emitBurst(c.node); } }
  ]}]
});

// ---------------------------------------------------------------------------
// Camera — perspective ou orthographique, et tout ce que la seconde entraîne.
//
// LES CHAMPS SUIVENT LA PROJECTION : un FOV sur une caméra orthographique ne veut rien dire, et
// les réglages de pixel perfect n'existent que là. C'est le `visible` de chaque champ qui le
// dit, et non une reconstruction de tout l'inspecteur.

/**
 * Les sprites UTILISÉS par la scène (sprites posés, planches des palettes de tuiles) dont le ppu
 * diffère de celui de la caméra. Seulement ceux-là : une planche importée mais jamais posée ne
 * s'affiche pas, et la signaler noierait l'avertissement utile.
 */
export function cameraSpritesOffPpu(c){
  if(typeof spritesOffPpu !== 'function' || typeof assets === 'undefined') return [];
  const ids = new Set();
  objects.forEach(function(o){
    const d = o.userData && o.userData.sprite2d;
    if(d && d.spriteId) ids.add(d.spriteId);
    const t = o.getComponent && o.getComponent('Tilemap');
    const tiles = (t && typeof t.tileDefs === 'function') ? t.tileDefs() : null;
    (tiles || []).forEach(function(tile){ if(tile && tile.spriteId) ids.add(tile.spriteId); });
  });
  return spritesOffPpu(c.ppu, assets.filter(function(a){ return a.kind === 'sprite' && ids.has(a.id); }));
}

declareComponentPanel('Camera', {
  id: 'component-camera',
  sections: [
    { id: 'cam', title: 'Caméra', fields: [
      { ids: ['f-cam-projection'], label: 'Projection', type: 'choice',
        options: [['perspective', 'Perspective'], ['orthographic', 'Orthographique']],
        get: function(c){ return c.projection; },
        set: function(c, v){ c.projection = v; c.applyProjection(); } },
      { ids: ['f-fov'], label: 'FOV °', type: 'number', step: 1, min: 15, max: 110,
        visible: function(c){ return c.projection === 'perspective'; },
        get: function(c){ return c.fov; },
        set: function(c, v){
          c.fov = v;
          if(c.objectThree){
            c.objectThree.fov = v;
            c.objectThree.updateProjectionMatrix();
          }
        } },
      { ids: ['f-cam-pixelperfect'], label: 'Pixel perfect', type: 'checkbox',
        visible: function(c){ return c.projection !== 'perspective'; },
        help: 'Fixe le rapport pixel à un entier. Un rapport non entier est LA cause unique du '
            + 'flou en 2D — et rien dans le reste de l éditeur ne le dit.',
        get: function(c){ return !!c.pixelPerfect; },
        set: function(c, v){ c.pixelPerfect = !!v; c.applyProjection(); } },
      { ids: ['f-cam-ppu'], label: 'Pixels par unité', type: 'number', step: 1, min: 1, max: 512,
        visible: function(c){ return c.projection !== 'perspective' && c.pixelPerfect; },
        get: function(c){ return c.ppu; },
        set: function(c, v){ c.ppu = Math.max(1, v || 100); c.applyProjection(); } },
      // Le défaut qui ne se voit qu'en jouant : un sprite à un autre ppu que la caméra couvre un
      // nombre FRACTIONNAIRE de pixels d'écran, et le pixel perfect ne sert plus à rien.
      { type: 'note',
        when: function(c){ return c.projection !== 'perspective' && c.pixelPerfect
                                  && cameraSpritesOffPpu(c).length > 0; },
        text: function(c){
          const off = cameraSpritesOffPpu(c);
          return off.length + ' sprite(s) n\'ont pas ' + c.ppu + ' pixels par unité ('
            + off.slice(0, 3).map(function(s){ return '« ' + s.name + ' » : ' + s.ppu; }).join(', ')
            + (off.length > 3 ? '…' : '') + ') : ils ne seront pas nets. Alignez leur réglage '
            + 'd\'import sur la caméra, ou la caméra sur eux.';
        } },
      { ids: ['f-cam-mode'], label: 'Cadrage', type: 'choice',
        visible: function(c){ return c.projection !== 'perspective' && c.pixelPerfect; },
        options: [['height', 'Le plus net possible'], ['width', 'Sur la largeur du niveau'],
                  ['fixed', 'Rapport imposé']],
        get: function(c){ return c.mode; },
        set: function(c, v){ c.mode = v; c.applyProjection(); } },
      { ids: ['f-cam-ratio'], label: 'Rapport pixel', type: 'number', step: 1, min: 1, max: 16,
        visible: function(c){
          return c.projection !== 'perspective' && c.pixelPerfect && c.mode === 'fixed';
        },
        get: function(c){ return c.ratio; },
        set: function(c, v){ c.ratio = Math.max(1, Math.round(v || 1)); c.applyProjection(); } },
      { ids: ['f-cam-widthlevel'], label: 'Largeur du niveau', type: 'number', step: 1, min: 1,
        visible: function(c){
          return c.projection !== 'perspective' && c.pixelPerfect && c.mode === 'width';
        },
        get: function(c){ return c.widthLevel; },
        set: function(c, v){ c.widthLevel = Math.max(0, v || 0); c.applyProjection(); } },
      // LE RENDU DU RÉGLAGE, EN CLAIR. C'est une MESURE, pas un libellé : le seul endroit qui
      // dise pourquoi un jeu 2D est flou (un rapport pixel non entier), et rien d'autre ne le dit.
      { ids: ['cam-render'], label: 'Rendu', type: 'info',
        visible: function(c){ return c.projection !== 'perspective' && c.pixelPerfect; },
        get: function(c){
          const w = viewEl ? viewEl.clientWidth : 1920;
          const h = viewEl ? viewEl.clientHeight : 1080;
          const f = framing2d(w, h, c.ppu, c.mode, c.widthLevel, c.ratio);
          return 'Rapport pixel ×' + f.ratio + ' — ' + Math.round(f.heightView * c.ppu)
               + ' pixels de dessin sur ' + h + ' pixels écran.';
        } },
      { ids: ['f-cam-orthosize'], label: 'Taille de vue', type: 'number', step: 0.1, min: 0.1,
        visible: function(c){ return c.projection !== 'perspective' && !c.pixelPerfect; },
        get: function(c){ return c.orthoSize; },
        set: function(c, v){ c.orthoSize = Math.max(0.1, v || 5); c.applyProjection(); } },
      { ids: ['f-cam-near'], label: 'Près', type: 'number', step: 0.01, min: 0.001,
        get: function(c){ return c.near; },
        set: function(c, v){ c.near = v; c.applyProjection(); } },
      { ids: ['f-cam-far'], label: 'Loin', type: 'number', step: 1, min: 1,
        get: function(c){ return c.far; },
        set: function(c, v){ c.far = v; c.applyProjection(); } },
      { type: 'action', ids: ['btn-view'], label: 'Voir à travers cette caméra',
        visible: function(c){ return activeCam !== c.objectThree; },
        run: function(c){ lookThroughCamera(c); } },
      { type: 'action', ids: ['btn-view-quit'], label: 'Revenir à la vue éditeur',
        visible: function(c){ return activeCam === c.objectThree; },
        run: function(){ quitViewCamera(); } },
      { ids: ['f-cam-main'], label: 'Caméra principale', type: 'checkbox',
        // LE DRAPEAU VIT SUR LE COMPOSANT, pas sur `userData.game`. Cette case écrivait
        // `ensureGame(o).main`, que le runtime était seul à lire, pendant que le composant
        // `Camera` portait son propre `main` — celui que le fichier de scène transporte. Cocher
        // la case ne changeait donc rien au fichier, et le jeu repartait sur la première caméra
        // venue. Les deux sens passent maintenant par camera-framing.js, seul juge.
        // Par les GLOBALES, pas par un `import` : `js/camera-framing.js` fait partie des modules
        // que le build sait retirer d'un jeu publié (js/build-trimming.js), et un import statique
        // depuis un panneau d'inspecteur le rendrait indéracinable — c'est la règle que tient
        // « AUCUN import ne pointe vers un module que le build sait retirer ».
        // Le garde `typeof` va avec la globale : sur une page qui ne charge pas
        // camera-framing.js, le champ doit rester inerte plutôt que de faire tomber tout
        // l'inspecteur sur un ReferenceError — c'est la convention de ce fichier.
        get: function(c){
          // `isCameraMain` quand le nœud sait rendre ses composants (il peut alors répondre pour
          // un projet d'avant, dont le drapeau vit encore sur `userData.game`) ; sinon
          // l'accesseur du composant, qui est la source.
          return (typeof isCameraMain === 'function' && c.node && c.node.getComponent)
            ? isCameraMain(c.node) : !!c.main;
        },
        set: function(c, v){
          const o = c.node;
          // UNE SEULE caméra principale : cocher celle-ci décoche les autres. Deux principales
          // laisseraient le jeu choisir, et il choisirait la première rencontrée.
          const cams = Registry.activeNodes('Camera');
          if(v && typeof setCameraMain === 'function') setCameraMain(o, cams);
          else {
            c.main = !!v;
            if(o.userData && o.userData.game) delete o.userData.game.main;
          }
          setStatus(v ? o.name + ' est maintenant la caméra principale'
                      : 'Caméra principale retirée', 2000);
        } }
    ]},

    { id: 'cam-layers', title: 'Layers visibles par cette caméra', fields: [
      { type: 'list', id: 'cam-layers-list',
        items: function(){ return project.layers; },
        fields: function(layer, i, c){
          return [{
            ids: ['f-cam-layer-' + layer.id], label: layer.name, type: 'checkbox',
            // Un masque VIDE ou absent veut dire « tout est visible » : c'est l'état par défaut,
            // et l'écrire en dur listerait des calques qui n'existent pas encore.
            get: function(){
              const mask = c.node.userData.game && c.node.userData.game.camMask;
              return !mask || !mask.length || mask.indexOf(layer.id) !== -1;
            },
            set: function(_row, v){ setCameraLayer(c, layer.id, !!v); }
          }];
        } }
    ]},

    // INCRUSTATION (js/camera-overlays.js) : une mini-carte, un rétroviseur. Rectangle normalisé,
    // origine en bas à gauche comme Unity ; rendu par-dessus l'image de la caméra principale.
    { id: 'cam-overlay', title: 'Incrustation à l\'écran', fields: [
      { ids: ['f-cam-ovl-on'], label: 'Incrustée', type: 'checkbox',
        help: 'Rend cette caméra dans un rectangle par-dessus l image principale : mini-carte, rétroviseur.',
        get: function(c){ return !!(c.data && c.data.viewport); },
        set: function(c, v){ c.data.viewport = v ? {x: 0.76, y: 0.02, w: 0.22, h: 0.3} : null; } },
      { ids: ['f-cam-ovl-x'], label: 'X (depuis la gauche)', type: 'number', step: 0.01, min: 0, max: 1,
        visible: function(c){ return !!(c.data && c.data.viewport); },
        get: function(c){ return (c.data && c.data.viewport) ? c.data.viewport.x : 0; },
        set: function(c, v){ if(c.data && c.data.viewport) c.data.viewport = normalizeViewport(Object.assign({}, c.data.viewport, {x: v})) || c.data.viewport; } },
      { ids: ['f-cam-ovl-y'], label: 'Y (depuis le bas)', type: 'number', step: 0.01, min: 0, max: 1,
        visible: function(c){ return !!(c.data && c.data.viewport); },
        get: function(c){ return (c.data && c.data.viewport) ? c.data.viewport.y : 0; },
        set: function(c, v){ if(c.data && c.data.viewport) c.data.viewport = normalizeViewport(Object.assign({}, c.data.viewport, {y: v})) || c.data.viewport; } },
      { ids: ['f-cam-ovl-w'], label: 'Largeur', type: 'number', step: 0.01, min: 0, max: 1,
        visible: function(c){ return !!(c.data && c.data.viewport); },
        get: function(c){ return (c.data && c.data.viewport) ? c.data.viewport.w : 0; },
        set: function(c, v){ if(c.data && c.data.viewport) c.data.viewport = normalizeViewport(Object.assign({}, c.data.viewport, {w: v})) || c.data.viewport; } },
      { ids: ['f-cam-ovl-h'], label: 'Hauteur', type: 'number', step: 0.01, min: 0, max: 1,
        visible: function(c){ return !!(c.data && c.data.viewport); },
        get: function(c){ return (c.data && c.data.viewport) ? c.data.viewport.h : 0; },
        set: function(c, v){ if(c.data && c.data.viewport) c.data.viewport = normalizeViewport(Object.assign({}, c.data.viewport, {h: v})) || c.data.viewport; } },
    ]}
  ]
});

/** Voir la scène à travers cette caméra. */
export function lookThroughCamera(c){
  const o = c.node;
  setActiveCam(c.objectThree);
  applyMaskCamera(o, activeCam);
  tc.camera = activeCam;
  document.getElementById('banner-cam-name').textContent = o.name;
  document.getElementById('banner-cam').style.display = 'block';
  resize();
  select(o);
}

/**
 * Coche ou décoche un calque pour cette caméra.
 *
 * Le masque n'est écrit QUE s'il retire quelque chose : tout coché supprime la clé, plutôt que
 * de sérialiser la liste complète des calques dans chaque projet — un calque ajouté plus tard
 * serait alors invisible pour toutes les caméras déjà réglées.
 */
export function setCameraLayer(c, layerId, visible){
  const o = c.node;
  const game = ensureGame(o);
  const tous = project.layers.map(function(l){ return l.id; });
  const courant = (game.camMask && game.camMask.length) ? game.camMask.slice() : tous.slice();
  const i = courant.indexOf(layerId);
  if(visible && i === -1) courant.push(layerId);
  if(!visible && i !== -1) courant.splice(i, 1);
  if(courant.length === tous.length) delete game.camMask;
  else game.camMask = courant;
  if(activeCam === c.objectThree) applyMaskCamera(o, activeCam);
  if(previewCam === c.objectThree) applyMaskCamera(o, previewCam);
}

// ---------------------------------------------------------------------------
// Mesh — la forme, le matériau, les ombres.
//
// DEUX ÉTATS DE MATÉRIAU, et c'est le cœur de cette vue : un objet lié à un ASSET matériau
// n'expose pas de champs bruts (ils seraient édités ici et perdus au prochain rechargement de
// l'asset) ; un objet sans asset édite directement son matériau three, comme avant l'existence
// des assets. Les deux jeux de champs ne coexistent JAMAIS.

/** L'asset matériau de cet objet, ou `null`. */
export function meshMaterialAsset(c){ return assetMaterialOf(c.node); }
/** Le matériau three réellement édité quand il n'y a pas d'asset. */
export function meshMaterial(c){ return c.material; }

declareComponentPanel('Mesh', {
  id: 'component-mesh',
  sections: [
    { id: 'shape', title: 'Forme', fields: [
      { ids: ['f-geo'], label: 'Géométrie', type: 'choice',
        options: [['cube', 'Cube'], ['sphere', 'Sphère'], ['cylinder', 'Cylindre'],
                  ['cone', 'Cône'], ['torus', 'Tore'], ['plane', 'Plan'],
                  ['star', 'Étoile'], ['diamond', 'Losange'], ['pyramid', 'Pyramide'],
                  ['wave', 'Vague'], ['rock', 'Rocher'], ['capsule', 'Capsule'],
                  ['custom', 'Personnalisée…']],
        get: function(c){ return c.node.userData.geo || 'cube'; },
        set: function(c, v){ setMeshGeometry(c, v); } },
      { ids: ['f-geo-asset'], label: 'Mesh importé', type: 'choice',
        visible: function(c){ return c.node.userData.geo === 'custom'; },
        options: function(){
          return [['', '— choisir —']].concat(
            assets.filter(function(a){ return a.kind === 'model'; })
                  .map(function(a){ return [a.id, a.name]; }));
        },
        get: function(c){ return c.node.userData.geoAsset || ''; },
        set: function(c, v){
          if(!v) return;
          const asset = assets.find(function(a){ return a.id === v && a.kind === 'model'; });
          if(!asset) return;
          pushHistory();
          applyGeometryAsset(c.node, asset);
        } },
      { type: 'note',
        when: function(c){
          return c.node.userData.geo === 'custom'
            && !assets.some(function(a){ return a.kind === 'model'; });
        },
        text: 'Importez d\'abord un modèle (glTF/FBX) dans le panneau Projet.' }
    ]},

    // ---- Matériau LIÉ à un asset : on ne montre pas de champs, on montre où aller ----
    { id: 'material-asset', title: 'Matériau', fields: [
      { ids: ['mesh-mat-name'], label: 'Asset', type: 'info',
        visible: function(c){ return !!meshMaterialAsset(c); },
        get: function(c){ return meshMaterialAsset(c).name; } },
      { type: 'action', ids: ['btn-mat-edit'], icon: 'pencil-simple', label: 'Éditer le matériau (tous les usages)',
        help: 'Sélectionne l\'asset : ses propriétés s\'affichent ici',
        visible: function(c){ return !!meshMaterialAsset(c); },
        run: function(c){ selectAsset(meshMaterialAsset(c)); } },
      { type: 'action', ids: ['btn-mat-edit-shader'], icon: 'tree-structure', label: 'Éditer le shader',
        help: 'Ouvre le graphe de shader dans une fenêtre séparée',
        visible: function(c){
          const a = meshMaterialAsset(c);
          return !!(a && a.shaderId);
        },
        run: function(c){
          const a = meshMaterialAsset(c);
          const shader = assets.find(function(x){ return x.id === a.shaderId; });
          if(shader) openEditorGraphShader(shader);
          else setStatus('Shader introuvable (asset supprimé ?)', 3000);
        } },
      { type: 'action', ids: ['btn-mat-detach'],
        icon: 'scissors', label: 'Détacher de l\'asset',
        help: 'L\'objet garde son apparence actuelle mais ne suivra plus l\'asset',
        visible: function(c){ return !!meshMaterialAsset(c); },
        run: function(c){
          pushHistory();
          delete c.node.userData.materialId;
          setStatus('Objet détaché de l\'asset matériau (apparence conservée)', 2500);
        } },

      // ---- Matériau BRUT : édité directement, faute d'asset ----
      { ids: ['f-color'], label: 'Couleur', type: 'color',
        visible: function(c){ return !meshMaterialAsset(c); },
        get: function(c){ return '#' + meshMaterial(c).color.getHexString(); },
        set: function(c, v){ meshMaterial(c).color.set(v); } },
      // Lissage = 1 − rugosité, même convention que les assets matériaux : les deux panneaux
      // éditent la MÊME propriété three et doivent la présenter dans le même sens.
      { ids: ['f-smoothing'], label: 'Lissage', type: 'number', step: 0.05, min: 0, max: 1,
        visible: function(c){ return !meshMaterialAsset(c); },
        get: function(c){
          const m = meshMaterial(c);
          return smoothingFromRoughness((m.roughness !== undefined) ? m.roughness : 0.55);
        },
        set: function(c, v){
          const m = meshMaterial(c);
          if(m.roughness === undefined) return;
          m.roughness = roughnessFromSmoothing(Math.max(0, Math.min(1, v)));
        } },
      { ids: ['f-metal'], label: 'Métallique', type: 'number', step: 0.05, min: 0, max: 1,
        visible: function(c){ return !meshMaterialAsset(c); },
        get: function(c){
          const m = meshMaterial(c);
          return (m.metalness !== undefined) ? m.metalness : 0.1;
        },
        set: function(c, v){
          const m = meshMaterial(c);
          if(m.metalness !== undefined) m.metalness = Math.max(0, Math.min(1, v));
        } },
      { ids: ['f-ecolor'], label: 'Émissif', type: 'color',
        visible: function(c){ return !meshMaterialAsset(c); },
        get: function(c){
          return '#' + new THREE.Color(c.node.userData.emissiveBase || 0).getHexString();
        },
        set: function(c, v){
          const m = meshMaterial(c);
          if(m.emissive) m.emissive.set(v);
          // `emissiveBase` est la couleur de REPOS : la sélection pose sa propre émissive
          // par-dessus, et c'est celle-ci qu'elle remet en sortant.
          c.node.userData.emissiveBase = new THREE.Color(v).getHex();
        } },
      { ids: ['f-opacite'], label: 'Opacité', type: 'number', step: 0.05, min: 0, max: 1,
        visible: function(c){ return !meshMaterialAsset(c); },
        get: function(c){
          const m = meshMaterial(c);
          return (m.opacity !== undefined) ? m.opacity : 1;
        },
        set: function(c, v){
          const m = meshMaterial(c);
          m.opacity = Math.max(0, Math.min(1, v));
          // `transparent` suit l'opacité : un matériau opaque laissé transparent paie un tri
          // par profondeur pour rien, et se mélange mal avec ses voisins.
          m.transparent = m.opacity < 1;
        } },
      { ids: ['f-unlit'], label: 'Non éclairé', type: 'checkbox',
        help: 'Ignore les lumières (MeshBasicMaterial)',
        visible: function(c){ return !meshMaterialAsset(c); },
        get: function(c){ return !!c.node.userData.notEclaire; },
        set: function(c, v){ toggleUnlit(c.node, !!v); } },
      { ids: ['f-mat-asset'], label: 'Asset', type: 'choice',
        visible: function(c){ return !meshMaterialAsset(c); },
        options: function(){
          return [['', '— aucun (assigner) —']].concat(
            assets.filter(function(a){ return a.kind === 'material'; })
                  .map(function(a){ return [a.id, a.name]; }));
        },
        get: function(c){ return c.node.userData.materialId || ''; },
        set: function(c, v){
          if(!v) return;
          const asset = assets.find(function(a){ return a.id === v && a.kind === 'material'; });
          if(!asset) return;
          pushHistory();
          applyMaterialOn(asset, c.node);
        } },
      { type: 'note',
        when: function(c){
          return !meshMaterialAsset(c) && !assets.some(function(a){ return a.kind === 'material'; });
        },
        text: 'Créez d\'abord un matériau 🎨 dans le panneau Projet.' },
      { type: 'action', ids: ['btn-mat-extract'], label: '🎨 Extraire comme asset',
        help: 'Crée un asset matériau réutilisable à partir de l\'apparence actuelle',
        visible: function(c){ return !meshMaterialAsset(c); },
        run: function(c){
          pushHistory();
          const a = extractMaterialFromInline(c.node);
          if(a) setStatus('Matériau extrait comme asset « ' + a.name + ' »', 2500);
        } }
    ]},

    { id: 'shadows', title: 'Ombres', fields: [
      // `!== false` : une géométrie qui n'a jamais été réglée projette et reçoit.
      { ids: ['f-castshadow'], label: 'Projette une ombre', type: 'checkbox',
        get: function(c){ return c.node.castShadow !== false; },
        set: function(c, v){ c.node.castShadow = !!v; } },
      { ids: ['f-receiveshadow'], label: 'Reçoit les ombres', type: 'checkbox',
        get: function(c){ return c.node.receiveShadow !== false; },
        set: function(c, v){ c.node.receiveShadow = !!v; } }
    ]}
  ]
});

/**
 * Change la géométrie d'un maillage.
 *
 * `custom` ne construit RIEN : elle ne fait qu'ouvrir le sélecteur de modèle, la géométrie
 * réelle arrive quand un asset est choisi. Construire une forme par défaut en attendant ferait
 * clignoter un cube entre deux choix.
 */
export function setMeshGeometry(c, kind){
  const o = c.node;
  pushHistory();
  if(kind === 'custom'){
    o.userData.geo = 'custom';
    return;
  }
  const construite = buildGeometry(kind);
  c.mesh.geometry.dispose();
  c.mesh.geometry = construite.geo;
  o.userData.geo = construite.geoName;
  delete o.userData.geoAsset;
  // Le nom suit la forme TANT QU'IL N'A PAS ÉTÉ CHOISI : un objet renommé « Caisse » garde son
  // nom en devenant une sphère.
  if(['Cube', 'Sphère', 'Cylindre', 'Cône', 'Tore', 'Plan'].indexOf(o.name) !== -1){
    o.name = construite.name;
    updateHierarchy();
  }
  // Un plan se voit des DEUX côtés : sans ça, il disparaît dès qu'on passe derrière.
  c.material.side = (construite.geoName === 'plane') ? THREE.DoubleSide : THREE.FrontSide;
}

// ---------------------------------------------------------------------------
// Reflection — une sonde de réflexion : son rayon d'influence, sa résolution, sa cuisson.
//
// LA VUE VIENT DE probes.js, où elle vivait sous forme de trois fonctions
// (`sectionProbeHtml`/`syncProbe`/`readProbeFromDom`). Elle rejoint les autres descripteurs :
// la donnée reste dans probes.js, l'interface est ici.
//
// L'ÉTAT DE CUISSON EST UNE MESURE, pas un libellé : « non cuite » ou « cuite (256px) · 4
// objet(s) couvert(s) ». C'est le seul endroit qui dise si la sonde sert à quelque chose — une
// sonde jamais cuite ne reflète rien, et rien d'autre ne le signale.

/** Les réglages de la sonde de ce nœud, créés au premier accès. */
export function probeOf(c){ return ensureProbe(c.node); }
/** Sa cuisson, ou `null` si elle n'a jamais été cuite. */
export function probeBaked(c){ return engineProbes.cuites.get(c.node) || null; }

/** Combien d'objets cette sonde couvre réellement — celle qui est la plus proche gagne. */
export function probeCovered(c){
  const probes = probesActive();
  let n = 0;
  receiversDEnvironment().forEach(function(x){
    if(probeMoreNear(x, probes) === c.node) n++;
  });
  return n;
}

declareComponentPanel('Reflection', {
  id: 'component-reflection',
  sections: [{ id: 'probe', title: 'Sonde de réflexion', fields: [
    { ids: ['f-sorayon'], label: 'Rayon d\'influence', type: 'number', step: 0.5, min: 1, max: 200,
      get: function(c){ return probeOf(c).radius; },
      set: function(c, v){ probeOf(c).radius = Math.max(1, v); applyProbes(); } },
    { ids: ['f-probe-res'], label: 'Résolution', type: 'choice',
      options: [['64', '64 (rapide)'], ['128', '128 (défaut)'],
                ['256', '256 (net)'], ['512', '512 (lourd)']],
      get: function(c){ return String(probeOf(c).resolution); },
      set: function(c, v){
        probeOf(c).resolution = parseInt(v, 10) || 128;
        // La résolution change la TEXTURE : recuire tout de suite, sinon la sonde garde son
        // ancienne image et le réglage n'a l'air de rien faire.
        bakeProbe(c.node);
      } },
    { ids: ['f-sointens'], label: 'Intensité des reflets', type: 'number',
      step: 0.05, min: 0, max: 3,
      get: function(c){ return probeOf(c).intensity; },
      set: function(c, v){ probeOf(c).intensity = Math.max(0, Math.min(3, v)); applyProbes(); } },
    { ids: ['probe-state'], label: 'État', type: 'info',
      get: function(c){
        const b = probeBaked(c);
        if(!b || !b.rt) return 'non cuite';
        return 'cuite (' + b.rt.width + 'px) · ' + probeCovered(c) + ' objet(s) couvert(s)';
      } },
    { ids: ['f-soundbox'], label: 'Projection boîte', type: 'checkbox',
      help: 'Accroche le reflet aux murs d\'une pièce au lieu de le supposer à l\'infini',
      get: function(c){ return !!probeOf(c).box; },
      set: function(c, v){ probeOf(c).box = !!v; applyProbes(); updateBoxProbeViz(); } },
    { ids: ['f-sobtx', 'f-sobty', 'f-sobtz'], label: 'Taille de la boîte', type: 'vec3', step: 0.1,
      visible: function(c){ return !!probeOf(c).box; },
      get: function(c){ return probeOf(c).boxSize.slice(); },
      set: function(c, v){
        probeOf(c).boxSize = v.map(function(x){ return Math.max(0.02, x); });
        applyProbes();
        updateBoxProbeViz();
      } },
    { ids: ['f-sobdx', 'f-sobdy', 'f-sobdz'], label: 'Décalage du centre', type: 'vec3', step: 0.1,
      visible: function(c){ return !!probeOf(c).box; },
      get: function(c){ return probeOf(c).boxOffset.slice(); },
      set: function(c, v){
        probeOf(c).boxOffset = v.slice();
        applyProbes();
        updateBoxProbeViz();
      } },
    { type: 'note',
      when: function(c){ return !!probeOf(c).box; },
      text: 'Réglez la boîte sur les murs de la pièce. Le repère filaire orange la montre tant '
          + 'que la sonde est sélectionnée.' },
    { type: 'action', ids: ['btn-probe-bake'], label: '🔮 Cuire cette sonde',
      run: function(c){
        bakeProbe(c.node);
        applyProbes();
        setStatus('Sonde cuite — reflets appliqués aux objets couverts', 2500);
      } },
    { type: 'action', ids: ['btn-probe-all'], label: '🔮 Cuire toutes les sondes',
      run: function(){ bakeAllProbes(); } },
    { ids: ['probe-ambient'], label: 'Ambiance mesurée', type: 'info',
      visible: function(c){ const b = probeBaked(c); return !!(b && b.color); },
      get: function(c){ return probeBaked(c).color; } },
    { type: 'action', ids: ['btn-probe-ambient'], label: '💡 En faire l\'ambiance de la scène',
      help: 'Utilise cette couleur comme teinte de lumière ambiante de la scène',
      visible: function(c){ const b = probeBaked(c); return !!(b && b.color); },
      run: function(c){
        const b = probeBaked(c);
        if(!b || !b.color) return;
        pushHistory();
        env.ambianteColor = b.color;
        applyEnvironment();
        setStatus('Lumière ambiante de la scène réglée sur ' + b.color, 2500);
      } },
    { type: 'note',
      text: 'Les maillages dans le rayon reçoivent le cubemap comme reflet (effet net sur les '
          + 'matériaux métalliques ou peu rugueux). Recuisez après avoir modifié le décor. Hors '
          + 'de tout rayon, un objet reflète le ciel de la scène.' }
  ]}]
});

// ---------------------------------------------------------------------------
// Tilemap — la grille de tuiles : son plan dans le monde, sa palette, sa taille.
//
// LE COMPTE DE BOÎTES DE COLLISION EST UNE MESURE, et c'est le seul chiffre qui compte pour la
// physique : le solveur teste des BANDES regroupées, pas des cases. Mille cases alignées font
// une bande ; mille cases éparpillées en font mille.

/** Ce qui cloche dans cette tilemap, quand le validateur est chargé. */
export function tilemapIssues(c){
  if(typeof validateTilemap !== 'function') return [];
  const sprites = (typeof assets !== 'undefined')
    ? assets.filter(function(a){ return a.kind === 'sprite'; }).map(function(a){ return a.id; })
    : [];
  const tiles = (typeof c.tileDefs === 'function') ? c.tileDefs() : null;
  return validateTilemap(c, sprites, tiles) || [];
}

declareComponentPanel('Tilemap', {
  id: 'component-tilemap',
  sections: [{ id: 'tm', title: '', fields: [
    { type: 'note',
      when: function(c){ return tilemapIssues(c).length > 0; },
      text: function(c){
        const s = tilemapIssues(c);
        return s.length + ' problème(s) : ' + s.join(' · ');
      } },
    { ids: ['tm-count'], label: 'Cases', type: 'info',
      get: function(c){
        const pleines = (c.cells || []).filter(function(v){ return v !== 0; }).length;
        // Les boîtes qui BLOQUENT, pas toutes les bandes : une tuile « Aucune » en donne une
        // que le solveur ne verra jamais.
        const tiles = (typeof c.tileDefs === 'function') ? c.tileDefs() : null;
        const bands = (typeof collidingBands === 'function') ? collidingBands(c, tiles).length : 0;
        return pleines + ' case(s) posée(s), regroupées en ' + bands + ' boîte(s) de collision';
      } },
    // Le PLAN décide de l'orientation de la grille dans le monde : `xy` face à l'écran (2D),
    // `xz` à plat au sol — le décor d'un jeu vu de dessus, en 3D. C'est ce qui sort la tilemap
    // du seul plan de l'écran.
    { ids: ['f-tm-plane'], label: 'Plan', type: 'choice',
      options: [['xy', 'XY — face à l\'écran'], ['xz', 'XZ — à plat au sol'],
                ['yz', 'YZ — de profil']],
      get: function(c){ return c.plane || 'xy'; },
      set: function(c, v){ c.plane = v; rebuildTilemap(c.node); } },
    // La PALETTE est un asset partagé : deux décors peuvent la réutiliser, et changer une
    // planche se fait une fois pour tout le niveau.
    { ids: ['f-tm-palette'], label: 'Palette', type: 'choice',
      options: function(){
        const palettes = (typeof assets !== 'undefined')
          ? assets.filter(function(a){ return a.kind === 'tilePalette'; }) : [];
        return [['', '— aucune —']].concat(palettes.map(function(a){ return [a.id, a.name]; }));
      },
      get: function(c){ return c.paletteId || ''; },
      set: function(c, v){
        c.paletteId = v || null;
        rebuildTilemap(c.node);
        updateBarTilemap();
      } },
    // La TAILLE DE LA GRILLE n'était réglable nulle part : toute map faite à la main restait
    // bloquée sur les 32 × 18 du défaut.
    { ids: ['f-tm-width'], label: 'Colonnes', type: 'number', step: 1, min: 1, max: 512,
      get: function(c){ return c.width; },
      set: function(c, v){ resizeTilemapTo(c, Math.round(v), c.height); } },
    { ids: ['f-tm-height'], label: 'Rangées', type: 'number', step: 1, min: 1, max: 512,
      get: function(c){ return c.height; },
      set: function(c, v){ resizeTilemapTo(c, c.width, Math.round(v)); } },
    { ids: ['f-tm-cell'], label: 'Taille de cellule (unités)', type: 'number',
      step: 0.05, min: 0.01, max: 16,
      get: function(c){ return c.cellSize; },
      set: function(c, v){ c.cellSize = Math.max(0.01, v || 0.5); rebuildTilemap(c.node); } },
    { ids: ['f-tm-layer'], label: 'Calque', type: 'choice',
      options: function(){ return layers2dOfProject().map(function(x){ return [x, x]; }); },
      get: function(c){ return c.layer || 'Décor'; },
      set: function(c, v){ c.layer = v; rebuildTilemap(c.node); } },
    { ids: ['f-tm-order'], label: 'Ordre', type: 'number', step: 1, min: -499, max: 499,
      get: function(c){ return c.order || 0; },
      set: function(c, v){
        c.order = Math.max(-499, Math.min(499, Math.round(v) || 0));
        rebuildTilemap(c.node);
      } },
    // La collision de la MAP passe avant celle de chaque tuile : un décor de fond peint avec les
    // tuiles du sol ne doit pas bloquer le personnage. `rebuildTilemap` incrémente la version,
    // ce qui invalide le cache d'obstacles du monde 2D.
    { ids: ['f-tm-collision'], label: 'Collision', type: 'choice',
      options: [['solid', 'Selon les tuiles de la palette'], ['none', 'Aucune (décor)']],
      help: 'Chaque tuile règle sa collision dans la palette : Aucune, Solide ou Plateforme.',
      get: function(c){ return c.collision === 'none' ? 'none' : 'solid'; },
      set: function(c, v){ c.collision = v; rebuildTilemap(c.node); } },
    { type: 'note',
      text: 'Les tuiles vivent dans la palette : double-cliquez-la dans le panneau Projet pour '
          + 'la modifier. Une planche d\'auto-tuilage porte 16 images, les 16 voisinages '
          + 'possibles, dans l\'ordre de la découpe en grille 4 × 4.' },
    { type: 'note',
      text: 'Les pentes ne sont pas des tuiles : posez-les en objets, avec leur Collider2D en '
          + 'forme de pente.' }
  ]}]
});

/**
 * Change la taille de la grille.
 *
 * REDIMENSIONNER ET NON REFAIRE : une map vide de remplacement ferait perdre le décor déjà
 * peint, et un `Ctrl+Z` sur une taille tapée par erreur n'est pas un réflexe.
 */
export function resizeTilemapTo(c, w, h){
  if(!(w >= 1) || !(h >= 1)) return;
  resizeMap(c, w, h);
  rebuildTilemap(c.node);
}

// ---------------------------------------------------------------------------
// Events — les règles « Quand… Alors… », sans une ligne de code.
//
// Les deux tables ci-dessous vivaient dans js/events.js, collées au moteur d'exécution. Ce sont
// pourtant des LIBELLÉS, la seule chose de ce fichier que le runtime n'utilise jamais : elles
// suivent la vue. Le HTML qu'elles alimentaient (sectionEventsHtml) et les deux délégations
// posées sur inspBody disparaissent avec ce descripteur — c'était la dernière poche de routage
// par nom de classe CSS (`ev-when`, `ev-action-del`) de l'inspecteur.

export const EVENT_WHEN = [
  ['startup',       'Au démarrage'],
  ['entreeTrigger', 'Un objet tagué ENTRE dans ce volume'],
  ['sortieTrigger', 'Un objet tagué SORT de ce volume'],
  ['click',         'Au clic sur cet objet'],
  ['event',         'À la réception d\'un événement']
];

export const EVENT_THEN = [
  ['montrer',         'Rendre visible'],
  ['hide',            'Rendre invisible'],
  ['toggle',          'Basculer la visibilité'],
  ['destroy',         'Détruire'],
  ['emit',            'Émettre l\'événement…'],
  ['jouerSon',        'Jouer le son…'],
  ['burstParticules', 'Émettre des particules…'],
  ['status',          'Afficher le message…'],
  ['wait',            'Attendre… (secondes)'],
  ['changerScene',    'Charger la scène…'],
  ['parametreAnim',   'Régler le paramètre d\'animation…']
];

/** Une action neuve : visible, sur cet objet — l'état le plus inoffensif qui soit. */
export function newEventAction(){ return {type: 'montrer', target: '', value: ''}; }

/**
 * Les règles portées par l'objet.
 *
 * Le composant les expose en `regles` (qui appelle `ensureEvents`) ; le repli sur `userData`
 * est ce qui rend ce descripteur testable avec un composant factice de deux champs.
 */
export function eventRules(c){
  if(Array.isArray(c.regles)) return c.regles;
  const ud = c.node.userData || (c.node.userData = {});
  return ud.events || (ud.events = []);
}

/** Le paramètre d'un « Quand » n'existe que pour deux d'entre eux, et ne dit pas la même chose. */
export function eventParamLabel(when){
  if(when === 'entreeTrigger' || when === 'sortieTrigger') return 'Tag guetté';
  return 'Événement';
}

declareComponentPanel('Events', {
  id: 'component-events',
  sections: [{ id: 'ev', title: '', fields: [
    { type: 'list', id: 'f-ev-list', label: 'Règles', addLabel: '⚡ Ajouter un événement',
      items: eventRules,
      fields: function(ev, ei){
        return [
          { key: 'when', ids: ['f-ev-' + ei + '-when'], label: 'Quand', type: 'choice',
            options: EVENT_WHEN },
          { key: 'param', ids: ['f-ev-' + ei + '-param'], type: 'text',
            label: eventParamLabel(ev.when),
            placeholder: (ev.when === 'event') ? 'porte-ouverte' : 'joueur',
            visible: function(e){
              return e.when === 'entreeTrigger' || e.when === 'sortieTrigger'
                  || e.when === 'event';
            } },
          { type: 'list', id: 'f-ev-' + ei + '-actions', label: 'Alors',
            addLabel: '→ Ajouter une action',
            items: function(e){ return e.actions || (e.actions = []); },
            fields: function(ac, ai){
              return [
                { key: 'type', ids: ['f-ev-' + ei + '-' + ai + '-type'], type: 'choice',
                  options: EVENT_THEN },
                { key: 'target', ids: ['f-ev-' + ei + '-' + ai + '-target'], type: 'text',
                  placeholder: 'cible (vide = cet objet)' },
                { key: 'value', ids: ['f-ev-' + ei + '-' + ai + '-value'], type: 'text',
                  placeholder: 'valeur' }
              ];
            },
            onAdd: function(e){ (e.actions || (e.actions = [])).push(newEventAction()); },
            onRemove: function(e, i){ e.actions.splice(i, 1); } }
        ];
      },
      // Un événement neuf part de « au démarrage, rendre visible » : la règle la plus simple
      // qui fasse quelque chose de visible dès qu'on lance la scène.
      onAdd: function(c){
        eventRules(c).push({when: 'startup', param: '', actions: [newEventAction()]});
      },
      onRemove: function(c, i){ eventRules(c).splice(i, 1); } }
  ]}]
});

// ---------------------------------------------------------------------------
// AnimatorController — la machine à états d'animation.
//
// La plus grosse vue du dépôt, et la dernière à passer au socle : 500 lignes de HTML, de
// `getElementById` et de routage par identifiant, pour trois écrans qui n'apparaissent jamais
// ensemble — le composant, l'ÉTAT sélectionné dans le graphe, la TRANSITION sélectionnée.
//
// C'est exactement ce que `sections(target)` exprime : les sections sont CALCULÉES sur ce que
// le graphe a sélectionné. Là où l'ancienne vue appelait `buildInspector()` à chaque fois que
// la forme changeait (cocher « Mélange », changer d'opérateur), la signature du plan le voit
// toute seule.

/** Le graphe est ouvert sur CETTE machine ? Sinon rien de ce qu'il sélectionne ne nous concerne. */
export function graphOnAnimator(c){
  return (typeof graphAnim !== 'undefined' && graphAnim.asset === c.asset) ? graphAnim : null;
}
export function stateSelected(c){ const g = graphOnAnimator(c); return g ? g.stateSel : null; }
export function transitionSelected(c){ const g = graphOnAnimator(c); return g ? g.transSel : null; }

/** Le graphe redessiné, et le lecteur arrêté : la machine a changé sous ses pieds. */
export function animatorChanged(c){
  if(typeof drawGraph === 'function') drawGraph();
  if(typeof stopAnimator === 'function') stopAnimator(c.node);
}

/** Les paramètres CHIFFRÉS : seuls eux peuvent doser un mélange. */
export function animatorNumberParams(c){
  return ((c.machine || {}).params || [])
    .filter(function(p){ return p && p.name && (p.type === 'float' || p.type === 'int'); })
    .map(function(p){ return [p.name, p.name]; });
}

export function animatorParams(c){
  return ((c.machine || {}).params || []).filter(function(p){ return p && p.name; });
}

/** Les problèmes de la machine, relevés avant tout le reste : une machine fausse ne lève rien. */
export function animatorIssues(c){
  if(!c.asset) return [];
  const target = c.target;
  const clips = (typeof clipsOf === 'function' && target)
    ? clipsOf(target).map(function(x){ return x.name; }) : [];
  // `animsConnues` n'est passé QUE si le projet contient au moins un asset d'animation : sans
  // lui, la validation réclamerait la migration à un projet qui n'a rien à quoi migrer.
  const anims = assets.filter(function(x){ return x.kind === 'animation'; })
                      .map(function(x){ return x.id; });
  return (typeof validateAnimator === 'function')
    ? validateAnimator(c.asset.machine, clips, anims.length ? anims : null) : [];
}

/** Renommer un état, c'est renommer ce qui le CITE — sinon la machine se fige sur un nom mort. */
export function renameAnimatorState(c, e, fresh){
  const m = c.machine;
  fresh = String(fresh || '').trim();
  if(!fresh || fresh === e.name) return;
  if((m.states || []).some(function(x){ return x !== e && x.name === fresh; })){
    setStatus('Un autre état s\'appelle déjà « ' + fresh + ' »', 3500);
    return;
  }
  const old = e.name;
  (m.transitions || []).forEach(function(t){
    if(t.de === old) t.de = fresh;
    if(t.vers === old) t.vers = fresh;
  });
  if(m.start === old) m.start = fresh;
  e.name = fresh;
  animatorChanged(c);
}

/**
 * Cocher « Mélange » ne jette PAS le clip déjà choisi : il devient le premier point. Et
 * décocher rend ce premier point au clip simple — sinon un coup de case renverrait l'état à
 * « aucun clip ».
 */
export function setAnimatorBlend(c, e, on){
  if(on){
    const chiffre = ((c.machine || {}).params || [])
      .find(function(p){ return p && (p.type === 'float' || p.type === 'int'); });
    e.blend = {param: (chiffre || {}).name || '',
               points: e.clip ? [{clip: e.clip, value: 0}] : []};
  } else {
    const premier = (e.blend && (e.blend.points || [])[0]) || null;
    if(premier && !e.clip) e.clip = premier.clip;
    delete e.blend;
  }
  animatorChanged(c);
}

/** Les sections de l'état sélectionné dans le graphe. */
export function sectionsAnimatorState(c, e){
  const fields = [
    { ids: ['f-gr-state-name'], label: 'Nom', type: 'text',
      get: function(){ return e.name || ''; },
      set: function(_c, v){ renameAnimatorState(c, e, v); } },
    { ids: ['f-gr-state-blend'], label: 'Mélange', type: 'checkbox',
      help: 'Plusieurs clips sous un seul paramètre : marcher puis courir selon la vitesse, '
          + 'sans écrire trois états ni deux transitions.',
      get: function(){ return !!e.blend; },
      set: function(_c, v){ setAnimatorBlend(c, e, !!v); } }
  ];
  if(e.blend){
    fields.push(
      { ids: ['f-gr-state-blendparam'], label: 'Piloté par', type: 'choice',
        options: [['', '— aucun —']].concat(animatorNumberParams(c)),
        get: function(){ return e.blend.param || ''; },
        set: function(_c, v){ e.blend.param = v; animatorChanged(c); } },
      { type: 'list', id: 'f-gr-state-blendpoints', label: 'Points',
        help: 'Entre deux points le mélange est progressif ; en dehors, le clip le plus proche '
            + 'joue seul.',
        addLabel: '＋ Point',
        items: function(){ return (e.blend.points || (e.blend.points = [])); },
        fields: function(pt, i){
          return [
            { ids: ['f-gr-blendpt-' + i + '-clip'], type: 'choice',
              options: function(){
                return [['', '— clip —']].concat(clipsOfGraph()
                  .map(function(n){ return [n, n]; }));
              },
              get: function(k){ return k.clip || ''; },
              set: function(k, v){ k.clip = v; animatorChanged(c); } },
            { ids: ['f-gr-blendpt-' + i + '-value'], type: 'number', step: 0.1,
              get: function(k){ return k.value || 0; },
              set: function(k, v){ k.value = v || 0; animatorChanged(c); } }
          ];
        },
        onAdd: function(){ (e.blend.points || (e.blend.points = [])).push({clip:'', value:0}); animatorChanged(c); },
        onRemove: function(_c, i){ e.blend.points.splice(i, 1); animatorChanged(c); } },
      { type: 'note',
        text: 'Les clips sont lus à la vitesse qui les fait boucler ensemble : les pas restent '
            + 'alignés même si les durées diffèrent.' },
      { type: 'note', when: function(){ return !animatorNumberParams(c).length; },
        text: 'Aucun paramètre chiffré déclaré : ajoutez-en un, sinon le mélange restera bloqué '
            + 'sur son premier clip.' });
  } else {
    // Depuis la v0.52, un état désigne un ASSET d'animation, qui porte la vitesse, la boucle
    // et la découpe.
    fields.push(
      { ids: ['f-gr-state-anim'], label: 'Animation', type: 'choice',
        options: function(){
          return [['', '— aucune —']].concat(assets.filter(function(x){ return x.kind === 'animation'; })
                                                   .map(function(a){ return [a.id, a.name]; }));
        },
        get: function(){ return e.animation || ''; },
        set: function(_c, v){
          // Le `clip` d'origine est EFFACÉ quand une animation est choisie : le laisser ferait
          // un repli silencieux vers l'ancien clip le jour où l'asset disparaît, au lieu de
          // l'erreur que `validateAnimator` doit donner.
          if(v){ e.animation = v; delete e.clip; } else delete e.animation;
          animatorChanged(c);
        } },
      { type: 'note',
        when: function(){ return !assets.some(function(x){ return x.kind === 'animation'; }); },
        text: 'Aucune animation dans le projet : créez-en une avec « 🎞 Nouvelle animation » dans '
            + 'le panneau Projet, ou glissez-en une sur l\'état.' },
      // L'ancien champ « Clip » reste visible, inerte, quand l'état n'a pas encore été migré :
      // deviner le clip recâblerait l'animation d'un personnage sur celle d'un autre.
      { ids: ['f-gr-state-clip'], label: 'Clip (ancien)', type: 'info',
        visible: function(){ return !!(e.clip && !e.animation); },
        get: function(){ return e.clip; } });
  }
  fields.push(
    { ids: ['f-gr-state-speed'], label: 'Vitesse', type: 'number', step: 0.1,
      get: function(){ return e.speed === undefined ? 1 : e.speed; },
      set: function(_c, v){ e.speed = v || 1; animatorChanged(c); } },
    { ids: ['f-gr-state-loop'], label: 'Boucle', type: 'checkbox',
      get: function(){ return e.loop !== false; },
      set: function(_c, v){ e.loop = !!v; animatorChanged(c); } },
    { ids: ['f-gr-state-start'], label: 'Départ', type: 'checkbox',
      help: 'L\'état dans lequel la machine démarre. Un seul à la fois.',
      get: function(){ return !!(c.machine && (c.machine.start || '') === e.name); },
      set: function(_c, v){
        // Décocher sans en désigner un autre laisserait la machine sans point d'entrée.
        if(v) c.machine.start = e.name;
        animatorChanged(c);
      } });
  const sections = [{ id: 'gr-state', title: 'État sélectionné', fields: fields }];
  // Pour un mélange il n'y a pas UN clip courant unique : pas de marqueurs à afficher.
  if(!e.blend && (e.animation || e.clip)){
    const asset = e.animation ? assets.find(function(a){ return a.id === e.animation; }) : null;
    const nameClip = asset ? ((asset.source || {}).clip || '') : e.clip;
    const markers = asset ? markersOfClip(asset, nameClip) : [];
    sections.push({ id: 'gr-state-markers', title: 'Marqueurs (lecture seule)', fields: [
      { type: 'note', when: function(){ return !markers.length; },
        text: 'Aucun marqueur sur ce clip. Les marqueurs se posent sur l\'asset d\'animation, '
            + 'dans son propre éditeur.' },
      { type: 'note', when: function(){ return markers.length > 0; },
        text: function(){ return formatAnimatorStateMarkers(markers); } }
    ]});
  }
  return sections;
}

/** Formate la liste des marqueurs d'un clip pour la note en lecture seule (« 0.30 s — pas »). */
export function formatAnimatorStateMarkers(markers){
  return markers.map(function(m){
    return m.t.toFixed(2) + ' s — ' + (m.name || '(sans nom)');
  }).join(' · ');
}

// Les VALEURS sont celles d'`ANIMATOR_INTERRUPTIONS` (js/animator.js) : la vue ne fait qu'y
// mettre des libellés, elle n'a pas le droit d'en inventer une sixième.
export const ANIMATOR_INTERRUPTION_LABELS = {
  aucune: 'Aucune',
  etatCourant: "Par l'état courant",
  etatSuivant: "Par l'état d'arrivée",
  courantPuisSuivant: 'Courant, puis arrivée',
  suivantPuisCourant: 'Arrivée, puis courant'
};

export function animatorInterruptionOptions(){
  return ANIMATOR_INTERRUPTIONS.map(function(v){
    return [v, ANIMATOR_INTERRUPTION_LABELS[v] || v];
  });
}

/** Une condition : quel paramètre, quel opérateur, et — sauf déclencheur — quelle valeur. */
export function conditionFields(c, cond, i){
  const params = animatorParams(c);
  const p = params.find(function(x){ return x.name === cond.param; }) || params[0];
  const type = (p && p.type) || 'float';
  const out = [
    { ids: ['f-gr-cond-' + i + '-param'], type: 'choice',
      options: params.map(function(x){ return [x.name, x.name]; }),
      get: function(k){ return k.param; },
      set: function(k, v){
        k.param = v;
        // Changer de paramètre peut changer son TYPE, donc les opérateurs permis : on ramène
        // l'opérateur au premier valide plutôt que de garder un « > » sur un déclencheur.
        const q = animatorParams(c).find(function(x){ return x.name === k.param; });
        const ops = OPERATORS_BY_TYPE[(q && q.type) || 'float'] || [];
        if(!ops.some(function(o){ return o[0] === k.operateur; })){
          k.operateur = ops[0] ? ops[0][0] : '>';
        }
        animatorChanged(c);
      } },
    { ids: ['f-gr-cond-' + i + '-op'], type: 'choice',
      options: OPERATORS_BY_TYPE[type] || OPERATORS_BY_TYPE.float || [],
      get: function(k){ return k.operateur; },
      set: function(k, v){ k.operateur = v; animatorChanged(c); } }
  ];
  // Un déclencheur n'a pas de valeur à comparer : il est armé ou il ne l'est pas. Un champ vide
  // à côté ferait chercher quoi y mettre.
  if(type === 'bool'){
    out.push({ ids: ['f-gr-cond-' + i + '-val'], type: 'choice',
      options: [['true', 'vrai'], ['false', 'faux']],
      get: function(k){ return k.value ? 'true' : 'false'; },
      set: function(k, v){ k.value = (v === 'true' || v === true); animatorChanged(c); } });
  } else if(type !== 'trigger'){
    out.push({ ids: ['f-gr-cond-' + i + '-val'], type: 'number',
      step: type === 'int' ? 1 : 0.1,
      get: function(k){ return k.value === undefined ? 0 : k.value; },
      set: function(k, v){
        k.value = type === 'int' ? Math.round(v || 0) : (v || 0);
        animatorChanged(c);
      } });
  }
  return out;
}

export function sectionConditionFields(c, t){
  const params = animatorParams(c);
  if(!params.length){
    return [{ type: 'note',
      text: 'Aucun paramètre déclaré : ajoutez-en dans le panneau Paramètres de la fenêtre '
          + 'Animator, sinon il n\'y a rien à tester.' }];
  }
  return [
    { type: 'list', id: 'f-gr-conds', label: 'Conditions — ' + (t.conditions || []).length,
      addLabel: '＋',
      items: function(){ return t.conditions || []; },
      fields: function(cond, i){ return conditionFields(c, cond, i); },
      onAdd: function(){
        const p = animatorParams(c)[0];
        const ops = OPERATORS_BY_TYPE[p.type || 'float'] || [['>', '']];
        t.conditions = t.conditions || [];
        t.conditions.push({param: p.name, operateur: ops[0][0],
                           value: p.type === 'bool' ? true : 0});
        animatorChanged(c);
      },
      onRemove: function(_c, i){ (t.conditions || []).splice(i, 1); animatorChanged(c); } },
    { type: 'note', when: function(){ return !(t.conditions || []).length; },
      text: 'Sans condition, la transition part dès que possible — dès l\'instant de sortie si '
          + 'vous en avez posé un.' }
  ];
}

/** Les sections de la transition sélectionnée : ses réglages, puis ses conditions. */
export function sectionsAnimatorTransition(c, t){
  const fields = [
    { ids: ['f-gr-tr-pair'], label: 'De → vers', type: 'info',
      get: function(){ return t.de + ' → ' + t.vers; } },
    { ids: ['f-gr-tr-priority'], label: 'Priorité', type: 'info',
      help: 'La première transition qui convient l\'emporte. Les boutons changent sa POSITION '
          + 'dans la liste — ce n\'est pas un nombre à part.',
      get: function(){
        const list = (c.machine && c.machine.transitions) || [];
        const i = list.indexOf(t);
        return (i + 1) + ' / ' + list.length;
      } },
    { type: 'action', ids: ['btn-gr-tr-up'], label: '▲ Monter',
      enabled: function(){ return ((c.machine.transitions || []).indexOf(t)) > 0; },
      run: function(){
        const i = c.machine.transitions.indexOf(t);
        if(typeof moveTransition === 'function') moveTransition(c.machine, i, -1);
        animatorChanged(c);
      } },
    { type: 'action', ids: ['btn-gr-tr-down'], label: '▼ Descendre',
      enabled: function(){
        const list = c.machine.transitions || [];
        return list.indexOf(t) < list.length - 1;
      },
      run: function(){
        const i = c.machine.transitions.indexOf(t);
        if(typeof moveTransition === 'function') moveTransition(c.machine, i, 1);
        animatorChanged(c);
      } },
    { ids: ['f-gr-tr-end'], label: 'Fin du clip', type: 'checkbox',
      help: 'Le « Has Exit Time » d\'Unity : n\'emprunter cette transition qu\'une fois une '
          + 'certaine part du clip jouée. Indispensable pour un saut ou un coup, qui rendraient '
          + 'la main dès la première image.',
      get: function(){ return !!t.awaitEnd; },
      set: function(_c, v){ t.awaitEnd = !!v; animatorChanged(c); } },
    { ids: ['f-gr-tr-exit'], label: 'Instant de sortie', type: 'number', step: 0.05, min: 0,
      help: 'Le « Exit Time » d\'Unity, en FRACTION du clip : 0,75 = aux trois quarts. Au-delà '
          + 'de 1, la transition attend plusieurs tours de boucle.',
      // Inerte, pas masqué : le réglage existe, il ne sert simplement à rien tant que la
      // transition n'attend pas la fin du clip.
      enabled: function(){ return !!t.awaitEnd; },
      disabledReason: 'demande « Fin du clip »',
      get: function(){ return t.exitTime === undefined ? 1 : t.exitTime; },
      set: function(_c, v){ t.exitTime = Math.max(0, v || 0); animatorChanged(c); } },
    { ids: ['f-gr-tr-fixedduration'], label: 'Durée fixe', type: 'checkbox',
      help: 'Le « Fixed Duration » d\'Unity. Cochée : le fondu se compte en SECONDES. '
          + 'Décochée : en fraction de la durée du clip de départ — ce qu\'on veut quand la '
          + 'même machine sert à des clips de longueurs très différentes.',
      get: function(){ return t.durationFixe !== false; },
      set: function(_c, v){ t.durationFixe = !!v; animatorChanged(c); } },
    // Le libellé change avec le mode, parce que le nombre ne veut PAS dire la même chose : en
    // fondu c'est le temps pendant lequel deux clips jouent ensemble, en inertie le temps que
    // met l'écart à s'effacer — un seul clip joue.
    { ids: ['f-gr-tr-duration'], type: 'number', step: 0.05, min: 0,
      label: (t.inertia ? 'Résorption' : 'Fondu') + (t.durationFixe !== false ? ' (s)' : ' (×clip)'),
      get: function(){ return t.duration === undefined ? 0.2 : t.duration; },
      set: function(_c, v){ t.duration = Math.max(0, v || 0); animatorChanged(c); } },
    { ids: ['f-gr-tr-offset'], label: 'Décalage d\'arrivée', type: 'number',
      step: 0.05, min: 0, max: 1,
      help: 'Le « Transition Offset » d\'Unity : le clip d\'arrivée démarre à cette fraction de '
          + 'sa durée, au lieu de sa première image.',
      get: function(){ return t.offset === undefined ? 0 : t.offset; },
      set: function(_c, v){ t.offset = Math.max(0, Math.min(1, v || 0)); animatorChanged(c); } },
    { ids: ['f-gr-tr-inertia'], label: 'Inertie', type: 'checkbox',
      help: 'Au lieu de mélanger les deux animations, démarrer la nouvelle seule et résorber '
          + 'l\'écart avec la pose en cours. Pas de pose à mi-chemin, pas de pieds qui glissent '
          + '— et la vitesse des membres est conservée au raccord.',
      get: function(){ return !!t.inertia; },
      set: function(_c, v){ t.inertia = !!v; animatorChanged(c); } },
    { ids: ['f-gr-tr-interruption'], label: 'Interruption', type: 'choice',
      options: animatorInterruptionOptions(),
      get: function(){ return t.interruption || 'aucune'; },
      set: function(_c, v){ t.interruption = v; animatorChanged(c); } },
    { type: 'note',
      text: 'L\'interruption est déclarée mais pas encore appliquée : notre machine ne prend '
          + 'qu\'une transition par image et ne coupe pas un fondu en cours. Le réglage est '
          + 'enregistré pour ne pas avoir à recâbler quand ce sera le cas.' }
  ];
  return [{ id: 'gr-tr', title: 'Transition sélectionnée', fields: fields },
          { id: 'gr-cond', title: '', fields: sectionConditionFields(c, t) }];
}

declareComponentPanel('AnimatorController', {
  id: 'component-animator-controller',
  sections: function(c){
    if(!c) return [];
    const head = [
      { ids: ['f-anim-ctrl-asset'], label: 'Machine', type: 'choice',
        options: function(){
          return [['', '— aucune (créer) —']].concat(
            assets.filter(function(a){ return a.kind === 'animator'; })
                  .map(function(a){ return [a.id, a.name]; }));
        },
        get: function(x){ return x.data.assetId || ''; },
        set: function(x, v){
          const a = v ? assets.find(function(y){ return y.id === v && y.kind === 'animator'; }) : null;
          x.data.assetId = a ? a.id : null;
          if(typeof stopAnimator === 'function') stopAnimator(x.node);
        } }
    ];
    if(!c.asset){
      head.push({ ids: ['btn-animctrl-create'], type: 'action', label: '＋ Créer une machine…',
        run: function(x){ x.data.assetId = createAssetAnimator(x.node.name).id; } });
      return [{ id: 'ac', title: '', fields: head }];
    }
    // Les problèmes AVANT tout le reste : une machine fausse ne lève aucune erreur, le
    // personnage reste simplement figé. C'est le seul écran où on peut le dire à temps.
    const target = c.target;
    head.push(
      { type: 'note', when: function(){ return !target; },
        text: 'Aucune cible : le nœud « ' + (c.data.target || '')
            + ' » est introuvable sous cet objet.' },
      { type: 'note', when: function(x){ return !!target && !!animatorIssues(x).length; },
        text: function(x){
          const s = animatorIssues(x);
          return s.length + ' problème(s) : ' + s.join(' · ');
        } },
      { ids: ['f-anim-ctrl-target'], label: 'Pilote', type: 'info',
        help: 'Le nœud dont les os sont animés. Vide = le premier descendant qui porte des clips.',
        get: function(){ return target ? target.name : '—'; } });
    const player = (typeof playerAnimatorOf === 'function') ? playerAnimatorOf(c.node) : null;
    if(player && player.state){
      head.push({ ids: ['f-anim-ctrl-state'], label: 'État', type: 'info',
        get: function(){ return player.state; } });
    }
    head.push(
      // TROIS choix, et plus une case à cocher : « Sur place » est le réglage qui manquait, et
      // une case ne pouvait pas le dire. Les clips d'un pack tout fait (Mixamo) portent leur
      // propre déplacement ; décocher ne le retirait donc pas — il restait sur le bassin, et le
      // modèle partait hors de son pivot pendant qu'un script le déplaçait par-dessus.
      { ids: ['f-anim-ctrl-root'], label: 'Root motion', type: 'choice',
        options: [['', 'Aucun (clips déjà sur place)'],
                  ['move', 'Déplace l\'objet'],
                  ['inPlace', 'Sur place (annule le déplacement du clip)']],
        help: 'Ce que devient le déplacement contenu dans l\'animation. « Déplace l\'objet » : '
            + 'c\'est l\'animation qui fait avancer le personnage — à ne pas choisir si un corps '
            + 'physique ou un script le déplace déjà, les deux écritures se disputeraient sa '
            + 'position. « Sur place » : le déplacement est retiré du clip sans être reporté sur '
            + 'l\'objet, c\'est le réglage d\'un personnage piloté par script dont les clips '
            + 'avancent. « Aucun » ne touche à rien : à réserver aux clips filmés sur place.',
        get: function(x){ return x.data.rootMotion === 'inPlace' ? 'inPlace'
                               : (x.data.rootMotion ? 'move' : ''); },
        set: function(x, v){ x.data.rootMotion = (v === 'move') ? true : (v || false); } },
      // Le bouton qu'on cherche en premier. Dans Unity, le composant Animator ouvre son
      // contrôleur, et c'est de là qu'on y entre.
      { ids: ['btn-animctrl-open'], type: 'action', label: '🔀 Ouvrir l\'éditeur Animator',
        run: function(x){
          openAnimatorOnAsset(x.asset);
        } },
      // Le JSON brut : la sortie de secours quand on veut voir la machine en entier, la copier
      // ailleurs, ou rattraper ce que le graphe ne sait pas encore exprimer.
      { ids: ['btn-animctrl-edit'], type: 'action', label: '✎ Éditer le JSON…',
        run: function(x){ openEditorMachineJson(x.asset, x.node); } });

    const sections = [{ id: 'ac', title: '', fields: head }];
    // Ce que le graphe a sélectionné s'édite ICI : le graphe montre la structure, l'inspecteur
    // montre le détail — un seul endroit où chercher les propriétés de quoi que ce soit.
    const e = stateSelected(c);
    if(e) return sections.concat(sectionsAnimatorState(c, e));
    const t = transitionSelected(c);
    if(t) return sections.concat(sectionsAnimatorTransition(c, t));
    return sections;
  }
});

/**
 * Un porteur `c` pour sectionsAnimatorState/sectionsAnimatorTransition SANS composant réel.
 *
 * Ces deux fonctions ne lisent que `c.asset`, `c.machine` et `c.node` (`c.node` seulement pour
 * l'arrêter dans `animatorChanged`, jamais pour une lecture qui échouerait sur `null`) — jamais
 * `c.target` ni `c.data`, propres au panneau du composant. D'où ce porteur minimal : la fenêtre
 * Animator ouverte sur un ASSET (panneau Projet, `openAnimatorOnAsset`) n'a pas forcément
 * d'objet de scène derrière (`graphAnim.node` peut être `null`), et ça n'a jamais gêné ces
 * sections-là.
 */
export function animatorAssetGraphTarget(asset){
  const node = (typeof graphAnim !== 'undefined') ? graphAnim.node : null;
  return { asset: asset, machine: asset ? asset.machine : null, node: node };
}

/**
 * Monte le mini-inspecteur état/transition SOUS l'inspecteur d'asset (import-settings.js),
 * quand la fenêtre Animator est ouverte sur CET asset et qu'un état ou une transition y est
 * sélectionné — SANS passer par un composant AnimatorController posé sur un objet de la scène.
 *
 * Avant ce montage, cliquer un état/une transition dans le graphe rappelait bien
 * `buildInspector()` (animator-graph.js), mais celui-ci s'arrêtait à `buildInspectorAsset` dès
 * qu'un asset est sélectionné dans le panneau Projet (inspector.js) : le graphe se dessinait,
 * mais aucun détail d'état/transition n'était jamais montré nulle part. C'est la cause exacte
 * du bug rapporté : « je clique sur un asset animator, [...] je veux pouvoir modifier la data
 * de l'asset animator, SANS passer par un composant AnimatorController ».
 */
export function mountInspectorAnimatorAsset(asset){
  if(!asset || asset.kind !== 'animator') return;
  if(typeof graphAnim === 'undefined' || graphAnim.asset !== asset) return;
  const e = graphAnim.stateSel;
  const t = graphAnim.transSel;
  if(!e && !t) return;
  const c = animatorAssetGraphTarget(asset);
  const host = document.createElement('div');
  host.id = 'insp-animator-asset-graph';
  inspBody.appendChild(host);
  const form = createForm(host, { id: 'component-animator-asset-graph',
    sections: function(){ return e ? sectionsAnimatorState(c, e) : sectionsAnimatorTransition(c, t); } });
  form.setTargets([c]);
}

/**
 * L'INSPECTEUR INTERNE de la fenêtre Animator — la colonne de droite de `#graph-animator`.
 *
 * POURQUOI IL EXISTE. Les propriétés d'un état/d'une transition ne s'éditaient que dans
 * l'inspecteur principal, et seulement via `mountInspectorAnimatorAsset`, c'est-à-dire seulement
 * si la TILE de l'asset était sélectionnée dans le panneau Projet AU MÊME MOMENT. Or on
 * sélectionne un état DEPUIS la fenêtre Animator — un geste qui ne touche pas au panneau
 * Projet. Cliquer un état n'ouvrait donc rien, nulle part, sans un mot : l'inspecteur principal
 * affichait « aucun objet sélectionné » pendant que le graphe montrait l'état en surbrillance.
 *
 * Le formulaire est construit UNE FOIS et gardé : `setTargets` ne reconstruit le DOM que si la
 * FORME change (état ↔ transition ↔ rien) et jamais pendant une saisie — c'est ce qui permet de
 * l'appeler à chaque `drawGraph()`, y compris soixante fois par seconde pendant un glissement,
 * sans vider le champ qu'on est en train de remplir.
 *
 * Appelée par `drawGraph()` (js/animator-graph.js) via `globalThis` : ce fichier importe déjà
 * animator-graph.js, un `import` en sens inverse fermerait un cycle — et un cycle sur ce
 * chemin-là, c'est une ReferenceError de zone morte temporelle au démarrage.
 */
let formInspectorGraph = null;
let selInspectorGraph = null;   // l'état/la transition pour lequel le formulaire a été bâti
export function mountInspectorGraphAnimator(){
  const host = document.getElementById('graph-inspector');
  if(!host) return;
  const g = (typeof graphAnim !== 'undefined') ? graphAnim : null;
  const asset = g ? g.asset : null;
  if(!asset || !asset.machine){
    host.innerHTML = ''; formInspectorGraph = null; selInspectorGraph = null; return;
  }
  // PASSER D'UN ÉTAT À UN AUTRE change la CIBLE, pas la FORME — et `setTargets` ne reconstruit
  // que sur un changement de forme. Les `get`/`set` des champs capturent l'état au moment où la
  // section est bâtie : sans ce contrôle d'identité, sélectionner un second état laissait le
  // formulaire afficher et ÉCRIRE le premier. On jette donc le formulaire dès que la sélection
  // change d'objet ; tant qu'elle ne bouge pas, il survit (et la saisie en cours avec lui).
  const sel = g.stateSel || g.transSel || null;
  if(sel !== selInspectorGraph){
    host.innerHTML = '';
    formInspectorGraph = null;
    selInspectorGraph = sel;
  }
  if(!g.stateSel && !g.transSel){
    // Le dire plutôt que de laisser une colonne vide : sans cette phrase, on ne sait pas si rien
    // n'est sélectionné ou si l'inspecteur est en panne.
    host.innerHTML = '<div class="gi-empty">Sélectionnez un <b>état</b> ou une '
      + '<b>transition</b> dans le graphe pour en régler le détail ici.</div>';
    formInspectorGraph = null;
    return;
  }
  const titre = g.stateSel ? 'État sélectionné' : 'Transition sélectionnée';
  if(!formInspectorGraph){
    host.innerHTML = '<div class="gi-head"></div><div class="gi-body"></div>';
    formInspectorGraph = createForm(host.querySelector('.gi-body'),
      { id: 'graph-animator-inspector',
        // Le porteur est fabriqué ICI, et non pris dans l'argument : `createForm` bâtit son plan
        // AVANT le premier `setTargets`, donc la cible passée vaut `null` à ce moment-là — et
        // `sectionsAnimatorState(null, …)` lève sur `c.machine`, ce qui laissait la colonne
        // vide sans que rien ne s'affiche. Relire `graphAnim` à chaque appel le rend en plus
        // toujours à jour, y compris après un changement de machine dans le sélecteur.
        sections: function(){
          const porteur = animatorAssetGraphTarget(graphAnim.asset);
          if(!porteur.machine) return [];
          if(graphAnim.stateSel) return sectionsAnimatorState(porteur, graphAnim.stateSel);
          if(graphAnim.transSel) return sectionsAnimatorTransition(porteur, graphAnim.transSel);
          return [];
        } });
  }
  const tete = host.querySelector('.gi-head');
  if(tete) tete.textContent = titre;
  formInspectorGraph.setTargets([animatorAssetGraphTarget(asset)]);
}

// EXPOSÉ EN GLOBALE, à dessein : voir le commentaire de `mountInspectorGraphAnimator`. C'est le
// même patron que `globalThis.drawGraph` (js/animator-graph.js), en sens inverse.
if(typeof globalThis !== 'undefined') globalThis.mountInspectorGraphAnimator = mountInspectorGraphAnimator;

// ---------------------------------------------------------------------------
// SkinnedMeshRenderer — squelette, avatar humanoïde, clips externes d'un modèle skinné.
//
// Toujours posé (jamais retiré) sur chaque THREE.SkinnedMesh du sous-arbre d'un modèle importé
// (voir components/component-skinned-mesh.js). Sa carte reste visible (hiddenInInspector:false)
// mais sans croix de retrait (removable:false, tâche 1.4) — elle reviendrait toute seule au
// clone suivant.
//
// Ce panneau reprend sectionSkeletonHtml/sectionAnimationHtml (js/skeleton.js, retirées — leur
// contenu a migré ici), qui vivaient gatées sur `userData.type === 'model'` dans inspector.js —
// désormais affichées par le mécanisme générique dès que ce composant existe sur le nœud, plus
// par un `if(t==='model')` câblé en dur (voir tâche 3).

declareComponentPanel('SkinnedMeshRenderer', {
  id: 'component-skinnedmeshrenderer',
  sections: function(c){
    if(!c) return [];
    const o = c.node;
    const sq = c.skeleton;
    const sections = [];

    // Animation — indépendante du squelette À DESSEIN (voir skeleton.js d'origine) : un FBX
    // d'animation seule (export Mixamo « without skin ») n'a aucun maillage skinné, donc pas de
    // squelette au sens de `skeletonOf`, mais porte le clip qu'on est venu chercher.
    const clips = (typeof clipsOf === 'function') ? clipsOf(o) : [];
    const external = animationsExternalFor(o);
    if(clips.length || external.length){
      const shown = (typeof clipShown !== 'undefined' && clipShown.obj === o) ? clipShown.clip : null;
      const venus = externalClipsOf(o).map(function(r){ return r.localName; });
      const fieldsClips = [
        { ids: ['smr-clips-count'], label: 'Clips', type: 'info', get: function(){ return clips.length; } }
      ];
      clips.forEach(function(cl, i){
        const importe = venus.indexOf(cl.name) !== -1;
        fieldsClips.push({ ids: ['smr-clip-' + i], type: 'action',
          label: (cl === shown ? '● ' : (importe ? '⇥ ' : '🎞 ')) + cl.name
               + ' (' + cl.duration.toFixed(2) + ' s)',
          help: 'Afficher ses clés dans la timeline et s\'y déplacer',
          run: function(){
            const deja = (typeof clipShown !== 'undefined' && clipShown.clip === cl);
            if(deja){
              // Masquer est un choix EXPLICITE, qu'on retient : sans mémoire, resélectionner
              // l'objet ferait revenir le clip.
              ed(o).clipMask = true;
              stopClipShown();
              updateTimeline();
            } else {
              ed(o).clipMask = false;
              showClipInTimeline(o, cl, true);
            }
          } });
        if(importe){
          fieldsClips.push({ ids: ['smr-clip-detach-' + i], type: 'action',
            label: '✕ Détacher « ' + cl.name + ' »',
            run: function(){
              if(typeof clipShown !== 'undefined' && clipShown.clip && clipShown.clip.name === cl.name){
                stopClipShown();
              }
              detachAnimationExternal(o, cl.name);
              updateTimeline();
              setStatus('Animation « ' + cl.name + ' » détachée', 2500);
            } });
        }
      });
      if(clips.length){
        // Le libellé ne peut pas suivre l'état de lecture en direct (une action n'est pas
        // resynchronisée hors reconstruction de forme) — un seul bouton bascule les deux sens.
        fieldsClips.push({ ids: ['smr-play'], type: 'action', label: '▶ ⏸ Jouer/Pause dans la vue',
          help: 'Joue ou met en pause le clip affiché dans la vue.',
          run: function(){
            if(typeof clipShown !== 'undefined' && clipShown.obj !== o && clips.length){
              ed(o).clipMask = false;
              showClipInTimeline(o, clips[0], true);
            }
            togglePlayback();
          } });
      }
      // Couches par os EN COURS, posées par script (api.layerAnimation) : lecture seule.
      const layers = (typeof layersOf === 'function') ? layersOf(o) : [];
      layers.forEach(function(l, i){
        fieldsClips.push({ ids: ['smr-layer-' + i], label: 'Couche', type: 'info',
          help: 'Posée par script. Ce clip joue sur « ' + l.depuis + ' » et toute sa '
              + 'descendance ; le clip principal garde les autres os.',
          get: function(){
            return l.name + ' (depuis ' + l.depuis
              + (l.weight !== 1 ? ', ' + Math.round(l.weight * 100) + ' %' : '') + ')';
          } });
      });
      external.forEach(function(e, i){
        const pct = Math.round(e.compat.rate * 100);
        fieldsClips.push({ ids: ['smr-ext-' + i], type: 'action',
          label: '⇥ ' + e.asset.name + ' (' + e.clip.duration.toFixed(2) + ' s, ' + pct + ' %)',
          // Le taux DÉCIDE : à 100 % le transfert est exact, en dessous des os resteront immobiles.
          help: e.compat.missing.length
            ? 'Os sans équivalent ici : ' + e.compat.missing.slice(0, 6).join(', ')
              + (e.compat.missing.length > 6 ? '…' : '')
            : 'Tous les os du clip existent sur ce personnage.',
          run: function(){
            const pose = attachAnimationExternal(o, e.asset, e.clip);
            if(!pose){
              setStatus('Reciblage impossible : aucun os de « ' + e.asset.name
                + ' » ne correspond à ce personnage', 4000);
              return;
            }
            ed(o).clipMask = false;
            showClipInTimeline(o, pose, true);
            setStatus('« ' + e.asset.name + ' » posée sur ' + o.name + ' — ' + pct + ' % des os'
              + (pct < 100 ? ' (les autres restent immobiles)' : ''), 4000);
          } });
      });
      sections.push({ id: 'smr-clips', title: 'Animation', fields: fieldsClips });
    }

    const fields = [
      { ids: ['smr-bones'], label: 'Os', type: 'info',
        get: function(){ return c.boneCount; } }
    ];
    if(sq && conventionOfNaming(sq) === 'mixamo'){
      fields.push({ ids: ['smr-naming'], label: 'Nommage', type: 'info',
        get: function(){ return 'Mixamo'; },
        help: 'Tous les exports Mixamo partagent ces noms d\'os : un clip d\'un export peut '
            + 'donc s\'adresser au squelette d\'un autre.' });
    }
    fields.push({ ids: ['f-sqvis'], label: 'Afficher le squelette', type: 'checkbox',
      help: 'Dessine le squelette par-dessus le maillage. Aide d\'édition : jamais visible '
          + 'dans le jeu.',
      get: function(){ return !!ed(o).skeletonVisible; },
      set: function(_c, v){ toggleVisualSkeleton(o, v); } });
    sections.push({ id: 'smr-skeleton', title: 'Squelette', fields: fields });
    // Avatar humanoïde : posé sur l'ASSET (modelAssetOf), pas sur ce nœud — inchangé.
    const asset = (typeof modelAssetOf === 'function') ? modelAssetOf(o) : null;
    if(asset){
      const requis = HUMANOID_BONES.filter(function(b){ return b.required; }).length;
      const avatarFields = [];
      if(!asset.avatar){
        avatarFields.push(
          { type: 'note', text: 'Aucun Avatar détecté. Nécessaire pour recibler une animation '
              + 'dont le squelette source ne partage pas les noms d\'os de celui-ci.' },
          { type: 'action', ids: ['sq-avatar-detect'], label: 'Détecter l\'Avatar',
            run: function(){
              asset.avatar = autoMapAvatar(o);
              updateProject();
              setStatus('Avatar détecté sur « ' + asset.name + ' »', 3000);
            } });
      } else {
        const problemes = validateAvatar(asset.avatar);
        avatarFields.push(
          { ids: ['smr-avatar-count'], label: 'Emplacements', type: 'info',
            get: function(){ return (requis - problemes.length) + ' / ' + requis; } });
        if(problemes.length){
          avatarFields.push({ type: 'note', text: problemes.join(' · ') });
        }
        avatarFields.push({ type: 'action', ids: ['sq-avatar-detect'], label: 'Redétecter l\'Avatar',
          run: function(){
            asset.avatar = autoMapAvatar(o);
            updateProject();
            setStatus('Avatar redétecté sur « ' + asset.name + ' »', 3000);
          } });
      }
      sections.push({ id: 'smr-avatar', title: 'Avatar humanoïde', fields: avatarFields });
    }
    return sections;
  }
});

// ---------------------------------------------------------------------------
// Synthesizer — les notes jouées par `api.playNote(id)`.
//
// L'inspecteur règle l'essentiel (id, hauteur, onde, durée, gain). Le reste — décroissance,
// vibrato, harmoniques, `meta` libre du jeu — se lit et s'écrit dans le `.scene.json` : c'est
// voulu, les données sont plates et normalisées à la relecture.

declareComponentPanel('Synthesizer', {
  id: 'component-synthesizer',
  sections: [{ id: 'synth', title: '', fields: [
    { ids: ['f-synth-vol'], label: 'Volume', type: 'number', step: 0.05, min: 0, max: 2,
      get: function(c){ return c.data.volume; },
      set: function(c, v){ c.data.volume = Math.max(0, Math.min(2, Number(v) || 0)); } },
    { type: 'list', id: 'f-synth-voices', label: 'Notes', addLabel: '♪ Ajouter une note',
      items: function(c){ return c.data.voices; },
      fields: function(v, i){
        return [
          { key: 'id', ids: ['f-synth-' + i + '-id'], label: 'Id', type: 'text' },
          { key: 'label', ids: ['f-synth-' + i + '-label'], label: 'Libellé', type: 'text' },
          { key: 'wave', ids: ['f-synth-' + i + '-wave'], label: 'Onde', type: 'choice',
            options: SYNTH_WAVES.map(function(w){ return [w, w]; }) },
          { key: 'frequency', ids: ['f-synth-' + i + '-freq'], label: 'Fréquence (Hz)', type: 'number',
            step: 1, min: 20, max: 20000 },
          { key: 'duration', ids: ['f-synth-' + i + '-dur'], label: 'Durée (s)', type: 'number',
            step: 0.05, min: 0.02, max: 30 },
          { key: 'attack', ids: ['f-synth-' + i + '-att'], label: 'Attaque (s)', type: 'number',
            step: 0.005, min: 0.001, max: 10 },
          { key: 'release', ids: ['f-synth-' + i + '-rel'], label: 'Extinction (s)', type: 'number',
            step: 0.01, min: 0.005, max: 10 },
          { key: 'gain', ids: ['f-synth-' + i + '-gain'], label: 'Gain', type: 'number',
            step: 0.05, min: 0, max: 2 }
        ];
      },
      onAdd: function(c){
        c.data.voices.push(normalizeVoice({id: 'note' + (c.data.voices.length + 1)}, c.data.voices.length));
      },
      onRemove: function(c, i){ c.data.voices.splice(i, 1); } },
    { type: 'action', ids: ['btn-synth-test'], label: 'Écouter les notes',
      run: function(c){
        c.data = normalizeSynth(c.data);
        playSequence(ensureListenerAudio().context, c.data,
          c.data.voices.map(function(v){ return v.id; }), {gap: 0.45});
      } },
    { type: 'note',
      text: 'Enveloppe complète, vibrato, harmoniques et « meta » (couleur, forme… lus par '
          + 'api.notes) s\'éditent dans le fichier de scène.' }
  ]}]
});

// ---------------------------------------------------------------------------
// TouchControls — joystick virtuel, glisser et boutons, branchés sur la table d'entrées.

declareComponentPanel('TouchControls', {
  id: 'component-touchcontrols',
  sections: [
    { id: 'touch', title: '', fields: [
      { ids: ['f-touch-desktop'], label: 'Aussi sur ordinateur', type: 'checkbox',
        help: 'Par défaut, la surcouche n\'apparaît que sur un écran tactile',
        get: function(c){ return c.data.showOnDesktop; },
        set: function(c, v){ c.data.showOnDesktop = !!v; } },
      { ids: ['f-touch-opacity'], label: 'Opacité', type: 'number', step: 0.05, min: 0.1, max: 1,
        get: function(c){ return c.data.opacity; },
        set: function(c, v){ c.data.opacity = Math.max(0.1, Math.min(1, Number(v) || 1)); } }
    ]},
    { id: 'touch-joy', title: 'Joystick', fields: [
      { ids: ['f-touch-joy-on'], label: 'Actif', type: 'checkbox',
        get: function(c){ return c.data.joystick.enabled; },
        set: function(c, v){ c.data.joystick.enabled = !!v; } },
      { ids: ['f-touch-joy-side'], label: 'Côté', type: 'choice',
        options: [['left', 'gauche'], ['right', 'droite']],
        get: function(c){ return c.data.joystick.side; },
        set: function(c, v){ c.data.joystick.side = v; } },
      { ids: ['f-touch-joy-size'], label: 'Taille (px)', type: 'number', step: 10, min: 60, max: 400,
        get: function(c){ return c.data.joystick.size; },
        set: function(c, v){ c.data.joystick.size = Math.max(60, Math.min(400, Number(v) || 150)); } },
      { ids: ['f-touch-joy-dead'], label: 'Zone morte', type: 'number', step: 0.05, min: 0, max: 0.9,
        get: function(c){ return c.data.joystick.deadZone; },
        set: function(c, v){ c.data.joystick.deadZone = Math.max(0, Math.min(0.9, Number(v) || 0)); } },
      { ids: ['f-touch-joy-x'], label: 'Axe X', type: 'text',
        get: function(c){ return c.data.joystick.axisX; },
        set: function(c, v){ c.data.joystick.axisX = String(v || ''); } },
      { ids: ['f-touch-joy-y'], label: 'Axe Y', type: 'text',
        get: function(c){ return c.data.joystick.axisY; },
        set: function(c, v){ c.data.joystick.axisY = String(v || ''); } }
    ]},
    { id: 'touch-swipe', title: 'Glisser', fields: [
      { ids: ['f-touch-swipe-on'], label: 'Actif', type: 'checkbox',
        get: function(c){ return c.data.swipe.enabled; },
        set: function(c, v){ c.data.swipe.enabled = !!v; } },
      { ids: ['f-touch-swipe-axis'], label: 'Axe', type: 'text',
        get: function(c){ return c.data.swipe.axis; },
        set: function(c, v){ c.data.swipe.axis = String(v || ''); } },
      { ids: ['f-touch-swipe-sens'], label: 'Sensibilité', type: 'number', step: 0.1, min: 0.1, max: 10,
        get: function(c){ return c.data.swipe.sensitivity; },
        set: function(c, v){ c.data.swipe.sensitivity = Math.max(0.1, Math.min(10, Number(v) || 1)); } }
    ]},
    { id: 'touch-buttons', title: 'Boutons', fields: [
      { type: 'list', id: 'f-touch-buttons', label: 'Boutons', addLabel: '＋ Ajouter un bouton',
        items: function(c){ return c.data.buttons; },
        fields: function(b, i){
          return [
            { key: 'label', ids: ['f-touch-b-' + i + '-label'], label: 'Libellé', type: 'text' },
            { key: 'action', ids: ['f-touch-b-' + i + '-action'], label: 'Action', type: 'text',
              placeholder: 'nom dans la table d\'entrées' },
            { key: 'side', ids: ['f-touch-b-' + i + '-side'], label: 'Côté', type: 'choice',
              options: [['left', 'gauche'], ['right', 'droite']] }
          ];
        },
        onAdd: function(c){
          c.data.buttons.push({id: 'button' + (c.data.buttons.length + 1), label: 'Action',
            action: 'interact', side: 'right'});
        },
        onRemove: function(c, i){ c.data.buttons.splice(i, 1); } }
    ]}
  ]
});

// ---------------------------------------------------------------------------
// WebXR — XROrigin, XRGrabbable, XRTeleportArea (js/components/component-xr.js). Le
// comportement est dans js/xr-runtime.js ; ces panneaux ne règlent que la donnée.

declareComponentPanel('XROrigin', {
  id: 'component-xrorigin',
  sections: [
    { id: 'xro', title: '', fields: [
      { ids: ['f-xro-mode'], label: 'Mode', type: 'choice',
        options: [['immersive-vr', 'Réalité virtuelle'], ['immersive-ar', 'Réalité augmentée']],
        help: 'La caméra principale doit être un ENFANT de cet objet : le casque la pilote '
            + 'relativement à lui. Placez cet objet au niveau du sol.',
        get: function(c){ return c.data.sessionMode || 'immersive-vr'; },
        set: function(c, v){ c.data.sessionMode = v; } },
      { ids: ['f-xro-space'], label: 'Suivi', type: 'choice',
        options: [['local-floor', 'Debout (hauteur réelle)'], ['local', 'Assis (hauteur de la caméra)']],
        get: function(c){ return c.data.referenceSpace || 'local-floor'; },
        set: function(c, v){ c.data.referenceSpace = v; } },
      { ids: ['f-xro-ctrl'], label: 'Afficher les manettes', type: 'checkbox',
        get: function(c){ return c.data.showControllers !== false; },
        set: function(c, v){ c.data.showControllers = !!v; } },
      { ids: ['f-xro-hands'], label: 'Suivi des mains', type: 'checkbox',
        help: 'Demande le suivi des mains au navigateur (Quest). Le pincement vaut la gâchette.',
        get: function(c){ return c.data.handTracking !== false; },
        set: function(c, v){ c.data.handTracking = !!v; } }
    ]},
    { id: 'xro-loco', title: 'Déplacement', fields: [
      { ids: ['f-xro-tp'], label: 'Téléportation', type: 'checkbox',
        help: 'Stick droit vers l’avant pour viser, relâcher pour y aller. Seules les surfaces '
            + 'portant un composant XRTeleportArea sont accessibles.',
        get: function(c){ return c.data.teleport !== false; },
        set: function(c, v){ c.data.teleport = !!v; } },
      { ids: ['f-xro-snap'], label: 'Rotation par cran (°)', type: 'number', step: 5, min: 0, max: 180,
        help: 'Stick droit gauche/droite. 0 désactive.',
        get: function(c){ return c.data.snapTurn; },
        set: function(c, v){ c.data.snapTurn = Math.max(0, Math.min(180, v || 0)); } },
      { ids: ['f-xro-speed'], label: 'Déplacement continu (m/s)', type: 'number', step: 0.1, min: 0,
        help: 'Stick gauche, dans la direction du regard. 0 désactive — plus confortable pour '
            + 'les joueurs sensibles au mal des transports.',
        get: function(c){ return c.data.moveSpeed; },
        set: function(c, v){ c.data.moveSpeed = Math.max(0, v || 0); } }
    ]}
  ]
});

declareComponentPanel('XRGrabbable', {
  id: 'component-xrgrabbable',
  sections: [{ id: 'xrg', title: '', fields: [
    { ids: ['f-xrg-radius'], label: 'Portée (m)', type: 'number', step: 0.01, min: 0,
      help: 'Distance maximale entre la main et le volume de l’objet pour le saisir '
          + '(gâchette latérale).',
      get: function(c){ return c.data.radius; },
      set: function(c, v){ c.data.radius = Math.max(0, v || 0); } },
    { ids: ['f-xrg-throw'], label: 'Lançable', type: 'checkbox',
      help: 'Avec un composant Physics, l’objet relâché garde la vitesse de la main.',
      get: function(c){ return c.data.throwable !== false; },
      set: function(c, v){ c.data.throwable = !!v; } },
    { ids: ['f-xrg-offset'], label: 'Garder la prise', type: 'checkbox',
      help: 'Décoché, l’objet se recentre dans la main au moment de la saisie.',
      get: function(c){ return c.data.keepOffset !== false; },
      set: function(c, v){ c.data.keepOffset = !!v; } }
  ]}]
});

declareComponentPanel('XRTeleportArea', {
  id: 'component-xrteleportarea',
  sections: [{ id: 'xrt', title: '', fields: [
    { ids: ['f-xrt-slope'], label: 'Pente max (°)', type: 'number', step: 1, min: 0, max: 90,
      help: 'Au-delà, la surface visée est refusée : un mur n’est pas un sol.',
      get: function(c){ return c.data.maxSlope; },
      set: function(c, v){ c.data.maxSlope = Math.max(0, Math.min(90, v || 0)); } }
  ]}]
});
