import { deEsm } from './engine-env.mjs';
// moteur/test/ecs-registre.test.mjs
//
// Les invariants de l'architecture à composants. Ce fichier existe parce que le défaut qu'il
// closed est un défaut SILENCIEUX : le Registry indexait les composants depuis toujours et
// AUCUN système ne le relisait — `Registry.byType` n'apparaissait nulle part sauf dans le
// commentaire qui annonçait son usage. L'index se remplissait à chaque addComponent, fuyait à
// chaque changement de scène, et pendant ce temps les systèmes rebalayaient `objects` en
// filtrant sur des sacs `userData`. Rien ne plantait ; l'architecture était simplement
// décorative. Un test qui ne vérifie que du comportement ne l'aurait jamais vu.
//
// D'où les deux familles d'assertions ci-dessous : le Registry FONCTIONNE (exercé pour de
// vrai), et le code CONTINUE de s'en servir (lu à la source).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const racineMoteur = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(racineMoteur, f), 'utf8');
const FICHIERS_COMPOSANTS = readdirSync(path.join(racineMoteur, 'js', 'components'))
  .filter((f) => f.endsWith('.js'));

// Contexte minimal : component.js + node.js seuls, sans three ni DOM. Qu'ils s'y chargent
// est déjà une assertion en soi — le modèle de données du moteur ne doit rien devoir au
// navigateur.
function contexte(objetsDeScene) {
  const bac = { console, Math, JSON, Set, Map, Array, Object };
  bac.window = bac; bac.self = bac; bac.globalThis = bac;
  // l'index d'appartenance à la scène (objects.js), réduit à ce dont le Registry se sert
  bac.isSceneObject = (o) => (objetsDeScene || []).indexOf(o) !== -1;
  const ctx = vm.createContext(bac);
  vm.runInContext(deEsm(read('js/component-registry.js')), ctx, { filename: 'js/component-registry.js' });
  vm.runInContext(deEsm(read('js/component.js')), ctx, { filename: 'js/component.js' });
  vm.runInContext(deEsm(read('js/node.js')), ctx, { filename: 'js/node.js' });
  return ctx;
}

function classeDeTest(ctx, typeName) {
  return vm.runInContext(
    '(class extends Component { static get typeName(){ return "' + typeName + '"; } })', ctx);
}

function noeudNu() {
  return { userData: {} };
}


// ---------------------------------------------------------------------------
// 1. Le Registry est LU, et il répond juste
// ---------------------------------------------------------------------------

test('un composant ajoute rejoint l index, et noeudsActifs le rend', () => {
  const scene = [];
  const ctx = contexte(scene);
  ctx.Registry.registerClass(classeDeTest(ctx, 'Ressort'));

  const o = noeudNu();
  scene.push(o);
  ctx.applyNodeMixin(o);
  o.addComponent('Ressort', {});

  assert.equal(ctx.Registry.count('Ressort'), 1);
  assert.deepEqual(ctx.Registry.activeNodes('Ressort'), [o],
    'le Systeme doit trouver le porteur par type de composant, sans balayer la scene');
});

test('un composant DESACTIVE sort de noeudsActifs mais reste dans noeudsVivants', () => {
  const scene = [];
  const ctx = contexte(scene);
  ctx.Registry.registerClass(classeDeTest(ctx, 'Ressort'));
  const o = noeudNu();
  scene.push(o);
  ctx.applyNodeMixin(o);
  const c = o.addComponent('Ressort', {});

  c.active = false;
  assert.deepEqual(ctx.Registry.activeNodes('Ressort'), [],
    'un composant decoche ne doit plus etre servi aux systemes');
  // La distinction porte un cas reel : un emetteur de particules decoche cesse d'emit,
  // mais ses particules en vol doivent finir leur course (voir updateParticles).
  assert.deepEqual(ctx.Registry.liveNodes('Ressort'), [o],
    'noeudsVivants doit continuer a le rendre, active ou non');
});

test('un composant porte par un Noeud HORS scene n est jamais servi aux systemes', () => {
  const scene = [];
  const ctx = contexte(scene);
  ctx.Registry.registerClass(classeDeTest(ctx, 'Ressort'));
  // Cas reel : le template d'un prefab, un modele en cours d'import, une racine supprimee.
  // Ils portent de vrais composants sans appartenir a la scene courante.
  const horsScene = noeudNu();
  ctx.applyNodeMixin(horsScene);
  horsScene.addComponent('Ressort', {});

  assert.equal(ctx.Registry.count('Ressort'), 1, 'il est bien indexe');
  assert.deepEqual(ctx.Registry.activeNodes('Ressort'), [],
    'mais un systeme ne doit pas simuler un objet qui n est pas dans la scene');
});

test('removeComponent desindexe, et vider() purge tout', () => {
  const scene = [];
  const ctx = contexte(scene);
  ctx.Registry.registerClass(classeDeTest(ctx, 'Ressort'));
  const o = noeudNu();
  scene.push(o);
  ctx.applyNodeMixin(o);
  const c = o.addComponent('Ressort', {});

  o.removeComponent(c);
  assert.equal(ctx.Registry.count('Ressort'), 0, 'retirer un composant doit le desindexer');

  o.addComponent('Ressort', {});
  ctx.Registry.clear();
  assert.equal(ctx.Registry.count('Ressort'), 0,
    'vider() est ce qui manquait : nouvelleScene/restaurerEtat vident `objects` d un coup, '
    + 'sans passer par removeComponent — l index gardait les instances de la scene precedente');
});

test('desindexerNoeud retire TOUS les composants d un objet detruit', () => {
  const scene = [];
  const ctx = contexte(scene);
  ctx.Registry.registerClass(classeDeTest(ctx, 'Ressort'));
  ctx.Registry.registerClass(classeDeTest(ctx, 'Aimant'));
  const o = noeudNu();
  scene.push(o);
  ctx.applyNodeMixin(o);
  o.addComponent('Ressort', {});
  o.addComponent('Aimant', {});

  // C'est ce que fait removeSceneObject (objects.js) : la suppression d un objet ne passait
  // par aucun removeComponent, donc l index gardait ses composants pour toujours.
  ctx.Registry.unindexNode(o);
  assert.equal(ctx.Registry.count('Ressort'), 0);
  assert.equal(ctx.Registry.count('Aimant'), 0);
});

test('enregistrerClasse est idempotent : pas de doublon dans + Composant', () => {
  const ctx = contexte([]);
  ctx.Registry.registerClass(classeDeTest(ctx, 'Ressort'));
  ctx.Registry.registerClass(classeDeTest(ctx, 'Ressort'));
  const inputs = ctx.Registry.registeredClasses.filter((c) => c.typeName === 'Ressort');
  assert.equal(inputs.length, 1,
    'recharger un plugin ne doit pas add une deuxieme ligne au popup');
});


// ---------------------------------------------------------------------------
// 2. Le contrat de restauration (LSP)
// ---------------------------------------------------------------------------

test('restaurer() applique `active` pour TOUTE sous-classe, sans qu elle y pense', () => {
  const ctx = contexte([]);
  // Une sous-classe qui ne connait que ses propres fields, comme un composant de plugin.
  const Ressort = vm.runInContext(`(class extends Component {
    constructor(node, data){ super(node); this.raideur = (data && data.raideur) || 1; }
    static get typeName(){ return 'Ressort'; }
  })`, ctx);

  const c = Ressort.restore(noeudNu(), { active: false, raideur: 7 });
  assert.equal(c.raideur, 7, 'les champs propres passent par le constructeur');
  assert.equal(c.active, false,
    'et `active` est applique par le contrat generique — c est tout l interet de ne plus '
    + 'surcharger restaurer() : avant, chaque sous-classe devait rappeler restaurerActif() '
    + 'a la main, et une seule oubliee faisait revenir un composant decoche a l state active '
    + 'au rechargement, sans message');
});

test('AUCUN composant natif ne surcharge restaurer()', () => {
  const coupables = FICHIERS_COMPOSANTS.filter(
    (f) => /static\s+restaurer\s*\(/.test(read('js/components/' + f)));
  assert.deepEqual(coupables, [],
    'restaurer() est FINAL (voir component.js) : le point de variation est le constructeur '
    + 'et hydrater(). Le surcharger reintroduit le contrat divergent que ce lot a supprime.');
});

test('TOUT composant qui porte des donnees a un hydrate() — le SEUL point de relecture', () => {
  // REGLE 2 DU CONTRAT (component.js) : « hydrate(data) relit les champs serialises. C est le
  // SEUL point de relecture. » Elle etait fausse pour huit composants, qui relisaient dans leur
  // constructeur seulement. Consequence : le chemin `applyComponents` → branche « composant deja
  // pose » appelle `dejaLa.hydrate(data)`, qui etait alors un NO-OP herite de la classe de base —
  // les donnees du fichier partaient en silence. Voir docs/REVUE_2026-09-10.md SS 3.3.
  //
  // Un composant sans donnees propres (un pur index) n a rien a relire : c est le seul cas ou
  // l absence est correcte, et il se reconnait a un `serialize()` qui rend un objet vide.
  const sansHydrate = [];
  for (const f of FICHIERS_COMPOSANTS) {
    const code = read('js/components/' + f);
    if (/hydrate\s*\(/.test(code)) continue;
    // `serialize() { return {}; }` = index pur (Tag). Tout le reste porte des donnees.
    const indexPur = /serialize\s*\(\)\s*\{\s*return\s*\{\s*\}\s*;\s*\}/.test(code);
    if (!indexPur) sansHydrate.push(f);
  }
  assert.deepEqual(sansHydrate, [],
    'Ces composants portent des donnees et n ont pas de hydrate() : relus depuis le fichier sur\n'
    + 'une instance deja posee, ils garderaient leurs defauts SANS aucun message.\n'
    + sansHydrate.join('\n'));
});

test('AUCUN serialize() ne rend un sac userData VIVANT', () => {
  // REGLE 4 DU CONTRAT (component.js) : « serialize() renvoie des donnees PURES et detachees.
  // Pas de reference vers un sac userData vivant : un appelant qui mute le resultat ne doit pas
  // pouvoir muter l etat du jeu. » Cinq composants faisaient `return this.data;`, et `this.data`
  // EST `node.userData.X` — leurs propres commentaires l affirment. La regle etait citee en tete
  // de component.js comme si elle tenait. Voir docs/REVUE_2026-09-10.md SS 3.2.
  const fautifs = [];
  for (const f of FICHIERS_COMPOSANTS) {
    read('js/components/' + f).split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line)) return;
      if (/serialize\s*\(\)\s*\{\s*return\s+this\.\w+\s*;\s*\}/.test(line)) {
        fautifs.push(f + ':' + (i + 1) + ' ' + line.trim());
      }
    });
  }
  assert.deepEqual(fautifs, [],
    'Ces serialize() rendent une reference vivante. Passez par `detachData(...)` (component.js) :\n'
    + 'un appelant qui trie, normalise ou complete le resultat muterait l etat du jeu.\n'
    + fautifs.join('\n'));
});

test('les composants adosses a un sac FUSIONNENT les donnees recues, ils ne les jettent pas', () => {
  // Le defaut mesure : `onAdd(){ this.data = ensureX(this.node); }` JETTE purement les donnees
  // passees a `addComponent`, quand le sac n existe pas encore — `ensureX` cree alors ses
  // defauts et le composant pointe dessus. `addComponent('Physics', {masse: 5})` rendait donc un
  // corps par defaut, en silence. Ca ne se voyait pas parce que le format de projet ecrit AUSSI
  // le sac a plat et que la reconstruction le pose AVANT les composants : la seule source qui
  // marchait etait cette redondance (voir SS 3.1). Le jour ou on la retire, tous les reglages
  // physiques d une scene disparaissent. Voir docs/REVUE_2026-09-10.md SS 3.3.
  const fautifs = [];
  for (const f of FICHIERS_COMPOSANTS) {
    read('js/components/' + f).split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line)) return;
      const m = line.match(/this\.data\s*=\s*(ensure\w+)\(/);
      if (m) fautifs.push(f + ':' + (i + 1) + ' this.data = ' + m[1] + '(...)');
    });
  }
  assert.deepEqual(fautifs, [],
    'Remplacez par `this.data = mergeIntoBag(ensureX(this.node), this.data);` (component.js) :\n'
    + 'les donnees recues doivent entrer dans le sac, pas etre remplacees par ses defauts.\n'
    + fautifs.join('\n'));
});

test('le helper restaurerActif a bien disparu du code', () => {
  const files = ['js/component-registry.js', 'js/component.js', 'js/node.js']
    .concat(FICHIERS_COMPOSANTS.map((f) => 'js/components/' + f));
  for (const f of files) {
    const code = read(f).split('\n')
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
    assert.doesNotMatch(code, /restaurerActif/,
      f + ' appelle encore restaurerActif : le contrat generique le rend inutile');
  }
});


// ---------------------------------------------------------------------------
// 3. La separation modele / presentation (SRP)
// ---------------------------------------------------------------------------

test('AUCUN composant ne touche le DOM', () => {
  // L'invariant qui rend `moteur/` publiable : le modele de donnees du moteur ne doit pas
  // dependre de la mise en page de l editeur. Avant ce lot, les composants appelaient
  // literalement document.getElementById('f-pmass') et fabriquaient leur propre HTML.
  const fautes = [];
  for (const f of FICHIERS_COMPOSANTS) {
    const code = read('js/components/' + f);
    code.split('\n').forEach((line, i) => {
      if (line.trim().startsWith('//')) return;
      if (/\bdocument\s*\.|getElementById|<div |<input |<button /.test(line)) {
        fautes.push(f + ':' + (i + 1) + ' ' + line.trim().slice(0, 70));
      }
    });
  }
  assert.deepEqual(fautes, [],
    'la presentation vit dans js/component-views.js (ComponentViews.register)');
});

test('chaque vue enregistree correspond a un composant reel, et l inverse est permis', () => {
  // Les vues vivent maintenant dans DEUX fichiers : celles qui restent au contrat
  // `html/sync/input/click` (js/component-views.js) et celles qui sont passées au socle
  // déclaratif (js/ui/panels-components.js). Compter les premières seulement ferait échouer ce
  // test à chaque vue migrée — alors que ce qu'il garde, c'est qu'aucune vue ne soit ORPHELINE.
  const nomsDeVues = [
    ...[...read('js/component-views.js').matchAll(/ComponentViews\.register\('([^']+)'/g)],
    ...[...read('js/ui/panels-components.js').matchAll(/declareComponentPanel\('([^']+)'/g)]
  ].map((m) => m[1]);
  assert.ok(nomsDeVues.length >= 11, 'les vues des composants natifs doivent y etre : '
    + nomsDeVues.length + ' trouvee(s)');

  const nomsDeComposants = FICHIERS_COMPOSANTS.flatMap((f) =>
    [...read('js/components/' + f).matchAll(/static get typeName\(\)\s*\{\s*return '([^']+)'/g)]
      .map((m) => m[1]));
  const orphelines = nomsDeVues.filter((n) => nomsDeComposants.indexOf(n) === -1);
  assert.deepEqual(orphelines, [],
    'une vue sans composant ne sera jamais affichee — composant renomme ou supprime ?');
  // L'inverse n'est PAS une faute : Model et Events n'ont pas de vue, et l inspecteur
  // affiche alors le bloc sans body (voir buildBlocksComponents).
});

test('l ancienne interface inspectorFields a bien disparu', () => {
  // Deux interfaces de presentation concurrentes cohabitaient : `inspectorFields()`, declaree
  // dans la classe de base et implementee par PERSONNE, et `htmlInspecteur()`, implementee par
  // tout le monde. L inspecteur testait l une puis retombait sur l autre.
  const files = ['js/component-registry.js', 'js/component.js', 'js/inspector.js']
    .concat(FICHIERS_COMPOSANTS.map((f) => 'js/components/' + f));
  for (const f of files) {
    const code = read(f).split('\n')
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
    assert.doesNotMatch(code, /inspectorFields/, f + ' s y refere encore');
  }
});


// ---------------------------------------------------------------------------
// 4. Les systemes interrogent le Registry, pas les sacs userData
// ---------------------------------------------------------------------------

test('les systemes decouvrent leurs entites par le Registre', () => {
  // Le coeur du lot. Chaque entry : le fichier, et ce qu il doit demander au Registry.
  const attendu = {
    'js/physics.js': ["Registry.activeNodes('Physics')", "Registry.activeNodes('Terrain')"],
    'js/probes.js': ["Registry.activeNodes('Reflection')"],
    'js/particles.js': ["Registry.liveNodes('Particles')"],
    'js/events.js': ["Registry.activeNodes('Events')"]
  };
  for (const [f, motifs] of Object.entries(attendu)) {
    const code = read(f);
    for (const motif of motifs) {
      assert.ok(code.includes(motif),
        f + ' doit decouvrir ses entites via ' + motif + ' — un balayage de `objects` filtre '
        + 'sur userData rend l index inutile, et c est exactement l state d ou vient ce lot');
    }
  }
});

test('plus aucun systeme ne balaie objects en filtrant sur un sac userData', () => {
  const fautes = [];
  for (const f of ['js/physics.js', 'js/probes.js', 'js/particles.js', 'js/events.js']) {
    read(f).split('\n').forEach((line, i) => {
      if (line.trim().startsWith('//')) return;
      if (/objects\.(filter|forEach|some)\(/.test(line)) {
        fautes.push(f + ':' + (i + 1) + ' ' + line.trim().slice(0, 70));
      }
    });
  }
  assert.deepEqual(fautes, [],
    'ces quatre systemes doivent partir du Registre. Un balayage restant signale une entite '
    + 'sans component : donner un composant a ce qu il cherche, ne pas rajouter un filtre.');
});

test('l API DE SCRIPT cherche par TAG via le Registre, dans les deux moteurs', () => {
  // LES DEUX FICHIERS QUI MANQUAIENT A LA LISTE CI-DESSUS, et par lesquels le motif a survecu :
  // `scripts.js` et `game-runtime.js` tenaient chacun DEUX copies de
  // `objects.filter(x => x.userData.game.tag === tag)` pour `api.byTag`/`api.findByTag`, soit
  // quatre balayages de toute la scene, dans une fonction que les scripts appellent en
  // `update()`. Pendant ce temps `nodesByTag` — l implementation adossee au Registry, ecrite
  // exactement pour ca — n avait AUCUN appelant. Voir docs/REVUE_2026-09-10.md SS 1.6.
  //
  // On ne peut pas interdire tout `objects.filter` dans ces deux fichiers : ils portent aussi
  // `api.overlaps`, `api.raycast` et l instantane de lancement, qui sont des requetes
  // geometriques sur toute la scene, pas des recherches d entites par composant. On mesure donc
  // precisement ce qui a ete corrige : la recherche par tag ne balaie plus rien.
  const fautes = [];
  for (const f of ['js/scripts.js', 'js/game-runtime.js']) {
    read(f).split('\n').forEach((line, i) => {
      if (line.trim().startsWith('//') || line.trim().startsWith('*')) return;
      if (/(objects|game\.objects)\.filter\([^)]*userData\.game(\.tag)?\b/.test(line)) {
        fautes.push(f + ':' + (i + 1) + ' ' + line.trim().slice(0, 80));
      }
    });
  }
  assert.deepEqual(fautes, [],
    'la recherche par tag doit passer par `nodesByTag` (Registry.activeNodes(\'Tag\')), pas par '
    + 'un balayage de la scene : le cout doit suivre le nombre d objets ETIQUETES.\n'
    + fautes.join('\n'));

  for (const f of ['js/scripts.js', 'js/game-runtime.js']) {
    assert.ok(read(f).includes('nodesByTag'),
      f + ' n utilise pas nodesByTag : la recherche par tag est repartie en balayage de scene');
  }
});

test('le RUNTIME du jeu publie porte les memes composants que l editeur', () => {
  // Le plus gros ecart d architecture du repo, et le plus couteux : `game-runtime.js`
  // reconstruisait les objets en sacs `userData` et dispatchait sur `userData.type`, sans jamais
  // connaitre ni `Registry` ni `getComponent`. L architecture a composants etait donc une
  // architecture d EDITION, et la logique physique existait en DEUX exemplaires — une divergence
  // qui ne se voit qu APRES export.
  const rt = read('js/game-runtime.js');
  // `applyComponents` et plus `syncComponents` : le jeu publié pose les composants que le
  // FICHIER nomme, au lieu de les deviner d'après un type stocké et les sacs présents. C'est
  // le même code que l'éditeur (js/component-migration.js), plus un jumeau à tenir à jour.
  assert.ok(rt.includes('applyNodeMixin(o);') && rt.includes('applyComponents(o, d.components);'),
    'buildList doit poser l API composant puis les composants nommes par le fichier');
  assert.equal(rt.includes('syncComponents(o);'), false,
    'le runtime ne doit plus DEVINER ses composants : le fichier les nomme');
  for (const motif of ["Registry.activeNodes('Physics')", "Registry.activeNodes('Terrain')",
                       "Registry.activeNodes('Reflection')", "Registry.liveNodes('Particles')",
                       "Registry.activeNodes('Events')", "Registry.activeNodes('Camera')",
                       'buildRigidBody(']) {
    assert.ok(rt.includes(motif), 'le runtime doit passer par ' + motif);
  }
  assert.doesNotMatch(rt, /function construireCorpsPour/,
    'la copie runtime de la construction de corps rigide doit rester supprimee : elle vit dans '
    + 'js/rigid-body.js, partage avec l editeur');
  // Les DECLARATIONS doivent avoir disparu ; les commentaires qui expliquent ou elles sont
  // parties, non — c'est justement ce qu'un lecteur du runtime doit y trouver.
  const codeRt = rt.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(codeRt, /const PART_DEFAUT_RT/,
    'le defaut des particules est partage (js/component-data.js), plus de copie runtime');
  assert.doesNotMatch(codeRt, /function rtTerrIdx/,
    'l indexation du champ de heights est partagee (terrIdx, js/component-data.js)');
});

test('les trois pages chargent la MEME calque a composants', () => {
  // Un fichier ajoute a l editeur et oublie dans le jeu publie, c est la divergence qui revient
  // par la porte du chargement. Les trois listes doivent contenir les memes noms.
  const shared = ['component-data.js', 'component.js', 'node.js', 'rigid-body.js',
                    'component-migration.js'];
  const editeur = read('editor.html');
  const preview = read('game-preview.html');
  const build = read('js/build.js');
  const components = readdirSync(path.join(racineMoteur, 'js', 'components'));

  for (const f of shared.concat(components)) {
    assert.ok(editeur.includes(f), 'editor.html ne charge pas ' + f);
    assert.ok(preview.includes(f), 'game-preview.html ne charge pas ' + f
      + ' — le jeu publie n aurait pas ce composant, et ses systemes ne trouveraient rien');
    assert.ok(build.includes(f), 'js/build.js n embarque pas ' + f + ' dans le ZIP');
  }
});

test('les defauts de donnees n existent qu une fois', () => {
  // Deux copies d un defaut ne se voient qu APRES export. Elles sont toutes dans le fichier
  // partage ; aucun autre fichier ne doit en redeclarer.
  const partage = read('js/component-data.js');
  for (const name of ['ensurePhys', 'ensureCollider', 'ensurePart', 'ensureTerrain',
                     'ensureProbe', 'ensureUIDoc', 'ensureAnimator', 'ensureGame',
                     'PART_DEFAULT', 'TERRAIN_DEFAULT', 'PROBE_DEFAULT', 'terrIdx']) {
    assert.ok(partage.includes('function ' + name + '(') || partage.includes('const ' + name + ' ='),
      name + ' doit etre declare dans js/component-data.js');
  }
});

test('chaque entite du format de project a un composant', () => {
  // `userData.type` reste le discriminant du FORMAT DE FICHIER (serialisation, reconstruction) ;
  // il ne doit plus etre le medium dont un SYSTEME trouve ses entites. La table de correspondance
  // est ce qui relie les deux : un type absent de la table est une entite sans composant, donc
  // invisible au Registry.
  const migration = read('js/component-migration.js');
  for (const t of ['mesh', 'model', 'camera', 'terrain', 'particles', 'probe',
                   'point', 'spot', 'directional', 'subScene']) {
    assert.ok(migration.includes('  ' + t + ": '"),
      'le type de project « ' + t + ' » n a pas de composant dans COMPONENT_BY_TYPE');
  }
});

test('l index par tag ne parcourt QUE les objets etiquetes', () => {
  // Le commentaire de evaluateContacts promettait « le cout suit le number d objets TAGUES, pas
  // la taille de la scene » — mais la construction de l index balayait bien toute la scene a
  // chaque image. Le composant Tag rend la promesse vraie ; les quatre appelants (editeur et
  // runtime, contacts et triggers) partagent la meme implementation.
  const tag = read('js/components/component-tag.js');
  assert.match(tag, /Registry\.activeNodes\('Tag'\)/);
  for (const f of ['js/scripts.js', 'js/events.js']) {
    assert.ok(read(f).includes('indexByTag()'), f + ' doit utiliser l index partage');
  }
  const rt = read('js/game-runtime.js');
  assert.equal((rt.match(/indexByTag\(\)/g) || []).length, 2,
    'les deux miroirs runtime (contacts, triggers) doivent y passer aussi');
});

test('AUCUN sac de donnees d object n est sans composant', () => {
  // L'invariant de fond. Un sac `userData.X` sans composant, c'est une entite invisible au
  // Registry : le seul medium de la trouver redevient un balayage de toute la scene, et
  // l'architecture recommence a se clear par la ou elle s'etait videe.
  //
  // La liste vient des sacs que serializeObject ecrit. Un nouveau sac ajoute ici sans son
  // composant fait echouer ce test — c'est le but.
  const migration = read('js/component-migration.js');
  const SACS = {
    collider: 'Collider', phys: 'Physics', terr: 'Terrain', part: 'Particles',
    animator: 'AnimatorController', probe: 'Reflection', uiDoc: 'UIDocument',
    scripts: 'ScriptJS', events: 'Events', audio: 'AudioSource', game: 'Tag'
  };
  for (const [sac, typeName] of Object.entries(SACS)) {
    assert.ok(migration.includes('userData.' + sac) && migration.includes("'" + typeName + "'"),
      'le sac userData.' + sac + ' doit donner le composant ' + typeName
      + ' dans syncComponents (js/component-migration.js)');
  }
});

test('les systemes de decouverte par image passent tous par le Registre', () => {
  // Un balayage de toute la scene dans la boucle d'image est le symptome exact du defaut
  // d'origine. Les fichiers listes ici sont ceux dont un Systeme tourne a chaque image ou au
  // lancement d'une partie, des deux cotes.
  const fautes = [];
  const FICHIERS = ['js/physics.js', 'js/probes.js', 'js/particles.js', 'js/events.js',
                    'js/audio.js', 'js/anim-models.js', 'js/collider.js'];
  for (const f of FICHIERS) {
    read(f).split('\n').forEach((line, i) => {
      if (line.trim().startsWith('//') || line.trim().startsWith('*')) return;
      if (/^\s*objects\.(filter|forEach|some)\(/.test(line)) {
        fautes.push(f + ':' + (i + 1) + ' ' + line.trim().slice(0, 70));
      }
    });
  }
  assert.deepEqual(fautes, [],
    'ces systemes doivent partir du Registre. Un balayage restant signale une entite sans '
    + 'composant : donner un composant a ce qu il cherche, ne pas rajouter un filtre.');
});

test('un plugin peut declarer un composant', () => {
  // Le trou de l API : un plugin pouvait add un type d object, un inspecteur, un
  // importateur, un materiau — mais pas un COMPOSANT, alors que c est l unite d extension
  // du moteur. Registry.registerClass n etait appelee que par les fichiers natifs.
  const code = read('js/plugins.js');
  assert.match(code, /registerComponent:\s*function/,
    'Editor.registerComponent doit exister');
  assert.match(code, /COMPONENTS_NATIVE/,
    'un plugin ne doit pas pouvoir REMPLACER un composant natif : ecraser Mesh ou Physics '
    + 'casserait les projets deja enregistres qui s y referent');
});
