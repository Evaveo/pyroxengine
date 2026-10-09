// ---------- 🎲 Fabriquer : le point d'entrée MANUEL des assets procéduraux ----------
//
// `create_texture` et `create_sound` existaient depuis deux versions et n'étaient atteignables QUE par
// le copilote : ni button, ni menu. C'était la seule partie de l'éditeur dont on ne pouvait pas se
// servir sans IA — pour la fonctionnalité qui sert précisément à démarrer quand on n'a rien, donc
// au moment où l'on a le moins envie d'ouvrir une conversation.
//
// CE QUE CETTE FENÊTRE APPORTE, ET QU'AUCUNE COMMANDE NE PEUT APPORTER : l'APERÇU. Un modèle ne
// voit pas une image et n'entend pas un son ; il demande, puis constate qu'un asset existe. Ici on
// REGARDE la planche et on ÉCOUTE le bruitage AVANT qu'ils ne deviennent des assets — et un
// bruitage se juge à l'oreille en une seconde, là où le décrire prend un paragraphe.
//
// LE MÊME CHEMIN QUE L'IA, et c'est la contrainte de conception : ce fichier n'a AUCUNE recette à
// lui. Il appelle `createTextureProc` et `createSoundProc`, les deux fonctions qu'utilisent
// les commandes. Un bouton qui recopierait la recette produirait un jour un asset différent de
// celui que l'IA fabrique sous le même nom, et personne ne saurait lequel des deux a raison.

// ---------- La table des genres ----------
//
// PURE, et lue par le test. Elle décrit les champs de chaque genre et leurs défauts, et c'est le
// seul endroit où ils sont écrits : la fenêtre est engendrée depuis elle, donc un genre ajouté à
// js/proc-texture.js sans ligne ici est un genre invisible — ce que le test signale.
//
// Les défauts ne sont pas neutres, ils sont ceux d'un SUBSTITUT : des tailles courtes, des couleurs
// qui contrastent assez pour qu'on voie les bords. Un substitut qu'on doit régler avant de voir
// quelque chose ne remplit pas son office, qui est de débloquer tout de suite.
import { assets } from './assets.js';
import { ensureListenerAudio } from './audio.js';
import { createSoundProc, createTextureProc } from './copilot-workshop.js';
import { setStatus } from './hierarchy.js';
import { escapeHtml } from './objects.js';
import { SOUND_PROC_SR, makeSoundProc, validateSoundProc } from './proc-sound.js';
import { makeTextureProc, validateTextureProc } from './proc-texture.js';
import { closeModal, openModal } from './ui.js';

export const FACTORY_TEXTURES = [
  {kind: 'tuiles16', caption: 'Planche de 16 tuiles (décor)',
   help: 'Les 16 voisinages, dans l\'ordre de l\'auto-tuilage. Le genre à prendre pour le sol d\'un '
       + 'platformer : le moteur choisit l\'image tout seul.',
   fields: ['size', 'thickness', 'color', 'color2'],
   defaults: {size: 32, thickness: 4, color: '#6b7280', color2: '#2a3038'}},
  {kind: 'character', caption: 'Planche de personnage',
   help: 'Un bonhomme qui oscille d\'un pixel une image sur deux, avec deux yeux : de quoi voir la '
       + 'cadence ET le sens, donc repérer un retournement à l\'envers.',
   fields: ['cell', 'images', 'color', 'color2'],
   defaults: {cell: 32, images: 4, color: '#d9a05b', color2: '#2a3038'}},
  {kind: 'checker', caption: 'Damier',
   help: 'Pour juger une échelle ou un étirement d\'UV : sur un aplat, ni l\'un ni l\'autre ne se voit.',
   fields: ['width', 'height', 'size', 'color', 'color2'],
   defaults: {width: 256, height: 256, size: 32, color: '#c8ccd4', color2: '#4a5060'}},
  {kind: 'solid', caption: 'Aplat de couleur',
   help: 'Un mur, un sol, une couleur d\'essai.',
   fields: ['width', 'height', 'color'],
   defaults: {width: 128, height: 128, color: '#7a8494'}},
  {kind: 'gradient', caption: 'Dégradé vertical',
   help: 'Un ciel, un fond.',
   fields: ['width', 'height', 'color', 'color2'],
   defaults: {width: 128, height: 256, color: '#6fa8dc', color2: '#e8f0f8'}},
  {kind: 'text', caption: 'Texte ou nombre',
   help: 'Un mot ou un nombre centre sur un aplat — un chiffre sur un cube, une tag sur un '
     + 'panneau, un score. La taille se regle TOUTE SEULE : « 2 » et « 2048 » remplissent la meme '
     + 'place. Police matricielle : nette a toute echelle, chiffres, A-Z et quelques signes.',
   fields: ['width', 'height', 'text', 'color', 'color2'],
   defaults: {width: 128, height: 128, text: '2048', color: '#1e2430', color2: '#ffd23a'}},
  {kind: 'noise', caption: 'Bruit',
   help: 'Une matière. La GRAINE rend le résultat reproductible : même graine, même image.',
   fields: ['width', 'height', 'color', 'color2', 'seed'],
   defaults: {width: 256, height: 256, color: '#8a7f6d', color2: '#5d5548', seed: 1}}
];

export const FACTORY_SOUNDS = [
  {kind: 'jump', caption: 'Saut', help: 'La hauteur MONTE. Un saut qui descend contredit ce que le joueur voit.',
   defaults: {duration: 0.15, frequency: 440, volume: 0.7}},
  {kind: 'fall', caption: 'Chute / dégât', help: 'La hauteur descend.',
   defaults: {duration: 0.3, frequency: 440, volume: 0.7}},
  {kind: 'impact', caption: 'Impact / atterrissage',
   help: 'Du bruit et une composante grave : le bruit seul fait un « ch », la grave donne le poids.',
   defaults: {duration: 0.15, frequency: 440, volume: 0.7}},
  {kind: 'coin', caption: 'Pièce / ramassage', help: 'Deux notes, la seconde à la quinte au-dessus.',
   defaults: {duration: 0.2, frequency: 880, volume: 0.7}},
  {kind: 'step', caption: 'Pas', help: 'Du bruit court. À jouer en boucle courte, pas en continu.',
   defaults: {duration: 0.1, frequency: 440, volume: 0.5}},
  {kind: 'beep', caption: 'Bip', help: 'Une sinusoïde. Sert surtout à vérifier qu\'une source joue.',
   defaults: {duration: 0.15, frequency: 660, volume: 0.7}}
];

/** Le libellé, l'unité et les bounds de chaque champ. Une seule table pour les deux onglets. */
export const FACTORY_FIELDS = {
  size:    {label: 'Côté d\'une tuile', unite: 'px', min: 4, max: 256, step: 1},
  thickness: {label: 'Épaisseur du contour', unite: 'px', min: 1, max: 32, step: 1},
  cell:   {label: 'Côté d\'une image', unite: 'px', min: 8, max: 256, step: 1},
  images:    {label: 'Nombre d\'images', unite: '', min: 1, max: 16, step: 1},
  width:   {label: 'Largeur', unite: 'px', min: 1, max: 4096, step: 1},
  height:   {label: 'Hauteur', unite: 'px', min: 1, max: 4096, step: 1},
  seed:    {label: 'Graine', unite: '', min: 0, max: 9999, step: 1},
  duration:     {label: 'Durée', unite: 's', min: 0.02, max: 5, step: 0.01},
  frequency: {label: 'Hauteur', unite: 'Hz', min: 20, max: 8000, step: 10},
  volume:    {label: 'Volume', unite: '', min: 0, max: 1, step: 0.05},
  // Le premier champ de SAISIE LIBRE de cette window : tous les autres sont des nombres bounds
  // ou des couleurs. Il n a donc ni min ni max — ce qui le clamped, c est la police.
  text:     {label: 'Texte', text: true},
  color:   {label: 'Couleur', color: true},
  color2:  {label: 'Seconde couleur', color: true}
};

/** La description d'un genre, texture ou son. */
export function factoryKind(kind){
  return FACTORY_TEXTURES.concat(FACTORY_SOUNDS).find(function(g){ return g.kind === kind; }) || null;
}

/**
 * La demande complète pour un genre : ses défauts, écrasés par ce que l'auteur a typed.
 *
 * PURE, et c'est ce qui la rend vérifiable. Le passage par les défauts n'est pas cosmétique : une
 * valeur absente arrive comme `undefined` chez le fabricant, qui la remplace par SA valeur — donc
 * l'aperçu montrerait autre chose que ce que l'inspecteur shown. On décide ici, une fois.
 */
export function factoryRequest(kind, typed){
  const g = factoryKind(kind);
  if(!g) return null;
  const d = Object.assign({kind: kind}, g.defaults);
  Object.keys(typed || {}).forEach(function(k){
    const v = typed[k];
    if(v === undefined || v === null || v === '') return;
    // Les couleurs restent des chaînes ; tout le reste est un nombre, BORNÉ. Un champ hors bounds
    // n'est pas refusé mais ramené : refuser oblige à comprendre une contrainte avant de voir quoi
    // que ce soit, et l'aperçu est justement là pour l'inverse.
    const c = FACTORY_FIELDS[k];
    if(!c){ d[k] = v; return; }
    if(c.color){ d[k] = String(v); return; }
    if(c.text){ d[k] = String(v); return; }
    const n = Number(v);
    if(!isFinite(n)) return;
    d[k] = Math.max(c.min, Math.min(c.max, n));
  });
  return d;
}

/** Un nom d'asset libre de conflit : « sol », puis « sol 2 », « sol 3 »… */
export function factoryNameFree(base){
  const taken = function(n){ return assets.some(function(a){ return a.name === n; }); };
  if(!taken(base)) return base;
  for(let i = 2; i < 500; i++){ if(!taken(base + ' ' + i)) return base + ' ' + i; }
  return base + ' ' + Date.now();
}


// ---------- La fenêtre ----------

export const factoryState = {tab: 'texture', kind: 'tuiles16', sound: null, canvas: null};

export function factoryFieldHtml(key, value){
  const c = FACTORY_FIELDS[key];
  if(!c) return '';
  if(c.text){
    return '<div class="field"><label>' + c.label + '</label>'
      + '<input type="text" id="fab-' + key + '" value="' + escapeHtml(String(value)) + '" maxlength="16"></div>';
  }
  if(c.color){
    return '<div class="field"><label>' + c.label + '</label>'
      + '<input type="color" id="fab-' + key + '" value="' + escapeHtml(String(value)) + '"></div>';
  }
  return '<div class="field"><label>' + c.label + (c.unite ? ' (' + c.unite + ')' : '') + '</label>'
    + '<input type="number" id="fab-' + key + '" value="' + value + '" min="' + c.min
    + '" max="' + c.max + '" step="' + c.step + '"></div>';
}

export function factoryBodyHtml(){
  const text = factoryState.tab === 'texture';
  const list = text ? FACTORY_TEXTURES : FACTORY_SOUNDS;
  const g = factoryKind(factoryState.kind) || list[0];
  const fields = text ? g.fields : ['duration', 'frequence', 'volume'];

  return '<div style="display:flex;gap:8px;margin-bottom:10px">'
    + '<button class="btn-modal' + (text ? ' accent' : '') + '" id="fab-tab-texture">🖼 Image</button>'
    + '<button class="btn-modal' + (text ? '' : ' accent') + '" id="fab-tab-sound">🔊 Bruitage</button>'
    + '</div>'
    + '<div class="field"><label>Genre</label><select id="fab-kind">'
    + list.map(function(x){
        return '<option value="' + x.kind + '"' + (x.kind === g.kind ? ' selected' : '') + '>'
          + escapeHtml(x.caption) + '</option>';
      }).join('')
    + '</select></div>'
    + '<div class="ip-note">' + escapeHtml(g.help) + '</div>'
    + '<div class="field"><label>Nom</label><input type="text" id="fab-name" value="'
    + escapeHtml(factoryNameFree(g.kind)) + '"></div>'
    + fields.map(function(k){ return factoryFieldHtml(k, g.defaults[k]); }).join('')
    + '<div id="fab-preview" style="margin:12px 0;text-align:center;min-height:96px;'
    + 'display:flex;align-items:center;justify-content:center;flex-direction:column;gap:6px"></div>'
    + '<div style="display:flex;gap:8px;justify-content:space-between">'
    + '<button class="btn-modal" id="fab-cancel">Annuler</button>'
    + '<span style="display:flex;gap:8px">'
    + (text ? '' : '<button class="btn-modal" id="fab-listen">▶ Écouter</button>')
    + '<button class="btn-modal accent" id="fab-create">Créer l\'asset</button></span></div>';
}

/** Les valeurs saisies, telles quelles. La normalisation est le travail de `factoryRequest`. */
export function factoryInput(){
  const g = factoryKind(factoryState.kind);
  const out = {};
  if(!g) return out;
  Object.keys(FACTORY_FIELDS).forEach(function(k){
    const el = document.getElementById('fab-' + k);
    if(el) out[k] = el.value;
  });
  return out;
}

/**
 * Dessine ou décrit l'aperçu.
 *
 * LE ZOOM EST ENTIER ET LE LISSAGE COUPÉ. Un aperçu interpolé d'une planche de pixel-art ne montre
 * pas ce qui sera créé : les contours de tuiles deviennent flous, on croit la planche ratée, et on
 * la règle pour compenser un défaut qui n'existe que dans l'aperçu. C'est le même piège que le
 * filtrage à l'import, réglé au plus proche pour la même raison.
 */
export function factoryUpdatePreview(){
  const zone = document.getElementById('fab-preview');
  if(!zone) return;
  const d = factoryRequest(factoryState.kind, factoryInput());
  const isSound = FACTORY_SOUNDS.some(function(x){ return x.kind === factoryState.kind; });

  const soucis = isSound ? validateSoundProc(d) : validateTextureProc(d);
  if(soucis.length){
    factoryState.canvas = null; factoryState.sound = null;
    zone.innerHTML = '<div class="ip-note" style="border-left:2px solid #d08a3a">'
      + soucis.map(function(s){ return escapeHtml(s); }).join('<br>') + '</div>';
    return;
  }

  if(isSound){
    const wav = makeSoundProc(d);
    factoryState.sound = wav; factoryState.canvas = null;
    const sec = wav ? (wav.length - 44) / 2 / SOUND_PROC_SR : 0;
    // Un son ne se montre pas. On donne les deux chiffres qui le décrivent, et on RENVOIE à
    // l'écoute : c'est elle qui juge, et elle est à un clic.
    zone.innerHTML = '<div class="ip-note">' + sec.toFixed(2) + ' s · '
      + Math.round(wav.length / 1024) + ' Ko · WAV mono ' + Math.round(SOUND_PROC_SR / 1000) + ' kHz'
      + '<br><b>Écoutez-le avant de le créer</b> — c\'est la seule façon de juger un bruitage.</div>';
    return;
  }

  const t = makeTextureProc(d);
  factoryState.canvas = t; factoryState.sound = null;
  if(!t){ zone.textContent = 'aperçu indisponible'; return; }
  const cv = document.createElement('canvas');
  cv.width = t.l; cv.height = t.h;
  cv.getContext('2d').putImageData(new ImageData(t.px, t.l, t.h), 0, 0);
  // UN ZOOM ENTIER, calculé sur la place RÉELLEMENT disponible. Un facteur fractionnaire ferait
  // tomber les pixels entre deux, ce que l'auteur lirait comme un défaut de la planche.
  //
  // La largeur est lue dans le DOM et non devinée : une première version prenait 240 px pour
  // acquis, et une planche de personnage de 128 × 32 s'affichait à ×1 dans une zone de 600 px —
  // quatre bonshommes de 32 px, trop petits pour qu'on juge ce qu'on est venu voir.
  // Les deux dimensions sont contraintes séparément : clamp la seule plus grande laisserait une
  // bande large et basse minuscule, ou une haute et étroite déborder la fenêtre en hauteur.
  const dispoL = Math.max(120, zone.clientWidth - 8);
  const dispoH = 260;
  const zoom = Math.max(1, Math.min(8, Math.floor(dispoL / t.l) || 1, Math.floor(dispoH / t.h) || 1));
  cv.style.width = (t.l * zoom) + 'px';
  cv.style.height = (t.h * zoom) + 'px';
  cv.style.imageRendering = 'pixelated';
  cv.style.border = '1px solid #3a4048';
  zone.innerHTML = '';
  zone.appendChild(cv);
  const info = document.createElement('div');
  info.className = 'ip-note';
  info.textContent = t.l + ' × ' + t.h + ' px, affiché ×' + zoom
    + (d.kind === 'tuiles16' ? ' — 16 images, prêtes pour une map de tuiles'
     : d.kind === 'character' ? ' — ' + d.images + ' image(s), prêtes pour un animateur' : '');
  zone.appendChild(info);
}

/** Écoute le bruitage current SANS créer d'asset. */
export function factoryListen(){
  if(!factoryState.sound){ setStatus('Rien à écouter', 2000); return; }
  const listener = ensureListenerAudio();
  // On copie les octets : `decodeAudioData` DÉTACHE le tampon qu'on lui donne, et le second clic
  // sur « Écouter » n'aurait plus rien à décoder — un bouton qui marche une fois puis se tait.
  const copie = factoryState.sound.slice(0).buffer;
  listener.context.decodeAudioData(copie, function(buf){
    const sound = new THREE.Audio(listener);
    sound.setBuffer(buf);
    sound.setVolume(1);
    sound.play();
  }, function(){ setStatus('Ce bruitage n\'a pas pu être décodé', 4000); });
}

export function factoryCreate(){
  const d = factoryRequest(factoryState.kind, factoryInput());
  const fieldName = document.getElementById('fab-name');
  d.name = (fieldName && fieldName.value.trim()) || factoryState.kind;
  const isSound = FACTORY_SOUNDS.some(function(x){ return x.kind === factoryState.kind; });
  try{
    if(isSound){
      const r = createSoundProc(d);
      closeModal();
      setStatus('Son « ' + r.asset.name + ' » créé — ' + r.secondes.toFixed(2) + ' s', 4000);
      return;
    }
    createTextureProc(d).then(function(r){
      closeModal();
      setStatus('Texture « ' + r.texture.name + ' » créée'
        + (r.sheet ? ', et la planche « ' + r.sheet.name + ' » découpée en '
                       + r.sheet.regions.length + ' image(s)' : ''), 5000);
    }, function(e){ setStatus('Fabrication impossible : ' + e.message, 6000); });
  } catch(e){
    setStatus('Fabrication impossible : ' + e.message, 6000);
  }
}

export function modalFactory(){
  openModal('Fabriquer un asset', factoryBodyHtml());
  factoryBind();
}

/** (Re)pose les écouteurs et l'aperçu. Appelé à chaque reconstruction du body. */
export function factoryBind(){
  const body = document.getElementById('modal-body');
  const rebuild = function(){
    body.innerHTML = factoryBodyHtml();
    factoryBind();
  };
  document.getElementById('fab-tab-texture').addEventListener('click', function(){
    if(factoryState.tab === 'texture') return;
    factoryState.tab = 'texture'; factoryState.kind = FACTORY_TEXTURES[0].kind;
    rebuild();
  });
  document.getElementById('fab-tab-sound').addEventListener('click', function(){
    if(factoryState.tab === 'sound') return;
    factoryState.tab = 'sound'; factoryState.kind = FACTORY_SOUNDS[0].kind;
    rebuild();
  });
  // Changer de genre change les CHAMPS : on reconstruit plutôt que de masquer. Masquer laisserait
  // les valeurs de l'ancien genre dans le DOM, et `factoryInput` les lirait.
  document.getElementById('fab-kind').addEventListener('change', function(){
    factoryState.kind = this.value;
    rebuild();
  });
  // L'aperçu suit la frappe : c'est toute la raison d'être de cette fenêtre.
  body.addEventListener('input', function(e){
    if(e.target && e.target.id === 'fab-kind') return;
    factoryUpdatePreview();
  });
  document.getElementById('fab-cancel').addEventListener('click', closeModal);
  document.getElementById('fab-create').addEventListener('click', factoryCreate);
  const ec = document.getElementById('fab-listen');
  if(ec) ec.addEventListener('click', factoryListen);
  factoryUpdatePreview();
}

document.getElementById('btn-make').addEventListener('click', modalFactory);
