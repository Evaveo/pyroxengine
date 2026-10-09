// LA MIGRATION DÉPLACE, ELLE NE RECONSTRUIT PAS.
//
// « project.settings absent → construit depuis les valeurs par défaut du code » aurait
// RÉINITIALISÉ les calques, les entrées et les réglages de cuisson de tout projet existant. Le
// patron correct est celui de MIGRATIONS[13] : poser un défaut SEULEMENT s'il manque. Ce test
// mesure exactement ça, sur un projet de la version courante.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte } from './engine-env.mjs';

// scripts.js, environment.js, lightmap-bake.js et project.js portent les défauts que la
// migration ne doit PAS dupliquer (INPUTS_DEFAULT, ENV_DEFAULT, LIGHTMAP_DEFAULT,
// LAYERS_DEFAULT) : ils sont chargés pour que la migration voie les vrais, et non une copie
// qui divergerait sans que rien ne le dise.
// `js/folder-watch.js` précède project.js : celui-ci lit ses constantes dès son chargement
// (la cadence de la surveillance du dossier), et le harnais monte tout dans une seule portée.
const env = creerContexte(['js/scripts.js', 'js/environment.js', 'js/lightmap-bake.js',
                           'js/assets.js', 'js/materials.js', 'js/model-import.js',
                           'js/import-settings.js', 'js/network-game.js', 'js/project-settings.js', 'js/serialization.js',
                           'js/folder-watch.js', 'js/project.js']);
const { migrateProjectData } = env;
const clone = (x) => JSON.parse(JSON.stringify(x));

function projetV14(){
  return { version: 14, projectName: 'Mon jeu', current: 0,
    layers: [{ id: 0, name: 'MES CALQUES A MOI', visible: true }],
    layers2d: ['Ciel', 'Sol'], ppu2d: 64,
    inputs: { sauter: ['Space'] },
    lightmap: { resolution: 512 },
    design: 'Le document de conception.',
    versionVisible: false,
    folders: [], scenes: [{ name: 'S1', data: null }], assets: [] };
}

test('les champs existants sont DEPLACES, pas reconstruits', () => {
  const d = migrateProjectData(projetV14());
  assert.equal(d.settings.layers[0].name, 'MES CALQUES A MOI');
  assert.deepEqual(Array.from(d.settings.layers2d), ['Ciel', 'Sol']);
  assert.equal(d.settings.ppu2d, 64);
  assert.deepEqual({ ...d.settings.inputs }, { sauter: ['Space'] });
  assert.equal(d.settings.lightmap.resolution, 512);
  assert.equal(d.settings.design, 'Le document de conception.');
  assert.equal(d.settings.versionVisible, false, 'false est une VALEUR, pas une absence');
  assert.equal(d.settings.name, 'Mon jeu');
});

test('les anciens champs de premier niveau disparaissent', () => {
  const d = migrateProjectData(projetV14());
  ['layers', 'layers2d', 'ppu2d', 'inputs', 'lightmap', 'design', 'versionVisible', 'projectName']
    .forEach((k) => assert.equal(d[k], undefined, k + ' aurait du etre deplace'));
});

test('un champ ABSENT recoit son defaut, un champ present n y touche pas', () => {
  const sans = projetV14();
  delete sans.layers2d;
  const d = migrateProjectData(sans);
  assert.ok(d.settings.layers2d.length, 'un defaut est pose quand le champ manque');
  assert.equal(d.settings.ppu2d, 64, 'et les autres ne sont pas ecrases pour autant');
});

test('un projet DEJA migre ne remigre pas', () => {
  const une = migrateProjectData(projetV14());
  const deux = migrateProjectData(clone(une));
  assert.deepEqual(clone(deux), clone(une));
});

test('les valeurs par defaut d une nouvelle scene sont un CLONE, pas une reference', () => {
  const d = migrateProjectData(projetV14());
  d.settings.newScene.env.skyColor = '#123456';
  const autre = migrateProjectData(projetV14());
  assert.notEqual(autre.settings.newScene.env.skyColor, '#123456',
    'un defaut partage par reference ferait deriver toutes les scenes ensemble');
});

test('les defauts posent la MEME valeur que le code, jamais une copie divergente', () => {
  const vide = { version: 14, current: 0, folders: [], scenes: [], assets: [] };
  const d = migrateProjectData(vide);
  assert.deepEqual(clone(d.settings.inputs), clone(env.INPUTS_DEFAULT));
  assert.deepEqual(clone(d.settings.lightmap), clone(env.LIGHTMAP_DEFAULT));
  assert.deepEqual(clone(d.settings.newScene.env), clone(env.ENV_DEFAULT));
  assert.deepEqual(clone(d.settings.layers), clone(env.LAYERS_DEFAULT));
});

// ---------- L'aller-retour ----------
//
// La migration seule ne prouve rien : ce qui compte est qu'un projet enregistré APRÈS la
// migration se relise à l'identique. On mesure les deux formats — le `.p3d` (les données
// complètes) et le dossier (le manifeste), puisque c'est précisément leur divergence
// silencieuse qui a motivé la tâche 1.

test('les reglages traversent un aller-retour .p3d sans perdre une valeur', () => {
  const d = migrateProjectData(projetV14());
  // Ce qu'un enregistrement écrit, puis ce qu'une relecture en fait.
  const ecrit = clone({ version: d.version, settings: d.settings, current: d.current,
                        folders: d.folders, scenes: d.scenes, assets: d.assets });
  const relu = migrateProjectData(clone(ecrit));
  assert.deepEqual(clone(relu.settings), clone(d.settings));
});

test('les reglages traversent un aller-retour DOSSIER sans perdre une valeur', () => {
  const dossier = creerContexte(['js/scripts.js', 'js/environment.js',
    'js/lightmap-bake.js', 'js/file-names.js', 'js/network-game.js', 'js/project-settings.js',
    'js/project-folder.js']);
  const d = migrateProjectData(projetV14());
  const manifeste = clone({ name: d.settings.name, version: 1, folders: [],
                            settings: d.settings, scenes: [{ name: 'S1' }], assets: [] });
  const relu = dossier.migrateManifestFolder(clone(manifeste));
  assert.deepEqual(clone(relu.settings), clone(d.settings));
});

test('project.settings est la source, project.layers en est la FACADE', async () => {
  const fs = await import('node:fs');
  const source = fs.readFileSync(new URL('../js/project.js', import.meta.url), 'utf8');
  const bloc = source.slice(source.indexOf('const project = {'),
                            source.indexOf('const scenesList'));
  ['layers', 'layers2d', 'ppu2d', 'inputs', 'lightmap', 'design', 'versionVisible', 'name']
    .forEach(function(k){
      assert.ok(bloc.indexOf('get ' + k + '()') !== -1,
        k + ' doit etre un accesseur sur settings, pas un second exemplaire de la donnee');
    });
});

// ---------- Les réglages MULTIJOUEUR ----------

test('reseau : un projet sans reglage recoit les defauts, un reglage present est nettoye', () => {
  const d = migrateProjectData(projetV14());
  assert.deepEqual(clone(d.settings.network), clone(env.sanitizeNetworkSettings({})));
  const p = projetV14();
  p.settings = Object.assign(migrateProjectData(projetV14()).settings,
    { network: { enabled: true, transport: 'p2p', maxPlayers: 99, sendRate: 1, gameKey: 'mj_k',
                 replication: 'nimporte', iceServers: [{ urls: 'turn:t', credential: 'c' }] } });
  const n = migrateProjectData(p).settings.network;
  assert.equal(n.enabled, true);
  assert.equal(n.transport, 'p2p');
  assert.equal(n.maxPlayers, 32);
  assert.equal(n.sendRate, 5);
  assert.equal(n.gameKey, 'mj_k');
  assert.equal(n.replication, 'owner');
  assert.deepEqual(clone(n.iceServers), [{ urls: 'turn:t', credential: 'c' }]);
  assert.equal(n.p2pFallbackRelay, true, 'false seul l aurait eteint');
});

test('reseau : le reglage traverse un aller-retour .p3d et dossier', () => {
  const p = projetV14();
  p.settings = Object.assign(migrateProjectData(projetV14()).settings,
    { network: { enabled: true, transport: 'p2p', server: 'https://relais.exemple', p2pFallbackRelay: false } });
  const d = migrateProjectData(p);
  const relu = migrateProjectData(clone({ version: d.version, settings: d.settings, current: 0,
    folders: [], scenes: d.scenes, assets: [] }));
  assert.deepEqual(clone(relu.settings.network), clone(d.settings.network));
  assert.equal(relu.settings.network.server, 'https://relais.exemple');
  assert.equal(relu.settings.network.p2pFallbackRelay, false);
  const dossier = creerContexte(['js/scripts.js', 'js/environment.js', 'js/lightmap-bake.js',
    'js/file-names.js', 'js/network-game.js', 'js/project-settings.js', 'js/project-folder.js']);
  const m = dossier.migrateManifestFolder(clone({ name: 'x', version: 1, folders: [],
    settings: d.settings, scenes: [{ name: 'S1' }], assets: [] }));
  assert.deepEqual(clone(m.settings.network), clone(d.settings.network));
});

test('reseau : projectNetworkSettings fusionne un patch et le nettoie', () => {
  env.globalThis.project = { settings: { network: null } };
  try{
    const a = env.projectNetworkSettings();
    assert.equal(a.transport, 'relay');
    const b = env.projectNetworkSettings({ transport: 'p2p', sendRate: 500 });
    assert.equal(b.transport, 'p2p');
    assert.equal(b.sendRate, 60);
    const c = env.projectNetworkSettings({ maxPlayers: 4 });
    assert.equal(c.transport, 'p2p', 'un champ absent du patch ne bouge pas');
    assert.equal(c.maxPlayers, 4);
    c.maxPlayers = 12;
    assert.equal(env.globalThis.project.settings.network.maxPlayers, 4, 'rend une copie');
  } finally { delete env.globalThis.project; }
});
