import { HELP_SCRIPTS, readHelpSource } from './help-env.mjs';
import { deEsm } from './engine-env.mjs';
// Le point d'entrée MANUEL des assets procéduraux (js/ui-factory.js).
//
// LE TEST QUI PORTE LE FICHIER est celui des défauts : ouvrir la fenêtre, choisir un genre, cliquer
// « Créer » — sans rien régler — doit produire un asset valide, pour les DOUZE genres. C'est toute
// la promesse du bouton. Un genre dont les défauts ne passent pas le validateur donne une fenêtre
// qui s'ouvre sur un avertissement et un bouton qui ne fait rien : l'auteur en conclut que la
// fonctionnalité est cassée, pas qu'il lui manque un réglage.
//
// Le second contrôle est le plus structurel : ce fichier ne doit RIEN refabriquer lui-même. Le
// bouton et l'IA appellent les deux mêmes fonctions. Un bouton qui recopierait la recette
// produirait un jour, sous le même nom de genre, un asset différent de celui de l'IA — et rien ne
// dirait lequel des deux a raison.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const hote = (x) => JSON.parse(JSON.stringify(x));

// js/ui-factory.js branche son bouton au chargement : sans ce bouchon de `document`, le fichier
// lève avant d'avoir déclaré quoi que ce soit, et rien ne serait mesurable.
function contexte(){
  const bac = {console, Math, JSON, Number, String, Object, Array, isFinite, Date,
               document: {getElementById(){ return {addEventListener(){}}; }},
               assets: []};
  bac.window = bac; bac.self = bac; bac.globalThis = bac;
  const ctx = vm.createContext(bac);
  // Les validateurs et fabricants réels : on ne bouchonne PAS ce qu'on veut mesurer.
  vm.runInContext(deEsm(read('js/proc-texture.js')), ctx, {filename: 'js/proc-texture.js'});
  vm.runInContext(deEsm(read('js/proc-sound.js')), ctx, {filename: 'js/proc-sound.js'});
  vm.runInContext(deEsm(read('js/ui-factory.js')), ctx, {filename: 'js/ui-factory.js'});
  // Un `const` de premier niveau exécuté par vm rejoint l'environnement lexical du contexte mais ne
  // devient jamais une propriété de l'object global : sans ce pont, les tables sont invisibles.
  vm.runInContext('this.FACTORY_TEXTURES = FACTORY_TEXTURES; this.FACTORY_SOUNDS = FACTORY_SOUNDS;'
    + ' this.FACTORY_FIELDS = FACTORY_FIELDS;', ctx);
  return ctx;
}

const CTX = contexte();
const TEXTURES = Array.from(CTX.FACTORY_TEXTURES);
const SONS = Array.from(CTX.FACTORY_SOUNDS);


test('LES DEFAUTS DE CHAQUE GENRE passent le validateur — le test qui porte le fichier', () => {
  // Le count est un FIL-PIEGE volontaire : add un genre au moteur sans l add a la
  // window le rendrait invisible, et c est exactement le defaut que ce repo passe son temps a
  // corriger. Il doit donc se mettre a jour EN CONNAISSANCE DE CAUSE, jamais par reflexe.
  assert.equal(TEXTURES.length + SONS.length, 13,
    'treize genres attendus (7 images + 6 bruitages) — la table a changé sans que le test le sache');

  const refuses = [];
  TEXTURES.forEach((g) => {
    const d = CTX.factoryRequest(g.kind, {});
    const soucis = CTX.validateTextureProc(d);
    if(soucis.length) refuses.push(g.kind + ' : ' + soucis.join(' '));
    // Et la texture doit VRAIMENT sortir : un validateur content sur un fabricant qui rend `null`
    // donnerait une fenêtre sans aperçu et un bouton muet.
    const t = CTX.makeTextureProc(d);
    if(!t) refuses.push(g.kind + ' : le fabricant rend null malgré des défauts valides');
    else if(!(t.l > 0 && t.h > 0)) refuses.push(g.kind + ' : toile de taille nulle');
  });
  SONS.forEach((g) => {
    const d = CTX.factoryRequest(g.kind, {});
    const soucis = CTX.validateSoundProc(d);
    if(soucis.length) refuses.push(g.kind + ' : ' + soucis.join(' '));
    const wav = CTX.makeSoundProc(d);
    if(!wav) refuses.push(g.kind + ' : le fabricant rend null malgré des défauts valides');
    else if(wav.length <= 44) refuses.push(g.kind + ' : WAV sans échantillon (en-tête seul)');
  });
  assert.deepEqual(refuses, [],
    'genres dont les DÉFAUTS ne produisent rien — la fenêtre s\'ouvrirait sur un avertissement :\n'
    + refuses.join('\n'));
});

test('LES GENRES DE LA FENETRE sont EXACTEMENT ceux que le moteur sait fabriquer', () => {
  // Dans les deux sens. Un genre du moteur absent d'ici est un genre qu'on ne peut atteindre qu'en
  // passant par l'IA — le défaut même que ce bouton corrige. Un genre d'ici absent du moteur est
  // une entrée de menu qui échoue au clic.
  const duMoteur = (file, motif) => {
    const m = read(file).match(motif);
    assert.ok(m, `${file} : la liste des genres a changé de shape`);
    return m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).sort();
  };
  const genresTexture = duMoteur('js/proc-texture.js', /const genres = \[([^\]]+)\][\s\S]{0,80}Genre de texture/);
  const genresSon = duMoteur('js/proc-sound.js', /const genres = \[([^\]]+)\][\s\S]{0,80}Genre de son/);
  assert.ok(genresTexture.length >= 6 && genresSon.length >= 6, 'extraction des genres cassée');

  assert.deepEqual(TEXTURES.map((g) => g.kind).sort(), genresTexture);
  assert.deepEqual(SONS.map((g) => g.kind).sort(), genresSon);
});

test('CHAQUE CHAMP declare a un libelle et des bounds', () => {
  const orphelins = [];
  TEXTURES.forEach((g) => {
    g.fields.forEach((c) => { if(!CTX.FACTORY_FIELDS[c]) orphelins.push(g.kind + ' → ' + c); });
    // Un champ décrit mais sans défaut arriverait vide dans la fenêtre : l'auteur verrait un
    // aperçu qui ne correspond pas à ce que le fabricant produira.
    g.fields.forEach((c) => {
      if(g.defaults[c] === undefined) orphelins.push(g.kind + ' → ' + c + ' sans défaut');
    });
  });
  assert.deepEqual(orphelins, [], 'champs sans description ou sans défaut : ' + orphelins.join(', '));

  // Et l'inverse : une entrée de FACTORY_FIELDS que personne n'utilise est du code mort qui
  // finira par décrire un champ disparu.
  const utilises = new Set(TEXTURES.flatMap((g) => g.fields).concat(['duration', 'frequency', 'volume']));
  const inutiles = Object.keys(CTX.FACTORY_FIELDS).filter((c) => !utilises.has(c));
  assert.deepEqual(inutiles, [], 'fields décrits et jamais affichés : ' + inutiles.join(', '));
});

test('factoryRequest BORNE au lieu de refuser, et laisse les couleurs tranquilles', () => {
  // Borner plutôt que refuser : refuser oblige à comprendre une contrainte AVANT de voir quoi que
  // ce soit, alors que l'aperçu est justement là pour l'inverse.
  const d = CTX.factoryRequest('solid', {width: 99999, height: -5, color: '#ff0000'});
  assert.equal(d.width, 4096, 'une largeur démesurée doit être ramenée, pas refusée');
  assert.equal(d.height, 1, 'une hauteur négative doit être ramenée dans les bounds');
  assert.equal(d.color, '#ff0000', 'une couleur est une chaîne, pas un number');
  // `hote()` RAPATRIE le tableau dans le royaume de l'hôte : un tableau né dans un contexte vm porte
  // le prototype de CE contexte, et `deepEqual(tableauVm, [])` échoue alors même que les deux sont
  // vides, en affichant « [] » des deux côtés. Le dépôt s'y est déjà fait prendre trois fois.
  assert.deepEqual(hote(CTX.validateTextureProc(d)), [], 'le résultat borné doit être valide');

  // Un champ vide garde le DÉFAUT : sans ça il arriverait `undefined` chez le fabricant, qui
  // poserait SA valeur — et l'aperçu montrerait autre chose que ce que la fenêtre shown.
  const empty = CTX.factoryRequest('solid', {width: '', height: null, color: undefined});
  const nu = CTX.factoryRequest('solid', {});
  assert.deepEqual(hote(empty), hote(nu), 'un champ vide doit retomber sur le défaut du genre');

  // Une saisie non numérique ne doit pas produire NaN : un NaN traverse les validateurs et ne se
  // voit qu'à l'aperçu, empty, qu'on attribue au genre choisi.
  const text = CTX.factoryRequest('solid', {width: 'abc'});
  assert.equal(text.width, nu.width, 'une saisie illisible garde le défaut');

  assert.equal(CTX.factoryRequest('inexistant', {}), null, 'un genre inconnu ne fabrique rien');
});

test('LE BOUTON ET L IA passent par les MEMES fonctions', () => {
  const src = read('js/ui-factory.js').replace(/\r\n/g, '\n');
  const codeSeul = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

  assert.ok(/createTextureProc\(/.test(codeSeul), 'la fenêtre n\'appelle plus la fabrique de textures');
  assert.ok(/createSoundProc\(/.test(codeSeul), 'la fenêtre n\'appelle plus la fabrique de sons');

  // Et surtout : elle ne crée AUCUN asset elle-même. C'est ce qui garantit qu'un même genre donne
  // le même fichier des deux côtés, aujourd'hui et après n'importe quelle correction.
  ['createAssetTexture(', 'createAssetAudio(', 'createAssetSprite(', 'sliceGrid(']
    .forEach((appel) => {
      assert.ok(!codeSeul.includes(appel),
        `js/ui-factory.js appelle ${appel} directement : il refabrique ce que la commande fabrique, `
        + 'et les deux chemins finiront par diverger');
    });

  // La commande, elle, doit avoir été factorisée — sinon la garde ci-dessus est vide de sens.
  const atelier = read('js/copilot-workshop.js').replace(/\r\n/g, '\n');
  assert.ok(/function createSoundProc\(/.test(atelier),
    'createSoundProc a disparu de js/copilot-workshop.js');
  assert.ok(/const r = createSoundProc\(a\);/.test(atelier),
    'la commande create_sound ne délègue plus : elle a repris sa propre recette');
});

test('L AIDE DIT ou passe la frontiere de l historique, et elle a bouge deux fois', () => {
  // CE TEST A DÉJÀ FAIT SON TRAVAIL DEUX FOIS, ET S'EST FAIT AVOIR UNE FOIS.
  //
  // v0.69.0 : il exigeait que l'aide avertisse qu'un asset créé NE s'annulait pas, en disant « il
  // tombera le jour où quelqu'un couvrira les assets ». Il est tombé le lendemain — bien.
  //
  // v0.70.0 : il exigeait que le renommage soit annoncé comme NON annulable, et le mesurait en
  // cherchant `pushHistory` dans le bloc de renommage. Le lot suivant y a mis
  // `histoAssetTimes()` — le pas est bien empilé, mais sous un autre nom, et le test est resté
  // VERT en prouvant le contraire de la vérité. Une garde qui cherche un nom de fonction mesure ce
  // name, pas le comportement.
  //
  // On mesure donc l'EMPILEMENT, quel que soit son nom : `pushHistory` ou n'importe quelle
  // fonction qui l'appelle.
  const hist = read('js/history.js').replace(/\r\n/g, '\n');
  const start = hist.indexOf('function stateCurrent()');
  assert.notEqual(start, -1, 'stateCurrent() a disparu de js/history.js');
  const body = hist.slice(start, hist.indexOf('\n}', start));
  assert.ok(/^\s*assets\s*:\s*assets\.slice\(\)/m.test(body),
    'stateCurrent() ne photographie plus la LISTE des assets : la création redevient irréversible');
  assert.ok(/^\s*fieldsAssets\s*:/m.test(body),
    'stateCurrent() ne photographie plus les CHAMPS des assets : le renommage et les paramètres '
    + 'd\'import redeviennent irréversibles, et l\'aide promet le contraire');

  // LE RENOMMAGE EMPILE. On lit le bloc et on suit le nom appelé jusqu'à `pushHistory` :
  // c'est ce que la version précédente ne faisait pas.
  const pi = read('js/import-settings.js').replace(/\r\n/g, '\n');
  const i = pi.indexOf("if(!a || e.target.id !== 'ip-name') return;");
  assert.notEqual(i, -1, 'le renommage d\'asset a changé de shape — la mesure est à refaire');
  const block = pi.slice(i, pi.indexOf('\n});', i));
  const appel = block.match(/\b(pushHistory|histoAssetTimes)\(\)/);
  assert.ok(appel, 'le renommage d\'un asset n\'empile aucun pas : photographier son nom ferait '
    + 'annuler un renommage que rien n\'a enregistré');
  if(appel[1] !== 'pushHistory'){
    // Le relais doit vraiment mener à l'empilement, sinon on aurait juste renommé le vide.
    const relais = pi.indexOf('function ' + appel[1] + '(');
    assert.notEqual(relais, -1, appel[1] + ' est appelé mais n\'existe pas');
    assert.ok(pi.slice(relais, pi.indexOf('\n}', relais)).includes('pushHistory()'),
      appel[1] + ' n\'empile rien : le renommage n\'est pas réellement annulable');
  }

  // LE CODE EST ENTRÉ À SON TOUR, et l'exclusion doit avoir disparu avec lui : la laisser
  // écarterait silencieusement le champ que les sites d'édition photographient désormais.
  assert.ok(!/^\s*code:/m.test(hist.slice(hist.indexOf('FIELDS_ASSET_OUTSIDE_HISTO = {'),
                                          hist.indexOf('};', hist.indexOf('FIELDS_ASSET_OUTSIDE_HISTO = {')))),
    'le code est encore exclu de l\'instantané alors que ses éditeurs empilent un pas : '
    + 'une session d\'édition reste irréversible');

  // LES DEUX PAGES, CHACUNE POUR ELLE-MÊME. Une version antérieure cherchait la phrase dans tout le
  // fichier avec un `ou` : la unregister d'une page laissait le test vert, couvert par l'autre.
  const help = readHelpSource().replace(/\r\n/g, '\n');
  const page = (id) => {
    const j = help.indexOf("{id:'" + id + "'");
    assert.notEqual(j, -1, `la page « ${id} » a disparu de l'aide`);
    const k = help.indexOf("\n{id:'", j + 1);
    return help.slice(j, k === -1 ? undefined : k);
  };
  ['copilot', 'assets-made'].forEach((id) => {
    const t = page(id);
    assert.ok(/renommer|renommage/i.test(t),
      `la page « ${id} » ne parle plus du renommage, qui a changé de côté en v0.71.0`);
    // LE GRAIN, pas seulement la promesse. « Tout s'annule » est vrai et insuffisant : une session
    // d'édition de code fait UN pas, pas un par frappe, et c'est ce qui surprend — on s'attend à
    // remonter mot à mot depuis la scène. La page doit dire lequel des deux on obtient.
    //
    // UNE SEULE ANCRE, PRÉCISE. Deux versions ont échoué avant celle-ci, des deux façons
    // possibles : d'abord un mot current (« session » — qui apparaît AUSSI trente lignes plus bas
    // à propos du copilote, donc effacer l'explication laissait le test vert), puis une
    // DISJONCTION de trois formulations — dont chaque mutation ne cassait qu'une branche, les
    // deux autres continuant de matcher ailleurs dans la page.
    //
    // Une garde sur de la prose ne peut pas être robuste au reformulage, et prétendre le contraire
    // fabrique un test qui ne mesure rien. On exige donc UNE formulation : la reformuler fera
    // rougir ce test, et c'est le bon moment pour relire ce qu'on vient d'écrire. C'est exactement
    // le contrat du système d'ancres de l'aide.
    assert.ok(t.includes('compte pour un seul pas'),
      `la page « ${id} » promet l'annulation sans dire son GRAIN. Une rafale de frappe et une `
      + 'session d\'édition de code comptent chacune pour UN pas, et la zone de texte garde son '
      + 'annulation native pour le mot à mot : ne dire que « ça s\'annule » laisse croire au '
      + 'grain end. (Si vous avez reformulé, mettez cette ancre à jour.)');
  });

  // LA BORNE DE LA PILE, adossée au code. C'est elle qui rend la coalescence nécessaire : sans
  // elle, « un pas par frappe » serait un détail de confort, pas une perte de travail. Le chiffre
  // est dans l'aide et dans js/history.js — s'ils divergent, l'un des deux ment.
  const limite = (read('js/history.js').match(/limite\s*:\s*(\d+)/) || [])[1];
  assert.ok(limite, 'la clamped de la pile d\'historique a disparu de js/history.js');
  assert.ok(page('copilot').includes('<b>' + limite + '</b>'),
    `l'aide n'annonce plus la clamped réelle de la pile (${limite} pas) — or c'est elle qui explique `
    + 'pourquoi une rafale ne peut pas empiler un pas par caractère');
});

test('LE CABLAGE : le bouton existe, et le fichier est charge APRES ses dependances', () => {
  const html = read('editor.html');
  assert.ok(html.includes('id="btn-make"'),
    'le bouton 🎲 Fabriquer a disparu d\'editor.html — la fenêtre redevient inatteignable');
  // Sans `?v=` : la query a quitté les balises de modules (elle donnait deux URL, donc deux
  // exécutions, à chaque fichier du graphe). Voir test/materiau-plugin.test.mjs.
  assert.ok(/js\/ui-factory\.js["?]/.test(html), 'editor.html ne charge plus js/ui-factory.js');

  // L'ORDRE, et il est vital : le fichier appelle `addEventListener` sur son bouton AU CHARGEMENT,
  // et appelle deux fonctions de copilote-workshop.js. Chargé avant lui, il lèverait — et une
  // error au chargement d'un script laisse les suivants tourner, donc l'éditeur aurait l'air
  // normal, sans ce bouton.
  //
  // copilot-workshop.js N'A PLUS sa propre balise (voir test/copilote-registre.test.mjs) : une
  // balise séparée le chargeait deux fois sous deux URL différentes et le double-exécutait,
  // enregistrant create_texture deux fois. L'ordre vient maintenant de l'`import` d'ui-factory.js
  // lui-même, vérifié ci-dessous.
  const src = read('js/ui-factory.js');
  assert.match(src, /import\s*\{[^}]*\b(createSoundProc|createTextureProc)\b[^}]*\}\s*from\s*['"]\.\/copilot-workshop\.js['"]/,
    'js/ui-factory.js doit importer copilot-workshop.js, pas compter sur l\'ordre des <script>');
  const rank = (f) => html.indexOf('js/' + f);
  ['proc-texture.js', 'proc-sound.js', 'audio.js'].forEach((dep) => {
    assert.ok(rank(dep) !== -1, `js/${dep} n'est plus chargé`);
    assert.ok(rank(dep) < rank('ui-factory.js'),
      `js/ui-factory.js est chargé AVANT js/${dep}, dont il dépend`);
  });
});
