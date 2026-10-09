// ---------- Aide de l'éditeur : partie « scripting » ----------
// Une page = {id, part, section, title, level, summary, anchors, html}. Les ancres sont
// vérifiées par test/aide.test.mjs (voir l'en-tête de js/help-content.js).
import { advancedHelp, arrayHelp, essentialHelp, linkHelp, stepsHelp, termHelp, tipHelp, trapHelp } from './help-format.js';
import { renderApiHelp } from '../help-page.js';

export const PAGES_SCRIPTING = [

{id:'scripts', part:'scripting', section:'Scripts', title:'Écrire un script', level:'both',
 summary:'Créer un script, l\'attacher à un objet, et le régler depuis l\'inspecteur avec @expose.',
 anchors:[
   {f:'js/scripts.js', c:'(typeof start==="function")?start:null'},
   {f:'js/scripts.js', c:'(typeof update==="function")?update:null'},
   // L'ancre cite la CONDITION, plus la ligne entière : l'appel est enveloppé par
   // System.isolate, et une ancre qui recopie toute la ligne périme au moindre changement.
   {f:'js/viewport.js', c:'if(anim.playback || phys.active) System.isolate(\'Scripts\''},
   {f:'js/scripts.js', c:'engineScripts.snapshot.forEach(function(s){'},
   {f:'js/assets.js', c:'{kind: \'script\', label: \'📜 Script\','},
   {f:'js/components/component-script.js', c:'Une ligne mal formée est ignorée silencieusement.'},
   {f:'js/components/component-script.js', c:'/@expose\\s+(\\w+)\\s*\\{([^}]+)\\}(?:\\s*=\\s*(.+))?/'}
 ],
 html:function(){ return ''
  + essentialHelp('<p>Un script est un ' + termHelp('Asset') + ' de JavaScript ordinaire. On le '
    + 'crée dans le panneau Projet, on le pose sur un objet, et il définit une fonction '
    + '<code>start(api)</code>, une fonction <code>update(api)</code>, ou les deux. Tout ce qu\'il '
    + 'peut faire passe par l\'objet ' + linkHelp('scripts-api', '<code>api</code>') + '.</p>')

  + '<h3>Créer et attacher un script</h3>'
  + stepsHelp([
      'Dans le ' + linkHelp('panel-project', 'panneau Projet') + ', cliquez <b>＋ Créer</b> puis '
        + '<b>📜 Script</b>. L\'éditeur de code s\'ouvre sur le nouveau script.',
      'Sélectionnez l\'objet qui doit porter le comportement. Dans l\''
        + linkHelp('panel-inspector', 'inspecteur') + ', cliquez <b>+ Composant</b> et choisissez '
        + '<b>Script</b>.',
      'Dans le champ <b>Script 1</b>, choisissez votre script dans la liste — ou glissez-le depuis '
        + 'le panneau Projet. Le bouton <b>✎ Éditer…</b> rouvre son code.',
      'Lancez : <b>Jouer</b> dans la barre du haut, ou <kbd>Espace</kbd> pour la lecture dans '
        + 'l\'éditeur. Voir ' + linkHelp('play-mode', 'le mode jeu') + '.'
    ])
  + tipHelp('Glisser un script du panneau Projet directement sur un objet de la scène l\'attache '
    + 'aussi. Le script est <b>référencé</b>, pas recopié : le modifier change tous les objets '
    + 'qui le portent.')

  + '<h3>La forme d\'un script</h3>'
  + '<p>Le niveau supérieur du fichier s\'exécute <b>une seule fois</b>, à la compilation : c\'est '
  + 'là qu\'on déclare ses variables. Le détail de quand chaque fonction est appelée est sur la '
  + 'page ' + linkHelp('scripts-lifecycle', 'Cycle de vie') + '.</p>'
  + '<pre><code>let vitesse = 3;                 // une seule fois\n'
  + '\n'
  + 'function start(api){            // au premier pas de la partie\n'
  + '  api.log(\'départ de \' + api.me.name);\n'
  + '}\n'
  + '\n'
  + 'function update(api){           // à chaque image\n'
  + '  api.me.position.x += vitesse * api.dt;\n'
  + '}</code></pre>'
  + '<p><b>Multipliez toujours par <code>api.dt</code></b> ce qui doit avancer d\'une quantité '
  + 'par seconde. Sans ça, la vitesse dépend de la fréquence d\'affichage de la machine.</p>'

  + '<h3>Un objet peut porter plusieurs scripts</h3>'
  + '<p>Ils s\'exécutent tous, dans l\'ordre du panneau. Pour <b>corriger</b> un script, '
  + 'modifiez-le ou remplacez-le : en attacher un second laisse tourner les deux, qui se '
  + 'disputent alors la même position.</p>'

  + '<h3>Régler un script sans le rouvrir : <code>@expose</code></h3>'
  + '<p>Une ligne de commentaire dans le script fabrique un champ dans l\'inspecteur. La valeur '
  + 'se lit dans <code>api.expose</code>, et elle est enregistrée avec l\'objet — deux ennemis '
  + 'peuvent donc partager le même script avec des vitesses différentes.</p>'
  + '<pre><code>/**\n'
  + ' * @expose vitesse {number} = 3\n'
  + ' * @expose couleur {color} = #ff0000\n'
  + ' * @expose active {boolean} = true\n'
  + ' */\n'
  + 'function update(api){\n'
  + '  if(!api.expose.active) return;\n'
  + '  api.me.position.x += api.expose.vitesse * api.dt;\n'
  + '}</code></pre>'
  + '<p>Types acceptés : <code>number</code>, <code>string</code>, <code>boolean</code>, '
  + '<code>color</code>, <code>node</code>, <code>component:X</code>.</p>'
  + trapHelp('<b>Une ligne <code>@expose</code> mal formée est ignorée en silence.</b> Pas de '
    + 'champ, pas d\'erreur, pas de message dans la Console. Les accolades autour du type sont '
    + 'obligatoires : <code>@expose vitesse {number} = 3</code>, et non '
    + '<code>@expose vitesse number = 3</code>.')

  + '<h3>Les pages de cette partie</h3>'
  + arrayHelp(['Page', 'Pour'], [
      [linkHelp('scripts-lifecycle', 'Cycle de vie'), 'Quand <code>start</code> et <code>update</code> sont appelés, et ce qui est restauré à l\'arrêt'],
      [linkHelp('scripts-input', 'Entrées'), 'Clavier, souris, tactile, manette'],
      [linkHelp('scripts-components', 'Composants'), 'Lire et modifier les composants d\'un objet'],
      [linkHelp('scripts-events', 'Événements et scènes'), 'Faire parler les scripts entre eux, changer de scène'],
      [linkHelp('scripts-debug', 'Déboguer'), 'Console, erreurs, rechargement à chaud'],
      [linkHelp('scripts-api', 'L\'objet api'), 'Le catalogue complet']
    ])

  + advancedHelp('Le code d\'un projet qu\'on n\'a pas écrit',
      '<p>À l\'ouverture d\'un projet dont les scripts ne sont pas encore approuvés sur cette '
      + 'machine, l\'éditeur demande avant de les exécuter (<b>Exécuter les scripts</b> / '
      + '<b>Ne pas exécuter</b>). Un script peut agir sur le navigateur, pas seulement sur la '
      + 'scène. Voir ' + linkHelp('troubleshooting', 'Dépannage') + '.</p>')

  + '<h3>Voir aussi</h3><p>' + linkHelp('tuto-first-game-3d', 'Tutoriel : un premier jeu 3D')
  + ' · ' + linkHelp('component-ScriptJS', 'Fiche du composant Script') + '</p>';
}},

{id:'scripts-lifecycle', part:'scripting', section:'Scripts', title:'Cycle de vie d\'un script', level:'both',
 summary:'Ce que le moteur appelle réellement, dans quel ordre, et ce qu\'il remet en place à l\'arrêt.',
 anchors:[
   {f:'js/scripts.js', c:'if(!demarresObj.has(i)){'},
   {f:'js/scripts.js', c:'if(!isSceneObject(o) || !isActiveInHierarchy(o)) return;'},
   {f:'js/scripts.js', c:'engineScripts.state = {};'},
   {f:'js/scripts.js', c:'export function stopScripts(){'},
   {f:'js/game-runtime.js', c:'\'\\nreturn {start:(typeof start==="function")?start:null,\''}
 ],
 html:function(){ return ''
  + essentialHelp('<p>Le moteur ne connaît que <b>deux</b> fonctions : <code>start(api)</code>, '
    + 'appelée une fois, et <code>update(api)</code>, appelée à chaque image. Il n\'existe ni '
    + '<code>onDestroy</code>, ni <code>fixedUpdate</code>, ni <code>onEnable</code> : une '
    + 'fonction de ce nom est ignorée sans message.</p>')

  + '<h3>L\'ordre réel</h3>'
  + stepsHelp([
      '<b>Compilation</b> — au premier passage, le niveau supérieur du script s\'exécute une fois. '
        + 'Les variables déclarées là vivent toute la partie.',
      '<b><code>start(api)</code></b> — appelé une seule fois, juste avant le premier '
        + '<code>update</code> de ce script sur cet objet.',
      '<b><code>update(api)</code></b> — à chaque image, tant que l\'objet est dans la scène et '
        + '<b>actif</b> (lui et tous ses parents).',
      '<b>Après tous les scripts</b> — les minuteries <code>api.after</code> échues sont '
        + 'appelées, puis les objets demandés par <code>api.destroy</code> sont supprimés, puis '
        + 'un <code>api.changeScene</code> éventuel est appliqué.'
    ])
  + '<pre><code>let tours = 0;              // compilation : une fois\n'
  + '\n'
  + 'function start(api){\n'
  + '  api.log(\'prêt\');         // une fois\n'
  + '}\n'
  + '\n'
  + 'function update(api){\n'
  + '  tours++;                  // chaque image\n'
  + '  if(tours === 60) api.log(\'une seconde à 60 i/s\');\n'
  + '}</code></pre>'

  + '<h3>Quand les scripts tournent</h3>'
  + arrayHelp(['Situation', 'Les scripts tournent ?'], [
      ['Édition (rien de lancé)', 'Non'],
      ['Lecture de la timeline (<kbd>Espace</kbd>)', 'Oui, dans la vue de l\'éditeur'],
      ['<b>Affichage → ⚛ Simulation physique seule</b>', 'Oui, avec la physique'],
      ['<b>Jouer</b> (onglet de jeu) et les builds', 'Oui — c\'est le vrai jeu']
    ])
  + trapHelp('<b>Rien de ce que fait un script dans l\'éditeur n\'est enregistré.</b> À l\'arrêt, '
    + 'la position, la rotation et l\'échelle des objets scriptés sont restaurées, et '
    + '<code>api.state</code> repart vide au lancement suivant.')

  + '<h3>Désactiver plutôt que détruire</h3>'
  + '<p><code>api.setActive(objet, false)</code> masque l\'objet <b>et</b> arrête ses scripts '
  + 'et ceux de ses enfants. <code>api.destroy(objet)</code> le retire à la fin de l\'image en '
  + 'cours : son <code>update</code> de cette image a déjà eu lieu.</p>'

  + advancedHelp('Un script par objet et par position',
      '<p>« Déjà démarré » est retenu par objet <b>et</b> par numéro de script. Un même script posé '
      + 'sur dix objets reçoit dix <code>start</code>, un par porteur, et chaque porteur a son '
      + 'propre <code>api</code>. Les variables de niveau supérieur, elles, sont celles de la '
      + 'compilation de CE porteur : elles ne sont pas partagées entre objets. Pour partager, '
      + 'utilisez <code>api.state</code> ou ' + linkHelp('scripts-events', 'les événements') + '.</p>')

  + '<h3>Voir aussi</h3><p>' + linkHelp('scripts', 'Écrire un script') + ' · '
  + linkHelp('scripts-debug', 'Déboguer un script') + '</p>';
}},

{id:'scripts-input', part:'scripting', section:'Scripts', title:'Entrées : clavier, souris, tactile, manette', level:'both',
 summary:'Lire les touches, la souris, le doigt et la manette, de préférence par la table d\'entrées.',
 anchors:[
   {f:'js/scripts.js', c:'advance:  [\'z\', \'w\', \'ArrowUp\', \'pad:12\'],'},
   {f:'js/scripts.js', c:'horizontal: [\'left\', \'right\', \'pad:axis0\'],'},
   {f:'js/scripts.js', c:'keysGame.add(normalizeKey(e.key))'},
   {f:'js/scripts.js', c:'clickHeld: function(button){'},
   {f:'js/scripts.js', c:'touchAxis: function(name){ return touchAxis(name); },'},
   {f:'js/ui.js', c:'{label:\'Entrées (Input Map)…\''}
 ],
 html:function(){ return ''
  + essentialHelp('<p>Préférez les <b>actions</b> et les <b>axes</b> de la table d\'entrées '
    + '(<code>api.action</code>, <code>api.actionPressed</code>, <code>api.axis</code>) aux '
    + 'touches brutes : une action réunit clavier AZERTY, QWERTY, flèches, manette et contrôles '
    + 'tactiles, et le joueur peut la réassigner.</p>')

  + '<h3>La table d\'entrées par défaut</h3>'
  + '<p>Elle se règle dans <b>Fichier → Entrées (Input Map)…</b>.</p>'
  + arrayHelp(['Action', 'Touches et boutons'], [
      ['<code>advance</code>', '<kbd>Z</kbd> <kbd>W</kbd> <kbd>↑</kbd>, croix haut de la manette'],
      ['<code>back</code>', '<kbd>S</kbd> <kbd>↓</kbd>, croix bas'],
      ['<code>left</code>', '<kbd>Q</kbd> <kbd>A</kbd> <kbd>←</kbd>, croix gauche'],
      ['<code>right</code>', '<kbd>D</kbd> <kbd>→</kbd>, croix droite'],
      ['<code>jump</code>', '<kbd>Espace</kbd>, bouton 0 (A / Croix)'],
      ['<code>interact</code>', '<kbd>E</kbd>, bouton 2']
    ])
  + '<p>Deux axes : <code>horizontal</code> (<code>left</code> → −1, <code>right</code> → +1, '
  + 'stick gauche) et <code>vertical</code> (<code>back</code> → −1, <code>advance</code> → +1).</p>'
  + '<pre><code>function update(api){\n'
  + '  const x = api.axis(\'horizontal\');        // −1 à 1, clavier + manette + doigt\n'
  + '  api.me.position.x += x * 4 * api.dt;\n'
  + '  if(api.actionPressed(\'jump\')) api.log(\'saut !\');   // une fois par appui\n'
  + '}</code></pre>'

  + '<h3>Le clavier brut</h3>'
  + '<p><code>api.key(k)</code> reçoit le nom de touche du navigateur : <code>\'ArrowLeft\'</code>, '
  + '<code>\' \'</code> pour Espace, <code>\'Shift\'</code>… Les lettres sont ramenées en '
  + '<b>minuscules</b> : écrivez <code>api.key(\'a\')</code>, jamais <code>\'A\'</code>.</p>'

  + '<h3>La souris</h3>'
  + arrayHelp(['Appel', 'Rend'], [
      ['<code>api.mouse()</code>', '<code>{x, y}</code> de −1 à +1, origine au centre de la vue, y vers le haut — plus <code>px</code>, <code>py</code> en pixels'],
      ['<code>api.click(b)</code>', 'Vrai <b>tant que</b> le bouton est enfoncé (0 gauche, 1 molette, 2 droit)'],
      ['<code>api.clickHeld(b)</code>', 'Vrai seulement à l\'image où le bouton <b>vient d\'être</b> pressé — malgré son nom'],
      ['<code>api.mouseDelta()</code>', 'Le déplacement depuis l\'image précédente, pour une vue à la première personne'],
      ['<code>api.lockMouse()</code> / <code>api.mouseLocked()</code>', 'Capture le pointeur (vue FPS)'],
      ['<code>api.pick(filtre?)</code>', 'Ce qui est sous le pointeur, par un rayon depuis la caméra du jeu']
    ])
  + '<pre><code>function update(api){\n'
  + '  if(api.clickHeld(0)){\n'
  + '    const vu = api.pick();\n'
  + '    if(vu) api.log(\'cliqué : \' + vu.object.name);\n'
  + '  }\n'
  + '}</code></pre>'

  + '<h3>Tactile et manette</h3>'
  + '<p>Les contrôles tactiles se posent avec le composant '
  + linkHelp('component-TouchControls', 'Contrôles tactiles') + ' ; '
  + '<code>api.touchAxis(nom)</code> lit son joystick, mais <code>api.axis</code> le combine déjà. '
  + 'Pour la manette : <code>api.padAxis(nom)</code> (valeur analogique), '
  + '<code>api.gamepads()</code> (nombre de manettes branchées) et '
  + '<code>api.rumble(force, ms)</code>, qui rend <code>false</code> quand le matériel ne sait pas '
  + 'vibrer.</p>'
  + tipHelp('Les boutons de la manette sont des « touches » ordinaires de la table d\'entrées '
    + '(<code>pad:0</code>, <code>pad:12</code>…) : rien à écrire de plus dans le script.')

  + advancedHelp('Pourquoi une touche reste « collée »',
      '<p>Quand une zone de saisie (champ de l\'inspecteur, éditeur de code) a le focus, les '
      + 'touches ne vont pas au jeu. Quand la fenêtre perd le focus, toutes les touches et '
      + 'boutons sont relâchés. Cliquez dans la vue avant de tester au clavier.</p>')

  + '<h3>Voir aussi</h3><p>' + linkHelp('scripts-api', 'L\'objet api') + ' · '
  + linkHelp('settings', 'Paramètres') + '</p>';
}},

{id:'scripts-components', part:'scripting', section:'Scripts', title:'Lire et modifier des composants', level:'advanced',
 summary:'getComponent, addComponent et removeComponent sur un objet, et les raccourcis de l\'api.',
 anchors:[
   {f:'js/node.js', c:'o.getComponent = function (typeName) {'},
   {f:'js/node.js', c:'o.addComponent = function (typeName, data) {'},
   {f:'js/node.js', c:'o.removeComponent = function (instance) {'},
   {f:'js/scripts.js', c:'node: o,'},
   {f:'js/scripts.js', c:'props: function(target){ return ensureGame(target || o).props; },'},
   {f:'js/inspector.js', c:'export const COMPONENT_LABELS = {'}
 ],
 html:function(){ return ''
  + essentialHelp('<p><code>api.me</code> (ou son alias <code>api.node</code>) est l\'objet de la '
    + 'scène. Il porte <code>getComponent(type)</code>, <code>getComponents(type?)</code>, '
    + '<code>addComponent(type, réglages?)</code> et <code>removeComponent(instance)</code>. Le '
    + 'type est le nom <b>anglais</b> du composant (<code>\'CameraFollow\'</code>, '
    + '<code>\'Light\'</code>…), pas son libellé à l\'écran.</p>')

  + '<h3>Lire un composant</h3>'
  + '<pre><code>function start(api){\n'
  + '  const cam = api.find(\'Caméra\');\n'
  + '  const suivi = cam.getComponent(\'CameraFollow\');\n'
  + '  if(suivi) suivi.targetName = api.me.name;   // la caméra suit cet objet\n'
  + '}</code></pre>'
  + trapHelp('<code>getComponent</code> rend <code>null</code> quand l\'objet n\'a pas ce '
    + 'composant — et un nom mal tapé (<code>\'Camera Follow\'</code>, '
    + '<code>\'Suivi de caméra\'</code>) rend aussi <code>null</code>, sans erreur. Le nom exact '
    + 'de chaque type est en tête de sa fiche dans la partie Composants.')

  + '<h3>Libellé à l\'écran, nom dans le code</h3>'
  + arrayHelp(['Dans l\'inspecteur', 'Dans le code'], [
      ['Physique', '<code>Physics</code> — ' + linkHelp('component-Physics', 'fiche')],
      ['Collider', '<code>Collider</code> — ' + linkHelp('component-Collider', 'fiche')],
      ['Suivi de caméra', '<code>CameraFollow</code> — ' + linkHelp('component-CameraFollow', 'fiche')],
      ['Source audio', '<code>AudioSource</code> — ' + linkHelp('component-AudioSource', 'fiche')],
      ['Machine à états', '<code>AnimatorController</code> — ' + linkHelp('component-AnimatorController', 'fiche')],
      ['Corps rigide 2D', '<code>Rigidbody2D</code> — ' + linkHelp('component-Rigidbody2D', 'fiche')],
      ['Script', '<code>ScriptJS</code> — ' + linkHelp('component-ScriptJS', 'fiche')]
    ])

  + '<h3>Les raccourcis de l\'api</h3>'
  + '<p>Pour les composants les plus courants, l\'api a déjà la bonne entrée — elle avertit dans '
  + 'la Console au lieu de planter quand le composant manque :</p>'
  + arrayHelp(['Entrée', 'Composant piloté'], [
      ['<code>api.animator(cible?)</code>', linkHelp('component-AnimatorController', 'Machine à états') + ' — voir ' + linkHelp('animator', 'Animator')],
      ['<code>api.audio(cible?)</code>', linkHelp('component-AudioSource', 'Source audio')],
      ['<code>api.particles(cible?)</code>', linkHelp('component-Particles', 'Particules')],
      ['<code>api.uiDocument(cible?)</code>', linkHelp('component-UIDocument', 'Interface (UI)')],
      ['<code>api.setVelocity</code>, <code>api.applyForce</code>', linkHelp('component-Physics', 'Physique')],
      ['<code>api.tileAt</code>, <code>api.setTile</code>', linkHelp('component-Tilemap', 'Tilemap')]
    ])

  + '<h3>Propriétés de jeu et tag</h3>'
  + '<p><code>api.props(cible?)</code> rend le sac de propriétés libres de l\'objet, et '
  + '<code>api.tag(cible?)</code> son ' + termHelp('Tag') + '. Les valeurs <code>@expose</code> '
  + 'du script courant sont dans <code>api.expose</code>.</p>'

  + advancedHelp('Ajouter un composant en cours de partie',
      '<p><code>api.me.addComponent(\'Light\')</code> crée le composant et l\'enregistre auprès du '
      + 'moteur ; un type inconnu lève une erreur « Composant inconnu ». Comme tout ce que fait un '
      + 'script dans l\'éditeur, ce n\'est pas enregistré dans le projet.</p>')

  + '<h3>Voir aussi</h3><p>' + linkHelp('scripts-api', 'L\'objet api') + ' · '
  + linkHelp('panel-inspector', 'L\'inspecteur') + '</p>';
}},

{id:'scripts-events', part:'scripting', section:'Scripts', title:'Événements, contacts et changement de scène', level:'both',
 summary:'Faire communiquer les scripts, réagir à un contact, attendre, et passer d\'une scène à l\'autre.',
 anchors:[
   {f:'js/scripts.js', c:'emit: function(name, data){'},
   {f:'js/scripts.js', c:'on: function(name, fn){'},
   {f:'js/scripts.js', c:'try{ c.fn(autre); }'},
   {f:'js/scripts.js', c:'engineScripts.sceneDemandee = i;'},
   {f:'js/scripts.js', c:'get state(){ return engineScripts.state; },'}
 ],
 html:function(){ return ''
  + essentialHelp('<p>Un script en prévient un autre avec <code>api.emit(nom, données)</code> ; '
    + 'l\'autre écoute avec <code>api.on(nom, fn)</code>. Un contact se guette avec '
    + '<code>api.onContact(tag, fn)</code>. Le score et la progression vont dans '
    + '<code>api.state</code>, seul à survivre à <code>api.changeScene(nom)</code>.</p>')

  + '<h3>Messages entre scripts</h3>'
  + '<pre><code>// Sur le joueur\n'
  + 'function update(api){\n'
  + '  if(api.actionPressed(\'interact\')) api.emit(\'porte\', {par: api.me.name});\n'
  + '}\n'
  + '\n'
  + '// Sur la porte\n'
  + 'function start(api){\n'
  + '  api.on(\'porte\', function(d){ api.log(\'ouverte par \' + d.par); });\n'
  + '}</code></pre>'
  + tipHelp('Abonnez-vous dans <code>start</code>, pas dans <code>update</code> : chaque appel à '
    + '<code>api.on</code> ajoute un écouteur, et soixante par seconde feraient réagir soixante '
    + 'fois au même message.')
  + '<p><code>api.on</code> reçoit aussi les clics d\'une interface de jeu (élément '
  + '<code>data-event</code> d\'un ' + linkHelp('component-UIDocument', 'document UI') + ').</p>'

  + '<h3>Contacts</h3>'
  + '<p><code>api.onContact(tag, fn)</code> appelle <code>fn(autre)</code> une fois, à '
  + '<b>l\'entrée</b> en contact avec un objet portant ce ' + termHelp('Tag') + ' — les boîtes '
  + 'englobantes se chevauchent. Aucun corps physique n\'est nécessaire.</p>'
  + '<pre><code>function start(api){\n'
  + '  api.onContact(\'piece\', function(piece){\n'
  + '    api.destroy(piece);\n'
  + '    api.state.score = (api.state.score || 0) + 1;\n'
  + '  });\n'
  + '}</code></pre>'
  + '<p>En 2D, <code>api.overlaps2d(a, b)</code> teste un chevauchement à la demande ; voir '
  + linkHelp('collisions-2d', 'les collisions 2D') + '.</p>'

  + '<h3>Attendre</h3>'
  + '<p><code>api.after(secondes, fn)</code> appelle <code>fn</code> une fois le délai écoulé, '
  + 'mesuré en temps de jeu.</p>'

  + '<h3>Changer de scène</h3>'
  + '<pre><code>function update(api){\n'
  + '  if(api.state.score &gt;= 10) api.changeScene(\'Niveau 2\');\n'
  + '}</code></pre>'
  + trapHelp('<b>Les propriétés des objets ne traversent pas un changement de scène</b> : la '
    + 'scène suivante est chargée telle qu\'elle a été enregistrée. Seul <code>api.state</code> '
    + 'traverse. <code>api.save()</code> l\'écrit sur la machine du joueur, '
    + '<code>api.load()</code> le relit. Un nom de scène inconnu ne fait qu\'avertir dans la '
    + 'Console.')

  + advancedHelp('Événements visuels sans code',
      '<p>Le composant ' + linkHelp('component-Events', 'Événements') + ' pose des règles '
      + '« Quand… Alors… » sans écrire de script : entrée dans une zone, montrer un objet, jouer '
      + 'un son, changer de scène.</p>')

  + '<h3>Voir aussi</h3><p>' + linkHelp('scenes', 'Les scènes') + ' · '
  + linkHelp('scripts-lifecycle', 'Cycle de vie') + '</p>';
}},

{id:'scripts-debug', part:'scripting', section:'Scripts', title:'Déboguer un script', level:'both',
 summary:'Écrire dans la Console, lire une erreur, trouver une faute de frappe, et profiter du rechargement à chaud.',
 anchors:[
   {f:'js/console.js', c:'export function logConsole(level, msg, obj, indexScript){'},
   {f:'js/scripts.js', c:'logConsole(\'error\', \'compilation (script \' + (i + 1) + \') : \' + err.message, o, i);'},
   {f:'js/scripts.js', c:'if(now - r.at >= 1000){'},
   {f:'js/scripts.js', c:'if(c && c.source === code) return c.error ? null : c;'},
   {f:'js/ui.js', c:'{label:\'🔍 Analyser la scène\', action:openAnalysisScene},'}
 ],
 html:function(){ return ''
  + essentialHelp('<p><code>api.log</code>, <code>api.warn</code> et <code>api.error</code> écrivent '
    + 'dans la ' + linkHelp('panel-console', 'Console') + ', avec le nom de l\'objet. Une erreur de '
    + 'script y arrive aussi, avec le numéro du script, et la barre d\'état affiche « Erreur de '
    + 'script sur … — voir la Console ».</p>')

  + '<h3>Écrire dans la Console</h3>'
  + '<pre><code>function update(api){\n'
  + '  if(api.actionPressed(\'jump\')) api.log(\'y = \' + api.me.position.y.toFixed(2));\n'
  + '}</code></pre>'
  + '<p><code>api.status(texte)</code> affiche un message bref dans la barre d\'état de l\'éditeur.</p>'
  + tipHelp('Ne loguez pas à chaque image : soixante lignes par seconde noient l\'information. '
    + 'Loguez sur un appui, un contact, un changement d\'état.')

  + '<h3>Les deux sortes d\'erreurs</h3>'
  + arrayHelp(['Erreur', 'Ce qui se passe'], [
      ['<b>Compilation</b> (faute de syntaxe)', 'Message « compilation (script N) » ; ce script ne tourne pas du tout, les autres oui.'],
      ['<b>Exécution</b> (variable inexistante, <code>null</code>…)', 'Message « (script N) … » ; le script continue d\'être appelé à chaque image. Une erreur répétée est regroupée : au plus une ligne par seconde, avec le compte <code>(×N)</code>.']
    ])
  + stepsHelp([
      'Ouvrez la Console (panneau du bas) et lisez le nom de l\'objet et le numéro du script.',
      'Cliquez <b>✎ Éditer…</b> sur ce script dans l\'inspecteur.',
      'Pour tout vérifier sans rien lancer : <b>Édition → 🔍 Analyser la scène</b>, qui compile '
        + 'tous les scripts.'
    ])

  + '<h3>Rechargement à chaud</h3>'
  + '<p>Le code d\'un script est relu à chaque image. Modifiez-le pendant une lecture '
  + '(<kbd>Espace</kbd>) ou une simulation : <b>tous</b> les objets qui le portent sont recompilés '
  + 'à l\'image suivante, sans relancer.</p>'
  + trapHelp('Après un rechargement à chaud, <code>start</code> n\'est <b>pas</b> rappelé (le '
    + 'script est déjà démarré sur cet objet), mais le niveau supérieur est réexécuté : les '
    + 'variables qui y sont déclarées repartent de leur valeur initiale. Arrêtez et relancez pour '
    + 'un départ propre.')

  + advancedHelp('Pièges silencieux fréquents',
      '<ul><li>Écrire <code>.position</code> d\'un objet qui a un corps rigide : la physique '
      + 'l\'efface à l\'image suivante. Utilisez <code>api.setPosition</code>.</li>'
      + '<li>Écrire des degrés dans <code>rotation</code> : le script travaille en radians.</li>'
      + '<li>Une ligne <code>@expose</code> sans accolades : aucun champ, aucun message.</li>'
      + '<li><code>api.groundHeight</code> : éditeur seulement, absente du jeu publié.</li></ul>')

  + '<h3>Voir aussi</h3><p>' + linkHelp('troubleshooting', 'Dépannage') + ' · '
  + linkHelp('scripts-api', 'L\'objet api') + '</p>';
}},

{id:'scripts-api', part:'scripting', section:'Scripts', title:'L\'objet api', level:'both',
 summary:'Le catalogue complet de ce qu\'un script peut appeler, et le repère des transformations.',
 anchors:[
   {f:'js/scripts.js', c:'function apiFor(o, dt, i){'},
   {f:'js/help-content.js', c:'export const API_HELP = ['},
   // Les degrés de l'inspecteur contre les radians du script : la conversion n'existe QUE
   // dans le champ de l'inspecteur, et c'est tout le piège de la section rotation.
   {f:'js/inspector.js', c:'set: function(o, v){ o.rotation.set(v[0] * Math.PI / 180'},
   {f:'js/physics.js', c:'l.obj.quaternion.copy(_wq);'},
   {f:'js/physics.js', c:'l.obj.getWorldQuaternion(_wq);'}
 ],
 html:function(){ return ''
  + essentialHelp('<p>Tout ce qu\'un script peut faire passe par l\'objet <code>api</code> qu\'il '
    + 'reçoit en paramètre. Le tableau ci-dessous est engendré depuis le catalogue de l\'aide, '
    + 'lui-même vérifié contre le moteur : une entrée qui n\'y figure pas n\'existe pas.</p>')
  + renderApiHelp()

  + trapHelp('<b>Écrire dans <code>.position</code> d\'un corps rigide ne sert à rien.</b> La '
    + 'physique écrit CORPS → objet et jamais l\'inverse : votre valeur est effacée à l\'image '
    + 'suivante, sans erreur. Pour téléporter un objet qui a un corps rigide, utilisez '
    + '<code>api.setPosition(objet, {x, y, z})</code>, qui déplace le corps et remet sa vitesse à '
    + 'zéro.')
  + trapHelp('<b>Les propriétés d\'objets ne survivent pas à un changement de scène.</b> Le score, '
    + 'les vies, l\'inventaire et la progression vont dans <code>api.state</code>. '
    + '<code>api.save()</code> le persiste sur la machine du joueur.')

  + '<h3>Déplacer, tourner, redimensionner : <code>api.me</code></h3>'
  + '<p><code>api.me</code> est l\'objet three.js lui-même : il n\'existe ni '
  + '<code>api.setRotation</code> ni <code>api.me.setRotation</code>. On écrit dans ses champs, '
  + 'et on peut appeler n\'importe quelle méthode d\'<code>Object3D</code>.</p>'
  + arrayHelp(['Champ', 'Ce qu\'il contient'], [
      ['<code>api.me.position</code>',
       'Un <code>Vector3</code> en <b>mètres</b>, <b>relatif au parent</b>. Pour un objet à la '
       + 'racine de la scène, parent et monde coïncident.'],
      ['<code>api.me.rotation</code>',
       'Un <code>Euler</code> en <b>RADIANS</b>, ordre <code>XYZ</code>. L\'inspecteur affiche '
       + 'des degrés, le script non : écrivez <code>THREE.MathUtils.degToRad(90)</code> ou '
       + '<code>Math.PI / 2</code>, jamais <code>90</code>.'],
      ['<code>api.me.quaternion</code>',
       'La même orientation, sous la forme qui s\'interpole sans blocage de cardan. Écrire dans '
       + 'l\'un met l\'autre à jour.'],
      ['<code>api.me.scale</code>',
       'Un <b>multiplicateur</b>, pas une taille. ' + linkHelp('units', 'Voir les unités')
       + ' — et <code>api.bounds()</code> pour la dimension réelle.']
    ])
  + '<h4>Repère local, repère monde</h4>'
  + arrayHelp(['Appel', 'Dans quel repère'], [
      ['<code>api.me.rotateX/Y/Z(rad)</code>',
       '<b>Local</b>, et <b>cumulatif</b> : un appel par image fait tourner en continu.'],
      ['<code>api.me.rotateOnWorldAxis(axe, rad)</code>',
       'Autour d\'un axe lu dans le <b>monde</b> (axe normalisé).'],
      ['<code>api.me.translateZ(d)</code>',
       'Avance sur son propre axe. Le devant d\'un objet ordinaire est son <b>+Z</b> — l\'axe '
       + 'qu\'<code>api.lookAt</code> pointe vers la cible. Une caméra et une lumière regardent '
       + 'leur <b>−Z</b>.'],
      ['<code>api.me.getWorldPosition(api.V3())</code>',
       'La position <b>monde</b>, parents compris.'],
      ['<code>api.me.getWorldDirection(api.V3())</code>',
       'Le +Z de l\'objet dans le monde : la direction regardée, prête pour '
       + '<code>api.raycast</code>.']
    ])
  + '<pre><code>function update(api){\n'
  + '  api.me.rotateY(1.2 * api.dt);            // tourne sur soi\n'
  + '  api.me.translateZ(3 * api.dt);           // avance devant soi\n'
  + '  const devant = api.me.getWorldDirection(api.V3());\n'
  + '  const vu = api.raycast(api.me.getWorldPosition(api.V3()), devant, 10);\n'
  + '}</code></pre>'
  + trapHelp('<b>Un corps rigide efface aussi la rotation</b> : la physique écrit '
    + '<code>.rotation</code> et <code>.quaternion</code> à chaque image. Un objet animé par la '
    + 'timeline est au contraire ' + termHelp('Cinématique') + ' : son corps suit l\'objet.')

  + '<h3>Voir aussi</h3><p>' + linkHelp('scripts', 'Écrire un script') + ' · '
  + linkHelp('scripts-input', 'Entrées') + ' · ' + linkHelp('scripts-components', 'Composants')
  + ' · ' + linkHelp('physics', 'Physique') + '</p>';
}}

];
