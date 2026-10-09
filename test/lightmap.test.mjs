// L'éditeur ne CUIT pas de lightmap : il accepte celles cuites ailleurs. Ce qui doit
// être verrouillé, c'est donc la CHAÎNE — et son maillon fragile est le jeu d'UV.
//
// Une lightmap est défoldée sur son propre game d'UV, sans chevauchement : c'est le second
// (`uv1`), et c'est ce que produit un export Blender. Si `channel` reste à 0, three
// l'échantillonne avec les UV de TEXTURE — qui se chevauchent par construction — et
// l'éclairage apparaît plaqué n'importe où. Aucune erreur, une image plausible et fausse.
//
// Second point verrouillé ici : le jeu publié doit apply EXACTEMENT la même chose.
// L'éditeur et le runtime ont deux implémentations distinctes de la construction du
// matériau, et c'est la source de défaut la plus fréquente de ce dépôt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const racineMoteur = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(racineMoteur, f), 'utf8');

test('la lightmap est declaree dans la table, avec ses deux reglages', () => {
  const src = read('js/material-props.js');
  ['lightmapAsset', 'lightmapIntensity', 'lightmapUv'].forEach((key) => {
    assert.ok(src.indexOf("key:'" + key + "'") !== -1,
      key + ' manque à PROPS_MATERIAL : le champ serait invisible dans l’inspecteur ET '
      + 'inconnu du copilote, puisque les deux lisent cette table');
  });
  // Les deux réglages n'ont aucun sens sans la map : ils doivent être MASQUÉS, pas grisés.
  const block = src.slice(src.indexOf("key:'lightmapIntensity'"), src.indexOf("key:'heightAsset'"));
  assert.equal((block.match(/requires:\['lightmapAsset'\]/g) || []).length, 2,
    'les deux réglages doivent dépendre de la map');
  assert.equal((block.match(/ifMissing:'hidden'/g) || []).length, 2,
    'sans map, il n’y a rien à régler : masqué, pas grisé');
});

test('le canal UV est pose, et le second jeu est le defaut', () => {
  // La ligne qui compte dans tout ce chantier. Sans elle, la lightmap est échantillonnée
  // avec les UV de texture et l'éclairage est plaqué n'importe où.
  const editeur = read('js/materials.js');
  const runtime = read('js/game-runtime.js');

  [['js/materials.js', editeur], ['js/game-runtime.js', runtime]].forEach(([name, src]) => {
    assert.match(src, /\.channel\s*=\s*\(p\.lightmapUv === 0\) \? 0 : 1/,
      name + ' : le canal UV de la lightmap n’est pas posé — three lirait `uv` au lieu de '
      + '`uv1`, et l’éclairage serait plaqué n’importe où sans lever d’error');
    assert.match(src, /lightMapIntensity/, name + ' : l’intensité n’est pas appliquée');
  });

  // Le défaut doit être le SECOND game : c'est la convention de tout dépliage de lightmap.
  assert.match(read('js/materials.js'), /lightmapUv:1/,
    'le défaut doit être le 2ᵉ game d’UV — un dépliage de lightmap ne réutilise jamais les '
    + 'UV de texture');
});

test('editeur et jeu publie appliquent la MEME chose', () => {
  // Trois propriétés three doivent être écrites des deux côtés. Une seule oubliée dans le
  // runtime donne un jeu publié éclairé autrement que la vue d'édition — sans message.
  const editeur = read('js/materials.js');
  const runtime = read('js/game-runtime.js');
  ['lightMap', 'lightMapIntensity', 'channel'].forEach((prop) => {
    assert.ok(editeur.indexOf(prop) !== -1, 'js/materials.js n’écrit pas ' + prop);
    assert.ok(runtime.indexOf(prop) !== -1, 'js/game-runtime.js n’écrit pas ' + prop);
  });
});

test('un maillage sans second game d UV est SIGNALE, pas laisse en silence', () => {
  // Le piège de la fonctionnalité : toutes les primitives du moteur n'ont qu'un jeu d'UV.
  // Brancher une lightmap dessus en demandant le 2ᵉ donne un rendu faux. Rien d'autre que
  // ce contrôle ne le dirait.
  const src = read('js/materials.js');
  assert.match(src, /function checkUvLightmap/,
    'le contrôle a disparu : une lightmap sur un maillage sans uv1 redeviendrait silencieuse');
  assert.match(src, /attributes\.uv1/,
    'le contrôle doit regarder la présence de `uv1` sur la géométrie');

  // ET IL DOIT ÊTRE APPELÉ. Première version de ce test : il ne vérifiait que l'existence
  // de la fonction. Elle existait, le test passait — et elle n'était appelée nulle part.
  // Une garde définished et jamais invoquée est du code mort qui ressemble à une protection ;
  // c'est pire que pas de garde, parce qu'on croit être couvert.
  const appels = (src.match(/checkUvLightmap\(/g) || []).length;
  assert.ok(appels >= 2,
    'checkUvLightmap est défini mais jamais appelé (' + appels + ' occurrence(s), '
    + 'la définition comprise) : le contrôle ne se déclencherait jamais');
});

test('la convention de nommage reconnait les lightmaps', () => {
  const src = read('js/material-extraction.js');
  assert.match(src, /prop:'lightmapAsset'/, 'rôle « lightmap » absent des rôles de nommage');
  assert.match(src, /_Lightmap/, 'suffixe _Lightmap absent');
  // Espace de COULEUR : une lightmap porte de la lumière, pas des données. La traiter en
  // « donnees » la laisserait en linéaire et l'éclairage sortirait faux.
  assert.match(src, /prop:'lightmapAsset', label:'Lightmap',\s*type:'color'/,
    'une lightmap est une texture de COULEUR (sRGB), pas de données');
});
