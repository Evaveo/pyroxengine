// moteur/test/scene-index.test.mjs
//
// L'invariant d'appartenance à la scène : `objects` et `_indexObjects` ne doivent JAMAIS
// diverger. Ce fichier existe parce que la divergence est SILENCIEUSE — `objects.push(n)` au
// lieu de `addSceneObject(n)` produit un nœud qui vit dans la scène, se rend à l'écran, et
// qu'aucune vue ne montre : la hiérarchie le filtre (`isSceneObject`) et le Registry refuse
// d'indexer ses composants (`_isNodeInScene`). Mesuré : la caméra 2D et la tilemap créées par
// la barre 2D étaient invisibles dans la hiérarchie ET hors de l'ECS, sans une seule erreur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Tous les fichiers .js de moteur/js, récursivement, chemin relatif à moteur/. */
function filesJs(dir){
  const out = [];
  readdirSync(path.join(root, dir), { withFileTypes: true }).forEach((e) => {
    const rel = dir + '/' + e.name;
    if(e.isDirectory()) out.push(...filesJs(rel));
    else if(e.name.endsWith('.js')) out.push(rel);
  });
  return out;
}

test('objects.push n apparait nulle part hors de objects.js', () => {
  const coupables = [];
  filesJs('js').forEach((f) => {
    if(f === 'js/objects.js') return;
    const src = readFileSync(path.join(root, f), 'utf8');
    src.split('\n').forEach((ligne, i) => {
      // `game.objects.push` du runtime est un AUTRE tableau (la scène du jeu exporté, qui a son
      // propre index) : on ne vise que le tableau global de l'éditeur.
      if(/(^|[^.\w])objects\.push\s*\(/.test(ligne)) coupables.push(f + ':' + (i + 1));
    });
  });
  assert.deepEqual(coupables, [],
    'ces lignes muteraient `objects` sans indexer : utiliser addSceneObject / createSceneNode');
});

import vm from 'node:vm';
import { creerContexte } from './engine-env.mjs';

const read = (f) => readFileSync(path.join(root, f), 'utf8');

// ⚠️ NE PAS écrire un bac à sable `vm` à la main pour charger `js/objects.js` : il appelle
// `refreshTypesCreatable()` au chargement (objects.js:535), qui fait
// `document.getElementById(...)` (objects.js:166) — un contexte sans DOM échoue par
// `document is not defined`. `creerContexte` fournit le DOM factice.
function contexte(){
  const ctx = creerContexte(['js/component-registry.js', 'js/component.js', 'js/node.js', 'js/objects.js']);
  // `scene` vit dans js/scene.js, qui traîne tout le renderer derrière lui : le contexte de
  // test se contente d'une racine THREE, seul usage qu'en fait createSceneNode.
  vm.runInContext('var scene = new THREE.Scene();', ctx);
  return ctx;
}

test('createSceneNode indexe le noeud et pose ses composants', () => {
  const ctx = contexte();
  vm.runInContext(
    'Registry.registerClass(class extends Component {' +
    '  static get typeName(){ return "Ressort"; }' +
    '  static get icon(){ return "🌀 "; }' +
    '});', ctx);

  const n = ctx.createSceneNode({ name: 'Test', components: [{ type: 'Ressort' }] });

  assert.equal(ctx.isSceneObject(n), true, 'le noeud doit etre dans l index');
  // Le vrai tableau est le `const objects` d'objects.js, PAS `ctx.objects` : un `const` de
  // haut niveau ne devient pas une propriété du global, si bien que le bouchon `objects: []`
  // du harnais reste visible de l'extérieur alors que le code testé nourrit le sien.
  const tableau = vm.runInContext('objects', ctx);
  assert.equal(tableau.indexOf(n) !== -1, true, 'et dans le tableau');
  assert.equal(n.name, 'Test');
  assert.notEqual(n.getComponent('Ressort'), null, 'le composant doit etre pose');
  // Le point qui manquait : le composant DOIT etre visible du Registry, sinon aucun Systeme
  // ne le verra jamais.
  assert.equal(ctx.Registry.activeNodes('Ressort').indexOf(n) !== -1, true,
    'le composant doit etre livre par le Registry');
});

test('createSceneNode ne connait aucun type d objet', () => {
  // Ouverture/fermeture : ajouter un type de noeud ne doit jamais rouvrir la factory.
  const src = read('js/objects.js');
  const corps = src.slice(src.indexOf('function createSceneNode'),
                          src.indexOf('function removeSceneObject'));
  assert.equal(/'camera'|'tilemap'|'mesh'|'group'/.test(corps), false,
    'createSceneNode nomme un type d objet : la factory doit rester generique');
});

test('la notion d espace 2d/3d a disparu du moteur', () => {
  // Un seul monde. La séparation 2D/3D était une seconde scène dans la scène : un espace
  // déclaré sur la racine « Monde 2D », hérité en remontant les parents, et un refus dans
  // `addComponent` — d'où des composants qu'on ne pouvait pas poser, un reparentage refusé, et
  // un dépôt d'asset qui exigeait d'être dans le bon onglet.
  const restes = [];
  filesJs('js').forEach((f) => {
    const src = readFileSync(path.join(root, f), 'utf8');
    if(/spaceOfNode|spacesCompatible|refusalSpace|static get space|userData\.root2d/.test(src)){
      restes.push(f);
    }
  });
  assert.deepEqual(restes, [], 'un seul monde : ces fichiers portent encore la separation');
});
