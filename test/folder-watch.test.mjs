// Les trois règles de la surveillance du dossier de projet (js/folder-watch.js), mesurées
// sans navigateur ni disque : le classement ne travaille que sur des Map de signatures.
//
// Ce que ces tests protègent, et qui a coûté cher ailleurs dans ce dépôt : une écriture de
// l'éditeur relue comme un changement externe (boucle infinie), un fichier adopté en cours de
// copie (asset corrompu, avec un id, définitivement), et une disparition passagère prise pour
// une suppression (asset retiré du projet, références de scène mortes).
import { deEsm } from './engine-env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

const ctx = vm.createContext({console: console});
for(const f of ['../js/file-names.js', '../js/project-folder.js', '../js/folder-watch.js']){
  vm.runInContext(deEsm(fs.readFileSync(new URL(f, import.meta.url), 'utf8')), ctx);
}
const { classifyChanges, signatureTree, signatureFile, watchedPath, emittingPath, intervalNext,
        noteDiskWriteOurs, takeDiskWritesOurs } = ctx;
// Un `const` de premier niveau n'atterrit PAS sur l'objet de contexte d'un vm (contrairement
// à une `function`) : les constantes se lisent par évaluation, pas par destructuration.
const REMOVED = vm.runInContext('REMOVED', ctx);
const WATCH_INTERVAL_MS = vm.runInContext('WATCH_INTERVAL_MS', ctx);
const WATCH_INTERVAL_MAX_MS = vm.runInContext('WATCH_INTERVAL_MAX_MS', ctx);

// Les tableaux rendus par le code chargé dans le vm appartiennent à un AUTRE realm :
// `deepEqual` les refuse même à contenu identique. On les recopie côté test avant de comparer.
function ici(x){ return Array.from(x); }

function tree(files){
  return {files: files.map(function(f){
    return {filePath: f[0], size: f[1], lastModif: f[2], handle: null};
  }), folders: []};
}

/** Deux sondages successifs : rend ce que chacun annonce, avec l'état à reporter. */
function deuxTours(before, after, ours){
  const b = signatureTree(before);
  const a = signatureTree(after);
  const un = classifyChanges(b, a, {ours: ours || new Set(), pending: new Map()});
  const deux = classifyChanges(un.baseline, a, {ours: new Set(), pending: un.pending});
  return {un: un, deux: deux};
}

test('la portée est assets/, et un .meta ne s annonce jamais', () => {
  assert.equal(watchedPath('assets/Textures/herbe.png'), true);
  assert.equal(watchedPath('project.json'), false);
  assert.equal(watchedPath('scenes/Scene 1.scene.json'), false);
  assert.equal(watchedPath('assets/.gardefolder'), false);
  assert.equal(watchedPath('assets/Textures/herbe.png.meta'), true);
  assert.equal(emittingPath('assets/Textures/herbe.png.meta'), false);
});

test('un fichier neuf n est annonce qu une fois sa taille stable (regle 2)', () => {
  const avant = tree([['assets/Textures/mur.png', 100, 1]]);
  const partiel = tree([['assets/Textures/mur.png', 100, 1], ['assets/Modeles/ville.glb', 5000, 2]]);
  const complet = tree([['assets/Textures/mur.png', 100, 1], ['assets/Modeles/ville.glb', 80000, 3]]);

  const b = signatureTree(avant);
  // 1er sondage : le fichier est là mais en cours d'écriture — rien n'est annoncé.
  const t1 = classifyChanges(b, signatureTree(partiel), {ours: new Set(), pending: new Map()});
  assert.deepEqual(ici(t1.added), []);
  assert.equal(t1.pending.has('assets/Modeles/ville.glb'), true);

  // 2e sondage : la taille a encore changé — toujours rien.
  const t2 = classifyChanges(t1.baseline, signatureTree(complet), {ours: new Set(), pending: t1.pending});
  assert.deepEqual(ici(t2.added), []);

  // 3e sondage : la taille n'a plus bougé — le fichier entre dans le projet.
  const t3 = classifyChanges(t2.baseline, signatureTree(complet), {ours: new Set(), pending: t2.pending});
  assert.deepEqual(ici(t3.added), ['assets/Modeles/ville.glb']);
  // et il est bien passé dans la référence : il n'est plus annoncé au tour suivant.
  const t4 = classifyChanges(t3.baseline, signatureTree(complet), {ours: new Set(), pending: t3.pending});
  assert.deepEqual(ici(t4.added), []);
});

test('un ajout attend sa carte d identite quand elle arrive en second', () => {
  const avant = tree([]);
  const p1 = tree([['assets/Textures/herbe.png', 100, 1]]);
  const p2 = tree([['assets/Textures/herbe.png', 100, 1], ['assets/Textures/herbe.png.meta', 60, 2]]);
  const t1 = classifyChanges(signatureTree(avant), signatureTree(p1), {ours: new Set(), pending: new Map()});
  const t2 = classifyChanges(t1.baseline, signatureTree(p2), {ours: new Set(), pending: t1.pending});
  assert.deepEqual(ici(t2.added), []);                                  // retenu : le .meta arrive
  assert.deepEqual(ici(t2.held), ['assets/Textures/herbe.png']);
  const t3 = classifyChanges(t2.baseline, signatureTree(p2), {ours: new Set(), pending: t2.pending});
  assert.deepEqual(ici(t3.added), ['assets/Textures/herbe.png']);        // les deux sont là, on adopte
});

test('une modification est annoncee, une seule fois', () => {
  const avant = tree([['assets/Scripts/joueur.js', 100, 1]]);
  const apres = tree([['assets/Scripts/joueur.js', 140, 9]]);
  const r = deuxTours(avant, apres);
  assert.deepEqual(ici(r.un.modified), []);
  assert.deepEqual(ici(r.deux.modified), ['assets/Scripts/joueur.js']);
  const t3 = classifyChanges(r.deux.baseline, signatureTree(apres), {ours: new Set(), pending: r.deux.pending});
  assert.deepEqual(ici(t3.modified), []);
});

test('une suppression demande deux observations (regle 3)', () => {
  const avant = tree([['assets/Sons/pas.wav', 100, 1]]);
  const apres = tree([]);
  const t1 = classifyChanges(signatureTree(avant), signatureTree(apres), {ours: new Set(), pending: new Map()});
  assert.deepEqual(ici(t1.removed), []);
  assert.equal(t1.pending.get('assets/Sons/pas.wav'), REMOVED);
  // Le fichier revient (remplacement atomique d'un outil externe) : rien n'a été perdu.
  const retour = tree([['assets/Sons/pas.wav', 120, 5]]);
  const t2 = classifyChanges(t1.baseline, signatureTree(retour), {ours: new Set(), pending: t1.pending});
  assert.deepEqual(ici(t2.removed), []);
  const t3 = classifyChanges(t2.baseline, signatureTree(retour), {ours: new Set(), pending: t2.pending});
  assert.deepEqual(ici(t3.modified), ['assets/Sons/pas.wav']);   // une modification, pas une disparition
});

test('une suppression confirmee est annoncee', () => {
  const r = deuxTours(tree([['assets/Sons/pas.wav', 100, 1]]), tree([]));
  assert.deepEqual(ici(r.deux.removed), ['assets/Sons/pas.wav']);
  assert.equal(r.deux.baseline.has('assets/Sons/pas.wav'), false);
});

test('nos propres ecritures ne declenchent rien (regle 1)', () => {
  const avant = tree([['assets/Materiaux/herbe.material.json', 100, 1]]);
  const apres = tree([['assets/Materiaux/herbe.material.json', 130, 7],
                      ['assets/Materiaux/herbe.material.json.meta', 60, 7]]);
  const ours = new Set(['assets/Materiaux/herbe.material.json',
                        'assets/Materiaux/herbe.material.json.meta']);
  const t1 = classifyChanges(signatureTree(avant), signatureTree(apres), {ours: ours, pending: new Map()});
  assert.deepEqual(ici(t1.modified), []);
  assert.deepEqual(ici(t1.added), []);
  // et l'état écrit entre dans la référence : il ne reviendra pas au sondage suivant.
  const t2 = classifyChanges(t1.baseline, signatureTree(apres), {ours: new Set(), pending: t1.pending});
  assert.deepEqual(ici(t2.modified), []);
  assert.deepEqual(ici(t2.added), []);
});

test('le registre d ecritures garde ce qui a ete ecrit PENDANT le scan', () => {
  const debutScan = 1000;
  noteDiskWriteOurs('assets/a.js', 900);    // avant le scan : le scan l'a vue, on consomme
  noteDiskWriteOurs('assets/b.js', 1200);   // pendant le scan : à masquer aussi au tour suivant
  const un = takeDiskWritesOurs(debutScan, 1300);
  assert.deepEqual(ici(un).sort(), ['assets/a.js', 'assets/b.js']);
  const deux = takeDiskWritesOurs(2000, 2000);
  assert.deepEqual(ici(deux), ['assets/b.js']);
  assert.deepEqual(ici(takeDiskWritesOurs(3000, 3000)), []);
});

test('une ecriture perimee ne masque plus rien', () => {
  noteDiskWriteOurs('assets/vieux.js', 0);
  assert.deepEqual(ici(takeDiskWritesOurs(60000, 60000)), []);
});

test('la cadence suit le cout du scan, sans depasser le plafond', () => {
  assert.equal(intervalNext(5), WATCH_INTERVAL_MS);            // scan court : cadence de base
  assert.equal(intervalNext(500), 4000);                        // 8 × 500 ms
  assert.equal(intervalNext(100000), WATCH_INTERVAL_MAX_MS);    // plafonné
});

test('un projet immobile ne produit aucun changement', () => {
  const t = tree([['assets/Textures/herbe.png', 100, 1], ['assets/Textures/herbe.png.meta', 60, 1]]);
  const r = deuxTours(t, t);
  assert.deepEqual([ici(r.deux.added), ici(r.deux.modified), ici(r.deux.removed)], [[], [], []]);
  assert.equal(r.deux.pending.size, 0);
});

test('signatureFile distingue une reecriture de meme taille', () => {
  assert.notEqual(signatureFile({size: 100, lastModif: 1}), signatureFile({size: 100, lastModif: 2}));
});
