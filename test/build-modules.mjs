// moteur/test/build-modules.mjs
// La table des modules du build, lue une seule fois pour tous les tests qui l'interrogent.
//
// Quatre tests parsaient chacun `js/build.js` à leur façon — l'un cherchait
// `const sources = [`, l'autre le motif `'x.js': fflate.strToU8(textes[N])`, un troisième une
// liste de modules partagés recopiée à la main. Résultat : changer la forme de la table dans
// `build.js` cassait quatre tests pour la même raison, et un module oublié dans la table
// pouvait rester invisible d'un test à l'autre (c'est ainsi que `js/shadow-fit.js` a été
// embarqué par l'aperçu et jamais par le build — voir docs/REVUE_2026-09-10.md § 1.1).
//
// Une seule lecture, ici, et les tests posent leurs questions dessus.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const source = readFileSync(path.join(root, 'js/build.js'), 'utf8').replace(/\r\n/g, '\n');

/**
 * Les entrées de `BUILD_MODULES` : `{src, out}`, `out` déduit quand il n'est pas écrit.
 *
 * On lit le TEXTE plutôt que d'exécuter `js/build.js` : le fichier tire `fflate`, `fetch`,
 * `escapeHtml` et le DOM, et le bouchon nécessaire finirait par masquer ce qu'on mesure.
 * Le garde-fou de cette lecture est l'assertion de volume juste en dessous.
 */
export function buildModules(){
  const i = source.indexOf('const BUILD_MODULES = [');
  assert.notEqual(i, -1,
    'la table `BUILD_MODULES` a disparu de js/build.js — ce fichier de test est à relire');
  const end = source.indexOf('\n];', i);
  assert.notEqual(end, -1, 'la forme de `BUILD_MODULES` a changé');
  const bloc = source.slice(i, end);
  const out = [...bloc.matchAll(/\{\s*src:\s*'([^']+)'(?:\s*,\s*out:\s*'([^']+)')?\s*\}/g)]
    .map((m) => ({ src: m[1], out: m[2] || m[1].replace(/^js\//, '') }));
  assert.ok(out.length >= 50,
    'seulement ' + out.length + ' modules lus dans BUILD_MODULES — le motif de lecture a changé');
  return out;
}

/** Les URL `js/…` embarquées par le build. */
export function buildSources(){
  return buildModules().map((m) => m.src).filter((s) => s.startsWith('js/'));
}

/** Les noms de fichiers tels qu'ils entrent dans le ZIP. */
export function buildOutputs(){
  return buildModules().map((m) => m.out);
}

/** Ce module est-il embarqué par le build ? `url` s'écrit `js/x.js` ou `x.js`. */
export function embeddedInBuild(url){
  const voulu = url.startsWith('js/') ? url : 'js/' + url;
  return buildModules().some((m) => m.src === voulu || m.out === url);
}
