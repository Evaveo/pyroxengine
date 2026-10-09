// ---------- Aide de l'éditeur : fiches de composants (3d) ----------
import { advancedHelp, arrayHelp, defaultHelp, essentialHelp, linkHelp, propsHelp, stepsHelp, termHelp, tipHelp, trapHelp } from './help-format.js';

// Les étapes communes à tout composant qu'on ajoute soi-même depuis l'inspecteur.
function addSteps(label, extra){
  return stepsHelp([
    'Sélectionnez l\'objet dans la ' + linkHelp('panel-hierarchy', 'Hiérarchie') + ' ou dans la vue 3D.',
    'Dans l\'' + linkHelp('panel-inspector', 'Inspecteur') + ', cliquez sur <b>Ajouter un composant</b>.',
    'Choisissez <b>' + label + '</b> dans la liste.'
  ].concat(extra || []));
}

// Les composants « index » : posés automatiquement, absents de la liste d'ajout.
function internalNote(how){
  return '<p>Ce composant n\'apparaît pas dans la liste <b>Ajouter un composant</b> : il est posé '
    + 'automatiquement ' + how + '.</p>';
}

// La section « Exemples de scripts » d'une fiche : [phrase d'intro, [lignes de code]] par exemple.
// Le code est échappé ici (< > &) pour rester lisible dans la source.
function escapeCode(s){ return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function scriptExamples(list){
  return '<h3>Exemples de scripts</h3>' + list.map(function(e){
    return '<p>' + e[0] + '</p><pre><code>' + escapeCode(e[1].join('\n')) + '</code></pre>';
  }).join('');
}

export const PAGES_COMPONENTS_3D = [

  {id:'component-Mesh', part:'components', section:'Rendu', title:'Maillage (Mesh)', level:'both',
   summary:'Une forme 3D visible (cube, sphère, maillage importé…) et son matériau.',
   anchors:[
     {f:'js/components/component-mesh.js', c:"static get typeName() { return 'Mesh'; }"},
     {f:'js/components/component-mesh.js', c:"static get description(){ return 'Forme 3D visible'; }"}
   ],
   html:function(){ return ''
     + essentialHelp('<p>Le composant <b>Maillage</b> rend un objet visible : il porte une forme '
       + '(sa géométrie) et un matériau (couleur, lissage, métal…). Tous les objets primitifs créés '
       + 'depuis le menu de création en ont un.</p>')
     + '<h3>Ajouter le composant</h3>'
     + '<p>Le plus simple est de créer directement une primitive (cube, sphère…) : le maillage est déjà '
     + 'en place. Sur un objet vide :</p>'
     + addSteps('Maillage')
     + '<h3>Propriétés</h3>'
     + propsHelp([
       ['Géométrie', 'geo', 'cube', 'La forme : cube, sphère, cylindre, cône, tore, plan, étoile, losange, pyramide, vague, rocher, capsule, ou personnalisée.'],
       ['Mesh importé', 'geoAsset', '', 'Un maillage venu d\'un asset, à la place d\'une primitive.'],
       ['Couleur', 'color', '', 'La couleur de base du matériau.'],
       ['Lissage / Métallique / Émissif / Opacité', 'mat', '', 'Les réglages du matériau.'],
       ['Non éclairé', 'notEclaire', 'non', 'Ignore les lumières : la couleur s\'affiche telle quelle.'],
       ['Projette une ombre', 'ombreProjetee', 'oui', 'L\'objet projette une ombre.'],
       ['Reçoit les ombres', 'ombreRecue', 'oui', 'Les ombres des autres objets se dessinent dessus.']
     ])
     + '<h3>Utilisation</h3>'
     + tipHelp('<p>Pour partager un même matériau entre plusieurs objets, utilisez <b>Extraire comme '
       + 'asset</b> : il devient un asset du ' + linkHelp('panel-project', 'panneau Projet') + ', et '
       + '<b>Éditer le matériau (tous les usages)</b> modifie alors tous les objets qui l\'utilisent.</p>')
     + scriptExamples([
       ['Faire tourner un objet ramassable sur lui-même (un tour toutes les deux secondes environ) :', [
         'function update(api){',
         '  api.me.rotation.y += 3 * api.dt;',
         '}']],
       ['Le matériau est celui de l\'objet : changer sa couleur quand le joueur le touche.', [
         'function start(api){',
         '  const mesh = api.me.getComponent(\'Mesh\');',
         '  api.onContact(\'joueur\', function(autre){',
         '    mesh.material.color.set(\'#ff3333\');',
         '  });',
         '}']],
       ['Faire briller l\'objet tant que la touche E est enfoncée :', [
         'let mesh = null;',
         'function start(api){ mesh = api.me.getComponent(\'Mesh\'); }',
         'function update(api){',
         '  mesh.material.emissive.set(api.key(\'e\') ? \'#ffcc00\' : \'#000000\');',
         '}']],
       ['Faire clignoter l\'objet (dégât, invincibilité) en le masquant une demi-seconde sur deux :', [
         'function update(api){',
         '  api.me.visible = Math.floor(api.time * 4) % 2 === 0;',
         '}']]
     ])
     + advancedHelp('Données et sérialisation', '<p>Le composant référence directement la géométrie et '
       + 'le matériau Three.js de l\'objet : aucune donnée n\'est dupliquée. À l\'enregistrement, il écrit '
       + 'le type de géométrie, la couleur, le matériau et les réglages d\'ombre.</p>')
     + trapHelp('<p>Un objet <b>Non éclairé</b> ne réagit plus à aucune lumière ni sonde de réflexion : '
       + 'pratique pour un écran ou une lueur, déroutant si la case a été cochée par erreur.</p>')
     + '<h3>Voir aussi</h3><ul>'
     + '<li>' + linkHelp('materials-contract', 'Les matériaux') + '</li>'
     + '<li>' + linkHelp('component-Model', 'Modèle (Model)') + '</li>'
     + '</ul>'; }},

  {id:'component-Model', part:'components', section:'Rendu', title:'Modèle (Model)', level:'both',
   summary:'La racine d\'un modèle 3D importé (glTF/FBX) : sa provenance et ses maillages.',
   anchors:[
     {f:'js/components/component-model.js', c:"static get typeName() { return 'Model'; }"},
     {f:'js/components/component-model.js', c:"static get description(){ return 'Modèle importé'; }"}
   ],
   html:function(){ return ''
     + essentialHelp('<p>Quand vous placez un modèle importé dans la scène, sa racine reçoit le composant '
       + '<b>Modèle</b>. Il retient de quel asset vient l\'objet et son format ; les maillages réels '
       + 'sont dans ses enfants.</p>')
     + '<h3>Ajouter le composant</h3>'
     + internalNote('quand un ' + termHelp('Modèle importé') + ' est glissé du panneau Projet vers la scène')
     + '<h3>Propriétés</h3>'
     + propsHelp([
       ['Asset', 'assetId', '', 'L\'asset de modèle dont l\'objet est une instance.'],
       ['Format', 'format', '', 'Le format du fichier source (glTF, FBX…).']
     ])
     + '<h3>Utilisation</h3>'
     + '<p>Un modèle est un objet de plein droit : vous pouvez lui ajouter une ' + linkHelp('component-Physics', 'Physique')
     + ', un ' + linkHelp('component-Collider', 'Collider') + ', des scripts ou une '
     + linkHelp('component-AnimatorController', 'Machine à états') + '.</p>'
     + scriptExamples([
       ['Le composant ne se règle pas à l\'exécution (il ne garde que la provenance), mais '
         + '<code>meshes()</code> donne tous les maillages dessinés : teinter le modèle entier en rouge au contact.', [
         'function start(api){',
         '  const modele = api.me.getComponent(\'Model\');',
         '  api.onContact(\'piege\', function(){',
         '    modele.meshes().forEach(function(m){ m.material.color.set(\'#ff4444\'); });',
         '  });',
         '}']],
       ['Lister les animations du modèle, puis jouer la marche en boucle :', [
         'function start(api){',
         '  api.log(api.animations());',
         '  api.playAnimation(\'Marche\', {boucle: true});',
         '}']],
       ['Faire apparaître une autre instance du même modèle (asset « Arbre ») à côté de l\'objet :', [
         'function start(api){',
         '  const p = api.me.position;',
         '  api.create(\'Arbre\', api.V3(p.x + 3, p.y, p.z));',
         '}']]
     ])
     + advancedHelp('Pourquoi pas un Maillage', '<p>Une racine de modèle n\'a ni géométrie ni matériau : '
       + 'son rendu vit dans un sous-arbre de plusieurs maillages, un matériau par maillage. Le composant '
       + 'ne détient rien d\'autre que la provenance ; sa méthode <code>meshes()</code> liste les maillages '
       + 'réellement dessinés.</p>')
     + trapHelp('<p>Si l\'asset source est supprimé du projet, l\'objet ne sait plus d\'où il vient : '
       + 'il n\'a plus de modèle à recloner à la reconstruction suivante.</p>')
     + '<h3>Voir aussi</h3><ul>'
     + '<li>' + linkHelp('import-model', 'Importer un modèle') + '</li>'
     + '<li>' + linkHelp('component-SkinnedMeshRenderer', 'Maillage skinné') + '</li>'
     + '<li>' + linkHelp('component-SubScene', 'Sous-scène') + '</li>'
     + '</ul>'; }},

  {id:'component-SkinnedMeshRenderer', part:'components', section:'Animation', title:'Maillage skinné (SkinnedMeshRenderer)', level:'both',
   summary:'Un maillage déformé par un squelette, à l\'intérieur d\'un modèle importé.',
   anchors:[
     {f:'js/components/component-skinned-mesh.js', c:"static get typeName() { return 'SkinnedMeshRenderer'; }"},
     {f:'js/components/component-skinned-mesh.js', c:"this.data = { externalClips: [] };"}
   ],
   html:function(){ return ''
     + essentialHelp('<p>Un personnage animé importé contient un ou plusieurs ' + termHelp('Maillage skinné')
       + ' : des maillages déformés par les os d\'un squelette. Ce composant les rend visibles dans '
       + 'l\'inspecteur ; c\'est l\'équivalent du composant du même nom dans Unity.</p>')
     + '<h3>Ajouter le composant</h3>'
     + internalNote('sur chaque maillage skinné de chaque instance d\'un modèle importé')
     + '<h3>Propriétés</h3>'
     + propsHelp([
       ['Clips', 'externalClips', '[]', 'Les clips empruntés à un autre asset (par exemple un fichier Mixamo par animation) : leur provenance seulement.']
     ])
     + '<h3>Utilisation</h3>'
     + '<p>C\'est ici qu\'on attache des animations venues d\'autres fichiers, et qu\'on affiche le '
     + 'squelette pour vérifier le ' + termHelp('Rig') + '.</p>'
     + scriptExamples([
       ['Le composant est sur un <b>enfant</b> du modèle, pas sur sa racine : on le cherche dans le sous-arbre. '
         + 'Ici, compter les os du squelette pour vérifier le rig :', [
         'function start(api){',
         '  api.me.traverse(function(x){',
         '    const peau = x.getComponent ? x.getComponent(\'SkinnedMeshRenderer\') : null;',
         '    if(peau) api.log(x.name + \' : \' + peau.boneCount + \' os\');',
         '  });',
         '}']],
       ['Les clips (y compris les clips externes attachés ici) se jouent depuis la racine. '
         + 'Courir quand Maj est enfoncée, marcher sinon :', [
         'function update(api){',
         '  api.playAnimation(api.key(\'Shift\') ? \'Course\' : \'Marche\', {boucle: true, fondu: 0.2});',
         '}']],
       ['Mélanger deux clips : les jambes courent, le haut du corps (l\'os « Spine » et ses enfants) vise.', [
         'function start(api){',
         '  api.playAnimation(\'Course\', {boucle: true});',
         '  api.layerAnimation(\'Viser\', {depuis: \'Spine\'});',
         '}']]
     ])
     + advancedHelp('Attaché à chaque clone', '<p>La peau, le squelette et le matériau restent sur le '
       + 'maillage Three.js lui-même. Le composant est reconstruit à chaque clonage du modèle, dans '
       + 'l\'éditeur comme dans le jeu publié.</p>')
     + trapHelp('<p>Les clips externes sont enregistrés par <b>provenance</b> (asset et nom du clip), '
       + 'jamais par leurs clés : si l\'asset d\'origine disparaît, le clip disparaît aussi.</p>')
     + '<h3>Voir aussi</h3><ul>'
     + '<li>' + linkHelp('animation', 'L\'animation') + '</li>'
     + '<li>' + linkHelp('retargeting', 'Le reciblage') + '</li>'
     + '<li>' + linkHelp('component-Model', 'Modèle (Model)') + '</li>'
     + '</ul>'; }},

  {id:'component-Light', part:'components', section:'Lumière', title:'Lumière (Light)', level:'both',
   summary:'Une source de lumière : ponctuelle, spot ou directionnelle.',
   anchors:[
     {f:'js/components/component-light.js', c:"static get typeName() { return 'Light'; }"},
     {f:'js/component-data.js', c:"subType: 'point', color: 0xffffff, intensity: 1, range: 0, angle: Math.PI / 4, penumbra: 0"}
   ],
   html:function(){ return ''
     + essentialHelp('<p>Le composant <b>Lumière</b> éclaire la scène. Une lumière <b>ponctuelle</b> '
       + 'rayonne dans toutes les directions (une ampoule), un <b>spot</b> éclaire en cône (une lampe '
       + 'torche), une lumière <b>directionnelle</b> éclaire tout dans la même direction (le soleil).</p>')
     + '<h3>Ajouter le composant</h3>'
     + addSteps('Lumière', ['Choisissez le <b>Type</b>, puis orientez l\'objet pour un spot ou une directionnelle.'])
     + '<h3>Propriétés</h3>'
     + propsHelp([
       ['Type', 'subType', 'point', 'Ponctuelle, Spot ou Directionnelle.'],
       ['Couleur', 'color', '#ffffff', 'La teinte de la lumière.'],
       ['Intensité', 'intensity', '1', 'La puissance.'],
       ['Portée', 'range', '0', 'Distance au-delà de laquelle la lumière n\'éclaire plus ; 0 = sans limite.'],
       ['Angle °', 'angle', '45°', 'Spot : ouverture du cône (stockée en radians).'],
       ['Pénombre', 'penumbra', '0', 'Spot : douceur du bord du cône, de 0 (net) à 1.']
     ])
     + '<h3>Utilisation</h3>'
     + tipHelp('<p>Pour une scène d\'extérieur, une seule directionnelle (le soleil) plus l\'ambiance de '
       + 'l\'' + linkHelp('panel-environment', 'Environnement') + ' suffisent souvent. Les lumières ponctuelles '
       + 'coûtent cher : gardez-les pour les points d\'intérêt.</p>')
     + scriptExamples([
       ['Les champs du composant (<code>intensity</code>, <code>color</code>…) sont les réglages enregistrés ; '
         + 'la lumière réellement dessinée est <code>objectThree</code>. Une torche qui vacille :', [
         'let lum = null;',
         'function start(api){ lum = api.me.getComponent(\'Light\'); }',
         'function update(api){',
         '  lum.objectThree.intensity = lum.intensity * (0.85 + Math.random() * 0.3);',
         '}']],
       ['Une lampe de poche allumée tant que F est enfoncée :', [
         'function update(api){',
         '  const lum = api.me.getComponent(\'Light\');',
         '  lum.objectThree.visible = api.key(\'f\');',
         '}']],
       ['Passer l\'éclairage en rouge d\'alarme quand le joueur entre en contact :', [
         'function start(api){',
         '  const lum = api.me.getComponent(\'Light\');',
         '  api.onContact(\'joueur\', function(){',
         '    lum.objectThree.color.set(\'#ff2020\');',
         '    lum.objectThree.intensity = 3;',
         '  });',
         '}']]
     ])
     + advancedHelp('Lumières temps réel et lightmaps', '<p>Une lumière calcule son éclairage à chaque '
       + 'image. Pour un décor immobile, cuire l\'éclairage dans une ' + termHelp('Lightmap')
       + ' est bien moins coûteux.</p>')
     + trapHelp('<p>L\'angle s\'affiche en degrés dans l\'inspecteur mais est enregistré en <b>radians</b> : '
       + 'un fichier de scène édité à la main avec <code>angle: 45</code> donne un cône presque plat.</p>')
     + '<h3>Voir aussi</h3><ul>'
     + '<li>' + linkHelp('lightmaps', 'Les lightmaps') + '</li>'
     + '<li>' + linkHelp('component-Reflection', 'Sonde de réflexion') + '</li>'
     + '</ul>'; }},

  {id:'component-Camera', part:'components', section:'Caméra', title:'Caméra (Camera)', level:'both',
   summary:'Un point de vue : perspective ou orthographique, principal ou incrusté.',
   anchors:[
     {f:'js/components/component-camera.js', c:"static get typeName() { return 'Camera'; }"},
     {f:'js/component-data.js', c:"projection: 'perspective', fov: 50, near: 0.1, far: 1000, orthoSize: 5,"}
   ],
   html:function(){ return ''
     + essentialHelp('<p>Le composant <b>Caméra</b> définit ce que voit le joueur. La caméra marquée '
       + '<b>Caméra principale</b> est celle du jeu ; les autres peuvent servir de vues incrustées.</p>')
     + '<h3>Ajouter le composant</h3>'
     + addSteps('Caméra', ['Cochez <b>Caméra principale</b> si c\'est la vue du joueur.'])
     + '<h3>Propriétés</h3>'
     + propsHelp([
       ['Projection', 'projection', 'perspective', 'Perspective (3D) ou Orthographique (2D, vue isométrique).'],
       ['FOV °', 'fov', '50', 'Perspective : angle de vue vertical.'],
       ['Taille de vue', 'orthoSize', '5', 'Orthographique : demi-hauteur visible, en mètres.'],
       ['Près / Loin', 'near / far', '0.1 / 1000', 'Ce qui est plus proche ou plus loin n\'est pas dessiné.'],
       ['Pixel perfect', 'pixelPerfect', 'non', 'Orthographique : cale l\'image sur la grille de pixels.'],
       ['Pixels par unité', 'ppu', '100', 'Pixel perfect : combien de pixels écran pour un mètre.'],
       ['Cadrage', 'mode', 'height', 'Pixel perfect : quelle dimension est fixée.'],
       ['Largeur du niveau', 'widthLevel', '0', 'Pixel perfect : largeur à faire tenir à l\'écran.'],
       ['Rapport pixel', 'ratio', '1', 'Pixel perfect : facteur d\'agrandissement.'],
       ['Caméra principale', 'main', 'non', 'La caméra utilisée par le jeu.']
     ])
     + '<h3>Utilisation</h3>'
     + tipHelp('<p><b>Voir à travers cette caméra</b> montre son cadrage dans la vue 3D ; <b>Revenir à la '
       + 'vue éditeur</b> rend la caméra de travail.</p>')
     + scriptExamples([
       ['Viser : resserrer le champ de vision tant que le bouton droit de la souris est enfoncé. '
         + 'La caméra dessinée est <code>objectThree</code> ; après un changement de FOV, recalculez sa projection.', [
         'let cam = null;',
         'function start(api){ cam = api.me.getComponent(\'Camera\'); }',
         'function update(api){',
         '  cam.objectThree.fov = api.click(2) ? 25 : cam.fov;',
         '  cam.objectThree.updateProjectionMatrix();',
         '}']],
       ['Une caméra de surveillance qui tourne pour garder le joueur dans le cadre :', [
         'function update(api){',
         '  api.lookAt(api.find(\'Joueur\'));',
         '}']],
       ['Avancer ou reculer la caméra au clavier (touches + et -) :', [
         'function update(api){',
         '  if(api.key(\'+\')) api.me.position.z -= 5 * api.dt;',
         '  if(api.key(\'-\')) api.me.position.z += 5 * api.dt;',
         '}']]
     ])
     + advancedHelp('Profondeur et précision', '<p>Un écart trop grand entre <b>Près</b> et <b>Loin</b> '
       + 'dégrade la précision de profondeur : des surfaces proches se mettent à scintiller. Remontez '
       + '<b>Près</b> avant de baisser <b>Loin</b>.</p>')
     + trapHelp('<p>Sans aucune caméra cochée <b>Caméra principale</b>, le jeu choisit une vue par défaut, '
       + 'qui n\'est pas forcément celle que vous attendez.</p>')
     + '<h3>Voir aussi</h3><ul>'
     + '<li>' + linkHelp('component-CameraFollow', 'Suivi de caméra') + '</li>'
     + '<li>' + linkHelp('component-PostVolume', 'Volume de post-traitement') + '</li>'
     + '</ul>'; }},

  {id:'component-CameraFollow', part:'components', section:'Caméra', title:'Suivi de caméra (CameraFollow)', level:'both',
   summary:'Fait suivre un objet par la caméra, dans des bornes, avec calage au pixel.',
   anchors:[
     {f:'js/components/component-camera-follow.js', c:"static get typeName(){ return 'CameraFollow'; }"},
     {f:'js/component-data.js', c:"topOfView: 0.12, snapPixel: true"}
   ],
   html:function(){ return ''
     + essentialHelp('<p>Posé sur une caméra, <b>Suivi de caméra</b> la fait suivre un objet (le joueur) '
       + 'sans script. Des bornes empêchent de montrer ce qui dépasse du niveau.</p>')
     + '<h3>Ajouter le composant</h3>'
     + addSteps('Suivi de caméra', ['Dans <b>Suit</b>, choisissez l\'objet à suivre.'])
     + '<h3>Propriétés</h3>'
     + propsHelp([
       ['Suit', 'targetName', '', 'Le nom de l\'objet suivi.'],
       ['Bornes', 'xMin / xMax / yMin / yMax', 'aucune', 'Limites du déplacement de la caméra.'],
       ['Regard vers le haut', 'topOfView', '0.12', 'Part de la vue gardée au-dessus de la cible.'],
       ['Caler sur le pixel', 'snapPixel', 'oui', 'Arrondit la position pour éviter le tremblement en pixel art.']
     ])
     + '<h3>Utilisation</h3>'
     + tipHelp('<p><b>Déduire du décor</b> calcule les bornes à partir du niveau ; <b>Enlever les bornes</b> '
       + 'laisse la caméra libre.</p>')
     + scriptExamples([
       ['Faire suivre un autre objet (le boss qui entre en scène), puis rendre la caméra au joueur après 4 secondes :', [
         'function start(api){',
         '  const suivi = api.find(\'Caméra\').getComponent(\'CameraFollow\');',
         '  suivi.targetName = \'Boss\';',
         '  api.after(4, function(){ suivi.targetName = \'Joueur\'; });',
         '}']],
       ['Enfermer la caméra dans une salle quand le joueur y entre (script posé sur la zone de la salle) :', [
         'function start(api){',
         '  const suivi = api.find(\'Caméra\').getComponent(\'CameraFollow\');',
         '  api.onContact(\'joueur\', function(){',
         '    suivi.xMin = 20; suivi.xMax = 40;',
         '    suivi.yMin = 0;  suivi.yMax = 12;',
         '  });',
         '}']],
       ['Lire les réglages de la caméra 2D principale dans la Console :', [
         'function start(api){',
         '  api.log(api.camera2d());',
         '}']]
     ])
     + advancedHelp('Pour quels jeux', '<p>Ce composant vise surtout les jeux 2D et à vue orthographique ; '
       + 'les réglages se lisent et s\'écrivent aussi par <code>api.camera2d()</code>.</p>')
     + trapHelp('<p>Le suivi désigne la cible <b>par son nom</b> : renommer l\'objet suivi casse le suivi '
       + 'sans message.</p>')
     + '<h3>Voir aussi</h3><ul>'
     + '<li>' + linkHelp('component-Camera', 'Caméra') + '</li>'
     + '<li>' + linkHelp('game-2d', 'Jeu 2D') + '</li>'
     + '</ul>'; }},

  {id:'component-Reflection', part:'components', section:'Lumière', title:'Sonde de réflexion (Reflection)', level:'both',
   summary:'Capture l\'environnement en un cubemap pour les reflets des matériaux voisins.',
   anchors:[
     {f:'js/components/component-reflection.js', c:"static get typeName() { return 'Reflection'; }"},
     {f:'js/component-data.js', c:"resolution: 128,"}
   ],
   html:function(){ return ''
     + essentialHelp('<p>Une ' + termHelp('Sonde de réflexion') + ' photographie la scène autour d\'elle '
       + '(un cubemap). Les objets métalliques ou lisses dans son rayon y prennent leurs reflets.</p>')
     + '<h3>Ajouter le composant</h3>'
     + addSteps('Sonde de réflexion', ['Cliquez sur <b>Cuire cette sonde</b>.'])
     + '<h3>Propriétés</h3>'
     + propsHelp([
       ['Rayon d\'influence', 'radius', '18', 'Les objets dans ce rayon (m) utilisent la sonde.'],
       ['Résolution', 'resolution', '128', 'Côté d\'une face du cubemap, en pixels.'],
       ['Intensité des reflets', 'intensity', '1', 'Force des reflets appliqués aux matériaux.'],
       ['Projection boîte', 'box', 'non', 'Accroche les reflets aux murs d\'une pièce.'],
       ['Taille de la boîte', 'boxSize', '[12, 6, 12]', 'Dimensions de la pièce (m).'],
       ['Décalage du centre', 'boxOffset', '[0, 0, 0]', 'Centre de la boîte, relatif à la sonde.']
     ])
     + '<h3>Utilisation</h3>'
     + tipHelp('<p>En intérieur, activez la <b>Projection boîte</b> et ajustez la boîte aux murs : le reflet '
       + 'reste en place quand l\'objet bouge.</p>')
     + scriptExamples([
       ['La sonde n\'a pas de réglage utile à changer en cours de partie : sa cuisson se fait au lancement. '
         + 'Un script peut lire ses champs, par exemple pour savoir si le joueur est dans son rayon :', [
         'function update(api){',
         '  const sonde = api.me.getComponent(\'Reflection\');',
         '  const dedans = api.distance(api.find(\'Joueur\'), api.me) < sonde.data.radius;',
         '  if(dedans) api.status(\'reflets de la salle\');',
         '}']],
       ['Retrouver toutes les sondes de la scène et afficher leur résolution :', [
         'function start(api){',
         '  api.scene.traverse(function(x){',
         '    const s = x.getComponent ? x.getComponent(\'Reflection\') : null;',
         '    if(s) api.log(x.name + \' : \' + s.data.resolution + \' px\');',
         '  });',
         '}']]
     ])
     + advancedHelp('Cuisson', '<p>Le jeu recuit toutes ses sondes au lancement. Une sonde désactivée est '
       + 'ignorée par la cuisson et la distribution, comme si elle n\'existait pas.</p>')
     + trapHelp('<p>Un cubemap est pris depuis un seul point : sans projection boîte, dans une pièce, le '
       + 'reflet glisse sur les murs quand l\'objet se déplace.</p>')
     + '<h3>Voir aussi</h3><ul>'
     + '<li>' + linkHelp('probes', 'Les sondes') + '</li>'
     + '<li>' + linkHelp('component-Light', 'Lumière') + '</li>'
     + '</ul>'; }},

  {id:'component-PostVolume', part:'components', section:'Rendu', title:'Volume de post-traitement (PostVolume)', level:'both',
   summary:'Applique un profil de post-traitement partout ou dans une zone.',
   anchors:[
     {f:'js/components/component-postvolume.js', c:"static get typeName() { return 'PostVolume'; }"},
     {f:'js/components/component-postvolume.js', c:"blendDistance: 2,"}
   ],
   html:function(){ return ''
     + essentialHelp('<p>Un ' + termHelp('PostVolume') + ' applique des effets à l\'image finale (bloom, '
       + 'couleurs…) décrits par un profil. <b>Global</b>, il agit partout ; sinon, seulement quand la caméra '
       + 'entre dans sa zone.</p>')
     + '<h3>Ajouter le composant</h3>'
     + addSteps('Volume de post-traitement', ['Choisissez un <b>Profil</b>.'])
     + '<h3>Propriétés</h3>'
     + propsHelp([
       ['Profil', 'profileId', 'aucun', 'L\'asset de profil de post-traitement.'],
       ['Global', 'global', 'oui', 'Agit partout, sans zone.'],
       ['Forme', 'shape', 'box', 'Zone locale : Boîte ou Sphère.'],
       ['Taille', 'size', '10 × 10 × 10', 'Boîte : dimensions de la zone.'],
       ['Rayon', 'radius', '5', 'Sphère : rayon de la zone.'],
       ['Distance de fondu', 'blendDistance', '2', 'Distance sur laquelle l\'effet apparaît progressivement.'],
       ['Priorité', 'priority', '0', 'Départage les volumes qui se chevauchent.']
     ])
     + '<h3>Utilisation</h3>'
     + tipHelp('<p>Un volume global pour l\'ambiance générale, plus des volumes locaux (une grotte, sous '
       + 'l\'eau) de priorité plus haute.</p>')
     + scriptExamples([
       ['Le mélange des volumes est calculé par le moteur ; un script s\'en sert surtout pour lire la zone. '
         + 'Savoir si le joueur est sous l\'eau (volume local en sphère) :', [
         'function update(api){',
         '  const vol = api.me.getComponent(\'PostVolume\');',
         '  const sousLEau = !vol.data.global',
         '    && api.distance(api.find(\'Joueur\'), api.me) < vol.data.radius;',
         '  if(sousLEau) api.status(\'Sous l\\\'eau !\');',
         '}']],
       ['Afficher le profil utilisé par le volume (pratique pour déboguer une ambiance) :', [
         'function start(api){',
         '  const vol = api.me.getComponent(\'PostVolume\');',
         '  api.log(vol.profile ? vol.profile.name : \'aucun profil\');',
         '}']]
     ])
     + advancedHelp('Mélange', '<p>Les volumes locaux se mélangent selon la distance de fondu et la '
       + 'priorité.</p>')
     + trapHelp('<p>Un volume sans profil n\'a aucun effet et ne signale rien.</p>')
     + '<h3>Voir aussi</h3><ul>'
     + '<li>' + linkHelp('component-Camera', 'Caméra') + '</li>'
     + '</ul>'; }},

  {id:'component-Particles', part:'components', section:'Rendu', title:'Particules (Particles)', level:'both',
   summary:'Un émetteur de particules : feu, fumée, étincelles, explosions.',
   anchors:[
     {f:'js/components/component-particles.js', c:"static get typeName() { return 'Particles'; }"},
     {f:'js/component-data.js', c:"rate: 25,"},
     {f:'js/component-data.js', c:"max: 300"}
   ],
   html:function(){ return ''
     + essentialHelp('<p>Le composant <b>Particules</b> émet de petites images qui naissent, bougent et '
       + 'disparaissent. En mode <b>Continu</b>, il émet sans arrêt ; en mode <b>Burst</b>, il lâche une rafale.</p>')
     + '<h3>Ajouter le composant</h3>'
     + addSteps('Particules', ['Cliquez sur <b>Émettre maintenant</b> pour voir le résultat.'])
     + '<h3>Propriétés</h3>'
     + propsHelp([
       ['Forme', 'shape', 'cone', 'Cône, Point, Boîte ou Sphère : d\'où et vers où partent les particules.'],
       ['Taille zone', 'dims', '[1, 0.2, 1]', 'Boîte : dimensions.'],
       ['Rayon', 'radius', '0.4', 'Sphère et cône.'],
       ['Angle °', 'angle', '20', 'Cône : demi-angle autour de l\'axe Y local.'],
       ['Mode', 'mode', 'continu', 'Continu ou Burst.'],
       ['Débit /s', 'rate', '25', 'Continu : particules par seconde.'],
       ['Quantité', 'amount', '40', 'Burst : particules par rafale.'],
       ['Durée de vie s', 'vie', '1.3', 'Durée de vie, à ±25 %.'],
       ['Vitesse', 'speed', '2.5', 'Vitesse de départ.'],
       ['Gravité', 'gravity', '0', 'Accélération sur Y ; négative, les particules retombent.'],
       ['Taille début / fin', 'sizeStart / sizeEnd', '0.3 / 0.06', 'Taille au cours de la vie.'],
       ['Opacité début / fin', 'opacityStart / opacityEnd', '1 / 0', 'Transparence au cours de la vie.'],
       ['Couleur début / fin', 'colorStart / colorEnd', '#ffb347 / #ff4422', 'Couleur au cours de la vie.'],
       ['Additif', 'additif', 'oui', 'Mélange additif (feu, lueurs) ; décoché pour la fumée.'],
       ['Max particules', 'max', '300', 'Plafond de particules vivantes.']
     ])
     + '<h3>Utilisation</h3>'
     + tipHelp('<p>Pour une fumée, décochez <b>Additif</b>, prenez une couleur grise et une taille de fin '
       + 'plus grande que celle de début.</p>')
     + scriptExamples([
       ['Une gerbe d\'étincelles quand le joueur touche l\'objet :', [
         'function start(api){',
         '  api.onContact(\'joueur\', function(){',
         '    api.particles().emit(60);   // une rafale de 60',
         '  });',
         '}']],
       ['Un réacteur qui ne crache que pendant que la barre d\'espace est enfoncée :', [
         'function update(api){',
         '  api.particles().setActive(api.key(\' \'));',
         '}']],
       ['Les réglages sont lus à chaque image : un feu qui grossit avec le temps, jusqu\'à 120 particules par seconde.', [
         'function update(api){',
         '  const feu = api.me.getComponent(\'Particles\');',
         '  feu.data.rate = Math.min(120, feu.data.rate + 10 * api.dt);',
         '}']],
       ['Déclencher l\'émetteur d\'un autre objet (une explosion posée dans le décor) :', [
         'function start(api){',
         '  api.on(\'boum\', function(){ api.particles(api.find(\'Explosion\')).emit(100); });',
         '}']]
     ])
     + advancedHelp('Performance', '<p><b>Max particules</b> borne le coût : au-delà, les nouvelles '
       + 'particules ne naissent pas. Augmentez-le seulement si l\'émission paraît coupée.</p>')
     + trapHelp('<p>Un débit élevé avec une longue durée de vie dépasse vite le maximum : l\'émission '
       + 'semble alors irrégulière, sans erreur.</p>')
     + '<h3>Voir aussi</h3><ul>'
     + '<li>' + linkHelp('particles', 'Les particules') + '</li>'
     + '</ul>'; }},

  {id:'component-Terrain', part:'components', section:'Monde', title:'Terrain (Terrain)', level:'both',
   summary:'Un sol à relief, sculpté au pinceau et coloré selon l\'altitude.',
   anchors:[
     {f:'js/components/component-terrain.js', c:"static get typeName() { return 'Terrain'; }"},
     {f:'js/component-data.js', c:"size: 60,"}
   ],
   html:function(){ return ''
     + essentialHelp('<p>Le <b>Terrain</b> est un grand sol carré dont on sculpte le relief au pinceau. Sa '
       + 'couleur passe de l\'herbe à la roche puis à la neige selon l\'altitude.</p>')
     + '<h3>Ajouter le composant</h3>'
     + addSteps('Terrain', ['Cliquez sur <b>Sculpter le terrain</b>, puis peignez dans la vue 3D.'])
     + '<h3>Propriétés</h3>'
     + propsHelp([
       ['Grille', 'size / segments', '60 m / 64', 'Côté en mètres, subdivisions par côté.'],
       ['Bas (herbe)', 'colorBottom', '#3f6b3a', 'Couleur des zones basses.'],
       ['Haut (roche)', 'colorTop', '#8b8378', 'Couleur de la roche.'],
       ['Sommet (neige)', 'colorNeige', '#e8eef2', 'Couleur des sommets.'],
       ['Seuil roche', 'thresholdRoche', '0.35', 'Fraction de l\'altitude max où la roche apparaît.'],
       ['Seuil neige', 'thresholdNeige', '0.8', 'Fraction où la neige apparaît.'],
       ['Roche sur pentes', 'rolloff', 'oui', 'Les pentes fortes deviennent rocheuses.']
     ])
     + '<h3>Utilisation</h3>'
     + tipHelp('<p><b>Générer un relief</b> crée un relief aléatoire (réglé par <b>Amplitude</b> et '
       + '<b>Échelle des formes</b>) ; <b>Tout aplanir</b> remet le sol à plat.</p>')
     + scriptExamples([
       ['Le relief se sculpte dans l\'éditeur, pas en cours de partie ; un script lit l\'altitude du sol. '
         + 'Coller un objet au terrain pendant qu\'il se déplace :', [
         'function update(api){',
         '  api.me.position.x += 2 * api.dt;',
         '  const h = api.groundHeight(api.me.position.x, api.me.position.z);',
         '  if(h !== null) api.me.position.y = h;',
         '}']],
       ['Semer dix arbres posés sur le relief (asset « Arbre ») :', [
         'function start(api){',
         '  for(let i = 0; i < 10; i++){',
         '    const x = (Math.random() - 0.5) * 50, z = (Math.random() - 0.5) * 50;',
         '    const h = api.groundHeight(x, z);',
         '    if(h !== null) api.create(\'Arbre\', api.V3(x, h, z));',
         '  }',
         '}']],
       ['Prévenir le joueur quand il monte en altitude (seuil de neige) :', [
         'function update(api){',
         '  const h = api.groundHeight();   // sous cet objet',
         '  if(h !== null && h > 12) api.status(\'Il fait froid ici…\');',
         '}']]
     ])
     + advancedHelp('Hauteurs', '<p>Les hauteurs sont stockées sommet par sommet : (segments + 1)² valeurs. '
       + 'Plus de segments donne plus de détail, mais un fichier plus lourd.</p>')
     + trapHelp('<p>Changer la grille après avoir sculpté redistribue les sommets : vérifiez le relief.</p>')
     + '<h3>Voir aussi</h3><ul>'
     + '<li>' + linkHelp('terrain', 'Le terrain') + '</li>'
     + '</ul>'; }},

  {id:'component-Physics', part:'components', section:'Physique', title:'Physique (Physics)', level:'both',
   summary:'Un corps rigide simulé : gravité, chocs, rebonds.',
   anchors:[
     {f:'js/components/component-physics.js', c:"static get typeName() { return 'Physics'; }"},
     {f:'js/component-data.js', c:"{active:false, masse:1, bounce:0.3, friction:0.4}"}
   ],
   html:function(){ return ''
     + essentialHelp('<p>Avec <b>Physique</b>, l\'objet devient un corps rigide : il tombe, rebondit et '
       + 'pousse les autres. Sa forme de collision vient de son ' + linkHelp('component-Collider', 'Collider') + '.</p>')
     + '<h3>Ajouter le composant</h3>'
     + addSteps('Physique', ['Ajoutez aussi un <b>Collider</b> pour régler sa forme de collision.'])
     + '<h3>Propriétés</h3>'
     + propsHelp([
       ['Masse', 'masse', '1', 'La masse du corps.'],
       ['Rebond', 'bounce', '0.3', 'De 0 (aucun rebond) à 1.'],
       ['Friction', 'friction', '0.4', 'La résistance au glissement.']
     ])
     + '<h3>Utilisation</h3>'
     + '<p>La simulation tourne pendant la lecture et dans le jeu.</p>'
     + scriptExamples([
       ['Sauter avec la barre d\'espace : une impulsion vers le haut, seulement si le corps ne monte pas déjà.', [
         'function update(api){',
         '  const v = api.velocity();',
         '  if(api.key(\' \') && v && Math.abs(v.y) < 0.1) api.applyForce(api.me, api.V3(0, 6, 0));',
         '}']],
       ['Piloter une bille aux flèches en réglant sa vitesse horizontale (la gravité garde la verticale) :', [
         'function update(api){',
         '  const v = api.velocity();',
         '  if(!v) return;',
         '  const x = (api.key(\'ArrowRight\') ? 4 : 0) - (api.key(\'ArrowLeft\') ? 4 : 0);',
         '  const z = (api.key(\'ArrowDown\') ? 4 : 0) - (api.key(\'ArrowUp\') ? 4 : 0);',
         '  api.setVelocity(api.me, api.V3(x, v.y, z));',
         '}']],
       ['Faire réapparaître le corps au départ s\'il tombe du niveau (écrire <code>position</code> serait effacé par la simulation) :', [
         'function update(api){',
         '  if(api.me.position.y < -20) api.setPosition(api.me, api.V3(0, 3, 0));',
         '}']],
       ['Lire les réglages du corps (ils sont pris en compte au lancement de la simulation, '
         + 'pas en cours de partie) et freiner net au contact d\'un mur collant :', [
         'function start(api){',
         '  api.log(\'masse : \' + api.me.getComponent(\'Physics\').data.masse);',
         '  api.onContact(\'colle\', function(){ api.setVelocity(api.me, api.V3(0, 0, 0)); });',
         '}']]
     ])
     + advancedHelp('Déplacer un corps simulé', '<p>Modifier directement <code>position</code> d\'un corps '
       + 'simulé se bat avec la simulation : utilisez <code>api.setPosition</code>, '
       + '<code>api.setVelocity</code> ou <code>api.applyForce</code>.</p>')
     + trapHelp('<p>Une masse énorme face à une masse minuscule rend les chocs instables : gardez des '
       + 'rapports de masse raisonnables.</p>')
     + '<h3>Voir aussi</h3><ul>'
     + '<li>' + linkHelp('physics', 'La physique') + '</li>'
     + '<li>' + linkHelp('component-Collider', 'Collider') + '</li>'
     + '</ul>'; }},

  {id:'component-Collider', part:'components', section:'Physique', title:'Collider (Collider)', level:'both',
   summary:'La forme de collision d\'un objet, ou une zone déclencheur.',
   anchors:[
     {f:'js/components/component-collider.js', c:"static get typeName() { return 'Collider'; }"},
     {f:'js/component-data.js', c:"{shape:'auto', dims:[1,1,1], radius:1, height:2, offset:[0,0,0], trigger:false}"}
   ],
   html:function(){ return ''
     + essentialHelp('<p>Un ' + termHelp('Collider') + ' donne à l\'objet une forme simple (boîte, sphère, '
       + 'cylindre) pour les collisions. Coché <b>Déclencheur</b>, il ne bloque rien mais détecte les entrées.</p>')
     + '<h3>Ajouter le composant</h3>'
     + addSteps('Collider')
     + '<h3>Propriétés</h3>'
     + propsHelp([
       ['Forme', 'shape', 'auto', 'Auto (boîte englobante), Boîte, Sphère ou Cylindre.'],
       ['Taille', 'dims', '[1, 1, 1]', 'Boîte : dimensions.'],
       ['Rayon', 'radius', '1', 'Sphère et cylindre.'],
       ['Hauteur', 'height', '2', 'Cylindre.'],
       ['Décalage', 'offset', '[0, 0, 0]', 'Décale la forme par rapport à l\'objet.'],
       ['Déclencheur', 'trigger', 'non', 'Zone traversable qui détecte les contacts.']
     ])
     + '<h3>Utilisation</h3>'
     + tipHelp('<p>Une zone d\'arrivée : un objet invisible avec un Collider <b>Déclencheur</b>, et une règle '
       + linkHelp('component-Events', 'Quand… Alors…') + ' sur l\'entrée.</p>')
     + scriptExamples([
       ['Une pièce à ramasser : quand un objet tagué « joueur » la touche, compter un point et la supprimer. '
         + '<code>api.onContact</code> ne prévient qu\'à l\'entrée, une seule fois par contact.', [
         'function start(api){',
         '  api.onContact(\'joueur\', function(joueur){',
         '    api.props(joueur).pieces = (api.props(joueur).pieces || 0) + 1;',
         '    api.playSound(\'piece\');',
         '    api.destroy(api.me);',
         '  });',
         '}']],
       ['Une zone d\'arrivée (Collider <b>Déclencheur</b>) qui charge le niveau suivant :', [
         'function start(api){',
         '  api.onContact(\'joueur\', function(){ api.changeScene(\'Niveau 2\'); });',
         '}']],
       ['Lire la forme du collider, et savoir si c\'est une zone traversable :', [
         'function start(api){',
         '  const col = api.me.getComponent(\'Collider\');',
         '  api.log(col.data.shape + (col.data.trigger ? \' (déclencheur)\' : \'\'));',
         '}']],
       ['Lister ce qui se trouve dans un rayon de 3 m autour de l\'objet (une explosion, une aura) :', [
         'function start(api){',
         '  api.overlapSphere(api.me.position, 3).forEach(function(x){ api.log(x.name); });',
         '}']]
     ])
     + advancedHelp('Auto', '<p>La forme <b>Auto</b> prend la boîte englobante de l\'objet : simple, mais '
       + 'grossière pour une forme ronde.</p>')
     + trapHelp('<p>Un ' + termHelp('Déclencheur') + ' ne bloque rien : un sol coché par erreur laisse tout '
       + 'passer au travers.</p>')
     + '<h3>Voir aussi</h3><ul>'
     + '<li>' + linkHelp('component-Physics', 'Physique') + '</li>'
     + '<li>' + linkHelp('physics', 'La physique') + '</li>'
     + '</ul>'; }},

  {id:'component-AudioSource', part:'components', section:'Audio', title:'Source audio (AudioSource)', level:'both',
   summary:'Joue un son depuis l\'objet, spatialisé ou non.',
   anchors:[
     {f:'js/components/component-audio.js', c:"static get typeName(){ return 'AudioSource'; }"},
     {f:'js/audio.js', c:"distanceMax:100, rolloff:1, model:'inverse', bus:'sfx'};"}
   ],
   html:function(){ return ''
     + essentialHelp('<p>La <b>Source audio</b> joue un son attaché à l\'objet. En 3D, on l\'entend plus fort '
       + 'quand on s\'approche.</p>')
     + '<h3>Ajouter le composant</h3>'
     + '<p>Le plus rapide : faites glisser un son du ' + linkHelp('panel-project', 'panneau Projet')
     + ' sur l\'objet, le composant est posé avec les réglages du son. Sinon :</p>'
     + addSteps('Source audio', ['Choisissez le <b>Son</b>.'])
     + '<h3>Propriétés</h3>'
     + propsHelp([
       ['Son', 'asset', 'aucun', 'L\'asset son joué.'],
       ['Bus', 'bus', 'sfx', 'Le bus de mixage.'],
       ['Volume', 'volume', '1', 'Le volume.'],
       ['Vitesse', 'pitch', '1', 'Vitesse de lecture (et hauteur).'],
       ['Boucle', 'loop', 'non', 'Rejoue sans fin.'],
       ['Au lancement', 'auto', 'oui', 'Démarre au lancement du jeu.'],
       ['3D (spatial)', 'spatial', 'oui', 'Le son dépend de la position de l\'auditeur.'],
       ['Portée', 'range', '10', 'Distance de référence de l\'atténuation.'],
       ['Distance max', 'distanceMax', '100', 'Au-delà, le son ne baisse plus.'],
       ['Pente', 'rolloff', '1', 'Vitesse de l\'atténuation.'],
       ['Atténuation', 'model', 'inverse', 'Le modèle d\'atténuation.']
     ])
     + '<h3>Utilisation</h3>'
     + tipHelp('<p><b>Écouter</b> joue le son dans l\'éditeur sans lancer le jeu.</p>')
     + scriptExamples([
       ['Une radio qu\'on allume et éteint : M joue, N coupe.', [
         'function update(api){',
         '  const s = api.audio();   // la source de cet objet',
         '  if(api.key(\'m\')) s.play();',
         '  if(api.key(\'n\')) s.stop();',
         '}']],
       ['Une alarme qui se déclenche quand le joueur entre dans la zone, à mi-volume :', [
         'function start(api){',
         '  api.onContact(\'joueur\', function(){',
         '    const s = api.audio();',
         '    s.volume(0.5);',
         '    s.play();',
         '  });',
         '}']],
       ['Baisser progressivement le son (fondu de sortie) en une seconde environ :', [
         'function update(api){',
         '  const s = api.audio();',
         '  s.volume(s.volume() - api.dt);',
         '}']],
       ['Pour un bruit ponctuel sans composant, <code>api.playSound</code> joue directement un asset son :', [
         'function start(api){',
         '  api.onContact(\'ennemi\', function(){ api.playSound(\'aie\', 0.8); });',
         '}']]
     ])
     + advancedHelp('Musique de fond', '<p>Une boucle musicale glissée sur un objet est réglée en musique '
       + 'de fond : en boucle, non spatiale, sur le bus Musique.</p>')
     + trapHelp('<p><code>api.audio()</code> sur un objet sans source ne plante pas : il avertit dans la '
       + linkHelp('panel-console', 'Console') + ' et ses méthodes ne font rien.</p>')
     + '<h3>Voir aussi</h3><ul>'
     + '<li>' + linkHelp('audio', 'L\'audio') + '</li>'
     + '<li>' + linkHelp('component-Synthesizer', 'Synthétiseur') + '</li>'
     + '</ul>'; }},

  {id:'component-Synthesizer', part:'components', section:'Audio', title:'Synthétiseur (Synthesizer)', level:'both',
   summary:'Des notes synthétisées en direct, sans fichier son.',
   anchors:[
     {f:'js/components/component-synth.js', c:"static get typeName(){ return 'Synthesizer'; }"},
     {f:'js/synth.js', c:"volume: 0.7,"}
   ],
   html:function(){ return ''
     + essentialHelp('<p>Le <b>Synthétiseur</b> fabrique des sons (bips, notes, effets rétro) à partir de '
       + 'réglages, sans fichier audio. Chaque note a un <b>Id</b> qu\'un script peut jouer.</p>')
     + '<h3>Ajouter le composant</h3>'
     + addSteps('Synthétiseur', ['Ajoutez des <b>Notes</b>, puis <b>Écouter les notes</b>.'])
     + '<h3>Propriétés</h3>'
     + propsHelp([
       ['Volume', 'volume', '0.7', 'Volume général.'],
       ['Notes', 'voices', '[]', 'La liste des notes.'],
       ['Id / Libellé', 'id / label', '', 'Le nom de la note (utilisé par les scripts) et son libellé.'],
       ['Onde', 'wave', '', 'La forme d\'onde.'],
       ['Fréquence (Hz)', 'frequency', '', 'La hauteur, de 20 à 20000 Hz.'],
       ['Durée (s)', 'duration', '', 'La durée de la note.'],
       ['Attaque / Extinction (s)', 'attack / release', '', 'Montée et chute du volume.'],
       ['Gain', 'gain', '', 'Le volume de la note, de 0 à 2.']
     ])
     + scriptExamples([
       ['Un bip de saut : jouer la note d\'id « saut » quand l\'action « sauter » est déclenchée '
         + '(<code>actionPressed</code> ne répond qu\'à l\'appui, pas tant que la touche reste enfoncée).', [
         'function update(api){',
         '  if(api.actionPressed(\'sauter\')) api.playNote(\'saut\');',
         '}']],
       ['Une petite fanfare de victoire au contact du drapeau : trois notes à 0,15 s d\'écart.', [
         'function start(api){',
         '  api.onContact(\'joueur\', function(){',
         '    api.playNotes([\'do\', \'mi\', \'sol\'], {gap: 0.15});',
         '  });',
         '}']],
       ['Lister les notes disponibles dans la Console, pour retrouver leurs id :', [
         'function start(api){',
         '  api.log(api.notes());',
         '}']],
       ['Le même composant sait faire parler un personnage (synthèse vocale du navigateur) :', [
         'function start(api){',
         '  api.speak(\'Bienvenue au village !\');',
         '}']]
     ])
     + advancedHelp('Valeurs bornées', '<p>Chaque réglage est ramené dans son intervalle autorisé : une '
       + 'valeur hors bornes ou illisible est remplacée sans erreur.</p>')
     + trapHelp('<p><code>api.playNote</code> utilise le synthétiseur de l\'objet, sinon <b>le premier de la '
       + 'scène</b> : avec deux synthétiseurs, un même id peut jouer la note de l\'autre.</p>')
     + '<h3>Voir aussi</h3><ul>'
     + '<li>' + linkHelp('component-AudioSource', 'Source audio') + '</li>'
     + '<li>' + linkHelp('audio', 'L\'audio') + '</li>'
     + '</ul>'; }},

  {id:'component-AnimatorController', part:'components', section:'Animation', title:'Machine à états (AnimatorController)', level:'both',
   summary:'Choisit et enchaîne les animations d\'un modèle selon des paramètres.',
   anchors:[
     {f:'js/components/component-animator.js', c:"static get typeName() { return 'AnimatorController'; }"},
     {f:'js/component-data.js', c:"{assetId: null, target: ''}"}
   ],
   html:function(){ return ''
     + essentialHelp('<p>La ' + termHelp('Machine à états') + ' décide quelle animation joue (repos, '
       + 'marche, saut…) et comment passer de l\'une à l\'autre, selon des paramètres réglés par vos scripts.</p>')
     + '<h3>Ajouter le composant</h3>'
     + addSteps('Machine à états', ['Choisissez une <b>Machine</b> existante ou <b>Créer une machine…</b>.'])
     + '<h3>Propriétés</h3>'
     + propsHelp([
       ['Machine', 'assetId', 'aucune', 'L\'asset machine à états utilisé.'],
       ['Pilote', 'target', '', 'L\'objet animé, si ce n\'est pas celui qui porte le composant.']
     ])
     + '<h3>Utilisation</h3>'
     + '<p>Ouvrez l\'éditeur de machine pour créer les états et les transitions, puis pilotez-la par script.</p>'
     + scriptExamples([
       ['Passer de repos à marche selon la vitesse : le paramètre <code>vitesse</code> de la machine '
         + 'vaut 3 tant qu\'une flèche est enfoncée, 0 sinon.', [
         'let anim = null;',
         'function start(api){ anim = api.animator(); }',
         'function update(api){',
         '  if(!anim) return;',
         '  const bouge = api.key(\'ArrowLeft\') || api.key(\'ArrowRight\');',
         '  anim.setFloat(\'vitesse\', bouge ? 3 : 0);',
         '}']],
       ['Un saut : un déclencheur (trigger) consommé par la transition vers l\'état de saut.', [
         'function update(api){',
         '  const anim = api.animator();',
         '  if(anim && api.key(\' \')) anim.setTrigger(\'saut\');',
         '}']],
       ['Un booléen pour un état qui dure : accroupi tant que C est enfoncée.', [
         'function update(api){',
         '  const anim = api.animator();',
         '  if(anim) anim.setBool(\'accroupi\', api.key(\'c\'));',
         '}']],
       ['Piloter la machine d\'un autre objet : le garde passe en alerte quand le joueur le touche.', [
         'function start(api){',
         '  api.onContact(\'garde\', function(garde){',
         '    const anim = api.animator(garde);',
         '    if(anim) anim.setBool(\'alerte\', true);',
         '  });',
         '}']]
     ])
     + advancedHelp('Transitions', '<p>Chaque transition a des conditions, une priorité, une durée de fondu '
       + 'et des règles d\'interruption, réglables dans l\'inspecteur.</p>')
     + trapHelp('<p><code>api.animator()</code> rend <code>null</code> sur un objet sans machine : testez-le '
       + 'avant d\'appeler ses méthodes.</p>')
     + '<h3>Voir aussi</h3><ul>'
     + '<li>' + linkHelp('animator', 'La machine à états') + '</li>'
     + '<li>' + linkHelp('animation', 'L\'animation') + '</li>'
     + '</ul>'; }},

  {id:'component-SubScene', part:'components', section:'Monde', title:'Sous-scène (SubScene)', level:'both',
   summary:'Une instance d\'une autre scène du projet, avec ses overrides.',
   anchors:[
     {f:'js/components/component-subscene.js', c:"static get typeName() { return 'SubScene'; }"},
     {f:'js/components/component-subscene.js', c:"{ scene: '', overrides: {} }"}
   ],
   html:function(){ return ''
     + essentialHelp('<p>Une <b>Sous-scène</b> place une autre scène du projet dans la scène courante, '
       + 'comme un ' + termHelp('Prefab') + ' : une ' + termHelp('Scène imbriquée') + '. Modifier la scène '
       + 'source met à jour toutes ses instances.</p>')
     + '<h3>Ajouter le composant</h3>'
     + internalNote('quand vous instanciez une scène dans une autre')
     + '<h3>Propriétés</h3>'
     + propsHelp([
       ['Scène', 'scene', '', 'Le nom de la scène instanciée.'],
       ['Overrides', 'overrides', '{}', 'Les modifications locales appliquées par-dessus.']
     ])
     + scriptExamples([
       ['La sous-scène se règle dans l\'éditeur ; un script lit surtout quelle scène elle instancie :', [
         'function start(api){',
         '  const ss = api.me.getComponent(\'SubScene\');',
         '  if(ss) api.log(\'instance de « \' + ss.nameScene + \' »\');',
         '}']],
       ['Ses enfants se retrouvent par leur nom au moment où on en a besoin (pas de référence gardée '
         + 'longtemps, voir le piège ci-dessous) : allumer la lanterne d\'une maison instanciée.', [
         'function start(api){',
         '  api.onContact(\'joueur\', function(){',
         '    const lanterne = api.me.getObjectByName(\'Lanterne\');',
         '    if(lanterne) api.setActive(lanterne, true);',
         '  });',
         '}']],
       ['Masquer toute l\'instance (et arrêter ses scripts) d\'un coup :', [
         'function start(api){',
         '  api.setActive(api.me, false);',
         '}']]
     ])
     + advancedHelp('Contenu régénéré', '<p>Le contenu de l\'instance n\'est pas enregistré : il est '
       + 'régénéré depuis la scène source à chaque reconstruction, puis les overrides sont réappliqués.</p>')
     + trapHelp('<p>Les enfants d\'une sous-scène sont volatils : un script qui garde une référence à l\'un '
       + 'd\'eux peut la perdre après une reconstruction.</p>')
     + '<h3>Voir aussi</h3><ul>'
     + '<li>' + linkHelp('project', 'Le projet') + '</li>'
     + '</ul>'; }},

  {id:'component-Tag', part:'components', section:'Logique', title:'Tag (Tag)', level:'both',
   summary:'L\'étiquette de gameplay d\'un objet (« ennemi », « sol »…).',
   anchors:[
     {f:'js/components/component-tag.js', c:"static get typeName() { return 'Tag'; }"},
     {f:'js/components/component-tag.js', c:"if (tag && !existant) node.addComponent('Tag', {});"}
   ],
   html:function(){ return ''
     + essentialHelp('<p>Un ' + termHelp('Tag') + ' est une étiquette (« ennemi », « ramassable ») qui permet '
       + 'aux scripts et aux règles de retrouver des objets.</p>')
     + '<h3>Ajouter le composant</h3>'
     + internalNote('dès que vous saisissez un tag dans l\'inspecteur, et retiré quand le tag est vidé')
     + '<h3>Propriétés</h3>'
     + propsHelp([
       ['Tag', 'game.tag', '', 'Le texte de l\'étiquette.']
     ])
     + scriptExamples([
       ['Compter les ennemis restants et ouvrir la porte quand il n\'y en a plus :', [
         'function update(api){',
         '  if(api.byTag(\'ennemi\').length === 0) api.setActive(api.find(\'Porte\'), false);',
         '}']],
       ['Réagir différemment selon le tag de ce qu\'on touche (ici, l\'objet du script est le joueur) :', [
         'function start(api){',
         '  api.onContact(\'soin\', function(x){ api.log(\'+10 PV\'); api.destroy(x); });',
         '  api.onContact(\'piege\', function(){ api.status(\'Aïe !\'); });',
         '}']],
       ['Lire le tag d\'un objet, le sien ou celui d\'un autre :', [
         'function start(api){',
         '  api.log(api.tag());                       // le tag de cet objet',
         '  api.log(api.tag(api.find(\'Coffre\')));    // celui du coffre',
         '}']],
       ['Le plus proche ennemi, pour viser ou fuir :', [
         'function update(api){',
         '  let proche = null;',
         '  api.byTag(\'ennemi\').forEach(function(e){',
         '    if(!proche || api.distance(e) < api.distance(proche)) proche = e;',
         '  });',
         '  if(proche) api.lookAt(proche);',
         '}']]
     ])
     + advancedHelp('Un index', '<p>Le composant ne stocke rien : le tag vit dans les données de jeu de '
       + 'l\'objet. Il sert d\'index, pour que la recherche ne parcoure que les objets étiquetés.</p>')
     + trapHelp('<p>La comparaison est exacte : <code>\'Ennemi\'</code> et <code>\'ennemi\'</code> sont deux '
       + 'tags différents.</p>')
     + '<h3>Voir aussi</h3><ul>'
     + '<li>' + linkHelp('scripts-api', 'L\'API de script') + '</li>'
     + '<li>' + linkHelp('component-Events', 'Événements') + '</li>'
     + '</ul>'; }},

  {id:'component-Events', part:'components', section:'Logique', title:'Événements (Events)', level:'both',
   summary:'Des règles visuelles « Quand… Alors… », sans écrire de code.',
   anchors:[
     {f:'js/components/component-events.js', c:"static get typeName() { return 'Events'; }"},
     {f:'js/components/component-events.js', c:"delete this.node.userData.events;"}
   ],
   html:function(){ return ''
     + essentialHelp('<p>Le composant <b>Événements</b> contient des règles ' + termHelp('Quand… Alors…')
       + ' : « quand le joueur entre dans cette zone, alors jouer un son ». Aucun code n\'est nécessaire.</p>')
     + '<h3>Ajouter le composant</h3>'
     + addSteps('Événements', ['Ajoutez une règle, choisissez le <b>Quand</b> puis le <b>Alors</b>.'])
     + '<h3>Propriétés</h3>'
     + propsHelp([
       ['Règles', 'regles', '[]', 'La liste des règles de l\'objet.'],
       ['Quand', 'when', '', 'Le déclencheur (entrée dans une zone…).'],
       ['Alors', '', '', 'Les actions (montrer, jouer un son, changer de scène…).']
     ])
     + '<h3>Utilisation</h3>'
     + tipHelp('<p>Combinez-le avec un ' + linkHelp('component-Collider', 'Collider') + ' déclencheur et un '
       + linkHelp('component-Tag', 'Tag') + ' sur le joueur.</p>')
     + scriptExamples([
       ['Les règles s\'éditent dans l\'inspecteur, sans code ; un script n\'a rien à y piloter. Il peut en '
         + 'revanche les lire, par exemple pour vérifier qu\'un objet en porte :', [
         'function start(api){',
         '  const ev = api.me.getComponent(\'Events\');',
         '  api.log(ev ? ev.regles.length + \' règle(s)\' : \'aucune règle\');',
         '}']],
       ['Quand une règle ne suffit plus, le script prend le relais avec ses propres événements : '
         + 'un objet annonce <code>api.emit</code>, n\'importe quel autre l\'écoute avec <code>api.on</code>.', [
         '// sur le levier',
         'function start(api){',
         '  api.onContact(\'joueur\', function(){ api.emit(\'levier\', {ouvert: true}); });',
         '}',
         '',
         '// sur la porte',
         'function start(api){',
         '  api.on(\'levier\', function(d){ if(d.ouvert) api.setActive(api.me, false); });',
         '}']]
     ])
     + advancedHelp('Données', '<p>Les règles vivent dans les données de l\'objet ; retirer le composant '
       + 'les supprime.</p>')
     + trapHelp('<p>Retirer le composant <b>efface ses règles</b> avec lui.</p>')
     + '<h3>Voir aussi</h3><ul>'
     + '<li>' + linkHelp('component-ScriptJS', 'Script') + '</li>'
     + '</ul>'; }},

  {id:'component-ScriptJS', part:'components', section:'Logique', title:'Script (ScriptJS)', level:'both',
   summary:'Attache un script JavaScript du projet à un objet.',
   anchors:[
     {f:'js/components/component-script.js', c:"static get typeName() { return 'ScriptJS'; }"},
     {f:'js/components/component-script.js', c:"scriptId: opts.scriptId || null,"}
   ],
   html:function(){ return ''
     + essentialHelp('<p>Le composant <b>Script</b> relie un asset script du projet à l\'objet. Le script '
       + 'tourne pendant la lecture et dans le jeu ; ses fonctions <code>start(api)</code> et '
       + '<code>update(api)</code> pilotent l\'objet.</p>')
     + '<h3>Ajouter le composant</h3>'
     + addSteps('Script', ['Choisissez le script, ou <b>Éditer…</b> pour l\'ouvrir.'])
     + '<h3>Propriétés</h3>'
     + propsHelp([
       ['Script', 'scriptId', 'aucun', 'L\'asset script exécuté.'],
       ['(actif)', 'active', 'oui', 'Case d\'activation du composant.'],
       ['Variables exposées', 'values', '{}', 'Les valeurs des lignes <code>@expose</code>, propres à cet objet.']
     ])
     + scriptExamples([
       ['Un réglage par objet avec <code>@expose</code> : deux plateformes partagent le script, chacune sa vitesse.', [
         '/**',
         ' * @expose vitesse {number} = 3',
         ' */',
         'function update(api){',
         '  api.me.position.x += api.expose.vitesse * api.dt;',
         '}']],
       ['Lire les variables exposées du script d\'un autre objet (la vie réglée sur le boss) :', [
         'function start(api){',
         '  const sc = api.find(\'Boss\').getComponent(\'ScriptJS\');',
         '  if(sc) api.log(sc.values);',
         '}']],
       ['Couper l\'IA d\'un ennemi : désactiver l\'objet arrête aussi tous ses scripts.', [
         'function start(api){',
         '  api.onContact(\'joueur\', function(){ api.setActive(api.find(\'Ennemi\'), false); });',
         '}']],
       ['Une minuterie plutôt qu\'un compteur dans <code>update</code> : exploser 3 secondes après le départ.', [
         'function start(api){',
         '  api.after(3, function(){',
         '    api.particles().emit(80);',
         '    api.destroy(api.me);',
         '  });',
         '}']]
     ])
     + advancedHelp('Le code est sur l\'asset', '<p>Le composant ne garde que l\'identifiant du script et les '
       + 'valeurs exposées. Éditer l\'asset modifie toutes les instances qui l\'utilisent.</p>')
     + trapHelp('<p>Une ligne <code>@expose</code> mal formée est ignorée en silence : pas de champ, pas '
       + 'd\'erreur.</p>')
     + '<h3>Voir aussi</h3><ul>'
     + '<li>' + linkHelp('scripts', 'Les scripts') + '</li>'
     + '<li>' + linkHelp('scripts-api', 'L\'API de script') + '</li>'
     + '</ul>'; }}
];
