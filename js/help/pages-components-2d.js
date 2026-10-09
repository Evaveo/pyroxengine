// ---------- Aide de l'éditeur : fiches de composants (2d) ----------
// Les fiches des composants 2D, d'interface, de réalité virtuelle et de gameplay (stratégie).
// Chaque affirmation est adossée à une ancre : test/aide.test.mjs vérifie qu'elle existe encore.
import { advancedHelp, arrayHelp, defaultHelp, essentialHelp, linkHelp, propsHelp, stepsHelp, termHelp, tipHelp, trapHelp } from './help-format.js';

// Étapes communes : ajouter un composant par le bouton de l'inspecteur.
function addSteps(label, extra){
  return stepsHelp([
    'Sélectionnez l\'objet dans la hiérarchie ou dans la vue.',
    'Dans l\'inspecteur, cliquez sur <b>+ Composant</b>.',
    'Choisissez <b>' + label + '</b> dans la liste.'
  ].concat(extra || []));
}

export const PAGES_COMPONENTS_2D = [

// ---------------------------------------------------------------- SpriteRenderer
{id:'component-SpriteRenderer', part:'components', section:'2D', title:'Sprite (SpriteRenderer)', level:'both',
 summary:'Affiche une image 2D, découpée dans une planche de sprites.',
 anchors:[
   {f:'js/components/component-sprite.js', c:"static get typeName() { return 'SpriteRenderer'; }"},
   {f:'js/components/component-sprite.js', c:"teinte:'#ffffff', retourneX:false, retourneY:false,"},
   {f:'js/components/component-sprite.js', c:"return (Array.isArray(l) && l.length) ? l : ['Fond', 'Décor', 'Jeu', 'Premier plan', 'Interface'];"},
   {f:'js/ui/panels-components.js', c:"label: 'Trier par profondeur'"}
 ],
 html:function(){ return ''
  + essentialHelp('<p>Le <b>Sprite</b> affiche une image 2D sur l\'objet : une des images découpées dans une '
    + '<b>planche</b> (un asset sprite du panneau Projet). C\'est la brique de base de tout jeu 2D : '
    + 'personnage, décor, objet à ramasser.</p>')
  + '<h3>Ajouter le composant</h3>'
  + addSteps('Sprite', ['Choisissez la planche, puis l\'<b>Image</b> à afficher.'])
  + tipHelp('<p>Plus rapide : faites glisser une planche du panneau Projet dans la vue. Le sprite est créé tout seul.</p>')
  + '<h3>Propriétés</h3>'
  + propsHelp([
      ['Image', 'region', '', 'L\'image de la planche affichée (le nom de sa découpe).'],
      ['Calque', 'layer', 'Jeu', 'Le calque de tri : un calque plus haut dans la liste du projet passe devant.'],
      ['Trier par profondeur', 'sortDepth', 'non', 'Vue de dessus : ce qui est plus bas à l\'écran passe devant.'],
      ['Ordre', 'order', '0', 'Le rang à l\'intérieur du calque (de −499 à 499).'],
      ['Teinte', 'teinte', '#ffffff', 'Multiplie les couleurs de l\'image. Blanc = image d\'origine.'],
      ['Retourner X', 'retourneX', 'non', 'Retourne l\'image horizontalement.'],
      ['Retourner Y', 'retourneY', 'non', 'Retourne l\'image verticalement.']
    ])
  + '<h3>Utilisation</h3>'
  + '<p>Les calques par défaut d\'un projet sont, de l\'arrière vers l\'avant : <i>Fond</i>, <i>Décor</i>, '
  + '<i>Jeu</i>, <i>Premier plan</i>, <i>Interface</i>.</p>'
  + tipHelp('<p>Pour un jeu vu de dessus, cochez <b>Trier par profondeur</b> sur les personnages et les objets '
    + 'du monde, mais pas sur le sol : un décor de fond passerait sinon devant le héros.</p>')
  + '<h3>Exemples de scripts</h3>'
  + '<p>Changer l\'image affichée, par exemple quand le héros prend un coup. <code>api.spriteImage</code> rend '
  + '<code>false</code> si l\'image n\'existe pas dans la planche.</p>'
  + '<pre><code>function start(api){\n'
  + '  api.on(\'touche\', function(){\n'
  + '    api.spriteImage(\'heros_blesse\');\n'
  + '    api.after(0.3, function(){ api.spriteImage(\'heros_repos\'); });\n'
  + '  });\n'
  + '}</code></pre>'
  + '<p>Tourner le personnage vers la direction où il marche, en retournant l\'image.</p>'
  + '<pre><code>function update(api){\n'
  + '  const x = api.axis(\'horizontal\');\n'
  + '  if(x === 0) return;\n'
  + '  const s = api.me.getComponent(\'SpriteRenderer\');\n'
  + '  s.data.retourneX = x &lt; 0;\n'
  + '  api.spriteImage(s.data.region); // réapplique l\'image avec le retournement\n'
  + '}</code></pre>'
  + '<p>Changer le sprite d\'un AUTRE objet : un coffre qui s\'ouvre quand le joueur le touche.</p>'
  + '<pre><code>function start(api){\n'
  + '  api.onContact(\'coffre\', function(coffre){\n'
  + '    api.spriteImage(coffre, \'coffre_ouvert\');\n'
  + '  });\n'
  + '}</code></pre>'
  + '<p>Faire apparaître un sprite en jeu : <code>api.create</code> accepte le nom d\'une planche.</p>'
  + '<pre><code>const piece = api.create(\'Piece\', {x: 2, y: 1, z: 0});</code></pre>'
  + advancedHelp('Retourner plutôt que mettre une échelle négative',
      '<p><b>Retourner X/Y</b> inverse les coordonnées de texture, pas l\'échelle de l\'objet : les enfants et '
    + 'le collider ne sont pas retournés avec l\'image.</p>')
  + trapHelp('<p><b>Trier par profondeur</b> est désactivé par défaut. Sur un jeu vu de dessus, un personnage '
    + 'sans ce réglage peut passer derrière un arbre placé plus haut que lui, sans aucun message.</p>')
  + '<h3>Voir aussi</h3><ul>'
  + '<li>' + linkHelp('component-SpriteAnimator', 'Animation de sprite') + '</li>'
  + '<li>' + linkHelp('game-2d', 'Faire un jeu 2D') + '</li>'
  + '</ul>';
}},

// ---------------------------------------------------------------- SpriteAnimator
{id:'component-SpriteAnimator', part:'components', section:'2D', title:'Animation de sprite (SpriteAnimator)', level:'both',
 summary:'Joue une suite d\'images sur le Sprite du même objet.',
 anchors:[
   {f:'js/components/component-anim-sprite.js', c:"static get typeName(){ return 'SpriteAnimator'; }"},
   {f:'js/components/component-anim-sprite.js', c:"{defaultValue: '', speed: 1, auto: true}"},
   {f:'js/scripts.js', c:'playSequence: function(target, name, forcer){'},
   {f:'js/anim-sprite.js', c:'if(r.finished && a.defaultValue && e.sequence !== a.defaultValue) startAnimSprite(e, a.defaultValue);'}
 ],
 html:function(){ return ''
  + essentialHelp('<p>L\'<b>Animation de sprite</b> fait défiler des images : marcher, sauter, attaquer. Elle '
    + 'travaille avec le <b>Sprite</b> du même objet, et lit ses <b>suites</b> (listes d\'images) dans la planche '
    + 'de ce sprite.</p>')
  + '<h3>Ajouter le composant</h3>'
  + addSteps('Animation de sprite', ['L\'objet doit déjà porter un <b>Sprite</b>.', 'Choisissez la <b>Suite par défaut</b>.'])
  + '<h3>Propriétés</h3>'
  + propsHelp([
      ['Suite par défaut', 'defaultValue', '(vide)', 'La suite jouée au départ, et celle où l\'on revient quand une suite sans boucle se termine.'],
      ['Vitesse', 'speed', '1', 'Multiplie la cadence de toutes les suites.'],
      ['Jouer au démarrage', 'auto', 'oui', 'Lance la suite par défaut toute seule.']
    ])
  + '<h3>Utilisation</h3>'
  + '<p>Les suites appartiennent à la <b>planche</b>, pas à l\'objet : deux personnages qui partagent la même '
  + 'planche partagent les mêmes suites. Elles se créent dans l\'inspecteur de la planche.</p>'
  + tipHelp('<p>L\'animation tourne <b>aussi en édition</b> : c\'est le moyen de juger une cadence sans lancer le jeu.</p>')
  + '<h3>Exemples de scripts</h3>'
  + '<p>Courir ou rester au repos selon la touche enfoncée.</p>'
  + '<pre><code>function update(api){\n'
  + '  if(api.axis(\'horizontal\') !== 0) api.playSequence(\'course\');\n'
  + '  else api.playSequence(\'repos\');\n'
  + '}</code></pre>'
  + '<p>Au clic (<code>api.clickHeld()</code> : enfoncé à cette image), jouer une attaque jusqu\'au bout, puis revenir au repos. Le troisième argument <code>true</code> '
  + 'force le redémarrage de la suite.</p>'
  + '<pre><code>function update(api){\n'
  + '  if(api.clickHeld() &amp;&amp; api.currentSequence() !== \'attaque\'){\n'
  + '    api.playSequence(api.me, \'attaque\', true);\n'
  + '    api.after(0.4, function(){ api.playSequence(\'repos\'); });\n'
  + '  }\n'
  + '}</code></pre>'
  + '<p>Accélérer l\'animation pendant un bonus de vitesse (<code>speed</code> multiplie la cadence).</p>'
  + '<pre><code>api.me.getComponent(\'SpriteAnimator\').data.speed = 2;</code></pre>'
  + '<p>Rejouer la suite déjà en cours ne la redémarre pas : on peut appeler <code>api.playSequence</code> à chaque image.</p>'
  + advancedHelp('Plusieurs fichiers pour un même personnage',
      '<p>L\'animateur lit toutes ses suites dans une seule planche. Un personnage livré en plusieurs fichiers '
    + 'doit d\'abord être assemblé en une planche, depuis l\'inspecteur d\'une planche.</p>')
  + trapHelp('<p>Sans <b>Sprite</b> sur le même objet, l\'animateur n\'a rien à animer et ne dit rien.</p>')
  + '<h3>Voir aussi</h3><ul>'
  + '<li>' + linkHelp('component-SpriteRenderer', 'Sprite') + '</li>'
  + '<li>' + linkHelp('game-2d', 'Faire un jeu 2D') + '</li>'
  + '</ul>';
}},

// ---------------------------------------------------------------- Tilemap
{id:'component-Tilemap', part:'components', section:'2D', title:'Tilemap (Tilemap)', level:'both',
 summary:'Une grille de tuiles peinte au pinceau, avec ses collisions.',
 anchors:[
   {f:'js/components/component-tilemap.js', c:"static get typeName(){ return 'Tilemap'; }"},
   {f:'js/components/component-tilemap.js', c:"return { label: 'Map de tuiles', icon: '▦ ', components: [{ type: 'Tilemap' }] };"},
   {f:'js/component-data.js', c:"plane: 'xy', cellSize: 0.5, width: 32, height: 18, originX: 0, originY: 0,"},
   {f:'js/component-data.js', c:"paletteId: null, layer: 'Décor', order: 0, collision: 'solid'"}
 ],
 html:function(){ return ''
  + essentialHelp('<p>La <b>Tilemap</b> est une grille de cases où l\'on peint le décor d\'un niveau : sol, murs, '
    + 'plateformes. Les tuiles viennent d\'une <b>palette</b> (un asset du projet), et les cases pleines deviennent '
    + 'des collisions.</p>')
  + '<h3>Ajouter le composant</h3>'
  + stepsHelp([
      'Créez une <b>Map de tuiles</b> depuis le menu de création : l\'objet naît au centre de la vue.',
      'Dans l\'inspecteur, choisissez la <b>Palette</b>.',
      'Peignez avec la barre du pinceau, qui apparaît sous les onglets quand la map est visée.'
    ])
  + '<h3>Propriétés</h3>'
  + propsHelp([
      ['Plan', 'plane', 'xy', 'XY face à l\'écran, XZ à plat au sol, YZ de profil.'],
      ['Palette', 'paletteId', '— aucune —', 'L\'asset palette qui fournit les tuiles.'],
      ['Colonnes', 'width', '32', 'Largeur de la grille, en cases.'],
      ['Rangées', 'height', '18', 'Hauteur de la grille, en cases.'],
      ['Taille de cellule (unités)', 'cellSize', '0.5', 'Côté d\'une case.'],
      ['Calque', 'layer', 'Décor', 'Le calque de tri, comme pour un Sprite.'],
      ['Ordre', 'order', '0', 'Le rang dans le calque.'],
      ['Collision', 'collision', 'solid', '« Selon les tuiles de la palette » ou « Aucune (décor) ».']
    ])
  + '<h3>Utilisation</h3>'
  + '<p>L\'inspecteur affiche le nombre de cases posées et le nombre de <b>boîtes de collision</b> : les cases '
  + 'voisines sont regroupées en bandes, et c\'est ce second chiffre que la physique teste à chaque image.</p>'
  + tipHelp('<p>Chaque tuile règle sa propre collision dans la palette : Aucune, Solide ou Plateforme. Mettez '
    + '<b>Collision</b> sur « Aucune » pour une map de pur décor de fond.</p>')
  + '<h3>Exemples de scripts</h3>'
  + '<p>Lire la tuile sous le personnage : de la lave (tuile n° 5) le renvoie au départ. Sans argument, '
  + '<code>api.tileAt()</code> lit sous l\'objet qui porte le script (0 = vide).</p>'
  + '<pre><code>function update(api){\n'
  + '  if(api.tileAt() === 5) api.setPosition(api.me, {x: 0, y: 2, z: 0});\n'
  + '}</code></pre>'
  + '<p>Casser un mur : effacer la case à un point du monde. L\'affichage ET la collision sont reconstruits.</p>'
  + '<pre><code>function update(api){\n'
  + '  if(api.actionPressed(\'interact\')){\n'
  + '    const p = api.me.position;\n'
  + '    api.setTile(\'Murs\', {x: p.x + 1, y: p.y}, 0); // la carte nommée « Murs »\n'
  + '  }\n'
  + '}</code></pre>'
  + '<p>Ouvrir une porte quand un levier envoie un message : la case de porte devient une case de sol (n° 2).</p>'
  + '<pre><code>function start(api){\n'
  + '  api.on(\'levier\', function(){ api.setTile(\'Murs\', {x: 12, y: 3}, 2); });\n'
  + '}</code></pre>'
  + advancedHelp('Le stockage des cases',
      '<p>Les cases sont enregistrées compressées (RLE) dans le fichier de scène. Une case hors de la grille vaut '
    + 'vide, sans erreur : peindre jusqu\'au bord est le cas normal.</p>')
  + trapHelp('<p>Une tuile est une boîte : une <b>pente</b> ne se peint pas. Posez un objet avec un '
    + '<b>Collider 2D</b> de forme « Pente ».</p>')
  + '<h3>Voir aussi</h3><ul>'
  + '<li>' + linkHelp('component-Collider2D', 'Collider 2D') + '</li>'
  + '<li>' + linkHelp('game-2d', 'Faire un jeu 2D') + '</li>'
  + '</ul>';
}},

// ---------------------------------------------------------------- Rigidbody2D
{id:'component-Rigidbody2D', part:'components', section:'2D', title:'Corps rigide 2D (Rigidbody2D)', level:'both',
 summary:'Soumet l\'objet à la gravité et à la physique 2D.',
 anchors:[
   {f:'js/components/component-physics-2d.js', c:"static get typeName(){ return 'Rigidbody2D'; }"},
   {f:'js/world-2d.js', c:'{statique:false, withoutGravity:false, speedMax:40}'},
   {f:'js/world-2d.js', c:'const PHYS2D_GRAVITY_DEFAULT = -25;'}
 ],
 html:function(){ return ''
  + essentialHelp('<p>Le <b>Corps rigide 2D</b> fait de l\'objet un corps physique : il tombe, bute sur les obstacles '
    + 'et se pose sur le sol. Il a besoin d\'un <b>Collider 2D</b> pour avoir une taille.</p>')
  + '<h3>Ajouter le composant</h3>'
  + addSteps('Corps rigide 2D', ['Ajoutez aussi un <b>Collider 2D</b>.'])
  + '<h3>Propriétés</h3>'
  + propsHelp([
      ['Statique', 'statique', 'non', 'Le corps ne bouge pas et sert d\'obstacle : sol, mur, plateforme.'],
      ['Sans gravité', 'withoutGravity', 'non', 'Le corps ne tombe pas.'],
      ['Vitesse max', 'speedMax', '40', 'Limite la vitesse du corps (de 1 à 500).']
    ])
  + '<h3>Utilisation</h3>'
  + '<p>La gravité 2D vaut ' + defaultHelp('−25 unités/s²') + ', plus sèche que la Terre : un jeu de plateforme ne '
  + 'l\'imite pas.</p>'
  + tipHelp('<p>Pour un personnage jouable, ajoutez dans l\'ordre : Corps rigide 2D, Collider 2D, puis Contrôleur de personnage 2D.</p>')
  + advancedHelp('Un monde physique à part',
      '<p>La physique 2D est séparée de la physique 3D (composant Physics) : un objet à Corps rigide 2D n\'est '
    + 'simulé que par le solveur 2D.</p>')
  + '<h3>Exemples de scripts</h3>'
  + '<p>Il n\'existe pas d\'entrée d\'API pour lire ou imposer la vitesse d\'un corps 2D (<code>api.velocity</code> et '
  + '<code>api.setVelocity</code> ne servent que la physique 3D). On pilote ses <b>réglages</b>, lus à chaque pas.</p>'
  + '<p>Un pont qui s\'effondre quand le joueur marche dessus : il cesse d\'être statique et tombe.</p>'
  + '<pre><code>function start(api){\n'
  + '  api.onContact(\'joueur\', function(){\n'
  + '    api.after(0.5, function(){\n'
  + '      api.me.getComponent(\'Rigidbody2D\').data.statique = false;\n'
  + '    });\n'
  + '  });\n'
  + '}</code></pre>'
  + '<p>Une zone d\'apesanteur : couper la gravité tant que le joueur est dedans.</p>'
  + '<pre><code>function update(api){\n'
  + '  const joueur = api.find(\'Joueur\');\n'
  + '  joueur.getComponent(\'Rigidbody2D\').data.withoutGravity = api.overlaps2d(joueur, api.me);\n'
  + '}</code></pre>'
  + '<p>Ramener le joueur au point de départ quand il tombe dans le vide.</p>'
  + '<pre><code>function update(api){\n'
  + '  if(api.me.position.y &lt; -20) api.setPosition(api.me, {x: 0, y: 3, z: 0});\n'
  + '}</code></pre>'
  + trapHelp('<p>La physique 2D ne tourne qu\'<b>en jeu</b>, jamais en édition : un objet qui « ne tombe pas » dans '
    + 'la vue de l\'éditeur est normal.</p>')
  + '<h3>Voir aussi</h3><ul>'
  + '<li>' + linkHelp('component-Collider2D', 'Collider 2D') + '</li>'
  + '<li>' + linkHelp('component-CharacterController2D', 'Contrôleur de personnage 2D') + '</li>'
  + '<li>' + linkHelp('component-Physics', 'Physique (3D)') + '</li>'
  + '</ul>';
}},

// ---------------------------------------------------------------- Collider2D
{id:'component-Collider2D', part:'components', section:'2D', title:'Collider 2D (Collider2D)', level:'both',
 summary:'Donne une taille de collision 2D à l\'objet : boîte ou pente.',
 anchors:[
   {f:'js/components/component-physics-2d.js', c:"static get typeName(){ return 'Collider2D'; }"},
   {f:'js/world-2d.js', c:"node.userData.collider2d = {shape:'box', l:1, h:1, dx:0, dy:0,"},
   {f:'js/collider2d-handles.js', c:'if(e.ctrlKey){ p.x = Math.round(p.x * 4) / 4; p.y = Math.round(p.y * 4) / 4; }'},
   {f:'js/collider2d-handles.js', c:'const PICK_PX = 9;'}
 ],
 html:function(){ return ''
  + essentialHelp('<p>Le <b>Collider 2D</b> donne une forme à l\'objet pour les collisions : une boîte, ou une pente. '
    + 'Il se dessine en vert dans la vue, et se règle à la souris en tirant ses poignées.</p>')
  + '<h3>Ajouter le composant</h3>'
  + addSteps('Collider 2D')
  + '<h3>Propriétés</h3>'
  + propsHelp([
      ['Forme', 'shape', 'box', 'Boîte ou Pente.'],
      ['Largeur', 'l', '1', 'Largeur de la forme.'],
      ['Hauteur', 'h', '1', 'Hauteur de la forme.'],
      ['Décalage X', 'dx', '0', 'Décale la forme par rapport à l\'objet.'],
      ['Décalage Y', 'dy', '0', 'Décale la forme verticalement.'],
      ['Monte vers', 'stepUp', 'right', 'Pente : le côté vers lequel elle monte (la droite ou la gauche).'],
      ['Traversable', 'traversable', 'non', 'Plateforme à sens unique : on la traverse par en dessous et on se pose dessus.']
    ])
  + '<h3>Régler à la souris</h3>'
  + stepsHelp([
      'Sélectionnez l\'objet : son contour vert montre des poignées aux coins et au milieu des côtés.',
      'Survolez une poignée : le curseur change de forme.',
      'Tirez-la : le côté opposé reste en place. La barre d\'état affiche la taille et le décalage.',
      'Maintenez <kbd>Ctrl</kbd> pendant le glisser pour aimanter au quart d\'unité.'
    ])
  + tipHelp('<p>Un glisser complet s\'annule d\'un seul <kbd>Ctrl</kbd>+<kbd>Z</kbd>.</p>')
  + advancedHelp('Détail des poignées',
      '<p>Une poignée se saisit à moins de ' + defaultHelp('9 pixels') + ' d\'écran. Les poignées ne répondent pas '
    + 'pendant qu\'on manipule le gizmo de déplacement, ni quand le composant est désactivé. Le code vit dans '
    + '<code>js/collider2d-handles.js</code>.</p>')
  + '<h3>Exemples de scripts</h3>'
  + '<p>Il n\'y a pas de rappel de collision 2D : on teste le chevauchement de deux objets avec '
  + '<code>api.overlaps2d(a, b)</code>, qui compare leurs boîtes.</p>'
  + '<p>Une pièce à ramasser (script posé sur la pièce).</p>'
  + '<pre><code>function update(api){\n'
  + '  if(api.overlaps2d(api.find(\'Joueur\'), api.me)){\n'
  + '    api.state.score = (api.state.score || 0) + 1;\n'
  + '    api.destroy(api.me);\n'
  + '  }\n'
  + '}</code></pre>'
  + '<p>Réagir une seule fois à l\'entrée en contact avec tous les objets d\'un tag : des pics qui blessent.</p>'
  + '<pre><code>function start(api){\n'
  + '  api.onContact(\'pics\', function(){ api.emit(\'touche\'); });\n'
  + '}</code></pre>'
  + '<p>Rendre une plateforme traversable par en dessous, ou agrandir une zone en cours de partie.</p>'
  + '<pre><code>const c = api.me.getComponent(\'Collider2D\');\n'
  + 'c.data.traversable = true;\n'
  + 'c.data.l = 4; // largeur de la forme</code></pre>'
  + trapHelp('<p>Les pentes ne se peignent pas dans une Tilemap : une pente est toujours un objet à part avec un '
    + 'Collider 2D de forme « Pente ».</p>')
  + '<h3>Voir aussi</h3><ul>'
  + '<li>' + linkHelp('component-Rigidbody2D', 'Corps rigide 2D') + '</li>'
  + '<li>' + linkHelp('component-Tilemap', 'Tilemap') + '</li>'
  + '<li>' + linkHelp('game-2d', 'Faire un jeu 2D') + '</li>'
  + '</ul>';
}},

// ---------------------------------------------------------------- CharacterController2D
{id:'component-CharacterController2D', part:'components', section:'2D', title:'Contrôleur de personnage 2D (CharacterController2D)', level:'both',
 summary:'Fait répondre un personnage 2D aux touches : de côté (saut) ou de dessus (8 directions).',
 anchors:[
   {f:'js/components/component-physics-2d.js', c:"static get typeName(){ return 'CharacterController2D'; }"},
   {f:'js/world-2d.js', c:"speed:6, heightJump:3, coyote:0.1, memoireJump:0.15,"},
   {f:'js/world-2d.js', c:"actionTop:'advance', actionBottom:'back'};"},
   {f:'js/world-2d.js', c:'if(ax && ay){ const k = Math.SQRT1_2; ax *= k; ay *= k; }'}
 ],
 html:function(){ return ''
  + essentialHelp('<p>Le <b>Contrôleur de personnage 2D</b> déplace l\'objet selon les touches du joueur. Vue de '
    + 'côté, il court et saute ; vue de dessus, il va dans huit directions. Il s\'utilise avec un Corps rigide 2D '
    + 'et un Collider 2D.</p>')
  + '<h3>Ajouter le composant</h3>'
  + addSteps('Contrôleur de personnage 2D', ['Vérifiez que l\'objet porte aussi un <b>Corps rigide 2D</b> et un <b>Collider 2D</b>.'])
  + '<h3>Propriétés</h3>'
  + propsHelp([
      ['Vue', 'mode', 'platform', 'De côté (plateforme) ou de dessus (8 directions).'],
      ['Vitesse', 'speed', '6', 'Vitesse de déplacement, en unités par seconde.'],
      ['Hauteur de saut', 'heightJump', '3', 'Hauteur atteinte, en unités : elle reste juste si la gravité change.'],
      ['Coyote (s)', 'coyote', '0.1', 'Laisse sauter juste après avoir quitté le sol.'],
      ['Mémoire du saut (s)', 'memoireJump', '0.15', 'Joue un saut demandé juste avant d\'atterrir.']
    ])
  + '<h3>Utilisation</h3>'
  + '<p>Les touches viennent de la table d\'entrées, par des <b>actions</b> : <code>left</code>, <code>right</code>, '
  + '<code>jump</code>, et en vue de dessus <code>advance</code> et <code>back</code> pour monter et descendre.</p>'
  + tipHelp('<p>En vue de dessus, le personnage ne subit plus la gravité et n\'escalade plus rien : les deux sont '
    + 'posés par le mode.</p>')
  + '<h3>Exemples de scripts</h3>'
  + '<p>Le contrôleur déplace déjà le personnage au clavier : le script n\'écrit pas le déplacement, il réagit. '
  + 'Ici, montrer l\'image qui correspond à la dernière direction regardée (<code>api.aim2d()</code>, vue de dessus).</p>'
  + '<pre><code>function update(api){\n'
  + '  const d = api.aim2d(); // {x, y}\n'
  + '  if(d.y &gt; 0) api.spriteImage(\'dos\');\n'
  + '  else if(d.y &lt; 0) api.spriteImage(\'face\');\n'
  + '  else if(d.x !== 0) api.spriteImage(\'profil\');\n'
  + '}</code></pre>'
  + '<p>Un bonus de vitesse et de saut pendant cinq secondes.</p>'
  + '<pre><code>function start(api){\n'
  + '  api.on(\'bonus\', function(){\n'
  + '    const c = api.me.getComponent(\'CharacterController2D\');\n'
  + '    c.data.speed = 10; c.data.heightJump = 5;\n'
  + '    api.after(5, function(){ c.data.speed = 6; c.data.heightJump = 3; });\n'
  + '  });\n'
  + '}</code></pre>'
  + '<p>Passer en vue de dessus en entrant dans un donjon.</p>'
  + '<pre><code>api.me.getComponent(\'CharacterController2D\').data.mode = \'topdown\'; // \'platform\' pour revenir</code></pre>'
  + advancedHelp('Les noms d\'actions',
      '<p>Les clés <code>actionLeft</code>, <code>actionRight</code>, <code>actionJump</code>, <code>actionTop</code> et '
    + '<code>actionBottom</code> ne sont pas dans l\'inspecteur : elles se changent dans le fichier de scène. Les '
    + 'diagonales sont ramenées à la vitesse des lignes droites.</p>')
  + trapHelp('<p>Une action dont le nom n\'existe pas dans la table d\'entrées ne lève aucune erreur : le personnage '
    + 'ne bouge simplement pas dans cette direction.</p>')
  + '<h3>Voir aussi</h3><ul>'
  + '<li>' + linkHelp('component-Rigidbody2D', 'Corps rigide 2D') + '</li>'
  + '<li>' + linkHelp('component-TouchControls', 'Contrôles tactiles') + '</li>'
  + '<li>' + linkHelp('game-2d', 'Faire un jeu 2D') + '</li>'
  + '</ul>';
}},

// ---------------------------------------------------------------- UIDocument
{id:'component-UIDocument', part:'components', section:'Interface', title:'Interface (UI) (UIDocument)', level:'both',
 summary:'Affiche une interface de jeu écrite en HTML et CSS.',
 anchors:[
   {f:'js/components/component-uidocument.js', c:"static get typeName() { return 'UIDocument'; }"},
   {f:'js/component-data.js', c:'{documentUIId: null, sheetStyleIds: [], values: {}}'},
   {f:'js/game-ui.js', c:'data-bind'}
 ],
 html:function(){ return ''
  + essentialHelp('<p>Le composant <b>Interface (UI)</b> affiche un HUD, un menu ou une barre de vie. Le contenu est '
    + 'un <b>document UI</b> (HTML) et une <b>feuille de style</b> (CSS), deux assets du projet : l\'objet ne fait '
    + 'que les référencer.</p>')
  + '<h3>Ajouter le composant</h3>'
  + addSteps('Interface (UI)', ['Choisissez un <b>Document UI</b> et une <b>Feuille de style</b>, ou cliquez sur <b>＋ Créer et éditer…</b>.'])
  + '<h3>Propriétés</h3>'
  + propsHelp([
      ['Document UI', 'documentUIId', '— aucun —', 'L\'asset qui porte le HTML.'],
      ['Feuille de style', 'sheetStyleIds', '— aucune —', 'L\'asset qui porte le CSS.'],
      ['✎ Éditer…', '', '', 'Ouvre l\'éditeur HTML/CSS sur les assets choisis.']
    ])
  + '<h3>Utilisation</h3>'
  + '<p>Un bouton ne reçoit le clic que s\'il porte la classe <code>ui-button</code> ; son <code>data-event</code> '
  + 'est l\'événement envoyé aux scripts.</p>'
  + '<pre><code>&lt;button class="ui-button" data-event="rejouer"&gt;Rejouer&lt;/button&gt;</code></pre>'
  + tipHelp('<p>Le contenu vit sur les assets : deux objets peuvent partager le même document, et une modification le change partout.</p>')
  + '<h3>Exemples de scripts</h3>'
  + '<p>Réagir au clic d\'un bouton <code>data-event="rejouer"</code>.</p>'
  + '<pre><code>function start(api){\n'
  + '  api.on(\'rejouer\', function(){ api.changeScene(\'Niveau 1\'); });\n'
  + '}</code></pre>'
  + '<p>Afficher le score : un élément <code>&lt;span data-bind="score"&gt;&lt;/span&gt;</code> reçoit en texte la valeur '
  + 'de la même clé dans <code>values</code>.</p>'
  + '<pre><code>function update(api){\n'
  + '  const ui = api.uiDocument(api.find(\'HUD\')); // le composant, ou null\n'
  + '  if(ui) ui.values.score = api.state.score || 0;\n'
  + '}</code></pre>'
  + '<p>Changer une classe CSS : <code>&lt;div class="vie" data-bind-class="etatVie"&gt;</code> garde sa classe '
  + '<code>vie</code> et reçoit en plus la valeur liée.</p>'
  + '<pre><code>ui.values.etatVie = vie &lt; 30 ? \'critique\' : \'\';</code></pre>'
  + '<p>Lire ce que le joueur a tapé dans <code>&lt;input data-bind="pseudo" data-event="valider"&gt;</code> : la '
  + 'valeur accompagne l\'événement.</p>'
  + '<pre><code>api.on(\'valider\', function(pseudo){ api.state.pseudo = pseudo; });</code></pre>'
  + advancedHelp('Lecture seule depuis un script',
      '<p><code>html</code> et <code>css</code> se lisent sur le composant mais ne se réécrivent pas : ils vivent sur des '
    + 'assets partagés. <code>values</code>, lui, se lit et s\'écrit : c\'est le canal prévu pour piloter l\'interface.</p>')
  + trapHelp('<p>L\'interface <b>ne s\'affiche pas dans la vue de l\'éditeur</b> : seulement en jeu (▶ Jouer) et dans les '
    + 'builds exportés.</p>')
  + '<h3>Voir aussi</h3><ul>'
  + '<li>' + linkHelp('game-ui', 'L\'interface de jeu') + '</li>'
  + '<li>' + linkHelp('scripts-api', 'L\'objet api') + '</li>'
  + '</ul>';
}},

// ---------------------------------------------------------------- TouchControls
{id:'component-TouchControls', part:'components', section:'Interface', title:'Contrôles tactiles (TouchControls)', level:'both',
 summary:'Joystick virtuel, glisser et boutons pour jouer sur écran tactile.',
 anchors:[
   {f:'js/components/component-touch-controls.js', c:"static get typeName(){ return 'TouchControls'; }"},
   {f:'js/touch-input.js', c:'opacity: 0.85,'},
   {f:'js/touch-input.js', c:"swipe: {enabled: false, axis: 'horizontal', sensitivity: 1.5},"}
 ],
 html:function(){ return ''
  + essentialHelp('<p>Les <b>Contrôles tactiles</b> posent sur l\'écran un joystick, une zone de glisser et des boutons. '
    + 'Ils pilotent les mêmes axes et actions que le clavier : un jeu existant devient jouable sur téléphone sans '
    + 'changer ses scripts.</p>')
  + '<h3>Ajouter le composant</h3>'
  + addSteps('Contrôles tactiles', ['Dans la section <b>Boutons</b>, cliquez sur <b>＋ Ajouter un bouton</b> pour chaque action.'])
  + '<h3>Propriétés</h3>'
  + propsHelp([
      ['Aussi sur ordinateur', 'showOnDesktop', 'non', 'Par défaut la surcouche n\'apparaît que sur écran tactile.'],
      ['Opacité', 'opacity', '0.85', 'Transparence de la surcouche (0,1 à 1).'],
      ['Joystick › Actif', 'joystick.enabled', 'oui', 'Affiche le joystick.'],
      ['Joystick › Côté', 'joystick.side', 'left', 'Gauche ou droite de l\'écran.'],
      ['Joystick › Taille (px)', 'joystick.size', '150', 'Diamètre du joystick.'],
      ['Joystick › Zone morte', 'joystick.deadZone', '0.15', 'Petit mouvement ignoré au centre.'],
      ['Joystick › Axe X / Axe Y', 'joystick.axisX', 'horizontal / vertical', 'Les axes de la table d\'entrées pilotés.'],
      ['Glisser › Actif', 'swipe.enabled', 'non', 'Active la zone de glisser.'],
      ['Glisser › Axe', 'swipe.axis', 'horizontal', 'L\'axe piloté par le glisser.'],
      ['Glisser › Sensibilité', 'swipe.sensitivity', '1.5', 'Amplifie le geste.'],
      ['Boutons', 'buttons', '(aucun)', 'Chaque bouton a un libellé, une action et un côté.']
    ])
  + '<h3>Utilisation</h3>'
  + tipHelp('<p>Cochez <b>Aussi sur ordinateur</b> le temps de régler la disposition, puis décochez-le.</p>')
  + '<h3>Exemples de scripts</h3>'
  + '<p>Le composant n\'a rien à appeler : il nourrit la table d\'entrées. Un script écrit pour le clavier marche '
  + 'donc tel quel sur téléphone, car <code>api.axis</code> combine clavier ET joystick.</p>'
  + '<pre><code>function update(api){\n'
  + '  api.me.position.x += api.axis(\'horizontal\') * 5 * api.dt;\n'
  + '  api.me.position.y += api.axis(\'vertical\') * 5 * api.dt;\n'
  + '}</code></pre>'
  + '<p>Un bouton tactile déclenche son action : on la lit comme une touche.</p>'
  + '<pre><code>function update(api){\n'
  + '  if(api.actionPressed(\'jump\')) api.emit(\'saut\');\n'
  + '}</code></pre>'
  + '<p>Lire le doigt seul (de −1 à 1), par exemple pour viser plus finement au toucher.</p>'
  + '<pre><code>const doigt = api.touchAxis(\'horizontal\');\n'
  + 'if(doigt !== 0) api.me.rotation.z = -doigt * 0.5;</code></pre>'
  + advancedHelp('Où vit la surcouche',
      '<p>Le composant ne fait que porter la configuration ; la surcouche est posée par le moteur en mode jeu. La '
    + 'logique est dans <code>js/touch-input.js</code>.</p>')
  + trapHelp('<p>Une action de bouton qui n\'existe pas dans la table d\'entrées ne déclenche rien, sans message.</p>')
  + '<h3>Voir aussi</h3><ul>'
  + '<li>' + linkHelp('component-CharacterController2D', 'Contrôleur de personnage 2D') + '</li>'
  + '<li>' + linkHelp('scripts-api', 'L\'objet api') + '</li>'
  + '</ul>';
}},

// ---------------------------------------------------------------- XROrigin
{id:'component-XROrigin', part:'components', section:'Réalité virtuelle', title:'Origine XR (XROrigin)', level:'both',
 summary:'Le sol du joueur en réalité virtuelle : rend le jeu jouable au casque.',
 anchors:[
   {f:'js/components/component-xr.js', c:"static get typeName(){ return 'XROrigin'; }"},
   {f:'js/component-data.js', c:"sessionMode: 'immersive-vr',"},
   {f:'js/component-data.js', c:'snapTurn: 45,'},
   {f:'js/component-data.js', c:'moveSpeed: 0,'}
 ],
 html:function(){ return ''
  + essentialHelp('<p>L\'<b>Origine XR</b> représente le sol du joueur en réalité virtuelle. Dès qu\'un objet la porte, '
    + 'le jeu publié affiche un bouton <b>Entrer en VR</b>. Déplacer cet objet, c\'est déplacer le joueur.</p>')
  + '<h3>Ajouter le composant</h3>'
  + addSteps('Origine XR', ['Placez la <b>caméra principale</b> en enfant de cet objet, à environ 1,6 m de hauteur.'])
  + '<h3>Propriétés</h3>'
  + propsHelp([
      ['Mode', 'sessionMode', 'immersive-vr', 'Réalité virtuelle ou réalité augmentée.'],
      ['Suivi', 'referenceSpace', 'local-floor', 'Debout (hauteur réelle) ou assis (hauteur de la caméra).'],
      ['Afficher les manettes', 'showControllers', 'oui', 'Dessine les manettes dans les mains.'],
      ['Suivi des mains', 'handTracking', 'oui', 'Demande le suivi des mains ; le pincement vaut la gâchette.'],
      ['Téléportation', 'teleport', 'oui', 'Stick droit vers l\'avant pour viser, relâcher pour y aller.'],
      ['Rotation par cran (°)', 'snapTurn', '45', 'Stick droit gauche/droite. 0 désactive.'],
      ['Déplacement continu (m/s)', 'moveSpeed', '0', 'Stick gauche. 0 désactive.']
    ])
  + '<h3>Utilisation</h3>'
  + tipHelp('<p>Le template <b>WebXR / VR</b> du Hub monte une salle de test complète, prête à essayer.</p>')
  + '<h3>Exemples de scripts</h3>'
  + '<p>Proposer d\'entrer en VR depuis un bouton d\'interface, si le navigateur le permet.</p>'
  + '<pre><code>function start(api){\n'
  + '  api.on(\'entrerVR\', function(){ if(api.xr.available()) api.xr.enter(); });\n'
  + '}</code></pre>'
  + '<p>Lire une manette : position, direction pointée, gâchette (0 à 1) et stick.</p>'
  + '<pre><code>function update(api){\n'
  + '  if(!api.xr.presenting()) return;\n'
  + '  const main = api.xr.controller(\'right\');\n'
  + '  if(api.xr.buttonPressed(\'right\', \'a\')) api.log(\'A pressé, gâchette = \' + main.trigger);\n'
  + '}</code></pre>'
  + '<p>Activer le déplacement continu au stick gauche après un tutoriel.</p>'
  + '<pre><code>api.find(\'XR Origin\').getComponent(\'XROrigin\').data.moveSpeed = 2;</code></pre>'
  + '<p>Savoir où se tient le joueur : la tête, ou l\'origine (ses pieds).</p>'
  + '<pre><code>const tete = api.xr.head().position;\n'
  + 'const origine = api.xr.origin(); // le nœud XROrigin, ou null\n'
  + 'if(origine) api.log(\'pieds en \' + origine.position.x + \', \' + origine.position.z);</code></pre>'
  + advancedHelp('Tester sans casque',
      '<p>L\'extension <b>Immersive Web Emulator</b> (Chrome, Edge) simule casque et manettes. WebXR exige une page '
    + 'sécurisée : <code>https://</code> ou <code>localhost</code>.</p>')
  + trapHelp('<p>Si la caméra principale n\'est pas un <b>enfant</b> de l\'Origine XR, déplacer le joueur ne déplace pas sa vue.</p>')
  + '<h3>Voir aussi</h3><ul>'
  + '<li>' + linkHelp('component-XRGrabbable', 'Saisissable (XR)') + '</li>'
  + '<li>' + linkHelp('component-XRTeleportArea', 'Zone de téléportation (XR)') + '</li>'
  + '<li>' + linkHelp('webxr', 'Réalité virtuelle (WebXR)') + '</li>'
  + '</ul>';
}},

// ---------------------------------------------------------------- XRGrabbable
{id:'component-XRGrabbable', part:'components', section:'Réalité virtuelle', title:'Saisissable (XR) (XRGrabbable)', level:'both',
 summary:'Un objet qu\'on attrape à la main en réalité virtuelle.',
 anchors:[
   {f:'js/components/component-xr.js', c:"static get typeName(){ return 'XRGrabbable'; }"},
   {f:'js/component-data.js', c:'radius: 0.15,'},
   {f:'js/component-data.js', c:'throwable: true,'}
 ],
 html:function(){ return ''
  + essentialHelp('<p>Un objet <b>Saisissable</b> s\'attrape avec la gâchette latérale de la manette, et se lâche en la '
    + 'relâchant. Avec un composant Physics, il peut être lancé.</p>')
  + '<h3>Ajouter le composant</h3>'
  + addSteps('Saisissable (XR)', ['Ajoutez un composant <b>Physique</b> si l\'objet doit pouvoir être lancé.'])
  + '<h3>Propriétés</h3>'
  + propsHelp([
      ['Portée (m)', 'radius', '0.15', 'Distance maximale entre la main et l\'objet pour le saisir.'],
      ['Lançable', 'throwable', 'oui', 'Avec Physics, l\'objet relâché garde la vitesse de la main.'],
      ['Garder la prise', 'keepOffset', 'oui', 'Décoché, l\'objet se recentre dans la main.']
    ])
  + '<h3>Exemples de scripts</h3>'
  + '<p>Savoir si CET objet est tenu, et dans quelle main (<code>api.xr.held</code> rend l\'objet tenu, ou null).</p>'
  + '<pre><code>function update(api){\n'
  + '  const main = api.xr.held(\'right\') === api.me ? \'right\'\n'
  + '             : api.xr.held(\'left\') === api.me ? \'left\' : null;\n'
  + '  if(!main) return;\n'
  + '  // un pistolet : tirer à la gâchette, avec une vibration\n'
  + '  if(api.xr.buttonPressed(main, \'trigger\')){\n'
  + '    api.emit(\'tir\');\n'
  + '    api.xr.haptic(main, 0.5, 40);\n'
  + '  }\n'
  + '}</code></pre>'
  + '<p>Réduire la portée de saisie d\'un petit objet, ou interdire de le lancer.</p>'
  + '<pre><code>const g = api.me.getComponent(\'XRGrabbable\');\n'
  + 'g.data.radius = 0.08;\n'
  + 'g.data.throwable = false;</code></pre>'
  + trapHelp('<p>Sans composant Physique, <b>Lançable</b> n\'a aucun effet : l\'objet reste là où on le lâche.</p>')
  + '<h3>Voir aussi</h3><ul>'
  + '<li>' + linkHelp('component-XROrigin', 'Origine XR') + '</li>'
  + '<li>' + linkHelp('component-Physics', 'Physique') + '</li>'
  + '<li>' + linkHelp('webxr', 'Réalité virtuelle (WebXR)') + '</li>'
  + '</ul>';
}},

// ---------------------------------------------------------------- XRTeleportArea
{id:'component-XRTeleportArea', part:'components', section:'Réalité virtuelle', title:'Zone de téléportation (XR) (XRTeleportArea)', level:'both',
 summary:'Une surface sur laquelle le joueur peut se téléporter.',
 anchors:[
   {f:'js/components/component-xr.js', c:"static get typeName(){ return 'XRTeleportArea'; }"},
   {f:'js/component-data.js', c:'maxSlope: 30'}
 ],
 html:function(){ return ''
  + essentialHelp('<p>La <b>Zone de téléportation</b> marque une surface où le joueur a le droit d\'atterrir. Seules ces '
    + 'surfaces acceptent la téléportation.</p>')
  + '<h3>Ajouter le composant</h3>'
  + addSteps('Zone de téléportation (XR)', ['Posez-le sur le sol, une estrade, un escalier.'])
  + '<h3>Propriétés</h3>'
  + propsHelp([
      ['Pente max (°)', 'maxSlope', '30', 'Au-delà, la surface visée est refusée : un mur n\'est pas un sol.']
    ])
  + '<h3>Utilisation</h3>'
  + '<p>Stick droit vers l\'avant pour viser : l\'arc est vert sur une zone valide, rouge sinon. Relâchez pour y aller.</p>'
  + '<h3>Exemples de scripts</h3>'
  + '<p>La zone n\'a rien à piloter en jeu : la téléportation est gérée par l\'Origine XR. Un script peut en revanche '
  + 'ouvrir ou fermer une zone, ou couper la téléportation partout.</p>'
  + '<p>Fermer une zone (un pont qui s\'effondre) en retirant le composant.</p>'
  + '<pre><code>const zone = api.find(\'Pont\');\n'
  + 'zone.removeComponent(zone.getComponent(\'XRTeleportArea\'));</code></pre>'
  + '<p>L\'ouvrir plus tard, en n\'acceptant que les surfaces presque plates.</p>'
  + '<pre><code>api.find(\'Pont\').addComponent(\'XRTeleportArea\', {maxSlope: 10});</code></pre>'
  + '<p>Couper la téléportation pendant une cinématique, sur l\'Origine XR.</p>'
  + '<pre><code>const origine = api.xr.origin();\n'
  + 'if(origine) origine.getComponent(\'XROrigin\').data.teleport = false;</code></pre>'
  + trapHelp('<p>La téléportation doit aussi être cochée sur l\'<b>Origine XR</b>, sinon aucune zone ne sert.</p>')
  + '<h3>Voir aussi</h3><ul>'
  + '<li>' + linkHelp('component-XROrigin', 'Origine XR') + '</li>'
  + '<li>' + linkHelp('webxr', 'Réalité virtuelle (WebXR)') + '</li>'
  + '</ul>';
}},

// ---------------------------------------------------------------- FogOfWar
{id:'component-FogOfWar', part:'components', section:'Gameplay', title:'Brouillard de guerre (FogOfWar)', level:'both',
 summary:'Cache ce que l\'équipe du joueur ne voit pas, comme dans un jeu de stratégie.',
 anchors:[
   {f:'js/components/component-fog-of-war.js', c:"static get typeName(){ return 'FogOfWar'; }"},
   {f:'js/components/component-fog-of-war.js', c:"export const FOG_DEFAULT = {origin: [0, 0], cellSize: 1, cols: 96, rows: 96, team: 1, allies: [],"},
   {f:'js/components/component-fog-of-war.js', c:"height: 0.08, color: '#000000', exploredOpacity: 0.55, updateInterval: 0.2, revealAll: false};"}
 ],
 html:function(){ return ''
  + essentialHelp('<p>Le <b>Brouillard de guerre</b> pose une surface sombre au-dessus de la carte. Ce que l\'équipe du '
    + 'joueur voit est clair, ce qu\'elle a déjà exploré est voilé, le reste est noir. Les objets qui voient '
    + 'portent un composant <b>Vision</b>.</p>')
  + '<h3>Ajouter le composant</h3>'
  + addSteps('Brouillard de guerre', [
      'Posez-le sur un objet de carte (le terrain, un groupe « Carte »).',
      'Réglez colonnes, lignes et taille de case pour couvrir la carte.',
      'Ajoutez une <b>Vision</b> aux unités et aux bâtiments.'
    ])
  + '<h3>Propriétés</h3>'
  + propsHelp([
      ['Équipe du joueur', 'team', '1', 'L\'équipe dont on montre la vision.'],
      ['Taille de case (m)', 'cellSize', '1', 'Côté d\'une case de la grille.'],
      ['Colonnes', 'cols', '96', 'Nombre de cases en X.'],
      ['Lignes', 'rows', '96', 'Nombre de cases en Z.'],
      ['Hauteur de la surface', 'height', '0.08', 'Hauteur de la surface sombre au-dessus du sol.'],
      ['Opacité exploré', 'exploredOpacity', '0.55', 'Voile des zones déjà vues mais hors de vue.'],
      ['Couleur', 'color', '#000000', 'Couleur du brouillard.']
    ])
  + '<h3>Utilisation</h3>'
  + '<p>La grille part de l\'origine <code>origin</code> ' + defaultHelp('[0, 0]') + ' en X et Z.</p>'
  + tipHelp('<p>Le brouillard ne tourne <b>qu\'en jeu</b> : en édition rien n\'est caché, pour construire le niveau en pleine lumière.</p>')
  + '<h3>Exemples de scripts</h3>'
  + '<p>Tout dévoiler à la fin de la partie.</p>'
  + '<pre><code>function start(api){\n'
  + '  api.on(\'victoire\', function(){\n'
  + '    api.find(\'Carte\').getComponent(\'FogOfWar\').revealAll = true;\n'
  + '  });\n'
  + '}</code></pre>'
  + '<p>Savoir si le joueur voit un point : <code>stateAt(x, z)</code> rend 0 (inconnu), 1 (exploré) ou 2 (vu). '
  + 'Ici, un ennemi n\'attaque que s\'il est visible.</p>'
  + '<pre><code>function update(api){\n'
  + '  const fog = api.find(\'Carte\').getComponent(\'FogOfWar\');\n'
  + '  if(fog.stateAt(api.me.position.x, api.me.position.z) === 2) api.emit(\'ennemiRepere\', api.me);\n'
  + '}</code></pre>'
  + '<p>Changer l\'équipe du point de vue (mode spectateur, ou partie à tour de rôle).</p>'
  + '<pre><code>api.find(\'Carte\').getComponent(\'FogOfWar\').team = 2;</code></pre>'
  + advancedHelp('Alliés et cadence',
      '<p><code>allies</code> liste les équipes dont la vision compte aussi pour le joueur. Le brouillard se recalcule '
    + 'toutes les ' + defaultHelp('0,2 s') + ' (<code>updateInterval</code>). Ces deux clés ne sont pas dans l\'inspecteur.</p>')
  + trapHelp('<p>Une unité ennemie sans composant <b>Vision</b> n\'est jamais cachée par le brouillard.</p>')
  + '<h3>Voir aussi</h3><ul>'
  + '<li>' + linkHelp('component-Vision', 'Vision') + '</li>'
  + '<li>' + linkHelp('component-TeamColor', 'Couleur d\'équipe') + '</li>'
  + '</ul>';
}},

// ---------------------------------------------------------------- Vision
{id:'component-Vision', part:'components', section:'Gameplay', title:'Vision (Vision)', level:'both',
 summary:'Ce qui voit (un rayon, une équipe) et ce que le brouillard de guerre cache.',
 anchors:[
   {f:'js/components/component-fog-of-war.js', c:"static get typeName(){ return 'Vision'; }"},
   {f:'js/components/component-fog-of-war.js', c:'export const VISION_DEFAULT = {radius: 6, team: 0, remember: false};'}
 ],
 html:function(){ return ''
  + essentialHelp('<p>La <b>Vision</b> se pose sur tout ce qui voit <b>ou</b> peut être caché par le brouillard de guerre. '
    + 'Une unité alliée dévoile le brouillard autour d\'elle ; un objet ennemi est caché tant qu\'il n\'est pas en vue.</p>')
  + '<h3>Ajouter le composant</h3>'
  + addSteps('Vision', ['Réglez son <b>Équipe</b> et son <b>Rayon</b>.'])
  + '<h3>Propriétés</h3>'
  + propsHelp([
      ['Rayon (m)', 'radius', '6', 'Distance de vue. 0 : ne voit rien, mais peut être caché.'],
      ['Équipe', 'team', '0', 'L\'équipe de l\'objet.'],
      ['Mémoriser', 'remember', 'non', 'Une fois aperçu, reste affiché sous le brouillard (bâtiments, ressources).']
    ])
  + '<h3>Utilisation</h3>'
  + tipHelp('<p>Un arbre, une mine ou un bâtiment ennemi : rayon 0 et <b>Mémoriser</b> coché.</p>')
  + '<h3>Exemples de scripts</h3>'
  + '<p>Une tour de guet améliorée voit plus loin.</p>'
  + '<pre><code>function start(api){\n'
  + '  api.on(\'ameliorerTour\', function(){\n'
  + '    api.me.getComponent(\'Vision\').radius = 14;\n'
  + '  });\n'
  + '}</code></pre>'
  + '<p>Capturer un bâtiment : il passe dans l\'équipe du joueur, sa vision compte désormais pour lui.</p>'
  + '<pre><code>const v = api.me.getComponent(\'Vision\');\n'
  + 'v.team = 1;\n'
  + 'v.remember = false;</code></pre>'
  + '<p>Aveugler une unité pendant trois secondes (sort de fumée).</p>'
  + '<pre><code>const v = api.me.getComponent(\'Vision\');\n'
  + 'const avant = v.radius;\n'
  + 'v.radius = 0;\n'
  + 'api.after(3, function(){ v.radius = avant; });</code></pre>'
  + trapHelp('<p>Sans composant <b>Brouillard de guerre</b> dans la scène, la Vision ne fait rien.</p>')
  + '<h3>Voir aussi</h3><ul>'
  + '<li>' + linkHelp('component-FogOfWar', 'Brouillard de guerre') + '</li>'
  + '</ul>';
}},

// ---------------------------------------------------------------- TeamColor
{id:'component-TeamColor', part:'components', section:'Gameplay', title:'Couleur d\'équipe (TeamColor)', level:'both',
 summary:'Teint la partie « équipe » d\'un modèle à la couleur du joueur.',
 anchors:[
   {f:'js/components/component-team-color.js', c:"static get typeName(){ return 'TeamColor'; }"},
   {f:'js/components/component-team-color.js', c:"export const TEAM_COLOR_DEFAULT = {color: '#3060e0', material: 'Team'};"},
   {f:'js/components/component-team-color.js', c:'setTimeout(function(){ self.refresh(left - 1); }, 150);'}
 ],
 html:function(){ return ''
  + essentialHelp('<p>La <b>Couleur d\'équipe</b> donne à chaque joueur sa couleur sur un modèle partagé : un seul modèle '
    + 'd\'unité suffit pour toutes les équipes. Le modèle porte une partie « équipe » dessinée en niveaux de gris, '
    + 'dans un matériau reconnaissable par son nom.</p>')
  + '<h3>Ajouter le composant</h3>'
  + addSteps('Couleur d\'équipe', ['Vérifiez que le modèle a un matériau nommé <code>Team</code>, ou indiquez son nom.'])
  + '<h3>Propriétés</h3>'
  + propsHelp([
      ['Couleur', 'color', '#3060e0', 'La couleur du joueur.'],
      ['Matériau teint', 'material', 'Team', 'Nom du matériau du modèle qui porte la partie équipe.']
    ])
  + '<h3>Utilisation</h3>'
  + '<p>Couleur finale = gris du modèle × couleur du joueur. Le matériau est copié pour cet objet seulement : les '
  + 'autres instances du même modèle ne changent pas.</p>'
  + '<h3>Exemples de scripts</h3>'
  + '<p>Peindre l\'unité à la couleur de son joueur : changer <code>color</code> réapplique la teinte tout de suite.</p>'
  + '<pre><code>api.me.getComponent(\'TeamColor\').color = \'#3050e0\';</code></pre>'
  + '<p>Une unité qui apparaît prend la couleur du joueur qui l\'a produite.</p>'
  + '<pre><code>const COULEURS = [\'#d03030\', \'#3050e0\', \'#30a040\', \'#e0c020\'];\n'
  + 'const equipe = 2; // le joueur qui produit l\'unité (1 à 4)\n'
  + 'const u = api.create(\'Soldat\', {x: 4, y: 0, z: 2});\n'
  + 'if(u) u.getComponent(\'TeamColor\').color = COULEURS[equipe - 1];</code></pre>'
  + '<p>Un bâtiment capturé change de couleur ET d\'équipe de vision.</p>'
  + '<pre><code>api.on(\'capture\', function(d){\n'
  + '  api.me.getComponent(\'TeamColor\').color = d.couleur;\n'
  + '  const v = api.me.getComponent(\'Vision\');\n'
  + '  if(v) v.team = d.equipe;\n'
  + '});</code></pre>'
  + trapHelp('<p>Si aucun maillage ne porte de matériau du nom indiqué, rien n\'est teint. L\'inspecteur l\'affiche en note.</p>')
  + '<h3>Voir aussi</h3><ul>'
  + '<li>' + linkHelp('component-Model', 'Modèle') + '</li>'
  + '<li>' + linkHelp('component-FogOfWar', 'Brouillard de guerre') + '</li>'
  + '</ul>';
}}

];
