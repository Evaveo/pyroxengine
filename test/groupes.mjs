// moteur/test/groupes.mjs
//
// LA CARTE DES DOMAINES — à quoi sert-elle, et pourquoi une liste explicite.
//
// La CI faisait tourner les 191 fichiers de test dans un seul job nommé « test ». Un rouge
// disait donc « le moteur est cassé » et rien de plus : il fallait dérouler le journal pour
// apprendre si le défaut était dans le rendu, l'animation ou la sérialisation. Ce fichier
// découpe la suite en domaines, et la CI en fait une matrice : un job par domaine, nommé.
//
// La liste est EXPLICITE, pas un glob. Un glob rattacherait silencieusement tout nouveau
// fichier — ou, pire, n'en rattacherait aucun et le test ne tournerait jamais en CI sans que
// rien ne le signale. Ici, ajouter un fichier de test sans l'inscrire fait échouer
// groupes-couverture.test.mjs : le manque se voit à la première exécution, en local.

export const GROUPS = {
  // Conventions, build, versions, documentation, chargement des modules.
  structure: [
    'aide.test.mjs', 'aide-chiffres.test.mjs', 'aide-couverture.test.mjs',
    'allegement-build.test.mjs', 'allegement-scripts-reference.test.mjs', 'gardes-allegement.test.mjs',
    'build-bureau.test.mjs',
    'desktop-compiler.test.mjs',
    'apis-navigateur.test.mjs', 'densite-tokens.test.mjs', 'doc-versionnage.test.mjs',
    'encodage-source.test.mjs', 'esm-modules.test.mjs', 'esm-risques-evaluation.test.mjs',
    'exporteur.test.mjs', 'fichiers-charges.test.mjs', 'globales-non-declarees.test.mjs', 'fixture-build-test.test.mjs',
    'groupes-couverture.test.mjs',
    'harnais-build-test.test.mjs', 'icones.test.mjs', 'naming-anglais.test.mjs',
    'nomsFichiers.test.mjs', 'ordre-feuilles.test.mjs', 'outils-projet.test.mjs',
    'outils-renommage.test.mjs', 'scoper-css.test.mjs', 'symboles-globaux.test.mjs',
    'syntaxe-js.test.mjs', 'table-fichiers-build.test.mjs', 'tokens-css.test.mjs',
    'version-build.test.mjs'
  ],

  // Format de projet, dossier-projet, assets, migrations, enregistrement.
  projet: [
    'api-cache.test.mjs', 'avatar-persistence.test.mjs', 'cloud-binaires-assets.test.mjs', 'focus-jeu-integre.test.mjs', 'cloud-project.test.mjs', 'cloud-removed.test.mjs', 'cloud-session.test.mjs',
    'conflit-resolution.test.mjs',
    'compression-assets.test.mjs',
    'dossier-suppression.test.mjs', 'dossierProjet.test.mjs', 'double-stockage.test.mjs',
    'folder-watch.test.mjs', 'genre-projet.test.mjs', 'historique-assets.test.mjs',
    'historique-resilience.test.mjs', 'asset-loading-resilience.test.mjs', 'hub-templates.test.mjs', 'identite-assets.test.mjs', 'identite-profil-defaut.test.mjs',
    'migration-dossier.test.mjs', 'migration-uidocument.test.mjs',
    'nouvelle-scene-orphelins.test.mjs', 'objet-scene-par-id.test.mjs', 'prefs.test.mjs',
    'presets-import.test.mjs', 'project-roundtrip.test.mjs', 'projet-settings.test.mjs',
    'remap-references.test.mjs', 'remap-references-assets.test.mjs',
    'remap-references-exhaustif.test.mjs', 'sauvegarde-palette.test.mjs', 'remap-lot-partiel.test.mjs', 'collider2d-contour.test.mjs', 'scene-modifiee-disque.test.mjs', 'ciel-camera-ortho.test.mjs', 'ordre-evaluation.test.mjs',
    'save-progression.test.mjs', 'scene-index.test.mjs', 'scene-lock.test.mjs',
    'write-incremental.test.mjs'
  ],

  // Matériaux, shaders, lightmaps, post-traitement, sondes, textures, surfaces.
  rendu: [
    'three-instance-unique.test.mjs',
    'banc-scene.test.mjs', 'primitive-geometry.test.mjs',
    'regroupement-editeur.test.mjs',
    'extraction-materiaux.test.mjs', 'graphe-shader.test.mjs', 'graphe-shader-editeur.test.mjs',
    'graphe-shader-tsl-reel.test.mjs', 'grille-sol.test.mjs',
    'instances-materiau-noeuds.test.mjs', 'lightmap.test.mjs', 'lightmap-cuisson.test.mjs',
    'lissage.test.mjs', 'lissage-tsl.test.mjs', 'masque-orm.test.mjs',
    'materiau-plugin.test.mjs', 'materiau-shader-inspecteur.test.mjs', 'noeud-debris.test.mjs',
    'ombre-cadrage.test.mjs', 'post-etat-neutre.test.mjs', 'post-orientation.test.mjs',
    'post-profile-asset.test.mjs', 'post-sortie-ecran.test.mjs', 'post-volume-blend.test.mjs',
    'post-volume-component.test.mjs', 'reflets-retrait.test.mjs', 'sonde-ambiance.test.mjs',
    'sondes-non-eclaire.test.mjs', 'sondes-reflets.test.mjs',
    'sous-scene-environnement.test.mjs', 'substance.test.mjs',
    'surface-three-webgpu.test.mjs', 'surface-webgpu.test.mjs',
    'texture-apres-materiau.test.mjs', 'texture-proc.test.mjs', 'iso-sprite.test.mjs', 'texture-texte.test.mjs'
  ],

  // Animations, animator, squelettes, ciblage humanoïde.
  animation: [
    'anim-asset.test.mjs', 'clips-modele.test.mjs', 'anim-sprite.test.mjs', 'animation-additif.test.mjs',
    'animation-camera.test.mjs', 'animation-inspecteur.test.mjs', 'animator.test.mjs',
    'animator-api.test.mjs', 'animator-asset-mini-inspecteur.test.mjs',
    'animator-blend-points.test.mjs', 'animator-graphe-geo.test.mjs', 'cadence-timer.test.mjs',
    'echelle-modele-skinne.test.mjs', 'humanoid-avatar.test.mjs', 'marqueurs-anim.test.mjs',
    'melange-1d.test.mjs', 'melange-anim.test.mjs', 'reciblage.test.mjs',
    'root-motion-surplace.test.mjs', 'skinned-mesh-renderer.test.mjs', 'squelette.test.mjs'
  ],

  // Docks, panneaux, inspecteur, hiérarchie, fabrique d'interface.
  ui: [
    'affordances-lecture-seule.test.mjs',
    'barre-haut.test.mjs', 'bind-texte.test.mjs', 'composant-uidocument.test.mjs',
    'dock-arbre.test.mjs', 'dock-cible-depot.test.mjs', 'dock-dom.test.mjs',
    'dock-hotes.test.mjs', 'dock-mutation.test.mjs',
    'editeur-code.test.mjs', 'table-editor.test.mjs', 'prefab-modele-perdu.test.mjs', 'etats-socle-visibles.test.mjs', 'fabrique-ui.test.mjs',
    'harnais-dom.test.mjs', 'hierarchie-rails.test.mjs', 'hierarchie-selection.test.mjs',
    'hierarchy-icon.test.mjs', 'hud-valeurs-vivantes.test.mjs',
    'inspecteur-descripteurs.test.mjs', 'inspecteur-ids.test.mjs', 'palette-flottante.test.mjs',
    'panneau-environnement.test.mjs', 'panneau-rendu.test.mjs', 'panneaux-reglages.test.mjs',
    'ui-champ-info.test.mjs', 'ui-chemins.test.mjs', 'ui-css-asset.test.mjs',
    'ui-echec-silencieux.test.mjs', 'ui-formulaire-dom.test.mjs',
    'ui-historique-interaction.test.mjs', 'ui-liste.test.mjs', 'ui-multiselection.test.mjs',
    'ui-panneau.test.mjs', 'ui-plan-formulaire.test.mjs', 'ui-registre.test.mjs',
    'ui-slot-asset.test.mjs', 'ui-traduction-materiau.test.mjs', 'view-gizmo.test.mjs'
  ],

  // API de script, copilote, plugins, composants, runtime publié, audio.
  scripts: [
    'attenuation-audio.test.mjs', 'audio-bus.test.mjs', 'donnees-trompeuses.test.mjs', 'performance-lot-e.test.mjs', 'gardes-typeof.test.mjs', 'accessibilite-lot-f.test.mjs', 'dette-lot-g.test.mjs', 'cliquets-dette.test.mjs', 'rack-aller-retour.test.mjs', 'menu-sous-menus.test.mjs', 'chip-synth.test.mjs', 'music-loop.test.mjs', 'composant.test.mjs', 'composants-aller-retour.test.mjs',
    'composants-descripteurs.test.mjs', 'copilote-conseils.test.mjs', 'script-asset-lint.test.mjs', 'script-library.test.mjs', 'team-color.test.mjs', 'camera-overlays.test.mjs', 'fog-of-war.test.mjs', 'ai-guidelines.test.mjs', 'ai-rules.test.mjs', 'ai-trace.test.mjs', 'ai-rules-gardes.test.mjs', 'project-audit.test.mjs',
    'copilote-fournisseurs.test.mjs', 'copilote-inspection-cout.test.mjs', 'copilote-observer.test.mjs', 'mcp-tool-gaps.test.mjs', 'outils-mcp-donjon.test.mjs', 'mcp-real-path.test.mjs', 'copilote-registre.test.mjs', 'mcp-bridge.test.mjs', 'mcp-link.test.mjs', 'blender-link.test.mjs', 'blender-addon.test.mjs', 'blender-installer.test.mjs',
    'ecs-registre.test.mjs', 'mcp-pont.test.mjs', 'miroir-api-script.test.mjs',
    'miroir-runtime.test.mjs', 'plugins-api-v2.test.mjs', 'catalogue-plugins.test.mjs', 'pont-runtime-composants.test.mjs',
    'runtime-partage.test.mjs', 'script-asset-reference.test.mjs', 'script-confiance.test.mjs',
    'script-expose-persistance.test.mjs', 'script-portee.test.mjs', 'son-proc.test.mjs',
    'localisation.test.mjs', 'manette.test.mjs', 'steam.test.mjs', 'souris-fps.test.mjs', 'souris-script.test.mjs', 'reseau-protocole.test.mjs', 'reseau-transports.test.mjs', 'synth-touch.test.mjs', 'systems.test.mjs'
  ],

  // Caméras, physique, personnage, import de modèles, calques.
  'monde-3d': [
    'calques-resync.test.mjs', 'camera-principale.test.mjs', 'camera-projection.test.mjs', 'xr-runtime.test.mjs',
    'creer-physique.test.mjs', 'editor-camera.test.mjs', 'hauteur.test.mjs',
    'import-modele-geometrie.test.mjs', 'import-modele-unity.test.mjs', 'noeuds-modele.test.mjs', 'import-modele-inspecteur.test.mjs',
    'inertie.test.mjs', 'personnage-cap.test.mjs', 'touche-majuscule-sprint.test.mjs'
  ],

  // Sprites, tuiles, monde 2D.
  'monde-2d': [
    'asset-sprite.test.mjs', 'atlas-sprite.test.mjs', 'camera-2d.test.mjs', 'camera-cadrage-force.test.mjs',
    'engendrer-2d.test.mjs', 'monde-2d.test.mjs', 'physique-2d.test.mjs',
    'round-trip-2d.test.mjs', 'sprite-2d.test.mjs', 'tile-palette.test.mjs',
    'tilemap.test.mjs', 'outils-planches.test.mjs', 'tilemap-composant.test.mjs', 'tilemap-collision.test.mjs', 'tuiles-camera-script.test.mjs', 'script-cible-tilemap-sprite.test.mjs',
    'vue-dessus-2d.test.mjs'
  ]
};

/** Les fichiers d'un domaine, préfixés `test/` — la forme qu'attend `node --test`. */
export function groupFiles(name){
  const files = GROUPS[name];
  if(!files) throw new Error('domaine de test inconnu : ' + name);
  return files.map((f) => 'test/' + f);
}
