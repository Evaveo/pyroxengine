// moteur/js/rigid-body.js
//
// LA construction d'un corps rigide cannon.js — fichier PARTAGÉ éditeur ↔ runtime du jeu publié.
//
// Elle existait en DEUX exemplaires : `construireCorpsPour` dans js/physics.js et une copie
// quasi identique dans js/game-runtime.js, plus une TROISIÈME écriture du champ de hauteurs de
// terrain dans `startPhysics()` du runtime. Trois endroits pour une seule règle, dans un
// dépôt où « une divergence éditeur/runtime ne se voit qu'après export » est la famille de
// défaut la plus coûteuse (voir docs/ARCHITECTURE.md).
//
// Les deux copies avaient déjà divergé : celle du runtime traitait le terrain SANS tenir count
// de l'échelle de l'objet ni de sa position MONDE — un terrain mis à l'échelle ou parenté sous
// un autre nœud collisionnait juste dans l'éditeur et de travers dans le jeu publié. C'est la
// version de l'éditeur (échelle et pose monde) qui fait foi ici, donc le jeu publié se corrige
// en même temps qu'il se dé-duplique.
//
// Dépendances : THREE, CANNON, et `terrIdx` (js/component-data.js). Rien d'autre — pas de
// globale d'éditeur, ce qui est ce qui permet de le charger des deux côtés.

import { terrIdx } from './component-data.js';

export const _crP = new THREE.Vector3(), _crQ = new THREE.Quaternion(), _crE = new THREE.Vector3();

// construit un body cannon pour un objet : collider de l'inspecteur si défini,
// sinon forme automatique (sphère/boîte exactes, boîte englobante en repli)
export function buildRigidBody(o, masse){
  o.getWorldPosition(_crP);
  o.getWorldQuaternion(_crQ);
  o.getWorldScale(_crE);
  const matBody = new CANNON.Material();
  const body = new CANNON.Body({mass:masse, material:matBody});
  let offset = new THREE.Vector3(0, 0, 0);

  const col = (o.userData.collider && o.userData.collider.active !== false) ? o.userData.collider : null;
  // La forme automatique exacte (sphere/box) n'a de sens que pour une PRIMITIVE, dont la
  // geometrie est celle du Noeud lui-meme : c'est ce que porte le composant Mesh.
  const isPrimitive = !!(o.getComponent && o.getComponent('Mesh')) || o.userData.type === 'mesh';
  const geoType = (isPrimitive && o.geometry && o.geometry.type) || '';
  // terrain : champ de hauteurs cannon (le sol suit le relief sculpté)
  const isTerrain = !!(o.getComponent && o.getComponent('Terrain')) || o.userData.type === 'terrain';
  if(isTerrain && o.userData.terr && CANNON.Heightfield){
    const t = o.userData.terr;
    const seg = t.segments, step = (t.size / seg) * _crE.x;
    // Heightfield de cannon : data[i][j] dans le plan XY, hauteur sur Z. Une rotation
    // de -90° autour de X amène Z sur Y et envoie j vers -Z : on inverse donc j pour
    // que la colonne 0 du tableau reste le bord -Z du maillage.
    const matrix = [];
    for(let ix = 0; ix <= seg; ix++){
      const column = [];
      for(let j = 0; j <= seg; j++) column.push(t.heights[terrIdx(t, ix, seg - j)] * _crE.y);
      matrix.push(column);
    }
    const qh = new CANNON.Quaternion();
    qh.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
    body.addShape(new CANNON.Heightfield(matrix, {elementSize: step}),
      new CANNON.Vec3(0, 0, 0), qh);
    body.position.set(_crP.x - (t.size / 2) * _crE.x, _crP.y,
                       _crP.z + (t.size / 2) * _crE.z);
    return {body: body, offset: offset, material: matBody};
  }
  if(col && col.shape !== 'auto'){
    // collider défini dans l'inspecteur : prioritaire sur la forme automatique
    const decCol = new CANNON.Vec3(col.offset[0]*_crE.x, col.offset[1]*_crE.y, col.offset[2]*_crE.z);
    if(col.shape === 'box'){
      body.addShape(new CANNON.Box(new CANNON.Vec3(
        Math.max(0.025, col.dims[0]*_crE.x/2),
        Math.max(0.025, col.dims[1]*_crE.y/2),
        Math.max(0.025, col.dims[2]*_crE.z/2))), decCol);
    } else if(col.shape === 'sphere'){
      body.addShape(new CANNON.Sphere(col.radius * Math.max(_crE.x, _crE.y, _crE.z)), decCol);
    } else {
      // cannon 0.6.2 : l'axe du cylindre est Z, on le réoriente sur Y
      const r = col.radius * Math.max(_crE.x, _crE.z);
      const qCyl = new CANNON.Quaternion();
      qCyl.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI/2);
      body.addShape(new CANNON.Cylinder(r, r, col.height * _crE.y, 12), decCol, qCyl);
    }
    if(col.trigger) body.collisionResponse = false;
  }
  else if(geoType === 'SphereGeometry'){
    body.addShape(new CANNON.Sphere(Math.max(_crE.x, _crE.y, _crE.z)));
  } else if(geoType === 'BoxGeometry'){
    body.addShape(new CANNON.Box(new CANNON.Vec3(0.8*_crE.x, 0.8*_crE.y, 0.8*_crE.z)));
  } else {
    // boîte englobante (cylindre, cône, tore, modèles importés)
    const box = new THREE.Box3().setFromObject(o);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    // décalage du centre de la boîte exprimé dans le repère du corps
    offset = center.clone().sub(_crP).applyQuaternion(_crQ.clone().invert());
    body.addShape(
      new CANNON.Box(new CANNON.Vec3(Math.max(0.05, size.x/2), Math.max(0.05, size.y/2), Math.max(0.05, size.z/2))),
      new CANNON.Vec3(offset.x, offset.y, offset.z)
    );
  }

  body.position.set(_crP.x, _crP.y, _crP.z);
  body.quaternion.set(_crQ.x, _crQ.y, _crQ.z, _crQ.w);
  return {body:body, offset:offset, material:matBody};
}


// « Cet objet a-t-il quelque chose de solide à simuler ? » — une question de
// COMPOSANTS, pas de chaînes de caractères. Un Mesh (primitive, forme éditable)
// ou un modele (racine d'un import glTF/FBX, rendu dans son sous-arbre) sont les
// deux formes de rendu du moteur, donc les deux porteurs possibles d'un corps.
//
// Le repli sur userData.type reste, mais seulement comme repli : un objet créé
// par un plugin qui pose son type à la main sans passer par addComponent est
// rattrapé par syncComponents (objects.js:register) — sauf s'il
// contourne aussi ce chemin.
export function canHaveRigidBody(o){
  if(o.getComponent && (o.getComponent('Mesh') || o.getComponent('Model'))) return true;
  return o.userData.type === 'mesh' || o.userData.type === 'model';
}
