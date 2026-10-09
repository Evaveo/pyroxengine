// moteur/test/import-modele-inspecteur.test.mjs
//
// Le panneau d'import vu du côté de ce qu'il CHANGE : conversion d'unités, propagation aux
// instances déjà posées, et le brouillon (rien n'est appliqué avant « Appliquer »).
//
// Contexte minimal (même patron que test/animation-inspecteur.test.mjs) : import-settings.js
// branche ses écouteurs au chargement, il lui faut donc un panneau et un document bouchonnés.
// Tout le reste est VRAI — surtout `applyImportModel`, qui est ce qu'on mesure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deEsm } from './engine-env.mjs';

const racine = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const lire = (f) => readFileSync(path.join(racine, f), 'utf8');

function presque(a, b, message){
  a.forEach(function(v, i){
    assert.ok(Math.abs(v - b[i]) < 1e-6, message + ' (élément ' + i + ' : ' + v + ' vs ' + b[i] + ')');
  });
}

function contexteImport(){
  const bac = {console, Math, JSON, Set, Map, Array, Object, WeakMap, Float32Array,
               Int32Array, Uint16Array, Uint32Array, isFinite, parseFloat};
  bac.window = bac; bac.self = bac; bac.globalThis = bac;
  bac.objects = [];
  bac.assets = [];
  bac.updateProject = () => {};
  bac.applyFilters = () => {};
  bac.updateHierarchy = () => {};
  bac.previewObject3D = () => null;
  bac.setStatus = () => {};
  bac.pushHistory = () => {};
  bac.listMats = (m) => (Array.isArray(m.material) ? m.material : (m.material ? [m.material] : []));
  bac.isSceneObject = () => false;
  bac.escapeHtml = (x) => String(x);
  bac.NAMES_KIND = {model: 'Modèle 3D'};
  bac.Registry = {unindexNode(){}};
  // Les ecouteurs du panneau sont RETENUS : c'est le seul moyen de rejouer un clic sur un
  // onglet, qui n'a pas d'id et que la garde du handler avait avale (voir le test dedie).
  const ecouteurs = {};
  bac.inspBody = {
    addEventListener: (type, fn) => { (ecouteurs[type] = ecouteurs[type] || []).push(fn); },
    innerHTML: '', querySelectorAll: () => []
  };
  bac._emit = (type, target) => (ecouteurs[type] || []).forEach((fn) => fn({target: target}));
  bac.document = {addEventListener: () => {}, getElementById: () => null,
    querySelector: () => null, querySelectorAll: () => []};
  const ctx = vm.createContext(bac);
  vm.runInContext(deEsm(lire('vendor/three.min.js')), ctx, {filename:'vendor/three.min.js'});
  vm.runInContext(deEsm(lire('js/model-import.js')), ctx, {filename:'js/model-import.js'});
  // l'onglet Rig pose des Avatars : c'est humanoid-avatar.js qui les detecte et les valide
  vm.runInContext(deEsm(lire('js/humanoid-avatar.js')), ctx, {filename:'js/humanoid-avatar.js'});
  // autoMapAvatar normalise les noms d'os avec nameBoneNormalized (js/retargeting.js) : sans
  // lui, un os 'mixamorigHips' n'est reconnu par aucun alias.
  vm.runInContext(deEsm(lire('js/retargeting.js')), ctx, {filename:'js/retargeting.js'});
  vm.runInContext(deEsm(lire('js/import-settings.js')), ctx, {filename:'js/import-settings.js'});
  // cloneModel vient d'anim-models.js, qui traîne la moitié de l'éditeur derrière lui : le clone
  // nu suffit ici, aucun test de ce fichier n'a de squelette.
  ctx.cloneModel = (o) => o.clone(true);
  return ctx;
}

/** Un asset modèle minimal : une racine, un maillage décalé, comme au sortir d'un import. */
function assetModele(ctx, opts){
  const T = ctx.THREE;
  const root = new T.Group();
  root.name = 'Perso';
  const mesh = new T.Mesh(new T.BoxGeometry(1, 1, 1));
  mesh.name = 'Corps';
  mesh.position.set(2, 0, 0);
  root.add(mesh);
  return {id: 'a1', kind: 'model', name: 'Perso', template: root,
          unitFile: (opts && opts.unitFile) || 0.01, animationsBrutes: [],
          paramsImport: Object.assign({}, opts && opts.params)};
}


// ---------- Conversion d'unités ----------

test('convertir les unités laisse la racine à 1 et cuit le facteur dans la géométrie', () => {
  const ctx = contexteImport();
  const T = ctx.THREE;
  const a = assetModele(ctx, {params: {centrer: false, setGround: false, convertUnits: true}});
  ctx.applyImportModel(a, false);

  assert.equal(a.template.scale.x, 1,
    'c\'est tout l\'intérêt du réglage : l\'objet affiche 1, 1, 1 dans l\'inspecteur');
  const taille = new T.Box3().setFromObject(a.template).getSize(new T.Vector3());
  assert.ok(Math.abs(taille.x - 0.01) < 1e-6,
    'un cube d\'une unité dans un fichier en centimètres fait 1 cm : ' + taille.x);
});

test('les deux voies donnent la MÊME taille à l\'écran', () => {
  const ctx = contexteImport();
  const T = ctx.THREE;
  const sans = assetModele(ctx, {params: {centrer: false, setGround: false, convertUnits: false}});
  const avec = assetModele(ctx, {params: {centrer: false, setGround: false, convertUnits: true}});
  ctx.applyImportModel(sans, false);
  ctx.applyImportModel(avec, false);
  const t1 = new T.Box3().setFromObject(sans.template).getSize(new T.Vector3());
  const t2 = new T.Box3().setFromObject(avec.template).getSize(new T.Vector3());
  presque(t1.toArray(), t2.toArray(), 'la conversion ne change que le nombre affiché');
});

test('cocher la conversion compense l\'échelle des instances déjà posées', () => {
  const ctx = contexteImport();
  const T = ctx.THREE;
  const a = assetModele(ctx, {params: {centrer: false, setGround: false, convertUnits: false}});
  ctx.applyImportModel(a, false);

  const instance = a.template.clone(true);
  instance.userData.assetId = a.id;
  ctx.objects.push(instance);
  const avant = new T.Box3().setFromObject(instance).getSize(new T.Vector3()).x;

  a.paramsImport.convertUnits = true;
  ctx.applyImportModel(a, true);

  assert.ok(Math.abs(instance.scale.x - 1) < 1e-9,
    'l\'instance doit passer de 0,01 à 1 : ' + instance.scale.x);
  const apres = new T.Box3().setFromObject(instance).getSize(new T.Vector3()).x;
  assert.ok(Math.abs(avant - apres) < 1e-6,
    'et ne pas changer de taille pour autant (' + avant + ' vs ' + apres + ')');
});


// ---------- Ce que voient les instances ----------

test('trier la hiérarchie REBÂTIT les instances déjà dans la scène', () => {
  const ctx = contexteImport();
  const T = ctx.THREE;
  const a = assetModele(ctx, {params: {centrer: false, setGround: false}});
  ['zebre', 'alpha'].forEach(function(n){
    const o = new T.Object3D();
    o.name = n;
    a.template.add(o);
  });
  ctx.applyImportModel(a, false);

  const instance = a.template.clone(true);
  instance.userData.assetId = a.id;
  ctx.objects.push(instance);
  assert.equal(instance.children.map((c) => c.name).join(','), 'Corps,zebre,alpha');

  a.paramsImport.sortHierarchy = true;
  ctx.applyImportModel(a, true);

  assert.equal(a.template.children.map((c) => c.name).join(','), 'Corps,alpha,zebre',
    'le template est trié');
  assert.equal(instance.children.map((c) => c.name).join(','), 'Corps,alpha,zebre',
    'c\'est le défaut rapporté : l\'instance restait dans l\'ordre du fichier');
});

test('un objet de scène parenté sous une instance SURVIT à la reconstruction', () => {
  const ctx = contexteImport();
  const T = ctx.THREE;
  const a = assetModele(ctx, {params: {centrer: false, setGround: false}});
  ctx.applyImportModel(a, false);
  const instance = a.template.clone(true);
  instance.userData.assetId = a.id;
  ctx.objects.push(instance);
  const posee = new T.Object3D();
  posee.name = 'Torche';
  instance.add(posee);
  ctx.isSceneObject = (o) => o === posee;

  a.paramsImport.sortHierarchy = true;
  ctx.applyImportModel(a, true);

  assert.ok(instance.children.indexOf(posee) !== -1,
    'elle ne vient pas du modèle : la reconstruction ne doit pas l\'emporter');
});


// ---------- Le brouillon ----------

test('saisir ne change rien tant qu\'on n\'a pas appliqué', () => {
  const ctx = contexteImport();
  const a = assetModele(ctx, {params: {centrer: false, setGround: false}});
  ctx.applyImportModel(a, false);

  ctx.ensureDraft(a).scale = 4;
  assert.equal(ctx.importDirty(a), true, 'le panneau doit signaler des réglages non appliqués');
  assert.equal(a.paramsImport.scale, 1, 'les réglages appliqués, eux, n\'ont pas bougé');

  ctx.applyDraft(a);
  assert.equal(a.paramsImport.scale, 4, 'appliquer fait passer le brouillon en réglages');
  assert.equal(a.paramsDraft, null, 'et le brouillon disparaît');
  assert.equal(ctx.importDirty(a), false);
});

test('abandonner rend les valeurs appliquées la dernière fois', () => {
  const ctx = contexteImport();
  const a = assetModele(ctx, {params: {centrer: false, setGround: false}});
  ctx.applyImportModel(a, false);
  ctx.ensureDraft(a).scale = 9;
  ctx.discardDraft(a);
  assert.equal(ctx.importDirty(a), false);
  assert.equal(ctx.paramsShown(a).scale, 1, 'le panneau doit réafficher la valeur appliquée');
});

test('un brouillon identique aux réglages appliqués n\'est PAS un changement', () => {
  const ctx = contexteImport();
  const a = assetModele(ctx, {params: {centrer: false, setGround: false}});
  ctx.applyImportModel(a, false);
  ctx.ensureDraft(a);
  assert.equal(ctx.importDirty(a), false,
    'ouvrir un champ puis le laisser tel quel ne doit pas déclencher la question au clic suivant');
});

test('quitter un asset modifié retient la sélection et pose la question', () => {
  const ctx = contexteImport();
  const a = assetModele(ctx, {params: {centrer: false, setGround: false}});
  ctx.applyImportModel(a, false);
  ctx.assetSelected = a;
  ctx.ensureDraft(a).scale = 3;

  const boutons = {};
  ctx.escapeHtml = (x) => x;
  ctx.openModal = () => {};
  ctx.closeModal = () => {};
  ctx.document.getElementById = (id) => (boutons[id] = boutons[id] || {});

  let suite = 0;
  assert.equal(ctx.guardImportDirty({id: 'a2'}, () => { suite++; }), false,
    'la sélection ne doit PAS bouger tant qu\'on n\'a pas répondu');
  assert.equal(suite, 0);

  boutons['dirty-save'].onclick();
  assert.equal(a.paramsImport.scale, 3, '« Enregistrer » applique');
  assert.equal(suite, 1, 'puis laisse la sélection partir');
});

test('« Abandonner » laisse partir sans rien appliquer', () => {
  const ctx = contexteImport();
  const a = assetModele(ctx, {params: {centrer: false, setGround: false}});
  ctx.applyImportModel(a, false);
  ctx.assetSelected = a;
  ctx.ensureDraft(a).scale = 3;
  const boutons = {};
  ctx.escapeHtml = (x) => x;
  ctx.openModal = () => {};
  ctx.closeModal = () => {};
  ctx.document.getElementById = (id) => (boutons[id] = boutons[id] || {});

  let suite = 0;
  ctx.guardImportDirty({id: 'a2'}, () => { suite++; });
  boutons['dirty-discard'].onclick();
  assert.equal(a.paramsImport.scale, 1);
  assert.equal(a.paramsDraft, null);
  assert.equal(suite, 1);
});

test('un asset sans modification ne pose aucune question', () => {
  const ctx = contexteImport();
  const a = assetModele(ctx, {params: {centrer: false, setGround: false}});
  ctx.applyImportModel(a, false);
  ctx.assetSelected = a;
  assert.equal(ctx.guardImportDirty({id: 'a2'}, () => {}), true);
});


// ---------- Aperçu des UV ----------

test('les jeux d\'UV listés sont ceux que les maillages portent vraiment', () => {
  const ctx = contexteImport();
  const a = assetModele(ctx, {params: {}});
  assert.equal(ctx.uvSetsOfModel(a).join(','), 'uv');
  ctx.applyModelGeometry(a.template, {lightmapUv: true});
  assert.equal(ctx.uvSetsOfModel(a).join(','), 'uv,uv1',
    'le dépliage doit apparaître dans la liste : c\'est là qu\'on va le vérifier');
});

test('le dessin des UV compte les triangles du jeu demandé', () => {
  const ctx = contexteImport();
  const a = assetModele(ctx, {params: {}});
  const faux = {width: 100, height: 100, getContext: () => ({
    clearRect(){}, fillRect(){}, beginPath(){}, moveTo(){}, lineTo(){},
    closePath(){}, stroke(){}, set fillStyle(v){}, set strokeStyle(v){}, set lineWidth(v){}
  })};
  assert.equal(ctx.drawUvModel(faux, a, 'uv'), 12, 'un cube a douze triangles');
  assert.equal(ctx.drawUvModel(faux, a, 'uv1'), 0, 'et pas encore d\'uv1');
});


// ---------- L'onglet Rig ----------

/** Un asset modele avec un squelette nomme a la Mixamo. */
function assetRigue(ctx, prefixe){
  const T = ctx.THREE;
  const a = assetModele(ctx, {params: {centrer: false, setGround: false}});
  const p = prefixe === undefined ? 'mixamorig' : prefixe;
  const hips = new T.Bone(); hips.name = p + 'Hips';
  const spine = new T.Bone(); spine.name = p + 'Spine'; spine.position.set(0, 0.2, 0);
  const head = new T.Bone(); head.name = p + 'Head'; head.position.set(0, 0.3, 0);
  spine.add(head); hips.add(spine);
  a.template.add(hips);
  return a;
}

test("passer en humanoide POSE un Avatar, revenir en generique l efface", () => {
  const ctx = contexteImport();
  const a = assetRigue(ctx);
  ctx.applyImportModel(a, false);
  assert.equal(a.avatar, undefined, "generique par defaut : pas d Avatar");

  a.paramsImport.animationType = "humanoid";
  ctx.applyImportModel(a, false);
  assert.ok(a.avatar && a.avatar.mapping, "l application doit detecter l Avatar");
  assert.equal(a.avatar.mapping.Hips, "mixamorigHips");

  a.paramsImport.animationType = "generic";
  ctx.applyImportModel(a, false);
  assert.equal(a.avatar, null, "comme Unity : changer de type jette l Avatar");
});

test("un Avatar pose AVANT que le reglage existe vaut humanoide", () => {
  const ctx = contexteImport();
  const a = assetRigue(ctx);
  // Le cas d un projet enregistre avec une version anterieure : l Avatar avait ete detecte
  // depuis le composant SkinnedMeshRenderer, et paramsImport ne portait pas encore de type.
  a.avatar = {mapping: {Hips: "mixamorigHips"}};
  a.paramsImport = {centrer: false, setGround: false};
  const p = ctx.ensureParamsImport(a);
  assert.equal(p.animationType, "humanoid",
    "le defaut generique aurait efface l Avatar au premier Appliquer");
  ctx.applyImportModel(a, false);
  assert.ok(a.avatar, "et il doit toujours etre la apres application");
});

test("sans squelette, le type d animation ne pretend rien", () => {
  const ctx = contexteImport();
  const a = assetModele(ctx, {params: {centrer: false, setGround: false,
                                       animationType: "humanoid"}});
  ctx.applyImportModel(a, false);
  const h = ctx.sectionRigHtml(a, a.paramsImport);
  assert.match(h, /pas d os a faire correspondre|n est pas rigue|pas rigué/i);
});


// ---------- Un maillage vu depuis le panneau Projet ----------

test("selectionner un maillage montre de la LECTURE SEULE, sans reglage ni bouton", () => {
  const ctx = contexteImport();
  const a = assetModele(ctx, {params: {centrer: false, setGround: false}});
  ctx.applyImportModel(a, false);

  a._sub = {kind: 'mesh', index: 0};
  ctx.buildInspectorAsset(a);
  const h = ctx.inspBody.innerHTML;
  assert.match(h, /lecture seule/, "le panneau doit dire ce qu il est");
  assert.match(h, /Sommets/, "et montrer la geometrie");
  assert.equal(/id="ip-echelle"/.test(h), false, "aucun reglage d import");
  assert.equal(/id="ip-apply"/.test(h), false, "et donc rien a appliquer");

  delete a._sub;
  ctx.buildInspectorAsset(a);
  assert.match(ctx.inspBody.innerHTML, /id="ip-echelle"/,
    "revenir au fichier rend les parametres");
});

test("les onglets ne montrent que leur propre famille de reglages", () => {
  const ctx = contexteImport();
  const a = assetRigue(ctx);
  ctx.applyImportModel(a, false);

  a._tab = "model";
  ctx.buildInspectorAsset(a);
  assert.match(ctx.inspBody.innerHTML, /id="ip-echelle"/);
  assert.equal(/id="ip-anim-type-rig"/.test(ctx.inspBody.innerHTML), false);

  a._tab = "rig";
  ctx.buildInspectorAsset(a);
  assert.match(ctx.inspBody.innerHTML, /id="ip-anim-type-rig"/);
  assert.equal(/id="ip-echelle"/.test(ctx.inspBody.innerHTML), false);
  assert.match(ctx.inspBody.innerHTML, /id="ip-apply"/,
    "les boutons d application restent sur tous les onglets");
});


test("cliquer un onglet change d onglet (il n a pas d id, la garde l avalait)", () => {
  const ctx = contexteImport();
  const a = assetRigue(ctx);
  ctx.applyImportModel(a, false);
  ctx.assetSelected = a;
  a._tab = "model";
  ctx.buildInspectorAsset(a);
  // Les ecouteurs sont poses par startup.js dans l editeur reel.
  ctx.bindAssetInspectorInput();

  ctx._emit("click", {dataset: {tab: "rig"}});
  assert.equal(a._tab, "rig", "le clic doit avoir change d onglet");
  assert.match(ctx.inspBody.innerHTML, /id="ip-anim-type-rig"/,
    "et le panneau doit avoir ete reconstruit sur l onglet Rig");

  ctx._emit("click", {dataset: {tab: "materials"}});
  assert.equal(a._tab, "materials");
});


test("la fenetre Avatar groupe les emplacements et marque ce qui manque", () => {
  const ctx = contexteImport();
  const a = assetRigue(ctx);
  a.paramsImport.animationType = "humanoid";
  ctx.applyImportModel(a, false);

  let titre = "", html = "";
  ctx.openModal = (t, h) => { titre = t; html = h; };
  ctx.closeModal = () => {};
  const noeuds = {};
  ctx.document.getElementById = (id) => (noeuds[id] = noeuds[id]
    || {addEventListener: () => {}, onclick: null});
  ctx.modalAvatarConfig(a);

  assert.match(titre, /Avatar humanoide|Avatar humanoïde/);
  assert.match(html, /Bras gauche/, "les emplacements sont groupes par membre");
  assert.match(html, /Jambe droite/);
  assert.match(html, /avatar-body/, "la silhouette est la");
  // Le rig de test n a que Hips/Spine/Head : les membres sont des emplacements requis manquants.
  assert.match(html, /requis<\/b> manquant/, "et ce qui manque est annonce en tete");
  assert.match(html, /class="field avatar-line missing"/, "avec une pastille par ligne");
});

test("un os disparu du squelette reste VISIBLE dans la liste, marque absent", () => {
  const ctx = contexteImport();
  const a = assetRigue(ctx);
  a.paramsImport.animationType = "humanoid";
  ctx.applyImportModel(a, false);
  a.avatar.mapping.Head = "un_os_qui_nexiste_plus";

  let html = "";
  ctx.openModal = (t, h) => { html = h; };
  ctx.closeModal = () => {};
  const noeuds = {};
  ctx.document.getElementById = (id) => (noeuds[id] = noeuds[id]
    || {addEventListener: () => {}, onclick: null});
  ctx.modalAvatarConfig(a);

  assert.match(html, /un_os_qui_nexiste_plus — absent du squelette/,
    "l effacer de la liste ferait afficher le premier os venu a sa place");
});

test("la liste d os du panneau ne montre pas les doublons du fichier", () => {
  const ctx = contexteImport();
  const T = ctx.THREE;
  const a = assetModele(ctx, {params: {centrer: false, setGround: false}});
  // deux maillages skinnes qui rapportent chacun le meme squelette, comme un vrai FBX
  for(let i = 0; i < 3; i++){
    const b = new T.Bone();
    b.name = "Hips";
    a.template.add(b);
  }
  assert.equal(ctx.bonesOfModel(a).length, 1, "un seul « Hips » proposable");
});


test("le fichier se deplie sur TOUT ce qu il contient, pas seulement ses maillages", () => {
  const ctx = contexteImport();
  const T = ctx.THREE;
  const a = assetRigue(ctx);
  // `animationsBrutes` est la source : applyImportModel repose `template.animations` dessus,
  // comme le fait createAssetModel a l import.
  a.animationsBrutes = [new T.AnimationClip('marche', 1.5, [
    new T.VectorKeyframeTrack('mixamorigHips.position', [0, 1], [0, 0, 0, 0, 1, 0])
  ])];
  a.template.children[0].material = new T.MeshPhongMaterial({name: 'M_Corps'});
  // ce que fait createAssetModel : retenir les materiaux du fichier avant toute application
  a.matBruts = ctx.captureMatFile(a.template);
  ctx.applyImportModel(a, false);

  const parts = ctx.subAssetsOfModel(a);
  const genres = parts.map((p) => p.kind);
  assert.ok(genres.indexOf('mesh') !== -1, 'les maillages');
  assert.ok(genres.indexOf('material') !== -1, 'les materiaux du fichier');
  assert.ok(genres.indexOf('animation') !== -1, 'les clips');
  assert.ok(genres.indexOf('skeleton') !== -1, 'le squelette, ce rig en a un');
  assert.equal(parts.find((p) => p.kind === 'material').name, 'M_Corps');
  assert.equal(parts.find((p) => p.kind === 'animation').name, 'marche');
});

test("un modele sans rig ni clip ne deplie que ses maillages", () => {
  const ctx = contexteImport();
  const a = assetModele(ctx, {params: {centrer: false, setGround: false}});
  ctx.applyImportModel(a, false);
  const genres = ctx.subAssetsOfModel(a).map((p) => p.kind);
  assert.equal(genres.indexOf('skeleton'), -1, 'pas de squelette a montrer');
  assert.equal(genres.indexOf('animation'), -1, 'ni de clip');
});

test("chaque sous-asset a sa vue en LECTURE SEULE", () => {
  const ctx = contexteImport();
  const T = ctx.THREE;
  const a = assetRigue(ctx);
  // `animationsBrutes` est la source : applyImportModel repose `template.animations` dessus,
  // comme le fait createAssetModel a l import.
  a.animationsBrutes = [new T.AnimationClip('marche', 1.5, [
    new T.VectorKeyframeTrack('mixamorigHips.position', [0, 1], [0, 0, 0, 0, 1, 0])
  ])];
  a.template.children[0].material = new T.MeshPhongMaterial({name: 'M_Corps'});
  // ce que fait createAssetModel : retenir les materiaux du fichier avant toute application
  a.matBruts = ctx.captureMatFile(a.template);
  ctx.applyImportModel(a, false);

  const attendu = {
    material: [/Materiau du fichier|Matériau du fichier/, /M_Corps/],
    animation: [/Clip du fichier/, /1\.50 s/],
    skeleton: [/Squelette/, /mixamorigHips/]
  };
  Object.keys(attendu).forEach(function(kind){
    a._sub = {kind: kind, index: 0};
    ctx.buildInspectorAsset(a);
    const h = ctx.inspBody.innerHTML;
    attendu[kind].forEach((re) => assert.match(h, re, kind + ' : ' + re));
    assert.equal(/id="ip-apply"/.test(h), false, kind + ' : rien a appliquer');
    assert.equal(/id="ip-echelle"/.test(h), false, kind + ' : aucun reglage');
  });
});

test("un materiau que le chargeur n a pas su traduire le DIT", () => {
  const ctx = contexteImport();
  const T = ctx.THREE;
  const a = assetModele(ctx, {params: {centrer: false, setGround: false}});
  // ce que FBXLoader fabrique pour un openPBRSurface qu il ne connait pas
  a.template.children[0].material = new T.MeshPhongMaterial({name: 'M_Enfant'});
  a.matBruts = ctx.captureMatFile(a.template);
  ctx.applyImportModel(a, false);
  a._sub = {kind: 'material', index: 0};
  ctx.buildInspectorAsset(a);
  assert.match(ctx.inspBody.innerHTML, /OpenPBR/,
    'sinon la perte de rugosite et de metal ne se lit qu en console');
});
