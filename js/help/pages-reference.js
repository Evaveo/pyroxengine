// ---------- Aide de l'éditeur : partie « reference » ----------
// Une page = {id, part, section, title, level, summary, anchors, html}. Les ancres sont
// vérifiées par test/aide.test.mjs (voir l'en-tête de js/help-content.js). Le glossaire
// (id 'glossary') est ajouté par help-content.js : ne pas le recréer ici.
import { advancedHelp, arrayHelp, essentialHelp, linkHelp, tipHelp, trapHelp } from './help-format.js';
import { renderCommandsHelp } from '../help-page.js';
// Circulaire, et sans danger : COMMANDS_HELP n'est lu qu'au rendu de la page.
import { COMMANDS_HELP } from '../help-content.js';

export const PAGES_REFERENCE = [

{id:'reference-commands', part:'reference', section:'Référence', title:'Commandes du copilote (MCP)', level:'advanced',
 summary:'La liste complète des commandes que le copilote IA et les clients MCP peuvent appeler.',
 anchors:[
   {f:'js/help-page.js', c:'export function renderCommandsHelp(){'},
   {f:'js/copilot-observer.js', c:'name: \'play_and_measure\','},
   {f:'js/copilot-workshop.js', c:'name: \'checkpoint\','}
 ],
 html:function(){ return ''
  + essentialHelp('<p>Le copilote IA agit sur le projet par des <b>commandes</b> nommées, les '
    + 'mêmes que celles qu\'un client MCP externe peut appeler. Il y en a '
    + COMMANDS_HELP.length + ', listées ci-dessous. Le tableau est engendré depuis le catalogue '
    + 'de l\'aide, vérifié contre le moteur.</p>')

  + '<h3>Celles qu\'il faut connaître</h3>'
  + arrayHelp(['Commande', 'À quoi elle sert'], [
      ['<code>summarize_scene</code>', 'Se repérer : un résumé compact du projet.'],
      ['<code>capture_view</code>', 'Voir : une image de la vue d\'édition.'],
      ['<code>play_and_measure</code>', 'Vérifier : lance le vrai jeu et relève les positions au fil du temps. C\'est la seule qui dise si le jeu fonctionne.'],
      ['<code>check</code>', 'Contrôler les chiffres : rapport pixel des caméras, boîtes de collision.'],
      ['<code>checkpoint</code> / <code>go_back</code>', 'Poser un point de reprise avant un essai, et y revenir.'],
      ['<code>read_design</code> / <code>write_design</code>', 'Lire et compléter le document de conception : l\'intention, pas seulement l\'état.'],
      ['<code>create_texture</code>, <code>create_sound</code>', 'Fabriquer une image ou un bruitage sans fichier source.'],
      ['<code>configure_audio</code>, <code>play_sound</code>', 'Attacher et régler un son ; en écouter un.'],
      ['<code>build_atlas</code>, <code>paint_room</code>', 'Réunir des planches de sprites ; peindre une map de tuiles depuis un plan en texte.'],
      ['<code>configure_camera_2d</code>, <code>bake_iso_sprites</code>', 'Régler une caméra 2D ; cuire des sprites isométriques depuis un modèle.']
    ])

  + '<h3>La liste complète</h3>'
  + renderCommandsHelp()

  + tipHelp('Ce que fait une commande, vous pouvez presque toujours le faire à la main : le '
    + 'copilote n\'a pas de pouvoir caché. Les mêmes réglages sont dans l\''
    + linkHelp('panel-inspector', 'inspecteur') + '.')

  + '<h3>Voir aussi</h3><p>' + linkHelp('scripts-api', 'L\'api de script') + ' · '
  + linkHelp('faq', 'FAQ') + '</p>';
}},

{id:'reference-file-formats', part:'reference', section:'Référence', title:'Formats de fichiers', level:'both',
 summary:'Les fichiers que l\'éditeur importe, ouvre et produit.',
 anchors:[
   {f:'editor.html', c:'accept=".glb,.gltf,.fbx,.bin,.png,.jpg,.jpeg,.webp,.gif,.bmp,.mp3,.wav,.ogg,.m4a"'},
   {f:'editor.html', c:'accept=".p3d,.s3d,.json,application/json,application/gzip"'},
   {f:'js/ui.js', c:'{label:\'Fichier de projet… (.p3d / .s3d)\''},
   {f:'js/ui.js', c:'{label:\'🎮 Build Web jouable (.zip)\''},
   {f:'js/project-folder.js', c:"'prefab'],"},
   {f:'js/project-folder.js', c:"export const META_SUFFIX = '.meta';"}
 ],
 html:function(){ return ''
  + essentialHelp('<p>On importe des modèles, des images et des sons par <b>Fichier → Importer '
    + 'des assets…</b>. Un projet s\'enregistre en un fichier <code>.p3d</code> ou dans un '
    + '<b>dossier</b> lisible, et se publie en build Web <code>.zip</code>.</p>')

  + '<h3>À l\'import</h3>'
  + arrayHelp(['Genre', 'Extensions'], [
      ['Modèles 3D', '<code>.glb</code>, <code>.gltf</code> (+ <code>.bin</code>), <code>.fbx</code>'],
      ['Images', '<code>.png</code>, <code>.jpg</code>, <code>.jpeg</code>, <code>.webp</code>, <code>.gif</code>, <code>.bmp</code>'],
      ['Sons', '<code>.mp3</code>, <code>.wav</code>, <code>.ogg</code>, <code>.m4a</code>']
    ])
  + tipHelp('Un <code>.gltf</code> qui référence un <code>.bin</code> et des textures : '
    + 'sélectionnez tous ses fichiers ensemble dans la même boîte d\'import.')

  + '<h3>Le projet</h3>'
  + arrayHelp(['Fichier', 'Menu', 'Contenu'], [
      ['<code>.p3d</code>', '<b>Fichier → Ouvrir → Fichier de projet…</b>, <b>Enregistrer sous → Fichier de projet (.p3d)</b>', 'Tout le projet en un seul fichier : scènes et assets.'],
      ['<code>.s3d</code>, <code>.json</code>', '<b>Fichier → Ouvrir → Fichier de projet…</b>', 'Une scène, ou un projet au format JSON.'],
      ['Dossier de projet', '<b>Fichier → Ouvrir → Dossier de projet…</b>, <b>Enregistrer sous → 📁 Dans un dossier…</b>', 'Un fichier par asset sous <code>assets/</code> et par scène sous <code>scenes/</code> : lisible et versionnable avec Git.']
    ])

  + '<h3>Les fichiers d\'un dossier de projet</h3>'
  + '<p>Chaque asset est un fichier sous <code>assets/</code>, accompagné de sa carte '
    + 'd\'identité <code>.meta</code> (son identifiant) : c\'est elle qui permet de déplacer ou '
    + 'renommer un fichier hors de l\'éditeur sans casser les références.</p>'
  + arrayHelp(['Genre', 'Fichier'], [
      ['Prefab', '<code>nom.prefab.json</code>'],
      ['Matériau', '<code>nom.material.json</code>'],
      ['Planche de sprites', '<code>nom.sprite.json</code>'],
      ['Palette de tuiles', '<code>nom.tilepalette.json</code>'],
      ['Table de données', '<code>nom.data.json</code>'],
      ['Animation · machine à états', '<code>nom.animation.json</code> · <code>nom.animator.json</code>'],
      ['Graphe de shader · profil de post-traitement', '<code>nom.graph-shader.json</code> · <code>nom.postprofile.json</code>'],
      ['Bruitage · boucle musicale · preset d\'import', '<code>nom.sfx.json</code> · <code>nom.loop.json</code> · <code>nom.preset.json</code>'],
      ['Script · document UI · feuille de style', '<code>nom.js</code> · <code>nom</code> + <code>.html</code> · <code>nom.css</code>'],
      ['Texture, son, modèle', 'le fichier importé tel quel']
    ])
  + tipHelp('Un fichier déposé à la main dans <code>assets/</code> (copie, retour Git) entre '
    + 'dans le projet à la prochaine ouverture, ou tout de suite si l\'éditeur surveille le dossier.')

  + '<h3>Ce que l\'éditeur produit</h3>'
  + arrayHelp(['Export', 'Menu'], [
      ['Jeu Web jouable (<code>.zip</code>)', '<b>Fichier → Exporter → 🎮 Build Web jouable (.zip)</b>'],
      ['Application de bureau', '<b>Fichier → Exporter → 🖥 Projet bureau (Electron, .zip)</b>'],
      ['Dossier lisible', '<b>Fichier → Exporter → Dossier lisible (Git, .zip)</b>'],
      ['Données de jeu', '<b>Fichier → Exporter → Données de jeu (.json)</b>']
    ])
  + trapHelp('En mode dossier, une scène modifiée sur le disque pendant que vous avez des '
    + 'modifications non enregistrées n\'est <b>pas</b> rechargée : l\'éditeur prévient, et '
    + 'enregistrer écrasera la version du disque.')

  + '<h3>Voir aussi</h3><p>' + linkHelp('build', 'Exporter le jeu') + ' · '
  + linkHelp('menus', 'Les menus') + ' · ' + linkHelp('panel-project', 'Le panneau Projet') + '</p>';
}},

{id:'faq', part:'reference', section:'Référence', title:'Questions fréquentes', level:'beginner',
 summary:'Des réponses courtes aux questions qu\'on se pose en commençant.',
 anchors:[
   {f:'js/scripts.js', c:'export function stopScripts(){'},
   {f:'js/scripts.js', c:'setPosition: function(target, p){'},
   {f:'js/ui.js', c:'{label:\'API de scripts (JS)\', action:function(){ openHelp(\'scripts-api\'); }},'},
   {f:'js/inspector.js', c:'label: \'Rotation °\''}
 ],
 html:function(){ return ''
  + essentialHelp('<p>Une question, une réponse courte, et un lien vers la page qui détaille. '
    + 'Si votre souci ressemble à une panne, voyez plutôt ' + linkHelp('troubleshooting', 'Dépannage')
    + '.</p>')

  + '<h3>Par où commencer ?</h3>'
  + '<p>' + linkHelp('getting-started', 'Prise en main') + ', puis '
  + linkHelp('tuto-first-game-3d', 'le premier jeu 3D') + ' ou '
  + linkHelp('tuto-game-2d', 'le jeu de plateforme 2D') + '.</p>'

  + '<h3>Pourquoi mon objet revient-il à sa place quand j\'arrête ?</h3>'
  + '<p>C\'est voulu : ce que font les scripts et la physique pendant une lecture n\'est jamais '
  + 'enregistré. Déplacez l\'objet en édition pour changer sa place. '
  + linkHelp('scripts-lifecycle', 'Cycle de vie') + '.</p>'

  + '<h3>Comment téléporter un objet qui a de la physique ?</h3>'
  + '<p><code>api.setPosition(objet, {x, y, z})</code>. Écrire <code>position</code> est effacé '
  + 'par la physique à l\'image suivante. ' + linkHelp('scripts-api', 'L\'objet api') + '.</p>'

  + '<h3>J\'ai mis 90 dans la rotation d\'un script et l\'objet tourne n\'importe comment.</h3>'
  + '<p>L\'inspecteur affiche des <b>degrés</b>, les scripts travaillent en <b>radians</b> : '
  + 'écrivez <code>Math.PI / 2</code>. ' + linkHelp('units', 'Les unités') + '.</p>'

  + '<h3>Comment garder le score d\'une scène à l\'autre ?</h3>'
  + '<p>Dans <code>api.state</code>, seul à traverser un changement de scène. '
  + linkHelp('scripts-events', 'Événements et scènes') + '.</p>'

  + '<h3>Comment animer un personnage importé ?</h3>'
  + '<p>' + linkHelp('tuto-mixamo', 'Le tutoriel Mixamo') + ', puis '
  + linkHelp('animator', 'Animator') + '.</p>'

  + '<h3>Où voir la liste de tout ce qu\'un script peut faire ?</h3>'
  + '<p><b>Aide → API de scripts (JS)</b>, ou ' + linkHelp('scripts-api', 'L\'objet api') + '.</p>'

  + '<h3>Que peut faire le copilote IA ?</h3>'
  + '<p>Tout ce que listent ' + linkHelp('reference-commands', 'ses commandes') + '.</p>'

  + '<h3>Quels fichiers puis-je importer ?</h3>'
  + '<p>' + linkHelp('reference-file-formats', 'Formats de fichiers') + '.</p>'

  + '<h3>Comment publier mon jeu ?</h3>'
  + '<p>' + linkHelp('build', 'Exporter le jeu') + '.</p>'

  + '<h3>Voir aussi</h3><p>' + linkHelp('glossary', 'Glossaire') + ' · '
  + linkHelp('shortcuts', 'Raccourcis clavier') + '</p>';
}},

{id:'troubleshooting', part:'reference', section:'Référence', title:'Dépannage', level:'both',
 summary:'Les symptômes courants, leur cause réelle et la façon d\'en sortir.',
 anchors:[
   {f:'js/script-trust.js', c:'Exécuter les scripts</button>'},
   {f:'js/project.js', c:'export async function applySceneChangesFromDisk(tree, names){'},
   {f:'js/scripts.js', c:'if(!codeTrusted(code)){'},
   {f:'js/inspector.js', c:'<button class="btn-insp" id="btn-add-component">+ Composant</button>'},
   {f:'js/ui/panels-components.js', c:'\'— personne (caméra fixe) —\''}
 ],
 html:function(){ return ''
  + essentialHelp('<p>Commencez toujours par la ' + linkHelp('panel-console', 'Console') + ' : '
    + 'une erreur de script, un asset introuvable ou une animation absente y sont écrits, avec le '
    + 'nom de l\'objet en cause.</p>')

  + '<h3>Mes scripts ne font rien</h3>'
  + arrayHelp(['Cause', 'Que faire'], [
      ['Rien n\'est lancé', 'Les scripts ne tournent qu\'en lecture (<kbd>Espace</kbd>), en simulation, ou dans <b>Jouer</b>. ' + linkHelp('play-mode', 'Le mode jeu') + '.'],
      ['Le code n\'est pas approuvé', 'À l\'ouverture d\'un projet venu d\'ailleurs, l\'éditeur a demandé « Exécuter les scripts » : si vous avez répondu « Ne pas exécuter », rouvrez le projet et acceptez.'],
      ['Erreur de compilation', 'Le script entier est ignoré. Lisez la Console, ou <b>Édition → 🔍 Analyser la scène</b>. ' + linkHelp('scripts-debug', 'Déboguer') + '.'],
      ['Le champ <b>Script 1</b> est vide', 'Le composant Script est posé sans script choisi.'],
      ['L\'objet est inactif', 'Un objet inactif, ou dont un parent l\'est, n\'exécute pas ses scripts.']
    ])

  + '<h3>Mon objet ne bouge pas, ou revient en arrière</h3>'
  + '<p>Il a un corps rigide (<b>Physique</b>) et le script écrit <code>position</code> ou '
  + '<code>rotation</code> : la physique efface la valeur. Utilisez <code>api.setVelocity</code> '
  + 'ou <code>api.setPosition</code>. ' + linkHelp('physics', 'Physique') + '.</p>'

  + '<h3>Le personnage traverse le sol</h3>'
  + '<ul><li>En 3D : le sol n\'a pas de <b>Physique</b> (masse 0) et de <b>Collider</b>.</li>'
  + '<li>En 2D : il manque le <b>Collider 2D</b> au personnage, ou la Tilemap est réglée '
  + '<b>Collision : Aucune</b>. ' + linkHelp('collisions-2d', 'Collisions 2D') + '.</li></ul>'

  + '<h3>La caméra ne suit pas</h3>'
  + '<p>Le champ <b>Suit</b> du Suivi de caméra est sur « — personne (caméra fixe) — », ou '
  + 'l\'objet suivi a été renommé. Le suivi ne travaille qu\'en X et Y : pour une poursuite en '
  + 'profondeur, voir le script de ' + linkHelp('tuto-first-game-3d', 'premier jeu 3D') + '.</p>'

  + '<h3>Un champ @expose n\'apparaît pas</h3>'
  + '<p>La ligne est mal formée : <code>@expose nom {type} = valeur</code>, accolades '
  + 'comprises. Elle est ignorée sans message. ' + linkHelp('scripts', 'Écrire un script') + '.</p>'

  + '<h3>Ça marche dans l\'éditeur, pas dans le jeu</h3>'
  + '<p><code>api.groundHeight</code> n\'existe que dans l\'éditeur : en jeu, un rayon vers le bas '
  + '(<code>api.raycast</code>) la remplace. Testez toujours avec <b>Jouer</b>, qui lance la même '
  + 'page qu\'un build. ' + linkHelp('build', 'Exporter le jeu') + '.</p>'

  + '<h3>Une scène modifiée hors de l\'éditeur n\'apparaît pas</h3>'
  + '<p>En mode dossier, l\'éditeur relit une scène changée sur le disque — sauf si la scène '
  + 'affichée a des modifications non enregistrées : il prévient alors au lieu de recharger. '
  + 'Enregistrer écrase la version du disque ; rouvrir le projet la charge. '
  + linkHelp('scenes', 'Les scènes') + '.</p>'
  + trapHelp('Ne modifiez pas les fichiers de scène à la main pendant que l\'éditeur a du travail '
    + 'non enregistré dessus : l\'un des deux finira par écraser l\'autre.')

  + '<h3>Un composant manque à la liste</h3>'
  + '<p>Cliquez <b>+ Composant</b> et utilisez la recherche : la liste propose tous les composants '
  + 'sur tout objet, classés par catégorie.</p>'

  + advancedHelp('Toujours bloqué ?',
      '<p>Relisez la ' + linkHelp('faq', 'FAQ') + ', puis la fiche du composant en cause (le '
      + '<b>?</b> de son en-tête dans l\'inspecteur ouvre directement sa page).</p>')

  + '<h3>Voir aussi</h3><p>' + linkHelp('scripts-debug', 'Déboguer un script') + ' · '
  + linkHelp('panel-console', 'La Console') + '</p>';
}}

];
