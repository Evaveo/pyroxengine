import { deEsm } from './engine-env.mjs';
// moteur/test/skinned-mesh-renderer.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const racineMoteur = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(racineMoteur, f), 'utf8');

function contexte(){
  const bac = { console, Math, JSON, Set, Map, Array, Object };
  bac.window = bac; bac.self = bac; bac.globalThis = bac;
  bac.isSceneObject = () => true;
  const ctx = vm.createContext(bac);
  vm.runInContext(deEsm(read('js/component-registry.js')), ctx, { filename: 'js/component-registry.js' });
  vm.runInContext(deEsm(read('js/component.js')), ctx, { filename: 'js/component.js' });
  vm.runInContext(deEsm(read('js/node.js')), ctx, { filename: 'js/node.js' });
  vm.runInContext(deEsm(read('js/components/component-skinned-mesh.js')), ctx,
    { filename: 'js/components/component-skinned-mesh.js' });
  // skinnedMeshRendererOf vit dans js/anim-models.js (voisin de skeletonOf) ; on ne charge que
  // la fonction testée, pas tout le fichier (qui a besoin de THREE).
  vm.runInContext(
    'function skinnedMeshRendererOf(o){\n' +
    '  let trouve = null;\n' +
    '  if(o && o.traverse) o.traverse(function(x){\n' +
    '    if(!trouve && x.getComponent){ const c = x.getComponent(\'SkinnedMeshRenderer\'); if(c) trouve = c; }\n' +
    '  });\n' +
    '  return trouve;\n' +
    '}', ctx, { filename: 'skinnedMeshRendererOf-sous-test' });
  return ctx;
}

// Un noeud minimal, avec juste assez de THREE pour traverse().
function noeudArbre(enfants){
  const o = { userData: {}, children: enfants || [] };
  o.traverse = function(cb){
    cb(o);
    o.children.forEach(function(e){ e.traverse ? e.traverse(cb) : cb(e); });
  };
  return o;
}

test('skinnedMeshRendererOf rend null sur un sous-arbre sans SkinnedMeshRenderer', () => {
  const ctx = contexte();
  const racine = noeudArbre([noeudArbre([])]);
  ctx.applyNodeMixin(racine);
  racine.children.forEach((e) => ctx.applyNodeMixin(e));
  assert.equal(ctx.skinnedMeshRendererOf(racine), null);
});

test('skinnedMeshRendererOf rend le PREMIER composant rencontré (body avant vêtements)', () => {
  const ctx = contexte();
  const body = noeudArbre([]);
  const vetements = noeudArbre([]);
  const racine = noeudArbre([body, vetements]);
  ctx.applyNodeMixin(racine);
  ctx.applyNodeMixin(body);
  ctx.applyNodeMixin(vetements);
  const cBody = body.addComponent('SkinnedMeshRenderer', {});
  vetements.addComponent('SkinnedMeshRenderer', {});
  assert.equal(ctx.skinnedMeshRendererOf(racine), cBody);
});

test('SkinnedMeshRenderer serialize()/hydrate() portent externalClips', () => {
  const ctx = contexte();
  const o = noeudArbre([]);
  ctx.applyNodeMixin(o);
  const c = o.addComponent('SkinnedMeshRenderer', {});
  // JSON.stringify plutôt que assert.deepEqual : les tableaux créés dans le contexte vm sont
  // des Array « étrangers » (autre realm), que deepEqual refuse de comparer par structure.
  assert.equal(JSON.stringify(c.serialize()), JSON.stringify({ externalClips: [] }));
  c.hydrate({ externalClips: [{assetId:'a1', sourceClip:'mixamo.com', localName:'walking'}] });
  assert.equal(c.serialize().externalClips.length, 1);
});

// Régression : createForm() appelle sections(ref) avec ref===null lors du tout premier build
// (avant le premier setTargets, voir js/ui/form.js:createForm / js/ui/form-plan.js:planForm).
// Le panneau SkinnedMeshRenderer n'avait pas la garde `if(!c) return [];` que tous les autres
// panneaux à sections dynamiques ont (ex: Script, AnimatorController) : il déréférençait
// `c.node`/`c.skeleton` sur null, ce qui levait une exception non rattrapée dans buildInspector()
// et empêchait Panels.boot(...) et syncInspector() de s'exécuter ensuite (carte du composant
// visible mais vide, section "Modèle importé" disparue).
test('le panneau SkinnedMeshRenderer.sections(null) ne lève pas et rend un tableau vide', () => {
  const bac = { console, Math, JSON, Set, Map, Array, Object };
  bac.window = bac; bac.self = bac; bac.globalThis = bac;
  bac.ComponentViews = { registerPanel: function(){} };
  const ctx = vm.createContext(bac);
  vm.runInContext(deEsm(read('js/ui/panels-components.js')), ctx, { filename: 'js/ui/panels-components.js' });
  // `ComponentPanels` est déclaré en `const` de niveau module : il ne devient pas une propriété
  // de l'objet contextifié, mais reste accessible depuis une exécution suivante dans le même
  // contexte (portée lexicale partagée entre appels vm.runInContext successifs).
  const descripteur = vm.runInContext('ComponentPanels.SkinnedMeshRenderer', ctx);
  assert.ok(descripteur, 'le panneau SkinnedMeshRenderer doit être enregistré');
  // JSON.stringify plutôt que deepEqual : le tableau vient d'un autre realm vm (voir commentaire
  // plus haut sur externalClips).
  assert.equal(JSON.stringify(descripteur.sections(null)), '[]');
});
