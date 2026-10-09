// moteur/test/double-stockage.test.mjs
//
// LA CAUSE RACINE de docs/REVUE_2026-09-14.md (§ 2 cause 2, § 5 points 1 et 4, plan point 6) :
// le format écrivait la MÊME information deux fois — un sac à plat (`phys`, `collider`,
// `audio`, `sprite2d`…) ET l'entrée du composant qui la possède — sans que rien ne réconcilie
// les deux le jour où elles diffèrent.
//
// Ce fichier fixe la décision et la mesure :
//
//   1. LE COMPOSANT EST LA SEULE VÉRITÉ. Les treize sacs qu'un composant possède ne sont plus
//      écrits à plat. Un fichier ne peut donc plus se contredire lui-même.
//   2. LES SACS À PLAT RESTENT RELUS, mais UNIQUEMENT quand le fichier ne nomme pas le
//      composant propriétaire — c'est le chemin des projets d'avant la refonte ECS. Un sac
//      périmé ne peut plus écraser la valeur du composant.
//   3. LA RECONSTRUCTION N'EST PLUS EXCLUSIVE. `applyComponents` puis `syncComponents`, et non
//      l'un OU l'autre : un nœud dont le fichier ne liste pas un composant pourtant posé par
//      défaut (makePrimitive) restait sinon sur un sac orphelin — l'inspecteur éditait un
//      objet, la simulation en lisait un autre (§ 5 point 4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');

/** Les sacs qu'un composant possède : ceux qui ne doivent plus être écrits à plat. */
const SACS_POSSEDES = ['phys', 'collider', 'scripts', 'audio', 'part', 'uiDoc', 'animator',
  'sprite2d', 'animSprite', 'body2d', 'collider2d', 'controller2d', 'events'];

/**
 * Les sacs à plat qui RESTENT écrits, chacun avec la raison. Aucun composant ne les possède :
 * les retirer perdrait vraiment la donnée, au lieu de retirer un doublon.
 */
const SACS_SANS_COMPOSANT = {
  game: 'calque, tag, propriétés de jeu — porté par le nœud, aucun composant ne le possède',
  detail: 'distance de disparition (LOD) — réglage du nœud',
  prefabId: 'provenance de prefab — identité du nœud, pas un composant',
  materialId: 'référence de matériau — lue par rebuildTree avant les composants',
  lightmapAtlas: 'rangement des UV dans l\'atlas — propriété du maillage, pas d\'un composant'
};

const corpsSerializeObject = (() => {
  const src = read('js/serialization.js');
  return src.slice(src.indexOf('export function serializeObject'),
                   src.indexOf('export function serializeTree'));
})();

SACS_POSSEDES.forEach(function(sac){
  test('le sac « ' + sac + ' » n\'est plus écrit à plat : son composant le porte', () => {
    const ecriture = new RegExp('^\\s*' + sac + ':\\s', 'm');
    assert.equal(ecriture.test(corpsSerializeObject), false,
      'serializeObject écrit encore « ' + sac + ' » à plat, alors que son composant l\'écrit '
      + 'déjà dans components[]. Deux vérités pour la même donnée, que rien ne réconcilie : '
      + 'c\'est la cause racine de « les datas sont perdues ou mal placées ».');
  });
});

test('les sacs SANS composant, eux, sont toujours écrits', () => {
  // Le garde-fou symétrique : sans lui, ce fichier encouragerait à tout retirer, y compris ce
  // qu'aucun composant ne sait reconstruire.
  Object.keys(SACS_SANS_COMPOSANT).forEach(function(sac){
    assert.match(corpsSerializeObject, new RegExp('^\\s*' + sac + ':\\s', 'm'),
      '« ' + sac + ' » a disparu du format alors qu\'aucun composant ne le porte ('
      + SACS_SANS_COMPOSANT[sac] + ')');
  });
});

test('la reconstruction n\'est plus exclusive : applyComponents PUIS syncComponents', () => {
  const src = read('js/serialization.js');
  assert.equal(
    /applyComponents\(o, d\.components\);\s*\n\s*else syncComponents\(o\);/.test(src), false,
    'le if/else exclusif est de retour : un nœud dont le fichier ne liste pas un composant '
    + 'pourtant posé par défaut reste sur un sac orphelin (§ 5 point 4)');
  assert.match(src, /applyComponents\(o, d\.components\);[\s\S]{0,800}?syncComponents\(o\);/,
    'syncComponents doit tourner APRÈS applyComponents, et non à sa place. Il est idempotent : '
    + 'chacune de ses branches est gardée par `!getComponent`.');
});

test('un sac à plat ne s\'applique que si le fichier ne nomme pas son composant', () => {
  // La règle qui rend la relecture déterministe, des deux côtés — éditeur et jeu publié.
  ['js/serialization.js', 'js/game-runtime.js'].forEach(function(f){
    assert.match(read(f), /bagsOverriddenBy|bagOverridden/,
      f + ' : rien ne protège les sacs à plat contre l\'écrasement du composant. Un projet '
      + 'd\'avant la refonte et un projet récent doivent se relire par la même règle.');
  });
});
