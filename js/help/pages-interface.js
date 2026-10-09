// ---------- Aide de l'éditeur : partie « interface » ----------
// Une page = {id, part, section, title, level, summary, anchors, html}. Les ancres sont
// vérifiées par test/aide.test.mjs (voir l'en-tête de js/help-content.js).
// Les pages `panel-*` sont visées par HELP_PAGE_OF_PANEL (js/help.js) : le « ? » du dock et F1.
import { advancedHelp, arrayHelp, defaultHelp, essentialHelp, linkHelp, stepsHelp, tipHelp, trapHelp } from './help-format.js';
import { renderCommandsHelp } from '../help-page.js';
import { COMMANDS_HELP } from '../help-content.js';

export const PAGES_INTERFACE = [

// ================= Les panneaux =================

{id:'panel-hierarchy', part:'interface', section:'Panneaux', title:'La hiérarchie',
 level:'beginner',
 summary:'La liste des scènes et l\'arbre des objets de la scène courante : sélectionner, renommer, ranger, créer.',
 anchors:[
   {f:'js/ui/panels-shell.js', c:"id: 'hierarchy', title: 'Hiérarchie', icon: '🌳',"},
   {f:'js/hierarchy.js', c:"export const hierFilter = document.getElementById('hier-filter');"},
   {f:'js/hierarchy.js', c:"hierBody.addEventListener('dblclick', function(e){"},
   {f:'js/hierarchy.js', c:"const title = target ? ('Ajouter un enfant de ' + target.name) : 'Ajouter';"},
   {f:'js/hierarchy.js', c:"if(asset.kind === 'script') attachScriptAsset(asset, target);"}
 ],
 html:function(){ return ''
  + essentialHelp('<p>En haut, les <b>scènes</b> du projet (<b>＋</b> en ajoute une). En dessous, '
    + 'l\'<b>arbre</b> des objets de la scène ouverte. Un clic sélectionne, un double-clic renomme, '
    + 'un glisser-déposer change le parent.</p>')

  + '<h3>Les gestes</h3>'
  + arrayHelp(['Geste', 'Effet'], [
      ['Clic', 'Sélectionne l\'objet (l\'inspecteur le montre).'],
      ['<kbd>Ctrl</kbd> + clic', 'Ajoute ou retire l\'objet de la sélection multiple.'],
      ['Double-clic sur le nom', 'Renomme sur place. <kbd>Entrée</kbd> valide, <kbd>Échap</kbd> annule.'],
      ['Glisser un objet sur un autre', 'Le range comme enfant de la cible.'],
      ['Glisser un objet dans le vide', 'Le remet à la racine de la scène.'],
      ['Clic droit', 'Menu de création ; sur un nœud, l\'objet créé devient son enfant.'],
      ['Champ « Filtrer par nom »', 'N\'affiche que les objets dont le nom correspond.']
    ])

  + '<h3>Déposer un asset sur un objet</h3>'
  + '<p>Un asset glissé depuis le ' + linkHelp('panel-project', 'panneau Projet') + ' sur un nœud '
  + 'agit selon son genre : un <b>script</b> ou un <b>son</b> s\'attache à l\'objet, un '
  + '<b>matériau</b> ou une <b>texture</b> l\'habille, un <b>modèle</b> ou un <b>prefab</b> est '
  + 'instancié comme enfant.</p>'

  + trapHelp('<b>Un nœud de modèle importé ne se renomme pas et ne se déplace pas.</b> Son nom est '
    + 'l\'adresse par laquelle les animations retrouvent un os : la hiérarchie refuse et le dit '
    + 'dans la barre d\'état. On peut en revanche y accrocher un objet (une arme dans une main).')
  + tipHelp('Un objet ne peut pas devenir l\'enfant de l\'un de ses propres descendants : le dépôt '
    + 'est refusé avec un message.')
  + advancedHelp('Historique',
    '<p>Renommer et reparenter posent chacun un pas d\'historique : <kbd>Ctrl</kbd> + <kbd>Z</kbd> '
    + 'les défait. Le reparentage conserve la position monde de l\'objet (<code>attach</code> de '
    + 'three.js), pas ses valeurs locales.</p>')

  + '<h3>Voir aussi</h3>'
  + '<ul><li>' + linkHelp('panel-inspector', 'L\'inspecteur') + '</li>'
  + '<li>' + linkHelp('first-scene', 'Créer sa première scène') + '</li></ul>';
}},

{id:'panel-viewport', part:'interface', section:'Panneaux', title:'La vue 3D',
 level:'both',
 summary:'Regarder la scène, naviguer avec la caméra, sélectionner et transformer au gizmo.',
 anchors:[
   {f:'js/ui/panels-shell.js', c:'closable: false'},
   {f:'js/viewport.js', c:"CODES_FLY_FREE = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'])"},
   {f:'js/viewport.js', c:'flyFree.speed = Math.max(0.5, Math.min(60,'},
   {f:'js/viewport.js', c:"if(e.key === '1') setModeGizmo('translate');"},
   {f:'js/scene.js', c:"const gizmo = {space: 'local'};"},
   {f:'js/scene.js', c:"sel.title = inScale ? 'Le mode Échelle impose l\\'espace local'"},
   {f:'editor.html', c:'title="Aimanter — déplacement par pas de 0,5 · rotation 15° · échelle 0,1"'}
 ],
 html:function(){ return ''
  + essentialHelp('<p>La vue montre la scène telle que vous l\'éditez. Clic droit + glisser pour '
    + 'regarder, <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> pour avancer, molette pour zoomer, '
    + '<kbd>F</kbd> pour cadrer la sélection. Un clic sélectionne ; on déplace au <b>gizmo</b>.</p>')

  + '<h3>Naviguer</h3>'
  + arrayHelp(['Geste', 'Effet'], [
      ['Clic droit + glisser', 'Vol libre : la souris oriente le regard. Tant que le bouton est '
        + 'tenu, <kbd>W</kbd>/<kbd>A</kbd>/<kbd>S</kbd>/<kbd>D</kbd> avancent et vont sur les côtés, '
        + '<kbd>Q</kbd>/<kbd>E</kbd> descendent et montent.'],
      ['Molette', 'Zoom. En vol libre, elle règle la <b>vitesse</b> de vol (de 0,5 à 60).'],
      ['Clic molette + glisser', 'Panoramique.'],
      ['<kbd>F</kbd>', 'Cadre la caméra sur la sélection.']
    ])

  + '<h3>Sélectionner</h3>'
  + '<p>Un clic sélectionne l\'objet sous la souris. Un clic dans le vide puis glisser trace un '
  + 'rectangle de sélection ; <kbd>Maj</kbd> l\'ajoute à la sélection, <kbd>Ctrl</kbd> + clic '
  + 'ajoute ou retire un objet.</p>'

  + '<h3>Le gizmo</h3>'
  + stepsHelp([
      'Choisissez l\'outil : <kbd>1</kbd> déplacer, <kbd>2</kbd> tourner, <kbd>3</kbd> échelle '
        + '(ou les trois boutons de la barre d\'outils posée sur la vue).',
      'Choisissez le référentiel : <b>Local</b>, <b>Monde</b> ou <b>Vue</b>.',
      'Tirez une flèche, un anneau ou une poignée.'
    ])
  + arrayHelp(['Référentiel', 'Les axes du gizmo suivent'], [
      ['<b>Local</b> ' + defaultHelp('défaut'), 'L\'orientation de l\'objet : sa flèche bleue le fait '
        + 'avancer « devant lui », même s\'il est tourné.'],
      ['<b>Monde</b>', 'Les axes de la scène, quelle que soit l\'orientation de l\'objet.'],
      ['<b>Vue</b>', 'La caméra : le gizmo est à plat dans l\'écran.']
    ])
  + '<p>Le référentiel ne change <b>rien</b> aux valeurs de l\'inspecteur, qui restent toujours '
  + 'relatives au parent.</p>'
  + trapHelp('<b>Le mode Échelle impose « Local » et grise le sélecteur.</b> Une échelle n\'a de '
    + 'sens que sur les axes propres de l\'objet : sur des axes monde, un cube tourné deviendrait '
    + 'un parallélogramme, que trois nombres ne savent pas décrire.')
  + tipHelp('Le bouton <b>aimant</b> de la barre d\'outils fait avancer le gizmo par pas : 0,5 en '
    + 'déplacement, 15° en rotation, 0,1 en échelle.')

  + '<h3>Comment la scène est dessinée</h3>'
  + '<p>La barre d\'outils porte aussi le <b>mode d\'affichage</b> et les bascules <b>Ombres</b>, '
  + '<b>Textures</b>, <b>Shaders</b> et <b>Grille</b>. Ce sont des réglages de regard : ils ne '
  + 'changent rien au projet ni au jeu publié.</p>'

  + advancedHelp('Le référentiel « Vue » est simulé',
    '<p>Le TransformControls de three.js n\'a pas d\'espace « vue ». <code>js/scene.js</code> '
    + 'attache donc le gizmo à un objet relais orienté comme la caméra, en espace local, puis '
    + 'réapplique le déplacement obtenu à la vraie sélection en espace monde. La vue 3D est le '
    + 'seul panneau du dock qui ne se ferme pas.</p>')

  + '<h3>Voir aussi</h3>'
  + '<ul><li>' + linkHelp('shortcuts', 'Tous les raccourcis') + '</li>'
  + '<li>' + linkHelp('panel-environment', 'Le ciel et le brouillard') + '</li></ul>';
}},

{id:'panel-inspector', part:'interface', section:'Panneaux', title:'L\'inspecteur',
 level:'beginner',
 summary:'Les réglages de l\'objet sélectionné : identité, transform, composants.',
 anchors:[
   {f:'js/ui/panels-shell.js', c:"id: 'inspector', title: 'Inspecteur', icon: '🔧',"},
   {f:'js/ui/panels-inspector.js', c:"{ ids: ['f-name'], label: 'Nom', type: 'text', multi: false,"},
   {f:'js/inspector.js', c:'<button class="btn-insp" id="btn-add-component">+ Composant</button></div>'},
   {f:'js/inspector.js', c:'title="Aide sur ce composant (F1)">?</button>'},
   {f:'js/inspector.js', c:'if(!inspHistoTaken){ pushHistory(); inspHistoTaken = true; }'}
 ],
 html:function(){ return ''
  + essentialHelp('<p>L\'inspecteur montre ce qui est sélectionné. En haut : le <b>nom</b>, le '
    + '<b>tag</b> et le <b>calque</b>. En dessous : une <b>carte par composant</b>. '
    + '<b>+ Composant</b> en ajoute un ; le <b>?</b> de chaque carte ouvre sa fiche.</p>')

  + '<h3>Une carte de composant</h3>'
  + arrayHelp(['Élément', 'Rôle'], [
      ['Flèche', 'Replie ou déplie la carte.'],
      ['Nom', 'Le composant, par exemple ' + linkHelp('component-Mesh', 'Maillage') + '.'],
      ['<b>?</b>', 'Ouvre la fiche du composant dans ce manuel.'],
      ['Interrupteur', 'Active ou désactive le composant sans le retirer.']
    ])

  + '<h3>Modifier une valeur</h3>'
  + stepsHelp([
      'Sélectionnez l\'objet dans la vue ou la hiérarchie.',
      'Tapez une valeur, ou glissez sur un champ numérique.',
      '<kbd>Ctrl</kbd> + <kbd>Z</kbd> défait la modification entière, pas lettre par lettre.'
    ])
  + trapHelp('Tant que le curseur est dans un champ de l\'inspecteur, les raccourcis de la vue '
    + '(<kbd>Suppr</kbd>, <kbd>1</kbd>…) ne s\'appliquent pas. Cliquez d\'abord dans la vue.')
  + advancedHelp('Un pas d\'historique par geste',
    '<p>Une rafale de frappes dans un même champ ne pose qu\'un seul pas d\'historique : le '
    + 'premier changement le prend, les suivants s\'y ajoutent. Sans cela, la pile de 50 pas '
    + 'serait chassée par une seule saisie.</p>')

  + '<h3>Voir aussi</h3>'
  + '<ul><li>' + linkHelp('panel-hierarchy', 'La hiérarchie') + '</li>'
  + '<li>' + linkHelp('scripts', 'Les scripts') + '</li></ul>';
}},

{id:'panel-project', part:'interface', section:'Panneaux', title:'Le panneau Projet',
 level:'both',
 summary:'Les assets du projet : arbre de dossiers repliable, import, création, glisser-déposer.',
 anchors:[
   {f:'js/ui/panels-shell.js', c:"id: 'project', title: 'Projet', icon: '📦',"},
   {f:'js/assets.js', c:'export function toggleFolderInTree(filePath, deep){'},
   {f:'js/assets.js', c:'(Alt+clic : tout le sous-arbre)'},
   {f:'js/assets.js', c:"e.dataTransfer.setData('text/asset', a.id);"},
   {f:'js/assets.js', c:'const DOUBLE_CLICK_MS = 400;'},
   {f:'editor.html', c:'<button id="btn-import">＋ Importer (FBX, glTF, textures, sons)</button>'}
 ],
 html:function(){ return ''
  + essentialHelp('<p>À gauche, l\'<b>arbre des dossiers</b> ; à droite, les <b>tuiles</b> du '
    + 'dossier courant. <b>＋ Importer</b> ajoute des fichiers ; glisser une tuile dans la vue '
    + 'ou sur un objet l\'utilise.</p>')

  + '<h3>L\'arbre des dossiers</h3>'
  + stepsHelp([
      'Cliquez un dossier pour afficher son contenu.',
      'Cliquez la flèche <b>▸</b>/<b>▾</b> pour replier ou déplier ses sous-dossiers, '
        + '<b>sans changer</b> le dossier affiché.',
      '<kbd>Alt</kbd> + clic sur la flèche applique le même état à tout le sous-arbre ; la flèche '
        + 'de la racine « 📦 Projet » replie tout.'
    ])
  + tipHelp('Entrer dans un dossier par une tuile (double-clic) ou en créer un déplie ses ancêtres : '
    + 'la ligne active reste visible.')
  + trapHelp('L\'état replié vaut pour la session : il n\'est écrit ni dans le projet ni sur le disque.')

  + '<h3>Ranger les assets</h3>'
  + '<p>Rangez par <b>type</b> d\'abord (Textures, Modèles, Scripts, Sons…), puis par sous-thème, '
  + 'comme dans Unity. Glissez une tuile sur un dossier de l\'arbre pour l\'y déplacer ; le bouton '
  + 'dossier de la barre crée un sous-dossier dans le dossier courant.</p>'

  + '<h3>Importer et créer</h3>'
  + arrayHelp(['Bouton', 'Effet'], [
      ['<b>＋ Importer</b>', 'Modèles FBX et glTF, textures, sons. Déposer des fichiers sur le '
        + 'panneau fait la même chose. ' + linkHelp('import-model', 'Voir l\'import de modèles') + '.'],
      ['<b>Créer</b>', 'Script, matériau, graphe de shader, document UI, feuille de style, animation, '
        + 'sprite, palette de tuiles, table de contenu.'],
      ['<b>🎲 Fabriquer</b>', 'Une image ou un bruitage sans fichier source, avec aperçu. '
        + linkHelp('assets-made', 'Voir les assets fabriqués') + '.']
    ])

  + '<h3>Glisser-déposer</h3>'
  + arrayHelp(['Depuis', 'Vers', 'Effet'], [
      ['Tuile de modèle ou prefab', 'la vue', 'Instancie l\'asset dans la scène.'],
      ['Tuile de texture', 'un objet', 'L\'habille de la texture.'],
      ['Tuile', 'un nœud de la ' + linkHelp('panel-hierarchy', 'hiérarchie'), 'Attache ou instancie selon le genre.'],
      ['Tuile', 'un dossier de l\'arbre', 'Déplace l\'asset.'],
      ['Objet de la hiérarchie', 'le panneau Projet', 'En fait un prefab.']
    ])
  + '<p>Double-cliquer une tuile ouvre l\'asset : un script dans l\'éditeur de code, un dossier '
  + 'pour y entrer.</p>'

  + advancedHelp('Pourquoi le double-clic est détecté au clic simple',
    '<p>Le premier clic sélectionne l\'asset et redessine tout le panneau : la tuile sous la souris '
    + 'est remplacée entre les deux clics, et le navigateur ne déclenche plus de '
    + '<code>dblclick</code>. Deux clics sur le même asset en moins de 400 ms l\'ouvrent donc.</p>')

  + '<h3>Voir aussi</h3>'
  + '<ul><li>' + linkHelp('project', 'Le format de projet') + '</li>'
  + '<li>' + linkHelp('materials-contract', 'Les matériaux') + '</li></ul>';
}},

{id:'panel-console', part:'interface', section:'Panneaux', title:'La console',
 level:'beginner',
 summary:'Les messages et erreurs des scripts, filtrables, avec retour à l\'objet fautif.',
 anchors:[
   {f:'js/ui/panels-shell.js', c:'onShow: function(){ markConsoleView(true); }'},
   {f:'js/console.js', c:'export const consoleEditor = {inputs:[], max:500, notVues:0, visible:false};'},
   {f:'js/console.js', c:"if(level === 'error' && !consoleEditor.visible) consoleEditor.notVues++;"},
   {f:'js/console.js', c:"consoleBody.addEventListener('dblclick', function(e){"}
 ],
 html:function(){ return ''
  + essentialHelp('<p>La console affiche ce que les scripts écrivent par <code>api.log</code>, '
    + '<code>api.warn</code> et <code>api.error</code>, et leurs erreurs. Un <b>double-clic</b> sur '
    + 'une ligne liée à un objet le sélectionne et ouvre son script.</p>')
  + '<p>Ouvrez-la par <b>Fenêtres → 📋 Console</b>. Chaque ligne porte l\'heure, un niveau '
  + '(⛔ erreur, ⚠️ avertissement, · message) et le nom de l\'objet.</p>'
  + arrayHelp(['Élément', 'Rôle'], [
      ['Champ de filtre', 'Ne garde que les lignes dont le message ou le nom d\'objet contient le texte.'],
      ['Compteurs', 'Nombre de messages, d\'avertissements et d\'erreurs.'],
      ['Bouton vider', 'Efface toutes les lignes.'],
      ['Pastille ●', 'Sur l\'onglet : le nombre d\'erreurs arrivées pendant que la console était cachée.']
    ])
  + trapHelp('La console garde les <b>500</b> dernières lignes : au-delà, les plus anciennes '
    + 'disparaissent. Une erreur répétée à chaque image chasse vite la première, qui est souvent la '
    + 'seule utile.')
  + '<h3>Voir aussi</h3>'
  + '<ul><li>' + linkHelp('scripts', 'Les scripts') + '</li>'
  + '<li>' + linkHelp('analysis', 'Analyser la scène') + ', qui trouve les erreurs de syntaxe sans rien lancer</li></ul>';
}},

{id:'panel-environment', part:'interface', section:'Panneaux', title:'Le panneau Environnement',
 level:'both',
 summary:'Le ciel, le brouillard et l\'éclairage global de la scène courante, appliqués immédiatement.',
 anchors:[
   {f:'js/ui/panels-scene.js', c:"id: 'environment', title: 'Environnement', icon: '🌤',"},
   {f:'js/ui/panels-scene.js', c:'set: function(e, v){ e.brouillardLoin = Math.max(e.brouillardNear + 1, v); envApply(); } }'},
   {f:'js/environment.js', c:"sky:'gradient',"},
   {f:'js/environment.js', c:'brouillardNear:40,'},
   {f:'js/environment.js', c:'scene.background = fond;'},
   {f:'js/environment.js', c:"if(typeof applyProbes === 'function') applyProbes();"},
   {f:'js/history.js', c:'env: JSON.parse(JSON.stringify(env)),'}
 ],
 html:function(){ return ''
  + essentialHelp('<p>Ouvrez-le par <b>Fenêtres → 🌤 Environnement</b>. Il règle le <b>ciel</b>, le '
    + '<b>brouillard</b> et la <b>lumière ambiante</b> de la scène courante. Chaque modification '
    + 's\'applique tout de suite dans la vue, et part avec la scène dans le jeu.</p>')

  + '<h3>Ciel</h3>'
  + arrayHelp(['Réglage', 'Défaut', 'Rôle'], [
      ['Type', defaultHelp('Dégradé'), 'Couleur unie, Dégradé (Haut / Bas) ou Panorama (image).'],
      ['Image', '', 'Une texture du projet, panorama équirectangulaire. Importez-la d\'abord.'],
      ['Reflets du ciel', defaultHelp('coché'), 'Le ciel sert de reflet aux objets qu\'aucune sonde '
        + 'de réflexion ne couvre.'],
      ['Intensité', defaultHelp('1'), 'Force de ce reflet, de 0 à 3.']
    ])
  + '<h3>Brouillard</h3>'
  + arrayHelp(['Réglage', 'Défaut', 'Rôle'], [
      ['Actif', defaultHelp('coché'), 'Active le brouillard linéaire.'],
      ['Couleur', '', 'Teinte du brouillard.'],
      ['Début', defaultHelp('40'), 'Distance où il commence, en mètres.'],
      ['Fin', defaultHelp('90'), 'Distance où il devient opaque. Toujours après le début.']
    ])
  + '<h3>Éclairage global</h3>'
  + arrayHelp(['Réglage', 'Défaut', 'Rôle'], [
      ['Ambiante', defaultHelp('0.4'), 'Intensité de la lumière ambiante (hémisphérique).'],
      ['Teinte ciel', '', 'Couleur de cette lumière venant du haut.'],
      ['Soleil', defaultHelp('0.55'), 'Intensité du soleil de la scène.']
    ])
  + tipHelp('Un métal qui ne reflète rien ? Vérifiez que <b>Reflets du ciel</b> est coché, ou posez '
    + 'une ' + linkHelp('probes', 'sonde de réflexion') + '.')

  + '<h3>Comment les modifications s\'appliquent</h3>'
  + stepsHelp([
      'Vous changez un champ : la valeur est écrite dans les réglages d\'environnement de la scène.',
      'L\'éditeur reconstruit aussitôt le fond (ciel), le brouillard et les lumières globales.',
      'Les reflets de ciel sont recalculés, pour que les objets reflètent le nouveau ciel.',
      'À l\'enregistrement, ces réglages sont écrits avec la scène ; le jeu les relit au chargement.'
    ])
  + trapHelp('<b>L\'environnement appartient à la scène hôte.</b> Une scène instanciée comme '
    + 'sous-scène n\'apporte pas le sien : le panneau l\'annonce par une note dans ce cas.')
  + advancedHelp('Sous le capot',
    '<p>Chaque champ appelle <code>applyEnvironment()</code> (<code>js/environment.js</code>). Le '
    + 'ciel n\'est pas un objet : c\'est <code>scene.background</code>, rendu à l\'infini derrière tout '
    + '(une texture équirectangulaire pour le dégradé et le panorama). Le brouillard est un '
    + '<code>THREE.Fog</code> ; « Ambiante » règle une lumière hémisphérique. Les valeurs par défaut '
    + 'sont <code>ENV_DEFAULT</code>. L\'environnement fait partie de l\'état capturé par '
    + 'l\'historique. Certaines clés du format sont en français (<code>brouillard</code>, '
    + '<code>ambiante</code>) : elles sont sérialisées et ne se renomment pas sans migration.</p>')

  + '<h3>Voir aussi</h3>'
  + '<ul><li>' + linkHelp('lightmaps', 'Cuire l\'éclairage') + '</li>'
  + '<li>' + linkHelp('settings', 'Réglages du projet') + ' (environnement des nouvelles scènes)</li></ul>';
}},

// ================= Menus, réglages, jeu =================

{id:'menus', part:'interface', section:'Éditeur', title:'Menus et barre d\'outils',
 level:'beginner',
 summary:'Ce que contient chaque menu de la barre du haut, et la barre d\'outils posée sur la vue.',
 anchors:[
   {f:'js/ui.js', c:"{title:'Fichier', items:["},
   {f:'js/ui.js', c:"{title:'Objet', items:[]},"},
   {f:'js/ui.js', c:"{label:'↺ Réinitialiser la disposition',"},
   {f:'js/ui.js', c:"{label:'📖 Aide de l\\'éditeur…', shortcut:'F1', action:function(){ openHelp(); }},"},
   {f:'editor.html', c:'<div class="ui-seg" id="g-tools">'}
 ],
 html:function(){ return ''
  + essentialHelp('<p>La barre du haut porte les menus, le nom du projet, son état '
    + 'd\'enregistrement et le bouton <b>▶ Jouer</b>. La barre d\'outils, posée sur la vue, porte le '
    + 'gizmo et les modes d\'affichage.</p>')
  + '<h3>Les menus</h3>'
  + arrayHelp(['Menu', 'Contenu'], [
      ['<b>Fichier</b>', 'Nouveau, Ouvrir, Enregistrer, Enregistrer sous, sauvegarde automatique, '
        + 'scènes, Exporter (build web, projet bureau…), Publier en ligne, Importer des assets, '
        + 'Paramètres du projet, Entrées, Plugins.'],
      ['<b>Édition</b>', 'Annuler, Rétablir, Copier, Coller, Dupliquer, Créer un prefab, Cadrer, '
        + linkHelp('analysis', 'Analyser la scène') + ', Préférences, Supprimer.'],
      ['<b>Objet</b>', 'Crée chaque type d\'objet, puis les outils de placement : poser au sol, '
        + 'aligner, dupliquer en série, cuire sondes et lightmaps.'],
      ['<b>Affichage</b>', 'Ombres, textures, shaders, fil de fer, aimant, calques, '
        + linkHelp('profiler', 'profiler') + ', simulation physique seule, outils de gizmo.'],
      ['<b>Fenêtres</b>', 'Ouvre ou ferme chaque panneau du dock ; ↺ Réinitialiser la disposition ; '
        + 'les éditeurs (code, table, shader, HTML/CSS).'],
      ['<b>Aide</b>', 'Ce manuel, le glossaire, le ' + linkHelp('copilot', 'copilote IA') + ', les '
        + linkHelp('shortcuts', 'raccourcis') + ', l\'API de scripts.']
    ])
  + tipHelp('Un panneau fermé par erreur se rouvre par le menu <b>Fenêtres</b>. Si la disposition '
    + 'devient confuse, <b>↺ Réinitialiser la disposition</b> la remet d\'origine.')
  + '<h3>La barre d\'outils</h3>'
  + '<p>De gauche à droite : les trois outils du gizmo, le référentiel (Local / Monde / Vue), '
  + 'l\'aimant, le mode d\'affichage, puis les bascules Ombres, Textures, Shaders et Grille. '
  + linkHelp('panel-viewport', 'Voir la vue') + '.</p>'
  + advancedHelp('Menus extensibles',
    '<p>Le menu Fenêtres est construit à chaque ouverture depuis le registre du dock : un panneau '
    + 'déclaré par un plugin y apparaît. Le menu Objet est rempli depuis la liste des types '
    + 'créables, la même que les menus contextuels.</p>')
  + '<h3>Voir aussi</h3>'
  + '<ul><li>' + linkHelp('settings', 'Préférences et réglages du projet') + '</li></ul>';
}},

{id:'settings', part:'interface', section:'Éditeur', title:'Préférences et Paramètres du projet',
 level:'both',
 summary:'La différence entre ce qui appartient à votre machine et ce qui voyage avec le projet.',
 anchors:[
   {f:'js/ui/panels-settings.js', c:"id: 'project-settings', title: 'Paramètres du projet', icon: '⚙',"},
   {f:'js/ui/panels-settings.js', c:"id: 'preferences', title: 'Préférences', icon: '🎛',"},
   {f:'js/ui/panels-settings.js', c:'Ces réglages appartiennent à cette machine et à ce navigateur'},
   {f:'js/ui.js', c:"{label:'⚙ Paramètres du projet…', action:function(){ openPanelDock('project-settings'); }},"},
   {f:'js/ui.js', c:"{label:'🎛 Préférences…', action:function(){ openPanelDock('preferences'); }},"},
   {f:'js/project-settings.js', c:'export const SHADOW_DISTANCE_DEFAULT = 40;'}
 ],
 html:function(){ return ''
  + essentialHelp('<p><b>Préférences</b> (Édition → 🎛 Préférences…) : votre confort, sur cette '
    + 'machine. <b>Paramètres du projet</b> (Fichier → ⚙ Paramètres du projet…) : ce qui décide du '
    + 'jeu, enregistré dans le projet et embarqué dans le build.</p>')
  + '<p>Les deux s\'ouvrent comme des panneaux du dock, pas comme des fenêtres modales : on les '
  + 'laisse ouverts à côté de la vue pendant qu\'on essaie.</p>'

  + '<h3>Paramètres du projet</h3>'
  + arrayHelp(['Section', 'Contenu'], [
      ['(identité)', 'Nom du projet ; afficher la version dans le jeu.'],
      ['Rendu', 'Portée des ombres (' + defaultHelp('40') + ' m) et finesse des ombres.'],
      ['Mixage audio', 'Volumes des bus. ' + linkHelp('audio', 'Voir l\'audio') + '.'],
      ['Calques', 'Les calques de la scène, visibles ou verrouillés.'],
      ['2D', 'Pixels par unité, calques de tri. ' + linkHelp('game-2d', 'Voir la 2D') + '.'],
      ['Entrées', 'Actions et axes du jeu.'],
      ['Langues du jeu', 'Langues, langue par défaut, textes traduits.'],
      ['Cuisson de l\'éclairage', 'Réglages des ' + linkHelp('lightmaps', 'lightmaps') + '.'],
      ['Document de conception', 'Le document lu par le copilote. '
        + linkHelp('copilot-driving', 'Voir conduire une session') + '.'],
      ['Nouvelle scène', 'L\'environnement donné aux scènes créées ensuite.']
    ])
  + trapHelp('<b>Portée des ombres : plus grand n\'est pas mieux.</b> La carte d\'ombre a une '
    + 'résolution fixe : doubler la portée double la taille d\'un texel au sol et adoucit les contours.')

  + '<h3>Préférences</h3>'
  + '<p>Rangées par catégories, plus la convention de nommage des textures (quel suffixe de '
  + 'fichier est une carte de normales, de rugosité…). Elles restent dans ce navigateur : un autre '
  + 'poste ouvrant le même projet ne les a pas.</p>'
  + tipHelp('Pour savoir où ranger un réglage, demandez-vous : deux personnes qui publient le même '
    + 'projet doivent-elles obtenir le même build ? Si oui, c\'est un paramètre du projet.')
  + advancedHelp('Où c\'est stocké',
    '<p>Les paramètres du projet vivent dans <code>project.settings</code> et sont écrits dans le '
    + 'manifeste du projet (<code>js/project-settings.js</code>). Les préférences passent par le '
    + 'registre <code>Prefs</code> et le stockage local du navigateur.</p>')
  + '<h3>Voir aussi</h3>'
  + '<ul><li>' + linkHelp('project', 'Le format de projet') + '</li>'
  + '<li>' + linkHelp('menus', 'Les menus') + '</li></ul>';
}},

{id:'play-mode', part:'interface', section:'Éditeur', title:'▶ Jouer : le mode Jeu',
 level:'both',
 summary:'▶ Jouer lance le vrai jeu dans un nouvel onglet ; Espace et ⚙ Physique jouent dans la vue.',
 anchors:[
   {f:'js/play-mode.js', c:"window.open('game-preview.html', '_blank');"},
   {f:'js/play-mode.js', c:'window.PREVIEW_GAME_DATA = data;'},
   {f:'js/play-mode.js', c:"setStatus('Lancement annulé — scripts non exécutés', 4000);"},
   {f:'editor.html', c:'title="Lance le jeu dans un nouvel onglet, comme un build exporté"'}
 ],
 html:function(){ return ''
  + essentialHelp('<p><b>▶ Jouer</b> ouvre le jeu dans un <b>nouvel onglet</b>, avec le même code '
    + 'qu\'un build exporté. L\'éditeur reste utilisable : rien n\'est figé, rien n\'est à restaurer. '
    + 'Après une modification, recliquez <b>▶ Jouer</b>.</p>')

  + '<h3>Trois façons de faire bouger la scène</h3>'
  + arrayHelp(['', 'Ce que ça lance', 'Où'], [
      ['<kbd>Espace</kbd>', 'La ' + linkHelp('animation', 'timeline d\'animation') + ', l\'animation '
        + 'du modèle sélectionné et les scripts. Les poses sont restaurées à l\'arrêt.', 'la vue'],
      ['<b>⚛ Simulation physique seule</b> (menu Affichage)', 'La physique, avec un instantané '
        + 'restauré à l\'arrêt. ' + linkHelp('physics', 'Voir la physique') + '.', 'la vue'],
      ['<b>▶ Jouer</b>', 'Le jeu complet, avec son propre monde physique.', '<b>un nouvel onglet</b>']
    ])

  + '<h3>Lancer le jeu</h3>'
  + stepsHelp([
      'Cliquez <b>▶ Jouer</b> en haut à droite.',
      'Si le projet contient des scripts pas encore approuvés, l\'éditeur demande confirmation. '
        + 'Refuser annule le lancement.',
      'Le jeu s\'ouvre dans un nouvel onglet sur sa scène de départ.'
    ])
  + trapHelp('<b>L\'onglet d\'aperçu ne se recharge pas.</b> Il lit les données du projet dans '
    + 'l\'onglet de l\'éditeur qui l\'a ouvert, au moment du clic. Un <kbd>F5</kbd> dans cet onglet '
    + 'affiche « data.js manquant ou invalide ». L\'aperçu est une photo : il ne suit pas vos '
    + 'changements.')
  + advancedHelp('Pourquoi la confirmation vient avant l\'onglet',
    '<p><code>play()</code> (<code>js/play-mode.js</code>) vérifie la confiance accordée aux scripts '
    + 'AVANT d\'ouvrir l\'onglet : la page <code>game-preview.html</code> est de même origine que '
    + 'l\'éditeur, et un script y atteindrait le même stockage local (dont la clé du copilote). '
    + 'Ensuite, le projet est assemblé, posé dans <code>window.PREVIEW_GAME_DATA</code> et lu par '
    + 'l\'onglet ouvert, qui exécute <code>js/game-runtime.js</code>.</p>')
  + '<h3>Voir aussi</h3>'
  + '<ul><li>' + linkHelp('first-scene', 'Créer sa première scène') + '</li>'
  + '<li>' + linkHelp('project', 'Exporter et publier') + '</li></ul>';
}},

// ================= Les outils =================

{id:'profiler', part:'interface', section:'Outils', title:'Profiler et budgets',
 level:'both',
 summary:'Une pastille de mesures sur la vue, comparée à un budget PC ou mobile.',
 anchors:[
   {f:'js/profiler.js', c:'if(ed(o).light) countLum++;'},
   {f:'js/profiler.js', c:"name: 'PC / desktop', fps: 60"},
   {f:'js/profiler.js', c:'drawCalls: 400'},
   {f:'js/profiler.js', c:'triangles: 1500000'},
   {f:'js/profiler.js', c:'mobile: {name:'},
   {f:'js/profiler.js', c:"classe = ratio <= 0.75 ? 'ok' : (ratio <= 1 ? 'medium' : 'bad');"},
   {f:'js/profiler.js', c:'if(budget){'},
   {f:'js/render-perf.js', c:'const THRESHOLD_INSTANCES = 8;'},
   {f:'js/render-perf.js', c:"if(o.getComponent && (o.getComponent('Reflection') || o.getComponent('Terrain'))) return false;"},
   {f:'js/render-perf.js', c:'if(o.userData.scripts && o.userData.scripts.length) return false;'},
   {f:'js/render-perf.js', c:'if(o.children && o.children.length) return false;'},
   {f:'js/ui.js', c:"{label:'📊 Profiler & budgets'"}
 ],
 html:function(){ return ''
  + essentialHelp('<p><b>Affichage → 📊 Profiler &amp; budgets</b> affiche une pastille de mesures '
    + 'sur la vue : <b>vert</b> jusqu\'à 75 % du budget, <b>orange</b> jusqu\'à 100 %, <b>rouge</b> '
    + 'au-delà. Elle mesure <b>l\'éditeur</b>, pas le jeu publié.</p>')

  + '<h3>Les deux budgets</h3>'
  + arrayHelp(['', 'PC / desktop', 'Mobile / web léger'], [
      ['Images par seconde', '60', '30'],
      ['Draw calls', '400', '100'],
      ['Triangles', '1 500 000', '300 000'],
      ['Textures', '80', '30'],
      ['Lumières', '8', '4']
    ])
  + '<p>Pour les images par seconde, la règle est inversée : verte au-dessus du budget.</p>'
  + trapHelp('La ligne <b>Lumières</b> compte les objets qui portent un composant <code>Light</code>, '
    + '<b>masqués compris</b> : c\'est un inventaire, pas une mesure de ce qui s\'allume. '
    + linkHelp('lightmaps', 'Cuire les lightmaps') + ' permet d\'en retirer sans assombrir le décor.')
  + trapHelp('<b>Toutes les lignes vertes ne veulent pas dire la même chose.</b> Les postes sans '
    + 'budget — temps CPU, géométries, objets, maillages, particules — restent verts quelle que soit '
    + 'leur valeur. Seules les cinq lignes du tableau, plus <b>Image</b> et <b>Total mesuré</b>, '
    + 'changent réellement de couleur.')
  + trapHelp('<b>« Total mesuré » n\'est pas le total de l\'image.</b> C\'est la somme des quatre '
    + 'postes CPU listés, comparée au budget d\'image complet : il peut rester vert pendant que '
    + '<b>Image</b> est rouge.')

  + '<h3>Le jeu publié n\'affiche pas les mêmes chiffres</h3>'
  + '<p>À l\'entrée du jeu, les objets identiques et immobiles sont <b>regroupés</b> en lots, à '
  + 'partir de <b>8 exemplaires</b>. Le nombre de draw calls y est donc plus bas qu\'ici.</p>'
  + advancedHelp('Ce que le regroupement laisse de côté',
    '<p><code>js/render-perf.js</code> écarte ce qu\'il ne peut pas fusionner sans changer le '
    + 'résultat : les objets qui portent un script, ceux qui ont des enfants, les sondes, les '
    + 'terrains, les maillages animés. Le profiler n\'existe pas dans le jeu publié.</p>')
  + '<h3>Voir aussi</h3>'
  + '<ul><li>' + linkHelp('analysis', 'Analyser la scène') + ' — la logique, pas le coût</li></ul>';
}},

{id:'analysis', part:'interface', section:'Outils', title:'Analyser la scène',
 level:'both',
 summary:'Une revue de la scène sans rien lancer : scripts, liens cassés, réglages douteux, jouabilité.',
 anchors:[
   {f:'js/analysis.js', c:"const order = {error:0, warn:1, info:2};"},
   {f:'js/analysis.js', c:'corps rigide de masse nulle'},
   {f:'js/analysis.js', c:'échelle négative (normales inversées, physique imprévisible)'},
   {f:'js/analysis.js', c:'inutilisé dans cette scène.'},
   {f:'js/analysis.js', c:"if(!sols.length) return;"},
   {f:'js/ui.js', c:"{label:'🔍 Analyser la scène', action:openAnalysisScene}"}
 ],
 html:function(){ return ''
  + essentialHelp('<p><b>Édition → 🔍 Analyser la scène</b> passe la scène en revue sans rien '
    + 'lancer. Trois niveaux : <b>⛔ erreur</b>, <b>⚠️ avertissement</b>, <b>ℹ️ info</b>.</p>')
  + '<h3>Ce qu\'il regarde</h3>'
  + '<ul>'
  + '<li><b>Les scripts</b> : chacun est compilé ; une erreur de syntaxe est signalée avec le nom '
  + 'de l\'objet.</li>'
  + '<li><b>Les liens cassés</b> : matériau, prefab, son ou scène référencés mais absents.</li>'
  + '<li><b>Les configurations douteuses</b> : masse nulle, objet invisible mais physiquement actif, '
  + 'échelle négative, déclencheur que personne n\'écoute, noms en double, absence de caméra.</li>'
  + '<li><b>Les assets inutilisés</b> dans la scène courante.</li>'
  + '<li><b>La jouabilité</b> d\'un niveau de plateforme : plateformes hors d\'atteinte, objets à '
  + 'ramasser inaccessibles, absence d\'objectif.</li>'
  + '</ul>'
  + trapHelp('<b>« Inutilisé » veut dire « inutilisé dans CETTE scène ».</b> Un matériau employé '
    + 'dans un autre niveau sera quand même signalé. Ne le supprimez pas sur la foi de ce message.')
  + trapHelp('<b>L\'analyse de jouabilité ne s\'exécute que si un objet porte le tag '
    + '<code>sol</code></b>, et elle ne dit pas qu\'elle s\'est abstenue.')
  + advancedHelp('La portée du saut',
    '<p>Elle est <b>déduite du script</b> de l\'objet tagué <code>joueur</code>. Faute de le trouver, '
    + 'l\'analyseur prend des valeurs par défaut et le dit dans le message : ces distances ne sont '
    + 'pas des mesures.</p>')
  + '<p>Pour le <b>coût</b> d\'une scène, c\'est ' + linkHelp('profiler', 'le profiler') + ' qu\'il '
  + 'faut ouvrir : une scène juste peut être lente, une scène rapide injouable.</p>'
  + '<h3>Voir aussi</h3>'
  + '<ul><li>' + linkHelp('panel-console', 'La console') + '</li></ul>';
}},

{id:'copilot', part:'interface', section:'Outils', title:'Le copilote IA',
 level:'both',
 summary:'Une discussion avec un modèle qui agit dans l\'éditeur par les mêmes commandes que vous.',
 anchors:[
   {f:'js/copilot.js', c:'const COMMANDS = ['},
   {f:'js/copilot.js', c:"COPILOT_MODELS = ['claude-sonnet-5'"},
   {f:'js/copilot.js', c:"localStorage.getItem('copilot-key')"},
   {f:'js/copilot.js', c:'pushHistory'},
   {f:'js/copilot.js', c:"Limite de 20 tours atteinte"},
   {f:'js/copilot-observer.js', c:"name: 'play_and_measure'"},
   {f:'js/copilot-observer.js', c:'function captureEmpty'},
   {f:'js/game-runtime.js', c:'window.__stateGame = function(){'}
 ],
 html:function(){ return ''
  + essentialHelp('<p><b>Aide → ✨ Copilote IA</b> ouvre une discussion avec un modèle. Il ne '
    + '« génère » pas la scène : il appelle les mêmes fonctions que vous. Chaque modification passe '
    + 'par l\'historique et s\'annule par <kbd>Ctrl</kbd> + <kbd>Z</kbd>. Relisez ce qu\'il fait.</p>')

  + '<h3>Démarrer</h3>'
  + stepsHelp([
      'Ouvrez le copilote et choisissez le modèle.',
      'Collez votre clé d\'API : elle reste dans ce navigateur et n\'est <b>jamais</b> enregistrée '
        + 'dans les projets.',
      'Décrivez une tâche précise et vérifiable : « ajoute trois plateformes et vérifie que le héros '
        + 'y monte ».'
    ])
  + '<p>Deux familles sont câblées — <b>Claude</b> et <b>ChatGPT</b> — et le champ <b>Adresse</b> '
  + 'permet tout service « compatible OpenAI ». Le catalogue d\'outils est le même pour tous.</p>'
  + trapHelp('<b>Un message d\'outil ChatGPT ne peut pas porter d\'image.</b> Les commandes de '
    + 'capture le disent au modèle ; utilisez <code>check</code>, qui rend des nombres.')
  + '<p>Une demande enchaîne au plus <b>20 allers-retours</b> ; au-delà, le copilote s\'arrête et '
  + 'demande de reformuler.</p>'

  + '<h3>Ce que <kbd>Ctrl</kbd> + <kbd>Z</kbd> défait</h3>'
  + '<p>Un pas d\'historique correspond à un <b>geste</b> : créer, supprimer, renommer un asset, '
  + 'régler ses paramètres d\'import, modifier un matériau, éditer un script — tout s\'annule. Une '
  + 'session d\'édition de code compte pour un seul pas ; la pile garde les <b>50</b> derniers.</p>'
  + trapHelp('Pour revenir mot à mot dans du code, utilisez le <kbd>Ctrl</kbd> + <kbd>Z</kbd> de la '
    + 'fenêtre d\'édition, pas celui de l\'éditeur : ce sont deux annulations distinctes.')

  + '<h3>Ce qu\'il sait faire</h3>'
  + renderCommandsHelp()
  + '<p><code>create_texture</code> et <code>create_sound</code> <b>fabriquent</b> des images et des '
  + 'bruitages sans fichier source ; le bouton <b>🎲 Fabriquer</b> du panneau Projet appelle la même '
  + 'fonction. ' + linkHelp('assets-made', 'Voir les assets fabriqués') + '.</p>'
  + '<p>Quatre commandes servent à <b>conduire</b> la session : '
  + linkHelp('copilot-driving', 'conduire une session avec une IA') + '.</p>'

  + '<h3>Voir, essayer, mesurer</h3>'
  + arrayHelp(['Commande', 'Ce qu\'elle rend', 'Pourquoi'], [
      ['<code>capture_view</code>', 'une IMAGE de la vue d\'édition',
       'un cadrage ou un objet hors champ ne se voient pas dans le texte d\'une commande'],
      ['<code>play_and_measure</code>', 'le jeu lancé pour de vrai, les positions au fil du temps et '
       + 'une image', 'c\'est la SEULE qui dit si le jeu fonctionne'],
      ['<code>check</code>', 'le rapport pixel de chaque caméra, les boîtes de collision, les '
       + 'problèmes de chaque map', 'ce sont les nombres qui décident']
    ])
  + '<p><code>play_and_measure</code> lance la vraie page de jeu dans un cadre invisible et relève '
  + 'les positions à plusieurs instants : seule la trajectoire distingue un héros tombé dans un trou '
  + 'd\'un héros posé au sol.</p>'
  + trapHelp('<b>Toutes ses commandes peuvent réussir et produire un jeu injouable.</b> Finissez par '
    + linkHelp('analysis', 'analyser la scène') + ' — ou mieux, par <code>play_and_measure</code>.')

  + advancedHelp('Un agent externe : le pont MCP',
    // Le compte est CALCULÉ : un nombre écrit à la main n'a pas d'ancre, rien ne le rattrape.
    '<p>Le catalogue complet — ' + COMMANDS_HELP.length + ' commandes — est aussi publié en '
    + '<b>Model Context Protocol</b> par <code>moteur/mcp/serveur-mcp.mjs</code>. N\'importe quel '
    + 'client MCP peut donc piloter l\'éditeur, ouvert avec le plugin « pont MCP » actif : tout est '
    + 'local, sur <code>127.0.0.1</code>, avec un jeton tiré au hasard à chaque démarrage.</p>')
  + '<h3>Voir aussi</h3>'
  + '<ul><li>' + linkHelp('copilot-driving', 'Conduire une session') + '</li>'
  + '<li>' + linkHelp('scripts-api', 'L\'objet api') + '</li></ul>';
}},

{id:'copilot-driving', part:'interface', section:'Outils', title:'Conduire une session avec une IA',
 level:'advanced',
 summary:'Résumé de scène, document de conception et points de reprise : mener une session sans perdre son travail.',
 anchors:[
   {f:'js/copilot-workshop.js', c:'const DESIGN_MAX = 20000;'},
   {f:'js/copilot-workshop.js', c:'resumes.set(n, JSON.parse(JSON.stringify(stateCurrent())));'},
   {f:'js/copilot-workshop.js', c:'function goBackAtPointOfResume(name){'},
   {f:'js/copilot-workshop.js', c:"name: 'summarize_scene',"},
   {f:'js/project-settings.js', c:'design: brut.design ?? null,'},
   {f:'js/copilot.js', c:'Limite de 20 tours atteinte'}
 ],
 html:function(){ return ''
  + essentialHelp('<p>Commencez par <code>read_design</code> puis <code>summarize_scene</code>, '
    + 'posez un <code>checkpoint</code> avant de modifier, vérifiez par <code>play_and_measure</code>, '
    + 'et finissez par <code>write_design</code>.</p>')

  + '<h3>Se repérer sans noyer la conversation</h3>'
  + '<p><code>summarize_scene</code> rend un <b>résumé</b> : objets par type, composants, assets par '
  + 'genre, bounds du décor 2D, points de reprise. <code>list_scene</code> rend <b>tout</b>.</p>'
  + trapHelp('Un inventaire complet remplit la conversation, et un modèle dont le contexte est saturé '
    + '<b>oublie le début</b> — donc vos consignes. Il ne le dit pas : il devient moins obéissant.')

  + '<h3>Le document de conception</h3>'
  + '<p><code>read_design</code> et <code>write_design</code> tiennent un document qui dit '
  + 'l\'intention, les règles, les réglages choisis <b>et pourquoi</b>, et ce qui a été essayé sans '
  + 'succès. Il <b>voyage avec le projet</b> (dans le manifeste) et se lit aussi dans les '
  + linkHelp('settings', 'Paramètres du projet') + '.</p>'
  + trapHelp('<b>La limite est de 20 000 caractères, et c\'est le DÉBUT qui est coupé.</b> Réécrivez '
    + 'en tête ce qui compte durablement.')

  + '<h3>Les points de reprise</h3>'
  + '<p><code>checkpoint</code> enregistre l\'état <b>complet</b> de la scène sous un nom, '
  + '<code>go_back</code> y retourne d\'un geste — lui-même annulable par <kbd>Ctrl</kbd> + '
  + '<kbd>Z</kbd>.</p>'
  + trapHelp('<b>Les points de reprise ne sont PAS enregistrés dans le projet.</b> Ils disparaissent '
    + 'en fermant l\'onglet. Pour garder un état, enregistrez le projet.')

  + '<h3>Une session qui se passe bien</h3>'
  + stepsHelp([
      '<code>read_design</code>, puis <code>summarize_scene</code> : l\'intention avant l\'inventaire.',
      '<code>checkpoint</code> avant la première modification.',
      'Construire — et finir par <code>play_and_measure</code>, pas par « c\'est fait ».',
      '<code>write_design</code> en fin de session, y compris ce qui n\'a pas marché.'
    ])
  + tipHelp('Une demande enchaîne au plus <b>20 allers-retours</b> : assez pour une tâche précise, '
    + 'pas pour « fais-moi un jeu ».')
  + advancedHelp('Ce qu\'aucune commande ne rend',
    '<p>Le jugement. Un modèle peut établir qu\'un héros atterrit à −7,55 ; il ne peut pas établir '
    + 'qu\'un saut est <b>agréable</b>. Cette part reste la vôtre.</p>')
  + '<h3>Voir aussi</h3>'
  + '<ul><li>' + linkHelp('copilot', 'Le copilote IA') + '</li></ul>';
}},

];
