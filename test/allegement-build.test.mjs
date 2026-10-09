import { deEsm } from './engine-env.mjs';
// L'allègement d'un jeu publié : ne pas embarquer ce que la scène n'utilise pas.
//
// Le test qui porte le fichier est celui de la DIRECTION : pour chaque module facultatif, une scène
// qui utilise sa fonctionnalité doit l'embarquer. Se tromper dans ce sens publie un jeu qui lève une
// error au premier clic, chez le joueur, sur un fichier qu'on croyait inutile — la famille de défaut
// la plus coûteuse de ce dépôt. Se tromper dans l'autre sens ne coûte que des kilo-octets.
//
// D'où une règle qui traverse tout le fichier : EN CAS DE DOUTE, ON EMBARQUE.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { embeddedInBuild } from './build-modules.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const hote = (x) => JSON.parse(JSON.stringify(x));

function contexte(){
  const bac = {console, Math, JSON, Number, String, Object, Array, isFinite};
  bac.window = bac; bac.self = bac; bac.globalThis = bac;
  const ctx = vm.createContext(bac);
  vm.runInContext(deEsm(read('js/build-trimming.js')), ctx, {filename: 'js/build-trimming.js'});
  return ctx;
}

/** Un project sérialisé d'une scène, tel que `buildDataProject` le produit. */
const project = (objects) => ({version: 14, scenes: [{name: 'S', data: {objects: objects}}], assets: []});

// Chaque fonctionnalité, l'objet qui l'utilise, et les fichiers que ça DOIT embarquer.
// Le cas « animation jouée » (`o.anim`, réglage « au lancement ») a disparu de cette liste : le
// mécanisme `userData.anim`/`PANEL_ANIMATIONS` est mort (retiré par la tâche 3.4 du plan
// animator) — aucune donnée réelle n'écrit plus jamais ce champ.
const CAS = [
  {quoi: 'corps rigide 3D',       object: {type: 'mesh', phys: {masse: 1}},        exige: ['vendor/cannon.js']},
  {quoi: 'collider 3D seul',      object: {type: 'mesh', collider: {shape: 'box'}}, exige: ['vendor/cannon.js']},
  {quoi: 'animation empruntée',   object: {type: 'model', components: [{type: 'SkinnedMeshRenderer',
    data: {externalClips: [{assetId: 'marche', sourceClip: 'mixamo.com', localName: 'marche'}]}}]},
   exige: ['js/retargeting.js']},
  {quoi: 'niveau de détail',      object: {type: 'mesh', detail: {seuils: [10]}},  exige: ['js/render-perf.js']},
  {quoi: 'body 2D',              object: {type: 'group', body2d: {}},           exige: ['js/physics-2d.js', 'js/world-2d.js']},
  {quoi: 'collider 2D',           object: {type: 'group', collider2d: {l: 1, h: 1}}, exige: ['js/physics-2d.js', 'js/world-2d.js']},
  {quoi: 'contrôleur 2D',         object: {type: 'group', controller2d: {speed: 6}}, exige: ['js/physics-2d.js', 'js/world-2d.js']},
  {quoi: 'sprite',                object: {type: 'group', sprite2d: {spriteId: 'a1'}}, exige: ['js/sprite-2d.js']},
  {quoi: 'animateur de sprite',   object: {type: 'group', animSprite: {}},        exige: ['js/anim-sprite.js', 'js/sprite-2d.js']},
  {quoi: 'caméra 2D',             object: {type: 'camera', components: [{type: 'Camera', data: {projection: 'orthographic', mode: 'width'}}]}, exige: ['js/camera-framing.js']},
  // Une TILEMAP exige le solveur 2D : elle produit des obstacles même si aucun objet ne porte de
  // body. Un jeu de puzzle fait d'un décor de tuiles n'aurait sinon rien qui collisionne.
  {quoi: 'map de tuiles',       object: {type: 'group', components: [{type: 'Tilemap', data: {width: 4, height: 4}}]},
   exige: ['js/tilemap.js', 'js/sprite-2d.js', 'js/physics-2d.js', 'js/world-2d.js']},

  // --- Les huit du second relevé ---
  {quoi: 'machine à états',       object: {type: 'model', animator: {machine: {states: []}}},
   exige: ['js/animator.js', 'js/anim-blend.js', 'js/anim-asset.js', 'js/anim-markers.js']},
  {quoi: 'modèle importé',        object: {type: 'model', asset: 'a1'},
   exige: ['js/anim-asset.js', 'js/anim-markers.js']},
  {quoi: 'script api.animator',   object: {type: 'mesh', scripts: [{code: 'api.animator().play("x");'}]},
   exige: ['js/animator.js']},
  {quoi: 'script multijoueur',    object: {type: 'mesh', scripts: [{code: 'if(api.isAuthority()) rien();'}]},
   exige: ['js/network-game.js']},
  {quoi: 'script api.network',     object: {type: 'mesh', scripts: [{code: 'api.network.envoyer("x");'}]},
   exige: ['js/network-game.js']},
  {quoi: 'script personnage',     object: {type: 'mesh', scripts: [{code: 'api.moveCharacter({});'}]},
   exige: ['js/game-character.js']},
  {quoi: 'script rebondir',       object: {type: 'mesh', scripts: [{code: 'api.bounce(8);'}]},
   exige: ['js/game-character.js']},
  {quoi: 'atlas de lightmap',     object: {type: 'mesh', lightmapAtlas: {scale: [1, 1], offset: [0, 0]}},
   exige: ['js/lightmap-rgbm.js']},
  {quoi: 'évènement animator',    object: {type: 'mesh', events: [{when: 'start',
     actions: [{type: 'animatorParametre', name: 'speed', value: 1}]}]},
   exige: ['js/animator.js']}
];

/** Des cas où le besoin vient des ASSETS et non des objets. */
const CAS_ASSETS = [
  {quoi: 'asset d\'animation', assets: [{id: 'a1', kind: 'animation', name: 'Marche'}],
   exige: ['js/anim-asset.js', 'js/anim-markers.js']},
  {quoi: 'graphe de shader', assets: [{id: 'a2', kind: 'graphShader', name: 'Eau'}],
   exige: ['js/shader-graph.js']},
  {quoi: 'texture RGBM', assets: [{id: 'a3', kind: 'texture', name: 'Lightmap', rgbm: true}],
   exige: ['js/lightmap-rgbm.js']}
];

/** Des PISTES de scène comptent aussi comme animation. */
const CAS_PISTES = {exige: ['js/anim-asset.js', 'js/anim-markers.js']};

test('CHAQUE fonctionnalite embarque ce dont elle a besoin — le test qui porte le fichier', () => {
  const ctx = contexte();
  const manques = [];
  for(const cas of CAS){
    const a = ctx.trimmingBuild(project([cas.object]));
    const embarques = [...a.embarques];
    for(const f of cas.exige){
      if(embarques.indexOf(f) === -1){
        manques.push(cas.quoi + ' : ' + f + ' RETIRÉ alors qu\'il est nécessaire');
      }
    }
  }
  assert.deepEqual(manques, [],
    'Ces jeux publiés lèveraient une erreur chez le joueur, sur un fichier retiré à tort :\n'
    + manques.join('\n'));
});

test('LE BESOIN PEUT VENIR DES ASSETS, pas seulement des objets', () => {
  const ctx = contexte();
  const manques = [];
  for(const cas of CAS_ASSETS){
    const p = {version: 14, scenes: [{name: 'S', data: {objects: []}}], assets: cas.assets};
    const embarques = [...ctx.trimmingBuild(p).embarques];
    for(const f of cas.exige){
      if(embarques.indexOf(f) === -1) manques.push(cas.quoi + ' : ' + f + ' RETIRÉ à tort');
    }
  }
  assert.deepEqual(manques, [], manques.join('\n'));
});

test('UNE PISTE DE SCENE compte comme animation', () => {
  const ctx = contexte();
  // Une animation posée à la timeline, sans aucun asset ni animator : le runtime la joue quand même,
  // et le chemin qu'elle emprunte passe par anim-asset.js.
  const p = {version: 14, assets: [],
    scenes: [{name: 'S', data: {objects: [{type: 'mesh', name: 'Porte'}],
      tracks: [{target: 1, property: 'position', keys: [{t: 0, v: [0, 0, 0]}]}]}}]};
  const embarques = [...ctx.trimmingBuild(p).embarques];
  for(const f of CAS_PISTES.exige){
    assert.ok(embarques.indexOf(f) !== -1, f + ' RETIRÉ alors qu\'une piste de scène l\'utilise');
  }
});

test('LA RECHERCHE DANS LES SCRIPTS est volontairement GROSSIERE', () => {
  const ctx = contexte();
  const p = (code) => ({version: 14, assets: [],
    scenes: [{name: 'S', data: {objects: [{type: 'mesh', scripts: [{code: code}]}]}}]});
  // Un simple COMMENTAIRE qui contient le mot suffit à embarquer le module. C'est le sens de prudence
  // qu'on veut : un faux positif coûte 9 Ko, un faux négatif coûte un jeu cassé chez le joueur.
  const avecCommentaire = [...ctx.trimmingBuild(p('// TODO: passer en network plus tard\n')).embarques];
  assert.ok(avecCommentaire.indexOf('js/network-game.js') !== -1,
    'un commentaire citant « network » doit suffire a embarquer le module');
  // Et un script qui ne cite rien de tout ça ne les embarque pas.
  const sansRien = [...ctx.trimmingBuild(p('function update(api){ api.me.rotation.y += 0.01; }')).embarques];
  assert.equal(sansRien.indexOf('js/network-game.js'), -1);
  assert.equal(sansRien.indexOf('js/game-character.js'), -1);
  assert.equal(sansRien.indexOf('js/animator.js'), -1);
});

test('une scene qui n utilise RIEN de facultatif les retire TOUS', () => {
  const ctx = contexte();
  // Un nœud nu : rien de facultatif n'est atteignable, donc tout part.
  const a = ctx.trimmingBuild(project([{type: 'group', name: 'Vide'}]));
  assert.deepEqual([...a.embarques], [], 'rien ne devrait etre embarque : ' + JSON.stringify(hote(a.embarques)));
  assert.ok(a.retires.length >= 9, 'seulement ' + a.retires.length + ' modules retirés — la liste a-t-elle changé ?');
  // Chaque retrait porte SA RAISON. Sans elle, le message d'export dirait « allégé de 154 Ko » sans
  // dire de quoi, et un allègement qu'on ne peut pas relire est un allègement qu'on n'osera pas
  // garder allumé.
  for(const r of a.retires){
    assert.ok(r.pourquoi && r.pourquoi.length > 3, JSON.stringify(hote(r)) + ' : sans raison lisible');
    assert.ok(r.dans && r.dans.indexOf('.js') !== -1, JSON.stringify(hote(r)) + ' : sans nom de fichier dans le ZIP');
  }
});

test('un project 2D retire le 3D, un project 3D retire le 2D', () => {
  const ctx = contexte();
  // Le cas d'usage qui a motivé la fonctionnalité : un platformer en sprites ne doit pas télécharger
  // le moteur de physique 3D.
  const jeu2d = ctx.trimmingBuild(project([
    {type: 'group', root2d: true, space: '2d'},
    {type: 'group', sprite2d: {spriteId: 'a1'}, animSprite: {}, body2d: {}, collider2d: {l: 1, h: 1}},
    {type: 'group', components: [{type: 'Tilemap', data: {width: 32, height: 18}}]},
    {type: 'camera', components: [{type: 'Camera', data: {projection: 'orthographic', mode: 'width'}}]}
  ]));
  const r2d = [...jeu2d.retires].map((x) => x.file);
  assert.ok(r2d.indexOf('vendor/cannon.js') !== -1, 'un jeu 2D ne doit pas embarquer cannon');
  assert.ok(r2d.indexOf('js/retargeting.js') !== -1);
  assert.ok(r2d.indexOf('js/render-perf.js') !== -1);
  assert.equal([...jeu2d.embarques].indexOf('js/camera-framing.js') !== -1, true, 'la camera 2D est necessaire');

  const jeu3d = ctx.trimmingBuild(project([
    {type: 'mesh', phys: {masse: 1}, collider: {shape: 'box'}},
    {type: 'directional'},
    {type: 'camera', fov: 50}
  ]));
  const r3d = [...jeu3d.retires].map((x) => x.file);
  for(const f of ['js/sprite-2d.js', 'js/physics-2d.js', 'js/world-2d.js', 'js/anim-sprite.js',
                  'js/tilemap.js', 'js/camera-framing.js']){
    assert.ok(r3d.indexOf(f) !== -1, 'un jeu 3D ne doit pas embarquer ' + f);
  }
  assert.ok([...jeu3d.embarques].indexOf('vendor/cannon.js') !== -1, 'cannon est necessaire ici');
});

test('TOUTES LES SCENES comptent, pas seulement la premiere', () => {
  const ctx = contexte();
  // Un project dont la scène 1 est 3D et la scène 2 en sprites : le jeu publié contient les deux, donc
  // il a besoin des deux. Ne regarder que la première publierait un jeu où la scène 2 est cassée.
  const a = ctx.trimmingBuild({version: 14, scenes: [
    {name: 'Menu', data: {objects: [{type: 'mesh', phys: {masse: 1}}]}},
    {name: 'Niveau', data: {objects: [{type: 'group', sprite2d: {spriteId: 'a1'}}]}}
  ], assets: []});
  const e = [...a.embarques];
  assert.ok(e.indexOf('vendor/cannon.js') !== -1, 'la scene 1 a besoin de cannon');
  assert.ok(e.indexOf('js/sprite-2d.js') !== -1, 'la scene 2 a besoin des sprites');
});

test('LA PAGE ET LE ZIP sont d accord — pas de balise sans fichier, ni l inverse', () => {
  // Le seul défaut vraiment grave de cette fonctionnalité : la page demande un fichier que le ZIP ne
  // contient plus (404 au chargement), ou le ZIP porte un fichier que la page n'appelle plus (poids
  // mort). Les deux viennent d'une même table, et c'est ce qu'on vérifie ici.
  const build = read('js/build.js').replace(/\r\n/g, '\n');
  const alle = read('js/build-trimming.js').replace(/\r\n/g, '\n');

  // Les modules déclarés facultatifs, par leur nom DANS le ZIP.
  const declares = [...alle.matchAll(/dans:\s*'([^']+)'/g)].map((m) => m[1]);
  assert.ok(declares.length >= 9, 'seulement ' + declares.length + ' modules declares');

  const manques = [];
  for(const dans of declares){
    // La page doit l'émettre SOUS CONDITION — une balise en dur le publierait toujours, et le
    // file serait absent du ZIP : un 404 chez le joueur.
    if(!build.includes("emb('" + dans + "')")){
      manques.push(dans + ' : declare facultatif mais la balise est en dur dans pageIndexBuild()');
    }
    // Et il doit être dans la table du ZIP, pour qu'il y ait quelque chose à unregister.
    if(!embeddedInBuild(dans)) manques.push(dans + ' : absent de la table des modules du ZIP');
  }
  assert.deepEqual(manques, [], manques.join('\n'));

  // Et le retrait doit réellement supprimer l'entrée du ZIP, sinon on publierait le poids mort.
  assert.ok(/delete files\[r\.dans\]/.test(build),
    'le ZIP ne retire pas les modules alleges : la page ne les demande plus mais ils pesent encore');
});

test('LES GARDES DU RUNTIME existent pour les modules qu on retire', () => {
  // Un module ne devient facultatif que si le runtime survit à son absence. Deux gardes ont été
  // ajoutées exprès, et ce test les surveille : sans elles, le jeu publié tombe dès la première
  // image — `startPhysics` est appelé sans condition, l'animation de sprites à chaque image.
  const rt = read('js/game-runtime.js').replace(/\r\n/g, '\n');
  const corpsDe = (header) => {
    const i = rt.indexOf(header);
    assert.notEqual(i, -1, header + ' introuvable');
    const end = rt.indexOf('\n}\n', i);
    return rt.slice(i, end === -1 ? rt.length : end);
  };
  assert.ok(/typeof CANNON === 'undefined'/.test(corpsDe('function startPhysics()')),
    'startPhysics ne verifie pas la presence de CANNON : un jeu sans cannon.js tombe au demarrage');
  // L'animation de sprites n'a plus de miroir dans le runtime (v0.159.2) : c'est le composant
  // partagé qui tourne, via le SpriteAnimatorSystem. La garde a suivi — c'est LÀ qu'elle compte.
  const anim = read('js/components/component-anim-sprite.js').replace(/\r\n/g, '\n');
  const iAnim = anim.indexOf('export function updateAnimatorsSprite(');
  assert.notEqual(iAnim, -1, 'updateAnimatorsSprite introuvable');
  assert.ok(/typeof stepAnimSprites !== 'function'/.test(anim.slice(iAnim, anim.indexOf('\n}\n', iAnim))),
    'updateAnimatorsSprite ne verifie pas stepAnimSprites : un jeu sans anim-sprite.js tombe a chaque image');
  assert.ok(/typeof updateSortDepth2d === 'function'/.test(read('js/systems/sprite-system.js')),
    'le SpriteSystem ne verifie pas updateSortDepth2d : un jeu sans sprite-2d.js tombe a chaque image');
  // Et le pas du monde physique doit rester protégé : sans monde, `game.world.step` lèverait.
  assert.ok(/if\(game\.world\)\{/.test(rt), 'le pas physique n est plus protege par `if(game.world)`');

  // LES GARDES QUI EXISTAIENT DÉJÀ, et qui sont la vraie raison pour laquelle les huit derniers
  // modules ont pu devenir facultatifs. Elles ne sont pas nées de cette fonctionnalité : elles
  // protégeaient leur module sans que personne l'ait remarqué. Ce test les empêche de disparaître au
  // prochain nettoyage, parce que leur retrait ne casserait rien dans l'éditeur — seulement dans un
  // game publié allégé.
  assert.ok(/typeof updatePlayerAnimator !== 'function'/.test(corpsDe('function rtUpdateAnimators(dt)')),
    'rtUpdateAnimators ne verifie plus updatePlayerAnimator : un jeu sans animator.js tombe a chaque image');
  assert.ok(/if\(!rtAnims\.size\) return;/.test(corpsDe('function rtUpdateAnimations(dt)')),
    'rtUpdateAnimations ne sort plus tot quand il n y a aucune animation');
  assert.ok(/typeof triggerMarkers !== 'function'/.test(corpsDe('function rtMarkersDuringPlayback(')),
    'rtMarkersDuringPlayback ne verifie plus triggerMarkers : un jeu sans anim-markers.js tombe');

  // Et les deux valeurs de propriété du multijoueur : ce sont des CITATIONS, pas des appels
  // conditionnels, et citer un identifiant absent lève déjà. `apiFor` tourne pour chaque script.
  // Le CORPS de la fonction, pas une window de 14000 caracteres : add deux inputs d'API a
  // suffi a pousser estAutorite hors de la window, et la garde a denonce une regression qui
  // n'existait pas. Un number magique qui depend de la longueur du fichier surveille le fichier,
  // pas ce qu'il pretend proteger.
  // `buildApi` et plus `apiFor` : le litteral d'api est construit UNE FOIS par (objet, script)
  // depuis qu'il ne se reconstruit plus a chaque image (docs/REVUE_2026-09-10.md SS 2.2). Les
  // gardes `typeof` qu'on verifie ici vivent donc dans le constructeur, pas dans l'accesseur.
  const api = corpsDe('function buildApi');
  assert.ok(/network:\s*\(typeof networkHandle === 'function'\)/.test(api),
    'api.network n est plus garde : un jeu solo sans network-game.js tombe au premier script');
  assert.ok(/isAuthority:\s*\(typeof networkIsAuthority === 'function'\)/.test(api),
    'api.isAuthority n est plus garde : meme defaut');
  // Le repli doit rendre VRAI : un jeu solo est sa propre authority. Un repli à faux ferait taire la
  // moitié de la logique d'un script écrit pour du multijoueur, sans un mot.
  assert.ok(/: function\(\)\{ return true; \}/.test(api),
    'le repli de estAutorite ne rend pas vrai : un jeu solo se croirait client');
});

// Zeldo (2026-10-02) : un héros riggé créé PAR SCRIPT depuis un prefab, aucun objet de la scène
// ne le porte, aucun animator. Le jeu publié levait « clipAssetOfModel is not defined » au
// chargement, puis « splitBone is not defined » au premier clip joué.
test('UN ASSET MODÈLE embarque l\'animation, même sans objet ni animator dans la scène', () => {
  const ctx = contexte();
  const p = {version: 14, scenes: [{name: 'S', data: {objects: [{name: 'Jeu', scripts: [{code: 'api.create("PF_Hero")'}]}]}}],
    assets: [{id: 'a1', kind: 'model', name: 'Hero', paramsImport: {clips: [{id: 'c1', name: 'Marche'}]}},
             {id: 'a2', kind: 'prefab', name: 'PF_Hero', tree: []}]};
  const embarques = [...ctx.trimmingBuild(p).embarques];
  for(const f of ['js/anim-asset.js', 'js/anim-blend.js']){
    assert.ok(embarques.indexOf(f) !== -1, f + ' RETIRÉ alors que le modèle a des clips');
  }
});
