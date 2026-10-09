// moteur/js/gamepad-input.js
//
// LA MANETTE — module PARTAGÉ éditeur / jeu publié.
//
// ---------- CE QU'IL N'A PAS FALLU FAIRE ----------
//
// Une manette, c'est deux choses : des BOUTONS, qui sont des touches, et des STICKS, qui sont
// des valeurs continues. Le moteur savait déjà traiter les deux — le clavier pour les premiers,
// le tactile pour les seconds. Ce fichier ne refait donc ni table d'entrées, ni résolution
// d'action, ni sérialisation.
//
// LES BOUTONS ENTRENT PAR LE MÊME JEU DE TOUCHES QUE LE CLAVIER. À chaque image, le bouton 0
// enfoncé pose la touche synthétique `pad:0` dans le `Set` des touches pressées. Conséquence :
// `actionActive`, `api.key()`, `api.keyPressed()` et l'instantané réseau
// fonctionnent sur la manette **sans une ligne de changement**, et lier un bouton à une action
// revient à écrire `'pad:0'` dans la liste de touches de cette action — que le panneau Entrées
// du projet sait déjà éditer et enregistrer.
//
// LES STICKS ENTRENT PAR `combineAxis`, là où le tactile entrait déjà. Un axe de projet
// (`horizontal: ['left', 'right']`) accepte une TROISIÈME case, facultative : la source
// analogique. `['left', 'right', 'pad:axis0']` branche le stick gauche dessus, et
// `'pad:axis1-'` l'y branche inversé — l'axe Y d'une manette est positif vers le BAS, celui du
// moteur vers le haut.
//
// ---------- CE QUI EST VRAIMENT PROPRE À LA MANETTE ----------
//
// LA ZONE MORTE. Un stick au repos ne rend jamais exactement zéro : il flotte entre 0,05 et
// 0,15 selon l'usure. Sans zone morte, un personnage dérive tout seul — et le joueur accuse le
// jeu, pas sa manette. L'amplitude est RÉÉTALÉE après retrait, pour qu'un petit geste juste
// au-delà du seuil ne saute pas d'un coup à 0,25. C'est la même courbe que le joystick tactile
// (`joystickVector`, js/touch-input.js), en une dimension.
//
// LE BRANCHEMENT À CHAUD. `navigator.getGamepads()` rend la liste vivante à chaque appel : une
// manette branchée en cours de partie apparaît toute seule, une manette débranchée disparaît.
// Rien à écouter, rien à retenir.
//
// LA NORME N'EST PAS UNE GARANTIE. Les indices de boutons ci-dessous sont ceux du « standard
// gamepad » du W3C, que respectent les manettes Xbox, PlayStation et la plupart des
// compatibles. Une manette exotique rend `mapping: ''` et ses indices ne veulent rien dire ;
// c'est précisément pour ça que les liaisons sont dans la table du projet et pas en dur ici.

/**
 * Les boutons de la disposition standard, avec leur nom d'affichage. Sert au panneau Entrées
 * pour proposer autre chose que des numéros, et à l'aide.
 *
 * Les noms sont ceux de la manette Xbox parce qu'il faut bien choisir, avec l'équivalent
 * PlayStation entre parenthèses — un joueur reconnaît toujours la sienne dans l'une des deux.
 */
export const GAMEPAD_BUTTONS = [
  {index: 0, label: 'A (croix)'},          {index: 1, label: 'B (rond)'},
  {index: 2, label: 'X (carré)'},          {index: 3, label: 'Y (triangle)'},
  {index: 4, label: 'LB (L1)'},            {index: 5, label: 'RB (R1)'},
  {index: 6, label: 'LT (L2)'},            {index: 7, label: 'RT (R2)'},
  {index: 8, label: 'Sélection'},          {index: 9, label: 'Menu'},
  {index: 10, label: 'Stick gauche'},      {index: 11, label: 'Stick droit'},
  {index: 12, label: 'Croix ↑'},           {index: 13, label: 'Croix ↓'},
  {index: 14, label: 'Croix ←'},           {index: 15, label: 'Croix →'}
];

/** Les axes de la disposition standard. */
export const GAMEPAD_AXES = [
  {index: 0, label: 'Stick gauche ↔'}, {index: 1, label: 'Stick gauche ↕'},
  {index: 2, label: 'Stick droit ↔'},  {index: 3, label: 'Stick droit ↕'}
];

// Le seuil au-delà duquel une gâchette analogique (LT/RT) compte comme un bouton enfoncé. Une
// gâchette rend une valeur continue ; le jeu, lui, veut savoir si elle est pressée.
export const TRIGGER_THRESHOLD = 0.35;

// La zone morte par défaut. 0,18 laisse passer les sticks usés sans qu'on sente le seuil.
export const DEAD_ZONE_DEFAULT = 0.18;

/** L'état partagé : valeurs d'axes analogiques écrites par la manette, et ce qui est branché. */
export const gamepadState = {axes: {}, connected: 0, mapping: ''};

/**
 * Retire la zone morte et réétale l'amplitude restante sur [0, 1].
 *
 * Même courbe que `joystickVector` (js/touch-input.js), en une dimension : sans le
 * réétalement, la valeur sauterait de 0 à la valeur du seuil dès qu'on quitte le repos.
 */
export function applyDeadZone(value, deadZone){
  const v = Number(value) || 0;
  const dz = Math.max(0, Math.min(0.95, (deadZone === undefined) ? DEAD_ZONE_DEFAULT : deadZone));
  const m = Math.abs(v);
  if(m <= dz) return 0;
  return Math.sign(v) * ((m - dz) / (1 - dz));
}

/** La touche synthétique d'un bouton. Le préfixe est ce qui la distingue d'une vraie touche. */
export function keyOfButton(index){ return 'pad:' + index; }

/**
 * Décode une source analogique (`'pad:axis0'`, `'pad:axis1-'`) : l'indice d'axe et le sens.
 * Rend `null` si ce n'en est pas une — la troisième case d'un axe de projet est facultative, et
 * peut très bien contenir autre chose un jour.
 */
export function parseAxisSource(source){
  const m = /^pad:axis(\d+)(-?)$/.exec(String(source || ''));
  if(!m) return null;
  return {index: Number(m[1]), sign: m[2] === '-' ? -1 : 1};
}

/**
 * La photo de Steam Input, ou `null` hors de l'application Steam.
 *
 * ---------- STEAM INPUT : CE QU'IL AJOUTE, ET CE QU'IL NE REMPLACE PAS ----------
 *
 * Lancé par Steam, le jeu reçoit déjà les manettes par l'API Gamepad du navigateur : Steam Input
 * présente à Chromium une manette Xbox virtuelle, et tout ce fichier marche tel quel. La boucle
 * `pollGamepads` ci-dessous reste donc la base, et ne change pas.
 *
 * Steam Input COMPLÈTE par ce que la couche Xbox virtuelle ne peut pas dire :
 *  · des ACTIONS NOMMÉES (`jump`, `interact`…) que le joueur reconfigure dans Steam, par manette,
 *    sans toucher au jeu — l'action `jump` de Steam rend vraie l'action `jump` du projet ;
 *  · le TYPE de la manette (PS5, Switch Pro, Steam Deck…), pour afficher les bons glyphes.
 *
 * Les actions Steam entrent comme des touches, au même titre que `pad:0` : `steam:<action>`. Le
 * lien avec l'action du même nom est posé d'office par `actionActive` (scripts.js, game-runtime.js).
 * Les deux sticks `Move` et `Look` alimentent les mêmes axes nommés que `pad:axis0..3`, avec la même
 * zone morte. Les noms d'actions viennent du projet : `steam/game_actions.vdf`, engendré à l'export
 * bureau, les déclare à Steam (js/build-desktop.js).
 *
 * Le pont rend la dernière photo reçue du processus principal : un appel synchrone, sans coût.
 */
export function steamInputSnapshot(){
  const b = globalThis.bureau;
  if(!b || !b.steam || !b.steam.available || typeof b.steam.input !== 'function') return null;
  let s = null;
  try{ s = b.steam.input(); } catch(e){ return null; }
  return (s && typeof s === 'object') ? s : null;
}

/**
 * Les axes bruts d'une photo Steam Input, DANS LA CONVENTION DE L'API GAMEPAD : `[Move.x, Move.y,
 * Look.x, Look.y]` avec Y positif vers le BAS. Steam rend Y positif vers le haut, d'où l'inversion :
 * c'est ce qui permet de réutiliser `pad:axis1-` tel quel, sans table d'entrées spéciale.
 */
export function steamRawAxes(snap){
  const a = (snap && snap.analog) || {};
  const move = a.Move || {};
  const look = a.Look || {};
  const n = function(v){ return (typeof v === 'number' && Number.isFinite(v)) ? v : 0; };
  return [n(move.x), -n(move.y), n(look.x), -n(look.y)];
}

/** Les manettes réellement branchées, liste vide si l'API n'existe pas (vieux navigateur). */
export function gamepadsConnected(){
  if(typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return [];
  let list;
  // Certains navigateurs lèvent si la page n'a pas encore reçu de geste utilisateur.
  try{ list = navigator.getGamepads(); } catch(e){ return []; }
  const out = [];
  for(let i = 0; i < (list ? list.length : 0); i++){
    if(list[i] && list[i].connected) out.push(list[i]);
  }
  return out;
}

/**
 * UN TOUR DE BOUCLE. Pose les touches synthétiques dans `keys` et calcule les axes analogiques.
 *
 * `keys` est le MÊME `Set` que celui du clavier — voir l'en-tête. `inputs` est la table
 * d'entrées du projet, dont on ne lit que `axes` (pour savoir quel stick alimente quel axe
 * nommé) et `deadZone`.
 *
 * Rend le nombre de manettes lues, pour que l'appelant puisse l'afficher.
 */
export function pollGamepads(keys, inputs){
  const pads = gamepadsConnected();
  const steam = steamInputSnapshot();
  gamepadState.connected = pads.length;
  gamepadState.mapping = pads.length ? (pads[0].mapping || '') : '';

  // RIEN DE BRANCHÉ : on efface ce qu'on avait posé, et on sort. Sans cet effacement, débrancher
  // une manette au moment où l'on pousse le stick laisserait le personnage courir pour
  // toujours — et c'est le genre de panne qu'on met une heure à relier à sa cause.
  // (Une photo Steam Input vide compte comme rien : elle n'a ni action ni stick poussé.)
  if(!pads.length && !steamHasInput(steam)){
    if(keys) clearGamepadKeys(keys);
    gamepadState.axes = {};
    return 0;
  }

  const deadZone = (inputs && typeof inputs.deadZone === 'number')
    ? inputs.deadZone : DEAD_ZONE_DEFAULT;

  // LES BOUTONS DE TOUTES LES MANETTES SONT FONDUS. Deux joueurs sur la même machine passent
  // par le réseau local, pas par deux manettes sur un même clavier : fondre est le bon
  // comportement par défaut, et c'est aussi ce qui fait qu'une manette branchée en second
  // marche sans rien configurer.
  const presses = new Set();
  // Les ACTIONS de Steam Input entrent par le même jeu de touches, sous `steam:<action>`.
  if(steam && steam.digital){
    Object.keys(steam.digital).forEach(function(name){
      if(steam.digital[name]) presses.add('steam:' + name);
    });
  }
  pads.forEach(function(pad){
    const buttons = pad.buttons || [];
    for(let i = 0; i < buttons.length; i++){
      const b = buttons[i];
      const enfonce = b && (b.pressed || (typeof b.value === 'number' && b.value > TRIGGER_THRESHOLD));
      if(enfonce) presses.add(keyOfButton(i));
    }
  });
  if(keys){
    clearGamepadKeys(keys);
    presses.forEach(function(k){ keys.add(k); });
  }

  // LES AXES NOMMÉS. On ne lit que ceux que le projet a explicitement branchés : un axe sans
  // troisième case reste piloté par ses deux actions, donc par le clavier ou la croix.
  const axes = {};
  const table = (inputs && inputs.axes) || {};
  Object.keys(table).forEach(function(name){
    const src = parseAxisSource((table[name] || [])[2]);
    if(!src) return;
    let best = 0;
    const sources = pads.map(function(pad){ return pad.axes; });
    if(steam) sources.push(steamRawAxes(steam));   // la manette « virtuelle » de Steam Input
    sources.forEach(function(raw){
      const brut = (raw && raw.length > src.index) ? raw[src.index] : 0;
      const v = applyDeadZone(brut * src.sign, deadZone);
      if(Math.abs(v) > Math.abs(best)) best = v;
    });
    axes[name] = best;
  });
  gamepadState.axes = axes;
  return pads.length;
}

/** La photo Steam Input porte-t-elle quelque chose (action tenue ou stick poussé) ? */
function steamHasInput(snap){
  if(!snap) return false;
  if(snap.digital && Object.keys(snap.digital).some(function(k){ return snap.digital[k]; })) return true;
  return steamRawAxes(snap).some(function(v){ return v !== 0; });
}

/** Retire du jeu de touches toutes celles que la manette y avait posées, et elles seules. */
export function clearGamepadKeys(keys){
  if(!keys || typeof keys.forEach !== 'function') return;
  const aRetirer = [];
  keys.forEach(function(k){
    if(typeof k === 'string' && (k.indexOf('pad:') === 0 || k.indexOf('steam:') === 0)) aRetirer.push(k);
  });
  aRetirer.forEach(function(k){ keys.delete(k); });
}

/** La valeur manette d'un axe nommé, 0 si aucun stick ne la pilote. */
export function gamepadAxis(name){
  const v = gamepadState.axes[name];
  return (typeof v === 'number' && Number.isFinite(v)) ? v : 0;
}

/**
 * Fait vibrer la manette. `force` dans [0, 1], `ms` en millisecondes.
 *
 * Silencieuse quand le matériel ne sait pas vibrer — c'est le cas de beaucoup de manettes sur
 * beaucoup de navigateurs, et un jeu ne doit pas en dépendre. Rend `true` si la demande est
 * partie, pour que l'appelant puisse le savoir sans avoir à deviner.
 */
export function rumble(force, ms){
  const pads = gamepadsConnected();
  let parti = false;
  pads.forEach(function(pad){
    const a = pad.vibrationActuator;
    if(!a || typeof a.playEffect !== 'function') return;
    try{
      a.playEffect('dual-rumble', {
        duration: Math.max(0, Math.min(5000, Number(ms) || 200)),
        strongMagnitude: Math.max(0, Math.min(1, Number(force) || 0)),
        weakMagnitude: Math.max(0, Math.min(1, Number(force) || 0))
      });
      parti = true;
    } catch(e){ /* le matériel refuse : ce n'est pas une panne du jeu */ }
  });
  return parti;
}

// EXPOSÉ EN GLOBALE, à dessein — même régime que js/touch-input.js et js/render-perf.js : ces
// symboles sont appelés depuis des fichiers que toutes les pages ne chargent pas, donc derrière
// un `typeof`. Voir docs/ARCHITECTURE.md.
globalThis.pollGamepads = pollGamepads;
globalThis.gamepadAxis = gamepadAxis;
globalThis.gamepadState = gamepadState;
globalThis.rumbleGamepad = rumble;
