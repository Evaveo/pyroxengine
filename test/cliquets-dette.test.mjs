// Lot G de la revue du 2026-09-29 (docs/REVUE_2026-09-29.md, § 6) : la dette ne doit plus
// pouvoir CROÎTRE en silence. Chaque mesure a pour plafond sa valeur du jour où ce fichier a été
// écrit ; elle ne peut plus que baisser. Quand un chantier la fait baisser, on abaisse le plafond
// dans le même commit — c'est ce qui fait de chaque gain un acquis.
//
// Relever un plafond est un choix, pas une formalité : le commit doit dire pourquoi.
// `CLIQUETS_MESURE=1 node --test test/cliquets-dette.test.mjs` affiche les valeurs actuelles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { segmenter } from '../outils/renommage.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const jsDir = path.join(root, 'js');

function jsFiles(dir) {
  const out = [];
  (function walk(d) {
    readdirSync(d).forEach((e) => {
      const p = path.join(d, e);
      // js/help/ est du TEXTE (le manuel) : ses exemples de scripts citent l'api, ce n'est pas du
      // code du moteur — les compter ferait monter la dette à chaque exemple ajouté.
      if (statSync(p).isDirectory()) { if (e !== 'vendor' && e !== 'help') walk(p); return; }
      if (e.endsWith('.js')) out.push(p);
    });
  })(dir);
  return out;
}
const files = jsFiles(jsDir);
const rel = (f) => path.relative(root, f).replace(/\\/g, '/');
const sources = new Map(files.map((f) => [rel(f), readFileSync(f, 'utf8')]));
const count = (re) => [...sources.values()].reduce((n, s) => n + (s.match(re) || []).length, 0);
const lines = (f) => sources.get(f).split('\n').length;
const codeOnly = (s) => segmenter(s).filter((x) => x.type === 'code').map((x) => x.texte).join('');

/** Le plus grand cycle d'imports : la taille de la plus grande composante fortement connexe. */
function largestImportCycle() {
  const graph = new Map();
  for (const [f, s] of sources) {
    const deps = [];
    for (const m of s.matchAll(/^\s*(?:import|export)\b[^'";]*?(?:from\s*)?['"](\.[^'"]+)['"]/gm)) {
      deps.push(path.posix.normalize(path.posix.join(path.posix.dirname(f), m[1])));
    }
    graph.set(f, deps.filter((d) => sources.has(d)));
  }
  // Tarjan, itératif pour ne pas dépendre de la profondeur de pile.
  let index = 0, best = 0;
  const idx = new Map(), low = new Map(), onStack = new Set(), stack = [];
  for (const start of graph.keys()) {
    if (idx.has(start)) continue;
    const work = [[start, 0]];
    idx.set(start, index); low.set(start, index); index++; stack.push(start); onStack.add(start);
    while (work.length) {
      const top = work[work.length - 1];
      const [v, i] = top;
      const deps = graph.get(v);
      if (i < deps.length) {
        top[1]++;
        const w = deps[i];
        if (!idx.has(w)) {
          idx.set(w, index); low.set(w, index); index++; stack.push(w); onStack.add(w);
          work.push([w, 0]);
        } else if (onStack.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)));
      } else {
        work.pop();
        if (work.length) { const p = work[work.length - 1][0]; low.set(p, Math.min(low.get(p), low.get(v))); }
        if (low.get(v) === idx.get(v)) {
          let size = 0, w;
          do { w = stack.pop(); onStack.delete(w); size++; } while (w !== v);
          best = Math.max(best, size);
        }
      }
    }
  }
  return best;
}

/** Noms de la section `identifiants` du glossaire revenus dans le CODE (hors chaînes et commentaires). */
function glossaryIdentifiersBack() {
  const g = JSON.parse(readFileSync(path.join(root, 'outils', 'glossaire.json'), 'utf8'));
  const table = g.identifiants || {};
  // Les MOTS RÉSERVÉS de JavaScript ne sont pas des identifiants : l'entrée « new → fresh » du
  // glossaire (une propriété `.new` renommée) faisait compter le mot-clé `new` de chaque fichier
  // comme un nom français revenu — tout fichier neuf qui construisait un objet montait la dette.
  const RESERVED = new Set(['new', 'delete', 'in', 'of', 'for', 'if', 'do', 'var', 'let', 'const',
    'function', 'return', 'this', 'class', 'default', 'case', 'switch', 'typeof', 'void', 'with',
    // Même piège avec `await` (v0.188.0) : chaque fichier neuf écrit en async montait la dette.
    'await', 'async', 'yield']);
  const names = Object.keys(table).filter((n) => n[0] !== '_' && n !== table[n] && !RESERVED.has(n));
  let n = 0;
  for (const s of sources.values()) {
    const code = codeOnly(s);
    const words = new Set(code.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) || []);
    for (const name of names) if (words.has(name)) n++;
  }
  return n;
}

const MEASURES = {
  'lignes de game-runtime.js': () => lines('js/game-runtime.js'),
  'lignes de import-settings.js': () => lines('js/import-settings.js'),
  '.traverse(': () => count(/\.traverse\(/g),
  "typeof X !== 'undefined'": () => count(/typeof [A-Za-z_$][\w$.]* !== 'undefined'/g),
  'userData.type ===': () => count(/userData\.type ===/g),
  'mentions « miroir »': () => count(/miroir/gi),
  "modules dans le plus grand cycle d'imports": largestImportCycle,
  'identifiants du glossaire revenus (fichier × nom)': glossaryIdentifiersBack
};

// Plafonds mesurés le 2026-09-29, après les lots A à G. Le total de lignes de moteur/js, suivi
// par la revue, n'a PAS de cliquet : une fonctionnalité nouvelle le fait monter, et c'est normal.
// Ce qui ne doit pas monter, c'est la taille des deux fichiers déjà trop gros.
const CEILINGS = {
  // +4 le 2026-09-29 : api.lib (import + entrée d'api) et les caméras en incrustation (import +
  // un appel après le rendu) — les deux DOIVENT exister dans le jeu publié.
  'lignes de game-runtime.js': 5009, // v1.13.0 : +10 pour les objets Statiques (import, relecture de `static`, appel de buildStaticScene/undoStaticScene, gardes staticBlocked de setPosition/lookAt/moveTo/patrol, plages fusionnées à setActive et à la destruction) — la logique vit dans js/static-batching.js. v1.11.x : +99 pour le chargement parallèle borné des assets (rtRunPool, rtSerialModel — parse des modèles sérialisé à cause du registre global shareBlobs, ordre du fichier gardé par put/later), la libération des clones de textures et géométries de scène (rtProtectedResources) et la précompilation des shaders (rtWarmShaders) ; surtout des commentaires de sûreté. Boucle d'image : +22 pour les commentaires et gardes des caches (boîtes des événements, système de particules par WeakMap, vues secondaires sans passe de matrices, caméra à jour avant les ombres, physique à dtGame) — la cible d'Animator vit dans js/runtime-caches.js. v1.10.5 : +7 pour la lightmap portée par le maillage (rtApplyLightmap extrait, applyLightmapOverrides — la logique vit dans js/lightmap-atlas.js). v1.10.4 : +36 pour les caches de la boucle d'image (ombres, scripts, minuteries) — la logique vit dans js/runtime-caches.js, seuls l'appel et les commentaires sont ici. -21 avec le ciel HDRI : le fond de ciel du jeu vient de js/environment-map.js (skyBackgroundFor), partagé avec l'éditeur, au lieu d'une copie. v1.5.0 : +3 pour la résolution adaptative (import + réglage ; la logique vit dans js/render-scale.js). v1.3.0 : +1 pour api.richText (texte riche, la logique vit dans js/game-ui.js). v0.194.0 : +2 pour api.steam et l'import de js/steam-bridge.js (succès, statistiques, sauvegardes cloud — la logique vit dans ce module partagé, seuls l'import et l'entrée d'api sont ici). v0.193.0 : le ciel suit le type de caméra (2D = image plein écran, js/sky-camera.js) — la règle est partagée, seuls l'appel et l'import vivent ici
  'lignes de import-settings.js': 3675, // v1.21.0 : +2, l'inspecteur de l'asset particules (son formulaire vit dans js/ui/panels-particles.js) ; v0.196.0 : -24
  '.traverse(': 105, // v1.13.0 : +7, les objets Statiques (js/static-batching.js : sous-maillages d'un modèle statique, enfants d'un parent fusionnable, sous-arbre gelé, plages à masquer, appliquer aux enfants ; ui/panels-inspector.js : bouton « Appliquer aux enfants ») — au chargement de scène ou au geste, jamais par image. v1.11.x : +1, rtProtectedResources parcourt les gabarits de modèles/prefabs pour ne jamais libérer ce qu'ils partagent. v1.10.5 : +1, applyLightmapOverrides (lightmap des emplacements au matériau du fichier). icônes d'édition : -1, les deux parcours de createHelperFor fondus en un
  "typeof X !== 'undefined'": 195,
  'userData.type ===': 30, // icônes d'édition : -7, isIconEdit lit une table (ICON_EDIT_TYPES, viewport.js)
  'mentions « miroir »': 152,
  "modules dans le plus grand cycle d'imports": 71,
  // 287 → 151 le 2026-09-29 : les mots réservés JS (le « new » de chaque fichier) ne comptent plus.
  'identifiants du glossaire revenus (fichier × nom)': 151
};

if (process.env.CLIQUETS_MESURE) {
  for (const [k, f] of Object.entries(MEASURES)) console.log(JSON.stringify(k) + ': ' + f() + ',');
}

for (const [name, measure] of Object.entries(MEASURES)) {
  test('cliquet — ' + name + ' ne dépasse pas ' + CEILINGS[name], () => {
    const v = measure();
    assert.ok(v > 0, 'mesure nulle : le cliquet ne mesure plus rien (fichier déplacé ?)');
    assert.ok(v <= CEILINGS[name], name + ' : ' + v + ' pour un plafond de ' + CEILINGS[name]
      + ". La dette a crû — réduire, ou relever le plafond en disant pourquoi dans le commit.");
  });
}
