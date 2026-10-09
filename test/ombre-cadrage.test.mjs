import { deEsm } from './engine-env.mjs';
// UNE LUMIÈRE DIRECTIONNELLE ÉCLAIRE TOUT ; SON OMBRE, NON.
//
// LE BUG MESURÉ (v0.108.0). `DirectionalLightShadow` reçoit de three.js une caméra
// orthographique `(-5, 5, 5, -5, 0.5, 500)` — une boîte de 10 × 10 unités monde. Rien dans le
// moteur ne la redimensionnait : `js/objects.js` et `js/components/component-light.js`
// réglaient `shadow.mapSize` (la RÉSOLUTION) et jamais `shadow.camera` (l'ÉTENDUE).
//
// Au-delà de cette boîte, les fragments échantillonnent hors de la carte d'ombre et se lisent
// comme ombrés : une frontière rectiligne en travers de la scène, sans rapport avec la
// géométrie, et tout le lointain dans le noir. Ça ressemble à un problème d'éclairage, c'est
// un problème de cadrage — et rien ne lève.
//
// Le calcul est écrit pur exactement pour être mesuré ici : le harnais n'a pas de moteur de
// rendu, donc l'erreur ne se verrait qu'à l'écran, chez quelqu'un, plus tard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const lire = (p) => deEsm(fs.readFileSync(path.join(root, p), 'utf8'));

function charger(){
  return new Function(lire('js/shadow-fit.js') + '; return ShadowFit;')();
}

const boite = (r) => ({min: {x: -r, y: -r, z: -r}, max: {x: r, y: r, z: r}});
const ORIGINE = {x: 0, y: 0, z: 0};

test('le soleil par defaut (eclairage global) ne PROJETTE pas d ombre, des deux cotes', () => {
  // Revu (v0.131.1) : ce soleil est l ECLAIRAGE GLOBAL de l environnement (reglage `env.sun`),
  // sans composant ni existence dans le projet. Le laisser projeter une ombre en ajoutait une
  // seconde, decalee, des qu on posait son propre composant Light directionnel — deux ombres
  // pour un seul soleil apparent. Les ombres ne doivent venir QUE d une lumiere posee comme
  // composant (component-light.js).
  ['js/scene.js', 'js/game-runtime.js'].forEach((f) => {
    assert.match(lire(f), /(^|\n)(game\.)?sun\.castShadow = false;/,
      f + ' : le soleil par defaut ne doit pas projeter d ombre');
  });
});

test('la boite d ombre COUVRE la scene, au lieu des 10 unites de three', () => {
  const S = charger();
  const f = S.fit(boite(40), ORIGINE, 500, 1024);
  // Le coin le plus eloigne d'un cube de +-40 est a 40*racine(3) ~= 69,3.
  assert.ok(f.right >= 69, 'la scene deborde encore de la boite : ' + f.right);
  assert.equal(f.left, -f.right, 'la boite doit rester centree sur la cible');
});

test('elle se mesure depuis la CIBLE de la lumiere, pas depuis le centre du monde', () => {
  const S = charger();
  // La cible d'un composant Light est un enfant pose a (0,-4,0) : elle n'est pas au centre.
  // Mesurer depuis le centre laisserait hors champ toute la moitie opposee a la lumiere.
  const centre = S.fit(boite(10), ORIGINE, 500, 1024).right;
  const decale = S.fit(boite(10), {x: 30, y: 0, z: 0}, 500, 1024).right;
  assert.ok(decale > centre,
    'une cible decalee doit AGRANDIR le rayon, sinon la scene sort du cadre');
});

test('la portee du PROJET plafonne le rayon', () => {
  const S = charger();
  // Sans plafond, un seul objet egare a mille unites etirerait la camera d'ombre sur deux
  // mille, et l'ombre de toute la scene deviendrait un pate de quelques texels.
  const f = S.fit(boite(1000), ORIGINE, 60, 1024);
  assert.equal(f.right, 60);
  assert.equal(f.radius, 60);
});

test('une scene VIDE ne produit pas une camera degeneree', () => {
  const S = charger();
  // Un rayon nul projetterait sur un plan de largeur zero, et three.js ne dirait rien.
  [null, undefined, {min: ORIGINE, max: ORIGINE}].forEach((b) => {
    const f = S.fit(b, ORIGINE, 60, 1024);
    assert.ok(f.right > 0, 'rayon nul pour ' + JSON.stringify(b));
    assert.ok(f.far > f.near, 'far doit rester au-dela de near');
  });
});

test('far couvre les DEUX cotes de la cible', () => {
  const S = charger();
  // La camera d'ombre est reculee le long de la direction de la lumiere : la scene s'etend
  // devant ET derriere la cible. Un `far` egal au rayon couperait la moitie arriere.
  const f = S.fit(boite(20), ORIGINE, 500, 1024);
  assert.ok(f.far >= f.radius * 2, 'far trop court : ' + f.far + ' pour un rayon ' + f.radius);
});

test('la taille d un texel suit l etendue ET la resolution', () => {
  const S = charger();
  const petit = S.fit(boite(10), ORIGINE, 500, 1024).texelWorldSize;
  const grand = S.fit(boite(100), ORIGINE, 500, 1024).texelWorldSize;
  assert.ok(grand > petit, 'doubler l etendue doit grossir le texel');
  const fin = S.fit(boite(10), ORIGINE, 500, 2048).texelWorldSize;
  assert.ok(fin < petit, 'doubler la resolution doit affiner le texel');
});

test('le biais est DEDUIT du texel, jamais une constante', () => {
  const S = charger();
  // Un biais regle pour 10 unites laisse rayer la scene a 200 ; regle pour 200, il decolle
  // les ombres de leurs objets quand on revient a 10.
  assert.ok(S.normalBias(0.5) > S.normalBias(0.05));
  assert.equal(S.normalBias(0), 0);
  assert.equal(S.normalBias(undefined), 0, 'une valeur illisible ne doit pas produire NaN');
});

// ---------- Le reglage de projet ----------

test('shadowDistance est un reglage de PROJET, avec defaut et bornes', () => {
  const src = lire('js/project-settings.js');
  assert.match(src, /'shadowDistance'/,
    'la cle doit etre listee dans PROJECT_SETTINGS_KEYS, sinon elle ne se serialise pas');
  assert.match(src, /shadowDistance: clampShadowDistance\(brut\.shadowDistance\)/,
    'un projet sans la cle doit recevoir le defaut, sans migration');
  // Les trois bornes sont LUES dans le fichier, jamais recopiees ici : un test qui redeclare
  // les valeurs qu'il verifie ne verifie plus rien — il passerait encore apres qu'on ait
  // change le defaut dans le code sans le vouloir.
  const constantes = src.slice(src.indexOf('const SHADOW_DISTANCE_DEFAULT'),
                               src.indexOf('function clampShadowDistance'));
  const debut = src.indexOf('function clampShadowDistance');
  const corps = src.slice(debut, src.indexOf('\n}', debut) + 2);
  const clamp = new Function(constantes + corps + '; return clampShadowDistance;')();
  // Le defaut est LU, pas recopie : un test qui redeclare la valeur qu'il verifie continue de
  // passer apres qu'on l'a changee dans le code sans le vouloir.
  const defaut = Number((src.match(/SHADOW_DISTANCE_DEFAULT = (\d+)/) || [])[1]);
  assert.ok(Number.isFinite(defaut), 'SHADOW_DISTANCE_DEFAULT introuvable');
  assert.equal(clamp(undefined), defaut, 'absent -> defaut');
  assert.equal(clamp('abime'), defaut, 'illisible -> defaut, jamais NaN');
  assert.equal(clamp(1), 5, 'sous la borne basse, l ombre disparait sous son objet');
  assert.equal(clamp(9999), 500, 'au-dessus, un texel couvre un demi-metre de terrain');
  assert.equal(clamp(120), 120, 'une valeur valide passe telle quelle');
});

// ---------- L editeur et le mode Lecture doivent MONTRER la meme chose ----------
//
// Le mode Lecture (js/play-mode.js) ouvre game-preview.html, qui fait tourner js/game-runtime.js
// — le MEME code qu'un build exporte, mais un autre renderer, une autre scene, un autre
// parcours de construction. Chaque reglage de rendu existe donc en DOUBLE, et rien ne dit
// quand les deux exemplaires cessent de coincider : l'editeur montre une ombre, le jeu n'en
// montre pas, et il faut ouvrir les deux cote a cote pour s'en apercevoir.
//
// C'est la sortie PRINCIPALE : c'est elle qui a raison, et l'editeur doit lui ressembler.

test('les deux cotes activent les ombres, et du MEME type', () => {
  const editeur = lire('js/scene.js');
  const runtime = lire('js/game-runtime.js');
  [['js/scene.js', editeur], ['js/game-runtime.js', runtime]].forEach(function(p){
    assert.match(p[1], /renderer\.shadowMap\.enabled = true/,
      p[0] + ' : les ombres doivent etre allumees au demarrage');
  });
  // Le TYPE decide de la douceur des contours. Deux types differents, c'est un jeu qui ne
  // ressemble pas a ce qu'on a cadre dans l editeur, sans qu'aucun reglage ne l explique.
  const typeDe = (src) => (src.match(/renderer\.shadowMap\.type = THREE\.(\w+)/) || [])[1];
  assert.equal(typeDe(editeur), typeDe(runtime),
    'l editeur et le jeu publie n ont pas le meme type d ombre');
});

test('le recadrage ne DEPLACE aucune lumiere', () => {
  // LA REGRESSION MESUREE (v0.108.0). Pour recentrer la carte d'ombre sur ce que voit la
  // camera, la premiere version deplacait la lumiere elle-meme. Invisible pour le soleil par
  // defaut — il n'a aucune representation — mais une directionnelle POSEE dans la scene a un
  // repere et une ligne d'aide : ils se sont mis a suivre la camera de scene. On ne touche pas
  // a un objet que l'utilisateur a place pour ameliorer un rendu.
  //
  // Le remede : une camera orthographique accepte des bornes ASYMETRIQUES. On decale la boite
  // au lieu de deplacer la lumiere, ce qui donne exactement le meme cadrage sans rien bouger.
  ['js/scene.js', 'js/game-runtime.js'].forEach((f) => {
    const src = lire(f).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/[^\n]*/gm, ' ');
    const debut = src.indexOf(f === 'js/scene.js' ? 'function updateShadows' : 'function rtUpdateShadows');
    const corps = src.slice(debut, src.indexOf('\n}', debut));
    assert.doesNotMatch(corps, /l\.position\.copy|l\.position\.set/,
      f + ' : la lumiere est deplacee — son repere suivra la camera');
    assert.doesNotMatch(corps, /l\.target\.position\.copy|l\.target\.position\.set/,
      f + ' : la cible est deplacee — la ligne d aide suivra la camera');
    // Ce qui remplace le deplacement : des bornes decalees du centre.
    assert.match(corps, /cam\.left = cx - radius/,
      f + ' : la boite doit etre decalee, pas centree sur la lumiere');
  });
});

test('le recadrage des ombres est appele des DEUX cotes', () => {
  // Sans lui, la camera d ombre garde la boite de 10 unites de three.js. C est exactement ce
  // qui faisait « pas d ombres en mode Lecture » : la scene du jeu tombait hors de la boite.
  assert.match(lire('js/scene.js'), /function updateShadows\(camera\)/);
  assert.match(lire('js/game-runtime.js'), /function rtUpdateShadows\(camera\)/);
  // APPELEES dans la boucle de rendu de chaque cote, sur la camera COURANTE : une carte
  // d ombre qui ne suit pas la camera laisse une bande sans ombre derriere le joueur des
  // qu il avance, et c est precisement ce qui doit etre identique entre les deux sorties.
  assert.match(lire('js/viewport.js'), /updateShadows\(camCurrent\(\)\)/,
    'la boucle de l editeur doit recadrer avant de rendre');
  assert.match(lire('js/game-runtime.js'), /rtUpdateShadows\(game\.cam\)/,
    'la boucle du jeu doit recadrer avant de rendre');
  // Le module partage doit etre CHARGE par la page du jeu, sinon rtUpdateShadows sort en
  // silence sur son garde `typeof ShadowFit` et le jeu repart sans ombres.
  assert.match(lire('game-preview.html'), /js\/shadow-fit\.js/,
    'game-preview.html ne charge pas js/shadow-fit.js');
});

test('l editeur ET le jeu publie cadrent par le MEME calcul', () => {
  // Deux implementations divergeraient au premier reglage touche d'un seul cote, et l ombre
  // du build ne serait plus celle qu on voyait dans l editeur.
  ['js/scene.js', 'js/game-runtime.js'].forEach((f) => {
    assert.match(lire(f), /ShadowFit\.frustumSphere\(/,
      f + ' : le cadrage doit venir du frustum de la camera, pas des bornes de la scene');
    assert.match(lire(f), /ShadowFit\.snapToTexel\(/,
      f + ' : sans calage sur les texels, tous les bords d ombre fourmillent en mouvement');
  });
  ['js/scene.js', 'js/game-runtime.js'].forEach((f) => {
    assert.match(lire(f), /cam\.updateProjectionMatrix\(\)/,
      f + ' : sans updateProjectionMatrix, les valeurs sont ecrites et rien ne change');
  });
});

test('le recadrage a lieu AUSSI quand le post-traitement est actif', () => {
  // LE DEFAUT MESURE (v0.140.1). La boucle du jeu recadrait les ombres dans la seule branche
  // SANS post-traitement :
  //
  //     if(postState){ rtPostRender(...); }
  //     else { rtUpdateShadows(game.cam); renderer.render(...); }
  //
  // Des qu une scene porte un PostVolume — ce que fait tout projet un peu fini — la carte
  // d ombre restait donc cadree la ou le CHARGEMENT l avait posee, et plus rien ne la
  // suivait. Symptome exact : des ombres partout dans l editeur (dont la boucle, elle,
  // recadre avant de choisir sa branche) et « pas ou peu d ombres » des qu on joue.
  //
  // Le test voisin (« appele des DEUX cotes ») ne pouvait pas le voir : il cherchait la
  // presence du texte de l appel, pas sa POSITION. C est par la que le defaut est passe.
  const src = lire('js/game-runtime.js');
  const iPost = src.indexOf('rtPostRender(game.scene');
  const iDirect = src.indexOf('renderer.render(game.scene, game.cam)');
  assert.ok(iPost > 0 && iDirect > 0, 'les deux chemins de rendu du jeu sont introuvables');

  // Le recadrage doit preceder le CHOIX de la branche, donc precede les deux rendus.
  const appels = [...src.matchAll(/rtUpdateShadows\(game\.cam\)/g)].map((m) => m.index);
  const iLoop = src.indexOf('function loop()');
  assert.ok(iLoop > 0, 'la boucle de rendu du jeu est introuvable');
  assert.ok(appels.some((i) => i > iLoop && i < Math.min(iPost, iDirect)),
    'rtUpdateShadows n est pas appele avant les deux chemins de rendu : une scene avec un'
    + ' PostVolume perd le suivi de sa carte d ombre des la premiere image.');

  // Et il n est pas ENFERME dans la branche sans post : entre le rendu direct et la fin de
  // la boucle, un appel isole signerait le retour du defaut.
  const apresPost = src.slice(iPost, iDirect);
  assert.ok(!/rtUpdateShadows/.test(apresPost) || appels.some((i) => i < iPost),
    'le recadrage ne doit pas dependre de la branche de rendu choisie');
});

test('le cadrage des ombres lit la profondeur NDC du plan proche de la caméra (ortho + WebGPU)', () => {
  // Sous WebGPU le plan proche est à z = 0, pas -1. Avec -1, une caméra orthographique (jeu iso)
  // voyait sa sphère d'ombre reculer derrière elle : plus aucune ombre en jeu, alors que
  // l'éditeur (caméra perspective, erreur invisible) en montrait.
  const ShadowFit = charger();
  assert.equal(ShadowFit.nearNdcZ({coordinateSystem: 2001}), 0, 'WebGPU : plan proche à 0');
  assert.equal(ShadowFit.nearNdcZ({coordinateSystem: 2000}), -1, 'WebGL : plan proche à -1');
  assert.equal(ShadowFit.nearNdcZ(null), -1);
  for(const f of ['js/scene.js', 'js/game-runtime.js']){
    assert.ok(/ShadowFit\.nearNdcZ\(camera\)/.test(lire(f)), f + ' dé-projette encore avec un -1 en dur');
  }
});

test('clampDepth ignore la partie d une caméra ortho située derrière elle (near négatif)', () => {
  const ShadowFit = charger();
  const V = (x, y, z) => ({x, y, z, clone(){ return V(this.x, this.y, this.z); },
    lerpVectors(a, b, t){ this.x = a.x + (b.x - a.x) * t; this.y = a.y + (b.y - a.y) * t; this.z = a.z + (b.z - a.z) * t; return this; }});
  // Profondeur le long de z : near -1000 → z=1000 (derrière), far 1000 → z=-1000.
  const corners = [V(0,0,1000),V(0,0,1000),V(0,0,1000),V(0,0,1000),V(0,0,-1000),V(0,0,-1000),V(0,0,-1000),V(0,0,-1000)];
  ShadowFit.clampDepth(corners, {near: -1000, far: 1000}, 60);
  assert.ok(Math.abs(corners[0].z - 0) < 1e-9, 'plan proche ramené à la caméra, pas 1000 unités derrière');
  assert.ok(Math.abs(corners[4].z - (-60)) < 1e-9, 'plan lointain à la portée des ombres');
});
