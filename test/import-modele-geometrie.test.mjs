// moteur/test/import-modele-geometrie.test.mjs
//
// Les six réglages d'import ajoutés à l'onglet Modèle : conserver/trier la hiérarchie,
// normales, mode des normales, tangentes, UV de lightmap (js/model-import.js).
//
// Ce qui est vraiment mesuré ici, ce n'est pas « la case coche » : c'est que chaque réglage est
// RÉVERSIBLE et que le repli de hiérarchie ne déplace RIEN dans le monde. Un repli qui bouge les
// objets d'un demi-mètre, ou un dépliage qu'on ne peut plus défaire, seraient des destructions
// déguisées en réglages — et le fichier source, lui, n'est jamais relu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte } from './engine-env.mjs';

const env = creerContexte(['js/model-import.js', 'js/lightmap-bake.js']);
const THREE = env.THREE;

function arbreAvecNoeudVide(){
  const root = new THREE.Group();
  root.name = 'Racine';
  const vide = new THREE.Object3D();
  vide.name = 'Armature';
  vide.position.set(1, 2, 3);
  vide.scale.set(2, 2, 2);
  vide.rotation.set(0.3, 0.4, 0.5);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  mesh.name = 'Corps';
  mesh.position.set(0.5, 0, 0);
  vide.add(mesh);
  root.add(vide);
  root.updateMatrixWorld(true);
  return {root: root, vide: vide, mesh: mesh};
}

function mondeDe(o){
  o.updateMatrixWorld(true);
  return Array.from(o.matrixWorld.elements);
}

// Les tableaux fabriqués dans le contexte `vm` n'ont pas le prototype Array de ce realm-ci :
// `deepEqual` y voit deux objets de classes différentes. On compare donc des chaînes.
function noms(root){
  return root.children.map(function(o){ return o.name; }).join(',');
}

function presque(a, b, message){
  a.forEach(function(v, i){
    assert.ok(Math.abs(v - b[i]) < 1e-6, message + ' (élément ' + i + ' : ' + v + ' vs ' + b[i] + ')');
  });
}


// ---------- Hiérarchie ----------

test('replier un nœud vide ne déplace RIEN dans le monde', () => {
  const t = arbreAvecNoeudVide();
  const avant = mondeDe(t.mesh);

  env.applyModelHierarchy(t.root, {preserveHierarchy: false}, []);

  assert.equal(t.root.children.length, 1, 'le nœud vide doit avoir disparu');
  assert.equal(t.root.children[0], t.mesh, 'le maillage doit être remonté sur la racine');
  presque(mondeDe(t.mesh), avant,
    'la transformation du nœud replié doit être cuite dans son enfant');
});

test('reconserver la hiérarchie remet le nœud, à sa place et sans dérive', () => {
  const t = arbreAvecNoeudVide();
  const avant = mondeDe(t.mesh);

  env.applyModelHierarchy(t.root, {preserveHierarchy: false}, []);
  env.applyModelHierarchy(t.root, {preserveHierarchy: true}, []);

  assert.equal(t.root.children[0], t.vide, 'le nœud vide doit être revenu');
  assert.equal(t.vide.children[0], t.mesh, 'avec son enfant');
  presque(mondeDe(t.mesh), avant, 'et sans que le monde ait bougé d\'un iota');
});

test('un nœud cité par une animation n\'est JAMAIS replié', () => {
  const t = arbreAvecNoeudVide();
  const clip = new THREE.AnimationClip('marche', 1, [
    new THREE.VectorKeyframeTrack('Armature.position', [0, 1], [0, 0, 0, 0, 1, 0])
  ]);

  env.applyModelHierarchy(t.root, {preserveHierarchy: false}, [clip]);

  assert.equal(t.root.children[0], t.vide,
    'replier « Armature » casserait la piste qui l\'adresse par son nom');
});

test('un nœud qui porte quelque chose n\'est pas un nœud vide', () => {
  const root = new THREE.Group();
  const light = new THREE.PointLight();
  light.name = 'Lampe';
  light.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)));
  root.add(light);

  env.applyModelHierarchy(root, {preserveHierarchy: false}, []);

  assert.equal(root.children[0], light, 'une lumière n\'est pas un nœud d\'organisation');
});

test('le tri par nom range les enfants, et le décocher rend l\'ordre du fichier', () => {
  const root = new THREE.Group();
  ['zebre', 'alpha', 'Metal'].forEach(function(n){
    const o = new THREE.Object3D();
    o.name = n;
    root.add(o);
  });

  env.applyModelHierarchy(root, {sortHierarchy: true}, []);
  assert.equal(noms(root), 'Metal,alpha,zebre',
    'tri par points de code : les majuscules avant les minuscules, comme partout ailleurs');

  env.applyModelHierarchy(root, {sortHierarchy: false}, []);
  assert.equal(noms(root), 'zebre,alpha,Metal',
    'l\'ordre du fichier doit revenir tel quel');
});


// ---------- Normales ----------

function geoDeuxTrianglesInegaux(){
  // Deux triangles qui partagent l'arête 0–1, l'un minuscule dans le plan XZ, l'autre grand et
  // incliné : c'est exactement le cas où la pondération change le résultat.
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    0, 0, 0,   1, 0, 0,   0, 0, 0.05,   0, 4, -4
  ]), 3));
  geo.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 1, 0, 3]), 1));
  return geo;
}

test('le mode « aire » redonne exactement ce que calcule three', () => {
  const a = geoDeuxTrianglesInegaux();
  const b = geoDeuxTrianglesInegaux();
  b.computeVertexNormals();
  env.computeNormalsWeighted(a, 'area');
  presque(Array.from(a.attributes.normal.array), Array.from(b.attributes.normal.array),
    'computeVertexNormals() de three EST la pondération par l\'aire');
});

test('les quatre modes ne donnent pas le même résultat', () => {
  const vus = ['unweighted', 'area', 'angle', 'areaAngle'].map(function(mode){
    const g = geoDeuxTrianglesInegaux();
    env.computeNormalsWeighted(g, mode);
    return Array.from(g.attributes.normal.array).map(function(v){ return v.toFixed(4); }).join(',');
  });
  assert.equal(new Set(vus).size, 4,
    'quatre pondérations différentes doivent donner quatre jeux de normales différents');
});

test('un triangle dégénéré n\'écrit pas de NaN', () => {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    0, 0, 0,   1, 0, 0,   2, 0, 0
  ]), 3));
  geo.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2]), 1));
  env.computeNormalsWeighted(geo, 'areaAngle');
  Array.from(geo.attributes.normal.array).forEach(function(v){
    assert.ok(isFinite(v), 'un triangle plat ne doit pas produire de NaN : ' + v);
  });
});

test('« aucune » retire les normales, « importer » rend celles du fichier', () => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  const root = new THREE.Group();
  root.add(mesh);
  const origine = Array.from(mesh.geometry.attributes.normal.array);

  env.applyModelGeometry(root, {normals: 'calculate', normalsMode: 'unweighted'});
  assert.ok(mesh.geometry.attributes.normal, 'le calcul doit poser des normales');

  env.applyModelGeometry(root, {normals: 'none'});
  assert.equal(mesh.geometry.attributes.normal, undefined, '« aucune » doit retirer l\'attribut');

  env.applyModelGeometry(root, {normals: 'import'});
  presque(Array.from(mesh.geometry.attributes.normal.array), origine,
    'les normales du fichier doivent revenir intactes');
});

test('sans normales dans le fichier, « importer » en calcule quand même', () => {
  const geo = geoDeuxTrianglesInegaux();
  const root = new THREE.Group();
  root.add(new THREE.Mesh(geo));
  env.applyModelGeometry(root, {normals: 'import'});
  assert.ok(geo.attributes.normal, 'un maillage sans normales serait noir : il en faut');
});


// ---------- Tangentes ----------

test('les tangentes se calculent, se retirent, et le fichier reprend la main', () => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  const root = new THREE.Group();
  root.add(mesh);

  env.applyModelGeometry(root, {tangents: 'calculate'});
  assert.ok(mesh.geometry.attributes.tangent, 'le calcul doit poser des tangentes');

  env.applyModelGeometry(root, {tangents: 'none'});
  assert.equal(mesh.geometry.attributes.tangent, undefined, '« aucune » doit les retirer');

  env.applyModelGeometry(root, {tangents: 'import'});
  assert.equal(mesh.geometry.attributes.tangent, undefined,
    'le fichier n\'en avait pas : « importer » ne doit pas en inventer');
});

test('des tangentes incalculables sont DITES, pas tues', () => {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    0, 0, 0,  1, 0, 0,  0, 1, 0
  ]), 3));
  const root = new THREE.Group();
  root.add(new THREE.Mesh(geo));
  const r = env.applyModelGeometry(root, {tangents: 'calculate'});
  assert.equal(r.warnings.length, 1, 'sans index ni UV, il faut un avertissement');
  assert.match(r.warnings[0], /tangentes/);
});


// ---------- UV de lightmap ----------

function aireUv(geo, name){
  let s = 0;
  env.trianglesUv(geo, name, function(u0, v0, u1, v1, u2, v2){
    s += Math.abs((u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0)) * 0.5;
  });
  return s;
}

test('le dépliage passe le diagnostic de la cuisson, que les UV de texture échouent', () => {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  // Un carrelage : exactement ce que diagnostiqueUnfold doit refuser, et la raison d'être
  // du réglage (js/lightmap-bake.js va chercher `uv` faute de mieux).
  const uv = geo.attributes.uv;
  for(let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 4, uv.getY(i) * 4);
  assert.equal(env.diagnoseUnfold(geo, 'uv').ok, false,
    'le bac de test doit partir d\'un modèle dont les UV de texture NE conviennent PAS');

  const root = new THREE.Group();
  root.add(new THREE.Mesh(geo));
  env.applyModelGeometry(root, {lightmapUv: true});

  assert.ok(geo.attributes.uv1, 'le dépliage doit écrire uv1');
  assert.equal(env.diagnoseUnfold(geo, 'uv1').ok, true,
    'le dépliage doit tenir dans le carré unité sans recouvrement : '
    + env.diagnoseUnfold(geo, 'uv1').reason);
  assert.ok(aireUv(geo, 'uv1') > 0.05,
    'un dépliage qui n\'occupe presque rien gâcherait toute la résolution de la lightmap');
});

test('un cube donne six îlots — un par face', () => {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const r = env.unwrapLightmapUv(geo);
  assert.equal(r.charts, 6, 'six faces à 90° les unes des autres, donc six îlots');
});

test('les sommets dédoublés aux coutures sont rendus quand on décoche', () => {
  const geo = new THREE.SphereGeometry(1, 8, 6);
  const root = new THREE.Group();
  root.add(new THREE.Mesh(geo));
  const sommetsAvant = geo.attributes.position.count;
  const indexAvant = Array.from(geo.index.array);

  env.applyModelGeometry(root, {lightmapUv: true});
  assert.ok(geo.attributes.position.count >= sommetsAvant, 'le dépliage peut dédoubler');
  assert.equal(env.diagnoseUnfold(geo, 'uv1').ok, true, 'et reste un dépliage valable');

  env.applyModelGeometry(root, {lightmapUv: false});
  assert.equal(geo.attributes.position.count, sommetsAvant,
    'décocher doit rendre le nombre de sommets du fichier');
  assert.deepEqual(Array.from(geo.index.array), indexAvant,
    'et son index, sans quoi la géométrie serait définitivement abîmée');
  assert.equal(geo.attributes.uv1, undefined, 'le fichier n\'avait pas d\'uv1');
});

test('déplier deux fois de suite ne déplie pas le dépliage', () => {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const root = new THREE.Group();
  root.add(new THREE.Mesh(geo));
  env.applyModelGeometry(root, {lightmapUv: true});
  const premier = Array.from(geo.attributes.uv1.array);
  env.applyModelGeometry(root, {lightmapUv: true});
  presque(Array.from(geo.attributes.uv1.array), premier,
    'le second passage doit être un non-événement');
});

test('le dépliage efface les caches de cuisson, qui portaient sur les anciens UV', () => {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.userData.lightmapAtlas = {game: 'uv', scale: [1, 1], offset: [0, 0]};
  geo.userData.lightmapUvSource = {game: 'uv', values: new Float32Array(4)};
  env.unwrapLightmapUv(geo);
  assert.equal(geo.userData.lightmapAtlas, undefined,
    'garder l\'atlas ferait ranger un dépliage qui n\'existe plus');
  assert.equal(geo.userData.lightmapUvSource, undefined);
});

test('le rangement des îlots est déterministe — éditeur et jeu doivent tomber d\'accord', () => {
  const a = env.unwrapLightmapUv(new THREE.SphereGeometry(1, 8, 6));
  const g = new THREE.SphereGeometry(1, 8, 6);
  env.unwrapLightmapUv(g);
  assert.equal(a.charts, env.chartsOfGeometry(new THREE.SphereGeometry(1, 8, 6)).nCharts,
    'le découpage en îlots ne doit dépendre que de la géométrie');
  assert.ok(g.attributes.uv1, 'et le dépliage doit aboutir');
});


// ---------- Tangentes MikkTSpace ----------

test("MikkTSpace ecrit quatre composantes, toutes unitaires, aucune nulle", () => {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const r = env.computeTangentsMikkTSpace(geo);
  const attr = geo.attributes.tangent;
  assert.ok(r, "le calcul doit aboutir sur un cube");
  assert.equal(attr.itemSize, 4, "xyz + le sens de la bitangente");
  for(let i = 0; i < attr.count; i++){
    const l = Math.hypot(attr.getX(i), attr.getY(i), attr.getZ(i));
    assert.ok(Math.abs(l - 1) < 1e-3, "tangente non unitaire au sommet " + i + " : " + l);
    assert.ok(Math.abs(attr.getW(i)) === 1, "le sens vaut +1 ou -1");
  }
});

test("MikkTSpace accepte une geometrie NON indexee, que three refuse", () => {
  const geo = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
  assert.ok(env.computeTangentsMikkTSpace(geo), "il ne doit pas exiger d index");
  assert.ok(geo.attributes.tangent, "et poser des tangentes");
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1).toNonIndexed()));
  const warn = env.applyModelGeometry(root, {tangents: "calculate"}).warnings;
  assert.equal(warn.length, 1, "le calcul herite de three, lui, doit le DIRE");
  assert.match(warn[0], /index/);
});

test("MikkTSpace suit three de pres sur une sphere, sans sommet laisse a zero", () => {
  const a = new THREE.SphereGeometry(1, 16, 12);
  a.computeTangents();
  const b = new THREE.SphereGeometry(1, 16, 12);
  env.computeTangentsMikkTSpace(b);
  const ecarts = [];
  for(let i = 0; i < a.attributes.tangent.count; i++){
    const d = a.attributes.tangent.getX(i) * b.attributes.tangent.getX(i)
            + a.attributes.tangent.getY(i) * b.attributes.tangent.getY(i)
            + a.attributes.tangent.getZ(i) * b.attributes.tangent.getZ(i);
    ecarts.push(Math.acos(Math.max(-1, Math.min(1, d))) * 180 / Math.PI);
    const l = Math.hypot(b.attributes.tangent.getX(i), b.attributes.tangent.getY(i),
                         b.attributes.tangent.getZ(i));
    assert.ok(l > 0.5, "aucun sommet ne doit rester sans tangente (le shader en ferait du NaN)");
  }
  ecarts.sort((x, y) => x - y);
  // La mediane mesure l accord sur le corps du maillage ; les poles et la couture, eux, sont
  // precisement les endroits ou les deux algorithmes DOIVENT differer.
  assert.ok(ecarts[Math.floor(ecarts.length / 2)] < 2,
    "ecart median de " + ecarts[Math.floor(ecarts.length / 2)].toFixed(2) + " degres");
});

test("deux faces aux UV en MIROIR ne sont pas moyennees ensemble", () => {
  // Deux triangles cote a cote, meme plan, meme normale, mais les UV du second sont inverses
  // en U : leurs tangentes sont opposees et les moyenner donnerait zero des deux cotes.
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
    0, 0, 0,  1, 0, 0,  0, 1, 0,
    1, 0, 0,  2, 0, 0,  1, 1, 0
  ]), 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(new Float32Array([
    0, 0, 1,  0, 0, 1,  0, 0, 1,  0, 0, 1,  0, 0, 1,  0, 0, 1
  ]), 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([
    0, 0,  1, 0,  0, 1,
    1, 0,  0, 0,  1, 1
  ]), 2));
  env.computeTangentsMikkTSpace(geo);
  const t = geo.attributes.tangent;
  assert.ok(t.getX(0) > 0.9, "la premiere face regarde +X");
  assert.ok(t.getX(3) < -0.9, "la seconde, en miroir, regarde -X : " + t.getX(3));
});

test("la soudure rend la MEME tangente a deux sommets que le fichier a dedoubles", () => {
  // Meme position, meme normale, memes UV, mais deux index : ce que fait tout exporteur.
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
    0, 0, 0,  1, 0, 0,  0, 1, 0,
    1, 0, 0,  1, 1, 0,  0, 1, 0
  ]), 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(new Float32Array([
    0, 0, 1,  0, 0, 1,  0, 0, 1,  0, 0, 1,  0, 0, 1,  0, 0, 1
  ]), 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([
    0, 0,  1, 0,  0, 1,
    1, 0,  1, 1,  0, 1
  ]), 2));
  env.computeTangentsMikkTSpace(geo);
  const t = geo.attributes.tangent;
  presque([t.getX(1), t.getY(1), t.getZ(1)], [t.getX(3), t.getY(3), t.getZ(3)],
    "les deux copies du meme sommet doivent porter la meme tangente");
});

test("changer de mode de tangentes repart toujours du fichier", () => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  const root = new THREE.Group();
  root.add(mesh);
  const sommets = mesh.geometry.attributes.position.count;

  env.applyModelGeometry(root, {tangents: "mikktspace"});
  env.applyModelGeometry(root, {tangents: "calculate"});
  env.applyModelGeometry(root, {tangents: "import"});
  assert.equal(mesh.geometry.attributes.tangent, undefined,
    "le fichier n en avait pas : rien ne doit rester");
  assert.equal(mesh.geometry.attributes.position.count, sommets,
    "et aucun sommet dedouble ne doit survivre a la serie");
});

test("cuire les unites ne change pas les tangentes ni le depliage", () => {
  const root = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  root.add(mesh);
  env.applyModelGeometry(root, {tangents: "mikktspace", lightmapUv: true});
  const uvAvant = Array.from(mesh.geometry.attributes.uv1.array);
  const tanAvant = Array.from(mesh.geometry.attributes.tangent.array);
  env.bakeScaleModel(root, 0.01);
  presque(Array.from(mesh.geometry.attributes.uv1.array), uvAvant,
    "une mise a l echelle uniforme ne change pas un depliage");
  presque(Array.from(mesh.geometry.attributes.tangent.array), tanAvant,
    "ni des tangentes, qui sont des directions");
});


// ---------- Poids de peau ----------

/** Une geometrie skinnee dont les poids d un sommet ne somment pas a 1 (le cas FBX tronque). */
function geoSkinnee(poids){
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3));
  geo.setAttribute("skinIndex", new THREE.BufferAttribute(new Uint16Array(poids.length), 4));
  geo.setAttribute("skinWeight", new THREE.BufferAttribute(new Float32Array(poids), 4));
  return geo;
}

test("des poids tronques par le chargeur sont RENORMALISES, meme a la limite de 4", () => {
  // Ce que FBXLoader laisse derriere lui : il garde les quatre plus forts et ne renormalise pas.
  const geo = geoSkinnee([0.4, 0.3, 0.15, 0.1]);   // somme 0,95
  const r = env.applySkinWeights(geo, 4);
  assert.equal(r.renormalized, 1, "le sommet devait etre renormalise");
  assert.equal(r.clamped, 0, "rien n avait a etre tronque a la limite de 4");
  const w = geo.attributes.skinWeight.array;
  const somme = w[0] + w[1] + w[2] + w[3];
  assert.ok(Math.abs(somme - 1) < 1e-6, "somme apres renormalisation : " + somme);
  assert.ok(Math.abs(w[0] - 0.4 / 0.95) < 1e-6, "les proportions sont conservees");
});

test("des poids deja normalises ne sont pas touches", () => {
  const geo = geoSkinnee([0.5, 0.3, 0.2, 0]);
  const r = env.applySkinWeights(geo, 4);
  assert.equal(r.renormalized, 0);
  assert.equal(geo.attributes.skinWeight.array[0], 0.5);
});

test("limiter a 2 os garde les DEUX plus forts et renormalise", () => {
  const geo = geoSkinnee([0.1, 0.5, 0.15, 0.25]);
  const r = env.applySkinWeights(geo, 2);
  assert.equal(r.clamped, 1);
  const w = geo.attributes.skinWeight.array;
  assert.equal(w[0], 0, "0,1 est le plus faible : il tombe");
  assert.equal(w[2], 0, "0,15 aussi");
  assert.ok(Math.abs(w[1] - 0.5 / 0.75) < 1e-6, "0,5 renormalise");
  assert.ok(Math.abs(w[3] - 0.25 / 0.75) < 1e-6, "0,25 renormalise");
  assert.ok(Math.abs(w[0] + w[1] + w[2] + w[3] - 1) < 1e-6);
});

test("un sommet sans aucun poids n est pas divise par zero", () => {
  const geo = geoSkinnee([0, 0, 0, 0]);
  env.applySkinWeights(geo, 4);
  Array.from(geo.attributes.skinWeight.array).forEach(function(v){
    assert.ok(isFinite(v), "aucun NaN : " + v);
  });
});

test("changer la limite repart des poids du FICHIER, pas des poids deja coupes", () => {
  const root = new THREE.Group();
  const mesh = new THREE.Mesh(geoSkinnee([0.4, 0.3, 0.2, 0.1]));
  root.add(mesh);
  env.applyModelGeometry(root, {skinWeights: 1});
  assert.equal(mesh.geometry.attributes.skinWeight.array[0], 1, "un seul os : il prend tout");
  env.applyModelGeometry(root, {skinWeights: 4});
  const w = mesh.geometry.attributes.skinWeight.array;
  assert.ok(Math.abs(w[0] - 0.4) < 1e-6 && Math.abs(w[3] - 0.1) < 1e-6,
    "revenir a 4 doit rendre les quatre influences du fichier");
});

test("une geometrie non skinnee traverse la passe sans rien", () => {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  assert.equal(env.applySkinWeights(geo, 2), null);
});
