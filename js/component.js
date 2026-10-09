// moteur/js/component.js
// Classe de base de tous les composants, et le Registry qui les indexe.
//
// CONTRAT (à respecter par toute nouvelle sous-classe) :
//
//   1. Le constructeur reçoit `(node, data)` et ne fait que poser des champs.
//      Il ne touche NI la scène, NI le DOM, NI un autre sous-système.
//   2. `hydrate(data)` relit les champs sérialisés. C'est le SEUL point de
//      relecture : `restore()` est FINAL et ne doit plus être surchargé (voir
//      plus bas — la surcharger était la cause du `restaurerActif` à recopier
//      dans chaque sous-classe).
//   3. `onAdd()` branche le composant sur le monde (crée la lumière THREE,
//      pose la géométrie…). Appelé une fois attaché ET indexé.
//   4. `serialize()` renvoie des données PURES et détachées. Pas de référence
//      vers un sac `userData` vivant : un appelant qui mute le résultat ne doit
//      pas pouvoir muter l'état du jeu.
//   5. AUCUN HTML, AUCUN `document.*`. La présentation vit dans
//      `js/component-views.js` (voir `ComponentViews.register`).
// ---------------------------------------------------------------------------
// LE PATRON DES COMPOSANTS ADOSSÉS À UN SAC `userData`, écrit une fois.
//
// (Ces deux helpers vivent ICI et pas dans component-data.js : toute page ou tout harnais qui
//  peut porter un composant charge forcement component.js — les composants en heritent. Les
//  y mettre garantit leur presence partout ou un `serialize()` peut etre appele.)
//
// Une douzaine de composants (Physics, Collider, AudioSource, AnimatorController, UIDocument,
// SpriteRenderer, SpriteAnimator, Rigidbody2D…) rangent leurs réglages dans un sac
// `userData.X` que d'autres sous-systèmes lisent directement. Ils recopiaient tous la même
// séquence à la main, et pas tous de la même façon — d'où deux défauts que ces deux helpers
// ferment (voir docs/REVUE_2026-09-10.md § 3.2 et § 3.3) :
//
//  1. `onAdd()` faisait `this.data = ensureX(node)`, ce qui JETTE les données reçues quand le sac
//     n'existe pas encore. `addComponent('Physics', {mass: 5})` rendait un corps aux valeurs par
//     défaut, en silence. Ça ne se voyait pas parce que le format de projet écrit AUSSI le sac à
//     plat, et que la reconstruction le pose avant les composants : la seule source qui marchait
//     était la redondance du fichier.
//  2. `serialize()` rendait le sac VIVANT, alors que le contrat de `component.js` (règle 4) exige
//     des données pures et détachées. Un appelant qui mutait le résultat mutait l'état du jeu.
export function mergeIntoBag(bag, received){
  if(!bag || !received || received === bag) return bag;
  Object.keys(received).forEach(function(k){ bag[k] = received[k]; });
  return bag;
}

/** Une copie DÉTACHÉE de données de composant — contrat de `component.js`, règle 4. */
export function detachData(d){
  if(d === null || d === undefined) return d;
  return JSON.parse(JSON.stringify(d));
}

export class Component {
  constructor(node) {
    this.node = node;
    this.active = true;
  }

  // Posé par les composants "définissant un type" (Mesh, Light, Camera,
  // Terrain, Particles, Reflection) sur un Noeud « Vide » (userData.type ===
  // 'group') pour que les systèmes historiques keyés sur userData.type
  // (game-runtime.js, subscenes.js…) le reconnaissent. Ne retague que depuis
  // 'group' : si un autre composant définissant un type est déjà présent, son
  // tag est conservé (limitation connue — un seul de ces composants peut
  // définir userData.type à la fois sur un même Noeud).
  //
  // Les SYSTÈMES de l'éditeur, eux, n'en dépendent plus : ils interrogent le
  // Registry par type de composant (voir Registry.liveNodes / Registry.activeNodes).
  markType(type) {
    if (this.node.userData.type === 'group') this.node.userData.type = type;
  }

  onAdd() {}
  onRemove() {}
  onActiveChange(active) {}

  // Données pures et détachées (règle 4 ci-dessus).
  serialize() { return {}; }

  // Relecture des champs sérialisés (règle 2 ci-dessus).
  hydrate(data) {}

  // this.noeud est une référence circulaire vers l'Object3D porteur (qui la
  // détient lui-même dans userData.components) : Object3D.prototype.copy() de
  // THREE clone userData via JSON.parse(JSON.stringify(...)) et planterait
  // dessus (TypeError: Converting circular structure to JSON) sur toute
  // Dupliquer/Copier/Enregistrer-comme-prefab. On ne sérialise que les
  // données utiles (voir rebuildComponents, objects.js, qui réattache de
  // vrais composants sur la copie à partir de ce JSON).
  toJSON() {
    return Object.assign({ typeName: this.constructor.typeName, active: this.active }, this.serialize());
  }

  // FINAL — ne pas surcharger dans une sous-classe.
  //
  // Avant : chaque sous-classe surchargeait `restore()` avec son propre
  // contrat (l'une ignorait `data`, l'autre le passait au constructeur…), et le
  // field générique `active` de la classe de base n'était donc jamais hérité —
  // d'où un helper `restaurerActif()` qu'il fallait penser à rappeler à la main
  // dans les seize sous-classes. Une seule oubliée = un composant désactivé qui
  // revient active au rechargement, sans message. Le point de variation est
  // maintenant `hydrate()`, qui ne peut pas casser l'invariant générique.
  static restore(node, data) {
    const d = data || {};
    const instance = new this(node, d);
    if (d.active !== undefined) instance.active = d.active;
    instance.hydrate(d);
    return instance;
  }

  static get typeName() { return 'Composant'; }
  static get category() { return 'Général'; }

  /**
   * Ce composant peut-il fabriquer un nœud à lui seul, depuis le menu de création ?
   *
   * `null` par défaut. Un composant qui répond `{ label, icon, components }` apparaît dans le
   * menu — SANS table codée en dur ailleurs : la barre 2D en tenait une, et un composant neuf
   * n'y entrait qu'à condition qu'on y pense.
   */
  static get creatable(){ return null; }

  /**
   * L'icône du nœud dans la hiérarchie, quand ce composant est le plus significatif qu'il porte.
   * `null` = ce composant ne dit rien de la nature du nœud (Script, Tag, Audio…).
   */
  static get icon() { return null; }

  /**
   * Composant d'INDEX, sans réglage propre : il rend une entité découvrable par
   * `Registry.activeNodes(...)` mais n'a rien à montrer ni à régler. L'inspecteur
   * ne l'affiche pas dans le bloc Composants et « + Composant » ne le propose pas —
   * il affichait sinon un bloc vide, et proposait d'ajouter à la main un composant
   * que le moteur pose et retire lui-même (Tag, Model, SubScene).
   */
  static get internal() { return false; }

  // Un composant « interne » (Tag, Model, SubScene…) n'a pas de carte du tout dans
  // buildBlocksComponents : sa donnée a déjà sa section dédiée ailleurs dans l'inspecteur. Un
  // composant peut avoir besoin de l'INVERSE — une carte VISIBLE (panneau générique) mais sans
  // croix de retrait, parce qu'il revient tout seul (posé par cloneModel/applyNodeMixin) et
  // qu'une croix qui ne retire rien durablement serait trompeuse. `hiddenInInspector` répond à
  // « faut-il sauter la carte », et vaut `internal` par défaut : tout composant interne existant
  // garde son comportement sans y toucher. `removable` répond à « faut-il la croix » et vaut
  // `!internal` par défaut.
  static get hiddenInInspector() { return this.internal; }
  static get removable() { return !this.internal; }
}




// `class`/`const` déclarés au niveau global d'un <script> ne créent pas de
// propriété sur `window` (contrairement à `var`/`function`) ; on les expose
// donc explicitement pour que les autres scripts puissent y accéder en tant
// que globales (ex. `class Mesh extends Component { ... }`).
if (typeof globalThis !== 'undefined') {
  globalThis.Component = Component;
}
