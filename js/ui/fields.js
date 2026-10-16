// ---------- Types de champ ----------
// Un type de champ répond à trois questions, et à rien d'autre :
//   create(entry, doc) → l'élément (ou les éléments) à poser dans le DOM ;
//   write(els, value)  → y afficher une valeur (ou l'état divergent) ;
//   read(els)          → en relire une valeur, ou `undefined` si la saisie est EN COURS.
//
// Le vocabulaire est celui de material-props.js — `checkbox`, `choice`, `texture`, `pair` —
// et pas un second dialecte : la table PROPS_MATERIAL doit se traduire sans perte
// (test/ui-traduction-materiau.test.mjs).
//
// `read` qui rend `undefined` est le point important : `1.2e` ou `-` sont des saisies
// LÉGITIMES en cours de frappe. Les convertir en `null` (ce que faisait `readF`) laissait
// la donnée à son ancienne valeur SANS RIEN DIRE. Ici, une valeur non lisible allume l'état
// invalide et n'écrit rien.

import { UIRegistry } from './registry.js';

(function(){
  const MIXED_TEXT = '—';

  function baseInput(doc, type, id){
    const el = doc.createElement('input');
    el.setAttribute('type', type);
    el.id = id;
    return el;
  }

  function writeText(els, value, mixed){
    const el = els[0];
    if(mixed){ el.value = ''; el.setAttribute('placeholder', MIXED_TEXT); el.classList.add('mixed'); return; }
    el.classList.remove('mixed');
    // Le placeholder D'ORIGINE, pas une chaîne vide : « cible (vide = cet objet) » explique une
    // règle du champ, et l'effacer à chaque écriture la ferait disparaître au premier sync.
    el.setAttribute('placeholder', el.getAttribute('data-ph') || '');
    el.value = (value === null || value === undefined) ? '' : String(value);
  }

  function readNumber(els){
    const raw = String(els[0].value).trim();
    if(raw === '') return undefined;
    const n = Number(raw);
    // `Number('1.2e')` vaut NaN : saisie en cours, on ne touche à rien.
    return Number.isFinite(n) ? n : undefined;
  }

  UIRegistry.declareFieldType({ type: 'number',
    create: (entry, doc) => {
      const el = baseInput(doc, 'number', entry.ids[0]);
      if(entry.step !== undefined) el.setAttribute('step', String(entry.step));
      if(entry.min !== undefined) el.setAttribute('min', String(entry.min));
      if(entry.max !== undefined) el.setAttribute('max', String(entry.max));
      return [el];
    },
    write: writeText, read: readNumber });

  UIRegistry.declareFieldType({ type: 'text',
    create: (entry, doc) => {
      const el = baseInput(doc, 'text', entry.ids[0]);
      if(entry.placeholder){
        el.setAttribute('data-ph', entry.placeholder);
        el.setAttribute('placeholder', entry.placeholder);
      }
      return [el];
    },
    write: writeText,
    read: (els) => els[0].value });

  UIRegistry.declareFieldType({ type: 'color',
    create: (entry, doc) => [baseInput(doc, 'color', entry.ids[0])],
    write: (els, value, mixed) => {
      els[0].classList.toggle('mixed', !!mixed);
      if(!mixed && value) els[0].value = String(value);
    },
    read: (els) => els[0].value });

  UIRegistry.declareFieldType({ type: 'checkbox',
    create: (entry, doc) => [baseInput(doc, 'checkbox', entry.ids[0])],
    write: (els, value, mixed) => {
      // Une case à trois états : cochée, décochée, indéterminée (les cibles divergent).
      els[0].indeterminate = !!mixed;
      els[0].classList.toggle('mixed', !!mixed);
      if(!mixed) els[0].checked = !!value;
    },
    read: (els) => !!els[0].checked });

  UIRegistry.declareFieldType({ type: 'choice',
    create: (entry, doc) => {
      const el = doc.createElement('select');
      el.id = entry.ids[0];
      (entry.options || []).forEach((o) => {
        const opt = doc.createElement('option');
        opt.value = o[0];
        opt.textContent = o[1];
        el.appendChild(opt);
      });
      return [el];
    },
    write: (els, value, mixed) => {
      els[0].classList.toggle('mixed', !!mixed);
      if(!mixed && value !== undefined) els[0].value = String(value);
    },
    read: (els) => els[0].value });

  // `assetSlot` : un `choice` qui accepte AUSSI le dépôt d'un asset venu du panneau Projet.
  //
  // Pourquoi pas un simple `choice` : un composant qui référence un asset (le script d'un
  // ScriptJS, par exemple) se remplit au geste — on attrape le script dans le panneau Projet et
  // on le lâche sur le composant, comme dans Unity. La liste déroulante reste, pour le clavier
  // et pour voir d'un coup ce qui est disponible ; le dépôt s'ajoute par-dessus.
  //
  // LE GENRE D'ASSET ACCEPTÉ N'EST PAS ÉCRIT ICI : un dépôt n'est retenu que si son id figure
  // déjà dans les options du champ. C'est le panneau qui liste les assets recevables, donc le
  // filtre est le même que celui de la liste — impossible qu'ils divergent, et cette couche
  // n'a pas à connaître la notion d'asset.
  function assetDropped(el, doc){
    // `dispatchEvent` avec un objet nu dans le harnais de test (test/engine-env.mjs), un vrai
    // Event dans le navigateur : les deux écoutent `input` (écriture) puis `change` (fin
    // d'interaction), exactement ce qu'une saisie au clavier produit.
    ['input', 'change'].forEach(function(type){
      const ev = (typeof Event === 'function') ? new Event(type, {bubbles: true}) : {type: type};
      el.dispatchEvent(ev);
    });
  }

  UIRegistry.declareFieldType({ type: 'assetSlot',
    create: (entry, doc) => {
      const el = doc.createElement('select');
      el.id = entry.ids[0];
      el.classList.add('asset-slot');
      (entry.options || []).forEach((o) => {
        const opt = doc.createElement('option');
        opt.value = o[0];
        opt.textContent = o[1];
        el.appendChild(opt);
      });
      const known = (id) => (entry.options || []).some((o) => String(o[0]) === String(id));
      const idOf = (e) => (e && e.dataTransfer) ? e.dataTransfer.getData('text/asset') : '';
      el.addEventListener('dragover', function(e){
        if(!known(idOf(e))) return;           // mauvais genre : le curseur dit « non »
        if(e.preventDefault) e.preventDefault();
        if(e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        el.classList.add('drop-target');
      });
      el.addEventListener('dragleave', function(){ el.classList.remove('drop-target'); });
      el.addEventListener('drop', function(e){
        el.classList.remove('drop-target');
        const id = idOf(e);
        if(!known(id)) return;
        if(e.preventDefault) e.preventDefault();
        el.value = id;
        assetDropped(el, doc);
      });
      return [el];
    },
    write: (els, value, mixed) => {
      els[0].classList.toggle('mixed', !!mixed);
      if(!mixed && value !== undefined) els[0].value = (value === null) ? '' : String(value);
    },
    read: (els) => els[0].value });

  UIRegistry.declareFieldType({ type: 'pair',
    create: (entry, doc) => [baseInput(doc, 'number', entry.ids[0]),
                             baseInput(doc, 'number', entry.ids[1] || (entry.ids[0] + '-2'))],
    write: (els, value, mixed) => {
      const v = Array.isArray(value) ? value : [undefined, undefined];
      els.forEach((el, i) => {
        el.classList.toggle('mixed', !!mixed);
        if(!mixed) el.value = (v[i] === undefined || v[i] === null) ? '' : String(v[i]);
      });
    },
    read: (els) => {
      const a = Number(els[0].value), b = Number(els[1].value);
      return (Number.isFinite(a) && Number.isFinite(b)) ? [a, b] : undefined;
    }});

  UIRegistry.declareFieldType({ type: 'vec3',
    create: (entry, doc) => {
      // Trois ids fournis (`ids: ['f-px','f-py','f-pz']`) → on les respecte : du code
      // extérieur les cible. Un seul id fourni → on dérive `<id>x/y/z`.
      const ids = entry.ids.length === 3 ? entry.ids
        : ['x', 'y', 'z'].map((axe) => entry.ids[0] + axe);
      return ids.map((id) => baseInput(doc, 'number', id));
    },
    write: (els, value, mixed) => {
      const v = Array.isArray(value) ? value : [undefined, undefined, undefined];
      els.forEach((el, i) => {
        el.classList.toggle('mixed', !!mixed);
        if(!mixed) el.value = (v[i] === undefined || v[i] === null) ? '' : String(v[i]);
      });
    },
    read: (els) => {
      const v = els.map((el) => Number(el.value));
      return v.every((n) => Number.isFinite(n)) ? v : undefined;
    }});

  // `textarea` : un texte À PLUSIEURS LIGNES, où la ligne EST l'unité de donnée — les points
  // d'un mélange d'animation, un par ligne. Un `<input>` obligerait à inventer un séparateur.
  UIRegistry.declareFieldType({ type: 'textarea',
    create: (entry, doc) => {
      const el = doc.createElement('textarea');
      el.id = entry.ids[0];
      el.setAttribute('rows', String(entry.rows || 3));
      el.setAttribute('spellcheck', 'false');
      return [el];
    },
    write: writeText,
    read: (els) => els[0].value });

  // `info` : une valeur calculée, affichée, jamais saisie. Un `<span>`, et non un `<input>`
  // désactivé — un input grisé se lit comme « réglage indisponible », pas comme « mesure ».
  UIRegistry.declareFieldType({ type: 'info',
    create: (entry, doc) => {
      const el = doc.createElement('span');
      el.id = entry.ids[0];
      return [el];
    },
    write: (els, value, mixed) => {
      els[0].classList.toggle('mixed', !!mixed);
      els[0].textContent = mixed ? '—' : (value === null || value === undefined ? '' : String(value));
    },
    // Rien à relire : `undefined` dit au formulaire de ne jamais écrire depuis ce champ.
    read: () => undefined });

  // `texture` : un slot d'asset. Le rendu réel (vignette, cible de dépôt) est déjà écrit
  // dans material-props.js (`ipSlotTexture`) et ne bouge PAS dans ce lot — le type se
  // contente de porter la valeur, la migration du rendu est au lot 1a-bis.
  UIRegistry.declareFieldType({ type: 'texture',
    create: (entry, doc) => [baseInput(doc, 'text', entry.ids[0])],
    write: writeText,
    read: (els) => els[0].value || null });
  // ---------- Types des modules de particules (v1.21.0) ----------
  //
  // `colorPair` : deux couleurs — « aléatoire entre deux couleurs » d'Unity. `curve` et
  // `gradient` : des éditeurs graphiques sur un <canvas>, la valeur portée par l'élément lui-même
  // (`el._value`). Ils émettent `input` pendant le geste et `change` à la fin, exactement comme
  // une saisie au clavier : le formulaire n'a rien de spécial à savoir d'eux.

  function emitEdit(el, type){
    const ev = (typeof Event === 'function') ? new Event(type, {bubbles: true}) : {type: type};
    if(el.dispatchEvent) el.dispatchEvent(ev);
  }
  function cloneValue(v){ return (v === undefined || v === null) ? v : JSON.parse(JSON.stringify(v)); }
  function canvasOf(doc, id, w, h){
    const el = doc.createElement('canvas');
    el.id = id;
    el.width = w; el.height = h;
    el.classList.add('pa-canvas');
    if(el.setAttribute) el.setAttribute('tabindex', '0');
    return el;
  }
  function ctx2d(el){ return (el && el.getContext) ? el.getContext('2d') : null; }
  function pointerOf(el, e){
    const r = el.getBoundingClientRect ? el.getBoundingClientRect() : {left: 0, top: 0, width: el.width, height: el.height};
    const sx = el.width / (r.width || el.width), sy = el.height / (r.height || el.height);
    return {x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy};
  }

  UIRegistry.declareFieldType({ type: 'colorPair',
    create: (entry, doc) => [baseInput(doc, 'color', entry.ids[0]),
                             baseInput(doc, 'color', entry.ids[1] || (entry.ids[0] + '-2'))],
    write: (els, value, mixed) => {
      const v = Array.isArray(value) ? value : ['#ffffff', '#ffffff'];
      els.forEach((el, i) => { el.classList.toggle('mixed', !!mixed); if(!mixed) el.value = v[i] || '#ffffff'; });
    },
    read: (els) => [els[0].value, els[1].value] });

  // COURBE : clés [t, v], t de 0 à 1 en abscisse, v entre `min` et `max` (0 et 1 par défaut,
  // élargi si une clé dépasse). Glisser une clé la déplace ; double-clic ajoute une clé ;
  // clic droit retire (il en reste toujours une).
  UIRegistry.declareFieldType({ type: 'curve',
    create: (entry, doc) => {
      const el = canvasOf(doc, entry.ids[0], 220, 64);
      el._value = {keys: [[0, 1], [1, 1]]};
      el._sel = -1;
      const lo = (entry.min !== undefined) ? entry.min : 0;
      const range = function(){
        let hi = (entry.max !== undefined) ? entry.max : 1;
        (el._value.keys || []).forEach(function(k){ if(k[1] > hi) hi = k[1]; });
        return [lo, hi > lo ? hi : lo + 1];
      };
      const toXY = function(k){
        const r = range();
        return [k[0] * (el.width - 8) + 4, el.height - 4 - (k[1] - r[0]) / (r[1] - r[0]) * (el.height - 8)];
      };
      const fromXY = function(x, y){
        const r = range();
        const t = Math.max(0, Math.min(1, (x - 4) / (el.width - 8)));
        const v = r[0] + (el.height - 4 - y) / (el.height - 8) * (r[1] - r[0]);
        return [Math.round(t * 1000) / 1000, Math.max(lo, Math.round(v * 1000) / 1000)];
      };
      el._draw = function(){
        const g = ctx2d(el);
        if(!g) return;
        g.clearRect(0, 0, el.width, el.height);
        g.fillStyle = '#1b1d22'; g.fillRect(0, 0, el.width, el.height);
        g.strokeStyle = '#2f333b'; g.lineWidth = 1;
        g.beginPath(); g.moveTo(0, el.height / 2); g.lineTo(el.width, el.height / 2); g.stroke();
        const keys = (el._value && el._value.keys) || [];
        if(!keys.length) return;
        g.strokeStyle = '#7fc4ff'; g.lineWidth = 2; g.beginPath();
        const first = toXY(keys[0]);
        g.moveTo(0, first[1]);
        keys.forEach(function(k){ const p = toXY(k); g.lineTo(p[0], p[1]); });
        const last = toXY(keys[keys.length - 1]);
        g.lineTo(el.width, last[1]);
        g.stroke();
        keys.forEach(function(k, i){
          const p = toXY(k);
          g.fillStyle = (i === el._sel) ? '#ffffff' : '#7fc4ff';
          g.fillRect(p[0] - 3, p[1] - 3, 6, 6);
        });
      };
      const hit = function(pt){
        const keys = el._value.keys;
        for(let i = 0; i < keys.length; i++){
          const p = toXY(keys[i]);
          if(Math.abs(p[0] - pt.x) <= 6 && Math.abs(p[1] - pt.y) <= 6) return i;
        }
        return -1;
      };
      const sortKeep = function(i){
        const k = el._value.keys[i];
        el._value.keys.sort(function(a, b){ return a[0] - b[0]; });
        return el._value.keys.indexOf(k);
      };
      let drag = -1;
      el.addEventListener('mousedown', function(e){
        if(el.disabled || e.button !== 0) return;
        drag = hit(pointerOf(el, e));
        el._sel = drag;
        el._draw();
      });
      el.addEventListener('mousemove', function(e){
        if(drag < 0 || el.disabled) return;
        const pt = pointerOf(el, e);
        el._value.keys[drag] = fromXY(pt.x, pt.y);
        drag = sortKeep(drag);
        el._sel = drag;
        el._draw();
        emitEdit(el, 'input');
      });
      const end = function(){ if(drag >= 0){ drag = -1; emitEdit(el, 'change'); } };
      el.addEventListener('mouseup', end);
      el.addEventListener('mouseleave', end);
      el.addEventListener('dblclick', function(e){
        if(el.disabled) return;
        const pt = pointerOf(el, e);
        el._value.keys.push(fromXY(pt.x, pt.y));
        el._sel = sortKeep(el._value.keys.length - 1);
        el._draw();
        emitEdit(el, 'input'); emitEdit(el, 'change');
      });
      el.addEventListener('contextmenu', function(e){
        const i = hit(pointerOf(el, e));
        if(i < 0 || el._value.keys.length <= 1 || el.disabled) return;
        if(e.preventDefault) e.preventDefault();
        el._value.keys.splice(i, 1);
        el._sel = -1;
        el._draw();
        emitEdit(el, 'input'); emitEdit(el, 'change');
      });
      el.setAttribute('title', 'Glisser une clé · double-clic : ajouter · clic droit : retirer');
      return [el];
    },
    write: (els, value, mixed) => {
      const el = els[0];
      el.classList.toggle('mixed', !!mixed);
      if(mixed) return;
      el._value = (value && Array.isArray(value.keys) && value.keys.length) ? cloneValue(value) : {keys: [[0, 1], [1, 1]]};
      if(el._draw) el._draw();
    },
    read: (els) => cloneValue(els[0]._value) });

  // DÉGRADÉ : clés {t, color, alpha}. La barre montre le résultat sur un damier (l'alpha se
  // voit) ; les repères dessous sont les clés. Cliquer un repère le choisit — sa couleur et son
  // alpha s'éditent dans les deux champs voisins —, le glisser le déplace, double-cliquer la
  // barre ajoute une clé, clic droit sur un repère la retire.
  UIRegistry.declareFieldType({ type: 'gradient',
    create: (entry, doc) => {
      const el = canvasOf(doc, entry.ids[0], 220, 34);
      const col = baseInput(doc, 'color', entry.ids[0] + '-color');
      const alpha = baseInput(doc, 'number', entry.ids[0] + '-alpha');
      alpha.setAttribute('min', '0'); alpha.setAttribute('max', '1'); alpha.setAttribute('step', '0.05');
      col.setAttribute('title', 'Couleur de la clé choisie');
      alpha.setAttribute('title', 'Opacité de la clé choisie (0 à 1)');
      el._value = {keys: [{t: 0, color: '#ffffff', alpha: 1}, {t: 1, color: '#ffffff', alpha: 1}]};
      el._sel = 0;
      const hexOf = function(r, g, b){
        const h = function(x){ const s = Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16); return s.length < 2 ? '0' + s : s; };
        return '#' + h(r) + h(g) + h(b);
      };
      const rgbOf = function(hex){
        const n = parseInt(String(hex || '#ffffff').slice(1), 16) || 0;
        return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
      };
      const sample = function(t){
        const k = el._value.keys;
        if(t <= k[0].t) return k[0];
        if(t >= k[k.length - 1].t) return k[k.length - 1];
        for(let i = 1; i < k.length; i++){
          if(t <= k[i].t){
            const a = k[i - 1], b = k[i];
            const f = (b.t - a.t) > 0 ? (t - a.t) / (b.t - a.t) : 0;
            const ca = rgbOf(a.color), cb = rgbOf(b.color);
            return {t: t, color: hexOf(ca[0] + (cb[0] - ca[0]) * f, ca[1] + (cb[1] - ca[1]) * f, ca[2] + (cb[2] - ca[2]) * f),
                    alpha: a.alpha + (b.alpha - a.alpha) * f};
          }
        }
        return k[k.length - 1];
      };
      const BAR = 20;
      const xOf = function(t){ return 4 + t * (el.width - 8); };
      el._sync = function(){
        const k = el._value.keys[el._sel];
        if(k){ col.value = k.color; alpha.value = String(Math.round(k.alpha * 100) / 100); }
      };
      el._draw = function(){
        const g = ctx2d(el);
        if(!g) return;
        g.clearRect(0, 0, el.width, el.height);
        for(let x = 0; x < el.width; x += 8){
          for(let y = 0; y < BAR; y += 8){
            g.fillStyle = ((x + y) / 8) % 2 ? '#3a3a3a' : '#5a5a5a';
            g.fillRect(x, y, 8, 8);
          }
        }
        for(let x = 0; x < el.width; x++){
          const s = sample(Math.max(0, Math.min(1, (x - 4) / (el.width - 8))));
          const c = rgbOf(s.color);
          g.fillStyle = 'rgba(' + Math.round(c[0] * 255) + ',' + Math.round(c[1] * 255) + ',' + Math.round(c[2] * 255) + ',' + s.alpha + ')';
          g.fillRect(x, 0, 1, BAR);
        }
        el._value.keys.forEach(function(k, i){
          const x = xOf(k.t);
          g.fillStyle = k.color;
          g.beginPath(); g.moveTo(x, BAR + 1); g.lineTo(x - 5, el.height - 1); g.lineTo(x + 5, el.height - 1); g.closePath(); g.fill();
          g.strokeStyle = (i === el._sel) ? '#ffffff' : '#000000'; g.lineWidth = (i === el._sel) ? 2 : 1;
          g.stroke();
        });
      };
      const hit = function(pt){
        if(pt.y < BAR) return -1;
        let best = -1, bd = 7;
        el._value.keys.forEach(function(k, i){ const d = Math.abs(xOf(k.t) - pt.x); if(d <= bd){ bd = d; best = i; } });
        return best;
      };
      const tOf = function(x){ return Math.max(0, Math.min(1, (x - 4) / (el.width - 8))); };
      const sortKeep = function(i){
        const k = el._value.keys[i];
        el._value.keys.sort(function(a, b){ return a.t - b.t; });
        return el._value.keys.indexOf(k);
      };
      let drag = -1;
      el.addEventListener('mousedown', function(e){
        if(el.disabled || e.button !== 0) return;
        const i = hit(pointerOf(el, e));
        if(i >= 0){ drag = i; el._sel = i; el._sync(); el._draw(); }
      });
      el.addEventListener('mousemove', function(e){
        if(drag < 0 || el.disabled) return;
        el._value.keys[drag].t = Math.round(tOf(pointerOf(el, e).x) * 1000) / 1000;
        drag = sortKeep(drag); el._sel = drag;
        el._draw();
        emitEdit(el, 'input');
      });
      const end = function(){ if(drag >= 0){ drag = -1; emitEdit(el, 'change'); } };
      el.addEventListener('mouseup', end);
      el.addEventListener('mouseleave', end);
      el.addEventListener('dblclick', function(e){
        if(el.disabled) return;
        const pt = pointerOf(el, e);
        const t = Math.round(tOf(pt.x) * 1000) / 1000;
        const s = sample(t);
        el._value.keys.push({t: t, color: s.color, alpha: Math.round(s.alpha * 100) / 100});
        el._sel = sortKeep(el._value.keys.length - 1);
        el._sync(); el._draw();
        emitEdit(el, 'input'); emitEdit(el, 'change');
      });
      el.addEventListener('contextmenu', function(e){
        const i = hit(pointerOf(el, e));
        if(i < 0 || el._value.keys.length <= 1 || el.disabled) return;
        if(e.preventDefault) e.preventDefault();
        el._value.keys.splice(i, 1);
        el._sel = Math.max(0, Math.min(el._sel, el._value.keys.length - 1));
        el._sync(); el._draw();
        emitEdit(el, 'input'); emitEdit(el, 'change');
      });
      // Les deux champs de la clé choisie écrivent DANS la valeur du canvas, avant que le
      // formulaire ne la relise (cet écouteur est posé avant le sien).
      col.addEventListener('input', function(){
        const k = el._value.keys[el._sel]; if(k){ k.color = col.value; el._draw(); }
      });
      alpha.addEventListener('input', function(){
        const k = el._value.keys[el._sel];
        const a = Number(alpha.value);
        if(k && Number.isFinite(a)){ k.alpha = Math.max(0, Math.min(1, a)); el._draw(); }
      });
      el.setAttribute('title', 'Cliquer/glisser un repère · double-clic : ajouter · clic droit : retirer');
      return [el, col, alpha];
    },
    write: (els, value, mixed) => {
      const el = els[0];
      el.classList.toggle('mixed', !!mixed);
      if(mixed) return;
      const v = (value && Array.isArray(value.keys) && value.keys.length) ? cloneValue(value)
        : {keys: [{t: 0, color: '#ffffff', alpha: 1}, {t: 1, color: '#ffffff', alpha: 1}]};
      el._value = v;
      el._sel = Math.max(0, Math.min(el._sel || 0, v.keys.length - 1));
      if(el._sync) el._sync();
      if(el._draw) el._draw();
    },
    read: (els) => cloneValue(els[0]._value) });

})();
