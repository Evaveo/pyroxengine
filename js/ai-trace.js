// ---------- Trace des appels d'outils de l'IA dans la console ----------
//
// Zeldo (2026-10-01/02) : l'agent enfreignait des règles sans que personne ne le voie — aucune trace
// de ce qu'il avait appelé, avec quoi, ni de ce que le moteur avait refusé. `copRun` (copilot.js) est
// le passage obligé du copilote intégré, du pont MCP local et du relais hébergé : il écrit une ligne
// `[IA]` par appel, et `read_console` la rend à l'agent, qui relit ainsi ses actions et ses refus.
//
//   [IA] ✓ import_model {name:"Renard", folder:"Models/Persos"} — 120 ms (MCP)
//
// PUR : ni DOM, ni THREE, ni import. Testé par test/ai-trace.test.mjs.

export const TRACE_PARAM_MAX = 80;      // longueur d'une valeur dans la ligne
export const TRACE_LINE_MAX = 300;      // longueur d'une ligne entière
export const TRACE_BATCH_MAX = 20;      // sous-commandes d'un batch tracées une à une
export const TRACE_STORAGE_KEY = 'ia-trace';

/** Le texte est-il long au point d'être du contenu (base64, code, HTML) ? On n'en garde que la taille. */
function summarizeString(s){
  if(s.length <= TRACE_PARAM_MAX) return JSON.stringify(s);
  const kb = s.length >= 1024 ? Math.round(s.length / 1024) + ' Ko' : s.length + ' car.';
  return JSON.stringify(s.slice(0, TRACE_PARAM_MAX - 20)) + '…(' + kb + ')';
}

function summarizeValue(v, depth){
  if(v === null || v === undefined) return String(v);
  if(typeof v === 'string') return summarizeString(v);
  if(typeof v !== 'object') return String(v);
  if(Array.isArray(v)){
    if(depth > 1 || v.length > 6) return '[' + v.length + ' élément(s)]';
    return '[' + v.map(function(x){ return summarizeValue(x, depth + 1); }).join(',') + ']';
  }
  if(depth > 1) return '{…}';
  return summarizeParams(v, depth + 1);
}

/** `{name:"Renard", folder:"Models/Persos"}` — les paramètres d'un appel, courts. */
export function summarizeParams(args, depth){
  const d = depth || 0;
  if(!args || typeof args !== 'object') return '{}';
  const keys = Object.keys(args);
  if(!keys.length) return '{}';
  return '{' + keys.map(function(k){ return k + ':' + summarizeValue(args[k], d); }).join(', ') + '}';
}

/**
 * Une ligne de trace. `status` : 'ok' | 'warn' | 'error'. `message` n'est lu que pour une erreur.
 * `origin` : 'copilote' | 'MCP' | 'batch'.
 */
export function formatTraceLine(call){
  const mark = call.status === 'error' ? '✗' : (call.status === 'warn' ? '⚠' : '✓');
  let line = '[IA] ' + mark + ' ' + call.name + ' ' + summarizeParams(call.args);
  if(line.length > TRACE_LINE_MAX) line = line.slice(0, TRACE_LINE_MAX - 1) + '…';
  line += ' — ' + Math.round(call.ms || 0) + ' ms (' + (call.origin || 'copilote') + ')';
  if(call.status === 'error') line += ' — ' + String(call.message || '').slice(0, 300);
  return line;
}

/** Le résultat porte-t-il un avertissement de règle (⚠) ? */
export function resultHasWarning(text){
  return String(text === undefined || text === null ? '' : text).indexOf('⚠') !== -1;
}

/** La trace est active par défaut ; `'0'` dans le stockage la coupe. */
export function traceEnabled(storage){
  try{ return !storage || storage.getItem(TRACE_STORAGE_KEY) !== '0'; }
  catch(e){ return true; }
}
