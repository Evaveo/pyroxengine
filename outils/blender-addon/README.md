# EVAVEO Blender Bridge — l'addon Blender de l'éditeur

Relie Blender (4.5 LTS ou plus récent) à l'éditeur, sans rien d'autre à installer : ni Python
système, ni Studio, ni blender-mcp. L'addon tient un petit serveur HTTP sur **127.0.0.1:9877** ;
l'éditeur l'appelle depuis **Fenêtres → Atelier Blender**, et une IA branchée par MCP (cloud ou pont
local) l'atteint par les commandes `blender_*` du moteur.

## Installer

1. Fenêtres → Atelier Blender → **Télécharger l'addon** (`exemples/blender/evaveo_blender_bridge.zip`).
2. Blender : Édition → Préférences → Add-ons → ⌄ → **Installer depuis le disque**, cocher
   « EVAVEO Blender Bridge ». La liaison démarre seule (case « Démarrer avec Blender »).
3. Vue 3D → barre latérale (N) → onglet **EVAVEO** → **Copier le jeton**, et le coller dans l'Atelier.
4. Éditeur **en ligne** : dans l'Atelier, **Copier l'origine**, puis dans Blender **Autoriser
   l'éditeur en ligne**. Le navigateur peut demander l'accès au « réseau local » : accepter.

Le jeton est **persistant** (préférences de l'addon) ; **Nouveau jeton** révoque l'ancien.

## Contenu

| Fichier | Rôle |
|---|---|
| `__init__.py` | Préférences, panneau N, démarrage et arrêt du serveur |
| `server.py` | Routes HTTP (protocole v1), file vers le fil principal de Blender (`bpy.app.timers`) |
| `guards.py` | Les bornes, **sans bpy** : jeton, origines, chemins, noms d'upload, opérations permises |
| `pipeline.py`, `production.py`, `common.py` | Le pipeline repris d'EVAVEO Asset Pipeline 0.2 (modélisation, PBR, UV, rig, animation, atlas, export) |

**Le moteur est désormais la source de vérité de ce pipeline** : EVAVEO 3D Studio est abandonné.

## Règles pour l'IA qui pilote l'addon

La méthode complète est servie par le MCP (`editeur3d://guide/blender`) et les règles critiques sont
APPLIQUÉES par le moteur : leur texte vit dans `moteur/js/ai-rules.js` (ne pas le recopier ici). Les
règles qui évitent de
gaspiller des itérations :

- Toujours retoucher la **dernière** version (`edit_vertices`, `transform`, `modifier`) ; ne jamais
  restaurer un checkpoint plus ancien ni supprimer une pièce validée sans demande explicite.
- Modéliser une moitié puis `MIRROR {axes:[true,false,false]}` ; souder (`join` + `cleanup`, `BOOLEAN UNION`)
  plutôt qu'empiler des primitives, mais garder séparées les pièces encore critiquées.
- Ne pas importer dans le projet avant validation du rendu par l'utilisateur.

## Protocole v1

Jeton `Authorization: Bearer …` exigé partout sauf `/hello`.

| Route | Rôle |
|---|---|
| `GET /hello` | protocole, versions, dossier de travail, opérations |
| `POST /call` | `{op, args}` → résultat, ou `{job_id}` pour une opération longue |
| `GET /job/<id>` | `state` (queued, running, succeeded, failed), `progress`, `message`, `result` |
| `GET /file?path=` | un fichier du dossier de travail (confiné) |
| `GET /log` | derniers appels reçus |
| `POST /upload?name=` | envoie un fichier dans `uploads/` |

Une opération qui rend ou exporte **occupe le fil principal** de Blender : l'interface de Blender
est figée pendant un bake ou un export, comme elle l'était avec blender-mcp.

## Après une modification

```
node outils/blender-addon/build-zip.mjs
python -m unittest discover -s outils/blender-addon/tests
```

Le premier refait le zip commité (`test/blender-addon.test.mjs` échoue s'il est périmé). Le
second teste `guards.py` sans Blender. Le câblage du serveur se teste à la main dans Blender.
