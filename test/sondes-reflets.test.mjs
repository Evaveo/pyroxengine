// moteur/test/probes-reflets.test.mjs
//
// Deux comportements neufs des sondes, tous deux du genre à « marcher à l'eye » sans
// marcher du tout :
//
//   B1 — repli sur le ciel. Un objet qu'aucune sonde ne couvre recevait envMap = null,
//        donc AUCUN reflet. Le mesurer, c'est comparer la texture posée sur le matériau
//        avant/après, pas regarder si « c'est plus joli ».
//   B2 — projection boîte. Le vecteur de réflexion est corrigé dans le shader. Sans GPU,
//        la seule mesure honnête est d'évaluer NUMÉRIQUEMENT le graphe de noeuds et de le
//        confronter à une référence indépendante (intersection radius/boîte face par face).
//
// Aucun test ici ne se contente de constater qu'un noeud a été posé : le graphe est
// évalué, et la formule comparée à un oracle écrit autrement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { creerContexte, deEsm } from './engine-env.mjs';

const racineMoteur = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// Faux TSL : chaque noeud sait s'évaluer numériquement (scalaire ou triplet), pour que le
// graphe posé sur le matériau soit comparable chiffre à chiffre à la version JS. Même
// dispositif que lissage-tsl.test.mjs — un graphe bien construit mais faux serait sinon
// indétectable sans GPU.
// ---------------------------------------------------------------------------
const FAUX_TSL = `
  function __vec(x){ return Array.isArray(x) ? x : [x, x, x]; }
  function __ev(x, c){ return (x && x.__n) ? x.ev(c) : x; }
  function __bin(a, b, f){
    return __n(function(c){
      var va = __ev(a, c), vb = __ev(b, c);
      if(!Array.isArray(va) && !Array.isArray(vb)) return f(va, vb);
      var A = __vec(va), B = __vec(vb);
      return [f(A[0], B[0]), f(A[1], B[1]), f(A[2], B[2])];
    });
  }
  function __n(f){
    var o = {__n: true, ev: f};
    o.sub = function(x){ return __bin(o, x, function(a, b){ return a - b; }); };
    o.add = function(x){ return __bin(o, x, function(a, b){ return a + b; }); };
    o.mul = function(x){ return __bin(o, x, function(a, b){ return a * b; }); };
    o.div = function(x){ return __bin(o, x, function(a, b){ return a / b; }); };
    o.max = function(x){ return __bin(o, x, Math.max); };
    o.min = function(x){ return __bin(o, x, Math.min); };
    o.normalize = function(){
      return __n(function(c){
        var v = __vec(f(c));
        var l = Math.hypot(v[0], v[1], v[2]);
        return [v[0]/l, v[1]/l, v[2]/l];
      });
    };
    // reflect(I, N) de GLSL : I - 2 * dot(N, I) * N
    o.reflect = function(nn){
      return __n(function(c){
        var I = __vec(f(c)), N = __vec(__ev(nn, c));
        var d = I[0]*N[0] + I[1]*N[1] + I[2]*N[2];
        return [I[0] - 2*d*N[0], I[1] - 2*d*N[1], I[2] - 2*d*N[2]];
      });
    };
    ['x', 'y', 'z'].forEach(function(name, i){
      Object.defineProperty(o, name, {get: function(){
        return __n(function(c){ return __vec(f(c))[i]; });
      }});
    });
    return o;
  }
  var TSL = {
    positionWorld:          __n(function(c){ return c.pos; }),
    cameraPosition:         __n(function(c){ return c.cam; }),
    transformedNormalWorld: __n(function(c){ return c.normal; }),
    uniform: function(v){
      var u = __n(function(){ return [u.value.x, u.value.y, u.value.z]; });
      u.value = v;
      return u;
    },
    // three place exactement ce noeud-là sous EnvironmentNode pour une envMap : on ne
    // remplace que son vecteur d'échantillonnage.
    pmremTexture: function(tex, uvNode){
      return {__pmrem: true, isTextureNode: false, value: tex, uvNode: uvNode};
    }
  };
`;

// ---------------------------------------------------------------------------
// Contexte : environment.js + probes.js, avec le strict minimum autour.
// THREE.CubeCamera est remplacé par un mouchard — il n'y a pas de GPU ici, et ce qu'on
// veut savoir est justement QUELLE scène part à la cuisson.
// ---------------------------------------------------------------------------
function chargerMoteurSondes(){
  const env = creerContexte([]);
  vm.runInContext(`
    var LAYER_HELPERS = 31;
    var scene = new THREE.Scene();
    var hemi = {intensity: 0, color: {set: function(){}}};
    var sun = {intensity: 0};
    var selection = null;
    var assets = [];
    var renderer = {__ready: true, isWebGPURenderer: true};
    function applyNodeMixin(o){ o.addComponent = function(){}; }
    function buildInspector(){}
    function setStatus(){}
    function ed(o){ if(!o.ed) o.ed = {}; return o.ed; }
    function listMats(x){
      return Array.isArray(x.material) ? x.material : (x.material ? [x.material] : []);
    }
    globalThis.__cuissons = [];
    globalThis.__reprises = 0;
    THREE = new Proxy(THREE, {
      get: function(target, p){
        if(p === 'CubeCamera'){
          // Mouchard : pas de GPU ici, et ce qu'on veut savoir est justement QUELLE scène
          // part à la cuisson. layers/traverse sont là parce que bakeProbe() pose un
          // masque de calques dessus (une CubeCamera réelle a six sous-caméras).
          return function(near, far, rt){
            const faux = this;
            faux.position = new target.Vector3();
            faux.layers = new target.Layers();
            faux.traverse = function(fn){ fn(faux); };
            faux.update = function(rendu, sc){
              globalThis.__cuissons.push({rt: rt, scene: sc, res: rt.width});
            };
          };
        }
        return target[p];
      }
    });
  `, env);
  ['js/component-data.js', 'js/environment.js', 'js/probes.js'].forEach((f) => {
    vm.runInContext(deEsm(readFileSync(path.join(racineMoteur, f), 'utf8')), env, {filename: f});
  });
  // les const/let de haut niveau d'un script vm ne deviennent pas des propriétés du global
  vm.runInContext(`
    this.applyEnvironment = applyEnvironment;
    this.buildSkyBackground = buildSkyBackground;
    this.applyProbes = applyProbes;
    this.makeProbe = makeProbe;
    this.bakeProbe = bakeProbe;
    this.ensureProbe = ensureProbe;
    this.fixReflectionBox = fixReflectionBox;
    this.engineProbes = engineProbes;
    this.ENV_DEFAULT = ENV_DEFAULT;
    this.PROBE_DEFAULT = PROBE_DEFAULT;
    this.lireEnv = function(){ return env; };
    this.poserRenderer = function(r){ renderer = r; };
    this.poserSelection = function(o){ selection = o; };
  `, env);
  return env;
}

// Maillage métallique enregistré dans `objects`, comme en fait objects.js
function ajouterMetal(env, x, y, z){
  const m = new env.THREE.Mesh(
    new env.THREE.SphereGeometry(1, 8, 6),
    new env.THREE.MeshStandardMaterial({metalness: 1, roughness: 0.05}));
  m.userData.type = 'mesh';
  m.position.set(x || 0, y || 0, z || 0);
  m.updateMatrixWorld(true);
  env.objects.push(m);
  return m;
}

// Les tableaux/objets rendus par le contexte vm viennent d'un AUTRE realm : deepEqual y
// compare aussi des prototypes qui ne sont pas les mêmes. On compare terme à terme.
function memeTriplet(obtenu, attendu, tolerance, message){
  [0, 1, 2].forEach((i) => {
    assert.ok(Math.abs(obtenu[i] - attendu[i]) <= (tolerance || 0),
      message + ' — axe ' + i + ' : attendu ' + attendu[i] + ', obtenu ' + obtenu[i]);
  });
}

function ajouterSonde(env, x, y, z, settings){
  const s = env.makeProbe();
  s.position.set(x || 0, y || 0, z || 0);
  s.updateMatrixWorld(true);
  Object.assign(s.userData.probe, settings || {});
  env.objects.push(s);
  return s;
}

// =========================================================================
// B1 — le ciel comme sonde par défaut
// =========================================================================

test('B1 : sans aucune sonde, un metal recoit le ciel — avant, il ne recevait RIEN', () => {
  const env = chargerMoteurSondes();
  env.applyEnvironment({sky: 'color', skyColor: '#3366ff'});
  const metal = ajouterMetal(env);

  // état de référence : ce que faisait le moteur avant ce lot
  assert.equal(metal.material.envMap, null, 'point de départ : aucune envMap');
  const versionAvant = metal.material.version;

  env.applyProbes();

  assert.notEqual(metal.material.envMap, null,
    'un objet hors de toute sonde doit désormais refléter le ciel');
  assert.equal(metal.material.envMap, env.engineProbes.sky.rt.texture,
    'et c\'est bien le cubemap du ciel, pas une texture quelconque');
  // `needsUpdate` n'a PAS de getter sur materiau (three ne définit qu'un setter qui
  // incrémente `version`) : le lire renverrait undefined et la sonde ne distinguerait
  // rien. On mesure donc la version, la seule trace observable.
  assert.equal(metal.material.version, versionAvant + 1,
    'sans l\'invalidation, three garderait le programme déjà compilé : pas de reflet');

  // idempotence : repasser ne doit pas réinvalider (une invalidation par frame ferait
  // recompiler le pipeline en boucle)
  env.applyProbes();
  assert.equal(metal.material.version, versionAvant + 1,
    'une seconde passe sans changement ne doit rien invalider');
});

test('B1 : ce qui part a la cuisson, c\'est le CIEL SEUL, jamais le decor', () => {
  const env = chargerMoteurSondes();
  env.applyEnvironment({sky: 'color', skyColor: '#3366ff'});
  const metal = ajouterMetal(env, 5, 0, 0);
  env.applyProbes();

  const cuissons = env.__cuissons;
  assert.equal(cuissons.length, 1, 'une seule cuisson de ciel');
  const sc = cuissons[0].scene;
  assert.notEqual(sc, env.scene, 'la scène de cuisson est jetable, pas la scène du project');
  assert.equal(sc.children.length, 0, 'ciel de couleur unie : aucun dôme, et surtout aucun objet');
  assert.equal(sc.background.getHexString(), '3366ff', 'le fond porte la couleur du ciel');
  assert.equal(sc.children.indexOf(metal), -1, 'le décor ne doit jamais se retrouver dans le ciel');
});

test('B1 : une sonde qui couvre l\'object prime sur le ciel, hors rayon on y retombe', () => {
  const env = chargerMoteurSondes();
  env.applyEnvironment({sky: 'color', skyColor: '#3366ff'});
  const near = ajouterMetal(env, 1, 0, 0);
  const loin = ajouterMetal(env, 90, 0, 0);
  const probe = ajouterSonde(env, 0, 0, 0, {radius: 5, intensity: 2});
  env.bakeProbe(probe);
  env.applyProbes();

  const cuite = env.engineProbes.cuites.get(probe);
  assert.equal(near.material.envMap, cuite.rt.texture, 'dans le rayon : le cubemap de la sonde');
  assert.equal(near.material.envMapIntensity, 2, 'et l\'intensité de la sonde');
  assert.equal(loin.material.envMap, env.engineProbes.sky.rt.texture,
    'hors rayon : le ciel, pas null — c\'est tout l\'objet du repli');
  assert.equal(loin.material.envMapIntensity, 1, 'et l\'intensité de ciel de la scène');
});

test('B1 : skyReflets = false rend EXACTEMENT l\'ancien comportement', () => {
  const env = chargerMoteurSondes();
  env.applyEnvironment({sky: 'color', skyColor: '#3366ff', skyReflets: false});
  const metal = ajouterMetal(env);
  env.applyProbes();

  assert.equal(metal.material.envMap, null, 'repli coupé : plus aucune envMap');
  assert.equal(env.__cuissons.length, 0, 'et surtout aucun rendu de cuisson gaspillé');
});

test('B1 : le ciel n\'est recuit QUE si son apparence change', () => {
  const env = chargerMoteurSondes();
  env.applyEnvironment({sky: 'gradient', skyTop: '#4488ff', skyBottom: '#221100'});
  ajouterMetal(env);
  env.applyProbes();
  assert.equal(env.__cuissons.length, 1);

  // applyEnvironment() est rappelé au moindre curseur de brouillard : recuire à
  // chaque fois coûterait 6 rendus par frappe.
  const e = env.lireEnv();
  e.brouillardNear = 12;
  env.applyEnvironment();
  assert.equal(env.__cuissons.length, 1, 'un réglage sans effet sur le ciel ne recuit rien');

  e.skyTop = '#ff0000';
  env.applyEnvironment();
  assert.equal(env.__cuissons.length, 2, 'changer le ciel, si');
});

test('B1 : le degrade cuit porte bien les couleurs reglees — mesure au pixel', () => {
  const env = chargerMoteurSondes();
  env.applyEnvironment({sky: 'gradient', skyTop: '#4080c0', skyBottom: '#201008'});
  const metal = ajouterMetal(env);
  env.applyProbes();

  // Boucle fermée : la cible dont on mesure les pixels est bien CELLE que le métal reçoit.
  // Sans ce maillon, on mesurerait un dégradé qui n'arrive nulle part.
  assert.equal(metal.material.envMap, env.__cuissons[0].rt.texture,
    'le métal reflète la cible cuite ici même');
  const sc = env.__cuissons[0].scene;
  // Le ciel n'est plus un dôme dans la scène : c'est le FOND de la caméra.
  assert.equal(sc.children.length, 0, 'aucun objet de ciel : le ciel est le fond');
  assert.ok(sc.background && sc.background.isTexture, 'le fond est la texture de dégradé');
  const buf = sc.background.image._buf;                 // canvas 16 x 256 du dégradé
  const px = (y) => [buf[y * 16 * 4], buf[y * 16 * 4 + 1], buf[y * 16 * 4 + 2]];

  memeTriplet(px(0), [0x40, 0x80, 0xc0], 0, 'haut du dégradé = skyTop');
  // dernière LIGNE, pas dernier point du dégradé : elle est à 255/256 de la course, donc
  // à un point près de skyBottom. Exiger l'égalité stricte mesurerait l'arrondi, pas le ciel.
  memeTriplet(px(255), [0x20, 0x10, 0x08], 2, 'bottom du dégradé = skyBottom');
  // le milieu doit être entre les deux : un dégradé plat passerait les deux bounds
  const mid = px(128);
  assert.ok(mid[0] > 0x20 && mid[0] < 0x40, 'le milieu interpole vraiment (rouge ' + mid[0] + ')');
});

test('B1 : les aides d\'edit ne recoivent pas de reflet', () => {
  const env = chargerMoteurSondes();
  env.applyEnvironment({sky: 'color', skyColor: '#3366ff'});
  const metal = ajouterMetal(env);
  const help = new env.THREE.Mesh(new env.THREE.BoxGeometry(1, 1, 1),
    new env.THREE.MeshBasicMaterial({wireframe: true}));
  help.layers.set(31);            // LAYER_HELPERS
  metal.add(help);
  metal.updateMatrixWorld(true);

  env.applyProbes();

  assert.notEqual(metal.material.envMap, null, 'l\'object, lui, reflète');
  assert.equal(help.material.envMap, null,
    'le filaire d\'aide n\'avait jamais de reflet : le repli sur le ciel ne doit pas lui en donner un');
});

test('B1 : backend pas encore initialise -> pas de cuisson forcee, mais une reprise', () => {
  const env = chargerMoteurSondes();
  env.poserRenderer({__ready: false});
  // WebGPURenderer.init() est asynchrone : au démarrage, applyEnvironment() pass
  // avant lui. Sans reprise, le ciel ne serait JAMAIS cuit — et sans erreur.
  vm.runInContext('setTimeout = function(){ globalThis.__reprises++; };', env);
  env.applyEnvironment({sky: 'color', skyColor: '#3366ff'});
  const metal = ajouterMetal(env);

  env.applyProbes();          // ne doit pas lever

  assert.equal(env.__cuissons.length, 0, 'on ne cuit pas sur un backend absent');
  assert.equal(metal.material.envMap, null, 'et on ne pose pas une texture qui n\'existe pas');
  assert.ok(env.__reprises >= 1, 'une reprise doit être programmée, sinon le ciel n\'arrive jamais');
});

// =========================================================================
// B2 — projection boîte
// =========================================================================

// ORACLE INDÉPENDANT : au lieu de la formule des tranches (max/min sur les trois axes),
// on essaie les 6 faces une par une et on garde celle qui est réellement percée. Deux
// écritures différentes de la même géométrie — si elles s'accordent, ce n'est pas un
// hasard d'algèbre.
function sortieDeBoiteParFaces(pos, dir, center, half){
  let meilleur = null;
  for(let axe = 0; axe < 3; axe++){
    for(const signe of [-1, 1]){
      if(dir[axe] === 0) continue;
      const plan = center[axe] + signe * half[axe];
      const t = (plan - pos[axe]) / dir[axe];
      if(t <= 0) continue;
      const p = [pos[0] + dir[0] * t, pos[1] + dir[1] * t, pos[2] + dir[2] * t];
      let dedans = true;
      for(let k = 0; k < 3; k++){
        if(k === axe) continue;
        if(Math.abs(p[k] - center[k]) > half[k] + 1e-9) dedans = false;
      }
      if(dedans && (meilleur === null || t < meilleur.t)) meilleur = {t: t, p: p};
    }
  }
  return meilleur;
}

function normaliser(v){
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

test('B2 : la correction tombe sur le mur, verifiee face par face', () => {
  const env = chargerMoteurSondes();
  const center = [1, 2, -3], half = [5, 2.5, 4], probe = [0.5, 1, -2];
  const cas = [
    {pos: [1, 2, -3],    dir: [1, 0, 0]},
    {pos: [0, 1, -2],    dir: [0, 1, 0]},
    {pos: [-2, 0.5, -5], dir: [0.3, 0.9, -0.4]},
    {pos: [3, 3, -1],    dir: [-0.7, -0.2, 0.6]},
    {pos: [1, 2, -3],    dir: [-1, -1, -1]},
    {pos: [5, 1, -6],    dir: [0.1, 0.02, 0.99]}
  ];
  cas.forEach((c) => {
    const dir = normaliser(c.dir);
    const attendu = sortieDeBoiteParFaces(c.pos, dir, center, half);
    assert.ok(attendu, 'le cas de test doit vraiment percer la boîte');
    const obtenu = env.fixReflectionBox(c.pos, dir, center, half, probe);
    const aims = [attendu.p[0] - probe[0], attendu.p[1] - probe[1], attendu.p[2] - probe[2]];
    [0, 1, 2].forEach((i) => {
      assert.ok(Math.abs(obtenu[i] - aims[i]) < 1e-9,
        'dir=' + JSON.stringify(c.dir) + ' axe ' + i + ' : attendu ' + aims[i] + ', obtenu ' + obtenu[i]);
    });
  });
});

test('B2 : sans correction, la direction serait tout autre — la box change vraiment quelque chose', () => {
  const env = chargerMoteurSondes();
  // probe décalée du fragment : c'est précisément le cas où un cubemap « à l'infini »
  // se trompe de mur, et où la projection boîte gagne son existence.
  const pos = [-4, 0.5, -5], dir = normaliser([0.3, 0.9, -0.4]);
  const corrige = normaliser(env.fixReflectionBox(pos, dir, [1, 2, -3], [5, 2.5, 4], [4, 1, 1]));
  const angle = Math.acos(Math.max(-1, Math.min(1,
    corrige[0] * dir[0] + corrige[1] * dir[1] + corrige[2] * dir[2]))) * 180 / Math.PI;
  assert.ok(angle > 10,
    'la direction corrigée doit s\'écarter nettement de la brute (écart mesuré : '
    + angle.toFixed(1) + '°) — sinon la fonctionnalité ne fait rien de visible');
});

test('B2 : un radius parallele a un axe ne casse pas la formule', () => {
  const env = chargerMoteurSondes();
  // dir.x = 0 : la division donne ±Infini, et max/min doivent l'écarter sans NaN
  const r = env.fixReflectionBox([0, 0, 0], [0, 1, 0], [0, 0, 0], [3, 2, 3], [0, 0, 0]);
  memeTriplet(r, [0, 2, 0], 0, 'le radius vertical sort par le plafond, à 2 m');
  [0, 1, 2].forEach((i) => assert.ok(Number.isFinite(r[i]),
    'aucune composante ne doit être NaN ou infinie (axe ' + i + ' = ' + r[i] + ')'));
});

test('B2 : le graphe de nœuds calcule EXACTEMENT la formule JS', () => {
  const env = chargerMoteurSondes();
  vm.runInContext(FAUX_TSL, env);
  env.applyEnvironment({sky: 'color', skyColor: '#000000', skyReflets: false});
  const metal = ajouterMetal(env, 1, 0, 0);
  // AUCUNE coordonnée de la sonde ni du décalage n'est nulle : un contrôle a montré
  // qu'une sonde en z = 0 rendait le test aveugle au signe du terme z (une faute de signe
  // volontaire y passait inaperçue).
  const probe = ajouterSonde(env, -1, 1, 3,
    {radius: 30, box: true, boxSize: [10, 5, 8], boxOffset: [0.5, -1, 2]});
  env.bakeProbe(probe);
  env.applyProbes();

  const node = metal.material.envNode;
  assert.ok(node && node.__pmrem, 'un pmremTexture doit porter le reflet : c\'est ce que '
    + 'three place lui-même sous EnvironmentNode, on n\'en remplace que le vecteur');
  assert.equal(node.value, env.engineProbes.cuites.get(probe).rt.texture,
    'et il échantillonne bien le cubemap de la sonde');
  assert.ok(node.uvNode, 'sans uvNode explicite, three reprendrait son vecteur non corrigé');

  // uniformes : centre = probe + décalage, demi = size / 2
  const posProbe = [-1, 1, 3];
  const center = [-0.5, 0, 5];
  const half = [5, 2.5, 4];

  const cas = [
    {pos: [1, 0, 0],     cam: [6, 3, 6],   normal: [0, 1, 0]},
    {pos: [-3, 0.2, 1],  cam: [0, 8, -4],  normal: normaliser([1, 1, 0])},
    {pos: [2, -1, 3],    cam: [-5, 2, 2],  normal: normaliser([0.2, 0.7, -0.5])},
    {pos: [0, 0, 0],     cam: [0, 10, 0],  normal: [0, 1, 0]}
  ];
  cas.forEach((c) => {
    const obtenu = node.uvNode.ev(c);
    // même vecteur incident que le noeud : du point de vue vers le fragment
    const incident = normaliser([c.pos[0] - c.cam[0], c.pos[1] - c.cam[1], c.pos[2] - c.cam[2]]);
    const d = incident[0] * c.normal[0] + incident[1] * c.normal[1] + incident[2] * c.normal[2];
    const reflechi = [incident[0] - 2 * d * c.normal[0],
                      incident[1] - 2 * d * c.normal[1],
                      incident[2] - 2 * d * c.normal[2]];
    const attendu = env.fixReflectionBox(c.pos, reflechi, center, half, posProbe);
    [0, 1, 2].forEach((i) => {
      assert.ok(Math.abs(obtenu[i] - attendu[i]) < 1e-9,
        'pos=' + JSON.stringify(c.pos) + ' axe ' + i + ' : le graphe donne ' + obtenu[i]
        + ', la formule ' + attendu[i]);
    });
  });
});

test('B2 : les uniformes suivent la sonde, pas la position de cuisson', () => {
  const env = chargerMoteurSondes();
  vm.runInContext(FAUX_TSL, env);
  env.applyEnvironment({sky: 'color', skyReflets: false});
  ajouterMetal(env, 1, 0, 0);
  const probe = ajouterSonde(env, 0, 1, 0,
    {radius: 30, box: true, boxSize: [10, 5, 8], boxOffset: [0.5, -1, 2]});
  env.bakeProbe(probe);
  env.applyProbes();

  const c = env.engineProbes.cuites.get(probe);
  memeTriplet([c.uni.center.value.x, c.uni.center.value.y, c.uni.center.value.z],
    [0.5, 0, 2], 0, 'centre = position de la sonde + décalage');
  memeTriplet([c.uni.half.value.x, c.uni.half.value.y, c.uni.half.value.z],
    [5, 2.5, 4], 0, 'demi-dimensions = size / 2');

  // la sonde bouge : sans rafraîchissement, le reflet resterait collé à l'ancienne pièce
  probe.position.set(10, 1, 0);
  probe.updateMatrixWorld(true);
  env.applyProbes();
  assert.equal(c.uni.probe.value.x, 10, 'la position de la sonde suit');
  assert.equal(c.uni.center.value.x, 10.5, 'le centre de la boîte aussi');
});

test('B2 : sans projection boîte, aucun envNode — three garde son chemin normal', () => {
  const env = chargerMoteurSondes();
  vm.runInContext(FAUX_TSL, env);
  env.applyEnvironment({sky: 'color', skyReflets: false});
  const metal = ajouterMetal(env, 1, 0, 0);
  const probe = ajouterSonde(env, 0, 0, 0, {radius: 30, box: false});
  env.bakeProbe(probe);
  env.applyProbes();
  assert.ok(!metal.material.envNode, 'pas de boîte : pas de nœud, three fait son PMREM habituel');

  // et l'inverse : décocher la boîte doit RETIRER le noeud, pas le laisser traîner
  env.ensureProbe(probe).box = true;
  env.applyProbes();
  assert.ok(metal.material.envNode, 'cochée : le nœud arrive');
  env.ensureProbe(probe).box = false;
  env.applyProbes();
  assert.equal(metal.material.envNode, null, 'décochée : le noeud repart, sinon le reflet reste faux');
});

// =========================================================================
// Projets existants et miroir runtime
// =========================================================================

test('un project enregistre avant ce lot recupere les defauts sans perdre ses reglages', () => {
  const env = chargerMoteurSondes();
  const o = {userData: {type: 'probe', probe: {radius: 42, resolution: 256, intensity: 0.5, auto: false}}};
  const s = env.ensureProbe(o);

  assert.equal(s.radius, 42, 'les réglages enregistrés sont intouchés');
  assert.equal(s.auto, false, 'y compris un booléen à false');
  assert.equal(s.box, false, 'les champs neufs prennent leur défaut');
  memeTriplet(s.boxSize, env.PROBE_DEFAULT.boxSize, 0, 'taille de boîte par défaut');
  // et le défaut doit être une COPIE : deux sondes ne partagent pas le même tableau
  const autre = env.ensureProbe({userData: {type: 'probe'}});
  autre.boxSize[0] = 999;
  assert.notEqual(s.boxSize[0], 999, 'les tableaux par défaut ne doivent pas être partagés');
});

test('un env enregistre sans skyReflets active le repli (pas de migration necessaire)', () => {
  const env = chargerMoteurSondes();
  env.applyEnvironment({sky: 'color', skyColor: '#112233'});   // schéma d'avant
  const e = env.lireEnv();
  assert.equal(e.skyReflets, true, 'applyEnvironment fusionne avec ENV_DEFAULT');
  assert.equal(e.skyRefletsIntensity, 1);
});

test('le miroir runtime porte la MEME correction de box, mot pour mot', () => {
  const read = (f) => readFileSync(path.join(racineMoteur, f), 'utf8');
  // on compare les CORPS, aux noms près : seule la formule doit être identique
  const extraire = (src, name) => {
    const i = src.indexOf('function ' + name + '(');
    assert.notEqual(i, -1, name + ' doit exister');
    const block = src.slice(i, src.indexOf('\n}', i));
    return block.slice(block.indexOf('{') + 1).replace(/\s+/g, ' ').trim();
  };
  assert.equal(
    extraire(read('js/game-runtime.js'), 'rtNodeDirectionBox'),
    extraire(read('js/probes.js'), 'nodeDirectionBox'),
    'la correction du runtime a divergé de celle de l\'éditeur : le build ne rendrait plus '
    + 'comme la vue de lecture');
});

test('le runtime cuit lui aussi le ciel, et attend son backend', () => {
  const src = readFileSync(path.join(racineMoteur, 'js/game-runtime.js'), 'utf8');
  // Le jeu publié et le mode Lecture partagent CE fichier : si le repli n'y est pas, un
  // build ne montre pas les mêmes reflets que l'éditeur, et personne ne s'en aperçoit.
  assert.match(src, /function rtBakeSky\(/, 'le runtime doit cuire le ciel');
  assert.match(src, /rtBakeSky\(rtEnvCurrent\)/, 'et s\'en servir dans la distribution');
  const body = src.slice(src.indexOf('function rtBakeProbes('),
                          src.indexOf('\n}', src.indexOf('function rtBakeProbes(')));
  assert.match(body, /renderer\.__ready/,
    'la cuisson doit attendre WebGPURenderer.init(), sinon les reflets manquent en silence');
  assert.match(body, /setTimeout\(rtBakeProbes/, 'et se reprogrammer, pas abandonner');
  assert.ok(src.indexOf('RT_SKY_RESOLUTION = 64') !== -1,
    'même résolution de ciel que l\'éditeur, sinon les deux rendus diffèrent');
});

test('reconstruire un materiau ne lui fait pas perdre ses reflets', () => {
  // Défaut trouvé à la mesure, en vérifiant qu'une cuisson de lightmap rendait la scène
  // intacte : elle la rendait SANS reflets. La cause n'était pas la cuisson —
  // `applyMaterialEverywhere()` seul, sans rien d'autre, suffisait à faire passer toute la
  // scène de « envMap posée » à « envMap nulle ». Donc la moindre modification de matériau
  // depuis l'inspecteur perdait les reflets, jusqu'au prochain évènement qui recalcule les
  // probes — souvent une réouverture de project, ce qui sépare la cause de l'effet par une
  // sauvegarde. Le même rappel existait déjà pour la bascule éclairé/non-éclairé.
  const src = readFileSync(path.join(racineMoteur, 'js/materials.js'), 'utf8');
  const start = src.indexOf('function applyMaterialEverywhere(');
  assert.ok(start > 0, 'applyMaterialEverywhere a disparu');
  const body = src.slice(start, src.indexOf('\n}', start));
  assert.match(body, /applyProbes\(\)/,
    'applyMaterialOn() RECONSTRUIT les matériaux : sans rappel des sondes ici, toute '
    + 'modification de matériau laisse la scène sans reflets');
});
