// moteur/test/remap-references-exhaustif.test.mjs
//
// LE TEST-GARDE QUI MANQUAIT — et la raison pour laquelle le même défaut est revenu quatre fois.
//
// `remapReferencesAssetsInScenes()` (serialization.js) réattribue les références d'assets après
// un rechargement de projet, parce que `rebuildAssetsFromDescriptors()` régénère les ids. La
// liste des champs à remapper est tenue À LA MAIN. Chaque fois qu'un composant a gagné une
// référence d'asset, on a oublié de compléter cette liste — et l'oubli est MUET : l'id survit
// intact dans le fichier et désigne l'asset qui a hérité du numéro, ou plus rien.
//
// Les fois précédentes, l'une après l'autre : `sprite2d.spriteId`, `scriptId`, `Model.assetId`,
// `PostVolume.profileId`, puis `UIDocument.documentUIId` / `sheetStyleIds` (le menu de
// jeux/Chromelo, qui ne retrouvait plus son HTML ni son CSS à la réouverture).
//
// Les deux tests voisins (remap-references.test.mjs, remap-references-assets.test.mjs)
// vérifient les champs connus au moment où ils ont été écrits : ils ne pouvaient donc pas voir
// le SUIVANT. Celui-ci part du CODE DES COMPOSANTS, pas d'une liste : il découvre tout champ de
// la forme `data.<nom>Id` / `data.<nom>Ids`, et exige que chacun soit effectivement remappé. Un
// composant qui gagne demain une référence d'asset fait échouer ce test le jour où il est
// écrit, pas six mois plus tard sur un projet de l'utilisateur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { creerContexte } from './engine-env.mjs';

const env = creerContexte(['js/tile-palette.js', 'js/assets.js', 'js/materials.js',
  'js/model-import.js', 'js/import-settings.js', 'js/project-settings.js', 'js/serialization.js']);

const dirComponents = join(dirname(fileURLToPath(import.meta.url)), '..', 'js', 'components');

// Les champs `data.<nom>Id(s)` qui ne désignent PAS un asset du projet. La liste est vide
// aujourd'hui : elle existe pour qu'un futur champ d'identité interne (un id de nœud, un id de
// calque) puisse être écarté EXPLICITEMENT, par une ligne qu'on écrit sciemment, plutôt qu'en
// affaiblissant le test. Y ajouter une entrée sans dire pourquoi, c'est rouvrir la brèche.
const NOT_ASSET_REFS = new Set([]);

// `asset` (AudioSource) ne finit pas par « Id » mais en est une : le scan par suffixe ne peut
// pas la voir, on la nomme donc ici.
const EXTRA_REFS = {AudioSource: ['asset']};

// Lit, pour chaque fichier de composant, son `typeName` et les champs `data.<nom>Id(s)` qu'il
// touche. Une lecture de source, pas une exécution : un composant qui a besoin du DOM ou de
// three.js pour se charger est quand même couvert.
function scanComponentRefs(){
  const byType = {};
  for(const file of readdirSync(dirComponents).filter((f) => f.endsWith('.js'))){
    const src = readFileSync(join(dirComponents, file), 'utf8');
    const type = (src.match(/static\s+get\s+typeName\s*\(\)\s*\{\s*return\s*'([^']+)'/) || [])[1];
    if(!type) continue;
    const fields = new Set(EXTRA_REFS[type] || []);
    // `data.` mais aussi `d.` et `opts.` : la moitié des composants aliasent `this.data` en `d`
    // dans leurs accesseurs (component-model.js, component-sprite.js, component-script.js). Un
    // scan sur le seul `data.` les laissait tous passer — c'est-à-dire exactement les champs
    // qu'on vient de réparer un par un.
    for(const m of src.matchAll(/\b(?:this\.)?(?:data|d|opts)\.([a-zA-Z]+Ids?)\b/g)){
      if(!NOT_ASSET_REFS.has(m[1])) fields.add(m[1]);
    }
    if(fields.size) byType[type] = [...fields].sort();
  }
  return byType;
}

// Une scène d'un seul objet portant un composant de ce type, dont chaque champ de référence
// vaut `'old'` (ou `['old']` pour un champ tableau, reconnu à son pluriel).
function sceneWith(type, fields){
  const data = {};
  fields.forEach((f) => { data[f] = f.endsWith('Ids') ? ['old'] : 'old'; });
  return [{name: 'Scène', data: {objects: [{name: 'Objet', components: [
    {type: type, active: true, data: data}
  ]}]}}];
}

const refsByType = scanComponentRefs();

test('le scan trouve bien des références (sinon le test ne prouve rien)', () => {
  // Une regex qui ne matche plus rendrait tous les tests ci-dessous verts sans rien vérifier.
  assert.ok(Object.keys(refsByType).length >= 5,
    'moins de 5 composants porteurs de références trouvés : le scan est cassé, pas le code');
  assert.ok(refsByType.UIDocument, 'UIDocument doit apparaître dans le scan');
});

for(const [type, fields] of Object.entries(refsByType)){
  test('« ' + type + ' » : ' + fields.join(', ') + ' — remappé(s) vers le nouvel id', () => {
    const scenes = sceneWith(type, fields);
    env.remapReferencesAssetsInScenes(scenes, {old: {id: 'new'}});
    const d = scenes[0].data.objects[0].components[0].data;
    fields.forEach(function(f){
      const attendu = f.endsWith('Ids') ? ['new'] : 'new';
      assert.deepEqual(d[f], attendu,
        type + '.' + f + ' n\'est pas remappé par remapReferencesAssetsInScenes() —'
        + ' ajoute-le dans serialization.js, sinon la référence désignera un AUTRE asset'
        + ' à la prochaine réouverture du projet.');
    });
  });

  test('« ' + type + ' » : ' + fields.join(', ') + ' — une référence morte est vidée', () => {
    // Le pire cas n'est pas « la référence est perdue », c'est « la référence survit intacte » :
    // elle désigne alors l'asset qui a hérité du numéro, et le projet se rouvre méconnaissable.
    const scenes = sceneWith(type, fields);
    env.remapReferencesAssetsInScenes(scenes, {});
    const d = scenes[0].data.objects[0].components[0].data;
    fields.forEach(function(f){
      const attendu = f.endsWith('Ids') ? [] : null;
      assert.deepEqual(d[f], attendu,
        type + '.' + f + ' garde son id d\'origine quand l\'asset a disparu.');
    });
  });
}
