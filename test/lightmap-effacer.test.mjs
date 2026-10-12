// moteur/test/lightmap-effacer.test.mjs
//
// « EFFACER LA CUISSON » — le « Clear Baked Data » d'Unity (js/lightmap-bake.js, clearLightmaps).
//
// Une cuisson écrit à trois endroits : la lightmap sur les matériaux, l'uv1 d'atlas sur les
// géométries, une texture `cuite` dans le projet. Effacer doit défaire les trois — et SEULEMENT ce
// que la cuisson a produit : une lightmap importée de Blender porte le même champ et doit rester.
// Et la sauvegarde d'un projet-dossier perdait `cuite`/`rgbm` : une lightmap cuite relue devenait
// une texture couleur ordinaire, que plus rien ne reconnaissait comme cuite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { creerContexte } from './engine-env.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function contexte(){
  const ctx = creerContexte(['js/lightmap-atlas.js', 'js/lightmap-bake.js']);
  vm.runInContext(`
    var assets = [];
    var removed = [], applied = [], records = 0;
    var MATERIAL_DEFAULT = {lightmapAsset: null, lightmapUv: 1};
    function isIconEdit(){ return false; }
    function listMats(x){ return Array.isArray(x.material) ? x.material : (x.material ? [x.material] : []); }
    function ensurePropsMaterial(a){ return a.props || (a.props = {}); }
    function applyMaterialEverywhere(a){ applied.push(a.id); }
    function removeAssetAndFile(a){ removed.push(a.id); assets.splice(assets.indexOf(a), 1); return []; }
    function forgetCacheRgbm(){}
    function updateProject(){}
    function setStatus(){}
    // Un maillage dont le matériau vient de l'asset matériau \`matId\`, cuit dans l'atlas.
    function maillageCuit(matId, avecUv1){
      const g = new THREE.PlaneGeometry(1, 1);
      if(avecUv1) g.setAttribute('uv1', g.attributes.uv.clone());
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial());
      m.material.userData.materialAsset = matId;
      setTransformedAtlas(g, avecUv1 ? 'uv1' : 'uv', [0.5, 0.5], [0.25, 0.5]);
      m.userData.lightmapAtlas = collectAtlasLightmap(m);
      objects.push(m);
      return m;
    }
    this.$ = function(code){ return eval(code); };
  `, ctx);
  return ctx;
}

test('les UV : un uv1 d\'origine est REPOSÉ, un uv1 fabriqué depuis uv est RETIRÉ', () => {
  const ctx = contexte();
  const avec = ctx.$('maillageCuit("m1", true)');
  const sans = ctx.$('maillageCuit("m2", false)');
  const origine = Array.from(avec.geometry.attributes.uv.array);
  assert.notDeepEqual(Array.from(avec.geometry.attributes.uv1.array), origine, 'la cuisson a bien transformé uv1');
  assert.ok(sans.geometry.attributes.uv1, 'la cuisson a fabriqué un uv1');
  assert.equal(ctx.$('clearTransformedAtlas')(avec.geometry), true);
  assert.equal(ctx.$('clearTransformedAtlas')(sans.geometry), true);
  assert.deepEqual(Array.from(avec.geometry.attributes.uv1.array), origine, 'le dépliage d\'origine revient');
  assert.equal(sans.geometry.attributes.uv1, undefined, 'la géométrie redevient ce qu\'elle était');
  assert.equal(avec.geometry.userData.lightmapAtlas, undefined);
  assert.equal(avec.geometry.userData.lightmapUvSource, undefined, 'le gel est oublié : une nouvelle cuisson repart du vrai jeu');
  assert.equal(ctx.$('clearTransformedAtlas')(avec.geometry), false, 'déjà effacé : rien à faire');
});

test('effacer retire la lightmap CUITE, garde une lightmap IMPORTÉE, et supprime la texture cuite', () => {
  const ctx = contexte();
  ctx.$(`
    assets.push({id: 'lm', kind: 'texture', name: 'Lightmap.png', cuite: true, rgbm: true});
    assets.push({id: 'blender', kind: 'texture', name: 'Lightmap.png', cuite: false});
    assets.push({id: 'm1', kind: 'material', props: {lightmapAsset: 'lm', lightmapUv: 1}});
    assets.push({id: 'm2', kind: 'material', props: {lightmapAsset: 'blender', lightmapUv: 1}});
    maillageCuit('m1', true); maillageCuit('m2', true);
  `);
  const bilan = ctx.$('clearLightmaps({record: function(){ records++; }})');
  assert.equal(ctx.$('records'), 1, 'UN pas d\'historique, avant la première modification');
  assert.equal(ctx.$('assets.find(function(a){ return a.id === "m1"; }).props.lightmapAsset'), null);
  assert.equal(ctx.$('assets.find(function(a){ return a.id === "m2"; }).props.lightmapAsset'), 'blender',
    'une lightmap importée n\'est pas l\'œuvre de la cuisson : elle reste');
  assert.deepEqual(Array.from(ctx.$('applied')), ['m1'], 'seul le matériau cuit est reconstruit');
  assert.deepEqual(Array.from(ctx.$('removed')), ['lm'], 'la texture cuite quitte le projet, pas l\'importée');
  assert.equal(bilan.materials, 1);
  assert.equal(bilan.meshes, 2, 'les deux maillages retrouvent leurs UV (l\'atlas est géométrique)');
  assert.ok(ctx.$('objects.every(function(o){ return o.userData.lightmapAtlas === undefined; })'),
    'le nœud oublie l\'atlas : il ne repartirait pas dans le fichier');
  assert.match(ctx.$('describeClearLightmaps')(bilan), /cuisson effacée/);
});

test('une lightmap cuite encore portée par un matériau d\'une AUTRE scène reste dans le projet', () => {
  const ctx = contexte();
  ctx.$(`
    assets.push({id: 'lm', kind: 'texture', name: 'Lightmap.png', cuite: true});
    assets.push({id: 'm1', kind: 'material', props: {lightmapAsset: 'lm'}});
    assets.push({id: 'ailleurs', kind: 'material', props: {lightmapAsset: 'lm'}});   // aucun maillage ici
    maillageCuit('m1', true);
  `);
  const bilan = ctx.$('clearLightmaps({})');
  assert.equal(ctx.$('removed.length'), 0, 'supprimer la texture laisserait l\'autre scène sans éclairage');
  assert.equal(bilan.kept, 1);
});

test('rien de cuit : rien ne bouge, pas même un pas d\'historique', () => {
  const ctx = contexte();
  const bilan = ctx.$('clearLightmaps({record: function(){ records++; }})');
  assert.equal(ctx.$('records'), 0);
  assert.equal(bilan.meshes + bilan.materials, 0);
  assert.match(ctx.$('describeClearLightmaps')(bilan), /rien à effacer/);
});

test('l\'entrée de menu et la commande clear_lightmaps existent, à côté de la cuisson', () => {
  const ui = readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  const bake = ui.indexOf('Cuire les lightmaps…');
  const clear = ui.indexOf('Effacer la cuisson des lightmaps…');
  assert.ok(bake > 0 && clear > bake && clear - bake < 600, 'juste après « Cuire les lightmaps… »');
  assert.match(ui, /modalClearLightmaps\(pushHistory\)/, 'annulable : le pas d\'historique est passé');
  const cop = readFileSync(path.join(root, 'js/copilot.js'), 'utf8');
  assert.match(cop, /name: 'clear_lightmaps'/);
  assert.match(cop, /clearLightmaps\(\{record: pushHistory\}\)/);
  assert.match(readFileSync(path.join(root, 'js/copilot-budget.js'), 'utf8'), /'bake_lightmaps', 'clear_lightmaps'/);
});

test('un projet-dossier garde `cuite` et `rgbm` de ses textures (le manifeste les perdait)', () => {
  const src = readFileSync(path.join(root, 'js/serialization.js'), 'utf8');
  const debut = src.indexOf('export function diskAssetManifest(){');
  const corps = src.slice(debut, src.indexOf("} else if(a.kind === 'model'){", debut));
  assert.match(corps, /if\(a\.kind === 'texture' && a\.cuite\) d\.cuite = true;/);
  assert.match(corps, /if\(a\.kind === 'texture' && a\.rgbm\) d\.rgbm = true;/);
  // Et la relecture les reprend bien depuis le descripteur — l'autre moitié du chemin.
  assert.match(src, /cuite:!!da\.cuite, rgbm:!!da\.rgbm, noRefresh:true/);
});
