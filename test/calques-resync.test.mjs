import { deEsm } from './engine-env.mjs';
// moteur/test/calques-resync.test.mjs
//
// LE BIT `Object3D.layers` SUIT LE CALQUE DE PROJET, et il le suit maintenant par une LISTE DE
// TRAVAIL au lieu d'un balayage de toute la scène à chaque image.
//
// Pourquoi ce fichier existe. La boucle de `viewport.js` refaisait, soixante fois par seconde,
// `objects.forEach(o => { o.layers.disableAll(); o.layers.enable(n); o.traverse(...) })` — deux
// écritures de masque par Object3D de la scène, os de squelette et maillages internes des
// modèles importés compris, pour une donnée qui ne change que sur une action explicite de
// l'utilisateur (voir docs/REVUE_2026-09-10.md § 2.3).
//
// Le remplacer par une liste de nœuds marqués fait disparaître le coût, mais déplace le risque :
// un nœud oublié est rendu par une caméra de jeu qui devrait l'ignorer, SANS aucune erreur. Ce
// test tient les deux moitiés de l'invariant — la mécanique de la liste marche, et le code
// continue de la remplir aux trois moments où un calque peut changer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => deEsm(readFileSync(path.join(root, f), 'utf8')).replace(/\r\n/g, '\n');

/**
 * `objects.js` réduit à ce qui nous intéresse : l'index de scène et la liste des calques.
 *
 * Le fichier entier ne se charge pas hors navigateur (il fabrique des géométries three, lit le
 * DOM). On en extrait donc les deux blocs qui portent l'invariant — et si l'extraction casse,
 * les assertions de présence juste en dessous le disent au lieu de passer en silence.
 */
function contexte(){
  const src = read('js/objects.js');
  const debut = src.indexOf('const _indexObjects = new Set();');
  assert.notEqual(debut, -1, 'l\'index de scène a changé de forme dans js/objects.js');
  const fin = src.indexOf('const EMPTY_LIST = [];');
  assert.notEqual(fin, -1, 'la liste de travail des calques a disparu de js/objects.js');
  const bloc = src.slice(debut, fin) + 'const EMPTY_LIST = [];\n';

  for(const nom of ['markLayersDirty', 'markAllLayersDirty', 'takeLayersDirty']){
    assert.ok(bloc.includes('function ' + nom), nom + ' doit vivre dans ce bloc de js/objects.js');
  }

  const bac = { console, Set, Array, Object };
  bac.globalThis = bac;
  bac.objects = [];
  const ctx = vm.createContext(bac);
  vm.runInContext(bloc, ctx, { filename: 'js/objects.js (extrait)' });
  return ctx;
}

/** Un faux Object3D : juste ce que `applyProjectLayer` touche. */
function noeud(nom, layer, enfants){
  const o = {
    name: nom,
    userData: (layer === undefined) ? {} : { game: { layer: layer } },
    children: enfants || [],
    layers: {
      mask: 1,
      disableAll(){ this.mask = 0; },
      enable(n){ this.mask |= (1 << n); }
    }
  };
  o.traverse = function(fn){
    fn(o);
    (o.children || []).forEach(function(c){ if(c.traverse) c.traverse(fn); else fn(c); });
  };
  return o;
}

/** `applyProjectLayer` de js/viewport.js, extrait — c'est la fonction qu'on veut exercer. */
function applyProjectLayer(){
  const src = read('js/viewport.js');
  const debut = src.indexOf('function applyProjectLayer(o){');
  assert.notEqual(debut, -1, 'applyProjectLayer a disparu de js/viewport.js');
  const fin = src.indexOf('\n}\n', debut);
  const bac = { console };
  bac.globalThis = bac;
  // Aucune icône d'édition dans ce test : `isIconEdit` a son propre cas, plus bas.
  bac.isIconEdit = () => false;
  const ctx = vm.createContext(bac);
  vm.runInContext(src.slice(debut, fin + 3), ctx, { filename: 'applyProjectLayer' });
  return { fn: ctx.applyProjectLayer, ctx: ctx };
}

// ---------------------------------------------------------------------------
// 1. La mécanique de la liste
// ---------------------------------------------------------------------------

test('un noeud qui ENTRE dans la scene est marque, une seule fois', () => {
  const ctx = contexte();
  const a = { name: 'a' }, b = { name: 'b' };
  ctx.addSceneObject(a);
  ctx.addSceneObject(b);
  ctx.addSceneObject(a);                       // idempotent : deja indexe
  const du = ctx.takeLayersDirty();
  assert.deepEqual(du.map((o) => o.name), ['a', 'b'],
    'addSceneObject doit signaler le noeud : c\'est le chemin unique de creation, de chargement, '
    + 'de l\'undo, du contenu de sous-scene et du clone de modele');

  // `.length` et pas deepEqual([]) : le tableau vient du contexte `vm`, donc d'un autre realm,
  // et deepStrictEqual compare aussi les prototypes.
  assert.equal(ctx.takeLayersDirty().length, 0,
    'la liste doit etre VIDEE au passage : sinon le meme noeud est retraite a chaque image et '
    + 'on a juste rendu le balayage plus lent');
});

test('markAllLayersDirty rend TOUTE la scene, et une passe complete suffit', () => {
  const ctx = contexte();
  const a = { name: 'a' }, b = { name: 'b' }, c = { name: 'c' };
  [a, b, c].forEach((o) => ctx.addSceneObject(o));
  ctx.takeLayersDirty();                        // on repart de vide

  ctx.markAllLayersDirty();
  assert.deepEqual(ctx.takeLayersDirty().map((o) => o.name), ['a', 'b', 'c'],
    'une restructuration de masse doit rendre tous les objets de la scene');
  assert.equal(ctx.takeLayersDirty().length, 0, 'et une seule fois : le drapeau est consomme');
});

test('un changement de scene ne laisse AUCUN noeud de la scene precedente dans la liste', () => {
  // Le piege exact que `Registry.clear()` avait deja connu : une liste de travail qui survit au
  // changement de scene fait travailler l'image suivante sur des Object3D detruits.
  // `clearSceneObjects` vit hors du bloc extrait (elle touche le Registry) : on verifie a la
  // SOURCE qu'elle purge, et la mecanique de la purge elle-meme est exercee juste au-dessus.
  const objets = read('js/objects.js');
  const debut = objets.indexOf('function clearSceneObjects()');
  assert.notEqual(debut, -1, 'clearSceneObjects a disparu de js/objects.js');
  const corps = objets.slice(debut, objets.indexOf('\n}', debut));
  assert.match(corps, /markAllLayersDirty\(\);/,
    'clearSceneObjects doit signaler la purge des calques');
  assert.match(corps, /takeLayersDirty\(\);/,
    'et la CONSOMMER tout de suite, sinon l\'image suivante repasse sur les objets detruits');

  // Et le drapeau « toute la scene » ne doit pas survivre a sa consommation.
  const ctx = contexte();
  ctx.addSceneObject({ name: 'vieux' });
  ctx.markAllLayersDirty();
  ctx.takeLayersDirty();
  assert.equal(ctx.takeLayersDirty().length, 0,
    'une liste de travail qui survit ferait travailler l\'image suivante sur des objets detruits');
});

// ---------------------------------------------------------------------------
// 2. Ce que la resynchronisation ECRIT vraiment
// ---------------------------------------------------------------------------

test('le calque de projet descend dans le noeud ET dans toute sa descendance', () => {
  // C'est tout l'objet du mecanisme : les maillages internes d'un modele importe ne sont pas
  // des objets de projet, ils n'ont pas de calque a eux, et ils doivent pourtant porter celui
  // de leur racine — sinon la camera de jeu en rend une partie et pas l'autre.
  const { fn } = applyProjectLayer();
  const os = noeud('os', undefined);
  const maillage = noeud('maillage', undefined, [os]);
  const racine = noeud('racine', 3, [maillage]);

  fn(racine);
  assert.equal(racine.layers.mask, 1 << 3, 'la racine porte son calque');
  assert.equal(maillage.layers.mask, 1 << 3, 'le maillage interne aussi');
  assert.equal(os.layers.mask, 1 << 3, 'et l\'os, deux niveaux plus bas');
});

test('un noeud SANS calque retombe sur 0, jamais sur NaN ni sur son masque d avant', () => {
  const { fn } = applyProjectLayer();
  const o = noeud('sans-calque', undefined);
  o.layers.mask = 1 << 5;                       // un vieux masque a effacer
  fn(o);
  assert.equal(o.layers.mask, 1, 'le calque par defaut est 0, et l\'ancien masque est efface');

  // Un calque NOMME (projet ancien) n'est pas un nombre : il ne doit pas produire un decalage
  // de bit indefini, qui allumerait n'importe quel calque.
  const nomme = noeud('calque-nomme', 'Decor');
  fn(nomme);
  assert.equal(nomme.layers.mask, 1, 'un calque non numerique retombe sur 0');
});

test('une icone d edition n est JAMAIS deplacee sur un calque de projet', () => {
  // Elle reste sur LAYER_HELPERS. Sinon elle devient visible pour toute camera de jeu qui
  // active le calque 0 — la sphere emissive d'une lumiere apparait dans le jeu.
  const src = read('js/viewport.js');
  const debut = src.indexOf('function applyProjectLayer(o){');
  const fin = src.indexOf('\n}\n', debut);
  const bac = { console };
  bac.globalThis = bac;
  const vus = [];
  bac.isIconEdit = (o) => { vus.push(o.name); return o.name.startsWith('icone'); };
  const ctx = vm.createContext(bac);
  vm.runInContext(src.slice(debut, fin + 3), ctx, { filename: 'applyProjectLayer' });

  const icone = noeud('icone-lumiere', undefined);
  const enfant = noeud('enfant', undefined);
  const racine = noeud('racine', 2, [enfant, icone]);
  icone.layers.mask = 1 << 31;

  ctx.applyProjectLayer(racine);
  assert.equal(icone.layers.mask, 1 << 31,
    'le masque de l\'icone doit etre laisse INTACT, y compris quand elle est parentee sous un '
    + 'objet normal — un gizmo peut vivre sous un noeud de projet');
  assert.equal(enfant.layers.mask, 1 << 2, 'l\'enfant normal, lui, prend le calque de la racine');

  const iconeRacine = noeud('icone-camera', 4);
  iconeRacine.layers.mask = 1 << 31;
  ctx.applyProjectLayer(iconeRacine);
  assert.equal(iconeRacine.layers.mask, 1 << 31, 'et une icone passee en racine non plus');
});

// ---------------------------------------------------------------------------
// 3. Le code continue de remplir la liste
// ---------------------------------------------------------------------------

test('la boucle de rendu ne balaie PLUS toute la scene pour les calques', () => {
  const vp = read('js/viewport.js');
  assert.ok(vp.includes('takeLayersDirty().forEach(applyProjectLayer)'),
    'la boucle doit consommer la liste de travail');
  // Le motif exact d'avant, qu'on ne veut plus voir revenir dans la boucle.
  assert.doesNotMatch(vp, /objects\.forEach\(function\(o\)\{[^]*?layers\.disableAll/,
    'le balayage complet des calques est de retour dans la boucle de rendu');
});

test('LES TROIS MOMENTS ou un calque change signalent bien le noeud', () => {
  // Rater l'un des trois est le seul defaut que ce mecanisme peut produire, et il est muet.
  assert.ok(read('js/objects.js').includes('markLayersDirty(o);'),
    'addSceneObject (js/objects.js) doit signaler le noeud qui entre dans la scene');

  assert.ok(/markLayersDirty\(o\)/.test(read('js/ui/panels-inspector.js')),
    'le champ Calque de l\'inspecteur doit signaler le noeud qu\'il vient de changer');

  assert.ok(/markLayersDirty\(o\)/.test(read('js/copilot.js')),
    'la commande du copilote qui ecrit un calque doit le signaler aussi');

  assert.ok(read('js/hierarchy.js').includes('markAllLayersDirty()'),
    'updateHierarchy doit redemander une passe complete : c\'est le filet pour la descendance '
    + 'AJOUTEE apres coup (maillages d\'un modele importe, contenu d\'une sous-scene, prefab)');
});
