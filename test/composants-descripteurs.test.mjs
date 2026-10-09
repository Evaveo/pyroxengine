// LES VUES DE COMPOSANTS MIGRÉES, UNE PAR UNE.
//
// `component-views.js` porte 21 vues et 1927 lignes de `html()` / `sync()` / `input()` /
// `click()`. La migration se fait vue par vue, et cette table EST le compteur d'avancement :
// un composant absent de `MIGRES` est un composant qui n'est pas migré, et le test le dit.
//
// Ce qu'on mesure pour chacun : les ids d'avant sont conservés (du code extérieur les cible),
// la lecture rend ce que la donnée porte, l'écriture écrit au bon endroit, et les bornes de
// l'ancien `input()` sont toujours appliquées.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte } from './engine-env.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function neuf(){
  // `js/camera-framing.js` EST CHARGE ICI, et il doit l'etre : le champ « Camera principale »
  // passe par ses globales `isCameraMain`/`setCameraMain` (l'inspecteur ne peut pas l'importer,
  // c'est un module que le build sait retirer). Sans lui, le champ retombait sur son repli et le
  // test verifiait un chemin que l'editeur ne prend jamais.
  // js/component-data.js : le choix du son d'une AudioSource liste les assets par isPlayableAudio.
  return creerContexte(['js/camera-framing.js', 'js/component-data.js', 'js/ui/registry.js', 'js/ui/form-plan.js',
                        'js/ui/fields.js', 'js/ui/panels-components.js']);
}

// Les composants migrés. À compléter à chaque vue reprise.
const MIGRES = ['Rigidbody2D', 'Collider2D', 'Light', 'Collider', 'Physics',
                'SpriteAnimator', 'CharacterController2D', 'CameraFollow',
                'ScriptJS', 'UIDocument', 'AudioSource', 'Terrain', 'SpriteRenderer', 'Particles', 'Camera', 'Mesh', 'Reflection', 'Tilemap', 'Events', 'AnimatorController'];

/** Un composant factice : ce qu'une vue lit réellement — `this.data`, et rien de plus. */
function composant(data){ return { data: data, node: { id: 1 } }; }

function descr(env, typeName){
  const d = env.ComponentPanels[typeName];
  assert.ok(d, 'aucun descripteur pour ' + typeName);
  return d;
}
function champ(env, typeName, id){
  return descr(env, typeName).sections.reduce((a, s) => a.concat(s.fields), [])
    .find((f) => f.ids && f.ids[0] === id);
}
function idsAffiches(env, typeName, c){
  return env.planForm(descr(env, typeName), [c]).sections
    .reduce((a, s) => a.concat(s.entries), [])
    .filter((e) => e.kind === 'field').map((e) => e.ids[0]);
}

test('la table d avancement dit ou en est la migration', () => {
  const env = neuf();
  MIGRES.forEach((t) => assert.ok(env.ComponentPanels[t], 'declare comme migre, sans descripteur : ' + t));
});

// ---------- Rigidbody2D ----------

test('Rigidbody2D : les trois ids d avant', () => {
  const env = neuf();
  assert.deepEqual(Array.from(idsAffiches(env, 'Rigidbody2D', composant({}))),
                   ['f-rb2-stat', 'f-rb2-sg', 'f-rb2-vmax']);
});

test('Rigidbody2D : la vitesse max absente vaut 40, et la borne basse tient', () => {
  const env = neuf();
  const f = champ(env, 'Rigidbody2D', 'f-rb2-vmax');
  assert.equal(f.get(composant({})), 40, 'valeur par defaut quand le champ manque');
  const c = composant({ speedMax: 12 });
  assert.equal(f.get(c), 12);
  env.writeField(f, [c], -5);
  assert.ok(c.data.speedMax >= 1, 'une vitesse max nulle immobiliserait le corps sans le dire');
});

test('Rigidbody2D : les deux cases ecrivent des booleens', () => {
  const env = neuf();
  const c = composant({});
  env.writeField(champ(env, 'Rigidbody2D', 'f-rb2-stat'), [c], true);
  env.writeField(champ(env, 'Rigidbody2D', 'f-rb2-sg'), [c], true);
  assert.equal(c.data.statique, true);
  assert.equal(c.data.withoutGravity, true);
});

// ---------- Collider2D ----------

test('Collider2D : une boite montre Traversable, une pente montre Monte vers', () => {
  const env = neuf();
  const boite = idsAffiches(env, 'Collider2D', composant({ shape: 'box' }));
  assert.ok(boite.indexOf('f-c2-walk') !== -1);
  assert.equal(boite.indexOf('f-c2-montee'), -1);
  const pente = idsAffiches(env, 'Collider2D', composant({ shape: 'slope' }));
  assert.ok(pente.indexOf('f-c2-montee') !== -1);
  assert.equal(pente.indexOf('f-c2-walk'), -1);
});

test('Collider2D : une forme absente vaut « boite »', () => {
  const env = neuf();
  assert.equal(champ(env, 'Collider2D', 'f-c2-shape').get(composant({})), 'box');
  assert.ok(idsAffiches(env, 'Collider2D', composant({})).indexOf('f-c2-walk') !== -1);
});

test('Collider2D : changer de forme change la FORME du panneau', () => {
  const env = neuf();
  const a = env.planForm(descr(env, 'Collider2D'), [composant({ shape: 'box' })]);
  const b = env.planForm(descr(env, 'Collider2D'), [composant({ shape: 'slope' })]);
  assert.notEqual(a.shape, b.shape,
    'sinon le champ de la pente n apparait jamais — c est buildInspector() qui le faisait avant');
});

test('Collider2D : les bornes de l ancien input sont conservees', () => {
  const env = neuf();
  const c = composant({ shape: 'box', l: 1, h: 1 });
  env.writeField(champ(env, 'Collider2D', 'f-c2-l'), [c], 0);
  assert.ok(c.data.l >= 0.01, 'une largeur nulle donne un collider qui ne touche rien');
  env.writeField(champ(env, 'Collider2D', 'f-c2-h'), [c], -3);
  assert.ok(c.data.h >= 0.01);
  // Les décalages, eux, sont librement négatifs : c'est leur raison d'être.
  env.writeField(champ(env, 'Collider2D', 'f-c2-dx'), [c], -2);
  assert.equal(c.data.dx, -2);
});


test('les descripteurs se chargent APRES la facade, sinon rien ne s enregistre', () => {
  // POURQUOI CE TEST EXISTE. `declareComponentPanel` previent ComponentViews — et l appel est
  // garde par `typeof`. Charge AVANT component-views.js, il ne fait rien : les descripteurs
  // existent, aucune vue migree ne s affiche, et il n y a ni erreur ni test rouge.
  const html = fs.readFileSync(path.join(root, 'editor.html'), 'utf8');
  const iFacade = html.indexOf('js/component-views.js');
  const iPanneaux = html.indexOf('js/ui/panels-components.js');
  assert.ok(iFacade !== -1 && iPanneaux !== -1, 'les deux fichiers doivent etre charges');
  assert.ok(iPanneaux > iFacade,
    'panels-components.js doit etre charge APRES component-views.js');
});

// ---------- Light ----------

test('Light : la PORTEE est reglable — elle ne l etait plus', () => {
  // L ancienne vue routait `f-portee` alors que le champ construit s appelle `f-range` : la
  // portee d une lumiere ne s enregistrait pas. Le routage par liste d identifiants ne pardonne
  // pas une traduction a moitie faite, et il ne dit rien.
  const env = neuf();
  const c = { subType: 'point', node: {}, objectThree: { distance: 10, intensity: 1,
    penumbra: 0, angle: 0.5, color: { getHexString: () => 'ffffff' } } };
  const f = champ(env, 'Light', 'f-range');
  assert.equal(f.get(c), 10);
  env.writeField(f, [c], 25);
  assert.equal(c.objectThree.distance, 25);
  assert.equal(c.range, 25, 'la donnee du composant suit, pas seulement l objet three');
});

test('Light : une directionnelle n a pas de portee, un spot a un angle', () => {
  const env = neuf();
  const lum = { distance: 10, intensity: 1, penumbra: 0, angle: 0.5,
    color: { getHexString: () => 'ffffff' } };
  const ids = (t) => idsAffiches(env, 'Light', { subType: t, node: {}, objectThree: lum });
  assert.equal(ids('directional').indexOf('f-range'), -1);
  assert.ok(ids('point').indexOf('f-range') !== -1);
  assert.ok(ids('spot').indexOf('f-angle') !== -1 && ids('spot').indexOf('f-penombre') !== -1);
  assert.equal(ids('point').indexOf('f-angle'), -1);
});

// ---------- Collider ----------

test('Collider : « auto » ne montre ni taille, ni decalage, ni declencheur', () => {
  const env = neuf();
  const c = (shape) => composant({ shape: shape, dims: [1, 1, 1], offset: [0, 0, 0],
    radius: 1, height: 2 });
  const auto = idsAffiches(env, 'Collider', c('auto'));
  assert.deepEqual(Array.from(auto), ['f-cshape'],
    'une boite englobante automatique n a rien a regler');
  const boite = idsAffiches(env, 'Collider', c('box'));
  assert.ok(boite.indexOf('f-cdx') !== -1 && boite.indexOf('f-ctrigger') !== -1);
  const cyl = idsAffiches(env, 'Collider', c('cylindre'));
  assert.ok(cyl.indexOf('f-crayon') !== -1 && cyl.indexOf('f-chauteur') !== -1);
  assert.equal(cyl.indexOf('f-cdx'), -1);
});

test('Collider : les bornes a 0.05 tiennent sur les trois axes', () => {
  const env = neuf();
  const c = composant({ shape: 'box', dims: [1, 1, 1], offset: [0, 0, 0], radius: 1, height: 2 });
  env.updateColliderViz = () => {};
  env.writeField(champ(env, 'Collider', 'f-cdx'), [c], [0, -2, 0.5]);
  assert.ok(c.data.dims.every((x) => x >= 0.05),
    'un collider d epaisseur nulle ne touche jamais rien, et ca se cherche longtemps');
  env.writeField(champ(env, 'Collider', 'f-cox'), [c], [-1, 2, -3]);
  assert.deepEqual(Array.from(c.data.offset), [-1, 2, -3], 'un decalage est librement negatif');
});

// ---------- Physics ----------

test('Physics : une masse de ZERO est une valeur, pas une absence', () => {
  // Masse 0 = corps statique dans cannon. La confondre avec « champ vide » rendrait un corps
  // statique impossible a regler depuis l inspecteur.
  const env = neuf();
  const c = composant({ masse: 0, bounce: 0.2, friction: 0.5 });
  assert.equal(champ(env, 'Physics', 'f-pmass').get(c), 0);
  env.writeField(champ(env, 'Physics', 'f-prebond'), [c], 5);
  assert.ok(c.data.bounce <= 1, 'un rebond > 1 rend de l energie a chaque choc');
  env.writeField(champ(env, 'Physics', 'f-pfriction'), [c], -2);
  assert.ok(c.data.friction >= 0);
});

// ---------- SpriteAnimator ----------

test('SpriteAnimator : la VITESSE est reglable — elle ne l etait plus', () => {
  // Champ construit sous `f-as-vitesse`, relu sous `f-as-speed` : la vitesse d une animation
  // de sprite ne s enregistrait pas.
  const env = neuf();
  env.assetSpriteOfNode = () => ({ name: 'planche', sequences: [{ name: 'marche' }], regions: [] });
  const f = champ(env, 'SpriteAnimator', 'f-as-vitesse');
  assert.ok(f, 'le champ doit porter l id qui EXISTE dans la page');
  const c = composant({});
  assert.equal(f.get(c), 1, 'vitesse par defaut');
  env.writeField(f, [c], 50);
  assert.ok(c.data.speed <= 20, 'la borne haute de l ancien code tient');
});

test('SpriteAnimator : sans planche, aucun champ — seulement ce qu il faut faire', () => {
  const env = neuf();
  env.assetSpriteOfNode = () => null;
  const c = composant({});
  assert.deepEqual(Array.from(idsAffiches(env, 'SpriteAnimator', c)), [],
    'trois champs vides feraient chercher un reglage qui n existe pas encore');
  const notes = env.planForm(descr(env, 'SpriteAnimator'), [c]).sections
    .reduce((a, s) => a.concat(s.entries), []).filter((e) => e.kind === 'note');
  assert.equal(notes.length, 1, 'une seule note : celle qui dit de choisir une planche');
});

test('SpriteAnimator : une planche sans suite le DIT, et ne montre pas de liste vide', () => {
  const env = neuf();
  env.assetSpriteOfNode = () => ({ name: 'planche', sequences: [], regions: [] });
  const c = composant({});
  assert.deepEqual(Array.from(idsAffiches(env, 'SpriteAnimator', c)), []);
});

// ---------- CharacterController2D ----------

test('CharacterController2D : la vue de dessus CACHE les champs du saut', () => {
  // Un reglage visible mais sans effet se regle quand meme, et on cherche ensuite pourquoi il
  // ne fait rien. En vue de dessus, il n y a pas de saut : les champs disparaissent.
  const env = neuf();
  const cote = idsAffiches(env, 'CharacterController2D', composant({ mode: 'platform' }));
  ['f-ct2-saut', 'f-ct2-coy', 'f-ct2-mem'].forEach((id) => assert.ok(cote.indexOf(id) !== -1));
  const dessus = idsAffiches(env, 'CharacterController2D', composant({ mode: 'topdown' }));
  ['f-ct2-saut', 'f-ct2-coy', 'f-ct2-mem'].forEach((id) => assert.equal(dessus.indexOf(id), -1));
  assert.ok(dessus.indexOf('f-ct2-vit') !== -1, 'la vitesse, elle, sert dans les deux modes');
});

test('CharacterController2D : un mode inconnu retombe sur la plateforme', () => {
  const env = neuf();
  const c = composant({});
  assert.equal(champ(env, 'CharacterController2D', 'f-ct2-mode').get(c), 'platform');
  env.writeField(champ(env, 'CharacterController2D', 'f-ct2-mode'), [c], 'nimporte-quoi');
  assert.equal(c.data.mode, 'platform');
});

// ---------- CameraFollow ----------

test('CameraFollow : une borne ABSENTE est vide, pas zero', () => {
  // Zero est une borne parfaitement legitime. Les confondre bornerait l axe a l origine, et la
  // camera buterait sur un mur invisible.
  const env = neuf();
  const f = champ(env, 'CameraFollow', 'f-camf-xmin');
  assert.equal(f.get({ node: {} }), null, 'absente : vide');
  assert.equal(f.get({ node: {}, xMin: 0 }), 0, 'zero : une borne comme une autre');
  const c = { node: {}, xMin: 5 };
  env.writeField(f, [c], null);
  assert.equal(c.xMin, null, 'effacer le champ enleve la borne');
});

test('CameraFollow : « Enlever les bornes » les enleve toutes les quatre', () => {
  const env = neuf();
  env.setStatus = () => {};
  const c = { node: {}, xMin: 1, xMax: 2, yMin: 3, yMax: 4 };
  const action = descr(env, 'CameraFollow').sections
    .reduce((a, s) => a.concat(s.fields), [])
    .find((f) => f.ids && f.ids[0] === 'btn-camf-free');
  action.run(c);
  assert.deepEqual([c.xMin, c.xMax, c.yMin, c.yMax], [null, null, null, null]);
});

test('CameraFollow : la cible se choisit dans une LISTE, sans soi-meme', () => {
  const env = neuf();
  const o = { name: 'Camera' };
  env.objects = [o, { name: 'Joueur' }, { name: '' }];
  const opts = champ(env, 'CameraFollow', 'f-camf-target').options({ node: o });
  const noms = Array.from(opts.map((x) => x[0]));
  assert.ok(noms.indexOf('Joueur') !== -1);
  assert.equal(noms.indexOf('Camera'), -1, 'une camera ne se suit pas elle-meme');
  assert.equal(noms.filter((x) => x === '').length, 1, 'un objet sans nom n entre pas dans la liste');
});

// ---------- UIDocument ----------

test('UIDocument : le bouton dit CREER quand il n y a rien, EDITER sinon', () => {
  // « Editer » sur du vide ouvrirait un editeur sans rien dedans, sans dire qu on vient d en
  // creer un.
  const env = neuf();
  env.assets = [];
  const vide = { data: { documentUIId: null, sheetStyleIds: [] }, documentUI: null,
    feuillesStyle: [], node: { id: 1, name: 'HUD' } };
  const actions = (c) => env.planForm(descr(env, 'UIDocument'), [c]).sections
    .reduce((a, s) => a.concat(s.entries), []).filter((e) => e.kind === 'action')
    .map((e) => e.ids[0]);
  assert.deepEqual(Array.from(actions(vide)), ['btn-uidoc-create']);
  const plein = Object.assign({}, vide, { documentUI: { id: 'd1', html: '' } });
  assert.deepEqual(Array.from(actions(plein)), ['btn-uidoc-edit']);
});

test('UIDocument : un asset d un autre genre est REFUSE', () => {
  const env = neuf();
  env.assets = [{ id: 'a1', kind: 'texture', name: 'pierre' }];
  const c = { data: { documentUIId: null, sheetStyleIds: [] }, documentUI: null,
    feuillesStyle: [], node: { id: 1, name: 'HUD' } };
  env.writeField(champ(env, 'UIDocument', 'f-uidoc-doc'), [c], 'a1');
  assert.equal(c.data.documentUIId, null,
    'une texture n est pas un document UI : le champ ne doit pas s en contenter');
});

// ---------- AudioSource ----------

test('AudioSource : un asset audio DISPARU est signale', () => {
  // Une source dont l asset a ete supprime ne leve rien : elle reste, et elle est muette. On
  // chercherait le defaut du cote du navigateur.
  const env = neuf();
  env.assets = [{ id: 'son1', kind: 'audio', name: 'saut' }];
  const notes = (c) => env.planForm(descr(env, 'AudioSource'), [c]).sections
    .reduce((a, s) => a.concat(s.entries), []).filter((e) => e.kind === 'note')
    .map((e) => e.text).join(' ');
  assert.ok(/manquant/i.test(notes(composant({ asset: 'disparu', spatial: false }))));
  assert.ok(!/manquant/i.test(notes(composant({ asset: 'son1', spatial: false }))));
});

test('AudioSource : un son NON spatial cache les reglages d attenuation', () => {
  const env = neuf();
  env.assets = [];
  const plat = idsAffiches(env, 'AudioSource', composant({ spatial: false }));
  ['f-audmax', 'f-aupente', 'f-aumodele'].forEach((id) => assert.equal(plat.indexOf(id), -1));
  const spatial = idsAffiches(env, 'AudioSource', composant({}));
  ['f-audmax', 'f-aupente', 'f-aumodele'].forEach((id) => assert.ok(spatial.indexOf(id) !== -1,
    'sans reglage declare, `spatial` vaut VRAI : c est `!== false`, pas `!!`'));
});

test('AudioSource : les bornes de l ancien input tiennent', () => {
  const env = neuf();
  env.assets = [];
  const c = composant({});
  env.writeField(champ(env, 'AudioSource', 'f-auvol'), [c], 9);
  assert.ok(c.data.volume <= 2);
  env.writeField(champ(env, 'AudioSource', 'f-aupitch'), [c], 0);
  assert.ok(c.data.pitch >= 0.25, 'une vitesse de lecture nulle ne joue rien');
  env.writeField(champ(env, 'AudioSource', 'f-auportee'), [c], -3);
  assert.ok(c.data.range >= 0.5);
});

// ---------- Terrain ----------

test('Terrain : les reglages du PINCEAU n apparaissent que pendant la sculpture', () => {
  // Le pinceau est un outil de l editeur, pas une donnee du terrain. Le montrer hors sculpture
  // ferait regler un outil qu on n a pas en main.
  const env = neuf();
  const node = { id: 7 };
  const c = { node: node, data: { size: 20, segments: 32, colorBottom: '#0f0',
    colorTop: '#888', colorNeige: '#fff', thresholdRoche: 0.5, thresholdNeige: 0.8 } };
  env.sculpt = { active: false, target: null, mode: 'monter', radius: 4, force: 1 };
  env.SCULPT_MODES = [['monter', 'Monter']];
  const repos = idsAffiches(env, 'Terrain', c);
  ['f-scmode', 'f-sc-radius', 'f-scforce'].forEach((id) => assert.equal(repos.indexOf(id), -1));

  env.sculpt.active = true; env.sculpt.target = node;
  const enCours = idsAffiches(env, 'Terrain', c);
  ['f-scmode', 'f-sc-radius', 'f-scforce'].forEach((id) => assert.ok(enCours.indexOf(id) !== -1));
});

test('Terrain : sculpter un AUTRE terrain ne montre pas le pinceau ici', () => {
  const env = neuf();
  const c = { node: { id: 7 }, data: { size: 20, segments: 32, colorBottom: '#0f0',
    colorTop: '#888', colorNeige: '#fff', thresholdRoche: 0.5, thresholdNeige: 0.8 } };
  env.sculpt = { active: true, target: { id: 99 }, mode: 'monter', radius: 4, force: 1 };
  env.SCULPT_MODES = [['monter', 'Monter']];
  assert.equal(idsAffiches(env, 'Terrain', c).indexOf('f-sc-radius'), -1);
});

test('Terrain : les couleurs reappliquent le relief, sinon rien ne change a l ecran', () => {
  const env = neuf();
  env.sculpt = { active: false, target: null };
  env.SCULPT_MODES = [];
  let applique = 0;
  env.applyHeightsTerrain = () => { applique += 1; };
  const c = { node: { id: 7 }, data: { size: 20, segments: 32, colorBottom: '#0f0',
    colorTop: '#888', colorNeige: '#fff', thresholdRoche: 0.5, thresholdNeige: 0.8 } };
  env.writeField(champ(env, 'Terrain', 'f-trbottom'), [c], '#123456');
  assert.equal(c.data.colorBottom, '#123456');
  assert.equal(applique, 1);
  env.writeField(champ(env, 'Terrain', 'f-trsr'), [c], 9);
  assert.ok(c.data.thresholdRoche <= 1);
});

// ---------- SpriteRenderer ----------

test('SpriteRenderer : le tri par PROFONDEUR fait disparaitre le champ Ordre', () => {
  // Le laisser visible ferait regler un champ sans effet, puis chercher pourquoi il ne fait rien.
  const env = neuf();
  env.assets = [{ id: 'sp1', kind: 'sprite', name: 'heros', ppu: 32, regions: [{ name: 'idle' }] }];
  env.layers2dOfProject = () => ['Fond', 'Jeu'];
  const manuel = idsAffiches(env, 'SpriteRenderer', composant({ spriteId: 'sp1' }));
  assert.ok(manuel.indexOf('f-sp-ordre') !== -1);
  const profondeur = idsAffiches(env, 'SpriteRenderer', composant({ spriteId: 'sp1', sortDepth: true }));
  assert.equal(profondeur.indexOf('f-sp-ordre'), -1);
});

test('SpriteRenderer : une planche a UNE seule image ne propose pas de choix', () => {
  const env = neuf();
  env.layers2dOfProject = () => ['Jeu'];
  env.assets = [{ id: 'sp1', kind: 'sprite', name: 'caisse', ppu: 32, regions: [{ name: 'a' }] }];
  assert.equal(idsAffiches(env, 'SpriteRenderer', composant({ spriteId: 'sp1' })).indexOf('f-sp-region'), -1);
  env.assets[0].regions.push({ name: 'b' });
  assert.ok(idsAffiches(env, 'SpriteRenderer', composant({ spriteId: 'sp1' })).indexOf('f-sp-region') !== -1);
});

test('SpriteRenderer : sans sprite, seul le choix du sprite — et ce qu il faut faire', () => {
  const env = neuf();
  env.assets = [];
  env.layers2dOfProject = () => ['Jeu'];
  assert.deepEqual(Array.from(idsAffiches(env, 'SpriteRenderer', composant({}))), ['f-sp-asset']);
});

test('SpriteRenderer : changer de sprite OUBLIE la region de l ancien', () => {
  const env = neuf();
  env.assets = [{ id: 'sp1', kind: 'sprite', name: 'a', ppu: 32, regions: [] },
                { id: 'sp2', kind: 'sprite', name: 'b', ppu: 32, regions: [] }];
  env.layers2dOfProject = () => ['Jeu'];
  let rebati = 0;
  env.rebuildMeshSprite = () => { rebati += 1; };
  const c = composant({ spriteId: 'sp1', region: 'idle' });
  env.writeField(champ(env, 'SpriteRenderer', 'f-sp-asset'), [c], 'sp2');
  assert.equal(c.data.region, '', 'garder l ancienne region afficherait une image au hasard');
  assert.equal(rebati, 1);
});

// ---------- Particles ----------

test('Particles : la FORME decide des champs, le MODE aussi', () => {
  const env = neuf();
  env.resetSystemParticles = () => {};
  const pa = (over) => composant(Object.assign({ shape: 'point', mode: 'continu',
    dims: [1, 1, 1], radius: 1, angle: 20 }, over));
  const point = idsAffiches(env, 'Particles', pa({}));
  ['f-padx', 'f-parayon', 'f-paangle'].forEach((id) => assert.equal(point.indexOf(id), -1,
    'un point n a ni zone, ni rayon, ni angle'));
  const boite = idsAffiches(env, 'Particles', pa({ shape: 'box' }));
  assert.ok(boite.indexOf('f-padx') !== -1);
  const cone = idsAffiches(env, 'Particles', pa({ shape: 'cone' }));
  assert.ok(cone.indexOf('f-parayon') !== -1 && cone.indexOf('f-paangle') !== -1);

  const continu = idsAffiches(env, 'Particles', pa({}));
  assert.ok(continu.indexOf('f-pataux') !== -1 && continu.indexOf('f-paquantite') === -1);
  const rafale = idsAffiches(env, 'Particles', pa({ mode: 'burst' }));
  assert.ok(rafale.indexOf('f-paquantite') !== -1 && rafale.indexOf('f-pataux') === -1);
});

test('Particles : la gravite est librement NEGATIVE — une fumee monte', () => {
  const env = neuf();
  env.resetSystemParticles = () => {};
  const c = composant({ shape: 'point', mode: 'continu', dims: [1, 1, 1], gravity: 0 });
  env.writeField(champ(env, 'Particles', 'f-pagravite'), [c], -9);
  assert.equal(c.data.gravity, -9);
});

test('Particles : changer le MAX reconstruit le systeme', () => {
  // Le nombre de particules fixe la taille des tampons : le changer sans reconstruire laisse
  // le systeme avec ses anciens tableaux.
  const env = neuf();
  let resets = 0;
  env.resetSystemParticles = () => { resets += 1; };
  const c = composant({ shape: 'point', mode: 'continu', dims: [1, 1, 1], max: 100 });
  env.writeField(champ(env, 'Particles', 'f-pamax'), [c], 99999);
  assert.ok(c.data.max <= 5000);
  assert.equal(resets, 1);
  env.writeField(champ(env, 'Particles', 'f-paadditive'), [c], false);
  assert.equal(resets, 2, 'le melange est pose sur le materiau a la construction');
});

// ---------- Camera ----------

function cameraFactice(over){
  return Object.assign({
    projection: 'perspective', fov: 60, near: 0.1, far: 500,
    pixelPerfect: false, ppu: 16, mode: 'height', ratio: 1, widthLevel: 20, orthoSize: 5,
    objectThree: {}, node: { name: 'Cam', userData: { type: 'camera', game: {} } },
    applyProjection: function(){}
  }, over || {});
}

test('Camera : les champs suivent la PROJECTION', () => {
  const env = neuf();
  env.activeCam = null;
  env.project.layers = [{ id: 0, name: 'Défaut' }];
  const persp = idsAffiches(env, 'Camera', cameraFactice());
  assert.ok(persp.indexOf('f-fov') !== -1);
  ['f-cam-pixelperfect', 'f-cam-ppu', 'f-cam-orthosize'].forEach((id) =>
    assert.equal(persp.indexOf(id), -1, 'un FOV et un pixel perfect ne coexistent pas'));

  const ortho = idsAffiches(env, 'Camera', cameraFactice({ projection: 'orthographic' }));
  assert.equal(ortho.indexOf('f-fov'), -1);
  assert.ok(ortho.indexOf('f-cam-pixelperfect') !== -1 && ortho.indexOf('f-cam-orthosize') !== -1);
});

test('Camera : le pixel perfect ouvre ses propres reglages, selon le cadrage', () => {
  const env = neuf();
  env.activeCam = null;
  env.project.layers = [{ id: 0, name: 'Défaut' }];
  env.framing2d = () => ({ ratio: 3, heightView: 12 });
  const base = { projection: 'orthographic', pixelPerfect: true };
  const net = idsAffiches(env, 'Camera', cameraFactice(base));
  assert.ok(net.indexOf('f-cam-ppu') !== -1 && net.indexOf('cam-render') !== -1);
  assert.equal(net.indexOf('f-cam-orthosize'), -1);
  assert.equal(net.indexOf('f-cam-ratio'), -1, 'le rapport ne se regle qu en mode impose');
  const impose = idsAffiches(env, 'Camera', cameraFactice(Object.assign({}, base, { mode: 'fixed' })));
  assert.ok(impose.indexOf('f-cam-ratio') !== -1);
  const largeur = idsAffiches(env, 'Camera', cameraFactice(Object.assign({}, base, { mode: 'width' })));
  assert.ok(largeur.indexOf('f-cam-widthlevel') !== -1);
});

test('Camera : le rendu est une MESURE, pas un libelle', () => {
  const env = neuf();
  env.activeCam = null;
  env.project.layers = [];
  env.framing2d = () => ({ ratio: 3, heightView: 12 });
  env.viewEl = { clientWidth: 1920, clientHeight: 1080 };
  const info = env.planForm(descr(env, 'Camera'),
    [cameraFactice({ projection: 'orthographic', pixelPerfect: true, ppu: 32 })]).sections
    .reduce((a, s) => a.concat(s.entries), []).find((e) => e.ids && e.ids[0] === 'cam-render');
  assert.ok(/×3/.test(info.value), 'le rapport pixel obtenu doit etre AFFICHE');
  assert.ok(/384 pixels de dessin sur 1080/.test(info.value));
});

test('Camera : une seule camera PRINCIPALE a la fois', () => {
  const env = neuf();
  env.activeCam = null;
  env.project.layers = [];
  env.setStatus = () => {};
  // LE DRAPEAU VIT SUR LE COMPOSANT. Ce test affirmait `userData.game.main`, l'ancien des deux
  // stockages — celui que l'inspecteur ecrivait et que le fichier de scene ne transportait PAS.
  // Il passait donc au vert en verifiant exactement la moitie cassee du systeme. Voir
  // test/camera-principale.test.mjs pour la regle complete.
  const autreComp = { projection: 'perspective', main: true };
  const autre = { name: 'Autre', userData: { type: 'camera', game: {} },
                  getComponent: (t) => (t === 'Camera' ? autreComp : null) };
  env.objects = [autre];
  const c = cameraFactice();
  c.node.getComponent = (t) => (t === 'Camera' ? c : null);
  env.objects.push(c.node);
  env.writeField(champ(env, 'Camera', 'f-cam-main'), [c], true);
  assert.equal(c.main, true);
  assert.equal(autreComp.main, false,
    'deux principales laisseraient le jeu choisir — il prendrait la premiere rencontree');
});

test('Camera : tout coche EFFACE le masque de calques', () => {
  // Serialiser la liste complete rendrait invisible tout calque ajoute plus tard.
  const env = neuf();
  env.activeCam = null;
  env.previewCam = null;
  env.project.layers = [{ id: 0, name: 'A' }, { id: 1, name: 'B' }];
  const c = cameraFactice();
  const liste = env.planForm(descr(env, 'Camera'), [c]).sections
    .reduce((a, s) => a.concat(s.entries), []).find((e) => e.kind === 'list');
  assert.equal(liste.rows.length, 2, 'une ligne par calque du projet');
  assert.equal(liste.rows[0].entries[0].value, true, 'sans masque, tout est visible');

  env.writeField(liste.rows[1].entries[0].field, [liste.rows[1].item], false);
  assert.deepEqual(Array.from(c.node.userData.game.camMask), [0]);
  const liste2 = env.planForm(descr(env, 'Camera'), [c]).sections
    .reduce((a, s) => a.concat(s.entries), []).find((e) => e.kind === 'list');
  env.writeField(liste2.rows[1].entries[0].field, [liste2.rows[1].item], true);
  assert.equal(c.node.userData.game.camMask, undefined, 'tout coche : plus de masque du tout');
});

// ---------- Mesh ----------

// Les fonctions du moteur que le descripteur appelle : le harnais ne charge pas materials.js.
function meshEnv(env){
  env.assets = [];
  env.smoothingFromRoughness = (r) => 1 - r;
  env.roughnessFromSmoothing = (l) => 1 - l;
  env.THREE = { Color: function(v){ this.getHexString = () => '000000'; this.getHex = () => 0; },
                DoubleSide: 2, FrontSide: 0 };
  return env;
}

function meshFactice(over){
  const m = { color: { getHexString: () => 'ff0000', set(){} }, roughness: 0.5, metalness: 0.1,
    opacity: 1, emissive: { set(){} } };
  return Object.assign({
    node: { name: 'Cube', userData: { geo: 'cube' }, castShadow: true, receiveShadow: true },
    material: m, mesh: { geometry: { dispose(){} } }
  }, over || {});
}

test('Mesh : un objet LIE a un asset materiau n expose AUCUN champ brut', () => {
  // Les editer ici les perdrait au prochain rechargement de l asset : l objet suit l asset,
  // c est tout l interet du lien.
  const env = meshEnv(neuf());
  env.assetMaterialOf = () => ({ id: 'm1', name: 'Bois', shaderId: null });
  const ids = idsAffiches(env, 'Mesh', meshFactice());
  ['f-color', 'f-smoothing', 'f-metal', 'f-ecolor', 'f-opacite', 'f-unlit', 'f-mat-asset']
    .forEach((id) => assert.equal(ids.indexOf(id), -1, id + ' ne doit pas etre editable ici'));
});

test('Mesh : sans asset, les champs bruts sont la — et le lien ne l est pas', () => {
  const env = meshEnv(neuf());
  env.assetMaterialOf = () => null;
  const ids = idsAffiches(env, 'Mesh', meshFactice());
  ['f-color', 'f-smoothing', 'f-metal', 'f-opacite', 'f-mat-asset'].forEach((id) =>
    assert.ok(ids.indexOf(id) !== -1, id + ' doit etre editable'));
  assert.equal(ids.indexOf('mesh-mat-name'), -1);
});

test('Mesh : le bouton du graphe de shader ne s affiche que s il y a un shader', () => {
  const env = neuf();
  env.assets = [];
  const actions = () => env.planForm(descr(env, 'Mesh'), [meshFactice()]).sections
    .reduce((a, s) => a.concat(s.entries), []).filter((e) => e.kind === 'action')
    .map((e) => e.ids[0]);
  env.assetMaterialOf = () => ({ id: 'm1', name: 'Bois', shaderId: null });
  assert.equal(actions().indexOf('btn-mat-edit-shader'), -1);
  env.assetMaterialOf = () => ({ id: 'm1', name: 'Bois', shaderId: 'sh1' });
  assert.ok(actions().indexOf('btn-mat-edit-shader') !== -1);
});

test('Mesh : le mesh importe ne se choisit que sur une geometrie personnalisee', () => {
  const env = meshEnv(neuf());
  env.assetMaterialOf = () => null;
  assert.equal(idsAffiches(env, 'Mesh', meshFactice()).indexOf('f-geo-asset'), -1);
  const perso = meshFactice();
  perso.node.userData.geo = 'custom';
  assert.ok(idsAffiches(env, 'Mesh', perso).indexOf('f-geo-asset') !== -1);
});

test('Mesh : l opacite commande la transparence', () => {
  // Un materiau opaque laisse transparent paie un tri par profondeur pour rien, et se melange
  // mal avec ses voisins.
  const env = meshEnv(neuf());
  env.assetMaterialOf = () => null;
  const c = meshFactice();
  env.writeField(champ(env, 'Mesh', 'f-opacite'), [c], 0.4);
  assert.equal(c.material.transparent, true);
  env.writeField(champ(env, 'Mesh', 'f-opacite'), [c], 1);
  assert.equal(c.material.transparent, false);
});

test('Mesh : les ombres sont VRAIES par defaut', () => {
  const env = meshEnv(neuf());
  env.assetMaterialOf = () => null;
  const c = meshFactice();
  delete c.node.castShadow;
  assert.equal(champ(env, 'Mesh', 'f-castshadow').get(c), true,
    'une geometrie jamais reglee projette une ombre');
});

// ---------- Reflection ----------

function sondeEnv(env, over){
  const s = Object.assign({ radius: 10, resolution: 128, intensity: 1, auto: true, box: false,
    boxSize: [4, 3, 4], boxOffset: [0, 0, 0] }, over || {});
  env.ensureProbe = () => s;
  env.engineProbes = { cuites: new Map() };
  env.probesActive = () => [];
  env.receiversDEnvironment = () => [];
  env.probeMoreNear = () => null;
  env.applyProbes = () => {};
  env.updateBoxProbeViz = () => {};
  env.bakeProbe = () => {};
  return s;
}

test('Reflection : la boite de projection cache ses champs tant qu elle est eteinte', () => {
  const env = neuf();
  const s = sondeEnv(env);
  const c = { node: { id: 3 } };
  const sans = idsAffiches(env, 'Reflection', c);
  ['f-sobtx', 'f-sobdx'].forEach((id) => assert.equal(sans.indexOf(id), -1));
  s.box = true;
  const avec = idsAffiches(env, 'Reflection', c);
  ['f-sobtx', 'f-sobdx'].forEach((id) => assert.ok(avec.indexOf(id) !== -1));
});

test('Reflection : l etat de cuisson est une MESURE', () => {
  // Une sonde jamais cuite ne reflete rien, et rien d autre ne le signale.
  const env = neuf();
  sondeEnv(env);
  const c = { node: { id: 3 } };
  const etat = () => env.planForm(descr(env, 'Reflection'), [c]).sections
    .reduce((a, s) => a.concat(s.entries), []).find((e) => e.ids && e.ids[0] === 'probe-state').value;
  assert.equal(etat(), 'non cuite');
  env.engineProbes.cuites.set(c.node, { rt: { width: 256 }, color: '#446688' });
  assert.ok(/cuite \(256px\)/.test(etat()));
});

test('Reflection : l ambiance mesuree n apparait qu apres cuisson', () => {
  const env = neuf();
  sondeEnv(env);
  const c = { node: { id: 3 } };
  const ids = () => idsAffiches(env, 'Reflection', c);
  assert.equal(ids().indexOf('probe-ambient'), -1);
  env.engineProbes.cuites.set(c.node, { rt: { width: 128 }, color: '#446688' });
  assert.ok(ids().indexOf('probe-ambient') !== -1);
});

test('Reflection : changer la RESOLUTION recuit tout de suite', () => {
  // Sinon la sonde garde son ancienne image, et le reglage n a l air de rien faire.
  const env = neuf();
  const s = sondeEnv(env);
  let cuissons = 0;
  env.bakeProbe = () => { cuissons += 1; };
  const c = { node: { id: 3 } };
  env.writeField(champ(env, 'Reflection', 'f-probe-res'), [c], '256');
  assert.equal(s.resolution, 256);
  assert.equal(cuissons, 1);
});

// ---------- Tilemap ----------

test('Tilemap : le compte de BOITES de collision est ce qui compte, pas les cases', () => {
  // Le solveur teste des bandes regroupees : mille cases alignees font une bande, mille cases
  // eparpillees en font mille. C est le seul chiffre qui dit le cout reel.
  const env = neuf();
  env.assets = [];
  env.layers2dOfProject = () => ['Décor'];
  // Les bandes QUI BLOQUENT (`collidingBands` retire celles des tuiles « Aucune ») : le
  // chiffre affiché est ce que le solveur verra, pas ce que la grille contient.
  env.collidingBands = () => [1, 2, 3];
  const c = { node: { id: 4 }, cells: [0, 1, 1, 0, 2], width: 32, height: 18, cellSize: 0.5 };
  const info = env.planForm(descr(env, 'Tilemap'), [c]).sections
    .reduce((a, s) => a.concat(s.entries), []).find((e) => e.ids && e.ids[0] === 'tm-count');
  assert.ok(/3 case\(s\) posée\(s\)/.test(info.value));
  assert.ok(/3 boîte\(s\) de collision/.test(info.value));
});

test('Tilemap : redimensionner REDIMENSIONNE, ca ne refait pas la map', () => {
  // Une map vide de remplacement ferait perdre le decor deja peint, et un Ctrl+Z sur une
  // taille tapee par erreur n est pas un reflexe.
  const env = neuf();
  env.assets = [];
  env.layers2dOfProject = () => ['Décor'];
  env.bandsCollision = () => [];
  let appels = [];
  env.resizeMap = (c, w, h) => { appels.push([w, h]); c.width = w; c.height = h; };
  env.rebuildTilemap = () => {};
  const c = { node: { id: 4 }, cells: [], width: 32, height: 18, cellSize: 0.5 };
  env.writeField(champ(env, 'Tilemap', 'f-tm-width'), [c], 40);
  assert.deepEqual(Array.from(appels[0]), [40, 18], 'seule la largeur change');
  env.writeField(champ(env, 'Tilemap', 'f-tm-height'), [c], 24);
  assert.deepEqual(Array.from(appels[1]), [40, 24]);
});

test('Tilemap : une taille invalide ne redimensionne RIEN', () => {
  const env = neuf();
  env.assets = [];
  env.layers2dOfProject = () => ['Décor'];
  env.bandsCollision = () => [];
  let appels = 0;
  env.resizeMap = () => { appels += 1; };
  env.rebuildTilemap = () => {};
  const c = { node: { id: 4 }, cells: [], width: 32, height: 18, cellSize: 0.5 };
  env.writeField(champ(env, 'Tilemap', 'f-tm-width'), [c], 0);
  assert.equal(appels, 0, 'une grille de zero colonne n a pas de sens');
});

// ---------- Events ----------
//
// Le seul composant dont la vue tient ENTIÈREMENT dans des listes, et la seule à en imbriquer
// une dans l'autre : une règle « Quand… » porte ses actions. C'est ce cas qui a décidé du
// contrat de liste, et c'est lui qui le vérifie.

function porteurEvents(events){ return { node: { userData: { events: events } } }; }

function listeEvents(env, c){
  return env.planForm(descr(env, 'Events'), [c]).sections[0].entries[0];
}

test('Events : une ligne par regle, ses actions dans une liste imbriquee', () => {
  const env = neuf();
  const c = porteurEvents([{ when: 'startup', param: '', actions: [
    { type: 'montrer', target: '', value: '' }, { type: 'wait', target: '', value: '2' }] }]);
  const l = listeEvents(env, c);
  assert.equal(l.kind, 'list');
  assert.equal(l.rows.length, 1);
  const actions = l.rows[0].entries[l.rows[0].entries.length - 1];
  assert.equal(actions.kind, 'list');
  assert.equal(actions.rows.length, 2);
  assert.equal(actions.rows[1].entries[0].value, 'wait');
  assert.equal(actions.rows[1].entries[2].value, '2');
});

test('Events : le parametre n apparait que pour les Quand qui en ont un', () => {
  const env = neuf();
  const vu = (when) => Array.from(listeEvents(env, porteurEvents([{ when: when, actions: [] }]))
    .rows[0].entries.filter((e) => e.kind === 'field').map((e) => e.ids[0]));
  assert.deepEqual(vu('startup'), ['f-ev-0-when'], 'au demarrage ne guette rien');
  assert.deepEqual(vu('click'), ['f-ev-0-when']);
  assert.deepEqual(vu('entreeTrigger'), ['f-ev-0-when', 'f-ev-0-param']);
  assert.deepEqual(vu('event'), ['f-ev-0-when', 'f-ev-0-param']);
});

test('Events : le libelle du parametre dit ce qu on attend', () => {
  const env = neuf();
  const label = (when) => listeEvents(env, porteurEvents([{ when: when, actions: [] }]))
    .rows[0].entries[1].label;
  assert.equal(label('sortieTrigger'), 'Tag guette'.replace('guette', 'guetté'));
  assert.equal(label('event'), 'Événement');
});

test('Events : ajouter une action ecrit sur SA regle, pas sur la voisine', () => {
  const env = neuf();
  const c = porteurEvents([{ when: 'startup', actions: [] }, { when: 'click', actions: [] }]);
  const l = listeEvents(env, c);
  l.rows[1].entries[l.rows[1].entries.length - 1].onAdd(l.rows[1].item);
  assert.equal(c.node.userData.events[0].actions.length, 0);
  assert.equal(JSON.stringify(c.node.userData.events[1].actions),
               JSON.stringify([{ type: 'montrer', target: '', value: '' }]));
});

test('Events : une regle neuve part de au demarrage, rendre visible', () => {
  const env = neuf();
  const c = porteurEvents([]);
  listeEvents(env, c).onAdd(c);
  // JSON, et pas deepEqual : l'objet est créé DANS le contexte vm, donc son prototype n'est
  // pas celui de ce fichier — la comparaison stricte le refuserait pour cette seule raison.
  assert.equal(JSON.stringify(c.node.userData.events),
               JSON.stringify([{ when: 'startup', param: '',
                                 actions: [{ type: 'montrer', target: '', value: '' }] }]));
});

test('Events : retirer une regle retire CELLE-LA', () => {
  const env = neuf();
  const c = porteurEvents([{ when: 'startup', actions: [] }, { when: 'click', actions: [] }]);
  listeEvents(env, c).onRemove(c, 0);
  assert.equal(c.node.userData.events.length, 1);
  assert.equal(c.node.userData.events[0].when, 'click');
});

test('Events : les onze actions et les cinq declencheurs sont toujours proposes', () => {
  const env = neuf();
  const l = listeEvents(env, porteurEvents([{ when: 'startup', actions: [{ type: 'montrer' }] }]));
  assert.equal(l.rows[0].entries[0].options.length, 5);
  const actions = l.rows[0].entries[l.rows[0].entries.length - 1];
  assert.equal(actions.rows[0].entries[0].options.length, 11);
});

// ---------- AnimatorController ----------
//
// La dernière vue, et la seule dont les SECTIONS dépendent de ce qu'un autre écran a
// sélectionné : le graphe. Trois formes possibles pour un seul composant — la machine seule,
// l'état choisi, la transition choisie — et c'est `sections(target)` qui les exprime.

function envAnimator(){
  const env = creerContexte(['js/ui/registry.js', 'js/ui/form-plan.js', 'js/ui/fields.js',
                             'js/animator.js', 'js/ui/panels-components.js']);
  env.assets = [];
  env.graphAnim = undefined;
  return env;
}

function porteurAnimator(env, machine, opts){
  const asset = { id: 'a1', kind: 'animator', name: 'perso', machine: machine };
  env.assets.push(asset);
  return Object.assign({ data: { assetId: 'a1' }, node: { id: 7, name: 'Perso' },
                         asset: asset, machine: machine, target: { name: 'Armature' } },
                       opts || {});
}

function idsPlan(env, c){
  const p = env.planForm(env.ComponentPanels.AnimatorController, [c]);
  const out = [];
  p.sections.forEach((s) => s.entries.forEach((e) => {
    if(e.kind === 'field' || e.kind === 'action') out.push(e.ids[0]);
  }));
  return out;
}

test('AnimatorController : sans machine, on propose d en creer une — et rien d autre', () => {
  const env = envAnimator();
  const c = { data: {}, node: { id: 7, name: 'Perso' }, asset: null, machine: null, target: null };
  assert.deepEqual(idsPlan(env, c), ['f-anim-ctrl-asset', 'btn-animctrl-create']);
});

test('AnimatorController : avec une machine mais rien de selectionne, le composant seul', () => {
  const env = envAnimator();
  const c = porteurAnimator(env, { states: [], transitions: [], params: [] });
  assert.deepEqual(idsPlan(env, c),
    ['f-anim-ctrl-asset', 'f-anim-ctrl-target', 'f-anim-ctrl-root',
     'btn-animctrl-open', 'btn-animctrl-edit']);
});

test('AnimatorController : l etat selectionne dans le graphe s edite ICI', () => {
  const env = envAnimator();
  const etat = { name: 'marche', speed: 1, loop: true };
  const m = { states: [etat], transitions: [], params: [], start: 'marche' };
  const c = porteurAnimator(env, m);
  env.graphAnim = { asset: c.asset, stateSel: etat, transSel: null };
  const ids = idsPlan(env, c);
  assert.ok(ids.includes('f-gr-state-name'));
  assert.ok(ids.includes('f-gr-state-anim'), 'pas de melange : on choisit une animation');
  assert.ok(!ids.includes('f-gr-state-blendparam'));
  assert.ok(ids.includes('f-gr-state-start'));
});

test('AnimatorController : le graphe ouvert sur une AUTRE machine ne selectionne rien ici', () => {
  const env = envAnimator();
  const etat = { name: 'marche' };
  const c = porteurAnimator(env, { states: [etat], transitions: [], params: [] });
  env.graphAnim = { asset: { id: 'autre' }, stateSel: etat, transSel: null };
  assert.ok(!idsPlan(env, c).includes('f-gr-state-name'));
});

test('AnimatorController : cocher Melange garde le clip deja choisi comme premier point', () => {
  const env = envAnimator();
  const etat = { name: 'marche', clip: 'Walk' };
  const m = { states: [etat], transitions: [], params: [{ name: 'vitesse', type: 'float' }] };
  const c = porteurAnimator(env, m);
  env.graphAnim = { asset: c.asset, stateSel: etat, transSel: null };
  const plan = env.planForm(env.ComponentPanels.AnimatorController, [c]);
  const melange = plan.sections[1].entries.find((e) => e.ids && e.ids[0] === 'f-gr-state-blend');
  melange.field.set(c, true);
  assert.equal(etat.blend.param, 'vitesse');
  assert.equal(etat.blend.points.length, 1);
  assert.equal(etat.blend.points[0].clip, 'Walk');
  // Et l'inverse rend son clip à l'état, au lieu de le renvoyer à « aucun clip ».
  delete etat.clip;
  melange.field.set(c, false);
  assert.equal(etat.clip, 'Walk');
  assert.equal(etat.blend, undefined);
});

test('AnimatorController : renommer un etat renomme ce qui le CITE', () => {
  const env = envAnimator();
  const etat = { name: 'marche' };
  const m = { states: [etat, { name: 'course' }], start: 'marche',
              transitions: [{ de: 'marche', vers: 'course' }, { de: 'course', vers: 'marche' }],
              params: [] };
  const c = porteurAnimator(env, m);
  env.graphAnim = { asset: c.asset, stateSel: etat, transSel: null };
  const plan = env.planForm(env.ComponentPanels.AnimatorController, [c]);
  plan.sections[1].entries[0].field.set(c, 'avance');
  assert.equal(etat.name, 'avance');
  assert.equal(m.start, 'avance');
  assert.equal(m.transitions[0].de, 'avance');
  assert.equal(m.transitions[1].vers, 'avance');
});

test('AnimatorController : renommer vers un nom DEJA pris ne renomme rien', () => {
  const env = envAnimator();
  const etat = { name: 'marche' };
  const m = { states: [etat, { name: 'course' }], transitions: [], params: [] };
  const c = porteurAnimator(env, m);
  env.graphAnim = { asset: c.asset, stateSel: etat, transSel: null };
  const plan = env.planForm(env.ComponentPanels.AnimatorController, [c]);
  plan.sections[1].entries[0].field.set(c, 'course');
  assert.equal(etat.name, 'marche');
});

function planTransition(env, params, trans){
  const m = { states: [{ name: 'a' }, { name: 'b' }], transitions: [trans], params: params };
  const c = porteurAnimator(env, m);
  env.graphAnim = { asset: c.asset, stateSel: null, transSel: trans };
  return { c: c, plan: env.planForm(env.ComponentPanels.AnimatorController, [c]) };
}

test('AnimatorController : l instant de sortie est INERTE tant que la fin du clip n est pas exigee', () => {
  const r = planTransition(envAnimator(), [], { de: 'a', vers: 'b' });
  const exit = r.plan.sections[1].entries.find((e) => e.ids && e.ids[0] === 'f-gr-tr-exit');
  assert.equal(exit.enabled, false);
  assert.ok(exit.reason, 'un champ grise dit pourquoi');
  const r2 = planTransition(envAnimator(), [], { de: 'a', vers: 'b', awaitEnd: true });
  assert.equal(r2.plan.sections[1].entries.find((e) => e.ids && e.ids[0] === 'f-gr-tr-exit').enabled,
               true);
});

test('AnimatorController : le libelle du fondu dit son UNITE, et change avec les cases', () => {
  const lab = (t) => {
    const r = planTransition(envAnimator(), [], Object.assign({ de: 'a', vers: 'b' }, t));
    return r.plan.sections[1].entries.find((e) => e.ids && e.ids[0] === 'f-gr-tr-duration').label;
  };
  assert.equal(lab({}), 'Fondu (s)');
  assert.equal(lab({ durationFixe: false }), 'Fondu (×clip)');
  assert.equal(lab({ inertia: true }), 'Résorption (s)');
});

test('AnimatorController : sans parametre declare, il n y a rien a tester', () => {
  const r = planTransition(envAnimator(), [], { de: 'a', vers: 'b', conditions: [] });
  const conds = r.plan.sections[2].entries;
  assert.equal(conds.length, 1);
  assert.equal(conds[0].kind, 'note');
});

test('AnimatorController : une condition booleenne propose EST, pas PLUS GRAND QUE', () => {
  const r = planTransition(envAnimator(), [{ name: 'ausol', type: 'bool' }],
    { de: 'a', vers: 'b', conditions: [{ param: 'ausol', operateur: '==', value: true }] });
  const liste = r.plan.sections[2].entries[0];
  assert.equal(liste.kind, 'list');
  const ops = liste.rows[0].entries[1].options.map((o) => o[0]);
  assert.deepEqual(Array.from(ops), ['==', '!=']);
  // Et sa valeur est un choix vrai/faux, pas un nombre.
  assert.equal(liste.rows[0].entries[2].type, 'choice');
});

test('AnimatorController : un declencheur n a PAS de valeur a comparer', () => {
  const r = planTransition(envAnimator(), [{ name: 'saut', type: 'trigger' }],
    { de: 'a', vers: 'b', conditions: [{ param: 'saut', operateur: 'declenche' }] });
  assert.equal(r.plan.sections[2].entries[0].rows[0].entries.length, 2);
});

test('AnimatorController : changer de parametre ramene l operateur a un operateur VALIDE', () => {
  const cond = { param: 'vitesse', operateur: '<', value: 2 };
  const r = planTransition(envAnimator(), [{ name: 'vitesse', type: 'float' },
                                           { name: 'saut', type: 'trigger' }],
                           { de: 'a', vers: 'b', conditions: [cond] });
  const ligne = r.plan.sections[2].entries[0].rows[0];
  ligne.entries[0].field.set(cond, 'saut');
  assert.equal(cond.param, 'saut');
  assert.equal(cond.operateur, 'declenche', 'un « < » sur un declencheur ne veut rien dire');
});

test('AnimatorController : ajouter puis retirer une condition', () => {
  const trans = { de: 'a', vers: 'b' };
  const r = planTransition(envAnimator(), [{ name: 'vitesse', type: 'float' }], trans);
  const liste = r.plan.sections[2].entries[0];
  liste.onAdd(r.c);
  assert.equal(trans.conditions.length, 1);
  assert.equal(trans.conditions[0].param, 'vitesse');
  assert.equal(trans.conditions[0].operateur, '>');
  liste.onRemove(r.c, 0);
  assert.equal(trans.conditions.length, 0);
});
