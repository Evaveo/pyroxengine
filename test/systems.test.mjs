import { deEsm } from './engine-env.mjs';
// moteur/test/systems.test.mjs
//
// Les Systemes. Le Registry indexait les composants depuis toujours et personne ne le relisait :
// l'architecture a composants etait decorative, et chaque sujet avait sa boucle ad hoc dans
// l'editeur PLUS un miroir dans le runtime. Deux implementations d'une meme regle divergent
// toujours, et c'est le jeu exporte qui differe — l'endroit ou on ne regarde pas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');

function contexte(){
  const bac = { console, Math, JSON, Set, Map, Array, Object, Number, Error };
  bac.window = bac; bac.self = bac; bac.globalThis = bac;
  bac.scene = [];
  bac.isSceneObject = (o) => bac.scene.indexOf(o) !== -1;
  const ctx = vm.createContext(bac);
  vm.runInContext(deEsm(read('js/component-registry.js')), ctx, { filename: 'js/component-registry.js' });
  vm.runInContext(deEsm(read('js/component.js')), ctx, { filename: 'js/component.js' });
  vm.runInContext(deEsm(read('js/node.js')), ctx, { filename: 'js/node.js' });
  vm.runInContext(deEsm(read('js/systems.js')), ctx, { filename: 'js/systems.js' });
  return ctx;
}

test('les systemes tournent dans l ordre declare', () => {
  const ctx = contexte();
  const trace = [];
  ctx.System.register({ name: 'B', requires: [], order: 200, onFrame(){ trace.push('B'); } });
  ctx.System.register({ name: 'A', requires: [], order: 100, onFrame(){ trace.push('A'); } });
  ctx.System.runFrame(0.016, { mode: 'edit' });
  assert.deepEqual(trace, ['A', 'B']);
});

test('un composant sur un noeud detache n est jamais livre', () => {
  const ctx = contexte();
  vm.runInContext('Registry.registerClass(class extends Component {'
    + ' static get typeName(){ return "Ressort"; } });', ctx);
  const detache = { userData: {}, parent: null };   // volontairement PAS dans la scene
  ctx.applyNodeMixin(detache);
  detache.addComponent('Ressort');

  let vus = 0;
  ctx.System.register({ name: 'S', requires: ['Ressort'], order: 1,
                        onFrame(list){ vus = list.length; } });
  ctx.System.runFrame(0.016, { mode: 'edit' });
  // Un template de prefab ou un modele en cours d'import ne doit jamais etre simule.
  assert.equal(vus, 0);
});

test('un systeme qui leve n arrete pas les suivants', () => {
  const ctx = contexte();
  const trace = [];
  ctx.System.register({ name: 'Casse', requires: [], order: 1,
                        onFrame(){ throw new Error('boum'); } });
  ctx.System.register({ name: 'Suivant', requires: [], order: 2,
                        onFrame(){ trace.push('ok'); } });
  ctx.System.runFrame(0.016, { mode: 'edit' });
  // Une erreur dans un systeme fige l'editeur entier si elle remonte : le rendu s'arrete, et le
  // symptome (« l'editeur est gele ») ne designe pas le coupable.
  assert.deepEqual(trace, ['ok']);
});

test('l editeur et le runtime appellent le MEME runFrame', () => {
  const viewport = read('js/viewport.js');
  const runtime = read('js/game-runtime.js');
  assert.equal(/System\.runFrame/.test(viewport), true, 'viewport.js n appelle pas les Systemes');
  assert.equal(/System\.runFrame/.test(runtime), true, 'game-runtime.js n appelle pas les Systemes');
});

test('les miroirs de tilemap et de camera 2D ont disparu du runtime', () => {
  const runtime = read('js/game-runtime.js');
  // Un miroir, c'est une seconde implementation de la meme regle. Celles-ci avaient deja
  // diverge de leur original : le compteur de version manquait cote runtime, et une porte
  // ouverte par un script continuait de bloquer.
  const appels = runtime.split('\n')
    .filter((l) => /rtBuildTilemap|rtUpdateCamera2d/.test(l) && !/^\s*\/\//.test(l));
  assert.deepEqual(appels, []);
});

test('userData ne porte plus de donnees de composant', () => {
  // Les donnees d'un composant vivent DANS le composant. Un sac parallele sur userData, c'est
  // une seconde verite : le Registry ne la voit pas, les Systemes non plus, et une vue
  // d'inspecteur qui interroge le composant montre autre chose que ce que le jeu execute.
  const restes = [];
  const parcours = (dir) => {
    for(const e of readdirSync(path.join(root, dir), { withFileTypes: true })){
      const f = dir + '/' + e.name;
      if(e.isDirectory()){ parcours(f); continue; }
      if(!e.name.endsWith('.js')) continue;
      // `component-migration.js` LIT ces sacs, et c'est tout son objet : convertir un projet
      // enregistre avant la refonte. L'y interdire rendrait ces projets illisibles.
      if(f.endsWith('component-migration.js')) continue;
      const src = readFileSync(path.join(root, f), 'utf8');
      src.split('\n').forEach((l) => {
        if(/^\s*(\/\/|\*)/.test(l)) return;      // un commentaire peut citer l'ancien nom
        if(/userData\.(tilemap2d|_maillesTilemap|cam2d|_framing2d)/.test(l)) restes.push(f);
      });
    }
  };
  parcours('js');
  assert.deepEqual([...new Set(restes)], [],
    'les donnees d un composant vivent dans le composant, pas dans userData');
});
