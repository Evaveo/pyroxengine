// ---------- Audio (P1-2) ----------
// Assets audio (🔊, import .mp3/.wav/.ogg/.m4a) + source audio par objet
// (userData.audio = {asset, volume, loop, auto, spatial, portee, pitch}).
// Les sources jouent en mode lecture (et dans les builds Web via game-runtime.js).
// Scripts : api.playSound(name, volume?) et api.audio(cible?).play()/stop()/volume(v).
// modele:'inverse' reste le defaut, et c'est DELIBERE : c'est le modele du Web Audio et celui de tous
// les projets deja regles a l'oreille. Passer 'lineaire' par defaut ferait taire des sons que quelqu'un
// avait choisi d'entendre. On l'offre et on explique lequel prendre — voir js/audio-falloff.js.
import { assetId, assets, folderCurrent, nextAssetId, updateProject } from './assets.js';
import { busOfSource, createAudioBuses, createSourceSound, sanitizeAudioBuses } from './audio-bus.js';
import { setFalloffAudio } from './audio-falloff.js';
import { normalizeSfx, sfxBuffer, sfxDuration } from './chip-synth.js';
import { isPlayableAudio } from './component-data.js';
import { loopBuffer, loopDuration, normalizeLoop } from './music-loop.js';
import { Registry } from './component-registry.js';
import { logConsole } from './console.js';
import { setStatus } from './hierarchy.js';
import { pushHistory } from './history.js';
import { markProjectUnsaved } from './project-dirty.js';
import { ensureParamsImport, refreshInspectorAsset, setDefaultsAudio } from './import-settings.js';
import { buildInspector } from './inspector.js';
import { isSceneObject } from './objects.js';
import { writeAssetInFolder } from './project-folder.js';
import { project } from './project.js';
import { camEditor } from './scene.js';
import { selection } from './selection.js';
import { loop } from './viewport.js';

export const AUDIO_DEFAULT = {asset:null, volume:1, loop:false, auto:true, spatial:true, range:10, pitch:1,
                      distanceMax:100, rolloff:1, model:'inverse', bus:'sfx'};

export const engineAudio = {
  listener: null,   // THREE.AudioListener sur la caméra éditeur
  sources: [],      // sources du mode lecture — {obj, son}
  ponctuels: [],    // one-shots (api.playSound, événements, button Écouter)
  preview: null,     // aperçu du panneau Projet — {son, assetId}
  buses: null        // les bus de mixage (js/audio-bus.js), créés avec le listener
};

export function ensureListenerAudio(){
  if(!engineAudio.listener){
    engineAudio.listener = new THREE.AudioListener();
    camEditor.add(engineAudio.listener);
    engineAudio.buses = createAudioBuses(engineAudio.listener.context, engineAudio.listener.getInput(),
                                         projectAudioBuses());
  }
  // les navigateurs suspendent l'AudioContext jusqu'au premier geste utilisateur
  if(engineAudio.listener.context.state === 'suspended') engineAudio.listener.context.resume();
  return engineAudio.listener;
}

/** Les volumes de bus réglés dans le projet ouvert (absents : `createAudioBuses` pose ses défauts). */
function projectAudioBuses(){
  return (project && project.settings) ? project.settings.audioBuses : null;
}

/** Le mélange de l'éditeur : les trois bus, créés au premier besoin avec le listener. */
export function audioMix(){
  ensureListenerAudio();
  return engineAudio.buses;
}

/**
 * Revient au mélange voulu par l'auteur : volumes relus dans les réglages du projet, sourdines levées.
 *
 * Appelé au VRAI lancement d'une partie et à son arrêt — pas au changement de scène, où un script qui a
 * coupé la musique s'attend à ce qu'elle le reste. Sans ça, un `api.audioBus('music').volume(0)` joué
 * pendant une partie survivrait dans l'éditeur, et l'aperçu d'un son de musique resterait muet.
 */
export function resetAudioMix(){
  if(!engineAudio.buses) return;
  engineAudio.buses.apply(projectAudioBuses());
  engineAudio.buses.resetMutes();
}

// ---------- assets ----------
export function decodeAssetAudio(a){
  // Un bruitage n'a pas de fichier à décoder : son son se CALCULE depuis sa recette.
  if(a && a.kind === 'sfx') return Promise.resolve(renderAssetSfx(a));
  if(a && a.kind === 'musicLoop') return Promise.resolve(renderAssetLoop(a));
  const listener = ensureListenerAudio();
  return a.file.arrayBuffer().then(function(buf){
    return new Promise(function(res, rej){
      listener.context.decodeAudioData(buf, res, rej);
    });
  }).then(function(buffer){
    a.buffer = buffer;
    a.duration = buffer.duration;
    return buffer;
  }).catch(function(e){
    setStatus('Audio « ' + a.name + ' » illisible : ' + ((e && e.message) || e), 4000);
    return null;
  });
}

export function createAssetAudio(file, opts){
  // opts.name : name relu d'un projet (l'asset a pu être renommé après l'import)
  const a = {id:'a'+(nextAssetId()), kind:'audio', name:(opts && opts.name) || file.name, file:file,
             buffer:null, duration:0, folder:folderCurrent,
             paramsImport:(opts && opts.paramsImport) || null};
  assets.push(a);
  if(!(opts && opts.noRefresh)) updateProject();   // voir createAssetTexture (js/assets.js)
  decodeAssetAudio(a);
  if(project.handleFolder){
    writeAssetInFolder(project.handleFolder, a)
      .catch(function(e){ setStatus('Asset créé en mémoire mais pas écrit sur le disque : ' + e.message, 5000); });
  }
  return a;
}

export function assetAudioById(id){
  return assets.find(function(x){ return x.id === id && isPlayableAudio(x); }) || null;
}

// ---------- bruitages calculés (asset `sfx`, js/chip-synth.js) ----------

/**
 * (Re)calcule le son d'un bruitage depuis sa recette. Appelé à la création, au chargement, à chaque
 * modification et après une annulation (history.js:reapplyAsset) — le `buffer` n'est jamais
 * enregistré, il se déduit toujours de la recette.
 */
export function renderAssetSfx(a){
  if(!a || a.kind !== 'sfx') return null;
  a.recipe = normalizeSfx(a.recipe);
  a.duration = sfxDuration(a.recipe);
  // Sans contexte audio (navigateur qui le refuse, harnais de test), l'asset garde sa recette et sa
  // durée : il reste enregistrable et éditable, il ne se joue simplement pas encore.
  try { a.buffer = sfxBuffer(ensureListenerAudio().context, a.recipe); }
  catch(e){ a.buffer = null; }
  return a.buffer;
}

/** Un nouvel asset bruitage. Son fichier `.sfx.json` s'écrit à l'enregistrement du projet. */
export function createAssetSfx(recipe, opts){
  const o = opts || {};
  const n = assets.filter(function(x){ return x.kind === 'sfx'; }).length + 1;
  const a = {id:'a'+(nextAssetId()), kind:'sfx', name:o.name || ('Bruitage ' + n),
             folder:(o.folder !== undefined) ? o.folder : folderCurrent,
             recipe:normalizeSfx(recipe), buffer:null, duration:0};
  renderAssetSfx(a);
  assets.push(a);
  if(!o.silent) updateProject();
  return a;
}

// ---------- boucles musicales (asset `musicLoop`, js/music-loop.js) ----------
// Même contrat que les bruitages : l'asset ne garde que sa recette, le son s'en déduit toujours.

export function renderAssetLoop(a){
  if(!a || a.kind !== 'musicLoop') return null;
  a.recipe = normalizeLoop(a.recipe);
  a.duration = loopDuration(a.recipe);
  try { a.buffer = loopBuffer(ensureListenerAudio().context, a.recipe); }
  catch(e){ a.buffer = null; }
  return a.buffer;
}

export function createAssetLoop(recipe, opts){
  const o = opts || {};
  const n = assets.filter(function(x){ return x.kind === 'musicLoop'; }).length + 1;
  const a = {id:'a'+(nextAssetId()), kind:'musicLoop', name:o.name || ('Boucle ' + n),
             folder:(o.folder !== undefined) ? o.folder : folderCurrent,
             recipe:normalizeLoop(recipe), buffer:null, duration:0};
  renderAssetLoop(a);
  assets.push(a);
  if(!o.silent) updateProject();
  return a;
}

export function setLoopRecipe(a, recipe, opts){
  if(!a || a.kind !== 'musicLoop') return null;
  if(!(opts && opts.noHistory)) pushHistory({assetOnly: true});
  a.recipe = normalizeLoop(recipe);
  renderAssetLoop(a);
  return a;
}

/**
 * Remplace la recette d'un bruitage et le recalcule. `pushHistory` d'abord : l'historique photographie
 * la recette (un objet simple), donc Ctrl+Z la rend — et `reapplyAsset` recalcule le son.
 */
export function setSfxRecipe(a, recipe, opts){
  if(!a || a.kind !== 'sfx') return null;
  if(!(opts && opts.noHistory)) pushHistory({assetOnly: true});
  a.recipe = normalizeSfx(recipe);
  renderAssetSfx(a);
  return a;
}

// ---------- attachement à un objet ----------
export function ensureAudio(o){
  if(!o.userData.audio) o.userData.audio = JSON.parse(JSON.stringify(AUDIO_DEFAULT));
  return o.userData.audio;
}

export function attachAudioAsset(asset, root){
  if(!root || !isSceneObject(root)){
    setStatus('Déposez le son sur un objet de la scène', 3000);
    return;
  }
  pushHistory();
  const ua = ensureAudio(root);
  ua.asset = asset.id;
  setDefaultsAudio(asset, ua);   // volume/loop/spatial/portée/pitch de l'asset
  // LE COMPOSANT EST POSÉ AUSSI. Le glisser-déposer écrivait `userData.audio` et rien d'autre : depuis
  // que la source audio est un composant, un objet sonorisé au glisser n'aurait eu aucune section dans
  // l'inspecteur — il jouerait son son sans qu'on puisse ni le voir ni le régler. `addComponent`
  // retrouve le sac déjà posé ci-dessus, donc les défauts de l'asset ne sont pas écrasés.
  // Une BOUCLE MUSICALE se pose en musique de fond : en boucle, partout au même volume, sur le bus
  // Musique. Les défauts d'une source (un bruit ponctuel et spatial) la feraient jouer une fois, et
  // seulement près de l'objet.
  applyKindDefaultsAudio(asset, ua);
  if(root.addComponent && !root.getComponent('AudioSource')) root.addComponent('AudioSource', ua);
  if(root === selection) buildInspector();
  setStatus('Son « ' + asset.name + ' » attaché à ' + root.name
    + ' — réglages dans l\'inspector', 3000);
}

/**
 * Les réglages qu'un GENRE d'asset impose à sa source. Une boucle musicale se pose en musique de
 * fond (en boucle, partout, bus Musique). Un autre genre qui REMPLACE une boucle sur la même source
 * reprend les défauts d'une source : sans ça, un bruitage glissé sur l'objet d'une musique jouait en
 * boucle, non spatialisé, sur le bus Musique (revue du 2026-09-29, § 3.7). Appelé au glisser-déposer,
 * au choix du son dans l'inspecteur et par `configure_audio`.
 */
export function applyKindDefaultsAudio(asset, ua){
  if(!asset || !ua) return ua;
  if(asset.kind === 'musicLoop'){ ua.loop = true; ua.spatial = false; ua.bus = 'music'; }
  else if(ua.bus === 'music' && ua.loop === true && ua.spatial === false){
    ua.loop = AUDIO_DEFAULT.loop; ua.spatial = AUDIO_DEFAULT.spatial; ua.bus = AUDIO_DEFAULT.bus;
  }
  return ua;
}

/**
 * LA porte d'écriture des volumes de bus : le panneau Paramètres du projet, le mixeur MX-3 et le
 * copilote passent par ici. Trois copies avaient trois comportements — celle du copilote ne marquait
 * pas le projet modifié, et le mixage réglé pouvait être perdu (revue du 2026-09-29, § 3.3 et § 6.6).
 * Rend les volumes effectifs.
 */
export function setProjectBusVolumes(patch){
  if(!project || !project.settings) return null;
  const next = sanitizeAudioBuses(project.settings.audioBuses);
  Object.keys(patch || {}).forEach(function(k){ if(next[k] !== undefined) next[k] = patch[k]; });
  project.settings.audioBuses = sanitizeAudioBuses(next);
  if(engineAudio.buses) engineAudio.buses.apply(project.settings.audioBuses);
  if(typeof autosave !== 'undefined' && autosave) autosave.modifie = true;
  if(typeof markProjectUnsaved === 'function') markProjectUnsaved();
  return project.settings.audioBuses;
}

/**
 * Un nom de fichier LIBRE dans le dossier d'assets `folder` : `saut.wav`, sinon `saut-2.wav`… Un
 * export WAV écrivait toujours le même nom et écrasait sur le disque un export précédent ou un vrai
 * fichier importé ; deux assets partageaient alors un fichier (revue du 2026-09-29, § 1.4).
 */
export function freeAudioFileName(folder, base, ext){
  const taken = new Set();
  assets.forEach(function(a){
    if((a.folder || '') !== (folder || '')) return;
    if(a.file && a.file.name) taken.add(a.file.name.toLowerCase());
    (a.paquet || []).forEach(function(f){ if(f && f.name) taken.add(f.name.toLowerCase()); });
  });
  let name = base + ext, i = 2;
  while(taken.has(name.toLowerCase())) name = base + '-' + (i++) + ext;
  return name;
}

// ---------- lecture (mode game / simulation) ----------
// Porteurs d'une source audio, lus au Registry : avant, toute la scène était parcourue pour
// trouver les quelques objets qui portent un son.
export function nodesAudio(){
  return Registry.activeNodes('AudioSource');
}

export function startAudioGame(){
  stopAudioGame();
  const listener = ensureListenerAudio();
  nodesAudio().forEach(function(o){
    const ua = o.userData.audio;
    if(!ua || !ua.asset) return;
    const a = assetAudioById(ua.asset);
    if(!a || !a.buffer){
      if(a && !a.buffer) logConsole('warn', 'audio « ' + a.name + ' » pas encore décodé', o);
      return;
    }
    // La construction, l'atténuation (js/audio-falloff.js), le bus et le lancement : la MÊME
    // fonction que le jeu publié (js/audio-bus.js). Une divergence de son ne se voit pas — elle
    // s'entend, plus tard, chez le joueur.
    const son = createSourceSound(THREE, listener, ua, a.buffer, engineAudio.buses, setFalloffAudio,
      function(m){ logConsole('warn', m, o); });
    o.add(son);
    engineAudio.sources.push({obj:o, son:son});
  });
}

export function stopAudioGame(){
  engineAudio.sources.forEach(function(s){
    try{ if(s.son.isPlaying) s.son.stop(); } catch(e){}
    if(s.son.parent) s.son.parent.remove(s.son);
  });
  engineAudio.sources = [];
  engineAudio.ponctuels.forEach(function(son){
    try{ if(son.isPlaying) son.stop(); } catch(e){}
  });
  engineAudio.ponctuels = [];
}

export function sourceAudioOf(obj){
  const s = engineAudio.sources.find(function(x){ return x.obj === obj; });
  return s ? s.son : null;
}

// one-shot 2D — utilisé par api.playSound et l'action d'événement « Jouer le son… ».
// `bus` : `sfx` par défaut — un son ponctuel est presque toujours un bruitage.
export function playSoundGlobal(nameAsset, volume, obj, bus){
  const a = assets.find(function(x){ return isPlayableAudio(x) && x.name === nameAsset; });
  if(!a || !a.buffer){
    logConsole('warn', 'api.playSound : audio « ' + nameAsset + ' » introuvable ou pas décodé', obj || null);
    return null;
  }
  const son = new THREE.Audio(ensureListenerAudio());
  son.setBuffer(a.buffer);
  son.setVolume(volume !== undefined ? volume : 1);
  engineAudio.buses.route(son, bus || 'sfx');
  son.play();
  // purge des one-shots terminés au fil de l'eau
  engineAudio.ponctuels = engineAudio.ponctuels.filter(function(s){ return s.isPlaying; });
  engineAudio.ponctuels.push(son);
  return son;
}

// ---------- audition (Rack sonore) ----------
// Le rack REJOUE le son à chaque réglage : une audition coupe la précédente au lieu de s'y empiler,
// sinon dix réglages rapides joueraient dix bruitages superposés. Comme l'aperçu du panneau Projet,
// elle ne passe par aucun bus — on écoute le son lui-même, pas le mélange.
let _audition = null;
let _loopAudition = null;   // {src, buffer, startedAt} — la boucle du BX-16 en cours d'écoute

/**
 * Joue une boucle SANS FIN, et remplace son contenu sans perdre la mesure : la nouvelle version
 * reprend à la même position. C'est ce qui permet d'éditer la grille pendant que la boucle tourne.
 * Web Audio brut plutôt qu'un `THREE.Audio` : il faut connaître la position de lecture.
 */
export function auditionLoop(buffer){
  const ctx = ensureListenerAudio().context;
  let offset = 0;
  if(_loopAudition){
    const old = _loopAudition;
    offset = ((ctx.currentTime - old.startedAt) % old.buffer.duration) / old.buffer.duration * buffer.duration;
    try{ old.src.stop(); } catch(e){}
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  src.connect(engineAudio.listener.getInput());
  src.start(0, offset);
  _loopAudition = {src: src, buffer: buffer, startedAt: ctx.currentTime - offset};
  return _loopAudition;
}

export function stopLoopAudition(){
  if(_loopAudition){ try{ _loopAudition.src.stop(); } catch(e){} }
  _loopAudition = null;
}

/** La position de lecture de la boucle écoutée, en secondes, ou -1 si rien ne joue. */
export function loopAuditionPosition(){
  if(!_loopAudition) return -1;
  const ctx = engineAudio.listener.context;
  return (ctx.currentTime - _loopAudition.startedAt) % _loopAudition.buffer.duration;
}

export function auditionBuffer(buffer){
  if(_audition){ try{ if(_audition.isPlaying) _audition.stop(); } catch(e){} _audition = null; }
  if(!buffer) return null;
  const son = new THREE.Audio(ensureListenerAudio());
  son.setBuffer(buffer);
  son.play();
  _audition = son;
  return son;
}

// ---------- aperçu (panneau Projet et inspecteur) ----------
export function stopPreviewAudio(){
  if(!engineAudio.preview) return;
  try{ if(engineAudio.preview.son.isPlaying) engineAudio.preview.son.stop(); } catch(e){}
  engineAudio.preview = null;
  updateProject();
  refreshInspectorAsset();
}

export function togglePreviewAudio(a){
  if(engineAudio.preview && engineAudio.preview.assetId === a.id){ stopPreviewAudio(); return; }
  stopPreviewAudio();
  if(!a.buffer){
    decodeAssetAudio(a).then(function(b){ if(b) togglePreviewAudio(a); });
    return;
  }
  // L'APERÇU NE PASSE PAS PAR LES BUS, à dessein : on écoute un asset pour savoir ce qu'il contient.
  // Un bus « Musique » baissé à zéro rendrait l'aperçu muet, et on croirait le fichier vide.
  const son = new THREE.Audio(ensureListenerAudio());
  son.setBuffer(a.buffer);
  // l'aperçu utilise les réglages d'import de l'asset
  const pa = ensureParamsImport(a);
  if(pa){
    son.setVolume(pa.volume);
    son.setPlaybackRate(pa.pitch || 1);
  }
  son.onEnded = function(){
    this.isPlaying = false;
    if(engineAudio.preview && engineAudio.preview.son === this){
      engineAudio.preview = null;
      updateProject();
      refreshInspectorAsset();
    }
  };
  son.play();
  engineAudio.preview = {son:son, assetId:a.id};
  updateProject();
  refreshInspectorAsset();
}

// écoute la source audio de l'objet sélectionné avec ses réglages (hors mode game)
export function testAudioSelection(){
  if(!selection || !selection.userData.audio) return;
  const ua = selection.userData.audio;
  const a = assetAudioById(ua.asset);
  if(!a){ setStatus('Aucun asset audio lié', 2500); return; }
  function go(){
    const son = playSoundGlobal(a.name, ua.volume, selection, busOfSource(ua));
    if(son) son.setPlaybackRate(ua.pitch || 1);
  }
  if(a.buffer) go();
  else decodeAssetAudio(a).then(function(b){ if(b) go(); });
}


// EXPOSÉ EN GLOBALE, à dessein. Ces symboles sont appelés depuis des fichiers
// que les mêmes pages ne chargent pas toutes : un `import` y pointerait un
// fichier absent, et la page ne démarrerait pas. Ils gardent donc leur garde
// `typeof` côté appelant, et se déclarent ici.
globalThis.ensureAudio = ensureAudio;
globalThis.renderAssetSfx = renderAssetSfx;
globalThis.renderAssetLoop = renderAssetLoop;
globalThis.resetAudioMix = resetAudioMix;
globalThis.stopLoopAudition = stopLoopAudition;
globalThis.sourceAudioOf = sourceAudioOf;