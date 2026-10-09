// moteur/js/prefab-library.js
// La BIBLIOTHÈQUE DE PREFABS PAR DÉFAUT : des objets tout faits (contrôleurs de personnage,
// bientôt d'autres), extraits de jeux du dépôt (jeux/NeonBreach…) et rangés dans
// moteur/prefabs-default/ — un dossier À PART, hors de tout projet, accessible depuis
// N'IMPORTE QUEL projet ouvert dans l'éditeur, comme des assets par défaut.
//
// Chargé UNIQUEMENT par editor.html : `rebuildTree`/`previewObject3D`/`assets`/`assetId` sont
// tous des globaux du moteur qui n'existent que là (jamais dans hub.html, qui liste les
// templates sans en construire le contenu — voir js/hub/hub-templates.js).
//
// LE MANIFESTE EST EXPLICITE, pas une découverte de dossier : la bibliothèque est un ensemble
// curé, pas un dépôt où n'importe quel fichier apparaîtrait automatiquement. Ajouter un prefab
// par défaut, c'est ajouter une entrée ici + le fichier .prefab.json — jamais autre chose.
import { assetId, assets, nextAssetId, previewObject3D, updateProject } from './assets.js';
import { updateHierarchy } from './hierarchy.js';
import { pushHistory } from './history.js';
import { reenableSubTree } from './objects.js';
import { applyFilters, scene } from './scene.js';
import { rebuildTree } from './serialization.js';

export const PrefabLibrary = (function(){
  const MANIFEST = [
    {id: 'fps-controller', file: 'prefabs-default/fps-controller.prefab.json',
     label: 'Contrôleur FPS', description: 'Déplacement, saut, regard souris. Sans arme.'},
    {id: 'tps-controller', file: 'prefabs-default/tps-controller.prefab.json',
     label: 'Contrôleur troisième personne',
     description: 'Déplacement, saut, caméra d’épaule orbitale. Repris de jeux/TPS.'},
    {id: 'enemy-drone', file: 'prefabs-default/enemy-drone.prefab.json',
     label: 'Ennemi — Drone', description: 'Sphère taggée « enemy », collider auto. Repris de jeux/NeonBreach.'},
    {id: 'enemy-colosse', file: 'prefabs-default/enemy-colosse.prefab.json',
     label: 'Ennemi — Colosse', description: 'Variante plus grande du même ennemi. Repris de jeux/NeonBreach.'}
  ];

  function list(){ return MANIFEST.slice(); }

  function entryOf(id){
    const e = MANIFEST.find(function(m){ return m.id === id; });
    if(!e) throw new Error('Prefab de bibliothèque inconnu : ' + id);
    return e;
  }

  // Importe le prefab dans le projet OUVERT : un nouvel asset kind:'prefab', comme s'il avait
  // toujours vécu dans ce projet (visible dans le panneau Asset, réutilisable, exportable). Ne
  // place RIEN dans la scène — voir instantiate() pour ça.
  async function importIntoProject(id){
    const entry = entryOf(id);
    const rep = await fetch(entry.file);
    if(!rep.ok) throw new Error('Prefab introuvable : ' + entry.file + ' (HTTP ' + rep.status + ')');
    const data = await rep.json();
    // {} : ce premier lot de prefabs par défaut ne référence aucun autre asset (texture,
    // matériau) — assetsById ne sert qu'à résoudre CES références-là dans rebuildTree.
    const rec = rebuildTree(data.tree || [], {}, false);
    if(!rec.racines.length) throw new Error('Le prefab « ' + entry.label + ' » est vide.');
    const template = rec.racines[0];
    const asset = {id: 'a' + (nextAssetId()), kind: 'prefab', name: data.name || entry.label,
      base: null, folder: '', preview: previewObject3D(template), template: template};
    assets.push(asset);
    updateProject();
    return asset;
  }

  // Importe PUIS place une instance dans la scène courante — le geste complet derrière
  // « Ajouter à la scène » et derrière un template du Hub qui embarque ce prefab.
  async function instantiate(id, position){
    const asset = await importIntoProject(id);
    pushHistory();
    const copie = asset.template.clone(true);
    reenableSubTree(copie);
    copie.userData.prefabId = asset.id;
    if(position) copie.position.set(position.x || 0, position.y || 0, position.z || 0);
    scene.add(copie);
    updateHierarchy();
    applyFilters();
    return copie;
  }

  return {list: list, importIntoProject: importIntoProject, instantiate: instantiate};
})();
