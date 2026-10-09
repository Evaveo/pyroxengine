// moteur/js/build-desktop.js
//
// L'EXPORT BUREAU : un projet Electron prêt à compiler, autour du build web.
//
// ---------- CE QUE L'ÉDITEUR PEUT ET NE PEUT PAS ----------
//
// Il tourne dans un onglet. Il ne peut donc PAS produire un `.exe` : compiler un exécutable
// demande de lancer des processus et d'écrire sur le disque, et un navigateur ne fait ni l'un ni
// l'autre. Le prétendre serait la pire version de cette fonctionnalité.
//
// Ce qu'il produit est un **projet Electron complet et correct** : le jeu, l'enveloppe, et les
// deux commandes qui en font un exécutable. `npm install` puis `npm run dist`, et
// electron-builder rend un `.exe`, un `.dmg` ou un `.AppImage` selon la machine. C'est le
// chemin qu'emprunte n'importe quel studio, et il est écrit dans le LISEZMOI du ZIP.
//
// ---------- POURQUOI ELECTRON ET PAS TAURI ----------
//
// Tauri donne des binaires dix fois plus petits, en s'appuyant sur la WebView du système —
// WebView2 sur Windows, WKWebView sur macOS. Ce moteur rend en **WebGPU**, et la prise en charge
// de WebGPU dans ces WebView est inégale d'une version de système à l'autre. Un jeu qui rendrait
// correctement chez l'auteur et pas chez le joueur est exactement la famille de défauts que ce
// dépôt passe son temps à fermer.
//
// Electron embarque son Chromium : le jeu exporté rend ce que l'auteur a vu. Le prix est d'une
// centaine de mégaoctets par build, ce qui est la norme pour un jeu de bureau.
//
// ---------- LE PIÈGE QUI TUE TOUT SI ON L'IGNORE ----------
//
// `win.loadFile('index.html')` charge la page en `file://`, et Chromium REFUSE les modules ES
// en `file://` — règle d'origine, pas un réglage. Or ce moteur est entièrement fait de
// `<script type="module">`. Un Electron naïf donne donc une fenêtre noire, avec dans la console
// une erreur de CORS que personne ne relie à l'emballage.
//
// D'où le protocole maison `jeu://` enregistré dans `main.js` : la page est servie par un
// schéma déclaré standard et sûr, les modules se chargent, et `localStorage` fonctionne (ce qui
// est ce qui fait marcher les sauvegardes du jeu sans une ligne de plus).

/** La version d'Electron demandée. Voir `packageJsonDesktop` pour pourquoi c'est une plage. */
export const ELECTRON_RANGE = '>=30.0.0';
export const BUILDER_RANGE = '>=24.0.0';

/** Le dossier du ZIP qui contient le jeu. `main.js` et le protocole s'y réfèrent. */
export const DESKTOP_GAME_DIR = 'jeu';

//
// ---------- STEAM ----------
//
// Le SDK Steamworks est NATIF : il ne peut tourner que dans le processus principal d'Electron,
// jamais dans la page (qui reste en `sandbox` et sans Node, voir `preloadJsDesktop`). `main.js`
// l'initialise donc, et `preload.js` n'en expose que ce que le jeu a le droit de demander : des
// succès, des statistiques, les actions de Steam Input, et les sauvegardes (Steam Cloud).
//
// TOUT EST FACULTATIF. `steamworks.js` est chargé dans un `try` : sans le client Steam, sans
// le paquet, sans identifiant d'application, le jeu démarre quand même et `api.steam.available()`
// rend faux. Un export bureau reste donc un jeu qui se lance en double-cliquant, Steam ou pas.
// Côté jeu : js/steam-bridge.js.

/** La version de `steamworks.js` demandée. Plage, pour la même raison que `ELECTRON_RANGE`. */
export const STEAMWORKS_RANGE = '>=0.4.0';

/**
 * L'identifiant de test de Steam (« Spacewar »), que tout compte développeur peut utiliser pour
 * essayer l'intégration avant d'avoir son propre identifiant. Il est écrit dans `steam_appid.txt`
 * et le LISEZMOI dit de le remplacer.
 */
export const STEAM_TEST_APPID = 480;

/** Le jeu d'actions déclaré à Steam Input : le seul que le jeu active. */
export const STEAM_ACTION_SET = 'InGame';

/** Les deux sticks que Steam Input rend au jeu, sous ces noms exacts (js/gamepad-input.js). */
export const STEAM_STICKS = ['Move', 'Look'];

/** Un nom d'action que Steam accepte : lettre ou « _ » d'abord, puis lettres, chiffres, « _ ». */
export function isSteamActionName(name){
  return typeof name === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name);
}

/**
 * Ce que le jeu déclare à Steam Input, tiré de la table d'entrées du PROJET.
 *
 * Chaque action nommée du projet (`jump`, `interact`…) devient une action numérique : c'est ce
 * qui permet au joueur de la rebrancher à sa guise dans Steam, et c'est le même nom que
 * `api.action('jump')` — js/gamepad-input.js fait le lien sans table de plus. Les sticks `Move` et
 * `Look` ne sont déclarés que si un axe du projet a une source analogique (`pad:axis0`…) : sinon
 * ils n'alimenteraient rien.
 *
 * Un nom que Steam refuserait est ÉCARTÉ plutôt que de rendre tout le fichier invalide.
 */
export function steamInputDefinition(inputs){
  const actions = (inputs && inputs.actions) || {};
  const axes = (inputs && inputs.axes) || {};
  const digital = Object.keys(actions).filter(isSteamActionName);
  const analogue = Object.keys(axes).some(function(n){
    return /^pad:axis[0-9]+-?$/.test(String((axes[n] || [])[2] || ''));
  });
  return {set: STEAM_ACTION_SET, digital: digital, analog: analogue ? STEAM_STICKS.slice() : []};
}

/**
 * Le fichier d'actions de Steam Input (`game_actions_<AppID>.vdf`), à déposer dans Steamworks
 * (Édition de l'application > Steam Input). Les ACTIONS sont déclarées ici ; la liaison par défaut
 * de chaque manette (quel bouton fait `jump`) se règle dans l'outil de configuration de Steam, qui
 * valide le fichier au dépôt.
 */
export function steamActionsVdf(def){
  const tab = function(n){ return '\t'.repeat(n); };
  const quoted = function(s){ return '"' + String(s) + '"'; };
  const pair = function(n, k, v){ return tab(n) + quoted(k) + '\t' + quoted(v) + '\n'; };
  let out = '"In Game Actions"\n{\n' + tab(1) + '"actions"\n' + tab(1) + '{\n';
  out += tab(2) + quoted(def.set) + '\n' + tab(2) + '{\n';
  out += pair(3, 'title', '#Set_' + def.set);
  if(def.analog.length){
    out += tab(3) + '"StickPadGyro"\n' + tab(3) + '{\n';
    def.analog.forEach(function(n){
      out += tab(4) + quoted(n) + '\n' + tab(4) + '{\n';
      out += pair(5, 'title', '#Action_' + n);
      out += pair(5, 'input_mode', 'joystick_move');
      out += tab(4) + '}\n';
    });
    out += tab(3) + '}\n';
  }
  if(def.digital.length){
    out += tab(3) + '"Button"\n' + tab(3) + '{\n';
    def.digital.forEach(function(n){ out += pair(4, n, '#Action_' + n); });
    out += tab(3) + '}\n';
  }
  out += tab(2) + '}\n' + tab(1) + '}\n' + tab(1) + '"localization"\n' + tab(1) + '{\n';
  // Steam exige l'anglais ; le français suit, avec les mêmes libellés — le jeu est écrit en français.
  ['english', 'french'].forEach(function(lang){
    out += tab(2) + quoted(lang) + '\n' + tab(2) + '{\n';
    out += pair(3, 'Set_' + def.set, 'In Game');
    def.analog.forEach(function(n){ out += pair(3, 'Action_' + n, n === 'Move' ? 'Move' : 'Look'); });
    def.digital.forEach(function(n){ out += pair(3, 'Action_' + n, n); });
    out += tab(2) + '}\n';
  });
  out += tab(1) + '}\n}\n';
  return out;
}

/**
 * Un identifiant d'application au format inverse du nom de domaine, exigé par macOS et
 * Windows. Fabriqué depuis le nom du projet, et TOUJOURS valide : un identifiant vide fait
 * échouer la compilation avec un message qui ne désigne pas le projet.
 */
export function appIdOf(name){
  const slug = String(name || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return 'com.evaveo.' + (slug || 'jeu');
}

/**
 * Le `package.json` du projet Electron.
 *
 * LES VERSIONS SONT DES PLAGES, et c'est délibéré. Épingler un numéro que je ne peux pas
 * vérifier rendrait le `npm install` impossible le jour où ce numéro n'existe pas ou plus ;
 * une plage se résout toujours. Le LISEZMOI dit comment épingler après la première
 * installation, ce qu'un studio doit faire pour que deux compilations rendent le même binaire.
 *
 * `files` liste ce qui entre dans le binaire. Sans elle, electron-builder embarquerait
 * `node_modules` en entier — plusieurs centaines de mégaoctets de dépendances de compilation
 * dans un jeu qui n'en utilise aucune. `steamworks.js` est une `dependency` (pas une
 * `devDependency`) : c'est ce qui le fait entrer dans le binaire malgré `files`. Son dossier est
 * DÉPAQUETÉ (`asarUnpack`) : il contient un module natif et la bibliothèque de Steam
 * (`steam_api64.dll`…), qu'un système ne charge pas depuis une archive.
 */
export function packageJsonDesktop(name){
  const slug = appIdOf(name).split('.').pop();
  return JSON.stringify({
    name: slug,
    productName: String(name || 'Jeu'),
    version: '1.0.0',
    description: 'Jeu produit par l\'éditeur 3D Evaveo.',
    main: 'main.js',
    scripts: {
      start: 'electron .',
      dist: 'electron-builder'
    },
    dependencies: {
      'steamworks.js': STEAMWORKS_RANGE
    },
    devDependencies: {
      electron: ELECTRON_RANGE,
      'electron-builder': BUILDER_RANGE
    },
    build: {
      appId: appIdOf(name),
      productName: String(name || 'Jeu'),
      files: ['main.js', 'preload.js', 'steam_input.json', DESKTOP_GAME_DIR + '/**'],
      asarUnpack: ['**/node_modules/steamworks.js/**'],
      win: {target: 'nsis'},
      mac: {target: 'dmg'},
      linux: {target: 'AppImage'}
    }
  }, null, 2) + '\n';
}

/**
 * Le processus principal : une fenêtre, un protocole, et Steam.
 *
 * LE PROTOCOLE MAISON EST LA PIÈCE ESSENTIELLE — voir l'en-tête. `standard: true` donne à
 * `jeu://` une origine véritable, ce qui débloque les modules ES ET le stockage local ;
 * `secure: true` le place au même rang que `https:` pour les règles de contenu mixte.
 *
 * LE CHEMIN DEMANDÉ EST VÉRIFIÉ. Une requête `jeu://app/../../etc/passwd` sortirait du dossier
 * du jeu : on résout, puis on refuse ce qui n'est pas dedans. C'est une application locale, mais
 * elle chargera un jour du contenu que l'auteur n'a pas écrit — une page de classement, une
 * publicité — et cette ligne-là ne coûte rien aujourd'hui.
 *
 * LES MESSAGES VENUS DE LA PAGE SONT VÉRIFIÉS aussi : seul un cadre servi par `jeu://` est
 * écouté, et chaque nom (succès, statistique, fichier de sauvegarde) passe par une liste blanche
 * de caractères. Un nom de fichier ne sort jamais du dossier des sauvegardes.
 *
 * ATTENTION, ce gabarit est une chaîne : PAS de barre oblique inverse dans le code engendré
 * (`\w`, `\.`) — dans un gabarit, c'est une séquence d'échappement invalide.
 */
export function mainJsDesktop(){
  return `// Processus principal Electron — engendré par l'éditeur 3D Evaveo.
//
// NE PAS remplacer le protocole « jeu:// » par win.loadFile() : Chromium refuse les modules ES
// servis en file://, et tout ce moteur est fait de <script type="module">. La fenêtre serait
// noire, avec une erreur de CORS que rien ne relie à l'emballage.
const { app, BrowserWindow, Menu, protocol, net, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const RACINE_JEU = path.join(__dirname, ${JSON.stringify(DESKTOP_GAME_DIR)});

protocol.registerSchemesAsPrivileged([{
  scheme: 'jeu',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
}]);

// ---------- Steam ----------
// Tout est dans un try : sans client Steam, sans le paquet, sans identifiant, le jeu démarre
// quand même et la page voit \`available: false\`.
let steam = null;
let steamInfo = { available: false };

function readAppId(){
  try{
    const n = parseInt(fs.readFileSync(path.join(__dirname, 'steam_appid.txt'), 'utf8').trim(), 10);
    return n > 0 ? n : undefined;
  } catch(e){ return undefined; }
}

function initSteam(){
  try{
    const sw = require('steamworks.js');
    // Sans identifiant, le SDK lit celui que Steam pose quand il lance le jeu.
    steam = sw.init(readAppId());
    // Avant 'ready' : l'overlay Steam demande deux options de ligne de commande.
    sw.electronEnableSteamOverlay();
    steamInfo = {
      available: true,
      name: steam.localplayer.getName(),
      language: steam.apps.currentGameLanguage(),
      deck: steam.utils.isSteamRunningOnSteamDeck()
    };
  } catch(e){
    steam = null;
    steamInfo = { available: false };
    console.warn('[steam] indisponible : ' + (e && e.message ? e.message : e));
  }
}
initSteam();

// Un cadre servi par notre protocole, et nul autre : une page tierce n'a rien à demander à Steam.
function isFromPage(e){
  return !!(e && e.senderFrame && String(e.senderFrame.url).indexOf('jeu://') === 0);
}

// Réponse SYNCHRONE à la page. \`e.returnValue\` doit TOUJOURS être posé, sinon la page se bloque :
// d'où ce gabarit unique, qui répond \`repli\` quand la demande est refusée ou échoue.
function onSync(channel, handler, fallback){
  ipcMain.on(channel, function(e, a, b){
    let r = fallback;
    try{ if(isFromPage(e)) r = handler(a, b); } catch(err){ console.warn('[' + channel + '] ' + err.message); }
    e.returnValue = r;
  });
}

const STEAM_NAME = /^[A-Za-z0-9_.-]{1,128}$/;
const isValidName = function(name){ return typeof name === 'string' && STEAM_NAME.test(name); };

// Les statistiques sont envoyées à Steam en différé : un compteur qui monte à chaque ennemi tué
// ne doit pas faire autant d'appels réseau.
let storeScheduled = null;
function storeSoon(){
  if(storeScheduled || !steam) return;
  storeScheduled = setTimeout(function(){
    storeScheduled = null;
    try{ steam.stats.store(); } catch(e){ /* Steam refuse : la prochaine tentative réessaiera */ }
  }, 2000);
}

onSync('steam:info', function(){ return steamInfo; }, { available: false });
onSync('steam:unlock', function(id){
  if(!steam || !isValidName(id)) return false;
  const ok = steam.achievement.activate(id);
  storeSoon();
  return !!ok;
}, false);
onSync('steam:clear', function(id){
  if(!steam || !isValidName(id)) return false;
  const ok = steam.achievement.clear(id);
  storeSoon();
  return !!ok;
}, false);
onSync('steam:is-unlocked', function(id){
  return !!(steam && isValidName(id) && steam.achievement.isActivated(id));
}, false);
onSync('steam:stat-get', function(name){
  if(!steam || !isValidName(name)) return 0;
  const v = steam.stats.getInt(name);
  return typeof v === 'number' ? v : 0;
}, 0);
onSync('steam:stat-set', function(name, value){
  if(!steam || !isValidName(name) || !Number.isFinite(value)) return false;
  const ok = steam.stats.setInt(name, Math.trunc(value));
  storeSoon();
  return !!ok;
}, false);
onSync('steam:stat-add', function(name, delta){
  if(!steam || !isValidName(name) || !Number.isFinite(delta)) return 0;
  const courant = steam.stats.getInt(name);
  const suivant = (typeof courant === 'number' ? courant : 0) + Math.trunc(delta);
  steam.stats.setInt(name, suivant);
  storeSoon();
  return suivant;
}, 0);

// ---------- Steam Input ----------
// \`steam_input.json\` (engendré avec le projet) dit quelles actions interroger. Le processus
// principal les lit 60 fois par seconde et n'envoie à la page QUE ce qui change.
let lastInput = '';
function initInput(){
  if(!steam) return;
  let def;
  try{ def = JSON.parse(fs.readFileSync(path.join(__dirname, 'steam_input.json'), 'utf8')); }
  catch(e){ return; }
  if(!def || !Array.isArray(def.digital) || !Array.isArray(def.analog)) return;
  if(!def.digital.length && !def.analog.length) return;
  try{
    steam.input.init();
    const actionSet = steam.input.getActionSet(def.set);
    const digitalActions = def.digital.map(function(n){ return { name: n, h: steam.input.getDigitalAction(n) }; });
    const analogActions = def.analog.map(function(n){ return { name: n, h: steam.input.getAnalogAction(n) }; });
    setInterval(function(){
      const digitalOut = {};
      const analogOut = {};
      let type = '';
      steam.input.getControllers().forEach(function(c){
        c.activateActionSet(actionSet);
        if(!type) type = String(c.getType());
        digitalActions.forEach(function(a){ if(c.isDigitalActionPressed(a.h)) digitalOut[a.name] = true; });
        analogActions.forEach(function(a){
          const v = c.getAnalogActionVector(a.h);
          const x = Math.round(v.x * 1000) / 1000;
          const y = Math.round(v.y * 1000) / 1000;
          const p = analogOut[a.name];
          if(!p || Math.abs(x) + Math.abs(y) > Math.abs(p.x) + Math.abs(p.y)) analogOut[a.name] = { x: x, y: y };
        });
      });
      const snapshot = { type: type, digital: digitalOut, analog: analogOut };
      const text = JSON.stringify(snapshot);
      if(text === lastInput) return;
      lastInput = text;
      if(fenetre && !fenetre.isDestroyed()) fenetre.webContents.send('steam:input', snapshot);
    }, 16);
  } catch(e){
    console.warn('[steam] Steam Input indisponible : ' + e.message);
  }
}

// ---------- Sauvegardes (Steam Cloud) ----------
// Steam Cloud quand il est activé pour ce compte ET cette application ; sinon un dossier du profil
// de l'utilisateur. Le dossier local est écrit dans les deux cas : la partie survit à une
// désactivation du cloud, et à un Steam qui refuse l'écriture.
const SAVE_NAME = /^jeu3d-[A-Za-z0-9_-]{1,80}[.]json$/;
const SAVE_MAX = 4 * 1024 * 1024;

function savesDir(){
  const d = path.join(app.getPath('userData'), 'saves');
  fs.mkdirSync(d, { recursive: true });
  return d;
}
function cloudActive(){
  try{ return !!(steam && steam.cloud.isEnabledForApp() && steam.cloud.isEnabledForAccount()); }
  catch(e){ return false; }
}
const isSaveName = function(n){ return typeof n === 'string' && SAVE_NAME.test(n); };

onSync('cloud:read', function(name){
  if(!isSaveName(name)) return null;
  if(cloudActive() && steam.cloud.fileExists(name)) return steam.cloud.readFile(name);
  const f = path.join(savesDir(), name);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
}, null);
onSync('cloud:write', function(name, text){
  if(!isSaveName(name) || typeof text !== 'string' || text.length > SAVE_MAX) return false;
  let ok = false;
  fs.writeFileSync(path.join(savesDir(), name), text, 'utf8');
  ok = true;
  if(cloudActive()) steam.cloud.writeFile(name, text);
  return ok;
}, false);
onSync('cloud:remove', function(name){
  if(!isSaveName(name)) return false;
  const f = path.join(savesDir(), name);
  if(fs.existsSync(f)) fs.unlinkSync(f);
  if(cloudActive() && steam.cloud.fileExists(name)) steam.cloud.deleteFile(name);
  return true;
}, false);

// ---------- La fenêtre ----------
let fenetre = null;

function creerFenetre(){
  fenetre = new BrowserWindow({
    width: 1280,
    height: 720,
    backgroundColor: '#0d0f12',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  // Le menu par défaut d'Electron (Fichier, Édition, Affichage…) n'a aucun sens dans un jeu.
  Menu.setApplicationMenu(null);
  // On n'affiche qu'une fois la page prête : sinon le joueur voit une fenêtre blanche pendant
  // le chargement du moteur, ce qui ressemble à un plantage.
  fenetre.once('ready-to-show', function(){ fenetre.show(); });
  fenetre.loadURL('jeu://app/index.html');
  fenetre.on('closed', function(){ fenetre = null; });
}

app.whenReady().then(function(){
  protocol.handle('jeu', function(requete){
    const url = new URL(requete.url);
    const demande = decodeURIComponent(url.pathname);
    const cible = path.join(RACINE_JEU, demande);
    // Le chemin demandé doit RESTER dans le dossier du jeu. « jeu://app/../../secret » sortirait
    // sinon, et une page qu'on n'a pas écrite finit toujours par en demander une.
    const dedans = path.relative(RACINE_JEU, cible);
    if(dedans.startsWith('..') || path.isAbsolute(dedans)){
      return new Response('chemin refusé', { status: 403 });
    }
    return net.fetch(pathToFileURL(cible).toString());
  });
  initInput();
  creerFenetre();
  app.on('activate', function(){
    if(BrowserWindow.getAllWindows().length === 0) creerFenetre();
  });
});

// Les statistiques en attente partent avant la fermeture, sinon un succès gagné dans les deux
// dernières secondes serait perdu.
app.on('before-quit', function(){
  if(steam){ try{ steam.stats.store(); } catch(e){ /* fermeture : rien à faire de plus */ } }
});

// Sur macOS, fermer la fenêtre ne quitte pas l'application : c'est la convention du système.
app.on('window-all-closed', function(){
  if(process.platform !== 'darwin') app.quit();
});

ipcMain.on('jeu:quitter', function(){ app.quit(); });
ipcMain.on('jeu:plein-ecran', function(evenement, actif){
  if(fenetre) fenetre.setFullScreen(!!actif);
});
`;
}

/**
 * Le pont entre le jeu et le système, réduit au strict nécessaire.
 *
 * `contextIsolation` reste ACTIF et `nodeIntegration` ÉTEINT : un jeu peut exécuter des scripts
 * de projet, et ce moteur laisse déjà ouvrir le projet d'autrui (js/script-trust.js). Exposer
 * Node à la page reviendrait à donner le disque entier au premier script venu.
 *
 * Trois familles, donc, et rien de plus : quitter et le plein écran (les deux choses qu'une page
 * web ne sait pas faire), `steam` (succès, statistiques, Steam Input) et `cloud` (les
 * sauvegardes). Ni `fs` ni `steamworks.js` ne passent la frontière : la page ne peut demander
 * que ces appels nommés, et c'est `main.js` qui vérifie chaque argument.
 */
export function preloadJsDesktop(){
  return `// Pont jeu ↔ système — engendré par l'éditeur 3D Evaveo.
// Volontairement minuscule : contextIsolation reste actif et Node n'est PAS exposé à la page.
const { contextBridge, ipcRenderer } = require('electron');

const info = ipcRenderer.sendSync('steam:info') || { available: false };

// La dernière photo de Steam Input envoyée par le processus principal : la page la lit sans attente.
let lastInput = null;
ipcRenderer.on('steam:input', function(evenement, snapshot){ lastInput = snapshot; });

contextBridge.exposeInMainWorld('bureau', {
  version: process.versions.electron,
  quitter: function(){ ipcRenderer.send('jeu:quitter'); },
  pleinEcran: function(actif){ ipcRenderer.send('jeu:plein-ecran', actif !== false); },
  steam: {
    available: !!info.available,
    info: info,
    unlock: function(id){ return ipcRenderer.sendSync('steam:unlock', id); },
    clear: function(id){ return ipcRenderer.sendSync('steam:clear', id); },
    isUnlocked: function(id){ return ipcRenderer.sendSync('steam:is-unlocked', id); },
    getStat: function(name){ return ipcRenderer.sendSync('steam:stat-get', name); },
    setStat: function(name, value){ return ipcRenderer.sendSync('steam:stat-set', name, value); },
    addStat: function(name, delta){ return ipcRenderer.sendSync('steam:stat-add', name, delta); },
    input: function(){ return lastInput; }
  },
  cloud: {
    read: function(name){ return ipcRenderer.sendSync('cloud:read', name); },
    write: function(name, text){ return ipcRenderer.sendSync('cloud:write', name, text); },
    remove: function(name){ return ipcRenderer.sendSync('cloud:remove', name); }
  }
});
`;
}

/** Le mode d'emploi. Deux commandes, et ce qu'il faut savoir avant de livrer. */
export function readmeDesktop(name){
  return `# ${name || 'Jeu'} — version bureau

Ce dossier est un projet **Electron** prêt à compiler. Il contient votre jeu (\`${DESKTOP_GAME_DIR}/\`)
et l'enveloppe qui en fait une application.

## Compiler

\`\`\`
npm install
npm run dist
\`\`\`

Le binaire arrive dans \`dist/\` : un \`.exe\` sous Windows, un \`.dmg\` sous macOS, un
\`.AppImage\` sous Linux. **On compile sur la machine cible** : electron-builder ne fabrique pas
un \`.dmg\` depuis Windows.

Pour lancer sans compiler, le temps d'un essai : \`npm start\`.

## Avant de livrer

- **Épinglez les versions.** Le \`package.json\` demande des PLAGES (\`${ELECTRON_RANGE}\`) pour
  que \`npm install\` réussisse aujourd'hui comme dans six mois. Une fois l'installation faite,
  figez-les — \`npm install --save-exact electron electron-builder steamworks.js\` — sinon deux
  compilations à deux dates ne rendront pas le même binaire.
- **Signez l'application.** Sans signature, Windows affiche un avertissement SmartScreen et
  macOS refuse tout simplement de l'ouvrir. La signature se règle dans la section \`build\` du
  \`package.json\` ; c'est un certificat payant, et c'est à prévoir avant la date de sortie, pas
  après.
- **L'icône** se pose dans \`build/icon.ico\` (Windows) et \`build/icon.icns\` (macOS) —
  electron-builder les prend là sans qu'on ait rien à déclarer.

## Ce qu'il ne faut pas changer

\`main.js\` sert le jeu par un protocole maison \`jeu://\` au lieu de \`file://\`. Ce n'est pas
une coquetterie : Chromium **refuse les modules ES en \`file://\`**, et tout ce moteur en est
fait. Remplacer ce protocole par \`win.loadFile()\` donne une fenêtre noire.

## Ce que le jeu gagne

\`\`\`js
api.desktop()     // vrai dans l'application, faux dans un navigateur
api.quitGame()    // ferme l'application — impossible depuis une page web
\`\`\`

Les sauvegardes (\`api.save\` / \`api.load\`) sont écrites dans \`localStorage\` **et** dans un
dossier du profil de l'utilisateur ; avec Steam Cloud activé, aussi dans le cloud.

## Steam

Le jeu fonctionne sans Steam : sans le client, \`api.steam.available()\` rend faux et tout le reste
est inerte. Pour le brancher :

1. **Essai.** \`steam_appid.txt\` contient \`${STEAM_TEST_APPID}\` (l'application de test « Spacewar »).
   Client Steam ouvert, \`npm start\` suffit pour essayer succès et statistiques — créez-les
   d'abord dans Steamworks, sous votre propre identifiant (remplacez le numéro).
2. **Succès et statistiques.** À déclarer dans Steamworks (Statistiques et succès). Le jeu les
   appelle par leur identifiant : \`api.steam.unlockAchievement('ACH_BOSS_1')\`,
   \`api.steam.addStat('monstres_tues', 1)\`. Les statistiques sont entières.
3. **Steam Cloud.** Dans Steamworks (Cloud Steam), activez-le et réservez de la place. Les parties
   sont les fichiers \`jeu3d-*.json\` : rien d'autre à configurer côté jeu.
4. **Steam Input.** Déposez \`steam/game_actions.vdf\` dans Steamworks (Steam Input), puis réglez la
   configuration par défaut de chaque manette dans l'outil de Steam. Chaque action de votre table
   d'entrées devient une action Steam du même nom, que le joueur peut rebrancher ; le jeu garde
   en plus la manette « Xbox virtuelle » que Steam présente déjà.
5. **Livraison.** \`steam_appid.txt\` n'entre PAS dans le binaire : Steam lance le jeu avec le bon
   identifiant. Si l'initialisation échoue dans le binaire compilé, vérifiez que la bibliothèque
   de Steam (\`steam_api64.dll\`, \`libsteam_api.so\`…) est bien dépaquetée à côté du module natif.
`;
}

/**
 * Les fichiers de l'enveloppe, hors jeu. Séparés pour être testables sans rien télécharger.
 *
 * `options.inputs` est la table d'entrées du projet (`project.inputs`) : elle donne les actions
 * déclarées à Steam Input. Sans elle, aucune action n'est déclarée et Steam Input reste muet —
 * le jeu garde la manette par l'API Gamepad.
 */
export function desktopWrapperFiles(name, options){
  const def = steamInputDefinition(options && options.inputs);
  return {
    'package.json': packageJsonDesktop(name),
    'main.js': mainJsDesktop(),
    'preload.js': preloadJsDesktop(),
    'steam_appid.txt': STEAM_TEST_APPID + '\n',
    'steam_input.json': JSON.stringify(def, null, 2) + '\n',
    'steam/game_actions.vdf': steamActionsVdf(def),
    'LISEZMOI.md': readmeDesktop(name),
    '.gitignore': 'node_modules/\ndist/\n'
  };
}
