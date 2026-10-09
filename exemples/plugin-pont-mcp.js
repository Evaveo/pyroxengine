// Plugin : pont MCP — laisse un agent externe piloter cet éditeur.
//
// À installer depuis Fichier → Plugins → « ＋ Installer un .js… ». Il ajoute
// « 🔌 Pont MCP… » au menu Extensions.
//
// POURQUOI UN PLUGIN, et pas un fichier de plus dans editor.html : le pont n'a rien à faire
// dans un éditeur qu'on ouvre pour dessiner un niveau. Le livrer par le système de plugins le
// rend optionnel par construction, ne demande AUCUNE modification de editor.html, et se
// désinstalle en une case à cocher.
//
// CE QU'IL FAIT. L'éditeur ne peut pas écouter un port : c'est donc LUI qui appelle le pont
// (moteur/mcp/serveur-mcp.mjs, à lancer à côté). Il publie le catalogue de commandes du
// copilot, puis loop sur un appel long : il demande du travail, exécute, renvoie.
//
// CE QU'IL EXPOSE. Exactement `Editor.api.copilotTools()`, c'est-à-dire COMMANDS (js/copilot.js) —
// les mêmes outils que le copilot intégré, ni plus ni moins. Chaque appel pass par
// `copRun`, donc par `pushHistory()` : tout ce qu'un agent externe fait ici reste
// annulable au Ctrl+Z, comme s'il l'avait fait dans la fenêtre de chat.
//
// ⚠ Tant que le pont tourne, un processus de la machine agit sur le project open. Le jeton
// affiché par le serveur au démarrage est ce qui empêche n'importe quelle page ouverte dans
// ce navigateur d'en faire autant.

(function(){
  const CLE_JETON = 'mcp-pont-jeton';
  const CLE_PORT = 'mcp-pont-port';
  const CLE_SESSION = 'mcp-pont-session';

  const state = {
    active: false,
    // La session SURVIT au rechargement de la page, au même title que le port et le jeton.
    //
    // Tirée en mémoire, elle changeait à chaque F5. Le serveur, lui, considère l'éditeur
    // connecté pendant un certain temps encore : il voyait donc arriver une session inconnue
    // et refusait la reconnexion avec « un autre éditeur est déjà connecté à ce pont », alors
    // qu'il s'agissait du même tab. Il fallait attendre l'expiration, sans rien qui
    // l'explique — le message accusait un second éditeur qui n'existait pas.
    session: localStorage.getItem(CLE_SESSION) || null,
    // Une seule loop à la fois : deux boucles se voleraient les tâches, et chacune ne
    // verrait que la moitié du travail — sans error, juste des commandes qui « n'arrivent
    // jamais ».
    boucleEnCours: false,
    faits: 0,
    last: null
  };

  function base(){
    return 'http://127.0.0.1:' + (localStorage.getItem(CLE_PORT) || '8765');
  }
  function jeton(){ return localStorage.getItem(CLE_JETON) || ''; }

  function appelPont(filePath, options){
    const o = options || {};
    return fetch(base() + filePath, {
      method: o.method || 'GET',
      // La session accompagne CHAQUE appel : le serveur la vérifie aussi sur /taches et
      // /resultat, pour qu'un tab resté open ne puisse pas voler le travail de l'autre.
      headers: Object.assign({'X-Jeton': jeton()},
                             state.session ? {'X-Session': state.session} : {},
                             o.body ? {'Content-Type': 'application/json'} : {}),
      body: o.body ? JSON.stringify(o.body) : undefined
    }).then(function(r){
      if(!r.ok) return r.json().catch(function(){ return {}; }).then(function(j){
        throw new Error('pont ' + r.status + ' : ' + (j.error || 'error'));
      });
      return r.json();
    });
  }

  function connecter(){
    if(!state.session){
      state.session = String(Date.now()) + '-' + Math.random().toString(36).slice(2);
      localStorage.setItem(CLE_SESSION, state.session);
    }
    return appelPont('/catalogue', {
      method: 'POST',
      body: {session: state.session, tools: Editor.api.copilotTools()}
    });
  }

  // Exécute une tâche et rend TOUJOURS un résultat, succès ou échec. Un throw non rattrapé
  // ici laisserait le serveur attendre son délai complet pour rien, et l'agent croirait
  // l'éditeur planté alors que la commande a seulement été refusée.
  function executerTache(t){
    // `copilotRun` est asynchrone : `String()` sur sa promesse renvoyait « [object Promise] ».
    return Promise.resolve().then(function(){ return Editor.api.copilotRun(t.name, t.args); })
      .then(function(value){
        state.faits++;
        state.last = t.name;
        return {id: t.id, ok: true, value: String(value)};
      }, function(e){
        state.last = t.name + ' (échec)';
        return {id: t.id, ok: false, error: String(e && e.message || e)};
      })
      .then(function(resultat){
        Editor.api.setStatus('MCP → ' + t.name, 1500);
        return appelPont('/resultat', {method: 'POST', body: resultat});
      });
  }

  function boucler(){
    if(!state.active){ state.boucleEnCours = false; return; }
    state.boucleEnCours = true;
    appelPont('/taches')
      .then(function(r){
        // Séquentiel et non en parallèle : deux commandes qui muteraient la scène en même
        // temps entrelaceraient leurs entrées d'historique.
        return (r.taches || []).reduce(function(chaine, t){
          return chaine.then(function(){ return executerTache(t); });
        }, Promise.resolve());
      })
      .then(function(){ boucler(); })
      .catch(function(e){
        if(!state.active){ state.boucleEnCours = false; return; }
        // Serveur arrêté ou redémarré (jeton périmé) : on ralentit au lieu de marteler, et
        // on le dit une fois — une loop muette qui échoue est indistinguable d'une loop
        // qui attend.
        Editor.api.journal('warn', 'Pont MCP : ' + e.message + ' — nouvel essai dans 5 s');
        setTimeout(boucler, 5000);
      });
  }

  function start(){
    if(!jeton()){ ouvrirReglages(); return; }
    connecter().then(function(){
      state.active = true;
      Editor.api.setStatus('Pont MCP connecté — ' + Editor.api.copilotTools().length + ' commandes exposées', 3000);
      Editor.api.journal('log', 'Pont MCP : connecté à ' + base());
      if(!state.boucleEnCours) boucler();
      ouvrirReglages();
    }).catch(function(e){
      Editor.api.journal('error', 'Pont MCP : connexion impossible — ' + e.message);
      Editor.api.setStatus('Pont MCP : ' + e.message, 5000);
      ouvrirReglages();
    });
  }

  function stop(){
    state.active = false;
    Editor.api.setStatus('Pont MCP arrêté', 2000);
    ouvrirReglages();
  }

  function ouvrirReglages(){
    const e = Editor.api.escapeHtml;
    Editor.api.openModal('Pont MCP',
      '<p style="margin-bottom:8px;line-height:1.5">Expose les <b>' + Editor.api.copilotTools().length
      + ' commandes</b> du copilot à un agent externe (Claude Code, Claude Desktop…) par '
      + '<b>Model Context Protocol</b>. Lancez d\'abord le serveur :<br>'
      + '<code>node moteur/mcp/serveur-mcp.mjs</code><br>'
      + 'puis collez ici le jeton qu\'il shown au démarrage.</p>'
      + '<div class="field"><label>Port</label><input id="mcp-port" type="text" value="'
      + e(localStorage.getItem(CLE_PORT) || '8765') + '"></div>'
      + '<div class="field"><label>Jeton</label><input id="mcp-jeton" type="text" value="'
      + e(jeton()) + '" placeholder="collez le jeton du serveur"></div>'
      + '<p style="margin:8px 0;line-height:1.5">État : <b>'
      + (state.active ? 'connecté' : 'arrêté') + '</b>'
      + (state.faits ? ' · ' + state.faits + ' commande(s) exécutée(s)' : '')
      + (state.last ? ' · dernière : ' + e(state.last) : '') + '</p>'
      + '<p style="margin:8px 0;line-height:1.5;color:var(--txt-dim);font-size:11.5px">'
      + '⚠ Tant que le pont est connecté, un processus de cette machine peut modifier le '
      + 'project open. Tout passe par l\'historique : Ctrl+Z annule.</p>'
      + '<div style="display:flex;gap:8px;margin-top:12px;justify-content:space-between">'
      + '<span><button class="btn-modal accent" id="mcp-go">'
      + (state.active ? 'Reconnecter' : 'Connecter') + '</button> '
      + '<button class="btn-modal" id="mcp-stop">Arrêter</button></span>'
      + '<button class="btn-modal" id="mcp-fermer">Fermer</button></div>');

    document.getElementById('mcp-go').addEventListener('click', function(){
      localStorage.setItem(CLE_PORT, document.getElementById('mcp-port').value.trim() || '8765');
      localStorage.setItem(CLE_JETON, document.getElementById('mcp-jeton').value.trim());
      start();
    });
    document.getElementById('mcp-stop').addEventListener('click', stop);
    document.getElementById('mcp-fermer').addEventListener('click', Editor.api.closeModal);
  }

  Editor.registerCommandMenu({
    menu: 'Extensions', caption: '🔌 Pont MCP…', action: ouvrirReglages
  });
})();
