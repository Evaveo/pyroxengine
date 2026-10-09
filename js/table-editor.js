// moteur/js/table-editor.js
// Fenêtre « Table » : un asset data (JSON) montré et édité comme un TABLEAU, dans la fenêtre
// externe (external-editor.html, type 'table'). Avant, la seule porte était une modale avec une
// <textarea> brute — et le double-clic qui l'ouvrait ne partait plus (voir js/assets.js).
//
// La forme du JSON décide de la vue :
//   rows     liste d'objets            → une ligne par élément, une colonne par champ
//   keyed    objet d'objets            → une ligne par clé (« ancien », « garde_grille »…)
//   list     liste de valeurs          → une colonne « valeur »
//   record   objet de valeurs simples  → deux colonnes champ / valeur
//   sections objet qui mélange listes, objets et valeurs (la table « Decor ») → un onglet par
//            entrée non simple, plus un onglet « Général » pour les valeurs simples
// Une cellule garde son TYPE : un nombre reste un nombre, un booléen une case à cocher ; une
// valeur imbriquée ([7, 30], une liste de répliques) s'édite en JSON court dans la case.
//
// Les fonctions de modèle (shapeOf, columnsOf, encodeCell, decodeCell…) sont pures et testées
// par test/table-editor.test.mjs ; initEditorTableExternal ne fait que l'affichage.

export function isPlainObject(v){ return v !== null && typeof v === 'object' && !Array.isArray(v); }
function isSimple(v){ return v === null || typeof v !== 'object'; }

export function shapeOf(v){
  if(Array.isArray(v)) return (v.length && v.every(isPlainObject)) ? 'rows' : 'list';
  if(isPlainObject(v)){
    const vals = Object.keys(v).map(function(k){ return v[k]; });
    if(vals.length && vals.every(isPlainObject)) return 'keyed';
    if(vals.some(function(x){ return !isSimple(x); })) return 'sections';
    return 'record';
  }
  return 'raw';
}

/** Colonnes d'une vue rows/keyed : l'union des champs, dans l'ordre de première apparition. */
export function columnsOf(items){
  const cols = [];
  items.forEach(function(o){ Object.keys(o).forEach(function(k){ if(cols.indexOf(k) === -1) cols.push(k); }); });
  return cols;
}

/** Comment une valeur s'affiche dans sa case. */
export function encodeCell(v){
  if(v === undefined) return {type: 'empty', text: ''};
  if(typeof v === 'boolean') return {type: 'bool', checked: v};
  if(typeof v === 'number') return {type: 'number', text: String(v)};
  if(typeof v === 'string') return {type: 'text', text: v};
  return {type: 'json', text: JSON.stringify(v)};
}

/**
 * Relit ce qui a été tapé dans une case. `type` est celui de la case à l'affichage : une case
 * texte reste du texte même si on y tape « 12 » (on ne change pas un type en douce), une case
 * vide prend le type que son contenu suggère. Rend {ok, value} ou {ok:false, error}.
 */
export function decodeCell(type, text){
  const t = String(text);
  if(type === 'text') return {ok: true, value: t};
  if(type === 'number'){
    if(t.trim() === '') return {ok: false, error: 'nombre attendu'};
    const n = Number(t);
    return isFinite(n) ? {ok: true, value: n} : {ok: false, error: 'nombre attendu'};
  }
  if(type === 'json' || type === 'empty'){
    if(type === 'empty' && t.trim() === '') return {ok: true, value: undefined};
    try{ return {ok: true, value: JSON.parse(t)}; }
    catch(e){
      if(type === 'empty') return {ok: true, value: t};   // une case neuve accepte du texte nu
      return {ok: false, error: 'JSON invalide : ' + e.message};
    }
  }
  return {ok: false, error: 'type de case inconnu : ' + type};
}

/** Un nom de clé libre (« nouveau », « nouveau_2 »…) pour une ligne ou une colonne ajoutée. */
export function freeKey(taken, base){
  const b = base || 'nouveau';
  if(taken.indexOf(b) === -1) return b;
  for(let i = 2; ; i++) if(taken.indexOf(b + '_' + i) === -1) return b + '_' + i;
}

/** Renomme une clé d'objet SANS changer l'ordre des autres. Rend false si le nom est pris. */
export function renameKey(obj, from, to){
  if(from === to) return true;
  if(!to || Object.prototype.hasOwnProperty.call(obj, to)) return false;
  const entries = Object.keys(obj).map(function(k){ return [k === from ? to : k, obj[k]]; });
  Object.keys(obj).forEach(function(k){ delete obj[k]; });
  entries.forEach(function(e){ obj[e[0]] = e[1]; });
  return true;
}

/** Un modèle d'élément vide pour une ligne ajoutée : mêmes champs, valeurs neutres du même type. */
export function blankLike(sample, cols){
  const o = {};
  (cols || []).forEach(function(c){
    const v = sample ? sample[c] : undefined;
    o[c] = typeof v === 'number' ? 0 : typeof v === 'boolean' ? false : typeof v === 'string' ? ''
      : Array.isArray(v) ? [] : isPlainObject(v) ? {} : '';
  });
  return o;
}

/** Les onglets d'une vue sections : [{key: null (Général) | clé, label}]. */
export function sectionsOf(root){
  const tabs = [];
  if(Object.keys(root).some(function(k){ return isSimple(root[k]); })) tabs.push({key: null, label: 'Général'});
  Object.keys(root).forEach(function(k){ if(!isSimple(root[k])) tabs.push({key: k, label: k}); });
  return tabs;
}

// ---------- Affichage (fenêtre externe uniquement) ----------

const CSS = ''
  + '.tb-page{display:flex;flex-direction:column;height:100%;width:100%;gap:6px}'
  + '.tb-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px;color:#8a8f98}'
  + '.tb-tag{background:#2a3140;color:#cfd6e2;border-radius:4px;padding:2px 8px;font-weight:600}'
  + '.tb-name{background:#12151a;color:#d6d9de;border:1px solid #31363f;border-radius:4px;padding:3px 6px;font:13px "Segoe UI",system-ui,sans-serif;min-width:180px}'
  + '.tb-btn{background:#1f2530;color:#d6d9de;border:1px solid #3a4250;border-radius:4px;padding:3px 10px;cursor:pointer;font:12px "Segoe UI",system-ui,sans-serif}'
  + '.tb-btn:hover{background:#2a3242}'
  + '.tb-status{margin-left:auto;font-size:12px}'
  + '.tb-tabs{display:flex;gap:2px;border-bottom:1px solid #31363f;flex-wrap:wrap}'
  + '.tb-tab{background:none;border:none;color:#8a8f98;padding:5px 12px;cursor:pointer;font:12.5px "Segoe UI",system-ui,sans-serif;border-bottom:2px solid transparent}'
  + '.tb-tab.on{color:#e6e9ee;border-bottom-color:#5b9cff}'
  + '.tb-scroll{flex:1;overflow:auto;border:1px solid #31363f;border-radius:6px;background:#101318}'
  + '.tb-table{border-collapse:collapse;font:12.5px "Segoe UI",system-ui,sans-serif;min-width:100%}'
  + '.tb-table th{position:sticky;top:0;background:#181c23;color:#aab1bc;font-weight:600;text-align:left;padding:5px 8px;border-bottom:1px solid #31363f;white-space:nowrap}'
  + '.tb-table td{border-bottom:1px solid #1d222b;padding:2px 4px;vertical-align:middle}'
  + '.tb-table tr:hover td{background:#141922}'
  + '.tb-num{color:#5d6470;text-align:right;width:1%;padding-right:8px!important}'
  + '.tb-cell{width:100%;min-width:70px;background:transparent;color:#d6d9de;border:1px solid transparent;border-radius:3px;padding:3px 5px;font:12.5px "Segoe UI",system-ui,sans-serif}'
  + '.tb-cell:focus{outline:none;border-color:#5b9cff;background:#12151a}'
  + '.tb-cell.number{text-align:right;color:#d19a66}'
  + '.tb-cell.json{font-family:"Cascadia Code",Consolas,monospace;color:#98c379}'
  + '.tb-cell.key{font-weight:600;color:#e5c07b}'
  + '.tb-cell.bad{border-color:#e06c75;background:#2a1517}'
  + '.tb-ops{white-space:nowrap;width:1%}'
  + '.tb-op{background:none;border:none;color:#5d6470;cursor:pointer;padding:2px 4px;font-size:13px}'
  + '.tb-op:hover{color:#d6d9de}'
  + '.tb-foot{display:flex;gap:6px}'
  + '.tb-raw{padding:16px;color:#8a8f98;font-size:13px}';

function esc(s){ return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

/**
 * Appelée par external-editor.html (type === 'table'). `data` porte {id, name, text}.
 * `sendUpdate` renvoie {name, text} — ou {name, action:'code'} pour « Voir le code ».
 */
export function initEditorTableExternal(data, sendUpdate){
  if(!document.getElementById('tb-style')){
    const st = document.createElement('style'); st.id = 'tb-style'; st.textContent = CSS; document.head.appendChild(st);
  }
  const zones = document.getElementById('zones');
  let root, parseError = null;
  try{ root = JSON.parse(data.text || '[]'); } catch(e){ parseError = e.message; }
  let name = data.name || '';
  let tab = null;   // onglet courant d'une vue sections

  zones.innerHTML = '<div class="tb-page">'
    + '<div class="tb-bar"><span class="tb-tag">Table</span>'
    + '<input type="text" class="tb-name" id="tb-name" spellcheck="false">'
    + '<button class="tb-btn" id="tb-code" title="Ouvrir la même table en JSON dans l\'éditeur de code">{ } Voir le code</button>'
    + '<span>Lue par un script avec <code>api.data(\'' + esc(name) + '\')</code></span>'
    + '<span class="tb-status" id="tb-status"></span></div>'
    + '<div class="tb-tabs" id="tb-tabs"></div>'
    + '<div class="tb-scroll" id="tb-scroll"></div>'
    + '<div class="tb-foot" id="tb-foot"></div></div>';
  const fieldName = document.getElementById('tb-name');
  const status = document.getElementById('tb-status');
  fieldName.value = name;
  let clear = null;
  function report(text, bad){
    status.textContent = text; status.style.color = bad ? '#e06c75' : '#98c379';
    clearTimeout(clear);
    if(!bad) clear = setTimeout(function(){ status.textContent = ''; }, 1500);
  }
  function save(){ sendUpdate({name: name, text: JSON.stringify(root, null, 2)}); report('enregistré'); }

  document.getElementById('tb-code').addEventListener('click', function(){ sendUpdate({name: name, action: 'code'}); });
  fieldName.addEventListener('input', function(){
    name = fieldName.value;
    if(parseError === null) sendUpdate({name: name, text: JSON.stringify(root, null, 2)});
  });

  if(parseError !== null){
    document.getElementById('tb-scroll').innerHTML = '<div class="tb-raw">Le JSON de cette table est invalide ('
      + esc(parseError) + ') : corrigez-le avec « Voir le code ».</div>';
    return;
  }

  // Le nœud affiché : la racine, ou l'entrée de l'onglet courant d'une vue sections.
  function node(){ return (shapeOf(root) === 'sections' && tab !== null) ? root[tab] : root; }
  function generalView(){ return shapeOf(root) === 'sections' && tab === null; }

  function cellHtml(v, ref){
    const c = encodeCell(v);
    if(c.type === 'bool') return '<input type="checkbox" class="tb-bool" data-ref="' + ref + '"' + (c.checked ? ' checked' : '') + '>';
    return '<input type="text" class="tb-cell ' + c.type + '" data-ref="' + ref + '" data-type="' + c.type + '" spellcheck="false"'
      + (c.type === 'empty' ? ' placeholder="—"' : '') + ' value="' + esc(c.text) + '">';
  }
  function opsHtml(i, dup){
    return '<td class="tb-ops">' + (dup ? '<button class="tb-op" data-op="dup" data-i="' + i + '" title="Dupliquer">⧉</button>' : '')
      + '<button class="tb-op" data-op="del" data-i="' + i + '" title="Supprimer">✕</button></td>';
  }

  // refs : "r:<ligne>:<colonne>" (rows), "k:<clé>:<colonne>" (keyed), "l:<i>" (list),
  // "f:<champ>" (record / Général), "K:<clé>" (renommer une clé). Clés et colonnes passent par
  // un index (KEYS, COLS) : elles peuvent contenir « : » ou des guillemets.
  let KEYS = [], COLS = [];
  function render(){
    const tabs = document.getElementById('tb-tabs'), scroll = document.getElementById('tb-scroll'), foot = document.getElementById('tb-foot');
    if(shapeOf(root) === 'sections'){
      const list = sectionsOf(root);
      if(!list.some(function(t){ return t.key === tab; })) tab = list.length ? list[0].key : null;
      tabs.innerHTML = list.map(function(t, i){
        return '<button class="tb-tab' + (t.key === tab ? ' on' : '') + '" data-tab="' + i + '">' + esc(t.label) + '</button>';
      }).join('');
      tabs.querySelectorAll('.tb-tab').forEach(function(b){
        b.addEventListener('click', function(){ tab = list[+b.dataset.tab].key; render(); });
      });
    } else tabs.innerHTML = '';

    const n = node(), shape = generalView() ? 'record' : shapeOf(n);
    let head = '<th class="tb-num">#</th>', body = '';
    KEYS = []; COLS = [];
    if(shape === 'rows'){
      COLS = columnsOf(n);
      head += COLS.map(function(c){ return '<th>' + esc(c) + '</th>'; }).join('') + '<th></th>';
      n.forEach(function(o, i){
        body += '<tr><td class="tb-num">' + (i + 1) + '</td>'
          + COLS.map(function(c, ci){ return '<td>' + cellHtml(o[c], 'r:' + i + ':' + ci) + '</td>'; }).join('') + opsHtml(i, true) + '</tr>';
      });
    } else if(shape === 'keyed'){
      KEYS = Object.keys(n); COLS = columnsOf(KEYS.map(function(k){ return n[k]; }));
      head += '<th>clé</th>' + COLS.map(function(c){ return '<th>' + esc(c) + '</th>'; }).join('') + '<th></th>';
      KEYS.forEach(function(k, ki){
        body += '<tr><td class="tb-num">' + (ki + 1) + '</td><td><input type="text" class="tb-cell key" data-ref="K:' + ki + '" spellcheck="false" value="' + esc(k) + '"></td>'
          + COLS.map(function(c, ci){ return '<td>' + cellHtml(n[k][c], 'k:' + ki + ':' + ci) + '</td>'; }).join('') + opsHtml(ki, true) + '</tr>';
      });
    } else if(shape === 'list'){
      head += '<th>valeur</th><th></th>';
      n.forEach(function(v, i){
        body += '<tr><td class="tb-num">' + (i + 1) + '</td><td>' + cellHtml(v, 'l:' + i) + '</td>' + opsHtml(i, true) + '</tr>';
      });
    } else {   // record, ou l'onglet Général d'une vue sections
      KEYS = Object.keys(n).filter(function(k){ return !generalView() || isSimple(n[k]); });
      head += '<th>champ</th><th>valeur</th><th></th>';
      KEYS.forEach(function(k, ki){
        body += '<tr><td class="tb-num">' + (ki + 1) + '</td><td><input type="text" class="tb-cell key" data-ref="K:' + ki + '" spellcheck="false" value="' + esc(k) + '"></td>'
          + '<td>' + cellHtml(n[k], 'f:' + ki) + '</td>' + opsHtml(ki, false) + '</tr>';
      });
    }
    scroll.innerHTML = '<table class="tb-table"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table>';
    foot.innerHTML = '<button class="tb-btn" data-op="addRow">＋ Ligne</button>'
      + ((shape === 'rows' || shape === 'keyed') ? '<button class="tb-btn" data-op="addCol">＋ Colonne</button>' : '');
    wire(shape);
  }

  function apply(ref, value){
    const n = node(), p = ref.split(':');
    if(p[0] === 'r'){ if(value === undefined) delete n[+p[1]][COLS[+p[2]]]; else n[+p[1]][COLS[+p[2]]] = value; }
    else if(p[0] === 'k'){ const o = n[KEYS[+p[1]]]; if(value === undefined) delete o[COLS[+p[2]]]; else o[COLS[+p[2]]] = value; }
    else if(p[0] === 'l') n[+p[1]] = value === undefined ? '' : value;
    else if(p[0] === 'f') n[KEYS[+p[1]]] = value === undefined ? '' : value;
  }

  function wire(shape){
    const scroll = document.getElementById('tb-scroll');
    scroll.querySelectorAll('.tb-cell').forEach(function(el){
      el.addEventListener('change', function(){
        const ref = el.dataset.ref;
        if(ref[0] === 'K'){
          const from = KEYS[+ref.split(':')[1]], to = el.value.trim();
          if(!renameKey(node(), from, to)){ el.classList.add('bad'); report('« ' + to + ' » : nom vide ou déjà pris', true); return; }
          el.classList.remove('bad'); save(); render(); return;
        }
        const r = decodeCell(el.dataset.type, el.value);
        if(!r.ok){ el.classList.add('bad'); report(r.error + ' — rien n\'est appliqué', true); return; }
        el.classList.remove('bad'); apply(ref, r.value); save();
        if(el.dataset.type === 'empty') render();   // la case prend son vrai type
      });
    });
    scroll.querySelectorAll('.tb-bool').forEach(function(el){
      el.addEventListener('change', function(){ apply(el.dataset.ref, el.checked); save(); });
    });
    scroll.querySelectorAll('.tb-op').forEach(function(b){
      b.addEventListener('click', function(){
        const n = node(), i = +b.dataset.i;
        if(shape === 'keyed' || shape === 'record'){
          const k = KEYS[i];
          if(b.dataset.op === 'del') delete n[k];
          else { const nk = freeKey(Object.keys(n), k + '_copie'); n[nk] = JSON.parse(JSON.stringify(n[k])); }
        } else if(b.dataset.op === 'del') n.splice(i, 1);
        else n.splice(i + 1, 0, JSON.parse(JSON.stringify(n[i])));
        save(); render();
      });
    });
    document.getElementById('tb-foot').querySelectorAll('.tb-btn').forEach(function(b){
      b.addEventListener('click', function(){
        const n = node();
        if(b.dataset.op === 'addRow'){
          if(shape === 'rows') n.push(blankLike(n[n.length - 1], COLS));
          else if(shape === 'keyed') n[freeKey(Object.keys(n))] = blankLike(n[KEYS[KEYS.length - 1]], COLS);
          else if(shape === 'list') n.push(n.length ? JSON.parse(JSON.stringify(n[n.length - 1])) : '');
          else n[freeKey(Object.keys(n), 'champ')] = '';
        } else {
          const col = freeKey(COLS, 'colonne');
          const items = shape === 'rows' ? n : Object.keys(n).map(function(k){ return n[k]; });
          items.forEach(function(o){ o[col] = ''; });
        }
        save(); render();
      });
    });
  }

  render();
}

// EXPOSÉ EN GLOBALE, comme initEditorCodeExternal : external-editor.html l'appelle par son nom.
globalThis.initEditorTableExternal = initEditorTableExternal;
