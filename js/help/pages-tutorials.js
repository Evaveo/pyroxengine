// ---------- Aide de l'éditeur : partie « tutorials » ----------
// Une page = {id, part, section, title, level, summary, anchors, html}. Les ancres sont
// vérifiées par test/aide.test.mjs (voir l'en-tête de js/help-content.js). Chaque étape d'un
// tutoriel nomme un geste RÉEL : libellé de menu, de bouton ou de champ relevé dans le code.
import { advancedHelp, essentialHelp, linkHelp, stepsHelp, termHelp, tipHelp, trapHelp } from './help-format.js';

export const PAGES_TUTORIALS = [

{id:'tuto-first-game-3d', part:'tutorials', section:'Tutoriels', title:'Un premier jeu 3D', level:'beginner',
 summary:'Un sol, un joueur physique piloté au clavier, une caméra qui le suit et des pièces à ramasser.',
 anchors:[
   {f:'js/objects.js', c:'{type:\'plane\', label:\'Plan\', icon:\'\'},'},
   {f:'js/objects.js', c:'{type:\'capsule\', label:\'Capsule\', icon:\'\'},'},
   {f:'js/ui/panels-components.js', c:'{ ids: [\'f-pmass\'], label: \'Masse\', type: \'number\''},
   {f:'js/ui/panels-components.js', c:'{ ids: [\'f-camf-target\'], label: \'Suit\', type: \'choice\','},
   {f:'js/camera-framing.js', c:'node.position.y = p.y;'},
   {f:'js/ui/panels-inspector.js', c:'{ ids: [\'f-jtag\'], label: \'Tag\', type: \'text\''},
   {f:'js/scripts.js', c:'setVelocity: function(target, v){'},
   {f:'js/scripts.js', c:'onContact: function(tag, fn){'}
 ],
 html:function(){ return ''
  + essentialHelp('<p>Vous allez construire, en une vingtaine de minutes, un petit jeu : un '
    + 'personnage qui se déplace au clavier sur un sol, une caméra qui le suit, et des pièces '
    + 'qui disparaissent quand on les touche. Chaque étape est un geste dans l\'éditeur.</p>')

  + '<h3>1. Un projet vide</h3>'
  + stepsHelp([
      '<b>Fichier → Nouveau → Projet 3D</b>. La scène de départ contient déjà un sol, un cube, un '
        + 'soleil et une caméra.',
      'Sélectionnez le cube dans la ' + linkHelp('panel-hierarchy', 'Hiérarchie') + ' et '
        + 'supprimez-le (<b>Édition → Supprimer</b>). Gardez le reste.'
    ])
  + tipHelp('S\'il n\'y a pas de sol, créez-en un : <b>Objet → Plan</b>, puis agrandissez-le avec '
    + 'le champ <b>Échelle</b> de l\'inspecteur.')

  + '<h3>2. Le sol doit être solide</h3>'
  + stepsHelp([
      'Sélectionnez le sol. Dans l\'' + linkHelp('panel-inspector', 'inspecteur') + ', '
        + '<b>+ Composant → Physique</b>.',
      'Mettez <b>Masse</b> à <code>0</code> : un corps de masse nulle est <b>statique</b>, il ne '
        + 'tombe pas.',
      '<b>+ Composant → Collider</b>, et laissez <b>Forme</b> sur <b>Auto (boîte englobante)</b>.'
    ])

  + '<h3>3. Le joueur</h3>'
  + stepsHelp([
      '<b>Objet → Capsule</b>. Renommez-la <code>Joueur</code> dans le champ du nom, en haut de '
        + 'l\'inspecteur.',
      'Montez-la au-dessus du sol : <b>Position</b> Y à <code>2</code>.',
      '<b>+ Composant → Physique</b>, <b>Masse</b> à <code>1</code>. Puis '
        + '<b>+ Composant → Collider</b>.'
    ])
  + tipHelp('Pour vérifier que la physique est en place sans écrire de code : '
    + '<b>Affichage → ⚛ Simulation physique seule</b>. La capsule doit tomber et se poser sur le '
    + 'sol. Recliquez pour arrêter : les positions reviennent.')

  + '<h3>4. Le script de déplacement</h3>'
  + stepsHelp([
      'Dans le ' + linkHelp('panel-project', 'panneau Projet') + ' : <b>＋ Créer → 📜 Script</b>. '
        + 'Renommez-le <code>Deplacement</code>.',
      'Collez ce code dans l\'éditeur de code qui vient de s\'ouvrir :'
    ])
  + '<pre><code>/**\n'
  + ' * @expose vitesse {number} = 4\n'
  + ' */\n'
  + 'function update(api){\n'
  + '  const x = api.axis(\'horizontal\');    // Q/A/← et D/→\n'
  + '  const z = -api.axis(\'vertical\');     // Z/W/↑ avance vers −Z\n'
  + '  // y non fourni : la gravité garde la main sur la chute\n'
  + '  api.setVelocity(api.me, {x: x * api.expose.vitesse, z: z * api.expose.vitesse});\n'
  + '}</code></pre>'
  + stepsHelp([
      'Sélectionnez <code>Joueur</code>, <b>+ Composant → Script</b>, et choisissez '
        + '<code>Deplacement</code> dans le champ <b>Script 1</b>.',
      'Le champ <b>vitesse</b> est apparu dans l\'inspecteur, grâce à la ligne '
        + '<code>@expose</code>. Vous pouvez le changer sans rouvrir le code.'
    ])
  + trapHelp('Ne déplacez pas un objet physique en écrivant <code>api.me.position</code> : la '
    + 'physique réécrit la position à chaque image et votre valeur disparaît, sans erreur. On '
    + 'pousse le corps avec <code>api.setVelocity</code>.')

  + '<h3>5. La caméra qui suit</h3>'
  + stepsHelp([
      'Sélectionnez la caméra. <b>+ Composant → Suivi de caméra</b>.',
      'Dans le champ <b>Suit</b>, choisissez <code>Joueur</code> dans la liste.'
    ])
  + trapHelp('Le <b>Suivi de caméra</b> déplace la caméra en <b>X et Y</b> seulement : il est fait '
    + 'pour une vue de côté. Si votre joueur avance en profondeur (Z), la caméra ne le suit pas '
    + 'sur cet axe. Dans ce cas, retirez le composant et posez ce script sur la caméra :')
  + '<pre><code>function update(api){\n'
  + '  const j = api.find(\'Joueur\');\n'
  + '  if(!j) return;\n'
  + '  const p = j.getWorldPosition(api.V3());\n'
  + '  api.me.position.set(p.x, p.y + 4, p.z + 8);   // au-dessus et derrière\n'
  + '  api.lookAt(j);\n'
  + '}</code></pre>'

  + '<h3>6. Des pièces à ramasser</h3>'
  + stepsHelp([
      '<b>Objet → Sphère</b>, posée à hauteur du joueur, un peu plus loin. Réduisez son '
        + '<b>Échelle</b> à <code>0.4</code>.',
      'Dans le champ <b>Tag</b>, en haut de l\'inspecteur, tapez <code>piece</code>. Ne lui '
        + 'mettez <b>pas</b> de Physique : le joueur la pousserait au lieu de la ramasser.',
      '<b>Édition → Dupliquer</b> plusieurs fois et dispersez les copies.',
      'Créez un second script <code>Ramassage</code>, et attachez-le au <code>Joueur</code> '
        + '(<b>+ Composant → Script</b> une seconde fois) :'
    ])
  + '<pre><code>function start(api){\n'
  + '  api.onContact(\'piece\', function(piece){\n'
  + '    api.destroy(piece);\n'
  + '    api.state.score = (api.state.score || 0) + 1;\n'
  + '    api.log(\'Pièces : \' + api.state.score);\n'
  + '  });\n'
  + '}</code></pre>'
  + '<p>Le ' + termHelp('Tag') + ' relie les deux : <code>onContact</code> réagit à l\'entrée en '
  + 'contact avec tout objet portant ce tag.</p>'

  + '<h3>7. Lancer</h3>'
  + stepsHelp([
      'Cliquez <b>Jouer</b> dans la barre du haut : le jeu s\'ouvre dans un nouvel onglet, comme '
        + 'un build exporté.',
      'Déplacez-vous avec les flèches, ZQSD ou WASD, et touchez les pièces.',
      'Les messages <code>api.log</code> s\'affichent dans la ' + linkHelp('panel-console', 'Console')
        + ' de l\'éditeur.',
      'Enregistrez : <b>Fichier → Enregistrer</b>.'
    ])
  + tipHelp('Le joueur part à l\'envers sur un axe ? Retirez le signe moins devant '
    + '<code>api.axis(\'vertical\')</code>. Rien ne bouge ? Voir '
    + linkHelp('troubleshooting', 'Dépannage') + '.')

  + advancedHelp('Pour aller plus loin',
      '<ul><li>Sauter : <code>if(api.actionPressed(\'jump\')) api.setVelocity(api.me, {y: 5});</code> '
      + '— sans test de sol, on peut sauter en l\'air.</li>'
      + '<li>Un personnage sans corps rigide, avec gravité et détection de sol intégrées : '
      + '<code>api.moveCharacter()</code>.</li>'
      + '<li>Changer de niveau quand toutes les pièces sont prises : <code>api.changeScene</code>, '
      + 'voir ' + linkHelp('scripts-events', 'Événements et scènes') + '.</li></ul>')

  + '<h3>Voir aussi</h3><p>' + linkHelp('first-scene', 'Une première scène') + ' · '
  + linkHelp('physics', 'Physique') + ' · ' + linkHelp('scripts', 'Écrire un script') + ' · '
  + linkHelp('build', 'Exporter le jeu') + '</p>';
}},

{id:'tuto-game-2d', part:'tutorials', section:'Tutoriels', title:'Un jeu de plateforme 2D', level:'beginner',
 summary:'Un projet 2D, un décor en tuiles, un personnage à sprite qui court et saute, et ses collisions.',
 anchors:[
   {f:'js/ui.js', c:'{label:\'🎮 Projet 2D…\', action:function(){'},
   {f:'js/serialization.js', c:'tiles.name = \'Décor\';'},
   {f:'js/serialization.js', c:'cam.addComponent(\'CameraFollow\', {});'},
   {f:'js/world-2d.js', c:'actionLeft:\'left\', actionRight:\'right\', actionJump:\'jump\','},
   {f:'js/objects.js', c:'{type:\'group\', label:\'Groupe (nœud vide)\', icon:\'⬡ \'},'},
   {f:'js/ui/panels-components.js', c:'options: [[\'platform\', \'de côté (plateforme)\'], [\'topdown\', \'de dessus (8 directions)\']]'}
 ],
 html:function(){ return ''
  + essentialHelp('<p>Le préréglage <b>Projet 2D</b> pose un décor en tuiles et une caméra 2D qui '
    + 'suit. Vous y ajoutez un personnage : un sprite, un corps rigide 2D, une boîte de collision '
    + 'et un contrôleur qui le fait courir et sauter <b>sans écrire de code</b>.</p>')

  + '<h3>1. Le projet 2D</h3>'
  + stepsHelp([
      '<b>Fichier → Nouveau → 🎮 Projet 2D…</b>, et confirmez : la scène courante est vidée, '
        + 'les assets sont conservés.',
      'La Hiérarchie contient <code>Décor</code> (une ' + linkHelp('component-Tilemap', 'Tilemap')
        + ' dont les deux rangées du bas sont peintes) et <code>Caméra 2D</code> (orthographique, '
        + 'avec un <b>Suivi de caméra</b>).'
    ])

  + '<h3>2. L\'image du personnage</h3>'
  + stepsHelp([
      '<b>Fichier → Importer des assets…</b> et choisissez une image PNG de votre personnage.',
      'Sélectionnez la texture importée dans le ' + linkHelp('panel-project', 'panneau Projet')
        + ', puis <b>＋ Créer → 🖼 Sprite (depuis la texture sélectionnée)</b>.'
    ])
  + tipHelp('Pour un pixel art net, gardez des images à petite résolution : la caméra du '
    + 'préréglage est réglée en pixel parfait.')

  + '<h3>3. Le personnage</h3>'
  + stepsHelp([
      '<b>Objet → Groupe (nœud vide)</b>. Renommez-le <code>Joueur</code> et placez-le au-dessus '
        + 'du sol peint.',
      '<b>+ Composant → Sprite</b>, et choisissez votre sprite dans son champ.',
      '<b>+ Composant → Corps rigide 2D</b> : il donne la gravité. Laissez <b>Statique</b> décoché.',
      '<b>+ Composant → Collider 2D</b>, <b>Forme</b> <b>Boîte</b>. Ajustez <b>Largeur</b> et '
        + '<b>Hauteur</b> au corps du personnage, pas à toute l\'image.',
      '<b>+ Composant → Contrôleur de personnage 2D</b>, <b>Vue</b> <b>de côté (plateforme)</b>. '
        + 'Réglez <b>Vitesse</b> et <b>Hauteur de saut</b>.'
    ])
  + '<p>Le contrôleur lit les actions <code>left</code>, <code>right</code> et <code>jump</code> '
  + 'de la table d\'entrées : <kbd>Q</kbd>/<kbd>A</kbd>/<kbd>←</kbd>, <kbd>D</kbd>/<kbd>→</kbd> '
  + 'et <kbd>Espace</kbd>, manette comprise.</p>'

  + '<h3>4. La caméra suit le joueur</h3>'
  + stepsHelp([
      'Sélectionnez <code>Caméra 2D</code>. Dans <b>Suivi de caméra</b>, champ <b>Suit</b>, '
        + 'choisissez <code>Joueur</code>.',
      'Section <b>Bornes du niveau</b> : cliquez <b>Déduire du décor</b>, pour que la caméra ne '
        + 'montre jamais le vide au-delà des tuiles.'
    ])

  + '<h3>5. Peindre le niveau</h3>'
  + stepsHelp([
      'Ouvrez la palette : <b>Fenêtres → Palette de tuiles</b>.',
      'Sélectionnez <code>Décor</code> et peignez des plateformes dans la vue.',
      'Dans l\'inspecteur de la Tilemap, laissez <b>Collision</b> sur <b>Selon les tuiles de la '
        + 'palette</b> : chaque tuile y est réglée Aucune, Solide ou Plateforme.'
    ])
  + '<p>Le détail des pentes, des plateformes traversables et des déclencheurs est sur '
  + linkHelp('collisions-2d', 'Collisions 2D') + '.</p>'

  + '<h3>6. Un ramassage</h3>'
  + stepsHelp([
      'Créez un second Groupe avec un <b>Sprite</b> de pièce, sans corps rigide. Champ <b>Tag</b> : '
        + '<code>piece</code>.',
      'Sur le Joueur, <b>+ Composant → Script</b> avec ce code :'
    ])
  + '<pre><code>function start(api){\n'
  + '  api.onContact(\'piece\', function(piece){\n'
  + '    api.destroy(piece);\n'
  + '    api.state.score = (api.state.score || 0) + 1;\n'
  + '  });\n'
  + '}</code></pre>'

  + '<h3>7. Lancer</h3>'
  + stepsHelp([
      '<b>Jouer</b>, dans la barre du haut.',
      'Courez, sautez, ramassez. <b>Fichier → Enregistrer</b> une fois satisfait.'
    ])
  + trapHelp('Le personnage traverse le sol ? Il lui manque le <b>Collider 2D</b>, ou la Tilemap '
    + 'est réglée <b>Collision : Aucune (décor)</b>. Il ne bouge pas ? Il lui manque le <b>Corps '
    + 'rigide 2D</b> : le contrôleur pousse ce corps.')

  + advancedHelp('Animer le sprite',
      '<p>Une planche découpée en régions et le composant '
      + linkHelp('component-SpriteAnimator', 'Animation de sprite') + ' donnent la marche et le '
      + 'saut ; un script choisit la suite avec <code>api.playSequence(\'marche\')</code>.</p>')

  + '<h3>Voir aussi</h3><p>' + linkHelp('game-2d', 'Le jeu 2D') + ' · '
  + linkHelp('component-CharacterController2D', 'Contrôleur de personnage 2D') + ' · '
  + linkHelp('component-Rigidbody2D', 'Corps rigide 2D') + ' · '
  + linkHelp('component-Collider2D', 'Collider 2D') + '</p>';
}},

{id:'tuto-mixamo', part:'tutorials', section:'Tutoriels', title:'Un personnage Mixamo animé', level:'beginner',
 summary:'Importer un personnage et ses animations Mixamo, recibler les clips, et les piloter par une machine à états.',
 anchors:[
   {f:'js/ui.js', c:'{label:\'Importer des assets…\', action:function(){ inputImport.click(); }},'},
   {f:'js/anim-models.js', c:'export function animationsExternalFor(o){'},
   {f:'js/ui/panels-components.js', c:'label: \'⇥ \' + e.asset.name'},
   {f:'js/assets.js', c:'copie.addComponent(\'AnimatorController\', {assetId: null, target: \'\'});'},
   {f:'js/ui/panels-components.js', c:'label: \'＋ Créer une machine…\''},
   {f:'editor.html', c:'<button id="graph-add-state">＋ État</button>'},
   {f:'js/animator.js', c:'setTrigger:'}
 ],
 html:function(){ return ''
  + essentialHelp('<p>Mixamo fournit un personnage ' + termHelp('Rig') + ' et des animations '
    + 'séparées. On importe le tout, on pose les animations sur le personnage par '
    + termHelp('Reciblage') + ', puis une ' + termHelp('Machine à états') + ' choisit le '
    + termHelp('Clip') + ' à jouer selon ce que fait le joueur.</p>')

  + '<h3>1. Télécharger depuis Mixamo</h3>'
  + stepsHelp([
      'Le personnage : format <b>FBX</b>, avec sa peau (<i>With Skin</i>).',
      'Chaque animation (repos, marche, course) : format <b>FBX</b>, <i>Without Skin</i> suffit. '
        + 'Cochez <i>In Place</i> si vous voulez déplacer le personnage par script.'
    ])

  + '<h3>2. Importer</h3>'
  + stepsHelp([
      '<b>Fichier → Importer des assets…</b>, et sélectionnez tous les FBX d\'un coup.',
      'Glissez le <b>personnage</b> du ' + linkHelp('panel-project', 'panneau Projet') + ' dans la '
        + 'vue. Il arrive avec un composant <b>Machine à états</b> vide.'
    ])
  + tipHelp('Un modèle Mixamo est à l\'échelle 0,01 dans son fichier : s\'il paraît minuscule ou '
    + 'géant, réglez l\'échelle dans les réglages d\'import du modèle. Voir '
    + linkHelp('units', 'Les unités') + '.')

  + '<h3>3. Recibler les animations</h3>'
  + stepsHelp([
      'Dans la Hiérarchie, dépliez le personnage et sélectionnez le nœud qui porte le '
        + linkHelp('component-SkinnedMeshRenderer', 'Maillage skinné') + '.',
      'Section <b>Animation</b> : chaque clip des autres assets compatibles apparaît en '
        + '<b>⇥ nom (durée, %)</b>. Le pourcentage dit combien d\'os correspondent.',
      'Cliquez chaque animation à reprendre : elle est posée sur le personnage et s\'affiche dans '
        + 'la timeline. <b>▶ ⏸ Jouer/Pause dans la vue</b> la prévisualise.'
    ])
  + '<p>Tous les exports Mixamo partagent les mêmes noms d\'os : la correspondance est '
  + 'directe, d\'où les 100 %. Pour un squelette d\'une autre origine, la section <b>Avatar '
  + 'humanoïde</b> et son bouton de détection font le lien ; voir '
  + linkHelp('retargeting', 'Reciblage') + '.</p>'

  + '<h3>4. La machine à états</h3>'
  + stepsHelp([
      'Sélectionnez la racine du personnage. Dans <b>Machine à états</b>, cliquez '
        + '<b>＋ Créer une machine…</b>.',
      'Cliquez <b>🔀 Ouvrir l\'éditeur Animator</b> : le graphe s\'ouvre.',
      'Cliquez <b>＋ État</b> deux fois. Sélectionnez le premier, et dans l\'inspecteur, champ '
        + '<b>Animation</b>, choisissez le clip de repos ; le second reçoit la marche.',
      'Cliquez <b>＋ Paramètre</b> et nommez-le <code>vitesse</code>.',
      'Tirez la poignée <b>→</b> d\'un état vers l\'autre pour créer une transition, et ajoutez-lui '
        + 'une condition sur <code>vitesse</code>. Faites de même dans l\'autre sens.'
    ])

  + '<h3>5. Piloter par script</h3>'
  + '<pre><code>function update(api){\n'
  + '  const x = api.axis(\'horizontal\');\n'
  + '  const z = -api.axis(\'vertical\');\n'
  + '  const v = Math.hypot(x, z);\n'
  + '  const a = api.animator();\n'
  + '  if(a) a.setFloat(\'vitesse\', v);\n'
  + '  if(v &gt; 0){\n'
  + '    api.me.position.x += x * 2 * api.dt;\n'
  + '    api.me.position.z += z * 2 * api.dt;\n'
  + '    api.me.rotation.y = Math.atan2(x, z);   // regarde où il va (+Z = devant)\n'
  + '  }\n'
  + '}</code></pre>'
  + '<p>Attachez ce script à la racine du personnage, puis <b>Jouer</b>.</p>'
  + trapHelp('<code>api.animator()</code> rend <code>null</code>, avec un avertissement dans la '
    + 'Console, si l\'objet ne porte pas de Machine à états — d\'où le <code>if(a)</code>. Un nom '
    + 'de paramètre mal tapé avertit aussi, sans planter.')

  + advancedHelp('Root motion et couches',
      '<p>Si vos animations n\'étaient pas exportées <i>In Place</i>, le champ <b>Root motion</b> '
      + 'de la Machine à états choisit entre déplacer l\'objet ou annuler le déplacement du clip. '
      + 'Pour « marcher en bas, viser en haut », <code>api.layerAnimation</code> joue un clip sur '
      + 'un os et sa descendance.</p>')

  + '<h3>Voir aussi</h3><p>' + linkHelp('animator', 'Animator') + ' · '
  + linkHelp('retargeting', 'Reciblage') + ' · '
  + linkHelp('component-AnimatorController', 'Fiche Machine à états') + '</p>';
}}

];
