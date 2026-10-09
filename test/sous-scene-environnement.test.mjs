// UNE SOUS-SCÈNE N'APPORTE JAMAIS SON ENVIRONNEMENT.
//
// `populateSubScene` ne lit que `data.objects` : le `data.env` de la scène source est ignoré —
// en silence. Le comportement est le BON (l'environnement appartient à la scène hôte, sinon
// instancier une sous-scène changerait le ciel), mais rien ne le disait ni ne le garantissait :
// une ligne ajoutée par mégarde dans populateSubScene aurait fait changer le ciel de la scène
// hôte à chaque rechargement d'une instance, et personne n'aurait su pourquoi.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'js', 'subscenes.js'), 'utf8');

/** Le corps de `populateSubScene`, commentaires retirés. */
function corpsPeuplement(){
  const i = src.indexOf('function populateSubScene(o){');
  assert.ok(i !== -1, 'populateSubScene introuvable — ce test ne mesure plus rien');
  const j = src.indexOf('\nfunction ', i + 10);
  return src.slice(i, j === -1 ? src.length : j)
    .split('\n').filter((l) => l.trim().indexOf('//') !== 0).join('\n');
}

test('populateSubScene ne lit RIEN de l environnement de la source', () => {
  const corps = corpsPeuplement();
  ['data.env', '.env.sky', 'applyEnvironment', 'env.post'].forEach((interdit) => {
    assert.equal(corps.indexOf(interdit), -1,
      'populateSubScene touche à « ' + interdit + ' » : l environnement de la scène hôte '
      + 'changerait en rechargeant une instance');
  });
});

test('la règle est ÉCRITE là où on serait tenté de l enfreindre', () => {
  const i = src.indexOf('function populateSubScene(o){');
  const entete = src.slice(Math.max(0, i - 900), i);
  assert.ok(/env/i.test(entete) && /hôte|hote/i.test(entete),
    'un commentaire doit dire, au-dessus de populateSubScene, que l environnement appartient '
    + 'à la scène hôte — sinon la prochaine personne ajoutera la ligne de bonne foi');
});

test('sceneUsedAsSubScene dit qui instancie cette scène', () => {
  assert.ok(src.indexOf('function sceneUsedAsSubScene(') !== -1,
    'le panneau Environnement doit pouvoir avertir quand la scène éditée sert de source');
});
