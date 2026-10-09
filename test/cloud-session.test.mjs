// Session cloud, mode de stockage et envoi initial d'un projet local vers le cloud.
// Le réseau est un `fetch` simulé : aucun serveur, aucun navigateur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cloudSession, probeSession, saveActionFor, saveChoicesFor, searchWithProject,
  storageBadgeOf, storageMenuVisibility, storageModeOf, uploadProjectToCloud
} from '../js/cloud-session.js';
import { cloudApi, shaOf } from '../js/cloud-project.js';
import { createCloudProjectPending } from '../js/hub/hub-create.js';

const reply = (status, body) => ({
  ok: status >= 200 && status < 300, status,
  async json(){ if(body === undefined) throw new Error('pas de json'); return body; }
});

test('sonde hors ligne : fetch qui échoue -> mode local, sans lever', async () => {
  const s = await probeSession({ fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
  assert.equal(s.state, 'offline');
  assert.equal(s.user, null);
});

test('sonde : 404 (éditeur servi sans cloud) -> mode local', async () => {
  assert.equal((await probeSession({ fetchImpl: async () => reply(404, {}) })).state, 'offline');
});

test('sonde : délai dépassé -> mode local', async () => {
  const s = await probeSession({ timeoutMs: 20, fetchImpl: () => new Promise(() => {}) });
  assert.equal(s.state, 'offline');
});

test('sonde : 200 HTML d un serveur statique -> pas un compte', async () => {
  assert.equal((await probeSession({ fetchImpl: async () => reply(200) })).state, 'offline');
});

test('sonde : 401 -> serveur présent, non connecté', async () => {
  assert.equal((await probeSession({ fetchImpl: async () => reply(401, { erreur: 'non connecte' }) })).state, 'anonymous');
});

test('sonde : connecté -> nom affichable, requête same-origin avec cookie', async () => {
  let seen;
  const s = await probeSession({ fetchImpl: async (url, init) => { seen = { url, init };
    return reply(200, { email: 'a@b.fr', prenom: 'Ada', nom: 'Lovelace' }); } });
  assert.equal(s.state, 'logged-in');
  assert.equal(s.user.name, 'Ada Lovelace');
  assert.equal(seen.url, '/api/moi');
  assert.equal(seen.init.credentials, 'include');
  assert.equal(cloudSession.state, 'logged-in');
});

test('mode de stockage déduit de project.cloud / project.handleFolder', () => {
  assert.equal(storageModeOf({ cloud: { id: 3 }, handleFolder: { name: 'x' } }), 'cloud');
  assert.equal(storageModeOf({ cloud: null, handleFolder: { name: 'x' } }), 'folder');
  assert.equal(storageModeOf({ cloud: null, handleFolder: null }), 'unsaved');
});

test('aiguillage de l enregistrement par mode', () => {
  assert.equal(saveActionFor('cloud'), 'cloud');
  assert.equal(saveActionFor('folder'), 'folder');
  assert.equal(saveActionFor('unsaved'), 'choose', 'un projet nulle part propose un choix, pas une erreur');
  assert.deepEqual(saveChoicesFor(true).map((c) => c.key), ['cloud', 'folder', 'p3d']);
  assert.deepEqual(saveChoicesFor(false).map((c) => c.key), ['folder', 'p3d'], 'pas de cloud sans compte');
});

test('badge et entrées de menu conditionnelles', () => {
  assert.equal(storageBadgeOf('cloud', { name: 'Ville', cloud: { id: 1 } }).text, '☁ Cloud — Ville');
  assert.equal(storageBadgeOf('folder', { handleFolder: { name: 'Dossier' } }).text, '📁 Dossier — Dossier');
  assert.equal(storageBadgeOf('unsaved', {}).text, '⚠ Non enregistré');
  assert.deepEqual(storageMenuVisibility('unsaved', true), { uploadToCloud: true, downloadLocal: false, saveToFolder: true });
  assert.deepEqual(storageMenuVisibility('folder', false), { uploadToCloud: false, downloadLocal: false, saveToFolder: true });
  assert.deepEqual(storageMenuVisibility('cloud', true), { uploadToCloud: false, downloadLocal: true, saveToFolder: false });
});

test('URL : ?projet posé et retiré sans perdre les autres paramètres', () => {
  assert.equal(searchWithProject('?debug=1', 12), '?debug=1&projet=12');
  assert.equal(searchWithProject('?projet=12&debug=1', null), '?debug=1');
  assert.equal(searchWithProject('?projet=12', null), '');
});

test('envoi initial : crée le projet, ne dépose que les objets absents (HEAD 200 sauté)', async () => {
  const files = {
    'project.json': '{"name":"Demo"}',
    'scenes/A.scene.json': '{"objects":[]}',
    'assets/tex.png': new Uint8Array([1, 2, 3, 4])
  };
  const existing = await shaOf(files['assets/tex.png']);
  const calls = [];
  const saved = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const method = (init && init.method) || 'GET';
    calls.push(method + ' ' + url);
    if(method === 'POST' && url === '/api/projets'){
      assert.deepEqual(JSON.parse(init.body), { nom: 'Demo' });
      return reply(200, { id: 42, nom: 'Demo' });
    }
    if(method === 'HEAD') return reply(url.endsWith(existing) ? 200 : 404);
    if(method === 'PUT') return reply(200, {});
    if(method === 'POST' && url === '/api/projets/42/arbre'){
      const body = JSON.parse(init.body);
      assert.equal(body.base, null, 'un projet neuf n a pas de version de base');
      assert.deepEqual(Object.keys(body.files).sort(), Object.keys(files).sort());
      return reply(200, { version_id: 7, files: body.files });
    }
    return reply(404, {});
  };
  try {
    const steps = [];
    const r = await uploadProjectToCloud({ name: 'Demo', files, api: cloudApi(''), onProgress: (p) => steps.push(p.step) });
    assert.equal(r.id, 42);
    assert.equal(r.versionId, 7);
    assert.equal(r.uploaded, 2, 'deux objets absents déposés, la texture existante sautée');
    assert.ok(!calls.includes('PUT /api/assets/' + existing), 'objet déjà présent jamais redéposé');
    assert.equal(calls.filter((c) => c.startsWith('HEAD')).length, 3);
    assert.deepEqual([...new Set(steps)], ['create', 'upload', 'tree']);
  } finally {
    globalThis.fetch = saved;
  }
});

test('envoi initial : un refus de plan (402) remonte le message du serveur', async () => {
  const api = { async createProject(){ throw Object.assign(new Error('les projets heberges demandent un plan Createur'), { statut: 402 }); } };
  await assert.rejects(uploadProjectToCloud({ name: 'X', files: {}, api }), /plan Createur/);
});

test('Hub : la création cloud dépose la demande pour l éditeur', () => {
  const store = new Map();
  const storage = { setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  createCloudProjectPending('  Ville  ', 'fps', storage);
  assert.equal(store.get('hubPendingCloud'), '1');
  assert.equal(store.get('hubPendingProjectName'), 'Ville');
  assert.equal(store.get('hubPendingTemplate'), 'fps');
  assert.throws(() => createCloudProjectPending('  ', null, storage), /nom du projet est vide/);
});
