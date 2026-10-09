// La liaison moteur ↔ addon Blender, contre un FAUX addon : un serveur HTTP node qui parle le
// protocole v1 (outils/blender-addon/evaveo_blender_bridge/server.py). Pas de Blender, pas de
// navigateur — seulement les bornes que blender-link.js promet.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const link = await import('../js/blender-link.js');

const TOKEN = 'jeton-de-test';
const JOB = 'a'.repeat(32);
const GLB = Buffer.concat([Buffer.from('glTF'), Buffer.alloc(16)]);
const fake = {protocol: 1, jobPolls: 0, calls: []};
let server, port;

function send(res, status, body, type){
  const data = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
  res.writeHead(status, {'Content-Type': type || 'application/json'});
  res.end(data);
}

before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if(url.pathname === '/hello') return send(res, 200, {ok: true, protocol: fake.protocol, bridge: '1.0.0', blender: '4.5.0', project: '/tmp/p'});
    if(req.headers.authorization !== 'Bearer ' + TOKEN) return send(res, 401, {ok: false, error: 'Jeton absent ou invalide'});
    if(url.pathname === '/log') return send(res, 200, {ok: true, log: []});
    if(url.pathname === '/call'){
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const r = JSON.parse(body);
        fake.calls.push(r);
        if(r.op === 'inspect') return send(res, 200, {ok: true, result: {objects: ['Vase']}});
        send(res, 200, {ok: true, job_id: JOB});
      });
      return;
    }
    if(url.pathname === '/job/' + JOB){
      fake.jobPolls++;
      if(fake.jobPolls < 3) return send(res, 200, {job_id: JOB, state: 'running', progress: 0.5, message: 'rendu'});
      return send(res, 200, {job_id: JOB, state: 'succeeded', progress: 1, result: {files: ['/tmp/p/out/Vase.glb', '/tmp/p/out/page.glb']}});
    }
    if(url.pathname === '/file'){
      const p = url.searchParams.get('path');
      if(p.endsWith('Vase.glb')) return send(res, 200, GLB, 'model/gltf-binary');
      return send(res, 200, Buffer.from('<html>erreur</html>'), 'text/html');
    }
    send(res, 404, {ok: false, error: 'Route inconnue.'});
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
  link.setBlenderTransport({sleep: () => Promise.resolve()});
});

after(() => server.close());

test('l\'adresse est FIXE : seul un port entier se règle, jamais un hôte', () => {
  assert.equal(link.blenderBaseUrl(9877), 'http://127.0.0.1:9877');
  for(const bad of ['evil.example', '80', 0, 70000, '9877/../x', 9877.5]){
    assert.throws(() => link.blenderBaseUrl(bad), /port Blender invalide/);
  }
  assert.throws(() => link.configureBlender({port: 'evil.example'}), /port Blender invalide/);
});

test('sans jeton, aucune requête authentifiée ne part', async () => {
  link.configureBlender({port, token: ''});
  await assert.rejects(link.blenderCall('inspect', {}), /jeton Blender absent/);
});

test('un mauvais jeton remonte le message de l\'addon, en clair', async () => {
  link.configureBlender({port, token: 'faux'});
  await assert.rejects(link.blenderHello(), /Jeton absent ou invalide/);
  assert.equal(link.blenderStatus().connected, false);
});

test('hello : connecté avec le bon jeton, refusé si le protocole diffère', async () => {
  link.configureBlender({port, token: TOKEN});
  const h = await link.blenderHello();
  assert.equal(h.blender, '4.5.0');
  assert.equal(link.blenderStatus().connected, true);
  fake.protocol = 2;
  await assert.rejects(link.blenderHello(), /incompatible \(protocole 2/);
  assert.equal(link.blenderStatus().connected, false);
  fake.protocol = 1;
});

test('un appel direct rend son résultat ; un job est suivi jusqu\'au bout', async () => {
  link.configureBlender({port, token: TOKEN});
  assert.deepEqual(await link.blenderCall('inspect', {}), {objects: ['Vase']});
  const seen = [];
  fake.jobPolls = 0;
  const r = await link.blenderCall('delivery_action', {action: 'export', spec_json: {name: 'Vase'}},
    {onProgress: (p) => seen.push(p.fraction)});
  assert.equal(r.files.length, 2);
  assert.ok(seen.includes(0.5) && seen.includes(1));
  assert.equal(fake.calls.at(-1).args.spec_json.name, 'Vase');
});

test('au-delà du délai, l\'appel rend {pending} au lieu de bloquer', async () => {
  fake.jobPolls = -1000;
  const r = await link.blenderCall('delivery_action', {action: 'export'}, {timeoutMs: -1});
  assert.deepEqual(r, {pending: JOB});
});

test('un GLB est vérifié : une page HTML renvoyée à sa place est refusée', async () => {
  const ok = await link.blenderFetchGlb('/tmp/p/out/Vase.glb');
  assert.equal(ok.name, 'Vase.glb');
  assert.ok(link.isGlb(ok.bytes));
  await assert.rejects(link.blenderFetchGlb('/tmp/p/out/page.glb'), /n'est pas un GLB/);
});

test('Blender fermé : un message qui dit quoi faire', async () => {
  link.configureBlender({port: 1025, token: TOKEN});
  await assert.rejects(link.blenderHello(), /Blender injoignable sur 127\.0\.0\.1:1025/);
  link.configureBlender({port, token: TOKEN});
});

test('le journal garde les appels, réussis ou non', () => {
  const log = link.blenderStatus().log;
  assert.ok(log.length >= 2);
  assert.ok(log.some((e) => e.op === 'inspect' && e.ok));
});
