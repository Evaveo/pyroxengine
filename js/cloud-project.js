// ---------- Projet hébergé : lecture et enregistrement par tree de files ----------
// Un projet du cloud est un MANIFESTE { path -> { sha, size } } dont les files sont des
// objets adressés par content (routes /api/assets/:sha). Voir
// docs/superpowers/specs/2026-09-23-projet-cloud-editable-design.md.
//
// CE MODULE NE DÉPEND PAS DU CLOUD dans l'autre sens : toutes ses entrées/sorties réseau
// passent par un objet `api` injecté. Sans cloud, rien ici n'est appelé et l'éditeur se
// comporte exactement comme aujourd'hui — `moteur/` part en open source et doit tourner seul.
//
// Il ne réimplémente pas non plus le chargement d'un projet : il fabrique un ARBRE VIRTUEL de
// la même forme que `scanFolder()` (project-folder.js), pour que `loadManifestFromTree()`,
// `loadContentScene()` et les migrations par fichier fonctionnent sans une ligne de changement.

import { httpError, withRetry } from './load-retry.js';

/** SHA-256 hexadécimal d'un content — l'identité d'un objet dans le stockage. */
export async function shaOf(content){
  const bytes = (typeof content === 'string') ? new TextEncoder().encode(content)
               : (content instanceof Uint8Array) ? content
               : new Uint8Array(content);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((o) => o.toString(16).padStart(2, '0')).join('');
}

/**
 * Un tree virtuel de la forme rendue par scanFolder() : { files:[{filePath, handle, size}], folders }.
 * Chaque `handle` ne télécharge son objet qu'à la première lecture, et le garde — un projet de
 * cent scènes ne rapatrie que celles qu'on ouvre vraiment.
 */
const MIME = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', webp:'image/webp', gif:'image/gif',
  wav:'audio/wav', mp3:'audio/mpeg', ogg:'audio/ogg', glb:'model/gltf-binary', gltf:'model/gltf+json',
  json:'application/json', js:'text/javascript', css:'text/css', html:'text/html' };
/** Le type MIME d'un fichier d'après son extension ; vide s'il est inconnu (le Blob reste valide). */
export function mimeOf(name){ const m = /.([a-z0-9]+)$/i.exec(name || ''); return (m && MIME[m[1].toLowerCase()]) || ''; }

export function cloudTree(manifest, readObject){
  const cache = new Map();
  const files = Object.keys(manifest).sort().map((filePath) => {
    const { sha, size } = manifest[filePath];
    return {
      filePath, size: size, lastModif: 0, sha,
      handle: {
        async getFile(){
          if(!cache.has(sha)) cache.set(sha, await readObject(sha));
          const bytes = cache.get(sha);
          // UN VRAI `File`, pas un objet qui en imite deux méthodes. Le chargement d'une texture,
          // d'un son ou d'un modèle passe par `URL.createObjectURL(file)`, qui refuse tout ce qui
          // n'est pas un Blob : chaque binaire d'un projet hébergé était jeté au chargement,
          // dans un catch qui ne laissait qu'un message de trois secondes (docs/KNOWN_ISSUES.md).
          // Le nom compte aussi : l'enregistrement suivant écrit l'asset sous `file.name`.
          const name = filePath.split('/').pop();
          return new File([bytes], name, { type: mimeOf(name) });
        }
      }
    };
  });
  // Les dossiers se déduisent des chemins : le manifest ne les porte pas, et l'API File
  // System Access ne modélise de toute façon pas les dossiers vides.
  const folders = [...new Set(files.flatMap((f) => {
    const seg = f.filePath.split('/'); seg.pop();
    return seg.map((_, i) => seg.slice(0, i + 1).join('/'));
  }))].filter(Boolean).sort();
  return { files, folders };
}

/**
 * Le manifest à envoyer, calculé à partir des files produits par l'éditeur.
 * `files` : { path -> content (string | Uint8Array) }.
 */
export async function manifestOf(files){
  const manifest = {};
  for(const path of Object.keys(files).sort()){
    const content = files[path];
    const bytes = (typeof content === 'string') ? new TextEncoder().encode(content) : content;
    manifest[path] = { sha: await shaOf(bytes), size: bytes.length };
  }
  return manifest;
}

/**
 * Les objets qu'il faut vraiment téléverser : ceux que le serveur n'a pas déjà.
 * Un même content à deux chemins (deux copies d'une texture) ne se dépose qu'une fois.
 */
export async function toUpload(manifest, alreadyThere){
  const unique = [...new Set(Object.values(manifest).map((e) => e.sha))];
  const missing = [];
  for(const sha of unique){ if(!await alreadyThere(sha)) missing.push(sha); }
  return missing.sort();
}

/**
 * Client HTTP du projet hébergé. Regroupé ici pour que le reste du module reste pur et que les
 * tests n'aient aucun réseau à simuler autrement qu'en remplaçant cet objet.
 */
export function cloudApi(base = ''){
  const url = (path) => base.replace(/\/$/, '') + path;
  const json = async (r) => {
    const body = await r.json().catch(() => ({}));
    if(!r.ok) throw Object.assign(new Error(body.erreur || ('HTTP ' + r.status)), { statut: r.status, details: body });
    return body;
  };
  return {
    // LES CHEMINS DE L'API SONT EN FRANCAIS, contrairement aux cles du manifeste. C'est le
    // choix assume du serveur (cloud/back/controleurs/projets.js) : seul le FORMAT DE FIL est
    // anglais, parce qu'il est partage avec ce module-ci qui part en open source. Ecrire
    // « /tree » ici renvoyait 404 « route inconnue » — et aucun test ne le voyait, tous
    // injectant un faux `api`. Garde : cloud/back/test/arbre-chemins-client.test.mjs.
    async readTree(projetId, versionId){
      return json(await fetch(url('/api/projets/' + projetId + '/arbre' + (versionId ? '/' + versionId : '')),
        { credentials: 'include' }));
    },
    // L'ARCHIVE d'un projet pas encore converti. Un projet du cloud enregistre avant le format
    // arborescent est un `.p3d` depose tel quel : `readTree` repond alors 409 « cette version
    // est une archive ». La conversion la relit par ici, l'ouvre dans l'editeur, et le premier
    // enregistrement ecrit un arbre.
    async readArchive(projetId){
      const r = await fetch(url('/api/projets/' + projetId + '/blob'), { credentials: 'include' });
      if(!r.ok) throw new Error('archive du projet illisible (HTTP ' + r.status + ')');
      return new Uint8Array(await r.arrayBuffer());
    },
    // RÉESSAYÉ sur 429 / 5xx (Retry-After respecté) : l'ouverture d'un projet demande tous ses
    // objets d'affilée, et le limiteur du serveur en refusait une partie. Chaque refus devenait
    // une texture « perdue au chargement », effacée du projet à la sauvegarde suivante
    // (BUGS_MOTEUR n° 18). Voir js/load-retry.js.
    async readObject(sha){
      return withRetry(async function(){
        const r = await fetch(url('/api/assets/' + sha), { credentials: 'include' });
        if(!r.ok){
          throw httpError('objet ' + sha.slice(0, 8) + ' illisible (HTTP ' + r.status + ')', r.status,
            r.headers && r.headers.get ? r.headers.get('retry-after') : null);
        }
        return new Uint8Array(await r.arrayBuffer());
      });
    },
    async missingObjects(shas){
      const r = await fetch(url('/api/assets/manquants'), { method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ shas }) });
      if(!r.ok) throw new Error('HTTP ' + r.status);
      return (await r.json()).manquants || [];
    },
    async hasObject(sha){
      return (await fetch(url('/api/assets/' + sha), { method: 'HEAD', credentials: 'include' })).ok;
    },
    async putObject(sha, bytes){
      const r = await fetch(url('/api/assets/' + sha),
        { method: 'PUT', credentials: 'include',
          headers: { 'content-type': 'application/octet-stream' }, body: bytes });
      if(!r.ok) throw new Error('dépôt de ' + sha.slice(0, 8) + ' refusé (HTTP ' + r.status + ')');
    },
    // Verrous de scene. `takeLock` est IDEMPOTENT pour le detenteur : c'est la meme requete
    // qui prend le verrou et qui renouvelle son bail (cloud/back/controleurs/verrous.js).
    async takeLock(projetId, scene){
      const r = await fetch(url('/api/projets/' + projetId + '/verrous'), {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scene })
      });
      return r.json().catch(() => ({ ok: false }));
    },
    async releaseLock(projetId, scene){
      await fetch(url('/api/projets/' + projetId + '/verrous/' + encodeURIComponent(scene)),
        { method: 'DELETE', credentials: 'include' });
    },
    // Création d'un projet hébergé VIDE (cloud/back/controleurs/projets.js:creer). Le corps
    // attendu est `{ nom }` ; l'organisation par défaut du compte est choisie côté serveur.
    // Un refus de plan (402) garde le message du serveur, déjà en français.
    async createProject(name){
      return json(await fetch(url('/api/projets'), {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ 'nom': name })  // clé du serveur, en français
      }));
    },
    async writeTree(projetId, body){
      return json(await fetch(url('/api/projets/' + projetId + '/arbre'), {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
      }));
    }
  };
}

/** Ouvre un projet hébergé : rend l'tree virtuel et l'identifiant de version chargée. */
export async function openCloudProject(projetId, api){
  const tree = await api.readTree(projetId);
  return {
    versionId: tree.version_id,
    manifest: tree.files,
    tree: cloudTree(tree.files, (sha) => api.readObject(sha))
  };
}

/**
 * Enregistre un DELTA sur le manifeste chargé.
 *
 * L'éditeur n'écrit jamais tout un projet : `registerInProjectOpen()` ne touche que
 * `project.json` et la scène courante, les autres scènes gardant leur fichier tel quel. Le
 * cloud suit le même modèle — et c'est ce qui rend l'enregistrement bon marché : un fichier
 * inchangé garde son empreinte, donc il n'est ni relu, ni rehashé, ni retéléversé. Une texture
 * de 40 Mo ne repart pas à chaque sauvegarde.
 *
 * `base` est la version chargée : elle permet au serveur d'accepter un enregistrement
 * concurrent portant sur d'autres fichiers, et de refuser un vrai conflit en le nommant.
 *
 * @param baseManifest le manifeste de la version chargée : { path -> {sha, size} }
 * @param changed      { path -> content } — seulement ce qui a changé
 * @param removed      chemins supprimés
 */
export async function saveCloudProject(projetId, { baseManifest, changed, removed }, base, api, note){
  const manifest = { ...(baseManifest || {}) };
  for(const path of (removed || [])) delete manifest[path];

  const bySha = new Map();
  const fresh = {};
  for(const path of Object.keys(changed || {})){
    const content = changed[path];
    const bytes = (typeof content === 'string') ? new TextEncoder().encode(content) : content;
    const sha = await shaOf(bytes);
    manifest[path] = { sha, size: bytes.length };
    fresh[path] = manifest[path];
    bySha.set(sha, bytes);
  }

  // On n'interroge le serveur que sur les empreintes NOUVELLES : celles du manifeste de base
  // y sont déjà, par construction — c'est lui qui vient de nous les donner.
  // Une seule question au serveur quand il sait y répondre (POST /api/assets/manquants) ; repli
  // sur un HEAD par empreinte sinon (serveur plus ancien, ou `api` de test sans cette méthode).
  // Les HEAD répondaient 404 pour chaque fichier neuf : autant d'erreurs rouges dans la console.
  let missingSet = null;
  if(typeof api.missingObjects === 'function'){
    try { missingSet = new Set(await api.missingObjects([...new Set(Object.values(fresh).map((e) => e.sha))])); }
    catch(e){ missingSet = null; }
  }
  const alreadyThere = missingSet ? (s) => !missingSet.has(s) : (s) => api.hasObject(s);
  for(const sha of await toUpload(fresh, alreadyThere)){
    await api.putObject(sha, bySha.get(sha));
  }
  try {
    return await api.writeTree(projetId, { base, files: manifest, note });
  } catch(e){
    // LE MANIFESTE VOYAGE AVEC L'ECHEC. Un refus en conflit demande de rejouer avec un
    // arbitrage, donc de disposer de ce qu'on proposait — le recalculer obligerait a
    // rehacher les fichiers modifies, et surtout a tenir une seconde fois la meme regle.
    if(e && typeof e === 'object') e.manifest = manifest;
    throw e;
  }
}


/**
 * Les fichiers de scène qu'un enregistrement DOIT porter en plus du delta habituel : ceux
 * d'une scène qui n'a encore aucun fichier dans le manifeste de base.
 *
 * L'enregistrement d'un projet hébergé est un DELTA — `project.json` et la scène affichée. Ça
 * suppose que le manifeste porte déjà les autres scènes. C'est vrai d'un projet déjà
 * arborescent, et faux dans deux cas où la perte serait totale et muette :
 *
 *   - la CONVERSION d'une archive : le manifeste de départ est vide, et le projet converti ne
 *     garderait que la scène affichée ;
 *   - une scène AJOUTÉE puis enregistrée depuis une autre scène : son fichier ne serait jamais
 *     écrit, et le manifeste la listerait sans qu'elle existe.
 *
 * Dans les deux cas, rien ne casse à l'enregistrement. C'est à la RÉOUVERTURE que ça se voit :
 * `loadContentScene()` ne trouve pas le fichier, rend `null`, et l'éditeur ouvre une scène
 * vide — sans la moindre erreur.
 *
 * @param scenes  [{ name, data }] dans l'ordre du projet ; `data` null = jamais chargée
 * @param base    le manifeste de la version chargée
 * @param already les chemins que l'appelant écrit déjà (la scène affichée)
 */
export function scenesToWrite(scenes, base, already){
  const out = {};
  const baseManifest = base || {};
  const deja = already || {};
  for(const scene of (scenes || [])){
    const filePath = 'scenes/' + scene.name + '.scene.json';
    if(deja[filePath] || baseManifest[filePath]) continue;
    if(!scene.data) continue;       // jamais chargée : on n'écrit pas une scène qu'on n'a pas
    out[filePath] = JSON.stringify(scene.data, null, 2);
  }
  return out;
}


// ---------- Résolution d'un conflit ----------
// Le serveur refuse en 409 quand un collègue a touché un fichier que je touche aussi, et il
// NOMME ces fichiers (cloud/back/services/arbreProjet.js:conflits). Jusqu'ici l'éditeur se
// contentait de les afficher : on était nommé perdant, sans rien à faire de cette information.
//
// LA RÈGLE EST CELLE DU SERVEUR, RÉÉCRITE ICI — et c'est délibéré, pas un oubli. `moteur/`
// part en open source et ne peut rien importer de `cloud/` ; la seule alternative serait de
// n'avoir aucune résolution côté client. Le risque de divergence est réel, donc mesuré :
// cloud/back/test/arbre-accord-client.test.mjs charge les DEUX implémentations et vérifie
// qu'elles rendent le même manifeste.
//
// Le point non évident : on repart du manifeste de TÊTE, pas du mien. Repartir du mien
// effacerait les fichiers que le collègue a écrits SANS conflit — ceux qu'aucun des deux
// écrans ne mentionne, et dont la disparition ne se verrait donc nulle part.

/** Les chemins que J'AI touchés : ajoutés, modifiés ou supprimés depuis ma base. */
export function myChanges(baseManifest, myManifest){
  const base = baseManifest || {}, mine = myManifest || {};
  const paths = new Set([...Object.keys(base), ...Object.keys(mine)]);
  return [...paths].filter((p) => {
    const a = base[p], b = mine[p];
    if(!a || !b) return a !== b;
    return a.sha !== b.sha;
  }).sort();
}

/**
 * Le manifeste à réenvoyer, une fois l'arbitrage rendu. À poster avec `base = tete_id` : le
 * serveur voit alors une base à jour et l'écrit tel quel, sans refaire de test de conflit.
 *
 * @param choices { chemin -> 'mine' | 'theirs' } — un choix par chemin en conflit.
 *                Tout chemin en conflit sans choix explicite garde CELUI DU COLLÈGUE :
 *                le défaut d'un arbitrage doit être de ne rien écraser.
 */
export function resolveConflict(baseManifest, headManifest, myManifest, conflicts, choices){
  const head = headManifest || {}, mine = myManifest || {};
  const enConflit = new Set(conflicts || []);
  const decision = choices || {};
  const out = { ...head };

  for(const path of myChanges(baseManifest, mine)){
    // Un chemin en conflit ne suit mon choix que s'il est explicitement « mine ».
    if(enConflit.has(path) && decision[path] !== 'mine') continue;
    if(mine[path]) out[path] = mine[path];
    else delete out[path];       // je l'ai supprimé, et j'assume
  }
  return out;
}

/** L'identifiant de projet hébergé passé dans l'URL, ou null. Sans lui, ce module dort. */
export function cloudProjectIdFromUrl(search){
  const id = new URLSearchParams(search || '').get('projet');
  return (id && /^[0-9]+$/.test(id)) ? Number(id) : null;
}


/**
 * Les chemins du manifeste de base qui ne font PLUS partie du projet, à passer en `removed`.
 *
 * Sans ce calcul, un asset déplacé, renommé ou supprimé (et son `.meta`) restait dans le
 * manifeste hébergé à son ancien chemin : au rechargement, il revenait comme asset
 * « découvert », en doublon (voir docs/KNOWN_ISSUES.md).
 *
 * Seuls `assets/**` et `scenes/*.scene.json` sont concernés. Une scène NON CHARGÉE reste
 * listée dans `live` (elle fait toujours partie du projet) : son fichier est gardé tel quel,
 * c'est le modèle delta. Tout autre chemin (fichiers hors éditeur) n'est jamais retiré.
 *
 * Garde-fou : si un chemin vivant est ABSENT du manifeste résultant (un fichier binaire
 * déplacé dont on n'envoie pas les octets), on ne retire aucun binaire — l'ancien chemin est
 * peut-être la seule copie de son contenu. Seuls les fichiers texte réécrits et les `.meta`
 * partent alors.
 *
 * @param base    le manifeste de la version chargée
 * @param live    les chemins qui font partie du projet (Set ou tableau)
 * @param changed les chemins écrits par cet enregistrement
 */
export function cloudPathsToRemove(base, live, changed){
  const alive = new Set(live || []);
  const written = changed || {};
  const baseManifest = base || {};
  const managed = (p) => p.startsWith('assets/') || /^scenes\/[^/]+\.scene\.json$/.test(p);
  const lostBytes = [...alive].some((p) => !written[p] && !baseManifest[p]);
  const out = [];
  for(const p of Object.keys(baseManifest)){
    if(alive.has(p) || written[p] || !managed(p)) continue;
    const textual = p.endsWith('.meta') || p.endsWith('.json') || /\.(js|html|css)$/.test(p);
    if(lostBytes && !textual) continue;
    out.push(p);
  }
  return out;
}
