# Versionnage de l'éditeur

L'éditeur (dossier `moteur/`) suit [Semantic Versioning 2.0.0](https://semver.org/lang/fr/) :
`MAJOR.MINOR.PATCH`, par exemple `0.9.0`.

La version courante est définie par la constante `VERSION_ENGINE` dans
[`moteur/js/version.js`](../moteur/js/version.js), affichée dans la barre d'outils et dans la
modale « À propos ». Elle est **doublée** dans [`moteur/package.json`](../moteur/package.json) :
les deux doivent être bumpées **ensemble**, et `moteur/test/doc-versionnage.test.mjs` échoue
si elles divergent.

## Règles

- **MAJOR** — incrémenté pour un changement cassant : format de projet `.p3d` qui ne peut plus
  être lu sans migration manuelle, API de script (`api.*`) qui change de signature ou disparaît,
  API de plugin (`Editor.*`) qui change de contrat. Tant que l'éditeur est en `0.x`, un
  changement cassant reste possible sur un `MINOR` (voir « Avant 1.0.0 » ci-dessous).
- **MINOR** — incrémenté pour un ajout de fonctionnalité additive : nouvelle capacité de
  l'éditeur, nouveau champ de format de projet migré automatiquement (voir
  `moteur/js/serialisation.js:MIGRATIONS`), nouvelle entrée d'API de script rétrocompatible.
  Dans ce projet, un **lot** (« Lot N » des plans d'implémentation sous
  `docs/superpowers/plans/`) correspond typiquement à un incrément `MINOR`.
- **PATCH** — incrémenté pour une correction de bug sans changement de schéma ni d'API : le
  comportement observable change, mais aucun projet existant ni aucun script existant n'a besoin
  d'être modifié.

## Avant 1.0.0

L'éditeur est en développement pré-stable (`0.x.y`). Par convention SemVer, la compatibilité
n'est **pas garantie** entre deux versions `0.x` — un `MINOR` peut donc, en pratique, inclure un
changement qui serait `MAJOR` après la sortie de `1.0.0`. `1.0.0` marquera le premier engagement
de stabilité du format de projet et de l'API de script.

## Où sont documentés les changements

Chaque version publiée a son propre fichier `ChangeLogs/vMAJOR.MINOR.PATCH.md`, qui résume :
- les fonctionnalités ajoutées ;
- les corrections de bugs ;
- les changements de format de projet (avec le numéro de migration correspondant dans
  `serialisation.js`) ;
- les changements d'API (scripts, plugins) s'il y en a.

Le format suit celui de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), sections
`Ajouté` / `Modifié` / `Corrigé` / `Cassant`.

## Processus pour une nouvelle version

1. Terminer et committer le travail de la version.
2. Décider MAJOR/MINOR/PATCH selon les règles ci-dessus.
3. Mettre à jour `VERSION_ENGINE` dans `moteur/js/version.js` **et** le champ `version` de `moteur/package.json` (les deux doivent rester identiques).
4. Créer `ChangeLogs/vX.Y.Z.md` à partir du modèle ci-dessous.
5. Committer les deux ensemble.

```markdown
# vX.Y.Z — AAAA-MM-JJ

## Ajouté
- ...

## Modifié
- ...

## Corrigé
- ...

## Cassant
- ...  (uniquement si MAJOR, ou si un changement cassant est accepté en 0.x — expliquer pourquoi)
```
