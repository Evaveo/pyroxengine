// Projet hébergé : arbre virtuel et négociation des objets.
// Toutes les E/S passent par un `api` injecté : rien ici ne touche au réseau.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cloudProjectIdFromUrl, cloudTree, manifestOf, openCloudProject, saveCloudProject, shaOf, toUpload
} from '../js/cloud-project.js';
import { loadManifestFromTree } from '../js/project-folder.js';

const bytesOf = (s) => new TextEncoder().encode(s);

async function fixture(contents){
  const manifest = await manifestOf(contents);
  const store = {};
  for(const p of Object.keys(contents)) store[manifest[p].sha] = bytesOf(contents[p]);
  return { manifest, store };
}

test("l'arbre virtuel est lisible par le chargeur de projet dossier, sans le modifier", async () => {
  const { manifest, store } = await fixture({
    'project.json': '{"name":"Demo","scenes":[{"name":"Ville"}]}',
    'scenes/Ville.scene.json': '{"objets":[]}'
  });
  const tree = cloudTree(manifest, async (sha) => store[sha]);
  // loadManifestFromTree vient de project-folder.js et n'a PAS ete touche : c'est la preuve
  // que l'arbre virtuel a bien la forme rendue par scanFolder().
  assert.equal((await loadManifestFromTree(tree)).name, 'Demo');
  assert.deepStrictEqual(tree.folders, ['scenes'], 'les dossiers se deduisent des chemins');
});

test("un objet n'est telecharge qu'une fois, et seulement s'il est lu", async () => {
  const { manifest, store } = await fixture({ 'project.json': '{"name":"D"}', 'scenes/A.scene.json': '{}' });
  const reads = [];
  const tree = cloudTree(manifest, async (sha) => { reads.push(sha); return store[sha]; });

  assert.deepStrictEqual(reads, [], "construire l'arbre ne telecharge rien");
  const entry = tree.files.find((f) => f.filePath === 'project.json');
  await (await entry.handle.getFile()).text();
  await (await entry.handle.getFile()).text();
  assert.equal(reads.length, 1, 'deux lectures, un seul telechargement');
});

test("on ne depose que ce qui manque, et un contenu duplique ne part qu'une fois", async () => {
  const same = 'contenu identique';
  const manifest = await manifestOf({ 'a/x.json': same, 'b/y.json': same, 'c.json': 'autre' });
  assert.equal(new Set(Object.values(manifest).map((e) => e.sha)).size, 2,
    'deux contenus distincts pour trois chemins');

  const present = new Set([manifest['c.json'].sha]);
  assert.deepStrictEqual(await toUpload(manifest, async (sha) => present.has(sha)),
    [manifest['a/x.json'].sha],
    'seul le contenu absent part, et une seule fois malgre ses deux chemins');
});

test("enregistrer : delta sur le manifeste charge, seul le nouveau part", async () => {
  const uploaded = [];
  let received = null;
  const api = {
    hasObject: async () => false,
    putObject: async (sha) => { uploaded.push(sha); },
    writeTree: async (id, body) => { received = { id, body }; return { ok: true, version_id: 8 }; }
  };
  // le projet charge portait trois fichiers ; on ne touche QUE la scene courante
  const baseManifest = await manifestOf({
    'project.json': '{"name":"D"}',
    'scenes/A.scene.json': '{"a":1}',
    'assets/Textures/mur.png': 'octets lourds'
  });
  const r = await saveCloudProject(42, {
    baseManifest,
    changed: { 'scenes/A.scene.json': '{"a":2}' }
  }, 7, api, 'ma note');

  assert.equal(r.version_id, 8);
  assert.equal(uploaded.length, 1,
    "seule la scene modifiee est televersee — la texture inchangee ne repart pas");
  assert.equal(received.body.base, 7,
    "la version chargee est transmise : c'est elle qui permet au serveur de trancher");
  assert.equal(Object.keys(received.body.files).length, 3, 'le manifeste reste complet');
  assert.equal(received.body.files['assets/Textures/mur.png'].sha,
    baseManifest['assets/Textures/mur.png'].sha, "l'empreinte d'un fichier intact est conservee");
  assert.equal(received.body.files['scenes/A.scene.json'].sha, await shaOf('{"a":2}'));
  assert.equal(received.body.note, 'ma note');
});

test("supprimer un fichier le retire du manifeste sans rien televerser", async () => {
  const uploaded = [];
  let received = null;
  const api = {
    hasObject: async () => false,
    putObject: async (sha) => { uploaded.push(sha); },
    writeTree: async (id, body) => { received = { id, body }; return { ok: true, version_id: 9 }; }
  };
  const baseManifest = await manifestOf({ 'project.json': '{}', 'scenes/Vieille.scene.json': '{}' });
  await saveCloudProject(1, { baseManifest, removed: ['scenes/Vieille.scene.json'] }, 3, api);

  assert.deepStrictEqual(Object.keys(received.body.files), ['project.json']);
  assert.equal(uploaded.length, 0, 'une suppression ne televerse rien');
});

test("ouvrir rend la version chargee, qu'il faudra renvoyer en base", async () => {
  const { manifest, store } = await fixture({ 'project.json': '{"name":"D"}' });
  const api = {
    readTree: async () => ({ version_id: 12, files: manifest }),
    readObject: async (sha) => store[sha]
  };
  const opened = await openCloudProject(3, api);
  assert.equal(opened.versionId, 12);
  assert.equal(opened.tree.files.length, 1);
});

test("sans identifiant dans l'URL, le module dort", () => {
  assert.equal(cloudProjectIdFromUrl(''), null);
  assert.equal(cloudProjectIdFromUrl('?autre=1'), null);
  assert.equal(cloudProjectIdFromUrl('?projet=abc'), null, 'un identifiant non numerique est refuse');
  assert.equal(cloudProjectIdFromUrl('?projet=42'), 42);
});
