// CE QU'UN SCRIPT ENGENDRE DOIT AVOIR UN CORPS, ET LE RENDRE EN MOURANT.
//
// `api.create` ajoutait l'object à la scène et s'arrêtait là. Le prefab avait beau déclarer
// `phys.active`, rien ne construisait son body : l'objet ne tombait pas, ne heurtait rien, et
// `api.setVelocity` ne trouvait aucun link — elle rendait `null`, sans un mot. Mesuré : des
// cubes tirés qui restent plantés à la bouche du canon.
//
// Le pendant est aussi silencieux : `api.destroy` retirait l'objet de la scène sans unregister son
// body du monde. Un collider invisible restait là. Dans un jeu où chaque fusion détruit deux
// cubes, l'arène se remplit de murs qu'on ne voit pas — et le défaut se cherche dans les
// collisions, jamais dans une liste.
//
// Les deux se mesurent, et un troisième invariant les protège : il n'existe QU'UN chemin pour
// brancher un body et QU'UN pour le unregister. Deux copies du même code, c'est la garantie qu'un
// jour l'une recevra une correction et pas l'autre — c'est exactement ce qui venait de se passer
// entre le démarrage de la simulation et api.create.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LF = String.fromCharCode(10);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8').split(String.fromCharCode(13)).join('');
const sansCommentaires = (s) => s.split(LF)
  .map(function(l){ const i = l.indexOf('//'); return i === -1 ? l : l.slice(0, i); }).join(LF);

/** Le body d'un bloc `{ ... }` open à partir de `depuis`, accolades appariées. */
function block(src, depuis, quoi){
  const o = src.indexOf('{', depuis);
  assert.notEqual(o, -1, quoi + ' : pas de bloc');
  let n = 0;
  for(let k = o; k < src.length; k++){
    if(src[k] === '{') n++;
    else if(src[k] === '}'){ n--; if(!n) return src.slice(o + 1, k); }
  }
  assert.fail(quoi + ' : block non refermé');
}
function corpsDeFonction(src, name, quoi){
  const i = src.indexOf(name);
  assert.notEqual(i, -1, quoi + ' : « ' + name + ' » a disparu');
  return block(src, i, quoi);
}
const count = (s, motif) => s.split(motif).length - 1;

const MOTEURS = [
  {name: 'éditeur', file: 'js/scripts.js', physics: 'js/physics.js',
   create: '    create: function(nameAsset, position){', brancher: 'bindBodyPhysics(',
   detruireDans: 'js/inspector.js', detruireFn: 'function deleteRoot(', detach: 'detachBodyPhysics(',
   link: 'phys.links.push(', cine: 'phys.kinematic.push(', defBrancher: 'function bindBodyPhysics(',
   defDetacher: 'function detachBodyPhysics('},
  {name: 'game publié', file: 'js/game-runtime.js', physics: 'js/game-runtime.js',
   create: '    create:function(nameAsset, position){', brancher: 'rtBindBody(',
   detruireDans: 'js/game-runtime.js', detruireFn: 'game.aDestroy.forEach(', detach: 'rtDetachBody(',
   link: 'game.links.push(', cine: 'game.kinematic.push(', defBrancher: 'function rtBindBody(',
   defDetacher: 'function rtDetachBody('}
];

MOTEURS.forEach(function(m){
  test(m.name + ' : api.create branche la physique de ce qu il engendre', () => {
    const body = corpsDeFonction(sansCommentaires(read(m.file)), m.create, m.name + ' api.create');
    assert.ok(body.indexOf(m.brancher) !== -1,
      m.name + ' : api.create n appelle pas ' + m.brancher + ' — ce qu il engendre arrive sans body, '
      + 'ne tombe pas, ne heurte rien, et setVelocity ne trouve rien à pousser');
  });

  test(m.name + ' : détruire un objet retire aussi son body', () => {
    const body = corpsDeFonction(sansCommentaires(read(m.detruireDans)), m.detruireFn,
      m.name + ' destruction');
    assert.ok(body.indexOf(m.detach) !== -1,
      m.name + ' : la destruction n appelle pas ' + m.detach + ' — le collider reste dans le monde, '
      + 'invisible, et continue d arrêter tout ce qui passe');
  });

  test(m.name + ' : un seul filePath branche un body, un seul le retire', () => {
    const src = sansCommentaires(read(m.physics));
    assert.equal(count(src, m.link), 1,
      m.name + ' : ' + count(src, m.link) + ' endroits poussent un link physique. Un second filePath '
      + 'recevra les corrections de l autre avec un jour de retard, ou jamais.');
    assert.equal(count(src, m.cine), 1,
      m.name + ' : plusieurs endroits poussent un body cinématique');
    assert.equal(count(src, '.removeBody('), 1,
      m.name + ' : ' + count(src, '.removeBody(') + ' endroits retirent un body du monde');

    // ...et ce chemin unique est bien la fonction partagée, pas un endroit quelconque.
    const bBranche = corpsDeFonction(src, m.defBrancher, m.name + ' ' + m.defBrancher);
    assert.ok(bBranche.indexOf(m.link) !== -1,
      m.name + ' : le link n est plus poussé par la fonction de branchement partagée');
    const bDetache = corpsDeFonction(src, m.defDetacher, m.name + ' ' + m.defDetacher);
    assert.ok(bDetache.indexOf('.removeBody(') !== -1,
      m.name + ' : le body n est plus retiré par la fonction de détachement partagée');
  });

  test(m.name + ' : brancher deux fois le même objet est refusé', () => {
    // Deux body pour un maillage se repoussent l un l autre : l object part tout seul, et l on
    // cherche la panne dans la scène. api.create et le démarrage passent par la même porte, donc
    // le cas se présente pour de vrai.
    const b = corpsDeFonction(sansCommentaires(read(m.physics)), m.defBrancher, m.name);
    const gardeLien = b.indexOf(m.link.replace('.push(', '.some(')) !== -1;
    const gardeCine = b.indexOf(m.cine.replace('.push(', '.some(')) !== -1;
    assert.ok(gardeLien && gardeCine,
      m.name + ' : la fonction de branchement ne vérifie plus qu un body existe déjà');
  });
});
