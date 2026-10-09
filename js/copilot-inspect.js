// ---------- Copilote : outils d'INSPECTION, et la salle en un appel ----------
//
// Avant ces outils, le modèle n'avait que `list_scene` (un résumé par objet) pour savoir ce que
// portait la scène. Pour lire un composant, un matériau ou un script, il écrivait un script de
// sonde, le lançait, et lisait la console — trois appels, et du code jetable laissé dans la scène.
// Ici, chaque question a son outil, et chaque réponse est COMPACTE : nombres arrondis au
// millième, tableaux longs coupés, sortie plafonnée (~6000 caractères) avec la mention « tronqué ».
//
// Ce module ne dépend PAS de js/copilot.js (qui l'importe et enregistre ses outils) : pas de
// cycle d'évaluation, et les fonctions pures ci-dessous se testent sans éditeur.
import { consoleEditor } from './console.js';
import { assets } from './assets.js';
import { objects } from './objects.js';
import { codeOfScriptEntry } from './scripts.js';

export const OUTPUT_CAP = 6000;
export const SCRIPT_CAP_IN_OBJECT = 2000;
export const SCRIPT_CAP_FULL = 20000;

/** Arrondit au millième. */
export function round3(v){ return Math.round(v * 1000) / 1000; }

/**
 * Copie compacte d'une valeur quelconque : nombres arrondis, tableaux coupés à `maxArray`,
 * chaînes coupées à `maxString`, profondeur bornée. Les références circulaires et les objets
 * three (qui portent `isObject3D`, `isMaterial`…) sont remplacés par leur nom.
 */
export function compactValue(v, opts, depth, seen){
  const o = opts || {};
  const maxArray = o.maxArray || 24, maxString = o.maxString || 300, maxDepth = o.maxDepth || 5;
  const d = depth || 0;
  const s = seen || new Set();
  if(v === null || v === undefined) return v;
  if(typeof v === 'number') return Number.isFinite(v) ? round3(v) : String(v);
  if(typeof v === 'string') return v.length > maxString ? v.slice(0, maxString) + '…(tronqué)' : v;
  if(typeof v === 'boolean') return v;
  if(typeof v === 'function') return undefined;
  if(typeof v !== 'object') return String(v);
  if(v.isObject3D || v.isMaterial || v.isTexture || v.isBufferGeometry) return '<' + (v.name || v.type || 'three') + '>';
  if(v.isVector3) return [round3(v.x), round3(v.y), round3(v.z)];
  if(v.isVector2) return [round3(v.x), round3(v.y)];
  if(v.isColor) return '#' + v.getHexString();
  if(s.has(v)) return '<cycle>';
  if(d >= maxDepth) return Array.isArray(v) ? '[…' + v.length + ']' : '{…}';
  s.add(v);
  let out;
  if(Array.isArray(v) || ArrayBuffer.isView(v)){
    const arr = Array.from(v);
    out = arr.slice(0, maxArray).map(function(x){ return compactValue(x, o, d + 1, s); });
    if(arr.length > maxArray) out.push('…(+' + (arr.length - maxArray) + ')');
  } else {
    out = {};
    const src = (typeof v.toJSON === 'function' && d > 0) ? v.toJSON() : v;
    Object.keys(src).forEach(function(k){
      const x = compactValue(src[k], o, d + 1, s);
      if(x !== undefined) out[k] = x;
    });
  }
  s.delete(v);
  return out;
}

/** Plafonne une sortie texte, en le disant. */
export function capOutput(text, cap){
  const c = cap || OUTPUT_CAP;
  const s = String(text);
  if(s.length <= c) return s;
  return s.slice(0, c) + '\n…[tronqué : ' + (s.length - c) + ' caractères de plus — affinez la demande]';
}

/**
 * Une page d'un texte long (read_script) : `offset` et `limit` en CARACTÈRES. Quand il reste
 * de la suite, la sortie dit l'offset à redemander — plutôt qu'un « affinez la demande » sans issue.
 */
export function pageText(text, offset, limit){
  const s = String(text);
  const start = Math.max(0, Math.floor(Number(offset) || 0));
  const size = Math.max(1, Math.floor(Number(limit) || SCRIPT_CAP_FULL));
  if(start === 0 && s.length <= size) return s;
  if(start >= s.length) return '…[offset ' + start + ' au-delà de la fin : le texte fait ' + s.length + ' caractères]';
  const end = Math.min(s.length, start + size);
  let out = (start > 0 ? '…[caractères ' + start + ' à ' + end + ' sur ' + s.length + ']\n' : '') + s.slice(start, end);
  if(end < s.length) out += '\n…[tronqué : ' + (s.length - end) + ' caractères de plus — relire la suite avec '
    + 'read_script {name, offset: ' + end + '}]';
  return out;
}

function vec(v){ return v ? [round3(v.x), round3(v.y), round3(v.z)] : null; }
function deg(r){ return r ? [round3(r.x * 180 / Math.PI), round3(r.y * 180 / Math.PI), round3(r.z * 180 / Math.PI)] : null; }

/** Le matériau d'un objet, en quelques champs lisibles. */
export function describeMaterial(m){
  if(!m) return null;
  if(Array.isArray(m)) return m.map(describeMaterial);
  const out = {type: m.type};
  if(m.name) out.name = m.name;
  ['color', 'emissive'].forEach(function(k){
    if(m[k] && typeof m[k].getHexString === 'function') out[k] = '#' + m[k].getHexString();
  });
  ['roughness', 'metalness', 'opacity', 'emissiveIntensity'].forEach(function(k){
    if(typeof m[k] === 'number') out[k] = round3(m[k]);
  });
  if(m.transparent) out.transparent = true;
  ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap'].forEach(function(k){
    if(m[k]) out[k] = m[k].name || true;
  });
  return out;
}

/**
 * Tout ce que porte un objet. `scriptOf(entry)` rend `{name, code}` pour une entrée de
 * `userData.scripts` (injecté pour que la fonction reste testable sans assets).
 */
export function inspectObject(o, opts){
  const op = opts || {};
  const scriptOf = op.scriptOf || function(e){ return {name: e && e.scriptId, code: ''}; };
  const cap = op.scriptCap || SCRIPT_CAP_IN_OBJECT;
  const ud = o.userData || {};
  const game = ud.game || {};
  const out = {
    name: o.name, id: o.id, type: ud.type,
    position: vec(o.position), rotationDeg: deg(o.rotation), scale: vec(o.scale),
    visible: o.visible !== false,
    tag: game.tag || '', layer: game.layer || '',
    // Tout parent qui n'est pas la scène elle-même : un groupe n'a pas toujours de userData.type,
    // et l'exiger faisait répondre « parent: null » pour chaque objet rangé sous un groupe.
    parent: (o.parent && !o.parent.isScene && o.parent.name)
      ? o.parent.name : null,
    children: (o.children || []).filter(function(c){ return c.userData && c.userData.type !== undefined; })
      .map(function(c){ return c.name; })
  };
  if(Array.isArray(ud.components)){
    out.components = ud.components.map(function(c){
      const j = (c && typeof c.toJSON === 'function') ? c.toJSON() : c;
      return compactValue(j, {maxArray: 16, maxString: 200, maxDepth: 4});
    });
  }
  ['phys', 'collider', 'events'].forEach(function(k){
    if(ud[k] !== undefined) out[k] = compactValue(ud[k], {maxArray: 12, maxDepth: 3});
  });
  if(game.props && Object.keys(game.props).length) out.props = compactValue(game.props, {maxDepth: 3});
  if(o.material) out.material = describeMaterial(o.material);
  if(Array.isArray(ud.scripts) && ud.scripts.length){
    out.scripts = ud.scripts.map(function(e){
      const s = scriptOf(e) || {};
      const code = String(s.code || '');
      return {name: s.name || null, active: !!(e && e.active), length: code.length,
        source: code.length > cap ? code.slice(0, cap) + '\n…(tronqué, lire read_script)' : code};
    });
  }
  return out;
}

/** Position monde si disponible, sinon locale. */
function worldPos(o){
  if(typeof o.getWorldPosition === 'function' && typeof THREE !== 'undefined'){
    return o.getWorldPosition(new THREE.Vector3());
  }
  return o.position || {x: 0, y: 0, z: 0};
}

function hasComponent(o, typeName){
  const l = (o.userData && o.userData.components) || [];
  const t = String(typeName).toLowerCase();
  return l.some(function(c){
    const n = (c && ((c.constructor && c.constructor.typeName) || c.typeName)) || '';
    return String(n).toLowerCase() === t;
  });
}

/** Filtre les objets. Rend `{total, offset, objects: [{name, type, position, tag, parent}]}`. */
export function findObjects(list, q){
  const a = q || {};
  const needle = a.name ? String(a.name).toLowerCase() : null;
  const limit = Math.max(1, Math.min(200, a.limit || 50));
  const offset = Math.max(0, a.offset || 0);
  const hits = list.filter(function(o){
    const ud = o.userData || {};
    const game = ud.game || {};
    if(needle && String(o.name || '').toLowerCase().indexOf(needle) === -1) return false;
    if(a.tag !== undefined && (game.tag || '') !== a.tag) return false;
    if(a.type !== undefined && ud.type !== a.type) return false;
    if(a.layer !== undefined && (game.layer || '') !== a.layer) return false;
    if(a.component !== undefined && !hasComponent(o, a.component)) return false;
    if(Array.isArray(a.near)){
      const p = worldPos(o);
      const dx = p.x - a.near[0], dy = p.y - (a.near[1] || 0), dz = p.z - (a.near[2] || 0);
      const r = a.radius === undefined ? 5 : a.radius;
      if(dx * dx + dy * dy + dz * dz > r * r) return false;
    }
    return true;
  });
  return {
    total: hits.length, offset: offset,
    objects: hits.slice(offset, offset + limit).map(function(o){
      const ud = o.userData || {};
      return {name: o.name, type: ud.type, position: vec(worldPos(o)),
        tag: (ud.game && ud.game.tag) || undefined,
        parent: (o.parent && list.indexOf(o.parent) !== -1) ? o.parent.name : undefined};
    })
  };
}

/** Arbre indenté : « nom [type] {Composant, …} », deux espaces par niveau. */
export function hierarchyText(list, opts){
  const op = opts || {};
  const depth = op.depth === undefined ? 3 : op.depth;
  const inList = new Set(list);
  const kids = function(o){ return (o.children || []).filter(function(c){ return inList.has(c); }); };
  let roots;
  if(op.root){
    const r = list.find(function(o){ return o.name === op.root; });
    if(!r) throw new Error('objet « ' + op.root + ' » introuvable');
    roots = [r];
  } else roots = list.filter(function(o){ return !inList.has(o.parent); });
  const lines = [];
  const walk = function(o, level){
    const comps = ((o.userData && o.userData.components) || []).map(function(c){
      return (c && ((c.constructor && c.constructor.typeName) || c.typeName)) || '?';
    }).filter(function(n){ return n !== 'Transform'; });
    const k = kids(o);
    lines.push('  '.repeat(level) + o.name + ' [' + ((o.userData && o.userData.type) || '?') + ']'
      + (comps.length ? ' {' + comps.join(', ') + '}' : ''));
    if(!k.length) return;
    if(level + 1 >= depth){ lines.push('  '.repeat(level + 1) + '… ' + k.length + ' enfant(s)'); return; }
    k.forEach(function(c){ walk(c, level + 1); });
  };
  roots.forEach(function(r){ walk(r, 0); });
  return lines.join('\n') || '(scène vide)';
}

// ---------- Console : ce qu'affiche le jeu et ce qui plante hors des scripts ----------
// Les erreurs de script et api.log passent déjà par logConsole (consoleEditor.inputs). Ce qui
// n'y passe pas — une exception non rattrapée, une promesse rejetée — est capté ici.
export const capturedErrors = [];
const CAPTURE_MAX = 500;
// Numéro croissant de chaque ligne captée : play_and_measure relève ce qui est arrivé PENDANT sa
// mesure (un index ne suffit pas, le tableau se décale quand il déborde).
let captureSeq = 0;
export function captureSeqNow(){ return captureSeq; }
/** Les lignes venues du jeu captées après le numéro `seq`. */
export function capturedSince(seq){
  return capturedErrors.filter(function(e){ return e.seq > seq && e.objName === 'jeu'; });
}
function captureError(msg, level, source){
  const lv = (level === 'warn' || level === 'log') ? level : 'error';
  capturedErrors.push({level: lv, msg: String(msg), objName: source || '', heure: new Date().toLocaleTimeString(), window: true, seq: ++captureSeq});
  if(capturedErrors.length > CAPTURE_MAX) capturedErrors.shift();
}
// LA CONSOLE DU NAVIGATEUR, pas seulement celle de l'éditeur : console.error/warn de la page ET
// de l'iframe du mode Lecture (qui les relaie ici via ce puits, voir js/game-runtime.js). Sans
// ça, « cam.updateProjectionMatrix is not a function » ne s'affichait que dans les outils du
// navigateur, et read_console répondait « rien à signaler ».
if(typeof window !== 'undefined'){
  window.__copilotConsoleSink = function(level, msg, source){ captureError(msg, level, source); };
  if(typeof console !== 'undefined' && !console.__copilotWrapped){
    ['error', 'warn'].forEach(function(level){
      const original = console[level].bind(console);
      console[level] = function(){
        original.apply(null, arguments);
        try{
          captureError(Array.prototype.map.call(arguments, function(a){
            return a instanceof Error ? a.message : (typeof a === 'object' && a !== null ? safeJson(a) : String(a));
          }).join(' '), level);
        } catch(e){ /* ne jamais casser un console.error */ }
      };
    });
    console.__copilotWrapped = true;
  }
}
function safeJson(a){ try{ return JSON.stringify(a); } catch(e){ return String(a); } }
if(typeof window !== 'undefined' && typeof window.addEventListener === 'function'){
  window.addEventListener('error', function(e){ captureError((e && (e.message || (e.error && e.error.message))) || 'erreur'); });
  window.addEventListener('unhandledrejection', function(e){
    captureError('promesse rejetée : ' + ((e && e.reason && (e.reason.message || e.reason)) || '?'));
  });
}

/** La table API_HELP en texte brut, une ligne par entrée, filtrable. PUR. */
export function formatApiReference(apiHelp, filter){
  const strip = function(h){
    return String(h || '').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, '\'').replace(/&amp;/g, '&');
  };
  const f = String(filter || '').trim().toLowerCase();
  const out = [];
  let group = '', groupShown = false;
  (apiHelp || []).forEach(function(e){
    if(e.group){ group = e.group; groupShown = false; return; }
    const line = '- ' + (e.sig || e.name) + ' — ' + strip(e.quoi);
    if(f && line.toLowerCase().indexOf(f) === -1) return;
    if(!groupShown){ out.push('\n## ' + group); groupShown = true; }
    out.push(line);
  });
  if(!out.length) return '(aucune entrée de l\'api ne correspond à « ' + filter + ' »)';
  return 'Api des scripts — function start(api){…} / function update(api){…}' + out.join('\n');
}

/** Les `n` dernières lignes de console, filtrées par niveau. */
export function formatConsole(entries, q){
  const a = q || {};
  const n = Math.max(1, Math.min(200, a.n || 30));
  const l = entries.filter(function(e){ return !a.level || e.level === a.level; }).slice(-n);
  if(!l.length) return '(console vide' + (a.level ? ' pour le niveau ' + a.level : '') + ')';
  return l.map(function(e){
    // Multiligne GARDÉ (pile, tableau formaté) : lignes suivantes indentées, limite large —
    // couper à 400 caractères cachait justement ce qu'on cherchait (BUGS_MOTEUR § 16).
    const msg = String(e.msg);
    return '[' + (e.heure || '') + '] ' + e.level + (e.objName ? ' ' + e.objName : '') + ' : '
      + (msg.length > 2000 ? msg.slice(0, 2000) + ' …' : msg).replace(/\r?\n/g, '\n    ');
  }).join('\n');
}

// ---------- La salle en un appel ----------
/**
 * Les boîtes d'une salle : sol, murs (percés de portes), plafond en option. PUR.
 * Chaque boîte : `{name, center:[x,y,z], size:[w,h,d]}` — taille RÉELLE, en mètres.
 * `center` est le centre du SOL (sa face supérieure est à center.y).
 * Porte : `{wall:'north'|'south'|'east'|'west', width=1, height=2.2, offset=0}` (offset le long du
 * mur, depuis son milieu).
 */
export function roomLayout(spec){
  const s = spec || {};
  const c = s.center || [0, 0, 0];
  const sz = s.size || [6, 3, 6];
  const w = sz[0], h = sz[1], dpt = sz[2];
  const t = s.wallThickness === undefined ? 0.2 : s.wallThickness;
  if(!(w > 0 && h > 0 && dpt > 0 && t > 0)) throw new Error('taille et épaisseur doivent être positives');
  const boxes = [];
  const y0 = c[1];
  boxes.push({name: 'sol', center: [c[0], y0 - t / 2, c[2]], size: [w, t, dpt]});
  if(s.ceiling) boxes.push({name: 'plafond', center: [c[0], y0 + h + t / 2, c[2]], size: [w, t, dpt]});
  const walls = {
    north: {axis: 'x', len: w, fixed: c[2] - dpt / 2 + t / 2},
    south: {axis: 'x', len: w, fixed: c[2] + dpt / 2 - t / 2},
    west: {axis: 'z', len: dpt - 2 * t, fixed: c[0] - w / 2 + t / 2},
    east: {axis: 'z', len: dpt - 2 * t, fixed: c[0] + w / 2 - t / 2}
  };
  const doors = s.doors || [];
  Object.keys(walls).forEach(function(k){
    const wl = walls[k];
    const mid = wl.axis === 'x' ? c[0] : c[2];
    // segments [a, b] le long du mur, et un linteau au-dessus de chaque porte
    let segs = [[mid - wl.len / 2, mid + wl.len / 2, 0, h]];
    doors.filter(function(d){ return d.wall === k; }).forEach(function(d, i){
      const dw = d.width || 1, dh = Math.min(d.height || 2.2, h);
      const a = mid + (d.offset || 0) - dw / 2, b = a + dw;
      const next = [];
      segs.forEach(function(sg){
        if(sg[3] !== h || b <= sg[0] || a >= sg[1]){ next.push(sg); return; }
        if(a > sg[0]) next.push([sg[0], a, 0, h]);
        if(b < sg[1]) next.push([b, sg[1], 0, h]);
        if(dh < h) next.push([Math.max(a, sg[0]), Math.min(b, sg[1]), dh, h, 'linteau' + (i + 1)]);
      });
      segs = next;
    });
    segs.forEach(function(sg, i){
      const len = sg[1] - sg[0], along = (sg[0] + sg[1]) / 2;
      if(len <= 1e-6) return;
      const hy = sg[3] - sg[2], cy = y0 + (sg[2] + sg[3]) / 2;
      const name = 'mur_' + k + (sg[4] ? '_' + sg[4] : (segs.length > 1 ? '_' + (i + 1) : ''));
      boxes.push(wl.axis === 'x'
        ? {name: name, center: [along, cy, wl.fixed], size: [len, hy, t]}
        : {name: name, center: [wl.fixed, cy, along], size: [t, hy, len]});
    });
  });
  boxes.forEach(function(b){ b.center = b.center.map(round3); b.size = b.size.map(round3); });
  return boxes;
}

// ---------- Les outils ----------
function findByName(name){
  const o = objects.find(function(x){ return x.name === name; });
  if(!o) throw new Error('objet « ' + name + ' » introuvable (utilise find_objects ou list_scene)');
  return o;
}
function scriptOfEntry(e){
  const a = e && e.scriptId ? assets.find(function(x){ return x.id === e.scriptId; }) : null;
  return {name: a ? a.name : null, code: codeOfScriptEntry(e)};
}

export const INSPECTION_TOOLS = [
  {
    name: 'get_object',
    description: 'Tout ce que porte UN objet : transform, composants avec leurs valeurs, matériau, '
      + 'physique, propriétés, scripts attachés AVEC leur source (tronquée à ~2000 caractères), '
      + 'noms des enfants. À utiliser au lieu d\'écrire un script de sonde.',
    schema: {type: 'object', properties: {
      name: {type: 'string'}, id: {type: 'number', description: 'identifiant three (option)'}
    }, additionalProperties: false},
    exec: function(a){
      const o = (a.id !== undefined) ? objects.find(function(x){ return x.id === a.id; }) : findByName(a.name);
      if(!o) throw new Error('objet d\'id ' + a.id + ' introuvable');
      return capOutput(JSON.stringify(inspectObject(o, {scriptOf: scriptOfEntry})));
    }
  },
  {
    name: 'find_objects',
    description: 'Cherche des objets : sous-chaîne du nom, tag, composant (typeName), type, calque, '
      + 'et/ou proximité (near:[x,y,z] + radius, défaut 5). Paginé : limit (défaut 50), offset.',
    schema: {type: 'object', properties: {
      name: {type: 'string'}, tag: {type: 'string'}, component: {type: 'string'},
      type: {type: 'string'}, layer: {type: 'string'},
      near: {type: 'array', items: {type: 'number'}}, radius: {type: 'number'},
      limit: {type: 'number'}, offset: {type: 'number'}
    }, additionalProperties: false},
    exec: function(a){ return capOutput(JSON.stringify(findObjects(objects, a))); }
  },
  {
    name: 'get_hierarchy',
    description: 'Arbre compact de la scène (ou d\'une branche : root), indenté, avec type et '
      + 'composants de chaque nœud. depth borne la profondeur (défaut 3).',
    schema: {type: 'object', properties: {root: {type: 'string'}, depth: {type: 'number'}},
      additionalProperties: false},
    exec: function(a){ return capOutput(hierarchyText(objects, a)); }
  },
  {
    name: 'read_script',
    description: 'Source COMPLÈTE d\'un script : par nom d\'asset script, ou par nom d\'objet (tous '
      + 'ses scripts). Pour corriger ensuite, utilise replace_script. Un script long se lit par pages : '
      + '`offset` et `limit` comptent en CARACTÈRES (limit par défaut ' + SCRIPT_CAP_FULL + ') ; une sortie '
      + 'coupée donne l\'offset de la suite.',
    schema: {type: 'object', properties: {name: {type: 'string'},
      offset: {type: 'number', description: 'premier caractère à rendre (défaut 0)'},
      limit: {type: 'number', description: 'nombre de caractères à rendre (défaut ' + SCRIPT_CAP_FULL + ')'}},
      required: ['name'], additionalProperties: false},
    exec: function(a){
      const asset = assets.find(function(x){ return x.kind === 'script' && x.name === a.name; });
      if(asset) return pageText('// script « ' + asset.name + ' »\n' + (asset.code || ''), a.offset, a.limit);
      const o = objects.find(function(x){ return x.name === a.name; });
      if(!o){
        const names = assets.filter(function(x){ return x.kind === 'script'; }).map(function(x){ return x.name; });
        throw new Error('ni script ni objet « ' + a.name + ' » — scripts : ' + (names.join(', ') || 'aucun'));
      }
      const l = (o.userData.scripts || []).map(function(e, i){
        const s = scriptOfEntry(e);
        return '// script ' + (i + 1) + ' « ' + (s.name || '?') + ' »' + (e.active ? '' : ' (inactif)') + '\n' + s.code;
      });
      return pageText(l.join('\n\n') || '« ' + a.name + ' » ne porte aucun script', a.offset, a.limit);
    }
  },
  {
    name: 'read_console',
    description: 'Les dernières lignes de la console : api.log/warn/error du jeu, erreurs de '
      + 'scripts, exceptions non rattrapées, console.error/warn du navigateur (éditeur et jeu en mode Lecture). n (défaut 30), level : log | warn | error.',
    schema: {type: 'object', properties: {
      n: {type: 'number'}, level: {type: 'string', enum: ['log', 'warn', 'error']}
    }, additionalProperties: false},
    exec: function(a){
      const all = consoleEditor.inputs.concat(capturedErrors);
      return capOutput(formatConsole(all, a));
    }
  },
  {
    // La référence de l'api des scripts, tirée de la MÊME table que la page « L'objet api » de
    // l'aide (API_HELP, js/help-content.js, gardée par son test de couverture) : un agent
    // MCP n'a plus à sonder Object.keys(api) (BUGS_MOTEUR § 16).
    name: 'script_api_reference',
    description: 'La référence de l\'objet api des scripts (signature et rôle de chaque entrée, par '
      + 'groupe), générée depuis l\'aide de l\'éditeur. filter : sous-chaîne (nom, signature, texte) '
      + 'pour ne garder que les entrées utiles ; offset/limit pour paginer.',
    schema: {type: 'object', properties: {
      filter: {type: 'string'}, offset: {type: 'number'}, limit: {type: 'number'}
    }, additionalProperties: false},
    exec: async function(a){
      const m = await import('./help-content.js');
      return pageText(formatApiReference(m.API_HELP, a && a.filter), a && a.offset, a && a.limit);
    }
  }
];

