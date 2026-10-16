// moteur/js/script-completion.js
// ---------- Autocomplétion des scripts ----------
//
// PUR (aucun import, aucun DOM) : l'éditeur de code (js/code-editor.js) demande « que proposer
// à cette position du texte ? », ce fichier répond. Testé seul (test/script-completion.test.mjs).
//
// Ce que la complétion sait, et ce qu'elle ne prétend PAS savoir :
//   - après `api.`                → toute l'API de script (la table API_HELP de l'aide, envoyée
//                                   par la fenêtre principale : une seule source, gardée par le
//                                   test de couverture de l'aide) ;
//   - après `api.X().` ou `api.me.` → ce que rend cet appel (table SC_RETURNS ci-dessous, écrite
//                                   à la main : c'est elle qu'il faut compléter quand l'API gagne
//                                   un objet rendu) ;
//   - une variable affectée d'un appel (`const p = api.particles();` puis `p.`) est suivie ;
//   - sans point : mots-clés, `api`, `start`/`update`, et les noms déjà écrits dans le fichier.
// Elle ne fait AUCUNE inférence de types au-delà : pas de TypeScript, pas de Monaco (voir l'en-tête
// de js/code-editor.js pour la raison).

export const SC_KEYWORDS = ['const', 'let', 'function', 'return', 'if', 'else', 'for', 'while',
  'break', 'continue', 'new', 'typeof', 'switch', 'case', 'default', 'try', 'catch', 'throw',
  'true', 'false', 'null', 'undefined', 'Math'];

const SC_VECTOR = [
  ['x', 'x'], ['y', 'y'], ['z', 'z'], ['set', 'set(x, y, z)'], ['copy', 'copy(v)'], ['add', 'add(v)'],
  ['sub', 'sub(v)'], ['multiplyScalar', 'multiplyScalar(s)'], ['length', 'length()'],
  ['distanceTo', 'distanceTo(v)'], ['normalize', 'normalize()'], ['clone', 'clone()'],
  ['lerp', 'lerp(v, t)'], ['addScaledVector', 'addScaledVector(v, s)']
];
const SC_EULER = [['x', 'x (radians)'], ['y', 'y (radians)'], ['z', 'z (radians)'], ['set', 'set(x, y, z)']];
const SC_NODE = [
  ['position', 'position', 'vector'], ['rotation', 'rotation', 'euler'], ['scale', 'scale', 'vector'],
  ['quaternion', 'quaternion'], ['visible', 'visible'], ['name', 'name'], ['userData', 'userData'],
  ['parent', 'parent', 'node'], ['children', 'children'],
  ['getComponent', 'getComponent(typeName)'], ['translateX', 'translateX(d)'], ['translateY', 'translateY(d)'],
  ['translateZ', 'translateZ(d)'], ['rotateX', 'rotateX(rad)'], ['rotateY', 'rotateY(rad)'],
  ['rotateZ', 'rotateZ(rad)'], ['lookAt', 'lookAt(x, y, z)'], ['getWorldPosition', 'getWorldPosition(v)', 'vector'],
  ['add', 'add(objet)'], ['remove', 'remove(objet)'], ['traverse', 'traverse(fn)']
];

/** Ce que rend `api.X(...)` (ou `api.X` pour une propriété) : nom → [nom, signature, rendu?]. */
export const SC_RETURNS = {
  me: SC_NODE, node: SC_NODE, find: SC_NODE, scene: SC_NODE,
  particles: [['emit', 'emit(n?)'], ['play', 'play()'], ['stop', 'stop(clear?)'], ['pause', 'pause(bool?)'],
    ['restart', 'restart()'], ['setActive', 'setActive(bool)'], ['set', 'set(chemin, valeur)'],
    ['get', 'get(chemin)'], ['alive', 'alive']],
  audio: [['play', 'play()'], ['stop', 'stop()'], ['volume', 'volume(v?)']],
  animator: [['setFloat', 'setFloat(name, v)'], ['setInt', 'setInt(name, v)'], ['setBool', 'setBool(name, v)'],
    ['setTrigger', 'setTrigger(name)'], ['get', 'get(name)'], ['restart', 'restart()'], ['state', 'state'],
    ['params', 'params']],
  pointerRay: [['origin', 'origin', 'vector'], ['direction', 'direction', 'vector']],
  vector: SC_VECTOR, euler: SC_EULER
};

function scStrip(html){
  return String(html || '').replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

/** La table API_HELP de l'aide → entrées de complétion `api.` (groupes ignorés). */
export function apiCompletionsFromHelp(apiHelp){
  const out = [];
  (apiHelp || []).forEach(function(e){
    if(!e || !e.name || e.group) return;
    const sig = String(e.sig || '');
    const call = sig.indexOf('api.' + e.name + '(') === 0;
    out.push({label: e.name, detail: sig.replace(/^api\./, ''), doc: scStrip(e.quoi).slice(0, 160), call: call});
  });
  return out;
}

const SC_ID = /[A-Za-z0-9_$]/;

// Remonte depuis `i` (exclu) une expression pointée : `api.particles(x).` → ['api', 'particles()'].
// Les parenthèses et crochets sont sautés en bloc ; tout autre caractère arrête la chaîne.
function scChainBefore(text, i){
  const parts = [];
  let k = i;
  for(;;){
    let call = false;
    if(text[k - 1] === ')' || text[k - 1] === ']'){
      let depth = 0;
      for(k = k - 1; k >= 0; k--){
        const ch = text[k];
        if(ch === ')' || ch === ']') depth++;
        else if(ch === '(' || ch === '['){ depth--; if(depth === 0) break; }
      }
      if(k < 0) return null;
      call = text[k] === '(';
    }
    let s = k;
    while(s > 0 && SC_ID.test(text[s - 1])) s--;
    if(s === k) return null;
    parts.unshift(text.slice(s, k) + (call ? '()' : ''));
    k = s;
    if(text[k - 1] !== '.') break;
    k--;
  }
  return parts;
}

// `const p = api.particles(...)` → p ↦ ['api', 'particles()'] (dernière affectation avant `caret`).
function scAliases(text, caret){
  const map = {};
  const re = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+)/g;
  let m;
  const before = text.slice(0, caret);
  while((m = re.exec(before)) !== null){
    const rhs = m[2].trim();
    const chain = scChainBefore(rhs, rhs.length);
    if(chain) map[m[1]] = chain;
  }
  return map;
}

function scResolve(chain, aliases, depth){
  if(!chain || !chain.length || (depth || 0) > 4) return null;
  const head = chain[0].replace(/\(\)$/, '');
  if(head !== 'api' && aliases[head]) return scResolve(aliases[head].concat(chain.slice(1)), aliases, (depth || 0) + 1);
  if(head !== 'api') return null;
  if(chain.length === 1) return 'api';
  let kind = chain[1].replace(/\(\)$/, '');
  if(!SC_RETURNS[kind] || kind === 'vector' || kind === 'euler') return null;
  for(let i = 2; i < chain.length; i++){
    const name = chain[i].replace(/\(\)$/, '');
    const entry = (SC_RETURNS[kind] || []).find(function(r){ return r[0] === name; });
    if(!entry || !entry[2]) return null;
    kind = entry[2];
  }
  return kind;
}

function scRank(items, prefix){
  const p = prefix.toLowerCase();
  const starts = [], contains = [];
  items.forEach(function(it){
    const l = it.label.toLowerCase();
    if(p && l === p) return;                       // déjà tapé en entier : rien à proposer
    if(l.indexOf(p) === 0) starts.push(it);
    else if(p && l.indexOf(p) > 0) contains.push(it);
  });
  return starts.concat(contains).slice(0, 400);
}

/**
 * Les propositions à la position `caret` de `text`. `ctx.api` = entrées de apiCompletionsFromHelp.
 * Rend {start, prefix, items:[{label, detail, doc, call}]} — `start` est l'index où commence le
 * mot à remplacer. `force` (Ctrl+Espace) propose même sans préfixe hors d'un accès membre.
 */
export function completionsAt(text, caret, ctx, force){
  const c = ctx || {};
  let start = caret;
  while(start > 0 && SC_ID.test(text[start - 1])) start--;
  const prefix = text.slice(start, caret);
  const none = {start: start, prefix: prefix, items: []};
  // Dans un commentaire de ligne ou une chaîne ouverte de la ligne courante : rien.
  const line = text.slice(text.lastIndexOf('\n', start - 1) + 1, start);
  const sansChaines = line.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g, '');
  if(sansChaines.indexOf('//') !== -1 || /['"`]/.test(sansChaines)) return none;
  if(/^\d/.test(prefix)) return none;

  if(text[start - 1] === '.'){
    const chain = scChainBefore(text, start - 1);
    const kind = scResolve(chain, scAliases(text, start), 0);
    let items = [];
    if(kind === 'api') items = c.api || [];
    else if(kind && SC_RETURNS[kind]){
      items = SC_RETURNS[kind].map(function(r){
        return {label: r[0], detail: r[1], doc: '', call: /\(/.test(r[1])};
      });
    }
    return {start: start, prefix: prefix, items: scRank(items, prefix)};
  }
  if(!prefix && !force) return none;
  const seen = {};
  const items = [];
  function push(it){ if(!seen[it.label]){ seen[it.label] = true; items.push(it); } }
  push({label: 'api', detail: 'l\'API de script', doc: '', call: false});
  push({label: 'start', detail: 'function start(api){ … }', doc: 'Appelée une fois au lancement.', call: false});
  push({label: 'update', detail: 'function update(api){ … }', doc: 'Appelée à chaque image.', call: false});
  SC_KEYWORDS.forEach(function(k){ push({label: k, detail: 'mot-clé', doc: '', call: false}); });
  // Les noms déjà présents dans le fichier (hors celui qu'on tape).
  const re = /[A-Za-z_$][\w$]{2,}/g;
  let m;
  while((m = re.exec(text)) !== null){
    if(m.index === start) continue;
    push({label: m[0], detail: 'dans ce script', doc: '', call: false});
  }
  return {start: start, prefix: prefix, items: scRank(items, prefix)};
}

/** Le texte après acceptation de `item` : {text, caret}. Une fonction reçoit `()` et le curseur dedans. */
export function applyCompletion(text, caret, start, item){
  const add = item.call ? item.label + '()' : item.label;
  const next = text.slice(0, start) + add + text.slice(caret);
  const pos = start + (item.call ? item.label.length + 1 : add.length);
  return {text: next, caret: pos};
}
