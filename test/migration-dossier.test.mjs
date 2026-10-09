// LE FORMAT DOSSIER DOIT MIGRER, LUI AUSSI.
//
// POURQUOI CE TEST EXISTE. migrateProjectData n'avait qu'un appelant, sur le chemin FICHIER
// (serialization.js, loadDataProject). loadProjectFromFolder ne l'appelait jamais, et
// loadManifestFromTree ne lisait même pas `manifest.version`. Conséquence : tout palier de
// migration ajouté ensuite s'appliquait aux .p3d et sautait les projets ouverts en dossier —
// deux formats du même projet qui divergent, sans un message.
//
// Et la migration est PAR FICHIER DE SCÈNE, pas au niveau du manifeste : registerInFolder
// n'écrit QUE la scène courante. Un numéro porté par le manifeste monterait pour tout le projet
// alors que les autres scènes, jamais rouvertes, resteraient au vieux schéma — et seraient
// ensuite lues comme si elles avaient migré.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte } from './engine-env.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Les deux fonctions vivent dans `project-folder.js` — le fichier qui possède le format
// dossier — et non dans `serialization.js` : ce dernier touche au DOM à son chargement, donc
// aucun test ne peut le charger seul, et une migration qu'on ne peut pas tester en isolation
// n'est pas une migration qu'on ose écrire.
const env = creerContexte(['js/scripts.js', 'js/environment.js', 'js/lightmap-bake.js',
                           'js/file-names.js', 'js/project-settings.js',
                           'js/project-folder.js']);
const { migrateManifestFolder, migrateSceneFile } = env;

const clone = (x) => JSON.parse(JSON.stringify(x));

test('un manifeste sans version est migre jusqu a la version courante', () => {
  const m = migrateManifestFolder({ name: 'P', scenes: [{ name: 'S1' }], assets: [] });
  assert.ok(m.version >= 1);
});

test('un manifeste deja a jour n est pas touche', () => {
  const a = migrateManifestFolder({ name: 'P', version: 2, scenes: [], assets: [] });
  const b = migrateManifestFolder(clone(a));
  assert.deepEqual(clone(b), clone(a));
});

test('CHAQUE fichier de scene porte sa propre version et migre seul', () => {
  const vieille = { objects: [], tracks: [], duration: 5, loop: true, env: { sky: 'color' } };
  const migree = migrateSceneFile(vieille);
  assert.ok(migree.version >= 1, 'une scene sans version doit en recevoir une');
  assert.deepEqual(Array.from(migree.objects), []);
  assert.equal(migree.env.sky, 'color', 'la migration ne doit RIEN perdre');
});

test('une scene deja migree ne remigre pas', () => {
  const une = migrateSceneFile({ version: 1, objects: [], env: {} });
  const deux = migrateSceneFile(clone(une));
  assert.deepEqual(clone(deux), clone(une));
});

test('une scene absente du disque (jamais enregistree) ne fait pas lever la migration', () => {
  assert.equal(migrateSceneFile(null), null);
});

// ---------- Le manifeste ne perd plus les champs de projet ----------
//
// Mesuré avant ce lot : le manifeste écrit `{name, version, folders, scenes:[{name}], assets}`
// — ni `inputs`, ni `layers`, ni `layers2d`, ni `ppu2d`, ni `lightmap`, ni `design`, ni
// `versionVisible`, tous présents dans buildDataProject(). Un projet ouvert en dossier les
// perdait à chaque enregistrement.

const CHAMPS_PROJET = ['inputs', 'layers', 'layers2d', 'ppu2d', 'lightmap', 'design',
                       'versionVisible'];

test('le manifeste ecrit par l editeur porte les reglages de projet', () => {
  const source = fs.readFileSync(path.join(root, 'js/serialization.js'), 'utf8');
  const assembleur = source.slice(source.indexOf('export function projectManifestOf'),
                                  source.indexOf('export async function registerInCloudProject'));
  assert.notEqual(assembleur.length, 0, 'projectManifestOf doit exister : c est lui qui assemble project.json');
  assert.ok(assembleur.indexOf('settings') !== -1,
    'le manifeste ne transporte pas les reglages : ils sont perdus a chaque enregistrement');
});

test('les DEUX enregistrements passent par le meme assembleur de manifeste', () => {
  // Depuis qu un projet peut etre heberge, project.json s ecrit depuis deux endroits : le
  // disque et le cloud. Deux assemblages divergents produiraient deux projets differents selon
  // l endroit ou l on enregistre — et la divergence ne se verrait qu a la relecture, donc trop
  // tard. Aucun des deux ne doit reconstruire le manifeste a la main.
  const source = fs.readFileSync(path.join(root, 'js/serialization.js'), 'utf8');
  for(const nom of ['registerInProjectOpen', 'registerInCloudProject']){
    const debut = source.indexOf('export async function ' + nom);
    assert.notEqual(debut, -1, nom + ' doit exister');
    const bloc = source.slice(debut, debut + 4000);
    assert.ok(bloc.indexOf('projectManifestOf(') !== -1,
      nom + ' doit appeler projectManifestOf au lieu de rebatir le manifeste');
  }
});

test('les sept champs de projet sont bien dans les reglages, pas oublies en route', () => {
  const settings = env.projectSettingsOf({});
  CHAMPS_PROJET.forEach(function(k){
    assert.notEqual(settings[k], undefined, 'reglage manquant : ' + k);
  });
});

test('un manifeste de la v1, a plat, voit ses reglages DEPLACES', () => {
  const m = migrateManifestFolder({ name: 'P', version: 1, layers2d: ['A'], ppu2d: 32,
                                    scenes: [], assets: [] });
  assert.deepEqual(Array.from(m.settings.layers2d), ['A']);
  assert.equal(m.settings.ppu2d, 32);
  assert.equal(m.layers2d, undefined);
  assert.equal(m.ppu2d, undefined);
});

test('loadProjectFromFolder migre le manifeste ET chaque scene', () => {
  const source = fs.readFileSync(path.join(root, 'js/project-folder.js'), 'utf8');
  const bloc = source.slice(source.indexOf('async function loadProjectFromFolder'),
                            source.indexOf('async function writeFileInFolder'));
  assert.ok(bloc.indexOf('migrateManifestFolder') !== -1, 'le manifeste doit migrer');
  assert.ok(bloc.indexOf('migrateSceneFile') !== -1, 'chaque fichier de scene doit migrer');
});
