// Un projet hébergé doit recevoir les fichiers BINAIRES de ses assets (textures, sons, modèles).
// Régression mesurée (2026-09-28) : registerInCloudProject n'envoyait que project.json, les scènes
// et les fichiers textuels ; project.json listait donc des PNG absents du serveur, et chaque
// texture importée depuis l'ouverture du projet était « introuvable » au rechargement et dans le
// jeu publié — sans une erreur à l'enregistrement. Voir docs/KNOWN_ISSUES.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../js/serialization.js', import.meta.url), 'utf8');
function bodyOf(name){
  const i = src.indexOf('export async function ' + name + '(');
  assert.ok(i !== -1, name + ' introuvable');
  let depth = 0, j = src.indexOf('{', i);
  for(let k = j; k < src.length; k++){ if(src[k] === '{') depth++; if(src[k] === '}' && --depth === 0) return src.slice(j, k + 1); }
  return '';
}

test('l enregistrement cloud envoie les binaires des assets', () => {
  assert.match(bodyOf('registerInCloudProject'), /binaryAssetFiles\(\)/);
});
test('l envoi initial (collectProjectFiles) passe par la même collecte', () => {
  assert.match(bodyOf('collectProjectFiles'), /binaryAssetFiles\(\)/);
});
test('la collecte couvre textures/sons (a.file) et modèles (a.paquet)', () => {
  const b = bodyOf('binaryAssetFiles');
  assert.match(b, /a\.file/); assert.match(b, /a\.paquet/); assert.match(b, /arrayBuffer/);
});

// Second défaut de la même chaîne : le fichier lu dans l'arbre cloud n'était pas un Blob.
// `createAssetTexture` fait `URL.createObjectURL(file)`, qui le refusait : la texture, pourtant
// bien sur le serveur, était jetée au chargement dans un catch muet.
import { cloudTree, manifestOf, mimeOf } from '../js/cloud-project.js';

test('un fichier de l arbre cloud est un vrai File, nommé et typé', async () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const manifest = await manifestOf({'assets/Textures/Terra/terra-blocs.png': png});
  const sha = manifest['assets/Textures/Terra/terra-blocs.png'].sha;
  const tree = cloudTree(manifest, async (s) => (s === sha ? png : null));
  const f = await tree.files[0].handle.getFile();
  assert.ok(f instanceof Blob, 'doit être accepté par URL.createObjectURL');
  assert.equal(f.name, 'terra-blocs.png');
  assert.equal(f.type, 'image/png');
  assert.equal(f.size, png.length);
  assert.deepEqual(new Uint8Array(await f.arrayBuffer()), png);
});
test('mimeOf : extensions connues, et chaîne vide sinon', () => {
  assert.equal(mimeOf('a.WAV'), 'audio/wav');
  assert.equal(mimeOf('scene.scene.json'), 'application/json');
  assert.equal(mimeOf('sans-extension'), '');
});
test('une texture ou un son perdus au chargement le disent dans la console', () => {
  assert.match(src, /console\.error\('Texture « ' \+ da\.name/);
  assert.match(src, /console\.error\('Audio « ' \+ da\.name/);
});
