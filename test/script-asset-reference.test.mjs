import { deEsm } from './engine-env.mjs';
// moteur/test/script-asset-reference.test.mjs
//
// UNE SEULE SOURCE DE VERITE POUR LE CODE D'UN SCRIPT : l'asset.
//
// Le composant Script portait `code`, une COPIE prise au glisser-deposer. Consequences mesurees :
// editer l'asset du panneau Projet ne changeait aucun objet deja servi, editer le script d'un
// objet ne remontait pas a l'asset, et deux objets nes du meme asset divergeaient sans que rien
// ne le signale. Le composant ne garde plus que `scriptId` -- l'identite -- et `values`, les
// variables @expose, qui sont bien un reglage d'instance.
//
// Ce fichier garde le contrat cote COMPOSANT (component-script.js) et cote RESOLUTION
// (codeOfScriptEntry dans js/scripts.js, rtCodeOfScriptEntry dans js/game-runtime.js, qui
// doivent lire la meme chose des deux cotes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(dirname, '..', f), 'utf8');

const CODE_A = ['/** @expose speed {number} = 5 */', 'function update(api){}'].join('\n');

/** Le composant seul, avec la table `assets` que l'editeur expose globalement. */
function contexte(assets){
  const ctx = {
    assets: assets,
    Icons: { html: () => '' },
    Registry: { registerClass(){} }
  };
  vm.createContext(ctx);
  for(const f of ['js/component-registry.js', 'js/component.js', 'js/components/component-script.js']){
    vm.runInContext(deEsm(read(f)), ctx);
  }
  return { ScriptJS: vm.runInContext('ScriptJS', ctx) };
}

test('deux objets nes du meme asset executent LE MEME code, et le suivent quand il change', () => {
  const assets = [{ id: 'a1', kind: 'script', name: 'Deplacement', code: CODE_A }];
  const { ScriptJS } = contexte(assets);

  const n1 = { userData: {} };
  const n2 = { userData: {} };
  const c1 = new ScriptJS(n1, { scriptId: 'a1' });
  const c2 = new ScriptJS(n2, { scriptId: 'a1' });
  c1.onAdd(); c2.onAdd();
  assert.equal(c1.code, CODE_A);
  assert.equal(c2.code, CODE_A);

  // L'EDITION DE L'ASSET EST LE SEUL GESTE. Sans reference, cette ligne ne changeait rien
  // pour c1 ni c2 : chacun gardait sa copie prise a l'attache.
  assets[0].code = 'function update(api){ /* corrige */ }';
  assert.equal(c1.code, assets[0].code,
    'le porteur doit lire le code de l asset : sinon la correction ne part nulle part');
  assert.equal(c2.code, assets[0].code, 'tous les porteurs, pas seulement le premier');
});

test('serialize() n ecrit QUE la reference et les valeurs, jamais le code', () => {
  const { ScriptJS } = contexte([{ id: 'a1', kind: 'script', code: CODE_A }]);
  const c = new ScriptJS({ userData: {} }, { scriptId: 'a1' });
  c.onAdd();
  c.values.speed = 12;

  const data = c.serialize();
  assert.deepEqual(Object.keys(data).sort(), ['active', 'scriptId', 'values']);
  assert.equal(data.scriptId, 'a1');
  assert.equal(data.values.speed, 12, 'les @expose restent un reglage d instance');
  assert.ok(!('code' in data),
    'le code reviendrait dans la scene : c est la copie qu on a retiree, elle ne doit pas '
    + 'pouvoir rentrer par la serialisation');
});

test('un asset supprime rend le composant MANQUANT, sans planter et sans code fantome', () => {
  const assets = [{ id: 'a1', kind: 'script', code: CODE_A }];
  const { ScriptJS } = contexte(assets);
  const c = new ScriptJS({ userData: {} }, { scriptId: 'a1' });
  c.onAdd();
  assert.equal(c.missing, false);

  assets.length = 0;   // l asset est supprime du panneau Projet
  assert.equal(c.missing, true, 'l inspecteur doit pouvoir DIRE que la reference ne resout plus');
  assert.equal(c.code, '', 'aucun code fantome : un objet muet est preferable a un code perime');
  assert.equal(c.exposures.length, 0, 'pas de lecture des @expose sur du vide');
  // L entree reste serialisable telle quelle : reattacher un asset est un geste de l utilisateur,
  // pas une reparation automatique -- et surtout, rien n est detruit en attendant.
  assert.equal(c.serialize().scriptId, 'a1');
});

test('une entree sans reference ne resout rien, des deux cotes du moteur', () => {
  // Les deux resolveurs doivent s accorder : l editeur (codeOfScriptEntry) et le jeu publie
  // (rtCodeOfScriptEntry). Deux copies qui divergent, c est le defaut d origine remis a neuf.
  const ctxEd = { assets: [{ id: 'a1', kind: 'script', code: CODE_A }] };
  vm.createContext(ctxEd);
  const srcEd = read('js/scripts.js').replace(/\r\n/g, '\n');
  const iEd = srcEd.indexOf('function codeOfScriptEntry');
  assert.notEqual(iEd, -1, 'codeOfScriptEntry doit exister dans l editeur');
  vm.runInContext(srcEd.slice(iEd, srcEd.indexOf('\n\n', iEd)), ctxEd);

  const ctxRt = { assetsById: { a1: { kind: 'script', code: CODE_A } } };
  vm.createContext(ctxRt);
  const srcRt = read('js/game-runtime.js').replace(/\r\n/g, '\n');
  const iRt = srcRt.indexOf('function rtCodeOfScriptEntry');
  assert.notEqual(iRt, -1, 'rtCodeOfScriptEntry doit exister dans le runtime publie');
  vm.runInContext(srcRt.slice(iRt, srcRt.indexOf('\n\n', iRt)), ctxRt);

  for(const [nom, resolve] of [['editeur', ctxEd.codeOfScriptEntry],
                               ['runtime', ctxRt.rtCodeOfScriptEntry]]){
    assert.equal(resolve({ scriptId: 'a1', active: true }), CODE_A, nom + ' : reference valide');
    assert.equal(resolve({ active: true }), '',
      nom + ' : une entree SANS scriptId (projet d avant la reference) ne doit rien executer');
    assert.equal(resolve({ scriptId: 'inconnu', active: true }), '',
      nom + ' : une reference cassee ne doit rien executer');
    assert.equal(resolve(null), '', nom + ' : pas de plantage sur une entree absente');
  }
});
