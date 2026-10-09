# API pour l'IA — construire un jeu dans cet éditeur

Référence destinée à un modèle qui pilote l'éditeur, et à l'humain qui relit ce
qu'il a produit.

Tout ce qui suit a été **mesuré ou constaté en construisant deux jeux complets**
(`exemples/construire-demo-plateforme.mjs` et `exemples/construire-foot.mjs`),
pas déduit du code. Les pièges signalés sont ceux dans lesquels on est
réellement tombé.

---

## 1. La règle qui coûte le plus cher

> **Les commandes peuvent TOUTES réussir et produire un jeu injouable.**

C'est arrivé au premier essai : six plateformes posées, aucune commande en
échec, et un « jeu de plateforme » sans un seul saut à faire parce qu'elles se
chevauchaient toutes. Rien ne l'avait signalé.

Deux conséquences pratiques :

1. **Lire les tailles, ne jamais les déduire.** `list_scene` renvoie `taille`
   et `etendue` — s'en servir.
2. **Appeler `analyze_scene` après avoir construit.** Il signale les
   chevauchements, les trous infranchissables, les objets hors de portée.

---

## 2. Tailles réelles des primitives (mesurées)

Une échelle de 1 ne donne **pas** un objet d'une unité. Largeur réelle =
`échelle × taille native`.

| Type       | Taille native (X, Y, Z) | Pivot            |
|------------|-------------------------|------------------|
| `cube`     | 1,6 × 1,6 × 1,6         | centre (−0,8…0,8)|
| `sphere`   | 2 × 2 × 2 (rayon 1)     | centre           |
| `cylinder` | 1,6 × 1,8 × 1,6         | centre           |
| `cone`     | 2 × 2 × 2               | centre           |
| `torus`    | 2,8 × 2,8 × 0,8         | centre           |
| `plane`    | 4 × 0 × 4               | à y = 0          |

Erreurs réellement commises avec ce tableau sous les yeux :

- une plateforme voulue large de 4 mise à `échelle 4` → **6,4** de large ;
- un rond central deux fois trop grand, le torus faisant 2,8 et non 1,6 ;
- un ballon de football mis à la **taille exacte d'un joueur**.

Le pivot étant au centre, un cube posé au sol a `y = 0,8`, pas 0.

---

## 3. Ordre de travail qui marche

```
list_scene                 → connaître l'état, jamais le supposer
create_object / transform    → construire
configure_game               → poser les tags (le gameplay s'y accroche)
create_data                → les tables de contenu AVANT les scripts
attach_script              → la logique
configurer_interface         → le HUD
analyze_scene               → CONTRÔLER avant de rendre la main
```

### Ne pas supposer l'état de la scène

`delete_object` **emporte les enfants**, et la scène de départ parente la
sphère et le spot au cube. Lister une fois puis supprimer en boucle fait échouer
les appels suivants sur des objets déjà partis. Re-lister entre deux
suppressions :

```js
for (let g = 0; g < 200; g++) {
  const r = lister().find(o => o.type !== 'camera');
  if (!r) break;
  C('delete_object', { nom: r.nom });
}
```

### Corriger un script, ne pas l'empiler

`attach_script` **ajoute**. Corriger avec `attach_script` laisse les deux
versions en place, et les deux s'exécutent. Pour modifier :
**`replace_script`** (`index` = 0 pour le premier).

---

## 4. Les 25 commandes

**Lire** — `list_scene` (nom, type, position, **taille**, étendue, échelle,
tag, parent, physique, nombre de scripts), `list_assets`, `analyze_scene`.

**Construire** — `create_object`, `duplicate_object` (emporte scripts, matériau,
tag — préférer aux créations répétées), `delete_object`, `rename_object`,
`transform`, `set_parent`.

**Habiller** — `configure_material`, `configure_environment`,
`configure_particles`, `generate_terrain`.

**Gameplay** — `configure_game` (tag, calque), `configure_physics`,
`configure_inputs`, `attach_script`, `replace_script`,
`remove_script`, `add_event`.

**Contenu et interface** — `create_data`, `configurer_interface`.

**Art** — `create_texture` (images procédurales), `bake_iso_sprites` (sprites isométriques 1-16 directions depuis des primitives 3D, masque d'équipe + table d'ancrages), `import_image` (PNG en base64 → asset texture, planche découpée si `cell`). Les sprites sont des **assets**, jamais dessinés par un script au lancement ; un script qui dessine lui-même les lit avec `api.image(nom)`.

**Scènes** — `manage_scenes` (`create` crée **et active**, `activer` bascule, `rename` renomme, `delete` supprime),
`instantiate_subscene`, `set_play_mode`.

---

## 5. API des scripts

Un script définit `demarrer(api)` (une fois) et/ou `mettreAJour(api)` (chaque
image). Chaque nom existe aussi en anglais (`api.creer` / `api.create`).

### Lecture de scène
`api.moi`, `api.dt`, `api.temps`, `api.trouver(nom)`, `api.parTag(tag)`,
`api.parCalque(c)`, `api.distance(a, b)`, `api.props(cible)`, `api.tag(cible)`,
**`api.boite(cible)`** → `{min, max, taille, centre}` — les dimensions réelles.

### Entrées
`api.action(nom)`, `api.actionAppuyee(nom)` (front montant),
`api.axe('horizontal'|'vertical')`, `api.touche(k)` en dernier recours.

**Souris.** `api.mouse()` rend une POSITION (normalisée −1…+1). Pour une vue à la première
personne, ce n'est pas ce qu'il faut : sans capture du pointeur, la souris bute sur le bord de la
fenêtre au bout d'un quart de tour ; sous capture, la position ne bouge **plus du tout**. Les
trois entrées à utiliser sont alors :

- **`api.mouseDelta()`** → `{x, y}`, le déplacement en pixels depuis l'image précédente. Cumulé
  sur l'image (plusieurs événements arrivent entre deux rendus) puis remis à zéro.
- **`api.lockMouse(voulu?)`** — demande la capture. Elle ne s'obtient QUE dans un geste
  utilisateur : l'appel pose une **intention**, et c'est le prochain clic qui la réalise. Appelée
  depuis la boucle, la demande serait refusée *sans bruit* par le navigateur.
- **`api.mouseLocked()`** — l'a-t-on ? Échap la rend au joueur ; l'intention restant posée, le
  clic suivant la reprend. Un FPS s'y met en pause et affiche « cliquez pour reprendre ».

Deux gardes qui ont coûté un moment de recherche chacune : **le tir doit être conditionné à
`api.mouseLocked()`** (sinon le clic qui *reprend* la capture tire aussi, et le joueur perd une
balle chaque fois qu'il revient au jeu), et **la direction du tir se reconstruit depuis le cap et
le tangage**, jamais depuis la matrice de la caméra — celle-ci porte la secousse, et tirer depuis
elle fait viser faux au moment précis où le joueur s'applique le plus.

### Déplacement et physique
- **`api.moveCharacter({speed, jump, gravity, tagGround, yaw, radius})`** — un appel par
  image remplace gravité + détection de sol + calage. Renvoie
  `{auSol, vy, aSaute, tombe, sol}`. Compléter avec `api.reapparaitre()` et
  `api.rebondir(force)`.
  - **`yaw`** (radians) : le déplacement devient relatif au REGARD. Sans lui, « avancer » va vers
    −Z du monde où que la caméra pointe — inutilisable dès qu'elle tourne. L'avant d'un nœud du
    moteur est +Z : avant = (sin cap, 0, cos cap). Dans ce mode, la diagonale ne va pas plus vite
    que la ligne droite.
  - **`radius`** : le demi-hauteur du personnage. **À donner dès que le nœud n'est pas lui-même
    le visuel du personnage.** Sans lui, il est déduit de la boîte englobante — et sur un joueur
    en vue subjective, cette boîte ne contient que l'arme tenue devant l'objectif : 8 cm, donc un
    rayon de 4 cm, donc les yeux au ras du sol. Rien ne le signale, le personnage touchant bien le
    sol à la hauteur mesurée.
- `api.placer(cible, {x,y,z})` — téléportation. **Indispensable** pour un corps
  rigide : la physique écrit corps → objet et jamais l'inverse, donc écrire dans
  `.position` est effacé à l'image suivante.
- `api.definirVitesse(cible, v)`, `api.appliquerForce(cible, f)`, `api.vitesse(cible)`.
- `api.raycast(origine, direction, distance, {tag})` — **le filtre compte** :
  sans lui seul le premier impact est rendu, et un objet ramassable flottant
  devant une plateforme casse la détection de sol.

### Contacts
**`api.auContact(tag, fn)`** — appelé une fois à l'ENTRÉE en contact. Remplace
la comparaison de distances sur chaque cible à chaque image.

⚠️ Le contact est un **recouvrement de boîtes**, nettement plus strict qu'une
comparaison de distances : un petit objet croisé à la course se rate. Mesuré sur
la démo — des pièces de 0,98 de large étaient ramassées à une approche de 0,97 à
1,32, c'est-à-dire à la limite exacte, et une pièce sur six manquait au hasard.
**Un objet à ramasser doit être large d'au moins la moitié du personnage.**

### État de jeu et contenu
- **`api.etat`** — objet global qui **survit aux changements de scène**. Score,
  vies, inventaire, progression y vont. Les propriétés d'objets, elles, sont
  restaurées à chaque transition.
- `api.sauvegarder(nom)` / `api.charger(nom)` / `api.effacerSauvegarde(nom)`.
- **`api.donnees(nom)`** — lit une table `create_data`, analysée et mise en
  cache. Une table absente renvoie `null` sans faire planter la partie.

### Interface
`api.uiDocument(noeud)` renvoie `null` si le Noeud n'a pas de composant
`UIDocument` (ou, côté jeu publié, pas de bag `userData.uiDoc`) ; sinon un
objet avec :
- `.html` (**lecture seule**) — le HTML de l'asset `documentUI` référencé.
- `.css` (**lecture seule**) — le CSS de la (ou des) feuille(s) de style
  `feuilleStyle` référencée(s), concaténées.
- `.values` (lecture/écriture) — les valeurs liées via `data-bind="cle"` dans
  le HTML, synchronisées avec les champs de saisie côté joueur.

`.html`/`.css` sont en lecture seule : le contenu vit sur des assets
`documentUI`/`feuilleStyle` du projet, potentiellement partagés par plusieurs
Noeuds (un thème CSS commun, par exemple) — un script ne les réécrit pas à la
volée. Pour piloter l'UI depuis un script, utiliser `.values` (et le HTML
prévoit ses zones dynamiques via `data-bind`).

Dans le HTML écrit sur `.html` :
- `data-evenement="nom"` sur un élément cliquable émet l'événement via
  `api.evenement`/`api.ecouter`, comme les autres événements de jeu.
- `data-bind="cle"` sur un élément texte ou un `<input>`/`<select>`/
  `<input type=checkbox>` le synchronise avec `.values.cle` : un texte affiche
  ce qu'on y écrit, un champ de saisie renvoie ce que le joueur a saisi, choisi
  ou coché.
- `data-bind-class="cle"` pose une **classe**, ajoutée à celles écrites dans le HTML. C'est la
  seule façon de déclencher une animation CSS depuis un script — donc la seule façon d'avoir un
  voile de dégât, une vie qui pulse, un réticule qui claque — puisqu'une feuille de style ne peut
  pas réagir à du texte.

  **Piège mesuré : reposer la MÊME classe ne rejoue pas l'animation** (le navigateur ne voit aucun
  changement), si bien que deux coups rapprochés n'en montrent qu'un. On écrit donc deux classes
  qui décrivent la même animation (`hurt-a` / `hurt-b`) et on les alterne à chaque coup.

Un Noeud sans composant `UIDocument` renvoie `null` : vérifier avant d'utiliser
l'objet retourné.

### Divers
`api.creer(nomAsset, position)`, `api.detruire(cible)`, `api.activer(cible, b)`,
`api.apres(s, fn)`, `api.evenement(nom, d)`, `api.ecouter(nom, fn)`,
`api.changerScene(nom)`, `api.jouerSon(nom)`, `api.particules()`,
`api.deplacerVers`, `api.patrouiller`, `api.cheminVers`, `api.regarder`,
`api.statut(msg)`, `api.log/avertir/erreur`.

---

## 6. Motifs qui ont fonctionné

### Une table plutôt que du code
Décrire quarante ennemis dans `create_data` vaut mieux qu'écrire quarante
scripts : c'est éditable sans programmer, ça se relit dans un diff, et c'est
beaucoup plus fiable à générer.

### Séparer les données des objets de scène
Dans le jeu de football, les **équipes** sont des données (nom, couleur) et les
**camps** des objets de scène avec leurs postes. On choisit une équipe, elle est
peinte sur un camp. Ajouter une septième équipe ne demande de toucher ni au code
ni à la scène.

### Une RÉSERVE d'objets, jamais une création par ennemi
Pour des vagues infinies, `api.creer` fait grossir la scène sans fin — et chaque objet créé se
paie en géométrie, en matériau et en corps physique. Poser tous les ennemis dans la scène, cachés,
et les RECYCLER donne trois choses : un coût constant (la millième vague coûte ce que coûte la
première), un lancer de rayon qui ne ralentit pas (il parcourt la liste des objets de la scène), et
la garantie qu'un ennemi en réserve ne peut pas être touché — le moteur ignore les objets
invisibles au lancer de rayon. Ranger et sortir de la réserve passe par **`api.setActive`** et
jamais par `visible` : c'est l'intention qui est lue, et un objet regroupé en instances a déjà
`visible = false`.

Voir `jeux/NeonBreach` : 36 ennemis, 10 traces et 10 émetteurs posés une fois pour toutes.

### Un seul script d'arbitre
Pour un jeu où tout interagit (ballon, dix joueurs, score, écrans), **un** script
sur un objet invisible est bien plus facile à faire jouer juste que dix scripts
qui se coordonnent par événements.

### Personnage cinématique
Ne pas activer la physique sur un personnage jouable. `api.deplacerPersonnage`
donne un contact de plateforme net, et surtout un personnage replaçable.

### Physique d'arcade pour les jeux de balle
Vitesse + frottement + rebond dans le script, plutôt qu'un corps rigide : bien
plus prévisible, et c'est ce que font les jeux du genre.

---

## 7. Pièges constatés

| Piège | Ce qu'on voit | Ce qu'il faut faire |
|---|---|---|
| Tailles supposées | rien — aucune commande n'échoue | lire `taille` dans `list_scene` |
| `attach_script` pour corriger | le jeu se comporte deux fois | `replace_script` |
| Supprimer sans re-lister | « objet introuvable » | re-lister entre chaque suppression |
| `.position` sur un corps rigide | la téléportation ne prend pas | `api.placer` |
| `raycast` sans filtre | on « atterrit » sur un objet volant | passer `{tag}` |
| Comparaison de flottants | un objet posé est vu comme flottant | tolérance (0,01) |
| Objet à la limite de la portée | attrapé une fois sur deux | garder une marge |
| Objet à ramasser trop petit | une pièce sur six manquée au hasard | le faire large — au moins la moitié du personnage |
| Vue subjective pilotée par `api.mouse()` | la vue se bloque au quart de tour, puis se fige | `api.mouseDelta()` + `api.lockMouse(true)` |
| Personnage subjectif sans `radius` | les yeux au ras du sol, et le sol est bien touché | donner `radius` : la boîte ne mesure que l'arme |
| Animation CSS rejouée avec la même classe | un coup sur deux ne montre rien | deux classes alternées (`hurt-a` / `hurt-b`) |
| `rotation.x = tangage` sur une caméra | souris inversée en tangage | la nier : +a autour de X fait regarder en **bas** |
| Direction de tir lue sur la matrice de la caméra | visée juste à plat, fausse en levant les yeux | la reconstruire depuis cap et tangage, mêmes signes |
| Cap lu dans `rotation.y` | un demi-tour se lit **zéro** | le lire sur le quaternion : three décompose (0,1,0,0) en (π, 0, π) |
| Émetteur de particules laissé `actif` en mode rafale | tout explose à la première image, puis plus rien | `active: false`, et `api.particles().emit(n)` |

Deux pièges qui ne concernent pas l'IA mais coûtent des heures : dans un
navigateur dont l'onglet n'est pas affiché, `requestAnimationFrame` **ne se
déclenche pas** — un jeu qui semble figé peut n'être qu'invisible ; et un test
qui s'arrête au premier succès mesure moins de choses qu'on croit.

---

## 8. Contrôler son travail

```
analyze_scene
```

Renvoie `{erreurs, avertissements, infos}`. Les erreurs de **jouabilité** sont à
traiter avant de rendre la main :

- `« A et B se chevauchent »` — il n'y a aucun vide à franchir entre eux ;
- `« N plateforme(s) hors d'atteinte depuis X »` — l'analyseur construit un
  **graphe des sauts possibles en 3D** et le parcourt depuis le sol de départ.
  Il ne compare donc pas seulement des voisins triés par X : un îlot décalé
  latéralement est vu, alors que l'ancienne version le manquait complètement ;
- `« X repose sur une plateforme hors d'atteinte »` — l'objet est correctement
  posé et pourtant inaccessible. Pour un objet tagué `but`, cela veut dire que
  **le niveau ne peut pas être terminé** ;
- `« X est à N u au-dessus du sol »` — hors de portée d'un saut.

La portée de saut est déduite des constantes du script du joueur (vitesse,
impulsion, gravité), avec repli sur des valeurs prudentes si elles sont
introuvables — le rapport le signale alors.

Les deux jeux d'exemple se **terminent** dans leur test : ramasser six pièces et
rejoindre le drapeau pour l'un, marquer un but pour l'autre. Vérifier que les
objets existent laisserait passer une partie entièrement figée.

---

## 9. Format du projet

Une archive `.p3d` contient **un fichier par scène et un par asset**, plus un
manifeste `projet.json`. C'est ce qui permet à deux personnes d'éditer deux
scènes sans conflit, et ce qui ouvrira le chargement par scène — un projet avec
de vrais modèles ne tient pas dans une seule chaîne base64.

```
projet.json        manifeste : tout sauf scènes et assets, + la liste de leurs fichiers
scenes/0.json      une scène
scenes/1.json
assets/0.json      un asset (base64 compris)
```

Les projets enregistrés à l'**ancien format** (JSON gzippé) s'ouvrent toujours :
le chargeur distingue les deux à la signature du fichier.

À ne pas confondre avec `exporterProjetGit`, qui produit une arborescence
destinée à la **lecture par un humain** (scripts en `.js`, assets bruts,
références par nom). Celle-là n'est pas conçue pour être relue par l'éditeur.
