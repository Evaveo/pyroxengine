// ---------- Copilote : ce que coûte une conversation, et comment le réduire ----------
//
// PUR : ni DOM, ni fetch, ni THREE. Quatre leviers de coût, chacun testable sans réseau :
//
//   1. le prix (table unique, à tenir à jour) et le calcul d'un tour à partir de `usage` ;
//   2. le chargement des outils À LA DEMANDE : un noyau toujours envoyé, le reste par domaine ;
//   3. le compactage de l'historique : les vieux résultats d'outils résumés, par paquets
//      (pour que le préfixe mis en cache reste stable entre deux compactages) ;
//   4. l'estimation grossière de la taille d'une conversation (pour déclencher 3).

// PRIX EN DOLLARS PAR MILLION DE JETONS — À METTRE À JOUR quand Anthropic change ses tarifs
// (relevé du 2026-09-25). Écriture de cache 5 min = 1,25 × l'entrée ; lecture = 0,1 × l'entrée.
export const COPILOT_PRICES = {
  'claude-opus-5':    {input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5},
  'claude-sonnet-5':  {input: 2, output: 10, cacheWrite: 2.5,  cacheRead: 0.2},
  'claude-haiku-4-5': {input: 1, output: 5,  cacheWrite: 1.25, cacheRead: 0.1}
};

/**
 * Coût d'un tour en dollars, à partir du `usage` rendu par l'API Anthropic (ou OpenAI, lu au
 * mieux). Modèle inconnu → `cost: null` : on préfère « prix inconnu » à un faux zéro.
 */
export function costOfUsage(usage, model){
  const u = usage || {};
  const tokens = {
    input: u.input_tokens || u.prompt_tokens || 0,
    cacheWrite: u.cache_creation_input_tokens || 0,
    cacheRead: u.cache_read_input_tokens || 0,
    output: u.output_tokens || u.completion_tokens || 0
  };
  const p = COPILOT_PRICES[model];
  const cost = p ? (tokens.input * p.input + tokens.cacheWrite * p.cacheWrite
    + tokens.cacheRead * p.cacheRead + tokens.output * p.output) / 1e6 : null;
  return {tokens: tokens, cost: cost};
}

/** « 0,0123 $ » — le coût, lisible en français. */
export function formatCost(cost){
  if(cost === null || cost === undefined) return 'prix inconnu';
  return cost.toFixed(cost < 0.1 ? 4 : 3).replace('.', ',') + ' $';
}

// ---------- Outils à la demande ----------
//
// Le NOYAU est envoyé à chaque requête. Les autres outils sont rangés par domaine et n'entrent
// dans le catalogue qu'après `load_tools({domains})`, pour le reste de la conversation.
// Un outil qui n'apparaît dans AUCUNE liste (plugin, ajout récent) est traité comme du noyau :
// un outil caché sans qu'on l'ait décidé serait un outil perdu.
export const CORE_TOOLS = [
  'list_scene', 'get_object', 'find_objects', 'get_hierarchy', 'read_script', 'read_console', 'script_api_reference',
  'create_object', 'delete_object', 'rename_object', 'transform', 'duplicate_object',
  'set_parent', 'configure_material', 'attach_script', 'replace_script', 'checkpoint',
  'batch', 'build_room', 'load_tools', 'analyze_scene', 'save_project', 'audit_project', 'move_asset'
];

export const TOOL_DOMAINS = {
  '2d': {label: 'sprites, planches, sprites isométriques cuits, salles de tuiles, physique et caméra 2D',
    tools: ['create_object_2d', 'configure_sprite', 'paint_room', 'read_room', 'configure_physics_2d',
      'configure_sprite_animation', 'slice_sheet', 'add_palette_tiles', 'configure_camera_2d', 'resize_tilemap', 'build_atlas', 'bake_iso_sprites']},
  audio: {label: 'sons, bruitages, boucles musicales, mixage, sources audio',
    tools: ['configure_audio', 'create_sound', 'play_sound', 'import_audio', 'configure_audio_mix', 'create_sfx', 'edit_sfx',
      'mutate_sfx', 'create_music_loop', 'edit_music_loop', 'read_sound_asset']},
  ui: {label: 'documents d\'interface, feuilles de style, entrées',
    tools: ['configure_ui_document', 'write_ui_document', 'write_ui_stylesheet', 'configure_inputs']},
  render: {label: 'matériaux PBR, lumières, environnement, post-traitement, sondes, lightmaps, caméra, textures, capture',
    tools: ['describe_material', 'configure_material_pbr', 'configure_environment', 'configure_post_volume',
      'configure_reflection_probe', 'bake_reflection_probes', 'bake_lightmaps', 'configure_camera',
      'configure_light', 'create_texture', 'import_image', 'link_sprite_texture', 'capture_view', 'configure_particles', 'create_material', 'configure_team_color']},
  animation: {label: 'animator et machine d\'états',
    tools: ['configure_animator', 'read_animator_machine', 'write_animator_machine', 'write_animation']},
  gameplay: {label: 'physique, jeu, réseau, calques, événements, lancer et mesurer le jeu, tables de données',
    tools: ['configure_physics', 'configure_game', 'configure_fog_of_war', 'manage_layers', 'add_event', 'remove_script', 'set_script_vars',
      'set_play_mode', 'play_and_measure', 'check', 'create_data', 'read_data', 'configure_network']},
  blender: {label: 'modéliser, texturer, rigger et animer dans Blender (addon EVAVEO Blender Bridge), puis importer le GLB',
    tools: ['blender_project', 'blender_geometry', 'blender_material', 'blender_uv', 'blender_rig', 'blender_animation',
      'blender_inspect', 'blender_import', 'blender_delivery', 'blender_scene', 'blender_preview', 'blender_import_to_project', 'blender_status']},
  terrain: {label: 'génération de terrain',
    tools: ['generate_terrain']},
  data: {label: 'assets (dont suppression), prefabs, modèles, scènes, sous-scènes, document de conception, retour arrière',
    tools: ['list_assets', 'manage_scenes', 'instantiate_subscene', 'create_prefab', 'instantiate_prefab',
      'instantiate_model', 'import_model', 'read_asset', 'write_script_asset', 'read_design', 'write_design', 'summarize_scene', 'go_back', 'delete_asset', 'validate_asset']}
};

/** Le domaine d'un outil, ou null s'il est du noyau (ou inconnu, donc traité comme tel). */
export function domainOfTool(name){
  for(const d of Object.keys(TOOL_DOMAINS)){
    if(TOOL_DOMAINS[d].tools.indexOf(name) !== -1) return d;
  }
  return null;
}

/**
 * Les commandes à envoyer au modèle : le noyau, plus les domaines chargés. L'ORDRE du
 * catalogue d'origine est conservé — c'est ce qui garde le préfixe de cache identique d'une
 * requête à l'autre tant qu'aucun domaine n'est ajouté.
 */
export function selectTools(commands, loadedDomains){
  const loaded = loadedDomains || [];
  return commands.filter(function(c){
    const d = domainOfTool(c.name);
    return d === null || loaded.indexOf(d) !== -1;
  });
}

/** Une ligne par domaine, pour l'invite système. */
export function describeDomains(){
  return Object.keys(TOOL_DOMAINS).map(function(d){
    return '- ' + d + ' : ' + TOOL_DOMAINS[d].label;
  }).join('\n');
}

// ---------- Compactage de l'historique ----------

/** Taille approximative en jetons (4 caractères ≈ 1 jeton ; une image compte ~1500). */
export function estimateTokens(messages){
  let images = 0;
  const s = JSON.stringify(messages || [], function(k, v){
    if(v && typeof v === 'object' && v.type === 'image'){ images++; return undefined; }
    return v;
  });
  return Math.ceil(s.length / 4) + images * 1500;
}

export const SUMMARY_MARK = '…[résumé]';

/** Un contenu de résultat d'outil, résumé : 200 premiers caractères + la marque. */
function summarizeContent(content){
  let text;
  if(typeof content === 'string') text = content;
  else if(Array.isArray(content)){
    text = content.map(function(b){
      if(b.type === 'text') return b.text;
      if(b.type === 'image') return '[image retirée]';
      return '';
    }).join(' ');
  } else text = String(content === undefined ? '' : content);
  if(text.endsWith(SUMMARY_MARK)) return text;           // déjà résumé : stable
  if(text.length <= 260 && typeof content === 'string') return content;
  return text.slice(0, 200) + SUMMARY_MARK;
}

/**
 * Résume les résultats d'outils anciens. On ne retire AUCUN message et aucun bloc : seul le
 * CONTENU d'un `tool_result` (Anthropic) ou d'un message `tool` (OpenAI) change, donc les paires
 * appel/résultat restent valides.
 *
 * DÉTERMINISTE ET PAR PAQUETS : rien ne se passe tant que la conversation reste sous
 * `thresholdTokens`. Quand elle le dépasse, tout ce qui précède les `keepMessages` derniers
 * messages est résumé d'un coup. Le préfixe ainsi réécrit reste ensuite identique jusqu'au
 * prochain dépassement — le cache n'est invalidé qu'une fois par paquet, pas à chaque tour.
 *
 * Rend `{messages, compacted}` ; `messages` est une copie, l'entrée n'est pas modifiée.
 */
export function compactHistory(messages, opts){
  const o = opts || {};
  const threshold = o.thresholdTokens || 40000;
  const keep = o.keepMessages === undefined ? 6 : o.keepMessages;
  const conv = messages || [];
  if(estimateTokens(conv) <= threshold) return {messages: conv, compacted: 0};
  const limit = Math.max(0, conv.length - keep);
  let compacted = 0;
  const out = conv.map(function(m, i){
    if(i >= limit) return m;
    if(m.role === 'tool'){                                 // forme OpenAI
      const c = summarizeContent(m.content);
      if(c === m.content) return m;
      compacted++;
      return Object.assign({}, m, {content: c});
    }
    if(m.role === 'user' && Array.isArray(m.content)){
      let touched = false;
      const content = m.content.map(function(b){
        if(b.type !== 'tool_result') return b;
        const c = summarizeContent(b.content);
        if(c === b.content) return b;
        touched = true; compacted++;
        return Object.assign({}, b, {content: c});
      });
      return touched ? Object.assign({}, m, {content: content}) : m;
    }
    return m;
  });
  return {messages: out, compacted: compacted};
}
