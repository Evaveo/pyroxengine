# PyroxEngine — Spécifications fonctionnelles et techniques

> **Point d'entrée** : `editor.html` — application multi-fichiers (`css/`, `js/`, `vendor/`),
> 100 % hors ligne, à ouvrir directement ou via un petit serveur statique.
> `editeur-3d (1).html` est l'ancienne version mono-fichier, conservée en archive (ne plus la maintenir).
> **Public** : équipe de développement — intégration, maintenance, évolution.
> **Version du document** : 2026-08-03 (v3).

## 0. Structure des fichiers

```
editor.html          point d'entrée : HTML + ordre de chargement des modules
css/editor.css       tout le style
vendor/               bibliothèques embarquées (ne pas modifier)
  three.min.js        three.js r185, build classique (global THREE) · loaders FBX/glTF ·
                      TransformControls
  cannon.js           cannon.js 0.6.2      fflate.js  fflate
vendor-esm/           three.js r185 en modules ES, résolus par l'<importmap> d'editor.html
  three.webgpu.min.js WebGPURenderer — three ne publie plus de build global pour lui
  three.tsl.min.js    TSL (système de nœuds)      three.core.min.js  cœur partagé
js/                   code applicatif — scripts classiques, portée globale partagée,
                      L'ORDRE DES <script> DANS editor.html EST SIGNIFICATIF
                      et TOUS doivent être `defer` (voir render-webgpu-bridge.mjs)
  scene.js            scène three.js, caméra orbitale, gizmo, filtres d'affichage
  objects.js           fabrication des primitives/lumières/caméras, helpers, clonage
  assets.js           panneau Projet, import FBX/glTF/textures, drag & drop
  selection.js        sélection simple + multi-sélection
  hierarchy.js       arbre (pliage, renommage, visibilité, filtre), barre de statut
  inspector.js       tout l'inspecteur (transform, matériau, collider, physique, jeu, script)
  import-settings.js    panneau d'inspecteur des assets : paramètres d'import, unités,
                      emplacements de matériaux, éditeur de matériau, glisser-déposer
  material-extraction.js  « Extract Materials » : convention de nommage (préférence),
                      matériaux extraits d'un modèle, textures branchées par leur nom
  viewport.js         interactions souris, clavier, boucle de rendu, redimensionnement
  animation.js        timeline, clés, easing
  physics.js         cannon.js : corps dynamiques + cinématiques, colliders
  scripts.js          moteur de scripts JS, API, éditeur, doc
  view-tools.js       aimant du gizmo, cadrage (F)
  history.js       annuler/rétablir (instantanés)
  serialization.js    sauvegarde .p3d, chargement, export données de jeu
  play-mode.js         mode Édition / Lecture / Pause
  project.js           projet multi-scènes
  materials.js        assets matériaux (création, fabrication three, affectation, synchro)
  build.js            export du build Web jouable (zip)
  game-runtime.js      LECTEUR AUTONOME copié dans les builds — ne dépend d'aucun
                      autre fichier js/ ; jamais chargé par editor.html
  ui.js               menus, modales, poignées de redimensionnement
  startup.js        scène par défaut, lancement de la boucle
```

---

## 1. Vue d'ensemble

Éditeur de scènes 3D dans le navigateur, dans l'esprit d'un mini-Unity, destiné au prototypage
de niveaux pour petits studios de jeu. Il couvre le cycle complet :

**créer → hiérarchiser → habiller (matériaux/textures) → configurer (colliders, tags, physique)
→ animer → simuler → sauvegarder → exporter vers un runtime de jeu.**

### 1.1 Pile technique

| Couche | Technologie | Emplacement |
|---|---|---|
| Rendu | three.js **r185**, `WebGPURenderer` — backend WebGPU, **repli WebGL2 automatique** assuré par three (pas par nous) | `vendor/three.min.js` (global) + `vendor-esm/` (modules ES, licence MIT) |
| Shaders | **TSL** (système de nœuds three) — `WebGPURenderer` n'exécute pas les `ShaderMaterial` GLSL bruts | `vendor-esm/three.tsl.min.js` |
| Physique | cannon.js **0.6.2** | embarqué inline (MIT) |
| Compression | fflate | embarqué inline (MIT) |
| Import 3D | FBXLoader, GLTFLoader (r185) | embarqués inline (MIT) |
| Manipulation | TransformControls (r185) | embarqué inline (MIT) |
| Application | ~58 modules `js/*.js` en scripts classiques `defer`, portée globale partagée ; code et UI en français | `js/`, ordre imposé par `editor.html` |

Aucun build, aucun serveur requis : ouvrir le fichier dans un navigateur suffit
(Chrome/Edge/Firefox récents ; WebGL requis).

### 1.2 Disposition de l'interface

Grille CSS redimensionnable (poignées glissables, double-clic = taille par défaut) :

```
┌────────────────────────────────────────────────────────┐
│ Barre de menus (Fichier · Édition · Objet · Affichage · Aide)
├────────────────────────────────────────────────────────┤
│ Barre d'outils (gizmo · primitives · lumières · caméra · simulation)
├───────────┬────────────────────────────────┬───────────┤
│ Hiérarchie│ Viewport 3D (filtres, statut,  │           │
│ (arbre)   │ aide, aperçu caméra)           │ Inspecteur│
├───────────┴────────────────────────────────┤ (pleine   │
│ Panneau bas : Projet (assets) / Animation  │  hauteur) │
└─────────────────────────────────────────────┴──────────┘
```

---

## 2. Fonctionnalités — par catégorie

### 2.0 Mode Édition / Lecture / Pause (style Unity)

- **▶ Jouer** : instantané complet de la scène, puis lancement simultané des
  **animations** (depuis t = 0), de la **physique** (corps dynamiques + obstacles
  cinématiques animés) et des **scripts**. Liseré bleu autour du viewport.
- **⏸ Pause** (`Espace` en mode lecture) : fige le temps, la physique et les scripts.
- **⏹ Arrêter** (`Échap` ou re-clic) : **restauration intégrale** de la scène
  (transforms, propriétés modifiées par les scripts) — mode non destructif.
- En mode lecture : gizmo, drag, historique et bouton ⚙ Physique désactivés.
- **⚙ Physique** reste disponible en mode édition pour une simulation physique seule
  (poser des objets, tester des empilements).

### 2.0 bis Projet multi-scènes

- Un **projet** = plusieurs **scènes** + le panneau Projet (assets) **partagé**.
- Panneau **Scènes** au-dessus de la hiérarchie : clic = activer (la scène quittée est
  sérialisée automatiquement), `＋` = nouvelle scène, double-clic = renommer,
  `×` = supprimer (≥ 1 scène conservée).
- L'historique annuler/rétablir est **par scène** (vidé au changement).
- Menu Fichier : Nouveau projet · Nouvelle scène · Vider la scène courante ·
  Ouvrir / Enregistrer le projet (`.p3d`) · Exporter les données de jeu (scène courante).

### 2.0 ter Environnement de scène (équivalent WorldEnvironment de Godot)

Édité dans l'**inspecteur quand aucun objet n'est sélectionné**, sérialisé **par scène**,
inclus dans l'export runtime (champ `environnement`) :

- **Ciel** : couleur unie, **dégradé** (haut/bas, dôme sphérique), ou **panorama image**
  (texture équirectangulaire choisie parmi les assets du panneau Projet).
- **Brouillard** : actif, couleur, distances début/fin.
- **Éclairage global** : intensité + teinte de l'ambiante (hémisphérique), intensité du soleil.

### 2.1 Objets de scène

| Type | Détail |
|---|---|
| Primitives | Cube, Sphère, Cylindre, Cône, Tore, **Plan** (4×4, double face) — `MeshStandardMaterial`, couleur aléatoire d'une palette |
| **Groupe** | nœud vide d'organisation (équivalent Node3D de Godot) : proxy octaèdre filaire, sans ombre ni physique, sert de parent |
| Lumières | Ponctuelle, Spot, Directionnelle — mesh-proxy émissif + helper visuel ; cible orientable pour spot/directionnelle ; ombres 1024² |
| Caméras | Caméra de scène avec aperçu picture-in-picture 16:9 et mode « voir à travers » (bandeau + `Échap` pour sortir) |
| Modèles importés | GLB / glTF / FBX, **convertis en mètres** depuis l'unité du fichier (posés au sol, centrés X/Z) — réglable par asset, voir 2.9 |
| Prefabs | **Liés** : créés depuis une sélection (qui devient la 1re instance), instanciés par glisser-déposer. Section « Prefab lié » de l'inspecteur : indicateur **● modifié**, **⇪ Appliquer au prefab** (synchronise les autres instances de la scène), **⟲ Réinitialiser l'instance** (transform racine conservée), **🧬 Créer une variante** (prefab dérivé, champ `base`), **✂ Rendre unique**. Renommage par double-clic sur la tuile. v1 : appliquer sur la base ne cascade pas vers les variantes. |

Chaque objet porte : nom éditable, transform local (position / rotation / échelle),
et les données décrites en 2.5 (matériau), 2.6 (collider), 2.7 (physique), 2.8 (jeu).

### 2.2 Sélection et manipulation

- **Sélection simple** : clic (viewport ou hiérarchie). Surbrillance émissive.
- **Multi-sélection** : `Ctrl+clic` ajoute/retire un objet (viewport ou hiérarchie).
  L'objet **principal** (orange) porte le gizmo et l'inspecteur ; les **secondaires** (vert)
  suivent les deltas de translation/rotation/échelle. Parent et enfant ne peuvent pas
  coexister dans une même sélection. `Échap` vide la sélection secondaire.
- **Gizmo** : déplacer / tourner / échelle (`1`/`2`/`3`), aimant optionnel
  (pas 0,5 u · 15° · 0,1).
- **Déplacement** : uniquement via le gizmo (`1`/`2`/`3`) ; le clic gauche ne fait plus
  que sélectionner (Lot 3).
- **Rubber band** : glisser un rectangle depuis le vide sélectionne tous les objets
  racine dont le centre tombe dedans ; `Maj` ajoute à la sélection existante.
- **Caméra éditeur** : orbite (glisser dans le vide), vol libre (clic droit maintenu :
  regarder + `W`/`A`/`S`/`D`/`Q`/`E`, molette = vitesse de vol), pan (clic molette),
  zoom (molette), cadrage sur la sélection (`F`).

### 2.3 Hiérarchie

- Arbre complet de la scène avec icônes par type.
- **Pliage/dépliage** par nœud (▼/▶) ; **renommage** par double-clic sur le nom
  (Entrée valide, Échap annule) ; **visibilité** par œil (👁/🚫, objets masqués grisés,
  état sauvegardé et exporté) ; **filtre par nom** (déplie tout pendant la recherche).
- **Reparentage** par glisser-déposer d'un nœud sur un autre (`attach` : conserve la
  transform monde). Dépôt dans le vide = détachement à la racine.
- Garde-fou anti-cycle (impossible de set_parent un objet à son propre descendant).

### 2.4 Historique — annuler / rétablir

- `Ctrl+Z` annule, `Ctrl+Y` ou `Ctrl+Maj+Z` rétablit. Pile de **50 instantanés**.
- Un instantané est pris **avant** chaque mutation : création, suppression, duplication,
  collage, reparentage, drag (corps ou gizmo), édition dans l'inspecteur (un instantané
  par prise de focus, pas par frappe), application de texture, instanciation d'asset,
  pose/suppression/déplacement de clé d'animation, nouvelle scène.
- Implémentation : sérialisation complète scène + pistes d'animation (mêmes routines que
  la sauvegarde). Les assets du panneau Projet ne font **pas** partie de l'historique.
  L'historique est vidé au chargement d'une scène. Indisponible pendant la simulation.

### 2.5 Matériaux (primitives)

Édition dans l'inspecteur, section **Matériau** :

| Champ | Propriété three.js |
|---|---|
| Couleur | `material.color` |
| **Lissage (0–1)** | `material.roughness` = **1 − lissage** (voir ci-dessous) |
| Métal (0–1) | `material.metalness` |
| Émissif (couleur) | `material.emissive` (+ `userData.emissiveBase` pour la surbrillance) |
| Opacité (0–1) | `material.opacity` / `transparent` |

Les textures (2.9) écrasent la couleur en blanc à l'application. Les modèles importés
gardent leurs matériaux d'origine tant qu'aucun asset matériau ne leur est affecté.

##### L'éditeur travaille en lissage (smoothness), three en rugosité

**`lissage` = 1 pour un miroir, 0 pour un mat parfait** — la convention d'Unity, celle dans
laquelle sont peintes les textures de la plupart des pipelines, et **déjà celle du canal
alpha du masque combiné**. Avoir un curseur en rugosité en face d'un masque en lissage
obligeait à faire la soustraction de tête, et c'était le seul endroit du logiciel où deux
conventions opposées se côtoyaient.

- three ne connaît que `roughness` : la conversion se fait dans
  `rugositeDepuisLissage()` / `lissageDepuisRugosite()` (`materials.js`), **les deux seuls
  endroits** qui inversent — plus `rugositeRuntime()`, leur miroir dans `game-runtime.js`.
- Les deux fonctions **arrondissent au millionième**. Ce n'est pas cosmétique : `1 − 0,55`
  vaut `0.44999999999999996` en binaire, valeur qui finissait écrite dans chaque projet
  enregistré et affichée telle quelle dans le champ de l'inspecteur (le pas est de 0,05).
##### Le paramètre multiplie sa map — et le lissage se multiplie dans le shader

Chaque paramètre **multiplie** la map de son canal : `lissage × lissage`, `métal × métal`,
`couleur émissive × map`. La valeur neutre est donc **1** (blanc pour une couleur) : c'est ce
qu'on met pour laisser la texture passer telle quelle.

- Pour le **métal** et l'**émissif**, three le fait déjà et dans le bon sens
  (`metalnessFactor *= texelMetalness.b`, `totalEmissiveRadiance *= emissiveColor.rgb`) :
  rien à faire.
- Pour le **lissage**, non — et c'est le seul cas qui demande du travail. three raisonne en
  rugosité et calcule `roughnessFactor = roughness × texel.g`, donc il multiplie **deux
  rugosités**. Ce qu'on veut, c'est multiplier **deux lissages** :

  ```
  lissage_final  = lissage_map × lissage_param
  rugosité_final = 1 − (1 − texel.g) × (1 − roughness)
  ```

  Aucun réglage de three ne produit cette formule : un facteur scalaire ne peut pas agir dans
  l'espace inverse du sien. Elle est posée par `multiplierEnLissage()` (`materials.js`, miroir
  `...Runtime` dans `game-runtime.js`, pour qu'un build rende comme l'éditeur), en **deux
  exemplaires assumés — un par pipeline de rendu** :
  - **nœud TSL sur `roughnessNode`** pour `WebGPURenderer`, le chemin normal de l'éditeur
    comme des builds. Le nœud est posé sur le `MeshStandardMaterial` classique, ce qui
    suffit : `NodeLibrary.fromMaterial()` recopie toutes les propriétés énumérables vers le
    `MeshStandardNodeMaterial` qu'il fabrique. Il est construit avec `materialReference`, le
    primitif dont three se sert lui-même pour sa rugosité — on hérite donc de sa gestion des
    UV et de sa relecture du matériau, on ne remplace que son `×` par la formule ci-dessus.
  - **patch GLSL du chunk `roughnessmap_fragment`** via `onBeforeCompile`, pour le renderer
    WebGL classique, qui ne sert plus qu'aux vignettes d'assets (`js/assets.js`).

  > ⚠ `onBeforeCompile` n'est **jamais appelé** sous le système de nœuds. C'est ce qui avait
  > laissé le lissage s'appliquer à l'envers après la migration WebGPU, sans un mot : le
  > repli d'avertissement vivait *à l'intérieur* de la fonction jamais appelée. Un repli qui
  > dépend de ce qu'il protège n'en est pas un. Un avertissement est désormais émis si TSL
  > manque alors que le rendu passe par les nœuds. Tests : `test/lissage-tsl.test.mjs`, qui
  > **évalue** le graphe produit plutôt que de constater sa présence.
- Le paramètre reste une valeur **lue au rendu** (`uniform` en GLSL, référence au matériau en
  TSL) : le curseur reste vivant. Repacker la texture à la place aurait coûté un passage sur
  chaque pixel à chaque mouvement du curseur.
- `customProgramCacheKey` renvoie `'lissage-multiply'` : **sans elle**, three réutiliserait
  le programme non patché déjà compilé pour un `MeshStandardMaterial` équivalent, et le patch
  n'aurait aucun effet visible. Le patch n'est posé que si une `roughnessMap` existe.
- Si le motif GLSL cherché disparaît d'une future version de three, le patch **ne casse
  rien** : on retombe sur la multiplication de three, et un **avertissement console** le dit
  une fois — plutôt qu'un PBR faux en silence. `test/lissage.test.mjs` surveille ce motif.
- **Émissif** : noir par défaut, donc rien n'émet. Brancher une map émissive **passe la
  couleur à blanc** (sinon la map serait multipliée par du noir et n'apparaîtrait pas), la
  débrancher la **remet à noir** (sinon l'objet resterait à émettre du blanc uni). Dans les
  deux sens, `ajusterEmissifSelonMap()` ne touche qu'à la valeur qu'il a posée lui-même : une
  teinte choisie à la main n'est jamais écrasée.
- *Int. normale* et *Int. AO* sont **grisées tant que leur map manque** — elles n'ont aucun
  effet sans elle. C'est le seul grisage : les paramètres qui multiplient restent actifs.
  Brancher ou débrancher une map **reconstruit le panneau** (et seulement dans ce cas :
  reconstruire à chaque `change` volerait le focus des champs numériques).
- Une **map séparée reste encodée en rugosité** — c'est ce que lit three, et ce que
  produisent les suffixes `_R` / `_Roughness`. Le lissage vit dans l'alpha du masque
  combiné.
- **Projets antérieurs** : migration `7 → 8` (`serialization.js`), qui **convertit** la
  valeur au lieu de renommer la clé, sur les matériaux assets, les primitives des scènes et
  celles des templates de prefabs. Un projet rouvert a exactement le même aspect —
  c'est ce que vérifie `test/lissage.test.mjs`. Les chemins non versionnés (scène `.s3d`
  legacy) sont rattrapés par un filet dans `assurerPropsMateriau()`.
- `export-jeu.json` passe en **version 3** : `materiau.rugosite` devient `materiau.lissage`.
  La commande copilote `configure_material` prend `lissage` à la place de `rugosite`.

#### Assets matériaux (🎨, panneau Projet)

- **🎨 Nouveau matériau** : asset réutilisable — couleur, **lissage**, métal, émissif,
  opacité, double face, et **maps PBR complètes** choisies parmi les textures du
  projet : **albedo**, **normale** (+ intensité), **rugosité (map)**, **métal (map)**,
  **occlusion ambiante AO** (+ intensité, `uv2` généré automatiquement) et
  **émissive** — avec **tuilage** et **décalage** UV communs à toutes les maps.
  Aperçu sphère généré automatiquement.
- **Masque combiné** (un seul slot, convention Unity) : **R → métal · G → occlusion ·
  B → ignoré · A → lissage** — la même convention que le curseur *Lissage* du matériau.
  Les canaux sont **repackés
  automatiquement** vers la convention three/glTF (canvas mis en cache par texture) et
  la texture unique alimente les trois slots ; prioritaire sur les maps séparées. Les
  paramètres *Lissage* et *Métal* la **multiplient** (1 = elle passe telle quelle).
  Supporté par le runtime des builds.
- **Affectation** : glisser la tuile sur une **primitive** ou un **modèle importé**
  (viewport ou hiérarchie) — tous les sous-maillages d'un modèle sont habillés.
  L'objet garde `userData.materiauId`.
- **Édition centralisée, dans l'inspecteur** : sélectionner la tuile 🎨 remplit
  l'inspecteur avec **toutes** les propriétés du matériau (aucune modale). Chaque champ
  s'applique immédiatement et **tous les objets** utilisant le matériau — y compris les
  emplacements des modèles importés — sont resynchronisés. Depuis un objet lié, le bouton
  « ✎ Éditer le matériau » sélectionne l'asset. Les **maps PBR acceptent le
  glisser-déposer** d'une tuile de texture du panneau Projet, en plus du sélecteur.
- **✂ Détacher** dans l'inspecteur : l'objet garde son apparence mais ne suit plus l'asset.
- Sérialisé dans le `.p3d` (remappage des ids au chargement, réappliqué à la
  reconstruction — donc suivi par l'undo), exporté en `materials/*.materiau.json`
  (dossier Git), inclus dans `export-jeu.json` (champ `materiau.asset`) et **rendu par
  le runtime des builds Web**.

### 2.6 Colliders (nouveau — découplés du rendu)

Section **Collider** de l'inspecteur (primitives et modèles) :

- **Formes** : `auto` (boîte englobante, défaut), `boîte` (taille XYZ), `sphère` (rayon),
  `cylindre` (rayon + hauteur).
- **Décalage** XYZ par rapport à l'origine de l'objet.
- **Déclencheur (trigger)** : le corps est détecté mais ne bloque pas
  (`collisionResponse = false` côté cannon).
- **Visualisation** : filaire vert affiché sur l'objet sélectionné (comme Unity),
  jamais sérialisé ni cloné, insensible au raycast.
- Les dimensions sont exprimées en unités locales et multipliées par l'échelle monde
  de l'objet au moment de la simulation et dans l'export.
- Stockage : `userData.collider = {forme, dims[3], rayon, hauteur, offset[3], trigger}`.

### 2.7 Physique (cannon.js)

- Opt-in par objet : case **Corps rigide** + masse, rebond (restitution), friction.
- Bouton **▶ Simuler la physique** : instantané des poses → création des corps →
  simulation temps réel → **■ Arrêter** restaure toutes les poses (non destructif).
- Forme du corps : le **collider** de l'objet s'il est défini (2.6), sinon détection
  automatique (sphère/boîte exactes pour ces primitives, boîte englobante avec offset
  compensé pour le reste).
- **Physique ↔ animation** : les objets animés par la timeline deviennent des corps
  **cinématiques** (masse nulle, pilotés par leur pose monde à chaque image) — une
  plateforme ou une porte animée pousse les corps dynamiques pendant la lecture.
  Lancer la lecture (`Espace`) puis la simulation pour combiner les deux.
- Sol infini statique. Matériaux de contact par objet. Gizmo désactivé pendant la
  simulation.

### 2.8 Données de jeu (nouveau)

Section **Jeu** de l'inspecteur, disponible sur **tous** les types d'objets :

- **Tag** : chaîne libre (`ennemi`, `pickup`, `spawn`…).
- **Calque** : chaîne libre (défaut `Défaut`) — pour le filtrage côté runtime
  (rendu, collisions, IA…).
- **Propriétés personnalisées** : paires clé/valeur illimitées, typées automatiquement
  (`"150"` → nombre, `"true"/"false"` → booléen, sinon chaîne). Exemples : `pv`, `vitesse`,
  `equipe`, `butin`.
- Stockage : `userData.jeu = {tag, calque, props{}}` — sérialisé, dupliqué, exporté.

### 2.9 Assets (panneau Projet)

#### Explorateur à dossiers

- **Arborescence** à gauche du panneau : racine 📦 Projet + dossiers imbriqués
  (`Personnages/Textures`…). Clic = naviguer ; la zone de droite montre les
  **sous-dossiers** (tuiles 📁, double-clic pour ouvrir) et les **assets du dossier
  courant**.
- **📁 Dossier** dans la barre d'outils : crée un sous-dossier du dossier courant.
  Dans l'**arborescence**, chaque ligne expose au survol : **＋** (nouveau
  sous-dossier), **✎** (renommer, cascade sur les sous-chemins) et **🗑** (supprimer,
  le contenu **remonte** dans le parent) ; la racine a son **＋**. Les mêmes actions
  existent sur les tuiles 📁. Les dossiers vides sont conservés (`projet.dossiers`).
- **Rangement** : glisser une tuile d'asset sur un dossier de l'arbre **ou** sur une
  tuile 📁. Les nouveaux assets (imports, prefabs, scripts, matériaux) naissent dans
  le dossier courant.
- Sérialisé dans le `.p3d` (champ `dossiers` + `dossier` par asset) ; l'export Git
  range les fichiers d'`assets/` selon leurs dossiers.

- **Import** : bouton ou glisser-déposer (panneau Projet ou viewport) —
  modèles `.glb/.gltf/.fbx` (+ `.bin` et textures annexes résolues par nom de fichier),
  images `.png/.jpg/.webp/.gif/.bmp`.
- **Vignettes 3D** générées par un rendu hors écran.
- **Instanciation** : glisser un modèle/prefab dans le viewport (au point de dépôt).
- **Textures** : glisser sur un objet pour l'habiller (gestion du flipY glTF).
- Message d'erreur explicite pour les glTF compressés Draco (non supportés).

#### Paramètres d'import (clic sur une tuile → inspecteur)

Un **clic simple** sur une tuile sélectionne l'asset : l'inspecteur affiche ses paramètres
d'import au lieu d'un objet de la scène (les deux sélections sont exclusives, la tuile
prend un liseré orange). Les réglages vivent sur `a.paramsImport`, sont **sérialisés**
dans le `.p3d` et **rejoués par le runtime des builds** : l'éditeur et le jeu exporté
normalisent à l'identique. Toute modification est appliquée immédiatement.

| Genre | Paramètres |
|---|---|
| **Modèle** | **Unités du fichier** (auto / m / cm / mm / pouces / pieds) · Échelle · taille réelle affichée · Centrer X/Z · Poser au sol · **emplacements de matériaux** et **🎨 Extraire les matériaux** (voir ci-dessous) |
| **Texture** | **Type** (couleur / normales / données) · **Espace couleur** (auto / sRGB / linéaire) · **Taille max** · Répétition (répéter / bloquer / miroir) · Tuilage U/V · Filtrage (linéaire / proche pour le pixel art) · **Mipmaps** · Anisotropie · Inverser Y (auto / toujours / jamais) |
| **Son** | Volume · Boucle · Spatial 3D · Portée · Pitch — valeurs **posées sur la source** au moment de l'attachement, puis réglables par objet. Bouton ▶ Écouter. |
| **Matériau** | Toutes les propriétés PBR, éditées sur place (voir 2.8 *Assets matériaux*) |
| **Prefab / script** | Aucun (assets créés dans l'éditeur) — renommage, et bouton d'édition pour le script |

- Le transform et les clips **bruts** du fichier sont conservés (`a.brut`,
  `a.animationsBrutes`) : chaque application repart de l'original au lieu d'empiler
  les mises à l'échelle.

##### Unités : l'éditeur travaille en mètres

**1 unité three = 1 mètre**, comme la spec glTF et comme la gravité de cannon
(−9,81 m/s²). Un modèle importé est donc **converti depuis l'unité de son fichier**, pour
faire exactement la taille qu'il a dans Maya, 3ds Max ou Blender. Il n'y a plus de
normalisation « plus grand côté à 3,5 u ».

- **glTF / GLB** : le mètre est imposé par la spec, facteur 1.
- **FBX** : l'unité est déclarée dans `GlobalSettings.UnitScaleFactor` (= *centimètres par
  unité du fichier* : 1 pour Maya / 3ds Max, 100 pour un export en mètres). **FBXLoader
  l'ignore complètement** — un FBX Maya arriverait 100× trop grand. `uniteFbx()`
  (`assets.js`, dupliqué dans `game-runtime.js`) lit donc le facteur directement dans le
  fichier : la propriété est stockée en clair dans les deux formats FBX (binaire et
  ASCII). La recherche est bornée à la fenêtre `GlobalSettings` → `Definitions`, car le
  `PropertyTemplate` de `FbxGlobalSettings` (dans `Definitions`) redéclare la propriété
  avec sa valeur par défaut. Sans information : **centimètres**, le défaut Maya.
- Le sélecteur **Unités** permet de corriger un fichier mal exporté (`auto` par défaut,
  qui affiche l'unité détectée) ; **Échelle** est un multiplicateur libre appliqué après.
- La **taille réelle** du modèle est affichée en m (ou en cm sous 50 cm) : de quoi vérifier
  d'un coup d'œil qu'un personnage fait bien 1,80 m.
- `a.uniteFichier` = mètres par unité du fichier, redétecté à chaque chargement (il n'est
  pas sérialisé — c'est un fait du fichier, pas un réglage).
- **Projets existants** : les instances déjà posées gardent leur échelle sérialisée, donc
  la scène est inchangée ; seuls les nouveaux dépôts et la vignette utilisent la taille
  réelle.
- Case **Mettre à jour** (modèles et sons) : réapplique les réglages aux instances /
  sources **déjà posées** dans la scène — échelle au prorata (un redimensionnement
  manuel reste proportionnel), offset de sol corrigé du delta, ombres. Un instantané
  d'historique est pris avant.
- Les textures propagent leurs réglages à toutes leurs utilisations : clones posés par
  glisser-déposer (marqués `userData.assetTexture`) et **matériaux assets** qui les
  référencent (reconstruits ; leur tuilage propre n'est pas écrasé).

##### Textures : type, espace de couleur, taille max

- **Type** = usage, et il a deux conséquences réelles. Il décide de la **map visée** quand
  on lâche la texture sur un objet (`couleur` → `map` avec la couleur de base blanchie,
  `normale` → `normalMap` sans toucher à la couleur) ; une texture de **données**
  (rugosité, métal, AO, masque combiné) est **refusée** sur un objet avec un message, car
  elle n'a de sens que branchée dans un matériau. Il fixe aussi l'espace de couleur par
  défaut. Rejoué à l'identique par le runtime des builds.
- **Espace couleur** : `auto` / `sRGB` / `linéaire`. Depuis three r152 la gestion des
  couleurs est explicite et **`renderer.outputColorSpace` vaut sRGB par défaut** : l'éclairage
  se calcule en linéaire et l'affichage réencode. `auto` a été écrit pour suivre le pipeline
  sans intervention — il renvoie sRGB si la sortie est en sRGB **et** que le type est
  `couleur`, linéaire sinon. Depuis le passage à r185 il vaut donc bien sRGB sur les textures
  de couleur, et linéaire sur les textures de **données** (normale, rugosité, métal,
  occlusion), dont les octets sont des nombres et non des couleurs. Le rendu a légitimement
  bougé à cette occasion : avant, la sortie linéaire de r128 était *fausse*, et
  « reproduire le comportement d'avant » n'est pas un objectif. Voir `sortieSrgb()` /
  `espaceCouleurTexture()` (`js/import-settings.js`), miroir dans `js/game-runtime.js`.
- **Taille max** (origine / 4096 → 128 px) : réduit l'image envoyée au GPU via un canvas,
  pour la mémoire vidéo. `a.imageSource` garde l'image d'origine, donc le réglage est
  réversible et la résolution est affichée sous la forme `256 × 256 px (source 2048 ×
  2048)`. Le **fichier source reste intact** dans le `.p3d` et dans le build : c'est un
  réglage d'import rejoué au chargement, pas un réencodage. Le cache du masque combiné
  (`cacheCombine`) est invalidé, puisqu'il est repacké depuis l'image.
- **Mipmaps** : à couper pour une texture d'interface ou du pixel art net. Le `minFilter`
  suit (`NearestMipmapNearest` / `LinearMipmapLinear` avec, `Nearest` / `Linear` sans) et
  l'anisotropie est grisée, faute d'effet sans mipmaps.
- L'image arrive de façon **asynchrone** : `creerAssetTexture` passe un callback au
  `TextureLoader`, qui capte `imageSource` / `dimensionsSource` puis rejoue
  `appliquerImportTexture` et rafraîchit le panneau.
- **↺ Par défaut** revient aux valeurs d'origine (y compris les emplacements de matériaux).

#### Emplacements de matériaux d'un modèle (FBX/glTF multi-matériaux)

Un FBX ou un glTF arrive avec ses propres matériaux, souvent **plusieurs** (un par
matériau défini dans le DCC). Chaque matériau du fichier devient un **emplacement
nommé** dans les paramètres d'import, remplaçable par un matériau du projet — comme
l'onglet *Materials* d'un modèle dans Unity.

- La section **Matériaux** liste un sélecteur par emplacement, libellé par le **nom du
  matériau du fichier** (`Carrosserie`, `Vitre`, `Pneu`…), avec le nombre de maillages
  concernés en infobulle. `— du fichier —` garde le matériau importé.
- **Glisser-déposer** : une tuile 🎨 du panneau Projet peut être lâchée directement sur un
  emplacement (liseré pointillé au survol) ; le sélecteur reste utilisable au clavier. Un
  asset du mauvais genre est refusé avec un message. Même geste pour les maps d'un
  matériau (`.ip-slot` + `data-slot` / `data-tex-slot`, gérés dans `import-settings.js`).
- Les maillages **multi-matériaux** (tableau `mesh.material`) sont gérés emplacement par
  emplacement : on peut remplacer la carrosserie sans toucher aux vitres, et la forme du
  tableau est préservée.
- `a.matBruts` garde les matériaux du fichier, indexés dans l'ordre de parcours des
  maillages, ce qui permet de **revenir en arrière** emplacement par emplacement. Les
  visualisations de collider sont exclues du parcours (elles décaleraient les index).
- L'affectation vaut pour **toutes les instances** (case *Mettre à jour* pour celles déjà
  posées) et **suit les modifications du matériau** : éditer un matériau asset
  resynchronise les modèles qui l'utilisent. Le supprimer les fait revenir au fichier.
- Un matériau glissé sur l'objet entier (`userData.materiauId`) **prime** sur les
  emplacements, comme un override de renderer dans Unity : ces instances sont laissées
  telles quelles.
- Stocké dans `paramsImport.materiaux = {nom d'emplacement → id d'asset matériau}`. Au
  chargement d'un `.p3d`, les ids sont **remappés** après la création des assets
  matériaux (créés après les modèles) puis les matériaux réappliqués, avant les prefabs
  et les scènes qui clonent les templates. Le runtime des builds fait le même second
  passage.
- Les matériaux fabriqués ne sont pas libérés : three partage les matériaux au clonage,
  un `dispose()` casserait les instances clonées avant l'affectation.

##### 🎨 Extraire les matériaux (« Extract Materials » d'Unity)

Bouton dans la section **Extraction des matériaux** des paramètres d'import d'un modèle.
Il crée **un asset matériau par emplacement du fichier** et y **branche les textures**
dont le nom concorde. Le fichier arrive avec ses matériaux et le nom de ses textures,
mais rien qui dise quelle image va sur quelle map : le **nom de fichier** est la seule
information disponible, et c'est celle qu'utilisent tous les pipelines de production.
Code : `moteur/js/material-extraction.js`.

- **Où sont cherchées les textures : uniquement à côté du modèle.** Un navigateur n'a pas
  accès au disque ; « le dossier du FBX » est donc l'union de deux choses — les fichiers
  **arrivés avec lui à l'import** (`a.paquet`, sérialisé dans le `.p3d`, donc encore là
  après rechargement) et les **assets texture rangés dans le même dossier de projet** que
  le modèle. Rien d'autre n'est parcouru : une texture d'un autre dossier ne peut pas être
  affectée par accident. Le nombre de textures reconnues est affiché au-dessus du bouton.
- **Ce que devient chaque emplacement** : un matériau nommé comme lui, dans le dossier du
  modèle, dont les **multiplicateurs partent neutres** — puisque chaque paramètre multiplie sa
  map, la valeur neutre est 1 (blanc pour une couleur) :
  - **couleur `#ffffff`** : reprendre le gris du fichier teinterait un albédo qui porte déjà
    sa teinte. La couleur abandonnée est **écrite dans la console** quand le fichier en
    déclarait une autre que du blanc — rien n'est perdu en silence ;
  - **métal 1** : à 0,1, un métal peint dans le canal R du masque sortait dix fois trop
    faible ;
  - **lissage 1 seulement si une map le pilote** (masque combiné ou map de rugosité) : sans
    map, 1 ferait un miroir d'une surface qui n'a rien demandé, et le défaut du matériau est
    alors le bon choix ;
  - **émissif** noir, passé au blanc si une map émissive a été branchée.

  Sont repris du fichier l'**opacité et le double-face** — pas la rugosité, que le
  `MeshPhongMaterial` de `FBXLoader` ne déclare pas (la déduire de `shininess` serait une
  invention). Un glTF, lui, déclare rugosité et métal, et les deux sont repris (la rugosité
  convertie en lissage).
- **Ré-extraire complète sans défaire** : un emplacement de map **déjà branché** (à la
  main ou par une extraction précédente) n'est jamais écrasé, et un matériau du même nom
  déjà présent dans le dossier est **repris** au lieu d'être dupliqué. Le bouton est donc
  rejouable après avoir ajouté une texture manquante à côté du modèle.
- **Assets texture créés à la demande** : seul un fichier réellement affecté devient un
  asset, dans le dossier du modèle, avec le **type d'import déduit du rôle** (couleur /
  normale / données — il décide de l'espace de couleur). Sur un asset qui existait déjà, ce
  type n'est corrigé que s'il était **resté au défaut** : un choix explicite est respecté.
  Les extensions acceptées sont celles de l'import (`.png/.jpg/.webp/.gif/.bmp`) — un
  `.tga` cité par un FBX n'est pas lisible dans un navigateur.
- **Rapport** : une ligne de console par emplacement (quelle texture sur quelle map), et un
  résumé en barre de statut. Un emplacement resté sans aucune map alors que le matériau du
  fichier en portait une déclenche un **avertissement** : ses images sont *intégrées* au
  FBX, elles ne passent pas dans un matériau asset — il faut les exporter à côté du modèle.
- Les instances déjà posées suivent si la case **Mettre à jour** est cochée (instantané
  d'historique pris avant). Les **assets** ne font pas partie de l'historique, comme
  partout ailleurs (`history.js`).

##### Convention de nommage (Édition → ⚙ Préférences)

Chaque studio a la sienne — `TX_NomA_C` / `M_NomA` ici, `nomA_BaseColor` ailleurs. La
deviner donnerait un outil qui marche pour son auteur et pour personne d'autre : elle est
donc **réglable**, et stockée en `localStorage` (`moteur3d-nommage`) comme les plugins et
la clé du copilote — une convention suit la personne et son pipeline DCC, pas le projet.

| Réglage | Rôle |
|---|---|
| **Préfixe textures** (`TX_`) | **Filtre** : un fichier qui ne le porte pas n'est pas candidat, ce qui écarte une référence ou une capture posée dans le même dossier. Vide = tous les noms. |
| **Préfixe matériaux** (`M_`) | Retiré du nom de l'emplacement pour obtenir la base à chercher. **Pas un filtre** : un emplacement nommé `Carrosserie` reçoit quand même son matériau, seule la recherche de textures dépend de la base. |
| **Suffixes par map** | Une liste séparée par des virgules **par rôle** : couleur de base, masque combiné, normale, émissive, rugosité, métal, occlusion. Le suffixe **le plus long** l'emporte — `_MADS` n'est jamais lu comme `_M`, ni `_Normal` comme `_N`. |
| **Correspondance** | `exacte` (bases identiques) ou `souple` (la base de la texture peut prolonger celle du matériau : `M_Perso` ← `TX_Perso_Corps_C`). |
| **Ignorer la casse** | Les exports DCC ne sont pas constants là-dessus. Activé par défaut. |
| **Sans suffixe = couleur** | Pour les pipelines où l'albédo n'est pas suffixé (`bois.png` + `bois_N.png`). |
| **Banc d'essai** | Une zone de saisie de noms et, en dessous, ce que la convention en fait **en direct** : quel rôle, quelle base, quel matériau les réclame, et lesquels restent hors convention. On vérifie sur ses vrais noms au lieu de lancer une extraction pour voir. |

Ainsi, `M_NomA` reçoit `TX_NomA_C` en couleur et `TX_NomA_MADS` en masque combiné, et
`TX_NomB_N` reste de côté. Le **masque combiné** suit le packing Unity (**R** métal ·
**G** occlusion · **A** lissage, cf. `canvasCombine`) : un `_ORM`/`_RMA` n'a pas ces
canaux et n'est **pas** dans les suffixes par défaut — l'ajouter mal lirait les canaux.

### 2.10 Animation (timeline à images clés)

- Une piste par objet ; clés = pose **locale** complète (position, quaternion, échelle),
  correctes sous n'importe quel parent.
- Pose de clé (`🔑`), remplacement si clé existante à ±0,02 s, suppression,
  **déplacement des clés à la souris**, scrub de la tête de lecture.
- Lecture/pause (`Espace`), boucle, retour début, durée éditable (règle graduée adaptative).
- Interpolation : lerp (position/échelle) + slerp (rotation).
- **Courbes d'easing par clé** (sélecteur « Courbe » quand une clé est sélectionnée) :
  la courbe s'applique au segment entre la clé sélectionnée et la suivante.

| Courbe | Fonction | Usage |
|---|---|---|
| Linéaire | `a` | défaut, vitesse constante |
| Accélère | `a²` | départs (ease-in) |
| Décélère | `a·(2−a)` | arrivées (ease-out) |
| Douce | smoothstep | mouvements naturels (ease-in-out) |
| Palier | saut à la clé suivante | états discrets (interrupteurs, téléportation) |

### 2.11 Presse-papiers, duplication

- `Ctrl+C` / `Ctrl+V` : copier/coller (sous-arbre complet, y compris multi-sélection).
- `Ctrl+D` : duplication immédiate avec enfants, matériaux clonés, lumières/caméras
  re-liées, compteurs de noms incrémentés.

### 2.12 Affichage

- Filtres : **fil de fer**, **ombres**, **textures** (cache WeakMap pour restauration),
  **aimant** du gizmo.
- Brouillard, sol receveur d'ombres, grille, éclairage d'ambiance (hémisphérique + soleil).
- Helpers lumières/caméras masqués dans la vue « à travers la caméra » et dans l'aperçu.

### 2.13 Scripts (JavaScript)

> **Choix du langage** : JavaScript. Il s'exécute nativement dans le navigateur (zéro
> toolchain, zéro compilation) ; le C# aurait exigé d'embarquer un runtime .NET/WASM de
> plusieurs dizaines de Mo. Le JS reste le choix standard des moteurs web.

Chaque objet peut porter un script (section **Script (JS)** de l'inspecteur, case
**Actif**, éditeur dans une fenêtre modale). Cycle de vie :

1. le **niveau supérieur** du script s'exécute une fois (déclaration de variables) ;
2. `demarrer(api)` est appelée au premier pas de la session de jeu ;
3. `mettreAJour(api)` est appelée à chaque image.

Les scripts tournent pendant la **lecture** (`Espace`) et pendant la **simulation
physique**. À l'arrêt, les poses des objets scriptés sont **restaurées** (mode play non
destructif, comme Unity). Les erreurs de compilation/exécution s'affichent dans la barre
de statut avec le nom de l'objet ; un script en erreur est suspendu jusqu'à sa réédition.

#### API (objet `api` passé à chaque appel) — doc intégrée : menu Aide → API de scripts

| Membre | Description |
|---|---|
| `api.moi` | l'objet three.js porteur (`position`, `rotation`, `scale`, `name`, `visible`…) |
| `api.dt` | durée de l'image (secondes) |
| `api.temps` | temps écoulé depuis le lancement (secondes) |
| `api.trouver(nom)` | objet de la scène portant ce nom, ou `null` |
| `api.parTag(tag)` / `api.parCalque(c)` | tableaux d'objets filtrés par tag / calque (section Jeu) |
| `api.props(obj?)` | propriétés custom de l'objet (défaut : soi-même) |
| `api.tag(obj?)` | tag de l'objet |
| `api.touche(k)` | `true` si la touche est enfoncée (`'ArrowLeft'`, `'a'`, `' '`…) |
| `api.distance(a, b?)` | distance monde entre deux objets |
| `api.regarder(cible)` | oriente l'objet vers la cible |
| `api.statut(msg)` | message dans la barre de statut |
| `api.V3(x,y,z)` | crée un `THREE.Vector3` |
| `api.scene` | la scène three.js complète (avancé) |

Exemple — ennemi qui poursuit le joueur :

```js
function mettreAJour(api){
  const joueur = api.parTag('joueur')[0];
  if(joueur && api.distance(joueur) > 1){
    api.regarder(joueur);
    api.moi.translateZ(api.props().vitesse * api.dt);
  }
}
```

Le code des scripts est sauvegardé dans le projet `.p3d`, dupliqué avec l'objet, et
exporté tel quel dans `export-jeu.json` (champ `script`) pour être réutilisé ou
transpilé par le runtime du studio.

#### Scripts en assets (réutilisables)

Bouton **📜 Nouveau script** dans le panneau Projet : crée un script indépendant de tout
objet, édité par **double-clic** sur sa tuile. **Glisser la tuile sur un objet** (dans le
viewport ou sur un nœud de la hiérarchie) attache une **copie** du code à l'objet.
Les assets script sont sauvegardés dans le `.p3d` avec le reste du projet.

### 2.13 bis Événements visuels « Quand… Alors… » (sans code)

Section **Événements** de l'inspecteur, sur tous les objets — pour les level designers
qui ne veulent pas écrire de JavaScript. Chaque événement = un déclencheur + une chaîne
d'actions exécutée en séquence :

| Déclencheur (« Quand ») | Détail |
|---|---|
| Au démarrage | au lancement du mode lecture |
| Un objet tagué ENTRE / SORT | recouvrement de boîtes englobantes avec les objets portant le **tag guetté** (défaut `joueur`) |
| Au clic sur cet objet | clic dans le viewport en lecture, ou dans le build Web |
| À la réception d'un événement | bus partagé avec les scripts (`api.evenement`/`api.ecouter`) |

| Action (« Alors ») | Paramètres |
|---|---|
| Rendre visible / invisible / basculer | cible (vide = cet objet) |
| Détruire | cible |
| Émettre l'événement… | valeur = nom |
| **Jouer le son…** | valeur = nom d'un asset audio 🔊 du projet (one-shot) |
| **Émettre des particules…** | cible = un émetteur ✨ · valeur = quantité (vide = celle de l'émetteur) |
| Afficher le message… | valeur = texte (barre de statut / HUD) |
| **Attendre…** | valeur = secondes — la suite de la chaîne reprend après le délai |
| Charger la scène… | valeur = nom de scène |

Sérialisés avec l'objet (`userData.evenements`), dupliqués, exportés
(`export-jeu.json` champ `evenements`) et **exécutés à l'identique dans les builds Web**.

### 2.13 ter Analyser la scène

**Édition → 🔍 Analyser la scène** : détecte les problèmes courants, triés par gravité —
caméra absente, doublons de noms, corps rigides de masse nulle, objets invisibles mais
physiques, triggers sans script ni événement, échelles négatives, objets très loin de
l'origine, scripts qui ne compilent pas, prefabs modifiés non appliqués, références
cassées (matériau/prefab/audio), cibles d'événements introuvables, scènes inexistantes,
action « Jouer le son » vers un audio inexistant, matériaux inutilisés.

### 2.13 quater Audio (P1-2)

Module `js/audio.js` — WebAudio via `THREE.AudioListener` (posé sur la caméra éditeur ;
dans les builds, sur la caméra du jeu).

**Assets audio 🔊** : import `.mp3/.wav/.ogg/.m4a` (bouton Importer, glisser-déposer,
même paquet que modèles/textures). Décodés en `AudioBuffer` à l'import. Double-clic sur
la tuile = pré-écoute (l'icône passe à ⏹, re-double-clic pour arrêter). Rangés dans les
dossiers de l'explorateur, sérialisés dans le `.p3d` (base64), export Git (fichiers bruts
dans `assets/`), embarqués dans les builds Web.

**Source audio par objet** — glisser un asset 🔊 sur un objet (vue ou hiérarchie) pose
`userData.audio = {asset, volume, boucle, auto, spatial, portee, pitch}` ; section
**Source audio** de l'inspecteur : volume (0–2), vitesse (0.25–4), boucle, lecture au
lancement, 3D spatial (`THREE.PositionalAudio`, volume selon la distance à la caméra,
portée = `refDistance`), boutons ▶ Écouter et × Retirer. Les sources sont créées au
lancement du mode lecture et **entièrement nettoyées à l'arrêt** (stop + retrait du
graphe), y compris les one-shots.

**Scripts** : `api.jouerSon(nom, volume?)` (one-shot 2D, aussi dans le runtime) et
`api.audio(obj?)` → `{jouer(), arreter(), volume(v)}` pour piloter la source de l'objet.
**Événements visuels** : action « Jouer le son… ». Les contextes audio suspendus par le
navigateur sont repris au premier geste (éditeur : au lancement ; build : pointer/clavier).

### 2.13 quinquies Particules (P1-3)

Module `js/particles.js` — objet de scène **✨ Particules** (barre d'outils), config
sérialisable dans `userData.part`, système runtime (jamais sérialisé) dans `ed(o).part` :
`THREE.Points` en **espace monde** (les particules laissent une traînée quand l'émetteur
bouge) + `ShaderMaterial` avec taille, opacité et couleur **par particule**.

- **Formes d'émission** : cône (directionnel +Y, demi-angle réglable), point (explosion
  radiale), boîte (zone, vers le haut), sphère (radial).
- **Modes** : continu (débit /s) ou burst (rafale de N ; une fois au lancement du mode
  lecture, en boucle d'aperçu dans l'éditeur).
- **Sur la durée de vie** (±25 % de variation par particule) : taille début→fin,
  opacité début→fin, **couleur début→fin** ; gravité ; mélange additif (feu, lueurs)
  ou normal (fumée) ; plafond de particules (défaut 300, max 5000).
- L'aperçu tourne en permanence dans l'éditeur (case « Émission » pour le couper),
  bouton **✨ Émettre maintenant** dans l'inspecteur.
- **Scripts** : `api.particules(obj?)` → `.emettre(n?)`, `.activer(bool)`.
  **Événements** : action « Émettre des particules… ».
- Les `THREE.Points` sont recréés paresseusement et purgés automatiquement quand
  l'émetteur disparaît (suppression, undo, changement de scène). Exécution identique
  dans les builds Web (`game-runtime.js`).

### 2.13 sexies Navigation IA (P1-4)

Module `js/navigation.js` — pas de NavMesh polygonal : une **grille d'occupation** au sol
(cellules de 0,5 m sur 80×80 m) reconstruite au lancement du mode lecture, puis **A* 8
directions** (tas binaire, coupe de coin interdite) et **lissage du chemin par ligne de
vue** (Bresenham) pour éviter l'effet « escalier ».

- **Obstacles** : les meshes et modèles visibles dont la boîte englobante coupe la tranche
  de marche (0,15 m – 1,8 m), dilatés du rayon de l'agent (0,25 m). Sont **ignorés** : les
  objets tagués `sol`, les colliders trigger, et tout ce qui est plat au sol.
- **API scripts** : `api.deplacerVers(cible, vitesse)` (avance d'un pas, renvoie `true` à
  l'arrivée), `api.patrouiller([points], vitesse)` (cycle, recalcul à chaque étape),
  `api.cheminVers(cible)` (tableau de points, ou `null`). La cible accepte un objet, un
  nom d'objet ou `{x, z}`. L'agent s'oriente automatiquement dans sa direction de marche.
- Le chemin est mis en cache par agent et recalculé quand la cible bouge de plus d'une
  demi-cellule. Grille et caches purgés au démarrage et à l'arrêt de la lecture.
  Moteur identique dans les builds Web.

### 2.14 Placement pro (P1-5)

Module `js/placement.js` — menu **Objet** :

| Commande | Effet |
|---|---|
| ⇩ Poser au sol | rayon vers le bas depuis l'objet : il se pose sur la **géométrie rencontrée** (autre objet, plateforme…) ou à y=0, en tenant compte de sa propre hauteur |
| ⟂ Poser et aligner à la normale | idem + rotation alignée sur la pente de la surface (le lacet est conservé) |
| ≡ Aligner / distribuer… | sur la multi-sélection : aligner min / centre / max sur X, Y ou Z (2 objets ou plus) · distribuer à écarts égaux (3 ou plus) |
| ⧉ Dupliquer en série… | **ligne** (décalage X/Y/Z par copie) ou **cercle** (rayon, arc en degrés, orientation automatique des copies) — jusqu'à 200 copies, toutes sélectionnées à la fin |

**Peinture de prefabs** : bouton **🖌** au survol d'une tuile prefab du panneau Projet →
chaque clic dans la vue instancie le prefab sur la surface visée avec une **rotation Y
aléatoire** (instances liées au prefab). Curseur en croix, tuile surlignée, `Échap` ou
re-clic sur 🖌 pour quitter. Idéal pour semer de la végétation ou du mobilier.

> Note d'implémentation : `THREE.Raycaster` ne rafraîchit pas les matrices monde —
> tout raycast qui suit une modification de transform doit être précédé de
> `scene.updateMatrixWorld(true)` (contrairement à `Box3.setFromObject`, qui le fait).

### 2.15 Copilote IA — Claude (P1-8)

Module `js/copilot.js` — bouton **✨ IA** de la barre d'outils (ou Aide → Copilote IA).
L'utilisateur décrit ce qu'il veut (« ajoute une salle avec 4 colonnes et une lumière
chaude », « fais patrouiller l'ennemi entre ces deux points », « crée un feu de camp »)
et Claude le construit dans la scène.

- **Catalogue de 16 commandes** exposées comme outils (`tools`) de l'API Claude :
  `list_scene`, `list_assets`, `create_object`, `delete_object`, `rename_object`,
  `transform`, `set_parent`, `configure_material`, `configure_physics`,
  `configure_game`, `attach_script`, `add_event`, `configure_particles`,
  `configure_environment`, `manage_scenes`, `set_play_mode`. Chacune appelle les
  fonctions existantes de l'éditeur et passe par `pousserHistorique()` :
  **tout ce que fait l'IA est annulable par Ctrl+Z**, et journalisé dans la Console.
- **Boucle d'agent** : `POST https://api.anthropic.com/v1/messages` directement depuis le
  navigateur (en-tête `anthropic-dangerous-direct-browser-access: true`), enchaînement
  tool_use → exécution → tool_result jusqu'à `end_turn`, plafonné à 20 tours. Bouton ⏹
  pour interrompre (l'historique est réparé pour rester valide), messages d'erreur
  explicites (clé refusée, refus du modèle).
- **Clé API** saisie dans ⚙ et conservée dans le `localStorage` du navigateur —
  **jamais enregistrée dans les projets ni les exports**. Modèle par défaut
  `claude-opus-5` (Sonnet 5 et Haiku 4.5 également proposés).

### 2.15 bis Terrain heightmap (P2-1)

Module `js/terrain.js` — objet **⛰ Terrain** : un maillage 60 m subdivisé 64×64
(4 225 sommets) dont les hauteurs vivent dans `userData.terr.hauteurs` (tableau plat,
sérialisable, ≈ 79 Ko de JSON avant le gzip du `.p3d`).

- **Sculpture** : bouton *⛏ Sculpter* de l'inspecteur, puis on glisse dans la vue.
  Pinceaux **élever / creuser / lisser / aplanir / bruit**, rayon (molette ou champ),
  force, **Maj** pour inverser, **Échap** pour quitter. Un trait = un niveau d'annulation.
- **Générateur de relief** : bruit fractal à 3 octaves (amplitude et échelle des formes),
  ou remise à plat.
- **Coloration automatique** par altitude et pente (vertex colors) : herbe → roche →
  neige, seuils et couleurs réglables, option « roche sur les fortes pentes ».
- **Physique** : chaque terrain devient un `CANNON.Heightfield` statique — inutile de
  cocher « corps rigide ». Les objets roulent et glissent sur le relief.
  *Le plan de sol infini à y=0 reste actif : un terrain creusé sous 0 est bloqué par lui.*
- **Scripts** : `api.hauteurSol(x?, z?)` renvoie l'altitude du terrain sous un point.
  **Copilote** : outil `generate_terrain`. Rendu et physique identiques dans les builds Web.

Le terrain n'est pas un obstacle pour la navigation IA (il est le sol) et n'est pas
concerné par les colliders de l'inspecteur.

### 2.15 ter Profiler & budgets (P2-3)

Module `js/profiler.js` — **Affichage → 📊 Profiler** : overlay dans le coin du viewport
avec un graphe des 120 derniers temps d'image (barres vertes sous le budget, rouges
au-delà) et trois blocs de mesures, chacune comparée au budget de la plateforme choisie
et colorée (vert ≤ 75 %, orange ≤ 100 %, rouge au-delà) :

| Bloc | Mesures |
|---|---|
| Cadence | FPS (moyenne des 20 dernières images), durée d'image en ms |
| Temps CPU | scripts + événements, physique, particules, appel de rendu, total mesuré |
| Charge GPU | draw calls, triangles, textures, géométries |
| Scène | objets gérés, maillages, lumières, particules vivantes |

Budgets fournis : **PC** (60 fps, 400 draw calls, 1,5 M triangles, 8 lumières) et
**Mobile / web léger** (30 fps, 100 draw calls, 300 k triangles, 4 lumières).
Quand le profiler est fermé, l'instrumentation sort immédiatement : coût nul
(mesuré : 1 ms pour 10 000 images).

### 2.15 quater Post-traitement (P2-4)

Module `js/postfx.js` — pipeline écrit à la main (`EffectComposer` n'est pas embarqué dans
`vendor/`), **écrit en TSL** depuis le passage à `WebGPURenderer`, qui n'exécute pas les
`ShaderMaterial` GLSL bruts — et le fait **en silence**, sans lever d'exception : sous
l'ancien code GLSL, bloom, étalonnage, vignette, grain et FXAA auraient simplement
disparu. Activé dans l'inspecteur **quand aucun objet n'est
sélectionné** (section *Post-traitement*). Les réglages vivent dans `env.post` : ils sont
donc **par scène**, sérialisés avec elle et rejoués à l'identique dans les builds Web.

Chaîne de rendu : scène → cible plein écran → extraction des hautes lumières (seuil, en
demi-résolution) → 2 × flou gaussien séparable → composition → FXAA facultatif → écran.

| Réglage | Effet |
|---|---|
| Tone mapping | aucun · linéaire · Reinhard · Cineon · **ACES Filmic** (défaut) |
| Exposition | multiplicateur avant tone mapping |
| Bloom | seuil, intensité, rayon — halo sur les zones lumineuses |
| Contraste / Saturation | étalonnage autour du gris moyen et de la luminance |
| Température | −1 (froid, plus de bleu) … +1 (chaud, plus de rouge) |
| Vignette / Grain | assombrissement des bords · bruit argentique animé |
| Anticrénelage | FXAA (lissage dirigé par le gradient de luminance) |

> Note d'implémentation : le tone mapping et l'exposition sont calculés **dans le nœud de
> composition**, pas via `renderer.toneMapping`. Celui-ci est compilé dans les shaders des
> matériaux — le modifier à chaud n'a aucun effet sans recompilation — et il doit de toute
> façon s'appliquer *après* l'ajout du bloom.

### 2.15 quinquies Sous-scènes instanciables (P2-2)

Module `js/subscenes.js` — un objet **◈ sous-scène** (menu Objet → *Instancier une
sous-scène*) référence **une autre scène du projet** et affiche tout son contenu comme
ses enfants. Le principe : construire un module une fois (une salle, un décor, un
lampadaire complet avec sa lumière et son script), puis le réutiliser partout.

- **Seul le nœud est sérialisé** (nom de la scène source + overrides). Le contenu est
  régénéré à l'ouverture, donc **modifier la scène source met à jour toutes les
  instances**, y compris l'ajout et la suppression d'objets.
- **Overrides automatiques** : déplacer, tourner, redimensionner ou masquer un objet
  généré enregistre l'écart par rapport à la source (comparaison à la sérialisation,
  comme l'empreinte des prefabs). Ces écarts survivent au rechargement de la source.
  Les sous-scènes **imbriquées** sont gérées : leurs overrides remontent dans le nœud
  parent avec une clé composée (`3/1` = enfant 1 de l'instance imbriquée 3), car les
  nœuds imbriqués ne sont pas sérialisés eux-mêmes.
- **Boutons de l'inspecteur** : *Éditer la scène source* (bascule vers elle),
  *Recharger depuis la source*, *Réinitialiser l'instance* (oublie les overrides),
  *Rendre unique* (le contenu devient un groupe d'objets normaux, indépendants).
- **Garde-fous** : une scène ne peut pas s'instancier elle-même, les cycles sont détectés
  et journalisés dans la Console, la profondeur d'imbrication est plafonnée à 5.
- Instanciées à l'identique dans les builds Web. Outil copilote `instantiate_subscene`.

> Limites connues : les overrides suivent la **transform et la visibilité**, pas les
> matériaux ni les propriétés de jeu. Une piste d'animation posée sur un objet généré
> n'est pas conservée (les objets sont recréés à chaque chargement) — animez plutôt le
> nœud de la sous-scène, ou l'objet dans sa scène source.

### 2.15 sexies Sondes de réflexion & d'ambiance (P2-5)

Module `js/probes.js` — objet **🔮 Sonde** (menu Objet → *Sonde de réflexion*). La sonde
cuit l'environnement vu depuis sa position dans un cubemap (`THREE.CubeCamera`) et le
distribue comme `envMap` à tous les maillages de son **rayon d'influence** : les surfaces
métalliques ou peu rugueuses reflètent alors leur décor local, ce qui change radicalement
le rendu d'un intérieur ou d'une carrosserie.

| Réglage | Rôle |
|---|---|
| Rayon d'influence | distance jusqu'à laquelle les objets reçoivent ce reflet (la sonde **la plus proche** gagne) |
| Résolution | 64 (rapide) · 128 (défaut) · 256 (net) · 512 (lourd) |
| Intensité | `envMapIntensity` appliquée aux matériaux |
| Recuire en lecture | recuisson automatique au lancement du mode ▶ |

- Boutons : **Cuire cette sonde**, **Cuire toutes les sondes** (aussi dans le menu Objet),
  et **En faire l'ambiance de la scène** — la moyenne des 6 faces du cubemap donne une
  couleur d'ambiance locale mesurée, réutilisable comme teinte de lumière globale.
- Pendant la cuisson, les autres sondes et les aides visuelles (gizmo, helpers) sont
  masquées : une sonde ne se voit pas elle-même et ne capture pas l'interface.
- **Seuls les réglages sont sérialisés** ; le cubemap est recuit à l'ouverture du projet,
  après un undo, et au chargement d'une scène dans les builds Web.

> Notes d'implémentation : la cible de rendu doit être en **`RGBAFormat`** —
> `readRenderTargetPixels()` refuse tout autre format, ce qui rendrait la mesure d'ambiance
> silencieusement noire. L'ambiance est échantillonnée au **centre** de chaque face (les
> coins regardent en biais et ne représentent pas ce que la sonde voit).
>
> La cible cubemap est créée par `creerCibleCube()` : **`THREE.CubeRenderTarget`** dès que le
> paquet `three/webgpu` le fournit, `WebGLCubeRenderTarget` seulement à défaut. Cette dernière
> est propre au backend WebGL et absente du paquet webgpu — l'utiliser revenait à passer au
> `WebGPURenderer` une cible venue de l'autre bundle, qu'il ne reconnaît pas.
>
> La mesure d'ambiance est **asynchrone et détachée de la cuisson** (`mesurerAmbianceSonde()`) :
> `WebGPURenderer` n'expose que `readRenderTargetPixelsAsync()`. Le cubemap — donc les reflets —
> est prêt immédiatement ; la couleur arrive après et rafraîchit l'inspecteur si la sonde est
> sélectionnée. La face est lue **entière** (WebGPU aligne les lignes sur 256 octets, une
> largeur partielle tomberait à côté) et le nombre d'octets par ligne est déduit du tampon reçu.
> Les deux signatures diffèrent : WebGPU *retourne* le tampon, WebGL en *remplit* un fourni.
> Voir `docs/KNOWN_ISSUES.md` et `test/sonde-ambiance.test.mjs`.
> Limite : un matériau asset partagé entre deux zones ne peut porter qu'un seul reflet —
> la dernière sonde appliquée gagne.

### 2.15 septies Système de plugins (P2-6)

Module `js/plugins.js` — un plugin est un fichier `.js` qui reçoit l'objet global
**`Editeur`** et enregistre ses extensions. Installation par **Fichier → 🧩 Plugins**
(activer / désactiver / retirer, avec un exemple complet consultable). Les plugins sont
conservés dans le `localStorage` du navigateur, **pas dans le projet** : ils appartiennent
au poste de travail, comme les extensions d'un IDE.

| Point d'extension | Ce qu'il permet |
|---|---|
| `enregistrerTypeObjet({type, nom, icone, fabriquer, serialiser, restaurer, inspecteur})` | un nouveau type d'objet de scène, avec son icône de hiérarchie, sa persistance et sa section d'inspecteur |
| `enregistrerInspecteur({pourType, html, sync, input, clic})` | une section d'inspecteur additionnelle (sur un type précis ou sur tous les objets) |
| `enregistrerImporteur({nom, extensions, importer})` | la prise en charge de formats maison (`.lvl`, `.csv`, `.tmx`…) au glisser-déposer et à l'import |
| `enregistrerCommandeMenu({menu, libelle, raccourci, actif, action})` | une entrée dans un menu existant, ou dans un nouveau menu créé à la demande |
| `enregistrerValidateur({nom, verifier})` | des règles maison dans Édition → 🔍 Analyser la scène |

`Editeur.api` expose le cœur sans deviner les globales : `scene`, `objets`, `selection`,
`projet`, `assets`, `env`, `THREE`, `creerObjet`, `pousserHistorique`, `majHierarchie`,
`construireInspecteur`, `setStatut`, `journal`, `ouvrirModal`, `echapperHtml`, et
`Editeur.api.champs.*` (nombre, texte, couleur, select, vec3) pour construire des
sections d'inspecteur cohérentes avec le reste de l'interface.

**Robustesse** — points vérifiés en test :
- Un plugin qui lève une exception est **isolé** : l'erreur est journalisée dans la
  Console, les autres plugins et l'éditeur continuent de fonctionner. Idem pour une
  section d'inspecteur défectueuse (le panneau reste utilisable).
- **Ouvrir un projet sans le plugin qui l'a créé ne détruit rien** : chaque objet du type
  manquant devient un substitut (groupe) qui **conserve ses données brutes** et les
  réécrit à la sauvegarde. Réinstaller le plugin restaure les objets à l'identique.
- Les handlers `input` / `clic` d'un plugin renvoient `true` pour consommer l'événement.
- Redéfinir un type natif (`mesh`, `terrain`, `sonde`…) est refusé.

> ⚠️ Sécurité : un plugin s'exécute avec **tous les droits de la page** (scène, projet,
> réseau). Un avertissement explicite est affiché à l'installation ; n'installez que du
> code dont vous connaissez la provenance.

### 2.16 Persistance

#### Sauvegarde éditeur — `projet-3d.p3d` (gzip)
`Fichier → Enregistrer le projet`. JSON **compressé gzip** (fflate), version 2 :
**toutes les scènes du projet** (objets + hiérarchie par id, matériaux, colliders,
données de jeu, scripts, visibilité, réglages physiques, pistes d'animation avec easing)
et les **assets embarqués** (fichiers sources en base64 ; modèles re-parsés au
chargement ; prefabs en arbre sérialisé). Rétrocompatible : les `.s3d`/`.json` v1
(mono-scène) sont chargés comme projet à une scène (détection du magique gzip `1f 8b`).

#### Export runtime — `export-jeu.json` (nouveau)
`Fichier → Exporter les données de jeu`. JSON **propre et lisible** destiné à un moteur
de jeu externe — sans base64, sans état éditeur :

```json
{
  "format": "moteur3d-export", "version": 1, "exporteLe": "…",
  "animation": { "duree": 5, "boucle": true,
    "pistes": [{ "objet": "Cube 1/Sphère 2", "cles": [{ "t", "pos", "quat", "ech" }] }] },
  "objets": [{
    "nom": "Cube 1", "type": "mesh",
    "tag": "ennemi", "calque": "Défaut", "props": { "pv": 150 },
    "transform": { "position": [x,y,z], "quaternion": [x,y,z,w], "echelle": [x,y,z] },
    "collider": { "forme": "boite", "dims": [1,1,1], "offset": [0,0,0], "trigger": false },
    "physique": { "actif": true, "masse": 1, "rebond": 0.3, "friction": 0.4 },
    "geometrie": "cube",
    "materiau": { "couleur": "#56b6c2", "lissage": 0.45, "metal": 0.1, "emissif": "#000000", "opacite": 1 },
    "enfants": [ … ]
  }]
}
```

Champs conditionnels par type : `materiau`/`geometrie` (mesh), `lumiere`
(couleur, intensité, portée, angle, pénombre), `camera` (fov), `modele` (nom d'asset).
Les pistes d'animation référencent les objets par **chemin** (`Parent/Enfant`).
Les colliders `auto` sont exportés `null` (au runtime de choisir).

---

## 3. Raccourcis clavier

| Raccourci | Action |
|---|---|
| Clic | sélectionner (déplacement uniquement via le gizmo) |
| Glisser depuis le vide | rubber band (sélection multiple par rectangle) |
| `Ctrl+clic` | multi-sélection (ajouter/retirer) |
| `1` / `2` / `3` | gizmo : déplacer / tourner / échelle |
| Clic droit + glisser | vol libre : regarder + `W`/`A`/`S`/`D`/`Q`/`E` |
| Clic molette + glisser | panoramique |
| `F` | cadrer la sélection |
| `Ctrl+Z` / `Ctrl+Y` | annuler / rétablir |
| `Ctrl+C` / `Ctrl+V` / `Ctrl+D` | copier / coller / dupliquer |
| `Suppr` | supprimer la sélection |
| `Espace` | lecture / pause (animations + scripts) |
| `Échap` | fermer modale / vider multi-sélection / quitter vue caméra |
| Molette | zoom (vitesse de vol en vol libre) |

---

## 4. Architecture interne (pour les devs)

### 4.1 Structures clés

| Structure | Rôle |
|---|---|
| `objets[]` | tous les objets gérés par l'éditeur (racines et enfants) |
| `obj.userData` | **uniquement des données sérialisables** : `type`, `geo`, `phys`, `jeu`, `collider`, `texAsset`, `assetId`, `emissiveBase/Sel` |
| `obj.ed` | références runtime **jamais sérialisées** (lumière, cam, helper, colliderViz) — séparées car three clone `userData` en JSON (explose sur les cycles) |
| `assets[]` | panneau Projet : `{id, genre: texture\|model\|prefab, nom, apercu, template/texture, paquet[], fichier, paramsImport, brut, animationsBrutes, matBruts, uniteFichier, dimensions, imageSource, dimensionsSource}` |
| `assetSelectionne` | asset dont les paramètres d'import occupent l'inspecteur (exclusif avec `selection`) |
| `anim.pistes[]` | `{obj, cles:[{t, pos[3], quat[4], ech[3]}]}` |
| `histo` | `{undo[], redo[], limite:50, gel}` — instantanés `etatCourant()` |
| `selection` + `selectionMulti[]` | objet principal + secondaires |

### 4.2 Sérialisation

- `serialiserObjet(o)` / `reconstruireArbre(liste, assetsParId, avecHelpers)` : format pivot
  utilisé par **la sauvegarde, les prefabs et l'historique** — toute nouvelle propriété
  d'objet doit être ajoutée dans **ces deux fonctions** (et dans `exporterDonneesJeu`
  si elle concerne le runtime).
- Les identifiants sont les `id` three.js, valables uniquement à l'intérieur d'un même
  instantané (mapping `parId` à la reconstruction).

### 4.3 Règles de contribution

1. **Sécurité** : tout texte utilisateur injecté dans `innerHTML` passe par `echapperHtml()`.
2. **Mémoire** : toute suppression d'objet dispose géométries et matériaux ;
   tout `URL.createObjectURL` a son `revokeObjectURL`.
3. **Historique** : toute nouvelle mutation de scène appelle `pousserHistorique()` **avant**
   la modification.
4. **Références runtime** dans `obj.ed`, jamais dans `userData` (cf. 4.1).
5. La visualisation de collider (`userData.isColliderViz`) doit rester exclue du raycast,
   de la sérialisation et des clones (purge dans `clonerProprement`).

---

## 5. Limites connues & feuille de route

| Sujet | État / recommandation |
|---|---|
| Prise pour shaders personnalisés | Le multiplicateur de lissage est passé en nœud TSL (v0.24.3) — premier client de ce que serait une prise publique. **La prise elle-même n'existe pas** : aucun moyen, pour un plugin ou un script, de brancher son propre nœud sur un matériau. Reste de l'étape 3 de `docs/webgpu-etat.md`. |
| Mesure d'ambiance des sondes | Cassée en silence par `WebGPURenderer` (lecture de pixels synchrone disparue). Voir §2.15 quinquies et `docs/KNOWN_ISSUES.md`. |
| Backend WebGPU jamais exercé | Tout a été mesuré sur le **repli WebGL2** du nouveau renderer (pas de GPU sur la machine de test). Perfs, pilotes et ombres en WebGPU réel restent inconnus. |
| Draco / meshopt / KTX2 dans un glTF | **Supportés** : décodeurs vendorisés (`vendor/three-draco.min.js`, `three-meshopt.min.js`, `three-ktx2.min.js`), branchés par `js/asset-compression.js` côté éditeur ET côté jeu publié. Décodeurs EMBARQUÉS (aucun `fetch`) pour que le build s'ouvre en `file://`. `js/build.js` n'embarque que ceux que les octets du projet réclament : +0 Ko sans asset compressé, +112 Ko (Draco), +10 Ko (meshopt), +390 Ko (KTX2) sur un ZIP moteur de 619 Ko. **Reste non vérifié en navigateur** : la construction d'un `Worker` depuis une page `file://` — voir `docs/KNOWN_ISSUES.md`. |
| Textures `.ktx2` importées seules | Non supportées : `KTX2Loader` n'est branché que sur `GLTFLoader` (extension `KHR_texture_basisu`). Un `.ktx2` déposé dans le panneau Projet n'est pas reconnu comme texture. |
| Gizmo multi-sélection | Les deltas de rotation/échelle s'appliquent **autour du pivot de chaque objet**, pas autour d'un pivot commun. |
| Animation | Pas d'export au format glTF ; easing par segment (pas de courbes de Bézier éditables). |
| Matériaux des modèles importés | Non éditables champ par champ dans l'inspecteur (seulement les primitives) ; on les **remplace** par un matériau du projet, emplacement par emplacement, dans les paramètres d'import (2.9). |
| Collider capsule | Non disponible (cannon 0.6.2) ; utiliser cylindre ou sphère. |
| Undo | Ne couvre pas les assets du panneau Projet (ajout/suppression d'asset non annulable). |
| Scripts | Exécutés dans la page (pas de sandbox worker) : réservés à des scripts internes au studio. Pas de `api.creer()`/`api.detruire()` pour l'instant. |
| Corps cinématiques | Vitesse non transmise par frottement (les plateformes poussent mais n'« embarquent » pas parfaitement les objets posés dessus). |

---

## 6. Historique des évolutions (2026-08-03)

- **Correctif bloquant** : `creerHelperPour()` était appelée mais jamais définie —
  l'éditeur ne démarrait pas. Fonction implémentée (helpers lumières/caméras).
- **Sécurité** : échappement HTML de tous les noms injectés (hiérarchie, assets, timeline).
- **Annuler/rétablir** (Ctrl+Z/Y), 50 niveaux, couvrant toutes les mutations.
- **Copier/coller** (Ctrl+C/V) et **multi-sélection** (Ctrl+clic, groupe suivant le gizmo).
- **Matériaux PBR** exposés : rugosité, métal, émissif, opacité.
- **Colliders configurables** : boîte/sphère/cylindre + offset + trigger, visualisation
  filaire, prioritaires dans la simulation physique.
- **Tags, calques, propriétés custom** par objet (typage automatique).
- **Export « données de jeu »** : JSON runtime propre (hiérarchie, transforms, colliders,
  tags, matériaux, lumières, caméras, animations par chemin).
- **Sauvegarde compressée** `.s3d` (gzip fflate), rétrocompatible avec les `.json`.
- **three.js embarqué** dans le fichier : fonctionne 100 % hors ligne.

### Deuxième vague (même jour)

- **Physique ↔ animation** : les objets animés deviennent des corps **cinématiques**
  pendant la simulation (plateformes/portes qui poussent les corps rigides), au lieu
  d'être simplement exclus.
- **Courbes d'easing par clé** : linéaire, accélère, décélère, douce, palier
  (sélecteur « Courbe » dans la barre d'animation).
- **Layout** : inspecteur en pleine hauteur à droite, panneau bas raccourci.
- **Système de scripts JavaScript** : script par objet (`demarrer`/`mettreAJour`),
  API française documentée (menu Aide → API de scripts), exécution pendant lecture et
  simulation, poses restaurées à l'arrêt, sérialisé et exporté.

### Troisième vague (même jour)

- **Refactorisation multi-fichiers** : `editor.html` + `css/` + `js/` (17 modules) +
  `vendor/` — l'ancien mono-fichier devient une archive. Vérification de parité complète.
- **Mode Édition / Lecture / Pause** (style Unity) : ▶ lance animations + physique +
  scripts, ⏸ fige, ⏹/Échap restaure intégralement la scène. Édition gelée en lecture.
- **Projet multi-scènes** : panneau Scènes (ajouter, basculer, renommer, supprimer),
  assets partagés, format `.p3d` v2 rétrocompatible `.s3d`/`.json`.
- **Hiérarchie retravaillée** : pliage ▼/▶, renommage double-clic, visibilité 👁
  (sérialisée + exportée), filtre par nom.

### Huitième à onzième vagues — explorateur, masque combiné, P1

- **8e — Explorateur à dossiers** : arborescence à gauche du panneau Projet, dossiers et
  sous-dossiers (＋/✎/🗑), rangement par glisser-déposer, sérialisé, export Git rangé.
- **9e — Masque combiné matériaux** (R = métal, G = AO, B = 0, A = lissage — convention
  Unity, repacké vers three/glTF par canvas).
- **10e — Événements visuels « Quand… Alors… »** (§ 2.13 bis) et **Analyser la scène**
  (§ 2.13 ter) — P1-1 et P1-7.
- **11e — Audio (P1-2)** (§ 2.13 quater) : assets 🔊 avec pré-écoute, source audio par
  objet (volume/vitesse/boucle/auto/3D+portée), `api.jouerSon`/`api.audio`, action
  d'événement « Jouer le son… », sérialisation/Git/builds Web. Roadmap : ajout de
  **P1-8 Pilotage par IA (copilote Claude)** avec plan technique (catalogue de commandes
  outillées + fenêtre de chat connectée à l'API Claude).
- **12e — Particules (P1-3)** (§ 2.13 quinquies) : objet ✨, 4 formes d'émission,
  continu/burst, taille/opacité/couleur sur la vie, additif ou normal, aperçu éditeur,
  `api.particules`, action « Émettre des particules… », builds Web.
- **13e — Fin du P1** : **navigation IA** (§ 2.13 sexies, grille + A* lissé,
  `api.deplacerVers`/`patrouiller`/`cheminVers`), **placement pro** (§ 2.14, poser au sol,
  aligner/distribuer, duplication en ligne/cercle, peinture de prefabs) et
  **copilote IA Claude** (§ 2.15, 16 outils pilotant l'éditeur, tout annulable par Ctrl+Z).
  Le P1 de la roadmap est complet (8/8).
- **14e — début du P2** : **profiler & budgets** (§ 2.15 ter) et **terrain heightmap
  sculptable** (§ 2.15 bis, avec collider `CANNON.Heightfield`). Ajout de
  `outils/bump-cache.js` : incrémente le `?v=` des scripts dans `editor.html`
  quand le navigateur sert des fichiers en cache pendant le développement.
- **15e — post-traitement** (§ 2.15 quater) : bloom, tone mapping + exposition,
  étalonnage, vignette, grain et FXAA, réglés par scène et rejoués dans les builds.
- **16e — sous-scènes instanciables** (§ 2.15 quinquies) : une scène référencée dans une
  autre, contenu régénéré depuis la source, overrides automatiques (imbrication comprise),
  rendre unique, anti-cycle.
- **17e — sondes de réflexion** (§ 2.15 sexies) : cubemap cuit par sonde, distribué par
  rayon d'influence, ambiance mesurée. Les lightmaps texture restent hors périmètre.
- **18e — système de plugins** (§ 2.15 septies) : API `Editeur` à 5 points d'extension,
  gestionnaire dans Fichier → Plugins, dégradation sans perte de données quand un plugin
  manque. Le P2 est à 5,5/7 (reste : collaboration P2-7, lightmaps texture).

### Septième vague — Assets matériaux (P1-6 partiel)

- **`js/materials.js`** : assets 🎨 configurables (modale), affectation par glisser-déposer
  sur primitives et modèles, synchronisation de tous les usages à l'édition, détachement,
  sérialisation/exports/runtime. Reste en P1-6 : normal map, AO, instances.

### Sixième vague — Build Web jouable en un clic (P0-6)

- **Fichier → 🎮 Exporter un build Web jouable (.zip)** : produit un dossier autonome
  `index.html + vendor/ + runtime.js + donnees.js` qui **s'ouvre en double-cliquant
  index.html** (tout passe par des balises `<script>`, aucun serveur requis côté joueur).
  L'éditeur, lui, doit être servi en http(s) pour lire ses propres fichiers à l'export.
- **`js/game-runtime.js`** : lecteur autonome (~600 lignes) — reconstruit les scènes
  (primitives, plan, groupes, lumières, caméras, modèles FBX/glTF et textures depuis le
  base64, matériaux, visibilité), applique l'environnement (ciel/brouillard/éclairage),
  joue les animations (easing, boucle), la physique (corps dynamiques + cinématiques,
  colliders, sol), exécute les scripts avec **toute l'API v2** (input map comprise,
  `changerScene` recharge la scène cible en jeu), écran de chargement, bouton plein
  écran, HUD (`api.statut`), erreurs à l'écran et en console.
- Caméra principale = première caméra de la scène (caméra de secours sinon).
- `build-test/` dans le dépôt : **harnais** du jeu publié, à ouvrir en http (pas en
  `file://` : le pont ESM ne s'y charge pas). Sa page est l'image exacte de celle que produit
  `pageIndexBuild()`, chemins réécrits vers les vraies sources — elle charge donc
  `js/game-runtime.js` lui-même, jamais une copie. Ce dossier a contenu jusqu'en août 2026 un
  `runtime.js` figé de 27 Ko (contre 106 Ko au vrai fichier) et un `vendor/` en three r128
  alors que le dépôt était en r185 : y « valider un build » exerçait un autre moteur.
  `test/harnais-build-test.test.mjs` échoue désormais à la moindre dérive.
- Toute évolution du format de sérialisation doit être répercutée dans
  `game-runtime.js` (fonction `construireListe`).

### Cinquième vague — P0 production (voir ROADMAP.md)

- **Prefabs liés & variantes** : instances rattachées (`userData.prefabId`), détection
  de divergence par empreinte structurelle normalisée, Appliquer/Réinitialiser/variante/
  Rendre unique, synchronisation des instances, sérialisation et remappage au chargement.
- **Console** (3e onglet du panneau bas) : `api.log/avertir/erreur`, erreurs de scripts
  routées avec nom d'objet, filtre, compteurs, badge d'erreurs non lues, double-clic
  → sélection + ouverture du script fautif.
- **API gameplay v2** : `creer(nomAsset, pos)`, `detruire` (différé), `activer`,
  `raycast` (matrices monde à jour), `chevauchementSphere`, `appliquerForce`, `vitesse`,
  `apres(s, fn)`, `evenement`/`ecouter`, `changerScene` (relance le mode jeu sur la cible).
- **Input Map** : actions nommées + axes (`api.action`, `api.actionAppuyee`, `api.axe`),
  éditeur dans Fichier → Entrées, sauvegardée dans le projet.
- **Export dossier Git (.zip)** : project.json + scenes/*.scene.json (JSON indenté) +
  prefabs/*.prefab.json + scripts/*.js + assets/ en fichiers bruts. Le `.p3d` reste le
  format d'ouverture.
- **Sauvegarde automatique** : IndexedDB toutes les 3 min si modifications (drapeau posé
  par `pousserHistorique`), hors lecture/simulation ; récupération via le menu Fichier ;
  signalement discret au démarrage.
- Correctif : le bloc collider de l'inspecteur interceptait `f-couleur` (préfixe `f-c`)
  — la couleur des matériaux ne s'appliquait plus ; liste explicite de champs désormais.

### Quatrième vague (même jour) — sélection « essentiels Godot »

- **Environnement de scène** (≈ WorldEnvironment) : ciel couleur/dégradé/panorama image,
  brouillard, éclairage global — édité dans l'inspecteur quand rien n'est sélectionné,
  sérialisé par scène, exporté.
- **Primitive Plan** (double face) et **nœud Groupe** (≈ Node3D) pour organiser les niveaux.
- **Scripts en assets** : 📜 dans le panneau Projet, édition par double-clic, attache par
  glisser-déposer sur un objet (viewport ou hiérarchie), sauvegardés dans le `.p3d`.
- Nouveau module `js/environment.js`.
