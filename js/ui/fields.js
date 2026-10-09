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
})();
