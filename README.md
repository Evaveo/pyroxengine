# PyroxEngine

Éditeur de niveaux et moteur de jeu 3D/2D dans le navigateur, construit sur
[Three.js](https://threejs.org). JavaScript sans build : on ouvre les fichiers, on développe.

Site : <https://pyroxengine.com>

## Ce qu'il fait

- Éditeur de scènes 3D et 2D (tilemaps, sprites), hiérarchie, inspecteur, prefabs.
- Architecture à composants : physique, animation, audio, particules.
- Scripts de jeu en JavaScript, avec une API documentée (`docs/API-IA.md`).
- Événements visuels « Quand… Alors… » pour les comportements sans code.
- Plugins (`docs/PLUGINS.md`).
- Copilote IA intégré, avec votre propre clé d'API.
- Liaison avec Blender (`outils/blender-addon/`).
- Export d'un jeu en page web autonome ou en application de bureau.

## Démarrer

Aucune installation n'est nécessaire pour utiliser l'éditeur : il suffit de servir ce dossier
avec n'importe quel serveur de fichiers statiques.

```bash
npx http-server -p 8000
# ou
python -m http.server 8000
```

Puis ouvrir <http://localhost:8000/hub.html>.

## Tests

Les tests tournent dans Node, sans navigateur (harnais `test/engine-env.mjs`).

```bash
npm ci
npm test
```

## Versions

Le moteur suit SemVer. Chaque version a sa note dans [`ChangeLogs/`](ChangeLogs/), et les
règles sont dans [`ChangeLogs/VERSIONING.md`](ChangeLogs/VERSIONING.md).

## Contribuer

Le code s'écrit en anglais (noms de fonctions, variables, fichiers). Les commentaires, la
documentation et les textes de l'interface sont en français.

Ce dépôt est un miroir publié à chaque version depuis notre dépôt de travail. Les tickets et
les pull requests sont les bienvenus : une contribution acceptée est reportée dans la version
suivante.

## L'équipe

PyroxEngine est développé par Evaveo. Il doit beaucoup à celles et ceux qui l'ont construit au
quotidien, et nous tenons à saluer tout particulièrement la participation active de :

- **Sébastien Chevallier**
- **Loïc Lextrait**
- **Laurent Matheis**
- **Paul Thomas Ravel**

Merci à eux : ce moteur est aussi le leur.

## Licence

[MIT](LICENSE) — © 2026 Evaveo.
