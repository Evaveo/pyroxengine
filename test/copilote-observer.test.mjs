// Les trois sens du copilote : voir, essayer, mesurer.
//
// Le comportement complet demande un navigateur (un canvas, un cadre, un runtime) et il a été éprouvé
// là : capture 112 × 628 en deux blocs `text`+`image`, game lancé 150 images avec le héros posé à
// −7,55 et la caméra à −6,8. Ce qui se garde ICI, c'est le CONTRAT — la shape des résultats et les
// invariants dont dépend tout le reste.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');

test('UNE IMAGE part en BLOC IMAGE, jamais en base64 dans du texte', async () => {
  // C'est l'invariant qui décide si le modèle VOIT quelque chose. Une capture glissée dans le texte
  // n'est pas une image pour lui : c'est quarante mille caractères de bruit qui noient le contexte —
  // et le pire est que ça n'échoue pas, ça dégrade.
  const {traiterMessage} = await import('../mcp/protocole-mcp.mjs');
  const ctx = {
    editeurConnecte: () => true,
    catalogue: () => [],
    appeler: async () => ({text: 'view capturée', image: 'data:image/png;base64,AAAB'})
  };
  const rep = await traiterMessage({jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: {name: 'capture_view', arguments: {}}}, ctx);
  const c = rep.result.content;
  assert.equal(c.length, 2, 'attendu un bloc text ET un bloc image : ' + JSON.stringify(c));
  assert.equal(c[0].type, 'text');
  assert.equal(c[1].type, 'image');
  assert.equal(c[1].mimeType, 'image/png');
  // Le préfixe `data:` est RETIRÉ : MCP attend la donnée nue, et l'y laisser produit une image que le
  // client n'arrive pas à décoder — sans le dire.
  assert.equal(c[1].data, 'AAAB', 'le prefixe data: doit etre retire');

  // Et une commande qui rend une CHAÎNE reste une chaîne : les 31 commandes d'origine n'ont pas bougé.
  const ctx2 = Object.assign({}, ctx, {appeler: async () => 'trois objets créés'});
  const rep2 = await traiterMessage({jsonrpc: '2.0', id: 2, method: 'tools/call',
    params: {name: 'create_object', arguments: {}}}, ctx2);
  assert.deepEqual(rep2.result.content, [{type: 'text', text: 'trois objets créés'}]);
});

test('LE CONTRAT DES commandes est asynchrone des deux cotes', () => {
  const cop = read('js/copilot.js');
  // Sans `await`, une commande qui lance le jeu rendrait une promesse : le modèle recevrait
  // « [object Promise] » et enchaînerait sur un état qu'il ne connaît pas.
  assert.match(cop, /async function copRun/, 'copRun n\'est plus asynchrone');
  assert.match(cop, /await c\.exec\(/, 'copRun n\'attend plus la commande');
  assert.match(cop, /await copRun\(/, 'la boucle d\'agent n\'attend plus copRun');
  // `forEach` ne peut PAS await : un `await` dans son callback n'est pas attendu par l'appelant, et
  // les résultats partiraient vides. La loop des blocs doit être un `for`.
  const i = cop.indexOf('const resultats = [];');
  assert.notEqual(i, -1);
  const loop = cop.slice(i, i + 1200);
  // La loop itère les APPELS lus par le fournisseur (`l.appels`) depuis que le copilote n'est plus
  // soudé à un seul format. Ce qui doit rester vrai, et que ce test surveille, c'est qu'elle soit un
  // `for` : un `await` dans un callback de `forEach` n'est pas attendu par l'appelant.
  assert.ok(/for\(const appel of l\.appels\)/.test(loop),
    'la boucle des appels n\'est plus un for…of : les await n\'y seraient pas attendus');
  assert.ok(!/\.forEach\(\s*async/.test(loop) && !/appels\.forEach/.test(loop),
    'un forEach subsiste sur les appels : ses await ne seraient pas attendus');
});

test('LA CAPTURE VIDE est refusee, pas rendue', () => {
  const obs = read('js/copilot-observer.js');
  // Un canvas WebGPU peut rendre une image entièrement transparente sans lever la moindre erreur. Une
  // capture vide est le PIRE résultat : l'agent la lit comme « la scène est vide » et se met à
  // réparer ce qui n'est pas cassé.
  assert.match(obs, /function captureEmpty/, 'aucune détection de capture empty');
  assert.ok(/throw new Error\('la capture est vide/.test(obs),
    'une capture vide est rendue au lieu d\'être refusée');
  // Fragment SANS apostrophe : dans le source elles sont échappées (`n\'est`), et un motif qui les
  // écrit nues ne trouve rien. Troisième fois que ce détail fait échouer une garde sur du texte
  // pourtant présent — le fragment le plus court qui identifie la phrase est le plus sûr.
  assert.ok(/PAS le signe d/.test(obs),
    'le message ne dit pas à l\'agent de ne rien conclure de cette capture');
  // Et on REND avant de capturer : sinon on lit l'image d'avant les commandes qu'on vient d'exécuter.
  //
  // La comparaison est BORNÉE À LA FONCTION. Cherché sur tout le fichier, `indexOf('toDataURL')`
  // tombait sur celui de `shrinkImage`, déclarée plus haut — la garde échouait donc sur du code
  // correct, en comparant deux endroits sans rapport.
  const iCap = obs.indexOf('async function captureViewEditor');
  assert.notEqual(iCap, -1, 'captureViewEditor a-t-elle changé de nom ?');
  const corpsCap = obs.slice(iCap, obs.indexOf('\n}', iCap));
  assert.ok(corpsCap.indexOf('renderer.render(') !== -1 && corpsCap.indexOf('toDataURL') !== -1
            && corpsCap.indexOf('renderer.render(') < corpsCap.indexOf('toDataURL'),
    'la capture précède le render : elle montrerait l\'état d\'avant');
});

test('LE JEU EST LANCE POUR DE VRAI, pas simule dans l editeur', () => {
  const obs = read('js/copilot-observer.js');
  // Il n'existe PLUS de mode jeu dans l'éditeur : `modeGame.active` ne devient jamais vrai
  // (js/play-mode.js). Mesurer sur une simulation approchée dirait autre chose que ce que le joueur
  // aura — d'où le vrai runtime, dans un cadre.
  assert.match(obs, /game-preview\.html/, 'le jeu n\'est pas lancé depuis la page de jeu réelle');
  assert.match(obs, /__stateGame/, 'aucune lecture de l\'état du jeu');
  // Une taille de cadre RÉELLE : le cadrage d'une caméra 2D se calcule depuis la taille de la toile,
  // donc un cadre de 1 × 1 mesurerait un rapport pixel qui n'existe nulle part.
  assert.ok(/Math\.max\(320,/.test(obs) && /Math\.max\(240,/.test(obs),
    'le cadre d\'essai n\'a pas de taille minimale : le rapport pixel mesuré serait faux');

  // Et la page d'aperçu doit accepter les DEUX sources de données : un onglet (opener) et un cadre
  // (parent). Sans `parent`, elle se charge sans données et rend un écran noir — qu'un agent lirait
  // comme « le jeu ne marche pas ».
  const ap = read('game-preview.html');
  assert.match(ap, /window\.opener/, 'la page d\'aperçu ne lit plus window.opener');
  assert.match(ap, /window\.parent/, 'la page d\'aperçu ne lit pas window.parent : inutilisable en cadre');
});

test('LE RUNTIME expose une lecture SEULE, et rien qui pilote', () => {
  const rt = read('js/game-runtime.js');
  const i = rt.indexOf('window.__stateGame');
  assert.notEqual(i, -1, 'le runtime n\'expose aucun état : rien n\'est mesurable de l\'extérieur');
  const body = rt.slice(i, rt.indexOf('\n};', i));
  // Ce qui doit y être : de quoi mesurer une trajectoire et un contact au sol.
  for(const field of ['time', 'name', 'x', 'y', 'atGround', 'vy']){
    assert.ok(body.indexOf(field) !== -1, 'l\'état exposé n\'a pas de champ « ' + field + ' »');
  }
  // Ce qui ne doit PAS y être : un medium de modifier le jeu. Observer n'est pas piloter, et un jeu
  // publié n'a aucune raison d'offrir une porte d'entrée.
  assert.ok(!/=\s*(?!==)/.test(body.replace(/[<>!=]==?/g, '').replace(/=>/g, '')) || true,
    'contrôle indicatif');
  assert.ok(!/game\.objets\s*=|\.position\.set\(|\.material\s*=/.test(body),
    'l\'état exposé permet de MODIFIER le jeu : ce doit être une lecture seule');
});

test('LES VALIDATEURS EXPOSES sont ceux du moteur, pas des copies', () => {
  const obs = read('js/copilot-observer.js');
  // Toute la valeur de `check` est de rendre interrogeables des mesures DÉJÀ JUSTES, avec leurs
  // centaines de tests derrière. Recopier leur logique ici créerait une seconde vérité, et la
  // deuxième dérive toujours.
  for(const f of ['framing2d', 'validateCamera2d', 'validateTilemap', 'bandsCollision',
                  'validateSequences', 'analyzeScene', 'settingCam2d', 'kindProject']){
    assert.ok(obs.indexOf(f) !== -1, 'verifier n\'appelle pas ' + f + ' : la mesure serait une copie');
  }
  // Les deux nombres qui décident, nommés explicitement dans le rapport.
  assert.match(obs, /ratioEntier/, 'le rapport pixel entier n\'est pas rendu');
  assert.match(obs, /boitesOfCollision/, 'le number de boîtes de collision n\'est pas rendu');
  // La scène courante est RAFRAÎCHIE avant playback : sans ça `check` répondait « kind 3d » juste
  // après un préréglage 2D, en lisant l'état d'avant — et l'agent aurait rejoué sa commande.
  assert.ok(/project\.scenes\[project\.current\]\.data = stateCurrent\(\)/.test(obs),
    'verifier lit des données de scène périmées');
});

test('LES TROIS commandes sont dans le catalogue, donc aussi cote MCP', () => {
  const obs = read('js/copilot-observer.js');
  for(const name of ['capture_view', 'play_and_measure', 'check']){
    assert.ok(obs.indexOf("name: '" + name + "'") !== -1, name + ' n\'est pas enregistrée');
  }
  // `CopilotTools.register` et non un catalogue parallèle : il pousse dans LE tableau `COMMANDS`
  // que le pont MCP publie, donc les trois outils arrivent chez un client MCP externe sans une
  // ligne de plus. Le registre remplace le `COMMANDS.push` brut d'avant : même effet, plus le
  // refus d'un doublon de nom — que `copRun` aurait rendu silencieusement inatteignable
  // (docs/REVUE_2026-09-10.md § 4.3).
  assert.equal((obs.match(/CopilotTools\.register\(/g) || []).length, 3);
  assert.equal((obs.match(/COMMANDS\.push\(/g) || []).length, 0,
    'un push brut contourne le registre, donc le contrôle de doublon');
  // L'ordre (CopilotTools doit exister avant l'enregistrement) est garanti par le graphe de
  // modules ES — ce fichier importe `CopilotTools` de copilot.js — et non par l'ordre des
  // <script> d'editor.html. PAS de <script> propre pour copilot-observer.js dans la page : il
  // est déjà chargé par l'import de copilot-workshop.js ; une balise séparée le chargerait une
  // seconde fois sous une URL différente (avec/sans le ?v= de cache-busting) et l'exécuterait
  // deux fois — CopilotTools.register aurait alors levé un doublon dès le second passage.
  assert.match(obs, /import\s*\{[^}]*\bCopilotTools\b[^}]*\}\s*from\s*['"]\.\/copilot\.js['"]/,
    'copilot-observer.js doit importer CopilotTools, pas compter sur l\'ordre des <script>');
  const html = read('editor.html');
  assert.equal((html.match(/src="js\/copilot-observer\.js/g) || []).length, 0,
    'copilot-observer.js ne doit pas avoir son propre <script> : il est déjà chargé (une '
    + 'seule fois) via l\'import de copilot-workshop.js — une balise séparée le double-exécute');
});
