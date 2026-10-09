// LES NOMS D'API DU NAVIGATEUR NE SE RENOMMENT PAS.
//
// POURQUOI CE TEST EXISTE. `js/ui.js` a vécu avec `new ResizeObserve(...)` — le `r` final
// mangé par une passe de renommage automatique. Le code étant gardé par `typeof`, il n'y a
// eu AUCUNE erreur : l'observateur de taille de la vue 3D ne tournait tout simplement plus,
// et le canvas ne se redimensionnait que sur `window.resize`. Une panne silencieuse est
// pire qu'un plantage : rien ne la signale.
//
// La garde ne cherche pas « le bon nom » (il peut être absent, c'est légitime) : elle
// cherche les VARIANTES TRONQUÉES d'un nom d'API connu, qui ne peuvent être qu'un accident.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Nom réel de l'API -> variantes qu'une passe de renommage peut produire.
const APIS = {
  ResizeObserver: ['ResizeObserve', 'ResizeObservateur', 'RedimensionnementObserver'],
  MutationObserver: ['MutationObserve', 'MutationObservateur'],
  IntersectionObserver: ['IntersectionObserve', 'IntersectionObservateur'],
  PerformanceObserver: ['PerformanceObserve', 'PerformanceObservateur'],
  requestAnimationFrame: ['requestAnimationImage', 'demanderAnimationFrame'],
  getBoundingClientRect: ['getBoundingClientRectangle', 'obtenirBoundingClientRect'],
  setPointerCapture: ['setPointerCapturer', 'poserPointerCapture'],
  createObjectURL: ['createObjetURL', 'creerObjectURL'],
  DataTransfer: ['DataTransfert', 'DonneesTransfer'],
  localStorage: ['localStockage', 'stockageLocal']
};

function filesJs(){
  const dir = path.join(root, 'js');
  const out = [];
  (function walk(d){
    for(const e of fs.readdirSync(d, { withFileTypes: true })){
      const p = path.join(d, e.name);
      if(e.isDirectory()) walk(p);
      else if(e.name.endsWith('.js') || e.name.endsWith('.mjs')) out.push(p);
    }
  })(dir);
  return out;
}

test('aucun nom d\'API du navigateur n\'apparaît sous une variante tronquée', () => {
  const faults = [];
  for(const file of filesJs()){
    const src = fs.readFileSync(file, 'utf8');
    for(const [real, variants] of Object.entries(APIS)){
      for(const bad of variants){
        // Frontière de mot des deux côtés : `ResizeObserve` ne doit pas matcher
        // `ResizeObserver`, sinon la garde crie sur le nom correct.
        const rx = new RegExp('\\b' + bad + '\\b', 'g');
        let m;
        while((m = rx.exec(src)) !== null){
          const line = src.slice(0, m.index).split(String.fromCharCode(10)).length;
          faults.push(path.relative(root, file) + ':' + line + ' — « ' + bad + ' » au lieu de « ' + real + ' »');
        }
      }
    }
  }
  assert.deepEqual(faults, [], 'noms d\'API tronqués :' + String.fromCharCode(10) + faults.join(String.fromCharCode(10)));
});
