// La recherche du panneau Projet (js/asset-search.js), mesurée sans navigateur : la syntaxe
// d'Unity (`t:Material`, texte libre), les noms français des genres, le tri, et le bouton des
// genres qui ne fait qu'écrire des `t:` dans le champ.
//
// Ce que ces tests protègent : une recherche qui ne regarde que le dossier courant (le défaut
// signalé par un utilisateur venu d'Unity), un `t:` mal tapé qui montrerait TOUT au lieu de rien,
// et un genre d'asset du moteur qu'aucun filtre ne sait sélectionner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ASSET_SEARCH_KINDS, assetMatchesQuery, clearKindTokens, folderLabelOf, foldSearchText,
  parseAssetQuery, searchAssets, searchFolders, searchKindByAlias, toggleKindToken
} from '../js/asset-search.js';

const ASSETS = [
  {id: 'a1', kind: 'material', name: 'Herbe', folder: 'Matériaux/Sol'},
  {id: 'a2', kind: 'texture', name: 'Herbe_albedo', folder: 'Textures'},
  {id: 'a3', kind: 'texture', name: 'Pierre', folder: ''},
  {id: 'a4', kind: 'model', name: 'Héros', folder: 'Personnages'},
  {id: 'a5', kind: 'animation', name: 'Course', folder: 'Personnages', embedded: true},
  {id: 'a6', kind: 'sfx', name: 'Saut', folder: 'Sons'},
  {id: 'a7', kind: 'musicLoop', name: 'Thème herbeux', folder: 'Sons'},
  {id: 'a8', kind: 'script', name: 'Joueur', folder: 'Scripts'},
  {id: 'a9', kind: 'material', name: 'herbe', folder: 'Autre'}
];
const ids = (list) => list.map((a) => a.id);

test('le texte libre cherche dans TOUS les dossiers, sans casse ni accents', () => {
  assert.deepEqual(ids(searchAssets(ASSETS, 'herbe')).sort(), ['a1', 'a2', 'a7', 'a9']);
  assert.deepEqual(ids(searchAssets(ASSETS, 'HEROS')), ['a4']);
  assert.deepEqual(ids(searchAssets(ASSETS, 'héros')), ['a4']);
});

test('plusieurs mots : TOUS doivent figurer dans le nom', () => {
  assert.deepEqual(ids(searchAssets(ASSETS, 'herbe albedo')), ['a2']);
  assert.deepEqual(searchAssets(ASSETS, 'herbe pierre'), []);
});

test('un champ vide (ou des espaces) rend null : le panneau revient au dossier courant', () => {
  assert.equal(searchAssets(ASSETS, ''), null);
  assert.equal(searchAssets(ASSETS, '   '), null);
  // « t: » tout seul, en cours de frappe, ne filtre encore rien
  assert.equal(searchAssets(ASSETS, 't:'), null);
});

test('t:Material — la syntaxe Unity filtre par genre, combinable avec du texte', () => {
  assert.deepEqual(ids(searchAssets(ASSETS, 't:Material')).sort(), ['a1', 'a9']);
  assert.deepEqual(ids(searchAssets(ASSETS, 'herbe t:Texture')), ['a2']);
  assert.deepEqual(ids(searchAssets(ASSETS, 't:texture herbe')), ['a2']);
});

test('les noms français des genres sont acceptés (t:Matériau, t:son, t:modele)', () => {
  assert.deepEqual(ids(searchAssets(ASSETS, 't:Matériau')).sort(), ['a1', 'a9']);
  assert.deepEqual(ids(searchAssets(ASSETS, 't:materiau')).sort(), ['a1', 'a9']);
  assert.deepEqual(ids(searchAssets(ASSETS, 't:modele')), ['a4']);
  // « Son » couvre les trois genres sonores du moteur
  assert.deepEqual(ids(searchAssets(ASSETS, 't:son')).sort(), ['a6', 'a7']);
  assert.deepEqual(ids(searchAssets(ASSETS, 't:AudioClip')).sort(), ['a6', 'a7']);
});

test('plusieurs t: s\'additionnent, comme dans Unity', () => {
  assert.deepEqual(ids(searchAssets(ASSETS, 't:Material t:Texture')).sort(), ['a1', 'a2', 'a3', 'a9']);
  assert.deepEqual(ids(searchAssets(ASSETS, 't:Material t:Texture herbe')).sort(), ['a1', 'a2', 'a9']);
});

test('un t: illisible ne montre RIEN, et la requête dit lequel', () => {
  const q = parseAssetQuery('t:Materail herbe');
  assert.deepEqual(q.unknownTypes, ['Materail']);
  assert.equal(q.empty, false);
  assert.deepEqual(searchAssets(ASSETS, 't:Materail'), []);
  // à côté d'un t: valide, le t: illisible est ignoré (signalé, pas bloquant)
  assert.deepEqual(ids(searchAssets(ASSETS, 't:Materail t:Script')), ['a8']);
});

test('un clip EMBARQUÉ dans un modèle n\'a pas de tuile à lui : il est écarté', () => {
  assert.deepEqual(searchAssets(ASSETS, 'course'), []);
  assert.equal(assetMatchesQuery(ASSETS[4], parseAssetQuery('course')), true,
    'le filtre lui-même le reconnaît : c\'est searchAssets qui l\'écarte, à dessein');
});

test('les résultats sont triés par nom, puis par dossier', () => {
  const r = searchAssets(ASSETS, 't:Material');
  assert.deepEqual(r.map((a) => a.folder), ['Autre', 'Matériaux/Sol'],
    'deux « herbe » de même nom : le dossier départage');
  assert.deepEqual(ids(searchAssets(ASSETS, 't:Texture')), ['a2', 'a3']);
});

test('les dossiers répondent au texte libre, jamais à un t:', () => {
  const folders = ['Personnages', 'Personnages/Héros', 'Sons', 'Textures/Herbes'];
  assert.deepEqual(searchFolders(folders, 'heros'), ['Personnages/Héros']);
  assert.deepEqual(searchFolders(folders, 'herbe'), ['Textures/Herbes']);
  assert.deepEqual(searchFolders(folders, 'herbe t:Texture'), []);
  assert.deepEqual(searchFolders(folders, ''), []);
});

test('le dossier d\'origine se lit : « Projet » à la racine, sinon le chemin', () => {
  assert.equal(folderLabelOf(''), 'Projet');
  assert.equal(folderLabelOf(undefined), 'Projet');
  assert.equal(folderLabelOf('Matériaux/Sol'), 'Matériaux › Sol');
});

test('le bouton des genres POSE puis RETIRE un t:, sans toucher au reste du texte', () => {
  let t = toggleKindToken('herbe', 'material');
  assert.equal(t, 'herbe t:Material');
  t = toggleKindToken(t, 'texture');
  assert.equal(t, 'herbe t:Material t:Texture');
  t = toggleKindToken(t, 'material');
  assert.equal(t, 'herbe t:Texture');
  // un t: tapé à la main sous un autre alias est reconnu et retiré
  assert.equal(toggleKindToken('t:matériau sol', 'material'), 'sol');
  assert.equal(clearKindTokens('herbe t:Material t:Texture'), 'herbe');
  // un genre inconnu ne change rien
  assert.equal(toggleKindToken('herbe', 'nope'), 'herbe');
});

test('repli : minuscules, accents retirés', () => {
  assert.equal(foldSearchText('Matériaux ÉTÉ'), 'materiaux ete');
  assert.equal(foldSearchText(null), '');
});

test('chaque alias désigne UN SEUL genre (sinon t:X choisirait au hasard)', () => {
  const seen = new Map();
  ASSET_SEARCH_KINDS.forEach((k) => {
    [k.id, k.label].concat(k.aliases).forEach((a) => {
      const n = foldSearchText(a);
      assert.ok(!seen.has(n) || seen.get(n) === k.id,
        'alias « ' + a + ' » partagé par ' + seen.get(n) + ' et ' + k.id);
      seen.set(n, k.id);
    });
    assert.equal(searchKindByAlias(k.aliases[0]), k, k.id + ' : son premier alias doit le désigner');
  });
});

test('TOUT genre d\'asset que le panneau Projet sait nommer est sélectionnable par un t:', () => {
  // La table des libellés du panneau (js/assets.js) est la liste des genres que le moteur montre.
  // Un genre qui y entre sans entrer dans le filtre resterait introuvable par genre — c'est la
  // famille de défauts « nouveau genre oublié par une liste à la main » (docs/KNOWN_ISSUES.md).
  const src = fs.readFileSync(new URL('../js/assets.js', import.meta.url), 'utf8');
  const bloc = src.slice(src.indexOf('export const ASSET_KIND_LABELS = {'),
    src.indexOf('};', src.indexOf('export const ASSET_KIND_LABELS = {')));
  const kinds = Array.from(bloc.matchAll(/(\w+):\s*['"]/g), (m) => m[1]);
  assert.ok(kinds.length >= 15, 'table des genres illisible : ' + kinds.length);
  const covered = new Set(ASSET_SEARCH_KINDS.flatMap((k) => k.kinds));
  const missing = kinds.filter((k) => !covered.has(k));
  assert.deepEqual(missing, [], 'genres sans filtre t: : ' + missing.join(', '));
});
