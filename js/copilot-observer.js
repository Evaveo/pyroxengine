// ---------- Les trois sens qui manquaient au copilote ----------
//
// Le copilote savait AGIR — 31 commandes qui créent, transforment, peignent. Il ne savait ni VOIR ce
// qu'il produisait, ni ESSAYER le jeu, ni MESURER les nombres qui décident. Il construisait donc des
// scènes qui « réussissent toutes les commandes et donnent un niveau injouable » — la description de
// `analyze_scene` le disait déjà, et un seul contrôle statique n'y suffisait pas.
//
// Ce que cette session a montré, et qui motive chacune des trois commandes ci-dessous : TOUS les
// défauts réels ont été trouvés en regardant une image ou en lisant une mesure. Le personnage flou
// (rapport pixel 0,694), la plateforme inatteignable (elle existait, hors field), le demi-écran empty
// (caméra fixe sur une tour de 46 unités), les mailles empilées par centaines. Aucun n'aurait été vu
// par un agent qui n'a que le texte de ses propres commandes.
//
//   capture_view      — une image de la vue d'édition
//   play_and_measure  — le VRAI runtime, N images, puis les positions et une image
//   verifier          — les validateurs du moteur, qui existaient déjà sans être interrogeables
//
// Les deux dernières sont ASYNCHRONES et la première rend une IMAGE : c'est ce qui a demandé
// d'élargir le contrat des commandes (voir `copRun`).

import { analyzeScene } from './analysis.js';
import { captureSeqNow, capturedSince, formatConsole } from './copilot-inspect.js';
import { assets } from './assets.js';
import { CopilotTools } from './copilot.js';
import { stateCurrent } from './history.js';
import { objects } from './objects.js';
import { project } from './project.js';
import { grid, renderer, scene, viewEl } from './scene.js';
import { buildDataProject } from './serialization.js';
import { camCurrent } from './viewport.js';

/** Réduit une image à une largeur donnée. Une capture pleine taille en base64 ruine un contexte. */
export function shrinkImage(dataUrl, widthMax){
  return new Promise(function(res){
    const img = new Image();
    img.onload = function(){
      const k = Math.min(1, widthMax / (img.width || 1));
      if(k >= 1){ res(dataUrl); return; }
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(img.width * k));
      cv.height = Math.max(1, Math.round(img.height * k));
      const cx = cv.getContext('2d');
      cx.imageSmoothingEnabled = true;
      cx.drawImage(img, 0, 0, cv.width, cv.height);
      res(cv.toDataURL('image/png'));
    };
    img.onerror = function(){ res(dataUrl); };
    img.src = dataUrl;
  });
}

/**
 * Une capture est-elle VIDE ?
 *
 * Un canvas WebGPU peut rendre une image entièrement transparente sans lever la moindre erreur — et
 * une capture vide est le pire résultat possible : l'agent la lit comme « la scène est vide » et se
 * met à réparer ce qui n'est pas cassé. On le détecte, et on le DIT.
 */
export function captureEmpty(dataUrl){
  // Un PNG uniforme compresse à presque rien. Le seuil est grossier mais suffisant : une vraie view
  // d'éditeur, même sombre, porte une grille et un gizmo.
  return !dataUrl || dataUrl.length < 2000;
}

/** L'image de la vue d'édition, rendue à l'instant. */
export async function captureViewEditor(widthMax){
  if(!renderer.__ready) throw new Error('le rendu n\'est pas encore initialisé — réessayez dans un instant');
  // On REND avant de capturer : sans ça on lit ce que le canvas portait à la dernière image de la
  // loop, qui peut précéder les commandes qu'on vient d'exécuter.
  renderer.render(scene, camCurrent());
  const raw = renderer.domElement.toDataURL('image/png');
  if(captureEmpty(raw)){
    throw new Error('la capture est vide (' + raw.length + ' octets) : le rendu n\'a rien produit. '
      + 'Ce n\'est PAS le signe d\'une scène vide — ne construisez rien sur cette base.');
  }
  return await shrinkImage(raw, Math.max(64, Math.min(1600, widthMax || 640)));
}

// ---------- Faire tourner le VRAI runtime dans un cadre ----------
//
// Pas un « mode game » de l'éditeur : il n'en existe plus (l'ancien drapeau `modeGame.active`, qui
// ne devenait jamais vrai, a été retiré — js/play-mode.js), le bouton ▶ ouvre `game-preview.html` dans un onglet. On fait donc tourner la MÊME
// page dans un cadre invisible — c'est-à-dire le même code qu'un jeu publié, ce qui vaut mieux qu'une
// simulation approchée : ce qu'on mesure est ce que le joueur aura.

export let frameDryRun = null;

export function closeFrameDryRun(){
  if(frameDryRun && frameDryRun.parentNode) frameDryRun.parentNode.removeChild(frameDryRun);
  frameDryRun = null;
}

/**
 * Le point de vue imposé au cadre de mesure, ou null. Rien n'est écrit dans le projet : la pose
 * part sur la fenêtre du cadre (`__measureCamera`), que le runtime applique à chaque image.
 *
 * - `camera: {position:{x,y,z}, target:{x,y,z}}` : la pose exacte ;
 * - `focus: {x,y,z}` (+ `distance`, défaut 12) : regarder ce point d'en haut et de biais
 *   (élévation ~37°, depuis +Z), le cadrage le plus lisible pour « voir tel endroit ».
 */
export function measureCameraPose(o){
  const v = function(p, label){
    if(!p || typeof p !== 'object') return null;
    const r = [Number(p.x) || 0, Number(p.y) || 0, Number(p.z) || 0];
    if(!r.every(isFinite)) throw new Error(label + ' : coordonnées invalides');
    return r;
  };
  if(o && o.camera){
    const pos = v(o.camera.position, 'camera.position');
    if(!pos) throw new Error('camera.position est requis');
    const tgt = v(o.camera.target, 'camera.target') || [pos[0], pos[1], pos[2] - 1];
    return {position: pos, target: tgt};
  }
  if(o && o.focus){
    const f = v(o.focus, 'focus');
    const d = Math.max(0.5, Number(o.distance) || 12);
    return {position: [f[0], +(f[1] + d * 0.6).toFixed(4), +(f[2] + d * 0.8).toFixed(4)], target: f};
  }
  return null;
}

/**
 * Le plan des touches simulées de play_and_measure : `[{key, at, duration}]` (secondes de jeu,
 * `duration` 0.1 par défaut) → liste triée d'événements `{t, type, key}`.
 */
export function measureKeyPlan(keys){
  if(keys === undefined || keys === null) return [];
  if(!Array.isArray(keys)) throw new Error('keys doit être une liste [{key, at, duration}]');
  const events = [];
  keys.forEach(function(k, i){
    if(!k || typeof k.key !== 'string' || !k.key) throw new Error('keys[' + i + '].key est requis (ex. "ArrowRight", " ", "z")');
    const at = Number(k.at) || 0;
    const dur = (k.duration === undefined) ? 0.1 : Number(k.duration);
    if(!isFinite(at) || at < 0 || !isFinite(dur) || dur < 0) throw new Error('keys[' + i + '] : at/duration invalides');
    events.push({t: at, type: 'keydown', key: k.key, sent: false});
    events.push({t: at + dur, type: 'keyup', key: k.key, sent: false});
  });
  events.sort(function(a, b){ return a.t - b.t || (a.type === 'keyup' ? -1 : 1); });
  return events;
}

/** Envoie au cadre de jeu les événements du plan dont l'instant est atteint. Rend le nombre envoyé. */
export function sendKeyEvents(win, plan, t){
  let n = 0;
  plan.forEach(function(ev){
    if(ev.sent || ev.t > t) return;
    ev.sent = true; n++;
    try{
      const Ctor = (win && win.KeyboardEvent) || KeyboardEvent;
      win.dispatchEvent(new Ctor(ev.type, {key: ev.key, bubbles: true}));
    } catch(e){ /* cadre parti */ }
  });
  return n;
}

/**
 * Lance le jeu et rend `{echantillons, erreurs, image}`.
 *
 * `images` : combien d'images laisser tourner avant de mesurer. `echantillons` : combien de relevés
 * intermédiaires, pour voir une TRAJECTOIRE et pas seulement un état final — un héros qui traverse le
 * sol et un héros qui s'y pose finissent parfois au même endroit, et seule la trajectoire les
 * distingue.
 */
export async function playAndMeasure(opts){
  const o = opts || {};
  const images = Math.max(1, Math.min(3000, Math.round(Number(o.images) || 120)));
  const nEch = Math.max(1, Math.min(20, Math.round(Number(o.samples) || 3)));
  const width = Math.max(64, Math.min(1600, Number(o.width) || 640));
  const pose = measureCameraPose(o);   // validée AVANT de lancer quoi que ce soit
  const plan = measureKeyPlan(o.keys); // idem

  closeFrameDryRun();
  window.PREVIEW_GAME_DATA = await buildDataProject();
  const consoleSeq0 = captureSeqNow();   // la console du jeu pendant CETTE mesure (api.log compris)

  const frame = document.createElement('iframe');
  // Une taille RÉELLE, et pas 1 × 1 : le cadrage d'une caméra 2D se calcule depuis la taille de la
  // toile, donc un cadre minuscule mesurerait un rapport pixel qui n'existe nulle part.
  frame.width = Math.max(320, Math.round(viewEl.clientWidth));
  frame.height = Math.max(240, Math.round(viewEl.clientHeight));
  // DANS la fenêtre, presque transparent et sous tout le reste : un cadre hors écran (left:-10000px)
  // voit son requestAnimationFrame bridé par le navigateur, et le jeu n'avance pas.
  frame.style.cssText = 'position:fixed;left:0;top:0;border:0;opacity:0.01;pointer-events:none;z-index:-1';
  frame.src = 'game-preview.html';
  document.body.appendChild(frame);
  frameDryRun = frame;

  const gameWindow = () => frame.contentWindow;
  const waitFor = (ms) => new Promise(function(r){ setTimeout(r, ms); });

  // Attendre que le runtime ait posé sa fenêtre de lecture. Le délai est généreux : un WebGPURenderer
  // s'initialise en plusieurs secondes au premier chargement, et échouer là ferait conclure « le jeu
  // ne démarre pas » alors qu'il n'avait pas fini de démarrer.
  const t0 = Date.now();
  while(Date.now() - t0 < 15000){
    try{ if(gameWindow() && typeof gameWindow().__stateGame === 'function') break; } catch(e){ /* pas encore accessible */ }
    await waitFor(60);
  }
  let read;
  try{ read = gameWindow().__stateGame; } catch(e){ read = null; }
  // Le runtime a posé sa fenêtre : la pose imposée y survit (plus de navigation dans le cadre).
  if(pose){ try{ gameWindow().__measureCamera = pose; } catch(e){ /* cadre parti */ } }
  if(typeof read !== 'function'){
    closeFrameDryRun();
    throw new Error('le jeu n\'a pas démarré en 15 s : `window.__etatJeu` absent. Le runtime a '
      + 'peut-être levé une erreur au chargement — vérifiez la console du navigateur.');
  }

  // __stateGame existe dès que le fichier du runtime est lu, AVANT le chargement des assets. Mesurer
  // tout de suite relevait une scène vide, puis le cadre était retiré EN PLEIN CHARGEMENT : le
  // chargement continuait dans un cadre détaché, sans GPU, et finissait en « Démarrage impossible :
  // … reading 'TEXTURE_BINDING' » (Zeldo, 2026-10-02, 365 prefabs posés). On attend donc que le jeu
  // ait réellement démarré — ou qu'il dise pourquoi il n'a pas pu.
  const tReady = Date.now();
  let startError = null, ready = false;
  while(Date.now() - tReady < 90000){
    try{ ready = !!gameWindow().__gameReady; startError = gameWindow().__gameStartError || null; } catch(e){ /* cadre parti */ }
    if(ready || startError) break;
    await waitFor(100);
  }
  if(!ready){
    closeFrameDryRun();
    throw new Error(startError ? 'le jeu n\'a pas démarré : ' + startError
      : 'le jeu charge encore après 90 s (assets ou scène trop lourds ?) — rien n\'a été mesuré');
  }
  const loadSeconds = Math.round((Date.now() - t0) / 100) / 10;

  // Les relevés se calent sur le TEMPS DU JEU (`time` de __stateGame), pas sur l'horloge murale :
  // `samples: 1` relevait `t=0s` — un cadre ralenti ou un jeu qui démarre sa boucle en retard n'avait
  // pas encore avancé, et l'agent concluait à un jeu figé. Chaque relevé attend que le jeu ait
  // atteint son instant cible (le dernier = la durée entière), avec un plafond mural pour ne pas
  // attendre éternellement un jeu réellement figé. Les touches simulées partent au même rythme.
  const duration = images / 60;
  const samples = [];
  const readTime = function(){ try{ return Number(gameWindow().__stateGame().time) || 0; } catch(e){ return null; } };
  const tStart = readTime() || 0;
  const wallStart = Date.now();
  const wallMax = (duration * 3 + 5) * 1000;
  for(let i = 0; i < nEch; i++){
    const target = duration * (i + 1) / nEch;
    while(true){
      const t = readTime();
      if(t === null) break;
      sendKeyEvents(gameWindow(), plan, t - tStart);
      if(t - tStart >= target - 1e-6 || Date.now() - wallStart > wallMax) break;
      await waitFor(16);
    }
    try{ samples.push(gameWindow().__stateGame()); } catch(e){ break; }
  }
  // Une touche encore enfoncée à la fin est relâchée : le cadre va disparaître, mais proprement.
  try{ sendKeyEvents(gameWindow(), plan, Infinity); } catch(e){ /* cadre parti */ }

  // Les erreurs que le runtime shown lui-même. C'est SON canal : il y écrit les scripts qui ne
  // compilent pas et les assets manquants.
  let errors = '';
  try{
    const el = gameWindow().document.getElementById('rj-error');
    errors = (el && el.textContent || '').trim();
  } catch(e){ /* cadre déjà parti */ }

  let image = null, souciImage = null;
  try{
    const cv = gameWindow().document.querySelector('#rj-view canvas');
    if(cv){
      const raw = cv.toDataURL('image/png');
      if(captureEmpty(raw)) souciImage = 'capture empty (' + raw.length + ' octets)';
      else image = await shrinkImage(raw, width);
    } else souciImage = 'aucun canvas dans la page de jeu';
  } catch(e){ souciImage = e.message; }

  closeFrameDryRun();
  return {samples: samples, errors: errors, gameConsole: capturedSince(consoleSeq0), image: image, souciImage: souciImage,
          imagesDemandees: images, loadSeconds: loadSeconds, pose: pose};
}

// ---------- Les validateurs, rendus interrogeables ----------
//
// Tout ce qui suit EXISTAIT DÉJÀ et était juste — `framing2d`, `validateCamera2d`, `validateTilemap`,
// `bandsCollision`, `validateSequences`, `analyzeScene` ont des centaines de tests derrière eux. Ils
// étaient seulement appelés À L'INTÉRIEUR des commandes, jamais consultables. Le rapport pixel entier,
// le nombre de boîtes de collision : les deux nombres qui décident de la netteté et de la fluidité
// d'un jeu 2D, invisibles à l'agent qui construisait le jeu.

/**
 * Le genre du projet, calculé sur des données À JOUR.
 *
 * `project.scenes[…].donnees` n'est rafraîchi que par `buildDataProject` — au moment
 * d'enregistrer ou d'exporter. Lire le genre sans rafraîchir répond donc sur l'état d'AVANT : mesuré
 * deux fois, une fois dans `check` et une fois dans `summarize_scene`, chaque fois « kind 3d » juste
 * après un préréglage 2D. Un agent en conclurait que sa commande n'a pas pris, et la rejouerait.
 *
 * Le rafraîchissement vit ICI, en un seul endroit, précisément parce que je l'ai oublié une fois.
 */
export function kindProjectADate(){
  if(typeof kindProject !== 'function') return null;
  if(project && project.scenes && project.scenes[project.current]){
    project.scenes[project.current].data = stateCurrent();
  }
  return kindProject(project.scenes);
}

export function checkScene(){
  const ratio = {};

  // --- Caméras 2D : le rapport pixel, la vue, les bounds ---
  const cams = objects.filter(function(o){
    const c = (typeof cameraSettingOf === 'function') ? cameraSettingOf(o) : null;
    return c && c.projection === 'orthographic';
  });
  if(cams.length){
    const w = viewEl ? viewEl.clientWidth : 1920, h = viewEl ? viewEl.clientHeight : 1080;
    ratio.cameras2d = cams.map(function(o){
      const cam = cameraSettingOf(o);
      const r = (typeof settingCam2d === 'function') ? settingCam2d(cam) : cam;
      const c = (typeof framing2d === 'function')
        ? framing2d(w, h, r.ppu, r.mode, r.widthLevel, r.ratio) : null;
      const soucis = ((typeof validateCamera2d === 'function') ? validateCamera2d(r) : [])
        .concat((typeof validateCameraFollow === 'function')
                  ? validateCameraFollow(cameraFollowOf(o)) : []);
      return {
        name: o.name,
        // LE nombre qui décide de la netteté. S'il n'est pas entier, c'est flou, et rien d'autre n'y
        // change quoi que ce soit.
        ratioPixel: c ? c.ratio : null,
        ratioEntier: c ? Math.abs(c.ratio - Math.round(c.ratio)) < 1e-9 : null,
        viewUnits: c ? [+c.widthView.toFixed(2), +c.heightView.toFixed(2)] : null,
        viewTientInLevel: (c && r.widthLevel > 0) ? (c.widthView <= r.widthLevel + 1e-9) : null,
        follows: r.follows || null,
        boundsHorizontales: (typeof r.xMin === 'number' && typeof r.xMax === 'number'),
        problemes: [...soucis]
      };
    });
  }

  // --- Tilemaps : les problèmes, et le nombre de BOÎTES (pas de cases) ---
  const cartes = objects.filter(function(o){ return o.getComponent && o.getComponent('Tilemap'); });
  if(cartes.length){
    const ids = assets.filter(function(a){ return a.kind === 'sprite'; }).map(function(a){ return a.id; });
    ratio.tilemaps = cartes.map(function(o){
      const c = o.getComponent('Tilemap');
      const tiles = (typeof c.tileDefs === 'function') ? c.tileDefs() : null;
      const bands = (typeof collidingBands === 'function') ? collidingBands(c, tiles).length : null;
      return {
        name: o.name,
        grid: c.width + '×' + c.height,
        casesPosees: (c.cells || []).filter(function(v){ return v !== 0; }).length,
        // C'est CE nombre que le solveur teste à chaque image, pas le nombre de cases.
        boitesOfCollision: bands,
        problemes: (typeof validateTilemap === 'function') ? [...validateTilemap(c, ids, tiles)] : []
      };
    });
  }

  // --- Suites d'animation de sprite ---
  const anims = objects.filter(function(o){ return o.userData.animSprite; });
  if(anims.length){
    ratio.animatorsSprite = anims.map(function(o){
      const d = o.userData.animSprite;
      const sp = d.spriteId ? assets.find(function(a){ return a.id === d.spriteId; }) : null;
      const regions = (sp && sp.regions) || [];
      return {
        name: o.name,
        sheet: sp ? sp.name : null,
        sequences: ((sp && sp.sequences) || []).map(function(s){ return s.name; }),
        problemes: (typeof validateSequences === 'function' && sp) ? [...validateSequences(sp.sequences, regions)] : []
      };
    });
  }

  // --- Et le contrôle de jouabilité qui existait déjà ---
  const pb = analyzeScene();
  ratio.scene = {
    objects: objects.length,
    kind: kindProjectADate(),
    errors: pb.filter(function(p){ return p.level === 'error'; }).map(function(p){ return p.text; }),
    avertissements: pb.filter(function(p){ return p.level === 'warn'; }).map(function(p){ return p.text; })
  };
  return ratio;
}

// ---------- Enregistrement dans le catalogue ----------
// `COMMANDS` est un tableau : on y ajoute, sans toucher js/copilot.js. Le pont MCP (js/mcp-link.js +
// outils/mcp-bridge/bridge.mjs) publie getCopilotCatalog(), donc ces outils arrivent aussi chez un client MCP.

CopilotTools.register({
  name: 'capture_view',
  description: 'Rend une IMAGE de la vue d\'édition, telle qu\'elle est maintenant. À utiliser après '
    + 'avoir construit ou déplacé quelque chose : les défauts de cadrage, de proportion et de '
    + 'placement ne se voient pas dans le texte des commandes. La vue suit l\'onglet active (Scène ou '
    + '2D) et la caméra courante.',
  schema: {type: 'object', properties: {
    width: {type: 'number', description: 'largeur de l\'image rendue, en pixels (défaut 640). '
      + 'Réduire coûte moins de contexte ; au-delà de 900 on ne voit rien de plus.'}
  }, additionalProperties: false},
  exec: async function(a){
    const image = await captureViewEditor(a.width);
    return {text: 'view d\'édition capturée (' + Math.round(image.length / 1024) + ' Ko)', image: image};
  }
});

CopilotTools.register({
  name: 'play_and_measure',
  description: 'LANCE LE JEU pour de vrai — le même code qu\'un build publié — le laisse tourner, puis '
    + 'rend les positions des objets au fil du temps (relevés calés sur le temps du jeu, le dernier à la fin de la durée), les erreurs affichées par le jeu, et une image. '
    + 'C\'est la seule commande qui dit si le jeu FONCTIONNE : toutes les autres peuvent réussir et '
    + 'produire un niveau où le personnage tombe dans le vide. Les positions sont échantillonnées pour '
    + 'montrer une trajectoire — un héros qui traverse le sol et un héros qui s\'y pose finissent '
    + 'parfois au même endroit. `camera` ou `focus` imposent le point de vue de l\'image (le jeu part '
    + 'toujours de son spawn, rien n\'est écrit dans le projet) — pour regarder un endroit précis.',
  schema: {type: 'object', properties: {
    images: {type: 'number', description: 'combien d\'images laisser tourner (défaut 120, soit ~2 s)'},
    samples: {type: 'number', description: 'nombre de relevés répartis sur la durée (défaut 3)'},
    width: {type: 'number', description: 'largeur de l\'image rendue (défaut 640)'},
    camera: {type: 'object', description: 'point de vue imposé à l\'image, le temps de la mesure seulement '
      + '(le projet n\'est pas modifié) : {position:{x,y,z}, target:{x,y,z}}',
      properties: {position: {type: 'object'}, target: {type: 'object'}}},
    focus: {type: 'object', description: 'regarder ce point {x,y,z} d\'en haut et de biais, sans modifier '
      + 'le projet (alternative simple à camera)', properties: {x: {type: 'number'}, y: {type: 'number'}, z: {type: 'number'}}},
    distance: {type: 'number', description: 'avec focus : distance de la caméra au point (défaut 12)'},
    objects: {type: 'array', items: {type: 'string'}, description: 'noms des objets à relever : seuls '
      + 'ceux-là sont rendus, sans troncature (sinon les 40 premiers)'},
    keys: {type: 'array', description: 'touches simulées : [{key, at, duration}] — `key` comme '
      + 'KeyboardEvent.key ("ArrowRight", " ", "z"), `at` en secondes de jeu, `duration` tenue (défaut 0.1 s)',
      items: {type: 'object', properties: {key: {type: 'string'}, at: {type: 'number'}, duration: {type: 'number'}}, required: ['key']}}
  }, additionalProperties: false},
  exec: async function(a){
    const r = await playAndMeasure(a);
    const lines = [];
    const fmt = function(o){
      return o.name + '(' + o.x + ',' + o.y + (o.atGround === null ? '' : o.atGround ? ',au sol' : ',en l\'air') + ')';
    };
    const wanted = Array.isArray(a.objects) && a.objects.length ? a.objects.map(String) : null;
    r.samples.forEach(function(e){
      if(wanted){
        // Les objets demandés sont TOUS rendus, sans troncature ; un nom absent est dit.
        const shown = e.objects.filter(function(o){ return wanted.indexOf(o.name) !== -1; });
        const missing = wanted.filter(function(n){ return !shown.some(function(o){ return o.name === n; }); });
        lines.push('t=' + e.time + 's : ' + shown.map(fmt).join(' · ')
          + (missing.length ? ' · introuvable(s) : ' + missing.join(', ') : ''));
        return;
      }
      // Un décor posé à la main compte des centaines d'objets immobiles : les lister tous noyait
      // la trajectoire du héros sous 30 000 caractères. On garde les 40 premiers et le compte.
      const shown = e.objects.slice(0, 40);
      lines.push('t=' + e.time + 's : ' + shown.map(fmt).join(' · ')
        + (e.objects.length > shown.length ? ' · … +' + (e.objects.length - shown.length) + ' objets (paramètre objects pour cibler)' : ''));
    });
    let text = 'jeu démarré en ' + r.loadSeconds + ' s, mesuré sur ~' + r.imagesDemandees + ' images.\n' + lines.join('\n');
    const lastSample = r.samples[r.samples.length - 1];
    if(lastSample && lastSample.shadows) text += '\nombres : ' + JSON.stringify(lastSample.shadows);
    if(r.pose) text += '\npoint de vue imposé (mesure seulement) : caméra ' + JSON.stringify(r.pose.position)
      + ' → ' + JSON.stringify(r.pose.target) + ' ; les scripts qui lisent la caméra la voient aussi.';
    if(r.errors) text += '\n\n⛔ LE JEU AFFICHE UNE ERREUR : ' + r.errors;
    if(r.gameConsole && r.gameConsole.length){
      text += '\n\nconsole du jeu (' + r.gameConsole.length + ' ligne(s) — api.log/warn/error, exceptions) :\n'
        + formatConsole(r.gameConsole, {n: 60});
    }
    if(r.souciImage) text += '\n(pas d\'image : ' + r.souciImage + ')';
    if(!r.samples.length) text += '\n(aucun relevé : le jeu s\'est arrêté ou n\'a jamais démarré)';
    return {text: text, image: r.image};
  }
});

CopilotTools.register({
  name: 'check',
  description: 'Rend les MESURES du moteur : rapport pixel de chaque caméra 2D (s\'il n\'est pas '
    + 'entier, le jeu est flou, et rien d\'autre n\'y change quoi que ce soit), taille de vue et '
    + 'bounds, nombre de boîtes de collision de chaque map de tuiles (c\'est ce nombre que le '
    + 'solveur teste à chaque image, pas le nombre de cases), problèmes des suites d\'animation, et '
    + 'les défauts de jouabilité de la scène. À appeler avant de conclure qu\'un niveau est prêt.',
  schema: {type: 'object', properties: {}, additionalProperties: false},
  exec: function(){ return JSON.stringify(checkScene(), null, 1); }
});
