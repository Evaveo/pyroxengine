// ---------- Le panneau « Atelier Blender » (menu Fenêtres) ----------
//
// Il remplace le plugin EVAVEO Studio ET l'application Studio elle-même. Pas d'IA ici : c'est un
// panneau MANUEL, pour les gestes courants (envoyer une référence, regarder un rendu, exporter et
// importer dans le projet). Une IA, si on en veut une, passe par les liens MCP du moteur — les
// commandes blender_* (copilot-blender.js) — et ce panneau sert alors à suivre ce qu'elle fait.
//
// Tout passe par blender-link.js : mêmes bornes que les commandes MCP (adresse locale, GLB vérifié).

import { BlenderLink, BLENDER_DEFAULT_PORT } from './blender-link.js';
import { BLENDER_PROTOCOL_URL, detectPlatform, installerFor, newBlenderToken } from './blender-installer.js';
import { importFromBlender, previewImage } from './copilot-blender.js';
import { setStatus } from './hierarchy.js';

// Servi à côté de l'éditeur, comme les plugins d'exemple. Régénéré par outils/blender-addon/build-zip.mjs.
export const ADDON_ZIP_URL = 'exemples/blender/evaveo_blender_bridge.zip';

const view = {host: null, timer: null, unsubscribe: null, busy: false, progress: '', image: null, fastUntil: 0};

function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
    return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;'}[c];
  });
}

function connectionHtml(st){
  if(st.connected){
    const h = st.hello;
    return '<div class="net-row"><span class="net-ok">● Connecté</span><span class="net-dim">Blender '
      + esc(h.blender) + ' · addon ' + esc(h.bridge) + (h.busy ? ' · occupé' : '') + '</span></div>'
      + '<div class="net-dim" title="' + esc(h.project) + '">Dossier : ' + esc(h.project) + '</div>';
  }
  return '<div class="net-row"><span class="net-err">○ Non connecté</span></div>'
    + '<div class="net-row"><button class="btn-modal" data-bw="install">⚡ Installer et ouvrir Blender</button>'
    + '<button class="btn-modal" data-bw="open">▶ Ouvrir Blender</button></div>'
    + '<div class="net-dim">Première fois : « Installer » télécharge un petit script — l\'ouvrir d\'un double-clic. '
    + 'Il trouve Blender, installe et règle l\'addon, puis l\'ouvre ; l\'éditeur se connecte seul. '
    + 'Ensuite, « Ouvrir Blender » suffit.</div>'
    + (st.lastError ? '<div class="net-warn">' + esc(st.lastError) + '</div>' : '')
    + '<details><summary class="net-dim">Installation à la main</summary>'
    + '<ol class="net-dim bw-steps">'
    + '<li><a href="' + ADDON_ZIP_URL + '" download>⬇ Télécharger l\'addon</a> (Blender 4.5 LTS ou plus récent).</li>'
    + '<li>Dans Blender : Édition → Préférences → Add-ons → ⌄ → <b>Installer depuis le disque</b>, choisir le zip, '
    + 'cocher « EVAVEO Blender Bridge ».</li>'
    + '<li>Vue 3D → barre latérale (N) → onglet <b>EVAVEO</b> → <b>Copier le jeton</b>, puis le coller ci-dessous.</li>'
    + '</ol></details>'
    + (isLocalPage() ? '' : onlineHtml());
}

function pageOrigin(){
  try { return location.origin || ''; } catch(e){ return ''; }
}

function isLocalPage(){
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(pageOrigin());
}

// L'éditeur en ligne n'est pas dans la liste blanche par défaut de l'addon (qui ne connaît que
// l'éditeur local) : son origine se copie ici et se colle dans Blender. Pas de « * » côté addon.
function onlineHtml(){
  return '<div class="net-block"><div class="net-title">Éditeur en ligne</div>'
    + '<div class="net-dim">1. <button class="btn-modal" data-bw="copy-origin">Copier l\'origine</button> '
    + '<code>' + esc(pageOrigin()) + '</code><br>2. Dans Blender, onglet EVAVEO : <b>Autoriser l\'éditeur en ligne</b>.<br>'
    + '3. Le navigateur peut demander l\'accès au « réseau local » : c\'est Blender, sur votre machine — accepter.</div></div>';
}

function logHtml(st){
  if(!st.log.length) return '<div class="net-dim">Aucun appel pour l\'instant.</div>';
  return st.log.slice(0, 10).map(function(e){
    return '<div class="net-row"><span class="' + (e.ok ? 'net-ok' : 'net-err') + '">' + (e.ok ? '✓' : '✗') + '</span>'
      + '<span class="net-dim">' + esc(e.op) + (e.action ? ' · ' + esc(e.action) : '')
      + (e.detail ? ' — ' + esc(String(e.detail).slice(0, 120)) : '') + '</span></div>';
  }).join('');
}

function render(){
  const host = view.host;
  if(!host || !host.dataset.built) return;
  const st = BlenderLink.status();
  host.querySelector('#bw-connection').innerHTML = connectionHtml(st);
  host.querySelector('#bw-log').innerHTML = logHtml(st);
  host.querySelector('#bw-progress').textContent = view.progress;
  host.querySelectorAll('[data-needs-link]').forEach(function(b){ b.disabled = !st.connected || view.busy; });
  const img = host.querySelector('#bw-preview');
  img.style.display = view.image ? 'block' : 'none';
  if(view.image) img.src = view.image;
}

async function check(){
  try { await BlenderLink.hello(); } catch(e){ /* l'erreur est dans le statut, affichée par render */ }
  render();
}

async function run(label, fn){
  if(view.busy) return;
  view.busy = true; view.progress = label + '…'; render();
  try {
    await fn(function(p){
      view.progress = label + ' — ' + Math.round((p.fraction || 0) * 100) + ' % ' + (p.message || ''); render();
    });
    view.progress = '';
  } catch(e){
    view.progress = '✗ ' + e.message;
    setStatus('Atelier Blender : ' + e.message, 8000);
  } finally {
    view.busy = false; render();
  }
}

async function sendReferences(files, view3d){
  for(const f of Array.from(files)){
    const path = await BlenderLink.upload(f.name.replace(/[^A-Za-z0-9_.-]/g, '_'), await f.arrayBuffer());
    const isImage = /\.(png|jpe?g|webp)$/i.test(f.name);
    await BlenderLink.call('import_asset', isImage
      ? {action: 'reference', spec_json: {file: path, view: view3d}}
      : {action: 'import', spec_json: {file: path}}, {timeoutMs: null});
  }
  setStatus('✅ ' + files.length + ' fichier(s) envoyé(s) à Blender', 4000);
}

function onClick(e){
  const b = e.target.closest ? e.target.closest('[data-bw]') : null;
  if(!b) return;
  const a = b.dataset.bw;
  const host = view.host;
  if(a === 'save'){
    const token = host.querySelector('#bw-token').value;
    try {
      BlenderLink.configure(Object.assign({port: Number(host.querySelector('#bw-port').value) || BLENDER_DEFAULT_PORT},
        token ? {token: token} : {}));
    } catch(err){ view.progress = '✗ ' + err.message; render(); return; }
    host.querySelector('#bw-token').value = '';
    check();
  } else if(a === 'paste'){
    if(!navigator.clipboard || !navigator.clipboard.readText){
      view.progress = 'Presse-papiers inaccessible : coller le jeton dans le champ.'; render(); return;
    }
    navigator.clipboard.readText().then(function(t){
      BlenderLink.configure({token: t}); check();
    }).catch(function(){ view.progress = 'Presse-papiers illisible : coller le jeton dans le champ.'; render(); });
  } else if(a === 'install'){
    installBlender();
  } else if(a === 'open'){
    // Le lien evaveo-blender:// est enregistré par le script d'installation. Sans lui, le
    // navigateur ne fait rien : on le dit au bout de quelques secondes.
    location.href = BLENDER_PROTOCOL_URL;
    watchFor('Blender ne s’est pas ouvert ? Faire d’abord « Installer et ouvrir Blender ».');
  } else if(a === 'copy-origin'){
    if(navigator.clipboard) navigator.clipboard.writeText(pageOrigin());
    setStatus('Origine copiée : la coller dans Blender (EVAVEO → Autoriser l\'éditeur en ligne)', 6000);
  } else if(a === 'check'){
    check();
  } else if(a === 'refs'){
    host.querySelector('#bw-files').click();
  } else if(a === 'preview'){
    run('Rendu', async function(progress){
      const res = await BlenderLink.call('delivery_action', {action: 'preview',
        spec_json: {size: 384, stage: host.querySelector('#bw-stage').value}}, {timeoutMs: null, onProgress: progress});
      view.image = await previewImage(res, 640);
    });
  } else if(a === 'atlas'){
    run('Atlas', function(progress){
      return BlenderLink.call('build_atlas', {size: Number(host.querySelector('#bw-atlas-size').value) || 1024},
        {timeoutMs: null, onProgress: progress});
    });
  } else if(a === 'import'){
    const name = host.querySelector('#bw-name').value.trim() || 'BlenderAsset';
    if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name)){
      view.progress = '✗ Nom : lettres, chiffres, « _ » et « - » seulement.'; render(); return;
    }
    run('Export et import', function(progress){
      return importFromBlender({name: name, stage: host.querySelector('#bw-stage').value,
        animations: host.querySelector('#bw-anim').checked, lods: host.querySelector('#bw-lod').checked,
        collisions: host.querySelector('#bw-col').checked}, progress);
    });
  } else if(a === 'ai'){
    // Le réglage MCP vit dans le panneau du copilote (⚙). Le cloud y est proposé en premier.
    if(globalThis.Editor && Editor.api && Editor.api.openPanel) Editor.api.openPanel('copilot');
    setStatus('Copilote → ⚙ → « Pilotage par une IA (MCP) » : via le cloud de préférence.', 8000);
  }
}

function watchFor(hint){
  view.fastUntil = Date.now() + 180000;
  if(view.timer){ clearTimeout(view.timer); schedule(); }
  setTimeout(function(){
    if(!BlenderLink.status().connected){ view.progress = hint; render(); }
  }, 20000);
}

/** Fabrique le script d'installation pour cette machine et le fait télécharger. */
function installBlender(){
  let file;
  try {
    // Un jeton NEUF, posé des deux côtés : dans l'éditeur maintenant, dans Blender par le script.
    const token = newBlenderToken();
    file = installerFor(detectPlatform(navigator.userAgent), {
      zipUrl: new URL(ADDON_ZIP_URL, location.href).href, token: token, origin: pageOrigin()});
    BlenderLink.configure({token: token});
  } catch(e){
    view.progress = '✗ ' + e.message + ' — l’éditeur doit être servi en http(s) pour installer l’addon.';
    render();
    return;
  }
  const url = URL.createObjectURL(new Blob([file.text], {type: file.type}));
  const link = document.createElement('a');
  link.href = url; link.download = file.name;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(function(){ URL.revokeObjectURL(url); }, 10000);
  view.progress = '⬇ ' + file.name + ' téléchargé : l’ouvrir' + (/\.sh$/.test(file.name) ? ' (sh ' + file.name + ')' : ' d’un double-clic')
    + '. Windows peut demander confirmation (« Informations complémentaires » → « Exécuter quand même »).';
  render();
  watchFor('Toujours pas connecté : le script a-t-il affiché une erreur ?');
}

function buildDom(host){
  const st = BlenderLink.status();
  host.innerHTML = ''
    + '<div class="net-title">Connexion</div><div id="bw-connection"></div>'
    + '<div class="net-row"><span>Port</span><input type="number" id="bw-port" min="1024" max="65535" value="'
    + st.port + '" style="width:80px"></div>'
    + '<div class="net-row"><span>Jeton</span><input type="password" id="bw-token" placeholder="'
    + (st.hasToken ? 'enregistré' : 'coller le jeton') + '" spellcheck="false" style="flex:1"></div>'
    + '<div class="net-row"><button class="btn-modal" data-bw="save">Enregistrer</button>'
    + '<button class="btn-modal" data-bw="paste">📋 Coller le jeton</button>'
    + '<button class="btn-modal" data-bw="check">Tester</button></div>'
    + '<div class="net-block"><div class="net-title">Références</div>'
    + '<div class="net-dim">Concept arts (posés en image de référence) ou modèles GLB/FBX/OBJ/STL (importés dans Blender).</div>'
    + '<div class="net-row"><span>Vue</span><select id="bw-view"><option value="front">face</option>'
    + '<option value="left">profil</option><option value="back">dos</option><option value="top">dessus</option>'
    + '<option value="free">libre</option></select>'
    + '<button class="btn-modal" data-bw="refs" data-needs-link>Envoyer à Blender…</button></div>'
    + '<input type="file" id="bw-files" multiple accept=".png,.jpg,.jpeg,.webp,.glb,.gltf,.fbx,.obj,.stl" style="display:none"></div>'
    + '<div class="net-block"><div class="net-title">Aperçu</div>'
    + '<div class="net-row"><span>Étape</span><select id="bw-stage"><option value="source">source</option>'
    + '<option value="atlas">atlas</option></select>'
    + '<button class="btn-modal" data-bw="preview" data-needs-link>Rendre</button></div>'
    + '<img id="bw-preview" alt="Rendu Blender" style="display:none;width:100%;margin-top:6px;border:1px solid var(--edge)"></div>'
    + '<div class="net-block"><div class="net-title">Livraison</div>'
    + '<div class="net-row"><span>Atlas PBR</span><select id="bw-atlas-size"><option>512</option>'
    + '<option selected>1024</option><option>2048</option><option>4096</option></select>'
    + '<button class="btn-modal" data-bw="atlas" data-needs-link>Construire</button></div>'
    + '<div class="net-row"><span>Nom de l\'asset</span><input type="text" id="bw-name" value="BlenderAsset" spellcheck="false" style="flex:1"></div>'
    + '<div class="net-row"><label><input type="checkbox" id="bw-anim" checked> animations</label>'
    + '<label><input type="checkbox" id="bw-lod"> LOD</label><label><input type="checkbox" id="bw-col"> collisions</label></div>'
    + '<div class="net-row"><button class="btn-modal" data-bw="import" data-needs-link>Exporter et importer dans le projet</button></div>'
    + '<div class="net-dim" id="bw-progress"></div></div>'
    + '<div class="net-block"><div class="net-title">Journal</div><div id="bw-log"></div></div>'
    + '<div class="net-block"><div class="net-title">Piloter avec une IA</div>'
    + '<div class="net-dim">Claude (ou tout client MCP) modélise dans Blender par les commandes blender_* du moteur. '
    + 'Aucune IA n\'est payée par l\'éditeur : c\'est la vôtre.</div>'
    + '<div class="net-row"><button class="btn-modal" data-bw="ai">Brancher une IA (MCP)…</button></div></div>';
  host.addEventListener('click', onClick);
  host.querySelector('#bw-files').addEventListener('change', function(e){
    const files = e.target.files;
    const v = host.querySelector('#bw-view').value;
    if(files && files.length) run('Envoi', function(){ return sendReferences(files, v); });
    e.target.value = '';
  });
  host.dataset.built = '1';
}

export function buildBlenderWorkshop(){
  const host = document.getElementById('blender-workshop-panel');
  if(!host) return;
  view.host = host;
  if(!host.dataset.built) buildDom(host);
  if(!view.unsubscribe) view.unsubscribe = BlenderLink.onChange(render);
  render();
  check();
  // Un œil sur la liaison TANT QUE le panneau est visible, pas plus : rien ne tourne panneau fermé.
  // Blender fermé, chaque sonde refusée s'affiche en rouge dans la console du navigateur (on ne
  // peut pas la taire) : on espace donc à 30 s tant qu'il n'y a personne, 5 s une fois connecté.
  // « Tester » relance une sonde tout de suite.
  if(!view.timer) schedule();
}

function schedule(){
  // Juste après « Installer » ou « Ouvrir », on guette Blender de près (3 s) pendant 3 minutes.
  const delay = BlenderLink.status().connected ? 5000 : (Date.now() < view.fastUntil ? 3000 : 30000);
  view.timer = setTimeout(function(){
    const tick = view.busy ? Promise.resolve() : check();
    tick.then(function(){ if(view.timer) schedule(); });
  }, delay);
}

export function hideBlenderWorkshop(){
  if(view.timer){ clearTimeout(view.timer); view.timer = null; }
  if(view.unsubscribe){ view.unsubscribe(); view.unsubscribe = null; }
}
