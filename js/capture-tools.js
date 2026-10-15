// moteur/js/capture-tools.js
//
// CAPTURES ET VIDÉO DE GAMEPLAY depuis « ▶ Jouer » — pour la fiche catalogue du cloud (couverture,
// captures 16:9, vidéo de 10 à 30 s). Chargé par game-preview.html SEULEMENT : un jeu publié n'a ni
// ces touches ni ce code. Aucune ligne dans la boucle de js/game-runtime.js.
//
//   F8 : capture 1920×1080 (recadrée au centre en 16:9), WebP sous 2 Mo — la limite du catalogue.
//   F9 : démarre / arrête l'enregistrement en WebM (le seul format retenu),
//        arrêt automatique à 30 s, son du jeu compris.
//
// CE QUE LE JOUEUR VOIT, interface comprise. Le HUD, les menus, les textes du jeu sont du HTML posé
// sur la toile : enregistrer la toile seule les perdait (signalé le 2026-10-15). On capture donc
// L'ONGLET par le navigateur (getDisplayMedia, onglet courant) : au premier F8/F9, le navigateur
// demande l'autorisation, puis le flux sert à toutes les captures de la session — son de l'onglet
// compris. Refusé ou indisponible : repli sur la toile seule, en le disant.

export const CAPTURE_SIZE = [1920, 1080];
export const CAPTURE_MAX_BYTES = 2 * 1024 * 1024;
export const VIDEO_MAX_SECONDS = 30;

/** Le rectangle source qui recadre une toile `w × h` au rapport `rw:rh`, centré. */
export function coverCrop(w, h, rw, rh){
  const target = rw / rh;
  if(w / h > target){ const cw = Math.round(h * target); return {x: Math.round((w - cw) / 2), y: 0, w: cw, h: h}; }
  const ch = Math.round(w / target);
  return {x: 0, y: Math.round((h - ch) / 2), w: w, h: ch};
}

/** Nom de fichier : `<jeu>-<genre>-AAAAMMJJ-HHMMSS.<ext>`, sans caractère interdit. */
export function captureFileName(title, kind, ext, date){
  const d = date || new Date();
  const p = function(n){ return String(n).padStart(2, '0'); };
  const slug = String(title || 'jeu').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'jeu';
  return slug + '-' + kind + '-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate())
    + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + '.' + ext;
}

/** Le format vidéo : WebM seulement (choix du 2026-10-15), le meilleur codec disponible. */
export function videoFormats(isSupported){
  const webm = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
    .find(function(t){ return isSupported(t); });
  return webm ? [{mime: webm, ext: 'webm'}] : [];
}

// ---------- Ce qui suit touche le navigateur ----------

// Ce qui ne doit pas apparaître dans une capture : le badge de ce module et le bouton plein écran de
// l'aperçu. Masqués le temps d'une capture et de tout un enregistrement ; l'état passe alors par le
// titre de l'onglet, hors de l'image.
const HIDE_CLASS = 'capture-hide-tools';
function hideTools(on){
  if(!document.getElementById('capture-tools-style')){
    const st = document.createElement('style');
    st.id = 'capture-tools-style';
    st.textContent = 'body.' + HIDE_CLASS + ' #rj-full-screen, body.' + HIDE_CLASS + ' #capture-badge{display:none !important}';
    document.head.appendChild(st);
  }
  document.body.classList.toggle(HIDE_CLASS, !!on);
}

let badge = null;
function showCaptureBadge(text, ms){
  if(!badge){
    badge = document.createElement('div');
    badge.id = 'capture-badge';
    badge.style.cssText = 'position:fixed;right:10px;top:10px;z-index:99999;font:13px system-ui,sans-serif;'
      + 'color:#fff;background:#000b;padding:5px 10px;border-radius:6px;pointer-events:none';
    document.body.appendChild(badge);
  }
  badge.textContent = text;
  badge.style.display = '';
  clearTimeout(badge._t);
  if(ms) badge._t = setTimeout(function(){ badge.style.display = 'none'; }, ms);
}

function download(blob, name){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

function nextFrames(n){
  return new Promise(function(resolve){
    const step = function(){ if(--n <= 0) resolve(); else requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
}

// LE FLUX DE L'ONGLET, demandé au premier besoin puis gardé. null = refusé ou indisponible ; un
// partage arrêté (bouton du navigateur) sera redemandé à la capture suivante.
let tab = null;   // {stream, video}
async function tabStream(){
  if(tab && tab.stream.getVideoTracks().some(function(t){ return t.readyState === 'live'; })) return tab;
  tab = null;
  const md = globalThis.navigator && navigator.mediaDevices;
  if(!md || !md.getDisplayMedia) return null;
  try {
    const stream = await md.getDisplayMedia({
      video: {displaySurface: 'browser', frameRate: 60},
      audio: true,
      preferCurrentTab: true, selfBrowserSurface: 'include', surfaceSwitching: 'exclude', systemAudio: 'include'
    });
    const video = document.createElement('video');
    video.muted = true; video.playsInline = true; video.srcObject = stream;
    await video.play();
    tab = {stream: stream, video: video};
    stream.getVideoTracks()[0].addEventListener('ended', function(){ tab = null; });
    return tab;
  } catch(e){ return null; }
}

let titleBeforeRec = null;
function baseTitle(){ return titleBeforeRec !== null ? titleBeforeRec : document.title; }

function encodeCapture(source, w, h){
  const out = document.createElement('canvas');
  out.width = CAPTURE_SIZE[0]; out.height = CAPTURE_SIZE[1];
  const c = coverCrop(w, h, CAPTURE_SIZE[0], CAPTURE_SIZE[1]);
  const g = out.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(source, c.x, c.y, c.w, c.h, 0, 0, out.width, out.height);
  const tryQuality = function(q){
    out.toBlob(function(blob){
      if(!blob) return showCaptureBadge('Capture impossible : le navigateur n\'a rien produit', 4000);
      if(blob.size > CAPTURE_MAX_BYTES && q > 0.5) return tryQuality(Math.round((q - 0.1) * 10) / 10);
      download(blob, captureFileName(baseTitle(), 'capture', 'webp'));
      showCaptureBadge('📷 Capture enregistrée (' + Math.round(blob.size / 1024) + ' Ko)', 2500);
    }, 'image/webp', q);
  };
  tryQuality(0.92);
}

// REPLI : la toile seule, lisible juste après un rendu WebGPU.
function canvasScreenshot(){
  const r = globalThis.__gameRenderer;
  if(!r) return showCaptureBadge('Le jeu n\'a pas encore démarré', 3000);
  const render = r.render;
  r.render = function(){
    const out = render.apply(this, arguments);
    r.render = render;
    try { encodeCapture(r.domElement, r.domElement.width, r.domElement.height); }
    catch(e){ showCaptureBadge('Capture impossible : ' + e.message, 4000); }
    return out;
  };
}

async function screenshot(){
  const t = await tabStream();
  if(!t){
    showCaptureBadge('Partage d\'onglet refusé : capture de l\'image 3D seule, SANS l\'interface', 4000);
    return canvasScreenshot();
  }
  hideTools(true);
  await nextFrames(3);   // le flux a un léger retard : laisser passer les images où les outils étaient visibles
  try { encodeCapture(t.video, t.video.videoWidth, t.video.videoHeight); }
  catch(e){ showCaptureBadge('Capture impossible : ' + e.message, 4000); }
  if(!recording) hideTools(false);
}

// Repli audio (toile seule) : ce qui se branche sur la sortie d'un AudioContext, mémorisé dès le
// chargement de la page, ajouté au flux de la toile.
const toDestination = new Map();
function hookAudio(){
  if(!globalThis.AudioNode || AudioNode.prototype.__captureHooked) return;
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function(target){
    if(target && target === this.context.destination){
      let set = toDestination.get(this.context);
      if(!set){ set = new Set(); toDestination.set(this.context, set); }
      set.add(this);
    }
    return connect.apply(this, arguments);
  };
  AudioNode.prototype.__captureHooked = true;
}
function canvasStreamWithAudio(){
  const r = globalThis.__gameRenderer;
  if(!r) return null;
  const stream = r.domElement.captureStream(60);
  let best = null, n = -1;
  toDestination.forEach(function(set, ctx){ if(set.size > n){ n = set.size; best = ctx; } });
  if(best && best.createMediaStreamDestination){
    const dest = best.createMediaStreamDestination();
    toDestination.get(best).forEach(function(node){ try { node.connect(dest); } catch(e){ /* nœud parti */ } });
    dest.stream.getAudioTracks().forEach(function(tr){ stream.addTrack(tr); });
  }
  return stream;
}

let recording = null;
async function toggleRecording(){
  if(recording){ recording.stop(); return; }
  if(!globalThis.MediaRecorder) return showCaptureBadge('Ce navigateur ne sait pas enregistrer de vidéo', 4000);
  const format = videoFormats(function(t){ return MediaRecorder.isTypeSupported(t); })[0];
  if(!format) return showCaptureBadge('Ce navigateur ne sait pas enregistrer en WebM', 4000);
  const t = await tabStream();
  let stream;
  if(t) stream = t.stream;
  else {
    stream = canvasStreamWithAudio();
    if(!stream) return showCaptureBadge('Le jeu n\'a pas encore démarré', 3000);
    showCaptureBadge('Partage d\'onglet refusé : vidéo de l\'image 3D seule, SANS l\'interface', 4000);
  }
  if(t){ hideTools(true); await nextFrames(3); }
  titleBeforeRec = document.title;
  const chunks = [];
  const mr = new MediaRecorder(stream, {mimeType: format.mime, videoBitsPerSecond: 10000000});
  mr.ondataavailable = function(e){ if(e.data && e.data.size) chunks.push(e.data); };
  const name = captureFileName(titleBeforeRec, 'gameplay', format.ext);
  mr.onstop = function(){ download(new Blob(chunks, {type: 'video/webm'}), name); };
  mr.start(1000);
  const t0 = performance.now();
  // L'état s'affiche dans le TITRE de l'onglet : un badge dans la page serait dans la vidéo.
  const timer = setInterval(function(){
    const s = Math.floor((performance.now() - t0) / 1000);
    document.title = '● REC ' + s + ' s / ' + VIDEO_MAX_SECONDS + ' — ' + titleBeforeRec;
    if(!t) showCaptureBadge('● REC ' + s + ' s / ' + VIDEO_MAX_SECONDS + ' — F9 pour arrêter');
    if(s >= VIDEO_MAX_SECONDS && recording) recording.stop();
  }, 250);
  recording = {stop: function(){
    clearInterval(timer);
    if(mr.state !== 'inactive') mr.stop();
    recording = null;
    document.title = titleBeforeRec;
    titleBeforeRec = null;
    hideTools(false);
    showCaptureBadge('🎬 Vidéo enregistrée (WebM)', 3000);
  }};
}

if(globalThis.window && globalThis.document){
  hookAudio();
  window.addEventListener('keydown', function(e){
    if(e.repeat) return;
    if(e.key === 'F8'){ e.preventDefault(); e.stopImmediatePropagation(); screenshot(); }
    else if(e.key === 'F9'){ e.preventDefault(); e.stopImmediatePropagation(); toggleRecording(); }
  }, true);
}
