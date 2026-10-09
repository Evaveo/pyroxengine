// moteur/mcp/serveur-mcp.mjs
// Serveur Model Context Protocol qui expose les commandes de l'éditeur (COMMANDS,
// js/copilot.js) à un agent externe — Claude Code, Claude Desktop, tout client MCP.
//
// ---------------------------------------------------------------------------------------
// LE PROBLÈME, ET CE QUE CE CHOIX SUPPOSE
//
// COMMANDS vit dans le NAVIGATEUR : chaque commande manipule `scene`, `objects`, `project`,
// pousse dans l'historique et redessine l'inspecteur. Rien de tout cela n'existe dans un
// processus node. Un serveur MCP, lui, EST un processus. Il n'y a donc pas de version
// « sans navigateur » de ces outils à écrire : il n'y a qu'un pont à construire.
//
// Ce fichier est un serveur à DEUX faces :
//   • face agent    — MCP en JSON-RPC sur stdio (le transport que lancent les clients MCP) ;
//   • face éditeur  — un petit serveur HTTP sur 127.0.0.1 que la page de l'éditeur interroge.
//
// L'éditeur est CLIENT du pont, jamais serveur : une page web ne peut pas écouter un port.
// Il récupère ses tâches par appel long (long-poll) et renvoie les résultats. C'est plus
// lent qu'un WebSocket de quelques millisecondes, et ça évite d'implémenter le tramage
// RFC 6455 à la main — ce dépôt n'a aucune dépendance npm et ne doit pas en gagner une.
//
// CE QUE ÇA SUPPOSE, EXPLICITEMENT :
//   1. L'ÉDITEUR DOIT ÊTRE OUVERT, sur un project chargé. Sans page ouverte, `tools/list`
//      rend une liste empty et `tools/call` répond une error d'outil lisible. Il n'y a pas
//      de mode « piloter l'éditeur sans l'éditeur ».
//   2. UN PLUGIN doit être installé dans cette page : exemples/plugin-pont-mcp.js, via
//      Fichier → Plugins. Aucune modification de editor.html n'est nécessaire — c'est
//      justement ce que permet le système de plugins.
//   3. TOUT EST LOCAL. On écoute sur 127.0.0.1 uniquement, et un jeton partagé, tiré au
//      hasard à chaque démarrage, est exigé sur chaque requête. Sans lui, n'importe quelle
//      page ouverte dans le même navigateur pourrait piloter l'éditeur, puisque le pont
//      doit autoriser les requêtes d'origine croisée pour être joignable depuis file://.
//   4. UN SEUL ÉDITEUR à la fois. Deux onglets se voleraient les tâches ; le second est
//      refusé plutôt que servi à moitié.
//
// LANCEMENT
//   node moteur/mcp/serveur-mcp.mjs                (stdio MCP + pont sur le port 8765)
//   PORT_PONT=9000 node moteur/mcp/serveur-mcp.mjs
//
// Déclaration côté client MCP (.mcp.json) :
//   { "mcpServers": { "editeur3d": { "command": "node",
//     "args": ["moteur/mcp/serveur-mcp.mjs"] } } }
//
// Le jeton est écrit sur STDERR au démarrage (jamais sur stdout, qui porte le JSON-RPC).
// ---------------------------------------------------------------------------------------
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { traiterMessage } from './protocole-mcp.mjs';

const PORT_PONT = parseInt(process.env.PORT_PONT || '8765', 10);
const JETON = process.env.JETON_PONT || randomUUID();
const DELAI_APPEL_LONG = 25000;      // sous la minute des mandataires, au-dessus du bruit réseau
const DELAI_COMMANDE = 30000;        // au-delà, l'éditeur est considéré parti en cours de route

// ---------- état du pont ----------
const pont = {
  catalogue: [],            // dernier catalogue annoncé par l'éditeur
  connecteA: 0,             // horodatage du dernier signe de vie
  file: [],                 // tâches pas encore récupérées par l'éditeur
  enVol: new Map(),         // id -> {resoudre, rejeter, minuterie}
  attenteEditeur: null      // réponse HTTP en pending longue, à réveiller dès qu'une tâche arrive
};

// L'éditeur est considéré présent s'il a donné signe de vie récemment. On ne se fie pas à une
// socket ouverte : avec des appels longs, « connecté » n'est qu'une fenêtre de temps.
function editeurConnecte(){
  return pont.catalogue.length > 0 && (Date.now() - pont.connecteA) < DELAI_APPEL_LONG * 2;
}

function appeler(name, args){
  return new Promise((resolve, rejeter) => {
    const id = randomUUID();
    const minuterie = setTimeout(() => {
      pont.enVol.delete(id);
      rejeter(new Error('l\'éditeur n\'a pas répondu en ' + (DELAI_COMMANDE / 1000)
        + ' s (page fermée, ou commande bloquée sur une boîte de dialogue ?)'));
    }, DELAI_COMMANDE);
    pont.enVol.set(id, {resolve, rejeter, minuterie});
    pont.file.push({id, name, args});
    reveillerEditeur();
  });
}

// Une tâche vient d'arriver : si l'éditeur est en appel long, on lui répond tout de sequence au
// lieu d'attendre l'expiration du délai.
function reveillerEditeur(){
  if(!pont.attenteEditeur || !pont.file.length) return;
  const {reponse, minuterie} = pont.attenteEditeur;
  clearTimeout(minuterie);
  pont.attenteEditeur = null;
  envoyerJson(reponse, 200, {taches: pont.file.splice(0, pont.file.length)});
}

const contexteMcp = {
  catalogue: () => (editeurConnecte() ? pont.catalogue : []),
  appeler,
  editeurConnecte
};

// ---------- face agent : JSON-RPC sur stdio ----------
// Le transport stdio de MCP, ce sont des messages JSON séparés par des sauts de ligne. On
// tamponne : rien ne garantit qu'une playback de stdin contienne un message entier, ni un
// seul.
let tampon = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (bout) => {
  tampon += bout;
  let jump;
  while((jump = tampon.indexOf('\n')) !== -1){
    const ligne = tampon.slice(0, jump).trim();
    tampon = tampon.slice(jump + 1);
    if(ligne) traiterLigne(ligne);
  }
});

async function traiterLigne(ligne){
  let msg;
  try { msg = JSON.parse(ligne); }
  catch(e){
    ecrireStdout({jsonrpc: '2.0', id: null, error: {code: -32700, message: 'JSON invalide'}});
    return;
  }
  try {
    const rep = await traiterMessage(msg, contexteMcp);
    if(rep) ecrireStdout(rep);
  } catch(e){
    // Une exception ici tuerait la session entière pour un seul message : on la renvoie
    // comme error JSON-RPC et on continue de servir.
    ecrireStdout({jsonrpc: '2.0', id: (msg && msg.id) || null,
                  error: {code: -32603, message: String(e && e.message || e)}});
  }
}

function ecrireStdout(object){ process.stdout.write(JSON.stringify(object) + '\n'); }
function tracer(msg){ process.stderr.write(msg + '\n'); }

// ---------- face éditeur : HTTP local ----------
function envoyerJson(reponse, code, body){
  const text = JSON.stringify(body);
  reponse.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    // La page peut être servie depuis file:// (origine « null ») ou depuis un petit serveur
    // statique : on ne peut pas restreindre par origine. C'est le JETON qui protège, pas
    // l'origine — et l'écoute est limitée à la loop locale.
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Jeton',
    'Content-Length': Buffer.byteLength(text)
  });
  reponse.end(text);
}

function lireCorps(requete){
  return new Promise((resolve) => {
    let d = '';
    requete.on('data', (b) => { d += b; });
    requete.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch(e){ resolve(null); } });
  });
}

const serveurPont = http.createServer(async (requete, reponse) => {
  if(requete.method === 'OPTIONS'){ envoyerJson(reponse, 204, {}); return; }

  const url = new URL(requete.url, 'http://127.0.0.1');
  const jeton = requete.headers['x-jeton'] || url.searchParams.get('jeton');
  if(jeton !== JETON){ envoyerJson(reponse, 403, {error: 'jeton invalide'}); return; }

  // L'éditeur s'annonce et publie son catalogue. C'est LUI la source de vérité : le
  // catalogue inclut donc les commandes ajoutées par d'autres plugins, sans que ce serveur
  // ait à connaître leur existence.
  if(url.pathname === '/catalogue' && requete.method === 'POST'){
    const body = await lireCorps(requete);
    if(!body || !Array.isArray(body.tools)){ envoyerJson(reponse, 400, {error: 'outils manquants'}); return; }
    if(editeurConnecte() && body.session !== pont.session){
      // Deux onglets se voleraient les tâches à tour de rôle, chacun croyant les avoir toutes.
      envoyerJson(reponse, 409, {error: 'un autre éditeur est déjà connecté à ce pont'});
      return;
    }
    pont.session = body.session || randomUUID();
    pont.catalogue = body.tools;
    pont.connecteA = Date.now();
    tracer('éditeur connecté — ' + body.tools.length + ' commandes publiées');
    envoyerJson(reponse, 200, {ok: true, session: pont.session});
    return;
  }

  // La session est vérifiée sur TOUS les points d'entrée qui touchent au travail en cours, pas
  // seulement sur /catalogue.
  //
  // Le jeton dit « ce client a le droit de parler à ce pont ». Il ne dit PAS « ce client est
  // l'éditeur connecté » — or les deux onglets d'un même utilisateur partagent le même jeton,
  // puisqu'il vient du même localStorage. Sans ce contrôle, /catalogue refusait bien le second
  // tab, mais celui-ci pouvait quand même appeler /taches : il volait des tâches à l'tab
  // légitime, une sur deux, et renvoyait des résultats pour des tâches qui n'étaient pas les
  // siennes. Le contrôle sur /catalogue seul protégeait la porte d'entrée en laissant la
  // fenêtre ouverte.
  function sessionValide(){
    const s = requete.headers['x-session'] || url.searchParams.get('session');
    return !pont.session || s === pont.session;
  }

  // Appel long : l'éditeur demande du travail et attend qu'il en arrive.
  if(url.pathname === '/taches' && requete.method === 'GET'){
    if(!sessionValide()){ envoyerJson(reponse, 409, {error: 'session inconnue — reconnectez l\'éditeur'}); return; }
    pont.connecteA = Date.now();
    if(pont.file.length){
      envoyerJson(reponse, 200, {taches: pont.file.splice(0, pont.file.length)});
      return;
    }
    if(pont.attenteEditeur){        // un seul dormeur : le précédent est un tab abandonné
      clearTimeout(pont.attenteEditeur.minuterie);
      envoyerJson(pont.attenteEditeur.reponse, 200, {taches: []});
    }
    const minuterie = setTimeout(() => {
      pont.attenteEditeur = null;
      envoyerJson(reponse, 200, {taches: []});
    }, DELAI_APPEL_LONG);
    pont.attenteEditeur = {reponse, minuterie};
    return;
  }

  if(url.pathname === '/resultat' && requete.method === 'POST'){
    if(!sessionValide()){ envoyerJson(reponse, 409, {error: 'session inconnue — reconnectez l\'éditeur'}); return; }
    pont.connecteA = Date.now();
    const body = await lireCorps(requete);
    const attendu = body && pont.enVol.get(body.id);
    // Un résultat sans demande en vol = doublon ou tâche expirée : on l'accepte sans rien
    // faire plutôt que de renvoyer une error qui ferait boucler l'éditeur.
    if(!attendu){ envoyerJson(reponse, 200, {ok: true, ignore: true}); return; }
    clearTimeout(attendu.minuterie);
    pont.enVol.delete(body.id);
    if(body.ok) attendu.resolve(body.value);
    else attendu.rejeter(new Error(body.error || 'échec de la commande'));
    envoyerJson(reponse, 200, {ok: true});
    return;
  }

  envoyerJson(reponse, 404, {error: 'route inconnue'});
});

serveurPont.listen(PORT_PONT, '127.0.0.1', () => {
  tracer('pont MCP sur http://127.0.0.1:' + PORT_PONT);
  tracer('jeton de session : ' + JETON);
  tracer('Dans l\'éditeur : Fichier → Plugins → installer exemples/plugin-pont-mcp.js, '
    + 'puis coller ce jeton quand il est demandé.');
});
