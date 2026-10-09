// LA BARRE DU HAUT : une seule rangée, et rien de perdu en chemin.
//
// POURQUOI CE TEST EXISTE. La fusion de `#menus` (27px) et `#bar` (40px) en un seul `#topbar`
// de 32px déplace des boutons d'un parent à l'autre. Tout le câblage de l'éditeur passe par
// `getElementById` : un id qui disparaît ne lève rien au chargement — le bouton n'existe
// simplement plus, son écouteur n'est jamais posé, et on ne s'en aperçoit qu'en cherchant
// « Jouer » des semaines plus tard. La garde énumère donc ce que la barre DOIT contenir.
//
// Elle garde aussi l'étiquette du nom de projet, qui est poussée et non lue : si un troisième
// point d'écriture du nom apparaît sans prévenir l'affichage, l'étiquette ment en silence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const lire = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('AUCUN id de la barre n a disparu a la fusion', () => {
  const html = lire('editor.html');
  // Les ids que js/ui.js, js/play-mode.js, js/copilot.js et js/network-editor.js cherchent.
  // `bar-types-creatable` n'est PLUS dans cette liste : la creation d'objets a quitte la
  // palette de la vue — creer n'est pas regarder. Elle reste entiere dans le menu Objet, que
  // `refreshMenuObject()` alimente ; `refreshTypesCreatable` garde son `if(container)`, donc
  // l'absence de l'element n'est pas une panne mais un choix. Voir le test suivant.
  ['menus', 'topbar', 'bar', 'btn-version', 'btn-play',
   'g-translate', 'g-rotate', 'g-scale', 'g-space',
   'filter-shadows', 'filter-textures', 'filter-shaders',
   'filter-magnet', 'filter-grid', 'view-mode'].forEach((id) => {
    assert.ok(html.indexOf('id="' + id + '"') !== -1,
      'id absent de editor.html : ' + id + ' — son ecouteur ne sera jamais pose');
  });
});

test('la creation d objets reste atteignable, meme hors de la palette', () => {
  // Retirer un chemin d'acces sans verifier qu'il en reste un est la facon la plus simple de
  // perdre une fonctionnalite en croyant ranger une barre d'outils.
  const objets = lire('js/objects.js');
  assert.match(objets, /refreshMenuObject\(\)/,
    'le menu Objet doit toujours etre reconstruit : c est le seul acces restant');
  assert.match(objets, /const container = document\.getElementById\('bar-types-creatable'\);\s*\n\s*if\(container\)/,
    'refreshTypesCreatable doit tolerer l absence du conteneur, sinon le demarrage leve');
});

test('les outils qui changent l AFFICHAGE sont dans la palette, pas dans le viewport', () => {
  // Ils vivaient en bas a gauche de `#view`, a l'oppose du gizmo, alors qu'ils repondent a la
  // meme question : comment je regarde et comment je manipule la scene en ce moment.
  const html = lire('editor.html');
  const bar = html.slice(html.indexOf('<div id="bar">'), html.indexOf('<div id="dock">'));
  // `filter-wireframe` n'est plus ici : le fil de fer est devenu un MODE d'affichage
  // (js/draw-mode.js), pas une bascule. Le garder aurait fait deux commandes pour un seul
  // effet, dont l'une pouvait contredire l'autre.
  ['filter-shadows', 'filter-textures', 'filter-shaders',
   'filter-grid', 'filter-magnet', 'view-mode'].forEach((id) => {
    assert.ok(bar.indexOf('id="' + id + '"') !== -1, id + ' n est pas dans la palette');
  });
  assert.ok(html.indexOf('<div id="filters">') === -1,
    'l ancien conteneur #filters est revenu dans le viewport');
});

test('les menus restent un element A PART, pas un gabarit recopie', () => {
  // js/ui.js:277 fait `getElementById('menus')` puis y ajoute un `.menu` par entree — et les
  // plugins en ajoutent APRES le demarrage. Remplacer #menus par des boutons ecrits en dur
  // dans la page ferait disparaitre les menus des plugins sans rien casser de visible.
  const html = lire('editor.html');
  assert.match(html, /<div id="menus"><\/div>/,
    '#menus doit rester vide : c est js/ui.js qui le remplit');
  assert.match(lire('js/ui.js'), /getElementById\('menus'\)/);
});

test('la barre du haut ne contient plus les outils de la VUE', () => {
  // Le gizmo agit sur le viewport, pas sur le produit : il descend dans la barre d'outils,
  // qui deviendra la palette flottante. S'il remontait, les deux rangees reviendraient.
  const html = lire('editor.html');
  const topbar = html.slice(html.indexOf('<div id="topbar">'), html.indexOf('<div id="bar">'));
  ['g-translate', 'g-rotate', 'g-scale', 'g-space'].forEach((id) => {
    assert.ok(topbar.indexOf('id="' + id + '"') === -1,
      id + ' est remonte dans la barre du haut');
  });
});

test('les actions du PRODUIT sont dans la barre du haut', () => {
  const html = lire('editor.html');
  const debut = html.indexOf('<div id="topbar">');
  const topbar = html.slice(debut, html.indexOf('<div id="bar">'));
  ['btn-version', 'btn-play',
   'project-label'].forEach((id) => {
    assert.ok(topbar.indexOf('id="' + id + '"') !== -1,
      id + ' n est pas dans #topbar');
  });
});

// ---------- L etiquette du nom de projet ----------

test('CHAQUE point d ecriture du nom de projet previent l affichage', () => {
  const src = lire('js/project.js');
  // Les deux seuls endroits qui ecrivent le nom : l'accesseur, et le remplacement en bloc des
  // reglages (qui ne passe PAS par l'accesseur). Si un troisieme apparait, le compte change
  // et ce test le dit — c'est exactement ce qu'on veut savoir.
  const sansCom = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  const ecritures = [...sansCom.matchAll(/settings\.name\s*=|settings\s*=\s*projectSettingsOf/g)];
  assert.equal(ecritures.length, 2,
    'le nombre de points d ecriture du nom a change : verifier que chacun appelle '
    + 'refreshProjectLabel(), sinon la barre du haut affichera un nom perime');
  const appels = [...sansCom.matchAll(/refreshProjectLabel\(\)/g)];
  assert.equal(appels.length, 2, 'un point d ecriture ne previent pas l affichage');
});

test('l etiquette est TOLERANTE — project.js est aussi charge sans DOM par les tests', () => {
  // `refreshProjectLabel` n'existe que si js/ui.js a ete charge. Un appel nu ferait echouer
  // tout le harnais, qui evalue project.js seul.
  const src = lire('js/project.js').replace(/\/\*[\s\S]*?\*\//g, ' ');
  for(const m of src.matchAll(/[^\n]*refreshProjectLabel\(\)[^\n]*/g)){
    assert.match(m[0], /typeof refreshProjectLabel === 'function'/,
      'appel non garde : ' + m[0].trim());
  }
});

test('l affichage ne plante pas quand la barre n est pas la', () => {
  const src = lire('js/ui.js');
  const corps = src.slice(src.indexOf('function refreshProjectLabel'));
  assert.match(corps.slice(0, 400), /if\(!el\) return;/,
    'refreshProjectLabel doit sortir si #project-label est absent — external-editor.html et '
    + 'les fenetres flottantes chargent ui.js sans la barre');
});

test('le bouton Multijoueur ouvre une FENETRE du dock, plus une modale ni un bandeau', () => {
  // v0.172.0 : l'ancienne modale et le bandeau de salon sont remplaces par le panneau « network »
  // (js/network-editor.js), dockable et liste dans le menu Fenetres.
  const html = lire('editor.html');
  assert.ok(html.includes('id="network-panel"'), 'le conteneur #network-panel a disparu de editor.html');
  assert.ok(!html.includes('id="banner-network"'), 'le bandeau #banner-network est revenu');
  const shell = lire('js/ui/panels-shell.js');
  assert.match(shell, /id: 'network'[\s\S]{0,120}adopt: 'network-panel'/, 'le panneau « network » n est plus declare dans le dock');
  const ed = lire('js/network-editor.js');
  assert.ok(!/openModal/.test(ed), 'network-editor.js rouvre une fenetre modale');
  assert.match(ed, /btnNetwork\.addEventListener\('click', openNetworkPanel\)/, 'le bouton n ouvre plus la fenetre');
});
