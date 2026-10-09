import { deEsm } from './engine-env.mjs';
// Le GENRE d'un project, et le nom du manifeste.
//
// Ces deux sujets sont dans le même fichier parce qu'ils répondent à la même question : « faut-il un
// format `.p2d` séparé pour les jeux 2D ? ». La réponse est non, et ces tests disent pourquoi elle
// tient — un genre DÉRIVÉ laisse un project 2D recevoir un objet 3D sans rien casser, là où un format
// séparé devrait refuser l'objet ou mentir sur le genre.
//
// Le second sujet est un défaut mesuré en cherchant : l'archive `.p3d` écrivait son manifeste
// `project.json`, les deux formes de dossier écrivaient `project.json`. Un caractère, aucun repli, et
// donc deux moitiés d'un même système incapables de se relire — alors qu'elles écrivent la même
// structure. Le message d'erreur accusait le contenu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');

function contexte(){
  const bac = {console, Math, JSON, Number, String, Object, Array, isFinite};
  bac.window = bac; bac.self = bac; bac.globalThis = bac;
  const ctx = vm.createContext(bac);
  vm.runInContext(deEsm(read('js/sprite-2d.js')), ctx, {filename: 'js/sprite-2d.js'});
  return ctx;
}

/** Une scène sérialisée, telle que le manifeste la porte. */
const scene = (objects) => ({name: 'Scène 1', data: {objects: objects, tracks: [], duration: 5}});

// Les objets tels que `serializeObject` les produit, réduits à ce que le genre regarde.
const RACINE_2D = {type: 'group', name: 'Monde 2D', space: '2d', root2d: true};
const SPRITE    = {type: 'group', name: 'Héros', sprite2d: {spriteId: 'a1'}};
const TUILES    = {type: 'group', name: 'Décor', components: [{type: 'Tilemap', data: {width: 32, height: 18}}]};
const CAM_2D    = {type: 'camera', name: 'Caméra 2D', components: [{type: 'Camera', data: {projection: 'orthographic', mode: 'width'}}]};
const CUBE      = {type: 'mesh', name: 'Cube', geo: 'cube'};
const SOLEIL    = {type: 'directional', name: 'Soleil'};
const CAM_3D    = {type: 'camera', name: 'Caméra', fov: 50};
const GROUPE    = {type: 'group', name: 'Organisation'};

test('LE GENRE EST DERIVE DU CONTENU — c est ce qui rend un format .p2d inutile', () => {
  const ctx = contexte();
  // Un project 2D.
  assert.equal(ctx.kindProject([scene([RACINE_2D, SPRITE, TUILES, CAM_2D])]), '2d');
  // Un project 3D.
  assert.equal(ctx.kindProject([scene([CUBE, SOLEIL, CAM_3D])]), '3d');
  // ET LE CAS QUI DÉCIDE DE TOUT : un project 2D auquel on ajoute un objet 3D. Il devient « mixte »
  // et reste parfaitement lisible. Un format séparé aurait dû refuser l'object — ou mentir.
  assert.equal(ctx.kindProject([scene([RACINE_2D, SPRITE, CUBE])]), 'mixte');
  // Le genre se lit sur TOUTES les scènes : une scène 2D et une scène 3D dans le même project, c'est
  // mixte. Ne regarder que la scène courante donnerait un genre qui change quand on change d'tab.
  assert.equal(ctx.kindProject([scene([RACINE_2D, SPRITE]), scene([CUBE])]), 'mixte');
  // Un project VIDE rend « 3d » : c'est le défaut historique, et la scène de départ de l'éditeur en
  // est une. Rendre null obligerait chaque lecteur à traiter un troisième cas qui ne dit rien.
  assert.equal(ctx.kindProject([]), '3d');
  assert.equal(ctx.kindProject([scene([])]), '3d');
  assert.equal(ctx.kindProject(null), '3d');
});

test('UN GROUPE NU ne compte NI en 2D NI en 3D', () => {
  const ctx = contexte();
  // Un groupe d'organisation existe autant dans un project 2D que dans un project 3D. Le compter en 3D
  // rendrait « mixte » tout project 2D un peu rangé — et un genre qui vaut toujours « mixte » ne
  // sert plus à rien, donc l'onglet ne s'ouvrirait plus jamais sur la 2D.
  assert.equal(ctx.kindProject([scene([RACINE_2D, SPRITE, GROUPE, GROUPE])]), '2d');
  // Et un project fait UNIQUEMENT de groupes n'est pas 2D pour autant.
  assert.equal(ctx.kindProject([scene([GROUPE, GROUPE])]), '3d');
});

test('CHAQUE marker 2D suffit, seul, a rendre un objet 2D', () => {
  const ctx = contexte();
  // Les six composants 2D et la caméra : chacun doit compter. En oublier un rendrait « 3d » un
  // project qui n'utilise que celui-là — un niveau fait de tuiles seules, par exemple.
  const markers = {
    sprite2d: {spriteId: 'a1'}, animSprite: {sequences: []}, components: [{type: 'Tilemap', data: {width: 4, height: 4}}],
    body2d: {statique: false}, collider2d: {l: 1, h: 1}, controller2d: {speed: 6},
    components: [{type: 'Camera', data: {projection: 'orthographic', mode: 'width'}}]
  };
  const manques = [];
  for(const [key, value] of Object.entries(markers)){
    const o = {type: 'group', name: key};
    o[key] = value;
    if(ctx.kindProject([scene([o])]) !== '2d') manques.push(key);
  }
  assert.deepEqual(manques, [],
    'Ces markers 2D ne sont pas reconnus : un projet qui n\'utilise que celui-là passerait pour\n'
    + 'un project 3D, et s\'ouvrirait sur une vue en perspective où son contenu est hors field.\n'
    + manques.join(', '));
  // `space: '2d'` ne compte PLUS : la marque d'espace a disparu du format avec la séparation
  // des deux mondes. Le genre d'un projet se lit maintenant à ce que ses objets PORTENT — un
  // sprite, une tilemap, un corps 2D — et plus à une déclaration.
  assert.equal(ctx.kindProject([scene([{type: 'group', name: 'x', space: '2d'}])]), '3d');
});

test('LE MANIFESTE PORTE LE MEME NOM des deux cotes, et l old reste LU', () => {
  const ser = read('js/serialization.js').replace(/\r\n/g, '\n');
  const dos = read('js/project-folder.js').replace(/\r\n/g, '\n');

  // Le nom écrit par l'archive et celui cherché par le dossier doivent être le MÊME. Sans ça,
  // dézipper un `.p3d` ne donne pas un dossier project ouvrable, et zipper un dossier project ne donne
  // pas un `.p3d` lisible — alors que les deux écrivent la même structure.
  const canon = /const PROJECT_MANIFEST = '([^']+)'/.exec(ser);
  assert.ok(canon, 'PROJECT_MANIFEST a-t-il changé de nom ?');
  assert.ok(dos.includes("f.filePath === '" + canon[1] + "'"),
    'le lecteur de dossier ne cherche pas « ' + canon[1] + " », le nom qu'écrit l'archive");
  assert.ok(/writeFileInFolder\(racine, 'project\.json'/.test(dos)
            || dos.includes("'" + canon[1] + "'"),
    'le dossier n\'écrit pas le nom canonique');

  // ET L'ANCIEN NOM RESTE LU, DES DEUX CÔTÉS. Sans ce repli, tous les `.p3d` déjà enregistrés
  // deviendraient illisibles — et un changement de format qui casse les fichiers existants n'est pas
  // une amélioration.
  const old = /const PROJECT_MANIFEST_OLD = '([^']+)'/.exec(ser);
  assert.ok(old, 'aucun repli déclaré sur l\'ancien nom de manifeste');
  assert.notEqual(old[1], canon[1], 'le repli doit porter sur un AUTRE nom que le canonique');
  assert.ok(ser.includes('PROJECT_MANIFEST_OLD') && /recomposeProject/.test(ser),
    'le repli est déclaré mais la recomposition ne s\'en sert pas');
  const iRec = ser.indexOf('function recomposeProject');
  const body = ser.slice(iRec, ser.indexOf('\n}', iRec));
  assert.ok(body.includes('PROJECT_MANIFEST_OLD'),
    'recomposeProject ne retombe pas sur l\'ancien name : les .p3d existants deviendraient illisibles');
  assert.ok(dos.includes("f.filePath === '" + old[1] + "'"),
    'le lecteur de dossier ne retombe pas sur « ' + old[1] + ' » : un .p3d dézippé serait refusé');
});
