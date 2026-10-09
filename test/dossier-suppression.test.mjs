// moteur/test/dossier-suppression.test.mjs
//
// « LA MÉMOIRE BOUGE, LE DISQUE SUIT » — l'invariant, pour TOUTES les opérations.
//
// Le défaut qui a produit ce fichier, rapporté ainsi : « la sauvegarde est longue alors que j'ai
// seulement supprimé des éléments du projet, et ça n'a même pas sauvegardé — j'ai encore les
// assets supprimés ». Deux symptômes, une seule cause, et une famille entière derrière.
//
// Le chemin disque d'un asset se calcule (`diskAssetManifest`, js/serialization.js) à partir de
// deux choses qui bougent : son DOSSIER et son NOM — la moitié des genres nomment leur fichier
// `slugFile(a.name)`. Toute opération qui change l'un des deux change donc le chemin disque.
// Quand le disque ne suivait pas, trois dégâts arrivaient ensemble :
//
//   1. l'ancien fichier restait et était RÉADOPTÉ au rafraîchissement suivant (adoptNewAssets →
//      discoverFolderAssets) — l'asset « supprimé » ou « renommé » revenait, parfois en double ;
//   2. le cache d'écriture incrémentale (js/write-cache.js) ne reconnaissait plus aucun chemin :
//      TOUT le projet était réécrit à chaque enregistrement, d'où la lenteur soudaine ;
//   3. et les suppressions d'assets faites ENSUITE cherchaient leur fichier au nouveau chemin,
//      ne l'y trouvaient pas, et échouaient en silence — donc ces assets-là revenaient aussi,
//      alors qu'on n'avait pas touché à leur dossier. C'est ce troisième point qui rendait le
//      défaut incompréhensible pour qui le subissait.
//
// CE QUE CE FICHIER GARDE, ET CE QU'IL NE GARDE PAS. Il ne vérifie pas COMMENT une fonction s'y
// prend — une première version de ce test l'avait fait, et elle a échoué à la première
// refactorisation alors que le comportement était devenu meilleur. Il vérifie que chaque
// opération capable de déplacer un fichier passe par la réconciliation, et que celle-ci garde
// ses deux propriétés de sûreté.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');

/** Le corps d'une fonction exportée, commentaires retirés. */
function corps(fichier, entete){
  const src = read(fichier);
  const i = src.indexOf(entete);
  assert.notEqual(i, -1, fichier + ' : « ' + entete + ' » a disparu — la lecture est à refaire');
  const j = src.indexOf('\nexport ', i + entete.length);
  return src.slice(i, j === -1 ? src.length : j)
    .split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
}

// Les opérations qui changent le dossier ou le nom d'un asset, donc son chemin disque.
// Ajouter une entrée ici est le geste qui accompagne toute nouvelle opération de ce genre.
const OPERATIONS = [
  ['js/assets.js', 'export async function deleteFolder(', 'supprimer un dossier'],
  ['js/assets.js', 'export async function renameFolder(', 'renommer un dossier'],
  ['js/assets.js', 'export async function mutateAsset(', 'toute mutation d\'asset (nom, contenu)']
];

test('CHAQUE OPERATION qui deplace un fichier passe par la reconciliation', () => {
  const manques = [];
  for(const [fichier, entete, quoi] of OPERATIONS){
    const c = corps(fichier, entete);
    if(!/snapshotDiskPaths\(\)/.test(c) || !/reconcileDiskPaths\(/.test(c)){
      manques.push(quoi + ' (' + entete.trim() + ')');
    }
  }
  assert.deepEqual(manques, [],
    'ces opérations changent le chemin disque d\'un asset sans le faire suivre sur le disque. '
    + 'L\'ancien fichier resterait, serait réadopté au rafraîchissement suivant, et le cache '
    + 'd\'écriture réécrirait tout le projet à chaque enregistrement :\n  ' + manques.join('\n  '));
});

test('LA PHOTOGRAPHIE est prise AVANT la mutation', () => {
  // Le piège central : le nom disque est calculé à partir du dossier et du nom COURANTS. Pour un
  // script, un matériau ou un graphe de shader, ce nom n'existe nulle part ailleurs — il est
  // fabriqué à l'écriture. Photographier après la mutation donnerait les NOUVEAUX chemins, et le
  // déplacement porterait sur des fichiers qui n'existent pas.
  for(const [fichier, entete, quoi] of OPERATIONS){
    const c = corps(fichier, entete);
    const iSnap = c.indexOf('snapshotDiskPaths()');
    const iRecon = c.indexOf('reconcileDiskPaths(');
    assert.ok(iSnap !== -1 && iRecon !== -1, quoi + ' : la réconciliation a disparu');
    assert.ok(iSnap < iRecon,
      quoi + ' : la photographie est prise APRÈS la réconciliation — les chemins relevés sont '
      + 'déjà les nouveaux, et rien ne sera déplacé');
  }
});

test('LE RENOMMAGE D UN ASSET ne suit PAS a chaque frappe', () => {
  // L'écouteur `input` du champ `ip-name` écrit `a.name` à chaque caractère. Y faire suivre le
  // disque déplacerait le fichier lettre par lettre : autant d'écritures que de touches, et un
  // dossier jonché d'états intermédiaires si la frappe est interrompue. La photographie se prend
  // au début du renommage, la réconciliation a lieu à la sortie du champ.
  const src = read('js/import-settings.js');
  assert.match(src, /snapshotRenameAsset = snapshotDiskPaths\(\)/,
    'le renommage d\'asset ne photographie plus les chemins à son début');
  const iInput = src.indexOf("e.target.id !== 'ip-name'");
  const bloc = src.slice(iInput, iInput + 900);
  assert.equal(/reconcileDiskPaths\(/.test(bloc), false,
    'la réconciliation est appelée depuis l\'écouteur de FRAPPE : le fichier serait déplacé à '
    + 'chaque caractère tapé');
  assert.match(src, /focusout[\s\S]{0,600}reconcileDiskPaths\(/,
    'la réconciliation n\'a plus lieu à la validation du renommage (focusout)');
});

test('LE RETRAIT D UN DOSSIER n est JAMAIS recursif', () => {
  // `removeEntry(name, {recursive:true})` effacerait le contenu avec le dossier. Si la remontée
  // des fichiers a échoué, ce seraient les assets de la personne. Sans l'option, le navigateur
  // refuse de retirer un dossier non vide : le pire cas devient un dossier vide qui traîne.
  const c = corps('js/project-folder.js', 'export async function removeEmptyFolderOnDisk(');
  assert.equal(/recursive\s*:\s*true/.test(c), false,
    'removeEmptyFolderOnDisk efface RÉCURSIVEMENT : une remontée de fichiers ratée détruirait '
    + 'les assets au lieu de laisser un dossier vide');
});

test('UN DEPLACEMENT DE FICHIER ecrit AVANT d effacer', () => {
  // Tout est best-effort ici : si l'on effaçait d'abord et que l'écriture échouait, la perte
  // serait définitive ET silencieuse. Un doublon vaut mieux qu'un fichier perdu.
  const c = corps('js/project-folder.js', 'export async function moveFileOnDisk(');
  const iEcrit = c.indexOf('writeFileInFolder(');
  const iEfface = c.indexOf('removeEntry(');
  assert.ok(iEcrit !== -1 && iEfface !== -1, 'moveFileOnDisk a changé de forme');
  assert.ok(iEcrit < iEfface,
    'moveFileOnDisk efface la source AVANT d\'écrire la destination : une écriture qui échoue '
    + 'perd le fichier, en silence');
});

test('LA CARTE D IDENTITE suit son fichier', () => {
  // Le `.meta` porte l'id persistant de l'asset. Laissé derrière, il ferait deux dégâts d'un
  // coup : l'asset déplacé perdrait son identité au rechargement, et le `.meta` orphelin
  // continuerait de revendiquer cet id depuis l'ancien emplacement.
  const c = corps('js/project-folder.js', 'export async function moveFileOnDisk(');
  assert.match(c, /META_SUFFIX/,
    'moveFileOnDisk ne déplace plus le .meta avec son fichier — l\'asset perdrait son identité');
});

test('LES MESSAGES DE CONFIRMATION disent ce qui va reellement se passer', () => {
  // Les anciens messages PROMETTAIENT le défaut : « le dossier et ses fichiers restent sur le
  // disque », « les anciens seront retrouvés comme des assets en double ». Un message qui décrit
  // fidèlement un comportement fautif le fait passer pour une décision.
  // On ne lit que le texte des `confirm(...)`, pas tout le corps : les messages d'ERREUR, eux,
  // ont parfaitement le droit de parler de doublons — c'est même ce qu'ils doivent dire quand le
  // disque n'a pas pu suivre.
  const texteDesConfirm = (c) => (c.match(/confirm\((?:[^()]|\([^()]*\))*\)/g) || []).join(' ');
  const suppr = texteDesConfirm(corps('js/assets.js', 'export async function deleteFolder('));
  const renom = texteDesConfirm(corps('js/assets.js', 'export async function renameFolder('));
  assert.ok(suppr.length > 40 && renom.length > 40,
    'le texte des confirmations n\'a pas été retrouvé — la lecture est à refaire');
  assert.equal(/restent sur le disque/.test(suppr), false,
    'la confirmation de suppression annonce encore que les fichiers restent sur le disque');
  assert.equal(/assets en double/.test(renom), false,
    'la confirmation de renommage annonce encore des assets en double');
  // L'irréversibilité, elle, reste vraie : Ctrl+Z ne rattrape pas un fichier déplacé.
  assert.match(suppr, /Ctrl\+Z/, 'la suppression ne prévient plus qu\'elle est irréversible');
  assert.match(renom, /Ctrl\+Z/, 'le renommage ne prévient plus qu\'il est irréversible');
});
