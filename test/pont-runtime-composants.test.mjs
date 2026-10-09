// CE QUE LES COMPOSANTS PARTAGÉS APPELLENT DANS LE JEU PUBLIÉ DOIT Y EXISTER VRAIMENT.
//
// `js/game-runtime.js` est enveloppé dans une IIFE : tout ce qu'il déclare est PRIVÉ. Les
// composants (`js/components/*.js`, `js/component-data.js`) sont des scripts SÉPARÉS, partagés
// avec l'éditeur, et leur branche « je tourne dans le jeu publié » est gardée par un
// `typeof X !== 'undefined'`. Si `X` n'est déclaré QUE dans l'IIFE, cette garde est
// TOUJOURS FAUSSE dans leur portée : la branche n'est jamais exécutée, et rien ne le dit.
//
// Coût réel de ce défaut : `PostVolume.profile` rendait toujours null dans le jeu publié
// (aucun post-traitement, quel que soit le profil), et la reprise de texture directe de
// `Mesh.hydrate` ne s'exécutait jamais. Aucune erreur, aucune trace — des heures de recherche
// du côté des données, qui étaient saines.
//
// Ce test relit les fichiers partagés et exige que chaque nom ainsi gardé soit explicitement
// exposé (`globalThis.X = …`) par le runtime.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');

/** Les fichiers PARTAGÉS entre l'éditeur et le jeu publié. */
function sharedFiles(){
  const list = readdirSync(path.join(root, 'js/components'))
    .filter((f) => f.endsWith('.js')).map((f) => 'js/components/' + f);
  return list.concat(['js/component-data.js', 'js/component-registry.js', 'js/component.js', 'js/node.js']);
}

/** Les noms qu'un fichier partagé teste par `typeof` avant de les appeler. */
function guardedNames(src){
  const out = new Set();
  const re = /typeof\s+([A-Za-z_$][\w$]*)\s*(?:!==|===)\s*'(?:undefined|function)'/g;
  let m;
  while((m = re.exec(src)) !== null) out.add(m[1]);
  return out;
}

test('tout nom du runtime appelé depuis un composant est exposé hors de l IIFE', () => {
  const runtime = read('js/game-runtime.js');
  const manques = [];
  sharedFiles().forEach(function(f){
    guardedNames(read(f)).forEach(function(nom){
      // Le nom est-il déclaré au premier niveau de l'IIFE du runtime ?
      const declare = new RegExp('^(?:const|let|var|function|async function)\\s+' + nom + '\\b', 'm')
        .test(runtime);
      if(!declare) return;                       // vient d'ailleurs (éditeur, module partagé)
      const expose = new RegExp('globalThis\\.' + nom + '\\s*=').test(runtime);
      if(!expose) manques.push(f + ' : ' + nom);
    });
  });
  assert.deepEqual(manques, [],
    'garde(s) `typeof` sur un nom privé de l IIFE du runtime : la branche « jeu publié » de '
    + 'ces composants ne s exécutera JAMAIS, en silence. Exposer le nom par globalThis dans '
    + 'js/game-runtime.js, ou retirer la branche morte.');
});

test('le pont expose au moins la table d assets et la pose de texture directe', () => {
  const runtime = read('js/game-runtime.js');
  ['assetsById', 'rtSetTextureDirect'].forEach(function(nom){
    assert.match(runtime, new RegExp('globalThis\\.' + nom + '\\s*='),
      nom + ' n est plus exposé : les composants partagés reperdent leur branche runtime');
  });
});
