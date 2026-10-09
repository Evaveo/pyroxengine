import { deEsm } from './engine-env.mjs';
// moteur/test/cadence-timer.test.mjs
// GARDE sur le CADENCEMENT D'IMAGES des deux boucles de rendu (js/viewport.js et
// js/game-runtime.js). Une error ici n'allume aucun voyant : elle accélère, ralentit ou fige
// le jeu, et se lit comme un problème de performance.
//
// THREE.Clock est déprécié en r185 au profit de THREE.Timer. L'échange n'est pas un
// renommage, et la différence qui compte a été MESURÉE sur le bundle vendorisé :
//   - Clock démarre PARESSEUSEMENT, au premier getDelta(). Les deux boucles n'appellent
//     getDelta() qu'une fois `renderer.__ready` vrai (init WebGPU asynchrone, et pour le
//     runtime après `await loadAssets()`), donc la première image valait dt = 0.
//   - Timer démarre à sa CONSTRUCTION. Sans amorçage, la première image encaisse toute
//     l'pending d'un coup : 3 s d'init => dt de 3 s. viewport.js ne plafonne pas dt.
//   - reset() remet le counter à zéro mais PAS le delta déjà calculé : reset() doit donc
//     précéder update(), l'ordre inverse ne corrige rien.
//   - getDelta() de Timer est NON destructif (deux appels rendent la même valeur), là où
//     celui de horloge consommait le temps. C'est update() qui consomme, et lui seul.
//
// CE QUE CE TEST EXERCICE VRAIMENT : il ne réimplémente pas les boucles, il EXTRAIT du
// file réel le prologue de cadencement (de `function loop(){` jusqu'à la ligne qui
// déclare `dt`, incluse) et la ligne qui passe le temps au post-traitement, puis les exécute
// telles quelles contre le VRAI THREE.Timer du bundle vendorisé, clock sous contrôle.
// Toute autre lecture de `clock.` dans le fichier fait échouer l'extraction : elle ne peut
// donc pas rater un usage.
//
// LIMITE ASSUMÉE : le reste du corps de boucle() n'est pas exécutable hors navigateur (il
// dépend de la scène, du renderer, de la physique). La pause elle-même est traitée plus bas
// dans la boucle, par `inPause` ; ce qu'on prouve ici est la moitié horloge du problème —
// que le temps de la pause ne s'accumule pas pour ressortir d'un bloc à la reprise — plus,
// structurellement, qu'update() n'est enfermé dans aucune condition.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const racineMoteur = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRES = 1e-9;
const presque = (a, b, quoi) => assert.ok(Math.abs(a - b) < PRES, quoi + ' : attendu ' + b + ', obtenu ' + a);

// ---------------------------------------------------------------- extraction du vrai code

function extraireCadence(relatif){
  const lines = deEsm(readFileSync(path.join(racineMoteur, relatif), 'utf8')).split('\n');
  const iBoucle = lines.findIndex((l) => /^function loop\(\)\{/.test(l));
  assert.notEqual(iBoucle, -1, relatif + " : « function loop(){ » introuvable en colonne 0 — "
    + 'ce test extrait le cadencement par ce repère.');

  const declarations = lines.filter((l) => /^(?:const|let|var)\s+clock/.test(l));
  assert.ok(declarations.length >= 1, relatif + ' : aucune déclaration `clock` au premier niveau.');

  const iFin = lines.findIndex((l, i) => i > iBoucle && /^\s*const dt\s*=/.test(l));
  assert.notEqual(iFin, -1, relatif + ' : la ligne qui déclare `dt` est introuvable dans loop().');
  const prologue = lines.slice(iBoucle + 1, iFin + 1);

  // toute autre lecture de l'horloge dans le fichier : elle doit être connue, sinon
  // l'extraction en raterait une et ce test croirait couvrir ce qu'il ne couvre pas.
  const dehors = [];
  lines.forEach((l, i) => {
    if(!/\bclock\./.test(l)) return;
    if(/^\s*\/\//.test(l)) return;                  // ligne de commentaire
    if(i > iBoucle && i <= iFin) return;            // déjà dans le prologue
    dehors.push(l);
  });
  assert.equal(dehors.length, 1, relatif + " : on attend exactement UNE lecture de l'horloge hors "
    + 'du prologue (le temps passé au post-traitement). Trouvé : ' + JSON.stringify(dehors));

  assert.ok(prologue.some((l) => /clock\.update\(\)/.test(l)),
    relatif + " : `clock.update()` doit être dans le prologue, AVANT la ligne qui déclare dt — "
    + 'appelé après, getDelta() rendrait le delta de l\'image précédente.');
  return { declarations, prologue, dehors };
}

// ------------------------------------------------------------------- bac à sable + clock

function bacAvecThree(){
  const state = { ms: 0, capture: null, ready: true };
  const elementFactice = () => ({ style: {}, getContext: () => null, width: 1, height: 1,
                                  addEventListener(){}, removeEventListener(){} });
  const bac = {
    Math, JSON, Object, Array, Map, Set, Promise, Date, RegExp, Error, Number,
    Float32Array, Uint8Array, Uint16Array, Uint32Array, Int32Array, ArrayBuffer, DataView,
    setTimeout, clearTimeout, queueMicrotask,
    console: { log(){}, warn(){}, error(){}, info(){} },
    document: { createElement: elementFactice, createElementNS: elementFactice,
                addEventListener(){}, hidden: false },
    navigator: { userAgent: 'node' },
    performance: { now: () => state.ms },
    requestAnimationFrame: () => 0,
    loop(){},                                   // référencé par requestAnimationFrame(loop)
    XR_WANTED: false,                           // game-runtime.js : `if(!XR_WANTED) requestAnimationFrame(loop)`
    get renderer(){ return { __ready: state.ready }; },
    viewEl: { clientWidth: 800, clientHeight: 600 },
    scene: {}, camCurrent: () => ({}),
    postActive: () => true,
    postRender: (...a) => { state.capture = a[4]; },
    game: { post: true, scene: {}, cam: {} },
    rtPostRender: (...a) => { state.capture = a[2]; }
  };
  bac.window = bac; bac.self = bac; bac.globalThis = bac;
  const ctx = vm.createContext(bac);
  vm.runInContext(deEsm(readFileSync(path.join(racineMoteur, 'vendor/three.min.js'), 'utf8')), ctx,
                  { filename: 'vendor/three.min.js' });
  return { ctx, state };
}

// Rend une fonction « une image » neuve (clock neuve), bâtie sur les lignes réelles.
function fabriquerImage(ctx, ex){
  const src = 'globalThis.__fabriquer = function(){\n'
    + ex.declarations.join('\n') + '\n'
    + 'return function(){\n'
    + ex.prologue.join('\n') + '\n'
    + ex.dehors.join('\n') + '\n'
    + 'return dt;\n'
    + '};\n};';
  vm.runInContext(src, ctx, { filename: 'cadence-extraite.js' });
  return vm.runInContext('__fabriquer()', ctx);
}

// ------------------------------------------------------- probe structurelle : profondeur

// Remplace commentaires et chaînes par des espaces SANS changer la longueur, pour compter
// des accolades sans se faire piéger par une brace en commentaire ou dans un littéral.
// Un `/` ouvre une EXPRESSION RÉGULIÈRE quand le dernier caractère significatif ne peut
// pas terminer une expression — sinon c'est une division. Heuristique classique, et
// suffisante pour du code de ce dépôt.
//
// Sans elle, `.replace(/"/g, '&quot;')` (objects.js:114) ouvrait une fausse chaîne sur son
// guillemet et tout le reste du fichier partait en blanc : 221 lignes sur 293 effacées.
// La sonde de profondeur ne voyait alors plus rien, et ne pouvait donc plus échouer.
function ouvreUneRegex(out){
  const avant = out.replace(/\s+$/, '');
  if(!avant) return true;
  return !/[A-Za-z0-9_$)\]]/.test(avant[avant.length - 1]);
}

function neutraliser(src){
  let out = '', i = 0;
  while(i < src.length){
    const c = src[i], d = src[i + 1];
    if(c === '/' && d !== '/' && d !== '*' && ouvreUneRegex(out)){
      out += ' '; i++;                        // le / ouvrant
      let dansClasse = false;
      while(i < src.length && src[i] !== '\n'){
        if(src[i] === '\\'){ out += '  '; i += 2; continue; }
        if(src[i] === '[') dansClasse = true;
        else if(src[i] === ']') dansClasse = false;
        else if(src[i] === '/' && !dansClasse){ out += ' '; i++; break; }
        out += ' '; i++;
      }
      while(i < src.length && /[a-z]/.test(src[i])){ out += ' '; i++; }   // drapeaux
      continue;
    }
    if(c === '/' && d === '/'){ while(i < src.length && src[i] !== '\n'){ out += ' '; i++; } continue; }
    if(c === '/' && d === '*'){
      while(i < src.length && !(src[i] === '*' && src[i + 1] === '/')){ out += (src[i] === '\n' ? '\n' : ' '); i++; }
      out += '  '; i += 2; continue;
    }
    if(c === '"' || c === "'" || c === '`'){
      out += ' '; i++;
      while(i < src.length && src[i] !== c){
        if(src[i] === '\\'){ out += '  '; i += 2; continue; }
        out += (src[i] === '\n' ? '\n' : ' '); i++;
      }
      out += ' '; i++; continue;
    }
    out += c; i++;
  }
  return out;
}

// Régression ciblée sur le tokenizer lui-même. Le scan de dépréciation ci-dessous ne vaut
// que ce que vaut `neutraliser` : s'il se désynchronise, il efface la sequence du fichier, le
// scan ne trouve plus rien, et il PASSE. C'est ce qui s'est produit — une expression
// régulière contenant un guillemet (`.replace(/"/g, ...)`, objects.js:114) ouvrait une
// fausse chaîne et emportait 221 lignes sur 293.
//
// On ne teste donc pas « le tokenizer est parfait » — il ne le sera jamais — mais qu'il
// résiste au cas EXACT qui nous a déjà coûté une garde muette. Ce test échoue si l'on
// retire la reconnaissance des expressions régulières : vérifié par mutation.
test('neutraliser ne se desynchronise pas sur une regex contenant un guillemet', () => {
  const source = 'function a(){\n'
    + '  return s.replace(/"/g, "&quot;").replace(/\'/g, "&#39;");\n'
    + '}\n'
    + 'const APRES_LA_REGEX = 1;\n';
  const net = neutraliser(source);

  assert.equal(net.length, source.length,
    'la neutralisation doit préserver les longueurs — sinon les positions ne veulent plus rien dire');
  assert.ok(net.indexOf('APRES_LA_REGEX') !== -1,
    'ce qui SUIT la regex a été effacé : le tokenizer s’est désynchronisé, et tout scan '
    + 'construit dessus devient muet sans le dire');
  assert.equal(net.indexOf('quot'), -1,
    'le contenu des chaînes doit bien être neutralisé, lui');
});

// Profondeur d'accolades d'une instruction dans loop(). 1 = instruction directe du body,
// donc jamais sautée. >1 = enfermée dans une condition — ce qu'on refuse pour update().
function profondeurDansBoucle(source, aiguille){
  const net = neutraliser(source);
  const tete = 'function loop(){';
  const start = net.indexOf(tete);
  if(start === -1) return { ok: false, reason: 'loop() introuvable' };
  const depuis = start + tete.length - 1;          // pointe sur l'brace ouvrante
  let depth = 0, end = -1;
  for(let i = depuis; i < net.length; i++){
    if(net[i] === '{') depth++;
    else if(net[i] === '}'){ depth--; if(depth === 0){ end = i; break; } }
  }
  if(end === -1) return { ok: false, reason: 'accolades non refermées (neutralisation désynchronisée ?)' };
  const pos = net.indexOf(aiguille, depuis);
  if(pos === -1 || pos > end) return { ok: false, reason: aiguille + ' absent de boucle()' };
  let p = 0;
  for(let i = depuis; i < pos; i++){
    if(net[i] === '{') p++;
    else if(net[i] === '}') p--;
  }
  return { ok: true, depth: p };
}

const BOUCLES = ['js/viewport.js', 'js/game-runtime.js'];

// ------------------------------------------------------------------------------- les tests

test('la sonde de profondeur sait distinguer un update() enferme d\'un update() libre', () => {
  // Sans ce contrôle, une sonde cassée validerait tout — c'est exactement ainsi qu'un test
  // de patch de shader avait fini par ne rien distinguer.
  const libre = 'function loop(){\n  clock.update();\n  const dt = clock.getDelta();\n}\n';
  const enferme = 'function loop(){\n  if(!inPause){ clock.update(); }\n  const dt = 0;\n}\n';
  const piege = 'function loop(){\n  // brace { en commentaire\n  const s = "} et une dans une chaine";\n'
              + '  clock.update();\n}\n';

  assert.deepEqual(profondeurDansBoucle(libre, 'clock.update()'), { ok: true, depth: 1 });
  assert.deepEqual(profondeurDansBoucle(enferme, 'clock.update()'), { ok: true, depth: 2 },
    'une sonde qui rend 1 ici ne distingue rien et validerait une pause qui gèle l\'horloge');
  assert.deepEqual(profondeurDansBoucle(piege, 'clock.update()'), { ok: true, depth: 1 },
    'accolades en commentaire ou en chaîne : la neutralisation doit les ignorer');
  assert.equal(profondeurDansBoucle('function autre(){}', 'clock.update()').ok, false);
});

test('THREE.Timer existe et est constructible dans le bundle vendorise', () => {
  // Le dépôt a hébergé jusqu'à aujourd'hui un three r128 (dans build-test/vendor/) où Timer
  // n'existe pas : une régression de vendorisation rendrait `new THREE.Timer()` fatal.
  const { ctx } = bacAvecThree();
  const r = vm.runInContext('({rev: THREE.REVISION, type: typeof THREE.Timer, '
    + 'instantiable: (function(){ try { return new THREE.Timer() instanceof THREE.Timer; } '
    + 'catch(e){ return String(e); } })()})', ctx);
  assert.equal(r.type, 'function', 'THREE.Timer absent de vendor/three.min.js (révision ' + r.rev + ')');
  assert.equal(r.instantiable, true);
});

test('plus aucun THREE.Clock ni .elapsedTime dans moteur/js', () => {
  // .elapsedTime est propre à Clock : sur un Timer la lecture vaut `undefined`, part en NaN
  // dans l'uniforme de temps du post-traitement, et rien n'est signalé.
  // On scanne le code NEUTRALISÉ : les deux boucles expliquent la dépréciation en
  // commentaire, et un test qui compterait ces mentions se déclencherait sur sa propre
  // documentation (constaté en écrivant ce test).
  const fautifs = [];
  const marcher = (d) => readdirSync(d, { withFileTypes: true }).forEach((e) => {
    const p = path.join(d, e.name);
    if(e.isDirectory()) return marcher(p);
    if(!/\.(js|mjs)$/.test(e.name)) return;
    const raw = readFileSync(p, 'utf8');
    const code = neutraliser(raw);
    const court = path.relative(racineMoteur, p).replace(/\\/g, '/');
    // INVARIANT DE DÉSYNCHRONISATION, et c'est lui la vraie protection de ce test.
    // Un tokenizer JS écrit à la main ne sera jamais complet : il suffit d'une
    // construction non préview pour qu'il croie entrer dans une chaîne et « neutralise »
    // tout ce qui suit. Le scan devient alors muet — il ne trouve plus rien, donc il
    // pass. C'est arrivé : une expression régulière contenant un guillemet effaçait 221
    // lignes sur 293. Corriger le tokenizer ne suffit pas : le prochain trou est inconnu.
    //
    // On ne mesure PAS la proportion de texte qui survit — ce dépôt est très commenté et
    // certains fichiers sont légitimement à 18 % de code (essai fait, il criait au loup
    // sur huit files sains). On mesure l'ÉQUILIBRE DES ACCOLADES : du code JS bien
    // formé en a autant d'ouvrantes que de fermantes une fois chaînes et commentaires
    // retirés. Une désynchronisation avale des fermantes, et le count ne tombe plus juste.
    let solde = 0;
    for(const ch of code){ if(ch === '{') solde++; else if(ch === '}') solde--; }
    if(solde !== 0){
      fautifs.push(court + ' : neutralisation désynchronisée (solde d’accolades ' + solde
        + '). Le scan de ce fichier ne prouve RIEN tant que ce n’est pas corrigé.');
    }
    if(/\bTHREE\.Clock\b/.test(code)) fautifs.push(court + ' : THREE.Clock (déprécié en r185)');
    if(/\.elapsedTime\b/.test(code)) fautifs.push(court + ' : .elapsedTime (Timer expose getElapsed())');
  });
  marcher(path.join(racineMoteur, 'js'));
  assert.deepEqual(fautifs, []);
});

for(const relatif of BOUCLES){
  test(relatif + ' : update() n\'est enferme dans aucune condition', () => {
    const source = readFileSync(path.join(racineMoteur, relatif), 'utf8');
    for(const aiguille of ['clock.update()', 'clock.getDelta()']){
      const r = profondeurDansBoucle(source, aiguille);
      assert.equal(r.ok, true, relatif + ' / ' + aiguille + ' : ' + r.reason);
      assert.equal(r.depth, 1, relatif + ' : `' + aiguille + '` est sous une condition '
        + '(profondeur ' + r.depth + '). Une image sautée ne consomme pas son time : '
        + 'il ressort d\'un bloc à l\'image suivante.');
    }
  });

  test(relatif + ' : le delta extrait du vrai file vaut une image, et zero a l\'amorcage', () => {
    const { ctx, state } = bacAvecThree();
    const ex = extraireCadence(relatif);
    state.ms = 0;
    const image = fabriquerImage(ctx, ex);

    state.ms = 16;  presque(image(), 0, 'première image (amorçage, comme le faisait Clock)');
    state.ms = 32;  presque(image(), 0.016, 'deuxième image');
    state.ms = 48;  presque(image(), 0.016, 'troisième image');
    // 30 ms reste sous le plafond du runtime (0,05 s) : la même pending vaut pour les deux
    // boucles. Les plafonds, eux, ont leur test dédié plus bas — c'est ce qui a fait échouer
    // une première version de ce cas, qui attendait 0,1 s des deux côtés.
    state.ms = 78;  presque(image(), 0.03, 'image longue de 30 ms');
  });

  test(relatif + ' : trois secondes d\'init WebGPU ne partent pas dans la premiere image', () => {
    // LE piège de la migration, mesuré : Timer démarre à sa construction, pas au premier
    // getDelta(). Sans amorçage on lirait ici dt = 3 (ou le plafond, pour le runtime).
    const { ctx, state } = bacAvecThree();
    const ex = extraireCadence(relatif);
    state.ms = 0;
    const image = fabriquerImage(ctx, ex);

    state.ready = false;
    for(let i = 1; i <= 180; i++){                 // ~3 s d'images sautées par la garde __ready
      state.ms = i * 16;
      assert.equal(image(), undefined, 'aucune image ne doit être rendue avant renderer.__ready');
    }
    state.ready = true;
    state.ms = 3000;
    presque(image(), 0, 'première image RÉELLEMENT rendue, après 3 s d\'pending');
    state.ms = 3016;
    presque(image(), 0.016, 'et la suivante reprend un rythme normal');
  });

  test(relatif + ' : le temps passe au post-traitement est un number fini qui avance', () => {
    // Si `.elapsedTime` survivait quelque part, on capturerait `undefined` ici, en silence.
    const { ctx, state } = bacAvecThree();
    const ex = extraireCadence(relatif);
    state.ms = 0;
    const image = fabriquerImage(ctx, ex);

    state.ms = 16; image();
    assert.equal(Number.isFinite(state.capture), true,
      'le temps passé au post-traitement vaut ' + state.capture + ' — Timer n\'a pas de .elapsedTime');
    presque(state.capture, 0, 'temps écoulé à la première image');
    state.ms = 32; image(); presque(state.capture, 0.016, 'temps écoulé à la deuxième image');
    state.ms = 48; image(); presque(state.capture, 0.032, 'temps écoulé à la troisième image');
  });
}

test('js/viewport.js : une image longue n\'est PAS plafonnee (d\'ou l\'amorcage obligatoire)', () => {
  const { ctx, state } = bacAvecThree();
  const ex = extraireCadence('js/viewport.js');
  state.ms = 0;
  const image = fabriquerImage(ctx, ex);
  state.ms = 16; image();
  state.ms = 5016;
  presque(image(), 5, 'viewport.js ne clamped pas dt : rien ne rattraperait une première image géante');
});

test('js/game-runtime.js : le plafond de 0,05 s tient toujours', () => {
  const { ctx, state } = bacAvecThree();
  const ex = extraireCadence('js/game-runtime.js');
  state.ms = 0;
  const image = fabriquerImage(ctx, ex);
  state.ms = 16; image();
  state.ms = 5016;
  presque(image(), 0.05, 'le Math.min(dt, 0.05) du runtime');
});

test('js/viewport.js : la pause ne s\'accumule pas et ne ressort pas a la reprise', () => {
  // La pause elle-même est appliquée plus bas dans loop() (`inPause` conditionne anim.t,
  // les scripts, la physique). Ce que la migration pouvait casser, c'est l'horloge : si
  // update() cessait d'être appelé pendant ⏸, la première image de reprise vaudrait toute
  // la durée de la pause. On reproduit ici la consommation réelle : dt n'est intégré au
  // temps de jeu que hors pause.
  const { ctx, state } = bacAvecThree();
  const ex = extraireCadence('js/viewport.js');
  state.ms = 0;
  const image = fabriquerImage(ctx, ex);

  let tempsJeu = 0, dtReprise = null;
  for(let i = 1; i <= 70; i++){
    state.ms = i * 16;
    const dt = image();
    const inPause = (i >= 6 && i <= 65);           // ~1 s de pause
    if(!inPause) tempsJeu += dt;
    if(i === 66) dtReprise = dt;
  }
  presque(dtReprise, 0.016, 'première image après la pause (0,96 s signalerait une horloge gelée)');
  // image 1 = amorçage (0), images 2..5 et 66..70 = 9 images de 16 ms
  presque(tempsJeu, 9 * 0.016, 'temps de jeu accumulé : aucune seconde de pause ne doit y entrer');
});
