// moteur/test/anim-asset.test.mjs
//
// L'asset d'animation : résolution, découpe, validation, migration depuis l'ancien `clip`.
// js/anim-asset.js ne connaît ni three ni le DOM — il se charge donc seul, sans le harnais
// navigateur, comme js/animator.js dans animator.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerContexte } from './engine-env.mjs';

const env = creerContexte(['js/anim-asset.js']);
const {
  resolveAnimAsset, validateAnimAsset, boundsAnimAsset, markersAdjusted,
  nameClipDerived, animationOfLState, migrateStatesToAnimAssets
} = env;

/** Ramène un objet du contexte `vm` dans ce realm-ci : deepEqual compare aussi les prototypes. */
const nu = (o) => JSON.parse(JSON.stringify(o));

/** Un jeu d'assets minimal : un modèle qui porte deux clips, et l'asset d'animation qui aims. */
function world(settings){
  const model = {
    id: 'm1', kind: 'model', name: 'Perso',
    template: { animations: [{name: 'Walk', duration: 2}, {name: 'Idle', duration: 4}] }
  };
  const anim = Object.assign({
    id: 'a1', kind: 'animation', name: 'Marche',
    source: { asset: 'm1', clip: 'Walk' }
  }, settings || {});
  const list = [model, anim];
  const find = (id) => list.find((x) => x.id === id) || null;
  return { model, anim, list, find };
}

// ---------- résolution ----------

test('un asset d\'animation se résout en clip + réglages, avec les défauts d\'Unity', () => {
  const w = world();
  const r = resolveAnimAsset(w.anim, w.find);
  assert.equal(r.clip, 'Walk');
  assert.equal(r.model, 'm1');
  assert.equal(r.speed, 1, 'la vitesse par défaut est 1');
  assert.equal(r.loop, true, 'un clip loop par défaut');
  assert.equal(r.start, 0);
  assert.equal(r.end, null, 'end nulle = jusqu\'au bout du clip');
});

test('les réglages écrits l\'emportent sur les défauts', () => {
  const w = world({ speed: 1.5, loop: false, start: 0.5, end: 1.5 });
  const r = resolveAnimAsset(w.anim, w.find);
  assert.equal(r.speed, 1.5);
  assert.equal(r.loop, false);
  assert.deepEqual([r.start, r.end], [0.5, 1.5]);
});

test('un asset sans source, ou dont le modèle a disparu, ne se résout pas', () => {
  const w = world();
  assert.equal(resolveAnimAsset({ id: 'a2', kind: 'animation' }, w.find), null);
  assert.equal(resolveAnimAsset({ id: 'a2', kind: 'animation', source: { asset: 'nexistepas', clip: 'Walk' } },
    w.find), null);
  assert.equal(resolveAnimAsset(null, w.find), null);
});

test('une vitesse nulle ou négative retombe à 1 plutôt que de figer le personnage', () => {
  // Une vitesse 0 arrête le clip sans rien dire : c'est indiscernable d'un bug de la machine.
  assert.equal(resolveAnimAsset(world({ speed: 0 }).anim, world().find).speed, 1);
  assert.equal(resolveAnimAsset(world({ speed: -2 }).anim, world().find).speed, 1);
});

// ---------- découpe ----------

test('la découpe est bornée par la durée réelle du clip', () => {
  assert.deepEqual(nu(boundsAnimAsset({ start: 0.5, end: 1.5 }, 2)), { start: 0.5, end: 1.5 });
  assert.deepEqual(nu(boundsAnimAsset({ start: 0, end: null }, 2)), { start: 0, end: 2 },
    'end nulle = durée du clip');
  assert.deepEqual(nu(boundsAnimAsset({ start: -1, end: 99 }, 2)), { start: 0, end: 2 },
    'des bounds hors du clip sont ramenées dedans');
});

test('une découpe vide ou inversée rend le clip entier', () => {
  // Mieux vaut play tout le clip que rien du tout : un clip de durée nulle ne se voit pas,
  // alors qu'un clip trop long se voit et se corrige.
  assert.deepEqual(nu(boundsAnimAsset({ start: 1.5, end: 0.5 }, 2)), { start: 0, end: 2 });
  assert.deepEqual(nu(boundsAnimAsset({ start: 1, end: 1 }, 2)), { start: 0, end: 2 });
});

test('un clip découpé porte un nom dérivé, stable et propre à l\'asset', () => {
  const n = nameClipDerived('Walk', 'a1');
  assert.notEqual(n, 'Walk', 'sinon il écraserait le clip source dans la liste de l\'object');
  assert.equal(n, nameClipDerived('Walk', 'a1'), 'le même couple donne toujours le même nom');
  assert.notEqual(n, nameClipDerived('Walk', 'a2'));
});

// ---------- markers ----------

test('les markers suivent la découpe : décalés, et ceux du dehors disparaissent', () => {
  const list = [{ t: 0.2, event: 'pas' }, { t: 1.0, event: 'pas' }, { t: 1.8, event: 'pas' }];
  const r = markersAdjusted(list, 0.5, 1.5);
  assert.equal(r.length, 1, 'seul le marker à 1.0 est dans [0.5, 1.5]');
  assert.equal(r[0].t, 0.5, 'il est exprimé dans le temps du clip découpé');
  assert.equal(r[0].event, 'pas', 'le reste du marker est intact');
});

test('sans découpe, les markers passent tels quels', () => {
  const list = [{ t: 0.2, event: 'pas' }];
  assert.deepEqual(nu(markersAdjusted(list, 0, null)), list);
});

// ---------- validation ----------

test('la validation nomme ce qui manque, en clair', () => {
  const w = world();
  assert.deepEqual(nu(validateAnimAsset(w.anim, w.find)), [], 'un asset correct ne dit rien');

  // `type: 'model'` explicite : sans source du tout, l'asset est un clip à clés empty, et c'est
  // d'un manque de clés que la validation doit alors se plaindre (voir plus bas).
  const sansSource = validateAnimAsset(
    { id: 'a2', kind: 'animation', name: 'X', source: { type: 'model' } }, w.find);
  assert.equal(sansSource.length, 1);
  assert.match(sansSource[0], /mod[èe]le/i);

  const clipAbsent = validateAnimAsset(
    { id: 'a2', kind: 'animation', name: 'X', source: { asset: 'm1', clip: 'Courir' } }, w.find);
  assert.equal(clipAbsent.length, 1);
  assert.match(clipAbsent[0], /Courir/);
});

// ---------- link état -> animation ----------

test('un état désigne son animation par asset, et retombe sur l\'ancien clip', () => {
  const m = { states: [{ name: 'Idle', animation: 'a1' }, { name: 'Vieux', clip: 'Walk' }] };
  assert.deepEqual(nu(animationOfLState(m, 'Idle')), { animation: 'a1', clip: null });
  assert.deepEqual(nu(animationOfLState(m, 'Vieux')), { animation: null, clip: 'Walk' },
    'un project d\'avant la v0.52 continue de jouer');
  assert.deepEqual(nu(animationOfLState(m, 'Absent')), { animation: null, clip: null });
});

// ---------- migration ----------

test('la migration bascule les vieux états sur des assets, sans en dupliquer', () => {
  const m = { states: [{ name: 'A', clip: 'Walk' }, { name: 'B', clip: 'Walk' }, { name: 'C', clip: 'Idle' }] };
  const crees = [];
  let n = 0;
  const migres = migrateStatesToAnimAssets(m, {
    model: 'm1',
    clipsConnus: ['Walk', 'Idle'],
    findOrCreate(model, clip){
      const deja = crees.find((c) => c.model === model && c.clip === clip);
      if(deja) return deja.id;
      const c = { id: 'aa' + (++n), model, clip };
      crees.push(c);
      return c.id;
    }
  });
  assert.equal(migres, 3);
  assert.equal(crees.length, 2, 'deux états sur le même clip partagent le même asset');
  assert.equal(m.states[0].animation, m.states[1].animation);
  assert.equal(m.states[0].clip, 'Walk', 'le champ d\'origine reste, comme repli');
});

test('la migration est idempotente', () => {
  const m = { states: [{ name: 'A', clip: 'Walk' }] };
  const ctx = { model: 'm1', clipsConnus: ['Walk'], findOrCreate: () => 'aa1' };
  assert.equal(migrateStatesToAnimAssets(m, ctx), 1);
  assert.equal(migrateStatesToAnimAssets(m, ctx), 0, 'rien à refaire au second passage');
});

test('un clip que le modèle ne connaît pas n\'est pas migré', () => {
  // Le cas d'une machine partagée par deux modèles : « marche » n'y désigne pas le même clip.
  // Deviner reviendrait à recâbler en silence l'animation d'un personnage sur celle d'un autre.
  const m = { states: [{ name: 'A', clip: 'Walk' }] };
  const migres = migrateStatesToAnimAssets(m, {
    model: 'm1', clipsConnus: ['Idle'], findOrCreate: () => 'aa1'
  });
  assert.equal(migres, 0);
  assert.equal(m.states[0].animation, undefined);
});

test('les points d\'un mélange 1D migrent aussi', () => {
  const m = { states: [{ name: 'Locomotion', blend: { param: 'v', points: [
    { value: 0, clip: 'Idle' }, { value: 1, clip: 'Walk' }] } }] };
  const migres = migrateStatesToAnimAssets(m, {
    model: 'm1', clipsConnus: ['Idle', 'Walk'],
    findOrCreate: (model, clip) => 'aa-' + clip
  });
  assert.equal(migres, 2);
  assert.equal(m.states[0].blend.points[1].animation, 'aa-Walk');
});

// ---------- clips à clés (source « keys ») ----------

const { typeSourceAnim, isAnimAKeys, segmentOfTrack, durationAnimAKeys,
        nameTrackThree, dataClipAKeys, applyEasingAnim } = env;

/** slerp de remplacement : linéaire, suffisant pour vérifier le CÂBLAGE, pas la rotation. */
const slerpFactice = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);

function clipACles(tracks, settings){
  return Object.assign({id:'a9', kind:'animation', name:'Saut', source:{type:'keys'},
                        duration:1, imagesBySeconde:10, tracks:tracks}, settings || {});
}
function track(filePath, keys, os){ return {filePath:filePath, os:os || null, keys:keys}; }
function key(t, x, easing){
  return {t:t, pos:[x, 0, 0], quat:[0, 0, 0, 1], ech:[1, 1, 1], easing:easing};
}

test('le type de source se devine pour les assets écrits avant la v0.53', () => {
  assert.equal(typeSourceAnim({source:{asset:'m1', clip:'Walk'}}), 'model',
    'une source sans `type` mais avec un modèle reste une référence');
  assert.equal(typeSourceAnim({source:{type:'keys'}}), 'keys');
  assert.equal(isAnimAKeys({source:{}}), true, 'sans rien, c\'est un clip vide à remplir');
});

test('un clip à clés se résout sans modèle, et pas s\'il est vide', () => {
  const r = resolveAnimAsset(clipACles([track('', [key(0, 0), key(1, 5)])]), null);
  assert.equal(r.type, 'keys');
  assert.equal(r.model, null, 'il ne dépend d\'aucun fichier importé');
  assert.equal(r.loop, true);
  assert.equal(resolveAnimAsset(clipACles([]), null), null,
    'sans clé, il donnerait une AnimationClip sans piste : muette et sans erreur');
});

test('la durée est celle de la dernière clé, jamais moins que la durée déclarée', () => {
  assert.equal(durationAnimAKeys(clipACles([track('', [key(0, 0), key(2.5, 5)])], {duration:1})), 2.5,
    'une clé au-delà de la durée déclarée ne doit pas être coupée');
  assert.equal(durationAnimAKeys(clipACles([track('', [key(0, 0), key(0.5, 5)])], {duration:3})), 3);
});

test('le nom de piste three suit le relativePath d\'Unity', () => {
  assert.equal(nameTrackThree({filePath:'', os:null}, 'position'), '.position',
    'filePath empty = la racine du mixeur, comme le relativePath empty d\'Unity');
  assert.equal(nameTrackThree({filePath:'Bras/Main', os:null}, 'scale'), 'Bras/Main.scale');
  assert.equal(nameTrackThree({filePath:'Bras', os:'mixamorig:Head'}, 'quaternion'),
    'mixamorig:Head.quaternion', 'un os court-circuite le fichierPath : three le résout par son nom');
});

test('la courbe d\'accélération est portée par la clé de DÉPART du segment', () => {
  const keys = [key(0, 0, 'palier'), key(1, 10)];
  assert.equal(segmentOfTrack(keys, 0.5).alpha, 0, 'un palier ne bouge qu\'à la clé suivante');
  // Sur la dernière clé, le segment se réduit à elle-même : c'est ELLE qui donne la pose, et
  // `alpha` n'a plus rien à interpoler.
  const end = segmentOfTrack(keys, 1);
  assert.equal(end.avant, end.apres);
  assert.equal(end.avant.pos[0], 10);
  assert.equal(applyEasingAnim('douce', 0.5), 0.5);
  assert.equal(applyEasingAnim('acc', 0.5), 0.25);
});

test('la compilation rend trois pistes three par piste, échantillonnées à la cadence', () => {
  const d = dataClipAKeys(clipACles([track('', [key(0, 0), key(1, 10)])]), slerpFactice);
  assert.equal(d.duration, 1);
  assert.equal(d.tracks.length, 3, 'position, quaternion, échelle');
  assert.deepEqual(nu(d.tracks.map((p) => p.name)), ['.position', '.quaternion', '.scale']);
  const pos = d.tracks[0];
  assert.equal(pos.time.length, 11, '1 s à 10 images/s = 11 échantillons, bounds comprises');
  assert.equal(pos.values.length, 33, '3 composantes par échantillon');
  assert.equal(pos.values[0], 0);
  assert.ok(Math.abs(pos.values[15] - 5) < 1e-6, 'à mi-course, la valeur est à mi-filePath');
  assert.equal(pos.values[30], 10);
});

test('une piste sans clé est ignorée à la compilation, pas rendue empty', () => {
  const d = dataClipAKeys(clipACles([track('', []), track('Bras', [key(0, 0), key(1, 1)])]),
    slerpFactice);
  assert.equal(d.tracks.length, 3);
  assert.equal(d.tracks[0].name, 'Bras.position');
});

test('la validation d\'un clip à clés nomme le vide et la piste à une seule clé', () => {
  assert.match(nu(validateAnimAsset(clipACles([]), null))[0], /aucune clé/);
  const un = nu(validateAnimAsset(clipACles([track('Bras', [key(0, 0)])]), null));
  assert.equal(un.length, 1);
  assert.match(un[0], /Bras/);
  assert.deepEqual(nu(validateAnimAsset(clipACles([track('', [key(0, 0), key(1, 1)])]), null)), []);
});
