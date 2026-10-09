// STEAM — succès, statistiques, Steam Cloud, Steam Input.
//
// Tout ce qui peut se vérifier SANS client Steam et sans navigateur : le SDK est natif, on ne
// peut donc pas l'appeler d'ici, mais les trois jonctions où ça casse se vérifient :
//
//  1. LE PONT. Chaque canal que `preload.js` appelle doit avoir son gestionnaire dans `main.js`.
//     Un canal sans gestionnaire fait ATTENDRE LA PAGE À L'INFINI (`sendSync` sans réponse) : le
//     jeu gèle au premier succès, et rien ne le relie à une faute de frappe dans un nom.
//  2. LE JEU SANS STEAM. `api.steam` doit être inerte, pas lever : un script écrit pour Steam
//     tourne dans l'éditeur et sur le web.
//  3. STEAM INPUT. Les actions Steam entrent comme des touches `steam:<action>`, les sticks par
//     les mêmes axes que la manette, et tout s'efface quand Steam ne rend plus rien.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { creerContexte } from './engine-env.mjs';
import * as bridge from '../js/steam-bridge.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const lire = (f) => readFileSync(path.join(root, f), 'utf8');
const codeSeul = (src) => src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

const desk = creerContexte(['js/build-desktop.js']);
const INPUTS = {
  actions: {jump: [' ', 'pad:0'], interact: ['e'], 'bad-name': ['x'], '9lives': ['y']},
  axes: {horizontal: ['left', 'right', 'pad:axis0'], vertical: ['back', 'advance', 'pad:axis1-']}
};
const wrapper = desk.desktopWrapperFiles('Donjons', {inputs: INPUTS});

/** Un faux pont `window.bureau`, qui note ce qu'on lui demande. */
function fakeBridge(extra){
  const calls = [];
  const stats = {};
  const files = {};
  const steam = {
    available: true,
    info: {available: true, name: 'Aventurière', language: 'french', deck: true},
    unlock: (id) => { calls.push(['unlock', id]); return true; },
    clear: (id) => { calls.push(['clear', id]); return true; },
    isUnlocked: (id) => id === 'ACH_DONE',
    getStat: (n) => stats[n] || 0,
    setStat: (n, v) => { stats[n] = v; return true; },
    addStat: (n, d) => { stats[n] = (stats[n] || 0) + d; return stats[n]; },
    input: () => null
  };
  const cloud = {
    read: (n) => (n in files ? files[n] : null),
    write: (n, t) => { files[n] = t; return true; },
    remove: (n) => { delete files[n]; return true; }
  };
  return Object.assign({calls, stats, files, steam, cloud}, extra || {});
}
function withBridge(b, fn){
  const before = globalThis.bureau;
  globalThis.bureau = b;
  try{ return fn(); } finally{ if(before === undefined) delete globalThis.bureau; else globalThis.bureau = before; }
}

// ---------- 1. Le pont ----------

test('main.js et preload.js engendrés se PARSENT', () => {
  ['main.js', 'preload.js'].forEach((f) => {
    assert.doesNotThrow(() => new vm.Script(wrapper[f], {filename: f}), f + ' ne se parse pas');
  });
});

test('le code engendré n\'a AUCUNE barre oblique inverse', () => {
  // Il vit dans un gabarit : `\w` y est une séquence d'échappement invalide, et le fichier meurt
  // à la génération, pas à la lecture.
  assert.equal(/\\/.test(codeSeul(desk.mainJsDesktop())), false);
  assert.equal(/\\/.test(codeSeul(desk.preloadJsDesktop())), false);
});

test('chaque canal appelé par preload.js a un gestionnaire dans main.js', () => {
  const preload = wrapper['preload.js'];
  const main = wrapper['main.js'];
  const sync = [...preload.matchAll(/sendSync\('([a-z:-]+)'/g)].map((m) => m[1]);
  assert.ok(sync.length >= 8, 'le pont n\'appelle presque rien : ' + sync.join(', '));
  sync.forEach((canal) => {
    assert.ok(main.includes("onSync('" + canal + "'"),
      'main.js n\'a pas de gestionnaire pour « ' + canal + ' » : la page attendra à jamais');
  });
  // Et le canal de Steam Input va dans l'autre sens : main.js émet, preload.js écoute.
  assert.ok(preload.includes("ipcRenderer.on('steam:input'") && main.includes("send('steam:input'"));
});

test('main.js répond TOUJOURS à un envoi synchrone', () => {
  // `e.returnValue` posé hors de toute branche : sinon un refus (cadre étranger, nom invalide)
  // laisserait la page suspendue.
  const main = wrapper['main.js'];
  assert.ok(/let r = fallback;[\s\S]{0,260}e\.returnValue = r;/.test(main));
});

test('seul un cadre servi par jeu:// est écouté, et les noms passent une liste blanche', () => {
  const main = wrapper['main.js'];
  assert.ok(/senderFrame/.test(main) && /indexOf\('jeu:\/\/'\) === 0/.test(main));
  assert.ok(/STEAM_NAME = \/\^\[A-Za-z0-9_\.-\]\{1,128\}\$\//.test(main));
  // Un nom de sauvegarde ne contient ni séparateur ni point double : il ne sort pas du dossier.
  assert.ok(/SAVE_NAME = \/\^jeu3d-\[A-Za-z0-9_-\]\{1,80\}\[\.\]json\$\//.test(main));
});

test('Node n\'est toujours PAS exposé, et le pont ne touche ni fs ni steamworks', () => {
  const main = wrapper['main.js'];
  const preload = wrapper['preload.js'];
  assert.ok(/nodeIntegration:\s*false/.test(main) && /contextIsolation:\s*true/.test(main) && /sandbox:\s*true/.test(main));
  assert.equal(/require\('(node:)?fs'\)|require\('steamworks\.js'\)/.test(preload), false,
    'le preload donne le disque ou le SDK à la page');
});

test('Steam est facultatif : le chargement du SDK est dans un try', () => {
  const main = wrapper['main.js'];
  const i = main.indexOf("require('steamworks.js')");
  assert.ok(i !== -1);
  assert.ok(/try\{[^}]*$/.test(main.slice(Math.max(0, i - 120), i)),
    'steamworks.js est chargé hors de tout try : sans Steam, le jeu ne démarre plus');
  assert.ok(/electronEnableSteamOverlay/.test(main));
});

test('package.json embarque steamworks.js et dépaquette son dossier natif', () => {
  const pkg = JSON.parse(wrapper['package.json']);
  assert.ok(pkg.dependencies['steamworks.js'], 'en devDependencies il n\'entrerait pas dans le binaire');
  assert.ok(pkg.build.asarUnpack.some((g) => g.includes('steamworks.js')),
    'sans asarUnpack, le module natif et steam_api64.dll restent dans l\'archive : Steam ne s\'initialise pas');
  assert.ok(pkg.build.files.includes('steam_input.json'), 'main.js lit steam_input.json dans le binaire');
  assert.equal(pkg.build.files.some((f) => f.includes('steam_appid')), false,
    'steam_appid.txt ne doit pas entrer dans le binaire livré');
});

test('le ZIP contient les fichiers Steam, et le LISEZMOI les explique', () => {
  ['steam_appid.txt', 'steam_input.json', 'steam/game_actions.vdf'].forEach((f) => {
    assert.ok(f in wrapper, f + ' manque à l\'enveloppe');
  });
  assert.match(wrapper['steam_appid.txt'], /^480\n$/);
  assert.match(wrapper['LISEZMOI.md'], /Steam Cloud/);
  assert.match(wrapper['LISEZMOI.md'], /game_actions\.vdf/);
});

// ---------- 2. Les actions déclarées à Steam Input ----------

test('seules les actions aux noms valides sont déclarées', () => {
  const def = JSON.parse(wrapper['steam_input.json']);
  assert.deepEqual(def.digital, ['jump', 'interact'],
    '« bad-name » et « 9lives » seraient refusés par Steam et invalideraient tout le fichier');
  assert.deepEqual(def.analog, ['Move', 'Look']);
  assert.equal(def.set, 'InGame');
});

test('sans source analogique dans le projet, aucun stick n\'est déclaré', () => {
  const sans = desk.desktopWrapperFiles('X', {inputs: {actions: {jump: [' ']}, axes: {h: ['l', 'r']}}});
  assert.deepEqual(JSON.parse(sans['steam_input.json']).analog, []);
  assert.equal(/StickPadGyro/.test(sans['steam/game_actions.vdf']), false);
});

test('sans table d\'entrées, l\'export reste valide et muet', () => {
  const rien = desk.desktopWrapperFiles('X');
  const def = JSON.parse(rien['steam_input.json']);
  assert.deepEqual(def, {set: 'InGame', digital: [], analog: []});
});

test('le VDF déclare les actions, leurs libellés, en anglais ET en français', () => {
  const vdf = wrapper['steam/game_actions.vdf'];
  assert.match(vdf, /"jump"\t"#Action_jump"/);
  assert.match(vdf, /"Move"/);
  assert.match(vdf, /"english"/);
  assert.match(vdf, /"french"/);
  assert.equal((vdf.match(/{/g) || []).length, (vdf.match(/}/g) || []).length, 'accolades déséquilibrées');
});

test('l\'export bureau passe la table d\'entrées du projet', () => {
  assert.ok(/desktopWrapperFiles\(name, \{inputs: project\.inputs/.test(lire('js/build.js')),
    'js/build.js n\'envoie plus project.inputs : Steam Input ne déclarera aucune action');
});

// ---------- 3. Le jeu sans Steam ----------

test('hors Steam, api.steam est INERTE et ne lève jamais', () => {
  withBridge(undefined, () => {
    delete globalThis.bureau;
    const api = bridge.makeSteamApi();
    assert.equal(api.available(), false);
    assert.equal(api.unlockAchievement('ACH_X'), false);
    assert.equal(api.isAchievementUnlocked('ACH_X'), false);
    assert.equal(api.addStat('kills', 1), 0);
    assert.equal(api.getStat('kills'), 0);
    assert.equal(api.setStat('kills', 4), false);
    assert.equal(api.controller(), '');
    assert.equal(api.playerName(), '');
    assert.equal(api.onDeck(), false);
  });
});

test('dans l\'application SANS client Steam, le pont dit available:false et tout reste inerte', () => {
  const b = fakeBridge();
  b.steam.available = false;
  withBridge(b, () => {
    const api = bridge.makeSteamApi();
    assert.equal(api.available(), false);
    assert.equal(api.unlockAchievement('ACH_X'), false);
    assert.deepEqual(b.calls, [], 'rien ne doit traverser le pont quand Steam est absent');
  });
});

// ---------- 4. Le jeu avec Steam ----------

test('avec Steam, succès et statistiques traversent le pont', () => {
  const b = fakeBridge();
  withBridge(b, () => {
    const api = bridge.makeSteamApi();
    assert.equal(api.available(), true);
    assert.equal(api.unlockAchievement('ACH_BOSS_1'), true);
    assert.equal(api.isAchievementUnlocked('ACH_DONE'), true);
    assert.equal(api.isAchievementUnlocked('ACH_NOPE'), false);
    assert.equal(api.addStat('kills'), 1, 'delta par défaut : 1');
    assert.equal(api.addStat('kills', 4), 5);
    assert.equal(api.setStat('floors', 7.9), true);
    assert.equal(b.stats.floors, 7, 'les statistiques sont ENTIÈRES : 7,9 devient 7');
    assert.equal(api.getStat('kills'), 5);
    assert.equal(api.playerName(), 'Aventurière');
    assert.equal(api.language(), 'french');
    assert.equal(api.onDeck(), true);
  });
  assert.deepEqual(b.calls, [['unlock', 'ACH_BOSS_1']]);
});

test('un nom invalide est refusé AVANT de traverser le pont, avec un avertissement', () => {
  const b = fakeBridge();
  const warns = [];
  withBridge(b, () => {
    const api = bridge.makeSteamApi((m) => warns.push(m));
    ['', 'a b', '../x', 'é', null, 42].forEach((nom) => {
      assert.equal(api.unlockAchievement(nom), false);
    });
    assert.equal(api.setStat('ok', 'abc'), false);
    assert.equal(api.addStat('ok', NaN), 0);
  });
  assert.deepEqual(b.calls, [], 'un nom invalide a atteint Steam');
  assert.ok(warns.length >= 6, 'le script fautif ne saurait pas pourquoi rien ne se passe');
});

test('controller() rend le type de manette de la dernière photo Steam Input', () => {
  const b = fakeBridge();
  b.steam.input = () => ({type: 'PS5Controller', digital: {}, analog: {}});
  withBridge(b, () => assert.equal(bridge.makeSteamApi().controller(), 'PS5Controller'));
});

// ---------- 5. Les sauvegardes ----------

/** Un localStorage factice, posé le temps d'un test. */
function withStorage(initial, fn){
  const data = Object.assign({}, initial);
  const before = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; }
  };
  try{ return fn(data); } finally{ if(before === undefined) delete globalThis.localStorage; else globalThis.localStorage = before; }
}

test('nom de fichier cloud : caractères sûrs, jamais de séparateur', () => {
  assert.equal(bridge.cloudFileOf('slot1'), 'jeu3d-slot1.json');
  assert.equal(bridge.cloudFileOf(), 'jeu3d-defaut.json');
  assert.match(bridge.cloudFileOf('../../etc/passwd'), /^jeu3d-[A-Za-z0-9_-]+\.json$/);
  assert.ok(bridge.cloudFileOf('x'.repeat(500)).length <= 'jeu3d-.json'.length + 80);
});

test('sans pont, les sauvegardes restent dans localStorage — comme avant', () => {
  delete globalThis.bureau;
  withStorage({}, (data) => {
    assert.equal(bridge.writeSave('a', '{"n":1}'), true);
    assert.equal(data['jeu3d:a'], '{"n":1}');
    assert.equal(bridge.readSave('a'), '{"n":1}');
    assert.equal(bridge.readSave('absent'), null);
    bridge.removeSave('a');
    assert.equal(bridge.readSave('a'), null);
  });
});

test('avec le pont, la sauvegarde va AUSSI dans le cloud, et le cloud gagne à la lecture', () => {
  const b = fakeBridge();
  withBridge(b, () => withStorage({'jeu3d:a': '{"old":true}'}, (data) => {
    assert.equal(bridge.readSave('a'), '{"old":true}', 'sans copie cloud : localStorage, pour ne pas perdre une partie d\'avant l\'export');
    bridge.writeSave('a', '{"new":true}');
    assert.equal(data['jeu3d:a'], '{"new":true}', 'localStorage reste écrit');
    assert.equal(b.files['jeu3d-a.json'], '{"new":true}', 'et le cloud aussi');
    data['jeu3d:a'] = '{"stale":true}';
    assert.equal(bridge.readSave('a'), '{"new":true}', 'la copie du compte prime sur celle de la machine');
    bridge.removeSave('a');
    assert.equal('jeu3d-a.json' in b.files, false);
    assert.equal('jeu3d:a' in data, false);
  }));
});

test('un localStorage interdit n\'empêche pas la sauvegarde cloud', () => {
  const b = fakeBridge();
  const before = globalThis.localStorage;
  globalThis.localStorage = {getItem: () => { throw new Error('interdit'); }, setItem: () => { throw new Error('interdit'); }, removeItem: () => {}};
  try{
    withBridge(b, () => {
      assert.equal(bridge.writeSave('a', '{}'), true);
      assert.equal(bridge.readSave('a'), '{}');
    });
    delete globalThis.bureau;
    assert.throws(() => bridge.writeSave('a', '{}'), /interdit/,
      'sans cloud ni localStorage, l\'échec doit remonter pour que api.save rende false');
  } finally{ if(before === undefined) delete globalThis.localStorage; else globalThis.localStorage = before; }
});

test('les DEUX moteurs passent par js/steam-bridge.js pour save/load/clearSave et offrent api.steam', () => {
  [['js/scripts.js', 'l\'éditeur'], ['js/game-runtime.js', 'le jeu publié']].forEach(([f, qui]) => {
    const src = codeSeul(lire(f));
    assert.ok(/from '\.\/steam-bridge\.js'/.test(src), qui + ' n\'importe plus js/steam-bridge.js');
    assert.ok(/writeSave\(name/.test(src) && /readSave\(name\)/.test(src) && /removeSave\(name\)/.test(src),
      qui + ' (' + f + ') écrit encore ses sauvegardes sans le cloud');
    assert.ok(/get steam\(\)\s*\{\s*return makeSteamApi/.test(src), qui + ' n\'offre plus api.steam');
    assert.equal(/localStorage\.(setItem|getItem|removeItem)\('jeu3d:'/.test(src), false,
      qui + ' (' + f + ') touche encore localStorage en direct : le cloud ne verra pas la sauvegarde');
    assert.ok(/'steam:' \+ name/.test(src), qui + ' ne lie plus les actions Steam aux actions du projet');
  });
});

test('le module est embarqué dans le build et chargé par les pages', () => {
  assert.ok(lire('js/build.js').includes("{src: 'js/steam-bridge.js'}"));
  assert.ok(lire('js/build.js').includes('src="steam-bridge.js"'));
  ['editor.html', 'game-preview.html', 'build-test/index.html'].forEach((f) => {
    assert.ok(lire(f).includes('steam-bridge.js'), f + ' ne charge pas js/steam-bridge.js');
  });
});

// ---------- 6. Steam Input ----------

const env = creerContexte(['js/gamepad-input.js', 'js/touch-input.js']);
const TABLE = {
  actions: {jump: [' ', 'pad:0'], interact: ['e']},
  axes: {horizontal: ['left', 'right', 'pad:axis0'], vertical: ['back', 'advance', 'pad:axis1-']}
};
function pushSteamInput(snapshot){
  env.bureau = {steam: {available: true, input: () => snapshot}};
}
function noPad(){ env.navigator = {getGamepads: () => []}; }

test('une action Steam tenue pose steam:<action>, et rien d\'autre', () => {
  noPad();
  pushSteamInput({type: 'PS5Controller', digital: {jump: true, interact: false}, analog: {}});
  const keys = new Set(['e']);
  env.pollGamepads(keys, TABLE);
  assert.ok(keys.has('steam:jump'));
  assert.equal(keys.has('steam:interact'), false, 'une action relâchée ne pose rien');
  assert.ok(keys.has('e'), 'les touches du clavier ne sont pas touchées');
});

test('quand Steam ne rend plus rien, ses touches s\'effacent', () => {
  noPad();
  const keys = new Set();
  pushSteamInput({digital: {jump: true}, analog: {}});
  env.pollGamepads(keys, TABLE);
  assert.ok(keys.has('steam:jump'));
  pushSteamInput({digital: {}, analog: {}});
  env.pollGamepads(keys, TABLE);
  assert.equal(keys.has('steam:jump'), false, 'sinon le personnage agit pour toujours');
  pushSteamInput(null);
  env.pollGamepads(keys, TABLE);
  assert.equal(keys.size, 0);
});

test('les sticks Move et Look alimentent les axes nommés, Y inversé comme pad:axis1-', () => {
  noPad();
  const keys = new Set();
  // Steam : Y positif vers le HAUT. Le moteur : positif vers le haut aussi, via « pad:axis1- ».
  pushSteamInput({digital: {}, analog: {Move: {x: 1, y: 1}}});
  env.pollGamepads(keys, TABLE);
  assert.ok(env.gamepadAxis('horizontal') > 0.99, 'Move.x à fond');
  assert.ok(env.gamepadAxis('vertical') > 0.99, 'pousser vers le haut doit AVANCER');
  pushSteamInput({digital: {}, analog: {Move: {x: -1, y: -1}}});
  env.pollGamepads(keys, TABLE);
  assert.ok(env.gamepadAxis('horizontal') < -0.99 && env.gamepadAxis('vertical') < -0.99);
});

test('la zone morte s\'applique aussi aux sticks de Steam Input', () => {
  noPad();
  pushSteamInput({digital: {}, analog: {Move: {x: 0.1, y: -0.1}}});
  env.pollGamepads(new Set(), TABLE);
  assert.equal(env.gamepadAxis('horizontal'), 0);
  assert.equal(env.gamepadAxis('vertical'), 0);
});

test('Steam Input COMPLÈTE la manette du navigateur : les deux coexistent', () => {
  pushSteamInput({digital: {jump: true}, analog: {}});
  env.navigator = {getGamepads: () => [{
    connected: true, mapping: 'standard',
    buttons: Array.from({length: 16}, (_, i) => ({pressed: i === 2, value: i === 2 ? 1 : 0})),
    axes: [0.5, 0, 0, 0]
  }]};
  const keys = new Set();
  env.pollGamepads(keys, TABLE);
  assert.ok(keys.has('steam:jump') && keys.has('pad:2'));
  assert.ok(env.gamepadAxis('horizontal') > 0.3, 'le stick du navigateur marche toujours');
});

test('hors Steam, pollGamepads ne change pas de comportement', () => {
  delete env.bureau;
  noPad();
  const keys = new Set(['pad:0', 'steam:jump']);
  assert.equal(env.pollGamepads(keys, TABLE), 0);
  assert.equal(keys.size, 0, 'les touches synthétiques d\'avant sont retirées');
});

test('le type de manette traverse jusqu\'à api.steam.controller()', () => {
  // Le même objet de photo sert à deux endroits : la boucle d'entrées et le choix des glyphes.
  const b = fakeBridge();
  b.steam.input = () => ({type: 'SteamDeckController', digital: {}, analog: {}});
  withBridge(b, () => assert.equal(bridge.makeSteamApi().controller(), 'SteamDeckController'));
});
