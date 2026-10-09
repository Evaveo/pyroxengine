// moteur/test/materiau-plugin.test.mjs
//
// Prise pour les shaders : Editor.registerMaterial({name, category, proprietes, fabriquer}).
//
// Ces tests ne vérifient pas qu'un nœud « est posé ». Un graphe construit et FAUX est
// indétectable sans GPU, et c'est précisément la panne qui a laissé le lissage s'apply à
// l'envers pendant toute la migration WebGPU. On ÉVALUE donc le graphe produit par le plugin
// d'exemple avec un faux TSL numérique, et on le compare à la formule de référence — même
// méthode que lissage-tsl.test.mjs.
//
// Le matériau construit est en revanche la VRAIE classe MeshStandardNodeMaterial du paquet
// three/webgpu, pas une doublure : c'est ce qui garantit que `fabriquer` produit un objet que
// le WebGPURenderer reconnaîtrait, et non un sac de propriétés qui y ressemble.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { creerContexte, deEsm } from './engine-env.mjs';

// Un objet fabriqué DANS le contexte vm porte l'Object.prototype de ce contexte, pas celui de
// l'hôte : assert/strict compare les prototypes et refuserait deux objets pourtant identiques.
// On les recopie côté hôte avant toute comparaison structurelle.
const rapatrier = (o) => JSON.parse(JSON.stringify(o));

const racineMoteur = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => deEsm(readFileSync(path.join(racineMoteur, f), 'utf8'));

const modWebgpu = await import(
  'file:///' + path.join(racineMoteur, 'vendor-esm/three.webgpu.min.js').replace(/\\/g, '/'));

// ---------- faux TSL : chaque nœud sait s'évaluer ----------
// `dot` rend directement le cosinus fourni par le cas de test : le terme géométrique est un
// primitif que rien ne peut évaluer hors GPU. Ce qu'on épingle ici, c'est TOUT ce que le
// plugin compose AUTOUR de lui — clamp, oneMinus, exposant, mélange avec le balayage.
const FAUX_TSL = `
  function __n(f){
    var o = {__n: true, ev: f};
    o.mul = function(x){ return __n(function(c){ return f(c) * __ev(x, c); }); };
    o.add = function(x){ return __n(function(c){ return f(c) + __ev(x, c); }); };
    o.sub = function(x){ return __n(function(c){ return f(c) - __ev(x, c); }); };
    o.sin = function(){ return __n(function(c){ return Math.sin(f(c)); }); };
    o.pow = function(x){ return __n(function(c){ return Math.pow(f(c), __ev(x, c)); }); };
    o.oneMinus = function(){ return __n(function(c){ return 1 - f(c); }); };
    o.clamp = function(a, b){
      return __n(function(c){ return Math.min(__ev(b, c), Math.max(__ev(a, c), f(c))); });
    };
    Object.defineProperty(o, 'y', {get: function(){ return __n(function(c){ return c.y; }); }});
    Object.defineProperty(o, 'g', {get: function(){ return __n(function(c){ return c.texelG; }); }});
    return o;
  }
  function __ev(x, c){ return (x && x.__n) ? x.ev(c) : x; }
  var TSL = {
    float: function(v){ return __n(function(){ return v; }); },
    // La tint est réduite à son canal ROUGE : un scalaire suffit à distinguer une couleur
    // correctement propagée d'une couleur perdue en route.
    color: function(hex){
      var r = parseInt(String(hex).slice(1, 3), 16) / 255;
      return __n(function(){ return r; });
    },
    texture: function(){ return __n(function(c){ return c.texelG; }); },
    positionLocal: __n(function(){ throw new Error('positionLocal lu sans canal'); }),
    time: __n(function(c){ return c.t; }),
    transformedNormalView: __n(function(){ return 0; }),
    positionViewDirection: __n(function(){ return 0; }),
    normalize: function(x){ return x; },
    dot: function(){ return __n(function(c){ return c.nDotV; }); }
  };
`;

// La formule de référence, écrite indépendamment du plugin.
function hologrammeAttendu(p, c){
  const scan = Math.sin(c.y * p.density - c.t * p.speed) * 0.5 + 0.5;
  const glow = scan * (1 - p.floor) + p.floor;
  const nDotV = Math.min(1, Math.max(0, c.nDotV));
  const edge = Math.pow(1 - nDotV, p.fresnel);
  let factor = glow + edge;
  if(c.withMask) factor *= (p.maskInverted ? 1 - c.texelG : c.texelG);
  const red = parseInt(p.tint.slice(1, 3), 16) / 255;
  return {
    factor: factor,
    opacity: Math.min(1, Math.max(0, factor * p.baseOpacity)),
    emissifR: red * p.intensity * factor
  };
}

// ---------- contexte : moteur + système de plugins ----------
function contexteAvecPlugins(options){
  const opt = options || {};
  const env = creerContexte(['js/material-props.js', 'js/assets.js', 'js/materials.js',
                             'js/model-import.js', 'js/import-settings.js', 'js/plugins.js']);
  // defMenus / addMenuDom vivent dans js/ui.js, que ces tests ne chargent pas : seul
  // registerCommandMenu les touche, et uniquement pour poser l'entrée de menu.
  vm.runInContext('var defMenus = []; function addMenuDom(){}', env);
  // La VRAIE classe du paquet webgpu, injectée dans le THREE du harnais (qui est le bundle
  // classique et ne la contient pas). Sans ça on ne testerait qu'une doublure.
  env.__NodeMaterialReel = modWebgpu.MeshStandardNodeMaterial;
  vm.runInContext(`
    THREE = new Proxy(THREE, {
      get: function(target, key){
        if(key === 'MeshStandardNodeMaterial') return __NodeMaterialReel;
        return target[key];
      }
    });
  `, env);
  if(!opt.sansTsl) vm.runInContext(FAUX_TSL, env);
  // `Editor` et `PROPS_MATERIAL` sont des `const` de premier level : elles rejoignent
  // l'environnement lexical du contexte (les scripts suivants les voient) mais ne deviennent
  // JAMAIS des propriétés de l'object global — seuls `function`/`var` le font. Sans ce pont,
  // env.Editor vaut undefined depuis le test, alors que le code du moteur, lui, y accède
  // très bien. Même mécanisme que NOMS_A_PONTER dans moteur-env.mjs.
  vm.runInContext('this.Editor = Editor; this.PROPS_MATERIAL = PROPS_MATERIAL;', env);
  return env;
}

function installerHologramme(env){
  env.runPlugin({name: 'hologramme', code: read('exemples/plugin-materiau-hologramme.js')});
  return env.Editor.materials.find((m) => m.name === 'Hologramme');
}

// ---------- 1. la prise existe et refuse ce qui ne tient pas ----------
test('registerMaterial exige name + fabriquer, et publie le materiau', () => {
  const env = contexteAvecPlugins();
  assert.throws(() => env.Editor.registerMaterial({name: 'X'}), /name.*make|make/,
    'un enregistrement sans fabriquer doit être refusé');
  env.Editor.registerMaterial({
    name: 'Test', category: 'Essai',
    properties: [{key: 'k', type:'number', label: 'K', min: 0, max: 1, defaultValue: 0.5}],
    make: function(){ return null; }
  });
  const def = env.Editor.materials.find((m) => m.name === 'Test');
  assert.ok(def, 'le matériau doit apparaître dans le registre');
  assert.equal(def.category, 'Essai');
  assert.deepEqual(rapatrier(def.defaults), {k: 0.5}, 'les défauts sont dérivés de la table');
  assert.equal(def.properties[0].id, 'ip-test-k', 'un id DOM doit être posé automatiquement');
  assert.ok(def.properties[0].id.startsWith('ip-'),
    'sans le préfixe ip-, le gestionnaire change de l\'inspecteur ignorerait le champ');
});

test('reenregistrer un materiau remplace sa definition sans empiler une entrée de menu', () => {
  // Mettre à jour un plugin sans recharger la page rejoue son code. Le registre se
  // dédoublonne par nom ; les menus, eux, s'empilent — d'où deux entrées identiques dont une
  // pointe sur l'ancienne définition.
  const env = contexteAvecPlugins();
  const def = {name: 'Rejoue', properties: [{key: 'k', type:'number', label: 'K', min: 0, max: 1}],
               make: function(){ return null; }};
  env.Editor.registerMaterial(def);
  env.Editor.registerMaterial(Object.assign({}, def, {category: 'Autre'}));

  assert.equal(env.Editor.materials.filter((m) => m.name === 'Rejoue').length, 1,
    'une seule définition doit survivre');
  assert.equal(env.Editor.materials[0].category, 'Autre', 'et c\'est la plus récente');
  const menu = vm.runInContext('defMenus.find(function(m){ return m.title === "Extensions"; })', env);
  assert.equal(menu.items.filter((i) => /Rejoue/.test(i.label)).length, 1,
    'une seule entrée de menu, sinon la première rappelle une définition morte');
});

test('le plugin d\'exemple s\'installe par le vrai filePath d\'exécution des plugins', () => {
  const env = contexteAvecPlugins();
  const def = installerHologramme(env);
  assert.ok(def, 'Hologramme doit être enregistré');
  assert.equal(def.plugin, 'hologramme', 'le matériau doit être attribué à son plugin');
  assert.equal(def.category, 'Sci-fi');
});

// ---------- 2. le graphe TSL calcule bien ce qu'il annonce ----------
test('le graphe TSL de l\'hologramme reproduit la formule de reference', () => {
  const env = contexteAvecPlugins();
  const def = installerHologramme(env);
  const p = Object.assign({}, def.defaults, {materialPlugin: 'Hologramme'});
  const m = env.makeMaterialPlugin(p);

  assert.ok(m, 'fabriquer doit rendre un matériau');
  assert.equal(m.type, 'MeshStandardNodeMaterial',
    'le rendu passe par le système de nœuds : un MeshStandardMaterial classique serait faux');
  assert.ok(m.opacityNode && m.emissiveNode && m.colorNode, 'les trois nœuds doivent être posés');

  const cas = [
    {y: 0,    t: 0,   nDotV: 1},
    {y: 0.5,  t: 1.3, nDotV: 0.2},
    {y: -2.1, t: 7.7, nDotV: 0},
    {y: 1.7,  t: 0.4, nDotV: 0.63},
    {y: 3.3,  t: 12,  nDotV: 1.4},    // hors [0,1] : le clamp du plugin doit mordre
    {y: -0.9, t: 5.1, nDotV: -0.3}
  ];
  cas.forEach((c) => {
    const att = hologrammeAttendu(p, c);
    const obtOpacite = m.opacityNode.ev(c);
    const obtEmissif = m.emissiveNode.ev(c);
    assert.ok(Math.abs(obtOpacite - att.opacity) < 1e-12,
      'opacité y=' + c.y + ' t=' + c.t + ' n·v=' + c.nDotV
      + ' → attendu ' + att.opacity + ', obtenu ' + obtOpacite);
    assert.ok(Math.abs(obtEmissif - att.emissifR) < 1e-12,
      'émissif y=' + c.y + ' t=' + c.t + ' n·v=' + c.nDotV
      + ' → attendu ' + att.emissifR + ', obtenu ' + obtEmissif);
  });
});

test('les curseurs de l\'inspecteur agissent VRAIMENT sur le graphe', () => {
  // Un graphe juste avec les valeurs par défaut mais sourd aux réglages serait invisible :
  // l'inspecteur bougerait, l'image non. On compare deux fabrications qui ne diffèrent que
  // par une propriété.
  const env = contexteAvecPlugins();
  const def = installerHologramme(env);
  const cas = {y: 0.42, t: 2.5, nDotV: 0.35};

  const base = Object.assign({}, def.defaults, {materialPlugin: 'Hologramme'});
  const autre = Object.assign({}, base, {density: 3, speed: 0.5, floor: 0.8,
                                         fresnel: 1.2, intensity: 5, baseOpacity: 0.3,
                                         tint: '#ff0000'});
  const mBase = env.makeMaterialPlugin(base);
  const mAutre = env.makeMaterialPlugin(autre);

  assert.ok(Math.abs(mBase.opacityNode.ev(cas) - mAutre.opacityNode.ev(cas)) > 1e-6,
    'changer les réglages doit changer le résultat');
  assert.ok(Math.abs(mAutre.opacityNode.ev(cas) - hologrammeAttendu(autre, cas).opacity) < 1e-12,
    'et le nouveau résultat doit être celui de la formule, pas n\'importe lequel');
  assert.ok(Math.abs(mAutre.emissiveNode.ev(cas) - hologrammeAttendu(autre, cas).emissifR) < 1e-12,
    'la tint doit se propager jusqu\'à l\'émission');
});

test('un emplacement de texture rempli passe par le resolveur du moteur', () => {
  const env = contexteAvecPlugins();
  const def = installerHologramme(env);
  // On observe l'appel réel à textureMaterial : c'est lui qui applique tuilage et paramètres
  // d'import, et un plugin qui le contournerait produirait un tuilage différent du natif.
  vm.runInContext(`
    globalThis.__texDemandees = [];
    textureMaterial = function(id){ globalThis.__texDemandees.push(id); return id ? {faux: true} : null; };
  `, env);

  const sans = Object.assign({}, def.defaults, {materialPlugin: 'Hologramme'});
  const avec = Object.assign({}, sans, {maskAsset: 'a42'});
  const cas = {y: 0.3, t: 1.1, nDotV: 0.5, texelG: 0.25};

  const mSans = env.makeMaterialPlugin(sans);
  const mAvec = env.makeMaterialPlugin(avec);
  assert.deepEqual(rapatrier(vm.runInContext('globalThis.__texDemandees.slice()', env)), [null, 'a42'],
    'l\'emplacement doit être résolu par textureMaterial, y compris quand il est vide');

  assert.ok(Math.abs(mSans.opacityNode.ev(cas)
    - hologrammeAttendu(sans, Object.assign({}, cas, {withMask: false})).opacity) < 1e-12);
  assert.ok(Math.abs(mAvec.opacityNode.ev(cas)
    - hologrammeAttendu(avec, Object.assign({}, cas, {withMask: true})).opacity) < 1e-12,
    'le mask doit multiplier le facteur');

  const inv = Object.assign({}, avec, {maskInverted: true});
  const mInv = env.makeMaterialPlugin(inv);
  assert.ok(Math.abs(mInv.opacityNode.ev(cas)
    - hologrammeAttendu(inv, Object.assign({}, cas, {withMask: true})).opacity) < 1e-12,
    'la case « inverser » doit inverser le canal, pas être ignorée');
});

// ---------- 3. l'inspecteur est la MÊME projection ----------
test('l\'inspecteur projette la table du plugin, pas la table native', () => {
  const env = contexteAvecPlugins();
  const def = installerHologramme(env);
  const a = {id: 'a1', kind: 'material', name: 'H', props: {materialPlugin: 'Hologramme'}};
  const html = env.sectionMaterialHtml(a);

  assert.match(html, /Densité de lignes/, 'les champs déclarés par le plugin doivent apparaître');
  assert.match(html, /Netteté du bord/);
  assert.match(html, /Hologramme/, 'l\'inspecteur doit nommer le matériau de plugin');
  assert.doesNotMatch(html, /Empaquetage/,
    'les champs du matériau natif ne doivent pas se mélanger à ceux du plugin');

  // La dépendance déclarative doit fonctionner à l'identique du natif : la case reste
  // VISIBLE mais inert tant que le mask n'est pas branché (ifMissing:'greyed').
  assert.match(html, /Inverser le mask/, 'un champ « grisé » reste affiché');

  const natif = env.sectionMaterialHtml({id: 'a2', kind: 'material', name: 'N', props: {}});
  assert.match(natif, /Empaquetage|Masque comb/, 'un matériau natif garde sa table');
  assert.doesNotMatch(natif, /Densité de lignes/);
});

test('la relecture du formulaire utilise la table qui l\'a produit', () => {
  // Relire un matériau de plugin avec la table native ne lève rien et ne trouve aucun champ :
  // chaque saisie serait perdue en silence. On écrit dans un faux DOM, puis on relit.
  const env = contexteAvecPlugins();
  const def = installerHologramme(env);
  const p = Object.assign({}, def.defaults, {materialPlugin: 'Hologramme'});

  vm.runInContext(`
    globalThis.__champs = {'ip-hologramme-density': '150', 'ip-hologramme-fresnel': '4',
                           'ip-hologramme-tint': '#ff8800'};
    document.getElementById = function(id){
      if(!(id in globalThis.__champs)) return null;
      return {value: globalThis.__champs[id], checked: false};
    };
    ipNum = function(id, def){ var e = document.getElementById(id);
                               return e ? parseFloat(e.value) : def; };
    ipText = function(id){ var e = document.getElementById(id); return e ? e.value : ''; };
  `, env);

  env.readPropsMaterialFromDom(p, env.tablePropsMaterial(p));
  assert.equal(p.density, 150, 'la densité saisie doit être relue');
  assert.equal(p.fresnel, 4);
  assert.equal(p.tint, '#ff8800');
  assert.equal(p.floor, def.defaults.floor,
    'un champ absent du DOM ne doit rien écraser');
});

test('le bornage declare s\'applique aux proprietes de plugin', () => {
  const env = contexteAvecPlugins();
  const def = installerHologramme(env);
  const table = def.properties;
  assert.equal(env.validatePropMaterial('density', 900, {}, table).ok, false,
    'au-dessus du max déclaré, la valeur doit être refusée');
  assert.equal(env.validatePropMaterial('density', 120, {}, table).ok, true);
  assert.equal(env.validatePropMaterial('tint', 'bleu', {}, table).ok, false);
  assert.equal(env.validatePropMaterial('smoothness', 0.5, {}, table).ok, false,
    'une propriété du natif n\'existe pas dans la table du plugin');
});

// ---------- 4. le copilote décrit le matériau de plugin ----------
test('le copilote recoit la table du plugin par la meme fonction que le natif', () => {
  const env = contexteAvecPlugins();
  installerHologramme(env);
  const desc = env.describeMaterialsPluginForAI();
  assert.equal(desc.length, 1);
  assert.equal(desc[0].material, 'Hologramme');

  const density = desc[0].properties.find((x) => x.property === 'density');
  assert.ok(density, 'chaque propriété déclarée doit être décrite');
  assert.equal(density.type, 'number');
  assert.equal(density.min, 1);
  assert.equal(density.max, 400);
  assert.ok(density.note, 'l\'aide de l\'inspecteur est aussi celle du modèle');

  const inverse = desc[0].properties.find((x) => x.property === 'maskInverted');
  assert.deepEqual(rapatrier(inverse.requires), ['maskAsset'],
    'les dépendances doivent être dites au modèle, pas seulement dessinées');
  assert.equal(inverse.ifMissing, 'sans effet');

  // Et la commande du copilote doit réellement appeler cette fonction.
  assert.match(read('js/copilot.js'), /describeMaterialsPluginForAI\(\)/,
    'describe_material doit inclure les matériaux de plugin');
});

// ---------- 5. les tables fautives sont refusées, en nommant la cause ----------
test('une table fautive est refusee AVANT d\'etre installee', () => {
  const env = contexteAvecPlugins();
  const refusal = (properties) => {
    try {
      env.Editor.registerMaterial({name: 'Mauvais', properties: properties,
                                       make: function(){ return null; }});
      return null;
    } catch(e){ return e.message; }
  };

  // Un type inconnu ne lève rien à l'exécution : renderPropsMaterial tombe au bout de sa
  // chaîne de `if` et rend un champ NUMÉRIQUE. Une couleur devient un curseur, en silence.
  assert.match(refusal([{key: 'c', type: 'couleurs', label: 'C'}]), /type .* inconnu/);
  assert.match(refusal([{key: 'a', type:'number', label: 'A'}, {key: 'a', type:'number', label: 'A2'}]),
    /deux fois/);
  assert.match(refusal([{key: 'c', type:'choice', label: 'C'}]), /options/);
  assert.match(refusal([{key: 'n', type:'number', label: 'N', min: 5, max: 1}]), /sup..?rieur/);
  assert.match(refusal([{key: 'n', type:'number', label: 'N', requires: ['jamais']}]),
    /aucune propri..?t..? de ce nom|inert/);
  // Même clé que le natif mais autre type : le même champ serait rendu de deux façons.
  assert.match(refusal([{key: 'smoothness', type: 'color', label: 'L'}]), /existe d..?j..? en natif/);
  assert.match(refusal([]), /tableau non vide/);

  assert.equal(env.Editor.materials.length, 0,
    'aucune de ces tables ne doit avoir laissé un matériau à moitié installé');

  // Contrôle : une table qui référence une clé NATIVE dans `requiert` est légitime.
  env.Editor.registerMaterial({
    name: 'Bon',
    properties: [{key: 'k', type:'number', label: 'K', min: 0, max: 1, requires: ['texAsset']}],
    make: function(){ return null; }
  });
  assert.equal(env.Editor.materials.length, 1);
});

// ---------- 6. les échecs de fabrication ne sont pas silencieux ----------
test('un fabriquer qui leve retombe sur le natif EN LE DISANT', () => {
  const env = contexteAvecPlugins();
  vm.runInContext(`globalThis.__journal = [];
    logConsole = function(n, m){ globalThis.__journal.push(n + '|' + m); };`, env);
  env.Editor.registerMaterial({
    name: 'Casse', properties: [{key: 'k', type:'number', label: 'K', min: 0, max: 1}],
    make: function(){ throw new Error('boum'); }
  });
  const a = {id: 'a9', kind: 'material', name: 'C', props: {materialPlugin: 'Casse'}};
  const m = env.makeMaterialThree(a);
  assert.equal(m.type, 'MeshStandardMaterial', 'on retombe sur le matériau natif');
  const journal = vm.runInContext('globalThis.__journal.slice()', env);
  assert.equal(journal.length, 1, 'exactement un message, pas un par image');
  assert.match(journal[0], /error\|.*Casse.*boum/);

  env.makeMaterialThree(a);
  assert.equal(vm.runInContext('globalThis.__journal.length', env), 1,
    'le message ne doit pas se répéter à chaque reconstruction du matériau');
});

test('un fabriquer qui rend autre chose qu\'un materiau est refuse, pas rendu', () => {
  const env = contexteAvecPlugins();
  vm.runInContext(`globalThis.__journal = [];
    logConsole = function(n, m){ globalThis.__journal.push(n + '|' + m); };`, env);
  env.Editor.registerMaterial({
    name: 'Vide', properties: [{key: 'k', type:'number', label: 'K', min: 0, max: 1}],
    make: function(){ return {emissiveNode: 1}; }   // object plausible, pas un matériau
  });
  const m = env.makeMaterialThree({id: 'a8', kind: 'material', name: 'V',
                                        props: {materialPlugin: 'Vide'}});
  assert.equal(m.type, 'MeshStandardMaterial');
  assert.match(vm.runInContext('globalThis.__journal[0]', env), /doit renvoyer un mat/);
});

test('sans TSL, le materiau de plugin renonce au lieu de rendre un objet muet', () => {
  const env = contexteAvecPlugins({sansTsl: true});
  vm.runInContext(`globalThis.__journal = [];
    logConsole = function(n, m){ globalThis.__journal.push(n + '|' + m); };`, env);
  installerHologramme(env);
  const m = env.makeMaterialThree({id: 'a7', kind: 'material', name: 'H',
                                        props: {materialPlugin: 'Hologramme'}});
  assert.equal(m.type, 'MeshStandardMaterial', 'le natif prend le relais');
  // Le journal contient aussi le « plugin chargé » d'runPlugin : c'est la présence d'un
  // message nommant TSL qui compte, pas sa position.
  const journal = rapatrier(vm.runInContext('globalThis.__journal.slice()', env));
  assert.ok(journal.some((l) => /TSL/.test(l)),
    'la cause doit être nommée — journal obtenu : ' + JSON.stringify(journal));
});

// ---------- 7. les deux pièges de plomberie ----------
test('la vignette n\'envoie JAMAIS un materiau a noeuds au renderer classique', () => {
  // Mesure du fait qui fonde la règle : le renderer WebGL classique choisit son programme
  // d'après material.type dans son ShaderLib, et le type d'un matériau à nœuds n'y est pas.
  const bacTrois = {window: {}, self: {}, console,
                    document: {createElement: () => ({getContext: () => null, style: {},
                                                      addEventListener(){}, width: 1, height: 1}),
                               createElementNS: () => ({})},
                    navigator: {userAgent: 'node'}};
  bacTrois.window = bacTrois; bacTrois.self = bacTrois; bacTrois.globalThis = bacTrois;
  const ctxTrois = vm.createContext(bacTrois);
  vm.runInContext(deEsm(readFileSync(path.join(racineMoteur, 'vendor/three.min.js'), 'utf8')), ctxTrois);
  const shaderLib = vm.runInContext('Object.keys(THREE.ShaderLib)', ctxTrois);
  const typeNode = new modWebgpu.MeshStandardNodeMaterial().type;
  assert.ok(!shaderLib.some((k) => k.toLowerCase() === typeNode.toLowerCase()),
    'si ShaderLib venait à contenir ' + typeNode + ', la vignette neutre n\'aurait plus lieu d\'être');

  // Et le code respecte la règle : on observe le matériau réellement envoyé à previewObject3D.
  const env = contexteAvecPlugins();
  const def = installerHologramme(env);
  vm.runInContext(`globalThis.__vus = [];
    previewObject3D = function(o){ globalThis.__vus.push(o.material.type); return 'data:,'; };`, env);

  env.previewMaterial({id: 'a1', kind: 'material', name: 'H', props: {materialPlugin: 'Hologramme'}});
  env.previewMaterial({id: 'a2', kind: 'material', name: 'N', props: {}});
  const vus = vm.runInContext('globalThis.__vus.slice()', env);
  assert.equal(vus[0], 'MeshStandardMaterial',
    'un matériau de plugin doit être prévisualisé par un remplaçant neutre');
  assert.equal(vus[1], 'MeshStandardMaterial', 'le natif est inchangé');
});

test('le runtime NOMME la divergence au lieu de la subir', () => {
  // Le lecteur autonome n'exécute aucun plugin : un matériau de plugin y est rendu par le
  // chemin natif. C'est la shape exacte de divergence éditeur/runtime qui a déjà coûté deux
  // jours au project. Elle reste — faute d'un medium d'embarquer le code du plugin dans un
  // build — mais elle doit être ANNONCÉE.
  // Contrôle de source et non d'exécution : game-runtime.js est le point d'entrée d'une page
  // autonome, et le charger ici ne prouverait rien de plus sur ce point précis.
  const src = read('js/game-runtime.js');
  const i = src.indexOf('function makeMaterialRuntime(');
  assert.notEqual(i, -1, 'makeMaterialRuntime doit exister');
  const body = src.slice(i, src.indexOf('\n}', i));
  assert.match(body, /p\.materialPlugin/,
    'le runtime doit reconnaître un matériau de plugin');
  assert.match(body, /console\.warn/,
    'et le signaler — un aspect différent sans un mot est précisément le bug à éviter');
});

// ---------- 8. la garde qui aurait attrapé le défaut trouvé en chemin ----------
test('tout symbole appele par l\'editeur est declare dans un fichier CHARGE par editor.html', () => {
  // js/material-props.js n'a jamais été ajouté à editor.html : sectionMaterialHtml appelle
  // renderPropsMaterial, qui n'existe pas à l'exécution. L'inspecteur de matériaux lève donc
  // un ReferenceError dans l'éditeur livré. Rien ne le voyait — le test qui couvrait cette
  // table était un test navigateur, parti avec Playwright.
  const html = read('editor.html');
  // La query `?v=` a QUITTÉ les balises de modules : elle donnait à chaque fichier DEUX URL —
  // `js/x.js?v=147` (la balise) et `js/x.js` (les `import` internes, qui n'en portent pas) —
  // donc deux entrées dans la module map du navigateur, donc DEUX exécutions de chaque module.
  // Elle reste sur les CSS, qui n'ont pas de graphe de modules. Voir editor.html.
  const chargesParBalise = [...html.matchAll(/<script[^>]*\ssrc="(js\/[A-Za-z0-9_\/-]+\.js)(?:\?[^"]*)?"/g)]
    .map((m) => m[1]);

  // Un fichier peut être atteignable SANS balise <script> propre : un `import` ES le charge
  // tout seul (voir editor.html — copilot-observer.js/copilot-workshop.js, retirés à dessein
  // pour ne plus être exécutés deux fois sous deux URL différentes). Cette garde ne regardait
  // que les balises, donc ignorait ce chemin de chargement réel — on referme la clôture.
  const lireBrut = (f) => readFileSync(path.join(racineMoteur, f), 'utf8');
  const importsDe = (rel) => [...lireBrut(rel).matchAll(/^import\s[^\n]*?from\s*'([^']+)';/gm)]
    .map((m) => path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1])));
  const charges = [...chargesParBalise];
  for(let i = 0; i < charges.length; i++){
    for(const cible of importsDe(charges[i])){
      if(charges.indexOf(cible) === -1) charges.push(cible);
    }
  }

  const tousLesJs = [];
  const marcher = (rel) => readdirSync(path.join(racineMoteur, rel), {withFileTypes: true})
    .forEach((e) => {
      if(e.isDirectory()) marcher(rel + '/' + e.name);
      else if(e.name.endsWith('.js')) tousLesJs.push(rel + '/' + e.name);
    });
  marcher('js');

  // Les commentaires ne s'exécutent pas : sans ça, « lue par updateInstances (js/render-perf.js) »
  // dans js/scripts.js compterait comme un appel.
  const sansCommentaires = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

  // Une MÉTHODE ABRÉGÉE (`set(key, value){` dans un littéral d'objet) est une définition, pas
  // un appel. Sans ça, `Prefs.set` de js/ui/prefs.js était compté comme un appel au `function
  // set()` de js/game-runtime.js — un fichier d'une AUTRE page, donc « non chargé ». Les
  // mots-clés sont exclus : `if(estPresent(x)){` a la même forme, et y raser la condition
  // masquerait un vrai appel.
  const MOTS_CLES = ['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'do'];
  const sansMethodesAbregees = (src) => src.replace(
    /^(\s*)(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^()]*\)\s*\{/gm,
    (tout, blanc, name) => (MOTS_CLES.indexOf(name) === -1 ? blanc + '{' : tout));

  const declarations = (src) => {
    const names = new Set();
    for(const m of src.matchAll(/^\s*function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) names.add(m[1]);
    return names;
  };

  const declaresParLesCharges = new Set();
  charges.forEach((f) => declarations(read(f)).forEach((n) => declaresParLesCharges.add(n)));

  const manques = [];
  tousLesJs.filter((f) => charges.indexOf(f) === -1).forEach((absent) => {
    const nomsAbsents = declarations(read(absent));
    charges.forEach((f) => {
      const src = sansMethodesAbregees(sansCommentaires(read(f)));
      nomsAbsents.forEach((name) => {
        if(declaresParLesCharges.has(name)) return;      // aussi défini par un fichier chargé
        // `typeof X === 'function'` est la façon dont ce dépôt déclare une dépendance
        // OPTIONNELLE (voir materials.js). Un appel ainsi gardé ne lève rien : c'est un
        // choix, pas un oubli.
        if(new RegExp('typeof\\s+' + name + '\\b').test(src)) return;
        if(!new RegExp('(?<![\\w$.])' + name + '\\s*\\(').test(src)) return;
        manques.push(f + ' appelle ' + name + '(), déclaré uniquement dans ' + absent);
      });
    });
  });

  assert.deepStrictEqual([...new Set(manques)], [],
    'Ces appels lèvent un ReferenceError dans l\'éditeur livré : le fichier qui les déclare '
    + 'n\'est chargé par AUCUNE balise <script> de editor.html, et aucun `typeof` ne les '
    + 'garde. Correctif (editor.html appartient à l\'intégrateur) : add '
    + '<script src="js/material-props.js?v=NN" defer></script> avant js/materials.js, et '
    + '<script src="js/help.js?v=NN" defer></script> avant js/ui.js.');
});

test('configure_material REFUSE une valeur hors plage au lieu de la ramener en douce', () => {
  // La commande écrit des propriétés que `describe_material` a décrites au modèle avec leurs
  // plages. Rien ne vérifiait ensuite qu'il les avait suivies : `lissage: 12` était ramené
  // dans l'intervalle par un Math.min, et le modèle repartait convaincu d'avoir obtenu 12.
  //
  // validatePropMaterial existait, était testée, et n'était appelée de nulle part — son propre
  // commentaire dit pourtant pourquoi elle existe : « refuser en expliquant vaut mieux
  // qu'accepter en silence ».
  // Sans les commentaires : ce test cite des bouts de code, et la prose qui les explique les
  // contient forcément. Une assertion qui matche l'explication au lieu de l'implémentation est
  // une garde incapable d'échouer — c'est arrivé ailleurs dans ce dépôt.
  const src = read('js/copilot.js').split('\n')
    .filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const start = src.indexOf("name: 'configure_material'");
  assert.ok(start > 0, 'la commande configure_material a disparu');
  const body = src.slice(start, start + 2600);

  assert.match(body, /validatePropMaterial\(/,
    'la commande écrit sans validate : le modèle n’apprend jamais les plages qu’on lui a '
    + 'pourtant enseignées');
  assert.match(body, /throw new Error\(refusal\.join/,
    'un refus doit remonter au modèle avec sa raison, pas être avalé');
  // TOUT OU RIEN : apply les champs valides d'un appel à moitié faux laisserait l'object
  // dans un état que le modèle ne connaît pas, et il enchaînerait dessus.
  assert.ok(body.indexOf('if(refusal.length) throw') < body.indexOf('pushHistory()'),
    'la validation doit précéder toute écriture, sinon un appel à moitié faux laisse l’object '
    + 'à moitié modifié');
  // Et le clampage silencieux doit avoir DISPARU, sinon les deux coexistent et le refus
  // n'arrive jamais.
  assert.doesNotMatch(body, /metalness = Math\.max\(0, Math\.min\(1/,
    'le clampage silencieux du métal survit à la validation : la valeur hors plage serait '
    + 'corrigée avant d’être refusée');
});
