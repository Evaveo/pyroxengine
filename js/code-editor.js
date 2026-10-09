// moteur/js/code-editor.js
// Component d'édition de code réutilisable : gouttière de numéros de lignes, coloration
// syntaxique, indentation automatique. Sans dépendance ni build — comme tout le reste du
// moteur, et parce qu'embarquer CodeMirror/Monaco (plusieurs centaines de Ko) pour éditer un
// script de vingt lignes ne se défend pas dans un dépôt qui tient à rester ouvrable en local.
//
// Technique : une <textarea> TRANSPARENTE posée exactement sur un <pre> coloré. La textarea
// garde tout le comportement natif (curseur, sélection, saisie, annulation, accessibilité),
// le <pre> ne fait que paint. Les deux couches DOIVENT partager police, taille, interligne,
// marges et gestion des espaces au pixel près, sinon le texte peint se décale du texte typed.
// C'est pour cette raison qu'il n'y a PAS de retour à la ligne automatique : il désalignerait
// la gouttière, où une ligne logique doit rester une ligne affichée.
//
// Chargé par les DEUX pages (editor.html et external-editor.html), comme shader-graph.js.

export const EC_WORDS_KEYS = ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while',
  'do', 'break', 'continue', 'new', 'class', 'extends', 'this', 'typeof', 'instanceof', 'in',
  'of', 'switch', 'case', 'default', 'try', 'catch', 'finally', 'throw', 'async', 'await',
  'yield', 'delete', 'void', 'import', 'export', 'from', 'static'];
export const EC_LITERALS = ['true', 'false', 'null', 'undefined', 'NaN', 'Infinity'];

export function ecEscape(s){
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Un seul passage, alternatives ordonnées par priorité : ce qui est dans un commentaire ou
// une chaîne ne doit jamais être re-analysé comme du code.
//
// Les littéraux d'expression régulière ne sont VOLONTAIREMENT pas colorés : `/` est
// ambigu (division ou début de regex) et trancher demande de savoir ce qui précède
// syntaxiquement. Une heuristique se trompe tôt ou tard et avale la moitié du fichier dans
// une fausse regex — ne rien colorer est bien moins gênant que colorer faux.
export const EC_TOKENS = new RegExp([
  '(\\/\\*[\\s\\S]*?\\*\\/|\\/\\/[^\\n]*)',                      // 1 commentaire
  '(`(?:\\\\.|[^`\\\\])*`|"(?:\\\\.|[^"\\\\\\n])*"|\'(?:\\\\.|[^\'\\\\\\n])*\')',  // 2 chaîne
  '(\\b0[xX][0-9a-fA-F]+\\b|\\b\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b)',            // 3 nombre
  '([A-Za-z_$][\\w$]*)'                                          // 4 identifiant
].join('|'), 'g');

// JSON (tables de contenu) : une chaîne suivie de « : » est une CLÉ, colorée comme un mot-clé ;
// les autres chaînes, les nombres et true/false/null comme en JavaScript.
export const EC_TOKENS_JSON = /("(?:\\.|[^"\\\n])*")(\s*:)?|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|\b(true|false|null)\b/g;

export function ecColorizeJson(text){
  let html = '', last = 0, m;
  EC_TOKENS_JSON.lastIndex = 0;
  while((m = EC_TOKENS_JSON.exec(text)) !== null){
    html += ecEscape(text.slice(last, m.index));
    if(m[1]) html += '<span class="' + (m[2] ? 'ec-t-key' : 'ec-t-txt') + '">' + ecEscape(m[1]) + '</span>' + ecEscape(m[2] || '');
    else if(m[3]) html += '<span class="ec-t-num">' + ecEscape(m[3]) + '</span>';
    else html += '<span class="ec-t-reads">' + m[4] + '</span>';
    last = m.index + m[0].length;
  }
  return html + ecEscape(text.slice(last));
}

export function ecColorize(text, langage){
  if(langage === 'json') return ecColorizeJson(text);
  if(langage !== 'js') return ecEscape(text);
  let html = '';
  let last = 0;
  let m;
  EC_TOKENS.lastIndex = 0;
  while((m = EC_TOKENS.exec(text)) !== null){
    html += ecEscape(text.slice(last, m.index));
    if(m[1]) html += '<span class="ec-t-com">' + ecEscape(m[1]) + '</span>';
    else if(m[2]) html += '<span class="ec-t-txt">' + ecEscape(m[2]) + '</span>';
    else if(m[3]) html += '<span class="ec-t-num">' + ecEscape(m[3]) + '</span>';
    else if(m[4]){
      const mot = m[4];
      const sequence = text.slice(m.index + mot.length);
      let classe = '';
      if(EC_WORDS_KEYS.indexOf(mot) !== -1) classe = 'ec-t-key';
      else if(EC_LITERALS.indexOf(mot) !== -1) classe = 'ec-t-reads';
      else if(/^\s*\(/.test(sequence)) classe = 'ec-t-fn';
      html += classe ? '<span class="' + classe + '">' + ecEscape(mot) + '</span>' : ecEscape(mot);
    }
    last = m.index + m[0].length;
  }
  return html + ecEscape(text.slice(last));
}

// Crée l'éditeur dans `hote` (vidé). Retourne { valeur, definirValeur, focus }.
// options : {valeur, langage:'js', lectureSeule:false, surChangement(texte)}
export function createEditorCode(hote, options){
  const opt = options || {};
  const langage = opt.langage || 'js';
  hote.innerHTML = '<div class="ec">'
    + '<div class="ec-gutter" aria-hidden="true"></div>'
    + '<div class="ec-zone">'
    + '<pre class="ec-colored" aria-hidden="true"></pre>'
    // wrap="off" en plus du white-space:pre de la feuille de style : c'est l'attribut, et non
    // le CSS seul, qui garantit qu'une longue ligne défile au lieu de se replier — un repli
    // désalignerait la gouttière, où une ligne logique doit rester une ligne affichée.
    + '<textarea class="ec-input" wrap="off" spellcheck="false" autocomplete="off" autocapitalize="off"'
    + (opt.playbackSeule ? ' readonly' : '') + '></textarea>'
    + '</div></div>';
  const gouttiere = hote.querySelector('.ec-gutter');
  const colore = hote.querySelector('.ec-colored');
  const input = hote.querySelector('.ec-input');

  function repeindre(){
    const text = input.value;
    // L'espace final n'est pas cosmétique : sans lui, un texte terminé par un saut de ligne
    // perd sa dernière ligne dans le <pre>, et la coloration se décale d'une ligne vers le
    // haut par rapport au texte typed.
    colore.innerHTML = ecColorize(text, langage) + ' ';
    const lines = text.split('\n').length;
    let num = '';
    for(let i = 1; i <= lines; i++) num += i + '\n';
    gouttiere.textContent = num;
    syncDefilement();
  }

  function syncDefilement(){
    colore.scrollTop = input.scrollTop;
    colore.scrollLeft = input.scrollLeft;
    gouttiere.scrollTop = input.scrollTop;
  }

  function replaceSelection(text, offsetCursor){
    const start = input.selectionStart, end = input.selectionEnd;
    input.value = input.value.slice(0, start) + text + input.value.slice(end);
    const pos = start + (offsetCursor === undefined ? text.length : offsetCursor);
    input.setSelectionRange(pos, pos);
  }

  function indentationOf(line){
    const m = line.match(/^[ \t]*/);
    return m ? m[0] : '';
  }

  input.addEventListener('keydown', function(ev){
    if(opt.playbackSeule) return;
    if(ev.key === 'Tab'){
      ev.preventDefault();
      const start = input.selectionStart, end = input.selectionEnd;
      if(start === end && !ev.shiftKey){ replaceSelection('  '); }
      else {
        // Sélection multi-lignes : on (dés)indente le bloc entier, comme tout éditeur.
        const avant = input.value.lastIndexOf('\n', start - 1) + 1;
        const block = input.value.slice(avant, end);
        const modifie = ev.shiftKey
          ? block.replace(/^ {1,2}/gm, '')
          : block.replace(/^/gm, '  ');
        input.value = input.value.slice(0, avant) + modifie + input.value.slice(end);
        input.setSelectionRange(avant, avant + modifie.length);
      }
      repeindre();
      if(opt.onChange) opt.onChange(input.value);
      return;
    }
    if(ev.key === 'Enter'){
      ev.preventDefault();
      const start = input.selectionStart;
      const line = input.value.slice(input.value.lastIndexOf('\n', start - 1) + 1, start);
      let indent = indentationOf(line);
      const ouvrant = /[{([]\s*$/.test(line);
      if(ouvrant) indent += '  ';
      replaceSelection('\n' + indent);
      repeindre();
      if(opt.onChange) opt.onChange(input.value);
      return;
    }
    if(ev.key === '}'){
      // Réaligne l'brace fermante sur son bloc si la ligne courante n'a que des espaces.
      const start = input.selectionStart;
      const startLine = input.value.lastIndexOf('\n', start - 1) + 1;
      const line = input.value.slice(startLine, start);
      if(/^[ \t]+$/.test(line)){
        ev.preventDefault();
        const reduit = line.slice(0, Math.max(0, line.length - 2));
        input.value = input.value.slice(0, startLine) + reduit + '}' + input.value.slice(start);
        const pos = startLine + reduit.length + 1;
        input.setSelectionRange(pos, pos);
        repeindre();
        if(opt.onChange) opt.onChange(input.value);
      }
    }
  });

  input.addEventListener('input', function(){
    repeindre();
    if(opt.onChange) opt.onChange(input.value);
  });
  input.addEventListener('scroll', syncDefilement);

  input.value = opt.value || '';
  repeindre();

  return {
    value: function(){ return input.value; },
    setValue: function(t){ input.value = t || ''; repeindre(); },
    focus: function(){ input.focus(); }
  };
}

// ---------- Fenêtre externe : éditeur de code plein écran ----------
// Appelée par external-editor.html (branche type === 'code'). `data` porte
// {name, code, langage, titre, lectureSeule} ; `envoyerMaj` renvoie {name, code} à la fenêtre
// principale (déjà debouncé à 300 ms par external-editor.js).
export function initEditorCodeExternal(data, sendUpdate){
  const zones = document.getElementById('zones');
  zones.innerHTML = '<div class="ec-page">'
    + '<div class="ec-bar">'
    + '<span class="ec-tag">' + (data.title || 'Code') + '</span>'
    // Le script d'un objet n'a pas de nom propre à éditer (son intitulé est « Script 2 —
    // Cube ») : on affiche alors un libellé fixe plutôt qu'un champ qui ne mènerait nulle part.
    + (data.withoutRename
        ? '<span class="ec-title-fixed">' + String(data.name || '') + '</span>'
        : '<input type="text" id="ec-name" class="ec-name" spellcheck="false">')
    + '<span class="ec-help">Tab indente · Maj+Tab désindente · les changements partent '
    + 'automatiquement dans l\'éditeur</span>'
    + '<span class="ec-status" id="ec-status"></span>'
    + '</div>'
    + '<div class="ec-host" id="ec-host"></div>'
    + '</div>';
  const fieldName = document.getElementById('ec-name');
  if(fieldName) fieldName.value = data.name || '';

  const state = {name: data.name || '', code: data.code || ''};
  const status = document.getElementById('ec-status');
  let effacer = null;
  function report(text){
    if(!status) return;
    status.textContent = text;
    clearTimeout(effacer);
    effacer = setTimeout(function(){ status.textContent = ''; }, 1500);
  }

  createEditorCode(document.getElementById('ec-host'), {
    value: state.code,
    langage: data.langage || 'js',
    playbackSeule: !!data.playbackSeule,
    onChange: function(text){
      state.code = text;
      // Une table de contenu n'accepte que du JSON valide : un fichier à moitié tapé écraserait
      // sinon la table à chaque frappe. Le statut reste affiché tant que c'est invalide.
      if(data.langage === 'json'){
        try{ JSON.parse(text); }
        catch(e){ clearTimeout(effacer); status.textContent = '✕ JSON invalide — rien n\'est appliqué'; return; }
      }
      sendUpdate({name: state.name, code: state.code});
      report('enregistré');
    }
  });

  if(fieldName){
    fieldName.addEventListener('input', function(){
      state.name = fieldName.value;
      sendUpdate({name: state.name, code: state.code});
      report('enregistré');
    });
  }
}


// EXPOSÉ EN GLOBALE, à dessein. Ces symboles sont appelés depuis des fichiers
// que les mêmes pages ne chargent pas toutes : un `import` y pointerait un
// fichier absent, et la page ne démarrerait pas. Ils gardent donc leur garde
// `typeof` côté appelant, et se déclarent ici.
globalThis.createEditorCode = createEditorCode;