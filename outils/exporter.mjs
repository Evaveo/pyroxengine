// moteur/outils/exporter.mjs — publier un projet en site statique, depuis le terminal.
//
//   node moteur/outils/exporter.mjs jeux/Chromelo
//   node moteur/outils/exporter.mjs jeux/Chromelo --out /tmp/chromelo-web
//
// Rend un DOSSIER prêt à héberger : `index.html`, `data.js`, et les modules du moteur que ce
// projet-là exige. On le dépose tel quel sur n'importe quel hébergeur statique (Netlify, Pages,
// un simple `nginx`), ou on l'ouvre en double-cliquant `index.html` — tout passe par des balises
// `<script>`, il n'y a aucun `fetch` à servir.
//
// ---------------------------------------------------------------------------
// POURQUOI UN OUTIL DE PLUS, PUISQUE L'ÉDITEUR SAIT DÉJÀ PUBLIER
//
// `exportBuildWeb()` (js/build.js) fait le même travail, mais DANS le navigateur : il exige que
// l'éditeur soit lui-même servi en http (sinon `fetch` refuse de lire ses propres fichiers), et
// il rend un ZIP à dézipper. C'est parfait pour « tester mon jeu », et pénible pour « mettre en
// ligne » ou « publier depuis un script ».
//
// CE QUI COMPTE ICI : cet outil ne RECOPIE RIEN de la logique de publication. La table des
// modules (`BUILD_MODULES`), le gabarit de `index.html` (`pageIndexBuild`), le choix des
// décodeurs (`decodersNeeded`) et l'allègement (`trimmingBuild`) sont lus dans `js/build.js` et
// `js/build-trimming.js` et exécutés tels quels. Deux publieurs qui divergent, c'est un jeu en
// ligne qui ne se comporte pas comme l'aperçu — et cette famille de défaut a déjà coûté assez
// cher dans ce dépôt. Il n'y a qu'une source, elle est dans `js/`.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { deEsm } from '../test/engine-env.mjs';

const ENGINE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(p, 'utf8');

// Les types MIME dont un navigateur a besoin dans une `data:` URL. Une texture servie en
// `application/octet-stream` ne se décode pas en `Image` : elle ne lèverait pas d'erreur, elle
// resterait simplement noire.
const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.ktx2': 'image/ktx2', '.basis': 'image/basis', '.svg': 'image/svg+xml',
  '.hdr': 'image/vnd.radiance', '.exr': 'image/x-exr',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.fbx': 'application/octet-stream',
  '.bin': 'application/octet-stream'
};

/** Le pendant exact de `fileInB64` (serialization.js), côté disque : `{name, b64}`. */
function fileInB64(bytes, name){
  const mime = MIME[path.extname(name).toLowerCase()] || 'application/octet-stream';
  return {name, b64: 'data:' + mime + ';base64,' + Buffer.from(bytes).toString('base64')};
}

/**
 * LA SOURCE D'UN PROJET, abstraite : `text(rel)`, `bytes(rel)`, `exists(rel)`, chemins relatifs à
 * la racine du projet avec des `/`. Un dossier sur disque en est une ; un projet hébergé (manifeste
 * { chemin -> sha } + objets adressés par contenu) en est une autre — c'est ce qui permet au cloud
 * de construire le jeu sans navigateur, avec EXACTEMENT ce code-ci.
 */
export function folderReader(projectDir){
  const full = (rel) => path.join(projectDir, ...rel.split('/'));
  return {
    text: (rel) => read(full(rel)),
    bytes: (rel) => fs.readFileSync(full(rel)),
    exists: (rel) => fs.existsSync(full(rel))
  };
}

const joinRel = (...parts) => parts.filter(Boolean).join('/').replace(/\/+/g, '/');

// ---------------------------------------------------------------------------
// LIRE UN PROJET-DOSSIER

/**
 * Inline un asset du manifeste, comme `resolveAssetDescriptors` (project-folder.js) le fait
 * dans l'éditeur, puis `assetsSerialized` (serialization.js) pour la publication.
 *
 * Les ids du manifeste sont GARDÉS TELS QUELS. C'est le point à ne pas rater : à l'ouverture
 * dans l'éditeur, les ids sont régénérés et les scènes remappées ; ici on ne régénère rien, donc
 * les `documentUIId`/`scriptId`/`materialId` que portent les fichiers de scène continuent de
 * désigner les bons assets. Régénérer « pour faire comme l'éditeur » casserait toutes les
 * références en silence — c'est le défaut corrigé en v0.136.1, qu'on ne réintroduit pas ici.
 */
function inlineAsset(a, src){
  const base = {id: a.id, kind: a.kind, name: a.name, folder: a.folder || ''};
  const rel = (f) => joinRel('assets', a.folder || '', f);
  const textOf = (f) => src.text(rel(f));

  switch(a.kind){
    case 'script':      return {...base, code: textOf(a.file)};
    case 'documentUI':  return {...base, html: textOf(a.file)};
    case 'sheetStyle':  return {...base, css: textOf(a.file)};
    case 'data':        return {...base, text: textOf(a.file)};
    case 'material':    return {...base, props: JSON.parse(textOf(a.file)),
                                shaderId: a.shaderId || undefined,
                                byDefault: a.byDefault || undefined,
                                valuesParams: a.valuesParams || undefined};
    case 'postProfile': return {...base, effects: JSON.parse(textOf(a.file))};
    case 'animator':    return {...base, machine: JSON.parse(textOf(a.file))};
    case 'animation':   return {...base, anim: JSON.parse(textOf(a.file))};
    case 'sprite':      return {...base, sprite: JSON.parse(textOf(a.file))};
    case 'tilePalette': return {...base, palette: JSON.parse(textOf(a.file))};
    case 'graphShader': return {...base, ...JSON.parse(textOf(a.file))};
    // Bruitage et boucle musicale : la recette, le son se recalcule au chargement.
    case 'sfx':
    case 'musicLoop':   return {...base, recipe: JSON.parse(textOf(a.file))};
    case 'preset': {
      const d = JSON.parse(textOf(a.file));
      return {...base, preset: {kind: d.kind || '', params: d.params || {}}};
    }
    case 'prefab': {
      // Depuis v0.198.0 le prefab vit dans son `.prefab.json` ({version, base, tree}). Ne lire
      // que `a.tree` (l'ancien prefab en ligne) publiait des prefabs VIDES : monstres, brouillard
      // et effets créés par `api.create` n'apparaissaient plus dans le jeu (v1.2.4).
      if(!a.file) return {...base, base: a.base || null, tree: a.tree || []};
      const d = JSON.parse(textOf(a.file));
      return {...base, base: d.base || a.base || null, tree: d.tree || []};
    }
    case 'texture':
    case 'audio':
    case 'model':
      return {...base, paramsImport: a.paramsImport || null,
              cuite: a.cuite || undefined, rgbm: a.rgbm || undefined,
              markers: a.markers || undefined, avatar: a.avatar || undefined,
              files: (a.files || []).map((f) => fileInB64(src.bytes(rel(f)), f))};
    default:
      throw new Error('type d\'asset inconnu de l\'exporteur : « ' + a.kind + ' » ('
        + a.name + '). Ajouter sa branche ici ET dans resolveAssetDescriptors.');
  }
}

/** Le `window.GAME_DATA` d'un projet-dossier — la forme que produit `buildDataProject()`. */
export function dataOfProject(projectDir, engineVersion){
  return dataOfSource(folderReader(projectDir), engineVersion);
}

export function dataOfSource(src, engineVersion){
  const manifest = JSON.parse(src.text('project.json'));

  const scenes = manifest.scenes.map(function(s){
    const file = 'scenes/' + s.name + '.scene.json';
    if(!src.exists(file)){
      throw new Error('la scène « ' + s.name + ' » est citée par project.json mais son fichier '
        + 'est absent : ' + file);
    }
    const d = JSON.parse(src.text(file));
    return {name: s.name,
            data: {objects: d.objects, tracks: d.tracks, duration: d.duration,
                   loop: d.loop, env: d.env}};
  });

  return {
    version: 15,
    current: 0,
    folders: manifest.folders || [],
    settings: manifest.settings || {},
    scenes,
    assets: (manifest.assets || []).map((a) => inlineAsset(a, src)),
    build: {
      engine: engineVersion,
      date: new Date().toISOString().slice(0, 16).replace('T', ' '),
      visible: (manifest.settings || {}).versionVisible !== false
    }
  };
}

// ---------------------------------------------------------------------------
// EMPRUNTER LA LOGIQUE DE PUBLICATION DE L'ÉDITEUR, SANS LA RECOPIER
//
// `js/build.js` tire `fflate`, `fetch` et le DOM par ses imports ; `deEsm` les retire, et on
// fournit à la place la seule fonction dont les parties qui nous intéressent se servent
// (`escapeHtml`).
function buildContext(){
  // atob/TextDecoder/Uint8Array : decodersNeeded() décode les .glb pour lire leurs extensions.
  const bac = {console, Math, JSON, Number, String, Object, Array, isFinite, RegExp, Error,
    Set, Map, atob, TextDecoder, Uint8Array};
  bac.window = bac; bac.self = bac; bac.globalThis = bac;
  bac.escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const ctx = vm.createContext(bac);
  for(const f of ['js/asset-compression.js', 'js/build-trimming.js', 'js/build.js']){
    vm.runInContext(deEsm(read(path.join(ENGINE, f))), ctx, {filename: f});
  }
  return ctx;
}

// ---------------------------------------------------------------------------

/**
 * Les fichiers du jeu publié, en mémoire : { chemin -> string | Buffer }. `network` est l'origine du
 * relais multijoueur à inscrire dans le build (ce que fait l'éditeur), ou null.
 */
export function buildFilesOfSource(src, {network = null} = {}){
  const version = (read(path.join(ENGINE, 'js/version.js'))
    .match(/VERSION_ENGINE\s*=\s*'([^']+)'/) || [])[1] || '?';

  const manifest = JSON.parse(src.text('project.json'));
  const data = dataOfSource(src, version);
  if(network) data.build.network = network;
  const ctx = buildContext();

  const decoders = ctx.decodersNeeded(data);
  const trimming = ctx.trimmingBuild ? ctx.trimmingBuild(data) : null;
  const retires = new Set((trimming ? trimming.retires : []).map((r) => r.dans));

  const files = {
    'index.html': ctx.pageIndexBuild(manifest.name || 'Jeu', decoders, trimming),
    'data.js': 'window.GAME_DATA = ' + JSON.stringify(data) + ';\n'
  };
  // Les modules : même table, même noms de sortie que le ZIP de l'éditeur.
  let copies = 0, allege = 0;
  for(const m of ctx.BUILD_MODULES){
    const out = ctx.outputBuildModule(m);
    if(retires.has(out)){ allege++; continue; }
    files[out] = fs.readFileSync(path.join(ENGINE, m.src));
    copies++;
  }
  // Les décodeurs gardent leur chemin `vendor/…` : c'est celui qu'écrit `pageIndexBuild`.
  for(const d of decoders) files[d] = fs.readFileSync(path.join(ENGINE, d));

  return {files, name: manifest.name || 'Jeu', copies, allege, decoders, retires: [...retires],
          version, assets: data.assets.length, scenes: data.scenes.length};
}

export function exportProject(projectDir, outDir){
  const r = buildFilesOfSource(folderReader(projectDir));
  fs.rmSync(outDir, {recursive: true, force: true});
  fs.mkdirSync(outDir, {recursive: true});
  for(const [rel, content] of Object.entries(r.files)){
    const full = path.join(outDir, rel);
    fs.mkdirSync(path.dirname(full), {recursive: true});
    fs.writeFileSync(full, content);
  }
  const {files, ...rest} = r;
  return {outDir, ...rest};
}

// ---------------------------------------------------------------------------
// Ligne de commande

const estPrincipal = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if(estPrincipal){
  const args = process.argv.slice(2);
  const iOut = args.indexOf('--out');
  // `iOut + 1` vaut 0 quand `--out` est absent (iOut === -1), ce qui excluait le premier
  // argument — c'est-à-dire le seul qu'on attend dans le cas le plus courant.
  const projectDir = args.find((a, i) => !a.startsWith('--') && (iOut === -1 || i !== iOut + 1));
  if(!projectDir){
    console.error('usage : node moteur/outils/exporter.mjs <dossier-projet> [--out <dossier>]');
    process.exit(1);
  }
  const outDir = iOut !== -1 ? args[iOut + 1] : path.join(projectDir, 'web');
  try {
    const r = exportProject(path.resolve(projectDir), path.resolve(outDir));
    console.log('Publié dans ' + r.outDir);
    console.log('  moteur v' + r.version + ' · ' + r.scenes + ' scène(s) · '
      + r.assets + ' asset(s)');
    console.log('  ' + r.copies + ' modules copiés'
      + (r.allege ? ', ' + r.allege + ' allégés (inutilisés par ce projet)' : '')
      + (r.decoders.length ? ', décodeurs : ' + r.decoders.join(', ') : ''));
    console.log('  À héberger tel quel, ou ouvrir index.html directement.');
  } catch(e){
    console.error('Export impossible : ' + e.message);
    process.exit(1);
  }
}
