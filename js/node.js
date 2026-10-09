import { Registry } from './component-registry.js';
import { Component } from './component.js';

/**
 * Un composant, ou un DÉBRIS de composant ?
 *
 * `Object3D.clone()` de three recopie `userData` par `JSON.parse(JSON.stringify(...))` —
 * vérifié dans le bundle vendorisé. Toute instance de composant qui s'y trouve en ressort donc
 * en OBJET NU : plus de classe, plus de `constructor.typeName`, plus de `champsInspector`.
 */
export function isComponent(c) {
  return !!c && c instanceof Component;
}

// moteur/js/node.js
// Ajoute l'API composant à un THREE.Object3D existant. Appelé une fois par
// chaque fabriquerX() d'objects.js, jamais par le code utilisateur directement.
export function applyNodeMixin(o) {
  if (!Array.isArray(o.userData.components)) o.userData.components = [];
  // On jette les débris laissés par un clone.
  //
  // Ce qu'ils provoquaient : `getComponent` compare `constructor.typeName`, qui vaut `undefined`
  // sur un objet nu — il ne les voyait donc pas, et `syncComponents` en recréait un
  // propre À CÔTÉ. Le tableau finissait avec quatre entrées dont deux fausses, et l'inspecteur
  // plantait sur la première (`composant.champsInspector is not a function`) au moment de
  // sélectionner un modèle importé après avoir rechargé le projet.
  //
  // Jeter est sûr : tout composant susceptible d'être cloné est adossé à un sac de `userData`
  // (collider, phys, terr, part, sonde, uiDoc, scripts, animator) que `syncComponents`
  // rejoue juste après. Les trois autres types — Mesh, Lumière, Caméra — s'attachent à la
  // fabrication de l'objet et ne passent jamais par le clonage d'un modèle.
  else if (o.userData.components.some((c) => !isComponent(c))) {
    o.userData.components = o.userData.components.filter(isComponent);
  }

  o.getComponent = function (typeName) {
    return o.userData.components.find((c) => c.constructor.typeName === typeName) || null;
  };

  o.getComponents = function (typeName) {
    if (!typeName) return o.userData.components.slice();
    return o.userData.components.filter((c) => c.constructor.typeName === typeName);
  };

  o.addComponent = function (typeName, data) {
    const classe = Registry.classByType(typeName);
    if (!classe) throw new Error('Composant inconnu : ' + typeName);
    // (plus de refus d'espace : il n'y a qu'un monde, et tout composant peut vivre sur
    //  tout nœud — voir la suppression de la séparation 2D/3D.)
    const instance = classe.restore(o, data || {});
    o.userData.components.push(instance);
    instance.onAdd();
    Registry.register(instance);
    return instance;
  };

  o.removeComponent = function (instance) {
    const i = o.userData.components.indexOf(instance);
    if (i === -1) return;
    instance.onRemove();
    Registry.unregister(instance);
    o.userData.components.splice(i, 1);
  };

  return o;
}
