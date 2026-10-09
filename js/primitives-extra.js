// moteur/js/primitives-extra.js
//
// Primitives supplémentaires — module PARTAGÉ éditeur/jeu publié.
//
// Les six primitives d'origine (cube, sphère, cylindre, cône, tore, plan) ne savent pas dessiner
// une étoile, un losange ou une vague : un jeu de formes (Chromélo) devait donc importer un modèle
// par forme, ou les approcher avec des cônes. Ces formes sont construites ici, UNE fois, et
// `buildGeometry` (js/objects.js) comme `makePrimitive` (js/game-runtime.js) les délèguent à ce
// fichier — deux constructions séparées auraient fini par dessiner deux étoiles différentes entre
// l'éditeur et le jeu publié.
//
// TAILLES. Chaque forme tient dans une boîte d'environ 2 unités, pivot au centre, comme la sphère
// et le cône : une échelle de 1 donne une forme de la taille d'une sphère d'origine.

export const EXTRA_PRIMITIVES = [
  {type: 'star', label: 'Étoile', size: '2 × 1,9 × 0,5'},
  {type: 'diamond', label: 'Losange', size: '2 × 2 × 2'},
  {type: 'pyramid', label: 'Pyramide', size: '2 × 2 × 2'},
  {type: 'wave', label: 'Vague', size: '2,6 × 1,1 × 0,4'},
  {type: 'rock', label: 'Rocher', size: '2 × 2 × 2'},
  {type: 'capsule', label: 'Capsule', size: '1 × 2 × 1'}
];

export function isExtraPrimitive(name){
  return EXTRA_PRIMITIVES.some(function(p){ return p.type === name; });
}

/** La géométrie three d'une primitive supplémentaire, ou null si le nom n'en est pas une. */
export function buildExtraPrimitive(THREE, name){
  switch(name){
    case 'star': {
      const shape = new THREE.Shape();
      for(let i = 0; i < 10; i++){
        const a = i * Math.PI / 5 + Math.PI / 2, r = (i % 2) ? 0.45 : 1;
        const x = Math.cos(a) * r, y = Math.sin(a) * r;
        if(i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
      }
      shape.closePath();
      const g = new THREE.ExtrudeGeometry(shape, {depth: 0.32, bevelEnabled: true, bevelSize: 0.08,
        bevelThickness: 0.08, bevelSegments: 2});
      g.center();
      return g;
    }
    case 'diamond': return new THREE.OctahedronGeometry(1, 0);
    case 'pyramid': return new THREE.ConeGeometry(1, 2, 3);
    case 'wave': {
      const pts = [];
      for(let i = 0; i <= 8; i++){
        const t = i / 8;
        pts.push(new THREE.Vector3(-1.1 + t * 2.2, Math.sin(t * Math.PI * 2) * 0.35, 0));
      }
      const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.18, 10, false);
      g.center();
      return g;
    }
    case 'rock': return new THREE.DodecahedronGeometry(1, 0);
    case 'capsule': return new THREE.CapsuleGeometry(0.5, 1, 6, 16);
    default: return null;
  }
}
