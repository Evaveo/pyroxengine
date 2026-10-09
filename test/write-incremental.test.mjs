// L'enregistrement incrémental (js/write-cache.js) et son invalidation (js/project.js),
// mesurés sans navigateur ni disque.
//
// CE QUE CES TESTS PROTÈGENT : la seule façon dont ce cache peut nuire est de sauter une
// écriture qu'il fallait faire — le travail de l'utilisateur reste alors en mémoire, l'éditeur
// affiche « enregistré », et rien ne le dit. Tout ce qui suit mesure ce cas.
import { deEsm } from './engine-env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

function envCache(){
  const ctx = vm.createContext({console: console});
  vm.runInContext(deEsm(fs.readFileSync(new URL('../js/write-cache.js', import.meta.url), 'utf8')), ctx);
  return ctx;
}

test('un contenu INCHANGE ne se reecrit pas, un contenu different si', function(){
  const { changedSinceWrite, noteWritten } = envCache();
  assert.equal(changedSinceWrite('assets/a.js', 'x = 1'), true, 'jamais ecrit');
  noteWritten('assets/a.js', 'x = 1');
  assert.equal(changedSinceWrite('assets/a.js', 'x = 1'), false);
  assert.equal(changedSinceWrite('assets/a.js', 'x = 2'), true);
  // Un chemin different ne partage RIEN avec un autre, meme a contenu identique.
  assert.equal(changedSinceWrite('assets/b.js', 'x = 1'), true);
});

test('des contenus proches ne se confondent pas (empreinte, pas longueur seule)', function(){
  const { changedSinceWrite, noteWritten } = envCache();
  const cas = ['{"a":1}', '{"a":2}', '{"b":1}', 'ab', 'ba', '', ' ', 'éa', 'aé'];
  for(const c of cas){
    noteWritten('assets/x', c);
    for(const autre of cas){
      if(autre === c) continue;
      assert.equal(changedSinceWrite('assets/x', autre), true,
        'confusion entre ' + JSON.stringify(c) + ' et ' + JSON.stringify(autre));
    }
  }
});

test('UN FICHIER MODIFIE A LA MAIN se reecrit : invalidateWrite le rouvre', function(){
  const { changedSinceWrite, noteWritten, invalidateWrite } = envCache();
  noteWritten('assets/herbe.material.json', '{"color":"vert"}');
  assert.equal(changedSinceWrite('assets/herbe.material.json', '{"color":"vert"}'), false);
  invalidateWrite('assets/herbe.material.json');   // ce que fait la surveillance du dossier
  assert.equal(changedSinceWrite('assets/herbe.material.json', '{"color":"vert"}'), true);
});

test('resetWriteCache oublie TOUT : changement de dossier, surveillance eteinte', function(){
  const ctx = envCache();
  const { noteWritten, changedSinceWrite, resetWriteCache, sizeWriteCache } = ctx;
  noteWritten('assets/a.js', 'a');
  noteWritten('assets/b.js', 'b');
  assert.equal(sizeWriteCache(), 2);
  resetWriteCache();
  assert.equal(sizeWriteCache(), 0);
  assert.equal(changedSinceWrite('assets/a.js', 'a'), true);
});

// ---------- L'invalidation depuis le sondage du dossier (js/project.js) ----------
// invalidateWritesOfDisk() y est volontairement PURE : elle ne lit que deux Map de signatures
// et le registre de nos propres écritures. On la recharge seule, sans le reste de project.js.
function invalidateWritesOfDisk(baseline, current, ours, invalidateWrite){
  for(const [filePath, sig] of current){
    if(baseline.get(filePath) === sig || (ours && ours.has(filePath))) continue;
    invalidateWrite(filePath);
  }
  for(const filePath of baseline.keys()){
    if(current.has(filePath) || (ours && ours.has(filePath))) continue;
    invalidateWrite(filePath);
  }
}

test('LA COPIE EST FIDELE : la fonction du test fait ce que fait js/project.js', function(){
  const src = fs.readFileSync(new URL('../js/project.js', import.meta.url), 'utf8');
  const corps = src.slice(src.indexOf('export function invalidateWritesOfDisk'));
  // Les deux boucles et leurs deux gardes : si project.js en change, ce test doit tomber plutot
  // que de laisser la copie ci-dessus mesurer une logique qui n'existe plus.
  assert.ok(/for\(const \[filePath, sig\] of current\)/.test(corps));
  assert.ok(/baseline\.get\(filePath\) === sig \|\| \(ours && ours\.has\(filePath\)\)/.test(corps));
  assert.ok(/for\(const filePath of baseline\.keys\(\)\)/.test(corps));
  assert.ok(/current\.has\(filePath\) \|\| \(ours && ours\.has\(filePath\)\)/.test(corps));
});

test('un chemin MODIFIE, SUPPRIME ou NOUVEAU hors editeur est invalide — le notre, non', function(){
  const vus = [];
  const baseline = new Map([
    ['assets/stable.js', '10:1'],
    ['assets/main.js', '10:1'],
    ['assets/parti.js', '10:1'],
    ['assets/anous.js', '10:1']
  ]);
  const current = new Map([
    ['assets/stable.js', '10:1'],
    ['assets/main.js', '20:2'],       // modifie hors editeur
    ['assets/neuf.png', '99:9'],      // depose hors editeur
    ['assets/anous.js', '30:3']       // ecrit par NOUS
  ]);
  invalidateWritesOfDisk(baseline, current, new Set(['assets/anous.js']),
                         function(p){ vus.push(p); });
  assert.deepEqual(vus.sort(), ['assets/main.js', 'assets/neuf.png', 'assets/parti.js']);
});

test('LE .META COMPTE, alors que le classement ne l annonce jamais', function(){
  // C'est le piege de cette invalidation : `emittingPath` exclut les `.meta` des listes
  // added/modified/removed. Se fier a ces listes laisserait une carte d'identite reecrite a la
  // main passer pour « deja a jour » indefiniment.
  const vus = [];
  invalidateWritesOfDisk(new Map([['assets/herbe.png.meta', '10:1']]),
                         new Map([['assets/herbe.png.meta', '11:2']]),
                         new Set(), function(p){ vus.push(p); });
  assert.deepEqual(vus, ['assets/herbe.png.meta']);
});
