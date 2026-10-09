// Régressions : api.setTile/tileAt visaient toujours la première carte ; api.spriteImage plantait
// sur une instance clonée d'un prefab (`_meshSprite` réduit en débris JSON par Object3D.clone).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { creerContexte } from './engine-env.mjs';

const ctx = creerContexte(['js/component-registry.js', 'js/component.js', 'js/node.js', 'js/component-data.js',
  'js/tile-palette.js', 'js/sprite-2d.js', 'js/anim-sprite.js', 'js/tilemap.js', 'js/components/component-sprite.js']);
vm.runInContext('var assets = [];', ctx);

function fakeMap(name, x){
  const n = new ctx.THREE.Group();
  n.name = name; n.position.x = x;
  const c = {cellSize: 1, originX: 0, originY: 0, width: 4, height: 4};
  n.getComponent = (t) => (t === 'Tilemap' ? c : null);
  n.updateMatrixWorld(true);
  return n;
}

test('aimCell2d respecte sa cible : nom, nœud, nœud parent', () => {
  const a = fakeMap('A', 0), b = fakeMap('B', 100);
  const parent = new ctx.THREE.Group(); parent.name = 'Grille'; parent.add(b);
  parent.updateMatrixWorld(true);
  const list = [a, parent, b];
  const p = {x: 101.5, y: -1.5};
  assert.equal(ctx.aimCell2d(ctx.THREE, 'B', p, null, list).node, b, 'par nom');
  assert.equal(ctx.aimCell2d(ctx.THREE, b, p, null, list).node, b, 'par nœud');
  assert.equal(ctx.aimCell2d(ctx.THREE, parent, p, null, list).node, b, 'par parent sans Tilemap');
  assert.equal(ctx.aimCell2d(ctx.THREE, 'Inconnu', p, null, list), null, 'nom inconnu : rien, pas la 1re carte');
  assert.equal(ctx.aimCell2d(ctx.THREE, {x: 1.5, y: -1.5}, undefined, null, list).node, a, 'point seul : 1re carte');
});

test('spriteImage sur un clone : maille recâblée, ressources propres, pas de doublon', () => {
  vm.runInContext(`assets.push({id:'tx', kind:'texture', name:'t', texture:null, w:64, h:32});
    assets.push({id:'sp', kind:'sprite', name:'S', textureId:'tx', ppu:32, pivot:{x:0.5,y:0.5},
      regions:[{name:'a',x:0,y:0,l:32,h:32},{name:'b',x:32,y:0,l:32,h:32},{name:'big',x:0,y:0,l:64,h:32}]});`, ctx);
  const src = new ctx.THREE.Group();
  src.userData.sprite2d = {spriteId:'sp', region:'a', layer:'Jeu', order:0, teinte:'#ffffff'};
  const m0 = ctx.rebuildMeshSprite(src);
  assert.ok(m0, 'maille du modèle construite');
  const copie = src.clone(true);
  assert.ok(!(copie.userData._meshSprite && copie.userData._meshSprite.isObject3D), 'précondition : débris JSON');
  const m = ctx.bindSpriteMesh(copie);
  assert.ok(m && m.isMesh && m.parent === copie, 'référence recâblée sur la maille clonée');
  assert.notEqual(m.geometry, m0.geometry, 'géométrie propre à l’instance');
  assert.equal(ctx.updateImageSprite(copie, 'b'), true);
  assert.equal(ctx.updateImageSprite(copie, 'big'), true, 'reconstruction (taille différente)');
  assert.equal(copie.children.filter((c) => c.name === '__sprite').length, 1, 'une seule maille');
  assert.equal(src.userData._meshSprite, m0, 'le modèle est intact');
  // Sans recâblage préalable (autre chemin de clone), la reconstruction ne laisse pas de doublon.
  const c2 = src.clone(true);
  ctx.updateImageSprite(c2, 'big');
  assert.equal(c2.children.filter((c) => c.name === '__sprite').length, 1);
});
