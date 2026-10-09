// moteur/test/exporteur.test.mjs
//
// L'exporteur en ligne de commande (`outils/exporter.mjs`) publie un projet-dossier en site
// statique. Ce qu'on tient ici, c'est la COHÉRENCE de ce qu'il pose sur le disque — parce que
// ses deux façons d'échouer sont muettes :
//
//   · une balise `<script src>` sans fichier → page blanche chez l'hébergeur, message d'erreur
//     qui désigne un fichier et pas la cause ;
//   · une référence d'asset qui ne désigne plus rien → le jeu se charge et il manque une
//     interface, un script ou une texture, sans un mot.
//
// Le second est exactement le défaut corrigé en v0.136.1 (les ids d'assets régénérés sans que
// les scènes soient remappées). L'exporteur, lui, ne régénère RIEN : il garde les ids du
// manifeste. Le test ci-dessous est ce qui empêche que « faire comme l'éditeur » y soit
// réintroduit un jour par zèle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataOfProject, exportProject } from '../outils/exporter.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROJET = path.join(ROOT, 'jeux', 'Chromelo');

// Un projet-fixture peut être commité INCOMPLET, et `project.json` seul ne le dit pas :
// jusqu'au 2026-09-18 la règle `**/donnees/` du .gitignore racine avalait le dossier du
// genre d'asset « Données » (sur Windows, core.ignorecase attrape aussi `Donnees`). Le
// manifeste partait, les assets non, et cinq tests tombaient sur un ENOENT nu qui ne
// nommait ni la cause ni le fichier. On vérifie donc la COMPLÉTUDE, et le test dédié
// ci-dessous dit ce qui manque au lieu de laisser cinq échecs muets.
function assetsManquants(projet){
  // Le manifeste du projet fait foi : chaque entree de `assets[]` porte son dossier et son
  // fichier, et l'exporteur lira exactement `assets/<folder>/<file>`. Scanner les JSON a la
  // recherche de chemins ne marcherait pas — les references vivent aussi dans des phrases.
  const manifeste = JSON.parse(fs.readFileSync(path.join(projet, 'project.json'), 'utf8'));
  return (manifeste.assets || [])
    .map((a) => ['assets', a.folder, a.file].filter(Boolean).join('/'))
    .filter((rel) => !fs.existsSync(path.join(projet, rel)))
    .sort();
}

const manquants = fs.existsSync(path.join(PROJET, 'project.json')) ? assetsManquants(PROJET) : [];
const dispo = fs.existsSync(path.join(PROJET, 'project.json')) && manquants.length === 0;

test('le projet-fixture est commite COMPLET, assets compris', {skip: !fs.existsSync(path.join(PROJET, 'project.json'))}, () => {
  assert.deepStrictEqual(manquants, [],
    'ces assets sont référencés par jeux/Chromelo mais absents du dépôt. Ils existent sans '
    + 'doute sur la machine qui a commité le projet : un motif de .gitignore les a avalés en '
    + 'silence. Les ajouter (git add -f si besoin) plutot que de retirer la fixture : '
    + 'c est elle qui garde l exporteur.');
});
const sortie = fs.mkdtempSync(path.join(os.tmpdir(), 'export-'));

test('CHAQUE asset declare par le manifeste a son fichier sur le disque', {skip: !dispo}, () => {
  // LE DEFAUT MESURE. `.gitignore` portait une regle SECRETS `**/donnees/` ; sur Windows, ou
  // git ignore la casse, elle avalait `jeux/Chromelo/assets/Donnees/`. Le fichier existait
  // donc chez la personne qui l avait cree, jamais dans le depot — et sur un clone propre,
  // c est-a-dire en CI, l exporteur mourait sur un ENOENT de readFileSync, six tests plus
  // bas, avec une trace qui designait fs.js et jamais .gitignore.
  //
  // Ce test-ci tombe AVANT, et dit ce qu il faut faire. Un manifeste qui cite un fichier
  // absent est une reference morte comme une autre : elle doit se voir ici, pas chez l hote.
  const manifest = JSON.parse(fs.readFileSync(path.join(PROJET, 'project.json'), 'utf8'));
  const manquants = [];
  for(const a of manifest.assets || []){
    const files = a.file ? [a.file] : (a.files || []);
    for(const f of files){
      const p = path.join(PROJET, 'assets', a.folder || '', f);
      if(!fs.existsSync(p)) manquants.push(a.kind + ' ' + a.name + ' -> assets/'
        + (a.folder ? a.folder + '/' : '') + f);
    }
  }
  assert.deepEqual(manquants, [],
    'project.json declare des assets dont le fichier est absent du depot. Verifier .gitignore'
    + ' avant toute autre piste : une regle trop large (secrets, dossiers de travail) peut'
    + ' avaler un dossier d assets entier sans que rien ne le signale.');
});

test('l\'export produit index.html, data.js et les modules du moteur', {skip: !dispo}, () => {
  const r = exportProject(PROJET, sortie);
  assert.ok(fs.existsSync(path.join(sortie, 'index.html')));
  assert.ok(fs.existsSync(path.join(sortie, 'data.js')));
  assert.ok(fs.existsSync(path.join(sortie, 'runtime.js')),
    'js/game-runtime.js est publié sous le nom runtime.js — c\'est le seul module renommé');
  assert.ok(r.copies > 20, 'seulement ' + r.copies + ' modules copiés');
});

test('CHAQUE balise <script src> de index.html a son fichier', {skip: !dispo}, () => {
  // Une balise sans fichier, c'est un 404 chez l'hébergeur et une page blanche dont le message
  // désigne le mauvais coupable. C'est la panne la plus coûteuse à diagnostiquer à distance.
  const html = fs.readFileSync(path.join(sortie, 'index.html'), 'utf8');
  const sources = [...html.matchAll(/src="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(sources.length > 20, 'index.html ne charge que ' + sources.length + ' fichiers');
  for(const s of sources){
    assert.ok(fs.existsSync(path.join(sortie, s)), 'balise sans fichier : ' + s);
  }
});

test('les cibles de l\'importmap sont publiées elles aussi', {skip: !dispo}, () => {
  // Elles ne passent pas par `src=`, donc le test précédent ne les voit pas — et c'est
  // précisément pour ça qu'on les oublierait.
  const html = fs.readFileSync(path.join(sortie, 'index.html'), 'utf8');
  for(const m of html.matchAll(/"(\.\/)?(vendor-esm\/[^"]+)"/g)){
    assert.ok(fs.existsSync(path.join(sortie, m[2])), 'module d\'importmap absent : ' + m[2]);
  }
});

test('data.js est du JavaScript valide, et GAME_DATA a la forme attendue', {skip: !dispo}, () => {
  const js = fs.readFileSync(path.join(sortie, 'data.js'), 'utf8');
  const data = JSON.parse(js.replace(/^window\.GAME_DATA = /, '').replace(/;\n$/, ''));
  assert.equal(data.version, 15);
  assert.ok(Array.isArray(data.scenes) && data.scenes.length > 0);
  assert.ok(Array.isArray(data.assets) && data.assets.length > 0);
  assert.ok(data.build.engine.match(/^\d+\.\d+\.\d+$/), 'l\'estampille porte la version du moteur');
  for(const s of data.scenes) assert.ok(Array.isArray(s.data.objects), s.name + ' : pas d\'objets');
});

test('TOUTE référence d\'asset d\'une scène exportée désigne un asset publié', {skip: !dispo}, () => {
  // Le cœur du test. L'exporteur garde les ids du manifeste ; si quelqu'un les régénère un jour
  // sans remapper les scènes, c'est ici que ça se voit — et pas chez le joueur.
  const data = dataOfProject(PROJET, '0.0.0');
  const ids = new Set(data.assets.map((a) => a.id));
  const REFS = {AnimatorController: 'assetId', SpriteRenderer: 'spriteId',
                SpriteAnimator: 'spriteId', AudioSource: 'asset', ScriptJS: 'scriptId',
                Model: 'assetId', PostVolume: 'profileId', Tilemap: 'paletteId'};
  for(const s of data.scenes){
    for(const o of s.data.objects || []){
      if(o.materialId) assert.ok(ids.has(o.materialId), o.name + ' : matériau introuvable');
      for(const c of o.components || []){
        const champ = REFS[c.type];
        if(champ && c.data && c.data[champ]){
          assert.ok(ids.has(c.data[champ]),
            o.name + ' : ' + c.type + '.' + champ + ' → ' + c.data[champ] + ' introuvable');
        }
        if(c.type === 'UIDocument' && c.data){
          assert.ok(ids.has(c.data.documentUIId),
            o.name + ' : document d\'interface introuvable dans le build');
          for(const id of c.data.sheetStyleIds || []){
            assert.ok(ids.has(id), o.name + ' : feuille de style ' + id + ' introuvable');
          }
        }
      }
    }
  }
});

test('le contenu des assets est INLINE : le build ne lit aucun fichier voisin', {skip: !dispo}, () => {
  // Tout passe par des balises `<script>` : un build qui garderait un chemin relatif vers un
  // fichier d'asset ne marcherait ni en `file://` ni derrière un hébergeur qui range autrement.
  const data = dataOfProject(PROJET, '0.0.0');
  for(const a of data.assets){
    if(a.kind === 'script')     assert.ok(typeof a.code === 'string' && a.code.length);
    if(a.kind === 'documentUI') assert.ok(typeof a.html === 'string' && a.html.length);
    if(a.kind === 'sheetStyle') assert.ok(typeof a.css === 'string' && a.css.length);
    if(a.kind === 'texture'){
      assert.ok(a.files[0].b64.startsWith('data:image/'),
        a.name + ' : une texture doit porter son type MIME, sinon elle reste noire sans erreur');
    }
    assert.ok(!('file' in a), a.name + ' : un chemin de fichier a survécu dans le build');
  }
});

test('un type d\'asset inconnu ARRÊTE l\'export au lieu de le publier amputé', {skip: !dispo}, () => {
  // Publier en ignorant ce qu'on ne sait pas inliner donnerait un jeu auquel il manque une pièce,
  // sans un mot. Mieux vaut refuser et nommer le type.
  const bac = fs.mkdtempSync(path.join(os.tmpdir(), 'export-ko-'));
  fs.mkdirSync(path.join(bac, 'scenes'));
  fs.writeFileSync(path.join(bac, 'project.json'), JSON.stringify({
    name: 'Bac', scenes: [], assets: [{id: 'a1', kind: 'hologramme', name: 'X', folder: 'Z'}]
  }));
  assert.throws(() => dataOfProject(bac, '0.0.0'), /hologramme/);
});

// v1.2.4 : un prefab rangé dans son `.prefab.json` (format depuis v0.198.0) était publié SANS
// arbre par l'exporteur — la publication serveur du cloud sortait des monstres et un brouillard
// invisibles. Le projet Donjons a des prefabs en fichiers : chacun doit arriver plein.
const DONJONS = path.join(ROOT, 'jeux', 'Donjons');
test('un prefab en fichier .prefab.json est publié AVEC son arbre', {skip: !fs.existsSync(path.join(DONJONS, 'project.json'))}, () => {
  const prefabs = dataOfProject(DONJONS, '0.0.0').assets.filter((a) => a.kind === 'prefab');
  assert.ok(prefabs.length, 'le projet Donjons devrait avoir des prefabs');
  for(const a of prefabs) assert.ok(Array.isArray(a.tree) && a.tree.length, a.name + ' : prefab publié vide');
});
