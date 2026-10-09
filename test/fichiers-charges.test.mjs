// Tout fichier de js/ doit être chargé par editor.html — ou déclaré exception ICI.
//
// POURQUOI CE TEST EXISTE. Trois fichiers ont vécu plusieurs jours sans être chargés :
// material-props.js, help.js et render-perf.js. Leurs balises <script> ont disparu quand
// editor.html a été réécrit pour le pont ESM, et rien ne l'a signalé. Conséquences
// réelles, mesurées avant correction :
//   - import-settings.js appelait `renderPropsMaterial` SANS garde → sélectionner un
//     matériau levait une ReferenceError, l'inspecteur était mort ;
//   - le menu Aide et la commande `describe_material` faisaient de même ;
//   - l'instanciation, elle, est gardée par `typeof` : elle ne levait rien et ne faisait
//     simplement plus rien. Le pire des trois, parce qu'invisible.
//
// CE QUE LE LINT D'ORDRE DE CHARGEMENT NE POUVAIT PAS VOIR. Il vérifie que les fichiers
// RÉFÉRENCÉS sont dans le bon order : il part de la liste d'editor.html. Un fichier
// absent de cette liste n'existe pas pour lui — il ne pouvait donc PAS échouer sur ce cas.
// Une garde qui part de la liste à vérifier ne peut jamais signaler ce qui manque à cette
// liste ; il fallait partir du DISQUE.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Exceptions, chacune avec sa raison. Une exception sans raison est un oubli déguisé.
const HORS_PAGES = {
  'game-runtime.js': 'lecteur autonome des jeux publiés : chargé par la page du BUILD, engendrée '
    + 'par js/build.js, pas par une page du dépôt',
  'copilot-observer.js': 'PAS de <script> propre à dessein : copilot-workshop.js l\'importe déjà '
    + '(`import { kindProjectADate } from \'./copilot-observer.js\'`), et il importe lui-même '
    + 'CopilotTools de copilot.js — l\'ordre est garanti par le graphe de modules ES. Une balise '
    + '<script> séparée le chargeait une seconde fois sous une URL différente (avec/sans le ?v= '
    + 'de cache-busting), l\'exécutant deux fois — ses CopilotTools.register() levaient alors un '
    + 'doublon dès le second passage. Voir test/copilote-observer.test.mjs.',
  'copilot-workshop.js': 'PAS de <script> propre, même raison que copilot-observer.js ci-dessus : '
    + 'ui-factory.js l\'importe déjà (`import { createSoundProc, createTextureProc } from '
    + '\'./copilot-workshop.js\'`). Mesuré de la même façon : create_texture s\'enregistrait deux '
    + 'fois. Voir test/copilote-registre.test.mjs.'
};

// Le moteur n'a plus une seule page mais plusieurs — l'éditeur, l'aide, l'aperçu de jeu.
// La garde a d'abord exigé `editor.html` et rien d'autre : elle a immédiatement crié au
// loup sur help-content.js et help-page.js, que help.html charge VOLONTAIREMENT seule
// pour que l'éditeur ne paie pas le poids de l'aide à chaque démarrage.
// Ce qui compte n'est pas QUELLE page charge un fichier, c'est qu'AU MOINS UNE le fasse.
function pagesHtml(){
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.html'))
    .map((e) => e.name);
}

function fichiersJs(folder, prefixe) {
  return fs.readdirSync(path.join(root, folder), { withFileTypes: true })
    .flatMap((e) => {
      if (e.isDirectory()) return fichiersJs(path.join(folder, e.name), prefixe + e.name + '/');
      return e.name.endsWith('.js') ? [prefixe + e.name] : [];
    });
}

test('chaque fichier de js/ est charge par au moins une page, ou declare en exception', () => {
  const pages = pagesHtml();
  assert.ok(pages.length >= 2,
    'moins de deux pages HTML trouvées — la garde regarde-t-elle au bon endroit ?');
  const contenus = pages.map((p) => fs.readFileSync(path.join(root, p), 'utf8'));

  const orphelins = fichiersJs('js', '').filter((rel) => {
    if (HORS_PAGES[rel]) return false;
    return !contenus.some((html) => html.indexOf('js/' + rel) !== -1);
  });

  assert.deepEqual(orphelins, [],
    'file(s) chargé(s) par AUCUNE page (' + pages.join(', ') + ') — leurs fonctions '
    + 'sont introuvables à l’exécution : ' + orphelins.join(', '));
});

test('les exceptions declarees existent encore', () => {
  // Une exception qui survit à la suppression de son fichier masquerait le jour où
  // quelqu'un recrée un fichier de ce nom en croyant qu'il sera chargé.
  const presents = fichiersJs('js', '');
  const fantomes = Object.keys(HORS_PAGES).filter((f) => presents.indexOf(f) === -1);
  assert.deepEqual(fantomes, [],
    'exception(s) déclarée(s) pour un fichier qui n’existe plus : ' + fantomes.join(', '));
});
