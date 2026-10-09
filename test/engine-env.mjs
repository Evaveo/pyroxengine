// moteur/test/engine-env.mjs
//
// Charge un sous-ensemble de moteur/js/*.js dans un contexte Node `vm`, avec un DOM/canvas
// minimal écrit à la main (aucune dépendance npm). Remplace ce que fournissait Playwright :
// un `document`, un `<canvas>` 2D qui lit/écrit vraiment des pixels RGBA, une `Image` dont le
// décodage async est simulé (le "PNG" n'est jamais un vrai PNG : c'est notre propre format
// interne width+height+RGBA, qui loop entre notre toBlob et notre Image — rien d'autre
// ne le lit). `THREE.WebGLRenderer` est remplacé par une classe factice : les vignettes de
// prévisualisation qu'il fabrique ne sont jamais lues par les tests.
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

/**
 * Retire `import` et `export` d'une source de `js/` pour la faire tourner dans un `node:vm`.
 *
 * POURQUOI CE HARNAIS NE DEVIENT PAS UN CHARGEUR DE MODULES. Depuis le passage aux modules ES,
 * `js/` déclare ses dépendances — mais ce harnais monte volontairement un contexte où TOUT vit
 * dans une même portée, exactement comme l'ancien empilement de <script>. Il rend donc au
 * fichier sa forme d'avant : `import` disparaît (le symbole viendra du fichier que le test
 * charge lui-même, ou manquera — ce qui est précisément ce que le test mesure), et `export`
 * tombe pour laisser la déclaration nue.
 *
 * L'alternative — importer réellement les modules — aurait obligé à réécrire les 69 fichiers de
 * test qui listent les fichiers dont ils ont besoin, et aurait fait perdre au harnais sa
 * propriété la plus utile : monter une COUCHE du moteur, pas le moteur entier. On garde les
 * 1509 tests comme filet de la migration au lieu de les refondre pendant qu'elle a lieu.
 */
export function deEsm(source){
  return source
    // `[\s\S]` et pas `[^\n]` : une clause d'import peut tenir sur PLUSIEURS lignes. Avec
    // l'ancienne expression, un import multi-ligne survivait au nettoyage et le script vm
    // tombait sur « Cannot use import statement outside a module » — une panne bruyante, mais
    // dont la cause (le retour a la ligne) ne saute pas aux yeux. `[^;]` garde la garde
    // essentielle : on ne traverse jamais une fin d'instruction.
    .replace(/^import\s+[^;]*?from\s*'[^']*';[ \t]*$/gm, '')
    .replace(/^import\s*'[^']*';[ \t]*$/gm, '')
    // Une REEXPORTATION (`export { x } from './y.js';`) tombe entierement, comme un import :
    // le symbole viendra du fichier qui le DECLARE si le test le charge, du bouchon du bac
    // sinon. La laisser passer faisait echouer le script vm sur « Unexpected token 'export' »,
    // ce qui a le merite d'etre bruyant — mais empechait tout partage entre deux modules.
    .replace(/^export\s*\{[^}]*\}\s*from\s*'[^']*';[ \t]*$/gm, '')
    // `export { x };` NUE, sans `from` : la forme que prend un symbole importe puis
    // reexporte. Elle tombe comme les autres — le nom est deja dans la portee, amene
    // par l'import que la ligne precedente a efface.
    .replace(/^export\s*\{[^}]*\}\s*;[ \t]*$/gm, '')
    .replace(/^export\s+(?=(?:async\s+)?function|class|const|let|var)/gm, '');
}
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const racineMoteur = path.join(dirname, '..');

// url factice -> Blob/File source, pour que la lecture (asynchrone) se fasse au moment du
// décodage de l'Image, pas à la création de l'URL (fidèle à URL.createObjectURL, qui ne lit
// aucun octet).
const SOURCE_PAR_URL = new Map();
let compteurUrl = 0;

// '#rrggbb' -> [r, v, b]
function hexEnRvb(hex){
  const n = parseInt(String(hex).replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// interpolation linéaire entre les deux stops qui encadrent t
function couleurAuStop(stops, t){
  if(!stops.length) return [0, 0, 0];
  const tries = stops.slice().sort((a, b) => a[0] - b[0]);
  if(t <= tries[0][0]) return hexEnRvb(tries[0][1]);
  if(t >= tries[tries.length - 1][0]) return hexEnRvb(tries[tries.length - 1][1]);
  for(let i = 1; i < tries.length; i++){
    if(t > tries[i][0]) continue;
    const a = tries[i - 1], b = tries[i];
    const k = (t - a[0]) / (b[0] - a[0]);
    const ca = hexEnRvb(a[1]), cb = hexEnRvb(b[1]);
    return [0, 1, 2].map((j) => Math.round(ca[j] + (cb[j] - ca[j]) * k));
  }
  return hexEnRvb(tries[tries.length - 1][1]);
}

function creerCanvas(){
  let _w = 0, _h = 0, _buf = new Uint8ClampedArray(0);
  const ctx2d = {
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'high',
    // Dégradé VERTICAL uniquement : c'est le seul usage du code testé (le ciel en dégradé,
    // js/environment.js), et un moteur de dégradé général n'aurait pas de client.
    createLinearGradient(x0, y0, x1, y1){
      return { __degrade: true, y0: y0, y1: y1, stops: [],
               addColorStop(p, color){ this.stops.push([p, color]); } };
    },
    // Le remplissage reste NOIR par défaut (comportement d'origine, sur lequel s'appuient
    // les tests de vignettes) ; seul un fillStyle qui est un dégradé change quelque chose.
    fillRect(x, y, w, h){
      const g = ctx2d.fillStyle;
      const grad = (g && g.__degrade) ? g : null;
      for(let j = y; j < y + h; j++){
        let r = 0, v = 0, b = 0;
        if(grad){
          const t = (grad.y1 === grad.y0) ? 0 : (j - grad.y0) / (grad.y1 - grad.y0);
          const c = couleurAuStop(grad.stops, Math.max(0, Math.min(1, t)));
          r = c[0]; v = c[1]; b = c[2];
        }
        for(let i = x; i < x + w; i++){
          const o = (j * _w + i) * 4;
          _buf[o] = r; _buf[o+1] = v; _buf[o+2] = b; _buf[o+3] = 255;
        }
      }
    },
    createImageData(w, h){ return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
    putImageData(img, dx, dy){
      for(let j = 0; j < img.height; j++){
        for(let i = 0; i < img.width; i++){
          const s = (j * img.width + i) * 4, d = ((dy + j) * _w + (dx + i)) * 4;
          _buf[d] = img.data[s]; _buf[d+1] = img.data[s+1]; _buf[d+2] = img.data[s+2]; _buf[d+3] = img.data[s+3];
        }
      }
    },
    getImageData(x, y, w, h){
      const out = new Uint8ClampedArray(w * h * 4);
      for(let j = 0; j < h; j++){
        for(let i = 0; i < w; i++){
          const s = ((y + j) * _w + (x + i)) * 4, d = (j * w + i) * 4;
          out[d] = _buf[s]; out[d+1] = _buf[s+1]; out[d+2] = _buf[s+2]; out[d+3] = _buf[s+3];
        }
      }
      return { width: w, height: h, data: out };
    },
    // seul usage réel dans le code testé : recopier une source qui porte elle aussi
    // {width, height, tampon RGBA} (notre faux <img> ou un autre faux <canvas>).
    // Pas de mise à l'échelle : aucun des 5 tests ne redimensionne une image en la dessinant.
    drawImage(source){
      const sw = source._w !== undefined ? source._w : source.width;
      const sh = source._h !== undefined ? source._h : source.height;
      const sbuf = source._buf;
      if(canvas.width === 0) canvas.width = sw;
      if(canvas.height === 0) canvas.height = sh;
      for(let j = 0; j < sh; j++){
        for(let i = 0; i < sw; i++){
          const s = (j * sw + i) * 4, d = (j * _w + i) * 4;
          _buf[d] = sbuf[s]; _buf[d+1] = sbuf[s+1]; _buf[d+2] = sbuf[s+2]; _buf[d+3] = sbuf[s+3];
        }
      }
    }
  };
  const canvas = {
    // three.min.js (wd()) écrit canvas.style.display juste après createElement : jamais lu par
    // les assertions (pas de vrai rendu écran ici), juste un objet à ne pas laisser planter.
    style: {},
    get width(){ return _w; },
    set width(v){ _w = v; _buf = new Uint8ClampedArray(_w * _h * 4); },
    get height(){ return _h; },
    set height(v){ _h = v; _buf = new Uint8ClampedArray(_w * _h * 4); },
    get _w(){ return _w; },
    get _h(){ return _h; },
    get _buf(){ return _buf; },
    getContext(type){ return type === '2d' ? ctx2d : null; },
    // THREE.WebGLRenderer câble des écouteurs ('webglcontextlost', etc.) sur domElement : sans
    // effet ici (pas de vrai contexte GL), juste à ne pas laisser planter le constructeur.
    addEventListener(){}, removeEventListener(){},
    toBlob(cb, type){
      // encodage interne : 8 octets d'en-tête (width, height en Int32) puis le tampon RGBA
      const header = new Int32Array([_w, _h]);
      const blob = new Blob([header.buffer, _buf], { type: type || 'image/png' });
      queueMicrotask(() => cb(blob));
    },
    toDataURL(){ return 'data:image/png;base64,'; }
  };
  return canvas;
}

function creerImage(){
  const img = { width: 0, height: 0, _buf: new Uint8ClampedArray(0), onload: null, onerror: null };
  // three.min.js (ImageLoader) câble 'load'/'error' via addEventListener, pas onload/onerror ;
  // on garde les deux styles pour rester compatible avec tout code moteur/js qui utiliserait
  // l'un ou l'autre.
  const ecouteurs = { load: [], error: [] };
  img.addEventListener = (type, fn) => { if(ecouteurs[type]) ecouteurs[type].push(fn); };
  img.removeEventListener = (type, fn) => {
    if(!ecouteurs[type]) return;
    const i = ecouteurs[type].indexOf(fn);
    if(i !== -1) ecouteurs[type].splice(i, 1);
  };
  function emit(type, arg){
    if(img['on' + type]) img['on' + type](arg);
    ecouteurs[type].slice().forEach((fn) => fn(arg));
  }
  let _src = '';
  Object.defineProperty(img, 'src', {
    get(){ return _src; },
    set(u){
      _src = u;
      const source = SOURCE_PAR_URL.get(u);
      if(!source){ queueMicrotask(() => emit('error', new Error('URL inconnue : ' + u))); return; }
      source.arrayBuffer().then((buf) => {
        const header = new Int32Array(buf.slice(0, 8));
        img.width = header[0]; img.height = header[1];
        img._buf = new Uint8ClampedArray(buf.slice(8));
        emit('load');
      }).catch((e) => { emit('error', e); });
    }
  });
  return img;
}

/** Tous les descendants d'un élément, en profondeur d'abord (ordre du document). */
function descendants(el){
  const out = [];
  const marcher = (n) => {
    for(let i = 0; i < n.children.length; i++){
      const enfant = n.children[i];
      out.push(enfant);
      marcher(enfant);
    }
  };
  marcher(el);
  return out;
}

/** `#id`, `.classe`, `tag`, et leurs combinaisons (`button.win-close`, `div#app`). */
function correspond(node, sel){
  const parts = String(sel || '').trim().match(/^([a-zA-Z][\w-]*)?((?:[.#][\w-]+)*)$/);
  if(!parts) return false;
  if(parts[1] && node.tagName !== parts[1].toUpperCase()) return false;
  const reste = parts[2] || '';
  const jetons = reste.match(/[.#][\w-]+/g) || [];
  return jetons.every((j) => (j[0] === '#'
    ? node.id === j.slice(1)
    : node.classList && node.classList.contains(j.slice(1))));
}

/**
 * Le sous-ensemble d'HTML que `js/` écrit dans un `innerHTML` : des balises, des attributs
 * entre guillemets, du texte. Pas d'entités, pas de commentaires, pas de balises implicitement
 * fermées — rien de tout ça n'apparaît dans le moteur.
 *
 * Pourquoi le harnais en a besoin : sans lui, `box.innerHTML = '<div class="win-bar">…'` ne
 * créait AUCUN enfant, et le `querySelector('.win-bar')` qui suit rendait `null`. Tout module
 * qui construit son DOM par chaîne — `windows.js`, le dock, la moitié des panneaux — était donc
 * intestable, et c'est exactement la couche où vivent les bugs qu'on ne voit pas en console.
 */
function analyserHtml(doc, html, hote){
  const jeton = /<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[\w-]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g;
  const pile = [hote];
  let m;
  while((m = jeton.exec(html)) !== null){
    const [, fermante, ouvrante, attributs, autoFermee, texte] = m;
    const courant = pile[pile.length - 1];
    if(fermante){
      if(pile.length > 1) pile.pop();
    } else if(ouvrante){
      const node = doc.createElement(ouvrante);
      node._fromHtml = true;
      (attributs || '').match(/[\w-]+(?:="[^"]*")?/g)?.forEach((paire) => {
        const eq = paire.indexOf('=');
        const nom = eq === -1 ? paire : paire.slice(0, eq);
        const valeur = eq === -1 ? '' : paire.slice(eq + 2, -1);
        if(nom === 'class') node.className = valeur;
        else if(nom === 'id'){ node.id = valeur; doc._index(node); }
        else node.setAttribute(nom, valeur);
      });
      courant.appendChild(node);
      if(!autoFermee) pile.push(node);
    } else if(texte && texte.trim()){
      courant.textContent = texte;
    }
  }
}

// L'élément générique porte maintenant un VRAI arbre, un état de classes, une distribution
// d'événements et un focus. Le harnais n'imite pas un navigateur : il fournit le strict
// minimum sur lequel js/ui/* est mesurable — voir test/harnais-dom.test.mjs.
function creerElementGenerique(doc, tag){
  const listeners = new Map();
  const classes = new Set();
  // Les enfants sont tenus dans un tableau interne, mais EXPOSÉS comme une HTMLCollection :
  // indexable, avec `length`, et SANS `forEach` ni `map`. C'est ce que rend un navigateur, et
  // c'est ce qui a manqué : `(box.children || []).forEach(...)` passait tous les tests du dock
  // et levait une TypeError dans l'éditeur, à chaque glissement de poignée.
  const kids = [];
  const collection = new Proxy(kids, {
    get(cible, prop){
      if(prop === 'length') return cible.length;
      if(prop === 'item') return function(i){ return cible[i] === undefined ? null : cible[i]; };
      if(typeof prop === 'string' && /^\d+$/.test(prop)) return cible[Number(prop)];
      if(prop === Symbol.iterator) return cible[Symbol.iterator].bind(cible);
      // Tout le reste — forEach, map, filter, find… — n'existe pas sur une HTMLCollection.
      return undefined;
    }
  });
  const nomBalise = String(tag || 'div').toUpperCase();
  const el = {
    tagName: nomBalise,
    style: {}, dataset: {}, children: collection, parentNode: null,
    id: '', disabled: false,
    get ownerDocument(){ return doc || null; },
    classList: {
      add(c){ classes.add(c); },
      remove(c){ classes.delete(c); },
      toggle(c, on){ if(on === undefined ? classes.has(c) : !on) classes.delete(c); else classes.add(c); },
      contains(c){ return classes.has(c); }
    },
    addEventListener(type, fn){
      if(!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener(type, fn){
      const l = listeners.get(type);
      if(l) listeners.set(type, l.filter((f) => f !== fn));
    },
    dispatchEvent(ev){
      (listeners.get(ev && ev.type) || []).forEach((fn) => fn(ev));
      return true;
    },
    appendChild(child){
      if(child.parentNode) child.parentNode.remove(child);
      child.parentNode = el;
      kids.push(child);
      if(doc) doc._index(child);
      return child;
    },
    remove(child){
      if(child === undefined){ if(el.parentNode) el.parentNode.remove(el); return; }
      const i = kids.indexOf(child);
      if(i !== -1) kids.splice(i, 1);
      child.parentNode = null;
      if(doc) doc._deindex(child);
    },
    // Le nom du DOM. `remove(child)` est la forme maison du harnais, gardée pour ne pas
    // réécrire les tests qui s'en servent ; le code de production, lui, écrit `removeChild`.
    removeChild(child){ el.remove(child); return child; },
    setAttribute(name, v){ if(name === 'id'){ el.id = v; if(doc) doc._index(el); } else el.dataset[name] = v; },
    getAttribute(name){ return name === 'id' ? el.id : (el.dataset[name] ?? null); },
    removeAttribute(name){ if(name === 'id') el.id = ''; else delete el.dataset[name]; },
    hasAttribute(name){ return name === 'id' ? !!el.id : (el.dataset[name] !== undefined); },
    focus(){ if(doc) doc.activeElement = el; },
    blur(){ if(doc && doc.activeElement === el) doc.activeElement = null; },
    insertBefore(child, ref){
      if(child.parentNode) child.parentNode.remove(child);
      const i = kids.indexOf(ref);
      child.parentNode = el;
      if(i === -1) kids.push(child); else kids.splice(i, 0, child);
      if(doc) doc._index(child);
      return child;
    },
    // Un sélecteur, pas un moteur de sélecteurs : `#id`, `.classe`, `tag`, et leurs
    // combinaisons simples (`button.win-close`). C'est tout ce dont `js/ui/*` et `windows.js`
    // se servent, et rendre `null` à tout coup — ce que faisait ce harnais — mettait TOUTE la
    // couche fenêtres hors de portée d'un test.
    querySelector(sel){ return descendants(el).find((n) => correspond(n, sel)) || null; },
    querySelectorAll(sel){ return descendants(el).filter((n) => correspond(n, sel)); }
  };
  // `className` et `classList` sont deux vues du MÊME état : les séparer laissait passer un
  // `box.className = 'window'` sans que `classList.contains('window')` le sache.
  Object.defineProperty(el, 'className', {
    get(){ return Array.from(classes).join(' '); },
    set(v){ classes.clear(); String(v).split(/\s+/).filter(Boolean).forEach((c) => classes.add(c)); }
  });
  let html = '', txt = '';
  Object.defineProperties(el, {
    innerHTML: { get(){ return html; }, set(v){
      html = v;
      // Vider innerHTML DÉSINDEXE les enfants : sinon getElementById continuerait à rendre
      // des éléments qui ne sont plus dans l'arbre, et `sync()` synchroniserait du vide.
      if(doc) kids.forEach((c) => { c.parentNode = null; doc._deindex(c); });
      kids.length = 0;
      // …puis on RECONSTRUIT l'arbre décrit par la chaîne. Un `innerHTML` qui ne crée aucun
      // enfant laisse passer tout le code qui écrit son DOM ainsi puis le relit au sélecteur.
      if(doc && v) analyserHtml(doc, String(v), el);
    } },
    // `textContent` agrège les enfants, comme dans un navigateur : un placard d'erreur posé
    // en enfant doit être lisible depuis son hôte.
    textContent: {
      get(){ return txt + kids.map((c) => c.textContent || '').join(''); },
      set(v){ txt = v; }
    }
  });

  // `value`, `checked` et le curseur de sélection N'EXISTENT QUE SUR UN CONTRÔLE DE FORMULAIRE.
  //
  // Le stub les posait sur TOUT élément — un `<div>`, un `<span>`. C'est le genre de générosité
  // qui rend un test vert sur un moteur cassé : `js/ui/form.js` teste
  // `String(el.value).trim() !== ''` pour ne pas écraser une saisie en cours. Sur un vrai
  // `<span>`, `el.value` vaut `undefined`, donc `String(...)` donne « undefined » — jamais vide,
  // et la garde gelait DÉFINITIVEMENT tous les champs `info` du produit. Ici, `el.value` valait
  // `''` : la garde ne se déclenchait pas, le test passait, et le défaut a vécu jusqu'à ce qu'on
  // le voie dans un navigateur. Un harnais plus permissif que le navigateur ne mesure plus rien.
  if(/^(INPUT|TEXTAREA|SELECT|BUTTON|OPTION)$/.test(nomBalise)){
    el.value = '';
    el.selectionStart = 0;
    el.selectionEnd = 0;
  }
  if(nomBalise === 'INPUT'){
    el.checked = false;
    el.indeterminate = false;
  }
  return el;
}

function creerDocument(){
  const parId = new Map();
  let reelsIndexes = 0;
  const doc = {
    activeElement: null,
    createElement(tag){
      if(tag === 'canvas') return creerCanvas();
      if(tag === 'img') return creerImage();
      return creerElementGenerique(doc, tag);
    },
    createElementNS(_ns, tag){ return doc.createElement(tag); },
    // Un commentaire est un nœud comme un autre pour ce qui nous intéresse : il se pose dans
    // l'arbre et s'y retrouve. `windows.js` s'en sert comme ANCRE — c'est ce qui rend
    // l'adoption d'un élément réversible — donc le harnais doit savoir en créer.
    createComment(texte){
      const n = creerElementGenerique(doc, '#comment');
      n.nodeType = 8;
      n.textContent = texte;
      return n;
    },
    // Identité STABLE : c'est ce qui manquait. Un élément posé dans l'arbre avec un id est
    // retrouvé tel quel, sinon `sync()` synchroniserait des éléments qui n'existent pas.
    // Pendant le CHARGEMENT des fichiers de `js/`, un id inconnu rend un bouchon (et le
    // retient) : le code de production saisit ses éléments au chargement (`assets.js`,
    // `inspector.js`…) et planterait sur `null`. Une fois le chargement fini, un id inconnu
    // rend `null` — c'est ce que les tests d'interface mesurent : un champ absent est absent.
    _loading: true,
    getElementById(id){
      if(parId.has(id)) return parId.get(id);
      // Strict dès qu'un élément RÉEL a été indexé : à partir de là, le document est celui
      // que le test a construit, et un id absent est une absence à mesurer.
      if(!doc._loading && reelsIndexes > 0) return null;
      const stub = creerElementGenerique(doc, 'div');
      stub.id = id;
      stub._stub = true;
      parId.set(id, stub);
      return stub;
    },
    querySelector(){ return null; },
    querySelectorAll(){ return []; },
    addEventListener(){},
    _index(el){
      if(el && el.id) parId.set(el.id, el);
      // Compte les éléments RÉELS entrés dans l'arbre (avec ou sans id) : c'est le signal
      // qu'on est passé du chargement des fichiers au document construit par le test. Les
      // éléments nés d'un `innerHTML` ne comptent pas : avant que ce harnais sache analyser
      // une chaîne HTML, ils n'existaient tout simplement pas, et les compter ferait basculer
      // le document en mode strict dès qu'un fichier de `js/` écrit son DOM par chaîne — y
      // compris avant que le test ait construit quoi que ce soit.
      if(el && !el._stub && !el._fromHtml) reelsIndexes += 1;
      Array.prototype.slice.call((el && el.children) || []).forEach((c) => doc._index(c));
    },
    _deindex(el){
      if(el && el.id && parId.get(el.id) === el) parId.delete(el.id);
      Array.prototype.slice.call((el && el.children) || []).forEach((c) => doc._deindex(c));
    }
  };
  // <html> : le thème et la densité sont des attributs posés dessus (js/ui/prefs.js).
  doc.documentElement = creerElementGenerique(doc, 'html');
  doc.body = creerElementGenerique(doc, 'body');
  return doc;
}

function creerLocalStorage(){
  const m = new Map();
  return {
    getItem(k){ return m.has(k) ? m.get(k) : null; },
    setItem(k, v){ m.set(k, String(v)); },
    removeItem(k){ m.delete(k); },
    // `length`, `key(i)` et `clear()` sont indispensables pour tester la reprise des clés
    // nues (`window:*`, `copilot-*`) : elle exige d'ÉNUMÉRER les clés.
    get length(){ return m.size; },
    key(i){ return Array.from(m.keys())[i] ?? null; },
    clear(){ m.clear(); }
  };
}

// Fonctions d'UI/disque/historique référencées par materiaux.js, assets.js, import-settings.js
// et materiau-extraction.js mais sans effet sur ce que les 5 tests vérifient (statuts
// affichés à l'écran, journal console, sélection dans le panneau, écriture sur disque du
// dossier de project open...). Étendre cette liste si un ReferenceError apparaît à l'usage —
// voir Task 7.
const EXTERNES_INCIDENTES = {
  setStatus(){}, logConsole(){}, selectAsset(){}, updateTargetsImport: true,
  refreshInspectorAsset(){}, refreshModelsOfMaterial(){}, applyFilters(){},
  buildInspector(){}, pushHistory(){}, escapeHtml(s){ return s; },
  openModal(){}, closeModal(){}, ipText(){ return ''; }, ipChecked(){ return false; },
  instantiateAsset(){ return null; }, cloneCleanly(o){ return o; },
  // panneau d'assets (glisser-déposer de fichiers) : jamais manipulé par ces tests, qui
  // n'appellent que la logique métier d'assets.js, pas son câblage d'événements DOM.
  get viewEl(){ return creerElementGenerique(); },
  // body du panneau d'inspecteur (délégation d'événements 'change'/'input') : jamais lu par
  // les assertions, seulement câblé au chargement de import-settings.js.
  get inspBody(){ return creerElementGenerique(); },
  // asset actuellement sélectionné dans le panneau (surlignage visuel de la tile) : jamais lu
  // par les assertions, seulement par le rendu HTML du panneau d'assets.
  assetSelected: null,
  // Globales que js/history.js lit au moment de photographier la scène. Les tests du socle
  // d'interface ne mesurent QUE la garde d'interaction (combien d'instantanés, et lesquels
  // sont refusés) : le contenu de l'instantané ne les regarde pas, d'où ces bouchons.
  phys: { active: false },
  assets: [],
  // Fonctions du moteur que les DESCRIPTEURS d interface (js/ui/panels-*.js) appellent par leur
  // nom. Un test qui mesure un descripteur les remplace sur le contexte ; celles-ci sont le
  // repli, pour que charger le fichier ne lève pas.
  ensureGame(o){ if(!o.userData.game) o.userData.game = {tag:'', layer:'Défaut', props:{}}; return o.userData.game; },
  resolveLayer(c){ return c; },
  namesAnimations(){ return []; },
  playAnimationModel(){ return true; },
  stopAnimationModel(){},
  assetPrefabOf(){ return null; },
  instanceModified(){ return false; },
  applyAtPrefab(){}, resetInstance(){}, createVariantPrefab(){}, renderInstanceUnique(){},
  applyEnvironment(){}, applyFilters(){}, ensurePost(){ return {}; },
  anim: { tracks: [], duration: 0, loop: false },
  env: {},
  selection: null,
  selectionMulti: [],
  serializeObject(o){ return { id: o && o.id }; }
};

export function creerContexte(fileNames){
  // Le tableau `objects` est parfois remplacé par un test (sandbox.objets = [...]) :
  // les quatre fonctions d'index ci-dessous doivent viser le tableau COURANT, pas
  // celui capturé à la construction.
  const sandboxObjets = () => sandbox.objects;
  // Les abonnements posés sur `window` lui-même — voir `addEventListener` plus bas.
  const ecouteursWindow = new Map();
  const sandbox = {
    console, Math, JSON, Object, Array, Map, Set, Promise, Date, RegExp, Error,
    Uint8ClampedArray, Int32Array,
    File, Blob,
    setTimeout, clearTimeout, queueMicrotask,
    URL: {
      createObjectURL(source){
        const u = 'blob:moteur-test-' + (++compteurUrl);
        SOURCE_PAR_URL.set(u, source);
        return u;
      },
      revokeObjectURL(u){ SOURCE_PAR_URL.delete(u); }
    },
    // project.js/project-folder.js chronomètrent l'ouverture d'un dossier de projet
    // (performance.now()) — absent du sandbox par défaut, contrairement au navigateur réel.
    performance: {now: () => Date.now()},
    localStorage: creerLocalStorage(),
    document: creerDocument(),
    Image: function Image(){ return creerImage(); },
    navigator: { userAgent: 'node' },
    project: { handleFolder: null, folders: [], name: 'Test',
      // Les calques : le descripteur d identite en tire les options de son <select>.
      layers: [{ id: 0, name: 'Défaut' }] },
    objects: [],
    // L'index d'appartenance à la scène (objects.js). Repiqué ici parce que la
    // plupart des fichiers testés posent la question `isSceneObject(o)` sans
    // pour autant justifier de charger objects.js entier (qui veut la scène, le
    // renderer, la bar d'outils…). Un test qui charge le vrai objects.js écrase
    // ces quatre fonctions par les vraies : `function` top-niveau devient une
    // propriété du global, donc la dernière chargée gagne. Les sémantiques sont
    // identiques — c'est ce qui rend la substitution sans effet de bord.
    // Aides d'édition (js/editor-overlay.js) : sans effet sur ce que les tests mesurent, repiqué
    // pour qu'un fichier qui l'appelle n'oblige pas chaque test à charger ce module.
    liftOverlay(o){ return o; },
    isSceneObject(o){ return !!o && sandboxObjets().indexOf(o) !== -1; },
    addSceneObject(o){
      const list = sandboxObjets();
      if(o && list.indexOf(o) === -1) list.push(o);
      return o;
    },
    removeSceneObject(o){
      const list = sandboxObjets();
      const i = list.indexOf(o);
      if(i === -1) return false;
      list.splice(i, 1);
      return true;
    },
    clearSceneObjects(){ sandboxObjets().length = 0; },
    // NodeShells (component.js) — BOUCHON, même raison que le Registry ci-dessous : les
    // fichiers du moteur ENREGISTRENT leur porteur de nœud au chargement (objects.js,
    // terrain.js, probes.js…), et beaucoup de tests les chargent sans le socle à composants.
    // Un test qui charge le vrai js/component.js voit le vrai registre : son `const` de haut
    // niveau rejoint la portée lexicale du contexte et masque ce bouchon.
    NodeShells: {
      byComponent: new Map(),
      register(typeName, build){ this.byComponent.set(typeName, build); },
      make(){ return { object3d: null, missing: null }; }
    },
    // Registry de composants (component.js) — BOUCHON de lecture seule.
    //
    // Les Systèmes ne demandent plus « quels objets ont ce sac userData ? » mais
    // « quels Noeuds portent ce composant ? » (Registry.activeNodes). Un test
    // qui n'exerce PAS le modèle de composants monte pourtant des fixtures à
    // l'ancienne (`userData.type = 'mesh'`, `userData.probe = {...}`) : sans ce
    // bouchon, elles seraient invisibles et le test mesurerait un vide.
    //
    // Le bouchon répond donc à partir des fixtures, via la correspondance
    // composant → sac historique ci-dessous. Un test qui charge le vrai
    // js/component.js écrase cet objet (il fait `globalThis.Registry = ...`
    // explicitement) et retrouve le comportement de production.
    Registry: {
      _predicats: {
        Mesh: (o) => o.userData.type === 'mesh',
        Model: (o) => o.userData.type === 'model',
        Terrain: (o) => o.userData.type === 'terrain',
        Reflection: (o) => o.userData.type === 'probe',
        Particles: (o) => o.userData.type === 'particles',
        Camera: (o) => o.userData.type === 'camera',
        Physics: (o) => !!o.userData.phys,
        Collider: (o) => !!o.userData.collider,
        UIDocument: (o) => !!o.userData.uiDoc,
        AnimatorController: (o) => !!o.userData.animator
      },
      activeNodes(typeName){
        const p = this._predicats[typeName];
        return p ? sandboxObjets().filter((o) => o && o.userData && p(o)) : [];
      },
      active(typeName){ return this.activeNodes(typeName); },
      eachActive(typeName, fn){ this.activeNodes(typeName).forEach((o) => fn(null, o)); },
      instances(){ return new Set(); },
      count(typeName){ return this.activeNodes(typeName).length; },
      register(){}, unregister(){}, unindexNode(){}, clear(){},
      registeredClasses: [], classesByType: new Map(),
      registerClass(){}, classByType(){ return null; }
    },
    renderer: { outputColorSpace: null, capabilities: { getMaxAnisotropy(){ return 1; } } },
    // `addEventListener` NU (celui de window) : scripts.js, ui.js et prefs.js s'abonnent au
    // clavier et à `storage` dès leur chargement. On ne DÉCLENCHE toujours rien — un test qui
    // veut exercer un écouteur appelle la fonction directement — mais on COMPTE désormais les
    // abonnements. Motif : les écouteurs posés sur `window` survivent à l'élément qui les a
    // posés, et une fenêtre fermée qui laisse les siens derrière elle ne produit aucune erreur,
    // aucune trace — seulement une page qui ralentit et des gestes qui se marchent dessus.
    // `windowListenerCount()` rend cette fuite-là mesurable par un test, sans navigateur.
    addEventListener(type, fn){
      if(!ecouteursWindow.has(type)) ecouteursWindow.set(type, []);
      ecouteursWindow.get(type).push(fn);
    },
    removeEventListener(type, fn){
      const l = ecouteursWindow.get(type);
      if(l) ecouteursWindow.set(type, l.filter((f) => f !== fn));
    },
    dispatchEvent(){ return true; },
    /** Nombre d'écouteurs encore abonnés sur `window` — pour un type donné, ou tous types. */
    windowListenerCount(type){
      if(type !== undefined) return (ecouteursWindow.get(type) || []).length;
      let n = 0;
      ecouteursWindow.forEach((l) => { n += l.length; });
      return n;
    },
    ...EXTERNES_INCIDENTES
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  const contexte = vm.createContext(sandbox);

  const cheminThree = path.join(racineMoteur, 'vendor', 'three.min.js');
  vm.runInContext(readFileSync(cheminThree, 'utf8'), contexte, { filename: cheminThree });
  // preview WebGL non pertinent pour ces tests : un vrai contexte GL n'est pas simulable sans
  // navigateur, et aucune assertion ne lit jamais la vignette qu'il produirait.
  // `THREE.WebGLRenderer` est exposé par three.min.js via un accesseur get-only non
  // configurable (`Object.defineProperty` échouerait, et une simple affectation serait
  // silencieusement ignorée) : on intercepte plutôt la variable globale `THREE` elle-même
  // (celle-ci est un `var` normal, réassignable) avec un Proxy qui ne détourne que cette seule
  // propriété — tout le reste du namespace THREE reste inchangé pour les fichiers chargés après.
  vm.runInContext(`
    THREE = new Proxy(THREE, {
      get(target, propriete){
        if(propriete === 'WebGLRenderer'){
          return function(){
            this.domElement = document.createElement('canvas');
            this.shadowMap = {};
            this.capabilities = { getMaxAnisotropy(){ return 1; } };
            this.setSize = function(){};
            this.setPixelRatio = function(){};
            this.render = function(){};
          };
        }
        return target[propriete];
      }
    });
  `, contexte);

  // TROIS MODULES SOCLES, CHARGES POUR DE VRAI ET POUR TOUS LES CONTEXTES.
  //
  // Ils n'importent rien, ne touchent pas au DOM, et le reste du moteur ne sait plus s'en
  // passer :
  //   · js/primitive-geometry.js — js/objects.js ne construit plus une forme lui-meme, il
  //     demande son instance partagee ;
  //   · js/primitives-extra.js — l'autre moitie de la meme table (etoile, losange, vague), que
  //     js/objects.js passe a `primitiveGeometry` pour qu'elles partagent le meme cache ;
  //   · js/render-perf.js — `visibleIntent()` y vit, et c'est desormais la lecture correcte de
  //     la visibilite d'un objet pour la serialisation, la hierarchie, les surcharges de modele
  //     et la boucle de scripts ;
  //   · js/audio-bus.js — les bus de mixage : `projectSettingsOf` en relit les volumes, donc tout
  //     contexte qui charge un projet en a besoin ;
  //   · js/chip-synth.js — le calcul d'un bruitage, qu'un projet relu recrée depuis sa recette.
  //
  // LE VRAI FICHIER, JAMAIS UN SUBSTITUT. Un faux `visibleIntent` rendrait ces tests verts sans
  // jamais exercer la difference entre « masque par la personne » et « dessine par un lot » —
  // c'est-a-dire le seul endroit ou cette famille de defauts peut se cacher. C'est la lecon du
  // `escapeHtml` de complaisance qui a laisse un editeur mort passer 1 831 tests.
  //
  // `filter` : un test qui demande explicitement l'un d'eux le recevrait deux fois, et un
  // `const` top-niveau redeclare est une SyntaxError qui tue le contexte entier.
  ['js/primitive-geometry.js', 'js/primitives-extra.js', 'js/render-perf.js', 'js/audio-bus.js',
   'js/chip-synth.js', 'js/music-loop.js', 'js/track-sampling.js',
   // js/load-retry.js — le réessai des chargements (BUGS_MOTEUR n° 18/19), pur, sans import :
   // serialization.js et game-runtime.js l'appellent sans garde `typeof`.
   'js/load-retry.js',
   // js/texture-preview.js — les selecteurs de texture de l'inspecteur, sortis d'import-settings.js
   // (v0.196.0) : feuille, sans autre import qu'escape-html.js.
   'js/texture-preview.js']
    .filter((relatif) => fileNames.indexOf(relatif) === -1)
    .forEach((relatif) => {
      vm.runInContext(deEsm(readFileSync(path.join(racineMoteur, relatif), 'utf8')),
        contexte, { filename: relatif });
    });

  fileNames.forEach((relatif) => {
    const filePath = path.join(racineMoteur, relatif);
    vm.runInContext(deEsm(readFileSync(filePath, 'utf8')), contexte, { filename: filePath });
  });
  // Le chargement est fini : à partir d'ici, un id inconnu rend `null`.
  sandbox.document._loading = false;

  // Un `const`/`let` top-niveau d'un script exécuté via vm.runInContext rejoint l'environnement
  // lexical global du contexte (donc les autres scripts chargés ensuite dans ce même contexte
  // peuvent le référencer directement), mais ne devient jamais une propriété de l'object global
  // lui-même — seuls les `function`/`var` top-niveau le font. Sans ce pont explicite, `env.assets`
  // etc. resteraient `undefined` pour du code exécuté hors du contexte vm (nos tests). Chaque
  // liaison est dans son propre try/catch car un test ne charge pas forcément le fichier qui la
  // déclare.
  const NOMS_A_PONTER = ['assets', 'MATERIAL_DEFAULT', 'GLSL_RUG_THREE', 'GLSL_RUG_SMOOTHING',
    // Socle d'interface (js/ui/*) : ce sont des `const` de haut niveau, donc invisibles depuis
    // les tests sans ce pont — voir le commentaire ci-dessus.
    'UIRegistry', 'Panels', 'FIELD_MIXED', 'PROPS_MATERIAL',
    'PANEL_IDENTITY', 'PANEL_MODEL', 'PANEL_ANIMATIONS', 'PANEL_PREFAB',
    'LAYOUT_DEFAULT', 'Dock',
    'PANEL_ENVIRONMENT', 'PANEL_RENDER', 'PANEL_SUBSCENE', 'ComponentPanels',
    // Réglages de projet et préférences (lot 3) : les défauts, le registre, les descripteurs.
    'INPUTS_DEFAULT', 'LIGHTMAP_DEFAULT', 'ENV_DEFAULT', 'LAYERS_DEFAULT',
    // Les défauts d'import d'un asset (js/import-settings.js) : `const` top-niveau lui aussi.
    'IMPORT_DEFAULT',
    'PROJECT_SETTINGS_KEYS', 'Prefs', 'PREFS_DEFAULT', 'PANEL_PROJECT_SETTINGS',
    'PANEL_PREFERENCES',
    // API de plugin v2.
    'Editor', 'PluginSections', 'COLLECTIONS_PLUGIN', 'PluginHost',
    // Composants testés directement par leur constructeur (plutôt que via l'API objects.js) :
    // même raison que ci-dessus, `class PostVolume` est un `const`-like top-niveau.
    'PostVolume',
    // Entrées clavier (js/scripts.js) : `const keysGame` top-niveau, même raison que ci-dessus.
    'keysGame',
    // Le catalogue de templates du Project Hub (js/hub/hub-templates.js) : `const HubTemplates`
    // top-niveau, même raison que ci-dessus.
    'HubTemplates',
    // État d'environnement de la scène (js/environment.js) : `let env` top-niveau, même
    // raison que ci-dessus. Sans ce pont, `env.env.post = ...` depuis un test agirait sur la
    // propriété `env` préexistante du sandbox (un objet `{}` sans rapport), pas sur la
    // variable lexicale `env` que lisent réellement postfx.js et component-postvolume.js.
    'env',
    // La table des formes (js/primitive-geometry.js) : trois `const` top-niveau, meme raison
    // que ci-dessus. Les fonctions du meme fichier n'ont pas besoin du pont — une `function`
    // top-niveau devient bien une propriete de l'objet global, un `const` jamais.
    'PRIMITIVE_SEGMENTS', 'PRIMITIVE_KINDS', 'PRIMITIVE_LABELS', 'EXTRA_PRIMITIVES',
    // Les lots d'instances (js/render-perf.js) : `const engineInstances` top-niveau. Le banc de
    // scène en a besoin pour vérifier qu'une image immobile ne réécrit aucune matrice.
    'engineInstances',
    // Les reglages du decoupage spatial (js/render-perf.js), lus par le banc de scene.
    'LOTS_MAX', 'CELL_SIZE', 'CELL_MIN_INSTANCES', 'CELLS_MAX', 'THRESHOLD_INSTANCES'];
  vm.runInContext(
    NOMS_A_PONTER.map((n) => `if (typeof ${n} !== 'undefined') this.${n} = ${n};`).join('\n'),
    contexte
  );

  return contexte;
}

// Fabrique un fichier PNG factice (voir le format interne de creerCanvas.toBlob) rempli d'une
// seule color RGBA, prêt à passer à env.createAssetTexture(...). Évite de répéter la danse
// canvas/toBlob/File dans chaque test.
export async function fabriquerFichierTexture(env, fileName, r, g, b, a){
  const cv = env.document.createElement('canvas');
  cv.width = 2; cv.height = 2;
  const cx = cv.getContext('2d');
  const data = cx.createImageData(2, 2);
  for(let i = 0; i < data.data.length; i += 4){
    data.data[i] = r; data.data[i+1] = g; data.data[i+2] = b; data.data[i+3] = a;
  }
  cx.putImageData(data, 0, 0);
  const blob = await new Promise((resolve) => cv.toBlob(resolve, 'image/png'));
  return new File([blob], fileName, { type: 'image/png' });
}
