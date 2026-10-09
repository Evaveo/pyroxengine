import { deEsm } from './engine-env.mjs';
// La cuisson elle-même a besoin d'un GPU : elle n'est pas testable ici, et le prétendre
// serait pire que ne rien tester. Ce qui EST testable, c'est tout ce qui l'entoure et qui
// décide de la justesse du résultat — le diagnostic de dépliage, le rangement dans
// l'atlas, sa persistance, et la dilatation. Chacune de ces pièces peut produire une image
// plausible et fausse ; c'est exactement pour ça qu'elles sont ici.
//
// Le module est chargé dans un contexte `vm` avec le VRAI three vendorisé (les calculs
// d'aire passent par Vector3/Matrix4) et le vrai potpack. Aucune dépendance npm.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { embeddedInBuild } from './build-modules.mjs';

const racineMoteur = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(racineMoteur, f), 'utf8');

// Retire les commentaires de ligne AVANT d'inspecter du code, et ce n'est pas une précaution
// théorique : `/a\.cuite/` trouvait « (`a.cuite`, posé par createAssetTexture… » dans le
// commentaire qui explique la condition, si bien que la garde survivait intacte à une mutation
// qui retirait la condition elle-même. Une assertion qui lit la prose au lieu du code est une
// garde incapable d'échouer — et ce dépôt en commente beaucoup, donc le risque est partout.
const codeSeul = (src) => src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

function contexte(){
  const bac = {console, setTimeout, Math, JSON, Set, Map, Float32Array, Array, Object, Error};
  bac.window = bac; bac.self = bac; bac.globalThis = bac;
  const ctx = vm.createContext(bac);
  vm.runInContext(deEsm(read('vendor/three.min.js')), ctx, {filename:'vendor/three.min.js'});
  vm.runInContext(deEsm(read('vendor/potpack.js')), ctx, {filename:'vendor/potpack.js'});
  // TSL n'est pas chargeable hors navigateur (bundle ESM) : seules les fonctions qui n'y
  // touchent pas sont exercées ici. buildMaterialBake() est laissée de côté, et
  // c'est dit plutôt que masqué par un faux TSL qui ferait croire à une couverture.
  vm.runInContext(deEsm(read('js/lightmap-rgbm.js')), ctx, {filename:'js/lightmap-rgbm.js'});
  // AVANT la cuisson : depuis la v0.149.3, la transformée d'UV d'un atlas vit dans son propre
  // module partagé (js/lightmap-atlas.js), pour que le JEU PUBLIÉ sache la reposer — ce
  // fichier de cuisson-ci importe douze modules d'éditeur et ne peut pas être embarqué.
  vm.runInContext(deEsm(read('js/lightmap-atlas.js')), ctx, {filename:'js/lightmap-atlas.js'});
  // LE VRAI MODULE, pas un substitut. La cuisson detache la geometrie d'un maillage avant
  // d'y ecrire `uv1`, parce que les primitives en partagent une par forme
  // (js/primitive-geometry.js). Un `geometryForWrite` de complaisance pose dans ce bac a
  // sable rendrait le test vert quel que soit l'etat du partage — exactement le piege que
  // test/globales-non-declarees.test.mjs a ete ecrit pour rattraper.
  vm.runInContext(deEsm(read('js/primitive-geometry.js')), ctx,
    {filename:'js/primitive-geometry.js'});
  vm.runInContext(deEsm(read('js/lightmap-bake.js')), ctx, {filename:'js/lightmap-bake.js'});
  return ctx;
}

// Fabrique une géométrie plate avec les UV donnés (triangle par triangle, non indexée).
function geoAvecUv(ctx, uvs, positions){
  const T = ctx.THREE;
  const g = new T.BufferGeometry();
  const n = uvs.length / 2;
  const pos = positions || (function(){
    const p = new Float32Array(n * 3);
    for(let i = 0; i < n; i++){ p[i*3] = uvs[i*2]; p[i*3+2] = uvs[i*2+1]; }
    return p;
  })();
  g.setAttribute('position', new T.BufferAttribute(pos, 3));
  g.setAttribute('uv', new T.BufferAttribute(new Float32Array(uvs), 2));
  return g;
}

// Un quad unitaire : deux triangles couvrant exactement [0,1]², donc aire UV = 1.
const QUAD = [0,0, 1,0, 1,1,  0,0, 1,1, 0,1];

// Contexte pour le rebond. Le GPU n'est pas là, mais ce qui décide de la JUSTESSE du rebond
// n'est pas le render : c'est l'état de la scène AU MOMENT de la capture. On garde donc la
// vraie CubeCamera de three et on ne remplace que le renderer, dont le `render` sert de
// mouchard : il note ce que la caméra aurait photographié.
//
// LIMITE ASSUMÉE : rien ici ne prouve que la capture contient la bonne image — ça demande un
// GPU, et c'est mesuré à la main dans le navigateur. Ce qui est prouvé ici, c'est que les
// lampes sont éteintes, que la lightmap est bien posée, et que tout est rendu ensuite.
function contexteRebond(){
  const ctx = contexte();
  const bac = ctx;
  const T = ctx.THREE;
  const journal = {captures:[], sondesRetirees:0, sondesRemises:0};
  bac.LAYER_HELPERS = 31;
  bac.listMats = (m) => Array.isArray(m.material) ? m.material : (m.material ? [m.material] : []);
  bac.acceptsEnvironment = (m) => !!m && m.isMeshStandardMaterial === true;
  bac.removeProbesOfMaterials = () => { journal.sondesRetirees++; };
  bac.applyProbes = () => { journal.sondesRemises++; };
  bac.createTargetCube = () => ({texture:{generateMipmaps:false}, dispose(){}});
  bac.renderer = {
    getRenderTarget: () => null,
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    // CubeCamera.update() recopie ce champ puis le valide : absent, elle refuse de tourner.
    coordinateSystem: T.WebGLCoordinateSystem,
    xr: {enabled:false},
    setRenderTarget(){},
    render(scene){
      // L'instantané qui compte : ce que la scène est PENDANT la capture.
      const lampes = [];
      scene.traverse((x) => { if(x.isLight) lampes.push(x.intensity); });
      const cartes = [], versions = [];
      scene.traverse((x) => {
        if(!x.isMesh) return;
        bac.listMats(x).forEach((m) => {
          cartes.push(m.lightMap ? m.lightMap.__nom : null);
          // Relevée ICI et pas après le retour : la restauration invalide elle aussi les
          // matériaux, donc une mesure faite à la end ne saurait pas distinguer les deux.
          versions.push(m.version);
        });
      });
      journal.captures.push({lampes, cartes, versions,
                             sondesRetireesAvant:journal.sondesRetirees});
    }
  };
  bac.scene = new T.Scene();
  return {ctx, journal, T};
}

// Un maillage standard + une lampe, dans la scène du contexte.
function sceneRebond(ctx, T){
  const mat = new T.MeshStandardMaterial();
  mat.isMeshStandardMaterial = true;
  const mesh = new T.Mesh(new T.PlaneGeometry(1, 1), mat);
  const lampe = new T.DirectionalLight(0xffffff, 3);
  ctx.scene.add(mesh);
  ctx.scene.add(lampe);
  return {mesh, mat, lampe};
}

test('un depliage valide pass, et le quad unitaire tombe pile a 1', () => {
  const ctx = contexte();
  const g = geoAvecUv(ctx, QUAD);
  assert.equal(+ctx.areaUvTotal(g, 'uv').toFixed(6), 1,
    'deux triangles couvrant le carré unité doivent totaliser exactement 1 — si ce number '
    + 'dérive, le seuil du diagnostic ne veut plus rien dire');
  assert.equal(ctx.diagnoseUnfold(g, 'uv').ok, true);
});

test('six faces dans le meme carre UV sont REJETEES — le cas du cube', () => {
  // C'est le cas réel : BoxGeometry mappe chacune de ses six faces sur [0,1]². Mesuré dans
  // l'éditeur, la région d'atlas du cube ressortait uniformément à une seule valeur — une
  // face avait écrasé les cinq autres. Sans ce diagnostic, rien ne l'aurait dit.
  const ctx = contexte();
  const six = [];
  for(let f = 0; f < 6; f++) six.push(...QUAD);
  const g = geoAvecUv(ctx, six);
  assert.equal(+ctx.areaUvTotal(g, 'uv').toFixed(4), 6);
  const d = ctx.diagnoseUnfold(g, 'uv');
  assert.equal(d.ok, false, 'une aire UV de 6 ne peut PAS tenir dans le carré unité');
  assert.match(d.reason, /recouvrent/);
});

test('des UV qui sortent du carre unite sont rejetees AVANT le test d area', () => {
  // Un carrelage 3×3 a une aire de 9 : les deux tests le condamnent. On veut le message du
  // bon, parce que « vos UV sortent du carré » se corrige, « vos îlots se recouvrent » fait
  // chercher au bad endroit.
  const ctx = contexte();
  const g = geoAvecUv(ctx, QUAD.map((v) => v * 3));
  const d = ctx.diagnoseUnfold(g, 'uv');
  assert.equal(d.ok, false);
  assert.match(d.reason, /carré unité/, 'le diagnostic de bounds doit primer sur celui d’area');
});

test('le test d area est SAIN : il ne crie jamais a tort sur un depliage serre', () => {
  // Deux îlots disjoints occupant chacun la moitié du carré : area = 1, aucun recouvrement.
  // Un seuil mal posé (< 1 au lieu de > 1) ferait échouer ce cas parfaitement légitime.
  const ctx = contexte();
  const left = [0,0, .5,0, .5,1,  0,0, .5,1, 0,1];
  const right = left.map((v, i) => (i % 2 === 0) ? v + .5 : v);
  const g = geoAvecUv(ctx, left.concat(right));
  assert.equal(ctx.diagnoseUnfold(g, 'uv').ok, true,
    'deux îlots disjoints de surface totale 1 sont un dépliage PARFAIT — les rejeter '
    + 'rendrait la garde inutilisable');
});

test('l atlas donne plus de place a la plus grande surface', () => {
  // L'exemple de three donne 1×1 à tout le monde (son propre TODO l'admet) : un sol et un
  // boulon recevaient la même résolution. On vérifie le rapport, pas seulement l'ordre.
  const ctx = contexte(), T = ctx.THREE;
  const grand = new T.Mesh(geoAvecUv(ctx, QUAD));
  grand.scale.set(10, 1, 10);            // 100× l'aire du petit
  const petit = new T.Mesh(geoAvecUv(ctx, QUAD));
  [grand, petit].forEach((m) => m.updateWorldMatrix(true, false));
  ctx.setAtlasLightmap([grand, petit], 1024);
  const eG = Math.abs(grand.geometry.userData.lightmapAtlas.scale[0]);
  const eP = Math.abs(petit.geometry.userData.lightmapAtlas.scale[0]);
  // Côté ∝ √area : un rapport d'aires de 100 doit donner un rapport de côtés de 10.
  assert.ok(eG / eP > 8 && eG / eP < 12,
    'le côté réservé doit suivre √area — rapport obtenu ' + (eG / eP).toFixed(2) + ', attendu ~10');
});

test('cuire deux fois ne retrecit pas les ilots', () => {
  // Le piège de la deuxième cuisson : sans mémoire du dépliage d'origine, on rangerait dans
  // l'atlas un uv1 DÉJÀ rangé. Les îlots rétréciraient à chaque passe jusqu'à disparaître,
  // et l'image resterait plausible tout du long.
  const ctx = contexte(), T = ctx.THREE;
  const m = new T.Mesh(geoAvecUv(ctx, QUAD));
  m.updateWorldMatrix(true, false);
  ctx.setAtlasLightmap([m], 1024);
  const premier = Array.from(m.geometry.attributes.uv1.array);
  ctx.setAtlasLightmap([m], 1024);
  const second = Array.from(m.geometry.attributes.uv1.array);
  assert.deepEqual(second, premier,
    'la deuxième cuisson doit repartir du dépliage d’ORIGINE, pas du précédent atlas');
});

test('l atlas survit a un rechargement de project', () => {
  // Ce que la sérialisation persiste, ce sont quatre nombres. On vérifie qu'ils suffisent :
  // rejoués sur un objet neuf portant le même dépliage, ils doivent redonner le MÊME uv1.
  // Sinon, rouvrir un project cuit replaque la lightmap ailleurs — en silence, puisque
  // l'attribut uv1 existe et qu'aucun autre contrôle ne regarde SA valeur.
  const ctx = contexte(), T = ctx.THREE;
  const cuit = new T.Mesh(geoAvecUv(ctx, QUAD));
  cuit.updateWorldMatrix(true, false);
  ctx.setAtlasLightmap([cuit], 1024);
  const attendu = Array.from(cuit.geometry.attributes.uv1.array);
  const persiste = ctx.collectAtlasLightmap(cuit);
  assert.ok(persiste && persiste.length >= 1, 'rien à persister : la lightmap serait perdue');

  const recharge = new T.Mesh(geoAvecUv(ctx, QUAD));   // comme relu d'un .glb : pas d'uv1 d'atlas
  recharge.userData.lightmapAtlas = JSON.parse(JSON.stringify(persiste));
  ctx.reapplyAtlasLightmap(recharge);
  assert.deepEqual(Array.from(recharge.geometry.attributes.uv1.array), attendu,
    'les quatre nombres persistés ne reproduisent pas le rangement d’origine');
});

test('la dilatation etale les bords sans inventer de light', () => {
  const ctx = contexte();
  const R = 8;
  const px = new Float32Array(R * R * 4);
  // Un seul texel écrit, au centre, alpha 1.
  const c = (3 * R + 3) * 4;
  px[c] = 0.8; px[c+1] = 0.4; px[c+2] = 0.2; px[c+3] = 1;
  ctx.dilate(px, R, 1);
  const voisin = ((3 * R) + 4) * 4;
  assert.ok(px[voisin] > 0, 'le voisin d’un texel écrit doit être rempli — sans ça, liseré '
    + 'noir sur toutes les coutures');
  assert.equal(+px[voisin].toFixed(4), 0.8, 'la valeur recopiée doit être celle du voisin, pas une moyenne inventée');
  // Un texel à deux cases de distance reste empty après UNE passe : la dilatation ne doit pas
  // repeindre tout l'atlas.
  const loin = ((3 * R) + 6) * 4;
  assert.equal(px[loin], 0, 'une seule passe ne doit pas s’étendre au-delà des voisins directs');
});

test('la boucle de rendu se suspend APRES avoir consomme le temps', () => {
  // Placé avant la lecture de l'horloge, le garde-fou laisserait le temps de la cuisson
  // s'accumuler : une cuisson de trente secondes ressortirait en un dt de trente secondes à
  // la reprise, la caméra sauterait et la physique intégrerait une demi-minute d'un coup.
  // C'est le même piège que l'init WebGPU, déjà traité par l'amorçage de l'horloge.
  const src = read('js/viewport.js');
  const iSuspend = src.indexOf('if(lightmapBakeState.active) return;');
  const iTemps = src.indexOf('const dt = clock.getDelta();');
  assert.ok(iSuspend > 0, 'la boucle ne se suspend plus pendant une cuisson : elle afficherait '
    + 'le rendu en space UV dans la fenêtre d’édition');
  assert.ok(iTemps > 0 && iSuspend > iTemps,
    'la suspension doit venir APRÈS la lecture du temps, sinon la durée de la cuisson '
    + 'ressort d’un bloc à la reprise');
});

test('LE piege du bounce : les lampes sont ETEINTES pendant la capture', () => {
  // La lightmap posée porte déjà l'éclairage direct. Laisser les lampes allumées le ferait
  // compter deux fois — une fois par elles, une fois par la map — et le rebond sortirait
  // deux fois trop fort. Avec une image parfaitement crédible : c'est précisément pour ça
  // que ce test existe plutôt qu'un contrôle à l'œil.
  const {ctx, journal, T} = contexteRebond();
  const {lampe, mat} = sceneRebond(ctx, T);
  const map = {channel:0, __nom:'L1'};
  ctx.captureEnvironmentBounce([ctx.scene.children[0]], map, 64);

  assert.equal(journal.captures.length > 0, true, 'aucune capture n’a eu lieu');
  journal.captures.forEach((c, i) => {
    assert.deepEqual(c.lampes, c.lampes.map(() => 0),
      'face ' + i + ' : une lampe est restée allumée pendant la capture — le direct sera '
      + 'compté deux fois et le rebond sortira deux fois trop fort');
  });
  assert.equal(lampe.intensity, 3, 'l’intensité d’origine n’a pas été rendue après la capture');
  assert.equal(mat.lightMap, null, 'la lightmap temporaire n’a pas été retirée du matériau');
});

test('la lightmap precedente est bien VUE par la capture', () => {
  // L'error symétrique : si la map n'est pas réellement posée au moment du rendu, le
  // rebond vaut zéro et l'image reste plausible — juste sans indirect.
  const {ctx, journal, T} = contexteRebond();
  const {mat} = sceneRebond(ctx, T);
  const versionAvant = mat.version;
  const map = {channel:0, __nom:'L1'};
  ctx.captureEnvironmentBounce([ctx.scene.children[0]], map, 64);
  assert.ok(journal.captures[0].cartes.includes('L1'),
    'la capture n’a pas vu la lightmap : le rebond serait nul, sans erreur');
  // Poser la map ne suffit PAS : add une map change le graphe de nœuds, et three ne
  // recalcule la clé de hidden que si la version du matériau a bougé. Sans invalidation, la
  // map est là et le shader l'ignore — rebond nul, aucune erreur.
  //
  // Deux versions de ce test ont échoué à le voir. La première s'arrêtait à l'assertion du
  // dessus. La seconde lisait `mat.version` APRÈS le retour de la fonction — or la
  // restauration invalide aussi les matériaux, donc la mutation « needsUpdate retiré »
  // passait toujours. Il faut la version RELEVÉE PENDANT la capture.
  assert.ok(journal.captures[0].versions.some((v) => v > versionAvant),
    'le matériau n’a pas été invalidé au moment de la capture : le shader garderait son '
    + 'old pipeline et ignorerait la lightmap tout juste posée');
  assert.equal(map.channel, 1,
    'la map doit être lue sur le 2ᵉ game d’UV, sinon la capture voit un éclairage plaqué '
    + 'n’importe où et le rebond diffuse cette erreur dans toute la scène');
});

test('au premier tour, sans lightmap, aucun materiau n est touche', () => {
  // La passe directe se capture aussi : elle ne rapporte que le ciel occulté. Toucher les
  // matériaux pour rien coûterait une recompilation de pipeline par matériau.
  const {ctx, journal, T} = contexteRebond();
  const {mat} = sceneRebond(ctx, T);
  // `needsUpdate` est un accesseur en ÉCRITURE seule : le relire donne toujours undefined.
  // L'observable, c'est `version`, que three incrémente à chaque invalidation.
  const versionAvant = mat.version;
  ctx.captureEnvironmentBounce([ctx.scene.children[0]], null, 64);
  assert.deepEqual(journal.captures[0].cartes, [null]);
  assert.equal(mat.version, versionAvant,
    'aucun matériau ne devait être invalidé : une recompilation de pipeline par matériau '
    + 'pour rien, à chaque passe');
});

test('la capture ne DEMONTE PAS les materiaux — les sondes restent en place', () => {
  // Ce test protège d'un plantage réel, et il dit l'inverse de ce que le bon sens suggère.
  //
  // La première version retirait les sondes pendant la capture, pour qu'elle ne contienne que
  // `albédo × lightmap`. C'était une exigence de pureté, pas de justesse : ce que les sondes
  // ajoutent, c'est le REBOND de la lumière du ciel — lumière qui n'est pas dans la lightmap,
  // donc aucun double comptage, et la série converge en albédo comme le reste.
  //
  // Et ça cassait. `removeProbesOfMaterials()` met `envMap` à `null` ; fait sur un matériau
  // dont le pipeline WebGPU est déjà construit — c'est-à-dire dès qu'une image a été rendue
  // entre deux cuissons — l'observateur de nœuds de three lit `isTexture` sur cette valeur
  // nulle et le rendu s'arrête. Mesuré : deux cuissons enchaînées passaient, les mêmes
  // séparées par un rendu tombaient dans la capture.
  //
  // Règle générale qui en sort : une capture ne doit modifier que des VALEURS (intensités,
  // cartes ajoutées), jamais la STRUCTURE d'un matériau déjà rendu.
  const {ctx, journal, T} = contexteRebond();
  sceneRebond(ctx, T);
  ctx.captureEnvironmentBounce([ctx.scene.children[0]], {channel:0, __nom:'L1'}, 64);
  assert.equal(journal.sondesRetirees, 0,
    'la capture retire à nouveau les sondes : `envMap = null` sur un pipeline déjà construit '
    + 'fait tomber le rendu de la cuisson suivante');
  assert.equal(journal.sondesRemises, 0,
    'rien ne devait être remis, puisque rien ne devait être retiré');
});

test('une capture qui echoue restaure quand meme la scene', () => {
  // Sans le `finally`, un plantage laisserait toutes les lampes à zéro et les matériaux
  // avec une lightmap temporaire : la scène de l'utilisateur, éteinte, sans message.
  const {ctx, T} = contexteRebond();
  const {lampe, mat} = sceneRebond(ctx, T);
  ctx.renderer.render = () => { throw new Error('GPU perdu'); };
  assert.throws(() => ctx.captureEnvironmentBounce([ctx.scene.children[0]],
    {channel:0, __nom:'L1'}, 64), /GPU perdu/);
  assert.equal(lampe.intensity, 3, 'la scène est restée éteinte après l’échec');
  assert.equal(mat.lightMap, null, 'la lightmap temporaire a survécu à l’échec');
});

// Contexte pour l'affectation : le registre d'assets et les deux façons de porter un
// matériau, sans trois ni GPU.
function contexteAffectation(){
  const ctx = contexte();
  const journal = {reappliques:[], statuts:[]};
  ctx.assets = [{id:'m1', kind:'material', props:{}}, {id:'m2', kind:'material', props:{}}];
  ctx.ensurePropsMaterial = (a) => a.props;
  ctx.applyMaterialEverywhere = (a) => journal.reappliques.push(a.id);
  ctx.setStatus = (t) => journal.statuts.push(t);
  ctx.listMats = (m) => Array.isArray(m.material) ? m.material : (m.material ? [m.material] : []);
  return {ctx, journal};
}
// Un maillage tel qu'un modèle importé en produit : le link vers l'asset est sur le
// MATÉRIAU, et rien dans la hiérarchie ne porte materialId.
function meshEmplacement(idAsset){
  const mat = idAsset ? {userData:{materialAsset:idAsset}} : {userData:{}};
  return {isMesh:true, material:mat, userData:{}, parent:{userData:{}, parent:null}};
}

test('un modele importe recoit la lightmap sur ses materiaux d EMPLACEMENT', () => {
  // Le défaut réel : `assignLightmapToMaterials` ne lisait que `userData.materialId`, en
  // remontant la hiérarchie. Un .glb était donc CUIT — ses maillages occupaient leur région
  // d'atlas et consommaient de la résolution — puis la lightmap allait ailleurs. Mesuré
  // avant correction dans l'éditeur : link présent, aucun materialId, lightmap non affectée,
  // aucun message.
  const {ctx, journal} = contexteAffectation();
  ctx.assignLightmapToMaterials([meshEmplacement('m1')], {id:'lm'});
  assert.equal(ctx.assets[0].props.lightmapAsset, 'lm',
    'le matériau d’emplacement n’a pas reçu la lightmap : un modèle importé serait cuit '
    + 'pour rien');
  assert.equal(ctx.assets[0].props.lightmapUv, 1, 'et sur le 2ᵉ game d’UV');
  assert.deepEqual(journal.reappliques, ['m1'], 'le matériau doit être réappliqué');
});

test('l affectation par OBJET continue de marcher', () => {
  // La correction ne doit pas déplacer le problème : les primitives portent leur matériau
  // sur l'object, pas sur le matériau.
  const {ctx} = contexteAffectation();
  const mesh = {isMesh:true, material:{userData:{}}, userData:{},
                parent:{userData:{materialId:'m2'}, parent:null}};
  ctx.assignLightmapToMaterials([mesh], {id:'lm'});
  assert.equal(ctx.assets[1].props.lightmapAsset, 'lm',
    'le matériau trouvé en remontant la hiérarchie n’a pas reçu la lightmap');
});

test('un emplacement reste sur le materiau DU FICHIER : compte et annonce', () => {
  // Il n'y a rien où écrire lightmapAsset : ce n'est pas un asset du project. Ces surfaces
  // sont cuites et resteront sans éclairage précalculé, au milieu de voisines qui en ont.
  // Le taire donnerait un défaut visible sans cause visible.
  const {ctx, journal} = contexteAffectation();
  const r = ctx.assignLightmapToMaterials([meshEmplacement(null)], {id:'lm'});
  assert.equal(r.orphelins, 1, 'l’emplacement sans asset n’est pas compté');
  assert.equal(r.materials, 0, 'aucun matériau de project n’était concerné');
  assert.equal(journal.statuts.length, 1, 'rien n’a été annoncé à l’utilisateur');
  assert.match(journal.statuts[0], /fichier de modèle/);
});

test('zero rebond est un reglage LEGITIME, pas une valeur absente', () => {
  // Le piège classique de `valeur || defaut` : 0 est faux en JS, donc « 0 rebond » — le seul
  // medium de cuire vite pour dégrossir — serait silencieusement remplacé par le défaut, et
  // l'utilisateur attendrait deux fois plus longtemps qu'il ne l'a demandé.
  //
  // LIGHTMAP_DEFAULT est une `const` : dans un script exécuté par `vm`, une liaison lexicale
  // n'est pas une propriété du global — seules les `function` le sont. On lit donc les défauts
  // par la fonction, ce qui a l'avantage de tester le chemin réel plutôt que la table.
  const ctx = contexte();
  ctx.project = {};
  const byDefault = ctx.settingsLightmap();

  // Sans cette assertion, le test passerait tout seul si le défaut valait déjà 0 : il ne
  // prouverait plus rien du tout.
  assert.notEqual(byDefault.bounces, 0,
    'le défaut de rebonds vaut 0 : ce test ne peut plus distinguer « réglé à 0 » de « absent »');

  ctx.project = {lightmap:{bounces:0, smooth:0}};
  const r = ctx.settingsLightmap();
  assert.equal(r.bounces, 0, '0 rebond doit être respecté, pas remplacé par le défaut');
  assert.equal(r.smooth, 0, '0 de douceur (ombres dures) doit être respecté aussi');
  // Les champs non fournis, eux, doivent bien retomber sur le défaut : une résolution ou un
  // number d'images nuls ne veulent rien dire, contrairement à 0 rebond.
  assert.equal(r.resolution, byDefault.resolution, 'un champ absent doit prendre le défaut');
  assert.equal(r.images, byDefault.images);
});

test('les reglages sont ceux du PROJET, pas de la machine', () => {
  // Deux personnes qui cuisent la même scène doivent obtenir la même image : les réglages
  // voyagent donc dans le project. Un project antérieur, qui n'a pas ce champ, cuit aux défauts.
  const ctx = contexte();
  ctx.project = {};
  const byDefault = ctx.settingsLightmap();
  assert.deepEqual(Object.keys(byDefault).sort(),
    ['bounces', 'denoise', 'images', 'resolution', 'rgbm', 'smooth'],
    'la shape des réglages a changé sans que la persistance suive — cette liste est ce qui '
    + 'voyage dans le project, la mettre à jour est le geste qui vérifie qu’on y a pensé');

  ctx.project = {lightmap:{resolution:2048}};
  const r = ctx.settingsLightmap();
  assert.equal(r.resolution, 2048, 'le réglage du project doit primer');
  assert.equal(r.images, byDefault.images, 'et n’emporter que lui');

  // Et le champ doit être écrit ET relu par la sérialisation, sinon les réglages ne
  // survivraient pas à une sauvegarde et le voisin cuirait autre chose.
  // Depuis le lot 3, le champ voyage dans `project.settings` : l'écriture est celle de
  // `settings` en bloc, la relecture celle d'`applyProjectSettings`, et c'est
  // `project-settings.js` qui garantit que `lightmap` en fait partie.
  const ser = read('js/serialization.js');
  assert.match(ser, /settings: JSON\.parse\(JSON\.stringify\(project\.settings\)\)/,
    'les réglages ne sont pas écrits');
  assert.match(ser, /applyProjectSettings\(isProject \? data : null\)/,
    'les réglages ne sont pas relus');
  assert.match(read('js/project-settings.js'), /lightmap:/,
    "lightmap n'est pas un réglage de projet");
});

test('le cout annonce suit la resolution ET les rebonds', () => {
  // Ce que l'utilisateur lit avant de lancer. Deux nombres, deux natures : les images coûtent
  // du temps, la résolution coûte de la mémoire — et c'est la seule des deux qui peut faire
  // tomber l'onglet, donc elle doit être juste.
  const ctx = contexte();
  const a = ctx.costBake({resolution:1024, images:240, bounces:1});
  assert.equal(a.passes, 2, '1 rebond = 2 passes');
  assert.equal(a.rendered, 2 * (240 + 6), 'chaque passe compte ses images plus les 6 faces de capture');
  // Deux targets flottantes RGBA : res² × 4 canaux × 4 octets × 2 = res² × 32.
  assert.equal(a.memoireMo, Math.round(1024 * 1024 * 32 / 1048576));
  const b = ctx.costBake({resolution:4096, images:240, bounces:1});
  assert.equal(b.memoireMo, 512, '4096² en flottant pèse un demi-gigaoctet — c’est CE chiffre '
    + 'qui doit alerter, et il doit être exact');
});

test('une texture remplacee n est liberee qu APRES le rebranchement', () => {
  // Défaut réel, et vicieux. `textureMaterial()` donne aux matériaux des CLONES, et un clone
  // three partage la `source` de l'original : libérer l'original sur place invalide tous les
  // clones encore branchés, et le renderer lit alors `isTexture` sur null. Confirmé par
  // l'expérience inverse — en neutralisant `Texture.dispose`, l'enchaînement repassait.
  const src = read('js/assets.js');
  const start = src.indexOf('function replaceContentAssetTexture(');
  assert.ok(start > 0, 'replaceContentAssetTexture a disparu');
  const body = codeSeul(src.slice(start, src.indexOf('\n}', start)));
  assert.doesNotMatch(body, /ancienne\.dispose\(\)/,
    'la texture remplacée ne doit PAS être libérée ici : des matériaux en partagent encore la '
    + 'source, et le rendu suivant tombe');
  assert.match(body, /texturesReplacedADispose\.push/,
    'elle doit être mise en pending de libération');
  // Et l'appelant doit vraiment clear la fichier, sinon on a juste transformé un plantage en fuite.
  const cuisson = read('js/lightmap-bake.js');
  const iAffecter = cuisson.indexOf('assignLightmapToMaterials(meshes, asset)');
  const iLiberer = cuisson.indexOf('disposeTexturesReplaced()');
  assert.ok(iLiberer > 0, 'personne ne libère la fichier : chaque cuisson fuirait une texture');
  assert.ok(iLiberer > iAffecter,
    'la libération doit venir APRÈS le rebranchement des matériaux, sinon elle invalide les '
    + 'clones qu’elle est censée remplacer');
});

test('recuire remplace la lightmap au lieu d en add une', () => {
  const src = read('js/lightmap-bake.js');
  const start = src.indexOf('async function exportLightmapInAsset(');
  const body = codeSeul(src.slice(start, src.indexOf('\n}', start)));
  assert.match(body, /replaceContentAssetTexture\(ancienne, file\)/,
    'sans remplacement, dix essais de réglage laissent dix textures mortes dans le project');
  // La marque `cuite` est ce qui protège une lightmap IMPORTÉE : même genre, souvent le même
  // name. La reconnaître au nom seul la détruirait au premier essai.
  // DEUX branches choisissent l'asset à écraser — HDR et 8 bits — et chacune doit filtrer sur
  // la marque. Une seule assertion `match` se contentait de la première trouvée, si bien que
  // unregister le filtre de l'autre branche passait inaperçu : on aurait écrasé une lightmap
  // importée dès qu'on cuisait dans cet encodage-là.
  const filters = (body.match(/&&\s*a\.cuite\s*&&/g) || []).length;
  assert.equal(filters, 2,
    'les deux branches (RGBM et 8 bits) doivent filtrer sur la marque `cuite` — ' + filters
    + ' trouvée(s). Sans le filtre, une lightmap importée depuis Blender est écrasée.');
  assert.match(body, /cuite:true/, 'et marquer ce qu’elle produit');
  // La marque doit survivre à la sauvegarde, sinon la cuisson suivante recrée un asset.
  const ser = read('js/serialization.js');
  assert.match(ser, /cuite:!!a\.cuite/, 'la marque n’est pas persistée');
  assert.match(ser, /cuite:!!da\.cuite/, 'la marque n’est pas relue');
});

test('la lightmap n est branchee qu une fois son image decodee', () => {
  // `createAssetTexture` charge en asynchrone : au retour, `texture.image` est nulle. Brancher
  // trop tôt fait planter le rendu suivant, qui lit `image.complete` sur null — mesuré, et ça
  // touchait aussi la boucle du viewport, pas seulement une seconde cuisson.
  const src = read('js/lightmap-bake.js');
  const iAttente = src.indexOf('await awaitAssetTextureReady(asset)');
  const iAffecter = src.indexOf('assignLightmapToMaterials(meshes, asset)');
  assert.ok(iAttente > 0, 'la cuisson n’attend plus le décodage de son image');
  assert.ok(iAttente < iAffecter,
    'l’pending doit précéder le branchement, sinon le rendu suivant lit `complete` sur null');
});

test('RGBM garde ce que 8 bits ecretait : les valeurs AU-DESSUS de 1', () => {
  // C'est la seule raison d'être de cet encodage. Une valeur de 5 doit revenir à 5, là où le
  // chemin 8 bits la rendait à 1,000 — et perdait du même coup toute nuance entre « lumineux »
  // et « éblouissant ».
  const ctx = contexte();
  const values = [0, 0.002, 0.05, 0.5, 1, 2, 5, 12, 40, 63];
  const R = values.length;
  const src = new Float32Array(R*R*4);
  for(let i = 0; i < R; i++){
    for(let c = 0; c < 3; c++) src[i*4+c] = values[i];
    src[i*4+3] = 1;
  }
  const bytes = ctx.encodeLightmapRgbm(src, R);
  const half = ctx.decodeLightmapRgbm(bytes, R, R);
  const fh = ctx.THREE.DataUtils.fromHalfFloat;
  values.forEach(function(v, i){
    const render = fh(half[i*4]);
    if(v === 0){
      assert.equal(render, 0, 'le noir doit rester exactement noir, sinon toute la scène est voilée');
      return;
    }
    const err = Math.abs(render - v) / v;
    assert.ok(err < 0.02, 'value ' + v + ' rendue ' + render.toFixed(4) + ' — error relative '
      + (err*100).toFixed(1) + ' %, au-delà des 2 % admis');
  });
});

test('encoder puis decoder ne retourne pas l image', () => {
  // Les DEUX fonctions retournent les lignes, pour deux raisons différentes : l'encodage parce
  // qu'une ImageData a sa ligne 0 en haut alors que le relevé l'a en v = 0, le décodage parce
  // qu'une DataTexture n'a pas le `flipY` d'une image. Retirer un seul des deux décale
  // l'éclairage sans lever la moindre erreur — et sur une scène symétrique, ça ne se voit même
  // pas. Un vrai défaut de ce genre a coûté une demi-journée dans cette version.
  const ctx = contexte();
  const R = 8;
  const src = new Float32Array(R*R*4);
  for(let y = 0; y < R; y++) for(let x = 0; x < R; x++){
    const i = (y*R+x)*4;
    for(let c = 0; c < 3; c++) src[i+c] = (y + 1) / R;   // gradient vertical : asymétrique
    src[i+3] = 1;
  }
  const half = ctx.decodeLightmapRgbm(ctx.encodeLightmapRgbm(src, R), R, R);
  const fh = ctx.THREE.DataUtils.fromHalfFloat;
  for(let y = 0; y < R; y++){
    const attendu = (y + 1) / R;
    const render = fh(half[(y*R)*4]);
    assert.ok(Math.abs(render - attendu) < 0.02,
      'line ' + y + ' : ' + render.toFixed(3) + ' au lieu de ' + attendu.toFixed(3)
      + ' — l’aller-retour retourne l’image, donc l’éclairage sera décalé');
  }
});

test('une lightmap RGBM est LINEAIRE, une lightmap importee est sRGB', () => {
  // Deux natures, deux traitements. Un RGBM n'est pas une couleur mais un encodage : le lire
  // en sRGB appliquerait une correction de gamma à des valeurs déjà mises à la racine carrée.
  // Une lightmap peinte dans Blender, elle, EST une image de couleur (v0.26.0).
  const rgbm = codeSeul(read('js/lightmap-rgbm.js'));
  assert.match(rgbm, /colorSpace = THREE\.NoColorSpace/,
    'la texture décodée doit être linéaire, sinon l’éclairage sort délavé');
  assert.match(rgbm, /flipY = false/, 'le retournement est déjà dans les données');
  const extraction = codeSeul(read('js/material-extraction.js'));
  assert.match(extraction, /prop:'lightmapAsset', label:'Lightmap',\s*type:'color'/,
    'une lightmap IMPORTÉE reste une texture de couleur — les deux cas doivent coexister');
});

test('le decodage RGBM est partage par l editeur ET le jeu publie', () => {
  // Trois endroits à tenir ensemble, et en oublier un ne casse rien à l'édition : c'est le jeu
  // publié qui perdrait son éclairage, découvert bien plus tard.
  assert.match(read('editor.html'), /lightmap-rgbm\.js/, 'l’éditeur ne charge pas le décodeur');
  assert.match(read('game-preview.html'), /lightmap-rgbm\.js/, 'l’aperçu de jeu ne le charge pas');
  const build = read('js/build.js');
  assert.ok(embeddedInBuild('js/lightmap-rgbm.js'), 'le build ne l’embarque pas dans le zip');
  // La balise est ÉMISE SOUS CONDITION depuis que le build allège les jeux publiés : un jeu sans
  // aucune lightmap RGBM n'a pas à télécharger son décodeur. Ce que la condition ne dispense PAS de
  // vérifier — et c'est tout l'objet des trois lignes qui suivent — c'est qu'une scène qui en a une
  // l'embarque bel et bien. Sans la déclaration dans build-trimming.js, `moduleEmbedded` ne
  // trouverait pas le module et il serait retiré de TOUS les jeux, silencieusement.
  assert.ok(/src="lightmap-rgbm\.js"/.test(build) || /emb\('lightmap-rgbm\.js'\)/.test(build),
    'et la page exportée ne le charge pas');
  const alle = read('js/build-trimming.js');
  assert.match(alle, /dans: 'lightmap-rgbm\.js'/,
    'balise conditionnelle mais module non déclaré : il serait retiré de tous les jeux');
  assert.match(alle, /a\.rgbm/, 'le besoin ne regarde pas les textures RGBM du project');
  assert.match(alle, /o\.lightmapAtlas/, 'le besoin ne regarde pas les objets porteurs d’une lightmap');
  // Les décodeurs sont concaténés APRÈS `BUILD_MODULES`, et leur décalage se lit sur la longueur
  // de la table. C'était un `iDecoders` calculé à la main quand il y avait deux listes
  // parallèles ; l'invariant reste, mais il ne dépend plus d'un index écrit ailleurs.
  assert.match(build, /textes\[BUILD_MODULES\.length \+ i\]/,
    'le décalage des décodeurs est figé : ajouter un module écrirait un contenu sous un autre nom');
  const rt = codeSeul(read('js/game-runtime.js'));
  assert.match(rt, /textureLightmapRgbm\(/, 'le runtime ne décode pas le RGBM');
});

test('le debruiteur enleve le bruit SANS manger le bord d ombre', () => {
  // Les deux moitiés de la vérité, et il faut les deux : un flou gaussien réussirait la
  // première et raterait la seconde — or c'est justement les bords d'ombre qu'on cuit.
  const ctx = contexte();
  const R = 32;
  const px = new Float32Array(R*R*4);
  const propre = new Float32Array(R*R*4);
  let graine = 12345;
  const alea = () => { graine = (graine * 1103515245 + 12345) & 0x7fffffff; return graine / 0x7fffffff; };
  for(let y=0;y<R;y++) for(let x=0;x<R;x++){
    const i = (y*R+x)*4;
    const marche = x < R/2 ? 0.2 : 1.0;                 // marche franche au milieu
    const bruit = (alea() - 0.5) * 0.12;
    for(let c=0;c<3;c++){ propre[i+c] = marche; px[i+c] = marche + bruit; }
    px[i+3] = 1; propre[i+3] = 1;
  }
  const gap = (a, b) => { let s = 0, n = 0;
    for(let i=0;i<R*R;i++){ s += Math.abs(a[i*4] - b[i*4]); n++; } return s/n; };
  const avant = gap(px, propre);
  ctx.denoiseBilateral(px, R, 2, 0.15);
  const apres = gap(px, propre);
  assert.ok(apres < avant * 0.7,
    'le bruit n’a pas diminué d’au moins 30 % (avant ' + avant.toFixed(4) + ', après '
    + apres.toFixed(4) + ')');

  // Le edge : on compare la marche restituée à la marche d'origine, sur la colonne juste à
  // gauche et juste à droite de la coupure. Un flou l'aurait rabotée.
  let left = 0, right = 0;
  for(let y=2;y<R-2;y++){
    left += px[(y*R + (R/2 - 1))*4];
    right += px[(y*R + (R/2))*4];
  }
  left /= (R-4); right /= (R-4);
  assert.ok(right - left > 0.6,
    'la marche a été rabotée (' + left.toFixed(3) + ' → ' + right.toFixed(3) + ', attendu '
    + 'un écart > 0,6 pour une marche de 0,8) : le filtre se comporte comme un flou');
});

test('les coutures sont detectees par la GEOMETRIE, pas par un seuil', () => {
  // Deux triangles qui partagent une arête en 3D mais sont posés loin l'un de l'autre dans
  // l'atlas : c'est la définition exacte d'une couture, et elle doit sortir. Un quad dont les
  // deux triangles se touchent dans l'atlas ne doit RIEN produire — sinon on raccorderait des
  // arêtes intérieures, ce qui reviendrait à flouter l'îlot le long de ses diagonales.
  const ctx = contexte(), T = ctx.THREE;
  const faire = (uvs) => {
    const g = new T.BufferGeometry();
    // Deux triangles partageant l'arête (0,0,0)-(1,0,0), en ENROULEMENT OPPOSÉ sur cette
    // arête — c'est ce que produit tout maillage correctement orienté, et c'est ce qui rend la
    // clé canonique nécessaire. Une première version de ce test listait l'arête dans le même
    // ordre des deux côtés : les clés coïncidaient par hasard, et le test ne pouvait plus voir
    // la disparition de la canonicalisation.
    g.setAttribute('position', new T.BufferAttribute(new Float32Array([
      0,0,0,  1,0,0,  0,0,1,
      1,0,0,  0,0,0,  0,0,-1]), 3));
    g.setAttribute('uv1', new T.BufferAttribute(new Float32Array(uvs), 2));
    return new T.Mesh(g);
  };
  // îlots éloignés : l'arête partagée est en bas à gauche pour l'un, en haut à droite pour l'autre
  const separe = faire([0,0, 0.2,0, 0,0.2,   1,0.8, 0.8,0.8, 0.8,1]);
  const cSep = ctx.seamsOfLAtlas([separe], 256);
  assert.equal(cSep.length, 1, 'la couture n’est pas détectée : les deux îlots resteront '
    + 'éclairés indépendamment et le trait sera visible sur le modèle');

  // Même arête, même place dans l'atlas : arête intérieure. Les UV suivent l'enroulement
  // inversé du second triangle — (1,0,0) y vient en premier — sinon les deux côtés auraient
  // réellement des UV différentes et seraient une couture, à juste title.
  const joint = faire([0,0, 0.2,0, 0,0.2,   0.2,0, 0,0, 0,-0.2]);
  assert.equal(ctx.seamsOfLAtlas([joint], 256).length, 0,
    'une arête intérieure a été prise pour une couture : la raccorder flouterait l’îlot');
});

test('le raccord fait CONVERGER les deux cotes d une couture', () => {
  const ctx = contexte();
  const R = 64;
  const px = new Float32Array(R*R*4);
  for(let i=0;i<R*R;i++) px[i*4+3] = 1;              // tout est « écrit »
  // Deux segments horizontaux, l'un clair l'autre sombre.
  const A = [[0.1, 0.25], [0.4, 0.25]];
  const B = [[0.1, 0.75], [0.4, 0.75]];
  const set = (seg, v) => {
    for(let k=0;k<=64;k++){ const t=k/64;
      const x = Math.round((seg[0][0] + (seg[1][0]-seg[0][0])*t) * R);
      const y = Math.round((seg[0][1] + (seg[1][1]-seg[0][1])*t) * R);
      const i = (y*R+x)*4; for(let c=0;c<3;c++) px[i+c] = v; }
  };
  set(A, 1.0); set(B, 0.2);
  const read = (seg) => { let s=0,n=0;
    for(let k=0;k<=64;k++){ const t=k/64;
      const x = Math.round((seg[0][0] + (seg[1][0]-seg[0][0])*t) * R);
      const y = Math.round((seg[0][1] + (seg[1][1]-seg[0][1])*t) * R);
      s += px[(y*R+x)*4]; n++; } return s/n; };
  const avant = Math.abs(read(A) - read(B));
  ctx.connectSeams(px, R, [[A, B]], 2);
  const apres = Math.abs(read(A) - read(B));
  assert.ok(avant > 0.7, 'le cas de départ ne présente pas de couture : le test ne prouve rien');
  assert.ok(apres < 0.02, 'les deux côtés n’ont pas convergé (écart ' + apres.toFixed(4) + ')');
});

test('le raccord ignore les texels VIDES', () => {
  // Moyenner avec du vide tirerait le bord vers le noir : on fabriquerait le liseré que la
  // dilatation existe pour enlever. Le bug serait invisible sauf le long des coutures.
  const ctx = contexte();
  const R = 32;
  const px = new Float32Array(R*R*4);
  const A = [[0.2, 0.3], [0.5, 0.3]];
  const B = [[0.2, 0.7], [0.5, 0.7]];
  for(let k=0;k<=32;k++){ const t=k/32;
    const x = Math.round((A[0][0] + (A[1][0]-A[0][0])*t) * R), y = Math.round(A[0][1]*R);
    const i = (y*R+x)*4; px[i]=px[i+1]=px[i+2]=0.9; px[i+3]=1;           // côté A : écrit
  }
  // côté B : jamais écrit (alpha 0)
  ctx.connectSeams(px, R, [[A, B]], 2);
  let minA = 1;
  for(let k=0;k<=32;k++){ const t=k/32;
    const x = Math.round((A[0][0] + (A[1][0]-A[0][0])*t) * R), y = Math.round(A[0][1]*R);
    minA = Math.min(minA, px[(y*R+x)*4]);
  }
  assert.equal(+minA.toFixed(4), 0.9,
    'le côté écrit a été assombri par du vide (' + minA.toFixed(4) + ' au lieu de 0,9)');
});

test('cuisson selective : les non-cuits sont rendus MUETS, pas invisibles', () => {
  // La différence fait tout : la passe d'ombre passe par le matériau de profondeur, qu'un
  // `colorWrite` n'affecte pas. Masqué, un mur non sélectionné ne projetterait plus son ombre
  // sur le sol qu'on cuit — et on aurait cuit un sol sans l'ombre de son mur, sans un mot.
  const src = codeSeul(read('js/lightmap-bake.js'));
  assert.match(src, /colorWrite = false/,
    'les objets non cuits ne sont plus rendus muets : ils se dessineraient dans l’atlas');
  assert.doesNotMatch(src, /p\[0\]\.visible = false/,
    'un objet non cuit est masqué : il perd son ombre, et la cuisson sélective ne vaut plus rien');
  assert.match(src, /depthWrite = false/,
    'sans couper la profondeur, un objet non cuit peut masquer un îlot entier');
});

test('editeur et jeu publie neutralisent tous deux le carrelage de la lightmap', () => {
  // Une lightmap est un dépliage par surface : elle n'hérite jamais du tiling du matériau.
  // Défaut réel de la v0.26.0, et il ne suffit pas de le corriger d'un côté — les deux
  // implémentations sont distinctes, et c'est la source de divergence n°1 de ce dépôt.
  [['js/materials.js', read('js/materials.js')],
   ['js/game-runtime.js', read('js/game-runtime.js')]].forEach(([name, src]) => {
    // Le branchement du RGBM écrit lui aussi `lightMapIntensity`, plus haut dans le fichier :
    // viser la PREMIÈRE occurrence tomberait sur la branche HDR, qui n'a pas de tuilage à
    // neutraliser (sa DataTexture n'en a jamais eu). C'est la branche 8 bits qu'on inspecte,
    // repérée par l'appel qui la caractérise.
    const anchor = name === 'js/materials.js' ? 'const tex = textureMaterial(p.lightmapAsset, p)'
                                            : 'textureMaterialRuntime(p.lightmapAsset, p)';
    const i = src.indexOf(anchor);
    assert.ok(i > 0, name + ' : block lightmap 8 bits introuvable (anchor « ' + anchor + ' »)');
    // Fenêtre large : le bloc porte plusieurs paragraphes de commentaire, et 700 caractères
    // s'arrêtaient avant le code qu'on cherche — le test échouait alors sur du texte, pas sur
    // un défaut.
    const block = src.slice(i, i + 1600);
    assert.match(block, /\.repeat\.set\(1, ?1\)/,
      name + ' : le carrelage n’est pas neutralisé — régler un tiling 2×2 sur la texture de '
      + 'base plaquerait l’éclairage du haut du mur en son milieu');
    assert.match(block, /\.offset\.set\(0, ?0\)/, name + ' : le décalage n’est pas neutralisé');
  });
});
