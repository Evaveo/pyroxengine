// LE BANC D'ESSAI D'UNE SCÈNE DENSE.
//
// ---------- POURQUOI IL N'Y A PAS D'IMAGES PAR SECONDE ICI ----------
//
// Parce qu'elles ne sont pas reproductibles, et la leçon a coûté une session entière. Les
// chiffres relevés le 2026-09-23 dans un panneau navigateur — « 29 images/s à 500 objets, 1 à
// 1 000 » — ne mesuraient pas le moteur : le même éditeur VIDE y donnait 1,1 image/s, avec des
// écarts entre deux rappels de 5 990 ms puis 14 ms puis 5 973 ms. C'était le compositeur de
// l'hôte, pas la scène. Une suite qui assertionne sur une cadence assertionne sur la machine.
//
// Ce que ce banc mesure est DÉTERMINISTE : des comptes. Ce sont exactement les trois nombres
// qui avaient régressé sans que rien ne le dise, et dont dépend la cadence réelle :
//
//   · les GÉOMÉTRIES DISTINCTES — 4 900 pour 5 000 objets avant ce chantier, une par objet ;
//   · les TRIANGLES soumis — 7 471 001 par image pour 5 000 objets, dont 99 % pour le seul
//     quart de sphères, à cause de leur tessellation par défaut ;
//   · les APPELS DE DESSIN après regroupement — la seule chose qui tienne une scène dense.
//
// ---------- LA SCÈNE DE RÉFÉRENCE ----------
//
// Mille objets, quatre formes, quatre couleurs, rangés par secteurs de cinquante comme un décor
// découpé. Chaque objet a SON matériau, jamais partagé : c'est ce que fait l'éditeur (une copie
// par objet, pour qu'on puisse en changer un sans toucher les autres), et c'est ce qui rend le
// regroupement dépendant d'une comparaison par contenu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { creerContexte } from './engine-env.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const lire = (f) => readFileSync(path.join(root, f), 'utf8');

// LES COMPOSANTS SONT CHARGES POUR DE VRAI : les gardes plus bas verifient que les systemes 2D
// demandent au registre des noms de composants qui EXISTENT, et c'est le registre reel qui le
// dit — pas une liste recopiee ici, qui vieillirait sans que personne ne s'en apercoive.
const composants = readdirSync(path.join(root, 'js/components'))
  .filter((f) => f.endsWith('.js')).map((f) => 'js/components/' + f);
const env = creerContexte(['js/component-registry.js', 'js/component.js', 'js/node.js',
  'js/component-data.js'].concat(composants).concat(['js/render-perf.js', 'js/objects.js']));
const THREE = env.THREE;

const OBJETS = 1000;
const FORMES = ['cube', 'sphere', 'cylinder', 'cone'];
const COULEURS = [0x9aa5b1, 0x6b7a8f, 0xb08968, 0x7f9172];
const PAR_SECTEUR = 50;

function triangles(geo){
  return geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
}

/** Le décor de référence : la scène three, et la liste d'objets que verrait le moteur. */
function decorReference(){
  const scene = new THREE.Scene();
  const objects = [];
  let secteur = null;
  for(let i = 0; i < OBJETS; i++){
    if(i % PAR_SECTEUR === 0){
      secteur = new THREE.Object3D();
      secteur.name = 'Secteur ' + (i / PAR_SECTEUR);
      scene.add(secteur);
    }
    const forme = FORMES[i % FORMES.length];
    // MÊME CHEMIN QUE L'ÉDITEUR : `buildGeometry` rend l'instance partagée de la forme. Le
    // banc ne doit pas fabriquer ses géométries à la main, sinon il mesurerait sa propre
    // fabrique et resterait vert le jour où celle du moteur cesserait de partager.
    const geo = env.buildGeometry(forme).geo;
    const mat = new THREE.MeshStandardMaterial({
      color: COULEURS[Math.floor(i / FORMES.length) % COULEURS.length],
      roughness: 0.55, metalness: 0.1
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.set((i % 70) * 2.5 - 87, 0, Math.floor(i / 70) * 2.5 - 90);
    m.castShadow = m.receiveShadow = true;
    m.userData.game = {tag: '', layer: 0, props: {}};
    secteur.add(m);
    objects.push(m);
  }
  scene.updateMatrixWorld(true);
  return {scene, objects};
}

function releve(){
  const {scene, objects} = decorReference();
  const geometries = new Set(), materiaux = new Set();
  let tri = 0;
  objects.forEach((o) => {
    geometries.add(o.geometry.uuid);
    materiaux.add(o.material.uuid);
    tri += triangles(o.geometry);
  });
  const regroupes = env.instantiateStatic(scene, objects);
  const lots = env.summaryInstances();
  // Les appels de dessin d'une image : un par lot, plus un par objet resté seul.
  const appels = lots.lots + (objects.length - regroupes);
  return {scene, objects, geometries: geometries.size, materiaux: materiaux.size,
          triangles: tri, regroupes, lots: lots.lots, appels};
}

const R = releve();

test('LE RELEVE — les trois compteurs du decor de reference', () => {
  // Imprimé plutôt que seulement assertionné : c'est un banc, pas seulement une garde. Ces
  // lignes sortent dans la sortie TAP, et l'intégration continue les archive.
  console.log('  banc : ' + OBJETS + ' objets, ' + FORMES.length + ' formes, '
    + COULEURS.length + ' couleurs');
  console.log('  banc : geometries distinctes = ' + R.geometries
    + '  (une par objet avant le partage : ' + OBJETS + ')');
  console.log('  banc : materiaux distincts   = ' + R.materiaux + '  (un par objet, voulu)');
  console.log('  banc : triangles par image   = ' + R.triangles);
  console.log('  banc : lots d instances      = ' + R.lots
    + '  pour ' + R.regroupes + ' objets regroupes');
  console.log('  banc : appels de dessin      = ' + R.appels);
  assert.equal(R.objects.length, OBJETS);
});

// ---------- 1. Les géométries ----------

test('mille objets de quatre formes tiennent sur quatre geometries', () => {
  assert.equal(R.geometries, FORMES.length,
    'une geometrie par objet est revenue : ' + R.geometries + ' distinctes pour ' + OBJETS
    + ' objets. C est le defaut que js/primitive-geometry.js ferme, et il ne se voit pas a l ecran');
});

test('les materiaux restent PROPRES A CHAQUE OBJET, et c est voulu', () => {
  // Ce n'est pas un oubli du partage : la selection d'un objet ecrit dans l'emissif de SON
  // materiau (js/render-perf.js le dit en commentaire), et l'edition d'une couleur ne doit
  // toucher qu'un objet. Partager les materiaux teindrait les jumeaux d'un coup.
  assert.equal(R.materiaux, OBJETS,
    'les materiaux sont partages : changer la couleur d un objet changerait celle de ses jumeaux');
});

// ---------- 2. Les triangles ----------

test('LE BUDGET DE TRIANGLES du decor de reference', () => {
  const attendu = FORMES.reduce((n, f) => n + triangles(env.buildGeometry(f).geo), 0)
    * (OBJETS / FORMES.length);
  assert.equal(R.triangles, attendu, 'le releve ne correspond plus a la somme des formes');

  const PLAFOND = 600000;
  assert.ok(R.triangles <= PLAFOND,
    R.triangles + ' triangles pour ' + OBJETS + ' objets (plafond ' + PLAFOND + ')');
});

test('LE PLAFOND DE TRIANGLES aurait attrape la sphere d avant', () => {
  // CONTRE-ESSAI, et il est indispensable : un plafond qu'aucune valeur reelle n'atteint est
  // un plafond qui ne garde rien. Avec `SphereGeometry(1, 64, 48)`, le meme decor pesait
  // 1 555 000 triangles — deux fois et demie le plafond.
  const ancienne = triangles(new THREE.SphereGeometry(1, 64, 48));
  const avant = R.triangles
    - triangles(env.buildGeometry('sphere').geo) * (OBJETS / FORMES.length)
    + ancienne * (OBJETS / FORMES.length);
  assert.ok(avant > 600000,
    'le decor d avant tenait sous le plafond : le plafond ne garde rien (' + avant + ')');
});

// ---------- 3. Les appels de dessin ----------

test('le regroupement ramene mille objets a seize appels de dessin', () => {
  assert.equal(R.regroupes, OBJETS, 'tous les objets du decor doivent etre regroupables');
  assert.equal(R.lots, FORMES.length * COULEURS.length,
    'un lot par couple (forme, couleur) : ' + R.lots + ' au lieu de '
    + (FORMES.length * COULEURS.length));
  assert.equal(R.appels, R.lots);

  const PLAFOND = 32;
  assert.ok(R.appels <= PLAFOND,
    R.appels + ' appels de dessin pour ' + OBJETS + ' objets (plafond ' + PLAFOND + ')');
});

test('LE PLAFOND D APPELS aurait attrape l absence de regroupement', () => {
  // Contre-essai du precedent : sans regroupement, un objet = un appel.
  assert.ok(OBJETS > 32, 'sans regroupement le decor ferait ' + OBJETS + ' appels');
});

test('une couleur par objet DEFAIT le regroupement, et il faut le savoir', () => {
  // MESURE REELLE, et une surprise du banc : une premiere scene de test donnait a chaque objet
  // une couleur unique. Resultat, ZERO lot sur mille objets, sans un mot — `signatureMaterial`
  // compare les materiaux par leur contenu, donc mille couleurs font mille signatures.
  //
  // Ce n'est pas un defaut : c'est le prix de la correction (deux apparences differentes ne
  // doivent jamais fondre dans un meme lot). Mais c'est une falaise invisible, et ce test la
  // rend ecrite : « dupliquer puis recolorer » sort un decor du regroupement.
  const scene = new THREE.Scene();
  const objects = [];
  for(let i = 0; i < 200; i++){
    const m = new THREE.Mesh(env.buildGeometry('cube').geo,
      new THREE.MeshStandardMaterial({color: 0xffffff - i}));
    m.userData.game = {layer: 0};
    scene.add(m);
    objects.push(m);
  }
  scene.updateMatrixWorld(true);
  const regroupes = env.instantiateStatic(scene, objects);
  assert.equal(regroupes, 0,
    'deux cents couleurs distinctes devraient donner deux cents signatures, donc aucun lot');
  env.undoInstances();
});

// ---------- 4. Le découpage spatial, et ce qu'il arbitre ----------

/** Les lots qu'une caméra voit réellement, avec le VRAI tronc de vue de three. */
function vus(cam){
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  const f = new THREE.Frustum().setFromProjectionMatrix(
    new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  let lots = 0, tri = 0;
  env.engineInstances.lots.forEach((l) => {
    if(!l.mesh.frustumCulled || f.intersectsObject(l.mesh)){
      lots++;
      tri += triangles(l.mesh.geometry) * l.mesh.count;
    }
  });
  return {lots, tri};
}

test('LE PLAFOND DE LOTS tient quel que soit le nombre d apparences', () => {
  // LE DEFAUT QUE CE PLAFOND FERME, mesure dans le vrai editeur : le decoupage spatial se
  // multiplie par le nombre d'APPARENCES. Seize groupes decoupes en neuf cellules font 144
  // lots, donc 144 appels de dessin des qu'on cadre le niveau entier — contre 52 sans
  // decoupage. L'elimination ne rattrape pas ca quand on voit tout.
  //
  // Le budget est donc reparti entre les groupes : le decor regroupe ne peut jamais couter plus
  // de LOTS_MAX appels, quelle que soit la scene.
  const scene = new THREE.Scene();
  const objects = [];
  for(let i = 0; i < 4800; i++){
    // 24 apparences distinctes, etalees sur 600 x 600 : le pire cas pour le decoupage.
    const m = new THREE.Mesh(env.buildGeometry('cube').geo,
      new THREE.MeshStandardMaterial({color: 0x000100 * (i % 24) + 0x223344}));
    m.position.set((i % 70) * 8.6 - 300, 0, Math.floor(i / 70) * 8.6 - 300);
    m.userData.game = {layer: 0};
    scene.add(m);
    objects.push(m);
  }
  scene.updateMatrixWorld(true);
  env.instantiateStatic(scene, objects);
  const lots = env.summaryInstances().lots;
  console.log('  banc : 4800 objets, 24 apparences = ' + lots + ' lots (plafond '
    + env.LOTS_MAX + ')');
  assert.ok(lots <= env.LOTS_MAX,
    lots + ' lots pour ' + env.LOTS_MAX + ' autorises : le decoupage se multiplie par le '
    + 'nombre d apparences, et le decor coute plus d appels de dessin qu avant le regroupement');
  env.undoInstances();
});

test('un groupe SERRE n est pas decoupe, un groupe ETALE l est', () => {
  // LES DEUX BOUTS DE L'ARBITRAGE, et le second est celui qui m'a fait refaire la regle. Un
  // decoupage qui ne regarde que le NOMBRE d'objets taille une foret de 5 000 arbres serres sur
  // vingt metres en quatre-vingts lots dont aucun ne sera jamais ecarte — on les voit tous a la
  // fois, et l'on a remplace un appel de dessin par quatre-vingts. C'est la TAILLE des cellules
  // qui decide, bornee par leur peuplement.
  const serre = [], etale = [];
  for(let i = 0; i < 400; i++){
    const a = new THREE.Mesh(env.buildGeometry('cube').geo, new THREE.MeshStandardMaterial());
    a.position.set((i % 20) * 0.8, 0, Math.floor(i / 20) * 0.8);   // 16 x 16 unites
    a.updateMatrixWorld(true);
    serre.push(a);
    const b = new THREE.Mesh(env.buildGeometry('cube').geo, new THREE.MeshStandardMaterial());
    b.position.set((i % 20) * 30, 0, Math.floor(i / 20) * 30);     // 600 x 600 unites
    b.updateMatrixWorld(true);
    etale.push(b);
  }
  assert.equal(env.cellsOfGroup(serre).length, 1,
    'un groupe plus petit qu une cellule ne doit pas etre decoupe : on le voit en entier de '
    + 'toute facon, et chaque lot de plus est un appel de dessin de plus');
  assert.ok(env.cellsOfGroup(etale).length > 1,
    'un groupe etale sur 600 unites doit etre decoupe, sinon sa boite englobante couvre le '
    + 'niveau et plus rien ne peut etre ecarte du rendu');
});

test('LE DECOUPAGE SPATIAL rend les lots eliminables', () => {
  // SON PROPRE DECOR, carre et large — 2 400 caisses identiques sur 400 x 400. Le decor de
  // reference plus haut est une BANDE de 172 x 35, ou une seule cellule suffit a tout couvrir :
  // le test y passait de justesse et pour une mauvaise raison (la sphere englobante contenait
  // la camera). Un test qui passe par accident ne garde rien.
  const scene = new THREE.Scene();
  const objects = [];
  for(let i = 0; i < 2400; i++){
    const m = new THREE.Mesh(env.buildGeometry('cube').geo,
      new THREE.MeshStandardMaterial({color: 0x445566}));
    m.position.set((i % 49) * 8 - 196, 0, Math.floor(i / 49) * 8 - 196);
    m.userData.game = {layer: 0};
    scene.add(m);
    objects.push(m);
  }
  scene.updateMatrixWorld(true);
  env.instantiateStatic(scene, objects);

  const lots = env.engineInstances.lots;
  const total = lots.reduce((n, l) => n + triangles(l.mesh.geometry) * l.mesh.count, 0);
  assert.ok(lots.length > 1, 'un decor de 400 x 400 doit etre decoupe en plusieurs cellules');
  // LE DECOUPAGE NE DOIT PAS DEFAIRE LE REGROUPEMENT. Sans le plancher de peuplement, un decor
  // etale se taille en cellules d une poignee d objets : chacune tombe sous le seuil, plus rien
  // n est regroupe, et l on a 2 400 appels de dessin au lieu d une soixantaine.
  assert.equal(lots.reduce((n, l) => n + l.sources.length, 0), objects.length,
    'des objets sont sortis du regroupement : les cellules sont trop petites pour atteindre le '
    + 'seuil');
  assert.ok(lots.every((l) => l.mesh.frustumCulled),
    'un lot non eliminable est un lot dessine meme quand on lui tourne le dos');
  assert.ok(lots.every((l) => l.mesh.boundingSphere && l.mesh.boundingSphere.radius > 0),
    'sans sphere englobante calculee sur les INSTANCES, three garderait celle d un seul cube '
    + 'et ecarterait le lot des qu on ne vise pas exactement son origine');

  // La caméra au milieu du décor, regardant dans une direction : le cas de travail normal.
  const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 120);
  cam.position.set(0, 8, 0);
  cam.lookAt(0, 8, 60);
  const devant = vus(cam);
  console.log('  banc : 2400 caisses sur 400x400, ' + lots.length + ' lots');
  console.log('  banc : regard vers l avant   = ' + devant.lots + ' lots dessines, '
    + devant.tri + ' triangles sur ' + total);

  assert.ok(devant.lots <= lots.length / 2,
    devant.lots + ' lots dessines sur ' + lots.length + ' : l elimination ne fait presque '
    + 'rien, et l on paie le decoupage pour rien');
  assert.ok(devant.tri < total / 2,
    'plus de la moitie des triangles soumis alors qu on ne regarde qu une direction');

  // LA SPHERE ENGLOBANTE SUIT CE QUI BOUGE. Sans ce recalcul, un objet qu'un script emmene
  // ailleurs sortirait de la sphere de son lot : le lot entier serait ecarte des qu on ne
  // regarde plus sa position d origine, et tout le decor disparaitrait en tournant la camera.
  const lot = lots[0];
  const avant = lot.mesh.boundingSphere.radius;
  lot.sources[0].position.set(3000, 0, 3000);
  env.updateInstances();
  assert.ok(lot.mesh.boundingSphere.radius > avant * 2,
    'la sphere englobante n a pas suivi un objet parti a 3 000 unites : le lot sera ecarte du '
    + 'rendu alors qu une de ses instances est a l ecran');

  env.undoInstances();
});

// ---------- 5. Les systèmes qui tournaient à vide ----------

test('un systeme 2D ne parcourt RIEN dans une scene sans 2D', () => {
  // MESURE : le monde 2D et le tri par profondeur 2D coutaient ensemble 2,6 ms par image sur
  // une scene de 5 000 objets qui n'a pas une seule piece 2D. Ils parcouraient toute la scene
  // en appelant `getComponent('Tilemap')` sur chaque objet, pour ne trouver personne.
  const faux = [{name: 'a'}, {name: 'b'}, {name: 'c'}];
  // `Array.from` : le tableau nait dans le realm du `vm`, et `deepStrictEqual` compare les
  // prototypes — deux tableaux vides de realms differents ne sont pas egaux. Piege connu du
  // depot.
  assert.deepEqual(Array.from(env.Registry.nodesCarrying(faux, ['Collider2D', 'Tilemap'])), [],
    'la scene n a aucun composant 2D : le systeme ne doit rien avoir a parcourir');
});

test('un nom de composant INCONNU fait retomber sur le parcours complet', () => {
  // LE REPLI QUI EMPECHE LA PANNE SILENCIEUSE. Ecrire `'Sprite'` au lieu de `'SpriteRenderer'`
  // rendrait une liste vide, et le tri par profondeur 2D cesserait de tourner sans une erreur
  // ni rien a l'ecran pour le dire. C'est arrive a la premiere version de cet appel. On rend
  // donc la liste entiere : lent, et juste.
  const faux = [{name: 'a'}, {name: 'b'}];
  assert.deepEqual(Array.from(env.Registry.nodesCarrying(faux, ['CeComposantNExistePas'])), faux,
    'un nom de composant faux doit couter du temps, jamais un systeme qui s arrete');
});

test('les deux systemes 2D demandent bien des noms de composants EXISTANTS', () => {
  // Garde de source, et elle est la consequence directe du test precedent : le repli protege
  // de la panne, il ne protege pas de la lenteur. Si un de ces noms cesse d'exister, on veut
  // le savoir ici et pas six mois plus tard sur le profil d'un jeu.
  const connus = Array.from(env.Registry.classesByType.keys());
  assert.ok(connus.length > 10, 'les composants doivent etre charges pour que ce test compte');
  [['js/world-2d.js', ['Collider2D', 'Tilemap']],
   ['js/sprite-2d.js', ['SpriteRenderer', 'SpriteAnimator']]].forEach(([f, noms]) => {
    const src = lire(f);
    noms.forEach((n) => {
      assert.ok(connus.indexOf(n) !== -1, 'le composant « ' + n + ' » n existe plus');
      assert.ok(src.includes("'" + n + "'"),
        f + ' ne demande plus « ' + n + ' » au registre : soit il reparcourt toute la scene a '
        + 'chaque image, soit il ne voit plus ces objets');
    });
  });
});

// ---------- 6. Le coût par image du regroupement ----------

test('une image ou rien ne bouge ne reecrit AUCUNE matrice', () => {
  // `updateInstances` recompare les seize flottants de chaque source a chaque image : c'est
  // ce qui rend le regroupement sur automatique, et c'est mesure a 4,48 ms pour 5 000 objets.
  // Ce qu'on garde ici n'est pas le temps (non reproductible) mais l'ALGORITHME : un decor
  // immobile ne doit produire aucun televersement. Une regression qui reecrirait tout a chaque
  // image serait plusieurs fois plus chere, et strictement invisible a l'ecran.
  const releveLots = releve();
  const lots = env.engineInstances.lots;
  assert.ok(lots.length > 0, 'le decor doit etre regroupe pour que ce test veuille dire quelque chose');

  // ON LIT `version`, PAS `needsUpdate`. Dans three, `needsUpdate` d'un BufferAttribute est un
  // accesseur en ECRITURE SEULE : le relire rend toujours `undefined`. Une premiere version de
  // ce test comparait `needsUpdate` a une valeur fausse, et passait donc quoi qu'il arrive —
  // y compris quand un objet bougeait. `version` est le compteur que l'ecriture incremente,
  // et c'est la seule trace observable d'un televersement.
  const versions = () => lots.map((l) => l.mesh.instanceMatrix.version);
  const avant = versions();
  assert.ok(avant.every((v) => typeof v === 'number'),
    'instanceMatrix.version doit etre lisible, sinon ce test ne mesure rien');

  env.updateInstances();
  const immobile = versions().filter((v, i) => v !== avant[i]).length;
  assert.equal(immobile, 0,
    immobile + ' lots reecrits alors que rien n a bouge : le cout par image redeviendrait '
    + 'proportionnel au decor entier au lieu de ce qui s est deplace');

  // CONTRE-ESSAI, et il a servi : sans lui, ce test restait vert avec un `updateInstances` qui
  // n aurait rien fait du tout.
  const repere = versions();
  releveLots.objects[0].position.x += 5;
  env.updateInstances();
  const touches = versions().filter((v, i) => v !== repere[i]).length;
  assert.equal(touches, 1, 'un objet deplace doit faire reecrire son lot, et lui seul');
  env.undoInstances();
});
