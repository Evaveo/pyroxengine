// moteur/outils/lancer-tests.mjs
//
// LANCER UN DOMAINE DE TESTS, ET DIRE OÙ ÇA CASSE.
//
// Deux manques que ce script comble, tous deux vécus en CI :
//   · la suite tournait d'un bloc — un rouge disait « le moteur est cassé », pas « le rendu est
//     cassé ». Ici on prend un domaine de test/groupes.mjs en argument, et la matrice du
//     workflow donne un job nommé par domaine.
//   · même le journal déroulé, il fallait chercher : aucun résumé. On écrit donc, quand GitHub
//     nous en donne le chemin, un tableau dans $GITHUB_STEP_SUMMARY — visible sans ouvrir le
//     journal, avec le nom des tests tombés.
//
// Sans argument : tous les domaines, à la suite. C'est ce que fait `npm test` en local, et
// c'est strictement l'ancienne suite — la garde de groupes-couverture.test.mjs l'assure.
import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GROUPS, groupFiles } from '../test/groupes.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const asked = process.argv[2];

if(asked && !GROUPS[asked]){
  console.error('domaine inconnu : ' + asked + '\ndomaines : ' + Object.keys(GROUPS).join(', '));
  process.exit(2);
}

const domains = asked ? [asked] : Object.keys(GROUPS);
let worst = 0;

for(const domain of domains){
  // Le TAP part dans un fichier pour être relu ensuite ; le spec reste à l'écran, lisible.
  const tap = path.join(tmpdir(), 'moteur-tests-' + domain + '-' + process.pid + '.tap');
  const run = spawnSync(process.execPath, [
    '--test',
    '--test-reporter=spec', '--test-reporter-destination=stdout',
    '--test-reporter=tap', '--test-reporter-destination=' + tap,
    ...groupFiles(domain)
  ], { cwd: root, stdio: 'inherit' });

  const code = run.status === null ? 1 : run.status;
  if(code > worst) worst = code;
  summarize(domain, code, tap);
  try { rmSync(tap, { force: true }); } catch { /* le résumé est un confort, pas une garantie */ }
}

process.exit(worst);

/** Une ligne de tableau dans le résumé GitHub, et la liste des tests tombés. */
function summarize(domain, code, tap){
  const dest = process.env.GITHUB_STEP_SUMMARY;
  if(!dest) return;
  let text = '';
  try { text = readFileSync(tap, 'utf8'); } catch { /* le run a pu mourir avant d'écrire */ }

  const count = (re) => { const m = text.match(re); return m ? m[1] : '?'; };
  const pass = count(/^# pass (\d+)$/m);
  const fail = count(/^# fail (\d+)$/m);
  // Les échecs de premier niveau : « not ok 12 - nom du test ».
  const fallen = (text.match(/^not ok \d+ - .*$/gm) || [])
    .map((l) => l.replace(/^not ok \d+ - /, '').trim());

  const lines = [];
  lines.push('### ' + (code === 0 ? '✅' : '❌') + ' ' + domain);
  lines.push('');
  lines.push('| réussis | échoués |');
  lines.push('| --- | --- |');
  lines.push('| ' + pass + ' | ' + fail + ' |');
  if(fallen.length){
    lines.push('');
    lines.push('<details><summary>Tests tombés</summary>');
    lines.push('');
    fallen.slice(0, 50).forEach((n) => lines.push('- `' + n + '`'));
    if(fallen.length > 50) lines.push('- … et ' + (fallen.length - 50) + ' autres');
    lines.push('');
    lines.push('</details>');
  }
  lines.push('');
  try { appendFileSync(dest, lines.join('\n') + '\n'); } catch { /* idem */ }
}
