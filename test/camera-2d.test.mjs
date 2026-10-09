import { deEsm } from './engine-env.mjs';
// Caméra 2D — le calcul, sans three et sans DOM.
//
// Le test qui porte le fichier est celui du RAPPORT PIXEL. C'est lui qui décide de la netteté, et
// rien d'autre : sur un jeu réel, 216 pixels d'art affichés dans 150 pixels d'écran donnaient un
// rapport de 0,694, et tout le « flou » qu'on attribuait au rendu venait de là — filtrage au plus
// proche, aucun post-traitement, palette de douze couleurs, et pourtant mou.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const hote = (x) => JSON.parse(JSON.stringify(x));
// Un `const` déclaré au premier niveau d'un script N'EST PAS une propriété de l'object global : il
// vit dans l'environnement lexical global. `ctx.CAM2D_DEFAULT` rend donc `undefined` alors que le
// navigateur, lui, le voit très bien depuis les autres scripts de la page. Il faut l'ÉVALUER.
const val = (ctx, expr) => vm.runInContext(expr, ctx);

function contexte(){
  const bac = {console, Math, JSON, Number, isFinite, Array, Object};
  bac.window = bac; bac.self = bac; bac.globalThis = bac;
  const ctx = vm.createContext(bac);
  vm.runInContext(deEsm(read('js/camera-framing.js')), ctx, {filename: 'js/camera-framing.js'});
  return ctx;
}

test('LE RAPPORT PIXEL EST ENTIER dans les trois modes — le test qui porte le fichier', () => {
  const ctx = contexte();
  const entier = (r) => Math.abs(r - Math.round(r)) < 1e-12;
  // Des fenêtres quelconques, y compris celles qui ne tombent sur aucun multiple rond.
  const fenetres = [[1920, 1080], [1906, 940], [1366, 768], [800, 600], [469, 150], [3840, 2160]];
  for(const [L, H] of fenetres){
    for(const mode of ['height', 'width', 'fixed']){
      const c = ctx.framing2d(L, H, 16, mode, 46, 3);
      assert.ok(entier(c.ratio), mode + ' ' + L + '×' + H + ' : rapport ' + c.ratio);
      assert.ok(c.ratio >= 1, 'un rapport doit valoir au moins 1');
      // La cohérence interne : la hauteur de vue redonne EXACTEMENT la hauteur en pixels.
      assert.ok(Math.abs(c.heightView * c.ratio * 16 - H) < 1e-9,
        mode + ' : ' + c.heightView + ' × ' + c.ratio + ' × 16 ≠ ' + H);
      assert.ok(Math.abs(c.widthView * c.ratio * 16 - L) < 1e-9);
    }
  }
});

test('LE MODE « LARGEUR » ne montre JAMAIS au-delà du niveau', () => {
  const ctx = contexte();
  // C'est le défaut mesuré sur un jeu réel : caméra fixe sur une tour de 46 unités, une vue de 68,
  // donc la moitié de l'écran hors du décor — et les plateformes hors field. Ici la vue reste
  // dedans par construction.
  for(const [L, H] of [[1920, 1080], [1906, 940], [2560, 1080], [800, 600]]){
    for(const level of [24, 34, 46, 60]){
      const c = ctx.framing2d(L, H, 16, 'width', level);
      assert.ok(c.widthView <= level + 1e-9,
        L + '×' + H + ' sur ' + level + ' unites : vue de ' + c.widthView.toFixed(2));
      // Et c'est le PLUS PETIT rapport qui tienne : un cran en dessous doit déborder.
      if(c.ratio > 1){
        const moins = ctx.framing2d(L, H, 16, 'fixed', level, c.ratio - 1);
        assert.ok(moins.widthView > level,
          'rapport ' + c.ratio + ' n est pas minimal : ' + (c.ratio-1) + ' tiendrait aussi');
      }
    }
  }
});

test('le mode « height » prend le PLUS GRAND rapport qui tienne', () => {
  const ctx = contexte();
  assert.equal(ctx.framing2d(1920, 1080, 16, 'height').ratio, 5);   // 1080 / 216 = 5
  assert.equal(ctx.framing2d(1920, 900, 16, 'height').ratio, 4);    // 900 / 216 = 4,1
  // Une fenêtre plus petite que la hauteur de référence ne descend pas sous 1 : un rapport de 0
  // ferait une division par zéro et une vue infinie.
  assert.equal(ctx.framing2d(469, 150, 16, 'height').ratio, 1);
});

test('LE SUIVI EST BORNÉ, et un niveau plus étroit que la vue est CENTRÉ', () => {
  const ctx = contexte();
  const bounds = {xMin: 0, xMax: 46, yMin: -132, yMax: 0};
  // Au milieu : la caméra suit franchement.
  let p = ctx.follow2d({x: 23, y: -60}, 14, 30, bounds, 0);
  assert.ok(Math.abs(p.x - 23) < 1e-9, 'x = ' + p.x);
  // Contre un bord : elle s'arrête à une DEMI-vue du bord, pas au bord — sinon il reste une
  // demi-fenêtre de vide.
  p = ctx.follow2d({x: 1, y: -60}, 14, 30, bounds, 0);
  assert.ok(Math.abs(p.x - 15) < 1e-9, 'contre le bord gauche, x = ' + p.x + ', 15 attendu');
  p = ctx.follow2d({x: 45, y: -60}, 14, 30, bounds, 0);
  assert.ok(Math.abs(p.x - 31) < 1e-9, 'contre le bord droit, x = ' + p.x + ', 31 attendu');
  // Un niveau plus ÉTROIT que la vue : on le centre. Coller un bord montrerait du vide de
  // l'autre côté, ce qui est pire que de le montrer des deux côtés à parts égales.
  p = ctx.follow2d({x: 2, y: -60}, 14, 60, {xMin: 0, xMax: 20}, 0);
  assert.ok(Math.abs(p.x - 10) < 1e-9, 'niveau etroit : x = ' + p.x + ', centre 10 attendu');
  // Un axe SANS bounds reste libre : c'est ce qu'on veut sur la verticale d'une tour dont on ne
  // connaît pas la end.
  p = ctx.follow2d({x: 5, y: -999}, 14, 30, {xMin: 0, xMax: 46}, 0);
  assert.ok(Math.abs(p.y - (-999)) < 1e-9, 'sans clamped verticale, y doit suivre : ' + p.y);
});

test('le decalage vertical place le personnage SOUS le centre, en fraction de la vue', () => {
  const ctx = contexte();
  // Dans un platformer on regarde vers le haut, pas vers ses pieds. Exprimé en fraction, le
  // décalage reste juste à toutes les résolutions — en unités il serait deux fois trop grand sur
  // un écran deux fois plus petit.
  const a = ctx.follow2d({x: 0, y: 0}, 14, 30, {}, 0.12);
  const b = ctx.follow2d({x: 0, y: 0}, 28, 60, {}, 0.12);
  assert.ok(Math.abs(a.y - 1.68) < 1e-9, 'y = ' + a.y);
  assert.ok(Math.abs(b.y / a.y - 2) < 1e-9, 'le decalage doit suivre la hauteur de vue');
});

test('LE FRUSTUM accepte les deux cotes de z — sinon la moitie des calques disparait', () => {
  const ctx = contexte();
  const f = ctx.frustum2d(14, 30);
  assert.ok(Math.abs(f.top - 7) < 1e-9);
  assert.ok(Math.abs(f.left + 15) < 1e-9);
  // Le point : `near` NÉGATIF. Le réflexe venu de la 3D — un near à 0,1 — ferait disparaître tout
  // ce qui passe derrière la caméra, c'est-à-dire tous les sprites que l'auteur décale en
  // arrière-plan pour ordonner ses calques.
  assert.ok(f.near < 0, 'near = ' + f.near + ' : un near positif mange les plans arriere');
  assert.ok(f.far > 0);
});

test('CALER SUR LE PIXEL empeche le decor de fremir', () => {
  const ctx = contexte();
  // Une caméra à position continue fait tomber chaque texel tantôt sur un pixel, tantôt entre
  // deux : les colonnes du sprite changent de largeur d'une image à l'autre. C'est ce qu'on
  // décrit comme « ça scintille » sans savoir le nommer.
  const step = 1 / (16 * 3);
  for(const v of [0, 0.001, 1.7239, -4.11, 12.5]){
    const c = ctx.snapOnPixel2d(v, 16, 3);
    assert.ok(Math.abs(c / step - Math.round(c / step)) < 1e-9, v + ' -> ' + c + ' hors grille');
    assert.ok(Math.abs(c - v) <= step / 2 + 1e-12, 'le calage ne doit pas deplacer de plus d un demi-pas');
  }
  // Un rapport plus grand donne une grille plus FINE : le calage doit se resserrer, pas se figer.
  assert.ok(Math.abs(ctx.snapOnPixel2d(1.7239, 16, 6) - 1.7239)
          < Math.abs(ctx.snapOnPixel2d(1.7239, 16, 1) - 1.7239) + 1e-12);
});

test('validateCamera2d NOMME les reglages qui ne se voient pas', () => {
  const ctx = contexte();
  const p = ctx.validateCamera2d({mode: 'travelling', suit: 42, xMin: 10, xMax: 2, yMin: 5, yMax: 1});
  const contient = (m) => p.some((x) => x.includes(m));
  assert.ok(contient('Mode de cadrage inconnu'));
  assert.ok(contient('nom d’un objet') || contient("nom d'un objet"));
  assert.ok(contient('bounds horizontales sont inversées'));
  assert.ok(contient('bounds verticales sont inversées'));
  // Le mode « width » sans largeur de niveau retombe silencieusement sur la hauteur : c'est
  // précisément le genre de réglage qui marche à moitié sans qu'on sache pourquoi.
  assert.ok(ctx.validateCamera2d({mode: 'width'}).some((x) => x.includes('largeur du niveau')));
  assert.ok(ctx.validateCamera2d({mode: 'fixed'}).some((x) => x.includes('rapport')));
  // UNE SEULE clamped d'une paire ne clamped rien : on remplit « X min », on s'arrête, et la caméra
  // continue de montrer le vide à droite — avec un réglage qui a tout l'air d'être fait.
  const seule = ctx.validateCamera2d({mode: 'height', xMin: 0});
  assert.ok(seule.some((x) => x.includes('seule clamped horizontale')), JSON.stringify(hote(seule)));
  assert.ok(ctx.validateCamera2d({mode: 'height', yMax: 20})
              .some((x) => x.includes('seule clamped verticale')));
  assert.deepEqual(hote(ctx.validateCamera2d({mode: 'height', xMin: 0, xMax: 46})), [],
    'les deux bounds : rien a signaler');
  // Une clamped à `null` — ce que l'inspecteur écrit pour un champ vide — n'EST PAS une clamped. Si
  // elle passait pour telle, la moitié des caméras du monde signaleraient un faux problème.
  assert.deepEqual(hote(ctx.validateCamera2d({mode: 'height', xMin: null, xMax: null})), []);
  assert.deepEqual(hote(ctx.validateCamera2d({mode: 'width', widthLevel: 46, targetName: 'Heros'})), [],
    'un reglage correct ne doit RIEN signaler');
});

// ---------- Le réglage et son application, partagés éditeur/runtime ----------

test('LES DEFAUTS SONT A UN SEUL ENDROIT, et un reglage partiel les complete', () => {
  const ctx = contexte();
  // Ils étaient écrits en clair des deux côtés (`Number(r.ppu) || 16`, `r.mode || 'height'`), ce
  // qui est la même faute que d'avoir deux fois le code : le jour où un défaut change d'un côté,
  // le jeu exporté ne cadre plus comme l'éditeur, et rien ne le signale.
  const r = ctx.settingCam2d({ppu: 48});
  assert.equal(r.ppu, 48, 'ce qui est fourni est gardé');
  assert.equal(r.mode, val(ctx, 'CAM2D_DEFAULT').mode, 'ce qui manque vient du défaut');
  assert.equal(r.snapPixel, true);
  // Un réglage ABSENT donne le défaut complet, pas un objet vide : c'est ce qui permet aux deux
  // côtés de cadrer pareil quand la scène ne dit rien.
  assert.equal(ctx.settingCam2d(null).ppu, val(ctx, 'CAM2D_DEFAULT').ppu);
  // Des valeurs absurdes sont ramenées dans le domaine, pas propagées : un ppu de 0 donnerait une
  // view infinie et un écran empty, ce qu'on lirait comme « le jeu ne charge pas ».
  assert.equal(ctx.settingCam2d({ppu: 0}).ppu, val(ctx, 'CAM2D_DEFAULT').ppu);
  assert.equal(ctx.settingCam2d({ppu: -5}).ppu, val(ctx, 'CAM2D_DEFAULT').ppu);
  assert.equal(ctx.settingCam2d({mode: 'travelling'}).mode, val(ctx, 'CAM2D_DEFAULT').mode);
  // `cameraSettingOf` remplace `ensureCam2d` : le réglage n'a plus de sac à lui sur userData,
  // il EST le composant Camera. Deux sacs pour un réglage, c'était deux valeurs qui divergent.
  const n = {getComponent: function(t){ return (t === 'Camera') ? {ppu: 32} : null; }};
  assert.equal(ctx.cameraSettingOf(n).ppu, 32, 'le reglage vient du composant Camera');
  assert.equal(ctx.cameraSettingOf({}), null, 'un noeud sans composant n a pas de reglage');
});

test('APPLIQUER LE CADRAGE pose les six champs du frustum, near negatif compris', () => {
  const ctx = contexte();
  // Six affectations et un `near` négatif : c'est précisément ce qui se recopie très bien à un
  // détail près quand on en tient deux exemplaires. D'où le partage, et d'où ce test.
  let recalculs = 0;
  const cam = {updateProjectionMatrix: function(){ recalculs++; }};
  const c = ctx.applyFraming2d(cam, {mode: 'fixed', ratio: 3, ppu: 16}, 1920, 1080);
  assert.equal(c.ratio, 3);
  assert.ok(Math.abs(cam.right - cam.left - c.widthView) < 1e-9, 'largeur du frustum');
  assert.ok(Math.abs(cam.top - cam.bottom - c.heightView) < 1e-9, 'hauteur du frustum');
  assert.ok(Math.abs(cam.left + cam.right) < 1e-9, 'le frustum doit etre centre en x');
  assert.ok(Math.abs(cam.top + cam.bottom) < 1e-9, 'le frustum doit etre centre en y');
  assert.ok(cam.near < 0, 'near = ' + cam.near + ' : un near positif mange les plans arriere');
  assert.ok(cam.far > 0);
  // La matrice de projection DOIT être recalculée : sans ça les champs sont posés et l'image ne
  // change pas — le pire des deux, parce que le réglage a l'air pris en compte.
  assert.equal(recalculs, 1, 'updateProjectionMatrix doit etre appele');
  // Une caméra sans cette méthode ne fait pas tomber le calcul : le harnais de test en est une.
  assert.doesNotThrow(() => ctx.applyFraming2d({}, {}, 800, 600));
});

test('POSER LE SUIVI ne bouge RIEN sans cible, et cale sur le pixel quand on le demande', () => {
  const ctx = contexte();
  const cad = {ratio: 3, heightView: 7.5, widthView: 13.33};
  // Sans `suit`, la position reste celle que l'auteur a placée. La remettre à zéro effacerait son
  // travail, et une caméra fixe est un choix légitime.
  const fixe = {position: {x: 12.34, y: -5.67}};
  assert.equal(ctx.applyFollow(fixe, {targetName: null}, cad, {x: 0, y: 0}), false);
  assert.equal(fixe.position.x, 12.34, 'une camera sans suivi ne doit pas move');
  // Sans cible non plus : un nom qui ne désigne personne ne doit pas téléporter la caméra à
  // l'origine — ce serait un écran de vide au lieu d'une caméra qui ne suit pas.
  assert.equal(ctx.applyFollow(fixe, {targetName: 'Heros'}, cad, null), false);
  assert.equal(fixe.position.x, 12.34);
  // Avec cible : la position est CALÉE sur la grille de pixels.
  const n = {position: {x: 0, y: 0}};
  assert.equal(ctx.applyFollow(n, {targetName: 'Heros', ppu: 16, topOfView: 0, snapPixel: true}, cad, {x: 1.7239, y: 3.111}), true);
  const step = 1 / (16 * 3);
  assert.ok(Math.abs(n.position.x / step - Math.round(n.position.x / step)) < 1e-9,
    'x = ' + n.position.x + ' hors de la grille de pixels');
  assert.ok(Math.abs(n.position.x - 1.7239) <= step / 2 + 1e-12, 'le calage ne doit pas deplacer d un demi-pas');
  // `snapPixel: false` laisse la position CONTINUE : un jeu qui n'est pas en pixel-art n'a pas
  // besoin du calage, et l'imposer bloquerait un mouvement fluide sur les petits déplacements.
  const m = {position: {x: 0, y: 0}};
  ctx.applyFollow(m, {targetName: 'Heros', ppu: 16, topOfView: 0, snapPixel: false}, cad, {x: 1.7239, y: 0});
  assert.ok(Math.abs(m.position.x - 1.7239) < 1e-9, 'sans calage, x = ' + m.position.x);
  // Et les bounds s'appliquent AUSSI par ce chemin — sinon le partage ne partagerait que la moitié.
  const b = {position: {x: 0, y: 0}};
  ctx.applyFollow(b, {targetName: 'H', ppu: 16, topOfView: 0, xMin: 0, xMax: 46, snapPixel: false},
                   {ratio: 3, heightView: 14, widthView: 30}, {x: 1, y: 0});
  assert.ok(Math.abs(b.position.x - 15) < 1e-9, 'clamped non appliquee : x = ' + b.position.x);
});

test('LES BORNES SE DEDUISENT DU DECOR — sinon personne ne les renseigne', () => {
  const ctx = contexte();
  // C'est le défaut le plus visible qu'on ait mesuré, et il n'a pas d'autre cause qu'un réglage
  // trop pénible à renseigner : taper quatre coordonnées demande de lire l'étendue d'une tilemap.
  const obs = [
    {x: 0, y: 0, dl: 1, dh: 0.5},
    {x: 10, y: 6, dl: 2, dh: 0.5},
    {x: -4, y: -3, dl: 0.5, dh: 1}
  ];
  const b = ctx.boundsFromObstacles2d(obs);
  assert.ok(Math.abs(b.xMin - (-4.5)) < 1e-9, 'xMin = ' + b.xMin);
  assert.ok(Math.abs(b.xMax - 12) < 1e-9, 'xMax = ' + b.xMax);
  assert.ok(Math.abs(b.yMin - (-4)) < 1e-9, 'yMin = ' + b.yMin);
  assert.ok(Math.abs(b.yMax - 6.5) < 1e-9, 'yMax = ' + b.yMax);
  // Les DEMI-tailles comptent : clamp sur les centres laisserait une demi-tile de décor
  // hors champ tout autour, ce qui se voit comme une bande vide au bord de l'écran.
  assert.ok(b.xMax > 10, 'la demi-largeur du dernier obstacle doit compter');
  // Rien : `null`, et pas {0,0,0,0}. Rendre des bounds nulles clouerait la caméra à l'origine en
  // ayant l'air d'avoir marché.
  assert.equal(ctx.boundsFromObstacles2d([]), null);
  assert.equal(ctx.boundsFromObstacles2d(null), null);
  // Et le résultat doit être utilisable tel quel par le suivi : un aller-retour.
  const n = {position: {x: 0, y: 0}};
  ctx.applyFollow(n, Object.assign({targetName: 'H', ppu: 16, topOfView: 0, snapPixel: false}, b),
                   {ratio: 1, heightView: 4, widthView: 6}, {x: -100, y: 0});
  assert.ok(n.position.x >= b.xMin, 'le suivi clamped doit rester dans le decor : ' + n.position.x);
});