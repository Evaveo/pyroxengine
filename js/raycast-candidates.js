// Les candidats d'un `api.raycast`, partagés par l'éditeur (js/scripts.js) et le jeu
// (js/game-runtime.js).
//
// Avant, le rayon était lancé RÉCURSIVEMENT sur tous les objets de la scène, et le filtre
// (`tag`, `layer`) n'était appliqué qu'aux impacts. Deux coûts, mesurés sur jeux/TPS (caméra
// d'épaule qui lance un rayon par image) :
//   - un personnage skinné était testé à chaque image même quand le filtre l'écartait, et
//     three.js calcule le skinning d'un SkinnedMesh sur le CPU, vertex par vertex, pour le
//     raycast ;
//   - depuis que les os d'un modèle sont des objets de scène (v0.159), chaque os était AUSSI un
//     candidat récursif : le même maillage était retraversé une fois par ancêtre listé.
// Ici, chaque objet 3D n'apparaît qu'une fois, sous l'objet de scène qui « possède » ses impacts
// (`ownerOf`), et seulement si ce propriétaire passe le filtre. Le résultat est inchangé : c'est
// le premier impact dont le propriétaire passe le filtre.
export function raycastCandidates(objects, self, filter, ownerOf, sameLayer, out){
  out.length = 0;
  for(let k = 0; k < objects.length; k++){
    const c = objects[k];
    if(c === self || ownerOf(c) !== c) continue;
    if(filter){
      const g = c.userData.game;
      if(filter.tag !== undefined && (!g || g.tag !== filter.tag)) continue;
      if(filter.layer !== undefined && (!g || !sameLayer(g.layer, filter.layer))) continue;
    }
    c.traverse(function(x){ if(ownerOf(x) === c) out.push(x); });
  }
  return out;
}
