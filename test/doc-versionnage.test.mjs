// LA DOC DE VERSIONNAGE DOIT DÉSIGNER LA CONSTANTE QUI EXISTE.
//
// POURQUOI CE TEST EXISTE. ChangeLogs/VERSIONING.md a désigné pendant des versions la
// constante `VERSION_EDITEUR` dans `moteur/js/ui.js` — un nom et un fichier qui n'existent
// plus. Qui suit la doc à la lettre ne bumpe rien. Une doc fausse ne casse aucun test :
// celui-ci la mesure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(p, 'utf8');
// Dans le dépôt de travail, ChangeLogs/ est à côté de moteur/. Dans le miroir public
// (Evaveo/pyroxengine), le contenu de moteur/ devient la racine et ChangeLogs/ y est recopié.
const changeLogsDir = [path.join(root, 'ChangeLogs'), path.join(root, '..', 'ChangeLogs')]
  .find((d) => fs.existsSync(d)) ?? path.join(root, '..', 'ChangeLogs');

test('VERSIONING.md designe la constante de version reellement declaree', () => {
  const doc = read(path.join(changeLogsDir, 'VERSIONING.md'));
  const version = read(path.join(root, 'js', 'version.js'));

  assert.ok(version.includes('VERSION_ENGINE'),
    'js/version.js doit declarer VERSION_ENGINE');
  assert.ok(doc.includes('VERSION_ENGINE'),
    'VERSIONING.md doit citer VERSION_ENGINE');
  assert.ok(doc.includes('moteur/js/version.js'),
    'VERSIONING.md doit citer moteur/js/version.js');
  assert.ok(doc.includes('moteur/package.json'),
    'VERSIONING.md doit rappeler que package.json porte la MEME version');
  assert.ok(!doc.includes('VERSION_EDITEUR'),
    'VERSIONING.md cite encore VERSION_EDITEUR, qui n\'existe plus');
});

test('js/version.js et package.json portent la meme version', () => {
  const version = read(path.join(root, 'js', 'version.js'));
  const i = version.indexOf("VERSION_ENGINE = '");
  assert.ok(i !== -1, 'VERSION_ENGINE introuvable dans js/version.js');
  const declared = version.slice(i + "VERSION_ENGINE = '".length, version.indexOf("'", i + "VERSION_ENGINE = '".length));
  const pkg = JSON.parse(read(path.join(root, 'package.json')));
  assert.equal(pkg.version, declared,
    'package.json (' + pkg.version + ') et js/version.js (' + declared + ') ont divergé');
});
