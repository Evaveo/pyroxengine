import { deEsm } from './engine-env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

const code = deEsm(fs.readFileSync(new URL('../js/project-folder.js', import.meta.url), 'utf8'));
const codeNomsFichiers = deEsm(fs.readFileSync(new URL('../js/file-names.js', import.meta.url), 'utf8'));
const ctx = vm.createContext({});
// validateNameFile vit dans fichier-names.js (Task 1) ; dans l'éditeur réel, tous
// les scripts partagent le même scope window. Ici, on charge la vraie implémentation
// dans le même contexte vm avant project-folder.js, pour que writeFileInFolder
// utilise exactement la même validation qu'en production (pas une réimplémentation
// susceptible de diverger silencieusement des règles réelles).
vm.runInContext(codeNomsFichiers, ctx);
vm.runInContext(code, ctx);
const { scanFolder, loadManifestFromTree, diffTrees, checkLock, loadProjectFromFolder, writeFileInFolder, registerInFolder, createFolderEmptyOnDisk, writeAssetInFolder, resolveAssetDescriptors } = ctx;

function fauxFichier(name, content){
  return {
    kind: 'file',
    name: name,
    async getFile(){
      return { name: name, size: content.length, lastModified: 1000,
        async text(){ return content; },
        async arrayBuffer(){ return new TextEncoder().encode(content).buffer; } };
    }
  };
}

function fauxDossier(name, inputs){
  return {
    kind: 'directory',
    name: name,
    async *entries(){ for(const e of inputs) yield [e.name, e]; }
  };
}

test('scanne un dossier plat', async () => {
  const root = fauxDossier('MonProjet', [
    fauxFichier('project.json', '{"name":"Test"}'),
  ]);
  const tree = await scanFolder(root);
  assert.equal(tree.files.length, 1);
  assert.equal(tree.files[0].filePath, 'project.json');
});

test('scanne récursivement les sous-folders', async () => {
  const root = fauxDossier('MonProjet', [
    fauxDossier('assets', [
      fauxDossier('Textures', [ fauxFichier('mur.png', 'binaire') ]),
    ]),
  ]);
  const tree = await scanFolder(root);
  // Array.from() re-matérialise le tableau dans le realm du test : les valeurs
  // retournées par du code exécuté via vm.runInContext() appartiennent au realm
  // du sandbox, et assert.deepEqual compare aussi l'identité de prototype
  // (Array.prototype du sandbox ≠ Array.prototype de ce fichier), pas seulement
  // les valeurs — sans cette conversion, l'assertion échoue même à contenu égal.
  const chemins = Array.from(tree.files.map(f => f.filePath)).sort();
  assert.deepEqual(chemins, ['assets/Textures/mur.png']);
});

test('expose taille et date de dernière modification pour comparaison de re-scan', async () => {
  const root = fauxDossier('MonProjet', [ fauxFichier('a.txt', 'abc') ]);
  const tree = await scanFolder(root);
  assert.equal(tree.files[0].size, 3);
  assert.equal(tree.files[0].lastModif, 1000);
});

test('charge le manifeste project.json depuis l\'tree scanné', async () => {
  const contenuManifeste = JSON.stringify({ name: 'Demo', version: 1, folders: ['Textures'] });
  const root = fauxDossier('MonProjet', [ fauxFichier('project.json', contenuManifeste) ]);
  const tree = await scanFolder(root);
  const manifest = await loadManifestFromTree(tree);
  assert.equal(manifest.name, 'Demo');
  assert.deepEqual(JSON.parse(JSON.stringify(manifest.folders)), ['Textures']);
});

test('error explicite si project.json absent', async () => {
  const root = fauxDossier('MonProjet', [ fauxFichier('autre.txt', 'x') ]);
  const tree = await scanFolder(root);
  await assert.rejects(() => loadManifestFromTree(tree), /project\.json/);
});

test('diffTrees détecte files ajoutés/modifiés/supprimés', () => {
  const avant = { files: [
    { filePath: 'a.txt', size: 3, lastModif: 100 },
    { filePath: 'b.txt', size: 3, lastModif: 100 },
  ]};
  const apres = { files: [
    { filePath: 'a.txt', size: 3, lastModif: 100 },
    { filePath: 'b.txt', size: 5, lastModif: 200 },
    { filePath: 'c.txt', size: 1, lastModif: 300 },
  ]};
  const diff = diffTrees(avant, apres);
  assert.deepEqual(Array.from(diff.ajoutes).sort(), ['c.txt']);
  assert.deepEqual(Array.from(diff.modifies).sort(), ['b.txt']);
  assert.deepEqual(Array.from(diff.supprimes).sort(), []);
});

function fauxDossierEcriture(name, inputs){
  const d = fauxDossier(name, inputs);
  d.getFileHandle = async (fileName, opts) => {
    let existant = inputs.find(e => e.name === fileName);
    if(!existant){
      if(!opts || !opts.create){
        const error = new Error(`Fichier introuvable : ${fileName}`);
        error.name = 'NotFoundError'; // même nom que l'exception réelle de FileSystemDirectoryHandle.getFileHandle()
        throw error;
      }
      existant = fauxFichierEcrivable(fileName, '');
      inputs.push(existant);
    }
    return existant;
  };
  d.getDirectoryHandle = async (nomSousDossier, opts) => {
    let existant = inputs.find(e => e.name === nomSousDossier && e.kind === 'directory');
    if(!existant){
      if(!opts || !opts.create){
        const error = new Error(`Dossier introuvable : ${nomSousDossier}`);
        error.name = 'NotFoundError';
        throw error;
      }
      existant = fauxDossierEcriture(nomSousDossier, []);
      inputs.push(existant);
    }
    return existant;
  };
  // moveFilesAssetOnDisk supprime le fichier d'origine après l'avoir recopié
  // à sa nouvelle place — sans quoi le déplacement serait une duplication.
  d.removeEntry = async (fileName) => {
    const i = inputs.findIndex(e => e.name === fileName);
    if(i === -1){ const err = new Error('introuvable'); err.name = 'NotFoundError'; throw err; }
    inputs.splice(i, 1);
  };
  return d;
}

function fauxFichierEcrivable(name, contenuInitial){
  let content = contenuInitial;
  return {
    kind: 'file', name: name,
    async getFile(){
      return { name: name, size: content.length, lastModified: Date.now(),
        // writeAssetInFolder écrit des ArrayBuffer (contenu binaire réel) en plus
        // des chaînes JSON écrites par registerInFolder/checkLock — .text()
        // décode les deux comme le ferait un vrai File.
        async text(){ return content instanceof ArrayBuffer ? new TextDecoder().decode(content) : content; },
        async arrayBuffer(){
          return content instanceof ArrayBuffer ? content : new TextEncoder().encode(content).buffer;
        } };
    },
    async createWritable(){
      return { async write(data){ content = data; }, async close(){} };
    }
  };
}

test('aucun verrou existant : pas d\'avertissement', async () => {
  const root = fauxDossierEcriture('MonProjet', []);
  const result = await checkLock(root, 'session-A');
  assert.equal(result.dejaOpenAilleurs, false);
});

test('verrou récent d\'une autre session : avertissement', async () => {
  const verrouExistant = fauxFichierEcrivable('.editeur-lock.json',
    JSON.stringify({ session: 'session-B', horodatage: Date.now() }));
  const root = fauxDossierEcriture('MonProjet', [verrouExistant]);
  const result = await checkLock(root, 'session-A');
  assert.equal(result.dejaOpenAilleurs, true);
});

test('verrou périmé d\'une autre session : pas d\'avertissement', async () => {
  const verrouPerime = fauxFichierEcrivable('.editeur-lock.json',
    JSON.stringify({ session: 'session-B', horodatage: Date.now() - 20 * 60 * 1000 }));
  const root = fauxDossierEcriture('MonProjet', [verrouPerime]);
  const result = await checkLock(root, 'session-A');
  assert.equal(result.dejaOpenAilleurs, false);
});

test('error non liée à l\'absence de fichier : propagée, pas avalée', async () => {
  const root = fauxDossierEcriture('MonProjet', []);
  root.getFileHandle = async (fileName, opts) => {
    if(!opts || !opts.create){
      const error = new Error('Accès refusé');
      error.name = 'NotAllowedError';
      throw error;
    }
    return fauxFichierEcrivable(fileName, '');
  };
  await assert.rejects(() => checkLock(root, 'session-A'), /Accès refusé/);
});

test('charge le manifeste et le contenu réel des scènes référencées', async () => {
  const manifest = JSON.stringify({ name: 'Demo', folders: [], scenes: [{name: 'Niveau1'}] });
  const sceneJson = JSON.stringify({ objects: [], tracks: [], duration: 0, loop: false, env: null });
  const root = fauxDossierEcriture('MonProjet', [
    fauxFichierEcrivable('project.json', manifest),
    fauxDossier('scenes', [ fauxFichierEcrivable('Niveau1.scene.json', sceneJson) ]),
  ]);
  const result = await loadProjectFromFolder(root, 'session-test');
  assert.equal(result.manifest.name, 'Demo');
  assert.equal(result.scenes.length, 1);
  assert.equal(result.scenes[0].name, 'Niveau1');
  // JSON.stringify/parse re-matérialise l'objet dans le realm du test — même bug de
  // realm croisé rencontré en Task 2/3 (assert.deepEqual compare aussi le prototype,
  // pas seulement les valeurs, pour les résultats retournés par du code exécuté en vm).
  // `version: 1` est POSÉ par migrateSceneFile : chaque fichier de scène porte désormais sa
  // propre version, parce que registerInFolder n'écrit que la scène courante.
  assert.deepEqual(JSON.parse(JSON.stringify(result.scenes[0].data)),
                   Object.assign(JSON.parse(sceneJson), { version: 1 }));
});

test('scène listée dans le manifeste mais jamais enregistrée sur disque : data = null', async () => {
  const manifest = JSON.stringify({ name: 'Demo', folders: [], scenes: [{name: 'Vide'}] });
  const root = fauxDossierEcriture('MonProjet', [ fauxFichierEcrivable('project.json', manifest) ]);
  const result = await loadProjectFromFolder(root, 'session-test');
  assert.equal(result.scenes[0].data, null);
});

test('writeFileInFolder écrit un fichier à un fichierPath imbriqué en créant les dossiers intermédiaires', async () => {
  const root = fauxDossierEcriture('MonProjet', []);
  await writeFileInFolder(root, 'scenes/Niveau1.scene.json', '{"objects":[]}');
  const dossierScenes = await root.getDirectoryHandle('scenes');
  const handleFile = await dossierScenes.getFileHandle('Niveau1.scene.json');
  const f = await handleFile.getFile();
  assert.equal(await f.text(), '{"objects":[]}');
});

test('writeFileInFolder rejette un nom de fichier invalide', async () => {
  const root = fauxDossierEcriture('MonProjet', []);
  // ':' est un caractère interdit selon la vraie validateNameFile (file-names.js, Task 1).
  await assert.rejects(() => writeFileInFolder(root, 'a/b:c.json', 'content'), /n'est pas autorisé/);
});

test('writeFileInFolder valide le nom avant de créer les dossiers intermédiaires', async () => {
  const root = fauxDossierEcriture('MonProjet', []);
  await assert.rejects(() => writeFileInFolder(root, 'scenes/b:c.json', 'content'), /n'est pas autorisé/);
  // Aucun sous-folder "scenes" ne doit avoir été créé puisque le nom était invalide.
  await assert.rejects(() => root.getDirectoryHandle('scenes'), /NotFoundError/);
});

test('writeFileInFolder propage une erreur non liée à la permission (ex: quota disque)', async () => {
  const root = fauxDossierEcriture('MonProjet', []);
  root.getFileHandle = async () => {
    const error = new Error('Quota disque dépassé');
    error.name = 'QuotaExceededError';
    throw error;
  };
  await assert.rejects(() => writeFileInFolder(root, 'a.json', 'content'), /Quota disque dépassé/);
});

test('registerInFolder écrit project.json et scenes/<name>.scene.json', async () => {
  const root = fauxDossierEcriture('MonProjet', []);
  const manifest = { name: 'Demo', version: 1, folders: [], scenes: [{name: 'Niveau1'}] };
  const sceneCurrent = { objects: [], tracks: [], duration: 0, loop: false, env: null };
  await registerInFolder(root, manifest, sceneCurrent, 'Niveau1');

  const handleManifeste = await root.getFileHandle('project.json');
  const contenuManifeste = JSON.parse(await (await handleManifeste.getFile()).text());
  assert.equal(contenuManifeste.name, 'Demo');

  const dossierScenes = await root.getDirectoryHandle('scenes');
  const handleScene = await dossierScenes.getFileHandle('Niveau1.scene.json');
  const contenuScene = JSON.parse(await (await handleScene.getFile()).text());
  assert.deepEqual(JSON.parse(JSON.stringify(contenuScene)), sceneCurrent);
});

test('crée un fichier .gardefolder pour matérialiser un dossier vide', async () => {
  const root = fauxDossierEcriture('MonProjet', []);
  await createFolderEmptyOnDisk(root, 'Textures/Persos');
  const dossierTextures = await root.getDirectoryHandle('Textures');
  const dossierPersos = await dossierTextures.getDirectoryHandle('Persos');
  const handleGarde = await dossierPersos.getFileHandle('.gardefolder');
  const content = await (await handleGarde.getFile()).text();
  assert.equal(content, '');
});

function fauxFichierBinaire(name, contenuTexte){
  return {
    name: name,
    async arrayBuffer(){ return new TextEncoder().encode(contenuTexte).buffer; }
  };
}

test('writeAssetInFolder écrit le fichier unique d\'une texture/un son (asset.file) à la racine des assets', async () => {
  const root = fauxDossierEcriture('MonProjet', []);
  const asset = { kind: 'texture', name: 'mur.png', folder: '', file: fauxFichierBinaire('mur.png', 'octets-mur') };
  await writeAssetInFolder(root, asset);
  const dossierAssets = await root.getDirectoryHandle('assets');
  const handleFile = await dossierAssets.getFileHandle('mur.png');
  assert.equal(await (await handleFile.getFile()).text(), 'octets-mur');
});

test('writeAssetInFolder écrit dans le sous-folder d\'asset (asset.folder)', async () => {
  const root = fauxDossierEcriture('MonProjet', []);
  const asset = { kind: 'audio', name: 'saut.wav', folder: 'Sons', file: fauxFichierBinaire('saut.wav', 'octets-son') };
  await writeAssetInFolder(root, asset);
  const dossierAssets = await root.getDirectoryHandle('assets');
  const dossierSons = await dossierAssets.getDirectoryHandle('Sons');
  const handleFile = await dossierSons.getFileHandle('saut.wav');
  assert.equal(await (await handleFile.getFile()).text(), 'octets-son');
});

test('writeAssetInFolder écrit chaque fichier du paquet d\'un modèle multi-files (asset.paquet)', async () => {
  const root = fauxDossierEcriture('MonProjet', []);
  const asset = {
    kind: 'model', name: 'tree.gltf', folder: 'Modeles',
    paquet: [
      fauxFichierBinaire('tree.gltf', 'json-gltf'),
      fauxFichierBinaire('tree.bin', 'binaire-gltf'),
    ],
  };
  await writeAssetInFolder(root, asset);
  const dossierModeles = await (await root.getDirectoryHandle('assets')).getDirectoryHandle('Modeles');
  assert.equal(await (await (await dossierModeles.getFileHandle('tree.gltf')).getFile()).text(), 'json-gltf');
  assert.equal(await (await (await dossierModeles.getFileHandle('tree.bin')).getFile()).text(), 'binaire-gltf');
});

test('writeAssetInFolder ne fait rien pour un asset sans fichier ni paquet (ex: script, table de données)', async () => {
  const root = fauxDossierEcriture('MonProjet', []);
  const asset = { kind: 'script', name: 'ai.js', folder: '' };
  await writeAssetInFolder(root, asset);
  await assert.rejects(() => root.getDirectoryHandle('assets'), /NotFoundError/);
});

test('resolveAssetDescriptors lit le code d\'un script référencé par fichier, sous assets/ (racine)', async () => {
  const root = fauxDossierEcriture('MonProjet', [
    fauxDossier('assets', [ fauxFichierEcrivable('ai-ennemi.js', 'function update(api){}') ]),
  ]);
  const tree = await scanFolder(root);
  const manifestAssets = [{ id: 'a1', kind: 'script', name: 'IA ennemi', folder: '', file: 'ai-ennemi.js' }];
  const resolus = await resolveAssetDescriptors(manifestAssets, tree);
  assert.equal(resolus.length, 1);
  assert.equal(resolus[0].code, 'function update(api){}');
});

test('resolveAssetDescriptors lit un script dans le MÊME sous-dossier que les autres assets (a.folder libre, pas de partition par type)', async () => {
  const root = fauxDossierEcriture('MonProjet', [
    fauxDossier('assets', [
      fauxDossier('Ennemis', [ fauxFichierEcrivable('ai-ennemi.js', 'function update(api){}') ]),
    ]),
  ]);
  const tree = await scanFolder(root);
  const manifestAssets = [{ id: 'a1', kind: 'script', name: 'IA ennemi', folder: 'Ennemis', file: 'ai-ennemi.js' }];
  const resolus = await resolveAssetDescriptors(manifestAssets, tree);
  assert.equal(resolus[0].code, 'function update(api){}');
});

test('resolveAssetDescriptors lit et parse les props JSON d\'un matériau référencé par fichier', async () => {
  const propsJson = JSON.stringify({ color: '#ff0000', roughness: 0.5 });
  const root = fauxDossierEcriture('MonProjet', [
    fauxDossier('assets', [ fauxFichierEcrivable('rouge-mat.material.json', propsJson) ]),
  ]);
  const tree = await scanFolder(root);
  const manifestAssets = [{ id: 'a1', kind: 'material', name: 'Rouge', folder: '', file: 'rouge-mat.material.json' }];
  const resolus = await resolveAssetDescriptors(manifestAssets, tree);
  assert.deepEqual(JSON.parse(JSON.stringify(resolus[0].props)), { color: '#ff0000', roughness: 0.5 });
});

test('resolveAssetDescriptors lit le HTML d\'un documentUI référencé par fichier', async () => {
  const root = fauxDossierEcriture('MonProjet', [
    fauxDossier('assets', [ fauxFichierEcrivable('hud.html', '<p>Score: 0</p>') ]),
  ]);
  const tree = await scanFolder(root);
  const manifestAssets = [{ id: 'a1', kind: 'documentUI', name: 'HUD', folder: '', file: 'hud.html' }];
  const resolus = await resolveAssetDescriptors(manifestAssets, tree);
  assert.equal(resolus[0].html, '<p>Score: 0</p>');
});

test('resolveAssetDescriptors lit le CSS d\'une sheetStyle référencée par fichier', async () => {
  const root = fauxDossierEcriture('MonProjet', [
    fauxDossier('assets', [ fauxFichierEcrivable('theme.css', 'p{color:red}') ]),
  ]);
  const tree = await scanFolder(root);
  const manifestAssets = [{ id: 'a1', kind: 'sheetStyle', name: 'Thème', folder: '', file: 'theme.css' }];
  const resolus = await resolveAssetDescriptors(manifestAssets, tree);
  assert.equal(resolus[0].css, 'p{color:red}');
});

test('resolveAssetDescriptors laisse passer les descripteurs sans référence de fichier (texture, modèle, data, prefab)', async () => {
  const root = fauxDossierEcriture('MonProjet', []);
  const tree = await scanFolder(root);
  const manifestAssets = [
    { id: 'a1', kind: 'texture', name: 'mur.png', folder: '', files: ['mur.png'] },
    { id: 'a2', kind: 'data', name: 'Table', folder: '', text: '[]' },
  ];
  const resolus = await resolveAssetDescriptors(manifestAssets, tree);
  assert.equal(resolus.length, 2);
  assert.deepEqual(Array.from(resolus[0].files), ['mur.png']);
  assert.equal(resolus[1].text, '[]');
});

test('resolveAssetDescriptors avertit et saute un script dont le fichier a disparu du disque', async () => {
  const root = fauxDossierEcriture('MonProjet', []);
  const tree = await scanFolder(root);
  const manifestAssets = [{ id: 'a1', kind: 'script', name: 'Perdu', folder: '', file: 'perdu.js' }];
  const resolus = await resolveAssetDescriptors(manifestAssets, tree);
  assert.equal(resolus.length, 0);
});

// ---------- Découverte automatique des fichiers du dossier ----------
// Un fichier posé à la main sous assets/ n'existait pour l'éditeur que s'il figurait
// dans project.json : la seule façon de l'y faire entrer était de le RÉIMPORTER, ce qui
// en écrivait un doublon juste à côté.
const { discoverFolderAssets, kindOfFileAsset, moveFilesAssetOnDisk,
        rereadFileFromFolder } = ctx;

test('un fichier de assets/ absent du manifeste devient un asset, avec son genre', async () => {
  const root = fauxDossierEcriture('MonProjet', [
    fauxDossier('assets', [ fauxFichierEcrivable('mur.png', 'binaire') ]),
  ]);
  const tree = await scanFolder(root);
  const trouves = Array.from(discoverFolderAssets(tree, []));
  assert.equal(trouves.length, 1);
  assert.equal(trouves[0].kind, 'texture');
  assert.equal(trouves[0].name, 'mur.png');
  assert.equal(trouves[0].folder, '');
  assert.deepEqual(Array.from(trouves[0].files), ['mur.png']);
});

test('un fichier DEJA revendique par le manifeste n est pas decouvert une seconde fois', async () => {
  const root = fauxDossierEcriture('MonProjet', [
    fauxDossier('assets', [ fauxFichierEcrivable('mur.png', 'binaire') ]),
  ]);
  const tree = await scanFolder(root);
  const manifest = [{id:'a1', kind:'texture', name:'Mur', folder:'', files:['mur.png']}];
  assert.equal(Array.from(discoverFolderAssets(tree, manifest)).length, 0);
});

test('le sous-folder disque devient le dossier de l asset', async () => {
  const root = fauxDossierEcriture('MonProjet', [
    fauxDossier('assets', [
      fauxDossier('Persos', [ fauxDossier('Textures', [ fauxFichierEcrivable('peau.jpg', 'b') ]) ]) ]),
  ]);
  const tree = await scanFolder(root);
  const trouves = Array.from(discoverFolderAssets(tree, []));
  assert.equal(trouves[0].folder, 'Persos/Textures');
});

test('un genre texte est decouvert par son extension composee, et perd celle-ci dans son nom', async () => {
  const root = fauxDossierEcriture('MonProjet', [
    fauxDossier('assets', [
      fauxFichierEcrivable('herbe.material.json', '{}'),
      fauxFichierEcrivable('eau.graph-shader.json', '{}'),
      fauxFichierEcrivable('perso.animator.json', '{}'),
      fauxFichierEcrivable('marche.animation.json', '{}'),
      fauxFichierEcrivable('tourner.js', '//'),
      fauxFichierEcrivable('hud.html', '<p></p>'),
      fauxFichierEcrivable('theme.css', 'p{}'),
    ]),
  ]);
  const tree = await scanFolder(root);
  const parGenre = {};
  for(const d of discoverFolderAssets(tree, [])) parGenre[d.kind] = d;
  assert.equal(parGenre.material.name, 'herbe');
  assert.equal(parGenre.material.file, 'herbe.material.json');
  assert.equal(parGenre.graphShader.name, 'eau');
  assert.equal(parGenre.animator.name, 'perso');
  assert.equal(parGenre.animation.name, 'marche');
  assert.equal(parGenre.script.name, 'tourner');
  assert.equal(parGenre.documentUI.name, 'hud');
  assert.equal(parGenre.sheetStyle.name, 'theme');
});

test('les fichiers de service du dossier project ne sont jamais des assets', async () => {
  const root = fauxDossierEcriture('MonProjet', [
    fauxFichierEcrivable('project.json', '{}'),
    fauxDossier('assets', [ fauxFichierEcrivable('.gardefolder', '') ]),
  ]);
  const tree = await scanFolder(root);
  assert.equal(Array.from(discoverFolderAssets(tree, [])).length, 0);
});

test('un .bin n est pas un asset : c est le compagnon d un .gltf, charge avec lui', () => {
  assert.equal(kindOfFileAsset('scene.bin'), null);
  assert.equal(kindOfFileAsset('scene.gltf'), 'model');
});

test('un format que le navigateur ne decode pas (TIFF, TGA, EXR) n est pas pris pour une texture', () => {
  // Il n'echouerait pas : <img> rendrait une texture NOIRE, ce qui est pire qu'un refus.
  assert.equal(kindOfFileAsset('ciel.tif'), null);
  assert.equal(kindOfFileAsset('ciel.tga'), null);
  assert.equal(kindOfFileAsset('ciel.exr'), null);
  assert.equal(kindOfFileAsset('ciel.avif'), 'texture');
});

test('un .gltf decouvert emporte ses freres de dossier (.bin, textures) dans son paquet', async () => {
  const root = fauxDossierEcriture('MonProjet', [
    fauxDossier('assets', [ fauxDossier('Perso', [
      fauxFichierEcrivable('perso.gltf', '{}'),
      fauxFichierEcrivable('perso.bin', 'b'),
      fauxFichierEcrivable('peau.png', 'b'),
    ]) ]),
  ]);
  const tree = await scanFolder(root);
  const model = Array.from(discoverFolderAssets(tree, [])).find(d => d.kind === 'model');
  assert.deepEqual(Array.from(model.files).sort(), ['peau.png', 'perso.bin', 'perso.gltf']);
});

test('pendant la decouverte, writeAssetInFolder ne reecrit pas le fichier sur lui-meme', async () => {
  // Reecrire perime le fichier qu'on vient d'en read : toute lecture ulterieure (preview,
  // Jouer, autosave) echouerait ensuite sur cet asset.
  const root = fauxDossierEcriture('MonProjet', []);
  const asset = {folder:'', file:{name:'mur.png', async arrayBuffer(){ return new ArrayBuffer(4); }}};
  vm.runInContext('assetDiscoveryInProgress = true', ctx);
  await writeAssetInFolder(root, asset);
  vm.runInContext('assetDiscoveryInProgress = false', ctx);
  assert.equal((await scanFolder(root)).files.length, 0);
  await writeAssetInFolder(root, asset);
  assert.equal((await scanFolder(root)).files.length, 1);
});

// ---------- Deplacement d'un asset : le fichier suit ----------
test('deplacer un asset deplace son fichier sur le disque, sans le dupliquer', async () => {
  const root = fauxDossierEcriture('MonProjet', [
    fauxDossierEcriture('assets', [ fauxFichierEcrivable('mur.png', 'binaire') ]),
  ]);
  await moveFilesAssetOnDisk(root, '', 'Textures', ['mur.png']);
  const chemins = Array.from((await scanFolder(root)).files.map(f => f.filePath));
  assert.deepEqual(chemins, ['assets/Textures/mur.png']);
});

test('deplacer un asset dont le fichier a disparu ne fait pas echouer le deplacement', async () => {
  const root = fauxDossierEcriture('MonProjet', [ fauxDossier('assets', []) ]);
  await moveFilesAssetOnDisk(root, '', 'Textures', ['absent.png']);
  assert.equal((await scanFolder(root)).files.length, 0);
});

// ---------- Rattrapage de lecture par la copie du project ----------
test('relireFichierDepuisDossier retrouve la copie que le project possede sous assets/', async () => {
  const root = fauxDossierEcriture('MonProjet', [
    fauxDossierEcriture('assets', [
      fauxDossierEcriture('Ciel', [ fauxFichierEcrivable('hdri.jpg', 'octets') ]) ]),
  ]);
  const f = await rereadFileFromFolder(root, 'Ciel', 'hdri.jpg');
  assert.equal(f.name, 'hdri.jpg');
  assert.equal(await f.text(), 'octets');
});

test('relireFichierDepuisDossier rend null plutot que de lever, quand la copie n existe pas', async () => {
  const root = fauxDossierEcriture('MonProjet', []);
  assert.equal(await rereadFileFromFolder(root, '', 'absent.jpg'), null);
  assert.equal(await rereadFileFromFolder(null, '', 'absent.jpg'), null);
});

// TOUTE extension que serialization.js ÉCRIT doit être reconnue à la relecture. `.sprite.json` et
// `.data.json` manquaient (jusqu'à la v0.197.0) : ces fichiers n'étaient jamais redécouverts, et
// dès que project.json ne les citait plus ils sortaient du projet avec toutes leurs références.
// La liste est lue dans le SOURCE de l'écriture : une extension ajoutée là sans être ajoutée à
// EXT_KIND_ASSET fait échouer ce test.
test('chaque extension écrite par la sérialisation est redécouverte, avec son genre', () => {
  const src = fs.readFileSync(new URL('../js/serialization.js', import.meta.url), 'utf8');
  const exts = new Set(Array.from(src.matchAll(/nameFileUnique\([^;]*?'(\.[a-z.-]+)'/g), (m) => m[1]));
  assert.ok(exts.size >= 12, 'seulement ' + exts.size + ' extensions lues dans serialization.js');
  const oubliees = Array.from(exts).filter((e) => !ctx.kindOfFileAsset('x' + e));
  assert.deepEqual(oubliees, [], 'extensions écrites mais jamais redécouvertes : ' + oubliees.join(', '));
  assert.equal(ctx.kindOfFileAsset('herbe.sprite.json'), 'sprite');
  assert.equal(ctx.kindOfFileAsset('boss.data.json'), 'data');
  assert.equal(ctx.nameAssetFromFile('boss.data.json', 'data'), 'boss');
  assert.equal(ctx.nameAssetFromFile('herbe.sprite.json', 'sprite'), 'herbe');
});

// ---------- Prefabs en fichier (.prefab.json, v0.198.0) ----------

test('un .prefab.json est relu au même format {base, tree} que l ancien prefab en ligne', async () => {
  const contenu = JSON.stringify({version: 1, base: null, tree: [{name: 'Porte', children: []}]});
  const root = fauxDossierEcriture('MonProjet', [
    fauxDossier('assets', [ fauxDossier('Prefabs', [ fauxFichierEcrivable('porte.prefab.json', contenu) ]) ]),
  ]);
  const tree = await scanFolder(root);
  const desc = [{id: 'a7', kind: 'prefab', name: 'Porte', folder: 'Prefabs', file: 'porte.prefab.json'}];
  const r = Array.from(await resolveAssetDescriptors(desc, tree));
  assert.equal(r.length, 1);
  assert.equal(r[0].base, null);
  assert.equal(r[0].tree[0].name, 'Porte');
  assert.equal(r[0].id, 'a7');
});

test('un .prefab.json cassé rend un arbre vide au lieu de faire échouer le projet', async () => {
  const root = fauxDossierEcriture('MonProjet', [
    fauxDossier('assets', [ fauxFichierEcrivable('x.prefab.json', '{pas du json') ]),
  ]);
  const tree = await scanFolder(root);
  const err = console.error; console.error = () => {};
  try {
    const r = Array.from(await resolveAssetDescriptors([{id: 'a1', kind: 'prefab', name: 'X', folder: '', file: 'x.prefab.json'}], tree));
    assert.equal(r[0].tree.length, 0);
  } finally { console.error = err; }
});

test('un .prefab.json sans manifeste est découvert comme prefab, nommé sans son extension', async () => {
  const root = fauxDossierEcriture('MonProjet', [
    fauxDossier('assets', [ fauxFichierEcrivable('coffre.prefab.json', '{"version":1,"tree":[]}') ]),
  ]);
  const tree = await scanFolder(root);
  const d = Array.from(ctx.discoverFolderAssets(tree, []));
  assert.equal(d.length, 1);
  assert.equal(d[0].kind, 'prefab');
  assert.equal(d[0].name, 'coffre');
  assert.equal(d[0].file, 'coffre.prefab.json');
});

test('manifeste à l ancien format (prefab en ligne) + son fichier : pas de doublon', async () => {
  const root = fauxDossierEcriture('MonProjet', [
    fauxDossier('assets', [ fauxFichierEcrivable('coffre.prefab.json', '{"version":1,"tree":[]}') ]),
  ]);
  const tree = await scanFolder(root);
  const metas = new Map([['assets/coffre.prefab.json', {id: 'a3', kind: 'prefab', name: 'Coffre'}]]);
  const manifeste = [{id: 'a3', kind: 'prefab', name: 'Coffre', folder: '', tree: []}];
  assert.equal(Array.from(ctx.discoverFolderAssets(tree, manifeste, metas)).length, 0);
});
