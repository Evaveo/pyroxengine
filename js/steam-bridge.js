// moteur/js/steam-bridge.js
//
// STEAM, CÔTÉ JEU — module PARTAGÉ éditeur / jeu publié.
//
// ---------- CE QUE C'EST, ET CE QUE CE N'EST PAS ----------
//
// Le SDK Steamworks est NATIF : une page web ne peut pas l'appeler. Il vit dans le processus
// principal de l'application Electron (js/build-desktop.js, `main.js`), et `preload.js` en
// expose le strict nécessaire à la page sous `window.bureau.steam` et `window.bureau.cloud`.
// Ce fichier est l'autre bout du fil : il transforme ce pont en API de script (`api.steam`) et
// en sauvegardes (`api.save` / `api.load`).
//
// TOUT EST INERTE HORS STEAM. Dans l'éditeur, dans un navigateur, dans l'application de bureau
// lancée sans le client Steam : `available()` rend faux, les succès et les statistiques ne font
// rien et rendent `false` / `0`. Un script écrit pour Steam tourne donc partout sans condition —
// c'est le test de bonne conception, comme pour le multijoueur (`api.isAuthority`).
//
// ---------- LES SAUVEGARDES ----------
//
// `api.save` écrivait dans `localStorage` et rien d'autre. Dans l'application de bureau, il écrit
// aussi dans le dossier Steam Cloud (ou, sans Steam, dans un dossier du profil de l'utilisateur) :
// le joueur retrouve sa partie sur un autre PC ou sur la Steam Deck. `localStorage` reste écrit à
// chaque fois : il est le seul support dans un navigateur, et il garde la partie si le pont
// disparaît.
//
// À LA LECTURE, LE CLOUD GAGNE s'il a une copie : c'est la copie du compte, partagée entre les
// machines, et Steam arbitre lui-même un conflit entre deux machines. Sans copie cloud, on retombe
// sur `localStorage` — c'est ce qui fait qu'une partie commencée avant l'export bureau n'est pas
// perdue.

/** Le pont posé par `preload.js`, ou `null` dans un navigateur / l'éditeur. */
export function desktopBridge(){
  return globalThis.bureau || null;
}

/** Le pont Steam, seulement si le client Steam est réellement joignable. */
export function steamHandle(){
  const b = desktopBridge();
  return (b && b.steam && b.steam.available) ? b.steam : null;
}

/**
 * Un identifiant de succès ou une statistique valide. Le serveur Steam n'accepte que des noms
 * simples ; un nom invalide est refusé ICI plutôt que de traverser le pont pour échouer en silence.
 */
export function isSteamName(name){
  return typeof name === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(name);
}

/**
 * L'API `api.steam`. Une instance par appel est sans coût : elle ne retient rien, le pont est la
 * seule source d'état.
 */
export function makeSteamApi(warn){
  const say = (typeof warn === 'function') ? warn : function(){};
  function info(){ const s = steamHandle(); return (s && s.info) ? s.info : null; }
  function checked(name, what){
    if(isSteamName(name)) return true;
    say('api.steam.' + what + ' : « ' + name + ' » n\'est pas un nom valide (lettres, chiffres, _ . -)');
    return false;
  }
  return {
    /** Le client Steam est-il joignable ? Faux dans l'éditeur, un navigateur, ou hors Steam. */
    available: function(){ return !!steamHandle(); },
    /** Le nom du joueur sur Steam. Vide hors Steam. */
    playerName: function(){ const i = info(); return i ? String(i.name || '') : ''; },
    /** La langue du client Steam (`'french'`, `'english'`…). Vide hors Steam. */
    language: function(){ const i = info(); return i ? String(i.language || '') : ''; },
    /** Le jeu tourne-t-il sur une Steam Deck ? */
    onDeck: function(){ const i = info(); return !!(i && i.deck); },
    /**
     * Le type de la manette active selon Steam Input (`'PS5Controller'`, `'XBoxOneController'`,
     * `'SteamDeckController'`, `'SwitchProController'`…), pour afficher les bons glyphes de
     * boutons. Vide si aucune manette n'est vue par Steam.
     */
    controller: function(){
      const s = steamHandle();
      const snap = s && typeof s.input === 'function' ? s.input() : null;
      return (snap && snap.type) ? String(snap.type) : '';
    },
    /** Débloque un succès. Rend vrai si la demande est partie ; sans effet s'il l'est déjà. */
    unlockAchievement: function(id){
      const s = steamHandle();
      if(!s || !checked(id, 'unlockAchievement')) return false;
      return !!s.unlock(id);
    },
    isAchievementUnlocked: function(id){
      const s = steamHandle();
      if(!s || !checked(id, 'isAchievementUnlocked')) return false;
      return !!s.isUnlocked(id);
    },
    /** Reverrouille un succès. Réservé aux essais : un joueur ne doit jamais le déclencher. */
    clearAchievement: function(id){
      const s = steamHandle();
      if(!s || !checked(id, 'clearAchievement')) return false;
      return !!s.clear(id);
    },
    /** Fixe une statistique entière (le SDK n'en connaît pas d'autre ici). Rend vrai si prise. */
    setStat: function(name, value){
      const s = steamHandle();
      if(!s || !checked(name, 'setStat')) return false;
      const n = Math.trunc(Number(value));
      if(!Number.isFinite(n)){ say('api.steam.setStat : « ' + value + ' » n\'est pas un nombre'); return false; }
      return !!s.setStat(name, n);
    },
    /** La valeur d'une statistique, 0 si elle n'existe pas ou hors Steam. */
    getStat: function(name){
      const s = steamHandle();
      if(!s || !checked(name, 'getStat')) return 0;
      return Number(s.getStat(name)) || 0;
    },
    /** Ajoute `delta` (1 par défaut) à une statistique ; rend la nouvelle valeur, 0 hors Steam. */
    addStat: function(name, delta){
      const s = steamHandle();
      if(!s || !checked(name, 'addStat')) return 0;
      const d = Math.trunc(Number(delta === undefined ? 1 : delta));
      if(!Number.isFinite(d)){ say('api.steam.addStat : « ' + delta + ' » n\'est pas un nombre'); return 0; }
      return Number(s.addStat(name, d)) || 0;
    }
  };
}

// ---------- Les sauvegardes ----------

const SAVE_PREFIX = 'jeu3d:';

/** Le nom du fichier cloud d'un emplacement : caractères sûrs seulement, comme le valide `main.js`. */
export function cloudFileOf(name){
  return 'jeu3d-' + String(name || 'defaut').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80) + '.json';
}

/**
 * Le texte brut d'une sauvegarde, ou `null` s'il n'y en a pas. Le cloud d'abord (voir l'en-tête),
 * puis `localStorage`. Peut lever si `localStorage` est interdit ET qu'il n'y a pas de cloud —
 * l'appelant a déjà son `try/catch`.
 */
export function readSave(name){
  const b = desktopBridge();
  if(b && b.cloud){
    let remote = null;
    try{ remote = b.cloud.read(cloudFileOf(name)); } catch(e){ /* le pont échoue : le local reste */ }
    if(typeof remote === 'string' && remote) return remote;
  }
  return localStorage.getItem(SAVE_PREFIX + (name || 'defaut'));
}

/**
 * Écrit une sauvegarde partout où l'on peut. Rend vrai si AU MOINS un support l'a prise ; lève
 * seulement si aucun ne l'a prise (navigation privée, quota, et pas de cloud).
 */
export function writeSave(name, raw){
  let done = false;
  let localError = null;
  try{ localStorage.setItem(SAVE_PREFIX + (name || 'defaut'), raw); done = true; }
  catch(e){ localError = e; }
  const b = desktopBridge();
  if(b && b.cloud){
    try{ if(b.cloud.write(cloudFileOf(name), raw)) done = true; } catch(e){ /* voir ci-dessus */ }
  }
  if(!done && localError) throw localError;
  return done;
}

/** Efface une sauvegarde de tous les supports. */
export function removeSave(name){
  let done = false;
  try{ localStorage.removeItem(SAVE_PREFIX + (name || 'defaut')); done = true; } catch(e){ /* idem */ }
  const b = desktopBridge();
  if(b && b.cloud){
    try{ if(b.cloud.remove(cloudFileOf(name))) done = true; } catch(e){ /* idem */ }
  }
  return done;
}
