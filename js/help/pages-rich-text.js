// ---------- Aide de l'éditeur : texte riche (`data-bind-rich`) ----------
// Chaque exemple de la page est RENDU EN DIRECT par le moteur lui-même (richTextToHtml) : ce que
// le lecteur voit est exactement ce que le joueur verra, et l'aide ne peut pas dériver du code.
import { RICH_TEXT_CSS, richTextToHtml } from '../game-ui.js';
import { advancedHelp, arrayHelp, essentialHelp, linkHelp, stepsHelp, tipHelp, trapHelp } from './help-format.js';

const DEMO_CSS = '<style>' + RICH_TEXT_CSS + '\n'
  + '.help-rt-demo{background:#14141c;color:#e8e8f0;border-radius:6px;padding:10px 14px;margin:6px 0 12px;'
  + 'font-size:1.15em;line-height:1.7;font-family:system-ui,sans-serif}\n</style>';

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Le rendu seul.
function render(src, speed) {
  return '<div class="help-rt-demo">' + richTextToHtml(src, {speed: speed || 0}) + '</div>';
}

// Le balisage, puis son rendu.
function demo(src, speed) {
  return '<pre><code>' + escapeHtml(src) + '</code></pre>' + render(src, speed);
}

// Une ligne de tableau : la balise, ce qu'elle fait, et le rendu d'un mot.
function row(tag, what, sample) {
  return ['<code>' + escapeHtml(tag) + '</code>', what, richTextToHtml(sample)];
}

export const PAGE_RICH_TEXT =
{id:'rich-text', part:'workflows', section:'Interface de jeu', title:'Texte riche : couleurs et effets animés', level:'both',
 summary:'Dialogues et messages avec couleurs, gras, vague, tremblement, arc-en-ciel et machine à écrire.',
 anchors:[
   {f:'js/game-ui.js', c:"[data-bind-rich]"},
   {f:'js/game-ui.js', c:'export function parseRichText(src) {'},
   {f:'js/game-ui.js', c:'export const RICH_TEXT_SPEED = 45;'},
   {f:'js/game-ui.js', c:"'.rt-skip .rt-reveal{animation:none}',"},
   {f:'js/game-ui.js', c:"const speed = el.dataset.typewriter !== undefined"},
   {f:'js/game-ui.js', c:'export const RICH_TEXT_API = Object.freeze({'},
   {f:'js/scripts.js', c:'richText: globalThis.RICH_TEXT_API || null,'},
   {f:'js/game-runtime.js', c:'richText:globalThis.RICH_TEXT_API || null,'}
 ],
 html:function(){ return DEMO_CSS
  + essentialHelp('<p>Un élément d\'interface marqué <code>data-bind-rich="clé"</code> affiche la valeur liée '
    + 'comme du <b>texte balisé</b> : on écrit <code>[red]Danger[/]</code> ou <code>[wave]Bonjour ![/]</code> '
    + 'et le moteur met en couleur, anime chaque lettre, et peut l\'écrire lettre par lettre façon '
    + '<b>machine à écrire</b>. C\'est fait pour les dialogues, les bulles, les journaux de combat, les titres '
    + 'de victoire.</p>')
  + render('[b][rainbow]Victoire ![/][/] Vous gagnez [gold]120 pièces[/] et [shake][red]perdez 3 PV[/][/]… '
    + '[i][cyan]« Pas si vite ! »[/][/]')

  + '<h3>En trois étapes</h3>'
  + stepsHelp([
      'Dans le <b>document UI</b>, posez l\'élément : <code>&lt;div class="bulle" data-bind-rich="dialogue" data-typewriter&gt;&lt;/div&gt;</code>.',
      'Dans un script, écrivez le texte balisé : <code>api.uiDocument().values.dialogue = \'[wave]Bonjour ![/]\';</code>.',
      'Lancez <b>▶ Jouer</b> : le texte s\'écrit lettre par lettre, la vague tourne en boucle.'
    ])
  + tipHelp('Rien à appeler à chaque image : l\'animation et la machine à écrire sont faites par le navigateur. '
    + 'Le texte n\'est reconstruit <b>que quand sa valeur change</b> — réécrire la même phrase ne relance pas l\'écriture.')

  + '<h3>La syntaxe</h3>'
  + '<p>Une balise s\'ouvre entre crochets et se ferme par <code>[/]</code> (ferme la dernière ouverte) ou '
  + '<code>[/nom]</code> (ferme jusqu\'à celle-là, et toutes celles ouvertes après). Les balises <b>s\'imbriquent</b> et se cumulent.</p>'
  + demo('[b]Gras[/], [i]italique[/], [b][i][red]les trois[/][/][/], et [u]souligné[/] puis [s]barré[/].')
  + demo('[b][orange]Attention :[/b] le pont est [shake]fragile[/].')

  + '<h3>Style</h3>'
  + arrayHelp(['Balise', 'Effet', 'Rendu'], [
      row('[b]…[/]', 'Gras', '[b]Gras[/]'),
      row('[i]…[/]', 'Italique', '[i]Italique[/]'),
      row('[u]…[/]', 'Souligné', '[u]Souligné[/]'),
      row('[s]…[/]', 'Barré', '[s]Barré[/]'),
      row('[size=1.8]…[/]', 'Taille (0.5 à 3, en multiple de la taille du texte)', '[size=1.8]Grand[/] normal'),
      row('[big]…[/]', 'Taille 1.4', '[big]Gros[/] normal'),
      row('[small]…[/]', 'Taille 0.8', '[small]Petit[/] normal')
    ])

  + '<h3>Couleurs</h3>'
  + '<p>Une couleur nommée s\'écrit directement (<code>[red]</code>), ou par <code>[color=…]</code> qui accepte aussi '
  + '<code>#ff8800</code>, <code>rgb(…)</code> et <code>hsl(…)</code>.</p>'
  + render('[red]red[/] [orange]orange[/] [yellow]yellow[/] [green]green[/] [cyan]cyan[/] [blue]blue[/] '
    + '[purple]purple[/] [pink]pink[/] [white]white[/] [gold]gold[/] [gray]gray[/]')
  + demo('[color=#ff8800]Code hexadécimal[/] · [color=hsl(280,90%,70%)]hsl[/] · [glow=cyan]Lueur cyan[/] · [shadow]Ombre portée[/] · [outline]Contour[/]')
  + arrayHelp(['Balise', 'Effet', 'Rendu'], [
      row('[glow=couleur]…[/]', 'Halo lumineux autour des lettres (blanc sans couleur)', '[glow=gold]Trésor[/]'),
      row('[shadow]…[/]', 'Ombre portée', '[shadow]Ombre[/]'),
      row('[outline]…[/]', 'Contour noir, lisible sur un fond clair', '[outline][yellow]Contour[/][/]')
    ])

  + '<h3>Effets animés</h3>'
  + '<p>Chaque lettre est animée avec un léger décalage sur la précédente : le mot ondule au lieu de bouger d\'un bloc.</p>'
  + arrayHelp(['Balise', 'Effet', 'Rendu'], [
      row('[rainbow]', 'Arc-en-ciel qui défile', '[rainbow]Arc-en-ciel[/]'),
      row('[wave]', 'Vague verticale', '[wave]Vague[/]'),
      row('[shake]', 'Tremblement (peur, colère, choc)', '[shake]Tremble[/]'),
      row('[bounce]', 'Saut', '[bounce]Saute[/]'),
      row('[pulse]', 'Battement de taille', '[pulse]Pulse[/]'),
      row('[swing]', 'Balancement', '[swing]Balance[/]'),
      row('[sparkle]', 'Scintillement', '[sparkle]Scintille[/]'),
      row('[fire]', 'Flammes', '[fire]Brûlant[/]'),
      row('[ice]', 'Givre', '[ice]Glacial[/]'),
      row('[glitch]', 'Parasite numérique', '[glitch]ERREUR[/]'),
      row('[ghost]', 'Apparaît et disparaît', '[ghost]Fantôme[/]')
    ])
  + '<p>Les effets se combinent :</p>'
  + demo('[b][big][rainbow][wave]NIVEAU SUPÉRIEUR ![/][/][/][/]')
  + demo('[fire][shake]Le dragon rugit ![/][/]  [ice][swing]Brrr…[/][/]  [glitch][green]SYSTÈME COMPROMIS[/][/]')

  + '<h3>Machine à écrire</h3>'
  + '<p>Ajoutez <code>data-typewriter</code> à l\'élément : le texte s\'écrit à <b>45 lettres par seconde</b>, ou à la '
  + 'vitesse donnée (<code>data-typewriter="20"</code>). L\'écriture repart à chaque <b>nouvelle</b> valeur. '
  + 'Les points et les virgules marquent un temps d\'arrêt, et <code>[pause=0.8]</code> en ajoute un (en secondes, jusqu\'à 5).</p>'
  + '<pre><code>' + escapeHtml('<div class="bulle" data-bind-rich="dialogue" data-typewriter="30"></div>') + '</code></pre>'
  + demo('Le vieux sage hésite…[pause=0.8] puis murmure : [i][cyan]« Le [shake][red]dragon[/][/] s\'est réveillé. »[/][/]', 30)
  + tipHelp('Le rendu ci-dessus s\'est écrit à l\'ouverture de la page : rouvrez-la pour le revoir.')
  + '<p><b>Tout afficher d\'un coup</b> (le joueur appuie pour passer) : donnez à l\'élément la classe <code>rt-skip</code>, '
  + 'par exemple avec <code>data-bind-class</code>. Remettez-la à vide en même temps que le texte suivant.</p>'
  + '<pre><code>' + escapeHtml('<div data-bind-rich="ligne" data-typewriter data-bind-class="ligneFx"></div>') + '</code></pre>'
  + '<pre><code>ui.values.ligneFx = \'rt-skip\';   // fin immédiate\n'
  + 'ui.values.ligne = suivante; ui.values.ligneFx = \'\';   // ligne suivante, écrite normalement</code></pre>'

  + '<h3>Exemples de scripts</h3>'
  + '<p><b>Un dialogue qui avance au clic.</b> Le HTML : <code>&lt;div data-bind-rich="ligne" data-typewriter&gt;&lt;/div&gt;'
  + '&lt;button class="ui-button" data-event="suite"&gt;▶&lt;/button&gt;</code>.</p>'
  + '<pre><code>const LIGNES = [\n'
  + '  \'Bienvenue, [b][gold]aventurier[/][/] !\',\n'
  + '  \'La crypte est [shake][red]dangereuse[/][/]…[pause=0.5] reste sur tes gardes.\',\n'
  + '  \'[wave][cyan]Bonne chance ![/][/]\'\n'
  + '];\n'
  + 'let n = 0, depuis = 0;\n'
  + 'function start(api){\n'
  + '  const ui = api.uiDocument();\n'
  + '  ui.values.ligne = LIGNES[0];\n'
  + '  api.on(\'suite\', function(){\n'
  + '    // pas avant la fin de l\'écriture de la ligne en cours\n'
  + '    if (api.time - depuis &lt; api.richText.duration(LIGNES[n])) return;\n'
  + '    n = (n + 1) % LIGNES.length; depuis = api.time;\n'
  + '    ui.values.ligne = LIGNES[n];\n'
  + '  });\n'
  + '}</code></pre>'
  + '<p><b>Un journal de combat.</b> Des messages construits à la volée, avec la valeur au milieu :</p>'
  + '<pre><code>function toucher(api, cible, degats){\n'
  + '  api.uiDocument(api.find(\'HUD\')).values.journal =\n'
  + '    cible + \' perd [b][red]\' + degats + \' PV[/][/] !\';\n'
  + '}</code></pre>'
  + render('Gobelin perd [b][red]12 PV[/][/] ! · Héros regagne [b][green]8 PV[/][/] · Gobelin est [shake][red]K.O.[/][/]')
  + '<p><b>Le texte sans balises</b>, pour un journal écrit en console ou une comparaison :</p>'
  + '<pre><code>api.richText.strip(\'[b][red]12 PV[/][/]\');   // « 12 PV »</code></pre>'

  + '<h3>L\'objet <code>api.richText</code></h3>'
  + arrayHelp(['Appel', 'Rend'], [
      ['<code>api.richText.strip(texte)</code>', 'Le texte sans balises ni pauses.'],
      ['<code>api.richText.duration(texte, vitesse?)</code>', 'La durée de l\'écriture en secondes (vitesse en lettres/s, 45 par défaut), pauses comprises.'],
      ['<code>api.richText.toHtml(texte, vitesse?)</code>', 'Le HTML rendu, pour un élément que le script remplit lui-même.']
    ])

  + advancedHelp('Noms français et balises inconnues',
      '<p>Les noms français sont acceptés aussi : <code>[c=rouge]</code>, <code>[couleur=…]</code>, <code>[taille=…]</code>, '
    + '<code>[grand]</code>, <code>[petit]</code>, <code>[lueur]</code>, <code>[ombre]</code>, <code>[contour]</code>, '
    + '<code>[arc]</code>, <code>[vague]</code>, <code>[tremble]</code>, <code>[saut]</code>, <code>[balance]</code>, '
    + '<code>[scintille]</code>, <code>[feu]</code>, <code>[glace]</code>, <code>[fantome]</code>, et les couleurs '
    + '<code>rouge jaune vert bleu violet rose blanc or gris noir</code>.</p>'
    + '<p>Une balise que le moteur ne connaît pas <b>reste affichée telle quelle</b> : <code>[PNJ]</code> ou '
    + '<code>[x2]</code> dans un texte ne disparaissent pas.</p>'
    + render('Récompense [x2] pour [b]Lina[/] — [vague][c=or]bravo ![/][/]'))
  + advancedHelp('Sécurité et performances',
      '<p>Le HTML de la valeur est <b>échappé</b> : un pseudo saisi par le joueur comme <code>&lt;img …&gt;</code> '
    + 's\'affiche en texte, il n\'est jamais interprété. Le style passe uniquement par les balises entre crochets.</p>'
    + '<p>Chaque lettre devient un élément : réservez le texte riche aux phrases (dialogues, titres, journaux), pas à '
    + 'un compteur qui change 60 fois par seconde — pour un score, <code>data-bind</code> suffit.</p>')
  + trapHelp('Un même élément ne doit pas porter à la fois <code>data-bind</code> et <code>data-bind-rich</code> : '
    + 'les deux réécrivent son contenu, la dernière gagne.')
  + '<h3>Voir aussi</h3><ul>'
  + '<li>' + linkHelp('game-ui', 'L\'interface de jeu') + '</li>'
  + '<li>' + linkHelp('component-UIDocument', 'La fiche Interface (UI)') + '</li>'
  + '<li>' + linkHelp('scripts-api', 'L\'API de scripts') + '</li>'
  + '</ul>';
}};
