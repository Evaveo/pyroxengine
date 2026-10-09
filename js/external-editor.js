// moteur/js/external-editor.js
// Fenêtre d'édition externe (window.open + postMessage), partagée par tous les
// composants qui ouvrent un contenu dans une fenêtre séparée (UIDocument ici ;
// éditeur de nœuds TSL et éditeur de code dans des lots futurs, même protocole).
// Ce fichier a deux rôles distincts, séparés par la présence de `window.opener` :
// - fenêtre principale (opener === null) : openEditorExternal()
// - fenêtre externe (opener !== null) : le reste, appelé depuis external-editor.html

export function lastAssetEditedBy(type){ return _lastAssetEditedBy[type] || null; }

// ---------- Côté fenêtre principale ----------
// Une seule fenêtre ouverte par TYPE à la fois : ouvrir un deuxième UIDocument
// pendant que la fenêtre 'html-css' est déjà ouverte réutilise la même fenêtre
// (ré-init) plutôt que d'en empiler une seconde qui écrirait sur un autre Noeud
// sans indication claire de laquelle est active.
export const _windowsExternal = {};

// Dernier asset édité par type de fenêtre externe ({code: id, tsl: id, 'html-css': id}),
// en mémoire seulement (pas de persistance) — sert au menu Fenêtres pour rouvrir là où
// l'utilisateur en était plutôt qu'à vide. Mis à jour à CHAQUE ouverture (menu comme
// double-clic normal sur un asset), tant que donneesInitiales porte un id.
export const _lastAssetEditedBy = {};

export function openEditorExternal(type, dataInitiales, callbackUpdate, onChangeFile){
  if(dataInitiales && dataInitiales.id) _lastAssetEditedBy[type] = dataInitiales.id;
  const existante = _windowsExternal[type];
  if(existante && existante.window && !existante.window.closed){
    existante.callbackUpdate = callbackUpdate;
    existante.onChangeFile = onChangeFile;
    existante.pretes ? existante.window.postMessage({type:'init', data: dataInitiales}, location.origin)
      : (existante.inPending = dataInitiales);
    existante.window.focus();
    return;
  }
  if(existante && existante.onMessage){
    window.removeEventListener('message', existante.onMessage);
  }
  // Pas de chaîne de "features" (width/height...) : la fournir force une fenêtre popup
  // dans tous les navigateurs. En omettant ce 3e argument, window.open ouvre un ONGLET
  // (comportement standard d'un link ciblé), ce qui est ce qu'on veut ici.
  const popup = window.open('external-editor.html?type=' + encodeURIComponent(type),
    'editeur-externe-' + type);
  if(!popup){
    if(typeof setStatus === 'function'){
      setStatus('Autorisez les popups pour ce site pour ouvrir l\'éditeur externe', 4000);
    }
    return;
  }
  const state = {window: popup, callbackUpdate: callbackUpdate, onChangeFile: onChangeFile,
    pretes: false, inPending: dataInitiales, onMessage: null};
  _windowsExternal[type] = state;

  function onMessage(e){
    if(e.source !== popup || !e.data) return;
    if(e.data.type === 'ready'){
      state.pretes = true;
      popup.postMessage({type:'init', data: state.inPending}, location.origin);
    } else if(e.data.type === 'update'){
      if(state.callbackUpdate) state.callbackUpdate(e.data.data);
    } else if(e.data.type === 'changerFichier'){
      if(state.onChangeFile) state.onChangeFile(e.data.id);
    }
  }
  state.onMessage = onMessage;
  window.addEventListener('message', onMessage);

  const verifFermeture = setInterval(function(){
    if(popup.closed){
      clearInterval(verifFermeture);
      window.removeEventListener('message', onMessage);
      if(_windowsExternal[type] === state) state.onMessage = null;
    }
  }, 1000);
}

/**
 * Ré-initialise une fenêtre externe DÉJÀ OUVERTE sur cet asset, sans la ramener au premier plan.
 * Une table de contenu s'ouvre à la fois en tableau ('table') et en JSON ('code') : ce qu'on
 * modifie dans l'une doit apparaître dans l'autre. Ne fait rien si la fenêtre est fermée ou
 * montre un autre asset — un script ouvert dans l'éditeur de code n'est pas écrasé.
 */
export function refreshExternal(type, dataInitiales){
  const w = _windowsExternal[type];
  if(!w || !w.window || w.window.closed || !dataInitiales || _lastAssetEditedBy[type] !== dataInitiales.id) return;
  if(w.pretes) w.window.postMessage({type: 'init', data: dataInitiales}, location.origin);
  else w.inPending = dataInitiales;
}

// ---------- Côté fenêtre externe (chargé par external-editor.html) ----------
// N'exécute rien si on est dans la fenêtre principale (pas d'opener).
if(typeof window !== 'undefined' && window.opener){
  const _typeExternal = new URLSearchParams(location.search).get('type');
  let _dernieresData = null;
  let _debounce = null;

  function _sendUpdate(data){
    _dernieresData = data;
    clearTimeout(_debounce);
    _debounce = setTimeout(function(){
      if(!window.opener || window.opener.closed){
        if(typeof _showOpenerFerme === 'function') _showOpenerFerme();
        return;
      }
      window.opener.postMessage({type:'update', data: _dernieresData}, location.origin);
    }, 300);
  }

  window.addEventListener('message', function(e){
    if(e.source !== window.opener || !e.data || e.data.type !== 'init') return;
    if(typeof _initEditorExternal === 'function') _initEditorExternal(_typeExternal, e.data.data, _sendUpdate);
  });

  window.addEventListener('DOMContentLoaded', function(){
    window.opener.postMessage({type:'ready'}, location.origin);
  });
}


// EXPOSÉ EN GLOBALE, à dessein. Ces symboles sont appelés depuis des fichiers
// que les mêmes pages ne chargent pas toutes : un `import` y pointerait un
// fichier absent, et la page ne démarrerait pas. Ils gardent donc leur garde
// `typeof` côté appelant, et se déclarent ici.
globalThis.lastAssetEditedBy = lastAssetEditedBy;
globalThis.openEditorExternal = openEditorExternal;