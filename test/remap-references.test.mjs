// TOUTE RÉFÉRENCE D'ASSET DOIT ÊTRE REMAPPÉE AU CHARGEMENT.
//
// Les ids d'assets sont RÉATTRIBUÉS à l'ouverture d'un project. Une référence qu'on oublie de
// remapper survit donc intacte dans le fichier et ne désigne plus rien — ou pire, désigne autre
// chose. Le fichier est valide ; c'est sa relecture qui ment.
//
// Mesuré sur un jeu réel enregistré puis rouvert : le héros affichait la planche des murs, les
// gemmes pointaient vers une TEXTURE au lieu d'une planche, et la salle se peignait avec le sprite
// des gemmes. Toutes les références avaient glissé du même number de rangs. Aucun message, aucune
// error — juste un jeu méconnaissable.
//
// L'avertissement était déjà écrit dans le remappeur : « Une référence ajoutée ailleurs doit
// toujours passer par ici. » Le monde 2D en a ajouté deux, et n'y est jamais passé. Cette garde
// existe pour que la prochaine ne s'oublie pas non plus.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');

function corpsDuRemappeur(){
  const src = read('js/serialization.js');
  const i = src.indexOf('function remapReferencesAssetsInScenes');
  assert.notEqual(i, -1, 'le remappeur a disparu');
  const end = src.indexOf('\nfunction ', i + 10);
  return src.slice(i, end === -1 ? src.length : end);
}

/** Les clés du littéral affecté à `userData.<key>`, commentaires exclus. */
function defautsDe(file, key){
  const src = read(file);
  const i = src.indexOf('userData.' + key + ' = {');
  assert.notEqual(i, -1, file + ' : défauts de ' + key + ' introuvables');
  let n = 0, end = i;
  for(let k = src.indexOf('{', i); k < src.length; k++){
    if(src[k] === '{') n++;
    else if(src[k] === '}'){ n--; if(!n){ end = k; break; } }
  }
  return (src.slice(i, end).split('\n').filter(function(l){ return !/^\s*\/\//.test(l); }).join('\n')
    .match(/(\w+)\s*:/g) || []).map(function(m){ return m.replace(/\s*:$/, ''); });
}

test('TOUTE CLE EN « Id » d un composant est remappee — le test qui porte le fichier', () => {
  const rem = corpsDuRemappeur();
  const oublies = [];
  [['js/components/component-sprite.js', 'sprite2d'],
   ['js/components/component-anim-sprite.js', 'animSprite'],
   ['js/world-2d.js', 'body2d'],
   ['js/world-2d.js', 'collider2d'],
   ['js/world-2d.js', 'controller2d'],
   // Les composants 3D aussi : la regle ne connait pas de frontiere entre les deux mondes, et
   // s y limiter laissait passer la perte du remappage de l animator — une reference deja
   // surveillee, que la garde ne voyait pas parce qu elle ne regardait que le 2D.
   // Le defaut de l animator vit dans js/component-data.js (file PARTAGE des defauts),
   // plus dans le fichier du component : celui-ci construit ses donnees depuis `opts`.
   ['js/component-data.js', 'animator'],
   ['js/component-data.js', 'uiDoc']].forEach(function(c){
    defautsDe(c[0], c[1]).forEach(function(k){
      // Une clé qui finit par « Id » DÉSIGNE un asset : c'est la convention du dépôt, et c'est
      // ce qui permet de les trouver sans les énumérer à la main.
      // DANS SON PROPRE CONTEXTE. Chercher juste « spriteId » quelque part laissait passer la
      // suppression du remappage des OBJETS, parce que celui des materiaux de map contient le
      // meme mot : le nom restait ecrit, et la moitie des references n etait plus rattrapee.
      // DEUX preuves, pas une. L affectation SEULE laissait passer un if(false) qui rend le bloc
      // mort : le code reste ecrit et ne s execute jamais. On exige donc aussi que la CONDITION
      // nomme la reference — c est ce qui distingue un remappage vivant d un remappage decoratif.
      if(!/Id$/.test(k)) return;
      const affectation = 'o.' + c[1] + '.' + k + ' = assetsById[';
      const condition   = 'o.' + c[1] + '.' + k + ')';
      if(rem.indexOf(affectation) < 0) oublies.push(c[1] + '.' + k + ' (jamais remappee)');
      else if(rem.indexOf(condition) < 0) oublies.push(c[1] + '.' + k + ' (block mort : la condition ne la teste plus)');
    });
  });
  assert.deepEqual(oublies, [], 'références d\'asset que le chargement ne remappe pas :\n  '
    + oublies.join('\n  ') + '\n  → elles pointeront vers un autre asset à la réouverture.');
});

test('LES REFERENCES IMBRIQUEES aussi — celles qu aucune convention ne trouve', () => {
  // `paletteId` vit dans les DONNÉES d'un composant : aucune lecture des défauts ne peut la
  // voir, puisqu'elle y vaut `null`. On la nomme donc ici, en clair, avec la raison — c'est le
  // prix des références qu'une convention ne rattrape pas.
  const rem = corpsDuRemappeur();
  assert.match(rem, /c\.type === 'Tilemap' && c\.data && c\.data\.paletteId/,
    'la palette d une map de tuiles n est pas remappee : la salle se repeindra avec la '
    + 'mauvaise palette');
  assert.match(rem, /c\.data\.paletteId = assetsById\[c\.data\.paletteId\]/,
    'le remappage de la palette ne retombe pas sur l asset relu');

  // L'ASSET D'UN MODÈLE IMPORTÉ (glTF/FBX) : même défaut, mesuré sur jeux/TPS — un modèle qui se
  // charge très bien au premier import disparaissait systématiquement dès la première réouverture
  // du projet (« asset absent du projet ? »), parce que `Model.data.assetId` ne vivait dans aucune
  // convention par défaut (Model ne détient rien, voir component-model.js) et qu'aucun remappage
  // explicite ne le couvrait.
  assert.match(rem, /c\.type === 'Model' && c\.data && c\.data\.assetId/,
    'l asset d un modèle importé (glTF/FBX) n est pas remappé : le modèle disparaît à la réouverture du projet');
  assert.match(rem, /c\.data\.assetId = target \? target\.id : null/,
    'le remappage de l asset du modèle ne retombe pas sur l asset relu');
});

test('CHAQUE REMAPPAGE RETOMBE SUR null, jamais sur l old id', () => {
  // Garder l old id quand l asset a disparu ferait pointer la reference vers CE QUE CET ID
  // DESIGNE MAINTENANT — un autre asset, choisi au hasard du rang. Mieux vaut une reference empty,
  // que le reste du moteur sait traiter, qu une reference plausible et fausse.
  //
  // La regle est lue telle qu elle s ecrit : apres « .id : », il ne doit y avoir que null. Une
  // version precedente comptait les « null » et les comparait au number de ternaires — un repli
  // fautif passait des qu une autre ligne en portait deux.
  const rem = corpsDuRemappeur();
  const replis = [];
  let k = 0;
  while((k = rem.indexOf('.id : ', k)) !== -1){
    replis.push(rem.slice(k + 6, rem.indexOf(';', k)).trim());
    k += 6;
  }
  assert.ok(replis.length >= 8, 'seulement ' + replis.length + ' remappages lus : le test ne mesure rien');
  const fautifs = replis.filter(function(r){ return r !== 'null'; });
  assert.deepEqual(fautifs, [], 'ces remappages retombent sur autre chose que null : ' + fautifs.join(' | '));
});
