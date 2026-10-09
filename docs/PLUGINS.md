# Écrire un plugin pour l'éditeur

Un plugin est **un seul fichier `.js`** exécuté au démarrage de l'éditeur. Il reçoit l'objet
`Editor` et y enregistre ses extensions. Pas de build, pas d'`import`, pas de `package.json`.

> ⚠ Un plugin s'exécute avec **tous les droits de la page** (scène, projet, réseau). N'installez
> que du code dont vous connaissez la provenance.

## 1. Démarrage rapide

```js
// hello.js
Editor.registerCommandMenu({
  menu: 'Extensions', caption: '👋 Bonjour', shortcut: 'Ctrl+Alt+H',
  action: function(){ Editor.api.setStatus('Bonjour depuis un plugin', 3000); }
});
```

Installation : **Fichier → 🧩 Plugins → Plugins installés… → « ＋ Installer un .js… »**. Le plugin s'exécute
immédiatement et à chaque démarrage. La modale permet de le désactiver ou de le retirer.

Pour les plugins **livrés avec le moteur**, **Fichier → 🧩 Plugins → 🏪 Parcourir le catalogue…** ouvre
le catalogue **dans l'éditeur** (une fenêtre modale) : il les présente, se filtre, et les installe
en un clic dans le projet ouvert. La page `plugins.html` existe toujours pour un lien partagé
(lecture et téléchargement du `.js`).
en un clic. Voir § 10 si vous en ajoutez un au dépôt.

Réinstaller un fichier du même nom remplace son code. **Rechargez l'éditeur** après une mise à jour
ou un retrait : les entrées de menu et de barre d'outils déjà construites ne se démontent pas.

## 2. Contexte d'exécution

- Le code tourne en `"use strict"` dans une fonction qui reçoit `Editor` (alias historique :
  `Editeur`). `Editor` n'est **pas** une globale : il n'existe que dans le fichier du plugin.
- `import` est impossible. Tout ce dont un plugin a besoin passe par `Editor.api` (§ 4).
- Une exception au chargement est journalisée dans la Console et affichée dans la modale ; les
  autres plugins continuent de se charger.
- Stockage : `localStorage` du navigateur (clé `moteur3d-plugins`). Cochez **« Dans le projet »**
  dans la modale pour que le plugin voyage avec le projet et parte dans le jeu publié (§ 6).

## 3. Points d'extension

| Méthode | Obligatoire | Effet |
|---|---|---|
| `registerTypeObject({type, name, icon, make, serialize, restore, inspector})` | `type`, `make` | Nouveau type d'objet, créable depuis la barre et le menu Objet |
| `registerSystem({name, requires, order, onFrame})` | `name`, `onFrame` | Travail par image (éditeur et jeu) |
| `registerComponent(Classe)` | sous-classe de `Editor.api.Component` avec `static get typeName()` | Nouveau composant, listé dans « + Component » |
| `registerInspectorSection({forType, id, title, sections})` | `sections` | Section d'inspecteur (pour un type, ou tous les objets si `forType` absent) |
| `registerPanel({id, title, icon, sections, targets, defaultZone})` | `id`, `title` | Panneau dockable, listé dans le menu Fenêtres |
| `registerFieldType({type, create, write, read})` | `type`, `create` | Nouveau type de champ pour les formulaires |
| `definePref({key, label, type, default, category})` | `key` | Préférence d'éditeur (par machine) |
| `defineProjectSetting({key, label, type, default, section})` | `key` | Réglage enregistré **dans le projet** |
| `registerImporter({name, extensions, importer})` | `extensions`, `importer` | Prend en charge un format de fichier déposé dans le panneau Projet |
| `registerCommandMenu({menu, caption, shortcut, active, action})` | `caption`, `action` | Entrée de menu (le menu est créé s'il n'existe pas) |
| `registerValidator({name, check})` | `check` | Règle ajoutée à l'analyse du projet |
| `registerMaterial({name, category, properties, make})` | `name`, `make` | Matériau (shader TSL) avec son inspecteur généré |

Toutes lèvent une erreur explicite si un champ obligatoire manque.

### Identifiants : ce qui est préfixé, et ce qui ne l'est pas

- **Préfixés automatiquement** par un identifiant d'installation (`pXXXXXX:`) : ids de panneau,
  de section, de type de champ et clés de préférence. Deux plugins peuvent donc utiliser `palette`
  sans collision. **La valeur renvoyée par la méthode est l'id réel.**
- **Jamais préfixés** : `type` d'un type d'objet, `typeName` d'un composant, clé d'un réglage de
  projet, nom d'un matériau. Ils sont écrits dans le fichier de projet : choisissez-les uniques
  (préfixez-les vous-même par le nom du plugin), et **ne les renommez plus** une fois publiés.
- Les types et composants natifs (`mesh`, `camera`, `Physics`, `Light`…) sont protégés : un
  plugin ne peut pas les remplacer.

### Formulaires déclaratifs

Sections d'inspecteur, panneaux et inspecteurs de type utilisent le même descripteur, rendu par
le socle (`js/ui/form.js`). Vous n'écrivez ni HTML ni gestion d'événements :

```js
sections: [{ id: 'borne', title: 'Borne', fields: [
  { label: 'Portée', type: 'number', min: 1, max: 50, step: 0.5,
    get: function(o){ return o.userData.borne.range; },
    set: function(o, v){ o.userData.borne.range = v; } }
]}]
```

Types de champ natifs : `number`, `text`, `textarea`, `color`, `checkbox`, `choice`
(`options: [[valeur, libellé], …]`), `vec3`, `pair`, `assetSlot`, `texture`, `info`, `note`
(texte d'explication), `action` (`{label, run}`), `list` (`{items, fields}`).
Pour un panneau, `targets()` renvoie les objets que ses champs lisent et écrivent — ce peut être
l'état du plugin lui-même, pas seulement des objets de la scène.

**Ouvrir et fermer un panneau** est l'affaire de `Dock`, pas de `Panels` : `Dock.open(id)` dit
s'il est ouvert, `Dock.toggle(id)` le bascule. `defaultZone` (`'right'`, `'left'`, `'bottom'`)
décide de sa colonne ; il vaut `'right'` par défaut depuis la v0.185.1 — avant, un panneau sans
zone était déclaré, enregistré, et **introuvable** : absent du menu Fenêtres, jamais monté, et
sans le moindre message.

### Type d'objet

`make()` renvoie un `THREE.Object3D`. L'état propre au plugin vit dans `userData` ;
`serialize(o)` en renvoie une copie JSON, `restore(o, data)` la relit au chargement du projet.

### Composant

```js
class Spin extends Editor.api.Component {
  static get typeName(){ return 'MonPlugin.Spin'; }
  hydrate(data){ this.speed = (data && data.speed) || 1; }   // seul point de relecture
  serialize(){ return {speed: this.speed}; }                  // données pures, détachées
  onAdd(){ /* brancher sur le monde */ }
}
Editor.registerComponent(Spin);
```

Respectez le contrat de `js/component.js` : pas de DOM, pas de scène dans le constructeur, ne
surchargez pas `restore()`.

### Système

```js
Editor.registerSystem({
  name: 'MonPlugin.spin', requires: ['MonPlugin.Spin'], order: 0,
  onFrame: function(instances, dt, ctx){
    if(ctx.mode !== 'play') return;             // 'edit' dans l'éditeur, 'play' en jeu
    instances.forEach(function(c){ c.node.rotation.y += c.speed * dt; });
  }
});
```

`instances` = les composants **actifs** des types listés dans `requires`. Une exception est
journalisée une fois et n'arrête pas les autres systèmes.

### Matériau

`properties` suit **exactement** le format de `js/material-props.js` (`{section}`, puis
`{key, type, label, min, max, step, default, help}`). Cette table génère l'inspecteur, borne les
saisies et décrit le matériau au copilote. `make(p, ctx)` renvoie un matériau three écrit en
nœuds TSL. `ctx = {THREE, TSL, texture(key), props}` ; `ctx.TSL` peut valoir `null` si le pont
WebGPU n'est pas prêt. Exemple complet : `exemples/plugin-materiau-hologramme.js`.

### Importeur, validateur

```js
Editor.registerImporter({ name: 'niveaux', extensions: ['lvl'],
  importer: function(file, opts){ file.text().then(function(txt){ /* … */ }); } });

Editor.registerValidator({ name: 'bornes', check: function(report){
  report('warn', 'message');   // niveaux : 'error', 'warn', 'info'
}});
```

## 4. `Editor.api`

| Membre | Rôle |
|---|---|
| `THREE`, `TSL`, `Component` | Bibliothèques et classe de base |
| `scene`, `objects`, `selection`, `project`, `assets`, `env` | État courant (lecture) |
| `createObject(type)`, `addObject(o, height)`, `select(o)` | Manipuler la scène |
| `pushHistory()` | À appeler **avant** une modification, pour qu'elle soit annulable |
| `updateHierarchy()`, `buildInspector()` | Rafraîchir l'interface après modification |
| `setStatus(msg, ms)`, `journal(level, msg, obj)` | Barre d'état, Console |
| `openModal(title, html)`, `closeModal()`, `escapeHtml(s)` | Fenêtre modale |
| `openPanel(id)` | Ouvre (ou passe devant) un panneau, avec l'id rendu par `registerPanel` |
| `createMaterialPlugin(name)` | Crée un asset piloté par un matériau de plugin |
| `importFiles(files, opts)` | Fait entrer des fichiers dans le projet, **par le chemin du glisser-déposer** |
| `copilotTools()`, `copilotRun(name, args)` | Liste des commandes du copilote, et exécution d'une commande (asynchrone, historisée) |

`importFiles` prend une liste de `File`. Un plugin qui a des octets en fabrique un :
`new File([octets], 'modele.glb')` — et c'est **l'extension du nom** qui décide du traitement,
exactement comme pour un fichier glissé dans le panneau Projet. Modèles (`.glb`, `.gltf`,
`.fbx`), images, sons, et les formats qu'un `registerImporter` a pris en charge.

C'est ce qui permet à un plugin d'aller chercher un modèle ailleurs — un outil local, une
bibliothèque en ligne — et de le faire entrer sans demander un glisser-déposer. L'asset obtenu
est **indiscernable** d'un asset glissé : pas de second chemin d'import à maintenir.

## 5. Déboguer

- Les erreurs de chargement apparaissent dans la **Console** de l'éditeur et sous le nom du plugin
  dans la modale.
- `debugger;` dans le code du plugin fonctionne avec les outils du navigateur.
- Tests sans navigateur : charger `js/plugins.js` dans `test/engine-env.mjs` et appeler
  `runPlugin({name, code, active: true, uid})` — voir `test/plugins-api-v2.test.mjs`
  (`sansPontGlobal` reproduit l'éditeur réel, où `Editor` n'est pas global).

## 6. Plugins du projet et jeu publié

Case **« Dans le projet »** de la modale : le plugin est copié dans `project.settings.plugins`.

- Il voyage avec le projet (`.p3d`, dossier, cloud). À l'ouverture sur une autre machine, il est
  rejoué après la même question de confiance que les scripts d'autrui.
- Il part dans le build. Le jeu publié (`js/plugin-host.js`) rejoue **les composants, systèmes,
  types d'objets et matériaux** ; les panneaux, sections, menus, préférences, importeurs et
  validateurs y sont ignorés. `Editor.runtime` vaut `true` dans le jeu : testez-le avant
  d'appeler une fonction d'édition de `Editor.api` (dans le jeu, `api` ne porte que `THREE`,
  `TSL`, `Component`, `journal`).
- Réinstaller le plugin met aussi à jour sa copie dans le projet. Pensez à enregistrer le projet.

## 7. Limites actuelles

- Pas de rechargement à chaud propre : recharger l'éditeur après une mise à jour ou un retrait
  (les entrées de menu construites restent affichées).
- Un plugin **non** rangé dans le projet n'existe pas dans le jeu publié : ses matériaux y
  retombent sur le matériau natif (la console du jeu le signale).

## 8. Exemples

- Menu Plugins → « 📄 Voir un exemple » : type d'objet + inspecteur + préférence + validateur.
- `exemples/plugin-materiau-hologramme.js` : matériau TSL.
- `exemples/plugin-pont-mcp.js` : commande de menu et usage de `Editor.api`.
- Pour brancher un outil externe, voir § 9 : le patron est celui de l'Atelier Blender, intégré
  au moteur (`js/blender-link.js`).

## 9. Brancher un outil externe (patron)

L'**Atelier Blender** (Fenêtres → Atelier Blender, `js/blender-link.js`) relie l'éditeur à un
addon Blender qui tient un petit serveur local et exporte des GLB. Il a remplacé en v0.188.0 le
plugin EVAVEO Studio et l'application Python qu'il pilotait. Le chaînage vaut pour n'importe quel
outil local, qu'il soit branché par un plugin ou par le moteur :

```
outil → son API HTTP locale → plugin → Editor.api.importFiles([...]) → asset du projet
```

**Trois bornes, à reprendre telles quelles.** Un plugin qui fait entrer des octets venus
d'ailleurs est exactement le genre d'outil qui devient une porte s'il ne se borne pas lui-même :

1. **L'adresse doit être locale** — `127.0.0.1`, `localhost` ou `[::1]`, vérifiée en analysant
   l'URL et non par une sous-chaîne (`http://127.0.0.1.exemple.com/` contient « 127.0.0.1 »).
   Refusez **à la saisie**, pas seulement à l'appel.
2. **Les octets doivent être du format annoncé** — la signature `glTF` en tête d'un GLB. Un
   service qui répond une page d'erreur HTML donnerait sinon un asset vide, et la panne se
   chercherait dans le moteur.
3. **Les chemins viennent du service, jamais de la saisie.** Le plugin ne construit aucun chemin.

**Côté service, l'ouverture doit être explicite.** Un serveur local bien fait refuse les appels
venus d'une autre page — c'est ce qui le protège d'un site ouvert dans un autre onglet. L'addon
Blender n'autorise ainsi que l'éditeur local par défaut ; l'éditeur en ligne s'y ajoute en collant
son origine (bouton « Autoriser l'éditeur en ligne » dans Blender) : c'est le bon défaut. N'utilisez jamais `Access-Control-Allow-Origin: *` quand un jeton suffit à
autoriser : il laisserait n'importe quelle page tenter sa chance.

**Un secret se colle, il ne se code pas en dur.** Le jeton de session vit dans le `localStorage`
du plugin et se ressaisit quand le service redémarre.

## 10. Ajouter un plugin au catalogue

Le catalogue (**Fichier → 🧩 Plugins → 🏪 Parcourir le catalogue…**, et la page `plugins.html`) affiche ce que décrit
**`exemples/catalogue.json`**. Un plugin déposé dans `exemples/` sans entrée dans ce fichier
**fait échouer `test/catalogue-plugins.test.mjs`** — et l'inverse aussi : une entrée qui cite un
fichier absent donnerait un bouton « Installer » qui échoue. Les deux se vérifient contre le
dossier, pas contre une seconde liste.

Une entrée :

```json
{
  "file": "plugin-mon-outil.js",
  "title": "Mon outil", "icon": "🔧", "category": "Outils externes",
  "summary": "Une phrase : ce que ça fait pour l'utilisateur.",
  "description": "Le paragraphe : comment ça marche, ce que ça touche.",
  "extends": ["Panneau « Mon outil »", "Menu Extensions"],
  "requires": ["Ce qu'il faut AVANT d'installer — service lancé, jeton, navigateur…"],
  "warning": "Facultatif : ce qui peut surprendre (un port partagé, un droit large…)."
}
```

`file` est le seul champ qui lie le catalogue au code. `category` engendre les filtres de la
page : réutilisez une catégorie existante plutôt que d'en créer une variante.

**La page n'installe rien.** Installer veut dire exécuter du code avec tous les droits de
l'éditeur, et la page du catalogue n'est pas l'éditeur : elle lui envoie un **nom de fichier** par
`postMessage`, et c'est lui qui vérifie, lit `exemples/<nom>`, avertit et installe. Elle
n'envoie **jamais** le code — sinon `postMessage` deviendrait un canal d'exécution. L'éditeur
refuse toute demande qui ne vient pas de la fenêtre qu'il a lui-même ouverte, d'une autre origine,
ou qui nomme un fichier absent du catalogue (`js/plugin-catalog.js`, `installRequestFile`).
