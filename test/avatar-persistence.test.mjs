// L'Avatar humanoïde (moteur/js/humanoid-avatar.js) doit survivre à un enregistrement puis une
// réouverture de projet, comme les marqueurs d'animation dont ce champ reprend exactement le
// patron (moteur/js/serialization.js). Une des trois moitiés (dossier-projet, .p3d, relecture)
// oubliée ferait perdre l'Avatar en silence — le geste de détection (js/skeleton.js) resterait
// à refaire à chaque réouverture, sans qu'aucun message ne le dise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(path.join(root, 'js/serialization.js'), 'utf8');

// Les trois branches `kind === 'model'` de ce fichier : dossier-projet (écriture), .p3d
// (écriture), et la reconstruction (lecture). Repérées par leur contexte immédiat plutôt que
// par un numéro de ligne, qui bougerait au premier changement voisin.
function branch(anchor){
  const i = src.indexOf(anchor);
  assert.notEqual(i, -1, 'ancre introuvable, ce test doit être relu : « ' + anchor + ' »');
  // 900 et non 700 : la fenetre doit contenir toute la branche, commentaires compris.
  // Trop courte, elle coupe la ligne cherchee et le test echoue sur du code pourtant intact.
  return src.slice(i, i + 900);
}

test('l\'ECRITURE dossier-projet du modele porte avatar', () => {
  const b = branch("if(names.length) dAssets.push({id:a.id, kind:'model'");
  assert.match(b, /avatar:a\.avatar \|\| null/, 'le champ avatar manque à l\'écriture dossier-projet');
});

test('l\'ECRITURE .p3d du modele porte avatar', () => {
  const b = branch("if(fs.length) dAssets.push({id:a.id, kind:'model'");
  assert.match(b, /avatar:a\.avatar \|\| null/, 'le champ avatar manque à l\'écriture .p3d');
});

test('la RECONSTRUCTION du modele relit avatar depuis le fichier', () => {
  const b = branch('createAssetModel(res.root, da.name, res.format,');
  assert.match(b, /if\(da\.avatar\) assetsById\[da\.id\]\.avatar = JSON\.parse\(JSON\.stringify\(da\.avatar\)\)/,
    'la relecture ne recopie plus da.avatar sur l\'asset reconstruit');
});
