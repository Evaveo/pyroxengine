import { HELP_SCRIPTS, readHelpSource } from './help-env.mjs';
import { deEsm } from './engine-env.mjs';
// LE SENS QUE test/aide.test.mjs NE VÉRIFIE PAS : ce que l'aide OUBLIE.
//
// Ce fichier-là vérifie que l'aide n'invente rien — chaque ancre, chaque nom d'api, chaque
// raccourci cité existe dans le code. C'est la moitié du problème, et c'est la moitié la
// moins coûteuse : une aide qui invente se fait attraper dès qu'on essaie ce qu'elle décrit.
//
// Une aide qui OUBLIE ne se fait jamais attraper. La fonctionnalité existe, marche, et
// personne ne la trouve — le seul symptôme est une question qu'on ne posera pas. C'est
// exactement ce qui s'est produit : trois composants du monde 2D n'étaient nommés nulle
// part, alors que l'aide décrivait leur fonction en toutes lettres. On lisait « posez une
// caméra 2D », on ouvrait « + Component », et on cherchait un mot qui n'y était pas.
//
// LA COUVERTURE N'EST PAS UNE MÉTRIQUE ICI. On n'exige pas un paragraphe par symbole — ce
// serait une aide illisible, et le dépôt refuse justement d'écrire ce qui se lit sur les
// buttons. On exige que tout nom que l'INTERFACE shown apparaisse au moins une fois dans
// l'aide, parce que c'est le mot avec lequel le lecteur va chercher.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');

// ---------- Le texte rendu de l'aide ----------
function texteAide(){
  const faireElement = () => ({value:'', innerHTML:'', dataset:{}, addEventListener(){},
                               closest(){ return null; }, querySelectorAll(){ return []; }});
  const byId = new Map();
  const bac = {console, Math, JSON, Object, Array, Map, Set, String, Number, RegExp, Error,
               decodeURIComponent, location:{hash:''}, addEventListener(){}, scrollTo(){},
               document:{
                 getElementById(id){ if(!byId.has(id)) byId.set(id, faireElement()); return byId.get(id); },
                 createElement(){ const el = faireElement();
                   Object.defineProperty(el, 'textContent',
                     {get(){ return String(el.innerHTML).replace(/<[^>]*>/g, ' '); }});
                   return el; },
                 addEventListener(){}, title:''
               }};
  bac.window = bac; bac.globalThis = bac;
  const ctx = vm.createContext(bac);
  HELP_SCRIPTS
    .forEach((f) => vm.runInContext(deEsm(read(f)), ctx, {filename: f}));
  vm.runInContext('this.PAGES_HELP = PAGES_HELP; this.API_HELP = API_HELP; this.GLOSSARY_HELP = GLOSSARY_HELP;', ctx);
  const pages = Array.from(bac.PAGES_HELP);
  // LE TABLEAU ENGENDRÉ EST RETIRÉ DU TEXTE, et sans ça un des tests de ce fichier ne
  // prouvait rien. La page « copilot » APPELLE renderCommandsHelp() : le catalogue complet
  // fait donc partie de son HTML, et toute commande de COMMANDS_HELP s'y trouve
  // automatiquement. Le test « une commande est-elle expliquée par une page ? » était donc
  // satisfait par la table qu'il cherchait justement à ne pas prendre pour une explication.
  // Trouvé en mutant : la mutation a survécu, et c'est la seule façon de s'en apercevoir.
  const table = bac.renderCommandsHelp();
  const redige = (p) => p.html().split(table).join('');
  return {
    pages: pages,
    api: Array.from(bac.API_HELP),
    html: pages.map((p) => p.html()).join('\n'),
    // Le GLOSSAIRE : il n'est pas une page, mais la recherche de l'aide le filtre au meme title
    // qu'elles (voir listeAideHtml/glossaryHtml, js/help-page.js). Un terme qui n'y est defini
    // que la est donc bien trouvable par le lecteur.
    glossaire: bac.GLOSSARY_HELP.map((g) => g.terme + ' ' + g.def).join('\n'),
    // Le texte RÉDIGÉ à la main, celui qui explique quelque chose.
    redige: redige,
    htmlRedige: pages.map(redige).join('\n')
  };
}
const AIDE = texteAide();


test('TOUT COMPOSANT que « + Composant » affiche est NOMME dans l aide', () => {
  // Le nom lu dans le moteur, jamais recopié : c'est `typeName` qui s'affiche dans la liste.
  const components = [];
  for(const f of readdirSync(path.join(root, 'js/components'))){
    if(!f.endsWith('.js')) continue;
    for(const m of read('js/components/' + f).matchAll(/static get typeName\(\)\s*\{\s*return '([^']+)'/g)){
      components.push({name: m[1], f: 'js/components/' + f});
    }
  }
  assert.ok(components.length >= 15,
    `seulement ${components.length} composants lus — l'extraction est cassée, et un test qui ne `
    + 'trouve rien à vérifier passe au vert');

  // Auto-contrôle : ces trois-là étaient les oubliés. S'ils cessaient d'être lus, le test
  // redeviendrait vert sans que l'aide se soit améliorée.
  ['SpriteRenderer', 'CameraFollow', 'Tilemap'].forEach((n) => {
    assert.ok(components.some((c) => c.name === n), `${n} n'est plus lu — extraction à revoir`);
  });

  // Pages ET glossaire : la recherche de l'aide interroge les deux, donc un composant defini
  // au glossaire est trouvable. Events, Model et SubScene n'y sont QUE la — ce sont les
  // trois qui n'ont pas de page a eux, et leur definition dit a quoi ils servent et ou aller.
  const corpus = AIDE.html + '\n' + AIDE.glossaire;
  const absents = components.filter((c) => !corpus.includes(c.name));
  assert.deepEqual(absents.map((c) => c.name), [],
    'composants que l\'interface affiche et dont l\'aide ne prononce jamais le nom — on ne peut donc\n'
    + 'pas les chercher : ' + absents.map((c) => c.name).join(', '));
});

test('TOUTE ENTREE de apiFor() a sa ligne dans le catalogue de l aide', () => {
  // Même lecture que test/aide.test.mjs, dans l'autre sens. Là-bottom : « l'aide invente-t-elle
  // une api ? ». Ici : « une api existe-t-elle sans que l'aide la nomme ? » — et c'est ce
  // sens-là qui avait laissé passer trois entrées, dont une qui ne fonctionnait pas.
  const src = read('js/scripts.js');
  const d = src.indexOf('return ({');
  assert.notEqual(d, -1, 'apiFor() a changé de shape');
  const litteral = src.slice(d, src.indexOf('\n  });', d));
  const reelles = new Set();
  litteral.split('\n').forEach((line) => {
    const m = line.match(/^ {4}(?:get\s+)?([A-Za-z_$][\w$]*)\s*[:(]/);
    if(!m) return;
    reelles.add(m[1]);
    if(/[{(]/.test(line)) return;
    line.trim().split(',').forEach((p) => {
      const q = p.match(/^\s*([A-Za-z_$][\w$]*)\s*:/);
      if(q) reelles.add(q[1]);
    });
  });
  assert.ok(reelles.size >= 40, `seulement ${reelles.size} entrées lues — extraction cassée`);

  const documentees = new Set(AIDE.api.filter((e) => e.name).map((e) => e.name));
  const oubliees = Array.from(reelles).filter((k) => !documentees.has(k));
  assert.deepEqual(oubliees, [],
    'entrées d\'api sans ligne dans API_HELP — cette table est le seul catalogue, donc elles sont\n'
    + 'introuvables : ' + oubliees.join(', '));
});

test('CHAQUE COMMANDE du copilote est citee par une PAGE, pas seulement par le tableau', () => {
  // Le tableau du catalogue est engendré : une commande y figure automatiquement. Ça suffit à
  // la faire connaître, pas à la faire comprendre — et une commande qu'aucune page n'explique
  // est une commande dont on ne saura pas QUAND s'en servir.
  //
  // On cherche donc dans le texte RÉDIGÉ, table retirée. Première version de ce test : la
  // table comptait, et il passait quoi qu'on écrive.
  assert.ok(AIDE.htmlRedige.length < AIDE.html.length,
    'le tableau engendré n\'a pas été retiré du texte — ce test ne prouverait rien');
  //
  // On ne l'exige donc pas de toutes : les commandes de manipulation directe (`transform`,
  // `rename_object`…) n'ont rien à expliquer. On l'exige de celles qui APPORTENT une
  // capacité — celles dont l'existence même est une information.
  const aExpliquer = ['create_texture', 'create_sound', 'configure_audio', 'play_sound',
                      'checkpoint', 'go_back', 'read_design', 'write_design',
                      'summarize_scene', 'capture_view', 'play_and_measure', 'check',
                      'build_atlas', 'paint_room', 'configure_camera_2d', 'bake_iso_sprites'];

  // Auto-contrôle : la liste ne doit citer que des commandes RÉELLES, sinon elle se vide de
  // sens à mesure que le moteur change, et le test continue de passer.
  const declarees = ['js/copilot.js', 'js/copilot-workshop.js', 'js/copilot-observer.js']
    .flatMap((f) => Array.from(read(f).matchAll(/name: *'([a-z_0-9]+)'/g), (m) => m[1]));
  const fantomes = aExpliquer.filter((n) => !declarees.includes(n));
  assert.deepEqual(fantomes, [], 'cette liste cite des commandes inexistantes : ' + fantomes.join(', '));

  const sansPage = aExpliquer.filter(
    (n) => !AIDE.pages.some((p) => AIDE.redige(p).includes('<code>' + n + '</code>')));
  assert.deepEqual(sansPage, [],
    'commandes qui apportent une capacité et qu\'aucune page n\'explique : ' + sansPage.join(', '));
});

// La seule page qui n'a pas besoin qu'on la lui amène : c'est celle par laquelle on entre.
// Une exception NOMMÉE, parce qu'une exception tacite finit par en couvrir d'autres.
const ENTREE = ['getting-started'];

test('CHAQUE PAGE est joignable depuis une autre, ou depuis le menu', () => {
  // Une page qui n'est nulle part liée n'existe que pour qui parcourt le sommaire en entier.
  // Le sommaire suffit à la trouver — mais on ne le parcourt pas : on cherche depuis là où on
  // est. Une page neuve non liée est le mode d'échec normal d'un ajout d'aide, et c'est celui
  // qu'on ne remarque pas : la page est juste, complète, et personne n'y arrive.
  const liees = new Set();
  for(const m of AIDE.html.matchAll(/data-help="([^"]+)"/g)) liees.add(m[1]);
  for(const m of read('js/ui.js').matchAll(/openHelp\('([^']+)'\)/g)) liees.add(m[1]);
  for(const g of readHelpSource().matchAll(/page: *'([^']+)'/g)) liees.add(g[1]);

  assert.ok(liees.size >= 10, `seulement ${liees.size} links relevés — l'extraction est cassée`);
  const orphelines = AIDE.pages.map((p) => p.id)
    .filter((id) => !liees.has(id) && !ENTREE.includes(id));
  assert.deepEqual(orphelines, [],
    'pages où aucune autre page, aucun menu et aucun terme du glossaire ne mène : '
    + orphelines.join(', '));

  // Et l'exception doit rester une page réelle : une entrée périmée dispenserait en silence
  // une page qui n'existe plus, puis un jour une page neuve portant le même identifiant.
  const inconnues = ENTREE.filter((id) => !AIDE.pages.some((p) => p.id === id));
  assert.deepEqual(inconnues, [], 'ENTREE cite des pages inexistantes : ' + inconnues.join(', '));
});
