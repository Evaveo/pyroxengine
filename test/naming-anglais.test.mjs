// moteur/test/naming-anglais.test.mjs
//
// Empêche le français de revenir par la porte de derrière. Le renommage de 2026-08 a coûté
// cinq vagues ; un seul `const noeud =` copié-collé depuis un vieux commit suffirait à rouvrir
// la brèche. Ce test lit le glossaire, donc il n'a pas de liste à maintenir en double.
//
// CE TEST N'EXISTAIT PAS quand il aurait servi. Le merge `3de3eb6` a réintroduit, pour une
// dizaine de fichiers, la version pré-renommage venue de `main` — `Registre`, `restaurerActif`,
// `construireCorpsPour` sont revenus sans que rien ne le signale, et il a fallu deux sessions
// pour s'en apercevoir (voir docs/KNOWN_ISSUES.md). C'est exactement la brèche que ce fichier
// ferme : ce n'est pas un test de style, c'est une garde de non-régression.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { segmenter } from '../outils/renommage.mjs';

const racine = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const glossaire = JSON.parse(readFileSync(path.join(racine, 'outils', 'glossaire.json'), 'utf8'));

function fichiersJs(dossier) {
  const sortie = [];
  (function marcher(d) {
    readdirSync(d).forEach((e) => {
      const p = path.join(d, e);
      if (statSync(p).isDirectory()) return marcher(p);
      if (e.endsWith('.js')) sortie.push(p);
    });
  })(dossier);
  return sortie;
}

// Le reliquat de la vague 6. Il est VIDE depuis que la vague est terminée : les 25 mots
// ambigus sont passés, après les trois chantiers dont ils dépendaient (api de script,
// paramètres des commandes du copilote, propriétés déclarées en chaîne).
//
// Le mécanisme reste en place parce qu'il resservira à la vague suivante : une liste datée,
// avec pour chaque mot CE QUI LE BLOQUE, vaut mieux qu'une suite rouge en permanence — une
// suite qui échoue « normalement » n'est plus un signal. Le test plus bas exige qu'elle reste
// vide : y remettre un mot serait un renommage défait en silence.
const RESTANT = new Set(Object.keys(glossaire._ambiguRestant || {}).filter((k) => k[0] !== '_'));

/** Les noms français des sections déjà migrées, avec leur cible anglaise. */
function nomsMigres() {
  const table = Object.assign({}, glossaire.sur, glossaire.ambigu);
  return Object.keys(table).filter((n) => n !== table[n] && !RESTANT.has(n));
}

// Le CODE seul, sans les commentaires ni les chaînes : le mot « noeud » dans une phrase
// française d'un commentaire n'est pas une faute, et les textes d'interface restent en français
// par décision explicite (voir l'en-tête du glossaire).
function codeSeul(fichier) {
  return segmenter(readFileSync(fichier, 'utf8'))
    .filter((s) => s.type === 'code').map((s) => s.texte).join('');
}

test('aucun identifiant francais du glossaire ne subsiste dans le code de js/', () => {
  const noms = nomsMigres();
  assert.ok(noms.length >= 80, 'le glossaire ne rend que ' + noms.length + ' noms migres — un '
    + 'test qui ne trouve rien a verifier passe au vert sans rien prouver');

  const fautes = [];
  for (const f of fichiersJs(path.join(racine, 'js'))) {
    const code = codeSeul(f);
    for (const nom of noms) {
      if (new RegExp('(^|[^A-Za-z0-9_$])' + nom + '(?![A-Za-z0-9_$])').test(code)) {
        fautes.push(path.relative(racine, f).replace(/\\/g, '/') + ' : ' + nom);
      }
    }
  }
  assert.deepEqual(fautes, [], 'identifiants francais restants dans le code :\n' + fautes.join('\n'));
});

test('le glossaire reste la SOURCE UNIQUE, et le test la lit vraiment', () => {
  // Auto-contrôle. Si le glossaire cessait d'être lu (chemin cassé, section renommée), le test
  // ci-dessus deviendrait vert sans rien vérifier. On exige donc que quelques renommages
  // emblématiques des vagues 1 à 5 y figurent encore, et qu'ils aient bien une cible anglaise.
  for (const [fr, en] of [['Composant', 'Component'], ['Registre', 'Registry'],
                          ['synchroniserComposants', 'syncComponents'],
                          ['appliquerMixinNoeud', 'applyNodeMixin']]) {
    assert.equal(glossaire.sur[fr], en, fr + ' a disparu du glossaire ou a change de cible');
  }
});

test('les identifiants ANGLAIS attendus sont bien ceux que le code porte', () => {
  // Le pendant du premier test : celui-là verifie l'ABSENCE du francais, celui-ci la PRÉSENCE
  // de l'anglais. Les deux sont nécessaires — un fichier vidé par erreur satisferait le premier.
  const socle = codeSeul(path.join(racine, 'js', 'component.js'));
  for (const attendu of ['class Component', 'static restore', 'hydrate']) {
    assert.ok(socle.includes(attendu), 'js/component.js ne porte plus « ' + attendu + ' »');
  }
  // `Registry` et `NodeShells` ont quitté `component.js` pour un module SANS DÉPENDANCE : dix
  // fichiers les lisaient au premier niveau pour s'y inscrire, alors que `component.js` pouvait
  // s'évaluer après eux une fois en modules ES. La garde de nommage suit le déplacement — sinon
  // elle passerait au vert en ne vérifiant plus rien.
  const registre = codeSeul(path.join(racine, 'js', 'component-registry.js'));
  for (const attendu of ['const Registry', 'const NodeShells']) {
    assert.ok(registre.includes(attendu),
      'js/component-registry.js ne porte plus « ' + attendu + ' »');
  }
});

test('le reliquat de la vague 6 reste VIDE', () => {
  // Le mecanisme du reliquat resservira ; ce qu'on interdit, c'est de s'en resservir pour
  // DEFAIRE un renommage deja fait. Un mot qui reapparait ici retire un mot de la
  // surveillance du garde ci-dessus, et c'est exactement ce qu'on ne veut pas rendre facile.
  const restant = Array.from(RESTANT).sort();
  assert.deepEqual(restant, [],
    'la vague 6 est terminee : le reliquat doit rester vide. Reapparu : ' + restant.join(', '));
});
