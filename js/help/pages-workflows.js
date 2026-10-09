// ---------- Aide de l'éditeur : partie « workflows » ----------
// Une page = {id, part, section, title, level, anchors, html}. Les ancres sont vérifiées
// par test/aide.test.mjs (voir l'en-tête de js/help-content.js).
import { advancedHelp, arrayHelp, defaultHelp, essentialHelp, linkHelp, stepsHelp, termHelp, tipHelp, trapHelp, TAGS_BUILD_FULL } from './help-format.js';
import { renderApiHelp, renderCommandsHelp, renderPropsMaterialHelp, renderShortcutsHelp } from '../help-page.js';

export const PAGES_WORKFLOWS = [

{id:'materials-contract', part:'workflows', section:'Matériaux', title:'Le contrat glTF', level:'both',
 summary:'Pourquoi l\'éditeur suit glTF, et comment déclarer l\'ordre des canaux d\'un masque combiné.',
 anchors:[
   {f:'js/material-props.js', c:"['orm', 'glTF / ORM — R occl. · G rugosité · B métal']"},
   {f:'js/material-props.js', c:"['unity', 'Unity HDRP — R métal · G occl. · A lissage']"}
 ],
 html:function(){ return ''
  + essentialHelp('<p>Un <b>masque combiné</b> range trois informations (occlusion, rugosité, métal) dans une seule texture. L\'éditeur attend l\'ordre <b>glTF / ORM</b>. Une texture faite pour Unity HDRP se déclare dans le champ <b>Empaquetage</b> — sinon le matériau est faux, sans aucune erreur.</p>')

  + '<h3>Brancher un masque combiné</h3>'
  + stepsHelp([
      'Sélectionnez le matériau (dans le panneau Projet ou sur l\'objet).',
      'Glissez la texture du masque sur l\'emplacement <b>Masque comb.</b>.',
      'Sous l\'emplacement, réglez <b>Empaquetage</b> selon l\'outil qui a produit la texture : <b>glTF / ORM</b> pour Blender, Substance et la plupart des exports ; <b>Unity HDRP</b> pour un masque « MaskMap » d\'Unity.',
      'Vérifiez à l\'œil : un objet « bizarrement métallique » ou « sale au mauvais endroit » trahit un mauvais empaquetage.'
    ])

  + '<h3>L\'ordre des canaux, selon le moteur</h3>'
  + arrayHelp(null, [
      ['<b>glTF / ORM</b> (le nôtre)', 'R occlusion · G rugosité · B métal'],
      ['Unity HDRP', 'R métal · G occlusion · A lissage'],
      ['Unity URP', 'pas de masque : métal (R + alpha lissage) et occlusion séparées']
    ])

  + trapHelp('<b>Le piège.</b> Se tromper d\'empaquetage ne provoque aucune '
  + 'erreur. La texture est valide, le matériau se construit, l\'objet s\'affiche — avec '
  + 'l\'occlusion et le métal permutés et la rugosité inversée. Le résultat est faux mais '
  + 'plausible, et rien ne le signalera.')

  + advancedHelp('Pourquoi glTF, et ce que coûte la conversion', '<p>L\'éditeur suit <b>glTF, la norme de Khronos</b>, et non la convention d\'un moteur '
  + 'particulier. Ce choix a une raison pratique : glTF est ce qu\'exportent Blender, '
  + 'Substance et à peu près tout ce qui n\'est pas Unity, et c\'est ce que notre moteur de '
  + 'rendu lit <b>sans conversion</b>.</p>'
  + '<p>En <b>glTF / ORM</b> la texture part au GPU telle quelle. En <b>Unity HDRP</b> '
  + 'elle est convertie au chargement : même résultat à l\'écran, une passe de calcul et une '
  + 'copie en mémoire en plus.</p>'
  + '<p><b>Les projets d\'avant.</b> Un projet enregistré avant l\'adoption de l\'ORM garde son aspect exact : la migration '
  + 'du fichier déclare ses masques en <b>Unity HDRP</b>, puisque c\'était la seule convention '
  + 'acceptée alors. Rien à faire.</p>')
  + '<h3>Voir aussi</h3><ul>'
  + '<li>' + linkHelp('materials-maps', 'Les cartes PBR') + '</li>'
  + '<li>' + linkHelp('materials-reference', 'Toutes les propriétés') + '</li>'
  + '<li>' + linkHelp('import-substance', 'Importer depuis Substance') + '</li>'
  + '</ul>';
}},

{id:'materials-maps', part:'workflows', section:'Matériaux', title:'Les cartes PBR', level:'both',
 summary:'Le rôle de chaque emplacement de texture d\'un matériau.',
 anchors:[
   {f:'js/material-props.js', c:"requires:['normalAsset'], ifMissing:'greyed'"},
   {f:'js/material-props.js', c:"key:'normalDirectX'"},
   {f:'js/material-props.js', c:"Vaut pour TOUTES les cartes du matériau à la fois"}
 ],
 html:function(){ return ''
  + essentialHelp('<p>Un matériau a un <b>emplacement par rôle</b> : couleur, relief, rugosité, métal, lumière propre… Le curseur au-dessus d\'une map la '
  + '<b>multiplie</b> : à 1 (ou blanc pour l\'émissif) la texture passe telle quelle.</p>')

  + '<h3>Habiller un objet</h3>'
  + stepsHelp([
      'Importez vos textures dans le panneau Projet.',
      'Sélectionnez le matériau, puis glissez chaque texture sur son emplacement (tableau ci-dessous).',
      'Laissez le champ <b>Couleur</b> blanc si l\'albédo porte déjà la teinte.',
      'Réglez le <b>Tuilage</b> si la texture doit se répéter sur la surface.'
    ])
  + tipHelp('Exporté de Substance ou de Blender avec les bons suffixes, un modèle se branche tout seul : '
  + 'voir ' + linkHelp('import-substance', 'Importer depuis Substance ou Blender') + '.')

  + '<h3>Les emplacements</h3>'
  + arrayHelp(null, [
      ['Albedo', 'la couleur de base. Le champ Couleur la teinte — laissez-le blanc si la '
        + 'texture porte déjà la teinte.'],
      ['Normale', 'le relief simulé. Attention à la convention : voir ci-dessous.'],
      ['Masque comb.', 'trois canaux en une texture. ' + linkHelp('materials-contract', 'Voir le contrat glTF') + '.'],
      ['Rugosité / Métal / Occlusion', 'les mêmes informations, en cartes séparées. Le masque '
        + 'combiné, s\'il est branché, est prioritaire sur les trois.'],
      ['Émissive', 'ce qui brille tout seul. Brancher une map passe la couleur émissive au '
        + 'blanc — sinon elle multiplierait la map par du noir et rien ne s\'allumerait.'],
      ['Hauteur', 'deux modes, voir ' + linkHelp('materials-height', 'la page dédiée') + '.']
    ])

  + trapHelp('<b>Normales DirectX : le relief s\'inverse.</b> Les deux conventions ne diffèrent que par <b>le canal vert</b>. glTF et notre moteur '
  + 'veulent l\'<b>OpenGL</b> (vert vers le haut). Une map DirectX branchée sans correction '
  + '<b>inverse le relief</b> : les bosses deviennent des creux. Aucune erreur : l\'image est valide, seule la lumière est '
  + 'à l\'envers. La case <b>Normale DirectX</b> corrige. Elle se coche toute seule quand le '
  + 'nom du fichier l\'annonce (<code>_Normal_DirectX</code>, <code>_NormalDX</code>).')

  + advancedHelp('Lissage, pas rugosité', '<p>L\'éditeur travaille en <b>' + termHelp('lissage') + '</b> : 1 = miroir, 0 = mat. '
  + 'C\'est l\'inverse de la rugosité. Les cartes <b>séparées</b>, elles, restent encodées en '
  + 'rugosité — c\'est ce que produisent les suffixes <code>_R</code> / <code>_Roughness</code>. '
  + 'Le lissage vit dans le canal alpha des masques HDRP.</p>')

  + advancedHelp('Un tuilage pour tout le matériau', '<p>Le <b>' + termHelp('Tuilage') + '</b> et le décalage valent pour TOUTES les cartes du '
  + 'matériau à la fois. Il n\'y a pas de tuilage par emplacement : on ne peut pas répéter la '
  + 'normale dix fois sur un albédo répété une fois.</p>')
  + '<h3>Voir aussi</h3><ul>'
  + '<li>' + linkHelp('materials-contract', 'Le contrat glTF') + '</li>'
  + '<li>' + linkHelp('materials-height', 'La map de hauteur') + '</li>'
  + '<li>' + linkHelp('materials-reference', 'Toutes les propriétés') + '</li>'
  + '<li>' + linkHelp('shader-graph', 'Le graphe de shader') + '</li>'
  + '</ul>';
}},

{id:'materials-height', part:'workflows', section:'Matériaux', title:'La map de hauteur', level:'both',
 summary:'Ce que fait, et ne fait pas, la carte de hauteur.',
 anchors:[
   {f:'js/material-props.js', c:"['move', 'Déplacement — maillage subdivisé requis']"},
   {f:'js/material-props.js', c:'est une hauteur EN MÈTRES : 1 est énorme, essayez 0,05.'},
   {f:'test/hauteur.test.mjs', c:'displacementBias'}
 ],
 html:function(){ return ''
  + essentialHelp('<p>Une map de hauteur donne du relief à une surface, de deux façons très différentes. Le moteur expose les '
  + 'deux plutôt que d\'en choisir une à votre place. En cas de doute, choisissez <b>Relief</b>.</p>')
  + arrayHelp(null, [
      ['<b>Relief</b>', 'la lumière fait croire au creux, la <b>silhouette ne bouge pas</b>. '
        + 'Marche sur n\'importe quel maillage, effet visible immédiatement.'],
      ['<b>Déplacement</b>', 'les sommets bougent vraiment, la silhouette change. Exige un '
        + '<b>maillage subdivisé</b>.']
    ])
  + '<h3>Ajouter du relief</h3>'
  + stepsHelp([
      'Glissez la texture de hauteur sur l\'emplacement <b>Hauteur</b> du matériau.',
      'Choisissez le mode : <b>Relief</b> pour une primitive ou un maillage simple, <b>Déplacement</b> pour un maillage finement subdivisé.',
      'En Déplacement, commencez par une intensité de <b>0,05</b> et montez doucement.'
    ])
  + trapHelp('En mode Déplacement sur une primitive du moteur, <b>il ne se passe '
  + 'rien de visible</b> : un cube n\'a que huit sommets à déplacer. Ce n\'est pas un défaut. '
  + 'Utilisez Relief, ou un maillage subdivisé venu d\'un logiciel de modélisation.')

  + advancedHelp('L\'intensité est en mètres', '<p>En mode Déplacement, l\'intensité est une <b>hauteur réelle</b> : 1 signifie un mètre, '
  + 'ce qui est énorme. Essayez 0,05. Le <b>gris moyen</b> de la map vaut « surface '
  + 'd\'origine » — c\'est pourquoi brancher une hauteur creuse et bombe autour de la surface '
  + 'au lieu de faire gonfler l\'objet entier.</p>')

  + advancedHelp('Ce que ce n\'est pas : la parallaxe', '<p>Ce n\'est pas de la <b>parallaxe</b>. Le « Height Map » d\'Unity décale les UV dans le '
  + 'shader pour simuler la profondeur sans bouger un sommet ; notre moteur de rendu ne sait '
  + 'pas le faire. Les deux modes ci-dessus sont ce qu\'il sait faire.</p>')
  + '<h3>Voir aussi</h3><ul>'
  + '<li>' + linkHelp('materials-maps', 'Les cartes PBR') + '</li>'
  + '<li>' + linkHelp('materials-reference', 'Toutes les propriétés') + '</li>'
  + '</ul>';
}},

{id:'materials-reference', part:'workflows', section:'Matériaux', title:'Toutes les propriétés', level:'advanced',
 summary:'La table complète des propriétés d\'un matériau, lue dans le code.',
 anchors:[
   {f:'js/material-props.js', c:'const PROPS_MATERIAL = ['},
   {f:'js/material-props.js', c:'function statePropMaterial(d, p)'}
 ],
 html:function(){ return ''
  + essentialHelp('<p>Tous les champs de l\'inspecteur d\'un matériau, avec leurs plages et leurs dépendances. Une ligne grisée ou absente dans l\'inspecteur s\'explique par sa colonne « Demande ».</p>')
  + renderPropsMaterialHelp()
  + '<h3>Lire la colonne « Demande »</h3>'
  + '<p>« Demande » signale une dépendance. Deux comportements différents :</p>'
  + '<ul>'
  + '<li><b>sans effet</b> — le champ reste visible mais inerte. On veut qu\'on VOIE qu\'il '
  + 'existe et qu\'on comprenne pourquoi il ne fait rien.</li>'
  + '<li><b>sans objet</b> — le champ disparaît : il n\'aurait aucun sens à afficher.</li>'
  + '</ul>'
  + trapHelp('Un champ masqué <b>garde sa valeur</b>. Débrancher une map de '
  + 'normales fait disparaître la case « Normale DirectX », mais ne la décoche pas : rebrancher '
  + 'une map plus tard la retrouve cochée. C\'est voulu — on ne perd pas un réglage en '
  + 'changeant une texture — mais ça surprend.')
  + advancedHelp('D\'où vient ce tableau', '<p>Ce tableau <b>n\'est pas recopié</b> : il est engendré à l\'affichage depuis '
  + '<code>PROPS_MATERIAU</code> (<code>js/material-props.js</code>), la même table qui dessine '
  + 'l\'inspecteur et que lit le copilote. Une propriété ajoutée au moteur apparaît ici sans '
  + 'que personne y pense, et aucune plage affichée ici ne peut différer de celle que le moteur '
  + 'applique.</p>')
  + '<h3>Voir aussi</h3><ul>'
  + '<li>' + linkHelp('materials-maps', 'Les cartes PBR') + '</li>'
  + '<li>' + linkHelp('component-Mesh', 'Le composant Maillage') + '</li>'
  + '</ul>';
}},

{id:'import-model', part:'workflows', section:'Assets', title:'Importer un modèle (FBX, glTF)', level:'both',
 summary:'Importer un FBX ou un glTF, régler son import et le poser dans la scène.',
 anchors:[
   {f:'js/import-settings.js', c:"[['model', 'Modèle'], ['rig', 'Rig'], ['animation', 'Animation'],"},
   {f:'js/model-import.js', c:"materialCreation: 'import',"},
   {f:'js/anim-asset.js', c:'export const CLIP_SETTINGS_DEFAULT = {'},
   {f:'js/model-nodes.js', c:'export function exposeModelNodes(root, params, hooks){'},
   {f:'js/model-nodes.js', c:'export function captureModelOverrides(root, template, serializeComponents){'}
 ],
 html:function(){ return ''
  + essentialHelp('<p>Un fichier <b>FBX</b> ou <b>glTF</b> n\'est pas un objet : c\'est un <b>conteneur</b> '
  + 'd\'assets, comme dans Unity — maillages, matériaux, <b>clips</b> d\'animation, <b>Avatar</b>, squelette. '
  + 'On l\'importe dans le panneau Projet, on règle son import, puis on le glisse dans la scène.</p>')

  + '<h3>Importer et poser un modèle</h3>'
  + stepsHelp([
      'Glissez le fichier dans le panneau Projet (ou <b>Fichier → Importer des assets…</b>).',
      'Dépliez sa tuile (▸) : ses maillages, matériaux, clips, Avatar et squelette y apparaissent, en lecture seule. Un clip se glisse directement sur un état de l\'Animator.',
      'Cliquez la tuile : l\'inspecteur montre les paramètres d\'import, en quatre onglets. Rien ne change tant qu\'on n\'a pas cliqué <b>Appliquer</b>.',
      'Glissez le fichier dans la vue : une <b>instance</b> de tout ce qu\'il contient est posée dans la scène.',
      'Dans la vue, le premier clic prend le modèle entier, le second la pièce touchée.'
    ])

  + '<h3>Les quatre onglets d\'import</h3>'
  + arrayHelp(['Onglet', 'Ce qu\'il règle'], [
      ['<b>Modèle</b>', 'Unités et échelle, blend shapes, visibilité, caméras et lumières du '
       + 'fichier, hiérarchie (conserver, trier), colliders générés, normales (et leur source de '
       + 'lissage, angle compris), tangentes, échange et dépliage des UV.'],
      ['<b>Rig</b>', 'Type d\'animation (aucune, générique, humanoïde), poids de peau, nœud '
       + 'racine du root motion, Avatar créé ou copié d\'un autre modèle, « Optimiser les '
       + 'GameObjects ».'],
      ['<b>Animation</b>', 'Import et réduction des clés, puis la liste des clips tirés des '
       + 'prises du fichier : découpe, boucle, Loop Pose, décalage de cycle, root motion cuit ou '
       + 'non dans la pose, miroir, masque d\'os, événements.'],
      ['<b>Matériaux</b>', 'Mode de création (importé, PBR refait, aucun), couleurs sRGB, '
       + 'matériaux externes, remplacement par emplacement, recherche par nom, extraction des '
       + 'matériaux et des textures embarquées.']
    ])
  + tipHelp('L\'infobulle de chaque réglage rappelle son nom d\'origine dans Unity.')

  + '<h3>Le modèle dans la scène</h3>'
  + '<p>Ses nœuds et ses <b>os</b> sont des objets de la hiérarchie (en violet), qu\'on '
  + 'sélectionne, qu\'on déplace au gizmo et sur lesquels on ajoute des composants — un '
  + 'collider sur la main, une arme accrochée à un os. Chaque maillage skinné porte son '
  + '<b>SkinnedMeshRenderer</b>, et la racine d\'un modèle rigué ou animé reçoit un '
  + '<b>Animator</b> vide, comme dans Unity : glissez-y une machine à états pour le faire jouer '
  + '(« Aucune » dans l\'onglet Rig n\'en pose pas).</p>'
  + trapHelp('Un nœud venu du fichier ne se supprime, ne se renomme ni '
  + 'ne change de parent — il vient du fichier, et c\'est par son nom qu\'une animation le '
  + 'retrouve. Pour le faire disparaître, <b>désactivez-le</b>.')

  + advancedHelp('Overrides et réimport', '<p>Les modifications faites sur une instance sont des <b>overrides</b> : elles sont enregistrées avec l\'instance et '
  + '<b>survivent au réimport</b> du fichier.</p>')
  + advancedHelp('Ce qu\'Unity propose et qui manque ici', '<p>Compression '
  + 'de maillage, Read/Write, Optimize Mesh, Keep Quads (three n\'en a pas l\'usage), les '
  + 'contraintes et courbes animées du fichier, et la pose additive de référence. Les autres '
  + 'réglages sont ceux d\'Unity, sous leur nom français.</p>')
  + '<h3>Voir aussi</h3><ul>'
  + '<li>' + linkHelp('import-substance', 'Importer les textures de Substance ou Blender') + '</li>'
  + '<li>' + linkHelp('panel-project', 'Le panneau Projet') + '</li>'
  + '<li>' + linkHelp('component-Model', 'Le composant Modèle') + '</li>'
  + '<li>' + linkHelp('retargeting', 'Rigs et reciblage') + '</li>'
  + '<li>' + linkHelp('tuto-mixamo', 'Tutoriel : un personnage Mixamo animé') + '</li>'
  + '<li>' + linkHelp('prefabs', 'Prefabs') + '</li>'
  + '</ul>';
}},

{id:'import-substance', part:'workflows', section:'Assets', title:'Importer depuis Substance ou Blender', level:'both',
 summary:'Brancher automatiquement les textures d\'un export Substance ou Blender sur les matériaux du modèle.',
 anchors:[
   {f:'js/material-extraction.js', c:'_OcclusionRoughnessMetallic'},
   {f:'js/material-extraction.js', c:"prefixeTexture:'TX_'"}
 ],
 html:function(){ return ''
  + essentialHelp('<p>Pas besoin de brancher les textures une à une : le <b>nom des fichiers</b> suffit. '
  + 'Exportez avec les suffixes standard (<code>_BaseColor</code>, <code>_Normal</code>, <code>_ORM</code>…) '
  + 'et, de préférence, en <b>glTF / ORM</b> : c\'est la convention que l\'éditeur lit sans conversion.</p>')
  + '<h3>Ramener un modèle texturé</h3>'
  + stepsHelp([
      'Déposez le modèle et ses textures dans le panneau Projet.',
      'Cliquez la tuile du modèle pour ouvrir ses paramètres d\'import.',
      'Cliquez <b>🎨 Extraire les matériaux</b> : un matériau est créé par emplacement du '
      + 'fichier, et les textures dont le nom concorde y sont branchées.',
      'Vérifiez un matériau : chaque emplacement doit porter la bonne texture.'
    ])

  + '<h3>Les suffixes reconnus</h3>'
  + '<p>Ceux des préréglages d\'export de Substance Painter le sont d\'origine : '
  + '<code>_BaseColor</code>, <code>_Normal</code>, <code>_Normal_OpenGL</code>, '
  + '<code>_Normal_DirectX</code>, <code>_OcclusionRoughnessMetallic</code>, <code>_ORM</code>, '
  + '<code>_ARM</code>, <code>_AmbientOcclusion</code>, <code>_Roughness</code>, '
  + '<code>_Metallic</code>, <code>_Emissive</code>, <code>_Height</code>.</p>'
  + tipHelp('Le suffixe d\'un masque décide aussi de son ' + linkHelp('materials-contract', 'empaquetage') + ' : '
  + 'un <code>_ORM</code> et un <code>_MaskMap</code> ne se lisent pas pareil, et l\'extraction '
  + 'le renseigne pour vous.')

  + advancedHelp('La règle du préfixe', '<p>Les préférences déclarent un préfixe de texture (<code>TX_</code> par défaut). Il sert '
  + 'à ce qu\'une capture d\'écran posée à côté du FBX ne soit pas prise pour une texture. '
  + 'Mais il ne bloque pas tout :</p>'
  + '<ul>'
  + '<li>un suffixe <b>explicite</b> (<code>_BaseColor</code>, <code>_ORM</code>, <code>_AO</code>) '
  + 'suffit à lui seul — c\'est ce qui permet de lire un export Substance, qui n\'a pas de préfixe ;</li>'
  + '<li>un suffixe d\'<b>une seule lettre</b> (<code>_C</code>, <code>_D</code>, <code>_N</code>) '
  + 'exige le préfixe : « photo_D.png » n\'est pas une texture diffuse ;</li>'
  + '<li>un nom <b>sans suffixe</b> n\'est pris pour une couleur de base que s\'il a le préfixe.</li>'
  + '</ul>'
  + '<p>Tout cela se règle dans <b>Édition → Préférences (convention de nommage)</b> : c\'est '
  + 'une préférence de votre poste, pas du projet, parce qu\'une convention suit un pipeline et '
  + 'une personne.</p>')
  + '<h3>Voir aussi</h3><ul>'
  + '<li>' + linkHelp('materials-contract', 'Le contrat glTF') + '</li>'
  + '<li>' + linkHelp('materials-maps', 'Les cartes PBR') + '</li>'
  + '<li>' + linkHelp('import-model', 'Importer un modèle') + '</li>'
  + '</ul>';
}},

{id:'assets-made', part:'workflows', section:'Assets', title:'Fabriquer des assets sans fichiers', level:'both',
 summary:'Fabriquer textures, planches de tuiles, personnages et bruitages de substitution, sans fichier source.',
 anchors:[
   {f:'js/proc-texture.js', c:"const genres = ['solid', 'checker', 'gradient', 'noise', 'tuiles16', 'character', 'text'];"},
   {f:'js/proc-texture.js', c:'const TILE_TOP = 1, TILE_RIGHT = 2, TILE_BOTTOM = 4, TILE_LEFT = 8;'},
   {f:'js/proc-texture.js', c:'if(!(i & TILE_TOP))   fillRect(t, ox, oy, p, e, cEdge);'},
   {f:'js/proc-texture.js', c:'const n = Math.max(1, Math.min(16, Math.round(nb) || 4));'},
   {f:'js/proc-sound.js', c:"const genres = ['beep', 'jump', 'fall', 'impact', 'step', 'coin'];"},
   {f:'js/proc-sound.js', c:'const SOUND_PROC_SR = 22050;'},
   {f:'js/copilot-workshop.js', c:"name: 'create_texture',"},
   {f:'editor.html', c:'id="btn-make"'},
   {f:'js/ui-factory.js', c:"const factoryState = {tab: 'texture'"},
   {f:'js/ui-factory.js', c:"cv.style.imageRendering = 'pixelated';"},
   {f:'js/ui-factory.js', c:'const copie = factoryState.sound.slice(0).buffer;'}
 ],
 html:function(){ return ''
  + essentialHelp('<p>Un niveau ne se juge pas sur du gris : sans contour on ne voit pas où un sol s\'arrête, '
  + 'sans images on ne voit pas si une animation joue, sans bruit on ne règle pas un saut. Le bouton '
  + '<b>🎲 Fabriquer</b> du panneau <b>Projet</b> crée des <b>substituts</b> — textures, planches de tuiles, '
  + 'personnage, bruitages — sans aucun fichier source, avec un <b>aperçu</b> avant de créer.</p>')

  + '<h3>Fabriquer un substitut</h3>'
  + stepsHelp([
      'Dans le panneau Projet, cliquez sur <b>🎲 Fabriquer</b>.',
      'Choisissez l\'onglet (image ou son), puis un genre. Les réglages proposés <b>marchent déjà</b>.',
      'Regardez la planche, ou écoutez le bruitage, dans l\'aperçu.',
      'Cliquez <b>Créer</b> : l\'asset apparaît dans le projet. Fabriquer deux fois donne « sol » puis « sol 2 », jamais un écrasement.'
    ])
  + tipHelp('Un essai qui ne convient pas <b>s\'annule</b> : <kbd>Ctrl</kbd> + <kbd>Z</kbd> retire '
  + 'l\'asset, et la croix <b>×</b> de sa vignette le retire aussi — cette suppression-là s\'annule '
  + 'également. Le <b>renommage</b> et les paramètres d\'import suivent : une rafale de frappe '
  + 'compte pour un seul pas, donc <kbd>Ctrl</kbd> + <kbd>Z</kbd> rend le nom d\'avant et non la '
  + 'lettre d\'avant. ' + linkHelp('copilot', 'Voir le grain exact de l\'annulation') + '.')

  + '<h3>Les images</h3>'
  + arrayHelp(['Genre', 'Ce qu\'il produit', 'Pour quoi'], [
      ['<code>tuiles16</code>', 'une planche de 16 tuiles, en 4 × 4', 'le décor d\'une map de tuiles — '
        + 'c\'est le genre à demander pour un platformer'],
      ['<code>personnage</code>', 'jusqu\'à <b>16</b> images d\'un bonhomme, sur une bande',
       'voir jouer une animation de sprite'],
      ['<code>unie</code>', 'un aplat', 'un mur, un sol, une couleur d\'essai'],
      ['<code>damier</code>', 'un damier de deux couleurs', 'juger une échelle, ou un étirement d\'UV'],
      ['<code>degrade</code>', 'un dégradé vertical', 'un ciel, un fond'],
      ['<code>bruit</code>', 'du bruit, avec une <b>graine</b>', 'une matière ; la graine rend le '
        + 'résultat reproductible d\'une fois sur l\'autre']
    ])
  + '<p>Le personnage <b>oscille d\'un pixel</b> une image sur deux, et porte <b>deux yeux</b> : sans '
  + 'oscillation on ne voit pas la cadence, et sans yeux on ne voit pas le <b>sens</b> — donc pas non plus '
  + 'un retournement à l\'envers, la faute la plus courante. Ces substituts sont <b>volontairement '
  + 'rudimentaires</b> : un substitut réussi est un substitut qu\'on remplace.</p>'

  + '<h3>Les bruitages</h3>'
  + '<p>Six genres : <code>bip</code>, <code>saut</code> (hauteur qui <b>monte</b>), <code>chute</code> '
  + '(qui descend), <code>impact</code>, <code>pas</code>, <code>piece</code>. ' + linkHelp('audio', 'Voir le son') + '.</p>'

  + trapHelp('<b>Planche de tuiles faite main : le bit dit « voisin PRÉSENT », donc le contour se dessine là où il vaut '
  + 'zéro.</b> C\'est l\'inverse de l\'intuition, et se tromper d\'un seul bit donne un décor dont les '
  + 'contours apparaissent <b>au milieu</b> des blocs pleins — un défaut qu\'on met sur le compte de '
  + 'l\'auto-tuilage alors qu\'il est dans la planche. ' + linkHelp('game-2d', 'Voir les cartes de tuiles') + '.')

  + advancedHelp('Le bouton et le copilote : une seule recette', '<p>Le bouton et les commandes '
  + '<code>create_texture</code> et <code>create_sound</code> du ' + linkHelp('copilot', 'copilote')
  + ' appellent la <b>même</b> fonction : un genre donné produit exactement le même '
  + 'fichier des deux côtés.</p>'
  + '<p>Ce que le bouton apporte en plus, c\'est l\'<b>aperçu</b> : un modèle ne voit pas une image et '
  + 'n\'entend pas un son. L\'aperçu est zoomé d\'un facteur <b>entier</b>, sans lissage : un aperçu '
  + 'interpolé d\'une planche de pixel-art rendrait les contours flous, et on la réglerait pour compenser '
  + 'un défaut qui n\'existe que dans l\'aperçu.</p>'
  + '<p>Une valeur hors bornes est <b>ramenée</b>, pas refusée : un refus obligerait à comprendre une '
  + 'contrainte avant de voir quoi que ce soit.</p>')
  + advancedHelp('L\'ordre des seize tuiles', '<p>Les 16 images sont dans l\'ordre exact que lit l\'auto-tuilage : <b>haut = 1, droite = 2, '
  + 'bas = 4, gauche = 8</b>. L\'image d\'indice <i>i</i> est celle du voisinage <i>i</i>, la planche se '
  + 'lisant en 4 × 4, de gauche à droite puis de haut en bas.</p>')
  + advancedHelp('Le format des bruitages', '<p>WAV mono 16 bits à <b>22 kHz</b>, environ 7 Ko pour 0,15 s. Un bruitage court n\'a rien à gagner à 48 kHz, '
  + 'et y pèserait le double. Tous sortent d\'une <b>attaque</b> et d\'une <b>extinction</b> : un son qui '
  + 'commence à pleine amplitude fait passer le haut-parleur de zéro à l\'amplitude en un échantillon, ce qui '
  + '<b>claque</b>.</p>')
  + advancedHelp('Sprites isométriques : <code>bake_iso_sprites</code>', '<p>Pour un jeu vu de trois quarts (stratégie, gestion), cette commande du copilote <b>rend</b> un modèle '
  + 'décrit en primitives (boîtes, tubes, sphères, cônes, toits) dans 1 à 16 directions et autant de poses '
  + 'qu\'on veut, avec ombre portée et un masque pour la <b>couleur d\'équipe</b> (primitives <code>team</code>). '
  + 'Elle crée la texture, son masque <code>_M</code> et une table <code>_Sprites</code> qui donne, pour chaque '
  + '« pose/direction », le rectangle dans la planche et le <b>point au sol</b> où poser l\'image. La direction 0 '
  + 'regarde vers le bas de l\'écran, puis on tourne dans le sens horaire.</p>')
  + advancedHelp('Réunir des planches : <code>build_atlas</code>', '<p>Un animateur de sprite lit toutes ses suites dans <b>une seule</b> planche : un personnage livré '
  + 'en neuf fichiers ne peut pas être animé tel quel. La planche s\'assemble aussi <b>à la main</b>, depuis '
  + 'l\'inspecteur d\'une planche — ' + linkHelp('game-2d', 'voir la 2D') + '.</p>')
  + '<h3>Voir aussi</h3><ul>'
  + '<li>' + linkHelp('panel-project', 'Le panneau Projet') + '</li>'
  + '<li>' + linkHelp('data-assets', 'Tables de contenu') + '</li>'
  + '<li>' + linkHelp('shader-graph', 'Le graphe de shader') + '</li>'
  + '</ul>';
}},

{id:'probes', part:'workflows', section:'Rendu', title:'Reflets et sondes', level:'both',
 summary:'Les sondes de réflexion : ce qu\'elles capturent et quand les recuire.',
 anchors:[
   {f:'js/environment.js', c:'skyReflets:true'},
   {f:'js/environment.js', c:'Le ciel sert de sonde de réflexion par défaut à toute la scène'},
   {f:'js/component-data.js', c:'radius: 18'},
   {f:'js/component-data.js', c:'resolution: 128'},
   {f:'js/probes.js', c:'Math.max(16, Math.min(512, s.resolution | 0 || 128))'},
   {f:'js/probes.js', c:'if(d <= s.radius && d < bestD)'}
 ],
 html:function(){ return ''
  + essentialHelp('<p>Une <b>sonde de réflexion</b> — composant <code>Reflection</code> — photographie son entourage '
  + 'dans les six directions et donne ce reflet aux objets qu\'elle couvre : c\'est ce qui rend une surface '
  + 'métallique ou lisse crédible. Sans sonde, les objets reflètent déjà le <b>ciel</b>.</p>')

  + '<h3>Poser une sonde</h3>'
  + stepsHelp([
      'Menu <b>Objet</b> → <b>🔮 Sonde de réflexion</b>, puis placez-la au centre de la pièce.',
      'Réglez son <b>Rayon d\'influence</b> pour couvrir la pièce.',
      '<b>Objet → 🔮 Cuire toutes les sondes</b>.',
      'Après chaque changement du décor, recuisez.'
    ])

  + '<h3>Régler une sonde</h3>'
  + arrayHelp(['Champ', 'Par défaut', 'Ce que ça fait'], [
      ['Rayon d\'influence', defaultHelp('18 m'),
       'La sphère d\'influence. Un objet reçoit la sonde <b>la plus proche qui le couvre</b> — '
       + 'il n\'y a pas de mélange entre deux sondes.'],
      ['Résolution', defaultHelp('128'),
       'Le côté d\'une face du cube, borné entre 16 et 512. Coûteux : montez-la seulement si le '
       + 'reflet est vraiment visible.'],
      ['Intensité', defaultHelp('1'), 'La force du reflet appliquée aux matériaux couverts.']
    ])

  + trapHelp('<b>La cuisson n\'est pas automatique pendant l\'édition.</b> Après '
  + 'avoir déplacé les murs d\'une pièce, il faut <b>recuire</b> pour que le reflet en tienne '
  + 'compte — sinon la sonde continue de distribuer la photo de l\'ancienne pièce, sans que '
  + 'rien ne le signale.')
  + trapHelp('Une sonde <b>jamais cuite</b> ne noircit pas les objets qu\'elle '
  + 'couvre : ils retombent sur le ciel, exactement comme s\'il n\'y avait pas de sonde. Une '
  + 'sonde oubliée est donc invisible, et pas seulement discrète.')

  + advancedHelp('Le ciel est déjà une sonde', '<p>Sans aucune sonde posée, un objet <b>reflète quand même</b> : le ciel de la scène sert '
  + 'de sonde par défaut à tout le monde, comme dans Unity. C\'est le réglage '
  + '<b>Reflets du ciel</b> de l\'environnement, actif par défaut, avec une intensité de 1. Une '
  + 'sonde ne s\'ajoute donc pas à rien : elle <b>remplace</b> le ciel, localement, par quelque '
  + 'chose de plus juste — le vrai décor autour.</p>'
  + '<p>Décocher « Reflets du ciel » retire ce repli. Là, et là seulement, un métal non couvert '
  + 'par une sonde devient terne et « mort ».</p>')
  + '<h3>Voir aussi</h3><ul>'
  + '<li>' + linkHelp('component-Reflection', 'La fiche Sonde de réflexion') + '</li>'
  + '<li>' + linkHelp('lighting', 'Lumières et ombres') + '</li>'
  + '<li>' + linkHelp('lightmaps', 'Cuire les lightmaps') + '</li>'
  + '<li>' + linkHelp('panel-environment', 'L\'environnement') + '</li>'
  + '</ul>';
}},

{id:'lightmaps', part:'workflows', section:'Rendu', title:'Cuire les lightmaps', level:'both',
 summary:'Précalculer l\'éclairage d\'un décor immobile dans des lightmaps.',
 anchors:[
   {f:'js/lightmap-bake.js', c:'const LIGHTMAP_RES = 1024'},
   {f:'js/lightmap-bake.js', c:'const LIGHTMAP_IMAGES = 240'},
   {f:'js/lightmap-bake.js', c:'const LIGHTMAP_BOUNCES = 1'},
   {f:'js/lightmap-bake.js', c:'const LIGHTMAP_SMOOTH = 0.35'},
   {f:'js/lightmap-bake.js', c:'area > 1.0001'},
   {f:'js/lightmap-bake.js', c:'const cote = Math.sqrt(areaWorld(m))'},
   {f:'js/lightmap-bake.js', c:'p[0].colorWrite = false'},
   {f:'js/lightmap-rgbm.js', c:'const RGBM_RANGE = 8'},
   {f:'js/materials.js', c:'function checkUvLightmap'}
 ],
 html:function(){ return ''
  + essentialHelp('<p>Une <b>lightmap</b> est une texture qui contient de l\'éclairage déjà calculé : ombres '
  + 'douces, lumière indirecte, occlusion. Le moteur la lit au lieu de refaire le calcul à '
  + 'chaque image : bien meilleure qualité, pour un coût de rendu presque nul. C\'est réservé à ce qui '
  + 'ne bouge pas, et cela exige des modèles avec un <b>second jeu d\'UV</b>.</p>')

  + '<h3>Cuire un décor</h3>'
  + stepsHelp([
      'Importez des modèles qui ont un second jeu d\'UV sans chevauchement (voir ci-dessous).',
      'Optionnel : sélectionnez les objets à cuire. Sans sélection, toute la scène est cuite.',
      '<b>Objet → 💡 Cuire les lightmaps…</b> ouvre la fenêtre de réglages ; elle annonce la portée et la mémoire nécessaire.',
      'Lancez la cuisson. La vue <b>se fige sur sa dernière image</b> et l\'avancement passe par la barre d\'état ; l\'onglet reste réactif.',
      'Lisez la console : un objet qui ne convient pas y est nommé, avec la raison.'
    ])

  + '<h3>Le second jeu d\'UV</h3>'
  + '<p>Une lightmap a besoin d\'un <b>dépliage</b> où chaque triangle a sa place, <b>sans aucun '
  + 'chevauchement</b>. Ce n\'est pas le jeu d\'UV des textures, qui se chevauche presque toujours '
  + 'pour répéter un motif.</p>'
  + '<p><b>L\'éditeur ne fabrique pas ce dépliage.</b> Exportez-le depuis le logiciel de '
  + 'modélisation — dans Blender, <i>UV → Lightmap Pack</i> ou <i>Smart UV Project</i> sur un '
  + 'second calque UV, qui ressort dans le <code>.glb</code> comme <code>uv1</code>. C\'est aussi '
  + 'ce que demande Unity ; aucun moteur temps réel ne déplie à votre place.</p>'
  + trapHelp('<b>Les primitives du moteur ne conviennent pas.</b> Un cube, une '
  + 'sphère, un cylindre n\'ont qu\'un seul jeu d\'UV, et un cube y empile ses six faces au même '
  + 'endroit. Cuit tel quel, il ressort d\'une seule teinte : une face a écrasé les cinq autres. '
  + 'La cuisson le <b>dit</b> dans la console.')
  + trapHelp('Comme pour les sondes, <b>rien n\'est automatique</b> : après avoir '
  + 'déplacé un mur ou changé une lampe, il faut recuire. Une lightmap périmée reste une image '
  + 'plausible, et c\'est ce qui la rend difficile à repérer. Voir '
  + linkHelp('probes', 'Reflets et sondes') + ', qui a exactement le même piège.')
  + trapHelp('Un <b>matériau partagé</b> entre un objet cuit et un objet non cuit '
  + 'est signalé, et il faut le traiter : la lightmap est une propriété de matériau, donc le '
  + 'second la recevrait sans avoir de place dans l\'atlas. Donnez-lui un matériau distinct, ou '
  + 'cuisez les deux ensemble.')

  + advancedHelp('Les réglages', arrayHelp(['Réglage', 'Par défaut', 'Ce que ça fait'], [
      ['Résolution de l\'atlas', defaultHelp('1024'),
       'Tous les objets cuits se partagent <b>une seule</b> texture. La place y est distribuée '
       + 'selon la <b>surface réelle</b> : un sol reçoit beaucoup plus de texels qu\'un boulon. '
       + 'C\'est le réglage qui coûte de la <b>mémoire</b>, et la fenêtre l\'affiche — deux '
       + 'cibles de rendu flottantes, soit 32 Mo en 1024 mais <b>512 Mo en 4096</b>.'],
      ['Images accumulées', defaultHelp('240'),
       'Le curseur qualité/temps. La moyenne converge en 1/√N : doubler le nombre d\'images ne '
       + 'divise le bruit que par 1,4. Montez-le si le résultat granule, pas par principe.'],
      ['Rebonds', defaultHelp('1'),
       'L\'éclairage indirect — la lumière qu\'une surface renvoie sur ses voisines. Chaque '
       + 'rebond coûte une passe complète, et le deuxième ne vaut presque plus rien : mesuré sur '
       + 'la scène de démarrage, il change l\'image d\'<b>un niveau sur 255</b>. À 0, seul '
       + 'l\'éclairage direct est cuit, ce qui va deux fois plus vite pour dégrossir.'],
      ['Douceur des ombres', defaultHelp('0.35'),
       'Secoue les lampes d\'une image à l\'autre, en unités monde. C\'est ce qui transforme des '
       + 'ombres dures moyennées en une <b>pénombre</b>. À 0, les bords sont nets.'],
      ['Hautes lumières (HDR)', defaultHelp('coché'),
       'Encode la texture en <b>RGBM</b> : trois canaux pour la couleur, le quatrième pour un '
       + 'multiplicateur commun. La portée passe de 1 à <b>64</b>, avec moins de 0,4 % d\'erreur '
       + 'jusqu\'à 63. Décoché, tout ce qui dépasse 1 s\'écrase sur un plateau uniforme et la '
       + 'nuance entre « lumineux » et « éblouissant » disparaît.'],
      ['Débruitage', defaultHelp('coché'),
       'Un filtre <b>bilatéral</b> : le poids d\'un voisin dépend de sa distance et de son écart '
       + 'de valeur, si bien qu\'un bord d\'ombre ne se fond pas dans la zone éclairée. Un flou '
       + 'ordinaire mangerait précisément ce qu\'on vient de cuire.']
    ]))
  + advancedHelp('Cuire une partie seulement', '<p>Seuls les objets sélectionnés occupent l\'atlas — donc y gagnent en résolution. '
  + 'Les autres <b>continuent de projeter leur ombre</b> sur ceux qu\'on cuit : ils ne sont pas retirés de '
  + 'la scène, seulement empêchés de peindre. Sans cela, cuire un sol seul lui aurait retiré '
  + 'l\'ombre de ses murs.</p>')
  + advancedHelp('Le contrôle des UV', '<p>La cuisson mesure '
  + 'l\'aire totale des triangles dans le plan UV, et une aire supérieure à 1 prouve qu\'ils ne '
  + 'peuvent pas tenir sans se recouvrir. Le contrôle est fiable dans ce sens-là et pas dans '
  + 'l\'autre : il ne crie jamais à tort, mais il ne voit pas tous les chevauchements.</p>')
  + advancedHelp('Ce que la cuisson produit', '<p>Une texture ajoutée au projet, branchée automatiquement sur l\'emplacement '
  + '<b>Lightmap</b> des matériaux concernés — donc présente dans le jeu publié sans manipulation '
  + '(voir ' + linkHelp('materials-reference', 'toutes les propriétés') + '). Recuire '
  + '<b>remplace</b> cette texture au lieu d\'en ajouter une ; une lightmap que vous avez '
  + 'importée, elle, n\'est jamais écrasée.</p>'
  + '<p>Le contenu est de l\'<b>irradiance</b> : la lumière reçue, sans la couleur de la surface, '
  + 'que le moteur multiplie par l\'albédo au rendu. Comme un texel ne porte qu\'une seule valeur et '
  + 'aucune direction, l\'éclairage cuit <b>ne réagit pas à la map de normales</b> — le relief '
  + 'de celle-ci reste éclairé par les lampes temps réel, pas par la lightmap.</p>'
  + '<p>Les <b>coutures</b> sont raccordées : quand un dépliage coupe le modèle, les deux bords '
  + 'd\'une même arête se retrouvent loin l\'un de l\'autre dans l\'atlas et reçoivent chacun son '
  + 'propre bruit. La cuisson les repère par la géométrie — une arête présente deux fois avec des '
  + 'UV différentes — et fait converger les deux côtés.</p>'
  + '<p>Pendant la cuisson, la scène est rendue en espace UV : c\'est pourquoi la vue reste figée.</p>')
  + '<h3>Voir aussi</h3><ul>'
  + '<li>' + linkHelp('lighting', 'Lumières et ombres') + '</li>'
  + '<li>' + linkHelp('probes', 'Reflets et sondes') + '</li>'
  + '<li>' + linkHelp('component-Light', 'La lumière') + '</li>'
  + '</ul>';
}},

{id:'animation', part:'workflows', section:'Animation', title:'La timeline : clés, os, caméra', level:'both',
 summary:'Animer un objet, un os ou la caméra à la timeline.',
 anchors:[
   {f:'js/animation.js', c:'const anim = {duration:5'},
   {f:'js/animation.js', c:'function trackOf(obj, os, create)'},
   {f:'js/track-sampling.js', c:"case 'palier': return a >= 1 ? 1 : 0;"},
   {f:'js/animation.js', c:'const aQuelqueChoseAPlay'},
   {f:'js/animation.js', c:'if(typeof updateClipShown === \'function\') updateClipShown(t);'},
   {f:'js/animation.js', c:'clipShown.folded = !clipShown.folded'},
   {f:'js/animation.js', c:'function clipAutoForSelection(obj)'},
   {f:'js/animation.js', c:'c.duration > 0.05'},
   {f:'js/skeleton.js', c:'function selectBone(os)'},
   {f:'js/anim-markers.js', c:'function markersCrossed(markers, avant, apres, duration, loop)'},
   {f:'js/anim-markers.js', c:'if(!inPlayback || typeof emit !== \'function\') return 0;'},
   {f:'js/anim-models.js', c:'function markersDuringPlayback(obj, action, tBefore)'},
   {f:'js/game-runtime.js', c:'function rtMarkersDuringPlayback(obj, action, tBefore)'},
   {f:'js/animation.js', c:'function clipDriven(obj, target)'},
   {f:'js/animation.js', c:'function poseOfClip(clip, name, t)'},
   {f:'js/animation.js', c:'function convertKeysOfTrack(p)'},
   {f:'js/game-runtime.js', c:'function rtAnimationInProgress(obj)'},
   {f:'js/anim-blend.js', c:'function boneAndDescendants(root, nameBone)'},
   {f:'js/anim-blend.js', c:'function clipExcept(clip, namesExclus, key)'},
   {f:'js/anim-blend.js', c:'function splitBone(root, layers)'},
   {f:'js/anim-models.js', c:'function layerAnimation(obj, nameClip, opts)'},
   {f:'js/game-runtime.js', c:'function rtLayerAnimation(obj, nameClip, opts)'}
 ],
 html:function(){ return ''
  + essentialHelp('<p>La fenêtre <b>Animation</b> (menu <b>Fenêtres</b>) est une timeline à <b>images clés</b> : '
  + 'une clé fige une pose à un instant, et le moteur interpole entre deux clés. Une piste vise un objet '
  + 'de la scène ou <b>un os</b> d\'un modèle rigué.</p>')

  + '<h3>Animer un objet</h3>'
  + stepsHelp([
      'Ouvrez <b>Fenêtres → Animation</b> et sélectionnez l\'objet.',
      'Placez la tête de lecture au début, mettez l\'objet dans sa pose, cliquez <b>🔑 Poser une clé</b>.',
      'Avancez la tête de lecture, changez la pose, posez une deuxième clé.',
      'Choisissez la <b>courbe</b> du segment (tableau ci-dessous).',
      'Appuyez sur <kbd>Espace</kbd> ou <b>▶</b> pour lire l\'animation dans la vue.'
    ])
  + tipHelp('Une clé reposée au même instant <b>remplace</b> la précédente au lieu de s\'empiler : '
  + 'corriger une pose, c\'est simplement reposer la clé.')

  + '<h3>Les courbes</h3>'
  + '<p>La courbe est portée par la clé de <b>départ</b> du segment : elle décrit la façon d\'en '
  + 'sortir, pas d\'y arriver.</p>'
  + arrayHelp(['Courbe', 'Effet'], [
      ['Linéaire', 'Vitesse constante. Le défaut.'],
      ['Accélère', 'Part lentement, finit vite.'],
      ['Décélère', 'Part vite, finit lentement.'],
      ['Douce', 'Lent aux deux bouts — le mouvement le plus naturel pour un objet.'],
      ['Palier', 'Aucune interpolation : la valeur saute à la clé suivante. Pour un clignotement '
       + 'ou un changement d\'état net.']
    ])
  + '<p>Ce sont cinq préréglages, pas des tangentes manipulables : un éditeur '
  + 'de courbes avec poignées n\'existe pas encore.</p>'

  + '<h3>Animer un os</h3>'
  + stepsHelp([
      'Sélectionnez le modèle, puis un <b>os</b> dans la section Squelette de l\'inspecteur — ou cliquez sa ligne dans la timeline.',
      'Le gizmo suit l\'os, surligné en bleu des deux côtés de la timeline. Posez la pose et la clé comme pour un objet : c\'est l\'os qui la reçoit, pas le modèle entier.'
    ])

  + '<h3>Animer une caméra</h3>'
  + '<p><b>🎥 Préréglages</b> pose d\'un coup les clés d\'un mouvement de caméra — orbite autour '
  + 'de la sélection, travelling, panoramique. Ce sont des clés ordinaires : on '
  + 'les déplace, on les supprime, on change leur courbe comme les autres.</p>'
  + trapHelp('<b>Une caméra ne regarde pas dans la direction qu\'on croit.</b> Les '
  + 'objets caméra du moteur portent une caméra fille tournée de 180°, si bien que leur axe de '
  + 'visée est <b>+Z</b> et non −Z. Un mouvement écrit à la main avec <code>lookAt</code> vise '
  + 'donc à l\'opposé.')

  + '<h3>Les marqueurs d\'événement</h3>'
  + '<p>Un son de pas au bon moment de la marche, des particules quand le pied touche le sol : un '
  + '<b>marqueur</b> émet, à son instant, <b>un événement nommé</b>. Un objet réglé sur '
  + '<i>« À la réception d\'un événement »</i> (' + linkHelp('visual-events', 'événements visuels') + ') '
  + 'fait alors le reste.</p>'
  + stepsHelp([
      'Placez la tête de lecture à l\'instant voulu.',
      'Cliquez <b>🔔 Marqueur</b> et nommez l\'événement. Il apparaît sur la piste 🔔 <b>Marqueurs</b>, sous l\'en-tête du clip.',
      'Cliquez une puce pour la renommer ; un nom vide la retire.'
    ])
  + trapHelp('<b>Déplacer la tête de lecture à la main ne déclenche rien</b>, et '
  + 'c\'est voulu : chercher une pose en glissant dans la timeline ferait crier tous les sons '
  + 'du clip d\'un coup. Les marqueurs ne se déclenchent qu\'en <b>lecture</b>.')

  + advancedHelp('Lecture dans la vue', '<p><kbd>Espace</kbd> ou <b>▶</b> lit les clés de la '
  + 'timeline, l\'animation importée du modèle sélectionné, et les scripts. S\'il n\'y a rien de '
  + 'tout cela, un message le dit et rien ne démarre. Le bouton <b>▶ Jouer dans la vue</b> de la section '
  + 'Animation de l\'inspecteur fait la même chose.</p>'
  + '<p>Chaque clé mémorise la pose <i>locale</i> — position, rotation, échelle — ce qui garde l\'animation '
  + 'juste même sous un parent qui bouge.</p>')

  + advancedHelp('Une animation importée dans la timeline', '<p>Sélectionner un modèle qui porte une animation l\'affiche <b>toute seule</b> dans la '
  + 'timeline : une bande d\'en-tête, puis une ligne par os animé, avec ses clés. Ces clés sont '
  + 'en <b>lecture seule</b> — elles appartiennent à l\'asset et sont partagées par tous les '
  + 'objets qui s\'en servent — mais la tête de lecture s\'y déplace, ce qui est la seule façon '
  + 'de choisir l\'instant où poser sa propre clé.</p>'
  + '<p>Un rig humanoïde anime une cinquantaine d\'os. L\'en-tête du clip se <b>replie</b> d\'un clic, et le '
  + 'champ <b>🔎 filtrer les os</b> ne garde que ceux dont le nom contient le texte tapé ; le compteur '
  + 'passe alors à « 32 / 52 os ».</p>'
  + '<p>Un clip de <b>durée nulle</b> n\'est jamais affiché. Tout export de '
  + 'T-pose en contient un — c\'est un artefact, pas une animation.</p>')

  + advancedHelp('Ajouter ou remplacer : une clé sur un clip', '<p>Une clé posée sur un os cohabite avec le clip de deux façons ; chaque piste '
  + 'affiche la sienne à droite de son nom — cliquez dessus pour changer.</p>'
  + arrayHelp(['Mode', 'Ce que la clé veut dire'], [
      ['<b>+ ajoute</b>', 'La clé porte un <b>écart</b>, composé par-dessus l\'animation : '
       + '« +30° de tête <i>sur</i> la marche ». La tête continue de suivre le clip, décalée de '
       + '30°, pendant toute l\'animation. C\'est le défaut quand un clip est affiché.'],
      ['<b>= remplace</b>', 'La clé impose sa pose : cet os quitte le clip et suit vos clés. '
       + 'C\'est le seul mode possible sans clip, et le défaut dans ce cas.']
    ])
  + '<p>Dans les deux cas, <b>seul l\'os clé est touché</b> : on retouche un bras sans réécrire la marche. '
  + 'Changer de mode <b>traduit les clés</b> : une pose devient un écart, et réciproquement.</p>'
  + '<p><b>Une piste « + » sans clip ne fait rien</b>, et la timeline le dit '
  + '(le « + » passe en rouge barré) : sans animation pour reposer la pose à chaque image, l\'écart '
  + 's\'accumulerait et l\'os dériverait jusqu\'à sortir de l\'écran.</p>')

  + advancedHelp('Les marqueurs appartiennent au clip', '<p>Le son de '
  + 'pas posé sur une marche se déclenche pour <i>tous</i> les personnages qui jouent cette '
  + 'marche — y compris ceux qui l\'ont reçue par ' + linkHelp('retargeting', 'reciblage') + '. '
  + 'C\'est aussi le modèle d\'Unreal, où les notifies vivent dans l\'animation.</p>')

  + advancedHelp('Deux animations à la fois, par os (couches)', '<p>Marcher en bas, viser en haut. Une <b>couche</b> joue un second clip sur un os et '
  + '<b>toute sa descendance</b> ; le clip de base garde tous les autres os. Cela se pilote '
  + 'depuis un ' + linkHelp('scripts', 'script') + ', parce que c\'est le jeu qui décide quand '
  + 'on vise.</p>'
  + '<pre><code>api.playAnimation(\'Marche\');\n'
  + 'api.layerAnimation(\'Visee\', { depuis: \'mixamorigSpine1\' });\n'
  + '// … et plus tard\n'
  + 'api.removeLayer(\'mixamorigSpine1\');</code></pre>'
  + '<p>Changer le clip de base <b>garde les couches</b> : on passe de « marcher » à « courir » '
  + 'sans cesser de viser. <code>api.stopAnimation()</code>, lui, emporte tout.</p>'
  + '<p><b>Aucun os n\'est joué deux fois</b> : deux animations de poids 1 sur le même os donneraient une '
  + '<i>moyenne</i>. La couche prend sa chaîne, la base est privée de ces os-là. Deux couches qui se '
  + 'recouvrent sont départagées par leur ordre, comme des calques : la dernière l\'emporte.</p>'
  + '<p>Si l\'os de départ n\'existe pas — rig réimporté, os renommé — la '
  + 'couche <b>ne joue rien</b> et le dit dans la console. Elle ne se rabat jamais sur le corps '
  + 'entier, ce qui écraserait la marche sans prévenir.</p>')
  + '<h3>Voir aussi</h3><ul>'
  + '<li>' + linkHelp('animator', 'Machines à états') + '</li>'
  + '<li>' + linkHelp('retargeting', 'Rigs et reciblage') + ' — poser l\'animation d\'un autre fichier</li>'
  + '<li>' + linkHelp('component-AnimatorController', 'La machine à états') + '</li>'
  + '</ul>';
}},

{id:'animator', part:'workflows', section:'Animation', title:'Machines à états (Animator)', level:'both',
 summary:'Enchaîner les animations d\'un personnage avec une machine à états.',
 anchors:[
   {f:'js/animator.js', c:'function transitionApplicable(machine, stateCurrent, params, progress)'},
   {f:'js/animator.js', c:'triggersOf(t).forEach(function(name){ player.params[name] = false; });'},
   {f:'js/animator.js', c:'function validateAnimator(machine, clipsConnus, animsConnues)'},
   {f:'js/animator.js', c:'const OPERATORS_BY_TYPE = {'},
   {f:'js/animator.js', c:'function timeOfOutput(t)'},
   {f:'js/animator.js', c:'function durationTransition(t, durationClipStart)'},
   {f:'js/animator.js', c:'function offsetTransition(t)'},
   {f:'js/animator-graph.js', c:'function openAnimatorOnAsset(asset)'},
   {f:'js/animator-graph.js', c:'function addParamGraph()'},
   {f:'js/animator-graph.js', c:'function toggleViewAnimator(toAnimator)'},
   {f:'js/animator-graph-geo.js', c:'function disposeStates(machine, widthDispo)'},
   {f:'js/components/component-animator.js', c:'class AnimatorController extends Component'},
   {f:'js/ui/panels-components.js', c:"['parametreAnim',   'Régler le paramètre d\\'animation…']"},
   {f:'js/anim-models.js', c:'function updateAnimators(dt)'},
   {f:'js/anim-models.js', c:'const previewAnimator = {active: false};'},
   {f:'js/animator-graph.js', c:'function drawParams(m)'},
   {f:'js/animator.js', c:'function moveRoot(read, avant, apres, duration, loop)'},
   {f:'js/anim-models.js', c:'function applyRootMotion(obj, target, parts)'},
   {f:'js/anim-models.js', c:"if(v === 'inPlace') return 'inPlace';"},
   {f:'js/anim-blend.js', c:'function clipInPlace(clip){'},
   {f:'js/animator.js', c:'function weightBlend(points, value)'},
   {f:'js/animator.js', c:'function speedsBlend(points, weight, durationOf)'},
   {f:'js/animator.js', c:'function readPointBlend(text)'},
   {f:'js/anim-models.js', c:'function applyBlendModel(obj, state, value)'},
   {f:'js/animator.js', c:'function coefficientsInertia(x0, v0, t1)'},
   {f:'js/animator.js', c:'function durationInertia(x0, v0, t1)'},
   {f:'js/anim-models.js', c:'function armInertia(e, target, duration)'},
   {f:'js/anim-models.js', c:'function surveyPoseShown(e, target, dt)'},
   {f:'js/anim-asset.js', c:'function resolveAnimAsset(asset, findAsset)'},
   {f:'js/anim-asset.js', c:'function dataClipAKeys(asset, slerp)'},
   {f:'js/anim-asset.js', c:'function nameTrackThree(track, property)'},
   {f:'js/animation.js', c:'function filePathRelativeClip(root, obj)'},
   {f:'js/animation.js', c:'function openClipAsset(asset)'},
   {f:'js/anim-models.js', c:'function clipOfKeys(asset)'},
   {f:'js/anim-asset.js', c:'function boundsAnimAsset(settings, duration)'},
   {f:'js/anim-asset.js', c:'function migrateStatesToAnimAssets(machine, ctx)'},
   {f:'js/anim-models.js', c:'function settingsAnimFor(target, holder)'},
   {f:'js/animator.js', c:'function createObjectAnimator(player, machine, warn)'}
 ],
 html:function(){ return ''
  + essentialHelp('<p>Une <b>machine à états</b> décide quelle animation joue, et quand passer à une autre : '
  + '« quand la vitesse dépasse 0,1, passer de Idle à Marche en 0,2 s ». C\'est de la '
  + '<b>donnée</b>, pas du code : elle se câble entièrement à la souris, dans la fenêtre <b>Animator</b>.</p>')

  + '<h3>Faire marcher un personnage</h3>'
  + stepsHelp([
      'Sélectionnez le personnage, ajoutez-lui le composant <b>AnimatorController</b>, puis <b>＋ Créer une machine…</b>.',
      'Ouvrez la fenêtre : bouton <b>🔀 Ouvrir l\'éditeur Animator</b> du composant, double-clic sur la machine (🔀) dans le panneau Projet, ou <b>Fenêtres ▸ Animator</b>.',
      '<b>＋ État</b> pour chaque animation (Idle, Marche…). Glissez une animation du panneau Projet sur la boîte de l\'état.',
      '<b>＋ Paramètre</b> : déclarez par exemple un flottant <code>vitesse</code>.',
      'Tirez la poignée <b>→</b> d\'un état vers un autre pour créer une transition, puis ajoutez-lui une condition dans l\'inspecteur : <code>vitesse &gt; 0,1</code>.',
      'Cliquez <b>▶ Aperçu</b>, poussez <code>vitesse</code> dans la bande de paramètres : l\'état joué s\'éclaire en vert.',
      'En jeu, réglez le paramètre depuis un script ou un événement « Quand… Alors… » (voir plus bas).'
    ])
  + tipHelp('Le composant <i>référence</i> la machine : dix personnages peuvent jouer la même. Il peut aussi vivre '
  + 'sur un <b>parent</b> du modèle : il descend tout seul jusqu\'au premier descendant qui porte des clips.')

  + '<h3>Le graphe</h3>'
  + arrayHelp(['Geste', 'Effet'], [
      ['Cliquer un état ou une transition', 'Le sélectionne — ses propriétés apparaissent dans l\'inspecteur.'],
      ['Glisser un état', 'Le déplace. Sa position est enregistrée avec la machine.'],
      ['Tirer la poignée <b>→</b> vers un autre état', 'Crée une transition.'],
      ['<b>＋ État</b>', 'Ajoute un état, à un endroit libre.'],
      ['<kbd>Suppr</kbd>', 'Retire l\'état ou la transition sélectionnés. Supprimer un état '
       + 'emporte les transitions qui le citaient.']
    ])
  + '<p>Le liseré doré marque l\'<b>état de départ</b>. Le fond vert marque l\'état <b>joué en '
  + 'ce moment</b> — le seul retour qui dise si la machine fait ce qu\'on croit. L\'onglet <b>Animator</b>, '
  + 'au-dessus de la vue, remplace la vue 3D par le graphe ; la hiérarchie reste à gauche et l\'inspecteur à droite.</p>'

  + '<h3>Les paramètres</h3>'
  + arrayHelp(['Type', 'À quoi ça sert'], [
      ['<b>flottant</b>', 'Une vitesse, une distance. Se compare avec &gt; et &lt;.'],
      ['<b>entier</b>', 'Un numéro d\'arme, un nombre de vies. Se compare aussi avec = et ≠.'],
      ['<b>booleen</b>', 'Au sol, accroupi. Vrai ou faux, et il le reste.'],
      ['<b>declencheur</b>', 'Sauter, frapper. Vrai une seule fois, puis <b>désarmé '
       + 'automatiquement</b> par la transition qui s\'en sert.']
    ])
  + '<p>Dans l\'inspecteur d\'une transition, une <b>ligne par condition</b> : '
  + 'paramètre, opérateur, valeur. <b>Toutes</b> doivent être vraies pour que la transition '
  + 'parte ; sans aucune, elle part dès que possible. Seuls les paramètres déclarés et les opérateurs de leur type sont proposés.</p>'
  + trapHelp('<b>Sans « Fin du clip », un saut ne se voit jamais.</b> Une '
  + 'transition qui quitte un état rend la main à la première image si rien ne la retient. '
  + 'Cochez <b>Fin du clip</b> sur la transition de sortie d\'une animation qui doit se jouer '
  + 'en entier — saut, coup, porte qui s\'ouvre. Un enchaînement d\'attaques, lui, veut un '
  + '<b>instant de sortie</b> aux alentours de 0,7.')

  + '<h3>Régler un paramètre en jeu</h3>'
  + '<p><b>Sans code</b> : dans le composant ' + linkHelp('visual-events', 'Événements') + ' d\'un objet, '
  + 'l\'action <b>Régler le paramètre d\'animation…</b> :</p>'
  + arrayHelp(['Dans le champ', 'Effet'], [
      ['<code>vitesse = 1</code>', 'Pose la valeur.'],
      ['<code>assis = vrai</code>', 'Un booléen.'],
      ['<code>saute</code>', 'Arme un déclencheur.']
    ])
  + '<p><b>En script</b> : <code>api.animator()</code> rend la machine de l\'objet — l\'équivalent du composant '
  + '<code>Animator</code> d\'Unity.</p>'
  + '<pre><code>// le corps du script tourne à chaque image\n'
  + 'const an = api.animator();\n'
  + 'if(an){\n'
  + '  const v = api.velocity();\n'
  + '  an.setFloat(\'vitesse\', v ? Math.hypot(v.x, v.z) : 0);\n'
  + '  if(api.action(\'sauter\')) an.setTrigger(\'saute\');\n'
  + '}</code></pre>'
  + '<p>En lecture : <code>an.state</code> donne le nom de l\'état joué, <code>an.get(name)</code> '
  + 'la valeur d\'un paramètre, <code>an.restart()</code> repart de l\'état de départ.</p>'
  + trapHelp('Un nom de paramètre inconnu <b>ne fait rien et le dit</b> dans la console, en le nommant — '
  + 'c\'est la faute la plus fréquente. Cherchez d\'abord là avant de soupçonner les transitions.')

  + '<h3>Quand ça ne marche pas</h3>'
  + '<p>Une machine fausse <b>ne lève aucune erreur</b> : le personnage reste figé. L\'inspecteur affiche donc les problèmes <b>en rouge</b>, en '
  + 'nommant ce qu\'il faut corriger — état sans clip, clip absent du modèle, transition vers '
  + 'un état qui n\'existe pas, condition sur un paramètre non déclaré, et <b>état sans '
  + 'transition sortante</b>, la première cause de « ça reste bloqué ».</p>'

  + advancedHelp('Les animations, en assets', '<p>Un état ne joue pas un clip « par son nom » : il joue un <b>asset d\'animation</b> '
  + '(🎞), créé par <b>＋ Créer ▸ 🎞 Animation</b> dans le panneau Projet. Cet asset désigne un '
  + 'clip, et il y a <b>deux sortes de clips</b>, comme dans Unity :</p>'
  + arrayHelp(['Source', 'Ce que c\'est'], [
      ['<b>Clés posées dans l\'éditeur</b>', 'Un clip <b>vide</b> qu\'on remplit soi-même à la '
       + 'timeline — le « Create New Clip » d\'Unity. On anime une porte, une plateforme, une caméra, un personnage.'],
      ['<b>Clip d\'un modèle importé</b>', 'Un <b>sous-asset</b> du .glb / .fbx : il se règle '
       + 'dans l\'onglet Animation du fichier (voir ' + linkHelp('import-model', 'Importer un modèle')
       + ') et se glisse depuis la tuile dépliée. Réimporter le modèle met tout à jour.']
    ])
  + arrayHelp(['Réglage', 'Ce qu\'il fait'], [
      ['<b>Modèle</b> + <b>Clip</b>', 'D\'où vient l\'animation. L\'asset <i>référence</i> le '
       + 'clip du fichier, il ne le recopie pas.'],
      ['<b>Vitesse</b>', 'Multiplicateur de lecture. Une même marche sert de marche lente et '
       + 'de course, en deux assets.'],
      ['<b>Boucle</b>', 'Décochée, le clip s\'arrête sur sa dernière image — ce qu\'attend une '
       + 'transition <b>Fin du clip</b>.'],
      ['<b>Début</b> / <b>Fin</b>', 'Découpe, en secondes du clip source. Une découpe vide ou '
       + 'inversée rend le clip entier plutôt que rien.']
    ])
  + '<p>Les <b>marqueurs</b> appartiennent au clip, pas à l\'animation : un '
  + 'marqueur situé hors de la découpe n\'est jamais émis — l\'inspecteur de l\'animation le '
  + 'signale.</p>'
  + '<p>Les machines écrites avant la v0.52 désignaient leur clip par son '
  + 'nom. Elles sont <b>migrées automatiquement</b> à l\'ouverture de leur scène. Une machine '
  + 'partagée par <b>deux modèles différents</b> ne peut pas l\'être : elle continue de jouer, et la liste d\'erreurs demande de choisir '
  + 'l\'animation à la main.</p>')

  + advancedHelp('Poser des clés dans un clip', '<p>Sélectionnez l\'objet qui sert de <b>racine</b> — celui qui portera l\'Animator — puis, '
  + 'dans l\'inspecteur de l\'animation, <b>🎬 Ouvrir dans la timeline</b>. La timeline édite '
  + 'alors le clip au lieu de l\'animation de scène ; l\'animation de scène revient dès qu\'on referme le clip.</p>'
  + '<p>Les pistes d\'un clip sont enregistrées en <b>chemin relatif</b> à la '
  + 'racine (le <code>relativePath</code> d\'Unity), et non par identifiant d\'objet : posé sur un autre objet '
  + 'de même forme, le clip l\'anime. En contrepartie, un objet qui n\'est pas sous la racine est refusé, et l\'éditeur le dit.</p>')

  + advancedHelp('Les réglages d\'une transition', arrayHelp(['Réglage', 'Ce qu\'il fait'], [
      ['<b>Fin du clip</b>', 'Le <i>Has Exit Time</i> d\'Unity : n\'emprunter cette transition '
       + 'qu\'une fois une part du clip jouée.'],
      ['<b>Instant de sortie</b>', 'Cette part, en <b>fraction</b> du clip : 0,75 = aux trois '
       + 'quarts. Au-delà de 1, on attend plusieurs tours de boucle.'],
      ['<b>Durée fixe</b>', 'Le <i>Fixed Duration</i>. Cochée : le fondu est en <b>secondes</b>. '
       + 'Décochée : en fraction de la durée du clip de départ.'],
      ['<b>Fondu</b>', 'La durée du recouvrement entre les deux animations.'],
      ['<b>Décalage d\'arrivée</b>', 'Le <i>Transition Offset</i> : le clip d\'arrivée démarre à '
       + 'cette fraction de sa durée au lieu de sa première image.'],
      ['<b>Inertie</b>', 'Propre à cet éditeur : au lieu de mélanger les deux animations, '
       + 'démarrer la nouvelle seule et résorber l\'écart avec la pose en cours.'],
      ['<b>Interruption</b>', 'Enregistrée, <b>pas encore appliquée</b> : notre machine ne prend '
       + 'qu\'une transition par image et ne coupe pas un fondu en cours.']
    ])
  + '<p><b>Une transition « depuis partout » ne boucle jamais sur l\'état '
  + 'où l\'on est déjà.</b> Sinon elle relancerait son clip à chaque image tant que le '
  + 'déclencheur est armé.</p>'
  + '<p>Retirer un paramètre retire aussi les conditions qui le testaient — '
  + 'l\'éditeur demande confirmation.</p>')

  + advancedHelp('L\'aperçu', '<p><b>▶ Aperçu</b> est <b>éteint par défaut</b> : tant qu\'il tourne, '
  + 'la machine pilote le personnage et vous ne pouvez plus lui poser de clé à la main. Même '
  + 'partage qu\'Unity, dont l\'Animator ne tourne qu\'en mode Jeu. En éteignant l\'aperçu, le personnage '
  + '<b>reprend sa pose de repos</b>.</p>')

  + advancedHelp('Inertie — enchaîner sans montrer de pose inventée', '<p>Un <b>fondu</b> fait jouer les deux animations à la fois et affiche leur moyenne : '
  + 'à mi-chemin entre marcher et frapper, les pieds glissent. Avec <b>Inertie</b> cochée, la nouvelle animation démarre <b>seule '
  + 'et à plein régime</b>, et c\'est l\'<i>écart</i> avec la pose en cours qui s\'efface — en '
  + 'repartant de la vitesse qu\'avaient les membres. Le champ voisin devient <b>Résorption</b> : '
  + 'le temps que met cet écart à disparaître.</p>'
  + '<p><b>Ce que ça change, mesuré.</b> Sur un enchaînement entre deux '
  + 'marches opposées, au pire moment du cycle : une coupure nette fait sauter la vitesse d\'une '
  + 'cuisse à <b>17,5 fois</b> sa variation habituelle. Un fondu ramène ça à <b>2,1</b>, '
  + 'l\'inertie à <b>2,5</b>. Mais au milieu du raccord, la '
  + 'pose affichée par le fondu est à <b>40 %</b> du chemin entre les deux animations, contre '
  + '<b>11 %</b> pour l\'inertie : l\'inertie montre presque toujours une vraie pose.</p>'
  + '<p><b>L\'inertie ne remplace pas le fondu partout.</b> Sur un '
  + 'enchaînement lent et voulu — un personnage qui s\'assied — le mélange des deux poses <i>est</i> '
  + 'ce qu\'on veut voir. L\'inertie sert aux réactions vives : coup, esquive, changement de direction.</p>')

  + advancedHelp('Mélange — doser plusieurs clips avec un seul paramètre', '<p>Cochez <b>Mélange</b> sur un état. Il ne joue plus <i>un</i> clip mais une liste, une '
  + 'ligne par clip, avec la valeur du paramètre à laquelle ce clip joue <b>seul</b> :</p>'
  + '<pre><code>idle = 0\nmarche = 2\ncourse = 6</code></pre>'
  + '<p>À <code>vitesse = 3</code>, marche et course jouent ensemble — trois quarts / un quart. '
  + 'En dessous de 0 ou au-dessus de 6, le clip le plus proche joue seul : rien n\'est '
  + '<i>extrapolé</i>.</p>'
  + '<p><b>Les pas restent alignés.</b> Chaque clip est lu à la '
  + 'vitesse qui le fait <b>boucler en même temps que les autres</b>, et la cadence du cycle '
  + 'suit les poids.</p>'
  + '<p><b>Un mélange a besoin d\'un paramètre chiffré</b> : un booléen ou un '
  + 'déclencheur n\'a pas de valeur intermédiaire. Si le '
  + 'paramètre cité n\'existe pas, l\'état reste bloqué sur son premier clip — le panneau '
  + 'd\'erreurs de l\'Animator le dit.</p>')

  + advancedHelp('Root motion — qui fait avancer le personnage', '<p>Beaucoup de clips tout faits (tout Mixamo) contiennent leur <b>propre déplacement</b> : '
  + 'la marche fait réellement parcourir 1,85 m au bassin. Le réglage <b>Root motion</b> de '
  + 'l\'AnimatorController dit ce qu\'on en fait.</p>'
  + arrayHelp(['Réglage', 'Ce qui arrive au déplacement du clip'], [
      ['<b>Aucun</b>', 'Rien : il reste sur le bassin. Correct <b>seulement</b> pour des clips '
        + 'filmés sur place. Avec un clip qui avance, le modèle <b>s\'éloigne de son pivot</b> — '
        + 'il sort de sa propre boîte de collision et rien ne le signale.'],
      ['<b>Déplace l\'objet</b>', 'Il est retiré du bassin et reporté sur l\'objet : c\'est '
        + 'l\'animation qui conduit. Le pas colle au sol, et en échange <b>la vitesse est celle '
        + 'du clip</b>.'],
      ['<b>Sur place</b>', 'Il est retiré des <b>clés du clip</b> avant qu\'il soit joué : '
        + 'c\'est un script ou un corps physique qui pose la vitesse. C\'est le '
        + 'réglage d\'un personnage piloté (<code>api.moveCharacter</code>) dont les clips '
        + 'avancent.']
    ])
  + '<p><b>Ne choisissez « Déplace l\'objet » que si rien d\'autre ne déplace '
  + 'ce personnage</b> — ni corps physique, ni script : deux écritures se disputeraient sa '
  + 'position. Seul le déplacement <b>horizontal</b> est reporté ; le balancement '
  + 'vertical du bassin reste dans l\'animation.</p>')
  + '<h3>Voir aussi</h3><ul>'
  + '<li>' + linkHelp('animation', 'La timeline') + ' — et les couches par os, pour deux animations à la fois</li>'
  + '<li>' + linkHelp('component-AnimatorController', 'La machine à états') + '</li>'
  + '<li>' + linkHelp('component-SpriteAnimator', 'L\'animation de sprite') + '</li>'
  + '<li>' + linkHelp('tuto-mixamo', 'Tutoriel : un personnage Mixamo animé') + '</li>'
  + '</ul>';
}},

{id:'retargeting', part:'workflows', section:'Animation', title:'Rigs et reciblage (Mixamo)', level:'both',
 summary:'Faire jouer à un personnage une animation venue d\'un autre fichier (Mixamo, Rigify…).',
 anchors:[
   {f:'js/retargeting.js', c:'function compatibilityClipRig(clip, target)'},
   {f:'js/retargeting.js', c:'function factorScaleRigs(indexSource, indexTarget)'},
   {f:'js/retargeting.js', c:'qKey.premultiply(qSrc).premultiply(qCib)'},
   {f:'js/retargeting.js', c:'const PREFIXES_RIG'},
   {f:'js/retargeting.js', c:'function reattachAnimationsExternal(obj, refs, assetById)'},
   {f:'js/anim-models.js', c:'function animationsExternalFor(o)'},
   {f:'js/anim-models.js', c:'function externalClipsOf(o)'},
   {f:'js/skeleton.js', c:'function conventionOfNaming(sq)'}
 ],
 html:function(){ return ''
  + essentialHelp('<p>Le geste courant : un personnage téléchargé d\'un côté, une marche de l\'autre. Les deux fichiers '
  + 'portent chacun leur squelette ; poser l\'animation du second sur le rig du premier s\'appelle le <b>' + termHelp('Reciblage')
  + '</b>. Les os se reconnaissent par leur <b>nom</b>, et l\'éditeur affiche un <b>taux de compatibilité</b>.</p>')

  + '<h3>Faire marcher un personnage avec l\'animation d\'un autre fichier</h3>'
  + stepsHelp([
      'Importez les deux fichiers dans le panneau Projet.',
      'Posez le personnage dans la scène et sélectionnez-le.',
      'Dans la section <b>Animation</b> de l\'inspecteur, sous <i>Animations d\'autres fichiers</i>, choisissez un clip : '
      + 'la liste ne montre que ceux que ce rig sait recevoir, avec leur taux.',
      'Un clic pose l\'animation, l\'affiche dans la timeline et la rend jouable. Le <b>✕</b> sur la ligne du clip la détache.'
    ])
  + tipHelp('<b>100 %</b> : le transfert est exact. En dessous, les os manquants <b>restent immobiles</b> — l\'infobulle les '
  + 'nomme. Un rig cible peut avoir des os <b>en plus</b> sans que cela gêne : un export Mixamo anime '
  + '52 os sur les 65 d\'un personnage, les bouts de doigts et le sommet du crâne ne bougeant jamais.')
  + trapHelp('<b>Ne supprimez pas le fichier d\'animation du projet.</b> Il n\'est '
  + 'pas recopié dans le personnage : le retirer des assets fait revenir la scène sans '
  + 'l\'animation, silencieusement.')

  + advancedHelp('Les noms d\'os', '<p>Les préfixes de rig et les séparateurs sont '
  + 'ignorés : <code>mixamorig:Hips</code>, <code>mixamorigHips</code> et <code>Hips</code> '
  + 'désignent le même os. Un clip Mixamo pilote donc un rig renommé, du moment que les os '
  + 'gardent leurs noms usuels. L\'inspecteur affiche <i>Nommage : Mixamo</i> quand il reconnaît '
  + 'la convention. (Mixamo écrit <code>mixamorig:Hips</code> ; le chargeur '
  + 'FBX assainit les noms et rend <code>mixamorigHips</code>.)</p>')

  + advancedHelp('Les deux corrections invisibles', '<p>Même quand les noms coïncident parfaitement, recopier les clés telles quelles ne suffit '
  + 'pas. Deux écarts subsistent, et le moteur les corrige.</p>'
  + arrayHelp(['Écart', 'Ce qui se passerait sans correction'], [
      ['<b>La taille.</b> La translation de bassin est mise à l\'échelle du rapport des deux '
       + 'rigs, mesuré sur la chaîne de jambe au repos.',
       'Un personnage deux fois plus grand que le rig d\'origine s\'enfoncerait dans le sol de '
       + 'la moitié de sa taille — <b>en marchant normalement</b>.'],
      ['<b>La pose de repos.</b> On reporte le <i>mouvement</i> par rapport au repos de la '
       + 'source, pas la rotation absolue.',
       'Une épaule au repos à 45° qui recopie un geste de 30° finirait <b>15° en deçà</b> de sa '
       + 'propre position de repos : les bras rentrent dans le torse.']
    ])
  + '<p>Ces deux corrections sont l\'identité quand les deux fichiers viennent '
  + 'du même personnage ; elles sont éprouvées séparément, sur des rigs qui diffèrent.</p>')

  + advancedHelp('Ce qui est enregistré', '<p>La scène retient la <b>provenance</b> — quel asset, quel clip, sous quel nom — et non les '
  + 'clés. Le reciblage est refait au chargement à partir des mêmes fichiers, dans l\'éditeur '
  + '<b>comme dans le jeu publié</b> : le fichier de projet ne grossit pas d\'une animation dupliquée.</p>'
  + '<p>Le clip posé est renommé <code>Fichier · clip</code> — deux exports Mixamo s\'appellent '
  + 'tous les deux <i>mixamo.com</i>, et sans cela une recherche par nom tomberait sur le mauvais.</p>')

  + advancedHelp('Ce que ce reciblage ne fait pas', '<p>Il traite deux rigs qui <b>partagent une convention de nommage</b> — Mixamo, Rigify, la '
  + 'plupart des bibliothèques. Deux squelettes réellement étrangers, avec un nombre d\'os et une '
  + 'hiérarchie différents, demandent une correspondance explicite chaîne par chaîne '
  + '(ce qu\'Unreal appelle un IK Rig) : ce n\'est pas là. Un rig étranger tombe à quelques pour cent, ou n\'est pas proposé du '
  + 'tout.</p>'
  + '<p>Une animation reçue par reciblage se retouche comme les autres : une clé posée sur un os '
  + 'peut <b>s\'ajouter</b> au clip ou le <b>remplacer</b>. Voir ' + linkHelp('animation', 'la timeline') + '.</p>')
  + '<h3>Voir aussi</h3><ul>'
  + '<li>' + linkHelp('tuto-mixamo', 'Tutoriel : un personnage Mixamo animé') + '</li>'
  + '<li>' + linkHelp('import-model', 'Importer un modèle') + '</li>'
  + '<li>' + linkHelp('animator', 'Machines à états') + '</li>'
  + '<li>' + linkHelp('component-SkinnedMeshRenderer', 'Le maillage skinné') + '</li>'
  + '</ul>';
}},

{id:'physics', part:'workflows', section:'Physique', title:'Physique et colliders', level:'both',
 summary:'Donner une masse aux objets, faire des sols et des murs, et les faire se heurter.',
 anchors:[
   {f:'js/physics.js', c:'phys.world.gravity.set(0, -9.82, 0);'},
   {f:'js/physics.js', c:'AUCUN sol implicite'},
   {f:'js/component-data.js', c:'{active:false, masse:1, bounce:0.3, friction:0.4}'},
   {f:'js/physics.js', c:"Registry.activeNodes('Terrain')"},
   {f:'js/physics.js', c:'les objets ANIMÉS deviennent des obstacles mobiles'},
   {f:'js/rigid-body.js', c:'// boîte englobante (cylindre, cône, tore, modèles importés)'},
   {f:'js/component-data.js', c:"{shape:'auto', dims:[1,1,1], radius:1, height:2, offset:[0,0,0], trigger:false}"},
   {f:'js/components/component-physics.js', c:'phys.world.step(1 / 60, Math.min(dt, 0.05), 3);'}
 ],
 html:function(){ return ''
  + essentialHelp('<p>Rien n\'est solide tant qu\'on ne l\'a pas demandé : un objet ne participe à la physique que si '
  + 'son composant <b>Physique</b> est coché. Avec une <b>masse</b>, il tombe et se fait pousser ; avec une '
  + '<b>masse de 0</b>, il devient un sol ou un mur immobile. Le composant <b>Collider</b> précise sa forme.</p>')

  + '<h3>Faire tomber un objet sur un sol</h3>'
  + stepsHelp([
      'Créez un cube aplati pour le sol. Ajoutez-lui le composant <b>Physique</b>, cochez-le, mettez la <b>Masse à 0</b>.',
      'Créez une sphère au-dessus. Ajoutez-lui <b>Physique</b>, cochée, masse 1.',
      'Optionnel : ajoutez un <b>Collider</b> pour choisir la forme. Un collider explicite se dessine <b>en fil de fer vert</b> quand l\'objet est sélectionné.',
      'Cliquez <b>⚙ Physique</b> pour simuler dans la vue, ou <b>▶ Jouer</b>.'
    ])
  + trapHelp('<b>Il n\'y a AUCUN sol par défaut.</b> Une scène vide est vraiment '
  + 'vide : un objet lâché en l\'air tombe indéfiniment. La grille de sol n\'est '
  + 'qu\'un repère d\'édition : elle n\'arrête rien et n\'existe pas dans le jeu publié.')
  + trapHelp('<b>Un cube posé comme un mur n\'arrête rien.</b> Sans composant '
  + 'Physique coché, il est purement décoratif et les objets le traversent. Pour un obstacle '
  + 'immobile, il faut cocher Physique <b>et mettre la masse à 0</b> — une masse nulle rend le '
  + 'corps statique. ' + linkHelp('analysis', 'L\'analyseur') + ' signale « corps rigide '
  + 'de masse nulle (il restera figé en l\'air) » : utile pour un objet '
  + 'qu\'on croyait mobile, parfaitement normal pour une plateforme.')
  + tipHelp('Deux exceptions n\'ont rien à cocher : <b>les terrains</b>, toujours des sols statiques qui suivent le relief sculpté '
  + '(' + linkHelp('terrain', 'voir Terrain') + '), et <b>les objets animés</b> sur la timeline, qui deviennent des obstacles mobiles '
  + '— c\'est ce qui fait marcher une plateforme mouvante ou une porte.')

  + '<h3>Le composant Physique</h3>'
  + arrayHelp(['Champ', 'Par défaut', 'Plage', 'Ce que ça fait'], [
      ['Masse', defaultHelp('1'), '0 à 1000', '<b>0 = statique.</b> Sinon, l\'objet tombe et se fait pousser.'],
      ['Rebond', defaultHelp('0,3'), '0 à 1', 'La restitution — mais voir le piège ci-dessous.'],
      ['Friction', defaultHelp('0,4'), '0 à 1', 'Le frottement — même piège.']
    ])
  + trapHelp('<b>Rebond et Friction ne valent que contre un terrain.</b> Contre un <b>autre objet</b>, le moteur retombe sur ses '
  + 'valeurs par défaut : une balle réglée à Rebond 1 <b>ne rebondit pas du tout</b> sur un '
  + 'cube. Aucune erreur, aucun avertissement — juste une balle qui a l\'air lourde.')

  + '<h3>Le composant Collider</h3>'
  + arrayHelp(['Champ', 'Par défaut', 'Ce que ça fait'], [
      ['Forme', defaultHelp('Auto'), '<code>Auto</code>, <code>Boîte</code>, <code>Sphère</code>, '
        + '<code>Cylindre</code>. Il n\'y a pas de capsule.'],
      ['Taille', defaultHelp('1 · 1 · 1'), 'Boîte seulement.'],
      ['Rayon', defaultHelp('1'), 'Sphère et cylindre.'],
      ['Hauteur', defaultHelp('2'), 'Cylindre seulement.'],
      ['Décalage', defaultHelp('0 · 0 · 0'), 'Déplace le collider par rapport à l\'objet.'],
      ['Déclencheur', defaultHelp('décoché'), 'Détecté mais ne bloque pas : une zone qui déclenche un ' + linkHelp('visual-events', 'événement') + '.']
    ])
  + trapHelp('<b>« Auto » ne garde aucune forme concave, et rien ne le dit.</b> Seuls la sphère et le cube du moteur '
  + 'reçoivent une forme exacte ; tout le reste — cylindre, cône, tore, plan, modèles importés — reçoit <b>la boîte englobante</b>. '
  + 'Un tore devient une boîte pleine, un personnage importé une caisse, et un objet qui a des enfants reçoit UNE boîte '
  + 'qui enferme tout le sous-arbre. Comme Auto est aussi <b>le seul mode qui ne se dessine pas en vert</b>, passez la forme à '
  + '<b>Boîte</b> pour voir ce que la physique voit réellement.')

  + advancedHelp('Gravité, pas de simulation et scripts', '<p>La physique est celle de cannon.js. La gravité vaut <b>−9,82 m/s²</b> sur Y et '
  + '<b>n\'est pas réglable</b> : il n\'y a pas de champ pour la changer.</p>'
  + '<p>Pas fixe de <b>1/60 s</b>, jusqu\'à 3 sous-pas par image, avec l\'image plafonnée à '
  + '50 ms dans l\'éditeur : une image très lente ne fait pas traverser les murs, elle ralentit '
  + 'le temps. Les scripts s\'exécutent <b>avant</b> le pas physique, pour que '
  + '<code>api.applyForce</code> soit intégré dans la même image.</p>'
  + '<p>L\'infobulle du bouton <b>⚙ Physique</b> annonce « sans animations ni '
  + 'scripts ». La première moitié est vraie, la seconde non : <b>les scripts tournent</b> '
  + 'pendant la simulation physique — ce qui rend le bouton utile pour mettre '
  + 'au point un contrôleur de personnage.</p>')
  + advancedHelp('Le collider est figé au démarrage', '<p>Il est construit une fois, au démarrage de la '
  + 'simulation. Changer l\'échelle d\'un objet pendant que ça tourne — ou depuis un script '
  + '— fait grandir le maillage et pas le collider. Sur une sphère, une échelle non uniforme '
  + 'est pire encore : le rayon retenu est le plus GRAND des trois axes, si bien qu\'une sphère '
  + 'aplatie flotte au-dessus du sol.</p>'
  + '<p>Rebond et Friction sont enregistrés comme un couple de contact entre l\'objet et le matériau « ground », '
  + 'que seuls les terrains portent : c\'est la raison du piège plus haut.</p>')
  + '<h3>Voir aussi</h3><ul>'
  + '<li>' + linkHelp('component-Physics', 'La fiche Physique') + '</li>'
  + '<li>' + linkHelp('component-Collider', 'La fiche Collider') + '</li>'
  + '<li>' + linkHelp('collisions-2d', 'Collisions 2D') + ' — un solveur entièrement séparé</li>'
  + '<li>' + linkHelp('visual-events', 'Événements visuels') + '</li>'
  + '</ul>';
}},

{id:'particles', part:'workflows', section:'Monde', title:'Particules', level:'both',
 summary:'Fumée, étincelles, pluie : régler un émetteur de particules.',
 anchors:[
   {f:'js/particles.js', c:'const max = Math.max(1, Math.min(5000, cfg.max | 0 || 300));'},
   {f:'js/particles.js', c:'sys.accu += (cfg.rate || 25) * dt;'},
   {f:'js/particles.js', c:'// aperçu éditeur : burst répété'},
   {f:'js/particles.js', c:'_pPos.applyMatrix4(sys.obj.matrixWorld);'},
   {f:'js/component-data.js', c:"shape: 'cone'"},
   {f:'js/component-data.js', c:'vie: 1.3'}
 ],
 html:function(){ return ''
  + essentialHelp('<p>Un <b>émetteur de particules</b> est un objet de scène, porté par le composant '
  + '<code>Particles</code>. Il tourne aussi bien dans l\'éditeur que dans le jeu : inutile de lancer '
  + 'la lecture pour voir ce qu\'on règle.</p>')

  + '<h3>Créer un effet</h3>'
  + stepsHelp([
      'Menu <b>Objet</b> → <b>✨ Émetteur de particules</b>, puis placez-le.',
      'Choisissez la <b>Forme</b> d\'émission et le <b>Mode</b> : <b>continu</b> (fumée, pluie) ou <b>burst</b> (explosion).',
      'Réglez débit ou quantité, durée de vie, vitesse, gravité (négative pour retomber).',
      'Ajustez la taille <b>à l\'œil</b>, à la distance où le joueur verra l\'effet.'
    ])

  + '<h3>Les réglages qui comptent</h3>'
  + arrayHelp(['Champ', 'Par défaut', 'Ce qu\'il faut savoir'], [
      ['Forme', defaultHelp('cône'),
       '<code>point</code>, <code>boîte</code>, <code>sphère</code>, <code>cône</code>. Chaque '
       + 'forme n\'utilise que ses propres champs : la boîte ignore rayon et angle, et émet '
       + 'droit vers le haut.'],
      ['Mode', defaultHelp('continu'),
       '<b>continu</b> lit le Débit ; <b>burst</b> lit la Quantité. Le champ inutilisé est '
       + 'ignoré en silence.'],
      ['Débit /s', defaultHelp('25'), 'Continu seulement.'],
      ['Quantité', defaultHelp('40'), 'Burst seulement.'],
      ['Durée de vie', defaultHelp('1,3 s'), 'Tirée au hasard à ±25 % pour chaque particule.'],
      ['Vitesse', defaultHelp('2,5'), 'En m/s, également tirée à ±25 %.'],
      ['Gravité', defaultHelp('0'),
       'En m/s² sur Y monde, négatif pour retomber. Sans rapport avec la gravité de la '
       + linkHelp('physics', 'physique') + '.'],
      ['Taille début / fin', defaultHelp('0,3') + ' / ' + defaultHelp('0,06'),
       '<b>Ce ne sont pas des mètres</b> — voir le piège ci-dessous.'],
      ['Max particules', defaultHelp('300'),
       'Plafond de CET émetteur, borné à 5000. Les émissions au-delà sont abandonnées sans '
       + 'message.']
    ])

  + trapHelp('<b>Mettre le Débit à 0 n\'arrête pas l\'émetteur : il repart à '
  + '25/s.</b> Le moteur lit une valeur nulle comme « non renseignée » '
  + 'et retombe sur sa valeur par défaut. Le même piège touche <b>Rayon</b> (0 → 0,4) et '
  + '<b>Angle</b> (0 → 20°). Pour éteindre un émetteur, <b>décochez le composant</b> — ou, '
  + 'depuis un script, <code>api.particles(objet).activer(false)</code>.')
  + trapHelp('<b>Un burst qui boucle dans la vue part une seule fois en jeu.</b> L\'aperçu de l\'éditeur '
  + '<b>répète</b> le tir pour qu\'on puisse le régler. En jeu, il part au début, puis c\'est <code>api.particles(objet)'
  + '.emettre()</code> qui le redéclenche, ou l\'action d\'événement <b>Émettre des particules…</b>.')

  + advancedHelp('Taille et déplacement de l\'émetteur', '<p><b>La taille des particules est un nombre d\'écran, pas une longueur '
  + 'du monde.</b> Elle est divisée par la distance à la caméra : une particule de « taille » '
  + '0,3 n\'a aucun rapport avec un objet de 0,3 m, et son diamètre apparent ne suit pas '
  + 'l\'échelle de l\'émetteur.</p>'
  + '<p><b>Les particules ne suivent pas l\'émetteur.</b> Elles naissent à sa '
  + 'position puis vivent dans le monde. Déplacer l\'émetteur laisse une traînée derrière lui, '
  + 'au lieu d\'emporter le nuage — souvent ce qu\'on veut pour un réacteur, jamais pour une '
  + 'aura.</p>')
  + '<h3>Voir aussi</h3><ul>'
  + '<li>' + linkHelp('component-Particles', 'La fiche Particules') + '</li>'
  + '<li>' + linkHelp('visual-events', 'Événements visuels') + '</li>'
  + '</ul>';
}},

{id:'terrain', part:'workflows', section:'Monde', title:'Terrain', level:'both',
 summary:'Créer, sculpter et générer un terrain qui sert de sol à la physique.',
 anchors:[
   {f:'js/component-data.js', c:'size: 60'},
   {f:'js/component-data.js', c:'segments: 64'},
   {f:'js/terrain.js', c:'const seg = Math.max(4, Math.min(200, t.segments | 0));'},
   {f:'js/terrain.js', c:'const alt = t.heights[i] / hMax;'},
   {f:'js/component-data.js', c:'thresholdRoche: 0.35'},
   {f:'js/terrain.js', c:'mesh.castShadow = false;'},
   {f:'js/objects.js', c:'apres: function(o){ o.position.set(0, 0, 0); }'}
 ],
 html:function(){ return ''
  + essentialHelp('<p>Un <b>Terrain sculptable</b> est une grille de hauteurs qu\'on modèle au pinceau dans la vue. '
  + 'Il se colore tout seul (herbe, roche, neige) et sert directement de <b>sol à la physique</b>, relief compris.</p>')

  + '<h3>Sculpter un terrain</h3>'
  + stepsHelp([
      'Menu <b>Objet</b> → <b>⛰ Terrain sculptable</b>. Il se place toujours à l\'origine du monde.',
      'Optionnel : <b>🎲 Générer un relief</b> remplit la grille avec un bruit fractal (<b>Amplitude</b> = hauteur des montagnes en mètres, <b>Échelle des formes</b> = taille des motifs, petit = accidenté).',
      'Cliquez <b>⛏ Sculpter le terrain</b> : la vue passe en mode pinceau, le gizmo se détache et le glisser modèle au lieu de sélectionner.',
      'Choisissez un pinceau — Élever, Creuser, Lisser, Aplanir (au niveau du clic), Bruit — et réglez <b>Rayon</b> et <b>Force</b>.',
      'Peignez. Chaque trait est un pas d\'annulation : <kbd>Ctrl</kbd> + <kbd>Z</kbd> défait le trait entier.'
    ])
  + tipHelp(linkHelp('shortcuts', 'Les raccourcis de sculpt') + ' accélèrent beaucoup le travail.')
  + trapHelp('<b>Générer ÉCRASE tout ce qui a été sculpté</b>, et le tirage n\'est '
  + 'pas reproductible : chaque clic tire une graine au hasard. Seul <kbd>Ctrl</kbd> + <kbd>Z</kbd> ramène un relief précédent.')
  + trapHelp('<b><kbd>Maj</kbd> n\'inverse que deux pinceaux sur cinq</b> — Élever '
  + 'et Creuser. Sur Lisser, Aplanir et Bruit, la touche est lue puis ignorée, alors que la '
  + 'barre de statut et l\'inspecteur annoncent tous les deux « Maj = inverser » sans réserve.')

  + '<h3>Les couleurs</h3>'
  + '<p>Herbe en bas, roche à partir du <b>Seuil roche</b> (0,35 par défaut), neige à partir du <b>Seuil neige</b> (0,8), '
  + 'en tenant compte de la pente.</p>'
  + trapHelp('<b>Ces seuils sont une fraction du point le plus haut, pas une '
  + 'hauteur en mètres.</b> 0,35 signifie « à 35 % du sommet actuel ». Un terrain parfaitement plat est <b>entièrement vert</b> ; creuser un seul trou '
  + 'profond change le maximum et <b>repeint tout le terrain</b> ; augmenter l\'amplitude '
  + 'd\'un relief ne fait <b>pas</b> monter la ligne des neiges, puisque tout grandit ensemble.')

  + advancedHelp('Taille et résolution', '<p>Par défaut : <b>60 m de côté</b> '
  + 'et <b>64 subdivisions</b>, soit 65 × 65 sommets et une maille de 0,94 m. Ces deux valeurs '
  + 'sont affichées mais <b>ne se modifient pas</b> depuis l\'inspecteur.</p>'
  + '<p><b>Rayon</b> et <b>Force</b> du pinceau sont un réglage de votre session, pas du '
  + 'projet : ils reviennent à 5 m et 0,6 au prochain démarrage.</p>')
  + advancedHelp('Collision, ombres et scripts', '<p>La physique <b>suit vraiment le relief sculpté</b> — c\'est un champ de hauteurs, pas une '
  + 'boîte. Deux limites : le collider est construit au démarrage de la simulation (sculpter '
  + 'ensuite ne le met pas à jour), et il <b>ignore la rotation</b> du terrain. Ne faites pas '
  + 'tourner un terrain : le maillage tournerait, la surface de collision non.</p>'
  + '<p>Un terrain <b>reçoit</b> les ombres mais n\'en <b>projette jamais</b> : une montagne '
  + 'n\'assombrit pas la vallée voisine. C\'est un choix de coût, pas un défaut.</p>'
  + '<p>Depuis un script, <code>api.groundHeight(x, z)</code> donne l\'altitude du sol sculpté sous '
  + 'un point, ou <code>null</code> en dehors du terrain.</p>')
  + '<h3>Voir aussi</h3><ul>'
  + '<li>' + linkHelp('component-Terrain', 'La fiche Terrain') + '</li>'
  + '<li>' + linkHelp('physics', 'Physique et colliders') + '</li>'
  + '</ul>';
}},

{id:'game-2d', part:'workflows', section:'2D', title:'Faire un jeu 2D', level:'both',
 summary:'Sprites, tuiles, caméra et physique 2D : faire un jeu 2D complet.',
 anchors:[
   {f:'js/view-gizmo.js', c:'const VIEW2D_ZOOMS = [1, 2, 3, 4, 6, 8, 12, 16];'},
   {f:'js/components/component-tilemap.js', c:"static get typeName(){ return 'Tilemap'; }"},
   {f:'js/tilemap.js', c:'map.cells = cells; map.width = L; map.height = H;'},
   {f:'js/brush-tilemap.js', c:'const cases = d ? strokeTilemap(d.x, d.y, cell.x, cell.y) : [cell];'},
   {f:'js/camera-framing.js', c:'r = Math.max(1, Math.ceil(L / (p * Number(widthLevel))));'},
   {f:'js/camera-framing.js', c:'r = Math.max(1, Math.floor(H / 216));'},
   {f:'js/camera-framing.js', c:'near: -1000, far: 1000};'},
   {f:'js/world-2d.js', c:'const PHYS2D_GRAVITY_DEFAULT = -25;'},
   {f:'js/world-2d.js', c:"node.userData.controller2d = {mode:'platform',"},
   {f:'js/world-2d.js', c:'if(ax && ay){ const k = Math.SQRT1_2; ax *= k; ay *= k; }'},
   {f:'js/physics-2d.js', c:'if(!body.withoutMarche && franchissable'},
   {f:'js/sprite-atlas.js', c:'if(ppus.length > 1){'},
   {f:'js/sprite-atlas-ui.js', c:'return {name: r.name, x: r.x, y: r.y, l: r.l, h: r.h};'}
 ],
 html:function(){ return ''
  + essentialHelp('<p>La 2D n\'est pas un espace à part : il n\'y a qu\'un monde. La 2D est une <b>convention</b> — le plan XY, une caméra '
  + 'orthographique — et le gizmo de vue (en haut à droite de la vue) pose la vue de <b>Face</b> en un clic, projection comprise. '
  + '<b>Fichier → Nouveau → 🎮 Projet 2D</b> part d\'un décor de tuiles avec son sol et une caméra 2D déjà cadrée.</p>')

  + '<h3>Un platformer, pas à pas</h3>'
  + stepsHelp([
      '<b>Fichier → Nouveau → 🎮 Projet 2D</b>.',
      '<b>Le décor</b> : sélectionnez la map de tuiles. La barre du pinceau apparaît sous les onglets (pinceau, gomme, rectangle, pipette, matériau) ; peignez. <kbd>Échap</kbd> range l\'outil.',
      '<b>Le personnage</b> : glissez une planche du panneau Projet dans la vue pour créer un sprite.',
      'Ajoutez-lui, dans cet ordre : <b>Rigidbody2D</b> (il tombe), <b>Collider2D</b> (il a une taille) et <b>CharacterController2D</b> (il répond aux touches).',
      'Réglez la zone de collision à la souris : ' + linkHelp('collisions-2d', 'Collisions 2D') + '.',
      '<b>La caméra</b> : dans son composant, choisissez l\'objet à <b>Suivre</b> dans la liste, puis <b>Déduire du décor</b> pour ses bornes.',
      'Lancez <b>▶ Jouer</b>.'
    ])
  + tipHelp('Tant qu\'un outil de pinceau est armé, le clic gauche <b>peint au lieu de sélectionner</b> : c\'est pour ça que l\'outil armé est mis en couleur. '
  + 'Une caméra et une tilemap se créent depuis le menu de création ; l\'objet naît au <b>centre de la vue</b>.')
  + trapHelp('<b>La physique 2D ne tourne qu\'en mode jeu</b>, jamais en édition — '
  + 'sinon les objets tomberaient pendant qu\'on les place. Les animations de sprite, elles, '
  + 'tournent aussi en édition : c\'est la seule façon de juger une cadence.')

  + '<h3>Les composants du monde 2D</h3>'
  + '<p>Les noms exacts de la liste <b>+ Composant</b> :</p>'
  + arrayHelp(['Composant', 'Ce qu\'il apporte'], [
      ['<code>SpriteRenderer</code>', 'affiche une image d\'une planche'],
      ['<code>SpriteAnimator</code>', 'joue des suites d\'images — et il tourne AUSSI en édition, '
        + 'seule façon de juger une cadence'],
      ['<code>Tilemap</code>', 'la map de tuiles : grille orientable, auto-tuilage, collisions '
        + 'en bandes — ses tuiles viennent de la palette, un asset partagé'],
      ['<code>Camera</code>', 'en projection orthographique : le cadrage à rapport pixel entier'],
      ['<code>CameraFollow</code>', 'la caméra suit un objet nommé, bornée aux limites du décor — '
        + 'utilisable aussi en 3D'],
      ['<code>FogOfWar</code>', 'le brouillard de guerre : ce que l\'équipe du joueur voit, a exploré ou ignore — '
        + 'une surface sombre au-dessus du sol, en jeu seulement'],
      ['<code>Vision</code>', 'ce qui VOIT (un rayon, une équipe) et ce que le brouillard cache ; « mémoriser » '
        + 'garde un bâtiment aperçu affiché sous le brouillard'],
      ['<code>TeamColor</code>', 'la couleur du joueur sur la partie « équipe » d\'un modèle : un seul '
        + 'modèle d\'unité pour tous les joueurs'],
      ['<code>Rigidbody2D</code>', 'l\'objet tombe'],
      ['<code>Collider2D</code>', 'il a une taille — et c\'est ici que se règle une <b>pente</b>'],
      ['<code>CharacterController2D</code>', 'il répond aux touches']
    ])
  + '<p><b>Synthesizer</b> joue des notes décrites par données (onde, fréquence, enveloppe) ; '
  + '<b>TouchControls</b> pose un joystick virtuel, un glisser et des boutons qui pilotent les axes et actions de la table d\'entrées. '
  + '<b>AudioSource</b> s\'ajoute aussi en 2D : un son n\'a pas de dimension. ' + linkHelp('audio', 'Voir le son') + '.</p>'

  + '<h3>Netteté : le rapport pixel</h3>'
  + '<p>La netteté a une seule cause : le <b>rapport pixel</b>, c\'est-à-dire '
  + 'combien de pixels d\'écran occupe un pixel d\'image. <b>S\'il n\'est pas entier, c\'est flou</b> '
  + '— et ni le filtrage au plus proche, ni l\'absence de post-traitement n\'y changent quoi que ce soit. '
  + 'L\'inspecteur de la caméra affiche le rapport obtenu en clair : c\'est le premier endroit à regarder.</p>'
  + arrayHelp(['Mode de cadrage', 'Ce qu\'il fait', 'Quand'], [
      ['Sur la largeur du niveau', 'le plus PETIT rapport entier qui garde la vue à l\'intérieur du '
        + 'niveau', 'presque toujours — le moins de pixellisation sans jamais montrer le hors-champ'],
      ['Le plus net possible', 'le plus GRAND rapport qui tienne dans la hauteur, sur une hauteur de '
        + 'référence de ' + defaultHelp('216 px'), 'un niveau plus grand que l\'écran dans les deux sens'],
      ['Rapport imposé', 'le rapport que vous fixez', 'un jeu qui veut exactement sa fenêtre']
    ])
  + trapHelp('<b>Une seule borne d\'une paire ne borne rien.</b> Il faut X min ET X max '
  + 'pour brider l\'horizontale. Une paire laissée vide laisse l\'axe <b>libre</b> — ce qu\'on veut sur la verticale '
  + 'd\'une tour dont on ne connaît pas la fin. L\'inspecteur signale le cas à moitié rempli.')
  + trapHelp('<b>Les pentes ne sont pas des tuiles.</b> Une tuile est une boîte. Pour '
  + 'une pente, posez un objet avec un <b>Collider2D</b> de forme « pente ».')

  + advancedHelp('La map de tuiles en détail', '<p>Une map neuve fait <b>32 × 18 cases de 0,5 unité</b>. Les trois se règlent dans '
  + 'l\'inspecteur ; agrandir <b>garde ce qui est déjà peint</b>, le coin haut-gauche servant '
  + 'd\'ancre. Rétrécir perd ce qui sort.</p>'
  + '<p>Un <b>matériau</b> est une planche de <b>16 images</b> — les 16 voisinages possibles, dans '
  + 'l\'ordre d\'une découpe 4 × 4. Le moteur choisit l\'image tout seul selon les voisins de même '
  + 'matériau ; on ne dessine jamais un coin à la main. Une case hors map compte comme vide, '
  + 'donc les bords se ferment.</p>'
  + '<p>Le pinceau <b>relie</b> les cases entre deux positions de souris : une souris saute trois ou quatre cases entre deux évènements.</p>'
  + '<p>Une salle entière se peint aussi <b>d\'un coup</b>, depuis un plan en texte — une ligne par '
  + 'rangée : c\'est ce que fait la commande <code>paint_room</code> du ' + linkHelp('copilot', 'copilote') + ', et <code>read_room</code> rend le plan '
  + 'd\'une map existante. À lire <b>avant</b> de repeindre, qui écrase tout.</p>'
  + '<p>L\'inspecteur affiche « <i>N case(s) posée(s), regroupées en M boîte(s) de collision</i> ». '
  + '<b>C\'est M qui compte</b> : les cases voisines sont fondues en bandes, et c\'est le nombre de '
  + 'bandes que le solveur teste à chaque image. Une salle de 1 296 cases descend à quelques '
  + 'dizaines de boîtes.</p>')

  + advancedHelp('La caméra 2D en détail', '<p>Une caméra 2D n\'est pas retournée comme la caméra 3D — '
  + 'cette rotation de 180° miroiterait l\'axe X, et un platformer répondrait à l\'envers.</p>'
  + '<p><b>Suit</b> se choisit dans une liste d\'objets, pas au clavier : un nom mal tapé donnerait '
  + 'une caméra qui ne suit rien. <b>Regard vers le haut</b> ' + defaultHelp('0,12')
  + ' place le personnage un peu sous le centre ; c\'est une fraction de la hauteur de vue, donc juste à toutes les '
  + 'résolutions.</p>'
  + '<p><b>Déduire du décor</b> calcule les bornes depuis les tuiles et les colliders statiques de la scène.</p>'
  + '<p><b>Caler sur le pixel</b> arrondit la caméra à la grille de pixels. Sans ce calage, tout le '
  + 'décor frémit au déplacement.</p>'
  + '<p>Tous ces réglages se posent aussi en une commande, <code>configure_camera_2d</code>, et '
  + '<code>check</code> rend le rapport pixel obtenu de chaque caméra.</p>'
  + '<p>Le frustum accepte les <b>deux côtés de z</b> (near négatif) : les calques que vous reculez '
  + 'derrière la caméra restent visibles.</p>')

  + advancedHelp('Le personnage : saut et vue de dessus', '<p>La gravité 2D vaut '
  + defaultHelp('−25 unités/s²') + ' — plus sec que la Terre, parce qu\'un platformer ne l\'imite pas. '
  + 'Le saut se règle en <b>hauteur</b> ' + defaultHelp('3 unités') + ', pas en vitesse. <b>Coyote</b> ' + defaultHelp('0,1 s')
  + ' laisse sauter juste après avoir quitté le sol, <b>mémoire du saut</b> ' + defaultHelp('0,15 s')
  + ' joue un saut demandé juste avant d\'atterrir.</p>'
  + '<p>Le champ <b>Vue</b> de <code>CharacterController2D</code> bascule en <b>de dessus</b> (Zelda, RPG) : '
  + 'huit directions, lues sur <code>gauche</code>, <code>droite</code>, <code>haut</code> et '
  + '<code>bas</code>. Le personnage <b>ne subit alors plus la gravité</b> et <b>n\'escalade '
  + 'plus rien</b> : vu de dessus, le Y n\'est plus une hauteur mais une <b>profondeur</b>, et tout '
  + 'mur un peu plus bas que le héros deviendrait une marche qu\'il <b>traverse</b>.</p>'
  + '<p>Les <b>diagonales</b> sont ramenées à la vitesse des lignes droites. Sans cela on avance '
  + '41 % plus vite en biais.</p>'
  + '<p>Pour les portes, les ramassages et les zones de coup, <code>api.overlaps2d(cible)</code> '
  + 'dit si deux boîtes se touchent. Elle prend le <b>Collider2D</b> s\'il y en a un, <b>sinon '
  + 'l\'étendue du sprite</b> : un déclencheur peut donc être détecté sans bloquer le passage. '
  + linkHelp('scripts-api', 'Voir l\'objet api') + '.</p>')

  + advancedHelp('Un personnage livré en plusieurs fichiers', '<p>Un <b>animateur de sprite</b> lit toutes ses suites dans <b>une seule</b> planche. '
  + 'Dans l\'inspecteur d\'une planche : <b>🧩 Assembler avec d\'autres planches…</b>, puis cochez '
  + 'celles à réunir. L\'assemblage crée une <b>nouvelle</b> planche — les originales ne sont pas '
  + 'touchées — dont les images sont nommées <code>fichier/image</code>, et une <b>suite par '
  + 'fichier source</b> déjà prête. La fenêtre annonce la taille obtenue et le pourcentage de place '
  + 'utilisée ; une planche non découpée ou sans image chargée est <b>grisée</b>.</p>'
  + '<p><b>Les planches doivent avoir le même nombre de pixels par unité.</b> '
  + 'Mélanger du 16 et du 48 rendrait le personnage trois '
  + 'fois trop grand selon l\'état joué : l\'assemblage refuse et le dit.</p>')

  + advancedHelp('La vue 2D', '<p>Le zoom va par <b>paliers entiers</b> (1, 2, 3, 4, 6, 8, 12, 16) : on choisit combien de '
  + 'pixels d\'écran vaut un pixel d\'image. Molette pour zoomer, clic-milieu pour se '
  + 'déplacer ; ni orbite ni vol libre. La grille est graduée en '
  + '<b>pixels</b>, pas en mètres.</p>')
  + '<h3>Voir aussi</h3><ul>'
  + '<li>' + linkHelp('tuto-game-2d', 'Tutoriel : un jeu de plateforme 2D') + '</li>'
  + '<li>' + linkHelp('collisions-2d', 'Collisions 2D') + '</li>'
  + '<li>' + linkHelp('component-SpriteRenderer', 'Le sprite') + '</li>'
  + '<li>' + linkHelp('component-Tilemap', 'La tilemap') + '</li>'
  + '<li>' + linkHelp('component-CharacterController2D', 'Le contrôleur 2D') + '</li>'
  + '</ul>';
}},

{id:'audio', part:'workflows', section:'Audio', title:'Le son', level:'both',
 summary:'Jouer des sons et de la musique, régler leur atténuation et leur mixage, fabriquer bruitages et boucles.',
 anchors:[
   {f:'js/audio.js', c:"const AUDIO_DEFAULT = {asset:null, volume:1, loop:false, auto:true, spatial:true, range:10, pitch:1,"},
   {f:'js/audio-falloff.js', c:'function setFalloffAudio(son, ua){'},
   {f:'js/audio-falloff.js', c:"const AUDIO_MODELS = ['inverse', 'lineaire', 'exponentiel'];"},
   {f:'js/proc-sound.js', c:'function samplesSound(d){'},
   {f:'js/game-runtime.js', c:'game.cam.add(listenerAudio);'},
   {f:'js/components/component-audio.js', c:"static get typeName(){ return 'AudioSource'; }"}
 ],
 html:function(){ return ''
  + essentialHelp('<p>Un son est un <b>asset</b> (<code>.mp3</code>, <code>.wav</code>, <code>.ogg</code>, '
  + '<code>.m4a</code>) joué par une <b>source</b> posée sur un objet : le composant <b>AudioSource</b>. '
  + 'Par défaut, la source joue au lancement et s\'entend moins quand la caméra de jeu s\'éloigne.</p>')

  + '<h3>Faire jouer un son</h3>'
  + stepsHelp([
      'Glissez le fichier son dans le panneau Projet.',
      'Glissez-le du panneau Projet sur un objet de la vue — ou ajoutez à l\'objet un <b>AudioSource</b> par <b>+ Composant</b> et choisissez le son. Les deux chemins donnent la même chose.',
      'Réglez volume, boucle et <b>3D</b> dans l\'inspecteur (tableau ci-dessous).',
      'Pour une musique ou un son d\'interface, décochez <b>3D</b> et choisissez le bus <b>Musique</b>.',
      'Lancez <b>▶ Jouer</b> : le récepteur suit la <b>caméra de jeu</b>, pas la caméra d\'édition.'
    ])
  + arrayHelp(['Réglage', 'Défaut', 'À quoi ça sert'], [
      ['Volume', defaultHelp('1'), '0 à 2 — au-delà de 1 le son sature, et ça s\'entend'],
      ['Vitesse', defaultHelp('1'), 'la hauteur suit : 1,2 rend un bruitage plus aigu et plus court'],
      ['Boucle', defaultHelp('non'), 'une musique d\'ambiance ; un bruitage, jamais'],
      ['Au lancement', defaultHelp('oui'), 'joue au démarrage du jeu, sans script'],
      ['3D (spatial)', defaultHelp('oui'), 'le volume dépend de la distance à la caméra'],
      ['Portée', defaultHelp('10'), 'voir le piège ci-dessous']
    ])
  + tipHelp('Sans script, l\'action <b>Jouer le son…</b> d\'un ' + linkHelp('visual-events', 'événement « Quand… Alors… »') + ' joue un son au bon moment.')

  + '<h3>L\'atténuation</h3>'
  + '<p><b>« Portée »</b> n\'est pas une limite : c\'est la distance de <b>référence</b>, celle à laquelle le son garde son volume plein. '
  + 'Ce qui se passe au-delà dépend du <b>modèle</b> :</p>'
  + arrayHelp(['Modèle', 'Au-delà de la portée', 'À la distance max'], [
      ['<b>inverse</b> ' + defaultHelp('défaut'), 'décroît lentement', '<b>s\'entend encore</b> — mesuré : '
        + '12,5 % avec portée 5 et max 40, et <b>toujours 12,5 % à 400</b> : le gain plafonne'],
      ['<b>linéaire</b>', 'décroît régulièrement', '<b>zéro exactement</b>, et zéro au-delà'],
      ['<b>exponentiel</b>', 'chute rapidement', 's\'entend encore, mais très faiblement']
    ])
  + trapHelp('<b>Avec le modèle par défaut, « distance max » n\'éteint rien</b> — elle borne le calcul. '
  + 'C\'est la cause de « le niveau est bruyant sans qu\'on sache pourquoi » : dix sources lointaines restent audibles en fond, et aucune ne '
  + 'paraît fautive. Pour un décor sonore, prenez <b>linéaire</b>.')

  + '<h3>Le mixage : Musique et Effets sonores</h3>'
  + '<p>Chaque source sort sur un <b>bus</b> : <b>Effets sonores</b> (le défaut) ou <b>Musique</b>, '
  + 'tous deux sous le <b>Volume général</b>. Les volumes de départ se règlent dans '
  + '<b>Paramètres du projet → Mixage audio</b>.</p>'
  + trapHelp('<b>Une musique laissée sur « Effets sonores » baisse avec les bruitages.</b> '
  + 'Les projets écrits avant les bus y ont toutes leurs sources : passez vos musiques sur « Musique » avant d\'offrir un réglage '
  + 'de volume au joueur.')

  + '<h3>Fabriquer ses sons : le Rack sonore</h3>'
  + '<p>Le bouton <b>Audio</b> de la barre du haut ouvre le <b>Rack sonore</b>, avec deux modules.</p>'
  + stepsHelp([
      '<b>Un bruitage (SX-1)</b> : « ＋ Créer → Bruitage » dans le panneau Projet, ou « ＋ NOUVEAU » dans le rack. Cliquez <b>JUMP</b>, <b>COIN</b>, <b>LASER</b>, <b>BOOM</b>… pour tirer un son du genre, <b>MUTER</b> pour une variante voisine, puis affinez aux curseurs (chacun rejoue le son au relâché).',
      '<b>Une boucle musicale (BX-16)</b> : choisissez <b>tonalité</b> et <b>gamme</b>, puis cliquez dans les grilles pour poser des notes ; <b>LECTURE</b> fait tourner la boucle pendant que vous la retouchez.',
      'Posez le bruitage ou la boucle sur une source audio, comme un son importé.'
    ])
  + tipHelp('Les grilles de la BX-16 ne proposent que les notes de la gamme choisie : pas de fausse note possible. '
  + '<kbd>Ctrl</kbd>+<kbd>Z</kbd> annule un geste entier, et chaque module du rack se <b>replie</b> par le triangle de son en-tête.')

  + advancedHelp('Depuis un script', '<p><code>api.playSound(name, volume, bus)</code> joue un son une fois, sans source attachée — un saut, un '
  + 'ramassage, un impact. <code>api.audio(cible)</code> pilote la source d\'un objet : '
  + '<code>.play()</code>, <code>.stop()</code>, <code>.volume(v)</code>. '
  + linkHelp('scripts-api', 'Voir l\'objet api') + '.</p>'
  + '<p>Les bus se changent en cours de partie, pour un menu d\'options : '
  + '<code>api.audioBus(\'music\').volume(0.5)</code>, ou <code>.mute(true)</code> pendant une '
  + 'cinématique. La sourdine repart à zéro à chaque partie ; le volume réglé dans le projet aussi.</p>'
  + '<p>Les sons joués par <code>api.playSound</code> et les notes du synthé sortent sur '
  + '<b>Effets sonores</b>. L\'aperçu d\'un asset dans le panneau Projet ne passe par aucun bus.</p>')

  + advancedHelp('Atténuation : la pente et le défaut', '<p>La <b>pente</b> règle la raideur. À <b>0</b>, le son garde son volume plein à toute distance — '
  + 'décocher 3D dit la même chose plus clairement.</p>'
  + '<p>Le défaut reste <b>inverse</b> volontairement : le changer modifierait le son de tous les '
  + 'projets déjà réglés à l\'oreille. L\'inspecteur affiche le <b>pourcentage réel</b> à dix fois la '
  + 'portée, pour que le choix se fasse sur une mesure.</p>'
  + '<p>Les octets du fichier partent dans le projet <b>et</b> dans le jeu publié : un build est autonome, sons compris.</p>')

  + advancedHelp('SX-1 et BX-16 en détail', '<p>Un <b>bruitage</b> SX-1 est un asset 🎛 qui ne contient pas de son, mais sa <b>recette</b> — onde, '
  + 'hauteur et glissement, vibrato, arpège, enveloppe, filtre, grain 8-bit. Le son en est recalculé '
  + 'à chaque ouverture, dans l\'éditeur comme dans le jeu publié ; sur le disque, c\'est un petit '
  + 'fichier <code>.sfx.json</code> lisible. <b>WAV</b> le fige en fichier audio ordinaire. Il se joue par '
  + '<code>api.playSound</code> exactement comme un son importé.</p>'
  + '<p>Une <b>boucle</b> BX-16 (asset 🎹) fait de 1 à 4 mesures de 16 pas : <b>percussions</b> (8 voix synthétisées), <b>basse</b>, <b>mélodie</b> et '
  + '<b>accords</b>. Gammes : majeur, mineur, dorien, pentatoniques, blues… Changer de tonalité ou de gamme <b>transpose</b> la boucle et '
  + 'recale ses notes et ses accords. Dans une grille, <b>Maj+clic</b> tient la note précédente '
  + 'jusque-là ; dans les percussions, Maj+clic pose un accent. Les accords se choisissent parmi ceux '
  + 'de la gamme (I à VII), ou d\'un coup par un enchaînement tout fait (pop, ballade, épique…), joués '
  + 'tenus, plaqués ou en arpège. <b>EFFACER</b> vide toutes les pistes en gardant tempo, tonalité, '
  + 'gamme et instruments. Posée sur un objet, une boucle joue en boucle sur le bus Musique ; le son est '
  + 'recalculé depuis sa recette (<code>.loop.json</code>), dans le jeu publié aussi.</p>')

  + advancedHelp('Le copilote et le son', '<p><code>create_music_loop</code> compose une boucle (depuis un preset pop, chiptune ou lo-fi, ou '
  + 'note à note) et <code>edit_music_loop</code> la retouche — changer seulement la tonalité ou la '
  + 'gamme la transpose. Les notes hors gamme sont signalées. <code>read_sound_asset</code> rend la recette actuelle d\'une boucle ou d\'un bruitage : le copilote '
  + 'la relit avant de la modifier, et ne réécrit pas par-dessus le travail fait à la main.</p>'
  + '<p><code>create_sfx</code> fabrique un bruitage <b>réglable</b> depuis un preset ou une recette, '
  + '<code>edit_sfx</code> le retouche (« plus grave », « plus court ») et <code>mutate_sfx</code> en '
  + 'propose des variantes à comparer à l\'oreille. Chaque commande rend en chiffres ce qu\'on '
  + 'entend — durée, hauteur de départ et d\'arrivée, crête.</p>'
  + '<p><code>create_sound</code> <b>fabrique</b> un bruitage sans aucun fichier source — bip, saut, '
  + 'chute, impact, pas, pièce — comme <code>create_texture</code> fabrique des pixels. '
  + '<code>configure_audio</code> l\'attache et le règle, <code>play_sound</code> le fait écouter, '
  + '<code>configure_audio_mix</code> règle le volume des bus.</p>'
  + '<p><b>Un agent n\'entend rien.</b> <code>play_sound</code> joue dans l\'éditeur, '
  + 'donc pour vous. Le modèle peut vérifier qu\'un asset existe et qu\'une source est réglée, pas que '
  + 'le bruitage convient. Cette écoute-là reste la vôtre.</p>')
  + '<h3>Voir aussi</h3><ul>'
  + '<li>' + linkHelp('component-AudioSource', 'La fiche Source audio') + '</li>'
  + '<li>' + linkHelp('component-Synthesizer', 'Le synthétiseur') + '</li>'
  + '<li>' + linkHelp('assets-made', 'Fabriquer des assets sans fichiers') + '</li>'
  + '<li>' + linkHelp('visual-events', 'Événements visuels') + '</li>'
  + '</ul>';
}},

{id:'game-ui', part:'workflows', section:'Interface de jeu', title:'L\'interface de jeu (UIDocument)', level:'both',
 summary:'Menus, score et barres de vie en HTML/CSS avec UIDocument.',
 anchors:[
   {f:'js/component-data.js', c:'{documentUIId: null, sheetStyleIds: [], values: {}}'},
   {f:'js/game-ui.js', c:"const prefixe = '#' + idPrefixe;"},
   {f:'js/game-ui.js', c:'data-event'},
   {f:'js/game-ui.js', c:'data-bind'},
   {f:'js/game-ui.js', c:"if (!_isFieldOfInput(el)) { el.textContent = String(values[key]); return; }"},
   {f:'js/build.js', c:'.ui-button'},
   {f:'test/scoper-css.test.mjs', c:'@media'}
 ],
 html:function(){ return ''
  + essentialHelp('<p>L\'interface d\'un jeu — score, barre de vie, menu de pause — s\'écrit en <b>HTML et '
  + 'CSS</b>, dans deux sortes d\'assets : un <b>document UI</b> (📄) qui porte le HTML, et une '
  + 'ou plusieurs <b>feuilles de style</b> (🎨) qui portent le CSS. On les glisse sur un objet, '
  + 'qui reçoit un composant <b>UIDocument</b>.</p>')

  + '<h3>Afficher un score</h3>'
  + stepsHelp([
      'Dans le panneau Projet : <b>＋ → 📄 Document UI</b>. L\'éditeur HTML/CSS s\'ouvre (aussi par <b>Fenêtres → Éditeur HTML/CSS</b>).',
      'Écrivez le HTML, par exemple <code>&lt;div class="score"&gt;Score : &lt;span data-bind="score"&gt;&lt;/span&gt;&lt;/div&gt;</code>.',
      'Créez une <b>🎨 Feuille de style</b> pour la mise en forme.',
      'Glissez le document, puis la feuille, sur un objet de la scène : il reçoit le composant UIDocument.',
      'Dans un script, écrivez la valeur : <code>api.uiDocument().values.score = 42;</code>.',
      'Lancez <b>▶ Jouer</b> pour voir l\'interface.'
    ])
  + trapHelp('<b>L\'interface ne s\'affiche pas dans la vue de l\'éditeur.</b> Elle '
  + 'n\'est rendue que par le jeu — <b>▶ Jouer</b> et les builds exportés.')
  + tipHelp('Le contenu vit sur les <b>assets</b>, pas sur l\'objet : deux objets peuvent partager le '
  + 'même document, et le modifier une fois le modifie partout.')

  + '<h3>Rendre un bouton cliquable</h3>'
  + '<p>Le calque d\'interface laisse passer la souris par défaut, sinon il rendrait la caméra '
  + 'inutilisable. Un élément ne devient cliquable que s\'il porte la classe '
  + '<code>ui-button</code> :</p>'
  + '<pre><code>&lt;button class="ui-button" data-event="rejouer"&gt;Rejouer&lt;/button&gt;</code></pre>'
  + '<p>Côté script, on s\'abonne au nom déclaré :</p>'
  + '<pre><code>function start(api){\n'
  + '  api.on(\'rejouer\', function(){ api.changeScene(\'Niveau 1\'); });\n'
  + '}</code></pre>'
  + trapHelp('Sans <code>class="ui-button"</code>, le bouton s\'affiche, se survole '
  + 'peut-être, et <b>ne reçoit jamais le clic</b>. Rien dans la Console.')

  + '<h3>Afficher des valeurs : <code>data-bind</code></h3>'
  + arrayHelp(['Élément', 'Ce que fait <code>data-bind="clé"</code>'], [
      ['Texte (<code>&lt;span&gt;</code>, <code>&lt;div&gt;</code>…)', 'Affiche la valeur de <code>values[clé]</code>, mise à jour dès qu\'un script la change.'],
      ['Champ de formulaire', 'Affiche la valeur, et la saisie du joueur l\'écrit en retour dans <code>values</code>.'],
      ['<code>data-bind-class="clé"</code>', 'Ajoute la valeur comme <b>classe CSS</b>, en gardant la classe d\'origine : un voile rouge quand on prend un coup, une vie qui pulse sous 30 %.']
    ])
  + '<p>Pour un texte fixe à traduire, c\'est <code>data-t</code> : ' + linkHelp('localization', 'Traduire le jeu') + '.</p>'

  + advancedHelp('Le CSS est cloisonné, et pas tout à fait', '<p>Chaque document reçoit un identifiant unique, et chacun de vos sélecteurs est préfixé '
  + 'par lui : <code>button{…}</code> devient <code>#ui-doc-12 button{…}</code>. Deux documents '
  + 'ouverts en même temps (un HUD et un menu de pause) ne se marchent donc pas dessus.</p>'
  + '<p>Deux conséquences. D\'abord, <b>un sélecteur '
  + '<code>body</code>, <code>html</code> ou <code>:root</code> ne s\'applique à rien</b> : '
  + 'préfixé, il désigne un <code>body</code> à l\'intérieur du document, qui n\'existe pas. '
  + 'Ensuite, <b>le contenu d\'un <code>@media</code> n\'est PAS cloisonné</b> : il est recopié '
  + 'tel quel et s\'applique à toute la page, donc aussi aux autres documents. Une règle qui '
  + '« déborde » sur un autre HUD est presque toujours dans un <code>@media</code>.</p>')
  + advancedHelp('Les liaisons en détail', '<p>Les valeurs sont reposées dès qu\'elles changent, comparées par empreinte : un HUD qui ne bouge pas ne réécrit pas le DOM à chaque image. '
  + 'Un champ <b>en cours de saisie</b> n\'est pas écrasé, pour ne pas renvoyer le curseur du joueur au bout du champ. '
  + 'Un élément qui porte à la fois <code>data-t</code> et <code>data-bind</code> finit par la valeur.</p>')
  + '<h3>Voir aussi</h3><ul>'
  + '<li>' + linkHelp('component-UIDocument', 'La fiche Interface (UI)') + '</li>'
  + '<li>' + linkHelp('localization', 'Traduire le jeu') + '</li>'
  + '<li>' + linkHelp('scripts-api', 'L\'API de scripts') + '</li>'
  + '</ul>';
}},

{id:'multiplayer', part:'workflows', section:'Jeu', title:'Multijoueur', level:'advanced',
 summary:'Faire jouer plusieurs joueurs dans la même partie, en relais ou en pair-à-pair.',
 anchors:[
   {f:'js/network-editor.js', c:'export const PANEL_NETWORK'},
   {f:'js/network-game.js', c:'NETWORK.periodeState = 1 / NETWORK.config.sendRate'},
   {f:'js/network-game.js', c:'function p2pFallback(reason)'},
   {f:'js/network-game.js', c:'Hors ligne, on est SEUL et donc autorité'},
   {f:'js/network-game.js', c:'replicate: function(o)'},
   {f:'js/scripts.js', c:'transmet les AXES et les actions active, pas les cles'}
 ],
 html:function(){ return ''
  + essentialHelp('<p>Le premier joueur arrivé dans le salon est l\'<b>autorité</b> : c\'est chez lui que le jeu '
  + 'tourne vraiment. Les autres lui envoient leurs <b>entrées</b> et reçoivent l\'état en retour. Un serveur ne fait que '
  + '<b>relayer</b> les paquets. Un script écrit pour le solo tourne tel quel : hors ligne, '
  + '<code>api.isAuthority()</code> renvoie toujours <code>true</code>.</p>')

  + '<h3>Essayer une partie à plusieurs</h3>'
  + stepsHelp([
      'Ouvrez la fenêtre <b>🌐 Multijoueur</b> (bouton de la barre, ou menu Fenêtres). Elle regroupe les '
      + '<b>réglages réseau du projet</b>, le <b>service multijoueur du cloud</b> (l\'activer, sa clé de '
      + 'jeu, l\'usage du mois) et un bloc pour <b>essayer</b> une partie.',
      'Choisissez le <b>transport</b> : <b>relais</b> (tout passe par le serveur) ou <b>pair-à-pair</b>.',
      'Dans vos scripts, protégez ce qui décide du jeu : <code>if(!api.isAuthority()) return;</code>.',
      'Décrivez ce qui change dans le monde dans <code>api.state</code>, et inscrivez les objets qui bougent avec <code>api.network.replicate(objet)</code>.',
      'Utilisez le bloc d\'essai de la fenêtre pour créer ou rejoindre une partie.'
    ])
  + trapHelp('<b>Seules deux choses sont répliquées</b> : l\'objet <code>api.state</code> en entier, et la '
  + '<b>position et la rotation</b> des objets inscrits par <code>api.network.replicate(objet)</code>. '
  + 'Tout le reste ne traverse pas : ni l\'échelle, ni les créations et '
  + 'destructions d\'objets, ni la visibilité, ni les matériaux, ni les animations, ni le son, '
  + 'ni les particules, ni l\'interface. Un objet créé par l\'autorité pendant la partie '
  + 'n\'apparaît chez personne d\'autre : décrivez le monde dans <code>api.state</code>, et laissez chaque poste en tirer '
  + 'les conséquences localement.')
  + trapHelp('Les objets répliqués sont appariés <b>par leur nom</b>. Deux objets du '
  + 'même nom se confondent : le second reçoit la position du premier, sans erreur.')
  + trapHelp('Le multijoueur ne marche pas si vous avez ouvert '
  + '<code>editor.html</code> directement depuis le disque : il n\'y a alors aucune adresse à '
  + 'contacter. La fenêtre prévient aussi quand le serveur est local ou en http:// : un jeu '
  + 'publié en https (itch.io) ne pourrait pas s\'y connecter.')

  + advancedHelp('Transport, cadence et entrées', '<p>Les réglages réseau du projet se posent aussi par la commande <code>configure_network</code> du copilote. En '
  + 'pair-à-pair, chaque joueur se relie directement à l\'autorité, le serveur ne servant qu\'à '
  + 'les présenter ; si la liaison directe échoue en 5 secondes, la partie continue par le relais '
  + '(si le repli est permis). <code>api.network.transport()</code> dit le chemin réellement pris, '
  + '<code>api.network.ping()</code> la latence en millisecondes.</p>'
  + '<p>L\'instantané revient à la <b>cadence d\'envoi</b> du projet (20 fois par seconde par défaut, '
  + '<code>api.network.sendRate()</code>).</p>'
  + '<p>Ce sont les <b>actions</b> et les <b>axes</b> qui circulent, jamais les touches brutes : '
  + 'un joueur en AZERTY et un joueur en QWERTY n\'ont pas les mêmes touches, mais « avancer » '
  + 'veut dire la même chose partout.</p>')
  + advancedHelp('Dans un jeu publié', '<p>Un build exporté embarque le moteur réseau, mais <b>pas le panneau</b> « créer / '
  + 'rejoindre » : celui-ci n\'existe que dans l\'éditeur. Un jeu publié doit donc proposer sa '
  + 'propre entrée de code, et appeler <code>api.network.join(code, adresse)</code> lui-même.</p>')
  + '<h3>Voir aussi</h3><ul>'
  + '<li>' + linkHelp('scripts-api', 'L\'API de scripts') + '</li>'
  + '<li>' + linkHelp('build', 'Publier un jeu') + '</li>'
  + '<li>' + linkHelp('webxr', 'La réalité virtuelle (WebXR)') + '</li>'
  + '</ul>';
}},

{id:'webxr', part:'workflows', section:'Jeu', title:'Réalité virtuelle (WebXR)', level:'both',
 summary:'Rendre un jeu jouable au casque de réalité virtuelle avec WebXR.',
 anchors:[
   {f:'js/game-runtime.js', c:'new THREE.WebGPURenderer({antialias:true, forceWebGL: XR_WANTED})'},
   {f:'js/xr-runtime.js', c:"export const XR_BUTTONS = {trigger: 0, squeeze: 1, touchpad: 2, stick: 3, a: 4, b: 5};"},
   {f:'js/component-data.js', c:"snapTurn: 45,"},
   {f:'js/hub/template-webxr-vr.js', c:"HubTemplates.attachApply('webxr-vr'"}
 ],
 html:function(){ return ''
  + essentialHelp('<p>Un jeu devient jouable au casque (Meta Quest, Pico, casques PC via Chrome ou Edge) dès '
  + 'qu\'un objet de la scène porte le composant <code>XROrigin</code>. Le jeu affiche '
  + 'alors un bouton <b>Entrer en VR</b> en bas de l\'écran.</p>')

  + '<h3>Préparer une scène VR</h3>'
  + stepsHelp([
      'Le plus court : partir du template <b>WebXR / VR</b> du Hub, qui monte une salle de test complète (sol, table, trois cubes à saisir et lancer).',
      'Sinon : créez un objet vide, ajoutez-lui <b>XROrigin</b> — c\'est le sol du joueur.',
      'Mettez la caméra principale <b>en enfant</b> de cet objet, à <b>1,6 m</b> au-dessus de l\'origine.',
      'Ajoutez <b>XRTeleportArea</b> aux sols où l\'on peut se téléporter, et <b>XRGrabbable</b> (avec Physique pour pouvoir les lancer) aux objets à saisir.',
      'Lancez <b>▶ Jouer</b>, puis <b>Entrer en VR</b>.'
    ])
  + tipHelp('<b>Sans casque</b> : installez l\'extension <b>Immersive Web Emulator</b> (Meta, Chrome et Edge), ouvrez '
  + '▶ Jouer : le bouton devient actif, et l\'onglet de l\'extension dans les outils de '
  + 'développement fait bouger casque et manettes à la souris.')
  + trapHelp('WebXR exige une page <b>sécurisée</b> : <code>https://</code> ou '
  + '<code>localhost</code>. Un casque qui ouvre le jeu par l\'adresse IP du PC, en http, voit '
  + '« VR indisponible ». Sur Quest branché en USB : <code>adb reverse tcp:PORT tcp:PORT</code> '
  + 'puis ouvrir <code>http://localhost:PORT</code> dans le navigateur du casque.')

  + '<h3>Les trois composants</h3>'
  + arrayHelp(['Composant', 'Ce qu\'il apporte'], [
      ['<code>XROrigin</code>', 'le <b>sol du joueur</b>. La caméra principale doit en être un '
        + 'enfant : le casque la pilote relativement à lui. Déplacer cet objet, c\'est déplacer le '
        + 'joueur. Il règle aussi le mode (VR ou réalité augmentée), la téléportation, la rotation '
        + 'par cran et le déplacement continu'],
      ['<code>XRGrabbable</code>', 'l\'objet se <b>saisit</b> à la gâchette latérale. Avec un '
        + 'composant Physics, il est lancé à la vitesse de la main au lâcher'],
      ['<code>XRTeleportArea</code>', 'une surface sur laquelle on peut se <b>téléporter</b> — '
        + 'rien d\'autre ne l\'est, et une pente au-delà de la limite réglée est refusée']
    ])

  + '<h3>Les commandes par défaut</h3>'
  + arrayHelp(['Geste', 'Effet'], [
      ['Stick droit vers l\'avant, puis relâcher', 'téléportation (arc vert = valide, rouge = refusé)'],
      ['Stick droit à gauche / à droite', 'rotation par cran (45° par défaut)'],
      ['Stick gauche', 'déplacement continu, si sa vitesse n\'est pas 0 (désactivé par défaut : '
        + 'c\'est le mode le plus inconfortable pour les joueurs sensibles)'],
      ['Gâchette latérale près d\'un objet', 'saisir ; relâcher pour lâcher ou lancer']
    ])
  + '<p>Tout le reste se programme par <code>api.xr</code> (' + linkHelp('scripts-api', 'voir l\'objet api') + ').</p>'

  + advancedHelp('Hauteur de la caméra', '<p>La hauteur de 1,6 m est la vue qu\'on a sur '
  + 'écran, avant d\'entrer en VR. En session « debout », cette hauteur est remise à zéro et '
  + 'c\'est le casque qui donne la vraie — sinon le joueur verrait le monde depuis 3,2 m.</p>')
  + advancedHelp('Ce qui change en session', '<p>Un projet XR est rendu par le backend <b>WebGL2</b> du moteur de rendu (et non WebGPU) : '
  + 'les sessions WebXR sur WebGPU sont encore expérimentales dans les navigateurs. Le rendu est '
  + 'identique. Le <b>post-traitement</b> (PostVolume) est coupé dans le casque, et l\'interface '
  + 'HTML n\'y est pas visible — sauf en réalité augmentée, où elle se superpose.</p>')
  + '<h3>Voir aussi</h3><ul>'
  + '<li>' + linkHelp('component-XROrigin', 'L\'origine XR') + '</li>'
  + '<li>' + linkHelp('component-XRGrabbable', 'Saisissable (XR)') + '</li>'
  + '<li>' + linkHelp('component-XRTeleportArea', 'Zone de téléportation') + '</li>'
  + '</ul>';
}},

{id:'project', part:'workflows', section:'Publication', title:'Le format .p3d', level:'both',
 summary:'Enregistrer un projet, ce que contient un .p3d, ses migrations, et ce que le build retire.',
 anchors:[
   {f:'js/serialization.js', c:'MIGRATIONS'},
   {f:'js/serialization.js', c:"const PROJECT_MANIFEST = 'project.json';"},
   {f:'js/sprite-2d.js', c:'function kindProject(scenes){'},
   {f:'js/build-trimming.js', c:'const MODULES_OPTIONAL = ['},
   {f:'js/game-runtime.js', c:"if(typeof CANNON === 'undefined'){ warnOnceMissing('CANNON', 'vendor/cannon.js'); return; }"},
   {f:'js/build.js', c:'runtime.js'},
   {f:'js/ui.js', c:"{label:'🎮 Build Web jouable (.zip)'"},
   {f:'js/ui.js', c:"{label:'Dossier lisible (Git, .zip)'"}
 ],
 html:function(){ return ''
  + essentialHelp('<p>Un projet est une <b>archive</b> contenant un manifeste <code>project.json</code>, un '
  + 'fichier par scène et un par asset. Il s\'enregistre en fichier <code>.p3d</code> ou dans un dossier sur disque, '
  + 'et un ancien projet s\'ouvre toujours.</p>')

  + '<h3>Enregistrer et rouvrir</h3>'
  + stepsHelp([
      '<b>Fichier → Enregistrer sous</b> : choisissez <b>Fichier de projet (.p3d)</b>, <b>📁 Dans un dossier…</b> ou <b>☁ Sur le cloud…</b>.',
      'Ensuite, <b>Fichier → Enregistrer</b> réécrit au même endroit.',
      'Pour rouvrir : <b>Fichier → Ouvrir</b> → <b>Dossier de projet…</b>, <b>Fichier de projet… (.p3d / .s3d)</b> ou <b>Projets récents…</b>.',
      'Pour versionner sous Git : <b>Fichier → Exporter → Dossier lisible (Git, .zip)</b>.'
    ])
  + tipHelp('La <b>même</b> structure est écrite par les trois chemins : l\'archive <code>.p3d</code>, '
  + 'le dossier projet ouvert sur disque, et l\'export lisible pour Git. Dézipper un '
  + '<code>.p3d</code> donne donc un dossier projet ouvrable, et l\'inverse aussi.')
  + trapHelp('<b>La compatibilité ne va que dans un sens.</b> Un ancien projet s\'ouvre toujours : les migrations sont appliquées à la lecture, dans '
  + 'l\'ordre, et chacune préserve l\'aspect. Un projet enregistré '
  + 'aujourd\'hui ne s\'ouvre pas dans une version plus ancienne de l\'éditeur.')

  + advancedHelp('Pourquoi un fichier par scène', '<p>Le découpage n\'est pas cosmétique : c\'est ce qui permet à '
  + 'deux personnes d\'éditer deux scènes différentes sans conflit.</p>')

  + advancedHelp('Il n\'y a pas de format 2D séparé', '<p>Un jeu 2D s\'enregistre dans un <code>.p3d</code> comme le reste, parce que la 2D est un '
  + '<b>sous-arbre</b> de la scène et non un autre document. Le manifeste porte à la place un '
  + '<b>kind</b> — <code>2d</code>, <code>3d</code> ou <code>mixte</code> — <b>déduit du '
  + 'contenu</b>, jamais déclaré. Un projet 2D auquel on '
  + 'ajoute un objet 3D devient simplement « mixte » et continue de s\'ouvrir ; un format séparé '
  + 'devrait refuser l\'objet ou mentir sur le genre. Le message de chargement annonce le genre du projet. '
  + '<b>Fichier → Nouveau → 🎮 Projet 2D…</b> remplace la scène de départ 3D par un décor de '
  + 'tuiles avec son sol et une caméra 2D déjà cadrée.</p>')

  + advancedHelp('Le build est allégé de ce que la scène n\'utilise pas', '<p>Un platformer en sprites n\'embarque pas le moteur de physique 3D ; un jeu 3D n\'embarque pas '
  + 'le solveur 2D, les tuiles ni la caméra 2D. Le message d\'export <b>dit ce qui a été retiré</b> '
  + 'et pourquoi — un allègement silencieux serait impossible à relire le jour où il se trompe.</p>'
  + '<p>Un build tout embarqué porte <b>2,48 Mo</b> de code avant compression et '
  + '<b>' + TAGS_BUILD_FULL + ' balises de script</b>. <b>17 modules</b> en sont retirables, '
  + '<b>449 Ko</b> en tout : c\'est le <b>plafond</b>, et il ne dépend d\'aucune scène. Un platformer '
  + '2D en atteint <b>341 Ko</b> et descend à <b>81 balises</b>.</p>'
  + '<p class="help-trap"><b>Ce que vous gagnerez dépend de votre scène, pas du moteur.</b> Le '
  + 'chiffre que vous lirez à l\'export sera le vôtre : un jeu 3D avec des animations garde quatre '
  + 'modules qu\'un jeu 2D retire, et l\'inverse. C\'est pourquoi le message d\'export les '
  + '<b>nomme</b> au lieu d\'annoncer un total.</p>'
  + '<p>Le reste n\'est retirable par personne : <b>49 % du code</b> sont three.js et le moteur de '
  + 'rendu WebGPU, que tout jeu instancie — un jeu 2D compris, puisque c\'est le même renderer qui '
  + 'dessine ses sprites.</p>'
  + '<p>Deux modules se décident sur le <b>texte de vos scripts</b>, parce que rien d\'autre dans une '
  + 'scène ne le dit : le multijoueur (<code>api.network</code>, <code>api.isAuthority</code>) et le '
  + 'contrôleur de personnage (<code>api.moveCharacter</code>). La recherche est volontairement '
  + 'grossière — un simple commentaire citant le mot suffit à embarquer le module.</p>'
  + '<p><b>Un module ne devient facultatif qu\'après relevé de tous ses sites '
  + 'd\'appel.</b> Et la question n\'est pas « ce chemin tourne-t-il souvent ? » mais « quelle est son '
  + 'entrée, et se garde-t-elle ? » — la plupart des entrées du moteur se gardaient déjà elles-mêmes. '
  + 'Poser la question dans le mauvais sens avait laissé 101 Ko sur la table pendant une version.</p>')
  + '<h3>Voir aussi</h3><ul>'
  + '<li>' + linkHelp('build', 'Publier un jeu') + ' — les exports Web, bureau et en ligne</li>'
  + '<li>' + linkHelp('scenes', 'Plusieurs scènes') + '</li>'
  + '</ul>';
}},

{id:'data-assets', part:'workflows', section:'Assets', title:'Tables de contenu (données)', level:'both',
 summary:'Ranger les données du jeu (ennemis, objets, dialogues) dans un asset que les scripts lisent.',
 anchors:[
   {f:'js/assets.js', c:"{kind: 'data', label: '🗂 Table de contenu',"},
   {f:'js/help-content.js', c:"{name:'data', sig:'api.data(name)'"}
 ],
 html:function(){ return ''
  + essentialHelp('<p>Une <b>table de contenu</b> garde les chiffres du jeu hors des scripts : les points de vie d\'un ennemi, le prix d\'un objet, les répliques d\'un dialogue. Un script la lit par son nom avec <code>api.data(nom)</code>.</p>')
  + '<h3>Créer et lire une table</h3>'
  + stepsHelp([
      'Dans le panneau Projet, cliquez sur <b>＋</b> puis <b>🗂 Table de contenu</b>. L\'éditeur de la table s\'ouvre aussitôt.',
      'Remplissez la table, puis renommez l\'asset : c\'est ce nom que le script citera.',
      'Dans un script, lisez-la : <code>const ennemis = api.data(\'ennemis\');</code>.',
      'Pour la retoucher plus tard, double-cliquez sur l\'asset, ou passez par <b>Fenêtres → Table de contenu</b>.'
    ])
  + advancedHelp('Cache et partage', '<p>Le contenu est analysé <b>une fois</b> puis mis en cache : appeler <code>api.data</code> à chaque image ne coûte rien. La table est un asset comme un autre : elle part dans le build et, en mode dossier projet, s\'écrit sur disque.</p>')
  + tipHelp('Mettre le réglage d\'équilibrage dans une table plutôt que dans le script permet de le modifier sans toucher au code — et de le confier à quelqu\'un qui n\'en écrit pas.')
  + '<h3>Voir aussi</h3><ul>'
  + '<li>' + linkHelp('assets-made', 'Fabriquer des assets sans fichiers') + '</li>'
  + '<li>' + linkHelp('scripts-api', 'L\'API de scripts') + '</li>'
  + '<li>' + linkHelp('panel-project', 'Le panneau Projet') + '</li>'
  + '</ul>';
}},

{id:'prefabs', part:'workflows', section:'Assets', title:'Prefabs et overrides', level:'both',
 summary:'Réutiliser un objet configuré, modifier une instance, appliquer ou annuler ses écarts.',
 anchors:[
   {f:'js/ui.js', c:"{label:'Créer un prefab', mutates:true"},
   {f:'js/ui/panels-inspector.js', c:"label: '⇪ Appliquer au prefab'"},
   {f:'js/ui/panels-inspector.js', c:"label: '🧬 Créer une variante'"},
   {f:'js/prefabs.js', c:'export function resetInstance(){'}
 ],
 html:function(){ return ''
  + essentialHelp('<p>Un <b>prefab</b> est un objet tout prêt — maillage, composants, scripts, enfants — enregistré comme asset. Chaque copie posée dans une scène est une <b>instance liée</b> : modifiez le prefab, toutes les instances suivent.</p>')
  + '<h3>Créer un prefab</h3>'
  + stepsHelp([
      'Construisez l\'objet dans la scène et réglez ses composants.',
      'Sélectionnez-le, puis <b>Édition → Créer un prefab</b>. Un asset prefab apparaît dans le panneau Projet ; l\'objet de la scène en devient la première instance.',
      'Glissez le prefab depuis le panneau Projet dans la vue pour poser d\'autres instances.'
    ])
  + '<h3>Modifier une instance</h3>'
  + '<p>L\'inspecteur d\'une instance porte une section <b>Prefab lié</b>. Dès que l\'instance s\'écarte de son prefab, la source affiche <b>● modifié</b> et deux boutons s\'activent :</p>'
  + arrayHelp(['Bouton', 'Effet'], [
      ['<b>⇪ Appliquer au prefab</b>', 'Pousse l\'état de cette instance dans le prefab et synchronise les autres instances.'],
      ['<b>⟲ Réinitialiser l\'instance</b>', 'Reprend l\'état du prefab. La transform racine (position, rotation, échelle) est conservée.'],
      ['<b>🧬 Créer une variante</b>', 'Crée un nouveau prefab dérivé ; cette instance y est rattachée.'],
      ['<b>✂ Rendre unique</b>', 'Coupe le lien : l\'objet redevient un objet ordinaire.']
    ])
  + advancedHelp('Comment l\'écart est détecté', '<p>L\'éditeur compare une <b>empreinte</b> de l\'instance et du prefab : sérialisation normalisée, sans ids, sans noms ni transform racine, flottants arrondis. Déplacer l\'instance ne la rend donc pas « modifiée » ; changer une couleur, oui.</p>'
    + '<p><b>Fichier → Bibliothèque de prefabs…</b> propose des prefabs tout faits à importer.</p>')
  + trapHelp('<b>Appliquer ne descend pas vers les variantes.</b> Appliquer sur un prefab de base ne met pas à jour ses variantes : elles sont des prefabs indépendants, qui gardent seulement la trace de leur base.')
  + '<h3>Voir aussi</h3><ul>'
  + '<li>' + linkHelp('scenes', 'Plusieurs scènes et sous-scènes') + '</li>'
  + '<li>' + linkHelp('panel-inspector', 'L\'inspecteur') + '</li>'
  + '<li>' + linkHelp('panel-project', 'Le panneau Projet') + '</li>'
  + '</ul>';
}},

{id:'scenes', part:'workflows', section:'Jeu', title:'Plusieurs scènes, sous-scènes', level:'both',
 summary:'Découper un jeu en scènes, passer de l\'une à l\'autre, et réutiliser une scène dans une autre.',
 anchors:[
   {f:'js/project.js', c:"document.getElementById('btn-scene-add').addEventListener('click', addScene);"},
   {f:'js/project.js', c:"setStatus('Le projet doit garder au moins une scène', 2500)"},
   {f:'js/ui.js', c:"{label:'◈ Instancier une sous-scène'"},
   {f:'js/subscenes.js', c:'export const SS_DEPTH_MAX = 5;'}
 ],
 html:function(){ return ''
  + essentialHelp('<p>Un projet contient <b>plusieurs scènes</b> : un menu, des niveaux, un écran de fin. La liste <b>Scènes</b> en haut du panneau Hiérarchie les montre ; un clic en ouvre une. En jeu, une scène passe à une autre par un script ou un événement.</p>')
  + '<h3>Gérer les scènes</h3>'
  + stepsHelp([
      'Cliquez sur <b>＋</b> à droite du titre <b>Scènes</b> pour ajouter une scène au projet.',
      'Cliquez sur une scène pour l\'ouvrir ; double-cliquez pour la renommer.',
      'La croix d\'une scène la supprime, après confirmation. Le projet garde toujours au moins une scène.'
    ])
  + '<h3>Changer de scène en jeu</h3>'
  + '<p>Deux chemins, au choix : <code>api.changeScene(\'Niveau 2\')</code> dans un script, ou l\'action <b>Charger la scène…</b> d\'un ' + linkHelp('visual-events', 'événement « Quand… Alors… »') + ', sans code.</p>'
  + '<h3>Les sous-scènes</h3>'
  + '<p>Une <b>sous-scène</b> pose le contenu d\'une AUTRE scène du projet à l\'intérieur de la scène courante, comme un prefab géant : une maison meublée, un quartier entier.</p>'
  + stepsHelp([
      'Construisez le contenu réutilisable dans sa propre scène.',
      'Ouvrez la scène qui doit l\'accueillir, puis <b>Objet → ◈ Instancier une sous-scène</b> (le projet doit avoir au moins deux scènes).',
      'Dans l\'inspecteur, choisissez la <b>Scène source</b>. Une scène ne peut pas s\'instancier elle-même : elle n\'est pas dans la liste.'
    ])
  + advancedHelp('Ce qui est enregistré, et les overrides', '<p>Seul le <b>nœud</b> de sous-scène est sérialisé : la référence à la source et ses overrides. Le contenu est régénéré depuis la scène source — modifier la source met à jour toutes les instances.</p>'
    + '<p>Les <b>overrides</b> se capturent tout seuls : déplacer ou masquer un enfant d\'instance enregistre l\'écart (transform et visibilité) sans rien demander. Changer de scène source les efface, puisqu\'ils visaient d\'autres objets.</p>'
    + '<p>L\'imbrication est limitée à <b>5 niveaux</b>, et une boucle (A contient B qui contient A) est détectée.</p>')
  + '<h3>Voir aussi</h3><ul>'
  + '<li>' + linkHelp('component-SubScene', 'La fiche Sous-scène') + '</li>'
  + '<li>' + linkHelp('prefabs', 'Prefabs et overrides') + '</li>'
  + '<li>' + linkHelp('panel-hierarchy', 'La hiérarchie') + '</li>'
  + '</ul>';
}},

{id:'lighting', part:'workflows', section:'Rendu', title:'Lumières et ombres', level:'both',
 summary:'Poser des lumières, régler leurs ombres, et choisir entre éclairage temps réel et cuit.',
 anchors:[
   {f:'js/objects.js', c:"{type:'directional', label:'Directionnelle', icon:'☀️ '}"},
   {f:'js/objects.js', c:"{type:'point', label:'Lumière ponctuelle', icon:'💡 '}"},
   {f:'js/components/component-light.js', c:"static get typeName() { return 'Light'; }"},
   {f:'js/ui/panels-settings.js', c:"label: 'Finesse des ombres', type: 'choice',"}
 ],
 html:function(){ return ''
  + essentialHelp('<p>Trois types de lumière : <b>☀️ Directionnelle</b> (le soleil, rayons parallèles), <b>💡 Lumière ponctuelle</b> (une ampoule) et <b>🔦 Spot</b> (un cône). Chacune est un objet portant le composant <b>Lumière</b>, et projette des ombres.</p>')
  + '<h3>Éclairer une scène</h3>'
  + stepsHelp([
      'Menu <b>Objet</b> (ou la barre d\'outils pour la lumière ponctuelle) : créez la lumière voulue.',
      'Placez-la au gizmo. Pour une directionnelle et un spot, c\'est l\'orientation qui compte : ils visent une cible.',
      'Réglez couleur, intensité et portée dans l\'inspecteur, section <b>Lumière</b>.',
      'Pour l\'ambiance générale (ciel, lumière d\'ambiance, brouillard), passez par le panneau ' + linkHelp('panel-environment', 'Environnement') + '.'
    ])
  + advancedHelp('Les ombres', '<p>Une lumière créée projette des ombres. Leur qualité se règle pour tout le projet dans <b>Fichier → ⚙ Paramètres du projet…</b> : <b>Portée des ombres</b> et <b>Finesse des ombres</b> (1024, 2048 ou 4096). Un texel d\'ombre couvre « 2 × portée ÷ résolution » au sol : doubler la finesse revient à diviser la portée par deux, au prix de mémoire vidéo.</p>'
    + '<p>Le menu <b>Affichage → Ombres</b> les masque dans la vue de l\'éditeur seulement, pour alléger le travail.</p>')
  + advancedHelp('Temps réel ou cuit', '<p>Une lumière temps réel coûte à chaque image. Pour un décor immobile, ' + linkHelp('lightmaps', 'cuire des lightmaps') + ' donne des ombres plus douces pour un coût nul en jeu, et les ' + linkHelp('probes', 'sondes de réflexion') + ' donnent les reflets.</p>')
  + '<h3>Voir aussi</h3><ul>'
  + '<li>' + linkHelp('component-Light', 'La fiche Lumière') + '</li>'
  + '<li>' + linkHelp('component-PostVolume', 'Le volume de post-traitement') + '</li>'
  + '<li>' + linkHelp('materials-maps', 'Les cartes PBR') + '</li>'
  + '</ul>';
}},

{id:'shader-graph', part:'workflows', section:'Matériaux', title:'Le graphe de shader', level:'advanced',
 summary:'Construire un shader en reliant des nœuds, puis l\'utiliser dans un matériau.',
 anchors:[
   {f:'js/assets.js', c:"{kind: 'graphShader', label: '🧩 Graphe de shader',"},
   {f:'js/ui.js', c:"{label:'Graphe de shader', action:function(){ openLastWindowShader(); }}"},
   {f:'js/import-settings.js', c:"ipSelect('ip-mat-shader', 'Shader', [['', '— PBR classique —']]"}
 ],
 html:function(){ return ''
  + essentialHelp('<p>Le <b>graphe de shader</b> est l\'éditeur nodal de l\'éditeur, calqué sur Shader Graph d\'Unity : on relie des nœuds (nombres, textures, opérations) jusqu\'aux sorties du matériau. Le graphe est la <b>logique</b> ; un <b>matériau</b> qui l\'utilise en fournit les <b>valeurs</b>.</p>')
  + '<h3>Créer un shader et l\'utiliser</h3>'
  + stepsHelp([
      'Dans le panneau Projet, <b>＋ → 🧩 Graphe de shader</b>.',
      'Ouvrez-le (double-clic, ou <b>Fenêtres → Graphe de shader</b>) : il s\'ouvre dans sa propre fenêtre.',
      'Clic droit dans le plan pour ajouter un nœud, puis tirez d\'un port à l\'autre pour les relier, jusqu\'aux sorties.',
      'Dans l\'inspecteur d\'un matériau, champ <b>Shader</b> : remplacez <b>— PBR classique —</b> par votre graphe.',
      'Les nœuds de paramètre du graphe deviennent des champs du matériau : deux matériaux peuvent partager un graphe avec des valeurs différentes.'
    ])
  + advancedHelp('Ce qui part dans le jeu', '<p>Le graphe est construit avec de vraies fonctions TSL de three.js : aucun shader réinventé. Le module qui <b>rend</b> un graphe est embarqué dans le build ; l\'éditeur nodal, lui, reste dans l\'éditeur. Le build retire même le module de rendu quand aucun matériau n\'utilise de graphe.</p>')
  + trapHelp('Un graphe n\'est jamais affecté directement à un objet : c\'est le <b>matériau</b> qui le référence. Glisser un graphe sur un objet ne suffit pas — passez par un matériau.')
  + '<h3>Voir aussi</h3><ul>'
  + '<li>' + linkHelp('materials-maps', 'Les cartes PBR') + '</li>'
  + '<li>' + linkHelp('materials-reference', 'Toutes les propriétés d\'un matériau') + '</li>'
  + '<li>' + linkHelp('component-Mesh', 'Le maillage') + '</li>'
  + '</ul>';
}},

{id:'collisions-2d', part:'workflows', section:'2D', title:'Collisions 2D', level:'both',
 summary:'Donner une zone de collision à un sprite et la régler à la souris dans la vue.',
 anchors:[
   {f:'js/collider2d-handles.js', c:'const PICK_PX = 9;'},
   {f:'js/collider2d-handles.js', c:'if(e.ctrlKey){ p.x = Math.round(p.x * 4) / 4; p.y = Math.round(p.y * 4) / 4; }'},
   {f:'js/collider2d-handles.js', c:"setStatus('Collider 2D : ' + c.l + ' × ' + c.h"}
 ],
 html:function(){ return ''
  + essentialHelp('<p>Un objet 2D bute contre les autres quand il a un <b>Collider 2D</b>. Son contour vert, dans la vue, est sa zone de collision : on la règle en tirant ses <b>poignées</b> à la souris, comme l\'« Edit Collider » d\'Unity.</p>')
  + '<h3>Régler une zone de collision</h3>'
  + stepsHelp([
      'Sélectionnez le sprite, puis ajoutez le composant <b>Collider 2D</b> dans l\'inspecteur.',
      'Dans la vue, le contour vert apparaît avec ses poignées : quatre coins et quatre milieux de côté. Le curseur change au survol d\'une poignée.',
      'Tirez une poignée : le côté opposé reste en place. La barre d\'état affiche la taille et le décalage en cours.',
      'Maintenez <kbd>Ctrl</kbd> pendant le glisser pour aimanter au quart d\'unité (une case de grille 2D vaut 1 unité).',
      'Ajoutez un <b>Corps rigide 2D</b> pour que l\'objet tombe et soit poussé ; sans lui, le collider est un obstacle immobile.'
    ])
  + advancedHelp('Détails du geste', '<p>Une poignée se saisit à 9 pixels écran près. Le glisser est annulable d\'un seul <kbd>Ctrl + Z</kbd>, et l\'inspecteur se met à jour au relâchement. Les poignées n\'apparaissent que si le composant est actif.</p>')
  + '<h3>Voir aussi</h3><ul>'
  + '<li>' + linkHelp('component-Collider2D', 'La fiche Collider 2D') + '</li>'
  + '<li>' + linkHelp('component-Rigidbody2D', 'Le corps rigide 2D') + '</li>'
  + '<li>' + linkHelp('component-CharacterController2D', 'Le contrôleur de personnage 2D') + '</li>'
  + '<li>' + linkHelp('game-2d', 'Faire un jeu 2D') + '</li>'
  + '</ul>';
}},

{id:'visual-events', part:'workflows', section:'Jeu', title:'Événements « Quand… Alors… »', level:'beginner',
 summary:'Faire réagir le jeu sans écrire de code : une règle « Quand… », une liste d\'actions « Alors… ».',
 anchors:[
   {f:'js/ui/panels-components.js', c:"addLabel: '⚡ Ajouter un événement'"},
   {f:'js/ui/panels-components.js', c:"['entreeTrigger', 'Un objet tagué ENTRE dans ce volume']"},
   {f:'js/copilot.js', c:"export const EVENT_ACTION_TYPES = ['montrer', 'hide', 'toggle', 'destroy', 'emit', 'jouerSon',"}
 ],
 html:function(){ return ''
  + essentialHelp('<p>Le composant <b>Événements</b> pose des règles sans une ligne de code : <b>Quand</b> le joueur entre dans cette zone, <b>Alors</b> ouvrir la porte et jouer un son. Une règle a un déclencheur et une liste d\'actions exécutées dans l\'ordre.</p>')
  + '<h3>Écrire une règle</h3>'
  + stepsHelp([
      'Sélectionnez l\'objet, ajoutez le composant <b>Événements</b>.',
      'Cliquez sur <b>⚡ Ajouter un événement</b> et choisissez le <b>Quand</b>.',
      'Pour un volume, tapez le <b>Tag guetté</b> (par exemple <code>joueur</code>) : seul un objet portant ce tag déclenche la règle.',
      'Cliquez sur <b>→ Ajouter une action</b>, choisissez-la, indiquez la cible (vide = cet objet) et la valeur si l\'action en demande une.',
      'Lancez <b>▶ Jouer</b> pour essayer.'
    ])
  + '<h3>Les déclencheurs</h3>'
  + arrayHelp(null, [
      ['Au démarrage', 'Au lancement de la scène.'],
      ['Un objet tagué ENTRE / SORT de ce volume', 'Seul un objet portant le tag guetté déclenche la règle.'],
      ['Au clic sur cet objet', 'Un clic du joueur sur l\'objet.'],
      ['À la réception d\'un événement', 'Un nom d\'événement émis par une autre règle ou par un script.']
    ])
  + '<h3>Les actions</h3>'
  + arrayHelp(null, [
      ['Rendre visible / invisible, Basculer la visibilité', 'Montre ou cache la cible.'],
      ['Détruire', 'Retire la cible de la scène.'],
      ['Émettre l\'événement…', 'Déclenche les règles « À la réception » de ce nom : de quoi chaîner.'],
      ['Jouer le son…', 'Joue un son du projet.'],
      ['Émettre des particules…', 'Une bouffée de particules sur la cible.'],
      ['Afficher le message…', 'Affiche un message au joueur.'],
      ['Attendre… (secondes)', 'Retarde les actions suivantes.'],
      ['Charger la scène…', 'Passe à une autre scène du projet.'],
      ['Régler le paramètre d\'animation…', 'Change un paramètre de la machine à états.']
    ])
  + advancedHelp('Événements et scripts', '<p>Le bus d\'événements est commun aux règles et aux scripts : un script peut émettre un événement qu\'une règle écoute, et inversement. Le copilote IA sait aussi écrire ces règles.</p>')
  + '<h3>Voir aussi</h3><ul>'
  + '<li>' + linkHelp('component-Events', 'La fiche Événements') + '</li>'
  + '<li>' + linkHelp('component-Tag', 'Le tag') + '</li>'
  + '<li>' + linkHelp('physics', 'Physique et colliders') + '</li>'
  + '<li>' + linkHelp('scripts', 'Les scripts') + '</li>'
  + '</ul>';
}},

{id:'localization', part:'workflows', section:'Interface de jeu', title:'Traduire le jeu', level:'both',
 summary:'Afficher le texte du jeu dans la langue du joueur, avec des clés de traduction.',
 anchors:[
   {f:'js/locale.js', c:"export const LOCALES_DEFAULT = {default: 'fr', tables: {fr: {}}};"},
   {f:'js/locale.js', c:"containerDiv.querySelectorAll('[data-t]')"},
   {f:'js/ui/panels-settings.js', c:"{ id: 'ps-locales', title: 'Langues du jeu', fields: ["},
   {f:'js/ui/panels-settings.js', c:"addLabel: '＋ Nouvelle clé'"},
   {f:'js/help-content.js', c:"{name:'setLocale', sig:'api.setLocale(code)'"}
 ],
 html:function(){ return ''
  + essentialHelp('<p>Le texte que le <b>joueur</b> lit (menus, dialogues, objectifs) se traduit par <b>clés</b> : le jeu demande <code>menu.start</code>, '
  + 'la table de la langue active répond « Commencer » ou « Start ». Les tables se remplissent dans '
  + '<b>Fichier → ⚙ Paramètres du projet…</b>, section <b>Langues du jeu</b>. L\'interface de l\'éditeur, elle, reste en français.</p>')
  + '<h3>Traduire un jeu en deux langues</h3>'
  + stepsHelp([
      'Ouvrez <b>Fichier → ⚙ Paramètres du projet…</b>, section <b>Langues du jeu</b>.',
      'Dans <b>Langues</b>, tapez les codes séparés par des virgules : <code>fr, en</code>. Réglez la <b>Langue par défaut</b>.',
      'Cliquez <b>＋ Nouvelle clé</b> et nommez le texte, par exemple <code>menu.start</code>.',
      'Dans <b>Langue éditée ici</b>, tapez <code>fr</code> et remplissez les textes ; puis tapez <code>en</code> et remplissez-les en anglais.',
      'Dans un Document UI, écrivez <code>&lt;button data-t="menu.start"&gt;&lt;/button&gt;</code> ; dans un script, <code>api.t(\'menu.start\')</code>.',
      'Pour un menu de langues : <code>api.locales()</code> donne les langues du projet, <code>api.setLocale(code)</code> en change et mémorise le choix.'
    ])
  + tipHelp('Substitution : <code>api.t(\'score\', {n: 42})</code> sur le texte « Score : {n} » rend « Score : 42 ».')
  + trapHelp('<b>Une clé manquante s\'affiche telle quelle</b> : <code>menu.start</code> en toutes lettres à l\'écran, et un avertissement unique en console. '
  + 'C\'est voulu — un bouton vide passerait inaperçu jusque chez le joueur.')
  + trapHelp('<b>Retirer un code du champ Langues efface ses traductions.</b> Le projet garde toujours au moins une langue ; '
  + '<kbd>Ctrl</kbd> + <kbd>Z</kbd> reste le seul recours. Supprimer une clé la retire de <b>toutes</b> les langues.')
  + advancedHelp('Où vivent les tables', '<p>Dans les réglages du <b>projet</b> (<code>settings.locales</code>) : elles voyagent avec le projet, '
  + 'partent dans le build et se relisent dans l\'éditeur. « Langue éditée ici » est un réglage de votre poste, pas du projet : '
  + 'deux personnes peuvent traduire deux langues en même temps.</p>'
  + '<p>Il n\'existe pas encore de bouton pour exporter une langue en fichier <code>.json</code> à confier à un traducteur : '
  + 'le moteur sait le faire (<code>js/locale.js</code>), mais aucun menu ne l\'appelle. En attendant, les traductions se saisissent dans le panneau.</p>')
  + advancedHelp('Le choix de la langue au démarrage', '<p>Trois sources, dans l\'ordre : ce que le joueur a choisi lors d\'une partie précédente, ce qu\'annonce son navigateur, puis la langue par défaut du projet. <code>en-GB</code> retombe sur <code>en</code> si <code>en-GB</code> n\'existe pas.</p>'
    + '<p><code>data-t</code> affiche un texte <b>fixe</b> à traduire ; <code>data-bind</code> affiche une <b>valeur</b> calculée par un script. Un libellé de bouton est le premier, un score le second.</p>')
  + '<h3>Voir aussi</h3><ul>'
  + '<li>' + linkHelp('game-ui', 'L\'interface de jeu') + '</li>'
  + '<li>' + linkHelp('component-UIDocument', 'La fiche Interface (UI)') + '</li>'
  + '<li>' + linkHelp('scripts-api', 'L\'API de scripts') + '</li>'
  + '</ul>';
}},

{id:'build', part:'workflows', section:'Publication', title:'Publier un jeu', level:'both',
 summary:'Exporter un jeu web jouable, un projet d\'application de bureau, ou le publier en ligne.',
 anchors:[
   {f:'js/ui.js', c:"{label:'🎮 Build Web jouable (.zip)', active:projectHasContent, action:exportBuildWeb}"},
   {f:'js/ui.js', c:"{label:'🖥 Projet bureau (Electron, .zip)', active:projectHasContent, action:exportBuildDesktop}"},
   {f:'js/ui.js', c:"{label:'🌐 Publier en ligne',"},
   {f:'js/build.js', c:"const FILE_PROTOCOL_MESSAGE = 'Export impossible en file://"},
   {f:'js/build-trimming.js', c:'export function trimmingBuild(data){'}
 ],
 html:function(){ return ''
  + essentialHelp('<p>Le menu <b>Fichier → Exporter</b> transforme le projet en jeu que n\'importe qui peut lancer, sans l\'éditeur. Le jeu publié partage le code de <b>▶ Jouer</b> : ce que vous voyez à l\'aperçu est ce qui sera publié.</p>')
  + '<h3>Trois façons de publier</h3>'
  + arrayHelp(['Menu', 'Ce que vous obtenez'], [
      ['<b>Fichier → Exporter → 🎮 Build Web jouable (.zip)</b>', 'Une archive autonome : dézippez, puis ouvrez la page du jeu d\'un double-clic, sans serveur. Elle se sert depuis n\'importe quel hébergement statique.'],
      ['<b>Fichier → Exporter → 🖥 Projet bureau (Electron, .zip)</b>', 'Le même jeu dans un projet d\'application de bureau. Dézippez, puis <code>npm install</code> et <code>npm run dist</code> pour obtenir l\'exécutable. Lisez <code>LISEZMOI.md</code> avant de livrer.'],
      ['<b>Fichier → 🌐 Publier en ligne</b>', 'Construit et publie sur l\'hébergement cloud, sans archive à manipuler ; le lien reste le même d\'une publication à l\'autre. Actif seulement pour un projet hébergé.']
    ])
  + stepsHelp([
      'Vérifiez le jeu avec <b>▶ Jouer</b>.',
      'Choisissez l\'export dans <b>Fichier → Exporter</b>.',
      'Lisez le message de fin dans la barre d\'état : il donne la taille et nomme les modules retirés.'
    ])
  + advancedHelp('Allègement et numéro de version', '<p>Le build n\'embarque que les modules dont vos scènes ont besoin : un jeu 2D n\'emporte pas la physique 3D. Le détail et les chiffres sont sur ' + linkHelp('project', 'la page du format .p3d') + '.</p>'
    + '<p>Le jeu affiche en bas à droite le numéro de version du moteur et la date du build ; <b>Fichier → Exporter → Numéro de version affiché dans le jeu</b> le décoche.</p>'
    + '<p>L\'export bureau ne produit pas l\'exécutable lui-même : l\'éditeur tourne dans un onglet et ne lance pas de processus. Il produit le projet et les deux commandes qui le compilent.</p>')
  + trapHelp('<b>L\'export échoue si l\'éditeur est ouvert en <code>file://</code>.</b> Le build relit les fichiers du moteur : servez l\'éditeur par un serveur local (par exemple <code>python -m http.server</code>) puis réessayez.')
  + '<h3>Voir aussi</h3><ul>'
  + '<li>' + linkHelp('steam', 'Publier sur Steam') + '</li>'
  + '<li>' + linkHelp('project', 'Le format .p3d') + '</li>'
  + '<li>' + linkHelp('menus', 'Les menus') + '</li>'
  + '</ul>';
}},

{id:'steam', part:'workflows', section:'Publication', title:'Steam : succès, statistiques, cloud, manettes', level:'advanced',
 summary:'Brancher un export bureau sur Steam : succès, statistiques, Steam Cloud et Steam Input.',
 anchors:[
   {f:'js/build-desktop.js', c:'export const STEAM_TEST_APPID = 480;'},
   {f:'js/build-desktop.js', c:"export const STEAM_ACTION_SET = 'InGame';"},
   {f:'js/steam-bridge.js', c:'available: function(){ return !!steamHandle(); },'},
   {f:'js/steam-bridge.js', c:"return typeof name === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(name);"}
 ],
 html:function(){ return ''
  + essentialHelp('<p>Steam passe par l\'<b>export bureau</b> : le SDK Steamworks est natif et ne tourne que dans l\'application, jamais dans un navigateur. Vos scripts appellent <code>api.steam</code> ; hors Steam (éditeur, web), tout est <b>inerte</b> et rend <code>false</code> ou <code>0</code> — le même script tourne partout.</p>')
  + '<h3>Brancher le jeu sur Steam</h3>'
  + stepsHelp([
      '<b>Fichier → Exporter → 🖥 Projet bureau (Electron, .zip)</b>, puis dézippez.',
      '<b>Essai</b> : <code>steam_appid.txt</code> contient <code>480</code>, l\'application de test « Spacewar ». Client Steam ouvert, <code>npm start</code> suffit pour essayer. Remplacez ensuite ce numéro par votre propre identifiant.',
      '<b>Succès et statistiques</b> : déclarez-les dans Steamworks, puis appelez-les par leur identifiant : <code>api.steam.unlockAchievement(\'ACH_BOSS_1\')</code>, <code>api.steam.addStat(\'monstres_tues\', 1)</code>.',
      '<b>Steam Cloud</b> : activez-le dans Steamworks. <code>api.save</code> / <code>api.load</code> y écrivent sans rien configurer côté jeu.',
      '<b>Steam Input</b> : déposez <code>steam/game_actions.vdf</code> dans Steamworks. Chaque action de la table d\'entrées du projet devient une action Steam du même nom, que le joueur peut rebrancher.'
    ])
  + advancedHelp('Le détail de l\'API', '<p><code>available()</code> dit si le client Steam est joignable. Aussi : <code>playerName()</code>, <code>language()</code>, <code>onDeck()</code> (Steam Deck) et <code>controller()</code>, le type de manette vu par Steam Input (<code>PS5Controller</code>, <code>SteamDeckController</code>…) pour afficher les bons glyphes.</p>'
    + '<p>Les statistiques sont <b>entières</b>. Un identifiant de succès ou de statistique n\'accepte que lettres, chiffres, <code>_</code>, <code>.</code> et <code>-</code> : un nom invalide est refusé avec un avertissement plutôt que d\'échouer en silence chez Steam.</p>'
    + '<p>À la lecture d\'une sauvegarde, la copie cloud gagne si elle existe ; sinon on retombe sur <code>localStorage</code>, qui reste écrit à chaque fois.</p>'
    + '<p>Steam Input déclare un seul jeu d\'actions, <code>InGame</code>, et les sticks <code>Move</code> et <code>Look</code> seulement si un axe du projet a une source analogique.</p>')
  + trapHelp('<b><code>clearAchievement</code> est réservé aux essais.</b> Il reverrouille un succès : un joueur ne doit jamais pouvoir le déclencher.')
  + '<h3>Voir aussi</h3><ul>'
  + '<li>' + linkHelp('build', 'Publier un jeu') + '</li>'
  + '<li>' + linkHelp('scripts-api', 'L\'API de scripts') + '</li>'
  + '<li>' + linkHelp('settings', 'Les réglages') + '</li>'
  + '</ul>';
}},

];
