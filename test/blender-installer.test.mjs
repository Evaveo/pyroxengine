// Le script « Installer et ouvrir Blender » que l'Atelier fabrique. Il s'exécute sur la machine de
// l'utilisateur : ce test vérifie qu'aucune valeur venue de la page ne peut y devenir une commande,
// qu'il n'écrit que dans le profil de l'utilisateur (HKCU, jamais HKLM), et que le code Python
// passé à Blender est bien du Python.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const inst = await import('../js/blender-installer.js');
const OK = {zipUrl: 'https://editeur.exemple.test/exemples/blender/evaveo_blender_bridge.zip',
  token: 'AbCdEfGhIjKlMnOpQrStUvWx-_12', origin: 'https://editeur.exemple.test'};

test('le code Python tient sur une ligne sans caractère que cmd ou sh interpréteraient', () => {
  assert.ok(!/["$%`\n]/.test(inst.INSTALL_PYTHON));
  assert.match(inst.INSTALL_PYTHON, /sys\.argv\.index\('--'\)/, 'les paramètres arrivent après --');
});

test('le code Python est du Python valide', (t) => {
  const r = spawnSync('python', ['-c', 'import ast,sys; ast.parse(sys.argv[1])', inst.INSTALL_PYTHON], {encoding: 'utf8'});
  if(r.error){ t.skip('python absent'); return; }
  assert.equal(r.status, 0, r.stderr);
});

test('Windows : addon installé, lien evaveo-blender:// dans HKCU seulement, Blender ouvert', () => {
  const s = inst.windowsInstaller(OK);
  assert.ok(s.includes('"' + OK.zipUrl + '" "' + OK.token + '" "' + OK.origin + '"'));
  assert.match(s, /reg add "HKCU\\Software\\Classes\\evaveo-blender"/);
  assert.ok(!/HKLM|HKEY_LOCAL_MACHINE/.test(s), 'jamais de droits machine');
  assert.match(s, /--python-exit-code 1/);
  assert.match(s, /start "" "%BLENDER%"/);
  assert.ok(s.includes('\r\n'), 'un .cmd en fins de ligne Windows');
});

test('macOS / Linux : même installation, lien par xdg-mime sous Linux', () => {
  const s = inst.unixInstaller(OK);
  assert.match(s, /^#!\/bin\/sh/);
  assert.match(s, /xdg-mime default evaveo-blender\.desktop x-scheme-handler\/evaveo-blender/);
  assert.ok(s.includes(OK.token));
});

test('une valeur qui casserait le script est REFUSÉE, pas échappée', () => {
  const bad = [
    {zipUrl: 'https://x.test/a.zip" & del /q C:\\*'},
    {zipUrl: 'https://x.test/%PATH%.zip'},
    {zipUrl: 'file:///C:/a.zip'},
    {token: 'court'},
    {token: 'jeton"avec&guillemets-1234567'},
    {origin: 'https://x.test/chemin'},
    {origin: 'https://x.test$(rm -rf ~)'}
  ];
  for(const b of bad){
    assert.throws(() => inst.windowsInstaller(Object.assign({}, OK, b)), /invalide/);
    assert.throws(() => inst.unixInstaller(Object.assign({}, OK, b)), /invalide/);
  }
});

test('plateforme et nom de fichier', () => {
  assert.equal(inst.detectPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'windows');
  assert.equal(inst.detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)'), 'mac');
  assert.equal(inst.detectPlatform('Mozilla/5.0 (X11; Linux x86_64)'), 'linux');
  assert.match(inst.installerFor('windows', OK).name, /\.cmd$/);
  assert.match(inst.installerFor('mac', OK).name, /\.sh$/);
});

test('un jeton neuf est accepté par le script, et jamais deux fois le même', () => {
  const a = inst.newBlenderToken(), b = inst.newBlenderToken();
  assert.notEqual(a, b);
  assert.doesNotThrow(() => inst.windowsInstaller(Object.assign({}, OK, {token: a})));
});
