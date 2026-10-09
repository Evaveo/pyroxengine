import { deEsm } from './engine-env.mjs';
// Le miroir éditeur/runtime, vérifié sur les GARDES.
//
// Défaut qui a produit ce fichier : `js/game-runtime.js` appelait `stepWorld2d(...)` derrière un
// `if(typeof stepWorld2d === 'function')`, et la fonction ne vivait que dans un fichier de
// composant — jamais chargé par une page de jeu. Toute la physique 2D était donc absente d'un
// game exporté, et la garde faisait passer cette absence pour une désactivation normal : aucune
// error, aucune trace, un jeu où rien ne bouge.
//
// Une garde `typeof` est une promesse : « ce symbole peut légitimement ne pas être là ». Ce test
// vérifie la promesse. Si le symbole est déclaré quelque part dans js/, alors il DOIT être
// atteignable depuis les pages de jeu — sinon la garde ment.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { embeddedInBuild } from './build-modules.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => deEsm(readFileSync(path.join(root, rel), 'utf8'));

/** Les `js/xxx.js` chargés par une page, dans l'ordre. */
function scriptsDe(page){
  return [...read(page).matchAll(/<script[^>]*\ssrc="(?:\.\.\/)?(js\/[a-zA-Z0-9_\/-]+\.js)(?:\?v=\d+)?"/g)]
    .map((m) => m[1]);
}

/** Tous les fichiers de js/ (composants compris) et les symboles qu'ils déclarent au premier niveau. */
function declarationsParFichier(){
  const table = {};
  const explorer = (rel) => {
    for(const e of readdirSync(path.join(root, rel), {withFileTypes: true})){
      const sous = rel + '/' + e.name;
      if(e.isDirectory()){ explorer(sous); continue; }
      if(!e.name.endsWith('.js')) continue;
      const code = read(sous);
      const names = new Set();
      for(const m of code.matchAll(/^\s*function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) names.add(m[1]);
      for(const m of code.matchAll(/^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/gm)) names.add(m[1]);
      for(const m of code.matchAll(/^\s*class\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
      table[sous] = names;
    }
  };
  explorer('js');
  return table;
}

test('AUCUNE garde `typeof` du runtime ne masque un fichier absent des pages de jeu', () => {
  const source = read('js/game-runtime.js');
  // `typeof NOM === 'function'` et sa négation : les deux formes servent de garde.
  const gardes = new Set(
    [...source.matchAll(/typeof\s+([A-Za-z_$][\w$]*)\s*[!=]==\s*['"]function['"]/g)].map((m) => m[1])
  );
  assert.ok(gardes.size > 0, 'aucune garde trouvée — le motif de ce test a-t-il changé ?');

  const declare = declarationsParFichier();
  // Les pages qui font tourner un jeu. `build-test/index.html` est l'image du build publié, donc
  // vérifier les deux vérifie aussi ce que reçoivent les joueurs.
  const pages = ['game-preview.html', 'build-test/index.html'];
  const charges = {};
  for(const p of pages) charges[p] = new Set(scriptsDe(p));

  const manques = [];
  for(const name of gardes){
    // Où ce symbole est-il déclaré ? S'il ne l'est nulle part dans js/, c'est une API du
    // navigateur ou d'un vendor : la garde est légitime et on n'a rien à dire.
    const files = Object.keys(declare).filter((f) => declare[f].has(name));
    if(!files.length) continue;
    for(const p of pages){
      if(files.some((f) => charges[p].has(f))) continue;
      manques.push(name + ' → déclaré dans ' + files.join(', ') + ', absent de ' + p);
    }
  }
  assert.deepEqual(manques, [],
    'Ces symboles sont appelés par le runtime derrière une garde `typeof`, mais le fichier qui les\n'
    + 'déclare n\'est chargé par aucune page de jeu. La garde transforme donc une absence en\n'
    + 'désactivation silencieuse : la fonctionnalité ne marche pas dans un jeu exporté, sans erreur.\n'
    + 'Soit le fichier devient partagé et rejoint les pages de jeu, soit le runtime en tient son\n'
    + 'propre miroir (patron rt*, voir rtLayers2d).\n'
    + manques.join('\n'));
});

test('les modules PARTAGES sont chargés par TOUTES les pages qui en dependent', () => {
  // Le miroir se tient à quatre : l'éditeur, l'aperçu, le harnais de build, et l'exportateur.
  // Trois sur quatre est le cas le plus coûteux — ça marche partout où on regarde, et ça casse
  // seulement chez le joueur.
  //
  // ⚠ Cette liste est ÉCRITE À LA MAIN, et c'est sa faiblesse : `js/shadow-fit.js` n'y avait
  // jamais été ajouté, donc son absence du build n'était refusée par personne (voir
  // docs/REVUE_2026-09-10.md § 1.1). Le filet qui ne dépend plus d'une liste est
  // `runtime-partage.test.mjs` — « ET RECIPROQUEMENT », dérivé des pages elles-mêmes. Celle-ci
  // reste utile pour les quatre pages d'un coup ; toute addition de module partagé s'y écrit.
  const shared = ['js/animator.js', 'js/sprite-2d.js', 'js/physics-2d.js', 'js/world-2d.js', 'js/anim-sprite.js', 'js/tilemap.js', 'js/camera-framing.js', 'js/audio-falloff.js', 'js/audio-bus.js', 'js/chip-synth.js', 'js/music-loop.js', 'js/track-sampling.js',
                    'js/anim-blend.js', 'js/anim-markers.js', 'js/retargeting.js',
                    'js/anim-asset.js', 'js/lightmap-rgbm.js', 'js/shader-graph.js',
                    'js/asset-compression.js', 'js/shadow-fit.js',
                    'js/lightmap-atlas.js', 'js/script-scope.js', 'js/dev-guards.js',
                    'js/load-retry.js'];
  const editeur = new Set(scriptsDe('editor.html'));
  const preview  = new Set(scriptsDe('game-preview.html'));
  const harnais = new Set(scriptsDe('build-test/index.html'));
  const build   = read('js/build.js');
  const trimming = read('js/build-trimming.js');

  const manques = [];
  for(const m of shared){
    const base = m.slice(3);                                   // « js/x.js » → « x.js »
    if(!editeur.has(m))  manques.push(m + ' absent de editor.html');
    if(!preview.has(m))   manques.push(m + ' absent de jeu-preview.html');
    if(!harnais.has(m))  manques.push(m + ' absent de build-test/index.html');
    // Dans l'exportateur il faut les DEUX : la balise dans la page produite, et le fichier dans
    // le ZIP. N'avoir que la balise publie un jeu qui demande un fichier qui n'y est pas.
    //
    // La balise peut être ÉMISE SOUS CONDITION — `emb('x.js')` — depuis que le build allège les
    // jeux publiés de ce qu'ils n'utilisent pas. Dans ce cas le module doit être DÉCLARÉ facultatif
    // dans js/build-trimming.js : sans déclaration, `moduleEmbedded` ne le trouve pas, et il
    // serait retiré de TOUS les jeux, silencieusement. La condition remplace la balise en dur, elle
    // ne remplace pas la vérification.
    const enDur = build.includes('src="' + base + '"');
    const conditionnel = build.includes("emb('" + base + "')");
    if(!enDur && !conditionnel) manques.push(m + ' : aucune balise dans pageIndexBuild()');
    if(conditionnel && !trimming.includes("dans: '" + base + "'")){
      manques.push(m + ' : balise conditionnelle mais module non déclaré dans build-trimming.js');
    }
    if(!embeddedInBuild(m)) manques.push(m + ' : absent de la table des modules du ZIP');
  }
  assert.deepEqual(manques, [], manques.join('\n'));
});

test('un constructeur de maille RETIRE la precedente et pose ce que le fichierPath leger attend', () => {
  // Défaut mesuré dans un jeu exporté : `rtBuildMeshSprite` n'enlevait pas l'ancienne
  // maille et ne posait ni `_region` ni `_texSize`. Deux conséquences, et la seconde nourrit la
  // première : sans ces champs, `sameGeometrySprite(undefined, region)` rend faux à CHAQUE
  // image, donc le chemin léger n'est jamais pris, donc on reconstruit douze fois par seconde —
  // et comme rien n'enlève la précédente, les mailles s'empilent par centaines. Le personnage
  // avait l'air d'afficher toutes ses images à la fois, et on cherchait du côté des coordonnées
  // de texture, qui étaient justes.
  //
  // Le miroir éditeur, lui, faisait les trois. C'est donc une INCOMPLÉTUDE de miroir, pas une
  // erreur de calcul — et c'est exactement ce que ce fichier surveille.
  // Le SPRITE n'a plus de miroir non plus (v0.159.2) : le runtime importe et exécute
  // `rebuildMeshSprite`. Le constructeur surveillé est donc le seul qui existe, et le miroir ne
  // doit pas revenir.
  const paires = [
    {quoi: 'sprite',  editeur: ['js/components/component-sprite.js',  'function rebuildMeshSprite'],
                      runtime: ['js/components/component-sprite.js',  'function rebuildMeshSprite']},
  ];
  const rt = read('js/game-runtime.js');
  assert.ok(!/function rtBuildMeshSprite|function rtUpdateImageSprite|function rtUpdateAnimatorsSprite/.test(rt),
    'un miroir de sprite est revenu dans le runtime : il divergera, comme les deux fois precedentes');
  // Le fichier BRUT : `read` passe par `deEsm`, qui retire les `import` — le build, lui, les garde
  // (ce sont des modules ES, js/build.js).
  assert.match(readFileSync(path.join(root, 'js/game-runtime.js'), 'utf8'), /import \{[^}]*rebuildMeshSprite[^}]*\} from '\.\/components\/component-sprite\.js'/,
    'le runtime n importe plus le constructeur partage de sprite');
  // La TILEMAP n'a plus de miroir : le TilemapSystem construit les mailles pour les deux
  // moteurs. C'est le seul remède définitif à l'incomplétude de miroir que ce fichier surveille
  // — encore faut-il que le miroir ne revienne pas.

  // Le body d'une fonction, du `function` jusqu'à l'brace fermante en colonne 0.
  const corpsDe = ([file, header]) => {
    // LES FINS DE LIGNE SONT NORMALISÉES, et ce n'est pas un détail : les fichiers du dépôt sont
    // en CRLF, `indexOf('\n}\n')` n'y trouve donc rien, et le « body de fonction » découpé était
    // TOUT LE RESTE DU FICHIER. La garde passait alors sur n'importe quel sabotage — les trois
    // que j'ai essayés sont passés inaperçus. Une garde qu'on n'a pas vue échouer n'est pas une
    // garde, et celle-ci en était l'illustration.
    const src = read(file).replace(/\r\n/g, '\n');
    const i = src.indexOf(header);
    assert.notEqual(i, -1, header + ' introuvable dans ' + file);
    const end = src.indexOf('\n}\n', i);
    return src.slice(i, end === -1 ? src.length : end);
  };

  const manques = [];
  for(const p of paires){
    const r = corpsDe(p.runtime);
    // Retirer l'ancienne mesh : sans ça, chaque reconstruction en ajoute une de plus.
    if(!/\.remove\(/.test(r)) manques.push(p.quoi + ' runtime : ne retire pas la maille precedente');
    if(!/dispose\(\)/.test(r)) manques.push(p.quoi + ' runtime : ne libere pas geometrie/materiau');
  }
  // Et les deux champs dont dépend le chemin léger, que SEUL le sprite utilise.
  const rs = corpsDe(paires[0].runtime), es = corpsDe(paires[0].editeur);
  for(const field of ['_region', '_texSize']){
    if(rs.indexOf(field) === -1) manques.push('sprite runtime : ne pose pas ' + field);
    if(es.indexOf(field) === -1) manques.push('sprite editeur : ne pose pas ' + field);
  }
  assert.deepEqual(manques, [],
    'Un constructeur de maille doit RETIRER la precedente et poser ce dont le fichierPath leger a\n'
    + 'besoin. Sans le retrait, les mailles s empilent ; sans les champs, le fichierPath leger n est\n'
    + 'jamais pris et on reconstruit a chaque image — ce qui provoque l empilement.\n'
    + manques.join('\n'));
});
