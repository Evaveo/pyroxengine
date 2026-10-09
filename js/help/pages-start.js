// ---------- Aide de l'éditeur : partie « start » (Prise en main) ----------
// Une page = {id, part, section, title, level, summary, anchors, html}. Les ancres sont
// vérifiées par test/aide.test.mjs (voir l'en-tête de js/help-content.js).
import { advancedHelp, arrayHelp, essentialHelp, linkHelp, stepsHelp, tipHelp, trapHelp } from './help-format.js';
import { renderShortcutsHelp } from '../help-page.js';

export const PAGES_START = [

{id:'getting-started', part:'start', section:'Prise en main', title:'Bienvenue dans le manuel',
 level:'beginner',
 summary:'Comment ce manuel est organisé, comment trouver la bonne page, et par où commencer.',
 anchors:[
   {f:'js/help.js', c:'export const HELP_PAGE_OF_PANEL = {'},
   {f:'js/help.js', c:"const card = el.closest('[data-typename]');"},
   {f:'js/ui/dock.js', c:"help.title = 'Aide sur ce panneau (F1)';"},
   {f:'js/inspector.js', c:'title="Aide sur ce composant (F1)">?</button>'},
   {f:'js/viewport.js', c:"if(e.key === 'F1')"}
 ],
 html:function(){ return ''
  + essentialHelp('<p>Ce manuel s\'ouvre dans un onglet à part, pour que vous puissiez lire et '
    + 'essayer en même temps, l\'éditeur à côté. Vous n\'avez pas besoin de le lire en entier : '
    + 'appuyez sur <kbd>F1</kbd> au-dessus de ce qui vous intrigue, et la bonne page s\'ouvre.</p>'
    + '<p>Pour débuter : lisez ' + linkHelp('first-scene', 'Créer sa première scène') + ', puis '
    + linkHelp('units', 'Unités et échelles') + '.</p>')

  + '<h3>Comment le manuel est organisé</h3>'
  + arrayHelp(['Partie', 'Ce que vous y trouvez'], [
      ['<b>Prise en main</b>', 'Les premiers pas, les unités, les ' + linkHelp('shortcuts', 'raccourcis') + '.'],
      ['<b>Interface</b>', 'Une page par panneau : ' + linkHelp('panel-hierarchy', 'Hiérarchie') + ', '
        + linkHelp('panel-viewport', 'Vue') + ', ' + linkHelp('panel-inspector', 'Inspecteur') + ', '
        + linkHelp('panel-project', 'Projet') + ', ' + linkHelp('panel-console', 'Console') + ', '
        + linkHelp('panel-environment', 'Environnement') + ' ; les ' + linkHelp('menus', 'menus')
        + ', les ' + linkHelp('settings', 'réglages') + ', le ' + linkHelp('play-mode', 'mode Jeu')
        + ' et les outils (' + linkHelp('profiler', 'profiler') + ', ' + linkHelp('analysis', 'analyse')
        + ', ' + linkHelp('copilot', 'copilote IA') + ').'],
      ['<b>Workflows</b>', 'Comment faire une chose précise de bout en bout : importer un modèle, '
        + 'animer, cuire l\'éclairage, publier — par exemple ' + linkHelp('import-model', 'importer un modèle') + '.'],
      ['<b>Composants</b>', 'Une fiche par composant : chaque propriété, sa valeur par défaut, son rôle.'],
      ['<b>Scripts</b>', 'Écrire du comportement en JavaScript : ' + linkHelp('scripts', 'les scripts')
        + ' et ' + linkHelp('scripts-api', 'l\'objet api') + '.'],
      ['<b>Tutoriels</b>', 'Des exercices guidés, du début à la fin d\'un petit jeu.'],
      ['<b>Référence</b>', 'Les tableaux complets et le glossaire.']
    ])

  + '<h3>Deux niveaux de lecture</h3>'
  + '<p>Chaque page porte un badge : <b>Débutant</b>, <b>Avancé</b> ou <b>Tous niveaux</b>. '
  + 'En tête, l\'encadré « L\'essentiel » dit ce qu\'il faut retenir si l\'on ne lit que lui. '
  + 'Les détails internes sont dans des blocs <b>Avancé</b> repliés : ils ne gênent pas la '
  + 'lecture, et la recherche les trouve quand même.</p>'

  + '<h3>Trouver la bonne page depuis l\'éditeur</h3>'
  + stepsHelp([
      'Le bouton <b>?</b> de chaque <b>composant</b> de l\'inspecteur ouvre la fiche de ce composant.',
      'Le bouton <b>?</b> de chaque barre d\'onglets du dock ouvre la page du <b>panneau actif</b> '
        + 'de cette zone.',
      '<kbd>F1</kbd> ouvre la page de ce qui est <b>sous la souris</b> : un composant d\'abord, '
        + 'sinon le panneau, sinon cette page d\'accueil.'
    ])
  + tipHelp('<kbd>F1</kbd> fonctionne même quand le curseur est dans un champ de saisie : c\'est '
    + 'souvent là qu\'on se demande quoi écrire.')
  + advancedHelp('Un seul onglet d\'aide',
    '<p>L\'aide est ouverte dans un onglet nommé, réutilisé à chaque appel : dix pressions sur '
    + '<kbd>F1</kbd> n\'ouvrent pas dix onglets. Si le navigateur bloque les fenêtres, la barre '
    + 'd\'état le dit. La correspondance panneau → page est la table '
    + '<code>HELP_PAGE_OF_PANEL</code> de <code>js/help.js</code>, vérifiée par les tests : un '
    + '« ? » ne mène jamais à une page introuvable.</p>')

  + '<h3>Trois choses qui surprennent au début</h3>'
  + '<ul>'
  + '<li><b>Les primitives ne mesurent pas 1.</b> Le cube natif fait 1,6 unité. '
  + linkHelp('units', 'Voir les unités') + '.</li>'
  + '<li><b>Un objet ne se déplace qu\'au gizmo</b> : un clic dans la vue sélectionne, il ne '
  + 'saisit pas. ' + linkHelp('panel-viewport', 'Voir la vue') + '.</li>'
  + '<li><b>▶ Jouer ouvre un nouvel onglet</b>, il ne fige pas l\'éditeur. '
  + linkHelp('play-mode', 'Voir le mode Jeu') + '.</li>'
  + '</ul>'

  + '<h3>Voir aussi</h3>'
  + '<ul><li>' + linkHelp('first-scene', 'Créer sa première scène') + '</li>'
  + '<li>' + linkHelp('glossary', 'Glossaire') + '</li></ul>';
}},

{id:'first-scene', part:'start', section:'Prise en main', title:'Créer sa première scène',
 level:'beginner',
 summary:'Créer des objets, les placer au gizmo, enregistrer et lancer le jeu.',
 anchors:[
   {f:'js/ui.js', c:"{title:'Objet', items:[]},"},
   {f:'js/objects.js', c:'export function itemsCreationContext(onCree){'},
   {f:'js/primitive-geometry.js', c:'new THREE.BoxGeometry(1.6, 1.6, 1.6)'},
   {f:'js/viewport.js', c:"if(e.key === '1') setModeGizmo('translate');"},
   {f:'js/ui.js', c:"{label:'Enregistrer', shortcut:'Ctrl+S', action:function(){ saveProject(); }},"},
   {f:'js/autosave.js', c:'export const autosave = {intervalleMs: 3 * 60 * 1000, modifie:false};'},
   {f:'js/play-mode.js', c:"window.open('game-preview.html', '_blank');"}
 ],
 html:function(){ return ''
  + essentialHelp('<p>Créez un objet par le menu <b>Objet</b>, déplacez-le avec le gizmo '
    + '(<kbd>1</kbd> / <kbd>2</kbd> / <kbd>3</kbd>), réglez-le dans l\'inspecteur, enregistrez par '
    + '<b>Fichier → Enregistrer</b>, puis cliquez <b>▶ Jouer</b>.</p>')

  + '<h3>1. Créer des objets</h3>'
  + stepsHelp([
      'Ouvrez le menu <b>Objet</b> de la barre du haut et choisissez <b>Cube</b>.',
      'Ou faites un <b>clic droit</b> dans la ' + linkHelp('panel-hierarchy', 'hiérarchie')
        + ' : le même choix d\'objets s\'affiche. Sur un nœud, l\'objet créé devient son enfant.',
      'Le nouvel objet apparaît dans la hiérarchie et il est sélectionné : l\''
        + linkHelp('panel-inspector', 'inspecteur') + ' montre ses réglages.'
    ])
  + tipHelp('Créez aussi un <b>Plan</b> pour servir de sol : il mesure 4 × 4 m et il est couché.')

  + '<h3>2. Placer les objets</h3>'
  + stepsHelp([
      'Appuyez sur <kbd>1</kbd> (déplacer), <kbd>2</kbd> (tourner) ou <kbd>3</kbd> (échelle).',
      'Tirez une flèche ou un anneau du gizmo dans la vue.',
      'Pour une valeur exacte, tapez-la dans le Transform de l\'inspecteur.',
      'Appuyez sur <kbd>F</kbd> pour cadrer la caméra sur l\'objet sélectionné.'
    ])
  + trapHelp('<b>Le pivot est au centre.</b> Un cube posé à <code>y = 0</code> est à moitié '
    + 'enterré : <b>Objet → ⇩ Poser au sol</b> le remonte.')

  + '<h3>3. Enregistrer</h3>'
  + '<p><b>Fichier → Enregistrer</b> écrit le projet. Le bouton d\'état de la barre du haut dit '
  + 's\'il reste des modifications non enregistrées. Une sauvegarde automatique a lieu toutes les '
  + '3 minutes si quelque chose a changé ; elle se récupère par <b>Fichier → Récupérer la '
  + 'sauvegarde automatique…</b>.</p>'

  + '<h3>4. Lancer le jeu</h3>'
  + '<p>Cliquez <b>▶ Jouer</b> en haut à droite : le jeu s\'ouvre dans un nouvel onglet, avec le '
  + 'même code qu\'un build exporté. ' + linkHelp('play-mode', 'Voir le mode Jeu') + '.</p>'
  + trapHelp('Sans caméra dans la scène, le jeu n\'a rien à montrer. '
    + linkHelp('analysis', 'Analyser la scène') + ' signale cette absence.')

  + advancedHelp('Ce que fait un clic sur Cube',
    '<p>Le menu Objet est construit depuis la même liste de types créables que les menus '
    + 'contextuels de la vue et de la hiérarchie (<code>itemsCreationContext</code>, '
    + '<code>js/objects.js</code>). Chaque création pose un pas d\'historique : '
    + '<kbd>Ctrl</kbd> + <kbd>Z</kbd> la défait.</p>')

  + '<h3>Voir aussi</h3>'
  + '<ul><li>' + linkHelp('units', 'Unités et échelles') + '</li>'
  + '<li>' + linkHelp('shortcuts', 'Raccourcis') + '</li>'
  + '<li>' + linkHelp('project', 'Le format de projet') + '</li></ul>';
}},

{id:'units', part:'start', section:'Prise en main', title:'Unités et échelles',
 level:'both',
 summary:'1 unité = 1 mètre ; les tailles réelles des primitives, et pourquoi l\'échelle n\'est pas une taille.',
 anchors:[
   {f:'js/primitive-geometry.js', c:'new THREE.SphereGeometry(1, s.sphere.width, s.sphere.height)'},
   {f:'js/primitive-geometry.js', c:'new THREE.CylinderGeometry(0.8, 0.8, 1.8, s.cylinder.radial)'},
   {f:'js/primitive-geometry.js', c:'new THREE.ConeGeometry(1, 2, s.cone.radial)'},
   {f:'js/primitive-geometry.js', c:'new THREE.TorusGeometry(1, 0.4, s.torus.radial, s.torus.tubular)'},
   {f:'js/primitive-geometry.js', c:'new THREE.PlaneGeometry(4, 4)'},
   {f:'js/import-settings.js', c:"L'ÉDITEUR TRAVAILLE EN MÈTRES"}
 ],
 html:function(){ return ''
  + essentialHelp('<p><b>1 unité = 1 mètre.</b> Les primitives ne mesurent pas 1 : le cube fait '
    + '1,6 m. Une échelle multiplie cette taille, elle ne la remplace pas.</p>')
  + '<p>C\'est la convention de glTF, et celle de la gravité de la physique. Un modèle importé '
  + 'est ramené en mètres à partir de l\'unité déclarée par son fichier : un export Maya ou 3ds '
  + 'Max en centimètres arrive donc à la bonne taille sans rien régler. '
  + linkHelp('import-model', 'Voir l\'import de modèles') + '.</p>'

  + '<h3>Tailles réelles des primitives</h3>'
  + arrayHelp(['Primitive', 'Taille en mètres', 'Géométrie'], [
      ['Cube', '1,6 × 1,6 × 1,6', '<code>BoxGeometry(1.6, 1.6, 1.6)</code>'],
      ['Sphère', '2 × 2 × 2', '<code>SphereGeometry(1, …)</code> — rayon 1'],
      ['Cylindre', '1,6 × 1,8 × 1,6', '<code>CylinderGeometry(0.8, 0.8, 1.8, …)</code>'],
      ['Cône', '2 × 2 × 2', '<code>ConeGeometry(1, 2, …)</code>'],
      ['Tore', '2,8 × 2,8 × 0,8', '<code>TorusGeometry(1, 0.4, …)</code>'],
      ['Plan', '4 × 0 × 4', '<code>PlaneGeometry(4, 4)</code>, couché au sol'],
      ['Étoile', '2 × 1,9 × 0,5', 'construite par <code>js/primitives-extra.js</code>'],
      ['Losange', '2 × 2 × 2', '<code>OctahedronGeometry(1)</code>'],
      ['Pyramide', '2 × 2 × 2', '<code>ConeGeometry(1, 2, 3)</code> — base triangulaire'],
      ['Vague', '2,6 × 1,1 × 0,4', 'tube construit par <code>js/primitives-extra.js</code>'],
      ['Rocher', '2 × 2 × 2', '<code>DodecahedronGeometry(1)</code>'],
      ['Capsule', '1 × 2 × 1', '<code>CapsuleGeometry(0.5, 1)</code>']
    ])
  + '<p>Toutes ont leur <b>pivot au centre</b>. Poser un cube à <code>y = 0</code> l\'enterre '
  + 'donc à moitié ; <b>Objet → Poser au sol</b> le remonte.</p>'

  + trapHelp('<b>L\'échelle n\'est pas une taille.</b> Une échelle de 4 sur un cube donne 6,4 m '
    + 'de large, pas 4. Aucune erreur n\'est levée : six plateformes se chevauchent et le niveau a '
    + 'l\'air simplement mal dessiné.')
  + advancedHelp('Mesurer depuis un script',
    '<p><code>api.bounds(objet).taille</code> donne la dimension RÉELLE, échelle comprise — c\'est '
    + 'ce qu\'il faut lire pour espacer des objets. ' + linkHelp('scripts-api', 'Voir l\'objet api') + '.</p>')

  + '<h3>Voir aussi</h3>'
  + '<ul><li>' + linkHelp('first-scene', 'Créer sa première scène') + '</li>'
  + '<li>' + linkHelp('physics', 'La physique') + '</li></ul>';
}},

{id:'shortcuts', part:'start', section:'Prise en main', title:'Raccourcis clavier et souris',
 level:'both',
 summary:'La liste complète des raccourcis, engendrée depuis le code qui les traite.',
 anchors:[
   {f:'js/viewport.js', c:"if(e.key === 'F1')"},
   {f:'js/viewport.js', c:"e.target.tagName === 'INPUT'"}
 ],
 html:function(){ return ''
  + essentialHelp('<p><kbd>1</kbd> / <kbd>2</kbd> / <kbd>3</kbd> changent de gizmo, <kbd>F</kbd> '
    + 'cadre la sélection, <kbd>Ctrl</kbd> + <kbd>Z</kbd> annule, clic droit + <kbd>W</kbd>'
    + '<kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> fait voler la caméra, <kbd>F1</kbd> ouvre l\'aide.</p>')
  + '<p>La liste complète, telle que le code la traite. Les raccourcis de l\'éditeur vivent '
  + 'dans <code>js/viewport.js</code> ; ceux de la sculpture de terrain, dans '
  + '<code>js/terrain.js</code> (' + linkHelp('terrain', 'voir le terrain') + ').</p>'
  + renderShortcutsHelp()
  + trapHelp('<b>Un champ de saisie avale les raccourcis</b> — c\'est voulu : taper « f » dans un '
    + 'champ de nom ne doit pas recadrer la caméra. Si <kbd>Suppr</kbd> ou <kbd>1</kbd> semble ne '
    + 'rien faire, le curseur est probablement encore dans un champ de l\'inspecteur : cliquez '
    + 'd\'abord dans la vue. <kbd>F1</kbd> est la seule exception, traitée AVANT ce filtre.')
  + '<h3>Voir aussi</h3>'
  + '<ul><li>' + linkHelp('panel-viewport', 'La vue et la navigation') + '</li>'
  + '<li>' + linkHelp('menus', 'Les menus') + '</li></ul>';
}},

];
