// LE NUMÉRO DE VERSION DU BUILD — ce qu'il faut pour qu'il serve.
//
// Il n'existe que pour une chose : que quelqu'un qui décrit un problème puisse dire de quel
// build il parle. Trois façons de le rendre inutile sans rien casser de visible :
//
//   1. le laisser dériver du ChangeLog — il désignerait alors une version qui n'existe pas ;
//   2. écrire dans un identifiant que la page publiée n'émet pas — le texte irait nulle part,
//      en silence, parce que `getElementById` rend `null` sans se plaindre ;
//   3. laisser l'option d'affichage sans effet — un build « sans numéro » en porterait un.
//
// Aucun de ces trois échecs ne produit d'erreur. Ils se mesurent, donc on les mesure : le
// troisième en EXÉCUTANT la fonction d'affichage, pas en cherchant le mot « visible » dedans.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LF = String.fromCharCode(10);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8').split(String.fromCharCode(13)).join('');

function versionDeclaree(){
  const src = read('js/version.js');
  const i = src.indexOf("VERSION_ENGINE = '");
  assert.notEqual(i, -1, 'VERSION_ENGINE a disparu de js/version.js');
  const d = i + "VERSION_ENGINE = '".length;
  return src.slice(d, src.indexOf("'", d));
}

/** Le body source d'une fonction de premier niveau, de sa déclaration à la suivante. */
function corpsDe(file, name){
  const src = read(file);
  const i = src.indexOf('function ' + name + '(');
  assert.notEqual(i, -1, file + ' : ' + name + ' a disparu');
  const end = src.indexOf(LF + 'function ', i + 10);
  return src.slice(i, end === -1 ? src.length : end);
}

// Le rapprochement avec ChangeLogs/ serait le contrôle le plus utile — et il n'est pas fait ici :
// ChangeLogs/ vit à la RACINE du dépôt, hors de `moteur/`, qui est le seul folder destiné à
// partir en public. Une garde qui lit au-dessus de `moteur/` passerait ici et échouerait là-bottom.
// Ce qui suit vérifie donc ce qui est vérifiable de l'intérieur : que le numéro a une shape, et
// qu'il arrive bien jusqu'au build. Le rapprochement avec le ChangeLog reste un geste humain.
test('le numéro de version a une shape utilisable', () => {
  const v = versionDeclaree();
  const parties = v.split('.');
  assert.equal(parties.length, 3, 'version « ' + v + ' » : trois nombres attendus, ex. 0.75.0');
  parties.forEach(function(p){
    assert.ok(p.length && String(Number(p)) === p,
      'version « ' + v + ' » : « ' + p + ' » n est pas un number');
  });
});

test('le runtime écrit dans un identifiant que la page publiée émet vraiment', () => {
  const body = corpsDe('js/game-runtime.js', 'showVersionBuild');
  const i = body.indexOf("$('");
  assert.notEqual(i, -1, 'showVersionBuild ne cherche plus d élément');
  const id = body.slice(i + 3, body.indexOf("'", i + 3));

  assert.ok(read('js/build.js').indexOf('id=' + String.fromCharCode(34) + id) !== -1,
    'la page publiée (js/build.js) n émet pas « ' + id + ' » : le runtime écrirait dans le vide');
  assert.ok(read('build-test/index.html').indexOf('id=' + String.fromCharCode(34) + id) !== -1,
    'le harnais build-test/ n a pas « ' + id + ' » : il testerait une page sans le bandeau');
});

test('l option de build décide RÉELLEMENT de l affichage', () => {
  // La fonction est extraite et exécutée avec un faux élément : c est son EFFET qu on mesure,
  // pas la présence du mot « visible » dans sa source.
  const faire = (D, el) => {
    const f = new Function('$', 'D', corpsDe('js/game-runtime.js', 'showVersionBuild')
      + LF + 'return showVersionBuild;')(() => el, D);
    f();
    return el.textContent;
  };
  const stamp = {engine: '9.9.9', date: '2026-01-02 03:04'};

  const shown = faire({build: Object.assign({visible: true}, stamp)}, {textContent: ''});
  assert.ok(shown.indexOf('9.9.9') !== -1, 'version absente de l affichage : « ' + shown + ' »');
  assert.ok(shown.indexOf('2026-01-02 03:04') !== -1, 'date absente : « ' + shown + ' »');

  assert.equal(faire({build: Object.assign({visible: false}, stamp)}, {textContent: ''}), '',
    'l option « masqué » n empêche pas l affichage — le build la porte pour rien');
  assert.equal(faire({}, {textContent: ''}), '',
    'un build sans estampille shown quelque chose : ce serait un numéro inventé');
});

test('le build estampille depuis la version et depuis l option du project', () => {
  const src = read('js/build.js');
  const i = src.indexOf('data.build = {');
  assert.notEqual(i, -1, 'js/build.js n estampille plus le build');
  const block = src.slice(i, src.indexOf('};', i));
  assert.ok(block.indexOf('VERSION_ENGINE') !== -1,
    'l estampille n utilise pas VERSION_ENGINE : le numéro publié aurait sa propre source');
  assert.ok(block.indexOf('project.versionVisible') !== -1,
    'l estampille ne lit pas le réglage du project : l interrupteur du menu ne servirait à rien');
});
