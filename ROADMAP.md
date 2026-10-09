# Roadmap — Éditeur 3D

> Positionnement retenu : **éditeur de niveaux 3D hors ligne, léger et sans installation,
> pour construire, tester et exporter rapidement des prototypes jouables.**
> Différenciants : zéro installation / gameplay par scripts JS et événements / export
> immédiat (données runtime + prototype Web).
> Trio transformateur : **prefabs liés + événements visuels + export Web jouable.**

Statuts : ✅ fait · 🔨 en cours · ⬜ à faire

## P0 — Utilisable en production

| # | Fonctionnalité | Statut | Notes |
|---|---|---|---|
| 1 | **Prefabs liés & variantes** (source, instances liées, Appliquer, Réinitialiser, Rendre unique, variantes, indicateur « modifié ») | ✅ | v1 : Appliquer ne cascade pas vers les variantes |
| 2 | **Format projet lisible par Git** (export ZIP dossier : project.json, scenes/*.scene.json, scripts/, assets/ en fichiers — JSON indenté déterministe) | ✅ | `.p3d` conservé comme archive portable ; import du dossier : ⬜ |
| 3 | **Console & inspection runtime** (onglet Console, logs/avertissements/erreurs, filtre, double-clic → script, compteurs, effacer) | ✅ | Pause sur erreur, image-par-image, vitesse ×0,25–×2 : ⬜ |
| 4 | **API gameplay v2** : `creer`, `detruire`, `activer`, `raycast`, `chevauchementSphere`, `appliquerForce`, `vitesse`, `apres`, `evenement`/`ecouter`, `changerScene` | ✅ | `jouerSon`/`audio` : ✅ (P1-2). **`jouerAnimation` : ✅** — animations des modèles importés (glTF/FBX) : `api.jouerAnimation` / `arreterAnimation` / `animations`, section Animations de l'inspecteur avec aperçu et « au lancement », sérialisé et rejoué dans les builds Web. Deux corrections au passage : les clips glTF étaient **jetés au chargement** (ils vivent sur `gltf.animations`, pas sur `gltf.scene`), et `clone(true)` recopiait la *référence* du squelette — toutes les copies d'un personnage rigué suivaient celui de l'original. **API bilingue** : chaque nom a son alias anglais (`api.creer` / `api.create`). |
| 5 | **Input Map** (`api.action`, `api.actionAppuyee`, `api.axe`, éditeur d'actions dans Fichier → Entrées) | ✅ | Manette : ⬜ |
| 6 | **Build Web jouable en un clic** (index.html + runtime autonome + assets, écran de chargement, caméra principale, plein écran, HUD) | ✅ | Fichier → 🎮 Exporter un build Web ; s'ouvre en double-clic (aucun serveur requis). Verrouillage souris, résolution cible : ⬜ |
| 7 | **Sauvegarde auto & récupération** (IndexedDB, récupération au démarrage, indicateur modifs non sauvées) | ✅ | Historique de versions : ⬜ |

## P1 — Pour les level designers

| # | Fonctionnalité | Statut |
|---|---|---|
| 1 | Événements visuels sans code (Quand… Alors…, triggers, clic, chaînes d'actions avec attente) | ✅ | Déclencheurs : démarrage, entrée/sortie de trigger (par tag), clic, événement reçu. Actions : montrer/cacher/basculer, détruire, émettre, message, attendre, changer de scène. Bus partagé avec les scripts, exécuté aussi dans les builds Web. Collision physique / fin d'animation : ⬜ |
| 2 | Audio (import wav/mp3/ogg, source 2D/3D, volume/boucle/pitch, bus Master/Musique/SFX) | ✅ | Assets 🔊 (mp3/wav/ogg/m4a, double-clic = pré-écoute), source audio par objet (glisser-déposer ; volume, vitesse, boucle, lecture au lancement, 3D spatial + portée), lecture en mode ▶, `api.jouerSon(nom, volume?)` + `api.audio(obj?)`, action d'événement « Jouer le son… », sérialisé/Git/runtime des builds Web. **Bus Master/Musique/SFX : ✅ (v0.175.0)** — `js/audio-bus.js` partagé éditeur/jeu, champ Bus de la source audio, Paramètres du projet → Mixage audio, `api.audioBus(nom)`, commande `configure_audio_mix`. |
| 3 | Particules (émetteur point/boîte/sphère/cône, burst/continu, taille & opacité dans le temps) | ✅ | Objet ✨ Particules (barre d'outils), 4 formes d'émission, continu (débit/s) ou burst, vie/vitesse/gravité, taille + opacité + **couleur** interpolées sur la vie, mélange additif ou normal, aperçu vivant dans l'éditeur, bouton « Émettre maintenant », `api.particules(obj?).emettre(n?)/.activer(bool)`, action d'événement « Émettre des particules… », sérialisé/exports/runtime des builds Web. Reste : textures de particules custom, trainées : ⬜ |
| 4 | Navigation IA (NavMesh simple ou grille, `api.cheminVers`, `api.deplacerVers`, patrouilles) | ✅ | Grille d'occupation 0,5 m (80×80 m) construite au lancement + A* 8 directions avec lissage par ligne de vue ; obstacles = meshes/modèles visibles dans la tranche de marche (tag `sol` et triggers ignorés) ; `api.deplacerVers(cible, vitesse)` (true à l'arrivée), `api.patrouiller([points], vitesse)`, `api.cheminVers(cible)` ; cible = objet, nom ou {x,z} ; runtime des builds Web inclus. Reste : NavMesh polygonal, évitement dynamique entre agents : ⬜ |
| 5 | Placement pro : snap sur surface, alignement normale, pivot commun multi-sélection, aligner/distribuer, duplication axiale/circulaire, peinture de prefabs | ✅ | Menu Objet : ⇩ Poser au sol (sur la géométrie sous l'objet, pas seulement y=0), ⟂ Poser et aligner à la normale, ≡ Aligner/distribuer (min/centre/max + distribution équitable sur X/Y/Z), ⧉ Dupliquer en série (ligne avec décalage, ou cercle avec rayon/arc/orientation) ; 🖌 sur les tuiles prefab = peinture au clic dans la vue avec rotation aléatoire. Reste : pivot commun multi-sélection pour le gizmo : ⬜ |
| 6 | Matériaux complets (assets matériau : albedo/normal/roughness/metallic/émissif/AO, tiling, instances) + édition des modèles importés | ✅ | Assets 🎨 avec toutes les maps PBR (albedo, normale+intensité, roughness, metalness, AO+intensité avec uv2 auto, émissive), tiling/décalage communs, drag & drop sur primitives ET modèles, synchro de tous les usages, sérialisé/Git/export jeu/runtime. Reste (mineur) : instances de matériaux (variations par objet). |
| 7 | Analyser la scène (doublons de noms, références cassées, prefab non appliqué, triggers muets, masses nulles, échelles négatives, scripts invalides, cibles d'événements…) | ✅ | Édition → 🔍 Analyser la scène. Budgets textures/triangles : voir Profiler (P2-3). |
| 8 | **Pilotage par IA (copilote Claude)** — tout l'éditeur et ses paramètres pilotables par une IA ; fenêtre de chat connectée à l'API Claude ; l'IA conçoit ce que l'utilisateur demande | ✅ | `js/copilot.js` — 16 outils, panneau ✨ IA, boucle d'agent (20 tours max), modèle par défaut `claude-opus-5`. Reste : confirmation explicite avant les actions destructives, streaming des réponses : ⬜ |

### Réalisé — P1-8 Pilotage par IA (Claude)

1. **Couche de commandes** (`COMMANDES` dans `js/copilot.js`) — 16 outils avec schéma JSON :
   `list_scene`, `list_assets`, `create_object`, `delete_object`, `rename_object`,
   `transform`, `set_parent`, `configure_material`, `configure_physics`, `configure_game`,
   `attach_script`, `add_event`, `configure_particles`,
   `configure_environment`, `manage_scenes`, `set_play_mode`. Chaque exécution appelle les
   fonctions globales existantes et passe par `pousserHistorique()` → **tout est annulable
   (Ctrl+Z)**, et est journalisée dans la Console de l'éditeur.
2. **Fenêtre copilote** : bouton **✨ IA** de la barre d'outils (ou Aide → Copilote IA) —
   chat, clé API en `localStorage` (jamais dans les projets), choix du modèle
   (`claude-opus-5` par défaut, Sonnet 5 et Haiku 4.5 disponibles), bouton nouvelle
   conversation, affichage des outils appelés.
3. **Boucle d'agent** : `POST https://api.anthropic.com/v1/messages` depuis le navigateur
   (en-tête `anthropic-dangerous-direct-browser-access: true`), `tools` = le catalogue ;
   boucle tool_use → exécution → tool_result jusqu'à `end_turn` (20 tours max), bouton ⏹
   d'interruption, réparation de l'historique si un tour est interrompu, gestion des
   erreurs 401 / refus du modèle.

## P2 — Niveaux ambitieux

| # | Fonctionnalité | Statut |
|---|---|---|
| 1 | Terrain heightmap (sculpture, peinture multi-textures, végétation) | ✅ | Objet ⛰ Terrain (60 m, 64×64), sculpture à la souris (élever/creuser/lisser/aplanir/bruit, rayon à la molette, Maj pour inverser, chaque trait annulable), générateur de relief procédural, coloration automatique par altitude et pente (herbe/roche/neige réglables), collider `CANNON.Heightfield` (sol statique automatique), `api.hauteurSol(x,z)`, outil copilote `generate_terrain`, sérialisé et rendu dans les builds Web. Reste : peinture multi-textures par splatmap, semis de végétation automatique : ⬜ (la peinture de prefabs P1-5 couvre le semis manuel) |
| 2 | Sous-scènes instanciables (scène dans une scène, édition isolée, overrides, rendre unique) | ✅ | Objet ◈ (menu Objet → Instancier une sous-scène) référençant une autre scène du projet : son contenu est régénéré depuis la source, donc éditer la source met à jour toutes les instances. Overrides (transform + visibilité) **capturés automatiquement**, y compris pour les sous-scènes imbriquées (clés « 3/1 »), édition isolée par bouton, rechargement, réinitialisation, rendre unique, anti-cycle et profondeur max 5. Sérialisé (référence seule, pas le contenu), instancié dans les builds Web, outil copilote `instantiate_subscene`. Reste : overrides de matériaux/propriétés (seuls transform et visibilité sont suivis) : ⬜ |
| 3 | Profiler & budgets par plateforme (FPS, draw calls, tris, mémoire GPU, temps scripts/physique/rendu) | ✅ | Affichage → 📊 Profiler : overlay avec graphe des temps d'image, FPS, ms par poste (scripts/physique/particules/rendu), draw calls, triangles, textures, géométries, effectifs de scène — chaque valeur comparée à un budget **PC** ou **Mobile** avec code couleur. Coût nul quand il est fermé. |
| 4 | Post-processing (tone mapping, exposition, bloom, SSAO, AA, color grading, HDRI) | ✅ | `js/postfx.js` — pipeline maison **en TSL** (EffectComposer n'est pas embarqué, et `WebGPURenderer` n'exécute pas les `ShaderMaterial` GLSL bruts) : bloom seuillé en demi-résolution (2 itérations de flou séparable), tone mapping (aucun/linéaire/Reinhard/Cineon/ACES) + exposition, étalonnage (contraste, saturation, température), vignette, grain, FXAA. Réglages **par scène** dans `env.post`, sérialisés et rejoués dans les builds Web. Reste : SSAO, HDRI d'éclairage : ⬜ |
| 5 | Lightmaps & sondes (réflexion, lumière) | 🔨 | **Sondes ✅** : objet 🔮 (Objet → Sonde de réflexion) qui cuit un cubemap à sa position (`CubeCamera`) et le distribue comme `envMap` aux maillages de son rayon d'influence — reflets du décor local sur les surfaces métalliques ou lisses. Rayon, résolution (64→512), intensité, recuisson automatique au ▶, « Cuire toutes les sondes », mesure de la **couleur d'ambiance** du cubemap réutilisable comme teinte de lumière globale (mesure **asynchrone** sous `WebGPURenderer`, détachée de la cuisson — voir `docs/KNOWN_ISSUES.md`). Sérialisée (réglages seuls, cubemap recuit à l'ouverture), cuite aussi dans les builds Web. **Lightmaps ⬜** : la cuisson d'éclairage indirect en texture demande un baker hors-ligne (atlas UV2 + ray tracing) — hors périmètre pour l'instant ; l'AO des matériaux et les sondes couvrent l'essentiel du besoin. |
| 6 | Système de plugins (`Editeur.enregistrerTypeObjet/Inspecteur/Importeur/CommandeMenu/Validateur`) | ✅ | `js/plugins.js` — API `Editeur` avec les 5 points d'extension prévus + `Editeur.api` (accès au cœur : scène, objets, sélection, historique, modales, fabriques de champs). Gestionnaire dans Fichier → 🧩 Plugins (installer un `.js`, activer/désactiver, retirer, voir un exemple complet), plugins conservés dans le localStorage du navigateur. **Un projet ouvert sans son plugin ne perd rien** : l'objet est remplacé par un substitut qui conserve les données brutes et les restitue à la sauvegarde. Erreurs de plugin isolées (l'éditeur reste utilisable). |
| 7 | Collaboration & verrouillage de scènes | ⬜ |

## Dette technique suivie

- Scripts exécutés dans la page (pas de Web Worker sandboxé) — à isoler avec la montée en puissance de l'API.
- ~~three.js r128 : migration à planifier~~ → **faite** : r185 + `WebGPURenderer` (repli WebGL2
  automatique assuré par three), post-traitement et particules réécrits en TSL. Ce qu'il reste
  de ce chantier :
  - ~~le multiplicateur de lissage patche encore les shaders par `onBeforeCompile`~~ →
    **corrigé** en v0.24.3 : nœud TSL pour WebGPU, patch GLSL conservé pour le renderer
    classique des vignettes. Il reste la **prise publique pour shaders personnalisés** : le
    multiplicateur en est le premier client, mais rien ne permet encore à un plugin ou un
    script de brancher son propre nœud (étape 3 de `docs/webgpu-etat.md`).
  - ~~la mesure de couleur d'ambiance des sondes est cassée en silence~~ → **corrigée** en
    v0.24.2, en même temps que la cible cubemap qui venait du mauvais bundle. Le rendu des
    reflets reste **à vérifier à l'œil** : aucun test sans navigateur ne peut le confirmer.
  - ~~chercher les autres classes `WebGL*` absentes du paquet webgpu et les API synchrones
    disparues~~ → **audit fait** en v0.24.4 : deux cas de plus trouvés (anisotropie plafonnée
    à 1, budget « Draw calls » toujours vert) et corrigés. Surtout, l'audit est devenu une
    **garde permanente** — `test/surface-three-webgpu.test.mjs` charge les deux bundles et
    échoue au prochain cas. Reste à vérifier à l'œil : les vignettes d'assets passent par un
    renderer WebGL **classique** avec des objets construits par les classes du paquet webgpu
    (`js/assets.js`), mélange que le pont documente comme risqué — non modifié, faute de
    pouvoir en juger sans navigateur.
  - le backend WebGPU réel n'a jamais été exercé : tout a été mesuré sur le repli WebGL2.
- Pivot commun multi-sélection (voir P1-5).
- Import du format dossier Git (l'export existe).
