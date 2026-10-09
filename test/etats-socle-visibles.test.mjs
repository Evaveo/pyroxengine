// LES ÉTATS QUE LE SOCLE PRODUIT DOIVENT SE VOIR.
//
// Depuis le lot 1a, un champ divergent porte `mixed`, une saisie illisible porte `invalid`, et
// une case en multi-sélection est `indeterminate`. Aucun des trois n'avait de style : la
// fonctionnalité existait et l'utilisateur n'en avait aucun retour — c'est-à-dire que la moitié
// de la valeur de la multi-sélection manquait, et qu'une saisie refusée était un silence.
//
// Ce test ne peut pas juger l'apparence (pas de moteur de rendu ici). Il mesure ce qui est
// mesurable : la classe est posée par le code, et une règle CSS la vise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { creerContexte } from './engine-env.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const panels = fs.readFileSync(path.join(root, 'css', 'panels.css'), 'utf8');

test('les trois etats ont une regle CSS qui les vise', () => {
  ['.mixed', '.invalid', ':indeterminate', ':focus-visible'].forEach(function(sel){
    assert.ok(panels.indexOf(sel) !== -1, 'aucune regle pour ' + sel);
  });
});

test('un champ divergent ne se confond pas avec un champ VIDE', () => {
  // « je ne sais pas » et « il n'y a rien » n'ont pas le même effet à l'écriture : les
  // distinguer à l'œil n'est pas cosmétique.
  const regle = panels.slice(panels.indexOf('.mixed{'), panels.indexOf('.mixed{') + 120);
  assert.match(regle, /border-style:\s*dashed/);
});

// ---------- Ce que le code pose réellement ----------

function form(champ, cibles){
  const env = creerContexte(['js/ui/registry.js', 'js/ui/form-plan.js', 'js/ui/fields.js',
                             'js/ui/form.js', 'js/history.js']);
  const hote = env.document.createElement('div');
  const f = env.createForm(hote, { id: 'p', sections: [{ id: 's', fields: [champ] }] });
  f.setTargets(cibles);
  return { env: env, hote: hote, form: f };
}

const CHAMP_NOMBRE = { ids: ['f-x'], label: 'X', type: 'number', key: 'x' };

test('une saisie illisible allume invalide ET DIT pourquoi', () => {
  const r = form(CHAMP_NOMBRE, [{ x: 1 }]);
  const el = r.env.document.getElementById('f-x');
  el.value = '1.2e';
  el.dispatchEvent({ type: 'input', target: el });
  assert.ok(el.classList.contains('invalid'));
  assert.ok(el.getAttribute('title'), 'une bordure rouge sans explication laisse chercher');
});

test('une saisie redevenue lisible eteint l etat, titre compris', () => {
  const r = form(CHAMP_NOMBRE, [{ x: 1 }]);
  const el = r.env.document.getElementById('f-x');
  el.value = '1.2e';
  el.dispatchEvent({ type: 'input', target: el });
  el.value = '2';
  el.dispatchEvent({ type: 'input', target: el });
  assert.equal(el.classList.contains('invalid'), false);
  assert.equal(el.getAttribute('title'), null, 'un titre perime explique un etat disparu');
});

test('une case a cocher en multi-selection est INDETERMINEE', () => {
  const champ = { ids: ['f-b'], label: 'B', type: 'checkbox', key: 'b' };
  const r = form(champ, [{ b: true }, { b: false }]);
  const el = r.env.document.getElementById('f-b');
  assert.equal(el.indeterminate, true, 'ni cochee ni decochee : les deux cibles divergent');
  assert.ok(el.classList.contains('mixed'));
});
