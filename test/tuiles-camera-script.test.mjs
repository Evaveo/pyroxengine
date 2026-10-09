import { deEsm } from './engine-env.mjs';
// LIRE ET ÉCRIRE LE DÉCOR, ET CADRER — les deux manques qui empêchaient un décor de vivre.
//
// Sans `tileAt`/`poserTuile`, une map de tuiles est un décor peint : aucune porte ne s'ouvre,
// aucun mur ne se casse, aucun interrupteur ne change quoi que ce soit, et un script ne peut même
// pas demander « qu'est-ce que j'ai sous les pieds ». Sans `camera2d`, onze réglages de cadrage
// existaient et aucun n'était joignable : pas de zoom, pas de recadrage, pas de secousse.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const nu = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v));

function contexte(){
  const bac = {console, Math, JSON, Object, Array, Number, String, isFinite};
  bac.window = bac; bac.globalThis = bac;
  const ctx = vm.createContext(bac);
  ['js/tilemap.js', 'js/camera-framing.js'].forEach(function(f){
    vm.runInContext(deEsm(read(f)), ctx, {filename: f});
  });
  return bac;
}
const C = contexte();

// three.js réduit à ce que ces fonctions en demandent : un Vector3. Le module le reçoit en
// paramètre, c'est sa convention — il doit rester lisible par un test sans moteur de rendu.
const T = {Vector3: function(){ this.x = 0; this.y = 0; this.z = 0; }};

/**
 * Un nœud porteur de map, posé à (ox, oy) dans le monde.
 *
 * La map est le COMPOSANT `Tilemap`, plus un sac `userData` : un faux composant suffit ici,
 * puisque les fonctions pures ne lui demandent que ses champs et `cellAt`.
 */
function noeudCarte(C, width, height, cellSize, ox, oy){
  const map = C.mapEmpty(width, height, cellSize);
  map.cellAt = function(x, y){ return C.cellTilemap(map, x, y); };
  return {userData: {},
          getComponent: function(t){ return (t === 'Tilemap') ? map : null; },
          getWorldPosition: function(v){ v.x = ox; v.y = oy; v.z = 0; return v; }};
}

test('LA CASE SOUS UN POINT DU MONDE — le test qui porte le fichier', () => {
  // Carte 4×3 de tuiles de 1, posée à l'origine : la case (0,0) occupe x∈[0,1[ et y∈]-1,0].
  const n = noeudCarte(C, 4, 3, 1, 0, 0);
  const cas = [
    [0.5, -0.5, {x: 0, y: 0}],
    [3.5, -0.5, {x: 3, y: 0}],
    [0.5, -2.5, {x: 0, y: 2}],
    [3.9, -2.9, {x: 3, y: 2}]
  ];
  cas.forEach(function(c){
    const v = C.aimCellTilemap(T, n, c[0], c[1]);
    assert.ok(v, 'point (' + c[0] + ', ' + c[1] + ') devrait tomber dans la grille');
    assert.deepEqual({x: v.x, y: v.y}, c[2], 'point (' + c[0] + ', ' + c[1] + ')');
  });
  // HORS de la grid : `null`, pas une case rabattue sur le bord. Une lecture rabattue rendrait
  // le matériau du bord pour un personnage qui a quitté la map — « je suis encore sur le sol ».
  [[-0.1, -0.5], [4.1, -0.5], [0.5, 0.5], [0.5, -3.1]].forEach(function(p){
    assert.equal(C.aimCellTilemap(T, n, p[0], p[1]), null, 'hors grille (' + p + ')');
  });
});

test('LA POSITION MONDIALE DU NOEUD est retiree — une racine deplacee ne decale rien', () => {
  // Le même point du monde doit viser la même case relative, map à l'origine ou décalée.
  const a = noeudCarte(C, 4, 3, 1, 0, 0);
  const b = noeudCarte(C, 4, 3, 1, 10, -20);
  const ici = C.aimCellTilemap(T, a, 2.5, -1.5);
  const la  = C.aimCellTilemap(T, b, 12.5, -21.5);
  assert.deepEqual({x: ici.x, y: ici.y}, {x: 2, y: 1});
  assert.deepEqual({x: la.x, y: la.y}, {x: 2, y: 1},
    'la map décalée ne retire pas sa position mondiale : tout le décor se lirait à côté');
});

test('LES TROIS ECRITURES d appel resolvent chacune LEUR case', () => {
  const n = noeudCarte(C, 4, 3, 1, 0, 0);
  // « soi » est AILLEURS que le point explicite, et c'est tout le test : la première version
  // les avait placés au même endroit, si bien que unregister la reconnaissance du point laissait le
  // repli « sous me » donner la même réponse. La garde passait en ne mesurant rien.
  const soi = {getWorldPosition: function(v){ v.x = 0.5; v.y = -0.5; v.z = 0; return v; }};
  // DEUX cartes, et celle qu'on aims n'est PAS la premiere. Avec une seule, unregister le ciblage
  // explicite laissait le repli « la premiere map trouvee » tomber sur la bonne par accident,
  // et la garde restait verte en ne mesurant rien.
  const autre = noeudCarte(C, 4, 3, 1, 100, -100);
  const list = [{userData: {}}, n, autre];
  const sousMoi = C.aimCell2d(T, undefined, undefined, soi, list);
  assert.deepEqual({x: sousMoi.x, y: sousMoi.y}, {x: 0, y: 0}, 'api.tileAt() doit viser sous soi');
  const auPoint = C.aimCell2d(T, {x: 2.5, y: -1.5}, undefined, soi, list);
  assert.deepEqual({x: auPoint.x, y: auPoint.y}, {x: 2, y: 1}, 'api.tileAt(point) doit viser CE point');
  // Pour le CIBLAGE, la map visee n'est deliberement pas la premiere de la liste : sinon le
  // repli « la premiere trouvee » tomberait sur la bonne par accident.
  const surCarte = C.aimCell2d(T, n, {x: 3.5, y: -2.5}, soi, [{userData: {}}, autre, n]);
  assert.deepEqual({x: surCarte.x, y: surCarte.y}, {x: 3, y: 2}, 'api.tileAt(map, point)');
  // Aucune map dans la scène : null, et surtout pas une exception dans la boucle de jeu.
  assert.equal(C.aimCell2d(T, undefined, undefined, soi, [{userData: {}}]), null);
});

test('ECRIRE UNE CASE la change, et la lecture le voit', () => {
  const n = noeudCarte(C, 4, 3, 1, 0, 0);
  const map = n.getComponent('Tilemap');
  const v = C.aimCellTilemap(T, n, 2.5, -1.5);
  assert.equal(C.cellTilemap(map, v.x, v.y), 0, 'la map neuve doit être empty');
  assert.equal(C.setCellTilemap(map, v.x, v.y, 1), true);
  assert.equal(C.cellTilemap(map, v.x, v.y), 1, 'la case écrite ne se relit pas');
  assert.equal(C.setCellTilemap(map, v.x, v.y, 0), true, 'on doit pouvoir effacer');
  assert.equal(C.cellTilemap(map, v.x, v.y), 0);
});

test('LA CAMERA SE LIT SANS RIEN CHANGER, et s ecrit clef par clef', () => {
  // Le réglage vit sur les COMPOSANTS (`Camera` pour le cadrage, `CameraFollow` pour le suivi),
  // chacun référençant son sac `userData.camera`/`userData.cameraFollow` par `.data` — le patron
  // de tous les composants migrés (docs/REVUE_2026-09-14.md point 10). Un faux nœud suffit :
  // setCamera2d ne demande que getComponent, ce qui est exactement ce qui permet de le partager
  // éditeur/runtime.
  const camera = {data: {mode: 'height', ppu: 16}, _framing: {ratio: 3}, applyProjection: function(){}};
  const follow = {data: {targetName: 'heros', topOfView: 0.12}};
  const cam = {userData: {},
               getComponent: function(t){
                 return (t === 'Camera') ? camera : (t === 'CameraFollow') ? follow : null;
               }};
  // Lecture seule : ni l'état ni le cadrage en cache ne bougent.
  const lu = C.setCamera2d(cam, undefined);
  assert.equal(lu.ppu, 16);
  assert.equal(lu.targetName, 'heros');
  assert.deepEqual(nu(camera._framing), {ratio: 3}, 'lire ne doit pas jeter le cadrage');

  // Écriture PARTIELLE : `{ppu}` ne doit pas effacer l'objet suivi ni le reste.
  const apres = C.setCamera2d(cam, {ppu: 24});
  assert.equal(apres.ppu, 24);
  assert.equal(apres.targetName, 'heros', 'un réglage partiel a effacé l objet suivi');
  assert.equal(apres.mode, 'height');
  // Le cadrage en cache est INVALIDÉ : sinon le zoom n'apparaîtrait qu'au prochain
  // redimensionnement de la fenêtre — c'est-à-dire jamais, en jeu.
  assert.equal(camera._framing, null, 'le cadrage en cache survit au changement de ppu');

  // Une clé inconnue n'entre pas : un `{zoom: 2}` mal orthographié ne doit pas s'installer
  // silencieusement dans les données de la caméra, où il ne servirait jamais à rien.
  C.setCamera2d(cam, {zoom: 2});
  assert.equal(camera.data.zoom, undefined, 'une clé inconnue s est installée');
  // Libérer le suivi doit être possible — c'est ce qui permet une secousse ou un cadrage manuel.
  assert.equal(C.setCamera2d(cam, {targetName: ''}).targetName, '');
  // Pas de caméra : `null`, sans jeter.
  assert.equal(C.setCamera2d(null, {ppu: 8}), null);
  assert.equal(C.setCamera2d({getComponent: function(){ return null; }}, {ppu: 8}), null);
});

test('LA CAMERA PILOTEE est la PRINCIPALE, comme au demarrage du jeu', () => {
  const camOrtho = function(){ return {projection: 'orthographic'}; };
  const noeud = function(main){
    const o = {userData: main ? {game: {main: true}} : {}};
    o.getComponent = function(t){ return (t === 'Camera') ? camOrtho() : null; };
    return o;
  };
  const a = noeud(false), b = noeud(true);
  assert.equal(C.cameraMain2d([a, b]), b,
    'régler une autre caméra que celle qu on regarde donne un zoom sans effet, et rien pour le dire');
  assert.equal(C.cameraMain2d([a]), a, 'à défaut de marquée, la première');
  assert.equal(C.cameraMain2d([{userData: {}, getComponent: function(){ return null; }}]), null);
  assert.equal(C.cameraMain2d([]), null);
});

test('LES DEUX MOTEURS exposent les trois inputs, et reconstruisent avec LEUR fonction', () => {
  const ed = read('js/scripts.js'), rt = read('js/game-runtime.js');
  const names = ['tileAt', 'setTile', 'camera2d'];
  names.forEach(function(n){
    assert.ok(ed.indexOf(n + ': function') >= 0, 'editeur : api.' + n + ' absente');
    assert.ok(rt.indexOf(n + ':function') >= 0, 'game publie : api.' + n + ' absente');
  });
  // La reconstruction apres ecriture n'appartient plus a chaque moteur : `setCell` pose
  // `_dirty`, et le TilemapSystem — le MEME des deux cotes — refait les mailles a l'image
  // suivante. C'est precisement le miroir qu'on a supprime.
  const dansPoser = (src, header) => src.slice(src.indexOf(header), src.indexOf(header) + 700);
  [['editeur', ed, 'setTile: function'], ['game publie', rt, 'setTile:function']].forEach(function(p){
    assert.ok(dansPoser(p[1], p[2]).indexOf('t.map.setCell(') >= 0,
      p[0] + ' : la case ne passe plus par setCell, donc rien ne marque la map a refaire');
  });
  // Et les deux passent par les modules PARTAGES : une resolution recopiee divergerait un jour.
  [['editeur', ed], ['game publie', rt]].forEach(function(p){
    assert.ok(p[1].indexOf('aimCell2d(THREE,') >= 0, p[0] + ' : resolution de case non partagee');
    assert.ok(p[1].indexOf('setCamera2d(cameraMain2d(') >= 0, p[0] + ' : reglage camera non partage');
  });
});

test('LES DEUX MOTEURS invalident le hidden des obstacles apres ecriture', () => {
  // Le counter de version manquait cote runtime, et rien ne pouvait le montrer tant quune map
  // ne changeait jamais en cours de partie. Depuis quun script peut ecrire une case, loubli
  // devient une porte qui souvre a lecran et continue de bloquer. Mesure dans le jeu publie : le
  // heros sarretait net devant une case quil venait deffacer.
  const ed = read('js/components/component-tilemap.js');
  const body = (src, header) => src.slice(src.indexOf(header), src.indexOf(header) + 3500);
  // UNE SEULE reconstruction, partagee : le compteur de version y est, donc il y est pour les
  // deux moteurs. C'est ce que le miroir ne garantissait pas — il l'avait perdu.
  assert.ok(body(ed, 'function rebuildTilemap').indexOf('_v || 0) + 1') >= 0,
    'la reconstruction ninvalide plus le hidden des obstacles');
  assert.equal(/function rtBuildTilemap/.test(read('js/game-runtime.js')), false,
    'un miroir de reconstruction est revenu dans le runtime');
  // Et le hidden doit bien se lire sur ce counter, sinon lincrementer ne sert a rien.
  assert.ok(read('js/world-2d.js').indexOf('_obst2dV === v') >= 0,
    'le hidden des obstacles ne se lit plus sur le counter de version');
});

test('JOUER UNE SUITE : les deux moteurs, et sans redemarrer celle deja en cours', () => {
  // SpriteAnimator savait enchainer des images depuis le premier jour, et rien ne pouvait lui
  // dire « joue attaque maintenant » : une animation ne pouvait etre que la boucle par defaut.
  const ed = read('js/scripts.js'), rt = read('js/game-runtime.js');
  [['editeur', ed], ['game publie', rt]].forEach(function(p){
    assert.ok(p[1].indexOf('playSequence') >= 0, p[0] + ' : api.playSequence absente');
    assert.ok(p[1].indexOf('currentSequence') >= 0, p[0] + ' : api.currentSequence absente');
    // Le module PARTAGE, pas une reimplementation : c est lui qui porte la garde du non-redemarrage.
    assert.ok(p[1].indexOf('playAnimSprite(target || o, name, forcer)') >= 0,
      p[0] + ' : playSequence ne passe pas par le module partage');
  });
  // Et cette garde doit exister la ou elle est ecrite une seule fois.
  const m = read('js/anim-sprite.js');
  assert.ok(m.indexOf('if(!forcer && e.sequence === name) return false;') >= 0,
    'playAnimSprite redemarre une sequence deja en cours : un appel par image figerait le personnage');
});

test('LA PAUSE arrete le MONDE et laisse tourner les SCRIPTS — sinon rien ne la leve', () => {
  const rt = read('js/game-runtime.js');
  // Un dt de JEU, distinct du dt reel.
  assert.ok(rt.indexOf('const dtGame = game.pause ? 0 : dt;') >= 0,
    'le jeu publie ne calcule pas de temps de jeu distinct : la pause ne peut rien stop');
  // TOUT ce qui simule le recoit. Un seul oubli et le monde continue a moitie, ce qui est pire
  // qu une pause absente : le heros se fige et les ennemis avancent.
  // L'animation de sprites passe par les Systèmes (v0.159.2) : c'est `System.runFrame` qui doit
  // recevoir le temps de jeu.
  ['rtUpdateAnimators(dtGame)', 'rtUpdateAnimations(dtGame)', 'System.runFrame(dtGame',
   'stepWorld2d(game.objects, dtGame', 'game.t += dtGame', 'rtUpdateParticles(dtGame)'].forEach(function(a){
    assert.ok(rt.indexOf(a) >= 0, 'ne recoit pas le temps de jeu : ' + a);
  });
  // LES SCRIPTS, EUX, TOURNENT TOUJOURS. C est tout le piege : les stop rendrait la pause
  // definitive, puisque c est un script qui doit la lever.
  // L appel doit etre INCONDITIONNEL. Verifier sa seule presence laissait passer un
  // if(!game.pause) runScripts(...) — c est-a-dire exactement le piege que cette garde
  // existe pour empecher : une pause qu aucun script ne peut plus lever. On compare donc la
  // LIGNE ENTIERE, telle qu elle doit etre ecrite au premier niveau de la boucle.
  const ligneScripts = rt.split(String.fromCharCode(10))
    .map(function(l){ return l.charCodeAt(l.length - 1) === 13 ? l.slice(0, -1) : l; })
    .filter(function(l){ return l.indexOf('runScripts(') >= 0 && l.indexOf('function ') < 0; });
  assert.deepEqual(ligneScripts, ['  runScripts(dtGame, dt);'],
    'l appel aux scripts n est plus inconditionnel : une pause que rien ne peut lever');
  // Et le dt reel leur parvient, sinon un menu de pause ne peut pas s animer.
  //
  // L'objet api n'est plus reconstruit a chaque image (docs/REVUE_2026-09-10.md SS 2.2) : les
  // champs qui changent d'une image a l'autre sont REECRITS par `apiFor`, et c'est cette
  // ecriture-la qu'on mesure. Le litteral, lui, ne porte plus qu'une valeur initiale.
  assert.match(rt, /api\.dtReal = dtReel;/,
    'api.dtReal ne recoit plus le dt REEL dans le jeu publie : un menu de pause ne peut plus s animer');
  assert.match(read('js/scripts.js'), /api\.dtReal = dt;/,
    'api.dtReal ne recoit plus le dt dans l editeur');
  // Et les deux cles existent bien dans les litteraux, sinon `apiFor` ecrirait sur du vide.
  assert.ok(rt.indexOf('dtReal:0') >= 0, 'api.dtReal absente du litteral du jeu publie');
  assert.ok(read('js/scripts.js').indexOf('dtReal: 0') >= 0, 'api.dtReal absente du litteral de l editeur');
  // L entry elle-meme, des deux cotes.
  assert.ok(rt.indexOf('pause:function(active)') >= 0, 'game publie : api.pause absente');
  assert.ok(read('js/scripts.js').indexOf('pause: function(active)') >= 0, 'editeur : api.pause absente');
});
