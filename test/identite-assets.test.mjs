// moteur/test/identite-assets.test.mjs
//
// L'IDENTITÉ D'UN ASSET NE BOUGE PLUS — et ce test est ce qui l'empêche de recommencer.
//
// Pendant longtemps, `assetId` était un compteur de SESSION : rouvrir un projet recréait tous
// les assets avec de nouveaux numéros, dans l'ordre où le chargeur les rencontrait. Les
// fichiers, eux, gardaient les numéros de la veille. Tout ne tenait plus que par une table de
// traduction tenue à la main, champ par champ, sur les ~500 références d'un projet réel — et
// chaque champ oublié donnait soit une référence morte (« document d interface a1
// introuvable »), soit une référence GLISSÉE vers l'asset qui avait hérité du numéro, sans un
// mot. Cinq corrections après coup : sprite2d.spriteId, scriptId, Model.assetId,
// PostVolume.profileId, UIDocument.documentUIId.
//
// Les tests voisins (remap-references*.test.mjs) mesurent que la TABLE est complète. Celui-ci
// mesure la chose d'un rang au-dessus : que la table n'a plus rien à traduire. Il charge dans
// un ORDRE DÉLIBÉRÉMENT DIFFÉRENT de celui du fichier — c'est le seul moyen de voir un
// glissement, et c'est exactement ce que les anciens tests ne faisaient pas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { creerContexte, deEsm } from './engine-env.mjs';

const env = creerContexte(['js/tile-palette.js', 'js/assets.js', 'js/materials.js',
  'js/model-import.js', 'js/import-settings.js', 'js/post-profile.js', 'js/project-settings.js',
  'js/serialization.js']);

// Des descripteurs d'assets « texte » (aucun fichier binaire à résoudre), un par genre qui
// porte ou reçoit une référence. Les numéros sont volontairement TROUÉS et DÉSORDONNÉS : un
// projet réel en a autant, après quelques suppressions.
function descriptors(){
  return [
    {id: 'a7',  kind: 'documentUI', name: 'menu',   folder: 'Interfaces', html: '<p>ok</p>'},
    {id: 'a3',  kind: 'script',     name: 'jeu',    folder: 'Scripts',    code: '// jeu'},
    {id: 'a12', kind: 'sheetStyle', name: 'menu',   folder: 'Styles',     css: 'p{}'},
    {id: 'a2',  kind: 'data',       name: 'table',  folder: 'Donnees',    text: '[]'},
    {id: 'a9',  kind: 'postProfile', name: 'post',  folder: 'Post',       effects: {}},
    {id: 'a5',  kind: 'animator',   name: 'machine', folder: '',          machine: {}}
  ];
}

async function reload(das){
  env.assets.length = 0;
  return await env.rebuildAssetsFromDescriptors(das, async function(){
    throw new Error('aucun fichier attendu');
  });
}

test('un asset relu reprend EXACTEMENT l id qu il portait dans le fichier', async () => {
  const das = descriptors();
  await reload(das);
  for(const da of das){
    const a = env.assets.find((x) => x.name === da.name && x.kind === da.kind);
    assert.ok(a, 'asset « ' + da.name + ' » (' + da.kind + ') absent après rechargement');
    assert.equal(a.id, da.id,
      da.kind + ' « ' + da.name + ' » a été renuméroté ' + da.id + ' → ' + a.id
      + '. Toute référence écrite dans une scène désigne maintenant un autre asset, ou rien.');
  }
});

test('deux rechargements de suite donnent les mêmes ids (pas de dérive)', async () => {
  await reload(descriptors());
  const premier = env.assets.map((a) => a.kind + ':' + a.name + '=' + a.id).sort();
  await reload(descriptors());
  const second = env.assets.map((a) => a.kind + ':' + a.name + '=' + a.id).sort();
  assert.deepEqual(second, premier,
    'les ids ont dérivé entre deux ouvertures — c est la panne d origine, elle est revenue.');
});

test('l ordre de lecture ne change RIEN aux ids attribués', async () => {
  await reload(descriptors());
  const attendu = {};
  env.assets.forEach((a) => { attendu[a.kind + ':' + a.name] = a.id; });
  // L'ordre inverse : c'est celui qui faisait glisser les références d'un rang.
  await reload(descriptors().reverse());
  env.assets.forEach((a) => {
    assert.equal(a.id, attendu[a.kind + ':' + a.name],
      a.kind + ' « ' + a.name + ' » change d id selon l ordre de lecture du manifeste.');
  });
});

test('un asset découvert sur le disque ne vole jamais le numéro d un asset déclaré', async () => {
  // `decouvert:<chemin>` n'est pas une identité persistante : l'asset reçoit un numéro FRAIS.
  // Il doit être au-dessus de tous les numéros déclarés, sinon il prend les références d'un
  // autre — c'est le rôle de la réservation préalable du compteur.
  const das = descriptors().concat([
    {id: 'decouvert:assets/Scripts/ajoute.js', kind: 'script', name: 'ajoute',
     folder: 'Scripts', code: ''}
  ]);
  await reload(das);
  const neuf = env.assets.find((a) => a.name === 'ajoute');
  const declares = new Set(descriptors().map((d) => d.id));
  assert.ok(neuf, 'l asset découvert n a pas été créé');
  assert.ok(!declares.has(neuf.id),
    'l asset découvert a reçu ' + neuf.id + ', déjà pris par un asset déclaré du manifeste.');
});

test('deux descripteurs qui revendiquent le même id ne peuvent pas se confondre', async () => {
  // Un fichier dupliqué à la main emporte son `.meta` : deux cartes d identité, un seul numéro.
  // Le second doit repartir avec un numéro à lui — deux assets indiscernables, c est la
  // corruption que toute cette mécanique existe pour empêcher.
  await reload([
    {id: 'a4', kind: 'script', name: 'un',   folder: '', code: ''},
    {id: 'a4', kind: 'script', name: 'deux', folder: '', code: ''}
  ]);
  const ids = env.assets.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length,
    'deux assets partagent le même id : ' + ids.join(', '));
});

test('les références de scène traversent un rechargement sans bouger', async () => {
  const assetsById = await reload(descriptors());
  const scenes = [{name: 'S', data: {objects: [{
    name: 'Menu',
    components: [{type: 'UIDocument', active: true,
                  data: {documentUIId: 'a7', sheetStyleIds: ['a12']}},
                 {type: 'ScriptJS', active: true, data: {scriptId: 'a3'}}],
    scripts: [{scriptId: 'a3'}]
  }]}}];
  env.remapReferencesAssetsInScenes(scenes, assetsById);
  const o = scenes[0].data.objects[0];
  assert.equal(o.components[0].data.documentUIId, 'a7', 'le document d interface a changé d id');
  assert.deepEqual(Array.from(o.components[0].data.sheetStyleIds), ['a12'], 'la feuille de style a changé d id');
  assert.equal(o.components[1].data.scriptId, 'a3', 'le script du composant a changé d id');
  assert.equal(o.scripts[0].scriptId, 'a3', 'le script du sac à plat a changé d id');
});

// ---------- Le rapport de références mortes ----------

test('une référence morte est vue, même dans un champ qu aucune table ne connaît', () => {
  // LE POINT ENTIER de ce rapport : il ne connaît AUCUN champ. Un champ inventé aujourd hui,
  // qu aucune table de remappage ne traverse, est quand même signalé.
  const scenes = [{name: 'S', data: {objects: [
    {name: 'Menu', components: [{type: 'UIDocument', data: {documentUIId: 'a1'}}]},
    {name: 'Sol',  champInvente: {trucId: 'a99', truqueIds: ['a98', 'a7']}}
  ]}}];
  const dead = env.deadReferencesOf(scenes, {a7: {id: 'a7'}});
  const ids = Array.from(dead, (d) => d.id).sort();
  assert.deepEqual(ids, ['a1', 'a98', 'a99'],
    'le rapport rate une référence morte — ou en invente une : ' + JSON.stringify(dead));
  assert.equal(dead.find((d) => d.id === 'a1').object, 'Menu',
    'le rapport doit nommer l objet porteur, sinon il est inexploitable');
});

test('un projet sain ne produit AUCUNE référence morte', () => {
  const scenes = [{name: 'S', data: {objects: [
    {name: 'Menu', components: [{type: 'UIDocument',
      data: {documentUIId: 'a7', sheetStyleIds: ['a12']}}]}
  ]}}];
  assert.deepEqual(Array.from(env.deadReferencesOf(scenes, {a7: {}, a12: {}})), [],
    'un faux positif rendrait le rapport inutilisable — donc ignoré, donc inutile.');
});

test('le rapport ne confond pas un id de nœud avec une référence d asset', () => {
  // Les ids d objets de scène sont des NOMBRES : `isRefAsset` ne doit voir que la forme « aN ».
  const scenes = [{name: 'S', data: {objects: [
    {name: 'Sol', id: 42, parent: 7, materialId: 'a3'}
  ]}}];
  const dead = env.deadReferencesOf(scenes, {});
  assert.deepEqual(Array.from(dead, (d) => d.field), ['materialId']);
});

// ---------- Les cartes d'identité (.meta) du format dossier ----------
//
// Chargées dans leur PROPRE contexte : project-folder.js est le seul module de js/ qui ne
// dépende d'aucun DOM, et le monter à part vaut preuve qu'il le reste.
const ctxFolder = vm.createContext({console: console, TextEncoder: TextEncoder});
vm.runInContext(deEsm(readFileSync(new URL('../js/file-names.js', import.meta.url), 'utf8')), ctxFolder);
vm.runInContext(deEsm(readFileSync(new URL('../js/project-folder.js', import.meta.url), 'utf8')), ctxFolder);


// Un `const` de haut niveau d'un script `vm` vit dans la portee lexicale du contexte, PAS
// comme propriete de l'objet sandbox : `ctx.SUFFIX_META` rend `undefined` alors que la
// constante existe. Deux `undefined` etant egaux, un test ecrit ainsi passe au vert sans rien
// mesurer — c'est arrive ici meme. On evalue donc le nom DANS le contexte.
function valueOf(ctx, name){ return vm.runInContext(name, ctx); }

function fileFake(name, content){
  return {kind: 'file', name: name, async getFile(){
    return {name: name, size: content.length, lastModified: 1,
            async text(){ return content; }};
  }};
}
function treeOf(entries){
  return {files: Object.entries(entries).map(([filePath, content]) => ({
    filePath: filePath, handle: fileFake(filePath.split('/').pop(), content),
    size: content.length, lastModif: 1})), folders: []};
}

test('le suffixe ECRIT et le suffixe LU sont le même — sinon rien ne se relit', () => {
  // serialization.js écrit les cartes, project-folder.js les lit, et les deux portent leur
  // propre constante pour ne pas se créer une dépendance que la moitié des tests ne monte pas.
  // Ce test est la seule chose qui les empêche de diverger — et une divergence rendrait toutes
  // les cartes d'identité muettes, sans le moindre message.
  assert.equal(valueOf(env, 'SUFFIX_META'), valueOf(ctxFolder, 'META_SUFFIX'),
    'le suffixe des cartes d identite a diverge entre l ecriture et la lecture');
  assert.equal(valueOf(env, 'VERSION_META_WRITTEN'), valueOf(ctxFolder, 'VERSION_META'),
    'la version des cartes d identite a diverge entre l ecriture et la lecture');
});

test('une carte d identité n apparaît JAMAIS comme un asset du panneau Projet', () => {
  const tree = treeOf({
    'assets/Interfaces/menu.html': '<p></p>',
    'assets/Interfaces/menu.html.meta': '{"version":1,"id":"a7","kind":"documentUI","name":"menu"}'
  });
  const d = valueOf(ctxFolder, 'discoverFolderAssets')(tree, [], new Map());
  assert.equal(d.length, 1, 'la carte a été prise pour un asset : ' + JSON.stringify(d));
  assert.equal(d[0].file, 'menu.html');
});

test('un fichier qui revient avec sa carte retrouve son identité', async () => {
  const tree = treeOf({
    'assets/Scripts/jeu.js': '// jeu',
    'assets/Scripts/jeu.js.meta': '{"version":1,"id":"a3","kind":"script","name":"jeu"}'
  });
  const metas = await valueOf(ctxFolder, 'readMetas')(tree);
  const d = valueOf(ctxFolder, 'discoverFolderAssets')(tree, [], metas);
  assert.equal(d[0].id, 'a3',
    'le script découvert reprend un numéro neuf au lieu du sien : toutes ses références meurent');
  assert.equal(d[0].name, 'jeu');
});

test('sans carte, un fichier découvert ne revendique AUCUNE identité persistante', async () => {
  const tree = treeOf({'assets/Scripts/neuf.js': ''});
  const d = valueOf(ctxFolder, 'discoverFolderAssets')(tree, [], await valueOf(ctxFolder, 'readMetas')(tree));
  assert.match(d[0].id, /^decouvert:/,
    'un fichier sans carte ne doit pas inventer un id, il doit en recevoir un frais');
});

test('une carte qui revendique un id DÉJÀ pris par le manifeste est ignorée', async () => {
  // Un fichier dupliqué à la main emporte sa carte : deux fichiers, un seul numéro. Le sosie
  // doit repartir anonyme, sinon deux assets deviennent indiscernables.
  const tree = treeOf({
    'assets/Scripts/copie.js': '',
    'assets/Scripts/copie.js.meta': '{"version":1,"id":"a3","kind":"script","name":"jeu"}'
  });
  const metas = await valueOf(ctxFolder, 'readMetas')(tree);
  const d = valueOf(ctxFolder, 'discoverFolderAssets')(tree, [{id: 'a3', kind: 'script', name: 'jeu',
    folder: 'Scripts', file: 'jeu.js'}], metas);
  assert.match(d[0].id, /^decouvert:/, 'le sosie a volé le numéro de l original');
});

test('un fichier RENOMMÉ à la main est retrouvé grâce à sa carte d identité', async () => {
  // Le cas qui, avant les cartes, coûtait TOUTES les références de l asset : le manifeste citait
  // un fichier absent (asset perdu) pendant qu un inconnu était découvert juste à côté.
  const tree = treeOf({
    'assets/Interfaces/menu-v2.html': '<p></p>',
    'assets/Interfaces/menu-v2.html.meta': '{"version":1,"id":"a7","kind":"documentUI","name":"menu"}'
  });
  const declares = [{id: 'a7', kind: 'documentUI', name: 'menu', folder: 'Interfaces',
                     file: 'menu.html'}];
  const metas = await valueOf(ctxFolder, 'readMetas')(tree);
  const reloges = valueOf(ctxFolder, 'relocateAssetsByMeta')(declares, metas, tree);
  assert.equal(reloges.length, 1, 'le fichier renommé n a pas été retrouvé');
  assert.equal(declares[0].file, 'menu-v2.html');
  assert.equal(declares[0].folder, 'Interfaces');
  // Et il n est PAS redécouvert en double : le manifeste le revendique maintenant.
  assert.equal(valueOf(ctxFolder, 'discoverFolderAssets')(tree, declares, metas).length, 0,
    'le fichier relogé est en plus redécouvert comme un asset inconnu : doublon');
});

test('la carte suit son fichier quand l asset est déplacé ou supprimé', () => {
  assert.deepEqual(Array.from(valueOf(ctxFolder, 'withMetas')(['jeu.js', 'menu.html'])),
    ['jeu.js', 'jeu.js.meta', 'menu.html', 'menu.html.meta']);
  assert.deepEqual(Array.from(valueOf(ctxFolder, 'withMetas')(['jeu.js.meta'])), ['jeu.js.meta'],
    'une carte ne doit pas recevoir sa propre carte');
});

test('la sauvegarde écrit une carte d identité pour CHAQUE genre à fichier', () => {
  // Le point qui empêche l oubli : un genre ajouté demain à diskAssetManifest reçoit sa carte
  // sans qu on écrive une ligne de plus — et ce test le vérifie genre par genre.
  env.assets.length = 0;
  vm.runInContext([
    "assets.push({id:'a2', kind:'script',      name:'jeu',   folder:'Scripts', code:''});",
    "assets.push({id:'a3', kind:'documentUI',  name:'menu',  folder:'UI',      html:''});",
    "assets.push({id:'a4', kind:'sheetStyle',  name:'menu',  folder:'UI',      css:''});",
    "assets.push({id:'a5', kind:'data',        name:'table', folder:'D',       text:'[]'});",
    "assets.push({id:'a6', kind:'animator',    name:'m',     folder:'',        machine:{}});",
    "assets.push({id:'a7', kind:'postProfile', name:'p',     folder:'',        effects:{}});"
  ].join('\n'), env);
  const {assets: das, filesAWrite} = valueOf(env, 'diskAssetManifest')();
  const ecrits = new Set(Array.from(filesAWrite, (f) => f.filePath));
  for(const da of das){
    const attendu = 'assets/' + (da.folder ? da.folder + '/' : '') + da.file + valueOf(env, 'SUFFIX_META');
    assert.ok(ecrits.has(attendu),
      da.kind + ' « ' + da.name + ' » est enregistré SANS carte d identité (' + attendu + ')');
  }
  // Et le contenu est relisible par le lecteur, pas seulement bien formé.
  const une = filesAWrite.find((f) => f.filePath.endsWith(valueOf(env, 'SUFFIX_META')));
  const lu = JSON.parse(une.content);
  assert.match(lu.id, /^a\d+$/);
  assert.ok(lu.kind && lu.version, 'la carte doit porter son genre et sa version');
});
