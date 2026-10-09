import { deEsm } from './engine-env.mjs';
// Ce que ce fichier protège n'est pas l'affichage — c'est la LECTURE d'un rig. Un arbre d'os
// reconstruit de travers ne lève aucune erreur : il montre une hiérarchie plausible et fausse,
// et c'est sur cette hiérarchie qu'on posera plus tard des clés d'animation.
//
// Le vrai three vendorisé est chargé : `Bone`, `Skeleton` et `SkinnedMesh` sont exercés tels
// qu'ils arrivent d'un import, pas simulés.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const racineMoteur = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(racineMoteur, f), 'utf8');
const codeSeul = (src) => src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

function contexte(){
  const bac = {console, Math, JSON, Set, Map, Array, Object, Float32Array, Uint16Array};
  bac.window = bac; bac.self = bac; bac.globalThis = bac;
  const ctx = vm.createContext(bac);
  vm.runInContext(deEsm(read('vendor/three.min.js')), ctx, {filename:'vendor/three.min.js'});
  vm.runInContext(deEsm(read('js/skeleton.js')), ctx, {filename:'js/skeleton.js'});
  return ctx;
}

// Un rig où la parenté ne suit PAS l'ordre de la liste plate, et où un os a deux enfants.
// Les deux points comptent : `skeleton.bones` est écrit dans l'ordre de l'exportateur, et une
// reconstruction naïve qui suivrait cet ordre donnerait une chaîne au lieu d'un arbre.
function rig(ctx, names){
  const T = ctx.THREE;
  const os = names.map((n) => { const b = new T.Bone(); b.name = n; return b; });
  os[0].add(os[1]); os[1].add(os[2]); os[1].add(os[3]);
  const sm = new T.SkinnedMesh(new T.BufferGeometry(), new T.MeshBasicMaterial());
  sm.add(os[0]);
  // Ordre VOLONTAIREMENT mélangé dans la liste plate : c'est ce qu'un exportateur peut produire.
  sm.bind(new T.Skeleton([os[2], os[0], os[3], os[1]]));
  const root = new T.Group();
  root.add(sm);
  return {root, os};
}

test('l arbre des os suit la PARENTE, pas l ordre de la liste plate', () => {
  const ctx = contexte();
  const {root} = rig(ctx, ['Hips', 'Spine', 'Head', 'LeftArm']);
  const tree = ctx.boneTree(ctx.skeletonOf(root));

  assert.equal(tree.length, 1, 'un rig à racine unique ne doit produire qu’une racine — '
    + tree.length + ' trouvée(s), donc la détection de racine suit la liste et non la parenté');
  assert.equal(tree[0].os.name, 'Hips');
  assert.equal(tree[0].enfants.length, 1);
  const spine = tree[0].enfants[0];
  assert.equal(spine.os.name, 'Spine');
  // LE point : Spine a DEUX enfants. Une reconstruction en chaîne en montrerait un seul, et
  // l'arbre resterait parfaitement crédible.
  // `Array.from` rapatrie le tableau depuis le royaume du `vm` : construit là-bottom, il n'est pas
  // du même `Array` que celui de ce fichier, et `deepStrictEqual` échoue sur deux valeurs
  // pourtant identiques à l'affichage. Piège récurrent des tests en `vm` de ce dépôt.
  assert.deepEqual(Array.from(spine.enfants.map((n) => n.os.name)).sort(), ['Head', 'LeftArm'],
    'Spine doit porter ses deux enfants : un rig affiché en chaîne est plausible et faux');
});

test('un os parente HORS du squelette reste une racine', () => {
  // Cas réel : beaucoup d'exports accrochent la racine du rig à un nœud vide (« Armature »).
  // Si l'on ne retenait comme racine que les os sans parent du tout, ce rig n'aurait AUCUNE
  // racine — et l'arbre serait empty, sans erreur.
  const ctx = contexte();
  const {root, os} = rig(ctx, ['Hips', 'Spine', 'Head', 'LeftArm']);
  const armature = new ctx.THREE.Group();
  armature.name = 'Armature';
  armature.add(os[0]);                    // Hips a maintenant un parent, qui n'est pas un os
  root.add(armature);
  const tree = ctx.boneTree(ctx.skeletonOf(root));
  assert.equal(tree.length, 1, 'l’arbre est vide : un rig accroché à un nœud vide ne '
    + 's’afficherait pas du tout');
  assert.equal(tree[0].os.name, 'Hips');
});

test('la convention Mixamo est reconnue, et pas devinee', () => {
  const ctx = contexte();
  const mixamo = rig(ctx, ['mixamorig:Hips', 'mixamorig:Spine', 'mixamorig:Head', 'mixamorig:LeftArm']);
  assert.equal(ctx.conventionOfNaming(ctx.skeletonOf(mixamo.root)), 'mixamo');

  // Un rig Blender ordinaire ne doit PAS être annoncé comme Mixamo : ce libellé promet que les
  // clips d'un autre export s'y adresseront, et cette promesse serait fausse.
  const blender = rig(ctx, ['Hips', 'Spine', 'Head', 'Arm.L']);
  assert.equal(ctx.conventionOfNaming(ctx.skeletonOf(blender.root)), null);

  // Une minorité d'os préfixés ne suffit pas non plus.
  const blend = rig(ctx, ['mixamorig:Hips', 'Spine', 'Head', 'Arm.L']);
  assert.equal(ctx.conventionOfNaming(ctx.skeletonOf(blend.root)), null,
    'un seul os préfixé sur quatre ne fait pas un rig Mixamo');
});

test('le squelette est trouve meme enfoui dans la hierarchie', () => {
  const ctx = contexte();
  const {root} = rig(ctx, ['Hips', 'Spine', 'Head', 'LeftArm']);
  const dessus = new ctx.THREE.Group();
  const encore = new ctx.THREE.Group();
  dessus.add(encore); encore.add(root);
  assert.ok(ctx.skeletonOf(dessus), 'un modèle importé emboîte souvent son maillage de deux '
    + 'ou trois niveaux ; ne regarder que les enfants directs raterait la plupart des rigs');
  assert.equal(ctx.isRigged(new ctx.THREE.Group()), false);
});

test('les os ne rejoignent JAMAIS les objets du project', () => {
  // La décision d'architecture de ce module. Verser les os dans `objects` les rendrait
  // sérialisables, sélectionnables, supprimables et déplaçables au gizmo — quatre façons de
  // casser un rig, dont trois silencieuses.
  const src = codeSeul(read('js/skeleton.js'));
  assert.doesNotMatch(src, /objets\.push|ajouterObjetDeScene/,
    'un os versé dans `objects` serait sauvegardé dans le project et supprimable à la souris');
  assert.match(src, /!isSceneObject\(o\)/,
    'le nettoyage doit s’appuyer sur l’index des objets de scène pour savoir ce qui a disparu');
});

test('le visuel du squelette est une aide d edit, invisible dans le jeu', () => {
  // Même règle que la grille et le gizmo. Sur le calque de project, il apparaîtrait dans le jeu
  // publié et serait peint dans l'atlas de lightmap.
  const src = codeSeul(read('js/skeleton.js'));
  assert.match(src, /h\.layers\.set\(LAYER_HELPERS\)/, 'le visuel doit être sur LAYER_HELPERS');
  assert.match(src, /h\.traverse\(function\(x\)\{ x\.layers\.set\(LAYER_HELPERS\); \}\)/,
    'SkeletonHelper a des enfants : poser le calque sur la racine seule ne suffit pas');
  // Un squelette est INTÉRIEUR au maillage qu'il déshape : testé en profondeur, il serait caché
  // par la peau qu'il anime, donc invisible exactement quand on l'allume.
  assert.match(src, /material\.depthTest = false/,
    'sans cela, la case « Afficher » semble ne rien faire');
});

test('un os se retrouve par son NOM, jamais par son identifiant', () => {
  // Les os ne sont pas des objets de project : ils sont reconstruits avec leur modèle et
  // reçoivent alors de nouveaux identifiants three, absents de toute table de correspondance.
  // Le nom, lui, traverse — c'est déjà par le nom qu'un clip d'animation s'adresse à ses nœuds.
  const ctx = contexte();
  const {root, os} = rig(ctx, ['Hips', 'Spine', 'Head', 'LeftArm']);
  assert.equal(ctx.boneByName(root, 'Spine'), os[1]);
  assert.equal(ctx.boneByName(root, 'Spine.001'), null,
    'un nom absent doit rendre null, pas un os approchant');
  assert.equal(ctx.boneByName(new ctx.THREE.Group(), 'Spine'), null,
    'un objet sans squelette ne doit pas faire tomber la résolution');
});

test('une piste dont l os a disparu est ECARTEE, pas rabattue sur l object', () => {
  // Le défaut qu'on évite : si la résolution échouait en silence, `p.os` vaudrait null et la
  // track animerait le MODÈLE ENTIER à la place de l'os. Un personnage entier qui part faire
  // le mouvement prévu pour son avant-bras — spectaculaire, et incompréhensible.
  const src = codeSeul(read('js/history.js'));
  assert.match(src, /boneAttendu: dp\.os \|\| null/,
    'la restauration doit se souvenir qu’une piste ATTENDAIT un os');
  assert.match(src, /!p\.boneAttendu \|\| p\.os/,
    'sans ce filtre, une piste d’os orpheline animerait l’object entier');
  // Et l'écriture doit bien viser (object, name d'os).
  assert.match(src, /os:\(p\.os \? p\.os\.name : null\)/,
    'une piste d’os doit être écrite avec le NOM de l’os');
});

test('la timeline distingue une piste d os d une piste d object', () => {
  // Deux pistes du même modèle porteraient sinon exactement la même étiquette, et on ne
  // saurait plus laquelle anime quoi.
  const src = codeSeul(read('js/animation.js'));
  assert.match(src, /p\.os \? \(p\.obj\.name \+ ' › ' \+ p\.os\.name\) : p\.obj\.name/,
    'l’étiquette d’une piste d’os doit nommer le modèle ET l’os');
  // `trackOf` doit discriminer sur l'os, sinon la première piste du modèle capte toutes les
  // clés — celles de l'objet comme celles de chaque os.
  assert.match(src, /x\.obj === obj && \(x\.os \|\| null\) === \(os \|\| null\)/,
    'sans discrimination sur l’os, toutes les clés atterrissent dans la même piste');
  // Le mixeur et la timeline écrivent dans les mêmes transformées : poser des clés pendant
  // qu'un clip tourne donne une pose qui tremble, sans erreur.
  assert.match(src, /animationInProgress\(selection\)/,
    'poser une clé d’os pendant qu’un clip joue doit être refusé, pas subi');
});

// ---------- ce qu'un vrai export Mixamo a appris ----------

test('la convention Mixamo est reconnue SANS les deux-points', () => {
  // Dans le fichier, Mixamo écrit `mixamorig:Hips`. Le chargeur FBX de three assainit les noms
  // et rend `mixamorigHips` — mesuré sur un export réel. Exiger le séparateur faisait échouer
  // la détection sur exactement les fichiers qu'elle aims.
  const ctx = contexte();
  const sansSeparateur = rig(ctx, ['mixamorigHips', 'mixamorigSpine', 'mixamorigHead', 'mixamorigLeftArm']);
  assert.equal(ctx.conventionOfNaming(ctx.skeletonOf(sansSeparateur.root)), 'mixamo',
    'c’est la shape que produit réellement le chargeur : la rater rend la détection inutile');
  // Avec séparateur : toujours reconnu, les deux formes coexistent.
  const avec = rig(ctx, ['mixamorig:Hips', 'mixamorig:Spine', 'mixamorig:Head', 'mixamorig:LeftArm']);
  assert.equal(ctx.conventionOfNaming(ctx.skeletonOf(avec.root)), 'mixamo');
  // Mais pas n'importe quoi commençant par ces neuf lettres : il faut un séparateur ou la
  // majuscule qui ouvre le nom de l'os.
  const faux = rig(ctx, ['mixamorigami', 'mixamorigolo', 'mixamorigueur', 'mixamorigide']);
  assert.equal(ctx.conventionOfNaming(ctx.skeletonOf(faux.root)), null,
    'annoncer « Mixamo » promet que les clips d’un autre export s’y adresseront');
});

test('un rig aux os EN DOUBLE se lie sur la premiere copie', () => {
  // LE défaut qui empêchait toute animation Mixamo. Un FBX Mixamo chargé par three contient
  // chaque os deux fois, imbriqués : un nœud extérieur qui porte la position et les enfants, et
  // à l'intérieur un homonyme resté à l'origine. Mesuré sur un export réel : 64 sur 65.
  //
  // `PropertyBinding.findNode` — donc tout le système d'animation — retient le PREMIER. Lier la
  // peau au second, c'est la lier à un os que rien n'anime : le clip tourne, des os bougent, et
  // le personnage reste figé en T-pose. Sans error.
  const ctx = contexte();
  const T = ctx.THREE;
  vm.runInContext(deEsm(read('js/anim-models.js')), ctx, {filename:'js/anim-models.js'});

  // Un os « porteur » contenant un homonyme empty, comme le fait le chargeur.
  const holder = new T.Bone(); holder.name = 'Hips'; holder.position.set(0, 1, 0);
  const interne = new T.Bone(); interne.name = 'Hips';
  holder.add(interne);
  const enfant = new T.Bone(); enfant.name = 'Spine'; holder.add(enfant);

  const sm = new T.SkinnedMesh(new T.BufferGeometry(), new T.MeshBasicMaterial());
  const root = new T.Group();
  root.add(holder); root.add(sm);
  sm.bind(new T.Skeleton([interne, enfant]));    // lié à l'INTERNE, comme le chargeur le fait

  const copie = ctx.cloneModel(root);
  let smCopie = null;
  copie.traverse((x) => { if(x.isSkinnedMesh && !smCopie) smCopie = x; });
  const hips = smCopie.skeleton.bones.find((b) => b.name === 'Hips');
  assert.ok(hips.children.some((c) => c.isBone),
    'le squelette est lié à l’homonyme intérieur — celui qui n’a ni enfant ni mouvement. '
    + 'Le personnage restera figé pendant que son clip tourne.');
  assert.equal(+hips.position.y, 1,
    'l’os lié doit être celui qui porte la position réelle, pas celui resté à l’origine');
});

test('la taille annoncee d un modele rigue est la vraie', () => {
  // `Box3.setFromObject` tient count du squelette et des matrices de liaison : sur un
  // personnage Mixamo il rendait une hauteur CENT FOIS trop petite. Le panneau d'import
  // annonçait 0,018 m pour un personnage de 1,81 m — sous les yeux de quelqu'un qui lit ce
  // chiffre justement pour choisir son unité, et qui allait le « corriger » à tort.
  const src = codeSeul(read('js/import-settings.js'));
  assert.match(src, /function boxBoundingReliable/, 'la mesure fiable a disparu');
  assert.match(src, /a\.dimensions = box\.getSize/, 'les dimensions doivent venir de cette mesure');
  const start = src.indexOf('function applyImportModel(');
  const body = src.slice(start, src.indexOf('\n}', start));
  assert.doesNotMatch(body, /Box3\(\)\.setFromObject/,
    'retour à setFromObject : la taille annoncée redevient fausse pour tout modèle rigué');
});

test('editeur et jeu publie lient le squelette de la MEME facon', () => {
  // `cloneModel` existe en deux exemplaires : js/anim-models.js pour l'éditeur, un miroir
  // dans js/game-runtime.js pour le jeu. Corriger l'un sans l'autre donnerait un personnage
  // animé dans l'éditeur et figé en T-pose une fois publié — la divergence la plus coûteuse
  // de ce dépôt, parce qu'elle ne se voit qu'après l'export.
  const motif = /if\(o\.name && !\(o\.name in byName\)\) byName\[o\.name\] = o;/;
  ['js/anim-models.js', 'js/game-runtime.js'].forEach((f) => {
    assert.match(codeSeul(read(f)), motif,
      f + ' ne retient plus la PREMIÈRE occurrence d’un nom d’os : la peau se lie à '
      + 'l’homonyme intérieur, que rien n’anime');
  });
});
