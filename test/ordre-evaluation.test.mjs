// moteur/test/ordre-evaluation.test.mjs
//
// GARDE DE L'ORDRE D'ÉVALUATION DES MODULES d'editor.html (KNOWN_ISSUES v0.178.1 et v0.193.0).
// Un `import` ajouté au mauvais endroit déplace l'ordre dans lequel le navigateur évalue les
// modules d'un cycle : un fichier qui lit un import à son premier niveau tombe alors en zone
// morte (« Cannot access 'ENV_DEFAULT' before initialization ») et l'éditeur s'ouvre vide —
// avec une suite de tests entièrement verte, puisqu'aucun autre test ne charge le vrai graphe.
//
// Ce test rejoue l'algorithme ESM (balises dans l'ordre de la page, parcours en profondeur,
// évaluation en post-ordre) et compare à l'ordre enregistré. Si l'ordre change EXPRÈS :
//   node test/ordre-evaluation.test.mjs --update
// puis ouvrir editor.html et regarder la console avant de committer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT = path.join(ROOT, 'test', 'fixtures', 'ordre-evaluation-editor.txt');

export function evaluationOrder(){
  const html = fs.readFileSync(path.join(ROOT, 'editor.html'), 'utf8');
  const entries = [...html.matchAll(/<script type="module" src="([^"]+)"/g)]
    .map((m) => m[1]).filter((s) => s.startsWith('js/'));
  const done = new Set(), order = [];
  const visit = (f) => {
    if(done.has(f)) return;
    done.add(f);
    let src;
    try { src = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch(e){ return; }
    for(const m of src.matchAll(/^import\s[^;]*?from\s+'([^']+)'/gms)){
      visit(path.posix.normalize(path.posix.join(path.posix.dirname(f), m[1])));
    }
    order.push(f);
  };
  entries.forEach(visit);
  return order;
}

if(process.argv.includes('--update')){
  fs.writeFileSync(SNAPSHOT, evaluationOrder().join('\n') + '\n');
  console.log('ordre enregistré : ' + SNAPSHOT);
} else {
  test('l ordre d évaluation des modules de l éditeur n a pas bougé', () => {
    const attendu = fs.readFileSync(SNAPSHOT, 'utf8').split(/\r?\n/).filter(Boolean);
    const actuel = evaluationOrder();
    // Un module NOUVEAU peut s'insérer ; ce qui compte, c'est l'ordre relatif des anciens.
    const anciens = new Set(attendu);
    const actuelAnciens = actuel.filter((f) => anciens.has(f));
    const attenduPresents = attendu.filter((f) => actuel.includes(f));
    assert.deepEqual(actuelAnciens, attenduPresents,
      'l\'ordre d\'évaluation des modules a changé : un import ajouté déplace le cycle. Retirer '
      + 'l\'import (passer par une globale) ou, si c\'est voulu, vérifier editor.html dans un '
      + 'navigateur puis lancer « node test/ordre-evaluation.test.mjs --update ».');
  });
}
