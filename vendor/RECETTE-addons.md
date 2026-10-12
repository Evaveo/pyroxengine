# Comment `three-addons.min.js` a été fabriqué

**Une seule instance de three.js** (v0.173.2). L'éditeur et les jeux chargeaient deux
three.js complets : le bundle classique `vendor/three.min.js` (three **et** ses addons) et le
paquet ESM `vendor-esm/three.webgpu.min.js`, fusionné dans `window.THREE` par
`js/render-webgpu-bridge.mjs`. Deux compteurs d'id `Object3D` indépendants, donc des ids en
collision entre le gizmo et les objets de projet (voir `docs/KNOWN_ISSUES.md`), et
l'avertissement « Multiple instances of Three.js being imported » dans chaque console.

Le bundle classique n'apportait en réalité que **trois addons** absents du paquet ESM :
`GLTFLoader`, `FBXLoader` et `TransformControls`. Le reste de ce qu'il exposait en propre
(`WebGLRenderer`, `ShaderChunk`, `ShaderLib`, `UniformsLib`, `UniformsUtils`,
`WebGLCubeRenderTarget`, `WebGLUtils`) n'était utilisé que par le renderer de vignettes
(`js/assets.js`, passé en `WebGPURenderer({forceWebGL: true})`) et par deux replis gardés par
`if(THREE.WebGLCubeRenderTarget)` (`js/probes.js`, `js/game-runtime.js`), jamais pris puisque
tous les renderers sont des `WebGPURenderer`.

Ce fichier contient ces trois addons — plus les deux lecteurs d'images HDR ajoutés pour le
ciel HDRI (voir plus bas) —, **recompilés contre le `THREE` du pont** : l'import
`'three'` y est remplacé par `globalThis.THREE`. Il est chargé **juste après** le pont, en
`<script defer>` (un module et un script différé s'exécutent dans l'ordre du document).

Source : paquet npm **`three@0.185.1`**, la version exacte de `vendor-esm/`.

| | Taille brute |
|---|---|
| `vendor/three.min.js` (n'est plus chargé par aucune page) | 851 Ko |
| `vendor/three-addons.min.js` (avec HDRLoader et EXRLoader) | 152 Ko |

Chaque jeu publié allège donc son code de ~700 Ko avant compression.

## Les lecteurs HDR (ciel HDRI, ajoutés après la v1.8.2)

`HDRLoader` (Radiance `.hdr`, RGBE — le nouveau nom de `RGBELoader` en r185) et `EXRLoader`
(OpenEXR `.exr`) servent au ciel HDRI : un panorama équirectangulaire HDR posé comme ciel de la
scène et comme éclairage d'environnement (`js/environment-map.js`, `textureFromHdr`). Le
navigateur ne décode aucun des deux formats dans une balise `<img>`, d'où les lecteurs de three.

- **+30 Ko bruts**, dont l'essentiel est le décompresseur zlib d'`EXRLoader`
  (`examples/jsm/libs/fflate.module.js`, embarqué par esbuild). Il est distinct de
  `vendor/fflate.js` (le zip du build), que la page charge en global : le partager aurait demandé
  de réécrire l'import d'`EXRLoader`, ce que la recette s'interdit.
- Aucune dépendance réseau : les deux lecteurs travaillent sur un `ArrayBuffer` déjà en mémoire
  (`createDataTexture`), jamais par `FileLoader`.
- Toujours lus en **demi-flottant** (`setDataType(THREE.HalfFloatType)`) : filtrable sur tous les
  GPU, contrairement au flottant 32 bits.

Vérifié le 2026-10-12 : la recette ci-dessous, rejouée SANS les deux lignes HDR, redonne le fichier
précédent octet pour octet (hors ligne d'en-tête) — l'ajout ne change rien aux trois addons d'avant.

`vendor/three.min.js` **reste dans le dépôt** : le harnais de tests (`test/engine-env.mjs`)
l'exécute dans `node:vm` comme THREE factice. Aucune page ne doit le charger — le test
`test/three-instance-unique.test.mjs` y veille.

## Refaire le fichier

Dans un dossier jetable, hors du dépôt :

```bash
npm init -y
npm install three@0.185.1 esbuild@0.25
```

`entry.js` :

```js
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
const T = globalThis.THREE;
T.GLTFLoader = GLTFLoader;
T.FBXLoader = FBXLoader;
T.TransformControls = TransformControls;
T.HDRLoader = HDRLoader;
T.EXRLoader = EXRLoader;
```

`build.mjs` :

```js
import * as esbuild from 'esbuild';
const globalThree = { name: 'global-three', setup(b) {
  b.onResolve({ filter: /^three$/ }, () => ({ path: 'three', namespace: 'global-three' }));
  b.onLoad({ filter: /.*/, namespace: 'global-three' },
    () => ({ contents: 'module.exports = globalThis.THREE;', loader: 'js' }));
} };
await esbuild.build({ entryPoints: ['entry.js'], bundle: true, format: 'iife', minify: true,
  target: 'es2020', outfile: 'three-addons.min.js', plugins: [globalThree], legalComments: 'none' });
```

`node build.mjs`, puis copier `three-addons.min.js` dans `moteur/vendor/` en le faisant précéder de
sa ligne d'en-tête (un commentaire `/* three@0.185.1 examples/jsm : … */` qui liste les addons
contenus) : esbuild, avec `legalComments: 'none'`, n'en écrit aucune.

**À la prochaine montée de version de three** : refaire ce fichier avec la même version que
`vendor-esm/`. Un addon compilé contre une autre révision que le pont hériterait de classes qui
ne correspondent plus.
