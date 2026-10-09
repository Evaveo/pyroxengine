// moteur/test/remap-references-assets.test.mjs
//
// RÉGRESSION (docs/REVUE_2026-09-14.md § 2, cause 2 et § 5, point 2).
//
// `remapReferencesAssetsInScenes()` réattribue les références d'assets après un rechargement —
// les ids sont régénérés, donc une référence non remappée désigne UN AUTRE ASSET, pas rien.
// Elle couvrait les sacs à plat (`o.animator`, `o.sprite2d`, `o.audio`) mais, dans le tableau
// `components[]`, seulement `Tilemap`, `Model`, `PostVolume` et `SkinnedMeshRenderer`. Or c'est
// le COMPOSANT qui gagne à la relecture (`applyComponents` écrase le sac) : les références
// d'AnimatorController, SpriteRenderer, SpriteAnimator et AudioSource glissaient donc d'un rang
// à chaque réouverture, et `scriptId` n'était remappé nulle part du tout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte } from './engine-env.mjs';

const env = creerContexte(['js/tile-palette.js', 'js/assets.js', 'js/materials.js',
  'js/model-import.js', 'js/import-settings.js', 'js/project-settings.js', 'js/serialization.js']);

// ancien id -> {id: nouvel id}, comme le rend rebuildAssetsFromDescriptors.
const table = {
  vieilAnimator: {id: 'neufAnimator'},
  vieuxSprite:   {id: 'neufSprite'},
  vieuxSon:      {id: 'neufSon'},
  vieuxScript:   {id: 'neufScript'}
};

function sceneAvecComposants(){
  return [{name: 'Niveau', data: {objects: [{
    name: 'Héros',
    components: [
      {type: 'AnimatorController', active: true, data: {assetId: 'vieilAnimator'}},
      {type: 'SpriteRenderer',     active: true, data: {spriteId: 'vieuxSprite', layer: 'Jeu'}},
      {type: 'SpriteAnimator',     active: true, data: {spriteId: 'vieuxSprite'}},
      {type: 'AudioSource',        active: true, data: {asset: 'vieuxSon', volume: 0.5}},
      {type: 'ScriptJS',           active: true, data: {scriptId: 'vieuxScript', values: {}}}
    ]
  }]}}];
}

const parType = (o, t) => o.components.find((c) => c.type === t).data;

test('les références d\'asset portées par un COMPOSANT sont remappées', () => {
  const scenes = sceneAvecComposants();
  env.remapReferencesAssetsInScenes(scenes, table);
  const o = scenes[0].data.objects[0];
  assert.equal(parType(o, 'AnimatorController').assetId, 'neufAnimator');
  assert.equal(parType(o, 'SpriteRenderer').spriteId, 'neufSprite');
  assert.equal(parType(o, 'SpriteAnimator').spriteId, 'neufSprite');
  assert.equal(parType(o, 'AudioSource').asset, 'neufSon');
  assert.equal(parType(o, 'ScriptJS').scriptId, 'neufScript');
});

test('une référence morte devient null, elle ne reste pas sur l\'id d\'origine', () => {
  // Un id qui survit intact au rechargement est le pire cas : il désigne l'asset qui a HÉRITÉ
  // de ce numéro, donc un autre asset — c'est le symptôme « le héros affiche la planche des murs ».
  const scenes = sceneAvecComposants();
  env.remapReferencesAssetsInScenes(scenes, {});
  const o = scenes[0].data.objects[0];
  assert.equal(parType(o, 'AnimatorController').assetId, null);
  assert.equal(parType(o, 'SpriteRenderer').spriteId, null);
  assert.equal(parType(o, 'AudioSource').asset, null);
  assert.equal(parType(o, 'ScriptJS').scriptId, null);
});

test('le sac scripts À PLAT est remappé lui aussi', () => {
  const scenes = [{name: 'Niveau', data: {objects: [{
    name: 'Héros', scripts: [{scriptId: 'vieuxScript', active: true, values: {}}]
  }]}}];
  env.remapReferencesAssetsInScenes(scenes, table);
  assert.equal(scenes[0].data.objects[0].scripts[0].scriptId, 'neufScript');
});

test('les champs non-référence du composant sont laissés intacts', () => {
  const scenes = sceneAvecComposants();
  env.remapReferencesAssetsInScenes(scenes, table);
  const o = scenes[0].data.objects[0];
  assert.equal(parType(o, 'SpriteRenderer').layer, 'Jeu');
  assert.equal(parType(o, 'AudioSource').volume, 0.5);
});

// ---------- UIDocument : le document et ses feuilles de style ----------
// Le dernier oubli de la même famille, et celui qui a coûté le plus cher : `o.uiDoc` (le sac à
// plat) était remappé, mais pas `components[].UIDocument.data` — or `applyComponents` écrase le
// sac, donc c'est le composant qui gagne. Mesuré sur jeux/Chromelo : à la réouverture, le menu
// ne retrouvait ni `menu.html` ni `menu.css`, et l'interface se rendait vide. Le seul composant
// dont une référence est un TABLEAU (`sheetStyleIds`).
const tableUI = {
  oldDoc:    {id: 'newDoc'},
  oldSheetA: {id: 'newSheetA'},
  oldSheetB: {id: 'newSheetB'}
};

function sceneUIDocument(){
  return [{name: 'Menu', data: {objects: [{
    name: 'Interface',
    uiDoc: {documentUIId: 'oldDoc', sheetStyleIds: ['oldSheetA', 'oldSheetB'], values: {}},
    components: [{type: 'UIDocument', active: true,
      data: {documentUIId: 'oldDoc', sheetStyleIds: ['oldSheetA', 'oldSheetB'], values: {}}}]
  }]}}];
}

test('UIDocument : le COMPOSANT est remappé, pas seulement le sac à plat', () => {
  const scenes = sceneUIDocument();
  env.remapReferencesAssetsInScenes(scenes, tableUI);
  const o = scenes[0].data.objects[0];
  assert.equal(parType(o, 'UIDocument').documentUIId, 'newDoc');
  assert.deepEqual(parType(o, 'UIDocument').sheetStyleIds, ['newSheetA', 'newSheetB']);
  // le sac à plat reste juste lui aussi — les deux doivent raconter la même chose
  assert.equal(o.uiDoc.documentUIId, 'newDoc');
  assert.deepEqual(o.uiDoc.sheetStyleIds, ['newSheetA', 'newSheetB']);
});

test('UIDocument : une référence morte est vidée, une feuille morte est retirée', () => {
  const scenes = sceneUIDocument();
  env.remapReferencesAssetsInScenes(scenes, {oldSheetB: {id: 'newSheetB'}});
  const d = parType(scenes[0].data.objects[0], 'UIDocument');
  assert.equal(d.documentUIId, null);
  assert.deepEqual(d.sheetStyleIds, ['newSheetB']);
});
