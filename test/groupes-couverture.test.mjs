// AUCUN TEST NE DOIT POUVOIR NE PAS TOURNER.
//
// Depuis que la CI sélectionne les fichiers par domaine (test/groupes.mjs) au lieu d'un glob,
// un fichier de test oublié dans la carte ne s'exécute plus NULLE PART — et ne le dit pas. Le
// symptôme serait le pire qui soit pour une suite de tests : du vert qui ne mesure rien.
//
// Ce fichier est la contrepartie de ce choix. Il compare la carte au contenu réel du dossier
// dans les deux sens : un fichier non inscrit échoue, une entrée qui ne désigne plus rien
// échoue aussi (un test renommé ou supprimé laisse sinon un job de CI qui plante à l'ouverture
// sans qu'on sache pourquoi). Et un même fichier inscrit dans deux domaines tournerait deux
// fois : ce n'est pas faux, c'est du temps de CI payé deux fois, donc on le refuse.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GROUPS } from './groupes.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const onDisk = readdirSync(here).filter((f) => f.endsWith('.test.mjs')).sort();

/** Tous les fichiers de la carte, domaine d'origine conservé pour nommer le doublon. */
function mapped(){
  const out = new Map();
  for(const domain of Object.keys(GROUPS)){
    for(const file of GROUPS[domain]){
      out.set(file, (out.get(file) || []).concat(domain));
    }
  }
  return out;
}

test('CHAQUE fichier de test appartient a un domaine — sinon il ne tourne plus en CI', () => {
  const carte = mapped();
  const orphans = onDisk.filter((f) => !carte.has(f));
  assert.deepEqual(orphans, [],
    'a inscrire dans test/groupes.mjs, sinon ces tests ne tournent nulle part : ' + orphans.join(', '));
});

test('AUCUNE entree fantome : la carte ne designe que des fichiers existants', () => {
  const ghosts = [...mapped().keys()].filter((f) => !onDisk.includes(f)).sort();
  assert.deepEqual(ghosts, [],
    'ces entrees de test/groupes.mjs ne designent plus aucun fichier : ' + ghosts.join(', '));
});

test('AUCUN fichier dans deux domaines — il tournerait deux fois', () => {
  const doubles = [...mapped().entries()].filter(([, d]) => d.length > 1)
    .map(([f, d]) => f + ' (' + d.join(' + ') + ')');
  assert.deepEqual(doubles, []);
});

test('groupes-couverture lui-meme est inscrit — le garde ne se garde pas tout seul', () => {
  assert.ok(mapped().has('groupes-couverture.test.mjs'),
    'le test-garde doit figurer dans la carte, sinon il cesse de tourner en silence');
});
