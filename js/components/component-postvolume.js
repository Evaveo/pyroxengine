// moteur/js/components/component-postvolume.js
//
// Un volume de post-traitement, façon Unity Volume : global (s'applique partout) ou local
// (une zone box/sphere), référence un profil réutilisable (js/post-profile.js) par id.
// Le mélange entre plusieurs PostVolume actifs vit dans js/post-volume-blend.js — ce
// composant ne fait que porter les données, comme Collider (js/components/component-collider.js).
// Valeurs par défaut du composant. Fonction (pas un objet partagé) pour que chaque appel
// obtienne son propre `size` : deux instances ne doivent jamais partager la même référence.
import { Registry } from '../component-registry.js';
import { Component, detachData } from '../component.js';
import { createAssetPostProfile, ensurePostProfileDefaults } from '../post-profile.js';

export function postVolumeDefaults() {
  return {
    profileId: null,
    global: true,
    shape: 'box',
    size: {x:10, y:10, z:10},
    radius: 5,
    blendDistance: 2,
    priority: 0
  };
}

export class PostVolume extends Component {
  constructor(node, opts) {
    super(node);
    const defaults = postVolumeDefaults();
    const size = Object.assign(defaults.size, (opts || {}).size);
    this.data = Object.assign(defaults, opts || {});
    this.data.size = size;
  }

  hydrate(d) {
    if (!d) return;
    const defaults = postVolumeDefaults();
    const size = Object.assign(defaults.size, (d || {}).size);
    this.data = Object.assign(defaults, d);
    this.data.size = size;
  }

  // Le profil référencé, ou null (aucun profil choisi, ou asset supprimé du projet) — même
  // politique que Model.asset (component-model.js:56-62), jamais d exception.
  //
  // DEUX MONDES, un seul composant : l'éditeur porte le tableau global `assets`, le jeu publié
  // n'a que la table `assetsById` de game-runtime.js. Ne regarder que `assets` renvoyait donc
  // TOUJOURS null dans le jeu publié — les profils n'y ont jamais rien appliqué, en silence.
  get profile() {
    const id = this.data.profileId;
    if (!id) return null;
    // LES DEUX TABLES SONT ESSAYÉES, DANS CET ORDRE, ET LA PREMIÈRE N EST PAS EXCLUSIVE.
    // Choisir la table sur la seule EXISTENCE de `assets` était faux : il suffit qu'un
    // `assets` (vide, ou d'une autre nature) traîne dans la page de jeu pour que la
    // résolution s arrête là et rende null — mesuré, `profile: false` dans le jeu publié
    // alors que le volume et son profil étaient tous deux présents.
    if (typeof assets !== 'undefined' && assets && typeof assets.find === 'function') {
      const found = assets.find((a) => a && a.id === id && a.kind === 'postProfile');
      if (found) return found;
    }
    if (typeof assetsById !== 'undefined' && assetsById) {
      const a = assetsById[id];
      if (a && a.kind === 'postProfile') return a;
    }
    return null;
  }

  onAdd() {
    // Pré-remplissage UNIQUEMENT pour le premier volume GLOBAL posé sur une scène qui a un
    // env.post.active encore vrai : au-delà, l ajout d un volume est un geste déliberé
    // (env.post reste dans le fichier de scène, juste plus lu — voir
    // docs/superpowers/specs/2026-09-03-postvolume-profiles-design.md, section 4). Sans ce
    // pré-remplissage, poser un premier volume vide pour "essayer" effacerait silencieusement
    // tout le post-traitement déjà réglé.
    if (!this.data.global || this.data.profileId) return;
    if (typeof env === 'undefined' || !env.post || !env.post.active) return;
    if (Registry.active('PostVolume').length > 0) return;
    const a = createAssetPostProfile();
    const p = env.post;
    a.effects = ensurePostProfileDefaults({
      bloom: {overridden: true, threshold: p.bloomThreshold, intensity: p.bloomIntensity, radius: p.bloomRadius},
      vignette: {overridden: true, amount: p.vignette},
      grain: {overridden: true, amount: p.grain},
      toneMapping: {overridden: true, mode: p.toneMapping},
      colorGrading: {overridden: true, contrast: p.contraste, saturation: p.saturation, temperature: p.temperature, exposure: p.exposition}
    });
    this.data.profileId = a.id;
  }

  onActiveChange(active) {
    updatePostVolumeViz();
  }

  onRemove() {
    removePostVolumeViz(this.node);
  }

  // `hydrate` : le SEUL point de relecture (contrat de component.js, règle 2). Le constructeur
  // fusionnait les défauts lui-même, donc une instance déjà posée puis relue depuis le fichier
  // par `applyComponents` gardait ses défauts.
  hydrate(d){
    if(!d) return;
    const size = Object.assign({}, this.data.size, d.size);
    this.data = Object.assign({}, this.data, d);
    this.data.size = size;
  }

  // DÉTACHÉES (contrat de component.js, règle 4) : rendre `this.data` laissait un appelant muter
  // le volume en mutant le résultat.
  serialize() { return detachData(this.data); }

  static get typeName() { return 'PostVolume'; }
  static get description(){ return 'Zone de post-traitement'; }
  static get icon(){ return Icons.html('aperture') + ' '; }
  static get category() { return 'Rendu'; }
}

Registry.registerClass(PostVolume);
