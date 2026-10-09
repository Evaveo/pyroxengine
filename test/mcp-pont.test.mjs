// moteur/test/mcp-pont.test.mjs
//
// Deux niveaux, parce qu'ils n'attrapent pas les mêmes pannes :
//   • le protocole seul (protocole-mcp.mjs), avec un contexte factice ;
//   • le serveur ENTIER lancé comme le lancerait un client MCP — stdio d'un côté, un faux
//     éditeur qui parle au pont HTTP de l'autre. C'est le seul niveau qui prouve que les
//     deux faces sont effectivement reliées : un protocole juste posé à côté d'un pont juste
//     donnerait tous les tests verts et aucun outil utilisable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { traiterMessage, outilVersMcp, VERSION_PROTOCOLE } from '../mcp/protocole-mcp.mjs';

const racineMoteur = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const OUTILS_FACTICES = [
  {name: 'list_scene', description: 'list', input_schema: {type: 'object', properties: {}}},
  {name: 'create_object', description: 'crée',
   input_schema: {type: 'object', properties: {type: {type: 'string'}}, required: ['type']}}
];

function contexte(options){
  const o = options || {};
  return {
    catalogue: () => (o.horsLigne ? [] : OUTILS_FACTICES),
    editeurConnecte: () => !o.horsLigne,
    appeler: async (name, args) => {
      if(o.echoue) throw new Error('object « x » introuvable');
      return 'appel ' + name + ' ' + JSON.stringify(args);
    }
  };
}

// ---------- protocole ----------
test('initialize repond une version, des capacites et une identite', async () => {
  const r = await traiterMessage(
    {jsonrpc: '2.0', id: 1, method: 'initialize', params: {protocolVersion: '2024-11-05'}},
    contexte());
  assert.equal(r.result.protocolVersion, '2024-11-05',
    'une version connue doit être renvoyée en écho, pas remplacée par la nôtre');
  assert.ok(r.result.capabilities.tools, 'le serveur doit annoncer la capacité outils');
  assert.equal(r.result.serverInfo.name, 'editeur3d');

  const inconnue = await traiterMessage(
    {jsonrpc: '2.0', id: 2, method: 'initialize', params: {protocolVersion: '1999-01-01'}},
    contexte());
  assert.equal(inconnue.result.protocolVersion, VERSION_PROTOCOLE,
    'une version inconnue retombe sur la nôtre au lieu de couper la connexion');
});

test('une notification ne recoit AUCUNE reponse', async () => {
  // Répondre à une notification est une faute de protocole : certains clients ferment la
  // session sur une réponse dont l'id ne correspond à aucune requête.
  const r = await traiterMessage({jsonrpc: '2.0', method: 'notifications/initialized'}, contexte());
  assert.equal(r, null);
});

test('tools/list transpose le catalogue de l\'editeur, sans le reecrire', async () => {
  const r = await traiterMessage({jsonrpc: '2.0', id: 3, method: 'tools/list'}, contexte());
  assert.equal(r.result.tools.length, 2);
  assert.equal(r.result.tools[0].name, 'list_scene');
  assert.deepEqual(r.result.tools[1].inputSchema.required, ['type'],
    'le schéma JSON de la commande doit arriver intact jusqu\'à l\'agent');
  assert.ok(!('input_schema' in r.result.tools[0]), 'MCP attend inputSchema, pas input_schema');
});

test('sans editeur connecte, on rend zero outil et une erreur LISIBLE', async () => {
  const hors = contexte({horsLigne: true});
  const list = await traiterMessage({jsonrpc: '2.0', id: 4, method: 'tools/list'}, hors);
  assert.deepEqual(list.result.tools, [],
    'annoncer des outils injoignables ferait appeler l\'agent dans le vide');

  const appel = await traiterMessage(
    {jsonrpc: '2.0', id: 5, method: 'tools/call', params: {name: 'list_scene'}}, hors);
  assert.equal(appel.error, undefined,
    'ce doit être une erreur d\'OUTIL, pas de protocole : le modèle doit pouvoir la lire');
  assert.equal(appel.result.isError, true);
  assert.match(appel.result.content[0].text, /editeur\.html|éditeur/);
});

test('un echec de commande revient en isError, pas en error JSON-RPC', async () => {
  const r = await traiterMessage(
    {jsonrpc: '2.0', id: 6, method: 'tools/call', params: {name: 'create_object', arguments: {}}},
    contexte({echoue: true}));
  assert.equal(r.error, undefined);
  assert.equal(r.result.isError, true);
  assert.match(r.result.content[0].text, /introuvable/,
    'le message de la commande doit remonter tel quel — c\'est lui qui permet de corriger');
});

test('les arguments arrivent jusqu\'a la commande', async () => {
  const r = await traiterMessage(
    {jsonrpc: '2.0', id: 7, method: 'tools/call',
     params: {name: 'create_object', arguments: {type: 'cube', name: 'Sol'}}}, contexte());
  assert.match(r.result.content[0].text, /"type":"cube"/);
  assert.match(r.result.content[0].text, /"name":"Sol"/);
});

test('une methode inconnue est une erreur de protocole en bonne et due shape', async () => {
  const r = await traiterMessage({jsonrpc: '2.0', id: 8, method: 'resources/list'}, contexte());
  assert.equal(r.error.code, -32601);
});

test('la transposition ne perd pas les commandes ajoutees par un plugin', () => {
  // Le catalogue vient de l'éditeur, pas d'une copie figée : une commande enregistrée par
  // Editor.registerCommandMenu ou par un autre plugin doit traverser sans code dédié.
  const inedit = outilVersMcp({name: 'ma_commande_de_plugin', description: 'd',
                               input_schema: {type: 'object', properties: {a: {type: 'number'}}}});
  assert.equal(inedit.name, 'ma_commande_de_plugin');
  assert.deepEqual(Object.keys(inedit.inputSchema.properties), ['a']);
  const sansSchema = outilVersMcp({name: 'x', description: 'd'});
  assert.equal(sansSchema.inputSchema.type, 'object', 'un schéma absent ne doit pas rendre undefined');
});

// ---------- bout en bout : le vrai serveur, ses deux faces ----------
function lancerServeur(port){
  const proc = spawn(process.execPath, [path.join(racineMoteur, 'mcp', 'serveur-mcp.mjs')], {
    env: Object.assign({}, process.env, {PORT_PONT: String(port), JETON_PONT: 'jeton-de-test'}),
    stdio: ['pipe', 'pipe', 'pipe']
  });
  const reponses = new Map();
  let tampon = '';
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (b) => {
    tampon += b;
    let i;
    while((i = tampon.indexOf('\n')) !== -1){
      const line = tampon.slice(0, i).trim();
      tampon = tampon.slice(i + 1);
      if(!line) continue;
      const msg = JSON.parse(line);
      const attendu = reponses.get(msg.id);
      if(attendu){ reponses.delete(msg.id); attendu(msg); }
    }
  });
  let prochainId = 1;
  const demander = (method, params) => new Promise((resolve) => {
    const id = prochainId++;
    reponses.set(id, resolve);
    proc.stdin.write(JSON.stringify({jsonrpc: '2.0', id, method, params}) + '\n');
  });
  const ready = new Promise((resolve) => {
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (t) => { if(t.includes('pont MCP sur')) resolve(); });
  });
  return {proc, demander, ready};
}

test('bout en bout : un agent MCP pilote un editeur branche sur le pont', async () => {
  const port = 8790;
  const serveur = lancerServeur(port);
  const root = 'http://127.0.0.1:' + port;
  const enTetes = {'Content-Type': 'application/json', 'X-Jeton': 'jeton-de-test'};
  try {
    await serveur.ready;

    // 1. Aucun éditeur : le catalogue est vide. C'est l'état de départ honnête.
    const empty = await serveur.demander('tools/list', {});
    assert.deepEqual(empty.result.tools, []);

    // 2. Un jeton faux est refusé — sinon toute page ouverte piloterait l'éditeur.
    const refusal = await fetch(root + '/catalogue', {
      method: 'POST', headers: {'Content-Type': 'application/json', 'X-Jeton': 'false'},
      body: JSON.stringify({tools: OUTILS_FACTICES})});
    assert.equal(refusal.status, 403);

    // 3. Le faux éditeur publie son catalogue, puis se met en pending de travail.
    const inscription = await fetch(root + '/catalogue', {
      method: 'POST', headers: enTetes,
      body: JSON.stringify({session: 's1', tools: OUTILS_FACTICES})});
    assert.equal(inscription.status, 200);

    const list = await serveur.demander('tools/list', {});
    assert.deepEqual(list.result.tools.map((t) => t.name), ['list_scene', 'create_object'],
      'le catalogue publié par l\'éditeur doit être celui que voit l\'agent');

    // La loop du plugin : demande des tâches, exécute, renvoie. La session accompagne CHAQUE
    // appel, pas seulement l'inscription — le jeton dit « ce client a le droit de parler au
    // pont », il ne dit pas « ce client EST l'éditeur connecté », et les deux onglets d'un même
    // utilisateur partagent le même jeton puisqu'il vient du même localStorage.
    const enTetesSession = Object.assign({}, enTetes, {'X-Session': 's1'});
    const loop = (async () => {
      const r = await fetch(root + '/taches', {headers: enTetesSession});
      const {taches} = await r.json();
      for(const t of taches){
        await fetch(root + '/resultat', {
          method: 'POST', headers: enTetesSession,
          body: JSON.stringify({id: t.id, ok: true,
                                value: 'fait: ' + t.name + ' ' + JSON.stringify(t.args)})});
      }
      return taches.length;
    })();

    // 4. L'agent appelle un outil ; la réponse doit venir de l'éditeur, pas du serveur.
    const appel = await serveur.demander('tools/call',
      {name: 'create_object', arguments: {type: 'sphere'}});
    assert.equal(appel.result.isError, undefined);
    assert.match(appel.result.content[0].text, /fait: create_object .*"type":"sphere"/,
      'le texte doit venir de la commande exécutée dans l\'éditeur');
    assert.equal(await loop, 1, 'l\'éditeur doit avoir reçu exactement une tâche');
  } finally {
    serveur.proc.kill();
  }
});

test('deux editeurs sur le meme pont : le second est refuse, pas servi a moitie', async () => {
  const port = 8791;
  const serveur = lancerServeur(port);
  const root = 'http://127.0.0.1:' + port;
  const enTetes = {'Content-Type': 'application/json', 'X-Jeton': 'jeton-de-test'};
  try {
    await serveur.ready;
    const un = await fetch(root + '/catalogue', {method: 'POST', headers: enTetes,
      body: JSON.stringify({session: 's1', tools: OUTILS_FACTICES})});
    assert.equal(un.status, 200);
    // Deux onglets se voleraient les tâches à tour de rôle, chacun n'en voyant que la moitié
    // — sans la moindre erreur pour le dire.
    const deux = await fetch(root + '/catalogue', {method: 'POST', headers: enTetes,
      body: JSON.stringify({session: 's2', tools: OUTILS_FACTICES})});
    assert.equal(deux.status, 409);
    // Le MÊME tab qui se reconnecte (rechargement de page) doit, lui, être accepté.
    const memeOnglet = await fetch(root + '/catalogue', {method: 'POST', headers: enTetes,
      body: JSON.stringify({session: 's1', tools: OUTILS_FACTICES})});
    assert.equal(memeOnglet.status, 200);
  } finally {
    serveur.proc.kill();
  }
});

// ---------- le pont expose bien la surface de l'éditeur, pas une copie ----------
test('le plugin publie Editor.api.copilotTools() (= copToolsApi), donc commandes lui-meme', () => {
  const plugin = readFileSync(path.join(racineMoteur, 'exemples/plugin-pont-mcp.js'), 'utf8');
  assert.match(plugin, /tools:\s*Editor\.api\.copilotTools\(\)/,
    'le catalogue doit être celui du copilote, sinon les deux surfaces divergeront');
  assert.match(plugin, /Editor\.api\.copilotRun\(/,
    'l\'exécution doit passer par copRun — c\'est lui qui journalise et historise');

  // Et ces deux entrées d'Editor.api mènent bien aux fonctions du copilote.
  const copilot = readFileSync(path.join(racineMoteur, 'js/copilot.js'), 'utf8');
  assert.match(copilot, /function copToolsApi\(/);
  assert.match(copilot, /function copRun\(/);
  const plugins = readFileSync(path.join(racineMoteur, 'js/plugins.js'), 'utf8');
  assert.match(plugins, /copilotTools: function\(\)\{ return copToolsApi\(\); \}/);
  assert.match(plugins, /copilotRun: function\(name, args\)\{ return copRun\(name, args\); \}/);
});

test('un onglet abandonne ne peut PAS voler les taches de l editeur connecte', async () => {
  // Le défaut que ce test verrouille : /catalogue refusait bien un second éditeur, mais
  // /taches et /resultat ne vérifiaient que le JETON. Or les deux onglets d'un même
  // utilisateur partagent le même jeton — il vient du même localStorage. Le second tab
  // pouvait donc appeler /taches et emporter le travail une fois sur deux, puis renvoyer des
  // résultats pour des tâches qui n'étaient pas les siennes. La porte d'entrée était gardée,
  // la fenêtre restait ouverte.
  const port = 8793;
  const serveur = lancerServeur(port);
  const root = 'http://127.0.0.1:' + port;
  const enTetes = {'Content-Type': 'application/json', 'X-Jeton': 'jeton-de-test'};
  try {
    await serveur.ready;
    await fetch(root + '/catalogue', {method: 'POST', headers: enTetes,
      body: JSON.stringify({session: 's1', tools: OUTILS_FACTICES})});

    // Jeton VALIDE, session d'un autre tab : refusé.
    const vol = await fetch(root + '/taches',
      {headers: Object.assign({}, enTetes, {'X-Session': 's2'})});
    assert.equal(vol.status, 409, 'un onglet à la session inconnue a pu demander des tâches');

    const volResultat = await fetch(root + '/resultat', {method: 'POST',
      headers: Object.assign({}, enTetes, {'X-Session': 's2'}),
      body: JSON.stringify({id: 'x', ok: true, value: 'vole'})});
    assert.equal(volResultat.status, 409, 'un onglet étranger a pu renvoyer un résultat');

    // Sans en-tête du tout : refusé aussi. C'est le cas du client écrit avant ce contrôle,
    // et le laisser passer aurait vidé la garde de son sens.
    const sansSession = await fetch(root + '/taches', {headers: enTetes});
    assert.equal(sansSession.status, 409, 'un client sans session a été servi');
  } finally { serveur.proc.kill(); }
});

test('la session survit au rechargement de l editeur', () => {
  // Tirée en mémoire, elle changeait à chaque F5 : le serveur voyait une session inconnue et
  // répondait « un autre éditeur est déjà connecté » — en accusant un second éditeur qui
  // n'existait pas. Le port et le jeton étaient déjà persistés ; la session ne l'était pas.
  const src = readFileSync(path.join(racineMoteur, 'exemples/plugin-pont-mcp.js'), 'utf8');
  assert.match(src, /const CLE_SESSION = 'mcp-pont-session'/, 'aucune clé de stockage');
  assert.match(src, /session: localStorage\.getItem\(CLE_SESSION\)/,
    'la session doit être RELUE au démarrage, sinon la persistance ne sert à rien');
  assert.match(src, /localStorage\.setItem\(CLE_SESSION, state\.session\)/,
    'la session doit être écrite quand elle est créée');
  assert.match(src, /'X-Session': state\.session/,
    'la session doit accompagner chaque appel, pas seulement /catalogue');
});
