// moteur/js/primitive-geometry.js
//
// LES GÉOMÉTRIES DE PRIMITIVES : une table, et une seule instance par forme.
//
// ---------- POURQUOI CE FICHIER EXISTE ----------
//
// La table des six primitives d'origine était écrite DEUX fois, mot pour mot : dans
// `buildGeometry` (js/objects.js, l'éditeur) et dans `makePrimitive` (js/game-runtime.js, le jeu
// publié). Exactement la situation que js/primitives-extra.js a été créé pour éviter — deux
// constructions séparées finissent par dessiner deux formes différentes de part et d'autre de
// l'export, et l'écart ne se voit qu'au pire moment. Les deux appellent désormais ici.
//
// ---------- LA TESSELLATION, MESURÉE ----------
//
// `SphereGeometry(1, 64, 48)` fait 6 016 triangles. Sur une scène de banc d'essai de 5 000
// objets composée à parts égales de cubes, sphères, cylindres et cônes, le runtime soumettait
// 7 471 001 triangles par image — dont 7 520 000 attendus pour les seules 1 250 sphères, soit
// 99 % du budget pour un quart des objets. Un cube en fait 12.
//
// La sphère passe donc à 32 × 24, soit 1 472 triangles : quatre fois moins, et l'ombrage lisse
// rend la différence invisible à la taille où l'on pose une sphère. C'est un choix VISIBLE, pas
// un réglage caché — le nombre est ici, en clair, et un test le garde.
//
// CONSÉQUENCE SUR LES PROJETS EXISTANTS : une sphère déjà posée change de maillage à la
// réouverture. Sa silhouette bouge de quelques centièmes d'unité, son ombre aussi. Ce qui ne
// bouge PAS : sa position, son échelle, son matériau, ses UV de texture. Un dépliage de lightmap
// déjà cuit, en revanche, ne correspond plus au maillage — il faut recuire.
//
// ---------- LE PARTAGE, ET CE QUI LE REND SÛR ----------
//
// Mille cubes fabriquaient mille géométries : mesuré dans l'éditeur, 4 900 géométries distinctes
// et 4 900 matériaux distincts pour 5 000 objets. Chacune part au GPU pour elle-même.
//
// Une géométrie partagée est un objet vivant que plusieurs maillages désignent. Le danger n'est
// pas le partage, c'est ce que le reste du moteur fait d'une géométrie : il y a VINGT-DEUX
// `geometry.dispose()` dans ce dépôt, chacun légitime pour une géométrie à soi, chacun fatal pour
// une géométrie partagée — libérer la seule sphère ferait disparaître toutes les autres.
//
// On n'audite pas vingt-deux sites : on rend le partage sûr par CONSTRUCTION. Une géométrie de la
// table porte un `dispose` qui ne fait rien. Les vingt-deux appels restent justes et deviennent
// sans effet, sans qu'aucun d'eux ait à connaître l'existence de ce fichier. Le prix est qu'une
// douzaine de géométries ne sont jamais libérées — quelques centaines de kilo-octets, pour des
// formes qu'on repose de toute façon à l'objet suivant.
//
// L'ÉCRITURE reste le seul geste interdit, et elle est rare : le dépliage d'UV de lightmap
// (js/lightmap-atlas.js) écrit un attribut `uv1` sur la géométrie. Sur une géométrie partagée, il
// donnerait à tous les objets l'éclairage cuit d'un seul. `geometryForWrite()` existe pour ça :
// elle détache une copie avant d'écrire. C'est le seul point d'appel à connaître la règle.

/** Le nombre de segments de chaque primitive — en clair, et gardé par test/primitive-geometry. */
export const PRIMITIVE_SEGMENTS = {
  // 32 × 24 = 1 472 triangles, contre 6 016 pour l'ancien 64 × 48.
  sphere: {width: 32, height: 24},
  cylinder: {radial: 32},
  cone: {radial: 32},
  // 16 × 32 = 1 024 triangles, contre 1 600 pour l'ancien 20 × 40.
  torus: {radial: 16, tubular: 32}
};

/** Les formes que cette table sait construire, hors primitives supplémentaires. */
export const PRIMITIVE_KINDS = ['cube', 'sphere', 'cylinder', 'cone', 'torus', 'plane'];

// Le nom d'affichage français de chaque forme de base. Il vivait dans `buildGeometry` et n'avait
// aucune raison d'y rester : c'est une propriété de la forme, pas de l'éditeur.
export const PRIMITIVE_LABELS = {
  cube: 'Cube', sphere: 'Sphère', cylinder: 'Cylindre',
  cone: 'Cône', torus: 'Tore', plane: 'Plan'
};

/**
 * Construit la géométrie d'une primitive de base. NEUVE à chaque appel — c'est la fabrique, pas
 * le cache ; `primitiveGeometry()` est ce qu'on veut presque toujours appeler.
 *
 * Rend `null` si le nom n'est pas une primitive de base, pour que l'appelant puisse essayer
 * js/primitives-extra.js avant de retomber sur le cube.
 */
export function buildPrimitiveGeometry(THREE, kind){
  const s = PRIMITIVE_SEGMENTS;
  switch(kind){
    case 'cube':     return new THREE.BoxGeometry(1.6, 1.6, 1.6);
    case 'sphere':   return new THREE.SphereGeometry(1, s.sphere.width, s.sphere.height);
    case 'cylinder': return new THREE.CylinderGeometry(0.8, 0.8, 1.8, s.cylinder.radial);
    case 'cone':     return new THREE.ConeGeometry(1, 2, s.cone.radial);
    case 'torus':    return new THREE.TorusGeometry(1, 0.4, s.torus.radial, s.torus.tubular);
    case 'plane': {
      // La rotation est appliquée À LA CONSTRUCTION, donc une seule fois pour l'instance
      // partagée. Un plan est horizontal dans ce moteur ; three le fabrique vertical.
      const g = new THREE.PlaneGeometry(4, 4);
      g.rotateX(-Math.PI / 2);
      return g;
    }
    default: return null;
  }
}

// La table des instances partagées. Une par nom de forme, construite au premier besoin.
const shared = new Map();

/** La marque d'une géométrie partagée : le nom de sa forme, ou `''` si elle n'appartient à personne. */
export function sharedKindOf(geo){
  return (geo && geo.userData && geo.userData.sharedPrimitive) || '';
}

/**
 * Rend l'instance PARTAGÉE de la géométrie d'une forme, en la construisant au premier appel.
 *
 * `builderExtra` permet à l'appelant de fournir les primitives supplémentaires
 * (js/primitives-extra.js) sans que ce fichier en dépende — l'éditeur et le jeu publié les
 * résolvent déjà chacun de leur côté, et une dépendance croisée entre les deux tables n'aurait
 * servi qu'à décider laquelle charge l'autre.
 */
export function primitiveGeometry(THREE, kind, builderExtra){
  const key = String(kind || 'cube');
  const cached = shared.get(key);
  if(cached) return cached;

  let geo = buildPrimitiveGeometry(THREE, key);
  if(!geo && typeof builderExtra === 'function') geo = builderExtra(THREE, key);
  if(!geo) return null;

  geo.userData.sharedPrimitive = key;
  // LE VERROU, et toute la sûreté du partage tient dans ces deux lignes. Voir l'en-tête : les
  // vingt-deux `geometry.dispose()` du dépôt restent justes, et deviennent sans effet ici.
  geo.dispose = function(){ /* géométrie partagée : la libérer effacerait les autres objets */ };
  shared.set(key, geo);
  return geo;
}

/**
 * La géométrie d'un maillage, RENDUE MODIFIABLE. À appeler avant d'écrire un attribut dessus.
 *
 * Si la géométrie est partagée, elle est copiée, posée sur le maillage, et c'est la copie qui est
 * rendue — l'original reste intact pour tous les autres objets. Sinon la géométrie est rendue
 * telle quelle, et l'appel ne coûte rien.
 */
export function geometryForWrite(mesh){
  if(!mesh || !mesh.geometry) return null;
  if(!sharedKindOf(mesh.geometry)) return mesh.geometry;
  const copy = mesh.geometry.clone();
  // La copie n'est plus partagée : elle retrouve un `dispose` normal (clone() ne recopie pas les
  // propriétés propres de l'instance, mais userData est copié — d'où l'effacement explicite).
  if(copy.userData) delete copy.userData.sharedPrimitive;
  mesh.geometry = copy;
  return copy;
}


// EXPOSÉ EN GLOBALE, à dessein — même régime que js/primitives-extra.js et js/render-perf.js :
// ces symboles sont appelés depuis des fichiers que toutes les pages ne chargent pas, donc
// derrière un `typeof` côté appelant. Voir docs/ARCHITECTURE.md.
globalThis.primitiveGeometry = primitiveGeometry;
globalThis.geometryForWrite = geometryForWrite;
globalThis.sharedKindOf = sharedKindOf;
