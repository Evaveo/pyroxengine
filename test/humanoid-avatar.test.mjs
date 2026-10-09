import { deEsm } from './engine-env.mjs';
// L'Avatar Humanoïde existe pour UNE PREUVE précise : deux squelettes qui ne partagent AUCUN nom
// d'os doivent pouvoir se parler, du moment que chacun a son Avatar. moteur/js/retargeting.js
// (reciblage par NOM) ne peut pas le prouver — ses deux rigs de test partagent toujours le même
// préfixe. Ce fichier construit donc DEUX conventions de nommage ÉTRANGÈRES l'une à l'autre
// (Mixamo d'un côté, une convention "L_"/"R_" inventée de l'autre) et vérifie que l'Avatar les
// relie quand même.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const racineMoteur = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(racineMoteur, f), 'utf8');

function contexte(){
  const bac = {console, Math, JSON, Set, Map, Array, Object, Float32Array, Uint16Array};
  bac.window = bac; bac.self = bac; bac.globalThis = bac;
  const ctx = vm.createContext(bac);
  vm.runInContext(deEsm(read('vendor/three.min.js')), ctx, {filename: 'vendor/three.min.js'});
  vm.runInContext(deEsm(read('js/retargeting.js')), ctx, {filename: 'js/retargeting.js'});
  vm.runInContext(deEsm(read('js/humanoid-avatar.js')), ctx, {filename: 'js/humanoid-avatar.js'});
  return ctx;
}

// Un rig humanoïde minimal, sous UNE convention de nommage donnée. `noms` associe chaque
// emplacement humanoïde à son nom RÉEL dans ce rig — deux appels avec des `noms` disjoints
// simulent deux squelettes qui ne se ressemblent par AUCUN nom.
function rig(ctx, noms, opts){
  const T = ctx.THREE;
  const o = opts || {};
  const size = o.size === undefined ? 1 : o.size;
  const os = {};
  const faire = (slot, y, parent) => {
    const b = new T.Bone();
    b.name = noms[slot];
    b.position.set(0, y * size, 0);
    if(parent) parent.add(b);
    os[slot] = b;
    return b;
  };
  const root = new T.Group();
  const hanche = faire('Hips', 100, null);
  root.add(hanche);
  faire('Spine', 20, hanche);
  faire('Head', 15, os.Spine);
  const epauleG = faire('LeftShoulder', 15, hanche);
  faire('LeftUpperArm', 5, epauleG);
  faire('LeftLowerArm', 25, os.LeftUpperArm);
  faire('LeftHand', 25, os.LeftLowerArm);
  faire('LeftUpperLeg', 45, hanche);
  faire('LeftLowerLeg', 40, os.LeftUpperLeg);
  faire('LeftFoot', 15, os.LeftLowerLeg);
  const epauleD = faire('RightShoulder', 15, hanche);
  faire('RightUpperArm', 5, epauleD);
  faire('RightLowerArm', 25, os.RightUpperArm);
  faire('RightHand', 25, os.RightLowerArm);
  faire('RightUpperLeg', 45, hanche);
  faire('RightLowerLeg', 40, os.RightUpperLeg);
  faire('RightFoot', 15, os.RightLowerLeg);
  if(o.epaule) epauleG.quaternion.setFromAxisAngle(new T.Vector3(0, 0, 1), o.epaule);
  return {root, os};
}

const NOMS_MIXAMO = {
  Hips: 'mixamorigHips', Spine: 'mixamorigSpine', Head: 'mixamorigHead',
  LeftShoulder: 'mixamorigLeftShoulder', LeftUpperArm: 'mixamorigLeftArm',
  LeftLowerArm: 'mixamorigLeftForeArm', LeftHand: 'mixamorigLeftHand',
  LeftUpperLeg: 'mixamorigLeftUpLeg', LeftLowerLeg: 'mixamorigLeftLeg',
  LeftFoot: 'mixamorigLeftFoot',
  RightShoulder: 'mixamorigRightShoulder', RightUpperArm: 'mixamorigRightArm',
  RightLowerArm: 'mixamorigRightForeArm', RightHand: 'mixamorigRightHand',
  RightUpperLeg: 'mixamorigRightUpLeg', RightLowerLeg: 'mixamorigRightLeg',
  RightFoot: 'mixamorigRightFoot'
};

// Une convention TOTALEMENT ÉTRANGÈRE à Mixamo — aucun nom en commun, exprès. Le côté est dit
// par une seule lettre (« L_ »/« R_ »), pas en toutes lettres : la forme que beaucoup de rigs
// custom (et proche du Mannequin Unreal) utilisent, distincte de « Left »/« Right ».
const NOMS_ETRANGERS = {
  Hips: 'Pelvis', Spine: 'Spine1', Head: 'Skull',
  LeftShoulder: 'L_Clavicle', LeftUpperArm: 'L_UpperArm',
  LeftLowerArm: 'L_Forearm', LeftHand: 'L_Hand',
  LeftUpperLeg: 'L_Thigh', LeftLowerLeg: 'L_Shin',
  LeftFoot: 'L_Foot',
  RightShoulder: 'R_Clavicle', RightUpperArm: 'R_UpperArm',
  RightLowerArm: 'R_Forearm', RightHand: 'R_Hand',
  RightUpperLeg: 'R_Thigh', RightLowerLeg: 'R_Shin',
  RightFoot: 'R_Foot'
};

function clipTemoin(ctx, noms){
  const T = ctx.THREE;
  const q0 = new T.Quaternion();
  const q1 = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), Math.PI / 6);
  return new T.AnimationClip('marche', 1, [
    new T.VectorKeyframeTrack(noms.Hips + '.position', [0, 1], [0, 100, 0, 0, 110, 0]),
    new T.QuaternionKeyframeTrack(noms.LeftUpperArm + '.quaternion', [0, 1],
      [q0.x, q0.y, q0.z, q0.w, q1.x, q1.y, q1.z, q1.w])
  ]);
}

const track = (clip, suffix) => clip.tracks.find((t) => t.name.endsWith(suffix));

// --- auto-détection ------------------------------------------------------------------------

test('autoMapAvatar reconnait un rig Mixamo SANS AUCUN reglage', () => {
  const ctx = contexte();
  const {root} = rig(ctx, NOMS_MIXAMO);
  const {mapping, missing} = ctx.autoMapAvatar(root);
  assert.equal(mapping.Hips, 'mixamorigHips');
  assert.equal(mapping.LeftUpperArm, 'mixamorigLeftArm');
  assert.equal(mapping.LeftLowerArm, 'mixamorigLeftForeArm');
  assert.equal(mapping.LeftFoot, 'mixamorigLeftFoot');
  assert.deepEqual(Array.from(missing), [], 'des emplacements requis manquent : ' + missing.join(', '));
});

test('autoMapAvatar reconnait AUSSI une convention totalement etrangere', () => {
  const ctx = contexte();
  const {root} = rig(ctx, NOMS_ETRANGERS);
  const {mapping, missing} = ctx.autoMapAvatar(root);
  assert.equal(mapping.Hips, 'Pelvis');
  assert.equal(mapping.LeftUpperArm, 'L_UpperArm');
  assert.equal(mapping.LeftFoot, 'L_Foot');
  assert.deepEqual(Array.from(missing), []);
});

test('un emplacement requis absent est NOMME, pas juste signale', () => {
  const ctx = contexte();
  const noms = Object.assign({}, NOMS_MIXAMO);
  delete noms.LeftHand;
  const {root} = rig(ctx, {Hips: noms.Hips, Spine: noms.Spine, Head: noms.Head,
    LeftShoulder: noms.LeftShoulder, LeftUpperArm: noms.LeftUpperArm,
    LeftLowerArm: noms.LeftLowerArm, LeftHand: 'mixamorigOsSansNomReconnu',
    LeftUpperLeg: noms.LeftUpperLeg, LeftLowerLeg: noms.LeftLowerLeg, LeftFoot: noms.LeftFoot});
  const {missing} = ctx.autoMapAvatar(root);
  assert.ok(missing.includes('LeftHand'), missing.join(', '));
});

// --- validation ------------------------------------------------------------------------------

test('validateAvatar nomme CHAQUE emplacement requis manquant', () => {
  const ctx = contexte();
  const p = ctx.validateAvatar({mapping: {Hips: 'x'}});
  assert.ok(p.some((m) => /« Spine »/.test(m)));
  assert.ok(p.some((m) => /« LeftHand »/.test(m)));
  assert.equal(p.some((m) => /« Hips »/.test(m)), false, 'Hips EST mappé, ne doit pas être signalé');
});

test('un Avatar vide ou illisible se dit, il ne plante pas', () => {
  const ctx = contexte();
  assert.equal(ctx.validateAvatar(null).length, 1);
  assert.match(ctx.validateAvatar(null)[0], /vide ou illisible/);
});

// --- LA PREUVE : reciblage entre deux conventions de nommage ÉTRANGÈRES ---------------------

test('PORTE : un clip Mixamo pilote un rig a la convention totalement etrangere', () => {
  const ctx = contexte();
  const source = rig(ctx, NOMS_MIXAMO);
  const cible = rig(ctx, NOMS_ETRANGERS);
  const avatarSource = ctx.autoMapAvatar(source.root);
  const avatarCible = ctx.autoMapAvatar(cible.root);
  assert.deepEqual(Array.from(avatarSource.missing), []);
  assert.deepEqual(Array.from(avatarCible.missing), []);

  const clip = clipTemoin(ctx, NOMS_MIXAMO);
  const reciblee = ctx.retargetClipViaAvatar(clip, source.root, avatarSource,
    cible.root, avatarCible, 'marche-reciblee');
  assert.ok(reciblee, 'le reciblage a rendu null');

  // La piste produite désigne l'os de la CIBLE (nom étranger), jamais celui de la source.
  const posHanche = track(reciblee, 'Pelvis.position');
  assert.ok(posHanche, 'la piste du bassin doit désigner Pelvis, pas mixamorigHips');
  const rotEpaule = track(reciblee, 'L_UpperArm.quaternion');
  assert.ok(rotEpaule, 'la piste du bras doit désigner L_UpperArm, pas mixamorigLeftArm');
});

test('LA TAILLE est corrigee via la chaine de jambe designee par l Avatar, pas par un nom', () => {
  const ctx = contexte();
  // La cible est deux fois PLUS GRANDE — la translation du bassin doit doubler.
  const source = rig(ctx, NOMS_MIXAMO, {size: 1});
  const cible = rig(ctx, NOMS_ETRANGERS, {size: 2});
  const avatarSource = ctx.autoMapAvatar(source.root);
  const avatarCible = ctx.autoMapAvatar(cible.root);

  const clip = clipTemoin(ctx, NOMS_MIXAMO);
  const reciblee = ctx.retargetClipViaAvatar(clip, source.root, avatarSource, cible.root, avatarCible);
  const posHanche = track(reciblee, 'Pelvis.position');
  // Le clip fait passer le bassin de y=100 à y=110 (+10) ; sur un rig deux fois plus grand,
  // le déplacement DOIT doubler (+20), pas rester +10.
  const dy = posHanche.values[4] - posHanche.values[1];
  assert.ok(Math.abs(dy - 20) < 1e-9, 'dy = ' + dy + ' au lieu de 20 (facteur d\'échelle ignoré)');
});

test('LA POSE DE REPOS est corrigee : une epaule inclinee au repos ne casse pas le geste', () => {
  const ctx = contexte();
  const source = rig(ctx, NOMS_MIXAMO);
  // La cible a l'épaule gauche PENCHÉE de 20° au repos (A-pose vs T-pose).
  const cible = rig(ctx, NOMS_ETRANGERS, {epaule: Math.PI / 9});
  const avatarSource = ctx.autoMapAvatar(source.root);
  const avatarCible = ctx.autoMapAvatar(cible.root);

  const clip = clipTemoin(ctx, NOMS_MIXAMO);
  const reciblee = ctx.retargetClipViaAvatar(clip, source.root, avatarSource, cible.root, avatarCible);
  const rot = track(reciblee, 'L_UpperArm.quaternion');
  // À l'image 0, le clip source est à sa PROPRE pose de repos (identité relative) : la piste
  // reciblée doit donc valoir la pose de repos DE LA CIBLE (inclinée), pas l'identité — sinon
  // le bras « rentrerait dans le torse » au lancement, exactement le défaut documenté en tête
  // de moteur/js/retargeting.js.
  const q0 = {x: rot.values[0], y: rot.values[1], z: rot.values[2], w: rot.values[3]};
  const reposCible = cible.os.LeftUpperArm.quaternion;
  assert.ok(Math.abs(q0.z - reposCible.z) < 1e-9 && Math.abs(q0.w - reposCible.w) < 1e-9,
    'la pose de repos de la cible n\'a pas été reprise à l\'image 0');
});

test('deux squelettes IDENTIQUES (meme convention) : le reciblage ne change rien', () => {
  const ctx = contexte();
  const source = rig(ctx, NOMS_MIXAMO);
  const cible = rig(ctx, NOMS_MIXAMO);
  const avatarSource = ctx.autoMapAvatar(source.root);
  const avatarCible = ctx.autoMapAvatar(cible.root);
  const clip = clipTemoin(ctx, NOMS_MIXAMO);
  const reciblee = ctx.retargetClipViaAvatar(clip, source.root, avatarSource, cible.root, avatarCible);
  const original = track(clip, 'Hips.position');
  const reporte = track(reciblee, 'Hips.position');
  original.values.forEach((v, i) => {
    assert.ok(Math.abs(v - reporte.values[i]) < 1e-9, 'valeur ' + i + ' modifiée sans raison');
  });
});

test('une piste dont l os n est mappe a AUCUN emplacement tombe, sans planter', () => {
  const ctx = contexte();
  const source = rig(ctx, NOMS_MIXAMO);
  const cible = rig(ctx, NOMS_ETRANGERS);
  const avatarSource = ctx.autoMapAvatar(source.root);
  const avatarCible = ctx.autoMapAvatar(cible.root);
  const T = ctx.THREE;
  const clip = new T.AnimationClip('bruit', 1, [
    new T.QuaternionKeyframeTrack('mixamorigOsInconnu.quaternion', [0, 1],
      [0, 0, 0, 1, 0, 0, 0, 1])
  ]);
  const reciblee = ctx.retargetClipViaAvatar(clip, source.root, avatarSource, cible.root, avatarCible);
  assert.equal(reciblee, null, 'aucune piste reciblable : le reciblage doit rendre null, pas planter');
});


// ---------- Detection automatique de l Avatar ----------
//
// Ce que ces tests mesurent, c est la COUVERTURE des conventions de nommage reelles, et ce qui se
// passe quand aucune ne s applique. Le rig Unreal etait le trou : cote en suffixe, douze
// emplacements requis manquants sur quinze.

function osDe(ctx, nom, x, y, z, parent){
  const b = new ctx.THREE.Bone();
  b.name = nom;
  b.position.set(x, y, z);
  if(parent) parent.add(b);
  return b;
}

/** Un corps complet, dont seuls les NOMS changent selon la convention testee. */
function corps(ctx, nom){
  const T = ctx.THREE;
  const root = new T.Group();
  const bassin = osDe(ctx, nom('hips'), 0, 1, 0);
  root.add(bassin);
  const s1 = osDe(ctx, nom('spine1'), 0, 0.2, 0, bassin);
  const s2 = osDe(ctx, nom('spine2'), 0, 0.2, 0, s1);
  const cou = osDe(ctx, nom('neck'), 0, 0.2, 0, s2);
  osDe(ctx, nom('head'), 0, 0.15, 0, cou);
  [['l', 1], ['r', -1]].forEach(function(paire){
    const c = paire[0], sgn = paire[1];
    const cl = osDe(ctx, nom('clavicle', c), sgn * 0.1, 0.1, 0, s2);
    const ua = osDe(ctx, nom('upperarm', c), sgn * 0.2, 0, 0, cl);
    const la = osDe(ctx, nom('lowerarm', c), sgn * 0.25, 0, 0, ua);
    const ha = osDe(ctx, nom('hand', c), sgn * 0.25, 0, 0, la);
    ['a', 'b', 'c'].forEach(function(d){ osDe(ctx, nom('finger' + d, c), sgn * 0.05, 0, 0, ha); });
    const th = osDe(ctx, nom('thigh', c), sgn * 0.1, -0.1, 0, bassin);
    const ca = osDe(ctx, nom('calf', c), 0, -0.4, 0, th);
    const fo = osDe(ctx, nom('foot', c), 0, -0.4, 0, ca);
    osDe(ctx, nom('toes', c), 0, -0.05, 0.1, fo);
  });
  return root;
}

test("un rig UNREAL (cote en suffixe) est entierement detecte", () => {
  const ctx = contexte();
  const UE = {hips:'pelvis', spine1:'spine_01', spine2:'spine_02', neck:'neck', head:'head',
              clavicle:'clavicle', upperarm:'upperarm', lowerarm:'lowerarm', hand:'hand',
              fingera:'index_01', fingerb:'middle_01', fingerc:'pinky_01',
              thigh:'thigh', calf:'calf', foot:'foot', toes:'ball'};
  const root = corps(ctx, (k, c) => UE[k] + (c ? '_' + c : ''));
  const av = ctx.autoMapAvatar(root);
  assert.equal(av.missing.join(','), '', "aucun emplacement requis ne doit manquer");
  assert.equal(av.mapping.LeftUpperArm, 'upperarm_l');
  assert.equal(av.mapping.RightLowerLeg, 'calf_r');
  assert.equal(av.mapping.LeftToes, 'ball_l', "UE nomme les orteils « ball »");
  assert.equal(av.mapping.LeftShoulder, 'clavicle_l',
    "la clavicule est l epaule, pas le bras — une confusion qui inverse tout le membre");
});

test("un rig MIXAMO (cote en prefixe) reste entierement detecte", () => {
  const ctx = contexte();
  const MX = {hips:'Hips', spine1:'Spine', spine2:'Spine1', neck:'Neck', head:'Head',
              clavicle:'Shoulder', upperarm:'Arm', lowerarm:'ForeArm', hand:'Hand',
              fingera:'HandIndex1', fingerb:'HandMiddle1', fingerc:'HandPinky1',
              thigh:'UpLeg', calf:'Leg', foot:'Foot', toes:'ToeBase'};
  const root = corps(ctx, (k, c) => 'mixamorig:' + (c ? (c === 'l' ? 'Left' : 'Right') : '') + MX[k]);
  const av = ctx.autoMapAvatar(root);
  assert.equal(av.missing.join(','), '', "la regression la plus probable : casser Mixamo en ouvrant UE");
  assert.equal(av.mapping.LeftUpperArm, 'mixamorig:LeftArm');
});

test("un rig sans AUCUNE convention connue est detecte par sa FORME", () => {
  const ctx = contexte();
  const FR = {hips:'Bassin', spine1:'Colonne1', spine2:'Colonne2', neck:'Nuque', head:'Tete',
              clavicle:'Epaule', upperarm:'Bras', lowerarm:'Avantbras', hand:'Main',
              fingera:'DoigtA', fingerb:'DoigtB', fingerc:'DoigtC',
              thigh:'Cuisse', calf:'Tibia', foot:'Pied', toes:'Orteils'};
  const root = corps(ctx, (k, c) => FR[k] + (c ? '_' + (c === 'l' ? 'G' : 'D') : ''));
  const av = ctx.autoMapAvatar(root);
  assert.equal(av.missing.join(','), '',
    "la forme d un corps humain suffit : bassin qui fourche, mains d ou partent les doigts");
  assert.equal(av.mapping.LeftHand, 'Main_G');
  assert.equal(av.mapping.RightFoot, 'Pied_D');
  assert.equal(av.mapping.Head, 'Tete');
});

test("la detection par la forme ne REMPLACE jamais ce que les noms ont trouve", () => {
  const ctx = contexte();
  const MX = {hips:'Hips', spine1:'Spine', spine2:'Spine1', neck:'Neck', head:'Head',
              clavicle:'Shoulder', upperarm:'Arm', lowerarm:'ForeArm', hand:'Hand',
              fingera:'HandIndex1', fingerb:'HandMiddle1', fingerc:'HandPinky1',
              thigh:'UpLeg', calf:'Leg', foot:'Foot', toes:'ToeBase'};
  const root = corps(ctx, (k, c) => (c ? (c === 'l' ? 'Left' : 'Right') : '') + MX[k]);
  const avant = ctx.autoMapAvatar(root).mapping;
  // meme rig, mais on force la passe structurelle en vidant un emplacement requis
  const partiel = {};
  Object.keys(avant).forEach(function(k){ if(k !== 'LeftHand') partiel[k] = avant[k]; });
  ctx.mapStructural(root, ctx.bonesUnique(root), partiel);
  assert.equal(partiel.LeftHand, avant.LeftHand, "le trou est comble");
  assert.equal(partiel.RightHand, avant.RightHand, "et le reste n a pas bouge");
});

test("les os repetes par le fichier ne sont comptes qu une fois", () => {
  const ctx = contexte();
  const T = ctx.THREE;
  const root = new T.Group();
  // le cas mesure : un FBX a plusieurs maillages skinnes rapporte le meme squelette N fois
  for(let i = 0; i < 3; i++){
    const hanche = osDe(ctx, 'Hips', 0, 1, 0);
    osDe(ctx, 'Spine', 0, 0.2, 0, hanche);
    root.add(hanche);
  }
  assert.equal(ctx.bonesUnique(root).length, 2, "deux os distincts, pas six");
  assert.equal(ctx.countBonesDuplicated(root), 4, "et quatre repetitions a signaler");
});
