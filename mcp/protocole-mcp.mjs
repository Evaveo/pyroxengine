// moteur/mcp/protocole-mcp.mjs
// Couche PROTOCOLE du serveur MCP, sans la moindre entrée/sortie : une fonction qui prend un
// message JSON-RPC et rend la réponse. Tout ce qui touche stdio, HTTP ou le navigateur vit
// dans serveur-mcp.mjs. C'est ce découpage qui rend le protocole testable sous node:test —
// sans lui, la seule façon de vérifier une réponse serait de lancer un vrai agent MCP.
//
// Les noms de champs du protocole (`protocolVersion`, `inputSchema`, `isError`…) sont ceux du
// format de fil : ils restent en anglais, contrairement au reste du dépôt. Tout ce qui est à
// nous est en français.

// Version du protocole parlée par défaut. Un client qui en annonce une autre reçoit la
// SIENNE en écho quand nous la connaissons : refuser une version mineure plus ancienne
// couperait la connexion pour rien.
export const VERSION_PROTOCOLE = '2025-06-18';
export const VERSIONS_CONNUES = ['2025-06-18', '2025-03-26', '2024-11-05'];

// Les règles du moteur, partagées avec le copilote intégré et le pont outils/mcp-bridge.
import { mcpInstructions } from '../js/ai-guidelines.js';

export const INFOS_SERVEUR = {name: 'editeur3d', version: '1.1.0'};

function reponse(id, resultat){ return {jsonrpc: '2.0', id: id, result: resultat}; }

/**
 * Le résultat d'une commande, dans les blocs de contenu de MCP.
 *
 * Certaines commandes rendent une IMAGE — la capture de la view, celle du game qui vient de tourner. MCP
 * a un type pour ça (`{type:'image', data, mimeType}`), et il faut l'utiliser : glissée dans le texte,
 * une image en base64 n'est pas VUE par le modèle, elle est lue comme quarante mille caractères de
 * bruit qui noient tout le reste du contexte.
 *
 * La shape d'entrée est celle du côté navigateur : une chaîne, ou `{texte, image}` où `image` est une
 * data URL. Une chaîne reste une chaîne — les 31 commandes d'origine passent inchangées.
 */
function contenuMcp(raw){
  if(raw && typeof raw === 'object' && raw.image){
    const s = String(raw.image);
    const virgule = s.indexOf(',');
    const blocs = [];
    if(raw.text) blocs.push({type: 'text', text: String(raw.text)});
    blocs.push({type: 'image', data: virgule === -1 ? s : s.slice(virgule + 1), mimeType: 'image/png'});
    return blocs;
  }
  const text = (raw && typeof raw === 'object' && raw.text !== undefined) ? raw.text : raw;
  return [{type: 'text', text: String(text)}];
}
function error(id, code, message){ return {jsonrpc: '2.0', id: id, error: {code: code, message: message}}; }

// Un outil du copilot (`copToolsApi()`, js/copilot.js) est déjà {name, description,
// input_schema} : la seule différence avec MCP est la casse du dernier field. C'est la raison
// pour laquelle COMMANDS est exposable tel quel — le catalogue n'est pas réécrit ici, il est
// transposé. Toute commande ajoutée à l'éditeur, y compris par un plugin, arrive donc côté
// agent sans qu'une ligne de ce fichier change.
export function outilVersMcp(o){
  return {
    name: o.name,
    description: o.description,
    inputSchema: o.input_schema || {type: 'object', properties: {}}
  };
}

// `contexte` : { catalogue() -> [outils], appeler(name, args) -> Promise<string>,
//                editeurConnecte() -> bool }
// Rend la réponse à envoyer, ou null pour une notification (rien à répondre, par définition).
export async function traiterMessage(msg, contexte){
  if(!msg || msg.jsonrpc !== '2.0') return error((msg && msg.id) || null, -32600, 'message JSON-RPC 2.0 attendu');
  // Une notification n'a pas d'id et n'attend RIEN en retour : répondre à
  // `notifications/initialized` est une faute de protocole, pas une politesse.
  const estNotification = (msg.id === undefined || msg.id === null);

  if(msg.method === 'initialize'){
    const demandee = msg.params && msg.params.protocolVersion;
    return reponse(msg.id, {
      protocolVersion: VERSIONS_CONNUES.indexOf(demandee) !== -1 ? demandee : VERSION_PROTOCOLE,
      capabilities: {tools: {listChanged: false}},
      serverInfo: INFOS_SERVEUR,
      instructions: mcpInstructions()
    });
  }

  if(estNotification) return null;              // initialized, cancelled, progress…
  if(msg.method === 'ping') return reponse(msg.id, {});

  if(msg.method === 'tools/list'){
    // Le catalogue vient de l'éditeur CONNECTÉ, pas d'une copie figée dans ce fichier. Quand
    // aucun éditeur n'est là, on rend une liste empty plutôt qu'une liste inventée : un agent
    // qui voit zéro outil pose la question, un agent qui voit vingt outils morts en appelle un.
    return reponse(msg.id, {tools: contexte.catalogue().map(outilVersMcp)});
  }

  if(msg.method === 'tools/call'){
    const name = msg.params && msg.params.name;
    if(!name) return error(msg.id, -32602, 'tools/call attend un field `name`');
    if(!contexte.editeurConnecte()){
      // Erreur d'OUTIL et non error de protocole : le modèle doit pouvoir la lire et réagir
      // (« ouvre l'éditeur »), pas voir sa connexion tomber.
      return reponse(msg.id, {
        content: [{type: 'text', text: 'Aucun éditeur connecté. Ouvrez moteur/editor.html et '
          + 'activez le plugin « pont MCP » (Fichier → Plugins), puis réessayez.'}],
        isError: true
      });
    }
    try {
      const raw = await contexte.appeler(name, msg.params.arguments || {});
      return reponse(msg.id, {content: contenuMcp(raw)});
    } catch(e){
      return reponse(msg.id, {content: [{type: 'text', text: String(e && e.message || e)}],
                              isError: true});
    }
  }

  return error(msg.id, -32601, 'méthode inconnue : ' + msg.method);
}
