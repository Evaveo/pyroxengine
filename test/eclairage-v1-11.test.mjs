// moteur/test/eclairage-v1-11.test.mjs — v1.11.0 : dépliage automatique de lightmap, libération GPU
// différée, portée RGBM portée par l'asset, budget d'ombres, défauts de lumière par sous-type.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { unwrapTriangles, unwrapPadding } from '../js/lightmap-unwrap.js';
import { releaseLater, tickGpuRelease, pendingGpuRelease } from '../js/gpu-release.js';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

// Un cube de 12 triangles, faces de tailles différentes (boîte 1 × 2 × 4) : aire réelle variable.
function box(sx, sy, sz){
  const v = [];
  const quad = (a, b, c, d) => { v.push(...a, ...b, ...c, ...a, ...c, ...d); };
  const P = (x, y, z) => [x * sx, y * sy, z * sz];
  quad(P(0,0,0), P(1,0,0), P(1,1,0), P(0,1,0));
  quad(P(0,0,1), P(1,0,1), P(1,1,1), P(0,1,1));
  quad(P(0,0,0), P(0,1,0), P(0,1,1), P(0,0,1));
  quad(P(1,0,0), P(1,1,0), P(1,1,1), P(1,0,1));
  quad(P(0,0,0), P(1,0,0), P(1,0,1), P(0,0,1));
  quad(P(0,1,0), P(1,1,0), P(1,1,1), P(0,1,1));
  return new Float32Array(v);
}
const triArea2d = (u, t) => Math.abs((u[t+2]-u[t])*(u[t+5]-u[t+1]) - (u[t+4]-u[t])*(u[t+3]-u[t+1])) / 2;
function triArea3d(p, o){
  const ax = p[o+3]-p[o], ay = p[o+4]-p[o+1], az = p[o+5]-p[o+2];
  const bx = p[o+6]-p[o], by = p[o+7]-p[o+1], bz = p[o+8]-p[o+2];
  return Math.hypot(ay*bz - az*by, az*bx - ax*bz, ax*by - ay*bx) / 2;
}

test('dépliage auto : toutes les UV dans [0,1]², une carte par triangle sans recouvrement', () => {
  const pos = box(1, 2, 4);
  const uv = unwrapTriangles(pos, 0.01);
  assert.equal(uv.length, (pos.length / 9) * 6);
  for(const x of uv) assert.ok(x >= 0 && x <= 1, 'UV hors du carré : ' + x);
  // boîtes englobantes des triangles : disjointes deux à deux (cartes en étagères séparées)
  const boxes = [];
  for(let t = 0; t < uv.length; t += 6){
    const us = [uv[t], uv[t+2], uv[t+4]], vs = [uv[t+1], uv[t+3], uv[t+5]];
    boxes.push([Math.min(...us), Math.min(...vs), Math.max(...us), Math.max(...vs)]);
  }
  for(let i = 0; i < boxes.length; i++) for(let j = i + 1; j < boxes.length; j++){
    const a = boxes[i], b = boxes[j];
    const overlap = a[0] < b[2] - 1e-6 && b[0] < a[2] - 1e-6 && a[1] < b[3] - 1e-6 && b[1] < a[3] - 1e-6;
    assert.ok(!overlap, 'les cartes ' + i + ' et ' + j + ' se recouvrent');
  }
});

test('dépliage auto : surface UV proportionnelle à la surface du monde, et déterministe', () => {
  const pos = box(1, 2, 4);
  const uv = unwrapTriangles(pos, 0.01);
  const ratios = [];
  for(let t = 0, o = 0; t < uv.length; t += 6, o += 9) ratios.push(triArea2d(uv, t) / triArea3d(pos, o));
  const min = Math.min(...ratios), max = Math.max(...ratios);
  assert.ok(max / min < 1.0001, 'rapport d’aires non uniforme : ' + min + ' … ' + max);
  // Rejoué à l'identique : c'est ce que fait la relecture d'un projet (éditeur comme jeu).
  assert.deepEqual(Array.from(unwrapTriangles(pos, 0.01)), Array.from(uv));
  assert.ok(unwrapPadding(1000) < unwrapPadding(50), 'la marge doit diminuer quand la région grandit');
});

test('dépliage auto : un triangle dégénéré ne produit ni NaN ni sortie du carré', () => {
  const pos = new Float32Array([0,0,0, 0,0,0, 0,0,0,  0,0,0, 1,0,0, 0,1,0]);
  const uv = unwrapTriangles(pos, 0.02);
  for(const x of uv) assert.ok(Number.isFinite(x) && x >= 0 && x <= 1);
});

test('libération GPU différée : rien avant l’échéance, tout après, doublons ignorés', () => {
  let n = 0;
  const res = {dispose(){ n++; }};
  releaseLater(res, 2);
  releaseLater(res, 2);
  assert.equal(pendingGpuRelease(), 1);
  tickGpuRelease(); tickGpuRelease();
  assert.equal(n, 0, 'libéré avant l’échéance');
  tickGpuRelease();
  assert.equal(n, 1);
  assert.equal(pendingGpuRelease(), 0);
});

test('plus aucun dispose() immédiat sur une texture potentiellement branchée', () => {
  const rgbm = read('js/lightmap-rgbm.js');
  assert.doesNotMatch(rgbm.slice(rgbm.indexOf('export function forgetCacheRgbm')), /__texRgbm\.dispose\(\)/);
  const rt = read('js/game-runtime.js');
  assert.doesNotMatch(rt, /o\.shadow\.map\.dispose\(\)/);
  assert.doesNotMatch(rt, /game\.skyTexture\.dispose\(\)/);
  const probes = read('js/probes.js');
  assert.doesNotMatch(probes, /\.rt\.dispose\(\)/);
  const assets = read('js/assets.js');
  assert.doesNotMatch(assets, /m\.envMap = null/, 'la vignette ne doit plus écrire envMap sur les matériaux partagés');
});

test('portée RGBM : lue sur l’asset, 8 par défaut pour les anciens PNG', async () => {
  globalThis.THREE = globalThis.THREE || {DataUtils: {toHalfFloat: (x) => x}};
  const m = await import('../js/lightmap-rgbm.js');
  assert.equal(m.rgbmRangeOf({}), 8);
  assert.equal(m.rgbmRangeOf({rgbmRange: 16}), 16);
  assert.equal(m.RGBM_RANGE_BAKE, 16);
  // 200 en linéaire : écrêté à 64 en portée 8, conservé en portée 16.
  const src = new Float32Array([200, 200, 200, 1]);
  const b8 = m.encodeLightmapRgbm(src, 1, 8), b16 = m.encodeLightmapRgbm(src, 1, 16);
  const back = (b, R) => { const mm = (b[3] / 255) * R; const r = (b[0] / 255) * mm; return r * r; };
  assert.ok(back(b8, 8) < 70);
  assert.ok(Math.abs(back(b16, 16) - 200) / 200 < 0.03);
  // la portée part avec le projet et revient dans le jeu publié
  assert.match(read('js/serialization.js'), /d\.rgbmRange = a\.rgbmRange/);
  assert.match(read('js/game-runtime.js'), /rgbm:!!da\.rgbm, rgbmRange:da\.rgbmRange/);
});

test('budget d’ombres : une lumière éteinte dans l’arbre ne prend pas la place', () => {
  const src = read('js/shadow-fit.js').replace(/^export /gm, '').replace(/if \(typeof globalThis[^\n]*\n/, '');
  const ShadowFit = new Function(src + '; return ShadowFit;')();
  const parent = {visible: false, parent: null};
  const cachee = {id: 1, castShadow: true, visible: true, parent: parent, userData: {}};
  const allumee = {id: 2, castShadow: true, visible: true, parent: {visible: true, parent: null}, userData: {}};
  ShadowFit.budgetLocalShadows([cachee, allumee], 1);
  assert.equal(cachee.castShadow, false);
  assert.equal(allumee.castShadow, true, 'la lumière visible doit recevoir l’unique ombre locale');
  parent.visible = true;
  ShadowFit.budgetLocalShadows([cachee, allumee], 1);
  assert.equal(cachee.castShadow, true, 'redevenue visible, la plus ancienne reprend sa place');
  assert.equal(allumee.castShadow, false);
});

test('défauts de lumière : un sac partiel de spot reçoit les défauts du spot de l’éditeur', async () => {
  const cd = await import('../js/component-data.js');
  const o = {userData: {}};
  const s = cd.ensureLight(o, 'spot');
  assert.equal(s.intensity, 1.6);
  assert.equal(s.range, 30);
  assert.ok(Math.abs(s.angle - 30 * Math.PI / 180) < 1e-9);
  assert.equal(s.penumbra, 0.3);
  assert.equal(cd.ensureLight({userData: {}}).range, 28);
  assert.equal(cd.lightDefaultFor('directional').intensity, 0.8);
  // makeLight (objects.js) doit garder les mêmes valeurs, sinon les deux divergent à nouveau
  const obj = read('js/objects.js');
  assert.match(obj, /new THREE\.PointLight\(color, 1\.25, 28, 2\)/);
  assert.match(obj, /new THREE\.SpotLight\(color, 1\.6, 30, THREE\.MathUtils\.degToRad\(30\), 0\.3, 1\.5\)/);
});

test('cuisson : ombre portée conservée, ciel exclu par défaut, irradiance × π, rapport MCP', async () => {
  const bake = read('js/lightmap-bake.js');
  assert.doesNotMatch(bake, /m\.castShadow = true;/);
  assert.match(bake, /includeSky: !!opts\.bakeSky/);
  assert.match(bake, /output\.rgb\.mul\(float\(Math\.PI\)\)/);
  assert.match(bake, /denoiseBilateral\(data, res, 2, 0\.25, \{relative: true\}\)/);
  assert.match(read('js/copilot-workshop.js'), /castShadows: \{description/);
  // describeBakeReport est pur : on l'extrait du fichier (qui importe l'éditeur entier)
  const start = bake.indexOf('export function describeBakeReport');
  const m = /\r?\n\}\r?\n/.exec(bake.slice(start));
  const end = start + m.index + m[0].indexOf('}') + 1;
  const describe = new Function(bake.slice(start, end).replace('export ', '') + '; return describeBakeReport;')();
  const txt = describe({autoUnwrapped: 2, warnings: 0, lamps: [{name: 'Torche', mode: 'mixed'}, {name: 'Lustre', mode: 'baked'}]});
  assert.match(txt, /cuites : 1 \(Lustre\)/);
  assert.match(txt, /mixtes : 1 \(Torche\)/);
  assert.match(txt, /2 maillage\(s\) dépliés automatiquement/);
  assert.match(txt, /ATTENTION/);
});

test('dépliage auto persisté : la relecture rejoue le même uv1 (désindexation comprise)', async () => {
  class Attr {
    constructor(array, size){ this.array = array; this.itemSize = size; this.count = array.length / size; }
    getX(i){ return this.array[i * this.itemSize]; }
    getY(i){ return this.array[i * this.itemSize + 1]; }
    getZ(i){ return this.array[i * this.itemSize + 2]; }
  }
  globalThis.THREE = Object.assign(globalThis.THREE || {}, {BufferAttribute: Attr});
  function geometry(){
    const g = {type: 'BoxGeometry', parameters: {width: 1}, name: '', userData: {},
      index: {array: [0, 1, 2, 0, 2, 3]},
      attributes: {position: new Attr(new Float32Array([0,0,0, 2,0,0, 2,1,0, 0,1,0]), 3)},
      setAttribute(n, a){ this.attributes[n] = a; }, deleteAttribute(n){ delete this.attributes[n]; },
      toNonIndexed(){
        const src = this.attributes.position.array, idx = this.index.array, out = new Float32Array(idx.length * 3);
        idx.forEach((v, k) => { out[k*3] = src[v*3]; out[k*3+1] = src[v*3+1]; out[k*3+2] = src[v*3+2]; });
        const n = geometry(); n.index = null; n.type = 'BufferGeometry'; delete n.parameters;
        n.attributes = {position: new Attr(out, 3)};
        return n;
      }};
    return g;
  }
  const atlas = await import('../js/lightmap-atlas.js');
  const node = (geo) => ({isMesh: true, geometry: geo, userData: {}, traverse(f){ f(this); }});
  const a = node(geometry());
  const geo = atlas.prepareAutoUnwrap(a);
  assert.equal(geo.index, null);
  assert.equal(geo.type, 'BoxGeometry', 'le type de la primitive doit survivre (physique)');
  atlas.setTransformedAtlas(geo, atlas.AUTO_UV, [0.5, -0.5], [0.1, 0.9], 0.02);
  const saved = JSON.parse(JSON.stringify(atlas.collectAtlasLightmap(a)));
  assert.equal(saved[0].game, 'auto');
  assert.equal(saved[0].pad, 0.02);
  const b = node(geometry());
  b.userData.lightmapAtlas = saved;
  atlas.reapplyAtlasLightmap(b);
  assert.deepEqual(Array.from(b.geometry.attributes.uv1.array), Array.from(a.geometry.attributes.uv1.array));
  assert.ok(atlas.clearTransformedAtlas(b.geometry));
});

test('RÉGRESSION v1.11.1 — le matériau de cuisson ne passe PAS par vertexNode (ponctuelles à la bonne distance)', () => {
  // Avec un vertexNode, three WebGPU reconstruit la position de vue du fragment depuis la
  // position de découpe : en cuisson, c'est la coordonnée de lightmap, pas le monde — une
  // ponctuelle s'y retrouve à des dizaines de mètres et son halo disparaît.
  const src = readFileSync(new URL('../js/lightmap-bake.js', import.meta.url), 'utf8');
  assert.ok(!/\bm\.vertexNode\s*=/.test(src), 'buildMaterialBake pose encore un vertexNode');
  assert.ok(/m\.setupVertex\s*=\s*function/.test(src), 'setupVertex n’est plus remplacé');
});

test('v1.11.1 — une sélection sans maillage cuit toute la scène', () => {
  const src = readFileSync(new URL('../js/lightmap-bake.js', import.meta.url), 'utf8');
  assert.ok(/!meshesBakeable\(racines\)\.length\) racines = null/.test(src),
    'une sélection sans maillage (lumière) ne retombe plus sur toute la scène');
});
