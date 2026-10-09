// La fixture du harnais de build doit être à la version COURANTE du format de project.
//
// POURQUOI. `build-test/` charge le vrai runtime avec `build-test/data.js`. Or le
// runtime n'appelle PAS `migrateProjectData` — et il a raison : un jeu publié reçoit
// toujours des données fraîches, produites par `buildDataProject()` au moment de
// l'export. Le runtime peut donc supposer le format current.
//
// Conséquence : une fixture périmée fait tester le runtime contre une shape de données
// qu'il ne rencontrera JAMAIS en vrai. Elle était restée en version 2 quand le format en
// était à 11 — neuf paliers de migration d'écart. Le harnais validait donc un chemin
// fictif, sans que rien ne le dise. C'est la même famille de défaut que le reste de cette
// vague : une garde qui ne peut pas échouer parce qu'elle regarde ailleurs.
//
// Ce test ne vérifie pas le CONTENU de la fixture — seulement qu'elle n'a pas décroché.
// Pour la régénérer, la faire passer par `migrateProjectData` du moteur plutôt que
// d'éditer le numéro à la main : c'est la chaîne réelle qui doit produire le résultat.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const racineMoteur = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function versionCouranteDuFormat(){
  const src = readFileSync(path.join(racineMoteur, 'js/serialization.js'), 'utf8');
  // La version écrite par buildDataProject() : c'est celle qu'un export produit.
  // `version:` suivi de `current:` : les réglages de projet ont quitté le premier
  // niveau (`projectName` avec eux), c'est `current` qui suit désormais la version.
  const m = src.match(/\n\s*version:\s*(\d+),\s*\n\s*current/);
  assert.ok(m, 'version du format introuvable dans buildDataProject() — '
    + 'ce test doit être remis en accord avec serialization.js');
  return Number(m[1]);
}

function versionDeLaFixture(){
  const src = readFileSync(path.join(racineMoteur, 'build-test/data.js'), 'utf8');
  const m = src.match(/"version"\s*:\s*(\d+)/);
  assert.ok(m, 'build-test/data.js ne déclare pas de version');
  return Number(m[1]);
}

test('la fixture du harnais suit la version courante du format', () => {
  const current = versionCouranteDuFormat();
  const fixture = versionDeLaFixture();
  assert.equal(fixture, current,
    'build-test/data.js est en v' + fixture + ' alors que le format current est v' + current
    + '. Le runtime ne migre pas — il n’en a pas besoin, un export est toujours frais — donc '
    + 'le harnais teste une shape de données qui n’arrive jamais en production. '
    + 'Régénérer en passant la fixture par migrateProjectData(), pas en éditant le numéro.');
});
