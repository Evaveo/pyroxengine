// moteur/test/catalogue-plugins.test.mjs
//
// LE CATALOGUE DE PLUGINS — la page `/editeur/plugins.html`, et la porte par laquelle elle
// demande une installation à l'éditeur.
//
// Ce que ce fichier garde tient en deux idées.
//
// 1. UN CATALOGUE QUI MENT EST PIRE QU'AUCUN CATALOGUE. Une entrée qui cite un fichier absent
//    donne un bouton « Installer » qui échoue ; un plugin livré mais non cité est introuvable
//    alors qu'il est là. Les deux se vérifient contre le dossier `exemples/`, pas contre une
//    seconde liste.
//
// 2. LA PAGE N'ENVOIE PAS DE CODE, ELLE ENVOIE UN NOM. `installRequestFile()` est le seul
//    chemin qui mène à une installation venue de la page, et il porte trois verrous. Chacun est
//    cassé SÉPARÉMENT ici : un verrou qu'on ne voit jamais refuser n'a pas été mesuré.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CATALOG_URL, MESSAGE_INSTALL,
  catalogCategories, catalogKeyFromHash, entryForFile, filterCatalog, installRequestFile,
  isPluginFileName, matchesSearch, newCatalogKey, pluginNameForFile,
} from '../js/plugin-catalog.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const catalog = JSON.parse(read('exemples/catalogue.json'));

// ---------- 1. le catalogue décrit ce qui est livré ----------

test('chaque plugin annoncé par le catalogue existe dans exemples/', () => {
  assert.ok(catalog.plugins.length >= 2, 'le catalogue est vide');
  for (const p of catalog.plugins) {
    assert.ok(existsSync(path.join(root, 'exemples', p.file)), `fichier absent : ${p.file}`);
  }
});

test('chaque plugin livré dans exemples/ est annoncé par le catalogue', () => {
  const surDisque = readdirSync(path.join(root, 'exemples'))
    .filter((f) => f.startsWith('plugin-') && f.endsWith('.js'));
  assert.ok(surDisque.length >= 2);
  for (const f of surDisque) {
    assert.ok(entryForFile(catalog, f), `livré mais absent du catalogue : ${f}`);
  }
});

test('chaque entrée porte les champs que la page affiche', () => {
  for (const p of catalog.plugins) {
    for (const champ of ['file', 'title', 'category', 'summary', 'description']) {
      assert.equal(typeof p[champ], 'string', `${p.file} : ${champ} manquant`);
      assert.ok(p[champ].trim().length > 0, `${p.file} : ${champ} vide`);
    }
    assert.ok(Array.isArray(p.extends) && p.extends.length > 0, `${p.file} : extends vide`);
    assert.ok(Array.isArray(p.requires), `${p.file} : requires doit être une liste`);
    // `warning` est facultatif, mais s'il est là il doit être une chaîne (la page le rend tel quel).
    assert.ok(p.warning === undefined || typeof p.warning === 'string');
  }
});

test('le nom d\'installation du catalogue est celui de l\'installation manuelle', () => {
  // Le chemin manuel (modalPlugins) fait `f.name.replace(/\.js$/i, '')`. Si les deux
  // divergeaient, installer un plugin deux fois par deux chemins en ferait DEUX plugins.
  assert.equal(pluginNameForFile('plugin-pont-mcp.js'), 'plugin-pont-mcp');
  assert.equal(pluginNameForFile('plugin-pont-mcp.js'), 'plugin-pont-mcp.js'.replace(/\.js$/i, ''));
});

// ---------- 2. la porte d'installation ----------

const catalogueTest = { plugins: [{ file: 'plugin-pont-mcp.js', title: 'Pont' }] };
const JETON = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const porte = { key: JETON, origin: 'https://exemple.test' };
const messageValide = {
  data: { type: MESSAGE_INSTALL, key: JETON, file: 'plugin-pont-mcp.js' },
  origin: 'https://exemple.test',
};

test('une demande complète et légitime passe', () => {
  assert.equal(installRequestFile(messageValide, porte, catalogueTest), 'plugin-pont-mcp.js');
});

test('VERROU 1 — une demande sans le jeton de CET éditeur est refusée', () => {
  for (const faux of [undefined, '', 'f'.repeat(32), JETON.slice(0, 31), JETON + '0', JETON.toUpperCase()]) {
    const msg = { ...messageValide, data: { type: MESSAGE_INSTALL, key: faux, file: 'plugin-pont-mcp.js' } };
    assert.equal(installRequestFile(msg, porte, catalogueTest), null, `jeton accepté à tort : ${faux}`);
  }
  // Un éditeur qui n'a jamais ouvert de catalogue n'a pas de jeton : il refuse tout, y compris
  // une demande qui n'en porterait aucun.
  const jamaisOuvert = { key: '', origin: 'https://exemple.test' };
  assert.equal(installRequestFile(messageValide, jamaisOuvert, catalogueTest), null);
  const sansJeton = { ...messageValide, data: { type: MESSAGE_INSTALL, file: 'plugin-pont-mcp.js' } };
  assert.equal(installRequestFile(sansJeton, jamaisOuvert, catalogueTest), null);
});

test('VERROU 2 — une origine étrangère est refusée, même avec le bon jeton', () => {
  const ailleurs = Object.assign({}, messageValide, { origin: 'https://attaquant.test' });
  assert.equal(installRequestFile(ailleurs, porte, catalogueTest), null);
});

test('le jeton est tiré au hasard, et il se relit dans le fragment', () => {
  const a = newCatalogKey(), b = newCatalogKey();
  assert.match(a, /^[0-9a-f]{32}$/, '128 bits en hexadécimal');
  assert.notEqual(a, b, 'deux ouvertures doivent donner deux jetons');
  assert.equal(catalogKeyFromHash('#k=' + a), a);
  assert.equal(catalogKeyFromHash('k=' + a), a);
  // Rien d'autre ne passe pour un jeton : ni vide, ni tronqué, ni majuscules, ni autre clé.
  for (const hash of ['', '#', '#k=', '#k=zz', '#k=' + a.slice(0, 31), '#k=' + a.toUpperCase(), '#autre=' + a]) {
    assert.equal(catalogKeyFromHash(hash), '', `accepté à tort : ${hash}`);
  }
});

test('VERROU 3 — un fichier hors catalogue est refusé', () => {
  const inconnu = { ...messageValide, data: { type: MESSAGE_INSTALL, key: JETON, file: 'plugin-inconnu.js' } };
  assert.equal(installRequestFile(inconnu, porte, catalogueTest), null);
});

test('VERROU 3 — un nom de fichier qui sortirait de exemples/ est refusé', () => {
  // Même si une entrée fautive du catalogue le portait : la règle borne le catalogue aussi.
  const evasion = { plugins: [{ file: '../js/plugins.js' }, { file: 'a/b.js' }] };
  for (const mauvais of ['../js/plugins.js', 'a/b.js', '..%2Fx.js', 'x.js.txt', '/abs.js']) {
    const msg = { ...messageValide, data: { type: MESSAGE_INSTALL, key: JETON, file: mauvais } };
    assert.equal(installRequestFile(msg, porte, evasion), null, `accepté à tort : ${mauvais}`);
  }
  assert.equal(isPluginFileName('plugin-pont-mcp.js'), true);
});

test('un message d\'un autre type ne déclenche rien', () => {
  const autre = { ...messageValide, data: { type: 'autre-chose', key: JETON, file: 'plugin-pont-mcp.js' } };
  assert.equal(installRequestFile(autre, porte, catalogueTest), null);
  assert.equal(installRequestFile({ origin: 'https://exemple.test' }, porte, catalogueTest), null);
});

// ---------- 3. la recherche et les filtres ----------

test('la recherche porte sur tout ce que la carte affiche, pas seulement le titre', () => {
  const pont = entryForFile(catalog, 'plugin-pont-mcp.js');
  assert.ok(pont, 'le Pont MCP doit être au catalogue');
  assert.ok(!/agent/i.test(pont.title), 'le titre ne contient pas « agent » : c\'est le point du test');
  assert.equal(matchesSearch(pont, 'agent'), true);
  assert.equal(matchesSearch(pont, 'poiscaille'), false);
  // Tous les mots, dans n'importe quel ordre.
  assert.equal(matchesSearch(pont, 'copilote agent'), true);
  assert.equal(matchesSearch(pont, 'agent poiscaille'), false);
  // Une recherche vide ne filtre rien.
  assert.equal(matchesSearch(pont, '   '), true);
});

test('le filtre par catégorie et la recherche se cumulent', () => {
  const cats = catalogCategories(catalog);
  assert.ok(cats.length >= 2, 'il faut au moins deux catégories pour que le filtre serve');
  assert.deepEqual(cats, [...cats].sort((a, b) => a.localeCompare(b, 'fr')));
  assert.equal(new Set(cats).size, cats.length, 'catégorie en double');

  const cat = entryForFile(catalog, 'plugin-pont-mcp.js').category;
  const dansLaCategorie = filterCatalog(catalog, '', cat);
  assert.ok(dansLaCategorie.length >= 1);
  assert.ok(dansLaCategorie.every((p) => p.category === cat));
  // Les autres catégories existent bien, donc le filtre retire vraiment quelque chose.
  assert.ok(dansLaCategorie.length < catalog.plugins.length, 'le filtre ne retire rien');
  // Cumul : une recherche qui ne vise pas cette catégorie donne zéro.
  assert.equal(filterCatalog(catalog, 'poiscaille', cat).length, 0);
  // Sans catégorie, tout passe.
  assert.equal(filterCatalog(catalog, '', '').length, catalog.plugins.length);
});

// ---------- 4. la page et son branchement dans l'éditeur ----------

test('la page charge les tokens, sa feuille et son module', () => {
  const html = read('plugins.html');
  assert.match(html, /css\/tokens\.css/);
  assert.match(html, /css\/plugins-page\.css/);
  assert.match(html, /<script type="module" src="js\/plugins-page\.js">/);
  // Les quatre ancres que le module va chercher par identifiant.
  for (const id of ['cat-q', 'cat-filters', 'cat-list', 'cat-error', 'cat-standalone']) {
    assert.ok(html.includes('id="' + id + '"'), `ancre absente de la page : ${id}`);
  }
});

test('la page n\'envoie jamais de code, et jamais vers une origine joker', () => {
  const src = read('js/plugins-page.js');
  assert.ok(!/postMessage\([^)]*['"]\*['"]/.test(src), "postMessage vers '*'");
  // Ce qui part de la page : un type, un jeton, un NOM DE FICHIER. Jamais le code du plugin —
  // ce serait faire du canal un canal d'exécution.
  assert.match(src, /postMessage\(\{type: MESSAGE_INSTALL, key: catalogKey, file: file\}\)/);
  assert.ok(!/\bcode\b/.test(src.slice(src.indexOf('function requestInstall'), src.indexOf('// ---------- branchements'))),
    'requestInstall ne doit jamais manipuler de code');
  // Et le jeton ne reste pas dans la barre d'adresse.
  assert.match(src, /history\.replaceState\(null, '', location\.pathname \+ location\.search\)/);
});

test('le jeton voyage dans le FRAGMENT, qui ne part pas au serveur', () => {
  // `?k=` l'enverrait au serveur et le poserait dans ses journaux d'accès.
  const src = read('js/plugins.js');
  assert.match(src, /window\.open\('plugins\.html#k=' \+ catalogGate\.key/);
  assert.ok(!/plugins\.html\?k=/.test(src), 'le jeton ne doit pas passer par la requête');
  // Tiré à CHAQUE ouverture : une page fermée ne rouvre pas la porte.
  assert.match(src, /catalogGate\.key = newCatalogKey\(\);/);
});

test('le gestionnaire de plugins ouvre le catalogue, et l\'éditeur écoute au démarrage', () => {
  const src = read('js/plugins.js');
  // Le bouton existe, et il est branché — un bouton non branché est le défaut de la v0.185.1.
  assert.match(src, /id="plug-catalog"/);
  assert.match(src, /getElementById\('plug-catalog'\)\.addEventListener\('click', openPluginCatalog\)/);
  // L'écoute est branchée au démarrage : sans cet appel, la page parlerait dans le vide.
  assert.match(src, /listenPluginCatalog\(\);/);
  assert.match(src, /export function listenPluginCatalog/);
  // Le chemin de lecture est CONSTRUIT ici, à partir du nom validé, jamais reçu tel quel.
  assert.match(src, /fetch\('exemples\/' \+ file\)/);
});

test('le catalogue s\'ouvre depuis le menu Fichier, pas seulement depuis la modale', () => {
  // Deux portes d'entrée, parce qu'elles ne servent pas au même moment : la modale pour qui
  // gère ses plugins, le menu pour qui en cherche un et ne sait pas encore où regarder.
  const src = read('js/ui.js');
  assert.match(src, /Parcourir le catalogue…'[^}]*openPluginCatalog\(\)/);
  assert.match(src, /import \{ modalPlugins, openPluginCatalog \} from '\.\/plugins\.js'/);
  // Et gérer ses plugins reste accessible : le sous-menu ne doit pas avoir remplacé la modale.
  assert.match(src, /Plugins installés…'[^}]*modalPlugins\(\)/);
});

test('le guide des plugins dit comment entrer au catalogue', () => {
  // Le test plus haut EXIGE qu'un plugin livré soit catalogué. Une exigence qui n'est écrite
  // que dans un test se découvre au rouge ; celle-ci doit se lire avant.
  const doc = read('docs/PLUGINS.md');
  assert.match(doc, /exemples\/catalogue\.json/);
  assert.match(doc, /plugins\.html/);
});

test('le manifeste est cherché là où la page est servie', () => {
  assert.equal(CATALOG_URL, 'exemples/catalogue.json');
  assert.ok(existsSync(path.join(root, CATALOG_URL)));
});

test('le catalogue s\'ouvre DANS l\'éditeur : pas d\'onglet à part qui perd le projet et le jeton', () => {
  // v0.187.0 — l'onglet séparé installait par un jeton que seul l'onglet d'origine gardait, et
  // son lien « ← Éditeur » ouvrait un éditeur neuf, sans le projet : plus rien ne s'installait.
  const src = read('js/plugins.js');
  const body = src.slice(src.indexOf('export function openPluginCatalog()'), src.indexOf('function catalogCardHtml'));
  assert.ok(body.length > 0 && !/window\.open/.test(body), 'openPluginCatalog ne doit plus ouvrir d\'onglet');
  assert.match(body, /openModal\('Catalogue de plugins'/);
  assert.match(src, /installFromCatalog\(file, renderPluginCatalog\)/);
});

test('un plugin livré n\'appelle que des entrées d\'Editor.api qui existent, jamais une globale du copilote', () => {
  // v0.187.0 — le Pont MCP appelait `copToolsApi()`/`copRun()` et `Editor.api.ouvrirModal` :
  // globales disparues avec les modules, alias français supprimés. ReferenceError au clic.
  const api = read('js/plugins.js');
  for(const f of readdirSync(path.join(root, 'exemples')).filter((n) => /^plugin-.*\.js$/.test(n))){
    const src = read('exemples/' + f);
    assert.ok(!/\b(copToolsApi|copRun)\s*\(/.test(src), f + ' appelle une globale du copilote');
    for(const k of new Set([...src.matchAll(/Editor\.api\.([A-Za-z]+)/g)].map((m) => m[1]))){
      assert.match(api, new RegExp('^\\s*(get )?' + k + '\\b', 'm'), f + ' : Editor.api.' + k + ' n\'existe pas');
    }
  }
});

test('réinstaller un plugin ne double pas son entrée de menu', () => {
  // v0.187.0 — « ↻ Réinstaller » rejouait le plugin, qui repoussait son `registerCommandMenu`
  // à côté de l'ancien : Extensions → Pont MCP… apparaissait deux fois.
  const src = read('js/plugins.js');
  assert.match(src, /action: def\.action, plugin: Editor\.inProgress\}/, 'l\'entrée doit porter son plugin');
  const run = src.slice(src.indexOf('export function runPlugin(p){'), src.indexOf('Editor.inProgress = p.name;', src.indexOf('export function runPlugin(p){')));
  assert.match(run, /removePluginMenuItems\(p\.name\)/, 'runPlugin doit purger les entrées avant de rejouer');
});
