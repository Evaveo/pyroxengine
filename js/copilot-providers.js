// ---------- Parler à n'importe quel modèle ----------
//
// Le copilote était soudé à une seule API : endpoint en dur, en-têtes en dur, et la forme des messages
// d'Anthropic répandue dans la boucle d'agent. Or le catalogue d'outils, lui, n'a rien de propre à un
// fournisseur — ce sont les commandes de l'éditeur.
//
// Ce fichier isole les QUATRE choses qui diffèrent réellement d'un fournisseur à l'autre :
//
//   1. où envoyer, et avec quels en-têtes ;
//   2. comment déclarer les outils (`input_schema` chez l'un, `function.parameters` chez l'autre) ;
//   3. comment lire la réponse (`content[].tool_use` contre `choices[0].message.tool_calls`) ;
//   4. comment renvoyer les résultats (un message `user` de `tool_result` contre un message `tool`
//      par appel).
//
// Le point n° 4 est celui qui se recopie mal : Anthropic groupe tous les résultats dans UN message,
// OpenAI en veut UN PAR APPEL, chacun portant son `tool_call_id`. Grouper là où il faut séparer donne
// une conversation que l'API refuse, et le message d'erreur parle de `tool_call_id` sans dire lequel.
//
// PUR : ni DOM, ni fetch. Ce fichier construit et lit des objets ; c'est ce qui permet de vérifier la
// traduction dans les deux sens sans une seule requête réseau.

export const PROVIDERS = {
  anthropic: {
    name: 'Anthropic (Claude)',
    // Sonnet D'ABORD : c'est le modèle par défaut (models[0]). Opus reste au choix dans ⚙.
    models: ['claude-sonnet-5', 'claude-opus-5', 'claude-haiku-4-5'],
    url: 'https://api.anthropic.com/v1/messages',
    helpKey: 'Créez une clé sur console.anthropic.com.',
    headers: function(key){
      return {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        // Une page web appelant l'API directement : sans cet en-tête la requête est refusée. C'est
        // acceptable en local et ça ne l'est pas sur un éditeur servi à d'autres — la clé serait dans
        // le navigateur de chacun.
        'anthropic-dangerous-direct-browser-access': 'true'
      };
    },
    tools: function(commands){
      return commands.map(function(c){
        return {name: c.name, description: c.description, input_schema: c.schema};
      });
    },
    body: function(o){
      if(o.cache === false){
        return {model: o.model, max_tokens: o.maxTokens, system: o.system,
                tools: this.tools(o.commands), messages: o.messages};
      }
      // MISE EN CACHE DU PRÉFIXE. Trois points de rupture sur les quatre permis : le dernier outil
      // (tout le catalogue), le bloc système, et le dernier bloc du dernier message (roulant : le
      // tour suivant relit tout ce qui précède à 0,1 × le prix). Ordre de rendu de l'API :
      // outils → système → messages. On ne touche PAS la conversation d'origine : seul le dernier
      // message est recopié pour porter sa marque.
      const EPH = {type: 'ephemeral'};
      const tools = this.tools(o.commands);
      if(tools.length) tools[tools.length - 1] = Object.assign({}, tools[tools.length - 1], {cache_control: EPH});
      const system = [{type: 'text', text: String(o.system || ''), cache_control: EPH}];
      const messages = (o.messages || []).slice();
      const i = messages.length - 1;
      if(i >= 0){
        const m = messages[i];
        let content = (typeof m.content === 'string')
          ? [{type: 'text', text: m.content}] : (Array.isArray(m.content) ? m.content.slice() : m.content);
        if(Array.isArray(content) && content.length){
          const j = content.length - 1;
          content[j] = Object.assign({}, content[j], {cache_control: EPH});
          messages[i] = Object.assign({}, m, {content: content});
        }
      }
      return {model: o.model, max_tokens: o.maxTokens, system: system, tools: tools, messages: messages};
    },
    /** Rend `{texte, appels: [{id, name, args}], fini}`. */
    read: function(rep){
      const blocks = (rep && rep.content) || [];
      const text = blocks.filter(function(b){ return b.type === 'text'; })
                         .map(function(b){ return b.text; }).join('\n');
      const appels = blocks.filter(function(b){ return b.type === 'tool_use'; })
                          .map(function(b){ return {id: b.id, name: b.name, args: b.input || {}}; });
      return {text: text, appels: appels, fini: rep && rep.stop_reason !== 'tool_use',
              refusal: rep && rep.stop_reason === 'refusal'};
    },
    /** Le message de l'assistant à réinjecter tel quel dans la conversation. */
    messageAssistant: function(rep){ return {role: 'assistant', content: rep.content}; },
    /**
     * Les résultats d'outils, en messages. Anthropic : UN SEUL message `user` qui les porte tous.
     */
    messagesResultats: function(resultats){
      return [{role: 'user', content: resultats.map(function(r){
        return {type: 'tool_result', tool_use_id: r.id, content: r.content, is_error: !!r.error};
      })}];
    },
    /** Le contenu d'un résultat qui porte une image, dans la forme du fournisseur. */
    contentWithImage: function(text, base64){
      const blocks = [];
      if(text) blocks.push({type: 'text', text: String(text)});
      blocks.push({type: 'image', source: {type: 'base64', media_type: 'image/png', data: base64}});
      return blocks;
    }
  },

  openai: {
    name: 'OpenAI (ChatGPT) et compatibles',
    models: ['gpt-6-astra', 'gpt-5.6','gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.5-pro', 'gpt-5', 'gpt-5-mini', 'gpt-4.1'],
    url: 'https://api.openai.com/v1/chat/completions',
    helpKey: 'Créez une clé sur platform.openai.com. Tout service « compatible OpenAI » '
      + '(Groq, Mistral, un serveur local…) fonctionne en changeant l\'adresse.',
    headers: function(key){
      return {'content-type': 'application/json', 'authorization': 'Bearer ' + key};
    },
    tools: function(commands){
      return commands.map(function(c){
        return {type: 'function', function: {name: c.name, description: c.description,
                                             parameters: c.schema}};
      });
    },
    body: function(o){
      // Le message système est un MESSAGE, pas un champ à part : le mettre dans `system` le ferait
      // ignorer en silence, et le modèle travaillerait sans aucune de ses règles.
      const messages = [{role: 'system', content: o.system}].concat(o.messages);
      const body = {model: o.model, max_completion_tokens: o.maxTokens,
                    tools: this.tools(o.commands), messages: messages};
      // gpt-5.6 et gpt-6 raisonnent par défaut, et refusent (erreur 400) les outils de fonction sur
      // /v1/chat/completions tant que le raisonnement est actif : il faut le couper explicitement.
      if(/^gpt-(5\.6|6)/.test(String(o.model || ''))) body.reasoning_effort = 'none';
      return body;
    },
    read: function(rep){
      const m = (rep && rep.choices && rep.choices[0] && rep.choices[0].message) || {};
      const appels = (m.tool_calls || []).map(function(t){
        let args = {};
        // Les arguments arrivent en CHAÎNE JSON, pas en objet. Un JSON tronqué — réponse coupée par la
        // limite de jetons — ferait tomber tout le tour ; on préfère un appel vide et un message
        // lisible à une exception au milieu d'une séquence.
        try{ args = JSON.parse((t.function && t.function.arguments) || '{}'); }
        catch(e){ args = {__errorArguments: String((t.function && t.function.arguments) || '')}; }
        return {id: t.id, name: t.function && t.function.name, args: args};
      });
      const fini = (rep && rep.choices && rep.choices[0] && rep.choices[0].finish_reason) !== 'tool_calls';
      return {text: m.content || '', appels: appels, fini: appels.length ? false : fini,
              refusal: (rep && rep.choices && rep.choices[0] && rep.choices[0].finish_reason) === 'content_filter'};
    },
    messageAssistant: function(rep){
      const m = (rep && rep.choices && rep.choices[0] && rep.choices[0].message) || {};
      // On renvoie le message TEL QUEL, `tool_calls` compris : sans eux, l'API ne sait pas à quoi
      // répondent les messages `tool` qui suivent, et rejette la conversation.
      return {role: 'assistant', content: m.content || null, tool_calls: m.tool_calls || undefined};
    },
    /**
     * UN MESSAGE PAR APPEL, chacun avec son `tool_call_id`. C'est LA différence qui se recopie mal :
     * grouper les résultats comme le fait Anthropic donne une conversation que l'API refuse, avec un
     * message d'erreur qui parle de `tool_call_id` sans dire lequel manque.
     */
    messagesResultats: function(resultats){
      return resultats.map(function(r){
        return {role: 'tool', tool_call_id: r.id,
                content: (typeof r.content === 'string') ? r.content : JSON.stringify(r.content)};
      });
    },
    contentWithImage: function(text, base64){
      // Un message `tool` d'OpenAI ne porte pas d'image. On rend donc le texte seul, et on le DIT :
      // taire la perte laisserait croire au modèle qu'il a regardé quelque chose.
      return (text ? text + '\n' : '')
        + '(image non transmise : ce fournisseur n\'accepte pas d\'image dans un résultat d\'outil. '
        + 'Utilisez `check` pour obtenir les mesures à la place.)';
    }
  }
};

/** Le fournisseur d'un identifiant, ou celui par défaut. */
export function providerBy(id){
  return PROVIDERS[id] || PROVIDERS.anthropic;
}

/** Le fournisseur qui propose ce modèle — pour ne pas envoyer un modèle Claude à OpenAI. */
export function providerOfModel(model){
  const ids = Object.keys(PROVIDERS);
  for(let i = 0; i < ids.length; i++){
    if(PROVIDERS[ids[i]].models.indexOf(model) !== -1) return ids[i];
  }
  return null;
}

/** Les problèmes d'un réglage de copilote, en clair. */
export function validateProvider(id, model, key){
  const p = [];
  if(!PROVIDERS[id]) p.push('Fournisseur inconnu : « ' + id + ' ».');
  if(!key) p.push('Aucune clé d\'API : le copilote ne peut pas appeler le modèle.');
  const f = PROVIDERS[id];
  if(f && model && f.models.indexOf(model) === -1){
    // AVERTISSEMENT et non refus : un fournisseur compatible OpenAI propose ses propres noms de
    // modèle, et refuser interdirait tout serveur local. Mais un modèle Claude envoyé à OpenAI est
    // une erreur qui vaut la peine d'être dite avant la requête.
    const autre = providerOfModel(model);
    p.push(autre
      ? 'Le modèle « ' + model + ' » appartient à ' + PROVIDERS[autre].name + ', pas à ' + f.name + '.'
      : 'Le modèle « ' + model + ' » n\'est pas dans la liste connue de ' + f.name
        + ' — correct si votre service en propose d\'autres.');
  }
  return p;
}
