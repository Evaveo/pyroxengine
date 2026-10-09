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
             axisX: 'horizontal', axisY: 'vertical', invertY: false},
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
  const j = s.joystick || {}, w = s.swipe || {};
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
      invertY: !!j.invertY
    },
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

function isTouchDevice(){
  return (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches)
    || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0);
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
  let cfg = null;
  for(let i = 0; i < (nodes || []).length && !cfg; i++){
    const n = nodes[i];
    const c = (n && typeof n.getComponent === 'function') ? n.getComponent('TouchControls') : null;
    if(c && c.active !== false && n.visible !== false) cfg = normalizeTouchControls(c.data);
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
    }
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
    };
    listen(base, 'pointerup', end);
    listen(base, 'pointercancel', end);
  }

  const columns = {left: null, right: null};
  cfg.buttons.forEach(function(b){
    if(!columns[b.side]){
      const col = el('div', 'touch-buttons', {position: 'absolute', bottom: '32px', display: 'flex',
        flexDirection: 'column', gap: '14px', pointerEvents: 'none'});
      col.style[b.side] = '28px';
      if(cfg.joystick.enabled && cfg.joystick.side === b.side) col.style.bottom = (cfg.joystick.size + 48) + 'px';
      root.appendChild(col);
      columns[b.side] = col;
    }
    const btn = el('button', 'touch-button', {pointerEvents: 'auto', touchAction: 'none', minWidth: '84px',
      minHeight: '84px', borderRadius: '50%', border: '2px solid rgba(255,255,255,.6)',
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
