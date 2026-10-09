// ---------- Console : logs, avertissements, erreurs des scripts ----------
// Alimentée par api.log / api.warn / api.error et par les erreurs de scripts.
// Double-clic sur une ligne liée à un objet : sélection + ouverture de son script.
import { inputs } from './editor-input.js';
import { setStatus } from './hierarchy.js';
import { escapeHtml, objectOfSceneById } from './objects.js';
import { openEditorScript } from './scripts.js';
import { select } from './selection.js';

export const consoleEditor = {inputs:[], max:500, notVues:0, visible:false};
export const consoleBody = document.getElementById('console-body');
export const consoleBadge = document.getElementById('console-badge');
export const consoleFilter = document.getElementById('console-filter');

export function logConsole(level, msg, obj, indexScript){
  const e = {
    level: level,                                  // 'log' | 'warn' | 'error'
    msg: String(msg),
    objId: obj ? obj.id : null,
    objName: obj ? obj.name : '',
    indexScript: (typeof indexScript === 'number') ? indexScript : null,
    heure: new Date().toLocaleTimeString()
  };
  consoleEditor.inputs.push(e);
  if(consoleEditor.inputs.length > consoleEditor.max) consoleEditor.inputs.shift();
  if(level === 'error' && !consoleEditor.visible) consoleEditor.notVues++;
  updateConsole();
}

export function updateConsole(){
  // badge d'erreurs non vues sur l'onglet
  consoleBadge.textContent = consoleEditor.notVues ? ' ●' + consoleEditor.notVues : '';

  if(!consoleEditor.visible) return;
  const filter = (consoleFilter.value || '').trim().toLowerCase();
  const inputs = consoleEditor.inputs.filter(function(e){
    return !filter || e.msg.toLowerCase().indexOf(filter) !== -1
        || e.objName.toLowerCase().indexOf(filter) !== -1;
  });
  let html = '';
  inputs.forEach(function(e){
    const ico = e.level === 'error' ? '⛔' : (e.level === 'warn' ? '⚠️' : '·');
    html += '<div class="c-line ' + e.level + '"' + (e.objId ? ' data-oid="' + e.objId + '"' : '')
      + (e.indexScript !== null ? ' data-iscript="' + e.indexScript + '"' : '') + '>'
      + '<span class="c-time">' + e.heure + '</span>'
      + '<span class="c-ico">' + ico + '</span>'
      + (e.objName ? '<span class="c-obj">' + escapeHtml(e.objName) + '</span>' : '')
      + '<span class="c-msg">' + escapeHtml(e.msg) + '</span></div>';
  });
  consoleBody.innerHTML = html || '<div class="none">console empty — les scripts écrivent ici via api.log / api.warn / api.error</div>';
  consoleBody.scrollTop = consoleBody.scrollHeight;

  const nb = {log:0, warn:0, error:0};
  consoleEditor.inputs.forEach(function(e){ nb[e.level]++; });
  // `consoleBody.ownerDocument`, PAS `document` : le panneau Console (et sa barre d'outils, qui
  // porte `#console-counters`) est ADOPTÉ tel quel dans une fenêtre flottante ou une fenêtre OS
  // séparée (js/ui/dock.js) — son document change, pas ses identifiants. Interroger `document`
  // trouvait l'élément resté dans la page principale... qui n'a plus ce nœud une fois poppé,
  // et `.textContent` sur `null` plantait dès qu'un log arrivait pendant que la Console était
  // détachée.
  const counters = consoleBody.ownerDocument.getElementById('console-counters');
  if(counters){
    counters.textContent = nb.log + ' log · ' + nb.warn + ' warn. · ' + nb.error + ' error(s)';
  }
}

export function markConsoleView(visible){
  consoleEditor.visible = visible;
  if(visible) consoleEditor.notVues = 0;
  updateConsole();
}

document.getElementById('console-clear').addEventListener('click', function(){
  consoleEditor.inputs.length = 0;
  consoleEditor.notVues = 0;
  updateConsole();
});
consoleFilter.addEventListener('input', updateConsole);

consoleBody.addEventListener('dblclick', function(e){
  const line = e.target.closest ? e.target.closest('.c-line') : null;
  if(!line || !line.dataset.oid) return;
  const obj = objectOfSceneById(parseInt(line.dataset.oid, 10));
  if(!obj){ setStatus('Cet objet n\'existe plus', 2000); return; }
  select(obj);
  if(obj.userData.scripts && obj.userData.scripts.length){
    const i = line.dataset.iscript !== undefined ? parseInt(line.dataset.iscript, 10) : 0;
    openEditorScript(obj, i);
  }
});


// EXPOSÉ EN GLOBALE, à dessein. Ces symboles sont appelés depuis des fichiers
// que les mêmes pages ne chargent pas toutes : un `import` y pointerait un
// fichier absent, et la page ne démarrerait pas. Ils gardent donc leur garde
// `typeof` côté appelant, et se déclarent ici.
globalThis.logConsole = logConsole;