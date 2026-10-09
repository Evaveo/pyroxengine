// ---------- Aide de l'éditeur : le CONTENU ----------
// Chargé par help.html uniquement. L'éditeur ne le charge pas : il n'a besoin que de
// js/help.js, qui ouvre cette page.
//
// POURQUOI CE DOCUMENT EXISTE, ET CE QU'ON N'Y MET PAS. Les documents de docs/
// s'adressent à l'équipe ; ceci s'adresse à quelqu'un qui a l'éditeur open et une
// question maintenant. On n'écrit donc PAS ce qui se lit sur les boutons. On écrit ce
// qu'on ne peut pas deviner en regardant l'interface : des conventions, des unités, des
// valeurs par défaut, et surtout des pièges silencieux.
//
// RÈGLE DE CONTENU, ET ELLE EST VÉRIFIÉE. Chaque affirmation doit être vraie du code de
// CE dépôt, aujourd'hui. Une aide qui décrit un logiciel légèrement différent de celui
// qu'on a sous les yeux est pire que pas d'aide : elle fait douter du reste, y compris
// de ce qui est juste.
//
// Le champ `anchors` de chaque page N'EST PAS DE LA DOCUMENTATION : c'est la liste des
// bouts de code exacts qui portent les chiffres et les comportements affirmés dans la
// page. test/aide.test.mjs vérifie que chacun existe encore, mot pour mot, dans le
// fichier nommé. Changer −9,82 en −9,81 dans le moteur fait ROUGIR l'aide, au lieu de la
// laisser mentir en silence. Une page sans ancre est refusée par le test.

// Les briques de mise en forme et les parties du manuel vivent dans js/help/.
import { renderApiHelp, renderCommandsHelp, renderPropsMaterialHelp, renderShortcutsHelp } from './help-page.js';
import { PARTS_HELP, TAGS_BUILD_FULL, arrayHelp, defaultHelp, linkHelp, termHelp } from './help/help-format.js';
import { PAGES_START } from './help/pages-start.js';
import { PAGES_INTERFACE } from './help/pages-interface.js';
import { PAGES_WORKFLOWS } from './help/pages-workflows.js';
import { PAGES_COMPONENTS } from './help/pages-components.js';
import { PAGES_SCRIPTING } from './help/pages-scripting.js';
import { PAGES_TUTORIALS } from './help/pages-tutorials.js';
import { PAGES_REFERENCE } from './help/pages-reference.js';
export { PARTS_HELP, TAGS_BUILD_FULL, arrayHelp, defaultHelp, linkHelp, termHelp };

// ---------- Raccourcis ----------
// Table unique : la page « Raccourcis » en est le rendu, et le test vérifie que le bout
// de code cité en `preuve` existe encore dans le fichier qui traite la touche. Un
// raccourci supprimé du moteur ne peut donc pas rester listé ici.
export const SHORTCUTS_HELP = [
  {group:'Sélection et gizmo'},
  {key:'Clic', effet:'Sélectionner. Un clic ne SAISIT pas : un objet ne se déplace qu\'au gizmo.',
   file:'js/viewport.js', proof:'if(e.button !== 0) return false;'},
  {key:'Clic dans le vide + glisser', effet:'Rectangle de sélection multiple. Un clic dans le vide sans glisser désélectionne.',
   file:'js/viewport.js', proof:'rubberBand.active = true;'},
  {key:'Maj + rectangle', effet:'Le rectangle S\'AJOUTE à la sélection au lieu de la remplacer.',
   file:'js/viewport.js', proof:'rubberBand.additif = e.shiftKey;'},
  {key:'Ctrl + clic', effet:'Ajouter / retirer un objet de la sélection multiple.',
   file:'js/viewport.js', proof:'if(keyObj && (e.ctrlKey || e.metaKey)){'},
  {key:'1 / 2 / 3', effet:'Gizmo : déplacer / tourner / mettre à l\'échelle.',
   file:'js/viewport.js', proof:"if(e.key === '1') setModeGizmo('translate');"},
  {key:'F', effet:'Cadrer la caméra sur la sélection.',
   file:'js/viewport.js', proof:"if(e.key === 'f' || e.key === 'F') frameSelection();"},
  {key:'Suppr', effet:'Supprimer la sélection (Retour arrière fait la même chose).',
   file:'js/viewport.js', proof:"(e.key === 'Delete' || e.key === 'Backspace') && selection"},

  {group:'Édition'},
  {key:'Ctrl + Z', effet:'Annuler. Ctrl + Maj + Z rétablit, comme Ctrl + Y.',
   file:'js/viewport.js', proof:'if(e.shiftKey) restore(); else undo();'},
  {key:'Ctrl + Y', effet:'Rétablir.',
   file:'js/viewport.js', proof:"if(ctrl && (e.key === 'y' || e.key === 'Y'))"},
  {key:'Ctrl + C / Ctrl + V', effet:'Copier / coller la sélection.',
   file:'js/viewport.js', proof:'pasteClipBoard();'},
  {key:'Ctrl + D', effet:'Dupliquer la sélection.',
   file:'js/viewport.js', proof:'duplicateSelection();'},

  {group:'Caméra'},
  {key:'Clic droit + glisser', effet:'Vol libre : la souris regarde, W/A/S/D avancent et vont sur les côtés, Q/E descendent et montent.',
   file:'js/viewport.js', proof:"CODES_FLY_FREE = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'])"},
  {key:'Molette', effet:'Zoom. En vol libre, la molette règle la VITESSE de vol, pas le zoom (de 0,5 à 60).',
   file:'js/viewport.js', proof:'flyFree.speed = Math.max(0.5, Math.min(60,'},
  {key:'Clic molette + glisser', effet:'Panoramique.',
   file:'js/viewport.js', proof:"mode = 'pan';"},

  {group:'Lecture et aide'},
  {key:'Espace', effet:'Lance ou arrête la lecture dans la vue : les clés de la timeline, l\'animation importée du modèle sélectionné, ET les scripts. Sans rien de tout cela, un message le dit et rien ne démarre.',
   file:'js/animation.js', proof:'const aQuelqueChoseAPlay'},
  {key:'Échap', effet:'Dans l\'ordre : ferme la fenêtre ouverte, sinon ferme le menu, sinon vide la sélection multiple, sinon quitte la vue à travers une caméra.',
   file:'js/viewport.js', proof:"if(e.key === 'Escape')"},
  {key:'F1', effet:'Ouvre cette aide, même quand le curseur est dans un champ de saisie.',
   file:'js/viewport.js', proof:"if(e.key === 'F1')"},

  {group:'Sculpture de terrain (pendant la sculpt seulement)'},
  {key:'Glisser', effet:'Applique le pinceau.',
   file:'js/terrain.js', proof:'sculpt.inProgress'},
  {key:'Maj', effet:'Inverse le pinceau — mais pour « Élever » et « Creuser » uniquement.',
   file:'js/terrain.js', proof:'const signe = invert ? -1 : 1;'},
  {key:'Molette', effet:'Rayon du pinceau, de 0,5 à 40 m.',
   file:'js/terrain.js', proof:'sculpt.radius = Math.max(0.5, Math.min(40,'},
  {key:'Échap', effet:'Quitte la sculpt.',
   file:'js/terrain.js', proof:'stopSculpt();'}
];



// ---------- Catalogue du copilote ----------
// Le test compare cette liste à COMMANDS dans les DEUX sens : une commande retirée du
// moteur, ou ajoutée sans être documentée, fait rougir l'aide.
//
// `COMMANDS` est alimenté par TROIS fichiers — js/copilot.js le déclare, puis
// js/copilot-workshop.js et js/copilot-observer.js y poussent les leurs. Le test n'en
// lisait qu'un, et cette liste avait perdu seize commandes sans que rien ne rougisse. Il
// lit désormais les trois, et exige que chacun ait contribué.
//
// L'ORDRE EST CELUI DU MOTEUR, pas un ordre thématique : c'est ce qui rend l'oubli visible
// à la relecture, une commande ajoutée arrivant toujours à la fin de son groupe.
export const COMMANDS_HELP = [
  {name:'list_scene', quoi:'Inventaire de la scène : name, type, position, TAILLE réelle, étendue, échelle, tag, parent, physique, nombre de scripts.'},
  {name:'analyze_scene', quoi:'Passe l\'analyseur et renvoie ce qu\'il signale.'},
  {name:'audit_project', quoi:'Audit de STRUCTURE du projet : script qui porte tout le jeu, niveau généré au lancement, scène vide, réglages en dur sans @vars, objets et assets en vrac. Dit quoi corriger pour que le créateur puisse tout retoucher.'},
  {name:'get_object', quoi:'Tout ce que porte un objet : composants et valeurs, matériau, physique, scripts avec leur source, enfants.'},
  {name:'find_objects', quoi:'Cherche des objets par nom, tag, composant, type, calque ou proximité. Paginé.'},
  {name:'get_hierarchy', quoi:'Arbre compact de la scène ou d\'une branche, borné en profondeur.'},
  {name:'read_script', quoi:'Source complète d\'un script (par asset ou par objet).'},
  {name:'read_console', quoi:'Dernières lignes de la console : logs du jeu, erreurs de scripts, exceptions.'},
  {name:'load_tools', quoi:'Charge les outils d\'un domaine (2D, audio, interface, rendu…) pour la suite de la conversation : seul le noyau est envoyé d\'office, pour réduire le coût.'},
  {name:'batch', quoi:'Exécute plusieurs commandes à la suite en un seul appel, et rend un résultat court par commande.'},
  {name:'build_room', quoi:'Construit une pièce : sol, murs percés de portes, plafond en option, sous un parent.'},
  {name:'create_object', quoi:'Crée un objet d\'un des types créables.'},
  {name:'delete_object', quoi:'Supprime un objet — et ses enfants avec lui.'},
  {name:'rename_object', quoi:'Renomme un objet.'},
  {name:'transform', quoi:'Position, rotation (en degrés) et échelle. Seuls les champs fournis changent.'},
  {name:'set_parent', quoi:'Attache un objet à un parent, ou le remet à la racine.'},
  {name:'describe_material', quoi:'Renvoie la liste exacte des propriétés de matériau, avec leurs plages — la même table que l\'inspecteur.'},
  {name:'configure_material', quoi:'Écrit des propriétés de matériau, validées contre cette table.'},
  {name:'configure_physics', quoi:'Corps rigide et collider.'},
  {name:'configure_game', quoi:'Réglages de la section Jeu : tag, calque, propriétés personnalisées.'},
  {name:'manage_layers', quoi:'Liste, crée, renomme, masque/affiche, verrouille ou retire un calque du projet.'},
  {name:'attach_script', quoi:'AJOUTE un script à un objet. Le script est un asset nommé (script) et rangé (folder, défaut Scripts) ; sans code, script réutilise un asset existant.'},
  {name:'replace_script', quoi:'Remplace un script existant — c\'est ce qu\'il faut pour CORRIGER.'},
  {name:'remove_script', quoi:'Retire un script d\'un objet.'},
  {name:'set_script_vars', quoi:'Écrit les valeurs d\'inspecteur (@vars) d\'un objet précis.'},
  {name:'script_api_reference', quoi:'Référence de l’api de script (api.*), filtrable et paginée.'},
  {name:'duplicate_object', quoi:'Duplique un objet avec ses scripts, son matériau et son tag.'},
  {name:'create_prefab', quoi:'Transforme un objet en prefab réutilisable ; l\'objet source devient sa première instance liée.'},
  {name:'instantiate_prefab', quoi:'Pose un nouvel exemplaire lié d\'un prefab existant.'},
  {name:'instantiate_model', quoi:'Pose un nouvel exemplaire d\'un modèle importé (glTF/FBX) déjà présent dans le projet.'},
  {name:'configure_material_pbr', quoi:'Règle les propriétés — y compris les maps PBR — de l\'asset matériau partagé d\'un objet.'},
  {name:'configure_animator', quoi:'Attache une machine à états (Animator) à un objet 3D, en créant son asset si besoin.'},
  {name:'read_animator_machine', quoi:'Renvoie la machine à états d\'un objet, ses clips disponibles et les animations du projet.'},
  {name:'write_animator_machine', quoi:'Remplace la machine à états d\'un objet (états, paramètres, transitions) et signale les problèmes.'},
  {name:'configure_ui_document', quoi:'Attache une interface HTML/CSS (UIDocument) à un objet, en créant ses assets document/feuilles si besoin.'},
  {name:'write_ui_document', quoi:'Remplace le HTML de l\'interface d\'un objet.'},
  {name:'write_ui_stylesheet', quoi:'Remplace le CSS d\'une feuille de style attachée à un objet.'},
  {name:'configure_inputs', quoi:'Modifie la table d\'entrées (actions et axes).'},
  {name:'create_data', quoi:'Crée une table de contenu, lisible depuis un script par api.data(name).'},
  {name:'add_event', quoi:'Ajoute un événement visuel à un objet.'},
  {name:'configure_particles', quoi:'Règle un émetteur de particules.'},
  {name:'generate_terrain', quoi:'Engendre un relief procédural et règle les couleurs par altitude.'},
  {name:'configure_environment', quoi:'Ciel, lumière ambiante, brouillard.'},
  {name:'configure_post_volume', quoi:'Crée/configure un PostVolume et le profil d\'effets (bloom, vignette, grain, tone mapping, color grading) qui lui est associé.'},
  {name:'configure_reflection_probe', quoi:'Règle une sonde de réflexion : rayon, résolution du cubemap, intensité, cuisson auto, projection boîte.'},
  {name:'bake_reflection_probes', quoi:'Cuit (ou recuit) le cubemap d\'une ou plusieurs sondes de réflexion sans attendre le mode lecture.'},
  {name:'bake_lightmaps', quoi:'Cuit les lightmaps de la scène ou d\'objets précis (résolution, images, rebonds, débruitage) et les affecte aux matériaux.'},
  {name:'configure_camera', quoi:'Règle une caméra 3D : field of view, near/far, caméra principale, calques visibles.'},
  {name:'list_assets', quoi:'Liste les assets du projet.'},
  {name:'manage_scenes', quoi:'Crée, renomme, supprime, change de scène.'},
  {name:'instantiate_subscene', quoi:'Instancie une autre scène du projet dans celle-ci.'},
  {name:'set_play_mode', quoi:'Ouvre l\'aperçu du jeu dans un onglet indépendant — il ne peut pas l\'arrêter.'},
  // Les commandes 2D. `create_object` fabrique des maillages 3D : la 2D a besoin des siennes (sprite,
  // tuiles, caméra ortho). Le refus d'un composant 2D sur un nœud 3D a disparu en v0.91.0.
  {name:'create_object_2d', quoi:'Crée un sprite, une map de tuiles, une caméra ou un objet vide dans le monde 2D.'},
  {name:'slice_sheet', quoi:'Découpe une planche en grille — à faire avant toute animation ou map de tuiles.'},
  {name:'add_palette_tiles', quoi:'Ajoute à une palette de tuiles existante les tuiles d’une autre planche.'},
  {name:'paint_room', quoi:'Peint une map de tuiles depuis un plan en texte, une ligne par rangée. Le moteur choisit la tuile selon les quatre voisins et regroupe les collisions en bandes.'},
  {name:'read_room', quoi:'Rend le plan en texte d\'une map de tuiles — à lire avant de repeindre, qui écrase tout.'},
  {name:'configure_sprite', quoi:'Choisit l\'image qu\'un objet 2D montre dans sa planche, son calque, son ordre, sa teinte, son miroir, et le tri par profondeur (qui ne joue qu\'à l\'intérieur d\'un même calque, comme les Sorting Layers d\'Unity). Une image absente de la planche est refusée : sans ce contrôle, le moteur retombe sur la première et l\'on croit avoir posé une pose qu\'on ne regarde pas.'},
  {name:'configure_physics_2d', quoi:'Corps, boîte de collision et contrôleur de personnage 2D. La hauteur de saut se règle en unités, pas en vitesse ; le contrôleur a deux vues, « plateforme » et « dessus ».'},
  {name:'configure_sprite_animation', quoi:'Crée des suites d\'animation sur la planche, et règle l\'animateur d\'un objet.'},

  // L'atelier (js/copilot-workshop.js). Ces commandes-là ne modifient pas seulement la
  // scène : elles FABRIQUENT ce qui manquait, ou permettent de se tromper sans perdre son
  // travail. Sans elles, le modèle savait construire un niveau — mais un niveau sans image,
  // sans son, et dont chaque error coûtait un nombre inconnu d'annulations.
  {name:'import_image', quoi:'IMPORTE un PNG (base64) comme asset texture, et le découpe en planche si une taille de case est donnée : le chemin pour poser un pixel art dessiné soi-même.'},
  {name:'link_sprite_texture', quoi:'RELIE une planche de sprite à une texture du projet sans toucher à sa découpe : répare une planche qui a perdu son image.'},
  {name:'bake_iso_sprites', quoi:'CUIT des sprites isométriques (vue d’Age of Empires) depuis un modèle 3D en primitives JSON : 1 à 16 directions, plusieurs poses, ombre portée, masque de couleur d’équipe, et la table des points d’ancrage.'},
  {name:'create_texture', quoi:'FABRIQUE une image et l\'ajoute au projet, sans aucun fichier source : planche de 16 tuiles prête pour l\'auto-tuilage, planche de personnage, uni, damier, dégradé, bruit.'},
  {name:'configure_network', quoi:'Lit ou modifie les réglages multijoueur du projet : relais ou pair-à-pair, serveur, clé de jeu, joueurs max, cadence d’envoi, serveurs ICE.'},
  {name:'configure_camera_2d', quoi:'Règle une caméra 2D : cadrage, pixels par unité, objet suivi, bounds du niveau.'},
  {name:'resize_tilemap', quoi:'Change la taille de la grille d\'une map, ou celle d\'une tuile. Ce qui est peint est conservé.'},
  {name:'build_atlas', quoi:'Réunit plusieurs planches en une seule — un animateur de sprite lit toutes ses suites dans UNE planche.'},
  {name:'configure_light', quoi:'Couleur, intensité, portée, et l\'angle et la pénombre d\'un spot.'},
  {name:'checkpoint', quoi:'Enregistre l\'état complet de la scène sous un nom. À poser AVANT une piste dont on n\'est pas sûr.'},
  {name:'save_project', quoi:'ENREGISTRE le projet (cloud ou dossier). Rien de ce que fait le copilote n’est enregistré sans lui : un rechargement perd tout.'},
  {name:'delete_asset', quoi:'Supprime un asset du projet — refusé tant qu’un objet l’utilise, et refusé sur un asset validé sans confirmation de l’utilisateur.'},
  {name:'validate_asset', quoi:'Marque un asset comme VALIDÉ par l’utilisateur : l’IA ne le supprime ni ne l’écrase plus sans son accord, et l’audit signale toute modification.'},
  {name:'move_asset', quoi:'Range un asset dans un dossier du panneau Projet (ex. Scripts/Joueur).'},
  {name:'go_back', quoi:'Revient à un point de reprise — et ce retour est lui-même annulable.'},
  {name:'read_design', quoi:'Lit le document de conception : l\'intention, les contraintes, ce qui a été écarté. La scène dit ce qui EST, jamais ce qu\'on voulait.'},
  {name:'write_design', quoi:'Écrit ou complète ce document. Ce qui a été essayé sans succès est ce qui compte le plus.'},
  {name:'configure_audio', quoi:'Attache un son à un objet et le règle, atténuation et bus de mixage compris.'},
  {name:'configure_audio_mix', quoi:'Lit ou règle le volume des bus Master, Musique et Effets sonores du projet.'},
  {name:'create_sfx', quoi:'FABRIQUE un bruitage réglable (saut, pièce, laser, explosion…) dont la recette reste modifiable.'},
  {name:'edit_sfx', quoi:'Retouche la recette d\'un bruitage : seuls les champs donnés changent.'},
  {name:'mutate_sfx', quoi:'Une variante voisine d\'un bruitage, pour choisir à l\'oreille.'},
  {name:'create_music_loop', quoi:'COMPOSE une boucle : percussions, basse, mélodie et accords dans une tonalité et une gamme.'},
  {name:'edit_music_loop', quoi:'Retouche une boucle ; changer tonalité ou gamme transpose et recale les notes.'},
  {name:'read_sound_asset', quoi:'Relit la recette d\'un bruitage ou d\'une boucle, retouches faites à la main comprises.'},
  {name:'create_sound', quoi:'FABRIQUE un bruitage sans fichier source — bip, saut, chute, impact, pas, pièce.'},
  {name:'play_sound', quoi:'Joue un son une fois, tout de suite : un nom de fichier ne dit pas ce qu\'on entend.'},
  // Le contenu en ASSETS (fin de js/copilot-workshop.js). Sans eux, un agent MCP avait mis tout un
  // jeu — statistiques, modèles, sons — dans un seul script, invisible dans le panneau Projet.
  {name:'create_material', quoi:'Crée un asset MATÉRIAU sans objet porteur, avec ses propriétés et ses maps : visible dans le panneau Projet, affecté ensuite aux objets.'},
  {name:'import_model', quoi:'IMPORTE un modèle 3D glTF / GLB (base64) comme asset, matériaux et clips compris, pour le poser ensuite avec instantiate_model.'},
  {name:'import_audio', quoi:'IMPORTE un vrai fichier son (mp3, wav, ogg, m4a) comme asset audio.'},
  {name:'read_data', quoi:'Relit une table de contenu, retouches faites à la main comprises, avant de la réécrire.'},
  {name:'write_animation', quoi:'Crée ou réécrit un CLIP d\'animation à clés (position, rotation, échelle, courbes), éditable ensuite dans la timeline.'},
  {name:'write_script_asset', quoi:'Écrit un asset script SANS l\'attacher : une bibliothèque partagée (lue par api.lib) ou un script à poser plus tard. Même contrôle que attach_script.'},
  {name:'configure_fog_of_war', quoi:'Pose ou règle le BROUILLARD DE GUERRE (grille, équipe du joueur, alliés, couleurs) sur un objet, et la VISION (rayon, équipe, mémoire) des unités, bâtiments et ressources.'},
  {name:'configure_team_color', quoi:'Pose ou règle la COULEUR D\'ÉQUIPE d\'un objet : ses maillages dont le matériau porte le nom donné (Team par défaut) sont teints pour lui seul. Un seul modèle sert ainsi à tous les joueurs.'},
  {name:'read_asset', quoi:'Relit le contenu sérialisé de n\'importe quel asset (matériau, table, animation, bruitage, UI, prefab…) pour le retoucher au lieu de le refaire.'},
  {name:'summarize_scene', quoi:'Résumé compact du projet. À préférer à list_scene pour se repérer, qui rend tout sans rien apprendre.'},

  // L'observateur (js/copilot-observer.js) : les trois seules commandes qui rendent au
  // modèle la possibilité de CONSTATER au lieu de supposer.
  {name:'capture_view', quoi:'Rend une IMAGE de la vue d\'édition.'},
  {name:'play_and_measure', quoi:'Lance la vraie page de jeu, relève les positions au fil du temps, et rend une image. La SEULE qui dise si le jeu fonctionne.'},
  {name:'check', quoi:'Les nombres qui décident : rapport pixel de chaque caméra, boîtes de collision, problèmes de chaque map.'},

  // Blender (js/copilot-blender.js) : relayées à l'addon EVAVEO Blender Bridge, pour une IA
  // branchée par MCP. Le panneau Fenêtres → Atelier Blender fait les gestes courants à la main.
  {name:'blender_project', quoi:'Blender : nouveau projet, checkpoint, retour à un checkpoint, réglages (budget, fps, rendu).'},
  {name:'blender_geometry', quoi:'Blender : modélisation libre — mesh, sweep, lathe, extrusion, modificateurs, transformation, fusion, édition de sommets.'},
  {name:'blender_material', quoi:'Blender : matériaux PBR (cartes, procéduraux), affectation par objet ou par faces, texture ORM.'},
  {name:'blender_uv', quoi:'Blender : dépliage, coutures, transformation d\'UV, UV de lightmap.'},
  {name:'blender_rig', quoi:'Blender : squelette libre ou humanoïde, liaison, poids, IK, shape keys.'},
  {name:'blender_animation', quoi:'Blender : clips à clés (os ou objet), clips de shape keys, poses, cycles d\'essai.'},
  {name:'blender_inspect', quoi:'Blender : audit de topologie et de budget, sommets indexés, détail d\'un objet.'},
  {name:'blender_import', quoi:'Blender : importe un modèle envoyé par l\'Atelier, ou pose un concept art en image de référence.'},
  {name:'blender_delivery', quoi:'Blender : atlas PBR, export GLB/FBX/OBJ avec LOD et collisions, bake d\'occlusion.'},
  {name:'blender_status', quoi:'Blender : état de la liaison avec l\'addon, ou d\'une opération longue (job).'},
  {name:'blender_scene', quoi:'Blender : inventaire du projet Blender (objets, matériaux, rigs, clips, exports).'},
  {name:'blender_preview', quoi:'Blender : REND le modèle et renvoie l\'image (quatre vues ou turntable).'},
  {name:'blender_import_to_project', quoi:'Blender : exporte en GLB et IMPORTE dans le projet, comme un glisser-déposer.'}
];


// ---------- L'objet api des scripts ----------
// Le test vérifie que chaque `name` est bien une entrée de l'objet renvoyé par apiFor()
// (js/scripts.js). Une entrée renommée dans le moteur ne peut pas survivre ici.
//
// test/miroir-api-script.test.mjs vérifie l'AUTRE sens, qui manquait : une entrée du moteur
// sans ligne ici est une entrée que personne ne trouvera, cette table étant le seul
// catalogue. Trois y manquaient — dont une qui ne fonctionnait pas.
export const API_HELP = [
  {group:'Contexte'},
  {name:'me', sig:'api.me', quoi:'L\'objet three.js qui porte le script — un <code>Object3D</code> brut. Il n\'y a pas d\'accesseur maison : on écrit directement <code>api.me.position</code>, <code>api.me.rotation</code> (en <b>radians</b>), <code>api.me.quaternion</code>, <code>api.me.scale</code>, et toutes les méthodes de three.js sont là — <code>translateZ</code>, <code>rotateY</code>, <code>getWorldPosition</code>… Voir « Déplacer, tourner, redimensionner » plus bas.'},
  {name:'node', sig:'api.node', quoi:'Le MÊME objet que <code>api.me</code>, sous le nom qu\'attend quelqu\'un venu d\'un autre moteur : <code>api.node.getComponent(\'Mesh\')</code>.'},
  {name:'dt', sig:'api.dt', quoi:'Durée de l\'image en secondes. Tout ce qui bouge se multiplie par elle.'},
  {name:'time', sig:'api.time', quoi:'Secondes écoulées depuis le début de la lecture.'},
  {name:'scene', sig:'api.scene', quoi:'La scène three.js complète (avancé).'},
  {name:'expose', sig:'api.expose', quoi:'Les variables <code>@expose</code> de CE script, réglées dans l\'inspecteur.'},

  {group:'Trouver des objets'},
  {name:'find', sig:'api.find(name)', quoi:'L\'objet portant ce nom, ou <code>null</code>.'},
  {name:'findNode', sig:'api.findNode(name)', quoi:'Exactement <code>api.find</code>, sous un autre nom.'},
  {name:'byTag', sig:'api.byTag(tag)', quoi:'Tous les objets portant ce tag (section Jeu de l\'inspecteur).'},
  {name:'findByTag', sig:'api.findByTag(tag)', quoi:'Exactement <code>api.byTag</code>, sous un autre nom. <b>Rendait toujours un tableau vide avant la v0.68.0</b> : il cherchait le tag au mauvais endroit, sans rien signaler — et un tableau vide se lit comme « il n\'y a pas d\'ennemis dans la scène ».'},
  {name:'byLayer', sig:'api.byLayer(calque)', quoi:'Tous les objets de ce calque.'},
  {name:'bounds', sig:'api.bounds(cible?)', quoi:'Dimensions RÉELLES : <code>{min, max, taille, centre}</code>, ou <code>null</code> si l\'objet n\'a aucune géométrie.'},
  {name:'distance', sig:'api.distance(a, b?)', quoi:'Distance monde entre deux objets ; <code>b</code> vaut soi-même par défaut.'},
  {name:'raycast', sig:'api.raycast(origine, direction, distance?, filtre?)', quoi:'Premier impact, ou <code>null</code>. Le filtre <code>{tag}</code> / <code>{calque}</code> ignore ce qui ne compte pas — sans lui, seul le tout premier objet touché est rendu.'},
  {name:'overlapSphere', sig:'api.overlapSphere(position, rayon)', quoi:'Les objets dont la boîte coupe cette sphère.'},
  {name:'overlaps2d', sig:'api.overlaps2d(cible, autre?)', quoi:'Les deux boîtes <b>2D</b> se touchent-elles ? <code>autre</code> vaut soi-même par défaut. C\'est la brique des portes, des ramassages et des zones de coup. Elle prend le <b>Collider2D</b> s\'il y en a un, sinon l\'étendue du sprite — de sorte qu\'un déclencheur peut être détecté <b>sans</b> collider, donc sans bloquer le passage.'},
  {name:'spriteImage', sig:'api.spriteImage(nomImage)', quoi:'Choisit l\'image affichée par le <b>SpriteRenderer</b> de cet objet, parmi celles découpées dans sa planche. Prend aussi <code>(cible, nomImage)</code> pour agir sur un autre objet. Sur une planche vue de dessus, chaque case est un couple <b>direction × état</b> et aucune animation ne les enchaîne : c\'est le jeu qui décide, à chaque image, laquelle montrer. Rend <code>false</code> si l\'image n\'existe pas dans la planche.'},
  {name:'aim2d', sig:'api.aim2d(cible?)', quoi:'La <b>direction regardée</b> par un contrôleur en vue de dessus, sous la forme <code>{x, y}</code> — la dernière direction où l\'objet s\'est déplacé, conservée à l\'arrêt. Elle sert à choisir la bonne case avec <code>api.spriteImage</code> et à orienter un coup. Rend <code>{x:0, y:0}</code> sur un objet qui n\'a jamais bougé.'},
  {name:'mouse', sig:'api.mouse()', quoi:'La position du pointeur, en coordonnées <b>normalisées</b> : <code>x</code> et <code>y</code> vont de <code>-1</code> à <code>+1</code>, origine au centre de la vue, <code>y</code> vers le haut. C\'est la forme qui ne change pas quand la fenêtre change de taille — celle dont on a besoin pour viser ou pour choisir une colonne. <code>px</code> et <code>py</code> donnent les pixels, <code>dans</code> dit si le pointeur est sur la vue.'},
  {name:'click', sig:'api.click(button?)', quoi:'Le bouton de souris est-il <b>enfoncé</b> ? <code>0</code> = gauche (défaut), <code>1</code> = molette, <code>2</code> = droit. Vrai tant qu\'on maintient.'},
  {name:'clickHeld', sig:'api.clickHeld(button?)', quoi:'Le bouton vient-il d\'être <b>pressé</b> à cette image ? Le pendant de <code>api.actionPressed</code> pour la souris : c\'est ce qu\'il faut pour tirer UN coup par clic, là où <code>api.click</code> en tirerait soixante par seconde.'},
  {name:'mouseDelta', sig:'api.mouseDelta()', quoi:'Le <b>déplacement</b> de la souris depuis l’image précédente, en pixels : <code>{x, y}</code>. C’est ce qu’il faut pour une vue à la première personne ou une caméra libre, et <code>api.mouse()</code> n’y sert à rien : sous capture du pointeur, la position ne bouge <b>plus du tout</b>, et sans capture elle bute sur le bord de la fenêtre au bout d’un quart de tour. Les déplacements de l’image sont <b>cumulés</b> puis remis à zéro : plusieurs événements arrivent entre deux rendus, et n’en garder qu’un rendrait la visée plus lente quand le jeu rame.'},
  {name:'lockMouse', sig:'api.lockMouse(voulu?)', quoi:'Demande (ou rend) la <b>capture du pointeur</b> : le curseur disparaît, la souris ne peut plus sortir de la vue, et <code>api.mouseDelta()</code> continue de mesurer. La capture ne s’obtient que dans un <b>geste utilisateur</b> — l’appel depuis un script pose donc l’<i>intention</i>, et c’est le prochain clic qui la réalise. Échap rend la main au joueur ; l’intention restant posée, le clic suivant reprend la capture. <code>api.lockMouse(false)</code> la relâche pour de bon (menu, fin de partie).'},
  {name:'mouseLocked', sig:'api.mouseLocked()', quoi:'La souris est-elle <b>capturée en ce moment</b> ? Le seul moyen de savoir qu’Échap vient de rendre la main : un FPS s’y met en pause et affiche « cliquez pour reprendre ».'},
  {name:'tileAt', sig:'api.tileAt(point?)', quoi:'Le numéro de matériau de la case de tuiles sous ce point du <b>monde</b> — <code>0</code> pour du vide ou hors map. Sans argument, la case sous l\'objet lui-même. Accepte aussi <code>(map, point)</code> quand la scène en compte plusieurs. C\'est ainsi qu\'on demande « qu\'est-ce que j\'ai sous les pieds » : de la lave, de l\'eau, un sol qui glisse.'},
  {name:'setTile', sig:'api.setTile(point?, materiau)', quoi:'Écrit une case de la map : <code>0</code> l\'efface, <code>1</code> pose le premier matériau. La map est <b>reconstruite</b> dans la foulée — l\'affichage <i>et</i> les collisions. Sans ça, une porte ouverte resterait dessinée et continuerait de bloquer. Rend <code>false</code> hors de la grille.'},
  {name:'camera2d', sig:'api.camera2d(reglages?)', quoi:'Lit les réglages de la caméra 2D principale, ou en écrit une partie : <code>ppu</code> (zoom), <code>suit</code> (objet suivi, <code>null</code> pour libérer), <code>hautDeVue</code>, bounds du niveau. Seules les clés fournies changent. Sans argument, elle ne fait que lire — de quoi sauver un cadrage avant de zoomer puis le rendre.'},
  {name:'playSequence', sig:'api.playSequence(name, forcer?)', quoi:'Lance une suite d\'animation de sprite sur cet objet — celles créées par <code>configure_sprite_animation</code>. Accepte aussi <code>(cible, name)</code>. Rejouer la suite <b>déjà en cours</b> ne la redémarre pas : appeler <code>jouerSuite(\'course\')</code> à chaque image est ce qu\'on écrit sans y penser, et sans cette garde le personnage resterait figé sur sa première image. Passez <code>forcer</code> pour redémarrer quand même.'},
  {name:'currentSequence', sig:'api.currentSequence(cible?)', quoi:'Le nom de la suite d\'animation en train de jouer, ou une chaîne vide. Sert à ne pas interrompre une attaque par une marche.'},
  {name:'pause', sig:'api.pause(active?)', quoi:'Lit ou pose la <b>pause</b> du jeu. Le monde s\'arrête — physique, animations, particules, ligne de temps reçoivent un temps nul — et les <b>scripts continuent</b> de tourner : c\'est la seule forme qui marche, puisque c\'est un script qui devra la lever. <code>api.dt</code> vaut alors <code>0</code>, si bien qu\'un <code>t += api.dt</code> gèle tout seul.'},
  {name:'dtReal', sig:'api.dtReal', quoi:'La durée de l\'image <b>réelle</b>, qui continue de courir même en pause — de quoi animer un menu pendant que le jeu ne bouge plus. Hors pause, elle vaut <code>api.dt</code>.'},
  {name:'groundHeight', sig:'api.groundHeight(x?, z?)', quoi:'Altitude du terrain sculpté sous ce point, ou <code>null</code> hors du terrain. <b>Dans l\'éditeur seulement</b> : le calcul vit dans l\'outil de sculpt, que ni <b>▶ Jouer</b> ni un build ne chargent. Un script qui l\'appelle marche en édition et lève « n\'est pas une fonction » dès la lecture — pour suivre un relief en jeu, utilisez <code>api.raycast</code> vers le bas.'},

  {group:'Entrées'},
  {name:'action', sig:'api.action(name)', quoi:'Une action de la table d\'entrées est-elle enfoncée.'},
  {name:'actionPressed', sig:'api.actionPressed(name)', quoi:'Vrai seulement à l\'image où l\'action vient d\'être enfoncée.'},
  {name:'axis', sig:'api.axis(name)', quoi:'−1, 0 ou 1 pour un axe de la table d\'entrées.'},
  {name:'key', sig:'api.key(k)', quoi:'Une touche brute est-elle enfoncée. Préférez les trois précédentes : elles suivent la table d\'entrées, donc le clavier du joueur.'},

  {group:'Créer, détruire, afficher'},
  {name:'create', sig:'api.create(nomAsset, position?)', quoi:'Instancie un prefab ou un modèle du projet.'},
  {name:'destroy', sig:'api.destroy(cible)', quoi:'Retire un objet après la boucle de scripts de cette image.'},
  {name:'setActive', sig:'api.setActive(cible, active)', quoi:'Active ou désactive un objet, comme <code>SetActive</code> d\'Unity : inactif, il n\'est plus dessiné ET ses scripts (et ceux de ses enfants) ne sont plus appelés. À distinguer de <code>.visible</code>, qui ne règle que le rendu (<code>Renderer.enabled</code>) : un objet masqué continue d\'exécuter ses scripts.'},
  {name:'isActive', sig:'api.isActive(cible)', quoi:'Vrai si l\'objet et tous ses parents sont actifs (<code>activeInHierarchy</code>) — c\'est la condition pour que ses scripts tournent.'},
  {name:'lookAt', sig:'api.lookAt(cible)', quoi:'Oriente l\'objet vers la cible.'},

  {group:'Physics'},
  {name:'applyForce', sig:'api.applyForce(cible, f)', quoi:'Applique une impulsion au corps rigide.'},
  {name:'velocity', sig:'api.velocity(cible?)', quoi:'Vitesse du corps rigide, ou <code>null</code> s\'il n\'y en a pas.'},
  {name:'setVelocity', sig:'api.setVelocity(cible, v)', quoi:'Écrit la vitesse du corps rigide.'},
  {name:'setPosition', sig:'api.setPosition(cible, p)', quoi:'Téléporte. Remet la vitesse à zéro pour ne pas repartir avec l\'élan de la chute.'},
  {name:'onContact', sig:'api.onContact(tag, fn)', quoi:'Appelle <code>fn</code> une fois, à l\'ENTRÉE en contact avec un objet portant ce tag.'},

  {group:'Contrôleur de personnage'},
  {name:'moveCharacter', sig:'api.moveCharacter(options)', quoi:'Un appel par image remplace la gravité et la détection de sol qu\'on réécrit dans chaque jeu de plateforme.'},
  {name:'respawn', sig:'api.respawn(position)', quoi:'Réapparition du personnage.'},
  {name:'bounce', sig:'api.bounce(force)', quoi:'Impulsion verticale (tremplin, saut sur un ennemi).'},

  {group:'Navigation'},
  {name:'moveTo', sig:'api.moveTo(cible, vitesse?)', quoi:'Avance en évitant les obstacles ; renvoie <code>true</code> à l\'arrivée.'},
  {name:'patrol', sig:'api.patrol(points, vitesse?)', quoi:'Patrouille cyclique entre des points ou des noms d\'objets.'},
  {name:'pathTo', sig:'api.pathTo(cible)', quoi:'Le chemin calculé, sous forme de points, ou <code>null</code>.'},

  {group:'Animations de modèles importés'},
  {name:'animations', sig:'api.animations(cible?)', quoi:'Noms des clips du modèle — <b>y compris ceux reciblés depuis un autre fichier</b>, qui portent le nom <code>Fichier · clip</code>.'},
  {name:'playAnimation', sig:'api.playAnimation(cible, name, opts?)', quoi:'Joue un clip. <code>opts</code> accepte <code>{boucle, vitesse, fondu}</code>. Le <code>name</code> est celui que rend <code>api.animations()</code> : pour une animation reciblée, le nom composé et non celui du fichier d\'origine.'},
  {name:'stopAnimation', sig:'api.stopAnimation(cible?)', quoi:'Arrête le clip en cours, et avec lui ses couches.'},
  {name:'layerAnimation', sig:'api.layerAnimation(cible, name, {depuis, weight, speed, fondu})', quoi:'Joue un second clip sur <b>un os et toute sa descendance</b> — marcher en bas, viser en haut. <code>depuis</code> est le nom de l\'os de départ, <code>weight</code> le poids (0 à 1), <code>speed</code> la vitesse, <code>fondu</code> la durée du fondu en secondes. La base garde tous les autres os, sans recouvrement.'},
  {name:'removeLayer', sig:'api.removeLayer(cible?, depuis?)', quoi:'Retire la couche partant de cet os. Sans <code>depuis</code>, les retire toutes.'},
  {name:'animator', sig:'api.animator(cible?)', quoi:'La <b>machine à états</b> de l\'objet, ou <code>null</code> s\'il n\'en porte pas. L\'objet rendu expose <code>setFloat(name, v)</code>, <code>setInt</code>, <code>setBool</code>, <code>setTrigger(name)</code>, <code>get(name)</code>, <code>restart()</code>, et les lectures <code>.state</code> et <code>.params</code>. Le composant peut être sur un parent : la recherche remonte.'},

  {group:'Temps, événements, scènes'},
  {name:'after', sig:'api.after(secondes, fn)', quoi:'Minuterie.'},
  {name:'emit', sig:'api.emit(name, donnees?)', quoi:'Déclenche un événement nommé.'},
  {name:'on', sig:'api.on(name, fn)', quoi:'S\'abonne à un événement nommé : <code>api.emit</code> d\'un autre script, marqueur d\'animation, ou <b>clic d\'interface</b> — un élément <code>class="ui-button" data-event="jouer"</code> d\'un document UI appelle <code>fn(valeur)</code> (la valeur d\'un champ <code>data-bind</code>, sinon <code>undefined</code>). Voir la page « L\'interface de jeu ».'},
  {name:'changeScene', sig:'api.changeScene(name)', quoi:'Passe à une autre scène du projet.'},
  {name:'uiDocument', sig:'api.uiDocument(node?)', quoi:'Le composant UIDocument du nœud, ou <code>null</code>.'},

  {group:'Rendu, son, particules'},
  {name:'particles', sig:'api.particles(cible?)', quoi:'<code>.emit(n?)</code> et <code>.setActive(bool)</code> sur un émetteur.'},
  {name:'pointerRay', sig:'api.pointerRay()', quoi:'Le rayon monde <code>{origin, direction}</code> qui passe par la souris ou le doigt, depuis la caméra du jeu. Mis à jour aussi au simple toucher.'},
  {name:'pick', sig:'api.pick(filter?, distance?)', quoi:'L\'objet sous le pointeur : <code>api.raycast</code> le long de <code>api.pointerRay()</code>. Rend <code>{object, point, distance}</code> ou null.'},
  {name:'playNote', sig:'api.playNote(id, opts?)', quoi:'Joue une note d\'un composant <b>Synthesizer</b> (le sien, sinon le premier de la scène). <code>opts</code> : volume, pitch, when (s).'},
  {name:'playNotes', sig:'api.playNotes(ids, opts?)', quoi:'Joue une suite de notes espacées de <code>opts.gap</code> secondes (0,5 par défaut).'},
  {name:'notes', sig:'api.notes(target?)', quoi:'Copie des notes déclarées sur le Synthesizer, avec leur <code>meta</code> libre (couleur, forme…).'},
  {name:'speak', sig:'api.speak(text, opts?)', quoi:'Lit un texte à voix haute si le navigateur le permet ; rend false sinon. <code>opts</code> : lang, rate, pitch, volume.'},
  {name:'stopSpeaking', sig:'api.stopSpeaking()', quoi:'Interrompt la voix parlée en cours.'},
  {name:'desktop', sig:'api.desktop()', quoi:'Vrai quand le jeu tourne dans l\'application de bureau (export Electron), faux dans un navigateur. Sert à <b>cacher</b> ce qui n\'a pas de sens sur le web — un bouton « Quitter », par exemple.'},
  {name:'quitGame', sig:'api.quitGame()', quoi:'Ferme l\'application de bureau. Rend <code>false</code> dans un navigateur, où c\'est impossible : une page ne peut pas se fermer elle-même. Un bouton « Quitter » doit donc se <b>cacher</b> si <code>api.desktop()</code> est faux, pas rester inerte.'},
  {name:'t', sig:'api.t(cle, params)', quoi:'Le texte traduit d\'une clé, avec substitution : <code>api.t(&laquo;&nbsp;score&nbsp;&raquo;, {n: 42})</code> sur « Score : {n} ». Une clé <b>absente rend la clé elle-même</b>, visible à l\'écran — un bouton vide se découvrirait chez le joueur. La table vit dans les réglages du projet.'},
  {name:'locale', sig:'api.locale()', quoi:'La langue active (<code>fr</code>, <code>en</code>…). Choisie au démarrage d\'après le choix mémorisé du joueur, puis ce qu\'annonce son navigateur, puis la langue par défaut du projet.'},
  {name:'locales', sig:'api.locales()', quoi:'Les langues que le projet fournit — de quoi construire un menu de choix sans les écrire en dur.'},
  {name:'setLocale', sig:'api.setLocale(code)', quoi:'Change la langue en cours de partie et la mémorise. Rend <code>false</code> si le projet ne la fournit pas : changer pour une langue absente viderait tout le texte du jeu.'},
  {name:'padAxis', sig:'api.padAxis(name)', quoi:'Valeur analogique (−1 à 1) d\'un axe piloté au <b>stick</b> ; <code>api.axis</code> la combine déjà au clavier et au doigt. Les BOUTONS, eux, sont des touches ordinaires : <code>api.action(&laquo;&nbsp;jump&nbsp;&raquo;)</code> ou <code>api.key(&laquo;&nbsp;pad:0&nbsp;&raquo;)</code>.'},
  {name:'gamepads', sig:'api.gamepads()', quoi:'Le nombre de manettes branchées. Sert à afficher « branchez une manette », jamais à décider si le jeu est jouable.'},
  {name:'rumble', sig:'api.rumble(force, ms)', quoi:'Fait vibrer la manette. Rend <code>false</code> quand le matériel ne sait pas vibrer — beaucoup de manettes et de navigateurs ne le savent pas, et un jeu ne doit jamais en dépendre.'},
  {name:'steam', sig:'api.steam.unlockAchievement(id)', quoi:'<b>Steam</b> : tout vit dans <code>api.steam</code>, et tout est <b>inerte</b> hors de l&rsquo;application lancée par Steam (éditeur, web) — il rend <code>false</code> ou <code>0</code>, donc un script écrit pour Steam tourne partout. <code>available()</code> dit si Steam est là. <b>Succès</b> : <code>unlockAchievement(id)</code> (identifiant déclaré dans Steamworks, ex. <code>ACH_BOSS_1</code>), <code>isAchievementUnlocked(id)</code>, <code>clearAchievement(id)</code> pour les essais seulement. <b>Statistiques</b> (entières) : <code>addStat(nom, delta?)</code> rend la nouvelle valeur, <code>setStat(nom, n)</code>, <code>getStat(nom)</code> ; les envois sont groupés, on peut appeler à chaque ennemi tué. Aussi <code>playerName()</code>, <code>language()</code>, <code>onDeck()</code> et <code>controller()</code> (type de manette vu par Steam Input : <code>PS5Controller</code>, <code>SteamDeckController</code>… pour choisir les glyphes de boutons). Une bibliothèque (<code>api.lib</code>) reçoit un <code>api</code> réduit sans <code>steam</code> : passez-lui le vôtre en argument.'},
  {name:'touchAxis', sig:'api.touchAxis(name)', quoi:'Valeur analogique (−1 à 1) d\'un axe piloté au doigt par <b>TouchControls</b> ; <code>api.axis</code> la combine déjà au clavier.'},
  {name:'playSound', sig:'api.playSound(name, volume?, bus?)', quoi:'Joue un asset audio, en tir unique, sur le bus <code>sfx</code> (défaut) ou <code>music</code>.'},
  {name:'audio', sig:'api.audio(cible?)', quoi:'<code>.play()</code>, <code>.stop()</code>, <code>.volume(v)</code> sur la source audio de l\'objet.'},
  {name:'audioBus', sig:'api.audioBus(name)', quoi:'Un bus de mixage — <code>master</code>, <code>music</code> ou <code>sfx</code> : <code>.volume(v?)</code>, <code>.mute(on?)</code>, <code>.muted()</code>. La sourdine repart à zéro à chaque partie.'},

  {group:'État, données, sauvegarde'},
  {name:'state', sig:'api.state', quoi:'État de jeu global. C\'est le SEUL endroit qui survit à un changement de scène.'},
  {name:'image', sig:'api.image(name)', quoi:'Rend l\'image d\'un asset texture, pour un script qui dessine lui-même (canvas d\'interface). Peut être encore en chargement : tester img.complete.'},
  {name:'data', sig:'api.data(name)', quoi:'Le contenu d\'un asset de données, analysé une fois puis mis en cache.'},
  {name:'lib', sig:'api.lib(name)', quoi:'Les exports d\'une BIBLIOTHÈQUE : un asset script qui remplit exports au lieu de définir start/update. Exécutée une fois par partie, le même objet pour tous ses appelants — c\'est ainsi que plusieurs scripts courts partagent un noyau commun.'},
  {name:'props', sig:'api.props(cible?)', quoi:'Les propriétés personnalisées de l\'objet (section Jeu).'},
  {name:'tag', sig:'api.tag(cible?)', quoi:'Le tag de l\'objet.'},
  {name:'save', sig:'api.save(name?)', quoi:'Persiste <code>api.state</code> sur la machine du joueur. Renvoie <code>false</code> si le navigateur refuse.'},
  {name:'load', sig:'api.load(name?)', quoi:'Recharge un état sauvegardé, en le FUSIONNANT dans l\'existant.'},
  {name:'clearSave', sig:'api.clearSave(name?)', quoi:'Efface un emplacement de sauvegarde.'},

  {group:'Réalité virtuelle (WebXR)'},
  {name:'xr', sig:'api.xr', quoi:'Le casque et les manettes. <code>api.xr.presenting()</code> : le jeu est-il affiché dans le casque ? <code>api.xr.controller("left" | "right")</code> rend <code>{connected, position, quaternion, direction, trigger, squeeze, stick:{x,y}}</code> en coordonnées <b>monde</b> ; <code>api.xr.button(main, nom)</code> et <code>api.xr.buttonPressed(main, nom)</code> lisent <code>"trigger"</code>, <code>"squeeze"</code>, <code>"stick"</code>, <code>"a"</code> (A/X), <code>"b"</code> (B/Y) ; <code>api.xr.head()</code> la pose de la tête ; <code>api.xr.held(main)</code> l’objet tenu ; <code>api.xr.haptic(main, intensite, ms)</code> fait vibrer. Dans l’éditeur, tout répond « pas de casque » sans erreur. Voir la page « Réalité virtuelle (WebXR) ».'},

  {group:'Multijoueur'},
  {name:'isAuthority', sig:'api.isAuthority()', quoi:'Hors ligne, renvoie toujours <code>true</code> : un jeu solo tourne sans savoir que le réseau existe.'},
  {name:'network', sig:'api.network', quoi:'Poignée réseau : <code>.replicate(objet)</code>, <code>.join(code, base)</code>…'},

  {group:'Journal'},
  {name:'log', sig:'api.log(msg)', quoi:'Écrit dans la Console de l\'éditeur.'},
  {name:'warn', sig:'api.warn(msg)', quoi:'Avertissement dans la Console.'},
  {name:'error', sig:'api.error(msg)', quoi:'Erreur dans la Console.'},
  {name:'status', sig:'api.status(msg)', quoi:'Message dans la bar de status.'},
  {name:'V3', sig:'api.V3(x, y, z)', quoi:'Un <code>THREE.Vector3</code>.'}
];


export const PAGES_HELP = [].concat(PAGES_START, PAGES_INTERFACE, PAGES_WORKFLOWS,
  PAGES_COMPONENTS, PAGES_SCRIPTING, PAGES_TUTORIALS, PAGES_REFERENCE);

// ---------- Glossaire ----------
// Volontairement court : seulement les termes dont le sens ICI n'est pas celui qu'on
// devine. Un glossaire qui définit « caméra » fait perdre confiance dans les entrées
// qui comptent.
export const GLOSSARY_HELP = [
  {terme:'Albedo', page:'materials-maps', def:
    'La couleur d\'une surface, sans aucune lumière ni ombre. Une texture d\'albedo qui '
    + 'contient déjà des ombres peintes donnera un rendu sale : les ombres s\'ajouteront à '
    + 'celles que le moteur calcule.'},
  {terme:'Asset', page:'project', def:
    'Une ressource du projet — texture, modèle, matériau, script, son, document UI, table de '
    + 'données. Un asset est PARTAGÉ : le modifier met à jour tous les objets qui s\'en servent.'},
  {terme:'Atlas', page:'lightmaps', def:
    'Une seule texture où plusieurs objets se partagent la place, chacun dans sa région. La '
    + 'cuisson de lightmaps y distribue les objets selon leur SURFACE réelle : un sol y prend '
    + 'beaucoup plus de place qu\'un boulon, parce qu\'il a beaucoup plus à éclairer.'},
  {terme:'Autorité', page:'multiplayer', def:
    'En multijoueur, le poste où la partie tourne réellement — le premier arrivé dans le '
    + 'salon. Les autres lui envoient leurs entrées. Hors ligne, on est toujours l\'autorité.'},
  {terme:'Cinématique', page:'physics', def:
    'Un body qui pousse les autres mais que rien ne pousse, et que la gravité ignore. Dans cet '
    + 'éditeur, on n\'en crée pas : tout objet ANIMÉ sur la timeline en devient un.'},
  {terme:'Collider', page:'physics', def:
    'La forme utilisée pour les collisions, qui n\'est presque jamais le maillage. En mode Auto, '
    + 'tout ce qui n\'est pas une sphère ou un cube du moteur devient une boîte englobante.'},
  {terme:'Couture', page:'lightmaps', def:
    'Une arête qui existe une fois sur le modèle et DEUX fois dans le dépliage : les deux îlots '
    + 'se touchent en 3D mais sont posés loin l\'un de l\'autre dans l\'atlas. Chacun y reçoit son '
    + 'éclairage séparément, d\'où le trait visible le long de l\'arête si on ne les raccorde pas.'},
  {terme:'Empaquetage', page:'materials-contract', def:
    'L\'ordre dans lequel les canaux rouge, vert, bleu et alpha d\'une texture portent leurs '
    + 'informations. Chaque moteur a fait un choix différent, et se tromper ne lève aucune '
    + 'error — seulement un rendu faux.'},
  {terme:'Irradiance', page:'lightmaps', def:
    'La lumière REÇUE par une surface, sans sa couleur propre. C\'est ce que contient une '
    + 'lightmap : le moteur la multiplie ensuite par l\'albedo. Y mettre la couleur l\'appliquerait '
    + 'deux fois, et tout ce qui est coloré virerait au sombre saturé.'},
  {terme:'Lightmap', page:'lightmaps', def:
    'Une texture d\'éclairage déjà calculé — ombres douces, lumière indirecte — lue au rendu au '
    + 'lieu d\'être recalculée à chaque image. Réservée à ce qui ne bouge pas, et elle exige un '
    + 'DÉPLIAGE dédié, sans chevauchement, que l\'éditeur ne fabrique pas.'},
  {terme:'Lissage', page:'materials-maps', def:
    'À quel point une surface est polie : 1 = miroir, 0 = mat. C\'est exactement l\'inverse '
    + 'de la rugosité, avec laquelle il ne faut pas le confondre. L\'éditeur affiche du '
    + 'lissage ; les cartes séparées sont encodées en rugosité.'},
  {terme:'Masque combiné', page:'materials-contract', def:
    'Une texture qui porte trois informations dans ses canaux au lieu d\'en occuper trois. '
    + 'Moins de fichiers, moins de mémoire — à condition de savoir dans quel ordre elle est '
    + 'peinte.'},
  {terme:'Normale (map de)', page:'materials-maps', def:
    'Une texture qui décrit l\'orientation de la surface point par point, pour simuler un '
    + 'relief que la géométrie n\'a pas. Deux conventions existent, OpenGL et DirectX, et '
    + 'elles ne diffèrent que par le canal vert.'},
  {terme:'ORM', page:'materials-contract', def:
    'Occlusion / Roughness / Metallic — l\'ordre des canaux défini par glTF, et la convention '
    + 'native de cet éditeur. R occlusion, G rugosité, B métal.'},
  {terme:'Occlusion ambiante', page:'materials-maps', def:
    'Le noircissement des recoins, là où la lumière ambiante peine à entrer. Fournie en '
    + 'texture : elle est peinte à l\'avance, pas calculée pendant le jeu.'},
  {terme:'Prefab', page:'project', def:
    'Un objet modèle, réutilisable, dont les copies suivent les modifications. Une VARIANTE '
    + 'part d\'un prefab et le modifie sur quelques points seulement.'},
  {terme:'PostVolume', page:'probes', def:
    'Un composant qui porte un profil de post-traitement (js/post-profile.js), façon Unity '
    + 'Volume : global (partout) ou local à une zone box/sphere. Plusieurs volumes actifs se '
    + 'mélangent selon leur priorité et leur distance de fondu.'},
  {terme:'Reciblage', page:'retargeting', def:
    'Poser l\'animation écrite pour un squelette sur un AUTRE squelette. Ici la correspondance '
    + 'se fait par nom d\'os, avec deux corrections : la taille des rigs et l\'écart entre leurs '
    + 'poses de repos. Deux squelettes qui ne partagent pas de convention de nommage ne sont pas '
    + 'traités.'},
  {terme:'Machine à états', page:'animator', def:
    'Une description en DONNÉES de quelle animation joue et quand on en change : des états, '
    + 'des transitions, des conditions. Elle se câble à la souris dans la fenêtre Animator, et '
    + 'ses paramètres se règlent depuis le système visuel « Quand… Alors… » — sans code.'},
  {terme:'Déclencheur', page:'animator', def:
    'Un paramètre qui vaut vrai UNE SEULE FOIS : la transition qui s\'en sert le désarme en '
    + 'passant. Sans cela, un saut se relancerait à chaque image tant que le paramètre reste '
    + 'armé — un saut perpétuel, sans aucune erreur.'},
  {terme:'Couche par os', page:'animation', def:
    'Un second clip joué sur un os et toute sa descendance, pendant que le clip de base tient '
    + 'le reste du corps — marcher en bas, viser en haut. Les deux ensembles d\'os sont '
    + 'DISJOINTS : deux animations sur le même os donneraient une moyenne, pas un choix.'},
  // « Piste additive » et non « couche additive » : le mot COUCHE désigne déjà un second clip
  // joué sur une chaîne d'os, ce qui est un tout autre mécanisme. Deux sens pour un mot, dans
  // le même glossaire, et le lecteur ne peut plus savoir de quoi on parle. La timeline, elle,
  // dit « ajoute » — c'est ce vocabulaire-là que l'aide reprend.
  {terme:'Piste additive', page:'animation', def:
    'Une piste réglée sur « + ajoute » : ses clés sont des ÉCARTS, composés par-dessus '
    + 'l\'animation en cours plutôt que de la remplacer — « +30° de tête sur la marche ». Elle '
    + 'exige un clip qui repose la pose à chaque image ; sans lui l\'écart s\'accumulerait, et '
    + 'la piste est donc inert. À ne pas confondre avec une [Couche par os], qui est un second '
    + 'clip et non un mode de piste.'},
  {terme:'Marqueur d\'animation', page:'animation', def:
    'Un instant nommé posé sur un clip : à son passage, en LECTURE seulement, il émet un '
    + 'événement. Un objet réglé sur « À la réception d\'un événement » y réagit — son, '
    + 'particules, visibilité. Il appartient au clip, donc à tous les personnages qui le jouent. '
    + 'Unreal appelle ça un Anim Notify.'},
  {terme:'Rig', page:'retargeting', def:
    'Le squelette d\'un modèle : une hiérarchie d\'os auxquels le maillage est attaché. Les os '
    + 'ne sont jamais des objets de la scène — ils appartiennent au modèle, et se voient dans la '
    + 'section Squelette de l\'inspecteur.'},
  {terme:'Pose de repos', page:'retargeting', def:
    'L\'orientation de chaque os quand aucune animation ne joue — la T-pose, l\'A-pose. Deux rigs '
    + 'de poses de repos différentes ne peuvent pas s\'échanger des rotations brutes : c\'est '
    + 'l\'ÉCART au repos qu\'on transfère, pas l\'orientation absolue.'},
  {terme:'Clip', page:'animation', def:
    'Une animation stockée dans un fichier importé, en lecture seule. Elle appartient à l\'asset '
    + 'et est partagée par tous les objets qui s\'en servent — la retoucher se fait en posant ses '
    + 'propres clés par-dessus, os par os.'},
  {terme:'RGBM', page:'lightmaps', def:
    'Un encodage qui range des valeurs supérieures à 1 dans les huit bits d\'un PNG : trois '
    + 'canaux pour la couleur, le quatrième pour un multiplicateur commun. Il fait passer la '
    + 'portée d\'une lightmap de 1 à 64 — sans lui, une fenêtre au soleil et un néon se '
    + 'confondent sur le même plateau uniforme.'},
  {terme:'Sonde de réflexion', page:'probes', def:
    'Un objet invisible qui photographie son entourage et fournit son reflet aux surfaces '
    + 'proches. Elle ne crée pas le reflet à partir de rien : elle REMPLACE, localement, le '
    + 'reflet du ciel par quelque chose de plus juste.'},
  {terme:'Tag', page:'scripts-api', def:
    'Une étiquette de gameplay posée dans la section Jeu de l\'inspecteur. C\'est par elle que '
    + 'les scripts se retrouvent — api.byTag(\'ennemi\') — et que l\'analyseur reconnaît un sol, '
    + 'un joueur ou un objectif.'},
  {terme:'Tuilage', page:'materials-maps', def:
    'Combien de fois une texture se répète sur la surface. Vaut pour TOUTES les cartes du '
    + 'matériau à la fois — il n\'y a pas de tuilage par emplacement.'},
  {terme:'Quand… Alors…', page:'animator', def:
    'Le système visuel d\'évènements de l\'inspecteur : une condition (« Quand ») déclenche une '
    + 'ou plusieurs actions (« Alors »), sans écrire de code. Porté par le composant '
    + '<code>Events</code>, il règle aussi bien un paramètre d\'animation qu\'un son ou '
    + 'une variable de script.'},
  {terme:'Modèle importé', page:'units', def:
    'La racine d\'un fichier .glb/.fbx importé, portée par le composant <code>Model</code>. '
    + 'Elle ne peut pas être un Mesh : son rendu vit dans un sous-arbre de nœuds et de '
    + 'géométries, pas sur la racine elle-même — c\'est cette racine que la scène référence.'},
  {terme:'Maillage skinné', page:'units', def:
    'Un <code>THREE.SkinnedMesh</code>, dans le sous-arbre d\'un modèle importé (un personnage '
    + 'riggé, par exemple) — porté par le composant <code>SkinnedMeshRenderer</code>. Il ne '
    + 'détient rien de plus qu\'un accès direct au squelette et au matériau réels ; il rend ce '
    + 'maillage découvrable là où <code>Model</code> ne l\'était pas, un cran plus bas dans la '
    + 'hiérarchie. Reconstruit à chaque clone du modèle, jamais hérité tel quel.'},
  {terme:'Scène imbriquée', page:'project', def:
    'Une scène du projet posée comme objet dans une autre, via le composant '
    + '<code>SubScene</code>. Elle garde son propre fichier ; ce que vous déplacez ou modifiez '
    + 'localement dans la scène qui l\'accueille est un override, pas une copie.'}
];
