// UNE TEXTURE DIRECTE DOIT ÊTRE REPOSÉE APRÈS LE MATÉRIAU, DANS LES DEUX MOTEURS.
//
// Un objet peut être habillé de deux façons exclusives : une texture déposée dessus
// (`userData.texAsset`) ou un matériau d'asset (`userData.materialId`). Les deux sont
// enregistrées dans le fichier — et à la relecture, celle qui est appliquée en DERNIER gagne.
//
// Or `applyMaterialOn()` RECONSTRUIT `o.material` : elle efface la texture au passage.
// Tant que le chargement posait la texture puis le matériau, toute texture directe disparaissait
// au rechargement. Et elle disparaissait pour TOUS les objets, puisqu'ils reçoivent le matériau
// par défaut du project dès leur création (js/objects.js) : le fichier contenait bien « texAsset:
// a9 », l'object rouvert n'avait plus aucune map. Mesuré sur un jeu réel : sol, murs et cubes
// rendus gris, dans l'éditeur comme dans le jeu publié.
//
// Ce que cette garde vérifie n'est PAS que le nom soit écrit quelque part : c'est que l'appel
// soit DANS le bloc du matériau et à profondeur 0 — donc qu'il s'exécute vraiment chaque fois
// qu'un matériau vient d'écraser la texture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');

/** La source privée de ses commentaires de ligne : les accolades comptées doivent être du CODE. */
function sansCommentaires(src){
  return src.split('\n').map(function(l){
    const i = l.indexOf('//');
    return i === -1 ? l : l.slice(0, i);
  }).join('\n');
}

/**
 * Le CORPS du bloc `{ ... }` qui contient `appel`, et la profondeur d'accolades de chaque
 * caractère à l'intérieur. Sert à distinguer « écrit dans le bloc » de « écrit dans un sous-block
 * conditionnel du bloc », qui ne s'exécute pas forcément.
 */
function blocContenant(src, appel, quoi){
  const i = src.indexOf(appel);
  assert.notEqual(i, -1, quoi + ' : « ' + appel + ' » a disparu');
  assert.equal(src.indexOf(appel, i + 1), -1, quoi + ' : « ' + appel + ' » apparaît deux fois');
  const ouvre = src.lastIndexOf('{', i);
  assert.notEqual(ouvre, -1, quoi + ' : pas de bloc autour de l appel');
  let n = 0, end = -1;
  for(let k = ouvre; k < src.length; k++){
    if(src[k] === '{') n++;
    else if(src[k] === '}'){ n--; if(!n){ end = k; break; } }
  }
  assert.notEqual(end, -1, quoi + ' : block non refermé');
  return {body: src.slice(ouvre + 1, end), posAppel: i - (ouvre + 1)};
}

/** Profondeur d'accolades à l'index `pos` d'un body de bloc. 0 = exécuté inconditionnellement. */
function profondeurA(body, pos){
  let n = 0;
  for(let k = 0; k < pos; k++){
    if(body[k] === '{') n++;
    else if(body[k] === '}') n--;
  }
  return n;
}

const CAS = [
  {file: 'js/serialization.js', engine: 'éditeur',
   material: 'applyMaterialOn(matA, o)', texture: 'applyTextureRaw('},
  {file: 'js/game-runtime.js', engine: 'game publié',
   material: 'applyMaterialRuntime(assetsById[d.materialId], o)', texture: 'rtSetTextureDirect('}
];

CAS.forEach(function(c){
  test(c.engine + ' : la texture directe est reposée APRÈS le matériau, sans condition', function(){
    const src = sansCommentaires(read(c.file));
    const block = blocContenant(src, c.material, c.engine);

    const apres = block.body.indexOf(c.texture, block.posAppel);
    assert.notEqual(apres, -1, c.engine + ' : aucune reprise de la texture APRÈS le matériau — '
      + 'le matériau vient de reconstruire le maillage, la texture du fichier est perdue');

    // « après » ne suffit pas : encore faut-il que ce soit dans le MÊME bloc que le matériau.
    // blocContenant() a déjà découpé ce bloc-là, donc l'index trouvé y est par construction.
    const p = profondeurA(block.body, apres);
    assert.equal(p, 0, c.engine + ' : la reprise est imbriquée dans une condition (profondeur '
      + p + ') — elle ne s exécute donc pas à chaque matériau appliqué');
  });
});

test('l invariant dont dépend la reprise : poser un matériau EFFACE texAsset', function(){
  // Sans cet effacement, un `texAsset` enregistré ne prouverait plus que la texture a été posée
  // APRÈS le matériau — et la reposer en dernier au chargement deviendrait FAUX : on
  // ressusciterait une texture que l auteur avait justement remplacée par un matériau.
  const src = sansCommentaires(read('js/materials.js'));
  const i = src.indexOf('function applyMaterialOn');
  assert.notEqual(i, -1, 'applyMaterialOn a disparu');
  const end = src.indexOf(String.fromCharCode(10) + 'function ', i + 10);
  const body = src.slice(i, end === -1 ? src.length : end);
  assert.ok(body.indexOf('userData.texAsset = null') !== -1,
    'applyMaterialOn n efface plus texAsset : la reprise du chargement n est plus fondée');
});
