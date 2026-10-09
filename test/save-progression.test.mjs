// La progression de l'enregistrement (js/project-dirty.js), mesurée sans navigateur.
//
// Ce que ces tests protègent : un pourcentage qui ment. Une barre qui recule, qui dépasse 100 %,
// ou qui saute à 66 % avant la partie la plus longue est PIRE que pas de barre — elle affirme
// que c'est presque fini pendant que l'utilisateur attend encore une minute.
import { deEsm } from './engine-env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

const ctx = vm.createContext({console: console});
vm.runInContext(deEsm(fs.readFileSync(new URL('../js/project-dirty.js', import.meta.url), 'utf8')), ctx);
const { fractionSave, startSave, endSave, markProjectUnsaved, markProjectSaved } = ctx;
const projectSave = vm.runInContext('projectSave', ctx);
const STEPS_SAVE = vm.runInContext('STEPS_SAVE', ctx);

test('la fraction part de 0, finit a 1, et ne recule JAMAIS', function(){
  assert.equal(fractionSave(0, 0), 0);
  assert.equal(fractionSave(STEPS_SAVE.length - 1, 1), 1);
  let avant = -1;
  for(let i = 0; i < STEPS_SAVE.length; i++){
    for(const r of [0, 0.25, 0.5, 0.75, 1]){
      const f = fractionSave(i, r);
      assert.ok(f >= avant, 'recul a l etape ' + i + ' ratio ' + r);
      assert.ok(f >= 0 && f <= 1, 'hors bornes : ' + f);
      avant = f;
    }
  }
});

test('un ratio aberrant est BORNE plutot que propage', function(){
  assert.equal(fractionSave(0, -5), 0);
  assert.equal(fractionSave(STEPS_SAVE.length - 1, 99), 1);
  // Une etape inconnue ne doit pas rendre NaN : le libelle afficherait « NaN % ».
  assert.ok(Number.isFinite(fractionSave(99, 0.5)));
});

test('LA PARTIE LONGUE PESE LE PLUS : les fichiers valent au moins un tiers de la barre', function(){
  const iFichiers = STEPS_SAVE.findIndex(function(s){ return s.key === 'files'; });
  const part = fractionSave(iFichiers, 1) - fractionSave(iFichiers, 0);
  assert.ok(part >= 1/3, 'les fichiers ne pesent que ' + part);
});

test('startSave ouvre la progression, endSave la referme — meme apres un echec', function(){
  assert.equal(projectSave.progress, null);
  const report = startSave();
  assert.ok(projectSave.progress, 'aucune progression ouverte');
  report('files', 0.5);
  assert.equal(projectSave.progress.fraction, fractionSave(2, 0.5));
  endSave();
  assert.equal(projectSave.progress, null);
  // Un rapport APRES la fermeture (promesse en retard, echec deja traite) ne ressuscite rien.
  report('files', 1);
  assert.equal(projectSave.progress, null);
});

test('un enregistrement en cours n EFFACE PAS le drapeau « non enregistre »', function(){
  markProjectSaved();
  markProjectUnsaved();
  assert.equal(projectSave.unsaved, true);
  const report = startSave();
  report('manifest', 0);
  // Tant que l ecriture n a pas abouti, le projet reste non enregistre : c est markProjectSaved(),
  // appele APRES la derniere ecriture, qui a le droit de le dire.
  assert.equal(projectSave.unsaved, true);
  endSave();
  assert.equal(projectSave.unsaved, true);
  markProjectSaved();
  assert.equal(projectSave.unsaved, false);
});
