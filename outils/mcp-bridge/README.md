# Pont MCP — piloter l'éditeur depuis une IA

## Mode cloud (recommandé, éditeur hébergé)

Quand l'éditeur est servi par le service cloud et qu'un compte est connecté, **rien à installer** :
le serveur tient lui-même le relais.

```
IA (Claude, Claude Code, mcp-remote) ──HTTPS POST /api/mcp/t/<jeton>──▶ serveur cloud ◀──WebSocket /api/mcp/ws (session)── onglet de l'éditeur
```

1. Copilote IA → **⚙** → **Pilotage par une IA (MCP)** → **Via le cloud** : cliquer
   **Connecter l'éditeur** (reconnexion automatique toutes les 3 s tant que c'est activé ; un seul
   onglet par compte, le dernier connecté prend la main).
2. **Créer une URL pour mon IA** : l'URL `https://<serveur>/api/mcp/t/<jeton>` n'est montrée
   qu'une fois. Boutons de copie pour :
   - **Claude** (claude.ai / Desktop, *connecteur personnalisé*) : coller l'URL ;
   - **Claude Code** : `claude mcp add --transport http editeur3d <url>` ;
   - **IA locale en stdio** (LM Studio…) : `npx -y mcp-remote <url>`.
3. Les URL actives sont listées sous le formulaire ; **Révoquer** coupe l'accès immédiatement.

Le jeton peut aussi passer en en-tête `Authorization: Bearer <jeton>` sur `POST /api/mcp`.
Transport MCP « Streamable HTTP », réponses JSON (pas de flux SSE, donc pas de
`notifications/tools/list_changed` : relire la liste des outils après avoir connecté l'éditeur).

## Pont local (hors ligne)

Sans service cloud (éditeur lancé en local, open source), le pont ci-dessous joue le même rôle
sur la machine de l'utilisateur.

Ce pont permet à un client MCP (Claude Desktop, Claude Code, LM Studio, ou tout autre client
compatible) d'appeler les commandes du copilote de l'éditeur ouvert dans un onglet du navigateur.

```
client MCP ──stdio (JSON-RPC 2.0)──▶ bridge.mjs ◀──WebSocket 127.0.0.1:8765──▶ onglet de l'éditeur
```

- Node 18 ou plus, **aucune dépendance** (`node:http` et `node:crypto` seulement).
- Écoute uniquement sur `127.0.0.1`. Un jeton aléatoire est tiré à chaque démarrage et affiché sur
  la sortie d'erreur ; l'éditeur doit le fournir pour se connecter. Un seul éditeur à la fois.
- Le premier appel d'une session demande dans l'éditeur : « Autoriser l'IA locale à modifier le
  projet ? ». Chaque modification pose un point d'annulation : Ctrl+Z défait ce que l'IA a fait.

## Options

| Option | Variable d'environnement | Rôle |
|---|---|---|
| `--port N` | `MCP_BRIDGE_PORT` | port WebSocket (8765 par défaut) |
| `--token T` | `MCP_BRIDGE_TOKEN` | jeton fixe (sinon aléatoire à chaque démarrage) |
| `--core-only` | `MCP_BRIDGE_CORE_ONLY=1` | n'expose que les outils du noyau + `load_tools` |
| | `MCP_BRIDGE_TIMEOUT_MS` | délai max d'un appel (120 000 par défaut) |

Le client MCP lance lui-même le pont : le jeton s'affiche alors dans ses journaux. Pour ne pas
avoir à le chercher, fixez-le avec `MCP_BRIDGE_TOKEN` dans la configuration.

## Connecter l'éditeur

1. Ouvrir l'éditeur, puis le **Copilote IA**, puis **⚙**.
2. Section **Pilotage par une IA locale (MCP)** : saisir le port et le jeton, cliquer **Connecter**.
3. L'état passe à « connecté » ; le client MCP reçoit la liste des outils mise à jour
   (`notifications/tools/list_changed`). Tant qu'aucun éditeur n'est connecté, le pont n'expose
   qu'un outil, `editor_status`, qui explique la marche à suivre.

## Claude Desktop

`claude_desktop_config.json` (Windows : `%APPDATA%\Claude\`, macOS :
`~/Library/Application Support/Claude/`) :

```json
{
  "mcpServers": {
    "editeur3d": {
      "command": "node",
      "args": ["D:/chemin/vers/moteur/outils/mcp-bridge/bridge.mjs"],
      "env": { "MCP_BRIDGE_TOKEN": "choisissez-un-jeton" }
    }
  }
}
```

## Claude Code

```sh
claude mcp add editeur3d -e MCP_BRIDGE_TOKEN=choisissez-un-jeton -- node /chemin/vers/moteur/outils/mcp-bridge/bridge.mjs
```

## Client générique (LM Studio, etc.)

Tout client qui lance un serveur MCP en stdio : commande `node`, argument le chemin de
`bridge.mjs`, variables d'environnement au besoin. Pour LM Studio, la même entrée
`mcpServers` que Claude Desktop va dans son `mcp.json`.

## Modèles locaux

Piloter l'éditeur demande un modèle **solide en appel d'outils** : choisir un modèle entraîné pour
le tool use (famille Qwen récente, Llama 3.1+ « instruct » avec outils…) servi par LM Studio.
Un petit modèle se perd dans un catalogue d'une centaine d'outils : lancer le pont avec
`--core-only`. Il n'expose alors que le noyau (lister, créer, transformer, matériau simple,
scripts…) et `load_tools`, que le modèle appelle pour ajouter un domaine (`2d`, `audio`, `ui`,
`render`, `animation`, `gameplay`, `terrain`, `data`) à la liste — le pont notifie alors le client.

## Protocole éditeur ↔ pont

```
éditeur → pont : {type:'hello', token, catalog:[{name, description, input_schema, domain}], instructions, knowledge}
pont → éditeur : {type:'welcome'} | {type:'error', message}  (fermeture 4001 jeton, 4002 déjà connecté)
pont → éditeur : {type:'call', id, name, input}
éditeur → pont : {type:'result', id, text, image?, isError}   (image : data URL PNG)
éditeur → pont : {type:'catalog', catalog}                    (catalogue rafraîchi)
```

## Ce que le pont apprend à l'IA

Le client MCP lit les instructions au `initialize`, **avant** que l'éditeur ne soit connecté. Le
pont répond donc toujours avec les règles du moteur, importées de `js/ai-guidelines.js` — le même
texte que le copilote intégré (`COPILOT_SYSTEM`) : méthode de construction par étapes, contenu en
assets, un script court par comportement, réglages en `@vars`, rangement, sauvegarde.

- **Ressources** (`resources/list`, `resources/read`) : les guides `editeur3d://guide/{regles,
  methode, scripts, jeu-2d, niveau-3d, materiaux, sons}` ; une fois l'éditeur connecté, l'état du
  projet `editeur3d://projet/{scene, assets, audit, conception}` (relayé à `summarize_scene`,
  `list_assets`, `audit_project`, `read_design`) ; et `editeur3d://pont/usage`.
- **Prompts** (`prompts/list`, `prompts/get`) : `nouveau_jeu`, `peupler_scene`,
  `ajouter_comportement`, `audit_projet`, `decouper_script`.
- **Usage** : appels, échecs et enchaînements (`a → b`) par outil, cumulés entre sessions dans
  `<tmp>/editeur3d-mcp-usage.json` (`MCP_BRIDGE_USAGE_FILE=chemin`, ou `off`). C'est ce qui dit quel
  outil composé ajouter au moteur, comme `build_room`.
- **Erreurs** : un outil inconnu reçoit les noms proches (et le domaine à charger) ; un script
  refusé renvoie vers le guide `scripts`.
- `listChanged` : outils et ressources, notifiés à la connexion et à la déconnexion de l'éditeur.

`knowledge` (dans le `hello`) est la même chose en JSON (`knowledgePayload()`), pour le relais cloud
`cloud/back/mcp/`, qui n'importe rien du moteur ; le pont local l'ignore.

Tests : `node --test moteur/test/mcp-bridge.test.mjs moteur/test/mcp-link.test.mjs`.

## Blender

Les commandes `blender_*` (js/copilot-blender.js) passent par les DEUX liens ci-dessus comme les
autres : l'IA modélise dans Blender, et c'est l'onglet de l'éditeur qui relaie à l'addon EVAVEO
Blender Bridge sur 127.0.0.1:9877 (le jeton Blender ne passe jamais par le cloud). Installer
l'addon depuis **Fenêtres → Atelier Blender**. Méthode servie à l'IA : `editeur3d://guide/blender`.
Commencer par `blender_status`.
