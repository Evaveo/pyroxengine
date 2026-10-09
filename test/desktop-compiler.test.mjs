// Le lien pyrox-build:// et son installeur (js/desktop-compiler.js). Les scripts produits ne
// s'exécutent pas ici (ils touchent au registre) : on vérifie ce qui les casserait en silence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileUrl, HANDLER_PS1, windowsCompilerInstaller } from '../js/desktop-compiler.js';
import { packageJsonDesktop } from '../js/build-desktop.js';

test('le lien ne transporte qu\'un slug valide', function(){
  assert.equal(compileUrl('mon-jeu'), 'pyrox-build://compile/mon-jeu');
  for(const bad of ['', '../x', 'a b', 'A', 'x&calc', 'a'.repeat(65)]){
    assert.throws(function(){ compileUrl(bad); });
  }
});

test('le lanceur est en ASCII (Windows PowerShell 5.1 lit un .ps1 sans BOM en page locale)', function(){
  assert.ok(/^[\x00-\x7f]*$/.test(HANDLER_PS1));
});

test('l\'installeur transporte le lanceur intact et passe %%1 au lien', function(){
  const cmd = windowsCompilerInstaller();
  const b64 = cmd.split('\r\n').filter(function(l){ return l.startsWith('>>'); })
    .map(function(l){ return l.split(' echo ')[1]; }).join('');
  assert.equal(Buffer.from(b64, 'base64').toString('ascii'), HANDLER_PS1);
  assert.ok(cmd.includes('\\"%%1\\"'));
  assert.ok(cmd.split('\r\n').every(function(l){ return l.length < 1000; }));
});

test('la signature passe dans package.json par le nom du certificat, sans secret', function(){
  const signed = JSON.parse(packageJsonDesktop('Jeu', 'Studio', 'Mon Studio SAS'));
  assert.deepEqual(signed.build.win.signtoolOptions, {certificateSubjectName: 'Mon Studio SAS'});
  const bare = JSON.parse(packageJsonDesktop('Jeu', 'Studio'));
  assert.equal(bare.build.win.signtoolOptions, undefined);
});

test('la cible Steam a son lien, et le lanceur la compile en dossier sans installeur', function(){
  assert.equal(compileUrl('mon-jeu', 'steam'), 'pyrox-build://steam/mon-jeu');
  assert.throws(function(){ compileUrl('mon-jeu', 'mac'); });
  assert.ok(HANDLER_PS1.includes('(compile|steam)'));
  assert.ok(HANDLER_PS1.includes('--win dir'));
  assert.ok(HANDLER_PS1.includes('win-unpacked'));
});
