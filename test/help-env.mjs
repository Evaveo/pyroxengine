// L'aide est répartie sur plusieurs fichiers (js/help-content.js + js/help/*.js). Les tests
// la chargent dans un contexte node:vm, où l'ORDRE compte : une partie doit être déclarée
// avant que help-content.js ne les concatène. Cette liste est l'unique endroit qui le dit.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export const HELP_PARTS = ['js/help/help-format.js'].concat(
  readdirSync(path.join(root, 'js/help')).filter((f) => /^pages-.*\.js$/.test(f)).sort()
    .map((f) => 'js/help/' + f));

export const HELP_SCRIPTS = ['js/material-props.js'].concat(HELP_PARTS,
  ['js/help-content.js', 'js/help-page.js']);

// Le SOURCE de toute l'aide, pour les tests qui y cherchent du texte.
export function readHelpSource(){
  return ['js/help-content.js'].concat(HELP_PARTS)
    .map((f) => readFileSync(path.join(root, f), 'utf8')).join('\n');
}
