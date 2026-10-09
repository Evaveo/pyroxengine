// moteur/test/asset-loading-resilience.test.mjs
//
// Régressions BUGS_MOTEUR n° 1, 2, 17, 18, 19 :
//  - changer / supprimer une scène ne doit JAMAIS rejouer une liste d'assets périmée
//    (les assets sont globaux au projet) ;
//  - une texture qui échoue au chargement (429 / 5xx) est réessayée, puis GARDÉE marquée
//    « non chargée », et l'enregistrement est refusé tant qu'il en reste ;
//  - une tilemap n'attend pas une image indéfiniment.
// Aucun navigateur : harnais node:vm (engine-env.mjs) et import direct des modules purs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { creerContexte } from './engine-env.mjs';
import { checkerPixels, isRetryableError, parseRetryAfter, retryDelayMs, unloadedAssetsMessage,
  withRetry } from '../js/load-retry.js';

const noWait = { wait: () => Promise.resolve() };

test('withRetry : un 429 est réessayé, puis la lecture réussit', async () => {
  let n = 0;
  const waits = [];
  const out = await withRetry(async () => {
    n++;
    if(n < 3) throw Object.assign(new Error('HTTP 429'), { status: 429, retryAfter: '2' });
    return 'ok';
  }, { wait: (ms) => { waits.push(ms); return Promise.resolve(); } });
  assert.equal(out, 'ok');
  assert.equal(n, 3);
  assert.deepEqual(waits, [2000, 2000], 'Retry-After (secondes) doit être respecté');
});

test('withRetry : un 404 n est PAS réessayé ; un 503 l est jusqu au bout', async () => {
  let n = 0;
  await assert.rejects(withRetry(async () => { n++; throw Object.assign(new Error('x'), { status: 404 }); }, noWait));
  assert.equal(n, 1);
  n = 0;
  const e = await withRetry(async () => { n++; throw Object.assign(new Error('y'), { status: 503 }); },
    Object.assign({ attempts: 4 }, noWait)).catch((x) => x);
  assert.equal(n, 4);
  assert.equal(e.attempts, 4);
});

test('délais : croissants, plafonnés, Retry-After en date HTTP', () => {
  assert.equal(retryDelayMs(0, null, { baseMs: 100 }), 100);
  assert.equal(retryDelayMs(3, null, { baseMs: 100 }), 800);
  assert.equal(retryDelayMs(20, null, { baseMs: 100, maxMs: 5000 }), 5000);
  const now = Date.parse('2026-10-05T10:00:00Z');
  assert.equal(parseRetryAfter('Mon, 05 Oct 2026 10:00:03 GMT', now), 3000);
  assert.equal(parseRetryAfter('n importe quoi'), null);
  assert.ok(isRetryableError(new Error('réseau coupé')));
  assert.ok(!isRetryableError({ status: 403 }));
});

test('damier de remplacement et message de refus', () => {
  const px = checkerPixels(4, 2);
  assert.equal(px.length, 4 * 4 * 4);
  assert.deepEqual([...px.slice(0, 4)], [255, 0, 255, 255]);
  assert.deepEqual([...px.slice(8, 12)], [0, 0, 0, 255]);
  assert.equal(unloadedAssetsMessage([{ name: 'a' }]), null);
  assert.match(unloadedAssetsMessage([{ name: 'herbe', unloaded: true }]), /refusé.*« herbe »/);
});

// ---------- n° 18 : la boucle des textures de rebuildAssetsFromDescriptors ----------
const env = creerContexte(['js/tile-palette.js', 'js/assets.js', 'js/materials.js',
  'js/model-import.js', 'js/import-settings.js', 'js/post-profile.js', 'js/project-settings.js',
  'js/serialization.js']);

test('une texture en 429 persistant est GARDÉE, marquée non chargée, et bloque la sauvegarde', async () => {
  env.assets.length = 0;
  let calls = 0;
  const das = [{ id: 'a4', kind: 'texture', name: 'village_herbe', folder: 'Textures',
    paramsImport: null, files: [{ name: 'village_herbe.png' }] }];
  const byId = await env.rebuildAssetsFromDescriptors(das, async function(){
    calls++;
    throw Object.assign(new Error('objet 04b804c0 illisible (HTTP 429)'), { status: 429, retryAfter: '0' });
  });
  assert.ok(calls >= 2, 'le chargement doit être réessayé (' + calls + ' essai)');
  const a = env.assets.find((x) => x.name === 'village_herbe');
  assert.ok(a, 'la texture a été retirée du projet');
  assert.equal(a.id, 'a4', 'l identité doit être gardée');
  assert.equal(a.unloaded, true);
  assert.equal(a.descriptor, das[0], 'le descripteur d origine est conservé');
  assert.equal(byId.a4, a, 'les références vers la texture restent résolues');
  assert.throws(() => env.assertSavable(), /refusé/);
  env.assets.length = 0;
  assert.doesNotThrow(() => env.assertSavable());
});

// ---------- n° 1 / 2 / 17 : changer de scène ne rejoue pas une liste d'assets périmée ----------
test('changeScene ne restaure JAMAIS la liste d assets de la scène cible', () => {
  const ctx = creerContexte(['js/network-game.js', 'js/project-settings.js', 'js/folder-watch.js', 'js/project.js']);
  const restored = [];
  Object.assign(ctx, {
    stateCurrent: () => ({ assets: ['périmé'], fieldsAssets: [], objects: [{ id: 1 }] }),
    restoreState: (s) => restored.push(s),
    switchSceneLock(){}, migrateMachinesOfScene(){}, newScene(){}, setStatus(){},
    histo: { undo: [], redo: [] }, phys: { active: false }
  });
  const project = vm.runInContext('project', ctx);
  // La scène 2 porte un instantané COMPLET (assets compris), comme en laisse buildDataProject.
  project.scenes = [{ name: 'Hub', data: null },
    { name: 'Donjon', data: { assets: ['vieux'], fieldsAssets: [{ id: 'a1' }], objects: [] } }];
  project.current = 0;
  ctx.changeScene(1);
  assert.equal(restored.length, 1);
  assert.ok(!('assets' in restored[0]) && !('fieldsAssets' in restored[0]),
    'la liste d assets de la scène cible a été rejouée : tout asset créé depuis serait perdu');
  assert.ok(!('assets' in project.scenes[0].data), 'la scène quittée ne doit pas garder de photo d assets');
  assert.deepEqual(project.scenes[0].data.objects, [{ id: 1 }], 'les objets de la scène, eux, sont gardés');
});

// ---------- n° 19 : une tilemap n'attend pas une image pour toujours ----------
test('pendingTilemap abandonne après TILEMAP_PENDING_MAX essais', () => {
  const ctx = creerContexte(['js/component-registry.js', 'js/component.js', 'js/node.js', 'js/component-data.js',
    'js/tile-palette.js', 'js/sprite-2d.js', 'js/tilemap.js', 'js/components/component-tilemap.js']);
  const map = {};
  let dirty = true, n = 0;
  while(dirty && n < 10000){ dirty = ctx.pendingTilemap(map, true); n++; }
  assert.equal(dirty, false, 'la tilemap reste _dirty pour toujours');
  assert.equal(n, vm.runInContext('TILEMAP_PENDING_MAX', ctx));
  assert.equal(ctx.pendingTilemap(map, false), false);
  assert.equal(map._pendingTries, 0);
});
