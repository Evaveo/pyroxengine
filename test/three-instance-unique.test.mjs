// UNE SEULE INSTANCE DE three.js (v0.173.2). L'editeur et les jeux chargeaient le bundle classique
// vendor/three.min.js ET le paquet ESM du pont WebGPU : deux compteurs d'id Object3D, des ids en
// collision (le gizmo prenait la place d'objets de projet a la selection, docs/KNOWN_ISSUES.md) et
// l'avertissement « Multiple instances of Three.js being imported » dans chaque console.
// Les addons (GLTFLoader, FBXLoader, TransformControls) sont desormais recompiles contre le THREE
// du pont (vendor/three-addons.min.js, vendor/RECETTE-addons.md). Ce test tient les deux moities :
// aucune page ne charge plus le second three, et les addons heritent bien des classes du pont.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const PAGES = ['editor.html', 'game-preview.html', 'build-test/index.html'];

test('aucune page ni aucun build ne charge vendor/three.min.js', () => {
  for (const page of PAGES) assert.doesNotMatch(read(page), /vendor\/three\.min\.js/, page);
  const build = read('js/build.js');
  assert.doesNotMatch(build, /src: 'vendor\/three\.min\.js'/);
  assert.doesNotMatch(build, /<script src="vendor\/three\.min\.js"/);
  assert.match(build, /src: 'vendor\/three-addons\.min\.js'/);
});

test('les addons viennent APRES le pont : ils lisent globalThis.THREE a leur chargement', () => {
  const pages = PAGES.map((p) => [p, read(p)]).concat([['js/build.js', read('js/build.js')]]);
  for (const [nom, html] of pages) {
    const pont = html.search(/src="(\.\.\/)?(js\/)?render-webgpu-bridge\.mjs/);
    const addons = html.search(/src="(\.\.\/)?vendor\/three-addons\.min\.js/);
    assert.ok(pont > 0 && addons > pont, `${nom} : les addons doivent suivre le pont`);
  }
});

test('addons et objets de projet partagent les classes et le compteur d id du pont', async () => {
  globalThis.self ??= globalThis;
  globalThis.navigator ??= { userAgent: 'node' };
  const W = await import(pathToFileURL(path.join(root, 'vendor-esm/three.webgpu.min.js')).href);
  const avant = globalThis.THREE;
  globalThis.THREE = Object.assign({}, W);
  try {
    vm.runInThisContext(read('vendor/three-addons.min.js'), { filename: 'vendor/three-addons.min.js' });
    const T = globalThis.THREE;
    assert.ok(new T.GLTFLoader() instanceof W.Loader, 'GLTFLoader herite du Loader du pont');
    assert.ok(new T.FBXLoader() instanceof W.Loader, 'FBXLoader herite du Loader du pont');
    const projet = new T.Object3D();
    const gizmo = new T.TransformControls(new T.PerspectiveCamera()).getHelper();
    assert.ok(gizmo instanceof W.Object3D, 'le gizmo est un Object3D du pont');
    const ids = [projet.id];
    gizmo.traverse((o) => ids.push(o.id));
    ids.push(new T.Object3D().id);
    assert.equal(new Set(ids).size, ids.length, 'un seul compteur : aucune collision d id');
  } finally {
    globalThis.THREE = avant;
  }
});
