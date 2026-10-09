// Le genre d'asset `sprite` — ses huit points de branchement.
//
// `docs/ARCHITECTURE.md` l'exige : un genre qui a une shape file évidente DOIT s'écrire sur
// disque, sinon un project open en folder local ne le montre jamais. La régression a déjà été
// vécue avec documentUI/sheetStyle (v0.20.0), et c'est le genre d'oubli qu'aucun usage normal
// ne révèle avant qu'un project ne soit rouvert ailleurs.
//
// On vérifie donc l'ALLER-RETOUR, pas la présence des fonctions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
// Les commentaires citent souvent les genres qu'ils décrivent ; les compter comme du
// branchement ferait passer une spec pour une implémentation.
const codeSeul = (src) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

test('les HUIT points de branchement existent, dans les bons files', () => {
  const points = [
    ['js/assets.js', /sprite:'sprite'/, 'le libellé du genre dans le panneau Projet'],
    ['js/assets.js', /function createAssetSprite/, 'la création'],
    ['js/serialization.js', /kind === 'sprite'[\s\S]{0,200}descriptorSprite/, 'la shape inline du .p3d'],
    ['js/serialization.js', /\.sprite\.json/, 'l\'écriture sur disque'],
    ['js/project-folder.js', /da\.kind === 'sprite'/, 'la relecture depuis le disque'],
    ['js/serialization.js', /13: function/, 'le palier de migration v13 → v14'],
    ['js/game-runtime.js', /da\.kind === 'sprite'/, 'le chargement dans le jeu publié'],
    ['js/import-settings.js', /sprite:1/, 'le genre est déclaré SANS paramètres d\'import']
  ];
  const missing = [];
  points.forEach(function(p){
    if(!p[1].test(codeSeul(read(p[0])))) missing.push(p[2] + '  (' + p[0] + ')');
  });
  assert.deepEqual(missing, [], 'points de branchement absents :\n  ' + missing.join('\n  '));
});

test('le sprite est ECRIT SUR DISQUE, comme l exige ARCHITECTURE.md', () => {
  const src = codeSeul(read('js/serialization.js'));
  // Dans `diskAssetManifest`, pas seulement dans la shape inline : c'est la moitié qu'on
  // oublie, et celle qui manquait pour documentUI/sheetStyle.
  const block = src.slice(src.indexOf('filesAWrite'));
  assert.match(block, /kind === 'sprite'/, 'le genre n\'écrit aucun fichier');
  assert.match(block, /\.sprite\.json/);
  assert.match(block, /descriptorSprite/, 'le contenu écrit doit venir du MÊME descripteur '
    + 'que la shape inline, sinon les deux chemins de relecture divergeront');
});

test('la reference vers la TEXTURE est remappee au chargement', () => {
  const src = codeSeul(read('js/serialization.js'));
  // Un sprite aims une texture, et aucune scène ne traverse cette référence : elle n'est donc
  // remappée par rien d'autre. Oubliée, elle survit intacte dans le fichier et désigne un
  // autre asset — ou aucun. C'est la panne muette déjà rencontrée avec `animExt`.
  assert.match(src, /kind === 'sprite' && a\.textureId[\s\S]{0,160}remapRef\(a\.textureId\)/,
    'textureId n\'est pas remappé : un project rouvert pointera vers le bad asset');
});

test('le format passe a 14, et le palier pose les calques par defaut', () => {
  const src = codeSeul(read('js/serialization.js'));
  assert.match(src, /version: 15,/, 'la version écrite n\'a pas suivi le nouveau palier');
  const palier = src.slice(src.indexOf('13: function'), src.indexOf('13: function') + 700);
  assert.match(palier, /layers2d/, 'le palier ne pose pas les calques de tri');
  assert.match(palier, /data\.version = 14/);
  // Sans calques, `orderOfSort` renvoie tout au fond : un ancien project open en 2D n'aurait
  // aucun calque où ranger un sprite.
  assert.match(palier, /Fond/);
});

test('le sprite N A PAS de parametres d import — la texture les porte', () => {
  const src = codeSeul(read('js/import-settings.js'));
  assert.match(src, /WITHOUT_IMPORT = \{[^}]*sprite:1/,
    'donner des paramètres d\'import au sprite créerait deux endroits où régler le filtrage, '
    + 'dont un sans effet');
});

test('la creation propose « proche, sans mipmap » pour du pixel-art', () => {
  const src = codeSeul(read('js/assets.js'));
  const block = src.slice(src.indexOf('function createAssetSprite'));
  const end = block.indexOf('\nfunction ');
  const body = end === -1 ? block : block.slice(0, end);
  assert.match(body, /ppuByDefault/, 'le ppu n\'est pas proposé d\'après la taille de texture');
  assert.match(body, /filtrage = 'near'/, 'le lissage détruit le pixel-art');
  assert.match(body, /mipmaps = false/);
  // Et une région couvrant toute l'image : un sprite neuf doit être affichable tout de sequence.
  assert.match(body, /regions:/);
});
