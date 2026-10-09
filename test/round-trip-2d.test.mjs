// L'aller-retour d'une scène 2D : register, relire, retrouver la même chose.
//
// Ces gardes viennent d'une famille de défauts qui rendait l'éditeur inutilisable pour un jeu 2D
// au-delà d'une seule session, et qu'AUCUN test ne voyait parce que le chemin d'enregistrement 2D
// n'était jamais rejoué. Mesuré dans le navigateur, pas déduit :
//
//   · Trois chemins de création 2D — la racine « Monde 2D », le dépôt d'une planche, la commande du
//     copilot — construisaient un `THREE.Group` SANS `userData.type`.
//   · `serializeObject` n'acceptait comme parent qu'un nœud ayant un type : le link de parenté de
//     chaque objet 2D partait donc à `null`.
//   · `rebuildTree` sautait sans un mot tout nœud de type inconnu.
//   · Détaché de sa racine, un nœud n'hérite plus de l'space « 2d » ; `addComponent` refuse alors
//     ses composants 2D, l'exception interrompt la reconstruction, et le reste de la scène part avec.
//   · Quatre composants 2D n'étaient de toute façon pas dans `syncComponents`.
//
// Résultat visible : un project 2D rouvert avait perdu décor, personnage et collisions. Et dans la
// session en cours tout marchait — c'est ce qui l'a rendu invisible si longtemps.
//
// Ces tests lisent le SOURCE. Le comportement complet demande three et un DOM ; ce qu'on peut
// garder ici, ce sont les invariants structurels dont chaque défaut ci-dessus était la violation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');

// Les données 2D persistées sur `userData`, et le composant qui doit les reprendre au chargement.
const DONNEES_2D = [
  ['sprite2d',     'SpriteRenderer'],
  ['animSprite',   'SpriteAnimator'],
  ['body2d',      'Rigidbody2D'],
  ['collider2d',   'Collider2D'],
  ['controller2d', 'CharacterController2D']
];

test('TOUTE donnee 2D serialisee redonne son COMPOSANT au chargement', () => {
  const ser = read('js/serialization.js');
  const mig = read('js/component-migration.js');
  const manques = [];
  for(const [key, component] of DONNEES_2D){
    // Écrite à l'enregistrement — plus À PLAT (docs/REVUE_2026-09-14.md § 5 point 6) : c'est le
    // composant qui écrit la donnée, dans `components[]`, une seule fois. `serializeObject` ne
    // doit donc PLUS la porter à plat ; c'est `double-stockage.test.mjs` qui garde cet invariant.
    if(new RegExp('\\b' + key + '\\s*:').test(ser)) manques.push(key + ' : encore écrit à plat par serializeObject, en double avec son composant');
    // …relue à la reconstruction, pour les projets d'avant la refonte ECS…
    if(!new RegExp('d\\.' + key).test(ser)) manques.push(key + ' : jamais relu par rebuildTree');
    // …et rendue à un composant, sans quoi l'inspecteur n'affiche plus rien alors que le jeu
    // continue de tourner sur les données brutes. C'est la shape la plus désorientante du défaut.
    if(!new RegExp('userData\\.' + key + '[\\s\\S]{0,120}' + component).test(mig)){
      manques.push(key + ' → ' + component + ' : absent de syncComponents');
    }
  }
  assert.deepEqual(manques, [],
    'Une donnée 2D enregistrée sans composant correspondant produit une scène qui TOURNE mais ne\n'
    + 's\'édite plus : la physique lit userData directement, l\'inspecteur ne montre rien.\n'
    + manques.join('\n'));
});

test('LES COMPOSANTS SONT AJOUTES APRES LE PARENTAGE, jamais avant', () => {
  const s = read('js/serialization.js');
  const i = s.indexOf('function rebuildTree');
  assert.notEqual(i, -1);
  const body = s.slice(i);
  const iParentage = body.indexOf('if(p) p.add(o);');
  const iComposants = body.indexOf('syncComponents(o)');
  assert.notEqual(iParentage, -1, 'le parentage a-t-il changé de shape ?');
  assert.notEqual(iComposants, -1, 'syncComponents a-t-il changé de nom ?');
  // L'space d'un nœud se lit en REMONTANT ses parents, et il n'est déclaré que sur la racine
  // « Monde 2D ». Appelé avant le parentage, `spaceOfNode` ne trouve rien, retombe sur « 3d », et
  // `addComponent` refuse tout composant 2D — en levant une exception qui emporte la reconstruction.
  assert.ok(iComposants > iParentage,
    'syncComponents est appelé AVANT le parentage (positions ' + iComposants + ' vs '
    + iParentage + '). Les composants 2D seront refusés : un nœud sans parent n\'a pas d\'space.');
  // Et le composant ne doit pas être posé dans la dispatch de type, qui court avant le parentage.
  const dispatch = body.slice(0, iParentage);
  assert.ok(!/addComponent\('(Camera2D|Tilemap2D|SpriteRenderer|Rigidbody2D|Collider2D|CharacterController2D|SpriteAnimator)'/.test(dispatch),
    'un composant 2D est ajouté dans la construction du nœud, donc avant le parentage');
});

test('UN NOEUD NE DISPARAIT PAS en silence, quoi qu il manque', () => {
  // `if(!o) return` sautait le nœud sans un mot, et ce silence est ce qui a caché toute la
  // famille : ses enfants perdaient leur parent, donc leur espace, donc leurs composants.
  //
  // La question a changé de forme avec le format à composants : il n'y a plus de « type
  // inconnu », il y a un PORTEUR qui a pu manquer (l'asset d'un modèle absent du projet).
  // `nodeOfComponents` rend alors un Group de substitution plutôt que rien, et l'appelant
  // avertit — c'est cette paire que ce test tient.
  const migration = read('js/component-migration.js');
  const corps = migration.slice(migration.indexOf('function nodeOfComponents'));
  assert.ok(corps.indexOf('new THREE.Group()') !== -1,
    'nodeOfComponents ne pose plus de noeud de substitution : un porteur manquant ferait\n'
    + 'disparaitre le noeud ET toute sa descendance.');

  const s = read('js/serialization.js');
  const rebuild = s.slice(s.indexOf('function rebuildTree'), s.indexOf('function fileInB64'));
  const iAvertissement = rebuild.indexOf('fait.missing');
  assert.notEqual(iAvertissement, -1, 'rien ne relaie le porteur manquant');
  assert.ok(rebuild.slice(iAvertissement, iAvertissement + 400).indexOf('logConsole(') !== -1,
    'le porteur manquant doit AVERTIR, sinon le substitut cache le defaut a son tour');
});

test('UN PARENT COMPTE des qu il est un noeud, avec ou sans type', () => {
  const s = read('js/serialization.js');
  const corps = s.slice(s.indexOf('function serializeObject'), s.indexOf('function serializeTree'));
  // La règle ne regarde plus `userData.type` — que la racine « Monde 2D » n'avait pas, si bien
  // que chaque objet 2D était enregistré comme une racine, détachée du monde 2D. Elle demande
  // maintenant si le parent est un NŒUD, c'est-à-dire s'il porte un tableau de composants.
  assert.ok(corps.includes('parent: (o.parent && o.parent.userData && Array.isArray(o.parent.userData.components))'),
    'la parenté ne se lit pas sur les composants du parent');
  // Et surtout PAS isSceneObject : un template de prefab est sérialisé détaché de la scène,
  // donc hors index — sa parenté interne partirait à null.
  assert.equal(corps.includes('parent: (o.parent && isSceneObject'), false,
    'la parenté ne doit pas dependre de l index de scene');
  // Le drapeau `root2d` a disparu du format avec le monde 2D lui-même : il n'y a plus de
  // racine sous laquelle ranger les objets à sprite, donc plus rien à retrouver au rechargement.
  assert.equal(s.includes('root2d'), false,
    "la racine du monde 2D subsiste dans le format");
});

test('LA FACTORY pose userData.type, et elle seule cree des noeuds', () => {
  // Ce test nommait les quatre chemins de création 2D un par un, parce que chacun construisait
  // son nœud à la main et pouvait oublier le type. Depuis la tâche 3 il n'y a plus qu'un seul
  // chemin — createSceneNode — et l'invariant se vérifie donc en un seul endroit. Un nœud sans
  // `userData.type` est sauté par serializeObject (serialization.js:115) : il disparaît à la
  // réouverture du projet, avec ses enfants.
  const src = read('js/objects.js');
  const corps = src.slice(src.indexOf('function createSceneNode'),
                          src.indexOf('function removeSceneObject'));
  assert.match(corps, /userData\.type\s*=/,
    'createSceneNode ne pose plus de type : tout noeud neuf disparaitrait a la sauvegarde');
  assert.match(src, /const TYPE_NODE_DEFAULT = 'group'/,
    "le type par defaut doit rester 'group' : Component.markType ne retague que depuis celui-la");
});

test('UNE CAMERA 2D se reconstruit en ORTHOGRAPHIQUE, des deux cotes', () => {
  // Mesuré : la caméra rouverte était PERSPECTIVE et retournée de 180° sur Y, ce qui miroite
  // l'axe X — le personnage marchait à droite et le décor défilait à droite aussi, ce qu'on lit
  // comme « les commandes sont inversées ». La cause était la divergence entre les deux
  // reconstructions, l'éditeur et le jeu publié, chacune avec sa cascade.
  //
  // Elle ne peut plus se reproduire : il n'y a QU'UNE classe `Camera`, et c'est elle qui
  // construit la caméra three pour la projection relue — les deux côtés partagent ce code.
  const camera = read('js/components/component-camera.js');
  assert.ok(camera.includes('new THREE.OrthographicCamera'),
    'le composant Camera ne CONSTRUIT plus de camera orthographique');
  // La rotation de 180° reste réservée à la perspective : en orthographique elle inverse X.
  const iOrtho = camera.indexOf('new THREE.OrthographicCamera');
  const iPersp = camera.indexOf('new THREE.PerspectiveCamera');
  assert.ok(iOrtho !== -1 && iPersp !== -1 && iOrtho < iPersp,
    'les deux projections doivent etre construites au meme endroit');
  // L'AFFECTATION, pas la mention : le commentaire de la branche ortho dit précisément
  // « PAS de rotation.y », et le chercher tel quel ferait échouer le test sur son propre garde-fou.
  assert.equal(/^\s*cam\.rotation\.y = Math\.PI/m.test(camera.slice(iOrtho, iPersp)), false,
    'une camera orthographique retournee de 180 deg inverse l axe X');
  // Plus aucun composant `Camera2D` : la classe séparée est ce qui rendait la divergence
  // possible, et son fichier ne doit pas revenir par un merge.
  for(const f of ['js/objects.js', 'js/game-runtime.js']){
    assert.equal(read(f).includes("NodeShells.register('Camera2D'"), false,
      f + ' : un porteur pour Camera2D reintroduirait une camera construite hors du composant');
  }
  const objets = read('js/objects.js');
  const iPorteur = objets.indexOf("NodeShells.register('Camera'");
  assert.notEqual(iPorteur, -1, 'le porteur de la camera a disparu');
  assert.ok(objets.slice(iPorteur, iPorteur + 120).includes('makeCamera()'),
    'le porteur de la camera ne passe plus par makeCamera');
});
