# Comment `three-draco`, `three-meshopt` et `three-ktx2` ont été fabriqués

Trois bundles **classiques** (IIFE) qui accrochent leurs classes sur le `THREE` global déjà
posé par `three.min.js` — même principe que la vendorisation de r185, mais en fichiers
séparés pour que `js/build.js` puisse n'embarquer que ce dont un projet a besoin
(le transcodeur Basis pèse à lui seul 390 Ko dans le ZIP).

Source : paquet npm **`three@0.185.1`**, exactement la version de `three.min.js`.

| Fichier | Contenu | Brut |
|---|---|---|
| `three-draco.min.js` | `examples/jsm/loaders/DRACOLoader.js` + `examples/jsm/libs/draco/**gltf/**` | 316 Ko |
| `three-meshopt.min.js` | `examples/jsm/libs/meshopt_decoder.module.js` | 26 Ko |
| `three-ktx2.min.js` | `examples/jsm/loaders/KTX2Loader.js` + `examples/jsm/libs/basis/` | 803 Ko |

Variante `draco/gltf/` et non `draco/` : 192 Ko de wasm au lieu de 285 Ko. C'est la build
« maillages glTF seulement », et le glTF est notre unique porte d'entrée Draco.

## Les trois décisions qui ne sont pas évidentes

1. **Le décodeur est embarqué en base64, pas livré en fichier à côté.** `three` va chercher
   ses décodeurs avec `FileLoader`, donc `fetch()`. Un jeu publié s'ouvre en double-cliquant
   `index.html` : origine `file://`, où `fetch()` d'un fichier est refusé. Livrer
   `draco_decoder.wasm` à côté aurait donné une fonctionnalité qui marche chez nous (éditeur
   servi en http) et échoue chez le joueur — la panne asymétrique la plus coûteuse.

2. **L'amorçage passe par `THREE.Cache`, pas par une réécriture de `three`.** `KTX2Loader.init()`
   appelle `FileLoader` sans exposer de point d'accroche ; recopier ses 45 lignes ici les
   ferait pourrir à la prochaine montée de version. On dépose donc le contenu dans le cache
   sous la clé exacte que `FileLoader` calculera (`'file:' + manager.resolveURL(url)`), le
   temps de l'amorçage seulement — les lectures de cache de `FileLoader` sont synchrones,
   dans `load()`, donc `Cache.enabled` retrouve sa valeur d'avant dès le retour.

3. **Les URL par défaut pointent vers `https://decodeur.invalid/`.** `DRACOLoader` et
   `KTX2Loader` construisent leurs chemins depuis `import.meta.url`, qui n'existe pas en
   IIFE : sans une valeur définie, `new URL(x, undefined)` lève au chargement. Le TLD
   `.invalid` garantit un échec DNS **bruyant** si le pré-remplissage du cache cessait un
   jour de fonctionner, au lieu d'un décodeur qui télécharge en silence.

## Refaire les fichiers

Le dépôt n'a pas d'étape de build : ces fichiers sont générés une fois, hors dépôt, et
commités. Pour les régénérer (montée de version de three, par exemple) :

```sh
npm i three@0.185.1 esbuild
node vendoriser.mjs           # esbuild --bundle --format=iife --minify
                              # --define:import.meta.url='"https://decodeur.invalid/jsm/loaders/x.js"'
                              # + un plugin qui résout 'three' vers globalThis.THREE
```

Le script complet est celui décrit ci-dessus : une entrée synthétique par bundle, un plugin
`onResolve` sur `three` qui renvoie `export const { … } = globalThis.THREE` (seulement les
noms réellement importés, sinon ~28 Ko de réexports morts par fichier), et les charges
utiles injectées en constantes.

## Ce que les tests vérifient

`moteur/test/compression-assets.test.mjs` décode de **vrais** fichiers compressés
(`test/fixtures-compression/`) avec `fetch()` qui lève, et transcode le même KTX2 vers deux
formats selon le GPU simulé. Voir l'en-tête du fichier pour les contrôles.

**Non vérifié** : `new Worker(blobURL)` depuis une page `file://` — voir
`docs/KNOWN_ISSUES.md`.
