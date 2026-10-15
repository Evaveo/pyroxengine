// moteur/js/capture-tools.js
//
// CAPTURES ET VIDÉO DE GAMEPLAY depuis « ▶ Jouer » — pour la fiche catalogue du cloud (couverture,
// captures 16:9, vidéo de 10 à 30 s). Chargé par game-preview.html SEULEMENT : un jeu publié n'a ni
// ces touches ni ce code. Aucune ligne dans la boucle de js/game-runtime.js : le module lit le
// renderer exposé par js/render-scale.js (`__gameRenderer`) et se branche de l'extérieur.
//
//   F8 : capture 1920×1080 (recadrée au centre en 16:9), WebP sous 2 Mo — la limite du catalogue.
//   F9 : démarre / arrête l'enregistrement (WebM, plus MP4 quand le navigateur sait l'encoder),
//        arrêt automatique à 30 s, son du jeu compris.
//
// Seule la TOILE du jeu est enregistrée : l'interface HTML posée par-dessus (HUD, menus) n'y est pas.

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

/** Les formats vidéo à enregistrer : WebM toujours (si possible), MP4 en plus quand il est pris en charge. */
export function videoFormats(isSupported){
  const pick = function(list){ return list.find(function(t){ return isSupported(t); }) || null; };
  const out = [];
  const webm = pick(['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']);
  if(webm) out.push({mime: webm, ext: 'webm'});
  const mp4 = pick(['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4']);
  if(mp4) out.push({mime: mp4, ext: 'mp4'});
  return out;
}

// ---------- Ce qui suit touche le navigateur ----------

// LE SON. On mémorise tout ce qui se branche sur la sortie d'un AudioContext, dès le chargement de
// la page (avant que le jeu ne construise son graphe) : à l'enregistrement, ces nœuds sont aussi
// branchés sur une destination de flux, et ce qui se branche pendant l'enregistrement aussi.
const toDestination = new Map();   // AudioContext → Set des nœuds branchés sur sa sortie
let recordingAudio = null;         // {ctx, dest} pendant un enregistrement
function hookAudio(){
  if(!globalThis.AudioNode || AudioNode.prototype.__captureHooked) return;
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function(target){
    if(target && target === this.context.destination){
      let set = toDestination.get(this.context);
      if(!set){ set = new Set(); toDestination.set(this.context, set); }
      set.add(this);
      if(recordingAudio && recordingAudio.ctx === this.context){
        try { connect.call(this, recordingAudio.dest); } catch(e){ /* nœud déjà parti */ }
      }
    }
    return connect.apply(this, arguments);
  };
  AudioNode.prototype.__captureHooked = true;
}

function download(blob, name){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

let badge = null;
function showCaptureBadge(text, ms){
  if(!badge){
    badge = document.createElement('div');
    badge.style.cssText = 'position:fixed;right:10px;top:10px;z-index:99999;font:13px system-ui,sans-serif;'
      + 'color:#fff;background:#000b;padding:5px 10px;border-radius:6px;pointer-events:none';
    document.body.appendChild(badge);
  }
  badge.textContent = text;
  badge.style.display = '';
  clearTimeout(badge._t);
  if(ms) badge._t = setTimeout(function(){ badge.style.display = 'none'; }, ms);
}

// La toile WebGPU n'est lisible que juste après un rendu : on attend le prochain `render` et on copie
// l'image dans la foulée.
function afterNextRender(renderer, fn){
  const render = renderer.render;
  renderer.render = function(){
    const out = render.apply(this, arguments);
    renderer.render = render;
    try { fn(renderer.domElement); } catch(e){ showCaptureBadge('Capture impossible : ' + e.message, 4000); }
    return out;
  };
}

function screenshot(){
  const r = globalThis.__gameRenderer;
  if(!r) return showCaptureBadge('Le jeu n\'a pas encore démarré', 3000);
  afterNextRender(r, function(src){
    const out = document.createElement('canvas');
    out.width = CAPTURE_SIZE[0]; out.height = CAPTURE_SIZE[1];
    const c = coverCrop(src.width, src.height, CAPTURE_SIZE[0], CAPTURE_SIZE[1]);
    const g = out.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, c.x, c.y, c.w, c.h, 0, 0, out.width, out.height);
    const tryQuality = function(q){
      out.toBlob(function(blob){
        if(!blob) return showCaptureBadge('Capture impossible : le navigateur n\'a rien produit', 4000);
        if(blob.size > CAPTURE_MAX_BYTES && q > 0.5) return tryQuality(Math.round((q - 0.1) * 10) / 10);
        download(blob, captureFileName(document.title, 'capture', 'webp'));
        showCaptureBadge('📷 Capture enregistrée (' + Math.round(blob.size / 1024) + ' Ko)', 2500);
      }, 'image/webp', q);
    };
    tryQuality(0.92);
  });
}

let recording = null;
function toggleRecording(){
  if(recording){ recording.stop(); return; }
  const r = globalThis.__gameRenderer;
  if(!r) return showCaptureBadge('Le jeu n\'a pas encore démarré', 3000);
  if(!globalThis.MediaRecorder) return showCaptureBadge('Ce navigateur ne sait pas enregistrer de vidéo', 4000);
  const formats = videoFormats(function(t){ return MediaRecorder.isTypeSupported(t); });
  if(!formats.length) return showCaptureBadge('Aucun format vidéo disponible dans ce navigateur', 4000);
  const stream = r.domElement.captureStream(60);
  // Le son : l'AudioContext qui a le plus de nœuds branchés sur sa sortie (celui du jeu).
  let best = null, n = -1;
  toDestination.forEach(function(set, ctx){ if(set.size > n){ n = set.size; best = ctx; } });
  if(best && best.createMediaStreamDestination){
    const dest = best.createMediaStreamDestination();
    toDestination.get(best).forEach(function(node){ try { node.connect(dest); } catch(e){ /* nœud parti */ } });
    recordingAudio = {ctx: best, dest: dest};
    dest.stream.getAudioTracks().forEach(function(t){ stream.addTrack(t); });
  }
  const recs = formats.map(function(f){
    const chunks = [];
    const mr = new MediaRecorder(stream, {mimeType: f.mime, videoBitsPerSecond: 8000000});
    mr.ondataavailable = function(e){ if(e.data && e.data.size) chunks.push(e.data); };
    mr.onstop = function(){ download(new Blob(chunks, {type: f.mime.split(';')[0]}), captureFileName(document.title, 'gameplay', f.ext)); };
    mr.start(1000);
    return mr;
  });
  const t0 = performance.now();
  const timer = setInterval(function(){
    const s = Math.floor((performance.now() - t0) / 1000);
    showCaptureBadge('● REC ' + s + ' s / ' + VIDEO_MAX_SECONDS + ' — F9 pour arrêter');
    if(s >= VIDEO_MAX_SECONDS) recording.stop();
  }, 250);
  recording = {stop: function(){
    clearInterval(timer);
    recs.forEach(function(mr){ if(mr.state !== 'inactive') mr.stop(); });
    recordingAudio = null;
    recording = null;
    showCaptureBadge('🎬 Vidéo enregistrée (' + formats.map(function(f){ return f.ext.toUpperCase(); }).join(' + ') + ')', 3000);
  }};
  showCaptureBadge('● REC 0 s / ' + VIDEO_MAX_SECONDS + ' — F9 pour arrêter');
}

if(globalThis.window && globalThis.document){
  hookAudio();
  window.addEventListener('keydown', function(e){
    if(e.repeat) return;
    if(e.key === 'F8'){ e.preventDefault(); e.stopImmediatePropagation(); screenshot(); }
    else if(e.key === 'F9'){ e.preventDefault(); e.stopImmediatePropagation(); toggleRecording(); }
  }, true);
}
