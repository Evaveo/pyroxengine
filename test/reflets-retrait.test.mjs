// RETIRER UN ENVIRONNEMENT N'EST PAS SYMÉTRIQUE D'EN POSER UN.
//
// LE PLANTAGE MESURÉ (v0.108.0). Couper « reflets du ciel » fait rendre `null` à
// `envMapOfSky()`, donc écrire `m.envMap = null` sur chaque matériau qui en portait un. Sous
// le renderer WebGPU, ce matériau a DÉJÀ construit le groupe de bindings qui porte le sampler
// de l'ancienne texture. `needsUpdate` reconstruit le programme — pas ce groupe : le binding
// survit en référençant une texture devenue nulle, et son `equals()` déréférence
// `texture.isTexture` à chaque image.
//
//   Uncaught TypeError: Cannot read properties of null (reading 'isTexture')
//       at Os.equals (three.webgpu.min.js)
//       at UB.render → loop (viewport.js)
//
// Répété par image, jusqu'au rechargement de la page. Rien ne l'attrape : le code qui écrit
// `null` est parfaitement correct au sens de three.js « classique ».
//
// La garde vérifie les DEUX moitiés du remède, parce que chacune se perd séparément :
//   1. le retrait libère les ressources GPU du matériau (`dispose`), donc ses bindings ;
//   2. il ne le fait QUE sur la transition — sinon on disposerait un matériau par appel, ce
//      qui remplacerait un plantage par une recompilation tout aussi invisible.
//
// Et elle vérifie l'éditeur ET le runtime : le jeu publié porte le même code, et c'est là que
// la panne coûterait le plus cher.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const lire = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// Les deux fonctions sont extraites de leur fichier et évaluées seules : elles ne dépendent
// que de leur argument, et charger tout probes.js demanderait THREE, la scène et le dock.
function extraire(fichier, nom){
  const src = lire(fichier);
  const debut = src.indexOf('function ' + nom + '(');
  assert.ok(debut !== -1, nom + ' introuvable dans ' + fichier);
  // La fonction s'arrête à la première accolade fermante en début de ligne.
  const fin = src.indexOf('\n}', debut);
  const corps = src.slice(debut, fin + 2);
  return new Function('acceptsEnvironment', corps + '; return ' + nom + ';')(
    (m) => !!m && (m.isMeshStandardMaterial === true || m.isMeshPhysicalMaterial === true));
}

function materiau(avec){
  return {
    isMeshStandardMaterial: true,
    envMap: avec ? {isTexture: true} : null,
    envNode: null,
    envMapIntensity: 1,
    needsUpdate: false,
    disposed: 0,
    dispose(){ this.disposed += 1; }
  };
}

const CAS = [
  ['editeur', 'js/probes.js', 'setEnvironmentOn'],
  ['runtime', 'js/game-runtime.js', 'rtSetEnvironmentOn']
];

CAS.forEach(function(cas){
  const nom = cas[0], fichier = cas[1], fonction = cas[2];

  test(nom + ' : RETIRER l environnement libere les bindings du materiau', () => {
    const set = extraire(fichier, fonction);
    const m = materiau(true);
    set(m, null, 1, null);
    assert.equal(m.envMap, null, 'l environnement doit bien etre retire');
    assert.equal(m.disposed, 1,
      'sans dispose(), le binding de l ancienne texture survit et dereference null par image');
  });

  test(nom + ' : POSER un environnement ne dispose RIEN', () => {
    const set = extraire(fichier, fonction);
    const m = materiau(false);
    set(m, {isTexture: true}, 1, null);
    assert.equal(m.disposed, 0, 'disposer en posant recompilerait le materiau pour rien');
  });

  test(nom + ' : un retrait DEJA fait ne redispose pas', () => {
    const set = extraire(fichier, fonction);
    const m = materiau(false);           // aucun environnement au depart
    set(m, null, 1, null);
    set(m, null, 1, null);
    assert.equal(m.disposed, 0,
      'la garde d egalite doit sortir avant toute liberation : applyProbes passe ici a chaque '
      + 'changement de reglage, et disposer a chaque appel coute une recompilation');
  });
});

test('la liberation est conditionnee a la TRANSITION, et c est ecrit', () => {
  // Une relecture rapide pourrait « simplifier » le dispose conditionnel en dispose
  // inconditionnel : le test ci-dessus l attraperait, celui-ci dit pourquoi en clair.
  [['js/probes.js'], ['js/game-runtime.js']].forEach(function(paire){
    assert.match(lire(paire[0]), /tex === null && \(m\.envMap \|\| m\.envNode\)/,
      paire[0] + ' : la liberation doit etre conditionnee a la transition vers null');
  });
});

test('removeProbesOfMaterials libere aussi — c est le second chemin de retrait', () => {
  // Il ne passe PAS par setEnvironmentOn : il ecrit `envMap = null` directement, et portait
  // donc exactement le meme defaut.
  const src = lire('js/probes.js');
  const debut = src.indexOf('function removeProbesOfMaterials');
  assert.ok(debut !== -1);
  assert.match(src.slice(debut, debut + 900), /m\.dispose\(\)/,
    'le retrait en masse doit liberer les bindings comme le retrait unitaire');
});
