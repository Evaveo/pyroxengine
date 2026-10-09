// LE REGROUPEMENT DU DÉCOR DANS L'ÉDITEUR — ET CE QU'IL NE DOIT PAS ABÎMER.
//
// js/render-perf.js regroupe les objets identiques en lots d'instances. Il tournait déjà, mais
// SEULEMENT dans le jeu publié : ses deux appels de js/viewport.js étaient gardés par
// `modeGame.active`, un drapeau que js/play-mode.js ne met plus jamais à vrai. Le brancher dans
// l'éditeur fait gagner 341 appels de dessin sur un décor de 5 000 objets — et introduit une
// famille de défauts entièrement nouvelle, qui est le vrai sujet de ce fichier.
//
// LE DANGER. Un objet regroupé porte `visible = false`, pour que le lot le dessine à sa place.
// Ce n'est PAS un masquage, mais une dizaine de fichiers lisaient `visible` comme tel — dont la
// sérialisation. Regrouper le décor et enregistrer, c'était écrire un projet où tout le décor
// est masqué : un fichier corrompu, produit par une optimisation, et qu'on ne découvre qu'à la
// réouverture. C'est exactement la famille de défauts qui a coûté trois versions à ce dépôt en
// deux jours, et elle ne lève jamais d'erreur.
//
// Chaque test ici correspond à un de ces lecteurs, ou à l'un des trois gestes d'édition qui
// doivent continuer de marcher sur un objet regroupé : le sélectionner, le surligner, le
// masquer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { creerContexte, deEsm } from './engine-env.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Le moteur assez complet pour construire une scène, la regrouper et la sérialiser. */
function contexteScene(){
  const composants = readdirSync(path.join(root, 'js/components'))
    .filter((f) => f.endsWith('.js')).map((f) => 'js/components/' + f);
  const ctx = creerContexte(['js/component-registry.js', 'js/component.js', 'js/node.js',
    'js/component-data.js'].concat(composants)
    .concat(['js/component-migration.js', 'js/materials.js']));
  vm.runInContext('var LAYER_HELPERS = 31; var scene = new THREE.Scene();'
    + ' function updateHierarchy(){} function select(){} function setStatus(){}'
    + ' function logConsole(){} function removeHelper(){}'
    + ' var activeCam = null; function quitViewCamera(){}', ctx);
  ['js/objects.js', 'js/serialization.js'].forEach((f) => {
    vm.runInContext(deEsm(readFileSync(path.join(root, f), 'utf8')), ctx, { filename: f });
  });
  return ctx;
}

/**
 * Une allée de N cubes identiques — le décor le plus banal qui soit, et le cas que le
 * regroupement vise. Rend la liste des nœuds.
 */
function allee(ctx, n){
  return vm.runInContext(`
    (function(){
      const list = [];
      for(let i = 0; i < ${n}; i++){
        const o = createSceneNode({ name: 'Bloc ' + i, silent: true,
                                    object3d: makePrimitive('cube') });
        o.position.set(i * 2, 0, 0);
        o.material.color.setHex(0x445566);
        list.push(o);
      }
      scene.updateMatrixWorld(true);
      return list;
    })()
  `, ctx);
}

// ---------- 1. Le fichier de projet ----------

test('un decor REGROUPE s enregistre exactement comme un decor qui ne l est pas', () => {
  const ctx = contexteScene();
  allee(ctx, 12);

  const avant = vm.runInContext('JSON.stringify(objects.map(serializeObject))', ctx);
  const lots = vm.runInContext('instantiateStatic(scene, objects)', ctx);
  assert.ok(lots > 0, 'l allee doit etre regroupee, sinon ce test ne verifie rien');

  const pendant = vm.runInContext('JSON.stringify(objects.map(serializeObject))', ctx);
  assert.equal(pendant, avant,
    'le fichier de projet change selon que le decor est regroupe ou non — c est une corruption '
    + 'silencieuse, et elle ne se voit qu a la reouverture');

  vm.runInContext('undoInstances()', ctx);
  assert.equal(vm.runInContext('JSON.stringify(objects.map(serializeObject))', ctx), avant,
    'defaire le regroupement doit rendre la scene a l identique');
});

test('CONTRE-ESSAI : sans visibleIntent, l enregistrement serait bien corrompu', () => {
  // Sans ce contre-essai, le test precedent passerait aussi le jour ou le regroupement cesserait
  // de masquer quoi que ce soit — c'est-a-dire le jour ou il cesserait de servir. On verifie
  // donc que le piege existe VRAIMENT : la lecture brute de `visible` rend bien faux.
  const ctx = contexteScene();
  const list = allee(ctx, 12);
  vm.runInContext('instantiateStatic(scene, objects)', ctx);
  assert.equal(list[0].visible, false,
    'une source regroupee doit porter visible = false, sinon le lot la dessinerait en double');
  assert.equal(vm.runInContext('visibleIntent(objects[0])', ctx), true,
    'et son INTENTION doit rester « affiche »');
});

test('un objet que la personne a masque reste masque apres un aller-retour de regroupement', () => {
  const ctx = contexteScene();
  const list = allee(ctx, 12);
  list[3].visible = false;

  vm.runInContext('instantiateStatic(scene, objects)', ctx);
  assert.equal(vm.runInContext('visibleIntent(objects[3])', ctx), false,
    'le regroupement a perdu le masquage demande');
  vm.runInContext('undoInstances()', ctx);
  assert.equal(list[3].visible, false,
    'defaire le regroupement a rallume un objet que la personne avait masque — elle le '
    + 'decouvrirait sans rien pour relier la cause a l effet');
  assert.equal(list[4].visible, true, 'et les autres doivent revenir allumes');
});

// ---------- 2. Les trois gestes d'édition ----------

test('masquer un objet REGROUPE eteint bien son instance', () => {
  // Le geste : cliquer sur l'oeil du panneau Hierarchie. Sur un objet regroupe, ecrire
  // `visible = false` ne fait RIEN — le lot continue de le dessiner. C'est `visibleWanted` que
  // le panneau ecrit, et `updateInstances` qui doit le lire.
  const ctx = contexteScene();
  const list = allee(ctx, 12);
  vm.runInContext('instantiateStatic(scene, objects)', ctx);
  const lot = vm.runInContext('engineInstances.lots[0]', ctx);

  vm.runInContext('updateInstances()', ctx);
  const repere = lot.mesh.instanceMatrix.version;

  list[2].userData.visibleWanted = false;
  vm.runInContext('updateInstances()', ctx);
  assert.notEqual(lot.mesh.instanceMatrix.version, repere,
    'masquer un objet regroupe n a rien change au lot : l oeil du panneau Hierarchie ne fait '
    + 'plus rien sur un objet de decor');

  // Et il redevient visible quand on le redemande.
  const repere2 = lot.mesh.instanceMatrix.version;
  list[2].userData.visibleWanted = true;
  vm.runInContext('updateInstances()', ctx);
  assert.notEqual(lot.mesh.instanceMatrix.version, repere2, 'et le rallumer doit le redessiner');
});

test('un objet detache de son lot se dessine lui-meme, et son instance s eteint', () => {
  // Le geste : selectionner, ou survoler une ligne de l'inspecteur. Un objet regroupe est
  // dessine avec LE materiau du lot : le surligner ecrirait dans un materiau que personne ne
  // regarde, et l'objet resterait terne sous le curseur.
  const ctx = contexteScene();
  const list = allee(ctx, 12);
  vm.runInContext('instantiateStatic(scene, objects)', ctx);

  assert.equal(list[5].visible, false, 'regroupe, donc dessine par le lot');
  assert.equal(vm.runInContext('detachFromBatch(objects[5], true)', ctx), true);
  assert.equal(list[5].visible, true, 'detache, il doit se dessiner lui-meme');
  assert.equal(list[5].userData.instanceCachee, true, 'et son instance doit s eteindre');

  assert.deepEqual(vm.runInContext('detachedFromBatch().length', ctx), 1,
    'le registre des detaches doit le connaitre, sinon plus rien ne le remettra dans son lot');

  vm.runInContext('detachFromBatch(objects[5], false)', ctx);
  assert.equal(list[5].visible, false, 'remis dans son lot, il cesse de se dessiner seul');
  assert.equal(vm.runInContext('detachedFromBatch().length', ctx), 0);
});

test('detacher un objet qui n est dans AUCUN lot ne fait rien', () => {
  const ctx = contexteScene();
  allee(ctx, 3);   // sous le seuil de regroupement : aucun lot
  assert.equal(vm.runInContext('instantiateStatic(scene, objects)', ctx), 0);
  assert.equal(vm.runInContext('detachFromBatch(objects[0], true)', ctx), false,
    'detacher un objet libre doit etre sans effet, pas une erreur');
  assert.equal(vm.runInContext('objects[0].visible', ctx), true,
    'et surtout ne pas toucher a sa visibilite');
});

test('cacher un objet regroupe par une ACTION d evenement fonctionne', () => {
  // LE DEFAUT QUE CE TEST FERME, et il vivait deja dans le jeu publie AVANT ce chantier : le
  // runtime regroupe son decor des le chargement de la scene, et les trois actions
  // « montrer / cacher / basculer » ecrivaient `target.visible`. Sur une source regroupee, ca
  // ne fait RIEN — le lot continue de la dessiner. L'action marchait dans l'editeur, qui ne
  // regroupait pas, et pas dans le jeu. Aucune erreur, aucune trace.
  const ctx = contexteScene();
  const list = allee(ctx, 12);
  vm.runInContext('instantiateStatic(scene, objects)', ctx);
  const lot = vm.runInContext('engineInstances.lots[0]', ctx);
  vm.runInContext('updateInstances()', ctx);

  const repere = lot.mesh.instanceMatrix.version;
  vm.runInContext('setVisibleIntent(objects[4], false); updateInstances();', ctx);
  assert.equal(vm.runInContext('visibleIntent(objects[4])', ctx), false);
  assert.notEqual(lot.mesh.instanceMatrix.version, repere,
    'cacher un objet regroupe n a pas eteint son instance : l action « cacher » d un evenement '
    + 'reste sans effet sur tout objet de decor');

  // CONTRE-ESSAI : l'ecriture directe, celle qui ne marchait pas, ne doit toujours rien faire.
  const repere2 = lot.mesh.instanceMatrix.version;
  list[6].visible = false;
  vm.runInContext('updateInstances()', ctx);
  assert.equal(lot.mesh.instanceMatrix.version, repere2,
    'ecrire `visible` sur une source regroupee devrait rester sans effet — si ca marche, la '
    + 'distinction entre etat de rendu et intention n existe plus');

  // ET SURTOUT : rallumer un objet regroupe ne doit pas le rendre a lui-meme. Il serait alors
  // dessine DEUX fois — par le lot et par lui — ce qui ne se voit qu'en z-fighting sur les
  // faces coplanaires, ou pas du tout, tout en doublant son cout.
  vm.runInContext('setVisibleIntent(objects[4], true)', ctx);
  assert.equal(list[4].visible, false,
    'une source regroupee doit rester `visible = false` : c est son lot qui la dessine');
  assert.equal(vm.runInContext('visibleIntent(objects[4])', ctx), true,
    'et son intention doit bien etre « affiche »');
});

test('les trois actions d evenement passent par l assesseur, des DEUX cotes', () => {
  // Garde de SOURCE, et elle est necessaire : la logique d'evenements vit dans deux fichiers —
  // js/events.js pour l'editeur, js/game-runtime.js pour le jeu publie — et c'est la copie du
  // runtime qui portait le defaut. Un test de comportement sur l'un laisserait l'autre
  // diverger, ce qui est exactement ce qui s'etait produit.
  const source = (f) => readFileSync(path.join(root, f), 'utf8')
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  [['js/events.js', 'setVisible('], ['js/game-runtime.js', 'rtSetVisible(']].forEach(([f, appel]) => {
    const src = source(f);
    ['montrer', 'hide', 'toggle'].forEach((action) => {
      const ligne = src.split('\n').find((l) => l.includes("case '" + action + "'"));
      assert.ok(ligne, f + ' n a plus d action « ' + action + ' »');
      assert.ok(ligne.includes(appel),
        f + ' : l action « ' + action + ' » ecrit `visible` directement. Sur un objet regroupe '
        + 'cela ne fait rien, et le decor d un jeu publie est toujours regroupe.');
      assert.equal(/target\.visible\s*=/.test(ligne), false,
        f + ' : l action « ' + action + ' » ecrit encore `target.visible`');
    });
    // L'assesseur local doit DELEGUER. Sans cette ligne, vider son corps en un simple
    // `o.visible = v` laissait les trois assertions ci-dessus parfaitement vertes — mutation
    // essayee, mutation passee : le detour par une fonction locale deplace le defaut, il ne
    // l'empeche pas.
    assert.ok(/setVisibleIntent\(/.test(src),
      f + ' : son assesseur d affichage n appelle plus setVisibleIntent — le detour par une '
      + 'fonction locale ne sert plus a rien');
    assert.ok(/visibleIntent\(/.test(src),
      f + ' : son assesseur ne lit plus l intention');
  });
});

// ---------- 3. La politique de l'éditeur ----------

test('la selection n entre jamais dans un lot', () => {
  const ctx = creerContexte(['js/editor-batching.js']);
  const T = ctx.THREE;
  const scene = new T.Scene(), objects = [];
  for(let i = 0; i < 12; i++){
    const m = new T.Mesh(new T.BoxGeometry(1, 1, 1), new T.MeshStandardMaterial({color: 0x334455}));
    m.position.set(i, 0, 0);
    m.userData.game = {layer: 0};
    scene.add(m);
    objects.push(m);
  }
  scene.updateMatrixWorld(true);

  // `now` est passé pour ne pas attendre le délai de calme : un test ne doit pas dormir.
  const plusTard = Date.now() + 10000;
  const r = ctx.updateEditorBatching(scene, objects, [objects[0]], plusTard);
  assert.equal(r.objects, 11,
    'l objet selectionne doit rester hors du lot : on l edite, son materiau doit rester le sien');
  assert.equal(objects[0].visible, true, 'et il doit continuer de se dessiner lui-meme');
});

test('une mutation de scene fait refaire les lots, mais pas tout de suite', () => {
  const ctx = creerContexte(['js/editor-batching.js']);
  const T = ctx.THREE;
  const scene = new T.Scene(), objects = [];
  for(let i = 0; i < 12; i++){
    const m = new T.Mesh(new T.BoxGeometry(1, 1, 1), new T.MeshStandardMaterial({color: 0x334455}));
    m.userData.game = {layer: 0};
    scene.add(m);
    objects.push(m);
  }
  scene.updateMatrixWorld(true);

  // `editorBatching` et `BATCH_DELAY_MS` sont des `const` top-niveau : ils vivent dans la
  // portee lexicale du contexte, pas parmi les proprietes de l'objet global. On les lit donc
  // DEDANS.
  const etat = () => vm.runInContext('editorBatching', ctx);
  const delai = vm.runInContext('BATCH_DELAY_MS', ctx);

  ctx.updateEditorBatching(scene, objects, [], Date.now() + 10000);
  const builds = etat().builds;

  ctx.markBatchingDirty();
  ctx.updateEditorBatching(scene, objects, [], etat().lastChange + 10);
  assert.equal(etat().builds, builds,
    'les lots sont refaits pendant qu on travaille : chaque geste couterait une reconstruction');

  ctx.updateEditorBatching(scene, objects, [], etat().lastChange + delai + 1);
  assert.equal(etat().builds, builds + 1,
    'apres le delai de calme, les lots doivent avoir ete refaits — sinon une couleur changee '
    + 'sur un objet de decor ne se verrait jamais');
});

// ---------- 4. Le module doit partir dans les builds ----------

test('un jeu sans niveau de detail embarque quand meme le regroupement', () => {
  // LE DEFAUT : la condition d'embarquement ne regardait que `o.detail` (la distance de
  // disparition). Un jeu dont personne n'a regle de LOD — c'est-a-dire presque tous — partait
  // donc SANS js/render-perf.js, donc sans regroupement : 5 000 appels de dessin au lieu de 49.
  // Invisible dans l'editeur et dans l'apercu, qui chargent tout ; visible seulement dans le
  // jeu exporte, et seulement a la cadence.
  const ctx = creerContexte(['js/build-trimming.js']);
  const objet = (i) => ({name: 'Bloc ' + i, pos: [i, 0, 0], components: [{type: 'Mesh', data: {}}]});
  const scene = (n) => ({scenes: [{data: {objects: Array.from({length: n}, (_, i) => objet(i))}}]});

  // `MODULES_OPTIONAL` est un `const` top-niveau : il rejoint la portee lexicale du
  // contexte, jamais les proprietes de l'objet global. On le lit donc DANS le contexte.
  const module = vm.runInContext('MODULES_OPTIONAL', ctx)
    .find((m) => m.file === 'js/render-perf.js');
  assert.ok(module, 'js/render-perf.js n est plus un module facultatif');

  assert.equal(module.besoin(scene(12)), true,
    'douze objets sans LOD : le regroupement peut former des lots, le module doit partir');
  assert.equal(module.besoin(scene(3)), false,
    'trois objets : aucun lot possible, le module ne sert a rien et vingt kilo-octets comptent');

  // Le chemin d'origine doit continuer de marcher : un seul objet avec un LOD suffit.
  const avecLod = scene(2);
  avecLod.scenes[0].data.objects[0].detail = {distance: 40};
  assert.equal(module.besoin(avecLod), true,
    'un objet porteur d une distance de disparition exige le module, quel que soit leur nombre');
});
