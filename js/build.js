// ---------- Build Web jouable en un clic ----------
// Assemble un ZIP autonome : index.html + vendor/ + runtime.js (copie de
// js/game-runtime.js) + data.js (project complet, assets en base64).
// Le build s'ouvre en double-cliquant index.html (aucun serveur requis :
// tout passe par des balises <script>, pas de fetch).
// Nécessite que l'ÉDITEUR soit servi en http(s) pour lire ses propres fichiers.

// ---------------------------------------------------------------------------
// LA TABLE DES MODULES DU BUILD — une seule, et c'est tout l'intérêt.
//
// Avant : DEUX listes parallèles (`sources`, à télécharger, et `files`, à zipper) reliées par
// des index littéraux — `'components/component-collider.js': fflate.strToU8(textes[35])`. Rien
// ne rattachait le nom de gauche à l'URL de droite, donc insérer une entrée ailleurs qu'à la fin
// publiait un fichier SOUS LE NOM D'UN AUTRE, en silence. Déjà arrivé à l'index 17 : le jeu
// publié servait `physics-2d.js` avec le contenu de `sprite-2d.js`, et le seul symptôme était
// une page blanche dont le message désignait le mauvais fichier. Sept commentaires « A LA FIN »
// tenaient l'invariant à la main.
//
// Ici l'index n'existe plus. Le nom dans le ZIP se DÉDUIT de l'URL (`js/x.js` → `x.js`,
// `js/components/x.js` → `components/x.js`, un chemin `vendor/` reste tel quel), et l'ordre de
// cette liste n'a plus aucun sens : on ajoute où on veut.
//
// `out` ne s'écrit que pour un RENOMMAGE réel. Il n'y en a qu'un.
import { DECODERS_COMPRESSION, compressionsOfModel } from './asset-compression.js';
import { DESKTOP_GAME_DIR, desktopWrapperFiles } from './build-desktop.js';
import { DESKTOP_BUILD_HANDLER_VERSION, DESKTOP_BUILD_INSTALLER_NAME, compileUrl, windowsCompilerInstaller } from './desktop-compiler.js';
import { moduleEmbedded, trimmingBuild } from './build-trimming.js';
import { setStatus } from './hierarchy.js';
import { escapeHtml } from './objects.js';
import { project } from './project.js';
import { buildDataProject, slugFile } from './serialization.js';
import { VERSION_ENGINE } from './version.js';

export const BUILD_MODULES = [
  {src: 'vendor/three-addons.min.js'},
  {src: 'vendor/cannon.js'},
  {src: 'vendor-esm/three.core.min.js'},
  {src: 'vendor-esm/three.webgpu.min.js'},
  {src: 'vendor-esm/three.tsl.min.js'},
  {src: 'js/render-webgpu-bridge.mjs'},

  // Le runtime lui-même : le SEUL fichier renommé au passage.
  {src: 'js/game-runtime.js', out: 'runtime.js'},
  {src: 'js/game-ui.js'},
  {src: 'js/game-character.js'},
  {src: 'js/network-game.js'},
  {src: 'js/render-perf.js'},
  {src: 'js/asset-compression.js'},

  // Le socle à composants, jamais facultatif (aucune garde `typeof` ne peut le remplacer).
  {src: 'js/model-import.js'},
  {src: 'js/model-nodes.js'},
  {src: 'js/raycast-candidates.js'},
  {src: 'js/component-data.js'},
  {src: 'js/component-registry.js'},
  {src: 'js/component.js'},
  {src: 'js/node.js'},
  {src: 'js/rigid-body.js'},
  {src: 'js/component-migration.js'},

  // Les Systèmes.
  {src: 'js/systems.js'},
  {src: 'js/plugin-host.js'},
  {src: 'js/systems/tilemap-system.js'},
  {src: 'js/systems/sprite-system.js'},
  {src: 'js/systems/fog-system.js'},
  {src: 'js/systems/camera-system.js'},

  // Les composants — tous, y compris ceux de la 2D et du suivi de caméra, qui avaient déjà été
  // oubliés ici une fois (voir docs/KNOWN_ISSUES.md).
  {src: 'js/components/component-mesh.js'},
  {src: 'js/components/component-model.js'},
  {src: 'js/components/component-skinned-mesh.js'},
  {src: 'js/components/component-light.js'},
  {src: 'js/components/component-camera.js'},
  {src: 'js/components/component-camera-follow.js'},
  {src: 'js/components/component-team-color.js'},
  {src: 'js/fog-grid.js'},
  {src: 'js/components/component-fog-of-war.js'},
  {src: 'js/components/component-xr.js'},
  // Importé par runtime.js : toujours embarqué. Inerte tant qu'aucun XROrigin n'est dans le projet.
  {src: 'js/xr-runtime.js'},
  {src: 'js/components/component-collider.js'},
  {src: 'js/components/component-physics.js'},
  {src: 'js/components/component-terrain.js'},
  {src: 'js/components/component-particles.js'},
  {src: 'js/components/component-reflection.js'},
  {src: 'js/components/component-script.js'},
  {src: 'js/components/component-events.js'},
  {src: 'js/components/component-uidocument.js'},
  {src: 'js/components/component-animator.js'},
  {src: 'js/components/component-subscene.js'},
  {src: 'js/components/component-tag.js'},
  {src: 'js/components/component-audio.js'},
  {src: 'js/components/component-synth.js'},
  {src: 'js/components/component-touch-controls.js'},
  {src: 'js/components/component-postvolume.js'},
  {src: 'js/components/component-sprite.js'},
  {src: 'js/components/component-anim-sprite.js'},
  {src: 'js/components/component-tilemap.js'},
  {src: 'js/components/component-physics-2d.js'},

  // Les modules PURS partagés avec l'éditeur.
  {src: 'js/lightmap-atlas.js'},
  {src: 'js/script-scope.js'},
  {src: 'js/script-library.js'},
  {src: 'js/camera-overlays.js'},
  {src: 'js/shadow-fit.js'},
  {src: 'js/dev-guards.js'},
  {src: 'js/load-retry.js'},
  {src: 'js/lightmap-rgbm.js'},
  {src: 'js/retargeting.js'},
  {src: 'js/anim-markers.js'},
  {src: 'js/anim-blend.js'},
  {src: 'js/anim-asset.js'},
  {src: 'js/animator.js'},
  {src: 'js/humanoid-avatar.js'},
  {src: 'js/shader-graph.js'},
  {src: 'js/sprite-2d.js'},
  {src: 'js/anim-sprite.js'},
  {src: 'js/physics-2d.js'},
  {src: 'js/world-2d.js'},
  {src: 'js/sky-camera.js'},
  {src: 'js/tilemap.js'},
  {src: 'js/camera-framing.js'},
  {src: 'js/audio-falloff.js'},
  {src: 'js/audio-bus.js'},
  {src: 'js/chip-synth.js'},
  {src: 'js/music-loop.js'},
  {src: 'js/track-sampling.js'},
  {src: 'js/primitive-geometry.js'},
  {src: 'js/primitives-extra.js'},
  {src: 'js/synth.js'},
  {src: 'js/steam-bridge.js'},
  {src: 'js/locale.js'},
  {src: 'js/gamepad-input.js'},
  {src: 'js/touch-input.js'},
  {src: 'js/post-volume-blend.js'},
  {src: 'js/post-profile.js'}
];

/** Le nom d'un module dans le ZIP : son `out` s'il en a un, sinon son URL sans le préfixe `js/`. */
export function outputBuildModule(m){
  return m.out || m.src.replace(/^js\//, '');
}

if (typeof globalThis !== 'undefined'){
  globalThis.BUILD_MODULES = BUILD_MODULES;
  globalThis.outputBuildModule = outputBuildModule;
}

// Décodeurs à embarquer : ceux, et seulement ceux, que les assets du projet exigent.
//
// POURQUOI conditionnel — chiffres mesurés (fflate niveau 6, partie moteur du ZIP, sans
// data.js) : 619 Ko aujourd'hui ; +112 Ko avec Draco, +10 Ko avec meshopt, +390 Ko
// avec KTX2, +507 Ko avec les trois, soit +82 %. Un projet sans asset compressé ne paie
// que les 3 Ko de asset-compression.js. La décision se prend sur les OCTETS des fichiers
// (extensionsUsed du glTF), jamais sur leur nom : un .glb « non compressé » qui l'est
// quand même ferait disparaître ses maillages dans le jeu publié.
export function decodersNeeded(data){
  const besoins = new Set();
  (data.assets || []).forEach(function(a){
    if(a.kind !== 'model') return;
    (a.files || []).forEach(function(f){
      if(!/\.(glb|gltf)$/i.test(f.name || '')) return;
      // f.b64 est une donnees URL produite par FileReader.readAsDataURL
      const virgule = String(f.b64 || '').indexOf(',');
      if(virgule === -1) return;
      const bin = atob(String(f.b64).slice(virgule + 1));
      const u8 = new Uint8Array(bin.length);
      for(let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const content = /\.glb$/i.test(f.name) ? u8 : new TextDecoder().decode(u8);
      compressionsOfModel(f.name, content).forEach(function(e){ besoins.add(e); });
    });
  });
  return [...besoins].map(function(e){ return DECODERS_COMPRESSION[e].bundle; }).sort();
}

/**
 * La page du jeu publié.
 *
 * `trimming` est facultatif, et son absence signifie « embarque tout ». Ce n'est pas un détail de
 * confort : `build-test/index.html` est l'image OCTET POUR OCTET de cet appel sans allègement, et
 * c'est ce qui permet de tester la page publiée. Un troisième paramètre obligatoire aurait cassé ce
 * miroir.
 */
export function pageIndexBuild(title, bundlesDecoders, trimming){
  // `emb` rend la balise, ou rien. Le nom est court parce qu'il apparaît vingt fois.
  const emb = function(file){
    if(typeof moduleEmbedded === 'function' && !moduleEmbedded(trimming, file)) return '';
    // Les fichiers du moteur sont des MODULES ES depuis le passage à `import`/`export`. Les
    // vendors (cannon…) restent des scripts classiques : ils posent leurs globales, ce qu'un
    // module ne fait plus.
    return file.startsWith('vendor/')
      ? '<script src="' + file + '" defer><\/script>\n'
      : '<script type="module" src="' + file + '"><\/script>\n';
  };
  const page = pageIndexBuildBody(title, bundlesDecoders, emb);
  // Ce qui a ete retire, pour que les gardes du runtime se taisent sur ces modules-la
  // (dev-guards.js:warnOnceMissing). Rien d'ajoute sans allegement : la page reste alors
  // l'image exacte de build-test/index.html.
  const trimmed = trimming ? trimming.retires.map(function(r){ return r.dans; }) : [];
  if(!trimmed.length) return page;
  return page.replace('</head>', '<script>globalThis.ENGINE_TRIMMED_MODULES='
    + JSON.stringify(trimmed) + ';<\/script>\n</head>');
}

export function pageIndexBuildBody(title, bundlesDecoders, emb){
  return '<!DOCTYPE html>\n<html lang="fr">\n<head>\n<meta charset="UTF-8">\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n'
    + '<title>' + escapeHtml(title) + '</title>\n'
    + '<style>\n'
    + '  *{margin:0;padding:0;box-sizing:border-box;}\n'
    + '  html,body{height:100%;overflow:hidden;background:#0d0f12;color:#d6d9de;\n'
    + '    font-family:"Segoe UI",system-ui,sans-serif;}\n'
    + '  #rj-view{position:fixed;inset:0;}\n'
    + '  #rj-view canvas{display:block;}\n'
    // Interface de jeu : transparente aux clics, sauf sur les boutons — sinon
    // elle avalerait toute la souris et la caméra deviendrait impilotable.
    + '  #rj-ui{position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:6;}\n'
    + '  #rj-ui .ui-button{pointer-events:auto;cursor:pointer;font:inherit;}\n'
    + '  #rj-loading{position:fixed;inset:0;background:#0d0f12;display:flex;\n'
    + '    flex-direction:column;align-items:center;justify-content:center;gap:18px;z-index:10;}\n'
    + '  #rj-loading h1{font-size:22px;font-weight:600;}\n'
    + '  #rj-bar{width:min(420px,80vw);height:4px;background:#23272e;border-radius:2px;overflow:hidden;}\n'
    + '  #rj-bar::after{content:"";display:block;height:100%;width:40%;background:#5aa9e6;\n'
    + '    border-radius:2px;animation:rj-va 1.1s ease-in-out infinite alternate;}\n'
    + '  @keyframes rj-va{from{margin-left:0}to{margin-left:60%}}\n'
    + '  #rj-loading-txt{font-size:12.5px;color:#8a8f98;}\n'
    + '  #rj-hud{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);display:none;\n'
    + '    background:rgba(29,32,38,.92);border:1px solid #31363f;border-radius:8px;\n'
    + '    padding:8px 16px;font-size:13px;z-index:5;max-width:80vw;}\n'
    + '  #rj-error{position:fixed;top:14px;left:50%;transform:translateX(-50%);display:none;\n'
    + '    background:#3a1518;border:1px solid #e06c75;color:#ffb3b8;border-radius:8px;\n'
    + '    padding:8px 16px;font-size:13px;z-index:20;max-width:90vw;}\n'
    + '  #rj-full-screen{position:fixed;top:12px;right:12px;z-index:5;background:rgba(29,32,38,.85);\n'
    + '    border:1px solid #31363f;color:#d6d9de;border-radius:8px;padding:6px 12px;\n'
    + '    cursor:pointer;font-size:12.5px;}\n'
    + '  #rj-full-screen:hover{border-color:#5aa9e6;color:#5aa9e6;}\n'
    // Le numéro de version : discret, sous tout le reste, et transparent aux clics — il ne doit
    // jamais intercepter un tir. Il reste empty tant que le runtime ne l'a pas rempli.
    + '  #rj-version{position:fixed;bottom:6px;right:8px;z-index:4;pointer-events:none;\n'
    + '    font-size:10.5px;color:#6b7079;letter-spacing:.3px;font-variant-numeric:tabular-nums;}\n'
    + '</style>\n</head>\n<body>\n'
    + '<div id="rj-view"></div>\n'
    + '<div id="rj-loading"><h1>' + escapeHtml(title) + '</h1>'
    + '<div id="rj-bar"></div><div id="rj-loading-txt">Chargement…</div></div>\n'
    + '<button id="rj-full-screen" title="Plein écran">⛶ Plein écran</button>\n'
    + '<div id="rj-hud"></div>\n<div id="rj-error"></div>\n'
    + '<div id="rj-version"></div>\n'
    // Interface de jeu : même conteneur, même module de rendu que l'éditeur.
    + '<div id="rj-ui"></div>\n'
    // WebGPURenderer/TSL : même pont ESM que l'éditeur (js/render-webgpu-bridge.mjs) —
    // voir docs/superpowers/specs/2026-08-06-fondation-webgpu-tsl-design.md. Tous les
    // <script> classiques passent en `defer` pour s'exécuter dans le même ordre relatif
    // que le module (toujours différé).
    + '<script type="importmap">\n{"imports": {\n'
    + '  "three/webgpu": "./vendor-esm/three.webgpu.min.js",\n'
    + '  "three/tsl": "./vendor-esm/three.tsl.min.js"\n'
    + '}}\n</script>\n'
    + '<script type="module" src="render-webgpu-bridge.mjs"><\/script>\n'
    // UNE SEULE INSTANCE DE three.js : les addons (GLTFLoader, FBXLoader, TransformControls)
    // sont recompiles contre le THREE du pont (vendor/RECETTE-addons.md) et viennent donc
    // APRES lui. vendor/three.min.js, un second three complet, n'est plus charge.
    + '<script src="vendor/three-addons.min.js" defer><\/script>\n'
    // APRÈS le pont : les décodeurs lisent globalThis.THREE au chargement, et doivent
    // hériter des classes du paquet three/webgpu (celles que le WebGPURenderer
    // reconnaît), pas de celles du bundle classique. Un <script defer> et un module
    // s'exécutent dans l'ordre du document, donc la position suffit à le garantir.
    + (bundlesDecoders || []).map(function(b){
        return '<script src="' + b + '" defer><\/script>\n'; }).join('')
    + emb('vendor/cannon.js')
    + '<script type="module" src="asset-compression.js"><\/script>\n'
    + '<script type="module" src="game-ui.js"><\/script>\n'
    + emb('game-character.js')
    + emb('network-game.js')
    + emb('render-perf.js')
    // JAMAIS facultatif, et il manquait purement et simplement ici — dans la liste des sources
    // ET dans les balises. `rtUpdateShadows()` (game-runtime.js) commence par
    // `if(typeof ShadowFit === 'undefined') return;`, donc le cadrage des ombres directionnelles
    // ne tournait JAMAIS dans un jeu exporté : ombres justes dans l'aperçu ▶ Jouer
    // (game-preview.html le chargeait, lui) et cassées dans le ZIP, sans un seul message.
    // Voir docs/REVUE_2026-09-10.md § 1.1.
    + '<script type="module" src="lightmap-atlas.js"><\/script>\n'
    + '<script type="module" src="script-scope.js"><\/script>\n'
    + '<script type="module" src="script-library.js"><\/script>\n'
    + '<script type="module" src="camera-overlays.js"><\/script>\n'
    + '<script type="module" src="shadow-fit.js"><\/script>\n'
    + '<script type="module" src="dev-guards.js"><\/script>\n'
    + '<script type="module" src="load-retry.js"><\/script>\n'
    + emb('lightmap-rgbm.js')
    + emb('retargeting.js')
    + emb('humanoid-avatar.js')
    + emb('anim-markers.js')
    + emb('anim-blend.js')
    + emb('anim-asset.js')
    // Le socle à composants : jamais facultatif (pas de garde `typeof` possible, tout
    // Perdu au merge de main dans editor.html et ici en même temps (voir
    // docs/KNOWN_ISSUES.md) : restauré à l'identique de l'ordre d'avant le merge.
    // Les traitements d'import (hiérarchie, normales, tangentes, dépliage) : le jeu les REJOUE,
    // ils ne sont nulle part dans le fichier de projet. Jamais facultatif.
    + '<script type="module" src="model-import.js"><\/script>\n'
    // Les nœuds d'un modèle, objets de scène comme dans Unity : le jeu les expose et y repose
    // leurs overrides, comme l'éditeur. Jamais facultatif.
    + '<script type="module" src="model-nodes.js"><\/script>\n'
    + '<script type="module" src="raycast-candidates.js"><\/script>\n'
    + '<script type="module" src="component-data.js"><\/script>\n'
    // AVANT component.js : il porte `Registry` et `NodeShells`, que les composants lisent au
    // premier niveau pour s'y inscrire.
    + '<script type="module" src="component-registry.js"><\/script>\n'
    + '<script type="module" src="component.js"><\/script>\n'
    + '<script type="module" src="node.js"><\/script>\n'
    + '<script type="module" src="rigid-body.js"><\/script>\n'
    + '<script type="module" src="components/component-mesh.js"><\/script>\n'
    + '<script type="module" src="components/component-model.js"><\/script>\n'
    + '<script type="module" src="components/component-skinned-mesh.js"><\/script>\n'
    + '<script type="module" src="components/component-light.js"><\/script>\n'
    + '<script type="module" src="components/component-camera.js"><\/script>\n'
    + '<script type="module" src="components/component-collider.js"><\/script>\n'
    + '<script type="module" src="post-volume-blend.js"><\/script>\n'
    + '<script type="module" src="post-profile.js"><\/script>\n'
    + '<script type="module" src="components/component-postvolume.js"><\/script>\n'
    + '<script type="module" src="components/component-physics.js"><\/script>\n'
    + '<script type="module" src="components/component-terrain.js"><\/script>\n'
    + '<script type="module" src="components/component-particles.js"><\/script>\n'
    + '<script type="module" src="components/component-reflection.js"><\/script>\n'
    + '<script type="module" src="components/component-script.js"><\/script>\n'
    + '<script type="module" src="components/component-events.js"><\/script>\n'
    + '<script type="module" src="components/component-uidocument.js"><\/script>\n'
    + '<script type="module" src="components/component-animator.js"><\/script>\n'
    + '<script type="module" src="components/component-subscene.js"><\/script>\n'
    + '<script type="module" src="components/component-tag.js"><\/script>\n'
    + '<script type="module" src="components/component-audio.js"><\/script>\n'
    + '<script type="module" src="primitive-geometry.js"><\/script>\n'
    + '<script type="module" src="primitives-extra.js"><\/script>\n'
    + '<script type="module" src="synth.js"><\/script>\n'
    + '<script type="module" src="steam-bridge.js"><\/script>\n'
    + '<script type="module" src="locale.js"><\/script>\n'
    + '<script type="module" src="gamepad-input.js"><\/script>\n'
    + '<script type="module" src="touch-input.js"><\/script>\n'
    + '<script type="module" src="components/component-synth.js"><\/script>\n'
    + '<script type="module" src="components/component-touch-controls.js"><\/script>\n'
    + '<script type="module" src="components/component-sprite.js"><\/script>\n'
    + '<script type="module" src="components/component-anim-sprite.js"><\/script>\n'
    + '<script type="module" src="components/component-tilemap.js"><\/script>\n'
    + '<script type="module" src="components/component-physics-2d.js"><\/script>\n'
    + '<script type="module" src="components/component-camera-follow.js"><\/script>\n'
    + '<script type="module" src="components/component-team-color.js"><\/script>\n'
    + '<script type="module" src="fog-grid.js"><\/script>\n'
    + '<script type="module" src="components/component-fog-of-war.js"><\/script>\n'
    + '<script type="module" src="components/component-xr.js"><\/script>\n'
    + '<script type="module" src="xr-runtime.js"><\/script>\n'
    + '<script type="module" src="systems.js"><\/script>\n'
    + '<script type="module" src="plugin-host.js"><\/script>\n'
    + '<script type="module" src="systems/tilemap-system.js"><\/script>\n'
    + '<script type="module" src="systems/sprite-system.js"><\/script>\n'
    + '<script type="module" src="systems/fog-system.js"><\/script>\n'
    + '<script type="module" src="systems/camera-system.js"><\/script>\n'
    + '<script type="module" src="component-migration.js"><\/script>\n'
    + emb('animator.js')
    + emb('shader-graph.js')
    + emb('sprite-2d.js')
    + emb('anim-sprite.js')
    + emb('tilemap.js')
    + emb('physics-2d.js')
    + emb('world-2d.js')
    + emb('camera-framing.js')
    + '<script type="module" src="sky-camera.js"><\/script>\n'
    + '<script type="module" src="audio-falloff.js"><\/script>\n'
    + '<script type="module" src="audio-bus.js"><\/script>\n'
    + '<script type="module" src="chip-synth.js"><\/script>\n'
    + '<script type="module" src="music-loop.js"><\/script>\n'
    + '<script type="module" src="track-sampling.js"><\/script>\n'
    + '<script type="module" src="data.js"><\/script>\n'
    + '<script type="module" src="runtime.js"><\/script>\n'
    + '</body>\n</html>\n';
}

/** L'adresse du relais multijoueur à inscrire dans un build (origine http(s)), ou null. */
export function networkServerForBuild(){
  // Le réglage de projet d'abord (project.settings.network.server), puis l'ancien champ
  // `project.networkServer`, puis l'origine de l'éditeur.
  const net = (project && project.settings && project.settings.network) || null;
  const explicit = (net && net.server) || (project && project.networkServer) || '';
  if(/^https?:\/\//.test(explicit)) return explicit.replace(/\/+$/, '');
  return (typeof location !== 'undefined' && /^https?:$/.test(location.protocol)) ? location.origin : null;
}

/**
 * La config multijoueur inscrite dans un build : les réglages du projet, nettoyés, avec l'adresse
 * du serveur RÉSOLUE. Le jeu publié la relit par networkConfig() (js/network-game.js), qui
 * accepte aussi l'ancienne forme (une chaîne : l'adresse seule).
 */
export function networkConfigForBuild(){
  const raw = (project && project.settings && project.settings.network) || {};
  // Globale gardée : network-game.js est un module que le build sait retirer.
  const c = (typeof sanitizeNetworkSettings === 'function') ? sanitizeNetworkSettings(raw) : Object.assign({}, raw);
  return {
    server: networkServerForBuild(),
    transport: c.transport, gameKey: c.gameKey, maxPlayers: c.maxPlayers, sendRate: c.sendRate,
    replication: c.replication, p2pFallbackRelay: c.p2pFallbackRelay, iceServers: c.iceServers
  };
}

/**
 * Assemble les fichiers du build ({chemin -> Uint8Array}), sans rien télécharger ni envoyer.
 * PARTAGÉ par l'export .zip et par « Publier en ligne » : deux assemblages finiraient par publier
 * autre chose que ce qu'on exporte. Rend null si les sources de l'éditeur sont illisibles.
 */
export async function assembleBuild(){
  // vendor/three-addons.min.js : GLTFLoader, FBXLoader et TransformControls recompiles contre le
  // THREE du pont ESM (une seule instance de three.js — vendor/RECETTE-addons.md).
  // vendor-esm/*.min.js : WebGPURenderer/TSL (paquet npm three, pas de build UMD pour
  // ces modules) — voir docs/superpowers/specs/2026-08-06-fondation-webgpu-tsl-design.md.
  // js/asset-compression.js : le MÊME branchement de décodeurs que l'éditeur, pour que
  // le jeu publié lise exactement ce que l'éditeur a su importer.
  // buildDataProject() en premier : ce sont ses octets qui disent quels
  // décodeurs il faudra aller chercher.
  const data = await buildDataProject();
  // L'ESTAMPILLE DU BUILD : version du moteur et instant de la publication. Elle est posée ici
  // et non dans buildDataProject() parce qu'elle contient une DATE — le .p3d changerait à
  // chaque enregistrement sans qu'on ait rien modifié, et la fixture build-test/ cesserait d'être
  // reproductible. Un build est justement la seule chose qui mérite d'être datée.
  data.build = {
    engine: (typeof VERSION_ENGINE === 'string') ? VERSION_ENGINE : '?',
    date: new Date().toISOString().slice(0, 16).replace('T', ' '),
    visible: project.versionVisible !== false,
    // LE SERVEUR MULTIJOUEUR voyage avec le build. Sans lui, un jeu hébergé ailleurs (itch.io,
    // un hébergeur statique) cherchait le relais à SA PROPRE origine — « html-classic.itch.zone
    // /api/reseau/ws : 404 ». L'éditeur est servi par le cloud qui porte le relais : son origine
    // est donc la bonne adresse, sauf réglage explicite du projet (`project.settings.network.server`). Un OBJET depuis
    // v0.173 (transport, clé, joueurs max…) ; les anciens builds y portaient une chaîne.
    network: networkConfigForBuild()
  };
  const bundlesDecoders = decodersNeeded(data);

  // Les URL à télécharger : la table, plus les décodeurs que ce projet-là exige.
  //
  // Il n'y a PLUS d'index à tenir. Le nom de chaque fichier dans le ZIP est déduit de son URL
  // par `outputBuildModule` (voir BUILD_MODULES en tête de fichier), donc ajouter un module
  // n'importe où dans la table ne peut plus publier un fichier sous le nom d'un autre.
  const sources = BUILD_MODULES.map(function(m){ return m.src; }).concat(bundlesDecoders);
  let textes;
  try{
    textes = await Promise.all(sources.map(function(u){
      return fetch(u).then(function(r){
        if(!r.ok) throw new Error(u + ' : ' + r.status);
        return r.text();
      });
    }));
  } catch(e){
    return null;
  }

  // L'ALLÈGEMENT EST UN FILTRE À LA FIN, et pas une liste de sources plus courte : télécharger un
  // fichier qu'on ne publiera pas ne coûte rien (l'éditeur les lit en local), et la page publiée
  // et le ZIP doivent être filtrés par le MÊME `trimming` pour rester d'accord.
  const trimming = trimmingBuild(data);

  // La table du ZIP se DÉDUIT de `BUILD_MODULES`, par construction : plus aucune correspondance
  // nom↔index à écrire ni à vérifier à la main.
  const files = {
    'index.html': fflate.strToU8(pageIndexBuild(project.name || 'Jeu', bundlesDecoders, trimming)),
    'data.js':    fflate.strToU8('window.GAME_DATA = ' + JSON.stringify(data) + ';\n')
  };
  BUILD_MODULES.forEach(function(m, i){ files[outputBuildModule(m)] = fflate.strToU8(textes[i]); });
  // les décodeurs gardent leur chemin vendor/… : c'est celui qu'écrit pageIndexBuild
  bundlesDecoders.forEach(function(b, i){
    files[b] = fflate.strToU8(textes[BUILD_MODULES.length + i]);
  });

  // L'allègement : retirer du ZIP ce que la page ne demande plus. Les deux doivent être d'accord,
  // sinon on publie soit un 404 (balise sans fichier), soit du poids mort (fichier sans balise).
  let bytesRetires = 0;
  (trimming ? trimming.retires : []).forEach(function(r){
    if(files[r.dans]) bytesRetires += files[r.dans].length;
    delete files[r.dans];
  });

  return { files, retires: (trimming ? trimming.retires : []), bytesRetires };
}

// CE QUI A ÉTÉ RETIRÉ EST DIT, avec la raison. Un allègement silencieux serait la pire version de
// cette fonctionnalité : le jour où il se trompe, personne ne saurait qu'il a retiré quelque chose,
// et on chercherait la panne dans le jeu.
function trimmingNote(build){
  return build.retires.length
    ? '. Allégé de ' + Math.round(build.bytesRetires/1024) + ' Ko : '
      + build.retires.map(function(r){ return r.pourquoi; }).join(', ') + ' — inutilisés par cette scène.'
    : '';
}

// Le message d'un export tenté depuis file:// : les modules de l'éditeur ne peuvent pas être relus.
const FILE_PROTOCOL_MESSAGE = 'Export impossible en file:// — servez l’éditeur via un serveur local '
  + '(ex. python -m http.server) puis réessayez';

export async function exportBuildWeb(){
  setStatus('Préparation du build Web…');
  const build = await assembleBuild();
  if(!build){ setStatus(FILE_PROTOCOL_MESSAGE, 7000); return; }
  const zip = fflate.zipSync(build.files, {level:6});
  const blob = new Blob([zip], {type:'application/zip'});
  telecharger(blob, slugFile(project.name) + '-build.zip');
  setStatus('🎮 Build Web exporté (' + Math.round(blob.size/1024) + ' Ko) — dézippez et ouvrez '
    + 'index.html' + trimmingNote(build), 9000);
}

/**
 * L'EXPORT BUREAU : le même jeu, dans un projet Electron prêt à compiler.
 *
 * Le jeu va dans un sous-dossier, et l'enveloppe autour — voir js/build-desktop.js pour
 * pourquoi Electron plutôt que Tauri, et pourquoi un protocole maison plutôt que `file://`.
 *
 * L'éditeur ne produit PAS d'exécutable, et ne prétend pas le faire : il tourne dans un onglet,
 * et compiler demande de lancer des processus. Il produit les deux commandes qui le font, et le
 * message de fin les rappelle.
 */
export async function exportBuildDesktop(){
  const z = await desktopZip();
  if(!z) return;
  setStatus('🖥 Projet bureau exporté (' + Math.round(z.blob.size/1024) + ' Ko) — dézippez, puis '
    + '« npm install » et « npm run dist » pour obtenir l\'exécutable. Lisez LISEZMOI.md avant '
    + 'de livrer : signature et versions épinglées'
    + trimmingNote(z.build), 12000);
}

/**
 * Le zip du projet Electron, téléchargé. Partagé par l'export bureau et la compilation
 * (js/desktop-compiler.js) : le lanceur compile EXACTEMENT ce zip-là.
 */
async function desktopZip(){
  setStatus('Préparation du build bureau…');
  const b = await assembleBuild();
  if(!b){ setStatus(FILE_PROTOCOL_MESSAGE, 7000); return null; }

  const name = project.name || 'Jeu';
  // LE MÊME JEU QUE LA SORTIE WEB, aux octets près : c'est `assembleBuild` qui le dit, et
  // c'est ce qui garantit qu'un défaut corrigé d'un côté l'est de l'autre.
  const files = {};
  Object.keys(b.files).forEach(function(k){ files[DESKTOP_GAME_DIR + '/' + k] = b.files[k]; });
  // La table d'entrées du projet donne les actions déclarées à Steam Input (js/build-desktop.js).
  const settings = project.settings || {};
  const enveloppe = desktopWrapperFiles(name, {inputs: project.inputs || null,
                                                  studio: settings.studio,
                                                  signingSubject: settings.signingSubject});
  Object.keys(enveloppe).forEach(function(k){ files[k] = fflate.strToU8(enveloppe[k]); });

  const zip = fflate.zipSync(files, {level:6});
  const blob = new Blob([zip], {type:'application/zip'});
  const slug = slugFile(name).slice(0, 64).replace(/-+$/, '') || 'jeu';
  telecharger(blob, slug + '-bureau.zip');
  return {blob: blob, slug: slug, build: b};
}

// Le lanceur pyrox-build:// est-il installé sur CETTE machine ? Le navigateur ne peut pas le
// demander à Windows : on retient seulement que l'installeur a été fourni.
const KEY_COMPILER = 'pyrox-build-installed';
function compilerInstalled(){
  // La VERSION du lanceur, pas un oui/non : un lanceur plus ancien ne connaît pas toutes les
  // cibles, et l'éditeur repropose l'installeur.
  try { return Number(localStorage.getItem(KEY_COMPILER)) >= DESKTOP_BUILD_HANDLER_VERSION; } catch(e){ return false; }
}

/** Télécharge l'installeur du lanceur (une fois par machine). */
export function downloadDesktopCompilerInstaller(){
  const blob = new Blob([windowsCompilerInstaller()], {type:'application/octet-stream'});
  telecharger(blob, DESKTOP_BUILD_INSTALLER_NAME);
  try { localStorage.setItem(KEY_COMPILER, String(DESKTOP_BUILD_HANDLER_VERSION)); } catch(e){ /* stockage bloqué */ }
  setStatus('Ouvrez ' + DESKTOP_BUILD_INSTALLER_NAME + ' (double-clic, une seule fois), puis relancez '
    + 'Exporter → Exécutable Windows.', 12000);
}

/**
 * « Exécutable Windows » : le zip bureau, puis le lien pyrox-build:// qui le fait compiler sur
 * cette machine par electron-builder — signé si un certificat est réglé dans le projet.
 */
export function compileDesktopWindows(){ return compileDesktop('compile'); }

/**
 * « Dossier Steam » : la même compilation, SANS installeur — `dist/win-unpacked`, à envoyer tel
 * quel par SteamPipe. Steam installe les fichiers lui-même : ni SmartScreen ni signature exigée.
 */
export function compileDesktopSteam(){ return compileDesktop('steam'); }

async function compileDesktop(target){
  if(!/Windows/i.test(navigator.userAgent || '')){
    setStatus('La compilation en un clic est réservée à Windows : utilisez « Projet bureau (.zip) ».', 8000);
    return;
  }
  if(!compilerInstalled()){
    if(confirm('Pour compiler, PyroxEngine installe une fois un petit lanceur sur ce PC '
      + '(lien pyrox-build://, sans droits administrateur).\n\nTélécharger l\'installeur ?')){
      downloadDesktopCompilerInstaller();
    }
    return;
  }
  const z = await desktopZip();
  if(!z) return;
  const a = document.createElement('a');
  a.href = compileUrl(z.slug, target);
  a.click();
  if(target === 'steam'){
    setStatus('🎮 Compilation Steam lancée dans une fenêtre Windows — à la fin, envoyez le dossier '
      + 'win-unpacked qui s\'ouvre avec SteamPipe. Rien ne s\'ouvre ? Réinstallez le lanceur (Exporter).', 14000);
    return;
  }
  const signed = !!(project.settings && project.settings.signingSubject);
  setStatus('🖥 Compilation lancée dans une fenêtre Windows — l\'exe arrive dans le dossier qui '
    + 's\'ouvrira à la fin.' + (signed ? '' : ' ⚠ Non signé : réglez « Certificat de signature » '
    + 'dans Paramètres du projet.') + ' Rien ne s\'ouvre ? Réinstallez le lanceur (Exporter).', 14000);
}

/** Un blob proposé au téléchargement. Partagé par les deux exports. */
export function telecharger(blob, fileName){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  setTimeout(function(){ URL.revokeObjectURL(a.href); }, 5000);
}

/**
 * « Publier en ligne » : construit le jeu et l'envoie au cloud, qui le sert derrière un lien.
 * Aucun .zip à manipuler. Un projet déjà publié est republié à SON lien (le serveur le retrouve
 * par projet) : le lien déjà envoyé reste bon. Réservé à un projet hébergé (project.cloud).
 */
export async function publishBuildToCloud(){
  if(!project.cloud || !project.cloud.id){
    setStatus('Publier en ligne demande un projet hébergé — ouvrez-le depuis votre tableau de bord.', 7000);
    return null;
  }
  setStatus('Publication : construction du jeu…');
  const build = await assembleBuild();
  if(!build){ setStatus('Publication impossible : sources de l\'éditeur illisibles.', 7000); return null; }
  const zip = fflate.zipSync(build.files, {level:6});
  setStatus('Publication : envoi (' + Math.round(zip.length/1024) + ' Ko)…');
  let r;
  try {
    const rep = await fetch('/api/projets/' + project.cloud.id + '/publier', {
      method: 'POST', credentials: 'include',
      // Un en-tête HTTP est en ASCII : le titre part encodé, le serveur le décode.
      headers: { 'content-type': 'application/zip', 'x-titre': encodeURIComponent(project.name || 'Jeu') },
      body: zip
    });
    r = await rep.json().catch(function(){ return {}; });
    if(!rep.ok) throw new Error(r.erreur || ('HTTP ' + rep.status));
  } catch(e){
    setStatus('Publication impossible : ' + e.message, 9000);
    return null;
  }
  setStatus('🌐 Jeu publié (version ' + r.version + ') : ' + r.url + trimmingNote(build), 15000);
  return r;
}
