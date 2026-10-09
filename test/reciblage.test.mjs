import { deEsm } from './engine-env.mjs';
// Le reciblage a ceci de traître qu'il produit toujours QUELQUE CHOSE. Un facteur d'échelle
// oublié donne un personnage qui marche en s'enfonçant dans le sol ; un delta de pose de repos
// ignoré rentre les bras dans le torse. Dans les deux cas ça bouge, ça a l'air d'une animation,
// et rien ne signale l'erreur.
//
// Les deux fichiers Mixamo qui ont motivé ce travail viennent du MÊME personnage : même taille,
// mêmes poses de repos. Les deux corrections y sont l'identité — donc invérifiables. Ce fichier
// construit donc des rigs qui, eux, diffèrent, et vérifie AUSSI que sur des rigs identiques le
// reciblage ne touche à rien (sans quoi « corriger » serait un synonyme d'« abîmer »).
//
// Le vrai three vendorisé est chargé : Quaternion, Bone et les classes de pistes sont exercés
// tels qu'ils arrivent d'un import.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const racineMoteur = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(racineMoteur, f), 'utf8');

function contexte(){
  const bac = {console, Math, JSON, Set, Map, Array, Object, Float32Array, Uint16Array};
  bac.window = bac; bac.self = bac; bac.globalThis = bac;
  const ctx = vm.createContext(bac);
  vm.runInContext(deEsm(read('vendor/three.min.js')), ctx, {filename:'vendor/three.min.js'});
  // retargeting.js choisit sa voie de reciblage d'apres les Avatars des deux assets
  // (clipRetargetedBestWay) : il lui faut donc assetById et humanoid-avatar.js.
  vm.runInContext(deEsm(read('js/component-data.js')), ctx, {filename:'js/component-data.js'});
  vm.runInContext(deEsm(read('js/humanoid-avatar.js')), ctx, {filename:'js/humanoid-avatar.js'});
  vm.runInContext(deEsm(read('js/retargeting.js')), ctx, {filename:'js/retargeting.js'});
  vm.runInContext(deEsm(read('js/anim-models.js')), ctx, {filename:'js/anim-models.js'});
  return ctx;
}

// Un rig humanoïde minimal mais RÉEL au sens du module : la chaîne de jambe qu'il mesure y est,
// avec les noms qu'il sait reconnaître. `size` étire les os, `epaule` incline l'épaule au
// repos — les deux écarts que le reciblage doit corriger, isolés l'un de l'autre.
function rig(ctx, opts){
  const T = ctx.THREE;
  const o = opts || {};
  const size = o.size === undefined ? 1 : o.size;
  const prefixe = o.prefixe === undefined ? 'mixamorig' : o.prefixe;
  const os = {};
  const faire = (name, y, parent) => {
    const b = new T.Bone();
    b.name = prefixe + name;
    b.position.set(0, y * size, 0);
    (parent || null) ? parent.add(b) : null;
    os[name] = b;
    return b;
  };
  const root = new T.Group();
  const hanche = faire('Hips', 100, null);
  root.add(hanche);
  faire('LeftUpLeg', 45, hanche);
  faire('LeftLeg', 40, os.LeftUpLeg);
  faire('LeftFoot', 15, os.LeftLeg);
  const epaule = faire('LeftShoulder', 20, hanche);
  if(o.epaule) epaule.quaternion.setFromAxisAngle(new T.Vector3(0, 0, 1), o.epaule);
  return {root, os};
}

// Un clip qui fait deux choses mesurables : le bassin monte de 10 unités, l'épaule tourne de
// 30° autour de Z.
function clipTemoin(ctx, prefixe){
  const T = ctx.THREE;
  const p = prefixe === undefined ? 'mixamorig' : prefixe;
  const q0 = new T.Quaternion();
  const q1 = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), Math.PI / 6);
  return new T.AnimationClip('marche', 1, [
    new T.VectorKeyframeTrack(p + 'Hips.position', [0, 1], [0, 100, 0, 0, 110, 0]),
    new T.QuaternionKeyframeTrack(p + 'LeftShoulder.quaternion', [0, 1],
      [q0.x, q0.y, q0.z, q0.w, q1.x, q1.y, q1.z, q1.w])
  ]);
}

const track = (clip, suffix) => clip.tracks.find((t) => t.name.endsWith(suffix));

// --- correspondance des noms ------------------------------------------------------------

test('un clip Mixamo sait parler a un rig DENOMME (Hips, sans prefixe)', () => {
  const ctx = contexte();
  const src = rig(ctx, {});
  const cib = rig(ctx, {prefixe: ''});     // même squelette, noms nus

  const c = ctx.compatibilityClipRig(clipTemoin(ctx), cib.root);
  assert.equal(c.communs, 2, 'os appariés : ' + c.communs + ', manquants ' + c.missing.join(', '));
  assert.equal(c.rate, 1);

  const r = ctx.retargetClip(clipTemoin(ctx), src.root, cib.root, 'test');
  assert.equal(r.tracks.length, 2);
  // Le clip produit doit porter les noms de la CIBLE, sinon three ne liera rien à l'exécution
  // et l'animation sera silencieusement empty.
  assert.ok(r.tracks.every((t) => t.name.indexOf('mixamorig') === -1),
    'pistes encore nommées à la source : ' + r.tracks.map((t) => t.name).join(', '));
});

test('un os absent de la cible fait tomber sa piste, et se DIT', () => {
  const ctx = contexte();
  const src = rig(ctx, {});
  const cib = rig(ctx, {});
  cib.os.LeftShoulder.parent.remove(cib.os.LeftShoulder);

  const c = ctx.compatibilityClipRig(clipTemoin(ctx), cib.root);
  assert.equal(c.communs, 1);
  assert.deepEqual(Array.from(c.missing), ['mixamorigLeftShoulder'],
    'un os missing doit être NOMMÉ : « ça ne marche pas » n’aide personne');

  const r = ctx.retargetClip(clipTemoin(ctx), src.root, cib.root, 'test');
  assert.equal(r.tracks.length, 1, 'la piste orpheline doit tomber, pas planter');
});

// --- correction de taille ---------------------------------------------------------------

test('un rig DEUX FOIS plus grand recoit une translation de bassin deux fois plus grande', () => {
  const ctx = contexte();
  const src = rig(ctx, {size: 1});
  const cib = rig(ctx, {size: 2});

  const r = ctx.retargetClip(clipTemoin(ctx), src.root, cib.root, 'test');
  const pos = track(r, '.position');
  // Sans le facteur, le bassin monterait de 100 à 110 sur un rig dont les hanches sont à 200 :
  // le personnage s'enfoncerait dans le sol de la moitié de sa taille, en marchant normalement.
  assert.deepEqual(Array.from(pos.values), [0, 200, 0, 0, 220, 0],
    'translation non mise à l’échelle : ' + Array.from(pos.values).join(', '));
});

test('deux rigs de MEME taille laissent la translation intacte', () => {
  const ctx = contexte();
  const src = rig(ctx, {size: 1});
  const cib = rig(ctx, {size: 1});
  const r = ctx.retargetClip(clipTemoin(ctx), src.root, cib.root, 'test');
  // Le cas des deux fichiers Mixamo de départ. Une « correction » qui bouge ici serait un défaut
  // introduit par la correction elle-même.
  assert.deepEqual(Array.from(track(r, '.position').values), [0, 100, 0, 0, 110, 0]);
});

test('un rig sans chaine de jambe reconnaissable ne se voit PAS attribuer un facteur devine', () => {
  const ctx = contexte();
  const src = rig(ctx, {size: 1});
  const cib = rig(ctx, {size: 3, prefixe: 'os_'});
  // `os_LeftUpLeg` → normalisé `leftupleg` : reconnu. On casse donc vraiment les noms.
  Object.keys(cib.os).forEach((k) => { cib.os[k].name = 'b' + Math.abs(k.length * 7); });
  const facteurApplique = ctx.retargetClip(clipTemoin(ctx), src.root, cib.root, 'test');
  assert.equal(facteurApplique, null,
    'aucun os appariable : le reciblage doit renoncer, pas rendre un clip vide qui « marche »');
});

test('des rigs appariables SANS chaine de jambe ne recoivent ni NaN ni Infini', () => {
  const ctx = contexte();
  const T = ctx.THREE;
  // Un rig d'object articulé — une grue, une porte, un bras robot : les os s'apparient très bien
  // par leur nom, mais aucun ne s'appelle « jambe ». Sans garde, le rapport de tailles vaut
  // 0/0 et toutes les positions deviennent NaN : le modèle disparaît, comme un FBX sans peau.
  const monter = (prefixe) => {
    const root = new T.Group();
    const a = new T.Bone(); a.name = prefixe + 'Hips'; a.position.set(0, 100, 0);
    const b = new T.Bone(); b.name = prefixe + 'LeftShoulder'; b.position.set(0, 20, 0);
    a.add(b); root.add(a);
    return root;
  };
  const r = ctx.retargetClip(clipTemoin(ctx), monter('mixamorig'), monter('mixamorig'), 'test');
  assert.ok(r, 'des os appariés doivent produire un clip');
  const vals = Array.from(track(r, '.position').values);
  assert.ok(vals.every((v) => Number.isFinite(v)), 'positions non finies : ' + vals.join(', '));
  assert.deepEqual(vals, [0, 100, 0, 0, 110, 0],
    'faute de mesure, le facteur doit rester 1 — pas être deviné');
});

// --- correction de pose de repos ---------------------------------------------------------

test('une epaule inclinee au repos recoit le MOUVEMENT, pas la rotation absolue', () => {
  const ctx = contexte();
  const T = ctx.THREE;
  const src = rig(ctx, {});                          // épaule au repos : identité
  const cib = rig(ctx, {epaule: Math.PI / 4});       // épaule au repos : 45°

  const r = ctx.retargetClip(clipTemoin(ctx), src.root, cib.root, 'test');
  const q = track(r, '.quaternion');
  const end = new T.Quaternion(q.values[4], q.values[5], q.values[6], q.values[7]);

  // Le clip fait tourner l'épaule de 30° depuis SON repos. Sur une cible dont le repos est à
  // 45°, la bonne target finale est 45 + 30 = 75°, pas 30° — recopier la valeur brute
  // ramènerait le bras 15° EN DEÇÀ de sa position de repos.
  const attendu = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1),
    Math.PI / 4 + Math.PI / 6);
  // Tolérance à 0,1° et non à zéro : `QuaternionKeyframeTrack` stocke en Float32Array, et
  // l'aller-retour coûte ~0,02°. Une correction absente donnerait ici 45° d'écart — la garde
  // mord largement avant que l'arrondi n'entre en game.
  const gap = 2 * Math.acos(Math.min(1, Math.abs(end.dot(attendu)))) * 180 / Math.PI;
  assert.ok(gap < 0.1, 'écart de ' + gap.toFixed(2) + '° avec la pose attendue');

  // Et la première clé doit tomber pile sur le repos de la cible : au temps 0, le clip source
  // est à son propre repos, donc la cible doit être au sien.
  const start = new T.Quaternion(q.values[0], q.values[1], q.values[2], q.values[3]);
  const ecart0 = 2 * Math.acos(Math.min(1, Math.abs(start.dot(cib.os.LeftShoulder.quaternion))))
    * 180 / Math.PI;
  assert.ok(ecart0 < 0.1, 'au temps 0 l’épaule doit être à son repos, écart ' + ecart0.toFixed(2) + '°');
});

// Le test précédent ne prouve pas l'ORDRE de la composition : ses rotations tournent toutes
// autour de Z, et deux rotations de même axe commutent. Il ne prouve pas non plus l'inversion :
// son rig source est au repos identité, et inverser l'identité ne se voit pas. Trois axes
// différents et deux repos non triviaux, c'est le seul montage où les deux erreurs se voient.
test('trois axes differents : l ordre de composition et l inversion comptent', () => {
  const ctx = contexte();
  const T = ctx.THREE;
  const axe = (x, y, z, a) => new T.Quaternion().setFromAxisAngle(new T.Vector3(x, y, z), a);

  const reposSrc = axe(1, 0, 0, Math.PI / 6);     // source au repos : 30° autour de X
  const reposCib = axe(0, 0, 1, 5 * Math.PI / 18); // target  au repos : 50° autour de Z
  const geste    = axe(0, 1, 0, 2 * Math.PI / 9);  // le mouvement : 40° autour de Y

  const src = rig(ctx, {});
  const cib = rig(ctx, {});
  src.os.LeftShoulder.quaternion.copy(reposSrc);
  cib.os.LeftShoulder.quaternion.copy(reposCib);

  // Clé 0 = la source exactement à son repos. Clé 1 = son repos suivi du geste.
  const finSrc = reposSrc.clone().multiply(geste);
  const clip = new T.AnimationClip('g', 1, [new T.QuaternionKeyframeTrack(
    'mixamorigLeftShoulder.quaternion', [0, 1],
    [reposSrc.x, reposSrc.y, reposSrc.z, reposSrc.w, finSrc.x, finSrc.y, finSrc.z, finSrc.w])]);

  const q = track(ctx.retargetClip(clip, src.root, cib.root, 'test'), '.quaternion');
  const ecartAvec = (i, attendu) => {
    const v = new T.Quaternion(q.values[i], q.values[i+1], q.values[i+2], q.values[i+3]);
    return 2 * Math.acos(Math.min(1, Math.abs(v.dot(attendu)))) * 180 / Math.PI;
  };

  // Au repos de la source, la cible doit être au SIEN — quel que soit l'écart entre les deux.
  assert.ok(ecartAvec(0, reposCib) < 0.1,
    'clé 0 : ' + ecartAvec(0, reposCib).toFixed(2) + '° du repos de la cible');
  // Et le geste, appliqué depuis le repos de la cible. Un ordre inversé donne ici ~65° d'écart,
  // une inversion oubliée ~60° : deux poses parfaitement crédibles et fausses.
  assert.ok(ecartAvec(4, reposCib.clone().multiply(geste)) < 0.1,
    'clé 1 : ' + ecartAvec(4, reposCib.clone().multiply(geste)).toFixed(2) + '° de la pose attendue');
});

test('deux rigs de MEME pose de repos laissent les rotations intactes', () => {
  const ctx = contexte();
  const src = rig(ctx, {});
  const cib = rig(ctx, {});
  const attendu = clipTemoin(ctx);
  const r = ctx.retargetClip(clipTemoin(ctx), src.root, cib.root, 'test');
  const obtenu = Array.from(track(r, '.quaternion').values);
  Array.from(track(attendu, '.quaternion').values).forEach((v, i) => {
    assert.ok(Math.abs(obtenu[i] - v) < 1e-6,
      'value ' + i + ' : ' + obtenu[i] + ' au lieu de ' + v + ' — la correction abîme le cas identique');
  });
});

test('la classe de piste est conservee (un quaternion doit interpoler en slerp)', () => {
  const ctx = contexte();
  const src = rig(ctx, {});
  const cib = rig(ctx, {});
  const origine = clipTemoin(ctx);
  const r = ctx.retargetClip(origine, src.root, cib.root, 'test');
  // Reconstruire une piste de quaternion en track vectorielle interpolerait en droite entre
  // deux orientations : le bras couperait à travers le body sur les grandes rotations, et
  // resterait crédible sur les petites.
  assert.equal(track(r, '.quaternion').constructor.name,
    track(origine, '.quaternion').constructor.name);
  assert.equal(track(r, '.position').constructor.name,
    track(origine, '.position').constructor.name);
});

// --- pose sur l'object ---------------------------------------------------------------------

test('poser un clip recible ne CONTAMINE pas les autres instances du modele', () => {
  const ctx = contexte();
  const src = rig(ctx, {});
  const cib = rig(ctx, {});
  // Ce que fait `cloneModel` : le tableau d'animations est PARTAGÉ entre l'asset et chaque
  // instance. Pousser dedans sans copier ajouterait l'animation partout à la fois.
  const partage = [new ctx.THREE.AnimationClip('idle', 1, [])];
  cib.root.animations = partage;
  const jumelle = rig(ctx, {}).root;
  jumelle.animations = partage;

  ctx.setClipRetargetedOn(cib.root, src.root, 'Marche', clipTemoin(ctx));

  assert.equal(cib.root.animations.length, 2, 'le clip reciblé n’a pas été posé');
  assert.equal(partage.length, 1, 'le tableau PARTAGÉ a été modifié : toutes les instances ont reçu le clip');
  assert.equal(jumelle.animations.length, 1, 'l’autre instance a hérité du clip');
});

test('attachAnimationExternal écrit sur SkinnedMeshRenderer.data.externalClips, pas userData.animExt', () => {
  const ctx = contexte();
  const src = rig(ctx, {});
  const cib = rig(ctx, {});
  // Composant SkinnedMeshRenderer factice : le harnais de ce fichier ne charge pas le système de
  // composants ECS (trop lié au DOM/aux assets), donc on bouche juste `getComponent` sur la
  // racine — c'est le seul contrat que `skinnedMeshRendererOf` observe.
  const compFactice = {externalClips: []};
  cib.root.getComponent = function(type){ return type === 'SkinnedMeshRenderer' ? compFactice : null; };
  const clipSource = clipTemoin(ctx);
  const asset = {id:'a2', name:'Walking (1)', template:src.root};
  asset.template.animations = [clipSource];

  const posee = ctx.attachAnimationExternal(cib.root, asset, clipSource);
  assert.ok(posee, 'le clip doit être posé');
  assert.equal(cib.root.userData.animExt, undefined, 'plus d\'écriture dans userData.animExt');
  const smr = ctx.skinnedMeshRendererOf(cib.root);
  assert.ok(smr, 'le sous-arbre doit porter un SkinnedMeshRenderer');
  assert.equal(smr.externalClips.length, 1);
  assert.equal(smr.externalClips[0].localName, posee.name);
});

test('rattacher depuis une scene IMPOSE le nom enregistre', () => {
  const ctx = contexte();
  const src = rig(ctx, {});
  const cib = rig(ctx, {});
  cib.root.animations = [new ctx.THREE.AnimationClip('mixamo.com', 1, [])];
  const clipSource = clipTemoin(ctx);
  clipSource.name = 'mixamo.com';
  const asset = {id:'a2', name:'Walking (1)', template:src.root};
  asset.template.animations = [clipSource];

  // Le nom enregistré porte déjà le suffixe que l'unicité avait produit à l'attachement. Le
  // recalculer au chargement rendrait « … (2) » — et la timeline, le réglage « au lancement »
  // et tout script citant ce nom pointeraient dans le vide, sans erreur.
  // Le montage qui SÉPARE « name repris » de « name recalculé » : deux attachements avaient été
  // faits, le second suffixé « (2) » par l'unicité — puis le premier fichier a été supprimé du
  // project. En recalculant, le survivant redeviendrait « … » sans suffixe, et le nom que la
  // scène cite (« … (2) ») ne désignerait plus rien. Sans cette suppression, les deux
  // stratégies donnent le même résultat et le test ne prouve rien.
  const refs = [
    {asset:'disparu', clip:'mixamo.com', name:'Walking (1) · mixamo.com'},
    {asset:'a2',      clip:'mixamo.com', name:'Walking (1) · mixamo.com (2)'}
  ];
  const posees = ctx.reattachAnimationsExternal(cib.root, refs, function(id){
    return id === 'a2' ? asset : null;
  });

  assert.equal(posees.length, 1, 'aucun clip rattaché');
  assert.equal(posees[0].name, 'Walking (1) · mixamo.com (2)',
    'name recalculé au lieu d’être repris : « ' + posees[0].name + ' »');
  assert.equal(posees[0].tracks.length, 2, 'le clip rattaché est vide');
});

test('un asset disparu ne fait pas tomber le chargement', () => {
  const ctx = contexte();
  const cib = rig(ctx, {});
  const posees = ctx.reattachAnimationsExternal(cib.root,
    [{asset:'parti', clip:'x', name:'y'}], function(){ return null; });
  assert.deepEqual(Array.from(posees), [],
    'un fichier d’animation supprimé du project doit être ignoré, pas planter la scène');
});

// `remapReferencesAssetsInScenes` opère sur des données planes (scenes/objets/composants), sans
// DOM ni THREE : seul un bouchon minimal pour l'écouteur posé en tête de fichier est nécessaire.
function contexteSerialisation(){
  const bac = {console, Math, JSON, Set, Map, Array, Object};
  bac.window = bac; bac.self = bac; bac.globalThis = bac;
  bac.document = {getElementById: function(){ return {addEventListener: function(){}}; }};
  const ctx = vm.createContext(bac);
  vm.runInContext(deEsm(read('js/serialization.js')), ctx, {filename:'js/serialization.js'});
  return ctx;
}

test('remapReferencesAssetsInScenes remappe externalClips (SkinnedMeshRenderer) au chargement', () => {
  const ctx = contexteSerialisation();
  const scenes = [{data:{objects:[
    {name:'Perso', components:[{type:'SkinnedMeshRenderer', data:{externalClips:[
      {assetId:'vieux', sourceClip:'x', localName:'y'}
    ]}}]}
  ]}}];
  ctx.remapReferencesAssetsInScenes(scenes, {nouveau:{id:'nouveau'}});
  // L'ancien id ('vieux') n'existe plus dans la table : ce clip doit tomber, pas survivre tel quel.
  assert.equal(scenes[0].data.objects[0].components[0].data.externalClips.length, 0);

  const scenes2 = [{data:{objects:[
    {name:'Perso', components:[{type:'SkinnedMeshRenderer', data:{externalClips:[
      {assetId:'vieux', sourceClip:'x', localName:'y'}
    ]}}]}
  ]}}];
  ctx.remapReferencesAssetsInScenes(scenes2, {vieux:{id:'nouveau'}});
  // Champ par champ, pas `deepEqual` : l'objet rendu vient du royaume du `vm` — piège récurrent
  // des tests de ce fichier (voir plus bas).
  const ref = scenes2[0].data.objects[0].components[0].data.externalClips[0];
  assert.equal(ref.assetId, 'nouveau', 'assetId doit suivre le remappage, pas rester sur l’ancien id');
  assert.equal(ref.sourceClip, 'x');
  assert.equal(ref.localName, 'y');
});

// `rebuildTree` reconstruit une scène entière : Model (via son NodeShell, js/objects.js — trop
// lié au DOM/à l'éditeur pour être chargé ici en entier, on repose donc la même construction) +
// composants (js/component-migration.js) + retargeting (js/retargeting.js, js/anim-models.js).
function contexteRebuild(){
  const bac = {console, Math, JSON, Set, Map, Array, Object, Float32Array, Uint16Array};
  bac.window = bac; bac.self = bac; bac.globalThis = bac;
  bac.document = {getElementById: function(){ return {addEventListener: function(){}}; }};
  bac.isSceneObject = function(){ return true; };
  const ctx = vm.createContext(bac);
  vm.runInContext(deEsm(read('vendor/three.min.js')), ctx, {filename:'vendor/three.min.js'});
  vm.runInContext(deEsm(read('js/component-data.js')), ctx, {filename:'js/component-data.js'});
  vm.runInContext(deEsm(read('js/component-registry.js')), ctx, { filename: 'js/component-registry.js' });
  vm.runInContext(deEsm(read('js/component.js')), ctx, {filename:'js/component.js'});
  vm.runInContext(deEsm(read('js/node.js')), ctx, {filename:'js/node.js'});
  vm.runInContext(deEsm(read('js/component-migration.js')), ctx, {filename:'js/component-migration.js'});
  vm.runInContext(deEsm(read('js/components/component-model.js')), ctx, {filename:'js/components/component-model.js'});
  vm.runInContext(deEsm(read('js/components/component-skinned-mesh.js')), ctx,
    {filename:'js/components/component-skinned-mesh.js'});
  vm.runInContext(deEsm(read('js/humanoid-avatar.js')), ctx, {filename:'js/humanoid-avatar.js'});
  vm.runInContext(deEsm(read('js/retargeting.js')), ctx, {filename:'js/retargeting.js'});
  vm.runInContext(deEsm(read('js/anim-models.js')), ctx, {filename:'js/anim-models.js'});
  vm.runInContext(deEsm(read('js/serialization.js')), ctx, {filename:'js/serialization.js'});
  // Le shell 'Model' réel (js/objects.js) tire trop de globales d'éditeur pour être chargé ici :
  // on pose la même construction (cloneModel + applyNodeMixin), sans le reste du fichier.
  vm.runInContext(
    "NodeShells.register('Model', function(d, ctx){\n" +
    "  const a = assetOfReference((ctx && ctx.assetsById) || {}, d.assetId);\n" +
    "  if(!a || !a.template) return null;\n" +
    "  const o = cloneModel(a.template);\n" +
    "  applyNodeMixin(o);\n" +
    "  return o;\n" +
    "});", ctx, {filename:'NodeShells-Model-sous-test'});
  return ctx;
}

// Un rig minimal avec un VRAI THREE.SkinnedMesh (pas seulement des Bone) : `cloneModel` ne pose
// `SkinnedMeshRenderer` que sur `x.isSkinnedMesh && x.skeleton`.
function rigSkinne(ctx, prefixe){
  const T = ctx.THREE;
  const p = prefixe === undefined ? 'mixamorig' : prefixe;
  const bone = new T.Bone(); bone.name = p + 'Hips';
  const skeleton = new T.Skeleton([bone]);
  const mesh = new T.SkinnedMesh(new T.BufferGeometry(), new T.MeshBasicMaterial());
  mesh.add(bone);
  mesh.bind(skeleton);
  const racine = new T.Group(); racine.name = 'CharacterModel';
  racine.add(mesh);
  return {racine: racine, mesh: mesh, bone: bone};
}

test('rebuildTree reconstruit externalClips et reciblage sur le clone (bout en bout)', () => {
  const ctx = contexteRebuild();
  const T = ctx.THREE;

  const perso = rigSkinne(ctx);
  const source = rigSkinne(ctx);
  source.racine.animations = [new T.AnimationClip('mixamo.com', 1, [
    new T.VectorKeyframeTrack('mixamorigHips.position', [0, 1], [0, 0, 0, 0, 10, 0])
  ])];

  const assetsById = {
    perso: {id:'perso', kind:'model', template: perso.racine},
    marche: {id:'marche', kind:'model', name:'Marche', template: source.racine}
  };

  const listData = [
    {id:1, name:'Perso', parent:null, pos:[0,0,0], quat:[0,0,0,1], ech:[1,1,1],
     components:[{type:'Model', data:{assetId:'perso'}}]},
    {id:2, name:'CharacterModel', parent:1, pos:[0,0,0], quat:[0,0,0,1], ech:[1,1,1],
     components:[{type:'SkinnedMeshRenderer', data:{externalClips:[
       {assetId:'marche', sourceClip:'mixamo.com', localName:'Marche · mixamo.com'}
     ]}}]}
  ];

  const rec = ctx.rebuildTree(listData, assetsById, false);
  const racine = rec.byId[1];
  assert.ok(racine, 'le clone de la racine doit exister');
  const noms = Array.from(racine.animations || []).map(function(c){ return c.name; });
  assert.ok(noms.indexOf('Marche · mixamo.com') !== -1,
    'le clip reciblé n’a pas été reposé sur le clone : ' + noms.join(', '));

  const smr = ctx.skinnedMeshRendererOf(racine);
  assert.ok(smr, 'le clone doit porter un SkinnedMeshRenderer');
  assert.equal(smr.externalClips.length, 1);
  assert.equal(smr.externalClips[0].localName, 'Marche · mixamo.com');
});

// `js/game-runtime.js` est enveloppé dans une IIFE (voir moteur/test/pont-runtime-composants.
// test.mjs) : l'exécuter en `vm` pour un test bout-en-bout demanderait de reconstruire
// `window.GAME_DATA` et toute la scène 3D. On vérifie donc STRUCTURELLEMENT que `buildList` fait
// le même geste que `rebuildTree` (tâche 4.8) — même patron que le test des « QUATRE étapes »
// plus bas, qui lit le corps d'une fonction par son nom plutôt que d'exécuter le fichier.
test('buildList (game-runtime.js) repose externalClips après construction complète, comme rebuildTree', () => {
  const src = read('js/game-runtime.js');
  const start = src.indexOf('function buildList');
  assert.notEqual(start, -1, 'buildList a disparu');
  const end = src.indexOf('\nfunction ', start + 10);
  const body = src.slice(start, end === -1 ? src.length : end);
  assert.match(body, /rtSkinnedMeshRendererOf/,
    'buildList ne repose plus externalClips sur le VRAI composant (miroir de rebuildTree)');
  assert.match(body, /reattachAnimationsExternal/,
    'buildList ne recible plus les clips externes après reconstruction de l’arbre');
  assert.doesNotMatch(body, /d\.anim\b/, 'buildList lit encore le champ mort userData.anim');

  const modelShellStart = src.indexOf("NodeShells.register('Model'");
  const modelShellEnd = src.indexOf('\n});', modelShellStart) + 4;
  const modelShellBody = src.slice(modelShellStart, modelShellEnd);
  assert.doesNotMatch(modelShellBody, /animExt/,
    'le shell Model du jeu publié lit encore l’ancien animExt sur ctx.entry');

  assert.doesNotMatch(src, /function rtStartAnimationsAuto/,
    'rtStartAnimationsAuto (userData.anim, mécanisme retiré par la tâche 3) est du code mort');
  assert.doesNotMatch(src, /userData\.anim\b/, 'userData.anim (mort) est encore lu ou écrit');
});

// Le remappage des ids d'assets au chargement est le point où cette fonctionnalité s'est cassée
// une première fois : la provenance survivait intacte dans le fichier et ne désignait plus rien.
// Les étapes restantes doivent citer `externalClips`, sinon le lien se rompt en silence — et le
// symptôme (« le personnage revient sans son animation ») ne désigne aucune d'elles.
//
// ⚠ PORTÉE DE CETTE GARDE, mesurée et non supposée : elle attrape la SUPPRESSION d'une étape,
// pas sa neutralisation. Une condition changée en `if(false)` laisse le mot `externalClips` dans
// le body et passe. Ces étapes vivent dans du code trop lié au DOM et aux assets pour être
// exécutées ici en entier ; leur comportement bout-en-bout est vérifié par les tests ci-dessus
// (rebuildTree, remapReferencesAssetsInScenes) et à la main dans le navigateur pour le jeu publié.
// Ce test tient la porte qui a effectivement cédé une fois — l'oubli pur et simple —, pas toutes
// les portes.
//
// « écriture dans le fichier » a disparu de cette liste : depuis la tâche 4.5,
// `serializeObject` n'écrit plus explicitement `externalClips` — c'est le composant
// SkinnedMeshRenderer qui se sérialise seul, via le mécanisme générique `d.components`.
test('externalClips est traite dans les TROIS etapes du cycle de vie restantes', () => {
  const etapes = [
    ['js/serialization.js', 'remapReferencesAssetsInScenes', 'remappage des ids au chargement'],
    // Le reciblage a suivi la reconstruction : elle ne passe plus par une cascade sur le type,
    // mais par le PORTEUR que déclare le composant Model (NodeShells, js/objects.js) — et la
    // pose d'externalClips elle-même vit dans `rebuildTree`, PARTAGÉE par l'éditeur (loadScene,
    // undo, prefabs, sous-scènes).
    ['js/serialization.js', 'rebuildTree', 'reconstruction dans l’éditeur'],
    ['js/game-runtime.js', 'buildList', 'reconstruction dans le jeu publié']
  ];
  const absents = [];
  etapes.forEach(([file, fonction, role]) => {
    const src = read(file);
    let range = src;
    if(fonction){
      const start = src.indexOf('function ' + fonction);
      assert.notEqual(start, -1, fonction + ' a disparu de ' + file);
      // jusqu'à la prochaine déclaration de fonction en colonne 0
      const sequence = src.slice(start + 10).search(/\nfunction |\nasync function /);
      range = sequence === -1 ? src.slice(start) : src.slice(start, start + 10 + sequence);
    }
    if(range.indexOf('externalClips') === -1) absents.push(role + ' (' + file + ')');
  });
  assert.deepEqual(absents, [], 'étapes qui ignorent externalClips :\n' + absents.join('\n'));
});

test('un clip recible porte un nom qui ne se confond pas avec ceux deja la', () => {
  const ctx = contexte();
  const src = rig(ctx, {});
  const cib = rig(ctx, {});
  // Le cas réel : les DEUX exports Mixamo s'appellent « mixamo.com ». Garder le nom d'origine
  // ferait qu'une recherche par nom sur le personnage tombe sur son propre clip, pas sur celui
  // qu'on vient de poser — et le jeu exporté jouerait la mauvaise animation.
  cib.root.animations = [new ctx.THREE.AnimationClip('mixamo.com', 1, [])];
  const src2 = clipTemoin(ctx);
  src2.name = 'mixamo.com';

  const pose = ctx.setClipRetargetedOn(cib.root, src.root, 'Walking (1)', src2);
  assert.notEqual(pose.name, 'mixamo.com', 'le clip posé porte le même nom qu’un clip existant');
  assert.equal(cib.root.animations.filter((c) => c.name === pose.name).length, 1,
    'deux clips portent le nom « ' + pose.name + ' »');

  // Deux fois de sequence : le second doit encore se distinguer du premier.
  const bis = ctx.setClipRetargetedOn(cib.root, src.root, 'Walking (1)', src2);
  assert.notEqual(bis.name, pose.name, 'reposer le même clip écrase le nom du précédent');
});

test('PANEL_ANIMATIONS et animOf ont disparu de panels-inspector.js', () => {
  const code = read('js/ui/panels-inspector.js');
  assert.doesNotMatch(code, /PANEL_ANIMATIONS/);
  assert.doesNotMatch(code, /function animOf\(/);
});

test('serializeObject n\'écrit plus le champ anim', () => {
  const code = read('js/serialization.js');
  assert.doesNotMatch(code, /anim: o\.userData\.anim/);
});


// ---------- La voie de reciblage : par Avatar quand les deux en ont un ----------
//
// js/humanoid-avatar.js existait avec ses tests, mais RIEN n y menait : seule la voie par nom
// etait branchee. Deux rigs sans un seul nom d os en commun ne pouvaient donc pas echanger leur
// animation, ce qui est exactement le cas que les Avatars resolvent.

function rigNomme(ctx, nomHanche){
  const T = ctx.THREE;
  const hips = new T.Bone(); hips.name = nomHanche;
  const mesh = new T.SkinnedMesh(new T.BufferGeometry(), new T.MeshBasicMaterial());
  mesh.add(hips);
  mesh.bind(new T.Skeleton([hips]));
  const racine = new T.Group();
  racine.add(mesh);
  return racine;
}

test('deux rigs SANS un nom d os en commun echangent leur animation via leurs Avatars', () => {
  const ctx = contexte();
  const T = ctx.THREE;
  const source = rigNomme(ctx, 'mixamorigHips');
  const cible = rigNomme(ctx, 'BipBassin');
  source.userData.assetId = 'src';
  cible.userData.assetId = 'dst';
  ctx.assets = [
    {id: 'src', kind: 'model', template: source, avatar: {mapping: {Hips: 'mixamorigHips'}}},
    {id: 'dst', kind: 'model', template: cible,  avatar: {mapping: {Hips: 'BipBassin'}}}
  ];

  const clip = new T.AnimationClip('marche', 1, [
    new T.VectorKeyframeTrack('mixamorigHips.position', [0, 1], [0, 0, 0, 0, 1, 0])
  ]);
  const pose = ctx.setClipRetargetedOn(cible, source, 'Source', clip);

  assert.ok(pose, 'la voie par NOM aurait rendu null : aucun os en commun');
  assert.equal(pose.tracks[0].name, 'BipBassin.position',
    'la piste doit desormais adresser l os de la cible');
});

test('sans Avatar des deux cotes, la voie par NOM reste celle qui sert', () => {
  const ctx = contexte();
  const T = ctx.THREE;
  const source = rigNomme(ctx, 'mixamorigHips');
  const cible = rigNomme(ctx, 'Hips');
  source.userData.assetId = 'src';
  cible.userData.assetId = 'dst';
  ctx.assets = [
    {id: 'src', kind: 'model', template: source},
    {id: 'dst', kind: 'model', template: cible}
  ];
  const clip = new T.AnimationClip('marche', 1, [
    new T.VectorKeyframeTrack('mixamorigHips.position', [0, 1], [0, 0, 0, 0, 1, 0])
  ]);
  const pose = ctx.setClipRetargetedOn(cible, source, 'Source', clip);
  assert.ok(pose, 'mixamorigHips et Hips sont le meme os apres normalisation');
  assert.equal(pose.tracks[0].name, 'Hips.position');
});
