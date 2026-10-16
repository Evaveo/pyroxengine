// ---------- La recherche du panneau Projet, comme le Project Browser d'Unity ----------
//
// PUR, et sans aucun import : ni DOM, ni three, ni la liste `assets` elle-même. Le panneau
// (js/assets.js) lui passe ses assets et le texte du champ, il rend la liste à afficher. C'est
// ce qui permet de tester la syntaxe et le filtrage sans navigateur (test/recherche-assets).
//
// La syntaxe est celle d'Unity : du texte libre (tous les mots doivent figurer dans le NOM, sans
// tenir compte de la casse ni des accents) et des filtres de genre `t:Material`, `t:Texture`…
// Plusieurs `t:` s'additionnent (« t:Material t:Texture » montre les deux, comme dans Unity), et
// les noms français des genres sont acceptés aussi : `t:Matériau`, `t:son`, `t:modele`.
//
// Le bouton « genre » du panneau n'a pas d'état à lui : il écrit et retire des `t:` dans le
// champ (`toggleKindToken`), exactement comme le menu de types d'Unity. Le texte reste donc la
// seule vérité — deux réglages qui pourraient se contredire, c'est un de trop.

/**
 * Les GENRES proposés au filtre, dans l'ordre du menu. `kinds` : les genres d'asset du moteur
 * qu'ils couvrent (`asset.kind`). `aliases` : ce que `t:` accepte, comparé sans casse ni accents.
 * Le premier alias est le nom Unity, écrit par le menu.
 *
 * À RELIRE À CHAQUE NOUVEAU GENRE D'ASSET (voir docs/KNOWN_ISSUES.md, « Rack sonore : un
 * nouveau genre d'asset oublié par les listes à la main ») : un genre absent d'ici reste
 * trouvable par son nom, mais aucun `t:` ne le sélectionne.
 */
export const ASSET_SEARCH_KINDS = [
  {id: 'model', label: 'Modèle', kinds: ['model'],
   aliases: ['Model', 'Mesh', 'Modele', 'Fbx', 'Gltf']},
  {id: 'material', label: 'Matériau', kinds: ['material'],
   aliases: ['Material', 'Materiau', 'Mat']},
  {id: 'texture', label: 'Texture', kinds: ['texture'],
   aliases: ['Texture', 'Texture2D', 'Image']},
  {id: 'sprite', label: 'Sprite', kinds: ['sprite'],
   aliases: ['Sprite']},
  {id: 'prefab', label: 'Prefab', kinds: ['prefab'],
   aliases: ['Prefab', 'GameObject']},
  {id: 'script', label: 'Script', kinds: ['script'],
   aliases: ['Script', 'MonoScript', 'MonoBehaviour']},
  {id: 'audio', label: 'Son', kinds: ['audio', 'sfx', 'musicLoop'],
   aliases: ['AudioClip', 'Audio', 'Son', 'Sound', 'Sfx', 'Bruitage', 'Musique', 'Music']},
  {id: 'animation', label: 'Animation', kinds: ['animation'],
   aliases: ['AnimationClip', 'Animation', 'Anim', 'Clip']},
  {id: 'animator', label: 'Animator', kinds: ['animator'],
   aliases: ['AnimatorController', 'Animator']},
  {id: 'shader', label: 'Shader', kinds: ['graphShader'],
   aliases: ['Shader', 'ShaderGraph', 'GrapheShader', 'Graphe']},
  {id: 'data', label: 'Données', kinds: ['data'],
   aliases: ['Data', 'Donnees', 'Table', 'TextAsset', 'ScriptableObject']},
  {id: 'ui', label: 'Interface', kinds: ['documentUI', 'sheetStyle'],
   aliases: ['UI', 'Interface', 'VisualTreeAsset', 'Uxml', 'StyleSheet', 'Uss', 'DocumentUI',
             'FeuilleDeStyle', 'Css', 'Html']},
  {id: 'particles', label: 'Particules', kinds: ['particles'],
   aliases: ['ParticleSystem', 'Particles', 'Particules', 'VFX', 'Effet', 'Effets']},
  {id: 'postProfile', label: 'Post-traitement', kinds: ['postProfile'],
   aliases: ['VolumeProfile', 'PostProfile', 'PostProcess', 'PostTraitement', 'Profil']},
  {id: 'tilePalette', label: 'Palette de tuiles', kinds: ['tilePalette'],
   aliases: ['TilePalette', 'Palette', 'Tile', 'Tuile', 'Tuiles']},
  {id: 'preset', label: "Preset d'import", kinds: ['preset'],
   aliases: ['Preset']}
];

/** Minuscules, sans accents : « Matériau » et « materiau » se valent, comme on les tape. */
export function foldSearchText(s){
  return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/** Le genre du filtre désigné par un nom tapé après `t:`, ou `null`. */
export function searchKindByAlias(name){
  const n = foldSearchText(name);
  if(!n) return null;
  return ASSET_SEARCH_KINDS.find(function(k){
    return foldSearchText(k.id) === n || foldSearchText(k.label) === n
      || k.aliases.some(function(a){ return foldSearchText(a) === n; });
  }) || null;
}

/**
 * Le texte du champ → la requête.
 *
 * Rend `{words, kindIds, unknownTypes, empty}` : les mots libres (déjà repliés), les genres des
 * `t:` reconnus, les `t:` qu'on n'a pas su lire (affichés tels quels pour que l'utilisateur voie
 * sa faute de frappe au lieu d'une liste vide inexplicable), et `empty` quand il n'y a RIEN à
 * chercher — le panneau revient alors au dossier courant.
 */
export function parseAssetQuery(text){
  const words = [], kindIds = [], unknownTypes = [];
  String(text == null ? '' : text).split(/\s+/).forEach(function(tok){
    if(!tok) return;
    const m = /^t:(.*)$/i.exec(tok);
    if(m){
      if(!m[1]) return;   // « t: » tout seul, en cours de frappe : rien à filtrer encore
      const k = searchKindByAlias(m[1]);
      if(k){ if(kindIds.indexOf(k.id) === -1) kindIds.push(k.id); }
      else unknownTypes.push(m[1]);
      return;
    }
    words.push(foldSearchText(tok));
  });
  return {words: words, kindIds: kindIds, unknownTypes: unknownTypes,
          empty: !words.length && !kindIds.length && !unknownTypes.length};
}

/** Les genres d'asset (`asset.kind`) couverts par une liste d'ids de genre du filtre. */
export function kindsOfSearchIds(kindIds){
  const out = [];
  (kindIds || []).forEach(function(id){
    const k = ASSET_SEARCH_KINDS.find(function(x){ return x.id === id; });
    if(k) k.kinds.forEach(function(kind){ if(out.indexOf(kind) === -1) out.push(kind); });
  });
  return out;
}

/** Un asset répond-il à la requête ? Tous les mots dans le nom, ET un des genres demandés. */
export function assetMatchesQuery(asset, query){
  if(!asset || !query) return false;
  // Un `t:` illisible ne laisse rien passer : « t:Materail » qui montrerait TOUT serait pire
  // qu'une liste vide accompagnée du mot qui n'a pas été compris.
  if(query.unknownTypes && query.unknownTypes.length && !query.kindIds.length) return false;
  if(query.kindIds.length && kindsOfSearchIds(query.kindIds).indexOf(asset.kind) === -1) return false;
  const name = foldSearchText(asset.name);
  return query.words.every(function(w){ return name.indexOf(w) !== -1; });
}

/**
 * Les assets à montrer pour ce texte, TOUS DOSSIERS CONFONDUS, triés par nom puis par dossier.
 *
 * Les clips EMBARQUÉS d'un modèle (`embedded`) sont écartés : ils n'ont pas de tuile à eux, ils
 * se montrent dépliés sous leur modèle — que la recherche, elle, trouve.
 * Rend `null` quand il n'y a rien à chercher : c'est le signal « revenir au dossier courant ».
 */
export function searchAssets(assets, text){
  const q = parseAssetQuery(text);
  if(q.empty) return null;
  return (assets || []).filter(function(a){ return a && !a.embedded && assetMatchesQuery(a, q); })
    .sort(function(a, b){
      const na = foldSearchText(a.name), nb = foldSearchText(b.name);
      if(na !== nb) return na < nb ? -1 : 1;
      const fa = a.folder || '', fb = b.folder || '';
      return fa < fb ? -1 : (fa > fb ? 1 : 0);
    });
}

/**
 * Les DOSSIERS dont le nom répond aux mots libres (Unity les montre aussi). Aucun dossier dès
 * qu'un `t:` est posé : on a demandé un genre d'asset, et un dossier n'en est pas un.
 */
export function searchFolders(folderPaths, text){
  const q = parseAssetQuery(text);
  if(q.empty || q.kindIds.length || q.unknownTypes.length || !q.words.length) return [];
  return (folderPaths || []).filter(function(p){
    const name = foldSearchText(String(p).split('/').pop());
    return q.words.every(function(w){ return name.indexOf(w) !== -1; });
  });
}

/** Le dossier d'origine, lisible : « Projet » à la racine, sinon le chemin « A › B ». */
export function folderLabelOf(folder){
  return folder ? String(folder).split('/').join(' › ') : 'Projet';
}

/**
 * Pose ou retire le filtre `t:` d'un genre dans le texte, en gardant le reste tel quel.
 * C'est tout ce que fait le menu des genres : un `t:` déjà présent, sous N'IMPORTE QUEL alias
 * (« t:materiau » tapé à la main), est reconnu et retiré.
 */
export function toggleKindToken(text, kindId){
  const k = ASSET_SEARCH_KINDS.find(function(x){ return x.id === kindId; });
  if(!k) return String(text == null ? '' : text);
  const toks = String(text == null ? '' : text).split(/\s+/).filter(Boolean);
  const kept = toks.filter(function(tok){
    const m = /^t:(.+)$/i.exec(tok);
    return !(m && searchKindByAlias(m[1]) === k);
  });
  if(kept.length === toks.length) kept.push('t:' + k.aliases[0]);
  return kept.join(' ');
}

/** Retire TOUS les `t:` du texte (entrée « Tous les genres » du menu). */
export function clearKindTokens(text){
  return String(text == null ? '' : text).split(/\s+/).filter(function(tok){
    return tok && !/^t:/i.test(tok);
  }).join(' ');
}
