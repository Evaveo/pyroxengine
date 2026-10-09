// L'ENCODAGE DES SOURCES : UTF-8, sans BOM, sans mojibake.
//
// Ce fichier existe parce que le défaut est arrivé, sur ce dépôt, en faisant un bump de version.
// Un `Get-Content -Raw` PowerShell sans `-Encoding` lit de l'UTF-8 comme du Windows-1252, et le
// `Set-Content -Encoding utf8` qui suit rajoute un BOM : le remplacement d'UNE chaîne de version a
// réécrit trois fichiers en entier, cassé tous leurs accents et ajouté trois BOM. 298 lines
// modifiées pour un diff qui devait en faire 113.
//
// CE QUI REND CE DÉFAUT DANGEREUX N'EST PAS SA GRAVITÉ, C'EST SON SYMPTÔME. Le moteur continue de
// fonctionner : rien ne lève, aucun test de logique ne bronche, tout au plus un onglet porte un
// title illisible. Et un title illisible dans un outil d'inspection, on l'attribue à l'outil
// d'inspection. Je l'ai vu et je l'ai écarté, avant de m'en apercevoir en relisant le diff.
//
// RIEN DE FAUTIF N'EST ÉCRIT ICI, TOUT EST CALCULÉ. Trois versions de ce fichier ont échoué avant
// celle-ci, chaque fois de la façon qu'il dénonce :
//   · la liste des sequences interdites était en dur — le fichier CONTENAIT ce qu'il interdit et se
//     dénonçait lui-même ;
//   · la moitié de ces sequences étaient fausses, devinées d'après leur apparence à l'écran au lieu
//     d'être dérivées des octets ; une table Windows-1252 recopiée à la main était décalée d'un cran ;
//   · et la classe de caractères de la zone de continuation, écrite en clair, a mis un vrai
//     caractère de contrôle U+0080 dans ce fichier — qui a échoué sur son propre contrôle C1.
//     Le test avait raison contre son auteur, trois fois de sequence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// vendor/ et vendor-esm/ sont des bundles tiers : leur encodage n'est pas de notre ressort, et un
// minifieur peut y produire des sequences d'octets qui ressemblent à du mojibake sans en être.
const IGNORES = ['vendor', 'vendor-esm', 'node_modules', 'temp-anima', '.git'];
const EXTENSIONS = ['.js', '.mjs', '.html', '.css', '.md', '.json'];

function files(rel){
  const out = [];
  for(const e of readdirSync(path.join(root, rel || '.'), {withFileTypes: true})){
    if(IGNORES.includes(e.name)) continue;
    const r = rel ? rel + '/' + e.name : e.name;
    if(e.isDirectory()) out.push(...files(r));
    else if(EXTENSIONS.includes(path.extname(e.name))) out.push(r);
  }
  return out;
}

const TOUS = files('');

// LES AMORCES, PAR CODE DE CARACTÈRE.
//
// Tout caractère latin accentué s'écrit C3 xx en UTF-8 : relu octet par octet, le C3 devient
// U+00C3 (A tilde). L'space insécable et les guillemets français passent par C2, qui devient
// U+00C2. La ponctuation typographique — apostrophe courbe, tirets, points de suspension — s'écrit
// E2 8x xx : le E2 devient U+00E2, suivi d'un caractère de la zone 0x80–0x9F.
//
// U+00C3 seul existe en portugais et U+00C2 en roumain — mais SUIVIS d'un octet de continuation
// (0x80–0xBF), ils ne forment plus un mot d'aucune langue. La zone est écrite par échappements :
// l'écrire en clair mettrait dans ce fichier ce qu'il interdit, et c'est arrivé.
const CONTINUATION = new RegExp('[\\u0080-\\u00bf]');
const AMORCES = [
  {sequence: String.fromCharCode(0xC3), quoi: 'lettre accentuée', suivi: CONTINUATION},
  {sequence: String.fromCharCode(0xC2), quoi: 'space insécable ou guillemet', suivi: CONTINUATION},
  // Le cas Windows-1252 : ses octets 0x80–0x9F sont imprimables, donc le contrôle C1 plus bas ne
  // les verrait pas. U+20AC — l'euro, octet 0x80 — est celui qui suit le plus souvent, la
  // ponctuation typographique s'écrivant E2 80 xx.
  {sequence: String.fromCharCode(0xE2) + String.fromCharCode(0x20AC), quoi: 'ponctuation typographique'}
];

/** Ce que devient une chaîne quand ses octets UTF-8 sont relus un par un. */
function malDecode(text){
  return Array.from(Buffer.from(text, 'utf8'), (o) => String.fromCharCode(o)).join('');
}

/** Un fichier porte-t-il l'amorce d'un bad décodage ? */
function amorceDans(text){
  for(const a of AMORCES){
    let i = text.indexOf(a.sequence);
    while(i !== -1){
      if(!a.suivi || a.suivi.test(text[i + a.sequence.length] || '')) return a.quoi;
      i = text.indexOf(a.sequence, i + 1);
    }
  }
  return null;
}

/** Le premier caractère de contrôle C1, s'il y en a un. */
function c1Dans(text){
  for(let i = 0; i < text.length; i++){
    const c = text.charCodeAt(i);
    if(c >= 0x80 && c <= 0x9F) return 'U+00' + c.toString(16).toUpperCase() + ' en position ' + i;
  }
  return null;
}


test('AUCUN FICHIER SOURCE ne commence par un BOM', () => {
  assert.ok(TOUS.length >= 80,
    `seulement ${TOUS.length} files parcourus — le balayage est cassé, et un test qui ne trouve `
    + 'rien à vérifier passe au vert');

  const avecBom = TOUS.filter((f) => {
    const o = readFileSync(path.join(root, f));
    return o.length >= 3 && o[0] === 0xEF && o[1] === 0xBB && o[2] === 0xBF;
  });
  assert.deepEqual(avecBom, [],
    'BOM UTF-8 en tête de fichier — en HTML il précède <!doctype, en JS il entre dans la première\n'
    + 'chaîne du fichier, et dans les deux cas il ne se voit pas à la lecture : ' + avecBom.join(', '));
});

test('AUCUN FICHIER ne porte l amorce d un aller-retour UTF-8 vers 8 bits', () => {
  const fautifs = [];
  for(const f of TOUS){
    const quoi = amorceDans(readFileSync(path.join(root, f), 'utf8'));
    if(quoi) fautifs.push(`${f} : ${quoi} mal décodée`);
  }
  assert.deepEqual(fautifs, [],
    'accents lus dans un jeu 8 bits puis réécrits en UTF-8 — le moteur continue de tourner, seul\n'
    + 'l\'affichage est cassé, et c\'est ce qui rend le défaut facile à écarter :\n' + fautifs.join('\n'));
});

test('AUCUN CARACTERE DE CONTROLE C1 dans une source', () => {
  // U+0080–U+009F n'a aucun usage en texte. Sa présence signifie toujours qu'un octet de
  // continuation UTF-8 a été pris pour un caractère — le même défaut vu par l'autre bout, et ce
  // filet-là attrape les cas qu'aucune amorce n'aurait prévus. Il est invisible à la lecture :
  // rien ne s'affiche du tout.
  const fautifs = [];
  for(const f of TOUS){
    const ou = c1Dans(readFileSync(path.join(root, f), 'utf8'));
    if(ou) fautifs.push(`${f} : ${ou}`);
  }
  assert.deepEqual(fautifs, [], 'caractères de contrôle C1 :\n' + fautifs.join('\n'));
});

test('LES DEUX FILETS ENSEMBLE attrapent le vrai defaut, et epargnent le texte correct', () => {
  // Auto-contrôle. Ces contrôles ne s'exercent jamais sur un dépôt sain : sans lui, rien ne dit
  // qu'ils fonctionnent, et une dérivation cassée les rendrait muets pour toujours — la façon la
  // plus courante d'écrire une garde incapable d'échouer.
  //
  // On exige que CHAQUE mot cassé soit vu par au moins un des deux filets, pas par un fichiert
  // désigné : l'apostrophe typographique tombe dans le contrôle C1 quand le décodage est en
  // latin-1, et dans l'amorce quand il est en Windows-1252. Exiger le bad des deux ferait
  // échouer ce test sur un dispositif qui marche.
  const vu = (t) => !!(amorceDans(t) || c1Dans(t));
  const mots = ['éditeur', 'Éditeur 3D', 'la caméra', 'déjà', 'l’apostrophe', '« guillemets »',
                'à 22 kHz', 'atténuation'];

  mots.forEach((m) => {
    assert.ok(vu(malDecode(m)), `« ${m} » cassé n'est vu par aucun des deux filets`);
  });

  // Et le texte INTACT ne doit rien déclencher. Une garde qui accuse du français correct rendrait
  // ce fichier rouge en permanence, et un test rouge en permanence finit désactivé — ce qui coûte
  // plus cher que pas de test. Les deux derniers mots sont là exprès : ils portent les caractères
  // dont les amorces sont faites, dans leur usage légitime.
  mots.concat(['português', 'România', 'Ângela']).forEach((m) => {
    assert.ok(!vu(m), `« ${m} » est du texte correct et déclenche une garde`);
  });

  const bom = Buffer.from(String.fromCharCode(0xFEFF), 'utf8');
  assert.deepEqual([bom[0], bom[1], bom[2]], [0xEF, 0xBB, 0xBF], 'la détection de BOM est fausse');
});
