// ---------- Les descripteurs de l'inspecteur d'objet ----------
//
// DES DONNÉES, PAS DU CODE D'INTERFACE. Aucun `document`, aucune chaîne HTML : ce fichier se
// charge seul dans le harnais de test (test/inspecteur-descripteurs.test.mjs), ce qu'inspector.js
// et ses trente globales ne permettaient pas.
//
// Les ids sont ceux d'avant, À LA LETTRE — `f-name`, `f-jtag`, `f-jlayer`, `f-animauto`,
// `f-animloop`, `f-animvit`, `btn-anim-preview`, `btn-anim-stop`, `btn-prefab-*`. Du code
// extérieur les cible (le copilote, les tests), et ce lot ne doit rien lui apprendre.
//
// Les fonctions du moteur (`ensureGame`, `resolveLayer`, `instanceModified`…) sont appelées PAR
// LEUR NOM au moment de l'évaluation, jamais capturées à la construction : c'est ce qui les rend
// remplaçables — par un test, et par un plugin qui les redéfinirait.

import { ensureGame } from '../component-data.js';
import { setStatus, updateHierarchy } from '../hierarchy.js';
import { markLayersDirty } from '../objects.js';
import { applyAtPrefab, assetPrefabOf, createVariantPrefab, instanceModified, renderInstanceUnique, resetInstance } from '../prefabs.js';
import { project } from '../project.js';
import { resolveLayer } from '../scripts.js';
import { countOverrides, indexScene, openSceneSource, populateSubScene, renderUniqueSubScene, resetSubScene, traversesSubScene } from '../subscenes.js';

export const PANEL_IDENTITY = {
  id: 'inspector-identity',
  sections: [{ id: 'identity', title: '', layout: 'inline', fields: [
    // Le nom est l'identité d'UN objet : le donner à trois objets d'un coup produit trois
    // homonymes, et la hiérarchie devient illisible.
    { ids: ['f-name'], label: 'Nom', type: 'text', multi: false,
      get: function(o){ return o.name; },
      set: function(o, v){
        // Un nom vide laisse l'ancien : la hiérarchie n'affiche pas de ligne sans nom.
        o.name = v || o.name;
        if(typeof updateHierarchy === 'function') updateHierarchy();
      } },
    { ids: ['f-jtag'], label: 'Tag', type: 'text', help: 'Tag (gameplay)',
      cssClass: 'field-name-tag',
      get: function(o){ return (o.userData.game && o.userData.game.tag) || ''; },
      set: function(o, v){ ensureGame(o).tag = String(v).trim(); } },
    { ids: ['f-jlayer'], label: 'Calque', type: 'choice', cssClass: 'field-name-layer',
      options: function(){ return project.layers.map(function(l){ return [l.id, l.name]; }); },
      get: function(o){ return resolveLayer(o.userData.game && o.userData.game.layer); },
      set: function(o, v){
        // Un `<select>` rend toujours une CHAINE. Un calque dont l'id n'est pas un nombre
        // (projet ancien, calque nommé) est conservé tel quel plutôt que transformé en NaN.
        const id = parseInt(v, 10);
        ensureGame(o).layer = Number.isNaN(id) ? (String(v).trim() || 0) : id;
        // Le bit `Object3D.layers` ne se resynchronise plus par balayage de la scene a chaque
        // image : il faut donc SIGNALER le noeud (voir markLayersDirty, js/objects.js).
        markLayersDirty(o);
      } }
  ]}]
};

// « Modèle importé » : un modèle glTF/FBX n'a pas de composant Mesh — il n'y a pas UN maillage à
// représenter, il y en a N. Le seul réglage possible est donc… aucun : c'est une mesure.
export const PANEL_MODEL = {
  id: 'inspector-model',
  sections: [{ id: 'model', title: 'Modèle importé', fields: [
    { ids: ['insp-model-count'], label: 'Maillages', type: 'info',
      get: function(o){
        let n = 0;
        o.traverse(function(x){ if(x.isMesh) n++; });
        return n;
      } }
  ]}]
};

// « Matériaux » d'un maillage d'instance de modèle — la liste de matériaux du Renderer d'Unity.
// Un emplacement par sous-maillage ; « du modèle » garde ce que pose le fichier (ou l'onglet
// Matériaux de son import). Un matériau glissé depuis le panneau Projet se dépose sur la liste.
export const PANEL_MODEL_MATERIALS = {
  id: 'inspector-model-materials',
  sections: function(o){
    if(!o || !o.isMesh || !o.userData || o.userData.modelNode === undefined) return [];
    const mats = (typeof assets !== 'undefined')
      ? assets.filter(function(x){ return x.kind === 'material'; }) : [];
    const options = [['', '— du modèle —']].concat(mats.map(function(m){ return [m.id, m.name]; }));
    const n = Array.isArray(o.material) ? o.material.length : 1;
    const fields = [];
    for(let k = 0; k < n; k++){
      const cur = Array.isArray(o.material) ? o.material[k] : o.material;
      fields.push({ ids: ['insp-mat-slot-' + k], type: 'assetSlot', options: options,
        label: (cur && cur.name) ? cur.name : ('Emplacement ' + (k + 1)),
        help: 'Remplace ce matériau sur CETTE instance seulement — un override, comme sur le '
          + 'Renderer d\'Unity. Pour toutes les instances, passez par l\'onglet Matériaux du modèle.',
        get: function(x){ return ((x.userData.materialSlots || [])[k]) || ''; },
        set: function(x, v){ if(typeof setMaterialSlot === 'function') setMaterialSlot(x, k, v || null); } });
    }
    return [{ id: 'model-materials', title: 'Matériaux', fields: fields }];
  }
};

// « Prefab lié ». L'état « ● modifié » et l'activation des deux premiers boutons sont RECALCULÉS
// à chaque plan : c'est ce qui remplace `updateStatePrefab()`, qui allait pousser trois éléments
// par leur id et reconstruisait le panneau — coupant la saisie en cours.
export const PANEL_PREFAB = {
  id: 'inspector-prefab',
  sections: [{ id: 'prefab', title: 'Prefab lié', fields: [
    { ids: ['prefab-state'], label: 'Source', type: 'info',
      get: function(o){
        const a = assetPrefabOf(o);
        if(!a) return '';
        return '💠 ' + a.name + (instanceModified(o) ? ' ● modifié' : '');
      } },
    { type: 'action', ids: ['btn-prefab-apply'], label: '⇪ Appliquer au prefab',
      help: 'Pousse l\'état de cette instance dans le prefab et synchronise les autres instances',
      enabled: function(o){ return instanceModified(o); },
      run: function(){ applyAtPrefab(); } },
    { type: 'action', ids: ['btn-prefab-reset'], label: '⟲ Réinitialiser l\'instance',
      help: 'Reprend l\'état du prefab (la transform racine est conservée)',
      enabled: function(o){ return instanceModified(o); },
      run: function(){ resetInstance(); } },
    { type: 'action', ids: ['btn-prefab-variant'], label: '🧬 Créer une variante',
      help: 'Nouveau prefab dérivé, cette instance y est rattachée',
      run: function(){ createVariantPrefab(); } },
    { type: 'action', ids: ['btn-prefab-unique'], label: '✂ Rendre unique',
      run: function(){ renderInstanceUnique(); } }
  ]}]
};

// ---------- Le panneau « Sous-scène » ----------
// Descripteur pur (js/ui/*) : plus de chaîne HTML, plus de branches dans les gestionnaires
// d'inspector.js. Les ids sont ceux d'avant — `f-ssname`, `btn-ss-*`.
export const PANEL_SUBSCENE = {
  id: 'inspector-subscene',
  sections: [{ id: 'subscene', title: 'Sous-scène', fields: [
    { ids: ['f-ssname'], label: 'Scène source', type: 'choice',
      // Une scène ne peut pas s'instancier elle-même : elle n'est pas dans la liste.
      options: function(){
        return [['', '— choisir —']].concat(project.scenes
          .filter(function(s, i){ return i !== project.current; })
          .map(function(s){ return [s.name, s.name]; }));
      },
      get: function(o){ return (o.userData.subScene && o.userData.subScene.scene) || ''; },
      set: function(o, v){
        const ss = o.userData.subScene;
        ss.scene = v;
        // Les overrides visaient le contenu de l'ANCIENNE source : les garder appliquerait des
        // écarts à des objets qui n'ont plus rien à voir.
        ss.overrides = {};
        if(v) o.name = '◈ ' + v;
        populateSubScene(o);
        updateHierarchy();
      } },
    { type: 'note',
      when: function(o){
        const ss = o.userData.subScene || {};
        return !!ss.scene && indexScene(ss.scene) === -1;
      },
      text: function(o){
        return 'Scène « ' + o.userData.subScene.scene + ' » introuvable — choisissez-en une autre.';
      } },
    { ids: ['ss-content'], label: 'Contenu', type: 'info',
      get: function(o){
        let enfants = 0;
        traversesSubScene(o, function(x){ if(x.userData.ssInstance !== undefined) enfants++; });
        const nb = countOverrides(o);
        return enfants + ' objet(s) généré(s)' + (nb ? ' · ' + nb + ' override(s)' : '');
      } },
    { type: 'action', ids: ['btn-ss-open'], label: '✎ Éditer la scène source…',
      run: function(o){ openSceneSource(o); } },
    { type: 'action', ids: ['btn-ss-refresh'], label: '⟳ Recharger depuis la source',
      run: function(o){
        populateSubScene(o);
        updateHierarchy();
        setStatus('Sous-scène rechargée depuis la source', 2000);
      } },
    { type: 'action', ids: ['btn-ss-reset'], label: '⟲ Réinitialiser l\'instance',
      help: 'Oublie les modifications locales et reprend la source',
      // Rien à réinitialiser sans override : le bouton reste visible et dit pourquoi il dort.
      enabled: function(o){ return countOverrides(o) > 0; },
      run: function(o){ resetSubScene(o); } },
    { type: 'action', ids: ['btn-ss-unique'], label: '✂ Rendre unique',
      help: 'Le contenu devient des objets normaux, indépendants de la scène source',
      run: function(o){ renderUniqueSubScene(o); } },
    { type: 'note',
      text: 'Les objets générés se déplacent librement : leurs écarts sont enregistrés comme '
          + 'overrides et survivent au rechargement de la source.' }
  ]}]
};
