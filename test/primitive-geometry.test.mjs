// LES GÉOMÉTRIES DE PRIMITIVES SONT PARTAGÉES, ET LE PARTAGE DOIT RESTER SÛR.
//
// Trois choses peuvent casser ici, et aucune ne lèverait d'erreur :
//
//  1. LE PARTAGE DISPARAÎT. Quelqu'un remet un `new THREE.SphereGeometry(...)` dans
//     js/objects.js ou js/game-runtime.js — les deux endroits où la table vivait en double —
//     et l'on retombe à une géométrie par objet. Mesuré avant ce chantier : 4 900 géométries
//     distinctes pour 5 000 objets. Rien ne se voit à l'écran, tout ralentit.
//
//  2. LE PARTAGE DEVIENT DANGEREUX. Un `geometry.dispose()` sur une géométrie partagée
//     libérerait les tampons de TOUS les objets qui portent cette forme. Il y a vingt-deux
//     appels à `dispose()` dans ce dépôt ; la protection est donc sur la géométrie elle-même,
//     et c'est ça qu'on vérifie, pas les vingt-deux appelants.
//
//  3. UNE ÉCRITURE FUIT D'UN OBJET À L'AUTRE. La cuisson de lightmap écrit `uv1` sur la
//     géométrie. Sans détachement préalable, tous les cubes d'une scène reçoivent l'éclairage
//     cuit d'un seul — une image parfaitement plausible, et fausse partout.
//
// La tessellation est ici aussi, en clair : c'est un choix visuel, pas un réglage caché, et
// personne ne doit pouvoir la multiplier par quatre sans qu'un test le dise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { creerContexte } from './engine-env.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const lire = (f) => readFileSync(path.join(root, f), 'utf8');

// js/primitive-geometry.js et js/primitives-extra.js sont chargés pour TOUS les contextes par
// engine-env.mjs : js/objects.js ne sait plus construire une forme sans eux.
const env = creerContexte(['js/objects.js']);

/** Le nombre de triangles d'une géométrie, indexée ou non. */
function triangles(geo){
  return geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
}

const forme = (nom) => env.primitiveGeometry(env.THREE, nom, env.buildExtraPrimitive);

// ---------- 1. Le partage ----------

test('deux demandes de la meme forme rendent la MEME geometrie', () => {
  assert.equal(forme('cube'), forme('cube'),
    'deux instances = une geometrie par objet = le defaut que ce fichier ferme');
  assert.equal(forme('sphere'), forme('sphere'));
  assert.notEqual(forme('cube'), forme('sphere'), 'deux formes ne doivent pas se confondre');
});

test('une forme supplementaire passe par le MEME cache que les six formes de base', () => {
  // Sans cette branche, etoiles et losanges retomberaient a une geometrie par objet, en
  // silence : ce sont precisement les formes qu'on pose par centaines dans un decor.
  assert.equal(forme('star'), forme('star'));
  assert.equal(env.sharedKindOf(forme('star')), 'star');
});

test('un nom inconnu retombe sur le cube, et sur LE cube partage', () => {
  assert.equal(env.buildPrimitiveGeometry(env.THREE, 'chimere'), null,
    'la fabrique doit dire « ce n est pas une forme de base » pour que l appelant essaie les autres');
  const c = env.buildGeometry('chimere');
  assert.equal(c.geoName, 'cube', 'un nom inconnu est normalise en cube');
  assert.equal(c.geo, forme('cube'), 'et rend l instance partagee, pas une copie');
});

test('buildGeometry rend toujours le nom d affichage francais', () => {
  assert.equal(env.buildGeometry('sphere').name, 'Sphère');
  assert.equal(env.buildGeometry('plane').name, 'Plan');
  assert.equal(env.buildGeometry('star').name, 'Étoile');
});

// ---------- 2. Le verrou : dispose ne doit rien faire ----------

test('dispose() sur une geometrie partagee ne libere RIEN', () => {
  const g = forme('cube');
  let libere = false;
  // On observe l'effet reel : `dispose()` de three emet l'evenement 'dispose', que le
  // renderer ecoute pour lacher les tampons GPU. Si l'evenement part, les autres objets
  // perdent leur geometrie — c'est exactement la panne qu'on previent.
  g.addEventListener('dispose', () => { libere = true; });
  g.dispose();
  assert.equal(libere, false,
    'la geometrie partagee a emis son evenement de liberation : tous les objets qui la '
    + 'portent perdraient leurs tampons au premier objet supprime');
  assert.ok(g.attributes.position, 'et ses attributs doivent rester en place');
});

test('une geometrie DETACHEE retrouve un dispose normal', () => {
  // Contre-essai du verrou : s'il etait pose sur le prototype plutot que sur l'instance
  // partagee, il neutraliserait aussi les copies — et plus rien ne se libererait jamais.
  const mesh = {geometry: forme('sphere')};
  const propre = env.geometryForWrite(mesh);
  let libere = false;
  propre.addEventListener('dispose', () => { libere = true; });
  propre.dispose();
  assert.equal(libere, true, 'une geometrie a soi doit pouvoir etre liberee');
});

// ---------- 3. L'ecriture ne fuit pas d'un objet a l'autre ----------

test('ecrire sur la geometrie d un objet ne touche pas ses jumeaux', () => {
  const a = {geometry: forme('cube')}, b = {geometry: forme('cube')};
  assert.equal(a.geometry, b.geometry, 'les deux partent bien de la meme geometrie');

  const geoA = env.geometryForWrite(a);
  assert.notEqual(a.geometry, b.geometry, 'l ecriture doit avoir detache a de la table');
  assert.equal(b.geometry, forme('cube'), 'et laisser b sur l instance partagee');

  const n = geoA.attributes.position.count;
  geoA.setAttribute('uv1', new env.THREE.BufferAttribute(new Float32Array(n * 2), 2));
  assert.ok(geoA.attributes.uv1, 'a porte son uv1');
  assert.equal(b.geometry.attributes.uv1, undefined,
    'b a recu l uv1 de a : toutes les copies d une forme partageraient la meme lightmap');
});

test('geometryForWrite ne copie pas ce qui est deja detache', () => {
  const mesh = {geometry: forme('cone')};
  const une = env.geometryForWrite(mesh);
  const deux = env.geometryForWrite(mesh);
  assert.equal(une, deux, 'une seconde ecriture ne doit pas recopier a chaque fois');
});

// ---------- 4. La tessellation ----------

test('le nombre de triangles de chaque forme est celui que le module annonce', () => {
  const s = env.PRIMITIVE_SEGMENTS;
  // Les formules de three, recalculees ici : le test doit tomber si quelqu'un change les
  // segments, PAS repeter le code du module.
  const attendu = {
    cube: 12,
    sphere: s.sphere.width * s.sphere.height * 2 - s.sphere.width * 2,
    cylinder: s.cylinder.radial * 4,
    cone: s.cone.radial * 2,
    torus: s.torus.radial * s.torus.tubular * 2,
    plane: 2
  };
  Object.keys(attendu).forEach((nom) => {
    assert.equal(triangles(forme(nom)), attendu[nom], 'triangles de « ' + nom + ' »');
  });
});

test('LE PLAFOND : aucune primitive ne depasse 2000 triangles', () => {
  // LE CHIFFRE QUI A MOTIVE TOUT CECI. `SphereGeometry(1, 64, 48)` en faisait 6 016 : sur une
  // scene de 5 000 objets dont un quart de spheres, le runtime soumettait 7 471 001 triangles
  // par image, dont 99 % pour ce seul quart. Le plafond est la pour qu'un « mettons-la plus
  // lisse » se voie au moment ou il est ecrit, et pas six mois plus tard sur une machine
  // modeste.
  env.PRIMITIVE_KINDS.concat(['star', 'diamond', 'capsule']).forEach((nom) => {
    const t = triangles(forme(nom));
    assert.ok(t <= 2000, 'la forme « ' + nom + ' » fait ' + t + ' triangles (plafond 2000)');
  });
  // Contre-essai : le plafond doit etre franchissable, sinon il ne garde rien. L'ancienne
  // sphere le franchit.
  const ancienne = new env.THREE.SphereGeometry(1, 64, 48);
  assert.ok(triangles(ancienne) > 2000,
    'l ancienne sphere passe le plafond : ce test ne garde plus rien');
});

// ---------- 5. La table n'existe qu'a UN endroit ----------

test('ni l editeur ni le jeu publie ne reconstruisent une primitive eux-memes', () => {
  // LE DEFAUT QU'ON FERME : la table etait ecrite deux fois, mot pour mot. Deux tables
  // divergent — et l'ecart entre la vue d'edition et le jeu publie ne se voit qu'apres
  // l'export, c'est-a-dire au pire moment.
  // On vise les DIMENSIONS de la table, pas le nom des constructeurs : js/objects.js fabrique
  // aussi les icones d'edition (l'ampoule d'une lumiere, le boitier d'une camera), qui sont de
  // vraies geometries a elles et n'ont rien a faire dans un cache de formes de scene.
  const signatures = [
    'new THREE.BoxGeometry(1.6', 'new THREE.SphereGeometry(1,',
    'new THREE.CylinderGeometry(0.8', 'new THREE.ConeGeometry(1,', 'new THREE.TorusGeometry(1,'
  ];
  ['js/objects.js', 'js/game-runtime.js'].forEach((f) => {
    const src = lire(f).split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    signatures.forEach((g) => {
      assert.equal(src.includes(g), false,
        f + ' contient « ' + g + ' » : la table des formes doit rester dans '
        + 'js/primitive-geometry.js, sinon les deux moteurs finiront par dessiner deux formes '
        + 'differentes de part et d autre de l export');
    });
  });
  // Contre-essai : ces signatures doivent bel et bien decrire la table, sinon le test
  // n'interdit rien du tout.
  const table = lire('js/primitive-geometry.js');
  signatures.forEach((g) => {
    assert.ok(table.includes(g), 'la signature « ' + g + ' » ne decrit plus la table');
  });
});

test('le module de formes part bien dans les builds', () => {
  // Un module d'editeur oublie dans la liste du build, c'est un jeu publie qui ne demarre pas
  // — et la page d'index est engendree, donc rien ne le dirait avant l'export.
  const build = lire('js/build.js');
  assert.ok(build.includes("{src: 'js/primitive-geometry.js'}"),
    'js/primitive-geometry.js manque a la liste des modules embarques');
  assert.ok(build.includes('src="primitive-geometry.js"'),
    'js/primitive-geometry.js manque aux balises de la page engendree');
});
