// UN CHAMP QU'ON RELIT PAR UN ID QU'ON NE CONSTRUIT PAS EST UN CHAMP MORT.
//
// POURQUOI CE TEST EXISTE. inspector.js construisait `f-env-ciel`, `f-env-cielc` et
// `f-env-haut`, et les relisait sous les noms `f-env-sky`, `f-env-skyc` et `f-env-top` — trois
// ids à moitié traduits par une passe de renommage. `getElementById` rendait `null`, le code
// est gardé (`if(c)`), donc AUCUNE erreur : le type de ciel, sa couleur et le haut du dégradé
// ne s'enregistraient simplement plus. Même famille que ResizeObserve (v0.91.4, KNOWN_ISSUES).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Les fichiers qui RELISENT des champs par leur identifiant. Le côté CONSTRUCTION, lui, est
// cherché dans tout `js/` : un champ peut légitimement être bâti ailleurs — les sondes par
// probes.js, le graphe d'animateur par son propre fichier, un champ migré par un descripteur
// de js/ui/panels-*.js. Ce qui est interdit, c'est qu'il ne soit bâti NULLE PART.
const READERS = ['js/inspector.js', 'js/postfx.js', 'js/subscenes.js', 'js/component-views.js'];

/** Tous les fichiers de js/, récursivement. */
function filesJs(dir){
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true })
    .flatMap((e) => e.isDirectory() ? filesJs(dir + '/' + e.name)
                  : (e.name.endsWith('.js') ? [dir + '/' + e.name] : []));
}


function idsBuilt(src){
  const out = new Set();
  for(const m of src.matchAll(/id="(f-[a-z0-9-]+)"/g)) out.add(m[1]);
  // Les cinq fabriques `fieldXxx()` construisaient aussi des ids ; elles ont disparu au lot 4,
  // et avec elles la dernière interface fabriquée à la chaîne de caractères. Tout ce qui
  // construit un id passe maintenant par `ids:` d'un descripteur, juste en dessous.
  // Un descripteur du socle : `ids: ['f-px', 'f-py', 'f-pz']`.
  for(const m of src.matchAll(/ids:\s*\[([^\]]*)\]/g)){
    for(const id of m[1].matchAll(/'(f-[a-z0-9-]+)'/g)) out.add(id[1]);
  }
  return out;
}
function idsRead(src){
  const out = new Set();
  // TOUT littéral `'f-…'` compte comme une référence, pas seulement `getElementById('f-…')`.
  // La première version de cette garde ne regardait que les appels directs : elle a laissé
  // passer `setFieldAs('f-as-speed', …)` (un helper local) et `['f-lcolor', 'f-portee', …]`
  // (une liste de routage). Deux champs morts de plus, trouvés seulement à la migration.
  for(const m of src.matchAll(/'(f-[a-z0-9-]+)'/g)) out.add(m[1]);
  for(const m of src.matchAll(/setVal\('([a-z0-9-]+)'/g)) out.add('f-' + m[1]);
  for(const m of src.matchAll(/readF\('([a-z0-9-]+)'/g)) out.add('f-' + m[1]);
  return out;
}

test('tout id relu par un fichier est un id que quelqu un construit', () => {
  const construits = new Set();
  filesJs('js').forEach((f) => idsBuilt(fs.readFileSync(path.join(root, f), 'utf8'))
    .forEach((id) => construits.add(id)));

  const morts = [];
  READERS.forEach((f) => {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    idsRead(src).forEach((id) => {
      if(construits.has(id)) return;
      // Un id qui se TERMINE par `-` est un préfixe assemblé à l'exécution
      // (`'f-comp-values-' + i`) : il n'est jamais construit tel quel.
      if(id.endsWith('-')) return;
      morts.push(f + ' relit « ' + id + ' », que personne ne construit');
    });
  });
  assert.deepEqual(morts, [], 'champs morts :' + String.fromCharCode(10) + morts.join(String.fromCharCode(10)));
});
