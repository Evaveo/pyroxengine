// ENGENDRER EN COURS DE PARTIE — ce qui manquait pour qu'un jeu 2D en soit un.
//
// `api.create` n'acceptait que les genres `prefab` et `model`. Mesuré : sur une planche
// (`kind: 'sprite'`) il rendait `null`. Et aucune des 44 commandes du copilote ne contient le mot
// « prefab » : la seule voie était un geste d'interface. Un jeu 2D ne pouvait donc faire
// apparaître ni projectile, ni ramassage qui tombe, ni vague d'ennemis, ni éclat.
//
// Second défaut, plus discret : tout ce qui était engendré atterrissait dans `scene`, à CÔTÉ de la
// racine 2D au lieu d'être dedans. Sans conséquence tant que cette racine est à l'origine avec une
// échelle de 1 — et faux dès qu'on la déplace, avec un décalage qui se chercherait dans la
// physique.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');

/** Le body de `api.create` dans un moteur donné. */
function corpsCreer(file, header){
  const src = read(file);
  const i = src.indexOf(header);
  assert.notEqual(i, -1, file + ' : ' + header + ' introuvable');
  const end = src.indexOf('\n    },', i);
  assert.notEqual(end, -1, file + ' : end de api.create introuvable');
  return src.slice(i, end);
}
const MOTEURS = [
  // Chaque moteur pose le sprite à SA manière : l'éditeur par un composant (pour que l'inspecteur
  // et la sérialisation le voient), le runtime en écrivant `userData.sprite2d` puis en construisant
  // la maille. Exiger la même preuve des deux côtés ferait échouer celui qui a raison.
  ['éditeur',    'js/scripts.js',     'create: function(nameAsset, position){',
   /addComponent\('SpriteRenderer'/],
  ['game publié', 'js/game-runtime.js', 'create:function(nameAsset, position){',
   /userData\.sprite2d = \{[\s\S]{0,200}rebuildMeshSprite\(copie\)/]
];

/**
 * Le FILTRE D'ACCEPTATION seul — la condition du `find`, pas le body qui suit.
 *
 * Première version de cette garde : elle cherchait « kind === 'sprite' » n'importe où dans
 * `api.create`. Or la branche qui fabrique le sprite contient la même chose. Retirer `'sprite'` du
 * filtre — c'est-à-dire remettre EXACTEMENT le blocage d'origine — laissait donc le test vert.
 */
function filtreCreer(file, header){
  const c = corpsCreer(file, header);
  const i = c.indexOf('.find(');
  assert.notEqual(i, -1, file + ' : pas de recherche d\'asset dans api.create');
  const end = c.indexOf('});', i);
  return c.slice(i, end === -1 ? c.length : end);
}

test('LES DEUX MOTEURS acceptent d engendrer depuis une PLANCHE — le test qui porte le fichier', () => {
  MOTEURS.forEach(function(m){
    assert.match(filtreCreer(m[1], m[2]), /kind === 'sprite'/,
      m[0] + ' : le FILTRE d\'api.create refuse les planches, donc rien ne peut apparaître dans un jeu 2D');
    // Et il doit vraiment FABRIQUER quelque chose, pas seulement laisser passer le genre.
    assert.match(corpsCreer(m[1], m[2]), m[3],
      m[0] + ' : le genre passe mais aucun sprite n\'est posé — l\'object serait invisible');
  });
});

test('CE QUI EST ENGENDRE va A LA RACINE DE LA SCENE, des deux cotes', () => {
  // Ce test gardait la règle inverse : un objet engendré depuis une planche devait être accroché
  // à la racine « Monde 2D », et marqué `space = '2d'` pour que la règle se déclenche. Les deux
  // ont disparu avec la séparation des mondes — il n'y a plus qu'une scène, et un objet à sprite
  // s'y range comme tous les autres. Ce qui compte encore, et qui est mesuré ici : les deux
  // côtés font la MÊME chose, sinon un jeu publié range sa scène autrement que l'éditeur.
  const ed = corpsCreer('js/scripts.js', 'create: function(nameAsset, position){');
  assert.match(ed, /scene\.add\(copie\)/, 'éditeur : l objet engendré n est pas ajouté à la scène');
  const rt = corpsCreer('js/game-runtime.js', 'create:function(nameAsset, position){');
  assert.match(rt, /game\.scene\.add\(copie\)/, 'jeu publié : l objet engendré n est pas ajouté à la scène');
  for(const [corps, ou] of [[ed, 'éditeur'], [rt, 'jeu publié']]){
    assert.equal(/userData\.space/.test(corps), false,
      ou + ' : la marque d espace subsiste, alors qu il n y a plus qu un monde');
    assert.equal(/root2d/.test(corps), false,
      ou + ' : la racine du monde 2D subsiste');
  }
});


test('L OBJET ENGENDRE ENTRE DANS LA LISTE, sinon aucun systeme ne le voit', () => {
  // `objects` (éditeur) et `game.objets` (runtime) sont ce que parcourent la physique, le tri de
  // profondeur et les scripts. Un objet accroché à la scène mais absent de la liste s'affiche et
  // ne fait rien — le pire des deux mondes, parce qu'il a l'air d'exister.
  const ed = corpsCreer('js/scripts.js', 'create: function(nameAsset, position){');
  // `addSceneObject` des DEUX côtés depuis la tâche 3 : `objects.push` nu poussait dans le
  // tableau sans tenir `_indexObjects`, donc l'objet engendré restait invisible du Registry.
  assert.match(ed, /addSceneObject\(copie\)/, "editeur : l'objet engendre n'entre pas dans objects");
  const rt = corpsCreer('js/game-runtime.js', 'create:function(nameAsset, position){');
  // `addSceneObject` EST l'entrée dans `game.objets` — il pousse dans la liste ET indexe
  // l'objet pour `isSceneObject`, que le Registry interroge (js/component.js). Le
  // `game.objets.push` nu laissait le Registry servir aux Systemes des composants
  // portes par des objets detruits.
  assert.match(rt, /addSceneObject\(copie\)/, 'game publié : l\'object engendré n\'entre pas dans `game.objects`');
});

test('LES TROIS GENRES engendrables sont les MEMES des deux cotes', () => {
  const genres = MOTEURS.map(function(m){
    const c = filtreCreer(m[1], m[2]);
    return ['prefab', 'model', 'sprite'].filter(function(g){ return c.indexOf("'" + g + "'") >= 0; });
  });
  assert.deepEqual(genres[0], genres[1],
    'les deux moteurs n\'engendrent pas les mêmes genres : un script marcherait en édition et pas '
    + 'dans le jeu publié — ' + JSON.stringify(genres));
  assert.deepEqual(genres[0], ['prefab', 'model', 'sprite']);
});

// ---------------------------------------------------------------------------------------------
// TOUT RÉGLAGE DE JEU DOIT ÊTRE ATTEIGNABLE PAR UNE COMMANDE.
//
// C'est le défaut le plus répété de ce engine : la capacité existe, aucun chemin ne l'atteint.
// Six occurrences corrigées cette semaine — la caméra 2D, le mode vue de dessus, le décalage du
// collider, la direction regardée, l'image d'un sprite, l'apparition d'objets. Chacune rendait une
// fonctionnalité INVISIBLE plutôt que cassée, et c'est pour ça qu'aucun test ne les voyait.
//
// Cette garde relit les DÉFAUTS RÉELS de chaque composant 2D dans leur source, et vérifie que
// chaque réglage se retrouve dans le schéma d'au moins une commande. Elle n'énumère pas ce qu'on
// avait en tête : elle lit ce que le code déclare, donc un champ ajouté demain sera surveillé.
// ---------------------------------------------------------------------------------------------

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
  const block = src.slice(i, end).split('\n')
    .filter(function(l){ return !/^\s*\/\//.test(l); }).join('\n');
  return (block.match(/(\w+)\s*:/g) || [])
    .map(function(m){ return m.replace(/\s*:$/, ''); })
    .filter(function(k){ return k !== 'userData' && k !== key; });
}

/**
 * Toutes les clés que les schémas des commandes savent écrire.
 *
 * On découpe d'abord le SCHÉMA de chaque commande, puis on y prend tout `name: {`. Première
 * version : une expression ancrée en début de ligne — elle ratait `l: {type}, h: {type}` écrits
 * côte à côte, et dénonçait comme injoignables des réglages parfaitement exposés. Une garde qui
 * crie au loup se fait désactiver, et emporte avec elle les vrais manques qu'elle voyait.
 */
function clesDesCommandes(){
  const src = read('js/copilot.js') + '\n' + read('js/copilot-workshop.js');
  const keys = new Set();
  let i = 0;
  while((i = src.indexOf('schema:', i)) !== -1){
    const end = src.indexOf('exec:', i);
    const block = src.slice(i, end === -1 ? i + 3000 : end);
    (block.match(/(\w+)\s*:\s*\{/g) || []).forEach(function(m){
      keys.add(m.replace(/\s*:\s*\{$/, ''));
    });
    i = end === -1 ? i + 1 : end;
  }
  return keys;
}

test('CHAQUE REGLAGE 2D est atteignable par une commande — la garde du defaut le plus repete', () => {
  const keys = clesDesCommandes();
  assert.ok(keys.size > 20, 'lecture des schémas ratée (' + keys.size + ' clés) : le test ne mesure rien');
  // `spriteId` et `cases`/`materials` sont écrits à la création ou par `paint_room` : ce ne sont
  // pas des réglages qu'on vient retoucher. Tout le reste doit avoir une porte d'entrée.
  const POSES_A_LA_CREATION = ['spriteId', 'cases', 'materials'];
  // Un réglage peut porter un nom d'usage différent de sa clé interne. `region` s'appelle « image »
  // dans la commande, parce que c'est le mot qu'emploie `slice_sheet` et celui qu'un auteur
  // reconnaît. L'alias est écrit ICI, en clair : sans lui la garde crierait au manque sur un
  // réglage parfaitement exposé, et on finirait par ne plus la croire.
  // Depuis le passage des PARAMETRES de commande a l'anglais (chantier 2 du renommage), la cle
  // interne francaise et le parametre anglais diffferent pour la plupart des settings : la cle
  // vit dans userData (format de project, encore francais), le parametre est ce que tape l'IA.
  // La table dit la correspondance — c'est exactement ce a quoi elle sert.
  const ALIAS = {region: 'image',
    layer: 'layer', order: 'order', teinte: 'tint', retourneX: 'flipX', retourneY: 'flipY',
    sortDepth: 'depthSort', defaultValue: 'default', shape: 'shape', statique: 'static',
    traversable: 'walkThrough', stepUp: 'stepUp', speed: 'speed', speedMax: 'maxSpeed',
    heightJump: 'jumpHeight', memoireJump: 'jumpBuffer',
    actionBottom: 'actionDown', actionRight: 'actionRight', actionTop: 'actionUp',
    actionJump: 'actionJump'};
  const CIBLES = [

    ['js/components/component-sprite.js', 'sprite2d'],
    ['js/components/component-anim-sprite.js', 'animSprite'],
    ['js/world-2d.js', 'body2d'],
    ['js/world-2d.js', 'collider2d'],
    ['js/world-2d.js', 'controller2d']
  ];
  const hors = [];
  CIBLES.forEach(function(c){
    defautsDe(c[0], c[1]).forEach(function(k){
      if(POSES_A_LA_CREATION.indexOf(k) >= 0) return;
      if(!keys.has(k) && !keys.has(ALIAS[k])) hors.push(c[1] + '.' + k);
    });
  });
  assert.deepEqual(hors, [], 'réglages 2D qu\'aucune commande ne sait écrire :\n  ' + hors.join('\n  '));
});

test('configure_sprite REFUSE une image absente de la planche', () => {
  // Sans cette vérification, `regionOfSprite` retombe sur la première image : on croit avoir posé
  // la pose « dos » et on regarde la pose « face », sans un mot. Même piège que `api.spriteImage`.
  const src = read('js/copilot.js');
  const i = src.indexOf("name: 'configure_sprite'");
  assert.notEqual(i, -1, 'la commande configure_sprite a disparu');
  const block = src.slice(i, src.indexOf("name: 'paint_room'", i));
  assert.match(block, /names\.indexOf\(a\.image\) < 0/, 'l\'image n\'est pas cherchée dans la planche');
  assert.match(block, /throw new Error/, 'une image inconnue ne fait pas d\'erreur');
  // Et le réglage doit être VU : sans reconstruction, l'object garde son ancienne image à l'écran.
  assert.match(block, /rebuildMeshSprite\(o\)/, 'le sprite n\'est pas reconstruit après réglage');
});

test('LES SPRITES SONT REFAITS quand l image de leur texture arrive', () => {
  // Les UV se calculent depuis la taille de l'image, inconnue tant que le chargement n'a pas rendu
  // la main. Un sprite créé entre-temps gardait des UV pleine sheet — les seize cases à la place
  // d'une — et rien ne les recalculait. Mesuré : créer la texture puis le sprite dans la foulée,
  // l'ordre normal quand le copilote monte une scène, donnait un personnage fait de toute sa
  // sheet jusqu'à ce qu'un geste sans rapport reconstruise la maille.
  const src = read('js/assets.js');
  assert.match(src, /function refreshSpritesOfTexture/, 'le rattrapage a disparu');
  // Les DEUX chemins de chargement doivent l'appeler : la création et le remplacement de fichier.
  const n = (src.match(/refreshSpritesOfTexture\(a\);/g) || []).length;
  assert.equal(n, 2, 'seuls ' + n + ' des 2 chargements de texture refont les sprites');
  // Et il doit viser les planches DE CETTE TEXTURE, pas toutes.
  const body = src.slice(src.indexOf('function refreshSpritesOfTexture'));
  assert.match(body, /textureId === tex\.id/, 'le rattrapage ne filtre pas par texture');
});
