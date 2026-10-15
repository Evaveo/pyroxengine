// LE PANNEAU ENVIRONNEMENT NE GARDE PLUS L'OBJET `env` DU DÉMARRAGE (v1.13.1).
//
// Bug signalé six fois : projet ouvert avec le panneau Environnement fermé ou dans un onglet de
// fond → le panneau affichait les valeurs par défaut, et ses réglages n'avaient aucun effet.
// Deux causes, deux gardes :
//  1. `applyEnvironment(fresh)` RÉAFFECTAIT `env` : le panneau visait l'ancien objet.
//     → `env` est un `const`, rempli sur place.
//  2. `Panels.syncAll()` saute les panneaux masqués, et `setVisible(true)` ne resynchronisait
//     rien → le panneau rouvert gardait cible et champs d'avant le chargement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { creerContexte } from './engine-env.mjs';

const src = readFileSync(new URL('../js/environment.js', import.meta.url), 'utf8');

test('env est un const, jamais reaffecte', () => {
  assert.match(src, /export const env = /);
  assert.doesNotMatch(src, /^\s*env\s*=[^=]|[;{)]\s*env\s*=[^=]/m, 'une réaffectation de env réintroduit le bug');
});

test('applyEnvironment copie fresh avant de vider env (fresh peut etre env)', () => {
  const corps = src.slice(src.indexOf('export function applyEnvironment'));
  assert.ok(corps.indexOf('const next') < corps.indexOf('delete env[k]'));
});

test('un panneau masque au chargement est resynchronise a son affichage', () => {
  const ctx = creerContexte(['js/ui/registry.js', 'js/ui/form-plan.js', 'js/ui/fields.js',
                             'js/ui/form.js', 'js/ui/panel.js', 'js/history.js']);
  const host = ctx.document.createElement('div');
  ctx.document.body.appendChild(host);
  let cible = { a: 1 };   // l'objet du démarrage
  ctx.Panels.register({ id: 'env', sections: [{ id: 's', fields: [
    { key: 'a', label: 'A', type: 'number' } ]}], targets: () => [cible] });
  ctx.Panels.boot({ env: host });
  ctx.Panels.setVisible('env', false);
  // Chargement d'un projet pendant que le panneau est masqué : syncAll le saute.
  cible = { a: 7 };
  ctx.Panels.syncAll();
  ctx.Panels.setVisible('env', true);
  assert.equal(Number(ctx.document.getElementById('f-a').value), 7, 'le champ montre le projet');
});
