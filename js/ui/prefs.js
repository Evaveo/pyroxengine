// ---------- Les PRÉFÉRENCES D'ÉDITEUR ----------
//
// Un réglage de PROJET voyage avec le projet (`project.settings`) : deux personnes qui ouvrent
// le même projet doivent obtenir le même jeu. Une PRÉFÉRENCE est le contraire — elle appartient
// à la machine et à la personne, et ne doit jamais partir dans un fichier de projet. Rien ne
// disait laquelle était laquelle : elles se mélangeaient dans huit clés `localStorage` nues,
// écrites depuis six fichiers, sans registre ni valeur par défaut déclarée.
//
// PREFS EST LA SEULE SOURCE D'ÉCRITURE ; LES CLÉS NUES RESTENT LISIBLES pendant au moins un
// cycle de version. Trois raisons mesurées, et non une précaution de principe :
//
//   1. la clé API du copilote est lue DIRECTEMENT dans `localStorage` à six endroits
//      (copilot.js) — un import qui supprimerait la clé nue la retirerait sous leurs pieds ;
//   2. deux onglets de l'éditeur partagent le même `localStorage` sans aucune synchronisation.
//      Supprimer après import, c'est effacer ce que l'onglet d'à côté vient d'écrire ;
//   3. l'éditeur tourne en local, sans déploiement atomique : une version antérieure rouverte
//      ensuite ne trouverait plus rien.
//
// La suppression des clés nues est donc la décision d'une version ULTÉRIEURE, annoncée dans un
// ChangeLog. La contrepartie de la non-suppression est l'écouteur `storage` en bas de ce
// fichier : quand un autre onglet écrit, on recharge.

export const PREFS_STORAGE_KEY = 'moteur3d-preferences';

// Le registre : `key -> {key, label, type, default, category, options}`. Alimenté par
// `Prefs.define` — ici pour les préférences de l'éditeur, et par `Editor.definePref` pour
// celles d'un plugin.
export const PREFS_REGISTRY = new Map();

// Les valeurs par défaut, dérivées du registre. Un objet et non une Map : c'est ce que
// `importBareKeys` rend, et ce qu'un test compare.
export const PREFS_DEFAULT = {};

/**
 * Les clés NUES reprises à l'import, et où elles vont.
 *
 * `json: true` dit que la valeur stockée est du JSON à relire. Une valeur illisible ne fait pas
 * échouer l'import : elle retombe sur le défaut, et les autres clés passent quand même — un
 * `moteur3d-plugins` corrompu ne doit pas coûter la clé API.
 */
export const PREFS_BARE_KEYS = [
  { bare: 'copilot-key',          key: 'copilot.key' },
  { bare: 'copilot-modele',       key: 'copilot.model' },
  { bare: 'copilot-fournisseur',  key: 'copilot.provider' },
  { bare: 'copilot-url',          key: 'copilot.url' },
  { bare: 'moteur3d-plugins',     key: 'plugins.actifs',   json: true },
  { bare: 'moteur3d-nommage',     key: 'textures.naming',  json: true },
  { bare: 'moteur3d-layout',      key: 'dock.layout',      json: true }
];

// CE QUI N'EST PAS UNE PRÉFÉRENCE, et ne doit donc jamais entrer ici :
//
//   - `jeu3d:*` — les SAUVEGARDES des joueurs (scripts.js). Les importer les exposerait à une
//     fenêtre de préférences, où un clic les effacerait ;
//   - `window:*` — la géométrie des fenêtres flottantes (windows.js). Une par fenêtre, créée à
//     la volée : un registre à clés déclarées ne sait pas les énumérer. Elles restent nues ;
//   - `recents` — les projets récents vivent en IndexedDB (recents.js) : ce sont des
//     `FileSystemDirectoryHandle`, non sérialisables en JSON, et Prefs n'accepte que du JSON.
export const PREFS_IGNORED_PREFIXES = ['jeu3d:', 'window:'];
export const PREFS_IGNORED_KEYS = ['recents'];

/** Déclare une préférence. Rejouable : redéclarer la même clé remplace sa description. */
export function definePrefEntry(def){
  if(!def || !def.key) throw new Error('définir une préférence : `key` est obligatoire');
  PREFS_REGISTRY.set(def.key, def);
  PREFS_DEFAULT[def.key] = def.default;
  return def;
}

/**
 * Reprend les clés nues d'un dictionnaire `{clé: chaîne}` et rend les préférences.
 *
 * PURE : elle reçoit un dictionnaire, elle ne touche pas `localStorage`, et elle ne SUPPRIME
 * rien — elle ne reçoit même pas de quoi le faire. C'est ce qui la rend testable, et c'est
 * aussi ce qui l'empêche de commettre l'effacement décrit en tête de fichier.
 */
export function importBareKeys(readAll){
  const source = readAll || {};
  const out = {};
  Object.keys(PREFS_DEFAULT).forEach(function(k){
    out[k] = (PREFS_DEFAULT[k] === undefined) ? null
           : JSON.parse(JSON.stringify(PREFS_DEFAULT[k]));
  });
  // Ce que la version précédente a déjà écrit dans la clé unique gagne sur les clés nues : il
  // est plus récent, par construction.
  let stored = null;
  try { stored = JSON.parse(source[PREFS_STORAGE_KEY] || 'null'); } catch(e){ stored = null; }

  PREFS_BARE_KEYS.forEach(function(m){
    const brut = source[m.bare];
    if(brut === undefined || brut === null) return;
    if(!m.json){ out[m.key] = brut; return; }
    try { out[m.key] = JSON.parse(brut); }
    catch(e){ /* valeur illisible : le défaut reste, et l'import continue */ }
  });

  if(stored && typeof stored === 'object'){
    Object.keys(stored).forEach(function(k){
      if(PREFS_IGNORED_KEYS.indexOf(k) !== -1) return;
      if(PREFS_IGNORED_PREFIXES.some(function(p){ return k.indexOf(p) === 0; })) return;
      out[k] = stored[k];
    });
  }
  return out;
}

/**
 * Le registre vivant.
 *
 * Une SEULE clé `localStorage`, en `try/catch` : en navigation privée tout fonctionne, rien
 * n'est retenu — même règle que `windows.js`. Un `localStorage` indisponible n'est pas une
 * erreur d'éditeur.
 */
export const Prefs = {
  values: null,

  define(def){ return definePrefEntry(def); },

  /** Les descriptions déclarées, dans l'ordre de déclaration. */
  all(){ return Array.from(PREFS_REGISTRY.values()); },

  /** Les préférences d'une catégorie — ce qu'une section de la fenêtre Préférences affiche. */
  byCategory(category){
    return this.all().filter(function(d){ return d.category === category; });
  },

  /** Relit tout depuis le stockage. Appelée au démarrage, et quand un autre onglet écrit. */
  load(){
    const brut = {};
    try {
      for(let i = 0; i < localStorage.length; i++){
        const k = localStorage.key(i);
        brut[k] = localStorage.getItem(k);
      }
    } catch(e){ /* mode privé : on repart des défauts */ }
    this.values = importBareKeys(brut);
    return this.values;
  },

  /**
   * Réalise l'effet d'une préférence.
   *
   * Une préférence sans `apply` est une préférence que quelqu'un LIT au moment de s'en servir
   * (la clé API du copilote, l'intervalle d'autosauvegarde) ; une préférence avec `apply` change
   * quelque chose tout de suite (le thème, la densité). Les deux sont légitimes ; les mélanger
   * dans un `switch` unique aurait fait de ce fichier le carrefour de tout l'éditeur.
   */
  apply(key){
    const d = PREFS_REGISTRY.get(key);
    if(d && typeof d.apply === 'function'){
      try { d.apply(this.get(key)); }
      catch(e){ /* une préférence de plugin ne doit pas casser le démarrage */ }
    }
  },

  /** Applique TOUTES les préférences. Appelée au démarrage, et après un rechargement. */
  applyAll(){
    if(!this.values) this.load();
    PREFS_REGISTRY.forEach((d) => this.apply(d.key));
  },

  get(key){
    if(!this.values) this.load();
    const v = this.values[key];
    if(v !== undefined && v !== null) return v;
    const d = PREFS_REGISTRY.get(key);
    return d ? d.default : undefined;
  },

  set(key, value){
    if(!this.values) this.load();
    this.values[key] = value;
    // L'EFFET, tout de suite. Une préférence qui ne s'applique qu'au prochain démarrage donne
    // l'impression de n'avoir rien fait, et on la règle deux fois.
    this.apply(key);
    try { localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(this.values)); }
    catch(e){ /* mode privé : la valeur vit le temps de la session */ }
    // La clé nue est écrite AUSSI, tant qu'elle est lue ailleurs. C'est le prix de la
    // non-suppression : une seule source d'écriture pour l'utilisateur, deux emplacements sur
    // le disque, le temps d'un cycle de version.
    const m = PREFS_BARE_KEYS.find(function(x){ return x.key === key; });
    if(m){
      try {
        localStorage.setItem(m.bare, m.json ? JSON.stringify(value) : String(value));
      } catch(e){ /* mode privé */ }
    }
    return value;
  }
};


// ---------- Les préférences de l'éditeur ----------
//
// Déclarées ICI et nulle part ailleurs : c'est cette table qui remplit la fenêtre Préférences,
// et c'est aussi elle qui dit ce qu'une clé vaut quand elle n'a jamais été réglée. Une
// préférence non déclarée n'existe pas — elle n'a ni libellé, ni défaut, ni place à l'écran.

// Apparence.
// UN SEUL THÈME AUJOURD'HUI, et la liste le dit. Proposer « Clair » et « Comme le système »
// alors qu'aucune palette claire n'existe (la passe Claude Design est bloquée, voir le plan du
// lot 4) donnerait un réglage qui ne fait rien — le pire des retours. La clé et l'attribut
// `data-theme` existent déjà : le jour où la palette arrive, elle se branche ici et les deux
// options rejoignent cette liste.
definePrefEntry({ key: 'ui.theme', label: 'Thème', type: 'choice', category: 'Apparence',
  options: [['sombre', 'Sombre']],
  default: 'sombre',
  apply: function(v){
    if(typeof document === 'undefined' || !document.documentElement) return;
    document.documentElement.setAttribute('data-theme', v || 'sombre');
  } });
// La DENSITÉ, pas une taille de police : elle pilote un axe complet (hauteur de ligne, marges,
// taille des champs) au lot 4. Un seul réglage, parce que trois réglages indépendants
// laisseraient composer des interfaces cassées.
definePrefEntry({ key: 'ui.density', label: 'Densité', type: 'choice', category: 'Apparence',
  options: [['compacte', 'Compacte'], ['normale', 'Normale'], ['confortable', 'Confortable']],
  default: 'normale',
  // L'axe de densité est un ATTRIBUT sur <html>, et tokens.css y répond en changeant quatre
  // espacements et une taille de police. Rien d'autre : une densité qui toucherait aussi aux
  // couleurs ou à la mise en page serait une seconde feuille de style à maintenir.
  apply: function(v){
    if(typeof document === 'undefined' || !document.documentElement) return;
    document.documentElement.setAttribute('data-density', v || 'normale');
  } });

// La grille de sol est un GIZMO d'édition : une préférence de machine, pas un réglage de
// projet — elle ne doit pas décider de ce que voit quelqu'un d'autre qui ouvre le projet.
definePrefEntry({ key: 'grid.visible', label: 'Grille de sol', type: 'checkbox',
  category: 'Apparence', default: true,
  help: "La grille suit la caméra et change de pas avec l'éloignement : elle n'a pas de bord." });

// Navigation et manipulation.
definePrefEntry({ key: 'nav.speed', label: 'Vitesse de navigation', type: 'number',
  category: 'Navigation', min: 0.1, max: 10, step: 0.1, default: 1 });
definePrefEntry({ key: 'gizmo.step', label: 'Pas du gizmo (unités)', type: 'number',
  category: 'Navigation', min: 0, max: 10, step: 0.05, default: 0,
  help: 'Zéro = déplacement continu. Une valeur aimante le déplacement sur une grille.' });

// Travail.
definePrefEntry({ key: 'autosave.enabled', label: 'Autosauvegarde', type: 'checkbox',
  category: 'Travail', default: true });
definePrefEntry({ key: 'autosave.interval', label: 'Intervalle (minutes)', type: 'number',
  category: 'Travail', min: 1, max: 60, step: 1, default: 5 });

// La synchronisation du dossier de projet. Elle est ACTIVE par défaut, parce que l'attente
// inverse — poser un fichier dans le dossier et ne rien voir — est celle qui surprend. Le
// réglage existe pour le cas où le dossier vit sur un disque lent ou un partage réseau, où
// relire l'arborescence en boucle se paie.
definePrefEntry({ key: 'folderWatch.enabled', label: 'Synchroniser le dossier de projet',
  category: 'Travail', type: 'checkbox', default: true,
  help: 'Un fichier ajouté, modifié ou supprimé dans le dossier du projet est repris '
      + "automatiquement par l'éditeur. La scène en cours d'édition, elle, n'est jamais relue." });

// Copilote. La clé API est une PRÉFÉRENCE et jamais un réglage de projet : elle ne doit
// pas partir dans un fichier de projet partagé.
definePrefEntry({ key: 'copilot.key', label: 'Clé API', type: 'text', category: 'Copilote',
  default: '' });
definePrefEntry({ key: 'copilot.model', label: 'Modèle', type: 'text', category: 'Copilote',
  default: '' });
definePrefEntry({ key: 'copilot.provider', label: 'Fournisseur', type: 'text',
  category: 'Copilote', default: '' });
definePrefEntry({ key: 'copilot.url', label: 'URL (fournisseur compatible)', type: 'text',
  category: 'Copilote', default: '' });

// Extensions et rôles de nommage. Ces deux-là ne s'éditent pas champ par champ dans la
// fenêtre : elles ont leurs propres écrans. Elles sont déclarées pour avoir un défaut et une
// place dans l'import, pas pour être affichées.
definePrefEntry({ key: 'plugins.actifs', label: 'Extensions actives', type: 'hidden',
  category: 'Extensions', default: [] });
definePrefEntry({ key: 'textures.naming', label: 'Rôles de nommage de texture', type: 'hidden',
  category: 'Extensions', default: null });

// L'agencement du dock (lot 1b) et l'état de repli des sections d'inspecteur. Ni l'un ni
// l'autre ne se règle : ils s'observent. Ils vivent ici pour que l'éditeur n'ait qu'UN endroit
// où écrire dans `localStorage`.
definePrefEntry({ key: 'dock.layout', label: 'Agencement des panneaux', type: 'hidden',
  category: 'Interface', default: null });
definePrefEntry({ key: 'sections.collapsed', label: 'Sections repliées', type: 'hidden',
  category: 'Interface', default: {} });
// La position de la palette d'outils sur le viewport, en pixels : `{x, y}`. Même nature que
// `dock.layout` — elle ne se règle pas, elle se constate. `null` tant qu'on n'a jamais déplacé
// la palette ; js/ui/floating-palette.js la BORNE à la relecture, parce qu'une position tenue
// pour acquise est une palette hors écran dès qu'on change la taille de la fenêtre.
definePrefEntry({ key: 'palette.position', label: 'Position de la palette d\'outils',
  type: 'hidden', category: 'Interface', default: null });

// La RACINE DISQUE de chaque projet, indexée par le dossier ouvert : `{clé: 'E:\Jeux\MonJeu'}`.
// Le navigateur ne la connaît PAS — l'API File System Access ne donne jamais de chemin absolu,
// par conception — donc on la demande UNE fois, au premier « copier le chemin complet », et on
// la retient. Préférence de MACHINE et non réglage de projet, à dessein : le même projet n'est
// pas au même endroit chez deux personnes, et une racine qui voyagerait dans le `.p3d` serait
// fausse chez la seconde.
definePrefEntry({ key: 'project.rootsDisk', label: 'Racines des projets sur ce disque',
  type: 'hidden', category: 'Projet', default: {} });

// Un autre onglet a écrit : on recharge. Sans ça, deux onglets ouverts se marchent dessus en
// silence — le second à fermer écrase les réglages du premier.
addEventListener('storage', function(e){
  if(!e || !e.key) return;
  if(e.key !== PREFS_STORAGE_KEY
     && !PREFS_BARE_KEYS.some(function(m){ return m.bare === e.key; })) return;
  Prefs.load();
  Prefs.applyAll();
});
