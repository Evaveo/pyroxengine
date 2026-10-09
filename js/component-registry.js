// ---------- Registre des composants et porteurs de nœud ----------
//
// CE FICHIER EST SORTI DE js/component.js, et il ne dépend de RIEN. C'est tout son intérêt : un
// module sans import s'évalue toujours en premier. Tant que `Registry` et `NodeShells` vivaient
// dans `component.js`, dix fichiers les lisaient au PREMIER NIVEAU pour s'y inscrire
// (`Registry.registerClass(Camera)`, `NodeShells.register('Particles', …)`) alors que
// `component.js`, pris dans un cycle d'imports, pouvait s'évaluer APRÈS eux. En portée globale,
// l'ordre des <script> masquait le problème ; en modules ES, c'étaient dix ReferenceError de zone
// morte temporelle au démarrage, avant le premier pixel. Mesurable par
// `node outils/esm.mjs --risques`.
//
// Rien d'autre n'a changé : les deux objets sont déplacés tels quels, avec leurs commentaires.

// ---------------------------------------------------------------------------
// NodeShells : comment construire l'Object3D d'un nœud, selon ce qu'il porte.
//
// Un nœud est un Group nu, et ce sont ses composants qui lui donnent sa nature — sauf quand
// l'un d'eux réclame un PORTEUR particulier : un maillage a besoin d'un THREE.Mesh, un terrain
// d'une géométrie de terrain, un modèle importé d'un clone de son asset.
//
// C'est ce qui remplace la cascade « if(type === 'mesh') … else if(type === 'camera') … » qui
// vivait en DEUX exemplaires — une dans la sérialisation de l'éditeur, une dans le jeu publié —
// et qui obligeait le format de projet à stocker le type de chaque nœud.
//
// Deux environnements, deux jeux de porteurs, et c'est le seul endroit où ils divergent :
// l'éditeur donne à une lumière son repère visible et à une caméra son boîtier, le jeu publié
// n'embarque ni l'un ni l'autre (un Object3D nu suffit, le composant y accroche sa THREE.Light).
// Chacun enregistre les siens ; le code de reconstruction, lui, est partagé.
export const NodeShells = {
  byComponent: new Map(),

  register(typeName, build) {
    this.byComponent.set(typeName, build);
  },

  // Le porteur réclamé par le premier composant qui en veut un, ou null si aucun — le nœud sera
  // alors un Group nu. Rend {object3d, missing} : « missing » nomme le composant qui voulait
  // construire et n'a pas pu (un modèle dont l'asset a disparu), pour que l'appelant le dise au
  // lieu de faire disparaître le nœud en silence.
  make(list, ctx) {
    const entries = list || [];
    // L'AMBIGUÏTÉ EST DITE, plus tranchée en silence.
    //
    // Cette boucle rend le porteur du PREMIER composant qui en réclame un. Tant qu'un nœud n'en
    // a qu'un, c'est sans conséquence. Mais les deux moteurs n'enregistrent pas les mêmes
    // porteurs — l'éditeur en a huit (Mesh, Light, Camera, Model, Terrain, Particles,
    // Reflection, SubScene), le jeu publié trois (Mesh, Terrain, Model) — si bien qu'un nœud
    // sérialisé `components: [Reflection, Mesh]` donne une sonde dans l'éditeur et un maillage
    // dans le jeu. L'ORDRE du tableau du fichier devenait sémantique, sans que rien ne le
    // déclare ni ne le garde. Voir docs/REVUE_2026-09-10.md § 3.5.
    //
    // On ne peut pas trancher ici (les deux porteurs sont légitimes, c'est le NŒUD qui est
    // ambigu), mais on peut refuser de le taire : le premier gagne toujours, et le second est
    // NOMMÉ. Un avertissement se lit ; une divergence éditeur/jeu ne se voit qu'après export.
    let choisi = null;
    const autres = [];
    for (let i = 0; i < entries.length; i++) {
      const cd = entries[i];
      const build = (cd && cd.type) ? this.byComponent.get(cd.type) : null;
      if (!build) continue;
      if (choisi) { autres.push(cd.type); continue; }
      choisi = { cd: cd, build: build };
    }
    if (autres.length && typeof console !== 'undefined' && console.warn) {
      console.warn('NodeShells : « ' + choisi.cd.type + ' » construit le porteur de ce nœud, et '
        + autres.join(', ') + ' en réclamai' + (autres.length > 1 ? 'ent' : 't')
        + ' un aussi — un seul peut gagner, et ce n\'est PAS forcément le même dans le jeu publié '
        + '(il n\'y enregistre que Mesh, Terrain et Model).');
    }
    if (!choisi) return { object3d: null, missing: null };
    const o = choisi.build(choisi.cd.data || {}, ctx || {});
    return o ? { object3d: o, missing: null } : { object3d: null, missing: choisi.cd.type };
  }
};

// ---------------------------------------------------------------------------
// Registry : index vivant des instances de composants, par type.
//
// C'est le point d'entrée des Systèmes. Avant, il était alimenté par
// add/removeComponent et JAMAIS relu : les systèmes rescannaient le tableau
// global `objects` en filtrant sur des sacs `userData` (`objets.filter(o =>
// o.userData.phys && o.userData.phys.active)`), c'est-à-dire un balayage linéaire
// de toute la scène pour trouver quelques entités — exactement ce que cet index
// existe pour éviter. Il fuyait aussi : rien ne le purgeait au changement de
// scène ni à la suppression d'un objet, donc il accumulait indéfiniment des
// instances mortes. Les deux sont réglés ici (API de lecture + clear/unregister).
export const Registry = {
  byType: new Map(),          // typeName -> Set<instance>
  registeredClasses: [],     // ordre d'enregistrement (popup « + Component »)
  classesByType: new Map(),   // typeName -> classe (recherche O(1))

  register(instance) {
    const t = instance.constructor.typeName;
    let set = this.byType.get(t);
    if (!set) { set = new Set(); this.byType.set(t, set); }
    set.add(instance);
  },

  unregister(instance) {
    const set = this.byType.get(instance.constructor.typeName);
    if (set) set.delete(instance);
  },

  // Retire de l'index TOUS les composants d'un Noeud, sans jouer leur
  // onRemove() : appelé par removeSceneObject (objects.js) quand l'objet est
  // détruit en entier. Voir le commentaire plus bas pour le pourquoi du « sans ».
  unindexNode(node) {
    const list = node && node.userData && node.userData.components;
    if (!list || !list.length) return;
    list.forEach((c) => { if (c && c.constructor) this.unregister(c); });
  },

  // Purge totale — appelée à chaque changement de scène (newScene,
  // restoreState) : ces chemins vident `objects` d'un coup sans passer par
  // removeComponent, et sans ça l'index gardait des instances de la scène
  // précédente, que les Systèmes itéreraient ensuite sur des objets détruits.
  clear() {
    this.byType.forEach((set) => set.clear());
  },

  registerClass(classe) {
    const typeName = classe.typeName;
    // idempotent : recharger un plugin (ou rejouer un fichier de composant dans
    // un test) ne doit pas produire deux entrées dans le popup « + Component »
    if (this.classesByType.has(typeName)) {
      this.registeredClasses = this.registeredClasses.filter((c) => c.typeName !== typeName);
    }
    this.registeredClasses.push({ typeName: typeName, category: classe.category, classe: classe });
    this.classesByType.set(typeName, classe);
    return classe;
  },

  classByType(typeName) {
    return this.classesByType.get(typeName) || null;
  },

  /** Les classes qui savent fabriquer un nœud à elles seules (voir `Component.creatable`). */
  classesCreatable() {
    const out = [];
    this.classesByType.forEach(function(classe, typeName) {
      const c = classe.creatable;
      if (c) out.push(Object.assign({ typeName: typeName }, c));
    });
    return out;
  },

  // ---- Lecture, pour les Systèmes ----

  // Toutes les instances de ce type, y compris inactives et hors scène.
  instances(typeName) {
    return this.byType.get(typeName) || SET_EMPTY;
  },

  count(typeName) {
    const set = this.byType.get(typeName);
    return set ? set.size : 0;
  },

  // Itère les instances ACTIVES dont le Noeud est vivant dans la scène courante.
  //
  // Le filtre de vivacité n'est pas cosmétique : un composant peut être attaché
  // à un Noeud qui n'appartient pas (ou plus) à la scène — un template de
  // prefab, un modèle en cours d'import, une racine détachée. `isSceneObject`
  // (objects.js) répond en O(1) via un Set maintenu avec `objects`.
  eachActive(typeName, fn) {
    const set = this.byType.get(typeName);
    if (!set) return;
    set.forEach((c) => {
      if (c.active === false) return;
      if (!isObjectOfSceneOrUnknown(c.node)) return;
      fn(c, c.node);
    });
  },

  // Même filtre, mais rend un tableau — pour les appelants qui doivent trier,
  // compter ou parcourir plusieurs fois (démarrage d'une simulation physique).
  active(typeName) {
    const result = [];
    this.eachActive(typeName, (c) => result.push(c));
    return result;
  },

  // Les Noeuds portant ce composant et VIVANTS, actifs ou non.
  //
  // À utiliser quand le Système doit continuer à s'occuper d'une entité
  // désactivée au lieu de l'ignorer : un émetteur de particules qu'on décoche
  // arrête d'ÉMETTRE, mais les particules déjà en vol doivent finir leur course
  // et mourir. `activeNodes` le gèlerait en l'air.
  liveNodes(typeName) {
    const set = this.byType.get(typeName);
    if (!set) return [];
    const vus = new Set();
    set.forEach((c) => {
      if (isObjectOfSceneOrUnknown(c.node)) vus.add(c.node);
    });
    return Array.from(vus);
  },

  // Les Noeuds portant ce composant, active et vivant, sans doublon.
  activeNodes(typeName) {
    const vus = new Set();
    this.eachActive(typeName, (c, node) => vus.add(node));
    return Array.from(vus);
  },

  /**
   * Les nœuds de `list` qui portent AU MOINS UN des composants nommés — dans l'ordre de `list`.
   *
   * POURQUOI CETTE FORME. Plusieurs systèmes parcourent la scène ENTIÈRE à chaque image pour
   * n'y trouver, la plupart du temps, personne : le monde 2D et le tri par profondeur 2D
   * coûtaient ensemble 2,6 ms par image sur une scène de 5 000 objets qui n'a pas une seule
   * pièce 2D. Le registre sait en O(1) que ces composants n'existent pas.
   *
   * L'ORDRE DE `list` EST PRÉSERVÉ, et ce n'est pas de la coquetterie : l'ordre des obstacles
   * décide des égalités dans le solveur 2D. Rendre les nœuds dans l'ordre du registre aurait
   * changé silencieusement la résolution de certaines collisions.
   *
   * Sans registre — un harnais de test qui ne monte pas la couche composants — on rend `list`
   * telle quelle : un index absent ne doit jamais faire disparaître des objets.
   */
  nodesCarrying(list, typeNames) {
    if (!this.byType) return list || [];
    const names = typeNames || [];
    // UN NOM DE TYPE FAUX NE DOIT PAS FAIRE DISPARAÎTRE LE SYSTÈME QUI L'A DEMANDÉ.
    //
    // Écrit `'Sprite'` au lieu de `'SpriteRenderer'` et cette fonction rendrait une liste vide :
    // le tri par profondeur 2D cesserait de tourner, sans erreur et sans rien à l'écran pour le
    // dire. C'est arrivé à la première version de cet appel, et c'est la famille de défauts la
    // plus coûteuse de ce dépôt. On retombe donc sur la liste complète — lent, et juste — et
    // l'on dit pourquoi, une fois.
    if (this.classesByType.size) {
      const inconnu = names.find((t) => !this.classesByType.has(t));
      if (inconnu) {
        if (!this._warnedCarrying) this._warnedCarrying = new Set();
        if (!this._warnedCarrying.has(inconnu)) {
          this._warnedCarrying.add(inconnu);
          if (typeof console !== 'undefined') {
            console.warn('[Registry] nodesCarrying : composant inconnu « ' + inconnu
              + ' » — parcours complet de la scène en repli.');
          }
        }
        return list || [];
      }
    }
    const vus = new Set();
    names.forEach((t) => {
      const set = this.byType.get(t);
      if (set) set.forEach((c) => { if (isObjectOfSceneOrUnknown(c.node)) vus.add(c.node); });
    });
    // LE CAS QUI PAIE : aucun de ces composants dans la scène, donc rien à parcourir du tout.
    if (!vus.size) return [];
    return (list || []).filter((o) => vus.has(o));
  }
};

export const SET_EMPTY = new Set();

// `isSceneObject` vit dans objets.js, chargé AVANT ce fichier dans
// editor.html — mais pas dans les harnais de test qui ne montent que la couche
// composants, ni dans le runtime du jeu, qui a son propre tableau d'objets.
// Absent, on ne filtre pas : un index sans notion de scène vaut mieux qu'un
// index vide (le comportement d'avant ce lot).
export function isObjectOfSceneOrUnknown(node) {
  if (typeof isSceneObject !== 'function') return true;
  return isSceneObject(node);
}

// `const` déclaré au niveau global d'un <script> ne crée pas de propriété sur `window`
// (contrairement à `var`/`function`) : on l'expose donc explicitement, comme le faisait
// `component.js` avant l'extraction.
if (typeof globalThis !== 'undefined') {
  globalThis.Registry = Registry;
}
