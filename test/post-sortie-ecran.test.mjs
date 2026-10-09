import { deEsm } from './engine-env.mjs';
// LA CHAINE DE POST-TRAITEMENT DOIT RENDRE UNE IMAGE AFFICHABLE, ET DANS LE BON SENS.
//
// Elle est livree ETEINTE par defaut, et le harnais node:vm ne sait pas simuler un rendu WebGPU :
// personne ne l avait jamais vue tourner. La premiere fois qu on l a allumee, elle produisait une
// image RETOURNEE VERTICALEMENT et beaucoup trop sombre.
//
//   • retournee — une inversion du V etait appliquee en lisant la cible de scene, alors que tout
//     le reste de la chaine lit ses targets sans inversion. C etait l exception, et c est elle qui
//     retournait l image.
//
//   • la conversion sRGB en sortie de composition : ce test EXIGEAIT autrefois un pow(1/2,2)
//     manuel, mesure a l epoque du pipeline GLSL/WebGL (image quasi noire sans lui). Sous
//     WebGPURenderer, la passe finale est rendue A L ECRAN et recoit deja la conversion du
//     renderer (outputColorSpace = sRGB par defaut) : le pow manuel devenait une SECONDE
//     conversion, d ou l image laiteuse et blanchie des qu un effet etait actif. L exigence est
//     donc INVERSEE — plus aucune conversion manuelle dans la composition. Si l image
//     redevenait trop sombre, c est ici qu il faut revenir, avec une nouvelle mesure a l ecran.
//
// Ce test ne rend rien : il verifie que les DEUX moteurs disent la meme chose. Le rendu, lui, se
// regarde a l ecran — c est ecrit dans la spec du 2026-08-06 et ca reste vrai.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LF = String.fromCharCode(10);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => deEsm(readFileSync(path.join(root, f), 'utf8')).split(String.fromCharCode(13)).join('');
const sansCommentaires = (s) => s.split(LF)
  .map((l) => { const i = l.indexOf('//'); return i === -1 ? l : l.slice(0, i); }).join(LF);

const MOTEURS = [
  {name: 'éditeur',    file: 'js/postfx.js',    composite: 'function createMaterialComposite('},
  {name: 'game publié', file: 'js/game-runtime.js', composite: 'function rtCreateMaterialComposite('}
];

function corpsDe(src, header, quoi){
  const i = src.indexOf(header);
  assert.notEqual(i, -1, quoi + ' : ' + header + ' a disparu');
  const end = src.indexOf(LF + 'function ', i + 10);
  return src.slice(i, end === -1 ? src.length : end);
}

MOTEURS.forEach((m) => {
  test(m.name + ' : la composition ne convertit PAS en sRGB (le renderer le fait)', () => {
    const body = corpsDe(sansCommentaires(read(m.file)), m.composite, m.name);
    assert.equal(body.indexOf('.pow(1 / 2.2)'), -1,
      m.name + ' : conversion sRGB manuelle en sortie de composition — la passe finale est '
      + 'rendue a l ecran et recoit deja celle du renderer : deux conversions donnent une '
      + 'image laiteuse et blanchie, sans la moindre erreur');
  });

  test(m.name + ' : plus aucune inversion du V dans la chaîne', () => {
    const src = sansCommentaires(read(m.file));
    // le nom de la fonction ne suffit pas : c est son EMPLOI qu on interdit
    // on count l appel au helper ET l inversion recopiee a la main : supprimer la fonction
    // ne protege de rien si le prochain ecrit `float(1).sub(u.y)` directement.
    const emplois = (src.split('Inversee(TSL)').length - 1)
                  + (src.split('float(1).sub(u.y)').length - 1)
                  + (src.split('sub(uv().y)').length - 1);
    assert.equal(emplois, 0,
      m.name + ' : ' + emplois + ' playback(s) de cible avec inversion du V — c est ce qui '
      + 'retournait l image de haut en bas');
  });
});

test('les deux moteurs composent EXACTEMENT la même image', () => {
  // Un correctif applique d un seul cote est le pire cas : l editeur et le jeu publie ne
  // montrent plus la meme chose, et l on regle la couleur sur un rendu qui n est pas celui
  // qui sera publie.
  const norm = (s) => sansCommentaires(s)
    .split('rtCreerMateriel').join('creerMateriel')
    .split('rtUvSceneInversee').join('uvSceneInversee')
    .split('rtPost').join('postprod')
    .split(LF).map((l) => l.trim()).filter(Boolean).join(LF);
  const a = norm(corpsDe(read('js/postfx.js'), 'function createMaterialComposite(', 'éditeur'));
  const b = norm(corpsDe(read('js/game-runtime.js'), 'function rtCreateMaterialComposite(', 'runtime'));
  // on compare la FORMULE, pas la mise en page : les lignes de calcul de couleur
  const formule = (s) => s.split(LF).filter((l) => /^(c|const c[A-Z]|const [rbln]) /.test(l)
    || l.startsWith('c =') || l.startsWith('const c')).join(LF);
  assert.equal(formule(b), formule(a),
    'la formule de composition a divergé entre les deux moteurs — ce qui se règle dans '
    + 'l éditeur ne sera pas ce qui se publie');
});
