// moteur/test/ciel-hdri.test.mjs
//
// LE CIEL HDRI ET LA CLÉ DE PIPELINE DES REFLETS (js/environment-map.js).
//
// Deux sujets, un seul module, parce qu'ils se rejoignent : une HDRI sert de ciel ET de reflet, et
// le reflet ne se voyait pas — « la cuisson des sondes ne fonctionne pas ».
//
//   1. La clé de pipeline. Sous WebGPURenderer (three r185), un matériau compilé avec une envMap
//      garde le PMREM de CETTE texture tant que sa clé de cache ne change pas, et la clé ne voit
//      d'une texture que son genre (mapping, filtres). Le cube d'une sonde et celui du ciel ont le
//      même genre : la sonde était cuite et jamais vue. Ici : la clé change quand l'environnement
//      change, elle garde la clé d'origine, et la règle de three qui rend tout cela nécessaire est
//      relue dans le bundle vendorisé — si three la change, ce test le dira.
//   2. La lecture d'une HDRI : un VRAI fichier .hdr (RGBE) est fabriqué ici, lu par le HDRLoader de
//      vendor/three-addons.min.js, et ses valeurs comparées à la formule RGBE — au-delà de 1, ce
//      qu'aucune image 8 bits ne porte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { creerContexte } from './engine-env.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');

function contexte(){
  const ctx = creerContexte([]);   // js/environment-map.js est un socle du harnais
  vm.runInContext(read('vendor/three-addons.min.js'), ctx, {filename: 'vendor/three-addons.min.js'});
  vm.runInContext(`
    this.bindEnvironmentKey = bindEnvironmentKey;
    this.environmentKeyOf = environmentKeyOf;
    this.acceptsEnvironment = acceptsEnvironment;
    this.textureFromHdr = textureFromHdr;
    this.isHdrTexture = isHdrTexture;
    this.isHdrFileName = isHdrFileName;
    this.hdrPreviewPixels = hdrPreviewPixels;
    this.skyBackgroundFor = skyBackgroundFor;
    this.applySkyFraming = applySkyFraming;
    this.skyExposureOf = skyExposureOf;
    this.skyRotationOf = skyRotationOf;
  `, ctx);
  return ctx;
}

/** Un fichier Radiance .hdr de `w` × `h`, pixels RGBE à plat (largeur < 8 : pas de RLE). */
function fichierHdr(w, h, pixels){
  const head = '#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ' + h + ' +X ' + w + '\n';
  const out = new Uint8Array(head.length + pixels.length);
  for(let i = 0; i < head.length; i++) out[i] = head.charCodeAt(i);
  out.set(pixels, head.length);
  return out.buffer;
}

// RGBE, tel que le lit HDRLoader : valeur = mantisse / 255 × 2^(exposant − 128)
const rgbe = (m, e) => m / 255 * Math.pow(2, e - 128);

// ---------------------------------------------------------------------------
// 1. La clé de pipeline
// ---------------------------------------------------------------------------

test('la règle de three qui rend la clé nécessaire est TOUJOURS celle du bundle vendorisé', () => {
  // Si three se met un jour à distinguer deux textures dans la clé (ou à relire l'envMap à chaque
  // image), bindEnvironmentKey devient inutile — ce test le signalera au lieu de laisser vivre un
  // contournement mort.
  const src = read('vendor-esm/three.webgpu.min.js');
  const m = src.match(/getMaterialCacheKey\(\)\{[\s\S]{0,900}?\}return s\+=/);
  assert.ok(m, 'getMaterialCacheKey introuvable dans vendor-esm/three.webgpu.min.js');
  assert.match(m[0], /let s=t\.customProgramCacheKey\(\)/,
    'la clé commence par customProgramCacheKey() : c\'est le point d\'extension utilisé');
  assert.match(m[0], /i\.isTexture&&\(n\+=i\.mapping/,
    'une texture ne contribue que par son mapping (et ses filtres) : deux cubes se confondent');
  assert.doesNotMatch(m[0], /\.uuid|\.id\b/, 'la clé ne porte pas l\'identité de la texture');
  // Et l'EnvironmentNode lit la texture en place à sa construction, pour en tirer un PMREM fixe.
  assert.match(src, /"EnvironmentNode"\}constructor\(e=null\)\{super\(\),this\.envNode=e\}setup\(e\)\{const\{material:t\}=e;let r=this\.envNode;if\(r\.isTextureNode\|\|r\.isMaterialReferenceNode\)\{const s=r\.isTextureNode\?r\.value:t\[r\.property\]/);
});

test('la clé d\'un matériau change quand son environnement change — ciel, sonde, boîte', () => {
  const ctx = contexte();
  const T = ctx.THREE;
  const m = new T.MeshStandardMaterial({metalness: 1});
  const ciel = new T.CubeTexture(), sonde = new T.CubeTexture(), autre = new T.CubeTexture();
  m.envMap = ciel;
  assert.equal(ctx.bindEnvironmentKey(m), true, 'première pose');
  const kCiel = m.customProgramCacheKey();
  m.envMap = sonde;
  const kSonde = m.customProgramCacheKey();
  assert.notEqual(kSonde, kCiel, 'du ciel à la sonde : nouvelle clé, donc recompilation');
  m.envMap = autre;
  assert.notEqual(m.customProgramCacheKey(), kSonde, 'deux sondes de même résolution se distinguent');
  m.envMap = ciel;
  assert.equal(m.customProgramCacheKey(), kCiel, 'la même texture redonne la même clé (programme réutilisé)');
  m.envNode = {isNode: true};
  assert.notEqual(m.customProgramCacheKey(), kCiel, 'la projection boîte (envNode) entre aussi dans la clé');
  m.envNode = null; m.envMap = null;
  assert.match(m.customProgramCacheKey(), /\|env:-$/);
});

test('deux matériaux identiques, deux environnements : deux clés (avant : un seul programme partagé)', () => {
  const ctx = contexte();
  const T = ctx.THREE;
  const a = new T.MeshStandardMaterial({metalness: 1, roughness: 0.1});
  const b = new T.MeshStandardMaterial({metalness: 1, roughness: 0.1});
  a.envMap = new T.CubeTexture(); b.envMap = new T.CubeTexture();
  assert.equal(a.customProgramCacheKey(), b.customProgramCacheKey(), 'sans la clé : indiscernables');
  ctx.bindEnvironmentKey(a); ctx.bindEnvironmentKey(b);
  assert.notEqual(a.customProgramCacheKey(), b.customProgramCacheKey());
});

test('la clé d\'origine est gardée, idempotente, invisible aux propriétés, et reposée si remplacée', () => {
  const ctx = contexte();
  const m = new ctx.THREE.MeshStandardMaterial();
  m.customProgramCacheKey = function(){ return 'lissage-multiply'; };   // materials.js en pose une
  ctx.bindEnvironmentKey(m);
  assert.match(m.customProgramCacheKey(), /^lissage-multiply\|env:/, 'la clé du lissage reste en tête');
  assert.equal(ctx.bindEnvironmentKey(m), false, 'idempotente : aucun empilement');
  assert.ok(!Object.keys(m).includes('customProgramCacheKey'),
    'non énumérable : three parcourt les propriétés du matériau pour sa propre clé');
  m.customProgramCacheKey = function(){ return 'autre'; };            // un rebuild la remplace
  assert.equal(ctx.bindEnvironmentKey(m), true, 'reposée');
  assert.match(m.customProgramCacheKey(), /^autre\|env:/);
});

test('seuls les matériaux PBR reçoivent un environnement — le jeu publié testait `envMap in m`', () => {
  const ctx = contexte();
  const T = ctx.THREE;
  assert.equal(ctx.acceptsEnvironment(new T.MeshStandardMaterial()), true);
  assert.equal(ctx.acceptsEnvironment(new T.MeshPhysicalMaterial()), true);
  const basic = new T.MeshBasicMaterial();
  assert.ok('envMap' in basic, 'le piège : un Basic a bien le champ');
  assert.equal(ctx.acceptsEnvironment(basic), false);
  const src = read('js/game-runtime.js');
  const fn = src.slice(src.indexOf('function rtSetEnvironmentOn('), src.indexOf('let rtPendingProbes'));
  assert.match(fn, /acceptsEnvironment\(m\)/);
  assert.match(fn, /bindEnvironmentKey\(m\)/, 'le jeu publié avait le même défaut : même remède');
  assert.doesNotMatch(fn, /'envMap' in m/);
});

// ---------------------------------------------------------------------------
// 2. La HDRI
// ---------------------------------------------------------------------------

test('une vraie HDRI .hdr est lue en demi-flottant linéaire, valeurs au-delà de 1 comprises', () => {
  const ctx = contexte();
  const T = ctx.THREE;
  assert.equal(typeof T.HDRLoader, 'function', 'HDRLoader absent de vendor/three-addons.min.js');
  assert.equal(typeof T.EXRLoader, 'function', 'EXRLoader absent de vendor/three-addons.min.js');
  // 2 × 1 : un soleil (bien au-delà de 1) et un ciel bleu sombre.
  const buf = fichierHdr(2, 1, [200, 180, 150, 130,   64, 96, 128, 128]);
  const tex = ctx.textureFromHdr(buf, 'ciel.hdr');
  assert.equal(tex.type, T.HalfFloatType);
  assert.equal(tex.mapping, T.EquirectangularReflectionMapping, 'prête à servir de ciel');
  assert.equal(tex.colorSpace, T.LinearSRGBColorSpace, 'jamais décodée comme du sRGB');
  assert.equal(ctx.isHdrTexture(tex), true);
  assert.equal(tex.image.width, 2);
  const px = (i) => T.DataUtils.fromHalfFloat(tex.image.data[i]);
  const attendu = [rgbe(200, 130), rgbe(180, 130), rgbe(150, 130), rgbe(64, 128), rgbe(96, 128), rgbe(128, 128)];
  [0, 1, 2, 4, 5, 6].forEach((i, k) => {
    assert.ok(Math.abs(px(i) - attendu[k]) / attendu[k] < 2e-3, 'canal ' + i + ' : ' + px(i) + ' ≠ ' + attendu[k]);
  });
  assert.ok(px(0) > 1, 'le soleil dépasse 1 : c\'est toute la raison d\'une HDRI');
});

test('la vignette d\'une HDRI : lumière ramenée dans [0, 1], le soleil reste le plus clair', () => {
  const ctx = contexte();
  const tex = ctx.textureFromHdr(fichierHdr(2, 1, [200, 180, 150, 130, 64, 96, 128, 128]), 'c.hdr');
  const v = ctx.hdrPreviewPixels(tex, 256);
  assert.equal(v.width, 2); assert.equal(v.height, 1);
  assert.ok(v.data[0] > v.data[4], 'soleil plus clair que le ciel');
  assert.ok(v.data[0] < 255, 'mais pas écrêté à blanc pur : Reinhard, pas min(1)');
  assert.equal(v.data[3], 255);
});

test('un fichier HDR illisible lève un message, pas une texture noire', () => {
  const ctx = contexte();
  assert.throws(() => ctx.textureFromHdr(new Uint8Array([1, 2, 3]).buffer, 'casse.hdr'));
  assert.equal(ctx.isHdrFileName('ciel.HDR'), true);
  assert.equal(ctx.isHdrFileName('ciel.exr'), true);
  assert.equal(ctx.isHdrFileName('ciel.png'), false);
});

test('le ciel « image » garde une HDRI linéaire, met un PNG en sRGB, et se tourne/s\'expose sur la scène', () => {
  const ctx = contexte();
  const T = ctx.THREE;
  const hdr = ctx.textureFromHdr(fichierHdr(2, 1, [128, 128, 128, 129, 128, 128, 128, 129]), 'c.hdr');
  const png = new T.Texture();
  const textures = {h: hdr, p: png};
  const of = (id) => textures[id] || null;
  const fondH = ctx.skyBackgroundFor({sky: 'image', skyAsset: 'h'}, of);
  assert.notEqual(fondH, hdr, 'un CLONE : la cuisson libère son fond');
  assert.equal(fondH.colorSpace, T.LinearSRGBColorSpace);
  assert.equal(fondH.mapping, T.EquirectangularReflectionMapping);
  assert.equal(ctx.skyBackgroundFor({sky: 'image', skyAsset: 'p'}, of).colorSpace, T.SRGBColorSpace);
  assert.ok(ctx.skyBackgroundFor({sky: 'image', skyAsset: 'absent', skyColor: '#112233'}, of).isColor,
    'asset introuvable : la couleur de repli, pas une exception');

  const sc = new T.Scene();
  ctx.applySkyFraming(sc, {sky: 'image', skyRotation: 90, skyExposure: 2.5});
  assert.ok(Math.abs(sc.backgroundRotation.y - Math.PI / 2) < 1e-9, 'rotation autour de la verticale');
  assert.equal(sc.backgroundIntensity, 2.5);
  ctx.applySkyFraming(sc, {sky: 'gradient', skyRotation: 90, skyExposure: 2.5});
  assert.equal(sc.backgroundRotation.y, 0, 'un dégradé ne tourne pas');
  assert.equal(sc.backgroundIntensity, 1);
  // Une scène d'avant les champs : neutre.
  assert.equal(ctx.skyExposureOf({}), 1);
  assert.equal(ctx.skyRotationOf({}), 0);
  assert.equal(ctx.skyExposureOf({skyExposure: 99}), 8, 'borne du Skybox d\'Unity');
});

test('le jeu publié lit les HDRI et pose le même ciel que l\'éditeur', () => {
  const src = read('js/game-runtime.js');
  assert.match(src, /loadTextureFile\(blob, da\.files\[0\]\.name, url\)/, 'chargement des textures : HDRI comprises');
  assert.match(src, /skyBackgroundFor\(env,/, 'le fond vient de la fonction partagée');
  assert.match(src, /applySkyFraming\(game\.scene, env\)/, 'rotation et exposition dans le jeu');
  assert.match(src, /applySkyFraming\(sc, env\)/, 'et dans le reflet de ciel du jeu');
  assert.match(read('js/build.js'), /\{src: 'js\/environment-map\.js'\}/, 'embarqué dans le ZIP');
});
