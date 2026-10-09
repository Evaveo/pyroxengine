// Aller-retour RÉEL des assets du Rack sonore (revue du 2026-09-29, § 6.7) : les tests du rack
// vérifiaient le texte du code, et `sfx` / `musicLoop` manquaient aux tests d'aller-retour. Ici
// on crée les assets, on les ÉCRIT par le vrai chemin de sauvegarde (assetsSerialized), on vide
// le projet, on les RELIT par le vrai chemin de chargement (rebuildAssetsFromDescriptors), et on
// compare les recettes — puis le son recalculé.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { creerContexte } from './engine-env.mjs';

const FICHIERS = ['js/assets.js', 'js/materials.js', 'js/model-import.js', 'js/import-settings.js',
  'js/project-settings.js', 'js/audio.js', 'js/serialization.js'];

test('un bruitage et une boucle survivent à sauvegarde puis rechargement, son compris', async () => {
  const e = creerContexte(FICHIERS);
  vm.runInContext(`
    globalThis.__sfx = createAssetSfx(presetSfx('coin', 7), {name: 'Pièce', silent: true});
    globalThis.__loop = createAssetLoop(presetLoop('chiptune'), {name: 'Thème', silent: true});
    globalThis.__loop.recipe = retuneLoop(globalThis.__loop.recipe, 'D', 'dorian');
  `, e);
  const avant = JSON.parse(vm.runInContext(
    'JSON.stringify({sfx: __sfx.recipe, loop: __loop.recipe, sfxId: __sfx.id, loopId: __loop.id})', e));
  const descripteurs = await vm.runInContext('assetsSerialized()', e);
  const plats = JSON.parse(JSON.stringify(descripteurs));
  const dSfx = plats.find((d) => d.kind === 'sfx');
  const dLoop = plats.find((d) => d.kind === 'musicLoop');
  assert.ok(dSfx && dLoop, 'les deux genres sont écrits');
  assert.ok(!('buffer' in dSfx) && !('files' in dSfx), 'un bruitage ne s écrit QUE par sa recette');

  vm.runInContext('assets.length = 0;', e);
  await vm.runInContext('rebuildAssetsFromDescriptors(' + JSON.stringify(plats) + ', async () => null)', e);
  const apres = JSON.parse(vm.runInContext(`JSON.stringify({
    sfx: assets.find(a => a.kind === 'sfx'), loop: assets.find(a => a.kind === 'musicLoop')},
    (k, v) => (k === 'buffer' || k === 'file') ? undefined : v)`, e));
  assert.equal(apres.sfx.name, 'Pièce');
  assert.equal(apres.loop.name, 'Thème');
  assert.deepEqual(apres.sfx.recipe, avant.sfx);
  assert.deepEqual(apres.loop.recipe, avant.loop);
  assert.equal(apres.loop.recipe.key, 'D');
  assert.equal(apres.loop.recipe.scale, 'dorian');

  // Le son est bien RECALCULÉ, et à l'identique : même recette, mêmes échantillons.
  const memes = vm.runInContext(`(function(){
    const a = renderSfx(normalizeSfx(${JSON.stringify(avant.sfx)}));
    const b = renderSfx(assets.find(x => x.kind === 'sfx').recipe);
    if(a.length !== b.length || !a.length) return false;
    for(let i = 0; i < a.length; i++) if(a[i] !== b[i]) return false;
    return true;
  })()`, e);
  assert.ok(memes, 'le bruitage rechargé ne sonne pas comme celui sauvegardé');
});
