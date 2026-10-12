// moteur/js/touch-input.js
//
// Commandes tactiles : joystick virtuel, glisser sur l'écran, boutons — module PARTAGÉ
// éditeur/jeu publié.
//
// UN JEU TACTILE NE DOIT PAS ÊTRE UN AUTRE JEU. Rien ici n'invente d'entrée nouvelle : le joystick
// écrit des AXES de la table d'entrées du projet (`horizontal`, `vertical`…), et un bouton enfonce
// une ACTION de cette table, en pressant sa première touche. Un script écrit pour le clavier —
// `api.axis('horizontal')`, `api.actionPressed('jump')` — marche donc au doigt sans une ligne de
// plus, et le front montant (`actionPressed`) est calculé par le moteur exactement comme au clavier.
//
// La configuration est une donnée plate sérialisée par le composant TouchControls : on la règle
// dans l'inspecteur ou à la main dans le `.scene.json`.

export const TOUCH_CONTROLS_DEFAULT = {
  showOnDesktop: false,   // faux : n'apparaît que sur un écran tactile
  opacity: 0.85,
  joystick: {enabled: true, side: 'left', size: 150, deadZone: 0.15,
             axisX: 'horizontal', axisY: 'vertical', invertY: false,
             // Les ACTIONS pressées par le stick, pour un jeu qui lit des directions et non des
             // axes (`api.actionPressed('haut')` — grille, menus). Vide : rien n'est pressé.
             actions: {up: '', down: '', left: '', right: ''}, fourWay: true},
  buttonSize: 84,
  swipe: {enabled: false, axis: 'horizontal', sensitivity: 1.5},
  buttons: []             // [{id, label, action, side: 'right'}]
};

function num(v, def, min, max){
  const n = Number(v);
  if(v === null || v === undefined || v === '' || !Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}
function str(v, def){ return (typeof v === 'string') ? v : def; }
function side(v, def){ return (v === 'left' || v === 'right') ? v : def; }

export function normalizeTouchControls(data){
  const s = data || {};
  const D = TOUCH_CONTROLS_DEFAULT;
  const j = s.joystick || {}, w = s.swipe || {}, ja = j.actions || {};
  return {
    showOnDesktop: !!s.showOnDesktop,
    opacity: num(s.opacity, D.opacity, 0.1, 1),
    joystick: {
      enabled: j.enabled === undefined ? D.joystick.enabled : !!j.enabled,
      side: side(j.side, D.joystick.side),
      size: num(j.size, D.joystick.size, 60, 400),
      deadZone: num(j.deadZone, D.joystick.deadZone, 0, 0.9),
      axisX: str(j.axisX, D.joystick.axisX),
      axisY: str(j.axisY, D.joystick.axisY),
      invertY: !!j.invertY,
      actions: {up: str(ja.up, ''), down: str(ja.down, ''), left: str(ja.left, ''), right: str(ja.right, '')},
      fourWay: j.fourWay === undefined ? true : !!j.fourWay
    },
    buttonSize: num(s.buttonSize, D.buttonSize, 40, 160),
    swipe: {
      enabled: !!w.enabled,
      axis: str(w.axis, D.swipe.axis),
      sensitivity: num(w.sensitivity, D.swipe.sensitivity, 0.1, 10)
    },
    buttons: (Array.isArray(s.buttons) ? s.buttons : []).map(function(b, i){
      const x = b || {};
      const action = str(x.action, '');
      return {id: str(x.id, '') || ('button' + (i + 1)), label: str(x.label, action || 'Bouton'),
              action: action, side: side(x.side, 'right')};
    })
  };
}

/**
 * Le vecteur d'un joystick depuis le déplacement du doigt (pixels) : {x, y} dans [-1, 1], y vers
 * le HAUT positif. La zone morte est retirée puis l'amplitude réétalée, pour qu'un petit geste
 * au-delà de la zone morte ne saute pas directement à 0,15.
 */
export function joystickVector(dx, dy, radius, deadZone){
  const r = Math.max(1, radius);
  let x = dx / r, y = -dy / r;
  const len = Math.hypot(x, y);
  if(len > 1){ x /= len; y /= len; }
  const m = Math.min(1, len);
  const dz = Math.max(0, Math.min(0.9, deadZone || 0));
  if(m <= dz) return {x: 0, y: 0};
  const k = ((m - dz) / (1 - dz)) / m;
  return {x: x * k, y: y * k};
}

/**
 * Les directions pressées par un stick : sous-ensemble de {up, down, left, right}. Seuil 0,5 ;
 * en `fourWay`, seule la composante dominante compte (une grille ne connaît pas la diagonale, et
 * un menu qui reçoit « haut » et « droite » à la fois saute deux cases).
 */
export function joystickDirections(v, fourWay){
  const out = [];
  const ax = Math.abs(v.x), ay = Math.abs(v.y);
  if(Math.max(ax, ay) < 0.5) return out;
  if(fourWay){
    if(ax >= ay) out.push(v.x > 0 ? 'right' : 'left'); else out.push(v.y > 0 ? 'up' : 'down');
    return out;
  }
  if(ax >= 0.5) out.push(v.x > 0 ? 'right' : 'left');
  if(ay >= 0.5) out.push(v.y > 0 ? 'up' : 'down');
  return out;
}

/** L'état partagé : valeurs d'axes analogiques écrites par le tactile. */
export const touchState = {axes: {}};

/** La valeur tactile d'un axe, 0 si aucun doigt ne la pilote. */
export function touchAxis(name){
  const v = touchState.axes[name];
  return (typeof v === 'number' && Number.isFinite(v)) ? v : 0;
}

/**
 * Combine les sources d'un axe : clavier (-1/0/1), tactile, et manette. Le plus fort en valeur
 * absolue l'emporte, ce qui garde le clavier utilisable pendant qu'un doigt repose sur l'écran
 * ou qu'un stick flotte.
 *
 * C'EST LE SEUL ENDROIT OÙ LES SOURCES SE MÉLANGENT, et c'est ce qui a permis d'ajouter la
 * manette sans toucher aux deux moteurs : js/scripts.js et js/game-runtime.js appellent déjà
 * cette fonction pour chaque axe. Une quatrième source viendrait ici, et nulle part ailleurs.
 *
 * `typeof` pour la manette : js/gamepad-input.js est chargé par les pages d'édition et de jeu,
 * mais ce fichier-ci n'a aucun import, à dessein.
 */
export function combineAxis(keyValue, name){
  let best = keyValue;
  const t = touchAxis(name);
  if(Math.abs(t) > Math.abs(best)) best = t;
  if(typeof gamepadAxis === 'function'){
    const g = gamepadAxis(name);
    if(Math.abs(g) > Math.abs(best)) best = g;
  }
  return best;
}

// Tactile = le pointeur PRINCIPAL est un doigt, ou un vrai toucher a eu lieu. On ne lit plus
// `navigator.maxTouchPoints > 0` : il est vrai sur tout PC à écran tactile et sur Firefox de
// bureau, et les joysticks apparaissaient devant un joueur à la souris. Un PC tactile les voit
// dès qu'il touche l'écran, pas avant.
let touchSeen = false;
if(typeof addEventListener === 'function'){
  const seen = function(e){
    if(e.type === 'touchstart' || e.pointerType === 'touch'){
      touchSeen = true;
      removeEventListener('touchstart', seen, true); removeEventListener('pointerdown', seen, true);
    }
  };
  addEventListener('touchstart', seen, true); addEventListener('pointerdown', seen, true);
}
function isTouchDevice(){
  return touchSeen || (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches);
}

// ---------- DOM ----------
const MOUNT = {host: null, root: null, signature: '', cleanups: []};

function unmount(){
  MOUNT.cleanups.forEach(function(fn){ try{ fn(); } catch(e){} });
  MOUNT.cleanups = [];
  if(MOUNT.root && MOUNT.root.parentNode) MOUNT.root.parentNode.removeChild(MOUNT.root);
  MOUNT.root = null; MOUNT.host = null; MOUNT.signature = '';
  touchState.axes = {};
}

/**
 * Pose (ou retire) la surcouche tactile dans `host` à partir des nœuds porteurs du composant
 * TouchControls. Idempotent : appelé à chaque image, il ne reconstruit le DOM que si la
 * configuration a changé. `ctx` : {keys (Set des touches enfoncées), inputs ({actions, axes})}.
 */
export function syncTouchControls(host, nodes, ctx){
  let cfg = null, declared = false;
  for(let i = 0; i < (nodes || []).length && !cfg; i++){
    const n = nodes[i];
    const c = (n && typeof n.getComponent === 'function') ? n.getComponent('TouchControls') : null;
    if(c) declared = true;
    if(c && c.active !== false && n.visible !== false) cfg = normalizeTouchControls(c.data);
  }
  // SANS COMPOSANT, LE MOTEUR EN DÉDUIT UN de la table d'entrées : tout jeu devient jouable au
  // doigt sans rien poser. Un composant présent (même désactivé) l'emporte toujours, et
  // `settings.autoTouchControls: false` (ctx.auto) coupe la déduction pour tout le projet.
  if(!declared && ctx && ctx.auto !== false){
    const inputs = (typeof ctx.inputs === 'function') ? ctx.inputs() : ctx.inputs;
    cfg = autoTouchConfigCached(inputs);
  }
  if(!host || !cfg || (!cfg.showOnDesktop && !isTouchDevice())){
    if(MOUNT.root) unmount();
    return false;
  }
  const signature = JSON.stringify(cfg);
  if(MOUNT.root && MOUNT.host === host && MOUNT.signature === signature) return true;
  unmount();
  buildOverlay(host, cfg, ctx || {});
  MOUNT.host = host; MOUNT.signature = signature;
  return true;
}

export function clearTouchControls(){ unmount(); }

/**
 * La configuration tactile DÉDUITE de la table d'entrées du projet ({actions, axes}) :
 *   - joystick si le projet a des axes `horizontal`/`vertical` ou des actions liées aux flèches —
 *     il écrit les axes ET presse les actions de direction (un jeu à grille lit `actionPressed`) ;
 *   - boutons dans l'ordre de la manette : l'action liée à pad:0 (A), pad:1 (B), pad:2 (X),
 *     pad:3 (Y), puis pad:9 (Menu), à défaut Espace / Échap / Entrée. Quatre boutons au plus.
 * null quand rien n'est jouable au doigt (projet sans aucune entrée).
 */
export function autoTouchConfig(inputs){
  const actions = (inputs && inputs.actions) || {}, axes = (inputs && inputs.axes) || {};
  const names = Object.keys(actions);
  const bound = function(key){
    return names.find(function(n){ return (actions[n] || []).indexOf(key) >= 0; }) || '';
  };
  const dirs = {up: bound('ArrowUp'), down: bound('ArrowDown'), left: bound('ArrowLeft'), right: bound('ArrowRight')};
  const hasAxes = !!(axes.horizontal || axes.vertical);
  const hasDirs = !!(dirs.up || dirs.down || dirs.left || dirs.right);
  // Une action qui sert déjà de direction n'est pas un bouton (« advance » porte pad:12 ET ArrowUp).
  const used = new Set([dirs.up, dirs.down, dirs.left, dirs.right]);
  const buttons = [];
  [['A', 'pad:0', ' '], ['B', 'pad:1', 'Escape'], ['X', 'pad:2', 'Enter'], ['Y', 'pad:3', ''], ['Menu', 'pad:9', '']]
    .forEach(function(b){
      if(buttons.length >= 4) return;
      let a = bound(b[1]);
      if(!a || used.has(a)) a = b[2] ? bound(b[2]) : '';
      if(!a || used.has(a)) return;
      used.add(a);
      buttons.push({id: 'auto' + (buttons.length + 1), label: b[0], action: a, side: 'right'});
    });
  if(!hasAxes && !hasDirs && !buttons.length) return null;
  return normalizeTouchControls({
    opacity: 0.8, buttonSize: 72,
    joystick: {enabled: hasAxes || hasDirs, side: 'left', size: 140, deadZone: 0.2,
      axisX: axes.horizontal ? 'horizontal' : '', axisY: axes.vertical ? 'vertical' : '',
      actions: dirs, fourWay: !hasAxes},
    buttons: buttons
  });
}

// Déduite une fois par table d'entrées : syncTouchControls tourne à chaque image.
const AUTO_CACHE = {inputs: null, cfg: null};
function autoTouchConfigCached(inputs){
  if(AUTO_CACHE.inputs !== inputs){ AUTO_CACHE.inputs = inputs; AUTO_CACHE.cfg = autoTouchConfig(inputs); }
  return AUTO_CACHE.cfg;
}

function el(tag, cls, style){
  const e = document.createElement(tag);
  if(cls) e.className = cls;
  if(style) Object.assign(e.style, style);
  return e;
}

function firstKeyOf(ctx, action){
  const inputs = (typeof ctx.inputs === 'function') ? ctx.inputs() : ctx.inputs;
  const t = inputs && inputs.actions ? inputs.actions[action] : null;
  return (t && t.length) ? t[0] : null;
}

function buildOverlay(host, cfg, ctx){
  // SOUS L'INTERFACE DU JEU, jamais par-dessus. La zone de glisser couvre tout l'écran : posée
  // au-dessus, elle mangeait les clics des boutons du HUD (Pause, Onde…). Le conteneur hôte
  // (#rj-ui, #ui-layer) est positionné avec un z-index, donc un contexte d'empilement : un
  // enfant à z-index −1 y passe sous les documents d'interface, qui restent cliquables là où
  // ils ont des boutons et laissent passer le doigt ailleurs (pointer-events: none).
  const root = el('div', 'touch-controls', {position: 'absolute', inset: '0', pointerEvents: 'none',
    zIndex: '-1', opacity: String(cfg.opacity), touchAction: 'none', userSelect: 'none'});
  MOUNT.root = root;
  host.insertBefore(root, host.firstChild);

  function listen(target, type, fn){
    target.addEventListener(type, fn, {passive: false});
    MOUNT.cleanups.push(function(){ target.removeEventListener(type, fn); });
  }

  // Glisser : toute la surface, sous le joystick et les boutons.
  if(cfg.swipe.enabled){
    const zone = el('div', 'touch-swipe', {position: 'absolute', inset: '0', pointerEvents: 'auto'});
    root.appendChild(zone);
    let id = null, startX = 0;
    listen(zone, 'pointerdown', function(e){
      if(id !== null) return;
      id = e.pointerId; startX = e.clientX;
      try{ zone.setPointerCapture(id); } catch(err){}
      e.preventDefault();
    });
    listen(zone, 'pointermove', function(e){
      if(e.pointerId !== id) return;
      const w = Math.max(1, zone.clientWidth || 1);
      const v = ((e.clientX - startX) / w) * 2 * cfg.swipe.sensitivity;
      touchState.axes[cfg.swipe.axis] = Math.max(-1, Math.min(1, v));
    });
    const end = function(e){
      if(e.pointerId !== id) return;
      id = null; touchState.axes[cfg.swipe.axis] = 0;
    };
    listen(zone, 'pointerup', end);
    listen(zone, 'pointercancel', end);
  }

  if(cfg.joystick.enabled){
    const j = cfg.joystick, size = j.size;
    const base = el('div', 'touch-joystick', {position: 'absolute', bottom: '24px', width: size + 'px',
      height: size + 'px', borderRadius: '50%', background: 'rgba(255,255,255,.14)',
      border: '2px solid rgba(255,255,255,.45)', pointerEvents: 'auto', touchAction: 'none'});
    base.style[j.side] = '24px';
    const knob = el('div', 'touch-joystick-knob', {position: 'absolute', left: '50%', top: '50%',
      width: (size * 0.42) + 'px', height: (size * 0.42) + 'px',
      margin: (-size * 0.21) + 'px 0 0 ' + (-size * 0.21) + 'px',
      borderRadius: '50%', background: 'rgba(255,255,255,.75)'});
    base.appendChild(knob);
    root.appendChild(base);
    let id = null;
    const radius = size / 2;
    function apply(e){
      const r = base.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      const v = joystickVector(dx, dy, radius, j.deadZone);
      const len = Math.min(1, Math.hypot(dx, dy) / radius) * radius;
      const ang = Math.atan2(dy, dx);
      knob.style.transform = 'translate(' + (Math.cos(ang) * len) + 'px,' + (Math.sin(ang) * len) + 'px)';
      touchState.axes[j.axisX] = v.x;
      touchState.axes[j.axisY] = j.invertY ? -v.y : v.y;
      pressDirections(joystickDirections(v, j.fourWay));
    }
    // Les touches tenues par le stick : relâchées dès que la direction change.
    let held = [];
    function pressDirections(dirs){
      const want = dirs.map(function(d){ return firstKeyOf(ctx, j.actions[d]); }).filter(Boolean);
      held.forEach(function(k){ if(want.indexOf(k) < 0 && ctx.keys) ctx.keys.delete(k); });
      want.forEach(function(k){ if(held.indexOf(k) < 0 && ctx.keys) ctx.keys.add(k); });
      held = want;
    }
    MOUNT.cleanups.push(function(){ pressDirections([]); });
    listen(base, 'pointerdown', function(e){
      if(id !== null) return;
      id = e.pointerId;
      try{ base.setPointerCapture(id); } catch(err){}
      apply(e); e.preventDefault(); e.stopPropagation();
    });
    listen(base, 'pointermove', function(e){ if(e.pointerId === id) apply(e); });
    // LE JOYSTICK SE RECENTRE AU RELÂCHEMENT : un axe resté à 0,8 fait avancer le personnage seul.
    const end = function(e){
      if(e.pointerId !== id) return;
      id = null; knob.style.transform = '';
      touchState.axes[j.axisX] = 0; touchState.axes[j.axisY] = 0;
      pressDirections([]);
    };
    listen(base, 'pointerup', end);
    listen(base, 'pointercancel', end);
  }

  const columns = {left: null, right: null};
  cfg.buttons.forEach(function(b){
    if(!columns[b.side]){
      const col = el('div', 'touch-buttons', {position: 'absolute', bottom: '32px', display: 'flex',
        flexDirection: 'column', flexWrap: 'wrap', gap: '12px', pointerEvents: 'none',
        maxHeight: 'calc(100% - 48px)', alignContent: 'flex-end'});
      col.style[b.side] = '28px';
      if(cfg.joystick.enabled && cfg.joystick.side === b.side) col.style.bottom = (cfg.joystick.size + 48) + 'px';
      root.appendChild(col);
      columns[b.side] = col;
    }
    const btn = el('button', 'touch-button', {pointerEvents: 'auto', touchAction: 'none', minWidth: cfg.buttonSize + 'px',
      minHeight: cfg.buttonSize + 'px', borderRadius: '50%', border: '2px solid rgba(255,255,255,.6)',
      background: 'rgba(20,30,60,.55)', color: '#fff', font: '600 16px system-ui,sans-serif'});
    btn.type = 'button';
    btn.dataset.action = b.action;
    btn.textContent = b.label;
    columns[b.side].appendChild(btn);
    let key = null;
    listen(btn, 'pointerdown', function(e){
      e.preventDefault(); e.stopPropagation();
      key = firstKeyOf(ctx, b.action);
      if(key && ctx.keys) ctx.keys.add(key);
    });
    const up = function(){
      if(key && ctx.keys) ctx.keys.delete(key);
      key = null;
    };
    listen(btn, 'pointerup', up);
    listen(btn, 'pointercancel', up);
    listen(btn, 'pointerleave', up);
  });
}
